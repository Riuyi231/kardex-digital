const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist');
const { createCanvas } = require('@napi-rs/canvas');
const { decodeFromImageDataBuffer } = require('../services/barcode');
const { NodeCanvasFactory } = require('../services/pdf');
const { normalizeCedulaNumber } = require('../services/barcode');

function NodeCanvasFactoryWithData() {
  let current = null;
  return {
    create(w, h) {
      const canvas = createCanvas(w, h);
      current = { canvas, context: canvas.getContext('2d') };
      return current;
    },
    reset(cc, w, h) {
      cc.canvas.width = w;
      cc.canvas.height = h;
    },
    destroy(cc) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    },
    getCurrent() {
      return current;
    }
  };
}

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
  const factory = new NodeCanvasFactoryWithData();
  const { canvas, context } = factory.create(vp.width, vp.height);
  await page.render({ canvasContext: context, viewport: vp, canvasFactory: factory }).promise;

  const id = context.getImageData(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  console.log('dimensiones:', W, 'x', H);

  const decFull = decodeFromImageDataBuffer(W, H, id.data);
  console.log('decode full image:', decFull);

  // banda
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
  let maxY = 0;
  for (let y = 1; y < H; y++) if (rowTrans[y] > rowTrans[maxY]) maxY = y;
  console.log('fila max transiciones:', maxY, '=', rowTrans[maxY]);

  for (const half of [60, 100, 160]) {
    const y0 = Math.max(0, maxY - half);
    const y1 = Math.min(H, maxY + half);
    const h = y1 - y0;
    const crop = new Uint8ClampedArray(W * h);
    for (let y = 0; y < h; y++) crop.set(lum.subarray((y0 + y) * W, (y0 + y) * W + W), y * W);
    const d = decodeFromImageDataBuffer(W, h, crop);
    console.log(`banda +/-${half} (y ${y0}-${y1}):`, d);
  }
  process.exit(0);
})();
