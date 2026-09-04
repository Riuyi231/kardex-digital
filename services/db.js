const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', role: 'admin', full_name: 'Administrador' };

let SQL = null;
let db = null;
let dbPath = null;
let persistTimer = null;

async function open(filePath) {
  dbPath = filePath;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f)
  });
  if (fs.existsSync(filePath)) {
    db = new SQL.Database(fs.readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }
  migrate();
  seed();
  persistNow();
  return db;
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'invitado',
      full_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cedula TEXT,
      nombres TEXT NOT NULL DEFAULT '',
      apellidos TEXT NOT NULL DEFAULT '',
      sexo TEXT NOT NULL DEFAULT '',
      fecha_nacimiento TEXT NOT NULL DEFAULT '',
      nacionalidad TEXT NOT NULL DEFAULT '',
      lugar_nacimiento TEXT NOT NULL DEFAULT '',
      estado_civil TEXT NOT NULL DEFAULT '',
      profesion TEXT NOT NULL DEFAULT '',
      tipo_sangre TEXT NOT NULL DEFAULT '',
      puesto TEXT NOT NULL DEFAULT '',
      departamento TEXT NOT NULL DEFAULT '',
      sucursal TEXT NOT NULL DEFAULT '',
      fecha_emision TEXT NOT NULL DEFAULT '',
      fecha_vencimiento TEXT NOT NULL DEFAULT '',
      nota TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'activo',
      es_propietario INTEGER NOT NULL DEFAULT 0,
      fecha_baja TEXT NOT NULL DEFAULT '',
      salario REAL NOT NULL DEFAULT 0,
      tipo_salario TEXT NOT NULL DEFAULT 'mensual',
      fecha_ingreso TEXT NOT NULL DEFAULT '',
      nss TEXT NOT NULL DEFAULT '',
      banco TEXT NOT NULL DEFAULT '',
      cuenta TEXT NOT NULL DEFAULT '',
      tipo_contrato TEXT NOT NULL DEFAULT '',
      foto TEXT,
      frente TEXT,
      reverso TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vacaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'vacaciones',
      fecha_inicio TEXT NOT NULL DEFAULT '',
      fecha_fin TEXT NOT NULL DEFAULT '',
      dias REAL NOT NULL DEFAULT 0,
      motivo TEXT NOT NULL DEFAULT '',
      aprobado INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS horas_extra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      horas_extra REAL NOT NULL DEFAULT 0,
      domingos_extra INTEGER NOT NULL DEFAULT 0,
      feriados_extra REAL NOT NULL DEFAULT 0,
      otros_ingresos REAL NOT NULL DEFAULT 0,
      transporte REAL NOT NULL DEFAULT 0,
      deducciones REAL NOT NULL DEFAULT 0,
      nota TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incentivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      monto REAL NOT NULL DEFAULT 0,
      motivo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS pago_vacaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      dias REAL NOT NULL DEFAULT 0,
      monto REAL NOT NULL DEFAULT 0,
      modalidad TEXT NOT NULL DEFAULT 'personalizada',
      nota TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS liquidaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      fecha_baja TEXT NOT NULL DEFAULT '',
      salario_mensual REAL NOT NULL DEFAULT 0,
      salario_diario REAL NOT NULL DEFAULT 0,
      tiempo_years INTEGER NOT NULL DEFAULT 0,
      tiempo_months INTEGER NOT NULL DEFAULT 0,
      tiempo_days INTEGER NOT NULL DEFAULT 0,
      meses_servicio REAL NOT NULL DEFAULT 0,
      cesantia_dias REAL NOT NULL DEFAULT 0,
      preaviso_dias REAL NOT NULL DEFAULT 0,
      vacaciones_dias REAL NOT NULL DEFAULT 0,
      cesantia REAL NOT NULL DEFAULT 0,
      preaviso REAL NOT NULL DEFAULT 0,
      vacaciones REAL NOT NULL DEFAULT 0,
      regalia REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      ha_sido_preavisado INTEGER NOT NULL DEFAULT 0,
      incluir_cesantia INTEGER NOT NULL DEFAULT 1,
      tomo_vacaciones_ultimo_ano INTEGER NOT NULL DEFAULT 1,
      incluir_salario_navidad INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contactos_externos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS historial_empleados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      campo TEXT NOT NULL DEFAULT '',
      valor_anterior TEXT NOT NULL DEFAULT '',
      valor_nuevo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_historial_emp ON historial_empleados(employee_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS deducciones_manuales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      quincena INTEGER NOT NULL DEFAULT 0,
      monto REAL NOT NULL DEFAULT 0,
      motivo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deducciones_emp ON deducciones_manuales(employee_id, anio, mes);
    CREATE TABLE IF NOT EXISTS salario_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      salario REAL NOT NULL DEFAULT 0,
      salario_anterior REAL NOT NULL DEFAULT 0,
      tipo_salario TEXT NOT NULL DEFAULT 'mensual',
      fecha_cambio TEXT NOT NULL,
      motivo TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_salario_hist_emp ON salario_historial(employee_id, fecha_cambio);
    CREATE INDEX IF NOT EXISTS idx_employees_cedula ON employees(cedula);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vacaciones_emp ON vacaciones(employee_id);
    CREATE INDEX IF NOT EXISTS idx_horas_extra_emp ON horas_extra(employee_id, anio, mes);
    CREATE INDEX IF NOT EXISTS idx_incentivos_emp ON incentivos(employee_id, anio, mes);
    CREATE INDEX IF NOT EXISTS idx_pago_vacaciones_emp ON pago_vacaciones(employee_id, anio, mes);
    CREATE INDEX IF NOT EXISTS idx_liquidaciones_emp ON liquidaciones(employee_id, id DESC);
  `);
  ensureEmployeeColumns();
  ensureVacacionesColumns();
  ensureHorasExtraColumns();
  ensureLiquidacionesColumns();
  ensureSalarioHistorialColumns();
}

function ensureSalarioHistorialColumns() {
  try {
    const cols = new Set(all('PRAGMA table_info(salario_historial)').map((c) => c.name));
    if (!cols.has('salario_anterior')) {
      run("ALTER TABLE salario_historial ADD COLUMN salario_anterior REAL NOT NULL DEFAULT 0");
    }
  } catch (e) { /* tabla no existe aún */ }
}

function ensureEmployeeColumns() {
  const cols = new Set(all('PRAGMA table_info(employees)').map((c) => c.name));
  const toAdd = [
    ['tipo_sangre', "TEXT NOT NULL DEFAULT ''"],
    ['puesto', "TEXT NOT NULL DEFAULT ''"],
    ['departamento', "TEXT NOT NULL DEFAULT ''"],
    ['sucursal', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'activo'"],
    ['fecha_baja', "TEXT NOT NULL DEFAULT ''"],
    ['salario', "REAL NOT NULL DEFAULT 0"],
    ['tipo_salario', "TEXT NOT NULL DEFAULT 'mensual'"],
    ['fecha_ingreso', "TEXT NOT NULL DEFAULT ''"],
    ['nss', "TEXT NOT NULL DEFAULT ''"],
    ['banco', "TEXT NOT NULL DEFAULT ''"],
    ['cuenta', "TEXT NOT NULL DEFAULT ''"],
    ['tipo_contrato', "TEXT NOT NULL DEFAULT ''"],
    ['es_propietario', "INTEGER NOT NULL DEFAULT 0"],
    ['ars', "TEXT NOT NULL DEFAULT ''"],
    ['afp', "TEXT NOT NULL DEFAULT ''"],
    ['email', "TEXT NOT NULL DEFAULT ''"],
    ['telefono', "TEXT NOT NULL DEFAULT ''"],
    ['flota', "TEXT NOT NULL DEFAULT ''"],
    ['ciudad', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, def] of toAdd) {
    if (!cols.has(name)) {
      db.run(`ALTER TABLE employees ADD COLUMN ${name} ${def}`);
    }
  }
}

// modalidad: 'tomadas' (descansó) | 'pagadas' (se le pagaron todas) | 'pagadas_parcial' (pagaron X y guardó Y)
function ensureVacacionesColumns() {
  const cols = new Set(all('PRAGMA table_info(vacaciones)').map((c) => c.name));
  const toAdd = [
    ['modalidad', "TEXT NOT NULL DEFAULT 'tomadas'"],
    ['dias_pagados', 'REAL NOT NULL DEFAULT 0'],
    ['dias_guardados', 'REAL NOT NULL DEFAULT 0']
  ];
  for (const [name, def] of toAdd) {
    if (!cols.has(name)) {
      db.run(`ALTER TABLE vacaciones ADD COLUMN ${name} ${def}`);
    }
  }
}

function ensureHorasExtraColumns() {
  const cols = new Set(all('PRAGMA table_info(horas_extra)').map((c) => c.name));
  const toAdd = [
    ['feriados_extra', 'REAL NOT NULL DEFAULT 0'],
    ['otros_ingresos', 'REAL NOT NULL DEFAULT 0'],
    ['transporte', 'REAL NOT NULL DEFAULT 0']
  ];
  for (const [name, def] of toAdd) {
    if (!cols.has(name)) {
      db.run(`ALTER TABLE horas_extra ADD COLUMN ${name} ${def}`);
    }
  }
}

function ensureLiquidacionesColumns() {
  const cols = new Set(all('PRAGMA table_info(liquidaciones)').map((c) => c.name));
  const toAdd = [
    ['salario_diario', 'REAL NOT NULL DEFAULT 0'],
    ['tiempo_years', 'INTEGER NOT NULL DEFAULT 0'],
    ['tiempo_months', 'INTEGER NOT NULL DEFAULT 0'],
    ['tiempo_days', 'INTEGER NOT NULL DEFAULT 0'],
    ['meses_servicio', 'REAL NOT NULL DEFAULT 0'],
    ['cesantia_dias', 'REAL NOT NULL DEFAULT 0'],
    ['preaviso_dias', 'REAL NOT NULL DEFAULT 0'],
    ['vacaciones_dias', 'REAL NOT NULL DEFAULT 0'],
    ['ha_sido_preavisado', 'INTEGER NOT NULL DEFAULT 0'],
    ['incluir_cesantia', 'INTEGER NOT NULL DEFAULT 1'],
    ['tomo_vacaciones_ultimo_ano', 'INTEGER NOT NULL DEFAULT 1'],
    ['incluir_salario_navidad', 'INTEGER NOT NULL DEFAULT 1']
  ];
  for (const [name, def] of toAdd) {
    if (!cols.has(name)) {
      db.run(`ALTER TABLE liquidaciones ADD COLUMN ${name} ${def}`);
    }
  }
}

function seed() {
  const stmt = db.prepare('SELECT COUNT(*) AS c FROM users');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  if ((row.c || 0) === 0) {
    db.run(
      'INSERT INTO users (username, password_hash, role, full_name, created_at) VALUES (?,?,?,?,?)',
      [DEFAULT_ADMIN.username, hashPassword(DEFAULT_ADMIN.password), DEFAULT_ADMIN.role, DEFAULT_ADMIN.full_name, nowIso()]
    );
  }
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function persistNow() {
  if (!db) return;
  const data = Buffer.from(db.export());
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dbPath);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { persistNow(); } catch (e) { console.error('Error guardando BD', e); }
  }, 250);
}

function close() {
  clearTimeout(persistTimer);
  if (db) { persistNow(); db.close(); }
}

function run(sql, params = []) {
  db.run(sql, params);
  schedulePersist();
  return { changes: db.getRowsModified() };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : undefined;
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const calc = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

const auth = {
  login(username, password) {
    const u = get('SELECT * FROM users WHERE username = ?', [String(username).trim().toLowerCase()]);
    if (!u || !verifyPassword(password, u.password_hash)) return null;
    return sanitizeUser(u);
  }
};

const users = {
  list() {
    return all('SELECT id, username, role, full_name, created_at FROM users ORDER BY username');
  },
  get(id) {
    return sanitizeUser(get('SELECT * FROM users WHERE id = ?', [id]));
  },
  create({ username, password, role, full_name }) {
    const uname = String(username).trim().toLowerCase();
    if (!uname) throw new Error('El nombre de usuario es obligatorio');
    if (!password || String(password).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');
    if (!['admin', 'editor', 'invitado'].includes(role)) throw new Error('Rol inválido');
    const existing = get('SELECT id FROM users WHERE username = ?', [uname]);
    if (existing) throw new Error('Ya existe un usuario con ese nombre');
    const r = run('INSERT INTO users (username, password_hash, role, full_name, created_at) VALUES (?,?,?,?,?)',
      [uname, hashPassword(password), role, String(full_name || ''), nowIso()]);
    return { id: r.changes > 0 ? get('SELECT id FROM users WHERE username=?', [uname]).id : null };
  },
  update(id, { password, role, full_name }) {
    const u = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new Error('Usuario no encontrado');
    if (role && !['admin', 'editor', 'invitado'].includes(role)) throw new Error('Rol inválido');
    if (password !== undefined && password !== '' && String(password).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');
    if (password !== undefined && password !== '') {
      run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), id]);
    }
    if (role !== undefined || full_name !== undefined) {
      const newRole = role !== undefined ? role : u.role;
      const newName = full_name !== undefined ? String(full_name) : u.full_name;
      run('UPDATE users SET role = ?, full_name = ? WHERE id = ?', [newRole, newName, id]);
    }
    return users.get(id);
  },
  delete(id) {
    const u = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new Error('Usuario no encontrado');
    if (u.role === 'admin') {
      const c = get('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['admin']);
      if (c.c <= 1) throw new Error('No se puede eliminar el último administrador');
    }
    run('DELETE FROM users WHERE id = ?', [id]);
    return true;
  },
  countAdmins() {
    const c = get('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['admin']);
    return c.c || 0;
  }
};

const employees = {
  list(search = '', status = '', opts = {}) {
    const q = String(search).trim();
    const base = `SELECT id, cedula, nombres, apellidos, sexo, fecha_nacimiento, estado_civil, profesion, puesto, departamento,
        status, es_propietario, fecha_baja, salario, tipo_salario, fecha_ingreso, nss, ars, afp, email, telefono, flota, banco, cuenta, tipo_contrato,
        created_at, updated_at, (frente IS NOT NULL AND frente != '') AS has_images,
        (SELECT COUNT(*) FROM liquidaciones WHERE liquidaciones.employee_id = employees.id) AS liquidaciones_count
        FROM employees`;
    const where = [];
    const params = [];
    if (q) { where.push('(cedula LIKE ? OR nombres LIKE ? OR apellidos LIKE ? OR lugar_nacimiento LIKE ? OR profesion LIKE ? OR puesto LIKE ? OR departamento LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like, like, like, like); }
    if (status) { where.push('status = ?'); params.push(status); }
    const fc = (opts && opts.fecha_col) || '';
    const desde = (opts && opts.fecha_desde) || '';
    const hasta = (opts && opts.fecha_hasta) || '';
    if (fc === 'fecha_ingreso' || fc === 'fecha_baja') {
      const parts = [`TRIM(${fc}) != ''`];
      if (desde) { parts.push(`substr(${fc},1,10) >= ?`); params.push(desde); }
      if (hasta) { parts.push(`substr(${fc},1,10) <= ?`); params.push(hasta); }
      where.push(`(${parts.join(' AND ')})`);
    }
    return all(where.length
      ? `${base} WHERE ${where.join(' AND ')} ORDER BY apellidos, nombres`
      : `${base} ORDER BY apellidos, nombres`, params);
  },
  get(id) {
    return get('SELECT * FROM employees WHERE id = ?', [id]);
  },
  stats() {
    const activos = get('SELECT COUNT(*) AS c FROM employees WHERE status = ?', ['activo']).c || 0;
    const inactivos = get('SELECT COUNT(*) AS c FROM employees WHERE status = ?', ['inactivo']).c || 0;
    const departamentos = all(
      `SELECT COALESCE(NULLIF(departamento, ''), '(Sin departamento)') AS departamento, COUNT(*) AS cantidad
       FROM employees WHERE status = 'activo' GROUP BY departamento ORDER BY departamento`
    );
    return { activos, inactivos, departamentos };
  },
  setStatus(id, status, extra) {
    const u = get('SELECT * FROM employees WHERE id = ?', [id]);
    if (!u) throw new Error('Registro no encontrado');
    if (!['activo', 'inactivo'].includes(status)) throw new Error('Estado inválido');
    const opts = extra || {};
    const fechaBaja = status === 'inactivo' ? (opts.fecha_baja || nowIso()) : '';
    const fechaIngreso = status === 'activo' ? (opts.fecha_ingreso || u.fecha_ingreso) : u.fecha_ingreso;
    const nuevoPuesto = opts.puesto !== undefined ? opts.puesto : u.puesto;
    const nuevoDepto = opts.departamento !== undefined ? opts.departamento : u.departamento;
    const nuevoSucursal = opts.sucursal !== undefined ? opts.sucursal : u.sucursal;
    const nuevoSalario = opts.salario !== undefined ? Number(opts.salario) : u.salario;
    const nuevoTipoSalario = opts.tipo_salario || u.tipo_salario;
    run('UPDATE employees SET status = ?, fecha_baja = ?, fecha_ingreso = ?, puesto = ?, departamento = ?, sucursal = ?, salario = ?, tipo_salario = ?, updated_at = ? WHERE id = ?',
      [status, fechaBaja, fechaIngreso, nuevoPuesto, nuevoDepto, nuevoSucursal, Number(nuevoSalario) || 0, nuevoTipoSalario, nowIso(), id]);
    historial.log(id, 'status', u.status || 'activo', status, opts.userId || null);
    if (fechaBaja !== u.fecha_baja) historial.log(id, 'fecha_baja', u.fecha_baja, fechaBaja, opts.userId || null);
    if (fechaIngreso !== u.fecha_ingreso) historial.log(id, 'fecha_ingreso', u.fecha_ingreso, fechaIngreso, opts.userId || null);
    if (opts.puesto !== undefined && opts.puesto !== u.puesto) historial.log(id, 'puesto', u.puesto, opts.puesto, opts.userId || null);
    if (opts.departamento !== undefined && opts.departamento !== u.departamento) historial.log(id, 'departamento', u.departamento, opts.departamento, opts.userId || null);
    if (opts.sucursal !== undefined && opts.sucursal !== u.sucursal) historial.log(id, 'sucursal', u.sucursal, opts.sucursal, opts.userId || null);
    if (opts.salario !== undefined && Number(opts.salario) !== Number(u.salario)) {
      historial.log(id, 'salario', u.salario, opts.salario, opts.userId || null);
      salarioHistorial.record(id, Number(opts.salario), nuevoTipoSalario, 'Reintegración — cambio de salario', Number(u.salario));
    }
    return employees.get(id);
  },
  create(data, userId) {
    const d = Object.assign({
      cedula: '', nombres: '', apellidos: '', sexo: '', fecha_nacimiento: '', nacionalidad: '',
      lugar_nacimiento: '', ciudad: '', estado_civil: '', profesion: '', tipo_sangre: '', puesto: '', departamento: '',
      sucursal: '',
      fecha_emision: '', fecha_vencimiento: '', nota: '',
       salario: 0, tipo_salario: 'mensual', fecha_ingreso: '', nss: '', ars: '', afp: '', email: '', telefono: '', flota: '', banco: '', cuenta: '', tipo_contrato: ''
    }, data || {});
    const now = nowIso();
    const r = run(`INSERT INTO employees
      (cedula, nombres, apellidos, sexo, fecha_nacimiento, nacionalidad, lugar_nacimiento, ciudad, estado_civil,
       profesion, tipo_sangre, puesto, departamento, sucursal, fecha_emision, fecha_vencimiento, nota,
       salario, tipo_salario, fecha_ingreso, nss, ars, afp, email, telefono, flota, banco, cuenta, tipo_contrato, es_propietario,
       foto, frente, reverso, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.cedula, d.nombres, d.apellidos, d.sexo, d.fecha_nacimiento, d.nacionalidad, d.lugar_nacimiento, d.ciudad, d.estado_civil,
       d.profesion, d.tipo_sangre, d.puesto, d.departamento, d.sucursal || '', d.fecha_emision, d.fecha_vencimiento, d.nota,
       Number(d.salario) || 0, d.tipo_salario || 'mensual', d.fecha_ingreso || '', d.nss || '', d.ars || '', d.afp || '', d.email || '', d.telefono || '', d.flota || '', d.banco || '', d.cuenta || '', d.tipo_contrato || '', d.es_propietario ? 1 : 0,
       d.foto || null, d.frente || null, d.reverso || null, userId || null, now, now]);
    const last = get('SELECT last_insert_rowid() AS id');
    const created = employees.get(last.id);
    if (Number(d.salario) > 0) {
      salarioHistorial.record(created.id, Number(d.salario), d.tipo_salario || 'mensual', 'Alta');
    }
    historial.logCreate(d, created.id, userId);
    return created;
  },
  update(id, data, userId) {
    const u = get('SELECT * FROM employees WHERE id = ?', [id]);
    if (!u) throw new Error('Registro no encontrado');
    const d = Object.assign({}, u, data || {});
    run(`UPDATE employees SET
        cedula=?, nombres=?, apellidos=?, sexo=?, fecha_nacimiento=?, nacionalidad=?, lugar_nacimiento=?, ciudad=?, estado_civil=?,
        profesion=?, tipo_sangre=?, puesto=?, departamento=?, sucursal=?, fecha_emision=?, fecha_vencimiento=?, nota=?,
        salario=?, tipo_salario=?, fecha_ingreso=?, nss=?, ars=?, afp=?, email=?, telefono=?, flota=?, banco=?, cuenta=?, tipo_contrato=?, es_propietario=?,
        foto=?, frente=?, reverso=?, updated_at=?
      WHERE id=?`,
      [d.cedula, d.nombres, d.apellidos, d.sexo, d.fecha_nacimiento, d.nacionalidad, d.lugar_nacimiento, d.ciudad, d.estado_civil,
       d.profesion, d.tipo_sangre, d.puesto, d.departamento, d.sucursal || '', d.fecha_emision, d.fecha_vencimiento, d.nota,
       Number(d.salario) || 0, d.tipo_salario || 'mensual', d.fecha_ingreso || '', d.nss || '', d.ars || '', d.afp || '', d.email || '', d.telefono || '', d.flota || '', d.banco || '', d.cuenta || '', d.tipo_contrato || '', (data && data.es_propietario !== undefined ? (data.es_propietario ? 1 : 0) : d.es_propietario ? 1 : 0),
       d.foto || null, d.frente || null, d.reverso || null, nowIso(), id]);
    if (Number(data && data.salario) && Number(data.salario) !== Number(u.salario)) {
      salarioHistorial.record(id, Number(data.salario), data.tipo_salario || u.tipo_salario, 'Cambio de salario', Number(u.salario));
    }
    historial.logUpdate(u, data || {}, id, userId);
    return employees.get(id);
  },
  delete(id) {
    run('DELETE FROM employees WHERE id = ?', [id]);
    run('DELETE FROM vacaciones WHERE employee_id = ?', [id]);
    run('DELETE FROM horas_extra WHERE employee_id = ?', [id]);
    run('DELETE FROM incentivos WHERE employee_id = ?', [id]);
    run('DELETE FROM pago_vacaciones WHERE employee_id = ?', [id]);
    run('DELETE FROM deducciones_manuales WHERE employee_id = ?', [id]);
    run('DELETE FROM salario_historial WHERE employee_id = ?', [id]);
    return true;
  }
};

