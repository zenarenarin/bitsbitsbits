// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// ONE LAST THING — a 3D drawer-packing puzzle for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Small shared helpers: seeded random, value noise, vector and quaternion maths on plain arrays.
// Units everywhere in the simulation are centimetres. +Y is up. The drawer front faces +Z.

const U = (() => {
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    const f = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.sign = () => (f() < 0.5 ? -1 : 1);
    f.shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    return f;
  }
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 1D/2D/3D value noise, smooth, deterministic.
  function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
      l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
  }
  const noise2 = (x, y) => noise3(x, y, 0.5);
  function fbm2(x, y, oct = 4) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2; a *= 0.5; } return s; }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Quaternions as [x, y, z, w].
  const qIdent = () => [0, 0, 0, 1];
  function qMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function qAxis(ax, ay, az, ang) {
    const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(ang / 2);
    return [ax / l * s, ay / l * s, az / l * s, Math.cos(ang / 2)];
  }
  function qNorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function qEuler(x, y, z) { return qMul(qMul(qAxis(0, 1, 0, y), qAxis(1, 0, 0, x)), qAxis(0, 0, 1, z)); }
  function qRot(q, v) { // rotate vector v by quaternion q
    const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
  }
  function qToMat(q, m) { // row-major 3x3
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    m[0] = 1 - (yy + zz); m[1] = xy - wz; m[2] = xz + wy;
    m[3] = xy + wz; m[4] = 1 - (xx + zz); m[5] = yz - wx;
    m[6] = xz - wy; m[7] = yz + wx; m[8] = 1 - (xx + yy);
    return m;
  }
  function qSlerp(a, b, t) {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (cos < 0) { cos = -cos; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (cos > 0.9995) return qNorm([lerp(a[0], bb[0], t), lerp(a[1], bb[1], t), lerp(a[2], bb[2], t), lerp(a[3], bb[3], t)]);
    const th = Math.acos(cos), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  }
  // Snap a quaternion to the nearest of the 24 axis-aligned orientations.
  const AXIS24 = (() => {
    const out = [], seen = new Set();
    const base = [qIdent(), qAxis(1, 0, 0, Math.PI / 2), qAxis(1, 0, 0, Math.PI), qAxis(1, 0, 0, -Math.PI / 2), qAxis(0, 0, 1, Math.PI / 2), qAxis(0, 0, 1, -Math.PI / 2)];
    for (const b of base) for (let k = 0; k < 4; k++) {
      const q = qNorm(qMul(qAxis(0, 1, 0, k * Math.PI / 2), b));
      const key = qToMat(q, new Array(9)).map(v => Math.round(v)).join(',');
      if (!seen.has(key)) { seen.add(key); out.push(q); }
    }
    return out;
  })();
  function qAngleBetween(a, b) { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, d)); }

  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  };

  return { rng, hashStr, noise2, noise3, fbm2, clamp, lerp, smooth, easeOut, easeInOut, qIdent, qMul, qAxis, qNorm, qEuler, qRot, qToMat, qSlerp, qAngleBetween, AXIS24, v3 };
})();

// ---- 01_geom.js ----
// Convex collision primitives and an exact GJK distance query.
//
// Every object is a compound of convex parts that follow its visible geometry closely
// (lathe profiles become stacks of frusta, handles become capsule chains, wonky boxes
// become point hulls). A part is described in object space and turned into a world
// "instance" that knows its rotation matrix, translation, scale and bounding box.

const G = (() => {
  const { qToMat, qMul, qRot } = U;

  // ---- local (unscaled) support functions; write into o[0..2] ----
  function supBox(p, x, y, z, o) { o[0] = x >= 0 ? p.h[0] : -p.h[0]; o[1] = y >= 0 ? p.h[1] : -p.h[1]; o[2] = z >= 0 ? p.h[2] : -p.h[2]; }
  function supHull(p, x, y, z, o) {
    const pts = p.pts; let best = -Infinity, bi = 0;
    for (let i = 0; i < pts.length; i++) { const q = pts[i]; const d = q[0] * x + q[1] * y + q[2] * z; if (d > best) { best = d; bi = i; } }
    const q = pts[bi]; o[0] = q[0]; o[1] = q[1]; o[2] = q[2];
  }
  function supFr(p, x, y, z, o) {
    const l = Math.hypot(x, z), hh = p.h / 2;
    let cx = 0, cz = 0; if (l > 1e-12) { cx = x / l; cz = z / l; }
    const top = p.r1 * (cx * x + cz * z) + hh * y, bot = p.r0 * (cx * x + cz * z) - hh * y;
    if (top >= bot) { o[0] = p.r1 * cx; o[1] = hh; o[2] = p.r1 * cz; } else { o[0] = p.r0 * cx; o[1] = -hh; o[2] = p.r0 * cz; }
  }
  function supSph(p, x, y, z, o) { const l = Math.hypot(x, y, z) || 1, r = p.r || 1; o[0] = x / l * r; o[1] = y / l * r; o[2] = z / l * r; }
  function supCap(p, x, y, z, o) {
    const a = p.a, b = p.b, da = a[0] * x + a[1] * y + a[2] * z, db = b[0] * x + b[1] * y + b[2] * z;
    const e = da >= db ? a : b, l = Math.hypot(x, y, z) || 1;
    o[0] = e[0] + x / l * p.r; o[1] = e[1] + y / l * p.r; o[2] = e[2] + z / l * p.r;
  }
  const SUP = { box: supBox, hull: supHull, fr: supFr, sph: supSph, cap: supCap };

  // Volume and centroid (object space, before the part transform) for centre-of-mass estimates.
  function partMass(p) {
    const s = p.s || [1, 1, 1], sv = s[0] * s[1] * s[2];
    let vol = 1, c = [0, 0, 0];
    switch (p.t) {
      case 'box': vol = 8 * p.h[0] * p.h[1] * p.h[2]; break;
      case 'hull': {
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], m = [0, 0, 0];
        for (const q of p.pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); m[k] += q[k] / p.pts.length; }
        vol = (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]) * 0.6; c = m; break;
      }
      case 'fr': {
        const a = p.r0, b = p.r1, h = p.h, den = a * a + a * b + b * b;
        vol = Math.PI * h * den / 3; c = [0, den > 0 ? -h / 2 + h * (a * a + 2 * a * b + 3 * b * b) / (4 * den) : 0, 0]; break;
      }
      case 'sph': { const r = p.r || 1; vol = 4 / 3 * Math.PI * r * r * r; break; }
      case 'cap': { const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]); vol = Math.PI * p.r * p.r * L + 4 / 3 * Math.PI * p.r ** 3; c = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2]; break; }
    }
    c = [c[0] * s[0], c[1] * s[1], c[2] * s[2]];
    const q = p.q || [0, 0, 0, 1], pp = p.p || [0, 0, 0];
    const w = qRot(q, c);
    return { vol: vol * sv * (p.density || 1), c: [w[0] + pp[0], w[1] + pp[1], w[2] + pp[2]] };
  }

  // ---- world instance of a part ----
  function makeInst(part, owner) {
    return { part, owner, sup0: SUP[part.t], R: new Float64Array(9), T: new Float64Array(3), S: part.s || [1, 1, 1], box: new Float64Array(6), tmp: new Float64Array(3) };
  }
  const _m = new Array(9);
  // Place an instance given the object's pose (position p, quaternion q).
  function poseInst(inst, p, q) {
    const part = inst.part, qq = qMul(q, part.q || [0, 0, 0, 1]);
    qToMat(qq, _m); for (let i = 0; i < 9; i++) inst.R[i] = _m[i];
    const lp = part.p ? qRot(q, part.p) : [0, 0, 0];
    inst.T[0] = p[0] + lp[0]; inst.T[1] = p[1] + lp[1]; inst.T[2] = p[2] + lp[2];
    const b = inst.box, o = inst.tmp2 || (inst.tmp2 = new Float64Array(3));
    sup(inst, 1, 0, 0, o); b[3] = o[0]; sup(inst, -1, 0, 0, o); b[0] = o[0];
    sup(inst, 0, 1, 0, o); b[4] = o[1]; sup(inst, 0, -1, 0, o); b[1] = o[1];
    sup(inst, 0, 0, 1, o); b[5] = o[2]; sup(inst, 0, 0, -1, o); b[2] = o[2];
  }
  // World support point of an instance in world direction (x, y, z).
  function sup(inst, x, y, z, o) {
    const R = inst.R, S = inst.S, t = inst.tmp;
    // local dir = R^T d, then scaled
    const lx = (R[0] * x + R[3] * y + R[6] * z) * S[0], ly = (R[1] * x + R[4] * y + R[7] * z) * S[1], lz = (R[2] * x + R[5] * y + R[8] * z) * S[2];
    inst.sup0(inst.part, lx, ly, lz, t);
    const bx = t[0] * S[0], by = t[1] * S[1], bz = t[2] * S[2];
    o[0] = R[0] * bx + R[1] * by + R[2] * bz + inst.T[0];
    o[1] = R[3] * bx + R[4] * by + R[5] * bz + inst.T[1];
    o[2] = R[6] * bx + R[7] * by + R[8] * bz + inst.T[2];
  }
  // A point treated as a convex shape (for contact sampling).
  function pointShape(p) { return { isPoint: true, P: p }; }
  function supAny(s, x, y, z, o) { if (s.isPoint) { o[0] = s.P[0]; o[1] = s.P[1]; o[2] = s.P[2]; } else sup(s, x, y, z, o); }

  function boxOverlap(a, b, m) {
    return a[0] <= b[3] + m && b[0] <= a[3] + m && a[1] <= b[4] + m && b[1] <= a[4] + m && a[2] <= b[5] + m && b[2] <= a[5] + m;
  }

  // ---- GJK distance with Voronoi-region simplex reduction (allocation free) ----
  // Simplex vertex k: Minkowski point w at SW[3k..], support points on A and B at SA/SB.
  const SW = new Float64Array(12), SA = new Float64Array(12), SB = new Float64Array(12), LAM = new Float64Array(4);
  const KW = new Float64Array(12), KA = new Float64Array(12), KB = new Float64Array(12);
  let N = 0;
  // result of a sub-solver: up to 3 indices and barycentrics
  const RI = new Int32Array(3), RL = new Float64Array(3); let RN = 0;
  const sa = new Float64Array(3), sb = new Float64Array(3);
  function set1(i) { RN = 1; RI[0] = i; RL[0] = 1; }
  function set2(i, j, t) { RN = 2; RI[0] = i; RI[1] = j; RL[0] = 1 - t; RL[1] = t; }
  function solveSeg(i, j) {
    const ax = SW[3 * i], ay = SW[3 * i + 1], az = SW[3 * i + 2];
    const abx = SW[3 * j] - ax, aby = SW[3 * j + 1] - ay, abz = SW[3 * j + 2] - az;
    const den = abx * abx + aby * aby + abz * abz;
    const t = den > 1e-18 ? -(ax * abx + ay * aby + az * abz) / den : 0;
    if (t <= 0) set1(i); else if (t >= 1) set1(j); else set2(i, j, t);
  }
  function solveTri(ia, ib, ic) {
    const ax = SW[3 * ia], ay = SW[3 * ia + 1], az = SW[3 * ia + 2];
    const bx = SW[3 * ib], by = SW[3 * ib + 1], bz = SW[3 * ib + 2];
    const cx = SW[3 * ic], cy = SW[3 * ic + 1], cz = SW[3 * ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const d1 = -(abx * ax + aby * ay + abz * az), d2 = -(acx * ax + acy * ay + acz * az);
    if (d1 <= 0 && d2 <= 0) return set1(ia);
    const d3 = -(abx * bx + aby * by + abz * bz), d4 = -(acx * bx + acy * by + acz * bz);
    if (d3 >= 0 && d4 <= d3) return set1(ib);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return set2(ia, ib, d1 / (d1 - d3));
    const d5 = -(abx * cx + aby * cy + abz * cz), d6 = -(acx * cx + acy * cy + acz * cz);
    if (d6 >= 0 && d5 <= d6) return set1(ic);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return set2(ia, ic, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) return set2(ib, ic, (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    RN = 3; RI[0] = ia; RI[1] = ib; RI[2] = ic; RL[0] = 1 - v - w; RL[1] = v; RL[2] = w;
  }
  function resDist2() { let x = 0, y = 0, z = 0; for (let k = 0; k < RN; k++) { const o = 3 * RI[k], l = RL[k]; x += SW[o] * l; y += SW[o + 1] * l; z += SW[o + 2] * l; } return x * x + y * y + z * z; }
  function outside(ia, ib, ic, id) {
    const ax = SW[3 * ia], ay = SW[3 * ia + 1], az = SW[3 * ia + 2];
    const abx = SW[3 * ib] - ax, aby = SW[3 * ib + 1] - ay, abz = SW[3 * ib + 2] - az;
    const acx = SW[3 * ic] - ax, acy = SW[3 * ic + 1] - ay, acz = SW[3 * ic + 2] - az;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const sp = -(ax * nx + ay * ny + az * nz);
    const sd = (SW[3 * id] - ax) * nx + (SW[3 * id + 1] - ay) * ny + (SW[3 * id + 2] - az) * nz;
    if (Math.abs(sd) < 1e-14) return true;
    return sp * sd < 0;
  }
  const FACES = [[0, 1, 2, 3], [0, 2, 3, 1], [0, 3, 1, 2], [1, 3, 2, 0]];
  const BI = new Int32Array(3), BL = new Float64Array(3);
  function solveTet() { // returns false when the origin is inside
    let bd = Infinity, bn = 0;
    for (const f of FACES) {
      if (!outside(f[0], f[1], f[2], f[3])) continue;
      solveTri(f[0], f[1], f[2]);
      const d = resDist2();
      if (d < bd) { bd = d; bn = RN; for (let k = 0; k < RN; k++) { BI[k] = RI[k]; BL[k] = RL[k]; } }
    }
    if (bd === Infinity) return false;
    RN = bn; for (let k = 0; k < bn; k++) { RI[k] = BI[k]; RL[k] = BL[k]; }
    return true;
  }
  function keep() {
    for (let k = 0; k < RN; k++) { const o = 3 * RI[k]; for (let j = 0; j < 3; j++) { KW[3 * k + j] = SW[o + j]; KA[3 * k + j] = SA[o + j]; KB[3 * k + j] = SB[o + j]; } }
    for (let k = 0; k < RN * 3; k++) { SW[k] = KW[k]; SA[k] = KA[k]; SB[k] = KB[k]; }
    for (let k = 0; k < RN; k++) LAM[k] = RL[k];
    N = RN;
  }

  // Distance between convex shapes A and B. Returns distance (0 when overlapping);
  // writes closest points to res.pa / res.pb when separated.
  const res = { d: 0, pa: new Float64Array(3), pb: new Float64Array(3), iters: 0 };
  function dist(A, B) {
    let dx = 1, dy = 0, dz = 0;
    if (!A.isPoint && !B.isPoint) {
      dx = (A.box[0] + A.box[3] - B.box[0] - B.box[3]); dy = (A.box[1] + A.box[4] - B.box[1] - B.box[4]); dz = (A.box[2] + A.box[5] - B.box[2] - B.box[5]);
    } else if (A.isPoint && !B.isPoint) {
      dx = A.P[0] - (B.box[0] + B.box[3]) / 2; dy = A.P[1] - (B.box[1] + B.box[4]) / 2; dz = A.P[2] - (B.box[2] + B.box[5]) / 2;
    }
    if (dx * dx + dy * dy + dz * dz < 1e-12) { dx = 1; dy = 0; dz = 0; }
    supAny(A, -dx, -dy, -dz, sa); supAny(B, dx, dy, dz, sb);
    for (let j = 0; j < 3; j++) { SA[j] = sa[j]; SB[j] = sb[j]; SW[j] = sa[j] - sb[j]; }
    LAM[0] = 1; N = 1;
    let vx = SW[0], vy = SW[1], vz = SW[2], vv = vx * vx + vy * vy + vz * vz, it = 0;
    for (; it < 48; it++) {
      if (vv < 1e-14) { res.d = 0; res.iters = it; return 0; }
      supAny(A, -vx, -vy, -vz, sa); supAny(B, vx, vy, vz, sb);
      const wx = sa[0] - sb[0], wy = sa[1] - sb[1], wz = sa[2] - sb[2];
      if (vv - (vx * wx + vy * wy + vz * wz) <= vv * 1e-9 + 1e-13) break; // converged
      let dup = false;
      for (let k = 0; k < N; k++) { const o = 3 * k; if (Math.abs(SW[o] - wx) + Math.abs(SW[o + 1] - wy) + Math.abs(SW[o + 2] - wz) < 1e-11) { dup = true; break; } }
      if (dup) break;
      const o = 3 * N;
      SW[o] = wx; SW[o + 1] = wy; SW[o + 2] = wz; SA[o] = sa[0]; SA[o + 1] = sa[1]; SA[o + 2] = sa[2]; SB[o] = sb[0]; SB[o + 1] = sb[1]; SB[o + 2] = sb[2];
      N++;
      if (N === 2) solveSeg(0, 1);
      else if (N === 3) solveTri(0, 1, 2);
      else if (!solveTet()) { res.d = 0; res.iters = it; return 0; }
      keep();
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < N; k++) { const l = LAM[k]; x += SW[3 * k] * l; y += SW[3 * k + 1] * l; z += SW[3 * k + 2] * l; }
      const nvv = x * x + y * y + z * z;
      vx = x; vy = y; vz = z;
      if (nvv >= vv * (1 - 1e-12) && it > 2) { vv = nvv; break; }
      vv = nvv;
    }
    res.iters = it;
    const pa = res.pa, pb = res.pb; pa[0] = pa[1] = pa[2] = pb[0] = pb[1] = pb[2] = 0;
    for (let k = 0; k < N; k++) { const l = LAM[k]; for (let j = 0; j < 3; j++) { pa[j] += SA[3 * k + j] * l; pb[j] += SB[3 * k + j] * l; } }
    res.d = Math.sqrt(vv);
    return res.d;
  }

  return { makeInst, poseInst, sup, supAny, pointShape, dist, res, boxOverlap, partMass };
})();

// ---- 02_world.js ----
// The packing world: drawer volume, bodies, 3D containment, overlap, gravity drop,
// contact sampling, support/stability and quasi-static settling.
// Pure logic (no rendering) so it runs the same in the game, the level solver and the tests.

const World = (() => {
  const { qRot, qMul, qAxis, qNorm, v3 } = U;
  const CONTACT = 0.02;     // stop distance for gravity drop (cm)
  const OVERLAP = 0.004;    // closer than this counts as interpenetration
  const CT = 0.07;          // contact detection band
  const MARGIN = 0.3;       // centre-of-mass tolerance outside the support polygon
  const SLOP = 0.012;       // containment tolerance

  // ---- bodies ----
  function makeBody(id, def, scale = 1) {
    const parts = def.parts.map(p => scalePart(p, scale));
    const insts = parts.map(p => G.makeInst(p, null));
    let m = 0, c = [0, 0, 0];
    for (const p of parts) { const pm = G.partMass(p); m += pm.vol; c = v3.add(c, v3.scale(pm.c, pm.vol)); }
    const body = { id, def, scale, parts, insts, com: v3.scale(c, 1 / (m || 1)), mass: m, p: [0, 0, 0], q: [0, 0, 0, 1], box: new Float64Array(6) };
    for (const i of insts) i.owner = body;
    setPose(body, [0, 0, 0], [0, 0, 0, 1]);
    return body;
  }
  function scalePart(p, s) {
    if (s === 1) return p;
    const o = Object.assign({}, p);
    if (p.p) o.p = p.p.map(v => v * s);
    switch (p.t) {
      case 'box': o.h = p.h.map(v => v * s); break;
      case 'hull': o.pts = p.pts.map(q => q.map(v => v * s)); break;
      case 'fr': o.r0 = p.r0 * s; o.r1 = p.r1 * s; o.h = p.h * s; break;
      case 'sph': o.r = (p.r || 1) * s; break;
      case 'cap': o.a = p.a.map(v => v * s); o.b = p.b.map(v => v * s); o.r = p.r * s; break;
    }
    return o;
  }
  function setPose(body, p, q) {
    body.p = [p[0], p[1], p[2]]; body.q = qNorm(q);
    const b = body.box; b[0] = b[1] = b[2] = Infinity; b[3] = b[4] = b[5] = -Infinity;
    for (const inst of body.insts) {
      G.poseInst(inst, body.p, body.q);
      for (let k = 0; k < 3; k++) { if (inst.box[k] < b[k]) b[k] = inst.box[k]; if (inst.box[k + 3] > b[k + 3]) b[k + 3] = inst.box[k + 3]; }
    }
  }
  function translate(body, dx, dy, dz) {
    body.p[0] += dx; body.p[1] += dy; body.p[2] += dz;
    for (const inst of body.insts) { inst.T[0] += dx; inst.T[1] += dy; inst.T[2] += dz; inst.box[0] += dx; inst.box[3] += dx; inst.box[1] += dy; inst.box[4] += dy; inst.box[2] += dz; inst.box[5] += dz; }
    body.box[0] += dx; body.box[3] += dx; body.box[1] += dy; body.box[4] += dy; body.box[2] += dz; body.box[5] += dz;
  }
  const comW = body => v3.add(body.p, qRot(body.q, body.com));
  const poseOf = body => ({ p: body.p.slice(), q: body.q.slice() });

  // Footprint dims when the body sits at its current orientation.
  function extents(body) { const b = body.box; return [b[3] - b[0], b[4] - b[1], b[5] - b[2]]; }

  // ---- drawer ----
  function makeDrawer(Wd, Dd, Hd) { return { W: Wd, D: Dd, H: Hd, x0: -Wd / 2, x1: Wd / 2, z0: -Dd / 2, z1: Dd / 2 }; }

  // Containment. Returns null when fully inside, else { side, by } of the worst violation.
  function outside(body, dr, ignoreTop) {
    let worst = null, wv = SLOP;
    const chk = (side, v) => { if (v > wv) { wv = v; worst = { side, by: v }; } };
    for (const inst of body.insts) {
      const b = inst.box;
      chk('left', dr.x0 - b[0]); chk('right', b[3] - dr.x1);
      chk('back', dr.z0 - b[2]); chk('front', b[5] - dr.z1);
      chk('floor', -b[1]);
      if (!ignoreTop) chk('top', b[4] - dr.H);
    }
    return worst;
  }

  // First interpenetrating (body, part pair) between `body` and `others`.
  function overlapWith(body, others, eps = OVERLAP) {
    for (const o of others) {
      if (o === body || !G.boxOverlap(body.box, o.box, 0)) continue;
      for (const a of body.insts) {
        if (!G.boxOverlap(a.box, o.box, 0)) continue;
        for (const b of o.insts) {
          if (!G.boxOverlap(a.box, b.box, 0)) continue;
          if (G.dist(a, b) < eps) return o;
        }
      }
    }
    return null;
  }
  function blocked(body, others, dr) { return outside(body, dr, true) || overlapWith(body, others); }

  // ---- gravity drop: conservative advancement, exact for convex pairs under translation ----
  function caDrop(a, b, maxT) {
    const T1 = a.T[1], b1 = a.box[1], b4 = a.box[4];
    let t = 0, out = Infinity;
    for (let i = 0; i < 40; i++) {
      const d = G.dist(a, b);
      if (d < CONTACT) { out = t; break; }
      const r = G.res, ny = (r.pb[1] - r.pa[1]) / d; // n points from a to b; we move along -y
      const rate = -ny;
      if (rate <= 1e-6) break;
      const step = (d - CONTACT * 0.5) / rate;
      t += step; if (t > maxT) break;
      a.T[1] -= step; a.box[1] -= step; a.box[4] -= step;
    }
    a.T[1] = T1; a.box[1] = b1; a.box[4] = b4;
    return out;
  }
  // How far the body can fall straight down. { t, hit } where hit is a body, 'floor', or 'start' (already blocked).
  function dropDistance(body, others) {
    let best = Math.max(0, body.box[1] - CONTACT * 0.5), hit = 'floor';
    for (const inst of body.insts) { const f = inst.box[1] - CONTACT * 0.5; if (f < best) best = Math.max(0, f); }
    for (const o of others) {
      if (o === body) continue;
      const ob = o.box, bb = body.box;
      if (ob[0] > bb[3] || ob[3] < bb[0] || ob[2] > bb[5] || ob[5] < bb[2] || ob[4] < bb[1] - best - 0.01) continue;
      for (const a of body.insts) {
        const ab = a.box;
        for (const b of o.insts) {
          const bx = b.box;
          if (bx[0] > ab[3] || bx[3] < ab[0] || bx[2] > ab[5] || bx[5] < ab[2]) continue;
          if (bx[4] < ab[1] - best - 0.01) continue;
          if (bx[1] > ab[4]) continue;
          const t = caDrop(a, b, best + 0.01);
          if (t < best) { best = t; hit = o; }
        }
      }
    }
    return { t: best, hit };
  }

  // ---- contacts ----
  const _o = new Float64Array(3);
  function perp(n) {
    const a = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    const u = v3.norm(v3.cross(n, a)), v = v3.cross(n, u);
    return [u, v];
  }
  function sampleSide(shape, other, n, out, otherIsFloor) {
    // support points of `shape` in a cone around direction n; keep the ones touching `other`
    const [u, v] = perp(n);
    const dirs = [n];
    for (const spread of [0.45, 1.1]) for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + spread;
      dirs.push(v3.add(n, v3.add(v3.scale(u, Math.cos(a) * spread), v3.scale(v, Math.sin(a) * spread))));
    }
    for (const d of dirs) {
      G.sup(shape, d[0], d[1], d[2], _o);
      const pt = [_o[0], _o[1], _o[2]];
      if (otherIsFloor) { if (pt[1] < CT * 1.6) out.push(pt); }
      else if (G.dist(G.pointShape(pt), other) < CT * 1.6) out.push(pt);
    }
  }
  // Support contacts (normal pointing up into the body) and side contacts.
  function contacts(body, others) {
    const sup = [], side = [], by = new Set();
    for (const a of body.insts) {
      if (a.box[1] < CT) { const pts = []; sampleSide(a, null, [0, -1, 0], pts, true); for (const p of pts) sup.push({ p, n: [0, 1, 0], o: 'floor' }); }
      for (const o of others) {
        if (o === body || !G.boxOverlap(a.box, o.box, CT)) continue;
        for (const b of o.insts) {
          if (!G.boxOverlap(a.box, b.box, CT)) continue;
          const d = G.dist(a, b);
          if (d > CT) continue;
          const r = G.res;
          let n = d > 1e-7 ? [(r.pa[0] - r.pb[0]) / d, (r.pa[1] - r.pb[1]) / d, (r.pa[2] - r.pb[2]) / d] : [0, 1, 0];
          const mid = [(r.pa[0] + r.pb[0]) / 2, (r.pa[1] + r.pb[1]) / 2, (r.pa[2] + r.pb[2]) / 2];
          const list = n[1] > 0.3 ? sup : side;
          const pts = [mid];
          sampleSide(a, b, v3.scale(n, -1), pts, false);
          sampleSide(b, a, n, pts, false);
          for (const p of pts) list.push({ p, n, o });
          if (n[1] > 0.3) by.add(o);
        }
      }
    }
    return { sup, side, supporters: [...by] };
  }

  // ---- support polygon ----
  function hull2(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-9) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function closestOnSeg(p, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
    const t = L > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
    return [a[0] + dx * t, a[1] + dz * t];
  }
  // Returns { inside, d, q } with q the closest hull point to c.
  function hullDist(h, c) {
    if (h.length === 0) return { inside: false, d: Infinity, q: c };
    if (h.length === 1) return { inside: false, d: Math.hypot(c[0] - h[0][0], c[1] - h[0][1]), q: h[0] };
    let inside = h.length >= 3, bd = Infinity, bq = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      if (h.length >= 3 && (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) inside = false;
      const q = closestOnSeg(c, a, b), d = Math.hypot(c[0] - q[0], c[1] - q[1]);
      if (d < bd) { bd = d; bq = q; }
      if (h.length === 2) break;
    }
    return { inside, d: inside ? 0 : bd, q: bq };
  }
  function stability(body, cs) {
    const c = comW(body);
    if (!cs.sup.length) return { stable: false, steep: cs.side.length > 0, c };
    const h = hull2(cs.sup.map(s => [s.p[0], s.p[2]]));
    const hd = hullDist(h, [c[0], c[2]]);
    if (hd.inside || hd.d <= MARGIN) return { stable: true, c, hull: h };
    // pivot: support contact nearest to the closest hull point
    let pv = cs.sup[0].p, pd = Infinity;
    for (const s of cs.sup) { const d = Math.hypot(s.p[0] - hd.q[0], s.p[2] - hd.q[1]); if (d < pd) { pd = d; pv = s.p; } }
    const tip = v3.norm([c[0] - hd.q[0], 0, c[2] - hd.q[1]]);
    return { stable: false, c, tip, pivot: [hd.q[0], pv[1], hd.q[1]], hull: h };
  }

  function rotateAbout(body, pivot, axis, ang) {
    const r = qAxis(axis[0], axis[1], axis[2], ang);
    const rel = qRot(r, v3.sub(body.p, pivot));
    setPose(body, v3.add(pivot, rel), qMul(r, body.q));
  }

  // ---- settle: drop, then tip/slide quasi-statically until supported ----
  // Leaves the body at its final pose. Returns { ok, reason, blocker, frames, supporters }.
  function settle(body, others, dr, opts = {}) {
    const frames = [poseOf(body)];
    const maxIter = opts.maxIter || 70;
    // start pose must be clear (the held object can be lowered into the drawer)
    const out0 = outside(body, dr, true);
    if (out0 && out0.side !== 'floor') return { ok: false, reason: 'outside', side: out0.side, frames };
    const ov0 = overlapWith(body, others);
    if (ov0) return { ok: false, reason: 'overlap', blocker: ov0, frames };
    let turned = 0, lastSup = [];
    for (let it = 0; it < maxIter; it++) {
      const dd = dropDistance(body, others);
      if (dd.t > 1e-5) { translate(body, 0, -dd.t, 0); frames.push(poseOf(body)); }
      const cs = contacts(body, others);
      const st = stability(body, cs);
      lastSup = cs.supporters;
      if (st.stable) return finish(body, others, dr, frames, cs, false);
      if (!st.tip) {
        // only steep contacts: slide downhill a little
        if (!cs.side.length) return { ok: false, reason: 'topple', frames };
        let n = [0, 0, 0]; for (const s of cs.side) n = v3.add(n, s.n);
        const hz = v3.norm([n[0], 0, n[2]]);
        const step = 0.35;
        translate(body, hz[0] * step, 0.01, hz[2] * step);
        if (blocked(body, others, dr)) { translate(body, -hz[0] * step, -0.01, -hz[2] * step); return finish(body, others, dr, frames, cs, true); }
        frames.push(poseOf(body));
        continue;
      }
      // tip about the pivot so the centre of mass moves down and outward
      const axis = v3.norm(v3.cross([0, 1, 0], st.tip));
      let ang = 0.07, done = false;
      const save = poseOf(body);
      while (ang > 0.004) {
        rotateAbout(body, st.pivot, axis, ang);
        translate(body, 0, 0.03, 0);
        if (!blocked(body, others, dr)) { done = true; break; }
        setPose(body, save.p, save.q); ang /= 2;
      }
      if (!done) return finish(body, others, dr, frames, cs, true); // propped against a wall or neighbour
      turned += ang;
      frames.push(poseOf(body));
      if (turned > Math.PI * 0.9) return { ok: false, reason: 'topple', frames };
    }
    return { ok: false, reason: 'topple', frames, supporters: lastSup };
  }
  function finish(body, others, dr, frames, cs, propped) {
    const top = outside(body, dr, false);
    if (top) return { ok: false, reason: top.side === 'top' ? 'tall' : 'outside', side: top.side, frames, settled: true };
    const ov = overlapWith(body, others);
    if (ov) return { ok: false, reason: 'overlap', blocker: ov, frames, settled: true };
    return { ok: true, frames, supporters: cs.supporters, propped };
  }

  // Check a complete arrangement independently of how it was reached.
  function validate(bodies, dr) {
    const problems = [];
    for (const b of bodies) {
      const o = outside(b, dr, false);
      if (o) problems.push({ id: b.id, reason: o.side === 'top' ? 'tall' : 'outside', side: o.side, by: o.by });
      const ov = overlapWith(b, bodies);
      if (ov) problems.push({ id: b.id, reason: 'overlap', with: ov.id });
      const cs = contacts(b, bodies);
      const st = stability(b, cs);
      if (!st.stable) {
        // allow bodies leaning on a neighbour or wall: tipping must be blocked
        const save = poseOf(b);
        let leaning = false;
        if (st.tip) {
          const axis = v3.norm(v3.cross([0, 1, 0], st.tip));
          rotateAbout(b, st.pivot, axis, 0.03); translate(b, 0, 0.03, 0);
          leaning = !!blocked(b, bodies, dr);
          setPose(b, save.p, save.q);
        }
        if (!leaning) problems.push({ id: b.id, reason: 'topple' });
      }
      // must be resting on something
      const dd = dropDistance(b, bodies);
      if (dd.t > CT) problems.push({ id: b.id, reason: 'floating', by: dd.t });
    }
    return problems;
  }

  // Is `b` resting soundly among `others`? (on something, and not able to tip over)
  function supported(b, others, dr) {
    const dd = dropDistance(b, others);
    if (dd.t > CT) return false;
    const st = stability(b, contacts(b, others));
    if (st.stable) return true;
    if (!st.tip) return false;
    const save = poseOf(b), axis = v3.norm(v3.cross([0, 1, 0], st.tip));
    rotateAbout(b, st.pivot, axis, 0.03); translate(b, 0, 0.03, 0);
    const lean = !!(dr ? blocked(b, others, dr) : overlapWith(b, others));
    setPose(b, save.p, save.q);
    return lean;
  }
  // Bodies that would lose their support if `body` were lifted out: protects stacks and leaners.
  function restingOn(body, bodies, dr) {
    const rest = bodies.filter(o => o !== body), out = [];
    for (const o of rest) {
      if (o.box[4] < body.box[1] + 0.05) continue;
      if (!G.boxOverlap(o.box, body.box, CT)) continue;
      if (!supported(o, rest, dr)) out.push(o);
    }
    return out;
  }

  return { makeBody, setPose, translate, comW, poseOf, extents, makeDrawer, outside, overlapWith, blocked, dropDistance, contacts, stability, settle, validate, restingOn, supported, rotateAbout, CONTACT, OVERLAP };
})();

