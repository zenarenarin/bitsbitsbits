// THE THING THAT WATCHES BACK — a psychological horror arcade game for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// THE THING THAT WATCHES BACK — shared math.
// World plane: x right, y up (screen up). Angles are radians, CCW from +x.
// =====================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
// wrap to (-PI, PI]
const wrap = a => { a = a % TAU; if (a > Math.PI) a -= TAU; else if (a <= -Math.PI) a += TAU; return a; };
// wrap to [0, TAU)
const wrap0 = a => { a = a % TAU; return a < 0 ? a + TAU : a; };
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  return r;
}

const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Distance from point p to segment ab, plus the parameter t along ab.
function segPointDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return { d: Math.hypot(ax + dx * t - px, ay + dy * t - py), t };
}

// Parameters t in [0,1] where segment ab crosses the circle of radius r about the origin.
function segCircle(ax, ay, bx, by, r, out) {
  out.length = 0;
  const dx = bx - ax, dy = by - ay;
  const A = dx * dx + dy * dy, B = 2 * (ax * dx + ay * dy), C = ax * ax + ay * ay - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < 0) return out;
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A), t2 = (-B + s) / (2 * A);
  if (t1 > 1e-6 && t1 < 1 - 1e-6) out.push(t1);
  if (t2 > 1e-6 && t2 < 1 - 1e-6) out.push(t2);
  return out;
}

