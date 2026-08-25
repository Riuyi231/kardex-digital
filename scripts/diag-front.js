const fs = require('fs');
const { pdfToImages } = require('../services/pdf');
const { recognizeDetailed } = require('../services/ocr');
const { detectFrontIndex } = require('../services/cedula');

async function main() {
  const pages = await pdfToImages(fs.readFileSync('test/cedula-prueba.pdf'));
  const details = [];
  for (const p of pages) details.push(await recognizeDetailed(p.buffer));
  const fi = detectFrontIndex(details);
  console.log('frontIdx:', fi);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
