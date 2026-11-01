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
