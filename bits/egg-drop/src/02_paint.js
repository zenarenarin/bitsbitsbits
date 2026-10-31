// Gouache painting kit: ragged opaque shapes, brush strokes with bristle
// marks, soft washes and paper grain, all baked once into offscreen
// canvases. Nothing here runs per frame except the light pass on the egg.

const PAL = {
  butter: '#f1d27a', butter2: '#e9c262', ivory: '#f5ead2', ivory2: '#ecdcb8',
  orange: '#c8622c', orange2: '#a94c22', vermilion: '#d63e2a', mustard: '#c79c36',
  olive: '#6c7140', olive2: '#545a31', burgundy: '#6a1f2b', burgundy2: '#4d1520',
  brass: '#b88f3a', brass2: '#8c6a26', brassHi: '#e8c870', umber: '#3b2417', umber2: '#5a3a24'
};

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); }
function shade(h, amt) { const [r, g, b] = hexRgb(h); return amt >= 0 ? rgbHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt) : rgbHex(r * (1 + amt), g * (1 + amt), b * (1 + amt)); }
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }

// Offscreen paint buffers. OffscreenCanvas where the WebView has it;
// otherwise a hidden runtime-made canvas (set by the game at init).
let canvasFallback = null;
function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = canvasFallback();
  c.width = w; c.height = h;
  return c;
}

// polygon through pts with each vertex nudged: imperfect painted edges
function raggedPath(g, pts, amp, rnd, closed) {
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = p.x + (rnd() - 0.5) * amp, y = p.y + (rnd() - 0.5) * amp;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  if (closed !== false) g.closePath();
}

// densify a polygon so the ragged edge has detail along long sides
function densify(pts, step, closed) {
  const out = [];
  const n = closed === false ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
  }
  if (closed === false) out.push(pts[pts.length - 1]);
  return out;
}

function rectPts(x, y, w, h) { return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; }
function roundRectPts(x, y, w, h, r, seg) {
  seg = seg || 5; const pts = [];
  const corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return pts;
}
function ellipsePts(cx, cy, rx, ry, n) { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }); } return pts; }

