// =====================================================================
// Endless: spirals assembled from motifs the campaign has taught, each
// accepted only if it is fair at the start and a plain-minded traveller
// (the bot below, using only walking, turning and looking) can reach the
// centre in the real simulation. Otherwise it is rerolled; after enough
// rerolls a proven campaign spiral, rotated and re-seeded, stands in.
// =====================================================================

// Motifs: functions that add eyes (and sometimes barriers or veils) to one ring.
// They get the ring index, the angle of the opening that lands on it, and an rng.
const MOTIFS = {
  lurker: (k, land, r, d) => ({ eyes: [{ type: 'watcher', k, a: land + r.range(-40, 40) }] }),
  pacer: (k, land, r, d) => ({ eyes: [{ type: 'watcher', k, a: land + r.range(60, 120) * r.pick([-1, 1]), beh: 'patrol', dir: r.pick([-1, 1]), speed: 0.9 + d * 0.02 }] }),
  drifters: (k, land, r) => ({ eyes: [{ type: 'drifter', k, a: land + r.range(30, 70), dir: -1 }, { type: 'watcher', k, a: land - r.range(70, 130) }] }),
  liar: (k, land, r) => ({ eyes: [{ type: 'liar', k, a: land + r.range(-30, 30) * 0 + r.pick([-1, 1]) * r.range(25, 60) }] }),
  gathering: (k, land, r) => ({ eyes: [{ type: 'collector', k, a: land + 140 }, { type: 'watcher', k, a: land + r.range(60, 100) }, { type: 'watcher', k, a: land - r.range(60, 100) }] }),
  mimic: (k, land, r) => ({ eyes: [{ type: 'mimic', k, a: land + r.pick([-1, 1]) * r.range(35, 70), mirror: r.chance(0.3) ? -1 : 1 }] }),
  sentinel: (k, land, r) => ({ eyes: [{ type: 'sentinel', wall: k - 1, a: land + r.pick([-1, 1]) * r.range(50, 90), face: r.pick(['cw', 'ccw', 'in']), sweep: r.range(20, 40), period: r.range(4.5, 7), range: 6.5, half: 15, wake: 2, wakeNear: 0 }] }),
  choir: (k, land, r) => {
    const base = land + r.range(100, 200), n = 3 + r.int(0, 1), names = [];
    const eyes = [];
    for (let i = 0; i < n; i++) { const name = 'ch' + k + '_' + i; names.push(name); eyes.push({ type: 'choir', name, k, a: base + i * 14 }); }
    return { eyes, choirs: [{ members: names, conductor: names[r.int(0, n - 1)], dir: r.pick([-1, 1]), spd: 0.9 }] };
  },
  falses: (k, land, r) => ({ eyes: [0, 1, 2].map(i => ({ type: 'falseeye', k, a: land + 40 + i * 50 + r.range(-10, 10), lookAt: r() * 360 })).concat([{ type: 'watcher', k, a: land - r.range(60, 120), speed: 0.4 }]) }),
  hunter: (k, land, r) => ({ eyes: [{ type: 'watcher', k, a: land + r.pick([-1, 1]) * r.range(90, 150), beh: 'hunt', lead: 0.8 }] }),
  unblinking: (k, land, r) => ({ eyes: [{ type: 'unblinking', k, a: land + 180, wake: 3 }, { type: 'drifter', k, a: land + 90, dir: 1 }] }),
};
// what can appear, by depth: the order the campaign teaches them
const MOTIF_DEPTH = [['lurker', 1], ['pacer', 1], ['drifters', 2], ['liar', 3], ['gathering', 4], ['mimic', 5], ['sentinel', 6], ['falses', 6], ['choir', 7], ['hunter', 8], ['unblinking', 12]];

