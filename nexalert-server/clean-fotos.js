const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'nexalert-server.db');
const db = new DatabaseSync(dbPath);

// 1. Borrar fotos corruptas de la DB
const fotos = db.prepare('SELECT id, nombre FROM fotos').all();
console.log('Fotos encontradas:', fotos.length);
fotos.forEach(f => console.log(' -', f.id, f.nombre));

db.prepare('DELETE FROM fotos').run();
console.log('Fotos eliminadas de la DB');

db.prepare("DELETE FROM seq_log WHERE tipo = 'foto'").run();
console.log('Seq_log fotos eliminados');

// 2. Limpiar adjuntos de reportes
db.prepare("UPDATE reportes SET adjuntos = '[]'").run();
console.log('Adjuntos limpiados');

// 3. Borrar archivos corruptos de disco
const adjuntosDir = path.join(process.env.APPDATA, 'NexAlert', 'adjuntos');
if (fs.existsSync(adjuntosDir)) {
  const files = fs.readdirSync(adjuntosDir);
  files.forEach(f => {
    if (f.startsWith('esp_')) {
      fs.unlinkSync(path.join(adjuntosDir, f));
      console.log('Archivo eliminado:', f);
    }
  });
}

console.log('Limpieza completada. Ahora mandá la foto de nuevo desde el móvil.');
db.close();
