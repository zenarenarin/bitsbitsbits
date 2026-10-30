// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// CATCH THE EYEBALL — a 30-second Halloween arcade Bit for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// CATCH THE EYEBALL — shared helpers and the palette.
// World units are art pixels: x is centred on the screen, y grows upward
// from the bottom edge. One unit is one texel of the low-res framebuffer.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => t * t * (3 - 2 * t);

function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

// Limited colour ramps. Every sprite in the game is painted from these.
const PAL = {
  outline: '#2a0c15',        // dark maroon line work
  outlineSoft: '#4a1822',
  void: '#120609',           // pupils, jar mouth
  // dirty ivory sclera, darkest to lightest (shadow leans pink-brown)
  sclera: ['#6e4a4c', '#9c7d70', '#c4ad8f', '#ddcfae', '#efe5cb'],
  scleraBlood: ['#6f3c45', '#a06a6c', '#c99a8e', '#e0bfab', '#efd8c4'],
  scleraSick: ['#4f2d36', '#7e5559', '#a8837a', '#c7ae98', '#dccbb0'],
  vein: '#9b2f3d', veinDeep: '#6d1a28', veinPink: '#cd7f86', rimPink: '#b97677',
  gloss: '#fffaf0',
  // iris ramps: limbal ring, base, lit, fleck
  irisTeal: ['#0f2c30', '#22564f', '#3f8379', '#79b8a8'],
  irisBrown: ['#2a160e', '#57331d', '#86542c', '#bd8a4e'],
  irisBlood: ['#24100f', '#4a2119', '#6e3524', '#a2583a'],
  irisGold: ['#4a2a08', '#8a5a14', '#c48a2a', '#efc66a'],
  irisDemon: ['#0c0306', '#2c0710', '#561322', '#8e2433'],
  irisWarp: ['#0f2c30', '#2a6a66', '#5ea99d', '#a9dccb'],
  irisSplit: ['#2b0f15', '#5b2228', '#874033', '#b46c4e'],
  // eyelid flesh
  lid: ['#3a121d', '#5c2231', '#7d3846', '#9e5860'],
  // glass and liquid
  glass: '#a5b7a6', glassDark: '#2c3833', glassEdge: '#18201d', glassHi: '#e3efe5',
  rimLight: '#c2d2c2', rimMid: '#7d8f84', rimShade: '#4b5a53',
  liquid: '#77804f', liquidHi: '#a8ad72',
  label: '#c9bc97', labelShade: '#9b8c6a', ink: '#4a1822',
  // room
  wall: ['#140c13', '#1b1119', '#23161f', '#2c1c27', '#372431'],
  wood: ['#170d0d', '#24140f', '#331d15', '#47291b'],
  stone: ['#120b0f', '#1c1217', '#271a1f', '#33232a'],
  candle: ['#6b5a4c', '#a8927a', '#d6c4a5'],
  flame: ['#7a2a1e', '#c4562a', '#e8a04a', '#f6dc9a'],
  bottle: ['#1f2a28', '#2c3b37', '#3e524b', '#5f7a6f'],
  bottleRed: ['#2a1016', '#43161f', '#5f2230', '#8a3a46'],
  web: '#5a4d55',
  dust: '#a28f86'
};

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- 01_sprites.js ----
// =====================================================================
// Pixel-art authoring. Every sprite is painted texel by texel from the
// palette ramps; nothing is a filtered or downscaled illustration.
//
// An eyeball is four stacked layers so it can stay alive on screen:
//   sclera (silhouette, shading, veins)  — fixed
//   iris   (iris, pupil)                 — slides a few texels to look around
//   gloss  (specular cluster)            — fixed, so the light never moves
//   lid    (closed / half-closed frames) — blinks, spawns and vanishes
// =====================================================================

const rgbCache = new Map();
function rgbOf(col) { let v = rgbCache.get(col); if (!v) { v = hexRgb(col); rgbCache.set(col, v); } return v; }

// A sprite is a plain RGBA buffer { width, height, data }, rows top to bottom.
// It becomes a GPU texture directly; no DOM canvas is involved.
function Px(w, h) {
  const d = new Uint8Array(w * h * 4);
  const c = { width: w, height: h, data: d };
  const p = {
    w, h, canvas: c,
    set(x, y, col, a) {
      x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return;
      const [r, gg, b] = rgbOf(col); const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = Math.round((a === undefined ? 1 : a) * 255);
    },
    alpha(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return 0; return d[(y * w + x) * 4 + 3]; },
    clear(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return; d[(y * w + x) * 4 + 3] = 0; },
    rect(x0, y0, rw, rh, col, a) { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) p.set(x, y, col, a); },
    line(x0, y0, x1, y1, col, a) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let e = dx + dy;
      for (;;) { p.set(x0, y0, col, a); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    },
    done() { return c; }
  };
  return p;
}

// 4x4 ordered dither threshold, used only for large, quiet room gradients.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)];

// ---------------------------------------------------------------------
// Eyeball family
// ---------------------------------------------------------------------
const EYE_KINDS = {
  teal:  { sclera: 'sclera', iris: 'irisTeal', veins: 3, wob: 0.55, seed: 11, pupil: 0.46 },
  brown: { sclera: 'sclera', iris: 'irisBrown', veins: 4, wob: 0.6, seed: 23, pupil: 0.5 },
  blood: { sclera: 'scleraBlood', iris: 'irisBlood', veins: 9, long: true, wob: 0.75, seed: 37, pupil: 0.52, blotch: true },
  gold:  { sclera: 'sclera', iris: 'irisGold', veins: 2, wob: 0.45, seed: 41, pupil: 0.4, sunburst: true },
  demon: { sclera: 'scleraSick', iris: 'irisDemon', veins: 6, long: true, wob: 1.3, seed: 53, pupil: 0.16, hot: true, oval: true },
  warp:  { sclera: 'sclera', iris: 'irisWarp', veins: 2, wob: 0.5, seed: 61, pupil: 0.3, rings: true },
  split: { sclera: 'sclera', iris: 'irisSplit', veins: 4, wob: 0.65, seed: 71, pupils: 3, bud: true }
};
const LIGHT = (() => { const l = [-0.45, -0.55, 0.7]; const m = Math.hypot(l[0], l[1], l[2]); return l.map(v => v / m); })();

function eyeShape(D, k) {
  const rng = makeRng(k.seed * 7 + D);
  const p1 = rng() * TAU, p2 = rng() * TAU, bud = -0.7 + rng() * 0.3;
  const R0 = D / 2 - 1.5;
  const radiusAt = a => {
    let r = R0 + k.wob * (D / 22) * (0.55 * Math.sin(2 * a + p1) + 0.45 * Math.sin(3 * a + p2));
    if (k.bud) r += 1.7 * (D / 22) * Math.pow(Math.max(0, Math.cos(a - bud)), 8);
    return r;
  };
  const mask = new Uint8Array(D * D);
  const c = D / 2;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    if (Math.hypot(dx, dy) <= radiusAt(Math.atan2(dy, dx))) mask[y * D + x] = 1;
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < D && y < D && mask[y * D + x] === 1;
  return { D, c, R0, radiusAt, inside, rng };
}

function shadeLevel(dx, dy, rr, bias) {
  const t = Math.min(1, Math.hypot(dx, dy) / rr);
  const nz = Math.sqrt(Math.max(0, 1 - t * t));
  const nx = dx / rr, ny = dy / rr;
  const lam = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + (bias || 0);
  return lam > 0.86 ? 4 : lam > 0.6 ? 3 : lam > 0.3 ? 2 : lam > 0.02 ? 1 : 0;
}

// Remove lone shading pixels so every cluster reads as placed, not noisy.
function tidyLevels(lv, D, inside) {
  const out = lv.slice();
  for (let y = 1; y < D - 1; y++) for (let x = 1; x < D - 1; x++) {
    if (!inside(x, y)) continue;
    const v = lv[y * D + x], n = [lv[y * D + x - 1], lv[y * D + x + 1], lv[(y - 1) * D + x], lv[(y + 1) * D + x]];
    if (n.some(q => q < 0)) continue;
    if (n.every(q => q !== v)) { n.sort((a, b) => a - b); out[y * D + x] = n[1]; }
  }
  return out;
}

function outlineMask(px, D, inside, col) {
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (inside(x, y)) continue;
    if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) px.set(x, y, col);
  }
}

function paintSclera(S, k, hot) {
  const { D, c, radiusAt, inside } = S;
  const ramp = PAL[hot ? 'scleraBlood' : k.sclera];
  const px = Px(D, D);
  const lv = new Int8Array(D * D).fill(-1);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (!inside(x, y)) continue;
    const dx = x + 0.5 - c, dy = y + 0.5 - c, a = Math.atan2(dy, dx), rr = radiusAt(a);
    let l = shadeLevel(dx, dy, rr);
    if (Math.hypot(dx, dy) > rr - 1.1 && l > 0) l--;       // rolled-off rim
    lv[y * D + x] = l;
  }
  const t = tidyLevels(lv, D, inside);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) if (inside(x, y)) px.set(x, y, ramp[t[y * D + x]]);
  // pink tissue where the eyeball meets its socket, lower right
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (!inside(x, y)) continue;
    const dx = x + 0.5 - c, dy = y + 0.5 - c, a = Math.atan2(dy, dx);
    const edge = Math.hypot(dx, dy) > radiusAt(a) - 1.1;
    if (edge && a > -0.2 && a < 2.2) px.set(x, y, PAL.rimPink);
  }
  // veins: crawl from the rim toward the iris, with a pink halo and the odd fork
  const rng = makeRng(k.seed * 13 + D);
  const ri = Math.round(D * 0.24), stopR = ri - 0.5;   // the iris layer covers the inner ends
  const n = Math.max(1, Math.round(k.veins * (D >= 20 ? 1 : 0.6)));
  const veinCol = hot ? '#c03642' : PAL.vein;
  for (let i = 0; i < n; i++) {
    let a = (i / n) * TAU + rng.range(-0.35, 0.35);
    if (a > Math.PI * 1.05 && a < Math.PI * 1.45 && !k.long) a += 0.9;   // keep the lit quadrant clean
    let r = radiusAt(a) - 1, x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const len = (k.long ? rng.int(5, 8) : rng.int(3, 5)) * (D / 22);
    let dir = a + Math.PI;
    for (let s = 0; s < len; s++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (Math.hypot(ix + 0.5 - c, iy + 0.5 - c) < stopR) break;
      if (inside(ix, iy)) px.set(ix, iy, s === 0 ? PAL.veinDeep : veinCol);
      if (s > 0 && rng.chance(0.28)) { const sx = ix + (rng.chance(0.5) ? 1 : 0), sy = iy + (rng.chance(0.5) ? 0 : 1); if (inside(sx, sy)) px.set(sx, sy, PAL.veinPink); }
      if (s === 2 && D >= 20 && rng.chance(0.6)) {
        const fa = dir + rng.sign() * 0.9; let fx = x, fy = y;
        for (let f = 0; f < 2; f++) { fx += Math.cos(fa); fy += Math.sin(fa); if (inside(Math.floor(fx), Math.floor(fy))) px.set(Math.floor(fx), Math.floor(fy), veinCol); }
      }
      dir += rng.range(-0.55, 0.55);
      x += Math.cos(dir); y += Math.sin(dir);
    }
  }
  if (k.blotch || hot) {
    for (let i = 0; i < (D >= 20 ? 5 : 2); i++) {
      const a = rng() * TAU, r = radiusAt(a) - 2, x = Math.floor(c + Math.cos(a) * r), y = Math.floor(c + Math.sin(a) * r);
      if (inside(x, y)) px.set(x, y, PAL.veinPink);
      if (inside(x + 1, y)) px.set(x + 1, y, PAL.veinPink);
    }
  }
  outlineMask(px, D, inside, PAL.outline);
  return px.done();
}

function paintIris(D, k) {
  const big = D >= 20, many = k.pupils && big;
  const ri = Math.round(D * 0.24) + (many ? 1 : 0);
  const I = ri * 2, c = ri;
  const ramp = PAL[k.iris];
  const px = Px(I, I);
  for (let y = 0; y < I; y++) for (let x = 0; x < I; x++) {
    const dx = x + 0.5 - c, dy = (y + 0.5 - c) * (k.oval ? 0.86 : 1);
    const d = Math.hypot(dx, dy), t = d / ri, a = Math.atan2(dy, dx);
    if (d > ri - 0.05) continue;
    let col;
    if (k.rings) {
      col = t > 0.8 ? ramp[0] : (Math.floor(t * ri * 1.05) % 2 === 0 ? ramp[1] : ramp[3]);
    } else {
      let l = 1;
      if (dx + dy > ri * 0.35) l = 2;                         // lit from inside, opposite the gloss
      if (big && t > 0.42 && t < 0.8) {
        const spoke = ((a / TAU) * (k.sunburst ? 8 : 10) + 10) % 1;
        if (spoke < (k.sunburst ? 0.34 : 0.22)) l = Math.min(3, l + 1);
      }
      if (t > 0.79) l = 0;                                    // limbal ring
      col = ramp[l];
    }
    px.set(x, y, col);
  }
  const pup = (pxp, pyp, pr) => {
    for (let y = 0; y < I; y++) for (let x = 0; x < I; x++) if (Math.hypot(x + 0.5 - pxp, (y + 0.5 - pyp) * (k.oval ? 0.75 : 1)) <= pr) px.set(x, y, PAL.void);
  };
  if (many) {
    const s = ri / 5, pr = big ? 1.2 : 0.75;
    pup(c - 1.7 * s, c - 1.1 * s, pr); pup(c + 1.7 * s, c - 1.1 * s, pr); pup(c, c + 1.8 * s, pr);
  } else {
    pup(c, c, Math.max(0.75, ri * (k.pupil || 0.45)));
    if (k.hot && big) { px.set(c - 1, c - 3, '#b8333f'); px.set(c, c + 2, '#b8333f'); }  // embers in the dark iris
  }
  return { canvas: px.done(), size: I, ri };
}

