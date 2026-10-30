// HOLLOW HARVEST — a pixel-art Halloween survival arcade for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_core.js ----
// =====================================================================
// Core: maths, the restricted palette, pixel primitives, bitmap fonts.
// Everything is drawn with integer fillRects onto a low-resolution
// buffer, so there is no anti-aliasing anywhere in the picture.
// =====================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

function hash(n) {
  n = (n | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
const hash2 = (a, b) => hash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------- palette ----------
// Four stages of one sunset. Every colour in the field comes from these
// tables; between stages the tables are mixed in coarse steps.
const STAGE_NAMES = ['THE HARVEST', 'THE WITHERING', 'THE HAUNTED FIELDS', 'THE HOLLOW'];
const STAGE_AT = [120, 260, 420];
const STAGES = [
  { sky0: '#c58a94', sky1: '#e2a197', sky2: '#efb592', sky3: '#f4cd8f', sun: '#f2b06a', sunRim: '#f6cd8c',
    cloud: '#eab1a4', cloudLit: '#f6d2bd', cloudDark: '#d18f8f', hillFar: '#d99a8c', hillNear: '#b86a6c', sil: '#4b2a2c',
    distCorn: '#c63a4a', distCornLit: '#e2605c', midCorn: '#a52a3e', midCornLit: '#d04850',
    backStalk: '#3e3a24', backLeaf: '#7a2236', backLeafLit: '#b83c48', tassel: '#e8a86c',
    ground: '#4a2a22', groundLit: '#6e3f2e', groundDark: '#2e1b18',
    frontDark: '#1a1b12', frontLeaf: '#2d3320', frontLeafLit: '#4c5a3c',
    pumpkin: '#d77c45', pumpkinDark: '#9b4a2c', pumpkinLit: '#efa866', wood: '#6b4a36', woodDark: '#3a2620',
    crea: '#3c3423', creaDark: '#27211a', creaLit: '#5e4e36' },
  { sky0: '#9a5e70', sky1: '#c27c82', sky2: '#dc9a88', sky3: '#ebbb8c', sun: '#de8c56', sunRim: '#eaa874',
    cloud: '#c98c8a', cloudLit: '#e6b2a2', cloudDark: '#a2646e', hillFar: '#a86a6c', hillNear: '#844252', sil: '#3a1c26',
    distCorn: '#a02c40', distCornLit: '#c24a50', midCorn: '#84223a', midCornLit: '#ac3a46',
    backStalk: '#33301e', backLeaf: '#5e1a2c', backLeafLit: '#90303e', tassel: '#cc8c5c',
    ground: '#3c221e', groundLit: '#5a3328', groundDark: '#251614',
    frontDark: '#151610', frontLeaf: '#252a1b', frontLeafLit: '#3e4a32',
    pumpkin: '#c96e3c', pumpkinDark: '#8e4228', pumpkinLit: '#e39a5e', wood: '#5c4030', woodDark: '#32201c',
    crea: '#30291d', creaDark: '#201b15', creaLit: '#4e412e' },
  { sky0: '#5e3448', sky1: '#844a5a', sky2: '#a8606a', sky3: '#c47e74', sun: '#b05a48', sunRim: '#c2705a',
    cloud: '#7a4452', cloudLit: '#a0605e', cloudDark: '#5a2e40', hillFar: '#74404c', hillNear: '#542636', sil: '#2a121c',
    distCorn: '#741c32', distCornLit: '#943040', midCorn: '#5a1428', midCornLit: '#7c2434',
    backStalk: '#262418', backLeaf: '#44101e', backLeafLit: '#662030', tassel: '#9a6448',
    ground: '#2e1a18', groundLit: '#462820', groundDark: '#1c100e',
    frontDark: '#111209', frontLeaf: '#1c2014', frontLeafLit: '#2e3826',
    pumpkin: '#b55e32', pumpkinDark: '#783624', pumpkinLit: '#d48850', wood: '#4a3226', woodDark: '#281816',
    crea: '#241f16', creaDark: '#171410', creaLit: '#3e3324' },
  { sky0: '#2e1a26', sky1: '#46222e', sky2: '#5e2a34', sky3: '#7a3a3a', sun: '#8a3a30', sunRim: '#9a4a3a',
    cloud: '#3e1e2a', cloudLit: '#5a2a34', cloudDark: '#2a141e', hillFar: '#44202c', hillNear: '#2e141e', sil: '#180a10',
    distCorn: '#46101e', distCornLit: '#601828', midCorn: '#340c18', midCornLit: '#4c1422',
    backStalk: '#1a1910', backLeaf: '#2a0a14', backLeafLit: '#42121e', tassel: '#6e4030',
    ground: '#22120f', groundLit: '#341c16', groundDark: '#140a09',
    frontDark: '#0c0d08', frontLeaf: '#14170e', frontLeafLit: '#222a1a',
    pumpkin: '#b85a2c', pumpkinDark: '#6e2e1c', pumpkinLit: '#d88048', wood: '#3a2620', woodDark: '#1e1210',
    crea: '#191510', creaDark: '#0f0d0a', creaLit: '#2e2619' }
];
// colours that stay fixed through the whole run
const FIX = {
  ink: '#16120f', glow: '#ffd88a', glowHot: '#fff1b8', ember: '#e88a4a', cream: '#f6e2b6', blood: '#3a0d14',
  bloodHi: '#5e1622', green: '#55603f', greenDark: '#38402b'
};

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return rgbHex(Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t)));
}
const palCache = {};
// stageF runs 0..3. The blend is quantised to sixths so colours change in
// visible, deliberate steps instead of a continuous gradient.
function paletteAt(stageF) {
  const i = Math.min(2, Math.floor(stageF)), t = Math.round((stageF - i) * 6) / 6;
  const key = i + ':' + t;
  if (palCache[key]) return palCache[key];
  const a = STAGES[i], b = STAGES[i + 1], p = { key };
  for (const k in a) p[k] = t <= 0 ? a[k] : t >= 1 ? b[k] : mixHex(a[k], b[k], t);
  return (palCache[key] = p);
}
function stageAt(dist) {
  let f = 0;
  for (const s of STAGE_AT) f += clamp((dist - s) / 70, 0, 1);
  return f;
}

// ---------- pixel primitives ----------
let G = null, curFill = '';
function setTarget(g) { G = g; curFill = ''; }
function R(x, y, w, h, c) { if (c !== curFill) { G.fillStyle = c; curFill = c; } G.fillRect(x, y, w, h); }
function line(x0, y0, x1, y1, c, t) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  t = t || 1; const o = t >> 1;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    R(x0 - o, y0 - o, t, t, c);
    if ((x0 === x1 && y0 === y1) || ++n > 600) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// filled ellipse; rimC (optional) paints the leftmost pixel of every row (the sun side)
function ellipse(cx, cy, rx, ry, c, rimC) {
  cx = Math.round(cx); cy = Math.round(cy);
  const ryi = Math.max(0, Math.round(ry)), rr = (ryi + 0.5) * (ryi + 0.5);
  for (let y = -ryi; y <= ryi; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / rr)));
    R(cx - w, cy + y, w * 2 + 1, 1, c);
    if (rimC) R(cx - w, cy + y, 1, 1, rimC);
  }
}
const _xs = [];
function poly(pts, c, dither) {
  let minY = 1e9, maxY = -1e9;
  for (let i = 1; i < pts.length; i += 2) { if (pts[i] < minY) minY = pts[i]; if (pts[i] > maxY) maxY = pts[i]; }
  minY = Math.round(minY); maxY = Math.round(maxY);
  const n = pts.length / 2;
  for (let y = minY; y < maxY; y++) {
    const yc = y + 0.5; _xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
      if ((yi > yc) !== (yj > yc)) _xs.push(xi + (yc - yi) * (xj - xi) / (yj - yi));
    }
    _xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < _xs.length; k += 2) {
      const a = Math.round(_xs[k]), b = Math.round(_xs[k + 1]);
      if (b <= a) continue;
      if (!dither) R(a, y, b - a, 1, c);
      else for (let x = a + ((a + y) & 1); x < b; x += 2) R(x, y, 1, 1, c);
    }
  }
}

// Sprite maps: rows of characters, '.' is transparent. Compiled once into
// horizontal runs so a sprite costs a handful of fillRects.
function compileMap(rows) {
  return rows.map(row => {
    const runs = []; let i = 0;
    while (i < row.length) {
      const ch = row[i];
      if (ch === '.') { i++; continue; }
      let j = i; while (j < row.length && row[j] === ch) j++;
      runs.push(i, j - i, ch); i = j;
    }
    return runs;
  });
}
function drawMap(map, x, y, cols, rowShift, rowSkip) {
  let yy = y;
  for (let r = 0; r < map.length; r++) {
    if (rowSkip && rowSkip(r)) continue;
    const runs = map[r], dx = rowShift ? rowShift(r) : 0;
    for (let k = 0; k < runs.length; k += 3) R(x + runs[k] + dx, yy, runs[k + 1], 1, cols[runs[k + 2]]);
    yy++;
  }
}

// ---------- bitmap fonts ----------
// 5x7 for words that matter, 3x5 for labels. Each row is a bitmask, leftmost pixel = high bit.
const F5 = { w: 5, h: 7, sp: 3, g: {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
  '-': [0, 0, 0, 14, 0, 0, 0], ',': [0, 0, 0, 0, 12, 4, 8], "'": [4, 4, 8, 0, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16],
  '>': [8, 4, 2, 1, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2]
} };
const F3 = { w: 3, h: 5, sp: 2, g: {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [6, 1, 2, 4, 7], 3: [6, 1, 2, 1, 6], 4: [5, 5, 7, 1, 1], 5: [7, 4, 6, 1, 6],
  6: [3, 4, 7, 5, 7], 7: [7, 1, 1, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 6],
  '.': [0, 0, 0, 0, 2], ':': [0, 2, 0, 2, 0], '-': [0, 0, 7, 0, 0], '!': [2, 2, 2, 0, 2], '/': [1, 1, 2, 4, 4],
  "'": [2, 2, 0, 0, 0], ',': [0, 0, 0, 2, 4], '?': [6, 1, 2, 0, 2], '>': [4, 2, 1, 2, 4]
} };
// M, N and W cannot be read at three pixels wide; they get five
F3.wide = { M: [17, 27, 21, 17, 17], N: [17, 25, 21, 19, 17], W: [17, 17, 21, 27, 17] };
function glyph(f, ch) { return f.wide && f.wide[ch] ? [f.wide[ch], 5] : f.g[ch] ? [f.g[ch], f.w] : null; }
function textW(s, f, sc) {
  f = f || F5; sc = sc || 1; let w = 0;
  for (const ch of s) { const gl = glyph(f, ch); w += (gl ? gl[1] + 1 : f.sp) * sc; }
  return Math.max(0, w - sc);
}
function text(s, x, y, c, f, sc, shadow) {
  f = f || F5; sc = sc || 1; x = Math.round(x); y = Math.round(y);
  if (shadow) text(s, x + sc, y + sc, shadow, f, sc);
  let cx = x;
  for (const ch of s) {
    const gg = glyph(f, ch);
    if (gg) {
      const gl = gg[0], gw = gg[1];
      for (let r = 0; r < f.h; r++) {
        const row = gl[r]; if (!row) continue;
        let c0 = -1;
        for (let col = 0; col <= gw; col++) {
          const on = col < gw && (row >> (gw - 1 - col)) & 1;
          if (on && c0 < 0) c0 = col;
          else if (!on && c0 >= 0) { R(cx + c0 * sc, y + r * sc, (col - c0) * sc, sc, c); c0 = -1; }
        }
      }
      cx += (gw + 1) * sc;
    } else cx += f.sp * sc;
  }
  return cx - x;
}
function textC(s, cx, y, c, f, sc, shadow) { return text(s, Math.round(cx - textW(s, f, sc) / 2), y, c, f, sc, shadow); }

// ---- 01_world.js ----
// =====================================================================
// The endless field: sections assembled from reusable templates.
// World units are metres along the path; PPM pixels per metre on the
// gameplay plane.
// =====================================================================
const PPM = 8;
// what each obstacle asks of the player
//   low  : run to vault it, walk to step over, winded = trip
//   hole : run to leap it, anything slower falls in
//   snag : wire or tines at chest height, walk to duck under, running snags
const SECTION_TEMPLATES = [
  { id: 'harvest', min: 0, w: 3, L: 46, items: [['low', 12, 'pumpkin'], ['hide', 27, 1]], props: [['scarecrow', 18], ['pumpkins', 6]] },
  { id: 'rows', min: 0, w: 2, L: 48, items: [['hide', 8, 0.8], ['low', 22, 'root'], ['low', 34, 'board']], props: [['fence', 14], ['fence', 26]] },
  { id: 'patch', min: 0, w: 2, L: 46, items: [['low', 9, 'pumpkin'], ['low', 18, 'pumpkin'], ['hide', 30, 1]], props: [['pumpkins', 4], ['pumpkins', 16], ['lantern', 24]] },
  { id: 'refuge', min: 0, w: 1, L: 46, items: [['hide', 10, 1.2], ['low', 24, 'root'], ['hide', 34, 0.7]], props: [['scarecrow', 28]] },
  { id: 'hollows', min: 0.06, w: 3, L: 46, items: [['hole', 11, 1.8], ['low', 23, 'board'], ['hide', 33, 1]], props: [['cart', 18]] },
  { id: 'wire', min: 0.16, w: 3, L: 48, items: [['snag', 12, 'wire'], ['hide', 26, 1], ['low', 39, 'pumpkin']], props: [['fence', 8], ['post', 30]] },
  { id: 'machinery', min: 0.3, w: 2, L: 50, items: [['snag', 10, 'harrow'], ['hole', 22, 2.0], ['hide', 35, 0.9]], props: [['cart', 4], ['lantern', 30]] },
  { id: 'scarecrows', min: 0.2, w: 2, L: 48, items: [['low', 10, 'root'], ['hole', 20, 1.7], ['hide', 32, 0.9]], props: [['scarecrow', 6], ['scarecrow', 16], ['scarecrow', 26]] },
  { id: 'gauntlet', min: 0.55, w: 2, L: 56, items: [['hole', 8, 1.9], ['low', 16, 'board'], ['snag', 25, 'wire'], ['hole', 34, 2.2], ['hide', 45, 0.8]], props: [['post', 20]] }
];

