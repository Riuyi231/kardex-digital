// Envío de correos electrónicos vía SMTP (nodemailer). Configuración guardada en db.settings.
const nodemailer = require('nodemailer');
const db = require('./active-db');
const pdf = require('./pdf');
const excel = require('./excel');
const nomina = require('./nomina');
const notificaciones = require('./notificaciones');

const KEYS = [
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass',
  'smtp_from_name', 'smtp_from_email', 'smtp_test_to'
];

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function slug(s) {
  return String(s || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function encodePass(v) {
  return v ? Buffer.from(String(v), 'utf8').toString('base64') : '';
}

function decodePass(v) {
  if (!v) return '';
  try { return Buffer.from(String(v), 'base64').toString('utf8'); } catch (e) { return ''; }
}

function getSettings() {
  const out = {};
  for (const k of KEYS) {
    const v = db.settings.get(k);
    out[k] = k === 'smtp_pass' ? decodePass(v) : (v != null ? v : '');
  }
  return out;
}

function saveSettings(data) {
  for (const k of KEYS) {
    let v = data && data[k] != null ? String(data[k]) : '';
    if (k === 'smtp_pass' && v) v = encodePass(v);
    db.settings.set(k, v);
  }
  return getSettings();
}

function buildTransport() {
  const s = getSettings();
  if (!String(s.smtp_host || '').trim()) throw new Error('Configure primero el servidor SMTP (Host)');
  const secure = s.smtp_secure === 'true' || s.smtp_secure === true || s.smtp_secure === '1';
  const port = Number(s.smtp_port) || (secure ? 465 : 587);
  const opts = { host: String(s.smtp_host).trim(), port, secure };
  if (String(s.smtp_user || '').trim()) {
    opts.auth = { user: String(s.smtp_user).trim(), pass: String(s.smtp_pass || '') };
  }
  return nodemailer.createTransport(opts);
}

function fromAddress() {
  const s = getSettings();
  if (String(s.smtp_from_email || '').trim()) {
    return { name: String(s.smtp_from_name || '').trim() || undefined, address: String(s.smtp_from_email).trim() };
  }
  if (String(s.smtp_from_name || '').trim()) {
    return `"${String(s.smtp_from_name).trim()}" <${String(s.smtp_user || '')}>`;
  }
  return String(s.smtp_user || '');
}

async function sendMail({ to, subject, text, html, attachments }) {
  if (!validEmail(to)) throw new Error('Destinatario no válido: ' + to);
  const transport = buildTransport();
  try {
    const info = await transport.sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      html,
      attachments: attachments && attachments.length ? attachments : undefined
    });
    return info;
  } finally {
    transport.close();
  }
}

function log(to, subject, status, error) {
  try { db.mailLog.add({ to, subject, status, error }); } catch (e) { /* noop */ }
}

async function testMail() {
  const s = getSettings();
  const to = String(s.smtp_test_to || s.smtp_from_email || s.smtp_user || '').trim();
  if (!to) throw new Error('Indique el correo de prueba en la configuración');
  const subject = 'KARDEX Digital · Correo de prueba';
  try {
    await sendMail({ to, subject, text: 'Si recibe este mensaje, la configuración SMTP es correcta.' });
    log(to, subject, 'ok');
    return { ok: true, to };
  } catch (e) {
    log(to, subject, 'error', e.message);
    throw e;
  }
}

async function sendCedula(employeeId) {
  const emp = db.employees.get(Number(employeeId));
  if (!emp) throw new Error('Empleado no encontrado');
  if (!emp.email || !validEmail(emp.email)) throw new Error(`${emp.nombres} ${emp.apellidos} no tiene correo válido`);
  if (!((emp.frente && /^data:/.test(emp.frente)) || (emp.reverso && /^data:/.test(emp.reverso)))) {
    throw new Error(`${emp.nombres} ${emp.apellidos} no tiene cédula cargada`);
  }
  const buf = await pdf.buildCedulaPdf([emp]);
  const name = `${emp.nombres} ${emp.apellidos}`.trim();
  const subject = `Cédula de ${name}`;
  try {
    await sendMail({
      to: emp.email,
      subject,
      text: `Adjuntamos la cédula de identidad de ${name}${emp.cedula ? ' (' + emp.cedula + ')' : ''}.`,
      attachments: [{ filename: `cedula_${slug(name)}.pdf`, content: buf }]
    });
    log(emp.email, subject, 'ok');
    return { employee_id: emp.id, email: emp.email, ok: true };
  } catch (e) {
    log(emp.email, subject, 'error', e.message);
    throw e;
  }
}