const horasExtra = {
  get(employeeId, mes, anio) {
    return get('SELECT * FROM horas_extra WHERE employee_id = ? AND mes = ? AND anio = ?',
      [Number(employeeId), Number(mes), Number(anio)]);
  },
  listForPeriod(mes, anio) {
    return all('SELECT * FROM horas_extra WHERE mes = ? AND anio = ?', [Number(mes), Number(anio)]);
  },
  save({ employee_id, mes, anio, horas_extra, domingos_extra, feriados_extra, otros_ingresos, transporte, nota }) {
    const id = Number(employee_id);
    const m = Number(mes);
    const a = Number(anio);
    if (!id || !m || !a) throw new Error('Faltan empleado o período');
    const existing = get('SELECT id FROM horas_extra WHERE employee_id = ? AND mes = ? AND anio = ?', [id, m, a]);
    const he = Number(horas_extra) || 0;
    const de = Number(domingos_extra) || 0;
    const fe = Number(feriados_extra) || 0;
    const oi = Number(otros_ingresos) || 0;
    const tr = Number(transporte) || 0;
    const nt = String(nota || '');
    const now = nowIso();
    if (existing) {
      run('UPDATE horas_extra SET horas_extra = ?, domingos_extra = ?, feriados_extra = ?, otros_ingresos = ?, transporte = ?, nota = ?, updated_at = ? WHERE id = ?',
        [he, de, fe, oi, tr, nt, now, existing.id]);
      return { id: existing.id, employee_id: id, mes: m, anio: a, horas_extra: he, domingos_extra: de, feriados_extra: fe, otros_ingresos: oi, transporte: tr, nota: nt };
    }
    run('INSERT INTO horas_extra (employee_id, mes, anio, horas_extra, domingos_extra, feriados_extra, otros_ingresos, transporte, nota, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, m, a, he, de, fe, oi, tr, nt, now, now]);
    return { id: get('SELECT last_insert_rowid() AS id').id, employee_id: id, mes: m, anio: a, horas_extra: he, domingos_extra: de, feriados_extra: fe, otros_ingresos: oi, transporte: tr, nota: nt };
  }
};

const liquidaciones = {
  listForEmployee(employeeId) {
    return all('SELECT * FROM liquidaciones WHERE employee_id = ? ORDER BY id DESC', [Number(employeeId)]);
  },
  listAll() {
    return all(`SELECT l.*, e.nombres, e.apellidos, e.cedula, e.status AS empleado_status
      FROM liquidaciones l LEFT JOIN employees e ON e.id = l.employee_id
      ORDER BY l.id DESC`);
  },
  save(data, userId) {
    const now = nowIso();
    const t = data.tiempo_laborado || {};
    run(`INSERT INTO liquidaciones
      (employee_id, fecha_baja, salario_mensual, salario_diario,
       tiempo_years, tiempo_months, tiempo_days, meses_servicio,
       cesantia_dias, preaviso_dias, vacaciones_dias,
       cesantia, preaviso, vacaciones, regalia, total,
       ha_sido_preavisado, incluir_cesantia, tomo_vacaciones_ultimo_ano, incluir_salario_navidad,
       created_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [Number(data.employee_id), data.fecha_baja || '', Number(data.salario_mensual) || 0, Number(data.salario_diario) || 0,
       Number(t.years) || 0, Number(t.months) || 0, Number(t.days) || 0, Number(data.meses_servicio) || 0,
       Number(data.cesantia_dias) || 0, Number(data.preaviso_dias) || 0, Number(data.vacaciones_dias) || 0,
       Number(data.cesantia) || 0, Number(data.preaviso) || 0, Number(data.vacaciones) || 0, Number(data.regalia) || 0, Number(data.total) || 0,
       data.ha_sido_preavisado ? 1 : 0, data.incluir_cesantia === false ? 0 : 1,
       data.tomo_vacaciones_ultimo_ano === false ? 0 : 1, data.incluir_salario_navidad === false ? 0 : 1,
       now, userId || null]);
    const last = get('SELECT last_insert_rowid() AS id');
    return get('SELECT * FROM liquidaciones WHERE id = ?', [last.id]);
  },
  delete(id) {
    run('DELETE FROM liquidaciones WHERE id = ?', [Number(id)]);
    return true;
  }
};

const incentivos = {
  listForPeriod(mes, anio) {
    return all('SELECT * FROM incentivos WHERE mes = ? AND anio = ? ORDER BY employee_id, id', [Number(mes), Number(anio)]);
  },
  list(employeeId, mes, anio) {
    return all('SELECT * FROM incentivos WHERE employee_id = ? AND mes = ? AND anio = ? ORDER BY id',
      [Number(employeeId), Number(mes), Number(anio)]);
  },
  create(data, userId) {
    const d = Object.assign({ employee_id: null, mes: null, anio: null, monto: 0, motivo: '' }, data || {});
    const id = Number(d.employee_id);
    const m = Number(d.mes);
    const a = Number(d.anio);
    if (!id || !m || !a) throw new Error('Faltan empleado o período');
    const monto = Number(d.monto);
    if (!(monto > 0)) throw new Error('El monto del incentivo debe ser mayor que 0');
    const motivo = String(d.motivo || '').trim();
    if (!motivo) throw new Error('Indique qué hizo el empleado');
    const now = nowIso();
    run('INSERT INTO incentivos (employee_id, mes, anio, monto, motivo, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, m, a, monto, motivo, now, now, userId || null]);
    return { id: get('SELECT last_insert_rowid() AS id').id, employee_id: id, mes: m, anio: a, monto, motivo };
  },
  update(id, data, userId) {
    const existing = get('SELECT * FROM incentivos WHERE id = ?', [Number(id)]);
    if (!existing) throw new Error('Incentivo no encontrado');
    const monto = Number(data.monto);
    if (!(monto > 0)) throw new Error('El monto del incentivo debe ser mayor que 0');
    const motivo = String(data.motivo != null ? data.motivo : existing.motivo).trim();
    if (!motivo) throw new Error('Indique qué hizo el empleado');
    run('UPDATE incentivos SET monto = ?, motivo = ?, updated_at = ? WHERE id = ?', [monto, motivo, nowIso(), existing.id]);
    return { id: existing.id, employee_id: existing.employee_id, mes: existing.mes, anio: existing.anio, monto, motivo };
  },
  delete(id) {
    run('DELETE FROM incentivos WHERE id = ?', [Number(id)]);
    return true;
  }
};

// Pagos de vacaciones registrados en la nómina (un registro por empleado y período).
const pagoVacaciones = {
  get(employeeId, mes, anio) {
    return get('SELECT * FROM pago_vacaciones WHERE employee_id = ? AND mes = ? AND anio = ?',
      [Number(employeeId), Number(mes), Number(anio)]) || null;
  },
  listForPeriod(mes, anio) {
    return all('SELECT * FROM pago_vacaciones WHERE mes = ? AND anio = ?', [Number(mes), Number(anio)]);
  },
  // Días ya pagados vía nómina (para descontarlos de los guardados del expediente).
  totalDiasPagados(employeeId) {
    const r = get('SELECT COALESCE(SUM(dias), 0) AS total FROM pago_vacaciones WHERE employee_id = ?',
      [Number(employeeId)]);
    return Number(r && r.total) || 0;
  },
  save({ employee_id, mes, anio, dias, monto, modalidad, nota }, userId) {
    const id = Number(employee_id);
    const m = Number(mes);
    const a = Number(anio);
    if (!id || !m || !a) throw new Error('Faltan empleado o período');
    const diasN = Number(dias) || 0;
    const montoN = Number(monto) || 0;
    if (diasN <= 0 || montoN <= 0) throw new Error('Indique los días y verifique el monto');
    const moda = String(modalidad || 'personalizada');
    const nt = String(nota || '');
    const now = nowIso();
    const existing = get('SELECT id FROM pago_vacaciones WHERE employee_id = ? AND mes = ? AND anio = ?', [id, m, a]);
    if (existing) {
      run('UPDATE pago_vacaciones SET dias = ?, monto = ?, modalidad = ?, nota = ?, updated_at = ?, created_by = ? WHERE id = ?',
        [diasN, montoN, moda, nt, now, userId || null, existing.id]);
      return { id: existing.id, employee_id: id, mes: m, anio: a, dias: diasN, monto: montoN, modalidad: moda, nota: nt };
    }
    run('INSERT INTO pago_vacaciones (employee_id, mes, anio, dias, monto, modalidad, nota, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, m, a, diasN, montoN, moda, nt, now, now, userId || null]);
    return { id: get('SELECT last_insert_rowid() AS id').id, employee_id: id, mes: m, anio: a, dias: diasN, monto: montoN, modalidad: moda, nota: nt };
  },
  delete(id) {
    run('DELETE FROM pago_vacaciones WHERE id = ?', [Number(id)]);
    return true;
  }
};

// Deducciones manuales por empleado, período y quincena (0=todas, 1=primera, 2=segunda).
const deduccionesManuales = {
  listForPeriod(mes, anio, quincena) {
    let sql = 'SELECT * FROM deducciones_manuales WHERE mes = ? AND anio = ?';
    const params = [Number(mes), Number(anio)];
    if (quincena) { sql += ' AND quincena = ?'; params.push(Number(quincena)); }
    sql += ' ORDER BY employee_id, id';
    return all(sql, params);
  },
  listForEmployee(employeeId, mes, anio) {
    return all('SELECT * FROM deducciones_manuales WHERE employee_id = ? AND mes = ? AND anio = ? ORDER BY quincena, id',
      [Number(employeeId), Number(mes), Number(anio)]);
  },
  create({ employee_id, mes, anio, quincena, monto, motivo }, userId) {
    const id = Number(employee_id);
    const m = Number(mes);
    const a = Number(anio);
    const q = Number(quincena) || 0;
    const montoN = Number(monto) || 0;
    if (!id || !m || !a) throw new Error('Faltan empleado o período');
    if (montoN <= 0) throw new Error('El monto debe ser mayor que 0');
    const now = nowIso();
    run('INSERT INTO deducciones_manuales (employee_id, mes, anio, quincena, monto, motivo, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, m, a, q, montoN, String(motivo || ''), now, now, userId || null]);
    return { id: get('SELECT last_insert_rowid() AS id').id, employee_id: id, mes: m, anio: a, quincena: q, monto: montoN, motivo: String(motivo || '') };
  },
  update(id, { monto, motivo, quincena }) {
    const existing = get('SELECT * FROM deducciones_manuales WHERE id = ?', [Number(id)]);
    if (!existing) throw new Error('Deducción no encontrada');
    const montoN = Number(monto) || existing.monto;
    if (montoN <= 0) throw new Error('El monto debe ser mayor que 0');
    const now = nowIso();
    run('UPDATE deducciones_manuales SET monto = ?, motivo = ?, quincena = ?, updated_at = ? WHERE id = ?',
      [montoN, motivo !== undefined ? String(motivo) : existing.motivo, quincena !== undefined ? Number(quincena) : existing.quincena, now, existing.id]);
    return { id: existing.id, employee_id: existing.employee_id, mes: existing.mes, anio: existing.anio, quincena: quincena !== undefined ? Number(quincena) : existing.quincena, monto: montoN, motivo: motivo !== undefined ? String(motivo) : existing.motivo };
  },
  delete(id) {
    run('DELETE FROM deducciones_manuales WHERE id = ?', [Number(id)]);
    return true;
  }
};

// Historial de salarios para cálculo proporcional de salario 13.
const salarioHistorial = {
  record(employeeId, salario, tipo_salario, motivo, salarioAnterior) {
    const now = nowIso();
    run('INSERT INTO salario_historial (employee_id, salario, salario_anterior, tipo_salario, fecha_cambio, motivo) VALUES (?,?,?,?,?,?)',
      [Number(employeeId), Number(salario), Number(salarioAnterior) || 0, String(tipo_salario || 'mensual'), now, String(motivo || '')]);
  },
  listForEmployee(employeeId) {
    return all('SELECT * FROM salario_historial WHERE employee_id = ? ORDER BY fecha_cambio', [Number(employeeId)]);
  },
  resetBaseline() {
    const y = new Date().getFullYear();
    const base = `${y}-01-01 00:00:00`;
    run('DELETE FROM salario_historial');
    run(`INSERT INTO salario_historial (employee_id, salario, salario_anterior, tipo_salario, fecha_cambio, motivo)
      SELECT id, salario, salario, tipo_salario, ?, 'Reinicio de base — salario real cargado'
      FROM employees WHERE status = 'activo' AND salario > 0`, [base]);
    return { anio: y, base, registros: db.getRowsModified() };
  },
  getSalarioPromedio(employeeId, anio) {
    // Todos los registros de cambio de salario
    const allChanges = all('SELECT salario, salario_anterior, fecha_cambio FROM salario_historial WHERE employee_id = ? ORDER BY fecha_cambio',
      [Number(employeeId)]);
    if (!allChanges.length) return null;
    const emp = get('SELECT salario FROM employees WHERE id = ?', [Number(employeeId)]);
    if (!emp) return null;

    const inicioAnio = new Date(anio + '-01-01');
    const finAnio = new Date(anio + '-12-31');

    // Determinar salario vigente al 1 de enero
    let salarioInicio = null;
    for (const ch of allChanges) {
      if (new Date(ch.fecha_cambio) < inicioAnio) {
        salarioInicio = ch.salario; // el salario después del último cambio antes del año
      }
    }
    // Si no hay cambios antes del año, usar salario_anterior del primer cambio del año
    if (salarioInicio === null) {
      const primer = allChanges.find(ch => new Date(ch.fecha_cambio) >= inicioAnio);
      salarioInicio = primer && primer.salario_anterior > 0 ? primer.salario_anterior : emp.salario;
    }

    // Segmentos de salario durante el año
    const cambiosEnAnio = allChanges.filter(ch => {
      const fc = new Date(ch.fecha_cambio);
      return fc >= inicioAnio && fc <= finAnio;
    });

    // Construir timeline
    const timeline = [];
    const primerCambio = cambiosEnAnio.length ? new Date(cambiosEnAnio[0].fecha_cambio) : finAnio;
    const diasPre = Math.round((primerCambio - inicioAnio) / 86400000);
    if (diasPre > 0) timeline.push({ salario: salarioInicio, dias: diasPre });

    for (let i = 0; i < cambiosEnAnio.length; i++) {
      const fechaInicio = new Date(cambiosEnAnio[i].fecha_cambio);
      const fechaFin = i + 1 < cambiosEnAnio.length ? new Date(cambiosEnAnio[i + 1].fecha_cambio) : new Date(anio + '-12-31');
      const dias = Math.round((fechaFin - fechaInicio) / 86400000);
      if (dias > 0) timeline.push({ salario: cambiosEnAnio[i].salario, dias });
    }

    let totalDias = 0, totalSalarioDias = 0;
    for (const seg of timeline) {
      totalDias += seg.dias;
      totalSalarioDias += seg.salario * seg.dias;
    }
    return totalDias > 0 ? totalSalarioDias / totalDias : salarioInicio;
  }
};

const vacaciones = {
  list(employeeId) {
    if (employeeId) {
      return all('SELECT * FROM vacaciones WHERE employee_id = ? ORDER BY fecha_inicio DESC', [employeeId]);
    }
    return all('SELECT * FROM vacaciones ORDER BY fecha_inicio DESC');
  },
  create(data, userId) {
    const d = Object.assign({
      employee_id: null, tipo: 'vacaciones', fecha_inicio: '', fecha_fin: '', dias: 0, motivo: '', aprobado: 1,
      modalidad: 'tomadas', dias_pagados: 0, dias_guardados: 0
    }, data || {});
    if (!d.employee_id) throw new Error('Falta el empleado');
    let pagados = Number(d.dias_pagados) || 0;
    let guardados = Number(d.dias_guardados) || 0;
    if (d.modalidad === 'pagadas') { pagados = Number(d.dias) || pagados; guardados = 0; }
    if (d.modalidad === 'tomadas') { pagados = 0; guardados = 0; }
    const r = run(
      'INSERT INTO vacaciones (employee_id, tipo, fecha_inicio, fecha_fin, dias, motivo, aprobado, modalidad, dias_pagados, dias_guardados, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [d.employee_id, String(d.tipo), String(d.fecha_inicio || ''), String(d.fecha_fin || ''), Number(d.dias) || 0,
       String(d.motivo || ''), d.aprobado === false || d.aprobado === 0 ? 0 : 1,
       String(d.modalidad || 'tomadas'), pagados, guardados,
       nowIso(), userId || null]);
    return { id: get('SELECT last_insert_rowid() AS id').id };
  },
  delete(id) {
    run('DELETE FROM vacaciones WHERE id = ?', [id]);
    return true;
  }
};

const reportes = {
  plantilla(status = 'activo') {
    return all(`SELECT id, cedula, nombres, apellidos, sexo, fecha_nacimiento, profesion, puesto, departamento,
        salario, tipo_salario, fecha_ingreso, nss, ars, afp, tipo_contrato, status
      FROM employees WHERE status = ? ORDER BY departamento, apellidos, nombres`, [status]);
  },
  antiguedad() {
    return all(`SELECT id, cedula, nombres, apellidos, puesto, departamento, fecha_ingreso, status
      FROM employees WHERE status = 'activo' AND fecha_ingreso != '' ORDER BY fecha_ingreso`);
  },
  cumpleanos(mes) {
    const m = Number(mes);
    return all(`SELECT id, cedula, nombres, apellidos, fecha_nacimiento, profesion, puesto, departamento
      FROM employees WHERE status = 'activo' AND fecha_nacimiento != ''
        AND CAST(substr(fecha_nacimiento, 4, 2) AS INTEGER) = ?
      ORDER BY substr(fecha_nacimiento, 7, 2)`, [m]);
  },
  departamentos() {
    return employees.stats().departamentos;
  },
  nominaDepartamentos() {
    const activos = all(`SELECT departamento, salario, tipo_salario FROM employees
      WHERE status = 'activo' AND salario > 0 ORDER BY departamento`);
    const by = {};
    for (const r of activos) {
      const k = r.departamento || 'Sin departamento';
      if (!by[k]) by[k] = { departamento: k, empleados: 0, total_salario: 0, quincenal: 0, semanal: 0 };
      by[k].empleados += 1;
      by[k].total_salario += Number(r.salario) || 0;
      if (r.tipo_salario === 'quincenal') by[k].quincenal += 1;
      else if (r.tipo_salario === 'semanal') by[k].semanal += 1;
      else by[k].mensual = (by[k].mensual || 0) + 1;
    }
    return Object.keys(by).sort().map(k => by[k]);
  },
  empleadosCompleto() {
    return all(`SELECT id, cedula, nombres, apellidos, sexo, nacionalidad, lugar_nacimiento, fecha_nacimiento,
        estado_civil, profesion, puesto, departamento, sucursal, email, telefono, ciudad,
        fecha_ingreso, tipo_contrato, salario, tipo_salario, banco, cuenta, nss, ars, afp, status, fecha_vencimiento
      FROM employees WHERE status = 'activo' ORDER BY apellidos, nombres`);
  },
  cedulasVencer() {
    return all(`SELECT id, cedula, nombres, apellidos, fecha_vencimiento, puesto, departamento, status
      FROM employees WHERE status = 'activo' AND fecha_vencimiento != ''
      ORDER BY substr(fecha_vencimiento, 7, 4), substr(fecha_vencimiento, 4, 2)`);
  },
  aniversarios(anio) {
    const y = Number(anio) || new Date().getFullYear();
    return all(`SELECT id, cedula, nombres, apellidos, fecha_ingreso, puesto, departamento
      FROM employees WHERE status = 'activo' AND fecha_ingreso != ''
      ORDER BY substr(fecha_ingreso, 4, 2), substr(fecha_ingreso, 7, 2)`).map(r => {
      const ing = r.fecha_ingreso;
      const m = ing.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const anioIng = m ? Number(m[3]) : null;
      r.anios = anioIng && anioIng <= y ? y - anioIng : 0;
      return r;
    }).filter(r => r.anios > 0);
  },
  beneficios() {
    return all(`SELECT id, cedula, nombres, apellidos, ars, afp, nss, puesto, departamento
      FROM employees WHERE status = 'activo' ORDER BY departamento, apellidos, nombres`);
  }
};

const audit = {
  add(user, action, detail = '') {
    run('INSERT INTO audit_log (user_id, username, action, detail, created_at) VALUES (?,?,?,?,?)',
      [user ? user.id : null, user ? user.username : 'sistema', action, String(detail), nowIso()]);
  },
  list(limit = 100) {
    return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
  }
};

const mailLog = {
  add({ to, subject, status, error }) {
    run('INSERT INTO mail_log (to_email, subject, status, error, created_at) VALUES (?,?,?,?,?)',
      [String(to || ''), String(subject || ''), String(status || 'ok'), String(error || ''), nowIso()]);
  },
  list(limit = 50) {
    return all('SELECT * FROM mail_log ORDER BY id DESC LIMIT ?', [limit]);
  }
};

const contactos = {
  list() {
    return all('SELECT * FROM contactos_externos ORDER BY nombre');
  },
  get(id) {
    return get('SELECT * FROM contactos_externos WHERE id = ?', [id]);
  },
  create(data) {
    const d = Object.assign({ nombre: '', email: '', notas: '' }, data || {});
    const email = String(d.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido');
    const r = run('INSERT INTO contactos_externos (nombre, email, notas, created_at) VALUES (?,?,?,?)',
      [String(d.nombre || '').trim(), email, String(d.notas || '').trim(), nowIso()]);
    return contactos.get(get('SELECT last_insert_rowid() AS id').id);
  },
  update(id, data) {
    const u = contactos.get(id);
    if (!u) throw new Error('Contacto no encontrado');
    const d = Object.assign({}, u, data || {});
    const email = String(d.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido');
    run('UPDATE contactos_externos SET nombre = ?, email = ?, notas = ? WHERE id = ?',
      [String(d.nombre || '').trim(), email, String(d.notas || '').trim(), id]);
    return contactos.get(id);
  },
  delete(id) {
    run('DELETE FROM contactos_externos WHERE id = ?', [id]);
    return true;
  }
};

const settings = {
  get(key) {
    const r = get('SELECT value FROM app_settings WHERE key = ?', [key]);
    return r ? r.value : null;
  },
  set(key, value) {
    const v = String(value == null ? '' : value);
    const existing = get('SELECT key FROM app_settings WHERE key = ?', [key]);
    if (existing) run('UPDATE app_settings SET value = ? WHERE key = ?', [v, key]);
    else run('INSERT INTO app_settings (key, value) VALUES (?,?)', [key, v]);
  }
};

const HISTORIAL_FIELDS = [
  ['cedula', 'Cédula'], ['nombres', 'Nombres'], ['apellidos', 'Apellidos'], ['sexo', 'Sexo'],
  ['fecha_nacimiento', 'Fecha de nacimiento'], ['nacionalidad', 'Nacionalidad'], ['lugar_nacimiento', 'Lugar de nacimiento'],
  ['ciudad', 'Ciudad de residencia'],
  ['estado_civil', 'Estado civil'], ['profesion', 'Profesión'], ['tipo_sangre', 'Tipo de sangre'],
  ['puesto', 'Puesto'], ['departamento', 'Departamento'], ['sucursal', 'Sucursal'],
  ['fecha_vencimiento', 'Fecha vencimiento cédula'], ['nota', 'Observaciones'], ['salario', 'Salario'],
  ['tipo_salario', 'Tipo de salario'], ['fecha_ingreso', 'Fecha de ingreso'], ['nss', 'NSS'],
  ['ars', 'ARS'], ['afp', 'AFP'], ['email', 'Correo'], ['telefono', 'Teléfono'], ['flota', 'Flota'],
  ['banco', 'Banco'], ['cuenta', 'Cuenta'], ['tipo_contrato', 'Tipo de contrato'], ['status', 'Estado']
];
const HISTORIAL_LABELS = Object.fromEntries(HISTORIAL_FIELDS);

const historial = {
  list(employeeId, limit = 200) {
    return all(`SELECT h.id, h.campo, h.valor_anterior, h.valor_nuevo, h.created_at,
        COALESCE(u.full_name, u.username, '') AS autor
      FROM historial_empleados h LEFT JOIN users u ON u.id = h.created_by
      WHERE h.employee_id = ? ORDER BY h.id DESC LIMIT ?`, [employeeId, limit]);
  },
  log(employeeId, campo, anterior, nuevo, userId) {
    const a = String(anterior == null ? '' : anterior);
    const n = String(nuevo == null ? '' : nuevo);
    if (a === n) return;
    run('INSERT INTO historial_empleados (employee_id, campo, valor_anterior, valor_nuevo, created_at, created_by) VALUES (?,?,?,?,?,?)',
      [employeeId, String(campo), a, n, nowIso(), userId || null]);
  },
  logCreate(data, id, userId) {
    for (const [key] of HISTORIAL_FIELDS) {
      const v = data[key];
      if (v == null || v === '') continue;
      historial.log(id, key, '', v, userId);
    }
  },
  logUpdate(oldRow, data, id, userId) {
    for (const [key] of HISTORIAL_FIELDS) {
      if (!(key in data)) continue;
      historial.log(id, key, oldRow[key], data[key], userId);
    }
  },
  labels: HISTORIAL_LABELS
};

const backups = {
  dir() {
    if (!dbPath) throw new Error('Base de datos no abierta');
    const dir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  create(auto = false) {
    if (!dbPath) throw new Error('Base de datos no abierta');
    persistNow();
    const dir = backups.dir();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '_');
    const fname = `kardex_${stamp}${auto ? '_auto' : ''}.db`;
    const dest = path.join(dir, fname);
    fs.copyFileSync(dbPath, dest);
    const keep = auto ? Number(settings.get('backup_auto_keep') || 0) : 0;
    if (auto && keep > 0) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db') && f.includes('_auto')).sort();
      while (files.length > keep) fs.unlinkSync(path.join(dir, files.shift()));
    }
    const result = { file: fname, size: fs.statSync(dest).size };
    // Copia secundaria (nube / carpeta de red / otro disco) si está configurada.
    const secondaryDir = String(settings.get('backup_dir') || '').trim();
    if (secondaryDir) {
      try {
        const sdir = path.resolve(secondaryDir);
        const sdest = path.join(sdir, fname);
        if (path.resolve(sdest) !== path.resolve(dest)) {
          fs.mkdirSync(sdir, { recursive: true });
          fs.copyFileSync(dbPath, sdest);
          result.secondary = { dir: sdir, file: fname, size: fs.statSync(sdest).size };
        }
      } catch (e) {
        result.secondary = { error: e && e.message ? e.message : String(e) };
      }
    }
    return result;
  },
  list() {
    const dir = backups.dir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtime.toISOString() };
    });
  },
  async restore(file, external) {
    if (!dbPath) throw new Error('Base de datos no abierta');
    const src = external ? file : path.join(backups.dir(), path.basename(file));
    if (!fs.existsSync(src)) throw new Error('Respaldo no encontrado');
    fs.copyFileSync(src, dbPath);
    await open(dbPath);
    return { restored: path.basename(src) };
  }
};

module.exports = {
  open, close, persistNow,
  hashPassword, verifyPassword,
  auth, users, employees, vacaciones, horasExtra, incentivos, pagoVacaciones, deduccionesManuales, salarioHistorial, liquidaciones, reportes, audit, settings, mailLog, contactos, historial, backups, nowIso
};
