// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// KINTSUGI — repair a broken ceramic with gold.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Small math, randomness and noise helpers. No dependencies.
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const smoother = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeOutCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutCubic = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOutQuint = t => 1 - Math.pow(1 - clamp01(t), 5);
// wrap an angle into (-PI, PI]
const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
// signed shortest difference on the unit circle of u in [0,1)
const wrapU = d => d - Math.round(d);

// mulberry32
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

// 3D gradient noise (Perlin-style) with a seeded permutation.
function makeNoise(seed) {
  const rng = makeRng(seed * 7919 + 17);
  const p = new Uint8Array(512);
  const perm = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function grad(h, x, y, z) { const g = G[h % 12]; return g[0] * x + g[1] * y + g[2] * z; }
  function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi, B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    return lerp(
      lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }
  function fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); f *= lac; a *= gain; }
    return s;
  }
  // noise on the (u periodic, v) cylinder: u in [0,1) wraps seamlessly
  function cyl(u, v, freq, oct = 3, zOff = 0) {
    const R = freq / TAU;
    return fbm3(Math.cos(u * TAU) * R, Math.sin(u * TAU) * R, v * freq + zOff, oct);
  }
  return { n3, fbm3, cyl };
}

// Catmull-Rom through 2D points, returns dense array of [x,y]
function catmull2(pts, perSeg) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

// ---- 01_objects.js ----
// The collection: eight ceramic objects, each a surface of revolution shaped by
// a hand-drawn profile plus small angular modulations (asymmetry, fluting, a
// folded rim). u in [0,1) runs around the object (u = 0 faces the viewer), v in
// [0,1] runs along the profile from the centre of the foot to the lip.

const OBJECTS = {
  cup: {
    name: 'Cup', thick: 0.034, elev: 0.24, glaze: [0.925, 0.900, 0.840], speck: 0.6, rings: 1.0,
    profile: [[0, 0.014], [0.27, 0.0], [0.305, 0.018], [0.33, 0.07], [0.36, 0.30], [0.385, 0.58], [0.41, 0.86], [0.43, 1.02]],
    rad: (u, v) => 1 + 0.014 * Math.sin(TAU * u * 3 + 1.1) * v + 0.008 * Math.sin(TAU * u * 2 + 0.3) * v * v,
    lift: (u, v) => 0.010 * Math.sin(TAU * u * 2 + 0.6) * Math.pow(v, 6)
  },
  bowl: {
    name: 'Bowl', thick: 0.034, elev: 0.52, glaze: [0.930, 0.905, 0.850], speck: 0.4, rings: 0.8,
    profile: [[0, 0.02], [0.17, 0.0], [0.205, 0.02], [0.24, 0.06], [0.38, 0.16], [0.52, 0.30], [0.62, 0.45], [0.68, 0.56], [0.70, 0.60]],
    rad: (u, v) => 1 + 0.018 * Math.cos(TAU * u * 2 + 0.4) * v * v,
    lift: (u, v) => 0.016 * Math.sin(TAU * u * 3 + 2.0) * Math.pow(v, 5)
  },
  plate: {
    name: 'Plate', thick: 0.032, elev: 0.92, glaze: [0.935, 0.915, 0.865], speck: 0.3, rings: 0.6,
    profile: [[0, 0.018], [0.26, 0.0], [0.29, 0.018], [0.33, 0.04], [0.52, 0.07], [0.72, 0.11], [0.84, 0.16], [0.90, 0.205], [0.915, 0.215]],
    rad: (u, v) => 1 + 0.010 * Math.sin(TAU * u * 2 + 0.9) * v,
    lift: (u, v) => 0.012 * Math.sin(TAU * u * 4 + 0.2) * Math.pow(v, 8)
  },
  vase: {
    name: 'Vase', thick: 0.034, elev: 0.16, glaze: [0.920, 0.895, 0.835], speck: 0.7, rings: 1.0,
    profile: [[0, 0.014], [0.22, 0.0], [0.255, 0.03], [0.32, 0.20], [0.42, 0.48], [0.47, 0.72], [0.44, 0.92], [0.33, 1.10], [0.20, 1.25], [0.155, 1.36], [0.165, 1.48], [0.20, 1.56], [0.215, 1.58]],
    rad: (u, v) => 1 + 0.016 * Math.sin(TAU * u + 0.5) * Math.sin(Math.PI * v),
    lift: (u, v) => 0.008 * Math.sin(TAU * u * 2 + 1.7) * Math.pow(v, 10)
  },
  holder: {
    name: 'Candle holder', thick: 0.036, elev: 0.50, glaze: [0.925, 0.905, 0.855], speck: 0.5, rings: 0.7,
    profile: [[0, 0.016], [0.36, 0.0], [0.41, 0.02], [0.43, 0.08], [0.42, 0.16], [0.36, 0.22], [0.27, 0.26], [0.22, 0.32], [0.205, 0.45], [0.215, 0.56], [0.24, 0.62]],
    rad: (u, v) => 1 + 0.012 * Math.sin(TAU * u * 3 + 0.2) * v,
    lift: (u, v) => 0.014 * Math.sin(TAU * u * 2 + 2.4) * Math.pow(v, 9)
  },
  fluted: {
    name: 'Fluted vessel', thick: 0.034, elev: 0.24, glaze: [0.935, 0.915, 0.870], speck: 0.25, rings: 0.0,
    profile: [[0, 0.014], [0.17, 0.0], [0.22, 0.03], [0.32, 0.16], [0.42, 0.40], [0.46, 0.66], [0.43, 0.90], [0.35, 1.08], [0.31, 1.18], [0.315, 1.22]],
    rad: (u, v) => 1 + 0.055 * Math.cos(TAU * u * 13 + v * 4.2) * smooth((v - 0.06) / 0.18) * (1 - 0.65 * smooth((v - 0.8) / 0.2)),
    lift: (u, v) => 0.012 * Math.cos(TAU * u * 13 + v * 4.2) * Math.pow(v, 12)
  },
  moonjar: {
    name: 'Moon jar', thick: 0.036, elev: 0.18, glaze: [0.928, 0.905, 0.845], speck: 0.8, rings: 0.5,
    profile: [[0, 0.014], [0.25, 0.0], [0.30, 0.05], [0.47, 0.24], [0.58, 0.52], [0.585, 0.74], [0.52, 0.98], [0.38, 1.14], [0.25, 1.21], [0.245, 1.27], [0.27, 1.31]],
    rad: (u, v) => 1 + 0.03 * Math.sin(TAU * u + 2.2) * Math.sin(Math.PI * v) + 0.012 * Math.sin(TAU * u * 3 + 0.7) * Math.sin(Math.PI * v),
    lift: (u, v) => 0.012 * Math.sin(TAU * u + 1.0) * Math.pow(v, 8)
  },
  folded: {
    name: 'Folded vessel', thick: 0.032, elev: 0.44, glaze: [0.940, 0.922, 0.878], speck: 0.2, rings: 0.3,
    profile: [[0, 0.016], [0.15, 0.0], [0.19, 0.04], [0.26, 0.22], [0.33, 0.45], [0.43, 0.70], [0.55, 0.90], [0.62, 1.00]],
    rad: (u, v) => 1 + 0.13 * Math.cos(TAU * u * 3 + 0.35) * Math.pow(v, 2.2) + 0.03 * Math.sin(TAU * u * 5 + 1.3) * Math.pow(v, 3),
    lift: (u, v) => 0.16 * Math.cos(TAU * u * 3 + 0.35 + 0.5) * Math.pow(v, 3.2) + 0.02 * Math.sin(TAU * u * 7) * Math.pow(v, 4)
  }
};

// Levels: difficulty rises through fragment count, rotation, pieces hidden
// round the back, tolerance, crack shape and the gold allowance.
//   loose     movable fragments (the foot piece stays on the plinth)
//   anchor    [front, back] height (v) of the foot piece's edge; back > 1 means
//             the whole back wall stays standing
//   spread    how far round the object the loose pieces reach (0.5 = all round)
//   roll      max initial rotation error of a piece (degrees)
//   warp      irregularity of the crack paths
//   pos/yaw/rollTol  placement tolerances (fraction of object size / degrees)
//   magnet    gold attraction radius (object units); gold  allowance factor
const LEVELS = [
  { obj: 'cup',     seed: 11, loose: 3,  anchor: [0.50, 1.30], spread: 0.13, roll: 0,   warp: 0.030, pos: 0.10,  yawTol: 26, rollTol: 24, magnet: 0.052, gold: 2.4 },
  { obj: 'bowl',    seed: 23, loose: 4,  anchor: [0.36, 0.90], spread: 0.24, roll: 14,  warp: 0.036, pos: 0.09,  yawTol: 24, rollTol: 22, magnet: 0.048, gold: 2.2 },
  { obj: 'plate',   seed: 31, loose: 5,  anchor: [0.40, 1.20], spread: 0.22, roll: 120, warp: 0.040, pos: 0.08,  yawTol: 22, rollTol: 18, magnet: 0.044, gold: 2.0 },
  { obj: 'vase',    seed: 47, loose: 6,  anchor: [0.30, 0.30], spread: 0.50, roll: 35,  warp: 0.044, pos: 0.075, yawTol: 18, rollTol: 16, magnet: 0.040, gold: 1.85 },
  { obj: 'holder',  seed: 59, loose: 6,  anchor: [0.36, 0.36], spread: 0.50, roll: 100, warp: 0.050, pos: 0.07,  yawTol: 16, rollTol: 14, magnet: 0.036, gold: 1.75 },
  { obj: 'fluted',  seed: 71, loose: 7,  anchor: [0.26, 0.26], spread: 0.50, roll: 160, warp: 0.056, pos: 0.065, yawTol: 14, rollTol: 12, magnet: 0.034, gold: 1.65 },
  { obj: 'moonjar', seed: 83, loose: 9,  anchor: [0.24, 0.24], spread: 0.50, roll: 180, warp: 0.060, pos: 0.06,  yawTol: 12, rollTol: 10, magnet: 0.031, gold: 1.55 },
  { obj: 'folded',  seed: 97, loose: 11, anchor: [0.24, 0.24], spread: 0.50, roll: 180, warp: 0.066, pos: 0.055, yawTol: 10, rollTol: 9,  magnet: 0.028, gold: 1.5 }
];

