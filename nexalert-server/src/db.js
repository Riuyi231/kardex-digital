'use strict';
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'nexalert-server.db');
const fs = require('fs');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function nowUTC() {
  return new Date().toISOString();
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fechaLocalUTC(s) {
  if (!s) return nowUTC();
  const d = new Date(s);
  if (isNaN(d.getTime())) return nowUTC();
  return d.toISOString();
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispositivos (
      token TEXT PRIMARY KEY,
      nombre TEXT DEFAULT '',
      creado TEXT
    );

    CREATE TABLE IF NOT EXISTS tecnicos (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE,
      pass_hash TEXT,
      activo INTEGER DEFAULT 1,
      rol TEXT DEFAULT 'tecnico',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reportes (
      id INTEGER PRIMARY KEY,
      client_id INTEGER,
      client_nombre TEXT DEFAULT '',
      equipo_nombre TEXT DEFAULT '',
      descripcion TEXT NOT NULL DEFAULT '',
      fecha TEXT DEFAULT '',
      estado TEXT DEFAULT 'abierto',
      prioridad TEXT DEFAULT 'normal',
      solucion TEXT DEFAULT '',
      tecnico_id INTEGER,
      tecnico_nombre TEXT DEFAULT '',
      resuelto_at TEXT,
      archivado INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      adjuntos TEXT DEFAULT '[]',
      lat REAL,
      lng REAL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporte_id INTEGER NOT NULL,
      autor TEXT DEFAULT '',
      texto TEXT NOT NULL,
      creado TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fotos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporte_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      tipo TEXT DEFAULT 'image/jpeg',
      datos BLOB,
      autor TEXT DEFAULT '',
      creado TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seq_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      extra TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS reporte_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporte_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      detalle TEXT DEFAULT '',
      autor TEXT DEFAULT '',
      creado TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eventos_rid ON reporte_eventos (reporte_id);
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      tecnico_id INTEGER,
      creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporte_id INTEGER NOT NULL,
      enviado_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminder_rid ON reminder_log (reporte_id);
  `);
  const rpCols = db.prepare('PRAGMA table_info(reportes)').all().map((c) => c.name);
  if (!rpCols.includes('adjuntos')) db.exec('ALTER TABLE reportes ADD COLUMN adjuntos TEXT DEFAULT \'[]\'');
  if (!rpCols.includes('lat')) db.exec('ALTER TABLE reportes ADD COLUMN lat REAL');
  if (!rpCols.includes('lng')) db.exec('ALTER TABLE reportes ADD COLUMN lng REAL');
  const techCols = db.prepare('PRAGMA table_info(tecnicos)').all().map((c) => c.name);
  if (!techCols.includes('rol')) db.exec("ALTER TABLE tecnicos ADD COLUMN rol TEXT DEFAULT 'tecnico'");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fotos_rn ON fotos (reporte_id, nombre)');
}

function getSetting(key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pass), salt, 32).toString('hex');
  return salt + ':' + hash;
}

function verifyPass(pass, stored) {
  if (!stored) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(pass), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}

function seq(tipo, refId, extra) {
  const r = db.prepare('INSERT INTO seq_log (tipo, ref_id, extra) VALUES (?, ?, ?)').run(tipo, refId, extra || '');
  return Number(r.lastInsertRowid);
}

function lastSeq() {
  const r = db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM seq_log').get();
  return Number(r.s);
}

function arrAdjuntos(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch (e) { return []; }
}

function reportePublico(r) {
  return {
    id: r.id,
    client_id: r.client_id,
    client_nombre: r.client_nombre,
    equipo_nombre: r.equipo_nombre,
    descripcion: r.descripcion,
    fecha: r.fecha,
    estado: r.estado,
    prioridad: r.prioridad,
    solucion: r.solucion,
    tecnico_id: r.tecnico_id,
    tecnico_nombre: r.tecnico_nombre,
    resuelto_at: r.resuelto_at,
    archivado: r.archivado,
    adjuntos: arrAdjuntos(r.adjuntos),
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    updated_at: r.updated_at
  };
}

function upsertReporte(rp) {
  const id = Number(rp.id);
  const existing = db.prepare('SELECT id, updated_at, adjuntos FROM reportes WHERE id = ?').get(id);
  const pushedAt = fechaLocalUTC(rp.updated_at || rp.creado);
  if (existing && existing.updated_at >= pushedAt) {
    return { applied: false, id };
  }
  const deleted = rp.deleted ? 1 : 0;
  const incomingAdj = Array.isArray(rp.adjuntos) ? rp.adjuntos : (rp.adjuntos ? arrAdjuntos(rp.adjuntos) : []);
  const serverAdj = existing ? arrAdjuntos(existing.adjuntos) : [];
  const merged = [...new Set([...serverAdj, ...incomingAdj])];
  const adjuntos = JSON.stringify(merged);
  db.prepare(`
    INSERT INTO reportes (id, client_id, client_nombre, equipo_nombre, descripcion, fecha, estado, prioridad,
      solucion, tecnico_id, tecnico_nombre, resuelto_at, archivado, deleted, adjuntos, lat, lng, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_id = excluded.client_id,
      client_nombre = excluded.client_nombre,
      equipo_nombre = excluded.equipo_nombre,
      descripcion = excluded.descripcion,
      fecha = excluded.fecha,
      estado = excluded.estado,
      prioridad = excluded.prioridad,
      solucion = excluded.solucion,
      tecnico_id = excluded.tecnico_id,
      tecnico_nombre = excluded.tecnico_nombre,
      resuelto_at = excluded.resuelto_at,
      archivado = excluded.archivado,
      deleted = excluded.deleted,
      adjuntos = excluded.adjuntos,
      lat = COALESCE(excluded.lat, reportes.lat),
      lng = COALESCE(excluded.lng, reportes.lng),
      updated_at = excluded.updated_at
  `).run(id, rp.client_id || null, rp.client_nombre || '', rp.equipo_nombre || '', String(rp.descripcion || ''),
    rp.fecha || '', rp.estado || 'abierto', rp.prioridad || 'normal', rp.solucion || '',
    rp.tecnico_id || null, rp.tecnico_nombre || '', rp.resuelto_at || '', rp.archivado ? 1 : 0, deleted, adjuntos,
    rp.lat != null ? Number(rp.lat) : null, rp.lng != null ? Number(rp.lng) : null, pushedAt);
  seq('reporte_upsert', id, '');
  return { applied: true, id };
}

function upsertTecnico(t) {
  const id = Number(t.id);
  const nombre = String(t.nombre || '').trim();
  if (!nombre) return { applied: false, id };
  let usuario = String(t.usuario || '').trim();
  const pass = t.pass ? String(t.pass) : '';
  const rol = String(t.rol || 'tecnico');
  if (!usuario && !pass) {
    const existing = db.prepare('SELECT id FROM tecnicos WHERE id = ?').get(id);
    if (!existing) {
      usuario = slugUsuario(nombre, id);
    } else {
      return { applied: false, id };
    }
  }
  if (!usuario) usuario = slugUsuario(nombre, id);
  usuario = asegurarUnico(usuario, id);
  let passHash = null;
  if (pass === '__clear__') {
    passHash = null;
  } else if (pass) {
    passHash = hashPass(pass);
  } else {
    const cur = db.prepare('SELECT pass_hash FROM tecnicos WHERE id = ?').get(id);
    passHash = cur ? cur.pass_hash : null;
  }
  db.prepare(`
    INSERT INTO tecnicos (id, nombre, usuario, pass_hash, activo, rol, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nombre = excluded.nombre,
      usuario = excluded.usuario,
      pass_hash = excluded.pass_hash,
      activo = 1,
      rol = excluded.rol,
      updated_at = excluded.updated_at
  `).run(id, nombre, usuario, passHash, rol, nowUTC());
  seq('tecnico', id, '');
  return { applied: true, id, usuario };
}

function slugUsuario(nombre, id) {
  const base = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 16) || ('tecnico' + id);
  return base;
}

function asegurarUnico(usuario, id) {
  const clash = db.prepare('SELECT id FROM tecnicos WHERE usuario = ? AND id != ?').get(usuario, id);
  if (!clash) return usuario;
  let n = 2;
  while (db.prepare('SELECT id FROM tecnicos WHERE usuario = ? AND id != ?').get(usuario + n, id)) n++;
  return usuario + n;
}

function addNota(reporteId, autor, texto) {
  const rp = db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(reporteId);
  if (!rp) throw new Error('Reporte no encontrado');
  const creado = nowUTC();
  const r = db.prepare('INSERT INTO notas (reporte_id, autor, texto, creado) VALUES (?, ?, ?, ?)')
    .run(reporteId, autor || '', String(texto || '').trim(), creado);
  const notaId = Number(r.lastInsertRowid);
  db.prepare('UPDATE reportes SET updated_at = ? WHERE id = ?').run(creado, reporteId);
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(reporteId, 'nota', String(texto || '').trim().slice(0, 200), autor || '', creado);
  seq('nota', notaId, JSON.stringify({ reporte_id: reporteId }));
  return { id: notaId, reporte_id: reporteId, autor: autor || '', texto: String(texto || '').trim(), creado };
}

function setEstado(reporteId, estado, autor) {
  const ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'espera_repuesto', 'espera_cliente'];
  if (!ESTADOS.includes(estado)) throw new Error('Estado no válido');
  const rp = db.prepare('SELECT id, estado, resuelto_at FROM reportes WHERE id = ? AND deleted = 0').get(reporteId);
  if (!rp) throw new Error('Reporte no encontrado');
  let resueltoAt = rp.resuelto_at;
  const ahora = nowUTC();
  if (estado === 'resuelto') resueltoAt = rp.estado === 'resuelto' ? rp.resuelto_at : ahora;
  db.prepare('UPDATE reportes SET estado = ?, resuelto_at = ?, updated_at = ? WHERE id = ?')
    .run(estado, resueltoAt, ahora, reporteId);
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(reporteId, 'estado', JSON.stringify({ de: rp.estado, a: estado }), autor || '', ahora);
  seq('estado', reporteId, JSON.stringify({ estado, autor: autor || '', creado: ahora }));
  return { estado, resuelto_at: resueltoAt, updated_at: ahora };
}

function marcarBorrado(id, ts) {
  const updatedAt = fechaLocalUTC(ts);
  const existing = db.prepare('SELECT updated_at FROM reportes WHERE id = ?').get(id);
  if (existing && existing.updated_at >= updatedAt) return { applied: false };
  if (existing) {
    db.prepare('UPDATE reportes SET deleted = 1, updated_at = ? WHERE id = ?').run(updatedAt, id);
  } else {
    db.prepare('INSERT INTO reportes (id, descripcion, estado, deleted, updated_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, '', 'abierto', updatedAt);
  }
  seq('reporte_delete', id, '');
  return { applied: true };
}

function crearReporte(data) {
  const id = Number(data.id) || Date.now();
  const ahora = nowUTC();
  const tecnicoId = Number(data.tecnico_id) || null;
  const tecnicoNombre = data.tecnico_nombre || '';
  db.prepare(`
    INSERT INTO reportes (id, client_id, client_nombre, equipo_nombre, descripcion, fecha, estado,
      prioridad, solucion, tecnico_id, tecnico_nombre, resuelto_at, archivado, deleted, adjuntos, lat, lng, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'abierto', ?, '', ?, ?, NULL, 0, 0, '[]', ?, ?, ?)
  `).run(
    id,
    data.client_id || null,
    String(data.client_nombre || '').trim(),
    String(data.equipo_nombre || '').trim(),
    String(data.descripcion || '').trim(),
    data.fecha || ahora.slice(0, 10),
    data.prioridad || 'normal',
    tecnicoId,
    tecnicoNombre,
    data.lat != null ? Number(data.lat) : null,
    data.lng != null ? Number(data.lng) : null,
    ahora
  );
  seq('reporte_upsert', id, '');
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'creado', 'Reporte creado desde móvil', tecnicoNombre || '', ahora);
  return { id, created_at: ahora };
}

function addFoto(reporteId, nombre, tipo, datos, autor) {
  const rp = db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(reporteId);
  if (!rp) throw new Error('Reporte no encontrado');
  const nombreF = String(nombre || '').trim();
  if (!nombreF) throw new Error('Nombre de foto no válido');
  let base64Str = Buffer.isBuffer(datos) ? null : (typeof datos === 'string' ? datos : '');
  if (base64Str === '') throw new Error('Foto sin datos');
  if (base64Str !== null) {
    const comma = base64Str.indexOf(',');
    if (comma >= 0 && base64Str.slice(0, comma).includes(';base64')) base64Str = base64Str.slice(comma + 1);
  }
  const buf = Buffer.isBuffer(datos) ? datos : Buffer.from(base64Str, 'base64');
  if (!buf || !buf.length) throw new Error('Foto sin datos');
  if (buf.length > 8 * 1024 * 1024) throw new Error('La foto supera 8 MB');
  const exist = db.prepare('SELECT id FROM fotos WHERE reporte_id = ? AND nombre = ?').get(reporteId, nombreF);
  if (exist) return { applied: false, id: exist.id };
  const creado = nowUTC();
  const r = db.prepare('INSERT INTO fotos (reporte_id, nombre, tipo, datos, autor, creado) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reporteId, nombreF, String(tipo || 'image/jpeg'), buf, String(autor || ''), creado);
  const id = Number(r.lastInsertRowid);
  const rpAdj = db.prepare('SELECT adjuntos FROM reportes WHERE id = ?').get(reporteId);
  const adjNames = arrAdjuntos(rpAdj ? rpAdj.adjuntos : '[]');
  if (!adjNames.includes(nombreF)) {
    adjNames.push(nombreF);
    db.prepare('UPDATE reportes SET adjuntos = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(adjNames), creado, reporteId);
  } else {
    db.prepare('UPDATE reportes SET updated_at = ? WHERE id = ?').run(creado, reporteId);
  }
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(reporteId, 'foto', nombreF, String(autor || ''), creado);
  seq('foto', id, JSON.stringify({ reporte_id: reporteId, nombre: nombreF, autor: String(autor || '') }));
  return { applied: true, id, nombre: nombreF };
}

function deleteFoto(reporteId, nombre) {
  const nombreF = String(nombre || '').trim();
  if (!nombreF) throw new Error('Nombre de foto no válido');
  const f = db.prepare('SELECT id FROM fotos WHERE reporte_id = ? AND nombre = ?').get(reporteId, nombreF);
  if (!f) return { applied: false };
  db.prepare('DELETE FROM fotos WHERE id = ?').run(f.id);
  const rp = db.prepare('SELECT id, adjuntos FROM reportes WHERE id = ?').get(reporteId);
  if (rp) {
    const adj = arrAdjuntos(rp.adjuntos).filter((n) => n !== nombreF);
    const creado = nowUTC();
    db.prepare('UPDATE reportes SET adjuntos = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(adj), creado, reporteId);
    db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
      .run(reporteId, 'foto_del', nombreF, '', creado);
  }
  seq('foto_del', f.id, JSON.stringify({ reporte_id: reporteId, nombre: nombreF }));
  return { applied: true };
}

function fotoPublico(f) {
  let b64 = '';
  if (f.datos) {
    const buf = Buffer.isBuffer(f.datos) ? f.datos : Buffer.from(f.datos);
    b64 = buf.toString('base64');
  }
  return {
    id: f.id,
    reporte_id: f.reporte_id,
    nombre: f.nombre,
    tipo: f.tipo,
    datos: b64,
    autor: f.autor,
    creado: f.creado
  };
}

function fotosDeReporte(reporteId) {
  return db.prepare('SELECT * FROM fotos WHERE reporte_id = ? ORDER BY id ASC').all(reporteId);
}

function fotosCount(reporteId) {
  const r = db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE reporte_id = ?').get(reporteId);
  return Number(r ? r.n : 0);
}

function getHistorial(reporteId) {
  return db.prepare('SELECT * FROM reporte_eventos WHERE reporte_id = ? ORDER BY id ASC').all(reporteId);
}

function setUbicacion(reporteId, lat, lng) {
  const rp = db.prepare('SELECT id FROM reportes WHERE id = ? AND deleted = 0').get(reporteId);
  if (!rp) throw new Error('Reporte no encontrado');
  const ahora = nowUTC();
  db.prepare('UPDATE reportes SET lat = ?, lng = ?, updated_at = ? WHERE id = ?').run(lat, lng, ahora, reporteId);
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(reporteId, 'ubicacion', JSON.stringify({ lat, lng }), '', ahora);
  seq('reporte_upsert', reporteId, '');
  return { lat, lng, updated_at: ahora };
}

function getStats(tecnicoId) {
  const base = tecnicoId ? ' AND tecnico_id = ' + Number(tecnicoId) : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM reportes WHERE deleted = 0 AND archivado = 0' + base).get().n;
  const porEstado = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM reportes
    WHERE deleted = 0 AND archivado = 0${base}
    GROUP BY estado
  `).all();
  const resueltosRow = db.prepare(`
    SELECT AVG(julianday(resuelto_at) - julianday(fecha)) AS prom_dias, COUNT(*) AS n
    FROM reportes WHERE estado = 'resuelto' AND deleted = 0 AND archivado = 0 AND resuelto_at != '' AND fecha != ''${base}
  `).get();
  const porPrio = db.prepare(`
    SELECT prioridad, COUNT(*) AS n FROM reportes
    WHERE deleted = 0 AND archivado = 0${base}
    GROUP BY prioridad
  `).all();
  const ultimos7 = db.prepare(`
    SELECT COUNT(*) AS n FROM reportes
    WHERE deleted = 0 AND archivado = 0 AND fecha >= datetime('now', '-7 days')${base}
  `).get();
  return {
    total,
    porEstado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
    porPrio: Object.fromEntries(porPrio.map((r) => [r.prioridad, r.n])),
    promResolucionDias: resueltosRow && resueltosRow.prom_dias != null ? Math.round(resueltosRow.prom_dias * 10) / 10 : null,
    resueltos7d: ultimos7 ? ultimos7.n : 0
  };
}

function registerPushToken(token, tecnicoId) {
  const ahora = nowUTC();
  try {
    db.prepare('INSERT OR REPLACE INTO push_tokens (token, tecnico_id, creado) VALUES (?, ?, ?)').run(token, tecnicoId || null, ahora);
  } catch (e) { /* noop */ }
}

function getPushTokens(tecnicoId) {
  if (tecnicoId) {
    return db.prepare('SELECT token FROM push_tokens WHERE tecnico_id = ?').all(tecnicoId).map((r) => r.token);
  }
  return db.prepare('SELECT token FROM push_tokens').all().map((r) => r.token);
}

function getGerentePushTokens() {
  return db.prepare(`
    SELECT pt.token FROM push_tokens pt
    JOIN tecnicos t ON t.id = pt.tecnico_id
    WHERE t.rol = 'gerente' AND t.activo = 1
  `).all().map((r) => r.token);
}

function getReportesParaRecordatorio() {
  return db.prepare(`
    SELECT r.id, r.tecnico_id, r.tecnico_nombre, r.client_nombre, r.descripcion,
           r.asignado_at, r.fecha
    FROM reportes r
    WHERE r.deleted = 0
      AND r.archivado = 0
      AND r.tecnico_id IS NOT NULL
      AND r.tecnico_id != 0
      AND r.estado NOT IN ('resuelto', 'espera_repuesto', 'espera_cliente')
      AND r.asignado_at IS NOT NULL
      AND r.asignado_at != ''
      AND datetime(r.asignado_at, '+3 hours') <= datetime('now')
      AND NOT EXISTS (
        SELECT 1 FROM reminder_log rl
        WHERE rl.reporte_id = r.id
          AND datetime(rl.enviado_at, '+1 hour') > datetime('now')
      )
  `).all();
}

function logReminder(reporteId) {
  db.prepare('INSERT INTO reminder_log (reporte_id, enviado_at) VALUES (?, ?)').run(reporteId, nowUTC());
}

function cleanupOldReminders() {
  db.prepare("DELETE FROM reminder_log WHERE enviado_at < datetime('now', '-7 days')").run();
}

function getTecnicosList() {
  return db.prepare(`
    SELECT t.id, t.nombre, t.usuario, t.rol, t.activo,
      (SELECT COUNT(*) FROM reportes r WHERE r.tecnico_id = t.id AND r.deleted = 0 AND r.archivado = 0) AS total_reportes,
      (SELECT COUNT(*) FROM reportes r WHERE r.tecnico_id = t.id AND r.deleted = 0 AND r.archivado = 0 AND r.estado != 'resuelto') AS pendientes
    FROM tecnicos t WHERE t.activo = 1 ORDER BY t.nombre COLLATE NOCASE ASC
  `).all();
}

function getReportesAll() {
  const rows = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM fotos f WHERE f.reporte_id = r.id) AS fotos_count
    FROM reportes r
    WHERE r.deleted = 0 AND r.archivado = 0
    ORDER BY r.fecha DESC, r.id DESC
  `).all();
  return rows.map((r) => ({ ...reportePublico(r), fotos_count: Number(r.fotos_count || 0) }));
}

function asignarReporte(reporteId, tecnicoId, tecnicoNombre) {
  const now = nowUTC();
  db.prepare('UPDATE reportes SET tecnico_id = ?, tecnico_nombre = ?, updated_at = ? WHERE id = ?')
    .run(tecnicoId || null, tecnicoNombre || '', now, reporteId);
  seq('reporte_upsert', reporteId, '');
  db.prepare('INSERT INTO reporte_eventos (reporte_id, tipo, detalle, autor, creado) VALUES (?, ?, ?, ?, ?)')
    .run(reporteId, 'tecnico', 'Reasignado a ' + (tecnicoNombre || 'Sin asignar') + '.', 'Gerente', now);
  return reportePublico(db.prepare('SELECT * FROM reportes WHERE id = ?').get(reporteId));
}

function getStatsGlobal() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM reportes WHERE deleted = 0 AND archivado = 0').get().n;
  const porEstado = db.prepare("SELECT estado, COUNT(*) AS n FROM reportes WHERE deleted = 0 AND archivado = 0 GROUP BY estado").all();
  const porTecnico = db.prepare(`
    SELECT t.id, t.nombre,
      (SELECT COUNT(*) FROM reportes r WHERE r.tecnico_id = t.id AND r.deleted = 0 AND r.archivado = 0) AS total,
      (SELECT COUNT(*) FROM reportes r WHERE r.tecnico_id = t.id AND r.deleted = 0 AND r.archivado = 0 AND r.estado != 'resuelto') AS pendientes,
      (SELECT COUNT(*) FROM reportes r WHERE r.tecnico_id = t.id AND r.deleted = 0 AND r.archivado = 0 AND r.estado = 'resuelto') AS resueltos
    FROM tecnicos t WHERE t.activo = 1 ORDER BY t.nombre COLLATE NOCASE ASC
  `).all();
  return {
    total,
    porEstado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
    porTecnico: porTecnico
  };
}

function autoArchiveResolved() {
  const ahora = nowUTC();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = db.prepare(`
    SELECT id FROM reportes WHERE deleted = 0 AND archivado = 0 AND estado = 'resuelto' AND resuelto_at IS NOT NULL AND resuelto_at <= ?
  `).all(cutoff);
  const st = db.prepare('UPDATE reportes SET archivado = 1, updated_at = ? WHERE id = ?');
  let count = 0;
  for (const r of rows) {
    st.run(ahora, r.id);
    seq('reporte_archive', r.id, '');
    count++;
  }
  return count;
}

module.exports = {
  db, init, nowUTC, hashPass, verifyPass, seq, lastSeq,
  getSetting, setSetting, reportePublico, arrAdjuntos,
  upsertReporte, upsertTecnico, addNota, setEstado, marcarBorrado,
  addFoto, deleteFoto, fotoPublico, fotosDeReporte, fotosCount,
  getHistorial, setUbicacion, getStats, registerPushToken, getPushTokens, getGerentePushTokens,
  crearReporte, getReportesParaRecordatorio, logReminder, cleanupOldReminders,
  getTecnicosList, getReportesAll, asignarReporte, getStatsGlobal, autoArchiveResolved
};
