const fs = require('fs');
const path = require('path');
const { decodeFromImage } = require('../services/barcode');
const { pdfToImages } = require('../services/pdf');

(async () => {
  const pages = await pdfToImages(fs.readFileSync(path.join(__dirname, '..', 'test', 'cedula-prueba.pdf')));
  const front = pages[0];
  console.log('front:', front.width, 'x', front.height);
  const dec = await decodeFromImage(front.buffer);
  console.log('decode desde png renderizado (luminancia fija):', dec);
  process.exit(0);
})();
