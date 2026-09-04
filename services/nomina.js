// Cálculos de nómina y prestaciones laborales (República Dominicana).
// Valores referenciales según Código de Trabajo (Ley 16-92) y tablas TSS/DGII.
// IMPORTANTE: cifras y escalas aproximadas; verificar con el Código de Trabajo y las tablas vigentes.

const DIAS_MES = 23.83;

const AFP_EMP = 0.0287; // aporte empleado AFP (2.87%)
const SFS_EMP = 0.0304; // aporte empleado SFS (3.04%)

// Aportes patronales TSS (República Dominicana, referenciales). Ajustables.
const SFS_PATRONAL = 0.0709; // SFS/ARS a cargo del empleador (7.09%)
const IESSL = 0.0040;        // Fondo de vivienda / educación superior (0.40%, base SFS)
const SRL = 0.0120;          // Seguro de Riesgos Laborales, empleador (1.20%, base SFS)
const AFP_PATRONAL = 0.0710; // AFP a cargo del empleador (7.10%)
const INFOTEP = 0.0100;      // INFOTEP (1.00%, sobre salario total sin tope)

// Aportes patronales TSS sobre el salario bruto de un empleado en un período.
// Usa las mismas bases topadas que las retenciones del empleado.
function calcAportesPatronales(bruto) {
  const b = round2(Number(bruto) || 0);
  const baseAFP = Math.min(b, AFP_TOPE);
  const baseSFS = Math.min(b, SFS_TOPE);
  return {
    sfsPatronal: round2(baseSFS * SFS_PATRONAL),
    iessl: round2(baseSFS * IESSL),
    srl: round2(baseSFS * SRL),
    afpPatronal: round2(baseAFP * AFP_PATRONAL),
    infotep: round2(b * INFOTEP)
  };
}

// Salario mínimo mensual referencial vigente (RD 2025-2026, sectorizado). Ajustable.
const SALARIO_MINIMO = 23223;
const AFP_TOPE = 20 * SALARIO_MINIMO; // tope cotizable AFP: 20 SMN = RD$ 464,460.00
const SFS_TOPE = 10 * SALARIO_MINIMO;  // tope cotizable SFS: 10 SMN = RD$ 232,230.00

// Escala ISR anual (DGII, vigente). El ingreso mensual se anualiza, se aplica la escala y se mensualiza.
const ISR_ESCALA_ANUAL = [
  { hasta: 416220.0, tasa: 0, base: 0, cuota: 0 },          // exento
  { hasta: 624329.0, tasa: 0.15, base: 416220.0, cuota: 0 },
  { hasta: 867123.0, tasa: 0.20, base: 624329.0, cuota: 31216.0 },
  { hasta: Infinity, tasa: 0.25, base: 867123.0, cuota: 79776.0 }
];

// Redondeo a 2 decimales tolerante al punto flotante: el epsilon solo corrige el "polvo"
// binario (p. ej. 30716.1/12 = 2559.6749999...), nunca cambia valores reales.
function round2(n) {
  return Math.round((Number(n) || 0) * 100 + 1e-6) / 100;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10 + 1e-6) / 10;
}

function parseDate(str) {
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // AAAA-MM-DD (incluye ISO con hora)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // DD/MM/AAAA
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\/(\d{4})$/); // MM/AAAA
  if (m) return new Date(+m[2], +m[1] - 1, 1);
  m = s.match(/^(\d{4})-(\d{1,2})$/); // AAAA-MM
  if (m) return new Date(+m[1], +m[2] - 1, 1);
  m = s.match(/^(\d{4})$/); // AAAA
  if (m) return new Date(+m[1], 0, 1);
  return null;
}

function monthsBetween(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e || e <= s) return 0;
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  const anchor = new Date(e.getFullYear(), e.getMonth(), s.getDate());
  const daysFrac = (e - anchor) / (1000 * 3600 * 24);
  months += Math.max(0, daysFrac) / 30.4375;
  return months;
}