function createWorld(seed) {
  const W = { feats: [], props: [], genX: 0, rng: makeRng(seed), last: '', sections: 0, pool: [] };
  const take = () => W.pool.pop() || {};
  function add(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.feats.push(f); return f; }
  function prop(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.props.push(f); return f; }
  let lastObs = -99;
  // never let the field run longer than a breath without somewhere to hide
  const hideLimit = d => lerp(40, 50, d);
  function obstacle(kind, x, v, d) {
    if (x < lastObs + 6) x = lastObs + 6;
    if (x - W.lastHide > hideLimit(d)) { hide(Math.max(lastObs + 3, W.lastHide + hideLimit(d) * 0.55), 0.8, d); x = Math.max(x, lastObs + 6); }
    let w;
    if (kind === 'hole') w = clamp(v * lerp(0.9, 1.15, d) * (0.92 + W.rng() * 0.16), 1.4, 2.6);
    else if (kind === 'snag') w = v === 'harrow' ? 1.6 : 1.3;
    else w = v === 'pumpkin' ? 0.9 : v === 'root' ? 1.1 : 1.3;
    add({ k: kind, v: kind === 'hole' ? 'pit' : v, x0: x, x1: x + w, done: false });
    lastObs = x + w;
    return x + w;
  }
  function hide(x, scale, d) {
    const len = lerp(6.2, 3.4, d) * scale * (0.88 + W.rng() * 0.24);
    if (x - W.lastHide > hideLimit(d)) x = W.lastHide + hideLimit(d) * 0.8;
    if (x < lastObs + 2.5) x = lastObs + 2.5;
    add({ k: 'hide', x0: x, x1: x + Math.max(2.4, len), rustle: 0 });
    W.lastHide = x + Math.max(2.4, len);
    lastObs = x + len - 3.5; // obstacles may follow a hiding place closely, but never inside it
  }
  function decor(kind, x) {
    if (kind === 'pumpkins') {
      const n = 2 + ((W.rng() * 3) | 0);
      for (let i = 0; i < n; i++) prop({ k: 'pumpkin', x: x + W.rng() * 8, layer: W.rng() < 0.55 ? 'back' : 'front', lit: 0, size: W.rng() < 0.3 ? 1 : 0 });
    } else prop({ k: kind, x: x + (W.rng() - 0.5) * 3, look: 0, lit: 0 });
  }
  function intro() {
    hide(13, 1.05, 0);
    obstacle('low', 25, 'pumpkin', 0);
    hide(36, 1, 0);
    decor('scarecrow', 8); decor('pumpkins', 18); decor('fence', 30);
    W.genX = 50;
  }
  function section(d, stage) {
    const pool = SECTION_TEMPLATES.filter(t => t.min <= d && t.id !== W.last);
    let tot = 0; for (const t of pool) tot += t.w;
    let r = W.rng() * tot, t = pool[0];
    for (const c of pool) { r -= c.w; if (r <= 0) { t = c; break; } }
    W.last = t.id;
    const sl = lerp(1, 1.32, d), x0 = W.genX;
    for (const it of t.items) {
      const at = x0 + it[1] * sl + (W.rng() - 0.5) * 3;
      if (it[0] === 'hide') hide(at, it[2], d);
      else obstacle(it[0], at, it[2], d);
    }
    for (const p of t.props) decor(p[0], x0 + p[1] * sl);
    // later stages: more pumpkins and abandoned structures, more scarecrows
    if (stage >= 1 && W.rng() < 0.6) decor('pumpkins', x0 + W.rng() * t.L);
    if (stage >= 1 && W.rng() < 0.35) decor(W.rng() < 0.5 ? 'cart' : 'post', x0 + W.rng() * t.L);
    if (stage >= 2 && W.rng() < 0.5) decor('scarecrow', x0 + W.rng() * t.L);
    W.genX = Math.max(x0 + t.L * sl, lastObs + 6);
    if (W.genX - W.lastHide > hideLimit(d) - 6) { hide(Math.max(lastObs + 3, W.lastHide + hideLimit(d) * 0.6), 0.8, d); W.genX = Math.max(W.genX, lastObs + 6); }
    W.sections++;
  }
  W.reset = function (sd) {
    for (const f of W.feats) W.pool.push(f);
    for (const f of W.props) W.pool.push(f);
    W.feats.length = 0; W.props.length = 0; W.rng = makeRng(sd); W.last = ''; W.sections = 0; lastObs = -99; W.lastHide = 0;
    intro();
  };
  W.update = function (dist, d, stage) {
    while (W.genX < dist + 90) section(d, stage);
    // recycle everything well behind the player
    for (const arr of [W.feats, W.props]) {
      let j = 0;
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i], end = f.x1 !== undefined ? f.x1 : f.x;
        if (end < dist - 30) W.pool.push(f); else arr[j++] = f;
      }
      arr.length = j;
    }
  };
  W.zoneAt = function (x) {
    for (const f of W.feats) if (f.k === 'hide' && x >= f.x0 + 0.2 && x <= f.x1 - 0.2) return f;
    return null;
  };
  W.nextObstacle = function (x) {
    let best = null;
    for (const f of W.feats) if (f.k !== 'hide' && !f.done && f.x1 > x && (!best || f.x0 < best.x0)) best = f;
    return best;
  };
  W.reset(seed);
  return W;
}

// ---- 02_scene.js ----
// =====================================================================
// The landscape: sky, clouds, the distant farm, and the layered field.
// Each layer scrolls at its own rate; all positions are rounded to whole
// pixels before drawing.
// =====================================================================
function computeLayout(W, H) {
  return {
    W, H,
    PX: Math.round(W * 0.42),
    yHor: Math.round(H * 0.50),
    yDist: Math.round(H * 0.505),
    yMid: Math.round(H * 0.585),
    yBack: Math.round(H * 0.645),
    yFeet: Math.round(H * 0.80),
    yFront: Math.round(H * 0.825)
  };
}

