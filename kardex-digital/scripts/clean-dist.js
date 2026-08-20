const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const patterns = [/KARDEX-Digital-Setup-x64\.exe$/, /KARDEX-Digital-Setup-x64\.exe\.blockmap$/, /KARDEX-Digital-Setup-ia32\.exe$/, /KARDEX-Digital-Setup-ia32\.exe\.blockmap$/, /KARDEX-Digital-portable-x64\.exe$/, /KARDEX-Digital-portable-ia32\.exe$/];

if (!fs.existsSync(dist)) {
  console.log('No existe dist/, nada que limpiar.');
  process.exit(0);
}

let removed = 0;
for (const f of fs.readdirSync(dist)) {
  if (patterns.some((p) => p.test(f))) {
    fs.unlinkSync(path.join(dist, f));
    console.log('Eliminado:', f);
    removed++;
  }
}

if (removed === 0) {
  const exes = fs.readdirSync(dist).filter((f) => /\.exe$/.test(f));
  console.log('Sin binarios por-arquitectura. Combinados presentes:', exes.join(', '));
} else {
  console.log('Limpieza completada (' + removed + ' archivos).');
}
