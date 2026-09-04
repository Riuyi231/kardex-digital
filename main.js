const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

(function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m || m[1] === '') continue;
        let value = m[2].replace(/^["']|["']$/g, '').trim();
        if (value) process.env[m[1]] = value;
      }
    }
  } catch (e) { /* .env opcional */ }
})();

const dbLocal = require('./services/db');
const dbCloud = require('./services/db-cloud-client');
const config = require('./services/config');
const license = require('./services/license');
const { processFile } = require('./services/cedula');
const pdf = require('./services/pdf');
const nomina = require('./services/nomina');
const documentos = require('./services/documentos');
const plantillas = require('./services/plantillas');
const excel = require('./services/excel');
const notificaciones = require('./services/notificaciones');
const importService = require('./services/import');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Valida el tope de empleados activos de la licencia local. 0 = sin límite.
function enforceEmployeeCapacity(needed = 1) {
  const max = license.maxEmployees();
  if (max <= 0) return;
  const activos = db.employees.stats().activos;
  if (activos + needed > max) {
    throw new Error('Límite de empleados alcanzado: tu licencia permite ' + max +
      ' empleado(s) activo(s) y ya hay ' + activos + '. Contacta al proveedor para aumentar el límite.');
  }
}

function toBufferArg(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (x && x.type === 'Buffer' && Array.isArray(x.data)) return Buffer.from(x.data);
  throw new Error('Archivo no recibido correctamente');
}

let mainWindow = null;
let currentUser = null;
let db = null;

// Envía un archivo al servidor cloud (internet, OAuth Bearer) para que ejecute el
// OCR y devuelva los campos de la cédula con el mismo shape que processFile local.
async function processCedulaCloud(filePath, cloudUrl, token) {
  if (!fs.existsSync(filePath)) throw new Error('El archivo no existe');
  const data = fs.readFileSync(filePath).toString('base64');
  const name = path.basename(filePath);
  const url = String(cloudUrl).replace(/\/+$/, '') + '/api/ocr';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + (token || ''),
        'x-kardex-node': require('./services/machine').machineId()
      },
      body: JSON.stringify({ name, data })
    });
  } catch (e) {
    throw new Error('No se pudo contactar el servidor cloud para el OCR: ' + (e.message || e));
  }
  if (resp.status === 404) {
    const err = new Error('OCR en la nube no disponible en el servidor');
    err.code = 'OCR_REMOTE_UNAVAILABLE';
    throw err;
  }
  if (resp.status === 401 || resp.status === 403) {
    const payload = await resp.json().catch(() => null);
    throw new Error('Sin autorización para el OCR en la nube: ' + ((payload && payload.error) || resp.status));
  }
  const payload = await resp.json().catch(() => null);
  if (!payload) throw new Error('El servidor cloud devolvió una respuesta inválida');
  if (payload.ok) {
    return {
      ...payload.data,
      fileName: payload.data && payload.data.name ? payload.data.name : name
    };
  }
  throw new Error('OCR en la nube falló: ' + (payload.error || 'error desconocido'));
}

function dataDir() {
  if (process.env.KARDEX_DATA_DIR) return process.env.KARDEX_DATA_DIR;
  if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR) {
    const portable = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    try {
      fs.mkdirSync(portable, { recursive: true });
      return portable;
    } catch (e) { /* si falla (ej. USB bloqueada), usar perfil de usuario */ }
  }
  return path.join(app.getPath('userData'), 'data');
}

function configPath() {
  if (process.env.KARDEX_CONFIG) return process.env.KARDEX_CONFIG;
  if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'kardex-config.json');
  }
  return path.join(app.getPath('userData'), 'kardex-config.json');
}

function loadAiKeysFromDb() {
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY']) {
    try {
      const v = db.settings.get(k);
      if (v) process.env[k] = v;
    } catch (e) { /* noop */ }
  }
}

async function openDb() {
  const dir = dataDir();
  const cfg = config.load(configPath());
  const activeDb = require('./services/active-db');
  if (cfg.cloud && cfg.cloud.enabled && cfg.cloud.url) {
    dbCloud.configure({ url: cfg.cloud.url, token: cfg.cloud.token || '' });
    db = dbCloud;
    activeDb.setActive(db);
    const ping = await dbCloud.ping();
    if (ping.ok) {
      loadAiKeysFromDb();
      console.log('[KARDEX] Conectado al servidor cloud:', cfg.cloud.url);
    } else {
      console.warn('[KARDEX] Servidor cloud no alcanzable en', cfg.cloud.url + ':', ping.error);
    }
  } else {
    db = dbLocal;
    activeDb.setActive(db);
    fs.mkdirSync(dir, { recursive: true });
    await dbLocal.open(path.join(dir, 'kardex.db'));
    loadAiKeysFromDb();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'KARDEX Digital',
    icon: path.join(__dirname, 'resources', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function requireAuth() {
  if (!currentUser) throw new Error('Sesión no iniciada');
  return currentUser;
}

function requireRole(roles) {
  const user = requireAuth();
  if (!roles.includes(user.role)) {
    throw new Error('No tiene permisos para realizar esta acción');
  }
  return user;
}

function wrap(fn) {
  return async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };
}

/* ============ Notificaciones ============ */
let notifTimer = null;

function notifSettings() {
  const s = {};
  for (const k of Object.keys(notificaciones.DEFAULTS)) {
    const v = db.settings.get(k);
    s[k] = v != null ? v : notificaciones.DEFAULTS[k];
  }
  return s;
}

function computeNotificaciones() {
  return notificaciones.computeEvents({
    employees: db.employees.list('', 'activo'),
    vacaciones: db.vacaciones.list()
  }, notifSettings());
}

function pushNotificaciones(events) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notificaciones:update', { events, resumen: notificaciones.resumen(events) });
  }
}

function checkAndNotify() {
  if (!currentUser) return;
  const settings = notifSettings();
  const events = computeNotificaciones();
  pushNotificaciones(events);
  if (settings.notif_activadas !== 'true') return;
  if (!Notification.isSupported()) return;
  for (const ev of events) {
    if (!ev.en_ventana) continue;
    const key = 'notif_' + ev.id;
    if (db.settings.get(key)) continue;
    try {
      new Notification({ title: 'KARDEX Digital · ' + ev.titulo, body: ev.descripcion, silent: false }).show();
      db.settings.set(key, '1');
    } catch (e) { /* noop */ }
  }
}

function startNotifLoop() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(checkAndNotify, 30 * 60 * 1000);
}

function runAutoBackupIfDue() {
  try {
    if (db.settings.get('backup_auto') !== 'true') return;
    const today = new Date().toISOString().slice(0, 10);
    if (db.settings.get('last_auto_backup') === today) return;
    db.backups.create(true);
    db.settings.set('last_auto_backup', today);
    console.log('[KARDEX] Respaldo automático creado');
  } catch (e) {
    console.error('Error en respaldo automático:', e);
  }
}

