const { PNG } = require('pngjs');
const jpegjs = require('jpeg-js');

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(Number(v))));
}

function parseColor(str) {
  if (str == null) return [0, 0, 0, 255];
  const s = String(str).trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return [0, 0, 0, 255];
    if (hex.length === 8) return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  if (s.startsWith('rgb')) {
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m) {
      return [clamp255(m[1]), clamp255(m[2]), clamp255(m[3]), m[4] == null ? 255 : clamp255(parseFloat(m[4]) * 255)];
    }
  }
  return [0, 0, 0, 255];
}

function decodeImage(source) {
  let buf;
  if (Buffer.isBuffer(source)) {
    buf = source;
  } else if (typeof source === 'string' && source.startsWith('data:image/')) {
    const m = source.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!m) throw new Error('Formato de imagen no soportado');
    buf = Buffer.from(m[1], 'base64');
  } else {
    throw new Error('Fuente de imagen no soportada');
  }
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const png = PNG.sync.read(buf);
    return {
      width: png.width,
      height: png.height,
      _data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength)
    };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dec = jpegjs.decode(buf, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
    return {
      width: dec.width,
      height: dec.height,
      _data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.byteLength)
    };
  }
  throw new Error('Formato de imagen no soportado (solo PNG/JPG)');
}

