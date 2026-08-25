const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('./canvas');
const { pdfToImages, cropImageFile } = require('./pdf');
const { recognizeDetailed } = require('./ocr');
const { decodeFromImage, normalizeCedulaNumber } = require('./barcode');
const { parseCedula, hasMrz } = require('./parse-cedula');

const SECOND_CHANCE_FIELDS = ['nombres', 'apellidos', 'lugar_nacimiento', 'profesion'];

function isPdf(filePath) {
  return /\.pdf$/i.test(filePath);
}

function isImage(filePath) {
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(filePath);
}

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function emptyFields() {
  return {
    cedula: '', nombres: '', apellidos: '', sexo: '',
    fecha_nacimiento: '', nacionalidad: '', lugar_nacimiento: '', estado_civil: '',
    profesion: '',
    fecha_vencimiento: ''
  };
}

function detectFrontIndex(details) {
  const FRONT = [
    'CEDULA DE IDENTIDAD Y ELECTORAL',
    'NUMERO DE CEDULA', 'NÚMERO DE CÉDULA',
    'SEXO'
  ];
  const BACK = [
    'NOMBRE DEL PADRE', 'NOMBRE DE LA MADRE',
    'CEDULA ANTERIOR', 'DIRECCION DE RESIDENCIA', 'REGISTRO DE NACIMIENTO',
    'MUNICIPIO', 'RECINTO', 'COLEGIO'
  ];
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < details.length; i++) {
    const t = stripAccents(details[i].text || '').toUpperCase();
    let score = 0;
    for (const m of FRONT) if (t.includes(m)) score += 3;
    for (const m of BACK) if (t.includes(m)) score -= 3;
    if (/\d{3}\s*[-.\s]?\s*\d{7}\s*[-.\s]?\s*\d/.test(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best === -1 || bestScore === 0) {
    const mrzi = details.findIndex((d) => hasMrz(d.text));
    return mrzi === -1 ? 0 : mrzi;
  }
  return best;
}

async function upscale(buffer, factor) {
  const img = await loadImage(buffer);
  const c = createCanvas(Math.round(img.width * factor), Math.round(img.height * factor));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toBuffer('image/png');
}

async function ocrRightColumn(buffer, targetWidth) {
  const img = await loadImage(buffer);
  const x0 = Math.round(img.width * 0.5);
  const w = img.width - x0;
  const h = img.height;
  const scale = Math.max(1, targetWidth / w);
  const c = createCanvas(Math.round(w * scale), Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, 0, w, h, 0, 0, c.width, c.height);
  return recognizeDetailed(c.toBuffer('image/png'));
}

function extractEstadoCivil(text) {
  const t = stripAccents(String(text || '')).toUpperCase();
  let val = '';
  let m = t.match(/ESTADO\s*CIVIL\s*:?\s*([A-Z]{3,}(?:\s+[A-Z]{3,})?)/);
  if (m) val = m[1];
  if (!val || /INICANA|DOMINICANA|NACIONALIDAD|SEXO/.test(val)) {
    const known = t.match(/UNION\s*LIBRE|UNION\s*CONSENSUAL|SOLTERO|CASADO|DIVORCIADO|VIUDO/);
    if (known) val = known[0];
  }
  return val.replace(/\s*\(?A\)?\s*$/i, '').trim();
}

async function decodeFirstBarcode(pages) {
  for (const page of pages) {
    try {
      const raw = await decodeFromImage(page.buffer);
      if (raw && raw.trim()) return raw.trim();
    } catch (e) { /* noop */ }
  }
  return null;
}

async function processFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('El archivo no existe');
  if (!isPdf(filePath) && !isImage(filePath)) {
    throw new Error('Solo se admiten archivos PDF, PNG o JPG');
  }

  const buf = fs.readFileSync(filePath);

  let pages = [];
  if (isPdf(filePath)) {
    try {
      pages = await pdfToImages(buf);
    } catch (e) {
      console.error('[KARDEX] Error renderizando PDF:', e.message);
      throw new Error('No se pudo renderizar el PDF. Verifique que el archivo no este corrupto.');
    }
    if (pages.length === 0) throw new Error('No se pudo leer ninguna página del PDF');
  } else {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const img = await cropImageFile(buf, mime);
    pages.push({ width: img.width, height: img.height, buffer: img.buffer, dataUrl: img.dataUrl });
  }

  pages.forEach((p, i) => console.log(`[KARDEX] Página ${i + 1} después del recorte: ${p.width}x${p.height}`));

  let ocrResults = [];
  let ocrFailed = false;
  try {
    for (const page of pages) ocrResults.push(await recognizeDetailed(page.buffer));
  } catch (e) {
    console.error('[KARDEX] Error en OCR:', e.message);
    ocrFailed = true;
    ocrResults = pages.map(() => ({ text: '', words: [] }));
  }

  const frontIdx = detectFrontIndex(ocrResults);
  const front = pages[frontIdx];
  const ocrFront = ocrResults[frontIdx] || { text: '', words: [] };
  let back = null;
  let ocrBack = { text: '', words: [] };
  if (pages.length > 1) {
    const backIdx = frontIdx === 0 ? 1 : 0;
    back = pages[backIdx];
    ocrBack = ocrResults[backIdx] || { text: '', words: [] };
  }

  let fields = {};
  try {
    fields = parseCedula(ocrFront, ocrBack);
  } catch (e) {
    console.error('[KARDEX] Error parseando cédula:', e.message);
    fields = emptyFields();
  }

  const missing = SECOND_CHANCE_FIELDS.filter((k) => !fields[k]);
  if (missing.length && front && !ocrFailed) {
    try {
      const f2 = await recognizeDetailed(await upscale(front.buffer, 2));
      const b2 = back ? await recognizeDetailed(await upscale(back.buffer, 2)) : { text: '', words: [] };
      const fields2 = parseCedula(f2, b2);
      for (const k of missing) {
        if (fields2[k] && !fields[k]) fields[k] = fields2[k];
      }
    } catch (e) { /* noop */ }
  }

  if (!fields.estado_civil && front && !ocrFailed) {
    try {
      const right = await ocrRightColumn(front.buffer, 1400);
      const val = extractEstadoCivil(right.text);
      if (val && !fields.estado_civil) fields.estado_civil = val;
    } catch (e) { /* noop */ }
  }

  let barcode = null;
  try {
    barcode = await decodeFirstBarcode(pages);
  } catch (e) {
    console.error('[KARDEX] Error decodificando barcode:', e.message);
  }

  if (barcode && /^\d{11}$/.test(barcode.replace(/\D/g, ''))) {
    fields.cedula = normalizeCedulaNumber(barcode);
  }

  return {
    fileName: path.basename(filePath),
    front: front.dataUrl,
    back: back ? back.dataUrl : null,
    barcode,
    fields,
    ocrText: ocrFailed
      ? '(OCR no disponible — verifique tessdata o reinicie la app)'
      : `${ocrFront.text || '(sin texto reconocido en el frente)'}${ocrBack.text ? `\n---REVERSO---\n${ocrBack.text}` : ''}`
  };
}

module.exports = { processFile, emptyFields, detectFrontIndex };
