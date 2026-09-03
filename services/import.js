const ExcelJS = require('exceljs');
const db = require('./active-db');

const COLUMNS = [
  { key: 'cedula', labels: ['cedula', 'cédula', 'no cedula', 'no de cedula', 'no cédula', 'no de cédula', 'identidad', 'documento'], def: '' },
  { key: 'nombres', labels: ['nombres', 'nombre'], def: '' },
  { key: 'apellidos', labels: ['apellidos', 'apellido'], def: '' },
  { key: 'sexo', labels: ['sexo', 'genero', 'género'], def: '' },
  { key: 'fecha_nacimiento', labels: ['fecha de nacimiento', 'fecha nacimiento', 'nacimiento'], def: '' },
  { key: 'nacionalidad', labels: ['nacionalidad'], def: 'Dominicana' },
  { key: 'estado_civil', labels: ['estado civil'], def: '' },
  { key: 'profesion', labels: ['profesion', 'profesión', 'ocupacion', 'ocupación'], def: '' },
  { key: 'puesto', labels: ['puesto', 'cargo', 'posicion', 'posición'], def: '' },
  { key: 'departamento', labels: ['departamento', 'area', 'área'], def: '' },
  { key: 'sucursal', labels: ['sucursal', 'suc'], def: '' },
  { key: 'fecha_ingreso', labels: ['fecha de ingreso', 'fecha ingreso', 'ingreso'], def: '' },
  { key: 'tipo_salario', labels: ['tipo de salario', 'tipo salario', 'periodo de pago'], def: 'mensual' },
  { key: 'salario', labels: ['salario', 'sueldo'], def: 0 },
  { key: 'tipo_contrato', labels: ['tipo de contrato', 'tipo contrato', 'contrato'], def: '' },
  { key: 'nss', labels: ['nss', 'seguro social'], def: '' },
  { key: 'ars', labels: ['ars'], def: '' },
  { key: 'afp', labels: ['afp'], def: '' },
  { key: 'email', labels: ['email', 'correo', 'correo electronico', 'correo electrónico'], def: '' },
  { key: 'telefono', labels: ['telefono', 'teléfono', 'celular'], def: '' },
  { key: 'flota', labels: ['flota', 'numero de flota', 'número de flota'], def: '' },
  { key: 'banco', labels: ['banco'], def: '' },
  { key: 'cuenta', labels: ['cuenta', 'numero de cuenta', 'número de cuenta'], def: '' },
  { key: 'nota', labels: ['nota', 'observaciones'], def: '' }
];