// is angle x inside the CCW arc that starts at a0 and spans to a1?
function inArc(x, a0, a1) {
  const span = wrap0(a1 - a0);
  return wrap0(x - a0) <= span;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const roman = n => ROMAN[n] || String(n);

// ---- 01_defs.js ----
// =====================================================================
// Rules of the spiral. Every number a player learns lives here.
// =====================================================================

const SIM_DT = 1 / 60;

const RULES = {
  // the traveller
  walk: 2.6,            // units per second along a groove
  walkAccel: 16,        // how quickly the walk reaches the stick (exponential, per second)
  playerRad: 0.3,
  crossTime: 0.2,       // the step through an opening
  doorHalf: 0.68,       // half the opening, in units of arc
  doorAssist: 1.7,      // within this arc, pushing toward an opening slides you to it
  // gaze
  gazeCone: 0.17,       // half-angle of the gaze, before the eye's own size is added
  gazeStick: 0.03,      // the held eye keeps priority unless another is this much nearer the gaze
  acquire: 0.2,         // seconds of gaze before an eye is pinned
  release: 0.35,        // a pinned eye stays held this long after the gaze leaves
  // the spiral
  rotMax: 1.25,         // radians per second at full dial
  rotSmooth: 14,
  wallThick: 0.5,
  pupilFrac: 0.62,      // the centre's dark pupil, as a fraction of the innermost wall radius
  // threat
  contactSlack: 0.85,   // lethal contact uses this fraction of the eye's radius
  exposureRate: 1.15,   // a sentinel's gaze fills exposure at this rate (1 = caught)
  exposureDecay: 1.4,
  graceStart: 1.0,
  markTime: 6,          // after being struck, the next touch within this time is fatal
  knockback: 1.4,       // units the traveller is thrown clear by a strike      // nothing moves for this long when an encounter opens
};

// type: rad (units), spd (units/s), lethal on contact, solid to walking,
// pinnable by gaze, inWall (sits in a wall, not a groove), anchored (cannot be pushed)
const EYE_TYPES = {
  watcher:    { rad: 0.55, spd: 0.92, lethal: true,  solid: true,  pinnable: true },
  drifter:    { rad: 0.74, spd: 0.85, lethal: false, solid: true,  pinnable: true },
  collector:  { rad: 0.64, spd: 0.8,  lethal: true,  solid: true,  pinnable: true },
  liar:       { rad: 0.52, spd: 0.85, lethal: true,  solid: true,  pinnable: true, feigns: true },
  mimic:      { rad: 0.55, spd: 0,    lethal: true,  solid: true,  pinnable: true },
  sentinel:   { rad: 0.5,  spd: 0,    lethal: false, solid: false, pinnable: true, inWall: true, anchored: true },
  warden:     { rad: 0.46, spd: 0,    lethal: false, solid: false, pinnable: true, inWall: true, anchored: true },
  choir:      { rad: 0.46, spd: 0.95, lethal: true,  solid: true,  pinnable: true },
  crown:      { rad: 0.5,  spd: 0.7,  lethal: true,  solid: true,  pinnable: true },
  falseeye:   { rad: 0.55, spd: 0,    lethal: false, solid: false, pinnable: false, decoy: true },
  unblinking: { rad: 0.86, spd: 0.78, lethal: true,  solid: true,  pinnable: false, immune: true },
  echo:       { rad: 0.5,  spd: 0,    lethal: true,  solid: true,  pinnable: true },
};

// eye states
const ST = {
  DORMANT: 'dormant',     // closed, waiting to wake
  ACTIVE: 'active',
  ACQUIRING: 'acquiring',
  PINNED: 'pinned',
  RELEASING: 'releasing',
  STUNNED: 'stunned',     // disrupted: harmless, still, rides its ring
  FEIGN: 'feign',         // the liar, pretending to be pinned
  REVEALED: 'revealed',   // a false eye, seen for what it is
  KNOT: 'knot',           // gathered into an obstruction by a collector
  DEAD: 'dead',           // closed for good (absorbed, or a broken crown jewel)
};
const HELD = s => s === ST.PINNED || s === ST.RELEASING;

// ---- 02_sim.js ----
// =====================================================================
// The simulation: a spiral of concentric grooves (rings) that turn like
// gears, the traveller walking them, the gaze, and the eyes.
//
// Spatial model
//  - Ring k (0 = outermost) is a circular groove of radius rings[k].r.
//    Everything on a ring is stored in ring-local angles; its world angle
//    is local + phi[k].
//  - Wall k separates ring k from ring k+1 (wall N-1 separates the last
//    ring from the centre). A wall turns with the ring inside it (its
//    owner, k+1; the centre is owner N). Openings in it are doors.
//  - Barriers are radial walls across a groove (ring-local). Veils are
//    tall lashes on a wall that block sight (not movement).
//
// Rotation rule (one rule, always): the ring you stand on holds still
// under your feet; every other ring turns, alternating direction like
// gears. A held (pinned) eye in a groove is held still in the world, so
// its ring slides beneath it and it shoves whatever it meets.
// =====================================================================

function buildGeometry(def) {
  const n = def.n;
  const Ri = def.rIn || 1.9;
  const w = def.w || Math.min(2.3, (9.3 - Ri) / n);
  const rings = [], walls = [];
  for (let k = 0; k < n; k++) rings.push({ k, r: Ri + w * (n - k - 0.5), barriers: ((def.barriers && def.barriers[k]) || []).map(d => d * DEG) });
  for (let k = 0; k < n; k++) {
    const doors = ((def.doors && def.doors[k]) || []).map((d, i) => typeof d === 'number' ? { a: d * DEG } : Object.assign({}, d, { a: d.a * DEG }));
    doors.forEach((d, i) => { d.i = i; d.wscale = d.wscale || 1; d.sealed = !!d.sealed; });
    walls.push({ k, owner: k + 1, r: Ri + w * (n - k - 1), doors, veils: ((def.veils && def.veils[k]) || []).map(v => [v[0] * DEG, v[1] * DEG]) });
  }
  return { n, Ri, w, Ro: Ri + w * n, rings, walls, eyeScale: clamp(w / 2.1, 0.72, 1) };
}

function createSim(def, opt) {
  opt = opt || {};
  const G = buildGeometry(def);
  const N = G.n;
  const rng = makeRng((def.seed || 7) * 7919 + 13);
  const S = {
    def, G, N, t: 0, steps: 0, rings: G.rings, walls: G.walls,
    phi: new Array(N + 1).fill(0),
    eyes: [], groups: [], knots: [], causes: [],
    events: [], over: null, reached: false,
    rotVel: 0, rotInput: 0, forcedRot: 0, jam: 0, rotLocked: !def.rotation,
    gaze: { point: null, dir: [0, 1], target: null },
    stats: { pins: 0, chains: 0, bestChain: 0, reveals: 0, walked: 0, walkSigned: 0, rotated: 0, pinTime: 0, longestPin: 0, unravels: 0, choirBreaks: 0, crossings: 0, closeCalls: 0 },
    walkHist: new Float32Array(600), walkIdx: 0,
    rec: [], habit: opt.habit || { dir: 0 },
    flags: {}, hint: null,
  };
  const pupilR = G.Ri * RULES.pupilFrac;
  const gear = k => (k % 2 === 0 ? 1 : -1);
  S.gear = gear;

  // ---------- player ----------
  const pk = (def.player && def.player.k) || 0;
  S.P = { k: pk, a: (def.player && def.player.a !== undefined ? def.player.a : -90) * DEG, v: 0, rad: RULES.playerRad, crossT: 0, crossFrom: G.rings[pk].r, exposure: 0, marked: 0, stagger: 0, w: 0, moved: 0, bump: 0, alive: true };

  // ---------- eyes ----------
  const byName = {};
  (def.eyes || []).forEach((src, i) => addEye(src));
  function addEye(src) {
    const T = EYE_TYPES[src.type];
    const e = Object.assign({
      id: S.eyes.length, name: src.name || ('e' + S.eyes.length), type: src.type,
      k: src.k || 0, a: (src.a || 0) * DEG, rad: T.rad * (src.size || 1) * G.eyeScale, spd: T.spd * (src.speed || 1),
      lethal: T.lethal, solid: T.solid, pinnable: T.pinnable, inWall: !!T.inWall, anchored: !!T.anchored,
      decoy: !!T.decoy, immune: !!T.immune, feigns: !!T.feigns,
      state: src.wake || src.wakeAfterWalk ? ST.DORMANT : ST.ACTIVE, wake: src.wake || src.wakeAfterWalk || 0, wakeAfterWalk: !!src.wakeAfterWalk, wakeNear: src.wakeNear === undefined ? 1.7 : src.wakeNear,
      beh: src.beh || defaultBeh(src.type), dir: src.dir || 1, pause: 0,
      acq: 0, rel: 0, stun: 0, debt: 0, lunge: 0, pinTheta: 0, pinT: 0,
      group: null, knot: null, cause: null, causeT: -99,
      look: [0, 0], blinkAt: 1 + rng() * 4, seenT: 0, absorbT: 0,
      moved: 0, lead: src.lead || 0, delay: src.delay || 0.9, mirror: src.mirror || 1, track: src.track || null, trackI: src.trackOffset || 0,
      fix: 0, fixId: -1, fixCool: 0, aim: 0, seeing: false, acquiring: false, stare: false,
      face: src.face || 'out', sweep: (src.sweep === undefined ? 30 : src.sweep) * DEG, period: src.period || 6, phase: (src.phase || 0) * DEG,
      range: src.range || 6.5, half: (src.half || 18) * DEG, gather: 0, pulledBy: -1,
      wall: src.wall === undefined ? -1 : src.wall, crossCool: 0, stunTo: ST.ACTIVE,
    }, src.extra || {});
    if (e.inWall) { e.wall = src.wall; e.k = src.wall + 1; }
    if (e.decoy) e.lookFix = (src.lookAt || rng() * 360) * DEG;
    e.aim = 0;
    byName[e.name] = e;
    S.eyes.push(e);
    return e;
  }
  function defaultBeh(type) {
    return { watcher: 'stalk', drifter: 'drift', collector: 'collect', liar: 'stalk', mimic: 'mimic', choir: 'stalk', crown: 'stalk', unblinking: 'hunt', echo: 'echo' }[type] || 'still';
  }
  S.addEye = src => { const e = addEye(src); if (e.wake) e.state = ST.DORMANT; return e; };
  S.eye = name => byName[name];

  // formations (choirs and the crown)
  (def.choirs || []).forEach(c => {
    const g = { id: S.groups.length, name: c.name || 'choir', crown: !!c.crown, members: c.members.map(m => byName[m].id), order: c.members.map(m => byName[m].id),
      conductor: byName[c.conductor].id, dir: c.dir || 1, spd: c.spd || 0.95, pause: 0, rip: c.ripple || 2.4, period: c.ripple || 2.4, broken: false, breaks: 0, needBreaks: c.breaks || 3, reform: 0 };
    for (const id of g.members) S.eyes[id].group = g.id;
    S.groups.push(g);
  });
  // doors held open by an eye
  for (const w of S.walls) for (const d of w.doors) if (d.lid) d.lidId = byName[d.lid].id;

  // ---------- geometry helpers ----------
  const eyeR = e => (e.inWall ? S.walls[e.wall].r : S.rings[e.k].r);
  const eyeTheta = e => e.a + S.phi[e.k];
  S.eyeR = eyeR; S.eyeTheta = eyeTheta;
  S.eyePos = (e, out) => { out = out || [0, 0]; const r = eyeR(e), th = eyeTheta(e); out[0] = r * Math.cos(th); out[1] = r * Math.sin(th); return out; };
  S.playerTheta = () => S.P.a + S.phi[S.P.k];
  S.playerR = () => S.rings[S.P.k].r;
  S.playerPos = out => { out = out || [0, 0]; const r = S.playerR(), th = S.playerTheta(); out[0] = r * Math.cos(th); out[1] = r * Math.sin(th); return out; };
  S.doorTheta = (w, d) => d.a + S.phi[w.owner];
  S.doorOpen = d => !d.sealed && (d.lidId === undefined || HELD(S.eyes[d.lidId].state));
  const alive = e => e.state !== ST.DEAD;
  const groove = e => !e.inWall;
  // bodies that stop things moving in a groove
  const blocksEyes = e => alive(e) && groove(e) && e.solid && e.state !== ST.REVEALED;
  // contact: arc distance along a ring between local angles
  const arc = (k, a, b) => Math.abs(wrap(a - b)) * S.rings[k].r;

  function ev(type, o) { const e = Object.assign({ type, t: S.t }, o || {}); S.events.push(e); return e; }

  // ---------- chains: one deliberate act, several visible consequences ----------
  function newCause(eye, kind) {
    const c = { id: S.causes.length, eye: eye ? eye.id : -1, kind: kind || 'pin', t: S.t, links: new Set(), level: 0 };
    S.causes.push(c);
    if (eye) { eye.cause = c.id; eye.causeT = S.t; }
    return c;
  }
  const CAUSE_WINDOW = 7;
  function liveCause(e) { return e && e.cause !== null && S.t - S.causes[e.cause].t < CAUSE_WINDOW ? S.causes[e.cause] : null; }
  // `who` reacted because of something carrying a cause; it now carries it too
  function react(cause, whoKey, who) {
    if (!cause) return;
    if (who && who.id !== cause.eye && (who.cause !== cause.id)) { who.cause = cause.id; who.causeT = S.t; }
    if (whoKey === cause.eye) return;
    if (!cause.links.has(whoKey) && who) ev('link', { from: cause.eye, to: who.id, cause: cause.id });
    cause.links.add(whoKey);
    const n = cause.links.size;
    if (n >= 2 && n > cause.level) {
      if (cause.level < 2) S.stats.chains++;
      cause.level = n; S.stats.bestChain = Math.max(S.stats.bestChain, n);
      ev('chain', { cause: cause.id, n, eye: cause.eye });
    }
  }

  // ---------- occlusion ----------
  const _ts = [];
  // is the sight line from (ax,ay) to (bx,by) blocked? ignore up to two eyes (the looker and the looked-at)
  function occluded(ax, ay, bx, by, ig1, ig2) {
    if (segPointDist(ax, ay, bx, by, 0, 0).d < pupilR) return 'pupil';
    for (const w of S.walls) {
      if (!w.veils.length) continue;
      segCircle(ax, ay, bx, by, w.r, _ts);
      for (const t of _ts) {
        const th = Math.atan2(ay + (by - ay) * t, ax + (bx - ax) * t) - S.phi[w.owner];
        for (const v of w.veils) if (inArc(wrap0(th), wrap0(v[0]), wrap0(v[1]))) return 'veil';
      }
    }
    const p = [0, 0];
    for (const e of S.eyes) {
      if (e === ig1 || e === ig2 || !alive(e) || e.decoy || e.state === ST.REVEALED) continue;
      S.eyePos(e, p);
      const r = segPointDist(ax, ay, bx, by, p[0], p[1]);
      if (r.d < e.rad * 0.72 && r.t > 0.03 && r.t < 0.97) return e;
    }
    return null;
  }
  S.occluded = occluded;

  // ---------- movement along a ring ----------
  // obstacles for a body of radius rad at local angle a on ring k moving by dA (radians).
  // Returns { dA: allowed, hit: body|'barrier'|'player'|null }
  function probe(k, a, rad, dA, self, opts) {
    if (!dA) return { dA: 0, hit: null };
    const dir = dA > 0 ? 1 : -1, r = S.rings[k].r;
    let max = Math.abs(dA), hit = null;
    for (const b of S.rings[k].barriers) {
      const d = wrap(b - a) * dir;
      if (d > 0) { const gap = d - (rad + 0.12) / r; if (gap < max) { max = Math.max(0, gap); hit = 'barrier'; } }
    }
    for (const o of S.eyes) {
      if (o === self || o.k !== k || !blocksEyes(o)) continue;
      if (opts && opts.group !== undefined && o.group === opts.group && o.state === ST.ACTIVE) continue;
      const d = wrap(o.a - a) * dir;
      if (d > 0) { const gap = d - (rad + o.rad) / r; if (gap < max) { max = Math.max(0, gap); hit = o; } }
    }
    if (opts && opts.player && S.P.k === k) {
      const d = wrap(S.P.a - a) * dir;
      if (d > 0) { const gap = d - (rad + S.P.rad) / r; if (gap < max) { max = Math.max(0, gap); hit = 'player'; } }
    }
    return { dA: max * dir, hit };
  }
  function moveEye(e, dA, opts) {
    const res = probe(e.k, e.a, e.rad, dA, e, opts || (e.lethal ? null : { player: true }));
    e.a = wrap(e.a + res.dA);
    e.moved += Math.abs(res.dA) * S.rings[e.k].r;
    if (res.hit && typeof res.hit === 'object') {
      const c = liveCause(res.hit);
      if (c && (HELD(res.hit.state) || res.hit.cause === c.id)) react(c, e.id, e);
    }
    return res;
  }
  // which way along ring k from local a reaches local target t, respecting barriers
  function dirTo(k, a, t) {
    const bars = S.rings[k].barriers;
    const diff = wrap(t - a);
    if (!bars.length) return Math.abs(diff) < 1e-4 ? 0 : sign(diff);
    let ccwBar = TAU, cwBar = TAU;
    for (const b of bars) { ccwBar = Math.min(ccwBar, wrap0(b - a)); cwBar = Math.min(cwBar, wrap0(a - b)); }
    const ccw = wrap0(t - a), cw = wrap0(a - t);
    if (ccw < 1e-4 || cw < 1e-4) return 0;
    if (ccw < ccwBar && (cw >= cwBar || ccw <= cw)) return 1;
    if (cw < cwBar) return -1;
    // unreachable: lean against the end nearest the target
    const endCcw = a + ccwBar, endCw = a - cwBar;
    return Math.abs(wrap(t - endCcw)) < Math.abs(wrap(t - endCw)) ? 1 : -1;
  }
  S.dirTo = dirTo;

  // ---------- rotation ----------
  function pushChain(k, mover, amt, snap, depth) {
    if (depth > 16) return false;
    const dir = amt > 0 ? 1 : -1, mag = Math.abs(amt), r = S.rings[k].r;
    for (const b of S.rings[k].barriers) {
      const d = wrap(b - mover.a) * dir;
      if (d > 0 && d - (mover.rad + 0.12) / r < mag - 1e-9) return false;
    }
    for (const o of S.eyes) {
      if (o === mover || o.k !== k || !blocksEyes(o)) continue;
      const d = wrap(o.a - mover.a) * dir;
      if (d <= 0) continue;
      const gap = d - (mover.rad + o.rad) / r;
      if (gap < mag - 1e-9) {
        if (o.anchored || HELD(o.state) || o.state === ST.KNOT) return false;
        const need = (mag - Math.max(0, gap)) * dir;
        if (!pushChain(k, o, need, snap, depth + 1)) return false;
        if (!o.shoved) { o.shoved = true; const c = liveCause(mover); if (c) react(c, o.id, o); }
      }
    }
    snap.push(mover, mover.a);
    mover.a = wrap(mover.a + amt);
    return true;
  }
  function rotateStep(d) {
    const snap = [];
    const phi0 = S.phi.slice();
    for (let k = 0; k <= N; k++) if (k !== S.P.k) S.phi[k] += gear(k) * d;
    for (const e of S.eyes) {
      if (!HELD(e.state) || e.inWall || e.k === S.P.k || !alive(e)) continue;
      if (!pushChain(e.k, e, -gear(e.k) * d, snap, 0)) {
        for (let i = snap.length - 2; i >= 0; i -= 2) snap[i].a = snap[i + 1];
        S.phi = phi0;
        return false;
      }
    }
    return true;
  }
  function rotate(delta) {
    if (!delta) return 0;
    const subs = Math.ceil(Math.abs(delta) / 0.006), d = delta / subs;
    let done = 0;
    for (let i = 0; i < subs; i++) {
      if (!rotateStep(d)) { if (S.jam <= 0) ev('jam'); S.jam = 0.3; break; }
      done += d;
    }
    return done;
  }
  S.rotate = rotate;

  // ---------- the traveller ----------
  // best door on the wall in direction dirIn from the player's world angle
  function nearestDoor(wallIdx, th, needOpen) {
    if (wallIdx < 0 || wallIdx >= N) return null;
    const w = S.walls[wallIdx];
    let best = null, bd = 1e9;
    for (const d of w.doors) {
      if (needOpen && !S.doorOpen(d)) continue;
      const dth = wrap(S.doorTheta(w, d) - th), dd = Math.abs(dth);
      if (dd < bd) { bd = dd; best = { w, d, dth, arc: dd * w.r }; }
    }
    return best;
  }
  S.nearestDoor = nearestDoor;
  function landingBlock(k2, a2, rad) {
    if (k2 >= N) return null;
    const r = S.rings[k2].r;
    for (const b of S.rings[k2].barriers) if (Math.abs(wrap(b - a2)) * r < rad + 0.12) return 'barrier';
    for (const e of S.eyes) {
      if (e.k !== k2 || !groove(e) || !alive(e) || !e.solid || e.state === ST.REVEALED) continue;
      const dd = Math.abs(wrap(e.a - a2)) * r;
      if (dd < rad + e.rad) return e;
    }
    return null;
  }
  function tryCross(inward) {
    const P = S.P, th = S.playerTheta();
    const wi = inward ? P.k : P.k - 1;
    const nd = nearestDoor(wi, th, true);
    if (!nd) return false;
    if (nd.arc > RULES.doorHalf * nd.d.wscale - P.rad * 0.5) return false;
    const k2 = inward ? P.k + 1 : P.k - 1;
    if (k2 === N) { S.reached = true; P.k2 = N; ev('reach'); return true; }
    const a2 = wrap(th - S.phi[k2]);
    const blk = landingBlock(k2, a2, P.rad);
    if (blk && (blk === 'barrier' || !(blk.lethal && (blk.state === ST.ACTIVE || blk.state === ST.FEIGN)))) {
      if (P.bump <= 0) { ev('bump', { by: blk === 'barrier' ? -1 : blk.id }); P.bump = 0.5; }
      return false;
    }
    P.crossFrom = S.rings[P.k].r; P.crossT = RULES.crossTime;
    ev('cross', { from: P.k, to: k2, wall: wi, door: nd.d.i });
    P.k = k2; P.a = a2; P.v = 0; S.stats.crossings++;
    return true;
  }
  function stepPlayer(input, dt) {
    const P = S.P;
    P.bump -= dt; P.moved = 0;
    const m = input.move || [0, 0];
    const th = S.playerTheta();
    const tx = -Math.sin(th), ty = Math.cos(th), ux = Math.cos(th), uy = Math.sin(th);
    const vt = m[0] * tx + m[1] * ty, vr = m[0] * ux + m[1] * uy;
    let target = vt * RULES.walk;
    if (P.stagger > 0) { P.stagger -= dt; target = 0; }
    else if (P.crossT > 0) { P.crossT -= dt; target = 0; }
    else if (Math.abs(vr) > 0.45 && Math.abs(vr) >= Math.abs(vt) * 0.85) {
      const inward = vr < 0;
      if (tryCross(inward)) return;
      const nd = nearestDoor(inward ? P.k : P.k - 1, th, false);
      if (nd && nd.arc < RULES.doorAssist && nd.arc > 0.04) target = sign(nd.dth) * RULES.walk * Math.min(1, Math.abs(vr) * 1.2);
    }
    P.v = damp(P.v, target, RULES.walkAccel, dt);
    if (Math.abs(P.v) < 1e-3) P.v = 0;
    const r = S.rings[P.k].r;
    let dA = P.v * dt / r;
    if (dA) {
      // the traveller is stopped by barriers and by anything solid that will not kill them
      const dir = sign(dA);
      let max = Math.abs(dA);
      for (const b of S.rings[P.k].barriers) { const d = wrap(b - P.a) * dir; if (d > 0) max = Math.min(max, Math.max(0, d - (P.rad + 0.12) / r)); }
      for (const e of S.eyes) {
        if (e.k !== P.k || !groove(e) || !alive(e) || !e.solid || e.state === ST.REVEALED) continue;
        if (e.lethal && (e.state === ST.ACTIVE || e.state === ST.FEIGN)) continue;
        const d = wrap(e.a - P.a) * dir;
        if (d > 0) max = Math.min(max, Math.max(0, d - (P.rad + e.rad) / r));
      }
      if (max < Math.abs(dA) - 1e-9) { P.v = 0; }
      dA = max * dir;
      P.a = wrap(P.a + dA);
    }
    P.w = dA / dt;
    P.moved = Math.abs(dA) * r;
    S.stats.walked += P.moved; S.stats.walkSigned += dA;
    S.walkHist[S.walkIdx] = dA; S.walkIdx = (S.walkIdx + 1) % S.walkHist.length;
    if ((S.steps & 3) === 0) S.rec.push(Math.round(P.w * 1000) / 1000);
  }

  // ---------- gaze ----------
  const _pp = [0, 0], _ep = [0, 0];
  function targetable(e) { return alive(e) && e.state !== ST.REVEALED && !e.hidden; }
  function selectTarget() {
    const g = S.gaze;
    if (!g.point) return null;
    S.playerPos(_pp);
    const dx = g.point[0] - _pp[0], dy = g.point[1] - _pp[1], l = Math.hypot(dx, dy);
    if (l > 0.08) { g.dir[0] = dx / l; g.dir[1] = dy / l; }
    let best = null, bs = 1e9, bd = 1e9;
    for (const e of S.eyes) {
      if (!targetable(e)) continue;
      S.eyePos(e, _ep);
      const vx = _ep[0] - _pp[0], vy = _ep[1] - _pp[1], d = Math.hypot(vx, vy);
      if (d < 1e-3) continue;
      const off = Math.acos(clamp((vx * g.dir[0] + vy * g.dir[1]) / d, -1, 1));
      const cone = RULES.gazeCone + Math.asin(Math.min(1, e.rad / d));
      if (off > cone) continue;
      if (occluded(_pp[0], _pp[1], _ep[0], _ep[1], e, null)) continue;
      const s = off - (e.id === g.target ? RULES.gazeStick : 0);
      if (s < bs - 1e-6 || (Math.abs(s - bs) <= 1e-6 && (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && e.id < best.id)))) { best = e; bs = s; bd = d; }
    }
    return best;
  }
  S.selectTarget = selectTarget;
  function pin(e) {
    const prev = e.state;
    e.state = ST.PINNED; e.acq = 0; e.pinTheta = eyeTheta(e); e.pinT = S.t; e.wasDormant = prev === ST.DORMANT;
    S.stats.pins++;
    const c = newCause(e, 'pin');
    ev('pin', { eye: e.id });
    if (e.group !== null) onGroupPin(e, c, prev);
  }
  function unpin(e) {
    e.state = ST.ACTIVE; e.pause = 0.25;
    const held = S.t - e.pinT; S.stats.longestPin = Math.max(S.stats.longestPin, held);
    ev('release', { eye: e.id, held });
  }
  function stepGaze(dt) {
    const tgt = selectTarget();
    const prevT = S.gaze.target;
    S.gaze.target = tgt ? tgt.id : null;
    if (prevT !== S.gaze.target && tgt) ev('target', { eye: tgt.id });
    const knotHit = new Set();
    for (const e of S.eyes) {
      if (!alive(e)) continue;
      const isT = tgt === e;
      e.acquiring = false; e.stare = false;
      if (e.state === ST.KNOT) { if (isT) knotHit.add(e.knot); continue; }
      if (e.decoy) {
        if (e.state === ST.REVEALED) continue;
        if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= 0.45) { e.state = ST.REVEALED; S.stats.reveals++; ev('reveal', { eye: e.id }); } }
        else e.acq = Math.max(0, e.acq - dt);
        continue;
      }
      if (e.immune) { if (isT) { e.stare = true; if (!e.stared) ev('immune', { eye: e.id }); } e.stared = isT; continue; }
      if (e.feigns) {
        if (e.state === ST.FEIGN) {
          if (isT) e.debt = Math.min(4, e.debt + dt);
          else { e.state = ST.ACTIVE; e.lunge = e.debt * 1.75; ev('lunge', { eye: e.id, debt: e.debt }); e.debt = 0; }
        } else if (e.state === ST.ACTIVE || e.state === ST.DORMANT) {
          if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= RULES.acquire) { e.state = ST.FEIGN; e.acq = 0; e.debt = 0; S.stats.pins++; ev('feign', { eye: e.id }); } }
          else e.acq = 0;
        }
        continue;
      }
      if (!e.pinnable) continue;
      if (e.state === ST.PINNED) { S.stats.pinTime += dt; if (!isT) { e.state = ST.RELEASING; e.rel = RULES.release; } }
      else if (e.state === ST.RELEASING) { if (isT) e.state = ST.PINNED; else { e.rel -= dt; if (e.rel <= 0) unpin(e); } }
      else if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= RULES.acquire) pin(e); }
      else e.acq = Math.max(0, e.acq - dt * 2);
    }
    for (const kn of S.knots) {
      if (knotHit.has(kn.id)) { kn.unravel += dt; kn.gazed = true; } else { kn.unravel = Math.max(0, kn.unravel - dt * 0.6); kn.gazed = false; }
      if (kn.unravel >= 1.2) unravel(kn);
    }
    S.knots = S.knots.filter(k => !k.done);
  }

  // ---------- formations ----------
  function onGroupPin(e, cause, prev) {
    const g = S.groups[e.group];
    if (g.broken) return;
    if (g.crown) {
      // only the conductor of a whole, singing crown breaks; anything else held only jams it
      if (e.id !== g.conductor || prev === ST.STUNNED) return;
      // the jewel breaks: that eye closes for good; the rest reel, then reform around the next
      e.state = ST.DEAD; e.group = null; g.breaks++;
      ev('crownBreak', { eye: e.id, breaks: g.breaks });
      const rest = g.members.filter(id => S.eyes[id].state !== ST.DEAD && S.eyes[id].group === g.id);
      for (const id of rest) { const m = S.eyes[id]; m.state = ST.STUNNED; m.stun = 2.6; m.stunTo = ST.ACTIVE; react(cause, id, m); }
      if (g.breaks >= g.needBreaks || rest.length < 2) {
        g.broken = true;
        for (const id of rest) { const m = S.eyes[id]; m.state = ST.DEAD; }
        ev('crownFall', { group: g.id });
      } else {
        const ord = g.order.filter(id => rest.includes(id));
        g.conductor = ord[(ord.indexOf(g.order[(g.order.indexOf(e.id) + 1) % g.order.length]) + ord.length) % ord.length] || ord[0];
        if (!rest.includes(g.conductor)) g.conductor = ord[0];
        g.rip = 2.8;
      }
      if (S.gaze.target === e.id) S.gaze.target = null;
      return;
    }
    if (e.id === g.conductor) {
      g.broken = true;
      ev('choirBreak', { group: g.id });
      S.stats.choirBreaks++;
      for (const id of g.members) {
        const m = S.eyes[id];
        if (m.group !== g.id) continue;
        m.group = null; m.beh = 'stalk'; m.spd *= 0.55;
        if (m !== e) { m.state = ST.STUNNED; m.stun = 2.6; m.stunTo = ST.ACTIVE; react(cause, id, m); }
      }
    } else {
      e.group = null; e.beh = 'stalk'; e.spd *= 0.7;
      ev('detach', { eye: e.id, group: g.id });
    }
  }
  function stepGroups(dt) {
    for (const g of S.groups) {
      if (g.broken) continue;
      const mov = g.members.map(id => S.eyes[id]).filter(m => m.group === g.id && m.state === ST.ACTIVE);
      // ripple: the conductor blinks first, the rest follow in order of distance from it
      g.rip -= dt;
      if (g.rip <= 0) {
        g.rip = g.period;
        const ci = g.order.indexOf(g.conductor);
        g.order.forEach((id, i) => { const m = S.eyes[id]; if (m.group === g.id) m.blinkAt = S.t + 0.13 * Math.min(Math.abs(i - ci), g.order.length - Math.abs(i - ci)); });
        ev('ripple', { group: g.id, conductor: g.conductor });
      }
      if (S.t < RULES.graceStart || !mov.length) continue;
      if (g.pause > 0) { g.pause -= dt; continue; }
      const cond = S.eyes[g.conductor];
      const rRef = S.rings[(cond && cond.state !== ST.DEAD ? cond : mov[0]).k].r;
      const dA = g.dir * g.spd * dt / rRef;
      let allow = Math.abs(dA), hit = null;
      for (const m of mov) {
        const res = probe(m.k, m.a, m.rad, dA, m, { group: g.id });
        if (Math.abs(res.dA) < allow) { allow = Math.abs(res.dA); hit = res.hit; }
      }
      for (const m of mov) { m.a = wrap(m.a + allow * g.dir); m.moved += allow * S.rings[m.k].r; }
      if (allow < Math.abs(dA) * 0.5) {
        g.dir = -g.dir; g.pause = 0.3;
        ev('turn', { group: g.id, by: hit && typeof hit === 'object' ? hit.id : -1 });
        if (hit && typeof hit === 'object') { const c = liveCause(hit); if (c) react(c, 'g' + g.id, null); }
      }
    }
  }

  // ---------- gatherings ----------
  // collectors gather eyes that look; the blind drifter is never gathered
  const gatherable = o => groove(o) && o.state === ST.ACTIVE && o.group === null && o.lethal && !o.immune && !o.decoy && o.type !== 'collector';
  S.gatherable = gatherable;
  function cluster(c) {
    const out = [c], seen = new Set([c.id]);
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      for (const o of S.eyes) {
        if (seen.has(o.id) || o.k !== c.k || !gatherable(o)) continue;
        if (arc(c.k, a.a, o.a) <= a.rad + o.rad + 0.1) { seen.add(o.id); out.push(o); }
      }
    }
    return out;
  }
  function stepGather(dt) {
    for (const c of S.eyes) {
      if (c.type !== 'collector' || c.state !== ST.ACTIVE || S.t < RULES.graceStart) { if (c.type === 'collector') c.gather = Math.max(0, c.gather - dt); continue; }
      const cl = cluster(c);
      c.clusterN = cl.length;
      if (cl.length >= 3) {
        c.gather += dt;
        if (c.gather >= 1.5) {
          const kn = { id: S.knots.length ? S.knots[S.knots.length - 1].id + 1 : 0, members: cl.map(e => e.id), unravel: 0, k: c.k };
          for (const e of cl) { e.state = ST.KNOT; e.knot = kn.id; }
          S.knots.push(kn); c.gather = 0;
          ev('knot', { members: kn.members });
        }
      } else c.gather = Math.max(0, c.gather - dt * 0.5);
    }
  }
  function unravel(kn) {
    kn.done = true;
    const c = newCause(null, 'unravel');
    S.stats.unravels++;
    // the knot bursts: members are flung apart along the groove, away from its middle
    const mem = kn.members.map(id => S.eyes[id]);
    const mid = Math.atan2(mem.reduce((s, e) => s + Math.sin(e.a), 0), mem.reduce((s, e) => s + Math.cos(e.a), 0));
    for (const e of mem) { e.knot = null; e.state = ST.STUNNED; e.stun = e.type === 'collector' ? 4 : 2.2; e.stunTo = ST.ACTIVE; react(c, e.id, e); }
    const r = S.rings[kn.k].r;
    const order = mem.slice().sort((a, b) => Math.abs(wrap(b.a - mid)) - Math.abs(wrap(a.a - mid)));
    order.forEach((e, i) => {
      const d = wrap(e.a - mid);
      const dir = Math.abs(d) * r < 0.2 ? (e.id % 2 ? 1 : -1) : sign(d);
      moveEye(e, dir * (i < order.length - 1 ? 2.8 : 1.5) / r, { player: true });
    });
    ev('unravel', { members: kn.members });
  }

  // ---------- behaviours ----------
  function stalkTarget(e) {
    const P = S.P;
    let th = S.playerTheta();
    if (e.lead) th += clamp(P.w * e.lead, -1.2, 1.2);
    return wrap(th - S.phi[e.k]);
  }
  function stepEye(e, dt) {
    e.moved = 0; e.shoved = false;
    if (e.state === ST.DORMANT) {
      if (!e.wakeAfterWalk || S.stats.walked > 0.5) e.wake -= dt;
      const near = e.k === S.P.k && groove(e) && arc(e.k, e.a, S.P.a) < e.wakeNear + e.rad;
      if (e.wake <= 0 || near) { e.state = ST.ACTIVE; e.pause = 0.4; ev('wake', { eye: e.id }); }
      return;
    }
    if (e.state === ST.STUNNED) { e.stun -= dt; if (e.stun <= 0) { e.state = e.stunTo; ev('recover', { eye: e.id }); } return; }
    if (e.state !== ST.ACTIVE || e.inWall || e.group !== null) return;
    if (S.t < RULES.graceStart) return;
    if (e.pause > 0) { e.pause -= dt; return; }
    const r = S.rings[e.k].r;
    // a collector's pull overrides what an eye would otherwise do
    if (e.pulledBy >= 0) {
      const c = S.eyes[e.pulledBy];
      if (arc(e.k, e.a, c.a) <= e.rad + c.rad + 0.08) return;   // held in the gathering
      const d = dirTo(e.k, e.a, c.a);
      moveEye(e, d * Math.max(e.spd, 0.7) * 0.85 * dt / r);
      return;
    }
    switch (e.beh) {
      case 'stalk': {
        const t = stalkTarget(e), d = dirTo(e.k, e.a, t);
        let spd = e.spd;
        if (e.lunge > 0) spd = 3.4;
        let dA = d * spd * dt / r;
        if (e.k !== S.P.k) { const rem = Math.abs(wrap(t - e.a)); if (Math.abs(dA) > rem) dA = d * rem; }
        const res = moveEye(e, dA);
        if (e.lunge > 0) { e.lunge -= Math.abs(res.dA) * r; if (Math.abs(res.dA) < 1e-6) e.lunge = Math.max(0, e.lunge - dt * 3); }
        break;
      }
      case 'patrol': case 'drift': {
        const res = moveEye(e, e.dir * e.spd * dt / r);
        if (Math.abs(res.dA) < Math.abs(e.dir * e.spd * dt / r) * 0.5) {
          e.dir = -e.dir; e.pause = e.beh === 'drift' ? 0.5 : 0.3;
          ev('turn', { eye: e.id, by: res.hit && typeof res.hit === 'object' ? res.hit.id : (res.hit || -1) });
        }
        break;
      }
      case 'collect': {
        // drift toward the nearest eye on this ring that is free to gather
        let best = null, bd = 1e9;
        for (const o of S.eyes) {
          if (o === e || o.k !== e.k || !gatherable(o)) continue;
          const dd = arc(e.k, e.a, o.a);
          if (dd < bd) { bd = dd; best = o; }
        }
        e.colTarget = best ? best.id : -1;
        if ((e.clusterN || 1) >= 2) break;   // it has company; now it waits and draws the rest in
        if (best && bd > e.rad + best.rad + 0.06) {
          const d = dirTo(e.k, e.a, best.a);
          const res = moveEye(e, d * e.spd * dt / r);
          if (res.hit && typeof res.hit === 'object' && res.hit !== best && HELD(res.hit.state)) e.colBlocked = res.hit.id; else e.colBlocked = -1;
        }
        break;
      }
      case 'mimic': {
        const steps = Math.round(e.delay / SIM_DT);
        const len = S.walkHist.length;
        const d = S.walkHist[((S.walkIdx - steps) % len + len) % len];
        if (d) moveEye(e, d * (e.mirror || 1));
        break;
      }
      case 'echo': {
        if (!e.track || !e.track.length) break;
        // a recording of the traveller, sampled every 4 steps, replayed on a loop
        const w = e.track[Math.floor(e.trackI / 4) % e.track.length] * (e.trackScale || 1);
        e.trackI++;
        if (w) moveEye(e, w * dt * (S.rings[e.trackK || e.k] ? 1 : 1));
        break;
      }
      case 'hunt': hunt(e, dt); break;
    }
  }
  function hunt(e, dt) {
    const P = S.P, r = S.rings[e.k].r;
    if (e.k === P.k) { const t = stalkTarget(e); moveEye(e, dirTo(e.k, e.a, t) * e.spd * dt / r); return; }
    e.crossCool -= dt;
    const inward = P.k > e.k;
    const wi = inward ? e.k : e.k - 1;
    const th = eyeTheta(e);
    const nd = nearestDoor(wi, th, true);
    if (!nd) { const t = stalkTarget(e); moveEye(e, dirTo(e.k, e.a, t) * e.spd * dt / r); return; }
    if (nd.arc < RULES.doorHalf * nd.d.wscale * 0.5 && e.crossCool <= 0) {
      const k2 = inward ? e.k + 1 : e.k - 1;
      const a2 = wrap(th - S.phi[k2]);
      const blk = landingBlock(k2, a2, e.rad);
      if (!blk || blk === null) { ev('eyeCross', { eye: e.id, from: e.k, to: k2 }); e.k = k2; e.a = a2; e.crossCool = 0.6; e.pause = 0.25; return; }
    }
    const tLocal = wrap(S.doorTheta(nd.w, nd.d) - S.phi[e.k]);
    const d = dirTo(e.k, e.a, tLocal);
    let dA = d * e.spd * dt / r;
    const rem = Math.abs(wrap(tLocal - e.a)); if (Math.abs(dA) > rem) dA = d * rem;
    moveEye(e, dA);
  }
  function stepAbsorb(dt) {
    for (const u of S.eyes) {
      if (!u.immune || u.state !== ST.ACTIVE) continue;
      for (const o of S.eyes) {
        if (o === u || o.k !== u.k || !groove(o) || !alive(o) || o.immune || o.anchored || HELD(o.state) || o.state === ST.KNOT || o.decoy) { continue; }
        if (arc(u.k, u.a, o.a) <= u.rad + o.rad + 0.05) {
          o.absorbT += dt;
          if (o.absorbT >= 0.8) { o.state = ST.DEAD; o.group = null; ev('absorb', { eye: o.id, by: u.id }); }
        } else o.absorbT = Math.max(0, o.absorbT - dt);
      }
    }
  }

  // ---------- sentinels ----------
  function inCone(s, sp, x, y) {
    const vx = x - sp[0], vy = y - sp[1], d = Math.hypot(vx, vy);
    if (d > s.range || d < 1e-3) return false;
    return Math.abs(wrap(Math.atan2(vy, vx) - s.aim)) <= s.half;
  }
  S.inCone = inCone;
  const _sp = [0, 0], _op = [0, 0];
  function stepSentinels(dt) {
    let seen = false;
    for (const s of S.eyes) {
      if (s.type !== 'sentinel' || !alive(s)) continue;
      S.eyePos(s, _sp);
      const th = eyeTheta(s);
      const base = s.face === 'in' ? th + Math.PI : s.face === 'cw' ? th - Math.PI / 2 : s.face === 'ccw' ? th + Math.PI / 2 : th;
      let aim = base + s.sweep * Math.sin(TAU * S.t / s.period + s.phase);
      s.fixCool -= dt;
      if (s.fix > 0) {
        s.fix -= dt;
        const o = S.eyes[s.fixId];
        if (o && alive(o)) { S.eyePos(o, _op); const want = Math.atan2(_op[1] - _sp[1], _op[0] - _sp[0]); aim = base + clamp(wrap(want - base), -1.1, 1.1); }
        if (s.fix <= 0) s.fixCool = 1.6;
      }
      s.aim = aim;
      s.seeing = false;
      s.watching = s.state === ST.ACTIVE && !s.acquiring;
      if (!s.watching || S.t < RULES.graceStart) continue;
      // a moving eye crossing its gaze draws it away
      if (s.fix <= 0 && s.fixCool <= 0) {
        for (const o of S.eyes) {
          if (o === s || !alive(o) || o.inWall || o.decoy || o.moved < 1e-4 || o.state !== ST.ACTIVE) continue;
          S.eyePos(o, _op);
          if (inCone(s, _sp, _op[0], _op[1]) && !occluded(_sp[0], _sp[1], _op[0], _op[1], s, o)) {
            s.fix = 1.6; s.fixId = o.id; ev('fixate', { eye: s.id, on: o.id });
            const c = liveCause(o); if (c) react(c, s.id, s);
            break;
          }
        }
      }
      S.playerPos(_pp);
      if (inCone(s, _sp, _pp[0], _pp[1]) && !occluded(_sp[0], _sp[1], _pp[0], _pp[1], s, null)) {
        s.seeing = true; seen = true;
        S.P.exposure += RULES.exposureRate * dt;
        if (S.P.exposure >= 1) { capture('seen', s); return; }
      }
    }
    if (!seen) S.P.exposure = Math.max(0, S.P.exposure - RULES.exposureDecay * dt);
  }

  // ---------- contact ----------
  function capture(kind, e) {
    if (S.over) return;
    S.over = { kind, eye: e ? e.id : -1, type: e ? e.type : null, t: S.t };
    S.P.alive = false;
    ev('capture', S.over);
  }
  S.capture = capture;
  function strike(e) {
    const P = S.P, r = S.rings[P.k].r;
    P.marked = RULES.markTime;
    S.stats.strikes = (S.stats.strikes || 0) + 1;
    // thrown away from the eye along the groove, as far as the groove allows
    const away = sign(wrap(P.a - e.a)) || 1;
    const want = away * RULES.knockback / r;
    let max = Math.abs(want);
    for (const b of S.rings[P.k].barriers) { const dd = wrap(b - P.a) * away; if (dd > 0) max = Math.min(max, Math.max(0, dd - (P.rad + 0.12) / r)); }
    for (const o of S.eyes) {
      if (o === e || o.k !== P.k || !groove(o) || !alive(o) || !o.solid || o.state === ST.REVEALED) continue;
      const dd = wrap(o.a - P.a) * away;
      if (dd > 0) max = Math.min(max, Math.max(0, dd - (P.rad + o.rad + 0.05) / r));
    }
    P.a = wrap(P.a + away * max); P.v = 0; P.stagger = 0.35;
    // the eye recoils: it stops, and a lunging liar spends its lunge
    e.pause = Math.max(e.pause, 1.2); e.lunge = 0;
    if (e.group !== null) S.groups[e.group].pause = Math.max(S.groups[e.group].pause, 1.2);
    ev('strike', { eye: e.id });
  }
  S.strike = strike;
  function stepContact() {
    const P = S.P;
    if (P.marked > 0) P.marked -= SIM_DT;
    let nearest = 1e9;
    for (const e of S.eyes) {
      if (e.k !== P.k || !groove(e) || !e.lethal) continue;
      if (e.state !== ST.ACTIVE && e.state !== ST.FEIGN) continue;
      const d = arc(P.k, e.a, P.a);
      if (d < e.rad * RULES.contactSlack + P.rad) {
        // a first touch strikes and throws you clear; a second while marked, or anything that cannot be held, takes you
        if (P.marked > 0 || e.immune || e.type === 'crown' || def.noStrike) { capture('contact', e); return; }
        strike(e); return;
      }
      nearest = Math.min(nearest, d - e.rad - P.rad);
    }
    if (nearest < 0.35 && !S._close) { S._close = true; S.stats.closeCalls++; ev('close'); }
    if (nearest > 1.2) S._close = false;
  }

  // ---------- look targets for pupils (what each eye is attending to) ----------
  function stepLooks() {
    S.playerPos(_pp);
    for (const e of S.eyes) {
      if (!alive(e)) continue;
      if (HELD(e.state) || e.state === ST.KNOT) continue; // a held pupil stops tracking
      S.eyePos(e, _ep);
      let lx = _pp[0], ly = _pp[1];
      if (e.decoy) { lx = _ep[0] + Math.cos(e.lookFix) * 5; ly = _ep[1] + Math.sin(e.lookFix) * 5; }
      else if (e.state === ST.FEIGN) { lx = 2 * _ep[0] - _pp[0]; ly = 2 * _ep[1] - _pp[1]; }
      else if (e.type === 'sentinel') { lx = _ep[0] + Math.cos(e.aim) * 5; ly = _ep[1] + Math.sin(e.aim) * 5; }
      else if (e.beh === 'drift' && e.state === ST.ACTIVE) { const th = eyeTheta(e) + e.dir * 0.6; const r = eyeR(e); lx = r * Math.cos(th); ly = r * Math.sin(th); }
      else if (e.type === 'collector' && e.colTarget >= 0) { S.eyePos(S.eyes[e.colTarget], _op); lx = _op[0]; ly = _op[1]; }
      e.look[0] = lx; e.look[1] = ly;
    }
  }
  function stepBlinks() {
    for (const e of S.eyes) {
      if (e.decoy || e.immune || e.group !== null || HELD(e.state)) continue;
      if (S.t > e.blinkAt + 0.2) e.blinkAt = S.t + (e.state === ST.FEIGN ? 0.55 + rng() * 0.3 : 2.4 + rng() * 4.5);
    }
  }

  // ---------- step ----------
  S.step = function (input) {
    const dt = SIM_DT;
    S.events.length = 0;
    if (S.over || S.reached) return;
    input = input || {};
    S.t += dt; S.steps++;
    S.jam -= dt;
    if (input.gaze !== undefined) S.gaze.point = input.gaze ? [input.gaze[0], input.gaze[1]] : null;
    // rotation (the dial, plus anything the spiral does to itself)
    const want = S.rotLocked ? 0 : clamp(input.rot || 0, -1, 1) * (def.rotMax || RULES.rotMax);
    S.rotVel = S.jam > 0 && sign(want) === sign(S.rotVel) ? 0 : damp(S.rotVel, want, RULES.rotSmooth, dt);
    if (Math.abs(S.rotVel) < 1e-4) S.rotVel = 0;
    const turned = rotate((S.rotVel + S.forcedRot) * dt);
    S.stats.rotated += Math.abs(turned);
    S.rotDone = turned / dt;
    if (def.script && def.script.pre) def.script.pre(S, dt);
    stepPlayer(input, dt);
    if (S.reached) return;
    stepGaze(dt);
    // collector pull
    for (const e of S.eyes) e.pulledBy = -1;
    for (const c of S.eyes) {
      if (c.type !== 'collector' || c.state !== ST.ACTIVE || S.t < RULES.graceStart) continue;
      for (const o of S.eyes) {
        if (o === c || o.k !== c.k || !gatherable(o)) continue;
        // a collector already holding one eye reaches further for the next
        if (arc(c.k, c.a, o.a) < ((c.clusterN || 1) >= 2 ? 6.5 : 3.6)) o.pulledBy = c.id;
      }
    }
    for (const e of S.eyes) stepEye(e, dt);
    stepGroups(dt);
    stepAbsorb(dt);
    stepGather(dt);
    stepSentinels(dt);
    if (!S.over) stepContact();
    stepLooks();
    stepBlinks();
    if (def.script && def.script.step) def.script.step(S, dt);
  };
  S.liveCause = liveCause;
  S.newCause = newCause;
  S.react = react;
  S.ev = ev;

  if (def.script && def.script.init) def.script.init(S, opt);
  stepLooks();
  return S;
}