function compositePixel(dst, di, r, g, b, a) {
  const sa = a / 255;
  if (sa <= 0) return;
  const da = dst[di + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  const inv = 1 - sa;
  dst[di] = Math.round((r * sa + dst[di] * da * inv) / oa);
  dst[di + 1] = Math.round((g * sa + dst[di + 1] * da * inv) / oa);
  dst[di + 2] = Math.round((b * sa + dst[di + 2] * da * inv) / oa);
  dst[di + 3] = Math.round(oa * 255);
}

function sample(srcData, srcW, srcH, x, y) {
  x = Math.max(0, Math.min(srcW - 1, Math.round(x)));
  y = Math.max(0, Math.min(srcH - 1, Math.round(y)));
  const i = (y * srcW + x) << 2;
  return [srcData[i], srcData[i + 1], srcData[i + 2], srcData[i + 3]];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---- Glifos 5x7 para render de texto básico ----
// Cada glifo es una cadena de 7 filas de 5 bits ('1'=pixel). Índice por charCode.
const FONT5x7 = {};
function addGlyph(ch, rows) {
  for (let r = 0; r < rows.length; r++) {
    let v = 0;
    for (let c = 0; c < 5; c++) if (rows[r][c] === '1') v |= (1 << (4 - c));
    FONT5x7[ch.charCodeAt(0)] = (FONT5x7[ch.charCodeAt(0)] || 0x0) || (v << (r * 5));
  }
}
FONT5x7[32] = -1; // espacio: usar -1 como "glifo existente de ancho simple"
const defaultGlyphRows = [
  '01110', '10001', '10011', '10101', '11001', '10001', '01110'
];
const GL_Y = defaultGlyphRows;
const nr = GL_Y.length;

class Context2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._canvas = canvas;
    this._fill = [0, 0, 0, 255];
    this._stroke = [0, 0, 0, 255];
    this._lineWidth = 1;
    this._lineCap = 'butt';
    this._lineJoin = 'miter';
    this._miterLimit = 10;
    this._globalAlpha = 1;
    this._globalCompositeOp = 'source-over';
    this._font = '10px sans-serif';
    this._textAlign = 'start';
    this._textBaseline = 'alphabetic';
    this._shadowColor = 'rgba(0,0,0,0)';
    this._shadowBlur = 0;
    this._shadowOffsetX = 0;
    this._shadowOffsetY = 0;
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'low';
    this._path = [];
    this._pathOpen = false;
    this._saved = [];
    // Matriz de transformación actual (CTM): [a, b, c, d, e, f]
    this._ctm = [1, 0, 0, 1, 0, 0];
  }

  // ---------- Transformaciones ----------
  setTransform(a, b, c, d, e, f) { this._ctm = [a, b, c, d, e, f]; }
  resetTransform() { this._ctm = [1, 0, 0, 1, 0, 0]; }
  transform(a, b, c, d, e, f) {
    const [a1, b1, c1, d1, e1, f1] = this._ctm;
    this._ctm = [
      a1 * a + c1 * b,
      b1 * a + d1 * b,
      a1 * c + c1 * d,
      b1 * c + d1 * d,
      a1 * e + c1 * f + e1,
      b1 * e + d1 * f + f1
    ];
  }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.transform(c, s, -s, c, 0, 0);
  }
  getTransform() {
    const m = this._ctm;
    return {
      a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5],
      invertSelf() { return this; }, multiplySelf() { return this; },
      translateSelf() { return this; }, scaleSelf() { return this; }, rotateSelf() { return this; }
    };
  }

  _xf(x, y) {
    const [a, b, c, d, e, f] = this._ctm;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  // transforma una lista de [x,y] y devuelve puntos transformados
  _xfPts(pts) {
    return pts.map(([x, y]) => this._xf(x, y));
  }

  // ---------- Estilos y estado ----------
  set fillStyle(v) { this._fill = parseColor(v); }
  get fillStyle() { return this._fill; }
  set strokeStyle(v) { this._stroke = parseColor(v); }
  get strokeStyle() { return this._stroke; }
  set lineWidth(v) { this._lineWidth = v; }
  get lineWidth() { return this._lineWidth; }
  set lineCap(v) { this._lineCap = v; }
  get lineCap() { return this._lineCap; }
  set lineJoin(v) { this._lineJoin = v; }
  get lineJoin() { return this._lineJoin; }
  set miterLimit(v) { this._miterLimit = v; }
  get miterLimit() { return this._miterLimit; }
  set globalAlpha(v) { this._globalAlpha = v; }
  get globalAlpha() { return this._globalAlpha; }
  set globalCompositeOperation(v) { this._globalCompositeOp = v; }
  get globalCompositeOperation() { return this._globalCompositeOp; }
  set font(v) { this._font = v; }
  get font() { return this._font; }
  set textAlign(v) { this._textAlign = v; }
  get textAlign() { return this._textAlign; }
  set textBaseline(v) { this._textBaseline = v; }
  get textBaseline() { return this._textBaseline; }
  set shadowColor(v) { this._shadowColor = v; }
  get shadowColor() { return this._shadowColor; }
  set shadowBlur(v) { this._shadowBlur = v; }
  get shadowBlur() { return this._shadowBlur; }
  set shadowOffsetX(v) { this._shadowOffsetX = v; }
  get shadowOffsetX() { return this._shadowOffsetX; }
  set shadowOffsetY(v) { this._shadowOffsetY = v; }
  get shadowOffsetY() { return this._shadowOffsetY; }

  // ---------- Relleno de polígono (cualquier polígono convexo en pixeles destino) ----------
  _pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  _fillPolyPx(pts, color) {
    if (pts.length < 3) return;
    const out = this._canvas._data;
    const W = this._canvas.width;
    const H = this._canvas.height;
    if (!out) return;
    const [r, g, b, a] = color;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    const poly = [];
    for (const p of pts) {
      const x = p[0], y = p[1];
      poly.push([x, y]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    minX = Math.max(0, Math.floor(minX));
    maxX = Math.min(W - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(H - 1, Math.ceil(maxY));
    if (maxX < minX || maxY < minY) return;
    const N = 3;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let inside = 0;
        for (let sy = 0; sy < N; sy++) {
          const yy = py + (sy + 0.5) / N;
          for (let sx = 0; sx < N; sx++) {
            const xx = px + (sx + 0.5) / N;
            if (this._pointInPoly(xx, yy, poly)) inside++;
          }
        }
        if (inside === 0) continue;
        const cov = inside / (N * N);
        const na = Math.round(a * cov);
        if (na <= 0) continue;
        compositePixel(out, (py * W + px) << 2, r, g, b, na);
      }
    }
  }

  // ---------- fillRect / clearRect transformados ----------
  fillRect(x, y, w, h) {
    const pts = this._xfPts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    this._fillPolyPx(pts, this._fill);
  }

  clearRect(x, y, w, h) {
    const out = this._canvas._data;
    const W = this._canvas.width;
    const H = this._canvas.height;
    if (!out) return;
    const pts = this._xfPts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    let minY = H, maxY = 0;
    for (const p of pts) { minY = Math.min(minY, Math.floor(p[1])); maxY = Math.max(maxY, Math.ceil(p[1])); }
    minY = Math.max(0, minY);
    maxY = Math.min(H - 1, maxY);
    for (let py = minY; py <= maxY; py++) {
      const ints = [];
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const p = pts[i], q = pts[j];
        if ((p[1] <= py && q[1] > py) || (q[1] <= py && p[1] > py)) {
          const t = (py - p[1]) / (q[1] - p[1]);
          ints.push(p[0] + t * (q[0] - p[0]));
        }
      }
      ints.sort((a2, b2) => a2 - b2);
      for (let i = 0; i + 1 < ints.length; i += 2) {
        const x0 = Math.max(0, Math.floor(ints[i]));
        const x1 = Math.min(W - 1, Math.ceil(ints[i + 1]));
        for (let x = x0; x <= x1; x++) {
          const di = (py * W + x) << 2;
          out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0;
        }
      }
    }
  }

  // ---------- drawImage transformado (mapeo por cuadrilátero) ----------
  drawImage(src, ...args) {
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    const out = this._canvas._data;
    if (!src || !src._data) return;
    const srcData = src._data;
    const srcW = src.width;
    const srcH = src.height;

    let sx = 0, sy = 0, sw = srcW, sh = srcH, dx, dy, dw, dh;
    if (args.length === 2) { [dx, dy] = args; dw = srcW; dh = srcH; }
    else if (args.length === 4) { [dx, dy, dw, dh] = args; }
    else if (args.length === 8) { [sx, sy, sw, sh, dx, dy, dw, dh] = args; }
    else throw new Error('drawImage: número de argumentos no soportado');
    sw = Math.min(sw, srcW - sx);
    sh = Math.min(sh, srcH - sy);
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

    // Cuadrilátero destino transformado (esquina y tres vértices)
    const p0 = this._xf(dx, dy);
    const p1 = this._xf(dx + dw, dy);
    const p2 = this._xf(dx + dw, dy + dh);
    const p3 = this._xf(dx, dy + dh);

    let minX = Math.min(p0[0], p1[0], p2[0], p3[0]);
    let maxX = Math.max(p0[0], p1[0], p2[0], p3[0]);
    let minY = Math.min(p0[1], p1[1], p2[1], p3[1]);
    let maxY = Math.max(p0[1], p1[1], p2[1], p3[1]);
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(outW - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(outH - 1, Math.ceil(maxY));

    const smooth = this.imageSmoothingEnabled && this.imageSmoothingQuality !== 'low';
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        // Coordenada en el espacio local del rect fuente vía mapeo afín del cuadrilátero.
        // Bajo transformaciones afines (escala/rotación/traslación) el destino es un
        // paralelogramo: P(u,v) = p0 + u*(p1-p0) + v*(p3-p0). Resolvemos (u,v) exactamente.
        const Ux = p1[0] - p0[0], Uy = p1[1] - p0[1];
        const Vx = p3[0] - p0[0], Vy = p3[1] - p0[1];
        const det = Ux * Vy - Uy * Vx;
        if (Math.abs(det) < 1e-9) continue;
        const pu0 = px - p0[0], pv0 = py - p0[1];
        const u = (pu0 * Vy - pv0 * Vx) / det;
        const v = (Ux * pv0 - Uy * pu0) / det;
        this._drawImagePixel(srcData, srcW, srcH, sx, sy, sw, sh, u, v, smooth, out, outW, px, py);
      }
    }
  }

  _drawImagePixel(srcData, srcW, srcH, sx, sy, sw, sh, u, v, smooth, out, outW, px, py) {
    if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) return;
    const gx = sx + u * sw;
    const gy = sy + v * sh;
    let r, g, b, a;
    if (smooth && gx >= 0 && gy >= 0 && gx < srcW - 1 && gy < srcH - 1) {
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const c00 = sample(srcData, srcW, srcH, x0, y0);
      const c10 = sample(srcData, srcW, srcH, x0 + 1, y0);
      const c01 = sample(srcData, srcW, srcH, x0, y0 + 1);
      const c11 = sample(srcData, srcW, srcH, x0 + 1, y0 + 1);
      r = lerp(lerp(c00[0], c10[0], fx), lerp(c01[0], c11[0], fx), fy);
      g = lerp(lerp(c00[1], c10[1], fx), lerp(c01[1], c11[1], fx), fy);
      b = lerp(lerp(c00[2], c10[2], fx), lerp(c01[2], c11[2], fx), fy);
      a = lerp(lerp(c00[3], c10[3], fx), lerp(c01[3], c11[3], fx), fy);
    } else {
      const c = sample(srcData, srcW, srcH, gx, gy);
      r = c[0]; g = c[1]; b = c[2]; a = c[3];
    }
    compositePixel(out, (py * outW + px) << 2, Math.round(r), Math.round(g), Math.round(b), Math.round(a));
  }

  // ---------- getImageData / putImageData (píxeles, sin transformar) ----------
  getImageData(x, y, w, h) {
    const out = this._canvas._data;
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    const X = Math.floor(x), Y = Math.floor(y);
    const W = Math.max(0, Math.floor(w)), H = Math.max(0, Math.floor(h));
    const data = new Uint8ClampedArray(W * H * 4);
    if (out && W > 0 && H > 0) {
      for (let py = 0; py < H; py++) {
        const srcY = Y + py;
        if (srcY < 0 || srcY >= outH) continue;
        for (let px = 0; px < W; px++) {
          const srcX = X + px;
          if (srcX < 0 || srcX >= outW) continue;
          const si = (srcY * outW + srcX) << 2;
          const di = (py * W + px) << 2;
          data[di] = out[si];
          data[di + 1] = out[si + 1];
          data[di + 2] = out[si + 2];
          data[di + 3] = out[si + 3];
        }
      }
    }
    return { data, width: W, height: H };
  }

  createImageData(w, h) {
    if (typeof w === 'object' && w !== null && w.width != null && w.height != null) {
      return { data: new Uint8ClampedArray(w.width * w.height * 4), width: w.width, height: w.height };
    }
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }

  putImageData(imageData, dx, dy) {
    const out = this._canvas._data;
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    if (!out || !imageData || !imageData.data) return;
    const src = imageData.data;
    const sw = imageData.width, sh = imageData.height;
    for (let py = 0; py < sh; py++) {
      const dstY = Math.floor(dy) + py;
      if (dstY < 0 || dstY >= outH) continue;
      for (let px = 0; px < sw; px++) {
        const dstX = Math.floor(dx) + px;
        if (dstX < 0 || dstX >= outW) continue;
        const si = (py * sw + px) << 2;
        const di = (dstY * outW + dstX) << 2;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
  }

  save() {
    this._saved.push({
      _fill: this._fill.slice(), _stroke: this._stroke.slice(),
      _lineWidth: this._lineWidth, _globalAlpha: this._globalAlpha,
      _font: this._font, _textAlign: this._textAlign, _textBaseline: this._textBaseline,
      _ctm: this._ctm.slice(), _path: this._path.slice(), _pathOpen: this._pathOpen
    });
  }

  restore() {
    if (!this._saved.length) return;
    const s = this._saved.pop();
    this._fill = s._fill; this._stroke = s._stroke;
    this._lineWidth = s._lineWidth; this._globalAlpha = s._globalAlpha;
    this._font = s._font; this._textAlign = s._textAlign; this._textBaseline = s._textBaseline;
    this._ctm = s._ctm; this._path = s._path; this._pathOpen = s._pathOpen;
  }

  // ---------- Paths ----------
  beginPath() { this._path = []; this._pathOpen = true; }
  closePath() { this._pathOpen = false; }
  moveTo(x, y) { this._path.push({ op: 'M', x, y }); }
  lineTo(x, y) { this._path.push({ op: 'L', x, y }); }
  arc(x, y, r, start, end, ccw) { this._path.push({ op: 'A', x, y, r, start, end, ccw }); }
  arcTo(x1, y1, x2, y2, r) { this._path.push({ op: 'AT', x1, y1, x2, y2, r }); }
  quadraticCurveTo(cpx, cpy, x, y) { this._path.push({ op: 'Q', cpx, cpy, x, y }); }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) { this._path.push({ op: 'C', cp1x, cp1y, cp2x, cp2y, x, y }); }
  rect(x, y, w, h) { this._path.push({ op: 'R', x, y, w, h }); }

  _flattenOps() {
    const flat = [];
    for (const p of this._path) {
      if (p.op === 'M' || p.op === 'L') flat.push(this._xf(p.x, p.y));
      else if (p.op === 'R') {
        const pts = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        for (const pt of pts) flat.push(this._xf(pt[0], pt[1]));
      } else if (p.op === 'A') {
        // aproximar arco por polilínea
        const steps = 24;
        let se = p.start, ee = p.end;
        if (p.ccw) { while (ee > se) ee -= 2 * Math.PI; }
        else { while (ee < se) ee += 2 * Math.PI; }
        for (let i = 0; i <= steps; i++) {
          const t = se + (ee - se) * (i / steps);
          flat.push(this._xf(p.x + p.r * Math.cos(t), p.y + p.r * Math.sin(t)));
        }
      } else if (p.op === 'AT') {
        // arcTo aproximado como segmento recto hacia el punto final (suficiente para casos simples)
        flat.push(this._xf(p.x2, p.y2));
      } else if (p.op === 'Q') {
        const x0 = flat.length ? flat[flat.length - 1][0] : 0, y0 = flat.length ? flat[flat.length - 1][1] : 0;
        const steps = 24;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const it = 1 - t;
          const bx = it * it * x0 + 2 * it * t * p.cpx + t * t * p.x;
          const by = it * it * y0 + 2 * it * t * p.cpy + t * t * p.y;
          flat.push([bx, by]);
        }
      } else if (p.op === 'C') {
        const x0 = flat.length ? flat[flat.length - 1][0] : 0, y0 = flat.length ? flat[flat.length - 1][1] : 0;
        const steps = 24;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, it = 1 - t;
          const bx = it * it * it * x0 + 3 * it * it * t * p.cp1x + 3 * it * t * t * p.cp2x + t * t * t * p.x;
          const by = it * it * it * y0 + 3 * it * it * t * p.cp1y + 3 * it * t * t * p.cp2y + t * t * t * p.y;
          flat.push([bx, by]);
        }
      }
    }
    return flat;
  }

  _rasterizePath(fill, stroke) {
    const pts = this._flattenOps();
    if (pts.length < 2) return;
    if (fill) this._fillPolyPx(pts, this._fill);
    if (stroke) this._strokePolyPx(pts, this._stroke, this._lineWidth);
  }

  _strokePolyPx(pts, color, width) {
    for (let i = 0; i < pts.length - 1; i++) {
      this._drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color, width);
    }
  }

  _drawLine(x0, y0, x1, y1, color, width) {
    const out = this._canvas._data;
    const W = this._canvas.width, H = this._canvas.height;
    if (!out) return;
    const [r, g, b, a] = color;
    const hw = Math.max(0.05, width / 2);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const rLen = Math.max(1, len);
    // vector normal unitario
    const nx = -dy / rLen, ny = dx / rLen;
    const steps = Math.max(1, Math.ceil(len * 0.8));
    // tramo: rectángulo a lo largo de la línea (puntos transformados ya vienen en px)
    const nw = Math.ceil(hw);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + dx * t, cy = y0 + dy * t;
      for (let oy = -nw; oy <= nw; oy++) {
        for (let ox = -nw; ox <= nw; ox++) {
          // distancia de (ox,oy) al eje de la línea
          const perp = ox * nx + oy * ny;   // componente a lo largo del eje de la línea (ignorado)
          const norm = oy * nx - ox * ny;   // componente perpendicular → distancia al eje
          void perp;
          if (Math.abs(norm) > hw + 0.5) continue;
          const px = Math.round(cx + ox), py = Math.round(cy + oy);
          if (px >= 0 && px < W && py >= 0 && py < H) compositePixel(out, (py * W + px) << 2, r, g, b, a);
        }
      }
    }
  }

  fill() { this._rasterizePath(true, false); }
  stroke() { this._rasterizePath(false, true); }
  fillAndStroke() { this._rasterizePath(true, true); }

  clip() { /* stub simplificado */ }

  // ---------- Texto ----------
  _parseFontSize() {
    const m = String(this._font).match(/(\d+(?:\.\d+)?)\s*px/);
    return m ? parseFloat(m[1]) : 10;
  }

  measureText(text) {
    const size = this._parseFontSize();
    const w = String(text || '').split('').reduce((a, ch) => a + (ch === ' ' ? 3 : 5), 0) * (size / 8);
    return { width: w };
  }

  fillText(text, x, y) {
    this._renderText(text, x, y, true);
  }

  strokeText(text, x, y) {
    this._renderText(text, x, y, false);
  }

  _renderText(text, x, y, useFill) {
    const out = this._canvas._data;
    const W = this._canvas.width, H = this._canvas.height;
    if (!out) return;
    const size = this._parseFontSize();
    const color = useFill ? this._fill : this._stroke;
    const scale = size / 8.0;
    const cell = Math.max(0.5, scale * 0.55);
    const hw = cell / 2;
    let cursorX = x;
    const advance = 6 * scale;
    const baseline = y; // aprox
    for (const ch of String(text || '')) {
      if (ch === ' ') { cursorX += advance; continue; }
      const glyph = FONT5x7[ch.charCodeAt(0)];
      let rows;
      if (glyph === undefined) rows = GL_Y; // glifo por defecto
      else if (glyph === -1) { cursorX += advance; continue; }
      else {
        rows = [];
        for (let r = 0; r < 7; r++) {
          const v = (glyph >> (r * 5)) & 0x1f;
          let s = '';
          for (let c = 4; c >= 0; c--) s += (v >> c) & 1 ? '1' : '0';
          rows.push(s);
        }
      }
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < 5; c++) {
          if (rows[r][c] !== '1') continue;
          const cx = cursorX + c * scale + hw;
          const cy = baseline - (rows.length - 1 - r) * scale - hw;
          const p00 = this._xf(cx - hw, cy - hw);
          const p11 = this._xf(cx + hw, cy + hw);
          const minX = Math.max(0, Math.floor(Math.min(p00[0], p11[0])));
          const maxX = Math.min(W - 1, Math.ceil(Math.max(p00[0], p11[0])));
          const minY = Math.max(0, Math.floor(Math.min(p00[1], p11[1])));
          const maxY = Math.min(H - 1, Math.ceil(Math.max(p00[1], p11[1])));
          for (let py = minY; py <= maxY; py++) {
            for (let px = minX; px <= maxX; px++) {
              compositePixel(out, (py * W + px) << 2, color[0], color[1], color[2], color[3]);
            }
          }
        }
      }
      cursorX += advance;
    }
  }

  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
}