// ---- 03_catalog.js ----
// The cabinet of curiosities. Each object is a list of geometric features in object
// space (cm, y up, resting on y = 0). The same features build the visible mesh and the
// convex collision parts, so collision follows the silhouette: lathe profiles become
// frustum stacks, handles become capsule chains, a bowl becomes a hollow ring of wedges.

const Catalog = (() => {
  const { qAxis, qMul, qRot, v3 } = U;
  const D2R = Math.PI / 180;
  const rz = a => qAxis(0, 0, 1, a * D2R), rx = a => qAxis(1, 0, 0, a * D2R), ry = a => qAxis(0, 1, 0, a * D2R);

  // ---- Catmull-Rom sampling shared by collision and visuals ----
  function catmull(pts, n) {
    const out = [];
    const P = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(t)), u = t - k;
      const p0 = P[k], p1 = P[k + 1], p2 = P[k + 2], p3 = P[k + 3];
      const f = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u * u * u);
      out.push([f(0), f(1), f(2)]);
    }
    return out;
  }
  function segDist(p, a, b) {
    const ab = v3.sub(b, a), L = v3.dot(ab, ab), t = L > 0 ? Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ab) / L)) : 0;
    return v3.len(v3.sub(p, v3.add(a, v3.scale(ab, t))));
  }
  function tubeParts(path, r, nCaps, xf) {
    const fine = path, out = [];
    const step = (fine.length - 1) / nCaps;
    for (let i = 0; i < nCaps; i++) {
      const i0 = Math.round(i * step), i1 = Math.round((i + 1) * step);
      const a = fine[i0], b = fine[i1];
      let dev = 0; for (let k = i0; k <= i1; k++) dev = Math.max(dev, segDist(fine[k], a, b));
      out.push(xf({ t: 'cap', a, b, r: r + dev }));
    }
    return out;
  }
  function ringPath(R, n) { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([Math.cos(a) * R, Math.sin(a) * R, 0]); } return o; }

  // Feature -> convex parts (object space).
  function featParts(f) {
    const P = f.p || [0, 0, 0], Q = f.q || [0, 0, 0, 1];
    // compose a part's own local transform into the feature transform
    const xf = part => {
      const lp = part.p || [0, 0, 0], lq = part.q || [0, 0, 0, 1];
      const o = Object.assign({}, part);
      o.p = v3.add(P, qRot(Q, lp)); o.q = qMul(Q, lq);
      return o;
    };
    const parts = [];
    switch (f.k) {
      case 'lathe': {
        const pr = f.prof, w = 1 + (f.wob || 0);
        for (let i = 0; i < pr.length - 1; i++) {
          const a = pr[i], b = pr[i + 1];
          if (b[1] - a[1] < 1e-4) continue;
          parts.push(xf({ t: 'fr', r0: a[0] * w, r1: b[0] * w, h: b[1] - a[1], p: [0, (a[1] + b[1]) / 2, 0], s: [f.sx || 1, 1, f.sz || 1] }));
        }
        break;
      }
      case 'cyl': parts.push(xf({ t: 'fr', r0: f.r0, r1: f.r1 == null ? f.r0 : f.r1, h: f.h, s: [f.sx || 1, 1, f.sz || 1] })); break;
      case 'box': {
        const [w, h, d] = f.size;
        if (!f.taper && !f.skew) parts.push(xf({ t: 'box', h: [w / 2, h / 2, d / 2] }));
        else parts.push(xf({ t: 'hull', pts: boxCorners(f) }));
        break;
      }
      case 'prism': {
        const pts = [];
        for (const [x, y] of f.poly) { pts.push([x, y, -f.depth / 2]); pts.push([x, y, f.depth / 2]); }
        parts.push(xf({ t: 'hull', pts }));
        break;
      }
      case 'sph': parts.push(xf({ t: 'sph', r: 1, s: f.r })); break;
      case 'cap': parts.push(xf({ t: 'cap', a: f.a, b: f.b, r: f.r })); break;
      case 'tube': parts.push(...tubeParts(catmull(f.pts, 40), f.r, f.caps || 4, xf)); break;
      case 'ring': parts.push(...tubeParts(ringPath(f.R, 48), f.r, f.caps || 8, xf)); break;
      case 'dome': { // half ellipsoid, flat side down
        const pts = [];
        for (let i = 0; i <= 6; i++) for (let j = 0; j < 16; j++) {
          const el = i / 6 * Math.PI / 2, az = j / 16 * Math.PI * 2;
          pts.push([Math.cos(el) * Math.cos(az) * f.r[0] * 1.02, Math.sin(el) * f.r[1] * 1.01, Math.cos(el) * Math.sin(az) * f.r[2] * 1.02]);
        }
        parts.push(xf({ t: 'hull', pts }));
        break;
      }
      case 'bowl': {
        const N = f.n || 12, rows = bowlRows(f);
        parts.push(xf({ t: 'fr', r0: f.rb, r1: rows[0].ro, h: f.floor, p: [0, f.floor / 2, 0] }));
        for (let r = 0; r < rows.length - 1; r++) {
          const A = rows[r], B = rows[r + 1];
          for (let i = 0; i < N; i++) {
            const pts = [];
            for (const t of [0, 0.5, 1]) {
              const a = (i + t) / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
              const k = 1 / Math.cos(Math.PI / N / 2);
              pts.push([c * A.ro * k, A.y, s * A.ro * k], [c * B.ro * k, B.y, s * B.ro * k]);
              if (t !== 0.5) pts.push([c * A.ri, A.y, s * A.ri], [c * B.ri, B.y, s * B.ri]);
            }
            parts.push(xf({ t: 'hull', pts }));
          }
        }
        break;
      }
    }
    if (f.density) for (const p of parts) p.density = f.density;
    return parts;
  }
  function boxCorners(f) {
    const [w, h, d] = f.size, t = f.taper || [1, 1], sk = f.skew || [0, 0];
    const pts = [];
    for (const y of [-h / 2, h / 2]) for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const top = y > 0;
      pts.push([x * w / 2 * (top ? t[0] : 1) + (top ? sk[0] : 0), y, z * d / 2 * (top ? t[1] : 1) + (top ? sk[1] : 0)]);
    }
    return pts;
  }
  function bowlRows(f) {
    const rows = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3, y = f.floor * 0.6 + (f.h - f.floor * 0.6) * t;
      const ro = f.rb + (f.rt - f.rb) * Math.pow(t, 0.7);
      rows.push({ y, ro, ri: Math.max(0.2, ro - f.wall) });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------------
  // Palette (gouache pigments)
  const C = {
    sienna: '#9a4a2a', siennaD: '#6e3320', ochre: '#c98e2f', mustard: '#d9a933', olive: '#7b7a3c', oliveD: '#56562a',
    dusty: '#7f9db4', dustyL: '#a9c1cf', teal: '#2f6b66', tealD: '#21504d', cream: '#efe2c4', creamD: '#dccaa0',
    terra: '#bf6a3f', burgundy: '#7c2f35', brass: '#c4993f', brassD: '#8a6a2a', ink: '#2c1d16', umber: '#4a3020',
    green: '#6f9a6a', greenD: '#4b7350', rose: '#c98a7a', paper: '#eadcbc', walnut: '#7a4a2c', walnutL: '#a8693c'
  };

  // Material shorthands. `paint` names a painter in Paint with parameters.
  const M = {
    glaze: (base, top, o = {}) => ({ kind: 'ceramic', paint: Object.assign({ fn: 'ceramic', base, glaze: top }, o) }),
    wood: (base, o = {}) => ({ kind: 'wood', paint: Object.assign({ fn: 'wood', base }, o) }),
    brass: (o = {}) => ({ kind: 'brass', paint: Object.assign({ fn: 'brass', base: C.brass }, o) }),
    paper: (o = {}) => ({ kind: 'paper', paint: Object.assign({ fn: 'paper', base: C.paper }, o) }),
    flat: (base, kind = 'ceramic', o = {}) => ({ kind, paint: Object.assign({ fn: 'flat', base }, o) }),
  };

  const D = [];
  const def = o => { D.push(o); return o; };

  // ---------------- A. Ceramics ----------------
  def({
    id: 'vase', no: 1, name: 'Tall vase', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.sienna, C.dusty, { glazeAt: 0.42, drips: 7, motif: 'diamond', motifAt: 0.3, motifColor: C.tealD, motifN: 3, speck: C.cream, band: { at: 0.86, w: 0.035, color: C.cream } }) },
    feats: [{ k: 'lathe', mat: 'body', open: 1, wob: 0.03, prof: [[1.9, 0], [2.5, 0.4], [3.05, 2.4], [3.0, 4.8], [2.25, 7.8], [1.3, 10.3], [1.15, 11.7], [1.75, 13]] }],
  });
  def({
    id: 'teapot', no: 2, name: 'Round teapot', cat: 'Ceramics', snd: 'ceramic',
    mats: {
      body: M.glaze(C.walnut, C.siennaD, { glazeAt: 0.95, drips: 0, bands: [{ at: 0.5, w: 0.2, color: C.dusty, motif: 'circles', motifColor: C.cream }, { at: 0.24, w: 0.03, color: C.cream }], speck: C.creamD }),
      lid: M.glaze(C.walnut, C.dusty, { glazeAt: 0.35, drips: 0, bands: [{ at: 0.2, w: 0.12, color: C.cream }, { at: 0.55, w: 0.08, color: C.dusty }] }),
      spout: M.glaze(C.walnut, C.walnut, { drips: 0 }),
    },
    feats: [
      { k: 'lathe', mat: 'body', wob: 0.02, prof: [[2.1, 0], [3.3, 0.7], [3.85, 2.5], [3.6, 4.3], [2.5, 5.5], [1.75, 5.75]] },
      { k: 'lathe', mat: 'lid', prof: [[1.85, 5.7], [1.7, 6.3], [1.0, 6.85], [0.4, 7.0]] },
      { k: 'sph', mat: 'lid', r: [0.55, 0.6, 0.55], p: [0, 7.4, 0] },
      { k: 'tube', mat: 'spout', r: 0.42, taper: 0.55, caps: 3, pts: [[3.2, 1.7, 0], [4.5, 2.5, 0], [5.3, 3.9, 0], [6.0, 5.0, 0]] },
      { k: 'tube', mat: 'spout', r: 0.36, caps: 4, pts: [[-3.3, 4.3, 0], [-4.7, 4.6, 0], [-5.15, 3.2, 0], [-4.5, 1.8, 0], [-3.5, 1.5, 0]] },
    ],
  });
  def({
    id: 'bowl', no: 3, name: 'Shallow bowl', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.walnut, C.green, { glazeAt: 0.62, drips: 9, bands: [{ at: 0.2, w: 0.03, color: C.cream }, { at: 0.12, w: 0.02, color: C.cream }], speck: C.cream, inner: C.green }) },
    feats: [{ k: 'bowl', mat: 'body', rb: 2.6, rt: 5.6, h: 3.1, wall: 0.38, floor: 0.45 }],
  });
  def({
    id: 'bottle', no: 4, name: 'Narrow-necked bottle', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.cream, C.cream, { drips: 0, bands: [{ at: 0.3, w: 0.16, color: C.olive, motif: 'dots', motifColor: C.cream }, { at: 0.12, w: 0.025, color: C.siennaD }, { at: 0.5, w: 0.025, color: C.siennaD }], speck: C.siennaD, mottle: C.creamD }) },
    feats: [{ k: 'lathe', mat: 'body', open: 1, wob: 0.025, prof: [[1.55, 0], [2.4, 0.55], [2.75, 2.4], [2.45, 4.5], [1.2, 6.1], [0.65, 7.1], [0.58, 9.5], [0.92, 10.1]] }],
  });
  def({
    id: 'cup', no: 5, name: 'Tiny cup', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.terra, C.cream, { glazeAt: 0.25, drips: 4, glazeFrom: 'bottom', motif: 'sun', motifAt: 0.62, motifN: 1, motifColor: C.ink, speck: C.creamD }), handle: M.glaze(C.terra, C.terra, { drips: 0 }) },
    feats: [
      { k: 'lathe', mat: 'body', open: 1, prof: [[0.95, 0], [1.05, 0.3], [1.55, 0.65], [1.95, 2.7]] },
      { k: 'tube', mat: 'handle', r: 0.22, caps: 3, pts: [[1.75, 2.15, 0], [2.65, 2.05, 0], [2.7, 1.15, 0], [1.6, 0.95, 0]] },
    ],
  });
  def({
    id: 'lidpot', no: 6, name: 'Ornate lidded pot', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.teal, C.tealD, { glazeAt: 0.9, drips: 0, bands: [{ at: 0.52, w: 0.22, color: C.mustard, motif: 'zigzag', motifColor: C.burgundy }, { at: 0.2, w: 0.03, color: C.cream }, { at: 0.82, w: 0.03, color: C.cream }], speck: C.cream }), lid: M.glaze(C.mustard, C.teal, { glazeAt: 0.5, drips: 5, glazeFrom: 'top' }) },
    feats: [
      { k: 'lathe', mat: 'body', wob: 0.02, prof: [[1.8, 0], [2.0, 0.3], [3.0, 1.2], [3.3, 2.8], [2.8, 4.2], [2.45, 4.6]] },
      { k: 'lathe', mat: 'lid', prof: [[2.65, 4.55], [2.6, 4.95], [1.8, 5.6], [0.5, 6.1]] },
      { k: 'sph', mat: 'lid', r: [0.55, 0.65, 0.55], p: [0, 6.55, 0] },
    ],
  });
  def({
    id: 'flask', no: 7, name: 'Double-handled vessel', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.walnut, C.cream, { glazeAt: 0.48, drips: 8, glazeFrom: 'top', motif: 'diamond', motifAt: 0.26, motifN: 3, motifColor: C.cream, speck: C.creamD }), handle: M.glaze(C.cream, C.cream, { drips: 0, mottle: C.creamD }) },
    feats: [
      { k: 'lathe', mat: 'body', sz: 0.66, wob: 0.02, prof: [[1.25, 0], [2.6, 0.5], [3.35, 2.7], [3.25, 4.5], [2.2, 6.3], [0.8, 7.4], [0.7, 9.6], [1.45, 10.3]] },
      { k: 'ring', mat: 'handle', R: 1.0, r: 0.3, caps: 6, p: [3.65, 5.4, 0] },
      { k: 'ring', mat: 'handle', R: 1.0, r: 0.3, caps: 6, p: [-3.65, 5.4, 0] },
    ],
  });
  def({
    id: 'incense', no: 8, name: 'Incense holder', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.burgundy, C.mustard, { glazeAt: 0.7, drips: 6, glazeFrom: 'top', speck: C.cream, motif: 'dots', motifAt: 0.3, motifN: 6, motifColor: C.cream }), stick: M.flat(C.umber, 'wood', { tip: C.terra }) },
    feats: [
      { k: 'lathe', mat: 'body', prof: [[2.2, 0], [2.35, 0.35], [1.6, 1.15], [0.55, 1.5]] },
      { k: 'cap', mat: 'stick', a: [0.15, 1.35, 0], b: [3.1, 7.2, 0], r: 0.11 },
    ],
  });

  // ---------------- B. Vintage household ----------------
  def({
    id: 'radio', no: 9, name: 'Wooden radio', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnut, { face: 'radio' }), knob: M.flat(C.creamD, 'wood', { ring: C.umber }), handle: M.brass() },
    feats: [
      { k: 'box', mat: 'body', size: [8.6, 5.6, 4.0], taper: [0.92, 0.95], p: [0, 2.8, 0] },
      { k: 'cyl', mat: 'knob', r0: 0.55, h: 0.6, p: [2.75, 1.5, 2.25], q: rx(90) },
      { k: 'cyl', mat: 'knob', r0: 0.45, h: 0.55, p: [-2.75, 1.5, 2.22], q: rx(90) },
      { k: 'tube', mat: 'handle', r: 0.17, caps: 3, pts: [[-2.4, 5.5, 0], [-2.05, 6.55, 0], [2.05, 6.55, 0], [2.4, 5.5, 0]] },
    ],
  });
  def({
    id: 'tv', no: 10, name: 'Little television', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.terra, { face: 'tv' }), leg: M.wood(C.siennaD, { plain: 1 }) },
    feats: [
      { k: 'prism', mat: 'body', poly: [[-3.7, 0], [3.7, 0], [4.15, 5.4], [-4.15, 5.4]], depth: 5.2, p: [0, 2.6, 0] },
      { k: 'cap', mat: 'leg', a: [-2.9, 2.8, 1.7], b: [-3.6, 0.25, 2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [2.9, 2.8, 1.7], b: [3.6, 0.25, 2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [-2.9, 2.8, -1.7], b: [-3.6, 0.25, -2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [2.9, 2.8, -1.7], b: [3.6, 0.25, -2.3], r: 0.24 },
    ],
  });
  def({
    id: 'candle', no: 11, name: 'Brass candlestick', cat: 'Household', snd: 'metal',
    mats: { body: M.brass(), wax: M.flat(C.cream, 'wax', { drip: 1 }) },
    feats: [
      { k: 'lathe', mat: 'body', prof: [[2.5, 0], [2.55, 0.35], [1.7, 0.7], [0.6, 1.1], [0.45, 3.4], [0.85, 4.0], [0.48, 4.7], [0.42, 7.3], [1.35, 7.85], [1.45, 8.2]] },
      { k: 'cyl', mat: 'wax', r0: 0.72, r1: 0.66, h: 3.6, p: [0, 10.0, 0] },
    ],
  });
  def({
    id: 'gramophone', no: 12, name: 'Miniature gramophone', cat: 'Household', snd: 'wood',
    mats: { base: M.wood(C.walnutL, { face: 'gramo' }), horn: M.glaze(C.mustard, C.ochre, { glazeAt: 0.25, drips: 0, glazeFrom: 'bottom', petals: 1, inner: '#8a5a1a' }), plate: M.flat('#2a2422', 'metal', { record: 1 }), arm: M.brass() },
    feats: [
      { k: 'box', mat: 'base', size: [6.4, 3.0, 6.4], taper: [0.9, 0.9], p: [0, 1.5, 0] },
      { k: 'cyl', mat: 'plate', r0: 2.5, h: 0.3, p: [-0.3, 3.15, 0.3] },
      { k: 'cap', mat: 'arm', a: [2.3, 3.0, -2.3], b: [2.3, 5.0, -2.3], r: 0.28 },
      { k: 'lathe', mat: 'horn', open: 1, wob: 0.05, prof: [[0.32, 0], [0.45, 1.8], [1.0, 4.0], [2.2, 5.7], [3.4, 6.4]], p: [2.3, 4.6, -2.3], q: qMul(ry(-45), rz(38)) },
    ],
  });
  def({
    id: 'frame', no: 13, name: 'Framed portrait', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnut, { face: 'portrait' }) },
    feats: [{ k: 'prism', mat: 'body', depth: 1.0, poly: [[-3.4, 0], [3.4, 0], [4.1, 0.9], [4.1, 8.3], [3.4, 9.2], [-3.4, 9.2], [-4.1, 8.3], [-4.1, 0.9]], p: [0, 0, 0] }],
  });
  def({
    id: 'mirror', no: 14, name: 'Brass hand mirror', cat: 'Household', snd: 'metal',
    mats: { body: M.brass({ face: 'mirror' }), handle: M.brass() },
    feats: [
      { k: 'cyl', mat: 'body', r0: 2.75, r1: 2.6, h: 0.65, p: [0, 0.325, 0] },
      { k: 'cap', mat: 'handle', a: [0, 0.34, 2.7], b: [0, 0.34, 7.2], r: 0.36 },
    ],
  });
  def({
    id: 'clock', no: 15, name: 'Desk clock', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.burgundy, { face: 'clock' }), dial: M.flat(C.cream, 'ceramic', { dial: 1 }), bell: M.brass() },
    feats: [
      { k: 'prism', mat: 'body', depth: 3.0, poly: [[-2.9, 0], [2.9, 0], [3.0, 5.0], [2.2, 6.4], [0, 7.0], [-2.2, 6.4], [-3.0, 5.0]] },
      { k: 'cyl', mat: 'dial', r0: 2.05, h: 0.28, p: [0, 4.2, 1.64], q: rx(90) },
      { k: 'sph', mat: 'bell', r: [0.75, 0.6, 0.75], p: [0, 7.45, 0] },
    ],
  });
  def({
    id: 'woodbox', no: 16, name: 'Decorative box', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnutL, { face: 'chest' }), lid: M.wood(C.walnutL, { face: 'chestlid' }), clasp: M.brass() },
    feats: [
      { k: 'box', mat: 'body', size: [8.4, 3.4, 5.4], p: [0, 1.7, 0] },
      { k: 'box', mat: 'lid', size: [8.8, 1.3, 5.8], taper: [0.97, 0.88], p: [0, 4.05, 0] },
      { k: 'box', mat: 'clasp', size: [1.0, 1.2, 0.3], p: [0, 3.4, 2.85] },
    ],
  });

  // ---------------- C. Paper and stationery ----------------
  def({
    id: 'journal', no: 17, name: 'Thick old journal', cat: 'Paper', snd: 'book',
    mats: { body: M.paper({ face: 'journal' }) },
    feats: [{ k: 'box', mat: 'body', size: [9.4, 3.4, 12.6], taper: [0.985, 0.99], skew: [0.12, -0.08], p: [0, 1.7, 0] }],
  });
  def({
    id: 'letter', no: 18, name: 'Folded letter', cat: 'Paper', snd: 'paper',
    mats: { body: M.paper({ script: 1 }) },
    feats: [
      { k: 'box', mat: 'body', size: [9.6, 0.1, 3.7], p: [0, 0.42, -1.8], q: rx(-13) },
      { k: 'box', mat: 'body', size: [9.6, 0.1, 3.7], p: [0, 0.42, 1.8], q: rx(13) },
    ],
  });
  def({
    id: 'envelopes', no: 19, name: 'Bundle of envelopes', cat: 'Paper', snd: 'paper',
    mats: { a: M.paper({ envelope: 1, base: '#e6d2a8' }), b: M.paper({ envelope: 1, base: '#d9c7a2' }), c: M.paper({ envelope: 1, base: '#e9ddc3' }), d: M.paper({ envelope: 1, base: '#cfb88f', stamp: 1 }) },
    feats: [
      { k: 'box', mat: 'a', size: [9.0, 0.36, 5.6], p: [0, 0.18, 0], q: ry(-4) },
      { k: 'box', mat: 'b', size: [9.0, 0.36, 5.6], p: [0.25, 0.55, 0.15], q: ry(5) },
      { k: 'box', mat: 'c', size: [9.0, 0.36, 5.6], p: [-0.2, 0.92, -0.1], q: ry(-2) },
      { k: 'box', mat: 'd', size: [9.0, 0.36, 5.6], p: [0.15, 1.29, 0.1], q: ry(7) },
    ],
  });
  def({
    id: 'scroll', no: 20, name: 'Rolled parchment', cat: 'Paper', snd: 'paper',
    mats: { body: M.paper({ base: '#e3cf9f', roll: 1 }), end: M.paper({ base: '#d8bf88', rollEnd: 1 }) },
    feats: [
      { k: 'cyl', mat: 'body', r0: 1.05, h: 10.2, p: [0, 1.36, 0], q: rz(90) },
      { k: 'cyl', mat: 'end', r0: 1.36, r1: 1.3, h: 0.55, p: [-5.35, 1.36, 0], q: rz(90) },
      { k: 'cyl', mat: 'end', r0: 1.3, r1: 1.36, h: 0.55, p: [5.35, 1.36, 0], q: rz(90) },
    ],
  });
  def({
    id: 'notebook', no: 21, name: 'Miniature notebook', cat: 'Paper', snd: 'book',
    mats: { body: M.paper({ face: 'notebook' }) },
    feats: [{ k: 'box', mat: 'body', size: [6.0, 1.0, 8.6], p: [0, 0.5, 0] }],
  });
  def({
    id: 'postcards', no: 22, name: 'Stack of postcards', cat: 'Paper', snd: 'paper',
    mats: { a: M.paper({ card: 'sea', base: '#ece0c4' }), b: M.paper({ card: 'hill', base: '#e5d6b6' }), c: M.paper({ card: 'script', base: '#efe5cf' }) },
    feats: [
      { k: 'box', mat: 'b', size: [8.8, 0.16, 5.8], p: [0, 0.08, 0], q: ry(3) },
      { k: 'box', mat: 'c', size: [8.8, 0.16, 5.8], p: [-0.2, 0.25, 0.1], q: ry(-5) },
      { k: 'box', mat: 'a', size: [8.8, 0.16, 5.8], p: [0.3, 0.42, -0.1], q: ry(8) },
      { k: 'box', mat: 'b', size: [8.8, 0.16, 5.8], p: [0.0, 0.59, 0.2], q: ry(-2) },
      { k: 'box', mat: 'a', size: [8.8, 0.16, 5.8], p: [-0.25, 0.76, -0.1], q: ry(-9) },
    ],
  });

  // ---------------- D. Curious objects ----------------
  def({
    id: 'bird', no: 23, name: 'Sculptural bird', cat: 'Curious', snd: 'ceramic',
    mats: { body: M.glaze(C.teal, C.dusty, { glazeAt: 0.55, drips: 5, glazeFrom: 'top', speck: C.cream, feathers: 1 }), beak: M.flat(C.mustard, 'ceramic'), stand: M.wood(C.umber, { plain: 1 }) },
    feats: [
      { k: 'lathe', mat: 'stand', prof: [[1.7, 0], [1.75, 0.45], [0.35, 0.75]] },
      { k: 'cap', mat: 'stand', a: [0, 0.6, 0], b: [0, 1.7, 0], r: 0.17 },
      { k: 'sph', mat: 'body', r: [2.35, 1.55, 1.55], p: [-0.1, 3.0, 0], q: rz(14) },
      { k: 'sph', mat: 'body', r: [1.0, 1.0, 0.95], p: [1.95, 4.35, 0] },
      { k: 'cyl', mat: 'beak', r0: 0.36, r1: 0.02, h: 1.25, p: [3.4, 4.2, 0], q: rz(-98) },
      { k: 'prism', mat: 'body', depth: 0.5, poly: [[-2.0, 2.2], [-4.3, 3.4], [-4.0, 4.0], [-1.6, 3.4]] },
    ],
  });
  def({
    id: 'horse', no: 24, name: 'Wooden horse', cat: 'Curious', snd: 'wood',
    mats: { body: M.wood(C.walnutL, { horse: 1 }), base: M.wood(C.mustard, { plain: 1, painted: 1 }), mane: M.flat(C.ink, 'wood') },
    feats: [
      { k: 'box', mat: 'base', size: [8.6, 0.6, 2.8], p: [0, 0.3, 0] },
      { k: 'cap', mat: 'body', a: [-2.5, 0.65, 0.75], b: [-2.6, 3.2, 0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [-2.5, 0.65, -0.75], b: [-2.6, 3.2, -0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [2.4, 0.65, 0.75], b: [2.5, 3.2, 0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [2.4, 0.65, -0.75], b: [2.5, 3.2, -0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [-2.6, 3.75, 0], b: [2.5, 3.75, 0], r: 1.2 },
      { k: 'cap', mat: 'body', a: [2.6, 4.3, 0], b: [3.6, 6.3, 0], r: 0.72 },
      { k: 'cap', mat: 'body', a: [3.5, 6.6, 0], b: [5.0, 5.95, 0], r: 0.56 },
      { k: 'cap', mat: 'mane', a: [-3.7, 4.0, 0], b: [-4.5, 2.3, 0], r: 0.28 },
      { k: 'cap', mat: 'mane', a: [3.25, 7.05, 0.25], b: [3.45, 7.65, 0.3], r: 0.17 },
    ],
  });
  def({
    id: 'mask', no: 25, name: 'Ornamental mask', cat: 'Curious', snd: 'wood',
    mats: { body: M.wood(C.burgundy, { mask: 1 }), horn: M.flat(C.cream, 'ceramic', { mottle: C.creamD }) },
    feats: [
      { k: 'dome', mat: 'body', r: [3.3, 2.0, 4.3] },
      { k: 'cyl', mat: 'horn', r0: 0.55, r1: 0.08, h: 2.4, p: [-2.0, 1.15, -4.5], q: qMul(ry(25), rx(-62)) },
      { k: 'cyl', mat: 'horn', r0: 0.55, r1: 0.08, h: 2.4, p: [2.0, 1.15, -4.5], q: qMul(ry(-25), rx(-62)) },
    ],
  });
  def({
    id: 'key', no: 26, name: 'Little brass key', cat: 'Curious', snd: 'metal',
    mats: { body: M.brass() },
    feats: [
      { k: 'ring', mat: 'body', R: 0.9, r: 0.26, caps: 8, p: [0, 0.26, 0], q: rx(90) },
      { k: 'cap', mat: 'body', a: [0, 0.26, 1.1], b: [0, 0.26, 5.0], r: 0.23 },
      { k: 'box', mat: 'body', size: [1.0, 0.44, 0.9], p: [0.6, 0.22, 4.5] },
    ],
  });
  def({
    id: 'flower', no: 27, name: 'Decorative flower', cat: 'Curious', snd: 'paper',
    mats: { bloom: M.glaze(C.mustard, C.ochre, { glazeAt: 0.3, drips: 0, glazeFrom: 'bottom', petals: 1, inner: C.siennaD }), stem: M.flat(C.greenD, 'wood'), leaf: M.flat(C.green, 'paper', { leaf: 1 }) },
    feats: [
      { k: 'tube', mat: 'stem', r: 0.15, caps: 3, pts: [[0, 0, 0], [0.4, 3.0, 0], [0.1, 6.0, 0], [0.5, 8.2, 0]] },
      { k: 'lathe', mat: 'bloom', open: 1, wob: 0.06, prof: [[0.35, 0], [0.6, 0.6], [1.6, 1.4], [2.7, 1.95]], p: [0.5, 8.0, 0], q: rz(-12) },
      { k: 'prism', mat: 'leaf', depth: 0.1, poly: [[0.3, 3.2], [2.4, 4.4], [2.9, 5.2], [1.9, 5.0], [0.3, 3.7]] },
    ],
  });
  def({
    id: 'sculpture', no: 28, name: 'Wooden sculpture', cat: 'Curious', snd: 'wood',
    mats: { a: M.wood(C.olive, { plain: 1 }), b: M.wood(C.walnutL, { plain: 1 }), c: M.wood(C.siennaD, { plain: 1 }) },
    feats: [
      { k: 'sph', mat: 'a', r: [2.5, 1.25, 1.9], p: [0, 1.25, 0] },
      { k: 'sph', mat: 'b', r: [1.5, 1.75, 1.3], p: [0.7, 3.55, 0], q: rz(-18) },
      { k: 'sph', mat: 'c', r: [0.95, 0.95, 0.95], p: [-0.25, 5.7, 0.15] },
      { k: 'cap', mat: 'c', a: [1.3, 3.9, 0], b: [3.1, 5.3, 0.2], r: 0.24 },
    ],
  });

  // Derive parts once.
  const byId = {};
  for (const d of D) {
    d.parts = [];
    d.feats.forEach((f, i) => { const ps = featParts(f); for (const p of ps) p.feat = i; d.parts.push(...ps); });
    byId[d.id] = d;
  }

  return { list: D, byId, catmull, ringPath, bowlRows, boxCorners, C };
})();

// ---- 04_packer.js ----
// Reverse-generation level solver. It packs a set of objects into a drawer using the
// same 3D drop/settle/validation rules the player is held to, then shrinks the drawer
// around the arrangement it found. The arrangement is kept as a proof of solvability
// and is re-validated before any puzzle is shown.

const Packer = (() => {
  const { qMul, qAxis, AXIS24, rng: makeRng } = U;

  // Distinct axis-aligned orientations of a body, lowest first.
  function orientations(def, scale, H, rnd) {
    const b = World.makeBody('tmp', def, scale), seen = new Map();
    for (const q of AXIS24) {
      World.setPose(b, [0, 0, 0], q);
      const e = World.extents(b);
      if (e[1] > H + 0.01) continue;
      const key = e.map(v => v.toFixed(1)).join(',');
      if (!seen.has(key)) seen.set(key, { q, e });
    }
    const arr = [...seen.values()];
    arr.sort((a, b) => (a.e[1] - b.e[1]) + (rnd() - 0.5) * 1.5);
    return arr;
  }

  // Pack `items` into a drawer of interior W x D x H. Generator: yields to keep frames smooth.
  function* packGen(items, W, D, H, seed, opts = {}) {
    const rnd = makeRng(seed);
    const dr = World.makeDrawer(W, D, H);
    const placed = [], poses = [];
    const order = items.map((it, i) => ({ it, i, body: World.makeBody(it.uid || it.id + '#' + i, Catalog.byId[it.id], it.scale || 1) }));
    order.forEach(o => { World.setPose(o.body, [0, 0, 0], [0, 0, 0, 1]); const e = World.extents(o.body); o.vol = e[0] * e[1] * e[2]; });
    order.sort((a, b) => b.vol - a.vol);
    let work = 0;
    for (const o of order) {
      const body = o.body;
      const ors = orientations(body.def, body.scale, H, rnd).slice(0, opts.maxOrient || 8);
      let best = null;
      for (const or of ors) {
        World.setPose(body, [0, 0, 0], or.q);
        const bb = body.box, offX = -bb[0], offZ = -bb[2], wx = bb[3] - bb[0], wz = bb[5] - bb[2], offY = -bb[1];
        if (wx > W + 0.01 || wz > D + 0.01) continue;
        // extreme-point candidates on x and z
        const xs = new Set([dr.x0 + offX, dr.x1 - wx + offX]), zs = new Set([dr.z0 + offZ, dr.z1 - wz + offZ]);
        for (const p of placed) { xs.add(p.box[3] + 0.03 + offX); xs.add(p.box[0] - wx - 0.03 + offX); zs.add(p.box[5] + 0.03 + offZ); zs.add(p.box[2] - wz - 0.03 + offZ); xs.add((p.box[0] + p.box[3]) / 2 - wx / 2 + offX); zs.add((p.box[2] + p.box[5]) / 2 - wz / 2 + offZ); }
        const X = [...xs].filter(x => x - offX >= dr.x0 - 0.01 && x - offX + wx <= dr.x1 + 0.01);
        const Z = [...zs].filter(z => z - offZ >= dr.z0 - 0.01 && z - offZ + wz <= dr.z1 + 0.01);
        let top = 0; for (const p of placed) top = Math.max(top, p.box[4]);
        for (const z of Z) for (const x of X) {
          World.setPose(body, [x, top + offY + 0.3, z], or.q);
          if (World.outside(body, dr, true)) continue;
          const dd = World.dropDistance(body, placed);
          World.translate(body, 0, -dd.t, 0);
          work++;
          if (body.box[4] > H + 0.01) continue;
          if (best && body.box[4] * 4 + (body.box[2] - dr.z0) * 1.0 + (body.box[0] - dr.x0) * 0.35 >= best.score) continue;
          const cs = World.contacts(body, placed);
          if (!World.stability(body, cs).stable) {
            // let it tip or roll into a resting pose, exactly as a player's release would
            const r = World.settle(body, placed, dr, { maxIter: 40 });
            if (!r.ok || r.propped) continue; // propped poses depend on wall positions; keep proofs self-supporting
          } else if (World.overlapWith(body, placed)) continue;
          const score = body.box[4] * 4 + (body.box[2] - dr.z0) * 1.0 + (body.box[0] - dr.x0) * 0.35;
          best = { score, p: body.p.slice(), q: body.q.slice() };
          if (work % 40 === 0) yield work;
        }
        if (work % 10 === 0) yield work;
      }
      if (!best) return { ok: false, failed: o.it.id, work };
      World.setPose(body, best.p, best.q);
      placed.push(body);
      poses.push({ i: o.i, id: o.it.id, scale: body.scale, p: best.p, q: best.q });
    }
    poses.sort((a, b) => a.i - b.i);
    return { ok: true, poses, placed, work };
  }
  function runSync(gen) { let r; do { r = gen.next(); } while (!r.done); return r.value; }

  // Shrink a drawer around a found arrangement and centre it.
  function tighten(res, H, slack) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of res.placed) { b[0] = Math.min(b[0], p.box[0]); b[1] = Math.min(b[1], p.box[2]); b[2] = Math.max(b[2], p.box[3]); b[3] = Math.max(b[3], p.box[5]); }
    const W = +(b[2] - b[0] + slack[0]).toFixed(2), D = +(b[3] - b[1] + slack[1]).toFixed(2);
    const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
    const solution = res.poses.map(p => ({ id: p.id, scale: p.scale, p: [+(p.p[0] - cx).toFixed(4), +p.p[1].toFixed(4), +(p.p[2] - cz).toFixed(4)], q: p.q.map(v => +v.toFixed(6)) }));
    return { W, D, H, solution };
  }

  // Generate a solvable puzzle: find the smallest depth that packs, then add slack.
  function* puzzleGen(items, opts) {
    const H = opts.H, seed = opts.seed || 1;
    let area = 0;
    for (const it of items) {
      const ors = orientations(Catalog.byId[it.id], it.scale || 1, H, makeRng(seed));
      if (!ors.length) return { ok: false, reason: 'too tall: ' + it.id };
      area += Math.min(...ors.map(o => o.e[0] * o.e[2]));
    }
    const W = opts.W || Math.max(14, Math.sqrt(area * (opts.aspect || 1.05) / (opts.fill || 0.62)));
    let lo = 6, hi = Math.max(12, area / W * 2.6), best = null;
    // make sure hi works
    for (let tries = 0; tries < 4 && !best; tries++) {
      const r = yield* packGen(items, W, hi, H, seed + tries, opts);
      if (r.ok) best = r; else hi *= 1.35;
    }
    if (!best) return { ok: false, reason: 'no packing' };
    const steps = opts.searchSteps == null ? 4 : opts.searchSteps;
    for (let s = 0; s < steps; s++) {
      const mid = (lo + hi) / 2;
      const r = yield* packGen(items, W, mid, H, seed + 7 * s, opts);
      if (r.ok) { best = r; hi = mid; } else lo = mid;
    }
    const pz = tighten(best, H, opts.slack || [1, 1]);
    pz.items = items.map(it => ({ id: it.id, scale: it.scale || 1 }));
    const v = verify(pz);
    if (!v.ok) return { ok: false, reason: 'verify failed', problems: v.problems, pz };
    pz.ok = true;
    return pz;
  }

  // Independent check: rebuild the arrangement from the stored poses and validate it.
  function verify(pz) {
    const dr = World.makeDrawer(pz.W, pz.D, pz.H);
    const bodies = pz.solution.map((s, i) => { const b = World.makeBody(s.id + '#' + i, Catalog.byId[s.id], s.scale || 1); World.setPose(b, s.p, s.q); return b; });
    const counts = {};
    for (const it of pz.items) counts[it.id] = (counts[it.id] || 0) + 1;
    for (const s of pz.solution) counts[s.id] = (counts[s.id] || 0) - 1;
    if (Object.values(counts).some(c => c !== 0)) return { ok: false, problems: [{ reason: 'items/solution mismatch' }] };
    const problems = World.validate(bodies, dr);
    return { ok: problems.length === 0, problems };
  }

  return { orientations, packGen, puzzleGen, runSync, verify, tighten };
})();