function generateEndless(depth, seed) {
  const r = makeRng(seed);
  const n = Math.min(5, 3 + (depth >= 4 ? 1 : 0) + (depth >= 10 && r.chance(0.5) ? 1 : 0));
  const doors = [], barriers = [], veils = [], eyes = [], choirs = [];
  for (let k = 0; k < n; k++) {
    const nd = depth >= 6 && r.chance(0.3) ? 2 : 1;
    const ds = []; for (let i = 0; i < nd; i++) ds.push(Math.round(r.range(-180, 180)));
    doors.push(ds);
    barriers.push(k === 0 ? [-90 - r.range(35, 55), -90 + r.range(35, 55)] : (r.chance(0.25 + depth * 0.02) ? [Math.round(r.range(-180, 180))] : []));
    veils.push(k > 0 && depth >= 7 && r.chance(0.3) ? [[ds[0] + 14, ds[0] + 50]] : []);
  }
  const pool = MOTIF_DEPTH.filter(m => m[1] <= depth).map(m => m[0]);
  // pressure: how many rings carry a motif; later spirals also double up
  const busy = Math.min(n - 1, 1 + Math.floor(depth / 3));
  const rings = []; for (let k = 1; k < n; k++) rings.push(k);
  for (let i = rings.length - 1; i > 0; i--) { const j = r.int(0, i); [rings[i], rings[j]] = [rings[j], rings[i]]; }
  for (let i = 0; i < busy; i++) {
    const k = rings[i];
    const land = doors[k - 1][0];
    const m = MOTIFS[r.pick(pool)](k, land, r, depth);
    eyes.push(...m.eyes); if (m.choirs) choirs.push(...m.choirs);
    if (depth >= 9 && r.chance(0.35)) { const m2 = MOTIFS[r.pick(pool.filter(p => p !== 'unblinking' && p !== 'choir'))](k, land + 180, r, depth); eyes.push(...m2.eyes); }
  }
  eyes.forEach((e, i) => { if (!e.name) e.name = 'x' + i; });
  // pressure: the spiral will not wait. After a while, hunters come in from the edge, one more every 20 s
  const pressureAt = Math.max(18, 40 - depth);
  const script = {
    step(S) {
      const due = S.t > pressureAt ? 1 + Math.floor((S.t - pressureAt) / 20) : 0;
      if ((S.flags.hunters || 0) < Math.min(due, 3)) {
        S.flags.hunters = (S.flags.hunters || 0) + 1;
        // it enters your own stretch of groove, at the end furthest from you
        const k = S.P.k, bars = S.rings[k].barriers, pa = S.P.a;
        let a = pa + Math.PI;
        if (bars.length) {
          let ccw = TAU, cw = TAU;
          for (const b of bars) { ccw = Math.min(ccw, wrap0(b - pa)); cw = Math.min(cw, wrap0(pa - b)); }
          const margin = 0.9 / S.rings[k].r;
          a = ccw >= cw ? pa + ccw - margin : pa - cw + margin;
        }
        S.addEye({ type: 'watcher', name: 'edge' + S.flags.hunters, k, a: a / DEG, beh: 'hunt', lead: 0.6, wake: 1.5, wakeNear: 0 });
        S.ev('pressure');
      }
    },
  };
  return { script, id: 100 + depth, act: 4, name: ENDLESS_NAMES[(depth * 7 + (seed % 13)) % ENDLESS_NAMES.length], whisper: '', par: 45 + n * 10, n, rotation: true, doors, barriers, veils, player: { k: 0, a: -90 }, eyes, choirs, seed, dread: Math.min(1, 0.3 + depth * 0.04) };
}
const ENDLESS_NAMES = ['Further In', 'Below the Below', 'The Same Eyes', 'Another Spiral', 'It Remembers', 'Deeper Than Before', 'No Centre Yet', 'The Long Look', 'Inward', 'Still Watching', 'The Narrow Turn', 'What It Learned'];