function bezierPoint(p0, p1, p2, t) { const it = 1 - t; return it * it * p0 + 2 * it * t * p1 + t * t * p2; }

// ---- Definir glifos 5x7 básicos (uso interno de _renderText) ----
const G = (chars, defs) => {
  for (let i = 0; i < chars.length; i++) FONT5x7[chars.charCodeAt(i)] = packGlyph(defs[i]);
};
function packGlyph(rows) {
  let val = 0;
  for (let r = 0; r < rows.length; r++) {
    let v = 0;
    for (let c = 0; c < 5; c++) if (rows[r][c] === '1') v |= (1 << (4 - c));
    val |= (v << (r * 5));
  }
  return val;
}
const R = (r0, r1, r2, r3, r4, r5, r6) => [r0, r1, r2, r3, r4, r5, r6];
G('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', [
  R('01110','10001','10011','10101','11001','10001','01110'), /* A */
  R('11110','10001','10001','11110','10001','10001','11110'), /* B */
  R('01110','10001','10000','10000','10000','10001','01110'), /* C */
  R('11110','10001','10001','10001','10001','10001','11110'), /* D */
  R('11111','10000','10000','11110','10000','10000','11111'), /* E */
  R('11111','10000','10000','11110','10000','10000','10000'), /* F */
  R('01110','10001','10000','10111','10001','10001','01111'), /* G */
  R('10001','10001','10001','11111','10001','10001','10001'), /* H */
  R('01110','00100','00100','00100','00100','00100','01110'), /* I */
  R('00111','00010','00010','00010','00010','10010','01100'), /* J */
  R('10001','10010','10100','11000','10100','10010','10001'), /* K */
  R('10000','10000','10000','10000','10000','10000','11111'), /* L */
  R('10001','11011','10101','10101','10001','10001','10001'), /* M */
  R('10001','11001','10101','10011','10001','10001','10001'), /* N */
  R('01110','10001','10001','10001','10001','10001','01110'), /* O */
  R('11110','10001','10001','11110','10000','10000','10000'), /* P */
  R('01110','10001','10001','10001','10101','10010','01101'), /* Q */
  R('11110','10001','10001','11110','10100','10010','10001'), /* R */
  R('01111','10000','10000','01110','00001','00001','11110'), /* S */
  R('11111','00100','00100','00100','00100','00100','00100'), /* T */
  R('10001','10001','10001','10001','10001','10001','01110'), /* U */
  R('10001','10001','10001','10001','10001','01010','00100'), /* V */
  R('10001','10001','10001','10101','10101','11011','10001'), /* W */
  R('10001','10001','01010','00100','01010','10001','10001'), /* X */
  R('10001','10001','01010','00100','00100','00100','00100'), /* Y */
  R('11111','00001','00010','00100','01000','10000','11111'), /* Z */
  R('01110','10001','10011','10101','11001','10001','01110'), /* 0 */
  R('00100','01100','00100','00100','00100','00100','01110'), /* 1 */
  R('01110','10001','00001','00110','01000','10000','11111'), /* 2 */
  R('11110','00001','00001','01110','00001','00001','11110'), /* 3 */
  R('00010','00110','01010','10010','11111','00010','00010'), /* 4 */
  R('11111','10000','11110','00001','00001','10001','01110'), /* 5 */
  R('00110','01000','10000','11110','10001','10001','01110'), /* 6 */
  R('11111','00001','00010','00100','01000','01000','01000'), /* 7 */
  R('01110','10001','10001','01110','10001','10001','01110'), /* 8 */
  R('01110','10001','10001','01111','00001','00010','01100')  /* 9 */
]);

