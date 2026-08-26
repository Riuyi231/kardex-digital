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
  x = Math.max(0, Math.min(srcW - 1, x));
  y = Math.max(0, Math.min(srcH - 1, y));
  const i = (y * srcW + x) << 2;
  return [srcData[i], srcData[i + 1], srcData[i + 2], srcData[i + 3]];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

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
  }

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

  fillRect(x, y, w, h) {
    const out = this._canvas._data;
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    if (!out) return;
    const [r, g, b, a] = this._fill;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(outW, Math.floor(x + w));
    const y1 = Math.min(outH, Math.floor(y + h));
    for (let py = Math.max(0, y0); py < y1; py++) {
      for (let px = Math.max(0, x0); px < x1; px++) {
        compositePixel(out, (py * outW + px) << 2, r, g, b, a);
      }
    }
  }

  clearRect(x, y, w, h) {
    const out = this._canvas._data;
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    if (!out) return;
    const x1 = Math.min(outW, Math.floor(x + w));
    const y1 = Math.min(outH, Math.floor(y + h));
    for (let py = Math.max(0, Math.floor(y)); py < y1; py++) {
      for (let px = Math.max(0, Math.floor(x)); px < x1; px++) {
        const di = (py * outW + px) << 2;
        out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0;
      }
    }
  }

  drawImage(src, ...args) {
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    const out = this._canvas._data;
    if (!src || !src._data) return;
    const srcData = src._data;
    const srcW = src.width;
    const srcH = src.height;

    let sx = 0, sy = 0, sw = srcW, sh = srcH, dx, dy, dw, dh;
    if (args.length === 2) {
      [dx, dy] = args;
      dw = srcW; dh = srcH;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new Error('drawImage: número de argumentos no soportado');
    }
    sw = Math.min(sw, srcW - sx);
    sh = Math.min(sh, srcH - sy);
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

    const rx = sw / dw;
    const ry = sh / dh;
    const smooth = this.imageSmoothingEnabled && this.imageSmoothingQuality !== 'low';
    const dX0 = Math.floor(dx);
    const dY0 = Math.floor(dy);
    const dX1 = Math.min(outW, Math.ceil(dx + dw));
    const dY1 = Math.min(outH, Math.ceil(dy + dh));

    for (let py = Math.max(0, dY0); py < dY1; py++) {
      const gy = (py - dy + 0.5) * ry - 0.5 + sy;
      for (let px = Math.max(0, dX0); px < dX1; px++) {
        const gx = (px - dx + 0.5) * rx - 0.5 + sx;
        const di = (py * outW + px) << 2;
        let r, g, b, a;
        if (smooth && gx >= 0 && gy >= 0 && gx < srcW - 1 && gy < srcH - 1) {
          const x0 = Math.floor(gx);
          const y0 = Math.floor(gy);
          const fx = gx - x0;
          const fy = gy - y0;
          const c00 = sample(srcData, srcW, srcH, x0, y0);
          const c10 = sample(srcData, srcW, srcH, x0 + 1, y0);
          const c01 = sample(srcData, srcW, srcH, x0, y0 + 1);
          const c11 = sample(srcData, srcW, srcH, x0 + 1, y0 + 1);
          r = lerp(lerp(c00[0], c10[0], fx), lerp(c01[0], c11[0], fx), fy);
          g = lerp(lerp(c00[1], c10[1], fx), lerp(c01[1], c11[1], fx), fy);
          b = lerp(lerp(c00[2], c10[2], fx), lerp(c01[2], c11[2], fx), fy);
          a = lerp(lerp(c00[3], c10[3], fx), lerp(c01[3], c11[3], fx), fy);
        } else {
          const c = sample(srcData, srcW, srcH, Math.round(gx), Math.round(gy));
          r = c[0]; g = c[1]; b = c[2]; a = c[3];
        }
        compositePixel(out, di, Math.round(r), Math.round(g), Math.round(b), Math.round(a));
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = this._canvas._data;
    const outW = this._canvas.width;
    const outH = this._canvas.height;
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const W = Math.max(0, Math.floor(w));
    const H = Math.max(0, Math.floor(h));
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
    const sw = imageData.width;
    const sh = imageData.height;
    for (let py = 0; py < sh; py++) {
      const dstY = Math.floor(dy) + py;
      if (dstY < 0 || dstY >= outH) continue;
      for (let px = 0; px < sw; px++) {
        const dstX = Math.floor(dx) + px;
        if (dstX < 0 || dstX >= outW) continue;
        const si = (py * sw + px) << 2;
        const di = (dstY * outW + dstX) << 2;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
  }

  save() {
    this._saved.push({
      _fill: this._fill.slice(),
      _stroke: this._stroke.slice(),
      _lineWidth: this._lineWidth,
      _globalAlpha: this._globalAlpha,
      _font: this._font,
      _textAlign: this._textAlign,
      _textBaseline: this._textBaseline,
      _path: this._path.slice(),
      _pathOpen: this._pathOpen
    });
  }

  restore() {
    if (!this._saved.length) return;
    const s = this._saved.pop();
    this._fill = s._fill;
    this._stroke = s._stroke;
    this._lineWidth = s._lineWidth;
    this._globalAlpha = s._globalAlpha;
    this._font = s._font;
    this._textAlign = s._textAlign;
    this._textBaseline = s._textBaseline;
    this._path = s._path;
    this._pathOpen = s._pathOpen;
  }

  beginPath() { this._path = []; this._pathOpen = true; }
  closePath() { this._pathOpen = false; }
  moveTo(x, y) { this._path.push({ op: 'M', x, y }); }
  lineTo(x, y) { this._path.push({ op: 'L', x, y }); }
  arc(x, y, r, start, end, ccw) { this._path.push({ op: 'A', x, y, r, start, end, ccw }); }
  arcTo(x1, y1, x2, y2, r) { this._path.push({ op: 'AT', x1, y1, x2, y2, r }); }
  quadraticCurveTo(cpx, cpy, x, y) { this._path.push({ op: 'Q', cpx, cpy, x, y }); }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) { this._path.push({ op: 'C', cp1x, cp1y, cp2x, cp2y, x, y }); }
  rect(x, y, w, h) { this._path.push({ op: 'R', x, y, w, h }); }

  _rasterizePath(fill, stroke) {
    const pts = this._path;
    if (!pts.length) return;
    const flatten = [];
    for (const p of pts) {
      if (p.op === 'M' || p.op === 'L') flatten.push({ x: p.x, y: p.y });
      else if (p.op === 'R') {
        flatten.push({ x: p.x, y: p.y });
        flatten.push({ x: p.x + p.w, y: p.y });
        flatten.push({ x: p.x + p.w, y: p.y + p.h });
        flatten.push({ x: p.x, y: p.y + p.h });
      }
    }
    if (flatten.length < 2) return;
    if (fill) this._fillPoly(flatten);
    if (stroke) this._strokePoly(flatten);
  }

  _fillPoly(pts) {
    if (pts.length < 3) return;
    const out = this._canvas._data;
    const W = this._canvas.width;
    const H = this._canvas.height;
    if (!out) return;
    const [r, g, b, a] = this._fill;
    let minY = H, maxY = 0;
    for (const p of pts) { minY = Math.min(minY, Math.floor(p.y)); maxY = Math.max(maxY, Math.ceil(p.y)); }
    minY = Math.max(0, minY);
    maxY = Math.min(H - 1, maxY);
    for (let y = minY; y <= maxY; y++) {
      const intersections = [];
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const a2 = pts[i], b2 = pts[j];
        if ((a2.y <= y && b2.y > y) || (b2.y <= y && a2.y > y)) {
          const t = (y - a2.y) / (b2.y - a2.y);
          intersections.push(a2.x + t * (b2.x - a2.x));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const x0 = Math.max(0, Math.floor(intersections[i]));
        const x1 = Math.min(W - 1, Math.ceil(intersections[i + 1]));
        for (let x = x0; x <= x1; x++) {
          compositePixel(out, (y * W + x) << 2, r, g, b, a);
        }
      }
    }
  }

  _strokePoly(pts) {
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this._drawLine(pts[i].x, pts[i].y, pts[j].x, pts[j].y, this._stroke, this._lineWidth);
    }
  }

  _drawLine(x0, y0, x1, y1, color, width) {
    const out = this._canvas._data;
    const W = this._canvas.width;
    const H = this._canvas.height;
    if (!out) return;
    const [r, g, b, a] = color;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = Math.round(x0), cy = Math.round(y0);
    const hw = Math.floor(width / 2);
    for (let step = 0; step < 100000; step++) {
      for (let ox = -hw; ox <= hw; ox++) {
        for (let oy = -hw; oy <= hw; oy++) {
          const px = cx + ox, py = cy + oy;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            compositePixel(out, (py * W + px) << 2, r, g, b, a);
          }
        }
      }
      if (cx === Math.round(x1) && cy === Math.round(y1)) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
  }

  fill() { this._rasterizePath(true, false); }
  stroke() { this._rasterizePath(false, true); }
  fillAndStroke() { this._rasterizePath(true, true); }

  clip() { /* clipping path stub — pdfjs-dist calls this but we skip for simplicity */ }

  fillText(text, x, y) { /* stub — not needed for PDF rendering */ }
  strokeText(text, x, y) { /* stub */ }
  measureText(text) { return { width: (text || '').length * 6 }; }

  translate(x, y) { /* stub */ }
  rotate(angle) { /* stub */ }
  scale(x, y) { /* stub */ }
  setTransform(a, b, c, d, e, f) { /* stub */ }
  transform(a, b, c, d, e, f) { /* stub */ }
  resetTransform() { /* stub */ }
  getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, invertSelf() { return this; }, multiplySelf() { return this; }, translateSelf() { return this; }, scaleSelf() { return this; }, rotateSelf() { return this; } }; }

  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }

  isPointInPath() { return false; }
  isPointInStroke() { return false; }
}

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