function paintGloss(D) {
  const px = Px(D, D);
  const c = D / 2;
  if (D >= 20) {
    const gx = Math.floor(c) - 3, gy = Math.floor(c) - 4;
    px.set(gx, gy, PAL.gloss); px.set(gx + 1, gy, PAL.gloss); px.set(gx, gy + 1, PAL.gloss);
    px.set(gx + 5, gy + 6, PAL.gloss, 0.55);
  } else {
    px.set(Math.floor(c) - 2, Math.floor(c) - 3, PAL.gloss); px.set(Math.floor(c) - 1, Math.floor(c) - 3, PAL.gloss, 0.8);
  }
  return px.done();
}

function paintLid(S, frame) {
  const { D, c, radiusAt, inside, R0 } = S;
  const px = Px(D, D);
  const closed = frame === 0;
  const slit = x => Math.round(c - 0.5 + (1 - Math.pow((x + 0.5 - c) / R0, 2)) * 1.3);
  const upperEdge = x => Math.round(c - 2.5 + (1 - Math.pow((x + 0.5 - c) / R0, 2)) * 1.5);
  const lowerEdge = Math.round(c + R0 * 0.5);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (!inside(x, y)) continue;
    const cover = closed || y <= upperEdge(x) || y >= lowerEdge;
    if (!cover) continue;
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    const l = Math.max(0, shadeLevel(dx, dy, radiusAt(Math.atan2(dy, dx)), -0.05) - 1);
    px.set(x, y, PAL.lid[Math.min(3, l)]);
  }
  for (let x = 0; x < D; x++) {
    if (closed) {
      const y = slit(x);
      if (inside(x, y)) { px.set(x, y, PAL.void); if (inside(x, y + 1)) px.set(x, y + 1, PAL.lid[0]); }
      if (D >= 20 && x % 4 === 1 && inside(x, y + 2) && Math.abs(x + 0.5 - c) < R0 - 2) px.set(x, y + 2, PAL.void);   // lashes
    } else {
      const y = upperEdge(x);
      if (inside(x, y)) px.set(x, y, PAL.void);
      if (inside(x, lowerEdge)) px.set(x, lowerEdge, PAL.lid[0]);
    }
  }
  outlineMask(px, D, inside, PAL.outline);
  return px.done();
}

function paintFlash(S) {
  const { D, c, radiusAt, inside } = S;
  const px = Px(D, D);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (!inside(x, y)) continue;
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    px.set(x, y, Math.hypot(dx, dy) > radiusAt(Math.atan2(dy, dx)) - 1.2 ? '#d9878a' : '#f4ebda');
  }
  outlineMask(px, D, inside, PAL.outline);
  return px.done();
}

function paintEye(D, kindName) {
  const k = EYE_KINDS[kindName];
  const S = eyeShape(D, k);
  const iris = paintIris(D, k);
  return {
    D, kind: kindName,
    sclera: paintSclera(S, k, false),
    hot: k.hot ? paintSclera(S, k, true) : null,
    iris: iris.canvas, irisSize: iris.size,
    look: Math.max(1, Math.floor(S.R0 - iris.ri - (D >= 20 ? 1.5 : 1.2))),
    gloss: paintGloss(D),
    lidClosed: paintLid(S, 0), lidHalf: paintLid(S, 1),
    flash: paintFlash(S)
  };
}

// ---------------------------------------------------------------------
// The specimen jar: back layer (behind contents), front layer (glass).
// ---------------------------------------------------------------------
const JAR = { W: 48, H: 60, mouthY: 5, rimRx: 23.5, rimRy: 4.6, inRx: 19, inRy: 2.6, bottom: 58 };

function jarEdges(y) {
  let hw = 21.5;
  if (y < 11) hw = 20.5;
  if (y > 53) hw -= Math.pow(y - 53, 2) * 0.3;
  const bulge = y >= 27 && y <= 41 ? 0.9 : 0;                // the hand-blown imperfection
  return [24 - hw - bulge, 24 + hw];
}
const inJarBody = (x, y) => { if (y < 7 || y > JAR.bottom) return false; const [l, r] = jarEdges(y); return x + 0.5 >= l && x + 0.5 <= r; };
const inEll = (x, y, rx, ry) => Math.pow((x + 0.5 - 24) / rx, 2) + Math.pow((y + 0.5 - JAR.mouthY) / ry, 2) <= 1;

function paintJarBack() {
  const px = Px(JAR.W, JAR.H);
  for (let y = 0; y < JAR.H; y++) for (let x = 0; x < JAR.W; x++) {
    if (inJarBody(x, y)) {
      const [l, r] = jarEdges(y);
      const nearR = r - (x + 0.5) < 3.5;
      px.set(x, y, PAL.glassDark, nearR ? 0.5 : 0.32);
    }
  }
  for (let y = 0; y < 12; y++) for (let x = 0; x < JAR.W; x++) {
    const outer = inEll(x, y, JAR.rimRx, JAR.rimRy), inner = inEll(x, y, JAR.inRx, JAR.inRy);
    if (inner) px.set(x, y, '#0d110f', 0.92);
    else if (outer && y + 0.5 <= JAR.mouthY) px.set(x, y, y < 2 ? PAL.rimMid : PAL.rimShade);
  }
  return px.done();
}

function paintJarFront() {
  const px = Px(JAR.W, JAR.H);
  // tinted glass and its silhouette
  for (let y = 7; y <= JAR.bottom; y++) for (let x = 0; x < JAR.W; x++) {
    if (!inJarBody(x, y)) continue;
    const [l, r] = jarEdges(y);
    const fromL = x + 0.5 - l, fromR = r - (x + 0.5);
    let a = 0.13;
    if (fromL < 2.2) a = 0.38; else if (fromR < 2.6) a = 0.42;
    px.set(x, y, fromR < 2.6 ? PAL.rimShade : PAL.glass, a);
    if (y > 54) px.set(x, y, PAL.rimMid, 0.6);                // thick glass base
  }
  for (let y = 0; y < JAR.H; y++) for (let x = 0; x < JAR.W; x++) {
    if (inJarBody(x, y) || inEll(x, y, JAR.rimRx, JAR.rimRy + 2.2)) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => inJarBody(x + ox, y + oy));
    if (n) px.set(x, y, PAL.glassEdge);
  }
  // highlight streaks, broken like real glass
  for (const [y0, y1, a] of [[13, 25, 0.85], [28, 39, 0.7], [43, 46, 0.6]]) {
    for (let y = y0; y <= y1; y++) { const l = Math.ceil(jarEdges(y)[0]); px.set(l + 2, y, PAL.glassHi, a); if (y > y0 && y < y1) px.set(l + 3, y, PAL.glassHi, a * 0.45); }
  }
  for (let y = 16; y <= 22; y++) px.set(Math.floor(jarEdges(y)[1]) - 4, y, PAL.glassHi, 0.45);
  // screw threads under the rim
  for (const ty of [9, 11]) for (let x = 0; x < JAR.W; x++) if (inJarBody(x, ty)) px.set(x, ty, ty === 9 ? PAL.rimMid : PAL.rimShade, 0.75);
  // the thick front half of the rim, lit from above
  for (let y = 0; y < 12; y++) for (let x = 0; x < JAR.W; x++) {
    const outer = inEll(x, y, JAR.rimRx, JAR.rimRy), inner = inEll(x, y, JAR.inRx, JAR.inRy);
    const lowerRim = inEll(x, y - 2, JAR.rimRx, JAR.rimRy) && !inner && y + 0.5 > JAR.mouthY - 0.5;
    if ((outer && !inner && y + 0.5 > JAR.mouthY) || lowerRim) {
      const below = !inEll(x, y + 1 - 2, JAR.rimRx, JAR.rimRy);
      px.set(x, y, below ? PAL.rimShade : (inEll(x, y - 1, JAR.inRx, JAR.inRy) ? PAL.rimLight : PAL.rimMid));
    }
  }
  for (let y = 0; y < 13; y++) for (let x = 0; x < JAR.W; x++) {
    if (px.alpha(x, y) > 0 && !(y + 0.5 > JAR.mouthY - 1 && inEll(x, y, JAR.inRx, JAR.inRy))) continue;
    const solid = (xx, yy) => (inEll(xx, yy, JAR.rimRx, JAR.rimRy) && !inEll(xx, yy, JAR.inRx, JAR.inRy)) || (inEll(xx, yy - 2, JAR.rimRx, JAR.rimRy) && !inEll(xx, yy, JAR.inRx, JAR.inRy) && yy + 0.5 > JAR.mouthY - 0.5);
    if (solid(x, y)) continue;
    if (inEll(x, y, JAR.inRx, JAR.inRy)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => solid(x + ox, y + oy))) px.set(x, y, PAL.glassEdge);
  }
  // rim specular
  px.set(9, 2, PAL.glassHi); px.set(10, 2, PAL.glassHi); px.set(11, 2, PAL.glassHi, 0.6);
  // a stained specimen label, slightly askew
  const lx = 28, ly = 44;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
    const yy = ly + y + (x > 6 ? 1 : 0);
    px.set(lx + x, yy, (y === 7 || x === 11) ? PAL.labelShade : PAL.label);
  }
  for (let x = 1; x < 10; x++) if (x % 3 !== 0) px.set(lx + x, ly + 2 + (x > 6 ? 1 : 0), PAL.ink);
  for (let x = 1; x < 7; x++) if (x !== 4) px.set(lx + x, ly + 4, PAL.ink, 0.8);
  px.set(lx + 8, ly + 5, '#8a3a46');
  return px.done();
}

function paintShadow(w, h) {
  const px = Px(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.pow((x + 0.5 - w / 2) / (w / 2), 2) + Math.pow((y + 0.5 - h / 2) / (h / 2), 2);
    if (t <= 1) px.set(x, y, '#050203', t < 0.45 ? 0.55 : 0.3);
  }
  return px.done();
}

function paintArrow(dir) {
  const px = Px(6, 8);
  for (let y = 0; y < 7; y++) { const w = 3 - Math.abs(y - 3); for (let i = 0; i <= w; i++) px.set(dir > 0 ? 1 + i : 4 - i, y, PAL.sclera[4], 0.85); }
  return px.done();
}

function paintFlames() {
  const frames = [];
  const shapes = [
    ['..1...', '..1...', '.121..', '.121..', '.1321.', '.1331.', '12331.', '.1331.', '..11..', '......'],
    ['...1..', '..11..', '..121.', '.1221.', '.1331.', '12331.', '.1331.', '.1331.', '..11..', '......'],
    ['......', '..1...', '.12...', '.121..', '.1321.', '.13321', '.1331.', '.1331.', '..11..', '......']
  ];
  for (const s of shapes) {
    const px = Px(6, 10);
    s.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') px.set(x, y, PAL.flame[+ch]); }));
    frames.push(px.done());
  }
  return frames;
}

function paintGlow(r, col) {
  const D = r * 2, px = Px(D, D);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const t = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
    if (t < 1 && bayer(x, y) > t * t * 1.15 + 0.12) px.set(x, y, col, 1);
  }
  return px.done();
}

