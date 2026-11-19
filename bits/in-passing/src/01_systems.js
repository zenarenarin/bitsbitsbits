// ---------------------------------------------------------------------------
// The movement ecology. Every moving thing in the world is an analytic function
// of world time, so the simulation, the validator and the renderer always agree
// and a route plays identically every time it is loaded.
//
//   surface: something you can stand on (one-way from above). pose(t) gives the
//            left end and the angle of its walking line.
//   handle:  something you can hold onto. pos(t) gives the grip point (or false
//            while it is hidden inside a mechanism).
// ---------------------------------------------------------------------------

let _sysId = 0;

function makeSurface(sys, len, poseFn, opts) {
  const s = {
    id: 0, sys, len, pose: poseFn,
    mat: (opts && opts.mat) || 'wood',
    isStatic: !!(opts && opts.isStatic),
    isGoal: !!(opts && opts.isGoal),
    checkpoint: !!(opts && opts.checkpoint),
    xmin: 0, xmax: 0, ymin: 0, ymax: 0
  };
  sys.surfaces.push(s);
  return s;
}

function makeHandle(sys, posFn, opts) {
  const h = { id: 0, sys, pos: posFn, xmin: 0, xmax: 0, ymin: 0, ymax: 0, kind: (opts && opts.kind) || 'ring' };
  sys.handles.push(h);
  return h;
}

function baseSys(kind, params) {
  return { id: ++_sysId, kind, params, surfaces: [], handles: [], module: -1 };
}

// ---- Static ground: piers, roofs, terraces ---------------------------------
function sysPier(x, y, len, style) {
  const sys = baseSys('pier', { x, y, len, style: style || 'stone' });
  const out = { x, y, a: 0 };
  makeSurface(sys, len, (t, o) => { o = o || {}; o.x = x; o.y = y; o.a = 0; return o; },
    { mat: style === 'wood' ? 'wood' : 'stone', isStatic: true, checkpoint: true });
  void out;
  return sys;
}

// ---- Skiff: a ferry boat shuttling between two moorings --------------------
function sysSkiff(p) {
  // p: { xa, xb, y, len, period, moveT, pattern, phase, split }
  const sys = baseSys('skiff', p);
  const cyc = makeCycle(p.period, p.pattern, p.phase);
  sys.state = t => {
    const c = cyc(t);
    const u = shuttleValue(c.local, c.dur, p.moveT, p.split);
    return { u, x: lerp(p.xa, p.xb, u), y: p.y + 0.045 * Math.sin(t * 2.2 + p.xa), a: 0.018 * Math.sin(t * 1.6 + p.xb), k: c.k, i: c.i };
  };
  makeSurface(sys, p.len, (t, o) => {
    const st = sys.state(t); o = o || {};
    o.x = st.x; o.y = st.y; o.a = st.a; return o;
  }, { mat: 'wood' });
  return sys;
}

// ---- Lift: a cage on a rope; pairs share one counterweighted rope -----------
function sysLift(p) {
  // p: { cages:[{x, yb, h, inv}], len, period, moveT, pattern, phase, split }
  const sys = baseSys('lift', p);
  const cyc = makeCycle(p.period, p.pattern, p.phase);
  sys.state = t => {
    const c = cyc(t);
    return { u: shuttleValue(c.local, c.dur, p.moveT, p.split), k: c.k, i: c.i, local: c.local, dur: c.dur };
  };
  for (const cage of p.cages) {
    makeSurface(sys, p.len, (t, o) => {
      const u = sys.state(t).u; o = o || {};
      const v = cage.inv ? 1 - u : u;
      o.x = cage.x; o.y = cage.yb + cage.h * v; o.a = 0; return o;
    }, { mat: 'metal' });
  }
  return sys;
}