// A plain-minded traveller: turn the nearest opening toward you, hold whatever
// threatens you most, wait while the landing is not safe, step through.
function botPolicy(S) {
  const P = S.P, th = S.playerTheta(), pp = S.playerPos();
  const inp = { move: [0, 0], rot: 0 };
  // threat: the lethal eye closest to reaching you, or the sentinel looking your way
  let worst = null, ws = 1e9;
  const nd = S.nearestDoor(P.k, th, true);
  const k2 = P.k + 1;
  for (const e of S.eyes) {
    if (e.state === ST.DEAD || e.state === ST.REVEALED || e.decoy || e.immune) continue;
    let score = 1e9;
    if (e.type === 'sentinel') { if (e.state === ST.ACTIVE || HELD(e.state)) { const q = S.eyePos(e); score = S.inCone(e, q, pp[0], pp[1]) || P.exposure > 0.2 ? 0.5 : Math.hypot(q[0] - pp[0], q[1] - pp[1]) + 3; } }
    else if (e.lethal && !e.inWall) {
      if (e.k === P.k) score = Math.abs(wrap(e.a - P.a)) * S.rings[P.k].r;
      else if (e.k === k2 && nd) score = Math.abs(wrap(S.eyeTheta(e) - S.doorTheta(nd.w, nd.d))) * S.rings[k2].r + 0.5;
    }
    if (e.state === ST.FEIGN) score += 2;   // it learned the shy one: do not keep staring
    if (score < ws) { ws = score; worst = e; }
  }
  if (worst && ws < 4.5) inp.gaze = S.eyePos(worst);
  if (!nd) return inp;
  // is the landing safe?
  let landingBad = false;
  if (k2 < S.N) for (const e of S.eyes) {
    if (e.k !== k2 || e.inWall || e.state === ST.DEAD || !e.solid) continue;
    if (Math.abs(wrap(S.eyeTheta(e) - S.doorTheta(nd.w, nd.d))) * S.rings[k2].r < e.rad + 0.6 + (e.lethal && e.state === ST.ACTIVE ? 0.6 : 0)) landingBad = true;
  }
  if (nd.arc > 0.4) { const g = S.gear(nd.w.owner); inp.rot = -Math.sign(nd.dth) * g * Math.min(1, Math.abs(nd.dth) * 3 + 0.2); }
  else if (!landingBad) inp.move = [-Math.cos(th), -Math.sin(th)];
  else { const g = S.gear(nd.w.owner); inp.rot = g * 0.6; }   // turn on past a blocked landing
  return inp;
}
function botRun(def, maxSec, blind) {
  const S = createSim(def, {});
  const steps = Math.round(maxSec / SIM_DT);
  for (let i = 0; i < steps && !S.over && !S.reached; i++) { const p = botPolicy(S); if (blind) p.gaze = null; S.step(p); }
  return { ok: S.reached && !S.over, t: S.t, over: S.over };
}
function startSafe(def) {
  const S = createSim(def, {});
  for (let i = 0; i < 180 && !S.over; i++) S.step({});
  return !S.over;
}
// The next spiral for endless mode: generated, validated, or a proven fallback.
// A preparer tries one candidate per call, so the work can be spread over frames.
function endlessPreparer(depth, runSeed) {
  let attempt = 0, result = null, cur = null;
  const fallback = () => {
    const src = ENCOUNTERS[4 + (depth * 5 + runSeed) % 15];
    const def = buildEncounter(src, {});
    def.id = 100 + depth; def.name = src.name + ', again'; def.validated = 'campaign'; def.seed = runSeed + depth;
    return def;
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // each candidate runs three trials in turn: idle at the start, the bot, the bot without looking
  function next() {
    if (attempt >= 16) { result = fallback(); return; }
    const seed = (runSeed * 977 + depth * 7919 + attempt * 104729) >>> 0;
    attempt++;
    const def = generateEndless(depth, seed);
    cur = { def, phase: 'idle', S: createSim(def, {}), i: 0 };
  }
  function advance(budgetMs) {
    const t0 = now();
    while (!result && now() - t0 < budgetMs) {
      if (!cur) { next(); continue; }
      const c = cur;
      const limit = c.phase === 'idle' ? 180 : Math.round(75 / SIM_DT);
      for (let n = 0; n < 120 && !c.S.over && !c.S.reached && c.i < limit; n++, c.i++) {
        if (c.phase === 'idle') c.S.step({});
        else { const p = botPolicy(c.S); if (c.phase === 'blind') p.gaze = null; c.S.step(p); }
      }
      const finished = c.S.over || c.S.reached || c.i >= limit;
      if (!finished) continue;
      const ok = c.S.reached && !c.S.over;
      if (c.phase === 'idle') { if (c.S.over) cur = null; else { c.phase = 'bot'; c.S = createSim(c.def, {}); c.i = 0; } }
      else if (c.phase === 'bot') { if (!ok) cur = null; else if (depth < 3) { c.def.validated = 'bot'; c.def.attempts = attempt; result = c.def; } else { c.phase = 'blind'; c.S = createSim(c.def, {}); c.i = 0; } }
      else { if (ok) cur = null; else { c.def.validated = 'bot'; c.def.attempts = attempt; result = c.def; } }
    }
    return result;
  }
  return {
    get done() { return !!result; },
    step(budgetMs) { return advance(budgetMs === undefined ? 4 : budgetMs); },
    finish() { while (!result) advance(1e9); return result; },
  };
}
function makeEndlessDef(depth, runSeed) { return endlessPreparer(depth, runSeed).finish(); }
function makeEndless(depth, run) {
  if (!run.endSeed) run.endSeed = (Date.now() % 100000) | 1;
  if (run.next && run.next.depth === depth) { const d = run.next.prep.finish(); run.next = null; return d; }
  return makeEndlessDef(depth, run.endSeed);
}
// start preparing the spiral after this one; the game calls tick() once per frame
function prepareNextEndless(run) {
  if (!run.endSeed) run.endSeed = (Date.now() % 100000) | 1;
  run.next = { depth: run.depth + 1, prep: endlessPreparer(run.depth + 1, run.endSeed) };
}
