const { loadImage, createCanvas } = require('../services/canvas');

async function analyze(pathLabel, buffer) {
  const img = await loadImage(buffer);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let nonWhite = 0;
  let nonBlack = 0;
  let minL = 255, maxL = 0;
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[l]++;
    if (l < 245) nonWhite++;
    if (l > 10) nonBlack++;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  const total = data.length / 4;
  const dark = hist.slice(0, 80).reduce((a, b) => a + b, 0);
  console.log(`== ${pathLabel} (${img.width}x${img.height}) ==`);
  console.log(`  nonWhite=${nonWhite} (${(100 * nonWhite / total).toFixed(1)}%)  nonBlack=${nonBlack} (${(100 * nonBlack / total).toFixed(1)}%)`);
  console.log(`  lumRange=[${minL},${maxL}]  darkPix(<80)=${dark} (${(100 * dark / total).toFixed(2)}%)`);
  console.log(`  uniqueColors=${new Set([...data].slice(0, 40000)).size}`);
}

async function main() {
  const fs = require('fs');
  if (fs.existsSync('test/pg0.png')) await analyze('pg0', fs.readFileSync('test/pg0.png'));
  if (fs.existsSync('test/pg1.png')) await analyze('pg1', fs.readFileSync('test/pg1.png'));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
