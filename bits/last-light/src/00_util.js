// =====================================================================
// Small helpers shared by every system. World units are metres, y up,
// time in seconds unless a name says otherwise.
// =====================================================================
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sign = v => v < 0 ? -1 : 1;
const approach = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
const smooth = t => t * t * (3 - 2 * t);
const angNorm = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const deg = d => d * Math.PI / 180;

// Deterministic random, so the city is drawn the same way every visit.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  const f = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}

// Ray (ox,oy)+(dx,dy)*t against segment a-b. Returns t >= 0 or Infinity.
function raySeg(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = ax - ox, fy = ay - oy;
  const t = (fx * ey - fy * ex) / den;
  const u = (fx * dy - fy * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