function normalizeKey(k) {
  return String(k == null ? '' : k).toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchColumn(header) {
  const h = normalizeKey(header);
  for (const col of COLUMNS) {
    if (col.labels.some((l) => h === normalizeKey(l))) return col;
  }
  for (const col of COLUMNS) {
    for (const l of col.labels) {
      const ln = normalizeKey(l);
      if (ln.length >= 4 && h.length >= 4 && (h.includes(ln) || ln.includes(h))) return col;
    }
  }
  return null;
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function formatDateValue(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${pad2(v.getDate())}/${pad2(v.getMonth() + 1)}/${v.getFullYear()}`;
  }
  return null;
}

// Convierte un valor de celda (texto, número de serie de Excel o Date) en cadena,
// con los fechas normalizadas a DD/MM/AAAA para no arrastrar el formato largo
// tipo "Tue Jan 22 1963 19:00:00 GMT-0500".
function cellText(cell) {
  if (!cell) return '';
  const dateStr = formatDateValue(cell.value);
  if (dateStr) return dateStr;
  if (cell.text != null && cell.text !== '') return String(cell.text);
  if (cell.value && typeof cell.value === 'object') {
    if (cell.value.date instanceof Date) {
      const d = formatDateValue(cell.value.date);
      if (d) return d;
    }
    if (cell.value.text != null) return String(cell.value.text);
    if (cell.value.result != null) return String(cell.value.result);
    if (cell.value instanceof Date) {
      const d = formatDateValue(cell.value);
      if (d) return d;
    }
    return '';
  }
  if (cell.value instanceof Date) {
    const d = formatDateValue(cell.value);
    if (d) return d;
  }
  return String(cell.value == null ? '' : cell.value);
}

async function parseWorkbook(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 4 || buf.slice(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    throw new Error('Formato no reconocido. Use un archivo Excel (.xlsx) con la plantilla de importación.');
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no contiene hojas de trabajo');

  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellText(cell).trim(); });

  const map = {};
  headers.forEach((h, i) => {
    const col = matchColumn(h);
    if (col) map[i] = col.key;
  });
  if (!Object.keys(map).length) throw new Error('No se reconocieron columnas. Descargue la plantilla de importación.');

  const hasId = Object.keys(map).some((i) => ['cedula', 'nombres', 'apellidos'].includes(map[i]));
  if (!hasId) throw new Error('Faltan columnas básicas (cédula, nombres o apellidos).');

  const employees = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = {};
    for (const idx of Object.keys(map)) {
      vals[map[idx]] = cellText(row.getCell(Number(idx) + 1)).trim();
    }
    const nombre = String(vals.nombres || '').trim();
    const apellido = String(vals.apellidos || '').trim();
    const cedula = String(vals.cedula || '').trim();
    if (!nombre && !apellido && !cedula) continue;
    employees.push(vals);
  }
  if (!employees.length) throw new Error('No se encontraron filas con datos de empleados.');
  return employees;
}

function normalizeSexo(v) {
  const s = String(v || '').trim().toUpperCase();
  if (['M', 'MASCULINO', 'H', 'HOMBRE'].includes(s)) return 'Masculino';
  if (['F', 'FEMENINO', 'M'].includes(s)) return 'Femenino';
  return String(v || '').trim();
}

function normalizeTipoSalario(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['mensual', 'm'].includes(s)) return 'mensual';
  if (['quincenal', 'q', 'quincena'].includes(s)) return 'quincenal';
  if (['semanal', 's'].includes(s)) return 'semanal';
  return s || 'mensual';
}

function normalizeImportDate(raw) {
  let t = String(raw == null ? '' : raw).trim();
  if (!t) return t;
  // Si llegó como el formato largo de JS Date ("Tue Jan 22 1963 19:00:00 GMT-0500").
  const jsDate = new Date(t);
  if (!isNaN(jsDate.getTime()) && /GMT|\(/i.test(t)) {
    return `${pad2(jsDate.getDate())}/${pad2(jsDate.getMonth() + 1)}/${jsDate.getFullYear()}`;
  }
  // DD/MM/AAAA o D/M/AAAA ya correcto.
  let m = t.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})$/);
  if (m) return `${pad2(m[1])}/${pad2(m[2])}/${m[3]}`;
  return t;
}

async function importEmployees(rows, userId, maxEmployees = 0) {
  const out = { imported: 0, skipped: 0, duplicated: [], errors: [] };
  const existing = db.employees.list();
  const cedulas = new Set(existing.map((e) => String(e.cedula || '').trim()).filter(Boolean));
  const emails = new Set(existing.map((e) => String(e.email || '').trim().toLowerCase()).filter(Boolean));
  const baseActive = maxEmployees > 0 ? db.employees.stats().activos : 0;

  for (const r of rows) {
    const nombre = String(r.nombres || '').trim();
    const apellido = String(r.apellidos || '').trim();
    const cedula = String(r.cedula || '').trim();
    try {
      if (maxEmployees > 0 && baseActive + out.imported >= maxEmployees) {
        out.errors.push('Límite de empleados alcanzado: la licencia permite ' + maxEmployees +
          ' empleado(s) activo(s). Importación detenida; el resto de filas no se importó.');
        break;
      }
      if (cedula && cedulas.has(cedula)) {
        out.duplicated.push(`${cedula} (${nombre} ${apellido})`);
        out.skipped++;
        continue;
      }
      const data = {};
      for (const col of COLUMNS) {
        let v = r[col.key];
        if (v == null || v === '') v = col.def;
        if (col.key === 'salario') v = Number(String(v).replace(/[^0-9.\-]/g, '')) || 0;
        if (col.key === 'sexo') v = normalizeSexo(v);
        if (col.key === 'tipo_salario') v = normalizeTipoSalario(v);
        if (col.key === 'fecha_nacimiento' || col.key === 'fecha_ingreso') v = normalizeImportDate(v);
        data[col.key] = v;
      }
      const email = String(data.email || '').trim().toLowerCase();
      if (email && emails.has(email)) {
        out.duplicated.push(`${cedula || nombre + ' ' + apellido} (correo duplicado)`);
        out.skipped++;
        continue;
      }
      db.employees.create(data, userId);
      if (cedula) cedulas.add(cedula);
      if (email) emails.add(email);
      out.imported++;
    } catch (e) {
      out.errors.push(`${nombre} ${apellido}${cedula ? ' (' + cedula + ')' : ''}: ${e.message}`);
    }
  }
  return out;
}

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Empleados');
  ws.columns = [
    { header: 'Cédula', key: 'cedula', width: 16 },
    { header: 'Nombres', key: 'nombres', width: 22 },
    { header: 'Apellidos', key: 'apellidos', width: 22 },
    { header: 'Sexo', key: 'sexo', width: 12 },
    { header: 'Fecha de nacimiento', key: 'fecha_nacimiento', width: 20 },
    { header: 'Nacionalidad', key: 'nacionalidad', width: 14 },
    { header: 'Estado civil', key: 'estado_civil', width: 14 },
    { header: 'Profesión', key: 'profesion', width: 18 },
    { header: 'Puesto', key: 'puesto', width: 18 },
    { header: 'Departamento', key: 'departamento', width: 16 },
    { header: 'Sucursal', key: 'sucursal', width: 16 },
    { header: 'Fecha de ingreso', key: 'fecha_ingreso', width: 20 },
    { header: 'Tipo de salario', key: 'tipo_salario', width: 14 },
    { header: 'Salario', key: 'salario', width: 12 },
    { header: 'Tipo de contrato', key: 'tipo_contrato', width: 16 },
    { header: 'NSS', key: 'nss', width: 14 },
    { header: 'ARS', key: 'ars', width: 12 },
    { header: 'AFP', key: 'afp', width: 12 },
    { header: 'Correo electrónico', key: 'email', width: 24 },
    { header: 'Teléfono', key: 'telefono', width: 14 },
    { header: 'Número de flota', key: 'flota', width: 14 },
    { header: 'Banco', key: 'banco', width: 16 },
    { header: 'Cuenta', key: 'cuenta', width: 18 },
    { header: 'Nota / Observaciones', key: 'nota', width: 26 }
  ];
  ws.addRow({
    cedula: '001-0000000-0', nombres: 'Juan', apellidos: 'Pérez', sexo: 'Masculino',
    fecha_nacimiento: '01/01/1990', nacionalidad: 'Dominicana', estado_civil: 'Soltero',
    profesion: 'Contador', puesto: 'Contador', departamento: 'Administración', sucursal: 'Santiago',
    fecha_ingreso: '01/01/2024', tipo_salario: 'mensual', salario: 45000,
    tipo_contrato: 'indefinido', nss: '', ars: 'ARS Humano', afp: 'AFP Crecer',
    email: 'juan@empresa.com', telefono: '809-000-0000', flota: '', banco: '', cuenta: '', nota: ''
  });
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE7F5' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { COLUMNS, parseWorkbook, importEmployees, buildTemplate };
