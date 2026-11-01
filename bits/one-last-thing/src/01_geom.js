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
