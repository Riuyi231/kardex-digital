const bwipjs = require('bwip-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ZX = require('@zxing/library');

(async () => {
  const rawPng = await bwipjs.toBuffer({ bcid: 'code128', text: '00123456789', scale: 4, height: 12, includetext: false });
  const img = await loadImage(rawPng);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, img.width, img.height);
  const idata = ctx.getImageData(0, 0, img.width, img.height);
  const w = img.width, h = img.height;
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < idata.data.length; i += 4, j++) {
    lum[j] = (0.299 * idata.data[i] + 0.587 * idata.data[i + 1] + 0.114 * idata.data[i + 2]) | 0;
  }

  const src = new ZX.RGBLuminanceSource(lum, w, h);
  const bitmapH = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
  const bitmapG = new ZX.BinaryBitmap(new ZX.GlobalHistogramBinarizer(src));

  for (const [name, bitmap] of [['hybrid', bitmapH], ['global', bitmapG]]) {
    const r1 = new ZX.Code128Reader();
    try { console.log(name, 'Code128Reader:', r1.decode(bitmap).getText()); } catch (e) { console.log(name, 'Code128Reader ERR:', e.constructor.name); }
    const r2 = new ZX.MultiFormatReader();
    try { console.log(name, 'MultiFormat:', r2.decode(bitmap).getText()); } catch (e) { console.log(name, 'MultiFormat ERR:', e.constructor.name); }
  }
  process.exit(0);
})();
