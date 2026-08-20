const bwipjs = require('bwip-js');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ZX = require('@zxing/library');

(async () => {
  console.log('Exports disponibles:', Object.keys(ZX).filter(k => /Binariz|Luminance|Reader|Decode/.test(k)).join(', '));
  const rawPng = await bwipjs.toBuffer({ bcid: 'code128', text: '00123456789', scale: 4, height: 12, includetext: false });
  const img = await loadImage(rawPng);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, img.width, img.height);
  const idata = ctx.getImageData(0, 0, img.width, img.height);
  const w = img.width, h = img.height;
  console.log('img:', w, 'x', h, 'rgba len:', idata.data.length);
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < idata.data.length; i += 4, j++) {
    lum[j] = (0.299 * idata.data[i] + 0.587 * idata.data[i + 1] + 0.114 * idata.data[i + 2]) | 0;
  }
  const src = new ZX.RGBLuminanceSource(lum, w, h);
  const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, ['CODE_128']);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  try {
    const res = reader.decode(bitmap);
    console.log('DECODED:', res.getText());
  } catch (e) {
    console.log('decode error:', e.constructor.name, e.message);
  }
  process.exit(0);
})();
