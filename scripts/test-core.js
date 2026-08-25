const { Worker, isMainThread, parentPort } = require('worker_threads');

if (isMainThread) {
  const w = new Worker(__filename);
  w.on('message', (m) => { console.log('message:', m); process.exit(0); });
  w.on('error', (e) => { console.error('WORKER ERROR:', e); process.exit(1); });
} else {
  try {
    const core = require('tesseract.js-core/tesseract-core-simd-lstm');
    parentPort.postMessage('core OK, keys=' + Object.keys(core).slice(0, 8).join(','));
  } catch (e) {
    parentPort.postMessage('core ERROR: ' + e.stack);
  }
}
