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
  tipo_sangre: 'ABO+- ',
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

// Plantilla de recuadros (lámina): posiciones en % de la página para campos de
// vocabulario CERRADO (estado civil, sexo). Se recortan varias zonas candidatas
// (cubre las 2 disposiciones observadas) y se acepta SOLO un valor del enum:
// nunca se inventa ni se deja basura. Estos recuadros NO se usan para campos de
// texto abierto (profesión/lugar): allí un recorte a ciegas podría meter un
// valor plausible pero incorrecto, y aplica "mejor vacío que mal puesto".
const TEMPLATE_RECTS = {
  estado_civil: [
    { x0: 0.48, x1: 0.99, y0: 0.56, y1: 0.74, psm: '7', wl: 'estado_civil' },
    { x0: 0.01, x1: 0.60, y0: 0.56, y1: 0.74, psm: '7', wl: 'estado_civil' }
  ],
  sexo: [
    { x0: 0.48, x1: 0.99, y0: 0.70, y1: 0.82, psm: '7', wl: 'sexo' },
    { x0: 0.01, x1: 0.60, y0: 0.70, y1: 0.82, psm: '7', wl: 'sexo' }
  ]
};

// Lee un rectángulo (fracciones de la página) y extrae el valor del campo.
async function ocrBoxRect(page, rect, key) {
  const w = page.width, h = page.height;
  const x0 = Math.round(w * rect.x0);
  const x1 = Math.max(x0 + 30, Math.round(w * rect.x1));
  const y0 = Math.round(h * rect.y0);
  const y1 = Math.max(y0 + 8, Math.round(h * rect.y1));
  const ruleW = x1 - x0, ruleH = y1 - y0;
  if (ruleW < 30 || ruleH < 8) return { value: '', raw: '' };
  const img = await loadImage(page.buffer);
  const scale = Math.max(2.4, Math.min(4, 1300 / ruleW));
  const canvas = createCanvas(Math.round(ruleW * scale), Math.round(ruleH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, x0, y0, ruleW, ruleH, 0, 0, canvas.width, canvas.height);
  const png = canvas.toBuffer('image/png');
  const processed = await preprocess(png, {
    grayscale: true, contrast: true, denoise: true, binarize: false
  });
  const { text } = await recognizeDetailed(processed, {
    psm: rect.psm || '7',
    whitelist: WHITELISTS[rect.wl || key] || WHITELISTS.alpha
  });
  return { value: extractValue(key, text), raw: String(text).trim() };
}

// Vota entre los recuadros candidatos: solo se acepta un valor conocido del
// enum (extractValue ya vacía lo que no es opción válida).
async function resolveTemplate(page, key) {
  const rects = TEMPLATE_RECTS[key] || [];
  const votes = {};
  const raws = [];
  for (const rect of rects) {
    const { value, raw } = await ocrBoxRect(page, rect, key);
    raws.push(`${(rect.x0 * 100).toFixed(0)}-${(rect.x1 * 100).toFixed(0)}%/${(rect.y0 * 100).toFixed(0)}-${(rect.y1 * 100).toFixed(0)}%: "${raw.slice(0, 24)}"`);
    if (value) votes[value] = (votes[value] || 0) + 1;
  }
  let best = '', bestN = 0;
  for (const v of Object.keys(votes)) {
    if (votes[v] > bestN) { best = v; bestN = votes[v]; }
  }
  if (DEBUG) {
    console.log(`[region] ${key} template rects (${raws.join(' | ')}) -> "${best}"`);
  }
  return best || '';
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
  if (key === 'tipo_sangre') {
    const m = t.toUpperCase().replace(/\s+/g, '').match(/(?:AB|A|B|O)(?:\+|-)/);
    return m ? m[0] : '';
  }
  if (key === 'cedula') return findCedula(t);
  if (key === 'estado_civil') {
    const up = t.toUpperCase();
    const known = up.match(/UNION\s*LIBRE|UNION\s*CONSENSUAL|SOLTER[OA]|CASAD[OA]|DIVORCIAD[OA]|VIUD[OA]/);
    if (known) return known[0].replace(/\s+/g, ' ').trim();
    const v = cleanAlphaValue(up);
    return looksLikeLabel(v) || isLabelEcho(v) ? '' : v;
  }
  if (key === 'nacionalidad') {
    const m = t.toUpperCase().match(/\b(?:DOMINICANA|DOMINICANO|HAITIANA?|VENEZOLANA?|COLOMBIANA?|ESTADOUNIDENSE|ESPANIOLA?|ITALIANA?|CANADIENSE|CUBANA?|MEXICANA?|ARGENTINA?|CHILENA?|PERUANA?|BRASILENA?|URUGUAYA?|PARAGUAYA?|GUATEMALTECA?|HONDURENA?|SALVADORENA?)\b/);
    if (m) return m[0];
    return '';
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
  let x1 = Math.min(page.width, Math.min(labelLine.x1 + 300, labelLine.x0 + 560));
  // Campo de la columna izquierda: no cortar dentro de la columna derecha.
  if (!RHS_KEYS.has(key) && labelLine.x0 < page.maxX * 0.45) {
    x1 = Math.min(x1, page.midX);
  }
  if (x1 <= x0) return '';
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
    if (key === 'tipo_sangre') return ocrBloodBox(page);
    if (TEMPLATE_RECTS[key]) {
      const tv = await resolveTemplate(page, key);
      if (tv) return tv;
    }
    if (DEBUG) console.log(`[region] ${key}: sin label (rows=${lines.length})`);
    return '';
  }
  return ocrRegion(page, labelLine, key);
}

// Plantilla del recuadro de tipo de sangre (FRENTE). El OCR suele NO leer la
// etiqueta "TIPO DE SANGRE", así que se recorta la esquina inferior derecha
// (rectas en % de la página) y se relee con whitelist de 8 tipos. Solo se
// acepta un token "A+/A-/B+/B-/AB+/AB-/O+/O-" de alta confianza: si el cuadro
// está vacío o el OCR falla, el campo queda vacío (nunca inventa).
const BLOOD_RECT = { x0: 0.82, x1: 1.0, y0: 0.55, y1: 0.80 };

async function ocrBloodBox(page) {
  if (!page || !page.buffer) return '';
  const w = page.width, h = page.height;
  const x0 = Math.round(w * BLOOD_RECT.x0);
  const x1 = Math.max(x0 + 30, w);
  const y0 = Math.round(h * BLOOD_RECT.y0);
  const y1 = Math.round(h * BLOOD_RECT.y1);
  const ruleW = x1 - x0;
  const ruleH = y1 - y0;
  if (ruleW < 30 || ruleH < 8) return '';
  const img = await loadImage(page.buffer);
  const scale = Math.max(2.4, Math.min(4, 1300 / ruleW));
  const canvas = createCanvas(Math.round(ruleW * scale), Math.round(ruleH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, x0, y0, ruleW, ruleH, 0, 0, canvas.width, canvas.height);
  const png = canvas.toBuffer('image/png');
  const processed = await preprocess(png, {
    grayscale: true, contrast: true, denoise: true, binarize: false
  });
  const { words } = await recognizeDetailed(processed, {
    psm: '7',
    whitelist: WHITELISTS.tipo_sangre
  });
  let best = null;
  const tokens = words || [];
  if (!tokens.length) {
    // Si el preprocesado arrasa con el símbolo (+/-), reintentar sin él.
    const retry = await recognizeDetailed(png, { psm: '7', whitelist: WHITELISTS.tipo_sangre });
    tokens.push(...(retry.words || []));
  }
  const joined = tokens.map((x) => String(x.text || '')).join('').toUpperCase().replace(/[^ABO+-]/g, '');
  if (tokens.length <= 3 && /^(AB|A|B|O)[+-]$/.test(joined)) best = { t: joined, conf: 99 };
  for (const wd of tokens) {
    const t = String(wd.text || '').toUpperCase().replace(/[^ABO+-]/g, '');
    if (/^(AB|A|B|O)[+-]$/.test(t) && (!best || (wd.conf || 0) > best.conf)) {
      best = { t, conf: wd.conf || 0 };
    }
  }
  if (DEBUG) {
    console.log(`[region] tipo_sangre template reg=(${x0},${y0})${ruleW}x${ruleH} s=${scale.toFixed(1)} raw="${(words || []).map((x) => x.text).join(' ').slice(0, 40)}" -> "${best ? best.t : ''}"`);
  }
  return best ? best.t : '';
}

// Reconciliar campos del REVERSO (p.ej. ciudad/municipio): misma mecánica que
// reconcileFront pero operando sobre el texto e imagen de la página trasera.
async function reconcileBack(page, keys) {
  const result = {};
  if (!page || !page.words || !page.words.length) return result;
  page.midX = page.midX || (page.width * 0.5);
  page.maxX = page.maxX || page.width;
  for (const key of keys) {
    try {
      const value = await resolveField(page, key);
      if (value) result[key] = value;
    } catch (e) { /* noop */ }
  }
  return result;
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

module.exports = { reconcileFront, reconcileBack, extractValue };