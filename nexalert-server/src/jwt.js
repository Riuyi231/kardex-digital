'use strict';
const crypto = require('crypto');
const d = require('./db');

function obtenerSecreto() {
  let s = d.getSetting('jwt_secret', '');
  if (!s) {
    s = crypto.randomBytes(48).toString('hex');
    d.setSetting('jwt_secret', s);
  }
  return s;
}

const JWT_SECRET = obtenerSecreto();
const TOKEN_TTL = 60 * 60 * 24 * 30;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const head = b64url(Buffer.from(JSON.stringify(header)));
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest();
  return head + '.' + body + '.' + b64url(sig);
}

function verify(token) {
  try {
    const [head, body, sig] = String(token).split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest();
    const givenRaw = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (!crypto.timingSafeEqual(givenRaw, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (!payload.iat || Date.now() / 1000 - payload.iat > TOKEN_TTL) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function requireAuth(rol) {
  return (req, res, next) => {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = verify(tok);
    if (!payload) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const userRol = payload.rol || 'tecnico';
    if (rol && userRol !== rol && userRol !== 'gerente') return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    req.user = payload;
    next();
  };
}

function loginTecnico(usuario, pass) {
  const t = d.db.prepare('SELECT * FROM tecnicos WHERE usuario = ? AND activo = 1').get(usuario);
  if (!t || !d.verifyPass(pass, t.pass_hash)) return null;
  const rol = t.rol || 'tecnico';
  const token = sign({ rol, sub: t.id, nombre: t.nombre });
  return { token, tecnico: { id: t.id, nombre: t.nombre, usuario: t.usuario, rol } };
}

function deviceToken(nombre) {
  const token = crypto.randomBytes(32).toString('hex');
  d.db.prepare('INSERT INTO dispositivos (token, nombre, creado) VALUES (?, ?, ?)').run(token, nombre || 'NexAlert', d.nowUTC());
  return token;
}

function requireDevice(req, res, next) {
  const token = String(req.body && req.body.deviceToken || req.query.deviceToken || '').trim();
  const dev = token ? d.db.prepare('SELECT token FROM dispositivos WHERE token = ?').get(token) : null;
  if (!dev) return res.status(401).json({ ok: false, error: 'Dispositivo no autorizado' });
  req.deviceToken = token;
  next();
}

module.exports = { sign, verify, requireAuth, requireDevice, loginTecnico, deviceToken };
