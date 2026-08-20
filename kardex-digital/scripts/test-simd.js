const { Worker, isMainThread, parentPort } = require('worker_threads');

if (isMainThread) {
  const w = new Worker(__filename);
  w.on('message', (m) => { console.log('message:', m); process.exit(0); });
  w.on('error', (e) => { console.error('WORKER ERROR:', e); process.exit(1); });
  w.on('exit', (c) => { console.error('worker exit', c); process.exit(c || 1); });
} else {
  try {
    const { simd } = require('wasm-feature-detect');
    simd().then((v) => parentPort.postMessage('simd=' + v))
      .catch((e) => parentPort.postMessage('simd ERROR: ' + e.stack));
  } catch (e) {
    parentPort.postMessage('require ERROR: ' + e.stack);
  }
}
