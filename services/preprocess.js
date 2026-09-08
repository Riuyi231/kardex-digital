const { createCanvas, loadImage } = require('./canvas');

// Preprocesado de imagen para OCR (todos puros JS sobre el canvas actual).
// Mejora drásticamente la precisión de Tesseract en fotos y escaneos con
// sombras, fondo de color o bajo contraste, sin depender de sharp.

function toGrayscale(data) {
  for (let i = 0; i < data.length; i += 4) {
    const v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

function histogram(data) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++;
  return hist;
}

function autocontrast(data, lowPct = 0.005, highPct = 0.995) {
  const hist = histogram(data);
  const total = data.length >> 2;
  let lo = 0;
  let acc = 0;
  const loTarget = total * lowPct;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loTarget) { lo = v; break; }
  }
  let hi = 255;
  acc = 0;
  const hiTarget = total * highPct;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= hiTarget) { hi = v; break; }
  }
  if (hi - lo < 24) return;
  const range = hi - lo;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i];
    const out = v <= lo ? 0 : v >= hi ? 255 : ((v - lo) * 255 / range) | 0;
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
  }
}

// Elimina píxeles aislados (sal y pimienta de escaneo): un píxel que difiere de
// la gran mayoría de sus 8 vecinos se invierte.
function denoise(data, width, height) {
  const src = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const c = src[i];
      let dark = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * width + (x + dx)) * 4;
          if (src[j] < 128) dark++;
        }
      }
      if ((c < 128 && dark <= 1) || (c >= 128 && dark >= 7)) {
        const v = c < 128 ? 255 : 0;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    }
  }
}

function otsu(data) {
  const hist = histogram(data);
  const total = data.length >> 2;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0;
  let maxVar = -1, threshold = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const diff = mB - mF;
    const variance = wB * wF * diff * diff;
    if (variance > maxVar) { maxVar = variance; threshold = v; }
  }
  return threshold;
}

function binarize(data, threshold) {
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] < threshold ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

// Aplica el preprocesado a un buffer. Opciones: grayscale (bool),
// contrast (bool), denoise (bool), binarize (bool: Otsu global).
// Devuelve el nuevo buffer PNG.
async function preprocess(buffer, opts = {}) {
  const image = await loadImage(buffer);
  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = opts.grayscale !== false;
  if (gray) toGrayscale(data);
  if (opts.contrast !== false) autocontrast(data);
  if (opts.denoise) denoise(data, width, height);
  if (opts.binarize) binarize(data, opts.threshold || otsu(data));
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer('image/png');
}

// Escala un buffer (manteniendo proporción) hasta que sea más ancho que
// `minWidth`, y opcionalmente aplica preprocesado. Útil para recortes y pasadas.
async function normalize(buffer, { minWidth = 1200, ...pre } = {}) {
  const image = await loadImage(buffer);
  const width = image.width;
  const height = image.height;
  const scale = width >= minWidth ? 1 : Math.ceil(minWidth / width * 10) / 10;
  if (scale === 1) return preprocess(buffer, pre);
  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return preprocess(canvas.toBuffer('image/png'), pre);
}

module.exports = { preprocess, normalize, toGrayscale, autocontrast, denoise, otsu, binarize };