// ---- 05_paint.js ----
// Procedural gouache. Every surface is painted on a 2D canvas with layered washes,
// tapered brush strokes, dry-brush streaks, speckle and hand-wobbled motifs, then mapped
// onto real 3D geometry. Painters respect material: glaze pools and drips on ceramics,
// grain on wood, patina and painted glints on brass, fibres and ink on paper.
//
// UV layouts the painters know about:
//   lathe/cyl: u around (u = 0.25 faces the viewer), v bottom -> top.
//   box atlas: 3 x 2 cells. Top row: front, back, top. Bottom row: right, left, bottom.
//   prism atlas: front face u 0..0.5, back u 0.5..1 (both v 0.3..1); sides strip v 0..0.3.

const Paint = (() => {
  const { rng, clamp, noise2, fbm2 } = U;

  // ---- colour helpers ----
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hslCss(h, s, l, a = 1) { return `hsla(${((h % 1) + 1) % 1 * 360},${clamp(s, 0, 1) * 100}%,${clamp(l, 0, 1) * 100}%,${a})`; }
  function jit(hex, r, dl = 0.06, ds = 0.06, dh = 0.015, a = 1) {
    const [h, s, l] = rgbHsl(hexRgb(hex));
    return hslCss(h + (r() - 0.5) * 2 * dh, s + (r() - 0.5) * 2 * ds, l + (r() - 0.5) * 2 * dl, a);
  }
  function shade(hex, dl, ds = 0, a = 1) { const [h, s, l] = rgbHsl(hexRgb(hex)); return hslCss(h, s + ds, l + dl, a); }
  function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

  function canvas(w, h) {
    const c = document.createElement('canvas'); // detached; never mounted
    c.width = w; c.height = h; return c;
  }

  // ---- brush primitives ----
  // A tapered stroke: a curved ribbon built from a centreline with width falling off at both ends.
  function stroke(g, x, y, len, w, ang, color, r, bend = 0.15) {
    const n = 8, ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca;
    const bnd = (r() - 0.5) * bend * len;
    const L = [], R = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x + ca * (t - 0.5) * len + nx * bnd * Math.sin(t * Math.PI), py = y + sa * (t - 0.5) * len + ny * bnd * Math.sin(t * Math.PI);
      const ww = w * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15) * Math.PI)) * (0.85 + r() * 0.3) / 2;
      L.push([px + nx * ww, py + ny * ww]); R.push([px - nx * ww, py - ny * ww]);
    }
    g.fillStyle = color; g.beginPath(); g.moveTo(L[0][0], L[0][1]);
    for (const p of L) g.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
    g.closePath(); g.fill();
  }
  // wrap-aware drawing for cylindrical maps
  function wrap(W, x, fn) { fn(x); if (x < W * 0.25) fn(x + W); if (x > W * 0.75) fn(x - W); }

  // Wobbly line through points (hand-drawn ink).
  function wobble(g, pts, r, amp = 1.2, close = false) {
    g.beginPath();
    pts.forEach((p, i) => { const x = p[0] + (r() - 0.5) * amp, y = p[1] + (r() - 0.5) * amp; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    if (close) g.closePath();
  }

  // Layered gouache wash over a rect.
  function wash(g, x0, y0, w, h, base, r, o = {}) {
    g.fillStyle = base; g.fillRect(x0, y0, w, h);
    const n = Math.round((o.n || 1) * w * h / 900);
    const horiz = o.angle == null ? 0 : o.angle;
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * w, y = y0 + r() * h, len = (o.len || 60) * (0.5 + r()), ww = (o.w || 14) * (0.5 + r());
      stroke(g, x, y, len, ww, horiz + (r() - 0.5) * (o.spread || 0.5), jit(base, r, o.dl || 0.07, 0.07, 0.012, (o.a || 0.22) * (0.6 + r() * 0.6)), r);
    }
    // dry brush streaks
    const m = Math.round((o.dry == null ? 1 : o.dry) * w * h / 260);
    for (let i = 0; i < m; i++) {
      const x = x0 + r() * w, y = y0 + r() * h;
      g.fillStyle = r() < 0.5 ? shade(base, 0.08, 0, 0.12) : shade(base, -0.08, 0, 0.12);
      g.fillRect(x, y, (o.len || 60) * 0.25 * (0.3 + r()), 0.8 + r() * 0.8);
    }
  }
  function speckle(g, x0, y0, w, h, color, r, density = 1, size = 1.4) {
    const n = Math.round(density * w * h / 500);
    for (let i = 0; i < n; i++) {
      g.fillStyle = color; g.globalAlpha = 0.25 + r() * 0.55;
      g.beginPath(); g.arc(x0 + r() * w, y0 + r() * h, size * (0.3 + r() * r()), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  function paperGrain(g, w, h, r, a = 0.06) {
    for (let i = 0; i < w * h / 40; i++) { g.fillStyle = r() < 0.5 ? `rgba(255,250,235,${a})` : `rgba(60,35,20,${a})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
  }

  // ---- motifs, drawn in ink with a slightly unsteady hand ----
  function motif(g, type, cx, cy, s, color, r) {
    g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1.6, s * 0.12); g.lineCap = 'round'; g.lineJoin = 'round';
    switch (type) {
      case 'diamond': {
        wobble(g, [[cx, cy - s], [cx + s * 0.75, cy], [cx, cy + s], [cx - s * 0.75, cy]], r, s * 0.08, true); g.stroke();
        wobble(g, [[cx, cy - s * 0.5], [cx + s * 0.38, cy], [cx, cy + s * 0.5], [cx - s * 0.38, cy]], r, s * 0.06, true); g.stroke();
        g.beginPath(); g.arc(cx, cy, s * 0.1, 0, 7); g.fill();
        for (const [dx, dy] of [[0, -1.35], [0, 1.35], [1.05, 0], [-1.05, 0]]) { g.beginPath(); g.arc(cx + dx * s, cy + dy * s * 0.9, s * 0.07, 0, 7); g.fill(); }
        break;
      }
      case 'sun': {
        g.beginPath(); g.arc(cx, cy, s * 0.45, 0, 7); g.stroke();
        g.beginPath(); g.arc(cx, cy, s * 0.14, 0, 7); g.fill();
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; wobble(g, [[cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62], [cx + Math.cos(a) * s * 0.95, cy + Math.sin(a) * s * 0.95]], r, 1); g.stroke(); }
        break;
      }
      case 'cross': {
        wobble(g, [[cx - s * 0.6, cy], [cx + s * 0.6, cy]], r, 1); g.stroke();
        wobble(g, [[cx, cy - s * 0.6], [cx, cy + s * 0.6]], r, 1); g.stroke();
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.beginPath(); g.arc(cx + dx * s * 0.4, cy + dy * s * 0.4, s * 0.08, 0, 7); g.fill(); }
        break;
      }
      case 'circles': g.beginPath(); g.arc(cx, cy, s * 0.55, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, s * 0.16, 0, 7); g.fill(); break;
      case 'dots': g.beginPath(); g.arc(cx, cy, s * 0.22, 0, 7); g.fill(); break;
    }
    g.restore();
  }
  // a horizontal band with irregular edges, optionally filled with a repeated motif
  function band(g, W, H, b, r, around = true) {
    const yc = (1 - b.at) * H, hh = b.w * H / 2;
    g.fillStyle = b.color; g.beginPath();
    const n = 40;
    for (let i = 0; i <= n; i++) { const x = i / n * W; g.lineTo(x, yc - hh + (noise2(i * 0.7, b.at * 9) - 0.5) * hh * 0.5 + (r() - 0.5)); }
    for (let i = n; i >= 0; i--) { const x = i / n * W; g.lineTo(x, yc + hh + (noise2(i * 0.7 + 9, b.at * 9) - 0.5) * hh * 0.5 + (r() - 0.5)); }
    g.closePath(); g.fill();
    // texture inside the band
    g.save(); g.clip();
    for (let i = 0; i < W / 6; i++) stroke(g, r() * W, yc + (r() - 0.5) * hh * 2, 30, hh * 0.8, (r() - 0.5) * 0.3, jit(b.color, r, 0.06, 0.05, 0.01, 0.25), r);
    g.restore();
    if (b.motif) {
      const s = hh * 0.8, count = Math.max(3, Math.round(W / (s * 3.2)));
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) / count * W;
        if (b.motif === 'zigzag') continue;
        wrap(W, x, xx => motif(g, b.motif, xx, yc, s, b.motifColor || '#2c1d16', r));
      }
      if (b.motif === 'zigzag') {
        g.save(); g.strokeStyle = b.motifColor; g.lineWidth = Math.max(2, hh * 0.22); g.lineJoin = 'round';
        const pts = [], zc = Math.round(W / (hh * 1.6));
        for (let i = 0; i <= zc; i++) pts.push([i / zc * W, yc + (i % 2 ? -1 : 1) * hh * 0.55]);
        wobble(g, pts, r, 1.4); g.stroke();
        g.restore();
      }
    }
  }

  // ---- painters ----
  function ceramic(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 70, w: 16, n: 1.4 });
    if (sp.mottle) for (let i = 0; i < 26; i++) { g.globalAlpha = 0.35; stroke(g, r() * W, r() * H, 60 + r() * 60, 18 + r() * 20, r() * 3, jit(sp.mottle, r, 0.06), r, 0.5); g.globalAlpha = 1; }
    if (sp.glaze && sp.glazeAt != null && sp.glazeAt < 1) {
      // glaze pooled over the body with a wavy boundary and drips
      const fromBottom = sp.glazeFrom === 'bottom';
      const yb = (1 - sp.glazeAt) * H, amp = H * 0.045;
      const edge = x => yb + (fbm2(x / W * 6, sp.glazeAt * 7) - 0.5) * amp * 2.2;
      g.save(); g.beginPath();
      if (!fromBottom) { g.moveTo(0, -2); for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.lineTo(W, -2); }
      else { g.moveTo(0, H + 2); for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.lineTo(W, H + 2); }
      g.closePath(); g.clip();
      wash(g, 0, 0, W, H, sp.glaze, r, { len: 80, w: 18, n: 1.2, a: 0.25 });
      g.restore();
      // drips
      for (let i = 0; i < (sp.drips || 0); i++) {
        const x = (i + r() * 0.7) / (sp.drips) * W, y0 = edge(x), len = H * (0.06 + r() * 0.16) * (fromBottom ? -1 : 1), w = 6 + r() * 8;
        wrap(W, x, xx => {
          g.fillStyle = jit(sp.glaze, r, 0.03); g.beginPath();
          g.moveTo(xx - w / 2, y0 - (fromBottom ? -2 : 2)); g.quadraticCurveTo(xx - w * 0.45, y0 + len * 0.7, xx, y0 + len); g.quadraticCurveTo(xx + w * 0.45, y0 + len * 0.7, xx + w / 2, y0 - (fromBottom ? -2 : 2)); g.fill();
        });
      }
      // a darker pooled line along the glaze edge
      g.strokeStyle = shade(sp.glaze, -0.12, 0, 0.35); g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.stroke();
    }
    for (const b of sp.bands || []) band(g, W, H, b, r);
    if (sp.band) band(g, W, H, sp.band, r);
    if (sp.motif) {
      const n = sp.motifN || 2, s = H * 0.085;
      for (let i = 0; i < n; i++) { const x = (0.25 + i / n) % 1 * W; wrap(W, x, xx => motif(g, sp.motif, xx, (1 - sp.motifAt) * H, s * (sp.motif === 'dots' ? 0.6 : 1), sp.motifColor || '#2c1d16', r)); }
    }
    if (sp.petals) {
      for (let i = 0; i < 9; i++) {
        const x = i / 9 * W;
        g.strokeStyle = shade(sp.glaze || sp.base, -0.2, 0, 0.6); g.lineWidth = 3;
        wrap(W, x, xx => { wobble(g, [[xx, H], [xx + 2, H * 0.6], [xx - 1, H * 0.3]], r, 2); g.stroke(); });
        g.fillStyle = shade(sp.base, 0.1, 0, 0.25); stroke(g, x + W / 18, H * 0.35, H * 0.5, W / 30, Math.PI / 2, shade(sp.base, 0.12, 0, 0.3), r);
      }
    }
    if (sp.feathers) {
      g.strokeStyle = shade(sp.base, -0.15, 0, 0.55); g.lineWidth = 2;
      for (let row = 0; row < 6; row++) for (let i = 0; i < 12; i++) {
        const x = (i + (row % 2) * 0.5) / 12 * W, y = H * (0.25 + row * 0.07);
        g.beginPath(); g.arc(x, y, W / 30, 0.2, Math.PI - 0.2); g.stroke();
      }
    }
    if (sp.speck) speckle(g, 0, 0, W, H, sp.speck, r, 1.1, 1.8);
    // faint thrown rings
    for (let i = 0; i < 9; i++) { g.fillStyle = shade(sp.base, r() < 0.5 ? 0.06 : -0.06, 0, 0.12); g.fillRect(0, r() * H, W, 1 + r() * 1.5); }
  }

  function grain(g, x0, y0, w, h, base, r, o = {}) {
    const ang = o.vertical ? Math.PI / 2 : 0;
    wash(g, x0, y0, w, h, base, r, { len: 150, w: 22, n: 1.1, spread: 0.06, dry: 0.8, angle: ang, a: 0.28, dl: 0.09 });
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    // broad painted figure in the grain
    for (let i = 0; i < (o.vertical ? w : h) / 22; i++) {
      const off = r() * (o.vertical ? w : h), L = o.vertical ? h : w;
      g.globalAlpha = 0.22 + r() * 0.2;
      const col = r() < 0.6 ? shade(base, -0.12, 0.04) : shade(base, 0.09, -0.02);
      for (let t = -20; t < L + 20; t += 70) {
        const x = o.vertical ? x0 + off + Math.sin(t / 50 + i) * 4 : x0 + t, y = o.vertical ? y0 + t : y0 + off + Math.sin(t / 50 + i) * 4;
        stroke(g, x, y, 90 + r() * 40, 4 + r() * 6, ang + (r() - 0.5) * 0.08, col, r, 0.08);
      }
    }
    g.globalAlpha = 1;
    const lines = Math.round((o.vertical ? w : h) / 9);
    const dark = shade(base, -0.17, 0.03, 0.45), light = shade(base, 0.1, 0, 0.3);
    for (let i = 0; i < lines; i++) {
      const off = r() * (o.vertical ? w : h), ph = r() * 10, amp = 1 + r() * 3;
      g.strokeStyle = r() < 0.75 ? dark : light; g.lineWidth = 1 + r() * 1.6; g.beginPath();
      const L = o.vertical ? h : w;
      for (let t = 0; t <= L; t += 8) {
        const d = Math.sin(t / 41 + ph) * amp + (noise2(t / 70, i) - 0.5) * 5;
        if (o.vertical) g.lineTo(x0 + off + d, y0 + t); else g.lineTo(x0 + t, y0 + off + d);
      }
      g.stroke();
    }
    if (!o.noKnots && w * h > 9000) for (let k = 0; k < 2; k++) {
      const kx = x0 + r() * w, ky = y0 + r() * h;
      g.strokeStyle = shade(base, -0.2, 0, 0.55); g.lineWidth = 1.6;
      for (let j = 1; j < 4; j++) { g.beginPath(); g.ellipse(kx, ky, j * 6, j * 2.6, o.vertical ? Math.PI / 2 : 0, 0, 7); g.stroke(); }
    }
    speckle(g, x0, y0, w, h, shade(base, -0.25), r, 0.25, 1.2);
    g.restore();
  }
  function cells(W, H) {
    const cw = W / 3, ch = H / 2;
    const c = (col, row) => ({ x: col * cw, y: row * ch, w: cw, h: ch });
    return { front: c(0, 0), back: c(1, 0), top: c(2, 0), right: c(0, 1), left: c(1, 1), bottom: c(2, 1) };
  }
  function prismCells(W, H) { return { front: { x: 0, y: 0, w: W / 2, h: H * 0.7 }, back: { x: W / 2, y: 0, w: W / 2, h: H * 0.7 }, sides: { x: 0, y: H * 0.7, w: W, h: H * 0.3 } }; }
  function rrect(g, x, y, w, h, rad) { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath(); }
  function inkRect(g, x, y, w, h, color, r, lw = 2) { g.strokeStyle = color; g.lineWidth = lw; wobble(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, 1.6, true); g.stroke(); }

  function wood(g, W, H, sp, r) {
    const face = sp.face;
    if (!face) { grain(g, 0, 0, W, H, sp.base, r, { noKnots: sp.plain }); }
    if (sp.painted) { // painted wood with worn edges
      g.globalAlpha = 0.85; wash(g, 0, 0, W, H, sp.base, r, { len: 60, n: 1 }); g.globalAlpha = 1;
      for (let i = 0; i < 40; i++) { g.fillStyle = shade('#8a5a34', 0, 0, 0.5); g.beginPath(); g.ellipse(r() * W, r() < 0.5 ? r() * 8 : H - r() * 8, 4 + r() * 10, 1 + r() * 2, 0, 0, 7); g.fill(); }
    }
    if (sp.horse) {
      // saddle and dapples
      g.fillStyle = '#7f9db4'; rrect(g, W * 0.3, H * 0.35, W * 0.25, H * 0.3, 8); g.fill();
      for (const t of [0.42, 0.48]) { g.fillStyle = '#efe2c4'; g.fillRect(W * 0.3, H * t, W * 0.25, 2); }
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,240,215,0.35)'; g.beginPath(); g.arc(r() * W, r() * H, 3 + r() * 5, 0, 7); g.fill(); }
    }
    if (sp.mask) maskFace(g, W, H, sp, r);
    if (!face) return;
    if (face === 'radio' || face === 'gramo' || face === 'chest' || face === 'chestlid') {
      const C = cells(W, H);
      for (const k of Object.keys(C)) { const c = C[k]; grain(g, c.x, c.y, c.w, c.h, sp.base, r, { vertical: k === 'right' || k === 'left' }); }
      const f = C.front;
      if (face === 'radio') {
        // fabric grille, dial window and trim
        const gx = f.x + f.w * 0.1, gy = f.y + f.h * 0.14, gw = f.w * 0.52, gh = f.h * 0.66;
        g.fillStyle = '#d8c49a'; rrect(g, gx, gy, gw, gh, 10); g.fill();
        g.save(); rrect(g, gx, gy, gw, gh, 10); g.clip();
        for (let i = 0; i < gw; i += 3) { g.fillStyle = 'rgba(90,60,30,0.25)'; g.fillRect(gx + i, gy, 1, gh); }
        for (let i = 0; i < gh; i += 3) { g.fillStyle = 'rgba(90,60,30,0.18)'; g.fillRect(gx, gy + i, gw, 1); }
        g.strokeStyle = 'rgba(74,48,32,0.8)'; g.lineWidth = 3;
        for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(gx + gw * i / 5, gy); g.lineTo(gx + gw * i / 5 + (r() - 0.5) * 3, gy + gh); g.stroke(); }
        g.restore();
        inkRect(g, gx, gy, gw, gh, '#3a2418', r, 2.5);
        const dx = f.x + f.w * 0.68, dy = f.y + f.h * 0.16, dw = f.w * 0.26, dh = f.h * 0.3;
        g.fillStyle = '#efe2c4'; rrect(g, dx, dy, dw, dh, 6); g.fill();
        g.fillStyle = '#9a4a2a'; g.fillRect(dx + dw * 0.5, dy + 4, 2, dh - 8);
        g.fillStyle = '#3a2418'; for (let i = 0; i < 7; i++) g.fillRect(dx + 6 + i * (dw - 12) / 6, dy + dh - 9, 1.5, 6);
        inkRect(g, dx, dy, dw, dh, '#3a2418', r, 2);
        g.fillStyle = '#c4993f'; g.fillRect(f.x + 4, f.y + f.h - 10, f.w - 8, 3);
      } else if (face === 'gramo') {
        g.fillStyle = '#c4993f'; rrect(g, f.x + f.w * 0.35, f.y + f.h * 0.4, f.w * 0.3, f.h * 0.18, 4); g.fill();
        inkRect(g, f.x + f.w * 0.35, f.y + f.h * 0.4, f.w * 0.3, f.h * 0.18, '#4a3020', r, 1.5);
        g.strokeStyle = 'rgba(58,36,24,0.7)'; g.lineWidth = 2; inkRect(g, f.x + 6, f.y + 6, f.w - 12, f.h - 12, 'rgba(58,36,24,0.6)', r, 2);
        const rt = C.right; g.fillStyle = '#3a2418'; g.beginPath(); g.arc(rt.x + rt.w * 0.5, rt.y + rt.h * 0.45, 5, 0, 7); g.fill();
      } else {
        // brass straps and keyhole (chest), straps on the lid
        for (const k of ['front', 'back', 'top', 'right', 'left']) {
          const c = C[k];
          for (const t of [0.18, 0.82]) {
            const vertical = k !== 'right' && k !== 'left';
            g.fillStyle = '#c99d43';
            if (vertical) g.fillRect(c.x + c.w * t - 5, c.y, 10, c.h); else g.fillRect(c.x, c.y + c.h * t - 5, c.w, 10);
            g.fillStyle = 'rgba(80,55,20,0.6)';
            for (let i = 0; i < 4; i++) { const p = (i + 0.5) / 4; g.beginPath(); if (vertical) g.arc(c.x + c.w * t, c.y + c.h * p, 1.8, 0, 7); else g.arc(c.x + c.w * p, c.y + c.h * t, 1.8, 0, 7); g.fill(); }
          }
          inkRect(g, c.x + 3, c.y + 3, c.w - 6, c.h - 6, 'rgba(58,36,24,0.55)', r, 1.6);
        }
        if (face === 'chest') { g.fillStyle = '#c99d43'; g.beginPath(); g.arc(f.x + f.w / 2, f.y + f.h * 0.35, 8, 0, 7); g.fill(); g.fillStyle = '#2c1d16'; g.beginPath(); g.arc(f.x + f.w / 2, f.y + f.h * 0.33, 2.4, 0, 7); g.fill(); g.fillRect(f.x + f.w / 2 - 1, f.y + f.h * 0.33, 2, 6); }
      }
      return;
    }
    if (face === 'tv' || face === 'portrait' || face === 'clock') {
      const P = prismCells(W, H);
      grain(g, 0, 0, W, H, sp.base, r);
      const f = P.front;
      if (face === 'tv') {
        const sx = f.x + f.w * 0.1, sy = f.y + f.h * 0.12, sw = f.w * 0.6, sh = f.h * 0.68;
        g.fillStyle = '#e0b48a'; rrect(g, sx - 6, sy - 6, sw + 12, sh + 12, 18); g.fill();
        const grd = g.createLinearGradient(sx, sy, sx + sw, sy + sh); grd.addColorStop(0, '#5f7d80'); grd.addColorStop(1, '#2c3f42');
        g.fillStyle = grd; rrect(g, sx, sy, sw, sh, 16); g.fill();
        g.globalAlpha = 0.5; stroke(g, sx + sw * 0.3, sy + sh * 0.25, sw * 0.4, 7, -0.5, '#cfe0dc', r); stroke(g, sx + sw * 0.25, sy + sh * 0.4, sw * 0.18, 4, -0.5, '#cfe0dc', r); g.globalAlpha = 1;
        inkRect(g, sx, sy, sw, sh, '#2c1d16', r, 2.5);
        for (const t of [0.3, 0.55]) { g.fillStyle = '#f0d8a8'; g.beginPath(); g.arc(f.x + f.w * 0.85, f.y + f.h * t, 9, 0, 7); g.fill(); g.strokeStyle = '#3a2418'; g.lineWidth = 2; g.stroke(); }
        g.fillStyle = 'rgba(58,36,24,0.7)'; for (let i = 0; i < 5; i++) g.fillRect(f.x + f.w * 0.78, f.y + f.h * (0.72 + i * 0.035), f.w * 0.14, 2);
      } else if (face === 'portrait') {
        const ix = f.x + f.w * 0.14, iy = f.y + f.h * 0.12, iw = f.w * 0.72, ih = f.h * 0.76;
        g.fillStyle = '#c99d43'; g.fillRect(ix - 5, iy - 5, iw + 10, ih + 10);
        wash(g, ix, iy, iw, ih, '#d6b06a', r, { len: 40, w: 12, n: 1.2 });
        // sitter: shoulders, neck, face, hair
        g.fillStyle = '#7f9db4'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 1.02, iw * 0.42, ih * 0.32, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#efd9bf'; g.fillRect(ix + iw * 0.45, iy + ih * 0.52, iw * 0.1, ih * 0.18);
        g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.42, iw * 0.15, ih * 0.15, 0, 0, 7); g.fill();
        g.fillStyle = '#d9c6b0'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.33, iw * 0.21, ih * 0.13, 0, Math.PI, 0); g.fill();
        for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(ix + iw * (0.32 + k * 0.05), iy + ih * (0.3 + Math.sin(k) * 0.03), iw * 0.05, 0, 7); g.fill(); }
        g.strokeStyle = '#2c1d16'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(ix + iw * 0.45, iy + ih * 0.42, 3, 0.2, Math.PI - 0.2); g.stroke(); g.beginPath(); g.arc(ix + iw * 0.55, iy + ih * 0.42, 3, 0.2, Math.PI - 0.2); g.stroke();
        g.fillStyle = '#9a4a2a'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.5, 3, 1.5, 0, 0, 7); g.fill();
        g.strokeStyle = '#2c1d16'; g.lineWidth = 2; wobble(g, [[ix + iw * 0.3, iy + ih], [ix + iw * 0.38, iy + ih * 0.75], [ix + iw * 0.5, iy + ih * 0.72], [ix + iw * 0.62, iy + ih * 0.75], [ix + iw * 0.7, iy + ih]], r, 1.5); g.stroke();
        inkRect(g, ix, iy, iw, ih, '#2c1d16', r, 2);
        const b = P.back; wash(g, b.x, b.y, b.w, b.h, '#8a6a4a', r, { len: 30, n: 1 }); g.strokeStyle = '#3a2418'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x + b.w * 0.35, b.y + b.h * 0.25); g.lineTo(b.x + b.w / 2, b.y + b.h * 0.15); g.lineTo(b.x + b.w * 0.65, b.y + b.h * 0.25); g.stroke();
      } else {
        inkRect(g, f.x + 8, f.y + 8, f.w - 16, f.h - 16, 'rgba(239,226,196,0.7)', r, 2);
        for (let i = 0; i < 6; i++) motif(g, 'dots', f.x + f.w * (0.2 + i * 0.12), f.y + f.h * 0.88, 10, '#c99d43', r);
      }
      return;
    }
  }

  function maskFace(g, W, H, sp, r) {
    // planar UV seen from above: v = 1 at the mask's top (-z)
    wash(g, 0, 0, W, H, sp.base, r, { len: 50, w: 14, n: 1.4 });
    const cx = W / 2;
    g.fillStyle = '#efe2c4';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * W * 0.18, H * 0.38, W * 0.13, H * 0.07, s * 0.25, 0, 7); g.fill(); }
    g.fillStyle = '#2c1d16';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * W * 0.18, H * 0.38, W * 0.07, H * 0.035, s * 0.25, 0, 7); g.fill(); }
    g.fillStyle = '#d9a933'; g.beginPath(); g.moveTo(cx, H * 0.4); g.lineTo(cx + W * 0.06, H * 0.6); g.lineTo(cx - W * 0.06, H * 0.6); g.closePath(); g.fill();
    g.fillStyle = '#2c1d16'; g.beginPath(); g.ellipse(cx, H * 0.74, W * 0.12, H * 0.035, 0, 0, 7); g.fill();
    g.strokeStyle = '#efe2c4'; g.lineWidth = 3;
    wobble(g, [[cx - W * 0.3, H * 0.2], [cx - W * 0.15, H * 0.15], [cx, H * 0.2], [cx + W * 0.15, H * 0.15], [cx + W * 0.3, H * 0.2]], r, 2); g.stroke();
    for (const s of [-1, 1]) { for (let i = 0; i < 4; i++) { g.fillStyle = '#d9a933'; g.beginPath(); g.arc(cx + s * W * (0.32 + i * 0.03), H * (0.5 + i * 0.07), 3, 0, 7); g.fill(); } }
    g.strokeStyle = '#2f6b66'; g.lineWidth = 3;
    for (const s of [-1, 1]) { wobble(g, [[cx + s * W * 0.08, H * 0.86], [cx + s * W * 0.22, H * 0.8], [cx + s * W * 0.3, H * 0.66]], r, 2); g.stroke(); }
  }

  function brass(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 40, w: 10, n: 1.6, dl: 0.09 });
    for (let i = 0; i < W * H / 1800; i++) { g.globalAlpha = 0.35; stroke(g, r() * W, r() * H, 20 + r() * 40, 8 + r() * 14, r() * 3, jit('#6b5a2a', r, 0.05), r, 0.6); }
    g.globalAlpha = 1;
    // painted glints: crisp light strokes, not a metallic gradient
    for (let i = 0; i < W / 22; i++) { stroke(g, r() * W, r() * H, 10 + r() * 30, 2 + r() * 4, Math.PI / 2 + (r() - 0.5) * 0.3, `rgba(255,236,170,${0.35 + r() * 0.4})`, r); }
    speckle(g, 0, 0, W, H, '#5a4520', r, 0.6, 1.4);
    if (sp.face === 'mirror') { /* the glass is a separate disc */ }
  }

  function paper(g, W, H, sp, r) {
    const base = sp.base || '#eadcbc';
    wash(g, 0, 0, W, H, base, r, { len: 50, w: 16, n: 0.8, a: 0.15, dl: 0.04 });
    paperGrain(g, W, H, r, 0.05);
    for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(150,100,50,${0.05 + r() * 0.08})`; g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 9, 0, 7); g.fill(); }
    const ink = '#3d2a1e';
    const script = (x0, y0, w, h, rows, color = ink, lw = 1.3) => {
      g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
      for (let row = 0; row < rows; row++) {
        const y = y0 + (row + 0.7) * h / rows; let x = x0 + r() * 8; const end = x0 + w * (0.7 + r() * 0.3);
        g.beginPath(); g.moveTo(x, y);
        while (x < end) {
          const wd = 3 + r() * 5, ht = h / rows * (0.25 + r() * 0.35);
          g.bezierCurveTo(x + wd * 0.3, y - ht, x + wd * 0.9, y - ht, x + wd, y + (r() - 0.5) * 2);
          x += wd; if (r() < 0.12) { x += 5; g.moveTo(x, y); }
        }
        g.stroke();
      }
    };
    if (sp.script) { script(10, 10, W - 20, H - 20, 14); g.strokeStyle = 'rgba(120,80,40,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); }
    if (sp.envelope) {
      const C = cells(W, H), t = C.top;
      g.strokeStyle = 'rgba(80,55,30,0.45)'; g.lineWidth = 2;
      wobble(g, [[t.x + 4, t.y + 4], [t.x + t.w / 2, t.y + t.h * 0.55], [t.x + t.w - 4, t.y + 4]], r, 1.5); g.stroke();
      script(t.x + t.w * 0.3, t.y + t.h * 0.6, t.w * 0.55, t.h * 0.3, 3, ink, 1);
      if (sp.stamp) { g.fillStyle = '#9a4a2a'; g.fillRect(t.x + t.w * 0.78, t.y + t.h * 0.12, t.w * 0.14, t.h * 0.22); g.strokeStyle = '#efe2c4'; g.setLineDash([2, 2]); g.strokeRect(t.x + t.w * 0.78, t.y + t.h * 0.12, t.w * 0.14, t.h * 0.22); g.setLineDash([]); }
      g.fillStyle = '#9a4a2a'; g.fillRect(t.x, t.y + t.h * 0.47, t.w, 3);
    }
    if (sp.roll) { for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(120,80,40,0.25)'; g.fillRect(r() * W, 0, 2, H); } script(10, H * 0.15, W - 20, H * 0.7, 6, 'rgba(61,42,30,0.6)', 1); g.fillStyle = '#7c2f35'; g.fillRect(W * 0.47, 0, W * 0.06, H); }
    if (sp.rollEnd) { g.strokeStyle = 'rgba(110,70,35,0.6)'; g.lineWidth = 1.5; g.beginPath(); for (let a = 0; a < 30; a += 0.1) { const rr = a * W / 70; g.lineTo(W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr); } g.stroke(); }
    if (sp.face === 'journal' || sp.face === 'notebook') {
      const C = cells(W, H), journal = sp.face === 'journal';
      const cover = journal ? '#5a4a2c' : '#2f6b66';
      for (const k of ['top', 'bottom']) {
        const c = C[k]; wash(g, c.x, c.y, c.w, c.h, cover, r, { len: 30, w: 12, n: 1.6 });
        inkRect(g, c.x + 8, c.y + 8, c.w - 16, c.h - 16, journal ? 'rgba(201,157,67,0.8)' : 'rgba(239,226,196,0.6)', r, 2);
        if (journal) { motif(g, 'sun', c.x + c.w / 2, c.y + c.h / 2, c.w * 0.18, 'rgba(201,157,67,0.85)', r); for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { g.fillStyle = 'rgba(30,20,10,0.45)'; g.beginPath(); g.arc(c.x + cx * c.w, c.y + cy * c.h, 12, 0, 7); g.fill(); } }
        else { g.fillStyle = '#efe2c4'; g.fillRect(c.x + c.w * 0.25, c.y + c.h * 0.3, c.w * 0.5, c.h * 0.18); g.fillStyle = '#21504d'; g.fillRect(c.x + c.w * 0.82, c.y, 5, c.h); }
      }
      for (const k of ['front', 'back', 'right']) { // page block
        const c = C[k]; g.fillStyle = '#eadcbc'; g.fillRect(c.x, c.y, c.w, c.h);
        const vertical = false;
        for (let i = 0; i < c.h; i += 2) { g.fillStyle = `rgba(${120 + r() * 40},${90 + r() * 30},${50},${0.15 + r() * 0.25})`; g.fillRect(c.x, c.y + i, c.w, 1); }
        g.fillStyle = cover; g.fillRect(c.x, c.y, c.w, c.h * 0.1); g.fillRect(c.x, c.y + c.h * 0.9, c.w, c.h * 0.1);
        if (journal && k === 'front') { g.fillStyle = '#c4553a'; g.fillRect(c.x + c.w * 0.6, c.y + c.h * 0.1, 6, c.h * 0.8); }
        if (vertical) break;
      }
      const s = C.left; wash(g, s.x, s.y, s.w, s.h, cover, r, { len: 20, n: 1.5 });
      for (const t of [0.2, 0.4, 0.6, 0.8]) { g.fillStyle = 'rgba(201,157,67,0.7)'; g.fillRect(s.x + s.w * t, s.y, 3, s.h); }
    }
    if (sp.card) {
      const C = cells(W, H), t = C.top;
      if (sp.card === 'sea') {
        g.fillStyle = '#a9c1cf'; g.fillRect(t.x + 6, t.y + 6, t.w - 12, t.h * 0.5);
        g.fillStyle = '#2f6b66'; g.fillRect(t.x + 6, t.y + t.h * 0.5, t.w - 12, t.h * 0.5 - 6);
        g.strokeStyle = '#efe2c4'; g.lineWidth = 1.5; for (let i = 0; i < 5; i++) { g.beginPath(); for (let x = 0; x < t.w - 12; x += 6) g.lineTo(t.x + 6 + x, t.y + t.h * (0.6 + i * 0.07) + Math.sin(x / 6) * 1.5); g.stroke(); }
        g.fillStyle = '#d9a933'; g.beginPath(); g.arc(t.x + t.w * 0.7, t.y + t.h * 0.3, 8, 0, 7); g.fill();
      } else if (sp.card === 'hill') {
        g.fillStyle = '#efd9a8'; g.fillRect(t.x + 6, t.y + 6, t.w - 12, t.h - 12);
        g.fillStyle = '#c98e2f'; g.beginPath(); g.moveTo(t.x + 6, t.y + t.h - 6); g.lineTo(t.x + t.w * 0.45, t.y + t.h * 0.25); g.lineTo(t.x + t.w - 6, t.y + t.h - 6); g.fill();
        g.fillStyle = '#7b7a3c'; g.fillRect(t.x + 6, t.y + t.h * 0.8, t.w - 12, t.h * 0.2 - 6);
      } else { script(t.x + 10, t.y + 10, t.w * 0.55, t.h - 20, 5, ink, 1); g.strokeStyle = 'rgba(61,42,30,0.5)'; g.beginPath(); g.moveTo(t.x + t.w * 0.66, t.y + 10); g.lineTo(t.x + t.w * 0.66, t.y + t.h - 10); g.stroke(); g.fillStyle = '#7c2f35'; g.fillRect(t.x + t.w * 0.8, t.y + 10, 16, 20); }
      inkRect(g, t.x + 6, t.y + 6, t.w - 12, t.h - 12, 'rgba(58,36,24,0.6)', r, 1.4);
    }
    if (sp.leaf) { g.strokeStyle = '#4b7350'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke(); }
  }

  function flat(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 40, w: 12, n: 1.3 });
    if (sp.mottle) for (let i = 0; i < 12; i++) { g.globalAlpha = 0.4; stroke(g, r() * W, r() * H, 40, 16, r() * 3, jit(sp.mottle, r), r, 0.5); g.globalAlpha = 1; }
    if (sp.ring) { g.strokeStyle = sp.ring; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, 7); g.stroke(); g.fillStyle = sp.ring; g.fillRect(W / 2 - 1.5, H * 0.2, 3, H * 0.3); }
    if (sp.drip) for (let i = 0; i < 4; i++) { const x = r() * W; g.fillStyle = '#f7eedb'; g.beginPath(); g.moveTo(x - 6, H * 0.0); g.quadraticCurveTo(x - 5, H * 0.3, x, H * (0.25 + r() * 0.3)); g.quadraticCurveTo(x + 5, H * 0.3, x + 6, 0); g.fill(); }
    if (sp.record) { g.strokeStyle = 'rgba(200,190,170,0.18)'; for (let rr = 6; rr < W / 2; rr += 3) { g.beginPath(); g.arc(W / 2, H / 2, rr, 0, 7); g.stroke(); } g.fillStyle = '#9a4a2a'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.12, 0, 7); g.fill(); }
    if (sp.dial) {
      g.fillStyle = '#f3ead2'; g.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
      g.strokeStyle = '#2c1d16'; g.lineWidth = 2;
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82); g.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95); g.stroke(); }
      g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * 0.45, cy - R * 0.2); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - R * 0.1, cy - R * 0.7); g.stroke();
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    }
    if (sp.tip) { g.fillStyle = sp.tip; g.fillRect(0, 0, W, H * 0.08); }
    if (sp.leaf) { g.strokeStyle = '#3f6545'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(W * 0.1, H * (0.2 + i * 0.15)); g.lineTo(W * 0.9, H * (0.1 + i * 0.15)); g.stroke(); } }
  }

  // Drawer surfaces.
  function drawerWood(g, W, H, sp, r) { grain(g, 0, 0, W, H, sp.base, r, { noKnots: false }); }
  function felt(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 30, w: 20, n: 2.2, a: 0.18, dl: 0.04, dry: 0.4 });
    for (let i = 0; i < W * H / 6; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
    // stitched border
    g.strokeStyle = shade(sp.base, 0.22, -0.1, 0.65); g.lineWidth = 2; g.setLineDash([7, 6]);
    g.strokeRect(14, 14, W - 28, H - 28); g.setLineDash([]);
  }
  function paperBg(W, H, seed) {
    const c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
    wash(g, 0, 0, W, H, '#efe4cc', r, { len: 140, w: 40, n: 0.5, a: 0.1, dl: 0.03 });
    paperGrain(g, W, H, r, 0.045);
    return c;
  }

  const FNS = { ceramic, wood, brass, paper, flat, drawerWood, felt };
  // Paint a texture for a material spec. Size depends on how the surface is mapped.
  function texture(spec, layout, seed) {
    const big = layout === 'box' || layout === 'prism' || layout === 'dome';
    const W = big ? 512 : layout === 'lathe' ? 512 : 256, H = big ? 384 : layout === 'lathe' ? 384 : 128;
    const c = canvas(W, H), g = c.getContext('2d');
    const r = rng(seed);
    (FNS[spec.fn] || flat)(g, W, H, spec, r);
    return c;
  }

  return { texture, paperBg, canvas, mixHex, shade, hexRgb, FNS };
})();

