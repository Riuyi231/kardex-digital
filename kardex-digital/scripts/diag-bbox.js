const fs = require('fs');
const { createWorker } = require('tesseract.js');
const path = require('path');
const os = require('os');

const LANGS_DIR = path.join(__dirname, '..', 'resources', 'tessdata');

async function main() {
  const worker = await createWorker(['spa'], 1, {
    langPath: LANGS_DIR,
    gzip: true,
    workerPath: path.join(__dirname, '..', 'resources', 'tesseract-worker.js'),
    cachePath: path.join(os.tmpdir(), 'kardex-tess-cache')
  });
  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  const img = 'C:/Users/STIVEN/AppData/Local/Temp/opencode/roberto-p0.png';
  const { data } = await worker.recognize(img, {}, { blocks: true });
  const rows = [];
  for (const w of data.words) {
    rows.push(`${String(w.text).padEnd(24)} conf=${String(Math.round(w.confidence)).padStart(3)} bbox=${w.bbox.x0},${w.bbox.y0},${w.bbox.x1},${w.bbox.y1}`);
  }
  fs.writeFileSync('C:/Users/STIVEN/AppData/Local/Temp/opencode/p0-words.txt', rows.join('\n'), 'utf8');
  console.log('words:', data.words.length, '| blocks:', data.blocks.length, '| lines:', data.lines.length);
  await worker.terminate();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
