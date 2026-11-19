// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// IN PASSING — built from src/ by build.js; edit the sources, not this file.
window.plethoraBit = (function () {
'use strict';
// ---- 00_util.js ----
// ---------------------------------------------------------------------------
// Utilities shared by the simulation, route generator, renderer and audio.
// Everything in src/00..03 is pure (no DOM, no three) so dev/*.js can run the
// exact same simulation in Node.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const easeCos = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const fract = v => v - Math.floor(v);

// Small, fast, seedable PRNG (mulberry32).
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// A repeating cycle whose individual cycles may differ in length.
// pattern: multipliers of the base period, e.g. [1, 1, 1.4] means every third
// cycle lasts 40% longer (an operator who pauses for tea every third trip).
// Returns { i, u, dur, t0 } where u is 0..1 inside the current cycle.
function makeCycle(period, pattern, phase) {
  const pat = pattern && pattern.length ? pattern : [1];
  const durs = pat.map(m => period * m);
  const total = durs.reduce((a, b) => a + b, 0);
  const off = (phase || 0) * total;
  const out = { i: 0, u: 0, dur: durs[0], t0: 0, k: 0 };
  return function cycleAt(t) {
    const tt = t + off;
    const rep = Math.floor(tt / total);
    let r = tt - rep * total;
    let k = 0;
    while (k < durs.length - 1 && r >= durs[k]) { r -= durs[k]; k++; }
    out.k = k;
    out.i = rep * durs.length + k;
    out.dur = durs[k];
    out.u = clamp(r / durs[k], 0, 1);
    out.local = r;
    out.t0 = t - r;
    return out;
  };
}

// Shuttle profile between 0 and 1 with dwells at each end. Travel durations
// are fixed in seconds so that only the dwell stretches on longer cycles.
// Layout of one cycle: [dwell at 0][move 0->1][dwell at 1][move 1->0]
function shuttleValue(local, dur, moveT, dwellSplit) {
  const dwell = Math.max(0, dur - 2 * moveT);
  const dA = dwell * (dwellSplit == null ? 0.5 : dwellSplit);
  const dB = dwell - dA;
  if (local < dA) return 0;
  local -= dA;
  if (local < moveT) return easeCos(local / moveT);
  local -= moveT;
  if (local < dB) return 1;
  local -= dB;
  return 1 - easeCos(local / moveT);
}

// ---- 01_systems.js ----
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

// ---- 02_player.js ----
// ---------------------------------------------------------------------------
// The courier. One finger:
//   press         -> leap (on the ground) / hands out (in the air)
//   keep holding  -> catch any ring that passes your hands, and hang on
//   let go        -> let go, keeping the ring's momentum
// On the ground the courier walks to the far lip of whatever carries them and
// waits there, so they never walk off anything by themselves. A leap always
// adds the same push to the velocity of the thing you leave: momentum is
// inherited, never invented.
// ---------------------------------------------------------------------------

const PHYS = {
  G: 20, JVX: 3.8, JVY: 8.2, WALK: 2.7, LIP: 0.3, HANG: 1.0, GRAB_R: 0.85,
  COYOTE: 0.12, BUFFER: 0.14, TERM: -26, DT: 1 / 120, RELEASE_UP: 1.5, RELEASE_K: 1.06
};

const _o1 = { x: 0, y: 0, a: 0 }, _o2 = { x: 0, y: 0, a: 0 }, _h1 = { x: 0, y: 0 }, _h2 = { x: 0, y: 0 };

function surfPoint(sf, s, t, o) {
  sf.pose(t, o);
  const c = Math.cos(o.a), sn = Math.sin(o.a);
  o.x += c * s; o.y += sn * s;
  return o;
}

function makePlayer(surf, s, t) {
  const p = {
    mode: 'ground', surf, s: s || 0, x: 0, y: 0, vx: 0, vy: 0, gvx: 0, gvy: 0,
    handle: null, hvx: 0, hvy: 0, cd: {}, pressT: -9, leftT: -9, leftVx: 0, leftVy: 0,
    jumped: false, atLip: false, waitT: 0, airT: 0, ev: [], checkpoint: surf.isStatic ? surf : null,
    checkpointS: 0, justLanded: true, landT: t, held: false, lastSurf: surf, grabT: 0
  };
  surfPoint(surf, p.s, t, _o1); p.x = _o1.x; p.y = _o1.y;
  return p;
}

function cloneP(p) {
  const q = Object.assign({}, p);
  q.cd = Object.assign({}, p.cd);
  q.ev = [];
  return q;
}

function findTransfer(W, sf, t) {
  surfPoint(sf, sf.len, t, _o1);
  const ex = _o1.x, ey = _o1.y;
  for (const s2 of W.surfacesNear(ex)) {
    if (s2 === sf) continue;
    s2.pose(t, _o2);
    if (_o2.x > ex - 0.5 && _o2.x < ex + 0.4 && Math.abs(_o2.y - ey) < 0.22) return s2;
  }
  return null;
}

function doJump(p, bx, by, t) {
  p.mode = 'air';
  p.vx = bx + PHYS.JVX; p.vy = by + PHYS.JVY;
  p.pressT = -9; p.jumped = true; p.leftT = t; p.airT = 0;
  p.ev.push({ type: 'jump', waited: p.waitT, vx: p.vx, vy: p.vy, surf: p.surf });
  p.waitT = 0; p.atLip = false;
}

function playerStep(p, W, t, dt, held, pressed) {
  const tp = t - dt;
  p.held = held;
  if (pressed) p.pressT = t;

  if (p.mode === 'ground') {
    let sf = p.surf;
    const lipS = Math.max(0, sf.len - PHYS.LIP);
    if (p.s < lipS - 1e-6) {
      p.s = Math.min(lipS, p.s + PHYS.WALK * dt);
      p.atLip = false;
    } else {
      const tr = findTransfer(W, sf, t);
      if (tr) {
        sf.pose(t, _o1);
        p.surf = sf = tr; p.s = 0.02; p.justLanded = true;
        if (tr.isStatic) { p.checkpoint = tr; p.checkpointS = 0; }
        if (tr.isGoal) p.ev.push({ type: 'goal', surf: tr });
        p.ev.push({ type: 'step', surf: tr });
      } else {
        if (p.s > lipS) p.s = Math.max(lipS, p.s - 1.2 * dt);
        if (!p.atLip) p.ev.push({ type: 'lip', surf: sf });
        p.atLip = true; p.waitT += dt;
      }
    }
    surfPoint(sf, p.s, t, _o1);
    surfPoint(sf, p.s, tp, _o2);
    const vx = (_o1.x - _o2.x) / dt, vy = (_o1.y - _o2.y) / dt;
    if (!p.justLanded) {
      // Thrown off when the ground decelerates harder than gravity can hold you.
      const nx = -Math.sin(_o1.a), ny = Math.cos(_o1.a);
      const an = ((vx - p.gvx) * nx + (vy - p.gvy) * ny) / dt;
      const vnPrev = p.gvx * nx + p.gvy * ny;
      if (an < -PHYS.G * 1.05 && vnPrev > 0.8) {
        p.mode = 'air'; p.vx = p.gvx; p.vy = p.gvy; p.x = _o1.x; p.y = _o1.y;
        p.leftT = t; p.leftVx = p.gvx; p.leftVy = p.gvy; p.jumped = false; p.airT = 0;
        p.ev.push({ type: 'launch', speed: Math.hypot(p.gvx, p.gvy), surf: sf });
        // A leap pressed during the throw itself still counts (handled below via coyote).
        if (t - p.pressT <= PHYS.BUFFER) doJump(p, p.leftVx, p.leftVy, t);
        return;
      }
    }
    p.justLanded = false;
    p.gvx = vx; p.gvy = vy; p.x = _o1.x; p.y = _o1.y;
    if (t - p.pressT <= PHYS.BUFFER) { p.leftVx = vx; p.leftVy = vy; doJump(p, vx, vy, t); }
    return;
  }

  if (p.mode === 'air') {
    if (pressed && !p.jumped && t - p.leftT <= PHYS.COYOTE) doJump(p, p.leftVx, p.leftVy, t);
    const ox = p.x, oy = p.y;
    p.vy = Math.max(PHYS.TERM, p.vy - PHYS.G * dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.airT += dt;

    if (held && t - p.leftT > 0.03) {
      const hx = p.x, hy = p.y + PHYS.HANG;
      for (const h of W.handlesNear(p.x)) {
        if (hx < h.xmin - 1 || hx > h.xmax + 1 || hy < h.ymin - 1 || hy > h.ymax + 1) continue;
        if ((p.cd[h.id] || 0) > t) continue;
        if (!h.pos(t, _h1)) continue;
        const d = Math.hypot(_h1.x - hx, _h1.y - hy);
        if (d < PHYS.GRAB_R) {
          if (!h.pos(tp, _h2)) { _h2.x = _h1.x; _h2.y = _h1.y; }
          p.hvx = (_h1.x - _h2.x) / dt; p.hvy = (_h1.y - _h2.y) / dt;
          p.ev.push({ type: 'grab', handle: h, impact: Math.hypot(p.vx - p.hvx, p.vy - p.hvy) });
          p.mode = 'hang'; p.handle = h; p.grabT = t;
          p.x = _h1.x; p.y = _h1.y - PHYS.HANG;
          return;
        }
      }
    }

    let best = null, bestTau = 2, bestS = 0;
    const x0 = Math.min(ox, p.x), x1 = Math.max(ox, p.x);
    for (const sf of W.surfacesNear(p.x)) {
      if (x1 < sf.xmin || x0 > sf.xmax || Math.min(oy, p.y) > sf.ymax + 0.5 || Math.max(oy, p.y) < sf.ymin - 0.5) continue;
      sf.pose(tp, _o2);
      let c = Math.cos(_o2.a), sn = Math.sin(_o2.a);
      let dx = ox - _o2.x, dy = oy - _o2.y;
      const py0 = -dx * sn + dy * c, ps0 = dx * c + dy * sn;
      if (py0 < -0.04) continue;
      sf.pose(t, _o1);
      c = Math.cos(_o1.a); sn = Math.sin(_o1.a);
      dx = p.x - _o1.x; dy = p.y - _o1.y;
      const py1 = -dx * sn + dy * c, ps1 = dx * c + dy * sn;
      if (py1 > 0) continue;
      const tau = py0 / Math.max(1e-6, py0 - py1);
      const sAt = lerp(ps0, ps1, clamp(tau, 0, 1));
      if (sAt < -0.12 || sAt > sf.len + 0.12) continue;
      if (tau < bestTau) { bestTau = tau; best = sf; bestS = sAt; }
    }
    if (best) {
      const rvx = p.vx, rvy = p.vy;
      p.mode = 'ground'; p.surf = best; p.s = clamp(bestS, 0, best.len);
      surfPoint(best, p.s, t, _o1); surfPoint(best, p.s, tp, _o2);
      p.gvx = (_o1.x - _o2.x) / dt; p.gvy = (_o1.y - _o2.y) / dt;
      p.x = _o1.x; p.y = _o1.y; p.justLanded = true; p.landT = t; p.waitT = 0; p.atLip = false;
      p.ev.push({ type: 'land', surf: best, impact: Math.hypot(rvx - p.gvx, rvy - p.gvy), airT: p.airT, from: p.lastSurf });
      p.lastSurf = best;
      if (best.isStatic) { p.checkpoint = best; p.checkpointS = p.s; }
      if (best.isGoal) p.ev.push({ type: 'goal', surf: best });
      return;
    }
    if (p.y < W.floorAt(p.x)) { p.mode = 'fall'; p.ev.push({ type: 'fall' }); }
    return;
  }

  if (p.mode === 'hang') {
    const h = p.handle;
    const vis = h.pos(t, _h1);
    if (vis) {
      if (!h.pos(tp, _h2)) { _h2.x = _h1.x; _h2.y = _h1.y; }
      p.hvx = (_h1.x - _h2.x) / dt; p.hvy = (_h1.y - _h2.y) / dt;
      p.x = _h1.x; p.y = _h1.y - PHYS.HANG;
    }
    if (!vis || !held) {
      p.mode = 'air'; p.vx = p.hvx * PHYS.RELEASE_K; p.vy = p.hvy * PHYS.RELEASE_K + PHYS.RELEASE_UP;
      p.cd[h.id] = t + 0.4; p.handle = null; p.leftT = t; p.jumped = true; p.airT = 0;
      p.ev.push({ type: 'release', forced: !vis, handle: h, vx: p.vx, vy: p.vy });
    }
  }
}

// Put a fallen courier back on their last sound footing.
function respawnPlayer(p, t) {
  const sf = p.checkpoint;
  p.mode = 'ground'; p.surf = sf; p.s = Math.max(0, Math.min(sf.len - PHYS.LIP - 0.6, 0.4));
  p.vx = p.vy = 0; p.handle = null; p.justLanded = true; p.waitT = 0; p.atLip = false; p.pressT = -9;
  p.lastSurf = sf;
  surfPoint(sf, p.s, t, _o1); p.x = _o1.x; p.y = _o1.y;
}

// ---- 03_route.js ----
// ---------------------------------------------------------------------------
// Routes. A route is a chain of modules, each a small arrangement of moving
// systems between two resting places. Modules are generated from a seed, then
// a bot plays every timing of every leap (and every release of every ring) with
// the real player physics, and the module is only kept if the onward path has
// a fair timing window. The same exploration finds the daring arcs where the
// optional lost letters are hung.
// ---------------------------------------------------------------------------

const BOT = { SNAP: 0.05, REL: 0.05, MAXREL: 4.6, AIRMAX: 4.0, TAP: 0.07, WAITMAX: 13, REHOLD: 0.12 };

// Fly until the courier stands somewhere, falls, catches a ring (if holding),
// or time runs out. holdFrom..holdTo is when the finger is down.
function botFly(W, p, t, holdFrom, holdTo, tMax, trace) {
  const dt = PHYS.DT;
  while (t < tMax) {
    t += dt;
    playerStep(p, W, t, dt, t >= holdFrom && t < holdTo, false);
    if (trace && ((t * 120) | 0) % 6 === 0) trace.push(p.x, p.y);
    if (p.mode !== 'air') break;
  }
  return t;
}

// Every way of leaving surface `sf` (arriving at s0, time t0) within WAITMAX:
// leap at each moment, either tapping or holding (which may catch a ring).
function expandSurface(W, sf, s0, t0, opts) {
  const dt = PHYS.DT, out = [];
  const waitMax = (opts && opts.waitMax) || BOT.WAITMAX;
  const trace = !!(opts && opts.trace);
  const p = makePlayer(sf, s0, t0);
  let t = t0, nextSnap = t0, snapI = 0;
  while (t < t0 + waitMax) {
    if (t >= nextSnap - 1e-9) {
      for (let v = 0; v < 2; v++) {
        const q = cloneP(p);
        let tt = t + dt;
        playerStep(q, W, tt, dt, true, true);
        if (q.mode === 'ground' || !q.jumped) continue;
        const tr = trace ? [q.x, q.y] : null;
        tt = botFly(W, q, tt, 0, v === 0 ? t + BOT.TAP : Infinity, tt + BOT.AIRMAX, tr);
        if (q.mode === 'ground') { if (v === 0) out.push({ to: q.surf, s: q.s, t: tt, ts: t, snap: snapI, kind: 'tap', trace: tr }); }
        else if (q.mode === 'hang') out.push({ to: q.handle, st: q, t: tt, ts: t, snap: snapI, kind: 'grab', trace: tr });
        else if (trace && v === 0) out.push({ to: null, t: tt, snap: snapI, kind: 'tap', trace: tr });
      }
      nextSnap += BOT.SNAP; snapI++;
    }
    t += dt;
    playerStep(p, W, t, dt, false, false);
    if (p.mode === 'ground' && p.surf !== sf) { out.push({ to: p.surf, s: p.s, t, snap: snapI, kind: 'walk' }); break; }
    if (p.mode !== 'ground' && t - p.leftT > PHYS.COYOTE) {
      // Thrown by the thing we stood on; the coyote presses were tried above.
      const tr = trace ? [p.x, p.y] : null;
      const t2 = botFly(W, p, t, 0, -1, t + BOT.AIRMAX, tr);
      if (p.mode === 'ground' && p.surf !== sf) out.push({ to: p.surf, s: p.s, t: t2, snap: snapI, kind: 'ride', trace: tr });
      break;
    }
  }
  return out;
}

// Every way of letting go of a ring, from the moment it was caught: let go and
// fall onto something, or let go and reach for the next ring.
function expandHandle(W, st, t0, opts) {
  const dt = PHYS.DT, out = [];
  const trace = !!(opts && opts.trace);
  const q = cloneP(st);
  const h = q.handle;
  let t = t0, relI = 0;
  const tr0 = trace ? [] : null;
  while (q.mode === 'hang' && t < t0 + BOT.MAXREL) {
    for (let v = 0; v < 2; v++) {
      const r = cloneP(q);
      const tr = trace ? tr0.slice() : null;
      const t2 = botFly(W, r, t, v === 0 ? 1e9 : t + BOT.REHOLD, v === 0 ? -1 : Infinity, t + BOT.AIRMAX, tr);
      if (r.mode === 'ground') { if (v === 0) out.push({ to: r.surf, s: r.s, t: t2, ts: t, snap: relI, kind: 'release', trace: tr }); }
      else if (r.mode === 'hang' && r.handle !== h) out.push({ to: r.handle, st: r, t: t2, ts: t, snap: relI, kind: 'regrab', trace: tr });
      else if (trace && v === 0) out.push({ to: null, t: t2, snap: relI, kind: 'release', trace: tr });
    }
    const tEnd = t + BOT.REL;
    while (t < tEnd - 1e-9 && q.mode === 'hang') { t += dt; playerStep(q, W, t, dt, true, false); if (tr0 && ((t * 120) | 0) % 6 === 0) tr0.push(q.x, q.y); }
    relI++;
  }
  return out;
}

// Longest run of consecutive leap (or release) moments that reach `to`, in s.
function windowOf(results, to) {
  const arr = [...new Set(results.filter(r => r.to === to).map(r => r.snap))].sort((a, b) => a - b);
  let run = arr.length ? 1 : 0, best = run;
  for (let i = 1; i < arr.length; i++) { run = arr[i] === arr[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
  return best * BOT.SNAP;
}

// Earliest-arrival search over surfaces and rings, using only fair moves.
function botSolve(W, start, s0, t0, goal, opts) {
  const minWin = (opts && opts.minWindow) || 0.2;
  const best = new Map(), done = new Set();
  const heap = [{ node: start, s: s0, t: t0, prev: null }];
  let expansions = 0;
  while (heap.length) {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i].t < heap[bi].t) bi = i;
    const n = heap.splice(bi, 1)[0];
    if (done.has(n.node)) continue;
    done.add(n.node);
    if (n.node.len != null && goal(n.node)) return { ok: true, t: n.t, node: n, expansions };
    if (opts && opts.maxExpand && expansions >= opts.maxExpand) break;
    expansions++;
    const res = n.node.len != null ? expandSurface(W, n.node, n.s, n.t, opts) : expandHandle(W, n.st, n.t, opts);
    if (opts && opts.collect) opts.collect.push({ from: n.node, res });
    const targets = new Set(res.map(r => r.to));
    for (const to of targets) {
      if (!to || to === n.node || done.has(to)) continue;
      const free = res.some(r => r.to === to && (r.kind === 'walk' || r.kind === 'ride'));
      const win = free ? 9 : windowOf(res, to);
      if (win < minWin) continue;
      let first = null;
      for (const r of res) if (r.to === to && (!first || r.t < first.t)) first = r;
      if (first.t < (best.get(to) ?? 1e9)) {
        best.set(to, first.t);
        heap.push({ node: to, s: first.s, st: first.st, t: first.t, prev: n, via: first, win });
      }
    }
  }
  return { ok: false, expansions };
}

// ---- Regions, routes ------------------------------------------------------
const REGIONS = [
  { key: 'ferry', name: 'The Ferry Steps', kinds: ['skiff', 'lift', 'bellows'], fresh: ['skiff', 'lift', 'bellows'] },
  { key: 'orchard', name: 'The Wheel Orchard', kinds: ['skiff', 'lift', 'bellows', 'wheel', 'swing'], fresh: ['wheel', 'swing'] },
  { key: 'lines', name: 'The High Lines', kinds: ['lift', 'bellows', 'wheel', 'swing', 'trolley', 'strider'], fresh: ['trolley', 'strider'] },
  { key: 'evening', name: 'The Long Evening', kinds: ['skiff', 'lift', 'bellows', 'wheel', 'swing', 'trolley', 'strider', 'swing2', 'wheelLine', 'liftSwing'], fresh: ['swing2', 'wheelLine', 'liftSwing'] }
];

const RECIPIENTS = [
  'Odile, who keeps the walking house', 'the bell-mender at Lantern Pier', 'Aunt Pell, on the moving terrace',
  'the twins who run the orchard wheel', 'Mr. Quarry, of the slow tower', 'the gardener of the swinging beds',
  'Ines at the cable house', 'the stilt-keeper of the high pasture', 'whoever lives in the folding bridge',
  'the cartographer who never stops walking', 'the lamplighter of the last ferry', 'Odile, again, with thanks'
];

const ROUTES = [];
for (let i = 0; i < 12; i++) {
  ROUTES.push({ index: i, region: Math.floor(i / 3), seed: 1013 + i * 7919, d: i / 11, modules: 4 + Math.round(i * 0.85), to: RECIPIENTS[i] });
}

function dailyRouteSpec(dateKey) {
  const seed = hashStr('in-passing:' + dateKey);
  return { index: -1, daily: true, dateKey, region: 3, seed, d: 0.55, modules: 10, to: 'today’s errand' };
}

// ---- Module generators ----------------------------------------------------
// Each receives (rng, cur, d) where cur = {x, y} is the right end of the pier
// the courier waits on, and returns { systems, end: {x, y}, water? }.

function genStones(rng, cur) {
  // Fallback: plain stepping stones. Always passable.
  const systems = [];
  let x = cur.x, y = cur.y;
  for (let i = 0; i < 2; i++) {
    x += 2.2; const len = 2.4; y += rng.range(-0.3, 0.5);
    systems.push(sysPier(x, y, len, 'wood'));
    x += len;
  }
  return { systems, end: { x, y }, pierB: systems[systems.length - 1] };
}

function genSkiff(rng, cur, d) {
  const len = 2.6;
  const G = rng.range(7.5, 10 + 3 * d);
  const water = cur.y - rng.range(0.7, 1.1);
  const xa = cur.x + rng.range(0.4, 0.8);
  const bx = cur.x + G, by = water + rng.range(0.4, 1.0 + 0.35 * d);
  const xb = bx - rng.range(0.5, 0.85) - len;
  const speed = rng.range(2.2, 3.0 + 1.2 * d);
  const moveT = Math.max(1.6, (xb - xa) / speed);
  const dwell = rng.range(3.0, 4.4) * (1 - 0.35 * d);
  const skiff = sysSkiff({ xa, xb, y: water, len, period: 2 * moveT + dwell, moveT, pattern: d > 0.35 && rng.chance(0.5) ? [1, 1, 1.35] : null, phase: rng(), split: 0.5 });
  const B = sysPier(bx, by, rng.range(3.2, 5), 'stone');
  return { systems: [skiff, B], end: { x: bx + B.params.len, y: by }, pierB: B, water: { x0: cur.x, x1: bx, y: water - 0.25 } };
}

function genLift(rng, cur, d) {
  const len = 2.0;
  const pair = d > 0.3 && rng.chance(0.55);
  const H = rng.range(3.2, 4.6 + 2.5 * d);
  const down = !pair && d > 0.15 && rng.chance(0.3);
  const x1 = cur.x + rng.range(0.7, 1.1);
  const moveT = H / rng.range(1.7, 2.4);
  const dwell = rng.range(2.4, 3.6) * (1 - 0.3 * d);
  const pattern = d > 0.25 && rng.chance(0.5) ? [1, 1.6] : null;
  let cages, endY, lastX;
  if (pair) {
    const y0 = cur.y - rng.range(0.1, 0.4);
    const x2 = x1 + len + rng.range(0.7, 1.0);
    cages = [{ x: x1, yb: y0, h: H }, { x: x2, yb: y0 + H, h: H, inv: true }];
    // The second cage rises while the first falls: change cages where they meet.
    endY = y0 + 2 * H; lastX = x2;
  } else if (down) {
    const y0 = cur.y - H - rng.range(0.1, 0.3);
    cages = [{ x: x1, yb: y0, h: H, inv: true }];
    endY = y0 + rng.range(-0.2, 0.4); lastX = x1;
  } else {
    const y0 = cur.y - rng.range(0.1, 0.4);
    cages = [{ x: x1, yb: y0, h: H }];
    endY = y0 + H + rng.range(-0.4, 0.3); lastX = x1;
  }
  const lift = sysLift({ cages, len, period: 2 * moveT + dwell, moveT, pattern, phase: rng(), split: 0.5 });
  const bx = lastX + len + rng.range(0.6, 1.0);
  const B = sysPier(bx, endY, rng.range(3.2, 4.8), 'stone');
  return { systems: [lift, B], end: { x: bx + B.params.len, y: endY }, pierB: B };
}

function genBellows(rng, cur, d) {
  const len = 2.2;
  const x = cur.x + rng.range(0.9, 1.4);
  const top = cur.y + rng.range(-0.3, 0.2);
  const bel = sysBellows({ x, top, depth: 1.5, len, period: rng.range(3.4, 4.4), puffT: 0.28, holdTop: 0.45, holdLow: rng.range(0.3, 0.6), phase: rng() });
  // Only a leap timed into the puff carries you up here.
  const H = rng.range(2.8, 3.8 + 2.2 * d);
  const lip = x + len - PHYS.LIP;
  const bx = lip + rng.range(3.4, 4.2);
  const B = sysPier(bx, top + H, rng.range(4.4, 5.4), 'stone');
  return { systems: [bel, B], end: { x: bx + B.params.len, y: top + H }, pierB: B };
}

function genWheel(rng, cur, d) {
  const R = rng.range(4.0, 5.0 + 1.0 * d);
  const n = rng.int(5, 7);
  const half = 0.85, hang = 1.05;
  const cx = cur.x + rng.range(0.7, 1.0) + half;
  const cy = cur.y - rng.range(0.2, 0.5) + R + hang;
  const wheel = sysWheel({ cx, cy, R, n, period: rng.range(13, 17) * (1 - 0.15 * d), phase: rng(), dir: -1 });
  const topY = cy + R - hang;
  const by = topY - rng.range(0.6, 2.4);
  const bx = cx + R + rng.range(0.2, 0.8);
  const B = sysPier(bx, by, rng.range(3.2, 4.8), 'stone');
  return { systems: [wheel, B], end: { x: bx + B.params.len, y: by }, pierB: B };
}

function genSwing(rng, cur, d) {
  const L = rng.range(4.6, 5.8);
  const hx = cur.x + rng.range(0.9, 1.4), hy = cur.y + rng.range(2.25, 2.6);
  const G = rng.range(6.2, 7.8 + 1.8 * d);
  const px = cur.x + G / 2;
  const amp = Math.asin(clamp((px - hx) / L, 0.2, 0.9));
  const py = hy + L * Math.cos(amp);
  const swing = sysSwing({ px, py, L, amp, period: TAU * Math.sqrt(L / 9.8) * rng.range(0.98, 1.08), phase: rng() });
  const fx = 2 * px - hx;
  const bx = fx - rng.range(0.6, 1.4), by = cur.y + rng.range(-1.2, 0.6 + 0.6 * d);
  const B = sysPier(bx, by, rng.range(3.6, 5.0), 'stone');
  return { systems: [swing, B], end: { x: bx + B.params.len, y: by }, pierB: B };
}

function genTrolley(rng, cur, d) {
  const ax = cur.x - 1.2, ay = cur.y + rng.range(2.95, 3.15);
  const G = rng.range(10, 13 + 4 * d);
  const bx = cur.x + G, by = ay - rng.range(0.8, 2.2);
  const speed = rng.range(3.4, 4.4);
  const C = Math.hypot(bx - ax, by - ay);
  const ret = rng.range(2.5, 4);
  const n = Math.max(2, Math.round((C + ret) / rng.range(6.5, 8.5)));
  const tro = sysTrolley({ ax, ay, bx, by, speed, n, returnLen: ret, phase: rng() });
  const Bx = bx - rng.range(3.0, 4.2), By = by - 0.55 - PHYS.HANG - rng.range(0.7, 1.4);
  const B = sysPier(Bx, By, rng.range(4.8, 6.0), 'stone');
  return { systems: [tro, B], end: { x: Bx + B.params.len, y: By }, pierB: B };
}

function genStrider(rng, cur, d, goal) {
  const len = goal ? 4.2 : 3.0;
  const deckY = cur.y + (goal ? rng.range(0.6, 1.4) : rng.range(-0.6, -0.1));
  const xa = cur.x + rng.range(0.6, 1.0) + len / 2 + (goal ? 0.4 : 0);
  const G = goal ? rng.range(5, 8) : rng.range(6, 9 + 2 * d);
  const xb = xa + G;
  const moveT = G / rng.range(1.5, 2.1 + 0.6 * d);
  const dwell = rng.range(2.6, 3.6) * (1 - 0.25 * d);
  const st = sysStrider({ xa, xb, y: deckY, len, period: 2 * moveT + dwell, moveT, pattern: !goal && d > 0.4 && rng.chance(0.4) ? [1, 1.4] : null, phase: rng(), stride: goal ? 2.6 : 1.6, goal, scale: goal ? 1.6 : 1, split: 0.5 });
  if (goal) return { systems: [st], end: { x: xb + len, y: deckY }, pierB: null };
  const bx = xb + len / 2 + rng.range(0.6, 0.95);
  const by = deckY + rng.range(-0.3, 0.6);
  const B = sysPier(bx, by, rng.range(3.4, 4.8), 'stone');
  return { systems: [st, B], end: { x: bx + B.params.len, y: by }, pierB: B };
}

// Two swings in a row, no rest between: catch, let go, catch again.
function genSwing2(rng, cur, d) {
  const a = genSwing(rng, cur, d);
  a.systems.pop();
  const s1 = a.systems[0].params;
  // Twin cranes of the same length swing in counter-phase, like the two
  // pendulums of one clock: let go of the first as the second comes to you.
  const fx1 = s1.px + s1.L * Math.sin(s1.amp);
  const hx = fx1 + rng.range(0.5, 1.1);
  const L = s1.L;
  const hy = s1.py - L * Math.cos(s1.amp) + rng.range(-0.4, 0.2);
  const px = hx + rng.range(2.4, 3.2);
  const amp = Math.asin(clamp((px - hx) / L, 0.2, 0.85));
  const flight = 0.32;
  const sw2 = sysSwing({ px, py: hy + L * Math.cos(amp), L, amp, period: s1.period, phase: fract(s1.phase + 0.5 - flight / s1.period) });
  const fx = 2 * px - hx;
  const bx = fx - rng.range(0.8, 1.4), by = cur.y + rng.range(-1.0, 0.8);
  const B = sysPier(bx, by, rng.range(3.6, 5.0), 'stone');
  return { systems: [a.systems[0], sw2, B], end: { x: bx + B.params.len, y: by }, pierB: B };
}

// A wheel whose top hands you to a trolley line.
function genWheelLine(rng, cur, d) {
  const w = genWheel(rng, cur, d);
  w.systems.pop();
  const p = w.systems[0].params;
  const topY = p.cy + p.R - 1.05;
  const ax = p.cx - 0.6, ay = topY + rng.range(2.4, 2.9);
  const G = rng.range(10, 13);
  const bx = ax + G, by = ay - rng.range(0.8, 2.0);
  const speed = rng.range(3.4, 4.2);
  const C = Math.hypot(bx - ax, by - ay), ret = rng.range(2.5, 3.5);
  const tro = sysTrolley({ ax, ay, bx, by, speed, n: Math.max(2, Math.round((C + ret) / rng.range(6, 8))), returnLen: ret, phase: rng() });
  const Bx = bx - rng.range(3.0, 4.0), By = by - 0.55 - PHYS.HANG - rng.range(0.8, 1.4);
  const B = sysPier(Bx, By, rng.range(4.8, 6), 'stone');
  return { systems: [w.systems[0], tro, B], end: { x: Bx + B.params.len, y: By }, pierB: B };
}

// Ride a lift up, catch a swing from the moving cage.
function genLiftSwing(rng, cur, d) {
  const len = 2.0;
  const H = rng.range(3.5, 5.0);
  const x1 = cur.x + rng.range(0.7, 1.0);
  const y0 = cur.y - rng.range(0.1, 0.3);
  const moveT = H / rng.range(1.8, 2.3);
  const lift = sysLift({ cages: [{ x: x1, yb: y0, h: H }], len, period: 2 * moveT + rng.range(2.2, 3.0), moveT, pattern: null, phase: rng(), split: 0.5 });
  const top = y0 + H;
  const L = rng.range(4.6, 5.6);
  const hx = x1 + len + rng.range(0.6, 1.2), hy = top + rng.range(2.2, 2.6);
  const px = hx + rng.range(2.8, 3.6);
  const amp = Math.asin(clamp((px - hx) / L, 0.2, 0.85));
  const sw = sysSwing({ px, py: hy + L * Math.cos(amp), L, amp, period: TAU * Math.sqrt(L / 9.8) * rng.range(0.98, 1.08), phase: rng() });
  const fx = 2 * px - hx;
  const bx = fx - rng.range(0.8, 1.4), by = top + rng.range(-1.6, 0.4);
  const B = sysPier(bx, by, rng.range(3.6, 5), 'stone');
  return { systems: [lift, sw, B], end: { x: bx + B.params.len, y: by }, pierB: B };
}

const GENS = { skiff: genSkiff, lift: genLift, bellows: genBellows, wheel: genWheel, swing: genSwing, trolley: genTrolley, strider: genStrider, swing2: genSwing2, wheelLine: genWheelLine, liftSwing: genLiftSwing };

// Validate one module in isolation: from pier A's lip to pier B, fairly, and
// not by simply leaping from A to B.
function validateModule(pierA, mod, opts) {
  const sys = [pierA, ...mod.systems];
  const W = makeWorld(sys, null, mod.water ? [mod.water] : null);
  const A = pierA.surfaces[0];
  const goalSf = mod.pierB ? mod.pierB.surfaces[0] : mod.systems[0].surfaces[0];
  const sA = Math.max(0, A.len - PHYS.LIP);
  // Direct leap must not work (the moving thing must matter).
  if (mod.pierB) {
    const W2 = makeWorld([pierA, mod.pierB]);
    const r = expandSurface(W2, A, sA, 0, { waitMax: 0.2 });
    if (r.some(x => x.to === goalSf)) return null;
  }
  const collect = opts.letters ? [] : null;
  const sol = botSolve(W, A, sA, opts.t0 || 0, sf => sf === goalSf, { minWindow: opts.minWindow, maxExpand: 40, trace: !!collect, collect });
  if (!sol.ok) return null;
  const path = [];
  for (let n = sol.node; n; n = n.prev) path.unshift(n.node);
  return { time: sol.t - (opts.t0 || 0), letters: collect ? letterCandidates(collect, goalSf) : null, path };
}

// Find a daring point: the peak of an arc that only a well-timed leap or
// release reaches, which still ends somewhere safe on the way forward.
function letterCandidates(collect, goalSf) {
  const cands = [];
  for (const group of collect) {
    const ok = group.res.filter(r => r.to && r.to.len != null && r.trace && r.trace.length > 6);
    if (ok.length < 4) continue;
    const apexes = ok.map(r => { let m = -1e9, mx = 0; for (let i = 1; i < r.trace.length; i += 2) if (r.trace[i] > m) { m = r.trace[i]; mx = r.trace[i - 1]; } return { y: m, x: mx, r }; });
    const lo = Math.min(...apexes.map(a => a.y));
    for (const a of apexes) {
      if (a.y < lo + 1.2) continue;
      const near = apexes.filter(b => Math.hypot(b.x - a.x, b.y - a.y) < 0.6);
      const win = new Set(near.map(b => b.r.snap)).size * BOT.SNAP;
      if (win < 0.15) continue;
      cands.push({ x: a.x, y: a.y, score: (a.y - lo) - win * 0.5 + (a.r.to === goalSf ? 0.5 : 0) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, 3);
}

function pickKinds(rng, spec, n) {
  const reg = REGIONS[spec.region];
  const kinds = [];
  const fresh = reg.fresh.slice();
  for (let i = 0; i < n; i++) {
    let k;
    // New things appear early in a region's first route, after one familiar beat.
    if (spec.index >= 0 && spec.index % 3 === 0 && i >= 1 && fresh.length && (i <= fresh.length + 1)) k = fresh.shift();
    else k = rng.pick(reg.kinds);
    if (kinds.length && kinds[kinds.length - 1] === k && rng.chance(0.7)) k = rng.pick(reg.kinds);
    if (spec.index === 0 && i === 0) k = 'skiff';
    kinds.push(k);
  }
  return kinds;
}

// Build a whole route (deterministic for a spec).
function* buildRouteSteps(spec, opts) {
  _sysId = 0;
  const rng = makeRng(spec.seed);
  const n = spec.modules;
  const kinds = pickKinds(rng, spec, n);
  const startLen = 7;
  const start = sysPier(-startLen, 0, startLen, 'stone');
  start.module = -1;
  const systems = [start], waters = [], modules = [];
  let cur = { x: 0, y: 0 }, pierA = start;
  let brisk = 0;
  const letterPool = [];
  const minWindow = 0.26 - 0.1 * spec.d;
  for (let i = 0; i < n; i++) {
    const d = clamp(spec.d * 0.6 + 0.4 * spec.d * (i / Math.max(1, n - 1)) + (spec.index === 0 ? 0 : 0.05), 0, 1);
    let mod = null, val = null, used = -1;
    const plan = opts && opts.plan && opts.plan.m[i];
    const make = attempt => {
      const r2 = makeRng(spec.seed * 31 + i * 977 + attempt * 13);
      const kind = attempt < 22 ? kinds[i] : 'skiff';
      const m = GENS[kind](r2, cur, attempt < 14 ? d : d * 0.5);
      m.kind = kind;
      return m;
    };
    if (plan) {
      // Precomputed by dev/bake.js: which attempt validated, its time and letter.
      if (plan[0] >= 0) { mod = make(plan[0]); used = plan[0]; val = { time: plan[1], letters: plan[2] ? [{ x: plan[2][0], y: plan[2][1], score: plan[2][2] }] : [] }; }
    } else {
      for (let attempt = 0; attempt < 30 && !val; attempt++) {
        mod = make(attempt);
        val = validateModule(pierA, mod, { minWindow, letters: !(opts && opts.noLetters) });
        if (val) used = attempt;
        yield i;
      }
    }
    if (!val) { mod = genStones(makeRng(spec.seed + i), cur); mod.kind = 'stones'; val = { time: 3, letters: [] }; }
    mod.attempt = used;
    for (const s of mod.systems) { s.module = i; systems.push(s); }
    if (mod.water) waters.push(mod.water);
    brisk += val.time;
    if (val.letters && val.letters.length) letterPool.push({ module: i, c: val.letters[0] });
    modules.push({ kind: mod.kind, x0: cur.x, x1: mod.end.x, y: cur.y, pierB: mod.pierB, time: val.time, attempt: used, letter: val.letters && val.letters[0] });
    cur = { x: mod.end.x, y: mod.end.y };
    pierA = mod.pierB;
  }
  // The walking house at the end.
  const fin = genStrider(makeRng(spec.seed ^ 0x5bd1e995), cur, 0.3, true);
  for (const s of fin.systems) { s.module = n; systems.push(s); }
  modules.push({ kind: 'walker', x0: cur.x, x1: fin.end.x, y: cur.y });
  brisk += 4;
  // Up to three lost letters, spread along the route.
  const letters = [];
  letterPool.sort((a, b) => b.c.score - a.c.score);
  for (const L of letterPool) {
    if (letters.length >= 3) break;
    if (letters.some(o => Math.abs(o.module - L.module) < 2)) continue;
    letters.push({ id: letters.length, x: L.c.x, y: L.c.y + 0.35, module: L.module });
  }
  letters.sort((a, b) => a.x - b.x);
  letters.forEach((l, i) => { l.id = i; });
  const W = makeWorld(systems, letters, waters);
  W.spec = spec; W.modules = modules; W.brisk = Math.round(brisk * 1.12 + 3); W.start = start.surfaces[0];
  W.goal = fin.systems[0].surfaces[0]; W.finalX = fin.end.x;
  return W;
}

function buildRoute(spec, opts) {
  const it = buildRouteSteps(spec, opts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

// The compact plan a validated route can be rebuilt from without validation.
function routePlan(W) {
  return { m: W.modules.filter(m => m.kind !== 'walker').map(m => [m.attempt, +m.time.toFixed(2), m.letter ? [+m.letter.x.toFixed(2), +m.letter.y.toFixed(2), +m.letter.score.toFixed(2)] : 0]) };
}

// ---- 04_plans.js ----
// Generated by dev/bake.js from the route generator. Do not edit by hand.
const ROUTE_PLANS = [{"m":[[0,8.18,0],[17,4.67,[18.63,9.02,5.92]],[0,5.18,[28.94,7.63,1.52]],[22,6.29,0]]},{"m":[[0,4.63,0],[0,8.28,0],[22,1.88,0],[0,1.32,[44.15,5.63,1.84]],[0,4.5,0]]},{"m":[[1,5.33,[6.83,8.63,4.84]],[0,2.84,[16.28,8.58,2.05]],[1,4.81,[25.39,15.45,4.17]],[1,4.53,[37.33,18.55,4.85]],[1,4.79,[47.53,18.84,1.17]],[0,3.41,0]]},{"m":[[0,5.93,[4.59,6.57,2]],[0,9.28,[11.97,15.53,9.66]],[0,2.31,0],[0,2.19,[36.81,20.41,4.4]],[0,1.61,0],[0,9.11,[59.12,23.88,1.25]],[0,4.98,0]]},{"m":[[0,9.09,[4.55,6.12,1.71]],[0,6.88,0],[0,2.23,0],[0,6.25,[35.49,13.68,9.53]],[1,12.83,[50.38,20.51,2.02]],[0,2.75,0],[0,7.72,[67.89,28.69,8.31]]]},{"m":[[0,6.34,[3.98,11.77,10.56]],[0,7.68,0],[0,8.5,[26.76,20.15,10.52]],[0,3.79,0],[0,4.02,[49.73,26.38,4.84]],[0,6.07,0],[1,3.37,[74.52,29.29,4.85]],[0,8.06,[84.15,29.28,1.57]]]},{"m":[[0,7.98,[3.73,11.86,8.93]],[0,3.77,0],[0,5.92,0],[0,12.61,0],[0,8.72,[65.32,17.98,8.7]],[0,4.35,0],[0,9.34,[94.16,21.11,2.2]],[0,2.24,0],[0,2.38,0]]},{"m":[[0,5.48,0],[0,4.58,[16.21,9.15,2.21]],[0,4.38,[25.58,16.28,4.18]],[0,2.97,0],[0,2.9,0],[0,7.81,[60.23,21.02,10.21]],[0,3.87,0],[0,5.43,0],[0,2.22,0],[0,3.57,0]]},{"m":[[0,6.32,0],[0,7.1,[20.8,11.24,9.85]],[0,7.45,[35.5,17.67,2.06]],[0,4.88,[41.59,25.01,8.67]],[0,3.48,0],[0,2.12,[67.18,29.51,4.17]],[0,8.07,[76.25,31.59,1.55]],[0,4.21,[85.32,39.01,2.69]],[0,4.85,0],[0,4.28,0],[0,5.35,0]]},{"m":[[0,11.87,0],[3,8.69,0],[0,7.43,[39.14,9.66,8.28]],[0,1.37,0],[0,9.42,[60.02,18.21,8.71]],[0,11.09,0],[0,4.25,0],[0,5.57,0],[0,4.9,0],[0,3.64,0],[0,3.37,0],[0,5.3,0]]},{"m":[[0,2.26,[6.39,9.21,2.15]],[0,6.28,0],[0,4.71,0],[0,6.52,[52.35,13.54,1.97]],[0,5.4,0],[0,9.42,[71.67,21.05,7.75]],[0,5.06,0],[0,10.39,[95.22,31.14,8.72]],[0,6.15,0],[0,8.95,0],[1,6.63,[146.62,33.03,1.99]],[0,2.16,0],[0,3.08,0]]},{"m":[[0,1.57,0],[0,8.96,[18.44,12.6,10.99]],[0,11.16,[34.66,18.4,1.86]],[0,10.92,[41.17,26.66,7.75]],[0,9.45,0],[0,5.68,0],[1,3.97,0],[0,2.24,0],[0,9.63,[107.91,36.14,8.31]],[0,3.69,0],[0,4.17,0],[0,2.28,0],[0,6.56,[159.07,41.97,9.39]]]}];

// ---- 05_paint.js ----
// ---------------------------------------------------------------------------
// The painter. Every image in the game is painted here at start-up with
// Canvas2D brushes: wobbly hand-cut shapes, soft directional light from the
// upper left, cool shadows, brush streaks and paper grain. No image assets.
// ---------------------------------------------------------------------------

const PALETTES = [
  { // The Ferry Steps: morning, pale cyan and limestone
    skyTop: '#9fcad3', skyMid: '#cfe3df', haze: '#eee4cf', sun: '#fff3d6',
    far: '#a9c3c6', mid: '#9db9b3', near: '#c8b79a',
    stone: '#d8c7a3', stoneLight: '#efe2c4', stoneDark: '#9a8a73',
    wood: '#8b6a4f', woodLight: '#b48d66', woodDark: '#5a4434',
    roof: ['#5f8f8a', '#c77d64', '#7c9a6a', '#4e7477'], shutter: ['#d48a6a', '#5f8f8a', '#d9b45a'],
    leaf: '#86a873', leafDark: '#5d7f5c', moss: '#93ad78',
    water: '#4f8d88', waterLight: '#9cc7bf', cloth: '#e9dcc0',
    coral: '#d9785f', yellow: '#e4b84e', ink: '#24423f', metal: '#6f7f7c'
  },
  { // The Wheel Orchard: noon, muted yellow and green
    skyTop: '#a8cdc4', skyMid: '#dbe6cf', haze: '#f2e6c2', sun: '#fff1c4',
    far: '#b3c4ad', mid: '#a7bb92', near: '#d1bd93',
    stone: '#dccaa0', stoneLight: '#f2e4bd', stoneDark: '#a08c6c',
    wood: '#8f6b48', woodLight: '#bb9264', woodDark: '#5d4532',
    roof: ['#b9894f', '#6f9a72', '#c4735a', '#53786c'], shutter: ['#6f9a72', '#c4735a', '#e0b85a'],
    leaf: '#8fb06a', leafDark: '#5f8452', moss: '#9db56f',
    water: '#5a9488', waterLight: '#a6cdb8', cloth: '#efe0b8',
    coral: '#d2765c', yellow: '#e6bb47', ink: '#2c4434', metal: '#7a806d'
  },
  { // The High Lines: afternoon, powder blue and dusty coral
    skyTop: '#93b3d6', skyMid: '#c9d6e6', haze: '#efd8cb', sun: '#ffe9d6',
    far: '#a7b6cf', mid: '#a8b1c4', near: '#cdb6a6',
    stone: '#d9c3ad', stoneLight: '#f0e0cf', stoneDark: '#9b8778',
    wood: '#86664f', woodLight: '#ad8a6c', woodDark: '#574238',
    roof: ['#4d6f8a', '#c9705e', '#6c8aa3', '#8e6a8a'], shutter: ['#c9705e', '#4d6f8a', '#e0b45c'],
    leaf: '#7fa088', leafDark: '#557563', moss: '#8ea98a',
    water: '#5a7f98', waterLight: '#a9c2d4', cloth: '#efe1d4',
    coral: '#dc6f5a', yellow: '#e8b64f', ink: '#253a4d', metal: '#6c7686'
  },
  { // The Long Evening: dusk, coral and deep teal, lamps lit
    skyTop: '#6f8fb0', skyMid: '#d9a7a0', haze: '#f0c6a4', sun: '#ffd9a8',
    far: '#9a93ab', mid: '#8d8ea4', near: '#b9a08f',
    stone: '#cfb39a', stoneLight: '#ead2b6', stoneDark: '#8a7368',
    wood: '#7c5b48', woodLight: '#a17b62', woodDark: '#4d3934',
    roof: ['#3f6672', '#b8604f', '#5d6f8c', '#7d5a73'], shutter: ['#e2a052', '#3f6672', '#b8604f'],
    leaf: '#6e8b78', leafDark: '#4b6658', moss: '#7d977c',
    water: '#46677c', waterLight: '#90a9bd', cloth: '#ecd6c0',
    coral: '#e0705a', yellow: '#f0bf55', ink: '#1f3240', metal: '#5e6474'
  }
];

// ---- colour helpers --------------------------------------------------------
function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r, g, b) { return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function mixC(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
function shadeC(c, amt) { return amt >= 0 ? mixC(c, '#fff8ea', amt) : mixC(c, '#1d2b3a', -amt); }
function rgba(c, a) { const x = hexRgb(c); return `rgba(${x[0]},${x[1]},${x[2]},${a})`; }
function jitterC(c, rng, amt) { const x = hexRgb(c); const k = (rng() - 0.5) * amt * 255; return rgbHex(x[0] + k + (rng() - 0.5) * 10, x[1] + k, x[2] + k + (rng() - 0.5) * 10); }

// ---- canvas helpers --------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

let _grain = null;
function grainPattern(g) {
  if (!_grain) {
    _grain = cv(128, 128);
    const gg = _grain.getContext('2d');
    const id = gg.createImageData(128, 128);
    const r = makeRng(77);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (r() - 0.5) * 120;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    gg.putImageData(id, 0, 0);
  }
  return g.createPattern(_grain, 'repeat');
}

// A hand-cut outline: subdivide and jitter each edge a little.
function wobPath(g, pts, rng, j, closed) {
  g.beginPath();
  const n = pts.length;
  const segs = closed === false ? n - 1 : n;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.floor(len / 14));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const jj = k === steps ? 0 : j;
      g.lineTo(lerp(a[0], b[0], t) + (rng() - 0.5) * jj, lerp(a[1], b[1], t) + (rng() - 0.5) * jj);
    }
  }
  if (closed !== false) g.closePath();
}

// Fill the current path with a painted surface: base, light, streaks, grain, edge.
function paintFill(g, base, rng, o) {
  o = o || {};
  const b = g.canvas;
  g.save();
  g.fillStyle = base; g.fill();
  g.clip();
  const x0 = o.x0 || 0, y0 = o.y0 || 0, x1 = o.x1 || b.width, y1 = o.y1 || b.height;
  // light from the upper left, shadow to the lower right
  const lg = g.createLinearGradient(x0, y0, x0 + (x1 - x0) * 0.7, y1);
  lg.addColorStop(0, rgba(shadeC(base, 0.5), o.light == null ? 0.35 : o.light));
  lg.addColorStop(0.55, rgba(base, 0));
  lg.addColorStop(1, rgba(shadeC(base, -0.5), o.dark == null ? 0.35 : o.dark));
  g.fillStyle = lg; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  // brush streaks
  const n = o.streaks == null ? 26 : o.streaks;
  for (let i = 0; i < n; i++) {
    const sx = lerp(x0, x1, rng()), sy = lerp(y0, y1, rng());
    const L = (o.streakLen || 26) * (0.5 + rng());
    const ang = (o.streakAng == null ? -0.25 : o.streakAng) + (rng() - 0.5) * 0.5;
    g.strokeStyle = rgba(shadeC(base, (rng() - 0.45) * 0.5), 0.08 + rng() * 0.1);
    g.lineWidth = (o.streakW || 4) * (0.5 + rng());
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(ang) * L, sy + Math.sin(ang) * L); g.stroke();
  }
  // grain
  g.globalAlpha = o.grain == null ? 0.16 : o.grain;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = grainPattern(g); g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.restore();
  if (o.edge !== false) {
    g.save();
    g.strokeStyle = rgba(shadeC(base, -0.55), o.edge || 0.38);
    g.lineWidth = o.edgeW || 1.6;
    g.stroke();
    g.restore();
  }
}

function polyPaint(g, pts, base, rng, o) { wobPath(g, pts, rng, (o && o.j) || 2.2, true); paintFill(g, base, rng, o); }
function rectPaint(g, x, y, w, h, base, rng, o) {
  polyPaint(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], base, rng, Object.assign({ x0: x, y0: y, x1: x + w, y1: y + h }, o));
}
function circlePath(g, cx, cy, r, rng, j) {
  const pts = [];
  const n = Math.max(10, Math.floor(r * 0.7));
  for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  wobPath(g, pts, rng, j == null ? 1.5 : j, true);
}
function blobPaint(g, cx, cy, r, base, rng, o) { circlePath(g, cx, cy, r, rng, (o && o.j) || 2); paintFill(g, base, rng, Object.assign({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, streakLen: r * 0.5 }, o)); }

// Soft cast shadow or glow.
function softEllipse(g, cx, cy, rx, ry, color, a) {
  g.save(); g.translate(cx, cy); g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  rg.addColorStop(0, rgba(color, a)); rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
}

function windowPaint(g, x, y, w, h, P, rng, opts) {
  const lit = opts && opts.lit;
  rectPaint(g, x - 2, y - 2, w + 4, h + 4, shadeC(P.stone, -0.25), rng, { streaks: 0, edge: 0.2 });
  g.fillStyle = lit ? '#f6cf7a' : mixC(P.ink, P.skyTop, 0.35);
  g.fillRect(x, y, w, h);
  if (!lit) { g.fillStyle = rgba(P.skyMid, 0.35); g.fillRect(x, y, w * 0.4, h); }
  if (h > w * 1.2) {
    // arched top
    g.fillStyle = shadeC(P.stone, -0.25); g.beginPath(); g.arc(x + w / 2, y, w / 2 + 2, Math.PI, 0); g.fill();
    g.fillStyle = lit ? '#f6cf7a' : mixC(P.ink, P.skyTop, 0.35); g.beginPath(); g.arc(x + w / 2, y, w / 2, Math.PI, 0); g.fill();
  }
  if (opts && opts.shutters) {
    const sc = rng.pick(P.shutter);
    rectPaint(g, x - w * 0.55, y, w * 0.5, h, sc, rng, { streaks: 3, edge: 0.3 });
    rectPaint(g, x + w * 1.05, y, w * 0.5, h, sc, rng, { streaks: 3, edge: 0.3 });
  }
  if (opts && opts.plant) {
    rectPaint(g, x - 3, y + h, w + 6, 6, P.coral, rng, { streaks: 0 });
    for (let i = 0; i < 5; i++) blobPaint(g, x + rng() * w, y + h - 2, 4 + rng() * 4, rng.chance(0.3) ? P.coral : P.leaf, rng, { edge: false, streaks: 2 });
  }
  if (opts && opts.figure) tinyFigure(g, x + w / 2, y + h, h * 0.55, P, rng, { coat: rng.pick(P.shutter) });
}

// A tiny inhabitant (bust or full figure), the little stories in the world.
function tinyFigure(g, x, y, h, P, rng, o) {
  o = o || {};
  const coat = o.coat || rng.pick(P.roof);
  const skin = rng.pick(['#e8c3a4', '#c99878', '#9c6e52', '#efd2b8']);
  g.save();
  g.translate(x, y);
  if (o.flip) g.scale(-1, 1);
  const bw = h * 0.42;
  g.beginPath(); g.moveTo(-bw / 2, 0); g.quadraticCurveTo(-bw / 2, -h * 0.62, 0, -h * 0.64); g.quadraticCurveTo(bw / 2, -h * 0.62, bw / 2, 0); g.closePath();
  paintFill(g, coat, rng, { streaks: 2, edgeW: 1 });
  circlePath(g, 0, -h * 0.76, h * 0.15, rng, 0.6); paintFill(g, skin, rng, { streaks: 0, edgeW: 1 });
  if (o.hat !== false && rng.chance(0.6)) { g.fillStyle = rng.pick([P.ink, P.yellow, P.coral, P.cloth]); g.beginPath(); g.ellipse(0, -h * 0.88, h * 0.2, h * 0.06, 0, 0, TAU); g.fill(); g.fillRect(-h * 0.1, -h * 1.0, h * 0.2, h * 0.12); }
  g.restore();
}

// ---- world pieces ------------------------------------------------------------

function paintCloud(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  const blobs = [];
  for (let i = 0; i < 9; i++) blobs.push([90 + rng() * 330, 150 - rng() * 70, 40 + rng() * 55]);
  const col = mixC(P.haze, '#ffffff', 0.55);
  for (const b of blobs) softEllipse(g, b[0], b[1] + 10, b[2] * 1.4, b[2] * 0.8, shadeC(P.skyTop, -0.05), 0.35);
  for (const b of blobs) {
    const rg = g.createRadialGradient(b[0] - b[2] * 0.3, b[1] - b[2] * 0.4, 2, b[0], b[1], b[2]);
    rg.addColorStop(0, col); rg.addColorStop(0.75, mixC(col, P.skyMid, 0.25)); rg.addColorStop(1, rgba(mixC(col, P.skyMid, 0.4), 0));
    g.fillStyle = rg; g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill();
  }
  // flatten the base
  g.globalCompositeOperation = 'destination-out';
  const fg = g.createLinearGradient(0, 165, 0, 210);
  fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fg; g.fillRect(0, 160, 512, 96);
  return c;
}

// Tall far monuments. Painted in mid values; fog does the distance.
function paintMonument(seed, P, kind) {
  const rng = makeRng(seed);
  const W = 512, H = 1024;
  const c = cv(W, H), g = c.getContext('2d');
  const base = mixC(P.far, P.stone, 0.35);
  const cx = W / 2;
  if (kind === 'spire') {
    const bw = 120 + rng() * 40;
    polyPaint(g, [[cx - bw / 2, H], [cx - bw * 0.36, 300], [cx + bw * 0.36, 300], [cx + bw / 2, H]], base, rng, { streaks: 40, streakAng: -1.4 });
    for (let y = 360; y < H; y += 90 + rng() * 40) {
      const w = bw * (0.75 + (y / H) * 0.3);
      rectPaint(g, cx - w / 2 - 14, y, w + 28, 12, shadeC(base, 0.15), rng, { streaks: 2 });
      for (let k = 0; k < 3; k++) windowPaint(g, cx - w / 3 + k * w / 3 - 6, y + 30, 12, 22, P, rng, {});
    }
    // bulb crown with a strange little machine on top
    blobPaint(g, cx, 270, 78, shadeC(P.roof[0], 0.2), rng, { streaks: 12 });
    rectPaint(g, cx - 10, 120, 20, 90, shadeC(base, -0.1), rng, {});
    blobPaint(g, cx, 112, 28, shadeC(P.coral, 0.2), rng, {});
    g.strokeStyle = rgba(P.ink, 0.5); g.lineWidth = 3; g.beginPath(); g.moveTo(cx, 84); g.lineTo(cx, 30); g.stroke();
    g.fillStyle = P.coral; g.beginPath(); g.moveTo(cx, 30); g.lineTo(cx + 34, 40); g.lineTo(cx, 52); g.fill();
  } else if (kind === 'discs') {
    const coreW = 70 + rng() * 30;
    rectPaint(g, cx - coreW / 2, 120, coreW, H - 120, base, rng, { streaks: 30, streakAng: -1.4 });
    let y = 160;
    while (y < H - 60) {
      const dw = 180 + rng() * 140;
      const dh = 20 + rng() * 16;
      g.save(); g.beginPath(); g.ellipse(cx, y, dw / 2, dh, 0, 0, TAU); paintFill(g, shadeC(base, 0.12), rng, { x0: cx - dw / 2, x1: cx + dw / 2, y0: y - dh, y1: y + dh }); g.restore();
      if (rng.chance(0.5)) for (let k = 0; k < 4; k++) blobPaint(g, cx - dw / 2 + rng() * dw, y - dh * 0.6, 10 + rng() * 10, P.leaf, rng, { edge: false, streaks: 3 });
      if (rng.chance(0.5)) { rectPaint(g, cx + dw / 2 - 30, y - 60, 26, 50, shadeC(base, -0.05), rng, { streaks: 3 }); }
      y += 90 + rng() * 80;
    }
    blobPaint(g, cx, 120, 46, shadeC(P.roof[1], 0.2), rng, {});
  } else if (kind === 'mesa') {
    const pts = [[20, H], [40, 560], [90, 480], [180, 455], [300, 470], [420, 500], [470, 560], [490, H]];
    polyPaint(g, pts, mixC(base, P.leafDark, 0.15), rng, { j: 8, streaks: 50, streakAng: 1.3 });
    for (let i = 0; i < 9; i++) {
      const hx = 80 + rng() * 340, hw = 30 + rng() * 40, hh = 40 + rng() * 90;
      rectPaint(g, hx, 470 - hh, hw, hh + 20, shadeC(base, 0.1 + rng() * 0.1), rng, { streaks: 4 });
      polyPaint(g, [[hx - 6, 470 - hh], [hx + hw / 2, 470 - hh - 26], [hx + hw + 6, 470 - hh]], rng.pick(P.roof), rng, {});
    }
    for (let i = 0; i < 12; i++) blobPaint(g, 50 + rng() * 420, 480 + rng() * 40, 10 + rng() * 18, P.leaf, rng, { edge: false });
    // a waterfall spilling over the edge
    g.fillStyle = rgba(P.waterLight, 0.8); g.fillRect(380, 500, 14, H - 500);
    g.fillStyle = rgba('#ffffff', 0.5); g.fillRect(383, 500, 4, H - 500);
  } else if (kind === 'stair') {
    // a monumental stair-house climbing to nowhere in particular
    let x = 40, y = H - 20;
    for (let i = 0; i < 9; i++) {
      const w = 80 + rng() * 40, h = 60 + rng() * 30;
      rectPaint(g, x, y - h, w, h + (H - y), shadeC(base, (i % 2) * 0.08), rng, { streaks: 8 });
      if (rng.chance(0.6)) windowPaint(g, x + w / 2 - 8, y - h + 14, 16, 26, P, rng, {});
      x += w * 0.45; y -= h * 0.95;
      if (x > W - 140) x = 60;
    }
    blobPaint(g, x + 30, y - 40, 40, P.leaf, rng, {});
  }
  return c;
}

function paintFarWheel(seed, P) {
  const rng = makeRng(seed);
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  const col = shadeC(mixC(P.far, P.wood, 0.3), -0.1);
  g.strokeStyle = col; g.lineCap = 'round';
  g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, TAU); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.arc(S / 2, S / 2, S * 0.38, 0, TAU); g.stroke();
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.44, S / 2 + Math.sin(a) * S * 0.44); g.stroke(); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; rectPaint(g, S / 2 + Math.cos(a) * S * 0.44 - 12, S / 2 + Math.sin(a) * S * 0.44 - 10, 24, 20, shadeC(col, 0.2), rng, { streaks: 0 }); }
  blobPaint(g, S / 2, S / 2, 30, shadeC(col, 0.1), rng, {});
  return c;
}

// Horizontal tileable strip of hills, terraces, towns.
function paintRidge(seed, P, kind) {
  const rng = makeRng(seed);
  const W = 2048, H = 512, c = cv(W, H), g = c.getContext('2d');
  const base = kind === 'far' ? mixC(P.mid, P.far, 0.5) : P.mid;
  const pts = [];
  const N = 32;
  const hs = [];
  for (let i = 0; i <= N; i++) hs.push(140 + Math.sin(i / N * TAU * 2) * 40 + Math.sin(i / N * TAU * 5 + 1) * 25 + (rng() - 0.5) * 30);
  hs[N] = hs[0];
  for (let i = 0; i <= N; i++) pts.push([i / N * W, hs[i]]);
  g.beginPath(); g.moveTo(0, H);
  for (const p of pts) g.lineTo(p[0], p[1]);
  g.lineTo(W, H); g.closePath();
  paintFill(g, base, rng, { streaks: 120, streakLen: 60, streakAng: 0.1, edge: false });
  const hAt = x => { const f = (x / W) * N; const i = Math.floor(f) % N; return lerp(hs[i], hs[i + 1], f - Math.floor(f)); };
  // terraces
  for (let k = 0; k < 5; k++) {
    g.strokeStyle = rgba(shadeC(base, 0.25), 0.4); g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) { const y = hAt(x) + 40 + k * 55 + Math.sin(x * 0.01 + k) * 6; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const draw = (fn) => { fn(0); };
  // towns and trees (wrapping at the seam)
  for (let i = 0; i < 70; i++) {
    const x = rng() * W, y = hAt(x);
    const type = rng();
    for (const off of [0, -W, W]) {
      const X = x + off;
      if (X < -100 || X > W + 100) continue;
      const r2 = makeRng(seed * 7 + i);
      if (type < 0.45) {
        blobPaint(g, X, y + 4, 10 + r2() * 14, r2.chance(0.5) ? P.leaf : P.leafDark, r2, { edge: false, streaks: 3 });
      } else if (type < 0.85) {
        const w = 18 + r2() * 26, h = 20 + r2() * 40;
        rectPaint(g, X - w / 2, y - h + 8, w, h + 30, shadeC(mixC(base, P.stone, 0.6), r2() * 0.2), r2, { streaks: 3, edgeW: 1 });
        polyPaint(g, [[X - w / 2 - 4, y - h + 8], [X, y - h - 12], [X + w / 2 + 4, y - h + 8]], mixC(r2.pick(P.roof), base, 0.3), r2, { streaks: 1 });
        if (r2.chance(0.6)) { g.fillStyle = rgba(P.ink, 0.45); g.fillRect(X - 3, y - h + 20, 5, 7); }
      } else {
        const h = 60 + r2() * 70;
        rectPaint(g, X - 7, y - h, 14, h + 20, shadeC(mixC(base, P.stone, 0.5), 0.1), r2, { streaks: 3 });
        blobPaint(g, X, y - h, 12, mixC(r2.pick(P.roof), base, 0.2), r2, {});
      }
    }
  }
  void draw;
  return c;
}

// Mist band (soft, horizontally tileable).
function paintMist(seed, P) {
  const rng = makeRng(seed);
  const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d');
  const col = mixC(P.haze, '#ffffff', 0.4);
  for (let i = 0; i < 40; i++) {
    const x = rng() * W, y = 90 + rng() * 120, r = 50 + rng() * 90;
    for (const off of [0, -W, W]) softEllipse(g, x + off, y, r * 1.6, r * 0.6, col, 0.35);
  }
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.45, rgba(col, 0.55)); lg.addColorStop(1, rgba(col, 0.95));
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  return c;
}

// Near-background building with windows, shutters, plants and little people.
function paintHouse(seed, P, opts) {
  const rng = makeRng(seed);
  const W = 256, H = 640, c = cv(W, H), g = c.getContext('2d');
  const wall = jitterC(mixC(P.stone, P.near, 0.4), rng, 0.12);
  const w = 120 + rng() * 80, x0 = (W - w) / 2, top = 120 + rng() * 120;
  rectPaint(g, x0, top, w, H - top, wall, rng, { streaks: 40, streakAng: -1.35 });
  // floor bands
  for (let y = top + 70; y < H; y += 95 + rng() * 20) rectPaint(g, x0 - 6, y, w + 12, 9, shadeC(wall, 0.18), rng, { streaks: 1, edgeW: 1 });
  // windows
  const cols = w > 160 ? 3 : 2;
  for (let y = top + 22; y < H - 60; y += 95 + rng() * 10) {
    for (let k = 0; k < cols; k++) {
      if (rng.chance(0.2)) continue;
      const wx = x0 + (k + 0.5) * w / cols - 9;
      windowPaint(g, wx, y, 18, 30, P, rng, { shutters: rng.chance(0.4), plant: rng.chance(0.3), figure: rng.chance(0.12), lit: opts && opts.lit && rng.chance(0.35) });
    }
  }
  // roof
  const rk = rng();
  const rc = rng.pick(P.roof);
  if (rk < 0.4) polyPaint(g, [[x0 - 14, top + 4], [x0 + w / 2, top - 70 - rng() * 40], [x0 + w + 14, top + 4]], rc, rng, { streaks: 20, streakAng: 0.8 });
  else if (rk < 0.7) { g.beginPath(); g.ellipse(x0 + w / 2, top + 4, w / 2 + 10, 60 + rng() * 30, 0, Math.PI, 0); paintFill(g, rc, rng, { x0, x1: x0 + w, y0: top - 90, y1: top }); blobPaint(g, x0 + w / 2, top - 70, 10, P.yellow, rng, {}); }
  else {
    rectPaint(g, x0 - 8, top - 10, w + 16, 14, shadeC(wall, 0.15), rng, {});
    // roof garden
    for (let i = 0; i < 8; i++) blobPaint(g, x0 + rng() * w, top - 14 - rng() * 20, 10 + rng() * 14, rng.chance(0.2) ? P.coral : P.leaf, rng, { edge: false });
  }
  // chimney or odd contraption
  if (rng.chance(0.5)) {
    const cx = x0 + w * (0.2 + rng() * 0.6);
    rectPaint(g, cx - 8, top - 80, 16, 70, shadeC(wall, -0.1), rng, {});
    g.strokeStyle = rgba(P.ink, 0.5); g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, top - 80); g.lineTo(cx + 26, top - 110); g.stroke();
    blobPaint(g, cx + 26, top - 112, 7, P.coral, rng, {});
  }
  // a door at street level
  rectPaint(g, x0 + w / 2 - 14, H - 70, 28, 70, rng.pick(P.shutter), rng, {});
  // climbing ivy
  if (rng.chance(0.6)) {
    const vx = rng.chance(0.5) ? x0 + 6 : x0 + w - 6;
    for (let y = H; y > top + rng() * 200; y -= 8) blobPaint(g, vx + (rng() - 0.5) * 18, y, 5 + rng() * 6, rng.chance(0.5) ? P.leaf : P.leafDark, rng, { edge: false, streaks: 0 });
  }
  return c;
}