function encodePng(canvas) {
  return PNG.sync.write({
    width: canvas.width,
    height: canvas.height,
    data: Buffer.from(canvas._data.buffer, canvas._data.byteOffset, canvas._data.byteLength)
  });
}

function encodeJpeg(canvas, opts) {
  const quality = opts && opts.quality != null ? Number(opts.quality) : 90;
  const out = jpegjs.encode({
    data: Buffer.from(canvas._data.buffer, canvas._data.byteOffset, canvas._data.byteLength),
    width: canvas.width,
    height: canvas.height
  }, quality);
  return Buffer.from(out.data);
}

function createCanvas(w, h) {
  const state = { width: 0, height: 0, data: null };
  const canvas = {};

  function realloc() {
    const size = state.width * state.height * 4;
    if (!state.data || state.data.length !== size) {
      state.data = new Uint8ClampedArray(size);
    }
  }

  Object.defineProperties(canvas, {
    width: {
      get: () => state.width,
      set: (v) => { state.width = Math.max(0, Math.floor(Number(v) || 0)); realloc(); }
    },
    height: {
      get: () => state.height,
      set: (v) => { state.height = Math.max(0, Math.floor(Number(v) || 0)); realloc(); }
    },
    _data: { get: () => state.data },
    _w: { get: () => state.width },
    _h: { get: () => state.height }
  });

  canvas.width = w;
  canvas.height = h;

  canvas.getContext = (type) => {
    if (type !== '2d') return null;
    if (!state.ctx) state.ctx = new Context2D(canvas);
    return state.ctx;
  };

  canvas.toBuffer = (mime, opts) => {
    if (mime === 'image/png' || mime === 'png') return encodePng(canvas);
    if (mime === 'image/jpeg' || mime === 'jpeg' || mime === 'jpg') return encodeJpeg(canvas, opts);
    throw new Error('Formato de salida no soportado: ' + mime);
  };

  canvas.toDataURL = (mime) => {
    const buf = mime === 'image/jpeg' ? encodeJpeg(canvas) : encodePng(canvas);
    return `data:${mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'};base64,${buf.toString('base64')}`;
  };

  return canvas;
}

async function loadImage(source) {
  return decodeImage(source);
}

module.exports = { createCanvas, loadImage };