// Salario mensual equivalente según el tipo de salario configurado.
function salarioMensual(salario, tipo) {
  const s = Number(salario) || 0;
  switch (String(tipo || 'mensual').toLowerCase()) {
    case 'quincenal': return s * 2;
    case 'semanal': return s * 4.33;
    case 'diario': return s * DIAS_MES;
    case 'por_hora': return s * 192; // 8 h × 24 días
    default: return s; // mensual
  }
}

function salarioDiario(salarioMensualVal) {
  return round2((Number(salarioMensualVal) || 0) / DIAS_MES);
}

function salarioHora(salarioMensualVal) {
  return round2((Number(salarioMensualVal) || 0) / (DIAS_MES * 8));
}

// ISR anual por la escala progresiva DGII (método de anualización del ingreso gravable).
function calcISRAnual(ingresoAnual) {
  const x = Number(ingresoAnual) || 0;
  for (const b of ISR_ESCALA_ANUAL) {
    if (x <= b.hasta) {
      return round2(b.cuota + b.tasa * Math.max(0, x - b.base));
    }
  }
  return 0;
}

// ISR mensual por retención: anualiza la base imponible mensual, aplica la escala DGII y mensualiza.
function calcISRMensual(ingresoGravable) {
  const mensual = Number(ingresoGravable) || 0;
  return round2(calcISRAnual(mensual * 12) / 12);
}

// Cálculo mensual de un empleado (base, extras, incentivos, pago de vacaciones, retenciones y neto).
// `incentivos` es un mapa { employee_id: [{ monto, motivo }] }.
// `pagosVacaciones` es un mapa { employee_id: { dias, monto, modalidad } }.
// `extras` es un mapa { employee_id: { horas_extra, domingos_extra, feriados_extra, otros_ingresos } }.
function calcEmpleadoMes(emp, extras = {}, incentivos = {}, pagosVacaciones = {}) {
  const sm = round2(salarioMensual(emp.salario, emp.tipo_salario));
  if (sm <= 0) return null;
  const ex = extras[emp.id] || {};
  const horasExtra = Number(ex.horas_extra) || 0;
  const domingosExtra = Number(ex.domingos_extra) || 0;
  const feriadosExtra = Number(ex.feriados_extra) || 0;
  const pagoHoras = round2(salarioHora(sm) * horasExtra * 2);
  const pagoDomingos = round2(salarioDiario(sm) * domingosExtra * 2);
  const pagoFeriados = round2(salarioHora(sm) * feriadosExtra * 2);
  const extra = round2(pagoHoras + pagoDomingos + pagoFeriados);
  const otrosIngresos = round2(Number(ex.otros_ingresos) || 0);
  const transporte = round2(Number(ex.transporte) || 0);
  const incentivo = round2((incentivos[emp.id] || []).reduce((sum, i) => sum + (Number(i.monto) || 0), 0));
  const pv = pagosVacaciones[emp.id] || null;
  const vacacionDias = pv ? Number(pv.dias) || 0 : 0;
  const vacacionPago = pv ? round2(Number(pv.monto) || 0) : 0;
  const bruto = round2(sm + extra + otrosIngresos + transporte + incentivo + vacacionPago);
  const baseAFP = Math.min(bruto, AFP_TOPE);
  const baseSFS = Math.min(bruto, SFS_TOPE);
  const afp = round2(baseAFP * AFP_EMP);
  const sfs = round2(baseSFS * SFS_EMP);
  const baseImponibleISR = round2(bruto - afp - sfs);
  const isr = calcISRMensual(baseImponibleISR);
  const retenciones = round2(afp + sfs + isr);
  const neto = round2(bruto - retenciones);
  return {
    salario: sm, horasExtra, domingosExtra, feriadosExtra, pagoHoras, pagoDomingos, pagoFeriados,
    extra, otrosIngresos, transporte, incentivo, vacacionDias, vacacionPago, bruto, afp, sfs, isr, retenciones, neto
  };
}

