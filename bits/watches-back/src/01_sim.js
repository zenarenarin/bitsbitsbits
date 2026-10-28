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
    checkpoint: opts.checkpoint || 0, checkpointReached: 0,
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
  // mechanisms start settled in the state their signal asks for
  const S0 = signalApi(W);
  for (const m of W.movers) {
    if (!m.signal || m.keepStart) continue;
    const want = m.signal(S0) ? 1 : 0; m.lastSig = want;
    if (m.kind !== 'rotor' || m.mode !== 'cont') m.e = want;
    if (m.kind === 'rotor' && m.mode !== 'cont') m.angle = lerp(m.angles[0], m.angles[1], easeInOut(m.e));
  }
  refreshAll(W);
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
      if (e.rail.center) {
        const c = e.rail.center, sg = e.rail.out ? -1 : 1;
        const h = vNorm([(c[0] - e.pos[0]) * sg, 0, (c[2] - e.pos[2]) * sg]);
        e.facing = vNorm([h[0], e.rail.faceY === undefined ? -0.6 : e.rail.faceY, h[2]]);
      }
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
    count: id => (W.observedBy[id] || []).length,
    observedBy: (id, by) => (W.observedBy[id] || []).indexOf(by) >= 0,
    link: (a, b) => (W.observedBy[b] || []).indexOf(a) >= 0,
    pinned: id => { const e = W.eyeById[id]; return !!e && e.state === ST.PINNED; },
    state: id => { const e = W.eyeById[id]; return e ? e.state : null; },
    held: id => (W.observedBy[id] || []).length > 0,
    synced: group => groupSynced(W, group),
    playerIn: zid => inZone(W.zones[zid], W.player.pos[0], W.player.pos[2]),
    flag: k => !!W.flags[k],
    num: k => +W.flags[k] || 0,
    mover: id => W.moverById[id],
    eye: id => W.eyeById[id]
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
    // checkpoints: zones named cp1, cp2 ...
    for (let k = 1; k <= 3; k++) { const z = W.zones['cp' + k]; if (z && W.checkpointReached < k && W.checkpoint < k && inZone(z, W.player.pos[0], W.player.pos[2])) { W.checkpointReached = k; W.emit('checkpoint', { cp: k }); } }
    const ex = W.zones.exit;
    const open = W.def.exitOpen ? W.def.exitOpen(S) : true;
    W.exitOpen = open;
    if (ex && open && !W.player.falling && inZone(ex, W.player.pos[0], W.player.pos[2])) { W.status = 'won'; W.statusT = 0; W.emit('won'); }
  }
  // history of what the player looked at (for mimics)
  W.gazeHist[W.tick % W.gazeHistLen] = W.gaze.target && W.gaze.focus >= 0.3 && W.gaze.lostT === 0 ? W.gaze.target : null;
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
function pinnableNow(e, W) {
  if (e.state === ST.DORMANT) return false;
  if (e.shield && W && groupSynced(W, e.shield) && e.state !== ST.PINNED) return false;
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
  if (!pinnableNow(e, W)) {
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
function canHoldLink(e) { return !e.isFalse && (e.state === ST.ACTIVE || e.state === ST.SEARCHING || e.state === ST.DISRUPTED); }

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
    // closer is faster; a fresh notice starts slow, so there is always a moment to react
    let r = rate * (1 + Math.max(0, 1 - vis.d / e.range) * 0.2) * Math.min(1, 0.45 + e.st * 0.9);
    if (e.type === 'liar' && !e.liarOpen) r *= 0.6;
    e.acq = Math.min(W.t < (W.def.grace === undefined ? 2.2 : W.def.grace) ? 0.25 : 1, e.acq + dt * r);
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
