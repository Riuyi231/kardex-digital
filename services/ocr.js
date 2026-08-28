const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorker } = require('tesseract.js');

const LANGS = ['spa'];
const LANGS_DIR = path.join(__dirname, '..', 'resources', 'tessdata');

let worker = null;
let working = false;

// Hard cap so a hung worker (e.g. WASM threads unavailable on 32-bit Windows)
// never blocks the renderer forever. On timeout we throw a controlled error
// that the caller turns into a fallback (instead of an infinite spinner).
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`OCR_TIMEOUT:${label || 'op'}:${ms}ms`));
    }, ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
  try {
    const created = await withTimeout(
      createWorker(LANGS, 1, {
        langPath: LANGS_DIR,
        gzip: true,
        workerPath: path.join(__dirname, '..', 'resources', 'tesseract-worker.js'),
        cachePath: path.join(os.tmpdir(), 'kardex-tess-cache')
      }),
      20000,
      'worker-init'
    );
    await withTimeout(created.setParameters({
      tessedit_pageseg_mode: '3',
      preserve_interword_spaces: '1'
    }), 10000, 'worker-setparams');
    worker = created;
    return worker;
  } catch (e) {
    // Worker could not start (common on 32-bit Windows when WASM threading is
    // unavailable). Leave worker=null so future calls can retry, and surface
    // a controlled error instead of hanging forever.
    if (worker) {
      try { await worker.terminate(); } catch (e2) { /* noop */ }
      worker = null;
    }
    throw e;
  }
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
    const { data } = await withTimeout(w.recognize(target), 30000, 'recognize');
    return (data && data.text) ? data.text : '';
  });
}

async function recognizeDetailed(bufferOrPath) {
  return withTmpFile(bufferOrPath, async (target) => {
    const w = await ensureWorker();
    const { data } = await withTimeout(w.recognize(target, {}, { blocks: true }), 30000, 'recognize-detailed');
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
