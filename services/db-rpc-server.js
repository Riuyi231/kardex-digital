'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { NS_METHODS, TOP_METHODS } = require('./db-api');

let server = null;
let chain = Promise.resolve();
let currentPort = null;
let currentToken = '';
let currentDataDir = '.';
let currentMaxNodes = 0;
let currentMaxEmployees = 0;

// Registro de nodos (puestos). Cada equipo KARDEX se identifica por su
// machineId (cabecera x-kardex-node) y ocupa un puesto mientras esté activo.
// currentMaxNodes = 0 significa "sin límite" (licencias viejas / modo local).
const NODE_LEASE_MS = 10 * 60 * 1000; // 10 min sin actividad libera el puesto
const PRUNE_INTERVAL_MS = 60 * 1000;
const nodes = new Map();
let pruneTimer = null;

function pruneNodes() {
  const now = Date.now();
  for (const [id, n] of nodes) {
    if (now - n.lastSeen > NODE_LEASE_MS) nodes.delete(id);
  }
}

function listNodes() {
  const now = Date.now();
  return Array.from(nodes.values())
    .map((n) => ({ ...n, active: now - n.lastSeen <= NODE_LEASE_MS }))
    .sort((a, b) => a.firstSeen - b.firstSeen);
}

// Registra/renueva el puesto del nodo. Devuelve { id } si puede conectarse,
// { denied: true } si la licencia ya tiene todos sus puestos ocupados.
function touchNode(nodeId, addr) {
  const id = String(nodeId || '').trim().slice(0, 80);
  if (!id) return null; // cliente sin identificar: no ocupa puesto
  pruneNodes();
  const now = Date.now();
  const existing = nodes.get(id);
  if (existing) {
    existing.lastSeen = now;
    existing.addr = addr;
    return { id };
  }
  if (currentMaxNodes > 0 && nodes.size >= currentMaxNodes) {
    return { id, denied: true };
  }
  nodes.set(id, { id, firstSeen: now, lastSeen: now, addr });
  return { id };
}

