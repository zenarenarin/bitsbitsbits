// =====================================================================
// Light and shadow. One function decides both what is drawn and what the
// Watcher sees: a lamp's lit region is its visibility polygon, built by
// casting rays against the same occluding edges that `isLit` tests. If a
// slab, chimney, awning, shutter or sheet stands between you and a lamp,
// you are in its shadow, on screen and in the rules.
// =====================================================================
function createOptics(level) {
  const O = { stat: [], dyn: [] };
  const seg = (ax, ay, bx, by, src) => ({ ax, ay, bx, by, src });
  const rectSegs = (x0, y0, x1, y1, src, out) => {
    out.push(seg(x0, y0, x1, y0, src), seg(x1, y0, x1, y1, src), seg(x1, y1, x0, y1, src), seg(x0, y1, x0, y0, src));
  };
  for (const s of level.solids) if (s.occ) {
    if (s.kind === 'street' || s.kind === 'cellar') O.stat.push(seg(s.x0, s.y1, s.x1, s.y1, s), seg(s.x0, s.y0, s.x0, s.y1, s), seg(s.x1, s.y0, s.x1, s.y1, s));
    else rectSegs(s.x0, s.y0, s.x1, s.y1, s, O.stat);
  }
  for (const p of level.plats) if (p.occ) rectSegs(p.x0, p.y - p.th, p.x1, p.y, p, O.stat);

  // each lamp keeps the static edges that can matter to it
  for (const l of level.lights) {
    const R = l.range + 1;
    l.segs = O.stat.filter(s => Math.min(s.ax, s.bx) < l.x + R && Math.max(s.ax, s.bx) > l.x - R && Math.min(s.ay, s.by) < l.y + R && Math.max(s.ay, s.by) > l.y - R);
  }

  // moving occluders, rebuilt each step by the game
  O.setDynamic = function (list) { O.dyn = list; };

  function nearest(l, dx, dy, max) {
    let best = max;
    const segs = l.segs;
    for (let i = 0; i < segs.length; i++) { const s = segs[i]; const t = raySeg(l.x, l.y, dx, dy, s.ax, s.ay, s.bx, s.by); if (t < best) best = t; }
    const d = O.dyn;
    for (let i = 0; i < d.length; i++) { const s = d[i]; const t = raySeg(l.x, l.y, dx, dy, s.ax, s.ay, s.bx, s.by); if (t < best) best = t; }
    return best;
  }

  // Visibility polygon of a lamp within its cone. Returns a flat array
  // [x0,y0,x1,y1,...] starting at the lamp.
  O.polygon = function (l, out) {
    out = out || [];
    out.length = 0;
    const half = l.halfNow, a0 = l.ang - half, R = l.range;
    const rel = [];
    const pushRel = r => { if (r >= -half && r <= half) rel.push(r); };
    const add = (x, y) => { const r = angNorm(Math.atan2(y - l.y, x - l.x) - l.ang); pushRel(r - 1e-4); pushRel(r); pushRel(r + 1e-4); };
    const all = [l.segs, O.dyn];
    for (const list of all) for (const s of list) {
      const mx = Math.min(s.ax, s.bx), Mx = Math.max(s.ax, s.bx), my = Math.min(s.ay, s.by), My = Math.max(s.ay, s.by);
      if (mx > l.x + R || Mx < l.x - R || my > l.y + R || My < l.y - R) continue;
      add(s.ax, s.ay); add(s.bx, s.by);
    }
    const steps = Math.max(4, Math.ceil(half * 2 / deg(2.5)));
    for (let i = 0; i <= steps; i++) rel.push(-half + 2 * half * i / steps);
    rel.sort((a, b) => a - b);
    out.push(l.x, l.y);
    let last = -9;
    for (const r of rel) {
      if (r - last < 1e-6) continue;
      last = r;
      const a = l.ang + r, dx = Math.cos(a), dy = Math.sin(a);
      const t = nearest(l, dx, dy, R);
      out.push(l.x + dx * t, l.y + dy * t);
    }
    return out;
  };

  // Can lamp l see point (px,py)? Same edges, same cone, same range.
  O.sees = function (l, px, py) {
    const dx = px - l.x, dy = py - l.y, d = Math.hypot(dx, dy);
    if (d > l.range * 0.985) return false;
    if (Math.abs(angNorm(Math.atan2(dy, dx) - l.ang)) > l.halfNow) return false;
    return nearest(l, dx, dy, 1 - 1e-4) >= 1 - 1e-4;
  };
  return O;
}