// ---------------------------------------------------------------------
// The room: an abandoned specimen cabinet. Painted once per resize.
// ---------------------------------------------------------------------
function paintRoom(W, H, PW, FLOOR) {
  const px = Px(W, H);
  const rng = makeRng(1031);
  const cx = W / 2;
  const fy = H - FLOOR;                                        // floor top row (canvas y)
  // wall: low-contrast stone courses with a faint central glow and dark corners
  const bh = 9;
  for (let y = 0; y < fy; y++) {
    const row = Math.floor(y / bh), off = (row % 2) * 9;
    for (let x = 0; x < W; x++) {
      const bx = Math.floor((x + off) / 18);
      const seed = (bx * 73856093) ^ (row * 19349663);
      const tone = 1 + ((seed >>> 3) % 3 === 0 ? 1 : 0);
      let l = tone;
      const mortar = y % bh === 0 || (x + off) % 18 === 0;
      if (mortar) l = 0;
      else if (y % bh === 1 && ((x + off) % 18) > 1 && ((x + off) % 18) < 9 && (seed >>> 5) % 4 === 0) l = Math.min(4, tone + 1);
      const gx = (x - cx) / (W * 0.5), gy = (y - fy * 0.5) / (fy * 0.62);
      const g = gx * gx * 0.8 + gy * gy;
      if (!mortar && g < 0.55 && bayer(x, y) > g * 1.3) l = Math.min(4, l + 1);
      if (g > 1.05 && bayer(x, y) < (g - 1.05) * 1.5) l = Math.max(0, l - 1);
      px.set(x, y, PAL.wall[l]);
    }
  }
  // shelves: outside the playfield on wide screens, high and quiet on narrow ones
  const wide = cx - PW > 46;
  const shelves = [];
  if (wide) {
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 4 : Math.ceil(cx + PW) + 14, x1 = side < 0 ? Math.floor(cx - PW) - 14 : W - 4;
      if (x1 - x0 < 24) continue;
      for (const hy of [0.26, 0.5, 0.74]) shelves.push({ x0, x1, y: Math.round(fy * hy) });
    }
  } else {
    shelves.push({ x0: 0, x1: Math.round(W * 0.34), y: Math.round(fy * 0.3) });
    shelves.push({ x0: Math.round(W * 0.66), x1: W, y: Math.round(fy * 0.46) });
  }
  const candles = [];
  for (const s of shelves) {
    // plank and brackets
    for (let x = s.x0; x < s.x1; x++) {
      px.set(x, s.y, PAL.wood[3]); px.set(x, s.y + 1, PAL.wood[2]); px.set(x, s.y + 2, PAL.wood[1]); px.set(x, s.y + 3, PAL.wood[0]);
      if (bayer(x, s.y + 4) < 0.5) px.set(x, s.y + 4, '#0b0609');
    }
    for (const bx of [s.x0 + 5, s.x1 - 7]) for (let i = 0; i < 6; i++) { px.set(bx + Math.max(0, 3 - i), s.y + 4 + i, PAL.wood[1]); px.set(bx + 1, s.y + 4 + i, PAL.wood[0]); }
    // bottles: a few silhouettes, never a crowd
    let x = s.x0 + 4 + rng.int(0, 6);
    while (x < s.x1 - 10) {
      const kind = rng.int(0, 4);
      if (kind === 4 && candles.length < 3) { candles.push({ x: x + 2, y: s.y - 1 }); paintCandle(px, x, s.y); x += 10 + rng.int(4, 12); continue; }
      x += paintBottle(px, x, s.y, kind, rng) + rng.int(3, 11);
    }
  }
  // cobwebs in the two upper corners
  paintWeb(px, 0, 0, 1, Math.min(34, W * 0.18));
  paintWeb(px, W - 1, 0, -1, Math.min(26, W * 0.14));
  // pillars marking the side walls on wide screens
  if (wide) {
    for (const side of [-1, 1]) {
      const edge = Math.round(cx + side * PW);
      const x0 = side < 0 ? edge - 8 : edge, x1 = x0 + 8;
      for (let y = 0; y < fy; y++) for (let x = x0; x < x1; x++) {
        const u = side < 0 ? x1 - 1 - x : x - x0;
        let l = u === 0 ? 3 : u < 3 ? 2 : 1;
        if (y % 22 === 0) l = 0;
        px.set(x, y, PAL.stone[l]);
      }
    }
  }
  // the floor: uneven dark slabs
  let x = 0, slab = 0;
  while (x < W) {
    const w = rng.int(18, 34), lift = (slab % 3 === 1) ? -1 : 0;
    for (let xx = x; xx < Math.min(W, x + w); xx++) {
      for (let y = fy + lift; y < H; y++) {
        let l = y === fy + lift ? 3 : y === fy + lift + 1 ? 2 : 1;
        if (xx === x || xx === x + w - 1) l = 0;
        if (y > fy + 6 && bayer(xx, y) < (y - fy - 6) / (FLOOR + 4)) l = 0;
        px.set(xx, y, PAL.stone[l]);
      }
    }
    if (rng.chance(0.5)) { const cx2 = x + rng.int(4, w - 6); px.set(cx2, fy + lift + 3, PAL.stone[0]); px.set(cx2 + 1, fy + lift + 3, PAL.stone[0]); }
    x += w; slab++;
  }
  // a thin band of shadow where wall meets floor
  for (let xx = 0; xx < W; xx++) if (bayer(xx, fy - 1) < 0.6) px.set(xx, fy - 1, PAL.wall[0]);
  return { canvas: px.done(), candles };
}

function paintCandle(px, x, sy) {
  const h = 7;
  for (let y = sy - h; y < sy; y++) { px.set(x + 1, y, PAL.candle[2]); px.set(x + 2, y, PAL.candle[1]); px.set(x + 3, y, PAL.candle[0]); }
  px.set(x + 1, sy - h + 2, PAL.candle[1]); px.set(x, sy - h + 3, PAL.candle[1]);     // a drip
  px.set(x + 2, sy - h - 1, '#1a0d0a');
  // warm wash on the wall behind
  for (let y = sy - 22; y < sy; y++) for (let xx = x - 10; xx < x + 14; xx++) {
    const t = Math.hypot(xx - x - 2, (y - sy + 9) * 1.2) / 12;
    if (t < 1 && px.alpha(xx, y) && bayer(xx, y) > t * 1.1 + 0.15) px.set(xx, y, '#3a221f');
  }
}

function paintBottle(px, x, sy, kind, rng) {
  const ramp = rng.chance(0.25) ? PAL.bottleRed : PAL.bottle;
  const shapes = [
    { w: 7, h: 13, neck: 2, nh: 4 },   // tall flask
    { w: 9, h: 9, neck: 3, nh: 3, round: true },
    { w: 8, h: 8, neck: 8, nh: 0, jar: true },
    { w: 5, h: 15, neck: 1, nh: 5 }
  ];
  const s = shapes[kind % 4];
  const body = s.h - s.nh;
  for (let y = 0; y < s.h; y++) for (let xx = 0; xx < s.w; xx++) {
    const yy = sy - s.h + y;
    let inside;
    if (y < s.nh) inside = Math.abs(xx + 0.5 - s.w / 2) <= s.neck / 2;
    else if (s.round) inside = Math.hypot((xx + 0.5 - s.w / 2) / (s.w / 2), (y - s.nh + 0.5 - body / 2) / (body / 2)) <= 1.05;
    else inside = true;
    if (!inside) continue;
    const l = xx === 0 ? 0 : xx === 1 ? 3 : xx >= s.w - 2 ? 0 : (y > s.nh + 1 && y < s.h - 1 && y > s.h * 0.45 ? 2 : 1);
    px.set(x + xx, yy, ramp[l]);
  }
  if (s.jar) {                                                 // a pickled thing in one jar, half seen
    px.set(x + 3, sy - 4, PAL.sclera[1]); px.set(x + 4, sy - 4, PAL.sclera[1]); px.set(x + 4, sy - 3, PAL.sclera[0]); px.set(x + 3, sy - 3, PAL.irisTeal[1]);
    for (let xx = 0; xx < s.w; xx++) px.set(x + xx, sy - s.h - 1, PAL.wood[1]);
  } else {
    px.set(x + Math.floor(s.w / 2) - 1 + (s.neck > 1 ? 0 : 1), sy - s.h - 1, PAL.wood[2]);   // cork
  }
  return s.w;
}

function paintWeb(px, ox, oy, dir, R) {
  const spokes = [0.06, 0.42, 0.85, 1.35].map(a => a);
  for (const a of spokes) px.line(ox, oy, ox + dir * Math.round(Math.cos(a) * R), oy + Math.round(Math.sin(a) * R), PAL.web, 0.55);
  for (const rr of [R * 0.35, R * 0.62, R * 0.9]) {
    let prev = null;
    for (const a of spokes) {
      const p = [ox + dir * Math.round(Math.cos(a) * rr), oy + Math.round(Math.sin(a) * rr) + 1];
      if (prev) px.line(prev[0], prev[1], p[0], p[1], PAL.web, 0.4);
      prev = p;
    }
  }
}

// ---- 02_audio.js ----
// =====================================================================
// Synthesised sound. Quiet room tone, wet catches that ring the glass,
// a dull pop for the unstable eyes. Everything runs through one master
// gain so the mute toggle is a single switch.
// =====================================================================

function createAudio(enabled) {
  let ac = null, master = null, sfx = null, amb = null, noiseBuf = null, muted = false, ambOn = false;
  const nodes = [];

  function ensure() {
    if (!enabled || ac) return !!ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master);
      sfx = ac.createGain(); sfx.gain.value = 0.8; sfx.connect(comp);
      amb = ac.createGain(); amb.gain.value = 0; amb.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    return !!ac;
  }
  const now = () => ac.currentTime;

  function tone(type, f0, f1, dur, vol, at, dest) {
    const t = now() + (at || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, f0, f1, q, at, dest) {
    const t = now() + (at || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  // A bank of inharmonic partials: the jar humming after something lands in it.
  function glass(vol, at, pitch) {
    const p = pitch || 1;
    [[1460, 0.5], [2290, 0.3], [3720, 0.18], [5130, 0.08]].forEach(([f, v], i) => tone('sine', f * p, f * p * 0.995, 0.5 + (3 - i) * 0.12, vol * v, at));
  }

  function startAmbience() {
    if (ambOn || !ac) return;
    ambOn = true;
    const t = now();
    const drone = ac.createGain(); drone.gain.value = 0.05; drone.connect(amb);
    for (const f of [55, 55.7, 82.4]) {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(drone); o.start(t); nodes.push(o);
    }
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
    const ng = ac.createGain(); ng.gain.value = 0.035;
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 220; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(t);
    const lfo2 = ac.createOscillator(), lg2 = ac.createGain(); lfo2.frequency.value = 0.11; lg2.gain.value = 0.02; lfo2.connect(lg2); lg2.connect(ng.gain); lfo2.start(t);
    s.connect(bp); bp.connect(ng); ng.connect(amb); s.start(t);
    nodes.push(s, lfo, lfo2);
  }

  let dripT = 0;
  return {
    unlock() { if (!ensure()) return; if (ac.state === 'suspended') ac.resume().catch(() => {}); startAmbience(); },
    ambience(level, dt) {
      if (!ac) return;
      amb.gain.setTargetAtTime(muted ? 0 : level, now(), 0.6);
      dripT -= dt;
      if (dripT <= 0 && level > 0) {                           // a distant drip in the dark, now and then
        dripT = 3 + Math.random() * 6;
        tone('sine', 1300 + Math.random() * 500, 500, 0.12, 0.018, 0, amb);
      }
    },
    setMuted(m) { muted = m; if (ac) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.05); },
    get muted() { return muted; },
    bounce(size, power) {
      if (!ac) return;
      const v = Math.min(1, power) * 0.07; if (v < 0.008) return;
      const f = (size < 18 ? 420 : 300) * (0.9 + Math.random() * 0.2);
      tone('sine', f, f * 0.55, 0.11, v);
      noise(0.05, v * 0.4, 'lowpass', 900, 300, 1);
    },
    clink(power) { if (!ac) return; glass(Math.min(1, power) * 0.06, 0, 1.1 + Math.random() * 0.1); },
    catch(combo, gold) {
      if (!ac) return;
      noise(0.16, 0.16, 'bandpass', 1600, 260, 3);               // wet squelch
      tone('sine', 190, 70, 0.16, 0.18);
      glass(0.08, 0.05, gold ? 1.25 : 1);
      const step = Math.min(combo, 10);
      tone('triangle', 660 * Math.pow(2, step / 12), 660 * Math.pow(2, step / 12), 0.07, 0.04, 0.06);
      if (gold) [0, 4, 7, 12].forEach((s, i) => tone('triangle', 880 * Math.pow(2, s / 12), 880 * Math.pow(2, s / 12), 0.22, 0.05, 0.08 + i * 0.06));
    },
    plop() { if (!ac) return; tone('sine', 520, 210, 0.09, 0.05); noise(0.06, 0.04, 'bandpass', 1200, 500, 4); },
    explode(near) {
      if (!ac) return;
      const v = near ? 1 : 0.55;
      noise(0.5, 0.4 * v, 'lowpass', 2600, 120, 0.7);
      tone('sine', 120, 38, 0.4, 0.38 * v);
      noise(0.18, 0.18 * v, 'bandpass', 900, 2400, 5, 0.03);
    },
    fuse() { if (!ac) return; tone('square', 110, 108, 0.05, 0.012); },
    teleport(out) {
      if (!ac) return;
      const a = out ? 900 : 300, b = out ? 300 : 1100;
      tone('sine', a, b, 0.16, 0.06);
      tone('square', a * 1.5, b * 1.5, 0.12, 0.015);
    },
    split() {
      if (!ac) return;
      noise(0.12, 0.1, 'bandpass', 700, 1800, 4);
      [0, 1, 2].forEach(i => tone('sine', 380 + i * 140, 600 + i * 160, 0.08, 0.06, i * 0.05));
    },
    open() { if (!ac) return; noise(0.05, 0.03, 'bandpass', 2400, 1400, 6); },
    penalty() { if (!ac) return; tone('sawtooth', 160, 70, 0.3, 0.05); },
    tick(urgent) { if (!ac) return; tone('square', urgent ? 1046 : 784, urgent ? 1046 : 784, 0.04, 0.02); },
    over() {
      if (!ac) return;
      [0, -3, -7, -12].forEach((s, i) => tone('triangle', 523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12) * 0.99, 0.5, 0.05, i * 0.16));
      glass(0.06, 0.65, 0.8);
    },
    button() { if (!ac) return; glass(0.05, 0, 1.3); },
    close() { try { nodes.forEach(n => { try { n.stop(); } catch (e) { } }); if (ac) ac.close(); } catch (e) { } }
  };
}

// ---- 03_fx.js ----
// =====================================================================
// Pixel particles: one pooled THREE.Points draw. Each particle is a 1-3
// texel square snapped to the pixel grid, and fades out by ordered
// dithering instead of alpha blending, so effects stay crisp.
// =====================================================================

