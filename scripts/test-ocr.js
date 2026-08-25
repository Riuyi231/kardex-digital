const path = require('path');
const { createWorker } = require('tesseract.js');

(async () => {
  try {
    const worker = await createWorker('spa', 1, {
      langPath: path.join(__dirname, '..', 'resources', 'tessdata'),
      gzip: true,
      cachePath: path.join(process.env.TEMP || '/tmp', 'kardex-tess-cache')
    });
    console.log('Worker OK');
    const { data } = await worker.recognize(path.join(__dirname, '..', 'test', 'no-existe.png'));
    console.log(data.text);
    await worker.terminate();
  } catch (e) {
    console.error('ERROR COMPLETO:', e);
    process.exit(1);
  }
})();
