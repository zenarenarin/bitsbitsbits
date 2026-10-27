// =====================================================================
// THE THING THAT WATCHES BACK — shared math.
// World plane: x right, y up (screen up). Angles are radians, CCW from +x.
// =====================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
// wrap to (-PI, PI]
const wrap = a => { a = a % TAU; if (a > Math.PI) a -= TAU; else if (a <= -Math.PI) a += TAU; return a; };
// wrap to [0, TAU)
const wrap0 = a => { a = a % TAU; return a < 0 ? a + TAU : a; };
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

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
  return r;
}

const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Distance from point p to segment ab, plus the parameter t along ab.
function segPointDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return { d: Math.hypot(ax + dx * t - px, ay + dy * t - py), t };
}

// Parameters t in [0,1] where segment ab crosses the circle of radius r about the origin.
function segCircle(ax, ay, bx, by, r, out) {
  out.length = 0;
  const dx = bx - ax, dy = by - ay;
  const A = dx * dx + dy * dy, B = 2 * (ax * dx + ay * dy), C = ax * ax + ay * ay - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < 0) return out;
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A), t2 = (-B + s) / (2 * A);
  if (t1 > 1e-6 && t1 < 1 - 1e-6) out.push(t1);
  if (t2 > 1e-6 && t2 < 1 - 1e-6) out.push(t2);
  return out;
}

// is angle x inside the CCW arc that starts at a0 and spans to a1?
function inArc(x, a0, a1) {
  const span = wrap0(a1 - a0);
  return wrap0(x - a0) <= span;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const roman = n => ROMAN[n] || String(n);