function createFx(THREE, scene) {
  const N = 480;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, size: 1, r: 1, gg: 1, b: 1, floor: -1e9 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: false, depthTest: false, depthWrite: false,
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = aColor; vAlpha = aAlpha;
        vec3 p = position;
        p.xy = floor(p.xy) + (mod(aSize, 2.0) > 0.5 ? 0.5 : 0.0);
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      float bayer4(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        int i = int(q.y * 4.0 + q.x);
        float m[16];
        m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
        m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
        for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
        return 0.5;
      }
      void main() {
        if (vAlpha < bayer4(gl_FragCoord.xy)) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 50; pts.position.z = 5;
  scene.add(pts);
  let cursor = 0;

  function emit(x, y, o) {
    let p = null;
    for (let k = 0; k < N; k++) { const q = P[(cursor + k) % N]; if (!q.on) { p = q; cursor = (cursor + k + 1) % N; break; } }
    if (!p) { p = P[cursor]; cursor = (cursor + 1) % N; }
    const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread || TAU) : Math.random() * TAU;
    const sp = (o.speed || 40) * (0.4 + Math.random() * 0.8);
    p.on = true; p.x = x + (Math.random() - 0.5) * (o.jitter || 0); p.y = y + (Math.random() - 0.5) * (o.jitter || 0);
    p.vx = Math.cos(a) * sp + (o.vx || 0); p.vy = Math.sin(a) * sp + (o.vy || 0);
    p.g = o.g === undefined ? -160 : o.g; p.drag = o.drag || 0;
    p.max = p.life = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
    p.size = o.sizes ? o.sizes[(Math.random() * o.sizes.length) | 0] : (o.size || 1);
    const c = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : (o.color || '#ffffff');
    const [r, g, b] = rgbOf(c); p.r = r / 255; p.gg = g / 255; p.b = b / 255;
    p.floor = o.floor === undefined ? -1e9 : o.floor;
    return p;
  }

  return {
    burst(x, y, n, o) { for (let i = 0; i < n; i++) emit(x, y, o); },
    update(dt) {
      let n = 0;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (!p.on) continue;
        p.life -= dt;
        if (p.life <= 0) { p.on = false; continue; }
        p.vy += p.g * dt;
        if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < p.floor) { p.y = p.floor; p.vy = -p.vy * 0.3; p.vx *= 0.6; }
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = 0;
        col[n * 3] = p.r; col[n * 3 + 1] = p.gg; col[n * 3 + 2] = p.b;
        al[n] = Math.min(1, (p.life / p.max) * 1.6); sz[n] = p.size;
        n++;
      }
      geo.setDrawRange(0, n);
      for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) geo.attributes[k].needsUpdate = true;
    },
    clear() { for (const p of P) p.on = false; }
  };
}

// ---- 04_eyes.js ----
// =====================================================================
// Eyeballs: a fixed pool, arcade physics and the special behaviours.
// Sprites are unit quads scaled to their texel size and snapped to whole
// texels every frame, so the pixel grid never drifts.
// =====================================================================

function createMats(THREE) {
  const texCache = new Map(), matCache = new Map();
  const plane = new THREE.PlaneGeometry(1, 1);
  function tex(canvas) {
    let t = texCache.get(canvas);
    if (!t) {
      // flip rows: sprites are authored top-down, texture rows start at the bottom
      const { width: w, height: h, data } = canvas, flipped = new Uint8Array(data.length), row = w * 4;
      for (let y = 0; y < h; y++) flipped.set(data.subarray(y * row, y * row + row), (h - 1 - y) * row);
      t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
      t.needsUpdate = true;
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      texCache.set(canvas, t);
    }
    return t;
  }
  function mat(canvas, opts) {
    const key = canvas;
    let m = opts ? null : matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial(Object.assign({ map: tex(canvas), transparent: true, depthTest: false, depthWrite: false }, opts || {}));
      if (!opts) matCache.set(key, m);
    }
    return m;
  }
  function sprite(canvas, order, opts) {
    const m = new THREE.Mesh(plane, mat(canvas, opts));
    m.scale.set(canvas.width, canvas.height, 1);
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }
  function setSprite(mesh, canvas) {
    const m = mat(canvas);
    if (mesh.material !== m) { mesh.material = m; mesh.scale.set(canvas.width, canvas.height, 1); }
  }
  return { tex, mat, sprite, setSprite, plane, forget(canvas) { const t = texCache.get(canvas); if (t) { t.dispose(); texCache.delete(canvas); } }, dispose() { texCache.forEach(t => t.dispose()); matCache.forEach(m => m.dispose()); plane.dispose(); } };
}

// Score values and per-behaviour tuning.
const EYE_RULES = {
  teal:  { points: 10, g: 1, maxHits: 3 },
  brown: { points: 10, g: 1, maxHits: 3 },
  blood: { points: 15, g: 1.08, maxHits: 3, ts: 1.12, twitch: 0.7 },
  gold:  { points: 50, g: 0.55, maxHits: 2 },
  demon: { points: 0, g: 0.95, maxHits: 4 },
  warp:  { points: 20, g: 0.92, maxHits: 3 },
  split: { points: 20, g: 1, maxHits: 3 },
  child: { points: 8, g: 1.1, maxHits: 2 }
};

