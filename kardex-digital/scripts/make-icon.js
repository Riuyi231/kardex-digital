const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLogo(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const S = size;

  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2563eb');
  g.addColorStop(1, '#0e7490');
  ctx.fillStyle = g;
  rr(ctx, 0, 0, S, S, S * 0.19);
  ctx.fill();

  const hl = ctx.createRadialGradient(S * 0.28, S * 0.22, 0, S * 0.28, S * 0.22, S * 0.9);
  hl.addColorStop(0, 'rgba(255,255,255,0.22)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  rr(ctx, 0, 0, S, S, S * 0.19);
  ctx.fill();

  const u = S / 1024;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 168 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(400 * u, 242 * u);
  ctx.lineTo(400 * u, 782 * u);
  ctx.moveTo(436 * u, 502 * u);
  ctx.lineTo(696 * u, 248 * u);
  ctx.moveTo(436 * u, 522 * u);
  ctx.lineTo(696 * u, 782 * u);
  ctx.stroke();

  return c.toBuffer('image/png');
}

function writeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = Buffer.alloc(16 * pngs.length);
  let offset = 6 + 16 * pngs.length;
  pngs.forEach((p, i) => {
    const size = p.size === 256 ? 0 : p.size;
    const e = i * 16;
    entries.writeUInt8(size, e);
    entries.writeUInt8(size, e + 1);
    entries.writeUInt8(0, e + 2);
    entries.writeUInt8(0, e + 3);
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(p.buf.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += p.buf.length;
  });

  const body = Buffer.concat(pngs.map((p) => p.buf));
  return Buffer.concat([header, entries, body]);
}

fs.mkdirSync(BUILD, { recursive: true });

const pngs = SIZES.map((s) => ({ size: s, buf: drawLogo(s) }));
const big = drawLogo(1024);
fs.writeFileSync(path.join(BUILD, 'icon.png'), big);
fs.writeFileSync(path.join(BUILD, 'icon.ico'), writeIco(pngs));
fs.writeFileSync(path.join(ROOT, 'renderer', 'logo.png'), pngs.find((p) => p.size === 256).buf);
fs.writeFileSync(path.join(ROOT, 'resources', 'icon.ico'), fs.readFileSync(path.join(BUILD, 'icon.ico')));

console.log('Icono generado: build/icon.ico (' + SIZES.map((s) => s + 'px').join(', ') + ')');
console.log('Logo UI: renderer/logo.png');
console.log('Icono ventana: resources/icon.ico');
console.log('build/icon.png (1024)');
