const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');
const { loadImage, createCanvas } = require('../services/canvas');

const LANGS_DIR = path.join(__dirname, '..', 'resources', 'tessdata');

async function upscaleBuffer(buffer, factor) {
  const img = await loadImage(buffer);
  const c = createCanvas(Math.round(img.width * factor), Math.round(img.height * factor));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toBuffer('image/png');
}

async function main() {
  const worker = await createWorker(['spa'], 1, {
    langPath: LANGS_DIR,
    gzip: true,
    workerPath: path.join(__dirname, '..', 'resources', 'tesseract-worker.js'),
    cachePath: path.join(require('os').tmpdir(), 'kardex-tess-cache')
  });
  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });

  const srcFile = 'test/pg0.png';
  const scales = [1, 2, 3, 4];
  for (const s of scales) {
    const buf = s === 1 ? fs.readFileSync(srcFile) : await upscaleBuffer(fs.readFileSync(srcFile), s);
    const tmp = path.join(require('os').tmpdir(), `kardex-scale-${s}.png`);
    fs.writeFileSync(tmp, buf);
    const { data } = await worker.recognize(tmp);
    console.log(`scale=${s}: text_len=${(data.text || '').length} conf=${data.confidence} | ${JSON.stringify((data.text || '').slice(0, 80))}`);
    fs.unlinkSync(tmp);
  }
  await worker.terminate();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
