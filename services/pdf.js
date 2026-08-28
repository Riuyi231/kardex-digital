const pdfjsLib = require('pdfjs-dist');
const path = require('path');
const { createCanvas } = require('./canvas');

function NodeCanvasFactory() {
  return {
    create(width, height) {
      if (width <= 0 || height <= 0) throw new Error('Dimensiones de página inválidas');
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
  };
}

function makeDocumentOptions(buffer) {
  const opts = {
    data: new Uint8Array(buffer),
    canvasFactory: new NodeCanvasFactory(),
    standardFontDataUrl: path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
  };
  // En el shim (sin canvas nativo) pdfjs sólo puede pintar texto mediante
  // ctx.fillText()/strokeText() con el glifo bitmap propio. Con el canvas
  // nativo dejamos el render por rutas por defecto (que es el que funciona).
  if (require('./canvas').implementation === 'shim') {
    opts.disableFontFace = false;
  }
  return opts;
}
function pickScale(viewport) {
  const target = 1500;
  const base = Math.max(2.2, target / viewport.width);
  return Math.min(5, base);
}

function toDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function estimateBackgroundThreshold(data, width, height) {
  const hist = new Uint32Array(256);
  const step = 10;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (Math.floor(y) * Math.floor(width) + Math.floor(x)) * 4;
      hist[data[i]]++;
    }
  }
  let bestV = 255, bestC = -1;
  for (let v = 255; v >= 150; v--) {
    if (hist[v] > bestC) { bestC = hist[v]; bestV = v; }
  }
  return Math.max(180, bestV - 25);
}

function cropCanvas(canvas, width, height) {
  const ctx = canvas.getContext('2d');
  const W = Math.floor(width);
  const H = Math.floor(height);
  if (W <= 0 || H <= 0) return { canvas, width, height };
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const threshold = estimateBackgroundThreshold(data, W, H);

  const step = 2;
  const cell = Math.max(8, Math.floor(Math.min(W, H) / 50));
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const cellDark = new Float64Array(gw * gh);
  const cellCount = new Float64Array(gw * gh);
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const dark = (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) ? 1 : 0;
      const ci = Math.floor(y / cell) * gw + Math.floor(x / cell);
      cellDark[ci] += dark;
      cellCount[ci]++;
    }
  }

  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    if (cellCount[i] > 0 && cellDark[i] / cellCount[i] >= 0.02) mask[i] = 1;
  }

  const rowD = new Float64Array(gh);
  const colD = new Float64Array(gw);
  for (let r = 0; r < gh; r++) {
    let n = 0;
    for (let c = 0; c < gw; c++) n += mask[r * gw + c];
    rowD[r] = n / gw;
  }
  for (let c = 0; c < gw; c++) {
    let n = 0;
    for (let r = 0; r < gh; r++) n += mask[r * gw + c];
    colD[c] = n / gh;
  }
  let stripTop = 0;
  while (stripTop < gh && rowD[stripTop] >= 0.9) stripTop++;
  let stripBottom = gh - 1;
  while (stripBottom >= stripTop && rowD[stripBottom] >= 0.9) stripBottom--;
  let stripLeft = 0;
  while (stripLeft < gw && colD[stripLeft] >= 0.9) stripLeft++;
  let stripRight = gw - 1;
  while (stripRight >= stripLeft && colD[stripRight] >= 0.9) stripRight--;
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      if (r < stripTop || r > stripBottom || c < stripLeft || c > stripRight) mask[r * gw + c] = 0;
    }
  }

  const dilate = 2;
  const dmask = new Uint8Array(gw * gh);
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      if (mask[r * gw + c]) {
        for (let dr = -dilate; dr <= dilate; dr++) {
          for (let dc = -dilate; dc <= dilate; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < gh && cc >= 0 && cc < gw) dmask[rr * gw + cc] = 1;
          }
        }
      }
    }
  }

  const label = new Int32Array(gw * gh).fill(-1);
  const stats = [];
  const stack = [];
  for (let i = 0; i < gw * gh; i++) {
    if (!dmask[i] || label[i] !== -1) continue;
    const id = stats.length;
    stats.push({ count: 0, minR: gh, maxR: -1, minC: gw, maxC: -1 });
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      const s = stats[id];
      s.count++;
      const r = Math.floor(p / gw);
      const c = p % gw;
      if (r < s.minR) s.minR = r;
      if (r > s.maxR) s.maxR = r;
      if (c < s.minC) s.minC = c;
      if (c > s.maxC) s.maxC = c;
      if (r > 0 && dmask[p - gw] && label[p - gw] === -1) { label[p - gw] = id; stack.push(p - gw); }
      if (r < gh - 1 && dmask[p + gw] && label[p + gw] === -1) { label[p + gw] = id; stack.push(p + gw); }
      if (c > 0 && dmask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (c < gw - 1 && dmask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
    }
  }

  if (stats.length === 0) return { canvas, width, height };
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const bwCells = s.maxC - s.minC + 1;
    const bhCells = s.maxR - s.minR + 1;
    const score = (s.count * s.count) / (bwCells * bhCells);
    if (score > bestScore) { bestScore = score; best = i; }
  }

  const bs = stats[best];
  const top = bs.minR * cell;
  const bottom = Math.min(H - 1, (bs.maxR + 1) * cell - 1);
  const left = bs.minC * cell;
  const right = Math.min(W - 1, (bs.maxC + 1) * cell - 1);
  const bw = right - left + 1;
  const bh = bottom - top + 1;
  if (bw >= W * 0.97 && bh >= H * 0.97) return { canvas, width, height };
  if (bw < W * 0.03 || bh < H * 0.03) return { canvas, width, height };

  const pad = 14;
  const sx = Math.max(0, left - pad);
  const sy = Math.max(0, top - pad);
  const sw = Math.min(W - sx, bw + pad * 2);
  const sh = Math.min(H - sy, bh + pad * 2);
  const cropCanvas = createCanvas(sw, sh);
  const cctx = cropCanvas.getContext('2d');
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, sw, sh);
  cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return { canvas: cropCanvas, width: sw, height: sh };
}

