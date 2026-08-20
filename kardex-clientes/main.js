'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const db = require('./services/db');
const ExcelJS = require('exceljs');

const DEFAULT_PLAN_PRICES = { micro: 2500, pyme: 5000, empresa: 9000, firma: 15000 };

function planLabel(p) {
  return { micro: 'Micro', pyme: 'Pyme', empresa: 'Empresa', firma: 'Firma' }[p] || p;
}

function monthsBetween(a, b) {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}

function addDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

function trialInfo(c) {
  if (c.estado !== 'prueba' || !c.trial_fin) return { trial_days_left: null, trial_expired: false };
  const fin = new Date(c.trial_fin + 'T23:59:59');
  const expired = fin < new Date();
  return { trial_days_left: expired ? 0 : Math.ceil((fin - new Date()) / 86400000), trial_expired: expired };
}

function clientRow(id, month) {
  const c = db.get('SELECT * FROM clients WHERE id = ?', [id]);
  if (!c) return null;
  const last = db.get('SELECT fecha, monto, metodo FROM payments WHERE client_id = ? AND COALESCE(tipo,\'mensual\') = \'mensual\' ORDER BY fecha DESC, id DESC LIMIT 1', [id]);
  const m = month || monthStr(new Date());
  const pagadoMes = !!db.get('SELECT id FROM payments WHERE client_id = ? AND fecha LIKE ? AND COALESCE(tipo,\'mensual\') = \'mensual\'', [id, m + '%']);
  const totalPagos = db.get('SELECT COALESCE(SUM(monto),0) AS total FROM payments WHERE client_id = ?', [id]).total;
  const since = last ? new Date(last.fecha + 'T00:00:00') : (c.inicio ? new Date(c.inicio + 'T00:00:00') : new Date());
  const deudaMeses = last ? monthsBetween(since, new Date()) : (c.inicio ? monthsBetween(since, new Date()) : 1);
  const deuda = Math.max(0, deudaMeses) * (Number(c.cuota) || 0);
  const costoInstalacion = Math.max(0, Number(c.costo_instalacion) || 0);
  const totalInstalacion = db.get('SELECT COALESCE(SUM(monto),0) AS total FROM payments WHERE client_id = ? AND tipo = ?', [id, 'instalacion']).total;
  const instalacionDeuda = Math.max(0, costoInstalacion - totalInstalacion);
  const servicios = db.all('SELECT id, nombre, cuota FROM servicios WHERE client_id = ? ORDER BY id ASC', [id]);
  return { ...c, servicios, ...trialInfo(c), last_pago: last || null, total_pagos: totalPagos, deuda, pagado_mes: pagadoMes, costo_instalacion: costoInstalacion, total_instalacion: totalInstalacion, instalacion_deuda: instalacionDeuda, instalacion_pagada: costoInstalacion > 0 && instalacionDeuda === 0 };
}

function listClients(month) {
  const m = month || monthStr(new Date());
  return db.all('SELECT * FROM clients ORDER BY estado = \'activo\' DESC, nombre COLLATE NOCASE ASC').map((c) => clientRow(c.id, m));
}

function monthStr(d) { return d.toISOString().slice(0, 7); }

function summaryData(month) {
  const target = month || monthStr(new Date());
  const year = target.slice(0, 4);
  const incomeMonth = db.get('SELECT COALESCE(SUM(monto),0) AS total FROM payments WHERE fecha LIKE ?', [target + '%']).total;
  const incomeYear = db.get('SELECT COALESCE(SUM(monto),0) AS total FROM payments WHERE fecha LIKE ?', [year + '%']).total;
  const clients = listClients();
  const activos = clients.filter((c) => c.estado === 'activo');
  const totalEmpleados = activos.reduce((s, c) => s + (Number(c.empleados) || 0), 0);
  const proyeccionAnual = activos.reduce((s, c) => s + (Number(c.cuota) || 0), 0) * 12;
  const porCobrar = activos
    .filter((c) => {
      const d = new Date((c.last_pago && c.last_pago.fecha ? c.last_pago.fecha : (c.inicio || '2000-01-01')) + 'T00:00:00');
      return monthsBetween(d, new Date()) >= 1;
    })
    .map((c) => ({ id: c.id, nombre: c.nombre, cuota: c.cuota, ultimo_pago: c.last_pago ? c.last_pago.fecha : (c.inicio || 'nunca') }));
  const pruebasVencidas = clients
    .filter((c) => c.estado === 'prueba' && c.trial_expired)
    .map((c) => ({ id: c.id, nombre: c.nombre, trial_fin: c.trial_fin }));
  return { month: target, incomeMonth, incomeYear, totalClientes: clients.length, activos: activos.length, totalEmpleados, proyeccionAnual, porCobrar, pruebasVencidas };
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'NEXUS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function planPrices() {
  try { return { ...DEFAULT_PLAN_PRICES, ...JSON.parse(db.getSetting('plan_prices', '{}')) }; }
  catch (e) { return { ...DEFAULT_PLAN_PRICES }; }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'NEXUS/1.0', Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('tiempo de espera agotado')));
  });
}