// ---- 03_encounters.js ----
// =====================================================================
// The campaign: twenty authored spirals, each one deeper inside the last.
// Angles are degrees (world angle at the start, when every ring is aligned).
// doors[w]   openings in wall w (wall w turns with ring w+1)
// barriers[k] radial walls across groove k; veils[w] lashes on wall w that block sight
// =====================================================================

const ACTS = [
  null,
  { n: 1, title: 'Learning to look', sub: 'Act 1' },
  { n: 2, title: 'Control is conditional', sub: 'Act 2' },
  { n: 3, title: 'The world learns', sub: 'Act 3' },
  { n: 4, title: 'The system converges', sub: 'Act 4' },
];

const ENCOUNTERS = [
  // ------------------------------------------------------------ ACT I
  {
    id: 1, act: 1, name: 'The First Eye', par: 25,
    n: 2, rotation: false,
    doors: [[25], [200]], barriers: [[-122], []],
    player: { k: 0, a: -90 },
    eyes: [{ type: 'watcher', name: 'first', k: 0, a: 50, wakeAfterWalk: 0.8 }],
    hints: ['walk', 'look'],
  },
  {
    id: 2, act: 1, name: 'The Unwatched', intro: 'It follows you while you are not watching it.', par: 30,
    n: 2, rotation: false,
    doors: [[-30], [70]], barriers: [[40], []],
    player: { k: 0, a: -110 },
    eyes: [
      { type: 'watcher', name: 'behind', k: 0, a: -178, wake: 2.5 },
      { type: 'watcher', name: 'below', k: 1, a: -40 },
    ],
  },
  {
    id: 3, act: 1, name: 'The First Obstruction', intro: 'A watched eye blocks whatever is behind it.', par: 35,
    n: 2, rotation: false,
    doors: [[-30], [15]], barriers: [[], [30, 170]],
    player: { k: 0, a: -100 },
    eyes: [
      { type: 'watcher', name: 'pacer', k: 1, a: 10, beh: 'patrol', dir: -1, speed: 1.1 },
      { type: 'watcher', name: 'a', k: 1, a: -125 },
      { type: 'watcher', name: 'b', k: 1, a: -150 },
    ],
  },
  {
    id: 4, act: 1, name: 'The Spiral Turns', par: 45,
    n: 3, rotation: true,
    doors: [[90], [150], [0]], barriers: [[-124, -56], [], []],
    player: { k: 0, a: -90 },
    eyes: [{ type: 'watcher', name: 'keeper', k: 2, a: 110 }],
    hints: ['turn', 'hold-turn'],
  },
  // ------------------------------------------------------------ ACT II
  {
    id: 5, act: 2, name: 'The Drifter', intro: 'The drifter is blind. It goes until something stops it.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [40], [70]], barriers: [[-132, -48], [-172, 62], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'l1', k: 1, a: -160 },
      { type: 'watcher', name: 'l2', k: 1, a: -146 },
      { type: 'drifter', name: 'drift', k: 1, a: -55, dir: -1 },
      { type: 'watcher', name: 'low', k: 2, a: 100 },
    ],
  },
  {
    id: 6, act: 2, name: 'A Gathering', intro: 'Three eyes together become something worse.', par: 55,
    n: 3, rotation: true,
    doors: [[-90], [-170], [150]], barriers: [[-152, -28], [], [60]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'lurk', k: 1, a: -104 },
      { type: 'watcher', name: 'lurk2', k: 1, a: -76 },
      { type: 'collector', name: 'gatherer', k: 1, a: -10 },
      { type: 'drifter', name: 'drift2', k: 2, a: 100, dir: 1 },
    ],
  },
  {
    id: 7, act: 2, name: 'The Wrong Direction', intro: 'This one only pretends to stop when watched.', par: 50,
    n: 3, rotation: true,
    doors: [[-10], [30], [200]], barriers: [[-140], [], [120]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'liar', name: 'shy', k: 0, a: 22 },
      { type: 'liar', name: 'shy2', k: 2, a: 30 },
    ],
  },
  {
    id: 8, act: 2, name: 'Broken Formation', intro: 'They move together. One of them leads.', par: 40,
    n: 2, rotation: true,
    doors: [[-90], [-150]], barriers: [[-130, -50], [-178, -20]],
    player: { k: 0, a: -90 },
    eyes: [0, 1, 2].map(i => ({ type: 'choir', name: 'c' + i, k: 1, a: -112 + i * 13 })),
    choirs: [{ members: ['c0', 'c1', 'c2'], conductor: 'c1', dir: 1, spd: 1.7 }],
  },
  {
    id: 9, act: 2, name: 'The Narrowing', intro: 'The openings close as you go deeper.', par: 70,
    n: 5, rotation: true,
    doors: [[-90], [90], [-150], [30], [-90]],
    barriers: [[-140, -40], [-170, 10], [], [-60, 120], []],
    veils: [[], [[104, 140], [40, 76]], [], [[52, 85], [-25, 8]], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'v1', k: 2, a: 90 },
      { type: 'drifter', name: 'd1', k: 2, a: -60, dir: 1 },
      { type: 'watcher', name: 'v2', k: 4, a: 30 },
    ],
  },
  {
    id: 10, act: 2, name: 'The First Hunt', intro: 'These learned the way you walk.', par: 70,
    n: 4, rotation: true,
    doors: [[0], [90], [-90], [90]], barriers: [[-130, -50], [], [], []],
    player: { k: 0, a: -90 },
    eyes: ctx => {
      // the hunters wait on the side the traveller has favoured so far, and aim where they are going
      const d = (ctx.habit && ctx.habit.dir) || 1;
      return [
        { type: 'watcher', name: 'h1', k: 1, a: -90 + d * 25, beh: 'hunt', lead: 0.9, speed: 1.1 },
        { type: 'watcher', name: 'h2', k: 2, a: 90 - d * 35, beh: 'hunt', lead: 0.9, speed: 1.1 },
        { type: 'drifter', name: 'drift', k: 3, a: 0, dir: d },
      ];
    },
  },
  // ------------------------------------------------------------ ACT III
  {
    id: 11, act: 3, name: 'The Mimic', intro: 'It copies your steps, a moment late.', par: 55,
    n: 3, rotation: true,
    doors: [[-30], [-120], [-175]], barriers: [[-150], [], [30]],
    player: { k: 0, a: -110 },
    eyes: [
      { type: 'mimic', name: 'copy', k: 1, a: -90, delay: 0.9 },
      { type: 'mimic', name: 'mirror', k: 2, a: -150, delay: 0.9, mirror: -1 },
    ],
  },
  {
    id: 12, act: 3, name: 'The Sentinel', intro: 'The sentinel stays put. Its sight does not.', par: 60,
    n: 3, rotation: true,
    doors: [[-110], [60], [-60]], barriers: [[-135, -45], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'sentinel', name: 'gate', wall: 0, a: -50, face: 'cw', sweep: 26, period: 5, range: 7.5, half: 15, phase: 90, wake: 2.5, wakeNear: 0 },
      { type: 'watcher', name: 'low', k: 1, a: -100 },
      { type: 'drifter', name: 'drift', k: 2, a: 150, dir: 1 },
    ],
  },
  {
    id: 13, act: 3, name: 'The False Pattern', intro: 'Most of these are only drawings.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [0, 180], [100]], barriers: [[-130, -50], [], [-120]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'falseeye', name: 'f1', k: 1, a: -62, lookAt: 200 },
      { type: 'watcher', name: 'real', k: 1, a: -36, speed: 0.25 },
      { type: 'falseeye', name: 'f2', k: 1, a: -14, lookAt: 30 },
      { type: 'falseeye', name: 'f3', k: 1, a: -122, lookAt: 120 },
      { type: 'falseeye', name: 'f4', k: 1, a: -158, lookAt: 300 },
      { type: 'falseeye', name: 'f5', k: 1, a: 90, lookAt: 260 },
      { type: 'falseeye', name: 'f6', k: 2, a: -150, lookAt: 10 },
      { type: 'falseeye', name: 'f7', k: 2, a: 60, lookAt: 210 },
      { type: 'liar', name: 'among', k: 2, a: 135, speed: 0.5 },
    ],
  },
  {
    id: 14, act: 3, name: 'The Choir', intro: 'Watch the one that blinks first.', par: 55,
    n: 3, rotation: true,
    doors: [[-90], [-150], [-120]], barriers: [[-130, -50], [-178, 100], []],
    player: { k: 0, a: -90 },
    eyes: [0, 1, 2, 3, 4].map(i => ({ type: 'choir', name: 'c' + i, k: 1, a: -112 + i * 13 }))
      .concat([{ type: 'watcher', name: 'low', k: 2, a: 150 }]),
    choirs: [{ members: ['c0', 'c1', 'c2', 'c3', 'c4'], conductor: 'c3', dir: 1, spd: 1.0 }],
  },
  {
    id: 15, act: 3, name: 'The Repetition', intro: 'You have solved this before. It remembers.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [-90], [0]], barriers: [[-124, -56], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'liar', name: 'keeper', k: 2, a: -90, speed: 0.7 },
      { type: 'drifter', name: 'wedge', k: 2, a: -45, speed: 0.35, dir: 1 },
      { type: 'mimic', name: 'echoer', k: 1, a: 20, delay: 0.9, mirror: -1 },
    ],
  },
  {
    id: 16, act: 3, name: 'No Safe Direction', par: 75,
    n: 4, rotation: true,
    doors: [[-90], [90], [-30], [150]], barriers: [[-150, -30], [], [-100], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'chaser', k: 0, a: -40, beh: 'hunt', lead: 0.6 },
      { type: 'mimic', name: 'copy', k: 1, a: -60 },
      { type: 'sentinel', name: 'eye', wall: 1, a: 20, face: 'in', sweep: 40, period: 6, range: 6, half: 16 },
      { type: 'watcher', name: 'low', k: 2, a: 60 },
      { type: 'liar', name: 'shy', k: 3, a: -170 },
    ],
  },
  // ------------------------------------------------------------ ACT IV
  {
    id: 17, act: 4, name: 'The Convergence', par: 80, dread: 0.4,
    n: 4, rotation: true,
    doors: [[-90], [30], [-150], [60]], barriers: [[-150, -30], [150], [], [-20]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'collector', name: 'gatherer', k: 1, a: -10 },
      { type: 'drifter', name: 'd1', k: 1, a: -120, dir: 1 },
      { type: 'watcher', name: 'w1', k: 1, a: 90 },
      { type: 'choir', name: 'c0', k: 2, a: 60 }, { type: 'choir', name: 'c1', k: 2, a: 75 }, { type: 'choir', name: 'c2', k: 2, a: 90 }, { type: 'choir', name: 'c3', k: 2, a: 105 },
      { type: 'sentinel', name: 'eye', wall: 2, a: 0, face: 'in', sweep: 35, period: 5, range: 5, half: 18 },
      { type: 'watcher', name: 'w3', k: 3, a: 160 },
    ],
    choirs: [{ members: ['c0', 'c1', 'c2', 'c3'], conductor: 'c1', dir: 1, spd: 0.9 }],
  },
  {
    id: 18, act: 4, name: 'The Unblinking', intro: 'Your gaze does nothing to this one.', par: 90, dread: 0.55,
    n: 4, rotation: true,
    doors: [[90], [-90], [90], [-90]], barriers: [[-140, -40], [], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'unblinking', name: 'it', k: 1, a: 82, speed: 1.1 },
      { type: 'drifter', name: 'd1', k: 1, a: -150, dir: 1 },
      { type: 'drifter', name: 'd2', k: 2, a: 0, dir: -1 },
      { type: 'drifter', name: 'd3', k: 3, a: 180, dir: 1 },
    ],
  },
  {
    id: 19, act: 4, name: 'The Crown', intro: 'Break the eye that leads it.', par: 110, dread: 0.75,
    n: 4, rotation: true,
    doors: [[-90], [90], [-90], [{ a: 90, sealed: true }, { a: -90, sealed: true }]], barriers: [[-150, -30], [], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'crown', name: 'j0', k: 2, a: 0 }, { type: 'crown', name: 'j1', k: 2, a: 30 }, { type: 'crown', name: 'j2', k: 2, a: 60 },
      { type: 'crown', name: 'j3', k: 3, a: 15 }, { type: 'crown', name: 'j4', k: 3, a: 45 }, { type: 'crown', name: 'j5', k: 3, a: 75 },
      { type: 'sentinel', name: 'herald', wall: 1, a: 180, face: 'out', sweep: 40, period: 7, range: 5.5, half: 16 },
      { type: 'liar', name: 'shy', k: 1, a: 150 },
      { type: 'drifter', name: 'd1', k: 1, a: -30, dir: 1 },
    ],
    choirs: [{ name: 'crown', crown: true, members: ['j0', 'j1', 'j2', 'j3', 'j4', 'j5'], conductor: 'j1', dir: 1, spd: 0.7, breaks: 3, ripple: 2.0 }],
    script: {
      // the crown turns the spiral itself, and the centre will not open while it stands
      step(S) {
        const g = S.groups[0];
        S.forcedRot = g.broken ? 0 : 0.22;
        if (g.broken && !S.flags.opened) { S.flags.opened = true; for (const d of S.walls[S.N - 1].doors) d.sealed = false; S.ev('unseal'); }
      },
    },
  },
  {
    id: 20, act: 4, name: 'The Centre', par: 90, dread: 1, quiet: true,
    n: 4, rotation: true, rotMax: 0.32,
    doors: [[-90], [150], [68], [{ a: 88, lid: 'first' }]], barriers: [[-150, -30], [], [], [56, 124]],
    player: { k: 0, a: -90 },
    make: ctx => {
      // the eyes at the centre move the way the traveller moved
      const recs = (ctx.recordings || []).filter(r => r && r.length > 60);
      const fallback = [];
      for (let i = 0; i < 600; i++) fallback.push(0.35 * Math.sin(i / 40) + 0.15 * Math.sin(i / 13));
      const pick = i => recs.length ? recs[(recs.length - 1 - i % recs.length)] : fallback;
      return {
        eyes: [
          { type: 'echo', name: 'echo1', k: 1, a: -60, track: pick(0), extra: { trackScale: 0.9 } },
          { type: 'echo', name: 'echo2', k: 2, a: 170, track: pick(1), extra: { trackScale: 0.8 } },
          { type: 'echo', name: 'echo3', k: 2, a: 30, track: pick(2), extra: { trackScale: 0.8 } },
          { type: 'warden', name: 'first', wall: 3, a: 100 },
          { type: 'echo', name: 'echo4', k: 3, a: 112, track: pick(3), extra: { trackScale: 1.1 } },
        ],
      };
    },
  },
];

function encounterById(id) { return ENCOUNTERS.find(e => e.id === id); }

// Resolve an encounter into a simulation definition. Some encounters depend on the run
// (the traveller's habits, recordings of how they moved); `ctx` carries that.
function buildEncounter(E, ctx) {
  ctx = ctx || {};
  const def = Object.assign({}, E);
  if (typeof E.eyes === 'function') def.eyes = E.eyes(ctx);
  if (typeof E.make === 'function') Object.assign(def, E.make(ctx));
  def.seed = def.seed || E.id * 31 + 5;
  return def;
}

// ---- 03_endless.js ----
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

// ---- 04_art.js ----
// =====================================================================
// Art: ink on bone. Ring textures are drawn once per spiral with Canvas
// 2D brush strokes, unwrapped (x = angle around the ring, y = from the
// outer edge inward), and wrapped back onto annuli by a shader that lays
// them over procedural paper. Eyes, the traveller, the gaze thread and
// the sentinels' sight are drawn by shaders, so their state is live.
// =====================================================================

const PAL = {
  ink: '#0f0d0b', bone: '#ece4d2', ivory: '#ddd2ba', olive: '#7d7a45', oliveDeep: '#4d4a28', graphite: '#57524a', void: '#100e0c',
};

// ---------- canvas brushwork ----------
// A brush stroke along a polyline: a body of varying width, plus dry-brush bristle
// streaks that break up toward the tail. pts: [[x,y],...]
function brush(g, pts, w0, w1, rng, o) {
  o = o || {};
  const n = pts.length;
  if (n < 2) return;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = o.color || PAL.ink; g.fillStyle = o.color || PAL.ink;
  // body: overlapping round segments with a slowly wandering width
  for (let i = 0; i < n - 1; i++) {
    const t = i / (n - 1);
    const wobble = 1 + (rng() - 0.5) * (o.jitter === undefined ? 0.35 : o.jitter);
    g.globalAlpha = (o.alpha || 1) * (o.fade ? 1 - t * o.fade : 1);
    g.lineWidth = Math.max(0.6, lerp(w0, w1, t) * wobble);
    g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
  }
  // dry brush: thin bristle lines offset across the stroke, broken by gaps
  const bristles = o.bristles === undefined ? 5 : o.bristles;
  for (let b = 0; b < bristles; b++) {
    const off = (rng() - 0.5) * Math.max(w0, w1) * 1.15;
    g.lineWidth = 0.6 + rng() * 1.2;
    g.globalAlpha = (o.alpha || 1) * (0.35 + rng() * 0.5);
    g.beginPath();
    let drawing = false;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      if (rng() < 0.12 + i / n * 0.25) { drawing = false; continue; }
      if (!drawing) { g.moveTo(x0 + nx * off, y0 + ny * off); drawing = true; }
      g.lineTo(x1 + nx * off, y1 + ny * off);
    }
    g.stroke();
  }
  g.restore();
}
// sample a straight-ish line into a wobbling polyline
function wline(x0, y0, x1, y1, n, amp, rng) {
  const pts = [];
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  let w = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    w += (rng() - 0.5) * amp; w *= 0.8;
    pts.push([x0 + dx * t + nx * w, y0 + dy * t + ny * w]);
  }
  return pts;
}
// irregular filled ink region between two wavy horizontal edges, x0..x1 (strip space)
function inkBand(g, x0, x1, yTop, yBot, rng, step) {
  step = step || 6;
  if (!(x1 > x0 + 0.5)) return;
  const top = [], bot = [];
  let a = 0, b = 0;
  for (let x = x0; x <= x1 + step; x += step) {
    const xx = Math.min(x, x1);
    a += (rng() - 0.5) * 1.6; a *= 0.86; b += (rng() - 0.5) * 1.6; b *= 0.86;
    top.push([xx, yTop + a]); bot.push([xx, yBot + b]);
    if (xx === x1) break;
  }
  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  for (const p of top) g.lineTo(p[0], p[1]);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
  g.closePath();
  g.fill();
}

// ---------- ring textures ----------
// Band k covers radii [rIn, rOut]: its groove, plus the wall outside it (wall k-1), which
// it owns. The centre band (k = N) holds the last wall and the pupil.
function bandRadii(G, k) {
  const t = RULES.wallThick;
  if (k >= G.n) return { rIn: 0, rOut: G.Ri + t / 2 };
  const r = G.rings[k].r;
  return { rIn: r - G.w / 2 + t / 2, rOut: r + G.w / 2 + t / 2 };
}