// Build an evaluable surface for an object definition.
function makeSurface(def) {
  const dense = catmull2(def.profile, 24);
  // arclength parametrisation
  const s = [0];
  for (let i = 1; i < dense.length; i++) s.push(s[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const L = s[s.length - 1];
  const N = 512, R = new Float32Array(N + 1), Y = new Float32Array(N + 1);
  let k = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * L;
    while (k < s.length - 2 && s[k + 1] < t) k++;
    const f = (t - s[k]) / Math.max(1e-9, s[k + 1] - s[k]);
    R[i] = lerp(dense[k][0], dense[k + 1][0], f);
    Y[i] = lerp(dense[k][1], dense[k + 1][1], f);
  }
  R[0] = 0;
  function prof(v) {
    const x = clamp01(v) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
    return [R[i] + (R[i + 1] - R[i]) * f, Y[i] + (Y[i + 1] - Y[i]) * f];
  }
  // allocation-free: this runs for every vertex of every shard
  function pos(u, v, out) {
    const x = (v < 0 ? 0 : v > 1 ? 1 : v) * N, i = x >= N ? N - 1 : Math.floor(x), f = x - i;
    const pr = R[i] + (R[i + 1] - R[i]) * f, py = Y[i] + (Y[i + 1] - Y[i]) * f;
    const r = pr * def.rad(u, v), a = u * TAU;
    out[0] = r * Math.sin(a); out[1] = py + def.lift(u, v) * smooth(v * 3); out[2] = r * Math.cos(a);
    return out;
  }
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  // outward unit normal
  function normal(u, v, out) {
    const e = 1e-3;
    if (v < 0.004) { out[0] = 0; out[1] = -1; out[2] = 0; return out; }
    pos(u + e, v, A); pos(u - e, v, B);
    const v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
    pos(u, v1, C); pos(u, v0, D);
    const tu = [A[0] - B[0], A[1] - B[1], A[2] - B[2]], tv = [C[0] - D[0], C[1] - D[1], C[2] - D[2]];
    // n = tu x tv points outward for this parametrisation
    let nx = tu[1] * tv[2] - tu[2] * tv[1], ny = tu[2] * tv[0] - tu[0] * tv[2], nz = tu[0] * tv[1] - tu[1] * tv[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }
  // circumference scale: object-length of one unit of u, relative to profile length
  function cscale(v) { const x = (v < 0 ? 0 : v > 1 ? 1 : v) * N, i = x >= N ? N - 1 : Math.floor(x); return (TAU * Math.max(0.02, R[i] + (R[i + 1] - R[i]) * (x - i))) / L; }
  // bounds
  let maxR = 0, maxY = 0;
  for (let i = 0; i <= N; i++) { maxR = Math.max(maxR, R[i]); maxY = Math.max(maxY, Y[i]); }
  return { def, pos, normal, prof, cscale, L, height: maxY + 0.05, radius: maxR * 1.15 };
}

// ---- 02_fracture.js ----
// Controlled fracture. A warped, weighted Voronoi field on the object's (u,v)
// surface decides which fragment owns every grid vertex; marching triangles on
// the differences of the distance fields give smooth crack curves that both
// neighbouring fragments share exactly. Each fragment becomes a real shard:
// glazed outer and inner skins, unglazed fracture walls, and a rounded lip.
// The crack graph becomes the seams the player fills with gold.

function buildFracture(surf, lv) {
  const def = surf.def;
  const T = def.thick;
  const nu = 128;
  const nv = clamp(Math.round(surf.L / (TAU * surf.radius / 1.15 / nu) * 0.9), 40, 64);
  for (let attempt = 0; attempt < 80; attempt++) {
    const res = tryFracture(surf, lv, nu, nv, lv.seed * 101 + attempt * 7);
    if (res) { res.attempt = attempt; return res; }
  }
  throw new Error('fracture: no valid pattern for ' + lv.obj);
}

function tryFracture(surf, lv, nu, nv, seed) {
  const T = surf.def.thick;
  const rng = makeRng(seed);
  const noise = makeNoise(seed);
  const n = lv.loose;
  const anchorEdge = u => lv.anchor[0] + (lv.anchor[1] - lv.anchor[0]) * (1 - Math.cos(TAU * u)) / 2 + 0.035 * noise.cyl(u, 0.3, 2.5, 2, 9.1);

  // --- seeds by best-candidate sampling in a roughly isometric metric
  const seeds = [];
  const metricDist = (u1, v1, u2, v2) => Math.hypot(wrapU(u1 - u2) * surf.cscale((v1 + v2) / 2), v1 - v2);
  for (let k = 0; k < n; k++) {
    let best = null, bestScore = -1;
    for (let c = 0; c < 40; c++) {
      const u = (rng() * 2 - 1) * lv.spread;
      const lo = Math.min(0.9, anchorEdge(u) + 0.08);
      const v = lerp(lo, 0.97, rng());
      if (v <= anchorEdge(u) + 0.04) continue;
      let score = Math.abs(v - (anchorEdge(u) - 0.1)) * 0.8;
      score = Math.min(score, (1.0 - v) * 1.4 + 0.12);
      for (const s of seeds) score = Math.min(score, metricDist(u, v, s.u, s.v));
      if (score > bestScore) { bestScore = score; best = { u: (u + 1) % 1, v, w: lerp(0.86, 1.14, rng()) }; }
    }
    if (!best) return null;
    seeds.push(best);
  }
  const L = n + 1; // label 0 is the anchor (foot piece)

  // --- distance fields on the grid
  const NV = nu * nv;
  const D = new Float32Array(NV * L);
  const lab = new Int16Array(NV);
  const gu = new Float32Array(NV), gv = new Float32Array(NV);
  const warp = lv.warp;
  for (let j = 0; j < nv; j++) {
    const v = j / (nv - 1);
    for (let i = 0; i < nu; i++) {
      const u = i / nu, id = j * nu + i;
      gu[id] = u; gv[id] = v;
      const cs = surf.cscale(v);
      // warp (in metric units), large shape plus a fine jag
      const wx = warp * noise.cyl(u, v, 4.0, 3, 1.7) + warp * 0.28 * noise.cyl(u, v, 17.0, 2, 4.4);
      const wy = warp * noise.cyl(u, v, 4.0, 3, 7.3) + warp * 0.28 * noise.cyl(u, v, 17.0, 2, 2.2);
      const uw = u + wx / Math.max(0.15, cs), vw = v + wy;
      let bi = 0;
      let bd = Math.max(0, vw - (anchorEdge(u) - 0.11));
      D[id * L] = bd;
      for (let s = 0; s < n; s++) {
        const sd = seeds[s];
        const d = Math.hypot(wrapU(uw - sd.u) * surf.cscale((vw + sd.v) / 2), vw - sd.v) * sd.w;
        D[id * L + s + 1] = d;
        if (d < bd) { bd = d; bi = s + 1; }
      }
      lab[id] = bi;
    }
  }

  // --- island cleanup: every label must be a single connected region
  const nb = (id, out) => {
    const i = id % nu, j = (id / nu) | 0;
    out.length = 0;
    out.push(j * nu + (i + 1) % nu, j * nu + (i + nu - 1) % nu);
    if (j > 0) out.push(id - nu); else out.push(((i + nu / 2) % nu)); // across the pole
    if (j < nv - 1) out.push(id + nu);
    return out;
  };
  const tmp = [];
  for (let pass = 0; pass < 6; pass++) {
    const comp = new Int32Array(NV).fill(-1);
    const comps = [];
    for (let id = 0; id < NV; id++) {
      if (comp[id] >= 0) continue;
      const c = comps.length, l = lab[id], list = [id];
      comp[id] = c;
      for (let q = 0; q < list.length; q++) {
        for (const m of nb(list[q], tmp)) if (comp[m] < 0 && lab[m] === l) { comp[m] = c; list.push(m); }
      }
      comps.push({ l, list });
    }
    const biggest = new Map();
    for (const c of comps) if (!biggest.has(c.l) || biggest.get(c.l).list.length < c.list.length) biggest.set(c.l, c);
    let changed = false;
    for (const c of comps) {
      if (biggest.get(c.l) === c) continue;
      const votes = new Map();
      for (const id of c.list) for (const m of nb(id, tmp)) if (lab[m] !== c.l) votes.set(lab[m], (votes.get(lab[m]) || 0) + 1);
      let bl = -1, bv = -1;
      for (const [k, vv] of votes) if (vv > bv) { bv = vv; bl = k; }
      if (bl >= 0) { for (const id of c.list) lab[id] = bl; changed = true; }
    }
    if (!changed) break;
  }

  // --- validate fragment sizes
  const area = new Float64Array(L);
  for (let id = 0; id < NV; id++) area[lab[id]] += surf.cscale(gv[id]);
  let mean = 0;
  for (let l = 1; l < L; l++) mean += area[l];
  mean /= n;
  for (let l = 1; l < L; l++) if (area[l] < mean * 0.5 || area[l] > mean * 2.1) return null;
  if (area[0] < mean * 0.6) return null;
  // the foot piece must hold the pole
  if (lab[0] !== 0) return null;

  // --- marching triangles
  const F = [];
  for (let l = 0; l < L; l++) F.push({ verts: [], vmap: new Map(), tris: [], walls: [], rims: [] });
  const pA = [0, 0, 0], nA = [0, 0, 0];
  function fv(f, key, u, v) {
    let k = f.vmap.get(key);
    if (k !== undefined) return k;
    k = f.verts.length;
    f.verts.push({ u, v });
    f.vmap.set(key, k);
    return k;
  }
  const crossCache = new Map();
  // crossing point on grid edge x-y (ids), in the unwrapped coords of x
  function cross(x, y, ux, vx, uy, vy) {
    const lx = lab[x], ly = lab[y];
    const fx = D[x * L + lx] - D[x * L + ly];
    const fy = D[y * L + lx] - D[y * L + ly];
    let t = fx / (fx - fy);
    if (!isFinite(t)) t = 0.5;
    t = clamp(t, 0.12, 0.88);
    return { u: lerp(ux, uy, t), v: lerp(vx, vy, t) };
  }
  const ekey = (x, y) => (x < y ? 'e' + x + '_' + y : 'e' + y + '_' + x);
  // seam graph
  const nodes = new Map(); // key -> {u,v,deg,edges:[]}
  const segs = [];
  function node(key, u, v) {
    let nd = nodes.get(key);
    if (!nd) { nd = { key, u: ((u % 1) + 1) % 1, v, edges: [] }; nodes.set(key, nd); }
    return nd;
  }
  function seam(k1, p1, k2, p2, a, b) {
    const n1 = node(k1, p1.u, p1.v), n2 = node(k2, p2.u, p2.v);
    const s = { n1, n2, a: Math.min(a, b), b: Math.max(a, b) };
    n1.edges.push(s); n2.edges.push(s);
    segs.push(s);
  }
  const corner = (id, wrap) => ({ id, u: gu[id] + (wrap ? 1 : 0), v: gv[id], key: 'g' + id + (wrap ? 'w' : '') });
  function tri(A, B, C, tid) {
    const la = lab[A.id], lb = lab[B.id], lc = lab[C.id];
    if (la === lb && lb === lc) {
      const f = F[la];
      f.tris.push([fv(f, A.key, A.u, A.v), fv(f, B.key, B.u, B.v), fv(f, C.key, C.u, C.v)]);
      return;
    }
    const wrapK = (k, P, Q) => k + ((P.u >= 1 || Q.u >= 1) ? 'w' : '');
    const edgePt = (P, Q) => {
      const ck = ekey(P.id, Q.id);
      const pt = cross(P.id, Q.id, P.u, P.v, Q.u, Q.v);
      // the same physical point is shared by both triangles; keep key canonical
      return { u: pt.u, v: pt.v, key: wrapK(ck, P, Q), ck };
    };
    if (la !== lb && lb !== lc && la !== lc) {
      const pab = edgePt(A, B), pbc = edgePt(B, C), pca = edgePt(C, A);
      const M = { u: (pab.u + pbc.u + pca.u) / 3, v: (pab.v + pbc.v + pca.v) / 3, key: 't' + tid, ck: 't' + tid };
      const quad = (l, P0, P1, P2, P3) => {
        const f = F[l];
        const i0 = fv(f, P0.key, P0.u, P0.v), i1 = fv(f, P1.key, P1.u, P1.v), i2 = fv(f, P2.key, P2.u, P2.v), i3 = fv(f, P3.key, P3.u, P3.v);
        f.tris.push([i0, i1, i2], [i0, i2, i3]);
      };
      quad(la, A, pab, M, pca);
      quad(lb, B, pbc, M, pab);
      quad(lc, C, pca, M, pbc);
      wall(la, pab, M, A); wall(lb, M, pab, B);
      wall(lb, pbc, M, B); wall(lc, M, pbc, C);
      wall(lc, pca, M, C); wall(la, M, pca, A);
      seam(pab.ck, pab, M.ck, M, la, lb);
      seam(pbc.ck, pbc, M.ck, M, lb, lc);
      seam(pca.ck, pca, M.ck, M, lc, la);
      return;
    }
    // exactly two labels: rotate so that X is the odd one out
    let X, Y, Z;
    if (la === lb) { X = C; Y = A; Z = B; } else if (lb === lc) { X = A; Y = B; Z = C; } else { X = B; Y = C; Z = A; }
    const lx = lab[X.id], ly = lab[Y.id];
    const pxy = edgePt(X, Y), pxz = edgePt(X, Z);
    // keep winding: original order is X,Y,Z cyclic
    const fX = F[lx], fY = F[ly];
    fX.tris.push([fv(fX, X.key, X.u, X.v), fv(fX, pxy.key, pxy.u, pxy.v), fv(fX, pxz.key, pxz.u, pxz.v)]);
    const a0 = fv(fY, pxy.key, pxy.u, pxy.v), a1 = fv(fY, Y.key, Y.u, Y.v), a2 = fv(fY, Z.key, Z.u, Z.v), a3 = fv(fY, pxz.key, pxz.u, pxz.v);
    fY.tris.push([a0, a1, a2], [a0, a2, a3]);
    wall(lx, pxy, pxz, X); wall(ly, pxz, pxy, Y);
    seam(pxy.ck, pxy, pxz.ck, pxz, lx, ly);
  }
  function wall(l, P, Q, R) { F[l].walls.push({ p: { u: P.u, v: P.v }, q: { u: Q.u, v: Q.v }, r: { u: R.u, v: R.v } }); }

  let tid = 0;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu; i++) {
      const w = i === nu - 1;
      const a = corner(j * nu + i, false), b = corner(j * nu + (i + 1) % nu, w);
      const c = corner((j + 1) * nu + (i + 1) % nu, w), d = corner((j + 1) * nu + i, false);
      // alternate the diagonal to avoid a directional bias in the cracks
      if ((i + j) & 1) { tri(a, b, c, tid++); tri(a, c, d, tid++); }
      else { tri(a, b, d, tid++); tri(b, c, d, tid++); }
    }
  }
  // the lip (top row)
  const rimNodes = new Set();
  {
    const j = nv - 1;
    for (let i = 0; i < nu; i++) {
      const w = i === nu - 1;
      const A = corner(j * nu + i, false), B = corner(j * nu + (i + 1) % nu, w);
      if (lab[A.id] === lab[B.id]) F[lab[A.id]].rims.push({ p: A, q: B });
      else {
        const pt = cross(A.id, B.id, A.u, A.v, B.u, B.v);
        F[lab[A.id]].rims.push({ p: A, q: pt });
        F[lab[B.id]].rims.push({ p: pt, q: B });
        rimNodes.add(ekey(A.id, B.id));
      }
    }
  }

  // --- geometry per fragment
  const frags = [];
  const P = [0, 0, 0], N = [0, 0, 0], Q = [0, 0, 0], Nq = [0, 0, 0];
  for (let l = 0; l < L; l++) {
    const f = F[l];
    const pos = [], nor = [], uvs = [], idx = [];
    const groups = [];
    const nvx = f.verts.length;
    // outer skin
    for (const vt of f.verts) {
      surf.pos(vt.u, vt.v, P); surf.normal(vt.u, vt.v, N);
      pos.push(P[0], P[1], P[2]); nor.push(N[0], N[1], N[2]); uvs.push(vt.u, vt.v);
    }
    // inner skin
    for (const vt of f.verts) {
      surf.pos(vt.u, vt.v, P); surf.normal(vt.u, vt.v, N);
      pos.push(P[0] - N[0] * T, P[1] - N[1] * T, P[2] - N[2] * T); nor.push(-N[0], -N[1], -N[2]); uvs.push(vt.u, vt.v);
    }
    let start = 0;
    for (const t of f.tris) idx.push(t[0], t[1], t[2]);
    groups.push({ start, count: idx.length - start, mat: 0 }); start = idx.length;
    for (const t of f.tris) idx.push(t[0] + nvx, t[2] + nvx, t[1] + nvx);
    groups.push({ start, count: idx.length - start, mat: 1 }); start = idx.length;
    // fracture walls (flat shaded, unglazed)
    const wallRng = makeRng(seed + l * 31);
    for (const wseg of f.walls) {
      surf.pos(wseg.p.u, wseg.p.v, P); surf.normal(wseg.p.u, wseg.p.v, N);
      surf.pos(wseg.q.u, wseg.q.v, Q); surf.normal(wseg.q.u, wseg.q.v, Nq);
      const R = surf.pos(wseg.r.u, wseg.r.v, [0, 0, 0]);
      const po = [P[0], P[1], P[2]], pi = [P[0] - N[0] * T, P[1] - N[1] * T, P[2] - N[2] * T];
      const qo = [Q[0], Q[1], Q[2]], qi = [Q[0] - Nq[0] * T, Q[1] - Nq[1] * T, Q[2] - Nq[2] * T];
      const e1 = [qo[0] - po[0], qo[1] - po[1], qo[2] - po[2]], e2 = [pi[0] - po[0], pi[1] - po[1], pi[2] - po[2]];
      let wn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const mid = [(po[0] + qo[0]) / 2 - R[0], (po[1] + qo[1]) / 2 - R[1], (po[2] + qo[2]) / 2 - R[2]];
      let flip = wn[0] * mid[0] + wn[1] * mid[1] + wn[2] * mid[2] < 0;
      if (flip) wn = [-wn[0], -wn[1], -wn[2]];
      const wl = Math.hypot(wn[0], wn[1], wn[2]) || 1;
      // a little tilt so the broken face catches light unevenly
      const jt = 0.25;
      const nn = [wn[0] / wl + (wallRng() - 0.5) * jt, wn[1] / wl + (wallRng() - 0.5) * jt, wn[2] / wl + (wallRng() - 0.5) * jt];
      const b = pos.length / 3;
      pos.push(...po, ...qo, ...qi, ...pi);
      for (let k = 0; k < 4; k++) nor.push(nn[0], nn[1], nn[2]);
      uvs.push(wseg.p.u, wseg.p.v, wseg.q.u, wseg.q.v, wseg.q.u, wseg.q.v + 0.01, wseg.p.u, wseg.p.v + 0.01);
      if (!flip) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    groups.push({ start, count: idx.length - start, mat: 2 }); start = idx.length;
    // the lip: outer edge -> crown -> inner edge, smoothly shaded
    const tv = [0, 0, 0];
    const lipRow = (u, v) => {
      surf.pos(u, v, P); surf.normal(u, v, N);
      surf.pos(u, v - 0.004, Q);
      tv[0] = P[0] - Q[0]; tv[1] = P[1] - Q[1]; tv[2] = P[2] - Q[2];
      const tl = Math.hypot(tv[0], tv[1], tv[2]) || 1; tv[0] /= tl; tv[1] /= tl; tv[2] /= tl;
      const o = [P[0], P[1], P[2]], i = [P[0] - N[0] * T, P[1] - N[1] * T, P[2] - N[2] * T];
      const c = [(o[0] + i[0]) / 2 + tv[0] * T * 0.42, (o[1] + i[1]) / 2 + tv[1] * T * 0.42, (o[2] + i[2]) / 2 + tv[2] * T * 0.42];
      const n1 = [N[0] * 0.55 + tv[0] * 0.45, N[1] * 0.55 + tv[1] * 0.45, N[2] * 0.55 + tv[2] * 0.45];
      const n3 = [-N[0] * 0.2 + tv[0] * 0.8, -N[1] * 0.2 + tv[1] * 0.8, -N[2] * 0.2 + tv[2] * 0.8];
      const n4 = [-N[0] * 0.55 + tv[0] * 0.45, -N[1] * 0.55 + tv[1] * 0.45, -N[2] * 0.55 + tv[2] * 0.45];
      return { o, c, i, n0: [N[0], N[1], N[2]], n1, n2: [tv[0], tv[1], tv[2]], n3, ni: n4 };
    };
    for (const r of f.rims) {
      const A = lipRow(r.p.u, r.p.v), B = lipRow(r.q.u, r.q.v);
      const b = pos.length / 3;
      // 5 rows: outer edge, shoulder, crown, shoulder, inner edge
      const mk = (X) => {
        const s1 = [lerp(X.o[0], X.c[0], 0.5), lerp(X.o[1], X.c[1], 0.5), lerp(X.o[2], X.c[2], 0.5)];
        const s2 = [lerp(X.i[0], X.c[0], 0.5), lerp(X.i[1], X.c[1], 0.5), lerp(X.i[2], X.c[2], 0.5)];
        return [[X.o, X.n0], [s1, X.n1], [X.c, X.n2], [s2, X.n3], [X.i, X.ni]];
      };
      const ra = mk(A), rb = mk(B);
      for (let k = 0; k < 5; k++) {
        pos.push(...ra[k][0]); nor.push(...ra[k][1]); uvs.push(r.p.u, 1);
        pos.push(...rb[k][0]); nor.push(...rb[k][1]); uvs.push(r.q.u, 1);
      }
      for (let k = 0; k < 4; k++) {
        const a0 = b + k * 2, a1 = a0 + 1, c0 = a0 + 2, c1 = a0 + 3;
        idx.push(a0, a1, c0, a1, c1, c0);
      }
    }
    groups.push({ start, count: idx.length - start, mat: 3 });
    // centroid (outer area weighted) and orientation data
    let cx = 0, cy = 0, cz = 0, at = 0, cu = 0, cuv = 0;
    for (const t of f.tris) {
      const a = t[0] * 3, b = t[1] * 3, c = t[2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      cx += ar * (pos[a] + pos[b] + pos[c]) / 3; cy += ar * (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3; cz += ar * (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      at += ar;
    }
    cx /= at; cy /= at; cz /= at;
    let rad = 0;
    for (let k = 0; k < pos.length; k += 3) rad = Math.max(rad, Math.hypot(pos[k] - cx, pos[k + 1] - cy, pos[k + 2] - cz));
    frags.push({
      id: l, anchor: l === 0,
      positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uvs),
      indices: (pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)), groups,
      centroid: [cx, cy, cz], phi: Math.atan2(cx, cz), area: at, radius: rad,
      seedUV: l === 0 ? null : seeds[l - 1],
      boundary: f.walls.map(w => [w.p, w.q]).concat(f.rims.map(r => [{ u: r.p.u, v: r.p.v }, { u: r.q.u, v: r.q.v }]))
    });
  }

  // --- seams: chain the crack graph into polylines between junctions/ends
  const used = new Set();
  const seamsOut = [];
  const isBreak = nd => nd.edges.length !== 2 || rimNodes.has(nd.key) || nd.edges[0].a !== nd.edges[1].a || nd.edges[0].b !== nd.edges[1].b;
  function walk(start, e0) {
    const pts = [start];
    let cur = start, e = e0;
    while (e && !used.has(e)) {
      used.add(e);
      const nx = e.n1 === cur ? e.n2 : e.n1;
      pts.push(nx);
      cur = nx;
      if (isBreak(cur)) break;
      e = cur.edges.find(x => !used.has(x));
    }
    return { pts, a: e0.a, b: e0.b };
  }
  for (const nd of nodes.values()) if (isBreak(nd)) for (const e of nd.edges) if (!used.has(e)) seamsOut.push(walk(nd, e));
  for (const s of segs) if (!used.has(s)) seamsOut.push(walk(s.n1, s)); // closed loops
  const junction = nd => nd.edges.length >= 3;
  const seams = [];
  for (const s of seamsOut) {
    if (s.pts.length < 2) continue;
    // unwrap u along the chain
    const uv = [];
    let pu = s.pts[0].u;
    for (const nd of s.pts) { let u = nd.u; u = pu + wrapU(u - pu); uv.push([u, nd.v]); pu = u; }
    // gentle smoothing (ends fixed)
    for (let it = 0; it < 2; it++) for (let k = 1; k < uv.length - 1; k++) {
      uv[k][0] = uv[k][0] * 0.5 + (uv[k - 1][0] + uv[k + 1][0]) * 0.25;
      uv[k][1] = uv[k][1] * 0.5 + (uv[k - 1][1] + uv[k + 1][1]) * 0.25;
    }
    // resample by 3D arc length
    const p3 = uv.map(q => surf.pos(q[0], q[1], [0, 0, 0]));
    const acc = [0];
    for (let k = 1; k < p3.length; k++) acc.push(acc[k - 1] + Math.hypot(p3[k][0] - p3[k - 1][0], p3[k][1] - p3[k - 1][1], p3[k][2] - p3[k - 1][2]));
    const len = acc[acc.length - 1];
    if (len < 0.01) continue;
    const h = 0.0045;
    const cnt = Math.max(3, Math.ceil(len / h) + 1);
    const su = new Float32Array(cnt), sv = new Float32Array(cnt);
    let k = 0;
    for (let m = 0; m < cnt; m++) {
      const t = (m / (cnt - 1)) * len;
      while (k < acc.length - 2 && acc[k + 1] < t) k++;
      const f = (t - acc[k]) / Math.max(1e-9, acc[k + 1] - acc[k]);
      su[m] = lerp(uv[k][0], uv[k + 1][0], f); sv[m] = lerp(uv[k][1], uv[k + 1][1], f);
    }
    seams.push({
      a: s.a, b: s.b, u: su, v: sv, length: len, count: cnt,
      j0: junction(s.pts[0]), j1: junction(s.pts[s.pts.length - 1]),
      rim0: rimNodes.has(s.pts[0].key), rim1: rimNodes.has(s.pts[s.pts.length - 1].key)
    });
  }
  let total = 0;
  for (const s of seams) total += s.length;
  return { nu, nv, frags, seams, totalSeam: total, seed };
}

// Low-resolution closed copy of the whole object used for touch raycasts.
function buildProxy(surf) {
  const nu = 72, nv = 30, T = surf.def.thick;
  const pos = [], idx = [];
  const P = [0, 0, 0], N = [0, 0, 0];
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j < nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / (nv - 1);
      surf.pos(u, v, P); surf.normal(u, v, N);
      const s = side ? -T : 0;
      pos.push(P[0] + N[0] * s, P[1] + N[1] * s, P[2] + N[2] * s);
    }
  }
  const row = nu + 1, off = row * nv;
  for (let side = 0; side < 2; side++) for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu; i++) {
    const a = side * off + j * row + i, b = a + 1, c = a + row + 1, d = a + row;
    if (!side) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  }
  // close the lip
  for (let i = 0; i < nu; i++) {
    const a = (nv - 1) * row + i, b = a + 1, c = off + b, d = off + a;
    idx.push(a, d, c, a, c, b);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// ---- 03_materials.js ----
// Materials, procedural textures and the studio light environment.
let THREE = null; // set once three.js has been imported

// --- procedural glaze textures, generated into typed arrays (no canvas needed)
function makeGlazeTextures(surf, seed) {
  const def = surf.def;
  const W = 1024, H = 512, CW = 1024, CH = 512;
  const noise = makeNoise(seed + 501);
  const rng = makeRng(seed + 77);
  // coarse noise grids (cheap to upsample)
  const GW = 128, GH = 64;
  const g1 = new Float32Array(GW * GH), g2 = new Float32Array(GW * GH), g3 = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const u = i / GW, v = j / (GH - 1);
    g1[j * GW + i] = noise.cyl(u, v, 5.0, 4, 0.0);
    g2[j * GW + i] = noise.cyl(u, v, 11.0, 3, 3.3);
    g3[j * GW + i] = noise.cyl(u, v, 2.2, 2, 8.8);
  }
  const samp = (g, u, v) => {
    const x = (((u % 1) + 1) % 1) * GW, y = clamp01(v) * (GH - 1);
    const i0 = Math.floor(x), j0 = Math.min(GH - 2, Math.floor(y)), fx = x - i0, fy = y - j0;
    const i1 = (i0 + 1) % GW;
    return lerp(lerp(g[j0 * GW + (i0 % GW)], g[j0 * GW + i1], fx), lerp(g[(j0 + 1) * GW + (i0 % GW)], g[(j0 + 1) * GW + i1], fx), fy);
  };
  // where the foot is unglazed: lowest part of the outside
  let footV = 0;
  for (let k = 0; k <= 200; k++) { const v = k / 200; if (surf.prof(v)[1] < 0.012 && surf.prof(v)[0] > 0.02) footV = v; }
  footV = Math.min(footV + 0.012, 0.25);

  const outer = new Uint8Array(CW * CH * 4), inner = new Uint8Array(CW * CH * 4), rough = new Uint8Array(CW * CH * 4);
  const [gr, gg, gb] = def.glaze;
  for (let j = 0; j < CH; j++) {
    const v = j / (CH - 1);
    for (let i = 0; i < CW; i++) {
      const u = i / CW, o = (j * CW + i) * 4;
      const m = samp(g1, u, v), m2 = samp(g2, u, v), m3 = samp(g3, u, v);
      // glaze: soft mottling, a warmer breath where it ran thin, cooler where it pooled
      const val = 1 + m * 0.045 + m2 * 0.02;
      const warm = m3 * 0.02;
      const pool = smooth((0.22 - v) / 0.2) * 0.03; // thicker glaze near the foot
      let r = gr * val + warm - pool * 0.6, g = gg * val + warm * 0.4 - pool * 0.35, b = gb * val - warm * 0.5 - pool * 0.1;
      // unglazed foot ring outside: warm raw clay
      const foot = smooth((footV - v) / 0.015);
      const cr = 0.80 + m2 * 0.05, cg = 0.72 + m2 * 0.045, cb = 0.60 + m2 * 0.04;
      outer[o] = 255 * clamp01(lerp(r, cr, foot)); outer[o + 1] = 255 * clamp01(lerp(g, cg, foot)); outer[o + 2] = 255 * clamp01(lerp(b, cb, foot)); outer[o + 3] = 255;
      // inside: glaze pools in the well, slightly deeper and glossier
      const well = smooth((0.3 - v) / 0.3) * 0.05;
      inner[o] = 255 * clamp01(r - well * 0.9); inner[o + 1] = 255 * clamp01(g - well * 0.7); inner[o + 2] = 255 * clamp01(b - well * 0.35); inner[o + 3] = 255;
      // roughness (G channel is what three reads)
      const ro = clamp01(0.30 + m * 0.10 + m2 * 0.05 + foot * 0.5 - well * 0.8);
      rough[o] = rough[o + 1] = rough[o + 2] = 255 * ro; rough[o + 3] = 255;
    }
  }
  // iron specks and the odd pinhole
  const specks = Math.round(50 + def.speck * 260);
  for (let s = 0; s < specks; s++) {
    const cx = rng() * CW, cy = rng() * CH, rr = 0.35 + rng() * rng() * rng() * 1.6;
    const dark = rng() < 0.85;
    const col = dark ? [0.50 + rng() * 0.15, 0.40 + rng() * 0.1, 0.30] : [0.98, 0.97, 0.94];
    const a0 = dark ? 0.35 + rng() * 0.45 : 0.5;
    for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
      if (y < 0 || y >= CH) continue;
      const d = Math.hypot(x - cx, y - cy);
      const a = a0 * clamp01(rr + 0.5 - d);
      if (a <= 0) continue;
      const xi = ((x % CW) + CW) % CW, o = (y * CW + xi) * 4;
      for (const arr of [outer, inner]) for (let c = 0; c < 3; c++) arr[o + c] = lerp(arr[o + c], col[c] * 255, a);
      rough[o + 1] = lerp(rough[o + 1], 200, a * 0.6);
    }
  }
  // bump: throwing rings, a slow wobble, and fine orange peel
  const bump = new Uint8Array(W * H * 4);
  const ringF = (surf.L * 7.5);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1);
    const ringAmp = def.rings * smooth((v - 0.08) / 0.15) * (0.55 + 0.45 * Math.sin(v * 9.3 + 1.1));
    for (let i = 0; i < W; i++) {
      const u = i / W;
      const wob = samp(g3, u, v) * 0.6;
      const ring = Math.sin(TAU * (v * ringF + wob * 0.35)) * 0.5 + Math.sin(TAU * (v * ringF * 2.3 + wob)) * 0.18;
      const peel = (hash2(i, j, seed) - 0.5) * 0.35 + (hash2(i >> 1, j >> 1, seed + 9) - 0.5) * 0.35;
      const h = 0.5 + ring * ringAmp * 0.34 + samp(g2, u, v) * 0.18 + peel * 0.10;
      const o = (j * W + i) * 4;
      bump[o] = bump[o + 1] = bump[o + 2] = 255 * clamp01(h); bump[o + 3] = 255;
    }
  }
  const mk = (data, w, h, srgb) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { outer: mk(outer, CW, CH, true), inner: mk(inner, CW, CH, true), rough: mk(rough, CW, CH, false), bump: mk(bump, W, H, false) };
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeCeramicMaterials(tex) {
  const glazeCommon = {
    color: 0xffffff, roughnessMap: tex.rough, roughness: 1.0, metalness: 0,
    bumpMap: tex.bump, bumpScale: 0.55,
    clearcoat: 1.0, clearcoatRoughness: 0.075, envMapIntensity: 0.9,
    ior: 1.5, specularIntensity: 0.55
  };
  const outer = new THREE.MeshPhysicalMaterial(Object.assign({ map: tex.outer }, glazeCommon));
  const inner = new THREE.MeshPhysicalMaterial(Object.assign({ map: tex.inner }, glazeCommon, { clearcoatRoughness: 0.06 }));
  // broken body: unglazed, fine-grained, a touch whiter and drier than the glaze
  const bisque = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.83, 0.77, THREE.SRGBColorSpace), roughness: 0.92, metalness: 0, bumpMap: tex.bump, bumpScale: 2.0, envMapIntensity: 0.55 });
  const rim = outer;
  return [outer, inner, bisque, rim];
}