function paintTree(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 320), g = c.getContext('2d');
  polyPaint(g, [[118, 320], [124, 180], [132, 180], [140, 320]], P.woodDark, rng, {});
  const cols = [P.leafDark, P.leaf, shadeC(P.leaf, 0.2)];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, r = rng() * 60;
    blobPaint(g, 128 + Math.cos(a) * r * 1.2, 140 + Math.sin(a) * r * 0.8 - layer * 10, 30 + rng() * 22 - layer * 6, cols[layer], rng, { edge: layer === 0 ? 0.2 : false, streaks: 4 });
  }
  if (rng.chance(0.5)) for (let i = 0; i < 7; i++) blobPaint(g, 70 + rng() * 116, 90 + rng() * 100, 5, P.coral, rng, { edge: false, streaks: 0 });
  return c;
}

// Tileable stone face for piers.
function paintStoneTile(seed, P, style) {
  const rng = makeRng(seed);
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const base = style === 'wood' ? P.wood : P.stone;
  g.fillStyle = shadeC(base, -0.2); g.fillRect(0, 0, S, S);
  if (style === 'wood') {
    for (let x = 0; x < S; x += 32) rectPaint(g, x + 1, 0, 30, S, jitterC(base, rng, 0.12), rng, { streakAng: 1.57, streaks: 12, edgeW: 1.2 });
  } else {
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const y = r * S / rows, h = S / rows;
      let x = (r % 2) * -40;
      while (x < S) {
        const w = 60 + rng() * 50;
        for (const off of [0, S]) if (x + off < S + 1 && x + w + off > -1) rectPaint(g, x + 2 + off - (off ? S : 0), y + 2, w - 4, h - 4, jitterC(base, rng, 0.1), rng, { streaks: 6, edgeW: 1.2, j: 1.5 });
        x += w;
      }
    }
    for (let i = 0; i < 10; i++) blobPaint(g, rng() * S, rng() * S, 4 + rng() * 7, rgba(P.moss, 0.5), rng, { edge: false, streaks: 0 });
  }
  return c;
}