function makeRingStrip(G, k, def, opts) {
  const { rIn, rOut } = bandRadii(G, k);
  const band = rOut - rIn;
  const ppu = opts.ppu || 60;
  const W = Math.min(opts.maxW || 4096, Math.max(512, Math.round(TAU * (rIn + rOut) / 2 * ppu)));
  const H = Math.max(64, Math.round(band * ppu));
  const c = opts.canvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng((def.seed || 1) * 131 + k * 977);
  g.clearRect(0, 0, W, H);
  // strip helpers: x from angle (radians), y from radius
  const X = a => wrap0(a) / TAU * W;
  const Y = r => (rOut - r) / band * H;
  const pxPerUnitAt = r => W / (TAU * r);
  const t = RULES.wallThick;
  const wallIdx = k - 1;                  // the wall this band owns (outside its groove)
  const rWall = k === 0 ? rOut - t / 2 : G.walls[wallIdx].r;
  const rGroove = k < G.n ? G.rings[k].r : 0;

  // --- olive wash on some grooves (a rare, sick colour) ---
  if (k < G.n && (def.olive || []).includes(k)) {
    g.fillStyle = PAL.olive; g.globalAlpha = 0.28;
    inkBand(g, 0, W, Y(rGroove + G.w / 2 - t / 2), Y(rGroove - G.w / 2 + t / 2), rng, 14);
    g.globalAlpha = 1;
  }
  // --- the groove: a worn path, light graphite, and hatching that thickens toward the walls ---
  if (k < G.n) {
    const yc = Y(rGroove);
    g.strokeStyle = PAL.graphite;
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.07 + rng() * 0.05; g.lineWidth = 1 + rng() * 2;
      g.beginPath(); let w = 0;
      for (let x = 0; x <= W; x += 10) { w += (rng() - 0.5) * 2; w *= 0.9; const y = yc + (i - 1) * H * 0.06 + w; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    // shading hatches against the inner wall edge (the wall below belongs to the next band)
    const yIn = Y(rIn), yOutEdge = Y(rWall - t / 2);
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 5 + rng() * 6) {
      const len = (0.12 + rng() * 0.22) * H;
      g.globalAlpha = 0.18 + rng() * 0.18;
      g.beginPath(); g.moveTo(x, yIn); g.lineTo(x + len * 0.35, yIn - len); g.stroke();
      if (rng() < 0.6) { g.globalAlpha *= 0.8; g.beginPath(); g.moveTo(x, yOutEdge); g.lineTo(x - len * 0.25, yOutEdge + len * 0.7); g.stroke(); }
    }
    g.globalAlpha = 1;
    // spiral arms: three, one turn per band, continuous across bands only when the rings align
    for (let arm = 0; arm < 3; arm++) {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const u = i / 160;
        const r = rOut - u * (rOut - rIn);
        const a = arm * TAU / 3 + u * TAU;   // one full turn while crossing the band
        pts.push([X(a), Y(r), a]);
      }
      // split where x wraps
      let seg = [];
      g.strokeStyle = PAL.ink;
      const flush = () => { if (seg.length > 1) brush(g, seg, 2.2, 3.4, rng, { alpha: 0.5, bristles: 3, jitter: 0.6 }); seg = []; };
      for (let i = 0; i < pts.length; i++) {
        if (i && Math.abs(pts[i][0] - pts[i - 1][0]) > W / 2) flush();
        seg.push([pts[i][0], pts[i][1]]);
      }
      flush();
    }
  }
  // --- the wall this band owns, with its openings ---
  {
    const yT = Y(rWall + t / 2), yB = Y(rWall - t / 2);
    const doors = k > 0 ? G.walls[wallIdx].doors : [];
    // spans of solid wall between openings
    const cuts = doors.map(d => { const half = RULES.doorHalf * d.wscale / rWall; return [wrap0(d.a - half), wrap0(d.a + half)]; }).sort((a, b) => a[0] - b[0]);
    const spans = [];
    if (!cuts.length) spans.push([0, TAU]);
    else for (let i = 0; i < cuts.length; i++) {
      const from = cuts[i][1], to = cuts[(i + 1) % cuts.length][0];
      if (to > from) spans.push([from, to]); else { spans.push([from, TAU]); spans.push([0, to]); }
    }
    g.fillStyle = PAL.ink;
    const Xr = a => a / TAU * W;   // spans are already within [0, TAU]; do not wrap their ends
    for (const [a0, a1] of spans) {
      if (a1 - a0 < 1e-3) continue;
      inkBand(g, Xr(a0) - (a0 === 0 ? 2 : 0), Xr(a1) + (a1 >= TAU - 1e-6 ? 2 : 0), yT, yB, rng, 5);
    }
    // dry-brush streaks along the wall, light scratches through the ink (a drawing, not a pipe)
    for (let i = 0; i < 26; i++) {
      const y = lerp(yT, yB, rng());
      const x0 = rng() * W, len = W * (0.03 + rng() * 0.12);
      brush(g, wline(x0, y, x0 + len, y + (rng() - 0.5) * 3, 12, 1.5, rng), 1.2, 0.4, rng, { color: PAL.bone, alpha: 0.18 + rng() * 0.2, bristles: 1 });
    }
    // ragged ink flicks off both faces of the wall
    for (let i = 0; i < W / 18; i++) {
      const x = rng() * W, up = rng() < 0.5, l = (3 + rng() * 10) * (H / 120);
      const inGap = cuts.some(([c0, c1]) => { const a = x / W * TAU; return inArc(a, c0, c1); });
      if (inGap) continue;
      g.strokeStyle = PAL.ink; g.globalAlpha = 0.5 + rng() * 0.4; g.lineWidth = 0.8 + rng() * 1.4;
      const y0 = up ? yT : yB;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rng() - 0.5) * 6, y0 + (up ? -l : l)); g.stroke();
    }
    g.globalAlpha = 1;
    // lips of each opening: a few curling strokes, like an eyelid's edge
    for (const [c0, c1] of cuts) {
      for (const [edge, s] of [[c0, -1], [c1, 1]]) {
        for (let j = 0; j < 4; j++) {
          const x = X(edge), y = lerp(yT, yB, (j + 0.5) / 4);
          brush(g, wline(x, y, x - s * (5 + rng() * 9), y + (rng() - 0.5) * 8, 5, 1.5, rng), 2, 0.5, rng, { bristles: 1 });
        }
      }
    }
    // veils: long lashes rising off the wall on both sides; they block sight
    if (k > 0) for (const v of G.walls[wallIdx].veils) {
      const span = wrap0(v[1] - v[0]);
      const n = Math.max(6, Math.round(span * rWall * 7));
      for (let i = 0; i <= n; i++) {
        const a = v[0] + span * i / n;
        const x = X(a);
        for (const dir of [-1, 1]) {
          const len = (0.45 + rng() * 0.4) * (H * 0.4);
          const lean = (rng() - 0.5) * 18;
          const y0 = dir < 0 ? yT : yB;
          const pts = [];
          for (let q = 0; q <= 8; q++) { const tt = q / 8; pts.push([x + lean * tt * tt, y0 + dir * len * tt]); }
          brush(g, pts, 3.2, 0.6, rng, { bristles: 1, fade: 0.3 });
        }
      }
    }
    // the outermost band: a heavier, older edge
    if (k === 0) {
      for (let i = 0; i < 3; i++) { g.fillStyle = PAL.ink; g.globalAlpha = 0.3; inkBand(g, 0, W, yT - 6 - i * 4, yT, rng, 8); }
      g.globalAlpha = 1;
    }
  }
  // --- barriers: thick stitched strokes across the groove ---
  if (k < G.n) for (const b of G.rings[k].barriers) {
    const x = X(b);
    const yTop = Y(rWall - t / 2) - 2, yBot = Y(rIn) + 2;
    const wpx = 0.26 * pxPerUnitAt(rGroove);
    brush(g, wline(x, yTop, x + (rng() - 0.5) * 6, yBot, 14, 2.5, rng), wpx * 1.2, wpx, rng, { bristles: 4 });
    // cross stitches
    for (let s = 0; s < 3; s++) {
      const y = lerp(yTop, yBot, (s + 0.6) / 3.6);
      brush(g, wline(x - wpx * 1.6, y - 4, x + wpx * 1.6, y + 4, 4, 1, rng), 2.2, 1.6, rng, { bristles: 0 });
    }
  }
  // --- the centre: the last wall and the pupil, with olive fibres of an iris ---
  if (k >= G.n) {
    const rp = G.Ri * RULES.pupilFrac;
    // iris fibres between pupil and wall
    for (let i = 0; i < W / 3; i++) {
      const x = rng() * W;
      const y0 = Y(rp + 0.02), y1 = Y(rp + (G.Ri - t / 2 - rp) * (0.4 + rng() * 0.6));
      g.strokeStyle = rng() < 0.6 ? PAL.olive : PAL.oliveDeep; g.globalAlpha = 0.35 + rng() * 0.4; g.lineWidth = 1 + rng() * 2;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rng() - 0.5) * 10, y1); g.stroke();
    }
    g.globalAlpha = 1; g.fillStyle = PAL.ink;
    inkBand(g, 0, W, Y(rp + 0.06), H + 2, rng, 6);
  }
  return c;
}

// The world outside the spiral: older rings that have closed, in a dark field.
function makeVoidCanvas(G, def, canvas, size) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng((def.seed || 3) * 17 + 5);
  const R = 13.5, s = size / (2 * R);
  const cx = size / 2, cy = size / 2;
  g.fillStyle = PAL.void; g.fillRect(0, 0, size, size);
  // faint paper texture showing through the ink
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = PAL.bone; g.globalAlpha = rng() * 0.035;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
  // dead rings: the spiral continues outward, closed, drawn in grey-on-black
  for (let r = G.Ro + 0.35; r < R; r += 0.55 + rng() * 0.5) {
    const pts = [];
    let w = 0;
    const n = Math.round(r * 40);
    for (let i = 0; i <= n; i++) { const a = i / n * TAU; w += (rng() - 0.5) * 0.06; w *= 0.95; pts.push([cx + (r + w) * s * Math.cos(a), cy - (r + w) * s * Math.sin(a)]); }
    brush(g, pts, 1.5 + rng() * 2, 1 + rng() * 2, rng, { color: PAL.bone, alpha: 0.05 + 0.1 * clamp(1 - (r - G.Ro) / 6, 0, 1), bristles: 2 });
  }
  // a single hairline at the boundary, so the spiral's edge is never ambiguous
  g.globalAlpha = 1;
  g.strokeStyle = PAL.bone; g.globalAlpha = 0.25; g.lineWidth = 1.2;
  g.beginPath(); g.arc(cx, cy, (G.Ro + 0.12) * s, 0, TAU); g.stroke();
  g.globalAlpha = 1;
  return c;
}

