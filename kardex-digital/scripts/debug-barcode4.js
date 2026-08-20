const bwipjs = require('bwip-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  const rawPng = await bwipjs.toBuffer({ bcid: 'code128', text: '00123456789', scale: 4, height: 12, includetext: false });
  const img = await loadImage(rawPng);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, img.width, img.height);
  const idata = ctx.getImageData(0, 0, img.width, img.height);
  const w = img.width, h = img.height;
  let min = 255, max = 0, dark = 0, light = 0;
  for (let i = 0; i < idata.data.length; i += 4) {
    const lum = (0.299 * idata.data[i] + 0.587 * idata.data[i + 1] + 0.114 * idata.data[i + 2]) | 0;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
    if (lum < 128) dark++; else light++;
    if (idata.data[i + 3] !== 255) console.log('alpha != 255 at', i / 4);
  }
  console.log('w h:', w, h, 'min:', min, 'max:', max, 'dark px:', dark, 'light px:', light);
  // sample a row in the middle
  const row = [];
  const y = h >> 1;
  for (let x = 0; x < w; x += 1) {
    const idx = (y * w + x) * 4;
    row.push((0.299 * idata.data[idx] + 0.587 * idata.data[idx + 1] + 0.114 * idata.data[idx + 2]) | 0);
  }
  console.log('fila central (primeros 200):', row.slice(0, 200).join(' '));
  process.exit(0);
})();