// A ring you can hold: always the same dusty coral, so you learn to read it.
function paintRing(P) {
  const c = cv(128, 128), g = c.getContext('2d');
  const rng = makeRng(5);
  softEllipse(g, 64, 64, 60, 60, '#fff3d0', 0.35);
  g.lineWidth = 15; g.strokeStyle = shadeC(P.coral, -0.35); g.beginPath(); g.arc(64, 66, 36, 0, TAU); g.stroke();
  g.lineWidth = 12; g.strokeStyle = P.coral; g.beginPath(); g.arc(64, 64, 36, 0, TAU); g.stroke();
  g.lineWidth = 3; g.strokeStyle = shadeC(P.coral, 0.45); g.beginPath(); g.arc(64, 64, 38, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
  void rng;
  return c;
}

function paintLetter(P) {
  const c = cv(128, 128), g = c.getContext('2d');
  const rng = makeRng(9);
  softEllipse(g, 64, 64, 62, 62, '#fff2c0', 0.55);
  g.save(); g.translate(64, 64); g.rotate(-0.12);
  polyPaint(g, [[-34, -22], [34, -22], [34, 22], [-34, 22]], '#f6ecd6', rng, { streaks: 4, edge: 0.45 });
  g.strokeStyle = rgba('#8a7a62', 0.8); g.lineWidth = 2.2; g.beginPath(); g.moveTo(-34, -22); g.lineTo(0, 4); g.lineTo(34, -22); g.stroke();
  blobPaint(g, 0, 4, 7, P.coral, rng, {});
  g.restore();
  return c;
}

function paintSoftDot(color) {
  const c = cv(64, 64), g = c.getContext('2d');
  softEllipse(g, 32, 32, 30, 30, color, 0.9);
  return c;
}

// ---- 06_paint_mech.js ----
// ---------------------------------------------------------------------------
// Painted machines and creatures. The rule of the visual language:
//  - anything you can stand on has a pale, warm lip along its top edge
//  - anything you can hold is a dusty coral ring
// Machines are wood, canvas, rope and painted tin, never a wall of brass gears.
// ---------------------------------------------------------------------------

function lipStroke(g, x0, x1, y, P) {
  g.save();
  g.strokeStyle = shadeC(P.stoneLight, 0.15); g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0 + 3, y + 3); g.lineTo(x1 - 3, y + 3); g.stroke();
  g.strokeStyle = rgba(P.ink, 0.35); g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0 + 2, y + 7.5); g.lineTo(x1 - 2, y + 7.5); g.stroke();
  g.restore();
}

// Skiff: 2.6 m deck. Canvas 512x256, deck line at y=96, deck spans x 46..466.
function paintSkiff(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  // awning poles + striped awning
  g.strokeStyle = P.woodDark; g.lineWidth = 6;
  for (const x of [130, 330]) { g.beginPath(); g.moveTo(x, 96); g.lineTo(x, 20); g.stroke(); }
  polyPaint(g, [[110, 26], [350, 14], [360, 40], [104, 50]], P.cloth, rng, { streaks: 6 });
  for (let i = 0; i < 6; i++) { g.fillStyle = rgba(P.coral, 0.85); g.fillRect(118 + i * 40, 22 - i * 2, 18, 26); }
  // hull
  polyPaint(g, [[30, 96], [482, 96], [452, 168], [392, 196], [110, 196], [56, 160]], P.wood, rng, { streaks: 30, streakAng: 0 });
  for (let y = 120; y < 190; y += 18) { g.strokeStyle = rgba(P.woodDark, 0.4); g.lineWidth = 2; g.beginPath(); g.moveTo(50, y); g.lineTo(470, y); g.stroke(); }
  rectPaint(g, 26, 90, 460, 14, P.woodLight, rng, { streaks: 4 });
  lipStroke(g, 30, 482, 88, P);
  // painted eye on the bow, a lantern, a rope coil
  blobPaint(g, 440, 128, 11, P.cloth, rng, {}); blobPaint(g, 442, 128, 5, P.ink, rng, { edge: false });
  g.strokeStyle = P.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(470, 92); g.lineTo(470, 56); g.stroke();
  blobPaint(g, 470, 54, 8, P.yellow, rng, {});
  return c;
}

