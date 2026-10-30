// Shared helpers: maths, seeded randomness, value noise and the winding trail.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const rrange = (r, a, b) => a + (b - a) * r();
const rpick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

function hash2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15; }

// The trail. Distance along it is s (metres travelled); the world runs toward -z.
const TRAIL = {
  x(s) { return 3.1 * Math.sin(s * 0.017) + 1.5 * Math.sin(s * 0.043 + 1.3) + 0.55 * Math.sin(s * 0.11 + 0.4); },
  dx(s) { return 3.1 * 0.017 * Math.cos(s * 0.017) + 1.5 * 0.043 * Math.cos(s * 0.043 + 1.3) + 0.55 * 0.11 * Math.cos(s * 0.11 + 0.4); },
  // heading of travel as a yaw (0 = facing -z)
  yaw(s) { return Math.atan2(-TRAIL.dx(s), 1); }
};
// world position of (s, lateral u)
function trailPoint(s, u, out) {
  const h = TRAIL.dx(s), n = Math.hypot(h, 1);
  // perpendicular to the direction of travel (dx/ds, -1) is (1, dx/ds)/n
  out.x = TRAIL.x(s) + u / n; out.z = -s + (u * h) / n;
  return out;
}

// Ground height: flat on and near the trail, rolling away from it, dipping into ravines.
const RAVINES = [];
function groundY(x, z) {
  const s = -z, off = Math.abs(x - TRAIL.x(s));
  let y = smooth((off - 4.5) / 9) * (fbm(x * 0.06, z * 0.06) * 3.2 - 0.6);
  y += (fbm(x * 0.4, z * 0.4) - 0.5) * 0.12;
  for (let i = 0; i < RAVINES.length; i++) {
    const r = RAVINES[i], d = Math.abs(s - r.s);
    if (d < r.half + 2) y -= smooth(1 - (d - r.half + 1.4) / 2.4) * 2.6;
  }
  return y;
}

// The forest's four stages, blended by distance.
const STAGES = [
  { at: 0, name: 'The Forgotten Woods', fog: '#1b2342', fogNear: 16, fogFar: 98, sky: '#2c3766', zen: '#070a1a', hemi: 0.85, moon: 1.8, trees: 20, twist: 0.12, dead: 0.1, hideGap: [30, 42], obsGap: [70, 95], halfW: 2.7, lantern: 0.55, struct: 0.25, apparition: 0.35 },
  { at: 380, name: 'The Hollow Forest', fog: '#161b35', fogNear: 11, fogFar: 78, sky: '#232a52', zen: '#05071a', hemi: 0.72, moon: 1.55, trees: 27, twist: 0.25, dead: 0.2, hideGap: [26, 40], obsGap: [52, 78], halfW: 2.5, lantern: 0.35, struct: 0.35, apparition: 0.6 },
  { at: 950, name: 'The Cursed Grounds', fog: '#1a1631', fogNear: 9, fogFar: 64, sky: '#2a2148', zen: '#070514', hemi: 0.62, moon: 1.35, trees: 30, twist: 0.45, dead: 0.35, hideGap: [32, 50], obsGap: [38, 60], halfW: 2.2, lantern: 0.25, struct: 0.6, apparition: 0.8 },
  { at: 1700, name: 'The Deep Dark', fog: '#0c0d1b', fogNear: 5, fogFar: 46, sky: '#141633', zen: '#020208', hemi: 0.5, moon: 1.1, trees: 33, twist: 0.6, dead: 0.5, hideGap: [38, 60], obsGap: [30, 48], halfW: 2.0, lantern: 0.15, struct: 0.45, apparition: 1.0 }
];
function stageIndex(s) { let i = 0; while (i < STAGES.length - 1 && s >= STAGES[i + 1].at) i++; return i; }
// numeric stage parameter blended over the 120 m before each boundary
function stageParam(s, key) {
  const i = stageIndex(s), a = STAGES[i], b = STAGES[i + 1];
  if (!b) return a[key];
  const t = smooth((s - (b.at - 120)) / 120);
  return lerp(a[key], b[key], t);
}
function stageMix(s) { const i = stageIndex(s), b = STAGES[i + 1]; return { i, t: b ? smooth((s - (b.at - 120)) / 120) : 0 }; }
// overall difficulty: 0 at the start, 1 by 2.2 km, creeping past it in the Deep Dark
const difficultyAt = s => s < 2200 ? s / 2200 : Math.min(1.3, 1 + (s - 2200) / 4000);