async function renderPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = pickScale(viewport1);
  const viewport = page.getViewport({ scale });
  const factory = new NodeCanvasFactory();
  const { canvas } = factory.create(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, canvasFactory: factory }).promise;
  const cropped = cropCanvas(canvas, viewport.width, viewport.height);
  const finalCanvas = cropped.canvas;
  const finalCtx = finalCanvas.getContext('2d');
  const png = finalCanvas.toBuffer('image/png');
  const imageData = finalCtx.getImageData(0, 0, cropped.width, cropped.height);
  page.cleanup();
  return { width: cropped.width, height: cropped.height, buffer: png, dataUrl: toDataUrl(png), data: imageData.data };
}

async function cropImageFile(buffer, mime) {
  const image = await require('./canvas').loadImage(buffer);
  const w = image.width;
  const h = image.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const cropped = cropCanvas(canvas, w, h);
  const cctx = cropped.canvas.getContext('2d');
  const png = cropped.canvas.toBuffer('image/png');
  return { width: cropped.width, height: cropped.height, buffer: png, dataUrl: toDataUrl(png), data: cctx.getImageData(0, 0, cropped.width, cropped.height).data };
}

function fromImageData(img) {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  ctx.putImageData(imageData, 0, 0);
  const cropped = cropCanvas(canvas, img.width, img.height);
  const png = cropped.canvas.toBuffer('image/png');
  return { width: cropped.width, height: cropped.height, buffer: png, dataUrl: toDataUrl(png) };
}

async function extractEmbeddedImages(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  const results = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === pdfjsLib.OPS.paintImageXObject) {
      const name = ops.argsArray[i][0];
      const img = await page.objs.get(name);
      if (img && img.data && img.width && img.height) {
        results.push(fromImageData(img));
      }
    } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
      const img = ops.argsArray[i][0];
      if (img && img.data && img.width && img.height) {
        results.push(fromImageData(img));
      }
    }
  }
  return results;
}

async function firstEmbedded(doc, pageNumber) {
  const embeds = await extractEmbeddedImages(doc, pageNumber);
  return embeds.length > 0 ? embeds[embeds.length - 1] : null;
}