function createEyes(THREE, scene, M, art, fx, audio, hooks) {
  const POOL = 26;
  const eyes = [];
  for (let i = 0; i < POOL; i++) {
    const s = art.big.teal;
    const group = new THREE.Group(); group.visible = false;
    const base = 20 + i * 6;
    const sclera = M.sprite(s.sclera, base), iris = M.sprite(s.iris, base + 1), gloss = M.sprite(s.gloss, base + 2), lid = M.sprite(s.lidClosed, base + 3);
    group.add(sclera, iris, gloss, lid);
    scene.add(group);
    eyes.push({ i, on: false, group, sclera, iris, gloss, lid });
  }
  let world = null;
  const rand = Math.random;

  function spriteSet(e) { return (e.D >= 20 ? art.big : art.small)[e.kind]; }

  function spawn(kind, x, y, o) {
    const e = eyes.find(q => !q.on);
    if (!e) return null;
    o = o || {};
    const behaviour = o.child ? 'child' : kind;
    const R = EYE_RULES[behaviour];
    const U = world.U;
    e.on = true; e.kind = kind; e.behaviour = behaviour; e.rule = R;
    e.D = o.child ? 14 : 22; e.r = e.D / 2 - 1.5;
    e.x = x; e.y = y; e.prevY = y;
    e.vx = o.vx !== undefined ? o.vx : rand() < 0.5 ? -1 : 1;
    if (o.vx === undefined) e.vx *= (40 + rand() * 70) * U;
    e.vy = o.vy !== undefined ? o.vy : (-20 + rand() * 70) * U;
    e.ts = (o.speed || 1) * (R.ts || 1) * (0.92 + rand() * 0.16);
    e.age = 0; e.hits = 0;
    e.state = o.instant ? 'live' : 'opening'; e.st = 0;
    e.lx = 0; e.ly = 0;
    e.blink = 1.5 + rand() * 3; e.twitch = 0.8 + rand() * 1.6; e.twitchDir = rand() < 0.5 ? -1 : 1;
    e.sx = 1; e.sy = 1; e.vsx = 0; e.vsy = 0;
    e.fuse = 4.6 + rand() * 1.8; e.fuseMax = e.fuse; e.hot = false;
    e.warp = 1.5 + rand() * 0.6; e.warps = 0; e.dest = null;
    e.splitReady = false; e.trail = 0; e.jitter = 0;
    e.demo = !!o.demo;
    const s = spriteSet(e);
    M.setSprite(e.sclera, s.sclera); M.setSprite(e.iris, s.iris); M.setSprite(e.gloss, s.gloss); M.setSprite(e.lid, s.lidClosed);
    e.lid.visible = true; e.iris.visible = true; e.gloss.visible = true;
    e.group.visible = true;
    if (!o.instant) audio.open();
    return e;
  }

  function kill(e) { e.on = false; e.group.visible = false; e.state = 'gone'; }

  function burstEye(e, n, speed, extra) {
    const s = spriteSet(e);
    const iris = PAL[EYE_KINDS[e.kind].iris];
    fx.burst(e.x, e.y, n, Object.assign({ speed, life: 0.7, g: -220, jitter: e.r, sizes: [1, 1, 2, 2, 3], colors: [PAL.sclera[3], PAL.sclera[2], PAL.rimPink, PAL.vein, PAL.veinDeep, iris[1], iris[2], PAL.outline], floor: world.FLOOR + 1 }, extra || {}));
    return s;
  }

  // ---------------- behaviours ----------------
  function explode(e, inJar) {
    e.state = 'exploding'; e.st = 0; e.inJar = !!inJar;
    M.setSprite(e.sclera, spriteSet(e).flash); e.iris.visible = false; e.gloss.visible = false; e.lid.visible = false;
  }
  function finishExplosion(e) {
    burstEye(e, 40, 150);
    fx.burst(e.x, e.y, 10, { speed: 60, life: 0.4, g: 0, sizes: [2, 3], colors: ['#f4ebda', '#d9878a'] });
    const U = world.U;
    for (const o of eyes) {
      if (!o.on || o === e || o.state !== 'live') continue;
      const dx = o.x - e.x, dy = o.y - e.y, d = Math.hypot(dx, dy);
      if (d < 56 && d > 0.01) { const k = (1 - d / 56) * 220 * U; o.vx += dx / d * k; o.vy += dy / d * k + 40 * U; }
    }
    audio.explode(e.inJar);
    hooks.onExplode(e, e.inJar);
    kill(e);
  }

  function startSplit(e) { if (e.state !== 'live') return; e.state = 'splitting'; e.st = 0; audio.split(); }
  function finishSplit(e) {
    const U = world.U;
    const alive = eyes.reduce((n, q) => n + (q.on ? 1 : 0), 0);
    const n = alive + 3 <= world.cap + 2 ? 3 : 2;
    const kinds = ['teal', 'brown', 'blood'];
    fx.burst(e.x, e.y, 16, { speed: 70, life: 0.5, g: -120, sizes: [1, 2], colors: [PAL.veinPink, PAL.rimPink, PAL.sclera[3]] });
    const x = e.x, y = Math.max(e.y, world.FLOOR + 10), sp = e.ts;
    kill(e);
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.75;
      const c = spawn(kinds[k % 3], x + Math.cos(a) * 5, y + 3, { child: true, instant: true, speed: sp, vx: Math.cos(a) * 150 * U, vy: (110 + Math.sin(a) * 120) * U });
      if (c) { c.sy = 0.6; c.sx = 1.4; }
    }
    hooks.onSplit(x, y);
  }

  function pickWarpDest(e) {
    const { PW, H, FLOOR } = world;
    for (let t = 0; t < 12; t++) {
      const x = (rand() * 2 - 1) * (PW - e.r - 6), y = FLOOR + (H - FLOOR) * (0.45 + rand() * 0.4);
      if (Math.hypot(x - e.x, y - e.y) < 50) continue;
      if (eyes.some(o => o.on && o !== e && Math.hypot(o.x - x, o.y - y) < o.r + e.r + 4)) continue;
      return { x, y };
    }
    return { x: -e.x * 0.7, y: Math.min(H - 30, e.y + 40) };
  }

  // ---------------- physics ----------------
  function bounceFloor(e) {
    const { FLOOR, H, U } = world;
    e.y = FLOOR + e.r; e.hits++;
    const impact = Math.abs(e.vy);
    e.sx = 1 + Math.min(0.35, impact / (900 * U)); e.sy = 2 - e.sx;
    if (e.behaviour === 'split' && e.age > 0.4) { e.vy = 0; startSplit(e); return; }
    if (e.hits >= e.rule.maxHits && !e.demo) { e.vy = 0; e.vx *= 0.3; e.state = 'missing'; e.st = 0; hooks.onMiss(e); return; }
    // eyes are alive: each bounce is a deliberate leap back up, to an unpredictable height
    const g = 230 * U * e.rule.g;
    const hTarget = (H - FLOOR) * (0.42 + rand() * 0.38);
    e.vy = Math.max(impact * 0.72, Math.sqrt(2 * g * hTarget));
    e.vx += (rand() * 2 - 1) * 45 * U;
    audio.bounce(e.D, impact / (300 * U));
    fx.burst(e.x, FLOOR + 1, 3, { speed: 30, angle: Math.PI / 2, spread: 2.2, life: 0.3, g: -200, size: 1, color: PAL.dust });
  }

  function collidePairs() {
    for (let a = 0; a < POOL; a++) {
      const A = eyes[a]; if (!A.on || A.state !== 'live') continue;
      for (let b = a + 1; b < POOL; b++) {
        const B = eyes[b]; if (!B.on || B.state !== 'live') continue;
        const dx = B.x - A.x, dy = B.y - A.y, rr = A.r + B.r, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = rr - d;
        const ma = A.r * A.r, mb = B.r * B.r, tot = ma + mb;
        A.x -= nx * ov * (mb / tot); A.y -= ny * ov * (mb / tot); B.x += nx * ov * (ma / tot); B.y += ny * ov * (ma / tot);
        const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          const j = -(1 + 0.9) * rv / (1 / ma + 1 / mb);
          A.vx -= j * nx / ma; A.vy -= j * ny / ma; B.vx += j * nx / mb; B.vy += j * ny / mb;
          A.sx = 1.12; A.sy = 0.9; B.sx = 1.12; B.sy = 0.9;
          audio.bounce(Math.min(A.D, B.D), -rv / (420 * world.U));
        }
      }
    }
  }

  function stepLive(e, dt, jar) {
    const { PW, H, FLOOR, U } = world;
    const R = e.rule;
    let g = 230 * U * R.g;
    // golden eyes drift and shy away from the jar
    if (e.behaviour === 'gold') {
      e.vx += Math.sin(e.age * 2.6) * 40 * U * dt;
      if (Math.abs(e.x - jar.x) < 44 && e.y < FLOOR + (H - FLOOR) * 0.55) e.vx += Math.sign(e.x - jar.x || 1) * 70 * U * dt;
    }
    // twitch: the iris glances first, then the eye darts that way
    e.twitch -= dt / (R.twitch || 1);
    if (e.twitch <= 0) {
      e.vx += e.twitchDir * (45 + rand() * 50) * U; e.vy += rand() * 40 * U;
      e.twitch = 1 + rand() * 1.6; e.twitchDir = rand() < 0.5 ? -1 : 1;
      if (Math.abs(e.x) > PW * 0.6) e.twitchDir = -Math.sign(e.x);
    }
    e.vy -= g * dt;
    e.vx *= Math.exp(-0.08 * dt);
    const sp = Math.hypot(e.vx, e.vy), max = 430 * U;
    if (sp > max) { e.vx *= max / sp; e.vy *= max / sp; }
    e.prevY = e.y;
    e.x += e.vx * dt; e.y += e.vy * dt;
    // walls and ceiling
    let wall = false;
    if (e.x - e.r < -PW) { e.x = -PW + e.r; e.vx = Math.abs(e.vx) * 0.92; wall = true; }
    if (e.x + e.r > PW) { e.x = PW - e.r; e.vx = -Math.abs(e.vx) * 0.92; wall = true; }
    if (e.y + e.r > H - 2) { e.y = H - 2 - e.r; e.vy = -Math.abs(e.vy) * 0.8; wall = true; }
    if (wall) { e.sx = 0.88; e.sy = 1.1; audio.bounce(e.D, sp / (500 * U)); if (e.behaviour === 'split' && e.age > 3.2) startSplit(e); }
    if (e.y - e.r < FLOOR) bounceFloor(e);
    if (e.state !== 'live') return;
    // the jar
    const hit = jar.collide(e);
    if (hit === 'catch') {
      if (e.behaviour === 'demon') { explode(e, true); return; }
      e.state = 'caught'; e.st = 0; e.relX = e.x - jar.x;
      hooks.onCatch(e);
      return;
    }
    if (hit === 'rim' && e.behaviour === 'split' && e.age > 0.4) startSplit(e);
    // a stray that ends up beyond the walls is brought back in
    if (!(e.x > -PW - 2 && e.x < PW + 2 && e.y > FLOOR - 4 && e.y < H + 40)) { e.x = clamp(e.x, -PW + e.r, PW - e.r); e.y = clamp(e.y, FLOOR + e.r, H - e.r - 2); }
  }

  function updateLook(e, dt, jar) {
    let tx = jar.x - e.x, ty = jar.mouthY - e.y;
    if (e.twitch < 0.3) { tx = e.twitchDir * 100; ty = 0; }
    if (e.behaviour === 'warp') { tx = Math.cos(e.age * 5); ty = Math.sin(e.age * 5); }
    const m = Math.hypot(tx, ty) || 1, L = spriteSet(e).look;
    e.lx = damp(e.lx, tx / m * L, e.behaviour === 'demon' ? 30 : 12, dt);
    e.ly = damp(e.ly, ty / m * L, e.behaviour === 'demon' ? 30 : 12, dt);
  }

  function update(dt, jar) {
    const U = world.U;
    const SUB = 3, h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (const e of eyes) {
        if (!e.on) continue;
        const edt = h * e.ts;
        if (e.state === 'live') stepLive(e, edt, jar);
        else if (e.state === 'caught') {
          // fall into the jar, drift to the middle and hand over to the jar's contents
          e.vy = Math.max(e.vy - 400 * U * edt, -260 * U);
          e.relX = damp(e.relX, clamp(e.relX, -8, 8), 16, edt);
          e.x = jar.x + e.relX; e.y += e.vy * edt;
          if (e.y - e.r * 0.4 < jar.liquidTop()) { jar.receive(e); kill(e); }
        }
      }
      collidePairs();
    }
    for (const e of eyes) {
      if (!e.on) continue;
      e.age += dt * e.ts; e.st += dt;
      const s = spriteSet(e);
      // squash and stretch spring
      e.vsx += ((1 - e.sx) * 260 - e.vsx * 12) * dt; e.sx += e.vsx * dt;
      e.vsy += ((1 - e.sy) * 260 - e.vsy * 12) * dt; e.sy += e.vsy * dt;
      let scale = 1, lid = null, jx = 0, jy = 0;
      if (e.state === 'opening') {
        const t = e.st / 0.34;
        lid = t < 0.4 ? s.lidClosed : t < 0.75 ? s.lidHalf : null;
        scale = 0.7 + 0.3 * easeOut(Math.min(1, t * 1.5));
        if (t >= 1) e.state = 'live';
      } else if (e.state === 'live') {
        updateLook(e, dt, jar);
        e.blink -= dt;
        if (e.blink < 0.14) lid = e.blink < 0.07 && e.blink > 0 ? s.lidClosed : s.lidHalf;
        if (e.blink <= 0) e.blink = 2 + rand() * 4;
        if (e.behaviour === 'demon') {
          e.fuse -= dt * e.ts;
          const k = 1 - e.fuse / e.fuseMax;
          const freq = 1.6 + 9 * k * k;
          e.phase = (e.phase || 0) + dt * freq;
          const hot = (e.phase % 1) < 0.45;
          if (hot && !e.hot) audio.fuse();
          e.hot = hot;
          M.setSprite(e.sclera, hot ? s.hot : s.sclera);
          scale = 1 + (hot ? 0.05 + 0.08 * k : 0);
          if (rand() < 0.08 + k * 0.3) { jx = rand() < 0.5 ? -1 : 1; }
          if (e.fuse <= 0) explode(e, false);
        }
        if (e.behaviour === 'warp' && e.warps < 3) {
          e.warp -= dt * e.ts;
          if (e.warp < 0.38 && !e.dest) e.dest = pickWarpDest(e);
          if (e.dest && rand() < 0.6) fx.burst(e.dest.x + (rand() - 0.5) * 16, e.dest.y + (rand() - 0.5) * 16, 1, { speed: 6, life: 0.25, g: 0, size: 1, color: PAL.irisWarp[3] });
          if (e.warp <= 0) { e.state = 'warpOut'; e.st = 0; audio.teleport(true); }
        }
        e.trail -= dt;
        if (e.trail <= 0) {
          if (e.behaviour === 'warp') { e.trail = 0.05; fx.burst(e.x + (rand() - 0.5) * 18, e.y + (rand() - 0.5) * 18, 1, { speed: 4, life: 0.35, g: 0, size: 1, color: rand() < 0.5 ? PAL.irisWarp[3] : PAL.irisWarp[2] }); }
          else if (e.behaviour === 'gold') { e.trail = 0.11; fx.burst(e.x + (rand() - 0.5) * 20, e.y + (rand() - 0.5) * 20, 1, { speed: 6, life: 0.45, g: 10, size: rand() < 0.3 ? 2 : 1, color: rand() < 0.5 ? PAL.irisGold[3] : '#f6dc9a' }); }
          else if (e.behaviour === 'demon') { e.trail = 0.07; fx.burst(e.x + (rand() - 0.5) * 16, e.y + e.r * 0.3 + (rand() - 0.5) * 10, 1, { speed: 8, angle: Math.PI / 2, spread: 0.8, life: 0.5, g: 30, size: rand() < 0.3 ? 2 : 1, color: rand() < 0.6 ? PAL.veinDeep : '#c03642' }); }
          else e.trail = 1;
        }
      } else if (e.state === 'warpOut') {
        const t = e.st / 0.13;
        lid = t < 0.5 ? s.lidHalf : s.lidClosed;
        e.sx = 1 - 0.8 * Math.min(1, t); e.sy = 1 + 0.4 * Math.min(1, t);
        if (t >= 1) {
          fx.burst(e.x, e.y, 12, { speed: 50, life: 0.35, g: 0, sizes: [1, 2], colors: PAL.irisWarp.slice(1) });
          const d = e.dest || pickWarpDest(e);
          e.x = d.x; e.y = d.y; e.prevY = d.y; e.dest = null;
          e.vy = clamp(e.vy, -50 * U, 90 * U);
          e.warps++; e.warp = 1.5 + rand() * 0.7;
          e.state = 'warpIn'; e.st = 0; audio.teleport(false);
          fx.burst(e.x, e.y, 10, { speed: 40, life: 0.3, g: 0, sizes: [1, 2], colors: PAL.irisWarp.slice(1) });
        }
      } else if (e.state === 'warpIn') {
        const t = e.st / 0.16;
        lid = t < 0.5 ? s.lidClosed : t < 1 ? s.lidHalf : null;
        e.sx = 0.3 + 0.7 * Math.min(1, t); e.sy = 1.3 - 0.3 * Math.min(1, t);
        if (t >= 1) { e.state = 'live'; e.sx = 1; e.sy = 1; }
      } else if (e.state === 'splitting') {
        const t = e.st / 0.24;
        scale = 1 + 0.32 * t; jx = Math.round((rand() - 0.5) * 2);
        e.lx = (rand() - 0.5) * 2 * s.look; e.ly = (rand() - 0.5) * 2 * s.look;
        if (t >= 1) { finishSplit(e); continue; }
      } else if (e.state === 'exploding') {
        scale = 1 + 0.6 * (e.st / 0.1);
        if (e.st >= 0.1) { finishExplosion(e); continue; }
      } else if (e.state === 'missing' || e.state === 'closing') {
        // the eye shuts and melts into the floor
        const dur = e.state === 'missing' ? 0.45 : 0.3, t = e.st / dur;
        lid = t < 0.35 ? s.lidHalf : s.lidClosed;
        if (e.state === 'missing') { e.sy = 1 - 0.55 * Math.min(1, t); e.sx = 1 + 0.4 * Math.min(1, t); e.y = world.FLOOR + e.r * e.sy; }
        else scale = 1 - 0.3 * t;
        if (t >= 1) { burstEye(e, e.state === 'missing' ? 10 : 14, 40, { g: -200 }); kill(e); continue; }
      }
      const lidOn = !!lid;
      e.lid.visible = lidOn;
      if (lidOn) M.setSprite(e.lid, lid);
      const sx = e.sx * scale, sy = e.sy * scale;
      e.group.position.set(Math.round(e.x) + jx, Math.round(e.y) + jy, 0);
      e.group.scale.set(sx, sy, 1);
      e.iris.position.set(Math.round(e.lx), Math.round(e.ly), 0);
    }
  }

  return {
    eyes,
    setWorld(w) { world = w; },
    spawn, update,
    count() { let n = 0; for (const e of eyes) if (e.on) n++; return n; },
    countOf(b) { let n = 0; for (const e of eyes) if (e.on && e.behaviour === b) n++; return n; },
    live() { return eyes.filter(e => e.on && e.state === 'live'); },
    closeAll() { for (const e of eyes) if (e.on && e.state !== 'caught' && e.state !== 'exploding') { e.state = 'closing'; e.st = 0; } },
    clear() { for (const e of eyes) kill(e); },
    // keeps every eye inside a resized playfield
    clampAll() { if (!world) return; for (const e of eyes) if (e.on) { e.x = clamp(e.x, -world.PW + e.r, world.PW - e.r); e.y = clamp(e.y, world.FLOOR + e.r, world.H - e.r - 2); } }
  };
}

// ---- 05_jar.js ----
// =====================================================================
// The specimen jar: movement, the catch zone, collision against its rim
// and walls, and the pickled contents that pile up inside.
// =====================================================================

// Content slots, relative to the jar's centre line and its inner floor.
// Four short rows that stop well below the mouth so it always reads open.
const JAR_SLOTS = [[-12, 6], [0, 5], [12, 6], [-6, 14], [7, 14], [-13, 22], [0, 23], [13, 22], [-7, 31], [6, 31]];

