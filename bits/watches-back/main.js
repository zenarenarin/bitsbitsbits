// THE THING THAT WATCHES BACK — a dimensional horror game for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// THE THING THAT WATCHES BACK — shared math.
// World axes: x = right, y = up, z = toward the camera (down the screen).
// "Forward" for a route is -z. Arc angles are atan2(z - cz, x - cx).
// Vectors in the simulation are plain [x, y, z] arrays.
// =====================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

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

const v3 = (x, y, z) => [x || 0, y || 0, z || 0];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vLen = a => Math.hypot(a[0], a[1], a[2]);
const vDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vNorm = a => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const vAddS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const vCopy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
const angleBetween = (a, b) => Math.acos(clamp(vDot(a, b) / ((vLen(a) * vLen(b)) || 1), -1, 1));
// Direction from yaw (around y) and pitch (positive = up). yaw 0 = +x, yaw PI/2 = +z.
const dirYP = (yaw, pitch) => [Math.cos(yaw) * Math.cos(pitch || 0), Math.sin(pitch || 0), Math.sin(yaw) * Math.cos(pitch || 0)];
const yawOf = d => Math.atan2(d[2], d[0]);
const pitchOf = d => Math.atan2(d[1], Math.hypot(d[0], d[2]));

// Rotate unit vector `a` toward unit vector `b` by at most `maxAng` radians (slerp-like).
function rotateToward(a, b, maxAng) {
  const ang = angleBetween(a, b);
  if (ang <= maxAng || ang < 1e-6) return vNorm(b);
  const t = maxAng / ang;
  // spherical interpolation
  const s = Math.sin(ang);
  const w0 = Math.sin((1 - t) * ang) / s, w1 = Math.sin(t * ang) / s;
  if (!isFinite(w0) || !isFinite(w1)) return vNorm(vLerp(a, b, t));
  return vNorm([a[0] * w0 + b[0] * w1, a[1] * w0 + b[1] * w1, a[2] * w0 + b[2] * w1]);
}
// Clamp unit direction `d` to within `maxDev` of `axis`.
function clampCone(d, axis, maxDev) {
  const ang = angleBetween(d, axis);
  if (ang <= maxDev) return d;
  return rotateToward(axis, d, maxDev);
}
// 2D helpers on xz
const rot2 = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, x * s + z * c]; };
const angIn = (a, a0, a1) => { // is angle a within arc a0..a1 (counter-clockwise from a0, in atan2 sense)
  if (a1 - a0 >= TAU - 1e-6) return true;
  const span = wrapPos(a1 - a0);
  return wrapPos(a - a0) <= span;
};
const wrapPos = a => { a = a % TAU; return a < 0 ? a + TAU : a; };

// Segment (2D) vs circle: returns list of t in [0,1] where |p(t)-c| = r
function segCircleT(ax, az, bx, bz, cx, cz, r, out) {
  const dx = bx - ax, dz = bz - az, fx = ax - cx, fz = az - cz;
  const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r;
  const D = B * B - 4 * A * C;
  if (A < 1e-12 || D < 0) return out;
  const sq = Math.sqrt(D);
  const t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
  if (t1 >= 0 && t1 <= 1) out.push(t1);
  if (t2 >= 0 && t2 <= 1) out.push(t2);
  return out;
}

// ---- 01_sim.js ----
// =====================================================================
// The simulation. Pure data and rules, no rendering. Deterministic at a
// fixed 60 Hz step. Views read it; nothing writes back except input.
//
// THE RULE OF THE NETWORK
//   Eyes watch things: other eyes, places, or you.
//   An eye that another eye is watching is HELD: it cannot notice you,
//   and drifters stop on their rails.
//   Your gaze PINS one eye: it freezes, and whatever it was watching is
//   no longer held. Look away and it RELEASES, then resumes.
//   A free eye that sees you ACQUIRES you. If it finishes, you are seen.
// =====================================================================

const SIM_HZ = 60;
const SIM_DT = 1 / SIM_HZ;

const ST = {
  ACTIVE: 'active', ALERT: 'alert', ACQUIRING: 'acquiring', SEARCHING: 'searching',
  PINNED: 'pinned', RELEASING: 'releasing', DISRUPTED: 'disrupted', DORMANT: 'dormant'
};

const PLAYER = { r: 0.3, h: 1.5, eye: 1.25, speed: 5.4, accel: 34, decel: 46, step: 0.75 };

// Eye archetypes: numbers a designer reaches for first. Encounters override.
const EYE_TYPES = {
  watcher: { size: 1.6, fov: 24 * DEG, periph: 1.7, range: 30, turn: 1.4, alertTurn: 0.9, acqTurn: 1.8, acquireTime: 2.2, searchTime: 1.6, maxDev: 75 * DEG, pinnable: true, notices: true },
  drifter: { size: 1.4, fov: 20 * DEG, periph: 1.0, range: 26, turn: 2.2, alertTurn: 0, acqTurn: 1.6, acquireTime: 1.6, searchTime: 1.0, maxDev: 80 * DEG, pinnable: true, notices: true },
  collector: { size: 1.7, fov: 10 * DEG, periph: 1.0, range: 34, turn: 0.75, alertTurn: 0, acqTurn: 1.2, acquireTime: 1.8, searchTime: 1.0, maxDev: 100 * DEG, pinnable: true, notices: true },
  sentinel: { size: 2.2, fov: 0, periph: 1, range: 60, turn: 0.8, alertTurn: 0, acqTurn: 1.2, acquireTime: 1.1, searchTime: 0.8, maxDev: 90 * DEG, pinnable: true, notices: false },
  choir: { size: 1.1, fov: 18 * DEG, periph: 1.0, range: 26, turn: 1.6, alertTurn: 0, acqTurn: 1.6, acquireTime: 1.9, searchTime: 1.2, maxDev: 100 * DEG, pinnable: true, notices: true },
  mimic: { size: 1.6, fov: 30 * DEG, periph: 1.0, range: 40, turn: 2.6, alertTurn: 0, acqTurn: 2.2, acquireTime: 2.0, searchTime: 0.5, maxDev: 120 * DEG, pinnable: true, notices: false },
  liar: { size: 1.5, fov: 30 * DEG, periph: 1.0, range: 28, turn: 1.4, alertTurn: 0, acqTurn: 1.6, acquireTime: 2.0, searchTime: 2.0, maxDev: 80 * DEG, pinnable: true, notices: true },
  falseeye: { size: 1.6, fov: 32 * DEG, periph: 1.3, range: 30, turn: 1.8, alertTurn: 1.2, acqTurn: 1.8, acquireTime: 2.0, searchTime: 1.0, maxDev: 80 * DEG, pinnable: false, notices: true },
  unblinking: { size: 2.5, fov: 40 * DEG, periph: 1.0, range: 50, turn: 1.0, alertTurn: 0, acqTurn: 1.0, acquireTime: 2.4, searchTime: 1.5, maxDev: 110 * DEG, pinnable: false, notices: true },
  crown: { size: 3.0, fov: 30 * DEG, periph: 1.0, range: 60, turn: 0.9, alertTurn: 0, acqTurn: 0.9, acquireTime: 2.6, searchTime: 1.2, maxDev: 110 * DEG, pinnable: true, notices: true },
  centre: { size: 6.5, fov: 70 * DEG, periph: 1.0, range: 90, turn: 0.6, alertTurn: 0, acqTurn: 0.6, acquireTime: 3.4, searchTime: 1.5, maxDev: 180 * DEG, pinnable: false, notices: true }
};

// ---------------------------------------------------------------------
// Shapes. Each may ride a mover (rotor). `l` holds the authored local
// values; world values are written by refreshShape each tick.
// ---------------------------------------------------------------------
function rectY(rg, x, z) {
  const dx = x - rg.wx, dz = z - rg.wz, c = rg.wc, s = rg.ws;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  if (u < -rg.hl || u > rg.hl || v < -rg.hw || v > rg.hw) return null;
  if (rg.y2 === undefined || rg.y2 === null) return rg.y;
  return lerp(rg.y, rg.y2, (u + rg.hl) / (2 * rg.hl));
}
function arcY(rg, x, z) {
  const dx = x - rg.wx, dz = z - rg.wz, d = Math.hypot(dx, dz);
  if (d < rg.r0 || d > rg.r1) return null;
  if (!angIn(Math.atan2(dz, dx), rg.wa0, rg.wa1)) return null;
  return rg.y;
}
function regionY(rg, x, z) {
  if (!rg.on) return null;
  return rg.kind === 'arc' ? arcY(rg, x, z) : rectY(rg, x, z);
}

function inBlocker(b, x, z, y, pad) {
  if (!b.on) return false;
  if (y + PLAYER.h < b.y0 || y > b.y1) return false;
  if (b.kind === 'circle') { const dx = x - b.wx, dz = z - b.wz; return dx * dx + dz * dz < (b.r + pad) * (b.r + pad); }
  if (b.kind === 'box') {
    const dx = x - b.wx, dz = z - b.wz, u = dx * b.wc + dz * b.ws, v = -dx * b.ws + dz * b.wc;
    return Math.abs(u) < b.hl + pad && Math.abs(v) < b.hw + pad;
  }
  if (b.kind === 'arc') {
    const dx = x - b.wx, dz = z - b.wz, d = Math.hypot(dx, dz);
    if (d < b.r0 - pad || d > b.r1 + pad) return false;
    const padA = pad / Math.max(1, d);
    return angIn(Math.atan2(dz, dx), b.wa0 - padA, b.wa1 + padA);
  }
  return false;
}

// Line of sight: does the segment a->b pass through occluder o?
const _ts = [];
function occBlocks(o, a, b) {
  if (!o.on) return false;
  const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
  if (o.kind === 'cyl') {
    // interval of t where the 2D segment is inside the circle
    const dx = bx - ax, dz = bz - az, fx = ax - o.wx, fz = az - o.wz;
    const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
    let t0, t1;
    if (A < 1e-9) { if (C > 0) return false; t0 = 0; t1 = 1; }
    else {
      const D = B * B - 4 * A * C; if (D <= 0) return false;
      const sq = Math.sqrt(D); t0 = (-B - sq) / (2 * A); t1 = (-B + sq) / (2 * A);
    }
    t0 = Math.max(0, t0); t1 = Math.min(1, t1); if (t0 >= t1) return false;
    const ya = lerp(ay, by, t0), yb = lerp(ay, by, t1);
    return Math.max(ya, yb) >= o.y0 && Math.min(ya, yb) <= o.y1;
  }
  if (o.kind === 'box') {
    // local frame: u along yaw (half hl), v perpendicular (half hw), y (half hh around cy)
    const c = o.wc, s = o.ws;
    const pax = ax - o.wx, paz = az - o.wz, pbx = bx - o.wx, pbz = bz - o.wz;
    const ua = pax * c + paz * s, va = -pax * s + paz * c, ub = pbx * c + pbz * s, vb = -pbx * s + pbz * c;
    const ya = ay - o.cy, yb = by - o.cy;
    let tmin = 0, tmax = 1;
    const slab = (p0, p1, h) => {
      const d = p1 - p0;
      if (Math.abs(d) < 1e-9) return p0 >= -h && p0 <= h;
      let e0 = (-h - p0) / d, e1 = (h - p0) / d; if (e0 > e1) { const t = e0; e0 = e1; e1 = t; }
      if (e0 > tmin) tmin = e0; if (e1 < tmax) tmax = e1; return tmin <= tmax;
    };
    return slab(ua, ub, o.hl) && slab(va, vb, o.hw) && slab(ya, yb, o.hh);
  }
  if (o.kind === 'arc') {
    _ts.length = 0;
    _ts.push(0, 1);
    segCircleT(ax, az, bx, bz, o.wx, o.wz, o.r0, _ts);
    segCircleT(ax, az, bx, bz, o.wx, o.wz, o.r1, _ts);
    _ts.sort((p, q) => p - q);
    for (let i = 0; i < _ts.length - 1; i++) {
      const ta = _ts[i], tb = _ts[i + 1]; if (tb - ta < 1e-6) continue;
      // test several samples inside this sub-interval (radius is monotone-ish within it)
      const n = 5;
      for (let k = 0; k < n; k++) {
        const t = ta + (tb - ta) * (k + 0.5) / n;
        const x = lerp(ax, bx, t) - o.wx, z = lerp(az, bz, t) - o.wz, y = lerp(ay, by, t);
        if (y < o.y0 || y > o.y1) continue;
        const d = Math.hypot(x, z); if (d < o.r0 || d > o.r1) continue;
        if (angIn(Math.atan2(z, x), o.wa0, o.wa1)) return true;
      }
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------
function createWorld(def, opts) {
  opts = opts || {};
  const W = {
    def, t: 0, tick: 0,
    regions: [], blockers: [], occluders: [], movers: [], moverById: {},
    eyes: [], eyeById: {}, zones: {}, zoneList: [],
    links: [], observedBy: {}, prevLinks: new Set(),
    events: [], status: 'play', statusT: 0, catcher: null,
    flags: {}, hints: [],
    gazeHist: [], gazeHistLen: 1,
    player: null, gaze: { target: null, focus: 0, lostT: 0, refused: false },
    input: { mx: 0, mz: 0 },
    mods: Object.assign({ acquire: 1, speed: 1, mech: 1 }, opts.mods || {}),
    rng: makeRng(def.seed || 7),
    checkpoint: opts.checkpoint || 0,
    script: null
  };
  W.emit = (type, o) => { const e = o || {}; e.type = type; e.t = W.t; W.events.push(e); return e; };
  const B = makeBuilder(W);
  def.build(makeKit(B, W), W.checkpoint);
  // spawn
  const sp = B._spawn || [0, 0, 0, -Math.PI / 2];
  W.player = { pos: [sp[0], sp[1], sp[2]], vel: [0, 0], yaw: sp[3] === undefined ? -Math.PI / 2 : sp[3], region: null, falling: false, fallV: 0, moving: 0, speedNow: 0 };
  // mimic delay buffer
  let maxDelay = 0; for (const e of W.eyes) if (e.mimic) maxDelay = Math.max(maxDelay, e.mimic.delay);
  W.gazeHistLen = Math.max(1, Math.ceil(maxDelay * SIM_HZ) + 2);
  W.gazeHist = new Array(W.gazeHistLen).fill(null);
  refreshAll(W);
  const sup = supportAt(W, W.player.pos[0], W.player.pos[2], W.player.pos[1]);
  if (sup) { W.player.pos[1] = sup.y; W.player.region = sup.rg; }
  // initial looks: point eyes at their home so the world starts composed
  for (const e of W.eyes) { const d = desiredDir(W, e, true); if (d) e.look = clampCone(d, e.facing, e.maxDev); }
  computeLinks(W, true);
  if (def.init) def.init(W);
  return W;
}

function makeBuilder(W) {
  const B = {};
  const reg = (arr, o) => { o.on = o.on === undefined ? true : o.on; arr.push(o); return o; };
  B.spawn = (x, z, yaw, y) => { B._spawn = [x, y || 0, z, yaw === undefined ? -Math.PI / 2 : yaw]; };
  // walkable
  B.rect = o => reg(W.regions, Object.assign({ kind: 'rect', yaw: -Math.PI / 2, y: 0 }, o, { l: Object.assign({}, o) }));
  B.arc = o => reg(W.regions, Object.assign({ kind: 'arc', a0: 0, a1: TAU, r0: 0, y: 0 }, o, { l: Object.assign({}, o) }));
  // movement blockers
  B.blockCircle = o => reg(W.blockers, Object.assign({ kind: 'circle', y0: -1e9, y1: 1e9 }, o, { l: Object.assign({}, o) }));
  B.blockBox = o => reg(W.blockers, Object.assign({ kind: 'box', yaw: -Math.PI / 2, y0: -1e9, y1: 1e9 }, o, { l: Object.assign({}, o) }));
  B.blockArc = o => reg(W.blockers, Object.assign({ kind: 'arc', y0: -1e9, y1: 1e9 }, o, { l: Object.assign({}, o) }));
  // sight occluders
  B.occCyl = o => reg(W.occluders, Object.assign({ kind: 'cyl' }, o, { l: Object.assign({}, o) }));
  B.occBox = o => reg(W.occluders, Object.assign({ kind: 'box', yaw: -Math.PI / 2 }, o, { l: Object.assign({}, o) }));
  B.occArc = o => reg(W.occluders, Object.assign({ kind: 'arc' }, o, { l: Object.assign({}, o) }));
  // zones: circle {x,z,r} or rect {x,z,hw,hl,yaw}
  B.zone = (id, o) => { const z = Object.assign({ id }, o); W.zones[id] = z; W.zoneList.push(z); return z; };
  // movers
  B.mover = o => {
    const m = Object.assign({ e: 0, speed: 0.5, prime: 0.45, primeT: 0, dir: 0, signal: null, lastSig: null }, o);
    if (m.kind === 'rotor') { m.angle = m.angle || 0; m.angVel = 0; m.dAngle = 0; m.pivot = m.pivot || [0, 0]; }
    if (m.kind === 'bridge') {
      m.region = B.rect({ cx: m.ax, cz: m.az, hw: m.w / 2, hl: 0.01, yaw: m.yaw, y: m.y || 0, bridge: m.id, on: false });
    }
    if (m.kind === 'gate') {
      m.blocker = B.blockBox({ cx: m.x, cz: m.z, hw: m.thick / 2, hl: m.w / 2, yaw: m.yaw, gate: m.id });
      m.occ = m.sight === false ? null : B.occBox({ cx: m.x, cz: m.z, cy: (m.y || 0) + m.h / 2, hw: m.thick / 2, hl: m.w / 2, hh: m.h / 2, yaw: m.yaw, gate: m.id });
    }
    W.movers.push(m); W.moverById[m.id] = m; return m;
  };
  B.eye = o => {
    const T = EYE_TYPES[o.type] || EYE_TYPES.watcher;
    const e = Object.assign({}, T, o);
    e.basePos = o.pos.slice(); e.baseFacing = vNorm(o.facing || [0, 0, 1]);
    e.pos = e.basePos.slice(); e.facing = e.baseFacing.slice(); e.look = e.facing.slice();
    e.state = o.dormant ? ST.DORMANT : ST.ACTIVE; e.st = 0; e.acq = 0;
    e.home = o.home || null; e.ignore = new Set(o.ignore || []);
    e.lastSeen = null; e.alert = null; e.seesPlayer = false; e.linkTo = null; e.target = null;
    e.skipT = 0; e.orphanT = 0; e.feltHeld = false; e.wasHeld = false;
    e.isFalse = o.type === 'falseeye'; e.unblink = o.type === 'unblinking' || o.type === 'centre';
    if (o.type === 'liar') e.liarOpen = !!o.open;
    if (o.type === 'mimic') e.mimic = Object.assign({ delay: 3 }, o.mimic || {});
    if (o.type === 'sentinel') { e.sentinel = Object.assign({ zones: [], period: 4, idx: 0, t: 0, alarm: 16 }, o.sentinel || {}); }
    if (o.rail) { e.rail = Object.assign({ loop: false, speed: 2, u: 0, dir: 1, pause: 0.8, pauseT: 0 }, o.rail); railPrepare(e.rail); }
    if (o.type === 'collector') e.collect = Object.assign({ group: o.group, notice: 0.6 }, o.collect || {});
    if (o.type === 'choir') e.heal = o.heal === undefined ? 2.2 : o.heal;
    W.eyes.push(e); W.eyeById[e.id] = e; W.observedBy[e.id] = [];
    return e;
  };
  B.flag = (k, v) => { W.flags[k] = v; };
  B.script = s => { W.script = s; };
  B.hint = h => { W.hints.push(h); };
  return B;
}

function railPrepare(r) {
  r.len = [0];
  for (let i = 1; i < r.pts.length; i++) r.len.push(r.len[i - 1] + vDist(r.pts[i], r.pts[i - 1]));
  if (r.loop) r.total = r.len[r.len.length - 1] + vDist(r.pts[r.pts.length - 1], r.pts[0]);
  else r.total = r.len[r.len.length - 1];
}
function railPoint(r, u) {
  const pts = r.pts, n = pts.length;
  if (r.loop) u = ((u % r.total) + r.total) % r.total; else u = clamp(u, 0, r.total);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l0 = r.len[i] !== undefined ? r.len[i] : r.total, l1 = i + 1 < n ? r.len[i + 1] : r.total;
    if (u <= l1 || i === n - 1) {
      const t = l1 > l0 ? (u - l0) / (l1 - l0) : 0;
      return { p: vLerp(a, b, clamp01(t)), tan: vNorm(vSub(b, a)) };
    }
  }
  return { p: pts[0].slice(), tan: [1, 0, 0] };
}

// ---------------------------------------------------------------------
// Transform refresh
// ---------------------------------------------------------------------
function moverXf(W, id) { const m = id ? W.moverById[id] : null; return m && m.kind === 'rotor' ? m : null; }
function xfPoint(m, x, z) { if (!m) return [x, z]; const r = rot2(x - m.pivot[0], z - m.pivot[1], m.angle); return [m.pivot[0] + r[0], m.pivot[1] + r[1]]; }
function refreshShape(W, s) {
  const m = moverXf(W, s.mover), l = s.l;
  if (s.kind === 'rect' || s.kind === 'box') {
    const p = xfPoint(m, l.cx, l.cz); s.wx = p[0]; s.wz = p[1];
    const yaw = (s.yaw !== undefined ? s.yaw : l.yaw) + (m ? m.angle : 0);
    s.wyaw = yaw; s.wc = Math.cos(yaw); s.ws = Math.sin(yaw);
  } else if (s.kind === 'arc') {
    const p = xfPoint(m, l.cx, l.cz); s.wx = p[0]; s.wz = p[1];
    s.wa0 = (s.a0 !== undefined ? s.a0 : l.a0) + (m ? m.angle : 0); s.wa1 = (s.a1 !== undefined ? s.a1 : l.a1) + (m ? m.angle : 0);
  } else { // circle / cyl
    const p = xfPoint(m, l.x, l.z); s.wx = p[0]; s.wz = p[1];
  }
}
function refreshAll(W) {
  for (const m of W.movers) applyMover(W, m);
  for (const s of W.regions) refreshShape(W, s);
  for (const s of W.blockers) refreshShape(W, s);
  for (const s of W.occluders) refreshShape(W, s);
  for (const e of W.eyes) {
    const m = moverXf(W, e.mover);
    if (e.rail) {
      const rp = railPoint(e.rail, e.rail.u); e.pos = rp.p; e.railTan = rp.tan;
      if (e.rail.center) { const c = e.rail.center; e.facing = vNorm([c[0] - e.pos[0], (e.rail.faceY || -0.6), c[2] - e.pos[2]]); }
    } else if (m) {
      const p = xfPoint(m, e.basePos[0], e.basePos[2]); e.pos = [p[0], e.basePos[1], p[1]];
      const f = rot2(e.baseFacing[0], e.baseFacing[2], m.angle); e.facing = [f[0], e.baseFacing[1], f[1]];
    }
  }
}
function applyMover(W, m) {
  if (m.kind === 'bridge') {
    const L = m.len * easeInOut(m.e), rg = m.region;
    rg.on = L > 0.3; rg.hl = Math.max(0.01, L / 2);
    rg.cx = m.ax + Math.cos(m.yaw) * L / 2; rg.cz = m.az + Math.sin(m.yaw) * L / 2;
    rg.l.cx = rg.cx; rg.l.cz = rg.cz; rg.extent = L;
  } else if (m.kind === 'gate') {
    m.blocker.on = m.e < 0.75;
    if (m.occ) m.occ.on = m.e < 0.6;
  }
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------
function supportAt(W, x, z, yRef) {
  let best = null, bd = 1e9;
  for (const rg of W.regions) {
    const y = regionY(rg, x, z); if (y === null) continue;
    const d = Math.abs(y - yRef);
    if (d <= PLAYER.step && d < bd) { bd = d; best = { y, rg }; }
  }
  return best;
}
function lowestBelow(W, x, z, yRef) {
  let best = null;
  for (const rg of W.regions) { const y = regionY(rg, x, z); if (y === null || y > yRef - PLAYER.step) continue; if (!best || y > best.y) best = { y, rg }; }
  return best;
}
const _off = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
function validPos(W, x, z, y) {
  const c = supportAt(W, x, z, y); if (!c) return null;
  const r = PLAYER.r;
  for (const o of _off) if (!supportAt(W, x + o[0] * r, z + o[1] * r, c.y)) return null;
  for (const b of W.blockers) if (inBlocker(b, x, z, c.y, r)) return null;
  return c;
}
function los(W, a, b, ignore) {
  for (const o of W.occluders) {
    if (!o.on) continue;
    if (ignore && o.tag && ignore.has(o.tag)) continue;
    if (occBlocks(o, a, b)) return false;
  }
  return true;
}
function playerHead(W) { const p = W.player.pos; return [p[0], p[1] + PLAYER.eye, p[2]]; }
function playerChest(W) { const p = W.player.pos; return [p[0], p[1] + 0.8, p[2]]; }
function eyeFront(e, dist) { return vAddS(e.pos, e.look, dist === undefined ? e.size * 0.9 : dist); }
function inZone(z, x, zz) {
  if (!z) return false;
  if (z.r !== undefined) { const dx = x - z.x, dz = zz - z.z; return dx * dx + dz * dz <= z.r * z.r; }
  const yaw = z.yaw === undefined ? -Math.PI / 2 : z.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = x - z.x, dz = zz - z.z, u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.abs(u) <= z.hl && Math.abs(v) <= z.hw;
}
// Can eye `a` see eye `b` (centre to centre, ignoring their own hosts)?
function eyeLos(W, a, b) {
  const p0 = vAddS(a.pos, vNorm(vSub(b.pos, a.pos)), a.size * 1.05);
  const p1 = vAddS(b.pos, vNorm(vSub(a.pos, b.pos)), b.size * 1.05);
  return los(W, p0, p1, unionIgnore(a, b));
}
const _ign = new Set();
function unionIgnore(a, b) { _ign.clear(); for (const k of a.ignore) _ign.add(k); if (b) for (const k of b.ignore) _ign.add(k); return _ign; }

// Signal helpers handed to authored signal functions.
function signalApi(W) {
  if (W._S) return W._S;
  const S = {
    get t() { return W.t; },
    observed: id => (W.observedBy[id] || []).length > 0,
    observedBy: (id, by) => (W.observedBy[id] || []).indexOf(by) >= 0,
    link: (a, b) => (W.observedBy[b] || []).indexOf(a) >= 0,
    pinned: id => { const e = W.eyeById[id]; return !!e && e.state === ST.PINNED; },
    state: id => { const e = W.eyeById[id]; return e ? e.state : null; },
    held: id => (W.observedBy[id] || []).length > 0,
    synced: group => groupSynced(W, group),
    playerIn: zid => inZone(W.zones[zid], W.player.pos[0], W.player.pos[2]),
    flag: k => !!W.flags[k],
    mover: id => W.moverById[id]
  };
  W._S = S; return S;
}
function groupSynced(W, group) {
  let n = 0;
  for (const e of W.eyes) {
    if (e.group !== group || e.type !== 'choir') continue; n++;
    if (e.state === ST.PINNED) continue;
    if (!(W.observedBy[e.id] || []).length) return false;
  }
  return n > 0;
}

// ---------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------
function stepWorld(W, dt) {
  dt = dt || SIM_DT;
  if (W.status !== 'play') { W.statusT += dt; stepPlayerFall(W, dt); W.t += dt; W.tick++; return; }
  W.t += dt; W.tick++;
  const S = signalApi(W);
  // 1. movers
  for (const m of W.movers) stepMover(W, m, dt, S);
  // 2. rotor carry, then refresh shapes
  const pr = W.player.region;
  const carry = pr && pr.mover ? W.moverById[pr.mover] : null;
  refreshAll(W);
  if (carry && carry.dAngle) {
    const p = W.player.pos, r = rot2(p[0] - carry.pivot[0], p[2] - carry.pivot[1], carry.dAngle);
    p[0] = carry.pivot[0] + r[0]; p[2] = carry.pivot[1] + r[1]; W.player.yaw += carry.dAngle;
  }
  pushOutOfBlockers(W);
  // 3. player
  stepPlayer(W, dt);
  // 4. gaze
  stepGaze(W, dt);
  // 5. eyes
  for (const e of W.eyes) stepEye(W, e, dt);
  // 6. script
  if (W.script && W.script.update) W.script.update(W, dt, S);
  // 7. links for next tick
  computeLinks(W, false);
  // 8. outcomes
  if (W.status === 'play') {
    for (const e of W.eyes) if (e.acq >= 1 && !e.isFalse) { W.status = 'caught'; W.catcher = e.id; W.statusT = 0; W.emit('caught', { id: e.id }); break; }
  }
  if (W.status === 'play') {
    const ex = W.zones.exit;
    const open = W.def.exitOpen ? W.def.exitOpen(S) : true;
    W.exitOpen = open;
    if (ex && open && !W.player.falling && inZone(ex, W.player.pos[0], W.player.pos[2])) { W.status = 'won'; W.statusT = 0; W.emit('won'); }
  }
  // history of what the player looked at (for mimics)
  W.gazeHist[W.tick % W.gazeHistLen] = W.gaze.target && W.gaze.focus >= 1 ? W.gaze.target : null;
}

function stepMover(W, m, dt, S) {
  const want = m.signal ? (m.signal(S) ? 1 : 0) : (m.on ? 1 : 0);
  if (m.lastSig === null) m.lastSig = want;
  if (want !== m.lastSig) { m.lastSig = want; m.primeT = m.prime; W.emit('mech_prime', { id: m.id, dir: want }); }
  const spd = m.speed * W.mods.mech;
  if (m.kind === 'rotor') {
    if (m.mode === 'cont') {
      const tv = (m.primeT > 0 ? 0 : want) * m.omega * W.mods.mech;
      const prev = m.angVel; m.angVel = approach(m.angVel, tv, (m.accel || 0.6) * dt);
      if ((prev === 0) !== (m.angVel === 0)) W.emit(m.angVel ? 'mech_start' : 'mech_stop', { id: m.id });
      m.dAngle = m.angVel * dt; m.angle += m.dAngle;
    } else { // toggle between angles[0] and angles[1]
      const pe = m.e;
      if (m.primeT <= 0) m.e = approach(m.e, want, spd * dt);
      const a = lerp(m.angles[0], m.angles[1], easeInOut(m.e));
      m.dAngle = a - m.angle; m.angle = a;
      if (pe !== m.e && (pe === 0 || pe === 1)) W.emit('mech_start', { id: m.id });
      if (pe !== m.e && (m.e === 0 || m.e === 1)) W.emit('mech_stop', { id: m.id });
    }
  } else {
    let target = want;
    if (m.kind === 'gate' && target < m.e && gateHasPlayer(W, m)) target = m.e; // never close on the traveller
    const pe = m.e;
    if (m.primeT <= 0) m.e = approach(m.e, target, spd * dt);
    if (pe !== m.e && (pe === 0 || pe === 1)) W.emit('mech_start', { id: m.id });
    if (pe !== m.e && (m.e === 0 || m.e === 1)) W.emit('mech_stop', { id: m.id });
  }
  if (m.primeT > 0) m.primeT -= dt;
  m.moving = m.kind === 'rotor' ? Math.abs(m.dAngle) > 1e-5 : (m.primeT <= 0 && m.e !== (m.lastSig));
}
function gateHasPlayer(W, m) {
  const b = m.blocker, p = W.player.pos;
  const dx = p[0] - b.wx, dz = p[2] - b.wz, u = dx * b.wc + dz * b.ws, v = -dx * b.ws + dz * b.wc;
  return Math.abs(u) < b.hl + PLAYER.r + 0.1 && Math.abs(v) < b.hw + PLAYER.r + 0.35;
}
function pushOutOfBlockers(W) {
  const p = W.player.pos;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (const b of W.blockers) {
      if (!inBlocker(b, p[0], p[2], p[1], PLAYER.r)) continue;
      // push along shortest axis
      let nx = 0, nz = 0, d = 0;
      if (b.kind === 'circle') { const dx = p[0] - b.wx, dz = p[2] - b.wz, L = Math.hypot(dx, dz) || 1; nx = dx / L; nz = dz / L; d = b.r + PLAYER.r - L + 0.01; }
      else if (b.kind === 'box') {
        const dx = p[0] - b.wx, dz = p[2] - b.wz, u = dx * b.wc + dz * b.ws, v = -dx * b.ws + dz * b.wc;
        const pu = b.hl + PLAYER.r - Math.abs(u), pv = b.hw + PLAYER.r - Math.abs(v);
        if (pu < pv) { const sg = u < 0 ? -1 : 1; nx = b.wc * sg; nz = b.ws * sg; d = pu + 0.01; }
        else { const sg = v < 0 ? -1 : 1; nx = -b.ws * sg; nz = b.wc * sg; d = pv + 0.01; }
      } else if (b.kind === 'arc') {
        const dx = p[0] - b.wx, dz = p[2] - b.wz, L = Math.hypot(dx, dz) || 1, mid = (b.r0 + b.r1) / 2;
        const sg = L < mid ? -1 : 1; nx = dx / L * sg; nz = dz / L * sg; d = sg > 0 ? b.r1 + PLAYER.r - L + 0.01 : L - (b.r0 - PLAYER.r) + 0.01;
      }
      p[0] += nx * d; p[2] += nz * d; moved = true;
    }
    if (!moved) break;
  }
}

function stepPlayer(W, dt) {
  const P = W.player;
  if (P.falling) { stepPlayerFall(W, dt); return; }
  // support may have vanished (a bridge retracting under the traveller)
  const here = supportAt(W, P.pos[0], P.pos[2], P.pos[1]);
  if (!here) {
    P.falling = true; P.fallV = 0; P.fallFrom = P.pos[1];
    const low = lowestBelow(W, P.pos[0], P.pos[2], P.pos[1]);
    P.fallTo = low && P.pos[1] - low.y < 3 ? low.y : null;
    W.emit('fall_start');
    return;
  }
  P.pos[1] = here.y; P.region = here.rg;
  let mx = W.input.mx, mz = W.input.mz; const mag = Math.min(1, Math.hypot(mx, mz));
  if (mag < 0.08) { mx = 0; mz = 0; }
  const max = PLAYER.speed * W.mods.speed;
  const tvx = mag > 0 ? mx / Math.hypot(mx, mz) * max * mag : 0, tvz = mag > 0 ? mz / Math.hypot(mx, mz) * max * mag : 0;
  const acc = mag > 0 ? PLAYER.accel : PLAYER.decel;
  const dvx = tvx - P.vel[0], dvz = tvz - P.vel[1], dl = Math.hypot(dvx, dvz), step = acc * dt;
  if (dl <= step) { P.vel[0] = tvx; P.vel[1] = tvz; } else { P.vel[0] += dvx / dl * step; P.vel[1] += dvz / dl * step; }
  const sp = Math.hypot(P.vel[0], P.vel[1]);
  P.speedNow = sp;
  if (sp > 0.05) {
    const res = slideMove(W, P.pos[0], P.pos[2], P.pos[1], P.vel[0] * dt, P.vel[1] * dt);
    if (res) {
      const ax = (res.x - P.pos[0]) / dt, az = (res.z - P.pos[2]) / dt;
      P.pos[0] = res.x; P.pos[2] = res.z; P.pos[1] = res.y; P.region = res.rg;
      // lose velocity into walls so stopping and redirecting stay crisp
      P.vel[0] = lerp(P.vel[0], ax, 0.5); P.vel[1] = lerp(P.vel[1], az, 0.5);
    } else { P.vel[0] = 0; P.vel[1] = 0; }
    if (mag > 0.1) {
      const ty = Math.atan2(mz, mx);
      P.yaw += wrapAngle(ty - P.yaw) * Math.min(1, dt * 14);
    }
  }
  P.moving = Math.hypot(P.vel[0], P.vel[1]) / max;
}
function slideMove(W, x, z, y, dx, dz) {
  const L = Math.hypot(dx, dz); if (L < 1e-6) return null;
  const tryAt = (nx, nz) => { const c = validPos(W, nx, nz, y); return c ? { x: nx, z: nz, y: c.y, rg: c.rg } : null; };
  let r = tryAt(x + dx, z + dz); if (r) return r;
  // slide: rotated directions, scaled by cos so progress never exceeds the wish
  let best = null, bestP = 0;
  for (const a of [0.35, -0.35, 0.75, -0.75, 1.15, -1.15]) {
    const c = Math.cos(a), rr = rot2(dx, dz, a);
    const q = tryAt(x + rr[0] * c, z + rr[1] * c);
    if (q) { const prog = ((q.x - x) * dx + (q.z - z) * dz) / L; if (prog > bestP) { bestP = prog; best = q; } }
  }
  if (best) return best;
  r = tryAt(x + dx, z); if (r) return r;
  r = tryAt(x, z + dz); if (r) return r;
  return null;
}
function stepPlayerFall(W, dt) {
  const P = W.player; if (!P.falling) return;
  P.fallV += 26 * dt; P.pos[1] -= P.fallV * dt;
  if (P.fallTo !== null && P.fallTo !== undefined && P.pos[1] <= P.fallTo) {
    P.pos[1] = P.fallTo; P.falling = false; W.emit('land'); return;
  }
  if (W.status === 'play' && P.pos[1] < (P.fallFrom || 0) - 7) { W.status = 'fell'; W.statusT = 0; W.emit('fell'); }
}

// ---------------------------------------------------------------------
// Gaze: the player's attention.
// ---------------------------------------------------------------------
function setGaze(W, id) {
  const G = W.gaze;
  if (id === G.target) return;
  const prev = G.target ? W.eyeById[G.target] : null;
  if (prev && prev.state === ST.PINNED) { prev.state = ST.RELEASING; prev.st = 0; W.emit('release', { id: prev.id }); }
  G.target = id || null; G.focus = 0; G.lostT = 0; G.refused = false;
  if (id) W.emit('gaze', { id });
}
function gazeLosTo(W, e) {
  const h = playerHead(W);
  const p1 = vAddS(e.pos, vNorm(vSub(h, e.pos)), e.size * 1.05);
  return los(W, h, p1, e.ignore);
}
function pinnableNow(e) {
  if (e.state === ST.DORMANT) return false;
  if (e.type === 'liar' && !e.liarOpen) return false;
  if (e.unblink || e.isFalse) return false;
  return !!e.pinnable;
}
function stepGaze(W, dt) {
  const G = W.gaze;
  if (!G.target) return;
  const e = W.eyeById[G.target];
  if (!e) { G.target = null; return; }
  const see = !W.player.falling && gazeLosTo(W, e);
  if (!see) {
    G.lostT += dt; G.focus = Math.max(0, G.focus - dt * 3);
    if (e.state === ST.PINNED && G.lostT > 0.12) { e.state = ST.RELEASING; e.st = 0; W.emit('release', { id: e.id, lost: true }); }
    if (G.lostT > 0.5) { W.emit('gaze_lost', { id: e.id }); G.target = null; G.focus = 0; }
    return;
  }
  G.lostT = 0;
  if (!pinnableNow(e)) {
    // false eyes accept the gaze and do nothing; liars and the lidless refuse it
    if (e.isFalse) { G.focus = Math.min(1, G.focus + dt / 0.22); if (G.focus >= 1 && !e.revealed) { e.revealed = true; W.emit('false_reveal', { id: e.id }); } }
    else { if (!G.refused) { G.refused = true; W.emit('gaze_refused', { id: e.id }); } G.focus = Math.min(0.35, G.focus + dt); }
    return;
  }
  G.refused = false;
  G.focus = Math.min(1, G.focus + dt / 0.22);
  if (G.focus >= 1 && e.state !== ST.PINNED) {
    const wasAcq = e.state === ST.ACQUIRING;
    e.state = ST.PINNED; e.st = 0; e.alert = null;
    W.emit('pin', { id: e.id, wasAcq });
  }
}

// ---------------------------------------------------------------------
// Eyes
// ---------------------------------------------------------------------
function isPresent(e) { return e.state !== ST.PINNED && e.state !== ST.RELEASING && e.state !== ST.DORMANT && e.state !== ST.DISRUPTED; }
function canHoldLink(e) { return !e.isFalse && (e.state === ST.ACTIVE || e.state === ST.SEARCHING); }

// What does this eye want to look at (when not acquiring the player)?
function resolveTarget(W, e, init) {
  // sentinel alarm / alert overrides for hunters
  if (e.alert && !init) return { kind: 'point', p: e.alert.p };
  if (e.type === 'mimic') {
    const idx = ((W.tick - Math.round(e.mimic.delay * SIM_HZ)) % W.gazeHistLen + W.gazeHistLen) % W.gazeHistLen;
    const g = init ? null : W.gazeHist[idx];
    e.echo = g;
    if (g === e.id) return { kind: 'player' };
    if (g && W.eyeById[g]) return { kind: 'eye', id: g };
    return e.home ? homeTarget(W, e) : null;
  }
  if (e.unblink) {
    const obs = W.observedBy[e.id] || [];
    for (const o of obs) if (o !== e.id) return { kind: 'eye', id: o, stare: true };
    return { kind: 'player', hunt: true };
  }
  if (e.type === 'collector') {
    const c = e.collect;
    // keep a current orphan while nobody else holds it
    if (e.target && e.target.kind === 'eye' && e.target.orphan) {
      const t = W.eyeById[e.target.id], by = W.observedBy[e.target.id] || [];
      const others = by.filter(x => x !== e.id).length;
      if (t && isPresent(t) && others === 0 && eyeLos(W, e, t)) return e.target;
    }
    let best = null, bd = 1e9;
    for (const m of W.eyes) {
      if (m === e || m.group !== c.group || m.type === 'collector') continue;
      if (!isPresent(m) && m.state !== ST.DISRUPTED) continue;
      const by = W.observedBy[m.id] || [];
      if (by.filter(x => x !== e.id).length > 0) continue;
      if (!m.orphanSince && m.orphanSince !== 0) continue;
      if (W.t - m.orphanSince < c.notice) continue;
      if (!eyeLos(W, e, m)) continue;
      const d = vDist(e.pos, m.pos); if (d < bd) { bd = d; best = m; }
    }
    if (best) return { kind: 'eye', id: best.id, orphan: true };
    return homeTarget(W, e);
  }
  if (e.type === 'choir' && e.home && e.home.eye) {
    let t = W.eyeById[e.home.eye];
    if (t && !isPresent(t) && t.state !== ST.DISRUPTED) {
      if (e.skipT >= e.heal) {
        let guard = 0;
        while (t && t !== e && !isPresent(t) && t.home && t.home.eye && guard++ < 12) t = W.eyeById[t.home.eye];
        if (t && t !== e) return { kind: 'eye', id: t.id };
      }
    }
    return homeTarget(W, e);
  }
  if (e.type === 'sentinel') {
    const z = W.zones[e.sentinel.zones[e.sentinel.idx]];
    if (z) return { kind: 'point', p: [z.x, z.y || 0, z.z] };
  }
  return homeTarget(W, e);
}
function homeTarget(W, e) {
  const h = e.home; if (!h) return null;
  if (h.eye) return { kind: 'eye', id: h.eye };
  if (h.point) return { kind: 'point', p: h.point };
  if (h.sweep) {
    const per = h.period || 6, ph = ((W.t + (h.phase || 0) * per) % per) / per;
    const k = (1 - Math.cos(ph * TAU)) / 2; // 0..1..0
    const pts = h.sweep;
    if (pts.length === 2) return { kind: 'point', p: vLerp(pts[0], pts[1], k) };
    const f = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f));
    return { kind: 'point', p: vLerp(pts[i], pts[i + 1], f - i) };
  }
  if (h.dir) return { kind: 'dir', d: h.dir };
  return null;
}
function targetPoint(W, e, tg) {
  if (!tg) return null;
  if (tg.kind === 'eye') { const t = W.eyeById[tg.id]; return t ? t.pos : null; }
  if (tg.kind === 'player') return playerChest(W);
  if (tg.kind === 'point') return tg.p;
  if (tg.kind === 'dir') return vAdd(e.pos, tg.d);
  return null;
}
function desiredDir(W, e, init) {
  if (e.rail && !e.home) {
    // drifters look along their authored rail direction
    const d = e.rail.look ? e.rail.look : e.facing;
    return vNorm(d);
  }
  const tg = resolveTarget(W, e, init); e.target = tg;
  const p = targetPoint(W, e, tg); if (!p) return e.facing;
  return vNorm(vSub(p, e.pos));
}

