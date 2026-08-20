const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist');
const { createCanvas } = require('@napi-rs/canvas');
const { NodeCanvasFactory } = require('../services/pdf');
const { decodeFromImageDataBuffer } = require('../services/barcode');

(async () => {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'test', 'cedula-prueba.pdf'))),
    canvasFactory: new NodeCanvasFactory(),
    standardFontDataUrl: path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
  }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(5, Math.max(2.2, 1500 / vp1.width));
  const vp = page.getViewport({ scale });
  const factory = new NodeCanvasFactory();
  const { canvas, context } = factory.create(vp.width, vp.height);
  await page.render({ canvasContext: context, viewport: vp, canvasFactory: factory }).promise;
  const W = canvas.width, H = canvas.height;

  fs.writeFileSync(path.join(__dirname, '..', 'test', 'front-new.png'), canvas.toBuffer('image/png'));

  const id = context.getImageData(0, 0, W, H);
  const lum = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < id.data.length; i += 4, j++) {
    lum[j] = (0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2]) | 0;
  }
  const rowTrans = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let prev = lum[y * W];
    for (let x = 1; x < W; x++) {
      const v = lum[y * W + x];
      if ((v < 128) !== (prev < 128)) rowTrans[y]++;
      prev = v;
    }
  }
  // bandas de 20 filas
  let bestStart = 0, bestScore = 0;
  const band = 20;
  for (let y = 0; y + band <= H; y++) {
    let s = 0;
    for (let k = 0; k < band; k++) s += rowTrans[y + k];
    if (s > bestScore) { bestScore = s; bestStart = y; }
  }
  console.log('mejor banda de', band, 'filas: y', bestStart, '-', bestStart + band, 'score', bestScore);
  console.log('transiciones en y 430..800 (cada 20):');
  for (let y = 430; y < 810; y += 20) {
    console.log(' y', y, ':', rowTrans[y]);
  }
  // intentar decode de las mejores bandas
  for (const [y0, y1] of [[439, 774], [bestStart, bestStart + 160], [300, 800]]) {
    const h = y1 - y0;
    const crop = new Uint8ClampedArray(W * h);
    for (let y = 0; y < h; y++) crop.set(lum.subarray((y0 + y) * W, (y0 + y) * W + W), y * W);
    console.log('decode band y', y0, '-', y1, ':', decodeFromImageDataBuffer(W, h, crop));
  }
  process.exit(0);
})();
