const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('./canvas');
const { pdfToImages, cropImageFile } = require('./pdf');
const { recognizeDetailed } = require('./ocr');
const { decodeFromImage, normalizeCedulaNumber } = require('./barcode');
const { parseCedula, hasMrz, fieldIssues, looksLikeLabel } = require('./parse-cedula');
const { reconcileFront } = require('./region');

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
  const known = t.match(/UNION\s*LIBRE|UNION\s*CONSENSUAL|SOLTERO|CASADO|DIVORCIADO|VIUDO/);
  if (known) return known[0].replace(/\s*\(?A\)?\s*$/i, '').trim();
  return '';
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

// ¿Requiere el campo un re-OCR por región? Solo campos vacíos o claramente
// corruptos; nunca los que ya traen un valor coherente.
function needsRegion(key, value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (looksLikeLabel(v) && !(key === 'nacionalidad' && v.toUpperCase() === 'DOMINICANA')) return true;
  if (key === 'sexo') return !/^[FMO]$/.test(v);
  if (key === 'fecha_nacimiento' || key === 'fecha_vencimiento') {
    const m = v.match(/^\d{2}\/\d{2}\/\d{4}$/);
    if (!m) return true;
    const dd = +v.slice(0, 2), mm = +v.slice(3, 5), yyyy = +v.slice(6);
    return mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900;
  }
  if (key === 'cedula') return !/^\d{3}-\d{7}-\d$/.test(v);
  if (key === 'nacionalidad') return v.toUpperCase() !== 'DOMINICANA';
  if (key === 'nombres' || key === 'apellidos') return /^\d/.test(v) || v.length < 4;
  return v.length < 1;
}