// Nómina mensual para un conjunto de empleados (solo los que tienen salario > 0).
// `extras` es un mapa { employee_id: { horas_extra, domingos_extra, feriados_extra, otros_ingresos } }.
// `incentivos` es un mapa { employee_id: [{ monto, motivo }] }.
// `pagosVacaciones` es un mapa { employee_id: { dias, monto, modalidad } }.
// Horas extra, domingos y feriados se pagan con 100% de recargo (Código de Trabajo).
function calcNomina(employees, mes, anio, extras = {}, incentivos = {}, pagosVacaciones = {}) {
  const rows = [];
  const totales = { salario: 0, extra: 0, feriados: 0, otros_ingresos: 0, incentivo: 0, vacaciones: 0, bruto: 0, afp: 0, sfs: 0, isr: 0, retenciones: 0, neto: 0 };
  for (const emp of employees || []) {
    const m = calcEmpleadoMes(emp, extras, incentivos, pagosVacaciones);
    if (!m) continue;
    rows.push({
      id: emp.id,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      cedula: emp.cedula,
      puesto: emp.puesto,
      departamento: emp.departamento,
      salario: m.salario,
      horas_extra: m.horasExtra,
      domingos_extra: m.domingosExtra,
      feriados_extra: m.feriadosExtra,
      horas_pago: m.pagoHoras,
      domingos_pago: m.pagoDomingos,
      feriados_pago: m.pagoFeriados,
      extra: m.extra,
      otros_ingresos: m.otrosIngresos,
      incentivo: m.incentivo,
      vacaciones_dias: m.vacacionDias,
      vacaciones_pago: m.vacacionPago,
      bruto: m.bruto,
      afp: m.afp,
      sfs: m.sfs,
      isr: m.isr,
      retenciones: m.retenciones,
      neto: m.neto
    });
    totales.salario += m.salario;
    totales.extra += m.extra;
    totales.feriados += m.pagoFeriados;
    totales.otros_ingresos += m.otrosIngresos;
    totales.incentivo += m.incentivo;
    totales.vacaciones += m.vacacionPago;
    totales.bruto += m.bruto;
    totales.afp += m.afp;
    totales.sfs += m.sfs;
    totales.isr += m.isr;
    totales.retenciones += m.retenciones;
    totales.neto += m.neto;
  }
  for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
  return { mes: Number(mes), anio: Number(anio), rows, totales, parametros: { AFP_EMP, SFS_EMP, SALARIO_MINIMO, AFP_TOPE, SFS_TOPE } };
}