// ---- 06_render.js ----
// Rendering: painterly materials, inked outlines, geometry built from the same features
// as the collision parts, the drawer, the presentation tray and the two cameras.

function createView(THREE, canvas, opts) {
  const { noise3, rng, clamp, lerp } = U;
  const lowPower = !!opts.lowPower;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(opts.dpr || 1, lowPower ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const scene = new THREE.Scene(), trayScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  const trayCam = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 200);

  // ---- lights: warm key from upper left, cool fill, warm bounce ----
  const hemi = new THREE.HemisphereLight(0xfff0d8, 0x7a5a44, 1.25); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe0b4, 2.1);
  key.position.set(-18, 34, 22); key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  key.shadow.radius = 4; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x9fb8cc, 0.45); fill.position.set(24, 10, -6); scene.add(fill);
  const tHemi = new THREE.HemisphereLight(0xfff0d8, 0x7a5a44, 1.35); trayScene.add(tHemi);
  const tKey = new THREE.DirectionalLight(0xffe0b4, 1.9); tKey.position.set(-10, 20, 18); trayScene.add(tKey);
  const tFill = new THREE.DirectionalLight(0x9fb8cc, 0.4); tFill.position.set(14, 6, -4); trayScene.add(tFill);

  // ground that only shows shadows (the page is painted paper behind the canvas)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x4a2e1e, opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // ---- gouache shading ----
  const ramp = (() => {
    const n = 64, d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1), s = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
      const v = 0.3 + 0.3 * s(0.43, 0.53, x) + 0.4 * s(0.6, 0.8, x);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255); d[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
  })();
  const KIND = {
    ceramic: { spec: 0.75, shin: 70, thr: 0.5, edge: 0.7, col: [1, 0.97, 0.9] },
    brass: { spec: 1.1, shin: 26, thr: 0.35, edge: 0.9, col: [1, 0.9, 0.62] },
    metal: { spec: 0.6, shin: 40, thr: 0.45, edge: 0.6, col: [1, 1, 1] },
    wood: { spec: 0.14, shin: 14, thr: 0.5, edge: 0.6, col: [1, 0.95, 0.85] },
    paper: { spec: 0.0, shin: 8, thr: 0.5, edge: 0.45, col: [1, 1, 1] },
    wax: { spec: 0.22, shin: 10, thr: 0.4, edge: 0.3, col: [1, 1, 0.95] },
    glass: { spec: 1.2, shin: 90, thr: 0.4, edge: 0.4, col: [1, 1, 1] },
    felt: { spec: 0, shin: 4, thr: 0.5, edge: 0.2, col: [1, 1, 1] },
  };
  const shared = { uGround: { value: 0 }, uGrain: { value: 1 }, uPx: { value: 0.0006 }, uOrtho: { value: 0 } };
  function painterly(params) {
    const k = KIND[params.kind] || KIND.wood;
    const mat = new THREE.MeshToonMaterial({ color: params.color || 0xffffff, map: params.map || null, gradientMap: ramp, transparent: !!params.transparent, opacity: params.opacity == null ? 1 : params.opacity, side: params.side || THREE.FrontSide });
    const u = {
      uSpec: { value: k.spec }, uShin: { value: k.shin }, uThr: { value: k.thr }, uEdge: { value: k.edge },
      uSpecCol: { value: new THREE.Color().setRGB(k.col[0], k.col[1], k.col[2]) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 }, uAOH: { value: params.aoH == null ? 2.2 : params.aoH }, uAOMin: { value: params.aoMin == null ? 0.66 : params.aoMin },
      uGround: shared.uGround, uGrain: shared.uGrain,
    };
    mat.userData.u = u;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vWPos; uniform float uSpec, uShin, uThr, uEdge, uTintAmt, uAOH, uAOMin, uGround, uGrain; uniform vec3 uSpecCol, uTint;
float olt_h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
` + sh.fragmentShader
        .replace('#include <opaque_fragment>', `
  {
    vec3 Vd = normalize(vViewPosition);
    #if NUM_DIR_LIGHTS > 0
      vec3 Hh = normalize(directionalLights[0].direction + Vd);
      float sp = pow(max(dot(normal, Hh), 0.0), uShin);
      sp = smoothstep(uThr, uThr + 0.14, sp) * uSpec;
      outgoingLight += uSpecCol * sp * 0.42;
    #endif
    float fres = 1.0 - max(dot(normal, Vd), 0.0);
    outgoingLight *= 1.0 - uEdge * 0.32 * pow(fres, 2.2);
    outgoingLight *= mix(uAOMin, 1.0, smoothstep(0.0, uAOH, vWPos.y - uGround));
    outgoingLight = mix(outgoingLight, uTint, uTintAmt);
  }
  #include <opaque_fragment>`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  gl_FragColor.rgb *= 1.0 + (olt_h(floor(gl_FragCoord.xy / 1.5)) - 0.5) * 0.08 * uGrain;`);
    };
    mat.customProgramCacheKey = () => 'olt-painterly';
    return mat;
  }

  // inked outline: inverted hull, constant screen width, wobbling thickness
  function outlineMat(color, width, seed) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uW: { value: width }, uSeed: { value: seed || 0 }, uOpacity: { value: 1 }, uPx: shared.uPx, uOrtho: shared.uOrtho },
      vertexShader: `attribute vec3 sNormal; uniform float uW, uSeed, uPx, uOrtho;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * sNormal);
          float j = 0.62 + 0.75 * (0.5 + 0.5 * sin(position.x * 2.1 + position.y * 3.3 + uSeed) * sin(position.z * 2.7 - position.y * 1.7 + uSeed * 1.3));
          mv.xyz += n * uW * uPx * mix(-mv.z, 1.0, uOrtho) * j;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
      side: THREE.BackSide, transparent: true,
    });
  }
  // smooth normals for outline hulls (merge coincident positions)
  function smoothNormals(geo) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const map = new Map(), acc = new Float32Array(n * 3);
    const key = i => `${Math.round(pos.getX(i) * 400)},${Math.round(pos.getY(i) * 400)},${Math.round(pos.getZ(i) * 400)}`;
    const sums = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); let s = sums.get(k); if (!s) { s = [0, 0, 0]; sums.set(k, s); } s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i); map.set(i, s); }
    for (let i = 0; i < n; i++) { const s = map.get(i), l = Math.hypot(s[0], s[1], s[2]) || 1; acc[i * 3] = s[0] / l; acc[i * 3 + 1] = s[1] / l; acc[i * 3 + 2] = s[2] / l; }
    geo.setAttribute('sNormal', new THREE.BufferAttribute(acc, 3));
  }

  // ---- geometry builders (mirror Catalog.featParts) ----
  function buildGeo(positions, uvs, indices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (indices) g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
  function resample(prof, maxSeg) {
    const out = [prof[0]];
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1], b = prof[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.min(6, Math.ceil(L / maxSeg)));
      for (let j = 1; j <= k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
    }
    return out;
  }
  // Lathe along a 2D path; returns geometry with u around (0.25 = +z) and v along the path.
  function lathePath(path, segs, sx, sz, wob, seed, vRange = [0, 1], reverse = false) {
    const pos = [], uv = [], idx = [];
    let total = 0; const acc = [0];
    for (let i = 1; i < path.length; i++) { total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); acc.push(total); }
    for (let i = 0; i < path.length; i++) {
      const [r, y] = path[i];
      for (let j = 0; j <= segs; j++) {
        const a = j / segs * Math.PI * 2;
        const w = wob ? 1 + wob * (2 * noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, y * 0.35) - 1) : 1;
        pos.push(r * w * Math.cos(a) * sx, y, r * w * Math.sin(a) * sz);
        uv.push(j / segs, lerp(vRange[0], vRange[1], total ? acc[i] / total : 0));
      }
    }
    const row = segs + 1;
    for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * row + j, b = (i + 1) * row + j, c = i * row + j + 1, d = (i + 1) * row + j + 1;
      if (!reverse) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = buildGeo(pos, uv, idx);
    fixSeam(g, path.length, row);
    return g;
  }
  function fixSeam(g, rows, row) {
    const n = g.attributes.normal;
    for (let i = 0; i < rows; i++) {
      const a = i * row, b = i * row + row - 1;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  function disc(r, y, segs, sx, sz, up, wob, seed) {
    const pos = [0, y, 0], uv = [0.5, up ? 1 : 0], idx = [];
    for (let j = 0; j <= segs; j++) {
      const a = j / segs * Math.PI * 2;
      const w = wob ? 1 + wob * (2 * noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, y * 0.35) - 1) : 1;
      pos.push(r * w * Math.cos(a) * sx, y, r * w * Math.sin(a) * sz); uv.push(j / segs, up ? 0.98 : 0.02);
    }
    for (let j = 1; j <= segs; j++) up ? idx.push(0, j + 1, j) : idx.push(0, j, j + 1);
    return buildGeo(pos, uv, idx);
  }
  function boxGeo(corners) {
    const C = (x, y, z) => corners[(y > 0 ? 4 : 0) + (x > 0 ? 2 : 0) + (z > 0 ? 1 : 0)];
    const faces = [
      ['front', [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], ['back', [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      ['right', [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], ['left', [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      ['top', [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], ['bottom', [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    ];
    const cell = { front: [0, 0], back: [1, 0], top: [2, 0], right: [0, 1], left: [1, 1], bottom: [2, 1] };
    const pos = [], uv = [], idx = [];
    for (const [name, q] of faces) {
      const [c, r] = cell[name], base = pos.length / 3, u0 = c / 3, v1 = 1 - r * 0.5, v0 = v1 - 0.5;
      const uvq = [[0, 0], [1, 0], [1, 1], [0, 1]];
      q.forEach((s, k) => { const p = C(s[0], s[1], s[2]); pos.push(p[0], p[1], p[2]); uv.push(u0 + uvq[k][0] / 3 * 0.98 + 0.003, v0 + uvq[k][1] * 0.49 + 0.005); });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return buildGeo(pos, uv, idx);
  }
  function prismGeo(poly, depth) {
    let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const P = area < 0 ? poly.slice().reverse() : poly;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const [x, y] of P) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    const pos = [], uv = [], idx = [], hz = depth / 2;
    const s = x => (x - mnx) / (mxx - mnx || 1), t = y => (y - mny) / (mxy - mny || 1);
    let b = 0;
    for (const [x, y] of P) { pos.push(x, y, hz); uv.push(s(x) * 0.5, 0.3 + t(y) * 0.7); }
    for (let i = 1; i < P.length - 1; i++) idx.push(b, b + i, b + i + 1);
    b = pos.length / 3;
    for (const [x, y] of P) { pos.push(x, y, -hz); uv.push(0.5 + (1 - s(x)) * 0.5, 0.3 + t(y) * 0.7); }
    for (let i = 1; i < P.length - 1; i++) idx.push(b, b + i + 1, b + i);
    let per = 0; const L = [0];
    for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; per += Math.hypot(c[0] - a[0], c[1] - a[1]); L.push(per); }
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length]; b = pos.length / 3;
      pos.push(a[0], a[1], -hz, c[0], c[1], -hz, c[0], c[1], hz, a[0], a[1], hz);
      const u0 = L[i] / per, u1 = L[i + 1] / per;
      uv.push(u0, 0, u1, 0, u1, 0.29, u0, 0.29);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return buildGeo(pos, uv, idx);
  }
  function tubeGeo(path, r0, r1, closed) {
    const n = path.length, segs = 12, pos = [], uv = [], idx = [];
    const P = path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const T = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; return b.clone().sub(a).normalize(); });
    let N = new THREE.Vector3(0, 0, 1); if (Math.abs(T[0].z) > 0.9) N.set(1, 0, 0);
    N = N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) { N = N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize(); }
      frames.push([N.clone(), T[i].clone().cross(N).normalize()]);
    }
    for (let i = 0; i < n; i++) {
      const r = lerp(r0, r1, i / (n - 1)), [Nn, B] = frames[i];
      for (let j = 0; j <= segs; j++) {
        const a = j / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(P[i].x + (Nn.x * c + B.x * s) * r, P[i].y + (Nn.y * c + B.y * s) * r, P[i].z + (Nn.z * c + B.z * s) * r);
        uv.push(j / segs, i / (n - 1));
      }
    }
    const row = segs + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = i * row + j, b = (i + 1) * row + j; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    if (!closed) for (const [i, flip] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3; pos.push(P[i].x, P[i].y, P[i].z); uv.push(0.5, 0.5);
      for (let j = 0; j < segs; j++) { const a = i * row + j; flip ? idx.push(ci, a + 1, a) : idx.push(ci, a, a + 1); }
    }
    const g = buildGeo(pos, uv, idx);
    // tube winding may face inward depending on the frame handedness; check and flip
    g.computeBoundingSphere();
    return g;
  }

  // ---- materials & textures for an object definition ----
  const texCache = new Map();
  function texFor(def, key, layout, seedBase) {
    const id = def.id + ':' + key + ':' + layout;
    if (texCache.has(id)) return texCache.get(id);
    const spec = def.mats[key].paint;
    const cv = Paint.texture(spec, layout, seedBase + U.hashStr(key));
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.wrapS = THREE.RepeatWrapping;
    texCache.set(id, t);
    return t;
  }
  const matCache = new Map();
  function matFor(def, key, layout) {
    const id = def.id + ':' + key + ':' + layout;
    if (matCache.has(id)) return matCache.get(id);
    const m = painterly({ kind: def.mats[key].kind, map: texFor(def, key, layout, U.hashStr(def.id)) });
    matCache.set(id, m); return m;
  }
  function innerMat(def, key) {
    const id = def.id + ':' + key + ':inner';
    if (matCache.has(id)) return matCache.get(id);
    const p = def.mats[key].paint, c = p.inner || Paint.shade(p.glaze || p.base, -0.22);
    const m = painterly({ kind: 'ceramic', color: new THREE.Color(c), side: THREE.DoubleSide, aoMin: 0.45 });
    m.userData.u.uSpec.value = 0.2;
    matCache.set(id, m); return m;
  }
  const glassMat = painterly({ kind: 'glass', color: new THREE.Color('#9fb7c4') });

  // ---- object meshes ----
  function buildObject(def, scale, seed) {
    const group = new THREE.Group();
    const meshes = [];
    const add = (geo, mat, fp, fq, extra) => {
      const m = new THREE.Mesh(geo, mat);
      if (fp) m.position.set(fp[0], fp[1], fp[2]);
      if (fq) m.quaternion.set(fq[0], fq[1], fq[2], fq[3]);
      if (extra) extra(m);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); meshes.push(m); return m;
    };
    for (const f of def.feats) {
      const mat = def.mats[f.mat];
      switch (f.k) {
        case 'lathe': {
          const prof = resample(f.prof, 0.5), sx = f.sx || 1, sz = f.sz || 1, wob = f.wob || 0, sd = (seed % 97) * 0.37;
          add(lathePath(prof, 40, sx, sz, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          if (prof[0][0] > 0.01) add(disc(prof[0][0], prof[0][1], 40, sx, sz, false, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          const top = prof[prof.length - 1];
          if (f.open) {
            const th = Math.min(0.16, top[0] * 0.25), inner = [];
            if (f.open && top[0] > 1.6 && prof.length > 3 && def.id !== 'vase') {
              // wide open bell: inner surface follows the profile all the way down
              for (let i = prof.length - 1; i >= 0; i--) inner.push([Math.max(0.02, prof[i][0] - th), prof[i][1] + (i === 0 ? th : 0)]);
            } else {
              const depth = Math.min(1.6, (top[1] - prof[0][1]) * 0.3);
              inner.push([top[0] - th, top[1]], [top[0] - th, top[1] - depth * 0.5], [Math.max(0.05, top[0] - th * 1.6), top[1] - depth], [0.0, top[1] - depth]);
            }
            const lip = [[top[0], top[1]]].concat(inner);
            add(lathePath(lip, 40, sx, sz, wob, sd, [1, 1], true), innerMat(def, f.mat), f.p, f.q);
          } else if (top[0] > 0.01) add(disc(top[0], top[1], 40, sx, sz, true, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          break;
        }
        case 'bowl': {
          const rows = Catalog.bowlRows(f), path = [[f.rb, 0]];
          for (const r of rows) path.push([r.ro, r.y]);
          path.push([rows[rows.length - 1].ri, f.h]);
          for (let i = rows.length - 1; i >= 0; i--) path.push([rows[i].ri, rows[i].y]);
          path.push([0, f.floor * 0.6]);
          const pr = resample(path, 0.6);
          add(lathePath(pr, 48, 1, 1, 0, 0), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material = m.material; });
          add(disc(f.rb, 0, 48, 1, 1, false), matFor(def, f.mat, 'lathe'), f.p, f.q);
          break;
        }
        case 'cyl': {
          const g = new THREE.CylinderGeometry(f.r1 == null ? f.r0 : f.r1, f.r0, f.h, 32, 1);
          if (f.sx || f.sz) g.scale(f.sx || 1, 1, f.sz || 1);
          add(g, matFor(def, f.mat, 'lathe'), f.p, f.q);
          if (def.id === 'mirror' && f.mat === 'body') {
            const glass = new THREE.CylinderGeometry(f.r1 * 0.82, f.r1 * 0.82, 0.04, 40);
            add(glass, glassMat, [f.p[0], f.p[1] + f.h / 2 - 0.01, f.p[2]], f.q);
          }
          if (def.id === 'candle' && f.mat === 'wax') {
            add(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6), painterly({ kind: 'wood', color: new THREE.Color('#2c1d16') }), [f.p[0], f.p[1] + f.h / 2 - 0.3, f.p[2]], f.q);
          }
          break;
        }
        case 'box': {
          const corners = Catalog.boxCorners(f);
          add(boxGeo(corners), matFor(def, f.mat, 'box'), f.p, f.q);
          break;
        }
        case 'prism': add(prismGeo(f.poly, f.depth), matFor(def, f.mat, 'prism'), f.p, f.q); break;
        case 'sph': { const g = new THREE.SphereGeometry(1, 32, 20); g.scale(f.r[0], f.r[1], f.r[2]); add(g, matFor(def, f.mat, 'lathe'), f.p, f.q); break; }
        case 'cap': {
          const a = new THREE.Vector3(...f.a), b = new THREE.Vector3(...f.b), L = a.distanceTo(b);
          const g = new THREE.CapsuleGeometry(f.r, L, 5, 14);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          const mid = a.clone().add(b).multiplyScalar(0.5);
          add(g, matFor(def, f.mat, 'lathe'), null, null, m => { m.position.copy(mid); m.quaternion.copy(q); });
          break;
        }
        case 'tube': { const path = Catalog.catmull(f.pts, 40); add(tubeGeo(path, f.r, f.r * (f.taper || 1), false), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material = m.material.clone ? m.material : m.material; m.material.side = THREE.DoubleSide; }); break; }
        case 'ring': { const path = Catalog.ringPath(f.R, 48); add(tubeGeo(path, f.r, f.r, true), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material.side = THREE.DoubleSide; }); break; }
        case 'dome': {
          const g = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(f.r[0], f.r[1], f.r[2]);
          const p = g.attributes.position, uvA = g.attributes.uv;
          for (let i = 0; i < p.count; i++) uvA.setXY(i, p.getX(i) / (2 * f.r[0]) + 0.5, 0.5 - p.getZ(i) / (2 * f.r[2]));
          add(g, matFor(def, f.mat, 'dome'), f.p, f.q);
          const d = new THREE.CircleGeometry(1, 36); d.rotateX(Math.PI / 2); d.scale(f.r[0], 1, f.r[2]);
          add(d, matFor(def, f.mat, 'dome'), f.p, f.q);
          break;
        }
      }
    }
    // outlines: one hull per mesh, sharing a per-object material so colour can signal state
    const oMat = outlineMat(0x2a1a12, 1.5, seed % 13);
    const outlines = [];
    for (const m of meshes) {
      const g = m.geometry;
      if (!g.attributes.sNormal) smoothNormals(g);
      const o = new THREE.Mesh(g, oMat);
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      o.renderOrder = -1; group.add(o); outlines.push(o);
    }
    if (scale !== 1) group.scale.setScalar(scale);
    // geometric extents in object space (for the tray)
    const box = new THREE.Box3().setFromObject(group);
    return { group, meshes, outlines, oMat, box };
  }
  function ghostOf(obj, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false });
    const om = outlineMat(color, 1.2, 3); om.uniforms.uOpacity.value = 0.75;
    for (const m of obj.meshes) {
      const a = new THREE.Mesh(m.geometry, mat); a.position.copy(m.position); a.quaternion.copy(m.quaternion); g.add(a);
      const o = new THREE.Mesh(m.geometry, om); o.position.copy(m.position); o.quaternion.copy(m.quaternion); g.add(o);
    }
    g.scale.copy(obj.group.scale);
    g.userData = { mat, om };
    return g;
  }

  // ---- the drawer ----
  let drawer = null;
  const woodTex = (() => { const c = Paint.canvas(512, 256), g = c.getContext('2d'); Paint.FNS.drawerWood(g, 512, 256, { base: '#8a5230' }, rng(4)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  const innerTex = (() => { const c = Paint.canvas(512, 256), g = c.getContext('2d'); Paint.FNS.drawerWood(g, 512, 256, { base: '#b98a5c' }, rng(5)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  function feltTex(color) { const c = Paint.canvas(512, 384), g = c.getContext('2d'); Paint.FNS.felt(g, 512, 384, { base: color }, rng(6)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  const woodMat = painterly({ kind: 'wood', map: woodTex, aoMin: 0.8 });
  const innerWoodMat = painterly({ kind: 'wood', map: innerTex, aoMin: 0.62, aoH: 3 });
  const brassMat = painterly({ kind: 'brass', map: (() => { const c = Paint.texture({ fn: 'brass', base: '#c4993f' }, 'lathe', 9); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
  function labelTex(lines) {
    const c = Paint.canvas(256, 128), g = c.getContext('2d');
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a2418'; g.textAlign = 'center';
    g.font = '400 50px "DM Serif Display", Georgia, serif'; g.fillText(lines[0], 128, 62);
    g.font = 'italic 300 28px "Cormorant Garamond", Georgia, serif'; g.fillText(lines[1], 128, 104);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const LININGS = ['#2f6b66', '#7c2f35', '#56562a', '#3d5a78', '#6e3a52'];
  function buildDrawer(W, D, H, info) {
    if (drawer) { scene.remove(drawer.group); drawer.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const group = new THREE.Group(), t = 1.05, fb = 0.8;
    const outl = outlineMat(0x2a1a12, 1.7, 5);
    const piece = (w, h, d, x, y, z, mats) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mats); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
      smoothNormals(g); const o = new THREE.Mesh(g, outl); o.position.copy(m.position); o.renderOrder = -1; group.add(o);
      return m;
    };
    const M6 = (inner) => [inner === 'px' ? innerWoodMat : woodMat, inner === 'nx' ? innerWoodMat : woodMat, woodMat, woodMat, inner === 'pz' ? innerWoodMat : woodMat, inner === 'nz' ? innerWoodMat : woodMat];
    piece(W + 2 * t, fb, D + 2 * t, 0, -fb / 2, 0, woodMat);
    piece(t, H, D, -W / 2 - t / 2, H / 2, 0, M6('px'));
    piece(t, H, D, W / 2 + t / 2, H / 2, 0, M6('nx'));
    piece(W + 2 * t, H, t, 0, H / 2, -D / 2 - t / 2, M6('pz'));
    const fh = H + fb + 0.5, fw = W + 2 * t + 0.7;
    const front = piece(fw, fh, 1.25, 0, -fb - 0.25 + fh / 2, D / 2 + 0.625, M6('nz'));
    // felt lining
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(W, D), painterly({ kind: 'felt', map: feltTex(LININGS[info.index % LININGS.length]), aoMin: 0.72, aoH: 1.5 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.004; felt.receiveShadow = true; group.add(felt);
    // brass bail pull, keyhole and label holder on the front
    const fz = D / 2 + 1.25, cy = -fb - 0.25 + fh * 0.48;
    const pullW = Math.min(7, W * 0.3);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.18, 20), brassMat); plate.rotation.x = Math.PI / 2; plate.position.set(s * pullW / 2, cy, fz + 0.09); plate.castShadow = true; group.add(plate);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 10), brassMat); post.rotation.x = Math.PI / 2; post.position.set(s * pullW / 2, cy, fz + 0.4); group.add(post);
    }
    const bailPath = []; for (let i = 0; i <= 24; i++) { const a = i / 24; bailPath.push([lerp(-pullW / 2, pullW / 2, a), cy - Math.sin(a * Math.PI) * 1.1, fz + 0.75]); }
    const bail = new THREE.Mesh(tubeGeo(bailPath, 0.17, 0.17, false), brassMat); bail.castShadow = true; group.add(bail);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.3, 0.12), brassMat); holder.position.set(0, cy + Math.min(2.6, fh * 0.28), fz + 0.06); group.add(holder);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.85), new THREE.MeshBasicMaterial({ map: labelTex(['No. ' + (info.index + 1), `${fmt(W)} × ${fmt(D)} × ${fmt(H)}`]) }));
    card.position.set(0, holder.position.y, fz + 0.13); group.add(card);
    const esc = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16), brassMat); esc.rotation.x = Math.PI / 2; esc.position.set(0, cy - 1.0, fz + 0.05); group.add(esc);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.45), new THREE.MeshBasicMaterial({ color: 0x1d120c })); hole.position.set(0, cy - 1.05, fz + 0.11); group.add(hole);
    scene.add(group);
    for (const k in glowPieces) delete glowPieces[k];
    ground.position.y = -fb - 0.25;
    // shadow camera hugs the drawer
    const R = Math.max(W, D) / 2 + 14;
    Object.assign(key.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 120 });
    key.shadow.camera.updateProjectionMatrix();
    drawer = { group, W, D, H, t, fb, fh, front, outer: { x: W / 2 + t + 0.35, z0: -D / 2 - t, z1: D / 2 + 1.25, y0: -fb - 0.25, y1: H + 0.5 } };
    return drawer;
  }
  const fmt = v => (Math.round(v * 10) / 10).toString();

  // ---- held-object helpers: drop line ----
  const dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x3a2418, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: 0.55 }));
  dropLine.visible = false; scene.add(dropLine);
  function setDropLine(a, b) {
    if (!a) { dropLine.visible = false; return; }
    dropLine.geometry.setFromPoints([new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])]);
    dropLine.computeLineDistances(); dropLine.visible = true;
  }
  // vermilion glow on the wall (inner face + its top edge) that an object would cross
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xd4462a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const glowGroup = new THREE.Group(); scene.add(glowGroup);
  const glowPieces = {};
  function glowFor(side) {
    if (glowPieces[side]) return glowPieces[side];
    const g = new THREE.Group(), { W, D, H, t } = drawer;
    const strip = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), glowMat); m.rotation.x = -Math.PI / 2; m.position.set(x, H + 0.03, z); g.add(m); };
    const wall = (w, h, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat); m.rotation.y = ry; m.position.set(x, h / 2, z); g.add(m); };
    if (side === 'left' || side === 'right') { const sx = side === 'left' ? -1 : 1; strip(t + 0.2, D + 2 * t, sx * (W / 2 + t / 2), 0); wall(D, H, sx * (W / 2 - 0.03), 0, Math.PI / 2); }
    if (side === 'back') { strip(W + 2 * t, t + 0.2, 0, -D / 2 - t / 2); wall(W, H, 0, -D / 2 + 0.03, 0); }
    if (side === 'front') { const m = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * t + 0.7, 1.3), glowMat); m.rotation.x = -Math.PI / 2; m.position.set(0, drawer.H + 0.53, D / 2 + 0.625); g.add(m); }
    if (side === 'top') for (const s2 of ['left', 'right', 'back', 'front']) { const c = glowFor(s2); g.add(c.clone()); }
    glowPieces[side] = g; return g;
  }
  function glowWall(side, amt) {
    glowMat.opacity = amt * 0.45;
    for (const c of [...glowGroup.children]) glowGroup.remove(c);
    if (!drawer || !side || side === 'floor' || amt <= 0.001) return;
    glowGroup.add(glowFor(side));
  }

  // ---- layout and cameras ----
  const view = { w: 1, h: 1, drawerRect: { x: 0, y: 0, w: 1, h: 1 }, trayRect: { x: 0, y: 0, w: 1, h: 0 } };
  const orbit = { az: 0.34, pol: 0.66, dist: 60, fit: 60, target: new THREE.Vector3(), azT: 0.34, polT: 0.66, distT: 60, zoom: 1, zoomT: 1 };
  function layout(w, h, drawerRect, trayRect) {
    view.w = w; view.h = h; view.drawerRect = drawerRect; view.trayRect = trayRect;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCamera();
  }
  function placeCamera(az, pol, dist) {
    const t = orbit.target;
    camera.position.set(t.x + Math.sin(az) * Math.sin(pol) * dist, t.y + Math.cos(pol) * dist, t.z + Math.cos(az) * Math.sin(pol) * dist);
    camera.lookAt(t);
    camera.updateMatrixWorld();
  }
  // Fit the drawer into the drawer rect: view offset centres it, distance makes it fill.
  function fitCamera() {
    if (!drawer) return;
    const r = view.drawerRect, o = drawer.outer;
    camera.aspect = view.w / view.h;
    // shift the projection centre to the middle of the drawer rect
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    camera.setViewOffset(view.w, view.h, view.w / 2 - cx, view.h / 2 - cy, view.w, view.h);
    orbit.target.set(0, drawer.H * 0.3, (o.z0 + o.z1) / 2 * 0.5);
    const pts = [];
    for (const x of [-o.x, o.x]) for (const y of [o.y0, o.y1]) for (const z of [o.z0, o.z1]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 10, hi = 400;
    for (let i = 0; i < 26; i++) {
      const d = (lo + hi) / 2;
      placeCamera(orbit.azT, orbit.polT, d); camera.updateProjectionMatrix();
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (const p of pts) { const q = p.clone().project(camera); const sx = (q.x * 0.5 + 0.5) * view.w, sy = (0.5 - q.y * 0.5) * view.h; mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy); }
      const fits = (mxx - mnx) < r.w * 0.94 && (mxy - mny) < r.h * 0.94;
      if (fits) hi = d; else lo = d;
    }
    orbit.fit = hi; orbit.distT = hi * orbit.zoomT;
    if (!orbit.init) { orbit.dist = orbit.distT; orbit.az = orbit.azT; orbit.pol = orbit.polT; orbit.init = true; }
    placeCamera(orbit.az, orbit.pol, orbit.dist);
  }
  function resetOrbit() { orbit.azT = 0.34; orbit.polT = 0.66; orbit.zoomT = 1; orbit.distT = orbit.fit; }
  function nudgeOrbit(daz, dpol, zoomMul) {
    orbit.azT = clamp(orbit.azT + daz, -0.95, 1.35);
    orbit.polT = clamp(orbit.polT + dpol, 0.45, 1.22);
    if (zoomMul) orbit.zoomT = clamp(orbit.zoomT * zoomMul, 0.62, 1.3);
    orbit.distT = orbit.fit * orbit.zoomT;
  }
  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 10);
    orbit.az += (orbit.azT - orbit.az) * k; orbit.pol += (orbit.polT - orbit.pol) * k; orbit.dist += (orbit.distT - orbit.dist) * k;
    placeCamera(orbit.az, orbit.pol, orbit.dist);
  }

  // tray camera: an orthographic catalogue shelf. slotW in px, x in slot units of 10 cm.
  const tray = { slotPx: 92, scroll: 0, unit: 10 };
  function trayLayout() {
    const r = view.trayRect; if (r.h <= 0) return;
    const wU = r.w / tray.slotPx * tray.unit, hU = r.h / tray.slotPx * tray.unit;
    trayCam.left = -wU / 2; trayCam.right = wU / 2; trayCam.top = hU / 2; trayCam.bottom = -hU / 2;
    trayCam.position.set(wU / 2 - tray.unit / 2 + tray.scroll, 9, 30); trayCam.lookAt(wU / 2 - tray.unit / 2 + tray.scroll, 2.6, 0);
    trayCam.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster();
  function ndc(x, y) { return new THREE.Vector2(x / view.w * 2 - 1, -(y / view.h) * 2 + 1); }
  function pick(x, y, groups) {
    ray.setFromCamera(ndc(x, y), camera);
    const hits = ray.intersectObjects(groups, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.objRef) o = o.parent; if (o && h.object.material && !h.object.material.isShaderMaterial) return { obj: o.userData.objRef, point: h.point }; }
    return null;
  }
  function planeHit(x, y, py) {
    ray.setFromCamera(ndc(x, y), camera);
    const p = new THREE.Plane(new THREE.Vector3(0, 1, 0), -py), out = new THREE.Vector3();
    return ray.ray.intersectPlane(p, out) ? out : null;
  }
  function project(p) { const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera); return [(v.x * 0.5 + 0.5) * view.w, (0.5 - v.y * 0.5) * view.h]; }

  function render() {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, view.w, view.h);
    renderer.clear();
    shared.uGround.value = 0;
    shared.uOrtho.value = 0; shared.uPx.value = 2 * Math.tan(camera.fov * Math.PI / 360) / view.h; // world units per CSS px at depth 1
    renderer.render(scene, camera);
    const r = view.trayRect;
    if (r.h > 4) {
      trayLayout();
      renderer.setScissorTest(true);
      renderer.setScissor(r.x, view.h - r.y - r.h, r.w, r.h);
      renderer.setViewport(r.x, view.h - r.y - r.h, r.w, r.h);
      renderer.clearDepth();
      shared.uGround.value = -50; // no floor AO on the shelf
      shared.uOrtho.value = 1; shared.uPx.value = (trayCam.top - trayCam.bottom) / r.h;
      renderer.render(trayScene, trayCam);
      renderer.setScissorTest(false);
    }
  }
  function dispose() {
    renderer.dispose();
    for (const t of texCache.values()) t.dispose();
    for (const m of matCache.values()) m.dispose();
  }

  return { THREE, renderer, scene, trayScene, camera, trayCam, key, buildObject, ghostOf, buildDrawer, painterly, layout, fitCamera, resetOrbit, nudgeOrbit, updateCamera, orbit, tray, trayLayout, pick, planeHit, project, render, setDropLine, glowWall, dispose, get drawer() { return drawer; }, view, shared };
}

// ---- 07_audio.js ----
// Restrained tactile sound, synthesised: each material has its own voice.
// A small generative music-box bed plays under the puzzle; everything is muted together.

function createAudio(ctx) {
  let ac = null, master = null, sfx = null, bed = null, noiseBuf = null, muted = false, musicOn = true, bedTimer = 0, bedStep = 0;
  const can = () => !!(ctx.capabilities && ctx.capabilities.audio);
  function ensure() {
    if (ac || !can()) return ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(master);
      sfx = ac.createGain(); sfx.gain.value = 0.85; sfx.connect(comp);
      bed = ac.createGain(); bed.gain.value = 0.0; bed.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    return ac;
  }
  function unlock() { const a = ensure(); if (a && a.state === 'suspended') a.resume().catch(() => {}); }
  ctx.onDestroy(() => { try { ac && ac.close(); } catch (e) {} });

  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function partial(freq, t, peak, dec, type = 'sine', dest = sfx) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq;
    env(g, t, 0.003, peak, dec); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + 0.05);
  }
  function noise(t, dur, peak, type, f, q, dest = sfx, attack = 0.002) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ac.createGain(); env(g, t, attack, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
  }
  const V = {
    ceramic(k, t) { const f = 1350 + Math.random() * 500; for (const [m, a] of [[1, 0.22], [2.76, 0.1], [5.4, 0.05], [8.9, 0.025]]) partial(f * m, t, a * k, 0.18 + 0.4 / m); noise(t, 0.03, 0.12 * k, 'highpass', 3000, 0.7); },
    glass(k, t) { const f = 2300 + Math.random() * 700; for (const [m, a] of [[1, 0.14], [2.3, 0.07], [4.1, 0.03]]) partial(f * m, t, a * k, 0.9 / m + 0.2); },
    wood(k, t) { const f = 190 + Math.random() * 60; partial(f, t, 0.35 * k, 0.09, 'triangle'); partial(f * 2.4, t, 0.12 * k, 0.05); noise(t, 0.07, 0.3 * k, 'bandpass', 700 + Math.random() * 300, 1.4); },
    metal(k, t) { const f = 820 + Math.random() * 200; for (const [m, a] of [[1, 0.13], [2.4, 0.07], [4.07, 0.04], [6.2, 0.02]]) partial(f * m, t, a * k, 0.35 / Math.sqrt(m)); noise(t, 0.04, 0.12 * k, 'bandpass', 2500, 2); },
    paper(k, t) { for (let i = 0; i < 4; i++) noise(t + i * 0.025 + Math.random() * 0.02, 0.05 + Math.random() * 0.05, 0.16 * k, 'highpass', 2200 + Math.random() * 1500, 0.6, sfx, 0.01); },
    book(k, t) { partial(95 + Math.random() * 20, t, 0.4 * k, 0.12, 'sine'); noise(t, 0.12, 0.28 * k, 'lowpass', 600, 0.7); noise(t + 0.01, 0.06, 0.08 * k, 'highpass', 2600, 0.6); },
    lift(k, t) { noise(t, 0.05, 0.08 * k, 'bandpass', 1400, 1.2, sfx, 0.012); partial(660, t, 0.03 * k, 0.07); },
    nope(k, t) { partial(180, t, 0.18 * k, 0.09, 'triangle'); partial(150, t + 0.09, 0.15 * k, 0.12, 'triangle'); },
    turn(k, t) { noise(t, 0.04, 0.06 * k, 'bandpass', 900, 2, sfx, 0.006); },
    tick(k, t) { partial(1800, t, 0.03 * k, 0.03); },
  };
  function play(name, strength = 1) {
    if (muted || !ensure() || ac.state !== 'running') return;
    const fn = V[name]; if (!fn) return;
    try { fn(Math.max(0.15, Math.min(1.2, strength)), ac.currentTime + 0.005); } catch (e) {}
  }
  // A small rising music-box phrase for the last object.
  function chime(big) {
    if (muted || !ensure() || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02, notes = big ? [0, 4, 7, 12, 16, 19] : [0, 7, 12];
    notes.forEach((n, i) => { const f = 523.25 * Math.pow(2, n / 12); partial(f, t + i * 0.11, 0.12, 1.4); partial(f * 2.01, t + i * 0.11, 0.04, 0.7); partial(f * 3.98, t + i * 0.11, 0.015, 0.3); });
  }
  // Generative music-box bed: sparse pentatonic plucks over a soft drone.
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  function tickBed(dtMs, intensity) {
    if (!ac || ac.state !== 'running' || muted || !musicOn) { if (bed && ac) bed.gain.setTargetAtTime(0, ac.currentTime, 0.4); return; }
    bed.gain.setTargetAtTime(0.5, ac.currentTime, 1.2);
    bedTimer -= dtMs;
    if (bedTimer > 0) return;
    bedTimer = 520 + Math.random() * 380 - intensity * 120;
    bedStep++;
    const t = ac.currentTime + 0.02;
    if (Math.random() < 0.72) {
      const n = SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.2 ? -12 : 0);
      const f = 293.66 * Math.pow(2, n / 12);
      partial(f, t, 0.035, 1.6, 'sine', bed); partial(f * 3.0, t, 0.006, 0.4, 'sine', bed);
    }
    if (bedStep % 16 === 0) { partial(73.42, t, 0.05, 5.5, 'sine', bed); partial(110, t + 0.4, 0.03, 5, 'sine', bed); }
  }
  function setMuted(m) { muted = m; if (master && ac) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); }
  return { unlock, play, chime, tickBed, setMuted, get muted() { return muted; }, set music(v) { musicOn = v; } };
}

// ---- 08_levels.js ----
// Level design. The twelve designed drawers are solved offline by dev/gen_levels.js
// (same packer and rules as the game) and stored in 08_levels_data.js with their proof
// arrangement. Endless drawers are generated on the device by reverse generation.
// Every puzzle's proof is re-validated by Packer.verify before it is shown.

const Levels = (() => {
  const DEFS = [
    { name: 'First drawer', items: ['notebook', 'cup', 'vase'], H: 7.0, slack: [4.5, 4.0], seed: 11 },
    { name: 'Correspondence', items: ['journal', 'teapot', 'scroll', 'key'], H: 8.3, slack: [2.6, 2.4], seed: 21 },
    { name: 'Glaze and paper', items: ['bowl', 'bottle', 'postcards', 'incense', 'clock'], H: 6.6, slack: [2.0, 2.0], seed: 31 },
    { name: 'The study', items: ['radio', 'frame', 'candle', 'mirror', 'letter', 'bird'], H: 6.0, slack: [1.7, 1.6], seed: 41 },
    { name: 'Nursery shelf', items: ['tv', 'lidpot', 'envelopes', 'horse', 'flower', 'cup', 'key'], H: 7.4, slack: [1.5, 1.4], seed: 51 },
    { name: 'Gramophone evening', items: ['gramophone', 'woodbox', 'notebook', 'mask', 'sculpture', 'letter', 'postcards'], H: 7.4, slack: [1.3, 1.2], seed: 61 },
    { name: 'Tea for one', items: ['flask', 'teapot', 'journal', 'bird', 'key', 'envelopes', 'candle', 'cup'], H: 8.3, slack: [1.2, 1.1], seed: 71 },
    { name: 'Curiosities', items: ['vase', 'bowl', 'radio', 'scroll', 'mirror', 'frame', 'incense', 'horse', 'notebook'], H: 6.6, slack: [1.1, 1.0], seed: 81 },
    { name: 'Attic', items: ['tv', 'gramophone', 'bottle', 'clock', 'letter', 'postcards', 'mask', 'flower', 'sculpture', 'cup'], H: 7.2, slack: [1.0, 0.95], seed: 91 },
    { name: 'Inheritance', items: ['lidpot', 'flask', 'woodbox', 'journal', 'envelopes', 'key', 'bird', 'candle', 'mirror', 'incense', 'notebook'], H: 7.0, slack: [0.95, 0.9], seed: 101 },
    { name: 'Moving day', items: ['teapot', 'vase', 'bowl', 'radio', 'tv', 'frame', 'scroll', 'horse', 'postcards', 'letter', 'flower', 'sculpture'], H: 8.3, slack: [0.9, 0.85], seed: 111 },
    { name: 'One last thing', items: ['gramophone', 'clock', 'bottle', 'cup', 'woodbox', 'journal', 'notebook', 'envelopes', 'mask', 'key', 'bird', 'candle', 'mirror', 'incense'], H: 7.4, slack: [0.85, 0.8], seed: 121 },
  ];

  function designed(i) {
    const data = typeof LEVEL_DATA !== 'undefined' ? LEVEL_DATA : [];
    return data[i] ? Object.assign({ index: i, name: DEFS[i].name, designed: true }, data[i]) : null;
  }

  // Endless: controlled variation of object choice, size and drawer.
  function endlessSpec(n) {
    const r = U.rng(9001 + n * 7919);
    const all = Catalog.list.map(d => d.id);
    const count = Math.min(14, 8 + Math.floor(n / 2) + r.int(0, 2));
    const ids = r.shuffle(all).slice(0, count);
    const items = ids.map(id => ({ id, scale: +(0.9 + r() * 0.2).toFixed(3) }));
    // the drawer must at least admit every object in some orientation
    let minH = 0;
    for (const it of items) {
      const ors = Packer.orientations(Catalog.byId[it.id], it.scale, 99, U.rng(1));
      minH = Math.max(minH, Math.min(...ors.map(o => o.e[1])));
    }
    const H = +(minH + 0.25 + r() * 1.1).toFixed(2);
    const s = Math.max(0.6, 1.0 - n * 0.02);
    const NAMES = ['A rainy Tuesday', 'The spare room', 'Left to me', 'Before the move', 'Lost property', 'The bottom drawer', 'An aunt\u2019s things', 'Market finds', 'Under the stairs', 'The writing desk', 'Odds and ends', 'A long winter', 'Kept for later', 'The guest room', 'House clearance', 'Sunday afternoon'];
    return { name: NAMES[n % NAMES.length], items, H, slack: [s, s * 0.95], seed: 5000 + n * 31 };
  }
  function* endlessGen(n) {
    const spec = endlessSpec(n);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pz = yield* Packer.puzzleGen(spec.items, { H: spec.H, seed: spec.seed + attempt * 977, slack: spec.slack, searchSteps: 3, maxOrient: 6 });
      if (pz.ok) return Object.assign({ index: DEFS.length + n, name: spec.name, endless: n }, pz);
      spec.H = +(spec.H + 0.5).toFixed(2);
    }
    return null;
  }

  return { DEFS, designed, endlessSpec, endlessGen, count: DEFS.length };
})();

// ---- 08_levels_data.js ----
// Generated by dev/gen_levels.js: designed drawers with their proof arrangements.
const LEVEL_DATA = [{"W":18.5,"D":11.39,"H":7,"items":[{"id":"notebook","scale":1},{"id":"cup","scale":1},{"id":"vase","scale":1}],"solution":[{"id":"notebook","scale":1,"p":[-2.701,3.01,2.6173],"q":[0.5,0.5,0.5,0.5]},{"id":"cup","scale":1,"p":[3.9553,1.3847,0.6485],"q":[0.629104,-0.000384,-0.00042,0.777321]},{"id":"vase","scale":1,"p":[-7.001,3.1515,-0.5542],"q":[0.5,0.5,-0.5,0.5]}]},{"W":21.89,"D":15.02,"H":8.3,"items":[{"id":"journal","scale":1},{"id":"teapot","scale":1},{"id":"scroll","scale":1},{"id":"key","scale":1}],"solution":[{"id":"journal","scale":1,"p":[3.3108,0.01,0.0085],"q":[0,0,0,1]},{"id":"teapot","scale":1,"p":[-9.3458,4.2474,0.1171],"q":[0.533741,0.463797,-0.533753,0.463811]},{"id":"scroll","scale":1,"p":[3.3356,3.11,-4.9485],"q":[0,0,0,1]},{"id":"key","scale":1,"p":[9.5676,1.2244,-4.8495],"q":[0.06787,-0.06787,0.707209,0.700459]}]},{"W":23.85,"D":13.3,"H":6.6,"items":[{"id":"bowl","scale":1},{"id":"bottle","scale":1},{"id":"postcards","scale":1},{"id":"incense","scale":1},{"id":"clock","scale":1}],"solution":[{"id":"bowl","scale":1,"p":[-5.2757,0.01,0],"q":[0,0,0,1]},{"id":"bottle","scale":1,"p":[0.7871,3.1168,-2.7287],"q":[0.540569,0.474829,-0.522269,0.457773]},{"id":"postcards","scale":1,"p":[-5.8745,5.2094,-1.9957],"q":[0,0,0,1]},{"id":"incense","scale":1,"p":[-6.5302,2.8909,-1.467],"q":[0.613738,0.568271,-0.4107,0.362932]},{"id":"clock","scale":1,"p":[8.4527,3.01,1.6175],"q":[0,0,0.707107,0.707107]}]},{"W":22.47,"D":10.57,"H":6,"items":[{"id":"radio","scale":1},{"id":"frame","scale":1},{"id":"candle","scale":1},{"id":"mirror","scale":1},{"id":"letter","scale":1},{"id":"bird","scale":1}],"solution":[{"id":"radio","scale":1,"p":[6.0807,2.8697,-4.016],"q":[0.766185,0.001069,0.00107,0.642618]},{"id":"frame","scale":1,"p":[-0.3186,4.7191,-0.345],"q":[0.545721,0.545752,-0.44962,0.44965]},{"id":"candle","scale":1,"p":[-10.0178,2.5901,-1.9361],"q":[0.533741,0.463797,-0.533753,0.463811]},{"id":"mirror","scale":1,"p":[-6.8047,3.7972,1.9799],"q":[0.156739,0.671682,0.267739,0.67275]},{"id":"letter","scale":1,"p":[-5.5568,4.3208,-0.9816],"q":[0.181636,0.002098,0.011539,0.983296]},{"id":"bird","scale":1,"p":[-4.4307,3.7758,-2.1758],"q":[0.893099,-0.017715,-0.060357,0.44544]}]},{"W":22.23,"D":16.17,"H":7.4,"items":[{"id":"tv","scale":1},{"id":"lidpot","scale":1},{"id":"envelopes","scale":1},{"id":"horse","scale":1},{"id":"flower","scale":1},{"id":"cup","scale":1},{"id":"key","scale":1}],"solution":[{"id":"tv","scale":1,"p":[-10.3775,2.61,-3.2331],"q":[0.5,0.5,-0.5,0.5]},{"id":"lidpot","scale":1,"p":[-10.3675,3.376,4.0171],"q":[0.5,0.5,-0.5,0.5]},{"id":"envelopes","scale":1,"p":[2.9647,3.5415,-2.4626],"q":[0.134867,0.695167,0.034914,0.70522]},{"id":"horse","scale":1,"p":[-0.7069,1.5224,2.5919],"q":[0.517913,0.477424,-0.52162,0.4814]},{"id":"flower","scale":1,"p":[8.3221,0.2333,-4.5211],"q":[0.000076,-0.000059,0.649289,0.760542]},{"id":"cup","scale":1,"p":[8.4175,0.01,-2.6854],"q":[0,0.707107,0,0.707107]},{"id":"key","scale":1,"p":[-2.0785,0.0785,2.1531],"q":[0,0,0,1]}]},{"W":21.06,"D":13.21,"H":7.4,"items":[{"id":"gramophone","scale":1},{"id":"woodbox","scale":1},{"id":"notebook","scale":1},{"id":"mask","scale":1},{"id":"sculpture","scale":1},{"id":"letter","scale":1},{"id":"postcards","scale":1}],"solution":[{"id":"gramophone","scale":1,"p":[-1.5715,3.2093,-5.7255],"q":[0.483698,0.515451,0.484905,0.514989]},{"id":"woodbox","scale":1,"p":[4.5637,0.01,-1.604],"q":[0,0.707107,0,0.707107]},{"id":"notebook","scale":1,"p":[9.8796,3.01,-1.704],"q":[0,0,0.707107,0.707107]},{"id":"mask","scale":1,"p":[4.6136,4.7575,-0.4958],"q":[0.00386,-0.00001,-0.00284,0.999989]},{"id":"sculpture","scale":1,"p":[-7.9464,2.7975,-4.5415],"q":[0.563978,0.425931,0.567592,0.422316]},{"id":"letter","scale":1,"p":[-5.0696,5.9561,-2.4178],"q":[0.0697,0,0.005819,0.997551]},{"id":"postcards","scale":1,"p":[8.0074,3.4303,-0.9132],"q":[0.502023,0.502332,-0.497659,0.497968]}]},{"W":28.06,"D":14.62,"H":8.3,"items":[{"id":"flask","scale":1},{"id":"teapot","scale":1},{"id":"journal","scale":1},{"id":"bird","scale":1},{"id":"key","scale":1},{"id":"envelopes","scale":1},{"id":"candle","scale":1},{"id":"cup","scale":1}],"solution":[{"id":"flask","scale":1,"p":[-0.0897,2.3583,-6.6787],"q":[0.719372,0,0,0.694625]},{"id":"teapot","scale":1,"p":[-13.1304,4.2474,-0.3337],"q":[0.533741,0.463797,-0.533753,0.463811]},{"id":"journal","scale":1,"p":[1.1436,4.3853,-2.0074],"q":[0.027669,0.706674,0.021423,0.706674]},{"id":"bird","scale":1,"p":[8.0793,4.2018,-2.7376],"q":[0.5,0.5,-0.5,0.5]},{"id":"key","scale":1,"p":[-5.3032,1.2092,-4.9303],"q":[-0.194894,0.195494,0.670885,0.688267]},{"id":"envelopes","scale":1,"p":[-0.2618,3.2933,3.6683],"q":[0.705851,-0.01232,-0.01232,0.708146]},{"id":"candle","scale":1,"p":[10.0248,2.5901,-6.4],"q":[0.754832,-0.00001,-0.000009,0.655918]},{"id":"cup","scale":1,"p":[-8.2509,1.3847,4.8098],"q":[0.444547,0.549377,-0.445141,0.54992]}]},{"W":30.05,"D":14,"H":6.6,"items":[{"id":"vase","scale":1},{"id":"bowl","scale":1},{"id":"radio","scale":1},{"id":"scroll","scale":1},{"id":"mirror","scale":1},{"id":"frame","scale":1},{"id":"incense","scale":1},{"id":"horse","scale":1},{"id":"notebook","scale":1}],"solution":[{"id":"vase","scale":1,"p":[-14.4772,3.1515,-3.3605],"q":[0.5,0.5,-0.5,0.5]},{"id":"bowl","scale":1,"p":[4.2011,0.01,-0.8537],"q":[0,0,0,1]},{"id":"radio","scale":1,"p":[-5.7772,2.01,6.502],"q":[-0.707107,0,0,0.707107]},{"id":"scroll","scale":1,"p":[-5.7772,3.615,1.171],"q":[0,0,0,1]},{"id":"mirror","scale":1,"p":[11.1541,4.3731,-3.277],"q":[0.044725,0.000738,-0.070302,0.996522]},{"id":"frame","scale":1,"p":[3.9919,5.6128,-3.284],"q":[0.786164,-0.00852,-0.009652,0.617884]},{"id":"incense","scale":1,"p":[11.2672,2.36,-6.502],"q":[0.707107,0,0,0.707107]},{"id":"horse","scale":1,"p":[3.3665,4.7052,-6.0659],"q":[0.80272,-0.008723,-0.006373,0.596258]},{"id":"notebook","scale":1,"p":[11.102,2.8969,1.1686],"q":[0.043364,0,-0.07587,0.996174]}]},{"W":27.78,"D":14.89,"H":7.2,"items":[{"id":"tv","scale":1},{"id":"gramophone","scale":1},{"id":"bottle","scale":1},{"id":"clock","scale":1},{"id":"letter","scale":1},{"id":"postcards","scale":1},{"id":"mask","scale":1},{"id":"flower","scale":1},{"id":"sculpture","scale":1},{"id":"cup","scale":1}],"solution":[{"id":"tv","scale":1,"p":[3.043,2.61,-6.9713],"q":[0.707107,0,0,0.707107]},{"id":"gramophone","scale":1,"p":[-1.337,3.2093,1.3391],"q":[-0.000854,0.000327,0.684906,0.728631]},{"id":"bottle","scale":1,"p":[-1.0573,2.8703,4.1523],"q":[0.504356,0.495606,-0.504356,0.495606]},{"id":"clock","scale":1,"p":[-13.3881,1.79,3.9711],"q":[0.5,0.5,-0.5,0.5]},{"id":"letter","scale":1,"p":[3.6931,5.2317,-3.3477],"q":[-0.0087,0,-0.00093,0.999962]},{"id":"postcards","scale":1,"p":[-7.1081,6.2144,2.1183],"q":[-0.004199,0,0.016988,0.999847]},{"id":"mask","scale":1,"p":[-9.968,3.9809,2.4601],"q":[0.07216,-0.000194,0.030331,0.996932]},{"id":"flower","scale":1,"p":[10.085,0.2333,-6.5296],"q":[0.45917,0.537743,0.459063,0.537826]},{"id":"sculpture","scale":1,"p":[7.099,1.4619,-3.6871],"q":[0.309851,0.481052,-0.472269,0.67048]},{"id":"cup","scale":1,"p":[-4.6282,0.01,-5.0113],"q":[0,0,0,1]}]},{"W":27.59,"D":16.81,"H":7,"items":[{"id":"lidpot","scale":1},{"id":"flask","scale":1},{"id":"woodbox","scale":1},{"id":"journal","scale":1},{"id":"envelopes","scale":1},{"id":"key","scale":1},{"id":"bird","scale":1},{"id":"candle","scale":1},{"id":"mirror","scale":1},{"id":"incense","scale":1},{"id":"notebook","scale":1}],"solution":[{"id":"lidpot","scale":1,"p":[9.9538,3.376,-7.9515],"q":[0.707107,0,0,0.707107]},{"id":"flask","scale":1,"p":[-13.2496,2.3583,-2.8676],"q":[0.508673,0.491174,-0.508673,0.491174]},{"id":"woodbox","scale":1,"p":[9.4953,0.1581,3.4353],"q":[0.011558,0.706999,0.013139,0.706999]},{"id":"journal","scale":1,"p":[1.8083,0.01,-1.6345],"q":[0,0,0,1]},{"id":"envelopes","scale":1,"p":[0.3358,3.42,-2.9746],"q":[0,0.707107,0,0.707107]},{"id":"key","scale":1,"p":[-8.1517,0.0785,3.4749],"q":[0,0.707107,0,0.707107]},{"id":"bird","scale":1,"p":[-2.8786,4.5833,-3.9313],"q":[-0.491468,0.508957,0.49089,0.508379]},{"id":"candle","scale":1,"p":[-12.9709,2.5901,5.4031],"q":[0.533741,0.463797,-0.533753,0.463811]},{"id":"mirror","scale":1,"p":[-10.4586,4.6517,-4.6833],"q":[-0.057146,0.002112,0.158264,0.98574]},{"id":"incense","scale":1,"p":[-4.4454,2.36,0.4731],"q":[0,0,0.707107,0.707107]},{"id":"notebook","scale":1,"p":[0.2108,4.9,-3.6515],"q":[0,0,0,1]}]},{"W":31.51,"D":16.15,"H":8.3,"items":[{"id":"teapot","scale":1},{"id":"vase","scale":1},{"id":"bowl","scale":1},{"id":"radio","scale":1},{"id":"tv","scale":1},{"id":"frame","scale":1},{"id":"scroll","scale":1},{"id":"horse","scale":1},{"id":"postcards","scale":1},{"id":"letter","scale":1},{"id":"flower","scale":1},{"id":"sculpture","scale":1}],"solution":[{"id":"teapot","scale":1,"p":[-9.6449,4.2474,-7.0653],"q":[0.754832,-0.00001,-0.000009,0.655918]},{"id":"vase","scale":1,"p":[-0.0477,3.1515,-7.6378],"q":[0.707107,0,0,0.707107]},{"id":"bowl","scale":1,"p":[8.7721,0.01,-1.9895],"q":[0,0,0,1]},{"id":"radio","scale":1,"p":[11.0038,5.12,-7.6378],"q":[0.707107,0,0,0.707107]},{"id":"tv","scale":1,"p":[-11.1538,2.61,-0.351],"q":[0.707107,0,0,0.707107]},{"id":"frame","scale":1,"p":[-6.0672,6.9067,-3.5436],"q":[0.500376,0.493806,-0.506155,0.499586]},{"id":"scroll","scale":1,"p":[-13.9438,5.1312,-1.137],"q":[-0.006187,0.70708,-0.006187,0.70708]},{"id":"horse","scale":1,"p":[7.9353,4.4383,-0.5843],"q":[0.71138,-0.008203,-0.008205,0.702712]},{"id":"postcards","scale":1,"p":[-1.9677,7.3746,-3.9847],"q":[-0.005191,-0.000011,-0.004773,0.999975]},{"id":"letter","scale":1,"p":[8.777,6.8592,-2.8384],"q":[-0.01668,0.706851,0.031552,0.706461]},{"id":"flower","scale":1,"p":[-4.4609,5.5109,-6.8441],"q":[0.581897,0.401754,0.582228,0.401248]},{"id":"sculpture","scale":1,"p":[-4.4738,0.01,5.107],"q":[0,0,0,1]}]},{"W":31.42,"D":15.82,"H":7.4,"items":[{"id":"gramophone","scale":1},{"id":"clock","scale":1},{"id":"bottle","scale":1},{"id":"cup","scale":1},{"id":"woodbox","scale":1},{"id":"journal","scale":1},{"id":"notebook","scale":1},{"id":"envelopes","scale":1},{"id":"mask","scale":1},{"id":"key","scale":1},{"id":"bird","scale":1},{"id":"candle","scale":1},{"id":"mirror","scale":1},{"id":"incense","scale":1}],"solution":[{"id":"gramophone","scale":1,"p":[-3.2317,3.2093,0.7986],"q":[-0.000854,0.000327,0.684906,0.728631]},{"id":"clock","scale":1,"p":[-7.2329,3.01,0.418],"q":[0,0,0.707107,0.707107]},{"id":"bottle","scale":1,"p":[12.4641,3.1361,-7.085],"q":[0.754832,-0.00001,-0.000009,0.655918]},{"id":"cup","scale":1,"p":[7.7783,0.01,5.56],"q":[0,0.707107,0,0.707107]},{"id":"woodbox","scale":1,"p":[1.3983,2.7,2.511],"q":[0.669026,0,0,0.743239]},{"id":"journal","scale":1,"p":[3.3153,0.01,-2.7523],"q":[0,0.707107,0,0.707107]},{"id":"notebook","scale":1,"p":[-8.9962,6.3346,-4.5024],"q":[-0.001244,0.7071,-0.004195,0.7071]},{"id":"envelopes","scale":1,"p":[1.7932,5.5161,0.4581],"q":[0.001741,0,0.004014,0.99999]},{"id":"mask","scale":1,"p":[8.7084,4.3597,-1.6236],"q":[0.059717,0,0.116455,0.991399]},{"id":"key","scale":1,"p":[-15.2144,5.24,-6.2733],"q":[0.5,0.5,-0.5,0.5]},{"id":"bird","scale":1,"p":[1.1831,5.1972,-7.3783],"q":[0.731417,0,0,0.68193]},{"id":"candle","scale":1,"p":[-14.9236,2.5901,4.96],"q":[0.533741,0.463797,-0.533753,0.463811]},{"id":"mirror","scale":1,"p":[-11.1034,3.557,4.3458],"q":[0.239496,0.674813,0.182582,0.673746]},{"id":"incense","scale":1,"p":[-3.0317,2.36,-5.1518],"q":[0,0,0.707107,0.707107]}]}];

// ---- 09_game.js ----
// ONE LAST THING: game flow, input, HUD.

window.plethoraBit = {
  meta: { title: 'One Last Thing', runtime: 'plethora-bit@2', tags: ['puzzle', '3d', 'packing'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const DEV = typeof window !== 'undefined' && window.__OLT_DEV;
    const { clamp, lerp, qAxis, qMul, qNorm, qSlerp, v3 } = U;
    let disposed = false; ctx.onDestroy(() => { disposed = true; });
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, bottom: 120, left: 0, right: 0 };

    // ---------- surfaces ----------
    const bgRoot = ctx.createRoot({ layer: 'background', input: 'passthrough', style: 'background:#efe4cc;overflow:hidden;' });
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    const hud = ctx.createRoot({ layer: 'overlay', input: 'passthrough', className: 'olt' });
    hud.innerHTML = HUD_HTML;
    const $ = s => hud.querySelector(s);
    try { const bg = Paint.paperBg(512, 512, 7); bgRoot.style.backgroundImage = `radial-gradient(ellipse at 50% 35%, rgba(255,250,235,0.55), rgba(120,80,40,0.16) 95%), url(${bg.toDataURL('image/jpeg', 0.82)})`; bgRoot.style.backgroundSize = 'cover, 512px 512px'; } catch (e) { }
    // fonts (non-blocking)
    const fonts = [['DM Serif Display', 'dm-serif-display', { weight: '400', style: 'normal' }], ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }], ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'normal' }], ['Nunito Sans', 'nunito-sans', { weight: '700', style: 'normal' }], ['Nunito Sans', 'nunito-sans', { weight: '400', style: 'normal' }]];
    const fontsReady = Promise.all(fonts.map(([fam, name, o]) => { try { return ctx.loadFont(fam, name, '1.0.0', o).catch(() => null); } catch (e) { return null; } }));

    // ---------- persistence ----------
    const store = {
      get(k, d) { try { const v = ctx.capabilities.storage ? ctx.storage.get('olt.' + k) : null; return v == null ? d : v; } catch (e) { return d; } },
      set(k, v) { try { if (ctx.capabilities.storage) ctx.storage.set('olt.' + k, v); } catch (e) { } },
    };
    const prefs = { muted: store.get('muted', false), mode: store.get('mode', 'fit'), unlocked: store.get('unlocked', 0), coach: store.get('coach', 0), best: store.get('best', {}) };

    // ---------- three ----------
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); }
    catch (e) {
      $('.olt-boot').innerHTML = '<div class="olt-boot-t">The drawer would not open.</div><div class="olt-boot-s">The 3D library failed to load. Check your connection and reopen.</div>';
      try { ctx.platform.error({ stage: 'library', message: String(e && e.message || e) }); } catch (_) { }
      return;
    }
    if (disposed) return;
    let view;
    try { view = createView(THREE, canvas, { dpr: ctx.dpr || 1, lowPower: (ctx.dpr || 1) > 2.5 }); }
    catch (e) {
      $('.olt-boot').innerHTML = '<div class="olt-boot-t">The drawer would not open.</div><div class="olt-boot-s">This device could not start a 3D view (WebGL).</div>';
      try { ctx.platform.error({ stage: 'renderer', message: String(e && e.message || e) }); } catch (_) { }
      return;
    }
    ctx.onDestroy(() => view.dispose());
    const audio = createAudio(ctx); audio.setMuted(prefs.muted);
    const haptic = k => { try { if (ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- state ----------
    const S = {
      lv: null, index: 0, endlessN: -1, dr: null, objs: [], held: null, ghost: null, undo: [],
      moves: 0, rearr: 0, undos: 0, t0: 0, elapsed: 0, started: false, done: false, failed: false,
      fine: false, toastT: 0, anim: [], time: 0, blocker: null, glow: null, admire: false, clockLimit: 0,
      next: null, nextGen: null, nextFor: -1, firstFrame: false, attempt: 0, coachStep: 0,
    };
    const placedBodies = () => S.objs.filter(o => o.state === 'placed').map(o => o.body);
    const nameOf = o => o.def.name.toLowerCase();

    // ---------- level loading ----------
    function puzzleFor(index) {
      if (index < Levels.count) return Levels.designed(index);
      return null;
    }
    function loadLevel(pz, opts = {}) {
      // clear old
      for (const o of S.objs) { view.scene.remove(o.vis.group); view.trayScene.remove(o.trayGroup); }
      if (S.ghost) { view.scene.remove(S.ghost); S.ghost = null; }
      S.lv = pz; S.index = pz.index; S.objs = []; S.held = null; S.undo = []; S.moves = S.rearr = S.undos = 0; S.elapsed = 0; S.started = false; S.done = false; S.failed = false; S.admire = false; S.anim = [];
      S.dr = World.makeDrawer(pz.W, pz.D, pz.H);
      view.buildDrawer(pz.W, pz.D, pz.H, { index: pz.index });
      // objects in catalogue order on the shelf
      const items = pz.items.map((it, i) => ({ it, i })).sort((a, b) => Catalog.byId[a.it.id].no - Catalog.byId[b.it.id].no);
      items.forEach(({ it, i }, k) => {
        const def = Catalog.byId[it.id], scale = it.scale || 1;
        const vis = view.buildObject(def, scale, U.hashStr(def.id) + i);
        const body = World.makeBody(def.id + '#' + i, def, scale);
        const trayGroup = vis.group.clone();
        const o = { uid: def.id + '#' + i, def, scale, vis, body, trayGroup, state: 'tray', trayX: k * 10, trayYaw: 0, k };
        vis.group.userData.objRef = o;
        // centre the shelf copy on its footprint, scale it to fit a slot
        const b = vis.box, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
        const fit = Math.min(1, 7.6 / Math.max(sx, sz * 0.8), 6.4 / sy);
        o.trayFit = fit; o.trayOff = [-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2];
        trayGroup.scale.setScalar(scale * fit);
        view.trayScene.add(trayGroup);
        S.objs.push(o);
      });
      view.resetOrbit(); view.orbit.init = false;
      layout();
      view.tray.scroll = 0; S.trayV = 0;
      S.clockLimit = prefs.mode === 'clock' ? Math.round(pz.items.length * 40 + 20) : 0;
      S.attempt++;
      updateHud(); setToast('');
      $('.olt-result').classList.remove('on');
      saveProgress();
      if (S.index === 0 && !prefs.coach) startCoach(); else stopCoach();
      // background: prepare the next endless drawer while this one is played
      if (pz.index >= Levels.count - 2) prepareNext(pz.index + 1);
    }
    function levelByIndex(i) {
      if (i < Levels.count) { const pz = puzzleFor(i); const v = Packer.verify(pz); if (!v.ok) { console.warn('designed level failed verification', i, v.problems); } return v.ok ? pz : null; }
      return null;
    }
    function prepareNext(index) {
      if (index < Levels.count) return;
      if (S.nextFor === index && (S.next || S.nextGen)) return;
      S.nextFor = index; S.next = null; S.nextGen = Levels.endlessGen(index - Levels.count);
    }
    function stepGen(budgetMs) {
      if (!S.nextGen) return;
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        const r = S.nextGen.next();
        if (r.done) {
          S.nextGen = null;
          const pz = r.value;
          if (pz && Packer.verify(pz).ok) S.next = pz; // only verified puzzles are presented
          else { S.nextFor = -1; prepareNext(S.waitingFor || S.index + 1); }
          break;
        }
      }
    }
    function goLevel(i) {
      if (S.lv && i === S.index && S.lv.endless != null) { loadLevel(S.lv); return; } // restart the same endless drawer
      if (i < Levels.count) { const pz = levelByIndex(i); if (pz) loadLevel(pz); return; }
      prepareNext(i);
      if (S.next && S.nextFor === i) { const pz = S.next; S.next = null; S.nextFor = -1; loadLevel(pz); return; }
      S.waitingFor = i; $('.olt-preparing').classList.add('on');
    }

    function saveProgress() {
      store.set('current', S.index);
      try { if (ctx.game && ctx.game.progress) ctx.game.progress.save('main', { state: { level: S.index }, label: 'Drawer ' + (S.index + 1), percent: Math.min(1, S.index / Levels.count), stateSchemaVersion: 1 }).catch(() => { }); } catch (e) { }
    }

    // ---------- object state ----------
    function setPoseVis(o, p, q) { o.vis.group.position.set(p[0], p[1], p[2]); o.vis.group.quaternion.set(q[0], q[1], q[2], q[3]); }
    function setState(o, st, pose) {
      o.state = st;
      if (st === 'tray') { view.scene.remove(o.vis.group); view.trayScene.add(o.trayGroup); o.trayGroup.visible = true; }
      else { view.trayScene.remove(o.trayGroup); if (!o.vis.group.parent) view.scene.add(o.vis.group); }
      if (st === 'placed' && pose) { World.setPose(o.body, pose.p, pose.q); setPoseVis(o, pose.p, pose.q); }
    }
    function snapshot() { return S.objs.map(o => { const st = S.held && S.held.obj === o ? S.held.from : { state: o.state, pose: o.state === 'placed' ? World.poseOf(o.body) : null }; return { o, state: st.state, pose: st.pose }; }); }
    function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); }
    function restore(snap) {
      dropHeldVisuals(); S.held = null; S.anim = [];
      for (const s of snap) setState(s.o, s.state, s.pose);
      clearBlocker(); updateHud();
    }

    // ---------- holding ----------
    const HOVER = 0.9; // cm above the rim when hovering
    function heldBodyPose(h) {
      // orientation h.q, footprint centre (cx, cz), bottom at hover or lowered height
      const b = h.obj.body;
      World.setPose(b, [0, 0, 0], h.q);
      const bb = b.box, bottom = h.lower == null ? S.dr.H + HOVER : h.lower;
      // the walls hold the piece inside whenever its footprint can fit; otherwise centre that axis
      const hw = (bb[3] - bb[0]) / 2, hd = (bb[5] - bb[2]) / 2, dr = S.dr, e = 0.02;
      h.cx = hw * 2 <= dr.W ? clamp(h.cx, dr.x0 + hw + e, dr.x1 - hw - e) : 0;
      h.cz = hd * 2 <= dr.D ? clamp(h.cz, dr.z0 + hd + e, dr.z1 - hd - e) : 0;
      const p = [h.cx - (bb[0] + bb[3]) / 2, bottom - bb[1], h.cz - (bb[2] + bb[5]) / 2];
      World.setPose(b, p, h.q);
      return { p, q: h.q.slice() };
    }
    function grab(o, from, cx, cz) {
      if (S.done) return;
      firstGesture();
      if (S.held) cancelHeld(false);
      const q = from.state === 'placed' ? o.body.q.slice() : [0, 0, 0, 1];
      if (from.state === 'placed') { const bb = o.body.box; cx = (bb[0] + bb[3]) / 2; cz = (bb[2] + bb[5]) / 2; }
      setState(o, 'held');
      S.held = { obj: o, from, q, cx, cz, lower: null, res: null, dirty: true, lastCalc: -1, shake: 0, probe: World.makeBody('probe', o.def, o.scale) };
      const pose = heldBodyPose(S.held);
      if (from.state === 'tray') { // appear from the shelf
        setPoseVis(o, [pose.p[0], pose.p[1] + 2, pose.p[2] + 3], pose.q);
      }
      o.vis.oMat.uniforms.uColor.value.set(0x6b3d14); o.vis.oMat.uniforms.uW.value = 2.2;
      S.ghost = view.ghostOf(o.vis, 0xc98e2f); view.scene.add(S.ghost); S.ghost.visible = false;
      audio.play('lift'); haptic('light');
      try { ctx.platform.interact({ action: 'pick', object: o.def.id }); } catch (e) { }
      coachEvent('grab');
      updateHud();
    }
    function dropHeldVisuals() {
      if (S.ghost) { view.scene.remove(S.ghost); S.ghost = null; }
      view.setDropLine(null); view.glowWall(null, 0);
      if (S.held) { const u = S.held.obj.vis.oMat.uniforms; u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; }
    }
    function cancelHeld(sound = true) {
      const h = S.held; if (!h) return;
      dropHeldVisuals(); S.held = null; clearBlocker();
      if (h.from.state === 'placed') { setState(h.obj, 'placed', h.from.pose); }
      else setState(h.obj, 'tray');
      if (sound) audio.play('turn');
      updateHud();
    }
    function returnToTray() {
      const h = S.held; if (!h) return;
      if (h.from.state === 'placed') { pushUndo(); S.rearr++; }
      dropHeldVisuals(); S.held = null; clearBlocker();
      setState(h.obj, 'tray');
      audio.play(h.obj.def.snd === 'paper' ? 'paper' : 'turn', 0.6);
      updateHud(); setToast('');
    }
    function markDirty() { if (S.held) { S.held.dirty = true; } }
    function computeSettle(force) {
      const h = S.held; if (!h || (!h.dirty && !force)) return h && h.res;
      const pose = heldBodyPose(h);
      World.setPose(h.probe, pose.p, pose.q);
      const res = World.settle(h.probe, placedBodies(), S.dr);
      res.final = World.poseOf(h.probe);
      res.start = pose;
      h.res = res; h.dirty = false; h.lastCalc = S.time;
      showFeedback(res);
      return res;
    }
    function clearBlocker() {
      if (S.blocker) { const u = S.blocker.vis.oMat.uniforms; u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; S.blocker = null; }
      S.glow = null;
    }
    function showFeedback(res) {
      clearBlocker();
      const g = S.ghost; if (!g) return;
      const col = res.ok ? 0xc98e2f : 0xd4462a;
      g.userData.mat.color.set(col); g.userData.om.uniforms.uColor.value.set(col);
      const fp = res.final;
      g.position.set(fp.p[0], fp.p[1], fp.p[2]); g.quaternion.set(fp.q[0], fp.q[1], fp.q[2], fp.q[3]);
      g.visible = res.frames.length > 1 || !res.ok;
      if (!res.ok && res.reason === 'overlap' && res.blocker) {
        const bo = S.objs.find(o => o.body === res.blocker);
        if (bo) { S.blocker = bo; bo.vis.oMat.uniforms.uColor.value.set(0xd4462a); bo.vis.oMat.uniforms.uW.value = 2.6; }
      }
      if (!res.ok && (res.reason === 'outside' || res.reason === 'tall')) S.glow = res.side || 'top';
      const s = res.start, bb = S.held.obj.body.box;
      view.setDropLine([(bb[0] + bb[3]) / 2, bb[1], (bb[2] + bb[5]) / 2], [(bb[0] + bb[3]) / 2, Math.max(0, bb[1] - (s.p[1] - fp.p[1])), (bb[2] + bb[5]) / 2]);
    }
    const SIDE = { left: 'the left wall', right: 'the right wall', back: 'the back wall', front: 'the front panel', top: 'the rim', floor: 'the floor' };
    function reasonText(res) {
      const n = nameOf(S.held.obj);
      switch (res.reason) {
        case 'tall': return `Too tall. The ${n} rises above the rim, so try tipping or rolling it.`;
        case 'outside': return `The ${n} would hang over ${SIDE[res.side] || 'the edge'}.`;
        case 'overlap': { const bo = S.objs.find(o => o.body === res.blocker); return bo ? `It would pass through the ${nameOf(bo)}.` : 'Something is in the way.'; }
        case 'topple': return `The ${n} wouldn't stay put there. It would topple.`;
        default: return 'That doesn’t fit there.';
      }
    }
    function place() {
      const h = S.held; if (!h || S.done) return;
      const res = computeSettle(true);
      if (!res.ok) {
        h.shake = 1; audio.play('nope'); haptic('warning'); setToast(reasonText(res), 'bad');
        coachEvent('fail', res);
        return;
      }
      pushUndo();
      const o = h.obj, from = h.from;
      if (from.state === 'placed') S.rearr++;
      S.moves++;
      dropHeldVisuals(); S.held = null;
      // the body takes its settled pose immediately; the mesh follows the recorded settle path
      World.setPose(o.body, res.final.p, res.final.q);
      o.state = 'placed';
      const g = o.vis.group;
      const path = [{ p: [g.position.x, g.position.y, g.position.z], q: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w] }].concat(res.frames.slice(1));
      S.anim.push(makeSettleAnim(o, path, res));
      setToast('');
      try { ctx.platform.interact({ action: 'place', object: o.def.id }); } catch (e) { }
      coachEvent('place');
      updateHud();
    }
    function makeSettleAnim(o, path, res) {
      // duration per segment: falls accelerate, tips swing
      const segs = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const dy = a.p[1] - b.p[1], ang = U.qAngleBetween(a.q, b.q), dxz = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
        const fall = dy > 0.05 && ang < 0.01;
        const dur = fall ? Math.sqrt(2 * dy / 520) + 0.02 : Math.max(0.045, ang * 0.32 + dxz * 0.03);
        segs.push({ a, b, dur, fall, dy });
      }
      return { o, segs, i: 0, t: 0, landed: false, res, wob: 0 };
    }
    function stepAnims(dt) {
      for (const an of S.anim) {
        if (an.i >= an.segs.length) { // tiny settle wobble then rest
          an.wob += dt;
          const f = an.res.final, k = Math.exp(-an.wob * 9) * Math.sin(an.wob * 38) * 0.012;
          const q = qMul(qAxis(1, 0, 0.4, k), f.q);
          setPoseVis(an.o, f.p, q);
          if (an.wob > 0.45) { setPoseVis(an.o, f.p, f.q); an.dead = true; }
          continue;
        }
        const s = an.segs[an.i];
        an.t += dt;
        let t = Math.min(1, an.t / s.dur);
        const e = s.fall ? t * t : U.easeInOut(t);
        setPoseVis(an.o, v3.lerp(s.a.p, s.b.p, e), qSlerp(s.a.q, s.b.q, e));
        if (t >= 1) {
          if (s.fall && !an.landed) { an.landed = true; impact(an.o, Math.min(1.1, 0.35 + s.dy * 0.12)); }
          an.i++; an.t = 0;
          if (an.i >= an.segs.length && !an.landed) { an.landed = true; impact(an.o, 0.5); }
          if (an.i >= an.segs.length && an.segs.length > 1 && an.segs[an.segs.length - 1].fall === false) impact(an.o, 0.35);
        }
      }
      if (S.anim.some(a => a.dead)) { S.anim = S.anim.filter(a => !a.dead); checkComplete(); }
    }
    function impact(o, k) { audio.play(o.def.snd, k); haptic(k > 0.7 ? 'medium' : 'light'); }

    // ---------- rotation & height ----------
    function rotateHeld(axis, sign) {
      const h = S.held; if (!h) return;
      firstGesture();
      const ang = (S.fine ? Math.PI / 12 : Math.PI / 2) * sign;
      const ax = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
      h.q = qNorm(qMul(qAxis(ax[0], ax[1], ax[2], ang), h.q));
      h.spin = { axis: ax, ang, t: 0 };
      markDirty(); audio.play('turn'); haptic('light');
      coachEvent('rotate');
    }
    function liftHeld(dir) {
      const h = S.held; if (!h) return;
      const auto = S.dr.H + HOVER;
      let cur = h.lower == null ? auto : h.lower;
      cur = dir > 0 ? cur + 1 : Math.max(0, Math.floor(cur - 1));
      h.lower = cur >= auto - 0.01 ? null : cur;
      markDirty(); audio.play('tick'); haptic('light');
      updateHud();
    }

    // ---------- completion ----------
    function checkComplete() {
      if (S.done || S.held || S.anim.length) return;
      if (S.objs.some(o => o.state !== 'placed')) return;
      const problems = World.validate(placedBodies(), S.dr);
      if (problems.length) { console.warn('arrangement problems', problems); return; }
      S.done = true; S.admire = true;
      const lvl = S.index + 1;
      audio.chime(true); haptic('success');
      prefs.unlocked = Math.max(prefs.unlocked, S.index + 1); store.set('unlocked', prefs.unlocked);
      const prevBest = prefs.best[S.index];
      const rec = { t: Math.round(S.elapsed), m: S.moves };
      if (!prevBest || rec.t < prevBest.t) { prefs.best[S.index] = rec; store.set('best', prefs.best); }
      if (S.index === 0) { prefs.coach = 1; store.set('coach', 1); stopCoach(); }
      try { ctx.platform.milestone('drawer_packed', { level: lvl }); ctx.platform.complete({ level: lvl, timeMs: Math.round(S.elapsed * 1000), moves: S.moves }); } catch (e) { }
      const attempt = S.attempt;
      try {
        if (ctx.memory && ctx.memory.record) {
          const r = ctx.memory.record('drawers');
          r.submit(lvl, { label: 'Drawer ' + lvl }).then(() => r.rank({ scope: 'global', period: 'all_time' })).then(st => {
            if (disposed || attempt !== S.attempt) return;
            const vr = st && st.viewerRank;
            $('.olt-rank').textContent = vr && vr.rank ? `Among packers: No. ${vr.rank} of ${st.totalRanked}` : '';
          }).catch(() => { if (!disposed && attempt === S.attempt) $('.olt-rank').textContent = ''; });
        }
      } catch (e) { }
      if (S.index + 1 >= Levels.count - 1) prepareNext(S.index + 1);
      ctx.timeout(() => { if (!disposed && attempt === S.attempt) showResult(); }, 1700);
    }
    function showResult() {
      const n = S.objs.length;
      const stars = S.moves <= n ? 3 : S.moves <= Math.ceil(n * 1.5) ? 2 : 1;
      let vol = 0; for (const o of S.objs) vol += o.body.mass;
      const used = Math.round(vol / (S.dr.W * S.dr.D * S.dr.H) * 100);
      $('.olt-r-title').textContent = `Drawer No. ${S.index + 1}`;
      $('.olt-r-name').textContent = S.lv.name || '';
      $('.olt-r-stars').innerHTML = '<span class="on">✦</span>'.repeat(stars) + '<span>✦</span>'.repeat(3 - stars);
      $('.olt-r-rows').innerHTML = [
        [`${n}/${n}`, 'placed'], [fmtTime(S.elapsed), 'time'], [S.moves, S.rearr ? `moves · ${S.rearr} redone` : 'moves'], [`${used}%`, 'space used'],
      ].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
      $('.olt-r-status').textContent = 'Everything fits. Nothing sticks out, nothing overlaps.';
      $('.olt-result').classList.add('on');
      try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ level: S.index + 1, timeMs: Math.round(S.elapsed * 1000), timeLabel: fmtTime(S.elapsed), text: `Packed drawer No. ${S.index + 1} in ${fmtTime(S.elapsed)}` }); } catch (e) { }
    }
    function timeUp() {
      if (S.done || S.failed) return;
      S.failed = true; if (S.held) cancelHeld(false);
      audio.play('nope'); haptic('error');
      try { ctx.platform.fail({ level: S.index + 1, reason: 'time' }); } catch (e) { }
      $('.olt-r-title').textContent = 'Time’s up';
      $('.olt-r-name').textContent = `Drawer No. ${S.index + 1}`;
      $('.olt-r-stars').innerHTML = '';
      const placed = S.objs.filter(o => o.state === 'placed').length;
      $('.olt-r-rows').innerHTML = [[`${placed}/${S.objs.length}`, 'placed'], [S.moves, 'moves']].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
      $('.olt-r-status').textContent = 'Not everything made it in. Try again?';
      $('.olt-rank').textContent = '';
      $('.olt-next').textContent = 'Try again';
      $('.olt-result').classList.add('on');
    }
    const fmtTime = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    function firstGesture() {
      audio.unlock();
      if (!S.started) { S.started = true; S.t0 = S.time; try { ctx.platform.start({ level: S.index + 1, mode: prefs.mode }); } catch (e) { } }
    }

    // ---------- HUD ----------
    function updateHud() {
      const placed = S.objs.filter(o => o.state === 'placed').length, n = S.objs.length;
      $('.olt-no').textContent = 'No. ' + (S.index + 1);
      $('.olt-name').textContent = S.lv ? S.lv.name : '';
      $('.olt-count').textContent = `${placed} of ${n} placed`;
      const holding = !!S.held;
      hud.classList.toggle('holding', holding);
      $('.olt-fine').classList.toggle('on', S.fine);
      $('.olt-fine b').textContent = S.fine ? '15°' : '90°';
      $('.olt-undo').disabled = !S.undo.length;
      $('.olt-reset').disabled = !S.objs.some(o => o.state === 'placed');
      const left = S.objs.filter(o => o.state === 'tray').length;
      $('.olt-shelf-cap').textContent = holding ? 'Tap the shelf to put it back' : left ? `The collection · ${left} to go` : 'The collection is empty';
      $('.olt-sound').classList.toggle('off', audio.muted);
      if (S.held) $('.olt-lift-v').textContent = S.held.lower == null ? 'above' : S.held.lower.toFixed(0) + ' cm';
    }
    let toastTimer = 0;
    function setToast(text, kind) {
      const t = $('.olt-toast'); t.textContent = text; t.className = 'olt-toast' + (text ? ' on' : '') + (kind ? ' ' + kind : '');
      toastTimer = text ? 4.5 : 0;
    }

    // tray labels (DOM, follow the shelf scroll)
    const labelsEl = $('.olt-labels');
    function updateLabels() {
      const r = view.view.trayRect, tr = view.tray;
      const tr0 = S.objs.filter(o => o.state === 'tray');
      let html = '';
      for (const o of tr0) {
        const x = r.x + (o.trayX - tr.scroll) / tr.unit * tr.slotPx + tr.slotPx / 2;
        if (x < -60 || x > r.x + r.w + 60) continue;
        html += `<div class="olt-label" style="transform:translateX(${x.toFixed(1)}px);width:${tr.slotPx - 8}px;margin-left:${-(tr.slotPx - 8) / 2}px"><i>No. ${o.def.no}</i>${o.def.name}</div>`;
      }
      if (html !== labelsEl._h) { labelsEl.innerHTML = html; labelsEl._h = html; }
    }

    // ---------- layout ----------
    const L = { trayTop: 0, trayBottom: 0, rowTop: 0 };
    function layout() {
      const w = ctx.width, h = ctx.height, a = area();
      const top = a.top + 66, trayH = clamp(Math.round(h * 0.16), 112, 150), rowH = 64;
      L.trayBottom = h - Math.max(a.bottom, 8) - 2; L.trayTop = L.trayBottom - trayH; L.rowTop = L.trayTop - rowH;
      const drawerRect = { x: 8, y: top, w: w - 16, h: Math.max(120, L.rowTop - top - 6) };
      const trayRect = { x: 0, y: L.trayTop + 22, w, h: trayH - 22 - 24 };
      view.layout(w, h, drawerRect, trayRect);
      view.tray.slotPx = clamp(Math.round(w / 4.3), 84, 120);
      hud.style.setProperty('--top', a.top + 'px');
      hud.style.setProperty('--row', L.rowTop + 'px');
      hud.style.setProperty('--tray', L.trayTop + 'px');
      hud.style.setProperty('--trayb', (h - L.trayBottom) + 'px');
      hud.style.setProperty('--labels', (L.trayBottom - 22) + 'px');
      hud.style.setProperty('--sl', (a.left || 0) + 'px'); hud.style.setProperty('--sr', (a.right || 0) + 'px');
    }
    ctx.onResize(() => { if (S.lv) layout(); }, { immediate: false });

    // ---------- input ----------
    const ptrs = new Map();
    let drag = null, gest = null;
    const inTray = y => y >= L.trayTop;
    const inRow = y => y >= L.rowTop && y < L.trayTop;
    function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function traySlotAt(x) {
      const r = view.view.trayRect, tr = view.tray;
      const wx = tr.scroll + (x - r.x - tr.slotPx / 2) / tr.slotPx * tr.unit;
      let best = null, bd = 6;
      for (const o of S.objs) if (o.state === 'tray') { const d = Math.abs(o.trayX - wx); if (d < bd) { bd = d; best = o; } }
      return best;
    }
    function heldPlaneY() { const h = S.held; return h ? (h.lower == null ? S.dr.H + HOVER : h.lower) : S.dr.H; }
    function moveHeldTo(x, y, off) {
      const hit = view.planeHit(x, y, heldPlaneY()); if (!hit) return;
      const m = 6;
      S.held.cx = clamp(hit.x + off[0], -S.dr.W / 2 - m, S.dr.W / 2 + m);
      S.held.cz = clamp(hit.z + off[1], -S.dr.D / 2 - m, S.dr.D / 2 + m);
      markDirty();
    }
    ctx.listen(canvas, 'pointerdown', e => {
      if (!S.lv || $('.olt-menu').classList.contains('on')) return;
      const [x, y] = local(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
      ptrs.set(e.pointerId, { x, y, x0: x, y0: y });
      audio.unlock();
      if (ptrs.size === 2) { startGesture(); return; }
      if (ptrs.size > 2) return;
      if (S.done) { drag = { kind: 'orbit', x, y, moved: 0 }; return; }
      if (inTray(y)) {
        drag = S.held ? { kind: 'trayReturn', x, y, moved: 0, obj: traySlotAt(x) } : { kind: 'tray', x, y, x0: x, y0: y, moved: 0, scroll0: view.tray.scroll, obj: traySlotAt(x), t: S.time };
        return;
      }
      if (inRow(y)) return;
      if (S.held) {
        const hit = view.planeHit(x, y, heldPlaneY());
        const off = hit ? [S.held.cx - hit.x, S.held.cz - hit.z] : [0, 0];
        drag = { kind: 'held', x, y, moved: 0, off };
        return;
      }
      const pk = view.pick(x, y, S.objs.filter(o => o.state === 'placed').map(o => o.vis.group));
      if (pk) {
        const o = pk.obj;
        const an = S.anim.find(a => a.o === o);
        if (an) { setPoseVis(o, an.res.final.p, an.res.final.q); S.anim = S.anim.filter(a => a !== an); }
        const on = World.restingOn(o.body, placedBodies(), S.dr);
        if (on.length) {
          const names = on.map(b => nameOf(S.objs.find(oo => oo.body === b)));
          setToast(`The ${names[0]}${names.length > 1 ? ' and more are' : ' is'} resting on the ${nameOf(o)}. Lift that first.`, 'bad');
          audio.play('nope'); haptic('warning');
          for (const b of on) { const oo = S.objs.find(q => q.body === b); flashOutline(oo); }
          drag = { kind: 'orbit', x, y, moved: 0 };
          return;
        }
        grab(o, { state: 'placed', pose: World.poseOf(o.body) });
        const hit = view.planeHit(x, y, heldPlaneY());
        drag = { kind: 'held', x, y, moved: 0, off: hit ? [S.held.cx - hit.x, S.held.cz - hit.z] : [0, 0], fresh: true };
        return;
      }
      drag = { kind: 'orbit', x, y, moved: 0 };
    });
    ctx.listen(canvas, 'pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const [x, y] = local(e); const dx = x - p.x, dy = y - p.y; p.x = x; p.y = y;
      if (gest) { moveGesture(); return; }
      if (!drag) return;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.kind === 'tray') {
        const tdx = x - drag.x0, tdy = y - drag.y0;
        if (!drag.mode && Math.hypot(tdx, tdy) > 9) drag.mode = (tdy < -Math.abs(tdx) * 0.7 && drag.obj) ? 'lift' : 'scroll';
        if (drag.mode === 'scroll') { view.tray.scroll = drag.scroll0 - tdx / view.tray.slotPx * view.tray.unit; S.trayV = -dx / view.tray.slotPx * view.tray.unit / Math.max(1 / 120, S.lastDt || 1 / 60); }
        if (drag.mode === 'lift' && y < L.trayTop - 4) {
          // lift the object off the shelf straight into the drawer view, just above the finger
          const o = drag.obj;
          const hit = view.planeHit(x, y - 46, S.dr.H + HOVER);
          grab(o, { state: 'tray' }, hit ? hit.x : 0, hit ? hit.z : 0);
          drag = { kind: 'held', x, y, moved: 99, off: [0, 0], fromTray: true, dyOff: -46 };
          if (hit) { S.held.cx = hit.x; S.held.cz = hit.z; }
        }
        return;
      }
      if (drag.kind === 'held' && S.held) {
        if (drag.moved < 5 && !drag.fromTray) return;
        S.held.overTray = inTray(y);
        hud.classList.toggle('overtray', S.held.overTray);
        if (!S.held.overTray) moveHeldTo(x, y + (drag.dyOff || 0), drag.off);
        return;
      }
      if (drag.kind === 'orbit') view.nudgeOrbit(-dx * 0.0065, -dy * 0.0045);
    });
    const endPtr = e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      ptrs.delete(e.pointerId);
      if (gest) { if (ptrs.size < 2) { gest = null; drag = null; } return; }
      const d = drag; drag = null; if (!d) return;
      const [x, y] = local(e);
      const cancelled = e.type === 'pointercancel';
      if (d.kind === 'tray') {
        if (!d.mode && d.obj && !cancelled) { // tap: pick it up to inspect, hovering over the drawer
          grab(d.obj, { state: 'tray' }, 0, 0);
          setToast('Turn it with the buttons, then drag it into place.', 'hint');
        }
        return;
      }
      if (d.kind === 'trayReturn') { if (d.moved < 12 && !cancelled) { const other = d.obj; returnToTray(); if (other && other.state === 'tray') grab(other, { state: 'tray' }, 0, 0); } return; }
      if (d.kind === 'held' && S.held) {
        hud.classList.remove('overtray');
        if (cancelled) return;
        if (S.held.overTray) { S.held.overTray = false; returnToTray(); return; }
        if (d.moved >= 6 || d.fromTray) { place(); return; }
        if (d.fresh) return; // a tap that just picked it up
        // a tap while holding: on the held object places it, on another swaps
        const pk = view.pick(x, y, S.objs.filter(o => o.state === 'placed' || o === S.held.obj).map(o => o.vis.group));
        if (pk && pk.obj === S.held.obj) place();
        else if (pk && pk.obj.state === 'placed') { const o = pk.obj; if (!World.restingOn(o.body, placedBodies(), S.dr).length) grab(o, { state: 'placed', pose: World.poseOf(o.body) }); }
      }
    };
    ctx.listen(canvas, 'pointerup', endPtr);
    ctx.listen(canvas, 'pointercancel', endPtr);
    function gestureState() {
      const [a, b] = [...ptrs.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x), dist: Math.hypot(b.x - a.x, b.y - a.y) };
    }
    function startGesture() { drag = null; gest = gestureState(); gest.acc = 0; hud.classList.remove('overtray'); if (S.held) S.held.overTray = false; }
    function moveGesture() {
      if (ptrs.size < 2) return;
      const g = gestureState();
      let da = g.ang - gest.ang; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      const zoom = gest.dist / Math.max(1, g.dist);
      if (S.held && !S.done) {
        const h = S.held; h.q = qNorm(qMul(qAxis(0, 1, 0, -da), h.q)); markDirty();
        gest.acc += Math.abs(da); if (gest.acc > 0.25) { audio.play('tick', 0.5); gest.acc = 0; }
        view.nudgeOrbit(0, -(g.cy - gest.cy) * 0.004, zoom);
      } else view.nudgeOrbit(-(g.cx - gest.cx) * 0.006 + da * 0.6, -(g.cy - gest.cy) * 0.004, zoom);
      gest.cx = g.cx; gest.cy = g.cy; gest.ang = g.ang; gest.dist = g.dist;
    }
    ctx.listen(canvas, 'wheel', e => { e.preventDefault(); view.nudgeOrbit(0, 0, e.deltaY > 0 ? 1.06 : 1 / 1.06); }, { passive: false });
    ctx.listen(window, 'keydown', e => {
      if (!S.lv) return;
      const k = e.key.toLowerCase();
      if (S.held) {
        const step = e.shiftKey ? 0.2 : 0.8;
        if (k === 'arrowleft') { S.held.cx -= step; markDirty(); }
        else if (k === 'arrowright') { S.held.cx += step; markDirty(); }
        else if (k === 'arrowup') { S.held.cz -= step; markDirty(); }
        else if (k === 'arrowdown') { S.held.cz += step; markDirty(); }
        else if (k === 'q' || k === 'e') rotateHeld('y', k === 'q' ? 1 : -1);
        else if (k === 'w' || k === 's') rotateHeld('x', k === 'w' ? -1 : 1);
        else if (k === 'a' || k === 'd') rotateHeld('z', k === 'a' ? 1 : -1);
        else if (k === 'r') liftHeld(1); else if (k === 'f') liftHeld(-1);
        else if (k === 'enter' || k === ' ') place();
        else if (k === 'escape' || k === 'backspace') returnToTray();
        else return;
        e.preventDefault(); return;
      }
      if (k === 'z') doUndo(); else if (k === 'c') view.resetOrbit();
    });
    function flashOutline(o) { if (!o) return; const u = o.vis.oMat.uniforms; u.uColor.value.set(0xc98e2f); u.uW.value = 2.6; ctx.timeout(() => { if (S.blocker !== o && !(S.held && S.held.obj === o)) { u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; } }, 900); }

    // buttons
    const on = (sel, fn) => ctx.listen($(sel), 'click', e => { e.stopPropagation(); audio.unlock(); fn(e); });
    on('.olt-turn', () => rotateHeld('y', 1));
    on('.olt-tip', () => rotateHeld('x', 1));
    on('.olt-roll', () => rotateHeld('z', -1));
    on('.olt-fine', () => { S.fine = !S.fine; updateHud(); audio.play('tick'); });
    on('.olt-up', () => liftHeld(1));
    on('.olt-down', () => liftHeld(-1));
    on('.olt-place', () => place());
    on('.olt-back', () => returnToTray());
    on('.olt-undo', () => doUndo());
    on('.olt-reset', () => { if (S.done) return; if (S.held) cancelHeld(false); pushUndo(); for (const o of S.objs) if (o.state === 'placed') setState(o, 'tray'); S.anim = []; updateHud(); audio.play('paper', 0.8); setToast('Everything is back on the shelf. Undo brings it back.', 'hint'); });
    on('.olt-view', () => { view.resetOrbit(); audio.play('tick'); });
    on('.olt-sound', () => { audio.setMuted(!audio.muted); prefs.muted = audio.muted; store.set('muted', prefs.muted); updateHud(); });
    on('.olt-menu-btn', () => openMenu());
    on('.olt-menu-close', () => $('.olt-menu').classList.remove('on'));
    on('.olt-admire', () => { $('.olt-result').classList.remove('on'); $('.olt-again').classList.add('on'); });
    on('.olt-again', () => { $('.olt-again').classList.remove('on'); $('.olt-result').classList.add('on'); });
    on('.olt-next', () => { $('.olt-again').classList.remove('on'); $('.olt-next').textContent = 'Next drawer'; if (S.failed) goLevel(S.index); else goLevel(S.index + 1); });
    on('.olt-restart', () => { $('.olt-menu').classList.remove('on'); goLevel(S.index); });
    on('.olt-mode', () => { prefs.mode = prefs.mode === 'fit' ? 'clock' : 'fit'; store.set('mode', prefs.mode); renderMenu(); goLevel(S.index); $('.olt-menu').classList.remove('on'); });
    ctx.listen($('.olt-levels'), 'click', e => {
      const b = e.target.closest('[data-l]'); if (!b || b.disabled) return;
      $('.olt-menu').classList.remove('on'); goLevel(+b.dataset.l);
    });
    function doUndo() {
      if (!S.undo.length || S.done) return;
      restore(S.undo.pop()); S.undos++; audio.play('turn'); setToast('');
    }
    function openMenu() { renderMenu(); $('.olt-menu').classList.add('on'); }
    function renderMenu() {
      const maxL = Math.max(prefs.unlocked, S.index);
      let h = '';
      for (let i = 0; i < Levels.count; i++) {
        const ok = i <= maxL, b = prefs.best[i];
        h += `<button data-l="${i}" ${ok ? '' : 'disabled'} class="${i === S.index ? 'cur' : ''} ${b ? 'done' : ''}"><b>${i + 1}</b><i>${ok ? Levels.DEFS[i].name : 'locked'}</i></button>`;
      }
      const eN = Math.max(Levels.count, Math.min(maxL, 999));
      h += `<button data-l="${Math.max(Levels.count, S.index >= Levels.count ? S.index : Levels.count)}" ${prefs.unlocked >= Levels.count ? '' : 'disabled'} class="endless"><b>∞</b><i>${prefs.unlocked >= Levels.count ? 'Endless drawers' : 'Endless · finish No. 12'}</i></button>`;
      $('.olt-levels').innerHTML = h;
      $('.olt-mode b').textContent = prefs.mode === 'fit' ? 'Fit everything' : 'Beat the clock';
    }

    // ---------- onboarding: a small worked example on the first drawer ----------
    function startCoach() { S.coachStep = 1; hud.classList.add('coach1'); }
    function stopCoach() { S.coachStep = 0; hud.classList.remove('coach1', 'coach2'); }
    function coachEvent(ev, res) {
      if (!S.coachStep) return;
      if (ev === 'grab' && S.coachStep === 1) { S.coachStep = 2; hud.classList.remove('coach1'); hud.classList.add('coach2'); }
      if (ev === 'rotate' || ev === 'place') { hud.classList.remove('coach2'); if (ev === 'place') S.coachStep = 3; }
    }

    // ---------- main loop ----------
    let lastHud = 0;
    ctx.game.loop({
      update(dtMs) {
        if (disposed || !S.lv) return;
        const dt = Math.min(0.05, dtMs / 1000); S.lastDt = dt; S.time += dt;
        if (S.started && !S.done && !S.failed) S.elapsed += dt;
        if (S.clockLimit && S.started && !S.done && !S.failed && S.elapsed >= S.clockLimit) timeUp();
        // completion admiration: a slow drift of the camera
        if (S.admire) { view.orbit.azT = 0.36 + Math.sin(S.time * 0.22) * 0.32; view.orbit.distT = view.orbit.fit * 0.94; }
        view.updateCamera(dt);
        // held object follows its target pose
        const h = S.held;
        if (h) {
          if (h.dirty && S.time - h.lastCalc > 0.07) computeSettle();
          const pose = heldBodyPose(h);
          const g = h.obj.vis.group, k = 1 - Math.exp(-dt * 16);
          let q = pose.q;
          if (h.spin) { h.spin.t += dt; const e = Math.min(1, h.spin.t / 0.18); q = qMul(qAxis(h.spin.axis[0], h.spin.axis[1], h.spin.axis[2], -h.spin.ang * (1 - U.easeOut(e))), pose.q); if (e >= 1) h.spin = null; }
          const sh = h.shake > 0 ? Math.sin(S.time * 60) * h.shake * 0.35 : 0; h.shake = Math.max(0, h.shake - dt * 3);
          g.position.x += (pose.p[0] + sh - g.position.x) * k; g.position.y += (pose.p[1] - g.position.y) * k; g.position.z += (pose.p[2] - g.position.z) * k;
          const cq = [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w], nq = h.spin ? q : qSlerp(cq, q, Math.min(1, k * 1.4));
          g.quaternion.set(nq[0], nq[1], nq[2], nq[3]);
          // feedback glow pulses gently
          view.glowWall(S.glow, S.glow ? 0.55 + 0.45 * Math.sin(S.time * 5) : 0);
        } else view.glowWall(null, 0);
        stepAnims(dt);
        // shelf: slots, momentum and a gentle turn so each piece reads as 3D
        const tr = S.objs.filter(o => o.state === 'tray');
        const maxScroll = Math.max(0, (tr.length - 1) * 10 - (view.view.trayRect.w / view.tray.slotPx - 1) * 10);
        if (!drag || drag.kind !== 'tray' || drag.mode !== 'scroll') { view.tray.scroll += (S.trayV || 0) * dt; S.trayV = (S.trayV || 0) * Math.exp(-dt * 5); }
        view.tray.scroll = clamp(view.tray.scroll, 0, maxScroll);
        tr.forEach((o, i) => {
          const tx = i * 10; o.trayX += (tx - o.trayX) * (1 - Math.exp(-dt * 10));
          const g = o.trayGroup, f = o.trayFit * o.scale;
          o.trayYaw = 0.5 + Math.sin(S.time * 0.5 + o.k * 1.7) * 0.32;
          g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.trayYaw);
          const off = new THREE.Vector3(o.trayOff[0], o.trayOff[1], o.trayOff[2]).multiplyScalar(f).applyQuaternion(g.quaternion);
          g.position.set(o.trayX + off.x, off.y, off.z);
        });
        stepGen(S.waitingFor != null ? 30 : 5);
        if (S.waitingFor != null && S.next && S.nextFor === S.waitingFor) { const i = S.waitingFor; S.waitingFor = null; $('.olt-preparing').classList.remove('on'); goLevel(i); }
        audio.tickBed(dtMs, S.objs.length ? S.objs.filter(o => o.state === 'placed').length / S.objs.length : 0);
        if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) setToast(''); }
        if (S.time - lastHud > 0.25) {
          lastHud = S.time;
          const left = S.clockLimit ? S.clockLimit - S.elapsed : 0;
          $('.olt-time').textContent = S.clockLimit ? fmtTime(left) : (S.started ? fmtTime(S.elapsed) : '');
          $('.olt-time').classList.toggle('urgent', !!S.clockLimit && left < 20);
        }
        updateLabels();
      },
      render() {
        if (disposed || !S.lv) return;
        view.render();
        if (!S.firstFrame) {
          S.firstFrame = true;
          $('.olt-boot').classList.add('gone');
          try { ctx.markVisualReady('drawer'); ctx.platform.ready(); } catch (e) { }
        }
      },
    });

    // ---------- go ----------
    await Promise.race([fontsReady, new Promise(r => ctx.timeout(r, 1200))]);
    if (disposed) return;
    let startAt = Math.min(store.get('current', 0) | 0, Math.max(prefs.unlocked, 0));
    try {
      if (ctx.game && ctx.game.progress) {
        const saved = await Promise.race([ctx.game.progress.load('main'), new Promise(r => ctx.timeout(() => r(null), 900))]);
        if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.level)) startAt = Math.max(0, Math.min(saved.state.level, Math.max(prefs.unlocked, startAt)));
      }
    } catch (e) { }
    if (disposed) return;
    if (startAt >= Levels.count) { goLevel(Levels.count - 1 >= 0 ? startAt : 0); if (!S.lv) loadLevel(levelByIndex(Levels.count - 1)); }
    else goLevel(startAt);

    function devSolve(n) {
      if (S.held) cancelHeld(false);
      const used = new Set();
      S.lv.solution.slice(0, n == null ? 99 : n).forEach(sol => {
        const o = S.objs.find(o => o.def.id === sol.id && !used.has(o)); used.add(o);
        setState(o, 'placed', { p: sol.p, q: sol.q });
      });
      updateHud(); checkComplete();
    }
    if (DEV) window.__olt = { devSolve, G, S, view, World, Catalog, Levels, Packer, place, grab, rotateHeld, liftHeld, returnToTray, doUndo, goLevel, computeSettle, layout, L, setState, loadLevel, heldBodyPose, markDirty, audio };
  },
};

