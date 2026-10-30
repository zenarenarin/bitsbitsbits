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
