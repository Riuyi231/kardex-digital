const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorker } = require('tesseract.js');

const LANGS = ['spa'];
const LANGS_DIR = path.join(__dirname, '..', 'resources', 'tessdata');

// Pool acotado de workers: permite OCR en paralelo de frente+reverso sin
// saturar la CPU. Ajustable por entorno para máquinas débiles o potentes.
const POOL_SIZE = Math.max(1, Number(process.env.KARDEX_OCR_POOL) || 2);

const pool = [];      // workers creados (en uso o libres)
const idle = [];      // workers listos para tomar trabajo
const waiters = [];   // llamadas esperando por un worker libre
let creating = 0;     // trabajadores en creación concurrente

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

async function createTessWorker() {
  if (!tessdataReady()) {
    throw new Error('Faltan los datos de idioma de Tesseract. Ejecute: npm run tessdata');
  }
  const created = await withTimeout(
    createWorker(LANGS, 1, {
      langPath: LANGS_DIR,
      gzip: fs.existsSync(path.join(LANGS_DIR, `${LANGS[0]}.traineddata.gz`)),
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
  return created;
}

// Obtiene un worker: reutiliza uno libre, crea si no se llegó al tope, o espera
// a que alguien libere. Nunca crea más de POOL_SIZE trabajadores.
async function ensureWorker() {
  if (idle.length) return idle.pop();
  if (pool.length + creating < POOL_SIZE) {
    creating++;
    try {
      const w = await createTessWorker();
      pool.push(w);
      return w;
    } catch (e) {
      // Si la creación falla, no dejemos esperando a los que ya están en cola.
      while (waiters.length) waiters.shift().reject(e);
      throw e;
    } finally {
      creating--;
    }
  }
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

function releaseWorker(w) {
  const next = waiters.shift();
  if (next) next.resolve(w);
  else idle.push(w);
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

const BASE_PARAMS = {
  tessedit_pageseg_mode: '3',
  preserve_interword_spaces: '1'
};

// Restaura los parámetros globales y, sobre todo, DESACTIVA whitelist/blacklist
// que hayan quedado de una pasada dirigida. Si no se vacían, un whitelist previo
// se filtra a los OCR siguientes y degrada (o vacía) el texto.
function buildParams(opts = {}, restore = false) {
  const p = { ...BASE_PARAMS };
  if (opts.psm) p.tessedit_pageseg_mode = String(opts.psm);
  if (restore) {
    p.tessedit_char_whitelist = '';
    p.tessedit_char_blacklist = '';
    return p;
  }
  if (opts.whitelist) p.tessedit_char_whitelist = opts.whitelist;
  if (opts.blacklist) p.tessedit_char_blacklist = opts.blacklist;
  return p;
}

async function applyParams(w, params) {
  await withTimeout(w.setParameters(params), 10000, 'setparams');
}

async function recognize(bufferOrPath, opts = {}) {
  return withTmpFile(bufferOrPath, async (target) => {
    const w = await ensureWorker();
    try {
      await applyParams(w, buildParams(opts));
      const { data } = await withTimeout(w.recognize(target), 30000, 'recognize');
      return (data && data.text) ? data.text : '';
    } finally {
      await applyParams(w, buildParams({}, true)).catch(() => {});
      releaseWorker(w);
    }
  });
}

async function recognizeDetailed(bufferOrPath, opts = {}, recognizeOpts = {}) {
  return withTmpFile(bufferOrPath, async (target) => {
    const w = await ensureWorker();
    try {
      await applyParams(w, buildParams(opts));
      const { data } = await withTimeout(w.recognize(target, {}, { blocks: true, ...recognizeOpts }), 30000, 'recognize-detailed');
      return {
        text: (data && data.text) ? data.text : '',
        words: cleanWords(data)
      };
    } finally {
      await applyParams(w, buildParams({}, true)).catch(() => {});
      releaseWorker(w);
    }
  });
}

async function resetWorker() {
  const ws = pool.splice(0);
  idle.length = 0;
  while (waiters.length) waiters.shift().reject(new Error('OCR_RESET'));
  for (const w of ws) {
    try { await w.terminate(); } catch (e) { /* noop */ }
  }
}

module.exports = { recognize, recognizeDetailed, ensureWorker, resetWorker, tessdataReady };