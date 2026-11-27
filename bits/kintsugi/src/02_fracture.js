// Controlled fracture. A warped, weighted Voronoi field on the object's (u,v)
// surface decides which fragment owns every grid vertex; marching triangles on
// the differences of the distance fields give smooth crack curves that both
// neighbouring fragments share exactly. Each fragment becomes a real shard:
// glazed outer and inner skins, unglazed fracture walls, and a rounded lip.
// The crack graph becomes the seams the player fills with gold.

function buildFracture(surf, lv) {
  const def = surf.def;
  const T = def.thick;
  const nu = 144;
  const nv = clamp(Math.round(surf.L / (TAU * surf.radius / 1.15 / nu) * 0.9), 40, 76);
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
