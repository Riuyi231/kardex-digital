const fs = require('fs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { recognize } = require('../services/ocr');

async function crop(buf, x0pct, x1pct, scale) {
  const img = await loadImage(buf);
  const x0 = Math.round(img.width * x0pct);
  const x1 = Math.round(img.width * x1pct);
  const w = x1 - x0;
  const h = img.height;
  const c = createCanvas(w * scale, h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, x0, 0, w, h, 0, 0, c.width, c.height);
  return c.toBuffer('image/png');
}

async function main() {
  const src = fs.readFileSync('C:/Users/STIVEN/AppData/Local/Temp/opencode/roberto-p0.png');
  for (const [name, x0pct, x1pct, scale] of [['right-half', 0.45, 1.0, 2], ['right-mid', 0.5, 1.0, 2]]) {
    const png = await crop(src, x0pct, x1pct, scale);
    const t = await recognize(png);
    console.log(`===== ${name} (${scale}x) =====`);
    console.log(t);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