// Política "no causar daño": un valor de región solo reemplaza si es estricta-
// mente mejor (enum conocido, fecha plausible, o corregir vacío/basura).
function acceptRegionValue(key, oldValue, newValue) {
  if (!newValue) return false;
  const nv = String(newValue).trim();
  const ov = String(oldValue || '').trim();
  if (key === 'estado_civil') {
    return /UNION\s*LIBRE|UNION\s*CONSENSUAL|SOLTERO|CASADO|DIVORCIADO|VIUDO/i.test(nv);
  }
  if (key === 'sexo') return /^[FMO]$/i.test(nv);
  if (key === 'fecha_vencimiento' || key === 'fecha_nacimiento') {
    const m = nv.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return false;
    const yyyy = +m[3];
    if (key === 'fecha_vencimiento' && yyyy < new Date().getFullYear()) return false;
    if (key === 'fecha_nacimiento' && (yyyy < 1900 || yyyy >= new Date().getFullYear() - 14)) return false;
    return true;
  }
  if (key === 'cedula') return /^\d{3}-\d{7}-\d$/.test(nv) && nv !== ov;
  // Nacionalidad: solo valores conocidos plausibles.
  if (key === 'nacionalidad') {
    if (!/^(DOMINICANA|DOMINICANO|HAITIANA?|VENEZOLANA?|COLOMBIANA?|ESTADOUNIDENSE|ESPANIOLA?|ITALIANA?|CANADIENSE)$/i.test(nv)) return false;
    return nv.toUpperCase() !== ov.toUpperCase();
  }
  // Campos alfabéticos (nombres, apellidos, lugar, profesión):
  // un valor existente razonable no se toca; el nuevo debe ser plausible.
  const oldGood = ov.length >= 4 && !/\d/.test(ov) && !looksLikeLabel(ov);
  if (oldGood) return false;
  if (nv.length < 3 || /\d/.test(nv) || looksLikeLabel(nv)) return false;
  return true;
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
    // Reconocer frente y reverso EN PARALELO (pool de workers en ocr.js).
    ocrResults = await Promise.all(pages.map((page) => recognizeDetailed(page.buffer)));
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
      // Segunda pasada SOLO en el frente (los campos que faltan viven ahí) y a
      // factor moderado: la precisión extra la hace el OCR por regiones.
      const f2 = await recognizeDetailed(await upscale(front.buffer, 1.5));
      const fields2 = parseCedula(f2, { text: '', words: [] });
      for (const k of missing) {
        if (fields2[k] && !fields[k]) fields[k] = fields2[k];
      }
    } catch (e) { /* noop */ }
  }

  // OCR por regiones: relee los campos rotos recortando el área de su etiqueta
  // con whitelist de caracteres. Solo corrige; nunca empeora un valor bueno.
  const issues = fieldIssues(fields);
  const regionNeeds = Object.keys(issues).filter((k) => needsRegion(k, fields[k]));
  if (regionNeeds.length && front && !ocrFailed) {
    try {
      const fixed = await reconcileFront({
        ...front,
        words: (ocrFront && ocrFront.words) || []
      }, regionNeeds);
      for (const k of Object.keys(fixed)) {
        if (acceptRegionValue(k, fields[k], fixed[k])) fields[k] = fixed[k];
      }
    } catch (e) {
      console.error('[KARDEX] Error en ocr por regiones:', e.message || e);
    }
  }

  if ((!fields.estado_civil || !fields.sexo) && front && !ocrFailed) {
    try {
      const right = await ocrRightColumn(front.buffer, 1400);
      const val = extractEstadoCivil(right.text);
      if (val && !fields.estado_civil) fields.estado_civil = val;
      if (!fields.sexo) {
        const m = right.text.match(/SEXO\s*[:.]?\s*([FMO])/i);
        if (m) fields.sexo = m[1].toUpperCase();
      }
    } catch (e) { /* noop */ }
  }

  // Sanitización final: nunca dejar basura de etiqueta en campos alfabéticos,
  // valores de estado civil/sexo no válidos, ni fechas de vencimiento pasadas.
  for (const k of ['nombres', 'apellidos', 'lugar_nacimiento', 'profesion']) {
    if (fields[k] && looksLikeLabel(fields[k])) fields[k] = '';
  }
  if (fields.nacionalidad && fields.nacionalidad.toUpperCase() !== 'DOMINICANA' && looksLikeLabel(fields.nacionalidad)) {
    fields.nacionalidad = '';
  }
  if (fields.estado_civil) {
    const ec = stripAccents(String(fields.estado_civil)).toUpperCase().trim().replace(/\s+/g, ' ');
    if (!/^(UNION LIBRE|UNION CONSENSUAL|SOLTERO|CASADO|DIVORCIADO|VIUDO)$/.test(ec)) fields.estado_civil = '';
  }
  if (fields.sexo && !/^[FMO]$/.test(stripAccents(fields.sexo).toUpperCase())) fields.sexo = '';
  if (fields.fecha_vencimiento) {
    const m = fields.fecha_vencimiento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m || +m[3] < new Date().getFullYear()) fields.fecha_vencimiento = '';
  }
  // Validadores duros: un campo que no pasa la estructura no se rellena (mejor
  // vacío que en el campo equivocado).
  const yearNow = new Date().getFullYear();
  if (fields.fecha_nacimiento) {
    const mn = fields.fecha_nacimiento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!mn || +mn[2] < 1 || +mn[2] > 12 || +mn[1] < 1 || +mn[1] > 31 || +mn[3] < 1900 || +mn[3] > yearNow || yearNow - +mn[3] < 14) {
      fields.fecha_nacimiento = '';
    }
  }
  for (const k of ['nombres', 'apellidos', 'lugar_nacimiento', 'profesion']) {
    if (fields[k] && /\d/.test(fields[k])) fields[k] = '';
  }
  if (fields.nombres && fields.apellidos &&
    fields.nombres.length > 3 && fields.nombres === fields.apellidos) {
    fields.nombres = '';
    fields.apellidos = '';
  }

  let barcode = null;
  try {
    barcode = await decodeFirstBarcode(pages);
  } catch (e) {
    console.error('[KARDEX] Error decodificando barcode:', e.message);
  }

  const warnings = [];
  const barcodeDigits = barcode ? String(barcode).replace(/\D/g, '') : '';
  if (barcodeDigits.length === 11) {
    const bc = normalizeCedulaNumber(barcode);
    if (fields.cedula && fields.cedula !== bc) warnings.push('cedula_ocr_vs_barcode');
    fields.cedula = bc;
  }

  return {
    fileName: path.basename(filePath),
    front: front.dataUrl,
    back: back ? back.dataUrl : null,
    barcode,
    warnings,
    fields,
    ocrText: ocrFailed
      ? '(OCR no disponible — verifique tessdata o reinicie la app)'
      : `${ocrFront.text || '(sin texto reconocido en el frente)'}${ocrBack.text ? `\n---REVERSO---\n${ocrBack.text}` : ''}`
  };
}

module.exports = { processFile, emptyFields, detectFrontIndex };