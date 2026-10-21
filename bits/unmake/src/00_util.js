// =====================================================================
// UNMAKE — shared math. Vectors are [x, y, z] arrays, quaternions [x, y, z, w].
// World axes: x = across the route, y = up, -z = the way forward.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

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
const vNorm = a => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const vAddS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

const QI = () => [0, 0, 0, 1];
function qAxis(axis, ang) { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; }
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qConj = q => [-q[0], -q[1], -q[2], q[3]];
function qRot(q, v) {
  const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

// Closest point on segment ab to point p.
function closestOnSeg(a, b, p) {
  const ab = vSub(b, a);
  const t = clamp(vDot(vSub(p, a), ab) / (vDot(ab, ab) || 1e-9), 0, 1);
  return vAddS(a, ab, t);
}
// Closest distance between a ray (o, unit d, length L) and segment ab; returns {dist, t}.
function raySegDist(o, d, L, a, b) {
  const u = d, v = vSub(b, a), w = vSub(o, a);
  const A = 1, B = vDot(u, v), C = vDot(v, v), D = vDot(u, w), E = vDot(v, w);
  const den = A * C - B * B;
  let sc, tc;
  if (den < 1e-8) { sc = 0; tc = C > 0 ? E / C : 0; }
  else { sc = (B * E - C * D) / den; tc = (A * E - B * D) / den; }
  sc = clamp(sc, 0, L); tc = clamp(tc, 0, 1);
  // re-project once for stability after clamping
  sc = clamp(vDot(vSub(vAddS(a, v, tc), o), u), 0, L);
  const p = vAddS(o, u, sc), q = vAddS(a, v, tc);
  return { dist: vLen(vSub(p, q)), t: sc, point: q };
}