// --- the studio: a dark room with large soft boxes, prefiltered for reflections
function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ vec3 d = normalize(vP); float up = d.y*0.5+0.5; vec3 c = mix(vec3(0.010,0.009,0.008), vec3(0.040,0.036,0.031), smoothstep(0.2,1.0,up)); c += vec3(0.018,0.014,0.010)*smoothstep(0.55,0.0,up); gl_FragColor = vec4(c,1.0); }'
  }));
  scene.add(room);
  const box = (w, h, x, y, z, I, warm) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(I * warm[0], I * warm[1], I * warm[2]), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0.4, 0);
    scene.add(m);
    return m;
  };
  // key: a big soft box high and to the left, in front
  box(5.0, 3.6, -5.2, 5.6, 4.2, 6.5, [1.0, 0.96, 0.9]);
  // strip on the right for a long vertical highlight
  box(1.1, 6.5, 6.6, 2.6, -0.6, 4.2, [1.0, 0.98, 0.95]);
  // top, faint
  box(5.0, 5.0, 0.0, 9.0, -1.0, 3.2, [1.0, 0.97, 0.92]);
  // tall strips behind on both sides: bright edges on the silhouette
  box(0.9, 7.0, -6.5, 2.5, -4.5, 3.4, [0.96, 0.97, 1.0]);
  box(0.9, 7.0, 6.0, 2.5, -5.0, 2.8, [1.0, 0.97, 0.94]);
  // back rim strip
  box(5.5, 0.9, 0.0, 2.0, -8.5, 2.6, [0.95, 0.95, 1.0]);
  // floor bounce, warm and very low
  box(8.0, 8.0, 0.0, -6.0, 2.0, 0.22, [1.0, 0.85, 0.65]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}

// --- gold: real metal, with a liquid-to-solid transition driven per sample
function makeGoldMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.98, 0.72, 0.31), metalness: 1.0, roughness: 0.22, envMapIntensity: 2.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uCure = shared.uCure;
    sh.uniforms.uFinalRough = shared.uFinalRough;
    sh.uniforms.uSettle = shared.uSettle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFill; attribute float aAlong; attribute float aAcross; attribute float aSeed; attribute vec3 aBin;\nvarying float vFill; varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vBin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = aFill; vAlong = aAlong; vAcross = aAcross; vSeed = aSeed; vBin = normalize(normalMatrix * aBin);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uCure; uniform float uFinalRough; uniform float uSettle;\nvarying float vFill; varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vBin;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFill < 0.0) discard; float gAge = uTime - vFill; if (gAge < 0.0) discard;\nfloat gGrow = smoothstep(0.0, 0.16, gAge); if (abs(vAcross) > 0.15 + 0.85 * gGrow) discard;\nfloat gWet = (1.0 - smoothstep(0.0, uCure, gAge)) * (1.0 - uSettle);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(uFinalRough + (vSeed - 0.5) * 0.07, 0.11, gWet);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ float rip = sin(vAlong * 260.0 - gAge * 7.0 + vSeed * 6.0) * 0.5 + sin(vAlong * 610.0 + vAcross * 3.0 - gAge * 11.0) * 0.25; normal = normalize(normal + vBin * rip * 0.14 * gWet + vBin * (vSeed - 0.5) * 0.10); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + (vSeed - 0.5) * 0.08 + gWet * 0.10;');
  };
  m.customProgramCacheKey = () => 'kintsugi-gold-v1';
  return m;
}

// A ghost outline for a fragment's place, and the travelling light on a snap.
function makeOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uPulse: { value: -1 }, uColor: { value: new THREE.Color(1.0, 0.94, 0.84) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'attribute float aS; attribute float aX; varying float vS; varying float vX; void main(){ vS = aS; vX = aX; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uOpacity; uniform float uTime; uniform float uPulse; uniform vec3 uColor; varying float vS; varying float vX;\nvoid main(){ float edge = 1.0 - smoothstep(0.35, 1.0, abs(vX)); float breathe = 0.72 + 0.28 * sin(uTime * 2.4); float a = uOpacity * breathe * edge;\n float d = abs(vS - uPulse); d = min(d, 1.0 - d); float p = uPulse < 0.0 ? 0.0 : exp(-d * d * 180.0) * 0.9 * edge;\n gl_FragColor = vec4(uColor * (a + p), 1.0); }'
  });
}

// Full-screen gallery void: near-black with a soft pool of light and grain.
function makeBackdrop() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uAspect: { value: 1 }, uCenter: { value: new THREE.Vector2(0.5, 0.45) }, uLight: { value: 1 }, uTime: { value: 0 } },
    depthWrite: false, depthTest: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: [
      'uniform float uAspect; uniform vec2 uCenter; uniform float uLight; uniform float uTime; varying vec2 vUv;',
      'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
      'void main(){',
      ' vec2 p = vUv - uCenter; p.x *= uAspect;',
      ' float r = length(p * vec2(1.0, 1.25));',
      ' vec3 deep = vec3(0.0085, 0.0080, 0.0075);',
      ' vec3 lit = vec3(0.060, 0.054, 0.047);',
      ' float pool = exp(-r * r * 3.2) * uLight;',
      ' vec3 c = mix(deep, lit, pool);',
      ' float floorBand = smoothstep(0.12, -0.25, p.y) * exp(-p.x * p.x * 1.6) * 0.35 * uLight;',
      ' c += vec3(0.020, 0.018, 0.015) * floorBand;',
      ' c *= 1.0 - 0.35 * smoothstep(0.55, 1.3, length((vUv - 0.5) * vec2(uAspect, 1.0)));',
      ' c += (h(gl_FragCoord.xy + fract(uTime) * 17.0) - 0.5) * 0.0045;',
      ' gl_FragColor = vec4(c, 1.0);',
      '}'
    ].join('\n')
  }));
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// Soft radial texture for contact and lift shadows.
function makeSoftTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1;
    const r = Math.min(1, Math.hypot(x, y));
    const a = Math.pow(1 - smooth(r), 1.6);
    const o = (j * S + i) * 4;
    d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255 * a;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// ---- 04_audio.js ----
// Sound: everything is synthesised. Porcelain is a sharp transient plus a few
// inharmonic partials; gold is a silky filtered flow with a faint shimmer;
// the room is a generated impulse response.
function makeAudio() {
  let ac = null, master = null, dry = null, wet = null, muted = false;
  let flow = null, bed = null, noiseBuf = null;
  const ok = () => ac && ac.state === 'running';

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ac.destination);
    dry = ac.createGain(); dry.gain.value = 1; dry.connect(master);
    // the gallery: a soft 2.6 s tail
    const conv = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ac.sampleRate;
        lp = lp * 0.62 + (Math.random() * 2 - 1) * 0.38;
        d[i] = lp * Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.4) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    conv.buffer = ir;
    wet = ac.createGain(); wet.gain.value = 0.32;
    conv.connect(wet); wet.connect(master);
    dry.send = conv;
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) { // soft pinkish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }
  function out(node, send = 0.35) {
    node.connect(dry);
    if (send > 0) { const g = ac.createGain(); g.gain.value = send; node.connect(g); g.connect(dry.send); }
  }
  function partial(f, t0, dur, vol, send, type = 'sine') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); out(g, send);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function burst(t0, dur, vol, f, q, type = 'bandpass', send = 0.3) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 1.5;
    const flt = ac.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(flt); flt.connect(g); out(g, send);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02);
  }
  // porcelain tap; size 0 (small, bright) .. 1 (large, lower)
  function tink(t0, size, vol) {
    const f0 = lerp(2300, 1050, size) * (0.94 + Math.random() * 0.12);
    burst(t0, 0.018, vol * 0.9, lerp(5200, 3200, size), 1.2, 'bandpass', 0.2);
    const ratios = [1, 2.32, 4.25, 6.63], decs = [0.22, 0.12, 0.07, 0.04];
    for (let i = 0; i < 4; i++) partial(f0 * ratios[i] * (1 + (Math.random() - 0.5) * 0.01), t0, decs[i] * lerp(0.8, 1.4, size), vol * [0.35, 0.22, 0.12, 0.06][i], 0.25);
  }
  function bell(t0, f, vol, dur = 2.2, send = 0.55) {
    const r = [1, 2.0, 2.76, 4.07, 5.4], a = [0.5, 0.18, 0.22, 0.07, 0.05];
    for (let i = 0; i < r.length; i++) partial(f * r[i], t0, dur / (1 + i * 0.6), vol * a[i], send);
  }
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const D4 = 293.66;

  const api = {
    unlock() { init(); },
    get ready() { return ok(); },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); },
    get muted() { return muted; },
    select(size) { if (!ok()) return; tink(ac.currentTime, clamp(size + 0.3, 0, 1), 0.10); },
    drop() { if (!ok()) return; const t = ac.currentTime; burst(t, 0.03, 0.08, 1400, 0.8, 'bandpass', 0.15); partial(420, t, 0.06, 0.05, 0.1); },
    reject() { if (!ok()) return; const t = ac.currentTime; partial(330, t, 0.09, 0.07, 0.1, 'triangle'); burst(t, 0.025, 0.06, 900, 1.0, 'bandpass', 0.1); },
    snap(size) {
      if (!ok()) return;
      const t = ac.currentTime;
      tink(t, clamp(size + 0.2, 0, 1), 0.07);
      tink(t + 0.055, clamp(size, 0, 1), 0.26);
      partial(lerp(360, 240, size), t + 0.055, 0.09, 0.12, 0.15);
    },
    land(size, delay = 0) { if (!ok()) return; tink(ac.currentTime + delay, size, 0.13 + Math.random() * 0.06); },
    crack() {
      if (!ok()) return;
      const t = ac.currentTime;
      burst(t, 0.05, 0.5, 2600, 0.6, 'highpass', 0.4);
      burst(t + 0.004, 0.12, 0.22, 900, 0.9, 'bandpass', 0.4);
      partial(110, t, 0.12, 0.25, 0.2);
      for (let i = 0; i < 7; i++) tink(t + 0.01 + Math.random() * 0.09, Math.random() * 0.6, 0.12 * (1 - i / 9));
    },
    hairline() { if (!ok()) return; const t = ac.currentTime; burst(t, 0.035, 0.06, 4800, 2, 'bandpass', 0.3); partial(3100, t, 0.08, 0.03, 0.3); },
    // gold: continuous while painting
    flowStart() {
      if (!ok() || flow) return;
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
      const g = ac.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); out(g, 0.25);
      const sh = ac.createOscillator(), sh2 = ac.createOscillator(), sg = ac.createGain();
      sh.frequency.value = D4 * 8; sh2.frequency.value = D4 * 12.02; sg.gain.value = 0;
      sh.connect(sg); sh2.connect(sg); out(sg, 0.6);
      s.start(); sh.start(); sh2.start();
      flow = { s, f, g, sh, sh2, sg };
    },
    flow(speed, on) {
      if (!flow) return;
      const t = ac.currentTime, k = clamp(speed, 0, 1);
      flow.g.gain.setTargetAtTime((on ? 0.055 : 0.035) * (0.25 + k), t, 0.05);
      flow.f.frequency.setTargetAtTime(on ? 700 + k * 900 : 420 + k * 300, t, 0.08);
      flow.sg.gain.setTargetAtTime(on ? 0.006 + k * 0.008 : 0.0, t, 0.08);
    },
    flowStop() {
      if (!flow) return;
      const t = ac.currentTime, fl = flow; flow = null;
      fl.g.gain.setTargetAtTime(0, t, 0.06); fl.sg.gain.setTargetAtTime(0, t, 0.06);
      fl.s.stop(t + 0.4); fl.sh.stop(t + 0.4); fl.sh2.stop(t + 0.4);
    },
    drip() { if (!ok()) return; const t = ac.currentTime; partial(700 + Math.random() * 300, t, 0.07, 0.035, 0.2); },
    settle(i) { if (!ok()) return; const n = PENTA[i % PENTA.length]; bell(ac.currentTime, D4 * Math.pow(2, n / 12), 0.07, 2.0); },
    final(quality) {
      if (!ok()) return;
      const t = ac.currentTime;
      bell(t, D4 / 2, 0.10, 4.5, 0.7);
      bell(t + 0.08, D4 * 0.75, 0.06, 4.0, 0.7);
      bell(t + 0.16, D4 * 1.125, 0.045, 3.6, 0.7);
      if (quality > 0.85) bell(t + 0.5, D4 * 2.25, 0.035, 3.6, 0.8);
    },
    reveal() { if (!ok()) return; const t = ac.currentTime; bell(t, D4 * 1.5, 0.035, 2.4); bell(t + 0.18, D4 * 2, 0.03, 2.6); },
    ui() { if (!ok()) return; tink(ac.currentTime, 0.9, 0.05); },
    // ambient bed for the gallery; intensity 0..1 opens the filter
    bedStart() {
      if (!ok() || bed) return;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
      const g = ac.createGain(); g.gain.value = 0;
      lp.connect(g); out(g, 0.7);
      const oscs = [];
      const notes = [73.42, 110.0, 146.83, 164.81, 220.0];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f * (1 + (i - 2) * 0.0009);
        const og = ac.createGain(); og.gain.value = [0.5, 0.35, 0.16, 0.08, 0.06][i];
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.05 + i * 0.023; lg.gain.value = og.gain.value * 0.6;
        lfo.connect(lg); lg.connect(og.gain);
        o.connect(og); og.connect(lp); o.start(); lfo.start();
        oscs.push(o, lfo);
      });
      g.gain.setTargetAtTime(0.05, ac.currentTime, 2.5);
      bed = { lp, g, oscs };
    },
    bed(intensity) { if (!bed) return; bed.lp.frequency.setTargetAtTime(420 + intensity * 900, ac.currentTime, 1.5); bed.g.gain.setTargetAtTime(0.04 + intensity * 0.025, ac.currentTime, 1.5); },
    close() { try { if (ac) ac.close(); } catch (e) {} ac = null; flow = null; bed = null; }
  };
  return api;
}