async function pdfToImages(buffer) {
  const doc = await pdfjsLib.getDocument(makeDocumentOptions(buffer)).promise;
  const pages = [];
  try {
    const count = Math.min(doc.numPages, 2);
    for (let n = 1; n <= count; n++) {
      let img = null;
      try {
        img = await renderPage(doc, n);
      } catch (err) {
        console.warn('[KARDEX] Render directo falló, intentando imágenes embebidas:', err.message);
        try {
          img = await firstEmbedded(doc, n);
        } catch (err2) {
          console.error('[KARDEX] Extracción embebida también falló:', err2.message);
        }
      }
      if (img) pages.push(img);
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

function parseImageDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Imagen de cédula no válida');
  return { type: m[1] === 'png' ? 'png' : 'jpg', bytes: Buffer.from(m[2], 'base64') };
}

// Genera un PDF con el frente y/o reverso de la(s) cédula(s).
// `employees` es un empleado o una lista de empleados con `frente`/`reverso` (data URLs).
async function buildCedulaPdf(employees) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const list = (Array.isArray(employees) ? employees : [employees])
    .filter(e => e && ((e.frente && /^data:/.test(e.frente)) || (e.reverso && /^data:/.test(e.reverso))));
  if (!list.length) throw new Error('No hay cédulas con imágenes guardadas');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 842;
  const pageH = 595;
  const M = 50;
  const gap = 16;
  const availW = pageW - M * 2;
  const availH = pageH - 130;

  for (const emp of list) {
    const name = `${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || `Empleado #${emp.id}`;
    const sides = [];
    for (const [label, dataUrl] of [['Frente', emp.frente], ['Reverso', emp.reverso]]) {
      if (!dataUrl || !/^data:/.test(dataUrl)) continue;
      const { type, bytes } = parseImageDataUrl(dataUrl);
      const img = type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      sides.push({ label, img, iw: img.width, ih: img.height });
    }
    if (!sides.length) continue;
    const totalGap = (sides.length - 1) * gap;
    const scale = Math.min(1, (availW - totalGap) / sides.reduce((a, s) => a + s.iw, 0), availH / Math.max(...sides.map(s => s.ih)));
    let iw = 0;
    for (const s of sides) { s.iw = Math.round(s.iw * scale); s.ih = Math.round(s.ih * scale); iw += s.iw; }
    const maxIh = Math.max(...sides.map(s => s.ih));
    const page = doc.addPage([pageW, pageH]);
    page.drawText(`CÉDULA DE ${name.toUpperCase()}`, { x: M, y: pageH - 42, size: 12, font: bold, color: rgb(0.2, 0.2, 0.35) });
    let x = M + (availW - (iw + totalGap)) / 2;
    for (const s of sides) {
      page.drawText(s.label.toUpperCase(), { x, y: pageH - 60, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
      page.drawImage(s.img, { x, y: 45, width: s.iw, height: s.ih });
      x += s.iw + gap;
    }
    if (emp.cedula) {
      page.drawText(`Cédula: ${emp.cedula}`, { x: M, y: 24, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }
  }
  return Buffer.from(await doc.save());
}

module.exports = { pdfToImages, cropImageFile, NodeCanvasFactory, buildCedulaPdf, buildConstancia, buildCartaSalario, buildExpediente, docxLetterToPdf };

/* ==================== Documentos PDF ==================== */

async function buildLetterDoc() {
  const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold, rgb, PageSizes };
}

const LETTER_COLORS = { dark: [0.13, 0.16, 0.25], muted: [0.35, 0.38, 0.45], line: [0.75, 0.78, 0.84] };
function c(rgb, key) { const v = LETTER_COLORS[key] || LETTER_COLORS.dark; return rgb(v[0], v[1], v[2]); }

function fmtFecha(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtFechaMes(d) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function fmtRD(n) {
  const v = Number(n) || 0;
  const s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `RD$ ${s}`;
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text == null ? '' : text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(page, doc, text, x, y, maxWidth, size, font, color) {
  const lines = wrapText(text, font, size, maxWidth);
  let yy = y;
  for (const ln of lines) { page.drawText(ln, { x, y: yy, size, font, color }); yy -= size + 5; }
  return yy;
}

function embedLogo(doc, dataUrl) {
  if (!dataUrl || !/^data:image\//.test(dataUrl)) return null;
  try {
    const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
    if (!m) return null;
    const bytes = Buffer.from(m[2], 'base64');
    return m[1] === 'png' ? doc.embedPng(bytes) : doc.embedJpg(bytes);
  } catch (e) { return null; }
}

function drawLetterHeader(page, doc, opts, font, bold, rgb, W, M, H, title) {
  const name = opts.company_name || 'KARDEX DIGITAL';
  const parts = [];
  if (opts.company_address) parts.push(opts.company_address);
  if (opts.company_rnc) parts.push('RNC: ' + opts.company_rnc);
  if (opts.company_tel) parts.push('Tel.: ' + opts.company_tel);
  if (opts.company_email) parts.push('Correo: ' + opts.company_email);
  const contactLine = parts.join('   ·   ');
  const logo = embedLogo(doc, opts.logo);
  let x = M;
  const nameY = H - 66;
  if (logo) {
    const lw = 90;
    const lh = Math.min(40, logo.height * (lw / logo.width));
    page.drawImage(logo, { x: M, y: H - 56 - lh, width: lw, height: lh });
    x = M + lw + 14;
  }
  page.drawText(name, { x, y: nameY, size: 18, font: bold, color: c(rgb, 'dark') });
  if (contactLine) page.drawText(contactLine, { x, y: nameY - 16, size: 8.5, font, color: c(rgb, 'muted') });
  page.drawLine({ start: { x: M, y: H - 100 }, end: { x: W - M, y: H - 100 }, thickness: 1.5, color: c(rgb, 'line') });
  page.drawText(title, { x: M, y: H - 132, size: 14, font: bold, color: c(rgb, 'dark') });
  page.drawLine({ start: { x: M, y: H - 142 }, end: { x: M + 170, y: H - 142 }, thickness: 2, color: c(rgb, 'dark') });
  return H - 182;
}

function drawSignature(page, M, y, font, rgb, dark) {
  const sigY = y > 240 ? y - 70 : 150;
  page.drawLine({ start: { x: M, y: sigY }, end: { x: M + 190, y: sigY }, thickness: 1, color: dark });
  page.drawText('Firma y sello', { x: M + 40, y: sigY - 14, size: 10, font, color: c(rgb, 'muted') });
  return sigY;
}

async function buildConstancia(emp, opts = {}) {
  const { doc, font, bold, rgb, PageSizes } = await buildLetterDoc();
  const page = doc.addPage(PageSizes.A4);
  const W = 595, H = 842, M = 56;
  const name = `${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || 'Empleado';
  let y = drawLetterHeader(page, doc, opts, font, bold, rgb, W, M, H, 'CONSTANCIA DE TRABAJO');
  if (opts.recipient) {
    page.drawText('A: ' + opts.recipient, { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
    y -= 22;
  }
  const custom = String(opts.text || '').trim();
  if (custom) {
    const paras = custom.split(/\n{2,}/);
    for (const para of paras) {
      y = drawWrapped(page, doc, para, M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    }
  } else {
    const partes = [];
    partes.push(`Hacemos constar que ${name}${emp.cedula ? ', portador(a) de la cédula de identidad y electoral No. ' + emp.cedula : ''}`);
    if (emp.fecha_ingreso) partes.push(`labora en esta empresa desde el ${emp.fecha_ingreso}`);
    if (emp.puesto) partes.push(`desempeñándose en el puesto de ${emp.puesto}`);
    if (emp.departamento) partes.push(`en el departamento de ${emp.departamento}`);
    const parrafo = partes.join(', ') + '.';
    page.drawText('A quien pueda interesar:', { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
    y -= 24;
    y = drawWrapped(page, doc, parrafo, M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    y = drawWrapped(page, doc, 'Se expide la presente a solicitud de la parte interesada, para los fines que estime conveniente.', M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    page.drawText(`Santo Domingo, República Dominicana, ${fmtFechaMes(new Date())}.`, { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
  }
  drawSignature(page, M, y, font, rgb, c(rgb, 'dark'));
  return Buffer.from(await doc.save());
}

async function buildCartaSalario(emp, opts = {}) {
  const { doc, font, bold, rgb, PageSizes } = await buildLetterDoc();
  const page = doc.addPage(PageSizes.A4);
  const W = 595, H = 842, M = 56;
  const name = `${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || 'Empleado';
  let y = drawLetterHeader(page, doc, opts, font, bold, rgb, W, M, H, 'CERTIFICACIÓN DE SALARIO');
  if (opts.recipient) {
    page.drawText('A: ' + opts.recipient, { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
    y -= 22;
  }
  const custom = String(opts.text || '').trim();
  if (custom) {
    const paras = custom.split(/\n{2,}/);
    for (const para of paras) {
      y = drawWrapped(page, doc, para, M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    }
  } else {
    const salario = fmtRD(emp.salario);
    const periodo = (emp.tipo_salario === 'quincenal' ? 'quincenales' : emp.tipo_salario === 'semanal' ? 'semanales' : 'mensuales');
    page.drawText('A quien pueda interesar:', { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
    y -= 24;
    const parrafo = `Hacemos constar que ${name}${emp.cedula ? ', portador(a) de la cédula de identidad y electoral No. ' + emp.cedula : ''}${emp.fecha_ingreso ? ', labora en esta empresa desde el ' + emp.fecha_ingreso : ''}${emp.puesto ? ', en el puesto de ' + emp.puesto : ''}, devengando un salario de ${salario} ${periodo}.`;
    y = drawWrapped(page, doc, parrafo, M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    y = drawWrapped(page, doc, 'La presente se expide a solicitud de la parte interesada para fines bancarios y otros que estime convenientes.', M, y, W - 2 * M, 11, font, c(rgb, 'dark')) - 18;
    page.drawText(`Santo Domingo, República Dominicana, ${fmtFechaMes(new Date())}.`, { x: M, y: y, size: 11, font, color: c(rgb, 'dark') });
  }
  drawSignature(page, M, y, font, rgb, c(rgb, 'dark'));
  return Buffer.from(await doc.save());
}

async function buildExpediente(emp, vacaciones = [], opts = {}) {
  const { doc, font, bold, rgb, PageSizes } = await buildLetterDoc();
  const W = 595, H = 842, M = 56;
  const name = `${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || 'Empleado';
  let page = doc.addPage(PageSizes.A4);
  let y = H - 56;

  function ensure(needed) {
    if (y - needed < 56) {
      page = doc.addPage(PageSizes.A4);
      y = H - 56;
      return true;
    }
    return false;
  }
  function title(txt) {
    ensure(60);
    page.drawText(txt, { x: M, y: y, size: 13, font: bold, color: c(rgb, 'dark') });
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 1, color: c(rgb, 'line') });
    y -= 28;
  }
  function kv(label, value) {
    if (value == null || value === '') return;
    ensure(34);
    page.drawText(label + ':', { x: M, y: y, size: 10, font: bold, color: c(rgb, 'muted') });
    y = drawWrapped(page, doc, String(value), M + 180, y, W - M - (M + 180) - 8, 10, font, c(rgb, 'dark'));
    y -= 12;
  }

  const company = opts.company_name || 'KARDEX DIGITAL';
  const logo = embedLogo(doc, opts.logo);
  let hx = M;
  if (logo) {
    const lw = 70;
    const lh = Math.min(32, logo.height * (lw / logo.width));
    page.drawImage(logo, { x: M, y: H - 40 - lh, width: lw, height: lh });
    hx = M + lw + 10;
  }
  page.drawText(company, { x: hx, y: H - 52, size: 14, font: bold, color: c(rgb, 'dark') });
  const hparts = [];
  if (opts.company_rnc) hparts.push('RNC: ' + opts.company_rnc);
  if (opts.company_tel) hparts.push('Tel.: ' + opts.company_tel);
  if (opts.company_email) hparts.push(opts.company_email);
  if (hparts.length) page.drawText(hparts.join('  ·  '), { x: hx, y: H - 66, size: 8, font, color: c(rgb, 'muted') });
  page.drawLine({ start: { x: M, y: H - 74 }, end: { x: W - M, y: H - 74 }, thickness: 1, color: c(rgb, 'line') });

  page.drawText('EXPEDIENTE DE EMPLEADO', { x: M, y: H - 100, size: 17, font: bold, color: c(rgb, 'dark') });
  page.drawText(`${name}${emp.cedula ? ' · Cédula ' + emp.cedula : ''}`, { x: M, y: H - 122, size: 12, font, color: c(rgb, 'muted') });
  y = H - 156;

  title('Identificación');
  kv('Cédula', emp.cedula);
  kv('Nombres', emp.nombres);
  kv('Apellidos', emp.apellidos);
  kv('Sexo', emp.sexo);
  kv('Fecha de nacimiento', emp.fecha_nacimiento);
  kv('Nacionalidad', emp.nacionalidad);
  kv('Estado civil', emp.estado_civil);
  kv('Profesión', emp.profesion);

  title('Datos laborales');
  kv('Puesto', emp.puesto);
  kv('Departamento', emp.departamento);
  kv('Sucursal', emp.sucursal);
  kv('Fecha de ingreso', emp.fecha_ingreso);
  kv('Tipo de salario', emp.tipo_salario);
  kv('Salario', fmtRD(emp.salario));
  kv('Tipo de contrato', emp.tipo_contrato);
  kv('NSS', emp.nss);
  kv('ARS', emp.ars);
  kv('AFP', emp.afp);
  kv('Banco', emp.banco);
  kv('Cuenta', emp.cuenta);

  title('Contacto');
  kv('Correo electrónico', emp.email);
  kv('Teléfono', emp.telefono);
  kv('Número de flota', emp.flota);

  title('Cédula de identidad');
  kv('Fecha de vencimiento', emp.fecha_vencimiento);

  if (vacaciones && vacaciones.length) {
    title('Permisos y vacaciones');
    for (const v of vacaciones) {
      ensure(40);
      const tipo = String(v.tipo || '').replace(/_/g, ' ');
      const rango = `${v.fecha_inicio || ''}${v.fecha_fin ? ' al ' + v.fecha_fin : ''}`;
      let moda = '';
      if (v.modalidad === 'pagadas') moda = ' · Pagadas';
      else if (v.modalidad === 'pagadas_parcial') moda = ` · Pagadas ${Number(v.dias_pagados) || 0} día(s) y guardadas ${Number(v.dias_guardados) || 0}`;
      page.drawText(`${tipo}: ${rango}${Number(v.dias) ? ' (' + v.dias + ' día(s))' : ''}${moda}`, { x: M, y: y, size: 10, font, color: c(rgb, 'dark') });
      y -= 16;
      if (v.motivo) { y = drawWrapped(page, doc, 'Motivo: ' + v.motivo, M + 14, y, W - M - (M + 14) - 8, 9, font, c(rgb, 'muted')) - 12; }
    }
  }

  if (emp.nota) {
    title('Observaciones');
    y = drawWrapped(page, doc, String(emp.nota), M, y, W - 2 * M, 10, font, c(rgb, 'dark'));
  }

  ensure(30);
  page.drawText(`Generado el ${fmtFecha(new Date())} por KARDEX Digital.`, { x: M, y: y, size: 9, font, color: c(rgb, 'muted') });
  return Buffer.from(await doc.save());
}

/* ============ DOCX → PDF nativo (mismo modelo Word) ============ */

const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Parsea word/document.xml y devuelve párrafos con runs y alineación.
function parseDocxParagraphs(docxBuffer) {
  const PizZip = require('pizzip');
  const zip = new PizZip(docxBuffer);
  const xml = zip.file('word/document.xml').asText();
  const paragraphs = [];
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/g;
  const pieceRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g;
  let pm;
  while ((pm = paraRe.exec(xml))) {
    const p = pm[0];
    const jc = (p.match(/<w:jc w:val="([^"]+)"/) || [])[1] || 'left';
    const runs = [];
    let rm;
    while ((rm = runRe.exec(p))) {
      const rp = rm[0];
      const rPr = (rp.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [])[0] || '';
      const bold = /<w:b(?:\s[^>]*)?\/>/.test(rPr) && !/<w:b w:val="false"[^>]*\/>/.test(rPr);
      const italic = /<w:i(?:\s[^>]*)?\/>/.test(rPr) && !/<w:i w:val="false"[^>]*\/>/.test(rPr);
      const uVal = (rPr.match(/<w:u w:val="([^"]+)"/) || [])[1] || '';
      const underline = !!uVal && uVal !== 'none';
      const size = Number((rPr.match(/<w:sz w:val="([^"]+)"/) || [])[1] || 24) / 2;
      let text = '';
      let piece;
      while ((piece = pieceRe.exec(rp))) {
        if (piece[0].startsWith('<w:br') || piece[0].startsWith('<w:cr')) text += '\n';
        else text += unescapeXml(piece[1]);
      }
      if (text) runs.push({ text, bold, italic, underline, size });
    }
    paragraphs.push({ jc, runs });
  }
  return paragraphs;
}

// Convierte un DOCX rellenado a PDF con el mismo contenido y estructura del modelo Word.
async function docxLetterToPdf(docxBuffer) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const paragraphs = parseDocxParagraphs(docxBuffer);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 612, PAGE_H = 792, M = 72;
  const maxW = PAGE_W - 2 * M;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 72;
  const dark = rgb(0.13, 0.16, 0.25);

  function newPageIfNeeded(needed) {
    if (y - needed < 56) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 72;
    }
  }

  // Convierte los runs de un párrafo en "líneas visuales" (con ajuste de palabras).
  // Los runs de Word se parten en mitad de palabra ("L"+"a", "13"+"/"+"0"+"4"); se unen a
  // nivel de caracteres y solo se corta en espacios reales para no separar sílabas.
  function buildLines(runs) {
    const words = [];
    let pending = null;
    const flush = () => { if (pending && pending.text) words.push(pending); pending = null; };
    for (const r of runs) {
      const size = r.size || 12;
      for (const ch of String(r.text || '')) {
        if (ch === '\n') { flush(); words.push({ br: true }); continue; }
        if (ch === ' ' || ch === '\t' || ch === '\u00A0') { flush(); continue; }
        if (!pending) pending = { text: '', bold: !!r.bold, size, width: 0 };
        pending.text += ch;
      }
    }
    flush();
    for (const w of words) {
      if (!w.br) {
        const f = w.bold ? bold : font;
        w.width = f.widthOfTextAtSize(w.text, w.size);
      }
    }
    const lines = [];
    let cur = [];
    let curW = 0;
    for (const w of words) {
      if (w.br) { if (cur.length) lines.push(cur); cur = []; curW = 0; continue; }
      const spaceW = font.widthOfTextAtSize(' ', w.size);
      if (cur.length && curW + spaceW + w.width > maxW) { lines.push(cur); cur = [w]; curW = w.width; }
      else { cur.push(w); curW += (cur.length > 1 ? spaceW : 0) + w.width; }
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  function drawLine(line, jc, isLastOfPara) {
    const lineW = line.reduce((acc, w) => acc + w.width, 0) + Math.max(0, line.length - 1) * font.widthOfTextAtSize(' ', line[0].size);
    let x = M;
    if (jc === 'right') x = PAGE_W - M - lineW;
    else if (jc === 'center') x = M + (maxW - lineW) / 2;
    const justify = jc === 'both' && !isLastOfPara && line.length > 1;
    let extra = 0;
    if (justify) extra = (maxW - lineW) / (line.length - 1);
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const f = w.bold ? bold : font;
      page.drawText(w.text, { x, y, size: w.size, font: f, color: dark });
      const gap = font.widthOfTextAtSize(' ', w.size) + (justify && i < line.length - 1 ? extra : 0);
      x += w.width + gap;
    }
  }

  let started = false;
  for (const para of paragraphs) {
    const size = para.runs.length ? para.runs[0].size : 12;
    const lineH = size * 1.5;
    if (!para.runs.length) {
      if (started) { y -= lineH * 0.7; } // línea en blanco interior
      continue;
    }
    const lines = buildLines(para.runs);
    for (let li = 0; li < lines.length; li++) {
      newPageIfNeeded(lineH);
      drawLine(lines[li], para.jc, li === lines.length - 1);
      y -= lineH;
    }
    y -= size * 0.4;
    started = true;
  }
  return Buffer.from(await doc.save());
}