function createScene() {
  const S = { skyKey: '', sky: null, clouds: [], cloudKey: '', windmill: 0, windmillSpin: 1, figure: 0, figureX: 0, sway: [] };
  const skyCv = document.createElement('canvas');
  const sky = skyCv.getContext('2d');

  // ---- sky: flat bands joined by ordered-dither seams, a striped sun ----
  function bandColor(L, p, y) {
    const b = [0, 0.17, 0.29, 0.40].map(f => Math.round(L.H * f));
    if (y < b[1]) return p.sky0; if (y < b[2]) return p.sky1; if (y < b[3]) return p.sky2; return p.sky3;
  }
  function buildSky(L, p, stageF) {
    skyCv.width = L.W; skyCv.height = L.yHor + 2;
    const prevG = G; setTarget(sky);
    const bounds = [Math.round(L.H * 0.17), Math.round(L.H * 0.29), Math.round(L.H * 0.40)];
    const cols = [p.sky0, p.sky1, p.sky2, p.sky3];
    for (let y = 0; y < skyCv.height; y++) R(0, y, L.W, 1, bandColor(L, p, y));
    // three-row seam: 25%, 50%, 75% of the lower colour mixed into the upper band
    bounds.forEach((by, i) => {
      for (let r = 1; r <= 3; r++) {
        const y = by - r, step = r === 1 ? 1 : r === 2 ? 2 : 4;
        for (let x = (y * (r === 2 ? 1 : 3)) % step; x < L.W; x += step) R(x, y, 1, 1, cols[i + 1]);
        if (r === 1) for (let x = 1; x < L.W; x += 4) R(x, y, 1, 1, cols[i]);
      }
    });
    // the sun sits low on the left and sinks over the run
    const sr = Math.round(L.W * 0.15), sx = Math.round(L.W * 0.27);
    const sy = Math.round(lerp(L.H * 0.33, L.H * 0.50, stageF / 3));
    // halo: a checker ring of the rim colour
    for (let y = -sr - 4; y <= sr + 4; y++) for (let x = -sr - 4; x <= sr + 4; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > sr + 0.5 && d < sr + 4 && ((x + y) & 1) === 0 && sy + y < L.yHor) R(sx + x, sy + y, 1, 1, p.sunRim);
    }
    ellipse(sx, sy, sr, sr, p.sun);
    ellipse(sx - 1, sy - 1, sr - 3, sr - 3, p.sunRim);
    ellipse(sx, sy, sr - 3, sr - 3, p.sun);
    // retro slits across the lower half, cut with the sky colour behind
    [[0.25, 1], [0.48, 1], [0.68, 2], [0.86, 2]].forEach(([f, t]) => {
      const y = sy + Math.round(sr * f);
      const half = Math.round(Math.sqrt(Math.max(0, sr * sr - (y - sy) * (y - sy))));
      R(sx - half - 1, y, half * 2 + 3, t, bandColor(L, p, y));
    });
    // a long cloud streak crossing the sun
    R(sx - sr - 10, sy - Math.round(sr * 0.2), sr + 6, 1, p.cloudLit);
    R(sx - sr + 4, sy - Math.round(sr * 0.2) + 2, sr + 18, 1, p.cloud);
    setTarget(prevG);
  }

  // ---- clouds: stepped shapes like the reference, flat light and shade bands ----
  const shapes = [];
  (function makeShapes() {
    const r = makeRng(77);
    for (let s = 0; s < 6; s++) {
      const w = 34 + ((r() * 40) | 0), h = 9 + ((r() * 9) | 0);
      const m = new Uint8Array(w * h);
      // stacked blocky tiers: wide base, narrower tiers on top, stepped edges in 2-3px runs
      let tierW = w, tierX = 0, y = h - 1;
      while (y >= 0 && tierW > 6) {
        const th = 2 + ((r() * 3) | 0);
        for (let yy = y; yy > y - th && yy >= 0; yy--) for (let x = tierX; x < tierX + tierW; x++) m[yy * w + x] = 1;
        y -= th;
        const shrink = 4 + ((r() * 8) | 0);
        tierX += (r() * shrink) | 0; tierW -= shrink;
        tierW = Math.min(tierW, w - tierX);
      }
      shapes.push({ w, h, m, cv: document.createElement('canvas') });
    }
  })();
  function paintClouds(p) {
    for (const s of shapes) {
      s.cv.width = s.w; s.cv.height = s.h;
      const g = s.cv.getContext('2d'); const pg = G; setTarget(g);
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (!s.m[y * s.w + x]) continue;
        const up = y > 0 && s.m[(y - 1) * s.w + x], up2 = y > 1 && s.m[(y - 2) * s.w + x];
        const dn = y < s.h - 1 && s.m[(y + 1) * s.w + x];
        R(x, y, 1, 1, !up ? p.cloudLit : !up2 && x % 3 !== 0 ? p.cloudLit : !dn ? p.cloudDark : p.cloud);
      }
      setTarget(pg);
    }
  }
  const cloudSlots = [];
  for (let i = 0; i < 9; i++) cloudSlots.push({ s: i % shapes.length, x: i * 47 + hash(i) * 30, y: 0.05 + hash(i + 9) * 0.27, par: 0.02 + hash(i + 3) * 0.03 });

  S.drawSky = function (L, p, stageF, camPx, t) {
    if (S.skyKey !== p.key + L.W + 'x' + L.H) { buildSky(L, p, stageF); S.skyKey = p.key + L.W + 'x' + L.H; }
    G.drawImage(skyCv, 0, 0);
    if (S.cloudKey !== p.key) { paintClouds(p); S.cloudKey = p.key; }
    const wrap = L.W + 160;
    for (const c of cloudSlots) {
      const sh = shapes[c.s];
      let x = (c.x - camPx * c.par - t * 0.8) % wrap; if (x < 0) x += wrap;
      G.drawImage(sh.cv, Math.round(x - 80), Math.round(c.y * L.H));
    }
  };

  // ---- distant farm: low hills, crooked trees, a windmill, a farmhouse ----
  function hillNear(wx) { return 3 + 2.5 * Math.sin(wx * 0.021 + 1) + 1.5 * Math.sin(wx * 0.057); }
  function hillFar(wx) { return 6 + 4 * Math.sin(wx * 0.011 + 2) + 2 * Math.sin(wx * 0.033 + 0.5); }
  function tree(x, y, sd, c) {
    const r = makeRng(sd); const h = 9 + ((r() * 8) | 0), lean = (r() - 0.5) * 6;
    line(x, y, x + lean, y - h, c, 1); line(x + 1, y, x + 1 + lean * 0.6, y - h * 0.6, c, 1);
    for (let i = 0; i < 4; i++) {
      const f = 0.45 + r() * 0.5, bx = x + lean * f, by = y - h * f, dir = r() < 0.5 ? -1 : 1, len = 3 + r() * 6;
      const ex = bx + dir * len, ey = by - len * (0.3 + r() * 0.6);
      line(bx, by, ex, ey, c, 1);
      line(ex, ey, ex + dir * 2, ey - 2 - r() * 2, c, 1);
    }
  }
  function windmill(x, y, c, ang, lit) {
    poly([x - 3, y, x + 4, y, x + 2, y - 17, x - 1, y - 17], c);
    R(x - 2, y - 19, 5, 2, c);
    const hx = x + 0.5, hy = y - 18;
    for (let i = 0; i < 4; i++) {
      const a = ang + i * Math.PI / 2, ex = hx + Math.cos(a) * 10, ey = hy + Math.sin(a) * 10;
      line(hx, hy, ex, ey, c, 1);
      line(hx + Math.cos(a) * 4 + Math.cos(a + 1.57) * 1.5, hy + Math.sin(a) * 4 + Math.sin(a + 1.57) * 1.5, ex + Math.cos(a + 1.57) * 1.5, ey + Math.sin(a + 1.57) * 1.5, c, 1);
    }
    if (lit) R(x, y - 8, 1, 2, FIX.glow);
  }
  function farmhouse(x, y, c, sd) {
    R(x, y - 7, 12, 7, c);
    poly([x - 1, y - 7, x + 13, y - 7, x + 6, y - 13], c);
    R(x + 9, y - 13, 2, 4, c);
    R(x + 15, y - 12, 4, 12, c); ellipse(x + 17, y - 12, 2, 1, c);
    if (hash(sd) < 0.8) R(x + 3, y - 5, 2, 2, FIX.glow);
  }
  function tinyScarecrow(x, y, c) { R(x, y - 9, 1, 9, c); R(x - 3, y - 7, 7, 1, c); R(x - 1, y - 11, 3, 2, c); R(x - 2, y - 11, 5, 1, c); }

  S.drawDistance = function (L, p, camPx, t, dt) {
    const pf = camPx * 0.05, pn = camPx * 0.1;
    for (let x = 0; x < L.W; x++) {
      const h = Math.round(hillFar(x + pf));
      R(x, L.yHor - h, 1, h + 2, p.hillFar);
    }
    for (let x = 0; x < L.W; x++) {
      const h = Math.round(hillNear(x + pn));
      R(x, L.yHor - h, 1, h + 2, p.hillNear);
    }
    // props on the near hills, one decision per 52px slot
    S.windmill += dt * 0.9 * S.windmillSpin;
    const slotW = 52, i0 = Math.floor((pn - 30) / slotW), i1 = Math.floor((pn + L.W + 30) / slotW);
    for (let i = i0; i <= i1; i++) {
      const r = hash(i * 7 + 3), x = Math.round(i * slotW + hash(i + 11) * 20 - pn), y = L.yHor - Math.round(hillNear(x + pn)) + 1;
      if (r < 0.14) windmill(x, y, p.sil, S.windmill, i % 2 === 0);
      else if (r < 0.30) farmhouse(x, y, p.sil, i);
      else if (r < 0.62) { tree(x, y, i * 13, p.sil); if (r > 0.5) tree(x + 9, y, i * 17, p.sil); }
      else if (r < 0.74) tinyScarecrow(x, y, p.sil);
    }
    if (S.figure > 0) {
      // someone else standing on the ridge, gone a moment later
      const x = Math.round(S.figureX), y = L.yHor - Math.round(hillNear(x + pn));
      R(x, y - 14, 1, 14, p.sil); R(x + 1, y - 12, 1, 10, p.sil); R(x - 1, y - 16, 3, 3, p.sil);
      R(x - 1, y - 11, 1, 6, p.sil); R(x + 2, y - 11, 1, 7, p.sil);
    }
  };

  // ---- the field ----
  // Corn rows: stalk positions come from the world column index so they
  // scroll as one surface and never shimmer.
  S.swayAt = function (wx, t, extra) {
    const base = Math.sin(t * 1.3 + wx * 0.05) + Math.sin(t * 0.7 + wx * 0.013);
    return Math.round(base * 0.55 + (extra || 0));
  };
  S.drawDistCorn = function (L, p, camPx, t) {
    const off = camPx * 0.3, top = L.yDist;
    R(0, top + 2, L.W, L.yMid - top + 8, p.distCorn);
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + off), hh = hash(wx);
      if (wx % 2 === 0) { const h = 1 + ((hh * 3) | 0); R(x, top + 2 - h, 1, h, p.distCorn); R(x, top + 2 - h, 1, 1, p.distCornLit); }
    }
    // horizontal drifts of lit tassels, grouped into short dashes
    const rows = [5, 9, 14, 20];
    for (let ri = 0; ri < rows.length; ri++) {
      const y = top + rows[ri]; if (y > L.yMid + 4) break;
      const cell = 6 + ri * 2, shift = Math.floor(off * (1 + ri * 0.15));
      for (let c = Math.floor(shift / cell) - 1; c <= Math.floor((shift + L.W) / cell) + 1; c++) {
        const hh = hash2(c, ri * 31 + 5);
        if (hh < 0.45) R(c * cell - shift + ((hh * 4) | 0), y, 2 + (hh < 0.15 ? 1 : 0), 1, p.distCornLit);
        else if (hh > 0.88) R(c * cell - shift, y + 1, 1, 1, p.tassel);
      }
    }
  };
  S.drawMidCorn = function (L, p, camPx, t) {
    const off = camPx * 0.55, sp = 4;
    R(0, L.yMid + 5, L.W, L.yBack - L.yMid + 12, p.midCorn);
    const i0 = Math.floor(off / sp) - 1, i1 = Math.floor((off + L.W) / sp) + 1;
    for (let i = i0; i <= i1; i++) {
      const hh = hash(i + 1000), x = Math.round(i * sp - off + ((hh * 2) | 0));
      const top = L.yMid - 2 + ((hh * 5) | 0), sw = S.swayAt(i * 4, t);
      R(x, top + 3, 1, L.yMid + 8 - top, p.midCorn);
      R(x + sw, top, 1, 3, p.midCorn);
      R(x + sw, top, 1, 1, hh > 0.7 ? p.tassel : p.midCornLit);
      R(x - 2, top + 4 + (i & 1), 2, 1, p.midCornLit); R(x - 3, top + 5 + (i & 1), 1, 1, p.midCorn);
      R(x + 1, top + 6, 2, 1, p.midCorn); R(x + 3, top + 7, 1, 1, p.midCorn);
    }
  };
  S.drawBackRow = function (L, p, camPx, t, stir) {
    const off = camPx * 0.85, sp = 6;
    const base = L.yFeet - 5;
    R(0, L.yBack + 14, L.W, base - L.yBack - 12, p.backLeaf);
    // a band of olive stems at the base, where the red gives way to the dark
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + off);
      if (hash(wx + 7) < 0.5) R(x, base - 5 - ((hash(wx) * 4) | 0), 1, 6, p.backStalk);
    }
    const i0 = Math.floor(off / sp) - 2, i1 = Math.floor((off + L.W) / sp) + 2;
    for (let i = i0; i <= i1; i++) {
      const hh = hash(i + 5000);
      if (hh < 0.12) continue; // a gap between the stalks
      const x = Math.round(i * sp - off + ((hh * 3) | 0));
      const top = L.yBack - 4 + ((hash(i + 77) * 8) | 0);
      let ex = 0;
      if (stir && stir.t > 0 && Math.abs(i * sp - stir.x * PPM * 0.85) < 40) ex = Math.sin(t * 9 + i) * 2.2 * Math.min(1, stir.t);
      const sw = S.swayAt(i * 6, t, ex);
      R(x, top + 4, 1, base - top - 4, p.backStalk);
      R(x + sw, top, 1, 4, p.backStalk);
      // tassel
      R(x + sw - 1, top - 1, 1, 1, p.tassel); R(x + sw, top - 2, 1, 2, p.tassel); R(x + sw + 1, top - 1, 1, 1, p.tassel);
      // drooping leaves, lit on the sun side (left)
      const ly = [top + 6, top + 11, top + 17, top + 23];
      for (let k = 0; k < ly.length; k++) {
        const y = ly[k]; if (y > base - 4) break;
        const dir = (k + i) & 1 ? 1 : -1, s2 = k < 2 ? sw : 0;
        R(x + (dir < 0 ? -3 : 1) + s2, y, 3, 1, dir < 0 ? p.backLeafLit : p.backLeaf);
        R(x + (dir < 0 ? -5 : 4) + s2, y + 1, 2, 1, dir < 0 ? p.backLeafLit : p.backLeaf);
        R(x + (dir < 0 ? -6 : 6) + s2, y + 2, 1, 1, p.backLeaf);
      }
      if (hh > 0.8) { R(x + 1, top + 13, 2, 4, p.tassel); R(x + 1, top + 13, 1, 4, p.pumpkinDark); }
    }
  };
  S.drawPath = function (L, p, camPx) {
    const y0 = L.yFeet - 5;
    R(0, y0, L.W, L.yFront - y0 + 3, p.ground);
    R(0, y0, L.W, 1, p.groundDark);
    const i0 = Math.floor(camPx / 9) - 1, i1 = Math.floor((camPx + L.W) / 9) + 1;
    for (let i = i0; i <= i1; i++) {
      const x = Math.round(i * 9 - camPx), hh = hash(i + 9000);
      R(x, L.yFeet - 2, 4 + ((hh * 3) | 0), 1, p.groundDark);       // rut
      if (hh > 0.45) R(x + 3, L.yFeet + 1, 2, 1, p.groundLit);       // dry clods
      if (hh > 0.8) { R(x + 5, L.yFeet - 3, 2, 1, p.pumpkinDark); R(x + 6, L.yFeet - 4, 1, 1, p.pumpkin); } // fallen leaf
      if (hh < 0.12) { R(x + 1, L.yFeet, 2, 1, p.backLeafLit); }
    }
  };
  S.drawFront = function (L, p, camPx, t) {
    const y0 = L.yFront;
    R(0, y0 + 2, L.W, L.H - y0, p.frontDark);
    // vertical grass strands like the reference foreground: olive, a few with red tips
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + camPx * 1.0), hh = hash(wx + 300);
      const h = 2 + ((hh * 6) | 0);
      R(x, y0 + 2 - h, 1, h + 2, hh > 0.5 ? p.frontLeaf : p.frontDark);
      if (hh > 0.86) R(x, y0 + 2 - h, 1, 1, p.frontLeafLit);
      else if (hh < 0.08) R(x, y0 + 2 - h, 1, 1, p.backLeaf);
    }
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + camPx * 1.15), hh = hash(wx + 900);
      if (hh < 0.35) R(x, y0 + 10 + ((hh * 10) | 0), 1, L.H, hh < 0.12 ? p.frontLeafLit : p.frontLeaf);
    }
  };
  // a hiding place: a tall, dense clump of stalks in front of the path
  S.drawClump = function (L, p, camPx, f, t, rustle) {
    const xa = Math.round(f.x0 * PPM - camPx), xb = Math.round(f.x1 * PPM - camPx);
    if (xb < -12 || xa > L.W + 12) return;
    const n = Math.max(3, Math.floor((xb - xa) / 3));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(lerp(xa, xb, k / n)), hh = hash(f.seed + k);
      const edge = Math.min(k, n - k);
      const top = L.yFeet - 15 - ((hh * 6) | 0) - Math.min(edge, 3) * 2;
      const sw = Math.round(Math.sin(t * 1.4 + k) * 0.6 + rustle * Math.sin(t * 22 + k * 1.7) * 1.5);
      R(x, top + 4, 2, L.yFront - top, p.frontLeaf);
      R(x + sw, top, 1, 5, p.frontLeaf); R(x + 1 + sw, top + 1, 1, 4, p.frontDark);
      R(x + sw, top - 2, 1, 2, p.tassel); R(x - 1 + sw, top - 1, 1, 1, p.tassel);
      const leaves = [top + 5, top + 10, top + 16];
      for (let j = 0; j < leaves.length; j++) {
        const y = leaves[j], dir = (k + j) & 1 ? 1 : -1, s2 = j === 0 ? sw : 0;
        if (dir < 0) { R(x - 3 + s2, y, 3, 1, p.frontLeafLit); R(x - 5 + s2, y + 1, 2, 1, p.frontLeaf); R(x - 6 + s2, y + 2, 1, 2, p.frontLeaf); }
        else { R(x + 2 + s2, y, 3, 1, p.frontLeaf); R(x + 5 + s2, y + 1, 2, 1, p.frontLeaf); R(x + 7 + s2, y + 2, 1, 2, p.frontDark); }
      }
      if (hh > 0.75) { R(x + 2, top + 8, 1, 3, p.backLeafLit); }
    }
  };
  return S;
}

// ---- 03_actors.js ----
// =====================================================================
// Actors and props: the traveller, the thing in the field, obstacles and
// farm debris. The traveller is a hand-drawn upper body over limbs posed
// from an 8-step cycle; the creature is built from pixel lines on a
// skeleton so it can be drawn at any size without leaving the grid.
// =====================================================================
const PL_MAP = compileMap([
  '....ooooo.....',
  '..oohhhhhoo...',
  '.ohhhhhhhhHo..',
  'ohhhhhhhhhhHo.',
  'ohhhhhhhhHHHHo',
  'ohhhhhhhHddddo',
  'ohhhhhhhHdedeo',
  'ohhhhhhhHddddo',
  '.ohhhhhhhHHHo.',
  '..oohhhhhhoo..',
  '.oobbboccccco.',
  'obbbbbocccCCo.',
  'obBbbbocccCCo.',
  'obBbbbocccCCo.',
  'obBBbbocccCo..',
  '.obbbbocccCo..',
  '..oooooccCCo..',
  '......occCo...'
]);
const PL_COL = { o: '#1a1410', h: '#3d2420', H: '#74403a', d: '#22140f', e: '#f6e2b6', b: FIX.green, B: FIX.greenDark, c: '#dcbb7c', C: '#a8834f' };
const PL_COL_BLINK = Object.assign({}, PL_COL, { e: '#22140f' });
const PL_TROUSER = '#5e3a30', PL_TROUSER_BK = '#3a2420', PL_BOOT = '#1a1410';