// ---- 05_ui.js ----
// The interface: as little as possible, set in Cormorant and Inter, laid out
// inside the content safe area. Everything else is the object.
function makeUI(ctx, handlers) {
  const root = ctx.createRoot({ className: 'kg-root', layer: 'overlay', order: 5, input: 'passthrough' });
  const css = `
  .kg-root{font-family:'KG Inter',Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Roboto,Arial,sans-serif;color:#ebe4d6;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
  .kg-safe{position:absolute;inset:0;padding:var(--plethora-content-safe-top,0px) var(--plethora-content-safe-right,0px) var(--plethora-content-safe-bottom,120px) var(--plethora-content-safe-left,0px);pointer-events:none}
  .kg-in{position:relative;width:100%;height:100%}
  .kg-top{position:absolute;left:20px;right:12px;top:14px;display:flex;align-items:flex-start;justify-content:space-between}
  .kg-lv{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:rgba(235,228,214,.46);line-height:44px;transition:opacity .8s}
  .kg-lv b{font-weight:400;color:rgba(235,228,214,.78)}
  .kg-right{display:flex;align-items:center;gap:6px}
  .kg-drop{width:44px;height:44px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .9s}
  .kg-drop.on{opacity:1}
  .kg-drop.low svg{animation:kgpulse 1.6s ease-in-out infinite}
  @keyframes kgpulse{0%,100%{opacity:1}50%{opacity:.45}}
  .kg-btn{pointer-events:none;appearance:none;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;margin:0;outline:none}
  .kg-top .kg-btn,.kg-veil.on .kg-btn,.kg-res.on .kg-btn{pointer-events:auto}
  .kg-btn:focus-visible{outline:1px solid rgba(235,228,214,.5);outline-offset:3px}
  .kg-icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;opacity:.62;transition:opacity .3s}
  .kg-icon:active{opacity:1}
  .kg-title{position:absolute;left:0;right:0;bottom:22px;text-align:center;opacity:0;transition:opacity 1.1s ease;pointer-events:none}
  .kg-title.on{opacity:1}
  .kg-title .n{font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:rgba(235,228,214,.42);margin-bottom:8px}
  .kg-title .t{font-family:'KG Cormorant','Cormorant Garamond','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-style:italic;font-weight:300;font-size:30px;letter-spacing:.01em;color:rgba(240,233,220,.9)}
  .kg-res{position:absolute;left:0;right:0;bottom:10px;display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(8px);transition:opacity 1.2s ease,transform 1.4s cubic-bezier(.2,.7,.2,1);pointer-events:none}
  .kg-res.on{opacity:1;transform:none}
  .kg-res.on .kg-row{pointer-events:auto}
  .kg-grade{font-family:'KG Cormorant','Cormorant Garamond','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-style:italic;font-weight:300;font-size:40px;line-height:1;color:#f2ead9}
  .kg-score{margin-top:12px;font-size:11px;letter-spacing:.28em;color:rgba(235,228,214,.62);font-variant-numeric:tabular-nums}
  .kg-meta{margin-top:7px;font-size:10px;letter-spacing:.16em;color:rgba(235,228,214,.38);min-height:14px;font-variant-numeric:tabular-nums;text-transform:uppercase}
  .kg-row{display:flex;gap:12px;margin-top:22px}
  .kg-act{min-width:112px;height:44px;padding:0 18px;border:1px solid rgba(235,228,214,.22);border-radius:2px;font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:rgba(240,233,220,.9);transition:border-color .3s,background .3s}
  .kg-act:active{background:rgba(235,228,214,.06)}
  .kg-act.pri{border-color:rgba(214,170,92,.55)}
  .kg-veil{position:absolute;inset:0;background:rgba(6,6,6,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .4s;pointer-events:none}
  .kg-veil.on{opacity:1;pointer-events:auto}
  .kg-menu{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
  .kg-mi{height:48px;min-width:200px;font-family:'KG Cormorant','Cormorant Garamond','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-style:italic;font-weight:300;font-size:24px;color:rgba(240,233,220,.88)}
  .kg-mi.small{font-family:'KG Inter',sans-serif;font-style:normal;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(235,228,214,.5);height:44px}
  .kg-col{display:flex;flex-direction:column;gap:2px;width:min(320px,82%)}
  .kg-ci{display:flex;align-items:baseline;justify-content:space-between;height:46px;border-bottom:1px solid rgba(235,228,214,.08);padding:0 4px;text-align:left}
  .kg-ci .a{font-size:10px;letter-spacing:.2em;color:rgba(235,228,214,.4);width:30px;font-variant-numeric:tabular-nums}
  .kg-ci .b{flex:1;font-family:'KG Cormorant','Cormorant Garamond','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-style:italic;font-size:21px;font-weight:300;color:rgba(240,233,220,.9)}
  .kg-ci .c{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(214,170,92,.85)}
  .kg-ci[disabled]{opacity:.28;pointer-events:none}
  .kg-note{position:absolute;left:0;right:0;top:50%;text-align:center;font-size:11px;letter-spacing:.2em;color:rgba(235,228,214,.5);text-transform:uppercase}
  `;
  root.innerHTML = `<style>${css}</style>
  <div class="kg-safe"><div class="kg-in">
    <div class="kg-top">
      <div class="kg-lv"><b class="kg-lvn">01</b>&nbsp;&nbsp;/&nbsp;&nbsp;08</div>
      <div class="kg-right">
        <div class="kg-drop" aria-hidden="true"><svg width="14" height="20" viewBox="0 0 14 20">
          <defs><linearGradient id="kgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d58e"/><stop offset=".5" stop-color="#c8963f"/><stop offset="1" stop-color="#7d5520"/></linearGradient>
          <clipPath id="kgc"><rect class="kg-lvl" x="0" y="0" width="14" height="20"/></clipPath></defs>
          <path d="M7 1.2 C7 1.2 1.6 8.4 1.6 12.6 A5.4 5.4 0 0 0 12.4 12.6 C12.4 8.4 7 1.2 7 1.2 Z" fill="none" stroke="rgba(214,170,92,.55)" stroke-width=".8"/>
          <path clip-path="url(#kgc)" d="M7 1.2 C7 1.2 1.6 8.4 1.6 12.6 A5.4 5.4 0 0 0 12.4 12.6 C12.4 8.4 7 1.2 7 1.2 Z" fill="url(#kgg)"/>
        </svg></div>
        <button class="kg-btn kg-icon kg-pause" aria-label="Pause"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="1.2" height="10" fill="#ebe4d6"/><rect x="9.8" y="2" width="1.2" height="10" fill="#ebe4d6"/></svg></button>
      </div>
    </div>
    <div class="kg-title"><div class="n"></div><div class="t"></div></div>
    <div class="kg-res">
      <div class="kg-grade"></div>
      <div class="kg-score"></div>
      <div class="kg-meta"></div>
      <div class="kg-row"><button class="kg-btn kg-act kg-again">Again</button><button class="kg-btn kg-act pri kg-next">Next</button></div>
    </div>
  </div></div>
  <div class="kg-veil kg-pausev"><div class="kg-menu">
    <button class="kg-btn kg-mi kg-resume">Resume</button>
    <button class="kg-btn kg-mi kg-restart">Begin again</button>
    <button class="kg-btn kg-mi kg-colbtn">Collection</button>
    <button class="kg-btn kg-mi small kg-sound">Sound on</button>
  </div></div>
  <div class="kg-veil kg-colv"><div class="kg-menu"><div class="kg-col"></div><button class="kg-btn kg-mi small kg-colback">Close</button></div></div>
  <div class="kg-note" style="display:none"></div>`;
  const q = s => root.querySelector(s);
  const el = {
    lv: q('.kg-lv'), lvn: q('.kg-lvn'), drop: q('.kg-drop'), lvl: q('.kg-lvl'), pause: q('.kg-pause'),
    title: q('.kg-title'), tn: q('.kg-title .n'), tt: q('.kg-title .t'),
    res: q('.kg-res'), grade: q('.kg-grade'), score: q('.kg-score'), meta: q('.kg-meta'), again: q('.kg-again'), next: q('.kg-next'),
    pv: q('.kg-pausev'), resume: q('.kg-resume'), restart: q('.kg-restart'), colbtn: q('.kg-colbtn'), sound: q('.kg-sound'),
    cv: q('.kg-colv'), col: q('.kg-col'), colback: q('.kg-colback'), note: q('.kg-note')
  };
  const act = (node, fn) => ctx.input.activate(node, e => { if (e && e.preventDefault) e.preventDefault(); fn(); });
  act(el.pause, () => handlers.pause());
  act(el.resume, () => handlers.resume());
  act(el.restart, () => handlers.restart());
  act(el.colbtn, () => handlers.collection());
  act(el.sound, () => handlers.sound());
  act(el.again, () => handlers.again());
  act(el.next, () => handlers.next());
  act(el.colback, () => handlers.closeCollection());
  ctx.input.delegate(el.col, '.kg-ci', 'click', (e) => { const t = e.delegateTarget || (e.event && e.event.target && e.event.target.closest('.kg-ci')); if (t && !t.disabled) handlers.pick(+t.dataset.i); });
  const roman = n => String(n).padStart(2, '0');
  let goldShown = false, lastGold = -1;
  return {
    root,
    level(i, total) { el.lvn.textContent = roman(i + 1); el.lv.lastChild.textContent = '  /  ' + roman(total); },
    title(no, name, on) { if (no != null) { el.tn.textContent = 'No. ' + no; el.tt.textContent = name; } el.title.classList.toggle('on', !!on); },
    gold(frac, on) {
      if (on !== goldShown) { goldShown = on; el.drop.classList.toggle('on', on); }
      const f = Math.round(clamp01(frac) * 200) / 200;
      if (f !== lastGold) {
        lastGold = f;
        // the drop body spans y 1.2..18; fill from the bottom
        const top = 18 - 16.8 * f;
        el.lvl.setAttribute('y', top.toFixed(2)); el.lvl.setAttribute('height', (20 - top).toFixed(2));
        el.drop.classList.toggle('low', on && f < 0.18);
      }
    },
    chrome(on) { el.lv.style.opacity = on ? '1' : '0'; },
    results(r) {
      el.grade.textContent = r.grade;
      el.score.textContent = String(r.score);
      el.meta.textContent = r.meta || '';
      el.next.textContent = r.nextLabel || 'Next';
      el.res.classList.add('on');
    },
    meta(text) { el.meta.textContent = text || ''; },
    hideResults() { el.res.classList.remove('on'); },
    pauseMenu(on, soundOn) { el.sound.textContent = soundOn ? 'Sound on' : 'Sound off'; el.pv.classList.toggle('on', on); },
    sound(soundOn) { el.sound.textContent = soundOn ? 'Sound on' : 'Sound off'; },
    collection(on, rows) {
      if (rows) el.col.innerHTML = rows.map((r, i) => `<button class="kg-btn kg-ci" data-i="${i}" ${r.locked ? 'disabled' : ''}><span class="a">${roman(i + 1)}</span><span class="b">${r.name}</span><span class="c">${r.grade || ''}</span></button>`).join('');
      el.cv.classList.toggle('on', on);
    },
    note(text) { el.note.style.display = text ? 'block' : 'none'; el.note.textContent = text || ''; }
  };
}

