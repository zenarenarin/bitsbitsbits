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
