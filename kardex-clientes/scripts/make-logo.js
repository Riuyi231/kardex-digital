'use strict';
// Genera el logo de NEXUS: un "hub" de nodos conectados (centro brillante con
// enlaces a satélites), sobre degradado índigo oscuro. Uso: npm run logo
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', 'build');

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function dCircle(x, y, cx, cy, r) { return Math.hypot(x - cx, y - cy) - r; }
function dRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - cy) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function dSeg(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay;
  const dx = bx - ax, dy = by - ay;
  const t = clamp01((px * dx + py * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - dx * t, py - dy * t);
}

const TOP = [30, 27, 75];      // #1e1b4b índigo-950
const BOTTOM = [15, 23, 42];   // #0f172a slate-900
const LINE = [103, 232, 249];  // cian claro
const CORE = [56, 189, 248];   // sky-400
const CORE_HOT = [255, 255, 255];

function draw(size) {
  const S = size;
  const img = new PNG({ width: S, height: S });
  const corner = 0.2 * S;
  const cx = 0.5 * S, cy = 0.5 * S;
  const radius = 0.31 * S;
  const nodeR = 0.055 * S;
  const coreR = 0.075 * S;
  const angles = [0, 60, 120, 180, 240, 300].map((a) => (a * Math.PI) / 180);
  const sats = angles.map((a) => [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);

  for (let y = 0; y < S; y++) {
    const t = y / S;
    const bg = [TOP[0] + (BOTTOM[0] - TOP[0]) * t, TOP[1] + (BOTTOM[1] - TOP[1]) * t, TOP[2] + (BOTTOM[2] - TOP[2]) * t];

    for (let x = 0; x < S; x++) {
      const d = dRoundRect(x + 0.5, y + 0.5, 0, 0, S, S, corner);
      const bgA = clamp01(0.5 - d);
      let r = bg[0], g = bg[1], b = bg[2];

      // líneas de conexión centro -> satélites
      for (const [sx, sy] of sats) {
        const dl = dSeg(x + 0.5, y + 0.5, cx, cy, sx, sy);
        const la = clamp01(0.5 - dl) * 0.5;
        r += LINE[0] * la; g += LINE[1] * la; b += LINE[2] * la;
      }

      // resplandor del centro
      const glowD = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const glow = clamp01(1 - glowD / (0.26 * S));
      r += CORE[0] * glow * glow * 0.25;
      g += CORE[1] * glow * glow * 0.25;
      b += CORE[2] * glow * glow * 0.30;

      // nodos satélite (con halo)
      for (const [sx, sy] of sats) {
        const dn = dCircle(x + 0.5, y + 0.5, sx, sy, nodeR);
        const na = clamp01(0.5 - dn);
        const halo = clamp01(1 - Math.hypot(x + 0.5 - sx, y + 0.5 - sy) / (nodeR * 2.6)) * 0.22;
        r += LINE[0] * halo; g += LINE[1] * halo; b += LINE[2] * halo;
        r += CORE[0] * na; g += CORE[1] * na; b += CORE[2] * na;
      }

      // núcleo central (anillo + centro blanco)
      const dc = dCircle(x + 0.5, y + 0.5, cx, cy, coreR);
      const ring = Math.max(dc, -dCircle(x + 0.5, y + 0.5, cx, cy, coreR * 0.42));
      const ringA = clamp01(0.5 - ring) * 0.85;
      const hotA = clamp01(0.5 - dCircle(x + 0.5, y + 0.5, cx, cy, coreR * 0.34)) * 0.9;
      r += CORE[0] * ringA + CORE_HOT[0] * hotA;
      g += CORE[1] * ringA + CORE_HOT[1] * hotA;
      b += CORE[2] * ringA + CORE_HOT[2] * hotA;

      const idx = (S * y + x) << 2;
      img.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      img.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      img.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      img.data[idx + 3] = Math.round(bgA * 255);
    }
  }
  return PNG.sync.write(img);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
fs.mkdirSync(OUT_DIR, { recursive: true });
const images = sizes.map((s) => ({ size: s, data: draw(s) }));
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(images));
fs.writeFileSync(path.join(OUT_DIR, 'logo-256.png'), draw(256));
console.log('Logo NEXUS generado: build/icon.ico + build/logo-256.png');
