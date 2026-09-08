// OCR por regiones del FRENTE de la cédula, dirigido por las etiquetas que ya
// reconoció la pasada global (words). En la cédula dominicana nueva el frente
// tiene 2 columnas (izquierda: cédula/nombre/apellido/nacionalidad/nacimiento;
// derecha: estado civil/sexo/ocupación/vigencia). Otras regiones necesitan
// reconocimiento de PDF que aquí se recalcula sobre el área de cada etiqueta.
// El whitelist de caracteres por tipo elimina sustituciones típicas de OCR.
const { createCanvas, loadImage } = require('./canvas');
const { recognizeDetailed } = require('./ocr');
const { preprocess } = require('./preprocess');
const {
  linesFromWords, bestLabelMatch, normLabel, cleanAlphaValue,
  extractDateText, findCedula, looksLikeLabel
} = require('./parse-cedula');

const DEBUG = !!process.env.KARDEX_DEBUG_REGION;

const RHS_KEYS = new Set(['estado_civil', 'sexo', 'profesion', 'fecha_vencimiento']);

const WHITELISTS = {
  dates: '0123456789/-. ',
  sexo: 'FMO',
  cedula: '0123456789-. ',
  estado_civil: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜ -',
  alpha: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜ .-()\''
};

// Palabras de etiqueta que, aparecidas en un valor, indican recorte con basura.
const VALUE_VETO = new Set([
  'APELIDO', 'APELLIDO', 'NOMBRE', 'NOMBRES', 'NACIONALIDAD', 'NACIONALID',
  'OCUPACION', 'OCUPACIÓN', 'PROFESION', 'PROFESIÓN', 'OFICIO', 'SEXO',
  'VIGENCIA', 'HASTA', 'FECHA', 'NACIMIENTO', 'VENCIMIENTO', 'LUGAR',
  'NACIM', 'CIVIL', 'ESTADO', 'CEDULA', 'CÉDULA', 'CÓDULA', 'IDENTIDAD',
  'ELECTORAL', 'REPUBLICA', 'REGISTRO', 'ANTERIOR', 'DOMINICANA', 'MUNICIPIO'
]);

function isLabelEcho(text) {
  const up = normLabel(String(text || ''));
  if (!up) return false;
  const tokens = up.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length <= 3 && tokens.every((w) => VALUE_VETO.has(w))) return true;
  return false;
}

function medianLineHeight(words) {
  const hs = words.filter((w) => (w.y1 - w.y0) > 4).map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  if (!hs.length) return 22;
  return hs.length % 2 ? hs[(hs.length - 1) >> 1] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2;
}

function extractValue(key, text) {
  if (isLabelEcho(text)) return '';
  const t = String(text || '');
  if (key === 'fecha_nacimiento' || key === 'fecha_vencimiento') return extractDateText(t);
  if (key === 'sexo') {
    const m = t.match(/[FMO]/i);
    return m ? m[0].toUpperCase() : '';
  }
  if (key === 'cedula') return findCedula(t);
  if (key === 'estado_civil') {
    const up = t.toUpperCase();
    const known = up.match(/UNION\s*LIBRE|UNION\s*CONSENSUAL|SOLTERO|CASADO|DIVORCIADO|VIUDO/);
    if (known) return known[0].replace(/\s*\(?A\)?\s*$/i, '').trim();
    const v = cleanAlphaValue(up);
    return looksLikeLabel(v) || isLabelEcho(v) ? '' : v;
  }
  const v = cleanAlphaValue(t);
  return looksLikeLabel(v) || isLabelEcho(v) ? '' : v;
}

// Recorta el área bajo una etiqueta y la relee. En cédulas de 2 columnas una
// misma "fila" física comparte etiqueta izquierda y valor derecho; preferimos
// un recorte horizontal que cubra desde la etiqueta hacia la derecha.
async function ocrRegion(page, labelLine, key) {
  const words = page.words || [];
  const lh = medianLineHeight(words) || 22;

  // Región: desde la x de la etiqueta (o mitad de página para campos derechos)
  // hasta bastante a la derecha; y desde el borde bajo de la etiqueta hasta
  // ~3 líneas de alto.
  let x0;
  if (RHS_KEYS.has(key) && labelLine.x0 < page.maxX * 0.45) {
    x0 = Math.max(0, page.midX);
  } else {
    x0 = Math.max(0, labelLine.x0 - 8);
  }
  const x1 = Math.min(page.width, Math.min(labelLine.x1 + 300, labelLine.x0 + 560));
  const y0 = Math.max(0, labelLine.y1 - 2);
  const y1 = Math.min(page.height, labelLine.y1 + lh * 3.2 + 6);

  const ruleW = x1 - x0;
  const ruleH = y1 - y0;
  if (ruleW < 30 || ruleH < 8) return '';

  const img = await loadImage(page.buffer);
  const scale = Math.max(2.4, Math.min(4, 1300 / ruleW));
  const canvas = createCanvas(Math.round(ruleW * scale), Math.round(ruleH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, ruleW, ruleH, 0, 0, canvas.width, canvas.height);
  const png = canvas.toBuffer('image/png');

  const processed = await preprocess(png, {
    grayscale: true, contrast: true, denoise: true, binarize: false
  });
  const singleLine = key === 'sexo' || key === 'estado_civil';
  const { text } = await recognizeDetailed(processed, {
    psm: singleLine ? '7' : '6',
    whitelist: WHITELISTS[key] || WHITELISTS.alpha
  });
  const value = extractValue(key, text);
  if (DEBUG) {
    console.log(`[region] ${key} label="${normLabel(labelLine.text).slice(0,24)}" @(${labelLine.x0},${labelLine.y0}) reg=(${x0},${y0})${ruleW}x${ruleH} s=${scale.toFixed(1)} raw="${String(text).trim().slice(0,50)}" -> "${value}"`);
  }
  return value;
}

// Resuelve un campo leyendo el área bajo su etiqueta (sobre TODAS las words).
async function resolveField(page, key) {
  const words = page.words || [];
  if (!words.length) return '';
  const lines = linesFromWords(words);

  let labelLine = null;
  for (const line of lines) {
    const m = bestLabelMatch(line);
    if (m && m.key === key) { labelLine = line; break; }
  }
  if (!labelLine) {
    if (DEBUG) console.log(`[region] ${key}: sin label (rows=${lines.length})`);
    return '';
  }
  return ocrRegion(page, labelLine, key);
}

// Reconciliar los campos `keys` leyendo sus regiones del frente.
async function reconcileFront(page, keys) {
  const result = {};
  if (!page || !page.words || !page.words.length) return result;
  const maxX = Math.max(...page.words.map((w) => w.x1));
  page.midX = maxX * 0.5;
  page.maxX = maxX;
  for (const key of keys) {
    if (key === 'cedula' || key === 'fecha_nacimiento') continue; // ya confiables/correctos
    try {
      const value = await resolveField(page, key);
      if (value) result[key] = value;
    } catch (e) { /* noop */ }
  }
  return result;
}

module.exports = { reconcileFront, extractValue };