'use strict';

// Cliente RPC SÍNCRONO para la base de datos central.
//
// main.js llama a db.js de forma síncrona (121 puntos). Para poder consultar la
// BD del servidor por red sin reescribir toda la app, este módulo expone el MISMO
// API síncrono que services/db.js, pero cada operación viaja por HTTP a
// services/db-rpc-server.js.
//
// El truco para hacer síncrono algo que es asíncrono por red:
//   - Se crea un worker thread (código embebido, sin archivo externo).
//   - Main y worker comparten dos SharedArrayBuffer (solicitud y respuesta).
//   - Main escribe la solicitud, hace Atomics.wait() (bloquea de verdad) hasta
//     que el worker publique la respuesta vía Atomics.notify().
//   - El worker hace el fetch() HTTP real (asíncrono) y escribe el resultado.
//
// Si el servidor no responde se usa un "cooldown": la primera falla espera el
// timeout del worker, pero las llamadas siguientes fallan al instante hasta que
// el cooldown expire, así la UI no se congela en bucle.

const { Worker } = require('worker_threads');
const crypto = require('crypto');
const { machineId } = require('./machine');

const HEAD = 12; // 3 x Uint32: [estado][id][longitud]
const BUF_SIZE = 64 * 1024 * 1024;
const REQ_READY = 1;
const RES_READY = 1;
const SHUTDOWN = 3;
const WORKER_TIMEOUT_MS = 6000;
const MAIN_WAIT_MS = 10000;
const NET_COOLDOWN_MS = 4000;

let url = null;
let token = '';
let worker = null;
let reqView = null;
let resView = null;
let reqBytes = null;
let resBytes = null;
let nextId = 1;
let netError = null;
let netCooldownUntil = 0;

const WORKER_SRC = `
'use strict';
const { workerData } = require('worker_threads');
const HEAD = 12;
const req = workerData.req;
const res = workerData.res;
const cfg = workerData.cfg;
const reqView = new Int32Array(req, 0, 3);
const resView = new Int32Array(res, 0, 3);
const reqBytes = new Uint8Array(req);
const resBytes = new Uint8Array(res);

function readStr(u8, offset, len) {
  return Buffer.from(u8.buffer, u8.byteOffset + offset, len).toString('utf8');
}

async function handle(id, payloadStr) {
  let out;
  try {
    const body = JSON.parse(payloadStr);
    const resp = await fetch(cfg.url + '/rpc', {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json' },
        cfg.token ? { 'x-kardex-token': cfg.token } : {},
        cfg.node ? { 'x-kardex-node': cfg.node } : {}
      ),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
    const text = await resp.text();
    let j;
    try { j = JSON.parse(text); }
    catch (e) { j = { ok: false, error: 'Respuesta inválida del servidor (HTTP ' + resp.status + ')' }; }
    out = j && j.ok ? { ok: true, data: j.data } : { ok: false, error: (j && j.error) || 'Error del servidor' };
  } catch (e) {
    out = { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
  let outStr = JSON.stringify(out);
  let outBuf = Buffer.from(outStr, 'utf8');
  if (outBuf.length > resBytes.length - HEAD) {
    outStr = JSON.stringify({ ok: false, error: 'Respuesta demasiado grande para transferir (' + outBuf.length + ' bytes)' });
    outBuf = Buffer.from(outStr, 'utf8');
  }
  resBytes.set(outBuf, HEAD);
  Atomics.store(resView, 1, id);
  Atomics.store(resView, 2, outBuf.length);
  Atomics.store(resView, 0, 1);
  Atomics.notify(resView, 0, 1);
}

(async () => {
  while (true) {
    Atomics.wait(reqView, 0, 0);
    const state = Atomics.load(reqView, 0);
    if (state === 3) break;
    if (state !== 1) { Atomics.store(reqView, 0, 0); continue; }
    const id = Atomics.load(reqView, 1);
    const len = Atomics.load(reqView, 2);
    const payloadStr = readStr(reqBytes, HEAD, len);
    Atomics.store(reqView, 0, 0);
    try { await handle(id, payloadStr); }
    catch (e) { /* el worker no debe morir por un error */ }
  }
})();
`;

function destroyWorker() {
  if (worker) {
    try { worker.terminate(); } catch (e) { /* noop */ }
  }
  worker = null;
  reqView = resView = reqBytes = resBytes = null;
}

function ensureWorker() {
  if (!url) throw new Error('Cliente de servidor no configurado');
  if (worker) return;
  const req = new SharedArrayBuffer(BUF_SIZE);
  const res = new SharedArrayBuffer(BUF_SIZE);
  reqView = new Int32Array(req, 0, 3);
  resView = new Int32Array(res, 0, 3);
  reqBytes = new Uint8Array(req);
  resBytes = new Uint8Array(res);
  worker = new Worker(WORKER_SRC, {
    eval: true,
    workerData: { req, res, cfg: { url, token, node: machineId(), timeoutMs: WORKER_TIMEOUT_MS } }
  });
  worker.on('error', (err) => {
    console.error('[KARDEX-RPC] error del worker:', err);
    destroyWorker();
  });
  worker.on('exit', () => { worker = null; });
}

