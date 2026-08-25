const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ZX = require('@zxing/library');

(async () => {
  const img = await loadImage(fs.readFileSync(path.join(__dirname, '..', 'test', 'front-debug.png')));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  const W = img.width, H = img.height;

  function lumOf(x0, y0, w, h) {
    const lum = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y0 + y) * W + (x0 + x)) * 4;
        lum[y * w + x] = (0.299 * id.data[si] + 0.587 * id.data[si + 1] + 0.114 * id.data[si + 2]) | 0;
      }
    }
    return lum;
  }

  const region = { x0: 180, y0: 420, w: 1150, h: 380 };
  const lum = lumOf(region.x0, region.y0, region.w, region.h);
  let min = 255, max = 0;
  for (let i = 0; i < lum.length; i++) { if (lum[i] < min) min = lum[i]; if (lum[i] > max) max = lum[i]; }
  console.log('region:', region, 'lum min/max:', min, max);

  for (const [name, Bin] of [['Hybrid', ZX.HybridBinarizer], ['Global', ZX.GlobalHistogramBinarizer]]) {
    const src = new ZX.RGBLuminanceSource(lum, region.w, region.h);
    const bitmap = new ZX.BinaryBitmap(new Bin(src));
    for (const rname of ['Code128', 'MultiFormat']) {
      const reader = rname === 'Code128' ? new ZX.Code128Reader() : new ZX.MultiFormatReader();
      try { console.log(name, rname, '->', reader.decode(bitmap).getText()); }
      catch (e) { console.log(name, rname, 'ERR', e.constructor.name); }
    }
  }
  process.exit(0);
})();
