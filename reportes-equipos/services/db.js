'use strict';
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const STATE = { db: null, sql: null, dbFile: null };

async function open(file) {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });
  STATE.sql = SQL;
  STATE.dbFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  STATE.db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  migrate();
  persist();
}

function close() {
  if (STATE.db) {
    persist();
    STATE.db.close();
    STATE.db = null;
  }
}

function persist() {
  if (!STATE.db || !STATE.dbFile) return;
  const data = STATE.db.export();
  fs.writeFileSync(STATE.dbFile, Buffer.from(data));
}

function all(sql, params = []) {
  const stmt = STATE.db.prepare(sql);
  try { stmt.bind(params); } catch (e) { /* params empty */ }
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function tableColumns(table) {
  return all('PRAGMA table_info(' + table + ')').map((r) => r.name);
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  const stmt = STATE.db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const id = all('SELECT last_insert_rowid() AS id')[0].id;
  persist();
  return id;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function localFechaHora(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function localFecha(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function nowStamp() {
  return localFecha(new Date());
}

function nowDateTime() {
  return localFechaHora(new Date());
}

function shiftUtcToLocal(v, tipo) {
  if (!v) return v;
  const s = String(v).trim();
  let d;
  if (tipo === 'dt') {
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return v;
    d = new Date(s.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return v;
    return localFechaHora(d);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return v;
  d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return v;
  return localFecha(d);
}

function shiftColumn(table, col, tipo) {
  try {
    const rows = all('SELECT id, "' + col + '" AS v FROM "' + table + '" WHERE "' + col + '" IS NOT NULL AND "' + col + '" != \'\'');
    for (const r of rows) {
      const nv = shiftUtcToLocal(r.v, tipo);
      if (nv !== r.v) run('UPDATE "' + table + '" SET "' + col + '" = ? WHERE id = ?', [nv, r.id]);
    }
  } catch (e) { /* noop */ }
}

function convertirZonaHoraria() {
  shiftColumn('wa_mensajes', 'creado', 'dt');
  shiftColumn('reporte_eventos', 'creado', 'dt');
  shiftColumn('reportes', 'resuelto_at', 'dt');
  shiftColumn('reportes', 'archivado_at', 'dt');
  shiftColumn('reportes', 'asignado_at', 'dt');
  shiftColumn('clients', 'creado', 'd');
  shiftColumn('equipos', 'creado', 'd');
  shiftColumn('tecnicos', 'creado', 'd');
  shiftColumn('reportes', 'creado', 'd');
  shiftColumn('reportes', 'enviado_at', 'd');
}

function getSetting(key, def) {
  const r = get('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : def;
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  persist();
}

function migrate() {
  STATE.db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      contacto TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      notas TEXT,
      grupo_id TEXT,
      grupo_nombre TEXT,
      creado TEXT
    );
    CREATE TABLE IF NOT EXISTS equipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      marca TEXT,
      modelo TEXT,
      serial TEXT,
      ubicacion TEXT,
      notas TEXT,
      creado TEXT
    );
    CREATE TABLE IF NOT EXISTS reportes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      equipo_id INTEGER,
      descripcion TEXT NOT NULL,
      fecha TEXT,
      estado TEXT DEFAULT 'abierto',
      grupo INTEGER,
      enviado INTEGER DEFAULT 0,
      enviado_at TEXT,
      mensaje TEXT,
      resuelto_at TEXT,
      creado TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS tecnicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      telefono TEXT,
      rol TEXT DEFAULT 'tecnico',
      creado TEXT
    );
    CREATE TABLE IF NOT EXISTS reporte_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporte_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      detalle TEXT,
      creado TEXT
    );
    CREATE TABLE IF NOT EXISTS reporte_equipos (
      reporte_id INTEGER NOT NULL,
      equipo_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensaje_id TEXT,
      jid TEXT,
      telefono TEXT,
      nombre TEXT,
      texto TEXT,
      media TEXT DEFAULT '',
      media_archivo TEXT DEFAULT '',
      es_grupo INTEGER DEFAULT 0,
      tipo TEXT DEFAULT 'in',
      leido INTEGER DEFAULT 0,
      remitente TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      miembros INTEGER DEFAULT 0,
      creado TEXT
    );
  `);
  const waCols = tableColumns('wa_mensajes');
  if (!waCols.includes('media_archivo')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN media_archivo TEXT DEFAULT \'\'');
  if (!waCols.includes('tipo')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN tipo TEXT DEFAULT \'in\'');
  if (!waCols.includes('remitente')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN remitente TEXT DEFAULT \'\'');
  if (!waCols.includes('avatar')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN avatar TEXT DEFAULT \'\'');
  if (!waCols.includes('miembros')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN miembros INTEGER DEFAULT 0');
  if (!waCols.includes('participant')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN participant TEXT DEFAULT \'\'');
  if (!waCols.includes('media_mime')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN media_mime TEXT DEFAULT \'\'');
  if (!waCols.includes('mention_ids')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN mention_ids TEXT DEFAULT \'\'');
  if (!waCols.includes('reply_id')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN reply_id TEXT DEFAULT \'\'');
  if (!waCols.includes('reply_remitente')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN reply_remitente TEXT DEFAULT \'\'');
  if (!waCols.includes('reply_texto')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN reply_texto TEXT DEFAULT \'\'');
  if (!waCols.includes('reply_media')) STATE.db.run('ALTER TABLE wa_mensajes ADD COLUMN reply_media TEXT DEFAULT \'\'');
  const clCols = tableColumns('clients');
  if (!clCols.includes('grupo_id')) STATE.db.run('ALTER TABLE clients ADD COLUMN grupo_id TEXT');
  if (!clCols.includes('grupo_nombre')) STATE.db.run('ALTER TABLE clients ADD COLUMN grupo_nombre TEXT');
  const rpCols = tableColumns('reportes');
  if (!rpCols.includes('grupo_id')) STATE.db.run('ALTER TABLE reportes ADD COLUMN grupo_id TEXT');
  if (!rpCols.includes('grupo_nombre')) STATE.db.run('ALTER TABLE reportes ADD COLUMN grupo_nombre TEXT');
  if (!rpCols.includes('enviar_grupo')) STATE.db.run('ALTER TABLE reportes ADD COLUMN enviar_grupo INTEGER DEFAULT 1');
  if (!rpCols.includes('tecnico_id')) STATE.db.run('ALTER TABLE reportes ADD COLUMN tecnico_id INTEGER');
  if (!rpCols.includes('tecnico_nombre')) STATE.db.run('ALTER TABLE reportes ADD COLUMN tecnico_nombre TEXT');
  if (!rpCols.includes('asignado_at')) STATE.db.run('ALTER TABLE reportes ADD COLUMN asignado_at TEXT');
  if (!rpCols.includes('archivado')) STATE.db.run('ALTER TABLE reportes ADD COLUMN archivado INTEGER DEFAULT 0');
  if (!rpCols.includes('archivado_at')) STATE.db.run('ALTER TABLE reportes ADD COLUMN archivado_at TEXT');
  if (!rpCols.includes('prioridad')) STATE.db.run('ALTER TABLE reportes ADD COLUMN prioridad TEXT DEFAULT \'normal\'');
  if (!rpCols.includes('adjuntos')) STATE.db.run('ALTER TABLE reportes ADD COLUMN adjuntos TEXT');
  if (!rpCols.includes('solucion')) STATE.db.run('ALTER TABLE reportes ADD COLUMN solucion TEXT');
  if (!rpCols.includes('resuelto_at')) STATE.db.run('ALTER TABLE reportes ADD COLUMN resuelto_at TEXT');
  if (!rpCols.includes('updated_at')) STATE.db.run('ALTER TABLE reportes ADD COLUMN updated_at TEXT');
  if (!rpCols.includes('lat')) STATE.db.run('ALTER TABLE reportes ADD COLUMN lat REAL');
  if (!rpCols.includes('lng')) STATE.db.run('ALTER TABLE reportes ADD COLUMN lng REAL');
  if (!rpCols.includes('client_nombre')) STATE.db.run('ALTER TABLE reportes ADD COLUMN client_nombre TEXT');
  if (!rpCols.includes('equipo_nombre')) STATE.db.run('ALTER TABLE reportes ADD COLUMN equipo_nombre TEXT');
  if (!rpCols.includes('deleted')) STATE.db.run('ALTER TABLE reportes ADD COLUMN deleted INTEGER DEFAULT 0');
  STATE.db.run("UPDATE reportes SET client_nombre = (SELECT nombre FROM clients WHERE id = reportes.client_id) WHERE (client_nombre IS NULL OR client_nombre = '') AND client_id IS NOT NULL");
  STATE.db.run("UPDATE reportes SET equipo_nombre = (SELECT nombre FROM equipos WHERE id = reportes.equipo_id) WHERE (equipo_nombre IS NULL OR equipo_nombre = '') AND equipo_id IS NOT NULL");
  const tcCols = tableColumns('tecnicos');
  if (!tcCols.includes('sync_pass')) STATE.db.run('ALTER TABLE tecnicos ADD COLUMN sync_pass TEXT');
  if (!tcCols.includes('rol')) STATE.db.run("ALTER TABLE tecnicos ADD COLUMN rol TEXT DEFAULT 'tecnico'");
  STATE.db.run(`CREATE TABLE IF NOT EXISTS sync_tombstones (
    reporte_id INTEGER PRIMARY KEY,
    updated_at TEXT
  );`);
  STATE.db.run(`CREATE TABLE IF NOT EXISTS fotos_enviadas (
    nombre TEXT PRIMARY KEY,
    reporte_id INTEGER,
    enviado_at TEXT
  );`);
  if (!getSetting('tz_convertida', '')) {
    convertirZonaHoraria();
    setSetting('tz_convertida', '1');
  }
}

function autoArchiveResolved() {
  const now = nowDateTime();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = all(`SELECT id FROM reportes WHERE deleted = 0 AND archivado = 0 AND estado = 'resuelto' AND resuelto_at IS NOT NULL AND resuelto_at <= ?`, [cutoff]);
  for (const r of rows) {
    run('UPDATE reportes SET archivado = 1, archivado_at = ?, updated_at = ? WHERE id = ?', [now, now, r.id]);
  }
  return rows.length;
}

module.exports = { open, close, all, get, run, nowStamp, nowDateTime, getSetting, setSetting, shiftUtcToLocal, autoArchiveResolved };
