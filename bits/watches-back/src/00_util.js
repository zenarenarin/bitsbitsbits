// =====================================================================
// THE THING THAT WATCHES BACK — shared math.
// World axes: x = right, y = up, z = toward the camera (down the screen).
// "Forward" for a route is -z. Arc angles are atan2(z - cz, x - cx).
// Vectors in the simulation are plain [x, y, z] arrays.
// =====================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

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

const v3 = (x, y, z) => [x || 0, y || 0, z || 0];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vLen = a => Math.hypot(a[0], a[1], a[2]);
const vDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vNorm = a => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const vAddS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const vCopy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
const angleBetween = (a, b) => Math.acos(clamp(vDot(a, b) / ((vLen(a) * vLen(b)) || 1), -1, 1));
// Direction from yaw (around y) and pitch (positive = up). yaw 0 = +x, yaw PI/2 = +z.
const dirYP = (yaw, pitch) => [Math.cos(yaw) * Math.cos(pitch || 0), Math.sin(pitch || 0), Math.sin(yaw) * Math.cos(pitch || 0)];
const yawOf = d => Math.atan2(d[2], d[0]);
const pitchOf = d => Math.atan2(d[1], Math.hypot(d[0], d[2]));

// Rotate unit vector `a` toward unit vector `b` by at most `maxAng` radians (slerp-like).
function rotateToward(a, b, maxAng) {
  const ang = angleBetween(a, b);
  if (ang <= maxAng || ang < 1e-6) return vNorm(b);
  const t = maxAng / ang;
  // spherical interpolation
  const s = Math.sin(ang);
  const w0 = Math.sin((1 - t) * ang) / s, w1 = Math.sin(t * ang) / s;
  if (!isFinite(w0) || !isFinite(w1)) return vNorm(vLerp(a, b, t));
  return vNorm([a[0] * w0 + b[0] * w1, a[1] * w0 + b[1] * w1, a[2] * w0 + b[2] * w1]);
}
// Clamp unit direction `d` to within `maxDev` of `axis`.
function clampCone(d, axis, maxDev) {
  const ang = angleBetween(d, axis);
  if (ang <= maxDev) return d;
  return rotateToward(axis, d, maxDev);
}
// 2D helpers on xz
const rot2 = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, x * s + z * c]; };
const angIn = (a, a0, a1) => { // is angle a within arc a0..a1 (counter-clockwise from a0, in atan2 sense)
  if (a1 - a0 >= TAU - 1e-6) return true;
  const span = wrapPos(a1 - a0);
  return wrapPos(a - a0) <= span;
};
const wrapPos = a => { a = a % TAU; return a < 0 ? a + TAU : a; };

// Segment (2D) vs circle: returns list of t in [0,1] where |p(t)-c| = r
function segCircleT(ax, az, bx, bz, cx, cz, r, out) {
  const dx = bx - ax, dz = bz - az, fx = ax - cx, fz = az - cz;
  const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r;
  const D = B * B - 4 * A * C;
  if (A < 1e-12 || D < 0) return out;
  const sq = Math.sqrt(D);
  const t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
  if (t1 >= 0 && t1 <= 1) out.push(t1);
  if (t2 >= 0 && t2 <= 1) out.push(t2);
  return out;
}