function playerVisibleTo(W, e) {
  if (W.player.falling) return null;
  const c = playerChest(W), h = playerHead(W);
  const to = vSub(c, e.pos), d = vLen(to); if (d > e.range) return null;
  const front = vAddS(e.pos, vNorm(to), e.size * 1.05);
  if (!los(W, front, h, e.ignore) && !los(W, front, c, e.ignore)) return null;
  return { d, ang: angleBetween(e.look, to), dir: vScale(to, 1 / d) };
}

function stepEye(W, e, dt) {
  e.st += dt;
  const obs = W.observedBy[e.id] || [];
  const held = obs.length > 0;
  // track orphan time for collectors (an unheld member of a formation)
  if (e.group && e.type !== 'collector') {
    if (!held && (isPresent(e) || e.state === ST.DISRUPTED)) { if (e.orphanSince === undefined || e.orphanSince === null) e.orphanSince = W.t; }
    else e.orphanSince = null;
  }
  // freed from being held: a short disorientation before it can notice anything
  if (e.wasHeld && !held && (e.state === ST.ACTIVE || e.state === ST.SEARCHING) && e.disruptOnFree !== false) {
    e.state = ST.DISRUPTED; e.st = 0; e.disruptT = e.disruptTime || 0.7; W.emit('freed', { id: e.id });
  }
  e.wasHeld = held;
  if (e.type === 'choir') {
    const h = e.home && e.home.eye ? W.eyeById[e.home.eye] : null;
    if (h && !isPresent(h) && h.state !== ST.DISRUPTED) e.skipT += dt; else e.skipT = 0;
  }
  if (e.alert) { e.alert.t -= dt; if (e.alert.t <= 0) e.alert = null; }

  switch (e.state) {
    case ST.DORMANT:
      e.seesPlayer = false;
      if (e.wake && e.wake(signalApi(W))) { e.state = ST.ACTIVE; e.st = 0; W.emit('awaken', { id: e.id }); }
      e.acq = Math.max(0, e.acq - dt);
      return;
    case ST.PINNED:
      e.seesPlayer = false; e.acq = Math.max(0, e.acq - dt * 1.1);
      return;
    case ST.RELEASING:
      e.seesPlayer = false; e.acq = Math.max(0, e.acq - dt * 0.6);
      if (e.st >= (e.releaseTime || 0.8)) { e.state = ST.ACTIVE; e.st = 0; W.emit('resume', { id: e.id }); }
      return;
    case ST.DISRUPTED:
      e.seesPlayer = false; e.acq = Math.max(0, e.acq - dt * 0.6);
      if (e.st >= (e.disruptT || 0.7)) { e.state = ST.ACTIVE; e.st = 0; }
      turnLook(W, e, desiredDir(W, e), e.turn * 0.5, dt);
      return;
  }

  // movement along rail (drifters stop when held or acquiring)
  if (e.rail) {
    const r = e.rail;
    if (!held && e.state !== ST.ACQUIRING) {
      if (r.pauseT > 0) r.pauseT -= dt;
      else {
        r.u += r.dir * r.speed * dt;
        if (!r.loop) {
          if (r.u >= r.total) { r.u = r.total; r.dir = -1; r.pauseT = r.pause; }
          else if (r.u <= 0) { r.u = 0; r.dir = 1; r.pauseT = r.pause; }
        }
      }
    }
  }

  // sentinel cycling + alarm
  if (e.sentinel) {
    const s = e.sentinel;
    if (s.zones.length > 1 && !held) { s.t += dt; if (s.t >= s.period) { s.t = 0; s.idx = (s.idx + 1) % s.zones.length; W.emit('sentinel_shift', { id: e.id, zone: s.zones[s.idx] }); } }
  }

  const canNotice = e.notices !== false && !held && !(e.type === 'unblinking' && false);
  let vis = null;
  if (!held) vis = playerVisibleTo(W, e);
  e.seesPlayer = false;

  // sentinels: region watchers
  if (e.sentinel) {
    const z = W.zones[e.sentinel.zones[e.sentinel.idx]];
    const inZ = z && inZone(z, W.player.pos[0], W.player.pos[2]) && !W.player.falling;
    if (!held && inZ && vis) {
      e.seesPlayer = true;
      if (e.state !== ST.ACQUIRING) { e.state = ST.ACQUIRING; e.st = 0; W.emit('alarm', { id: e.id }); }
      e.acq = Math.min(1, e.acq + dt / (e.acquireTime * W.mods.acquire));
      // broadcast: every free hunter nearby turns to where you stand
      if (!e._lastAlarm || W.t - e._lastAlarm > 0.4) {
        e._lastAlarm = W.t;
        for (const o of W.eyes) {
          if (o === e || o.sentinel || o.isFalse) continue;
          if ((W.observedBy[o.id] || []).length) continue;
          if (!(o.state === ST.ACTIVE || o.state === ST.SEARCHING || o.state === ST.ALERT)) continue;
          if (vDist(o.pos, e.pos) > e.sentinel.alarm && vDist(o.pos, W.player.pos) > e.sentinel.alarm) continue;
          o.alert = { p: playerChest(W), t: 2.6 };
        }
      }
      turnLook(W, e, vNorm(vSub(playerChest(W), e.pos)), e.acqTurn, dt);
    } else {
      if (e.state === ST.ACQUIRING) { e.state = ST.ACTIVE; e.st = 0; }
      e.acq = Math.max(0, e.acq - dt * 0.5);
      turnLook(W, e, desiredDir(W, e), e.turn, dt);
    }
    return;
  }

  // mimics only hunt when echoing a look at themselves
  let mimicHunt = false;
  if (e.type === 'mimic') { const tg = resolveTarget(W, e); e.target = tg; mimicHunt = tg && tg.kind === 'player'; }
  let unblinkHunt = false;
  if (e.unblink) { const tg = resolveTarget(W, e); e.target = tg; unblinkHunt = tg && tg.kind === 'player'; }

  const fov = e.fov;
  const sees = vis && (canNotice || mimicHunt || unblinkHunt) && (vis.ang < fov * (e.state === ST.ACQUIRING ? 1.25 : 1) || ((mimicHunt || unblinkHunt) && vis.ang < Math.max(fov, 35 * DEG)));
  const periph = vis && canNotice && e.periph > 1 && e.alertTurn > 0 && vis.ang < fov * e.periph;
  const rate = 1 / (e.acquireTime * W.mods.acquire);

  if (sees) {
    if (e.state !== ST.ACQUIRING) { e.state = ST.ACQUIRING; e.st = 0; W.emit('notice', { id: e.id }); }
    e.seesPlayer = true;
    e.lastSeen = playerChest(W);
    let r = rate * (1 + Math.max(0, 1 - vis.d / e.range) * 0.35);
    if (e.type === 'liar' && !e.liarOpen) r *= 0.6;
    e.acq = Math.min(1, e.acq + dt * r);
    if (e.isFalse) e.acq = Math.min(0.72, e.acq);
    if (e.type === 'liar' && !e.liarOpen && e.acq >= 0.45) { e.liarOpen = true; W.emit('liar_open', { id: e.id }); }
    turnLook(W, e, vNorm(vSub(playerChest(W), e.pos)), e.acqTurn, dt);
    e.liarIdle = 0;
    return;
  }
  // lost sight
  if (e.state === ST.ACQUIRING) { e.state = ST.SEARCHING; e.st = 0; W.emit('lost', { id: e.id }); }
  e.acq = Math.max(0, e.acq - dt * (e.decay || 0.4));
  if (e.type === 'liar' && e.liarOpen) {
    e.liarIdle = (e.liarIdle || 0) + dt;
    if (e.liarIdle > 4 && e.acq <= 0 && W.gaze.target !== e.id) { e.liarOpen = false; W.emit('liar_close', { id: e.id }); }
  }
  if (e.state === ST.SEARCHING) {
    if (e.st > e.searchTime) { e.state = ST.ACTIVE; e.st = 0; }
    else if (e.lastSeen) {
      const sw = Math.sin(e.st * 3.1) * 0.12;
      const d = vNorm(vSub(e.lastSeen, e.pos)), side = vNorm(vCross(d, [0, 1, 0]));
      turnLook(W, e, vNorm(vAddS(d, side, sw)), e.turn, dt);
      return;
    }
  }
  if (periph) {
    if (e.state !== ST.ALERT) { e.state = ST.ALERT; e.st = 0; W.emit('alert', { id: e.id }); }
    turnLook(W, e, vNorm(vSub(playerChest(W), e.pos)), e.alertTurn, dt);
    return;
  }
  if (e.state === ST.ALERT) { e.state = ST.ACTIVE; e.st = 0; }
  const d = desiredDir(W, e);
  let sp = e.turn;
  if (e.type === 'collector' && e.target && e.target.orphan) sp = e.collect.turn || e.turn;
  turnLook(W, e, d, sp, dt);
}
function turnLook(W, e, d, speed, dt) {
  if (!d) return;
  const want = clampCone(d, e.facing, e.maxDev);
  e.look = rotateToward(e.look, want, speed * dt);
}

// Links are recomputed after every step, and read by the next one.
function computeLinks(W, init) {
  const prev = W.prevLinks, next = new Set();
  W.links.length = 0;
  for (const id in W.observedBy) W.observedBy[id].length = 0;
  for (const e of W.eyes) {
    e.linkTo = null;
    if (!canHoldLink(e)) continue;
    const tg = e.target;
    if (!tg || tg.kind !== 'eye') continue;
    const t = W.eyeById[tg.id]; if (!t || t === e) continue;
    const dir = vSub(t.pos, e.pos);
    if (angleBetween(e.look, dir) > (e.linkAngle || 5 * DEG)) continue;
    if (vLen(dir) > (e.linkRange || 80)) continue;
    if (!eyeLos(W, e, t)) continue;
    e.linkTo = t.id;
    W.links.push({ a: e.id, b: t.id });
    W.observedBy[t.id].push(e.id);
    const k = e.id + '>' + t.id; next.add(k);
    if (!init && !prev.has(k)) W.emit('link', { a: e.id, b: t.id });
  }
  if (!init) for (const k of prev) if (!next.has(k)) { const [a, b] = k.split('>'); W.emit('unlink', { a, b }); }
  W.prevLinks = next;
}

// ---- 02_kit.js ----
// =====================================================================
// Authoring kit. Every call writes the simulation shape(s) and a visual
// descriptor from the same numbers, so what you see is what collides,
// and what blocks your view blocks theirs.
// =====================================================================

