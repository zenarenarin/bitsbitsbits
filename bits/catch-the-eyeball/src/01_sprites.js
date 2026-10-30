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
