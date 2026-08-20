'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { machineId } = require('./machine');
const { PUBLIC_KEY_PEM } = require('./license-pub');

const TRIAL_DAYS = 15;

// Programa cubierto por esta aplicación. Las licencias llevan un campo
// `programs` (ej: ['nexalert'], ['kardex'], ['kardex','nexalert'] para combos).
const PROGRAM = 'nexalert';

let storePath = null;

function setStorePath(p) {
  storePath = p;
}

function storeFile() {
  return storePath || path.join(process.cwd(), 'nexalert-license.json');
}

function loadState() {
  const f = storeFile();
  try {
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
      return { activatedKey: String(j.activatedKey || ''), trialStarted: Number(j.trialStarted) || 0 };
    }
  } catch (e) { /* archivo corrupto */ }
  return { activatedKey: '', trialStarted: 0 };
}

function saveState(s) {
  const f = storeFile();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ activatedKey: s.activatedKey || '', trialStarted: s.trialStarted || Date.now() }, null, 2));
  } catch (e) { /* noop */ }
}

// Verifica la firma, vencimiento y vínculo a máquina de una clave de licencia.
function verifyKey(key) {
  try {
    const raw = String(key || '').trim();
    if (!raw) return { valid: false, reason: 'Clave vacía' };
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const payload = obj && obj.p;
    const sigHex = obj && obj.s;
    if (!payload || typeof payload !== 'object' || typeof sigHex !== 'string') {
      return { valid: false, reason: 'Formato de clave inválido' };
    }
    const canonical = JSON.stringify(payload);
    const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), PUBLIC_KEY_PEM, Buffer.from(sigHex, 'hex'));
    if (!ok) return { valid: false, reason: 'Clave no válida (firma incorrecta)' };
    if (payload.v !== 1) return { valid: false, reason: 'Versión de licencia no soportada' };
    // Claves emitidas antes del campo `programs` no cubren NEXALERT.
    const progs = (Array.isArray(payload.programs) && payload.programs.length)
      ? payload.programs.map(String)
      : [];
    if (!progs.includes(PROGRAM)) return { valid: false, reason: 'La licencia no incluye el programa NEXALERT' };
    if (payload.expires) {
      const exp = new Date(String(payload.expires) + 'T23:59:59');
      if (isNaN(exp.getTime()) || Date.now() > exp.getTime()) {
        return { valid: false, reason: 'Licencia vencida (' + payload.expires + ')' };
      }
    }
    if (payload.machine) {
      const mid = machineId();
      if (String(payload.machine) !== mid) {
        return { valid: false, reason: 'Licencia asignada a otra computadora' };
      }
    }
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: 'Clave no válida' };
  }
}

function trialInfo(state) {
  const started = state.trialStarted || Date.now();
  const msLeft = started + TRIAL_DAYS * 86400000 - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
  return { started, totalDays: TRIAL_DAYS, daysLeft, expired: msLeft <= 0 };
}

function getStatus() {
  const state = loadState();
  if (!state.trialStarted) {
    state.trialStarted = Date.now();
    saveState(state);
  }
  const trial = trialInfo(state);
  if (state.activatedKey) {
    const r = verifyKey(state.activatedKey);
    if (r.valid) return { activated: true, valid: true, license: r.payload, trial };
    return { activated: true, valid: false, reason: r.reason, trial };
  }
  return { activated: false, valid: false, reason: 'No hay licencia activada', trial };
}

// ¿La app puede usarse? (licencia válida o periodo de prueba vigente).
function canUse() {
  const s = getStatus();
  if (s.valid) return { ok: true };
  if (s.trial && !s.trial.expired) return { ok: true, trial: s.trial };
  return { ok: false, reason: s.reason || (s.trial && s.trial.expired ? 'Periodo de prueba vencido' : 'Sin licencia') };
}

// Activa y guarda una clave. Lanza Error con el motivo si no es válida.
function activate(key) {
  const r = verifyKey(key);
  if (!r.valid) throw new Error(r.reason);
  const state = loadState();
  state.activatedKey = String(key).trim();
  saveState(state);
  return r.payload;
}

// Quita la licencia activada y vuelve al modo de prueba.
function deactivate() {
  const state = loadState();
  state.activatedKey = '';
  saveState(state);
}

module.exports = { TRIAL_DAYS, PROGRAM, setStorePath, machineId, verifyKey, getStatus, canUse, activate, deactivate, trialInfo };