async function rncSearch(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'Escribe un nombre o RNC para buscar.' };
  try {
    let items;
    if (/^\d{9,11}$/.test(q)) {
      const d = await fetchJson('https://api-dgii.dominicantechnology.com/api/v1/rnc/' + q);
      items = d && d.data ? [d.data] : [];
    } else {
      const d = await fetchJson('https://api-dgii.dominicantechnology.com/api/v1/buscar?q=' + encodeURIComponent(q));
      items = (d && d.data) || [];
    }
    return { ok: true, data: items };
  } catch (e) {
    return { ok: false, error: 'No se pudo consultar el RNC: ' + e.message };
  }
}

function registerIpc() {
  ipcMain.handle('clients:list', (e, month) => ({ ok: true, data: listClients(month) }));

  ipcMain.handle('clients:get', (e, id) => {
    const c = db.get('SELECT * FROM clients WHERE id = ?', [id]);
    if (!c) return { ok: false, error: 'Cliente no encontrado' };
    const payments = db.all('SELECT * FROM payments WHERE client_id = ? ORDER BY fecha DESC, id DESC', [id]);
    return { ok: true, data: { ...clientRow(id), payments } };
  });

  ipcMain.handle('clients:save', (e, c) => {
    if (!c || !String(c.nombre || '').trim()) return { ok: false, error: 'El nombre de la empresa es obligatorio' };
    const rec = {
      nombre: String(c.nombre).trim(),
      rnc: String(c.rnc || '').trim(),
      contacto: String(c.contacto || '').trim(),
      telefono: String(c.telefono || '').trim(),
      email: String(c.email || '').trim(),
      direccion: String(c.direccion || '').trim(),
      plan: String(c.plan || 'pyme'),
      cuota: Number(c.cuota) || 0,
      empleados: Number(c.empleados) || 0,
      costo_instalacion: Math.max(0, Number(c.costo_instalacion) || 0),
      inicio: String(c.inicio || '').trim(),
      estado: String(c.estado || 'activo'),
      trial_fin: c.estado === 'prueba' ? String(c.trial_fin || addDays(15)).trim() : '',
      notas: String(c.notas || ''),
      licencia: String(c.licencia || '').trim()
    };
    let id;
    if (c.id) {
      db.run(`UPDATE clients SET nombre=?, rnc=?, contacto=?, telefono=?, email=?, direccion=?, plan=?, cuota=?, empleados=?, costo_instalacion=?, inicio=?, estado=?, trial_fin=?, notas=?, licencia=? WHERE id=?`,
        [rec.nombre, rec.rnc, rec.contacto, rec.telefono, rec.email, rec.direccion, rec.plan, rec.cuota, rec.empleados, rec.costo_instalacion, rec.inicio, rec.estado, rec.trial_fin, rec.notas, rec.licencia, c.id]);
      id = c.id;
    } else {
      id = db.run(`INSERT INTO clients (nombre, rnc, contacto, telefono, email, direccion, plan, cuota, empleados, costo_instalacion, inicio, estado, trial_fin, notas, licencia, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [rec.nombre, rec.rnc, rec.contacto, rec.telefono, rec.email, rec.direccion, rec.plan, rec.cuota, rec.empleados, rec.costo_instalacion, rec.inicio, rec.estado, rec.trial_fin, rec.notas, rec.licencia, db.nowStamp()]);
    }
    db.run('DELETE FROM servicios WHERE client_id = ?', [id]);
    for (const s of (Array.isArray(c.servicios) ? c.servicios : [])) {
      const nombre = String(s.nombre || '').trim();
      if (!nombre) continue;
      db.run('INSERT INTO servicios (client_id, nombre, cuota) VALUES (?,?,?)', [id, nombre, Number(s.cuota) || 0]);
    }
    return { ok: true, data: clientRow(id) };
  });

  ipcMain.handle('clients:state', (e, id, estado) => {
    const cur = db.get('SELECT * FROM clients WHERE id = ?', [id]);
    if (!cur) return { ok: false, error: 'Cliente no encontrado' };
    const next = String(estado || '').trim();
    if (!['activo', 'prospecto', 'cortado', 'prueba'].includes(next)) return { ok: false, error: 'Estado no válido' };
    const trialFin = next === 'prueba' ? (cur.trial_fin || addDays(15)) : '';
    db.run('UPDATE clients SET estado=?, trial_fin=? WHERE id=?', [next, trialFin, id]);
    return { ok: true, data: clientRow(id) };
  });

  ipcMain.handle('clients:delete', (e, id) => {
    db.run('DELETE FROM payments WHERE client_id = ?', [id]);
    db.run('DELETE FROM servicios WHERE client_id = ?', [id]);
    db.run('DELETE FROM clients WHERE id = ?', [id]);
    return { ok: true };
  });

  ipcMain.handle('payments:add', (e, p) => {
    if (!p || !p.client_id) return { ok: false, error: 'Cliente requerido' };
    const tipo = p.tipo === 'instalacion' ? 'instalacion' : 'mensual';
    const id = db.run('INSERT INTO payments (client_id, fecha, monto, metodo, meses, notas, tipo) VALUES (?,?,?,?,?,?,?)',
      [p.client_id, p.fecha || db.nowStamp(), Number(p.monto) || 0, String(p.metodo || ''), Number(p.meses) || 1, String(p.notas || ''), tipo]);
    return { ok: true, data: clientRow(p.client_id) };
  });

  ipcMain.handle('payments:delete', (e, id) => {
    db.run('DELETE FROM payments WHERE id = ?', [id]);
    return { ok: true };
  });

  ipcMain.handle('summary:get', (e, month) => ({ ok: true, data: summaryData(month) }));

  ipcMain.handle('rnc:search', (e, q) => rncSearch(q));

  ipcMain.handle('settings:get', () => ({
    ok: true,
    data: {
      plan_prices: planPrices(),
      moneda: db.getSetting('moneda', 'RD$'),
      negocio: db.getSetting('negocio', '')
    }
  }));

  ipcMain.handle('settings:save', (e, s) => {
    if (s && s.plan_prices && typeof s.plan_prices === 'object') {
      const clean = {};
      for (const k of Object.keys(DEFAULT_PLAN_PRICES)) clean[k] = Math.max(0, Number(s.plan_prices[k]) || 0);
      db.setSetting('plan_prices', JSON.stringify(clean));
    }
    if (s && 'moneda' in s) db.setSetting('moneda', String(s.moneda || 'RD$'));
    if (s && 'negocio' in s) db.setSetting('negocio', String(s.negocio || ''));
    return { ok: true };
  });

  ipcMain.handle('export:xlsx', async (e, which) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'NEXUS';
    let ws;
    if (which === 'payments') {
      ws = wb.addWorksheet('Pagos');
      ws.columns = [
        { header: 'Empresa', key: 'nombre', width: 30 },
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Monto', key: 'monto', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'Método', key: 'metodo', width: 16 },
        { header: 'Meses', key: 'meses', width: 8 },
        { header: 'Notas', key: 'notas', width: 30 }
      ];
      const rows = db.all(`SELECT c.nombre, p.fecha, p.monto, p.tipo, p.metodo, p.meses, p.notas FROM payments p JOIN clients c ON c.id = p.client_id ORDER BY p.fecha DESC, p.id DESC`);
      rows.forEach((r) => ws.addRow({ nombre: r.nombre, fecha: r.fecha, monto: r.monto, tipo: r.tipo === 'instalacion' ? 'Instalación' : 'Mensualidad', metodo: r.metodo, meses: r.meses, notas: r.notas }));
    } else {
      ws = wb.addWorksheet('Clientes');
      ws.columns = [
        { header: 'Empresa', key: 'nombre', width: 30 },
        { header: 'RNC', key: 'rnc', width: 16 },
        { header: 'Contacto', key: 'contacto', width: 24 },
        { header: 'Teléfono', key: 'telefono', width: 16 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Plan', key: 'plan', width: 12 },
        { header: 'Cuota', key: 'cuota', width: 12 },
        { header: 'Programas / servicios', key: 'servicios', width: 36 },
        { header: 'Empleados', key: 'empleados', width: 12 },
        { header: 'Inicio', key: 'inicio', width: 12 },
        { header: 'Estado', key: 'estado', width: 12 },
        { header: 'Total pagado', key: 'total_pagos', width: 14 },
        { header: 'Deuda', key: 'deuda', width: 12 },
        { header: 'Licencia', key: 'licencia', width: 18 },
        { header: 'Notas', key: 'notas', width: 30 }
      ];
      listClients().forEach((c) => ws.addRow({ nombre: c.nombre, rnc: c.rnc, contacto: c.contacto, telefono: c.telefono, email: c.email, plan: planLabel(c.plan), cuota: c.cuota, servicios: (c.servicios || []).map((s) => s.nombre + (Number(s.cuota) ? ' (' + s.cuota + ')' : '')).join(', '), empleados: c.empleados, inicio: c.inicio, estado: c.estado, total_pagos: c.total_pagos, deuda: c.deuda, licencia: c.licencia, notas: c.notas }));
    }
    const negocio = db.getSetting('negocio', '') || 'Nexus Software RD';
    ws.spliceRows(1, 0, [negocio + ' — ' + (which === 'payments' ? 'Registro de pagos' : 'Control de clientes')]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.getRow(1).height = 20;
    ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    ws.getRow(2).height = 22;
    const buffer = await wb.xlsx.writeBuffer();
    const r = await dialog.showSaveDialog(win, { title: 'Exportar a Excel', defaultPath: path.join(app.getPath('documents'), (which === 'payments' ? 'Pagos-' : 'Clientes-') + db.nowStamp() + '.xlsx'), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(buffer));
    return { ok: true, file: r.filePath };
  });
}

function smoke() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kc-smoke-'));
  db.open(path.join(tmp, 'smoke.db')).then(() => {
    const r1 = db.run(`INSERT INTO clients (nombre, plan, cuota, empleados, estado, inicio) VALUES ('EMPRESA A','pyme',5000,25,'activo',?)`, [db.nowStamp()]);
    db.run(`INSERT INTO payments (client_id, fecha, monto, metodo, meses, tipo) VALUES (?, ?, 5000, 'transferencia', 1, 'mensual')`, [r1, db.nowStamp()]);
    db.run(`INSERT INTO servicios (client_id, nombre, cuota) VALUES (?, 'KARDEX Digital', 3500)`, [r1]);
    db.run(`INSERT INTO servicios (client_id, nombre, cuota) VALUES (?, 'NEXALERT', 1500)`, [r1]);
    const r2 = db.run(`INSERT INTO clients (nombre, plan, cuota, empleados, estado, inicio, costo_instalacion) VALUES ('EMPRESA B','pyme',5000,10,'activo',?,3000)`, [db.nowStamp()]);
    db.run(`INSERT INTO payments (client_id, fecha, monto, metodo, meses, tipo) VALUES (?, ?, 3000, 'efectivo', 1, 'instalacion')`, [r2, db.nowStamp()]);
    const sum = summaryData(monthStr(new Date()));
    const list = listClients();
    const b = list.find((c) => c.id === r2);
    const a = list.find((c) => c.id === r1);
    console.log('SMOKE: clientes=' + list.length + ' | ingresoMes=' + sum.incomeMonth + ' | empleados=' + sum.totalEmpleados + ' | deuda=' + list[0].deuda + ' | precioPyme=' + planPrices().pyme +
      ' | instalacionNoCuentaComoMensual=' + (b.pagado_mes === false) + ' | instalacionPagada=' + b.instalacion_pagada +
      ' | serviciosA=' + (a.servicios.length) + ' | serviciosSuma=' + a.servicios.reduce((s, x) => s + Number(x.cuota), 0));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(0);
  }).catch((e) => { console.error('SMOKE FAIL', e); app.exit(1); });
}

app.whenReady().then(() => {
  if (process.argv.includes('--smoke')) return smoke();
  if (process.env.NEXUS_UITEST) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-uitest-')));
  }
  db.open(path.join(app.getPath('userData'), 'kardex-clientes.db')).then(() => {
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
