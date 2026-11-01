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