async function sendCedulas(employeeIds) {
  const ids = [...new Set((employeeIds || []).map(Number))].filter(Boolean);
  if (!ids.length) throw new Error('Seleccione al menos un empleado');
  const results = [];
  for (const id of ids) {
    try { results.push(await sendCedula(id)); }
    catch (e) { results.push({ employee_id: id, ok: false, error: e.message }); }
  }
  return { sent: results.filter(r => r.ok).length, results };
}

function buildNominaData(mes, anio, vista) {
  const m = Number(mes) || new Date().getMonth() + 1;
  const y = Number(anio) || new Date().getFullYear();
  const v = vista || 'mensual';
  const actives = db.employees.list('', 'activo');
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
  const data = v === 'quincenal' ? nomina.calcNominaQuincenal(actives, m, y, extras, incentivos, pagosVacaciones, deduccionesManuales)
    : v === 'semanal' ? nomina.calcNominaSemanal(actives, m, y, extras, incentivos, pagosVacaciones)
      : v === 'diario' ? nomina.calcNominaDiaria(actives, m, y, extras, incentivos, pagosVacaciones)
        : nomina.calcNomina(actives, m, y, extras, incentivos, pagosVacaciones);
  return { m, y, vista: v, rows: data.rows, totales: data.totales };
}