// Lift cage: 2.0 m floor. 256x256, floor line y=200, spans x 20..236.
function paintCage(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  const fr = P.woodDark;
  // roof
  polyPaint(g, [[10, 40], [128, 6], [246, 40], [236, 52], [20, 52]], P.roof[seed % P.roof.length], rng, {});
  // lattice sides
  g.strokeStyle = fr; g.lineWidth = 7;
  for (const x of [24, 232]) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, 204); g.stroke(); }
  g.lineWidth = 3; g.strokeStyle = rgba(fr, 0.8);
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(24, 60 + i * 36); g.lineTo(60, 96 + i * 36); g.stroke(); g.beginPath(); g.moveTo(232, 60 + i * 36); g.lineTo(196, 96 + i * 36); g.stroke(); }
  g.beginPath(); g.moveTo(24, 130); g.lineTo(232, 130); g.stroke();
  // floor
  rectPaint(g, 14, 200, 228, 26, P.wood, rng, { streaks: 6 });
  lipStroke(g, 16, 240, 194, P);
  // hanging lamp
  g.strokeStyle = P.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(128, 52); g.lineTo(128, 72); g.stroke();
  blobPaint(g, 128, 78, 7, P.yellow, rng, {});
  return c;
}

// Lift tower lattice, vertically tileable. 128x256.
function paintLattice(seed, P) {
  const rng = makeRng(seed);
  const c = cv(128, 256), g = c.getContext('2d');
  g.strokeStyle = P.woodDark; g.lineCap = 'round';
  g.lineWidth = 9; for (const x of [12, 116]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(12, 0); g.lineTo(116, 128); g.lineTo(12, 256); g.stroke();
  g.beginPath(); g.moveTo(116, 0); g.lineTo(12, 128); g.lineTo(116, 256); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(12, 128); g.lineTo(116, 128); g.stroke();
  g.globalAlpha = 0.25; g.globalCompositeOperation = 'source-atop'; g.fillStyle = grainPattern(g); g.fillRect(0, 0, 128, 256);
  void rng;
  return c;
}

function paintPulley(P) {
  const rng = makeRng(31);
  const c = cv(128, 128), g = c.getContext('2d');
  blobPaint(g, 64, 64, 56, P.wood, rng, {});
  blobPaint(g, 64, 64, 44, shadeC(P.wood, -0.2), rng, { edge: false });
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.strokeStyle = P.woodLight; g.lineWidth = 7; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); g.stroke(); }
  blobPaint(g, 64, 64, 11, P.coral, rng, {});
  return c;
}

function paintCounterweight(P) {
  const rng = makeRng(41);
  const c = cv(128, 192), g = c.getContext('2d');
  polyPaint(g, [[20, 20], [108, 20], [100, 180], [28, 180]], P.metal, rng, { streaks: 10 });
  for (let y = 50; y < 170; y += 30) rectPaint(g, 26, y, 76, 6, shadeC(P.metal, 0.2), rng, { streaks: 0 });
  // a stencilled number nobody remembers the meaning of
  g.fillStyle = rgba(P.cloth, 0.7); g.font = 'bold 30px serif'; g.fillText('7', 54, 120);
  return c;
}

// The lift operator's booth, with the operator, who sometimes has tea.
function paintBooth(seed, P, tea) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  rectPaint(g, 40, 90, 176, 150, mixC(P.stone, P.cloth, 0.3), rng, { streaks: 14 });
  polyPaint(g, [[28, 96], [128, 40], [228, 96]], P.roof[1], rng, {});
  windowPaint(g, 70, 120, 116, 60, P, rng, {});
  tinyFigure(g, 118, 182, 62, P, rng, { coat: P.roof[0] });
  if (tea) { rectPaint(g, 142, 150, 14, 14, P.cloth, rng, {}); g.strokeStyle = rgba('#ffffff', 0.6); g.lineWidth = 2; g.beginPath(); g.moveTo(149, 146); g.quadraticCurveTo(156, 134, 148, 124); g.stroke(); }
  // crank wheel
  blobPaint(g, 196, 200, 18, P.coral, rng, {});
  return c;
}

// Bellows: body tile (accordion folds), 256x128 tile stretched vertically.
function paintBellowsBody(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 128), g = c.getContext('2d');
  const col = mixC(P.coral, P.wood, 0.45);
  for (let i = 0; i < 4; i++) {
    const y = i * 32;
    polyPaint(g, [[18, y], [238, y], [250, y + 16], [238, y + 32], [18, y + 32], [6, y + 16]], i % 2 ? col : shadeC(col, -0.12), rng, { streaks: 5, streakAng: 0, j: 1 });
  }
  return c;
}
function paintBellowsTop(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 64), g = c.getContext('2d');
  rectPaint(g, 4, 12, 248, 30, P.woodLight, rng, { streaks: 8 });
  lipStroke(g, 4, 252, 6, P);
  for (const x of [30, 226]) blobPaint(g, x, 28, 6, P.metal, rng, {});
  return c;
}
function paintBellowsBase(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 192), g = c.getContext('2d');
  polyPaint(g, [[0, 30], [256, 30], [236, 192], [20, 192]], P.stone, rng, { streaks: 16 });
  rectPaint(g, -4, 20, 264, 22, P.wood, rng, {});
  // a bird nest on the side, because birds like warm air
  blobPaint(g, 210, 60, 16, P.woodDark, rng, { j: 4 });
  blobPaint(g, 206, 52, 5, P.cloth, rng, {});
  return c;
}

// The great wheel (rim + spokes + hub). 1024 square for diameter 2R.
function paintWheel(seed, P) {
  const rng = makeRng(seed);
  const S = 1024, c = cv(S, S), g = c.getContext('2d');
  const C = S / 2, R = S * 0.47;
  const col = mixC(P.woodLight, P.cloth, 0.25);
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    g.strokeStyle = shadeC(col, -0.15); g.lineWidth = 10;
    g.beginPath(); g.moveTo(C + Math.cos(a) * 40, C + Math.sin(a) * 40); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
    g.strokeStyle = rgba(shadeC(col, 0.25), 0.6); g.lineWidth = 4;
    g.beginPath(); g.moveTo(C + Math.cos(a) * 40, C + Math.sin(a) * 40); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
  }
  for (const r of [R, R * 0.93, R * 0.55]) {
    g.strokeStyle = shadeC(col, -0.25); g.lineWidth = r === R ? 30 : 12;
    g.beginPath(); g.arc(C, C, r, 0, TAU); g.stroke();
    g.strokeStyle = rgba(shadeC(col, 0.3), 0.55); g.lineWidth = r === R ? 8 : 4;
    g.beginPath(); g.arc(C, C, r - 4, Math.PI * 1.0, Math.PI * 1.7); g.stroke();
  }
  // paddles / little flowerpots tied along the rim (it is an orchard wheel)
  for (let i = 0; i < 24; i++) {
    const a = (i + 0.5) / 24 * TAU;
    const x = C + Math.cos(a) * R * 0.965, y = C + Math.sin(a) * R * 0.965;
    blobPaint(g, x, y, 10, i % 3 === 0 ? P.coral : P.leaf, rng, { edge: false, streaks: 1 });
  }
  blobPaint(g, C, C, 56, P.woodDark, rng, {});
  blobPaint(g, C, C, 26, P.coral, rng, {});
  return c;
}

// Wheel support A-frame. 512x1024; hub at (256, 120).
function paintWheelStand(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 1024), g = c.getContext('2d');
  polyPaint(g, [[236, 110], [276, 110], [470, 1024], [400, 1024]], shadeC(P.wood, -0.2), rng, { streaks: 20, streakAng: 1.35 });
  polyPaint(g, [[236, 110], [276, 110], [110, 1024], [40, 1024]], shadeC(P.wood, -0.1), rng, { streaks: 20, streakAng: 1.8 });
  rectPaint(g, 150, 600, 220, 20, P.woodDark, rng, {});
  return c;
}

// Gondola: 1.7 m floor. 256x256, floor at y=196, x 22..234; hangs from (128,10).
function paintGondola(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  g.strokeStyle = P.woodDark; g.lineWidth = 5;
  g.beginPath(); g.moveTo(128, 10); g.lineTo(40, 120); g.moveTo(128, 10); g.lineTo(216, 120); g.stroke();
  blobPaint(g, 128, 12, 10, P.metal, rng, {});
  // a basket
  polyPaint(g, [[24, 196], [232, 196], [214, 246], [42, 246]], mixC(P.wood, P.yellow, 0.25), rng, { streaks: 18, streakAng: 0 });
  for (let x = 40; x < 220; x += 18) { g.strokeStyle = rgba(P.woodDark, 0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 198); g.lineTo(x + 6, 244); g.stroke(); }
  lipStroke(g, 22, 234, 189, P);
  // apples
  if (seed % 2) for (let i = 0; i < 4; i++) blobPaint(g, 70 + i * 34, 190, 9, i % 2 ? P.coral : P.yellow, rng, { edge: 0.3, streaks: 0 });
  return c;
}

// Swing crane: tower with a jib reaching right. 512x1024. Pivot at (420, 120).
function paintCrane(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 1024), g = c.getContext('2d');
  // mast
  polyPaint(g, [[70, 1024], [86, 90], [126, 90], [150, 1024]], P.wood, rng, { streaks: 30, streakAng: -1.5 });
  for (let y = 180; y < 1024; y += 120) { g.strokeStyle = rgba(P.woodDark, 0.6); g.lineWidth = 5; g.beginPath(); g.moveTo(80, y); g.lineTo(140, y + 60); g.stroke(); }
  // jib
  polyPaint(g, [[90, 92], [440, 108], [440, 134], [96, 150]], P.woodLight, rng, { streaks: 14, streakAng: 0.05 });
  g.strokeStyle = P.woodDark; g.lineWidth = 4;
  g.beginPath(); g.moveTo(106, 40); g.lineTo(436, 112); g.moveTo(106, 40); g.lineTo(106, 92); g.stroke();
  // a flag and a little bucket of stones as counterweight
  g.fillStyle = P.coral; g.beginPath(); g.moveTo(106, 40); g.lineTo(150, 50); g.lineTo(106, 64); g.fill();
  rectPaint(g, 40, 140, 40, 46, P.metal, rng, {});
  blobPaint(g, 420, 122, 14, P.metal, rng, {});
  return c;
}

// Wheelhouse at the ends of a cable line. 256x512.
function paintWheelhouse(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 512), g = c.getContext('2d');
  polyPaint(g, [[60, 512], [80, 150], [176, 150], [196, 512]], mixC(P.stone, P.near, 0.3), rng, { streaks: 30, streakAng: -1.45 });
  rectPaint(g, 40, 70, 176, 100, P.cloth, rng, {});
  polyPaint(g, [[30, 76], [128, 20], [226, 76]], P.roof[0], rng, {});
  blobPaint(g, 128, 120, 34, P.wood, rng, {});
  blobPaint(g, 128, 120, 12, P.coral, rng, {});
  windowPaint(g, 118, 240, 20, 34, P, rng, { figure: true });
  return c;
}

function paintTrolley(P) {
  const rng = makeRng(51);
  const c = cv(128, 128), g = c.getContext('2d');
  blobPaint(g, 46, 30, 14, P.metal, rng, {}); blobPaint(g, 82, 30, 14, P.metal, rng, {});
  rectPaint(g, 34, 34, 60, 22, P.woodLight, rng, {});
  g.strokeStyle = P.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 56); g.lineTo(64, 74); g.stroke();
  return c;
}

// Strider body: 512x256. Deck sits on top at y=70 (x 96..416).
function paintStriderBody(seed, P, goal) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  const hide = goal ? mixC(P.far, P.stone, 0.4) : mixC(P.leafDark, P.stone, 0.35);
  // long neck and patient head
  g.save(); g.beginPath(); g.moveTo(400, 120); g.quadraticCurveTo(470, 80, 478, 30); g.lineTo(500, 34); g.quadraticCurveTo(490, 100, 420, 150); g.closePath(); paintFill(g, hide, rng, { streaks: 6 }); g.restore();
  blobPaint(g, 488, 30, 18, hide, rng, {});
  blobPaint(g, 494, 26, 4, P.ink, rng, { edge: false });
  // body
  g.save(); g.beginPath(); g.ellipse(256, 130, 190, 70, 0, 0, TAU); paintFill(g, hide, rng, { x0: 66, x1: 446, y0: 60, y1: 200, streaks: 40 }); g.restore();
  // painted saddle cloth
  polyPaint(g, [[120, 90], [392, 90], [372, 170], [140, 170]], P.coral, rng, { streaks: 10 });
  for (let i = 0; i < 6; i++) blobPaint(g, 160 + i * 38, 150, 6, P.yellow, rng, { edge: false });
  // deck
  rectPaint(g, 90, 66, 332, 26, P.woodLight, rng, { streaks: 8 });
  lipStroke(g, 92, 420, 60, P);
  return c;
}

// The walking house the post goes to. 512x512 sits on the walker deck (porch at y=440).
function paintWalkerHouse(seed, P, lit) {
  const rng = makeRng(seed);
  const c = cv(512, 512), g = c.getContext('2d');
  rectPaint(g, 150, 180, 260, 260, mixC(P.stone, P.cloth, 0.3), rng, { streaks: 30, streakAng: -1.4 });
  polyPaint(g, [[120, 190], [280, 50], [440, 190]], P.roof[1], rng, { streaks: 20 });
  rectPaint(g, 330, 80, 26, 80, shadeC(P.stone, -0.1), rng, {});
  windowPaint(g, 200, 240, 40, 56, P, rng, { shutters: true, lit });
  windowPaint(g, 320, 240, 40, 56, P, rng, { shutters: true, plant: true, lit });
  rectPaint(g, 250, 330, 54, 110, P.roof[0], rng, {});
  // the letterbox, hopefully waiting
  rectPaint(g, 320, 360, 36, 28, P.coral, rng, {});
  g.fillStyle = P.ink; g.fillRect(326, 372, 24, 4);
  // porch
  rectPaint(g, 20, 436, 472, 26, P.woodLight, rng, { streaks: 10 });
  lipStroke(g, 22, 490, 430, P);
  for (const x of [40, 140, 470]) { g.strokeStyle = P.woodDark; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 436); g.lineTo(x, 380); g.stroke(); }
  g.strokeStyle = P.woodDark; g.lineWidth = 4; g.beginPath(); g.moveTo(40, 384); g.lineTo(140, 384); g.stroke();
  // a flag of welcome
  g.strokeStyle = P.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(130, 190); g.lineTo(130, 120); g.stroke();
  g.fillStyle = P.yellow; g.beginPath(); g.moveTo(130, 120); g.lineTo(176, 132); g.lineTo(130, 146); g.fill();
  return c;
}

// Water: horizontally tileable band with ripples. 256x128.
function paintWater(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 128), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, 128);
  lg.addColorStop(0, P.waterLight); lg.addColorStop(0.15, P.water); lg.addColorStop(1, shadeC(P.water, -0.35));
  g.fillStyle = lg; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 40; i++) {
    const x = rng() * 256, y = 10 + rng() * 110, w = 10 + rng() * 30;
    g.strokeStyle = rgba(P.waterLight, 0.25 + rng() * 0.3); g.lineWidth = 1.5 + rng() * 2;
    for (const off of [0, -256, 256]) { g.beginPath(); g.moveTo(x + off, y); g.lineTo(x + off + w, y); g.stroke(); }
  }
  g.fillStyle = rgba('#ffffff', 0.6); g.fillRect(0, 0, 256, 3);
  return c;
}

// Dark, soft foreground silhouettes: hanging vines, reeds, bunting.
function paintForeground(seed, P, kind) {
  const rng = makeRng(seed);
  const c = cv(256, 512), g = c.getContext('2d');
  const col = shadeC(mixC(P.leafDark, P.ink, 0.5), -0.25);
  g.filter = 'blur(2px)';
  if (kind === 'vines') {
    for (let k = 0; k < 6; k++) {
      let x = 20 + rng() * 216, y = 0;
      const len = 150 + rng() * 330;
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 0);
      while (y < len) { y += 12; x += (rng() - 0.5) * 6; g.lineTo(x, y); }
      g.stroke();
      for (let yy = 10; yy < len; yy += 14) { g.fillStyle = col; g.beginPath(); g.ellipse(x + (rng() - 0.5) * 10, yy, 7, 4, rng() * 3, 0, TAU); g.fill(); }
    }
  } else if (kind === 'reeds') {
    for (let k = 0; k < 18; k++) {
      const x = 10 + rng() * 236, h = 200 + rng() * 300, bend = (rng() - 0.3) * 50;
      g.strokeStyle = col; g.lineWidth = 3 + rng() * 3; g.beginPath(); g.moveTo(x, 512); g.quadraticCurveTo(x, 512 - h * 0.6, x + bend, 512 - h); g.stroke();
      if (rng.chance(0.4)) { g.fillStyle = col; g.beginPath(); g.ellipse(x + bend, 512 - h, 5, 16, 0, 0, TAU); g.fill(); }
    }
  } else {
    // a post with bunting
    g.fillStyle = col; g.fillRect(110, 40, 22, 472);
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(120, 60); g.quadraticCurveTo(200, 120, 256, 90); g.stroke();
    for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? mixC(P.coral, col, 0.55) : mixC(P.yellow, col, 0.55); const x = 140 + i * 24, y = 80 + Math.sin(i) * 10 + i * 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y + 2); g.lineTo(x + 8, y + 22); g.fill(); }
  }
  g.filter = 'none';
  return c;
}

// Small props that sit on piers and tell little stories.
function paintProp(seed, P, kind) {
  const rng = makeRng(seed);
  const c = cv(128, 192), g = c.getContext('2d');
  if (kind === 'lamp') {
    g.strokeStyle = P.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(64, 192); g.lineTo(64, 40); g.quadraticCurveTo(64, 20, 90, 22); g.stroke();
    blobPaint(g, 92, 36, 12, P.yellow, rng, {});
  } else if (kind === 'waiter') {
    // somebody waiting with a suitcase, looking at the thing that will come back
    tinyFigure(g, 60, 186, 92, P, rng, { coat: rng.pick(P.roof) });
    rectPaint(g, 78, 156, 30, 30, P.woodLight, rng, {});
  } else if (kind === 'pots') {
    for (let i = 0; i < 3; i++) { rectPaint(g, 14 + i * 36, 150, 30, 40, P.coral, rng, {}); for (let k = 0; k < 4; k++) blobPaint(g, 22 + i * 36 + rng() * 16, 140 - rng() * 30, 8 + rng() * 6, P.leaf, rng, { edge: false }); }
  } else if (kind === 'cat') {
    blobPaint(g, 60, 172, 20, P.ink, rng, { j: 1 }); blobPaint(g, 84, 156, 12, P.ink, rng, {});
    g.fillStyle = P.ink; g.beginPath(); g.moveTo(78, 148); g.lineTo(80, 136); g.lineTo(86, 146); g.moveTo(88, 146); g.lineTo(92, 136); g.lineTo(94, 150); g.fill();
    g.strokeStyle = P.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(42, 176); g.quadraticCurveTo(20, 170, 26, 140); g.stroke();
  } else if (kind === 'bollard') {
    rectPaint(g, 46, 120, 36, 72, P.metal, rng, {});
    g.strokeStyle = P.cloth; g.lineWidth = 4; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(64, 150 + i * 8, 22, 6, 0, 0, TAU); g.stroke(); }
  } else if (kind === 'sign') {
    g.strokeStyle = P.woodDark; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 192); g.lineTo(64, 60); g.stroke();
    polyPaint(g, [[20, 60], [110, 60], [122, 80], [110, 100], [20, 100]], P.cloth, rng, {});
    g.strokeStyle = rgba(P.ink, 0.6); g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(30, 72 + i * 9); g.lineTo(96 - i * 10, 72 + i * 9); g.stroke(); }
  }
  return c;
}

// ---- 07_scene.js ----
// ---------------------------------------------------------------------------
// The stage: a perspective camera looking at the gameplay plane (z = 0), with
// painted layers at real depths behind and in front, so parallax and
// atmospheric perspective come from the camera and the fog, not from tricks.
// ---------------------------------------------------------------------------

function createStage(THREE, canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality > 0.6, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0xeee4cf, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 900);
  camera.position.set(0, 4, 52);
  scene.add(camera);
  scene.fog = new THREE.Fog(0xeee4cf, 58, 760);

  // Sky: a gradient card stuck to the back of the camera.
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, haze: { value: new THREE.Color() },
      sun: { value: new THREE.Color() }, sunPos: { value: new THREE.Vector2(0.72, 0.62) }, aspect: { value: 1 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 haze; uniform vec3 sun; uniform vec2 sunPos; uniform float aspect;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float y = vUv.y;
        vec3 c = mix(haze, mid, smoothstep(0.18, 0.55, y));
        c = mix(c, top, smoothstep(0.55, 1.0, y));
        vec2 d = (vUv - sunPos) * vec2(aspect, 1.0);
        float r = length(d);
        c = mix(c, sun, 0.55 * exp(-r * 5.0) + 0.35 * exp(-r * 18.0));
        c += (hash(vUv * 900.0) - 0.5) * 0.012;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthWrite: false, depthTest: false, fog: false
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.renderOrder = -100; sky.frustumCulled = false;
  camera.add(sky);

  return { THREE, renderer, scene, camera, sky, skyMat, quality };
}

// Fit the camera so the phone shows about 12.5 m across in portrait.
function fitStage(stage, w, h, dpr) {
  const { renderer, camera, sky } = stage;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  const viewW = clamp(aspect * 27, 12.5, 38);
  const viewH = viewW / aspect;
  const dist = (viewH / 2) / Math.tan(camera.fov * Math.PI / 360);
  stage.dist = dist; stage.viewW = viewW; stage.viewH = viewH;
  camera.near = 2; camera.far = dist + 900;
  camera.updateProjectionMatrix();
  // sky card fills the frustum at a fixed depth
  const sd = dist + 840;
  const sh = 2 * sd * Math.tan(camera.fov * Math.PI / 360);
  sky.position.set(0, 0, -sd); sky.scale.set(sh * aspect * 0.55, sh * 0.55, 1);
  stage.skyMat.uniforms.aspect.value = aspect;
}

// ---- texture cache per palette --------------------------------------------
function makeTexKit(stage, P, region) {
  const { THREE, renderer } = stage;
  const cache = new Map();
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const tex = (key, paint, opts) => {
    if (cache.has(key)) return cache.get(key);
    const c = paint();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    if (opts && opts.repeat) { t.wrapS = THREE.RepeatWrapping; if (opts.repeat === 'xy') t.wrapT = THREE.RepeatWrapping; }
    t.userData = { w: c.width, h: c.height };
    cache.set(key, t);
    return t;
  };
  const kit = { P, region, tex, cache, mats: [] };
  kit.dispose = () => { for (const t of cache.values()) t.dispose(); for (const m of kit.mats) m.dispose(); cache.clear(); };
  return kit;
}

// A painted card: canvas pixel (ax, ay) sits at the local origin.
function card(stage, kit, t, pxPerM, ax, ay, opts) {
  const { THREE } = stage;
  const w = t.userData.w / pxPerM, h = t.userData.h / pxPerM;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(w / 2 - ax / pxPerM, -h / 2 + ay / pxPerM, 0);
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: !(opts && opts.noFog), opacity: (opts && opts.opacity) || 1 });
  if (opts && opts.color) mat.color.set(opts.color);
  kit.mats.push(mat);
  const m = new THREE.Mesh(geo, mat);
  return m;
}

// A solid strip (rope, cable, lip line), unit length along +x, centred on y.
function strip(stage, kit, color, width, opts) {
  const { THREE } = stage;
  const geo = new THREE.PlaneGeometry(1, width);
  geo.translate(0.5, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: (opts && opts.opacity) || 1 });
  kit.mats.push(mat);
  return new THREE.Mesh(geo, mat);
}
function setStrip(m, x0, y0, x1, y1) {
  m.position.set(x0, y0, m.position.z);
  m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  m.scale.x = Math.max(0.001, Math.hypot(x1 - x0, y1 - y0));
}