function makeKit(B, W) {
  const V = W.visuals = [];
  const K = { B, W, V };
  let tagN = 0;
  const vis = o => { V.push(o); return o; };
  const T = () => 'h' + (tagN++);

  K.spawn = (x, z, yaw, y) => { B.spawn(x, z, yaw, y); vis({ type: 'entry', x, z, y: y || 0, yaw: yaw === undefined ? -Math.PI / 2 : yaw }); };

  // ---- walkable ground -------------------------------------------------
  K.floor = o => { // rectangle slab; yaw = direction of its length
    const r = B.rect({ cx: o.x, cz: o.z, hw: o.w / 2, hl: o.l / 2, yaw: o.yaw === undefined ? -Math.PI / 2 : o.yaw, y: o.y || 0, y2: o.y2, mover: o.mover });
    vis({ type: 'slab', shape: 'rect', x: o.x, z: o.z, w: o.w, l: o.l, yaw: r.yaw, y: o.y || 0, y2: o.y2, thick: o.thick || 1.2, mat: o.mat || 'bone', mover: o.mover, keel: o.keel !== false, etch: o.etch, rail: o.rail });
    if (o.railings) K.railings(o);
    return r;
  };
  K.ring = o => { // annular or disc slab
    const r = B.arc({ cx: o.x, cz: o.z, r0: o.r0 || 0, r1: o.r1, a0: o.a0 === undefined ? 0 : o.a0, a1: o.a1 === undefined ? TAU : o.a1, y: o.y || 0, mover: o.mover });
    vis({ type: 'slab', shape: 'arc', x: o.x, z: o.z, r0: o.r0 || 0, r1: o.r1, a0: r.a0, a1: r.a1, y: o.y || 0, thick: o.thick || 1.4, mat: o.mat || 'bone', mover: o.mover, keel: o.keel !== false, etch: o.etch, lip: o.lip });
    return r;
  };
  K.railings = o => { /* visual only kerbs; walkability already stops edges */ };

  // ---- solids ------------------------------------------------------------
  K.pillar = o => { // vertical column: blocks movement and sight
    const tag = o.tag || T();
    if (o.block !== false && o.r > 0.2) B.blockCircle({ x: o.x, z: o.z, r: o.r, mover: o.mover, y0: o.bottom === undefined ? -60 : o.bottom, y1: o.top === undefined ? 60 : o.top });
    if (o.occlude !== false) B.occCyl({ x: o.x, z: o.z, r: o.r * (o.occScale || 0.92), y0: o.bottom === undefined ? -60 : o.bottom, y1: o.top === undefined ? 60 : o.top, mover: o.mover, tag });
    vis({ type: 'pillar', x: o.x, z: o.z, r: o.r, top: o.top === undefined ? 40 : o.top, bottom: o.bottom === undefined ? -60 : o.bottom, mat: o.mat || 'bone', style: o.style || 'fluted', mover: o.mover, tag, seed: o.seed || tagN * 13 + 1, cap: o.cap });
    return tag;
  };
  K.wall = o => { // curved wall (arc), blocks movement and sight
    // Cutaway: the half of a curved wall between the chamber and the camera (+z side)
    // is built as a low parapet, in the simulation as well as on screen.
    if (o.cut !== false && !o._piece) {
      const cuts = [];
      for (let k = Math.ceil(o.a0 / Math.PI - 1e-6); k * Math.PI < o.a1 - 1e-6; k++) cuts.push(k * Math.PI);
      const bounds = [o.a0].concat(cuts.filter(c => c > o.a0 + 1e-6 && c < o.a1 - 1e-6), [o.a1]);
      let tag0 = null;
      for (let i = 0; i < bounds.length - 1; i++) {
        const mid = (bounds[i] + bounds[i + 1]) / 2, near = Math.sin(mid) > 0;
        const t = K.wall(Object.assign({}, o, { _piece: true, a0: bounds[i], a1: bounds[i + 1], y1: near ? (o.low === undefined ? 1.8 : o.low) : o.y1, near, tag: o.tag ? o.tag + (i ? '_' + i : '') : undefined }));
        if (!tag0) tag0 = t;
      }
      return tag0;
    }
    const tag = o.tag || T();
    const y0 = o.y0 === undefined ? -2 : o.y0, y1 = o.y1 === undefined ? 30 : o.y1;
    if (o.block !== false) B.blockArc({ cx: o.x, cz: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0, y1, mover: o.mover });
    if (o.occlude !== false) B.occArc({ cx: o.x, cz: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0, y1, mover: o.mover, tag });
    vis({ type: 'wall', x: o.x, z: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0: o.vy0 === undefined ? y0 - 30 : o.vy0, y1, mat: o.mat || 'olive', style: o.near ? 'parapet' : (o.style || 'ribbed'), mover: o.mover, tag, seed: o.seed || tagN * 7 + 3 });
    return tag;
  };
  K.block = o => { // straight wall / rib slab
    const tag = o.tag || T();
    const yaw = o.yaw === undefined ? 0 : o.yaw, y0 = o.y0 === undefined ? -2 : o.y0, y1 = o.y1 === undefined ? 6 : o.y1;
    if (o.block !== false) B.blockBox({ cx: o.x, cz: o.z, hw: o.t / 2, hl: o.w / 2, yaw, y0, y1, mover: o.mover });
    if (o.occlude !== false) B.occBox({ cx: o.x, cz: o.z, cy: (y0 + y1) / 2, hw: o.t / 2, hl: o.w / 2, hh: (y1 - y0) / 2, yaw, mover: o.mover, tag });
    vis({ type: 'block', x: o.x, z: o.z, w: o.w, t: o.t, yaw, y0: o.vy0 === undefined ? y0 : o.vy0, y1, mat: o.mat || 'olive', style: o.style || 'rib', mover: o.mover, tag });
    return tag;
  };
  // A screen of ribs: sight is blocked but the traveller can't pass either.
  K.screen = o => K.block(Object.assign({ style: 'screen', mat: 'ink' }, o));

  // ---- mechanisms ----------------------------------------------------------
  K.gate = o => { // iris gate; open while signal is true
    const yaw = o.yaw === undefined ? 0 : o.yaw;
    const m = B.mover({ id: o.id, kind: 'gate', x: o.x, z: o.z, y: o.y || 0, w: o.w, h: o.h || 4.5, thick: o.thick || 0.8, yaw, signal: o.signal, speed: o.speed || 0.9, e: o.open ? 1 : 0, prime: o.prime === undefined ? 0.4 : o.prime, sight: o.sight });
    vis({ type: 'gate', id: o.id, x: o.x, z: o.z, y: o.y || 0, w: o.w, h: o.h || 4.5, yaw, mat: o.mat || 'ochre', frame: o.frame !== false });
    return m;
  };
  K.bridge = o => { // vertebral bridge extending from (ax,az) along yaw while signal is true
    const m = B.mover({ id: o.id, kind: 'bridge', ax: o.ax, az: o.az, yaw: o.yaw, len: o.len, w: o.w || 2.2, y: o.y || 0, signal: o.signal, speed: o.speed || 0.5, e: o.open ? 1 : 0, prime: o.prime === undefined ? 0.5 : o.prime });
    vis({ type: 'bridge', id: o.id, ax: o.ax, az: o.az, yaw: o.yaw, len: o.len, w: o.w || 2.2, y: o.y || 0, mat: o.mat || 'bone' });
    return m;
  };
  K.rotor = o => {
    const m = B.mover({ id: o.id, kind: 'rotor', pivot: [o.x, o.z], mode: o.mode || 'toggle', omega: o.omega || 0.3, angles: o.angles || [0, Math.PI / 2], signal: o.signal, speed: o.speed || 0.35, e: o.start || 0, angle: o.angles ? o.angles[0] + (o.angles[1] - o.angles[0]) * (o.start || 0) : (o.angle || 0), prime: o.prime === undefined ? 0.6 : o.prime, accel: o.accel });
    vis({ type: 'rotor', id: o.id, x: o.x, z: o.z, y: o.y || 0, r: o.r || 6, hub: o.hub });
    return m;
  };
  // A tendon: an organic line that makes a mechanism's dependency visible.
  K.tendon = o => vis({ type: 'tendon', from: o.from, to: o.to, sag: o.sag === undefined ? 3 : o.sag, w: o.w || 0.18, via: o.via });

  // ---- eyes ------------------------------------------------------------------
  K.eye = o => {
    const e = B.eye(Object.assign({}, o, { ignore: (o.ignore || []).concat(o.host ? [o.host] : []) }));
    vis({ type: 'eye', id: o.id, host: o.host, mount: o.mount || (o.rail ? 'rail' : 'socket'), socket: o.socket !== false, scale: o.scale || 1 });
    if (o.rail) vis({ type: 'rail', id: o.id, pts: o.rail.pts, loop: !!o.rail.loop });
    return e;
  };
  // eye set into a pillar: returns {pos, facing} on the pillar surface facing yaw
  K.onPillar = (px, pz, pr, y, yaw, pitch, depth) => {
    const d = dirYP(yaw, 0);
    const pos = [px + d[0] * (pr + (depth === undefined ? 0.15 : depth)), y, pz + d[2] * (pr + (depth === undefined ? 0.15 : depth))];
    return { pos, facing: dirYP(yaw, pitch || 0) };
  };
  K.toward = (from, to) => vNorm(vSub(to, from));

  // ---- regions ----------------------------------------------------------------
  K.exit = o => {
    B.zone('exit', { x: o.x, z: o.z, r: o.r || 1.3 });
    vis({ type: 'portal', role: 'exit', x: o.x, z: o.z, y: o.y || 0, yaw: o.yaw === undefined ? -Math.PI / 2 : o.yaw, size: o.size || 3.2 });
  };
  K.zone = (id, o) => { const z = B.zone(id, o); if (o.show) vis({ type: 'zone', id, x: o.x, z: o.z, y: o.y || 0, r: o.r, hw: o.hw, hl: o.hl, yaw: o.yaw, style: o.show }); return z; };

  // ---- decoration (no simulation) ------------------------------------------------
  K.ribs = o => vis(Object.assign({ type: 'ribs' }, o));         // arches over a chamber
  K.shaft = o => vis(Object.assign({ type: 'shaft' }, o));       // a deep circular void with descending rings
  K.mass = o => vis(Object.assign({ type: 'mass' }, o));         // distant architectural massing
  K.lamp = o => vis(Object.assign({ type: 'lamp' }, o));
  K.roots = o => vis(Object.assign({ type: 'roots' }, o));       // hanging tendons
  K.spiral = o => vis(Object.assign({ type: 'spiral' }, o));     // a spiral ramp structure in the distance
  K.stair = o => vis(Object.assign({ type: 'stair' }, o));       // impossible stairs (decor)
  K.colonnade = o => vis(Object.assign({ type: 'colonnade' }, o));
  return K;
}

// ---- 03_act1.js ----
// =====================================================================
// Act I — Attention. Bone architecture, olive haze, a high cold light.
// =====================================================================
const ENCOUNTERS = [];
const N = -Math.PI / 2, S_ = Math.PI / 2, E_ = 0, W_ = Math.PI;

// ---- 01 First Witness ----------------------------------------------------
ENCOUNTERS.push({
  id: 'e01', act: 1, name: 'First Witness',
  cam: { pitch: 56, dist: 34, fov: 40, z0: 20, z1: -21, x0: -3, x1: 3 },
  look: 'act1',
  build(K) {
    K.spawn(0, 21);
    K.floor({ x: 0, z: 9.5, w: 4, l: 25, etch: 'rungs' });
    K.ring({ x: 0, z: -12, r1: 9.5, etch: 'spiral' });
    K.floor({ x: 0, z: -24, w: 3.2, l: 6, etch: 'rungs' });
    K.wall({ x: 0, z: -12, r0: 10.6, r1: 12.4, a0: S_ + 0.34, a1: N + TAU - 0.24, y1: 15 });
    K.wall({ x: 0, z: -12, r0: 10.6, r1: 12.4, a0: N + 0.24, a1: S_ - 0.34, y1: 15 });
    K.block({ x: -2.3, z: -24.5, w: 7, t: 1.2, yaw: N, y1: 14, mat: 'bone', style: 'jamb' });
    K.block({ x: 2.3, z: -24.5, w: 7, t: 1.2, yaw: N, y1: 14, mat: 'bone', style: 'jamb' });
    const p1 = K.pillar({ x: 4.6, z: -11, r: 1.7, top: 30, mat: 'bone', style: 'fluted' });
    K.pillar({ x: -5.2, z: -13.5, r: 1.3, top: 30, mat: 'bone', style: 'fluted' });
    const yaw = Math.atan2(-2 + 11, 0 - 4.6);
    const m = K.onPillar(4.6, -11, 1.7, 4.6, yaw, -0.3);
    K.eye({ id: 'W', type: 'watcher', host: p1, pos: m.pos, facing: m.facing, acquireTime: 3.2,
      home: { sweep: [[-5.5, 0.8, -4.5], [-3.5, 0.8, -18.5]], period: 9 } });
    K.exit({ x: 0, z: -26.2, yaw: N });
    K.ribs({ x: 0, z: -12, r: 13, count: 7, h: 24, span: 'over', thick: 1.1 });
    K.shaft({ x: 0, z: 8, r: 6, depth: 70 });
    K.mass({ seed: 11, style: 'towers' });
    K.roots({ x: 0, z: -12, r: 11, n: 9, top: 30 });
    K.lamp({ x: 0, y: 9, z: -12, color: '#d9b26a', intensity: 0.6, dist: 22 });
  },
  hints: [
    { id: 'move', text: 'Drag on the left side to move', stick: true, until: W => W.player.pos[2] < 17 },
    { id: 'tap', text: 'Tap the eye to hold its gaze', focus: 'W', when: W => W.eyeById.W.state === 'alert' || W.eyeById.W.state === 'acquiring' || W.player.pos[2] < -4, until: W => W.eyeById.W.state === 'pinned' },
    { id: 'held', text: 'Held eyes see nothing. Walk past', when: W => W.eyeById.W.state === 'pinned', until: W => W.player.pos[2] < -19, ms: 3800 }
  ],
  failHint: 'Tap the eye before it finishes looking at you.'
});

// ---- 02 The Unwatched -------------------------------------------------------
ENCOUNTERS.push({
  id: 'e02', act: 1, name: 'The Unwatched',
  cam: { pitch: 56, dist: 34, fov: 40, z0: 22, z1: -24, x0: -2, x1: 2 },
  look: 'act1',
  build(K) {
    K.spawn(0, 24);
    K.floor({ x: 0, z: 0, w: 5.4, l: 52, etch: 'rungs' });
    K.floor({ x: 0, z: -28.5, w: 3, l: 5, etch: 'rungs' });
    // flanking walls with deep alcoves
    K.block({ x: -4.4, z: 0, w: 52, t: 1.6, yaw: N, y1: 22, mat: 'bone', style: 'colonnade', tag: 'wl' });
    K.block({ x: 4.4, z: 0, w: 52, t: 1.6, yaw: N, y1: 22, mat: 'bone', style: 'colonnade', tag: 'wr' });
    const pc = K.pillar({ x: 0.2, z: -5, r: 1.15, top: 22, style: 'fluted' });
    // left watcher low in the wall, right watcher further on
    K.eye({ id: 'L', type: 'watcher', pos: [-3.4, 3.4, 4], facing: dirYP(-0.25, -0.35), acquireTime: 2.0, ignore: ['wl'], maxDev: 52 * DEG, range: 18,
      home: { sweep: [[-1.4, 0.8, 7], [1.6, 0.8, -7]], period: 7 } });
    K.eye({ id: 'R', type: 'watcher', pos: [3.4, 3.4, -13], facing: dirYP(W_ + 0.25, -0.35), acquireTime: 2.0, ignore: ['wr'], maxDev: 52 * DEG, range: 18,
      home: { sweep: [[1.4, 0.8, -2], [-1.6, 0.8, -21]], period: 7, phase: 0.5 } });
    K.exit({ x: 0, z: -29.5, yaw: N });
    K.ribs({ x: 0, z: 0, r: 7, count: 6, along: 'z', z0: 14, z1: -26, h: 11, thick: 0.8, span: 'vault' });
    K.mass({ seed: 23, style: 'towers' });
    K.shaft({ x: 0, z: -31, r: 5, depth: 60 });
  },
  hints: [
    { id: 'one', text: 'You can hold only one', when: W => W.player.pos[2] < 10, until: W => W.player.pos[2] < -8, ms: 4200 },
    { id: 'away', text: 'Look at another eye and the first is released', when: W => W.player.pos[2] < -2 && W.eyeById.L.state === 'pinned', until: W => W.eyeById.R.state === 'pinned', ms: 4000 }
  ],
  failHint: 'Hide behind the column while you change which eye you hold.'
});

// ---- 03 The Bridge -------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e03', act: 1, name: 'The Bridge',
  cam: { pitch: 57, dist: 36, fov: 40, z0: 12, z1: -18, x0: -2, x1: 2 },
  look: 'act1',
  build(K) {
    K.spawn(0, 13);
    K.ring({ x: 0, z: 9, r1: 5.4, etch: 'spiral' });
    K.floor({ x: 0, z: 15.5, w: 3, l: 3 });
    K.ring({ x: 0, z: -14, r1: 5.2, etch: 'spiral' });
    K.floor({ x: 0, z: -20.5, w: 3, l: 4 });
    K.bridge({ id: 'span', ax: 0, az: 4.2, yaw: N, len: 13.6, w: 2.4, signal: S => !S.observed('B'), speed: 0.55 });
    const pa = K.pillar({ x: -8.5, z: -3, r: 2.3, top: 34, bottom: -70, style: 'fluted' });
    const pb = K.pillar({ x: 8.5, z: -5, r: 2.1, top: 34, bottom: -70, style: 'fluted' });
    const a = K.onPillar(-8.5, -3, 2.3, 7.5, Math.atan2(-5 + 3, 8.5 + 8.5), -0.1);
    K.eye({ id: 'A', type: 'watcher', host: pa, pos: a.pos, facing: a.facing, home: { eye: 'B' }, acquireTime: 2.4 });
    const b = K.onPillar(8.5, -5, 2.1, 5.5, W_ + 0.12, -0.15);
    K.eye({ id: 'B', type: 'watcher', host: pb, pos: b.pos, facing: b.facing, home: { point: [14, 0.5, -24] }, acquireTime: 2.4, maxDev: 50 * DEG });
    const pc = K.pillar({ x: -5.5, z: -18.5, r: 1.4, top: 28, style: 'fluted' });
    const c = K.onPillar(-5.5, -18.5, 1.4, 3.4, Math.atan2(-11 + 18.5, 0 + 5.5), -0.25);
    K.eye({ id: 'C', type: 'watcher', host: pc, pos: c.pos, facing: c.facing, acquireTime: 2.6, range: 13, home: { sweep: [[3.5, 0.8, -12], [-1.5, 0.8, -9]], period: 6 } });
    K.tendon({ from: { eye: 'B' }, to: { mover: 'span' }, sag: 6 });
    K.exit({ x: 0, z: -22, yaw: N });
    K.shaft({ x: 0, z: -2, r: 14, depth: 90, rings: 9 });
    K.ribs({ x: 0, z: -3, r: 16, count: 6, h: 28, span: 'over', thick: 1.3 });
    K.mass({ seed: 31, style: 'arches' });
    K.lamp({ x: 0, y: 6, z: -14, color: '#d9b26a', intensity: 0.5, dist: 16 });
  },
  hints: [
    { id: 'watch', text: 'The left eye holds the right one. Hold the left', focus: 'A', when: W => W.t > 1.2, until: W => W.eyeById.A.state === 'pinned', ms: 7000 },
    { id: 'keep', text: 'Keep holding it until you are across', when: W => W.eyeById.A.state === 'pinned' && W.moverById.span.e > 0.5, until: W => W.player.pos[2] < -9.5, ms: 4000 }
  ],
  failHint: 'Cross first. Only then look at the eye on the far side.'
});

// ---- 04 The Turning Structure ------------------------------------------------------
ENCOUNTERS.push({
  id: 'e04', act: 1, name: 'The Turning Structure',
  cam: { pitch: 58, dist: 38, fov: 40, z0: 6, z1: -20, x0: -3, x1: 3 },
  look: 'act1',
  build(K) {
    const cz = -8;
    K.spawn(0, 8);
    K.floor({ x: 0, z: 3.6, w: 3.2, l: 10.6, etch: 'rungs' });
    K.floor({ x: 0, z: -20, w: 3.2, l: 10.6, etch: 'rungs' });
    K.rotor({ id: 'ring', x: 0, z: cz, mode: 'cont', omega: 0.38, angle: -1.7, signal: S => S.link('X', 'Y'), accel: 0.5, r: 7.2 });
    K.ring({ x: 0, z: cz, r0: 4.3, r1: 7.3, a0: S_ - 0.62, a1: S_ + 0.62, mover: 'ring', etch: 'rungs', lip: true });
    const col = K.pillar({ x: 0, z: cz, r: 3, top: 40, bottom: -80, style: 'core' });
    const x = K.onPillar(0, cz, 3, 6, 0, -0.08);
    K.eye({ id: 'X', type: 'watcher', host: col, pos: x.pos, facing: x.facing, home: { eye: 'Y' }, acquireTime: 2.4, maxDev: 40 * DEG });
    const py = K.pillar({ x: 13.5, z: cz, r: 1.8, top: 34, bottom: -70 });
    const y = K.onPillar(13.5, cz, 1.8, 5.5, W_, -0.05);
    K.eye({ id: 'Y', type: 'watcher', host: py, pos: y.pos, facing: y.facing, home: { sweep: [[3, 0.8, -15.5], [-3, 0.8, -15.5]], period: 5 }, acquireTime: 2.0, maxDev: 70 * DEG });
    const pw = K.pillar({ x: -13, z: cz + 2, r: 1.8, top: 34, bottom: -70 });
    const w = K.onPillar(-13, cz + 2, 1.8, 3.8, 0, -0.2);
    K.eye({ id: 'Wd', type: 'watcher', host: pw, pos: w.pos, facing: w.facing, home: { sweep: [[-6.5, 0.8, cz + 4], [-6.5, 0.8, cz - 4]], period: 6 }, acquireTime: 2.3, fov: 20 * DEG, range: 10, maxDev: 35 * DEG });
    K.block({ x: -2.4, z: -21, w: 9, t: 1.2, yaw: N, y1: 10, mat: 'bone', style: 'jamb' });
    K.block({ x: 2.4, z: -21, w: 9, t: 1.2, yaw: N, y1: 10, mat: 'bone', style: 'jamb' });
    K.tendon({ from: { eye: 'X' }, to: { p: [0, -1, cz] }, sag: 2 });
    K.exit({ x: 0, z: -24.4, yaw: N });
    K.shaft({ x: 0, z: cz, r: 15, depth: 100, rings: 10 });
    K.ribs({ x: 0, z: cz, r: 17, count: 8, h: 28, span: 'crown', thick: 1.2 });
    K.mass({ seed: 41, style: 'towers' });
  },
  hints: [
    { id: 'ride', text: 'While the column watches, the ring turns', focus: 'X', when: W => W.t > 1, until: W => W.player.region && W.player.region.mover === 'ring', ms: 6000 },
    { id: 'stop', text: 'Hold the column eye to stop the ring', when: W => W.player.region && W.player.region.mover === 'ring', until: W => W.player.pos[2] < -15, ms: 5000 }
  ],
  failHint: 'Ride the ring past the left eye, then step off at the far side.'
});

// ---- 10_gfx.js ----
// =====================================================================
// Rendering core: the illustrated material and geometry builders.
//
// Every architectural surface uses one shader idea: light it properly
// (shadows, lamps), then turn darkness into ink. Shadowed and turned-away
// surfaces gather world-anchored hatching whose strokes thicken as light
// falls, a second direction crosses in, and grazing edges draw contours.
// Ink surfaces invert it: light etches pale lines into them.
// =====================================================================
let THREE = null;

const LOOKS = {
  act1: { bg: '#2a2c22', fog: '#4d4e3e', fogD: 0.0105, void: '#1b1c15', key: '#f3e6c8', keyI: 3.2, keyDir: [0.4, 0.8, 0.5], sky: '#a19e78', gnd: '#25221a', hemiI: 1.25, rim: '#c9b98e', haze: '#5c5b43', glow: '#d9b26a' },
  act2: { bg: '#1a1f17', fog: '#33402a', fogD: 0.012, void: '#121710', key: '#d9e0b8', keyI: 2.1, keyDir: [0.5, 0.78, 0.2], sky: '#6f7a4c', gnd: '#10130c', hemiI: 0.85, rim: '#aeb98a', haze: '#3f4a2c', glow: '#c9b064' },
  act3: { bg: '#18140f', fog: '#3a2d1c', fogD: 0.0125, void: '#150f09', key: '#e6c48a', keyI: 2.2, keyDir: [-0.7, 0.55, 0.3], sky: '#7a6440', gnd: '#120e09', hemiI: 0.8, rim: '#d2a75e', haze: '#4a3a24', glow: '#e0a64e' },
  act4: { bg: '#121210', fog: '#2c2c25', fogD: 0.0115, void: '#0d0d0b', key: '#f1ece0', keyI: 2.5, keyDir: [0.15, 0.95, 0.25], sky: '#7d7b6c', gnd: '#0d0d0b', hemiI: 0.75, rim: '#e8e0c8', haze: '#3a3a30', glow: '#e9c27c' }
};

// Material palette: base colour, ink colour, how strongly darkness turns to ink.
const MATS = {
  bone: { c: '#d3c6a4', ink: '#17140f', h: 0.8, freq: 1.6 },
  walk: { c: '#ddd0ae', ink: '#1a1712', h: 0.6, freq: 1.8 },
  olive: { c: '#6e6c3e', ink: '#14140b', h: 0.85, freq: 1.3 },
  moss: { c: '#5d6942', ink: '#11140b', h: 0.85, freq: 1.5 },
  ink: { c: '#2c2a23', ink: '#bfb08a', h: 0.28, freq: 1.2, invert: 1 },
  ochre: { c: '#a8843f', ink: '#1a1208', h: 0.85, freq: 1.8 },
  flesh: { c: '#b8a283', ink: '#2a2316', h: 0.8, freq: 4.0 },
  lid: { c: '#9c8566', ink: '#1e1910', h: 0.75, freq: 5.0 },
  stone: { c: '#a39a80', ink: '#1a1712', h: 0.95, freq: 6.0 },
  coat: { c: '#2a2822', ink: '#9a906f', h: 0.45, freq: 14.0, invert: 1 }
};

// Shared uniforms: occlusion fade around the traveller and the atmosphere.
const GU = {
  uPlayerScr: { value: null }, uPlayerDepth: { value: 30 }, uOccR: { value: 80 },
  uFogColor: { value: null }, uFogD: { value: 0.012 }, uVoid: { value: null }, uTime: { value: 0 },
  uRimColor: { value: null }
};
function initGfx() {
  GU.uPlayerScr.value = new THREE.Vector2(-999, -999);
  GU.uFogColor.value = new THREE.Color('#3a3b2c');
  GU.uVoid.value = new THREE.Color('#0b0c09');
  GU.uRimColor.value = new THREE.Color('#c9b98e');
}
function applyLookUniforms(L) {
  GU.uFogColor.value.set(L.fog); GU.uFogD.value = L.fogD; GU.uVoid.value.set(L.void); GU.uRimColor.value.set(L.rim);
}

const HATCH_VERT_PRE = `
varying vec3 vWPos; varying vec3 vWNrm; varying float vViewZ;
`;
const HATCH_VERT_POST = `
  vec4 hw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vWPos = hw.xyz;
  vec3 hn = objectNormal;
  #ifdef USE_INSTANCING
    hn = mat3(instanceMatrix) * hn;
  #endif
  vWNrm = normalize(mat3(modelMatrix) * hn);
  vViewZ = -mvPosition.z;
`;
const HATCH_FRAG_PRE = `
varying vec3 vWPos; varying vec3 vWNrm; varying float vViewZ;
uniform vec3 uInk; uniform float uHatch; uniform float uFreq; uniform float uInvert; uniform float uEtch; uniform vec3 uEtchC; uniform float uEtchDir;
uniform vec2 uPlayerScr; uniform float uPlayerDepth; uniform float uOccR; uniform float uOcc;
uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uVoid; uniform vec3 uRimColor; uniform float uRim; uniform float uLift; uniform float uTime;
float hLines(float x, float thick) {
  float aa = fwidth(x) * 0.9 + 1e-4;
  float d = abs(fract(x) - 0.5);
  float m = 1.0 - smoothstep(thick * 0.5 - aa, thick * 0.5 + aa, d);
  return mix(m, thick, smoothstep(0.18, 0.5, aa));
}
float hNoise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float b = 0.0;
  if (i < 1.0) b = 0.0; else if (i < 2.0) b = 8.0; else if (i < 3.0) b = 2.0; else if (i < 4.0) b = 10.0;
  else if (i < 5.0) b = 12.0; else if (i < 6.0) b = 4.0; else if (i < 7.0) b = 14.0; else if (i < 8.0) b = 6.0;
  else if (i < 9.0) b = 3.0; else if (i < 10.0) b = 11.0; else if (i < 11.0) b = 1.0; else if (i < 12.0) b = 9.0;
  else if (i < 13.0) b = 15.0; else if (i < 14.0) b = 7.0; else if (i < 15.0) b = 13.0; else b = 5.0;
  return (b + 0.5) / 16.0;
}
`;
const HATCH_FRAG_MAIN = `
  {
    // occlusion: thin anything standing between the camera and the traveller
    if (uOcc > 0.5) {
      float sd = length(gl_FragCoord.xy - uPlayerScr);
      float inFront = step(vViewZ, uPlayerDepth - 2.5);
      float f = inFront * (1.0 - smoothstep(uOccR * 0.55, uOccR, sd));
      if (f > 0.0 && bayer4(gl_FragCoord.xy) < f * 0.82) discard;
    }
    vec3 N = normalize(vWNrm);
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 an = abs(N);
    vec2 uv;
    if (an.y > an.x && an.y > an.z) uv = vWPos.xz; else if (an.x > an.z) uv = vWPos.zy; else uv = vWPos.xy;
    float wob = sin(uv.y * 1.7 + uv.x * 0.6) * 0.18 + sin(uv.x * 0.9 - uv.y * 2.3) * 0.08;
    float c1 = (uv.x * 0.7071 + uv.y * 0.7071) * uFreq + wob;
    float c2 = (uv.x * 0.7071 - uv.y * 0.7071) * uFreq * 1.12 - wob;
        vec3 base = max(diffuseColor.rgb, vec3(0.02));
    float lit = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(dot(base, vec3(0.299, 0.587, 0.114)), 0.03);
    float grain = hNoise(floor(vWPos.xz * 9.0) + floor(vWPos.y * 9.0)) * 0.12;
    float L = clamp(lit + grain - 0.06, 0.0, 2.0);
    float ink = 0.0;
    if (uInvert < 0.5) {
      // strokes: one dominant direction, broken into dashes of varying length
      float li = floor(c1);
      float hsh = fract(sin(li * 91.7 + 3.1) * 4375.85);
      float dash = step(0.22 + 0.25 * hsh, fract(c2 * 0.21 + hsh * 7.0));
      float t1 = mix(0.0, 0.55, smoothstep(0.66, 0.1, L));
      ink = max(ink, hLines(c1, t1) * mix(dash, 1.0, smoothstep(0.35, 0.1, L)));
      ink = max(ink, hLines(c2, mix(0.0, 0.4, smoothstep(0.2, 0.0, L))));
      float rim = 1.0 - abs(dot(N, V));
      ink = max(ink, smoothstep(0.78, 0.95, rim) * uRim);
      // engraved patterns on walkways (the spiral is in the ground you walk)
      if (uEtch > 0.5) {
        vec2 d = vWPos.xz - uEtchC.xz;
        float r = length(d);
        float e = 0.0;
        if (uEtch < 1.5) { float a = atan(d.y, d.x); e = hLines(r * 1.1 + a / 6.2831 * 3.0, 0.07); e = max(e, hLines(r * 0.55, 0.035) * 0.6); }
        else if (uEtch < 2.5) { vec2 dir = vec2(cos(uEtchDir), sin(uEtchDir)); e = hLines(dot(vWPos.xz, dir) * 0.9, 0.08); e = max(e, hLines(dot(vWPos.xz, vec2(-dir.y, dir.x)) * 0.35, 0.03) * 0.5); }
        else { float a = atan(d.y, d.x); e = hLines(a / 6.2831 * 48.0, 0.06) * smoothstep(0.5, 2.0, r); e = max(e, hLines(r * 0.7, 0.05)); }
        ink = max(ink, e * 0.55 * step(0.5, an.y));
      }
      outgoingLight = mix(outgoingLight, uInk * (0.6 + 0.4 * L), clamp(ink * uHatch, 0.0, 1.0));
    } else {
      // ink surfaces: the light engraves pale strokes into them
      float e = max(hLines(c1, mix(0.0, 0.3, smoothstep(0.3, 1.2, L))), hLines(c2, mix(0.0, 0.22, smoothstep(0.8, 1.5, L))));
      float rim = 1.0 - abs(dot(N, V));
      e = max(e, smoothstep(0.78, 0.97, rim) * uRim * 0.6);
      outgoingLight = mix(outgoingLight, uInk * clamp(L, 0.25, 1.1), clamp(e * uHatch, 0.0, 1.0));
    }
    outgoingLight += uRimColor * pow(1.0 - abs(dot(N, V)), 4.0) * 0.05 * uLift;
  }
`;
const HATCH_FOG = `
  {
    float dist = length(vWPos - cameraPosition);
    float f = 1.0 - exp(-pow(dist * uFogD, 1.35));
    float below = clamp(-vWPos.y / 45.0, 0.0, 1.0);
    vec3 fc = mix(uFogColor, uVoid, smoothstep(0.0, 1.0, below));
    f = max(f, smoothstep(0.0, 1.0, below) * 0.85);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(f, 0.0, 1.0));
  }
`;