// s.mode: idle | run | walk | tired | crouch | duck | air | fall | lifted
function drawPlayer(x, yF, s) {
  const m = s.mode, q = Math.floor(((s.ph % TAU) + TAU) % TAU / (TAU / 8)), ph = q * TAU / 8;
  let lean = 0, stride = 0, bend = 0.15, armSwing = 0, armBend = 0.4, crouch = false, headX = 0;
  if (m === 'run') { lean = 0.16; stride = 0.85; bend = 1.2; armSwing = 0.95; armBend = 1.3; }
  else if (m === 'walk') { lean = 0.05; stride = 0.45; bend = 0.5; armSwing = 0.45; }
  else if (m === 'tired') { lean = 0.36; stride = 0.32; bend = 0.4; armSwing = 0.15; headX = 1; }
  else if (m === 'crouch' || m === 'duck') { crouch = true; lean = m === 'duck' ? 0.2 : 0.08; stride = m === 'duck' ? 0.3 : 0; }
  else if (m === 'air') { lean = 0.2; stride = 0.6; bend = 1.4; armSwing = 0.6; armBend = 1.0; }
  else if (m === 'lifted') { lean = -0.1; }
  const legs = [];
  for (let i = 0; i < 2; i++) {
    const p2 = ph + i * Math.PI;
    let kx, ky, fx, fy;
    if (crouch) {
      const sw = Math.sin(p2) * stride;
      kx = 3 + (i ? -3 : 0) + Math.round(sw * 2); ky = 2; fx = 1 + (i ? -3 : 0) + Math.round(sw * 3); fy = 5;
    } else if (m === 'lifted') {
      const sw = Math.sin(s.t * 9 + i * 2);
      kx = Math.round(sw); ky = 4; fx = Math.round(sw * 2); fy = 8;
    } else {
      const th = Math.sin(p2) * stride, kb = 0.15 + (Math.cos(p2) > 0 ? bend * Math.cos(p2) : 0);
      kx = Math.round(Math.sin(th) * 4.5); ky = Math.round(Math.cos(th) * 4.5);
      fx = kx + Math.round(Math.sin(th - kb) * 4.5); fy = ky + Math.round(Math.cos(th - kb) * 4.5);
      if (m === 'air') { fy -= i ? 1 : 2; }
    }
    legs.push({ kx, ky, fx, fy, back: i === 1 });
  }
  const footMax = Math.max(legs[0].fy, legs[1].fy);
  const hipY = Math.round(yF - (crouch ? 6 : footMax) - (s.lift || 0));
  const skip = crouch ? (r => r === 14 || r === 15) : null;
  const hipLocal = crouch ? 15 : 17, top = hipY - hipLocal;
  const shift = r => Math.round((17 - r) * lean) + (r <= 9 ? headX : 0);
  const hipX = x + 8 + shift(17);
  const shoulderY = top + 11, shX = x + 8 + shift(11);
  const arm = (sgn, col) => {
    let a = -Math.sin(ph) * armSwing * sgn, a2 = a + armBend;
    if (m === 'lifted') { a = 2.6; a2 = 2.9; }
    if (crouch) { a = 0.5; a2 = 1.6; }
    if (m === 'tired') { a = 0.55; a2 = 0.45; }
    const ex = shX + Math.sin(a) * 3.5, ey = shoulderY + Math.cos(a) * 3.5;
    const hx = ex + Math.sin(a2) * 3, hy = ey + Math.cos(a2) * 3;
    line(shX, shoulderY, ex, ey, col, 2); line(ex, ey, hx, hy, col, 2);
    R(Math.round(hx), Math.round(hy), 1, 1, PL_COL.o);
  };
  const leg = (L, col) => {
    const kx = hipX + L.kx, ky = hipY + L.ky, fx = hipX + L.fx, fy = hipY + L.fy;
    line(hipX, hipY, kx, ky, col, 2); line(kx, ky, fx, fy, col, 2);
    R(fx - 1, fy, 3, 2, PL_BOOT); R(fx + 2, fy + 1, 1, 1, PL_BOOT);
  };
  arm(-1, PL_COL.C);
  leg(legs[1], PL_TROUSER_BK);
  drawMap(PL_MAP, x, top, s.blink ? PL_COL_BLINK : PL_COL, shift, skip);
  leg(legs[0], PL_TROUSER);
  arm(1, PL_COL.c);
  return { top, hipY };
}

// ---------- the creature ----------
// o: facing, phase, t, reach (0..1) toward rx/ry, scan (head turn), eyes (0..1), mottle
const _crumble = [];
function drawCreature(cx, gy, k, o, p) {
  const f = o.facing || 1, th = k >= 1.6 ? 4 : k >= 0.62 ? 2 : 1;
  const C = p.crea, Cd = p.creaDark, Cl = p.creaLit;
  const X = u => cx + u * k * f, Y = v => gy - v * k;
  const ph = o.phase, t = o.t;
  _crumble.length = 0;
  const pt = (u, v) => { _crumble.push(X(u), Y(v)); };
  // legs: different lengths, out of step with each other
  const sA = Math.sin(ph), sB = Math.sin(ph + Math.PI + 0.6 * Math.sin(ph * 0.5));
  const hipU = sA * 1.5, hipV = 72 + Math.abs(Math.cos(ph)) * 2;
  const leg = (hu, s, kneeV, kneeOff, col) => {
    const ku = hipU + hu + s * 9 + kneeOff, fu = hipU + hu + s * 17, fv = Math.max(0, Math.cos(ph) * s * 5);
    line(X(hipU + hu), Y(hipV), X(ku), Y(kneeV), col, th);
    line(X(ku), Y(kneeV), X(fu), Y(fv), col, th);
    line(X(fu), Y(fv), X(fu + 5), Y(fv - 1), col, th);
    pt(ku, kneeV); pt(fu, fv + 8);
  };
  leg(3, sB, 35, -4, Cd);
  // arms swing at a slower, uneven rate than the stride
  const pa = ph * 0.73 + 1;
  const sx = hipU + 7 + (o.lean || 0), sv = 106;
  const arm = (su, a, a2, L1, L2, col, reach) => {
    const shU = sx + su, shV = sv - 3;
    let eu = shU + Math.sin(a) * L1, ev = shV - Math.cos(a) * L1;
    let hu = eu + Math.sin(a2) * L2, hv = ev - Math.cos(a2) * L2;
    if (reach) {
      const tu = (o.rx - cx) / (k * f), tv = (gy - o.ry) / k;
      eu = lerp(eu, (shU + tu) / 2 + 4, reach); ev = lerp(ev, Math.max(shV, tv) + 14, reach);
      hu = lerp(hu, tu, reach); hv = lerp(hv, tv, reach);
    }
    line(X(shU), Y(shV), X(eu), Y(ev), col, th);
    line(X(eu), Y(ev), X(hu), Y(hv), col, th);
    const fa = Math.atan2(hu - eu, ev - hv);
    for (let i = -1; i <= 1; i++) {
      const aa = fa + i * 0.35, ln = 10 - Math.abs(i) * 2 + (i === 1 ? 2 : 0);
      line(X(hu), Y(hv), X(hu + Math.sin(aa) * ln), Y(hv - Math.cos(aa) * ln), col, Math.max(1, th - 1));
    }
    if (k >= 0.5) { R(Math.round(X(hu)) - 1, Math.round(Y(hv)), 2, 1, p.tassel); }
    pt(eu, ev); pt(hu, hv); pt(hu + Math.sin(fa) * 9, hv - Math.cos(fa) * 9);
  };
  arm(-5, -0.2 + 0.28 * Math.sin(pa + 2.2), 0.15 + 0.3 * Math.sin(pa + 2.2), 27, 33, Cd, 0);
  // coat: narrow body, torn hem in strips
  const tat = [];
  tat.push(sx - 7, sv, sx + 6, sv - 1, hipU + 9, 74, hipU + 11, 58);
  for (let i = 1; i <= 6; i++) {
    const u = hipU + 11 - i * 3.6, long = i % 2 === 1;
    tat.push(u + 1, long ? 46 - 4 * Math.sin(t * 2.3 + i) : 57, u - 1, long ? 48 - 4 * Math.sin(t * 2.3 + i) : 57);
  }
  tat.push(hipU - 11, 60, hipU - 8, 76);
  const pts = []; for (let i = 0; i < tat.length; i += 2) pts.push(X(tat[i]), Y(tat[i + 1]));
  poly(pts, C);
  for (let i = 0; i < tat.length; i += 4) pt(tat[i], tat[i + 1]);
  leg(-3, sA, 41, 3, C);
  // mottled light on the sun side of the coat, in fixed clusters
  if (k >= 0.45) {
    for (let i = 0; i < 9; i++) {
      const u = sx - 6 + hash(i * 3 + 1) * 8 - (sx - hipU) * hash(i + 40), v = 62 + hash(i * 5 + 2) * 40;
      const xx = Math.round(X(u)), yy = Math.round(Y(v));
      R(xx, yy, Math.max(1, Math.round(k * 1.5)), Math.max(1, Math.round(k)), Cl);
    }
  }
  // neck, head (sack), hat
  const scan = o.scan || 0, hu = sx + 3 + scan * 3, hv = 121;
  line(X(sx), Y(sv), X(hu - 1), Y(hv - 6), C, th);
  ellipse(X(hu), Y(hv), Math.max(1.5, 6.5 * k), Math.max(2, 8 * k), C, k >= 0.5 ? Cl : null);
  const tilt = (o.tilt || 0) + scan * 0.15;
  const bL = Y(hv + 6 - 13 * tilt * f), bR = Y(hv + 7 + 12 * tilt * f);
  line(X(hu - 13), bL, X(hu + 12), bR, Cd, th);
  // a slouched farmer's hat, crown dented and pushed to one side
  poly([X(hu - 7), Y(hv + 7), X(hu + 6), Y(hv + 7.5), X(hu + 5), Y(hv + 12), X(hu + 1), Y(hv + 11), X(hu - 2), Y(hv + 14), X(hu - 7), Y(hv + 12)], Cd);
  line(X(hu + 12), bR, X(hu + 14), Y(hv + 4 + 12 * tilt * f), Cd, th);
  pt(hu - 13, hv + 6); pt(hu + 14, hv + 4); pt(hu - 2, hv + 14);
  if (k >= 0.7) for (let i = -3; i <= 2; i += 2) R(Math.round(X(hu + i)), Math.round(Y(hv - 4.5)), 1, 1, p.tassel);
  // straw at the collar
  if (k >= 0.5) { R(Math.round(X(sx - 2)), Math.round(Y(sv + 2)), 1, 2, p.tassel); R(Math.round(X(sx + 2)), Math.round(Y(sv + 3)), 1, 1, p.tassel); }
  // eyes: two small lights, uneven
  const ev = o.eyes === undefined ? 1 : o.eyes;
  if (ev > 0) {
    const es = k >= 1.6 ? 3 : k >= 0.8 ? 2 : 1;
    const e1x = Math.round(X(hu + 2.5 + scan * 1.5)), e1y = Math.round(Y(hv + 1));
    const e2x = Math.round(X(hu - 1.5 + scan * 1.5)), e2y = Math.round(Y(hv - 0.2));
    if (k >= 0.5) { R(e1x - 1, e1y, es + 2, es, FIX.ember); R(e2x - 1, e2y, es + 2, es, FIX.ember); }
    R(e1x, e1y, es, es, FIX.glowHot); R(e2x, e2y, es, es, FIX.glowHot);
  }
  // front arm last; it is the one that reaches
  arm(5, 0.22 + 0.36 * Math.sin(pa), 0.5 + 0.22 * Math.sin(pa * 1.3 + 1), 30, 37, C, o.reach || 0);
  // crumbling edges: loose pixels drifting off the silhouette, reseeded 8 times a second
  const tq = Math.floor(t * 8), rad = Math.max(2, 3.5 * k), ps = k >= 1.6 ? 2 : 1;
  for (let i = 0; i < _crumble.length; i += 2) {
    for (let j = 0; j < 3; j++) {
      const hh = hash2(tq * 31 + i, j), a = hh * TAU, d = 1.5 + hash2(i, tq + j * 7) * rad;
      R(Math.round(_crumble[i] + Math.cos(a) * d - (j === 2 ? d * 0.6 : 0)), Math.round(_crumble[i + 1] + Math.sin(a) * d - d * 0.4), ps, ps, j ? C : Cd);
    }
  }
}

// ---------- obstacles ----------
function drawPumpkin(x, y, size, p, lit) {
  const rx = 4 + size, ry = 3 + size;
  ellipse(x, y - ry, rx, ry, p.pumpkin, p.pumpkinLit);
  R(x - 2, y - ry * 2 + 1, 1, ry * 2 - 1, p.pumpkinDark);
  R(x + 2, y - ry * 2 + 1, 1, ry * 2 - 1, p.pumpkinDark);
  R(x - rx, y - 1, rx * 2 + 1, 1, p.pumpkinDark);
  R(x, y - ry * 2 - 1, 1, 2, p.woodDark); R(x + 1, y - ry * 2 - 2, 1, 1, p.woodDark);
  if (lit > 0) {
    R(x - 3, y - ry - 1, 2, 1, FIX.glowHot); R(x + 1, y - ry - 1, 2, 1, FIX.glowHot);
    R(x - 2, y - ry + 2, 5, 1, FIX.glow); R(x - 1, y - ry + 1, 1, 1, FIX.glow); R(x + 1, y - ry + 1, 1, 1, FIX.glow);
  }
}
const WIRE = '#b49a82';
function drawObstacle(f, sx, ex, L, p, t) {
  const y = L.yFeet;
  if (f.v === 'pumpkin') drawPumpkin(Math.round((sx + ex) / 2), y + 1, 0, p, f.lit || 0);
  else if (f.v === 'root') {
    const w = ex - sx;
    line(sx, y, sx + w * 0.25, y - 4, p.woodDark, 2); line(sx + w * 0.25, y - 4, sx + w * 0.55, y - 2, p.woodDark, 2);
    line(sx + w * 0.55, y - 2, sx + w * 0.8, y - 5, p.woodDark, 2); line(sx + w * 0.8, y - 5, ex, y, p.woodDark, 2);
    line(sx + w * 0.25, y - 5, sx + w * 0.5, y - 3, p.wood, 1); line(sx + w * 0.75, y - 6, sx + w * 0.85, y - 6, p.wood, 1);
  } else if (f.v === 'board') {
    line(sx - 1, y, ex, y - 5, p.woodDark, 3); line(sx, y - 1, ex - 1, y - 5, p.wood, 1);
    line(sx + 2, y - 4, ex + 1, y + 1, p.woodDark, 2); R(Math.round(sx + 5), y - 3, 1, 1, WIRE);
  } else if (f.v === 'pit') {
    const cx = (sx + ex) / 2, rx = (ex - sx) / 2;
    ellipse(cx, y - 1, rx, 3, p.groundDark);
    ellipse(cx, y, rx - 1, 2, FIX.ink);
    R(Math.round(sx + 1), y - 4, Math.round(ex - sx) - 1, 1, p.groundLit);
    R(Math.round(cx - rx * 0.4), y + 3, Math.round(rx * 0.9), 1, p.groundLit);
  } else if (f.v === 'wire') {
    for (const px of [sx, ex]) { R(Math.round(px), y - 22, 2, 23, p.woodDark); R(Math.round(px), y - 22, 1, 23, p.wood); R(Math.round(px) - 1, y - 23, 4, 1, p.woodDark); }
    const mid = (sx + ex) / 2;
    line(sx + 1, y - 18, mid, y - 15, WIRE, 1); line(mid, y - 15, ex + 1, y - 17, WIRE, 1);
    line(sx + 1, y - 9, mid, y - 5, p.woodDark, 1); line(mid, y - 5, ex + 1, y - 8, p.woodDark, 1);
    for (let i = 3; i < ex - sx - 1; i += 4) { const yy = Math.round(lerp(y - 18, y - 15, Math.min(1, i / (mid - sx)))); R(Math.round(sx + i), yy - 1, 1, 3, WIRE); R(Math.round(sx + i) - 1, yy, 3, 1, WIRE); }
  } else if (f.v === 'harrow') {
    const RUST = p.pumpkinDark;
    for (let a = 0; a < 8; a++) R(Math.round(sx + 3 + Math.cos(a * 0.785) * 5), Math.round(y - 5 + Math.sin(a * 0.785) * 5), 1, 1, p.woodDark);
    line(sx + 3, y - 5, sx + 3, y - 5, p.woodDark, 2);
    line(sx + 2, y - 14, ex + 2, y - 17, RUST, 2);
    line(sx + 3, y - 10, sx + 3, y - 14, p.woodDark, 1);
    for (let i = 0; i < ex - sx; i += 3) {
      const yy = Math.round(lerp(y - 14, y - 17, i / (ex - sx)));
      line(sx + 2 + i, yy, sx + 5 + i, yy + 4, RUST, 1); R(Math.round(sx + 5 + i), yy + 4, 1, 1, WIRE);
    }
  }
}

