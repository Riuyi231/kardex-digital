const { processFile } = require('../services/cedula');

async function main() {
  const file = process.argv[2] || 'C:/Users/STIVEN/Downloads/Roberto_Guzman (1).pdf';
  const t0 = Date.now();
  const r = await processFile(file);
  console.log(`\n=== ${r.fileName} en ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
  console.log('frente:', r.front ? `sí (${r.front.length > 200 ? 'ok' : 'pequeño'})` : 'no');
  console.log('reverso:', r.back ? 'sí' : 'no');
  console.log('barcode:', r.barcode);
  console.log('CAMPOS:');
  console.log(JSON.stringify(r.fields, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
