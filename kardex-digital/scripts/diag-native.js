const fs = require('fs');
delete process.env.KARDEX_CANVAS_FORCE_SHIM;
const { pdfToImages } = require('../services/pdf');
const { loadImage, createCanvas } = require('../services/canvas');
const { recognizeDetailed } = require('../services/ocr');

async function analyze(label, buffer) {
  const img = await loadImage(buffer);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height).data;
  let pureBlack = 0, pureWhite = 0, gray = 0, other = 0;
  const sample = new Set();
  for (let i = 0; i < id.length; i += 4) {
    const r = id[i], g = id[i + 1], b = id[i + 2];
    if (r === 0 && g === 0 && b === 0) pureBlack++;
    else if (r === 255 && g === 255 && b === 255) pureWhite++;
    else if (r === g && g === b) gray++;
    else other++;
    sample.add(`${r},${g},${b}`);
  }
  const total = id.length / 4;
  console.log(`== ${label} (${img.width}x${img.height}) ==`);
  console.log(`  pureBlack=${pureBlack} (${(100*pureBlack/total).toFixed(2)}%)  pureWhite=${pureWhite} gray=${gray} other=${other}`);
  const arr = [...sample];
  console.log(`  uniqueColors=${arr.length}  e.g. ${arr.slice(0,12).join(' | ')}`);
}

async function main() {
  const pdf = fs.readFileSync('test/cedula-prueba.pdf');
  console.log('impl:', require('../services/canvas').implementation);
  const pages = await pdfToImages(pdf);
  const b = pages[0].buffer;
  await analyze('native-pg0', b);
  fs.writeFileSync('test/native-pg0.png', b);
  console.log('--- OCR nativo ---');
  const d = await recognizeDetailed(b);
  console.log('WORDS:', (d.words||[]).length);
  console.log('TEXT[' + (d.text||'').length + ']:', JSON.stringify((d.text||'').slice(0,300)));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
