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