function createJar(THREE, scene, M, art, fx, audio) {
  const group = new THREE.Group(); scene.add(group);
  const shadow = M.sprite(art.shadow, 3);
  const back = M.sprite(art.jarBack, 5);
  const liquid = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ color: PAL.liquid, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false }));
  liquid.renderOrder = 12;
  const surface = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ color: PAL.liquidHi, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  surface.renderOrder = 13;
  const front = M.sprite(art.jarFront, 190, {});
  const hurtFront = M.sprite(art.jarFront, 191, { color: '#ff6a6a' }); hurtFront.visible = false;
  liquid.material.color.convertSRGBToLinear(); surface.material.color.convertSRGBToLinear();
  group.add(back, liquid, surface, front, hurtFront);
  scene.add(shadow);
  const arrows = [M.sprite(art.arrowL, 240), M.sprite(art.arrowR, 240)];
  arrows.forEach(a => { a.visible = false; scene.add(a); });

  // pickled contents
  const contents = [];
  for (let i = 0; i < JAR_SLOTS.length; i++) {
    const g = new THREE.Group(); g.visible = false;
    const s = art.small.teal;
    const sc = M.sprite(s.sclera, 6 + i * 0.3), ir = M.sprite(s.iris, 6.1 + i * 0.3), gl = M.sprite(s.gloss, 6.2 + i * 0.3);
    g.add(sc, ir, gl); group.add(g);
    contents.push({ g, sc, ir, gl, on: false, kind: 'teal', t: 0, from: 0, phase: Math.random() * TAU, lx: 0, ly: 0, tx: 0, ty: 0, retarget: 0, order: 0 });
  }
  let order = 0;

  const J = {
    x: 0, vx: 0, target: 0, sx: 1, sy: 1, vsx: 0, vsy: 0, hurt: 0, slow: 0,
    mouthY: 0, baseY: 0, innerHalf: 18.5, rimR: 2.6, rimX: 21.5, bodyHalf: 22.5,
    caught: 0, world: null, hint: 0, moved: 0,
    setWorld(w) {
      J.world = w;
      J.baseY = w.FLOOR;                                        // canvas row 58 sits on the floor line
      J.mouthY = J.baseY + (JAR.bottom - JAR.mouthY);
      J.x = clamp(J.x, -w.PW + J.bodyHalf + 1, w.PW - J.bodyHalf - 1);
      J.target = clamp(J.target, -w.PW + J.bodyHalf + 1, w.PW - J.bodyHalf - 1);
    },
    liquidLevel() { return 9 + Math.min(4, Math.ceil(J.count() / 2.5)) * 6; },
    liquidTop() { return J.baseY + 2 + J.liquidLevel(); },
    count() { let n = 0; for (const c of contents) if (c.on) n++; return n; },
    clear() { for (const c of contents) { c.on = false; c.g.visible = false; } J.caught = 0; },

    update(dt, now) {
      const w = J.world;
      const lim = w.PW - J.bodyHalf - 1;
      J.target = clamp(J.target, -lim, lim);
      const prev = J.x;
      const maxSp = (J.slow > 0 ? 260 : 1100) * w.U;
      const want = damp(J.x, J.target, J.slow > 0 ? 7 : 24, dt);
      J.x = clamp(J.x + clamp(want - J.x, -maxSp * dt, maxSp * dt), -lim, lim);
      J.vx = (J.x - prev) / Math.max(dt, 1e-4);
      J.moved += Math.abs(J.x - prev);
      J.slow = Math.max(0, J.slow - dt); J.hurt = Math.max(0, J.hurt - dt);
      J.vsx += ((1 - J.sx) * 340 - J.vsx * 16) * dt; J.sx += J.vsx * dt;
      J.vsy += ((1 - J.sy) * 340 - J.vsy * 16) * dt; J.sy += J.vsy * dt;
      const lean = clamp(J.vx / (900 * w.U), -0.05, 0.05);
      // group origin = jar bottom centre so squash keeps it planted on the floor
      group.position.set(Math.round(J.x), J.baseY - 1, 0);
      group.scale.set(J.sx, J.sy, 1);
      const cy = JAR.H / 2;                                       // sprite centre above the group origin
      back.position.set(0, cy, 0); front.position.set(0, cy, 0); hurtFront.position.set(0, cy, 0);
      hurtFront.visible = J.hurt > 0 && (J.hurt * 20 | 0) % 2 === 0;
      const lv = J.liquidLevel();
      liquid.scale.set(38, lv, 1); liquid.position.set(Math.round(lean * 20), 3 + lv / 2, 0);
      surface.scale.set(38, 1, 1); surface.position.set(Math.round(lean * 20), 3 + lv - 0.5, 0);
      shadow.position.set(Math.round(J.x), J.baseY + 1, 0);
      // contents sink into place, then bob and stare about
      for (const c of contents) {
        if (!c.on) continue;
        const [sx, sy] = JAR_SLOTS[c.slot];
        c.t = Math.min(1, c.t + dt / 0.45);
        const k = easeOut(c.t);
        const bob = Math.round(Math.sin(now * 1.3 + c.phase) * 0.6);
        c.g.position.set(Math.round(lerp(c.fromX, sx, k)), Math.round(lerp(c.fromY, 3 + sy + 7, k)) + (c.t >= 1 ? bob : 0), 0);
        c.retarget -= dt;
        if (c.retarget <= 0) { c.retarget = 0.8 + Math.random() * 2.5; const a = Math.random() * TAU; c.tx = Math.round(Math.cos(a) * 1.4); c.ty = Math.round(Math.sin(a) * 1.4); }
        c.lx = damp(c.lx, c.tx, 10, dt); c.ly = damp(c.ly, c.ty, 10, dt);
        c.ir.position.set(Math.round(c.lx), Math.round(c.ly), 0);
      }
      // the arrows that teach the drag, until the jar has been moved
      const showHint = J.hint > 0 && J.moved < 24;
      if (J.hint > 0) J.hint -= dt;
      const blink = showHint && Math.floor(now * 3) % 2 === 0;
      arrows[0].visible = blink; arrows[1].visible = blink;
      arrows[0].position.set(Math.round(J.x) - 33, J.baseY + 24, 0);
      arrows[1].position.set(Math.round(J.x) + 33, J.baseY + 24, 0);
    },

    // eye vs jar. Returns 'catch', 'rim', 'wall' or null.
    collide(e) {
      const U = J.world.U;
      const dx = e.x - J.x;
      // the mouth: an eye whose centre drops through the opening is caught
      if (e.vy < 0 && e.prevY >= J.mouthY - 1 && e.y < J.mouthY + 1 && Math.abs(dx) <= J.innerHalf - e.r * 0.2) return 'catch';
      let res = null;
      // rim lips: small round bumpers either side of the opening
      for (const side of [-1, 1]) {
        const rx = J.x + side * J.rimX, ry = J.mouthY;
        const ex = e.x - rx, ey = e.y - ry, d = Math.hypot(ex, ey), min = e.r + J.rimR;
        if (d < min && d > 1e-4) {
          const nx = ex / d, ny = ey / d;
          e.x = rx + nx * min; e.y = ry + ny * min;
          const rvx = e.vx - J.vx, vn = rvx * nx + e.vy * ny;
          if (vn < 0) { e.vx -= 1.75 * vn * nx; e.vy -= 1.75 * vn * ny; e.sx = 1.15; e.sy = 0.88; audio.clink(-vn / (300 * U)); J.sy = Math.min(J.sy, 0.97); }
          res = 'rim';
        }
      }
      // the glass walls below the rim
      if (e.y < J.mouthY + 0.5) {
        const left = J.x - J.bodyHalf, right = J.x + J.bodyHalf;
        const cx = clamp(e.x, left, right), cy = clamp(e.y, J.baseY, J.mouthY);
        let ex = e.x - cx, ey = e.y - cy, d = Math.hypot(ex, ey);
        if (d < e.r) {
          if (d < 1e-4) { ex = dx >= 0 ? 1 : -1; ey = 0; d = 1; }
          const nx = ex / d, ny = ey / d, push = e.r - (d < 1e-4 ? 0 : d);
          e.x += nx * push; e.y += ny * push;
          const vn = (e.vx - J.vx) * nx + e.vy * ny;
          if (vn < 0) { e.vx -= 1.7 * vn * nx; e.vy -= 1.7 * vn * ny; audio.clink(-vn / (400 * U)); }
          if (Math.abs(nx) > 0.5) e.vx += J.vx * 0.35;
          // squeezed against a side wall: pop it up and over instead of trapping it
          const PW = J.world.PW;
          if (e.x - e.r < -PW + 0.5 || e.x + e.r > PW - 0.5) { e.y = Math.max(e.y, J.mouthY + e.r + 2); e.vy = Math.max(e.vy, 180 * U); e.vx = -Math.sign(e.x) * 60 * U; }
          res = res || 'wall';
        }
      }
      return res;
    },

    receive(e) {
      J.caught++;
      let c = contents.find(q => !q.on);
      if (!c) {                                                  // full: the oldest dissolves to make room
        c = contents.reduce((a, b) => (a.order < b.order ? a : b));
        fx.burst(J.x + JAR_SLOTS[c.slot][0], J.baseY + 10 + JAR_SLOTS[c.slot][1], 6, { speed: 12, angle: Math.PI / 2, spread: 1, life: 0.6, g: 40, size: 1, color: PAL.liquidHi });
      }
      const slotsUsed = new Set(contents.filter(q => q.on && q !== c).map(q => q.slot));
      let slot = c.on ? c.slot : JAR_SLOTS.findIndex((_, i) => !slotsUsed.has(i));
      if (slot < 0) slot = 0;
      const kind = e.kind;
      const s = art.small[kind];
      M.setSprite(c.sc, s.sclera); M.setSprite(c.ir, s.iris); M.setSprite(c.gl, s.gloss);
      c.on = true; c.slot = slot; c.kind = kind; c.t = 0; c.order = ++order;
      c.fromX = clamp(e.x - J.x, -10, 10); c.fromY = J.liquidLevel() + 6;
      c.g.visible = true;
      const top = J.liquidTop();
      fx.burst(e.x, top, 9, { speed: 55, angle: Math.PI / 2, spread: 1.6, life: 0.4, g: -260, sizes: [1, 1, 2], colors: [PAL.liquidHi, PAL.glassHi, PAL.liquid] });
      audio.plop();
    },

    bump(power) { J.sy = 1 - 0.12 * power; J.sx = 1 + 0.08 * power; J.vsy = 0; J.vsx = 0; },
    injure() { J.hurt = 0.45; J.slow = 0.6; J.sy = 0.8; J.sx = 1.12; },
    showHint(sec) { J.hint = sec; J.moved = 0; }
  };
  return J;
}

// ---- 06_game.js ----
// =====================================================================
// The game: low-res pixel pipeline, room, input, the 30-second round,
// difficulty, scoring, HUD, title and result screens, and the Plethora
// lifecycle.
// =====================================================================

const ROUND = 30;
const FLOOR_H = 16;
const SAVE_KEY = 'cte-save';

const UI_CSS = `
.cte{position:absolute;inset:0;font-family:Inter,"Helvetica Neue",Arial,system-ui,sans-serif;color:#eadfc8;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.cte-hud{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:calc(var(--sat) + 10px) calc(var(--sar) + 18px) 0 calc(var(--sal) + 18px);font-weight:600;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .3s}
.cte-hud.on{opacity:1}
.cte-time,.cte-score{font-size:var(--hud);line-height:1;letter-spacing:.01em;text-shadow:0 1px 0 #0a0407}
.cte-time.low{color:#d9878a}
.cte-score{text-align:right;display:inline-block;transition:transform .12s ease-out}
.cte-score.bump{transform:scale(1.14)}
.cte-mult{font-size:calc(var(--hud) * .55);font-weight:600;color:#d9878a;text-align:right;margin-top:5px;opacity:0;transition:opacity .2s;letter-spacing:.04em}
.cte-mult.on{opacity:1}
.cte-pop{position:absolute;left:0;top:0;font-size:13px;font-weight:600;white-space:nowrap;opacity:0;will-change:transform,opacity;text-shadow:0 1px 0 #0a0407}
.cte-scrim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,rgba(10,4,8,.62),rgba(10,4,8,.2) 70%);opacity:0;transition:opacity .4s}
.cte-scrim.on{opacity:1}
.cte-screen{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;opacity:0;visibility:hidden;transition:opacity .35s,visibility 0s .35s}
.cte-screen.on{opacity:1;visibility:visible;transition:opacity .35s}
.cte-title{margin-top:calc(var(--sat) + 15vh);font-weight:700;font-size:clamp(30px,9.4vw,60px);letter-spacing:.05em;line-height:1;text-align:center}
.cte-title i{display:block;font-style:normal;color:#d9878a}
.cte-btn{pointer-events:auto;font:inherit;font-weight:700;font-size:14px;letter-spacing:.2em;padding:15px 44px 15px 47px;border-radius:999px;border:0;background:#eadfc8;color:#2a0c15;cursor:pointer;box-shadow:0 2px 0 #7d6a66;transition:transform .08s}
.cte-btn:active{transform:translateY(2px);box-shadow:none}
.cte-play{margin-top:9vh}
.cte-best{font-size:11px;font-weight:600;letter-spacing:.18em;color:#a08d93;margin-top:16px;min-height:14px}
.cte-res{margin-top:calc(var(--sat) + 8vh);display:flex;flex-direction:column;align-items:center}
.cte-lab{font-size:11px;font-weight:600;letter-spacing:.22em;color:#a08d93}
.cte-big{font-size:clamp(56px,17vw,96px);font-weight:700;line-height:1;margin:6px 0 4px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.cte-new{font-size:11px;font-weight:700;letter-spacing:.2em;color:#2a0c15;background:#d9878a;border-radius:999px;padding:4px 10px 4px 12px;opacity:0;transform:scale(.6);transition:opacity .25s,transform .25s cubic-bezier(.3,1.6,.5,1)}
.cte-new.on{opacity:1;transform:scale(1)}
.cte-stats{display:flex;gap:28px;margin:18px 0 18px;font-variant-numeric:tabular-nums}
.cte-stats div{display:flex;flex-direction:column;align-items:center;gap:5px}
.cte-stats b{font-size:20px;font-weight:700}
.cte-mute{position:absolute;right:calc(var(--sar) + 14px);top:calc(var(--sat) + 10px);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;color:#a08d93;opacity:0;visibility:hidden;transition:opacity .3s}
.cte-mute.on{opacity:1;visibility:visible}
.cte-mute svg{width:20px;height:20px}
.cte-board{min-height:68px;margin-bottom:20px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;font-weight:600;letter-spacing:.06em;color:#a08d93;font-variant-numeric:tabular-nums}
.cte-board div{display:flex;gap:14px;min-width:120px;justify-content:space-between}
.cte-board .me{color:#eadfc8}
.cte-board .lab{letter-spacing:.22em;font-size:10px;margin-bottom:2px}
.cte-retry{margin-top:18px}
.cte-msg{margin-top:32vh;padding:0 32px;text-align:center;font-size:14px;line-height:1.5;color:#a08d93}
`;

const ICON_SOUND = '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13 7c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M15.2 4.8C16.9 6.2 17.8 8 17.8 10s-.9 3.8-2.6 5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13.5 7.5l5 5M18.5 7.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

