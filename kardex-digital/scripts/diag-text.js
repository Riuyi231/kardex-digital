const fs = require('fs');
const { pdfToImages } = require('../services/pdf');
const { recognizeDetailed } = require('../services/ocr');
const { detectFrontIndex } = require('../services/cedula');

async function main() {
  const pages = await pdfToImages(fs.readFileSync('test/cedula-prueba.pdf'));
  const details = [];
  for (let i = 0; i < pages.length; i++) {
    const d = await recognizeDetailed(pages[i].buffer);
    const text = (d.text || '').replace(/\s+/g, ' ').trim();
    console.log(`--- page ${i} (${pages[i].width}x${pages[i].height}) ---`);
    console.log('TEXT[' + text.length + ']:');
    console.log(text.slice(0, 600));
    console.log('WORDS:', (d.words || []).length);
    console.log();
    details.push(d);
  }
  console.log('frontIdx:', detectFrontIndex(details));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
