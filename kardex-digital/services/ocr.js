const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorker } = require('tesseract.js');

const LANGS = ['spa'];
const LANGS_DIR = path.join(__dirname, '..', 'resources', 'tessdata');

let worker = null;
let working = false;

function tessdataReady() {
  for (const lang of LANGS) {
    const f = path.join(LANGS_DIR, `${lang}.traineddata.gz`);
    const f2 = path.join(LANGS_DIR, `${lang}.traineddata`);
    if (!fs.existsSync(f) && !fs.existsSync(f2)) return false;
  }
  return true;
}

async function ensureWorker() {
  if (worker) return worker;
  if (!tessdataReady()) {
    throw new Error('Faltan los datos de idioma de Tesseract. Ejecute: npm run tessdata');
  }
  worker = await createWorker(LANGS, 1, {
    langPath: LANGS_DIR,
    gzip: true,
    workerPath: path.join(__dirname, '..', 'resources', 'tesseract-worker.js'),
    cachePath: path.join(os.tmpdir(), 'kardex-tess-cache')
  });
  worker.setParameters({
    tessedit_pageseg_mode: '3',
    preserve_interword_spaces: '1'
  });
  return worker;
}

function withTmpFile(bufferOrPath, fn) {
  const isPath = typeof bufferOrPath === 'string';
  let tmpFile = null;
  const target = isPath ? bufferOrPath : (() => {
    tmpFile = path.join(os.tmpdir(), `kardex-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tmpFile, bufferOrPath);
    return tmpFile;
  })();
  return fn(target).finally(() => {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch (e) { /* noop */ }
    }
  });
}

function cleanWords(data) {
  if (!data || !Array.isArray(data.words)) return [];
  return data.words
    .filter((w) => w && w.text && w.text.trim() && w.bbox)
    .map((w) => ({
      text: w.text.trim(),
      conf: Math.round(w.confidence || 0),
      x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1
    }));
}

async function recognize(bufferOrPath) {
  return withTmpFile(bufferOrPath, async (target) => {
    const w = await ensureWorker();
    const { data } = await w.recognize(target);
    return (data && data.text) ? data.text : '';
  });
}

async function recognizeDetailed(bufferOrPath) {
  return withTmpFile(bufferOrPath, async (target) => {
    const w = await ensureWorker();
    const { data } = await w.recognize(target, {}, { blocks: true });
    return {
      text: (data && data.text) ? data.text : '',
      words: cleanWords(data)
    };
  });
}

async function resetWorker() {
  if (worker) {
    try { await worker.terminate(); } catch (e) { /* noop */ }
    worker = null;
  }
}

module.exports = { recognize, recognizeDetailed, ensureWorker, resetWorker, tessdataReady };