function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.then(() => undefined, () => undefined);
  return p;
}

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let destroyed = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        destroyed = true;
        req.destroy();
        reject(new Error('Solicitud demasiado grande'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!destroyed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function execute(ns, method, args) {
  const target = ns == null ? db : db[ns];
  if (!target) throw new Error('Espacio no válido: ' + ns);
  const allowed = ns == null ? TOP_METHODS : NS_METHODS[ns];
  if (!allowed || !allowed.includes(method)) {
    throw new Error('Operación no permitida: ' + (ns ? ns + '.' : '') + method);
  }
  if (typeof target[method] !== 'function') {
    throw new Error('Operación no disponible: ' + method);
  }
  return target[method].apply(target, args || []);
}

// Valida el tope de empleados activos de la licencia antes de operaciones que
// aumentan la plantilla. currentMaxEmployees = 0 significa "sin límite".
function assertEmployeeCapacity(ns, method, args) {
  if (currentMaxEmployees <= 0) return;
  const a = args || [];
  if (ns === 'employees' && method === 'create') {
    const activos = db.employees.stats().activos;
    if (activos + 1 > currentMaxEmployees) {
      throw new Error('Límite de empleados alcanzado: la licencia del servidor permite ' + currentMaxEmployees +
        ' empleado(s) activo(s) y ya hay ' + activos + '. Contacta al proveedor para aumentar el límite.');
    }
  }
  if (ns === 'employees' && method === 'setStatus') {
    const id = Number(a[0]);
    const status = String(a[1] || '');
    if (status === 'activo') {
      const rec = db.employees.get(id);
      if (rec && rec.status !== 'activo') {
        const activos = db.employees.stats().activos;
        if (activos + 1 > currentMaxEmployees) {
          throw new Error('Límite de empleados alcanzado: la licencia del servidor permite ' + currentMaxEmployees +
            ' empleado(s) activo(s) y ya hay ' + activos + '. Contacta al proveedor para aumentar el límite.');
        }
      }
    }
  }
}

function json(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function handleRequest(req, res, cfg) {
  if (req.method === 'GET' && req.url === '/ping') {
    if (currentToken && !sameToken(String(req.headers['x-kardex-token'] || ''), currentToken)) {
      json(res, 401, { ok: false, error: 'Token no autorizado' });
      return;
    }
    json(res, 200, { ok: true, name: 'kardex-digital-server', port: currentPort });
    return;
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    if (currentToken && !sameToken(String(req.headers['x-kardex-token'] || ''), currentToken)) {
      json(res, 401, { ok: false, error: 'Token no autorizado' });
      return;
    }
    const node = touchNode(req.headers['x-kardex-node'], req.socket.remoteAddress);
    if (node && node.denied) {
      json(res, 403, {
        ok: false,
        error: 'Límite de puestos alcanzado: la licencia del servidor permite ' + currentMaxNodes +
          ' puesto(s) de red y todos están ocupados. El equipo #' + node.id +
          ' no puede conectarse. Contacta al proveedor para aumentar los puestos.'
      });
      return;
    }
    let body;
    try {
      body = await readBody(req, cfg.bodyLimit);
    } catch (e) {
      json(res, 400, { ok: false, error: 'Error leyendo la solicitud' });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      json(res, 400, { ok: false, error: 'JSON inválido' });
      return;
    }
    const { ns, method, args } = parsed || {};
    try {
      const data = await enqueue(() => {
        assertEmployeeCapacity(ns, method, args);
        return execute(ns, method, args || []);
      });
      json(res, 200, { ok: true, data });
    } catch (e) {
      json(res, 200, { ok: false, error: (e && e.message) ? e.message : String(e) });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'No encontrado' });
}

async function start(opts = {}) {
  const cfg = {
    port: Number(opts.port) || 18006,
    host: opts.host || '0.0.0.0',
    token: String(opts.token || ''),
    dataDir: opts.dataDir || '.',
    maxNodes: Number(opts.maxNodes) || 0,
    maxEmployees: Number(opts.maxEmployees) || 0,
    bodyLimit: Number(opts.bodyLimit) || 64 * 1024 * 1024
  };
  currentToken = cfg.token;
  currentDataDir = cfg.dataDir;
  currentMaxNodes = cfg.maxNodes;
  currentMaxEmployees = cfg.maxEmployees;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  await db.open(path.join(cfg.dataDir, 'kardex.db'));
  server = http.createServer((req, res) => {
    handleRequest(req, res, cfg).catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Error interno del servidor' });
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, resolve);
  });
  currentPort = cfg.port;
  pruneTimer = setInterval(pruneNodes, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
  console.log('[KARDEX-SRV] Servidor escuchando en', cfg.host + ':' + cfg.port, '· datos en', cfg.dataDir,
    cfg.token ? '· token requerido' : '· sin token',
    cfg.maxNodes > 0 ? ('· máx ' + cfg.maxNodes + ' puesto(s) de red') : '· puestos ilimitados',
    cfg.maxEmployees > 0 ? ('· máx ' + cfg.maxEmployees + ' empleado(s) activo(s)') : '· empleados ilimitados');
  return { port: cfg.port, dataDir: cfg.dataDir };
}

function setToken(token) {
  currentToken = String(token || '');
  return currentToken;
}

function getStatus() {
  return {
    port: currentPort,
    token: currentToken,
    tokenRequired: !!currentToken,
    dataDir: currentDataDir,
    maxNodes: currentMaxNodes,
    maxEmployees: currentMaxEmployees,
    nodeCount: nodes.size,
    nodes: listNodes()
  };
}

// Respaldo automático diario ejecutado por el propio servidor, sin depender de
// que un cliente esté conectado. Devuelve null si no toca hoy.
function autoBackupIfDue() {
  try {
    if (db.settings.get('backup_auto') !== 'true') return null;
    const today = new Date().toISOString().slice(0, 10);
    if (db.settings.get('last_auto_backup') === today) return null;
    const b = db.backups.create(true);
    db.settings.set('last_auto_backup', today);
    return b;
  } catch (e) {
    console.error('[KARDEX-SRV] Error en respaldo automático:', e);
    return null;
  }
}

async function close() {
  if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
  if (server) {
    try { server.closeAllConnections(); } catch (e) { /* noop */ }
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1500);
    });
    server = null;
  }
  try { db.close(); } catch (e) { /* noop */ }
  nodes.clear();
  currentPort = null;
  currentToken = '';
  currentMaxNodes = 0;
  currentMaxEmployees = 0;
}

process.on('SIGINT', () => { close().then(() => process.exit(0)); });
process.on('SIGTERM', () => { close().then(() => process.exit(0)); });

module.exports = { start, close, setToken, getStatus, autoBackupIfDue };
