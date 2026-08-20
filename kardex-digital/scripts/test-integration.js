const path = require('path');
const { processFile } = require('../services/cedula');
const db = require('../services/db');

const TEST_PDF = path.join(__dirname, '..', 'test', 'cedula-prueba.pdf');

(async () => {
  const start = Date.now();
  try {
    await db.open(path.join(__dirname, '..', 'test', 'test-data', 'kardex-test.db'));

    const result = await processFile(TEST_PDF);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log('=== RESULTADO PIPELINE CÉDULA ===');
    console.log('Archivo:', result.fileName);
    console.log('Tiempo total:', elapsed, 's');
    console.log('Frente:', result.front ? `sí (${(result.front.length / 1024).toFixed(0)} KB)` : 'NO');
    console.log('Reverso:', result.back ? `sí (${(result.back.length / 1024).toFixed(0)} KB)` : 'NO');
    console.log('Código de barras:', result.barcode);
    console.log('Campos extraídos:');
    console.log(JSON.stringify(result.fields, null, 2));

    const ok = result.front && result.back && result.barcode === '00123456789';
    console.log(ok ? '\nPIPELINE OK' : '\nPIPELINE CON PROBLEMAS');

    const u = db.auth.login('admin', 'admin123');
    console.log('Login admin:', u ? `OK (${u.role})` : 'FALLO');
    const created = db.employees.create({ ...result.fields, nota: 'test', frente: result.front, reverso: result.back }, u.id);
    console.log('Empleado creado id:', created.id, created.cedula);
    const list = db.employees.list();
    console.log('Empleados en BD:', list.length);
    const got = db.employees.get(created.id);
    console.log('Empleado recuperado, tiene frente:', !!(got.frente && got.frente.length > 100));
    db.employees.delete(created.id);
    db.audit.add(u, 'test', 'ejecución de prueba');
    console.log('Bitácora registros:', db.audit.list().length);
    db.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('ERROR:', e);
    try { db.close(); } catch (e2) {}
    process.exit(1);
  }
})();
