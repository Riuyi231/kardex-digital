const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'nexalert-server.db');
const db = new DatabaseSync(dbPath);

console.log('=== ULTIMOS SEQ_LOG (20) ===');
const seq = db.prepare('SELECT * FROM seq_log ORDER BY seq DESC LIMIT 20').all();
seq.forEach(s => console.log(JSON.stringify(s)));

console.log('\n=== FOTOS (count) ===');
const count = db.prepare('SELECT COUNT(*) as cnt FROM fotos').get();
console.log('Total fotos:', count.cnt);

console.log('\n=== REPORTES ===');
const reportes = db.prepare('SELECT id, client_nombre, equipo_nombre, adjuntos, estado, updated_at FROM reportes ORDER BY id DESC LIMIT 10').all();
reportes.forEach(r => console.log(JSON.stringify(r)));

console.log('\n=== EVENTOS RECIENTES ===');
const eventos = db.prepare('SELECT * FROM reporte_eventos ORDER BY id DESC LIMIT 10').all();
eventos.forEach(e => console.log(JSON.stringify(e)));

db.close();