// Nómina en dos quincenas: mitad del sueldo en cada una; las retenciones
// (AFP, SFS/ARS e ISR) y los extras/incentivos/pago de vacaciones se aplican en la segunda quincena.
// `deduccionesManuales` es un mapa { employee_id: [{ monto, quincena }] } donde quincena: 0=todas, 1=primera, 2=segunda.
function calcNominaQuincenal(employees, mes, anio, extras = {}, incentivos = {}, pagosVacaciones = {}, deduccionesManuales = {}) {
  const rows = [];
  const totales = { salario: 0, extra: 0, feriados: 0, otros_ingresos: 0, transporte: 0, incentivo: 0, vacaciones: 0, quincena1: 0, quincena2_bruto: 0, afp: 0, sfs: 0, isr: 0, retenciones: 0, deducciones_manuales: 0, salario_mitad_total: 0, dm_q1_total: 0, dm_q2_total: 0, quincena2_neto: 0, neto: 0 };
  for (const emp of employees || []) {
    const m = calcEmpleadoMes(emp, extras, incentivos, pagosVacaciones);
    if (!m) continue;
    const mitad = round2(m.salario / 2);
    const dm = deduccionesManuales[emp.id] || [];
    const dmQ1 = round2(dm.filter((d) => d.quincena === 1 || d.quincena === 0).reduce((s, d) => s + (Number(d.monto) || 0), 0));
    const dmQ2 = round2(dm.filter((d) => d.quincena === 2 || d.quincena === 0).reduce((s, d) => s + (Number(d.monto) || 0), 0));
    const totalDm = round2(dmQ1 + dmQ2);
    const q1 = round2(mitad - dmQ1);
    const q2Bruto = round2(mitad + m.extra + m.otrosIngresos + m.transporte + m.incentivo + m.vacacionPago);
    const ret = m.retenciones;
    const q2Neto = round2(q2Bruto - ret - dmQ2);
    const totalNeto = round2(q1 + q2Neto);
    const tBrutoQ1 = round2(mitad + m.transporte);
    const tBrutoQ2 = round2(mitad + m.extra + m.otrosIngresos + m.transporte + m.incentivo + m.vacacionPago);
    rows.push({
      id: emp.id,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      cedula: emp.cedula,
      departamento: emp.departamento,
      salario: m.salario,
      horas_extra: m.horasExtra,
      domingos_extra: m.domingosExtra,
      feriados_extra: m.feriadosExtra,
      horas_pago: m.pagoHoras,
      domingos_pago: m.pagoDomingos,
      feriados_pago: m.pagoFeriados,
      extra: m.extra,
      otros_ingresos: m.otrosIngresos,
      transporte: m.transporte,
      total_bruto_q1: tBrutoQ1,
      total_bruto_q2: tBrutoQ2,
      incentivo: m.incentivo,
      vacaciones_dias: m.vacacionDias,
      vacaciones_pago: m.vacacionPago,
      bruto: m.bruto,
      afp: m.afp,
      sfs: m.sfs,
      isr: m.isr,
      retenciones: ret,
      deducciones_manuales: totalDm,
      salario_mitad: mitad,
      dm_q1: dmQ1,
      dm_q2: dmQ2,
      quincena1: q1,
      quincena2_bruto: q2Bruto,
      quincena2_neto: q2Neto,
      total_neto: totalNeto
    });
    totales.salario += m.salario;
    totales.extra += m.extra;
    totales.feriados += m.pagoFeriados;
    totales.otros_ingresos += m.otrosIngresos;
    totales.incentivo += m.incentivo;
    totales.vacaciones += m.vacacionPago;
    totales.transporte += m.transporte;
    totales.quincena1 += q1;
    totales.quincena2_bruto += q2Bruto;
    totales.afp += m.afp;
    totales.sfs += m.sfs;
    totales.isr += m.isr;
    totales.retenciones += ret;
    totales.deducciones_manuales += totalDm;
    totales.salario_mitad_total += mitad;
    totales.dm_q1_total += dmQ1;
    totales.dm_q2_total += dmQ2;
    totales.quincena2_neto += q2Neto;
    totales.neto += totalNeto;
  }
  for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
  return { mes: Number(mes), anio: Number(anio), rows, totales };
}

// Nómina semanal: reparte el salario en 4 semanas (cada una = salario/4) y aplica
// extras, otros, incentivos, vacaciones y retenciones (AFP/SFS/ISR) en la última semana.
function calcNominaSemanal(employees, mes, anio, extras = {}, incentivos = {}, pagosVacaciones = {}) {
  const rows = [];
  const totales = { salario: 0, extra: 0, feriados: 0, otros_ingresos: 0, incentivo: 0, vacaciones: 0, bruto: 0, afp: 0, sfs: 0, isr: 0, retenciones: 0, neto: 0 };
  const SEMANAS = 4;
  for (const emp of employees || []) {
    const m = calcEmpleadoMes(emp, extras, incentivos, pagosVacaciones);
    if (!m) continue;
    const semBase = round2(m.salario / SEMANAS);
    const ret = m.retenciones;
    const ultimaBruto = round2(semBase + m.extra + m.otrosIngresos + m.incentivo + m.vacacionPago);
    const ultimaNeto = round2(ultimaBruto - ret);
    const totalNeto = round2(semBase * (SEMANAS - 1) + ultimaNeto);
    rows.push({
      id: emp.id,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      cedula: emp.cedula,
      departamento: emp.departamento,
      salario: m.salario,
      horas_extra: m.horasExtra,
      domingos_extra: m.domingosExtra,
      feriados_extra: m.feriadosExtra,
      horas_pago: m.pagoHoras,
      domingos_pago: m.pagoDomingos,
      feriados_pago: m.pagoFeriados,
      extra: m.extra,
      otros_ingresos: m.otrosIngresos,
      incentivo: m.incentivo,
      vacaciones_dias: m.vacacionDias,
      vacaciones_pago: m.vacacionPago,
      bruto: m.bruto,
      afp: m.afp,
      sfs: m.sfs,
      isr: m.isr,
      retenciones: ret,
      semana_bruto: semBase,
      semana_neto: round2(semBase),
      ultima_bruto: ultimaBruto,
      ultima_neto: ultimaNeto,
      total_neto: totalNeto
    });
    totales.salario += m.salario;
    totales.extra += m.extra;
    totales.feriados += m.pagoFeriados;
    totales.otros_ingresos += m.otrosIngresos;
    totales.incentivo += m.incentivo;
    totales.vacaciones += m.vacacionPago;
    totales.bruto += m.bruto;
    totales.afp += m.afp;
    totales.sfs += m.sfs;
    totales.isr += m.isr;
    totales.retenciones += ret;
    totales.neto += totalNeto;
  }
  for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
  return { mes: Number(mes), anio: Number(anio), rows, totales };
}