// ---------- farm debris in the back row ----------
function drawProp(pr, x, L, p, t) {
  const base = L.yFeet - 6;
  if (pr.k === 'scarecrow') {
    const top = base - 32;
    R(x, top, 2, base - top, p.woodDark);
    R(x - 9, top + 9, 20, 2, p.woodDark);
    poly([x - 7, top + 8, x + 9, top + 8, x + 7, top + 22, x + 4, top + 19, x + 1, top + 24, x - 2, top + 19, x - 6, top + 22], p.sil);
    R(x - 10, top + 10, 2, 3, p.tassel); R(x + 10, top + 10, 2, 3, p.tassel);
    const lk = Math.round(pr.look || 0);
    ellipse(x + 1 + lk, top + 2, 3, 4, p.wood, p.tassel);
    R(x - 4 + lk, top - 2, 11, 1, p.woodDark); R(x - 1 + lk, top - 5, 5, 3, p.woodDark);
    if (Math.abs(pr.look || 0) > 0.5) { R(x + lk * 2, top + 1, 1, 1, FIX.ink); R(x + 2 + lk * 2, top + 1, 1, 1, FIX.ink); }
  } else if (pr.k === 'cart') {
    poly([x - 12, base - 13, x + 10, base - 10, x + 10, base - 5, x - 12, base - 8], p.wood);
    line(x - 12, base - 13, x + 10, base - 10, p.woodDark, 1);
    line(x + 10, base - 9, x + 22, base - 2, p.woodDark, 1);
    for (let a = 0; a < 12; a++) R(Math.round(x - 2 + Math.cos(a * 0.52) * 6), Math.round(base - 6 + Math.sin(a * 0.52) * 6), 1, 1, p.woodDark);
    line(x - 2, base - 12, x - 2, base, p.woodDark, 1); line(x - 8, base - 6, x + 4, base - 6, p.woodDark, 1);
  } else if (pr.k === 'fence') {
    for (let i = 0; i < 3; i++) { const px = x + i * 8, h = 12 + (hash(pr.seed + i) * 5 | 0); R(px, base - h, 2, h, p.woodDark); R(px, base - h, 1, 1, p.wood); }
    line(x, base - 9, x + 9, base - 10, p.wood, 1); line(x + 9, base - 6, x + 17, base - 2, p.wood, 1); line(x, base - 5, x + 8, base - 5, p.woodDark, 1);
  } else if (pr.k === 'post' || pr.k === 'lantern') {
    R(x, base - 30, 1, 30, p.woodDark); R(x - 4, base - 30, 9, 1, p.woodDark);
    if (pr.k === 'lantern') {
      R(x + 3, base - 29, 1, 3, p.woodDark);
      const fl = Math.sin(t * 13 + pr.seed) > -0.7 ? FIX.glow : FIX.ember;
      for (let yy = -4; yy <= 4; yy++) for (let xx = -4; xx <= 4; xx++) if (((xx + yy) & 1) === 0 && xx * xx + yy * yy < 18 && xx * xx + yy * yy > 3) R(x + 3 + xx, base - 24 + yy, 1, 1, p.pumpkinLit);
      R(x + 2, base - 26, 3, 4, p.woodDark); R(x + 3, base - 25, 1, 2, fl);
    } else { line(x - 4, base - 30, x - 6, base - 22, WIRE, 1); }
  }
}