function waitResponse(expectedId, msLeft) {
  const deadline = Date.now() + msLeft;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const w = Atomics.wait(resView, 0, 0, remaining);
    if (w === 'timed-out') return null;
    const rid = Atomics.load(resView, 1);
    const rlen = Atomics.load(resView, 2);
    const text = Buffer.from(resBytes.buffer, resBytes.byteOffset + HEAD, rlen).toString('utf8');
    Atomics.store(resView, 0, 0);
    if (rid === expectedId) return text;
    // Respuesta vieja (de una llamada que expiró): se ignora y se sigue esperando.
  }
}

function rpc(ns, method, args) {
  if (netCooldownUntil > Date.now() && netError) {
    throw new Error('Servidor no disponible: ' + netError);
  }
  ensureWorker();
  const id = nextId++;
  const payload = JSON.stringify({ ns: ns || null, method, args: args || [] });
  const payloadBuf = Buffer.from(payload, 'utf8');
  if (payloadBuf.length > BUF_SIZE - HEAD) {
    throw new Error('Solicitud demasiado grande');
  }
  reqBytes.set(payloadBuf, HEAD);
  Atomics.store(reqView, 2, payloadBuf.length);
  Atomics.store(reqView, 1, id);
  Atomics.store(reqView, 0, REQ_READY);
  Atomics.notify(reqView, 0, 1);

  const text = waitResponse(id, MAIN_WAIT_MS);
  if (text == null) {
    throw new Error('El servidor no respondió (tiempo de espera agotado)');
  }
  let j;
  try { j = JSON.parse(text); }
  catch (e) { throw new Error('Respuesta inválida del servidor'); }
  if (!j.ok) {
    const err = new Error(j.error || 'Error del servidor');
    if (/fetch|ECONN|network|socket|abort|no respondió/i.test(String(j.error)) || String(j.error).includes('Servidor no disponible')) {
      netError = j.error;
      netCooldownUntil = Date.now() + NET_COOLDOWN_MS;
    }
    throw err;
  }
  return j.data;
}

function configure(opts) {
  const newUrl = opts && opts.url ? String(opts.url).trim().replace(/\/+$/, '') : null;
  const newToken = opts && opts.token ? String(opts.token) : '';
  if (newUrl !== url || newToken !== token) {
    url = newUrl;
    token = newToken;
    netError = null;
    netCooldownUntil = 0;
    destroyWorker();
  }
}

async function ping() {
  if (!url) return { ok: false, error: 'Sin dirección de servidor configurada' };
  try {
    const resp = await fetch(url + '/ping', {
      signal: AbortSignal.timeout(6000),
      headers: token ? { 'x-kardex-token': token } : {}
    });
    const text = await resp.text();
    const j = JSON.parse(text);
    return resp.ok ? { ok: true, data: j } : { ok: false, error: (j && j.error) || 'HTTP ' + resp.status };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function open() {
  const p = await ping();
  if (!p.ok) throw new Error('No se pudo conectar al servidor: ' + p.error);
  return true;
}

function close() { /* la persistencia la maneja el servidor */ }
function persistNow() { return rpc(null, 'persistNow', []); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const calc = crypto.scryptSync(String(password), parts[1], 64).toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(parts[2], 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function makeNs(name, methods) {
  const ns = {};
  for (const m of methods) ns[m] = function () { return rpc(name, m, Array.from(arguments)); };
  return ns;
}

module.exports = {
  configure, open, close, persistNow,
  hashPassword, verifyPassword, nowIso, ping,
  auth: makeNs('auth', ['login']),
  users: makeNs('users', ['list', 'get', 'create', 'update', 'delete', 'countAdmins']),
  employees: makeNs('employees', ['list', 'get', 'stats', 'setStatus', 'create', 'update', 'delete']),
  horasExtra: makeNs('horasExtra', ['get', 'listForPeriod', 'save']),
  liquidaciones: makeNs('liquidaciones', ['listForEmployee', 'listAll', 'save', 'delete']),
  incentivos: makeNs('incentivos', ['listForPeriod', 'list', 'create', 'update', 'delete']),
  pagoVacaciones: makeNs('pagoVacaciones', ['get', 'listForPeriod', 'totalDiasPagados', 'save', 'delete']),
  vacaciones: makeNs('vacaciones', ['list', 'create', 'delete']),
  reportes: makeNs('reportes', ['plantilla', 'antiguedad', 'cumpleanos', 'departamentos']),
  audit: makeNs('audit', ['add', 'list']),
  mailLog: makeNs('mailLog', ['add', 'list']),
  contactos: makeNs('contactos', ['list', 'get', 'create', 'update', 'delete']),
  settings: makeNs('settings', ['get', 'set']),
  historial: makeNs('historial', ['list', 'log', 'logCreate', 'logUpdate']),
  backups: makeNs('backups', ['dir', 'create', 'list', 'restore'])
};
