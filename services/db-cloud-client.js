'use strict';
const { Worker } = require('worker_threads');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const HEAD = 12;
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
const http = require('http');
const https = require('https');
const { URL } = require('url');
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

function httpRequest(method, urlStr, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const opts = {
      method: method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers: headers || {},
      timeout: timeoutMs || 8000
    };
    const req2 = mod.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => {
        resolve({ status: resp.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout HTTP')); });
    req2.on('error', reject);
    if (body) req2.write(body);
    req2.end();
  });
}

async function handle(id, payloadStr) {
  let out;
  try {
    const resp = await httpRequest('POST', cfg.url + '/api/rpc', {
      'content-type': 'application/json',
      'authorization': cfg.token ? 'Bearer ' + cfg.token : ''
    }, payloadStr, cfg.timeoutMs);
    let j;
    const retryable = resp.status === 429 || resp.status === 503 || resp.status === 408;
    try { j = JSON.parse(resp.text); }
    catch (e) {
      j = retryable
        ? { ok: false, error: 'El servidor está ocupado, espere unos segundos (HTTP ' + resp.status + ')' }
        : { ok: false, error: 'Respuesta invalida del servidor (HTTP ' + resp.status + ')' };
    }
    if (!j.retryable && retryable) j.retryable = true;
    out = j && j.ok ? { ok: true, data: j.data }
      : { ok: false, error: (j && j.error) || 'Error del servidor', retryable: !!(j && j.retryable), status: resp.status };
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    out = { ok: false, error: msg, retryable: true };
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
    catch (e) { /* el worker no debe morir */ }
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
  if (!url) throw new Error('Cliente cloud no configurado');
  if (worker) return;
  const req = new SharedArrayBuffer(BUF_SIZE);
  const res = new SharedArrayBuffer(BUF_SIZE);
  reqView = new Int32Array(req, 0, 3);
  resView = new Int32Array(res, 0, 3);
  reqBytes = new Uint8Array(req);
  resBytes = new Uint8Array(res);
  worker = new Worker(WORKER_SRC, {
    eval: true,
    workerData: { req, res, cfg: { url, token, timeoutMs: WORKER_TIMEOUT_MS } }
  });
  worker.on('error', (err) => {
    console.error('[KARDEX-CLOUD] error del worker:', err);
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
  }
}

const sleepView = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(sleepView, 0, 0, ms);
}

function doRpcOnce(ns, method, args) {
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
  if (text == null) throw Object.assign(new Error('El servidor cloud no respondio (tiempo de espera agotado)'), { retryable: true });
  let j;
  try { j = JSON.parse(text); }
  catch (e) { throw new Error('Respuesta invalida del servidor cloud'); }
  if (!j.ok) {
    const err = new Error(j.error || 'Error del servidor cloud');
    err.retryable = !!(j && j.retryable);
    if (j && (j.retryable || /fetch|ECONN|network|socket|abort|no respondio|ocupado/i.test(String(j.error)))) {
      netError = j.error;
      netCooldownUntil = Date.now() + NET_COOLDOWN_MS;
    }
    throw err;
  }
  return j.data;
}

function rpc(ns, method, args) {
  if (netCooldownUntil > Date.now() && netError) {
    throw new Error('Servidor cloud no disponible: ' + netError);
  }
  let attempt = 0;
  for (;;) {
    try {
      const data = doRpcOnce(ns, method, args);
      if (netError) { netError = null; netCooldownUntil = 0; }
      return data;
    } catch (e) {
      if (!e.retryable || attempt >= 2) throw e;
      const wait = Math.min(1500, 350 * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
      sleepSync(wait);
      attempt++;
    }
  }
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
  if (!url) return { ok: false, error: 'Sin direccion de servidor cloud configurada' };
  try {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? require('https') : require('http');
    const resp = await new Promise((resolve, reject) => {
      const req2 = mod.request({
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: '/api/ping',
        timeout: 6000
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
      req2.on('error', reject);
      req2.end();
    });
    const j = JSON.parse(resp.text);
    return resp.status === 200 ? { ok: true, data: j } : { ok: false, error: (j && j.error) || 'HTTP ' + resp.status };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function cloudLogin(username, password) {
  if (!url) throw new Error('Sin servidor cloud configurado');
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const mod = isHttps ? require('https') : require('http');
  const body = JSON.stringify({ username, password });
  const resp = await new Promise((resolve, reject) => {
    const req2 = mod.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: '/api/auth/login',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: 8000
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
    req2.on('error', reject);
    req2.write(body);
    req2.end();
  });
  const j = JSON.parse(resp.text);
  if (!j.ok) throw new Error(j.error || 'Error al autenticar');
  token = j.token;
  netError = null;
  netCooldownUntil = 0;
  destroyWorker();
  return { user: j.user, token: j.token };
}

async function open() {
  const p = await ping();
  if (!p.ok) throw new Error('No se pudo conectar al servidor cloud: ' + p.error);
  return true;
}

function close() { /* persistencia la maneja el servidor */ }
function persistNow() { return rpc(null, 'persistNow', []); }

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
  nowIso, ping, cloudLogin,
  auth: makeNs('auth', ['login']),
  users: makeNs('users', ['list', 'get', 'create', 'update', 'delete', 'countAdmins']),
  employees: makeNs('employees', ['list', 'get', 'stats', 'setStatus', 'create', 'update', 'delete']),
  horasExtra: makeNs('horasExtra', ['get', 'listForPeriod', 'save']),
  liquidaciones: makeNs('liquidaciones', ['listForEmployee', 'listAll', 'save', 'delete']),
  incentivos: makeNs('incentivos', ['listForPeriod', 'list', 'create', 'update', 'delete']),
  deduccionesManuales: makeNs('deduccionesManuales', ['listForPeriod', 'listForEmployee', 'create', 'update', 'delete']),
  salarioHistorial: makeNs('salarioHistorial', ['listForEmployee', 'record', 'getSalarioPromedio', 'resetBaseline', 'getRegaliaMasivo']),
  pagoVacaciones: makeNs('pagoVacaciones', ['get', 'listForPeriod', 'totalDiasPagados', 'save', 'delete']),
  vacaciones: makeNs('vacaciones', ['list', 'create', 'delete']),
  reportes: makeNs('reportes', ['plantilla', 'antiguedad', 'cumpleanos', 'departamentos', 'nominaDepartamentos', 'empleadosCompleto', 'cedulasVencer', 'aniversarios', 'beneficios']),
  audit: makeNs('audit', ['add', 'list']),
  mailLog: makeNs('mailLog', ['add', 'list']),
  contactos: makeNs('contactos', ['list', 'get', 'create', 'update', 'delete']),
  settings: makeNs('settings', ['get', 'set']),
  historial: makeNs('historial', ['list']),
  backups: makeNs('backups', ['list', 'create', 'restore'])
};
