const db = require('./active-db');
const pdf = require('./pdf');

const KEYS = [
  'doc_company_name', 'doc_company_rnc', 'doc_company_tel', 'doc_company_email', 'doc_company_address',
  'doc_firma_nombre', 'doc_firma_cargo', 'doc_firma_celular', 'doc_logo',
  'doc_constancia_text', 'doc_carta_text',
  'doc_banco', 'doc_destinatario_tipo', 'doc_destinatario',
  'doc_tipo_constancia', 'doc_plantilla_constancia', 'doc_plantilla_constancia_name',
  'doc_tipo_carta', 'doc_plantilla_carta', 'doc_plantilla_carta_name',
  'doc_tipo_solicitud', 'doc_plantilla_solicitud', 'doc_plantilla_solicitud_name'
];

const PLACEHOLDERS = [
  ['nombre_completo', 'Nombre completo del empleado'],
  ['nombres', 'Nombres'],
  ['apellidos', 'Apellidos'],
  ['cedula', 'Cédula de identidad'],
  ['puesto', 'Puesto'],
  ['departamento', 'Departamento'],
  ['sucursal', 'Sucursal'],
  ['fecha_ingreso', 'Fecha de ingreso'],
  ['salario_texto', 'Salario en texto (ej. RD$ 45,000.00 mensuales)'],
  ['salario', 'Salario (número)'],
  ['tipo_salario', 'Tipo de salario (mensual/quincenal/semanal)'],
  ['tipo_contrato', 'Tipo de contrato'],
  ['fecha_nacimiento', 'Fecha de nacimiento'],
  ['nacionalidad', 'Nacionalidad'],
  ['ciudad', 'Ciudad de residencia'],
  ['estado_civil', 'Estado civil'],
  ['profesion', 'Profesión'],
  ['email', 'Correo electrónico'],
  ['telefono', 'Teléfono'],
  ['nss', 'NSS'],
  ['ars', 'ARS'],
  ['afp', 'AFP'],
  ['fecha', 'Fecha de hoy (ej. 5 de agosto de 2026)'],
  ['fecha_corta', 'Fecha de hoy (DD/MM/AAAA)'],
  ['fecha_header', 'Fecha de hoy en el encabezado (ej. Agosto 5, 2026)'],
  ['salario_num', 'Salario con miles (ej. 45,000.00)'],
  ['banco', 'Destinatario de la carta (banco o persona)'],
  ['empresa', 'Empresa (razón social)'],
  ['empresa_direccion', 'Dirección de la empresa'],
  ['firma_nombre', 'Nombre del firmante'],
  ['firma_cargo', 'Cargo del firmante'],
  ['firma_celular', 'Celular del firmante']
];

function getSettings() {
  const s = {};
  for (const k of KEYS) s[k] = db.settings.get(k) || '';
  return s;
}

function saveSettings(payload) {
  for (const k of KEYS) {
    if (payload && payload[k] !== undefined) db.settings.set(k, String(payload[k] == null ? '' : payload[k]));
  }
  return getSettings();
}

function fmtRD(v) {
  const n = Number(v) || 0;
  return `RD$ ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function fmtFecha(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtFechaIngreso(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(v);
}

// Párrafo "Que …" usado por defecto en la constancia y la carta de salario generadas por el sistema
// (mismo contenido para ambas, como pide el usuario).
const QUE_PARRAFO = [
  'Distinguidos Sres.:',
  '',
  'La empresa {{empresa}}, constituida de acuerdo con las leyes de la República Dominicana, debidamente representada para los fines de la presente, tiene a bien certificar lo siguiente:',
  '',
  'Que {{nombre_completo}}, de nacionalidad dominicana, mayor de edad, portador(a) de la Cédula No. {{cedula}}, domiciliado y residente en la ciudad de {{ciudad}}, trabaja en esta empresa desde el {{fecha_ingreso}}, hasta la fecha, desempeñando la función de {{puesto}} en el departamento de {{departamento}}, en cuya posición recibe un ingreso mensual base de {{salario_texto}}.',
  '',
  'Se expide la presente a solicitud de la parte interesada, para los fines que estime conveniente.'
].join('\n');

// Nombre del destinatario de la carta (banco o particular)
function destinatarioName(s) {
  let dest = (s.doc_destinatario || '').trim();
  if (!dest) dest = (s.doc_banco || '').trim();
  return dest;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLarga(d) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function fechaHeader(d) {
  const mes = MESES[d.getMonth()];
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getDate()}, ${d.getFullYear()}`;
}