// ---- Bellows: slowly breathes in, then puffs up and stops dead -------------
function sysBellows(p) {
  // p: { x, top, depth, len, period, puffT, holdTop, holdLow, phase }
  const sys = baseSys('bellows', p);
  const cyc = makeCycle(p.period, null, p.phase);
  sys.state = t => {
    const c = cyc(t);
    const L = c.local, D = c.dur;
    const compT = D - p.puffT - p.holdTop - p.holdLow;
    let squeeze; let phase;
    if (L < p.holdTop) { squeeze = 0; phase = 'top'; }
    else if (L < p.holdTop + compT) { squeeze = smooth((L - p.holdTop) / compT); phase = 'breathe'; }
    else if (L < p.holdTop + compT + p.holdLow) { squeeze = 1; phase = 'low'; }
    else { const w = (L - p.holdTop - compT - p.holdLow) / p.puffT; squeeze = 1 - w * w; phase = 'puff'; }
    return { squeeze, phase, i: c.i };
  };
  makeSurface(sys, p.len, (t, o) => {
    const st = sys.state(t); o = o || {};
    o.x = p.x; o.y = p.top - p.depth * st.squeeze; o.a = 0; return o;
  }, { mat: 'cloth' });
  return sys;
}

// ---- Wheel: a great wheel carrying level gondolas round and round ----------
function sysWheel(p) {
  // p: { cx, cy, R, n, period, phase, dir (-1 = clockwise, top moves right) }
  const sys = baseSys('wheel', p);
  sys.angleAt = t => p.phase * TAU + p.dir * TAU * t / p.period;
  const hang = 1.05, half = 0.85;
  for (let k = 0; k < p.n; k++) {
    const off = k * TAU / p.n;
    makeSurface(sys, half * 2, (t, o) => {
      const ph = sys.angleAt(t) + off; o = o || {};
      o.x = p.cx + p.R * Math.cos(ph) - half; o.y = p.cy + p.R * Math.sin(ph) - hang; o.a = 0; return o;
    }, { mat: 'wood' });
  }
  sys.hang = hang; sys.half = half;
  return sys;
}

// ---- Swing: a crane arm with a ring on a long rope -------------------------
function sysSwing(p) {
  // p: { px, py, L, amp, period, phase }
  const sys = baseSys('swing', p);
  sys.angleAt = t => p.amp * Math.sin(TAU * (t / p.period + p.phase));
  makeHandle(sys, (t, o) => {
    const th = sys.angleAt(t);
    o.x = p.px + p.L * Math.sin(th); o.y = p.py - p.L * Math.cos(th); return true;
  });
  return sys;
}

// ---- Trolley line: rings that run down a cable and vanish into a wheelhouse
function sysTrolley(p) {
  // p: { ax, ay, bx, by, speed, n, returnLen, phase }
  const sys = baseSys('trolley', p);
  const C = Math.hypot(p.bx - p.ax, p.by - p.ay);
  const loop = C + p.returnLen;
  sys.cableLen = C; sys.loop = loop;
  sys.paramAt = (t, k) => fract(t * p.speed / loop + k / p.n + p.phase) * loop;
  for (let k = 0; k < p.n; k++) {
    makeHandle(sys, (t, o) => {
      const s = sys.paramAt(t, k);
      if (s > C) return false;
      const f = s / C;
      o.x = lerp(p.ax, p.bx, f); o.y = lerp(p.ay, p.by, f) - 0.55; return true;
    });
  }
  return sys;
}

// ---- Strider: a long-legged creature carrying a deck between two places ----
function sysStrider(p) {
  // p: { xa, xb, y, len, period, moveT, pattern, phase, stride, goal, scale }
  const sys = baseSys(p.goal ? 'walker' : 'strider', p);
  const cyc = makeCycle(p.period, p.pattern, p.phase);
  sys.state = t => {
    const c = cyc(t);
    const u = shuttleValue(c.local, c.dur, p.moveT, p.split);
    const x = lerp(p.xa, p.xb, u);
    const dwell = Math.max(0, c.dur - 2 * p.moveT);
    const outward = c.local < dwell * (p.split == null ? 0.5 : p.split) + p.moveT + 1e-6;
    const legs = outward ? u : 2 - u;
    // Step phase follows distance covered so the legs never skate.
    const span = Math.abs(p.xb - p.xa);
    const dist = (c.i * 2 + legs) * span;
    const dir = outward ? Math.sign(p.xb - p.xa) : -Math.sign(p.xb - p.xa);
    const stepPh = dist / p.stride;
    const moving = u > 0.0005 && u < 0.9995;
    const bob = 0.13 * (p.scale || 1) * Math.abs(Math.sin(Math.PI * stepPh)) + 0.03 * Math.sin(t * 1.3);
    return { u, x, stepPh, bob, moving, dir, k: c.k, i: c.i, local: c.local, dur: c.dur };
  };
  makeSurface(sys, p.len, (t, o) => {
    const st = sys.state(t); o = o || {};
    o.x = st.x - p.len / 2; o.y = p.y + st.bob; o.a = 0.012 * Math.sin(Math.PI * st.stepPh * 2); return o;
  }, { mat: p.goal ? 'goal' : 'creature', isGoal: !!p.goal });
  return sys;
}

