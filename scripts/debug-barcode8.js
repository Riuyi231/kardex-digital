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

(async () => {
  const img = await loadImage(fs.readFileSync(path.join(__dirname, '..', 'test', 'front-debug.png')));
  const scales = [1, 0.6, 0.5, 0.4, 0.3, 2];
  for (const s of scales) {
    const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const lum = lumOfCanvas(c);
    let found = null;
    for (const [Bin] of [[ZX.HybridBinarizer], [ZX.GlobalHistogramBinarizer]]) {
      try {
        const src = new ZX.RGBLuminanceSource(lum, c.width, c.height);
        const bitmap = new ZX.BinaryBitmap(new Bin(src));
        const hints = new Map();
        hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, ['CODE_128']);
        const reader = new ZX.MultiFormatReader();
        reader.setHints(hints);
        const r = reader.decode(bitmap);
        found = r.getText();
        break;
      } catch (e) { /* next */ }
    }
    console.log('scale', s, '->', found || 'null');
  }
  process.exit(0);
})();