// ---- building the world for a route -----------------------------------------
function buildWorldView(stage, W, regionIdx, opts) {
  const { THREE, scene } = stage;
  const P = PALETTES[regionIdx];
  stage.kits = stage.kits || {};
  const kit = stage.kits[regionIdx] || (stage.kits[regionIdx] = makeTexKit(stage, P, regionIdx));
  const root = new THREE.Group();
  scene.add(root);
  const rng = makeRng((W.spec.seed ^ 0xabcdef) >>> 0);
  const evening = regionIdx === 3;
  const view = { root, kit, P, sysViews: [], anims: [], letters: [], W, clones: [], mats: [] };
  kit.mats = view.mats;

  // route extents
  let ymin = 1e9, ymax = -1e9;
  for (const s of W.surfaces) { ymin = Math.min(ymin, s.ymin); ymax = Math.max(ymax, s.ymax); }
  const x0 = -30, x1 = W.finalX + 40;
  view.ymin = ymin; view.ymax = ymax;

  // fog and sky colours
  scene.fog.color.set(P.haze);
  stage.renderer.setClearColor(new THREE.Color(P.haze), 1);
  const u = stage.skyMat.uniforms;
  u.top.value.set(P.skyTop); u.mid.value.set(P.skyMid); u.haze.value.set(P.haze); u.sun.value.set(P.sun);

  // far monuments
  const monKinds = ['spire', 'discs', 'mesa', 'stair'];
  const monTex = monKinds.map((k, i) => kit.tex('mon' + k, () => paintMonument(100 + i + regionIdx * 10, P, k)));
  for (let x = x0 - 200, i = 0; x < x1 + 200; x += 70 + rng() * 60, i++) {
    const k = i % 4 === 3 ? 2 : rng.int(0, 3);
    const t = monTex[k];
    const hgt = 150 + rng() * 120;
    const m = card(stage, kit, t, 1024 / hgt, 256, 1024);
    m.position.set(x, ymin - 70 - rng() * 30, -380 - rng() * 90);
    root.add(m);
  }
  // a distant wheel that never stops, and the giant arm
  const fw = card(stage, kit, kit.tex('farwheel', () => paintFarWheel(7, P)), 512 / 70, 256, 256);
  fw.position.set(x0 + (x1 - x0) * 0.35, ymin + 26, -300);
  root.add(fw);
  view.anims.push(t => { fw.rotation.z = -t * 0.05; });
  // distant kin of the walking house, crossing the horizon
  for (let i = 0; i < 2; i++) {
    const k = card(stage, kit, kit.tex('kin', () => paintStriderBody(3, P, true)), 512 / 22, 256, 200);
    const legs = [];
    for (let l = 0; l < 4; l++) { const s = strip(stage, kit, mixC(P.far, P.ink, 0.25), 0.9); s.position.z = -230 - i * 30 - 0.1; root.add(s); legs.push(s); }
    k.position.z = -230 - i * 30;
    root.add(k);
    const base = x0 + (x1 - x0) * (0.2 + 0.5 * i), yb = ymin + 6 + i * 6;
    view.anims.push(t => {
      const x = base + t * (0.6 + i * 0.3), ph = t * (0.6 + i * 0.3) / 7;
      const y = yb + 34 + Math.abs(Math.sin(ph * Math.PI)) * 0.8;
      k.position.x = x; k.position.y = y;
      for (let l = 0; l < 4; l++) {
        const hip = x - 6 + (l % 2) * 12 + (l > 1 ? 1.5 : 0);
        const sw = Math.sin(ph * Math.PI + l * Math.PI) * 3;
        setStrip(legs[l], hip, y - 1, hip + sw, y - 40);
      }
    });
  }

  // ridges
  const ridgeFar = kit.tex('ridgeFar', () => paintRidge(21 + regionIdx, P, 'far'), { repeat: 'x' });
  const ridgeNear = kit.tex('ridgeNear', () => paintRidge(41 + regionIdx, P, 'near'), { repeat: 'x' });
  const ridge = (t, z, h, y, reps) => {
    const w = (x1 - x0) + 600;
    const m = card(stage, kit, t, 1, 0, 0);
    m.geometry.dispose();
    m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2, 0);
    t.repeat.set(reps, 1);
    m.position.set(x0 - 300, y, z);
    root.add(m);
    return m;
  };
  ridge(ridgeFar, -210, 90, ymin + 30, Math.ceil((x1 - x0 + 600) / 240));
  ridge(ridgeNear, -110, 60, ymin + 12, Math.ceil((x1 - x0 + 600) / 150));

  // clouds
  const cloudTex = [0, 1, 2].map(i => kit.tex('cloud' + i, () => paintCloud(300 + i, P)));
  for (let i = 0; i < Math.ceil((x1 - x0) / 18); i++) {
    const z = -40 - rng() * 260;
    const m = card(stage, kit, cloudTex[i % 3], 512 / (16 + rng() * 22), 256, 128, { opacity: 0.85 });
    const bx = x0 + rng() * (x1 - x0), by = ymin + rng() * (ymax - ymin + 40) + 8 + (-z) * 0.08;
    m.position.set(bx, by, z);
    root.add(m);
    const sp = 0.2 + rng() * 0.4;
    view.anims.push(t => { m.position.x = bx + t * sp; });
  }

  // near background houses and trees, roughly following the route's height
  const houseTex = [0, 1, 2, 3, 4, 5].map(i => kit.tex('house' + i, () => paintHouse(500 + i * 13 + regionIdx * 101, P, { lit: evening })));
  const treeTex = [0, 1, 2].map(i => kit.tex('tree' + i, () => paintTree(700 + i + regionIdx * 3, P)));
  const yAtX = x => {
    let best = 0, bd = 1e9;
    for (const m of W.modules) { const c = (m.x0 + m.x1) / 2, d = Math.abs(c - x); if (d < bd) { bd = d; best = m.y; } }
    return best;
  };
  for (let x = x0; x < x1; x += 7 + rng() * 9) {
    const z = -16 - rng() * 20;
    const y = yAtX(x) - 6 - rng() * 4;
    const t = houseTex[rng.int(0, 5)];
    const m = card(stage, kit, t, 256 / (4.5 + rng() * 2.5), 128, 640, { color: mixC('#ffffff', P.far, clamp((-z - 16) / 30, 0, 0.6)) });
    m.material.alphaMap = fadeTex(stage, kit);
    m.position.set(x, y - 2, z);
    root.add(m);
    if (rng.chance(0.4)) {
      const tr = card(stage, kit, treeTex[rng.int(0, 2)], 256 / (3 + rng() * 2), 128, 320);
      tr.position.set(x + 2 + rng() * 2, y + 1 + rng() * 4, z + 1.5);
      root.add(tr);
      const ph = rng() * 6;
      view.anims.push(t2 => { tr.rotation.z = Math.sin(t2 * 0.9 + ph) * 0.015; });
    }
  }

  // mist below and in front: it hangs at the bottom of the view, and falling
  // means falling into it
  const mistTex = kit.tex('mist', () => paintMist(11 + regionIdx, P), { repeat: 'x' });
  const mists = [];
  const mistCol = mixC(P.haze, '#ffffff', 0.4);
  for (const [z, dy, op] of [[-34, 3.2, 0.85], [-8, 1.4, 0.9], [4, -0.6, 1]]) {
    const w = (x1 - x0) + 400, h = 9;
    const m = card(stage, kit, mistTex, 1, 0, 0, { opacity: op });
    m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2 + 4.5, 0);
    m.material.map = mistTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 40, 1);
    view.clones.push(m.material.map);
    const below = strip(stage, kit, mistCol, 60, { opacity: op });
    below.scale.x = w; below.position.set(0, -30 - 4.5 + 0.2, 0);
    m.add(below);
    m.position.set(x0 - 200, 0, z);
    root.add(m);
    mists.push({ m, dy, z });
  }
  view.mists = mists;
  view.anims.push(t => { mists.forEach((o, i) => { o.m.material.map.offset.x = t * (0.004 + i * 0.003); }); });

  // water bands for ferry crossings
  const waterTex = kit.tex('water', () => paintWater(5, P), { repeat: 'x' });
  for (const wv of W.waters) {
    const w = wv.x1 - wv.x0 + 1.2;
    for (const [z, op, dy, h] of [[-0.8, 1, 0.05, 6], [0.25, 0.82, -0.12, 3]]) {
      const m = card(stage, kit, waterTex, 1, 0, 0, { opacity: op });
      m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2, 0);
      m.material.map = waterTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 2.2, 1);
      view.clones.push(m.material.map);
      m.material.alphaMap = fadeTex(stage, kit);
      m.position.set(wv.x0 - 0.6, wv.y + 0.25 + dy, z);
      root.add(m);
      const mm = m;
      view.anims.push(t => { mm.material.map.offset.x = t * (z > 0 ? 0.05 : -0.02); });
    }
  }

  // foreground silhouettes, sparse
  const fgKinds = ['vines', 'reeds'];
  const fgTex = fgKinds.map((k, i) => kit.tex('fg' + k, () => paintForeground(900 + i, P, k)));
  for (let x = x0 + 10; x < x1; x += 22 + rng() * 26) {
    const k = rng.int(0, 1);
    const y = yAtX(x);
    const m = card(stage, kit, fgTex[k], 256 / 5, 128, k === 0 ? 0 : 512, { noFog: true, opacity: k === 0 ? 0.75 : 0.42 });
    m.position.set(x, k === 0 ? y + 14 : y - 7, 10 + rng() * 4);
    root.add(m);
    const ph = rng() * 6;
    view.anims.push(t => { m.rotation.z = Math.sin(t * 0.7 + ph) * 0.02; });
  }

  // gameplay systems
  for (const sys of W.systems) {
    const v = buildSystemView(stage, kit, sys, rng, view);
    if (v) { root.add(v.group); view.sysViews.push(v); }
  }

  // lost letters
  const letterTex = kit.tex('letter', () => paintLetter(P));
  for (const L of W.letters) {
    const m = card(stage, kit, letterTex, 128 / 1.1, 64, 64);
    m.position.set(L.x, L.y, 0.3);
    root.add(m);
    view.letters.push({ L, m, taken: false, fade: 0 });
  }

  view.update = (t, camX, camY, viewH) => {
    for (const o of view.mists) { const pz = (stage.dist - o.z) / stage.dist; o.m.position.y = camY - viewH * 0.5 * pz + o.dy; }
    for (const a of view.anims) a(t);
    for (const v of view.sysViews) if (Math.abs(v.cx - camX) < v.reach + 22) { v.group.visible = true; v.update(t); } else v.group.visible = false;
    for (const lv of view.letters) {
      if (lv.taken) { lv.fade = Math.min(1, lv.fade + 0.03); lv.m.material.opacity = 1 - lv.fade; lv.m.position.y += 0.03; lv.m.scale.setScalar(1 + lv.fade * 0.6); lv.m.visible = lv.fade < 1; }
      else { lv.m.position.y = lv.L.y + Math.sin(t * 2 + lv.L.x) * 0.12; lv.m.rotation.z = Math.sin(t * 1.3 + lv.L.x) * 0.08; }
    }
  };
  view.dispose = () => { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); view.clones.forEach(t => t.dispose()); view.mats.forEach(m => m.dispose()); };
  return view;
}

// ---- one system ------------------------------------------------------------------
function buildSystemView(stage, kit, sys, rng, view) {
  const { THREE } = stage;
  const P = kit.P;
  const g = new THREE.Group();
  const p = sys.params;
  const o = { x: 0, y: 0, a: 0 };
  const v = { group: g, sys, update: () => {}, cx: 0, reach: 10 };
  const lipLine = (len) => { const s = strip(stage, kit, shadeC(P.stoneLight, 0.1), 0.09); s.scale.x = len; return s; };

  if (sys.kind === 'pier') {
    const sf = sys.surfaces[0];
    const stoneTex = kit.tex('stone' + p.style, () => paintStoneTile(61, P, p.style), { repeat: 'xy' });
    const depth = 6;
    const body = card(stage, kit, stoneTex, 1, 0, 0);
    body.geometry.dispose(); body.geometry = new THREE.PlaneGeometry(p.len, depth); body.geometry.translate(p.len / 2, -depth / 2, 0);
    body.material.map = stoneTex.clone(); body.material.map.needsUpdate = true; body.material.map.repeat.set(p.len / 2.2, depth / 2.2);
    view.clones.push(body.material.map);
    body.material.alphaMap = fadeTex(stage, kit);
    body.position.set(p.x, p.y - 0.18, -0.35);
    g.add(body);
    // cap
    const cap = strip(stage, kit, p.style === 'wood' ? P.woodLight : P.stoneLight, 0.3);
    cap.scale.x = p.len + 0.24; cap.position.set(p.x - 0.12, p.y - 0.12, -0.3);
    g.add(cap);
    const lip = lipLine(p.len); lip.position.set(p.x, p.y - 0.02, -0.28); g.add(lip);
    const under = strip(stage, kit, shadeC(P.stone, -0.45), 0.06, { opacity: 0.5 }); under.scale.x = p.len + 0.24; under.position.set(p.x - 0.12, p.y - 0.3, -0.29); g.add(under);
    // a prop or an inhabitant
    if (p.len > 3 && rng.chance(0.75)) {
      const kinds = ['lamp', 'waiter', 'pots', 'cat', 'bollard', 'sign', 'waiter'];
      const k = rng.pick(kinds);
      const t = kit.tex('prop' + k, () => paintProp(80 + kinds.indexOf(k), P, k));
      const m = card(stage, kit, t, 128 / 1.0, 64, 190);
      m.position.set(p.x + 0.5 + rng() * Math.max(0.2, p.len - 2.2), p.y, -0.2);
      g.add(m);
      if (k === 'waiter' || k === 'cat') {
        const ph = rng() * 5;
        v.wave = m;
        view.anims.push(t2 => { m.rotation.z = Math.sin(t2 * 1.2 + ph) * 0.02; });
      }
    }
    void sf;
    v.cx = p.x + p.len / 2; v.reach = p.len;
    return v;
  }

  if (sys.kind === 'skiff') {
    const t = kit.tex('skiff', () => paintSkiff(11, P));
    const m = card(stage, kit, t, 420 / p.len, 46, 88);
    g.add(m);
    const sf = sys.surfaces[0];
    v.update = tt => { sf.pose(tt, o); m.position.set(o.x, o.y, 0.02); m.rotation.z = o.a; };
    v.cx = (p.xa + p.xb) / 2 + p.len / 2; v.reach = Math.abs(p.xb - p.xa) + 4;
    // mooring posts at both ends
    for (const x of [p.xa - 0.25, p.xb + p.len + 0.15]) {
      const post = strip(stage, kit, P.woodDark, 0.18); post.position.set(x, p.y - 1.2, -0.1); post.rotation.z = Math.PI / 2; post.scale.x = 2.4; g.add(post);
    }
    return v;
  }

  if (sys.kind === 'lift') {
    const cageTex = kit.tex('cage', () => paintCage(2, P));
    const lat = kit.tex('lattice', () => paintLattice(3, P), { repeat: 'xy' });
    const pul = kit.tex('pulley', () => paintPulley(P));
    let lo = 1e9, hi = -1e9;
    for (const c of p.cages) { lo = Math.min(lo, c.yb); hi = Math.max(hi, c.yb + c.h); }
    const cages = [], ropes = [];
    const topY = hi + 3.2;
    for (const c of p.cages) {
      for (const rx of [c.x - 0.3, c.x + p.len + 0.02]) {
        const rail = card(stage, kit, lat, 1, 0, 0);
        const H = topY - lo + 10;
        rail.geometry.dispose(); rail.geometry = new THREE.PlaneGeometry(0.34, H); rail.geometry.translate(0.17, -H / 2, 0);
        rail.material.map = lat.clone(); rail.material.map.needsUpdate = true; rail.material.map.repeat.set(1, H / 0.7);
        view.clones.push(rail.material.map);
        rail.position.set(rx, topY, -0.5);
        g.add(rail);
      }
      const beam = strip(stage, kit, P.woodDark, 0.3); beam.scale.x = p.len + 0.7; beam.position.set(c.x - 0.35, topY, -0.45); g.add(beam);
      const m = card(stage, kit, cageTex, 224 / p.len, 16, 194);
      g.add(m); cages.push({ m, c });
      const r = strip(stage, kit, P.ink, 0.05); r.position.z = -0.05; g.add(r); ropes.push(r);
    }
    const pulleys = [];
    const pxs = p.cages.length > 1 ? [(p.cages[0].x + p.len + p.cages[1].x) / 2] : [p.cages[0].x + p.len / 2];
    for (const px of pxs) {
      const m = card(stage, kit, pul, 128 / 1.4, 64, 64); m.position.set(px, topY + 0.55, -0.3); g.add(m); pulleys.push(m);
    }
    if (p.cages.length > 1) { const span = strip(stage, kit, P.woodDark, 0.3); span.scale.x = p.cages[1].x - p.cages[0].x; span.position.set(p.cages[0].x + p.len / 2, topY + 0.55, -0.42); g.add(span); }
    // counterweight for a lone cage, and the operator's booth
    let cw = null;
    if (p.cages.length === 1) {
      cw = card(stage, kit, kit.tex('cw', () => paintCounterweight(P)), 128 / 0.7, 64, 20);
      cw.position.z = -0.42; g.add(cw);
    }
    const booth0 = card(stage, kit, kit.tex('booth0', () => paintBooth(91, P, false)), 256 / 2.4, 128, 240);
    const booth1 = card(stage, kit, kit.tex('booth1', () => paintBooth(91, P, true)), 256 / 2.4, 128, 240);
    const bx = p.cages[0].x - 1.6;
    for (const b of [booth0, booth1]) { b.position.set(bx, p.cages[0].yb - 0.1, -0.7); g.add(b); }
    const longK = p.pattern ? p.pattern.length - 1 : -1;
    v.update = tt => {
      const st = sys.state(tt);
      booth1.visible = st.k === longK && longK >= 0; booth0.visible = !booth1.visible;
      for (let i = 0; i < cages.length; i++) {
        sys.surfaces[i].pose(tt, o);
        cages[i].m.position.set(o.x, o.y, 0.02);
        setStrip(ropes[i], o.x + p.len / 2, o.y + 1.65, o.x + p.len / 2, topY + 0.3);
      }
      for (const m of pulleys) m.rotation.z = -st.u * 9;
      if (cw) cw.position.set(p.cages[0].x - 0.9, lo + p.cages[0].h * (1 - st.u) + 1.0, -0.42);
    };
    v.cx = p.cages[0].x + p.len; v.reach = 6;
    return v;
  }

  if (sys.kind === 'bellows') {
    const body = card(stage, kit, kit.tex('bbody', () => paintBellowsBody(4, P)), 1, 0, 0);
    body.geometry.dispose(); body.geometry = new THREE.PlaneGeometry(p.len, 1); body.geometry.translate(p.len / 2, -0.5, 0);
    const top = card(stage, kit, kit.tex('btop', () => paintBellowsTop(5, P)), 248 / p.len, 4, 6);
    const base = card(stage, kit, kit.tex('bbase', () => paintBellowsBase(6, P)), 256 / (p.len + 0.4), 0, 30);
    const baseY = p.top - p.depth - 0.9;
    base.position.set(p.x - 0.2, baseY, -0.1);
    g.add(body); g.add(top); g.add(base);
    v.update = tt => {
      const st = sys.state(tt);
      const y = p.top - p.depth * st.squeeze;
      top.position.set(p.x, y, 0.03);
      const h = Math.max(0.1, y - 0.25 - baseY);
      body.position.set(p.x, y - 0.25, -0.02); body.scale.y = h;
    };
    v.cx = p.x + 1; v.reach = 4;
    return v;
  }

  if (sys.kind === 'wheel') {
    const wt = kit.tex('wheel', () => paintWheel(8, P));
    const wheel = card(stage, kit, wt, 481 / p.R, 512, 512);
    wheel.position.set(p.cx, p.cy, -0.9);
    const stand = card(stage, kit, kit.tex('wstand', () => paintWheelStand(9, P)), 1024 / (p.R + 12), 256, 112, { color: '#d8d2c8' });
    stand.position.set(p.cx, p.cy, -1.4);
    g.add(stand); g.add(wheel);
    const gt = [kit.tex('gond0', () => paintGondola(0, P)), kit.tex('gond1', () => paintGondola(1, P))];
    const gons = sys.surfaces.map((sf, i) => { const m = card(stage, kit, gt[i % 2], 212 / sf.len, 22, 189); g.add(m); return m; });
    const hangers = sys.surfaces.map(() => { const s = strip(stage, kit, P.woodDark, 0.06); s.position.z = -0.1; g.add(s); return s; });
    v.update = tt => {
      const a = sys.angleAt(tt);
      wheel.rotation.z = a;
      sys.surfaces.forEach((sf, i) => {
        sf.pose(tt, o);
        gons[i].position.set(o.x, o.y, 0.02);
        const ph = a + i * TAU / p.n;
        setStrip(hangers[i], p.cx + Math.cos(ph) * p.R, p.cy + Math.sin(ph) * p.R, o.x + sf.len / 2, o.y + 1.0);
      });
    };
    v.cx = p.cx; v.reach = p.R + 4;
    return v;
  }

  if (sys.kind === 'swing') {
    const crane = card(stage, kit, kit.tex('crane', () => paintCrane(12, P)), 70, 420, 122);
    crane.position.set(p.px, p.py, -0.45);
    g.add(crane);
    const rope = strip(stage, kit, P.ink, 0.05); rope.position.z = -0.05; g.add(rope);
    const ring = card(stage, kit, kit.tex('ring', () => paintRing(P)), 128 / 0.75, 64, 64);
    g.add(ring);
    const h = sys.handles[0];
    v.update = tt => {
      h.pos(tt, o);
      setStrip(rope, p.px, p.py, o.x, o.y + 0.25);
      ring.position.set(o.x, o.y, 0.08);
    };
    v.ring = ring;
    v.cx = p.px; v.reach = p.L + 4;
    return v;
  }

  if (sys.kind === 'trolley') {
    const wh = kit.tex('wheelhouse', () => paintWheelhouse(13, P));
    for (const [x, y] of [[p.ax, p.ay], [p.bx, p.by]]) { const m = card(stage, kit, wh, 128 / 1.0, 128, 120); m.position.set(x, y, -0.4); g.add(m); }
    const cable = strip(stage, kit, P.ink, 0.045); cable.position.z = -0.1; setStrip(cable, p.ax, p.ay, p.bx, p.by); g.add(cable);
    const cable2 = strip(stage, kit, P.ink, 0.035, { opacity: 0.6 }); cable2.position.z = -0.12; setStrip(cable2, p.ax, p.ay + 0.25, p.bx, p.by + 0.25); g.add(cable2);
    const trT = kit.tex('trolley', () => paintTrolley(P));
    const ringT = kit.tex('ring', () => paintRing(P));
    const items = sys.handles.map(() => {
      const tr = card(stage, kit, trT, 128 / 0.8, 64, 30); const ring = card(stage, kit, ringT, 128 / 0.75, 64, 64);
      g.add(tr); g.add(ring); return { tr, ring };
    });
    v.update = tt => {
      sys.handles.forEach((h, i) => {
        const vis = h.pos(tt, o);
        items[i].tr.visible = items[i].ring.visible = vis;
        if (vis) { items[i].ring.position.set(o.x, o.y, 0.08); items[i].tr.position.set(o.x, o.y + 0.55, 0.06); }
      });
    };
    v.cx = (p.ax + p.bx) / 2; v.reach = Math.abs(p.bx - p.ax) / 2 + 4;
    return v;
  }

  if (sys.kind === 'strider' || sys.kind === 'walker') {
    const goal = sys.kind === 'walker';
    const sc = goal ? 1.6 : 1;
    const bodyT = kit.tex(goal ? 'walkerBody' : 'striderBody', () => paintStriderBody(goal ? 17 : 14, P, goal));
    const body = card(stage, kit, bodyT, 328 / p.len, 92, 60);
    g.add(body);
    let house = null;
    if (goal) {
      house = card(stage, kit, kit.tex('walkerHouse', () => paintWalkerHouse(19, P, kit.region === 3)), 468 / p.len, 22, 430);
      g.add(house);
    }
    const legCol = mixC(P.leafDark, P.ink, goal ? 0.6 : 0.45);
    const legs = [];
    for (let l = 0; l < 4; l++) {
      const near = l >= 2;
      const th = strip(stage, kit, near ? legCol : shadeC(legCol, -0.25), 0.2 * sc), sh = strip(stage, kit, near ? legCol : shadeC(legCol, -0.25), 0.14 * sc);
      th.position.z = sh.position.z = near ? 0.22 : -0.15;
      g.add(th); g.add(sh); legs.push([th, sh]);
    }
    const sf = sys.surfaces[0];
    const legLen = 3.6 * sc;
    v.update = tt => {
      const st = sys.state(tt);
      sf.pose(tt, o);
      body.position.set(o.x, o.y, house ? -0.04 : 0.02); body.rotation.z = o.a;
      body.scale.x = st.dir < 0 && !goal ? 1 : 1;
      if (house) { house.position.set(o.x, o.y, -0.02); house.rotation.z = o.a; }
      const hipY = o.y - 0.9 * sc;
      for (let l = 0; l < 4; l++) {
        const front = l % 2 === 0;
        const hipX = o.x + (front ? p.len * 0.78 : p.len * 0.22);
        const ph = st.stepPh * Math.PI + (l === 0 || l === 3 ? 0 : Math.PI);
        const swing = st.moving ? Math.sin(ph) * 0.9 * sc : 0;
        const lift = st.moving ? Math.max(0, Math.cos(ph)) * 0.5 * sc : 0;
        const fx = hipX + swing * st.dir, fy = hipY - legLen * 2 * 0.92 + lift;
        const kx = (hipX + fx) / 2 + 0.6 * sc * (front ? 1 : -1) * 0.6, ky = (hipY + fy) / 2 + 0.3;
        setStrip(legs[l][0], hipX, hipY, kx, ky);
        setStrip(legs[l][1], kx, ky, fx, fy);
      }
    };
    v.cx = (p.xa + p.xb) / 2; v.reach = Math.abs(p.xb - p.xa) / 2 + 6;
    return v;
  }
  return null;
}

// Shared alpha ramp: opaque at the top, gone at the bottom.
function fadeTex(stage, kit) {
  if (!kit.fadeTex) {
    const c = cv(4, 64), gg = c.getContext('2d');
    const lg = gg.createLinearGradient(0, 0, 0, 64); lg.addColorStop(0, '#fff'); lg.addColorStop(0.5, '#fff'); lg.addColorStop(1, '#000');
    gg.fillStyle = lg; gg.fillRect(0, 0, 4, 64);
    kit.fadeTex = new stage.THREE.CanvasTexture(c); kit.cache.set('fade', kit.fadeTex);
  }
  return kit.fadeTex;
}

// ---- 08_courier.js ----
// ---------------------------------------------------------------------------
// The courier: a small jointed puppet in a deep-teal coat and a dusty coral
// hood, a parcel strapped to their back and a long yellow scarf that streams
// with speed. Momentum is shown by the scarf and the body, never by a meter.
// ---------------------------------------------------------------------------