// ---- 06_game.js ----
// KINTSUGI: the game. States: intro -> breaking -> assembly -> gold -> reveal -> results.
window.plethoraBit = {
  meta: { title: 'KINTSUGI', runtime: 'plethora-bit@2', tags: ['puzzle', '3d', 'craft', 'relaxing'], permissions: ['audio', 'haptics', 'storage'] },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });
    const DEV = typeof window !== 'undefined' && window.__KG_DEV;

    // ---------- surfaces
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.background = '#080807';
    const ring = ctx.createCanvas2D({ layer: 'overlay', order: 1, input: 'passthrough', coordinateSpace: 'css', maxDpr: 2 });
    const g2 = ring.getContext('2d');
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
    const audio = makeAudio();
    ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) {} };

    // ---------- persistence (device convenience + account progress)
    const store = {
      get(k) { try { return ctx.capabilities && ctx.capabilities.storage === false ? null : ctx.storage.get(k); } catch (e) { return null; } },
      set(k, v) { try { ctx.storage.set(k, v); } catch (e) {} }
    };
    const seen = Object.assign({ intro: false, gold: false, rotate: false, turn: false }, store.get('kg.seen') || {});
    const markSeen = k => { if (!seen[k]) { seen[k] = true; store.set('kg.seen', seen); } };
    let save = { v: 1, unlocked: 1, best: {}, grade: {} };
    const cached = store.get('kg.save');
    if (cached && cached.v === 1 && typeof cached.unlocked === 'number') save = cached;
    let progressReady = false;
    const progressLoad = (async () => {
      try {
        if (!ctx.game || !ctx.game.progress) return;
        const p = await ctx.game.progress.load('atelier');
        if (disposed) return;
        const st = p && p.state;
        const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress'));
        if ((eligible || (p && p.status === 'completed')) && st && st.v === 1 && typeof st.unlocked === 'number') {
          save.unlocked = Math.max(save.unlocked, clamp(st.unlocked | 0, 1, LEVELS.length));
          for (const k in (st.best || {})) if (typeof st.best[k] === 'number') save.best[k] = Math.max(save.best[k] || 0, st.best[k]);
          for (const k in (st.grade || {})) if (typeof st.grade[k] === 'string' && (!save.grade[k] || (st.best[k] || 0) >= (save.best[k] || 0))) save.grade[k] = st.grade[k];
        }
        progressReady = true;
      } catch (e) { progressReady = false; }
    })();
    let saving = Promise.resolve();
    function persist() {
      store.set('kg.save', save);
      const snap = JSON.parse(JSON.stringify(save));
      const allDone = LEVELS.every(l => snap.best[l.obj] > 0);
      saving = saving.then(async () => {
        try {
          if (!ctx.game || !ctx.game.progress) return;
          const payload = { state: snap, label: allDone ? 'Collection repaired' : 'No. ' + Math.min(snap.unlocked, LEVELS.length), percent: Object.keys(snap.best).length / LEVELS.length, stateSchemaVersion: 1 };
          await ctx.game.progress.save('atelier', payload);
          if (allDone) await ctx.game.progress.complete('atelier', {});
        } catch (e) { /* the device copy remains; a later level retries */ }
      });
    }

    // ---------- UI
    let paused = false, loop = null, gameReady = false;
    const ui = makeUI(ctx, {
      pause() { if (!gameReady || state === 'loading') return; paused = true; resetGesture(); audio.ui(); ui.pauseMenu(true, !audio.muted); if (loop) loop.pause(); },
      resume() { if (!gameReady) return; paused = false; ui.pauseMenu(false); if (loop) loop.resume(); },
      restart() { paused = false; ui.pauseMenu(false); if (loop) loop.resume(); attemptStart(); goLevel(levelIndex); },
      collection() { ui.collection(true, collectionRows()); },
      closeCollection() { ui.collection(false); },
      pick(i) { ui.collection(false); paused = false; ui.pauseMenu(false); if (loop) loop.resume(); attemptStart(); goLevel(i); },
      sound() { audio.setMuted(!audio.muted); store.set('kg.muted', audio.muted); ui.sound(!audio.muted); },
      again() { if (!gameReady || state !== 'results') return; audio.ui(); attemptStart(); goLevel(levelIndex); },
      next() {
        if (!gameReady || state !== 'results') return;
        audio.ui();
        if (levelIndex >= LEVELS.length - 1) { ui.collection(true, collectionRows()); return; }
        attemptStart(); goLevel(levelIndex + 1);
      }
    });
    if (store.get('kg.muted') === true) audio.setMuted(true);
    function collectionRows() {
      return LEVELS.map((l, i) => ({ name: OBJECTS[l.obj].name, grade: save.grade[l.obj] || '', locked: i + 1 > save.unlocked }));
    }

    // fonts load in the background; the UI has serif/sans fallbacks
    const fontP = Promise.all([
      () => ctx.loadFont('KG Cormorant', 'cormorant-garamond', '1.0.0', { style: 'italic', weight: '300' }),
      () => ctx.loadFont('KG Inter', 'inter', '1.0.0', { style: 'normal', weight: '400' })
    ].map(f => { try { return Promise.resolve(f()).catch(() => null); } catch (e) { return null; } }));

    // ---------- three.js
    let THREEmod;
    try { THREEmod = await ctx.importModule('three', '0.164.1'); }
    catch (e) { ctx.platform.error({ stage: 'dependency', message: String((e && e.message) || e) }); ui.note('Could not load the studio. Please try again.'); ctx.markVisualReady('error'); ctx.platform.ready(); return; }
    if (disposed) return;
    THREE = THREEmod;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) { ctx.platform.error({ stage: 'renderer', message: String((e && e.message) || e) }); ui.note('3D is unavailable on this device.'); ctx.markVisualReady('error'); ctx.platform.ready(); return; }
    ctx.onDestroy(() => { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} });
    const PR_CAP = Math.min(1.75, ctx.dpr || 1);
    let pixelRatio = DEV && window.__KG_PR ? window.__KG_PR : PR_CAP;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setClearColor(0x080807, 1);

    const scene = new THREE.Scene();
    scene.environment = buildEnvironment(renderer);
    const camera = new THREE.PerspectiveCamera(26, ctx.width / ctx.height, 0.05, 60);
    const backdrop = makeBackdrop();
    scene.add(backdrop);
    const key = new THREE.DirectionalLight(0xfff1e2, 1.7);
    key.position.set(-2.6, 4.6, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera; sc.left = -1.4; sc.right = 1.4; sc.top = 1.6; sc.bottom = -1.2; sc.near = 1; sc.far = 12;
    const rim = new THREE.DirectionalLight(0xe2e8ff, 1.1);
    rim.position.set(2.2, 2.4, -3.6);
    const fill = new THREE.HemisphereLight(0xfff5e8, 0x0a0806, 0.12);
    for (const l of [key, rim, fill]) { l.layers.enableAll(); scene.add(l); }
    scene.add(key.target);
    const soft = makeSoftTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.42, color: 0x000000, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0.7, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002; contact.renderOrder = 1;
    scene.add(contact);
    const turn = new THREE.Group();
    scene.add(turn);
    const shared = { uTime: { value: 0 }, uCure: { value: 1.1 }, uFinalRough: { value: 0.24 }, uSettle: { value: 0 } };
    const goldMat = makeGoldMaterial(shared);
    goldMat.side = THREE.DoubleSide;
    goldMat.polygonOffset = true; goldMat.polygonOffsetFactor = -3; goldMat.polygonOffsetUnits = -3;
    const spillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.98, 0.72, 0.31), metalness: 1, roughness: 0.16, envMapIntensity: 2.4 });
    const hairMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.13, 0.11, 0.09, THREE.SRGBColorSpace), transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const shadowMatProto = new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false });
    const raycaster = new THREE.Raycaster();
    const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);

    // ---------- spill drops (instanced, they fade away)
    const SPILLS = 56;
    const spillGeo = new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2);
    const spillMesh = new THREE.InstancedMesh(spillGeo, spillMat, SPILLS);
    spillMesh.count = 0; spillMesh.frustumCulled = false;
    turn.add(spillMesh);
    const spills = [];

    // ---------- state
    let state = 'loading', stateT = 0, levelIndex = 0;
    let lv = null, def = null, surf = null, fr = null;
    let shards = [], seams = [], proxy = null, levelObjs = [], tex = null, mats = null;
    let Rb = 1, centerY = 0.5;
    let yaw = 0, yawVel = 0, yawTarget = null;
    let selected = null, held = null;
    let gold = 0, goldMax = 1, goldUsed = 0;
    let stats = null;
    let started = false, attempt = 0, hintT = 0, lastInteract = 0;
    let revealT = 0, finalQuality = 0, resultInfo = null;
    let waitingTouch = false, loadedAt = 0, loadSerial = 0;
    const score = ctx.game.score({ initial: 0, min: 0 });
    let seamIndex = null;

    function attemptStart() { attempt++; started = true; try { ctx.platform.start({ level: levelIndex + 1 }); } catch (e) {} score.reset(); }

    // ---------- camera framing
    const cam = { D: 4, ox: 0, oy: 0, elev: 0.3, tD: 4, tox: 0, toy: 0, telev: 0.3, ty: 0.5, tty: 0.5 };
    function boxFor(phase) {
      const A = area(), W = ctx.width, H = ctx.height;
      const top = A.top + 70, bottom = H - A.bottom - 12;
      const portrait = H >= W * 1.05;
      if (phase === 'assembly') {
        if (portrait) { const h = (bottom - top) * 0.5; return { cx: W / 2, cy: top + h / 2, w: W - 64, h, s: Math.min(h, W - 48) }; }
        const w = W * 0.46; return { cx: W / 2, cy: (top + bottom) / 2, w, h: bottom - top, s: Math.min(w, bottom - top) * 0.92 };
      }
      if (phase === 'results') {
        const h = (bottom - top) * (portrait ? 0.68 : 0.76); return { cx: W / 2, cy: top + h / 2, w: W - 48, h, s: Math.min(h, W - 40) };
      }
      // intro, gold
      const h = (bottom - top); return { cx: W / 2, cy: top + h * 0.47, w: W - 40, h: h * 0.9, s: Math.min(h * 0.86, W - 28) };
    }
    function frame(phase, instant) {
      const b = boxFor(phase);
      const f = (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const e = def.elev;
      const maxR = surf.radius / 1.15;
      const halfH = 0.5 * surf.height * Math.cos(e) + maxR * 1.05 * Math.sin(e);
      const halfW = maxR * 1.1;
      // solve for distance, then add the perspective swell of the near side
      let D = Math.max(halfH * f / (b.h / 2), halfW * f / (b.w / 2));
      D += maxR * Math.cos(e) * 0.9;
      cam.tD = D;
      cam.tox = -(b.cx - ctx.width / 2); cam.toy = -(b.cy - ctx.height / 2);
      cam.telev = def.elev + (phase === 'results' ? -0.04 : 0);
      if (instant) { cam.D = cam.tD; cam.ox = cam.tox; cam.oy = cam.toy; cam.elev = cam.telev; }
    }
    function updateCamera(dt) {
      const k = 1 - Math.exp(-dt * 2.6);
      cam.D += (cam.tD - cam.D) * k; cam.ox += (cam.tox - cam.ox) * k; cam.oy += (cam.toy - cam.oy) * k; cam.elev += (cam.telev - cam.elev) * k;
      camera.aspect = ctx.width / ctx.height;
      camera.position.set(0, centerY + Math.sin(cam.elev) * cam.D, Math.cos(cam.elev) * cam.D);
      camera.lookAt(0, centerY, 0);
      camera.setViewOffset(ctx.width, ctx.height, cam.ox, cam.oy, ctx.width, ctx.height);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }
    const camFwd = () => tmpV2.set(0, centerY, 0).sub(camera.position).normalize();
    function toScreen(v, out) {
      tmpV.copy(v).project(camera);
      out[0] = (tmpV.x * 0.5 + 0.5) * ctx.width; out[1] = (-tmpV.y * 0.5 + 0.5) * ctx.height; out[2] = tmpV.z;
      return out;
    }
    function fromScreen(x, y, dist, out) {
      tmpV.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      // dist is measured along the view axis
      const fwd = camFwd();
      const t = dist / Math.max(0.2, tmpV.dot(fwd));
      return out.copy(camera.position).addScaledVector(tmpV, t);
    }
    const pxPerUnit = dist => (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / dist;
    const objPx = () => Rb * 2 * pxPerUnit(cam.D);

    // ---------- build a level
    function disposeLevel() {
      for (const o of levelObjs) { if (o.parent) o.parent.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material.isShaderMaterial) o.material.dispose(); }
      levelObjs = [];
      if (tex) { for (const k in tex) tex[k].dispose(); tex = null; }
      if (mats) { for (const m of new Set(mats)) m.dispose(); mats = null; }
      shards = []; seams = []; proxy = null; selected = null; held = null;
      spills.length = 0; spillMesh.count = 0;
    }
    function loadLevel(i) {
      const tL0 = performance.now();
      loadSerial++;
      resetGesture();
      disposeLevel();
      levelIndex = i; lv = LEVELS[i]; def = OBJECTS[lv.obj];
      surf = makeSurface(def);
      fr = buildFracture(surf, lv);
      tex = makeGlazeTextures(surf, lv.seed);
      mats = makeCeramicMaterials(tex);
      Rb = Math.max(surf.height * 0.56, surf.radius * 0.98);
      centerY = surf.height * 0.46;
      // shards
      for (const f of fr.frags) {
        const geo = new THREE.BufferGeometry();
        const p = f.positions.slice();
        for (let k = 0; k < p.length; k += 3) { p[k] -= f.centroid[0]; p[k + 1] -= f.centroid[1]; p[k + 2] -= f.centroid[2]; }
        geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(f.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(f.indices, 1));
        for (const gr of f.groups) geo.addGroup(gr.start, gr.count, gr.mat);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = true; mesh.receiveShadow = false;
        mesh.position.set(f.centroid[0], f.centroid[1], f.centroid[2]);
        turn.add(mesh);
        levelObjs.push(mesh);
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMatProto.clone());
        sh.layers.set(1); sh.renderOrder = 0; sh.visible = false;
        scene.add(sh); levelObjs.push(sh);
        const outline = makeOutline(f);
        const mass = Math.sqrt(f.area);
        // mean outward normal of the glazed face, for presenting the shard
        const nrm = new THREE.Vector3();
        { const P = [0, 0, 0], N = [0, 0, 0]; const bd = f.boundary; for (let k = 0; k < bd.length; k += Math.max(1, bd.length >> 5)) { surf.normal(bd[k][0].u, bd[k][0].v, N); nrm.x += N[0]; nrm.y += N[1]; nrm.z += N[2]; } if (f.seedUV) { surf.normal(f.seedUV.u, f.seedUV.v, N); nrm.x += N[0] * 4; nrm.y += N[1] * 4; nrm.z += N[2] * 4; } nrm.normalize(); }
        shards.push({
          f, mesh, sh, outline, mass, nrm, present: 0, anchor: f.anchor, state: 'placed', phi: f.phi,
          roll: 0, sx: 0, sy: 0, tx: 0, ty: 0, dist: 0, scale: 1, tscale: 1, lift: 0,
          vel: new THREE.Vector3(), w: new THREE.Vector3(), tq: new THREE.Quaternion(), quality: 1, misses: 0, hint: 0, flyT: 0, landed: false
        });
      }
      // seams
      seams = fr.seams.map(makeSeam);
      seamIndex = buildSeamIndex();
      // proxy for touches
      const pr = buildProxy(surf);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pr.positions, 3));
      pg.setIndex(new THREE.BufferAttribute(pr.indices, 1));
      pg.computeBoundingSphere();
      proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      proxy.layers.set(2);
      proxy.userData.outerTris = pr.indices.length / 6 | 0;
      turn.add(proxy); levelObjs.push(proxy);
      // stage
      const cr = surf.radius * 2.2;
      contact.scale.set(cr, cr, 1);
      key.target.position.set(0, centerY * 0.5, 0);
      floor.material.opacity = 0.42;
      yaw = 0; yawVel = 0; yawTarget = null; turn.rotation.y = 0;
      goldMax = fr.totalSeam * lv.gold; gold = goldMax; goldUsed = 0;
      shared.uSettle.value = 0; shared.uFinalRough.value = 0.24;
      scene.environmentRotation.set(0, 0, 0);
      stats = { strokes: 0, stops: 0, travel: 0, offTravel: 0, devSum: 0, devN: 0, rejects: 0, placeQ: [], samples: seams.reduce((a, s) => a + s.n, 0), seamsDone: 0 };
      paint.active = false;
      ui.level(i, LEVELS.length);
      ui.gold(1, false);
      ui.hideResults();
      ui.title(i + 1, def.name, true);
      ui.chrome(true);
      frame('intro', true);
      state = 'intro'; stateT = 0; loadedAt = performance.now();
      waitingTouch = !started;
      lastInteract = 0; hintT = 0; revealT = 0; resultInfo = null;
      audio.bed(0.1);
      updateCamera(1);
      try { renderer.compile(scene, camera); } catch (e) {}
      if (DEV) window.__kgLoadMs = (window.__kgLoadMs || []).concat([[i, Math.round(performance.now() - tL0)]]);
    }

    function makeOutline(f) {
      const T = def.thick, pos = [], aS = [], aX = [], idx = [];
      // centre of the fragment in uv for the travelling light
      let u0 = f.boundary.length ? f.boundary[0][0].u : 0, su = 0, sv = 0, n = 0;
      for (const [p] of f.boundary) { su += u0 + wrapU(p.u - u0); sv += p.v; n++; }
      const uc = su / Math.max(1, n), vc = sv / Math.max(1, n), cs = surf.cscale(vc);
      const P = [0, 0, 0], N = [0, 0, 0], Q = [0, 0, 0], N2 = [0, 0, 0];
      const hw = 0.0042;
      for (const [p, q] of f.boundary) {
        surf.pos(p.u, p.v, P); surf.normal(p.u, p.v, N); surf.pos(q.u, q.v, Q); surf.normal(q.u, q.v, N2);
        const dx = Q[0] - P[0], dy = Q[1] - P[1], dz = Q[2] - P[2];
        const sP = Math.atan2(p.v - vc, wrapU(p.u - uc) * cs) / TAU + 0.5, sQ = Math.atan2(q.v - vc, wrapU(q.u - uc) * cs) / TAU + 0.5;
        for (let side = 0; side < 2; side++) {
          const sg = side ? -1 : 1, off = side ? -T : 0;
          const mk = (X, Nn, s) => {
            let bx = Nn[1] * dz - Nn[2] * dy, by = Nn[2] * dx - Nn[0] * dz, bz = Nn[0] * dy - Nn[1] * dx;
            const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
            const lift = 0.0016 * sg;
            const base = [X[0] + Nn[0] * (off + lift), X[1] + Nn[1] * (off + lift), X[2] + Nn[2] * (off + lift)];
            pos.push(base[0] - bx * hw, base[1] - by * hw, base[2] - bz * hw, base[0] + bx * hw, base[1] + by * hw, base[2] + bz * hw);
            aS.push(s, s); aX.push(-1, 1);
          };
          const b = pos.length / 3;
          mk(P, N, sP); mk(Q, N2, Math.abs(sQ - sP) > 0.5 ? sP : sQ);
          idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
      geo.setAttribute('aX', new THREE.Float32BufferAttribute(aX, 1));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, makeOutlineMaterial());
      m.material.side = THREE.DoubleSide;
      m.renderOrder = 4; m.visible = false; m.frustumCulled = false;
      turn.add(m); levelObjs.push(m);
      return { mesh: m, mat: m.material, opacity: 0, pulse: -1 };
    }

    function makeSeam(s, si) {
      const n = s.count, T = def.thick;
      const po = new Float32Array(n * 3), no = new Float32Array(n * 3), bi = new Float32Array(n * 3);
      const P = [0, 0, 0], N = [0, 0, 0];
      for (let m = 0; m < n; m++) { surf.pos(s.u[m], s.v[m], P); surf.normal(s.u[m], s.v[m], N); po.set(P, m * 3); no.set(N, m * 3); }
      for (let m = 0; m < n; m++) {
        const a = Math.max(0, m - 1), b = Math.min(n - 1, m + 1);
        const tx = po[b * 3] - po[a * 3], ty = po[b * 3 + 1] - po[a * 3 + 1], tz = po[b * 3 + 2] - po[a * 3 + 2];
        const nx = no[m * 3], ny = no[m * 3 + 1], nz = no[m * 3 + 2];
        let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        const l = Math.hypot(bx, by, bz) || 1;
        bi[m * 3] = bx / l; bi[m * 3 + 1] = by / l; bi[m * 3 + 2] = bz / l;
      }
      // pooling near junctions, a subtle swell where the crack opens
      const pool = new Float32Array(n), seed = new Float32Array(n);
      const rr = makeRng(fr.seed + si * 131);
      const nz = makeNoise(fr.seed + si);
      const step = s.length / Math.max(1, n - 1);
      for (let m = 0; m < n; m++) {
        const d0 = m * step, d1 = (n - 1 - m) * step;
        pool[m] = 1 + (s.j0 ? 0.75 * Math.exp(-d0 / 0.02) : 0) + (s.j1 ? 0.75 * Math.exp(-d1 / 0.02) : 0) + 0.18 * nz.n3(m * step * 9, 0.5, 0.5);
        seed[m] = rr();
      }
      // gold ribbon: 5 vertices across, both skins
      const K = 5, LR = 7;
      const lipEnds = [];
      if (s.rim0) lipEnds.push(0);
      if (s.rim1 && n > 1) lipEnds.push(n - 1);
      const VN = n * K * 2 + lipEnds.length * LR * K;
      const gpos = new Float32Array(VN * 3), gnor = new Float32Array(VN * 3), gfill = new Float32Array(VN).fill(-1);
      const galong = new Float32Array(VN), gacross = new Float32Array(VN), gseed = new Float32Array(VN), gbin = new Float32Array(VN * 3);
      const gidx = [];
      for (let side = 0; side < 2; side++) for (let m = 0; m < n; m++) for (let c = 0; c < K; c++) {
        const v = (side * n + m) * K + c;
        galong[v] = m * step; gacross[v] = -1 + c * 0.5; gseed[v] = seed[m];
        gbin[v * 3] = bi[m * 3]; gbin[v * 3 + 1] = bi[m * 3 + 1]; gbin[v * 3 + 2] = bi[m * 3 + 2];
        gpos[v * 3] = po[m * 3] - (side ? no[m * 3] * T : 0); gpos[v * 3 + 1] = po[m * 3 + 1] - (side ? no[m * 3 + 1] * T : 0); gpos[v * 3 + 2] = po[m * 3 + 2] - (side ? no[m * 3 + 2] * T : 0);
      }
      for (let side = 0; side < 2; side++) for (let m = 0; m < n - 1; m++) for (let c = 0; c < K - 1; c++) {
        const a = (side * n + m) * K + c, b = a + K;
        gidx.push(a, b, b + 1, a, b + 1, a + 1);
      }
      // the gold wraps over the lip where a crack reaches it
      const lips = lipEnds.map((m, li) => {
        const base = n * K * 2 + li * LR * K;
        for (let r = 0; r < LR; r++) for (let c = 0; c < K; c++) {
          const v = base + r * K + c;
          galong[v] = m * step + r * 0.004; gacross[v] = -1 + c * 0.5; gseed[v] = seed[m];
          gbin[v * 3] = bi[m * 3]; gbin[v * 3 + 1] = bi[m * 3 + 1]; gbin[v * 3 + 2] = bi[m * 3 + 2];
          gpos[v * 3] = po[m * 3]; gpos[v * 3 + 1] = po[m * 3 + 1]; gpos[v * 3 + 2] = po[m * 3 + 2];
        }
        for (let r = 0; r < LR - 1; r++) for (let c = 0; c < K - 1; c++) { const a = base + r * K + c, b = a + K; gidx.push(a, b, b + 1, a, b + 1, a + 1); }
        // arc over the rounded lip: outer edge -> crown -> inner edge
        const P = [0, 0, 0], Q = [0, 0, 0];
        surf.pos(s.u[m], s.v[m], P); surf.pos(s.u[m], s.v[m] - 0.004, Q);
        const tv = [P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]], tl = Math.hypot(tv[0], tv[1], tv[2]) || 1;
        for (let d = 0; d < 3; d++) tv[d] /= tl;
        const N3 = [no[m * 3], no[m * 3 + 1], no[m * 3 + 2]];
        const rows = [];
        for (let r = 0; r < LR; r++) {
          const t = r / (LR - 1), ang = t * Math.PI;
          // half-ellipse round the lip section
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const px = [], nx = [];
          for (let d = 0; d < 3; d++) {
            const mid = po[m * 3 + d] - N3[d] * T * 0.5;
            px.push(mid + N3[d] * T * 0.5 * ca + tv[d] * T * 0.42 * sa);
            nx.push(N3[d] * ca + tv[d] * sa);
          }
          rows.push({ p: px, n: nx });
        }
        return { m, base, rows };
      });
      const gg = new THREE.BufferGeometry();
      const att = {
        position: new THREE.BufferAttribute(gpos, 3), normal: new THREE.BufferAttribute(gnor, 3), aFill: new THREE.BufferAttribute(gfill, 1),
        aAlong: new THREE.BufferAttribute(galong, 1), aAcross: new THREE.BufferAttribute(gacross, 1), aSeed: new THREE.BufferAttribute(gseed, 1), aBin: new THREE.BufferAttribute(gbin, 3)
      };
      for (const k in att) gg.setAttribute(k, att[k]);
      gg.setIndex(gidx);
      gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, centerY, 0), Rb * 2);
      const gm = new THREE.Mesh(gg, goldMat);
      gm.renderOrder = 3; gm.castShadow = false; gm.receiveShadow = false;
      turn.add(gm); levelObjs.push(gm);
      // dark hairline
      const hpos = new Float32Array(n * 2 * 2 * 3), hidx = [];
      const hw = 0.0021;
      for (let side = 0; side < 2; side++) for (let m = 0; m < n; m++) {
        const off = side ? -T : 0, lift = side ? -0.0007 : 0.0007;
        for (let c = 0; c < 2; c++) {
          const v = (side * n + m) * 2 + c, sg = c ? 1 : -1;
          for (let d = 0; d < 3; d++) hpos[v * 3 + d] = po[m * 3 + d] + no[m * 3 + d] * (off + lift) + bi[m * 3 + d] * hw * sg;
        }
      }
      for (let side = 0; side < 2; side++) for (let m = 0; m < n - 1; m++) { const a = (side * n + m) * 2; hidx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(hpos, 3));
      hg.setIndex(hidx);
      const hm = new THREE.Mesh(hg, hairMat);
      hm.renderOrder = 2; hm.visible = false; hm.frustumCulled = false;
      turn.add(hm); levelObjs.push(hm);
      return {
        a: s.a, b: s.b, n, len: s.length, step, po, no, bi, pool, seed, rim0: s.rim0, rim1: s.rim1,
        fill: new Float32Array(n).fill(-1), dev: new Float32Array(n), width: new Float32Array(n), filled: 0, done: false,
        gold: gm, att, hair: hm, dirty: false, dmin: 1e9, dmax: -1, dlip: false, idx: si, lips
      };
    }

    function buildSeamIndex() {
      const C = 0.05, map = new Map();
      const keyOf = (x, y, z) => ((Math.floor(x / C) + 512) * 1048576) + ((Math.floor(y / C) + 512) * 1024) + (Math.floor(z / C) + 512);
      const T = def.thick;
      seams.forEach((s, si) => {
        for (let m = 0; m < s.n; m++) for (let side = 0; side < 2; side++) {
          const x = s.po[m * 3] - (side ? s.no[m * 3] * T : 0), y = s.po[m * 3 + 1] - (side ? s.no[m * 3 + 1] * T : 0), z = s.po[m * 3 + 2] - (side ? s.no[m * 3 + 2] * T : 0);
          const k = keyOf(x, y, z);
          let arr = map.get(k); if (!arr) map.set(k, arr = []);
          arr.push(si, m, side);
        }
      });
      return {
        nearest(p, r) {
          let best = null, bd = r * r;
          const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), cz = Math.floor(p.z / C);
          const rc = Math.ceil(r / C);
          for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) for (let k = -rc; k <= rc; k++) {
            const arr = map.get(((cx + i + 512) * 1048576) + ((cy + j + 512) * 1024) + (cz + k + 512));
            if (!arr) continue;
            for (let q = 0; q < arr.length; q += 3) {
              const s = seams[arr[q]], m = arr[q + 1], side = arr[q + 2];
              const x = s.po[m * 3] - (side ? s.no[m * 3] * T : 0) - p.x, y = s.po[m * 3 + 1] - (side ? s.no[m * 3 + 1] * T : 0) - p.y, z = s.po[m * 3 + 2] - (side ? s.no[m * 3 + 2] * T : 0) - p.z;
              const d = x * x + y * y + z * z;
              if (d < bd) { bd = d; best = { s: arr[q], m, side, d: Math.sqrt(d) }; }
            }
          }
          return best;
        }
      };
    }

    // write one gold sample into the ribbon (both skins)
    function writeGold(s, m) {
      const K = 5, T = def.thick, w = s.width[m], h = w * 0.3;
      const P = s.att.position.array, Nn = s.att.normal.array, F = s.att.aFill.array;
      for (let side = 0; side < 2; side++) {
        const sg = side ? -1 : 1;
        for (let c = 0; c < K; c++) {
          const v = (side * s.n + m) * K + c, a = -1 + c * 0.5;
          const prof = Math.pow(Math.max(0, 1 - a * a), 0.55);
          const lift = 0.0011 + h * prof;
          for (let d = 0; d < 3; d++) {
            const nrm = s.no[m * 3 + d] * sg;
            P[v * 3 + d] = s.po[m * 3 + d] - (side ? s.no[m * 3 + d] * T : 0) + s.bi[m * 3 + d] * a * w * 0.5 + nrm * lift;
            Nn[v * 3 + d] = nrm + s.bi[m * 3 + d] * a * 0.85;
          }
          const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
          Nn[v * 3] /= l; Nn[v * 3 + 1] /= l; Nn[v * 3 + 2] /= l;
          F[v] = s.fill[m];
        }
      }
      for (const L of s.lips) {
        if (L.m !== m) continue;
        for (let r = 0; r < L.rows.length; r++) {
          const R = L.rows[r];
          for (let c = 0; c < K; c++) {
            const v = L.base + r * K + c, a = -1 + c * 0.5;
            const prof = Math.pow(Math.max(0, 1 - a * a), 0.55), lift = 0.0011 + h * prof;
            for (let d = 0; d < 3; d++) {
              P[v * 3 + d] = R.p[d] + s.bi[m * 3 + d] * a * w * 0.5 + R.n[d] * lift;
              Nn[v * 3 + d] = R.n[d] + s.bi[m * 3 + d] * a * 0.85;
            }
            const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
            Nn[v * 3] /= l; Nn[v * 3 + 1] /= l; Nn[v * 3 + 2] /= l;
            F[v] = s.fill[m] + 0.02 * r;
          }
        }
      }
      s.dirty = true;
      if (m < s.dmin) s.dmin = m;
      if (m > s.dmax) s.dmax = m;
      if (s.lips.some(L => L.m === m)) s.dlip = true;
    }
    // upload only the stretch of ribbon that changed (both skins, and the lip)
    function flushGold(s) {
      const K = 5, a0 = s.dmin * K, cnt = (s.dmax - s.dmin + 1) * K, lipBase = s.n * K * 2, lipCnt = s.lips.length * 7 * K;
      for (const [name, sz] of [['position', 3], ['normal', 3], ['aFill', 1]]) {
        const at = s.att[name];
        at.clearUpdateRanges();
        at.addUpdateRange(a0 * sz, cnt * sz);
        at.addUpdateRange((s.n * K + a0) * sz, cnt * sz);
        if (s.dlip && lipCnt) at.addUpdateRange(lipBase * sz, lipCnt * sz);
        at.needsUpdate = true;
      }
      s.dirty = false; s.dmin = 1e9; s.dmax = -1; s.dlip = false;
    }
    const W0 = 0.0165;
    function fillSample(s, m, devNorm, delay) {
      if (s.fill[m] >= 0) return 0;
      s.fill[m] = shared.uTime.value + delay;
      s.dev[m] = devNorm;
      const jitter = 0.9 + s.seed[m] * 0.2;
      s.width[m] = W0 * (0.82 + 0.9 * devNorm) * jitter * s.pool[m];
      writeGold(s, m);
      s.filled++;
      stats.devSum += devNorm; stats.devN++;
      return s.step;
    }

    // ---------- shards: tray layout and transforms
    function trayLayout() {
      const loose = shards.filter(s => !s.anchor && s.state !== 'placed');
      if (!loose.length) return;
      const A = area(), W = ctx.width, H = ctx.height;
      const b = boxFor('assembly');
      const portrait = H >= W * 1.05;
      const rects = portrait
        ? [{ x0: A.left + 12, y0: b.cy + b.h * 0.5 + 4, x1: W - A.right - 12, y1: H - A.bottom - 6 }]
        : [{ x0: A.left + 14, y0: A.top + 60, x1: b.cx - b.s * 0.5 - 4, y1: H - A.bottom - 8 }, { x0: b.cx + b.s * 0.5 + 4, y0: A.top + 60, x1: W - A.right - 14, y1: H - A.bottom - 8 }];
      const trayDist = cam.tD - Rb * 0.25;
      const ppu = (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / trayDist;
      let areaAvail = 0;
      for (const r of rects) areaAvail += Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
      let need = 0;
      for (const s of loose) need += Math.PI * Math.pow(s.f.radius * ppu * 0.78, 2);
      const tscale = clamp(Math.sqrt(areaAvail * 0.5 / Math.max(1, need)), 0.36, 1);
      const items = loose.map(s => ({ s, r: s.f.radius * ppu * 0.78 * tscale })).sort((a, c) => c.r - a.r);
      const placed = [];
      for (const it of items) {
        let best = null, bs = -1e9;
        for (const r of rects) {
          for (let y = r.y0 + 6; y <= r.y1 - 6; y += 7) for (let x = r.x0 + 6; x <= r.x1 - 6; x += 7) {
            let sc = Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y) - it.r;
            for (const p of placed) sc = Math.min(sc, Math.hypot(x - p.x, y - p.y) - (it.r + p.r) * 0.92);
            sc = Math.min(sc, 60) - Math.hypot(x - b.cx, y - b.cy) * 0.02;
            if (sc > bs) { bs = sc; best = { x, y }; }
          }
        }
        if (!best) best = { x: W / 2, y: H * 0.8 };
        placed.push({ x: best.x, y: best.y, r: it.r, s: it.s });
      }
      // relax: push overlapping pieces apart, keep them inside their region
      const bound = (p) => { let r = rects[0], bd = 1e9; for (const q of rects) { const d = Math.hypot(clamp(p.x, q.x0, q.x1) - p.x, clamp(p.y, q.y0, q.y1) - p.y); if (d < bd) { bd = d; r = q; } } p.x = clamp(p.x, r.x0 + p.r * 0.8, r.x1 - p.r * 0.8); p.y = clamp(p.y, r.y0 + p.r * 0.7, r.y1 - p.r * 0.7); };
      for (let it = 0; it < 40; it++) {
        for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i], c = placed[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 1, need = (a.r + c.r) * 0.86;
          if (d < need) { const push = (need - d) * 0.5; a.x -= dx / d * push; a.y -= dy / d * push; c.x += dx / d * push; c.y += dy / d * push; }
        }
        for (const q of placed) bound(q);
      }
      for (const p of placed) { p.s.tx = p.x; p.s.ty = p.y; p.s.tscale = tscale; p.s.restScale = tscale; }
    }
    function rollQuat(roll, out) { return out.setFromAxisAngle(camFwd(), roll); }
    const qFace = new THREE.Quaternion(), vN = new THREE.Vector3(), vC = new THREE.Vector3(), qI = new THREE.Quaternion();
    // resting shards turn their glazed face toward the viewer; near their place
    // (present -> 0) they take their true orientation
    function displayQuat(s, out) {
      tmpQ2.setFromAxisAngle(Y, -s.phi);
      if (s.present > 0.001 && s.nrm) {
        vN.copy(s.nrm).applyQuaternion(tmpQ2);
        vC.copy(camFwd()).negate();
        if (vN.dot(vC) < 0) vN.negate();
        qFace.setFromUnitVectors(vN, vC);
        qI.identity().slerp(qFace, s.present * 0.72);
        tmpQ2.premultiply(qI);
      }
      rollQuat(s.roll, out);
      return out.multiply(tmpQ2);
    }
    function targetWorld(s, out) { return turn.localToWorld(out.set(s.f.centroid[0], s.f.centroid[1], s.f.centroid[2])); }
    const scr = [0, 0, 0], scr2 = [0, 0, 0];

    function placeShard(s) {
      s.state = 'placed';
      s.mesh.layers.set(0);
      turn.attach(s.mesh);
      s.mesh.position.set(s.f.centroid[0], s.f.centroid[1], s.f.centroid[2]);
      s.mesh.quaternion.identity(); s.mesh.scale.setScalar(1);
      s.sh.visible = false;
      s.mesh.castShadow = true;
    }
    function looseShard(s) {
      s.mesh.layers.set(1);
      scene.attach(s.mesh);
      s.mesh.castShadow = false;
      s.sh.visible = true;
    }

    // ---------- break
    function startBreak() {
      if (state !== 'intro') return;
      state = 'breaking'; stateT = 0;
      ui.title(null, null, false);
      audio.crack(); haptic('heavy');
      frame('assembly');
      const rr = makeRng(fr.seed + 5);
      // rolls for this level
      for (const s of shards) {
        if (s.anchor) continue;
        s.roll = lv.roll > 0 ? rr.sign() * lerp(lv.roll * 0.35, lv.roll, rr()) * Math.PI / 180 : 0;
        // at least a clear misalignment when rotation is part of the level
        if (lv.roll > 30 && Math.abs(s.roll) < lv.rollTol * 1.8 * Math.PI / 180) s.roll = Math.sign(s.roll || 1) * lv.rollTol * 2.2 * Math.PI / 180;
      }
      // hairlines flash across every crack for a moment
      for (const se of seams) se.hair.visible = true;
      // pieces leave in a staggered burst after the crack
      updateCamera(0);
      const C = new THREE.Vector3();
      for (const s of shards) {
        if (s.anchor) continue;
        looseShard(s);
        s.state = 'flying'; s.flyT = -0.18 - rr() * 0.12; s.landed = false; s.present = 1;
        s.scale = 1;
        const out = new THREE.Vector3(s.f.centroid[0], 0, s.f.centroid[2]).normalize();
        out.applyAxisAngle(Y, yaw);
        const imp = 1.0 / Math.pow(s.mass, 0.45);
        s.vel.copy(out).multiplyScalar(lerp(0.9, 1.5, rr()) * imp).add(C.set(rr.range(-0.3, 0.3), lerp(0.8, 1.4, rr()) * imp, lerp(0.4, 0.9, rr())));
        s.w.set(rr.range(-1, 1), rr.range(-1, 1), rr.range(-1, 1)).normalize().multiplyScalar(lerp(3, 7, rr()) / Math.pow(s.mass, 0.5));
      }
      trayLayout();
    }

    const flightTarget = new THREE.Vector3(), scrTmp = [0, 0, 0];
    function stepFlight(s, dt) {
      s.flyT += dt;
      if (s.flyT < 0) return;
      const fwdDist = cam.tD - Rb * 0.25;
      fromScreen(s.tx, s.ty, fwdDist, flightTarget);
      const k = 30 / Math.pow(s.mass, 0.35), c = 2 * Math.sqrt(k) * 0.78;
      const kr = 26 / Math.pow(s.mass, 0.3), cr = 2 * Math.sqrt(kr) * 0.85;
      const x = s.mesh.position;
      displayQuat(s, s.tq);
      // small fixed substeps keep the springs stable at any frame rate
      const steps = Math.max(1, Math.ceil(dt / 0.006)), h = dt / steps;
      let wl = 0;
      for (let i = 0; i < steps; i++) {
        const grav = s.flyT < 0.22 ? -4.5 : 0;
        s.vel.x += ((flightTarget.x - x.x) * k - s.vel.x * c) * h;
        s.vel.y += ((flightTarget.y - x.y) * k - s.vel.y * c + grav) * h;
        s.vel.z += ((flightTarget.z - x.z) * k - s.vel.z * c) * h;
        x.addScaledVector(s.vel, h);
        tmpQ.copy(s.tq).multiply(tmpQ2.copy(s.mesh.quaternion).invert());
        if (tmpQ.w < 0) { tmpQ.x = -tmpQ.x; tmpQ.y = -tmpQ.y; tmpQ.z = -tmpQ.z; tmpQ.w = -tmpQ.w; }
        const ang = 2 * Math.acos(clamp(tmpQ.w, -1, 1)), sn = Math.sqrt(Math.max(1e-9, 1 - tmpQ.w * tmpQ.w));
        s.w.x += (tmpQ.x / sn * ang * kr - s.w.x * cr) * h; s.w.y += (tmpQ.y / sn * ang * kr - s.w.y * cr) * h; s.w.z += (tmpQ.z / sn * ang * kr - s.w.z * cr) * h;
        wl = s.w.length();
        if (wl > 1e-6) { tmpQ.setFromAxisAngle(tmpV2.copy(s.w).divideScalar(wl), wl * h); s.mesh.quaternion.premultiply(tmpQ).normalize(); }
      }
      s.mesh.scale.setScalar(lerp(1, s.tscale, smooth(s.flyT / 0.9)));
      const dist = x.distanceTo(flightTarget), sp = s.vel.length();
      if (!s.landed && s.flyT > 0.35 && sp < 0.9) { s.landed = true; audio.land(clamp(s.mass * 1.5, 0, 1)); }
      if ((s.flyT > 0.6 && dist < 0.004 && sp < 0.05 && wl < 0.08) || s.flyT > 2.4) {
        // hand over from where the piece actually is, so nothing jumps
        toScreen(x, scrTmp);
        s.state = 'loose'; s.sx = scrTmp[0]; s.sy = scrTmp[1]; s.scale = s.mesh.scale.x;
        s.dist = x.clone().sub(camera.position).dot(camFwd());
      }
    }

    // ---------- assembly: held / loose shard placement
    function shardScreen(s, out) { return toScreen(s.mesh.position, out); }
    function errors(s) {
      const tw = targetWorld(s, new THREE.Vector3());
      toScreen(tw, scr2);
      shardScreen(s, scr);
      const dpx = Math.hypot(scr[0] - scr2[0], scr[1] - scr2[1]);
      return { pos: dpx / objPx(), yaw: wrapAngle(yaw + s.phi), roll: wrapAngle(s.roll), tx: scr2[0], ty: scr2[1], dpx, tw };
    }
    const deg = x => x * Math.PI / 180;
    function updateLooseShard(s, dt) {
      const k = 1 - Math.exp(-dt * 14);
      if (s.state === 'held') {
        const e = errors(s);
        // magnetic help once close, position, orientation and the turn of the object
        const near = 1 - clamp01(e.dpx / (objPx() * lv.pos * 2.4));
        const yawOk = Math.abs(e.yaw) < deg(lv.yawTol) * 2.2, rollOk = Math.abs(e.roll) < deg(lv.rollTol) * 2.2;
        let gx = s.gx, gy = s.gy;
        if (yawOk && rollOk && near > 0) {
          const pull = near * near * 0.55;
          gx = lerp(gx, e.tx, pull); gy = lerp(gy, e.ty, pull);
          s.roll -= e.roll * near * near * dt * 5;
          yaw -= e.yaw * near * near * (1 - Math.exp(-dt * 5)); yawVel = 0;
        }
        s.sx += (gx - s.sx) * (1 - Math.exp(-dt * 26)); s.sy += (gy - s.sy) * (1 - Math.exp(-dt * 26));
        // depth eases toward the target's depth as the piece approaches
        const tdist = e.tw.clone().sub(camera.position).dot(camFwd());
        const close = 1 - clamp01(e.dpx / (objPx() * 0.7));
        s.present += (1 - smooth(1 - clamp01(e.dpx / (objPx() * 0.95))) - s.present) * (1 - Math.exp(-dt * 10));
        const want = lerp(cam.D - Rb * 0.25, Math.min(cam.D - Rb * 0.25, tdist) - 0.02, close * (yawOk ? 1 : 0.2));
        s.dist += (want - s.dist) * k;
        s.tscale = 1;
        s.lift += (1 - s.lift) * (1 - Math.exp(-dt * 12));
      } else if (s.state === 'loose') {
        const e = errors(s);
        const far = clamp01(e.dpx / (objPx() * 0.95));
        s.present += (1 - smooth(1 - far) - s.present) * (1 - Math.exp(-dt * 6));
        // rotated in place, or the object turned to meet it: it seats itself
        if (state === 'assembly' && e.pos < lv.pos && snapOk(e) && Math.hypot(s.tx - s.sx, s.ty - s.sy) < 3) { s.misses = Math.max(0, s.misses - 1); if (trySnap(s)) { if (selected === s) selected = null; return; } }
        s.sx += (s.tx - s.sx) * k * 0.6; s.sy += (s.ty - s.sy) * k * 0.6;
        s.dist += (cam.D - Rb * 0.25 - s.dist) * k;
        s.lift += (0 - s.lift) * (1 - Math.exp(-dt * 8));
        s.tscale = s.restScale || s.tscale;
      }
      s.scale += (s.tscale * (1 + s.lift * 0.03) - s.scale) * (1 - Math.exp(-dt * 12));
      // gentle breath when hinted
      const bob = s.hint > 0 ? Math.sin(stateT * 3.2) * 5 * s.hint : 0;
      fromScreen(s.sx, s.sy - s.lift * 4 - bob, s.dist, s.mesh.position);
      displayQuat(s, tmpQ);
      s.mesh.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * (s.state === 'held' ? 22 : 12)));
      s.mesh.scale.setScalar(s.scale);
      // soft shadow behind and below
      const sh = s.sh;
      sh.visible = true;
      const r = s.f.radius * s.scale * 1.5;
      sh.quaternion.copy(camera.quaternion);
      sh.position.copy(s.mesh.position).addScaledVector(camFwd(), 0.12 + s.lift * 0.05);
      tmpV.set(0.02 + s.lift * 0.03, -0.035 - s.lift * 0.05, 0).applyQuaternion(camera.quaternion);
      sh.position.add(tmpV);
      sh.scale.set(r * 2.1, r * 1.8, 1);
      sh.material.opacity = 0.32 + s.lift * 0.22;
    }

    const snapOk = e => e.pos < lv.pos && Math.abs(e.yaw) < deg(lv.yawTol) && Math.abs(e.roll) < deg(lv.rollTol);
    function trySnap(s) {
      const e = errors(s);
      if (snapOk(e)) {
        const q = 1 - clamp01(e.pos / lv.pos * 0.4 + Math.abs(e.yaw) / deg(lv.yawTol) * 0.3 + Math.abs(e.roll) / deg(lv.rollTol) * 0.3) * 0.5;
        s.quality = clamp01(q - s.misses * 0.04);
        stats.placeQ.push(s.quality);
        s.state = 'snapping'; s.snapT = 0;
        s.snapFrom = s.mesh.position.clone(); s.snapQ = s.mesh.quaternion.clone(); s.snapS = s.mesh.scale.x;
        yawTarget = -s.phi;
        s.sh.visible = false;
        try { ctx.platform.interact({ kind: 'place' }); } catch (er) {}
        return true;
      }
      // close but not right: a small, honest refusal
      if (e.pos < lv.pos * 2.6) {
        s.misses++; stats.rejects++;
        audio.reject(); haptic('light');
        const dx = s.sx - e.tx, dy = s.sy - e.ty, l = Math.hypot(dx, dy) || 1;
        s.tx = s.sx + dx / l * 14; s.ty = s.sy + dy / l * 14;
      } else {
        audio.drop();
        s.tx = s.sx; s.ty = s.sy;
      }
      // keep inside the screen
      const A = area();
      s.tx = clamp(s.tx, A.left + 24, ctx.width - A.right - 24); s.ty = clamp(s.ty, A.top + 60, ctx.height - A.bottom - 16);
      s.restScale = Math.max(s.restScale || 0.6, 0.86);
      return false;
    }
    function stepSnap(s, dt) {
      s.snapT += dt / 0.34;
      const t = clamp01(s.snapT);
      const tw = targetWorld(s, new THREE.Vector3());
      // a breath of anticipation, then it seats
      const a = t < 0.22 ? -0.05 * Math.sin(Math.PI * t / 0.22) : easeOutCubic((t - 0.22) / 0.78);
      s.mesh.position.lerpVectors(s.snapFrom, tw, a);
      tmpQ.setFromAxisAngle(Y, yaw);
      s.mesh.quaternion.slerpQuaternions(s.snapQ, tmpQ, clamp01(a));
      s.mesh.scale.setScalar(lerp(s.snapS, 1, clamp01(a)));
      if (t >= 1) {
        placeShard(s);
        audio.snap(clamp(s.mass, 0, 1)); haptic('medium');
        s.outline.pulse = 0;
        for (const se of seams) se.hair.visible = shards[se.a].state === 'placed' && shards[se.b].state === 'placed';
        if (shards.every(x => x.state === 'placed')) { state = 'assembled'; stateT = 0; }
      }
    }

    // ---------- gold painting
    const paint = { active: false, x: 0, y: 0, lastH: null, lastS: -1, lastM: -1, still: 0, stopped: false, dripAcc: 0, spillAcc: 0, speed: 0, onCrack: false };
    const hitTmp = new THREE.Vector3();
    function rayObject(x, y) {
      raycaster.setFromCamera(new THREE.Vector2((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1), camera);
      raycaster.layers.set(2);
      const hit = raycaster.intersectObject(proxy, false)[0];
      return hit || null;
    }
    function magnetR() {
      // never below a comfortable touch size on screen
      const px = 13 / pxPerUnit(cam.D);
      return Math.max(lv.magnet, px);
    }
    function paintStep(dt) {
      const hit = rayObject(paint.x, paint.y);
      if (!hit) { paint.lastH = null; paint.onCrack = false; audio.flow(0, false); return; }
      const H = turn.worldToLocal(hitTmp.copy(hit.point)).clone();
      const travel = paint.lastH ? H.distanceTo(paint.lastH) : 0;
      paint.lastH = H;
      stats.travel += travel;
      const sp = travel / Math.max(1e-3, dt);
      paint.speed += (sp - paint.speed) * 0.3;
      if (gold <= 0) { audio.flow(0, false); return; }
      const R = magnetR();
      const nb = seamIndex.nearest(H, R);
      let used = 0;
      if (nb) {
        const s = seams[nb.s];
        const devNorm = clamp01(nb.d / lv.magnet);
        paint.onCrack = true;
        // fill continuously between the last contact and this one
        let from = nb.m, to = nb.m;
        if (paint.lastS === nb.s && paint.lastM >= 0) {
          const maxStep = Math.ceil((travel * 1.8 + 0.03) / s.step);
          if (Math.abs(nb.m - paint.lastM) <= maxStep) { from = Math.min(paint.lastM, nb.m); to = Math.max(paint.lastM, nb.m); }
        }
        let newLen = 0;
        for (let m = from; m <= to; m++) newLen += fillSample(s, m, devNorm, 0);
        // capillary: liquid gold runs a little ahead along the crack
        const dir = paint.lastS === nb.s ? Math.sign(nb.m - paint.lastM) : 0;
        if (dir !== 0) for (let w = 1; w <= 3; w++) { const m = nb.m + dir * w; if (m >= 0 && m < s.n) newLen += fillSample(s, m, devNorm, 0.035 * w); }
        used = newLen * (1 + devNorm * 0.6) + travel * 0.05;
        paint.lastS = nb.s; paint.lastM = nb.m;
        // pooling when the finger rests: a wider bead, and gold spent
        if (travel < 0.0012) {
          paint.still += dt;
          if (paint.still > 0.3 && !paint.stopped) { paint.stopped = true; stats.stops++; }
          if (paint.still > 0.3 && s.fill[nb.m] >= 0 && s.width[nb.m] < W0 * 2.2) {
            s.width[nb.m] *= 1 + dt * 0.8; writeGold(s, nb.m); used += dt * 0.015;
          }
        } else { paint.still = 0; paint.stopped = false; }
        if (newLen > 0) { paint.dripAcc += newLen; if (paint.dripAcc > 0.09) { paint.dripAcc = 0; haptic('light'); } }
        if (s.filled >= s.n && !s.done) completeSeam(s);
      } else {
        paint.onCrack = false;
        paint.lastS = -1; paint.lastM = -1;
        used = travel * 1.05;
        stats.offTravel += travel;
        paint.spillAcc += travel;
        if (paint.spillAcc > 0.03 || (travel > 0 && spills.length === 0)) { paint.spillAcc = 0; spawnSpill(H, hit.face ? hit.face.normal : null, clamp(travel / 0.02, 0.4, 1.3)); audio.drip(); }
      }
      used = Math.min(used, gold);
      gold -= used; goldUsed += used;
      audio.flow(clamp(paint.speed / 1.2, 0, 1), paint.onCrack);
    }
    function spawnSpill(H, faceN, size) {
      let n;
      if (faceN) n = faceN.clone(); else n = new THREE.Vector3(H.x, 0, H.z).normalize();
      if (spills.length >= SPILLS) spills.shift();
      spills.push({ p: H.clone(), n, r: 0.006 * size + 0.003, t: 0 });
    }
    const spM4 = new THREE.Matrix4(), spQ = new THREE.Quaternion(), spS = new THREE.Vector3();
    function updateSpills(dt) {
      const m4 = spM4, q = spQ, sc = spS;
      if (!spills.length && spillMesh.count === 0) return;
      let c = 0;
      for (let i = spills.length - 1; i >= 0; i--) { spills[i].t += dt; if (spills[i].t > 2.8) spills.splice(i, 1); }
      for (const s of spills) {
        const grow = smooth(s.t / 0.12), fade = 1 - smooth((s.t - 0.7) / 2.1);
        const r = s.r * grow * fade;
        q.setFromUnitVectors(Y, s.n);
        sc.set(r, r * 0.32, r);
        m4.compose(s.p, q, sc);
        spillMesh.setMatrixAt(c++, m4);
      }
      spillMesh.count = c;
      spillMesh.instanceMatrix.needsUpdate = true;
    }
    let settleCount = 0;
    function completeSeam(s) {
      s.done = true; stats.seamsDone++;
      audio.settle(settleCount++);
      haptic('light');
    }
    // after a stroke, tiny unfilled gaps on a nearly finished seam fill themselves
    function bridgeGaps() {
      for (const s of seams) {
        if (s.done || s.filled < s.n * 0.88) continue;
        let run = 0, maxRun = 0;
        for (let m = 0; m < s.n; m++) { if (s.fill[m] < 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
        if (maxRun <= 7) {
          let k = 0, need = 0;
          for (let m = 0; m < s.n; m++) if (s.fill[m] < 0) need += s.step;
          if (need > gold) continue;
          for (let m = 0; m < s.n; m++) if (s.fill[m] < 0) { gold -= s.step; goldUsed += s.step; fillSample(s, m, 0.5, 0.05 + 0.02 * (k++)); }
          completeSeam(s);
        }
      }
    }

    // ---------- reveal and results
    function computeScore() {
      const placement = stats.placeQ.length ? stats.placeQ.reduce((a, b) => a + b, 0) / stats.placeQ.length : 1;
      const goldPrec = stats.devN ? clamp01(1 - (stats.devSum / stats.devN) * 0.85) : 0;
      const precision = placement * 0.4 + goldPrec * 0.6;
      const completion = seams.reduce((a, s) => a + s.filled, 0) / Math.max(1, stats.samples);
      const offRatio = stats.offTravel / Math.max(1e-3, stats.travel);
      const extra = Math.max(0, stats.strokes - Math.ceil(seams.length * 1.2));
      const flow = clamp01(1 - extra * 0.03 - stats.stops * 0.04 - offRatio * 0.8);
      const efficiency = clamp01((fr.totalSeam * completion) / Math.max(1e-3, goldUsed) / 0.86);
      const total = Math.round(1000 * (0.35 * precision + 0.2 * flow + 0.2 * efficiency + 0.25 * completion) * (0.6 + 0.4 * completion));
      const grade = total >= 900 ? 'Perfect' : total >= 780 ? 'Excellent' : total >= 600 ? 'Beautiful' : 'Repaired';
      return { total, grade, precision, flow, efficiency, completion };
    }
    function beginReveal() {
      state = 'reveal'; stateT = 0; revealT = 0;
      paint.active = false; audio.flowStop();
      resultInfo = computeScore();
      finalQuality = resultInfo.total / 1000;
      shared.uFinalRough.value = lerp(0.32, 0.16, smooth((finalQuality - 0.45) / 0.5));
      for (const s of shards) s.outline.opacity = 0;
      ui.gold(gold / goldMax, false);
      ui.chrome(false);
      audio.final(finalQuality); haptic('success');
      audio.bed(0.55);
      frame('results');
      revealYaw0 = yaw; userTurned = false;
      try { ctx.platform.milestone('repaired', { level: levelIndex + 1 }); } catch (e) {}
    }
    let revealYaw0 = 0, userTurned = false;
    function showResults() {
      state = 'results'; stateT = 0;
      const r = resultInfo;
      const obj = lv.obj;
      const prevBest = save.best[obj] || 0;
      if (r.total > prevBest) { save.best[obj] = r.total; save.grade[obj] = r.grade; }
      else if (!save.grade[obj]) save.grade[obj] = r.grade;
      save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
      persist();
      const last = levelIndex >= LEVELS.length - 1;
      ui.results({ grade: r.grade, score: r.total, meta: prevBest > 0 ? (r.total > prevBest ? 'New best' : 'Best ' + prevBest) : '', nextLabel: last ? 'Collection' : 'Next' });
      audio.reveal();
      score.set(r.total);
      try { ctx.platform.complete({ level: levelIndex + 1, score: r.total, grade: r.grade }); } catch (e) {}
      const mine = attempt;
      // leaderboard: per object, never blocking replay
      try {
        const dims = { object: obj };
        score.submit('repair', { dimensions: dims, label: r.grade }).then(() => score.rank('repair', { scope: 'global', period: 'all_time', dimensions: dims })).then(st => {
          if (disposed || mine !== attempt || state !== 'results') return;
          const vr = st && st.viewerRank;
          if (vr && typeof vr.rank === 'number') ui.meta(`Best ${vr.value} · ${ordinal(vr.rank)} of ${st.totalRanked}`);
        }).catch(() => { if (!disposed && mine === attempt && state === 'results' && prevBest === 0) ui.meta(''); });
      } catch (e) {}
      ctx.timeout(() => { if (disposed || mine !== attempt || state !== 'results') return; try { ctx.pulse.complete({ level: levelIndex + 1, score: r.total, result: r.grade, text: def.name + ' — ' + r.grade }); } catch (e) {} }, 1400);
    }
    const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

    // ---------- level transitions
    let transitioning = false;
    async function goLevel(i) {
      if (transitioning) return;
      transitioning = true;
      ui.hideResults();
      try {
        const tr = ctx.fx.transition({ kind: 'fade', color: '#070706', outMs: 420, inMs: 520 });
        await tr.cover();
        if (disposed) return;
        state = 'loading';
        loadLevel(i);
        updateCamera(1); render();
        await tr.reveal();
      } catch (e) {
        state = 'loading'; loadLevel(i);
      }
      transitioning = false;
    }

    // ---------- input
    const pointers = new Map();
    let mode = 'none', modePtr = -1, twist = null, turnLast = null, ringGrab = 0;
    const cssXY = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function pickShard(x, y) {
      raycaster.setFromCamera(new THREE.Vector2((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1), camera);
      raycaster.layers.set(1);
      const cands = shards.filter(s => !s.anchor && (s.state === 'loose' || s.state === 'held')).map(s => s.mesh);
      const hit = raycaster.intersectObjects(cands, false)[0];
      if (hit) return shards.find(s => s.mesh === hit.object);
      // generous touch: nearest shard centre within its radius
      let best = null, bd = 1e9;
      for (const s of shards) {
        if (s.anchor || s.state !== 'loose') continue;
        shardScreen(s, scr);
        const r = s.f.radius * s.scale * pxPerUnit(s.dist) * 0.75 + 10;
        const d = Math.hypot(scr[0] - x, scr[1] - y);
        if (d < r && d < bd) { bd = d; best = s; }
      }
      return best;
    }
    const ringRadius = s => s.f.radius * s.scale * pxPerUnit(s.dist) * 0.95 + 18;
    function ringKnob(s) {
      shardScreen(s, scr);
      const R = ringRadius(s), a = s.roll - Math.PI / 2;
      return [scr[0] + Math.cos(a) * R, scr[1] + Math.sin(a) * R, scr[0], scr[1]];
    }
    const rotationOn = () => lv && lv.roll > 0;
    function firstGesture() {
      audio.unlock();
      if (!started) {
        attemptStart();
        ctx.timeout(() => audio.bedStart(), 60);
      } else if (!audio.ready) audio.unlock();
    }
    // a gesture whose end never arrived (system swipe, app switch) is closed here
    function resetGesture() {
      pointers.clear(); twist = null;
      if (held) { if (held.state === 'held') held.state = 'loose'; held = null; }
      if (paint.active) { paint.active = false; audio.flowStop(); }
      mode = 'none'; modePtr = -1; turnLast = null;
    }
    function onDown(e) {
      if (paused || transitioning) return;
      firstGesture();
      const [x, y] = cssXY(e);
      if (e.isPrimary && pointers.size) resetGesture();
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
      pointers.set(e.pointerId, { x, y, sx: x, sy: y, px: x, py: y, type: e.pointerType });
      lastInteract = stateT;
      for (const o of shards) o.hint = 0;
      if (pointers.size === 2 && mode === 'shard' && held) {
        const ps = [...pointers.values()];
        twist = { a: Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) };
        return;
      }
      if (pointers.size > 1) return;
      modePtr = e.pointerId;
      if (state === 'intro') { if (performance.now() - loadedAt > 250) startBreak(); mode = 'none'; return; }
      if (state === 'assembly') {
        if (selected && rotationOn() && selected.state === 'loose') {
          const k = ringKnob(selected);
          if (Math.hypot(k[0] - x, k[1] - y) < 26) { mode = 'ring'; ringGrab = Math.atan2(y - k[3], x - k[2]) - selected.roll; return; }
        }
        const s = pickShard(x, y);
        if (s) {
          mode = 'shard'; held = s; selected = s; s.state = 'held';
          shardScreen(s, scr);
          s.ox = scr[0] - x; s.oy = scr[1] - y;
          s.touch = e.pointerType === 'touch';
          s.gx = s.sx; s.gy = s.sy;
          audio.select(clamp(s.mass, 0, 1)); haptic('light');
          markSeen('intro');
          for (const o of shards) o.hint = 0;
          if (rotationOn() && !seen.rotate && Math.abs(wrapAngle(s.roll)) > deg(lv.rollTol)) s.rotDemo = 0;
          return;
        }
        if (selected) selected = null;
        mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null;
        return;
      }
      if (state === 'gold') {
        if (rayObject(x, y)) {
          mode = 'paint'; yawTarget = null; yawVel = 0; paint.active = true; paint.x = x; paint.y = y; paint.lastH = null; paint.lastS = -1; paint.lastM = -1; paint.still = 0; paint.stopped = false;
          stats.strokes++;
          audio.flowStart();
          markSeen('gold');
          try { ctx.platform.interact({ kind: 'gold' }); } catch (er) {}
          return;
        }
        mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null;
        return;
      }
      if (state === 'results' || state === 'reveal') { userTurned = true; mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null; yawVel = 0; }
    }
    function onMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const [x, y] = cssXY(e);
      p.px = p.x; p.py = p.y; p.x = x; p.y = y;
      if (twist && held && pointers.size >= 2) {
        const ps = [...pointers.values()];
        const a = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x);
        held.roll += wrapAngle(a - twist.a); twist.a = a;
        return;
      }
      if (e.pointerId !== modePtr) return;
      if (mode === 'shard' && held) {
        const lift = held.touch ? 34 : 0;
        held.gx = x + held.ox; held.gy = y + held.oy - lift * Math.min(1, held.lift * 2);
      } else if (mode === 'ring' && selected) {
        const k = ringKnob(selected);
        selected.roll = Math.atan2(y - k[3], x - k[2]) - ringGrab;
      } else if (mode === 'turn' && turnLast) {
        const now = performance.now(), dx = x - turnLast.x;
        yaw += dx * 0.0085;
        yawVel = yawVel * 0.5 + (dx * 0.0085) / Math.max(0.008, (now - turnLast.t) / 1000) * 0.5;
        turnLast = { x, t: now };
      } else if (mode === 'paint') { paint.x = x; paint.y = y; }
    }
    function onUp(e) {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (twist && pointers.size < 2) twist = null;
      if (e.pointerId !== modePtr) return;
      const cancelled = e.type === 'pointercancel';
      if (mode === 'shard' && held) {
        const s = held; held = null;
        if (cancelled || !trySnap(s)) { if (s.state === 'held') s.state = 'loose'; }
        else selected = null;
      } else if (mode === 'paint') {
        paint.active = false; audio.flowStop();
        bridgeGaps();
      } else if (mode === 'turn') {
        if (turnLast && performance.now() - turnLast.t > 80) yawVel = 0;
        if (p && Math.hypot(p.x - p.sx, p.y - p.sy) < 6 && state === 'assembly') selected = null;
      }
      mode = 'none'; modePtr = -1; turnLast = null;
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'lostpointercapture', e => { if (pointers.has(e.pointerId)) onUp({ pointerId: e.pointerId, type: 'pointercancel' }); });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    ctx.listen(canvas, 'wheel', e => {
      if (state !== 'assembly') return;
      const s = held || selected;
      if (s && rotationOn()) { e.preventDefault(); s.roll += Math.sign(e.deltaY) * deg(6); }
    }, { passive: false });
    ctx.listen(window, 'keydown', e => {
      const s = held || selected;
      if (state === 'assembly' && s && rotationOn() && (e.key === 'q' || e.key === 'e' || e.key === 'Q' || e.key === 'E')) s.roll += (e.key.toLowerCase() === 'e' ? 1 : -1) * deg(5);
    });

    // ---------- the overlay: rotation ring and quiet cues
    let ringAlpha = 0;
    let overlayDirty = true;
    function drawOverlay(dt) {
      const s = state === 'assembly' && rotationOn() ? (held || selected) : null;
      const target = s && s.state !== 'snapping' ? (held ? 0.35 : 1) : 0;
      ringAlpha += (target - ringAlpha) * (1 - Math.exp(-dt * 10));
      if (overlayDirty) { g2.clearRect(0, 0, ctx.width, ctx.height); overlayDirty = false; }
      if (ringAlpha <= 0.01) return;
      overlayDirty = true;
      if (ringAlpha > 0.01 && (s || ringLast)) {
        const t = s || ringLast;
        if (s) ringLast = s;
        if (t.state === 'placed') { ringLast = null; return; }
        const k = ringKnob(t), R = ringRadius(t);
        g2.save();
        g2.globalAlpha = ringAlpha;
        g2.strokeStyle = 'rgba(236,228,214,0.32)'; g2.lineWidth = 1;
        g2.beginPath(); g2.arc(k[2], k[3], R, 0, TAU); g2.stroke();
        // a short arc either side of the knob says "turn"
        const a = t.roll - Math.PI / 2;
        g2.strokeStyle = 'rgba(236,228,214,0.75)'; g2.lineWidth = 1.5;
        g2.beginPath(); g2.arc(k[2], k[3], R, a - 0.32, a + 0.32); g2.stroke();
        g2.fillStyle = 'rgba(242,236,224,0.95)';
        g2.beginPath(); g2.arc(k[0], k[1], 4.5, 0, TAU); g2.fill();
        g2.strokeStyle = 'rgba(242,236,224,0.25)'; g2.lineWidth = 1;
        g2.beginPath(); g2.arc(k[0], k[1], 11, 0, TAU); g2.stroke();
        g2.restore();
      }
    }
    let ringLast = null;

    // ---------- resize
    ctx.onResize(() => {
      if (!renderer) return;
      renderer.setSize(ctx.width, ctx.height, false);
      backdrop.material.uniforms.uAspect.value = ctx.width / ctx.height;
      if (!lv) return;
      const ph = state === 'assembly' || state === 'breaking' ? 'assembly' : state === 'results' || state === 'reveal' ? 'results' : 'intro';
      frame(ph);
      if (state === 'assembly' || state === 'breaking') { updateCamera(1); trayLayout(); }
    }, { immediate: false, debounceMs: 60 });

    // ---------- main loop
    const perfDt = []; let perfSkip = 0;
    function update(dtMs) {
      if (paused || !lv) return;
      const dt = Math.min(0.05, dtMs / 1000);
      stateT += dt;
      shared.uTime.value += dt;
      // adaptive resolution
      if (perfSkip > 0) perfSkip--; else if (!DEV || !window.__KG_PR) {
        perfDt.push(dtMs);
        if (perfDt.length >= 60) {
          perfDt.sort((a, b) => a - b);
          const med = perfDt[30];
          perfDt.length = 0;
          if (med > 21 && pixelRatio > 1) { pixelRatio = Math.max(1, Math.round((pixelRatio - 0.25) * 4) / 4); renderer.setPixelRatio(pixelRatio); renderer.setSize(ctx.width, ctx.height, false); perfSkip = 20; }
        }
      }
      // turntable
      if (mode !== 'turn') {
        if (yawTarget !== null) { const d = wrapAngle(yawTarget - yaw); yaw += d * (1 - Math.exp(-dt * 7)); if (Math.abs(d) < 0.0005) yawTarget = null; yawVel = 0; }
        else { yaw += yawVel * dt; yawVel *= Math.exp(-dt * 3.2); if (Math.abs(yawVel) < 0.002) yawVel = 0; }
      }
      // gentle invitation before the first touch
      let tremble = 0;
      if (state === 'intro') {
        if (waitingTouch) { const ph = stateT % 2.4; tremble = ph < 0.22 ? Math.sin(ph * 90) * 0.006 * (1 - ph / 0.22) : 0; if (stateT > 6) startBreak(); }
        else if (stateT > 1.7) startBreak();
      }
      turn.rotation.y = yaw + tremble;
      turn.updateMatrixWorld();
      updateCamera(dt);

      if (state === 'breaking') {
        let all = true;
        for (const s of shards) if (s.state === 'flying') { stepFlight(s, dt); all = false; }
        // hairlines vanish once the pieces part
        if (stateT > 0.35) for (const se of seams) se.hair.visible = shards[se.a].state === 'placed' && shards[se.b].state === 'placed';
        if (all) { state = 'assembly'; stateT = 0; lastInteract = 0; }
      }
      if (state === 'assembly' || state === 'assembled') {
        for (const s of shards) {
          if (s.state === 'held' || s.state === 'loose') updateLooseShard(s, dt);
          else if (s.state === 'snapping') stepSnap(s, dt);
          // ghost of the place, only for the piece in hand or selected
          const want = (s === held || s === selected) && s.state !== 'placed' ? lerp(0.42, 0.2, levelIndex / (LEVELS.length - 1)) : (s.hint > 0 ? 0.18 * s.hint : 0);
          s.outline.opacity += (want - s.outline.opacity) * (1 - Math.exp(-dt * 8));
        }
        // rotation demo, once: the piece turns a little by itself, then back
        if (held && held.rotDemo !== undefined && held.rotDemo < 1) {
          held.rotDemo += dt / 1.1;
          held.roll += Math.cos(held.rotDemo * TAU) * dt * 0.9;
          if (held.rotDemo >= 1) { held.rotDemo = 1; markSeen('rotate'); }
        }
        // if a piece belongs round the back, the object shows that it turns
        if (held && levelIndex >= 3 && !seen.turn) {
          const e = Math.abs(wrapAngle(yaw + held.phi));
          held.backT = (held.backT || 0) + (e > deg(55) ? dt : -dt);
          if (held.backT > 1.2) { yawVel = -Math.sign(wrapAngle(yaw + held.phi)) * 0.9; held.backT = -2; markSeen('turn'); }
        }
        // a quiet hint after a long pause
        if (state === 'assembly' && !held && stateT - lastInteract > (seen.intro ? 9 : 3.5)) {
          const cand = shards.find(s => s.state === 'loose');
          if (cand) cand.hint = Math.min(1, cand.hint + dt);
        }
        if (state === 'assembled' && stateT > 0.5) beginGold();
      }
      for (const s of shards) if (s.outline.pulse >= 0) { s.outline.pulse += dt / 0.65; if (s.outline.pulse > 1) s.outline.pulse = -1; }
      if (state === 'gold') {
        if (paint.active) paintStep(dt);
        ui.gold(gold / goldMax, true);
        const allDone = seams.every(s => s.done);
        if (allDone) { goldEndT += dt; if (goldEndT > 0.9) beginReveal(); }
        else if (gold <= 1e-4) { goldEndT += dt; if (goldEndT > 1.6 && !paint.active) beginReveal(); }
        else goldEndT = 0;
        // teach once: a bead of gold runs along a crack until the first stroke
        demoT = !seen.gold && stats.strokes === 0 ? demoT + dt : -1;
      }
      if (state === 'reveal') {
        revealT += dt;
        shared.uSettle.value = smooth(revealT / 1.2);
        const t = clamp01((revealT - 0.6) / 9.0);
        if (!userTurned) { yaw = revealYaw0 + easeInOutCubic(t) * TAU; yawVel = 0; yawTarget = null; }
        scene.environmentRotation.y = Math.sin(clamp01(revealT / 7) * Math.PI) * 0.9;
        backdrop.material.uniforms.uLight.value = 1 + smooth(revealT / 2) * 0.25;
        if (revealT > 3.4) showResults();
      }
      if (state === 'results') {
        if (revealT < 9.6) { revealT += dt; const t = clamp01((revealT - 0.6) / 9.0); if (!userTurned) yaw = revealYaw0 + easeInOutCubic(t) * TAU; }
        scene.environmentRotation.y = Math.sin(clamp01(revealT / 7) * Math.PI) * 0.9;
      }
      updateSpills(dt);
      // upload changed gold
      for (const s of seams) if (s.dirty) flushGold(s);
      for (const s of shards) {
        const o = s.outline;
        o.mat.uniforms.uOpacity.value = o.opacity; o.mat.uniforms.uTime.value = shared.uTime.value; o.mat.uniforms.uPulse.value = o.pulse;
        o.mesh.visible = o.opacity > 0.004 || o.pulse >= 0;
      }
      backdrop.material.uniforms.uTime.value = shared.uTime.value;
      drawOverlay(dt);
      drawDemo();
    }
    let goldEndT = 0, demoT = -1;
    const demoBead = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), spillMat);
    demoBead.visible = false; turn.add(demoBead);
    function drawDemo() {
      if (state !== 'gold' || demoT < 1.0) { demoBead.visible = false; return; }
      // the longest seam facing the viewer
      if (!demoSeam || demoSeam.done) {
        let best = null, bs = -1;
        for (const s of seams) {
          const m = s.n >> 1;
          const nx = s.no[m * 3], nz = s.no[m * 3 + 2];
          const face = Math.cos(yaw) * nz - Math.sin(yaw) * nx;
          const sc = s.len * (face > 0.3 ? 1 : 0);
          if (sc > bs) { bs = sc; best = s; }
        }
        demoSeam = best;
      }
      if (!demoSeam) return;
      const ph = ((demoT - 1.0) % 2.6) / 1.6;
      if (ph > 1) { demoBead.visible = false; return; }
      const span = Math.min(demoSeam.n - 1, Math.round(0.16 / demoSeam.step));
      const m0 = Math.max(0, (demoSeam.n >> 1) - (span >> 1));
      const m = Math.min(demoSeam.n - 1, m0 + Math.round(easeInOutCubic(ph) * span));
      demoBead.visible = true;
      const r = 0.0075 * Math.sin(Math.PI * clamp01(ph * 1.2)) + 0.002;
      demoBead.position.set(demoSeam.po[m * 3] + demoSeam.no[m * 3] * 0.004, demoSeam.po[m * 3 + 1] + demoSeam.no[m * 3 + 1] * 0.004, demoSeam.po[m * 3 + 2] + demoSeam.no[m * 3 + 2] * 0.004);
      demoBead.scale.set(r, r, r);
    }
    let demoSeam = null;
    function beginGold() {
      state = 'gold'; stateT = 0; goldEndT = 0; demoSeam = null;
      for (const se of seams) se.hair.visible = true;
      for (const s of shards) s.outline.opacity = 0;
      selected = null; held = null;
      frame('intro');
      yawTarget = 0;
      audio.bed(0.35);
      ui.gold(1, true);
    }

    let shadowSig = '', shadowYaw = 0, shadowFrame = 0;
    function render() {
      renderer.clear();
      camera.layers.set(0);
      // shadows only re-render when something that casts them moved
      // (immediately when pieces change, every third frame while the object turns)
      let placedN = 0, loose = false;
      for (const x of shards) { if (x.state === 'placed') placedN++; else loose = true; }
      const sig = placedN + ':' + loadSerial;
      shadowFrame++;
      if (sig !== shadowSig) { shadowSig = sig; shadowYaw = turn.rotation.y; renderer.shadowMap.needsUpdate = true; }
      else if (turn.rotation.y !== shadowYaw && (shadowFrame % 3 === 0 || Math.abs(turn.rotation.y - shadowYaw) < 0.002)) { shadowYaw = turn.rotation.y; renderer.shadowMap.needsUpdate = true; }
      renderer.render(scene, camera);
      if (loose) {
        renderer.clearDepth();
        camera.layers.set(1);
        renderer.render(scene, camera);
        camera.layers.set(0);
      }
    }

    // ---------- start
    await Promise.race([progressLoad, new Promise(r => ctx.timeout(r, 1200))]);
    if (disposed) return;
    levelIndex = clamp(save.unlocked - 1, 0, LEVELS.length - 1);
    if (save.best[LEVELS[levelIndex].obj] > 0 && levelIndex < LEVELS.length - 1) levelIndex = Math.min(LEVELS.length - 1, levelIndex);
    backdrop.material.uniforms.uAspect.value = ctx.width / ctx.height;
    loadLevel(levelIndex);
    updateCamera(1);
    render();
    gameReady = true;
    ctx.markVisualReady('first-frame');
    ctx.platform.ready();
    loop = ctx.game.loop({ update, render: () => { if (!paused) render(); } });
    function visibleAt(x, y, local) { const h = rayObject(x, y); if (!h) return false; return turn.worldToLocal(h.point.clone()).distanceTo(local) < 0.03; }
    function seamPts(si) {
      const s = seams[si], outp = [], T = def.thick;
      const camL = turn.worldToLocal(camera.position.clone());
      for (let m = 0; m < s.n; m++) {
        const p = new THREE.Vector3(s.po[m * 3], s.po[m * 3 + 1], s.po[m * 3 + 2]);
        const n = new THREE.Vector3(s.no[m * 3], s.no[m * 3 + 1], s.no[m * 3 + 2]);
        const toC = camL.clone().sub(p).normalize();
        let side = 0, f = n.dot(toC);
        if (f < 0.15) { side = 1; p.addScaledVector(n, -T); f = -f; }
        const w = turn.localToWorld(p.clone());
        const sc = toScreen(w, [0, 0, 0]);
        const vis = f > 0.2 && visibleAt(sc[0], sc[1], p) ? f : 0;
        outp.push([sc[0], sc[1], vis, side, s.fill[m] >= 0 ? 1 : 0]);
      }
      return outp;
    }
    function autoAssemble() {
      if (state === 'intro') startBreak();
      for (const sh of shards) if (!sh.anchor && sh.state !== 'placed') { placeShard(sh); stats.placeQ.push(1); }
      for (const se of seams) se.hair.visible = true;
      state = 'assembled'; stateT = 0;
    }
    function autoGold(dev, frac) {
      let k = 0;
      for (const se of seams) { const lim = Math.floor(se.n * (frac == null ? 1 : frac)); for (let m = 0; m < lim; m++) { const used = fillSample(se, m, dev, 0.002 * (k++)); gold -= used; goldUsed += used * (1 + dev * 0.6); } if (se.filled >= se.n) completeSeam(se); }
    }
    if (DEV) window.__kg = { info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: pixelRatio, programs: renderer.info.programs.length }), autoAssemble, autoGold, seamPts, area: () => area(), get state() { return state; }, shards: () => shards, seams: () => seams, lv: () => lv, startBreak, goLevel, errors, toScreen: v => toScreen(v, [0, 0, 0]), targetWorld: s => targetWorld(s, new THREE.Vector3()), camera, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, gold: () => [gold, goldMax], score: () => resultInfo, stats: () => stats, rayObject, turn, THREE, seen, objPx };
    await fontP;
  }
};

})();
