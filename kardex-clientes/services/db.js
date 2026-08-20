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

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  const stmt = STATE.db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  STATE.db.run('SELECT last_insert_rowid() AS id;');
  return all('SELECT last_insert_rowid() AS id')[0].id;
}

function migrate() {
  STATE.db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rnc TEXT DEFAULT '',
      contacto TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      email TEXT DEFAULT '',
      direccion TEXT DEFAULT '',
      plan TEXT DEFAULT 'pyme',
      cuota REAL DEFAULT 0,
      empleados INTEGER DEFAULT 0,
      inicio TEXT DEFAULT '',
      estado TEXT DEFAULT 'activo',
      notas TEXT DEFAULT '',
      licencia TEXT DEFAULT '',
      creado TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      monto REAL NOT NULL,
      metodo TEXT DEFAULT '',
      meses INTEGER DEFAULT 1,
      notas TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS servicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      cuota REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_servicios_client ON servicios(client_id);
  `);
  ensureColumn('payments', 'tipo', "TEXT DEFAULT 'mensual'");
  ensureColumn('clients', 'costo_instalacion', 'REAL DEFAULT 0');
  ensureColumn('clients', 'trial_fin', 'TEXT');
}

function ensureColumn(table, col, ddl) {
  const cols = all(`PRAGMA table_info(${table})`).map((r) => r.name);
  if (!cols.includes(col)) STATE.db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function setSetting(key, value) {
  const existing = get('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) run('UPDATE settings SET value = ? WHERE key = ?', [String(value), key]);
  else run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  persist();
}

function getSetting(key, fallback = '') {
  const r = get('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : fallback;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { open, close, all, get, run, persist, setSetting, getSetting, nowStamp };