function registerIpc() {

  ipcMain.handle('update:check', wrap(async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, updateInfo: result && result.updateInfo ? { version: result.updateInfo.version } : null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }));
  ipcMain.handle('update:download', wrap(async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }));
  ipcMain.handle('update:install', wrap(() => {
    autoUpdater.quitAndInstall(false, true);
  }));

  ipcMain.handle('system:get-config', wrap(() => {
    const cfg = config.load(configPath());
    const cfgExists = fs.existsSync(configPath());
    const cloudActive = cfg.cloud && cfg.cloud.enabled && cfg.cloud.url;
    return {
      mode: cloudActive ? 'cloud' : 'local',
      cloud: { url: cfg.cloud.url || '', token: cfg.cloud.token || '', enabled: !!cfg.cloud.enabled },
      dataDir: dataDir(),
      firstRun: !cfgExists && !cfg.wizardDone && !(cfg.cloud && cfg.cloud.enabled)
    };
  }));

  ipcMain.handle('system:set-config', wrap((e, { mode, url } = {}) => {
    // La app solo ofrece modo local y modo cloud (se eliminó el servidor LAN).
    // Al volver a local se desactiva la conexión a la nube para que el reinicio
    // (openDb) respete la elección y no vuelva a conectar donde no corresponde.
    const cloudOff = { url: '', token: '', enabled: false };
    if (mode === 'cloud') {
      const clean = String(url || '').trim().replace(/\/+$/, '');
      config.save(configPath(), { url: clean, mode: 'cloud', cloud: { url: clean, token: '', enabled: true } });
    } else {
      config.save(configPath(), { url: '', mode: 'local', cloud: cloudOff });
    }
    return config.load(configPath());
  }));

  ipcMain.handle('system:set-cloud', wrap((e, { url, token, enabled } = {}) => {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    config.save(configPath(), { cloud: { url: clean, token: String(token || ''), enabled: !!enabled } });
    return config.load(configPath());
  }));

  ipcMain.handle('system:test-cloud', wrap(async (e, { url } = {}) => {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(u)) throw new Error('La direccion debe comenzar con http:// o https://');
    const resp = await fetch(u + '/api/ping', { signal: AbortSignal.timeout(6000) });
    const text = await resp.text();
    let j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error('El servidor respondio de forma invalida'); }
    if (!resp.ok || !j.ok) throw new Error(j.error || 'El servidor no reconocio la solicitud');
    return j;
  }));

  ipcMain.handle('auth:cloud-login', wrap(async (e, { username, password } = {}) => {
    const cfg = config.load(configPath());
    if (!cfg.cloud || !cfg.cloud.url) throw new Error('Configura primero la dirección del servidor cloud');
    dbCloud.configure({ url: cfg.cloud.url, token: '' });
    const result = await dbCloud.cloudLogin(String(username || '').trim(), String(password || ''));
    config.save(configPath(), { cloud: { url: cfg.cloud.url, token: result.token, enabled: true } });
    currentUser = result.user || currentUser;
    return { user: currentUser, token: result.token };
  }));

  ipcMain.handle('system:wizard-done', wrap(() => {
    config.markWizardDone(configPath());
    return true;
  }));

  ipcMain.handle('system:restart', wrap(() => {
    app.relaunch();
    app.exit(0);
    return true;
  }));

  ipcMain.handle('license:status', wrap(() => ({
    ...license.getStatus(),
    machineId: license.machineId(),
    maxEmployees: license.maxEmployees()
  })));

  ipcMain.handle('license:activate', wrap((e, { key } = {}) => {
    const payload = license.activate(String(key || '').trim());
    return { ok: true, payload };
  }));

  ipcMain.handle('auth:login', wrap((e, { username, password }) => {
    const lic = license.canUse();
    const user = db.auth.login(username, password);
    if (!user) throw new Error('Usuario o contraseña incorrectos');
    if (!lic.ok && user.role !== 'admin') {
      throw new Error('Licencia de KARDEX no disponible: ' + lic.reason + '. Contacte al administrador.');
    }
    currentUser = user;
    db.audit.add(user, 'login', 'Inicio de sesión');
    checkAndNotify();
    return { ...user, licenseWarning: !lic.ok ? lic.reason : null };
  }));

  ipcMain.handle('auth:logout', wrap(() => {
    if (currentUser) db.audit.add(currentUser, 'logout', 'Cierre de sesión');
    currentUser = null;
    return true;
  }));

  ipcMain.handle('auth:me', wrap(() => currentUser));

  ipcMain.handle('users:list', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.users.list();
  }));

  ipcMain.handle('users:create', wrap((e, payload) => {
    const user = requireRole(['admin']);
    const created = db.users.create(payload);
    db.audit.add(user, 'users:create', `${payload.username} (${payload.role})`);
    return created;
  }));

  ipcMain.handle('users:update', wrap((e, payload) => {
    const user = requireRole(['admin']);
    const updated = db.users.update(payload.id, payload);
    db.audit.add(user, 'users:update', `Usuario #${payload.id}`);
    return updated;
  }));

  ipcMain.handle('users:delete', wrap((e, payload) => {
    const user = requireRole(['admin']);
    if (payload.id === currentUser.id) throw new Error('No puede eliminar su propio usuario');
    const target = db.users.get(payload.id);
    db.users.delete(payload.id);
    db.audit.add(user, 'users:delete', `Usuario "${target ? target.username : payload.id}"`);
    return true;
  }));

  ipcMain.handle('employees:list', wrap((e, { search, status, fecha_col, fecha_desde, fecha_hasta } = {}) => {
    requireAuth();
    return db.employees.list(search, status, { fecha_col, fecha_desde, fecha_hasta });
  }));

  ipcMain.handle('employees:stats', wrap(() => {
    requireAuth();
    return db.employees.stats();
  }));

  ipcMain.handle('employees:setStatus', wrap((e, { id, status, extra } = {}) => {
    const user = requireRole(['admin', 'editor']);
    if (status === 'activo') {
      const rec = db.employees.get(id);
      if (rec && rec.status !== 'activo') enforceEmployeeCapacity(1);
    }
    const rec = db.employees.setStatus(id, status, Object.assign({}, extra || {}, { userId: user.id }));
    db.audit.add(user, 'employees:setStatus', `#${id} -> ${status}`);
    return rec;
  }));

  ipcMain.handle('employees:get', wrap((e, { id }) => {
    requireAuth();
    const rec = db.employees.get(id);
    if (!rec) throw new Error('Registro no encontrado');
    return rec;
  }));

  ipcMain.handle('employees:create', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    enforceEmployeeCapacity(1);
    const created = db.employees.create(data, user.id);
    db.audit.add(user, 'employees:create', `Cédula ${created.cedula || 's/n'}`);
    return created;
  }));

  ipcMain.handle('employees:update', wrap((e, { id, data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const updated = db.employees.update(id, data, user.id);
    db.audit.add(user, 'employees:update', `Registro #${id}`);
    return updated;
  }));

  ipcMain.handle('employees:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.employees.delete(id);
    db.audit.add(user, 'employees:delete', `Registro #${id}`);
    return true;
  }));

  ipcMain.handle('audit:list', wrap((e, { limit } = {}) => {
    requireRole(['admin']);
    return db.audit.list(limit);
  }));

  ipcMain.handle('cedula:pickFile', wrap(async () => {
    requireRole(['admin', 'editor']);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccione el PDF o imagen de la cédula',
      filters: [
        { name: 'Cédula (PDF / imagen)', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  }));

  ipcMain.handle('cedula:process', wrap(async (e, { path: filePath }) => {
    requireRole(['admin', 'editor']);
    const cfg = config.load(configPath());
    const cloudActive = !!(cfg.cloud && cfg.cloud.enabled && cfg.cloud.url);
    // En modo cloud, la PC sube el PDF y el servidor en internet ejecuta el OCR.
    if (cloudActive) {
      try {
        return await processCedulaCloud(filePath, cfg.cloud.url, cfg.cloud.token);
      } catch (err) {
        // Si el servidor cloud no expone aún el endpoint OCR, seguimos bajando
        // al OCR local en lugar de bloquear la carga.
        if (err && err.code !== 'OCR_REMOTE_UNAVAILABLE') throw err;
      }
    }
    return await processFile(filePath);
  }));

  ipcMain.handle('ai:status', wrap(() => {
    const openai = require('./services/ai-extract');
    const gemini = require('./services/ai-gemini');
    const providers = [];
    if (openai.isConfigured()) providers.push('openai');
    if (gemini.isConfigured()) providers.push('gemini');
    console.log('[KARDEX] ai:status -> proveedores:', JSON.stringify(providers));
    return { configured: providers.length > 0, providers };
  }));

  ipcMain.handle('diag:status', wrap(() => {
    const ocr = require('./services/ocr');
    const { isNative, implementation } = require('./services/canvas');
    const fs2 = require('fs');
    const path2 = require('path');
    const tessPath = path2.join(__dirname, 'resources', 'tessdata', 'spa.traineddata.gz');
    const tessUnzipped = path2.join(__dirname, 'resources', 'tessdata', 'spa.traineddata');
    return {
      canvas: { native: isNative, implementation },
      tessdata: fs2.existsSync(tessPath) || fs2.existsSync(tessUnzipped),
      tessdataPath: tessPath,
      ocrReady: ocr.tessdataReady(),
      node: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }));

  ipcMain.handle('ai:settings', wrap(() => {
    requireRole(['admin', 'editor']);
    return {
      openai: (db.settings.get('OPENAI_API_KEY') || '').trim(),
      gemini: (db.settings.get('GEMINI_API_KEY') || '').trim()
    };
  }));

  ipcMain.handle('ai:save-settings', wrap((e, { settings: s } = {}) => {
    const user = requireRole(['admin', 'editor']);
    for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY']) {
      const v = (s && s[k] !== undefined) ? String(s[k]).trim() : '';
      db.settings.set(k, v);
      process.env[k] = v;
    }
    db.audit.add(user, 'ai:save-settings', 'Claves de IA actualizadas');
    return {
      openai: (db.settings.get('OPENAI_API_KEY') || '').trim(),
      gemini: (db.settings.get('GEMINI_API_KEY') || '').trim()
    };
  }));

  ipcMain.handle('ai:extract', wrap(async (e, { front, back, provider }) => {
    const user = requireRole(['admin', 'editor']);
    if (!front) throw new Error('No hay imagen del frente para analizar');

    const openai = require('./services/ai-extract');
    const gemini = require('./services/ai-gemini');

    const providers = [];
    if (openai.isConfigured()) providers.push('openai');
    if (gemini.isConfigured()) providers.push('gemini');
    console.log('[KARDEX] ai:extract -> pedido provider:', provider, '| configurados:', JSON.stringify(providers));
    if (providers.length === 0) {
      throw new Error('No hay ninguna clave de IA configurada (OPENAI_API_KEY o GEMINI_API_KEY en el archivo .env).');
    }

    let selected = provider;
    if (!selected || !providers.includes(selected)) {
      selected = providers.includes('gemini') ? 'gemini' : providers[0];
    }
    console.log('[KARDEX] ai:extract -> usando:', selected);

    const result = selected === 'gemini'
      ? await gemini.extractCedulaWithGemini({ front, back: back || null })
      : await openai.extractCedulaWithAI({ front, back: back || null });

    db.audit.add(user, 'ai:extract', `Extracción de cédula con IA (${selected})`);
    return { ...result, provider: selected };
  }));

  function nominaInputs(mes, anio, employee_id, departamento) {
    const now = new Date();
    const m = mes || now.getMonth() + 1;
    const y = anio || now.getFullYear();
    const actives = db.employees.list('', 'activo').filter(e => !e.es_propietario);
    let empList = employee_id ? actives.filter(a => a.id === Number(employee_id)) : actives;
    if (departamento) empList = empList.filter(a => (a.departamento || '') === departamento);
    const extras = {};
    for (const ex of db.horasExtra.listForPeriod(m, y)) extras[ex.employee_id] = ex;
    const incentivos = {};
    for (const i of db.incentivos.listForPeriod(m, y)) {
      if (!incentivos[i.employee_id]) incentivos[i.employee_id] = [];
      incentivos[i.employee_id].push(i);
    }
    const pagosVacaciones = {};
    for (const pv of db.pagoVacaciones.listForPeriod(m, y)) pagosVacaciones[pv.employee_id] = pv;
    const deduccionesManuales = {};
    for (const d of db.deduccionesManuales.listForPeriod(m, y)) {
      if (!deduccionesManuales[d.employee_id]) deduccionesManuales[d.employee_id] = [];
      deduccionesManuales[d.employee_id].push(d);
    }
    return { m, y, empList, extras, incentivos, pagosVacaciones, deduccionesManuales };
  }

  ipcMain.handle('nomina:calcular', wrap((e, { mes, anio, employee_id, departamento } = {}) => {
    requireRole(['admin', 'editor']);
    const { m, y, empList, extras, incentivos, pagosVacaciones } = nominaInputs(mes, anio, employee_id, departamento);
    return nomina.calcNomina(empList, m, y, extras, incentivos, pagosVacaciones);
  }));

  ipcMain.handle('nomina:quincenal', wrap((e, { mes, anio, employee_id, departamento } = {}) => {
    requireRole(['admin', 'editor']);
    const { m, y, empList, extras, incentivos, pagosVacaciones, deduccionesManuales } = nominaInputs(mes, anio, employee_id, departamento);
    return nomina.calcNominaQuincenal(empList, m, y, extras, incentivos, pagosVacaciones, deduccionesManuales);
  }));

  ipcMain.handle('nomina:semanal', wrap((e, { mes, anio, employee_id, departamento } = {}) => {
    requireRole(['admin', 'editor']);
    const { m, y, empList, extras, incentivos, pagosVacaciones } = nominaInputs(mes, anio, employee_id, departamento);
    return nomina.calcNominaSemanal(empList, m, y, extras, incentivos, pagosVacaciones);
  }));

  ipcMain.handle('nomina:diario', wrap((e, { mes, anio, employee_id, departamento } = {}) => {
    requireRole(['admin', 'editor']);
    const { m, y, empList, extras, incentivos, pagosVacaciones } = nominaInputs(mes, anio, employee_id, departamento);
    return nomina.calcNominaDiaria(empList, m, y, extras, incentivos, pagosVacaciones);
  }));

  // Resumen de pago de vacaciones de un empleado: días guardados del expediente,
  // días ya pagados vía nómina, disponibles, y salario diario para el cálculo.
  ipcMain.handle('pagoVacaciones:resumen', wrap((e, { employee_id, mes, anio } = {}) => {
    requireRole(['admin', 'editor']);
    const rec = db.employees.get(Number(employee_id));
    if (!rec) throw new Error('Registro no encontrado');
    const guardados = (db.vacaciones.list(Number(employee_id)) || [])
      .filter(v => v.modalidad === 'pagadas_parcial')
      .reduce((sum, v) => sum + (Number(v.dias_guardados) || 0), 0);
    const pagadosDias = db.pagoVacaciones.totalDiasPagados(Number(employee_id));
    const disponibles = Math.max(0, nomina.round1(guardados - pagadosDias));
    const sm = nomina.salarioMensual(rec.salario, rec.tipo_salario);
    const sd = nomina.salarioDiario(sm);
    const periodo = db.pagoVacaciones.get(Number(employee_id), mes, anio);
    return {
      guardados: nomina.round1(guardados),
      pagados_dias: nomina.round1(pagadosDias),
      disponibles,
      salario_diario: sd,
      salario_mensual: nomina.round2(sm),
      periodo: periodo || { employee_id: Number(employee_id), mes: Number(mes || new Date().getMonth() + 1), anio: Number(anio || new Date().getFullYear()), dias: 0, monto: 0, modalidad: 'personalizada', nota: '' }
    };
  }));

  ipcMain.handle('pagoVacaciones:save', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const rec = db.employees.get(Number(data.employee_id));
    if (!rec) throw new Error('Registro no encontrado');
    const sm = nomina.salarioMensual(rec.salario, rec.tipo_salario);
    const sd = nomina.salarioDiario(sm);
    const dias = Number(data.dias) || 0;
    const monto = nomina.round2(dias * sd);
    const saved = db.pagoVacaciones.save(Object.assign({}, data, { monto }), user.id);
    db.audit.add(user, 'pagoVacaciones:save', `#${saved.employee_id} ${saved.mes}/${saved.anio} (${saved.dias} días, RD$ ${saved.monto})`);
    return saved;
  }));

  ipcMain.handle('pagoVacaciones:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.pagoVacaciones.delete(id);
    db.audit.add(user, 'pagoVacaciones:delete', `Pago #${id}`);
    return true;
  }));

  ipcMain.handle('horasExtra:get', wrap((e, { employee_id, mes, anio } = {}) => {
    requireRole(['admin', 'editor']);
    return db.horasExtra.get(employee_id, mes, anio) || {
      employee_id: Number(employee_id), mes: Number(mes), anio: Number(anio),
      horas_extra: 0, domingos_extra: 0, feriados_extra: 0, otros_ingresos: 0, nota: ''
    };
  }));

  ipcMain.handle('horasExtra:save', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const saved = db.horasExtra.save(data);
    db.audit.add(user, 'horasExtra:save', `#${saved.employee_id} ${saved.mes}/${saved.anio} (${saved.horas_extra} h, ${saved.domingos_extra} dom.)`);
    return saved;
  }));

  ipcMain.handle('incentivos:list', wrap((e, { employee_id, mes, anio } = {}) => {
    requireRole(['admin', 'editor']);
    return db.incentivos.list(employee_id, mes, anio);
  }));

  ipcMain.handle('incentivos:create', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const created = db.incentivos.create(data, user.id);
    db.audit.add(user, 'incentivos:create', `#${created.employee_id} ${created.mes}/${created.anio} RD$ ${created.monto}`);
    return created;
  }));

  ipcMain.handle('incentivos:update', wrap((e, { id, data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const updated = db.incentivos.update(id, data, user.id);
    db.audit.add(user, 'incentivos:update', `Incentivo #${id}`);
    return updated;
  }));

  ipcMain.handle('incentivos:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.incentivos.delete(id);
    db.audit.add(user, 'incentivos:delete', `Incentivo #${id}`);
    return true;
  }));

  ipcMain.handle('deducciones:list', wrap((e, { employee_id, mes, anio } = {}) => {
    requireRole(['admin', 'editor']);
    if (employee_id) return db.deduccionesManuales.listForEmployee(employee_id, mes, anio);
    return db.deduccionesManuales.listForPeriod(mes, anio);
  }));

  ipcMain.handle('deducciones:create', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const created = db.deduccionesManuales.create(data, user.id);
    db.audit.add(user, 'deducciones:create', `#${created.employee_id} ${created.mes}/${created.anio} Q${created.quincena} RD$ ${created.monto}`);
    return created;
  }));

  ipcMain.handle('deducciones:update', wrap((e, { id, data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const updated = db.deduccionesManuales.update(id, data);
    db.audit.add(user, 'deducciones:update', `Deducción #${id}`);
    return updated;
  }));

  ipcMain.handle('deducciones:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.deduccionesManuales.delete(id);
    db.audit.add(user, 'deducciones:delete', `Deducción #${id}`);
    return true;
  }));

  ipcMain.handle('nomina:liquidacion', wrap((e, { id, fecha_baja, opciones } = {}) => {
    requireRole(['admin', 'editor']);
    const rec = db.employees.get(id);
    if (!rec) throw new Error('Registro no encontrado');
    return nomina.calcLiquidacion(Object.assign({}, rec, { fecha_baja: fecha_baja || nomina.nowIsoLike() }, opciones || {}));
  }));

  // Confirma la baja: calcula la liquidación, la guarda en el historial de finiquitos
  // y marca al empleado como inactivo con su fecha de baja.
  ipcMain.handle('liquidacion:confirmar', wrap((e, { id, fecha_baja, opciones } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const rec = db.employees.get(id);
    if (!rec) throw new Error('Registro no encontrado');
    const fb = fecha_baja || nomina.nowIsoLike();
    const liq = nomina.calcLiquidacion(Object.assign({}, rec, { fecha_baja: fb }, opciones || {}));
    const saved = db.liquidaciones.save(Object.assign({ employee_id: id }, liq, {
      fecha_baja: fb,
      ha_sido_preavisado: !!(opciones && opciones.ha_sido_preavisado),
      incluir_cesantia: !opciones || opciones.incluir_cesantia !== false,
      tomo_vacaciones_ultimo_ano: !opciones || opciones.tomo_vacaciones_ultimo_ano !== false,
      incluir_salario_navidad: !opciones || opciones.incluir_salario_navidad !== false
    }), user.id);
    db.employees.setStatus(id, 'inactivo', { fecha_baja: fb, userId: user.id });
    db.audit.add(user, 'liquidacion:confirmar', `#${id} ${rec.nombres} ${rec.apellidos} · RD$ ${liq.total}`);
    return { liquidacion: saved, empleado: db.employees.get(id) };
  }));

  ipcMain.handle('liquidacion:list', wrap((e, { employee_id } = {}) => {
    requireRole(['admin', 'editor']);
    return db.liquidaciones.listForEmployee(employee_id);
  }));

  ipcMain.handle('liquidacion:listAll', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.liquidaciones.listAll();
  }));

  ipcMain.handle('liquidacion:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.liquidaciones.delete(id);
    db.audit.add(user, 'liquidacion:delete', `Finiquito #${id}`);
    return true;
  }));

  ipcMain.handle('nomina:regalia', wrap(async (e, { anio } = {}) => {
    requireRole(['admin', 'editor']);
    const actives = db.employees.list('', 'activo').filter(e => !e.es_propietario);
    let hist = null;
    if (db.salarioHistorial && typeof db.salarioHistorial.getRegaliaMasivo === 'function') {
      try { hist = await db.salarioHistorial.getRegaliaMasivo(anio); } catch (err) { hist = null; }
    }
    const histFn = hist && hist.salarios ? (id) => hist.salarios[id] : db.salarioHistorial.getSalarioPromedio;
    const listFn = hist && hist.cambios ? (id) => hist.cambios[id] || [] : db.salarioHistorial.listForEmployee;
    return nomina.calcRegalia(actives, anio, histFn, listFn);
  }));

  ipcMain.handle('salarios:reset-base', wrap((e) => {
    const user = requireRole(['admin']);
    const res = db.salarioHistorial.resetBaseline();
    db.audit.add(user, 'salarios:reset-base', `Historial de salarios reiniciado (año ${res.anio}, base aplicada a ${res.registros} empleados)`);
    return res;
  }));

  ipcMain.handle('export:excel', wrap(async (e, { filename, sheets } = {}) => {
    requireRole(['admin', 'editor']);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar archivo Excel',
      defaultPath: path.join(app.getPath('documents'), (filename || 'export') + '.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return null;
    await excel.writeExcelSheets(res.filePath, sheets);
    return res.filePath;
  }));

  // Diálogo nativo para elegir la quincena a exportar (window.prompt no funciona en Electron).
  ipcMain.handle('export:choose-quincena', wrap(async (e, { defOpc = 1 } = {}) => {
    requireRole(['admin', 'editor']);
    const defaultId = defOpc === 1 ? 0 : defOpc === 2 ? 1 : 2;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Primera quincena', 'Segunda quincena', 'Mes completo', 'Cancelar'],
      defaultId,
      cancelId: 3,
      title: 'Exportar nómina quincenal',
      message: '¿Qué período desea exportar?',
      detail: 'Primera quincena (sin retenciones)\nSegunda quincena (con retenciones)\nMes completo (ambas quincenas)'
    });
    if (response === 3 || response === -1) return null;
    return response + 1;
  }));

  // Confirmación nativa (window.confirm no funciona en Electron).
  ipcMain.handle('dialog:confirm', wrap(async (e, { message = '' } = {}) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancelar', 'Aceptar'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirmar',
      message: String(message),
      noLink: true
    });
    return response === 1;
  }));

  function sanitizeFilename(s) {
    return String(s || 'empleado').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  ipcMain.handle('export:cedula-pdf', wrap(async (e, { employee_id } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const emp = db.employees.get(Number(employee_id));
    if (!emp) throw new Error('Empleado no encontrado');
    if (!((emp.frente && /^data:/.test(emp.frente)) || (emp.reverso && /^data:/.test(emp.reverso)))) {
      throw new Error('Este empleado no tiene cédula cargada');
    }
    const base = sanitizeFilename(`${emp.apellidos}_${emp.nombres}`);
    const ced = sanitizeFilename(emp.cedula || '');
    const buf = await pdf.buildCedulaPdf([emp]);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF de la cédula',
      defaultPath: path.join(app.getPath('documents'), `cedula_${base}${ced ? '_' + ced : ''}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buf);
    db.audit.add(user, 'export:cedula-pdf', `Empleado #${emp.id} ${emp.nombres} ${emp.apellidos}`);
    return res.filePath;
  }));

  ipcMain.handle('export:cedulas-pdf', wrap(async (e) => {
    const user = requireRole(['admin', 'editor']);
    const actives = db.employees.list('', 'activo');
    const ids = actives.filter(a => a.has_images).map(a => a.id);
    if (!ids.length) throw new Error('No hay empleados activos con cédula cargada');
    const full = ids.map(id => db.employees.get(id));
    const buf = await pdf.buildCedulaPdf(full);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF de cédulas',
      defaultPath: path.join(app.getPath('documents'), 'cedulas_empleados.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buf);
    db.audit.add(user, 'export:cedulas-pdf', `${full.length} empleado(s)`);
    return res.filePath;
  }));

  ipcMain.handle('reportes:plantilla', wrap((e, { status } = {}) => {
    requireRole(['admin', 'editor']);
    return db.reportes.plantilla(status);
  }));

  ipcMain.handle('reportes:antiguedad', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.antiguedad();
  }));

  ipcMain.handle('reportes:print', wrap(async (e, { title = '', html = '' } = {}) => {
    requireAuth();
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    try {
      const success = await win.webContents.print({ silent: false, printBackground: true });
      if (!success) throw new Error('No se pudo completar la impresión (puede que no haya impresora o el diálogo se canceló).');
      return true;
    } finally {
      win.destroy();
    }
  }));

  ipcMain.handle('reportes:pdf', wrap(async (e, { title = '', html = '' } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
    win.destroy();
    const fname = sanitizeFilename(String(title).toLowerCase() || 'reporte');
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar reporte PDF',
      defaultPath: path.join(app.getPath('documents'), `${fname}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buf);
    db.audit.add(user, 'reportes:pdf', title);
    return res.filePath;
  }));

  ipcMain.handle('reportes:cumpleanos', wrap((e, { mes } = {}) => {
    requireRole(['admin', 'editor']);
    return db.reportes.cumpleanos(mes);
  }));

  ipcMain.handle('reportes:departamentos', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.departamentos();
  }));

  ipcMain.handle('reportes:nomina-departamentos', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.nominaDepartamentos();
  }));

  ipcMain.handle('reportes:empleados', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.empleadosCompleto();
  }));

  ipcMain.handle('reportes:cedulas-vencer', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.cedulasVencer();
  }));

  ipcMain.handle('reportes:aniversarios', wrap((e, { anio } = {}) => {
    requireRole(['admin', 'editor']);
    return db.reportes.aniversarios(anio);
  }));

  ipcMain.handle('reportes:beneficios', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.reportes.beneficios();
  }));

  ipcMain.handle('vacaciones:list', wrap((e, { employee_id } = {}) => {
    requireAuth();
    return db.vacaciones.list(employee_id);
  }));

  ipcMain.handle('vacaciones:create', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const created = db.vacaciones.create(data, user.id);
    db.audit.add(user, 'vacaciones:create', `Empleado #${data.employee_id} (${data.tipo})`);
    return created;
  }));

  ipcMain.handle('vacaciones:delete', wrap((e, { id }) => {
    const user = requireRole(['admin', 'editor']);
    db.vacaciones.delete(id);
    db.audit.add(user, 'vacaciones:delete', `Registro #${id}`);
    return true;
  }));

  ipcMain.handle('notificaciones:list', wrap(() => {
    requireRole(['admin', 'editor']);
    const events = computeNotificaciones();
    return { events, resumen: notificaciones.resumen(events) };
  }));

  ipcMain.handle('notificaciones:settings', wrap(() => {
    requireAuth();
    return notifSettings();
  }));

  ipcMain.handle('notificaciones:saveSettings', wrap((e, { settings: s } = {}) => {
    requireRole(['admin', 'editor']);
    for (const k of Object.keys(notificaciones.DEFAULTS)) {
      if (s && s[k] !== undefined) db.settings.set(k, s[k]);
    }
    return notifSettings();
  }));

  ipcMain.handle('notificaciones:test', wrap(() => {
    requireRole(['admin', 'editor']);
    if (!Notification.isSupported()) throw new Error('Las notificaciones no están soportadas en este sistema');
    new Notification({ title: 'KARDEX Digital', body: 'Notificación de prueba. ¡Funciona!', silent: false }).show();
    return true;
  }));

  ipcMain.handle('correos:mailto', wrap(async (e, { to = '', subject = '', body = '', cc = '' } = {}) => {
    requireRole(['admin', 'editor']);
    try {
      const params = [];
      if (subject) params.push('subject=' + encodeURIComponent(subject));
      if (body) params.push('body=' + encodeURIComponent(body));
      if (cc) params.push('cc=' + encodeURIComponent(cc));
      const url = 'mailto:' + encodeURIComponent(to) + (params.length ? '?' + params.join('&') : '');
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }));

  ipcMain.handle('correos:log', wrap((e, { limit } = {}) => {
    requireRole(['admin', 'editor']);
    return db.mailLog.list(Number(limit) || 50);
  }));

  ipcMain.handle('contactos:list', wrap(() => {
    requireRole(['admin', 'editor']);
    return db.contactos.list();
  }));

  ipcMain.handle('contactos:create', wrap((e, { data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const c = db.contactos.create(data || {});
    db.audit.add(user, 'contactos:create', `Contacto "${c.nombre}" agregado`);
    return c;
  }));

  ipcMain.handle('contactos:update', wrap((e, { id, data } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const c = db.contactos.update(Number(id), data || {});
    db.audit.add(user, 'contactos:update', `Contacto "${c.nombre}" actualizado`);
    return c;
  }));

  ipcMain.handle('contactos:delete', wrap((e, { id } = {}) => {
    const user = requireRole(['admin', 'editor']);
    db.contactos.delete(Number(id));
    db.audit.add(user, 'contactos:delete', `Contacto eliminado (id ${id})`);
    return true;
  }));

  /* ============ Respaldos ============ */

  ipcMain.handle('backup:create', wrap((e, { auto } = {}) => {
    const user = requireRole(['admin']);
    const b = db.backups.create(!!auto);
    db.audit.add(user, 'backup:create', `${auto ? 'Automático' : 'Manual'} · ${b.file}`);
    return b;
  }));

  ipcMain.handle('backup:list', wrap(() => {
    requireAuth();
    return db.backups.list();
  }));

  ipcMain.handle('backup:restore', wrap(async (e, { file } = {}) => {
    const user = requireRole(['admin']);
    const r = await db.backups.restore(file, false);
    db.audit.add(user, 'backup:restore', `Restaurado ${r.restored}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    return r;
  }));

  ipcMain.handle('backup:restore-file', wrap(async (e, payload) => {
    const user = requireRole(['admin']);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccione el respaldo (.db) a restaurar',
      filters: [{ name: 'Base de datos', extensions: ['db'] }],
      properties: ['openFile']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const r = await db.backups.restore(res.filePaths[0], true);
    db.audit.add(user, 'backup:restore', `Restaurado ${r.restored} (externo)`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    return r;
  }));

  ipcMain.handle('backup:settings', wrap(() => {
    requireAuth();
    return {
      auto: db.settings.get('backup_auto') === 'true',
      keep: Number(db.settings.get('backup_auto_keep') || 5),
      dir: String(db.settings.get('backup_dir') || '').trim()
    };
  }));

  ipcMain.handle('backup:saveSettings', wrap((e, { auto, keep, dir } = {}) => {
    requireRole(['admin']);
    db.settings.set('backup_auto', auto ? 'true' : 'false');
    db.settings.set('backup_auto_keep', String(Number(keep) > 0 ? Number(keep) : 5));
    if (dir !== undefined) {
      const clean = String(dir || '').trim();
      if (clean) {
        fs.mkdirSync(clean, { recursive: true });
        db.settings.set('backup_dir', clean);
      } else {
        db.settings.set('backup_dir', '');
      }
    }
    return true;
  }));

  ipcMain.handle('backup:pick-dir', wrap(async () => {
    requireRole(['admin']);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Carpeta para copia secundaria de respaldos (nube o red)',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  }));

  /* ============ Importación desde Excel ============ */

  ipcMain.handle('import:template', wrap(async () => {
    const user = requireRole(['admin', 'editor']);
    const buf = await importService.buildTemplate();
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar plantilla de importación',
      defaultPath: path.join(app.getPath('documents'), 'plantilla_importacion_empleados.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buf);
    db.audit.add(user, 'import:template', 'Plantilla de importación generada');
    return res.filePath;
  }));

  ipcMain.handle('import:parse', wrap(async (e, { buffer } = {}) => {
    requireRole(['admin', 'editor']);
    const buf = toBufferArg(buffer);
    const rows = await importService.parseWorkbook(buf);
    return { rows, total: rows.length };
  }));

  ipcMain.handle('import:run', wrap(async (e, { rows } = {}) => {
    const user = requireRole(['admin', 'editor']);
    if (!rows || !rows.length) throw new Error('No hay datos para importar');
    const localMode = db === dbLocal;
    const maxEmp = localMode ? license.maxEmployees() : 0;
    const r = await importService.importEmployees(rows, user.id, maxEmp);
    db.audit.add(user, 'import:run', `${r.imported} importado(s), ${r.skipped} omitido(s), ${r.errors.length} error(es)`);
    return r;
  }));

  /* ============ Documentos PDF ============ */

  function requireEmployee(id) {
    const emp = db.employees.get(Number(id));
    if (!emp) throw new Error('Empleado no encontrado');
    return emp;
  }

  async function saveDocFile(user, action, title, filename, buf) {
    const ext = filename.split('.').pop().toLowerCase();
    const filters = ext === 'docx'
      ? [{ name: 'Word', extensions: ['docx'] }]
      : [{ name: 'PDF', extensions: ['pdf'] }];
    const res = await dialog.showSaveDialog(mainWindow, {
      title,
      defaultPath: path.join(app.getPath('documents'), filename),
      filters
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buf);
    db.audit.add(user, action, filename);
    return res.filePath;
  }

  ipcMain.handle('export:constancia-pdf', wrap(async (e, { employee_id, format } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const emp = requireEmployee(employee_id);
    const base = sanitizeFilename(`${emp.apellidos}_${emp.nombres}`);
    const fmt = format === 'docx' ? 'docx' : 'pdf';
    const r = await plantillas.renderDoc('constancia', emp, fmt);
    return await saveDocFile(user, 'export:constancia-pdf', 'Guardar carta de trabajo', `carta_trabajo_${base}.${fmt}`, r.buffer);
  }));

  ipcMain.handle('export:carta-salario-pdf', wrap(async (e, { employee_id, format } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const emp = requireEmployee(employee_id);
    const base = sanitizeFilename(`${emp.apellidos}_${emp.nombres}`);
    const fmt = format === 'docx' ? 'docx' : 'pdf';
    const r = await plantillas.renderDoc('carta', emp, fmt);
    return await saveDocFile(user, 'export:carta-salario-pdf', 'Guardar carta de salario', `carta_salario_${base}.${fmt}`, r.buffer);
  }));

  ipcMain.handle('export:solicitud-pdf', wrap(async (e, { employee_id, format } = {}) => {
    const user = requireRole(['admin', 'editor']);
    const emp = requireEmployee(employee_id);
    const base = sanitizeFilename(`${emp.apellidos}_${emp.nombres}`);
    const fmt = format === 'docx' ? 'docx' : 'pdf';
    const r = await plantillas.renderDoc('solicitud', emp, fmt);
    return await saveDocFile(user, 'export:solicitud-pdf', 'Guardar solicitud de cuenta de nómina', `solicitud_cuenta_${base}.${fmt}`, r.buffer);
  }));

  /* ============ Modelos de documentos ============ */

  ipcMain.handle('docs:get-settings', wrap(() => {
    requireRole(['admin', 'editor']);
    return { settings: documentos.getSettings(), placeholders: documentos.PLACEHOLDERS };
  }));

  ipcMain.handle('docs:save-settings', wrap((e, payload) => {
    const user = requireRole(['admin', 'editor']);
    const s = documentos.saveSettings(payload);
    db.audit.add(user, 'docs:save-settings', 'Modelos de documentos actualizados');
    return s;
  }));

  /* ============ Hoja de vida (historial) ============ */

  ipcMain.handle('historial:list', wrap((e, { employee_id } = {}) => {
    requireAuth();
    return db.historial.list(Number(employee_id));
  }));

  /* ============ Reportes de gastos (planilla) ============ */

  // Agregados anuales por empleado: retenciones (SFS/AFP/ISR) y aportes patronales TSS.
  function reporteAnualEmpleados(anio) {
    const y = Number(anio) || new Date().getFullYear();
    const byId = {};
    for (let mes = 1; mes <= 12; mes++) {
      const { empList, extras, incentivos, pagosVacaciones } = nominaInputs(mes, y);
      const r = nomina.calcNomina(empList, mes, y, extras, incentivos, pagosVacaciones);
      for (const row of r.rows) {
        if (!byId[row.id]) {
          byId[row.id] = { id: row.id, apellidos: row.apellidos, nombres: row.nombres, cedula: row.cedula,
            bruto: 0, baseAFP: 0, baseSFS: 0, sfs: 0, afp: 0, isr: 0,
            sfsPatronal: 0, iessl: 0, srl: 0, afpPatronal: 0, infotep: 0 };
        }
        const e = byId[row.id];
        const ap = nomina.calcAportesPatronales(row.bruto);
        e.bruto = round2(e.bruto + row.bruto);
        e.baseAFP = round2(e.baseAFP + Math.min(row.bruto, nomina.AFP_TOPE));
        e.baseSFS = round2(e.baseSFS + Math.min(row.bruto, nomina.SFS_TOPE));
        e.sfs = round2(e.sfs + row.sfs);
        e.afp = round2(e.afp + row.afp);
        e.isr = round2(e.isr + row.isr);
        e.sfsPatronal = round2(e.sfsPatronal + ap.sfsPatronal);
        e.iessl = round2(e.iessl + ap.iessl);
        e.srl = round2(e.srl + ap.srl);
        e.afpPatronal = round2(e.afpPatronal + ap.afpPatronal);
        e.infotep = round2(e.infotep + ap.infotep);
      }
    }
    const rows = Object.values(byId).sort((a, b) => String(a.apellidos || '').localeCompare(String(b.apellidos || '')));
    return { anio: y, rows };
  }

  // GASTOS DEL EMPLEADO (antes Reporte 609): planilla anual de retenciones por empleado.
  function reporteGastosEmpleado(anio) {
    const { anio: y, rows } = reporteAnualEmpleados(anio);
    rows.forEach((r) => { r.retenciones = round2(r.sfs + r.afp + r.isr); });
    const totales = rows.reduce((t, r) => {
      t.bruto += r.bruto; t.sfs += r.sfs; t.afp += r.afp; t.isr += r.isr; t.retenciones += r.retenciones;
      return t;
    }, { bruto: 0, sfs: 0, afp: 0, isr: 0, retenciones: 0 });
    for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
    return { anio: y, rows, totales };
  }

  // GASTOS DE LA EMPRESA: costo patronal anual por empleado + totales.
  function reporteGastosEmpresa(anio) {
    const { anio: y, rows } = reporteAnualEmpleados(anio);
    rows.forEach((r) => {
      r.aporEmpleador = round2(r.sfsPatronal + r.iessl + r.srl + r.afpPatronal + r.infotep);
      r.totalEmpresa = round2(r.bruto + r.aporEmpleador);
    });
    const totales = rows.reduce((t, r) => {
      t.bruto += r.bruto;
      t.sfsPatronal += r.sfsPatronal; t.iessl += r.iessl; t.srl += r.srl;
      t.afpPatronal += r.afpPatronal; t.infotep += r.infotep;
      t.aporEmpleador += r.aporEmpleador;
      t.totalEmpresa += r.totalEmpresa;
      return t;
    }, { bruto: 0, sfsPatronal: 0, iessl: 0, srl: 0, afpPatronal: 0, infotep: 0, aporEmpleador: 0, totalEmpresa: 0 });
    for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
    return { anio: y, rows, totales };
  }

  // RIESGOS LABORALES: aporte patronal SRL (1.20%) sobre la base cotizable SFS.
  function reporteRiesgosLaborales(anio) {
    const { anio: y, rows } = reporteAnualEmpleados(anio);
    for (const r of rows) r.base = r.baseSFS;
    const totales = rows.reduce((t, r) => {
      t.bruto += r.bruto; t.base += r.base; t.srl += r.srl;
      return t;
    }, { bruto: 0, base: 0, srl: 0 });
    for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
    return { anio: y, rows, totales };
  }

  ipcMain.handle('reportes:gastos-empleado', wrap((e, { anio } = {}) => {
    requireRole(['admin', 'editor']);
    return reporteGastosEmpleado(anio);
  }));

  ipcMain.handle('reportes:gastos-empresa', wrap((e, { anio } = {}) => {
    requireRole(['admin', 'editor']);
    return reporteGastosEmpresa(anio);
  }));

  ipcMain.handle('reportes:riesgos-laborales', wrap((e, { anio } = {}) => {
    requireRole(['admin', 'editor']);
    return reporteRiesgosLaborales(anio);
  }));

  async function saveReportExcel(title, defaultName, sheetName, headers, rows, footer, auditKey, auditDetail) {
    const user = requireRole(['admin', 'editor']);
    const res = await dialog.showSaveDialog(mainWindow, {
      title, defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return null;
    await excel.writeExcelSheets(res.filePath, [{ name: sheetName, headers, rows, footer }]);
    if (auditKey) db.audit.add(user, auditKey, auditDetail);
    return res.filePath;
  }

  ipcMain.handle('reportes:gastos-empleado-excel', wrap(async (e, { anio } = {}) => {
    const data = reporteGastosEmpleado(anio);
    const headers = ['RNC / Cédula', 'Nombres', 'Salarios brutos', 'SFS (3.04%)', 'AFP (2.87%)', 'ISR (progresivo)', 'Total retenciones'];
    const rows = data.rows.map((r) => [r.cedula, `${r.apellidos}, ${r.nombres}`, r.bruto, r.sfs, r.afp, r.isr, r.retenciones]);
    const footer = ['', 'TOTAL', data.totales.bruto, data.totales.sfs, data.totales.afp, data.totales.isr, data.totales.retenciones];
    return saveReportExcel('Guardar Gastos del empleado', `gastos_empleado_${data.anio}.xlsx`, data.anio,
      headers, rows, footer, 'reportes:gastos-empleado-excel', `Año ${data.anio} · ${data.rows.length} empleados`);
  }));

  ipcMain.handle('reportes:gastos-empresa-excel', wrap(async (e, { anio } = {}) => {
    const data = reporteGastosEmpresa(anio);
    const headers = ['RNC / Cédula', 'Nombres', 'Bruto anual', 'Salud (7.09%)', 'SRL (1.20%)', 'Pensión (7.10%)', 'INFOTEP (1.00%)', 'Subtotal aportes empleador', 'Total costo empresa'];
    const rows = data.rows.map((r) => [r.cedula, `${r.apellidos}, ${r.nombres}`, r.bruto, r.sfsPatronal, r.srl, r.afpPatronal, r.infotep, r.aporEmpleador, r.totalEmpresa]);
    const footer = ['', 'TOTAL', data.totales.bruto, data.totales.sfsPatronal, data.totales.srl, data.totales.afpPatronal, data.totales.infotep, data.totales.aporEmpleador, data.totales.totalEmpresa];
    return saveReportExcel('Guardar Gastos de la empresa', `gastos_empresa_${data.anio}.xlsx`, data.anio,
      headers, rows, footer, 'reportes:gastos-empresa-excel', `Año ${data.anio} · ${data.rows.length} empleados`);
  }));

  ipcMain.handle('reportes:riesgos-laborales-excel', wrap(async (e, { anio } = {}) => {
    const data = reporteRiesgosLaborales(anio);
    const headers = ['RNC / Cédula', 'Nombres', 'Bruto anual', 'Base riesgos laborales', 'Aporte SRL (1.20%)'];
    const rows = data.rows.map((r) => [r.cedula, `${r.apellidos}, ${r.nombres}`, r.bruto, r.base, r.srl]);
    const footer = ['', 'TOTAL', data.totales.bruto, data.totales.base, data.totales.srl];
    return saveReportExcel('Guardar Riesgos laborales', `riesgos_laborales_${data.anio}.xlsx`, data.anio,
      headers, rows, footer, 'reportes:riesgos-laborales-excel', `Año ${data.anio} · ${data.rows.length} empleados`);
  }));
}

const isSmoke = process.argv.includes('--smoke');

app.whenReady().then(async () => {
  app.setAppUserModelId('com.kardex.digital');
  license.setStorePath(path.join(path.dirname(configPath()), 'kardex-license.json'));
  const cfg = config.load(configPath());

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    console.log('[KARDEX] Update disponible:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', { version: info.version });
    }
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[KARDEX] Sin actualizaciones');
  });
  autoUpdater.on('download-progress', (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', { percent: Math.round(p.percent) });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[KARDEX] Update descargado:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', { version: info.version });
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('[KARDEX] Error en auto-updater:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', { message: err.message });
    }
  });
  await openDb();
  registerIpc();
  createWindow();
  startNotifLoop();
  runAutoBackupIfDue();
  setInterval(runAutoBackupIfDue, 24 * 60 * 60 * 1000);
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 5000);
  const licSt = license.getStatus();
  console.log('[KARDEX] Licencia:', licSt.valid
    ? (licSt.license.company + ' · tipo ' + licSt.license.type + ' · vence ' + (licSt.license.expires || 'nunca'))
    : ('modo prueba · ' + licSt.trial.daysLeft + ' día(s) restante(s)'));
  console.log('[KARDEX] Iniciada. OpenAI configurada:', !!(process.env.OPENAI_API_KEY || '').trim(),
    '| Gemini configurada:', !!(process.env.GEMINI_API_KEY || '').trim());

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('SMOKE: ventana cargada OK');
      mainWindow.webContents.executeJavaScript(`
        (async () => {
          const res = await window.api.login('admin', 'admin123');
          if (res && res.ok && res.data && res.data.role === 'admin') return 'ok';
          console.error('SMOKE_LOGIN_FAIL', JSON.stringify(res));
          return 'fail';
        })()
      `).then((r) => {
        console.log('SMOKE: login automático ->', r);
        setTimeout(() => { app.exit(r === 'ok' ? 0 : 1); }, 500);
      }).catch((e) => {
        console.error('SMOKE: error login:', String(e));
        setTimeout(() => { app.exit(1); }, 500);
      });
    });
    mainWindow.webContents.on('console-message', (e, level, message) => {
      if (level >= 3) console.log('RENDER CONSOLE:', message);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    if (db) db.close();
  } catch (e) { /* noop */ }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
});
