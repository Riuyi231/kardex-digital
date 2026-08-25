const bwipjs = require('bwip-js');
const { decodeFromImage } = require('../services/barcode');
const fs = require('fs');
const path = require('path');

(async () => {
  const rawPng = await bwipjs.toBuffer({ bcid: 'code128', text: '00123456789', scale: 4, height: 12, includetext: false });
  fs.writeFileSync(path.join(__dirname, '..', 'test', 'barcode-raw.png'), rawPng);
  console.log('raw size:', rawPng.length, 'bytes');
  const dec = await decodeFromImage(rawPng);
  console.log('decode raw bwip:', dec);

  const front = fs.readFileSync(path.join(__dirname, '..', 'test', 'front-debug.png'));
  const dec2 = await decodeFromImage(front);
  console.log('decode rendered front:', dec2);
  process.exit(0);
})();