// ---------- shaders ----------
const GLSL_NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
`;

function makeRingMaterial(THREE, tex, rIn, rOut, isCentre) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, rIn: { value: rIn }, rOut: { value: rOut }, time: { value: 0 }, dread: { value: 0 }, fade: { value: 1 }, paper: { value: new THREE.Color(PAL.bone) }, paper2: { value: new THREE.Color(PAL.ivory) }, wobble: { value: 1 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform sampler2D map; uniform float rIn, rOut, time, dread, fade, wobble; uniform vec3 paper, paper2; varying vec2 vP;
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        // drawn lines breathe a little; more as the spiral closes in
        float wob = (0.012 + 0.05 * dread) * wobble * (vnoise(vec2(a * 6.0, time * 0.35 + r)) - 0.5);
        float rr = r + wob;
        float v = clamp((rOut - rr) / (rOut - rIn), 0.002, 0.998);
        float u = fract(a / 6.2831853);
        vec4 ink = texture2D(map, vec2(u, 1.0 - v));
        float grain = vnoise(vP * 9.0) * 0.6 + vnoise(vP * 31.0) * 0.4;
        vec3 base = mix(paper, paper2, smoothstep(0.35, 0.85, vnoise(vP * 0.7 + 3.0))) * (0.93 + 0.07 * grain);
        ${isCentre ? '' : ''}
        vec3 col = mix(base, ink.rgb, ink.a);
        col *= fade;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Eyes: one instanced quad each, drawn entirely in the fragment shader.
// type ids
const EYE_ID = { watcher: 0, drifter: 1, collector: 2, liar: 3, mimic: 4, sentinel: 5, warden: 6, choir: 7, crown: 8, falseeye: 9, unblinking: 10, echo: 11, decor: 12 };
// blotPass draws only the ink blots, underneath every eye, so neighbours never cut into each other
function makeEyeMaterial(THREE, blotPass) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { time: { value: 0 }, fade: { value: 1 }, blotPass: { value: blotPass ? 1 : 0 } },
    vertexShader: `
      attribute vec4 iA; // x, y, rad, rot
      attribute vec4 iB; // type, open, pupilX, pupilY
      attribute vec4 iC; // pupilSize, pinned(0..1), stunned, smear
      attribute vec4 iD; // target(0..1), feign, dead, dim
      attribute vec4 iE; // seed, wall(0/1), stare, knot
      varying vec2 vP; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vE;
      void main(){
        float s = iA.z * 2.15;
        float c = cos(iA.w), sn = sin(iA.w);
        vec2 q = position.xy * s;
        vec2 w = vec2(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c);
        vP = position.xy * 1.9; vB = iB; vC = iC; vD = iD; vE = iE;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0);
      }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, fade, blotPass;
      varying vec2 vP; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vE;
      float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      void main(){
        float type = vB.x; float open = vB.y; vec2 pup = vB.zw;
        float psz = vC.x, pinned = vC.y, stun = vC.z, smear = vC.w;
        float tgt = vD.x, feign = vD.y, dead = vD.z, dim = vD.w;
        float seed = vE.x, inWall = vE.y, stare = vE.z, knot = vE.w;
        vec2 p = vP;
        // --- shape by type ---
        float Wd = 1.0, Hu = 0.62, Hl = 0.48, ex = 0.8, ir = 0.42, round_ = 0.0;
        if (abs(type - 1.0) < 0.5) { Hu = 0.55; Hl = 0.45; ir = 0.36; }               // drifter: heavy
        if (abs(type - 2.0) < 0.5) { Hu = 0.8; Hl = 0.8; ex = 0.55; ir = 0.55; }      // collector: round, many pupils
        if (abs(type - 3.0) < 0.5) { Hu = 0.42; Hl = 0.34; ex = 1.1; ir = 0.36; }     // liar: narrow
        if (abs(type - 5.0) < 0.5) { Hu = 0.5; Hl = 0.5; ex = 1.4; ir = 0.34; }       // sentinel: a slit
        if (abs(type - 7.0) < 0.5 || abs(type - 8.0) < 0.5) { Hu = 0.85; Hl = 0.85; ex = 0.5; ir = 0.5; }
        if (abs(type - 10.0) < 0.5) { Hu = 1.0; Hl = 1.0; ex = 0.5; ir = 0.72; open = 1.0; }  // unblinking: lidless
        if (abs(type - 11.0) < 0.5) { Hu = 0.58; Hl = 0.46; }
        // a stunned eye droops; a held one is pinned half-tense
        open *= mix(1.0, 0.45, stun);
        float x = p.x / Wd;
        float prof = pow(max(0.0, 1.0 - x * x), ex);
        // brush wobble on the lids
        float nz = vnoise(vec2(x * 3.0 + seed * 7.0, seed)) - 0.5;
        float up = Hu * prof * open + nz * 0.04;
        float lo = -Hl * prof * open + nz * 0.03;
        float inside = step(abs(x), 1.0) * step(p.y, up) * step(lo, p.y);
        float th = 0.085 + 0.035 * (vnoise(vec2(x * 5.0, seed * 3.0)) - 0.2) + 0.03 * tgt;
        if (abs(type - 10.0) < 0.5) th += 0.04 * (vnoise(vec2(atan(p.y, p.x) * 4.0, seed)) );
        float edge = 0.0;
        if (abs(x) < 1.04) {
          float dU = abs(p.y - up), dL = abs(p.y - lo);
          edge = max(1.0 - smoothstep(th * 0.6, th, dU), (1.0 - smoothstep(th * 0.5, th * 0.9, dL)) * (open > 0.05 ? 1.0 : 0.0));
        }
        // corners
        edge = max(edge, 1.0 - smoothstep(th * 0.35, th * 0.7, length(p - vec2(Wd, 0.0))));
        edge = max(edge, 1.0 - smoothstep(th * 0.35, th * 0.7, length(p - vec2(-Wd, 0.0))));
        // --- sclera, iris, pupil ---
        vec3 col = vec3(0.925, 0.894, 0.824);
        float alpha = 0.0;
        if (inside > 0.5) {
          alpha = 1.0;
          // hatched shade under the upper lid
          float shade = smoothstep(0.0, 0.35, (up - p.y)) ;
          float hatch = smoothstep(0.35, 0.65, abs(fract((p.x * 0.7 + p.y) * 5.0 + seed) - 0.5) * 2.0);
          col *= 1.0 - (1.0 - shade) * 0.22 * hatch;
          if (abs(type - 1.0) < 0.5 || abs(type - 8.0) < 0.5) col = mix(col, vec3(0.80, 0.78, 0.62), 0.25);
          vec2 c = pup;
          float d = length(p - c);
          float irr = ir;
          if (d < irr) {
            float ang = atan(p.y - c.y, p.x - c.x);
            float fib = vnoise(vec2(ang * 9.0, d * 6.0 + seed));
            vec3 irisC = mix(vec3(0.34, 0.33, 0.30), vec3(0.49, 0.48, 0.27), step(0.5, mod(type, 2.0)) * 0.6 + 0.2);
            if (abs(type - 10.0) < 0.5) irisC = vec3(0.30, 0.29, 0.25) + 0.12 * step(0.5, fract(d * 9.0));
            col = mix(col, irisC * (0.75 + 0.5 * fib), 0.9);
            if (d > irr - 0.06) col = vec3(0.06);
          }
          // pupil
          float ps = (0.18 + 0.12 * psz) * (1.0 - 0.35 * pinned) * (1.0 + 0.6 * stare);
          float pd;
          if (abs(type - 3.0) < 0.5) { vec2 q = (p - c) / vec2(1.8, 0.55); pd = length(q) - ps * 0.9; }      // liar: a goat's bar
          else if (abs(type - 5.0) < 0.5) { vec2 q = (p - c) / vec2(0.45, 1.6); pd = length(q) - ps; }      // sentinel: slit
          else if (abs(type - 2.0) < 0.5) {                                                                // collector: three
            pd = 9.0; for (int i = 0; i < 3; i++) { float a = float(i) * 2.094 + seed; pd = min(pd, length(p - c - 0.2 * vec2(cos(a), sin(a))) - ps * 0.55); }
          }
          else pd = d - ps;
          if (stun > 0.01) { // a stunned pupil swirls
            float ang = atan(p.y - c.y, p.x - c.x);
            pd = mix(pd, abs(fract((ang / 6.283) + d * 4.0 - time * 0.5) - 0.5) * 0.25 - 0.04 + d * 0.2 - ps * 0.6, stun);
          }
          if (pd < 0.0) col = vec3(0.03);
          // catchlight for the human-like
          if ((abs(type) < 0.5 || abs(type - 4.0) < 0.5 || abs(type - 6.0) < 0.5) && length(p - c - vec2(-0.09, 0.1)) < 0.05) col = vec3(0.95);
          // a false eye seen for what it is: the drawing runs
          col = mix(col, vec3(0.6, 0.58, 0.52), smear * 0.6);
        }
        float ink = edge;
        // lashes on the upper lid (watcher, liar, mimic, warden, sentinel) — long and curling for the liar
        if ((abs(type) < 0.5 || abs(type - 3.0) < 0.5 || abs(type - 4.0) < 0.5 || abs(type - 6.0) < 0.5 || abs(type - 11.0) < 0.5) && open > 0.02) {
          for (int i = 0; i < 7; i++) {
            float fx = -0.75 + float(i) * 0.25;
            float py = Hu * pow(max(0.0, 1.0 - fx * fx), ex) * open;
            float L = abs(type - 3.0) < 0.5 ? 0.42 : 0.24;
            float tremble = feign * 0.08 * sin(time * 30.0 + float(i) * 2.0);
            vec2 a = vec2(fx, py), b = a + vec2(fx * 0.35 + tremble, L);
            ink = max(ink, 1.0 - smoothstep(0.025, 0.05, seg(p, a, b)));
          }
        }
        // a closed eye: one curved stroke with lashes hanging down
        if (open < 0.06 && dead < 0.5) {
          for (int i = 0; i < 5; i++) {
            float fx = -0.6 + float(i) * 0.3;
            vec2 a = vec2(fx, 0.0), b = a + vec2(fx * 0.2, -0.22);
            ink = max(ink, 1.0 - smoothstep(0.02, 0.045, seg(p, a, b)));
          }
        }
        // drifter: heavy folds above
        if (abs(type - 1.0) < 0.5) {
          float f1 = abs(p.y - (Hu * prof * open + 0.18 + 0.05 * sin(x * 3.0 + seed))) ;
          ink = max(ink, step(abs(x), 0.8) * (1.0 - smoothstep(0.02, 0.05, f1)));
        }
        // crown: spikes
        if (abs(type - 8.0) < 0.5) {
          for (int i = 0; i < 5; i++) {
            float fx = -0.7 + float(i) * 0.35;
            float py = Hu * pow(max(0.0, 1.0 - fx * fx), ex) * open;
            ink = max(ink, 1.0 - smoothstep(0.03, 0.06, seg(p, vec2(fx, py), vec2(fx * 1.2, py + 0.38))));
          }
        }
        // pins: held eyes are pinned like specimens — short radial strokes that grow while acquiring
        float pinI = 0.0;
        if (pinned > 0.01) {
          for (int i = 0; i < 6; i++) {
            float a = float(i) * 1.0472 + 0.5;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 a0 = dir * vec2(1.05, max(Hu, 0.5) * 1.15);
            vec2 b0 = a0 + dir * 0.42 * pinned;
            pinI = max(pinI, 1.0 - smoothstep(0.03, 0.065, seg(p, a0, b0)));
          }
        }
        // a dead eye: stitched shut
        if (dead > 0.5) {
          ink = max(ink, (1.0 - smoothstep(0.04, 0.08, abs(p.y - 0.1 * (1.0 - x * x)))) * step(abs(x), 1.0));
          for (int i = 0; i < 4; i++) { float fx = -0.6 + float(i) * 0.4; ink = max(ink, 1.0 - smoothstep(0.03, 0.06, seg(p, vec2(fx - 0.1, -0.2), vec2(fx + 0.1, 0.3)))); }
          col = vec3(0.5); alpha = 0.0;
        }
        // false eye drips
        if (smear > 0.01) {
          float drip = step(abs(fract(x * 2.5 + seed) - 0.5), 0.08) * step(p.y, lo) * step(lo - 0.9 * smear * (0.5 + hash(vec2(floor(x * 2.5 + seed), seed))), p.y);
          ink = max(ink, drip * 0.8);
        }
        // wall eyes get a pale halo so they read against ink
        float halo = 0.0;
        if (inWall > 0.5) { float hp = pow(max(0.0, 1.0 - (x * x) / 1.25), ex); float hu = Hu * hp * max(open, 0.3) + 0.18; halo = step(abs(x), 1.15) * step(p.y, hu) * step(-hu, p.y); }
        // floor eyes sit in a blot of brushed ink, with a few flung drops around it
        float blot = 0.0, rim = 0.0;
        if (inWall < 0.5 && dead < 0.5 && abs(type - 11.0) > 0.5) {
          float ang = atan(p.y, p.x);
          float rr = length(p * vec2(0.9, 1.08));
          float R = 1.3 + 0.22 * (vnoise(vec2(ang * 1.9 + seed * 5.0, seed * 2.0)) - 0.5) + 0.2 * pow(max(0.0, sin(ang * 3.0 + seed * 9.0)), 14.0);
          blot = 1.0 - smoothstep(R - 0.035, R + 0.015, rr);
          for (int i = 0; i < 3; i++) {
            float h = hash(vec2(seed * 13.0, float(i)));
            float da = h * 6.283;
            vec2 sp = vec2(cos(da), sin(da) * 0.8) * (1.5 + 0.25 * hash(vec2(float(i), seed)));
            blot = max(blot, 1.0 - smoothstep(0.03 + 0.04 * h, 0.06 + 0.04 * h, length(p - sp)));
          }
          // the eye you are about to hold: an olive ring drawn round its blot
          rim = tgt * (1.0 - smoothstep(0.025, 0.06, abs(rr - R - 0.1)));
        }
        if (blotPass > 0.5) {
          float ba = max(blot, rim);
          if (ba < 0.02) discard;
          gl_FragColor = vec4(rim > 0.5 && blot < 0.5 ? vec3(0.52, 0.50, 0.22) : vec3(0.05, 0.045, 0.04), ba * (1.0 - dim * 0.55) * fade);
          return;
        }
        float blotUnder = blot; blot = 0.0; rim = 0.0;
        ink = max(ink, pinI);
        float a = max(max(alpha, ink), max(blot, rim));
        a = max(a, halo * 0.9);
        vec3 c3 = mix(col, vec3(0.04), max(ink, blot));
        if (pinI > 0.5) c3 = blotUnder > 0.5 ? vec3(0.83, 0.80, 0.58) : vec3(0.04);
        if (halo > 0.5 && alpha < 0.5 && ink < 0.5) c3 = vec3(0.86, 0.82, 0.73);
        if (a < 0.02) discard;
        float al = a * (1.0 - dim * 0.55) * fade;
        if (abs(type - 11.0) < 0.5) { c3 = mix(c3, vec3(0.62, 0.62, 0.6), 0.45); al *= 0.85; }
        gl_FragColor = vec4(c3, al);
      }`,
  });
}

// The traveller: a small standing figure, drawn from signed distances so it can lean,
// turn its head toward its gaze, breathe, flinch, and be swallowed by ink.
function makeFigureMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { time: { value: 0 }, face: { value: 1 }, look: { value: new THREE.Vector2(1, 0) }, walk: { value: 0 }, speed: { value: 0 }, fear: { value: 0 }, ink: { value: 0 }, exposure: { value: 0 }, lean: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, face, walk, speed, fear, ink, exposure, lean; uniform vec2 look; varying vec2 vP;
      float cap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
      void main(){
        // figure space: feet at y=0, head near y=1.0, facing +x when face=1
        vec2 p = vP; p.x *= face;
        float breath = sin(time * 2.1) * 0.012 * (1.0 + fear * 1.5);
        float hunch = fear * 0.08;
        float sw = sin(walk) * speed;
        p.x -= lean * p.y * 0.12 * face;
        // legs
        float d = cap(p, vec2(0.0, 0.42), vec2(0.07 + sw * 0.12, 0.02), 0.045);
        d = min(d, cap(p, vec2(0.0, 0.42), vec2(-0.06 - sw * 0.12, 0.02), 0.045));
        // a long coat: narrow at rounded shoulders, flaring to the hem, a little ragged
        float cy = p.y - breath;
        float k = clamp((cy - 0.27) / 0.49, 0.0, 1.0);
        float halfW = mix(0.16, 0.065, pow(k, 0.8)) + 0.012 * (vnoise(vec2(cy * 18.0, 2.0)) - 0.5) - hunch * 0.2 * k;
        float coat = max(abs(p.x + hunch * k * 0.3) - halfW, max(0.27 + 0.02 * sin(p.x * 40.0) - cy, cy - 0.76));
        float shoulders = cap(p, vec2(-0.055, 0.735 + breath), vec2(0.055, 0.735 + breath), 0.042);
        float hres = 0.03;
        d = min(d, -log(exp(-coat / hres) + exp(-shoulders / hres)) * hres);
        // arms, close to the body; held tighter when afraid
        d = min(d, cap(p, vec2(0.05, 0.74 + breath), vec2(0.1 - fear * 0.04 + sw * 0.05, 0.47 + fear * 0.1), 0.035));
        d = min(d, cap(p, vec2(-0.05, 0.74 + breath), vec2(-0.09 + fear * 0.04 - sw * 0.05, 0.47 + fear * 0.1), 0.035));
        // neck and head, turned and tilted toward the gaze
        vec2 lk = look; lk.x *= face;
        vec2 hc = vec2(0.02 + hunch * 0.6 + lk.x * 0.035, 0.9 + breath - hunch + lk.y * 0.04);
        d = min(d, cap(p, vec2(0.0, 0.76 + breath), hc - vec2(0.0, 0.05), 0.04));
        float head = length((p - hc) / vec2(1.0, 1.12)) - 0.092;
        d = min(d, head);
        // face direction: a nick of white where the eye is, on the side it looks
        vec2 eyeP = hc + vec2(0.045 * sign(lk.x + 0.001) * min(1.0, abs(lk.x) * 2.0 + 0.3), 0.012 + lk.y * 0.02);
        float eyeD = length(p - eyeP) - 0.016;
        // outline in bone so the figure reads on ink, body in ink so it reads on paper
        float outline = 1.0 - smoothstep(0.0, 0.035, d);
        float body = 1.0 - smoothstep(-0.012, 0.0, d);
        vec3 col = vec3(0.9, 0.87, 0.79);
        col = mix(col, vec3(0.04), body);
        if (eyeD < 0.0 && body > 0.5) col = vec3(0.92);
        // exposure: ink veins climbing the figure
        float veins = step(0.72, vnoise(p * 28.0 + time)) * exposure * body;
        col = mix(col, vec3(0.42, 0.41, 0.22), veins * 0.0);
        float a = max(outline * 0.95, body);
        // capture: ink rises and takes the figure
        float n = vnoise(p * 14.0 + vec2(0.0, -time * 2.0));
        float flood = step(p.y + n * 0.25, ink * 1.4);
        col = mix(col, vec3(0.02), flood);
        a = max(a, flood * smoothstep(0.55, 0.3, length(p - vec2(0.0, 0.5))) );
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

// A tapered strip from the traveller's eye to what they watch: graphite when looking,
// an ink thread when it holds.
function makeThreadMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { time: { value: 0 }, held: { value: 0 }, len: { value: 1 }, alpha: { value: 1 } },
    vertexShader: `attribute float t; attribute float side; varying float vT; varying float vS; void main(){ vT = t; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, held, len, alpha; varying float vT; varying float vS;
      void main(){
        float dash = step(0.45, fract(vT * len * 3.0 - time * 0.6));
        float a = mix(0.35 * dash * (1.0 - vT * 0.7), 0.85, held);
        float core = 1.0 - smoothstep(0.2, 1.0, abs(vS));
        a *= core * alpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.33, 0.31, 0.28), vec3(0.03), held), a);
      }`,
  });
}

// A sentinel's sight: diagonal ink hatching inside the fan, darkening when it sees you.
function makeConeMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `attribute float aT; attribute float aSeen; varying float vT; varying float vSeen; varying vec2 vW; void main(){ vT = aT; vSeen = aSeen; vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; varying float vT; varying float vSeen; varying vec2 vW;
      void main(){
        float h = step(0.62, fract((vW.x - vW.y) * 3.2 + time * 0.15));
        float h2 = step(0.8, fract((vW.x + vW.y) * 3.2)) * vSeen;
        float a = (h * 0.32 + h2 * 0.35) * (1.0 - smoothstep(0.65, 1.0, vT)) * (0.55 + 0.45 * vSeen);
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.05), vec3(0.30, 0.29, 0.13), vSeen * 0.7), a);
      }`,
  });
}

// ---- 05_view.js ----
// =====================================================================
// The view: everything on screen is derived from the simulation each
// frame. Nothing here changes the game; it only shows it.
// =====================================================================

function createView(THREE, renderer, opts) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.void);
  // two cameras: a flat overview (title, ending) and, in play, a tilted camera that stays with
  // the traveller while the spiral turns around them; its "up" always points toward the centre
  const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -10, 10);
  ortho.position.z = 5;
  const pcam = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
  const V = { scene, camera: ortho, ortho, pcam, follow: false, zoom: 1, cx: 0, cy: 0, scale: 20, w: 1, h: 1, fade: 1, dread: 0, wobble: 1, bandPx: 0,
    rig: { yaw: Math.PI / 2, x: 0, y: 0, r: 8, init: false } };
  const ray = new THREE.Raycaster(), _nd = new THREE.Vector2(), _v3 = new THREE.Vector3(), _camUp = new THREE.Vector3();
  const TILT = 34 * Math.PI / 180;
  const canvasMaker = opts.canvas;
  const small = !!opts.small;
  const eyeMat = makeEyeMaterial(THREE);
  const figMat = makeFigureMaterial(THREE);
  const threadMat = makeThreadMaterial(THREE);
  const coneMat = makeConeMaterial(THREE);
  const MAX_EYES = 96;

  // ---------- eye instances ----------
  const quad = new THREE.PlaneGeometry(2, 2);
  const eyeGeo = new THREE.InstancedBufferGeometry();
  eyeGeo.index = quad.index; eyeGeo.setAttribute('position', quad.getAttribute('position'));
  const attr = {};
  for (const n of ['iA', 'iB', 'iC', 'iD', 'iE']) { attr[n] = new THREE.InstancedBufferAttribute(new Float32Array(MAX_EYES * 4), 4); attr[n].setUsage(THREE.DynamicDrawUsage); eyeGeo.setAttribute(n, attr[n]); }
  eyeGeo.instanceCount = 0;
  const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
  eyeMesh.frustumCulled = false; eyeMesh.renderOrder = 5;
  scene.add(eyeMesh);
  const blotMat = makeEyeMaterial(THREE, true);
  const blotMesh = new THREE.Mesh(eyeGeo, blotMat);
  blotMesh.frustumCulled = false; blotMesh.renderOrder = 4;
  scene.add(blotMesh);

  // ---------- the traveller ----------
  const figGeo = new THREE.PlaneGeometry(0.8, 1.2); figGeo.translate(0, 0.6, 0);
  const figure = new THREE.Mesh(figGeo, figMat);
  figure.renderOrder = 7; figure.frustumCulled = false;
  const FIG_SCALE = 1.25;
  figure.scale.setScalar(FIG_SCALE);
  scene.add(figure);
  // its short olive shadow, thrown outward across the floor
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, uniforms: { alpha: { value: 0.5 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `uniform float alpha; varying vec2 vP; void main(){
      vec2 q = (vP - vec2(0.0, 0.4)) / vec2(0.3, 0.52);
      float edge = length(q) - 1.0 + (vnoise(vP * 7.0) - 0.5) * 0.18;
      float a = (1.0 - smoothstep(-0.08, 0.04, edge)) * alpha * (1.0 - 0.45 * clamp(vP.y, 0.0, 1.0));
      if (a < 0.01) discard; gl_FragColor = vec4(0.43, 0.42, 0.18, a); }`,
  });
  const shadowGeo = new THREE.PlaneGeometry(0.9, 1.15); shadowGeo.translate(0, 0.42, 0);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.renderOrder = 2; shadow.frustumCulled = false;
  scene.add(shadow);
  // the way in: a pale breath over the opening that leads inward, so the goal is never a mystery
  const beaconMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, uniforms: { time: { value: 0 }, alpha: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time, alpha; varying vec2 vP; void main(){
      float r = length(vP);
      float pulse = 0.5 + 0.5 * sin(time * 2.4);
      float halo = (1.0 - smoothstep(0.35, 1.0, r)) * (0.35 + 0.25 * pulse);
      // three small chevrons pointing inward (+y), drifting toward the centre
      float ch = 0.0;
      for (int i = 0; i < 3; i++) {
        float y0 = -0.55 + float(i) * 0.38 + fract(time * 0.35) * 0.38;
        float d = abs(vP.y - y0 - (0.18 - abs(vP.x) * 0.55));
        ch = max(ch, (1.0 - smoothstep(0.025, 0.06, d)) * step(abs(vP.x), 0.3) * (1.0 - smoothstep(0.4, 0.85, abs(vP.y))));
      }
      float a = max(halo, ch * 0.85) * alpha;
      if (a < 0.01) discard;
      gl_FragColor = vec4(mix(vec3(0.93, 0.89, 0.8), vec3(0.06), ch), a); }`,
  });
  const beacon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), beaconMat);
  beacon.renderOrder = 3; beacon.frustumCulled = false;
  scene.add(beacon);
  V.beacon = { x: 0, y: 0, on: false };

  // ---------- gaze thread ----------
  const TN = 24;
  const threadGeo = new THREE.BufferGeometry();
  const tPos = new Float32Array((TN + 1) * 2 * 3), tT = new Float32Array((TN + 1) * 2), tSide = new Float32Array((TN + 1) * 2);
  for (let i = 0; i <= TN; i++) { tSide[i * 2] = 1; tSide[i * 2 + 1] = -1; }
  const tIdx = [];
  for (let i = 0; i < TN; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  for (let i = 0; i <= TN; i++) { tT[i * 2] = tT[i * 2 + 1] = i / TN; }
  threadGeo.setIndex(tIdx); threadGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); threadGeo.setAttribute('t', new THREE.BufferAttribute(tT, 1)); threadGeo.setAttribute('side', new THREE.BufferAttribute(tSide, 1));
  const thread = new THREE.Mesh(threadGeo, threadMat);
  thread.frustumCulled = false; thread.renderOrder = 6;
  scene.add(thread);

  // ---------- link threads and knot webs (fine ink lines) ----------
  const LMAX = 64;
  const linkGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(LMAX * 2 * 3), lCol = new Float32Array(LMAX * 2 * 4);
  linkGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3)); linkGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 4));
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  links.frustumCulled = false; links.renderOrder = 4;
  scene.add(links);

  // ---------- ripples (pin, chain, knot, absorb) ----------
  const rippleMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: {},
    vertexShader: `attribute vec4 rA; attribute vec2 rB; varying vec2 vP; varying vec2 vB; void main(){ vP = position.xy; vB = rB; vec2 w = rA.xy + position.xy * rA.z; gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vP; varying vec2 vB; void main(){ float r = length(vP); float a = (1.0 - smoothstep(0.0, 0.06, abs(r - 0.9))) * vB.x; if (vB.y > 0.5) a = max(a, (1.0 - smoothstep(0.75, 0.9, r)) * vB.x * 0.85); if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.04), a); }`,
  });
  const RMAX = 24;
  const rGeo = new THREE.InstancedBufferGeometry();
  rGeo.index = quad.index; rGeo.setAttribute('position', quad.getAttribute('position'));
  const rA = new THREE.InstancedBufferAttribute(new Float32Array(RMAX * 4), 4), rB = new THREE.InstancedBufferAttribute(new Float32Array(RMAX * 2), 2);
  rA.setUsage(THREE.DynamicDrawUsage); rB.setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('rA', rA); rGeo.setAttribute('rB', rB);
  const ripples = new THREE.Mesh(rGeo, rippleMat);
  ripples.frustumCulled = false; ripples.renderOrder = 8;
  scene.add(ripples);
  const fx = [];
  V.ripple = (x, y, size, dur, fill) => { if (fx.length >= RMAX) fx.shift(); fx.push({ x, y, size, dur, t: 0, fill: !!fill }); };

  // ---------- ink overlay (capture, descent) ----------
  const overlayMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { amount: { value: 0 }, center: { value: new THREE.Vector2() }, time: { value: 0 }, mode: { value: 0 }, aspect: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float amount, time, mode, aspect; uniform vec2 center; varying vec2 vUv;
      void main(){
        vec2 p = vUv - center; p.x *= aspect;
        float n = vnoise(p * 7.0 + time * 0.2) * 0.12 + vnoise(p * 23.0) * 0.05 + vnoise(p * 61.0) * 0.02;
        float r = length(p) + n;
        float a = smoothstep(amount * 1.6 - 0.05, amount * 1.6, r);
        a = mode < 0.5 ? 1.0 - a : 1.0 - a;
        a = clamp(a * min(1.0, amount * 4.0), 0.0, 1.0);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.035, 0.03, 0.026), a);
      }`,
  });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMat);
  overlay.frustumCulled = false; overlay.renderOrder = 20;
  scene.add(overlay);
  V.ink = (amount, sx, sy) => { overlayMat.uniforms.amount.value = amount; if (sx !== undefined) overlayMat.uniforms.center.value.set(sx / V.w, 1 - sy / V.h); };

  // ---------- per spiral ----------
  let built = null;
  function disposeBuilt() {
    if (!built) return;
    for (const m of built.meshes) { scene.remove(m); m.geometry.dispose(); if (m.material.uniforms && m.material.uniforms.map) m.material.uniforms.map.value.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
    for (const c of built.cones) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    built = null;
  }
  V.dispose = disposeBuilt;

  V.build = function (S, def) {
    disposeBuilt();
    if (opts.resetCanvases) opts.resetCanvases();
    const G = S.G;
    const meshes = [], rings = [];
    // the dark field outside, with the closed rings of every spiral before this one
    const voidTex = new THREE.CanvasTexture(makeVoidCanvas(G, def, canvasMaker, small ? 1024 : 1536));
    voidTex.colorSpace = THREE.SRGBColorSpace;
    const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(27, 27), new THREE.MeshBasicMaterial({ map: voidTex, depthWrite: false, depthTest: false }));
    voidMesh.renderOrder = 0; scene.add(voidMesh); meshes.push(voidMesh);
    for (let k = 0; k <= G.n; k++) {
      const { rIn, rOut } = bandRadii(G, k);
      const cnv = makeRingStrip(G, k, def, { canvas: canvasMaker, ppu: small ? 52 : 64, maxW: small ? 3072 : 4096 });
      const tex = new THREE.CanvasTexture(cnv);
      tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const mat = makeRingMaterial(THREE, tex, rIn, rOut, k === G.n);
      const geo = new THREE.RingGeometry(Math.max(0.001, rIn), rOut, 192, 1);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1;
      scene.add(m); meshes.push(m); rings.push(m);
    }
    // sentinel sight fans
    const cones = [];
    for (const e of S.eyes) if (e.type === 'sentinel') {
      const n = 28, geo = new THREE.BufferGeometry();
      const pos = new Float32Array((n + 2) * 3), at = new Float32Array(n + 2), as = new Float32Array(n + 2), idx = [];
      for (let i = 0; i < n; i++) idx.push(0, i + 1, i + 2);
      geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aT', new THREE.BufferAttribute(at, 1)); geo.setAttribute('aSeen', new THREE.BufferAttribute(as, 1));
      const mesh = new THREE.Mesh(geo, coneMat); mesh.frustumCulled = false; mesh.renderOrder = 3;
      scene.add(mesh);
      cones.push({ e, mesh, n, pos, at, as, seen: 0, open: 0 });
    }
    // decorative eyes in the dark field (never in the spiral, never on a groove)
    const decor = [];
    const rng = makeRng((def.seed || 1) * 7 + 99);
    const nDecor = Math.round(4 + 10 * (def.dread || (def.act || 1) * 0.15));
    for (let i = 0; i < nDecor; i++) decor.push({ r: G.Ro + 1.1 + rng() * 2.8, a: rng() * TAU, rad: 0.3 + rng() * 0.35, seed: rng() * 10, blink: rng() * 6, wake: rng() });
    // per-eye animation state
    const anim = S.eyes.map(e => ({ px: 0, py: 0, open: e.state === ST.DORMANT ? 0 : 1, pin: 0, stun: 0, smear: 0, tgt: 0, sway: 0, gone: 0 }));
    built = { S, def, meshes, rings, cones, decor, anim, links: [], G };
    V.dread = def.dread || 0;
    for (const m of rings) m.material.uniforms.dread.value = V.dread;
    return built;
  };

  // ---------- framing ----------
  // The spiral is centred in the portrait frame above the control band.
  V.layout = function (w, h, safe, bandFrac, R) {
    V.w = w; V.h = h;
    const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
    const avH = h * (1 - bandFrac) - top - 8;
    const fit = Math.min(w - 16, avH);
    V.scale = fit / (2 * R);
    V.cx = w / 2; V.cy = top + 8 + avH / 2;
    V.applyCamera();
    overlayMat.uniforms.aspect.value = w / h;
  };
  V.applyCamera = function () {
    const s = V.scale * V.zoom;
    ortho.left = -V.cx / s; ortho.right = (V.w - V.cx) / s;
    ortho.top = V.cy / s; ortho.bottom = -(V.h - V.cy) / s;
    ortho.updateProjectionMatrix();
    if (V.follow) placeFollow();
  };
  V.setFollow = on => { V.follow = !!on; V.camera = on ? pcam : ortho; V.rig.init = false; V.applyCamera(); };
  // how wide a stretch of the world the follow camera shows at the traveller's feet, in units
  const viewWidth = r => clamp(4.2 + r * 0.72, 6.2, 10.5);
  function placeFollow() {
    const R = V.rig;
    const ux = Math.cos(R.yaw), uy = Math.sin(R.yaw);
    const Wu = viewWidth(R.r) / V.zoom;
    const aspect = V.w / Math.max(1, V.h - V.bandPx);
    pcam.aspect = V.w / V.h;
    const D = Wu / (2 * Math.tan(pcam.fov * Math.PI / 360) * (V.w / V.h));
    // look a little ahead of the traveller, toward the centre, so they stand low in the frame
    const ahead = Wu * 0.42;
    const tx = R.x + ux * ahead, ty = R.y + uy * ahead;
    pcam.position.set(tx - ux * D * Math.sin(TILT), ty - uy * D * Math.sin(TILT), D * Math.cos(TILT));
    pcam.up.set(ux, uy, 0);
    pcam.lookAt(tx, ty, 0);
    // keep the scene centred in the space above the control band
    pcam.setViewOffset(V.w, V.h, 0, V.bandPx * 0.5, V.w, V.h);
    pcam.updateProjectionMatrix();
    pcam.updateMatrixWorld();
  }
  V.updateRig = function (S, dt, snap) {
    const P = S.P;
    let pr = S.playerR();
    if (P.crossT > 0) pr = lerp(P.crossFrom, pr, smooth(1 - P.crossT / RULES.crossTime));
    const th = S.playerTheta();
    const R = V.rig, yaw = th + Math.PI;
    const x = pr * Math.cos(th), y = pr * Math.sin(th);
    if (!R.init || snap) { R.yaw = yaw; R.x = x; R.y = y; R.r = pr; R.init = true; }
    else {
      R.yaw += wrap(yaw - R.yaw) * (1 - Math.exp(-9 * dt));
      R.x = damp(R.x, x, 12, dt); R.y = damp(R.y, y, 12, dt); R.r = damp(R.r, pr, 3, dt);
    }
    if (V.follow) placeFollow();
  };
  V.toWorld = (sx, sy) => {
    if (!V.follow) { const s = V.scale * V.zoom; return [(sx - V.cx) / s, -(sy - V.cy) / s]; }
    _nd.set(sx / V.w * 2 - 1, -(sy / V.h) * 2 + 1);
    ray.setFromCamera(_nd, pcam);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.z) < 1e-6) return [o.x, o.y];
    const t = -o.z / d.z;
    return [o.x + d.x * t, o.y + d.y * t];
  };
  V.toScreen = (x, y, z) => {
    if (!V.follow) { const s = V.scale * V.zoom; return [V.cx + x * s, V.cy - y * s]; }
    _v3.set(x, y, z || 0).project(pcam);
    return [(_v3.x * 0.5 + 0.5) * V.w, (-_v3.y * 0.5 + 0.5) * V.h];
  };
  // screen directions in the world, for groove-relative controls: [right, up]
  V.screenAxes = () => {
    const R = V.rig, ux = Math.cos(R.yaw), uy = Math.sin(R.yaw);
    return V.follow ? { up: [ux, uy], right: [uy, -ux] } : { up: [0, 1], right: [1, 0] };
  };

  // ---------- per frame ----------
  const _p = [0, 0], _q = [0, 0];
  let tmr = 0;
  function eyeOpenBase(e) { return e.type === 'drifter' ? 0.72 : e.type === 'liar' ? 0.9 : 1; }
  V.update = function (S, dt, o) {
    o = o || {};
    tmr += dt;
    const B = built; if (!B || B.S !== S) return;
    const T = S.t;
    for (const m of B.rings) { m.material.uniforms.time.value = tmr; m.material.uniforms.fade.value = V.fade; m.material.uniforms.wobble.value = o.calm ? 0.25 : 1; }
    for (let k = 0; k < B.rings.length; k++) B.rings[k].rotation.z = S.phi[k];
    eyeMat.uniforms.time.value = tmr; eyeMat.uniforms.fade.value = V.fade; blotMat.uniforms.time.value = tmr; blotMat.uniforms.fade.value = V.fade;
    figMat.uniforms.time.value = tmr; threadMat.uniforms.time.value = tmr; coneMat.uniforms.time.value = tmr;
    overlayMat.uniforms.time.value = tmr;

    // --- eyes ---
    const P = S.playerPos(_q);
    let n = 0;
    const A = attr.iA.array, Bv = attr.iB.array, C = attr.iC.array, D = attr.iD.array, E = attr.iE.array;
    const put = (x, y, rad, rot, type, open, px, py, psz, pin, stun, smear, tgt, feign, dead, dim, seed, wall, stare, knot) => {
      if (n >= MAX_EYES) return;
      const i = n * 4;
      A[i] = x; A[i + 1] = y; A[i + 2] = rad; A[i + 3] = rot;
      Bv[i] = type; Bv[i + 1] = open; Bv[i + 2] = px; Bv[i + 3] = py;
      C[i] = psz; C[i + 1] = pin; C[i + 2] = stun; C[i + 3] = smear;
      D[i] = tgt; D[i + 1] = feign; D[i + 2] = dead; D[i + 3] = dim;
      E[i] = seed; E[i + 1] = wall; E[i + 2] = stare; E[i + 3] = knot;
      n++;
    };
    for (let i = 0; i < S.eyes.length; i++) {
      const e = S.eyes[i];
      const an = B.anim[i] || (B.anim[i] = { px: 0, py: 0, open: 0, pin: 0, stun: 0, smear: 0, tgt: 0, sway: 0, gone: 0 });
      if (e.state === ST.DEAD && e.type !== 'crown') { an.gone = Math.min(1, an.gone + dt * 3); if (an.gone >= 1) continue; }
      S.eyePos(e, _p);
      const th = S.eyeTheta(e);
      const rot = th - Math.PI / 2 + (e.inWall ? 0 : Math.sin(tmr * (e.type === 'drifter' ? 0.9 : 1.7) + i) * 0.04 * (e.moved > 0 ? 3 : 1));
      // pupil toward what it attends to, in eye space
      const lx = e.look[0] - _p[0], ly = e.look[1] - _p[1];
      const c = Math.cos(-rot), s = Math.sin(-rot);
      let ex = lx * c - ly * s, ey = lx * s + ly * c;
      const ll = Math.hypot(ex, ey) || 1, mag = Math.min(1, ll / 3) * (e.type === 'unblinking' ? 0.2 : 0.34);
      ex = ex / ll * mag; ey = ey / ll * mag * 0.75;
      const held = HELD(e.state);
      const k = held ? 0 : e.type === 'drifter' ? 3 : e.type === 'liar' || e.type === 'mimic' ? 14 : 8;
      if (k) { an.px = damp(an.px, ex, k, dt); an.py = damp(an.py, ey, k, dt); }
      // lids
      let open = eyeOpenBase(e);
      if (e.state === ST.DORMANT) open = 0;
      else if (held) open = 0.8;
      else if (e.state === ST.FEIGN) open = 0.62;
      else if (e.state === ST.KNOT) open = 0.55;
      if (e.acquiring) open = Math.min(1.1, open * 1.08);
      if (T >= e.blinkAt && T < e.blinkAt + 0.16 && !held) open *= Math.abs((T - e.blinkAt) / 0.08 - 1);
      an.open = damp(an.open, open, held ? 22 : 14, dt);
      const pinT = held ? (e.state === ST.RELEASING ? e.rel / RULES.release : 1) : e.acquiring ? e.acq / RULES.acquire * 0.55 : 0;
      an.pin = damp(an.pin, pinT, 25, dt);
      an.stun = damp(an.stun, e.state === ST.STUNNED ? 1 : 0, 6, dt);
      an.smear = damp(an.smear, e.state === ST.REVEALED ? 1 : 0, 2.5, dt);
      an.tgt = damp(an.tgt, S.gaze.target === e.id ? 1 : 0, 12, dt);
      const dead = e.state === ST.DEAD ? 1 : 0;
      put(_p[0], _p[1], e.rad * (dead ? 1 : 1 - an.gone), rot, EYE_ID[e.type], an.open, an.px, an.py, e.type === 'unblinking' ? 0.2 : 1, an.pin, an.stun, an.smear, an.tgt, e.state === ST.FEIGN ? 1 : 0, dead, e.type === 'echo' ? 0.3 : 0, (i * 0.618) % 1 * 10, e.inWall ? 1 : 0, e.stare ? 1 : 0, e.state === ST.KNOT ? 1 : 0);
    }
    // closed lids over held-shut openings, stitched seals over sealed ones
    for (const w of S.walls) for (const d of w.doors) {
      if (d.lidId === undefined && !d.sealed) continue;
      const open = S.doorOpen(d);
      d._lid = damp(d._lid === undefined ? 0 : d._lid, open ? 1 : 0, 10, dt);
      if (d._lid > 0.97) continue;
      const th = S.doorTheta(w, d);
      put(w.r * Math.cos(th), w.r * Math.sin(th), RULES.doorHalf * d.wscale * 1.05 * (1 - d._lid), th - Math.PI / 2, 12, 0, 0, 0, 1, 0, 0, 0, 0, 0, d.sealed ? 1 : 0, 0, d.i * 3.1, 1, 0, 0);
    }
    // the dark field's eyes: dim, they follow the traveller and close when looked at
    const gz = S.gaze.point;
    for (const de of B.decor) {
      const x = de.r * Math.cos(de.a + tmr * 0.004), y = de.r * Math.sin(de.a + tmr * 0.004);
      const lx = P[0] - x, ly = P[1] - y, l = Math.hypot(lx, ly) || 1;
      const rot = Math.atan2(y, x) - Math.PI / 2;
      const c = Math.cos(-rot), s = Math.sin(-rot);
      const px = (lx * c - ly * s) / l * 0.3, py = (lx * s + ly * c) / l * 0.22;
      const looked = gz && Math.hypot(gz[0] - x, gz[1] - y) < 1.2;
      de.o = damp(de.o === undefined ? 0 : de.o, looked ? 0 : (V.dread + 0.25 > de.wake ? 1 : 0), 4, dt);
      const bl = (tmr + de.blink) % 5.5 < 0.15 ? 0.2 : 1;
      put(x, y, de.rad, rot, 12, de.o * bl, px, py, 1, 0, 0, 0, 0, 0, 0, 0.82, de.seed, 0, 0, 0);
    }
    for (const a of Object.values(attr)) a.needsUpdate = true;
    eyeGeo.instanceCount = n;

    // --- the traveller ---
    const Pl = S.P;
    let pr = S.playerR();
    if (Pl.crossT > 0) pr = lerp(Pl.crossFrom, pr, smooth(1 - Pl.crossT / RULES.crossTime));
    const pth = S.playerTheta();
    const fx0 = pr * Math.cos(pth), fy0 = pr * Math.sin(pth);
    figure.position.set(fx0, fy0, 0);
    figure.quaternion.copy(V.camera.quaternion);
    figure.visible = !o.hidePlayer;
    shadow.visible = figure.visible && V.follow;
    shadow.position.set(fx0, fy0, 0.001);
    shadow.rotation.set(0, 0, pth - Math.PI / 2);   // local +y points outward from the centre
    shadowMat.uniforms.alpha.value = 0.42 * V.fade;
    const g = S.gaze.dir;
    const hasGaze = !!S.gaze.point;
    const ax = V.screenAxes();
    const gx = hasGaze ? g[0] * ax.right[0] + g[1] * ax.right[1] : 0, gy = hasGaze ? g[0] * ax.up[0] + g[1] * ax.up[1] : 0;
    const walkScreen = Pl.w ? sign((-Math.sin(pth) * ax.right[0] + Math.cos(pth) * ax.right[1]) * Pl.w) : 0;
    const lookX = hasGaze ? gx : (walkScreen || figMat.uniforms.face.value);
    figMat.uniforms.face.value = lookX >= 0 ? 1 : -1;
    figMat.uniforms.look.value.set(hasGaze ? gx : lookX, hasGaze ? gy : 0);
    figMat.uniforms.walk.value += Pl.moved * 7.5;
    figMat.uniforms.speed.value = damp(figMat.uniforms.speed.value, Math.min(1, Math.abs(Pl.v) / RULES.walk), 10, dt);
    figMat.uniforms.lean.value = damp(figMat.uniforms.lean.value, walkScreen * Math.min(1, Math.abs(Pl.v) / RULES.walk), 8, dt);
    figMat.uniforms.fear.value = damp(figMat.uniforms.fear.value, clamp((o.threat || 0), 0, 1), 4, dt);
    figMat.uniforms.exposure.value = Pl.exposure;
    figMat.uniforms.ink.value = o.capture || 0;

    // --- gaze thread from the traveller's eye ---
    _camUp.set(0, 1, 0).applyQuaternion(V.camera.quaternion);
    const headH = 0.98 * FIG_SCALE;
    const hx = fx0 + _camUp.x * headH, hy = fy0 + _camUp.y * headH, hz = _camUp.z * headH;
    let tx, ty, held = 0, show = 0;
    if (S.gaze.target !== null) {
      const te = S.eyes[S.gaze.target]; S.eyePos(te, _p); tx = _p[0]; ty = _p[1];
      held = HELD(te.state) || te.state === ST.FEIGN ? 1 : 0;   // a feigning liar looks held; that is the lie
      show = 1;
    } else if (hasGaze) {
      const dx = S.gaze.point[0] - hx, dy = S.gaze.point[1] - hy, l = Math.hypot(dx, dy) || 1, L = Math.min(l, 2.2);
      tx = hx + dx / l * L; ty = hy + dy / l * L; show = 0.6;
    }
    V.threadA = damp(V.threadA || 0, o.hideThread ? 0 : show, 10, dt);
    threadMat.uniforms.held.value = damp(threadMat.uniforms.held.value, held, 14, dt);
    threadMat.uniforms.alpha.value = V.threadA;
    thread.visible = V.threadA > 0.02 && tx !== undefined;
    if (thread.visible) {
      const dx = tx - hx, dy = ty - hy, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      threadMat.uniforms.len.value = l;
      const wdt = 0.035 + 0.02 * threadMat.uniforms.held.value;
      for (let i = 0; i <= TN; i++) {
        const t = i / TN;
        // a held thread is taut and trembles; a looking line sags slightly
        const sag = (1 - threadMat.uniforms.held.value) * Math.sin(t * Math.PI) * 0.15 + threadMat.uniforms.held.value * Math.sin(t * 40 + tmr * 30) * 0.008;
        const x = hx + dx * t + nx * sag, y = hy + dy * t + ny * sag, z = hz * (1 - t), ww = wdt * (1 - t * 0.5);
        tPos[i * 6] = x + nx * ww; tPos[i * 6 + 1] = y + ny * ww; tPos[i * 6 + 2] = z;
        tPos[i * 6 + 3] = x - nx * ww; tPos[i * 6 + 4] = y - ny * ww; tPos[i * 6 + 5] = z;
      }
      threadGeo.attributes.position.needsUpdate = true;
    }

    // --- the way in ---
    const nd = o.beacon && S.P.k < S.N ? S.nearestDoor(S.P.k, pth, true) : null;
    V.beacon.on = !!nd;
    beaconMat.uniforms.time.value = tmr;
    beaconMat.uniforms.alpha.value = damp(beaconMat.uniforms.alpha.value, nd ? 1 : 0, 5, dt);
    if (nd) {
      const bt = S.doorTheta(nd.w, nd.d);
      V.beacon.x = nd.w.r * Math.cos(bt); V.beacon.y = nd.w.r * Math.sin(bt);
      beacon.position.set(V.beacon.x, V.beacon.y, 0.002);
      beacon.rotation.set(0, 0, bt + Math.PI / 2);   // local +y points toward the centre
    }
    beacon.visible = beaconMat.uniforms.alpha.value > 0.02;

    // --- sentinel sight, cut short by whatever blocks it ---
    for (const c of B.cones) {
      const e = c.e;
      const want = e.state === ST.ACTIVE && !e.acquiring ? 1 : 0;
      c.open = damp(c.open, want, 6, dt);
      c.seen = damp(c.seen, e.seeing ? 1 : 0, 8, dt);
      c.mesh.visible = c.open > 0.02;
      if (!c.mesh.visible) continue;
      S.eyePos(e, _p);
      const half = e.half * c.open;
      c.pos[0] = _p[0]; c.pos[1] = _p[1]; c.at[0] = 0; c.as[0] = c.seen;
      for (let i = 0; i <= c.n; i++) {
        const a = e.aim - half + 2 * half * i / c.n;
        const dist = sightLength(S, e, _p[0], _p[1], a, e.range);
        c.pos[(i + 1) * 3] = _p[0] + Math.cos(a) * dist; c.pos[(i + 1) * 3 + 1] = _p[1] + Math.sin(a) * dist; c.pos[(i + 1) * 3 + 2] = 0;
        c.at[i + 1] = dist / e.range; c.as[i + 1] = c.seen;
      }
      c.mesh.geometry.attributes.position.needsUpdate = true; c.mesh.geometry.attributes.aT.needsUpdate = true; c.mesh.geometry.attributes.aSeen.needsUpdate = true;
    }

    // --- causal links and knot webs ---
    let ln = 0;
    const line = (x0, y0, x1, y1, a) => {
      if (ln >= LMAX) return;
      const i = ln * 6, j = ln * 8;
      lPos[i] = x0; lPos[i + 1] = y0; lPos[i + 2] = 0; lPos[i + 3] = x1; lPos[i + 4] = y1; lPos[i + 5] = 0;
      for (const q of [0, 4]) { lCol[j + q] = 0.03; lCol[j + q + 1] = 0.03; lCol[j + q + 2] = 0.025; lCol[j + q + 3] = a; }
      ln++;
    };
    for (const L of B.links) {
      L.t += dt;
      if (L.t > 1.6) continue;
      const a = S.eyes[L.a], b = S.eyes[L.b];
      if (!a || !b) continue;
      S.eyePos(a, _p); const x0 = _p[0], y0 = _p[1]; S.eyePos(b, _p);
      const grow = Math.min(1, L.t / 0.25);
      line(x0, y0, x0 + (_p[0] - x0) * grow, y0 + (_p[1] - y0) * grow, 0.75 * (1 - Math.max(0, L.t - 0.9) / 0.7));
    }
    B.links = B.links.filter(L => L.t <= 1.6);
    for (const kn of S.knots) {
      const m = kn.members.map(id => S.eyePos(S.eyes[id], [0, 0]));
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
        for (let q = 0; q < 3; q++) line(m[i][0], m[i][1] + (q - 1) * 0.12, m[j][0], m[j][1] - (q - 1) * 0.12, 0.6 + 0.3 * kn.unravel / 1.2 * Math.sin(tmr * 20 + q));
      }
    }
    linkGeo.setDrawRange(0, ln * 2);
    linkGeo.attributes.position.needsUpdate = true; linkGeo.attributes.color.needsUpdate = true;

    // --- ripples ---
    let rn = 0;
    for (const f of fx) {
      f.t += dt;
      if (f.t > f.dur) continue;
      const k = f.t / f.dur;
      rA.array[rn * 4] = f.x; rA.array[rn * 4 + 1] = f.y; rA.array[rn * 4 + 2] = f.size * (f.fill ? (0.4 + 0.6 * smooth(Math.min(1, k * 3))) : (0.4 + k)); rA.array[rn * 4 + 3] = 0;
      rB.array[rn * 2] = 1 - k; rB.array[rn * 2 + 1] = f.fill ? 1 : 0;
      rn++;
    }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].t > fx[i].dur) fx.splice(i, 1);
    rGeo.instanceCount = rn; rA.needsUpdate = true; rB.needsUpdate = true;
  };

  // react to simulation events with marks on the drawing
  V.onEvents = function (S, events) {
    const B = built; if (!B) return;
    for (const ev of events) {
      if (ev.type === 'link' && ev.from >= 0) B.links.push({ a: ev.from, b: ev.to, t: 0 });
      else if (ev.type === 'pin') { S.eyePos(S.eyes[ev.eye], _p); V.ripple(_p[0], _p[1], S.eyes[ev.eye].rad * 1.9, 0.45); }
      else if (ev.type === 'chain') { const e = S.eyes[ev.eye]; if (e) { S.eyePos(e, _p); V.ripple(_p[0], _p[1], 1.2 + ev.n * 0.35, 0.9); } }
      else if (ev.type === 'knot' || ev.type === 'absorb') { const e = S.eyes[ev.type === 'knot' ? ev.members[0] : ev.eye]; S.eyePos(e, _p); V.ripple(_p[0], _p[1], 0.9, 0.7, true); }
      else if (ev.type === 'crownBreak') { S.eyePos(S.eyes[ev.eye], _p); V.ripple(_p[0], _p[1], 2.4, 1.1); }
      else if (ev.type === 'unravel') for (const id of ev.members) { S.eyePos(S.eyes[id], _p); V.ripple(_p[0], _p[1], 1.1, 0.6); }
    }
  };

  V.render = () => renderer.render(scene, V.camera);
  return V;
}

// How far a sentinel sees along angle a before something stops it (an eye, a veil, the pupil).
function sightLength(S, self, x, y, a, range) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = range;
  // pupil
  const rp = S.G.Ri * RULES.pupilFrac;
  { const b = x * dx + y * dy, c = x * x + y * y - rp * rp, disc = b * b - c; if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0.02 && t < best) best = t; } }
  // eyes
  const p = [0, 0];
  for (const e of S.eyes) {
    if (e === self || e.state === ST.DEAD || e.decoy || e.state === ST.REVEALED) continue;
    S.eyePos(e, p);
    const ox = p[0] - x, oy = p[1] - y, t = ox * dx + oy * dy;
    if (t <= 0.05 || t > best) continue;
    const d2 = ox * ox + oy * oy - t * t, r = e.rad * 0.72;
    if (d2 < r * r) best = Math.min(best, t - Math.sqrt(r * r - d2) + 0.15);
  }
  // veils
  for (const w of S.walls) {
    if (!w.veils.length) continue;
    const b = x * dx + y * dy, c = x * x + y * y - w.r * w.r, disc = b * b - c;
    if (disc <= 0) continue;
    for (const t of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
      if (t <= 0.02 || t >= best) continue;
      const th = wrap0(Math.atan2(y + dy * t, x + dx * t) - S.phi[w.owner]);
      for (const v of w.veils) if (inArc(th, wrap0(v[0]), wrap0(v[1]))) { best = t; break; }
    }
  }
  return best;
}

// ---- 06_audio.js ----
// =====================================================================
// Sound: a small, dry vocabulary. Every cue with a meaning means one
// thing, every time, and has something on screen that agrees with it.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, vol: 0.85 };
  let ac, master, wet, nb, room, roomGain, roomLp, fric, fricGain, fricBp, drone, droneGain, heartT = 0;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.7 * A.vol;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; master.connect(comp); comp.connect(ac.destination);
        // a small dry room: short, dark reverb
        const len = Math.floor(ac.sampleRate * 1.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        const wlp = ac.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 2400;
        wet = ac.createGain(); wet.gain.value = 0.35; wet.connect(wlp); wlp.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const nd = nb.getChannelData(0); let br = 0;
        for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; nd[i] = i % 2 ? w : br * 3.5; }
        const loop = (type, f, q) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return { s, fl, g }; };
        // room tone: very low, almost felt rather than heard
        room = loop('lowpass', 140, 0.7); roomGain = room.g; roomLp = room.fl;
        // the spiral's friction when it turns
        fric = loop('bandpass', 380, 3.5); fricGain = fric.g; fricBp = fric.fl;
        // the unblinking's presence
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 41;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
        droneGain = ac.createGain(); droneGain.gain.value = 0; o.connect(lp); lp.connect(droneGain); droneGain.connect(master); o.start(); drone = o;
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setVolume = v => { A.vol = v; if (master) master.gain.setTargetAtTime(0.7 * v, ac.currentTime, 0.05); };
  A.suspend = () => { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = () => { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.3 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.25 : rev, pan); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  // --- the traveller ---
  A.step = (pan, soft) => noise(0.05, 'bandpass', 1400 + Math.random() * 500, 1.6, soft ? 0.012 : 0.022, 700, 0, 0.1, pan);
  A.cross = () => { noise(0.22, 'bandpass', 900, 1.2, 0.05, 300, 0, 0.3); tone(110, 0.25, 'sine', 0.04, 80, 0, 0.2); };
  A.bump = () => { noise(0.08, 'lowpass', 500, 1, 0.06, 200, 0, 0.1); };
  // --- gaze ---
  A.acquire = pan => tone(560, 0.18, 'sine', 0.012, 840, 0, 0.3, pan, 0.06);
  A.pin = (pan, big) => { noise(0.025, 'highpass', 3200, 1, 0.09, 0, 0, 0.15, pan); tone(big ? 70 : 92, 0.14, 'sine', 0.09, 60, 0, 0.1, pan); };
  A.release = pan => { noise(0.32, 'bandpass', 900, 0.8, 0.035, 300, 0, 0.35, pan, 0.08); };
  A.feign = pan => { noise(0.45, 'bandpass', 600, 1.2, 0.04, 1800, 0, 0.4, pan, 0.2); };       // an inhale, not a click: the liar's tell
  A.lunge = pan => { noise(0.35, 'bandpass', 2200, 2.5, 0.07, 500, 0, 0.25, pan, 0.02); noise(0.25, 'lowpass', 400, 1, 0.08, 120, 0.05, 0.2, pan); };
  A.immune = pan => { tone(46, 0.6, 'sine', 0.12, 40, 0, 0.5, pan, 0.04); };
  A.reveal = pan => { noise(0.6, 'bandpass', 2600, 1.5, 0.03, 900, 0, 0.6, pan, 0.05); };
  // --- eyes ---
  A.track = pan => noise(0.03, 'bandpass', 3800 + Math.random() * 1500, 4, 0.006, 0, 0, 0.1, pan);
  A.wake = pan => { noise(0.18, 'bandpass', 1300, 2, 0.03, 2400, 0, 0.3, pan, 0.04); };
  A.turnEye = pan => noise(0.06, 'lowpass', 300, 1, 0.025, 0, 0, 0.1, pan);
  A.ripple = (pan, n) => { const base = 330; [0, 1, 6].forEach((k, i) => tone(base * Math.pow(2, k / 12), 0.9, 'sine', 0.018, 0, i * 0.09, 0.7, pan, 0.08)); };
  A.choirBreak = pan => { [440, 415, 392, 349].forEach((f, i) => tone(f, 1.1, 'triangle', 0.03, f * 0.7, i * 0.06, 0.8, pan)); };
  A.gather = pan => { tone(62, 0.8, 'sawtooth', 0.025, 50, 0, 0.4, pan, 0.2); };
  A.knot = pan => { noise(0.4, 'lowpass', 700, 1, 0.12, 120, 0, 0.3, pan); tone(55, 0.6, 'sine', 0.12, 38, 0, 0.3, pan); };
  A.unravel = pan => { for (let i = 0; i < 4; i++) noise(0.12, 'bandpass', 1500 + i * 400, 2, 0.04, 600, i * 0.05, 0.4, pan); };
  A.chain = n => { for (let i = 0; i < Math.min(5, n); i++) tone(660 * Math.pow(2, [0, 3, 7, 10, 12][i] / 12), 0.5, 'triangle', 0.03, 0, i * 0.07, 0.6); };
  A.absorb = pan => { noise(0.5, 'lowpass', 500, 2, 0.1, 80, 0, 0.4, pan); };
  A.jam = () => { tone(68, 0.35, 'sawtooth', 0.04, 55, 0, 0.3); noise(0.2, 'bandpass', 250, 4, 0.06, 150, 0, 0.2); };
  A.fixate = pan => tone(1200, 0.25, 'sine', 0.012, 900, 0, 0.3, pan);
  A.crownBreak = pan => { noise(0.6, 'highpass', 1800, 1, 0.08, 600, 0, 0.6, pan); tone(98, 1.4, 'sawtooth', 0.04, 49, 0, 0.8, pan); };
  A.unseal = () => { [196, 233, 294].forEach((f, i) => tone(f, 2.4, 'sine', 0.04, 0, i * 0.2, 1)); };
  A.close = () => tone(1800, 0.06, 'sine', 0.006, 0, 0, 0.1);
  // --- the run ---
  A.capture = () => { noise(0.08, 'highpass', 4000, 1, 0.12, 0, 0, 0.1); tone(48, 1.6, 'sine', 0.3, 30, 0.05, 0.8); noise(1.4, 'lowpass', 900, 1, 0.2, 60, 0.05, 0.8); };
  A.descend = () => { noise(1.6, 'bandpass', 1800, 1.2, 0.06, 120, 0, 0.7, 0, 0.6); tone(73, 2.2, 'sine', 0.06, 55, 0.4, 0.9, 0, 0.3); };
  A.arrive = () => { tone(220, 1.8, 'sine', 0.025, 0, 0, 0.9, 0, 0.3); };
  A.ending = () => { [55, 82.5, 110].forEach((f, i) => tone(f, 6, 'sine', 0.06, f * 0.99, i * 0.6, 1, 0, 1.5)); };
  // continuous state: room tone, friction under rotation, heartbeat for exposure, the unblinking drone
  A.ambient = (o, dt) => {
    if (!A.ok) return;
    const t = ac.currentTime;
    roomGain.gain.setTargetAtTime(o.quiet ? 0.002 : 0.05 + 0.04 * (o.dread || 0), t, 0.6);
    roomLp.frequency.setTargetAtTime(110 + 90 * (o.dread || 0), t, 1);
    fricGain.gain.setTargetAtTime(Math.min(0.09, Math.abs(o.rot || 0) * 0.08), t, 0.05);
    fricBp.frequency.setTargetAtTime(300 + Math.abs(o.rot || 0) * 220, t, 0.1);
    droneGain.gain.setTargetAtTime((o.unblinking || 0) * 0.07, t, 0.4);
    if (drone) drone.frequency.setTargetAtTime(38 + (o.unblinking || 0) * 10, t, 0.4);
    if (o.exposure > 0.02) {
      heartT -= dt;
      if (heartT <= 0) { heartT = 0.85 - o.exposure * 0.5; tone(54, 0.16, 'sine', 0.1 + o.exposure * 0.12, 40, 0, 0.1); tone(50, 0.14, 'sine', 0.07 + o.exposure * 0.1, 38, 0.17, 0.1); }
    } else heartT = 0;
  };
  A.kill = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}

// ---- 07_ui.js ----
// =====================================================================
// Interface: quiet, sans-serif, out of the drawing's way.
// Inter throughout. Scale (px): 13 small · 15 body · 24 heading · 34 title.
// 16px gutter inside the content-safe area, 8px rhythm.
// =====================================================================
const UI_CSS = `
.wb{position:absolute;inset:0;font-family:Inter,system-ui,-apple-system,sans-serif;font-weight:400;color:#ece4d2;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--bone:#ece4d2;--ink:#0f0d0b;--muted:rgba(236,228,210,.62)}
.wb *{box-sizing:border-box}
.wb-top{position:absolute;left:16px;right:16px;top:0;display:flex;justify-content:space-between;align-items:center;transition:opacity .4s}
.wb-num{font-size:13px;font-weight:600;color:#ece4d2;background:rgba(18,16,12,.62);padding:6px 11px;border-radius:999px;font-variant-numeric:tabular-nums;letter-spacing:.01em}
.wb-name{position:absolute;left:16px;max-width:calc(100% - 32px);font-size:15px;font-weight:600;color:#ece4d2;background:rgba(18,16,12,.66);padding:7px 12px;border-radius:10px;opacity:0;transition:opacity .8s;pointer-events:none}
.wb-btn{pointer-events:auto;width:44px;height:44px;border-radius:50%;border:1px solid rgba(236,228,210,.35);background:rgba(15,13,11,.45);color:var(--bone);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer}
.wb-btn svg{width:38%;height:38%;overflow:visible}
.wb-btn:active{background:rgba(236,228,210,.18)}
.wb-band{position:absolute;left:0;right:0;bottom:0;pointer-events:none}
.wb-hint{position:absolute;left:24px;right:24px;text-align:center;font-size:15px;font-weight:500;line-height:1.4;opacity:0;transition:opacity .5s;text-shadow:0 1px 14px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.9)}
.wb-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:1.5px solid rgba(236,228,210,.22);transition:border-color .2s}
.wb-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(236,228,210,.16);transition:background .2s}
.wb-stick.live{border-color:rgba(236,228,210,.45)}
.wb-stick.live b{background:rgba(236,228,210,.38)}
.wb-stick.teach b{animation:wbk 1.3s ease-in-out infinite alternate}
@keyframes wbk{from{transform:translateX(-24px)}to{transform:translateX(24px)}}
.wb-dial{position:absolute;height:56px;display:none;overflow:hidden;border-radius:28px;border:1.5px solid rgba(236,228,210,.22);-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)}
.wb-dial i{position:absolute;top:16px;bottom:16px;width:1.5px;background:rgba(236,228,210,.38)}
.wb-dial i.l{top:10px;bottom:10px;background:rgba(236,228,210,.7)}
.wb-dial em{position:absolute;top:50%;left:50%;width:12px;height:12px;margin:-6px;border-radius:50%;background:var(--bone)}
.wb-dial.teach em{animation:wbk 1.3s ease-in-out infinite alternate}
.wb-edge{position:absolute;width:28px;height:28px;margin:-14px;display:none}
.wb-edge svg{width:100%;height:100%;overflow:visible}
.wb-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 50%,rgba(8,7,6,.92) 100%);opacity:0;transition:opacity .25s}
.wb-mark{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 55%,rgba(30,28,12,.55) 100%);opacity:0;transition:opacity .3s}
.wb-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 16px}
.wb-panel.on{display:flex}
.wb-panel.mid{justify-content:center}
.wb-card{width:100%;max-width:380px;border-radius:16px;padding:20px;background:rgba(15,13,11,.88);border:1px solid rgba(236,228,210,.12);pointer-events:auto}
.wb-title{position:absolute;left:24px;right:24px;font-size:34px;font-weight:700;line-height:1.08;letter-spacing:-.02em;text-shadow:0 2px 24px rgba(0,0,0,.95)}
.wb-tag{font-size:15px;font-weight:400;line-height:1.45;color:var(--muted);margin-top:12px;letter-spacing:0;max-width:300px}
.wb-b{display:block;width:100%;border:0;border-radius:12px;padding:0 16px;height:50px;margin-top:8px;font:600 15px Inter,system-ui,sans-serif;color:var(--ink);background:var(--bone);pointer-events:auto;cursor:pointer}
.wb-b:active{opacity:.85}
.wb-b.sec{background:transparent;color:var(--bone);border:1px solid rgba(236,228,210,.28)}
.wb-b[hidden]{display:none}
.wb-row{display:flex;gap:8px}.wb-row .wb-b{flex:1}
.wb-h{font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-.01em;margin-bottom:8px}
.wb-sub{font-size:15px;line-height:1.45;color:var(--muted);margin-bottom:16px}
.wb-stats{display:flex;gap:8px;margin-bottom:12px}
.wb-stats>div{flex:1;font-size:13px;color:var(--muted)}
.wb-stats b{display:block;font-size:22px;font-weight:600;color:var(--bone);font-variant-numeric:tabular-nums;margin-bottom:2px}
.wb-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-top:1px solid rgba(236,228,210,.08);font-size:15px;color:var(--muted)}
.wb-li b{font-weight:600;color:var(--bone);font-variant-numeric:tabular-nums}
.wb-new{color:#c9c38a}
.wb-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:15px;min-height:48px}
.wb-set input[type=range]{width:46%;pointer-events:auto;accent-color:#ece4d2}
.wb-tog{pointer-events:auto;border:1px solid rgba(236,228,210,.3);background:transparent;color:var(--bone);border-radius:10px;padding:8px 14px;font:600 13px Inter,sans-serif;min-width:64px;min-height:38px}
.wb-tog.on{background:var(--bone);color:var(--ink)}
.wb-act{position:absolute;inset:0;display:none;flex-direction:column;align-items:flex-start;justify-content:center;padding:0 32px;transition:background .6s;pointer-events:auto}
.wb-act.on{display:flex;background:rgba(10,9,8,.6)}
.wb-act .s{font-size:13px;font-weight:600;color:var(--muted);opacity:0;transition:opacity .8s;margin-bottom:8px}
.wb-act .t{font-size:30px;font-weight:600;line-height:1.15;letter-spacing:-.015em;opacity:0;transition:opacity .8s;text-shadow:0 2px 20px rgba(0,0,0,.9)}
.wb-act.show .t,.wb-act.show .s{opacity:1}
.wb-end{position:absolute;left:32px;right:32px;font-size:18px;font-weight:500;line-height:1.45;opacity:0;transition:opacity 1.6s;text-shadow:0 1px 16px rgba(0,0,0,.95)}
.wb-skip{position:absolute;right:16px;font-size:13px;font-weight:600;color:var(--muted);pointer-events:auto;padding:14px}
`;

const ICON = {
  pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edge: '<svg viewBox="-10 -10 20 20"><path d="M-5,4L0,-3L5,4" fill="none" stroke="#ece4d2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function createUI(ctx) {
  const ui = ctx.createRoot({ className: 'wb', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = { root: ui, el };
  H.vig = el('div', 'wb-vig');
  H.mark = el('div', 'wb-mark');
  H.top = el('div', 'wb-top');
  H.num = el('div', 'wb-num', '', H.top);
  H.pause = el('div', 'wb-btn', ICON.pause, H.top);
  H.pause.setAttribute('aria-label', 'Pause');
  H.name = el('div', 'wb-name', '');
  H.band = el('div', 'wb-band');
  H.hint = el('div', 'wb-hint', '');
  H.edge = el('div', 'wb-edge', ICON.edge);
  H.stick = el('div', 'wb-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.dial = el('div', 'wb-dial', '<em></em>'); H.dialKnob = H.dial.firstChild;
  H.ticks = [];
  for (let i = 0; i < 24; i++) { const t = el('i', i % 4 === 0 ? 'l' : '', undefined, H.dial); H.ticks.push(t); }
  // act card
  H.act = el('div', 'wb-act');
  H.actS = el('div', 's', '', H.act); H.actT = el('div', 't', '', H.act);
  // ending text
  H.end = el('div', 'wb-end', '');
  H.skip = el('div', 'wb-skip', 'Skip'); H.skip.style.display = 'none';
  // title
  H.title = el('div', 'wb-panel');
  H.titleText = el('div', 'wb-title', 'The Thing That Watches Back<div class="wb-tag">Watch an eye and it cannot move. Look away and it is free.</div>', H.title);
  const tc = el('div', 'wb-card', '', H.title);
  H.tstats = el('div', 'wb-stats', '', tc);
  H.begin = el('button', 'wb-b', 'Begin', tc);
  H.cont = el('button', 'wb-b sec', 'Continue', tc);
  const trow = el('div', 'wb-row', '', tc);
  H.endless = el('button', 'wb-b sec', 'Endless', trow);
  H.toSet = el('button', 'wb-b sec', 'Settings', trow);
  // pause
  H.pausePanel = el('div', 'wb-panel mid');
  const pc = el('div', 'wb-card', '', H.pausePanel);
  el('div', 'wb-h', 'Paused', pc);
  H.pauseSub = el('div', 'wb-sub', '', pc);
  H.resume = el('button', 'wb-b', 'Resume', pc);
  H.restart = el('button', 'wb-b sec', 'Restart encounter', pc);
  const prow = el('div', 'wb-row', '', pc);
  H.pSet = el('button', 'wb-b sec', 'Settings', prow);
  H.quit = el('button', 'wb-b sec', 'End run', prow);
  // capture
  H.cap = el('div', 'wb-panel');
  const cc = el('div', 'wb-card', '', H.cap);
  H.capH = el('div', 'wb-h', '', cc);
  H.capSub = el('div', 'wb-sub', '', cc);
  H.again = el('button', 'wb-b', 'Try again', cc);
  H.capEnd = el('button', 'wb-b sec', 'End run', cc);
  // results
  H.res = el('div', 'wb-panel');
  const rc = el('div', 'wb-card', '', H.res);
  H.resH = el('div', 'wb-h', '', rc);
  H.resSub = el('div', 'wb-sub', '', rc);
  H.resStats = el('div', 'wb-stats', '', rc);
  H.resList = el('div', '', '', rc);
  H.resAgain = el('button', 'wb-b', 'Play again', rc);
  const rrow = el('div', 'wb-row', '', rc);
  H.resEndless = el('button', 'wb-b sec', 'Endless', rrow);
  H.resTitle = el('button', 'wb-b sec', 'Title', rrow);
  // settings
  H.set = el('div', 'wb-panel mid');
  const sc = el('div', 'wb-card', '', H.set);
  el('div', 'wb-h', 'Settings', sc);
  H.setList = el('div', '', '', sc);
  H.setBack = el('button', 'wb-b', 'Back', sc);
  H.panels = [H.title, H.pausePanel, H.cap, H.res, H.set];
  H.showOnly = p => { for (const x of H.panels) x.classList.toggle('on', x === p); };
  return H;
}

// ---- 08_game.js ----
// =====================================================================
// The game: states, input, hints, scoring, transitions and the Plethora
// lifecycle. States: title → card → play ⇄ paused; play → captured →
// capcard → play | results; play → descend → card/play; → ending → results.
// =====================================================================

const SAVE_KEY = 'watchesback_save';
const defaultSave = () => ({ best: 0, bestEndless: 0, deepest: 0, completed: false, runs: 0, settings: { volume: 0.85, dial: 1, swap: false, calm: false, hints: true } });

// why a capture happened, and what it teaches; keyed by what caught you
const CAUGHT = {
  watcher: ['It reached you', 'It only moves while you are not watching it.'],
  drifter: ['Crushed in the groove', 'The drifter is blind. It goes until something stops it.'],
  collector: ['Gathered', 'Watch the collector, or keep the others apart.'],
  liar: ['It was never held', 'This one looks away when watched. It was waiting for you to look away too.'],
  liarFeign: ['It was never held', 'Watching it only makes it pretend. Walking into it is still fatal.'],
  mimic: ['It moved the way you moved', 'It copies your steps a moment late. When you stop, it keeps coming for that moment.'],
  sentinel: ['Seen', 'A watched sentinel sees nothing. An eye between you hides you too.'],
  choir: ['The choir closed over you', 'One of them blinks first. Watch that one and the formation breaks.'],
  crown: ['The crown closed', 'Only the eye leading it can break it, and only when the crown is whole.'],
  unblinking: ['It has no lids', 'Your gaze does nothing to it. Watched eyes in its way are walls. Turn its ring away.'],
  echo: ['You met yourself', 'These move the way you once moved.'],
};

window.plethoraBit = {
  meta: { title: 'The Thing That Watches Back', runtime: 'plethora-bit@2', tags: ['arcade', 'horror', 'puzzle', 'strategy'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s, { settings: Object.assign(defaultSave().settings, s.settings || {}) }); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:#100e0c';
    const H = createUI(ctx);
    H.showOnly(H.title);
    H.tstats.innerHTML = '<div><b>…</b>Opening</div>';
    for (const b of [H.begin, H.cont, H.endless, H.toSet]) b.style.visibility = 'hidden';
    H.top.style.display = 'none';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    for (const wgt of ['400', '600', '700']) { try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: wgt, style: 'normal' }).catch(() => { }); } catch (e) { } }

    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start WebGL graphics.', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      H.tstats.innerHTML = `<div style="text-align:center;line-height:1.4"><b style="font-size:16px">${msg}</b></div>`;
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    ctx.onDestroy(() => { destroyed = true; try { V.dispose(); renderer.dispose(); } catch (e) { } });

    // off-screen drawing surfaces for the ring drawings: hidden ctx canvases, reused for every spiral
    const pool = [];
    let poolIdx = 0;
    const mkCanvas = (w, h) => {
      let c = pool[poolIdx];
      if (!c) { c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' }); c.style.display = 'none'; pool.push(c); }
      poolIdx++;
      c.width = w; c.height = h;
      return c;
    };
    const V = createView(THREE, renderer, { canvas: mkCanvas, resetCanvases: () => { poolIdx = 0; }, small });
    const audio = createAudio(!!caps.audio);
    audio.setVolume(save.settings.volume);
    ctx.onDestroy(() => audio.kill());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    const touchFirst = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
    let usedTouch = touchFirst;

    // ---------- state ----------
    let mode = 'title', S = null, def = null, run = null, wall = 0;
    let mt = 0;             // time in the current mode
    const input = { stick: null, dial: null, keys: new Set(), mouseGaze: null, gazeSet: undefined };
    let layoutBand = 0.22;

    // ---------- title spiral: a drawing that watches you ----------
    const TITLE_DEF = { id: 0, n: 4, rotation: true, seed: 11, doors: [[-90, 60], [150], [-30], [90]], barriers: [[], [40], [], [-120]], veils: [[], [[100, 130]], [], []], player: { k: 0, a: -90 },
      eyes: [{ type: 'watcher', k: 0, a: 20 }, { type: 'drifter', k: 1, a: -100 }, { type: 'liar', k: 1, a: 80 }, { type: 'sentinel', wall: 1, a: 200, face: 'in' }, { type: 'choir', k: 2, a: 10 }, { type: 'choir', k: 2, a: 26 }, { type: 'choir', k: 2, a: 42 }, { type: 'mimic', k: 3, a: 160 }, { type: 'collector', k: 0, a: 150 }, { type: 'unblinking', k: 2, a: -140 }].map(e => Object.assign(e, { beh: 'still' })) };
    let pointerWorld = null;
    function showTitle() {
      mode = 'title'; mt = 0; run = null;
      def = TITLE_DEF; S = createSim(def); S.forcedRot = 0.05;
      V.setFollow(false);
      V.build(S, def); V.dread = 0.2; V.fade = 0.6;
      layout(ctx.width, ctx.height, area());
      H.showOnly(H.title); setPlayHud(false);
      H.tstats.innerHTML = `<div><b>${save.deepest ? save.deepest + ' / 20' : '—'}</b>Furthest</div><div><b>${save.best ? save.best.toLocaleString() : '—'}</b>Best run</div><div><b>${save.bestEndless ? save.bestEndless.toLocaleString() : '—'}</b>Endless</div>`;
      for (const b of [H.begin, H.cont, H.endless, H.toSet]) b.style.visibility = '';
      const act = continueAct();
      H.cont.hidden = act <= 1; H.cont.textContent = act > 1 ? `Continue from act ${act}` : 'Continue';
      H.endless.disabled = !save.completed; H.endless.style.opacity = save.completed ? '' : '0.35';
      H.endless.textContent = save.completed ? 'Endless' : 'Endless (locked)';
      V.ink(0); V.zoom = 1; V.applyCamera();
    }
    // frame the spiral itself, with a margin of the dark field around it
    function frameR() { return S ? S.G.Ro + 0.7 : 10; }
    function continueAct() { const e = ENCOUNTERS.find(q => q.id === save.deepest); return e ? e.act : 1; }

    // ---------- HUD ----------
    function setPlayHud(on) {
      H.top.style.display = on ? '' : 'none';
      H.band.style.display = on ? '' : 'none';
      H.dial.style.display = on && S && !S.rotLocked ? 'block' : 'none';
      H.stick.style.display = on && usedTouch ? 'block' : 'none';
      if (on && !input.stick) homeStick();
      if (!on) { H.stick.classList.remove('teach'); H.hint.style.opacity = 0; H.vig.style.opacity = 0; H.edge.style.display = 'none'; H.mark.style.opacity = 0; H.name.style.opacity = 0; }
    }
    let hint = { key: null, until: 0 };
    function showHint(key, text, dur) {
      if (!save.settings.hints && !['look'].includes(key)) return;
      hint = { key, until: dur ? mt + dur : 1e9 };
      H.hint.textContent = text; H.hint.style.opacity = 1;
    }
    function clearHint(key) { if (!key || hint.key === key) { hint.key = null; H.hint.style.opacity = 0; H.stick.classList.remove('teach'); H.dial.classList.remove('teach'); } }
    // the stick rests in the lower left so the player always knows where walking lives
    function homeStick() { H.stick.classList.remove('live'); H.stick.style.left = (save.settings.swap ? ctx.width - 88 : 88) + 'px'; H.stick.style.top = (bandBottom() - bandPx() * 0.5) + 'px'; H.knob.style.transform = ''; }

    // ---------- runs and encounters ----------
    function newRun(kind, startId) {
      run = { kind, startId: startId || 1, full: kind === 'campaign' && (startId || 1) === 1, score: 0, captures: 0, chains: 0, bestChain: 0, pins: 0, reveals: 0, cleared: 0, time: 0, habit: { dir: 1 }, walkSigned: 0, recordings: [], depth: kind === 'endless' ? 1 : 0, encCaptures: 0, log: [], learned: {} };
    }
    function begin(kind, startId) {
      audio.unlock();
      newRun(kind, startId);
      save.runs++; persist();
      try { ctx.platform.start({ mode: kind, from: startId || 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
      if (kind === 'endless') startEncounter(makeEndless(1, run), true);
      else startEncounter(encounterById(startId || 1), true);
    }
    function startEncounter(E, showCard) {
      run.E = E; run.encT = 0; run.encCaptures = run.encCaptures || 0;
      def = buildEncounter(E, { habit: run.habit, recordings: run.recordings });
      S = createSim(def, {});
      V.build(S, def); V.ink(0);
      layout(ctx.width, ctx.height, area());
      input.gazeSet = null; input.stick = null; input.dial = null;
      H.num.textContent = run.kind === 'endless' ? `Depth ${run.depth}` : `${E.id} / 20`;
      H.name.textContent = E.name;
      H.name.style.opacity = 0;
      const firstOfAct = run.kind === 'campaign' && (E.id === run.startId || ENCOUNTERS.find(q => q.act === E.act).id === E.id);
      if (V.follow || run) { V.setFollow(true); V.updateRig(S, 0, true); }
      if (showCard && firstOfAct && ACTS[E.act]) { mode = 'card'; mt = 0; H.actS.textContent = ACTS[E.act].sub; H.actT.textContent = ACTS[E.act].title; H.act.classList.add('on'); ctx.timeout(() => H.act.classList.add('show'), 30); setPlayHud(false); }
      else enterPlay();
    }
    function enterPlay() {
      mode = 'play'; mt = 0; V.fade = 1;
      if (!V.follow) V.setFollow(true);
      V.updateRig(S, 0, true);
      H.act.classList.remove('on', 'show');
      H.showOnly(null); setPlayHud(true);
      const enc = run.E;
      // the encounter's name, briefly; then the drawing has the screen to itself
      ctx.timeout(() => { if (mode === 'play' && run && run.E === enc) H.name.style.opacity = 0.9; }, 200);
      ctx.timeout(() => { if (run && run.E === enc) H.name.style.opacity = 0; }, 2600);
      if (run.E.id === 1 && run.kind === 'campaign') showHint('walk', usedTouch ? 'Drag the circle to walk.' : 'Walk with W A S D or the arrow keys.');
      else if (enc.intro && run.kind === 'campaign' && !run.learned['intro' + enc.id]) { run.learned['intro' + enc.id] = true; showHint('intro', enc.intro, 4.5); }
      if (!S.rotLocked && !run.learned.turn) H.dial.classList.add('teach');
      if (!run.learned.walk && usedTouch) H.stick.classList.add('teach');
      audio.arrive();
    }
    function restartEncounter() { if (!run) return; startEncounter(run.E, false); }
    function updateScore() { }
    // when the way deeper is off-screen, a small arrow on the edge points to it
    function updateEdge() {
      if (mode !== 'play' || !V.beacon.on) { H.edge.style.display = 'none'; return; }
      const [sx, sy] = V.toScreen(V.beacon.x, V.beacon.y, 0), a = area();
      const x0 = a.left + 24, x1 = ctx.width - a.right - 24, y0 = a.top + 72, y1 = bandBottom() - bandPx() - 12;
      if (sx > x0 && sx < x1 && sy > y0 && sy < y1) { H.edge.style.display = 'none'; return; }
      const cx = ctx.width / 2, cy = (y0 + y1) / 2, dx = sx - cx, dy = sy - cy;
      const k = Math.min(Math.abs((dx > 0 ? x1 - cx : x0 - cx) / (dx || 1e-6)), Math.abs((dy > 0 ? y1 - cy : y0 - cy) / (dy || 1e-6)));
      H.edge.style.display = 'block';
      H.edge.style.left = (cx + dx * k) + 'px'; H.edge.style.top = (cy + dy * k) + 'px';
      H.edge.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
    }

    // ---------- the frame ----------
    let acc = 0;
    const DT = SIM_DT;
    const _pp = [0, 0];
    function readInput() {
      if (input.override) return input.override;
      const inp = {};
      // walking: the stick or keys, as a direction on the screen (= the world plane)
      let mx = 0, my = 0;
      if (input.stick) { mx = clamp((input.stick.x - input.stick.ox) / 46, -1, 1); my = -clamp((input.stick.y - input.stick.oy) / 46, -1, 1); const l = Math.hypot(mx, my); if (l < 0.15) { mx = my = 0; } else if (l > 1) { mx /= l; my /= l; } }
      const K = input.keys;
      if (K.has('KeyA') || K.has('ArrowLeft')) mx -= 1; if (K.has('KeyD') || K.has('ArrowRight')) mx += 1;
      if (K.has('KeyW') || K.has('ArrowUp')) my += 1; if (K.has('KeyS') || K.has('ArrowDown')) my -= 1;
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      // screen right walks one way along the groove, screen up steps toward the centre
      const ax = V.screenAxes();
      inp.move = [ax.right[0] * mx + ax.up[0] * my, ax.right[1] * mx + ax.up[1] * my];
      // turning: the dial (a jog: how far you hold it is how fast it turns) or Q / E
      let rot = 0;
      if (input.dial) rot = clamp((input.dial.x - input.dial.ox) / (64 / save.settings.dial), -1, 1) * (Math.abs(input.dial.x - input.dial.ox) < 5 ? 0 : 1);
      if (K.has('KeyQ')) rot -= K.has('ShiftLeft') || K.has('ShiftRight') ? 0.35 : 1;
      if (K.has('KeyE')) rot += K.has('ShiftLeft') || K.has('ShiftRight') ? 0.35 : 1;
      inp.rot = -rot;   // dial right turns the even rings clockwise
      if (input.gazeSet !== undefined) { inp.gaze = input.gazeSet; input.gazeSet = undefined; }
      return inp;
    }
    function threatLevel() {
      if (!S) return 0;
      let t = S.P.exposure;
      const p = S.P;
      for (const e of S.eyes) if (e.k === p.k && !e.inWall && e.lethal && e.state === ST.ACTIVE) { const d = Math.abs(wrap(e.a - p.a)) * S.rings[p.k].r - e.rad; t = Math.max(t, clamp(1 - d / 3, 0, 1)); }
      return t;
    }
    function step() {
      const inp = readInput();
      if (!inp.move) inp.move = [0, 0];
      if (Math.hypot(inp.move[0], inp.move[1]) > 0.1 && !run.learned.walk) { run.learned.walk = true; if (hint.key === 'walk') clearHint('walk'); H.stick.classList.remove('teach'); }
      if (inp.rot) { if (!run.learned.turn && Math.abs(S.stats.rotated) > 0.6) { run.learned.turn = true; H.dial.classList.remove('teach'); if (hint.key === 'turn') clearHint('turn'); } }
      const ring0 = S.P.k;
      S.step(inp);
      run.encT += DT; run.time += DT;
      handleEvents(S.events);
      // footsteps, and the mimic's echo of them a moment late
      if (S.P.moved > 0) { V._stepAcc = (V._stepAcc || 0) + S.P.moved; if (V._stepAcc > 0.85) { V._stepAcc = 0; audio.step(panOf(S.playerPos(_pp))); } }
      for (const e of S.eyes) if (e.type === 'mimic' && e.moved > 0 && e.state === ST.ACTIVE) { e._st = (e._st || 0) + e.moved; if (e._st > 0.85) { e._st = 0; audio.step(panOf(S.eyePos(e, _pp)), true); } }
      hints();
      if (S.over) return capture();
      if (S.reached) return clearEncounter();
    }
    const panOf = p => clamp(p[0] / 9, -1, 1);
    function handleEvents(evs) {
      V.onEvents(S, evs);
      for (const ev of evs) {
        const e = ev.eye !== undefined && ev.eye >= 0 ? S.eyes[ev.eye] : null;
        const pan = e ? panOf(S.eyePos(e, _pp)) : 0;
        switch (ev.type) {
          case 'pin': audio.pin(pan, e && e.type === 'drifter'); haptic('light'); run.pins++; if (!run.learned.pin) { run.learned.pin = true; if (hint.key === 'look') clearHint('look'); if (run.E.id <= 2) showHint('held', 'While you watch it, it cannot move.', 2.6); } break;
          case 'release': audio.release(pan); if (!run.learned.release && run.learned.pin && run.E.id <= 2) { run.learned.release = true; showHint('released', 'Look away and it moves again.', 2.6); } break;
          case 'target': if (e && e.state === ST.ACTIVE && e.pinnable) audio.acquire(pan); break;
          case 'feign': audio.feign(pan); break;
          case 'lunge': audio.lunge(pan); break;
          case 'immune': audio.immune(pan); break;
          case 'reveal': audio.reveal(pan); run.reveals++; break;
          case 'wake': audio.wake(pan); break;
          case 'turn': if (e) audio.turnEye(pan); break;
          case 'ripple': { const c = S.eyes[ev.conductor]; audio.ripple(c ? panOf(S.eyePos(c, _pp)) : 0); break; }
          case 'choirBreak': audio.choirBreak(0); haptic('medium'); break;
          case 'knot': audio.knot(0); haptic('medium'); break;
          case 'unravel': audio.unravel(0); break;
          case 'chain': audio.chain(ev.n); haptic('success'); if (ev.n === 2) run.chains++; run.bestChain = Math.max(run.bestChain, ev.n); break;
          case 'absorb': audio.absorb(pan); break;
          case 'jam': audio.jam(); haptic('light'); break;
          case 'fixate': audio.fixate(pan); break;
          case 'crownBreak': audio.crownBreak(pan); haptic('heavy'); break;
          case 'unseal': audio.unseal(); break;
          case 'cross': audio.cross(); if (hint.key === 'door') clearHint('door'); run.learned.cross = true; break;
          case 'bump': audio.bump(); break;
          case 'strike': audio.bump(); audio.lunge(pan); haptic('heavy'); run.strikes = (run.strikes || 0) + 1; if (!run.learned.strike) { run.learned.strike = true; showHint('strike', 'Struck. One more touch and it has you.', 3.2); } break;
          case 'close': audio.close(); break;
          case 'eyeCross': audio.wake(pan); break;
          case 'pressure': audio.wake(0); haptic('light'); break;
        }
      }
    }
    // contextual teaching, one line at a time, gone once shown understood
    function hints() {
      if (run.kind !== 'campaign') return;
      const id = run.E.id;
      if (hint.key && mt > hint.until) clearHint();
      if (hint.key) return;
      if (id === 1 && !run.learned.pin && S.eyes[0].state !== ST.DORMANT) showHint('look', usedTouch ? 'Tap the eye to watch it.' : 'Point at the eye to watch it.');
      else if (id <= 2 && run.learned.pin && !run.learned.cross) { const nd = S.nearestDoor(S.P.k, S.playerTheta(), true); if (nd && nd.arc < 2.2) showHint('door', usedTouch ? 'At the opening, push up to go deeper.' : 'At the opening, press W to go deeper.'); }
      else if (id === 4 && !run.learned.turn) showHint('turn', usedTouch ? 'Drag the lower-right bar to turn the rings.' : 'Q and E turn the rings.');
      else if (id === 4 && run.learned.turn && !run.learned.holdturn && S.P.k >= 1) { run.learned.holdturn = true; showHint('holdturn', 'A watched eye stays put while its ring turns.', 5); }
    }
    function capture() {
      mode = 'captured'; mt = 0;
      run.captures++; run.encCaptures++;
      audio.capture(); haptic('heavy');
      const e = S.over.eye >= 0 ? S.eyes[S.over.eye] : null;
      const sp = e ? V.toScreen(...S.eyePos(e)) : V.toScreen(...S.playerPos());
      V.ink(0, sp[0], sp[1]);
      run.capturedBy = e ? (e.type === 'liar' && e.state === ST.FEIGN ? 'liarFeign' : e.type) : 'watcher';
      clearHint();
    }
    function showCaptureCard() {
      mode = 'capcard'; mt = 0;
      const c = CAUGHT[run.capturedBy] || CAUGHT.watcher;
      H.capH.textContent = c[0]; H.capSub.textContent = c[1];
      H.again.textContent = run.kind === 'endless' ? 'SEE THE RESULTS' : 'TRY AGAIN';
      H.capEnd.hidden = run.kind === 'endless';
      H.showOnly(H.cap); setPlayHud(false);
    }
    function clearEncounter() {
      // score: arriving, quickly, cleverly and unseen
      const E = run.E, st = S.stats;
      const time = run.encT;
      const parts = { base: 400 + (run.kind === 'endless' ? run.depth * 40 : E.id * 25), time: Math.max(0, Math.round(((E.par || 60) - time) * 8)), chains: st.chains * 150 + Math.max(0, st.bestChain - 1) * 60, unseen: run.encCaptures === 0 ? 250 : 0 };
      const gained = parts.base + parts.time + parts.chains + parts.unseen;
      run.score += gained; run.cleared++;
      run.log.push({ id: E.id, name: E.name, time, gained, captures: run.encCaptures, chains: st.chains });
      run.encCaptures = 0;
      run.walkSigned += st.walkSigned; run.habit = { dir: run.walkSigned >= 0 ? 1 : -1 };
      if (S.rec.length > 60) run.recordings.push(S.rec.slice(0, 1500));
      if (run.kind === 'campaign') { save.deepest = Math.max(save.deepest, E.id); persist(); }
      try { ctx.platform.milestone('spiral', { id: E.id, name: E.name, score: Math.floor(run.score) }); } catch (e) { }
      updateScore();
      audio.descend(); haptic('success');
      clearHint();
      if (run.kind === 'campaign' && E.id === 20) return startEnding();
      mode = 'descend'; mt = 0;
    }
    function afterDescend() {
      if (run.kind === 'endless') { run.depth++; startEncounter(makeEndless(run.depth, run), false); }
      else startEncounter(encounterById(run.E.id + 1), true);
      V.zoom = 0.3; V.applyCamera(); mode = mode === 'card' ? 'card' : mode; emerge = 0.8;
    }
    let emerge = 0;
    function endRun(reason) {
      if (!run) return;
      const completed = reason === 'complete';
      if (completed) { run.score += 3000 + (run.captures === 0 ? 1500 : 0); save.completed = true; }
      const final = Math.floor(run.score);
      let best = false;
      if (run.kind === 'endless') { best = final > save.bestEndless; save.bestEndless = Math.max(save.bestEndless, final); }
      else if (run.full) { best = final > save.best; save.best = Math.max(save.best, final); }
      persist();
      try { (completed ? ctx.platform.complete : ctx.platform.fail)({ score: final, reached: run.E ? run.E.id : 0, captures: run.captures, mode: run.kind }); } catch (e) { }
      if (scoreTrack && (run.kind === 'endless' || run.full)) { try { scoreTrack.set(final); scoreTrack.submit(run.kind === 'endless' ? 'endless' : 'score', { label: final + ' pts' }).catch(() => { }); } catch (e) { } }
      mode = 'results'; mt = 0;
      const mins = Math.floor(run.time / 60), secs = Math.floor(run.time % 60);
      H.resH.textContent = completed ? 'You reached the centre' : run.kind === 'endless' ? `Lost at depth ${run.depth}` : 'The spiral kept you';
      H.resSub.innerHTML = (best ? '<span class="wb-new">New best.</span> ' : '') + (completed ? (run.captures === 0 ? 'Never caught.' : 'It let you go.') : run.kind === 'endless' ? 'It learned faster than you.' : `Encounter ${run.E.id}: ${run.E.name}.`) + (!run.full && run.kind === 'campaign' ? ' Continued runs are not ranked.' : '');
      H.resStats.innerHTML = `<div><b>${final.toLocaleString()}</b>Score</div><div><b>${mins}:${String(secs).padStart(2, '0')}</b>Time</div><div><b>${run.cleared}</b>${run.kind === 'endless' ? 'Spirals' : 'Encounters'}</div>`;
      const rows = [['Caught', run.captures], ['Chain reactions', run.chains], ['Longest chain', run.bestChain ? run.bestChain + ' eyes' : '—'], ['Eyes held', run.pins]];
      H.resList.innerHTML = rows.map(r => `<div class="wb-li"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
      H.resEndless.disabled = !save.completed; H.resEndless.style.opacity = save.completed ? '' : '0.35';
      H.showOnly(H.res); setPlayHud(false);
    }

    // ---------- the ending ----------
    let ending = null;
    const END_LINES = ['It was never looking at you.', 'It was waiting to be looked at.', 'Someone new has come in from the edge.', 'Watch them.'];
    function startEnding() {
      mode = 'ending'; mt = 0;
      setPlayHud(false); H.skip.style.display = ''; H.skip.style.bottom = ((area().bottom || 0) + 16) + 'px';
      // the traveller is gone; in their place on the outer ring an eye opens, and a newcomer walks in
      const E = { id: 21, n: 4, rotation: true, seed: 2121, doors: [[-90], [150], [-30], [90]], barriers: [[], [], [], []], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', name: 'you', k: 0, a: -60, beh: 'still', wake: 3.2, wakeNear: 0 }] };
      def = E; S = createSim(E); S.forcedRot = 0.04;
      V.setFollow(false);
      V.build(S, def); V.dread = 1; V.fade = 1; V.ink(0);
      layout(ctx.width, ctx.height, area());
      ending = { line: -1 };
      audio.ending();
      V.zoom = 0.55; V.applyCamera();
    }
    function tickEnding(dt) {
      // the newcomer walks in along the outer groove; the new eye watches them
      if (mt > 2.5) S.P.a = wrap(-90 * DEG - (mt - 2.5) * 0.08);
      S.step({ gaze: null });
      const you = S.eye('you'); if (you.state !== ST.DORMANT) { you.look = S.playerPos(); }
      V.zoom = damp(V.zoom, mt < 3 ? 0.55 : 1.15, 0.35, dt); V.applyCamera();
      const li = Math.floor((mt - 3.5) / 3.2);
      if (li !== ending.line && li >= 0 && li < END_LINES.length) { ending.line = li; H.end.textContent = END_LINES[li]; H.end.style.opacity = 1; ctx.timeout(() => { if (mode === 'ending') H.end.style.opacity = 0; }, 2400); }
      if (mt > 3.5 + END_LINES.length * 3.2 + 1) finishEnding();
    }
    function finishEnding() { H.skip.style.display = 'none'; H.end.style.opacity = 0; V.zoom = 1; V.applyCamera(); endRun('complete'); }

    // ---------- main loop ----------
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      wall += dt; mt += dt;
      if (mode === 'play') {
        if (run && run.kind === 'endless') { if (!run.next || run.next.depth !== run.depth + 1) prepareNextEndless(run); else if (!run.next.prep.done) run.next.prep.step(3); }
        acc += dt; let n = 0;
        while (acc >= DT && n < 5 && mode === 'play') { step(); acc -= DT; n++; }
        if (n === 5) acc = 0;
        if (emerge > 0) { emerge = Math.max(0, emerge - dt); V.zoom = lerp(1, 0.3, smooth(emerge / 0.8)); V.applyCamera(); }
      } else acc = 0;
      if (mode === 'title' && S) { S.step({}); for (const e of S.eyes) if (pointerWorld) e.look = pointerWorld.slice(); }
      if (mode === 'card' && mt > 2.6) enterPlay();
      if (mode === 'captured') {
        V.ink(clamp((mt - 0.25) / 0.9, 0, 1) * 0.2);
        if (mt > 1.35) { if (run.kind === 'endless') { V.ink(0); endRun('captured'); } else showCaptureCard(); }
      }
      if (mode === 'descend') {
        const k = clamp(mt / 1.5, 0, 1);
        V.zoom = 1 + smooth(k) * 3.6; V.applyCamera();
        V.ink(clamp((k - 0.55) / 0.45, 0, 1), V.cx, V.cy);
        if (k >= 1) { V.ink(0); afterDescend(); }
      }
      if (mode === 'ending') tickEnding(dt);
      // HUD and atmosphere
      if (S) {
        const threat = mode === 'play' ? threatLevel() : 0;
        H.vig.style.opacity = mode === 'play' ? clamp(S.P.exposure * 1.1 + threat * 0.25, 0, 1).toFixed(2) : 0;
        let unb = 0; for (const e of S.eyes) if (e.type === 'unblinking' && e.state === ST.ACTIVE) { const d = Math.hypot(...S.eyePos(e).map((v, i) => v - S.playerPos()[i])); unb = Math.max(unb, clamp(1 - d / 10, 0.15, 1)); }
        audio.ambient({ quiet: def && def.quiet, dread: V.dread, rot: mode === 'play' ? S.rotDone : 0, exposure: mode === 'play' ? S.P.exposure : 0, unblinking: mode === 'play' ? unb : 0 }, dt);
        if (V.follow) V.updateRig(S, dt);
        V.update(S, dt, { beacon: mode === 'play' || mode === 'card', threat, capture: mode === 'captured' ? clamp(mt / 1.1, 0, 1) : mode === 'capcard' ? 1 : 0, hidePlayer: mode === 'title' || mode === 'ending' && false, hideThread: mode !== 'play', calm: save.settings.calm });
        if (mode === 'ending' || mode === 'title') V.update.hide = true;
        updateDial(dt);
        H.mark.style.opacity = mode === 'play' && S.P.marked > 0 ? (0.55 + 0.45 * Math.min(1, S.P.marked / 2)).toFixed(2) : 0;
        updateEdge();
      }
      V.render();
    }
    function updateDial() {
      if (H.dial.style.display === 'none' || !S) return;
      // the ticks show the ring just inside you turning
      const k = Math.min(S.N, S.P.k + 1);
      const sp = 14, span = H.ticks.length * sp;
      const off = (S.phi[k] * S.gear(k)) * 60;
      for (let i = 0; i < H.ticks.length; i++) { const x = (((i * sp + off) % span) + span) % span - sp; H.ticks[i].style.transform = `translateX(${x}px)`; H.ticks[i].style.left = '0'; }
      const kx = input.dial ? clamp(input.dial.x - input.dial.ox, -60, 60) : 0;
      H.dialKnob.style.transform = `translateX(${kx}px)`;
      H.dialKnob.style.opacity = input.dial ? 1 : 0.5;
    }

    // ---------- input ----------
    const area = () => ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
    const bandPx = () => Math.max(132, ctx.height * layoutBand);
    const bandBottom = () => ctx.height - (area().bottom || 0);   // the control band sits just above this line
    const rect = () => canvas.getBoundingClientRect();
    const roles = new Map();
    function gazeAt(sx, sy) {
      const w = V.toWorld(sx, sy);
      // a touch near an eye means that eye: snap to the nearest within reach
      let best = null, bd = 1e9;
      for (const e of S.eyes) {
        if (e.state === ST.DEAD || e.state === ST.REVEALED) continue;
        const p = S.eyePos(e), d = Math.hypot(p[0] - w[0], p[1] - w[1]);
        if (d < e.rad + 0.75 && d < bd) { bd = d; best = p; }
      }
      input.gazeSet = best || w;
    }
    function onDown(e) {
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      audio.unlock();
      if (mode === 'title') { pointerWorld = V.toWorld(x, y); return; }
      if (mode === 'card') { enterPlay(); return; }
      if (mode === 'ending' && mt > 1.5) { return; }
      if (mode !== 'play') return;
      if (e.cancelable) e.preventDefault();
      if (e.pointerType === 'touch') usedTouch = true;
      const inBand = y > bandBottom() - bandPx();
      const leftSide = save.settings.swap ? x > ctx.width / 2 : x < ctx.width / 2;
      if (inBand && (leftSide || S.rotLocked)) {
        roles.set(e.pointerId, 'stick');
        input.stick = { ox: x, oy: y, x, y };
        H.stick.classList.remove('teach'); H.stick.classList.add('live'); H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = '';
      } else if (inBand) {
        roles.set(e.pointerId, 'dial');
        input.dial = { ox: x, x };
      } else {
        roles.set(e.pointerId, 'gaze');
        gazeAt(x, y);
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    }
    function onMove(e) {
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (mode === 'title') { pointerWorld = V.toWorld(x, y); return; }
      if (mode !== 'play') return;
      const role = roles.get(e.pointerId);
      if (role === 'stick' && input.stick) { input.stick.x = x; input.stick.y = y; const dx = clamp(x - input.stick.ox, -46, 46), dy = clamp(y - input.stick.oy, -46, 46); H.knob.style.transform = `translate(${dx}px,${dy}px)`; }
      else if (role === 'dial' && input.dial) input.dial.x = x;
      else if (role === 'gaze') gazeAt(x, y);
      else if (!role && e.pointerType === 'mouse') {
        // with a mouse, the gaze follows the pointer over the spiral
        if (y < bandBottom() - bandPx()) gazeAt(x, y);
      }
    }
    function onUp(e) {
      const role = roles.get(e.pointerId); roles.delete(e.pointerId);
      if (role === 'stick') { input.stick = null; homeStick(); }
      if (role === 'dial') input.dial = null;
      // the gaze stays where it was left
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'lostpointercapture', onUp);
    ctx.listen(canvas, 'wheel', e => { e.preventDefault(); }, { passive: false });
    const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyP', 'KeyR', 'Escape', 'Space', 'Enter']);
    ctx.listen(window, 'keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      audio.unlock();
      if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) { usedTouch = false; begin('campaign', 1); return; }
      if (mode === 'card' && (e.code === 'Enter' || e.code === 'Space')) { enterPlay(); return; }
      if (mode === 'capcard' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR')) { H.again.click(); return; }
      if (mode === 'results' && (e.code === 'Enter' || e.code === 'Space')) { begin(run ? run.kind : 'campaign', 1); return; }
      if (mode === 'ending' && e.code === 'Escape') { finishEnding(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); return; }
      if (mode === 'play' && e.code === 'KeyR' && !e.repeat) { restartEncounter(); return; }
      if (e.repeat) return;
      input.keys.add(e.code);
      if (/^(Key[WASD]|Arrow)/.test(e.code)) usedTouch = false;
    });
    ctx.listen(window, 'keyup', e => input.keys.delete(e.code));
    const dropInputs = () => { input.keys.clear(); input.stick = null; input.dial = null; roles.clear(); homeStick(); };
    ctx.listen(window, 'blur', () => { dropInputs(); if (mode === 'play') pauseGame(); });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) { dropInputs(); if (mode === 'play') pauseGame(); audio.suspend(); } else audio.resume(); });

    // ---------- panels ----------
    function pauseGame() { if (mode !== 'play') return; mode = 'paused'; dropInputs(); H.pauseSub.textContent = run.E ? (run.kind === 'endless' ? `Depth ${run.depth}` : `Encounter ${run.E.id} of 20: ${run.E.name}`) : ''; H.showOnly(H.pausePanel); }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; H.showOnly(null); }
    const click = (b, fn) => ctx.listen(b, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    click(H.begin, () => begin('campaign', 1));
    click(H.cont, () => begin('campaign', ENCOUNTERS.find(q => q.act === continueAct()).id));
    click(H.endless, () => { if (save.completed) begin('endless', 1); });
    click(H.toSet, () => { settingsFrom = 'title'; renderSettings(); H.showOnly(H.set); });
    click(H.resume, resumeGame);
    click(H.restart, () => { H.showOnly(null); restartEncounter(); });
    click(H.pSet, () => { settingsFrom = 'pause'; renderSettings(); H.showOnly(H.set); });
    click(H.quit, () => { mode = 'play'; endRun('quit'); });
    click(H.again, () => { if (run.kind === 'endless') endRun('captured'); else { V.ink(0); H.showOnly(null); restartEncounter(); } });
    click(H.capEnd, () => { V.ink(0); endRun('captured'); });
    click(H.resAgain, () => begin(run && run.kind === 'endless' ? 'endless' : 'campaign', 1));
    click(H.resEndless, () => { if (save.completed) begin('endless', 1); });
    click(H.resTitle, showTitle);
    click(H.skip, () => { if (mode === 'ending') finishEnding(); });
    ctx.listen(H.act, 'pointerdown', e => { e.stopPropagation(); audio.unlock(); if (mode === 'card' && mt > 0.4) enterPlay(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    let settingsFrom = 'title';
    function renderSettings() {
      const s = save.settings;
      const tog = (k, label) => `<div class="wb-set"><span>${label}</span><button class="wb-tog ${s[k] ? 'on' : ''}" data-t="${k}">${s[k] ? 'ON' : 'OFF'}</button></div>`;
      H.setList.innerHTML =
        `<div class="wb-set"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></div>` +
        `<div class="wb-set"><span>Dial sensitivity</span><input type="range" min="0.5" max="2" step="0.1" value="${s.dial}" data-k="dial"></div>` +
        tog('swap', 'Walk on the right, turn on the left') + tog('calm', 'Steadier linework') + tog('hints', 'Hints');
    }
    click(H.setBack, () => { if (settingsFrom === 'pause') H.showOnly(H.pausePanel); else showTitle(); });
    ctx.listen(H.setList, 'click', e => { const t = e.target; if (t.dataset && t.dataset.t) { save.settings[t.dataset.t] = !save.settings[t.dataset.t]; persist(); renderSettings(); } });
    ctx.listen(H.setList, 'input', e => { const t = e.target; if (t.dataset && t.dataset.k) { save.settings[t.dataset.k] = +t.value; if (t.dataset.k === 'volume') audio.setVolume(+t.value); persist(); } });

    // ---------- layout ----------
    function layout(w, h, safe) {
      const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
      layoutBand = clamp(150 / h, 0.17, 0.26);
      const band = bandPx();
      H.top.style.paddingTop = (16 + top) + 'px';
      H.top.style.left = (16 + ((safe && safe.left) || 0)) + 'px'; H.top.style.right = (16 + ((safe && safe.right) || 0)) + 'px';
      H.hint.style.bottom = (band + bot + 8) + 'px';
      const dw = Math.min(200, w * 0.42);
      Object.assign(H.dial.style, save.settings.swap ? { left: '16px', right: 'auto' } : { right: '16px', left: 'auto' });
      Object.assign(H.dial.style, { width: dw + 'px', bottom: (bot + band * 0.5 - 28) + 'px' });
      H.name.style.top = (16 + top + 52) + 'px';
      if (!input.stick) homeStick();
      H.titleText.style.top = (top + h * 0.06) + 'px';
      H.end.style.top = (top + h * 0.12) + 'px';
      for (const p of H.panels) p.style.paddingBottom = (bot + 16) + 'px';
      renderer.setSize(w, h, false);
      V.bandPx = band + bot;
      V.layout(w, h, safe, mode === 'title' ? 0.32 : layoutBand + bot / h, frameR());
    }
    ctx.onResize(({ width, height, contentSafeArea, safeArea }) => layout(width, height, contentSafeArea || ctx.contentSafeArea || ctx.safeArea || safeArea), { immediate: true });

    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));
    showTitle();
    try { V.update(S, 0.016, {}); V.render(); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__WTB_DEV) {
      window.botPolicy = botPolicy;
      window.__wtb = {
        begin, showTitle, startEncounter, restartEncounter, pauseGame, resumeGame, endRun,
        get S() { return S; }, get mode() { return mode; }, get run() { return run; }, save: () => save, V, input, H,
        goto(id) { if (!run) newRun('campaign', id); startEncounter(encounterById(id), false); },
        advance(sec, inp) { const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) { if (inp) { S.step(Object.assign({}, inp)); run.encT += DT; handleEvents(S.events); if (S.over) { capture(); break; } if (S.reached) { clearEncounter(); break; } } else step(); } V.update(S, DT, {}); V.render(); },
        frame(dt) { tick((dt || DT) * 1000); },
        screenOf(name) { const e = S.eye(name); return e ? V.toScreen(...S.eyePos(e)) : null; },
        playerScreen() { return V.toScreen(...S.playerPos()); },
        relayout: () => layout(ctx.width, ctx.height, area()),
        // one game step with a given input, through the full game path (events, scoring, transitions)
        glInfo: () => ({ textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, calls: renderer.info.render.calls }),
        stepGame(inp) { if (mode !== 'play') return false; input.override = inp; step(); input.override = null; return true; },
      };
    }
  }
};

})();