function buildCourier(stage, P) {
  const { THREE } = stage;
  const mats = [];
  const mat = (c, o) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, opacity: (o && o.opacity) || 1 }); mats.push(m); return m; };
  const shapeMesh = (pts, color, z) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i];
      if (q.length === 4) s.quadraticCurveTo(q[0], q[1], q[2], q[3]); else s.lineTo(q[0], q[1]);
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 8), mat(color));
    m.position.z = z || 0;
    return m;
  };
  const capsule = (w, h, color, z) => {
    const r = w / 2;
    const s = new THREE.Shape();
    s.moveTo(-r, 0); s.lineTo(-r, -h + r); s.quadraticCurveTo(-r, -h, 0, -h); s.quadraticCurveTo(r, -h, r, -h + r); s.lineTo(r, 0); s.quadraticCurveTo(r, r, 0, r); s.quadraticCurveTo(-r, r, -r, 0);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 6), mat(color));
    m.position.z = z || 0;
    return m;
  };
  const coat = '#2f5a5e', coatDark = '#23474b', trouser = '#3a3f4a', skin = '#e9c4a2', hood = P.coral, scarfC = P.yellow;

  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.44; root.add(body);
  // legs (pivot at hip)
  const legB = new THREE.Group(), legF = new THREE.Group();
  legB.add(capsule(0.085, 0.44, shadeC(trouser, -0.2), -0.03)); legF.add(capsule(0.09, 0.44, trouser, 0.02));
  const bootB = shapeMesh([[-0.05, -0.44], [0.1, -0.44], [0.1, -0.39], [-0.05, -0.37]], '#2a2a30', -0.02); legB.add(bootB);
  const bootF = shapeMesh([[-0.05, -0.44], [0.11, -0.44], [0.11, -0.39], [-0.05, -0.37]], '#2a2a30', 0.03); legF.add(bootF);
  body.add(legB); body.add(legF);
  // torso group (lean)
  const torso = new THREE.Group(); body.add(torso);
  const armB = new THREE.Group(); armB.position.set(0.0, 0.36, -0.02);
  armB.add(capsule(0.075, 0.32, coatDark, 0)); torso.add(armB);
  // parcel on the back
  const parcel = new THREE.Group(); parcel.position.set(-0.17, 0.22, -0.01);
  parcel.add(shapeMesh([[-0.12, -0.13], [0.1, -0.13], [0.1, 0.13], [-0.12, 0.13]], '#e8d7b2', 0));
  parcel.add(shapeMesh([[-0.12, -0.01], [0.1, -0.01], [0.1, 0.012], [-0.12, 0.012]], '#9a5a44', 0.001));
  parcel.add(shapeMesh([[-0.015, -0.13], [0.012, -0.13], [0.012, 0.13], [-0.015, 0.13]], '#9a5a44', 0.001));
  parcel.add(shapeMesh([[-0.04, 0.12], [0.03, 0.12], [0.0, 0.18]], P.coral, 0.002));
  torso.add(parcel);
  const coatM = shapeMesh([[-0.17, 0.0], [0.17, 0.0], [0.13, 0.4, 0.04, 0.44], [-0.04, 0.44, -0.13, 0.4], [-0.17, 0.0]], coat, 0.01);
  torso.add(coatM);
  const belt = shapeMesh([[-0.16, 0.12], [0.16, 0.12], [0.16, 0.16], [-0.16, 0.16]], '#8a5b3c', 0.012); torso.add(belt);
  // head
  const head = new THREE.Group(); head.position.set(0.02, 0.53, 0.015); torso.add(head);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), mat(skin)); head.add(face);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), mat('#1f2a30')); eye.position.set(0.065, 0.015, 0.003); head.add(eye);
  const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), mat('#e39b84', { opacity: 0.7 })); cheek.position.set(0.055, -0.04, 0.002); head.add(cheek);
  // the hood: a soft cone that flops back, its tip lagging behind motion
  const hoodG = new THREE.Group(); head.add(hoodG);
  const hoodM = shapeMesh([[0.11, 0.0], [0.12, 0.13, 0.0, 0.15], [-0.12, 0.14, -0.15, 0.02], [-0.14, -0.1], [-0.05, -0.05], [-0.02, 0.06, 0.11, 0.0]], hood, 0.004);
  hoodG.add(hoodM);
  const tip = new THREE.Group(); tip.position.set(-0.1, 0.12, 0); hoodG.add(tip);
  const tipM = shapeMesh([[0, -0.06], [0.02, 0.06], [-0.16, 0.12, -0.3, 0.02], [-0.12, 0.0, 0, -0.06]], shadeC(hood, -0.08), 0.003);
  tip.add(tipM);
  const pom = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), mat(P.cloth)); pom.position.set(-0.3, 0.02, 0.004); tip.add(pom);
  const armF = new THREE.Group(); armF.position.set(0.02, 0.36, 0.03);
  armF.add(capsule(0.08, 0.32, coat, 0)); const hand = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), mat(skin)); hand.position.set(0, -0.33, 0.001); armF.add(hand);
  torso.add(armF);
  // umbrella for falls (a coral parasol)
  const umb = new THREE.Group(); umb.position.set(0.02, 0.98, 0.05); umb.visible = false; torso.add(umb);
  umb.add(shapeMesh([[-0.5, 0], [-0.48, 0.25, 0, 0.32], [0.48, 0.25, 0.5, 0], [0.33, 0.05], [0.17, 0], [0, 0.05], [-0.17, 0], [-0.33, 0.05], [-0.5, 0]], P.coral, 0));
  umb.add(shapeMesh([[-0.012, 0.3], [0.012, 0.3], [0.012, -0.45], [-0.012, -0.45]], '#3a3a40', -0.001));

  // scarf: a ribbon simulated as a short chain in world space
  const N = 11;
  const scarfPos = new Float32Array(N * 2 * 3);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(scarfPos, 3));
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  sgeo.setIndex(idx);
  const scarf = new THREE.Mesh(sgeo, mat(scarfC)); scarf.frustumCulled = false;
  const scarfPts = Array.from({ length: N }, () => ({ x: 0, y: 0, px: 0, py: 0 }));

  const c = {
    root, scarf, body, torso, head, hoodG, tip, armF, armB, legF, legB, umb, mats,
    walk: 0, squash: 0, squashV: 0, lean: 0, hangAng: 0, hangAngV: 0, look: 0, scarfLen: 0.09, init: false, flow: 0, fade: 1
  };
  c.dispose = () => { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); sgeo.dispose(); mats.forEach(m => m.dispose()); };

  c.setOpacity = a => { mats.forEach(m => { m.opacity = a * (m.userData.base || 1); }); };
  mats.forEach(m => { m.userData.base = m.opacity; });

  // Pose the puppet from the player state. dt in seconds.
  c.update = (p, dt, t, extra) => {
    const sp = Math.hypot(p.mode === 'ground' ? p.gvx : p.vx, p.mode === 'ground' ? p.gvy : p.vy);
    root.position.set(p.x, p.y, 0.4);
    // squash spring
    c.squashV += (-c.squash * 260 - c.squashV * 18) * dt; c.squash += c.squashV * dt;
    const sq = clamp(c.squash, -0.3, 0.3);
    body.scale.set(1 + sq * 0.5, 1 - sq, 1);
    umb.visible = p.mode === 'fall';
    let armFr = 0.2, armBr = -0.2, legFr = 0, legBr = 0, torsoR = 0, headR = 0;
    if (p.mode === 'ground') {
      if (!p.atLip) {
        c.walk += dt * 11;
        legFr = Math.sin(c.walk) * 0.55; legBr = -legFr;
        armFr = -Math.sin(c.walk) * 0.5; armBr = -armFr;
        body.position.y = 0.44 + Math.abs(Math.cos(c.walk)) * 0.03;
        torsoR = -0.08;
      } else {
        // waiting at the lip: breathe, watch what's coming, tap a foot if it takes a while
        body.position.y = 0.44 + Math.sin(t * 2.4) * 0.006;
        headR = clamp(extra.lookY || 0, -0.5, 0.5) * 0.6;
        if (p.waitT > 2.5) legFr = Math.max(0, Math.sin(t * 9)) * -0.18;
        armFr = 0.12 + Math.sin(t * 2.4) * 0.03; armBr = -0.1;
        torsoR = 0.02 + (extra.ready ? -0.12 : 0);
      }
      c.hangAng *= 0.8;
    } else if (p.mode === 'air') {
      body.position.y = 0.44;
      const rise = clamp(p.vy / 9, -1, 1);
      legFr = -0.7 + rise * 0.3; legBr = 0.45;
      if (p.held) { armFr = Math.PI * 0.92; armBr = Math.PI * 0.8; } else { armFr = 1.4 - rise * 0.5; armBr = -1.0; }
      torsoR = clamp(-p.vx * 0.025, -0.25, 0.25) + rise * 0.05;
      headR = rise * 0.2;
      c.hangAng *= 0.9;
    } else if (p.mode === 'hang') {
      // the body trails the ring like a pendulum
      const target = clamp(-p.hvx * 0.09, -0.8, 0.8);
      c.hangAngV += ((target - c.hangAng) * 60 - c.hangAngV * 7) * dt; c.hangAng += c.hangAngV * dt;
      armFr = Math.PI - c.hangAng * 0.2; armBr = Math.PI - 0.1 - c.hangAng * 0.2;
      legFr = 0.25 + c.hangAng * 0.4 + Math.sin(t * 4) * 0.05; legBr = -0.1 + c.hangAng * 0.3;
      body.position.y = 0.44;
    } else if (p.mode === 'fall') {
      armFr = Math.PI * 0.95; armBr = Math.PI * 0.85; legFr = 0.15 + Math.sin(t * 3) * 0.2; legBr = -0.15;
      torsoR = Math.sin(t * 2.2) * 0.12;
    } else if (p.mode === 'deliver') {
      armFr = 1.3 + Math.sin(t * 6) * 0.2; torsoR = 0.15; headR = -0.1;
    }
    const k = 1 - Math.exp(-dt * 18);
    c.legF.rotation.z += (legFr - c.legF.rotation.z) * k;
    c.legB.rotation.z += (legBr - c.legB.rotation.z) * k;
    c.armF.rotation.z += (armFr - c.armF.rotation.z) * k;
    c.armB.rotation.z += (armBr - c.armB.rotation.z) * k;
    c.torso.rotation.z += (torsoR - c.torso.rotation.z) * k;
    c.head.rotation.z += (headR - c.head.rotation.z) * k;
    // whole body tilt while hanging (pivot at the hands)
    if (p.mode === 'hang') { root.rotation.z = c.hangAng; root.position.x = p.x + Math.sin(c.hangAng) * 1.0; root.position.y = p.y + 1.0 - Math.cos(c.hangAng) * 1.0; }
    else root.rotation.z = 0;
    // hood tip lags behind speed
    const hv = p.mode === 'ground' ? p.gvx + (p.atLip ? 0 : PHYS.WALK) : p.mode === 'hang' ? p.hvx : p.vx;
    c.tip.rotation.z += (clamp(-0.15 + hv * 0.05 + (p.mode === 'air' ? -p.vy * 0.03 : 0), -0.6, 0.7) - c.tip.rotation.z) * k;

    // scarf
    root.updateMatrixWorld(true);
    const nk = new THREE.Vector3(-0.04, 0.45, 0); c.torso.localToWorld(nk);
    const flow = extra.flow || 0;
    const seg = 0.075 + 0.06 * flow;
    const pts = scarfPts;
    if (!c.init) { pts.forEach((q, i) => { q.x = q.px = nk.x - i * seg; q.y = q.py = nk.y; }); c.init = true; }
    pts[0].x = nk.x; pts[0].y = nk.y;
    const wind = Math.sin(t * 3.1) * 0.6 + Math.sin(t * 7.3) * 0.3;
    for (let i = 1; i < N; i++) {
      const q = pts[i];
      const vx = (q.x - q.px) * 0.94, vy = (q.y - q.py) * 0.94;
      q.px = q.x; q.py = q.y;
      q.x += vx; q.y += vy - 1.4 * dt * dt * (1 - Math.min(0.9, sp * 0.08)) + wind * dt * dt * 2 * (i / N);
    }
    for (let it = 0; it < 3; it++) for (let i = 1; i < N; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
      const f = (d - seg) / d;
      if (i === 1) { b.x -= dx * f; b.y -= dy * f; } else { a.x += dx * f * 0.5; a.y += dy * f * 0.5; b.x -= dx * f * 0.5; b.y -= dy * f * 0.5; }
    }
    const pos = scarfPos;
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const w = lerp(0.055, 0.025, i / (N - 1));
      pos[i * 6] = pts[i].x - ty * w; pos[i * 6 + 1] = pts[i].y + tx * w; pos[i * 6 + 2] = 0.39;
      pos[i * 6 + 3] = pts[i].x + ty * w; pos[i * 6 + 4] = pts[i].y - tx * w; pos[i * 6 + 5] = 0.39;
    }
    sgeo.attributes.position.needsUpdate = true;
  };
  c.resetScarf = () => { c.init = false; };
  return c;
}

// ---- particles: dust, splashes, puffs, sparkles --------------------------------
function buildParticles(stage, n) {
  const { THREE } = stage;
  const tex = new THREE.CanvasTexture(paintSoftDot('#ffffff'));
  const geo = new THREE.PlaneGeometry(1, 1);
  const pool = [];
  const group = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    m.visible = false; m.position.z = 0.5; group.add(m);
    pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, g: 0, s0: 0.2, s1: 0.5, a: 1 });
  }
  let next = 0;
  const api = {
    group,
    emit(x, y, o) {
      const k = o.count || 1;
      for (let i = 0; i < k; i++) {
        const q = pool[next]; next = (next + 1) % n;
        const ang = (o.angle == null ? Math.PI / 2 : o.angle) + (Math.random() - 0.5) * (o.spread == null ? Math.PI : o.spread);
        const spd = (o.speed || 1) * (0.5 + Math.random() * 0.8);
        q.vx = Math.cos(ang) * spd + (o.vx || 0); q.vy = Math.sin(ang) * spd + (o.vy || 0);
        q.life = 0; q.max = (o.life || 0.6) * (0.7 + Math.random() * 0.6);
        q.g = o.gravity || 0; q.s0 = o.size || 0.2; q.s1 = o.grow || q.s0 * 2.5; q.a = o.alpha || 0.7;
        q.m.material.color.set(o.color || '#ffffff');
        q.m.position.set(x + (Math.random() - 0.5) * (o.jx || 0), y + (Math.random() - 0.5) * (o.jy || 0), o.z || 0.5);
        q.m.visible = true;
      }
    },
    update(dt) {
      for (const q of pool) {
        if (!q.m.visible) continue;
        q.life += dt;
        if (q.life >= q.max) { q.m.visible = false; continue; }
        const f = q.life / q.max;
        q.vy -= q.g * dt; q.vx *= 0.96; q.vy *= 0.96;
        q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt;
        q.m.scale.setScalar(lerp(q.s0, q.s1, f));
        q.m.material.opacity = q.a * (1 - f) * Math.min(1, f * 8);
      }
    },
    clear() { pool.forEach(q => { q.m.visible = false; }); },
    dispose() { tex.dispose(); geo.dispose(); pool.forEach(q => q.m.material.dispose()); }
  };
  return api;
}

// ---- 09_audio.js ----
// ---------------------------------------------------------------------------
// Sound. The world has an acoustic identity: every mechanism has its own voice
// (the lift's little arrival bell, the bellows' long inhale and its puff, the
// skiff knocking against its mooring, a wheel's gondolas ticking past), each on
// its own cycle, so the world sounds like a place, never like a metronome.
// Underneath, an unquantised score drifts through slow chords; when the
// courier keeps moving without waiting, it opens up and gains small voices.
// ---------------------------------------------------------------------------

const MODES = [
  [62, [0, 2, 4, 6, 7, 9, 11]],   // D lydian, morning
  [55, [0, 2, 4, 7, 9]],          // G major pentatonic, noon
  [57, [0, 2, 3, 5, 7, 9, 10]],   // A dorian, afternoon
  [53, [0, 2, 4, 6, 7, 9, 10]]    // F lydian-dominant, dusk
];
const CHORDS = [[0, 2, 4], [3, 5, 0], [4, 6, 1], [5, 0, 2], [1, 3, 5]];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function createAudio() {
  let ac = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null, verb = null;
  let muted = false, region = 0, flow = 0, chordI = 0, nextChord = 0, nextPluck = 0, pads = [], windG = null, windF = null, started = false;
  const A = {};

  A.ensure = () => {
    if (ac) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
    } catch (e) { ac = null; return false; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    // a cheap reverb: feedback delays
    verb = ac.createGain(); verb.gain.value = 0.25;
    const d1 = ac.createDelay(1), d2 = ac.createDelay(1), fb = ac.createGain(), lp = ac.createBiquadFilter();
    d1.delayTime.value = 0.137; d2.delayTime.value = 0.211; fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 2400;
    verb.connect(d1); d1.connect(d2); d2.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return true;
  };

  A.unlock = () => {
    if (!A.ensure()) return;
    if (ac.state !== 'running') ac.resume().catch(() => {});
    if (!started) { started = true; startBed(); }
  };
  A.suspend = () => { if (ac && ac.state === 'running') ac.suspend().catch(() => {}); };
  A.resume = () => { if (ac && ac.state !== 'running' && started) ac.resume().catch(() => {}); };
  A.setMuted = m => { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); };
  A.isMuted = () => muted;
  A.setRegion = r => { region = r; chordI = 0; nextChord = 0; };
  A.setFlow = f => { flow = f; };
  A.dispose = () => { try { if (ac) ac.close(); } catch (e) { /* closing a context can throw if already closed */ } ac = null; };

  function now() { return ac.currentTime; }
  function out(pan, wet) {
    const g = ac.createGain();
    let node = g;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan || 0, -1, 1); g.connect(p); node = p; }
    node.connect(sfxBus);
    if (wet) { const w = ac.createGain(); w.gain.value = wet; node.connect(w); w.connect(verb); }
    return g;
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, type, freq, q, peak, pan, a, wet, sweepTo) {
    a = a || 0.005;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = out(pan, wet);
    const gg = ac.createGain(); s.connect(f); f.connect(gg); gg.connect(g);
    env(gg, t, a || 0.005, peak, dur);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + a + 0.05);
  }
  function tone(t, freq, dur, type, peak, pan, a, wet, bend) {
    a = a || 0.004;
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    const g = out(pan, wet); const gg = ac.createGain(); o.connect(gg); gg.connect(g);
    env(gg, t, a || 0.004, peak, dur);
    o.start(t); o.stop(t + dur + (a || 0) + 0.05);
  }
  function scaleNote(deg, oct) {
    const [root, sc] = MODES[region];
    const n = sc.length;
    const o = Math.floor(deg / n);
    return root + 12 * (oct + o) + sc[((deg % n) + n) % n];
  }

  // ---- the bed ----------------------------------------------------------
  function startBed() {
    // wind
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 500; windF.Q.value = 0.6;
    windG = ac.createGain(); windG.gain.value = 0.035;
    s.connect(windF); windF.connect(windG); windG.connect(master); s.start();
    // three pad voices
    for (let i = 0; i < 3; i++) {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'triangle'; o2.type = 'sine'; o2.detune.value = 7 + i * 3;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.4;
      const g = ac.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
      const w = ac.createGain(); w.gain.value = 0.35; g.connect(w); w.connect(verb);
      o1.start(); o2.start();
      pads.push({ o1, o2, f, g });
    }
  }

  A.tick = (dt, camInfo) => {
    if (!ac || !started || ac.state !== 'running') return;
    const t = now();
    if (windG) {
      windG.gain.setTargetAtTime(0.025 + 0.02 * Math.sin(t * 0.23) + (camInfo && camInfo.high ? 0.02 : 0), t, 0.5);
      windF.frequency.setTargetAtTime(380 + 260 * Math.sin(t * 0.17) + 200 * flow, t, 0.6);
    }
    if (t >= nextChord) {
      const ch = CHORDS[chordI % CHORDS.length]; chordI += 1 + (Math.random() < 0.3 ? 1 : 0);
      const dur = 7 + Math.random() * 5;
      pads.forEach((v, i) => {
        const f = mtof(scaleNote(ch[i] + (i === 0 ? -7 : 0), i === 0 ? -1 : 0));
        v.o1.frequency.setTargetAtTime(f, t, 1.2); v.o2.frequency.setTargetAtTime(f * (i === 2 ? 2 : 1), t, 1.2);
        v.g.gain.setTargetAtTime(0.09 - i * 0.015, t, 1.5);
      });
      nextChord = t + dur;
    }
    pads.forEach(v => v.f.frequency.setTargetAtTime(520 + flow * 1400, t, 0.8));
    musicBus.gain.setTargetAtTime(0.26 + flow * 0.12, t, 1.0);
    // small glassy plucks, sparse, more of them when the passage flows
    if (t >= nextPluck) {
      const deg = Math.floor(Math.random() * 8);
      const f = mtof(scaleNote(deg, 1));
      tone(t, f, 1.6, 'sine', 0.03 + flow * 0.035, (Math.random() - 0.5) * 0.8, 0.005, 0.6);
      tone(t, f * 3.01, 0.5, 'sine', 0.008, 0, 0.003, 0.5);
      nextPluck = t + (flow > 0.4 ? 0.6 + Math.random() * 1.6 : 2.5 + Math.random() * 5);
    }
  };

  // ---- sound effects ------------------------------------------------------
  // pan: -1..1, vol: 0..1 (distance attenuation applied by the caller)
  A.play = (name, o) => {
    if (!ac || ac.state !== 'running' || muted) return;
    o = o || {};
    const t = now() + 0.005, pan = o.pan || 0, v = o.vol == null ? 1 : o.vol;
    if (v < 0.03) return;
    switch (name) {
      case 'jump': noise(t, 0.16, 'bandpass', 900, 1.2, 0.12 * v, pan, 0.01, 0, 2400); break;
      case 'step': noise(t, 0.04, 'lowpass', 900, 0.7, 0.05 * v, pan, 0.002); break;
      case 'land': {
        const m = o.mat, k = clamp((o.impact || 4) / 10, 0.3, 1.2) * v;
        if (m === 'wood' || m === 'goal') { noise(t, 0.09, 'lowpass', 700, 1, 0.22 * k, pan); tone(t, mtof(scaleNote(o.deg || 0, -1)), 0.22, 'sine', 0.12 * k, pan, 0.002, 0.2); }
        else if (m === 'metal') { noise(t, 0.05, 'highpass', 2000, 1, 0.08 * k, pan); tone(t, 620, 0.5, 'sine', 0.05 * k, pan, 0.002, 0.4); tone(t, 1490, 0.35, 'sine', 0.025 * k, pan, 0.002, 0.4); }
        else if (m === 'cloth') { noise(t, 0.14, 'lowpass', 350, 0.8, 0.25 * k, pan); }
        else if (m === 'creature') { noise(t, 0.12, 'lowpass', 420, 1, 0.2 * k, pan); tone(t, 110, 0.3, 'sine', 0.08 * k, pan, 0.01, 0, 0.8); }
        else { noise(t, 0.06, 'lowpass', 1300, 0.9, 0.2 * k, pan); tone(t, 140, 0.08, 'sine', 0.06 * k, pan); }
        break;
      }
      case 'grab': tone(t, 1760, 0.18, 'sine', 0.06 * v, pan, 0.002, 0.3); tone(t, 2637, 0.12, 'sine', 0.03 * v, pan, 0.002, 0.3); noise(t, 0.18, 'bandpass', 300, 4, 0.05 * v, pan, 0.02); break;
      case 'release': noise(t, 0.22, 'bandpass', 700, 1, 0.1 * v, pan, 0.02, 0, 1800); break;
      case 'letter': {
        const base = scaleNote(4, 1);
        [0, 2, 4, 7].forEach((d, i) => tone(t + i * 0.09, mtof(scaleNote(4 + d, 1)), 1.2, 'sine', 0.07 * v, pan, 0.004, 0.7));
        void base; break;
      }
      case 'fall': tone(t, 900, 0.7, 'sine', 0.05 * v, pan, 0.02, 0.2, 0.5); noise(t + 0.25, 0.25, 'lowpass', 500, 1, 0.12 * v, pan, 0.01); break;
      case 'umbrella': noise(t, 0.12, 'bandpass', 1200, 2, 0.12 * v, pan, 0.005); break;
      case 'deliver': {
        [0, 2, 4, 7, 9].forEach((d, i) => tone(t + i * 0.12, mtof(scaleNote(d, 0)), 2.6, 'triangle', 0.05 * v, (i - 2) * 0.2, 0.01, 0.8));
        tone(t + 0.7, mtof(scaleNote(0, 2)), 3, 'sine', 0.05 * v, 0, 0.004, 0.9);
        break;
      }
      // the world's own voices
      case 'dock': noise(t, 0.08, 'lowpass', 500, 1.5, 0.16 * v, pan); tone(t, 95, 0.18, 'sine', 0.1 * v, pan); break;
      case 'liftBell': tone(t, mtof(scaleNote(o.deg || 4, 1)), 1.4, 'sine', 0.06 * v, pan, 0.002, 0.6); tone(t, mtof(scaleNote(o.deg || 4, 1)) * 2.76, 0.6, 'sine', 0.015 * v, pan, 0.002, 0.5); break;
      case 'ratchet': noise(t, 0.025, 'highpass', 2600, 2, 0.04 * v, pan); break;
      case 'inhale': noise(t, o.dur || 2, 'lowpass', 300, 0.7, 0.06 * v, pan, (o.dur || 2) * 0.7, 0, 900); break;
      case 'puff': noise(t, 0.35, 'lowpass', 900, 0.8, 0.35 * v, pan, 0.004, 0.2, 200); tone(t, 70, 0.3, 'sine', 0.2 * v, pan, 0.004, 0, 0.6); break;
      case 'tok': tone(t, mtof(scaleNote(o.deg || 0, 0)), 0.12, 'triangle', 0.05 * v, pan, 0.002, 0.3); noise(t, 0.03, 'bandpass', 1800, 3, 0.04 * v, pan); break;
      case 'swoosh': noise(t, 0.4, 'bandpass', 400, 1.5, 0.05 * v, pan, 0.15, 0.1, 800); break;
      case 'trolley': noise(t, 0.05, 'bandpass', 3000, 4, 0.06 * v, pan); tone(t, 1320, 0.25, 'sine', 0.02 * v, pan, 0.002, 0.3); break;
      case 'stride': noise(t, 0.12, 'lowpass', 180, 1, 0.2 * v, pan, 0.01); break;
      case 'call': tone(t, 180 + Math.random() * 40, 0.9, 'sine', 0.05 * v, pan, 0.15, 0.6, 0.75); break;
      case 'ui': tone(t, 1320, 0.08, 'sine', 0.04 * v, 0, 0.002); break;
      default: break;
    }
  };
  return A;
}