const _matCache = {};
// opts: { kind, occ (fade in front of traveller), etch: 0..3, etchC, etchDir, side, vc (vertex colours), color }
function hatchMat(kind, opts) {
  opts = opts || {};
  const key = kind + '|' + (opts.occ ? 1 : 0) + '|' + (opts.etch || 0) + '|' + (opts.etchC ? opts.etchC.join(',') : '') + '|' + (opts.etchDir || 0) + '|' + (opts.side || 0) + '|' + (opts.vc ? 1 : 0) + '|' + (opts.color || '') + '|' + (opts.rim === undefined ? '' : opts.rim) + '|' + (opts.emissive || '');
  if (_matCache[key] && !opts.unique) return _matCache[key];
  const M = MATS[kind] || MATS.bone;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color || M.c), vertexColors: !!opts.vc, side: opts.side === 2 ? THREE.DoubleSide : opts.side === 1 ? THREE.BackSide : THREE.FrontSide });
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  const U = {
    uInk: { value: new THREE.Color(M.ink) }, uHatch: { value: M.h }, uFreq: { value: opts.freq || M.freq }, uInvert: { value: M.invert || 0 },
    uEtch: { value: opts.etch || 0 }, uEtchC: { value: new THREE.Vector3().fromArray(opts.etchC || [0, 0, 0]) }, uEtchDir: { value: opts.etchDir || 0 },
    uOcc: { value: opts.occ ? 1 : 0 }, uRim: { value: opts.rim === undefined ? 0.85 : opts.rim }, uLift: { value: 1 }
  };
  mat.userData.U = U;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, GU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + HATCH_VERT_PRE)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + HATCH_VERT_POST);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HATCH_FRAG_PRE)
      .replace('#include <opaque_fragment>', HATCH_FRAG_MAIN + '\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', HATCH_FOG);
  };
  mat.customProgramCacheKey = () => 'hatch';
  if (!opts.unique) _matCache[key] = mat;
  return mat;
}
// Unlit atmospheric material (haze cards, distant massing): fogged flat colour with a soft vertical gradient.
function hazeMat(color, opts) {
  opts = opts || {};
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uC: { value: new THREE.Color(color) }, uA: { value: opts.alpha === undefined ? 1 : opts.alpha } }, GU),
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); #ifdef USE_INSTANCING\n w = modelMatrix * instanceMatrix * vec4(position,1.0);\n#endif\n vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }'.replace(' #ifdef', '\n#ifdef'),
    fragmentShader: `uniform vec3 uC; uniform float uA; uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uVoid; varying vec3 vW;
      void main(){ float dist = length(vW - cameraPosition); float f = 1.0 - exp(-pow(dist * uFogD, 1.25));
        float below = clamp(-vW.y / 60.0, 0.0, 1.0); vec3 fc = mix(uFogColor, uVoid, below);
        vec3 c = mix(uC, fc, clamp(f * 0.92 + below * 0.5, 0.0, 1.0)); gl_FragColor = vec4(c, uA);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    transparent: opts.alpha !== undefined && opts.alpha < 1, depthWrite: opts.depthWrite !== false, side: opts.side || THREE.FrontSide
  });
}
function glowMat(color, opts) {
  opts = opts || {};
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: opts.opacity === undefined ? 1 : opts.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: opts.side || THREE.FrontSide, fog: false });
}

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------
// Sweep a closed 2D profile (array of [x,y]) along a path of THREE.Vector3.
// scale(t) scales the profile along the path; returns BufferGeometry with AO-ish vertex colours.
function sweepGeo(path, profile, scale, opts) {
  opts = opts || {};
  const n = path.length, m = profile.length;
  const pos = [], nrm = [], col = [], idx = [];
  const T = [], Nn = [], Bn = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // parallel transport frames
  let up = opts.up ? opts.up.clone() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].dot(up)) > 0.95) up = new THREE.Vector3(1, 0, 0);
  let N0 = new THREE.Vector3().crossVectors(T[0], up).normalize();
  let B0 = new THREE.Vector3().crossVectors(N0, T[0]).normalize();
  Nn.push(N0); Bn.push(B0);
  for (let i = 1; i < n; i++) {
    const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    let Ni = Nn[i - 1].clone();
    if (axis.length() > 1e-6) { axis.normalize(); const ang = Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)); Ni.applyAxisAngle(axis, ang); }
    Nn.push(Ni); Bn.push(new THREE.Vector3().crossVectors(Ni, T[i]).normalize());
  }
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0, s = scale ? scale(t, i) : 1;
    const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s;
    for (let j = 0; j < m; j++) {
      const px = profile[j][0] * sx, py = profile[j][1] * sy;
      const v = path[i].clone().addScaledVector(Nn[i], px).addScaledVector(Bn[i], py);
      pos.push(v.x, v.y, v.z);
      const nn = Nn[i].clone().multiplyScalar(px).addScaledVector(Bn[i], py).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      const ao = opts.ao ? opts.ao(t, j / m, v) : 1;
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  if (opts.recompute !== false) g.computeVertexNormals();
  return g;
}
function circleProfile(r, n, ridges, ridgeAmt, flatten) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    const rr = r * (1 + (ridges ? Math.pow(Math.abs(Math.cos(a * ridges / 2)), 6) * ridgeAmt : 0));
    out.push([Math.cos(a) * rr, Math.sin(a) * rr * (flatten || 1)]);
  }
  return out;
}

// A revolved column: profile(t) gives radius multiplier along height, flutes carve the surface.
function columnGeo(r, y0, y1, o) {
  o = o || {};
  const radial = o.radial || 28, rows = o.rows || Math.max(8, Math.min(70, Math.round((y1 - y0) / 1.2)));
  const flutes = o.flutes === undefined ? 12 : o.flutes, fd = o.fluteDepth === undefined ? 0.08 : o.fluteDepth;
  const rng = makeRng(o.seed || 3);
  const bands = [];
  for (let i = 0; i < (o.bands || 4); i++) bands.push(rng.range(0.1, 0.95));
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = lerp(y0, y1, t);
    let pr = o.profile ? o.profile(t, y) : 1;
    for (const b of bands) { const d = (t - b) * (y1 - y0); pr += 0.13 * Math.exp(-d * d / 0.35) - 0.05 * Math.exp(-d * d / 3); }
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      const fl = flutes ? Math.pow(Math.abs(Math.cos(a * flutes / 2)), 0.6) : 1;
      const twist = o.twist ? Math.sin(t * 7 + a * 3) * o.twist : 0;
      const rr = r * pr * (1 - fd + fd * fl + twist);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const ao = (0.55 + 0.45 * fl) * (0.7 + 0.3 * smooth((y - y0) / Math.max(1, (y1 - y0) * 0.25)));
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Annular sector slab: top at y, thickness down. ridges on the underside are separate.
function arcSlabGeo(r0, r1, a0, a1, y, thick, o) {
  o = o || {};
  const span = a1 - a0, segs = Math.max(6, Math.ceil(Math.abs(span) * Math.max(r1, 2) / 1.0));
  const pos = [], col = [], idx = [];
  const bev = Math.min(0.25, thick * 0.3);
  // cross-section (r, y) loop: top inner -> top outer -> outer side -> bottom outer -> bottom inner -> inner side
  const sec = [];
  if (r0 > 0.01) sec.push([r0 + bev, y], [r1 - bev, y], [r1, y - bev], [r1 - bev * 0.5, y - thick], [r0 + bev * 0.5, y - thick], [r0, y - bev]);
  else sec.push([0, y], [r1 - bev, y], [r1, y - bev], [r1 * 0.96, y - thick], [0, y - thick]);
  const ns = sec.length, closed = r0 > 0.01;
  for (let i = 0; i <= segs; i++) {
    const a = a0 + span * i / segs, c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < ns; k++) {
      // duplicate verts per facet edge for crisp normals: emit each section point twice
      const p = sec[k];
      pos.push(c * p[0], p[1], s * p[0]); const ao = p[1] < y - 0.01 ? 0.55 : 1; col.push(ao, ao, ao);
    }
  }
  const nk = closed ? ns : ns - 1;
  for (let i = 0; i < segs; i++) for (let k = 0; k < nk; k++) {
    const a = i * ns + k, b = i * ns + (k + 1) % ns, c2 = (i + 1) * ns + k, d = (i + 1) * ns + (k + 1) % ns;
    idx.push(a, c2, b, b, c2, d);
  }
  // end caps for partial arcs
  if (Math.abs(span) < TAU - 1e-3) {
    for (const end of [0, segs]) {
      const base = end * ns;
      for (let k = 1; k < ns - 1; k++) { if (end === 0) idx.push(base, base + k, base + k + 1); else idx.push(base, base + k + 1, base + k); }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}
// Rectangular slab with bevelled top edge; centred, length along local +x... we build along z and rotate.
function slabGeo(w, l, thick, rise) {
  const g = new THREE.BoxGeometry(w, thick, l, Math.max(1, Math.round(w / 1.5)), 1, Math.max(1, Math.round(l / 1.5)));
  g.translate(0, -thick / 2, 0);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    const ao = y < -0.01 ? 0.55 : 1; col.push(ao, ao, ao);
    if (rise) { const t = (p.getZ(i) / l) + 0.5; p.setY(i, y + rise * t); }
    // chamfer the top edges a touch
    if (y > -0.01) { const ex = Math.abs(p.getX(i)) > w / 2 - 0.01, ez = Math.abs(p.getZ(i)) > l / 2 - 0.01; if (ex || ez) p.setY(i, p.getY(i) - 0.12); }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Tapered keel hanging beneath a slab: a box whose bottom shrinks and sags.
function keelGeo(w, l, depth, seed) {
  const g = new THREE.BoxGeometry(w * 0.86, depth, l * 0.92, 2, 4, Math.max(2, Math.round(l / 2)));
  g.translate(0, -depth / 2, 0);
  const p = g.attributes.position, rng = makeRng(seed || 5), col = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = clamp01(-y / depth);
    const k = 1 - 0.85 * Math.pow(t, 0.8);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * (1 - 0.35 * t));
    p.setY(i, y - Math.sin(p.getZ(i) * 0.7 + seed) * 0.4 * t);
    const ao = 0.5 * (1 - t) + 0.15; col.push(ao, ao, ao);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Merge BufferGeometries that share attributes position/normal/color (non-indexed output).
function mergeGeos(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nrm.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3); else col.fill(1, o * 3, (o + n) * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function ensureColor(g, v) {
  if (g.attributes.color) return g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(v === undefined ? 1 : v);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function bakeXf(g, x, y, z, ry, sx, sy, sz, rx, rz) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')), new THREE.Vector3(sx || 1, sy || sx || 1, sz || sx || 1));
  g.applyMatrix4(m); return g;
}
// three's rotation.y for a simulation yaw (atan2(z, x) convention)
const threeYaw = yaw => -yaw;

// ---- 11_world.js ----
// =====================================================================
// World view: turns the encounter's visual descriptors into geometry.
// Static pieces are merged per material; rotor pieces ride a group that
// follows the simulation's angle; bridges and gates animate from sim e.
// =====================================================================

function buildWorldView(W, look, quality) {
  const root = new THREE.Group();
  const statics = new Map();      // material -> [geometry in world space]
  const rotorBuckets = {};        // rotor id -> Map(material -> geos)
  const rotors = {}, bridges = {}, gates = {}, tendons = [], portals = [], zones = {}, lamps = [], dyn = [];
  const castOK = quality > 0;
  const rng = makeRng(17 + (W.def.id ? W.def.id.charCodeAt(2) * 31 : 0));

  const bucketFor = mover => {
    if (!mover) return statics;
    if (!rotorBuckets[mover]) rotorBuckets[mover] = new Map();
    return rotorBuckets[mover];
  };
  // geometry is given in world space; rotor pieces are re-expressed around the pivot
  const put = (geo, mat, mover) => {
    if (mover) { const m = W.moverById[mover]; geo.translate(-m.pivot[0], 0, -m.pivot[1]); }
    ensureColor(geo);
    const b = bucketFor(mover); if (!b.has(mat)) b.set(mat, []); b.get(mat).push(geo);
  };

  for (const v of W.visuals) {
    const t = v.type;
    if (t === 'slab') buildSlab(v);
    else if (t === 'pillar') buildPillar(v);
    else if (t === 'wall') buildWall(v);
    else if (t === 'block') buildBlock(v);
    else if (t === 'gate') buildGate(v);
    else if (t === 'bridge') buildBridge(v);
    else if (t === 'rotor') buildRotor(v);
    else if (t === 'ribs') buildRibs(v);
    else if (t === 'shaft') buildShaft(v);
    else if (t === 'mass') buildMass(v);
    else if (t === 'roots') buildRoots(v);
    else if (t === 'lamp') buildLamp(v);
    else if (t === 'portal') buildPortal(v);
    else if (t === 'entry') buildEntry(v);
    else if (t === 'zone') buildZone(v);
    else if (t === 'rail') buildRail(v);
  }
  // tendons last: they need eye and mover positions
  for (const v of W.visuals) if (v.type === 'tendon') buildTendon(v);

  // flush buckets into meshes
  const flush = (bucket, parent, cast) => {
    for (const [mat, geos] of bucket) {
      const g = mergeGeos(geos);
      for (const q of geos) q.dispose();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast && castOK; mesh.receiveShadow = castOK;
      parent.add(mesh);
    }
  };
  flush(statics, root, true);
  for (const id in rotorBuckets) { const r = rotors[id]; flush(rotorBuckets[id], r ? r.group : root, true); }

  // ---------------------------------------------------------------------
  function walkMat(v) {
    if (v.mat !== 'bone' && v.mat !== 'walk') return hatchMat(v.mat, { vc: true, occ: false });
    const etch = v.etch === 'spiral' ? 1 : v.etch === 'rungs' ? 2 : v.etch === 'radial' ? 3 : 0;
    return hatchMat('walk', { vc: true, etch, etchC: [v.x, 0, v.z], etchDir: v.yaw || 0 });
  }
  function buildSlab(v) {
    if (v.shape === 'rect') {
      const rise = v.y2 !== undefined && v.y2 !== null ? v.y2 - v.y : 0;
      const g = slabGeo(v.w, v.l, v.thick, rise);
      bakeXf(g, v.x, v.y, v.z, Math.PI / 2 - v.yaw);
      put(g, walkMat(v), v.mover);
      if (v.keel) {
        const depth = Math.min(9, 2 + v.l * 0.35);
        const k = keelGeo(v.w, v.l, depth, rng() * 10);
        bakeXf(k, v.x, v.y - v.thick + 0.05 + rise / 2, v.z, Math.PI / 2 - v.yaw);
        put(k, hatchMat('ink', { vc: true }), v.mover);
        // transverse vertebral ribs hanging under longer spans
        const n = Math.floor(v.l / 2.2);
        const parts = [];
        for (let i = 0; i < n; i++) {
          const u = -v.l / 2 + (i + 0.5) * v.l / n;
          const pts = [];
          for (let k2 = 0; k2 <= 10; k2++) { const a = Math.PI * k2 / 10; pts.push(new THREE.Vector3(Math.cos(a) * v.w * 0.55, -v.thick - Math.sin(a) * (0.6 + v.w * 0.35), u)); }
          parts.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - 0.5 * Math.abs(t - 0.5)));
        }
        if (parts.length) { const g2 = mergeGeos(parts); bakeXf(g2, v.x, v.y + rise / 2, v.z, Math.PI / 2 - v.yaw); put(g2, hatchMat('olive', { vc: true }), v.mover); }
      }
    } else {
      const g = arcSlabGeo(v.r0, v.r1, v.a0, v.a1, 0, v.thick);
      g.translate(v.x, v.y, v.z);
      put(g, walkMat(v), v.mover);
      if (v.keel) {
        if (v.r0 < 0.01 && v.a1 - v.a0 > TAU - 0.01) {
          const d = v.r1 * 1.1 + 2;
          const prof = [];
          for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.max(0.15, v.r1 * 0.97 * Math.pow(1 - t, 0.75)), -v.thick - t * d)); }
          const lg = new THREE.LatheGeometry(prof, 36);
          lg.translate(v.x, v.y, v.z); put(lg, hatchMat('ink', { vc: false }), v.mover);
          // radial fins
          const fins = [];
          const nf = Math.max(6, Math.round(v.r1 * 1.4));
          for (let i = 0; i < nf; i++) {
            const a = i / nf * TAU, pts = [];
            for (let k = 0; k <= 8; k++) { const t = k / 8; const rr = v.r1 * 1.0 * Math.pow(1 - t, 0.8); pts.push(new THREE.Vector3(Math.cos(a) * rr, -v.thick - t * d * 0.98 + 0.2, Math.sin(a) * rr)); }
            fins.push(sweepGeo(pts, [[0, 0.35], [0.12, 0], [0, -0.35], [-0.12, 0]], t => 1 - t * 0.7));
          }
          const fg = mergeGeos(fins); fg.translate(v.x, v.y, v.z); put(fg, hatchMat('olive', { vc: true }), v.mover);
        } else {
          const rm = (v.r1 - v.r0);
          const g2 = arcSlabGeo(v.r0 + rm * 0.18, v.r1 - rm * 0.18, v.a0 + 0.02, v.a1 - 0.02, 0, Math.min(6, rm * 1.2 + 1));
          g2.translate(v.x, v.y - v.thick + 0.02, v.z); put(g2, hatchMat('ink', { vc: true }), v.mover);
        }
      }
      if (v.lip) {
        const g3 = arcSlabGeo(v.r1 - 0.35, v.r1, v.a0, v.a1, 0, 0.6);
        g3.translate(v.x, v.y + 0.45, v.z); put(g3, hatchMat('bone', { vc: true }), v.mover);
      }
    }
  }
  function pillarProfile(style) {
    if (style === 'core') return t => 1 + 0.12 * Math.exp(-Math.pow((t - 0.62) * 9, 2)) + 0.25 * Math.pow(Math.max(0, t - 0.92) / 0.08, 2);
    if (style === 'knotted') return t => 1 + 0.18 * Math.sin(t * 23) * Math.sin(t * 7 + 1);
    if (style === 'tendon') return t => 0.9 + 0.1 * Math.sin(t * 40);
    return t => 1 + 0.35 * Math.pow(Math.max(0, t - 0.9) / 0.1, 2) - 0.05 * Math.sin(t * Math.PI);
  }
  function buildPillar(v) {
    const style = v.style;
    const g = columnGeo(v.r, v.bottom, v.top, { flutes: style === 'core' ? 22 : style === 'tendon' ? 7 : 14, fluteDepth: style === 'core' ? 0.14 : style === 'tendon' ? 0.22 : 0.09, profile: pillarProfile(style), seed: v.seed, bands: style === 'core' ? 7 : 4, twist: style === 'tendon' ? 0.06 : 0 });
    g.translate(v.x, 0, v.z);
    put(g, hatchMat(v.mat || 'bone', { vc: true, occ: true }), v.mover);
    // a cap that frays into ribs: reads as continuing upward into the dark
    if (v.cap !== false) {
      const parts = [];
      const n = style === 'core' ? 8 : 5;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + v.seed, pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8; const rr = v.r * (1.2 + t * 1.6); pts.push(new THREE.Vector3(Math.cos(a + t * 0.4) * rr, v.top - 0.5 + t * 4.5, Math.sin(a + t * 0.4) * rr)); }
        parts.push(sweepGeo(pts, circleProfile(v.r * 0.18, 6), t => 1 - t * 0.85));
      }
      const cg = mergeGeos(parts); cg.translate(v.x, 0, v.z);
      put(cg, hatchMat(v.mat || 'bone', { vc: true, occ: true }), v.mover);
    }
  }
  function buildWall(v) {
    const h = v.y1 - v.y0;
    const g = arcSlabGeo(v.r0, v.r1, v.a0, v.a1, v.y1, h);
    g.translate(v.x, 0, v.z);
    const mat = hatchMat(v.mat, { vc: true, occ: true });
    put(g, mat, v.mover);
    const span = v.a1 - v.a0;
    if (v.style === 'parapet') {
      // a coping of bone along the low near wall
      const c = arcSlabGeo(v.r0 - 0.15, v.r1 + 0.1, v.a0, v.a1, v.y1 + 0.35, 0.45); c.translate(v.x, 0, v.z);
      put(c, hatchMat('bone', { vc: true }), v.mover);
      return;
    }
    // pilasters: half columns on the inner face
    const n = Math.max(2, Math.round(Math.abs(span) * v.r0 / 3.2));
    const parts = [];
    for (let i = 0; i <= n; i++) {
      const a = v.a0 + span * i / n;
      const pr = 0.55 + (i % 3 === 0 ? 0.25 : 0);
      const col = columnGeo(pr, v.y0, v.y1 + (i % 3 === 0 ? 6 : 1), { flutes: 6, fluteDepth: 0.2, radial: 10, rows: 24, seed: i + v.seed, bands: 3 });
      col.translate(Math.cos(a) * (v.r0 + 0.1), 0, Math.sin(a) * (v.r0 + 0.1));
      parts.push(col);
    }
    // a ledge band at walking height and a high cornice
    const ledge = arcSlabGeo(v.r0 - 0.45, v.r0 + 0.05, v.a0, v.a1, 2.6, 0.5);
    const cor = arcSlabGeo(v.r0 - 0.9, v.r0 + 0.05, v.a0, v.a1, Math.min(v.y1 - 2, 14), 1.1);
    parts.push(ledge, cor);
    const g2 = mergeGeos(parts); g2.translate(v.x, 0, v.z);
    put(g2, hatchMat('bone', { vc: true, occ: true }), v.mover);
  }
  function buildBlock(v) {
    const h = v.y1 - v.y0;
    const g = new THREE.BoxGeometry(v.t, h, v.w, 1, Math.max(1, Math.round(h / 2)), Math.max(1, Math.round(v.w / 2)));
    // BoxGeometry depth runs along local z; we want length along yaw
    bakeXf(g, v.x, v.y0 + h / 2, v.z, Math.PI / 2 - v.yaw);
    const mat = hatchMat(v.mat, { vc: true, occ: true });
    put(ensureColor(g, 0.9), mat, v.mover);
    const parts = [];
    if (v.style === 'colonnade' || v.style === 'jamb') {
      const n = Math.max(1, Math.round(v.w / (v.style === 'jamb' ? 3.5 : 3)));
      for (let i = 0; i <= n; i++) {
        const u = -v.w / 2 + v.w * i / n;
        for (const side of [-1, 1]) {
          const c = columnGeo(0.45, v.y0, v.y1 + 1.2, { flutes: 8, fluteDepth: 0.15, radial: 12, rows: 20, seed: i * 3 + side, bands: 3 });
          c.translate(side * (v.t / 2 + 0.05), 0, u);
          parts.push(c);
        }
      }
      const cap = new THREE.BoxGeometry(v.t + 1.2, 0.8, v.w + 0.6); cap.translate(0, v.y1 + 0.4, 0); parts.push(ensureColor(cap, 1));
    } else if (v.style === 'screen') {
      const n = Math.max(2, Math.round(v.w / 0.9));
      for (let i = 0; i < n; i++) { const u = -v.w / 2 + (i + 0.5) * v.w / n; const s = new THREE.BoxGeometry(v.t + 0.3, h + 2, 0.35); s.translate(0, v.y0 + h / 2 + 1, u); parts.push(ensureColor(s, 0.8)); }
    } else {
      const ridge = new THREE.BoxGeometry(v.t + 0.5, 0.6, v.w + 0.4); ridge.translate(0, v.y1 + 0.3, 0); parts.push(ensureColor(ridge, 1));
    }
    if (parts.length) { const g2 = mergeGeos(parts); bakeXf(g2, v.x, 0, v.z, Math.PI / 2 - v.yaw); put(g2, hatchMat('bone', { vc: true, occ: true }), v.mover); }
  }

  // --- iris: petals that swing open about the rim (used by gates and portals) ---
  function makeIris(R, n, mat, thick) {
    const grp = new THREE.Group(), petals = [];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 1.35) / n * TAU;
      const sh = new THREE.Shape();
      const p0 = [Math.cos(a0) * R, Math.sin(a0) * R];
      sh.moveTo(0, 0);
      const steps = 6;
      for (let k = 0; k <= steps; k++) { const a = lerp(a0, a1, k / steps); sh.lineTo(Math.cos(a) * R * 1.02 - p0[0], Math.sin(a) * R * 1.02 - p0[1]); }
      sh.quadraticCurveTo(-p0[0] * 0.4, -p0[1] * 0.4 + 0.2, -p0[0], -p0[1]);
      sh.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: thick || 0.18, bevelEnabled: false, curveSegments: 4 });
      g.translate(0, 0, -((thick || 0.18) / 2) + (i % 2) * 0.02);
      const piv = new THREE.Group(); piv.position.set(p0[0], p0[1], 0);
      const m = new THREE.Mesh(g, mat); m.castShadow = castOK; m.receiveShadow = castOK;
      piv.add(m); grp.add(piv); petals.push(piv);
    }
    grp.userData.set = e => { const a = easeInOut(e) * 1.18; for (const p of petals) p.rotation.z = a; };
    return grp;
  }
  function frameRing(R, w, depth, mat) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0)); }
    const g = sweepGeo(pts, [[-w * 0.3, -depth], [w, -depth * 0.8], [w * 1.1, 0], [w, depth * 0.8], [-w * 0.3, depth]], null, { up: new THREE.Vector3(0, 0, 1) });
    return new THREE.Mesh(g, mat);
  }
  function buildGate(v) {
    const R = Math.max(v.w / 2, v.h / 2) * 1.02;
    const grp = new THREE.Group();
    grp.position.set(v.x, v.y + R * 0.92, v.z);
    // the iris plane holds the gate's length axis (yaw) and up
    grp.rotation.y = Math.PI / 2 - v.yaw + Math.PI / 2;
    const iris = makeIris(R, 9, hatchMat(v.mat || 'ochre', { vc: false }), 0.22);
    grp.add(iris);
    const fr = frameRing(R, 1.1, 0.7, hatchMat('bone', { vc: true }));
    fr.castShadow = castOK; grp.add(fr);
    const ring2 = frameRing(R + 1.3, 0.5, 0.45, hatchMat('ink', { vc: true }));
    grp.add(ring2);
    // footing so the frame meets the floor
    const foot = new THREE.Mesh(ensureColor(new THREE.BoxGeometry(2 * R + 1.5, 1.2, 1.4)), hatchMat('bone', { vc: true }));
    foot.position.set(0, -R * 0.92 - 0.2, 0); grp.add(foot);
    root.add(grp);
    gates[v.id] = { grp, iris, R, v };
  }
  function buildBridge(v) {
    const s = 1.15, n = Math.ceil(v.len / s) + 1;
    const parts = [];
    // a vertebra: centrum slab, transverse processes, a keel spine
    const cen = new THREE.BoxGeometry(v.w * 0.92, 0.5, s * 0.82, 2, 1, 2); cen.translate(0, -0.25, 0); parts.push(ensureColor(cen, 1));
    for (const side of [-1, 1]) {
      const pts = [new THREE.Vector3(side * v.w * 0.42, -0.3, 0), new THREE.Vector3(side * v.w * 0.75, -0.55, 0.1), new THREE.Vector3(side * v.w * 0.95, -1.1, 0.25)];
      parts.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - t * 0.6));
    }
    const spine = [new THREE.Vector3(0, -0.4, -s * 0.2), new THREE.Vector3(0, -1.3, 0), new THREE.Vector3(0, -2.2, s * 0.25)];
    parts.push(sweepGeo(spine, [[0, 0.35], [0.12, 0], [0, -0.35], [-0.12, 0]], t => 1 - t * 0.8));
    const vg = mergeGeos(parts);
    const inst = new THREE.InstancedMesh(vg, hatchMat(v.mat || 'bone', { vc: true }), n);
    inst.castShadow = castOK; inst.receiveShadow = castOK;
    inst.frustumCulled = false;
    root.add(inst);
    // the anchor knuckle
    const kn = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(v.w * 0.75, 16, 10)), hatchMat('bone', { vc: true }));
    kn.scale.set(1, 0.55, 1); kn.position.set(v.ax, v.y - 0.6, v.az); kn.castShadow = castOK; root.add(kn);
    bridges[v.id] = { inst, n, s, v, m: new THREE.Matrix4(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - v.yaw, 0)), lastE: -1 };
  }
  function buildRotor(v) {
    const grp = new THREE.Group(); grp.position.set(v.x, 0, v.z);
    root.add(grp);
    rotors[v.id] = { grp, group: grp, v };
    if (v.hub !== false) {
      // a toothed collar under the turning ring: shows that it turns
      const parts = [];
      const n = 28;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; const b = new THREE.BoxGeometry(0.5, 1.2, 0.9); b.translate(0, -2.2, v.r * 0.62); b.rotateY(a); parts.push(ensureColor(b, 0.7)); }
      const g = mergeGeos(parts);
      const m = new THREE.Mesh(g, hatchMat('ink', { vc: true })); grp.add(m);
    }
  }
  function buildRibs(v) {
    const parts = [];
    const prof = circleProfile(1, 12, 4, 0.35, 0.6);
    const th = v.thick || 1;
    const n = v.count || 6;
    for (let i = 0; i < n; i++) {
      const pts = [];
      if (v.span === 'vault') {
        const z = lerp(v.z0, v.z1, n > 1 ? i / (n - 1) : 0.5);
        for (let k = 0; k <= 24; k++) { const a = Math.PI * k / 24; pts.push(new THREE.Vector3(v.x + Math.cos(a) * v.r * 1.05, -12 + Math.sin(a) * (v.h + 12), z + Math.sin(a * 2) * 0.4)); }
      } else if (v.span === 'crown') {
        const a = lerp(v.a0 === undefined ? Math.PI * 1.05 : v.a0, v.a1 === undefined ? Math.PI * 1.95 : v.a1, n > 1 ? i / (n - 1) : 0.5);
        for (let k = 0; k <= 20; k++) { const t = k / 20; const rr = v.r * (1 - 0.55 * Math.sin(t * Math.PI * 0.5)); pts.push(new THREE.Vector3(v.x + Math.cos(a + t * 0.25) * rr, -18 + t * (v.h + 18), v.z + Math.sin(a + t * 0.25) * rr)); }
      } else { // 'over': half arches rising from the far rim and leaning over the chamber
        const a = lerp(v.a0 === undefined ? Math.PI * 1.1 : v.a0, v.a1 === undefined ? Math.PI * 1.9 : v.a1, n > 1 ? i / (n - 1) : 0.5);
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let k = 0; k <= 24; k++) { const t = k / 24; const rr = v.r * (1 - 0.62 * Math.sin(t * Math.PI * 0.5)); const y = -16 + (v.h + 16) * Math.sin(t * Math.PI * 0.5); pts.push(new THREE.Vector3(v.x + ca * rr, y, v.z + sa * rr)); }
      }
      parts.push(sweepGeo(pts, prof, t => th * (1.25 - 0.35 * Math.sin(t * Math.PI)), { ao: (t) => 0.6 + 0.4 * Math.sin(t * Math.PI) }));
    }
    put(mergeGeos(parts), hatchMat(v.mat || 'bone', { vc: true, occ: true }), null);
  }
  function buildShaft(v) {
    const parts = [];
    const rings = v.rings || 7;
    for (let k = 1; k <= rings; k++) {
      const y = -5 - k * (v.depth / rings) * 0.75, r = v.r * (1 - k * 0.035);
      const g = arcSlabGeo(r, r + 1.6 + k * 0.2, 0, TAU, y, 1.2); parts.push(g);
    }
    const nr = Math.round(v.r * 1.3);
    for (let i = 0; i < nr; i++) {
      const a = i / nr * TAU, pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12; const rr = v.r + 1.3 + Math.sin(t * 9 + i) * 0.3; pts.push(new THREE.Vector3(Math.cos(a) * rr, -3 - t * v.depth, Math.sin(a) * rr)); }
      parts.push(sweepGeo(pts, circleProfile(0.45, 6, 3, 0.4), null));
    }
    const g = mergeGeos(parts); g.translate(v.x, 0, v.z);
    put(g, hatchMat('ink', { vc: true }), null);
  }
  function buildMass(v) {
    // Distant architecture in the haze: towers, arches, spiral ramps, impossible stairs.
    const r = makeRng(v.seed || 5);
    const parts = [], far = [];
    const style = v.style || 'towers';
    const nT = style === 'towers' ? 14 : 9;
    for (let i = 0; i < nT; i++) {
      const a = r.range(0, TAU), d = r.range(55, 140);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 20;
      const rr = r.range(4, 13), top = r.range(40, 140);
      const g = columnGeo(rr, -120, top, { flutes: r.int(6, 16), fluteDepth: 0.12, radial: 16, rows: 26, seed: r.int(1, 99), bands: 5, profile: t => 1 + 0.3 * Math.pow(Math.max(0, t - 0.85) / 0.15, 2) });
      g.translate(x, 0, z); (d > 100 ? far : parts).push(g);
    }
    // great arches spanning the void
    const nA = style === 'arches' ? 6 : 3;
    for (let i = 0; i < nA; i++) {
      const a = r.range(0, TAU), d = r.range(60, 120), span = r.range(30, 70), h = r.range(30, 80);
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, dir = r.range(0, TAU);
      const pts = [];
      for (let k = 0; k <= 24; k++) { const u = k / 24 * 2 - 1; pts.push(new THREE.Vector3(cx + Math.cos(dir) * u * span, -60 + (h + 60) * Math.sqrt(1 - u * u), cz + Math.sin(dir) * u * span)); }
      far.push(sweepGeo(pts, circleProfile(1, 10, 4, 0.4, 0.7), () => r.range(2.2, 3.5)));
    }
    // a spiral ramp coiling around a void
    {
      const a = r.range(0, TAU), d = r.range(70, 110), cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, R = r.range(14, 24);
      const pts = [];
      for (let k = 0; k <= 90; k++) { const t = k / 90; const ang = t * TAU * 3.2; pts.push(new THREE.Vector3(cx + Math.cos(ang) * R * (1 - t * 0.35), -70 + t * 130, cz + Math.sin(ang) * R * (1 - t * 0.35))); }
      far.push(sweepGeo(pts, [[-3, 0.6], [3, 0.6], [3, -0.6], [-3, -0.6]], null));
    }
    // floating impossible stairs
    for (let i = 0; i < 4; i++) {
      const a = r.range(0, TAU), d = r.range(45, 90), cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, y0 = r.range(-10, 40), dir = r.int(0, 3) * Math.PI / 2;
      for (let k = 0; k < 14; k++) {
        const b = new THREE.BoxGeometry(5, 1, 1.8); b.translate(0, k * 0.9, k * 1.6); b.rotateY(dir); b.translate(cx, y0, cz); parts.push(b);
      }
      const side = new THREE.BoxGeometry(0.8, 2, 24); side.rotateX(-Math.atan2(0.9, 1.6)); side.translate(2.8, y0 + 5.5, 10.5); side.rotateY(dir); side.translate(cx, 0, cz); parts.push(side);
    }
    const L = LOOKS[W.def.look] || LOOKS.act1;
    if (parts.length) { const g = mergeGeos(parts); root.add(new THREE.Mesh(g, hazeMat(L.haze))); }
    if (far.length) { const g = mergeGeos(far); root.add(new THREE.Mesh(g, hazeMat(new THREE.Color(L.haze).lerp(new THREE.Color(L.fog), 0.35).getStyle()))); }
  }
  function buildRoots(v) {
    const parts = [];
    const n = v.n || 8, r = makeRng((v.x * 13 + v.z * 7 + 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = r.range(Math.PI * 1.05, Math.PI * 1.95), rr = v.r * r.range(0.85, 1.1);
      const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
      const pts = [], len = r.range(25, 55), sw = r.range(-2, 2);
      for (let k = 0; k <= 14; k++) { const t = k / 14; pts.push(new THREE.Vector3(x + Math.sin(t * 5 + i) * 0.6 + sw * t, (v.top || 30) - t * len, z + Math.cos(t * 4 + i) * 0.6)); }
      parts.push(sweepGeo(pts, circleProfile(0.32, 6, 2, 0.3), t => 1 - t * 0.85));
    }
    put(mergeGeos(parts), hatchMat('moss', { vc: true, occ: true }), null);
  }
  function buildLamp(v) {
    const l = new THREE.PointLight(new THREE.Color(v.color || '#d9b26a'), (v.intensity || 0.6) * 30, v.dist || 18, 1.6);
    l.position.set(v.x, v.y, v.z); root.add(l); lamps.push(l);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), glowMat(v.color || '#d9b26a', { opacity: 0.9 }));
    s.position.copy(l.position); root.add(s);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), glowMat(v.color || '#d9b26a', { opacity: 0.08 }));
    halo.position.copy(l.position); root.add(halo);
  }
  function buildPortal(v) {
    const R = v.size || 3.2;
    const grp = new THREE.Group();
    const d = dirYP(v.yaw, 0);
    grp.position.set(v.x + d[0] * 1.6, v.y + R * 0.95, v.z + d[2] * 1.6);
    grp.rotation.y = Math.PI / 2 - v.yaw; // ring plane faces along yaw (the way through)
    const fr = frameRing(R, 1.3, 1.0, hatchMat('bone', { vc: true })); fr.castShadow = castOK; grp.add(fr);
    // receding rings: a tunnel of irises
    for (let k = 1; k <= 5; k++) { const rr = frameRing(R * (1 - k * 0.1), 0.5, 0.3, hatchMat('ink', { vc: true })); rr.position.z = k * 1.6; grp.add(rr); }
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#efe6cf'), transparent: true, opacity: 0.0, fog: false }));
    glow.position.z = 0.5; grp.add(glow);
    const deep = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 32), glowMat('#fff3d6', { opacity: 0.0 }));
    deep.position.z = 6; grp.add(deep);
    const iris = makeIris(R * 0.98, 11, hatchMat('ochre', {}), 0.2); iris.position.z = 0.15; grp.add(iris);
    // massive surround: the portal is set in a wall of ribs
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.1 + 0.8 * i / 8), pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; const rr = R + 1.4 + t * 6; pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr - R * 0.2 - t * 2, -0.5 - t * 1.5)); }
      parts.push(sweepGeo(pts, circleProfile(0.55, 7, 3, 0.3), t => 1 - t * 0.6));
    }
    const sg = mergeGeos(parts); const sm = new THREE.Mesh(sg, hatchMat('bone', { vc: true, occ: true })); sm.castShadow = castOK; grp.add(sm);
    const light = new THREE.PointLight(new THREE.Color('#f3e2b8'), 0, 14, 1.5); light.position.set(0, 0, -2); grp.add(light);
    root.add(grp);
    portals.push({ grp, glow, deep, iris, light, v, open: 0 });
  }
  function buildEntry(v) {
    // a short landing under the entry so the traveller never appears from nowhere
    const d = dirYP(v.yaw, 0);
    const g = slabGeo(3.2, 3.4, 1.0, 0); bakeXf(g, v.x - d[0] * 1.7, v.y, v.z - d[2] * 1.7, Math.PI / 2 - v.yaw);
    put(g, hatchMat('walk', { vc: true }), null);
  }
  function buildZone(v) {
    const r = v.r || Math.max(v.hw || 2, v.hl || 2);
    const g = new THREE.RingGeometry(r * 0.15, r, 48, 3);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uWarm: { value: 0 }, uT: GU.uTime, uC: { value: new THREE.Color('#e3a94f') } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uA; uniform float uWarm; uniform float uT; uniform vec3 uC; varying vec2 vP;
        void main(){ float r = length(vP); float a = atan(vP.y, vP.x);
          float sp = abs(fract(r * 0.9 - a / 6.2831 * 2.0 - uT * 0.15) - 0.5);
          float line = smoothstep(0.08, 0.0, sp);
          float edge = smoothstep(${r.toFixed(2)} * 0.9, ${r.toFixed(2)}, r) * (1.0 - smoothstep(${r.toFixed(2)}, ${r.toFixed(2)} * 1.02, r));
          float k = (line * 0.55 + edge * 0.9) * max(uA, uWarm * 0.35);
          gl_FragColor = vec4(uC * k, k);\n#include <colorspace_fragment>\n}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const m = new THREE.Mesh(g, mat); m.position.set(v.x, (v.y || 0) + 0.05, v.z);
    if (v.hw) { m.scale.set(1, 1, (v.hl || v.hw) / (v.hw)); }
    root.add(m); zones[v.id] = { m, mat, v };
  }
  function buildRail(v) {
    const pts = v.pts.map(p => new THREE.Vector3(p[0], p[1] + 1.6, p[2]));
    if (v.loop) pts.push(pts[0].clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const sp = curve.getPoints(Math.max(20, Math.round(curve.getLength() * 1.5)));
    put(sweepGeo(sp, circleProfile(0.22, 8, 2, 0.5), null), hatchMat('ink', { vc: true }), null);
    const parts = [];
    for (let i = 0; i < sp.length; i += 6) {
      const p = sp[i];
      const pts2 = [p.clone(), p.clone().add(new THREE.Vector3(0, 6, 0))];
      parts.push(sweepGeo(pts2, circleProfile(0.12, 5), null));
    }
    if (parts.length) put(mergeGeos(parts), hatchMat('ink', { vc: true }), null);
  }
  function anchorOf(ref) {
    if (ref.p) return new THREE.Vector3(ref.p[0], ref.p[1], ref.p[2]);
    if (ref.eye) { const e = W.eyeById[ref.eye]; return new THREE.Vector3(e.pos[0] - e.facing[0] * e.size * 0.6, e.pos[1] - e.size * 0.6, e.pos[2] - e.facing[2] * e.size * 0.6); }
    if (ref.mover) {
      const m = W.moverById[ref.mover];
      if (m.kind === 'bridge') return new THREE.Vector3(m.ax, (m.y || 0) - 1.2, m.az);
      if (m.kind === 'gate') return new THREE.Vector3(m.x, (m.y || 0) - 0.5, m.z);
      if (m.kind === 'rotor') return new THREE.Vector3(m.pivot[0], -3, m.pivot[1]);
    }
    return new THREE.Vector3();
  }
  function buildTendon(v) {
    const a = anchorOf(v.from), b = anchorOf(v.to);
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - v.sag;
    const ctrl = [a, a.clone().lerp(mid, 0.5).setY(lerp(a.y, mid.y, 0.8)), mid, b.clone().lerp(mid, 0.5).setY(lerp(b.y, mid.y, 0.8)), b];
    const curve = new THREE.CatmullRomCurve3(ctrl);
    const pts = curve.getPoints(40);
    const g = sweepGeo(pts, circleProfile(v.w, 7, 3, 0.35), t => 0.6 + 0.6 * Math.sin(t * Math.PI));
    const mat = hatchMat('moss', { vc: true, unique: true, emissive: '#000000' });
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = castOK; root.add(mesh);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(v.w * 2.2, 10, 8), glowMat('#e9c27c', { opacity: 0 }));
    root.add(bead);
    tendons.push({ mesh, mat, curve, bead, v, pulse: -1 });
  }

  return { root, rotors, bridges, gates, tendons, portals, zones, lamps,
    dispose() {
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData && o.material.userData.unique !== false && !Object.values(_matCache).includes(o.material)) { if (o.material.dispose) o.material.dispose(); } });
    }
  };
}

// Per-frame sync of world mechanisms from the simulation.
function updateWorldView(V, W, dt) {
  for (const id in V.rotors) { const m = W.moverById[id]; if (m) V.rotors[id].grp.rotation.y = -m.angle; }
  for (const id in V.bridges) {
    const b = V.bridges[id], m = W.moverById[id];
    if (!m || b.lastE === m.e) continue; b.lastE = m.e;
    const L = m.len * easeInOut(m.e), dir = dirYP(m.yaw, 0);
    // a bridge shudders while it primes
    for (let k = 0; k < b.n; k++) {
      let d = k * b.s + b.s / 2;
      let sc = 1;
      if (d + b.s / 2 > L) { d = Math.max(b.s / 2, L - b.s / 2); sc = L < b.s ? Math.max(0.001, L / b.s) : 1; if (k * b.s > L + b.s) sc = 0.001; }
      b.m.compose(new THREE.Vector3(m.ax + dir[0] * d, m.y || 0, m.az + dir[2] * d), b.q, new THREE.Vector3(sc, sc, sc));
      b.inst.setMatrixAt(k, b.m);
    }
    b.inst.instanceMatrix.needsUpdate = true;
  }
  for (const id in V.gates) {
    const g = V.gates[id], m = W.moverById[id]; if (!m) continue;
    const shake = m.primeT > 0 ? Math.sin(W.t * 60) * 0.04 : 0;
    g.iris.userData.set(clamp01(m.e + shake));
  }
  const S = signalApi(W);
  for (const p of V.portals) {
    const want = W.exitOpen === false ? 0 : 1;
    p.open = damp(p.open, want, 3, dt);
    p.iris.userData.set(p.open);
    p.glow.material.opacity = 0.2 + 0.55 * p.open;
    p.deep.material.opacity = 0.25 + 0.6 * p.open * (0.85 + 0.15 * Math.sin(W.t * 2));
    p.light.intensity = 18 * p.open;
  }
  for (const id in V.zones) {
    const z = V.zones[id];
    let a = 0, warm = 0;
    for (const e of W.eyes) if (e.sentinel) {
      const cur = e.sentinel.zones[e.sentinel.idx];
      const held = (W.observedBy[e.id] || []).length > 0 || e.state === ST.PINNED || e.state === ST.RELEASING;
      if (cur === id && !held) a = Math.max(a, 1);
      const next = e.sentinel.zones[(e.sentinel.idx + 1) % e.sentinel.zones.length];
      if (next === id && e.sentinel.period - e.sentinel.t < 1.4 && !held) warm = Math.max(warm, 1 - (e.sentinel.period - e.sentinel.t) / 1.4);
      if (cur === id && e.state === ST.ACQUIRING) a = 1.6;
    }
    z.mat.uniforms.uA.value = damp(z.mat.uniforms.uA.value, a, 6, dt);
    z.mat.uniforms.uWarm.value = warm;
  }
  // tendon pulses ride from eye to mechanism when the mechanism primes
  for (const t of V.tendons) {
    if (t.pulse >= 0) {
      t.pulse += dt * 1.6;
      const p = t.curve.getPoint(clamp01(t.pulse));
      t.bead.position.copy(p); t.bead.material.opacity = t.pulse < 1 ? 0.95 : Math.max(0, 1 - (t.pulse - 1) * 4);
      t.mat.emissive.setRGB(0.25 * Math.max(0, 1 - Math.abs(t.pulse - 0.5) * 2), 0.18 * Math.max(0, 1 - Math.abs(t.pulse - 0.5) * 2), 0.05);
      if (t.pulse > 1.3) { t.pulse = -1; t.mat.emissive.setRGB(0, 0, 0); t.bead.material.opacity = 0; }
    }
  }
}
function pulseTendons(V, moverId) {
  for (const t of V.tendons) if (t.v.to && t.v.to.mover === moverId) t.pulse = 0;
}

// ---- 12_eyes.js ----
// =====================================================================
// Eyes. Each is built from: a socket set into the architecture, a ball
// that turns to the simulation's look direction, an iris drawn by shader,
// and two lids that open and close with the eye's state. Types differ in
// silhouette (socket, crest, hood, pupil shape) and in how they move, so
// they read even without colour.
// =====================================================================

const IRIS_VERT = `
varying vec3 vL; varying vec3 vW; varying vec3 vN;
void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const IRIS_FRAG = `
uniform vec3 uI1; uniform vec3 uI2; uniform float uPupil; uniform float uSlit; uniform float uDouble; uniform float uGlow; uniform float uCatch;
uniform float uDim; uniform float uRings; uniform float uR; uniform float uIrisR; uniform float uT; uniform float uStone; uniform float uSeed;
uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uKey;
varying vec3 vL; varying vec3 vW; varying vec3 vN;
float n2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main(){
  vec2 p = vL.xy / (uR * uIrisR);
  float r = length(p); float a = atan(p.y, p.x);
  if (vL.z < 0.0) discard;
  // sclera beyond the iris is drawn by the ball beneath: fade the cap out
  float irisMask = 1.0 - smoothstep(0.96, 1.0, r);
  if (irisMask <= 0.0) discard;
  float stri = 0.5 + 0.5 * sin(a * 38.0 + n2(vec2(floor(a * 12.0), 1.0)) * 6.0) * (0.6 + 0.4 * sin(r * 20.0 + a * 3.0));
  vec3 col = mix(uI1, uI2, smoothstep(0.15, 0.95, r));
  col *= 0.72 + 0.4 * stri;
  col = mix(col, col * 0.25, smoothstep(0.78, 0.97, r));          // dark limbal ring
  col += vec3(0.9, 0.6, 0.22) * uGlow * (0.5 + 0.5 * stri) * smoothstep(0.2, 0.7, r);
  if (uRings > 0.5) col *= 0.75 + 0.25 * step(0.5, fract(r * 5.0 - uT * 0.6));
  // pupil: round, slit, or doubled
  float pr = uPupil;
  vec2 q = p;
  float pd;
  if (uDouble > 0.5) { pd = min(length(q - vec2(-0.27, 0.0)) / (pr * 0.62), length(q - vec2(0.27, 0.0)) / (pr * 0.62)); }
  else { q.x /= mix(1.0, 0.28, uSlit); pd = length(q) / pr; }
  float pupil = 1.0 - smoothstep(0.92, 1.04, pd);
  col = mix(col, vec3(0.02, 0.018, 0.012), pupil);
  // lighting: a simple wet lambert so it sits in the scene
  vec3 N = normalize(vN);
  float l = 0.62 + 0.5 * max(dot(N, normalize(uKey)), 0.0);
  col *= l;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 0.8, uDim);
  if (uStone > 0.5) col = mix(col, vec3(0.55, 0.52, 0.44) * l, 0.75);
  // the traveller's own light, caught in the eye that sees them
  float cl = 1.0 - smoothstep(0.05, 0.12, length(p - vec2(-0.28, 0.3)));
  col += vec3(1.0, 0.78, 0.42) * cl * uCatch * 1.6;
  float spec = 1.0 - smoothstep(0.02, 0.07, length(p - vec2(0.33, 0.36)));
  col += vec3(0.9) * spec * 0.35 * (1.0 - uStone);
  float dist = length(vW - cameraPosition);
  float f = 1.0 - exp(-pow(dist * uFogD, 1.35));
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

const EYE_LOOK = {
  watcher: { i1: '#8f9a48', i2: '#3d4520', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 1.0, sclera: '#e2d6bb' },
  drifter: { i1: '#a39a58', i2: '#4a4424', pupil: 0.42, lidU: 0.55, lidL: 0.55, almond: 0.9, sclera: '#ddd1b4' },
  collector: { i1: '#b8963f', i2: '#4c3a14', pupil: 0.5, lidU: 0.6, lidL: 0.52, almond: 1.1, sclera: '#e0d3b4', double: 1 },
  sentinel: { i1: '#d29a42', i2: '#5c3c12', pupil: 0.42, lidU: 0.7, lidL: 0.42, almond: 1.2, sclera: '#ddcfae', slit: 1 },
  choir: { i1: '#cfc3a2', i2: '#5d5a44', pupil: 0.3, lidU: 0.58, lidL: 0.5, almond: 1.0, sclera: '#e6dbc2' },
  mimic: { i1: '#9aa77a', i2: '#39412a', pupil: 0.34, lidU: 0.6, lidL: 0.5, almond: 1.0, sclera: '#e2d7bd', rings: 1 },
  liar: { i1: '#8d9850', i2: '#383f1c', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 0.95, sclera: '#dfd3b8' },
  falseeye: { i1: '#6b6650', i2: '#3b3829', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 1.0, sclera: '#b5ab90', stone: 1 },
  unblinking: { i1: '#8c5b2a', i2: '#2a1a0c', pupil: 0.3, lidU: 0, lidL: 0, almond: 1, sclera: '#e9dcbf' },
  crown: { i1: '#9c8a44', i2: '#2f2810', pupil: 0.34, lidU: 0.62, lidL: 0.5, almond: 1.1, sclera: '#e6dbc1' },
  centre: { i1: '#b28b47', i2: '#1d150b', pupil: 0.28, lidU: 0.6, lidL: 0.5, almond: 1.15, sclera: '#ece2c8' }
};

const _eyeGeo = {};
function eyeGeos() {
  if (_eyeGeo.ball) return _eyeGeo;
  _eyeGeo.ball = ensureColor(new THREE.SphereGeometry(1, 28, 20));
  _eyeGeo.iris = new THREE.SphereGeometry(1.012, 32, 12, 0, TAU, 0, 0.62);
  _eyeGeo.iris.rotateX(Math.PI / 2); // cap around +z
  // lids: caps around +y (upper) and -y (lower) with a rolled rim
  const lid = (theta, sign) => {
    const g = new THREE.SphereGeometry(1.05, 30, 8, 0, Math.PI, Math.max(0, theta - 0.85), Math.min(theta, 0.85));
    const rim = new THREE.TorusGeometry(1.05 * Math.sin(theta), 0.05, 6, 40, Math.PI);
    rim.rotateX(-Math.PI / 2); rim.translate(0, 1.05 * Math.cos(theta), 0);
    const m = mergeGeos([ensureColor(g, 1), ensureColor(rim, 0.8)]);
    if (sign < 0) m.rotateX(Math.PI);
    return m;
  };
  _eyeGeo.lidU = lid(1.08, 1);
  _eyeGeo.lidL = lid(0.98, -1);
  // lashes along the front of each rim
  const lash = (theta, sign, n, len) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + 0.76 * i / (n - 1)); // front half: around +z
      const R = 1.05 * Math.sin(theta), y = 1.05 * Math.cos(theta);
      const base = new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R);
      const out = base.clone().setY(0).normalize();
      const tip = base.clone().addScaledVector(out, len * (0.7 + 0.5 * Math.sin(i * 1.7) ** 2)).add(new THREE.Vector3(0, -len * 0.35, 0));
      const g = sweepGeo([base, base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, len * 0.12, 0)), tip], circleProfile(0.035, 4), t => 1 - t * 0.9);
      parts.push(g);
    }
    const m = mergeGeos(parts); if (sign < 0) m.rotateX(Math.PI); return m;
  };
  _eyeGeo.lashU = lash(1.08, 1, 13, 0.42);
  _eyeGeo.lashL = lash(0.98, -1, 9, 0.22);
  // socket: a raised, folded rim that the ball sits back inside
  const prof = [];
  const sp = [[0.99, 0.30], [1.03, 0.47], [1.16, 0.6], [1.36, 0.6], [1.62, 0.45], [1.9, 0.2], [2.2, -0.12], [2.5, -0.45], [2.7, -0.9]];
  for (const q of sp) prof.push(new THREE.Vector2(q[0], q[1]));
  const sock = new THREE.LatheGeometry(prof, 40);
  sock.rotateX(Math.PI / 2); // lathe axis y -> z
  // folds
  const fp = sock.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i), a = Math.atan2(y, x), r = Math.hypot(x, y);
    const k = 1 + 0.07 * Math.sin(a * 9) * clamp01((r - 1.3) / 0.8) + 0.04 * Math.sin(a * 4 + 1) * clamp01(r - 1.1);
    // almond: squeeze vertically, keep the inner lip round enough for the ball
    const sq = lerp(1.0, 0.82, clamp01((r - 1.05) / 1.2));
    fp.setX(i, x * k * 1.08); fp.setY(i, y * k * sq); fp.setZ(i, z + 0.08 * Math.sin(a * 9) * clamp01(r - 1.2));
  }
  sock.computeVertexNormals();
  _eyeGeo.socket = ensureColor(sock, 0.85);
  // pin stitches: a ring of short dark sutures
  const st = [];
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, b = new THREE.BoxGeometry(0.07, 0.36, 0.07);
    b.rotateZ(a + 0.5); b.translate(Math.cos(a) * 1.5, Math.sin(a) * 1.38, 0.28); st.push(ensureColor(b));
  }
  _eyeGeo.stitch = mergeGeos(st);
  // crest for sentinels; hood for drifters; prongs for collectors; hooks for the lidless
  const crest = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.18 + 0.64 * i / 6), pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, r = 1.9 + t * (1.4 + Math.sin(i * 1.3) * 0.4); pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -0.3 - t * 0.6)); }
    crest.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - t * 0.85));
  }
  _eyeGeo.crest = mergeGeos(crest);
  const hood = new THREE.SphereGeometry(1.55, 24, 12, 0, TAU, 0, 1.25);
  hood.rotateX(0.35); hood.translate(0, 0.15, -0.35);
  _eyeGeo.hood = ensureColor(hood, 0.8);
  const prongs = [];
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(s * (1.7 + Math.sin(t * Math.PI) * 0.9), (k ? -1 : 1) * (0.4 + t * 1.3), -0.2 + t * 1.6)); }
    prongs.push(sweepGeo(pts, circleProfile(0.17, 6), t => 1 - t * 0.85));
  }
  _eyeGeo.prongs = mergeGeos(prongs);
  const hooks = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, r = 1.18 + t * 0.55; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.1 + t * 0.55 - t * t * 0.6)); }
    hooks.push(sweepGeo(pts, circleProfile(0.08, 5), t => 1 - t * 0.8));
  }
  _eyeGeo.hooks = mergeGeos(hooks);
  return _eyeGeo;
}

function buildEyeView(e, look) {
  const G = eyeGeos();
  const L = EYE_LOOK[e.type] || EYE_LOOK.watcher;
  const s = e.size;
  const root = new THREE.Group();
  root.position.fromArray(e.pos);
  const lidMat = e.type === 'falseeye' ? hatchMat('stone', { vc: true }) : hatchMat('lid', { vc: true });
  const sockMat = e.type === 'falseeye' ? hatchMat('stone', { vc: true, side: 2 }) : hatchMat(e.type === 'sentinel' || e.type === 'crown' ? 'ochre' : 'flesh', { vc: true, side: 2, color: e.type === 'choir' ? '#cdbf9d' : '#9a8564' });
  const scl = hatchMat('flesh', { vc: true, color: L.sclera, rim: 0.7 });
  const scale = new THREE.Group(); scale.scale.setScalar(s); root.add(scale);
  if (e.mount !== 'free') { const sock = new THREE.Mesh(G.socket, sockMat); sock.castShadow = true; scale.add(sock); }
  const ball = new THREE.Group(); scale.add(ball);
  const sclera = new THREE.Mesh(G.ball, scl); sclera.castShadow = true; ball.add(sclera);
  const irisMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uI1: { value: new THREE.Color(L.i1) }, uI2: { value: new THREE.Color(L.i2) }, uPupil: { value: L.pupil }, uSlit: { value: L.slit || 0 }, uDouble: { value: L.double || 0 },
      uGlow: { value: 0 }, uCatch: { value: 0 }, uDim: { value: 0 }, uRings: { value: L.rings || 0 }, uR: { value: 1.012 }, uIrisR: { value: Math.sin(0.62) },
      uT: GU.uTime, uStone: { value: L.stone || 0 }, uSeed: { value: (e.id.charCodeAt(0) * 0.37) % 7 }, uKey: { value: new THREE.Vector3(0.3, 0.8, 0.5) }
    }, { uFogColor: GU.uFogColor, uFogD: GU.uFogD }),
    vertexShader: IRIS_VERT, fragmentShader: IRIS_FRAG
  });
  const iris = new THREE.Mesh(G.iris, irisMat); ball.add(iris);
  const lids = new THREE.Group(); scale.add(lids);
  let lidU = null, lidL = null;
  if (L.lidU > 0) {
    lidU = new THREE.Group(); lidL = new THREE.Group();
    const mu = new THREE.Mesh(G.lidU, lidMat), ml = new THREE.Mesh(G.lidL, lidMat);
    mu.castShadow = true;
    const lashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(e.type === 'falseeye' ? '#4a463a' : '#120f0a') });
    lidU.add(mu, new THREE.Mesh(G.lashU, lashMat)); lidL.add(ml, new THREE.Mesh(G.lashL, lashMat));
    lids.add(lidU, lidL);
    lids.scale.set(L.almond, 1, 1);
  } else {
    const hk = new THREE.Mesh(G.hooks, hatchMat('ink', { vc: true })); scale.add(hk);
  }
  if (e.type === 'sentinel' || e.type === 'crown') scale.add(new THREE.Mesh(G.crest, hatchMat('bone', { vc: true })));
  if (e.type === 'drifter') { const h = new THREE.Mesh(G.hood, hatchMat('ink', { vc: true, side: 2 })); scale.add(h); }
  if (e.type === 'collector') scale.add(new THREE.Mesh(G.prongs, hatchMat('olive', { vc: true })));
  const stitch = new THREE.Mesh(G.stitch, new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d0b07') }));
  stitch.visible = false; scale.add(stitch);
  // a soft amber halo that grows as the eye acquires (readable at phone scale)
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.55, 2.25, 40), glowMat('#e7a548', { opacity: 0, side: THREE.DoubleSide }));
  halo.position.z = 0.4; scale.add(halo);
  const V = {
    e, root, scale, ball, iris, irisMat, lids, lidU, lidL, stitch, halo, L,
    open: e.state === 'dormant' ? 0 : 0.7, blinkT: 2 + Math.random() * 4, blink: 0, tremble: 0, lastState: e.state,
    _q: new THREE.Quaternion(), _v: new THREE.Vector3(), _z: new THREE.Vector3(0, 0, 1), _m: new THREE.Matrix4()
  };
  orientEye(V, true);
  return V;
}

function orientEye(V, force) {
  const e = V.e;
  V.root.position.fromArray(e.pos);
  V._v.fromArray(e.facing).normalize();
  V.root.quaternion.setFromUnitVectors(V._z, V._v);
}

// Map the simulation state to lids, pupil, glow. dt in seconds.
function updateEyeView(V, W, dt, ctx) {
  const e = V.e;
  if (e.rail || e.mover) orientEye(V);
  // ball direction: e.look expressed in the socket frame
  const inv = V._q.copy(V.root.quaternion).invert();
  const lk = V._v.fromArray(e.look).applyQuaternion(inv).normalize();
  const want = new THREE.Quaternion().setFromUnitVectors(V._z, lk);
  V.ball.quaternion.slerp(want, 1 - Math.exp(-dt * 18));
  const pitch = Math.asin(clamp(lk.y, -1, 1));
  const st = e.state, held = (W.observedBy[e.id] || []).length > 0;
  // openness target by state
  let open = 0.72;
  if (st === 'alert') open = 0.88;
  else if (st === 'acquiring') open = 0.98;
  else if (st === 'searching') open = 0.85;
  else if (st === 'pinned') open = 0.3;
  else if (st === 'releasing') open = e.st < 0.25 ? 0.05 : 0.6;
  else if (st === 'disrupted') open = 0.3 + 0.5 * Math.abs(Math.sin(e.st * 17));
  else if (st === 'dormant') open = 0.0;
  if (held && st === 'active') open = 0.6;
  if (e.type === 'liar' && !e.liarOpen) open = st === 'acquiring' ? 0.06 + 0.05 * Math.abs(Math.sin(W.t * 23)) : 0.02;
  if (e.type === 'falseeye') open = 0.72;
  // blinking: idle blinks, synchronised for a choir in formation
  if (e.type !== 'falseeye' && !e.unblink && st !== 'pinned' && st !== 'dormant') {
    if (e.type === 'choir' && e.group && groupSynced(W, e.group)) {
      const ph = (W.t % 4.2) / 4.2; V.blink = ph < 0.05 ? Math.sin(ph / 0.05 * Math.PI) : 0;
    } else {
      V.blinkT -= dt;
      if (V.blinkT <= 0) { V.blinkT = 2.5 + ((e.id.charCodeAt(0) * 7 + W.tick) % 50) / 10; V.blink = 1; }
      V.blink = Math.max(0, V.blink - dt * 7);
    }
    if (st === 'acquiring') V.blink = 0;
  } else V.blink = 0;
  const k = st === 'acquiring' || st === 'disrupted' ? 20 : 9;
  V.open = damp(V.open, open * (1 - Math.sin(V.blink * Math.PI * 0.5)), k, dt);
  if (V.lidU) {
    const tr = st === 'pinned' ? Math.sin(W.t * 31 + e.size) * 0.03 : 0;
    const follow = pitch * 0.45;
    // upper lid: 0 rad = fully open, ~0.95 rad = closed past centre
    V.lidU.rotation.x = lerp(1.0, 0.0, V.open) - follow * 0.8 + tr;
    V.lidL.rotation.x = -lerp(0.62, 0.0, V.open) - follow * 0.4 - tr;
  }
  // a liar's ball bulges under the closed lid and follows you
  if (e.type === 'liar' && V.lidU && !e.liarOpen) {
    const yaw = Math.atan2(lk.x, lk.z);
    V.lidU.rotation.y = yaw * 0.3; V.lidL.rotation.y = yaw * 0.3;
  } else if (V.lidU) { V.lidU.rotation.y = 0; V.lidL.rotation.y = 0; }
  // pupil: tightens as it acquires; dilates when pinned or held
  const U = V.irisMat.uniforms;
  let pupil = V.L.pupil;
  if (st === 'acquiring') pupil = lerp(V.L.pupil, V.L.pupil * 0.45, e.acq);
  if (st === 'pinned') pupil = V.L.pupil * 1.45;
  if (held && st === 'active') pupil = V.L.pupil * 1.25;
  if (e.type === 'falseeye') pupil = V.L.pupil;
  U.uPupil.value = damp(U.uPupil.value, pupil, 8, dt);
  U.uGlow.value = damp(U.uGlow.value, e.isFalse ? (st === 'acquiring' ? 0.5 : 0) : e.acq * 1.1 + (st === 'alert' ? 0.12 : 0), 10, dt);
  U.uCatch.value = damp(U.uCatch.value, e.seesPlayer && !e.isFalse ? 1 : 0, 14, dt);
  U.uDim.value = damp(U.uDim.value, st === 'pinned' ? 0.85 : st === 'dormant' ? 1 : 0, 8, dt);
  if (ctx && ctx.keyDir) U.uKey.value.copy(ctx.keyDir);
  V.stitch.visible = st === 'pinned';
  if (V.stitch.visible) { const sc = Math.min(1, e.st * 6); V.stitch.scale.setScalar(0.8 + 0.2 * sc); V.stitch.rotation.z = W.t * 0.2; }
  const ha = e.isFalse ? 0 : clamp01(e.acq * 1.2) * (0.35 + 0.25 * Math.sin(W.t * (6 + e.acq * 10)));
  V.halo.material.opacity = damp(V.halo.material.opacity, ha, 10, dt);
  V.halo.scale.setScalar(1.15 - 0.2 * e.acq);
  // a false eye, once looked at closely, shows the chisel marks: its lids stop pretending
  if (e.isFalse && e.revealed) U.uStone.value = 1;
}

// ---------------------------------------------------------------------
// Beams: lines of attention. One shared ribbon geometry, billboarded in
// the vertex shader; each beam has its own small material.
// ---------------------------------------------------------------------
let _beamGeo = null;
function beamGeo() {
  if (_beamGeo) return _beamGeo;
  const n = 32, pos = [], idx = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pos.push(t, -1, 0, t, 1, 0); }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  _beamGeo = g; return g;
}
const BEAM_VERT = `
uniform vec3 uA; uniform vec3 uB; uniform float uW; uniform float uSag;
varying float vT; varying float vS; varying float vD;
void main(){
  float t = position.x; vT = t; vS = position.y;
  vec3 p = mix(uA, uB, t); p.y -= sin(t * 3.14159) * uSag;
  vec3 dir = normalize(uB - uA);
  vec3 toC = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toC));
  float w = uW * (0.55 + 0.45 * sin(t * 3.14159));
  p += side * position.y * w;
  vD = length(cameraPosition - p);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BEAM_FRAG = `
uniform vec3 uC; uniform float uAlpha; uniform float uGrow; uniform float uT; uniform float uDash; uniform float uLen; uniform float uSpeed; uniform float uFogD;
varying float vT; varying float vS; varying float vD;
void main(){
  if (vT > uGrow) discard;
  float core = exp(-vS * vS * 9.0);
  float soft = exp(-vS * vS * 2.0) * 0.35;
  float motes = 0.55 + 0.45 * sin(vT * uLen * 1.7 - uT * uSpeed * 6.0);
  float dash = uDash > 0.5 ? step(0.45, fract(vT * uLen * 0.6 - uT * 0.8)) : 1.0;
  float head = smoothstep(uGrow - 0.06, uGrow, vT) * 1.5;
  float ends = smoothstep(0.0, 0.04, vT) * smoothstep(1.0, 0.96, vT);
  float a = (core + soft) * motes * dash * ends * uAlpha + head * core * uAlpha;
  a *= exp(-vD * uFogD * 0.5);
  gl_FragColor = vec4(uC * a, a);
#include <colorspace_fragment>
}`;
function makeBeam(color, width) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: width || 0.18 }, uSag: { value: 0 }, uC: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uGrow: { value: 1 }, uT: GU.uTime, uDash: { value: 0 }, uLen: { value: 10 }, uSpeed: { value: 1 }, uFogD: GU.uFogD },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(beamGeo(), mat); m.frustumCulled = false; m.visible = false; m.renderOrder = 5;
  return { m, mat, U: mat.uniforms, life: 0, key: null, a: 0 };
}