// ---- 04_audio.js ----
// =====================================================================
// Sound: wind in the crops, crows, a creaking windmill, a low bed, and
// the gameplay cues (steps, breath, its steps, its breath, the heart).
// Hiding closes a low-pass over the ambience so the field goes quiet.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, muted: false };
  let ac, master, amb, ambLP, nb, windG, windBP, rustG, breathG, breathBP, cBreathG, droneG, distG, distLP;
  function noiseSrc() { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, Math.random() * 1.5); return s; }
  function filt(type, f, q) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; }
  function gain(v) { const g = ac.createGain(); g.gain.value = v; return g; }
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = gain(0.8);
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        amb = gain(1); ambLP = filt('lowpass', 9000, 0.5); amb.connect(ambLP); ambLP.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = nb.getChannelData(0); let b = 0;
        for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
        // wind through the crops
        windBP = filt('bandpass', 520, 0.6); windG = gain(0.05); noiseSrc().connect(windBP); windBP.connect(windG); windG.connect(amb);
        // rustle of stalks as you push through
        const rh = filt('highpass', 2600, 0.5); rustG = gain(0); noiseSrc().connect(rh); rh.connect(rustG); rustG.connect(amb);
        // your breath
        breathBP = filt('bandpass', 1300, 1.4); breathG = gain(0); noiseSrc().connect(breathBP); breathBP.connect(breathG); breathG.connect(master);
        // its breath: low and rasping
        const cb = filt('bandpass', 330, 3); cBreathG = gain(0); noiseSrc().connect(cb); cb.connect(cBreathG); cBreathG.connect(master);
        // the low bed, plus a distorted copy that rises with danger
        droneG = gain(0.035); distG = gain(0); distLP = filt('lowpass', 400, 1);
        const sh = ac.createWaveShaper(); const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
        sh.curve = curve;
        [[49, 'sine'], [49.7, 'sine'], [73.5, 'triangle']].forEach(([f, ty]) => {
          const o = ac.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(droneG); o.connect(sh); o.start();
        });
        droneG.connect(master); sh.connect(distLP); distLP.connect(distG); distG.connect(master);
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  const ramp = (param, v, tc) => { try { param.setTargetAtTime(v, ac.currentTime, tc || 0.12); } catch (e) { } };
  let breathPh = 0, cBreathPh = 0;
  // s: { run (0..1 speed), hidden, prox (0..1), tired (0..1), exert (0..1), searching, dt, playing }
  A.update = function (s) {
    if (!A.ok) return;
    const live = s.playing ? 1 : 0.6;
    ramp(master.gain, A.muted ? 0 : 0.8);
    ramp(ambLP.frequency, s.hidden ? 650 : 9000, 0.25);
    ramp(amb.gain, (s.hidden ? 0.5 : 1) * live, 0.3);
    ramp(windG.gain, 0.04 + 0.025 * Math.sin(Date.now() / 2300) + 0.015 * Math.sin(Date.now() / 700), 0.4);
    ramp(windBP.frequency, 480 + 140 * Math.sin(Date.now() / 3100), 0.5);
    ramp(rustG.gain, s.playing ? s.run * 0.05 + (s.rustle || 0) * 0.06 : 0, 0.08);
    breathPh += s.dt * (1.2 + s.exert * 2.6);
    const bv = Math.max(0, Math.sin(breathPh * Math.PI)) ** 2 * (0.004 + s.tired * 0.05 + s.exert * 0.012) * (s.hidden ? 0.4 : 1);
    ramp(breathG.gain, s.playing ? bv : 0, 0.05);
    cBreathPh += s.dt * 0.55;
    const cv = Math.max(0, Math.sin(cBreathPh * Math.PI)) * s.prox * s.prox * 0.09;
    ramp(cBreathG.gain, s.playing ? cv : 0, 0.08);
    ramp(droneG.gain, (0.03 + s.prox * 0.03) * live, 0.4);
    ramp(distG.gain, s.playing ? s.prox * s.prox * 0.05 : 0, 0.3);
    ramp(distLP.frequency, 200 + s.prox * 500, 0.3);
  };
  function blip(f0, f1, dur, type, vol, delay, dest) {
    if (!A.ok) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
  }
  function burst(f, q, dur, vol, delay, dest, type) {
    if (!A.ok) return;
    const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(); s.buffer = nb;
    const fl = filt(type || 'bandpass', f, q), g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  let foot = 0;
  A.step = function (soft) { foot ^= 1; blip(foot ? 120 : 105, 60, 0.05, 'square', soft ? 0.025 : 0.045); burst(900, 1.2, 0.05, soft ? 0.05 : 0.09, 0, amb); };
  A.creatureStep = function (prox) { if (prox < 0.05) return; blip(52, 30, 0.35, 'sine', 0.25 * prox); burst(180, 2, 0.2, 0.15 * prox); };
  A.caw = function () {
    const pan = ac && ac.createStereoPanner ? ac.createStereoPanner() : null; let dest = amb;
    if (pan && A.ok) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(amb); dest = pan; }
    const n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) { blip(620, 360, 0.16, 'sawtooth', 0.012, i * 0.24, dest); burst(1500, 4, 0.15, 0.03, i * 0.24, dest); }
  };
  A.creak = function () { blip(95, 70, 0.7, 'sawtooth', 0.01, 0, amb); blip(140, 120, 0.4, 'sawtooth', 0.006, 0.5, amb); };
  A.rustle = function (v) { burst(3200, 0.6, 0.35, 0.12 * (v || 1), 0, amb, 'highpass'); };
  A.leap = function () { burst(1800, 0.8, 0.12, 0.06); blip(220, 330, 0.08, 'square', 0.025); };
  A.thud = function () { blip(90, 40, 0.18, 'square', 0.08); burst(400, 1, 0.2, 0.2); };
  A.heart = function (v) { blip(62, 40, 0.12, 'sine', 0.35 * v); blip(58, 38, 0.12, 'sine', 0.25 * v, 0.17); };
  A.bats = function () { for (let i = 0; i < 8; i++) burst(4200 + Math.random() * 2000, 3, 0.05, 0.04, i * 0.05 + Math.random() * 0.04, amb); };
  A.sting = function () {
    if (!A.ok) return;
    blip(180, 30, 1.4, 'sawtooth', 0.12); blip(233, 36, 1.3, 'sawtooth', 0.09); burst(300, 0.8, 1.2, 0.5); blip(46, 28, 1.6, 'sine', 0.5);
  };
  A.ui = function () { blip(440, 660, 0.06, 'square', 0.03); };
  A.suspend = function () { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = function () { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  A.close = function () { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}

// ---- 05_game.js ----
// =====================================================================
// The game: run and hide, stamina, the pursuit, screens, the Plethora
// lifecycle and the pixel-perfect blit.
// =====================================================================
const SAVE_KEY = 'hollow-harvest-v1';
const TUNE = {
  runBase: 6.2, runGain: 2.2, walk: 2.0, accel: 16, decel: 14,
  drain: 0.088, drainGain: 0.03, recoverHide: 0.33, recoverWalk: 0.07, tiredAt: 0.3, rested: 0.3,
  huntBase: 6.75, huntGain: 2.3, startGap: 34, seenGap: 2.8, searchGap: 5.5, catchGap: 1.2,
  windowBase: 6.0, windowMin: 3.4, leaveSpeed: 6.5, maxGap: 44
};

window.plethoraBit = {
  meta: { title: 'Hollow Harvest', runtime: 'plethora-bit@2', tags: ['arcade', 'halloween', 'pixel-art', 'endless', 'survival'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy && ctx.onDestroy(() => { destroyed = true; });

    // ---------- save ----------
    let save = { best: 0, runs: 0, hints: {} };
    try {
      let s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null;
      if (s && typeof s.then === 'function') s = await s.catch(() => null);
      if (!s) { try { const raw = window.localStorage.getItem(SAVE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { } }
      if (s && typeof s === 'object') save = Object.assign(save, s, { hints: Object.assign({}, s.hints || {}) });
    } catch (e) { }
    const persist = () => {
      try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { }
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { }
    };

    // ---------- canvas ----------
    const canvas = ctx.createCanvas({ touchAction: 'none' });
    canvas.style.imageRendering = 'pixelated';
    const g = canvas.getContext('2d', { alpha: false });
    const buf = document.createElement('canvas');
    const b = buf.getContext('2d');
    let W = 128, H = 280, SC = 1, offX = 0, offY = 0, dpr = 1, L = computeLayout(W, H), safeT = 0, safeB = 0;
    const vign = [];
    function buildVignettes() {
      vign.length = 0;
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const ink = hexRgb(FIX.ink);
      for (let l = 1; l <= 3; l++) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const c2 = cv.getContext('2d'), id = c2.createImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), d = Math.sqrt(dx * dx * 1.1 + dy * dy * 0.9);
          const v = clamp((d - (1.12 - l * 0.17)) * 2.2, 0, 1);
          if (bayer[(y & 3) * 4 + (x & 3)] / 16 < v) { const i = (y * W + x) * 4; id.data[i] = ink[0]; id.data[i + 1] = ink[1]; id.data[i + 2] = ink[2]; id.data[i + 3] = 255; }
        }
        c2.putImageData(id, 0, 0); vign.push(cv);
      }
    }
    function layout() {
      const cw = Math.max(1, ctx.width || window.innerWidth), ch = Math.max(1, ctx.height || window.innerHeight);
      dpr = Math.min(3, ctx.nativeDpr || window.devicePixelRatio || 1);
      const dw = Math.max(1, Math.round(cw * dpr)), dh = Math.max(1, Math.round(ch * dpr));
      canvas.width = dw; canvas.height = dh; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      SC = Math.max(1, Math.min(Math.floor(dw / 128), Math.floor(dh / 228)));
      W = Math.min(Math.ceil(dw / SC), 180); H = Math.min(Math.ceil(dh / SC), 330);
      offX = Math.floor((dw - W * SC) / 2); offY = Math.floor((dh - H * SC) / 2);
      buf.width = W; buf.height = H;
      L = computeLayout(W, H);
      const sa = ctx.safeArea || {};
      safeT = Math.max(0, Math.ceil(((sa.top || 0) * dpr - Math.max(0, offY)) / SC));
      safeB = Math.max(0, Math.ceil(((sa.bottom || 0) * dpr - Math.max(0, offY)) / SC));
      scene.skyKey = '';
      buildVignettes();
    }

    const scene = createScene();
    const world = createWorld(1);
    const audio = createAudio(caps.audio !== false);
    ctx.onDestroy && ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- state ----------
    let mode = 'title', modeT = 0, clock = 0;
    const input = { pointers: new Set(), key: false, get held() { return this.pointers.size > 0 || this.key; } };
    let run = null;
    function newRun() {
      const seed = (Date.now() & 0xffffff) ^ (save.runs * 7919);
      world.reset(seed);
      return {
        t: 0, dist: 0, speed: 0, stamina: 1, tired: false, started: false, idleT: 0,
        act: 'stand', actT: 0, actDur: 0, airH: 0, ob: null, ph: 0, stepPh: 0,
        hideT: 0, inZone: null, zoneSeen: false,
        c: { gap: TUNE.startGap, mode: 'wake', timer: 0, phase: 0, facing: 1, reach: 0, scan: 0, searchDur: 0, eyes: 1, lastStep: 0, viewX: 0 },
        stageShown: 0, stageToast: 0, hint: '', hintT: 0, events: 5, caw: 4, creak: 8, stir: { x: 0, t: 0 },
        particles: [], bats: [], heartT: 0, record: false, cause: '', jitter: [], jitterT: 0, lastBlink: 0
      };
    }
    run = newRun();

    function diff() { return clamp((run.t - 15) / 70, 0, 1); }
    function runSpeed() {
      let s = TUNE.runBase + TUNE.runGain * diff();
      if (run.tired) s *= 0.55;
      else if (run.stamina < TUNE.tiredAt) s *= lerp(0.6, 1, run.stamina / TUNE.tiredAt);
      return s;
    }
    function hideWindow() { return lerp(TUNE.windowBase, TUNE.windowMin, diff()); }
    function showHint(key, msg) { if (save.hints[key]) return; save.hints[key] = 1; persist(); run.hint = msg; run.hintT = 3.2; }

    // ---------- particles ----------
    function spark(x, y, vx, vy, life, c, kind) {
      if (run.particles.length > 80) return;
      run.particles.push({ x, y, vx, vy, life, max: life, c, kind: kind || 'dot' });
    }

    // ---------- run lifecycle ----------
    function begin() {
      run = newRun(); mode = 'play'; modeT = 0;
      input.pointers.clear();
      save.runs++; persist();
      try { ctx.platform.start({ run: save.runs }); } catch (e) { }
    }
    function caught(cause) {
      if (mode !== 'play') return;
      mode = 'caught'; modeT = 0; run.cause = cause || 'caught';
      run.act = 'caught'; run.speed = 0;
      audio.sting(); haptic('heavy');
      const dist = Math.floor(run.dist);
      if (dist > save.best) { save.best = dist; run.record = true; }
      persist();
      try { ctx.platform.fail({ score: dist, distance: dist, reason: run.cause }); } catch (e) { }
      try { ctx.platform.setScore && ctx.platform.setScore(dist); } catch (e) { }
      try { if (ctx.memory && ctx.memory.record) ctx.memory.record('score').submit(dist, { label: dist + ' m' }).catch(() => { }); } catch (e) { }
    }
    function pause() { if (mode === 'play') { mode = 'paused'; modeT = 0; input.pointers.clear(); input.key = false; audio.suspend(); } }
    function resume() { if (mode === 'paused') { mode = 'play'; modeT = 0; audio.resume(); } }
    function toTitle() { mode = 'title'; modeT = 0; run = newRun(); audio.resume(); }

    // ---------- the creature ----------
    function updateCreature(dt) {
      const c = run.c, d = diff(), hidden = run.act === 'hide';
      const hunt = TUNE.huntBase + TUNE.huntGain * d;
      c.timer -= dt;
      if (c.mode === 'wake') {
        if (run.started ? c.timer < -2 : run.idleT > 6) c.mode = hidden ? 'seek' : 'hunt';
      } else if (!hidden) {
        // bolting from cover startles it for a moment while it pulls its arm out of the corn
        if (c.mode === 'search') { c.mode = 'reacquire'; c.timer = 0.8; }
        else if (c.mode === 'leave') {
          // it has its back to you: it walks on, and only picks up your trail when it stops
          c.gap = Math.min(TUNE.maxGap, c.gap + (TUNE.leaveSpeed - run.speed * 0.5) * dt);
          if (c.timer <= 0) { c.mode = 'reacquire'; c.timer = 0.7; }
        }
        else if (c.mode === 'seek' || c.mode === 'lost') { c.mode = 'reacquire'; c.timer = 0.7; }
        if (c.mode === 'reacquire') { c.gap += (run.speed - hunt * 0.6) * dt; if (c.timer <= 0) c.mode = 'hunt'; }
        if (c.mode === 'hunt') c.gap -= (hunt - run.speed) * dt;
      } else {
        if (c.mode === 'hunt' || c.mode === 'reacquire') c.mode = 'seek';
        if (c.mode === 'seek') {
          c.gap -= (2.6 + c.gap * 0.16) * dt;
          if (c.gap <= TUNE.searchGap) { c.gap = TUNE.searchGap; c.mode = 'search'; c.timer = c.searchDur = 1.5 + Math.random() * 1.1 + d * 0.6; audio.rustle(1.2); }
        } else if (c.mode === 'search') {
          c.gap = TUNE.searchGap + Math.sin(run.t * 0.9) * 0.6;
          if (run.hideT >= hideWindow()) { c.reach = 1; caught('found'); return; }
          if (c.timer <= 0) { c.mode = 'leave'; c.timer = 2.4 + Math.random(); }
        } else if (c.mode === 'leave') {
          c.gap = Math.min(TUNE.maxGap, c.gap + TUNE.leaveSpeed * dt);
          if (c.timer <= 0) { c.mode = 'lost'; c.timer = 1.4 + Math.random() * 2; }
        } else if (c.mode === 'lost') {
          if (c.timer <= 0) c.mode = 'seek';
        }
      }
      c.gap = Math.min(TUNE.maxGap, c.gap);
      // presentation
      c.facing = c.mode === 'leave' || c.mode === 'lost' ? -1 : 1;
      const moving = c.mode === 'hunt' || c.mode === 'seek' || c.mode === 'leave' || c.mode === 'reacquire';
      const prevPh = c.phase;
      c.phase += dt * (moving ? 2.3 : c.mode === 'search' ? 1.0 : 0.35);
      if (Math.floor(prevPh / Math.PI) !== Math.floor(c.phase / Math.PI) && moving) audio.creatureStep(clamp(1 - c.gap / 32, 0, 1));
      c.reach = lerp(c.reach, c.mode === 'search' ? 0.55 + 0.45 * Math.sin(run.t * 1.9) : 0, Math.min(1, dt * 4));
      c.scan = c.mode === 'search' ? Math.round(Math.sin(run.t * 1.3) * 2) / 2 : c.mode === 'lost' ? -1 : 0;
      if (c.gap <= TUNE.catchGap && !hidden) caught('caught');
    }

    // ---------- the traveller ----------
    function resolveObstacle(ob) {
      ob.done = true;
      const w = ob.x1 - ob.x0, fast = run.act === 'run' && !run.tired && run.speed > 3.5;
      if (ob.k === 'low') {
        if (fast) { setAct('vault', (w + 1.0) / run.speed); run.stamina = Math.max(0, run.stamina - 0.03); run.airMax = 6; audio.leap(); }
        else if (run.speed <= 3.5) { setAct('climb', (w + 0.6) / 1.3); }
        else { setAct('stumble', 0.7); audio.thud(); haptic('warning'); dust(); run.dist = Math.max(run.dist, ob.x1 + 0.1); }
      } else if (ob.k === 'hole') {
        if (fast) { setAct('leap', (w + 1.4) / run.speed); run.stamina = Math.max(0, run.stamina - 0.05); run.airMax = 10; audio.leap(); haptic('light'); }
        else { setAct('fall', 1.35); run.fallTo = ob.x1 + 0.3; run.dist = (ob.x0 + ob.x1) / 2; audio.thud(); haptic('warning'); dust(); }
      } else if (ob.k === 'snag') {
        if (run.speed > 3.2) { setAct('stumble', 0.9); run.stamina = Math.max(0, run.stamina - 0.06); audio.thud(); haptic('warning'); run.dist = ob.x0 - 0.1; run.snagOb = ob; }
        else { setAct('duck', (w + 0.9) / Math.max(1.4, run.speed)); }
      }
    }
    function setAct(a, dur) { run.act = a; run.actT = 0; run.actDur = dur || 0; }
    function dust() { for (let i = 0; i < 6; i++) spark(L.PX + (Math.random() - 0.5) * 8, L.yFeet - 1, (Math.random() - 0.5) * 20, -10 - Math.random() * 14, 0.5, 'groundLit'); }

    function stepPlay(dt) {
      const d = diff(), hold = input.held;
      run.t += dt;
      if (hold && !run.started) { run.started = true; run.c.timer = 0; }
      if (!run.started) run.idleT += dt;
      const zone = world.zoneAt(run.dist);
      run.inZone = zone;
      const locked = run.act === 'vault' || run.act === 'leap' || run.act === 'stumble' || run.act === 'fall' || run.act === 'climb' || run.act === 'duck';
      if (locked) {
        run.actT += dt;
        if (run.act === 'stumble' || run.act === 'fall') run.speed = 0;
        else if (run.act === 'climb') run.speed = 1.3;
        else if (run.act === 'duck') run.speed = Math.max(1.4, Math.min(run.speed, TUNE.walk));
        const u = clamp(run.actT / Math.max(0.01, run.actDur), 0, 1);
        run.airH = run.act === 'vault' || run.act === 'leap' ? Math.sin(u * Math.PI) * run.airMax : run.act === 'climb' ? Math.sin(u * Math.PI) * 2 : 0;
        if (run.actT >= run.actDur) {
          if (run.act === 'fall') run.dist = run.fallTo;
          if (run.snagOb) { run.dist = run.snagOb.x1 + 0.2; run.snagOb = null; }
          run.airH = 0; run.act = hold ? 'run' : 'walk';
          if (run.act === 'run' && run.speed < 2) run.speed = 2;
        }
      } else if (hold) {
        if (run.act === 'hide') { audio.rustle(0.8); for (let i = 0; i < 5; i++) spark(L.PX + (Math.random() - 0.3) * 10, L.yFeet - 10 - Math.random() * 8, 10 + Math.random() * 20, -14, 0.6, 'tassel'); }
        run.act = 'run';
        const target = runSpeed();
        run.speed = run.speed < target ? Math.min(target, run.speed + TUNE.accel * dt) : Math.max(target, run.speed - TUNE.decel * dt);
      } else {
        if (zone && run.act !== 'hide' && run.started) {
          if (run.c.gap < TUNE.seenGap && run.c.mode !== 'wake') { caught('seen'); return; }
          run.act = 'hide'; run.speed = 0; zone.rustle = 1; audio.rustle(1); haptic('light');
          save.hints.hide = 1;
        }
        if (run.act !== 'hide') {
          run.act = run.started ? 'walk' : 'stand';
          const target = run.started ? TUNE.walk * (run.tired ? 0.8 : 1) : 0;
          run.speed = run.speed > target ? Math.max(target, run.speed - TUNE.decel * dt) : Math.min(target, run.speed + TUNE.accel * dt);
        }
      }
      // stamina
      if (run.act === 'run') run.stamina -= (TUNE.drain + TUNE.drainGain * d) * dt;
      else if (run.act === 'hide') run.stamina += (TUNE.recoverHide - 0.08 * d) * dt;
      else if (run.act === 'walk' || run.act === 'stand' || run.act === 'duck' || run.act === 'climb') run.stamina += TUNE.recoverWalk * dt;
      run.stamina = clamp(run.stamina, 0, 1);
      if (run.stamina <= 0.001 && !run.tired) { run.tired = true; haptic('warning'); }
      if (run.tired && run.stamina >= TUNE.rested) run.tired = false;
      // the hiding clock winds down slowly once you leave cover, so ducking out and back in buys nothing
      run.hideT = run.act === 'hide' ? run.hideT + dt : Math.max(0, run.hideT - dt * 0.8);
      // move
      run.dist += run.speed * dt;
      const prevStep = run.stepPh;
      run.ph += dt * (run.act === 'run' ? 2.4 + run.speed * 1.05 : 3.4 + run.speed * 1.4);
      run.stepPh = Math.floor(run.ph / Math.PI);
      if (run.stepPh !== prevStep && run.speed > 0.5 && run.airH === 0) audio.step(run.act !== 'run');
      // obstacles ahead
      if (!locked && run.act !== 'hide') {
        const ob = world.nextObstacle(run.dist);
        if (ob) {
          const lead = ob.k === 'hole' ? 0.6 : ob.k === 'snag' ? 0.35 : 0.45;
          if (run.dist >= ob.x0 - lead) resolveObstacle(ob);
          else if (ob.x0 - run.dist < 11) {
            if (ob.k === 'hole') showHint('hole', 'KEEP HOLDING TO LEAP');
            else if (ob.k === 'snag') showHint('snag', 'LET GO TO DUCK UNDER');
          }
        }
      }
      // hints
      if (!run.started && run.t > 0.6 && !run.hint) { run.hint = 'HOLD TO RUN'; run.hintT = 99; }
      if (run.started && run.hint === 'HOLD TO RUN') run.hintT = Math.min(run.hintT, 0.4);
      if (zone && run.act !== 'hide' && !save.hints.hide && run.hint !== 'LET GO TO HIDE') { run.hint = 'LET GO TO HIDE'; run.hintT = 2.5; }
      if (run.hintT > 0) { run.hintT -= dt; if (run.hintT <= 0) run.hint = ''; }
      updateCreature(dt);
      if (mode !== 'play') return;
      // heart while it searches beside you
      if (run.act === 'hide' && run.c.gap < 12) { run.heartT -= dt; if (run.heartT <= 0) { audio.heart(clamp(1 - run.c.gap / 12, 0.3, 1)); run.heartT = run.c.mode === 'search' ? 0.55 : 0.8; } }
      // world, stages, events
      world.update(run.dist, d, Math.floor(stageAt(run.dist)));
      const st = Math.floor(stageAt(run.dist) + 0.5);
      if (st > run.stageShown) { run.stageShown = st; run.stageToast = 3; try { ctx.platform.milestone && ctx.platform.milestone('stage_' + st); } catch (e) { } }
      if (run.stageToast > 0) run.stageToast -= dt;
      events(dt);
      if (run.act === 'tired' || (run.tired && run.act === 'run')) { if (Math.random() < dt * 3) spark(L.PX + 12, L.yFeet - 20, 6 + Math.random() * 6, -6, 0.7, 'cream', 'puff'); }
      if (run.stir.t > 0) run.stir.t -= dt;
      for (const f of world.feats) if (f.rustle) f.rustle = Math.max(0, f.rustle - dt * (run.act === 'hide' && f === zone && run.c.mode === 'search' ? 0.2 : 1.5));
      if (run.act === 'hide' && zone && run.c.mode === 'search' && Math.random() < dt * 1.5) zone.rustle = 1;
      for (const f of world.props) { if (f.lit > 0) f.lit -= dt; if (f.watch) f.look = lerp(f.look || 0, clamp((L.PX - propX(f)) / 10, -2, 2), dt * 3); }
      for (const f of world.feats) if (f.lit > 0) f.lit -= dt;
    }
    function propX(f) { return Math.round((f.x - run.dist) * PPM * 0.85 + L.PX); }

    function events(dt) {
      run.events -= dt; run.caw -= dt; run.creak -= dt;
      if (run.caw <= 0) { audio.caw(); run.caw = 7 + Math.random() * 9; }
      if (run.creak <= 0) { audio.creak(); run.creak = 9 + Math.random() * 8; }
      if (scene.windmillStop > 0) { scene.windmillStop -= dt; scene.windmillSpin = lerp(scene.windmillSpin, 0, dt * 2); } else scene.windmillSpin = lerp(scene.windmillSpin, 1, dt);
      if (scene.figure > 0) scene.figure -= dt;
      if (run.events > 0) return;
      run.events = 4 + Math.random() * 5;
      const r = Math.random();
      if (r < 0.22) spawnBats();
      else if (r < 0.40) { const pr = world.props.find(p => p.k === 'scarecrow' && propX(p) > L.PX + 10 && propX(p) < L.W); if (pr) pr.watch = true; else spawnBats(); }
      else if (r < 0.58) {
        const pk = world.props.find(p => p.k === 'pumpkin' && Math.abs(propX(p) - L.W * 0.6) < L.W * 0.4) || world.feats.find(f => f.v === 'pumpkin' && f.x0 > run.dist);
        if (pk) pk.lit = 1.3;
      }
      else if (r < 0.76) { run.stir.x = run.dist + 2 + Math.random() * 6; run.stir.t = 2.2; audio.rustle(0.7); }
      else if (r < 0.88) scene.windmillStop = 6;
      else if (run.c.gap < 26) { scene.figure = 1.1; scene.figureX = L.W * (0.55 + Math.random() * 0.35); }
    }
    function spawnBats() {
      const dir = Math.random() < 0.5 ? 1 : -1, y0 = L.H * (0.1 + Math.random() * 0.2);
      for (let i = 0; i < 9; i++) run.bats.push({ x: dir > 0 ? -10 - i * 7 - Math.random() * 10 : L.W + 10 + i * 7, y: y0 + (Math.random() - 0.5) * 22, vx: dir * (45 + Math.random() * 25), ph: Math.random() * 6 });
      audio.bats();
    }

    // ---------- input ----------
    let buttons = [];
    const pauseRect = () => ({ x: W - 15, y: safeT + 2, w: 13, h: 13 });
    function toLogical(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) * dpr - offX) / SC, y: ((e.clientY - rect.top) * dpr - offY) / SC };
    }
    const inRect = (p, r) => p.x >= r.x - 3 && p.x <= r.x + r.w + 3 && p.y >= r.y - 3 && p.y <= r.y + r.h + 3;
    function press(p) {
      if (mode === 'play') {
        if (inRect(p, pauseRect())) { pause(); return false; }
        return true;
      }
      if (modeT < 0.35) return false;
      for (const bt of buttons) if (inRect(p, bt)) { audio.ui(); bt.fn(); return false; }
      if (mode === 'title') { audio.ui(); begin(); }
      return false;
    }
    ctx.listen(canvas, 'pointerdown', e => {
      audio.unlock();
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (er) { }
      if (press(toLogical(e))) input.pointers.add(e.pointerId);
      e.preventDefault && e.preventDefault();
    });
    const up = e => { input.pointers.delete(e.pointerId); };
    ctx.listen(canvas, 'pointerup', up);
    ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(canvas, 'lostpointercapture', up);
    const HOLD_KEYS = { Space: 1, ArrowRight: 1, ArrowUp: 1, KeyD: 1, KeyW: 1 };
    ctx.listen(window, 'keydown', e => {
      audio.unlock();
      if (HOLD_KEYS[e.code]) {
        e.preventDefault && e.preventDefault();
        if (mode === 'play') input.key = true;
        else if (!e.repeat && (mode === 'title' || mode === 'over') && modeT > 0.35) { audio.ui(); begin(); }
      } else if (e.code === 'Enter' && !e.repeat) {
        if (mode === 'title' || mode === 'over') { if (modeT > 0.35) { audio.ui(); begin(); } }
        else if (mode === 'paused') resume();
      } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (mode === 'play') pause(); else if (mode === 'paused') resume();
      }
    });
    ctx.listen(window, 'keyup', e => { if (HOLD_KEYS[e.code]) input.key = false; });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) { pause(); audio.suspend(); } });
    ctx.listen(window, 'blur', () => { input.key = false; input.pointers.clear(); });

    // ---------- drawing ----------
    function creatureView(c, t) {
      const gap = c.gap;
      if (gap >= 26) {
        const u = clamp((gap - 26) / 18, 0, 1);
        // it sinks into the corn and rises again; nearer, it shows more often
        const show = Math.sin(t * 0.55 + 1) > lerp(-0.4, 0.45, u) ? 1 : 0;
        c.sink = lerp(c.sink || 0, show ? 0 : 14, 0.06);
        return { layer: 'far', k: 0.3, x: Math.round(lerp(W * 0.22, W * 0.07, u) + Math.sin(t * 0.3) * 3), gy: Math.round(L.yDist + 30 + c.sink) };
      }
      if (gap >= 11) {
        const u = (26 - gap) / 15;
        return { layer: 'mid', k: Math.round(lerp(0.45, 0.72, u) * 20) / 20, x: Math.round(lerp(W * 0.08, L.PX - 46, u) + Math.sin(t * 0.4) * 3), gy: Math.round(lerp(L.yMid + 40, L.yBack + 30, u)) };
      }
      const u = (11 - gap) / 11;
      return { layer: 'near', k: Math.round(lerp(0.78, 1.0, u) * 20) / 20, x: Math.round(L.PX - 12 - gap * 3.6), gy: L.yFeet - 4 };
    }
    function drawCreatureAt(v, c, p, t, extra) {
      drawCreature(v.x, v.gy, v.k, Object.assign({ facing: c.facing, phase: Math.floor(c.phase * 8 / TAU * 2) / (8 / TAU * 2), t, reach: c.reach, rx: L.PX + 6 + Math.sin(t * 0.9) * 12, ry: L.yFeet - 12, scan: c.scan, eyes: c.eyes, tilt: Math.round(Math.sin(t * 0.37) * 2) / 10 }, extra || {}), p);
    }
    function drawShadow(v, p, strength) {
      // its shadow reaches along the path before it does (the sun is behind it)
      const len = Math.round(lerp(10, 70, strength)), x0 = v.x - 2, y0 = L.yFeet - 4;
      poly([x0, y0, x0 + 5, y0, x0 + len + 8, y0 + 7, x0 + len, y0 + 8], FIX.ink, true);
      poly([x0 + len * 0.55, y0 + 3, x0 + len * 0.55 + 3, y0 + 3, x0 + len + 14, y0 - 2, x0 + len + 12, y0 - 1], FIX.ink, true);
    }

    function drawWorld(p, stageF, dist, t, dt, cr, playerPose, hidden, zoneNow) {
      const camPx = dist * PPM - L.PX;
      scene.drawSky(L, p, stageF, camPx, t);
      // birds drift high and slow
      for (let i = 0; i < 3; i++) {
        const x = Math.round(((i * 61 + t * (4 + i)) % (W + 40)) - 20), y = Math.round(L.H * (0.12 + i * 0.05) + Math.sin(t * 0.8 + i) * 2);
        const up = Math.floor(t * 3 + i) & 1;
        R(x - 2, y - up, 2, 1, p.sil); R(x + 1, y - up, 2, 1, p.sil); R(x, y, 1, 1, p.sil);
      }
      if (run) for (const bt of run.bats) {
        const x = Math.round(bt.x), y = Math.round(bt.y + Math.sin(bt.ph) * 3), f = Math.floor(bt.ph * 2) % 3;
        R(x - 1, y, 3, 1, FIX.ink);
        if (f === 0) { R(x - 3, y - 1, 2, 1, FIX.ink); R(x + 2, y - 1, 2, 1, FIX.ink); }
        else if (f === 1) { R(x - 3, y, 2, 1, FIX.ink); R(x + 2, y, 2, 1, FIX.ink); }
        else { R(x - 3, y + 1, 2, 1, FIX.ink); R(x + 2, y + 1, 2, 1, FIX.ink); }
      }
      scene.drawDistance(L, p, camPx, t, dt);
      if (cr && cr.v.layer === 'far') drawCreatureAt(cr.v, cr.c, p, t);
      scene.drawDistCorn(L, p, camPx, t);
      if (cr && cr.v.layer === 'mid') drawCreatureAt(cr.v, cr.c, p, t);
      scene.drawMidCorn(L, p, camPx, t);
      // back-row pumpkins sit low in the stalks
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'back') { const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFeet - 5, 0, p, pr.lit || 0); }
      scene.drawBackRow(L, p, camPx, t, run && run.stir);
      for (const pr of world.props) {
        if (pr.k === 'pumpkin') continue;
        const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX);
        if (x > -30 && x < W + 30) drawProp(pr, x, L, p, t);
      }
      if (cr && cr.v.layer === 'near') drawCreatureAt(cr.v, cr.c, p, t, cr.extra);
      scene.drawPath(L, p, camPx);
      if (cr && cr.v.layer !== 'far') drawShadow(cr.v, p, cr.v.layer === 'near' ? 1 : 0.35);
      for (const f of world.feats) {
        if (f.k === 'hide') continue;
        const sx = (f.x0 - dist) * PPM + L.PX, ex = (f.x1 - dist) * PPM + L.PX;
        if (ex > -20 && sx < W + 20) drawObstacle(f, Math.round(sx), Math.round(ex), L, p, t);
      }
      if (playerPose) {
        const info = drawPlayer(L.PX - 8, L.yFeet - Math.round(playerPose.air || 0), playerPose);
        playerPose.top = info.top;
      }
      scene.drawFront(L, p, camPx, t);
      for (const f of world.feats) if (f.k === 'hide') scene.drawClump(L, p, camPx, f, t, f.rustle || 0);
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'front') { const x = Math.round((pr.x - dist) * PPM + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFront + 8, pr.size, p, pr.lit || 0); }
      // foreground blades at the bottom edge frame the picture
      const fo = camPx * 1.3;
      for (let i = Math.floor(fo / 34) - 1; i <= Math.floor((fo + W) / 34) + 1; i++) {
        const hh = hash(i + 4242); if (hh > 0.45) continue;
        const x = Math.round(i * 34 - fo + hh * 20), top = L.H - 14 - Math.round(hh * 22);
        poly([x, L.H, x + 3, L.H, x + 6 + hh * 8, top, x + 2 + hh * 6, top + 2], FIX.ink);
        R(x + 1, top + 10, 1, 4, p.frontLeaf);
      }
    }

    function drawButton(label, cx, y, fn, primary) {
      const w = textW(label, F5) + 12, x = Math.round(cx - w / 2), h = 13;
      R(x, y, w, h, FIX.ink);
      R(x, y, w, 1, primary ? FIX.cream : '#8a6a5a'); R(x, y + h - 1, w, 1, primary ? FIX.cream : '#8a6a5a');
      R(x, y, 1, h, primary ? FIX.cream : '#8a6a5a'); R(x + w - 1, y, 1, h, primary ? FIX.cream : '#8a6a5a');
      R(x + 1, y + h, w, 1, '#000000');
      text(label, x + 6, y + 3, primary ? FIX.cream : '#d9c09a', F5);
      if (primary && Math.floor(clock * 2) % 2 === 0) { R(x - 5, y + 4, 1, 5, FIX.cream); R(x - 4, y + 5, 1, 3, FIX.cream); R(x - 3, y + 6, 1, 1, FIX.cream); }
      buttons.push({ x, y, w, h, fn });
    }
    function tag(label, cx, y, c) {
      const w = textW(label, F3) + 6, x = Math.round(cx - w / 2);
      R(x, y, w, 9, FIX.ink); text(label, x + 3, y + 2, c || FIX.cream, F3);
      return { x, w };
    }

    function drawHUD(p) {
      const y0 = safeT + 4;
      text('DISTANCE', 4, y0, FIX.cream, F3, 1, FIX.ink);
      text(Math.floor(run.dist) + ' M', 4, y0 + 7, FIX.cream, F5, 1, FIX.ink);
      text('BEST ' + Math.max(save.best, Math.floor(run.dist)) + ' M', 4, y0 + 17, FIX.cream, F3, 1, FIX.ink);
      const pr = pauseRect();
      R(pr.x, pr.y, pr.w, pr.h, FIX.ink); R(pr.x + 4, pr.y + 3, 2, 7, FIX.cream); R(pr.x + 8, pr.y + 3, 2, 7, FIX.cream);
      // danger: it is close and still has you
      const c = run.c, hunting = c.mode === 'hunt' || c.mode === 'reacquire';
      if (hunting && c.gap < 14 && run.act !== 'hide') {
        const hot = c.gap < 7;
        if (Math.floor(clock * (hot ? 6 : 3)) % 2 === 0 || !hot) {
          const t = tag('DANGER', W / 2, y0 + 1, hot ? FIX.ember : FIX.cream);
          R(t.x - 4, y0 + 4, 2, 2, FIX.glowHot); R(t.x + t.w + 2, y0 + 4, 2, 2, FIX.glowHot);
        }
      }
      if (run.stageToast > 0 && run.stageShown > 0) {
        const nm = STAGE_NAMES[Math.min(3, run.stageShown)], y = Math.round(H * 0.36);
        if (run.stageToast > 0.4 || Math.floor(clock * 8) % 2) {
          const w = textW(nm, F3);
          text(nm, W / 2 - w / 2, y, FIX.cream, F3, 1, FIX.ink);
          R(Math.round(W / 2 - w / 2 - 10), y + 2, 6, 1, FIX.cream); R(Math.round(W / 2 + w / 2 + 4), y + 2, 6, 1, FIX.cream);
        }
      }
      if (run.hint) tag(run.hint, W / 2, Math.round(H * 0.42), FIX.cream);
      // contextual tags above the traveller
      const top = (run.pose && run.pose.top) || L.yFeet - 26;
      if (run.inZone && run.act !== 'hide' && run.started) {
        if (Math.floor(clock * 4) % 2 === 0 || run.c.gap > 14) {
          tag('HIDE', L.PX, top - 13, FIX.glow);
          R(L.PX - 1, top - 4, 3, 1, FIX.ink); R(L.PX, top - 3, 1, 1, FIX.ink);
        }
      }
      if (run.act === 'hide') {
        const win = hideWindow(), left = clamp(1 - run.hideT / win, 0, 1), n = Math.ceil(left * 5);
        const x0 = L.PX - 7, y = top - 7;
        R(x0 - 2, y - 2, 18, 6, FIX.ink);
        for (let i = 0; i < 5; i++) {
          const on = i < n, warn = n <= 1 && Math.floor(clock * 6) % 2 === 0;
          R(x0 + i * 3, y, 2, 2, on ? (warn ? FIX.ember : FIX.cream) : '#4a3a32');
        }
      }
      // breath: the only meter
      const bw = 40, bx = Math.round(W / 2 - bw / 2 + 12), by = H - 9 - safeB;
      text('BREATH', bx - 27, by - 1, run.tired ? FIX.ember : FIX.cream, F3, 1, FIX.ink);
      R(bx - 1, by - 1, bw + 2, 5, FIX.ink);
      const low = run.stamina < TUNE.tiredAt, fc = run.tired ? (Math.floor(clock * 4) % 2 ? FIX.ember : '#7a2a2a') : low ? (Math.floor(clock * 3) % 2 ? FIX.ember : FIX.glow) : FIX.cream;
      R(bx, by, Math.round(bw * run.stamina), 3, fc);
      R(bx + Math.round(bw * TUNE.rested), by + 3, 1, 1, '#8a6a5a');
    }

    function playerPose() {
      const a = run.act;
      let m = 'idle';
      if (a === 'run') m = run.tired ? 'tired' : 'run';
      else if (a === 'walk') m = run.tired ? 'tired' : 'walk';
      else if (a === 'hide') m = 'crouch';
      else if (a === 'duck') m = 'duck';
      else if (a === 'vault' || a === 'leap') m = 'air';
      else if (a === 'climb') m = 'walk';
      else if (a === 'stumble') m = 'tired';
      else if (a === 'fall') m = 'crouch';
      let air = run.airH || 0;
      if (a === 'fall') { const u = run.actT / run.actDur; air = u < 0.3 ? -u / 0.3 * 9 : -9 + (u - 0.3) / 0.7 * 9; }
      const blink = (clock % 3.1) < 0.12;
      return { mode: m, ph: run.ph, t: clock, air, blink, lift: 0 };
    }

    function render(dt) {
      setTarget(b);
      buttons = [];
      const t = clock;
      if (mode === 'title') {
        const p = paletteAt(0);
        const c = { facing: 1, phase: 0.6, reach: 0, scan: Math.round(Math.sin(t * 0.4) * 2) / 2, eyes: (t % 4.3) < 0.15 ? 0 : 1 };
        const v = { layer: 'far', k: 0.62, x: Math.round(W * 0.76), gy: Math.round(L.yDist + 16) };
        drawWorld(p, 0, 0, t, dt, { v, c }, { mode: 'idle', ph: 0, t, blink: (t % 3.3) < 0.12 }, false, null);
        // title, set like a book cover
        const ty = safeT + Math.round(H * 0.07);
        textC('HOLLOW', W / 2, ty, FIX.cream, F5, 2, '#5a1a2a');
        textC('HARVEST', W / 2, ty + 18, FIX.cream, F5, 2, '#5a1a2a');
        R(Math.round(W / 2 - 30), ty + 36, 60, 1, '#5a1a2a');
        textC('SOMETHING IS IN THE FIELD.', W / 2, ty + 40, '#5a1a2a', F3);
        const by = H - safeB - Math.round(H * 0.15);
        drawButton('ENTER THE FIELD', W / 2, by, begin, true);
        textC('HOLD TO RUN. LET GO TO HIDE.', W / 2, by + 18, FIX.cream, F3, 1, FIX.ink);
        if (save.best > 0) textC('BEST ' + save.best + ' M', W / 2, by + 26, '#d9c09a', F3, 1, FIX.ink);
        return;
      }
      if (mode === 'over') { renderOver(); return; }
      const stageF = stageAt(run.dist), p = paletteAt(stageF);
      const pose = playerPose(); run.pose = pose;
      let cr = { v: creatureView(run.c, t), c: run.c };
      if (run.c.mode === 'wake') cr.c = Object.assign({}, run.c, { phase: 0.4 });
      if (mode === 'caught') {
        const ct = modeT;
        if (ct >= 0.6) { renderCaughtClose(p, ct); return; }
        const u = clamp(ct / 0.45, 0, 1);
        cr.v = { layer: 'near', k: 1.05, x: Math.round(lerp(cr.v.x, L.PX - 16, u)), gy: L.yFeet - 4 };
        const top = pose.top || L.yFeet - 26;
        cr.extra = { reach: Math.min(1, u * 1.3), rx: L.PX - 1, ry: top + 6 - Math.max(0, ct - 0.3) * 40 };
        cr.c = Object.assign({}, run.c, { facing: 1 });
        pose.mode = ct > 0.3 ? 'lifted' : 'crouch'; pose.lift = Math.max(0, ct - 0.3) * 40; pose.air = 0;
      }
      drawWorld(p, stageF, run.dist, t, dt, cr, pose, run.act === 'hide', run.inZone);
      // particles
      for (const q of run.particles) {
        const c = FIX[q.c] || p[q.c] || q.c;
        if (q.kind === 'puff') { if (q.life / q.max > 0.3) R(Math.round(q.x), Math.round(q.y), 2, 1, c); }
        else if (q.kind === 'leaf') { const f = Math.floor(q.life * 6) & 1; R(Math.round(q.x), Math.round(q.y), f ? 2 : 1, f ? 1 : 2, c); }
        else R(Math.round(q.x), Math.round(q.y), 1, 1, c);
      }
      // threat: the field darkens and the edges close in
      const c = run.c;
      let threat = 0;
      if (run.act !== 'hide') threat = clamp((14 - c.gap) / 12, 0, 1) * (c.mode === 'hunt' || c.mode === 'reacquire' ? 1 : 0.4);
      else threat = c.mode === 'search' ? 0.55 : c.gap < 12 ? 0.3 : 0;
      run.threat = threat;
      if (threat > 0.05) { G.globalAlpha = 0.24 * threat; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      const vl = Math.max(stageF > 2.5 ? 1 : 0, threat > 0.75 ? 3 : threat > 0.45 ? 2 : threat > 0.12 ? 1 : 0);
      if (vl > 0) G.drawImage(vign[vl - 1], 0, 0);
      if (run.act === 'hide') { G.globalAlpha = 0.16; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      if (mode === 'play' || mode === 'paused') drawHUD(p);
      if (mode === 'paused') {
        G.globalAlpha = 0.7; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1;
        textC('PAUSED', W / 2, Math.round(H * 0.34), FIX.cream, F5, 2, '#5a1a2a');
        drawButton('RESUME', W / 2, Math.round(H * 0.50), resume, true);
        drawButton('MAIN MENU', W / 2, Math.round(H * 0.50) + 20, toTitle, false);
      }
    }
    function renderCaughtClose(p, ct) {
      if (ct < 1.15) {
        // the silhouette fills the frame, in two hard steps
        R(0, 0, W, H, p.sky1);
        R(0, Math.round(H * 0.62), W, H, FIX.blood);
        const k = ct < 0.85 ? 1.8 : 2.5;
        drawCreature(Math.round(W * 0.42), Math.round(H * (ct < 0.85 ? 1.05 : 1.22)), k, { facing: 1, phase: 0.3, t: clock, reach: 0, scan: 0, eyes: 1, tilt: 0.1 }, p);
        G.drawImage(vign[2], 0, 0);
        return;
      }
      R(0, 0, W, H, FIX.blood);
      if (ct < 1.6) { const ex = Math.round(W * 0.5), ey = Math.round(H * 0.3); R(ex - 9, ey, 3, 3, FIX.glowHot); R(ex + 5, ey + 1, 3, 3, FIX.glowHot); }
    }
    function renderOver() {
      R(0, 0, W, H, FIX.blood);
      // faint dither band and a pair of eyes that do not leave
      for (let y = Math.round(H * 0.7); y < H; y++) for (let x = (y & 1); x < W; x += 2) if (((x >> 1) + y) % 3 === 0) R(x, y, 1, 1, FIX.bloodHi);
      if ((clock % 5) > 0.2) { const ex = Math.round(W * 0.5), ey = safeT + Math.round(H * 0.1); R(ex - 7, ey, 2, 2, FIX.ember); R(ex + 4, ey + 1, 2, 2, FIX.ember); }
      const msg = 'THE HARVEST IS OVER.', y1 = Math.round(H * 0.27);
      if (textW(msg, F5) <= W - 8) textC(msg, W / 2, y1, FIX.cream, F5, 1, '#000000');
      else { textC('THE HARVEST', W / 2, y1 - 5, FIX.cream, F5, 1, '#000000'); textC('IS OVER.', W / 2, y1 + 5, FIX.cream, F5, 1, '#000000'); }
      const cause = run.cause === 'found' ? 'IT FOUND YOUR HIDING PLACE.' : run.cause === 'seen' ? 'IT SAW YOU GO INTO THE CORN.' : 'IT CAUGHT UP.';
      textC(cause, W / 2, y1 + 16, '#c98a7c', F3);
      const d = Math.floor(run.dist);
      textC('DISTANCE: ' + d + ' M', W / 2, Math.round(H * 0.43), FIX.cream, F5, 1, '#000000');
      textC('PERSONAL BEST: ' + save.best + ' M', W / 2, Math.round(H * 0.43) + 12, '#d9c09a', F3);
      if (run.record && Math.floor(clock * 3) % 2 === 0) textC('NEW BEST', W / 2, Math.round(H * 0.43) + 21, FIX.glow, F3);
      const by = Math.round(H * 0.62);
      drawButton('TRY AGAIN', W / 2, by, begin, true);
      drawButton('MAIN MENU', W / 2, by + 20, toTitle, false);
    }

    // ---------- blit: whole pixels only ----------
    function blit() {
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#0b0807'; g.fillRect(0, 0, canvas.width, canvas.height);
      const unstable = mode === 'play' && run.threat > 0.65 && run.act !== 'hide';
      if (!unstable) { g.drawImage(buf, 0, 0, W, H, offX, offY, W * SC, H * SC); return; }
      run.jitterT -= 1 / 60;
      if (run.jitterT <= 0) {
        run.jitterT = 0.07; run.jitter.length = 0;
        for (let y = 0; y < H; y += 4) run.jitter.push(Math.random() < (run.threat - 0.6) * 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      }
      for (let i = 0, y = 0; y < H; y += 4, i++) {
        const h = Math.min(4, H - y), dx = run.jitter[i] || 0;
        g.drawImage(buf, 0, y, W, h, offX + dx * SC, offY + y * SC, W * SC, h * SC);
      }
    }

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function updateFx(dt) {
      if (!run) return;
      for (const q of run.particles) { q.x += q.vx * dt - (mode === 'play' ? run.speed * PPM * dt : 0); q.y += q.vy * dt; q.vy += (q.kind === 'leaf' ? 4 : q.kind === 'puff' ? -4 : 30) * dt; q.life -= dt; if (q.kind === 'leaf') q.vx += Math.sin(clock * 3 + q.y) * 6 * dt; }
      run.particles = run.particles.filter(q => q.life > 0 && q.x > -10 && q.x < W + 10);
      for (const bt of run.bats) { bt.x += bt.vx * dt; bt.ph += dt * 14; bt.y += Math.sin(bt.ph * 0.3) * 0.3; }
      run.bats = run.bats.filter(bt => bt.x > -90 && bt.x < W + 90);
      if (Math.random() < dt * 1.4) spark(W * (0.3 + Math.random() * 0.8), L.yBack - 6 - Math.random() * 20, -8 - Math.random() * 8, 4, 4, Math.random() < 0.5 ? 'pumpkin' : 'backLeafLit', 'leaf');
    }
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      clock += dt; modeT += dt;
      if (mode === 'play') {
        acc += dt; let n = 0;
        while (acc >= DT && n < 6 && mode === 'play') { stepPlay(DT); acc -= DT; n++; }
        if (n === 6) acc = 0;
      } else acc = 0;
      if (mode === 'caught' && modeT > 1.75) { mode = 'over'; modeT = 0; }
      if (mode !== 'paused') updateFx(dt);
      const playing = mode === 'play';
      audio.update({
        dt, playing, hidden: playing && run.act === 'hide',
        run: playing ? clamp(run.speed / 8, 0, 1) : 0,
        prox: playing ? clamp(1 - run.c.gap / 26, 0, 1) : mode === 'caught' ? 1 : 0,
        tired: playing && run.tired ? 1 : playing ? clamp((TUNE.tiredAt - run.stamina) / TUNE.tiredAt, 0, 1) * 0.5 : 0,
        exert: playing && run.act === 'run' ? 1 - run.stamina : 0,
        rustle: playing && run.inZone ? run.inZone.rustle || 0 : 0
      });
      render(dt);
      blit();
    }

    ctx.onResize(() => layout(), { immediate: true });
    if (!buf.width || buf.width === 300) layout();
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));
    tick(16);
    try { ctx.markVisualReady && ctx.markVisualReady('title'); } catch (e) { }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__HH_DEV) {
      window.__hh = {
        get run() { return run; }, get mode() { return mode; }, save: () => save, world, TUNE, begin, pause, resume, toTitle,
        hold(v) { input.key = !!v; },
        advance(sec, hold) { if (hold !== undefined) input.key = !!hold; const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) stepPlay(DT); },
        size: () => ({ W, H, SC, offX, offY })
      };
    }
  }
};

})();
