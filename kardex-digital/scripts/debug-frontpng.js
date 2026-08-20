const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

(async () => {
  const front = fs.readFileSync(path.join(__dirname, '..', 'test', 'front-debug.png'));
  const img = await loadImage(front);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  let black = 0, white = 0, red = 0, other = 0;
  const samples = {};
  for (let i = 0; i < id.data.length; i += 4) {
    const r = id.data[i], g = id.data[i + 1], b = id.data[i + 2];
    if (r < 30 && g < 30 && b < 30) black++;
    else if (r > 200 && g > 200 && b > 200) white++;
    else if (r > 200 && g < 60 && b < 60) red++;
    else { other++; if (Object.keys(samples).length < 5) samples[`${r},${g},${b}`] = (samples[`${r},${g},${b}`] || 0) + 1; }
  }
  console.log('front png: black', black, 'white', white, 'red', red, 'other', other);
  console.log('sample colores:', JSON.stringify(samples));
  process.exit(0);
})();