// ---- 13_player.js ----
// =====================================================================
// The traveller: a small dark figure in a long coat with a pale face and
// a lamp. Built from a few jointed parts and animated procedurally from
// the simulation's velocity, so movement reads: lean into acceleration,
// stride with speed, settle when stopping, head turned toward the gaze.
// =====================================================================

function buildPlayerView() {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(1.3); root.add(body);
  const coatM = hatchMat('coat', { vc: true, rim: 0.9 });
  const skin = hatchMat('flesh', { vc: true, color: '#e8dcc0', rim: 0.6 });
  const ink = new THREE.MeshLambertMaterial({ color: new THREE.Color('#1a1814') });
  // coat: a flared lathe that sways
  const prof = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.06 + 0.29 * Math.pow(1 - t, 0.9) + 0.03 * Math.sin(t * 9), 0.18 + t * 1.0)); }
  prof.push(new THREE.Vector2(0.001, 1.2));
  const coatG = ensureColor(new THREE.LatheGeometry(prof, 14));
  const coat = new THREE.Mesh(coatG, coatM); coat.castShadow = true; body.add(coat);
  // a hood/collar shadow and the head
  const head = new THREE.Group(); head.position.set(0, 1.25, 0); body.add(head);
  const skull = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(0.15, 14, 10)), skin); skull.scale.set(0.95, 1.12, 1); skull.castShadow = true; head.add(skull);
  const hood = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(0.19, 14, 10, 0, TAU, 0, 1.9)), coatM); hood.rotation.x = -0.5; hood.position.set(0, 0.04, -0.04); head.add(hood);
  // two dark eye-marks on the face (it watches too)
  for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), ink); d.position.set(s * 0.055, 0.02, 0.135); head.add(d); }
  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.42, 0); body.add(hip);
    const leg = new THREE.Mesh(ensureColor(new THREE.CapsuleGeometry(0.05, 0.36, 3, 6)), ink); leg.position.y = -0.22; leg.castShadow = true; hip.add(leg);
    legs.push(hip);
  }
  // arms
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 1.02, 0); body.add(sh);
    const arm = new THREE.Mesh(ensureColor(new THREE.CapsuleGeometry(0.045, 0.42, 3, 6)), coatM); arm.position.y = -0.24; arm.castShadow = true; sh.add(arm);
    arms.push(sh);
  }
  // the lamp hangs from the right hand
  const lampG = new THREE.Group(); lampG.position.set(0, -0.5, 0.02); arms[1].add(lampG);
  const lampCore = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd48a') }));
  lampG.add(lampCore);
  const lampHalo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat('#f2b45a', { opacity: 0.22 }));
  lampG.add(lampHalo);
  const light = new THREE.PointLight(new THREE.Color('#ffc477'), 9, 9, 1.6);
  light.position.set(0, 1.1, 0.25); root.add(light);
  // a pool of warm light on the ground keeps the traveller readable from far away
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0.5 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uA; varying vec2 vP; void main(){ float r = length(vP) / 1.6; float a = (1.0 - smoothstep(0.0, 1.0, r)) * uA; gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a, a);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; root.add(pool);
  // a thin ink ring under the feet: where you stand, precisely
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#14110c'), transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; root.add(ring);
  return { root, body, head, legs, arms, coat, lampG, light, pool, ring, phase: 0, lean: 0, bob: 0, lastVel: [0, 0], headYaw: 0, flinch: 0, yaw: 0, settle: 0 };
}