// Nómina diaria: muestra el salario diario (mensual/23.83) y el total del mes
// con sus retenciones. El pago diario bruto es el salario diario.
function calcNominaDiaria(employees, mes, anio, extras = {}, incentivos = {}, pagosVacaciones = {}) {
  const rows = [];
  const totales = { salario: 0, extra: 0, feriados: 0, otros_ingresos: 0, incentivo: 0, vacaciones: 0, bruto: 0, afp: 0, sfs: 0, isr: 0, retenciones: 0, neto: 0 };
  for (const emp of employees || []) {
    const m = calcEmpleadoMes(emp, extras, incentivos, pagosVacaciones);
    if (!m) continue;
    const diario = salarioDiario(m.salario);
    const ret = m.retenciones;
    rows.push({
      id: emp.id,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      cedula: emp.cedula,
      departamento: emp.departamento,
      salario: m.salario,
      salario_diario: diario,
      dias_mes: DIAS_MES,
      horas_extra: m.horasExtra,
      domingos_extra: m.domingosExtra,
      feriados_extra: m.feriadosExtra,
      horas_pago: m.pagoHoras,
      domingos_pago: m.pagoDomingos,
      feriados_pago: m.pagoFeriados,
      extra: m.extra,
      otros_ingresos: m.otrosIngresos,
      incentivo: m.incentivo,
      vacaciones_dias: m.vacacionDias,
      vacaciones_pago: m.vacacionPago,
      bruto: m.bruto,
      afp: m.afp,
      sfs: m.sfs,
      isr: m.isr,
      retenciones: ret,
      pago_diario_bruto: diario,
      pago_diario_neto: round2(diario),
      neto: m.neto
    });
    totales.salario += m.salario;
    totales.extra += m.extra;
    totales.feriados += m.pagoFeriados;
    totales.otros_ingresos += m.otrosIngresos;
    totales.incentivo += m.incentivo;
    totales.vacaciones += m.vacacionPago;
    totales.bruto += m.bruto;
    totales.afp += m.afp;
    totales.sfs += m.sfs;
    totales.isr += m.isr;
    totales.retenciones += ret;
    totales.neto += m.neto;
  }
  for (const k of Object.keys(totales)) totales[k] = round2(totales[k]);
  return { mes: Number(mes), anio: Number(anio), rows, totales };
}

// Días de cesantía (Art. 80, Ley 16-92), escala de la calculadora oficial del MT:
// 3-6 meses → 6 días; 6-12 meses → 13 días; 1-5 años → 21 días/año; >5 años → 23 días/año.
// La fracción de año se suma al final: 3-6 meses → +6 días; 6-12 meses → +13 días.
// `t` es el resultado de calcDifFechas ({ years, months, days }).
function diasCesantia(t) {
  const years = Math.max(0, (t && t.years) || 0);
  const months = Math.max(0, (t && t.months) || 0);
  let d = 0;
  if (years >= 5) d += 23 * years;
  else if (years >= 1) d += 21 * years;
  if (months >= 6) d += 13;
  else if (months >= 3) d += 6;
  return d;
}

// Días de preaviso sin aviso previo (Art. 76): 7/14/28 días según el total de meses de servicio.
function diasPreaviso(totalMeses) {
  const m = Number(totalMeses) || 0;
  if (m >= 12) return 28;
  if (m >= 6) return 14;
  if (m >= 3) return 7;
  return 0;
}