// ---- 10_ui.js ----
// ---------------------------------------------------------------------------
// Interface: field notes, a postal ledger, a receipt. Small serif titles,
// tracked small-caps labels, paper and ink. The world stays the main thing.
// ---------------------------------------------------------------------------

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function fmtTime(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const UI_CSS = `
.ip{position:absolute;inset:0;pointer-events:none;font-family:'Inter',system-ui,sans-serif;color:#22403f;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.ip *{box-sizing:border-box}
.ip .serif{font-family:'Cormorant Garamond',Georgia,serif}
.ip .lbl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.72}
.ip button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}
.ip .safe{position:absolute;left:0;right:0;top:0;bottom:0;padding:0 18px}
.ip .fade{transition:opacity .45s ease, transform .45s ease}
.ip .hidden{opacity:0;pointer-events:none!important}
.ip .hidden *{pointer-events:none!important}
.ip .shadowtxt{text-shadow:0 1px 0 rgba(255,250,238,.65),0 0 14px rgba(255,248,232,.7)}
.ip .icon{width:40px;height:40px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:rgba(245,237,219,.84);box-shadow:0 1px 0 rgba(34,64,63,.12)}
.ip .icon svg{width:20px;height:20px;stroke:#22403f;fill:none;stroke-width:1.6;stroke-linecap:round}
/* menu */
.ip .title{position:absolute;left:18px;right:70px}
.ip .topveil{position:absolute;left:0;right:0;top:0;height:300px;background:linear-gradient(rgba(245,237,219,.78),rgba(245,237,219,.45) 55%,rgba(245,237,219,0));pointer-events:none}
.ip .title h1{margin:0;font-weight:300;font-style:italic;font-size:46px;line-height:.95;letter-spacing:-.01em}
.ip .title p{margin:8px 0 0;font-size:12px;line-height:1.45;max-width:260px;opacity:.8}
.ip .ledger{position:absolute;left:14px;right:14px;background:#f5eddb;border-radius:3px;padding:14px 16px 14px;box-shadow:0 10px 30px rgba(40,50,48,.18),0 1px 0 rgba(34,64,63,.15);pointer-events:auto}
.ip .ledger:before{content:'';position:absolute;inset:5px;border:1px solid rgba(34,64,63,.14);border-radius:2px;pointer-events:none}
.ip .tabs{display:flex;gap:18px;margin-bottom:10px}
.ip .tab{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.45;padding:6px 0}
.ip .tab.on{opacity:1;border-bottom:1.5px solid #d9785f}
.ip .sel{display:flex;align-items:center;gap:8px}
.ip .arrow{width:40px;height:52px;display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.7}
.ip .arrow[disabled]{opacity:.15}
.ip .routeinfo{flex:1;min-width:0;text-align:center}
.ip .num{font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:300;line-height:1}
.ip .region{margin-top:4px}
.ip .to{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ip .stamps{display:flex;justify-content:center;gap:10px;margin:12px 0 4px}
.ip .stamp{width:54px;height:40px;border:1.5px dashed rgba(34,64,63,.3);border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;opacity:.5}
.ip .stamp b{font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;letter-spacing:0;font-weight:400;text-transform:none}
.ip .stamp.got{opacity:1;border-color:#d9785f;color:#b55a44;background:rgba(217,120,95,.08);transform:rotate(-3deg)}
.ip .best{text-align:center;font-size:11px;opacity:.7;margin-top:6px;min-height:14px}
.ip .go{display:block;text-align:center;margin-top:10px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;animation:ipbreath 2.6s ease-in-out infinite}
@keyframes ipbreath{0%,100%{opacity:.55}50%{opacity:1}}
.ip .sealed{color:#b55a44}
/* hud */
.ip .hud{position:absolute;left:14px;max-width:calc(100% - 120px);background:rgba(245,237,219,.84);border-radius:3px;padding:8px 12px 9px;box-shadow:0 1px 0 rgba(34,64,63,.14)}
.ip .hud .rt{font-size:10px}
.ip .hud .rto{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ip .journey{margin-top:8px;display:flex;align-items:center;gap:10px}
.ip .journey svg{overflow:visible}
.ip .env{display:flex;gap:4px}
.ip .env i{display:block;width:13px;height:9px;border:1.3px solid rgba(34,64,63,.55);border-radius:1px;position:relative}
.ip .env i:after{content:'';position:absolute;left:1px;right:1px;top:0;height:5px;border-bottom:1.2px solid rgba(34,64,63,.5);transform:skewY(0);clip-path:polygon(0 0,50% 100%,100% 0)}
.ip .env i.got{background:#e4b84e;border-color:#9a7a2a}
.ip .topright{position:absolute;right:14px;display:flex;gap:8px}
/* hint */
.ip .hint{position:absolute;transform:translate(-50%,-100%);font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;white-space:nowrap;padding:3px 10px;background:rgba(245,237,219,.78);border-radius:2px;box-shadow:0 1px 0 rgba(34,64,63,.15)}
/* cards */
.ip .veil{position:absolute;inset:0;background:rgba(238,228,207,.35);pointer-events:auto}
.ip .card{position:absolute;left:50%;width:min(330px,calc(100% - 32px));transform:translate(-50%,0);background:#f5eddb;border-radius:3px;padding:20px 20px 16px;box-shadow:0 14px 40px rgba(40,50,48,.25);pointer-events:auto}
.ip .card:before{content:'';position:absolute;inset:6px;border:1px solid rgba(34,64,63,.14);pointer-events:none}
.ip .card h2{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-style:italic;font-size:36px;line-height:1}
.ip .btns{display:flex;flex-direction:column;gap:2px;margin-top:14px}
.ip .btn{display:flex;align-items:center;justify-content:space-between;min-height:46px;padding:0 4px;border-top:1px solid rgba(34,64,63,.12);font-size:15px}
.ip .btn:after{content:'→';opacity:.4}
.ip .btn.primary{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-style:italic}
.ip .btn.primary:after{color:#d9785f;opacity:1}
.ip .rows{margin-top:14px}
.ip .row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px dotted rgba(34,64,63,.18);font-size:13px}
.ip .row span:last-child{font-variant-numeric:tabular-nums}
.ip .bigtime{font-family:'Cormorant Garamond',Georgia,serif;font-size:54px;font-weight:300;line-height:1;margin-top:10px}
.ip .delivered{position:absolute;right:18px;top:14px;transform:rotate(9deg);border:2px solid #c9634c;color:#c9634c;border-radius:50%;width:84px;height:84px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;line-height:1.3;opacity:.85}
.ip .delivered.brisk{border-style:double;border-width:4px}
.ip .board{margin-top:10px;font-size:12px}
.ip .board .row{font-size:12px}
.ip .note{font-size:11px;opacity:.6;margin-top:6px}
@media (min-aspect-ratio: 5/4){.ip .ledger{left:auto;right:66px;width:330px}.ip .title h1{font-size:40px}.ip .card{left:auto;right:16px;transform:none}.ip .topveil{right:50%}}
.ip .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#eee4cf}
.ip .loading h1{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-style:italic;font-size:44px}
.ip .loading p{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;margin-top:12px}
`;

const ICONS = {
  pause: '<svg viewBox="0 0 20 20"><path d="M7 5v10M13 5v10"/></svg>',
  sound: '<svg viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="M14 7.5c1 1.4 1 3.6 0 5"/></svg>',
  mute: '<svg viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="M14 8l3 4M17 8l-3 4"/></svg>'
};

function createUI(ctx, h) {
  const root = ctx.createRoot({ className: 'ip', layer: 'overlay', input: 'passthrough' });
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  root.appendChild(style);
  const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; root.appendChild(d); return d; };

  const loading = el('loading', '<h1>In Passing</h1><p>painting the world</p>');
  const menu = el('safe fade hidden');
  menu.innerHTML = `
    <div class="topveil"></div>
    <div class="title shadowtxt"><h1>In Passing</h1><p>A courier's errands through a world that never stops moving. You don't make anything move. You know when to get on.</p></div>
    <div class="ledger">
      <div class="tabs"><button class="tab on" data-a="journey">Journey</button><button class="tab" data-a="daily">Today's errand</button></div>
      <div class="sel">
        <button class="arrow" data-a="prev" aria-label="Previous route">‹</button>
        <div class="routeinfo"><div class="num"></div><div class="lbl region"></div><div class="to"></div></div>
        <button class="arrow" data-a="next" aria-label="Next route">›</button>
      </div>
      <div class="stamps"></div>
      <div class="best"></div>
      <button class="go" data-a="start">touch the world to set off</button>
    </div>`;
  const hud = el('safe fade hidden');
  hud.innerHTML = `<div class="hud"><div class="lbl rt"></div><div class="rto"></div>
    <div class="journey"><svg width="132" height="14" viewBox="0 0 132 14"><path class="jl" d="M2 7 Q 33 3 66 7 T 124 7" stroke="#22403f" stroke-opacity=".35" stroke-width="1.2" fill="none" stroke-dasharray="2 3"/><path class="jd" d="M2 7 Q 33 3 66 7 T 124 7" stroke="#22403f" stroke-width="1.6" fill="none"/><g class="house"><path d="M121 3 l4 -3 l4 3 v5 h-8z" fill="#f5eddb" stroke="#22403f" stroke-width="1"/><path d="M122 8 l-1.5 5 M128 8 l1.5 5" stroke="#22403f" stroke-width="1"/></g><circle class="me" cx="2" cy="7" r="3.2" fill="#d9785f" stroke="#f5eddb" stroke-width="1"/></svg><div class="env"></div></div></div>`;
  const topright = el('topright');
  topright.innerHTML = `<button class="icon" data-a="sound" aria-label="Sound">${ICONS.sound}</button><button class="icon" data-a="pause" aria-label="Pause">${ICONS.pause}</button>`;
  const hint = el('hint hidden fade');
  const pauseVeil = el('veil hidden fade');
  const pauseCard = el('card hidden fade');
  pauseCard.innerHTML = `<h2>A pause.</h2><div class="note">The world waits for you, just this once.</div><div class="btns"><button class="btn primary" data-a="resume">Carry on</button><button class="btn" data-a="restart">Start the route again</button><button class="btn" data-a="ledger">Back to the ledger</button></div>`;
  const resVeil = el('veil hidden fade');
  const resCard = el('card hidden fade');

  const jd = hud.querySelector('.jd'), me = hud.querySelector('.me'), jl = hud.querySelector('.jl');
  let jlLen = 0;

  // all buttons by delegation
  ctx.listen(root, 'click', e => {
    const b = e.target.closest && e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    const a = b.getAttribute('data-a');
    if (h[a]) h[a](b);
  });

  const show = (n, on) => { n.classList.toggle('hidden', !on); };
  const ui = {};
  ui.layout = area => {
    const top = area.top + 12, bottom = area.bottom + 10;
    menu.querySelector('.title').style.top = (top + 4) + 'px';
    menu.querySelector('.ledger').style.bottom = bottom + 'px';
    hud.querySelector('.hud').style.top = (top + 4) + 'px';
    topright.style.top = (top) + 'px';
    pauseCard.style.top = Math.max(top + 40, 0.28 * ctx.height) + 'px';
    resCard.style.top = Math.max(top + 30, 0.16 * ctx.height) + 'px';
  };
  ui.loaded = () => { loading.style.transition = 'opacity .6s'; loading.style.opacity = '0'; ctx.timeout(() => { loading.style.display = 'none'; }, 650); };
  ui.loadError = msg => { loading.querySelector('p').textContent = msg; };
  ui.setMuted = m => { topright.querySelector('[data-a=sound]').innerHTML = m ? ICONS.mute : ICONS.sound; };

  ui.showMenu = s => {
    show(menu, true); show(hud, false);
    topright.querySelector('[data-a=pause]').style.display = 'none';
    if (s && s.index != null) ui.menuState(s);
  };
  ui.menuState = s => {
    const tabs = menu.querySelectorAll('.tab');
    tabs[0].classList.toggle('on', !s.daily); tabs[1].classList.toggle('on', s.daily);
    const prev = menu.querySelector('[data-a=prev]'), next = menu.querySelector('[data-a=next]');
    prev.style.visibility = next.style.visibility = s.daily ? 'hidden' : 'visible';
    prev.disabled = s.index <= 0; next.disabled = s.index >= 11;
    const num = menu.querySelector('.num'), region = menu.querySelector('.region'), to = menu.querySelector('.to');
    const stamps = menu.querySelector('.stamps'), best = menu.querySelector('.best'), go = menu.querySelector('.go');
    if (s.daily) {
      num.textContent = s.dateLabel; region.textContent = 'Today’s errand';
      to.textContent = 'one route for everyone, today';
      stamps.innerHTML = '';
      best.textContent = s.dailyBest != null ? 'your best today ' + fmtTime(s.dailyBest) : (s.preparing ? 'the errand is being written…' : 'no delivery yet today');
      go.textContent = s.preparing ? 'one moment…' : 'touch the world to set off';
      go.classList.remove('sealed');
    } else {
      const r = s.route;
      num.textContent = NUMERALS[s.index];
      region.textContent = REGIONS[ROUTES[s.index].region].name;
      to.textContent = 'to ' + ROUTES[s.index].to;
      const rec = s.rec || {};
      const letters = s.letterCount || 0;
      const lc = rec.letters ? rec.letters.filter(Boolean).length : 0;
      stamps.innerHTML = `<div class="stamp ${rec.best != null ? 'got' : ''}"><b>✓</b>delivered</div><div class="stamp ${rec.brisk ? 'got' : ''}"><b>↗</b>brisk</div>` +
        (letters ? `<div class="stamp ${lc >= letters ? 'got' : ''}"><b>${lc}/${letters}</b>letters</div>` : '');
      if (s.locked) { best.textContent = 'sealed — deliver route ' + NUMERALS[s.index - 1] + ' first'; go.textContent = 'not yet'; go.classList.add('sealed'); }
      else { best.textContent = rec.best != null ? 'best ' + fmtTime(rec.best) + '  ·  brisk under ' + fmtTime(r.brisk * 1000) : 'brisk under ' + fmtTime(r.brisk * 1000); go.textContent = 'touch the world to set off'; go.classList.remove('sealed'); }
    }
  };
  ui.hideMenu = () => { show(menu, false); };

  ui.showHUD = (spec, letterCount) => {
    show(hud, true);
    topright.querySelector('[data-a=pause]').style.display = '';
    hud.querySelector('.rt').textContent = spec.daily ? 'Today’s errand' : NUMERALS[spec.index] + '  ·  ' + REGIONS[spec.region].name;
    hud.querySelector('.rto').textContent = 'to ' + spec.to;
    const env = hud.querySelector('.env');
    env.innerHTML = '';
    for (let i = 0; i < letterCount; i++) env.appendChild(document.createElement('i'));
    jlLen = jl.getTotalLength ? jl.getTotalLength() : 124;
    jd.style.strokeDasharray = jlLen + ' ' + jlLen;
    ui.progress(0);
  };
  ui.progress = f => {
    f = clamp(f, 0, 1);
    jd.style.strokeDashoffset = String(jlLen * (1 - f));
    if (jl.getPointAtLength) { const pt = jl.getPointAtLength(jlLen * f); me.setAttribute('cx', pt.x); me.setAttribute('cy', pt.y); }
  };
  ui.letter = i => { const e = hud.querySelectorAll('.env i')[i]; if (e) e.classList.add('got'); };
  ui.hideHUD = () => show(hud, false);

  ui.hint = (text, x, y) => {
    if (!text) { show(hint, false); return; }
    hint.textContent = text; hint.style.left = clamp(x, 90, ctx.width - 90) + 'px'; hint.style.top = Math.max(80, y) + 'px';
    show(hint, true);
  };

  ui.showPause = on => { show(pauseVeil, on); show(pauseCard, on); };

  ui.showResults = d => {
    const lettersHtml = d.letterCount ? `<div class="row"><span>Lost letters found</span><span>${d.letters} of ${d.letterCount}</span></div>` : '';
    resCard.innerHTML = `
      <div class="delivered ${d.brisk ? 'brisk' : ''}">${d.brisk ? 'Brisk<br>post' : 'De&shy;livered'}</div>
      <div class="lbl">${esc(d.label)}</div>
      <h2 style="margin-top:6px">Delivered.</h2>
      <div class="note serif" style="font-size:15px;font-style:italic;opacity:.8">to ${esc(d.to)}</div>
      <div class="bigtime">${fmtTime(d.ms)}</div>
      <div class="rows">
        ${d.best != null ? `<div class="row"><span>${d.newBest ? 'A new best' : 'Your best'}</span><span>${fmtTime(d.best)}</span></div>` : ''}
        ${d.briskMs ? `<div class="row"><span>Brisk post</span><span>under ${fmtTime(d.briskMs)}</span></div>` : ''}
        ${lettersHtml}
        <div class="row"><span>Longest passage without waiting</span><span>${d.passage} ${d.passage === 1 ? 'ride' : 'rides'}</span></div>
        <div class="row"><span>Spent waiting</span><span>${(d.waited / 1000).toFixed(1)}s</span></div>
        ${d.falls ? `<div class="row"><span>Umbrella landings</span><span>${d.falls}</span></div>` : ''}
      </div>
      <div class="board"></div>
      <div class="btns">
        <button class="btn primary" data-a="again">Run it again</button>
        ${d.nextOk ? '<button class="btn" data-a="nextRoute">The next route</button>' : ''}
        <button class="btn" data-a="ledger">Back to the ledger</button>
      </div>`;
    show(resVeil, true); show(resCard, true);
    show(hud, false);
  };
  ui.board = (state) => {
    const b = resCard.querySelector('.board');
    if (!b) return;
    if (!state) { b.innerHTML = ''; return; }
    if (state.loading) { b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div><div class="note">posting your time…</div>'; return; }
    if (state.error) { b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div><div class="note">The board couldn’t be reached just now. Your run still counts here.</div>'; return; }
    const rows = (state.rows || []).slice(0, 3).map(r => `<div class="row"><span>${r.rank}. ${esc(r.name || 'a courier')}</span><span>${fmtTime(r.value)}</span></div>`).join('');
    const mine = state.rank ? `<div class="note">You are ${state.rank}${state.total ? ' of ' + state.total : ''} today.</div>` : '';
    b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div>' + (rows || '<div class="note">No times yet today.</div>') + mine;
  };
  ui.hideResults = () => { show(resVeil, false); show(resCard, false); };
  return ui;
}

// ---- 11_game.js ----
// ---------------------------------------------------------------------------
// The game: menu (the ledger), the run, the fall, the delivery, the receipt.
// ---------------------------------------------------------------------------

const BIT = {
  meta: {
    title: 'In Passing',
    runtime: 'plethora-bit@2',
    tags: ['arcade', 'platformer', 'timing', 'atmospheric'],
    permissions: ['audio', 'haptics', 'storage']
  },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });
    const areaNow = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
    const todayKey = () => new Date().toISOString().slice(0, 10);
    const haptic = k => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) { /* haptics are best-effort */ } };
    const storeGet = k => { try { return ctx.storage ? ctx.storage.get(k) : null; } catch (e) { return null; } };
    const storeSet = (k, v) => { try { if (ctx.storage) ctx.storage.set(k, v); } catch (e) { /* device cache only */ } };

    const audio = createAudio();
    ctx.onDestroy(() => audio.dispose());

    // ---- state -----------------------------------------------------------------
    const S = {
      mode: 'loading', index: 0, daily: false, W: null, view: null, spec: null, p: null, t: 0, runT: 0,
      held: false, pressed: false, pointers: new Set(), flow: 0, passage: 0, bestPassage: 0, waited: 0, falls: 0,
      letters: [], fallT: 0, deliverT: 0, region: 0, pending: null, attempt: 0, cam: { x: 0, y: 0, vx: 0, vy: 0, init: false },
      hint: null, hintsSeen: Object.assign({}, storeGet('hints') || {}), everJumped: false, everGrabbed: false, lastFrame: 0, prevMode: 'play'
    };
    const ledgerDefault = () => ({ v: 1, unlocked: 0, r: {}, daily: null });
    let ledger = ledgerDefault();
    let cloudOk = false;      // only write cloud memory after a successful read
    let saveChain = Promise.resolve();

    // ---- UI ---------------------------------------------------------------------
    const ui = createUI(ctx, {
      start: () => tryStart(),
      prev: () => { if (S.mode === 'menu' && S.index > 0) selectRoute(S.index - 1); },
      next: () => { if (S.mode === 'menu' && S.index < 11) selectRoute(S.index + 1); },
      journey: () => { if (S.mode === 'menu' && S.daily) { S.daily = false; selectRoute(S.index); } },
      daily: () => { if (S.mode === 'menu' && !S.daily) { S.daily = true; selectDaily(); } },
      sound: () => { audio.unlock(); const m = !audio.isMuted(); audio.setMuted(m); ui.setMuted(m); storeSet('muted', m); },
      pause: () => pause(true),
      resume: () => pause(false),
      restart: () => { ui.showPause(false); S.mode = 'menu'; tryStart(); },
      ledger: () => toMenu(),
      again: () => { ui.hideResults(); S.mode = 'menu'; tryStart(); },
      nextRoute: () => { ui.hideResults(); S.mode = 'menu'; selectRoute(S.index + 1); tryStart(); }
    });
    ui.layout(areaNow());
    const muted0 = !!storeGet('muted');
    audio.setMuted(muted0); ui.setMuted(muted0);

    // fonts: helpful, never blocking
    const fontLoads = [
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }],
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'normal' }],
      ['Inter', 'inter', { weight: '400', style: 'normal' }],
      ['Inter', 'inter', { weight: '600', style: 'normal' }]
    ].map(([fam, name, o]) => { try { return ctx.loadFont(fam, name, '1.0.0', o).catch(() => null); } catch (e) { return Promise.resolve(null); } });
    void fontLoads;

    // ---- three -----------------------------------------------------------------
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); }
    catch (e) {
      ctx.platform.error({ stage: 'dependency', message: String(e && e.message || e) });
      ui.loadError('the world could not be loaded — please try again');
      ctx.platform.ready();
      return;
    }
    if (disposed) return;
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
    let stage;
    let dpr = Math.min(ctx.dpr || 1, 2);
    try { stage = createStage(THREE, canvas, 1); }
    catch (e) {
      ctx.platform.error({ stage: 'renderer', message: String(e && e.message || e) });
      ui.loadError('this device could not start the renderer');
      ctx.platform.ready();
      return;
    }
    ctx.onDestroy(() => { try { stage.renderer.dispose(); } catch (e) { /* already gone */ } });
    fitStage(stage, ctx.width, ctx.height, dpr);
    ctx.onResize(() => { fitStage(stage, ctx.width, ctx.height, dpr); ui.layout(areaNow()); S.cam.init = false; }, { immediate: false });

    let courier = null;
    const particles = buildParticles(stage, 90);
    stage.scene.add(particles.group);

    // ---- persistence -------------------------------------------------------------
    const validLedger = v => v && v.v === 1 && typeof v.unlocked === 'number' && v.r && typeof v.r === 'object';
    const cached = storeGet('ledger');
    if (validLedger(cached)) ledger = cached;
    if (window.__IP_UNLOCK) ledger.unlocked = 11;
    const mem = (() => { try { return ctx.memory && ctx.memory.local ? ctx.memory.local('ledger') : null; } catch (e) { return null; } })();
    if (mem) {
      mem.get().then(res => {
        if (disposed) return;
        if (res && validLedger(res.value)) { ledger = mergeLedger(ledger, res.value); }
        cloudOk = true;
        if (S.mode === 'menu') refreshMenu();
      }).catch(() => { cloudOk = false; });
    }
    function mergeLedger(a, b) {
      const out = { v: 1, unlocked: Math.max(a.unlocked, b.unlocked), r: {}, daily: null };
      for (const k of new Set([...Object.keys(a.r), ...Object.keys(b.r)])) {
        const x = a.r[k] || {}, y = b.r[k] || {};
        const best = x.best == null ? y.best : y.best == null ? x.best : Math.min(x.best, y.best);
        const L = []; for (let i = 0; i < 3; i++) L.push((x.letters && x.letters[i]) || (y.letters && y.letters[i]) ? 1 : 0);
        out.r[k] = { best, brisk: !!(x.brisk || y.brisk), letters: L };
      }
      const da = a.daily, db = b.daily;
      if (da && db && da.date === db.date) out.daily = { date: da.date, best: Math.min(da.best, db.best) };
      else out.daily = (da && da.date === todayKey()) ? da : (db && db.date === todayKey()) ? db : null;
      return out;
    }
    function saveLedger() {
      storeSet('ledger', ledger);
      if (!mem || !cloudOk) return;
      const snapshot = JSON.parse(JSON.stringify(ledger));
      saveChain = saveChain.then(() => mem.set(snapshot)).catch(e => { ctx.platform.emit && ctx.platform.emit('ledger_save_failed', { code: String(e && e.code || '') }); });
    }

    // ---- routes ------------------------------------------------------------------
    function regionForSpec(spec) {
      if (!spec.daily) return spec.region;
      const d = new Date(spec.dateKey + 'T00:00:00Z');
      return Math.floor(d.getTime() / 86400000) % 4;
    }
    function installRoute(W, spec) {
      if (S.view) { S.view.dispose(); S.view = null; }
      if (courier) { stage.scene.remove(courier.root); stage.scene.remove(courier.scarf); courier.dispose(); }
      S.W = W; S.spec = spec;
      S.region = regionForSpec(spec);
      S.view = buildWorldView(stage, W, S.region);
      courier = buildCourier(stage, PALETTES[S.region]);
      stage.scene.add(courier.root); stage.scene.add(courier.scarf);
      audio.setRegion(S.region);
      S.t = 3.1;
      S.p = makePlayer(W.start, 2.0, S.t);
      S.cam.init = false;
      particles.clear();
    }
    function selectRoute(i) {
      S.index = clamp(i, 0, 11); S.daily = false; S.pending = null;
      const spec = ROUTES[S.index];
      const W = buildRoute(spec, { plan: ROUTE_PLANS[S.index] });
      installRoute(W, spec);
      refreshMenu();
    }
    function selectDaily() {
      const spec = dailyRouteSpec(todayKey());
      if (S.dailyW && S.dailyW.spec.dateKey === spec.dateKey) { installRoute(S.dailyW, spec); refreshMenu(); return; }
      S.pending = { it: buildRouteSteps(spec, {}), spec };
      refreshMenu();
    }
    function stepPending(budgetMs) {
      const t0 = performance.now();
      while (S.pending && performance.now() - t0 < budgetMs) {
        const r = S.pending.it.next();
        if (r.done) {
          const spec = S.pending.spec; S.pending = null;
          S.dailyW = r.value;
          if (S.daily && S.mode === 'menu') { installRoute(r.value, spec); refreshMenu(); }
        }
      }
    }
    function refreshMenu() {
      const rec = ledger.r[S.index] || null;
      const d = ledger.daily && ledger.daily.date === todayKey() ? ledger.daily.best : null;
      const dt = new Date();
      ui.menuState({
        daily: S.daily, index: S.index, route: S.W, rec, letterCount: S.W ? S.W.letters.length : 0,
        locked: !S.daily && S.index > ledger.unlocked, preparing: !!S.pending,
        dailyBest: d, dateLabel: dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      });
    }

    // ---- run lifecycle ------------------------------------------------------------
    let transitioning = false;
    async function tryStart() {
      if (transitioning || !S.W) return;
      if (S.mode !== 'menu') return;
      if (S.pending || (!S.daily && S.index > ledger.unlocked)) { haptic('warning'); return; }
      audio.unlock();
      transitioning = true;
      S.attempt++;
      try { ctx.platform.start({ route: S.daily ? 'daily' : S.index + 1 }); } catch (e) { /* analytics only */ }
      let tr = null;
      try { tr = ctx.fx && ctx.fx.transition ? ctx.fx.transition({ kind: 'fade', color: PALETTES[S.region].haze, outMs: 220, inMs: 380 }) : null; } catch (e) { tr = null; }
      if (tr) await tr.cover();
      if (disposed) return;
      ui.hideMenu(); ui.hideResults(); ui.showPause(false);
      S.t = 0; S.runT = 0;
      S.p = makePlayer(S.W.start, S.W.start.len - 2.2, 0);
      S.flow = 0; S.passage = 0; S.bestPassage = 0; S.waited = 0; S.falls = 0;
      S.letters = S.W.letters.map(() => false);
      S.view.letters.forEach(l => { l.taken = false; l.fade = 0; l.m.visible = true; l.m.material.opacity = 1; l.m.scale.setScalar(1); });
      S.held = false; S.pressed = false; S.pointers.clear();
      S.cam.init = false; courier.resetScarf(); particles.clear();
      ui.showHUD(S.spec, S.W.letters.length);
      S.mode = 'play';
      if (tr) await tr.reveal();
      transitioning = false;
    }
    function toMenu() {
      ui.showPause(false); ui.hideResults(); ui.hideHUD(); ui.hint(null);
      S.mode = 'menu';
      if (S.daily) selectDaily(); else selectRoute(Math.min(S.index, 11));
      ui.showMenu({});
      refreshMenu();
    }
    function pause(on) {
      if (on && S.mode === 'play') { S.prevMode = 'play'; S.mode = 'paused'; ui.showPause(true); ui.hint(null); audio.suspend(); }
      else if (!on && S.mode === 'paused') { S.mode = S.prevMode; ui.showPause(false); audio.resume(); S.held = false; S.pointers.clear(); }
    }

    function deliver() {
      S.mode = 'delivered';
      S.deliverT = S.t;
      const ms = Math.round(S.runT * 1000);
      audio.play('deliver'); haptic('success');
      particles.emit(S.p.x, S.p.y + 0.8, { count: 26, color: PALETTES[S.region].yellow, speed: 3, life: 1.2, size: 0.12, grow: 0.05, gravity: 2, alpha: 0.9 });
      const letterCount = S.W.letters.length, found = S.letters.filter(Boolean).length;
      const brisk = !S.daily && ms <= S.W.brisk * 1000;
      let best = null, newBest = false;
      if (S.daily) {
        const prev = ledger.daily && ledger.daily.date === S.spec.dateKey ? ledger.daily.best : null;
        newBest = prev == null || ms < prev;
        best = newBest ? ms : prev;
        ledger.daily = { date: S.spec.dateKey, best };
      } else {
        const rec = ledger.r[S.index] || { best: null, brisk: false, letters: [0, 0, 0] };
        newBest = rec.best == null || ms < rec.best;
        rec.best = newBest ? ms : rec.best; best = rec.best;
        rec.brisk = rec.brisk || brisk;
        rec.letters = [0, 1, 2].map(i => (rec.letters && rec.letters[i]) || S.letters[i] ? 1 : 0);
        ledger.r[S.index] = rec;
        const firstTime = ledger.unlocked <= S.index;
        ledger.unlocked = Math.max(ledger.unlocked, Math.min(11, S.index + 1));
        S.firstDelivery = firstTime;
      }
      saveLedger();
      try { ctx.platform.complete({ route: S.daily ? 'daily' : S.index + 1, ms, letters: found, falls: S.falls }); } catch (e) { /* analytics only */ }
      const label = S.daily ? 'Today’s errand' : 'Route ' + NUMERALS[S.index] + ' · ' + REGIONS[S.spec.region].name;
      const attempt = S.attempt;
      ctx.timeout(() => {
        if (disposed || S.attempt !== attempt || S.mode !== 'delivered') return;
        ui.hint(null);
        ui.showResults({
          label, to: S.spec.to, ms, best, newBest, brisk, briskMs: S.daily ? 0 : S.W.brisk * 1000,
          letters: found, letterCount, passage: S.bestPassage, waited: Math.round(S.waited * 1000), falls: S.falls,
          nextOk: !S.daily && S.index < 11 && ledger.unlocked >= S.index + 1
        });
        if (S.daily) postDaily(ms, attempt);
        if (S.daily || S.firstDelivery) { try { ctx.pulse && ctx.pulse.complete({ timeMs: ms, timeLabel: fmtTime(ms), level: S.daily ? undefined : S.index + 1, mode: S.daily ? 'daily' : 'journey', text: 'Delivered ' + label.toLowerCase() + ' in ' + fmtTime(ms) }); } catch (e) { /* optional */ } }
      }, 1700);
    }

    function postDaily(ms, attempt) {
      let rec;
      try { rec = ctx.memory && ctx.memory.record ? ctx.memory.record('daily_errand') : null; } catch (e) { rec = null; }
      if (!rec) return;
      ui.board({ loading: true });
      rec.submit(ms, { label: fmtTime(ms), metadata: { edition: S.spec.dateKey } })
        .then(() => rec.leaderboard({ scope: 'global', period: 'daily', limit: 3 }))
        .then(lb => {
          if (disposed || attempt !== S.attempt) return;
          const rows = (lb.rows || []).map((r, i) => ({ rank: r.rank || i + 1, name: r.username || r.displayName || r.name || (r.user && r.user.username) || '', value: r.value }));
          const vr = lb.viewerRank;
          ui.board({ rows, rank: vr ? vr.rank : null, total: lb.totalRanked });
        })
        .catch(() => { if (!disposed && attempt === S.attempt) ui.board({ error: true }); });
    }

    // ---- input ------------------------------------------------------------------
    function press() {
      audio.unlock();
      if (S.mode === 'menu') { tryStart(); return; }
      if (S.mode === 'play') { S.pressed = true; try { ctx.platform.interact({ kind: 'press' }); } catch (e) { /* analytics */ } }
    }
    ctx.listen(canvas, 'pointerdown', e => {
      e.preventDefault();
      S.pointers.add(e.pointerId);
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* not all pointers capture */ }
      S.held = true;
      press();
    });
    const up = e => { S.pointers.delete(e.pointerId); S.held = S.pointers.size > 0; };
    ctx.listen(canvas, 'pointerup', up);
    ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(canvas, 'lostpointercapture', up);
    ctx.listen(window, 'keydown', e => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { e.preventDefault(); S.keyHeld = true; S.held = true; press(); }
      if (e.code === 'Escape' || e.code === 'KeyP') pause(S.mode === 'play');
    });
    ctx.listen(window, 'keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { S.keyHeld = false; S.held = S.pointers.size > 0; } });

    // ---- simulation step ----------------------------------------------------------
    const PROBE = { x: 0, y: 0, a: 0 };
    function fixedStep(stepMs) {
      if (S.pending) stepPending(4);
      if (!S.W || S.mode === 'paused' || S.mode === 'loading') return;
      const dt = stepMs / 1000;
      S.t += dt;
      const p = S.p;
      const live = S.mode === 'play';
      if (S.auto && live) S.auto(S, dt);
      const pressed = live && S.pressed; S.pressed = false;
      if (p.mode === 'fall') {
        S.fallT += dt;
        p.vx *= 0.97; p.vy += (-1.6 - p.vy) * Math.min(1, dt * 4);
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (S.fallT > 1.5) {
          respawnPlayer(p, S.t);
          courier.resetScarf();
          particles.emit(p.x, p.y + 0.4, { count: 10, color: '#ffffff', speed: 1.2, life: 0.6, size: 0.25, grow: 0.7, alpha: 0.6 });
          audio.play('umbrella');
        }
      } else {
        playerStep(p, S.W, S.t, dt, live && S.held, pressed);
      }
      if (live) S.runT += dt;
      // events
      for (const ev of p.ev) handleEvent(ev, p);
      p.ev.length = 0;
      // waiting breaks the passage; flow ebbs
      if (p.mode === 'ground' && p.atLip) {
        if (p.waitT > 0.9) S.flow = Math.max(0, S.flow - dt * 0.45);
        if (p.waitT > 1.4) S.passage = 0;
        if (live) S.waited += dt;
      } else S.flow = Math.max(0, S.flow - dt * 0.03);
      // lost letters
      if (live) {
        for (let i = 0; i < S.W.letters.length; i++) {
          if (S.letters[i]) continue;
          const L = S.W.letters[i];
          if (Math.hypot(L.x - p.x, L.y - (p.y + 0.55)) < 0.95) {
            S.letters[i] = true;
            const lv = S.view.letters[i]; lv.taken = true;
            audio.play('letter'); haptic('light'); ui.letter(i);
            particles.emit(L.x, L.y, { count: 14, color: PALETTES[S.region].yellow, speed: 2.2, life: 0.9, size: 0.1, grow: 0.04, alpha: 0.95 });
            try { ctx.platform.milestone('lost_letter', { route: S.daily ? 'daily' : S.index + 1 }); } catch (e) { /* analytics */ }
          }
        }
      }
    }

    function sfxPan(x) { return clamp((x - S.cam.x) / 9, -1, 1); }
    function handleEvent(ev, p) {
      const P = PALETTES[S.region];
      const live = S.mode === 'play';
      switch (ev.type) {
        case 'jump':
          if (live) { audio.play('jump', { pan: sfxPan(p.x) }); S.everJumped = true; }
          courier.squash = -0.1; courier.squashV = -2;
          if (ev.waited > 1.4) S.passage = 0;
          break;
        case 'land': {
          const mat = ev.surf.mat;
          const imp = ev.impact;
          audio.play('land', { mat, impact: imp, pan: sfxPan(p.x), deg: (S.passage % 5) });
          courier.squash = clamp(imp * 0.025, 0.05, 0.25); courier.squashV = 0;
          particles.emit(p.x, p.y + 0.05, { count: Math.round(clamp(imp, 2, 9)), color: mat === 'wood' ? P.woodLight : P.stoneLight, speed: 1.4, angle: Math.PI / 2, spread: 2.6, life: 0.5, size: 0.14, grow: 0.42, alpha: 0.6, jx: 0.3 });
          if (imp > 7) haptic('light');
          if (ev.from && ev.surf.sys !== ev.from.sys && live) { S.passage++; S.bestPassage = Math.max(S.bestPassage, S.passage); S.flow = Math.min(1, S.flow + 0.2); }
          if (ev.surf.sys.kind === 'skiff') particles.emit(p.x, p.y - 0.5, { count: 8, color: P.waterLight, speed: 2, angle: Math.PI / 2, spread: 1.6, gravity: 8, life: 0.6, size: 0.1, grow: 0.12, alpha: 0.8 });
          if (live && !S.hintsSeen.leap && ev.surf.sys.kind !== 'pier') markHint('leap');
          break;
        }
        case 'grab':
          audio.play('grab', { pan: sfxPan(p.x) }); haptic('light');
          if (live) { S.passage++; S.bestPassage = Math.max(S.bestPassage, S.passage); S.flow = Math.min(1, S.flow + 0.2); S.everGrabbed = true; markHint('hold'); }
          particles.emit(p.x, p.y + 1.0, { count: 6, color: P.coral, speed: 1, life: 0.35, size: 0.08, grow: 0.25, alpha: 0.8 });
          break;
        case 'release':
          audio.play('release', { pan: sfxPan(p.x) });
          if (live) markHint('release');
          break;
        case 'launch':
          if (live && ev.surf.sys.kind === 'bellows') markHint('puff');
          break;
        case 'fall':
          S.fallT = 0; S.flow = 0; S.passage = 0;
          if (live) { S.falls++; audio.play('fall', { pan: sfxPan(p.x) }); haptic('warning'); }
          p.vy = Math.max(p.vy, -6);
          ctx.timeout(() => { if (!disposed && S.p === p && p.mode === 'fall') audio.play('umbrella'); }, 150);
          if (live && !S.hintsSeen.fall) { showHintOnce('fall', 'the city always catches you', 2600); }
          break;
        case 'goal':
          if (live) deliver();
          break;
        default: break;
      }
    }

    // ---- hints: a few words, once, only where the world can't say it alone ----------
    function markHint(k) { if (!S.hintsSeen[k]) { S.hintsSeen[k] = 1; storeSet('hints', S.hintsSeen); } if (S.hint && S.hint.key === k) S.hint = null; }
    function showHintOnce(key, text, ms) { S.hint = { key, text, until: S.t + ms / 1000 }; S.hintsSeen[key] = 1; storeSet('hints', S.hintsSeen); }
    function updateHints() {
      if (S.mode !== 'play') { ui.hint(null); return; }
      const p = S.p, seen = S.hintsSeen;
      let want = null;
      if (S.hint && S.hint.until && S.t > S.hint.until) S.hint = null;
      if (S.hint && S.hint.key === 'fall') want = S.hint.text;
      else if (!seen.leap && p.mode === 'ground' && p.atLip && p.waitT > 1.2) want = 'touch anywhere to leap';
      else if (!seen.hold && p.mode !== 'hang') {
        for (const h of S.W.handlesNear(p.x + 4)) { if (h.pos(S.t, PROBE) && PROBE.x > p.x - 1 && PROBE.x - p.x < 6) { want = 'press and keep holding to catch the ring'; break; } }
      } else if (!seen.release && p.mode === 'hang') want = 'let go to fly';
      else if (!seen.puff && p.mode === 'ground' && p.surf.sys.kind === 'bellows') want = 'it breathes in… leap as it breathes out';
      if (want) {
        const v = new THREE.Vector3(p.x, p.y + 1.9, 0.4).project(stage.camera);
        ui.hint(want, (v.x + 1) / 2 * ctx.width, (1 - v.y) / 2 * ctx.height);
      } else ui.hint(null);
    }

    // ---- world voices -----------------------------------------------------------------
    function worldSounds() {
      const t = S.t;
      for (const v of S.view.sysViews) {
        const sys = v.sys, dx = v.cx - S.cam.x;
        if (Math.abs(dx) > v.reach + 14 || sys.kind === 'pier') continue;
        const vol = clamp(1 - (Math.abs(dx) - v.reach * 0.5) / 18, 0, 1) * 0.85;
        const pan = clamp(dx / 12, -1, 1);
        const st = v.snd || (v.snd = { init: false });
        switch (sys.kind) {
          case 'skiff': { const u = sys.state(t).u; if (st.init && ((st.u > 0.002 && u <= 0.002) || (st.u < 0.998 && u >= 0.998))) audio.play('dock', { vol, pan }); st.u = u; break; }
          case 'lift': {
            const s2 = sys.state(t); const u = s2.u;
            if (st.init && ((st.u > 0.001 && u <= 0.001) || (st.u < 0.999 && u >= 0.999))) audio.play('liftBell', { vol, pan, deg: u > 0.5 ? 4 : 2 });
            if (st.init && Math.abs(u - st.u) > 0.0004) { st.r = (st.r || 0) + Math.abs(u - st.u) * 30; if (st.r > 1) { st.r = 0; audio.play('ratchet', { vol: vol * 0.7, pan }); } }
            st.u = u; break;
          }
          case 'bellows': {
            const ph = sys.state(t).phase;
            if (st.init && ph !== st.ph) {
              const pp = sys.params;
              if (ph === 'breathe') audio.play('inhale', { vol, pan, dur: pp.period - pp.puffT - pp.holdTop - pp.holdLow });
              if (ph === 'top') {
                audio.play('puff', { vol, pan });
                const P = PALETTES[S.region];
                particles.emit(pp.x + pp.len / 2, pp.top - 0.2, { count: 12, color: P.cloth, speed: 2.6, angle: Math.PI / 2, spread: 2.2, life: 0.8, size: 0.2, grow: 0.6, alpha: 0.5, jx: 1.6 });
                particles.emit(pp.x + pp.len / 2, pp.top, { count: 3, color: P.coral, speed: 3.5, angle: Math.PI / 2, spread: 1.2, gravity: 3, life: 1.4, size: 0.06, grow: 0.06, alpha: 0.9 });
              }
            }
            st.ph = ph; break;
          }
          case 'wheel': {
            const a = sys.angleAt(t), n = sys.params.n;
            const k = Math.floor(-a * n / TAU + 0.25);
            if (st.init && k !== st.k) audio.play('tok', { vol: vol * 0.8, pan, deg: ((k % 5) + 5) % 5 });
            st.k = k; break;
          }
          case 'swing': {
            const th = sys.angleAt(t);
            if (st.init && Math.sign(th) !== Math.sign(st.th)) audio.play('swoosh', { vol, pan });
            st.th = th; break;
          }
          case 'trolley': {
            const c = sys.paramAt(t, 0) / sys.loop, n = sys.params.n;
            const k = Math.floor(c * n);
            if (st.init && k !== st.k) audio.play('trolley', { vol, pan });
            st.k = k; break;
          }
          case 'strider': case 'walker': {
            const s2 = sys.state(t);
            const k = Math.floor(s2.stepPh);
            if (st.init && k !== st.k && s2.moving) audio.play('stride', { vol: vol * (sys.kind === 'walker' ? 1 : 0.7), pan });
            if (st.init && Math.random() < 0.0015) audio.play('call', { vol: vol * 0.6, pan });
            st.k = k; break;
          }
          default: break;
        }
        st.init = true;
      }
    }

    // ---- camera -----------------------------------------------------------------------
    const smoothDampV = (cur, target, vel, smoothTime, dt) => {
      const omega = 2 / smoothTime, x = omega * dt;
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = cur - target;
      const temp = (vel + omega * change) * dt;
      const nv = (vel - omega * temp) * exp;
      return [target + (change + temp) * exp, nv];
    };
    function cameraUpdate(dt) {
      const p = S.p, cam = S.cam;
      const vx = p.mode === 'ground' ? p.gvx : p.mode === 'hang' ? p.hvx : p.vx;
      if (p.mode === 'ground') cam.ref = p.y;
      if (cam.ref == null) cam.ref = p.y;
      const refY = p.mode === 'ground' ? p.y : clamp(p.y, cam.ref - 1.2, cam.ref + 2.5) + (p.y < cam.ref - 1.2 ? (p.y - cam.ref + 1.2) * 0.8 : 0) + (p.y > cam.ref + 2.5 ? (p.y - cam.ref - 2.5) * 0.6 : 0);
      // look a little ahead, and towards the height of what's coming
      let aheadY = refY;
      for (const m of S.W.modules) if (m.x0 > p.x + 1) { aheadY = m.pierB ? m.pierB.params.y : m.y; break; }
      const tx = p.x + stage.viewW * 0.17 + clamp(vx * 0.3, -1.5, 2.2);
      const ty = lerp(refY, aheadY, 0.25) + stage.viewH * 0.06;
      if (!cam.init) { cam.x = tx; cam.y = ty; cam.vx = cam.vy = 0; cam.init = true; }
      [cam.x, cam.vx] = smoothDampV(cam.x, tx, cam.vx, p.mode === 'fall' ? 0.9 : 0.42, dt);
      [cam.y, cam.vy] = smoothDampV(cam.y, ty, cam.vy, 0.6, dt);
      stage.camera.position.set(cam.x, cam.y, stage.dist);
      stage.camera.rotation.z = Math.sin(S.t * 0.13) * 0.002;
    }

    // ---- rendering --------------------------------------------------------------------------
    let readySent = false, slowFrames = 0, hudTick = 0;
    function renderFrame() {
      const now = performance.now();
      const dt = S.lastFrame ? Math.min(0.1, (now - S.lastFrame) / 1000) : 1 / 60;
      S.lastFrame = now;
      if (!S.W || !S.view) return;
      cameraUpdate(dt);
      S.view.update(S.t, S.cam.x, S.cam.y, stage.viewH);
      // the courier watches what is coming
      let lookY = 0;
      const p = S.p;
      if (p.mode === 'ground' && p.atLip) {
        let best = 1e9;
        for (const sf of S.W.surfacesNear(p.x + 3)) { if (sf === p.surf || sf.isStatic) continue; sf.pose(S.t, PROBE); const d = Math.abs(PROBE.x - p.x); if (PROBE.x > p.x - 1 && d < best && d < 8) { best = d; lookY = (PROBE.y - p.y) / 4; } }
      }
      courier.update(p, dt, S.t, { flow: S.flow, lookY });
      particles.update(dt);
      // the sun slides lower as a delivery takes longer
      const sp = stage.skyMat.uniforms.sunPos.value;
      sp.y = 0.66 - Math.min(0.28, (S.mode === 'menu' ? 0 : S.runT) / 420);
      audio.setFlow(S.flow);
      audio.tick(dt, { high: p.y > 8 });
      if (S.mode !== 'paused') worldSounds();
      if ((hudTick += dt) > 0.1 && (S.mode === 'play' || S.mode === 'delivered')) { hudTick = 0; ui.progress(clamp((p.x - S.W.start.xmin) / (S.W.finalX - S.W.start.xmin), 0, 1)); updateHints(); }
      stage.renderer.render(stage.scene, stage.camera);
      if (window.__IP_INFO) window.__IP_INFO = { calls: stage.renderer.info.render.calls, tris: stage.renderer.info.render.triangles, tex: stage.renderer.info.memory.textures };
      if (!readySent) { readySent = true; ui.loaded(); ctx.platform.ready(); }
      // keep the frame rate smooth on slower phones
      if (dt > 0.026) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 90 && dpr > 1) { dpr = Math.max(1, dpr - 0.35); fitStage(stage, ctx.width, ctx.height, dpr); slowFrames = 0; }
    }

    // ---- go -------------------------------------------------------------------------------
    S.mode = 'menu';
    selectRoute(Math.min(ledger.unlocked, 11));
    ui.showMenu({});
    refreshMenu();
    ctx.game.loop({
      fixedHz: 120, maxDeltaMs: 100, maxSubsteps: 12,
      fixedUpdate: stepMs => fixedStep(stepMs),
      render: () => renderFrame(),
      onPause: () => { pause(true); audio.suspend(); },
      onResume: () => { if (S.mode !== 'paused') audio.resume(); }
    });
    window.__IP = S; // handy for tests; harmless in production
  }
};

return BIT;
})();