// a single brush stroke: a ribbon whose width swells and tapers, with a few
// bristle lines dragged through it
function brush(g, rnd, x0, y0, x1, y1, w, col, a, bristles) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const n = Math.max(4, Math.min(14, Math.ceil(len / (w * 0.8))));
  const top = [], bot = [];
  const bow = (rnd() - 0.5) * w * 0.8;
  for (let i = 0; i <= n; i++) {
    const u = i / n, taper = Math.pow(Math.sin(Math.PI * Math.min(0.98, Math.max(0.02, u))), 0.45);
    const cx = x0 + dx * u + nx * bow * Math.sin(Math.PI * u), cy = y0 + dy * u + ny * bow * Math.sin(Math.PI * u);
    const hw = w * 0.5 * taper * (0.8 + rnd() * 0.35);
    top.push({ x: cx + nx * hw, y: cy + ny * hw });
    bot.push({ x: cx - nx * hw * (0.85 + rnd() * 0.3), y: cy - ny * hw * (0.85 + rnd() * 0.3) });
  }
  g.fillStyle = typeof col === 'string' && col[0] === '#' ? rgba(col, a) : col;
  g.beginPath();
  g.moveTo(top[0].x, top[0].y);
  for (const p of top) g.lineTo(p.x, p.y);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i].x, bot[i].y);
  g.closePath();
  g.fill();
  const nb = bristles == null ? 3 : bristles;
  if (nb > 0 && typeof col === 'string' && col[0] === '#') {
    g.lineCap = 'round';
    for (let b = 0; b < nb; b++) {
      const off = (rnd() - 0.5) * w * 0.7;
      g.strokeStyle = rgba(rnd() < 0.5 ? shade(col, -0.18) : shade(col, 0.16), a * 0.55);
      g.lineWidth = w * (0.05 + rnd() * 0.07);
      g.beginPath();
      const s0 = rnd() * 0.25, s1 = 0.7 + rnd() * 0.3;
      for (let i = 0; i <= 6; i++) {
        const u = s0 + (s1 - s0) * i / 6;
        const x = x0 + dx * u + nx * (off + bow * Math.sin(Math.PI * u)), y = y0 + dy * u + ny * (off + bow * Math.sin(Math.PI * u));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

// fill the current clip with strokes along an angle, in tones around a base
function strokeFill(g, rnd, box, base, opt) {
  const ang = opt.angle || 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const w = opt.width, count = opt.count || 60, spread = opt.spread == null ? 0.12 : opt.spread;
  for (let i = 0; i < count; i++) {
    const cx = box.x + rnd() * box.w, cy = box.y + rnd() * box.h;
    const L = opt.length * (0.6 + rnd() * 0.8);
    const tone = (rnd() - 0.5) * 2 * spread;
    brush(g, rnd, cx - ca * L / 2, cy - sa * L / 2, cx + ca * L / 2, cy + sa * L / 2, w * (0.6 + rnd() * 0.7), shade(base, tone), opt.alpha || 0.5, opt.bristles);
  }
}

// opaque painted shape: base coat, brushed body, dry edge
function paintShape(g, rnd, pts, base, opt) {
  opt = opt || {};
  const box = bbox(pts);
  const amp = opt.amp == null ? Math.min(box.w, box.h) * 0.02 : opt.amp;
  const dense = densify(pts, opt.step || Math.max(box.w, box.h) / 40);
  g.save();
  raggedPath(g, dense, amp, rnd);
  g.fillStyle = base;
  g.fill();
  g.clip();
  strokeFill(g, rnd, { x: box.x - box.w * 0.1, y: box.y - box.h * 0.1, w: box.w * 1.2, h: box.h * 1.2 }, base, {
    angle: opt.angle || 0, width: opt.brushW || Math.min(box.w, box.h) * 0.25, length: opt.brushL || Math.max(box.w, box.h) * 0.35,
    count: opt.count || 40, alpha: opt.alpha || 0.45, spread: opt.spread
  });
  if (opt.inner) opt.inner(g, box);
  g.restore();
  if (opt.edge) {
    g.save();
    g.strokeStyle = opt.edge; g.lineWidth = opt.edgeW || Math.min(box.w, box.h) * 0.04; g.lineJoin = 'round';
    g.globalAlpha = opt.edgeA == null ? 0.75 : opt.edgeA;
    raggedPath(g, dense, amp * 0.8, rnd);
    g.stroke();
    g.restore();
  }
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// soft, uneven wash: several overlapping ragged blobs at low alpha
function wash(g, rnd, cx, cy, r, col, a, n) {
  n = n || 6;
  for (let i = 0; i < n; i++) {
    const pts = [];
    const ox = (rnd() - 0.5) * r * 0.5, oy = (rnd() - 0.5) * r * 0.5, rr = r * (0.6 + rnd() * 0.5);
    const m = 18;
    for (let j = 0; j < m; j++) { const ang = j / m * Math.PI * 2; const q = rr * (0.8 + rnd() * 0.35); pts.push({ x: cx + ox + Math.cos(ang) * q, y: cy + oy + Math.sin(ang) * q }); }
    g.fillStyle = rgba(col, a / n * 2);
    raggedPath(g, pts, rr * 0.08, rnd);
    g.fill();
  }
}

// paper grain and pigment granulation baked into a canvas's pixels
function grain(c, amount, rnd, fibre) {
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  let img;
  try { img = g.getImageData(0, 0, w, h); } catch (e) { return; }
  const d = img.data;
  // low-frequency value noise lattice for granulation patches
  const cell = Math.max(6, Math.round(Math.min(w, h) / 60));
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd() - 0.5;
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = fy | 0, ty = fy - iy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const fx = x / cell, ix = fx | 0, tx = fx - ix;
      const a = lat[iy * gw + ix], b = lat[iy * gw + ix + 1], c2 = lat[(iy + 1) * gw + ix], e = lat[(iy + 1) * gw + ix + 1];
      const low = (a + (b - a) * tx) * (1 - ty) + (c2 + (e - c2) * tx) * ty;
      const n = (rnd() - 0.5) * amount * 255 + low * amount * 140;
      d[i] += n; d[i + 1] += n * 0.96; d[i + 2] += n * 0.9;
    }
  }
  g.putImageData(img, 0, 0);
  if (fibre) {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < (w * h) / 2600; i++) {
      const x = rnd() * w, y = rnd() * h, L = 3 + rnd() * 12, a = rnd() * Math.PI;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(255,248,230,0.07)' : 'rgba(60,36,20,0.05)';
      g.lineWidth = 0.6 + rnd() * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    g.restore();
  }
}
