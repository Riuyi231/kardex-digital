// Alertas de eventos importantes: cumpleaños, fechas de pago, vencimiento de cédula y vacaciones.
const DEFAULTS = {
  notif_activadas: 'true',
  dias_cumpleanos: '7',
  dias_pago: '3',
  dias_cedula: '30',
  dias_vacaciones: '7',
  dias_aniversario: '7'
};

const TIPOS = {
  cumpleanos: { label: 'Cumpleaños', prio: 2 },
  pago: { label: 'Pago de nómina', prio: 3 },
  cedula: { label: 'Vencimiento de cédula', prio: 1 },
  vacaciones: { label: 'Vacaciones', prio: 2 },
  aniversario: { label: 'Aniversario laboral', prio: 2 }
};

function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function nextDateForDay(day, from) {
  const f = startOfDay(from);
  let y = f.getFullYear(), m = f.getMonth();
  for (let i = 0; i < 48; i++) {
    const last = new Date(y, m + 1, 0).getDate();
    const candidate = new Date(y, m, Math.min(day, last));
    if (candidate >= f) return candidate;
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return null;
}

function nextFriday(from) {
  const d = startOfDay(from);
  for (let i = 0; i < 8; i++) {
    if (d.getDay() === 5) return d;
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function nextBirthday(month, day, from) {
  const f = startOfDay(from);
  let y = f.getFullYear();
  for (let i = 0; i < 2; i++) {
    const last = new Date(y, month, 0).getDate();
    const candidate = new Date(y, month - 1, Math.min(day, last));
    if (candidate >= f) return candidate;
    y++;
  }
  return null;
}

function labelPago(t) {
  return { mensual: 'Pago mensual', quincenal: 'Pago quincenal', semanal: 'Pago semanal' }[t] || 'Pago de nómina';
}

// Días feriados de República Dominicana (Ley 139-97) para el año dado.
// Fijos: 1/ene y 25/dic; móviles: Viernes Santo y Corpus Christi; el resto se traslada al lunes.
function diasFeriados(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascua = new Date(anio, mes - 1, dia);

  const feriados = [];
  const add = (dt) => feriados.push(new Date(anio, dt.getMonth(), dt.getDate()));
  add(new Date(anio, 0, 1));
  add(new Date(anio, 11, 25));
  const viernesSanto = new Date(pascua); viernesSanto.setDate(viernesSanto.getDate() - 2); add(viernesSanto);
  const corpus = new Date(pascua); corpus.setDate(corpus.getDate() + 60); add(corpus);
  const trasladables = [
    [0, 6], [0, 21], [0, 26], [1, 27], [4, 1], [7, 16], [8, 24], [10, 6]
  ];
  for (const [mo, da] of trasladables) {
    const dt = new Date(anio, mo, da);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) dt.setDate(dt.getDate() + (dow === 6 ? 2 : 1));
    add(dt);
  }
  return feriados;
}

function esDiaLaborable(fecha, feriados) {
  const dow = fecha.getDay();
  if (dow === 0 || dow === 6) return false;
  const f = +startOfDay(fecha);
  return !(feriados || []).some(h => +startOfDay(h) === f);
}

// Si el día de pago cae fin de semana o feriado, se paga el día hábil anterior.
function pagoEfectivo(fecha, feriados) {
  const d = startOfDay(fecha);
  let g = 0;
  while (!esDiaLaborable(d, feriados) && g < 10) {
    d.setDate(d.getDate() - 1);
    g++;
  }
  return d;
}

function razonAdelanto(fecha, feriados) {
  const dow = fecha.getDay();
  if (dow === 0 || dow === 6) return 'cae fin de semana';
  if (!esDiaLaborable(fecha, feriados)) return 'cae día feriado';
  return null;
}

// employees: [{ id, nombres, apellidos, fecha_nacimiento, fecha_vencimiento, salario, tipo_salario, puesto }]
// vacaciones: [{ id, employee_id, tipo, fecha_inicio, motivo }]
// opts: { dias_cumpleanos, dias_pago, dias_cedula, dias_vacaciones }
function computeEvents({ employees, vacaciones }, opts = {}) {
  const s = Object.assign({}, DEFAULTS, opts);
  const diasCum = Number(s.dias_cumpleanos) >= 0 ? Number(s.dias_cumpleanos) : 7;
  const diasPag = Number(s.dias_pago) >= 0 ? Number(s.dias_pago) : 3;
  const diasCed = Number(s.dias_cedula) >= 0 ? Number(s.dias_cedula) : 30;
  const diasVac = Number(s.dias_vacaciones) >= 0 ? Number(s.dias_vacaciones) : 7;
  const diasAniv = Number(s.dias_aniversario) >= 0 ? Number(s.dias_aniversario) : 7;
  const today = startOfDay(new Date());
  const events = [];

  function pushEvent(tipo, id, fecha, titulo, descripcion, ventana, allowOverdue = false) {
    if (!fecha) return;
    const d = startOfDay(fecha);
    const dias = daysBetween(today, d);
    if (!allowOverdue && dias < 0) return;
    if (dias > ventana) return;
    events.push({
      id: `${tipo}|${id}|${fmt(d)}`,
      tipo,
      titulo,
      descripcion,
      fecha: fmt(d),
      dias,
      en_ventana: dias <= ventana,
      prioridad: TIPOS[tipo].prio
    });
  }

  const byId = {};
  for (const e of employees || []) byId[e.id] = e;

  for (const e of employees || []) {
    const nac = parseDate(e.fecha_nacimiento);
    if (!nac) continue;
    const next = nextBirthday(nac.getMonth() + 1, nac.getDate(), today);
    const edad = new Date().getFullYear() - nac.getFullYear();
    pushEvent('cumpleanos', e.id, next,
      `Cumpleaños: ${e.nombres} ${e.apellidos}`,
      `${e.nombres} ${e.apellidos} cumple ${edad} años${e.puesto ? ' · ' + e.puesto : ''}`,
      diasCum);
  }

  const feriados = [...diasFeriados(today.getFullYear()), ...diasFeriados(today.getFullYear() + 1)];
  const pagos = new Map();
  for (const e of employees || []) {
    if (!(Number(e.salario) > 0)) continue;
    const t = e.tipo_salario;
    let nominal = null;
    if (t === 'quincenal') {
      const d15 = nextDateForDay(15, today);
      const dFin = nextDateForDay(31, today);
      nominal = d15 <= dFin ? d15 : dFin;
    } else if (t === 'mensual') {
      nominal = nextDateForDay(31, today);
    } else if (t === 'semanal') {
      nominal = nextFriday(today);
    } else {
      continue;
    }
    const efectivo = pagoEfectivo(nominal, feriados);
    const key = fmt(efectivo);
    if (!pagos.has(key)) pagos.set(key, { nominal, efectivo, lista: [] });
    pagos.get(key).lista.push(e);
  }
  for (const { nominal, efectivo, lista } of pagos.values()) {
    const dias = daysBetween(today, efectivo);
    if (dias < 0 || dias > diasPag) continue;
    const total = lista.reduce((sum, e) => sum + (Number(e.salario) || 0), 0);
    const cortos = lista.slice(0, 4).map(e => `${(e.nombres || '').split(' ')[0]} ${(e.apellidos || '').split(' ')[0]}`).join(', ');
    const extra = lista.length > 4 ? ` y ${lista.length - 4} más` : '';
    const razon = razonAdelanto(nominal, feriados);
    const adelantado = daysBetween(efectivo, nominal);
    const plural = adelantado === 1 ? 'día' : 'días';
    const adelanto = razon ? ` · El pago de ${fmt(nominal)} se adelanta ${adelantado} ${plural} al ${fmt(efectivo)} (${razon})` : '';
    pushEvent('pago', `fecha|${fmt(efectivo)}`, efectivo,
      `Pago de nómina · ${fmt(efectivo)}${razon ? ' ⚡ adelantado' : ''}`,
      `${labelPago(lista[0].tipo_salario)} · ${lista.length} empleado(s) · Total RD$ ${total.toLocaleString('es-DO')} · ${cortos}${extra}${adelanto}`,
      diasPag);
  }

  for (const e of employees || []) {
    const venc = parseDate(e.fecha_vencimiento);
    if (!venc) continue;
    const dias = daysBetween(today, venc);
    if (dias > diasCed) continue;
    const estado = dias < 0 ? ' · VENCIDA' : '';
    pushEvent('cedula', e.id, venc,
      `Cédula de ${e.nombres} ${e.apellidos}${estado}`,
      `Vence el ${fmt(venc)}${estado}${e.cedula ? ' · ' + e.cedula : ''}`,
      diasCed, true);
  }

  for (const e of employees || []) {
    const ing = parseDate(e.fecha_ingreso);
    if (!ing) continue;
    const next = nextBirthday(ing.getMonth() + 1, ing.getDate(), today);
    if (!next) continue;
    const anios = next.getFullYear() - ing.getFullYear();
    pushEvent('aniversario', e.id, next,
      `Aniversario laboral: ${e.nombres} ${e.apellidos}`,
      `${anios} año(s) en la empresa · desde ${fmt(ing)}${e.puesto ? ' · ' + e.puesto : ''}`,
      diasAniv);
  }

  for (const v of vacaciones || []) {
    if (String(v.modalidad || 'tomadas') !== 'tomadas') continue;
    const ini = parseDate(v.fecha_inicio);
    if (!ini) continue;
    const emp = byId[v.employee_id];
    if (!emp) continue;
    const tipoLabel = v.tipo === 'vacaciones' ? 'Vacaciones' : (String(v.tipo || '').replace(/_/g, ' ') || 'Permiso');
    pushEvent('vacaciones', v.id, ini,
      `${tipoLabel}: ${emp.nombres} ${emp.apellidos}`,
      `Inician el ${fmt(ini)}${v.motivo ? ' · ' + v.motivo : ''}`,
      diasVac);
  }

  events.sort((a, b) => (a.dias - b.dias) || (a.prioridad - b.prioridad) || a.titulo.localeCompare(b.titulo));
  return events;
}

function resumen(events) {
  const hoy = events.filter(e => e.dias === 0);
  const byTipo = (t) => hoy.filter(e => e.tipo === t).length;
  return {
    total: events.length,
    hoy: hoy.length,
    cumpleanos_hoy: byTipo('cumpleanos'),
    pagos_hoy: byTipo('pago'),
    cedulas_hoy: byTipo('cedula'),
    vacaciones_hoy: byTipo('vacaciones'),
    aniversarios_hoy: byTipo('aniversario')
  };
}

module.exports = { DEFAULTS, TIPOS, parseDate, computeEvents, resumen, diasFeriados, esDiaLaborable, pagoEfectivo, razonAdelanto };
