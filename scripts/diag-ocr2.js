const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { pdfToImages } = require('../services/pdf');
const { recognize } = require('../services/ocr');

const OUT = 'C:/Users/STIVEN/AppData/Local/Temp/opencode';

async function upscale2x(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width * 2, img.height * 2);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toBuffer('image/png');
}

async function main() {
  const file = process.argv[2] || 'C:/Users/STIVEN/Downloads/Roberto_Guzman (1).pdf';
  const pages = await pdfToImages(fs.readFileSync(file));
  for (let i = 0; i < pages.length; i++) {
    const native = await recognize(pages[i].buffer);
    const up = await upscale2x(pages[i].buffer);
    const high = await recognize(up);
    fs.writeFileSync(path.join(OUT, `ocr-p${i}-native.txt`), native, 'utf8');
    fs.writeFileSync(path.join(OUT, `ocr-p${i}-2x.txt`), high, 'utf8');
    console.log(`page ${i}: ${pages[i].width}x${pages[i].height} -> 2x ${up ? 'ok' : 'fail'} (${Buffer.byteLength(up)}b)`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
