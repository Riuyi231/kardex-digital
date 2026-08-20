const fs = require('fs');
const path = require('path');
const https = require('https');

const LANGS = [
  { name: 'spa', url: 'https://tessdata.projectnaptha.com/4.0.0/spa.traineddata.gz', out: 'spa.traineddata.gz' }
];

const destDir = path.join(__dirname, '..', 'resources', 'tessdata');

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} para ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(() => resolve()); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(destDir, { recursive: true });
  for (const lang of LANGS) {
    const outPath = path.join(destDir, lang.out);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      console.log('Ya existe:', outPath);
      continue;
    }
    console.log('Descargando', lang.url);
    try {
      await download(lang.url, outPath);
      console.log('OK ->', outPath, fs.statSync(outPath).size, 'bytes');
    } catch (e) {
      console.error('Fallo descargando', lang.name, e.message);
    }
  }
})();