function updatePlayerView(P, W, dt, gazeEye) {
  const S = W.player;
  P.root.position.set(S.pos[0], S.pos[1], S.pos[2]);
  const sp = Math.hypot(S.vel[0], S.vel[1]);
  const k = sp / PLAYER.speed;
  // facing: three yaw from simulation yaw (atan2(z, x)); figure's front is +z
  const fy = Math.PI / 2 - S.yaw;
  P.yaw = fy;
  P.body.rotation.y = fy;
  // stride
  P.phase += dt * (4 + 9 * k) * (k > 0.02 ? 1 : 0);
  const sw = Math.sin(P.phase) * 0.75 * Math.min(1, k * 1.3);
  P.legs[0].rotation.x = sw; P.legs[1].rotation.x = -sw;
  P.arms[0].rotation.x = -sw * 0.7; P.arms[1].rotation.x = sw * 0.35 - 0.1;
  // lean into acceleration, settle after stopping
  const ax = (S.vel[0] - P.lastVel[0]) / Math.max(dt, 1e-3), az = (S.vel[1] - P.lastVel[1]) / Math.max(dt, 1e-3);
  P.lastVel[0] = S.vel[0]; P.lastVel[1] = S.vel[1];
  const fwd = [Math.cos(S.yaw), Math.sin(S.yaw)];
  const accF = clamp((ax * fwd[0] + az * fwd[1]) / 40, -1, 1);
  P.lean = damp(P.lean, k * 0.22 + accF * 0.18, 10, dt);
  P.body.rotation.x = P.lean;
  P.bob = Math.abs(Math.sin(P.phase)) * 0.05 * k;
  P.body.position.y = P.bob;
  P.coat.rotation.z = Math.sin(P.phase * 0.5) * 0.04 * k;
  P.coat.scale.set(1 + 0.08 * k, 1, 1 + 0.1 * k);
  // head turns toward the eye you hold, within the neck's reach
  let hy = 0, hp = 0;
  if (gazeEye) {
    const dx = gazeEye.pos[0] - S.pos[0], dz = gazeEye.pos[2] - S.pos[2], dy = gazeEye.pos[1] - (S.pos[1] + 1.25);
    const world = Math.PI / 2 - Math.atan2(dz, dx);
    hy = clamp(wrapAngle(world - fy), -1.4, 1.4);
    hp = -clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.8);
  }
  P.headYaw = damp(P.headYaw, hy, 9, dt);
  P.head.rotation.set(damp(P.head.rotation.x, hp + P.flinch * 0.3, 9, dt), P.headYaw, 0);
  P.flinch = Math.max(0, P.flinch - dt * 3);
  // lamp sways
  P.lampG.rotation.z = Math.sin(W.t * 2.1) * 0.15 + sw * 0.2;
  // falling: arms up
  if (S.falling) { P.arms[0].rotation.x = -2.6; P.arms[1].rotation.x = -2.4; P.body.rotation.x = -0.3; }
  P.pool.material.uniforms.uA.value = 0.42 + 0.06 * Math.sin(W.t * 3.3);
}

// ---- 14_view.js ----
// =====================================================================
// The view: scene, lights, atmosphere, camera, eyes, beams and picking.
// Reads the simulation; never changes it.
// =====================================================================

