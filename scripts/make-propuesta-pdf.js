'use strict';
// Regenera la propuesta comercial de KARDEX Digital (PDF de 2 páginas).
// Uso: node scripts/make-propuesta-pdf.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const OUT = process.argv[2] || path.join(os.homedir(), 'Downloads', 'propuesta_comercial_kardex_digital_v2.pdf');
const LOGO = path.join(__dirname, '..', 'renderer', 'logo.png');

const PAGE_W = 595.28, PAGE_H = 841.89, M = 45, W = PAGE_W - M * 2;

const C = {
  navy: rgb(0.06, 0.09, 0.16),
  primary: rgb(0.15, 0.39, 0.92),
  primaryDark: rgb(0.11, 0.31, 0.85),
  amber: rgb(0.96, 0.61, 0.05),
  text: rgb(0.12, 0.18, 0.23),
  muted: rgb(0.39, 0.45, 0.53),
  light: rgb(0.96, 0.97, 0.99),
  border: rgb(0.89, 0.91, 0.94),
  white: rgb(1, 1, 1)
};

function wrap(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) { cur = t; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawFooter(page, font, pageNum, total) {
  page.drawLine({ start: { x: M, y: 45 }, end: { x: PAGE_W - M, y: 45 }, thickness: 0.7, color: C.border });
  page.drawText('KARDEX Digital — Propuesta Comercial Confidencial', {
    x: M, y: 34, size: 8, font, color: C.muted
  });
  page.drawText(`Página ${pageNum} de ${total}`, {
    x: PAGE_W - M - font.widthOfTextAtSize(`Página ${pageNum} de ${total}`, 8), y: 34, size: 8, font, color: C.muted
  });
}

function drawHeader(page, logo, fonts, fecha) {
  page.drawRectangle({ x: 0, y: PAGE_H - 128, width: PAGE_W, height: 128, color: C.navy });
  page.drawRectangle({ x: 0, y: PAGE_H - 132, width: PAGE_W, height: 4, color: C.primary });
  page.drawImage(logo, { x: M, y: PAGE_H - 102, width: 72, height: 72 });
  page.drawText('KARDEX DIGITAL', { x: M + 86, y: PAGE_H - 74, size: 26, font: fonts.bold, color: C.white });
  page.drawText('Sistema Integral de Expediente Electrónico y Nómina Dominicana', {
    x: M + 86, y: PAGE_H - 98, size: 11, font: fonts.reg, color: C.amber
  });
  const rightX = PAGE_W - M;
  page.drawText(`Fecha:  ${fecha}`, { x: rightX - 160, y: PAGE_H - 46, size: 9, font: fonts.reg, color: C.white });
  page.drawText('Propuesta No.:  PROP-2026-KD89', { x: rightX - 160, y: PAGE_H - 62, size: 9, font: fonts.reg, color: C.white });
  page.drawText('Validez:  30 días calendario', { x: rightX - 160, y: PAGE_H - 78, size: 9, font: fonts.reg, color: C.white });
}

function drawInfoBox(page, fonts, yTop) {
  const rows = [
    ['Dirigido a:', 'Gerencia de Recursos Humanos / Dirección de Contabilidad'],
    ['Empresa:', 'Estimado Cliente / Firma Aliada'],
    ['Ubicación:', 'Santo Domingo, República Dominicana'],
    ['Presentado por:', 'Equipo Comercial KARDEX Digital'],
    ['Contacto:', 'mverasparedes@gmail.com'],
    ['Teléfono / WhatsApp:', '(849) 654-3992']
  ];
  const rowH = 18;
  page.drawRectangle({ x: M, y: yTop - rows.length * rowH - 12, width: W, height: rows.length * rowH + 12, color: C.light, borderColor: C.border, borderWidth: 0.8 });
  let y = yTop - rowH + 6;
  for (const [label, value] of rows) {
    page.drawText(label, { x: M + 10, y, size: 9, font: fonts.bold, color: C.primaryDark });
    page.drawText(value, { x: M + 130, y, size: 9, font: fonts.reg, color: C.text });
    y -= rowH;
  }
  return yTop - rows.length * rowH - 12;
}

function drawPillar(page, fonts, y, num, title, desc) {
  page.drawRectangle({ x: M, y: y - 6, width: W, height: 1, color: C.border });
  page.drawText(`${num}`, { x: M, y, size: 13, font: fonts.bold, color: C.primary });
  const bullet = String.fromCharCode(8226);
  page.drawText(bullet, { x: M + 24, y: y - 14, size: 9, font: fonts.reg, color: C.primary });
  page.drawText(title, { x: M + 38, y: y - 2, size: 11, font: fonts.bold, color: C.text });
  const lines = wrap(desc, fonts.reg, 9, W - 38);
  let yy = y - 16;
  for (const ln of lines) { page.drawText(ln, { x: M + 38, y: yy, size: 9, font: fonts.reg, color: C.text }); yy -= 12; }
  return yy - 8;
}

function cellLines(cells, widths, fonts, size) {
  return cells.map((c, i) => {
    const lines = [];
    for (const part of String(c).split('\n')) lines.push(...wrap(part, fonts.reg, size, widths[i] - 12));
    return lines;
  });
}

async function main() {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { reg, bold };
  const logo = await doc.embedPng(fs.readFileSync(LOGO));
  const fecha = '10 de Agosto de 2026';

  const audit = [];
  let pageNo = 0;
  function patchDraw(page) {
    pageNo++;
    const orig = page.drawText.bind(page);
    page.drawText = (text, opts) => {
      const size = opts.size || 12;
      const font = opts.font || reg;
      audit.push({
        page: pageNo, text, x: opts.x, y: opts.y, size,
        w: font.widthOfTextAtSize(text, size), ascent: size * 0.72, descent: size * 0.25
      });
      return orig(text, opts);
    };
  }
  function runAudit() {
    const issues = [];
    for (let i = 0; i < audit.length; i++) {
      const a = audit[i];
      const ax0 = a.x, ax1 = a.x + a.w, ay0 = a.y - a.descent, ay1 = a.y + a.ascent;
      if (ax1 > PAGE_W || ax0 < 0 || ay1 > PAGE_H || ay0 < 0) {
        issues.push(`FUERA DE PAGINA p${a.page}: '${a.text.slice(0, 42)}' box x[${ax0.toFixed(1)},${ax1.toFixed(1)}] y[${ay0.toFixed(1)},${ay1.toFixed(1)}]`);
      } else if (ax1 > PAGE_W - M + 0.5 || ax0 < M - 0.5) {
        issues.push(`SALE DEL MARGEN p${a.page}: '${a.text.slice(0, 42)}' box x[${ax0.toFixed(1)},${ax1.toFixed(1)}] margen ${M}`);
      }
      for (let j = i + 1; j < audit.length; j++) {
        const b = audit[j];
        if (a.page !== b.page) continue;
        const ox = Math.min(ax1, b.x + b.w) - Math.max(ax0, b.x);
        const oy = Math.min(ay1, b.y + b.ascent) - Math.max(ay0, b.y - b.descent);
        if (ox > 1.5 && oy > 1.5) {
          issues.push(`SOLAPE p${a.page}: '${a.text.slice(0, 28)}' <-> '${b.text.slice(0, 28)}' ox=${ox.toFixed(1)} oy=${oy.toFixed(1)}`);
        }
      }
    }
    console.log(issues.length ? `AUDIT: ${issues.length} problema(s)` : 'AUDIT OK: sin solapes ni texto fuera de pagina');
    for (const s of issues) console.log('  -', s);
  }

  // ---------- PÁGINA 1 ----------
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  patchDraw(p1);
  drawHeader(p1, logo, fonts, fecha);
  drawFooter(p1, reg, 1, 2);

  let y = drawInfoBox(p1, fonts, PAGE_H - 148);
  y -= 18;
  const titleLines = wrap('Propuesta de Automatización de Expedientes de Empleados, Captura de Cédulas JCE y Nómina Adaptada a la Ley 16-92', bold, 12, W);
  for (const tl of titleLines) { p1.drawText(tl, { x: M, y, size: 12, font: bold, color: C.text }); y -= 15; }
  y -= 4;
  const intro = [
    'Estimados Sres.,',
    'Es un placer presentarles la propuesta comercial del software KARDEX Digital, una solución informática de escritorio diseñada específicamente para automatizar la gestión humana y el procesamiento de nómina dentro del marco legal de República Dominicana.',
    'En el entorno corporativo actual, la carga manual de datos desde documentos físicos y los errores en el cálculo de prestaciones impositivas (TSS y DGII) generan costos operativos considerables y riesgos de sanciones legales. KARDEX Digital resuelve estos desafíos combinando lectura automatizada de cédula dominicana, cálculo automatizado bajo el Código de Trabajo (Ley 16-92) y la operatividad centralizada en red local sin costos de alojamiento en la nube.'
  ];
  for (const par of intro) {
    const lines = wrap(par, reg, 9.5, W);
    for (const ln of lines) { p1.drawText(ln, { x: M, y, size: 9.5, font: reg, color: C.text }); y -= 13; }
    y -= 6;
  }
  y -= 12;
  p1.drawRectangle({ x: M, y: y + 4, width: 4, height: 16, color: C.primary });
  p1.drawText('Pilares Funcionales de KARDEX Digital', { x: M + 10, y: y + 8, size: 13, font: bold, color: C.text });
  y -= 22;

  const pillars = [
    ['Digitalización de Cédulas JCE', 'Captura automática frente/reverso desde PDF o imagen. Extrae cédula, nombres, fecha de nacimiento, sexo y dirección por 3 vías (OCR Tesseract en español, zona MRZ y código Code 128) con opción de asistencia con Inteligencia Artificial.'],
    ['Cumplimiento Normativo Ley 16-92', 'Motor de cálculo configurado con la legislación laboral dominicana: retenciones TSS (AFP 2.87%, SFS 3.04%), escala progresiva ISR de la DGII, salarios mínimos sectorizados y liquidaciones (cesantía, preaviso y vacaciones).'],
    ['Documentación y Correo Masivo', 'Generación inmediata en PDF y plantillas Word (.docx) editables con etiquetas dinámicas para contratos, cartas salariales y constancias de trabajo. Envío masivo de volante de pago por correo electrónico (SMTP).'],
    ['Red Local Centralizada (SQLite)', 'Una PC actúa como servidor local sin requerir internet permanente. Detección automática de terminales por UDP discovery, control de roles (Admin, Editor, Lectura), bitácora de auditoría y copias de respaldo automáticas.']
  ];
  for (let i = 0; i < pillars.length; i++) {
    y = drawPillar(p1, fonts, y, i + 1, pillars[i][0], pillars[i][1]);
  }

  // ---------- PÁGINA 2 ----------
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  patchDraw(p2);
  drawFooter(p2, reg, 2, 2);
  p2.drawText('Planes y Esquema de Inversión', { x: M, y: PAGE_H - 60, size: 15, font: bold, color: C.text });
  p2.drawText('Precios en Pesos Dominicanos (RD$). Precio anual con AHORRO del 16.7% (equivale a 2 meses gratis).', {
    x: M, y: PAGE_H - 76, size: 9, font: reg, color: C.muted
  });
  p2.drawLine({ start: { x: M, y: PAGE_H - 84 }, end: { x: PAGE_W - M, y: PAGE_H - 84 }, thickness: 1.5, color: C.primary });

  const widths = [118, 84, 108, 98, 97];
  const headers = ['PLAN COMERCIAL', 'CAPACIDAD EMPLEADOS', 'INFRAESTRUCTURA / RED', 'PRECIO ANUAL (AHORRO 16.7% / 2 MESES GRATIS)', 'OPCIÓN MENSUAL'];
  const rows = [
    ['Micro PYME\nPequeños Negocios', 'Hasta 10 empleados', '1 Equipo (Standalone)', 'RD$ 20,000 /año', 'RD$ 2,000 /mes'],
    ['PYME Crecimiento', 'Hasta 50 empleados', 'Servidor + 2 Nodos en Red', 'RD$ 35,000 /año', 'RD$ 3,500 /mes'],
    ['Empresa Pro\nMediana Empresa', 'Hasta 150 empleados', 'Servidor + 8 Nodos en Red', 'RD$ 65,000 /año', 'RD$ 6,500 /mes'],
    ['Firma / Outsourcing\nContadores & Asesores', 'Hasta 300 empleados', 'Multiempresa / Nodos Ilimitados', 'RD$ 100,000 /año', 'RD$ 10,000 /mes']
  ];

  const cellSize = 8.6;
  const headH = 36;
  const headLines = cellLines(headers, widths, fonts, 7.4);
  const rowHs = rows.map((r, i) => {
    const lines = cellLines(r, widths, fonts, cellSize);
    const maxLines = Math.max(...lines.map((l) => l.length));
    const h = Math.max(40, maxLines * 10.5 + 12);
    return i === 1 ? h + 14 : h;
  });

  function centerFirstLine(boxTop, boxBottom, n, step, ascent, descent) {
    const center = boxTop + (boxBottom - boxTop) / 2;
    return center + ((n - 1) * step + descent - ascent) / 2;
  }
  const hAscent = 7.4 * 0.72, hDescent = 7.4 * 0.25;
  let ty = PAGE_H - 94 - headH;
  let x = M;
  headers.forEach((h, i) => {
    p2.drawRectangle({ x, y: ty, width: widths[i], height: headH, color: C.navy });
    const colLines = wrap(h, fonts.bold, 7.4, widths[i] - 8);
    let yy = centerFirstLine(ty, ty + headH, colLines.length, 10, hAscent, hDescent);
    for (const ln of colLines) {
      p2.drawText(ln, { x: x + 4, y: yy, size: 7.4, font: fonts.bold, color: C.white });
      yy -= 10;
    }
    x += widths[i];
  });
  ty -= headH;

  const cAscent = cellSize * 0.72, cDescent = cellSize * 0.25;
  rows.forEach((r, i) => {
    const h = rowHs[i];
    const isPopular = i === 1;
    const lines = cellLines(r, widths, fonts, cellSize);
    let xx = M;
    for (let j = 0; j < widths.length; j++) {
      p2.drawRectangle({ x: xx, y: ty - h, width: widths[j], height: h, color: isPopular ? rgb(0.99, 0.97, 0.91) : C.light, borderColor: C.border, borderWidth: 0.7 });
      const colLines = lines[j];
      let yy = centerFirstLine(ty - h, ty, colLines.length, 10.5, cAscent, cDescent);
      const isPlan = j === 0;
      for (const ln of colLines) {
        p2.drawText(ln, { x: xx + 6, y: yy, size: cellSize, font: isPlan ? fonts.bold : fonts.reg, color: C.text });
        yy -= 10.5;
      }
      xx += widths[j];
    }
    if (isPopular) {
      const pillW = 74, pillH = 12;
      const px = M + 4, py = ty - 3;
      p2.drawRectangle({ x: px, y: py - pillH, width: pillW, height: pillH, color: C.amber });
      p2.drawText('MÁS POPULAR', { x: px + 5, y: py - pillH + 3, size: 6.5, font: fonts.bold, color: C.white });
    }
    ty -= h;
  });

  const notaLines = wrap('Nota: los límites de capacidad son referenciales de segmentación comercial; la solución puede ampliarse según el crecimiento del cliente.', reg, 7.8, W);
  for (const nl of notaLines) { p2.drawText(nl, { x: M, y: ty - 12, size: 7.8, font: reg, color: C.muted }); ty -= 11; }
  ty -= 18;

  p2.drawText('Servicios Incluidos y Puesta en Marcha Inicial', { x: M, y: ty, size: 13, font: bold, color: C.text });
  ty -= 18;
  const servicios = [
    ['Instalación y Configuración Base:', ' desde RD$ 4,000 (único pago) por el primer equipo; cada equipo adicional en la red suma RD$ 1,000. Incluye migración inicial de empleados vía Excel, configuración del logo institucional y parámetros impositivos.'],
    ['Garantía de Actualización Legal:', ' todos los planes anuales incluyen sin costo adicional las actualizaciones por reajustes en la escala salarial de la DGII o de la Ley 16-92.'],
    ['Capacitación al Personal:', ' 1 sesión virtual de 2 horas para el departamento de Recursos Humanos o Contabilidad. Capacitación adicional: +RD$ 1,000.'],
    ['Tier Inteligencia Artificial (opcional):', ' +RD$ 1,000/mes — extracción de cédula asistida por IA y envío automático de nómina por correo electrónico.']
  ];
  for (const [t, d] of servicios) {
    const lines = wrap(t + d, reg, 9.5, W - 14);
    p2.drawText(String.fromCharCode(8226), { x: M, y: ty, size: 10, font: bold, color: C.primary });
    for (const ln of lines) {
      p2.drawText(ln, { x: M + 14, y: ty, size: 9.5, font: reg, color: C.text });
      ty -= 12;
    }
    ty -= 4;
  }
  ty -= 6;

  p2.drawText('Próximos Pasos para la Implementación', { x: M, y: ty, size: 13, font: bold, color: C.text });
  ty -= 18;
  const pasos = [
    ['Activación de Prueba Demo (15 Días):', ' instalación de la versión totalmente funcional sin costo para validar el flujo en sus equipos.'],
    ['Aprobación de la Propuesta:', ' firma de la presente propuesta comercial y selección del plan deseado.'],
    ['Jornada de Parametrización:', ' carga masiva del archivo de personal e inducción operativa al equipo designado.']
  ];
  for (let i = 0; i < pasos.length; i++) {
    const [t, d] = pasos[i];
    const lines = wrap(t + d, reg, 9.5, W - 14);
    p2.drawText(`${i + 1}.`, { x: M, y: ty, size: 10, font: bold, color: C.primary });
    for (const ln of lines) {
      p2.drawText(ln, { x: M + 14, y: ty, size: 9.5, font: reg, color: C.text });
      ty -= 12;
    }
    ty -= 3;
  }
  ty -= 14;

  const close = wrap('Quedamos a su entera disposición para coordinar una presentación ejecutiva o demostración en vivo de 15 minutos en sus oficinas o mediante videoconferencia.', reg, 9.5, W);
  for (const ln of close) { p2.drawText(ln, { x: M, y: ty, size: 9.5, font: reg, color: C.text }); ty -= 13; }
  ty -= 8;
  p2.drawText('Atentamente,', { x: M, y: ty, size: 9.5, font: reg, color: C.text });
  ty -= 12;
  p2.drawText('Equipo de Comercialización y Soporte — KARDEX Digital República Dominicana', { x: M, y: ty, size: 9.5, font: reg, color: C.text });
  p2.drawText('mverasparedes@gmail.com  |  WhatsApp (849) 654-3992', { x: M, y: ty - 12, size: 9, font: reg, color: C.muted });
  ty -= 40;

  p2.drawLine({ start: { x: M, y: ty + 20 }, end: { x: W / 2 + M - 10, y: ty + 20 }, thickness: 0.8, color: C.muted });
  p2.drawText('Aceptado y Conforme (Cliente) — Firma Autorizada / Sello Corporativo', { x: M, y: ty + 6, size: 8.5, font: bold, color: C.text });
  p2.drawText('Nombre: ___________________________________      Cargo / Fecha: _____________________________', {
    x: M, y: ty - 10, size: 8.5, font: reg, color: C.text
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await doc.save());
  console.log('Propuesta generada:', OUT);
  runAudit();
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
