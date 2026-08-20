const fs = require('fs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { recognize } = require('../services/ocr');

const OUT = 'C:/Users/STIVEN/AppData/Local/Temp/opencode';
const src = fs.readFileSync('C:/Users/STIVEN/AppData/Local/Temp/opencode/roberto-p0.png');

async function proc(buf, scale, gray, contrast) {
  const img = await loadImage(buf);
  const c = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (gray || contrast) {
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      hist[g]++;
    }
    let lo = 0, hi = 255, acc = 0;
    const total = d.length / 4;
    for (let g = 0; g < 256; g++) { acc += hist[g]; if (acc >= total * 0.01) { lo = g; break; } }
    acc = 0;
    for (let g = 255; g >= 0; g--) { acc += hist[g]; if (acc >= total * 0.01) { hi = g; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      let n = ((g - lo) / span) * 255;
      n = Math.max(0, Math.min(255, n));
      d[i] = d[i + 1] = d[i + 2] = n;
    }
    ctx.putImageData(id, 0, 0);
  }
  return c.toBuffer('image/png');
}

async function main() {
  const variants = [
    ['2x-gray', 2, true, false],
    ['2x', 2, false, false],
    ['1.5x-gray', 1.5, true, false],
    ['1.5x', 1.5, false, false]
  ];
  for (const [name, scale, gray] of variants) {
    const png = await proc(src, scale, gray);
    const t1 = await recognize(png);
    const t2 = await recognize(png);
    fs.writeFileSync(`${OUT}/var-${name}.txt`, t1, 'utf8');
    const lines = t1.split('\n').filter(Boolean).length;
    const same = t1 === t2;
    console.log(`${name}: ${png.length}b lines=${lines} deterministic=${same}`);
    const keys = ['NOMBRE', 'APELLIDO', 'NACIONALIDAD', 'FECHA', 'LUGAR', 'OCUPACION', 'SEXO', 'ESTADO', 'NUMERO', 'DOMINGO', 'TECNICO', '2042', '1971'];
    const upper = t1.toUpperCase();
    for (const k of keys) if (!upper.includes(k)) console.log(`   MISSING: ${k}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