// Días de vacaciones (Arts. 177-180).
// Si tomó las vacaciones del último año: solo la parte proporcional del período en curso
// (5-11 meses → 6-12 días). Si no las tomó: 18 días (>5 años), 14 días (1-5 años) o
// proporcional si tiene menos de 1 año. Igual que la calculadora oficial del MT.
function diasVacaciones(t, totalMeses, tomoUltimoAnio) {
  const months = Math.max(0, (t && t.months) || 0);
  if (tomoUltimoAnio) {
    if (months >= 11) return 12;
    if (months >= 10) return 11;
    if (months >= 9) return 10;
    if (months >= 8) return 9;
    if (months >= 7) return 8;
    if (months >= 6) return 7;
    if (months >= 5) return 6;
    return 0;
  }
  const m = Number(totalMeses) || 0;
  if (m >= 60) return 18;
  if (m >= 12) return 14;
  if (m >= 5) return m + 1;
  return 0;
}

// Días de un mes (1-indexado), igual que la calculadora oficial del MT.
function diasMes(m, y) {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 2: return (y % 4 === 0) ? 29 : 28;
  }
  return 30;
}

// Diferencia de fechas en años/meses/días residuales, réplica exacta de la
// calculadora oficial del MT (calculo.mt.gob.do): toma prestados los días del mes
// de ingreso (1-indexado, en el año de salida) cuando el día de salida es menor.
function calcDifFechas(ing, sal) {
  let a = sal.getFullYear();
  let o = ing.getMonth();
  let r = sal.getMonth();
  let s = ing.getDate();
  let l = sal.getDate();
  if (l < s) { l += diasMes(o + 1, a); r -= 1; }
  if (r < o) { r += 12; a -= 1; }
  return { years: a - ing.getFullYear(), months: r - o, days: l - s };
}

// Regalía pascual proporcional (Art. 219): suma de salarios del período ÷ 12.
// Período: desde el 1-ene del año de salida (o el ingreso si es el mismo año) hasta la
// fecha de salida. El mes parcial cuenta el día de salida (días + 1), como la calculadora
// oficial del MT en la práctica, y se prorratea contra los días del mes de salida.
function regaliaPascual(salarioMensualVal, fechaIngreso, fechaSalida) {
  const ing = parseDate(fechaIngreso);
  const sal = parseDate(fechaSalida);
  if (!ing || !sal || sal <= ing) return 0;
  const sm = Number(salarioMensualVal) || 0;
  let ini;
  if (ing.getFullYear() !== sal.getFullYear()) {
    ini = (sal.getDate() === 1 && sal.getMonth() === 0)
      ? ing
      : new Date(sal.getFullYear(), 0, 1);
  } else {
    ini = ing;
  }
  const t = calcDifFechas(ini, sal);
  if (t.years > 0) return sm;
  const a = diasMes(sal.getMonth() + 1, sal.getFullYear());
  return round2(sm * (t.months + (t.days + 1) / a) / 12);
}

// Regalía pascual ("sueldo 13") de toda la plantilla para un año.
// Período: 1 dic del año anterior al 30 nov del año indicado (Art. 219).
// Si el salario cambió durante el año, usa el salario promedio ponderado por meses.
function calcRegalia(employees, anio, salarioHistorialFn, salarioHistorialListFn) {
  const y = Number(anio) || new Date().getFullYear();
  const inicioPeriodo = new Date(y - 1, 11, 1);
  const finPeriodo = new Date(y, 10, 30);
  const hoy = new Date();
  const fin = hoy < finPeriodo ? hoy : finPeriodo;
  const rows = [];
  let total = 0;
  for (const emp of employees || []) {
    let sm = round2(salarioMensual(emp.salario, emp.tipo_salario));
    if (sm <= 0) continue;
    if (salarioHistorialFn) {
      const promedio = salarioHistorialFn(emp.id, y);
      if (promedio && promedio > 0) sm = round2(promedio);
    }
    const ing = parseDate(emp.fecha_ingreso);
    const ini = ing && ing > inicioPeriodo ? ing : inicioPeriodo;
    const meses = Math.max(0, monthsBetween(ini, fin));
    const monto = round2(sm * meses / 12);

    let cambios = [];
    if (salarioHistorialListFn) {
      const allChanges = salarioHistorialListFn(emp.id);
      for (const ch of allChanges) {
        const fc = parseDate(ch.fecha_cambio);
        if (fc && fc >= inicioPeriodo && fc <= finPeriodo) {
          cambios.push({
            fecha: ch.fecha_cambio,
            anterior: round2(ch.salario_anterior),
            nuevo: round2(ch.salario),
            motivo: ch.motivo || ''
          });
        }
      }
    }

    rows.push({
      id: emp.id,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      cedula: emp.cedula,
      puesto: emp.puesto,
      departamento: emp.departamento,
      salario: sm,
      meses: round2(meses),
      regalia: monto,
      cambios
    });
    total += monto;
  }
  return {
    anio: y,
    periodo: `dic ${y - 1} – nov ${y}`,
    rows,
    total: round2(total)
  };
}