function createView(renderer, opts) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04;
  scene.add(hemi, key, key.target);
  const V = { scene, camera, renderer, hemi, key, world: null, eyes: {}, eyeList: [], player: null, beams: new Map(), beamPool: [], W: null,
    camPos: new THREE.Vector3(), camTarget: new THREE.Vector3(), camInit: false, look: LOOKS.act1, quality: opts.quality, shake: 0, focus: null, focusK: 0,
    width: 1, height: 1, dpr: 1, keyDir: new THREE.Vector3(), extraZoom: 0, still: 0 };

  // sky dome: a vertical gradient from ink above, haze at the horizon, void below
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uVoid: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHaze; uniform vec3 uVoid; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(uHaze, uTop, smoothstep(0.0, 0.55, y)) : mix(uHaze, uVoid, smoothstep(0.0, 0.25, -y));
        c += uHaze * 0.35 * smoothstep(0.55, 1.0, -y); // a faint glow far below
        gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    side: THREE.BackSide, depthWrite: false
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), domeMat); dome.renderOrder = -10; scene.add(dome);
  // high light shafts: a restrained volumetric suggestion
  const shafts = new THREE.Group(); scene.add(shafts);
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color('#e8dcb8') }, uA: { value: 0.05 }, uT: GU.uTime },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; uniform float uT; varying vec2 vU; void main(){ float e = sin(vU.x * 3.14159); float n = 0.75 + 0.25 * sin(vU.x * 40.0 + uT * 0.3) * sin(vU.y * 7.0 - uT * 0.2); float a = e * e * smoothstep(0.0, 0.45, vU.y) * (1.0 - smoothstep(0.75, 1.0, vU.y)) * uA * n; gl_FragColor = vec4(uC * a, a);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(3 + i * 1.5, 9 + i * 3, 120, 24, 1, true);
    const m = new THREE.Mesh(g, shaftMat); m.renderOrder = 4; shafts.add(m); m.userData.i = i;
  }
  // dust motes drifting through the air
  const NM = 260, mp = new Float32Array(NM * 3), mrng = makeRng(99);
  for (let i = 0; i < NM; i++) { mp[i * 3] = mrng.range(-30, 30); mp[i * 3 + 1] = mrng.range(-8, 26); mp[i * 3 + 2] = mrng.range(-40, 30); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: new THREE.Color('#e9dcb6'), size: 0.12, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  motes.frustumCulled = false; scene.add(motes);

  V.setLook = L => {
    V.look = L; applyLookUniforms(L);
    scene.background = new THREE.Color(L.bg);
    hemi.color.set(L.sky); hemi.groundColor.set(L.gnd); hemi.intensity = L.hemiI;
    key.color.set(L.key); key.intensity = L.keyI;
    V.keyDir.set(L.keyDir[0], L.keyDir[1], L.keyDir[2]).normalize();
    domeMat.uniforms.uTop.value.set(L.bg).multiplyScalar(0.55); domeMat.uniforms.uHaze.value.set(L.fog); domeMat.uniforms.uVoid.value.set(L.void);
    shaftMat.uniforms.uC.value.set(L.key);
    motes.material.color.set(L.rim);
  };

  V.setEncounter = W => {
    V.clear();
    V.W = W;
    const L = LOOKS[W.def.look] || LOOKS.act1;
    V.setLook(L);
    V.world = buildWorldView(W, L, V.quality);
    scene.add(V.world.root);
    V.eyes = {}; V.eyeList = [];
    for (const e of W.eyes) { const ev = buildEyeView(e, L); V.eyes[e.id] = ev; V.eyeList.push(ev); scene.add(ev.root); }
    if (!V.player) { V.player = buildPlayerView(); }
    scene.add(V.player.root);
    // shadow frustum covers the walkable bounds
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const r of W.regions) { const cx = r.wx === undefined ? r.cx : r.wx, cz = r.wz === undefined ? r.cz : r.wz, ext = r.kind === 'arc' ? r.r1 : Math.max(r.hl, r.hw) + 4; x0 = Math.min(x0, cx - ext); x1 = Math.max(x1, cx + ext); z0 = Math.min(z0, cz - ext); z1 = Math.max(z1, cz + ext); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, half = Math.max(x1 - x0, z1 - z0) / 2 + 14;
    V.bounds = { cx, cz, half };
    key.target.position.set(cx, 0, cz);
    key.position.set(cx + V.keyDir.x * 80, V.keyDir.y * 80, cz + V.keyDir.z * 80);
    const sc = key.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 220; sc.updateProjectionMatrix();
    key.castShadow = V.quality > 0;
    key.shadow.mapSize.set(V.quality > 1 ? 2048 : 1024, V.quality > 1 ? 2048 : 1024);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    // shafts fall into the chamber from the key light's side
    shafts.children.forEach((m, i) => {
      const r = makeRng(i * 7 + 3);
      m.position.set(cx + r.range(-14, 14), 30, cz + r.range(-18, 12));
      m.rotation.set(-V.keyDir.z * 0.4, 0, V.keyDir.x * 0.4);
    });
    V.camInit = false; V.still = 0;
    for (const b of V.beams.values()) { b.m.visible = false; V.beamPool.push(b); }
    V.beams.clear();
  };
  V.clear = () => {
    if (V.world) { scene.remove(V.world.root); V.world.dispose(); V.world = null; }
    for (const ev of V.eyeList) { scene.remove(ev.root); ev.irisMat.dispose(); ev.halo.geometry.dispose(); ev.halo.material.dispose(); }
    V.eyes = {}; V.eyeList = [];
    if (V.player) scene.remove(V.player.root);
  };

  V.resize = (w, h, dpr) => {
    V.width = w; V.height = h; V.dpr = dpr;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    GU.uOccR.value = 70 * dpr;
  };

  // ------------------------------------------------------------------
  function camConfig(W) {
    const c = W.def.cam || {};
    const fov = c.fov || 40, pitch = (V.pitchOverride || 50) * DEG;
    const wNeed = c.w || 19;
    const tanH = Math.tan(fov * DEG / 2);
    const distW = wNeed / (2 * tanH * Math.max(0.3, camera.aspect));
    const dist = Math.max(c.dist || 34, Math.min(distW, (c.dist || 34) * 1.9)) + V.extraZoom;
    return { fov, pitch, dist, c };
  }
  V.updateCamera = (W, dt, snap) => {
    if (V.debugCam) { camera.position.fromArray(V.debugCam.pos); camera.lookAt(new THREE.Vector3().fromArray(V.debugCam.target)); V.camPos.copy(camera.position); return; }
    const cc = camConfig(W), c = cc.c, P = W.player.pos;
    if (camera.fov !== cc.fov) { camera.fov = cc.fov; camera.updateProjectionMatrix(); }
    // look ahead along the route (up the screen) and a little along velocity
    let tx = P[0] + W.player.vel[0] * 0.35, tz = P[2] + W.player.vel[1] * 0.35 - (c.ahead === undefined ? 5 : c.ahead), ty = P[1];
    // when a focus point is set (a significant event), lean toward it
    if (V.focus) { tx = lerp(tx, V.focus[0], V.focusK * 0.45); tz = lerp(tz, V.focus[2], V.focusK * 0.45); }
    tx = clamp(tx, c.x0 === undefined ? -1e9 : c.x0, c.x1 === undefined ? 1e9 : c.x1);
    tz = clamp(tz, c.z1 === undefined ? -1e9 : c.z1, c.z0 === undefined ? 1e9 : c.z0);
    const tgt = new THREE.Vector3(tx, ty, tz);
    const yaw = c.yaw || 0;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(cc.pitch), Math.sin(cc.pitch), Math.cos(yaw) * Math.cos(cc.pitch)).multiplyScalar(cc.dist);
    const pos = tgt.clone().add(off);
    if (!V.camInit || snap) { V.camPos.copy(pos); V.camTarget.copy(tgt); V.camInit = true; }
    else {
      const k = 1 - Math.exp(-dt * 3.2);
      V.camPos.lerp(pos, k); V.camTarget.lerp(tgt, k);
    }
    camera.position.copy(V.camPos);
    if (V.shake > 0) { camera.position.x += Math.sin(W.t * 47) * V.shake * 0.3; camera.position.y += Math.sin(W.t * 39) * V.shake * 0.2; V.shake = Math.max(0, V.shake - dt * 2); }
    camera.lookAt(V.camTarget);
    dome.position.copy(camera.position);
    motes.position.set(Math.round(V.camTarget.x / 60) * 60, 0, Math.round(V.camTarget.z / 70) * 70);
  };

  const _v = new THREE.Vector3();
  V.toScreen = (p, out) => {
    _v.set(p[0], p[1], p[2]).project(camera);
    out = out || {};
    out.x = (_v.x * 0.5 + 0.5) * V.width; out.y = (-_v.y * 0.5 + 0.5) * V.height; out.z = _v.z; out.behind = _v.z > 1;
    return out;
  };
  // pick the eye nearest a tap, generous on small screens
  V.pickEye = (x, y, radius) => {
    let best = null, bd = 1e9;
    const W = V.W; if (!W) return null;
    for (const e of W.eyes) {
      if (e.hidden) continue;
      const s = V.toScreen(e.pos);
      if (s.behind) continue;
      const s2 = V.toScreen(vAdd(e.pos, [0, e.size, 0]));
      const pr = Math.abs(s2.y - s.y);
      const d = Math.hypot(s.x - x, s.y - y), lim = Math.max(radius || 46, pr * 1.6);
      if (d < lim && d - pr < bd) { bd = d - pr; best = e.id; }
    }
    return best;
  };

  // ------------------------------------------------------------------
  function beam(key, color, width) {
    let b = V.beams.get(key);
    if (!b) {
      b = V.beamPool.pop() || makeBeam(color, width);
      if (!b.m.parent) scene.add(b.m);
      b.U.uC.value.set(color); b.U.uW.value = width; b.U.uDash.value = 0; b.U.uSag.value = 0; b.U.uSpeed.value = 1;
      b.a = 0; b.grow = 0; b.key = key; b.dead = false; b.flash = 0;
      V.beams.set(key, b);
    }
    b.seen = true; b.dead = false;
    return b;
  }
  const eyeFrontP = (e, out) => { out = out || [0, 0, 0]; out[0] = e.pos[0] + e.look[0] * e.size * 0.95; out[1] = e.pos[1] + e.look[1] * e.size * 0.95; out[2] = e.pos[2] + e.look[2] * e.size * 0.95; return out; };
  V.snapBeam = (a, b) => { const bm = V.beams.get('L:' + a + '>' + b); if (bm) { bm.flash = 1; } };
  function updateBeams(W, dt) {
    for (const b of V.beams.values()) b.seen = false;
    const pc = playerChest(W), ph = playerHead(W);
    for (const l of W.links) {
      const a = W.eyeById[l.a], t = W.eyeById[l.b];
      const b = beam('L:' + l.a + '>' + l.b, '#efe3c2', 0.2 + a.size * 0.05);
      const pa = eyeFrontP(a), pb = eyeFrontP(t);
      b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pb[0], pb[1], pb[2]);
      b.U.uLen.value = vDist(pa, pb); b.target = 0.62;
    }
    for (const e of W.eyes) {
      if (e.seesPlayer && !e.isFalse) {
        const b = beam('A:' + e.id, '#efa848', 0.1);
        const pa = eyeFrontP(e); b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pc[0], pc[1], pc[2]);
        b.U.uW.value = 0.08 + 0.3 * e.acq; b.target = 0.25 + 0.95 * e.acq; b.U.uLen.value = vDist(pa, pc); b.U.uSpeed.value = 1 + e.acq * 3;
      }
      if (e.type === 'mimic' && e.echo && e.echo !== e.id && !e.linkTo) {
        const t = W.eyeById[e.echo]; if (t) {
          const b = beam('M:' + e.id, '#b9c39a', 0.08);
          const pa = eyeFrontP(e), pb = eyeFrontP(t); b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pb[0], pb[1], pb[2]); b.U.uDash.value = 1; b.target = 0.45; b.U.uLen.value = vDist(pa, pb);
        }
      }
    }
    const G = W.gaze;
    if (G.target && W.eyeById[G.target]) {
      const e = W.eyeById[G.target];
      const b = beam('G', '#fff6dc', 0.07);
      b.U.uA.value.set(ph[0], ph[1], ph[2]);
      const pb = vAddS(e.pos, vNorm(vSub(ph, e.pos)), e.size * 1.02);
      b.U.uB.value.set(pb[0], pb[1], pb[2]);
      b.U.uLen.value = vDist(ph, pb);
      b.U.uDash.value = G.refused || e.isFalse ? 1 : 0;
      b.U.uW.value = e.state === 'pinned' ? 0.11 : 0.06;
      b.target = G.lostT > 0 ? 0.25 : (e.state === 'pinned' ? 1.0 : 0.6);
      b.growTarget = Math.max(0.05, G.focus);
    }
    for (const [k, b] of V.beams) {
      if (b.seen) {
        b.a = damp(b.a, b.target, 10, dt);
        b.grow = k === 'G' ? damp(b.grow, b.growTarget, 20, dt) : Math.min(1, b.grow + dt * 3.5);
      } else {
        b.a = Math.max(0, b.a - dt * (b.flash > 0 ? 5 : 3));
        if (b.a <= 0.01) { b.m.visible = false; V.beams.delete(k); V.beamPool.push(b); continue; }
      }
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 3);
      b.U.uAlpha.value = b.a + b.flash * 1.4;
      b.U.uGrow.value = b.grow;
      b.m.visible = true;
    }
  }

  // ------------------------------------------------------------------
  V.update = (W, dt) => {
    GU.uTime.value = W.t;
    if (V.world) updateWorldView(V.world, W, dt);
    const gazeEye = W.gaze.target && W.gaze.focus > 0.2 ? W.eyeById[W.gaze.target] : null;
    updatePlayerView(V.player, W, dt, gazeEye);
    for (const ev of V.eyeList) updateEyeView(ev, W, dt, V);
    updateBeams(W, dt);
    V.updateCamera(W, dt);
    if (V.focus) { V.focusK = damp(V.focusK, V.focusHold > 0 ? 1 : 0, 3, dt); V.focusHold -= dt; if (V.focusHold < -2) V.focus = null; }
    // traveller's screen position for the occlusion fade
    const s = V.toScreen([W.player.pos[0], W.player.pos[1] + 0.8, W.player.pos[2]]);
    GU.uPlayerScr.value.set(s.x * V.dpr, (V.height - s.y) * V.dpr);
    GU.uPlayerDepth.value = camera.position.distanceTo(_v.set(W.player.pos[0], W.player.pos[1] + 0.8, W.player.pos[2]));
    for (const m of shafts.children) m.material.uniforms.uA.value = 0.045;
  };
  V.setFocus = (p, hold) => { V.focus = p; V.focusHold = hold || 1.5; };
  V.render = () => { renderer.render(scene, camera); };
  return V;
}

// ---- 15_audio.js ----
// =====================================================================
// Sound: sparse, synthesised, tied to what the network does. A low bed
// that tightens with attention; distinct voices for noticing, pinning,
// releasing, links forming and snapping, and stone that begins to move.
// Silence is allowed to happen.
// =====================================================================
function createAudio() {
  const A = { ok: false, on: true, vol: 0.85 };
  let ac = null, master, wet, nb, bed = null, acqVoice = null, rumble = null;
  A.unlock = () => {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.on ? A.vol : 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
        master.connect(comp); comp.connect(ac.destination);
        // a long dark room
        const len = Math.floor(ac.sampleRate * 3.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.55; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        A.ok = true;
        startBed();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setOn = on => { A.on = on; if (master) master.gain.setTargetAtTime(on ? A.vol : 0, ac.currentTime, 0.1); };
  A.suspend = () => { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = () => { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } ac = null; A.ok = false; };
  const now = () => ac.currentTime;
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.001) return;
    const t = now() + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.5 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.001) return;
    const t = now() + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.4 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // ---- the bed ------------------------------------------------------------
  function startBed() {
    const g = ac.createGain(); g.gain.value = 0.0; g.connect(master);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7; lp.connect(g);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator();
    o1.type = 'sine'; o2.type = 'triangle'; o3.type = 'sine';
    o1.frequency.value = 55; o2.frequency.value = 55.4; o3.frequency.value = 82.4;
    const g3 = ac.createGain(); g3.gain.value = 0.0;
    o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp);
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 300; nf.Q.value = 0.5;
    const ng = ac.createGain(); ng.gain.value = 0.05; ns.connect(nf); nf.connect(ng); ng.connect(g);
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lg = ac.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(nf.frequency);
    for (const o of [o1, o2, o3, ns, lfo]) o.start();
    g.gain.setTargetAtTime(0.32, now(), 2.5);
    bed = { g, lp, o1, o2, o3, g3, nf, ng };
    // a single voice for the strongest acquiring eye: a bowed, rising tone
    const av = ac.createOscillator(); av.type = 'sawtooth'; av.frequency.value = 220;
    const vib = ac.createOscillator(); vib.frequency.value = 5.2; const vg = ac.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(av.frequency);
    const af = ac.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 900; af.Q.value = 6;
    const ag = ac.createGain(); ag.gain.value = 0; av.connect(af); af.connect(ag); out(ag, 1, 0.6);
    av.start(); vib.start();
    acqVoice = { av, af, ag };
    // stone moving
    const rs = ac.createBufferSource(); rs.buffer = nb; rs.loop = true;
    const rf = ac.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160; rf.Q.value = 2;
    const rg = ac.createGain(); rg.gain.value = 0; rs.connect(rf); rf.connect(rg); out(rg, 1, 0.3); rs.start();
    rumble = { rg, rf };
  }
  const ROOTS = { act1: 55, act2: 49, act3: 46.25, act4: 41.2 };
  A.setAct = look => { if (!bed) return; const r = ROOTS[look] || 55; bed.o1.frequency.setTargetAtTime(r, now(), 1.5); bed.o2.frequency.setTargetAtTime(r * 1.007, now(), 1.5); bed.o3.frequency.setTargetAtTime(r * 1.5, now(), 1.5); };
  // per frame: tension 0..1 (strongest acquisition), moving 0..1 (mechanisms), still (a held breath)
  A.frame = (tension, acqPitch, moving, still) => {
    if (!A.ok || !bed) return;
    const t = now();
    bed.lp.frequency.setTargetAtTime(300 + tension * 900, t, 0.25);
    bed.g3.gain.setTargetAtTime(tension * 0.35, t, 0.3);
    bed.o3.detune.setTargetAtTime(tension * 70, t, 0.4);
    bed.g.gain.setTargetAtTime(still ? 0.04 : 0.3 + tension * 0.12, t, still ? 0.08 : 0.6);
    acqVoice.ag.gain.setTargetAtTime(tension > 0.02 ? 0.02 + tension * 0.07 : 0, t, 0.08);
    acqVoice.av.frequency.setTargetAtTime(180 + acqPitch * 420, t, 0.08);
    acqVoice.af.frequency.setTargetAtTime(500 + acqPitch * 1800, t, 0.1);
    rumble.rg.gain.setTargetAtTime(moving * 0.32, t, 0.2);
    rumble.rf.frequency.setTargetAtTime(110 + moving * 90, t, 0.3);
  };
  // ---- events ---------------------------------------------------------------
  A.notice = pan => { tone(660, 0.9, 'sine', 0.035, 990, 0, 0.8, pan, 0.25); noise(0.5, 'bandpass', 2400, 8, 0.02, 3600, 0, 0.6, pan, 0.2); };
  A.alert = pan => { tone(330, 0.5, 'sine', 0.018, 360, 0, 0.7, pan, 0.15); };
  A.pin = pan => { tone(92, 0.5, 'sine', 0.22, 60, 0, 0.35, pan); noise(0.12, 'highpass', 3000, 0.8, 0.07, 0, 0, 0.3, pan); tone(1320, 0.4, 'triangle', 0.02, 1240, 0.02, 0.8, pan); };
  A.gaze = pan => { tone(880, 0.12, 'sine', 0.02, 1100, 0, 0.3, pan); };
  A.refuse = pan => { tone(240, 0.25, 'square', 0.025, 180, 0, 0.3, pan); tone(254, 0.25, 'square', 0.02, 190, 0, 0.3, pan); };
  A.release = pan => { noise(0.55, 'lowpass', 1600, 0.7, 0.05, 300, 0, 0.5, pan, 0.05); };
  A.freed = pan => { noise(0.08, 'bandpass', 1800, 3, 0.04, 900, 0, 0.3, pan); tone(420, 0.2, 'sine', 0.02, 300, 0, 0.5, pan); };
  A.link = pan => { tone(523, 1.4, 'sine', 0.022, 0, 0, 0.9, pan, 0.08); tone(784, 1.4, 'sine', 0.014, 0, 0.04, 0.9, pan, 0.08); };
  A.unlink = pan => { tone(1180, 0.18, 'triangle', 0.05, 380, 0, 0.6, pan); noise(0.05, 'highpass', 5000, 1, 0.05, 0, 0, 0.2, pan); };
  A.prime = pan => { tone(62, 0.9, 'sawtooth', 0.05, 48, 0, 0.4, pan, 0.08); noise(0.6, 'bandpass', 520, 6, 0.05, 260, 0, 0.5, pan, 0.06); };
  A.alarm = pan => { tone(146.8, 1.2, 'sawtooth', 0.05, 138, 0, 0.8, pan, 0.1); tone(155.6, 1.2, 'sawtooth', 0.04, 147, 0, 0.8, pan, 0.1); };
  A.liar = pan => { noise(0.25, 'bandpass', 900, 5, 0.06, 2200, 0, 0.6, pan); tone(300, 0.6, 'sine', 0.03, 600, 0.05, 0.8, pan); };
  A.falseReveal = pan => { noise(0.3, 'highpass', 2500, 1, 0.05, 0, 0, 0.4, pan); tone(200, 0.4, 'triangle', 0.03, 150, 0, 0.4, pan); };
  A.awaken = pan => { tone(110, 2.0, 'sine', 0.06, 123, 0, 0.9, pan, 0.6); noise(1.2, 'bandpass', 700, 4, 0.03, 1400, 0, 0.8, pan, 0.4); };
  A.step = k => { noise(0.05, 'bandpass', 900 + Math.random() * 300, 2.5, 0.012 + k * 0.012, 0, 0, 0.1); };
  A.caught = () => {
    const base = 110;
    for (const r of [1, 1.06, 1.19, 1.5, 1.59]) tone(base * r * 2, 1.6, 'sawtooth', 0.025, base * r * 2.2, 0, 0.9, 0, 0.5);
    noise(1.6, 'bandpass', 600, 3, 0.06, 2600, 0, 0.9, 0, 0.6);
  };
  A.fall = () => { noise(1.2, 'bandpass', 1400, 2, 0.06, 200, 0, 0.6, 0, 0.05); tone(300, 1.1, 'sine', 0.04, 70, 0, 0.6); };
  A.won = () => { for (const [f, d] of [[220, 0], [330, 0.08], [440, 0.16], [554.4, 0.26]]) tone(f, 2.6, 'sine', 0.035, 0, d, 0.9, 0, 0.3); };
  A.ending = () => { for (const [f, d] of [[110, 0], [164.8, 0.3], [220, 0.6], [277.2, 0.9], [329.6, 1.3], [440, 1.8]]) tone(f, 6, 'sine', 0.04, 0, d, 1, 0, 0.8); };
  A.ui = () => { tone(740, 0.08, 'sine', 0.02, 0, 0, 0.2); };
  return A;
}

// ---- 16_hud.js ----
// =====================================================================
// HUD: a restrained DOM layer. Inter, sentence case, very few words.
// Gameplay shows only: a pause control, a brief encounter label, one
// contextual hint line, the movement stick, the gaze reticle, and amber
// edge marks for eyes off screen that are acquiring you.
// =====================================================================

const HUD_CSS = `
.tw{position:absolute;inset:0;pointer-events:none;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#efe6d2;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;
  --st:var(--plethora-content-safe-top,0px);--sb:var(--plethora-content-safe-bottom,120px);--sl:var(--plethora-content-safe-left,0px);--sr:var(--plethora-content-safe-right,0px);--ochre:#e3a94f;--bone:#efe6d2;--ink:#0f0e0b}
.tw *{box-sizing:border-box}
.tw-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 52%,rgba(8,7,5,.55) 100%);}
.tw-ink{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(10,8,5,0) 0%,rgba(10,8,5,0) 35%,rgba(10,8,5,.92) 75%);transition:none}
.tw-fade{position:absolute;inset:0;background:#0d0c09;opacity:1;transition:opacity .5s ease}
.tw-top{position:absolute;left:calc(var(--sl) + 16px);right:calc(var(--sr) + 16px);top:calc(var(--st) + 14px);display:flex;justify-content:space-between;align-items:flex-start}
.tw-label{font-size:13px;font-weight:600;letter-spacing:.01em;opacity:0;transition:opacity .8s ease;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.tw-label small{display:block;font-weight:400;opacity:.62;font-size:12px;margin-top:2px}
.tw-label.on{opacity:1}
.tw-btn{pointer-events:auto;width:44px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:rgba(15,14,11,.38);border:1px solid rgba(239,230,210,.22);color:#efe6d2;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tw-btn:active{background:rgba(15,14,11,.6)}
.tw-btn svg{width:18px;height:18px}
.tw-prog{display:flex;gap:3px;margin-top:10px;opacity:.0;transition:opacity .8s}
.tw-prog.on{opacity:.75}
.tw-prog i{width:6px;height:2px;background:rgba(239,230,210,.25);display:block}
.tw-prog i.d{background:rgba(239,230,210,.75)}
.tw-prog i.c{background:var(--ochre)}
.tw-hint{position:absolute;left:50%;top:calc(var(--st) + 70px);transform:translate(-50%,-6px);max-width:min(84vw,360px);text-align:center;font-size:15px;font-weight:600;line-height:1.35;padding:9px 14px;border-radius:10px;background:rgba(15,14,11,.55);opacity:0;transition:opacity .45s ease,transform .45s ease;text-shadow:0 1px 4px rgba(0,0,0,.4)}
.tw-hint.on{opacity:1;transform:translate(-50%,0)}
.tw-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:56px;border:1.5px solid rgba(239,230,210,.35);background:rgba(15,14,11,.18);opacity:0;transition:opacity .2s}
.tw-stick b{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:23px;background:rgba(239,230,210,.82);box-shadow:0 2px 10px rgba(0,0,0,.4)}
.tw-stick.on{opacity:1}
.tw-stick.ghost{opacity:.85;animation:twghost 2.4s ease-in-out infinite}
.tw-stick.ghost b{animation:twknob 2.4s ease-in-out infinite}
@keyframes twknob{0%,15%{transform:translate(0,0)}45%,60%{transform:translate(0,-30px)}90%,100%{transform:translate(0,0)}}
@keyframes twghost{0%,100%{opacity:.35}50%{opacity:.9}}
.tw-ret{position:absolute;width:0;height:0;opacity:0;transition:opacity .15s}
.tw-ret svg{position:absolute;left:-40px;top:-40px;width:80px;height:80px;overflow:visible}
.tw-ret.on{opacity:1}
.tw-focus{position:absolute;width:0;height:0;opacity:0;transition:opacity .3s}
.tw-focus.on{opacity:1}
.tw-focus svg{position:absolute;left:-46px;top:-46px;width:92px;height:92px;overflow:visible;animation:twpulse 1.4s ease-in-out infinite}
@keyframes twpulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:.45}}
.tw-edge{position:absolute;width:0;height:0}
.tw-edge svg{position:absolute;left:-14px;top:-14px;width:28px;height:28px;overflow:visible}
.tw-panel{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;padding:calc(var(--st) + 24px) calc(var(--sr) + 24px) calc(var(--sb) + 18px) calc(var(--sl) + 24px);opacity:0;pointer-events:none;transition:opacity .5s ease}
.tw-panel.on{opacity:1;pointer-events:auto}
.tw-panel.dim{background:linear-gradient(rgba(12,11,8,.25),rgba(12,11,8,.82) 62%)}
.tw-title{font-size:34px;line-height:1.02;font-weight:700;letter-spacing:-.02em;margin:0 0 10px;max-width:320px}
.tw-sub{font-size:14px;line-height:1.45;opacity:.72;max-width:300px;margin:0 0 26px}
.tw-actions{display:flex;flex-direction:column;gap:10px;max-width:340px}
.tw-b{pointer-events:auto;font:inherit;font-size:16px;font-weight:600;height:52px;border-radius:12px;border:0;background:#efe6d2;color:#15130e;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:left;padding:0 18px;display:flex;align-items:center;justify-content:space-between}
.tw-b.sec{background:rgba(239,230,210,.1);color:#efe6d2;border:1px solid rgba(239,230,210,.2)}
.tw-b small{font-weight:400;opacity:.6;font-size:13px}
.tw-b:active{transform:scale(.99)}
.tw-row{display:flex;gap:10px}
.tw-row .tw-b{flex:1;justify-content:center}
.tw-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;max-height:52vh;margin:0 0 14px;pointer-events:auto;-webkit-overflow-scrolling:touch}
.tw-li{pointer-events:auto;display:flex;align-items:baseline;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(239,230,210,.08);font-size:15px;cursor:pointer;background:none;border-left:0;border-right:0;border-top:0;color:inherit;font-family:inherit;text-align:left}
.tw-li span{font-variant-numeric:tabular-nums;opacity:.5;width:22px;font-size:13px}
.tw-li em{font-style:normal;margin-left:auto;font-size:12px;opacity:.5}
.tw-li.lock{opacity:.32;cursor:default}
.tw-li.cur{color:var(--ochre)}
.tw-act{font-size:12px;font-weight:600;opacity:.45;margin:14px 0 4px;letter-spacing:.02em}
.tw-seen{position:absolute;left:0;right:0;top:44%;text-align:center;font-size:15px;font-weight:600;opacity:0;transition:opacity .3s;letter-spacing:.02em}
.tw-seen.on{opacity:.9}
.tw-seen small{display:block;font-weight:400;font-size:14px;opacity:.75;margin-top:10px;padding:0 32px}
.tw-card{position:absolute;left:calc(var(--sl) + 24px);right:calc(var(--sr) + 24px);top:40%;opacity:0;transition:opacity .7s ease}
.tw-card.on{opacity:1}
.tw-card b{display:block;font-size:13px;font-weight:600;opacity:.55;margin-bottom:6px;font-variant-numeric:tabular-nums}
.tw-card div{font-size:28px;font-weight:700;letter-spacing:-.015em}
.tw-board{font-size:13px;opacity:.85;margin:0 0 18px;max-width:320px}
.tw-board div{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(239,230,210,.08)}
.tw-board .me{color:var(--ochre)}
.tw-stats{display:flex;gap:28px;margin:0 0 22px}
.tw-stats div{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.tw-stats small{display:block;font-size:12px;font-weight:400;opacity:.55;margin-top:2px}
`;

const ICON = {
  pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  ret: '<svg viewBox="-40 -40 80 80"><circle r="30" fill="none" stroke="rgba(255,246,220,.28)" stroke-width="2"/><circle class="p" r="30" fill="none" stroke="#fff6dc" stroke-width="2.6" stroke-dasharray="188.5" stroke-dashoffset="188.5" transform="rotate(-90)" stroke-linecap="round"/><path class="tk" d="M0,-36V-30M36,0H30M0,36V30M-36,0H-30" stroke="#fff6dc" stroke-width="2.2" stroke-linecap="round"/></svg>',
  focus: '<svg viewBox="-46 -46 92 92"><circle r="38" fill="none" stroke="#e3a94f" stroke-width="2.5" stroke-dasharray="6 7"/></svg>',
  edge: '<svg viewBox="-14 -14 28 28"><path d="M-6,-8L8,0L-6,8Z" fill="#e3a94f"/></svg>'
};

