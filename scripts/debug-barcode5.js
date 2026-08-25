const bwipjs = require('bwip-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

(async () => {
  const rawPng = await bwipjs.toBuffer({ bcid: 'code128', text: '00123456789', scale: 4, height: 12, includetext: false });
  console.log('header bytes:', rawPng.slice(0, 24).toString('hex'));
  console.log('IHDR first 8:', rawPng.slice(16, 24).toString('hex'));
  const w = rawPng.readUInt32BE(16);
  const h = rawPng.readUInt32BE(20);
  console.log('IHDR w,h:', w, h, 'bitdepth+colortype+compression+filter+interlace:', rawPng.slice(24, 29).toString('hex'));

  const img = await loadImage(rawPng);
  console.log('img dims from loadImage:', img.width, img.height);

  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  let black = 0, white = 0, red = 0;
  for (let i = 0; i < id.data.length; i += 4) {
    const r = id.data[i], g = id.data[i + 1], b = id.data[i + 2], a = id.data[i + 3];
    if (r === 255 && g === 0 && b === 0) red++;
    else if (r < 30 && g < 30 && b < 30) black++;
    else if (r > 225 && g > 225 && b > 225) white++;
  }
  console.log('pixeles red/black/white:', red, black, white, 'de', w * h);
  process.exit(0);
})();