const ICON = {
  turn: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5c0 2.4 3.4 4.3 7.5 4.3s7.5-1.9 7.5-4.3-3.4-4.3-7.5-4.3"/><path d="M10 6.3l2.4 1.9-2 2.3"/><path d="M12 3v18" stroke-dasharray="1.5 2.5"/></svg>',
  tip: '<svg viewBox="0 0 24 24"><path d="M12 19.5c-4.1 0-7.5-3.4-7.5-7.5S7.9 4.5 12 4.5"/><path d="M10.2 2.6l2.2 1.9-2 2.3"/><path d="M3 12h18" stroke-dasharray="1.5 2.5"/></svg>',
  roll: '<svg viewBox="0 0 24 24"><path d="M12 4.5c4.1 0 7.5 3.4 7.5 7.5s-3.4 7.5-7.5 7.5"/><path d="M13.8 2.6l-2.2 1.9 2 2.3"/><circle cx="12" cy="12" r="1.6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  place: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/><path d="M8 10.5l4 4 4-4"/><path d="M5 19.5h14"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7L4.5 11 9 15"/><path d="M5 11h9a5 5 0 010 10h-3"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M5 9h14l-1.3 10.5H6.3z"/><path d="M8.5 9V6.5h7V9"/></svg>',
  view: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="w" d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/><path class="x" d="M16 9.5l5 5m0-5l-5 5"/></svg>',
  hand: '<svg viewBox="0 0 40 40"><path d="M15 34c-3-3-7-8-7-10 0-1.6 2-2 3.4-.6L14 26V9.5a2 2 0 014 0V20l.2-3a2 2 0 014 .1V20a2 2 0 014 0v1.2a2 2 0 014 0V27c0 4-2 7-5 7z" fill="#efe4cc" stroke="#3a2418" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

const HUD_HTML = `
<style>
.olt{font-family:'Nunito Sans',system-ui,sans-serif;color:#3a2418;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.olt *{box-sizing:border-box}
.olt button{pointer-events:auto;font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.olt svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.olt-boot{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;transition:opacity .6s;background:transparent;text-align:center;padding:0 32px}
.olt-boot.gone{opacity:0;pointer-events:none}
.olt-boot-t{font-family:'DM Serif Display',Georgia,serif;font-size:34px;letter-spacing:.5px}
.olt-boot-s{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;opacity:.8}
.olt-top{position:absolute;top:calc(var(--top) + 6px);left:calc(16px + var(--sl));right:calc(16px + var(--sr));display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none}
.olt-title{line-height:1}
.olt-no{font-family:'DM Serif Display',Georgia,serif;font-size:28px;letter-spacing:.3px}
.olt-name{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;margin-left:8px}
.olt-sub{margin-top:5px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;opacity:.72;display:flex;gap:10px}
.olt-time.urgent{color:#b8371f;opacity:1}
.olt-icons{display:flex;gap:6px}
.olt-ib{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:15px 13px 16px 12px;border:1.5px solid rgba(58,36,24,.55);background:rgba(244,236,218,.72)}
.olt-sound .x{display:none}.olt-sound.off .x{display:inline}.olt-sound.off .w{display:none}
.olt-toast{position:absolute;left:24px;right:24px;top:calc(var(--row) - 46px);text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;line-height:1.15;opacity:0;transform:translateY(4px);transition:opacity .25s,transform .25s;pointer-events:none;text-shadow:0 0 8px rgba(239,228,204,.95),0 0 3px rgba(239,228,204,.95)}
.olt-toast.on{opacity:1;transform:none}.olt-toast.bad{color:#a8331c}.olt-toast.hint{color:#3a2418}
.olt-row{position:absolute;left:calc(10px + var(--sl));right:calc(10px + var(--sr));top:var(--row);height:58px;display:flex;align-items:center;justify-content:center;gap:4px}
.olt-row .grp{display:flex;gap:4px;align-items:center}
.olt-b{min-width:46px;height:52px;padding:0 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border-radius:14px 12px 15px 11px;border:1.5px solid rgba(58,36,24,.5);background:rgba(244,236,218,.8)}
.olt-b span{font-size:9px;letter-spacing:1.1px;text-transform:uppercase;opacity:.8}
.olt-b b{font-weight:700;font-size:13px}
.olt-b:disabled{opacity:.35}
.olt-b.on{background:#3a2418;color:#efe4cc}
.olt-b.primary{background:#3a2418;color:#f4ead4;min-width:62px}
.olt-lift{display:flex;flex-direction:column;align-items:center;gap:2px}
.olt-lift .olt-b{height:25px;min-width:40px;border-radius:10px}
.olt-lift .olt-b svg{width:18px;height:18px}
.olt-lift-v{font-size:9px;letter-spacing:1px;text-transform:uppercase;opacity:.7;position:absolute;margin-top:-12px}
.olt .when-held{display:none}.olt.holding .when-held{display:flex}.olt.holding .when-free{display:none}
.olt-shelf{position:absolute;left:0;right:0;top:var(--tray);bottom:var(--trayb);pointer-events:none;border-top:1.5px solid rgba(58,36,24,.35);background:linear-gradient(rgba(214,196,160,.42),rgba(214,196,160,.15))}
.olt-shelf:before{content:'';position:absolute;left:0;right:0;top:3px;border-top:1px solid rgba(58,36,24,.18)}
.olt.overtray .olt-shelf{background:linear-gradient(rgba(201,142,47,.35),rgba(201,142,47,.12))}
.olt-shelf-cap{position:absolute;left:calc(16px + var(--sl));top:6px;font-size:10px;letter-spacing:1.8px;text-transform:uppercase;opacity:.65}
.olt.holding .olt-shelf-cap{opacity:.9;color:#7a4a14}
.olt-labels{position:absolute;left:0;right:0;top:calc(var(--labels) - 4px);height:30px;pointer-events:none;overflow:hidden}
.olt-label{position:absolute;left:0;top:0;width:84px;margin-left:-42px;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-size:13.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.olt-label i{display:block;font-size:10px;font-family:'Nunito Sans',sans-serif;font-style:normal;letter-spacing:1.3px;opacity:.55;margin-bottom:1px}
.olt-result,.olt-menu,.olt-preparing{position:absolute;left:calc(16px + var(--sl));right:calc(16px + var(--sr));pointer-events:none;opacity:0;visibility:hidden;transform:translateY(12px);transition:opacity .35s,transform .35s,visibility 0s linear .35s}
.olt-result:not(.on) *,.olt-menu:not(.on) *,.olt-preparing:not(.on) *{pointer-events:none !important}
.olt-result.on,.olt-menu.on,.olt-preparing.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .35s,transform .35s,visibility 0s}
.olt-card{background:#f4ecd9;border:1.5px solid rgba(58,36,24,.7);border-radius:20px 16px 22px 15px;padding:14px 16px 12px;box-shadow:0 10px 30px rgba(74,48,32,.22)}
.olt-result{bottom:calc(var(--trayb) + 8px)}
.olt-r-title{font-family:'DM Serif Display',Georgia,serif;font-size:24px}
.olt-r-name{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;margin-top:2px}
.olt-r-stars{position:absolute;right:20px;top:18px;font-size:18px;letter-spacing:3px;color:rgba(58,36,24,.2)}.olt-r-stars .on{color:#c98e2f}
.olt-r-rows{margin:10px 0 2px;padding-top:8px;border-top:1px solid rgba(58,36,24,.25);display:flex;justify-content:space-between;gap:6px}
.olt-r-rows div{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.olt-r-rows b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px;line-height:1.1}
.olt-r-rows span{font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;opacity:.65;white-space:nowrap}
.olt-r-status{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;margin-top:6px}
.olt-rank{font-size:10px;letter-spacing:1.2px;text-transform:uppercase;min-height:12px;margin:4px 0 0;opacity:.6}
.olt-actions{display:flex;gap:8px;margin-top:8px}
.olt-actions button{flex:1;height:46px;border-radius:14px 12px 15px 11px;border:1.5px solid rgba(58,36,24,.6);font-weight:700;font-size:14px;letter-spacing:.4px}
.olt-actions .primary{background:#3a2418;color:#f4ead4}
.olt-again{position:absolute;right:calc(16px + var(--sr));top:calc(var(--row) + 6px);display:none}
.olt-again.on{display:flex}
.olt-menu{top:calc(var(--top) + 58px);max-height:calc(var(--tray) - var(--top) - 40px);overflow:auto}
.olt-menu h3{margin:0 0 8px;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px}
.olt-levels{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.olt-levels button{display:flex;align-items:center;gap:8px;text-align:left;height:40px;padding:0 10px;border:1.2px solid rgba(58,36,24,.4);border-radius:12px 10px 13px 9px;background:rgba(255,250,238,.5)}
.olt-levels button b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:18px;min-width:20px}
.olt-levels button i{font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.olt-levels button.cur{background:#3a2418;color:#f4ead4}
.olt-levels button.done b:after{content:' ✦';font-size:11px;color:#c98e2f}
.olt-levels button:disabled{opacity:.4}
.olt-levels .endless{grid-column:1 / -1}
.olt-menu-row{display:flex;gap:8px;margin-top:10px}
.olt-menu-row button{flex:1;min-height:42px;border:1.2px solid rgba(58,36,24,.5);border-radius:12px 10px 13px 9px;font-size:13px;padding:4px 8px}
.olt-menu-row button b{display:block;font-size:13px}
.olt-menu-row button span{display:block;font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.65}
.olt-help{margin-top:10px;font-family:'Cormorant Garamond',Georgia,serif;font-size:16px;line-height:1.3}
.olt-help b{font-family:'Nunito Sans',sans-serif;font-size:12px}
.olt-preparing{top:calc(var(--row) - 60px);text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px}
.olt-coach{position:absolute;pointer-events:none;opacity:0;transition:opacity .4s}
.olt-coach *{pointer-events:none}
.olt.coach1 .olt-coach.c1,.olt.coach2 .olt-coach.c2{opacity:1}
.olt-coach .pill{position:absolute;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;background:rgba(244,236,218,.92);border:1.3px solid rgba(58,36,24,.5);border-radius:14px;padding:4px 12px}
.olt-coach.c1{left:0;right:0;top:0;bottom:0}
.olt-coach.c1 .pill{left:50%;transform:translateX(-50%);top:calc(var(--row) - 40px)}
.olt-coach.c1 .hand{position:absolute;left:calc(var(--sl) + 30px);top:calc(var(--tray) + 30px);width:40px;height:40px;animation:olt-hand 2.6s ease-in-out infinite}
.olt-coach.c1 .hand svg{width:40px;height:40px}
@keyframes olt-hand{0%{transform:translate(0,0);opacity:0}12%{opacity:1}55%{transform:translate(110px,-220px);opacity:1}75%{opacity:0}100%{transform:translate(110px,-220px);opacity:0}}
.olt-coach.c2{left:0;right:0;top:calc(var(--row) - 42px)}
.olt-coach.c2 .pill{left:50%;transform:translateX(-50%)}
</style>
<div class="olt-boot"><div class="olt-boot-t">One Last Thing</div><div class="olt-boot-s">opening the drawer…</div></div>
<div class="olt-shelf"><div class="olt-shelf-cap">The collection</div></div>
<div class="olt-labels"></div>
<div class="olt-top">
  <div class="olt-title"><span class="olt-no">No. 1</span><span class="olt-name"></span><div class="olt-sub"><span class="olt-count"></span><span class="olt-time"></span></div></div>
  <div class="olt-icons"><button class="olt-ib olt-sound" aria-label="Sound">${ICON.sound}</button><button class="olt-ib olt-menu-btn" aria-label="Drawers and options">${ICON.menu}</button></div>
</div>
<div class="olt-toast"></div>
<div class="olt-row">
  <div class="grp when-free">
    <button class="olt-b olt-undo" aria-label="Undo">${ICON.undo}<span>Undo</span></button>
    <button class="olt-b olt-reset" aria-label="Empty the drawer">${ICON.reset}<span>Empty</span></button>
    <button class="olt-b olt-view" aria-label="Reset view">${ICON.view}<span>View</span></button>
  </div>
  <div class="grp when-held">
    <button class="olt-b olt-turn" aria-label="Turn">${ICON.turn}<span>Turn</span></button>
    <button class="olt-b olt-tip" aria-label="Tip">${ICON.tip}<span>Tip</span></button>
    <button class="olt-b olt-roll" aria-label="Roll">${ICON.roll}<span>Roll</span></button>
    <button class="olt-b olt-fine" aria-label="Rotation step"><b>90°</b><span>step</span></button>
    <div class="olt-lift"><button class="olt-b olt-up" aria-label="Raise">${ICON.up}</button><button class="olt-b olt-down" aria-label="Lower">${ICON.down}</button></div>
    <button class="olt-b primary olt-place" aria-label="Place">${ICON.place}<span>Place</span></button>
  </div>
</div>
<span class="olt-lift-v" style="display:none"></span>
<button class="olt-back" style="display:none"></button>
<div class="olt-coach c1"><div class="hand">${ICON.hand}</div><div class="pill">Drag a piece up into the drawer</div></div>
<div class="olt-coach c2"><div class="pill">Turn, tip or roll it until it fits</div></div>
<div class="olt-preparing olt-card">Finding a drawer that everything fits in…</div>
<button class="olt-b olt-again" aria-label="Show results">${ICON.view}<span>Results</span></button>
<div class="olt-result olt-card">
  <div class="olt-r-title"></div><div class="olt-r-name"></div><div class="olt-r-stars"></div>
  <div class="olt-r-rows"></div><div class="olt-r-status"></div><div class="olt-rank"></div>
  <div class="olt-actions"><button class="olt-admire">Admire</button><button class="primary olt-next">Next drawer</button></div>
</div>
<div class="olt-menu olt-card">
  <h3>Drawers</h3>
  <div class="olt-levels"></div>
  <div class="olt-menu-row"><button class="olt-mode"><span>Mode</span><b>Fit everything</b></button><button class="olt-restart"><span>This drawer</span><b>Start again</b></button></div>
  <div class="olt-help"><b>DRAG</b> a piece from the shelf into the drawer · <b>TAP</b> a placed piece to pick it up · <b>TWIST</b> two fingers to turn it · <b>TURN / TIP / ROLL</b> rotate a quarter turn (or 15°) · <b>▲▼</b> raise or lower it under an overhang · <b>DRAG</b> empty space to look around, <b>PINCH</b> to zoom. Every drawer has been solved before you see it.</div>
  <div class="olt-menu-row"><button class="olt-menu-close"><b>Back to the drawer</b></button></div>
</div>
`;

})();