// Definiciones de columnas por forma de pago (mismas que la vista en pantalla).
const NOMINA_MAIL_VIEWS = {
  mensual: {
    label: 'Mensual',
    headers: ['Empleado', 'Cedula', 'Departamento', 'Salario', 'HorasExtra', 'Feriados', 'PagoExtras', 'Otros', 'Incentivo', 'Vacaciones', 'Bruto', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Neto'],
    row: (r) => [r.nombres + ' ' + r.apellidos, r.cedula, r.departamento, r.salario, r.horas_extra, r.feriados_extra, r.extra, r.otros_ingresos, r.incentivo, r.vacaciones_pago, r.bruto, r.afp, r.sfs, r.isr, r.retenciones, r.neto]
  },
  quincenal: {
    label: 'Quincenal',
    headers: ['Empleado', 'Cedula', 'Departamento', 'Salario', 'HorasExtra', 'Feriados', 'PagoExtras', 'Otros', 'Vacaciones', 'Quincena1', 'Quincena2Bruto', 'Incentivo', 'Deducciones', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Quincena2Neto', 'TotalNeto'],
    row: (r) => [r.nombres + ' ' + r.apellidos, r.cedula, r.departamento, r.salario, r.horas_extra, r.feriados_extra, r.extra, r.otros_ingresos, r.vacaciones_pago, r.quincena1, r.quincena2_bruto, r.incentivo, r.deducciones_manuales, r.afp, r.sfs, r.isr, r.retenciones, r.quincena2_neto, r.total_neto]
  },
  semanal: {
    label: 'Semanal',
    headers: ['Empleado', 'Cedula', 'Departamento', 'Salario', 'HorasExtra', 'Feriados', 'PagoExtras', 'Otros', 'Incentivo', 'Vacaciones', 'Sem1-3Neto', 'UltimaSemBruto', 'AFP', 'SFS', 'ISR', 'Retenciones', 'UltimaSemNeto', 'TotalNeto'],
    row: (r) => [r.nombres + ' ' + r.apellidos, r.cedula, r.departamento, r.salario, r.horas_extra, r.feriados_extra, r.extra, r.otros_ingresos, r.incentivo, r.vacaciones_pago, Math.round((Number(r.semana_neto) || 0) * 3 * 100) / 100, r.ultima_bruto, r.afp, r.sfs, r.isr, r.retenciones, r.ultima_neto, r.total_neto]
  },
  diario: {
    label: 'Diario',
    headers: ['Empleado', 'Cedula', 'Departamento', 'Salario', 'SalarioDiario', 'HorasExtra', 'Feriados', 'PagoExtras', 'Otros', 'Incentivo', 'Vacaciones', 'Bruto', 'AFP', 'SFS', 'ISR', 'Retenciones', 'Neto'],
    row: (r) => [r.nombres + ' ' + r.apellidos, r.cedula, r.departamento, r.salario, r.salario_diario, r.horas_extra, r.feriados_extra, r.extra, r.otros_ingresos, r.incentivo, r.vacaciones_pago, r.bruto, r.afp, r.sfs, r.isr, r.retenciones, r.neto]
  }
};

function buildEmployeeSheet(data, row) {
  const def = NOMINA_MAIL_VIEWS[data.vista] || NOMINA_MAIL_VIEWS.mensual;
  return {
    name: `Nómina ${def.label.toLowerCase()} ${data.m}/${data.y}`,
    headers: def.headers,
    rows: [def.row(row)],
    footer: null
  };
}

async function sendNomina({ mes, anio, employeeIds, vista }) {
  const data = buildNominaData(mes, anio, vista);
  const selected = new Set((employeeIds || []).map(Number));
  const results = [];
  for (const row of data.rows) {
    if (selected.size && !selected.has(row.id)) continue;
    const emp = db.employees.get(row.id);
    if (!emp || !emp.email || !validEmail(emp.email)) continue;
    const name = `${emp.nombres} ${emp.apellidos}`.trim();
    const def = NOMINA_MAIL_VIEWS[data.vista] || NOMINA_MAIL_VIEWS.mensual;
    const subject = `Nómina ${data.vista === 'mensual' ? '' : def.label.toLowerCase() + ' '}${data.m}/${data.y}`;
    try {
      const buffer = await excel.buildSheetsBuffer([buildEmployeeSheet(data, row)]);
      await sendMail({
        to: emp.email,
        subject,
        text: `Adjuntamos su nómina de ${data.m}/${data.y}.`,
        attachments: [{ filename: `nomina_${data.vista === 'mensual' ? '' : data.vista + '_'}${data.m}_${data.y}_${slug(name)}.xlsx`, content: buffer }]
      });
      log(emp.email, subject, 'ok');
      results.push({ employee_id: row.id, email: emp.email, ok: true });
    } catch (e) {
      log(emp.email, subject, 'error', e.message);
      results.push({ employee_id: row.id, email: emp.email, ok: false, error: e.message });
    }
  }
  if (!results.length) throw new Error('No se envió ningún correo (empleados sin correo válido)');
  return { sent: results.filter(r => r.ok).length, results };
}

function reminderHtml(emp, events) {
  const name = `${emp.nombres} ${emp.apellidos}`.trim() || 'Empleado';
  const items = events.map(ev => {
    const cuando = ev.dias === 0 ? ' <b>hoy</b>' : ` en ${ev.dias} día${ev.dias === 1 ? '' : 's'}`;
    return `<li><b>${escHtml(ev.titulo)}</b> — ${escHtml(ev.fecha)}${cuando}<br><span style="color:#555">${escHtml(ev.descripcion)}</span></li>`;
  }).join('');
  return `<h2>Hola ${escHtml(name)}</h2><p>Estos son sus recordatorios:</p><ul>${items}</ul><p style="color:#888">Enviado por KARDEX Digital.</p>`;
}

async function sendReminders() {
  const settings = {};
  for (const k of Object.keys(notificaciones.DEFAULTS)) {
    const v = db.settings.get(k);
    settings[k] = v != null ? v : notificaciones.DEFAULTS[k];
  }
  const employees = db.employees.list('', 'activo');
  const allVacaciones = db.vacaciones.list();
  const events = notificaciones.computeEvents({ employees, vacaciones: allVacaciones }, settings)
    .filter(ev => ev.en_ventana);
  const paymentEvents = events.filter(ev => ev.tipo === 'pago');
  const results = [];
  for (const emp of employees) {
    if (!emp.email || !validEmail(emp.email)) continue;
    const mine = events.filter(ev => {
      if (ev.tipo === 'pago') return false;
      if (ev.tipo === 'cumpleanos' || ev.tipo === 'cedula' || ev.tipo === 'aniversario') return ev.id.includes(`|${emp.id}|`);
      if (ev.tipo === 'vacaciones') {
        const vacIds = allVacaciones.filter(v => v.employee_id === emp.id).map(v => v.id);
        return vacIds.some(vid => ev.id.includes(`|${vid}|`));
      }
      return false;
    });
    const list = [...paymentEvents, ...mine];
    if (!list.length) continue;
    const subject = 'KARDEX Digital · Recordatorios';
    try {
      await sendMail({ to: emp.email, subject, html: reminderHtml(emp, list) });
      log(emp.email, subject, 'ok');
      results.push({ employee_id: emp.id, email: emp.email, ok: true, eventos: list.length });
    } catch (e) {
      log(emp.email, subject, 'error', e.message);
      results.push({ employee_id: emp.id, email: emp.email, ok: false, error: e.message });
    }
  }
  if (!results.length) throw new Error('No había recordatorios por enviar o ningún empleado tiene correo');
  return { sent: results.filter(r => r.ok).length, results };
}

async function sendCustom({ employeeIds = [], to = '', subject = '', text = '', attachments = [] }) {
  const ids = [...new Set((employeeIds || []).map(Number))].filter(Boolean);
  const extra = String(to || '').split(',').map(s => s.trim()).filter(validEmail);
  const personal = new Map();
  for (const id of ids) {
    const emp = db.employees.get(id);
    if (emp && emp.email && validEmail(emp.email)) personal.set(emp.email, emp);
  }
  const all = [...new Set([...personal.keys(), ...extra])];
  if (!all.length) throw new Error('Seleccione al menos un destinatario con correo válido');
  const subjTemplate = String(subject).trim();
  if (!subjTemplate) throw new Error('Indique el asunto del correo');
  const bodyTemplate = String(text || '');
  const files = (attachments || []).map(a => ({
    filename: String(a.filename || 'archivo'),
    contentType: String(a.contentType || ''),
    content: Buffer.from(String(a.content || ''), 'base64')
  }));

  function fill(emp, s) {
    return String(s || '')
      .replace(/\{nombre\}/g, emp ? `${emp.nombres} ${emp.apellidos}`.trim() : '')
      .replace(/\{apellidos\}/g, emp ? String(emp.apellidos || '') : '')
      .replace(/\{cedula\}/g, emp ? String(emp.cedula || '') : '')
      .replace(/\{puesto\}/g, emp ? String(emp.puesto || '') : '')
      .replace(/\{departamento\}/g, emp ? String(emp.departamento || '') : '')
      .replace(/\{sucursal\}/g, emp ? String(emp.sucursal || '') : '');
  }

  const results = [];
  for (const email of all) {
    const emp = personal.get(email);
    const subj = fill(emp, subjTemplate);
    const body = fill(emp, bodyTemplate);
    try {
      await sendMail({
        to: email,
        subject: subj,
        text: body || undefined,
        html: body ? body.split('\n').map(escHtml).join('<br>') : undefined,
        attachments: files.length ? files : undefined
      });
      log(email, subj, 'ok');
      results.push({ email, ok: true });
    } catch (e) {
      log(email, subj, 'error', e.message);
      results.push({ email, ok: false, error: e.message });
    }
  }
  return { sent: results.filter(r => r.ok).length, results };
}

module.exports = { KEYS, getSettings, saveSettings, sendMail, testMail, sendCedulas, sendNomina, sendReminders, sendCustom };
