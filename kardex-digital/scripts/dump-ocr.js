const path = require('path');
const { processFile } = require('../services/cedula');

const filePath = process.argv[2];
if (!filePath) { console.error('Uso: node scripts/dump-ocr.js <archivo>'); process.exit(1); }

(async () => {
  try {
    const r = await processFile(filePath);
    console.log('=== ARCHIVO:', r.fileName, '===');
    console.log('Barcode:', r.barcode);
    console.log('\n=== TEXTO OCR CRUDO ===');
    console.log(r.ocrText);
    console.log('\n=== CAMPOS ASIGNADOS ===');
    console.log(JSON.stringify(r.fields, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