// Precompute a conservative bounding box of a surface/handle over its motion.
function sampleBounds(item, isHandle, span) {
  let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
  const o = { x: 0, y: 0, a: 0 };
  const T = span || 40;
  for (let t = 0; t <= T; t += 0.05) {
    if (isHandle) {
      if (!item.pos(t, o)) continue;
      xmin = Math.min(xmin, o.x); xmax = Math.max(xmax, o.x);
      ymin = Math.min(ymin, o.y); ymax = Math.max(ymax, o.y);
    } else {
      item.pose(t, o);
      const ex = o.x + Math.cos(o.a) * item.len, ey = o.y + Math.sin(o.a) * item.len;
      xmin = Math.min(xmin, o.x, ex); xmax = Math.max(xmax, o.x, ex);
      ymin = Math.min(ymin, o.y, ey); ymax = Math.max(ymax, o.y, ey);
    }
  }
  item.xmin = xmin - 0.2; item.xmax = xmax + 0.2; item.ymin = ymin - 0.2; item.ymax = ymax + 0.2;
}

// A world is the flattened set of surfaces and handles, bucketed along x.
function makeWorld(systems, letters, waters) {
  const surfaces = [], handles = [];
  for (const sys of systems) {
    for (const s of sys.surfaces) { s.id = surfaces.length; surfaces.push(s); sampleBounds(s, false, sysSpan(sys)); }
    for (const h of sys.handles) { h.id = handles.length; handles.push(h); sampleBounds(h, true, sysSpan(sys)); }
  }
  const CELL = 4;
  let xmin = 1e9, xmax = -1e9;
  for (const s of surfaces) { xmin = Math.min(xmin, s.xmin); xmax = Math.max(xmax, s.xmax); }
  const n = Math.ceil((xmax - xmin) / CELL) + 1;
  const sb = Array.from({ length: n }, () => []), hb = Array.from({ length: n }, () => []);
  const put = (arr, it) => {
    const a = clamp(Math.floor((it.xmin - xmin) / CELL), 0, n - 1), b = clamp(Math.floor((it.xmax - xmin) / CELL), 0, n - 1);
    for (let i = a; i <= b; i++) arr[i].push(it);
  };
  surfaces.forEach(s => put(sb, s));
  handles.forEach(h => put(hb, h));
  // Floor: below the lowest thing near x, the courier is falling for good.
  const floor = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 1e9;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) for (const s of sb[j]) lo = Math.min(lo, s.ymin);
    floor[i] = (lo > 1e8 ? -20 : lo) - 7;
  }
  const cellOf = x => clamp(Math.floor((x - xmin) / CELL), 0, n - 1);
  const wl = waters || [];
  return {
    systems, surfaces, handles, letters: letters || [], waters: wl, xmin, xmax,
    surfacesNear: x => sb[cellOf(x)],
    handlesNear: x => hb[cellOf(x)],
    floorAt: x => {
      let f = floor[cellOf(x)];
      for (let i = 0; i < wl.length; i++) if (x > wl[i].x0 && x < wl[i].x1 && wl[i].y > f) f = wl[i].y;
      return f;
    }
  };
}

function sysSpan(sys) {
  const p = sys.params || {};
  let T = 20;
  if (p.period) T = p.period * ((p.pattern && p.pattern.length) || 1) + 1;
  if (sys.kind === 'trolley') T = sys.loop / p.speed + 1;
  return Math.min(60, Math.max(8, T));
}
