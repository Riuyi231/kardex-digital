const fs = require('fs');
const { pdfToImages } = require('../services/pdf');

async function main() {
  const pages = await pdfToImages(fs.readFileSync('test/cedula-prueba.pdf'));
  for (let i = 0; i < pages.length; i++) {
    fs.writeFileSync('test/pg' + i + '.png', pages[i].buffer);
  }
  fs.writeFileSync('test/page-data.json', JSON.stringify(pages.map(p => ({
    w: p.width, h: p.height, bytes: p.buffer.length
  })), null, 2));
  console.log('saved', pages.length, 'pages');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