function employeeCtx(emp) {
  const now = new Date();
  const salario = Number(emp.salario) || 0;
  const periodo = emp.tipo_salario === 'quincenal' ? 'quincenales' : emp.tipo_salario === 'semanal' ? 'semanales' : 'mensuales';
  return {
    nombres: emp.nombres || '',
    apellidos: emp.apellidos || '',
    nombre_completo: `${emp.nombres || ''} ${emp.apellidos || ''}`.trim(),
    cedula: emp.cedula || '',
    sexo: emp.sexo || '',
    fecha_nacimiento: emp.fecha_nacimiento || '',
    nacionalidad: emp.nacionalidad || '',
    lugar_nacimiento: emp.lugar_nacimiento || '',
    ciudad: emp.ciudad || '',
    estado_civil: emp.estado_civil || '',
    profesion: emp.profesion || '',
    puesto: emp.puesto || '',
    departamento: emp.departamento || '',
    sucursal: emp.sucursal || '',
    fecha_ingreso: emp.fecha_ingreso || '',
    fecha_ingreso_fmt: fmtFechaIngreso(emp.fecha_ingreso),
    salario: salario.toFixed(2),
    salario_rd: fmtRD(salario),
    salario_texto: `${fmtRD(salario)} ${periodo}`,
    tipo_salario: emp.tipo_salario || '',
    tipo_contrato: emp.tipo_contrato || '',
    nss: emp.nss || '',
    ars: emp.ars || '',
    afp: emp.afp || '',
    email: emp.email || '',
    telefono: emp.telefono || '',
    flota: emp.flota || '',
    banco: emp.banco || '',
    cuenta: emp.cuenta || '',
    fecha: fechaLarga(now),
    fecha_corta: fmtFecha(now),
    fecha_header: fechaHeader(now),
    fecha_header_del: fechaHeader(now).replace(/, (\d{4})$/, ' del $1'),
    fecha_nacimiento_fmt: fmtFechaIngreso(emp.fecha_nacimiento),
    salario_num: salario.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  };
}

function renderTemplate(tpl, emp, extra) {
  const text = String(tpl == null ? '' : tpl);
  if (!text.trim()) return '';
  const ctx = employeeCtx(emp || {});
  if (extra) Object.assign(ctx, extra);
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, k) => {
    const v = ctx[String(k).toLowerCase()];
    return v == null ? '' : String(v);
  });
}

function buildConstanciaPdf(emp) {
  const s = getSettings();
  return pdf.buildConstancia(emp, {
    company_name: s.doc_company_name,
    company_rnc: s.doc_company_rnc,
    company_tel: s.doc_company_tel,
    company_email: s.doc_company_email,
    company_address: s.doc_company_address,
    logo: s.doc_logo,
    recipient: destinatarioName(s),
    text: renderTemplate(s.doc_constancia_text || QUE_PARRAFO, emp, { empresa: s.doc_company_name, empresa_direccion: s.doc_company_address, firma_nombre: s.doc_firma_nombre, firma_cargo: s.doc_firma_cargo })
  });
}

function buildCartaSalarioPdf(emp) {
  const s = getSettings();
  return pdf.buildCartaSalario(emp, {
    company_name: s.doc_company_name,
    company_rnc: s.doc_company_rnc,
    company_tel: s.doc_company_tel,
    company_email: s.doc_company_email,
    company_address: s.doc_company_address,
    logo: s.doc_logo,
    recipient: destinatarioName(s),
    text: renderTemplate(s.doc_carta_text || QUE_PARRAFO, emp, { empresa: s.doc_company_name, empresa_direccion: s.doc_company_address, firma_nombre: s.doc_firma_nombre, firma_cargo: s.doc_firma_cargo })
  });
}

function buildExpedientePdf(emp, vacaciones) {
  const s = getSettings();
  return pdf.buildExpediente(emp, vacaciones, {
    company_name: s.doc_company_name,
    company_rnc: s.doc_company_rnc,
    company_tel: s.doc_company_tel,
    company_email: s.doc_company_email,
    logo: s.doc_logo
  });
}

module.exports = { getSettings, saveSettings, renderTemplate, employeeCtx, buildConstanciaPdf, buildCartaSalarioPdf, buildExpedientePdf, PLACEHOLDERS };