function createHud(ctx) {
  const ui = ctx.createRoot({ className: 'tw', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = HUD_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = { ui, el };
  H.vig = el('div', 'tw-vig');
  H.ink = el('div', 'tw-ink');
  H.edges = el('div', ''); H.edgePool = [];
  H.focus = el('div', 'tw-focus', ICON.focus);
  H.ret = el('div', 'tw-ret', ICON.ret); H.retP = H.ret.querySelector('.p'); H.retTk = H.ret.querySelector('.tk');
  H.stick = el('div', 'tw-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.top = el('div', 'tw-top');
  const tl = el('div', '', '', H.top);
  H.label = el('div', 'tw-label', '', tl);
  H.prog = el('div', 'tw-prog', '', tl);
  H.pause = el('div', 'tw-btn', ICON.pause, H.top); H.pause.setAttribute('role', 'button'); H.pause.setAttribute('aria-label', 'Pause');
  H.hint = el('div', 'tw-hint');
  H.seen = el('div', 'tw-seen');
  H.card = el('div', 'tw-card');
  H.fade = el('div', 'tw-fade');
  H.panels = {};
  H.panel = (id, dim) => { const p = el('div', 'tw-panel' + (dim ? ' dim' : '')); H.panels[id] = p; return p; };
  H.show = id => { for (const k in H.panels) H.panels[k].classList.toggle('on', k === id); };
  H.inGame = on => { H.top.style.display = on ? '' : 'none'; };
  // hint line
  let hintTimer = 0, hintId = null;
  H.setHint = (text, id, ms) => {
    if (!text) { H.hint.classList.remove('on'); hintId = null; return; }
    if (hintId === id && H.hint.classList.contains('on')) return;
    hintId = id; H.hint.textContent = text; H.hint.classList.add('on'); hintTimer = ms || 0;
  };
  H.hintId = () => hintId;
  H.tickHint = dt => { if (hintTimer > 0) { hintTimer -= dt * 1000; if (hintTimer <= 0) { H.hint.classList.remove('on'); } } };
  H.setLabel = (n, name, ms) => {
    H.label.innerHTML = `${String(n).padStart(2, '0')}<small>${name}</small>`;
    H.label.classList.add('on');
    clearTimeout(H._lt); H._lt = setTimeout(() => H.label.classList.remove('on'), ms || 4200);
  };
  H.setProgress = (cur, cleared, total) => {
    let s = '';
    for (let i = 0; i < total; i++) s += `<i class="${i === cur ? 'c' : i < cleared ? 'd' : ''}"></i>`;
    H.prog.innerHTML = s; H.prog.classList.add('on');
    clearTimeout(H._pt); H._pt = setTimeout(() => H.prog.classList.remove('on'), 4200);
  };
  H.edgeMark = (i, x, y, ang, a) => {
    let m = H.edgePool[i];
    if (!m) { m = el('div', 'tw-edge', ICON.edge, H.edges); H.edgePool[i] = m; }
    m.style.display = '';
    m.style.transform = `translate(${x}px,${y}px) rotate(${ang}rad) scale(${0.8 + a * 0.6})`;
    m.style.opacity = String(0.35 + a * 0.65);
  };
  H.edgeHide = from => { for (let i = from; i < H.edgePool.length; i++) H.edgePool[i].style.display = 'none'; };
  return H;
}

// ---- 17_game.js ----
// =====================================================================
// The game: Plethora entry, loading, input, the campaign, the loop.
// =====================================================================
const SAVE_KEY = 'ttwb_save_v1';
const defaultSave = () => ({ v: 1, cleared: 0, current: 0, sound: true, quality: -1, totalMs: 0, seen: 0, bestMs: 0, finished: false, encMs: {} });

window.plethoraBit = {
  meta: { title: 'The Thing That Watches Back', runtime: 'plethora-bit@2', tags: ['horror', '3d', 'puzzle', 'stealth'], permissions: ['audio', 'haptics', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object' && s.v === 1) save = Object.assign(defaultSave(), s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined; return v === undefined || v === null ? d : v; } catch (e) { return d; } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---- first frame: a DOM shell painted before anything loads ----------------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 38%,#4a4a36 0%,#24261d 55%,#0d0c09 100%)';
    const H = createHud(ctx);
    H.inGame(false);
    // title panel
    const tp = H.panel('title', true);
    H.el('div', 'tw-title', 'The thing that watches back', tp);
    H.tsub = H.el('div', 'tw-sub', 'A place built to notice you. Hold its eyes, one at a time.', tp);
    const ta = H.el('div', 'tw-actions', '', tp);
    H.bBegin = H.el('button', 'tw-b', 'Loading…', ta); H.bBegin.disabled = true;
    H.bEnc = H.el('button', 'tw-b sec', 'Encounters', ta);
    H.show('title');
    H.fade.style.opacity = '0';
    try { if (ctx.markVisualReady) ctx.markVisualReady('title'); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
    let readySent = false;
    const sendReady = () => { if (readySent) return; readySent = true; try { ctx.platform.ready(); } catch (e) { } };
    const bootFail = (stage, err) => {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      H.tsub.textContent = stage === 'library' ? 'The 3D library could not be downloaded. Check the connection and try again.' : 'This device could not start the 3D renderer.';
      H.bBegin.disabled = false; H.bBegin.textContent = 'Try again';
      H.bBegin.onclick = () => { H.bBegin.onclick = null; H.bBegin.disabled = true; H.bBegin.textContent = 'Loading…'; H.tsub.textContent = ''; boot(); };
      sendReady();
    };

    // ---- load three -------------------------------------------------------------
    let renderer = null, view = null, audio = createAudio();
    audio.setOn(save.sound);
    ctx.onDestroy(() => { try { audio.close(); } catch (e) { } try { if (view) view.clear(); if (renderer) renderer.dispose(); } catch (e) { } });
    async function boot() {
      try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
      if (destroyed) return;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
      } catch (e) { bootFail('renderer', e); return; }
      try { initGfx(); } catch (e) { bootFail('renderer', e); return; }
      let q = save.quality >= 0 ? save.quality : ((ctx.nativeDpr || 1) >= 3 ? 1 : 2);
      view = createView(renderer, { quality: q });
      ctx.onResize(layout, { immediate: true });
      try {
        loadEncounter(save.finished ? 0 : clamp(save.current, 0, ENCOUNTERS.length - 1), 0, true);
        view.update(G.W, 0.016); view.render();
      } catch (e) { bootFail('first-frame', e); console.error(e); return; }
      H.bBegin.disabled = false;
      H.bBegin.innerHTML = save.cleared > 0 && !save.finished ? `Continue <small>${String(save.current + 1).padStart(2, '0')} · ${ENCOUNTERS[save.current].name}</small>` : 'Begin';
      mode = 'title';
      sendReady();
      startLoop();
    }
    function layout() {
      if (!view) return;
      const w = ctx.width, h = ctx.height;
      const dprCap = view.quality > 1 ? 2 : view.quality > 0 ? 1.5 : 1;
      view.resize(w, h, Math.min(ctx.dpr || 1, dprCap));
    }

    // ---- campaign state -------------------------------------------------------------
    const G = { W: null, idx: 0, cp: 0, fails: 0, encT: 0, runMs: save.totalMs || 0, hintsDone: {}, lastHint: null, statusT: 0, stillT: 0, attempt: 0 };
    let mode = 'boot', acc = 0, transT = 0, transKind = null, ended = false;
    function mods() { return { acquire: tune('acquire_scale', 1), speed: tune('walk_speed', 1), mech: tune('mechanism_speed', 1) }; }
    function loadEncounter(idx, cp, quiet) {
      G.idx = idx; G.cp = cp || 0;
      G.W = createWorld(ENCOUNTERS[idx], { checkpoint: G.cp, mods: mods() });
      view.setEncounter(G.W);
      view.updateCamera(G.W, 0.016, true);
      G.encT = 0; G.hintsDone = {}; G.lastHint = null; G.statusT = 0; G.stillT = 0;
      setGazeInput(null);
      audio.setAct(ENCOUNTERS[idx].look);
      if (!quiet) {
        H.setLabel(idx + 1, ENCOUNTERS[idx].name);
        H.setProgress(idx, save.cleared, ENCOUNTERS.length);
      }
    }
    function beginPlay() {
      audio.unlock();
      try { ctx.platform.start({ encounter: G.idx + 1 }); } catch (e) { }
      G.attempt++;
      H.show(null); H.inGame(true);
      mode = 'play';
      H.setLabel(G.idx + 1, ENCOUNTERS[G.idx].name);
      H.setProgress(G.idx, save.cleared, ENCOUNTERS.length);
    }
    function restartEncounter() {
      loadEncounter(G.idx, G.cp, true);
      mode = 'play';
    }

    // ---- input -------------------------------------------------------------------------
    const input = { stick: null, keys: {}, gazeTouches: new Map() };
    function setGazeInput(id) { if (G.W) { if (id && G.W.gaze.target !== id) audio.gaze(panOf(G.W.eyeById[id])); setGaze(G.W, id); } }
    function panOf(e) { if (!e || !view) return 0; const s = view.toScreen(e.pos); return clamp((s.x / view.width) * 2 - 1, -1, 1) * 0.7; }
    const rectOf = () => canvas.getBoundingClientRect();
    ctx.listen(canvas, 'pointerdown', ev => {
      if (mode !== 'play') return;
      audio.unlock();
      const r = rectOf(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { }
      const inStickZone = x < view.width * 0.55 && y > view.height * 0.4;
      if (inStickZone && !input.stick) {
        input.stick = { id: ev.pointerId, x0: x, y0: y, x, y, t0: performance.now(), active: false };
        H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px';
      } else {
        const id = view.pickEye(x, y, 48);
        input.gazeTouches.set(ev.pointerId, { x0: x, y0: y, t0: performance.now(), picked: id, moved: false });
        if (id) { setGazeInput(id); try { ctx.platform.interact({ type: 'gaze' }); } catch (e) { } }
      }
      ev.preventDefault();
    }, { passive: false });
    ctx.listen(canvas, 'pointermove', ev => {
      if (mode !== 'play') return;
      const r = rectOf(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (input.stick && input.stick.id === ev.pointerId) {
        const s = input.stick; s.x = x; s.y = y;
        if (!s.active && (Math.hypot(x - s.x0, y - s.y0) > 7 || performance.now() - s.t0 > 160)) { s.active = true; H.stick.classList.add('on'); H.stick.classList.remove('ghost'); }
        // the base follows a thumb that wanders too far
        const dx = x - s.x0, dy = y - s.y0, d = Math.hypot(dx, dy), max = 52;
        if (d > max * 1.5) { s.x0 = x - dx / d * max * 1.5; s.y0 = y - dy / d * max * 1.5; H.stick.style.left = s.x0 + 'px'; H.stick.style.top = s.y0 + 'px'; }
        return;
      }
      const gt = input.gazeTouches.get(ev.pointerId);
      if (gt) {
        if (Math.hypot(x - gt.x0, y - gt.y0) > 12) gt.moved = true;
        if (gt.moved) { const id = view.pickEye(x, y, 40); if (id && id !== G.W.gaze.target) { gt.picked = id; setGazeInput(id); } }
      }
    });
    const up = ev => {
      if (input.stick && input.stick.id === ev.pointerId) {
        const s = input.stick;
        if (!s.active && performance.now() - s.t0 < 260) {
          // a quick tap in the stick zone is still a look
          const id = view.pickEye(s.x0, s.y0, 48);
          if (id) setGazeInput(id); else if (G.W && G.W.gaze.target) { setGazeInput(null); }
        }
        input.stick = null; H.stick.classList.remove('on');
        return;
      }
      const gt = input.gazeTouches.get(ev.pointerId);
      if (gt) {
        input.gazeTouches.delete(ev.pointerId);
        if (!gt.picked && !gt.moved && performance.now() - gt.t0 < 400 && mode === 'play') setGazeInput(null); // tap on nothing: look away
      }
    };
    ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(window, 'keydown', ev => {
      input.keys[ev.code] = true;
      if (ev.code === 'Escape' || ev.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'pause') resumeGame(); }
      if (mode === 'play' && (ev.code === 'Space' || ev.code === 'KeyQ')) { setGazeInput(null); ev.preventDefault(); }
      if (mode === 'play' && ev.code === 'KeyE') cycleGaze();
    });
    ctx.listen(window, 'keyup', ev => { input.keys[ev.code] = false; });
    ctx.listen(window, 'blur', () => { input.keys = {}; });
    function cycleGaze() {
      const W = G.W; if (!W) return;
      const vis = W.eyes.filter(e => { const s = view.toScreen(e.pos); return !s.behind && s.x > 0 && s.x < view.width && s.y > 0 && s.y < view.height; });
      vis.sort((a, b) => view.toScreen(a.pos).x - view.toScreen(b.pos).x);
      if (!vis.length) return;
      const i = vis.findIndex(e => e.id === W.gaze.target);
      setGazeInput(vis[(i + 1) % vis.length].id);
    }
    function readMove() {
      let mx = 0, mz = 0;
      const k = input.keys;
      if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1;
      if (k.KeyW || k.ArrowUp) mz -= 1; if (k.KeyS || k.ArrowDown) mz += 1;
      if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
      const s = input.stick;
      if (s && s.active) {
        const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot(dx, dy), max = 46;
        const m = Math.min(1, d / max);
        const kx = d > 0 ? dx / d : 0, ky = d > 0 ? dy / d : 0;
        H.knob.style.transform = `translate(${kx * Math.min(d, max)}px,${ky * Math.min(d, max)}px)`;
        if (m > 0.12) { const mm = Math.min(1, (m - 0.12) / 0.7); mx = kx * mm; mz = ky * mm; }
      }
      return [mx, mz];
    }

    // ---- buttons --------------------------------------------------------------------------
    ctx.input.activate(H.bBegin, () => {
      if (mode !== 'title' || H.bBegin.disabled) return;
      audio.unlock(); audio.ui();
      if (save.finished) { save.finished = false; save.totalMs = 0; save.seen = 0; G.runMs = 0; persist(); loadEncounter(0, 0, true); }
      beginPlay();
    });
    // encounters list
    const ep = H.panel('enc', true);
    const eList = H.el('div', 'tw-list', '', ep);
    const eBack = H.el('button', 'tw-b sec', 'Back', ep);
    let encFrom = 'title';
    function renderEncList() {
      let s = '', act = 0;
      const names = ['Attention', 'Relationships', 'Deception', 'Convergence'];
      ENCOUNTERS.forEach((d, i) => {
        if (d.act !== act) { act = d.act; s += `<div class="tw-act">Act ${act} — ${names[act - 1]}</div>`; }
        const lock = i > save.cleared;
        s += `<button class="tw-li${lock ? ' lock' : ''}${i === G.idx ? ' cur' : ''}" data-i="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${lock ? '—' : d.name}<em>${save.encMs[d.id] ? fmtTime(save.encMs[d.id]) : ''}</em></button>`;
      });
      eList.innerHTML = s;
    }
    ctx.listen(eList, 'click', ev => {
      const b = ev.target.closest('[data-i]'); if (!b) return;
      const i = +b.dataset.i; if (i > save.cleared) return;
      audio.unlock(); audio.ui();
      loadEncounter(i, 0, true);
      save.current = i; persist();
      beginPlay();
    });
    ctx.input.activate(H.bEnc, () => { encFrom = 'title'; renderEncList(); H.show('enc'); audio.ui(); });
    ctx.input.activate(eBack, () => { H.show(encFrom); audio.ui(); });
    // pause
    const pp = H.panel('pause', true);
    H.el('div', 'tw-title', 'Paused', pp);
    H.pauseSub = H.el('div', 'tw-sub', '', pp);
    const pa = H.el('div', 'tw-actions', '', pp);
    const bResume = H.el('button', 'tw-b', 'Resume', pa);
    const bRestart = H.el('button', 'tw-b sec', 'Restart encounter', pa);
    const bEncs = H.el('button', 'tw-b sec', 'Encounters', pa);
    const bSound = H.el('button', 'tw-b sec', '', pa);
    const renderSound = () => { bSound.innerHTML = `Sound <small>${save.sound ? 'On' : 'Off'}</small>`; };
    renderSound();
    function pauseGame() { if (mode !== 'play') return; mode = 'pause'; H.pauseSub.textContent = `${String(G.idx + 1).padStart(2, '0')} · ${ENCOUNTERS[G.idx].name}`; H.show('pause'); H.setHint(null); input.stick = null; H.stick.classList.remove('on'); }
    function resumeGame() { if (mode !== 'pause') return; mode = 'play'; H.show(null); }
    ctx.input.activate(H.pause, () => { if (mode === 'play') { pauseGame(); audio.ui(); } else if (mode === 'pause') resumeGame(); });
    ctx.input.activate(bResume, () => { resumeGame(); audio.ui(); });
    ctx.input.activate(bRestart, () => { audio.ui(); H.show(null); G.cp = 0; restartEncounter(); });
    ctx.input.activate(bEncs, () => { encFrom = 'pause'; renderEncList(); H.show('enc'); audio.ui(); });
    ctx.input.activate(bSound, () => { save.sound = !save.sound; persist(); audio.setOn(save.sound); renderSound(); audio.ui(); });
    // ending
    const np = H.panel('end', true);
    H.el('div', 'tw-title', 'It watches back', np);
    H.endSub = H.el('div', 'tw-sub', '', np);
    H.endStats = H.el('div', 'tw-stats', '', np);
    H.board = H.el('div', 'tw-board', '', np);
    const na = H.el('div', 'tw-actions', '', np);
    const bAgain = H.el('button', 'tw-b', 'Play again', na);
    const bEnc2 = H.el('button', 'tw-b sec', 'Encounters', na);
    ctx.input.activate(bAgain, () => { audio.ui(); save.finished = false; save.totalMs = 0; save.seen = 0; G.runMs = 0; persist(); loadEncounter(0, 0, true); beginPlay(); });
    ctx.input.activate(bEnc2, () => { encFrom = 'end'; renderEncList(); H.show('enc'); audio.ui(); });

    // ---- outcomes -----------------------------------------------------------------------------
    function onEvents(W) {
      for (const ev of W.events) {
        const e = ev.id ? W.eyeById[ev.id] : null, pan = e ? panOf(e) : 0;
        switch (ev.type) {
          case 'notice': audio.notice(pan); if (view.player) view.player.flinch = 1; haptic('light'); break;
          case 'alert': audio.alert(pan); break;
          case 'pin': audio.pin(pan); haptic('medium'); try { ctx.platform.interact({ type: 'pin' }); } catch (er) { } break;
          case 'release': audio.release(pan); break;
          case 'freed': audio.freed(pan); break;
          case 'link': audio.link(panOf(W.eyeById[ev.a])); break;
          case 'unlink': audio.unlink(panOf(W.eyeById[ev.a])); view.snapBeam(ev.a, ev.b); break;
          case 'mech_prime': audio.prime(0); pulseTendons(view.world, ev.id); break;
          case 'gaze_refused': audio.refuse(pan); haptic('warning'); break;
          case 'false_reveal': audio.falseReveal(pan); break;
          case 'liar_open': audio.liar(pan); haptic('warning'); break;
          case 'alarm': audio.alarm(pan); haptic('warning'); break;
          case 'awaken': audio.awaken(pan); break;
          case 'caught': audio.caught(); haptic('error'); break;
          case 'fall_start': audio.fall(); break;
          case 'won': audio.won(); haptic('success'); break;
        }
      }
      W.events.length = 0;
    }
    function encounterCleared() {
      const W = G.W, d = ENCOUNTERS[G.idx];
      const ms = Math.round(G.encT * 1000);
      if (!save.encMs[d.id] || ms < save.encMs[d.id]) save.encMs[d.id] = ms;
      save.cleared = Math.max(save.cleared, G.idx + 1);
      try { ctx.platform.milestone('encounter_clear', { encounter: G.idx + 1 }); ctx.platform.setProgress((G.idx + 1) / ENCOUNTERS.length); } catch (e) { }
      if (G.idx + 1 >= ENCOUNTERS.length) { save.current = 0; persist(); startEnding(); return; }
      save.current = G.idx + 1; persist();
      try { if (ctx.game && ctx.game.progress && ctx.manifest && ctx.manifest.game) ctx.game.progress.save('campaign', { state: { enc: G.idx + 1 }, label: `${String(G.idx + 2).padStart(2, '0')} · ${ENCOUNTERS[G.idx + 1].name}`, percent: (G.idx + 1) / ENCOUNTERS.length }).catch(() => { }); } catch (e) { }
      // transition: the iris closes, then opens on the next place
      mode = 'trans'; transT = 0; transKind = 'next';
    }
    function startEnding() {
      mode = 'ending'; transT = 0; ended = true;
      save.finished = true;
      const total = G.runMs;
      if (!save.bestMs || total < save.bestMs) save.bestMs = total;
      persist();
      audio.ending();
      try { ctx.platform.complete({ timeMs: total, seen: save.seen }); } catch (e) { }
      try { if (ctx.game && ctx.game.progress && ctx.manifest && ctx.manifest.game) ctx.game.progress.complete('campaign').catch(() => { }); } catch (e) { }
      const att = G.attempt;
      H.endSub.textContent = 'You held every eye that mattered, and walked into the one that never closes.';
      H.endStats.innerHTML = `<div>${fmtTime(total)}<small>Campaign time</small></div><div>${save.seen}<small>Times seen</small></div>`;
      H.board.innerHTML = '';
      try {
        if (ctx.memory && ctx.manifest && ctx.manifest.memory && ctx.manifest.memory.records && ctx.manifest.memory.records.campaign_time) {
          H.board.innerHTML = '<div><span>Leaderboard</span><span>Updating…</span></div>';
          const rec = ctx.memory.record('campaign_time');
          rec.submit(total, { label: fmtTime(total) }).then(() => rec.leaderboard({ scope: 'global', period: 'all_time', limit: 3 })).then(lb => {
            if (destroyed || att !== G.attempt) return;
            let s = '';
            for (const r of (lb.rows || []).slice(0, 3)) s += `<div><span>${r.rank}. ${escapeHtml(r.username || r.displayName || 'Player')}</span><span>${r.displayLabel || fmtTime(r.value)}</span></div>`;
            if (lb.viewerRank && lb.viewerRank.rank) s += `<div class="me"><span>You: ${lb.viewerRank.rank} of ${lb.totalRanked || '—'}</span><span>${fmtTime(total)}</span></div>`;
            H.board.innerHTML = s || '<div><span>Leaderboard</span><span>No times yet</span></div>';
          }).catch(() => { if (!destroyed && att === G.attempt) H.board.innerHTML = '<div><span>Leaderboard</span><span>Unavailable right now</span></div>'; });
        }
      } catch (e) { }
    }
    function fmtTime(ms) { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

    // ---- hints: one short line, only when it is useful -------------------------------------------
    function updateHints(W, dt) {
      const d = ENCOUNTERS[G.idx];
      let shown = null;
      for (const h of d.hints || []) {
        if (G.hintsDone[h.id]) continue;
        if (h.when && !h.when(W)) continue;
        if (h.until && h.until(W)) { G.hintsDone[h.id] = true; if (H.hintId() === h.id) H.setHint(null); continue; }
        shown = h; break;
      }
      if (G.fails >= 2 && d.failHint && G.encT < 6) shown = { id: 'fail', text: d.failHint, ms: 6000 };
      if (shown) {
        if (H.hintId() !== shown.id) { H.setHint(shown.text, shown.id, shown.ms || 0); if (shown.ms) G.hintsDone[shown.id] = true; }
        if (shown.stick && !input.stick && G.encT > 0.8) {
          H.stick.classList.add('ghost'); H.stick.style.left = Math.round(view.width * 0.24) + 'px'; H.stick.style.top = Math.round(view.height * 0.74) + 'px';
        }
        G.focusEye = shown.focus || null;
      } else {
        if (H.hintId() && H.hintId() !== 'fail' && !G.hintsDone[H.hintId()]) H.setHint(null);
        G.focusEye = null;
      }
      if (!shown || !shown.stick || input.stick) H.stick.classList.remove('ghost');
      H.tickHint(dt);
    }

    // ---- per-frame HUD: reticle, focus ring, edge marks, ink -----------------------------------------
    const _s = {};
    function updateHudFrame(W, dt) {
      // gaze reticle
      const g = W.gaze;
      if (g.target && W.eyeById[g.target] && mode === 'play') {
        const e = W.eyeById[g.target], s = view.toScreen(e.pos, _s);
        const s2 = view.toScreen(vAdd(e.pos, [0, e.size, 0]));
        const sc = clamp(Math.abs(s2.y - s.y) / 22, 0.7, 2.2);
        H.ret.style.transform = `translate(${s.x}px,${s.y}px) scale(${sc})`;
        H.ret.classList.add('on');
        const pinned = e.state === 'pinned';
        H.retP.setAttribute('stroke-dashoffset', String(188.5 * (1 - (g.refused ? 0.25 : g.focus))));
        H.retP.setAttribute('stroke', g.refused ? '#8a7f68' : e.isFalse && e.revealed ? '#8a7f68' : '#fff6dc');
        H.retP.setAttribute('stroke-dasharray', g.refused ? '6 8' : '188.5');
        H.retTk.style.opacity = pinned ? '1' : '0.3';
      } else H.ret.classList.remove('on');
      // onboarding focus ring
      if (G.focusEye && W.eyeById[G.focusEye] && W.eyeById[G.focusEye].state !== 'pinned' && mode === 'play') {
        const e = W.eyeById[G.focusEye], s = view.toScreen(e.pos, _s);
        const s2 = view.toScreen(vAdd(e.pos, [0, e.size, 0]));
        const sc = clamp(Math.abs(s2.y - s.y) / 22, 0.7, 2.2);
        H.focus.style.transform = `translate(${s.x}px,${s.y}px) scale(${sc})`; H.focus.classList.add('on');
      } else H.focus.classList.remove('on');
      // amber marks at the edge for eyes acquiring you from off screen
      let n = 0, maxAcq = 0;
      const area = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      for (const e of W.eyes) {
        if (e.isFalse) continue;
        maxAcq = Math.max(maxAcq, e.acq);
        if (!(e.seesPlayer || e.acq > 0.08)) continue;
        const s = view.toScreen(e.pos, _s);
        const m = 18;
        const inside = !s.behind && s.x > m && s.x < view.width - m && s.y > area.top + m && s.y < view.height - area.bottom - m;
        if (inside) continue;
        let x = s.x, y = s.y;
        if (s.behind) { x = view.width - x; y = view.height - y; }
        const cx = view.width / 2, cy = view.height / 2;
        const ang = Math.atan2(y - cy, x - cx);
        const bx = clamp(x, 24 + area.left, view.width - 24 - area.right), by = clamp(y, area.top + 60, view.height - area.bottom - 24);
        H.edgeMark(n++, bx, by, ang, e.acq);
      }
      H.edgeHide(n);
      const inkA = mode === 'caught' ? 1 : clamp(maxAcq * 1.15 - 0.15, 0, 1) * 0.85;
      H.ink.style.opacity = String(inkA);
      return maxAcq;
    }

    // ---- the loop ------------------------------------------------------------------------------------
    let stepAcc = 0, stepPhase = 0;
    function tick(dtMs) {
      if (destroyed || !view || !G.W) return;
      const dt = Math.min(0.1, dtMs / 1000);
      const W = G.W;
      if (mode === 'play') {
        const mv = readMove();
        W.input.mx = mv[0]; W.input.mz = mv[1];
        acc += dt;
        let n = 0;
        while (acc >= SIM_DT && n < 6) { stepWorld(W, SIM_DT); acc -= SIM_DT; n++; }
        if (n >= 6) acc = 0;
        G.encT += dt; G.runMs += dt * 1000;
        onEvents(W);
        if (W.status !== 'play') { G.statusT = 0; mode = W.status === 'won' ? 'winning' : 'caught'; if (mode === 'caught') { G.fails++; save.seen++; persist(); setGazeInput(null); } else { G.fails = 0; } }
        updateHints(W, dt);
        // footsteps
        stepPhase += dt * (W.player.speedNow || 0) * 0.42;
        if (stepPhase > 1) { stepPhase -= 1; audio.step(Math.min(1, (W.player.speedNow || 0) / PLAYER.speed)); }
      } else if (mode === 'caught') {
        G.statusT += dt;
        // the world goes still; every free eye turns to you
        stepWorld(W, SIM_DT); onEvents(W);
        for (const e of W.eyes) if (e.state !== 'dormant' && !e.isFalse) { e.look = rotateToward(e.look, vNorm(vSub(playerChest(W), e.pos)), dt * 2.5); e.seesPlayer = true; e.acq = Math.min(1, e.acq + dt); }
        if (G.statusT > 0.25 && !H.seen.classList.contains('on')) {
          const d = ENCOUNTERS[G.idx];
          H.seen.innerHTML = W.status === 'fell' ? 'Fallen' : 'Seen' + (G.fails >= 2 && d.failHint ? `<small>${d.failHint}</small>` : '');
          H.seen.classList.add('on');
        }
        if (G.statusT > (G.fails >= 2 ? 2.4 : 1.5)) { H.fade.style.transition = 'opacity .35s ease'; H.fade.style.opacity = '1'; }
        if (G.statusT > (G.fails >= 2 ? 2.8 : 1.9)) {
          H.seen.classList.remove('on');
          restartEncounter();
          H.fade.style.opacity = '0';
          try { ctx.platform.fail({ encounter: G.idx + 1, reason: W.status }); ctx.platform.start({ encounter: G.idx + 1, retry: true }); } catch (e) { }
        }
      } else if (mode === 'winning') {
        G.statusT += dt;
        // walk on into the light
        const ex = W.zones.exit, dirx = ex ? 0 : 0;
        W.input.mx = 0; W.input.mz = -0.6;
        stepWorld(W, SIM_DT); onEvents(W);
        if (G.statusT > 0.9) encounterCleared();
      } else if (mode === 'trans') {
        transT += dt;
        H.fade.style.transition = 'opacity .6s ease';
        if (transT < 0.05) { H.fade.style.opacity = '1'; }
        if (transT > 0.7 && transKind === 'next') {
          transKind = 'shown';
          loadEncounter(G.idx + 1, 0, true);
          H.card.innerHTML = `<b>${String(G.idx + 1).padStart(2, '0')}</b><div>${ENCOUNTERS[G.idx].name}</div>`;
          H.card.classList.add('on');
          try { ctx.platform.start({ encounter: G.idx + 1 }); } catch (e) { }
        }
        if (transT > 2.0) { H.card.classList.remove('on'); H.fade.style.opacity = '0'; }
        if (transT > 2.3) { mode = 'play'; H.setLabel(G.idx + 1, ENCOUNTERS[G.idx].name); H.setProgress(G.idx, save.cleared, ENCOUNTERS.length); }
      } else if (mode === 'ending') {
        transT += dt;
        stepWorld(W, SIM_DT); W.events.length = 0;
        view.extraZoom = Math.min(120, transT * transT * 6);
        if (transT > 4.5 && !H.panels.end.classList.contains('on')) { H.show('end'); H.inGame(false); try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ timeMs: G.runMs, text: 'Reached the Centre in ' + fmtTime(G.runMs) }); } catch (e) { } }
      } else if (mode === 'title') {
        // the place breathes behind the title
        stepWorld(W, SIM_DT); W.events.length = 0;
        if (W.status !== 'play') loadEncounter(G.idx, 0, true);
      }
      if (mode !== 'ending') view.extraZoom = damp(view.extraZoom, mode === 'title' ? 6 : 0, 2, dt);
      view.update(W, dt);
      const maxAcq = updateHudFrame(W, dt);
      let moving = 0;
      for (const m of W.movers) if (m.moving) moving = 1;
      let acqP = 0; for (const e of W.eyes) if (e.seesPlayer && !e.isFalse) acqP = Math.max(acqP, e.acq);
      audio.frame(mode === 'play' ? maxAcq : 0, acqP, moving, mode === 'caught' && G.statusT < 0.6);
      view.render();
    }
    function startLoop() {
      if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs), resetOnResume: true, onPause: () => { audio.suspend(); if (mode === 'play') pauseGame(); }, onResume: () => audio.resume() });
      else ctx.onFrame(dtMs => tick(dtMs));
    }
    // dev hook
    if (window.__TTWB_DEV) window.__ttwb = { G, get mode() { return mode; }, begin: () => beginPlay(), load: (i, cp) => { loadEncounter(i, cp || 0, false); mode = 'play'; H.show(null); H.inGame(true); }, setGaze: id => setGazeInput(id), view: () => view, input, save: () => save, pause: pauseGame, resume: resumeGame };
    boot();
  }
};

})();