// Liquidación / finiquito al dar de baja. Replica la calculadora oficial del Ministerio
// de Trabajo (calculo.mt.gob.do): Arts. 33 (divisor 23.83), 76 (preaviso), 80 (cesantía),
// 177-180 (vacaciones) y 219 (regalía pascual). Montos brutos, sin descuentos TSS/ISR.
function calcLiquidacion({
  salario, tipo_salario, fecha_ingreso, fecha_baja,
  ha_sido_preavisado, incluir_cesantia, tomo_vacaciones_ultimo_ano, incluir_salario_navidad
} = {}) {
  const sm = round2(salarioMensual(salario, tipo_salario));
  const sd = sm / DIAS_MES; // sin redondear (la calculadora oficial multiplica antes de redondear)
  const fechaFin = fecha_baja || nowIsoLike();
  const ing = parseDate(fecha_ingreso);
  const fin = parseDate(fechaFin);
  const t = ing && fin && fin > ing ? calcDifFechas(ing, fin) : { years: 0, months: 0, days: 0 };
  const totalMeses = t.years * 12 + t.months;

  const diasP = ha_sido_preavisado ? 0 : diasPreaviso(totalMeses);
  const diasC = incluir_cesantia !== false ? diasCesantia(t) : 0;
  const diasV = diasVacaciones(t, totalMeses, tomo_vacaciones_ultimo_ano !== false);
  const preaviso = round2(diasP * sd);
  const cesantia = round2(diasC * sd);
  const vacaciones = round2(diasV * sd);
  const regalia = incluir_salario_navidad !== false ? regaliaPascual(sm, fecha_ingreso, fechaFin) : 0;
  const total = round2(preaviso + cesantia + vacaciones + regalia);

  return {
    fecha_baja: fechaFin,
    salario_mensual: sm,
    salario_diario: round2(sd),
    tiempo_laborado: t,
    meses_servicio: round2(totalMeses + t.days / 30.4375),
    cesantia_dias: diasC,
    preaviso_dias: diasP,
    vacaciones_dias: diasV,
    cesantia,
    preaviso,
    vacaciones,
    regalia,
    total,
    monto_preaviso: preaviso,
    monto_cesantia: cesantia,
    monto_vacaciones: vacaciones,
    monto_salario_navidad: regalia,
    total_a_recibir: total
  };
}

function nowIsoLike() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = {
  DIAS_MES, AFP_EMP, SFS_EMP, SALARIO_MINIMO, AFP_TOPE, SFS_TOPE,
  SFS_PATRONAL, IESSL, SRL, AFP_PATRONAL, INFOTEP, calcAportesPatronales,
  round2, round1, parseDate, monthsBetween,
  salarioMensual, salarioDiario, salarioHora, calcISRAnual, calcISRMensual, calcNomina,
  calcNominaQuincenal, calcNominaSemanal, calcNominaDiaria, calcEmpleadoMes,
  diasCesantia, diasPreaviso, diasVacaciones, regaliaPascual, calcLiquidacion,
  calcDifFechas, diasMes,
  calcRegalia,
  nowIsoLike
};