window.plethoraBit = {
  meta: { title: 'Catch the Eyeball', runtime: 'plethora-bit@2', tags: ['arcade', 'halloween', 'pixel-art', 'casual'], permissions: ['haptics', 'audio', 'backgroundMusic', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = { best: 0, muted: false, plays: 0 };
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- DOM shell first, so the first frame is never blank ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';position:absolute;display:block;image-rendering:pixelated;image-rendering:crisp-edges;background:#140c13;touch-action:none';
    const ui = ctx.createRoot({ className: 'cte', layer: 'overlay', input: 'passthrough' });
    ui.classList.add('cte');
    ui.style.pointerEvents = 'none';
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.scrim = el('div', 'cte-scrim on');
    H.hud = el('div', 'cte-hud');
    H.time = el('div', 'cte-time', '30', H.hud);
    const sw = el('div', '', '', H.hud); sw.style.textAlign = 'right';
    H.score = el('div', 'cte-score', '0', sw); H.mult = el('div', 'cte-mult', '', sw);
    H.pops = [0, 1, 2].map(() => el('div', 'cte-pop'));
    H.title = el('div', 'cte-screen on');
    el('div', 'cte-title', 'CATCH THE<i>EYEBALL</i>', H.title);
    H.play = el('button', 'cte-btn cte-play', 'PLAY', H.title);
    H.best = el('div', 'cte-best', '', H.title);
    H.result = el('div', 'cte-screen');
    const rc = el('div', 'cte-res', '', H.result);
    el('div', 'cte-lab', 'SCORE', rc);
    H.final = el('div', 'cte-big', '0', rc);
    H.newBest = el('div', 'cte-new', 'NEW BEST', rc);
    const stats = el('div', 'cte-stats', '', rc);
    const s1 = el('div', '', '', stats); H.rBest = el('b', '', '0', s1); el('span', 'cte-lab', 'BEST', s1);
    const s2 = el('div', '', '', stats); H.rCaught = el('b', '', '0', s2); el('span', 'cte-lab', 'CAUGHT', s2);
    H.board = el('div', 'cte-board', '', rc);
    H.again = el('button', 'cte-btn', 'PLAY AGAIN', rc);
    H.mute = el('div', 'cte-mute on', save.muted ? ICON_MUTED : ICON_SOUND);
    H.play.style.visibility = 'hidden';
    if (save.best > 0) H.best.textContent = 'BEST ' + save.best;
    if (ctx.markVisualReady) try { ctx.markVisualReady('title'); } catch (e) { }
    for (const w of ['400', '600', '700']) { try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: w, style: 'normal' }).catch(() => { }); } catch (e) { } }

    const stageMsg = {
      library: 'The game engine could not be downloaded. Check your connection, then try again.',
      renderer: 'This device could not start WebGL graphics.',
      frame: 'The first frame could not be drawn. Please reopen the game.'
    };
    let readySent = false;
    const sendReady = () => { if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } } };
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      H.play.style.display = 'none';
      const m = el('div', 'cte-msg', stageMsg[stage], H.title);
      sendReady();
      return m;
    }

    let THREE = null;
    while (!THREE) {
      try { THREE = await ctx.importModule('three', '0.164.1'); }
      catch (e) {
        if (destroyed) return;
        const m = bootFail('library', e);
        const retry = el('button', 'cte-btn cte-retry', 'TRY AGAIN', m);
        await new Promise(res => { if (ctx.input) ctx.input.activate(retry, res); else ctx.listen(retry, 'click', res); });
        m.remove(); H.play.style.display = '';
      }
      if (destroyed) return;
    }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color(PAL.wall[1]), 1);
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- art ----------
    const art = { big: {}, small: {} };
    for (const k of Object.keys(EYE_KINDS)) { art.big[k] = paintEye(22, k); art.small[k] = paintEye(14, k); }
    art.jarBack = paintJarBack(); art.jarFront = paintJarFront();
    art.shadow = paintShadow(44, 6); art.arrowL = paintArrow(-1); art.arrowR = paintArrow(1);
    art.flames = paintFlames(); art.glow = paintGlow(12, '#5a3020');

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-100, 100, 100, 0, -100, 100);
    camera.position.z = 10;
    const M = createMats(THREE);
    ctx.onDestroy(() => M.dispose());
    const audio = createAudio(caps.audio !== false);
    audio.setMuted(!!save.muted);
    ctx.onDestroy(() => audio.close());
    const fx = createFx(THREE, scene);
    const hooks = {};
    const eyes = createEyes(THREE, scene, M, art, fx, audio, hooks);
    const jar = createJar(THREE, scene, M, art, fx, audio);

    // room backdrop and its few living lights
    const bg = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
    bg.renderOrder = 0; bg.frustumCulled = false; scene.add(bg);
    const candleViews = [];
    let roomPx = null;

    // ---------- layout: an integer number of device pixels per art pixel ----------
    let laidOut = false;
    const world = { W: 200, H: 300, PW: 90, FLOOR: FLOOR_H, U: 1, cap: 3, k: 1, left: 0, top: 0 };
    function layout(cssW, cssH) {
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      laidOut = true;
      cssW = Math.max(1, cssW); cssH = Math.max(1, cssH);
      const dpr = Math.min(3, ctx.nativeDpr || ctx.dpr || window.devicePixelRatio || 1);
      const devW = cssW * dpr, devH = cssH * dpr;
      const scale = Math.max(1, Math.floor(Math.min(devW / 200, devH / 300)));
      let W = Math.ceil(devW / scale); if (W % 2) W++;
      const Hh = Math.ceil(devH / scale);
      const k = scale / dpr;
      world.W = W; world.H = Hh; world.k = k;
      world.left = (cssW - W * k) / 2; world.top = cssH - Hh * k;
      world.PW = Math.min(W / 2 - 2, 160);
      // the jar is the one control, so its floor sits above the content-safe bottom edge;
      // the stone below it is passive scenery that runs to the screen edge
      world.FLOOR = FLOOR_H + Math.round((sa.bottom || 0) / k);
      world.U = (Hh - world.FLOOR) / 344;
      renderer.setSize(W, Hh, false);
      canvas.style.width = (W * k) + 'px'; canvas.style.height = (Hh * k) + 'px';
      canvas.style.left = world.left + 'px'; canvas.style.top = world.top + 'px';
      camera.left = -W / 2; camera.right = W / 2; camera.top = Hh; camera.bottom = 0; camera.updateProjectionMatrix();
      ui.style.setProperty('--hud', Math.round(clamp(13 * k, 21, 32)) + 'px');
      for (const [v, n] of [['--sat', sa.top], ['--sab', sa.bottom], ['--sal', sa.left], ['--sar', sa.right]]) ui.style.setProperty(v, (n || 0) + 'px');
      // repaint the room at the new size
      const room = paintRoom(W, Hh, world.PW, world.FLOOR);
      if (roomPx) M.forget(roomPx);
      roomPx = room.canvas;
      bg.material.map = M.tex(roomPx); bg.material.needsUpdate = true;
      bg.scale.set(W, Hh, 1); bg.position.set(0, Hh / 2, 0);
      for (const c of candleViews) { scene.remove(c.flame, c.glow); c.glow.material.dispose(); }
      candleViews.length = 0;
      for (const c of room.candles) {
        const flame = M.sprite(art.flames[0], 2), glow = M.sprite(art.glow, 1, { blending: THREE.AdditiveBlending, opacity: 0.5 });
        const sy = c.y + 1;
        flame.position.set(c.x + 1 - W / 2, Hh - (sy - 12), 0);
        glow.position.set(c.x + 1 - W / 2, Hh - (sy - 12), 0);
        scene.add(glow, flame);
        candleViews.push({ flame, glow, phase: Math.random() * 10 });
      }
      eyes.setWorld(world); jar.setWorld(world); eyes.clampAll();
    }

    // ---------- game state ----------
    const G = {
      mode: 'title', t: 0, score: 0, shown: 0, caught: 0, combo: 0, comboT: 0, mult: 1,
      next: 0, gold: [], endT: 0, closed: false, shake: 0, demoNext: 0, resultT: 0, newBest: false,
      kb: 0, pointerX: null, now: 0, lastTick: -1, stats: { miss: 0, split: 0, boom: 0, boomJar: 0 }
    };
    let popI = 0;
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    let attempt = 0;

    function worldToCss(x, y) { return [world.left + (x + world.W / 2) * world.k, world.top + (world.H - y) * world.k]; }
    function popup(text, color, x, y) {
      const p = H.pops[popI++ % H.pops.length];
      const [cx, cy] = worldToCss(x, y);
      p.textContent = text; p.style.color = color; p.style.fontSize = Math.round(clamp(7.5 * world.k, 12, 24)) + 'px';
      p.animate([
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-100%)`, opacity: 0 },
        { transform: `translate(${cx}px,${cy - 10}px) translate(-50%,-100%)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${cx}px,${cy - 26}px) translate(-50%,-100%)`, opacity: 0 }
      ], { duration: 650, easing: 'ease-out', fill: 'forwards' });
    }
    function setScore(v) {
      G.score = v;
      H.score.textContent = String(v);
      H.score.classList.remove('bump'); void H.score.offsetWidth; H.score.classList.add('bump');
      setTimeout(() => H.score.classList.remove('bump'), 120);
      if (scoreTrack) try { scoreTrack.set(v); } catch (e) { } else try { ctx.platform.setScore(v); } catch (e) { }
    }

    hooks.onCatch = e => {
      jar.bump(e.behaviour === 'gold' ? 1.4 : 1);
      fx.burst(e.x, jar.mouthY + 2, 6, { speed: 45, angle: Math.PI / 2, spread: 2.4, life: 0.35, g: -150, sizes: [1, 1, 2], colors: e.behaviour === 'gold' ? [PAL.irisGold[3], '#f6dc9a'] : [PAL.sclera[4], PAL.veinPink] });
      if (e.demo || G.mode !== 'play' && G.mode !== 'ending') { audio.catch(0, false); return; }
      G.combo = G.comboT > 0 ? G.combo + 1 : 1; G.comboT = 2.6;
      G.mult = G.combo >= 10 ? 4 : G.combo >= 6 ? 3 : G.combo >= 3 ? 2 : 1;
      const pts = e.rule.points * G.mult;
      G.caught++;
      setScore(G.score + pts);
      H.mult.textContent = '×' + G.mult; H.mult.classList.toggle('on', G.mult > 1);
      popup('+' + pts, e.behaviour === 'gold' ? '#efc66a' : '#eadfc8', jar.x, jar.mouthY + 8);
      audio.catch(G.combo, e.behaviour === 'gold');
      haptic(e.behaviour === 'gold' ? 'success' : 'light');
      try { ctx.platform.interact({ type: 'catch', kind: e.behaviour }); } catch (er) { }
    };
    hooks.onExplode = (e, inJar) => {
      G.stats[inJar ? 'boomJar' : 'boom']++;
      G.shake = Math.max(G.shake, inJar ? 5 : 2.5);
      if (!inJar) return;
      jar.injure();
      haptic('heavy');
      if (G.mode === 'play' || G.mode === 'ending') {
        audio.penalty();
        G.combo = 0; G.comboT = 0; G.mult = 1; H.mult.classList.remove('on');
        setScore(Math.max(0, G.score - 25));
        popup('−25', '#d9545e', jar.x, jar.mouthY + 8);
      }
    };
    hooks.onMiss = () => { G.stats.miss++; };
    hooks.onSplit = () => { G.stats.split++; G.shake = Math.max(G.shake, 1.2); };

    // ---------- spawning and difficulty ----------
    function difficulty(t) {
      const d = clamp(t / ROUND, 0, 1);
      return { interval: lerp(1.2, 0.4, Math.pow(d, 0.85)), cap: Math.round(lerp(3, 10, d)), speed: lerp(0.82, 1.45, d) };
    }
    function chooseKind(t) {
      const w = [['teal', 1], ['brown', 0.8]];
      if (t > 4) w.push(['blood', lerp(0.3, 0.55, (t - 4) / 26)]);
      if (t > 9 && eyes.countOf('warp') < 2) w.push(['warp', 0.3]);
      if (t > 13 && eyes.countOf('split') < 1) w.push(['split', 0.24]);
      if (t > 17 && eyes.countOf('demon') < 2) w.push(['demon', lerp(0.22, 0.42, (t - 17) / 13)]);
      let sum = 0; for (const [, v] of w) sum += v;
      let r = Math.random() * sum;
      for (const [k, v] of w) { r -= v; if (r <= 0) return k; }
      return 'teal';
    }
    function spawnPos(r) {
      const { PW, H: Hh, FLOOR } = world;
      let best = null;
      for (let i = 0; i < 10; i++) {
        const x = (Math.random() * 2 - 1) * (PW - r - 8);
        const y = lerp(FLOOR + (Hh - FLOOR) * 0.55, Hh - r - 30, Math.random());
        let clear = Infinity;
        for (const o of eyes.eyes) if (o.on) clear = Math.min(clear, Math.hypot(o.x - x, o.y - y) - o.r - r);
        if (!best || clear > best.clear) best = { x, y, clear };
        if (clear > 8) break;
      }
      return best;
    }
    function spawnEye(kind, speed, o) {
      const p = spawnPos(9.5);
      G.stats[kind] = (G.stats[kind] || 0) + 1;
      return eyes.spawn(kind, o && o.x !== undefined ? o.x : p.x, o && o.y !== undefined ? o.y : p.y, Object.assign({ speed }, o || {}));
    }
    function updateSpawns(dt) {
      const t = G.t, D = difficulty(t);
      world.cap = D.cap;
      // teach first: two calm eyes drift down either side of the jar
      if (G.teach < 2 && t >= (G.teach === 0 ? 0.25 : 1.3)) {
        const side = G.teach === 0 ? -1 : 1;
        spawnEye(G.teach === 0 ? 'teal' : 'brown', 0.75, { x: clamp(jar.x + side * 34, -world.PW + 20, world.PW - 20), y: world.FLOOR + (world.H - world.FLOOR) * 0.72, vx: -side * 25 * world.U, vy: 0 });
        G.teach++; G.next = t + 1.4;
        return;
      }
      if (G.gold.length && t >= G.gold[0]) { G.gold.shift(); spawnEye('gold', D.speed * 0.9); }
      if (t >= G.next && G.teach >= 2) {
        if (eyes.count() < D.cap) spawnEye(chooseKind(t), D.speed);
        G.next = t + D.interval * (0.8 + Math.random() * 0.4);
      }
    }

    // ---------- autopilot (title screen demonstration, and the test bot) ----------
    function autopilotTarget(avoidDemons) {
      let best = null;
      for (const e of eyes.eyes) {
        if (!e.on || e.state !== 'live' || e.behaviour === 'demon') continue;
        const g = 230 * world.U * e.rule.g * e.ts * e.ts;
        const h = e.y - jar.mouthY;
        if (h < 2) continue;
        const vy = e.vy * e.ts;
        const tHit = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
        let x = e.x + e.vx * e.ts * tHit;
        const L = world.PW - e.r;
        for (let i = 0; i < 4; i++) { if (x > L) x = 2 * L - x; if (x < -L) x = -2 * L - x; }
        const score = tHit - (e.behaviour === 'gold' ? 0.6 : 0);
        if (!best || score < best.score) best = { x, score };
      }
      let tx = best ? best.x : jar.target;
      if (avoidDemons) {
        for (const e of eyes.eyes) {
          if (!e.on || e.behaviour !== 'demon' || e.state !== 'live') continue;
          if (Math.abs(e.x - tx) < 30 && e.y < jar.mouthY + 90) tx = e.x + (tx >= e.x ? 34 : -34);
        }
      }
      return tx;
    }

    // ---------- flow ----------
    function show(screen) {
      H.title.classList.toggle('on', screen === 'title');
      H.result.classList.toggle('on', screen === 'result');
      H.scrim.classList.toggle('on', screen !== null);
      H.mute.classList.toggle('on', screen !== null);
      H.hud.classList.toggle('on', screen === null);
    }
    function begin() {
      if (G.mode === 'play' || G.mode === 'ending') return;
      audio.unlock(); audio.button();
      eyes.clear(); fx.clear(); jar.clear();
      Object.assign(G, { stats: { miss: 0, split: 0, boom: 0, boomJar: 0 }, mode: 'play', t: 0, score: 0, caught: 0, combo: 0, comboT: 0, mult: 1, next: 0, teach: 0, endT: 0, closed: false, shake: 0, lastTick: -1 });
      G.gold = [8 + Math.random() * 4, 18 + Math.random() * 5];
      if (Math.random() < 0.5) G.gold.push(25 + Math.random() * 3);
      H.score.textContent = '0'; H.mult.classList.remove('on'); H.time.textContent = String(ROUND); H.time.classList.remove('low');
      jar.target = 0; jar.showHint(3);
      G.pointerX = null; G.pulsed = false; G.tension = 0;
      attempt++;
      show(null);
      try { ctx.platform.start({ attempt }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { } else try { ctx.platform.setScore(0); } catch (e) { }
      startMusic();
    }

    // ---------- music: a quiet spooky bed that tightens toward the end ----------
    let music = null;
    function startMusic() {
      if (!caps.backgroundMusic || !ctx.music) return;
      try {
        ctx.music.unlock().catch(() => { });
        if (!music) music = ctx.music.play({ preset: 'spooky', volume: save.muted ? 0 : 0.2, intensity: 0.25, tempo: 84, fadeInMs: 1800 });
        else { music.setIntensity(0.25, { fadeMs: 600 }); music.setVolume(save.muted ? 0 : 0.2, { fadeMs: 300 }); }
      } catch (e) { music = null; }
    }
    function musicIntensity(v) { if (music) try { music.setIntensity(v, { fadeMs: 1200 }); } catch (e) { } }
    function musicSting(name) { if (music && !save.muted) try { ctx.music.sting(name).catch(() => { }); } catch (e) { } }

    // ---------- result-screen leaderboard: top three and the viewer's place ----------
    const BOARD = { scope: 'global', period: 'all_time' };
    let boardRows = null;
    function renderBoard(board, status) {
      const rows = board && Array.isArray(board.rows) ? board.rows.slice(0, 3) : (boardRows || []);
      if (board) boardRows = rows;
      let html = '<div class="lab">' + (status || 'TOP SCORES') + '</div>';
      for (const r of rows) html += '<div><span>#' + (r.rank | 0) + '</span><span>' + Math.round(+r.value || 0) + '</span></div>';
      if (board && board.viewerRank && board.viewerRank.rank) html += '<div class="me"><span>YOU #' + (board.viewerRank.rank | 0) + '</span><span>' + Math.round(+board.viewerRank.value || G.score) + '</span></div>';
      if (!rows.length && !status) html = '';
      H.board.innerHTML = html;
    }
    function submitScore() {
      const mine = attempt, final = G.score;
      renderBoard(null, boardRows && boardRows.length ? 'UPDATING' : 'LOADING');
      let p = null;
      try {
        if (scoreTrack && scoreTrack.submit) p = scoreTrack.submit('score', { label: final + ' pts' });
        else if (ctx.memory && ctx.memory.record) p = ctx.memory.record('score').submit(final, { label: final + ' pts' });
      } catch (e) { p = null; }
      if (!p) { H.board.innerHTML = ''; return; }
      const read = () => scoreTrack && scoreTrack.leaderboard ? scoreTrack.leaderboard('score', Object.assign({ limit: 3 }, BOARD)) : ctx.memory.record('score').leaderboard(Object.assign({ limit: 3 }, BOARD));
      Promise.resolve(p).catch(() => null).then(() => read()).then(board => {
        if (destroyed || mine !== attempt) return;
        renderBoard(board, null);
      }).catch(() => { if (!destroyed && mine === attempt) renderBoard(null, 'LEADERBOARD UNAVAILABLE'); });
    }
    function finish() {
      G.mode = 'result'; G.resultT = 0;
      save.plays = (save.plays || 0) + 1;
      G.newBest = G.score > (save.best || 0);
      if (G.newBest) save.best = G.score;
      persist();
      H.final.textContent = '0'; H.rBest.textContent = String(save.best); H.rCaught.textContent = String(G.caught);
      H.newBest.classList.remove('on');
      H.best.textContent = save.best > 0 ? 'BEST ' + save.best : '';
      show('result');
      audio.over();
      haptic('success');
      musicIntensity(0.15); musicSting(G.newBest ? 'win' : 'success');
      try { ctx.platform.complete({ score: G.score, caught: G.caught }); } catch (e) { }
      submitScore();
    }

    function step(dt) {
      G.now += dt;
      if (G.mode === 'play') {
        G.t += dt;
        const left = Math.max(0, ROUND - G.t);
        const sec = Math.ceil(left);
        H.time.textContent = left <= 5 ? left.toFixed(1) : String(sec);
        H.time.classList.toggle('low', left <= 5);
        if (G.tension === 0 && left <= 12) { G.tension = 1; musicIntensity(0.55); }
        if (G.tension === 1 && left <= 5) { G.tension = 2; musicIntensity(0.8); }
        if (left <= 5 && sec !== G.lastTick) { G.lastTick = sec; if (sec > 0) audio.tick(sec <= 3); }
        if (G.t >= ROUND) { G.mode = 'ending'; G.endT = 0; H.time.textContent = '0.0'; }
        else updateSpawns(dt);
        G.comboT = Math.max(0, G.comboT - dt);
        if (G.comboT <= 0 && G.mult > 1) { G.mult = 1; G.combo = 0; H.mult.classList.remove('on'); }
      } else if (G.mode === 'ending') {
        // let anything already dropping into the jar land, then close every eye
        G.endT += dt;
        if (G.endT >= 0.9 && !G.closed) { G.closed = true; eyes.closeAll(); }
        if (G.endT >= 1.6) finish();
      } else if (G.mode === 'title') {
        G.demoNext -= dt;
        if (G.demoNext <= 0 && eyes.count() < 2) {
          G.demoNext = 1.4 + Math.random();
          spawnEye(Math.random() < 0.12 ? 'gold' : Math.random() < 0.5 ? 'teal' : 'brown', 0.8, { demo: true });
        }
      } else if (G.mode === 'result') {
        G.resultT += dt;
        const k = Math.min(1, G.resultT / 0.9);
        H.final.textContent = String(Math.round(G.score * easeOut(k)));
        if (k >= 1 && G.newBest && !H.newBest.classList.contains('on')) { H.newBest.classList.add('on'); haptic('light'); }
        if (k >= 1 && !G.pulsed && G.resultT > 1.3) {
          G.pulsed = true;
          try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ score: G.score, durationMs: ROUND * 1000, text: 'Caught ' + G.caught + (G.caught === 1 ? ' eyeball' : ' eyeballs') + ' · ' + G.score + ' pts' }); } catch (e) { }
        }
      }

      // jar control: autopilot on the title, else keyboard or pointer
      if (G.mode === 'title' || G.bot) jar.target = autopilotTarget(!!G.bot);
      else if (G.kb) jar.target += G.kb * 300 * world.U * dt;
      else if (G.pointerX !== null) jar.target = G.pointerX;
      jar.update(dt, G.now);
      eyes.update(dt, jar);
      fx.update(dt);

      // the room breathes: candles, drifting dust
      for (const c of candleViews) {
        c.phase += dt * (7 + Math.random() * 5);
        M.setSprite(c.flame, art.flames[Math.floor(c.phase) % 3]);
        c.glow.material.opacity = 0.42 + Math.sin(c.phase * 0.7) * 0.08 + Math.random() * 0.06;
      }
      if (Math.random() < dt * 1.2) fx.burst((Math.random() * 2 - 1) * world.W / 2, world.FLOOR + Math.random() * (world.H - world.FLOOR), 1, { speed: 3, life: 3, g: -2, size: 1, color: PAL.dust });
      audio.ambience(G.mode === 'title' ? 0.6 : 1, dt);

      G.shake = Math.max(0, G.shake - dt * 18);
      const sh = Math.round(G.shake);
      camera.position.x = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0;
      camera.position.y = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0;
    }

    // ---------- input ----------
    const toWorldX = clientX => { const r = canvas.getBoundingClientRect(); return ((clientX - r.left) / r.width) * world.W - world.W / 2; };
    const playing = () => G.mode === 'play' || G.mode === 'ending';
    // touch, pen and mouse drags anywhere on the playfield move the jar
    const input = ctx.input ? ctx.input.track(canvas, { multitouch: false }) : null;
    function readInput() {
      if (!input || !playing()) return;
      const p = input.primary || input;
      if (p.down) { G.pointerX = (p.x / Math.max(1, canvas.clientWidth)) * world.W - world.W / 2; G.kb = 0; }
    }
    if (!input) {
      let dragging = false;
      ctx.listen(canvas, 'pointerdown', e => { dragging = true; G.kb = 0; if (playing()) G.pointerX = toWorldX(e.clientX); });
      ctx.listen(canvas, 'pointermove', e => { if (dragging && playing()) G.pointerX = toWorldX(e.clientX); });
      const up = () => { dragging = false; };
      ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up);
    }
    // a desktop mouse also steers by hovering, without holding a button
    ctx.listen(canvas, 'pointermove', e => { if (e.pointerType === 'mouse' && playing()) { G.pointerX = toWorldX(e.clientX); G.kb = 0; } });
    const keys = new Set();
    const kbDir = () => (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const keyName = k => (k === 'ArrowLeft' || k === 'a' || k === 'A') ? 'left' : (k === 'ArrowRight' || k === 'd' || k === 'D') ? 'right' : null;
    ctx.listen(window, 'keydown', e => {
      const n = keyName(e.key);
      if (n) { keys.add(n); if (G.mode === 'play' || G.mode === 'ending') { G.kb = kbDir(); G.pointerX = null; } e.preventDefault(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && (G.mode === 'title' || (G.mode === 'result' && G.resultT > 0.5))) { e.preventDefault(); begin(); }
      if (e.key === 'm' || e.key === 'M') toggleMute();
    });
    ctx.listen(window, 'keyup', e => { const n = keyName(e.key); if (n) { keys.delete(n); G.kb = kbDir(); } });
    ctx.listen(window, 'blur', () => { keys.clear(); G.kb = 0; });
    const activate = (node, fn) => { if (ctx.input) ctx.input.activate(node, fn); else ctx.listen(node, 'click', fn); };
    activate(H.play, begin);
    activate(H.again, () => { if (G.resultT > 0.4) begin(); });
    function toggleMute() {
      save.muted = !save.muted; persist();
      audio.setMuted(save.muted);
      H.mute.innerHTML = save.muted ? ICON_MUTED : ICON_SOUND;
      if (music) try { music.setVolume(save.muted ? 0 : 0.2, { fadeMs: 200 }); } catch (e) { }
    }
    H.mute.setAttribute('role', 'button'); H.mute.setAttribute('tabindex', '0'); H.mute.setAttribute('aria-label', 'Sound');
    activate(H.mute, () => { audio.unlock(); toggleMute(); });

    // ---------- run ----------
    ctx.onResize(({ width, height }) => layout(width, height), { immediate: true });
    if (!laidOut) layout(ctx.width, ctx.height);
    jar.x = 0; jar.target = 0;
    try { renderer.render(scene, camera); } catch (e) { bootFail('frame', e); return; }
    H.play.style.visibility = '';
    sendReady();

    const frame = dtMs => {
      if (destroyed || G.manual) return;
      readInput();
      step(Math.min(0.05, Math.max(0, dtMs / 1000)));
    };
    const draw = () => { if (!destroyed) renderer.render(scene, camera); };
    if (ctx.game && ctx.game.loop) ctx.game.loop({ input: input || undefined, maxDeltaMs: 50, update: frame, render: draw });
    else {
      let last = performance.now();
      ctx.onFrame(() => { const now = performance.now(); frame(now - last); last = now; draw(); });
    }

    if (window.__CTE_DEV) {
      window.__cte = {
        G, world, eyes, jar, begin, art,
        // run the simulation deterministically in 60 Hz steps, without the frame loop
        advance(sec, o) {
          G.manual = true; G.bot = !!(o && o.bot);
          const n = Math.round(sec * 60);
          for (let i = 0; i < n; i++) step(1 / 60);
          renderer.render(scene, camera);
          G.manual = !!(o && o.hold);
        },
        spawn: (kind, x, y, o) => eyes.spawn(kind, x, y, Object.assign({ instant: true }, o || {})),
        render() { renderer.render(scene, camera); }
      };
    }
  }
};

})();
