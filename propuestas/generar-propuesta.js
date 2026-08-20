'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('C:/Users/STIVEN/Documents/Default Project/kardex-digital/node_modules/pdf-lib/cjs/index.js');

const OUT = path.join(__dirname, 'Propuesta de Servicios NEXUS.pdf');

const W = 595.28;
const H = 841.89;

const INK = rgb(0.2, 0.25, 0.33);       // #334054
const NAVY = rgb(0.055, 0.1, 0.235);    // fondo portada
const BLUE = rgb(0.118, 0.227, 0.541);  // #1E3A8A titulos
const ACCENT = rgb(0.145, 0.388, 0.922); // #2563EB
const LIGHTBLUE = rgb(0.572, 0.767, 0.984); // #93C5FD
const CHIP = rgb(0.859, 0.918, 0.996);  // #DBEAFE
const GRAY = rgb(0.278, 0.333, 0.412);  // #475569
const BAND = rgb(0.945, 0.961, 0.976);  // #F1F5F9
const GOLD = rgb(0.96, 0.62, 0.04);
const RED = rgb(0.78, 0.22, 0.2);
const WHITE = rgb(1, 1, 1);

const money = (n) => 'RD$ ' + n.toLocaleString('en-US');

function wrap(t, size, f, maxW) {
  const words = t.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (f.widthOfTextAtSize(test, size) <= maxW) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Propuesta de Servicios NEXUS');
  pdf.setProducer('NEXUS');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // y = distancia desde el borde superior de la pagina; el cursor crece hacia abajo.
  const draw = (p, t, { x = 57, y, size = 10, f = font, c = INK } = {}) =>
    p.drawText(t, { x, y: H - y, size, font: f, color: c });
  const box = (p, x, ty, w, h, c) =>
    p.drawRectangle({ x, y: H - (ty + h), width: w, height: h, color: c });
  const line = (p, x1, ty1, x2, ty2, c, t) =>
    p.drawLine({ start: { x: x1, y: H - ty1 }, end: { x: x2, y: H - ty2 }, thickness: t, color: c });
  const para = (p, t, y, size = 10, maxW = W - 114, lh = 14.5) => {
    const lines = wrap(t, size, font, maxW);
    for (let i = 0; i < lines.length; i++) draw(p, lines[i], { x: 57, y: y + i * lh, size, c: INK });
    return y + lines.length * lh;
  };
  const title = (p, t, y, c = BLUE) => {
    box(p, 57, y - 12, 4, 18, ACCENT);
    draw(p, t, { x: 69, y, size: 15.75, f: bold, c });
    return y + 26;
  };
  const bullet = (p, t, y, size = 10.5, c = INK) => {
    draw(p, '\u2022', { x: 57, y, size: size + 2, f: bold, c: ACCENT });
    draw(p, t, { x: 73, y, size, c });
    return y + (size + 4);
  };
  const checkMark = (p, x, ty, s, c) => {
    line(p, x, ty + s * 0.45, x + s * 0.35, ty + s * 0.1, c, 1.6);
    line(p, x + s * 0.35, ty + s * 0.1, x + s, ty + s * 0.6, c, 1.6);
  };

  // ============================================================ PAGINA 1: PORTADA
  {
    const p = pdf.addPage([W, H]);
    box(p, 0, 0, W, H, NAVY);

    draw(p, 'NEXUS', { x: 62.4, y: 138, size: 22.5, f: bold, c: WHITE });
    draw(p, 'Nexus Software RD', { x: 62.4, y: 158.2, size: 10.5, c: WHITE });
    box(p, 62.4, 170, 52, 2, LIGHTBLUE);

    draw(p, 'Propuesta de Servicios', { x: 62.4, y: 225, size: 30, f: bold, c: WHITE });
    draw(p, 'KARDEX Digital + NEXALERT', { x: 62.4, y: 259.5, size: 26, f: bold, c: LIGHTBLUE });
    let sy = 306;
    const sub = wrap('Control de expedientes y planillas de empleados, y reportes autom\u00E1ticos de fallas por WhatsApp.', 13.5, font, W - 180);
    for (const l of sub) { draw(p, l, { x: 62.4, y: sy, size: 13.5, c: WHITE }); sy += 19; }

    checkMark(p, 62.4, 381, 10, LIGHTBLUE);
    draw(p, 'Cumplimiento laboral y reportes autom\u00E1ticos', { x: 79, y: 390, size: 11.25, f: bold, c: LIGHTBLUE });

    draw(p, 'Preparado para: [Nombre de la empresa]', { x: 62.4, y: 762.7, size: 10.5, c: WHITE });
    draw(p, 'Fecha: [__/__/____] \u00B7 Referencia: [NEXUS-00X]', { x: 62.4, y: 777, size: 10.5, c: WHITE });
  }

  // ============================================================ PAGINA 2
  {
    const p = pdf.addPage([W, H]);
    let y = 57.7;

    y = title(p, '1. Sobre nosotros', y);
    y = para(p, 'Somos Nexus Software RD, una empresa dominicana especializada en sistemas de gesti\u00F3n empresarial: el control digital de expedientes y planillas de empleados (KARDEX Digital) y el env\u00EDo autom\u00E1tico de reportes de fallas de equipos por WhatsApp (NEXALERT). Nuestro software permite a las empresas llevar su informaci\u00F3n de forma digital, ordenada y siempre disponible, eliminando el papeleo y el riesgo ante inspecciones y paradas de equipos.', y);
    y += 10;

    const rest = 'que tu empresa cumpla con la ley sin complicaciones y con un costo claro y predecible.';
    const restLines = wrap(rest, 12, font, W - 190);
    const cH = 30 + 15 * restLines.length;
    box(p, 57, y, W - 114, cH, CHIP);
    box(p, 57, y, 4, cH, ACCENT);
    draw(p, 'Nuestro compromiso:', { x: 73, y: y + 20, size: 12, f: bold, c: NAVY });
    let cy = y + 38;
    for (const l of restLines) { draw(p, l, { x: 73, y: cy, size: 12, c: NAVY }); cy += 15; }
    y += cH + 18;

    y = title(p, '2. La necesidad', y);
    y = para(p, 'Toda empresa dominicana que contrate personal est\u00E1 obligada a llevar el registro de sus empleados conforme al C\u00F3digo de Trabajo (Ley 16-92) y las disposiciones del Ministerio de Trabajo. Este registro debe reflejar altas, bajas, salarios, vacaciones, licencias y planillas de n\u00F3mina. Cuando se lleva en papel u hojas de c\u00E1lculo desordenadas, la empresa est\u00E1 expuesta a multas y complicaciones en cada inspecci\u00F3n. Y cuando un equipo falla, cada minuto sin reporte es tiempo y dinero perdido.', y);
    y += 4;
    y = bullet(p, 'Centraliza la informaci\u00F3n en un solo lugar.', y);
    y = bullet(p, 'Evita sanciones por falta de registro de personal.', y);
    y = bullet(p, 'Responde r\u00E1pido ante una inspecci\u00F3n o una falla de equipos.', y);
    y += 10;

    y = title(p, '3. Nuestra soluci\u00F3n', y);
    y = para(p, 'NEXUS es el paquete de programas de gesti\u00F3n empresarial de Nexus Software RD: KARDEX Digital organiza la informaci\u00F3n de tus empleados y exporta tus planillas; NEXALERT se conecta a tu WhatsApp y env\u00EDa autom\u00E1ticamente cada falla de tus equipos al grupo o contacto que elijas.', y);
    y += 8;

    const cards = [
      ['Registro de empleados', 'Ficha completa con foto, c\u00E9dula, documentos y cargos.'],
      ['Cumplimiento laboral', 'Tu kardex y planilla 609 listos para el Ministerio de Trabajo y la DGII.'],
      ['Control de pagos', 'Planillas de n\u00F3mina y recordatorios de cuotas del servicio.'],
      ['Reportes exportables', 'Excel y PDF para tu contabilidad y auditor\u00EDas.'],
      ['Reportes de fallas', 'Cada aver\u00EDa de tus equipos llega al instante a tu WhatsApp.'],
      ['Soporte directo', 'Atenci\u00F3n por WhatsApp en horario laboral.'],
    ];
    const cw = 241, ch = 58, gap = 8;
    const gridTop = y;
    for (let i = 0; i < cards.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = 57 + col * (cw + gap);
      const cy2 = gridTop + row * (ch + 12);
      box(p, cx, cy2, cw, ch, BAND);
      box(p, cx, cy2, 3, ch, col === 0 ? ACCENT : BLUE);
      box(p, cx + 9, cy2 + 9, 14, 14, col === 0 ? ACCENT : BLUE);
      checkMark(p, cx + 12, cy2 + 13, 8, WHITE);
      draw(p, cards[i][0], { x: cx + 30, y: cy2 + 21, size: 10, f: bold, c: NAVY });
      const dLines = wrap(cards[i][1], 9.5, font, cw - 42);
      for (let j = 0; j < dLines.length; j++) draw(p, dLines[j], { x: cx + 30, y: cy2 + 36 + j * 13, size: 9.5, c: INK });
    }

    draw(p, 'Nexus Software RD \u00B7 Propuesta [NEXUS-00X] \u00B7 P\u00E1gina 2', { x: 210, y: 800, size: 8.6, c: GRAY });
  }

  // ============================================================ PAGINA 3
  {
    const p = pdf.addPage([W, H]);
    let y = 57.7;

    y = title(p, '4. Alcance del servicio', y);
    y += 2;
    y = bullet(p, 'Instalaci\u00F3n y configuraci\u00F3n inicial de los programas.', y);
    y = bullet(p, 'Carga de los datos de tus empleados actuales.', y);
    y = bullet(p, 'Capacitaci\u00F3n del personal a cargo.', y);
    y = bullet(p, 'Soporte t\u00E9cnico por WhatsApp en horario laboral.', y);
    y = bullet(p, 'Exportaci\u00F3n de reportes (Excel y PDF).', y);
    y = bullet(p, 'Control de renovaci\u00F3n y recordatorio de pagos.', y);
    y += 12;

    y = title(p, '5. Inversi\u00F3n', y);
    y += 2;
    draw(p, 'Licencias de pago \u00FAnico (sin mensualidad). Montos en Pesos Dominicanos (RD$).', { x: 57, y, size: 10.5, c: INK });
    y += 18;

    const cols = [57, 210, 430];
    const tw = W - 114;
    box(p, 57, y, tw, 22, NAVY);
    draw(p, 'Producto', { x: cols[0] + 8, y: y + 14, size: 9.5, f: bold, c: WHITE });
    draw(p, 'Detalle', { x: cols[1] + 8, y: y + 14, size: 9.5, f: bold, c: WHITE });
    draw(p, 'Tarifa', { x: cols[2] + 8, y: y + 14, size: 9.5, f: bold, c: WHITE });
    y += 22;

    const rows = [
      ['KARDEX Pyme', '1 equipo, base de datos local', money(2500), false],
      ['KARDEX Red', 'Red local (servidor + puestos)', money(5000), false],
      ['NEXALERT', 'Reportes autom\u00E1ticos por WhatsApp', money(2500), false],
      ['COMBO: KARDEX Pyme + NEXALERT', 'Ahorro RD$ 1,500', money(3500), true],
      ['COMBO: KARDEX Red + NEXALERT', 'Ahorro RD$ 1,500', money(6000), true],
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const bg = r[3] ? rgb(1, 0.97, 0.9) : (i % 2 ? BAND : WHITE);
      box(p, 57, y, tw, 22, bg);
      if (r[3]) box(p, 57, y, 3, 22, GOLD);
      draw(p, r[0], { x: cols[0] + 8, y: y + 14, size: 9.5, f: bold, c: r[3] ? GOLD : NAVY });
      draw(p, r[1], { x: cols[1] + 8, y: y + 14, size: 9, c: INK });
      draw(p, r[2], { x: cols[2] + 8, y: y + 14, size: 9.5, f: bold, c: r[3] ? RED : BLUE });
      y += 22;
    }
    y += 8;
    draw(p, 'Instalaci\u00F3n', { x: 57, y, size: 11, f: bold, c: GOLD });
    y += 5;
    box(p, 57, y, tw, 24, rgb(1, 0.97, 0.9));
    box(p, 57, y, 3, 24, GOLD);
    draw(p, 'Instalaci\u00F3n y configuraci\u00F3n de ambos programas', { x: 65, y: y + 15, size: 9.5, f: bold, c: NAVY });
    draw(p, 'base:', { x: 385, y: y + 15, size: 9, c: GOLD });
    draw(p, money(4000), { x: 438, y: y + 15, size: 11, f: bold, c: RED });
    y += 24;
    y = para(p, 'La instalaci\u00F3n se cobra aparte (base ' + money(4000) + ' por ambos programas) y sube seg\u00FAn la cantidad de PC. La licencia de cada programa es un solo pago, sin mensualidad. Incluye los primeros 15 d\u00EDas de prueba sin compromiso.', y, 9.5, W - 114, 13.5);
    y += 14;

    y = title(p, '6. Implementaci\u00F3n', y);
    y += 2;
    y = bullet(p, 'D\u00EDa 1: Firma del acuerdo e instalaci\u00F3n del sistema.', y);
    y = bullet(p, 'D\u00EDa 2-4: Carga de empleados y configuraci\u00F3n.', y);
    y = bullet(p, 'Semana 1: Capacitaci\u00F3n del personal.', y);
    y = bullet(p, 'En adelante: Soporte continuo y control de pagos.', y);
    y += 10;

    y = title(p, '7. Soporte y garant\u00EDa', y);
    y += 2;
    y = para(p, 'Incluimos soporte por WhatsApp en horario laboral y un per\u00EDodo de prueba de 15 d\u00EDas. Si el servicio no te convence dentro de la prueba, se retira sin costo alguno.', y);
    y += 14;

    y = title(p, '8. T\u00E9rminos de la propuesta', y);
    y += 2;
    y = bullet(p, 'Esta propuesta tiene una validez de 15 d\u00EDas.', y);
    y = bullet(p, 'Los precios incluyen impuestos de ley, salvo que se indique lo contrario.', y);
    y = bullet(p, 'La contrataci\u00F3n se formaliza con la firma del contrato de servicios adjunto.', y);

    draw(p, 'Nexus Software RD \u00B7 Propuesta [NEXUS-00X] \u00B7 P\u00E1gina 3', { x: 210, y: 800, size: 8.6, c: GRAY });
  }

  // ============================================================ PAGINA 4: FIRMAS
  {
    const p = pdf.addPage([W, H]);
    box(p, 0, 0, W, H, WHITE);
    draw(p, 'Firma del acuerdo', { x: (W - bold.widthOfTextAtSize('Firma del acuerdo', 24)) / 2, y: 120, size: 24, f: bold, c: NAVY });
    draw(p, 'Completa y firma para formalizar la contrataci\u00F3n del servicio.', { x: (W - font.widthOfTextAtSize('Completa y firma para formalizar la contrataci\u00F3n del servicio.', 11)) / 2, y: 148, size: 11, c: GRAY });
    box(p, (W - 90) / 2, 162, 90, 2, ACCENT);

    const block = (bx, heading, lines) => {
      draw(p, heading, { x: bx, y: 300, size: 13, f: bold, c: NAVY });
      box(p, bx, 310, 60, 3, ACCENT);
      let ly = 336;
      for (const l of lines) {
        draw(p, l, { x: bx, y: ly, size: 10.5, c: INK });
        box(p, bx, ly + 5, 220, 1, rgb(0.85, 0.88, 0.92));
        ly += 32;
      }
      box(p, bx, ly + 4, 220, 1, rgb(0.5, 0.55, 0.62));
      draw(p, 'Firma', { x: bx, y: ly + 12, size: 9.5, c: GRAY });
    };

    block(70, 'Nexus Software RD', ['[Nombre] \u00B7 [Cargo]', 'Tel: [Tel\u00E9fono] \u00B7 [WhatsApp]']);
    block(310, 'El cliente', ['[Nombre] \u00B7 [Cargo]', 'Empresa: [Nombre de la empresa]']);

    const notaLines = wrap('La licencia de cada programa es un solo pago, sin mensualidad. La instalaci\u00F3n se cobra aparte y sube seg\u00FAn la cantidad de PC donde se instalen.', 9.5, font, W - 190);
    let ny = 620;
    for (const l of notaLines) { draw(p, l, { x: 90, y: ny, size: 9.5, c: GRAY }); ny += 13; }

    draw(p, 'Nexus Software RD \u00B7 Propuesta [NEXUS-00X] \u00B7 P\u00E1gina 4', { x: 210, y: 800, size: 8.6, c: GRAY });
  }

  const bytes = await pdf.save();
  fs.writeFileSync(OUT, bytes);
  console.log('PDF OK: ' + OUT + ' (' + bytes.length + ' bytes)');
}

main().catch((e) => { console.error('PDF FAIL: ' + e.message); process.exit(1); });
