const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');

async function ocr(worker, tmpBuf, label) {
  const tmp = path.join(os.tmpdir(), 'ctrl-' + Date.now() + '-' + label + '.png');
  fs.writeFileSync(tmp, tmpBuf);
  try {
    const { data } = await worker.recognize(tmp);
    console.log(`[${label}] len=${(data.text || '').length} conf=${data.confidence} | ${JSON.stringify((data.text || '').slice(0, 60))}`);
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

function makeTextPng() {
  const w = 900, h = 400;
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255; }
  const drawBlock = (x, y, bw, bh) => {
    for (let py = y; py < y + bh; py++) for (let px = x; px < x + bw; px++) {
      const i = (py * w + px) * 4; png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0;
    }
  };
  // "HI" grande en bloques: H = 2 barras verticales + travesaño; I = 1 barra
  const x0 = 100, y0 = 100, bw = 90, bh = 180, th = 30;
  drawBlock(x0, y0, bw, bh);            // H izquierda
  drawBlock(x0 + 200, y0, bw, bh);      // H derecha
  drawBlock(x0, y0 + 75, 290, th);      // travesaño H
  drawBlock(x0 + 420, y0, bw, bh);      // I
  return PNG.sync.write(png);
}

async function main() {
  // Worker POR DEFECTO (sin workerPath custom)
  const w = await createWorker(['spa'], 1, {
    langPath: path.join(__dirname, '..', 'resources', 'tessdata'),
    gzip: true,
    cachePath: path.join(os.tmpdir(), 'kardex-tess-cache')
  });
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  await ocr(w, makeTextPng(), 'generated-text-default-worker');
  if (fs.existsSync('test/pg0.png')) await ocr(w, fs.readFileSync('test/pg0.png'), 'pg0-default-worker');
  await w.terminate();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
