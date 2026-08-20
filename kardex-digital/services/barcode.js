const { createCanvas, loadImage } = require('./canvas');
const {
  RGBLuminanceSource,
  InvertedLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  MultiFormatReader,
  DecodeHintType
} = require('@zxing/library');

function rgbaToLuminance(rgba, width, height) {
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    lum[j] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
  }
  return lum;
}

function tryDecode(lum, width, height, binarizerCtor, inverted) {
  let source = new RGBLuminanceSource(lum, width, height);
  if (inverted) source = new InvertedLuminanceSource(source);
  const bitmap = new BinaryBitmap(new binarizerCtor(source));
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ['CODE_128']);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try {
    const result = reader.decode(bitmap);
    return result.getText();
  } catch (err) {
    return null;
  }
}

async function decodeFromImage(buffer) {
  const img = await loadImage(buffer);
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return decodeFromImageDataBuffer(width, height, imageData.data);
}

function decodeFromImageDataBuffer(width, height, rgba) {
  const lum = rgbaToLuminance(rgba, width, height);

  const crop = detectBarcodeCrop(lum, width, height);
  if (crop && (crop.x1 - crop.x0 > 40) && (crop.y1 - crop.y0 > 10)) {
    const cw = crop.x1 - crop.x0;
    const ch = crop.y1 - crop.y0;
    const cropped = new Uint8ClampedArray(cw * ch);
    for (let y = 0; y < ch; y++) {
      cropped.set(lum.subarray((crop.y0 + y) * width + crop.x0, (crop.y0 + y) * width + crop.x1), y * cw);
    }
    const res = decodeLuminance(cropped, cw, ch);
    if (res) return res;
  }

  return decodeLuminance(lum, width, height);
}

function decodeLuminance(lum, width, height) {
  const attempts = [
    [HybridBinarizer, false],
    [GlobalHistogramBinarizer, false],
    [HybridBinarizer, true],
    [GlobalHistogramBinarizer, true]
  ];
  for (const [Ctor, inverted] of attempts) {
    const text = tryDecode(lum, width, height, Ctor, inverted);
    if (text) return text;
  }
  return null;
}

function detectBarcodeCrop(lum, width, height) {
  const isDark = (i) => lum[i] < 128;
  const rowTrans = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let prev = isDark(base);
    let count = 0;
    for (let x = 1; x < width; x++) {
      const dark = isDark(base + x);
      if (dark !== prev) count++;
      prev = dark;
    }
    rowTrans[y] = count;
  }

  let maxRow = 0;
  for (let y = 1; y < height; y++) if (rowTrans[y] > rowTrans[maxRow]) maxRow = y;
  const rowFloor = Math.max(12, rowTrans[maxRow] * 0.45);

  const runs = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    if (rowTrans[y] >= rowFloor) {
      if (start === -1) start = y;
    } else if (start !== -1) {
      runs.push([start, y - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, height - 1]);

  runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const band = runs[0];
  if (!band) return null;
  const y0 = Math.max(0, band[0] - 4);
  const y1 = Math.min(height, band[1] + 4);
  const bandHeight = y1 - y0;
  if (bandHeight < 10) return null;

  const colTrans = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let prev = isDark(y0 * width + x);
    let count = 0;
    for (let y = y0 + 1; y < y1; y++) {
      const dark = isDark(y * width + x);
      if (dark !== prev) count++;
      prev = dark;
    }
    colTrans[x] = count;
  }
  let maxCol = 0;
  for (let x = 1; x < width; x++) if (colTrans[x] > colTrans[maxCol]) maxCol = x;
  const colFloor = Math.max(2, colTrans[maxCol] * 0.35);

  let x0 = -1, x1 = -1;
  for (let x = 0; x < width; x++) {
    if (colTrans[x] >= colFloor) {
      if (x0 === -1) x0 = x;
      x1 = x;
    }
  }
  if (x0 === -1 || x1 === -1) return null;
  x0 = Math.max(0, x0 - 6);
  x1 = Math.min(width, x1 + 6);
  return { x0, x1, y0, y1 };
}

function normalizeCedulaNumber(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
  }
  return String(raw).trim();
}

module.exports = { decodeFromImage, decodeFromImageDataBuffer, normalizeCedulaNumber };
