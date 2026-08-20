const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ZX = require('@zxing/library');

function lumOfCanvas(c) {
  const ctx = c.getContext('2d');
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const lum = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < id.data.length; i += 4, j++) {
    lum[j] = (0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2]) | 0;
  }
  return lum;
}

function decodeLum(lum, w, h) {
  for (const [Bin, invert] of [[ZX.HybridBinarizer, false], [ZX.GlobalHistogramBinarizer, false]]) {
    try {
      let src = new ZX.RGBLuminanceSource(lum, w, h);
      if (invert) src = new ZX.InvertedLuminanceSource(src);
      const bitmap = new ZX.BinaryBitmap(new Bin(src));
      const hints = new Map();
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, ['CODE_128']);
      const reader = new ZX.MultiFormatReader();
      reader.setHints(hints);
      return reader.decode(bitmap).getText();
    } catch (e) { /* next */ }
  }
  return null;
}

(async () => {
  const img = await loadImage(fs.readFileSync(path.join(__dirname, '..', 'test', 'front-debug.png')));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const lum = lumOfCanvas(c);
  const W = img.width, H = img.height;

  console.log('decode imagen completa:', decodeLum(lum, W, H));

  // detectar banda: fila con mas transiciones negras
  const rowTrans = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let prev = lum[y * W];
    for (let x = 1; x < W; x++) {
      const v = lum[y * W + x];
      const dark = v < 128;
      const prevDark = prev < 128;
      if (dark !== prevDark) rowTrans[y]++;
      prev = v;
    }
  }
  let maxY = 0;
  for (let y = 1; y < H; y++) if (rowTrans[y] > rowTrans[maxY]) maxY = y;
  console.log('fila con mas transiciones:', maxY, 'trans:', rowTrans[maxY]);

  for (const half of [80, 120, 200]) {
    const y0 = Math.max(0, maxY - half);
    const y1 = Math.min(H, maxY + half);
    const h = y1 - y0;
    const cropLum = new Uint8ClampedArray(W * h);
    for (let y = 0; y < h; y++) {
      cropLum.set(lum.subarray((y0 + y) * W, (y0 + y) * W + W), y * W);
    }
    console.log(`banda +/-${half} (y ${y0}-${y1}):`, decodeLum(cropLum, W, h));
  }
  process.exit(0);
})();
