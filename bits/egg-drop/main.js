// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// EGG DROP: a physics balancing toy. Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_sim.js ----
// Physics: one platform on a pivot, a counterweight carriage on a rail
// hung beneath it, and an egg. Everything is a planck (Box2D) rigid body;
// the platform angle is never set directly, only produced by torques.
// Units are SI: metres, kilograms, seconds, radians.

const SURFACES = {
  rubber:  { label: 'Rubber',  muS: 1.05, muK: 0.85, roll: 0.016, rest: 0.02 },
  wood:    { label: 'Wood',    muS: 0.55, muK: 0.42, roll: 0.005, rest: 0.06 },
  ceramic: { label: 'Ceramic', muS: 0.16, muK: 0.10, roll: 0.0035, rest: 0.10 },
  metal:   { label: 'Metal',   muS: 0.07, muK: 0.04, roll: 0.0015, rest: 0.12 }
};
const SURFACE_ORDER = ['rubber', 'wood', 'ceramic', 'metal'];

const GEOM = {
  half: 2.0,          // deck half length
  deckBottom: 0.04,   // deck sits just above the pivot axle
  deckTop: 0.20,
  railY: -0.5,        // rail rod, in platform frame
  railHalf: 1.62,     // visible rod half length
  travel: 1.36,       // carriage limit either side
  tableY: -2.6,       // the table the egg lands on
  eggA: 0.33,         // egg half length (blunt end towards +x)
  eggB: 0.305,        // egg half width
  eggK: 0.06          // asymmetry: blunt and pointed ends
};

const CAT = { DECK: 1, EGG: 2, TABLE: 4 };

// Egg outline in body coordinates. x along the long axis, blunt end at +x.
function eggOutline(n, A, B, K) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push({ x: A * c, y: B * s * (1 + K * c) });
  }
  return pts;
}

function createSim(pl, opt) {
  opt = opt || {};
  const V = pl.Vec2;
  const surf = SURFACES[opt.surface] || SURFACES.wood;
  const g = 9.81 * (opt.gravityScale || 1);
  const world = new pl.World({ gravity: V(0, -g) });
  const ground = world.createBody();

  // the table under everything, where a fallen egg ends up
  const table = world.createBody({ position: V(0, GEOM.tableY) });
  table.createFixture(new pl.Box(12, 0.3, V(0, -0.3), 0), { friction: 0.6, restitution: 0.05, filterCategoryBits: CAT.TABLE, filterMaskBits: CAT.EGG });

  // platform: deck, hangers and rail form one rigid body
  const platform = world.createBody({ type: 'dynamic', position: V(0, 0), angularDamping: opt.angularDamping != null ? opt.angularDamping : 0.55 });
  const deckH = (GEOM.deckTop - GEOM.deckBottom) / 2, deckY = (GEOM.deckTop + GEOM.deckBottom) / 2;
  const deckMass = 1.35, deckArea = GEOM.half * 2 * deckH * 2;
  const deck = platform.createFixture(new pl.Box(GEOM.half, deckH, V(0, deckY), 0), {
    density: deckMass / deckArea, friction: surf.muS, restitution: surf.rest,
    filterCategoryBits: CAT.DECK, filterMaskBits: CAT.EGG
  });
  // rail rod and two hangers carry mass but collide with nothing
  const railMass = 0.42, railArea = GEOM.railHalf * 2 * 0.05;
  platform.createFixture(new pl.Box(GEOM.railHalf, 0.025, V(0, GEOM.railY), 0), { density: railMass / railArea, filterMaskBits: 0 });
  for (const sx of [-1, 1]) {
    const hx = sx * (GEOM.railHalf - 0.02), len = GEOM.deckBottom - GEOM.railY;
    platform.createFixture(new pl.Box(0.025, len / 2, V(hx, GEOM.railY + len / 2), 0), { density: 0.06 / (0.05 * len), filterMaskBits: 0 });
  }
  const pivot = world.createJoint(new pl.RevoluteJoint({
    enableLimit: true, lowerAngle: -(opt.maxAngle || 0.31), upperAngle: (opt.maxAngle || 0.31),
    // a little bearing friction: the platform does not drift at a whisper
    enableMotor: true, motorSpeed: 0, maxMotorTorque: 0.18
  }, ground, platform, V(0, 0)));

  // counterweight carriage on the rail
  const cwMass = opt.cwMass || 0.95;
  const cw = world.createBody({ type: 'dynamic', position: V(0, GEOM.railY), fixedRotation: false });
  // the brass bell hangs below the rail; its mass centre sits in the bell
  cw.createFixture(new pl.Box(0.24, 0.22, V(0, -0.2), 0), { density: cwMass / (0.48 * 0.44), filterMaskBits: 0 });
  const rail = world.createJoint(new pl.PrismaticJoint({
    enableLimit: true, lowerTranslation: -GEOM.travel, upperTranslation: GEOM.travel,
    enableMotor: true, maxMotorForce: 7, motorSpeed: 0
  }, platform, cw, V(0, GEOM.railY), V(1, 0)));

  // egg: convex fans around the centre form the ovoid. Many small facets,
  // so the shell rolls on its curve rather than resting on flat faces
  const fans = 10, per = 11;
  const outline = eggOutline(fans * per, opt.eggA || GEOM.eggA, opt.eggB || GEOM.eggB, opt.eggK != null ? opt.eggK : GEOM.eggK);
  const eggMass = 0.55;
  let area = 0;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += (a.x * b.y - b.x * a.y) / 2; }
  const egg = world.createBody({ type: 'dynamic', bullet: true, position: V(opt.eggX || 0, GEOM.deckTop + GEOM.eggB + 0.002), angle: 0, linearDamping: 0.02, angularDamping: 0.02 });
  for (let f = 0; f < fans; f++) {
    const verts = [V(0, 0)];
    for (let i = 0; i <= per; i++) { const p = outline[(f * per + i) % outline.length]; verts.push(V(p.x, p.y)); }
    egg.createFixture(new pl.Polygon(verts), { density: eggMass / area, friction: surf.muS, restitution: surf.rest, filterCategoryBits: CAT.EGG, filterMaskBits: CAT.DECK | CAT.TABLE });
  }

  const s = {
    world, platform, cw, egg, pivot, rail, surf, outline, g,
    target: 0, dragging: false, driveGain: 15, driveMax: 3.4, driveForce: 46, brakeForce: 7.5,
    disturb: 0,                // external torque on the platform this step (N·m)
    eggOnDeck: false, eggOnTable: false, deckNormal: 0, tableImpact: 0, deckImpact: 0,
    rollTorque: 0, slipping: false, contactCount: 0,
    limitHit: 0, lastCwSpeed: 0, stopHit: 0, lastAngVel: 0,
    time: 0
  };

  // static vs kinetic friction, chosen from the slip speed at the contact
  world.on('pre-solve', (contact) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const isDeck = fa === deck || fb === deck;
    if (!isDeck) return;
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points.length) return;
    const p = wm.points[0], n = wm.normal;
    const va = platform.getLinearVelocityFromWorldPoint(p), vb = egg.getLinearVelocityFromWorldPoint(p);
    const rvx = vb.x - va.x, rvy = vb.y - va.y;
    const vt = rvx * -n.y + rvy * n.x;
    const slip = Math.abs(vt) > 0.025;
    s.slipping = s.slipping || slip;
    contact.setFriction(slip ? surf.muK : surf.muS);
  });

  world.on('post-solve', (contact, imp) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    let J = 0;
    for (let i = 0; i < imp.normalImpulses.length; i++) J += imp.normalImpulses[i];
    if (fa === deck || fb === deck) { s.deckNormal += J; s.contactCount++; }
    else if (fa.getBody() === table || fb.getBody() === table) { s.tableImpact = Math.max(s.tableImpact, J); }
  });

  world.on('begin-contact', (contact) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points.length) return;
    const p = wm.points[0], n = wm.normal;
    const other = (fa === deck || fb === deck) ? platform : table;
    const va = other.getLinearVelocityFromWorldPoint(p), vb = egg.getLinearVelocityFromWorldPoint(p);
    const vn = Math.abs((vb.x - va.x) * n.x + (vb.y - va.y) * n.y);
    if (other === platform) s.deckImpact = Math.max(s.deckImpact, vn);
    else s.tableImpact = Math.max(s.tableImpact, vn * eggMass);
  });

  s.step = function (h) {
    // carriage drive: a servo motor in the carriage pushes against the rail,
    // so its reaction acts on the platform as well
    const x = rail.getJointTranslation();
    const v = rail.getJointSpeed();
    if (s.dragging) {
      const want = Math.max(-s.driveMax, Math.min(s.driveMax, (s.target - x) * s.driveGain));
      rail.setMotorSpeed(want);
      rail.setMaxMotorForce(s.driveForce);
    } else {
      rail.setMotorSpeed(0);
      rail.setMaxMotorForce(s.brakeForce);
    }

    // rolling resistance: a couple opposing the egg's rolling relative to
    // the deck, proportional to the normal load (lever arm = coefficient)
    s.rollTorque = 0;
    if (s.eggOnDeck) {
      const N = s.lastNormal;
      const wr = egg.getAngularVelocity() - platform.getAngularVelocity();
      const tau = -surf.roll * N * Math.tanh(wr / 0.35);
      egg.applyTorque(tau, true);
      platform.applyTorque(-tau, true);
      s.rollTorque = tau;
    }
    if (s.disturb) platform.applyTorque(s.disturb, true);

    s.deckNormal = 0; s.contactCount = 0; s.slipping = false;
    world.step(h, 10, 4);
    s.time += h;
    s.lastNormal = s.deckNormal / h;
    s.eggOnDeck = s.contactCount > 0;

    // events the presentation listens for
    const x2 = rail.getJointTranslation();
    if (Math.abs(x2) >= GEOM.travel - 0.004 && Math.abs(v) > 0.25 && Math.sign(v) === Math.sign(x2)) s.limitHit = Math.max(s.limitHit, Math.abs(v));
    const ang = platform.getAngle(), w = platform.getAngularVelocity();
    if (Math.abs(ang) >= (opt.maxAngle || 0.31) - 0.003 && Math.abs(s.lastAngVel) > 0.08 && Math.sign(s.lastAngVel) === Math.sign(ang)) s.stopHit = Math.max(s.stopHit, Math.abs(s.lastAngVel));
    s.lastAngVel = w;
    s.lastCwSpeed = rail.getJointSpeed();
  };
  s.lastNormal = 0;

  s.cwPos = () => rail.getJointTranslation();
  s.angle = () => platform.getAngle();
  // egg centre of mass expressed in the platform frame
  s.eggLocal = () => {
    const p = egg.getWorldCenter();
    const l = platform.getLocalPoint(p);
    return { x: l.x, y: l.y };
  };
  s.eggLocalVel = () => {
    const p = egg.getWorldCenter();
    const v = egg.getLinearVelocity(), vp = platform.getLinearVelocityFromWorldPoint(p);
    const a = platform.getAngle(), c = Math.cos(a), sn = Math.sin(a);
    const rx = v.x - vp.x, ry = v.y - vp.y;
    return { x: rx * c + ry * sn, y: -rx * sn + ry * c };
  };
  // the egg has left the deck and dropped past its end
  s.eggFallen = () => {
    const l = s.eggLocal();
    if (egg.getWorldCenter().y < -1.25) return true;
    return !s.eggOnDeck && Math.abs(l.x) > GEOM.half + 0.02 && l.y < GEOM.deckTop + 0.05;
  };
  // torque balance about the pivot (for tests and the HUD's stability read)
  s.gravityTorque = () => {
    let t = 0;
    for (const b of [platform, cw, egg]) { const c = b.getWorldCenter(); t += -b.getMass() * g * c.x; }
    return t;
  };
  s.inertiaAboutPivot = () => {
    let I = 0;
    for (const b of [platform, cw, egg]) { const c = b.getWorldCenter(); I += b.getInertia() - b.getMass() * (b.getLocalCenter().x ** 2 + b.getLocalCenter().y ** 2) + b.getMass() * (c.x * c.x + c.y * c.y); }
    return I;
  };
  return s;
}

// ---- 01_disturb.js ----
// External disturbance: a smoothly varying torque on the platform (the room
// breathing on it), small irregular nudges, and from the later phases on,
// stronger gusts announced a moment ahead. All of it is torque in N·m fed
// into the simulation; nothing here touches an angle.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// piecewise curve through (t, v) keys with smoothstep between them
function keyCurve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0), e = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

const PHASES = [
  { at: 0, name: 'Learning' },
  { at: 10, name: 'Instability' },
  { at: 25, name: 'Pressure' },
  { at: 45, name: 'Survival' }
];

function phaseAt(t) {
  let p = 0;
  for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].at) p = i;
  return p;
}

function createDisturbance(seed, strength) {
  const rnd = mulberry32(seed);
  const k = strength == null ? 1 : strength;
  // drift: three incommensurate slow waves with per-run phases, plus a
  // band-limited random walk that changes the drift's character over time
  const waves = [0, 1, 2].map(i => ({ f: [0.071, 0.113, 0.187][i] * (0.85 + rnd() * 0.3), ph: rnd() * Math.PI * 2, w: [1, 0.55, 0.3][i] }));
  let walk = 0, walkV = 0, phaseClock = 0;
  const nudges = [];   // { t0, dur, amp }
  let nextNudge = 3 + rnd() * 2;
  let gust = null;     // { warnAt, t0, dur, amp, dir }
  let nextGust = 34 + rnd() * 6;
  let gustCount = 0;
  const d = {
    torque: 0, drift: 0, nudge: 0, gustTorque: 0,
    warning: 0, warningDir: 0, gustActive: false, gustJustEnded: false, gustAmp: 0,
    phase: 0, events: []
  };

  // eggSide: -1/0/1, the side the egg currently endangers (|x| near an end).
  // Fairness: a nudge or gust never starts towards an egg already in danger.
  d.update = function (t, h, eggSide) {
    d.events.length = 0;
    d.gustJustEnded = false;
    d.phase = phaseAt(t);
    const ampDrift = keyCurve([[0, 0.28], [10, 0.8], [25, 1.7], [45, 2.5], [90, 3.0], [180, 3.4]], t) * k;
    const speed = keyCurve([[0, 0.55], [10, 0.8], [25, 1.15], [45, 1.45], [120, 1.7]], t);
    phaseClock += h * speed;
    let w = 0;
    for (const q of waves) w += q.w * Math.sin(phaseClock * q.f * Math.PI * 2 + q.ph);
    // random walk with a restoring pull, filtered so it can't jerk
    walkV += ((rnd() - 0.5) * 1.6 - walk * 0.35 - walkV * 0.9) * h * speed;
    walk += walkV * h * speed;
    const mixWalk = keyCurve([[0, 0.1], [25, 0.35], [45, 0.6]], t);
    d.drift = ampDrift * (w / 1.85 * (1 - mixWalk) + Math.max(-1.4, Math.min(1.4, walk)) * mixWalk);

    // irregular nudges: short raised-cosine pulses
    const nudgeRate = keyCurve([[0, 0], [10, 0], [12, 0.16], [25, 0.3], [45, 0.42], [120, 0.55]], t);
    const nudgeAmp = keyCurve([[10, 0.9], [25, 1.5], [45, 2.2], [120, 2.8]], t) * k;
    if (t >= nextNudge) {
      if (nudgeRate > 0) {
        let dir = rnd() < 0.5 ? -1 : 1;
        if (eggSide && dir === eggSide) dir = -dir;
        nudges.push({ t0: t, dur: 0.35 + rnd() * 0.45, amp: dir * nudgeAmp * (0.6 + rnd() * 0.5) });
        d.events.push('nudge');
        nextNudge = t + (0.6 + rnd() * 1.4) / Math.max(0.05, nudgeRate);
      } else nextNudge = t + 1;
    }
    d.nudge = 0;
    for (let i = nudges.length - 1; i >= 0; i--) {
      const n = nudges[i], u = (t - n.t0) / n.dur;
      if (u >= 1) { nudges.splice(i, 1); continue; }
      d.nudge += n.amp * 0.5 * (1 - Math.cos(u * Math.PI * 2));
    }

    // gusts: one taste in the pressure phase, then a regular part of survival
    d.warning = 0;
    if (!gust && t >= nextGust) {
      let dir = rnd() < 0.5 ? -1 : 1;
      if (eggSide && dir === eggSide) dir = -dir;
      const amp = (gustCount === 0 ? 3.6 : keyCurve([[45, 4.6], [90, 5.6], [180, 6.4]], t)) * k;
      gust = { warnAt: t, t0: t + 1.1, dur: 0.9 + rnd() * 0.5, amp, dir, armed: false };
      gustCount++;
      nextGust = t + (gustCount === 1 ? Math.max(12, 47 - t + rnd() * 3) : keyCurve([[45, 10], [90, 8], [180, 6.5]], t) + rnd() * 3);
      d.events.push('gustWarn');
    }
    d.gustTorque = 0;
    d.gustActive = false;
    if (gust) {
      if (t < gust.t0) {
        d.warning = (t - gust.warnAt) / (gust.t0 - gust.warnAt);
        d.warningDir = gust.dir;
      } else {
        if (!gust.armed) {
          gust.armed = true;
          // the cue already promised a direction; if the egg has since got
          // into trouble on that side, the gust lands softer instead
          if (eggSide && gust.dir === eggSide) gust.amp *= 0.5;
          d.events.push('gust');
        }
        const u = (t - gust.t0) / gust.dur;
        if (u >= 1) { gust = null; d.gustJustEnded = true; }
        else {
          // quick swell, longer release
          const env = u < 0.3 ? Math.sin((u / 0.3) * Math.PI / 2) : 0.5 * (1 + Math.cos(((u - 0.3) / 0.7) * Math.PI));
          d.gustTorque = gust.dir * gust.amp * env;
          d.gustActive = true;
          d.gustAmp = env;
          d.warningDir = gust.dir;
        }
      }
    }
    // soft ceiling: stacked drift, nudge and gust never exceed what the
    // carriage can answer with the egg still near the middle
    const raw = d.drift + d.nudge + d.gustTorque;
    d.torque = 7.5 * Math.tanh(raw / 7.5);
    return d.torque;
  };
  return d;
}

// ---- 02_paint.js ----
// Gouache painting kit: ragged opaque shapes, brush strokes with bristle
// marks, soft washes and paper grain, all baked once into offscreen
// canvases. Nothing here runs per frame except the light pass on the egg.

const PAL = {
  butter: '#f1d27a', butter2: '#e9c262', ivory: '#f5ead2', ivory2: '#ecdcb8',
  orange: '#c8622c', orange2: '#a94c22', vermilion: '#d63e2a', mustard: '#c79c36',
  olive: '#6c7140', olive2: '#545a31', burgundy: '#6a1f2b', burgundy2: '#4d1520',
  brass: '#b88f3a', brass2: '#8c6a26', brassHi: '#e8c870', umber: '#3b2417', umber2: '#5a3a24'
};

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); }
function shade(h, amt) { const [r, g, b] = hexRgb(h); return amt >= 0 ? rgbHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt) : rgbHex(r * (1 + amt), g * (1 + amt), b * (1 + amt)); }
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// polygon through pts with each vertex nudged: imperfect painted edges
function raggedPath(g, pts, amp, rnd, closed) {
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = p.x + (rnd() - 0.5) * amp, y = p.y + (rnd() - 0.5) * amp;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  if (closed !== false) g.closePath();
}

// densify a polygon so the ragged edge has detail along long sides
function densify(pts, step, closed) {
  const out = [];
  const n = closed === false ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
  }
  if (closed === false) out.push(pts[pts.length - 1]);
  return out;
}

function rectPts(x, y, w, h) { return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; }
function roundRectPts(x, y, w, h, r, seg) {
  seg = seg || 5; const pts = [];
  const corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return pts;
}
function ellipsePts(cx, cy, rx, ry, n) { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }); } return pts; }

// a single brush stroke: a ribbon whose width swells and tapers, with a few
// bristle lines dragged through it
function brush(g, rnd, x0, y0, x1, y1, w, col, a, bristles) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const n = Math.max(4, Math.min(14, Math.ceil(len / (w * 0.8))));
  const top = [], bot = [];
  const bow = (rnd() - 0.5) * w * 0.8;
  for (let i = 0; i <= n; i++) {
    const u = i / n, taper = Math.pow(Math.sin(Math.PI * Math.min(0.98, Math.max(0.02, u))), 0.45);
    const cx = x0 + dx * u + nx * bow * Math.sin(Math.PI * u), cy = y0 + dy * u + ny * bow * Math.sin(Math.PI * u);
    const hw = w * 0.5 * taper * (0.8 + rnd() * 0.35);
    top.push({ x: cx + nx * hw, y: cy + ny * hw });
    bot.push({ x: cx - nx * hw * (0.85 + rnd() * 0.3), y: cy - ny * hw * (0.85 + rnd() * 0.3) });
  }
  g.fillStyle = typeof col === 'string' && col[0] === '#' ? rgba(col, a) : col;
  g.beginPath();
  g.moveTo(top[0].x, top[0].y);
  for (const p of top) g.lineTo(p.x, p.y);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i].x, bot[i].y);
  g.closePath();
  g.fill();
  const nb = bristles == null ? 3 : bristles;
  if (nb > 0 && typeof col === 'string' && col[0] === '#') {
    g.lineCap = 'round';
    for (let b = 0; b < nb; b++) {
      const off = (rnd() - 0.5) * w * 0.7;
      g.strokeStyle = rgba(rnd() < 0.5 ? shade(col, -0.18) : shade(col, 0.16), a * 0.55);
      g.lineWidth = w * (0.05 + rnd() * 0.07);
      g.beginPath();
      const s0 = rnd() * 0.25, s1 = 0.7 + rnd() * 0.3;
      for (let i = 0; i <= 6; i++) {
        const u = s0 + (s1 - s0) * i / 6;
        const x = x0 + dx * u + nx * (off + bow * Math.sin(Math.PI * u)), y = y0 + dy * u + ny * (off + bow * Math.sin(Math.PI * u));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

// fill the current clip with strokes along an angle, in tones around a base
function strokeFill(g, rnd, box, base, opt) {
  const ang = opt.angle || 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const w = opt.width, count = opt.count || 60, spread = opt.spread == null ? 0.12 : opt.spread;
  for (let i = 0; i < count; i++) {
    const cx = box.x + rnd() * box.w, cy = box.y + rnd() * box.h;
    const L = opt.length * (0.6 + rnd() * 0.8);
    const tone = (rnd() - 0.5) * 2 * spread;
    brush(g, rnd, cx - ca * L / 2, cy - sa * L / 2, cx + ca * L / 2, cy + sa * L / 2, w * (0.6 + rnd() * 0.7), shade(base, tone), opt.alpha || 0.5, opt.bristles);
  }
}

// opaque painted shape: base coat, brushed body, dry edge
function paintShape(g, rnd, pts, base, opt) {
  opt = opt || {};
  const box = bbox(pts);
  const amp = opt.amp == null ? Math.min(box.w, box.h) * 0.02 : opt.amp;
  const dense = densify(pts, opt.step || Math.max(box.w, box.h) / 40);
  g.save();
  raggedPath(g, dense, amp, rnd);
  g.fillStyle = base;
  g.fill();
  g.clip();
  strokeFill(g, rnd, { x: box.x - box.w * 0.1, y: box.y - box.h * 0.1, w: box.w * 1.2, h: box.h * 1.2 }, base, {
    angle: opt.angle || 0, width: opt.brushW || Math.min(box.w, box.h) * 0.25, length: opt.brushL || Math.max(box.w, box.h) * 0.35,
    count: opt.count || 40, alpha: opt.alpha || 0.45, spread: opt.spread
  });
  if (opt.inner) opt.inner(g, box);
  g.restore();
  if (opt.edge) {
    g.save();
    g.strokeStyle = opt.edge; g.lineWidth = opt.edgeW || Math.min(box.w, box.h) * 0.04; g.lineJoin = 'round';
    g.globalAlpha = opt.edgeA == null ? 0.75 : opt.edgeA;
    raggedPath(g, dense, amp * 0.8, rnd);
    g.stroke();
    g.restore();
  }
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// soft, uneven wash: several overlapping ragged blobs at low alpha
function wash(g, rnd, cx, cy, r, col, a, n) {
  n = n || 6;
  for (let i = 0; i < n; i++) {
    const pts = [];
    const ox = (rnd() - 0.5) * r * 0.5, oy = (rnd() - 0.5) * r * 0.5, rr = r * (0.6 + rnd() * 0.5);
    const m = 18;
    for (let j = 0; j < m; j++) { const ang = j / m * Math.PI * 2; const q = rr * (0.8 + rnd() * 0.35); pts.push({ x: cx + ox + Math.cos(ang) * q, y: cy + oy + Math.sin(ang) * q }); }
    g.fillStyle = rgba(col, a / n * 2);
    raggedPath(g, pts, rr * 0.08, rnd);
    g.fill();
  }
}

// paper grain and pigment granulation baked into a canvas's pixels
function grain(c, amount, rnd, fibre) {
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  let img;
  try { img = g.getImageData(0, 0, w, h); } catch (e) { return; }
  const d = img.data;
  // low-frequency value noise lattice for granulation patches
  const cell = Math.max(6, Math.round(Math.min(w, h) / 60));
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd() - 0.5;
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = fy | 0, ty = fy - iy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const fx = x / cell, ix = fx | 0, tx = fx - ix;
      const a = lat[iy * gw + ix], b = lat[iy * gw + ix + 1], c2 = lat[(iy + 1) * gw + ix], e = lat[(iy + 1) * gw + ix + 1];
      const low = (a + (b - a) * tx) * (1 - ty) + (c2 + (e - c2) * tx) * ty;
      const n = (rnd() - 0.5) * amount * 255 + low * amount * 140;
      d[i] += n; d[i + 1] += n * 0.96; d[i + 2] += n * 0.9;
    }
  }
  g.putImageData(img, 0, 0);
  if (fibre) {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < (w * h) / 2600; i++) {
      const x = rnd() * w, y = rnd() * h, L = 3 + rnd() * 12, a = rnd() * Math.PI;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(255,248,230,0.07)' : 'rgba(60,36,20,0.05)';
      g.lineWidth = 0.6 + rnd() * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    g.restore();
  }
}

// ---- 03_audio.js ----
// Sound: a small synthesised foley set (wood, brass, shell, air) driven
// by the simulation, plus the Plethora music bed. Everything starts from
// the first real touch.

function createAudio(ctx) {
  const A = { ready: false, muted: false, ac: null };
  let ac = null, master = null, noiseBuf = null;
  let slide = null, roll = null, drone = null, air = null;
  let musicOn = false, musicIntensity = -1;
  const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music);
  const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);

  function loopNoise(filterType, freq, q) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const gn = ac.createGain(); gn.gain.value = 0;
    src.connect(f); f.connect(gn); gn.connect(master); src.start();
    return { src, f, g: gn };
  }

  A.unlock = function () {
    if (canMusic) { try { ctx.music.unlock().catch(() => { }); } catch (e) { } }
    if (A.ready || !canAudio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { return; }
    A.ac = ac;
    master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
    slide = loopNoise('bandpass', 2600, 2.2);
    roll = loopNoise('lowpass', 380, 0.7);
    air = loopNoise('bandpass', 900, 0.5);
    // tension: two low detuned tones under a slow tremolo
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), dg = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    o1.type = 'sine'; o1.frequency.value = 55; o2.type = 'triangle'; o2.frequency.value = 82.6;
    lfo.frequency.value = 1.6; lg.gain.value = 0.35;
    const trem = ac.createGain(); trem.gain.value = 0.65;
    lfo.connect(lg); lg.connect(trem.gain);
    o1.connect(trem); o2.connect(trem); trem.connect(dg); dg.gain.value = 0; dg.connect(master);
    o1.start(); o2.start(); lfo.start();
    drone = { g: dg, o2 };
    if (ac.state === 'suspended') ac.resume().catch(() => { });
    A.ready = true;
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05);
    if (canMusic) { try { if (m) ctx.music.setVolume(0, { fadeMs: 200 }); else ctx.music.setVolume(A.musicVol, { fadeMs: 300 }); } catch (e) { } }
  };
  A.musicVol = 0.32;

  A.music = function (intensity) {
    if (!canMusic) return;
    try {
      if (!musicOn) {
        ctx.music.play({ preset: 'ambient', volume: A.muted ? 0 : A.musicVol, tempo: 66, intensity, density: 0.3, scale: 'lydian', fadeInMs: 2500 });
        musicOn = true; musicIntensity = intensity;
      } else if (Math.abs(intensity - musicIntensity) > 0.04) {
        ctx.music.setIntensity(intensity, { fadeMs: 2500 });
        musicIntensity = intensity;
      }
    } catch (e) { }
  };
  A.sting = function (name) { if (!canMusic || A.muted) return; try { ctx.music.sting(name).catch(() => { }); } catch (e) { } };
  A.duck = function (amt, ms) { if (!canMusic) return; try { ctx.music.duck(amt, ms); } catch (e) { } };

  function env(gn, t, a, peak, dec) {
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(peak, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(type, f, peak, dec, when, f2) {
    if (!A.ready) return;
    const t = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec);
    o.connect(gn); gn.connect(master);
    env(gn, t, 0.003, peak, dec);
    o.start(t); o.stop(t + dec + 0.05);
  }
  function burst(type, freq, q, peak, dec, when, f2) {
    if (!A.ready) return;
    const t = ac.currentTime + (when || 0);
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dec);
    const gn = ac.createGain();
    src.connect(f); f.connect(gn); gn.connect(master);
    env(gn, t, 0.002, peak, dec);
    src.start(t, Math.random() * 1.5); src.stop(t + dec + 0.05);
  }

  // brass carriage picked up / set down
  A.grab = () => { tone('triangle', 1320, 0.05, 0.08); burst('bandpass', 3800, 6, 0.05, 0.03); };
  A.release = () => { tone('triangle', 990, 0.035, 0.07); };
  // carriage hits a rail stop: dull knock plus a short brass ring
  A.clunk = (v) => {
    const k = Math.min(1, v / 2.5);
    tone('sine', 150, 0.22 * k + 0.05, 0.12, 0, 90);
    tone('triangle', 1480, 0.06 * k + 0.02, 0.35);
    tone('sine', 2230, 0.03 * k + 0.01, 0.25);
    burst('lowpass', 900, 1, 0.12 * k, 0.05);
  };
  // the platform meets its end stop: wooden thud
  A.thud = (w) => { const k = Math.min(1, w / 0.6); tone('sine', 120, 0.25 * k + 0.04, 0.16, 0, 70); burst('bandpass', 420, 2, 0.18 * k, 0.07); };
  // shell touching the deck
  A.tick = (v, surface) => {
    const k = Math.min(1, v / 0.8);
    const f = surface === 'metal' ? 5200 : surface === 'ceramic' ? 4200 : surface === 'rubber' ? 1700 : 2900;
    burst('bandpass', f, 9, 0.05 + 0.25 * k, 0.025 + 0.02 * k);
    if (surface === 'metal' || surface === 'ceramic') tone('sine', f * 0.62, 0.02 + 0.05 * k, 0.12);
  };
  // stick-slip creak of the pivot under load
  A.creak = (k) => {
    if (!A.ready) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), gn = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(70 + Math.random() * 50, t); o.frequency.linearRampToValueAtTime(95 + Math.random() * 60, t + 0.18);
    f.type = 'bandpass'; f.frequency.value = 650 + Math.random() * 500; f.Q.value = 7;
    o.connect(f); f.connect(gn); gn.connect(master);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(0.09 * k, t + 0.04);
    gn.gain.linearRampToValueAtTime(0.05 * k, t + 0.12);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.start(t); o.stop(t + 0.3);
  };
  A.gustWarn = () => { burst('bandpass', 400, 0.8, 0.08, 1.2, 0, 1400); };
  A.gust = () => { burst('bandpass', 1200, 0.6, 0.14, 1.0, 0, 380); };
  A.fall = () => { burst('bandpass', 1800, 1.5, 0.12, 0.7, 0, 300); tone('sine', 520, 0.04, 0.5, 0, 260); };
  A.crack = () => {
    burst('highpass', 2500, 0.8, 0.5, 0.06);
    for (let i = 0; i < 5; i++) burst('bandpass', 3000 + Math.random() * 3000, 5, 0.2, 0.02, 0.02 + i * 0.025 + Math.random() * 0.02);
    burst('lowpass', 300, 1, 0.3, 0.18, 0.03);
    tone('sine', 90, 0.18, 0.2, 0.02, 50);
  };
  A.chime = (up) => {
    const base = up ? 784 : 659;
    tone('sine', base, 0.06, 0.6); tone('sine', base * 1.5, 0.035, 0.7, 0.07); tone('triangle', base * 2, 0.015, 0.4, 0.14);
  };

  // continuous layers, set once per rendered frame from smoothed values
  A.update = function (p) {
    if (!A.ready) return;
    const t = ac.currentTime, tc = 0.06;
    slide.g.gain.setTargetAtTime(Math.min(0.22, p.slide * 0.09), t, tc);
    slide.f.frequency.setTargetAtTime(2200 + p.slide * 500, t, tc);
    roll.g.gain.setTargetAtTime(Math.min(0.28, p.roll * 0.16), t, tc);
    roll.f.frequency.setTargetAtTime(260 + p.roll * 260 + (p.surface === 'metal' ? 500 : p.surface === 'ceramic' ? 300 : 0), t, tc);
    drone.g.gain.setTargetAtTime(p.danger * 0.12, t, 0.25);
    drone.o2.frequency.setTargetAtTime(82.6 + p.danger * 6, t, 0.3);
    air.g.gain.setTargetAtTime(p.air * 0.1, t, 0.15);
    air.f.frequency.setTargetAtTime(700 + p.air * 900, t, 0.15);
  };
  A.silenceLayers = function () { if (A.ready) A.update({ slide: 0, roll: 0, danger: 0, air: 0, surface: 'wood' }); };
  A.dispose = function () {
    try { if (canMusic) ctx.music.stop({ fadeOutMs: 200 }); } catch (e) { }
    try { if (ac) ac.close(); } catch (e) { }
  };
  return A;
}

// ---- 04_art.js ----
// The painted objects, each baked into its own canvas in its own physical
// frame (metres, y up) so the renderer only rotates and places them.

// A canvas holding a region of a physical frame. draw(g) paints in metres.
function frameSprite(S, x0, x1, y0, y1, draw) {
  const c = makeCanvas((x1 - x0) * S, (y1 - y0) * S);
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, -S, -x0 * S, y1 * S);
  draw(g);
  return { canvas: c, x0, y1, S };
}
// blit a frameSprite with its frame origin at screen (sx, sy), rotated by ang (radians, CCW)
function blitFrame(g, spr, sx, sy, ang, k) {
  g.save();
  g.translate(sx, sy);
  g.rotate(-ang);
  const sc = k / spr.S;
  g.drawImage(spr.canvas, spr.x0 * k, -spr.y1 * k, spr.canvas.width * sc, spr.canvas.height * sc);
  g.restore();
}

const WOOD = '#c4813a';

function paintBackground(L, seed) {
  const { W, H, dpr, k, px, py } = L;
  // painted beyond the screen on every side so the camera can pull back
  const PX = L.padX, PY = L.padY;
  const c = makeCanvas((W + PX * 2) * dpr, (H + PY * 2) * dpr);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.scale(dpr, dpr);
  g.translate(PX, PY);
  // wall: butter yellow, worked with broad strokes
  g.fillStyle = PAL.butter; g.fillRect(-PX, -PY, W + PX * 2, H + PY * 2);
  strokeFill(g, rnd, { x: -PX - 40, y: -PY - 40, w: W + PX * 2 + 80, h: H + PY * 2 + 80 }, PAL.butter, { angle: -0.25, width: 46, length: 160, count: 70, alpha: 0.35, spread: 0.1 });
  for (let i = 0; i < 7; i++) wash(g, rnd, rnd() * W, rnd() * H * 0.5, 80 + rnd() * 120, rnd() < 0.5 ? PAL.ivory : PAL.mustard, 0.18);
  // corners deepen to mustard (painted, not a gradient)
  for (const [cx, cy] of [[-PX * 0.5, 0], [W + PX * 0.5, 0], [-PX * 0.5, H * 0.6], [W + PX * 0.5, H * 0.6]]) wash(g, rnd, cx, cy, W * 0.42, PAL.mustard, 0.32, 8);

  const tableTop = py - GEOM.tableY * k;      // screen y of the table's front lip
  const tableBack = tableTop - 0.42 * k;      // back edge of the table top
  // the niche: a deep burgundy arch the egg reads against
  const nw = Math.min(W * 0.47, 2.9 * k), apex = Math.max(L.hudBottom + 26, py - 1.75 * k - nw * 0.2);
  const npts = [];
  npts.push({ x: px - nw, y: tableBack + 4 });
  for (let i = 0; i <= 24; i++) { const a = Math.PI + (i / 24) * Math.PI; npts.push({ x: px + Math.cos(a) * nw, y: apex + nw + Math.sin(a) * nw }); }
  npts.push({ x: px + nw, y: tableBack + 4 });
  // ivory border painted around the arch first
  const border = npts.map(p => ({ x: px + (p.x - px) * 1.045, y: p.y < apex + nw ? apex + nw + (p.y - apex - nw) * 1.045 - 2 : p.y }));
  paintShape(g, rnd, border, PAL.ivory2, { amp: 3, angle: 1.2, brushW: 10, brushL: 50, count: 60, alpha: 0.35 });
  paintShape(g, rnd, npts, PAL.burgundy, { amp: 3, angle: 0.35, brushW: 34, brushL: 90, count: 120, alpha: 0.32, spread: 0.12, edge: PAL.burgundy2, edgeW: 3, edgeA: 0.6,
    inner: (gg) => {
      // a little warm light falling into the niche from above
      for (let i = 0; i < 5; i++) wash(gg, rnd, px + (rnd() - 0.5) * nw, apex + nw * 0.9 + rnd() * nw * 0.6, nw * 0.55, PAL.orange, 0.12);
      for (let i = 0; i < 4; i++) wash(gg, rnd, px + (rnd() - 0.5) * nw * 1.6, tableBack - rnd() * nw * 0.3, nw * 0.5, PAL.burgundy2, 0.35);
    } });
  // small painted ornament at the arch's crown
  for (let i = -2; i <= 2; i++) {
    const a = -Math.PI / 2 + i * 0.16;
    const x = px + Math.cos(a) * nw * 1.02, y = apex + nw + Math.sin(a) * nw * 1.02;
    g.fillStyle = i === 0 ? PAL.vermilion : PAL.olive;
    g.beginPath(); g.ellipse(x, y, 3.2, 4.6, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
  }

  // table: olive top, burnt-orange front
  const X0 = -PX - 10, X1 = W + PX + 10;
  const topPts = densify([{ x: X0, y: tableBack }, { x: X1, y: tableBack }, { x: X1, y: tableTop + 2 }, { x: X0, y: tableTop + 2 }], 30);
  paintShape(g, rnd, topPts, PAL.olive, { amp: 2.5, angle: 0.02, brushW: 10, brushL: 140, count: 90, alpha: 0.35, spread: 0.12 });
  // a soft cast shadow of the stand on the table top
  wash(g, rnd, px + 0.25 * k, tableBack + 0.24 * k, 0.55 * k, PAL.olive2, 0.6, 6);
  const frontPts = [{ x: X0, y: tableTop }, { x: X1, y: tableTop }, { x: X1, y: H + PY + 10 }, { x: X0, y: H + PY + 10 }];
  paintShape(g, rnd, frontPts, PAL.orange, { amp: 2.5, angle: 0.03, brushW: 16, brushL: 160, count: 140, alpha: 0.33, spread: 0.12 });
  // painted lip and a decorative band on the table's apron
  brush(g, rnd, X0, tableTop + 1, X1, tableTop + 1, 5, PAL.ivory2, 0.8, 0);
  const bandY = tableTop + Math.min(0.13 * k, (H - tableTop) * 0.1);
  brush(g, rnd, X0, bandY, X1, bandY, 6, PAL.burgundy, 0.85, 2);
  for (let x = X0 + 12; x < X1; x += 22) { g.fillStyle = rgba(PAL.butter, 0.9); g.beginPath(); g.arc(x + (rnd() - 0.5) * 2, bandY + 9 + (rnd() - 0.5) * 1.5, 1.6, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 5; i++) wash(g, rnd, X0 + rnd() * (X1 - X0), H, W * 0.4, PAL.orange2, 0.3);

  // the stand: turned olive column on a plinth, brass collars, brass saddle
  g.save();
  g.translate(px, py); g.scale(k, -k);
  const colTop = -0.1, colBot = GEOM.tableY + 0.16;
  const sr = mulberry32(seed + 7);
  // plinth
  paintShape(g, sr, roundRectPts(-0.46, GEOM.tableY + 0.0, 0.92, 0.17, 0.04), PAL.burgundy, { amp: 0.008, angle: 0, brushW: 0.05, brushL: 0.4, count: 30, alpha: 0.4, edge: PAL.burgundy2, edgeW: 0.012 });
  brush(g, sr, -0.44, GEOM.tableY + 0.155, 0.44, GEOM.tableY + 0.155, 0.025, PAL.brassHi, 0.6, 0);
  // column profile with a swelling waist
  const prof = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) { const u = i / steps, y = colBot + (colTop - colBot) * u; prof.push({ x: 0.075 + 0.03 * Math.sin(u * Math.PI) + (u < 0.08 ? 0.05 * (1 - u / 0.08) : 0), y }); }
  const colPts = prof.concat(prof.slice().reverse().map(p => ({ x: -p.x, y: p.y })));
  paintShape(g, sr, colPts, PAL.olive, { amp: 0.006, angle: Math.PI / 2, brushW: 0.035, brushL: 0.5, count: 40, alpha: 0.45, edge: PAL.olive2, edgeW: 0.01,
    inner: (gg) => { brush(gg, sr, 0.04, colBot, 0.05, colTop, 0.03, PAL.butter, 0.25, 2); brush(gg, sr, -0.07, colBot, -0.06, colTop, 0.035, PAL.olive2, 0.4, 2); } });
  for (const y of [colBot + 0.12, colBot + 0.7, -1.05]) {
    paintShape(g, sr, roundRectPts(-0.11, y - 0.03, 0.22, 0.06, 0.02), PAL.brass, { amp: 0.004, angle: 0, brushW: 0.02, brushL: 0.12, count: 10, alpha: 0.5, edge: PAL.brass2, edgeW: 0.007 });
    brush(g, sr, -0.08, y + 0.012, 0.06, y + 0.012, 0.01, PAL.brassHi, 0.8, 0);
  }
  // the angle scale: an enamel fan under the axle, read by the platform's needle
  const R0 = 0.27, R1 = 0.43, span = 0.36;
  const fan = [];
  for (let i = 0; i <= 14; i++) { const a = -Math.PI / 2 - span + (i / 14) * span * 2; fan.push({ x: Math.cos(a) * R1, y: Math.sin(a) * R1 }); }
  for (let i = 14; i >= 0; i--) { const a = -Math.PI / 2 - span + (i / 14) * span * 2; fan.push({ x: Math.cos(a) * R0, y: Math.sin(a) * R0 }); }
  paintShape(g, sr, fan, PAL.ivory, { amp: 0.004, angle: 0, brushW: 0.03, brushL: 0.1, count: 20, alpha: 0.4, edge: PAL.brass2, edgeW: 0.012, edgeA: 0.9 });
  const lim = 0.31;
  // danger sectors past ~11 degrees
  for (const sgn of [-1, 1]) {
    g.fillStyle = rgba(PAL.vermilion, 0.8);
    g.beginPath();
    const a0 = -Math.PI / 2 + sgn * 0.2, a1 = -Math.PI / 2 + sgn * lim;
    g.arc(0, 0, R1 - 0.015, a0, a1, sgn < 0);
    g.arc(0, 0, R1 - 0.07, a1, a0, sgn > 0);
    g.closePath(); g.fill();
  }
  g.strokeStyle = PAL.umber; g.lineCap = 'round';
  for (let i = -6; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * lim;
    const r0 = i % 3 === 0 ? R0 + 0.02 : R0 + 0.06;
    g.lineWidth = i === 0 ? 0.014 : 0.008;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * (R1 - 0.02), Math.sin(a) * (R1 - 0.02)); g.stroke();
  }
  // saddle cradling the axle
  const sad = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; sad.push({ x: Math.cos(a) * 0.16, y: -0.02 + Math.sin(a) * 0.16 }); }
  sad.push({ x: 0.16, y: 0.0 }); sad.push({ x: 0.11, y: 0.0 });
  for (let i = 12; i >= 0; i--) { const a = Math.PI + (i / 12) * Math.PI; sad.push({ x: Math.cos(a) * 0.11, y: -0.02 + Math.sin(a) * 0.11 }); }
  sad.push({ x: -0.11, y: 0.0 }); sad.push({ x: -0.16, y: 0.0 });
  paintShape(g, sr, sad, PAL.brass, { amp: 0.004, angle: 0.4, brushW: 0.03, brushL: 0.12, count: 16, alpha: 0.5, edge: PAL.brass2, edgeW: 0.01 });
  g.restore();

  grain(c, 0.07, rnd, true);
  return c;
}

// deck top finishes; all share the same painted wooden body
const FINISH = {
  rubber: { top: PAL.olive2, h: 0.05 },
  wood: { top: '#d9a25a', h: 0.035 },
  ceramic: { top: PAL.ivory, h: 0.045 },
  metal: { top: '#cdbb92', h: 0.045 }
};

function paintPlatform(S, surface, seed) {
  const rnd = mulberry32(seed);
  const hx = 1.76;
  return frameSprite(S, -2.08, 2.08, GEOM.railY - 0.09, GEOM.deckTop + 0.05, (g) => {
    // hangers
    for (const sx of [-1, 1]) {
      paintShape(g, rnd, rectPts(sx * hx - 0.022, GEOM.railY, 0.044, GEOM.deckBottom - GEOM.railY + 0.02), PAL.brass, { amp: 0.003, angle: Math.PI / 2, brushW: 0.015, brushL: 0.2, count: 6, alpha: 0.5, edge: PAL.brass2, edgeW: 0.008 });
      brush(g, rnd, sx * hx - 0.008, GEOM.railY + 0.02, sx * hx - 0.008, GEOM.deckBottom - 0.01, 0.01, PAL.brassHi, 0.7, 0);
      paintShape(g, rnd, ellipsePts(sx * hx, GEOM.deckBottom - 0.005, 0.05, 0.03, 12), PAL.brass2, { amp: 0.003, count: 4, alpha: 0.4 });
    }
    // rail rod
    paintShape(g, rnd, roundRectPts(-hx, GEOM.railY - 0.02, hx * 2, 0.04, 0.018), PAL.brass, { amp: 0.003, angle: 0, brushW: 0.012, brushL: 0.5, count: 18, alpha: 0.5, edge: PAL.brass2, edgeW: 0.008 });
    brush(g, rnd, -hx + 0.04, GEOM.railY + 0.008, hx - 0.04, GEOM.railY + 0.008, 0.009, PAL.brassHi, 0.75, 0);
    // ceramic end stops
    for (const sx of [-1, 1]) {
      const x = sx * (GEOM.travel + 0.25 + 0.05);
      paintShape(g, rnd, ellipsePts(x, GEOM.railY, 0.05, 0.062, 14), PAL.burgundy, { amp: 0.004, count: 6, alpha: 0.4, edge: PAL.burgundy2, edgeW: 0.008 });
      g.fillStyle = rgba(PAL.ivory, 0.7); g.beginPath(); g.ellipse(x - 0.015, GEOM.railY + 0.02, 0.012, 0.018, 0, 0, Math.PI * 2); g.fill();
    }
    // the needle, hanging from the axle to the scale
    g.strokeStyle = PAL.umber; g.lineWidth = 0.016; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -0.02); g.lineTo(0, -0.41); g.stroke();
    g.fillStyle = PAL.vermilion; g.beginPath(); g.moveTo(-0.018, -0.36); g.lineTo(0.018, -0.36); g.lineTo(0, -0.425); g.closePath(); g.fill();

    // deck body: painted wood with a hand-painted border band
    const deck = roundRectPts(-GEOM.half, GEOM.deckBottom, GEOM.half * 2, GEOM.deckTop - GEOM.deckBottom, 0.035, 4);
    paintShape(g, rnd, deck, WOOD, { amp: 0.006, angle: 0, brushW: 0.035, brushL: 0.9, count: 70, alpha: 0.4, spread: 0.16, edge: PAL.umber, edgeW: 0.012, edgeA: 0.7,
      inner: (gg) => {
        // grain
        for (let i = 0; i < 26; i++) {
          const y = GEOM.deckBottom + 0.01 + rnd() * (GEOM.deckTop - GEOM.deckBottom - 0.02), x = -GEOM.half + rnd() * GEOM.half * 2, L = 0.3 + rnd() * 0.9;
          brush(gg, rnd, x, y, x + L, y + (rnd() - 0.5) * 0.012, 0.006 + rnd() * 0.006, PAL.orange2, 0.45, 0);
        }
        // border band
        const b0 = GEOM.deckBottom + 0.035, b1 = GEOM.deckTop - FINISH[surface].h - 0.022;
        brush(gg, rnd, -GEOM.half + 0.05, (b0 + b1) / 2, GEOM.half - 0.05, (b0 + b1) / 2, (b1 - b0), PAL.burgundy, 0.92, 3);
        for (let x = -GEOM.half + 0.12; x < GEOM.half - 0.08; x += 0.16) {
          gg.fillStyle = rgba(PAL.ivory, 0.9);
          gg.beginPath(); gg.arc(x + (rnd() - 0.5) * 0.01, (b0 + b1) / 2 + (rnd() - 0.5) * 0.006, 0.013, 0, Math.PI * 2); gg.fill();
          gg.fillStyle = rgba(PAL.olive, 0.9);
          gg.beginPath(); gg.ellipse(x + 0.08, (b0 + b1) / 2, 0.028, 0.011, (rnd() - 0.5) * 0.6, 0, Math.PI * 2); gg.fill();
          gg.fillStyle = rgba(PAL.mustard, 0.9);
          gg.beginPath(); gg.arc(x + 0.08, (b0 + b1) / 2, 0.006, 0, Math.PI * 2); gg.fill();
        }
        // the finish on top of the deck
        const f = FINISH[surface], t0 = GEOM.deckTop - f.h;
        gg.save();
        raggedPath(gg, densify(rectPts(-GEOM.half - 0.01, t0, GEOM.half * 2 + 0.02, f.h + 0.02), 0.08), 0.004, rnd);
        gg.fillStyle = f.top; gg.fill(); gg.clip();
        if (surface === 'rubber') {
          for (let i = 0; i < 140; i++) { gg.fillStyle = rgba(rnd() < 0.5 ? PAL.olive : '#3f4425', 0.6); gg.beginPath(); gg.arc(-GEOM.half + rnd() * GEOM.half * 2, t0 + rnd() * f.h, 0.004 + rnd() * 0.004, 0, Math.PI * 2); gg.fill(); }
        } else if (surface === 'wood') {
          for (let i = 0; i < 14; i++) { const x = -GEOM.half + rnd() * GEOM.half * 2; brush(gg, rnd, x, t0 + f.h * 0.5, x + 0.4 + rnd() * 0.6, t0 + f.h * (0.3 + rnd() * 0.4), 0.006, PAL.orange, 0.5, 0); }
        } else if (surface === 'ceramic') {
          for (let x = -GEOM.half + 0.25; x < GEOM.half; x += 0.25) { gg.fillStyle = rgba(PAL.vermilion, 0.75); gg.fillRect(x - 0.004, t0, 0.008, f.h); }
          brush(gg, rnd, -GEOM.half + 0.1, GEOM.deckTop - 0.01, GEOM.half - 0.1, GEOM.deckTop - 0.01, 0.008, '#ffffff', 0.7, 0);
        } else {
          for (let i = 0; i < 40; i++) { const x = -GEOM.half + rnd() * GEOM.half * 2; brush(gg, rnd, x, t0 + rnd() * f.h, x + 0.3 + rnd() * 0.5, t0 + rnd() * f.h, 0.003, rnd() < 0.5 ? '#efe2bf' : '#8f7a52', 0.6, 0); }
          for (const x of [-GEOM.half + 0.06, GEOM.half - 0.06]) { gg.fillStyle = PAL.brass2; gg.beginPath(); gg.arc(x, t0 + f.h / 2, 0.009, 0, Math.PI * 2); gg.fill(); }
        }
        gg.restore();
        // light catching the top edge
        brush(gg, rnd, -GEOM.half + 0.03, GEOM.deckTop - 0.004, GEOM.half - 0.03, GEOM.deckTop - 0.004, 0.006, PAL.ivory, 0.5, 0);
      } });
  });
}

function paintCounterweight(S, seed) {
  const rnd = mulberry32(seed);
  const K = 1.45;
  return frameSprite(S, -0.24 * K, 0.24 * K, -0.4 * K, 0.09 * K, (g) => {
    g.scale(K, K);
    // collar riding on the rail
    paintShape(g, rnd, roundRectPts(-0.14, -0.055, 0.28, 0.11, 0.03), PAL.brass, { amp: 0.004, angle: 0, brushW: 0.02, brushL: 0.12, count: 12, alpha: 0.5, edge: PAL.brass2, edgeW: 0.01 });
    g.fillStyle = rgba(PAL.umber, 0.85); g.fillRect(-0.15, -0.012, 0.3, 0.024); // rail slot shadow
    brush(g, rnd, -0.12, 0.035, 0.12, 0.035, 0.012, PAL.brassHi, 0.8, 0);
    // bell
    const bell = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10, y = -0.05 - u * 0.24; bell.push({ x: 0.1 + 0.07 * Math.pow(u, 1.6), y }); }
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; bell.push({ x: Math.cos(a) * 0.17, y: -0.29 - Math.sin(a) * 0.035 }); }
    for (let i = 10; i >= 0; i--) { const u = i / 10, y = -0.05 - u * 0.24; bell.push({ x: -(0.1 + 0.07 * Math.pow(u, 1.6)), y }); }
    paintShape(g, rnd, bell, PAL.brass, { amp: 0.004, angle: Math.PI / 2, brushW: 0.025, brushL: 0.2, count: 30, alpha: 0.5, spread: 0.18, edge: PAL.brass2, edgeW: 0.01,
      inner: (gg) => {
        brush(gg, rnd, -0.07, -0.07, -0.11, -0.28, 0.035, PAL.brassHi, 0.65, 2);
        brush(gg, rnd, 0.09, -0.07, 0.13, -0.28, 0.04, PAL.brass2, 0.6, 2);
        // ceramic band with dots
        brush(gg, rnd, -0.2, -0.17, 0.2, -0.17, 0.065, PAL.ivory, 0.97, 2);
        for (let x = -0.12; x <= 0.13; x += 0.06) { gg.fillStyle = rgba(PAL.vermilion, 0.95); gg.beginPath(); gg.arc(x, -0.17, 0.011, 0, Math.PI * 2); gg.fill(); }
        gg.strokeStyle = rgba(PAL.umber, 0.5); gg.lineWidth = 0.006;
        for (const y of [-0.08, -0.255]) { gg.beginPath(); gg.moveTo(-0.2, y); gg.lineTo(0.2, y); gg.stroke(); }
      } });
    // knurled grip knob
    paintShape(g, rnd, roundRectPts(-0.065, -0.385, 0.13, 0.07, 0.025), PAL.vermilion, { amp: 0.003, angle: 0, brushW: 0.02, brushL: 0.08, count: 8, alpha: 0.5, edge: PAL.burgundy, edgeW: 0.008,
      inner: (gg) => { gg.strokeStyle = rgba(PAL.ivory, 0.45); gg.lineWidth = 0.005; for (let x = -0.055; x <= 0.06; x += 0.018) { gg.beginPath(); gg.moveTo(x, -0.38); gg.lineTo(x + 0.01, -0.32); gg.stroke(); } } });
  });
}

function paintEggShell(S, outline, seed) {
  const rnd = mulberry32(seed);
  let maxY = 0, maxX = 0;
  for (const p of outline) { maxY = Math.max(maxY, Math.abs(p.y)); maxX = Math.max(maxX, Math.abs(p.x)); }
  const m = 0.03;
  return frameSprite(S, -maxX - m, maxX + m, -maxY - m, maxY + m, (g) => {
    paintShape(g, rnd, outline, '#f4e8cc', { amp: 0.002, step: 0.03, angle: 0.15, brushW: 0.06, brushL: 0.22, count: 60, alpha: 0.4, spread: 0.07, edge: PAL.umber2, edgeW: 0.007, edgeA: 0.55,
      inner: (gg) => {
        // a faint warm flush toward the pointed end
        wash(gg, rnd, -maxX * 0.7, 0, maxX * 0.6, PAL.butter2, 0.22, 5);
        wash(gg, rnd, maxX * 0.3, maxY * 0.3, maxX * 0.5, '#fff7e6', 0.25, 4);
        // speckles, denser at the blunt end
        for (let i = 0; i < 120; i++) {
          const u = Math.pow(rnd(), 0.7);
          const x = (u * 2 - 1) * maxX * 0.95, y = (rnd() * 2 - 1) * maxY * 0.95;
          if (rnd() > 0.35 + 0.5 * (x / maxX + 1) / 2) continue;
          const r = 0.0025 + rnd() * rnd() * 0.009;
          gg.fillStyle = rgba(rnd() < 0.6 ? '#8a5a34' : '#6a4a3a', 0.25 + rnd() * 0.45);
          gg.beginPath(); gg.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); gg.fill();
        }
        // fine pores
        for (let i = 0; i < 260; i++) { gg.fillStyle = rgba(rnd() < 0.5 ? '#d9c39b' : '#fffaf0', 0.35); gg.fillRect((rnd() * 2 - 1) * maxX, (rnd() * 2 - 1) * maxY, 0.003, 0.003); }
      } });
  });
}

// a soft vermilion wash that blooms on the deck end the egg is nearing
function paintDanger(S, seed) {
  const rnd = mulberry32(seed);
  return frameSprite(S, -0.7, 0.7, -0.2, 0.42, (g) => {
    for (let i = 0; i < 4; i++) wash(g, rnd, (rnd() - 0.5) * 0.2, 0.12, 0.42, PAL.vermilion, 0.28, 6);
  });
}

// the broken egg on the table, painted once where it landed
function paintBroken(S, seed) {
  const rnd = mulberry32(seed);
  return frameSprite(S, -0.8, 0.8, -0.05, 0.42, (g) => {
    // albumen
    const al = [];
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; const r = 0.5 * (0.75 + rnd() * 0.35); al.push({ x: Math.cos(a) * r, y: 0.03 + Math.max(-0.02, Math.sin(a)) * r * 0.16 }); }
    g.globalAlpha = 0.85;
    paintShape(g, rnd, al, '#f1ecdc', { amp: 0.02, angle: 0, brushW: 0.05, brushL: 0.2, count: 20, alpha: 0.3, spread: 0.05 });
    g.globalAlpha = 1;
    // yolk
    paintShape(g, rnd, ellipsePts(0.06, 0.07, 0.15, 0.075, 20), '#e8922a', { amp: 0.006, angle: 0.2, brushW: 0.04, brushL: 0.12, count: 16, alpha: 0.5, edge: PAL.orange2, edgeW: 0.01, edgeA: 0.5 });
    g.fillStyle = 'rgba(255,240,200,0.7)'; g.beginPath(); g.ellipse(0.02, 0.1, 0.04, 0.016, -0.2, 0, Math.PI * 2); g.fill();
    // two shell halves with jagged rims
    const half = (cx, dir, tilt) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; pts.push({ x: cx + Math.cos(a) * 0.2 * dir, y: 0.2 + Math.sin(a) * 0.17 }); }
      for (let i = 0; i <= 7; i++) { const u = i / 7; pts.push({ x: cx + (0.2 - u * 0.4) * dir, y: 0.2 + (i % 2 ? 0.05 : -0.01) + (rnd() - 0.5) * 0.03 }); }
      g.save(); g.translate(cx, 0.03); g.rotate(tilt); g.translate(-cx, -0.03);
      paintShape(g, rnd, pts, '#f4e8cc', { amp: 0.003, angle: 0.1, brushW: 0.04, brushL: 0.12, count: 14, alpha: 0.4, edge: PAL.umber2, edgeW: 0.007, edgeA: 0.6 });
      g.restore();
    };
    half(-0.36, 1, 0.5);
    half(0.42, -1, -0.8);
    for (let i = 0; i < 9; i++) { const x = (rnd() - 0.5) * 1.2; g.fillStyle = '#efe2c4'; g.beginPath(); g.moveTo(x, 0.0); g.lineTo(x + 0.025, 0.02); g.lineTo(x + 0.05, 0.0); g.closePath(); g.fill(); }
  });
}

// ---- 05_game.js ----
// Game: state flow, input, rendering, HUD, scoring and results.

const H_STEP = 1 / 120;
const SAVE_KEY = 'eggdrop.v1';
const MESSAGES = [
  [8, 'A tender beginning.'],
  [18, 'The shell held, briefly.'],
  [30, 'You found the weight of it.'],
  [45, 'Steady hands.'],
  [65, 'A balanced mind.'],
  [90, 'The egg trusts you.'],
  [Infinity, 'Still life, perfectly kept.']
];

const UI_CSS = `
.ed-ui{position:absolute;inset:0;pointer-events:none;font-family:'Cormorant Garamond',Georgia,serif;color:#3b2417;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.ed-ui button{pointer-events:auto;font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer;touch-action:manipulation}
.ed-icons{position:absolute;display:flex;gap:8px}
.ed-ui .ed-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(245,234,210,.82);box-shadow:inset 0 0 0 1.5px rgba(140,106,38,.7)}
.ed-ui .ed-icon svg{width:22px;height:22px}
.ed-ui .ed-icon.on{background:#b88f3a;box-shadow:inset 0 0 0 1.5px #8c6a26}
.ed-chips{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:6px;transition:opacity .25s}
.ed-ui .ed-chip{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 7px 5px;border-radius:12px;min-width:62px;background:rgba(245,234,210,.78);box-shadow:inset 0 0 0 1px rgba(90,58,36,.25)}
.ed-ui .ed-chip i{display:block;width:40px;height:9px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(59,36,23,.35)}
.ed-ui .ed-chip span{font-family:'Inter',system-ui,sans-serif;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.ed-ui .ed-chip.sel{background:#f5ead2;box-shadow:inset 0 0 0 2px #6a1f2b}
.ed-card{position:absolute;left:50%;transform:translate(-50%,0);width:min(330px,calc(100% - 40px));padding:20px 20px 18px;box-sizing:border-box;text-align:center;border-radius:6px;background-color:#f5ead2;background-size:cover;box-shadow:0 10px 30px rgba(59,36,23,.35);pointer-events:auto;opacity:0;transition:opacity .35s,transform .35s;transform:translate(-50%,14px)}
.ed-card.show{opacity:1;transform:translate(-50%,0)}
.ed-kick{font-style:italic;font-size:19px;opacity:.85}
.ed-time{font-family:'DM Serif Display',Georgia,serif;font-size:62px;line-height:1;margin:6px 0 2px;color:#6a1f2b}
.ed-time small{font-size:26px;margin-left:3px}
.ed-best{font-family:'Inter',system-ui,sans-serif;font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.8}
.ed-best b{color:#d63e2a}
.ed-msg{font-style:italic;font-size:21px;margin:10px 0 8px}
.ed-pts{font-family:'Inter',system-ui,sans-serif;font-size:11.5px;line-height:1.5;opacity:.85}
.ed-pts strong{font-size:13px}
.ed-board{margin:12px auto 0;max-width:250px;font-family:'Inter',system-ui,sans-serif;font-size:12px;border-top:1px solid rgba(59,36,23,.2);padding-top:8px;min-height:20px}
.ed-row{display:flex;justify-content:space-between;padding:1px 0}
.ed-row.me{color:#6a1f2b;font-weight:600}
.ed-dim{opacity:.6;font-size:11px}
.ed-ui .ed-again{margin-top:14px;display:inline-block;padding:11px 34px;border-radius:28px;background:#6a1f2b!important;color:#f5ead2!important;font-family:'Inter',system-ui,sans-serif!important;font-weight:600;font-size:14px;letter-spacing:.14em;text-transform:uppercase;box-shadow:inset 0 0 0 2px #4d1520,0 3px 0 #4d1520}
.ed-ui .ed-again:active{transform:translateY(2px);box-shadow:inset 0 0 0 2px #4d1520,0 1px 0 #4d1520}
.ed-err{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:80%;font-size:20px;pointer-events:auto}
`;

const ICON = {
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="#3b2417"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="#3b2417"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  tilt: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.5" width="8" height="17" rx="2" transform="rotate(18 12 12)"/><path d="M3 20c2-1 4-1 6 0M15 20c2-1 4-1 6 0"/></svg>'
};

function fmtTime(sec) {
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

async function eggDropInit(ctx) {
  let disposed = false;
  ctx.onDestroy(() => { disposed = true; });
  const area = () => ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
  const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number(id); return v == null || !isFinite(v) ? d : v; } catch (e) { return d; } };
  const caps = ctx.capabilities || {};

  // ---- persistence (this device) ----
  let save = { surface: 'wood', muted: false, best: {}, bestPts: {}, runs: 0 };
  if (caps.storage && ctx.storage) { try { const v = ctx.storage.get(SAVE_KEY); if (v && typeof v === 'object') save = Object.assign(save, v); } catch (e) { } }
  if (!SURFACES[save.surface]) save.surface = 'wood';
  const persist = () => { if (caps.storage && ctx.storage) { try { ctx.storage.set(SAVE_KEY, save); } catch (e) { } } };

  // ---- surfaces ----
  const canvas = ctx.createCanvas2D({ coordinateSpace: 'css', maxDpr: 2, alpha: false, touchAction: 'none', layer: 'content' });
  const g = canvas.getContext('2d');
  const ui = ctx.createRoot({ className: 'ed-ui', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || ui).appendChild(e); return e; };

  try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
  try { ctx.loadFont('Cormorant Garamond', 'cormorant-garamond', '1.0.0', { weight: '300', style: 'italic' }).catch(() => { }); } catch (e) { }
  try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }); } catch (e) { }

  // ---- layout ----
  const L = { W: 1, H: 1, dpr: 1, k: 80, px: 0, py: 0 };
  let bg = null, sprites = {}, artKey = '';
  function layout() {
    const W = Math.max(1, ctx.width), Hh = Math.max(1, ctx.height), a = area();
    L.W = W; L.H = Hh; L.dpr = Math.min(2, ctx.dpr || 1);
    const usableH = Hh - a.top - a.bottom;
    // the platform spans most of the width; keep room above for the HUD
    // the deck nearly spans the width; the camera pulls back for a fall
    L.k = Math.min((W - 16) / 4.3, (usableH - 200) / (1.6 - GEOM.tableY));
    L.px = W / 2;
    L.py = a.top + 112 + 1.6 * L.k;
    // spread spare height between the HUD gap and the table
    const spare = (Hh - a.bottom - 52) - (L.py - GEOM.tableY * L.k);
    if (spare > 0) L.py += spare * 0.8;
    L.hudBottom = a.top + 112;
    L.padX = Math.round(W * 0.56); L.padY = Math.round(Hh * 0.3);
    placeUI();
  }
  function buildArt() {
    const key = [L.W, L.H, L.dpr, L.k.toFixed(2), save.surface].join('|');
    if (key === artKey) return;
    const sizeChanged = !artKey || artKey.split('|').slice(0, 4).join('|') !== key.split('|').slice(0, 4).join('|');
    artKey = key;
    const S = L.k * L.dpr;
    if (sizeChanged || !bg) {
      bg = paintBackground(L, 11);
      sprites = { platforms: {} };
      sprites.cw = paintCounterweight(S, 23); grain(sprites.cw.canvas, 0.05, mulberry32(3), false);
      sprites.danger = paintDanger(S, 31);
      sprites.broken = paintBroken(S, 41); grain(sprites.broken.canvas, 0.04, mulberry32(5), false);
      sprites.egg = null;
    }
    if (!sprites.platforms[save.surface]) { const p = paintPlatform(S, save.surface, 17); grain(p.canvas, 0.05, mulberry32(9), false); sprites.platforms[save.surface] = p; }
  }
  function eggSprite() {
    if (!sprites.egg && sim) { sprites.egg = paintEggShell(L.k * L.dpr, sim.outline, 29); grain(sprites.egg.canvas, 0.035, mulberry32(7), false); }
    return sprites.egg;
  }

  // ---- DOM controls ----
  const icons = el('div', 'ed-icons');
  const muteBtn = el('button', 'ed-icon', save.muted ? ICON.mute : ICON.sound, icons);
  muteBtn.setAttribute('aria-label', 'Sound');
  const motionOK = !!(caps.motion && ctx.motion);
  const tiltBtn = motionOK ? el('button', 'ed-icon', ICON.tilt, icons) : null;
  if (tiltBtn) tiltBtn.setAttribute('aria-label', 'Tilt control');
  const chips = el('div', 'ed-chips');
  const chipEls = {};
  const SW = { rubber: PAL.olive2, wood: '#d9a25a', ceramic: PAL.ivory, metal: '#c9b48a' };
  for (const id of SURFACE_ORDER) {
    const b = el('button', 'ed-chip', `<i style="background:${SW[id]}"></i><span>${SURFACES[id].label}</span>`, chips);
    chipEls[id] = b;
    ctx.input.activate(b, () => { if (state === 'play' || state === 'falling') return; audio.unlock(); selectSurface(id); });
  }
  const card = el('div', 'ed-card');
  card.style.display = 'none';
  function placeUI() {
    const a = area();
    icons.style.top = (a.top + 10) + 'px'; icons.style.right = (a.right + 12) + 'px';
    chips.style.bottom = (a.bottom + 12) + 'px';
    card.style.top = Math.max(a.top + 70, L.H * 0.16) + 'px';
  }
  function refreshChips() { for (const id of SURFACE_ORDER) chipEls[id].classList.toggle('sel', id === save.surface); }
  refreshChips();

  // a painted paper texture for the result card
  (function () {
    const c = makeCanvas(330, 420), cg = c.getContext('2d'), r = mulberry32(77);
    cg.fillStyle = PAL.ivory; cg.fillRect(0, 0, 330, 420);
    strokeFill(cg, r, { x: -20, y: -20, w: 370, h: 460 }, PAL.ivory, { angle: -0.4, width: 30, length: 110, count: 60, alpha: 0.35, spread: 0.06 });
    for (let i = 0; i < 4; i++) wash(cg, r, r() * 330, r() * 420, 90, PAL.butter, 0.12);
    grain(c, 0.06, r, true);
    try { card.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.82)})`; } catch (e) { }
  })();

  // ---- audio ----
  const audio = createAudio(ctx);
  audio.muted = !!save.muted;
  audio.musicVol = tune('music_volume', 0.32);
  ctx.onDestroy(() => audio.dispose());
  ctx.input.activate(muteBtn, () => {
    audio.unlock();
    save.muted = !save.muted; persist();
    audio.setMuted(save.muted);
    muteBtn.innerHTML = save.muted ? ICON.mute : ICON.sound;
  });

  // optional tilt control: the phone's tilt sets the carriage's target
  let tilt = null, tiltOn = false;
  if (tiltBtn) ctx.input.activate(tiltBtn, async () => {
    audio.unlock();
    if (tiltOn) { tiltOn = false; tiltBtn.classList.remove('on'); toast('Drag control'); return; }
    try {
      await ctx.motion.start({ calibrate: true });
      if (disposed) return;
      if (!tilt) tilt = ctx.motion.tiltControl({ maxAngle: 22, deadzone: 0.04, smoothing: 0.25, calibrate: true });
      else { try { ctx.motion.calibrate(); } catch (e) { } }
      tiltOn = true; tiltBtn.classList.add('on'); toast('Tilt the phone to slide the weight');
    } catch (e) {
      tiltOn = false; tiltBtn.classList.remove('on'); toast('Tilt unavailable: drag the weight instead');
    }
  });

  // ---- simulation and run state ----
  let pl = null, sim = null, dist = null;
  let state = 'loading';
  let run = null, attempt = 0, runSeed = (Date.now() & 0xffff) ^ 0x5eed;
  const prev = { ang: 0, cw: 0, ex: 0, ey: 0, ea: 0 }, cur = { ang: 0, cw: 0, ex: 0, ey: 0, ea: 0 };
  const fx = { zoom: 1, pan: 0, slide: 0, roll: 0, danger: 0, air: 0, creak: 0, grabGlow: 0, phaseFlash: 0, lastPhase: 0, floaters: [], toast: null, broken: null, fallT: 0 };
  const timeTrack = ctx.game.score('time', { primary: true, min: 0 });
  const pointsTrack = ctx.game.score('points', { min: 0 });

  function snapshot(o) {
    o.ang = sim.platform.getAngle(); o.cw = sim.cwPos();
    const p = sim.egg.getPosition(); o.ex = p.x; o.ey = p.y; o.ea = sim.egg.getAngle();
  }
  function newSim() {
    sim = createSim(pl, {
      surface: save.surface,
      gravityScale: tune('gravity_scale', 1),
      angularDamping: tune('platform_damping', 0.55),
      cwMass: tune('counterweight_mass', 0.95)
    });
    sprites.egg = null;
    snapshot(prev); snapshot(cur);
  }
  function selectSurface(id) {
    if (save.surface === id) return;
    save.surface = id; persist(); refreshChips();
    buildArt();
    hideCard();
    newSim(); state = 'ready'; run = null; fx.broken = null;
    ctx.platform.interact({ type: 'surface', surface: id });
  }
  function toast(text) { fx.toast = { text, t: 0 }; }

  function beginRun() {
    attempt++;
    runSeed = (runSeed * 1103515245 + 12345 + attempt * 7919) >>> 0;
    dist = createDisturbance(runSeed, tune('disturbance_strength', 1));
    run = { t: 0, bonus: 0, counts: { level: 0, rescue: 0, weathered: 0, light: 0 }, levelT: 0, critical: false, gustWatch: -1, winStart: 0, winClean: true, fellAt: 0, maxPhase: 0 };
    state = 'play';
    timeTrack.reset(); pointsTrack.reset();
    fx.lastPhase = 0; fx.floaters.length = 0;
    chips.style.opacity = '0'; chips.style.pointerEvents = 'none';
    ctx.platform.start({ surface: save.surface });
    audio.music(0.2);
  }
  function addBonus(kind, pts, label) {
    run.bonus += pts; run.counts[kind]++;
    const l = sim.eggLocal();
    fx.floaters.push({ text: label + '  +' + pts, x: l.x, t: 0 });
    audio.chime(kind === 'rescue');
    if (caps.haptics) ctx.platform.haptic(kind === 'rescue' ? 'success' : 'light');
    ctx.platform.milestone(kind, { t: Math.round(run.t * 1000) });
  }

  // ---- input: grab the carriage anywhere, drag horizontally ----
  const drag = { id: null, startX: 0, startTarget: 0, lastX: 0 };
  ctx.listen(canvas, 'pointerdown', (e) => {
    if (drag.id !== null || !sim) return;
    if (state !== 'ready' && state !== 'play') return;
    audio.unlock();
    drag.id = e.pointerId; drag.startX = e.clientX; drag.lastX = e.clientX;
    drag.startTarget = sim.cwPos();
    sim.target = drag.startTarget;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    audio.grab(); fx.grabGlow = 1;
    if (caps.haptics) ctx.platform.haptic('light');
    if (state === 'ready') beginRun();
    ctx.platform.interact({ type: 'grab' });
    e.preventDefault();
  });
  ctx.listen(canvas, 'pointermove', (e) => {
    if (e.pointerId !== drag.id || !sim) return;
    drag.lastX = e.clientX;
    sim.target = Math.max(-GEOM.travel - 0.08, Math.min(GEOM.travel + 0.08, drag.startTarget + (e.clientX - drag.startX) / L.k));
  });
  const endDrag = (e) => {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    audio.release();
    if (caps.haptics) ctx.platform.haptic('light');
  };
  ctx.listen(canvas, 'pointerup', endDrag);
  ctx.listen(canvas, 'pointercancel', endDrag);
  const keys = { l: false, r: false };
  ctx.listen(window, 'keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = true;
    else if (e.key === 'ArrowRight' || e.key === 'd') keys.r = true;
    else if ((e.key === ' ' || e.key === 'Enter') && state === 'results') { again(); return; }
    else return;
    audio.unlock();
    if (state === 'ready' && sim) { sim.target = sim.cwPos(); beginRun(); }
  });
  ctx.listen(window, 'keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = false; });

  // ---- fixed-step simulation ----
  function fixedUpdate() {
    if (!sim) return;
    snapshot(prev);
    const live = state === 'ready' || state === 'play';
    // who is steering the carriage
    if (live && drag.id !== null) sim.dragging = true;
    else if (live && (keys.l || keys.r)) { sim.dragging = true; sim.target = Math.max(-GEOM.travel - 0.05, Math.min(GEOM.travel + 0.05, sim.target + ((keys.r ? 1 : 0) - (keys.l ? 1 : 0)) * 1.6 * H_STEP)); }
    else if (state === 'play' && tiltOn && tilt) { sim.dragging = true; sim.target = Math.max(-1, Math.min(1, tilt.x)) * GEOM.travel; }
    else sim.dragging = false;

    if (state === 'play') {
      run.t += H_STEP;
      const l = sim.eggLocal();
      const side = Math.abs(l.x) > 1.25 ? Math.sign(l.x) : 0;
      sim.disturb = dist.update(run.t, H_STEP, side);
      for (const ev of dist.events) {
        if (ev === 'gustWarn') audio.gustWarn();
        else if (ev === 'gust') { audio.gust(); if (caps.haptics) ctx.platform.haptic('medium'); }
      }
      scoreStep(l);
    } else if (state === 'ready') sim.disturb = 0;
    else sim.disturb = 0;

    sim.step(H_STEP);
    snapshot(cur);

    // physical events to sound and touch
    if (sim.limitHit) { audio.clunk(sim.limitHit); if (caps.haptics && sim.limitHit > 0.6) ctx.platform.haptic('medium'); if (run && state === 'play') run.winClean = false; sim.limitHit = 0; }
    if (sim.stopHit) { audio.thud(sim.stopHit); sim.stopHit = 0; }
    if (sim.deckImpact > 0.06) audio.tick(sim.deckImpact, save.surface);
    sim.deckImpact = 0;
    const w = sim.platform.getAngularVelocity(), a = sim.platform.getAngle();
    if (Math.abs(a) > 0.16 && Math.abs(w) > 0.03) {
      fx.creak += Math.abs(w) * H_STEP * 22;
      if (fx.creak > 1) { fx.creak = 0; audio.creak(Math.min(1, (Math.abs(a) - 0.12) / 0.19)); }
    }

    if (state === 'play' && sim.eggFallen()) {
      state = 'falling'; fx.fallT = 0;
      run.fellAt = run.t;
      audio.fall(); audio.duck(0.6, 1200);
      if (caps.haptics) ctx.platform.haptic('heavy');
      drag.id = null;
    }
    if (state === 'falling') {
      fx.fallT += H_STEP;
      const p = sim.egg.getWorldCenter();
      if (sim.tableImpact > 0.12 || p.y < GEOM.tableY + 0.45 || fx.fallT > 2.6) crack();
    }
    sim.tableImpact = 0;
    if (state === 'broken') {
      fx.fallT += H_STEP;
      if (fx.fallT > 1.0) showResults();
    }
  }

  function scoreStep(l) {
    const a = Math.abs(sim.platform.getAngle());
    // level: held within two degrees for four seconds
    if (run.t > 3 && a < 0.035) { run.levelT += H_STEP; if (run.levelT >= 4) { run.levelT = 0; addBonus('level', 25, 'Level'); } }
    else run.levelT = 0;
    // rescue: back to the middle from the brink
    if (Math.abs(l.x) > 1.5) run.critical = true;
    else if (run.critical && Math.abs(l.x) < 0.6) { run.critical = false; addBonus('rescue', 100, 'Rescued'); }
    // weathered a gust
    if (dist.gustJustEnded) run.gustWatch = run.t;
    if (run.gustWatch >= 0 && run.t - run.gustWatch > 2.5) { run.gustWatch = -1; addBonus('weathered', 60, 'Weathered'); }
    // light touch: ten seconds without slamming or over-reaching the carriage
    if (Math.abs(sim.cwPos()) > 1.2) run.winClean = false;
    if (run.t - run.winStart >= 10) { if (run.winClean && run.t > 9) addBonus('light', 20, 'Light touch'); run.winStart = run.t; run.winClean = true; }
    // phase changes
    const ph = dist.phase;
    if (ph !== fx.lastPhase) {
      fx.lastPhase = ph; fx.phaseFlash = 1;
      audio.music([0.2, 0.34, 0.5, 0.66][ph]);
      ctx.platform.milestone('phase_' + PHASES[ph].name.toLowerCase());
    }
    const secs = Math.floor(run.t * 10);
    timeTrack.set(Math.round(run.t * 1000));
    pointsTrack.set(secs + run.bonus);
  }

  function crack() {
    state = 'broken'; fx.fallT = 0;
    const p = sim.egg.getWorldCenter();
    fx.broken = { x: Math.max(-4.2, Math.min(4.2, p.x)), t: 0 };
    sim.egg.setActive(false);
    audio.crack();
    if (caps.haptics) ctx.platform.haptic('error');
  }

  // ---- results ----
  let boardCache = {};
  function showResults() {
    state = 'results';
    const tSec = run.fellAt, ms = Math.round(tSec * 1000);
    const pts = Math.floor(tSec * 10) + run.bonus;
    timeTrack.set(ms); pointsTrack.set(pts);
    const surf = save.surface;
    const prevBest = save.best[surf] || 0;
    const isBest = ms > prevBest;
    if (isBest) save.best[surf] = ms;
    if (pts > (save.bestPts[surf] || 0)) save.bestPts[surf] = pts;
    save.runs = (save.runs || 0) + 1;
    persist();
    const msg = MESSAGES.find(m => tSec < m[0])[1];
    const c = run.counts;
    const parts = [];
    if (c.level) parts.push('Level ×' + c.level);
    if (c.rescue) parts.push('Rescued ×' + c.rescue);
    if (c.weathered) parts.push('Weathered ×' + c.weathered);
    if (c.light) parts.push('Light touch ×' + c.light);
    card.innerHTML = `
      <div class="ed-kick">The egg fell from ${SURFACES[surf].label.toLowerCase()}</div>
      <div class="ed-time">${fmtTime(tSec)}<small>s</small></div>
      <div class="ed-best">${isBest && prevBest ? '<b>New best</b> · was ' + fmtTime(prevBest / 1000) + ' s' : isBest ? '<b>First balance</b>' : 'Best ' + fmtTime(save.best[surf] / 1000) + ' s'}</div>
      <div class="ed-msg">${msg}</div>
      <div class="ed-pts"><strong>${pts}</strong> points${parts.length ? ' · ' + parts.join(' · ') : ''}</div>
      <div class="ed-board"><span class="ed-dim">Updating board…</span></div>
      <button class="ed-again">Again</button>`;
    card.style.display = 'block';
    requestFrameClass();
    ctx.input.activate(card.querySelector('.ed-again'), again);
    chips.style.opacity = '1'; chips.style.pointerEvents = '';
    audio.music(0.14);
    if (isBest && prevBest) audio.sting('success');
    ctx.platform.fail({ reason: 'egg_fell', timeMs: ms, points: pts, surface: surf });
    if (isBest && tSec >= 10) { try { ctx.pulse.complete({ timeMs: ms, timeLabel: fmtTime(tSec) + ' s', text: 'Kept the egg on ' + SURFACES[surf].label.toLowerCase() + ' for ' + fmtTime(tSec) + ' s' }); } catch (e) { } }
    submitAndBoard(attempt, ms, pts, surf);
  }
  function requestFrameClass() { ctx.timeout(() => { if (state === 'results') card.classList.add('show'); }, 30); }
  function hideCard() { card.classList.remove('show'); card.style.display = 'none'; }
  async function submitAndBoard(att, ms, pts, surf) {
    const dims = { surface: surf };
    const boardEl = () => card.querySelector('.ed-board');
    const cached = boardCache[surf];
    if (cached && boardEl()) boardEl().innerHTML = renderBoard(cached, true);
    try { timeTrack.submit('time', { label: fmtTime(ms / 1000) + ' s', dimensions: dims }).catch(() => { }); } catch (e) { }
    try { pointsTrack.submit('score', { label: pts + ' pts', dimensions: dims }).catch(() => { }); } catch (e) { }
    try {
      const board = await timeTrack.leaderboard('time', { scope: 'global', period: 'all_time', dimensions: dims, limit: 3 });
      if (disposed || att !== attempt || state !== 'results') return;
      boardCache[surf] = board;
      if (boardEl()) boardEl().innerHTML = renderBoard(board, false);
    } catch (e) {
      if (disposed || att !== attempt || state !== 'results') return;
      if (boardEl()) boardEl().innerHTML = cached ? renderBoard(cached, true) : '<span class="ed-dim">Board unavailable right now</span>';
    }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderBoard(b, stale) {
    const rows = (b && b.rows || []).slice(0, 3);
    if (!rows.length) return '<span class="ed-dim">No balances on this surface yet</span>';
    const me = b.viewerRank;
    let h = rows.map(r => {
      const name = r.username || r.displayName || r.name || 'player';
      const val = r.displayLabel || fmtTime((r.value || 0) / 1000) + ' s';
      const mine = me && me.rank === r.rank && (me.userId == null || me.userId === r.userId);
      return `<div class="ed-row${mine ? ' me' : ''}"><span>${r.rank}. ${esc(name)}</span><span>${esc(val)}</span></div>`;
    }).join('');
    if (me && me.rank != null) h += `<div class="ed-row me"><span>Your rank</span><span>#${me.rank}${b.totalRanked ? ' of ' + b.totalRanked : ''}</span></div>`;
    if (stale) h += '<div class="ed-dim">Updating…</div>';
    return h;
  }
  function again() {
    if (state !== 'results') return;
    hideCard();
    newSim(); fx.broken = null; run = null;
    state = 'ready';
    audio.silenceLayers();
    ctx.platform.interact({ type: 'replay' });
  }

  // ---- rendering ----
  const lerp = (a, b, t) => a + (b - a) * t;
  function W2S(x, y) { return [L.px + x * L.k, L.py - y * L.k]; }
  function drawEgg(ex, ey, ea) {
    const spr = eggSprite();
    if (!spr) return;
    const [sx, sy] = W2S(ex, ey);
    blitFrame(g, spr, sx, sy, ea, L.k);
    // light: from the upper left, fixed in the room while the shell turns
    const c = Math.cos(ea), s = Math.sin(ea);
    g.save();
    g.beginPath();
    sim.outline.forEach((p, i) => {
      const x = sx + (p.x * c - p.y * s) * L.k, y = sy - (p.x * s + p.y * c) * L.k;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.clip();
    const R = GEOM.eggA * L.k;
    const sh = g.createRadialGradient(sx - R * 0.4, sy - R * 0.45, R * 0.2, sx - R * 0.1, sy - R * 0.1, R * 1.35);
    sh.addColorStop(0, 'rgba(120,70,30,0)'); sh.addColorStop(0.62, 'rgba(120,70,30,0.05)'); sh.addColorStop(1, 'rgba(110,55,25,0.42)');
    g.fillStyle = sh; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    const hi = g.createRadialGradient(sx - R * 0.38, sy - R * 0.42, 0, sx - R * 0.38, sy - R * 0.42, R * 0.6);
    hi.addColorStop(0, 'rgba(255,253,244,0.75)'); hi.addColorStop(0.5, 'rgba(255,250,236,0.22)'); hi.addColorStop(1, 'rgba(255,250,236,0)');
    g.fillStyle = hi; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    // warm light bounced up from the deck
    const bo = g.createRadialGradient(sx, sy + R * 1.1, 0, sx, sy + R * 1.1, R * 0.9);
    bo.addColorStop(0, 'rgba(214,120,50,0.22)'); bo.addColorStop(1, 'rgba(214,120,50,0)');
    g.fillStyle = bo; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    g.restore();
  }

  function drawStreaks(dir, amt, time) {
    // air pressing down on the end that the gust will push
    if (amt <= 0.01) return;
    const endX = dir > 0 ? -1.4 : 1.4;
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const ph = (time * 0.9 + i / 6) % 1;
      const x = endX + (i - 2.5) * 0.22 + Math.sin(i * 7.1) * 0.08;
      const y = 2.0 - ph * 1.5;
      const [sx, sy] = W2S(x, y);
      const a = amt * Math.sin(ph * Math.PI) * 0.75;
      g.strokeStyle = `rgba(250,243,226,${a})`;
      for (let j = 0; j < 3; j++) {
        g.lineWidth = (3 - j) * 1.3;
        g.beginPath();
        g.moveTo(sx + j * 2, sy - j * 10);
        g.quadraticCurveTo(sx + 9 * -dir + j * 2, sy + 14 - j * 10, sx + j * 2, sy + 30 - j * 10);
        g.stroke();
      }
    }
    g.restore();
  }

  function drawHUD(time) {
    const a = area(), cx = L.W / 2;
    const top = a.top + 8;
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (state === 'ready' || state === 'loading') {
      g.fillStyle = PAL.burgundy;
      g.font = `${Math.round(Math.min(46, L.W * 0.12))}px 'DM Serif Display', Georgia, serif`;
      g.fillText('Egg Drop', cx, top + 44);
      g.fillStyle = PAL.umber;
      g.font = `italic 300 ${Math.round(Math.min(21, L.W * 0.055))}px 'Cormorant Garamond', Georgia, serif`;
      g.fillText('Move the weight. Keep the egg alive.', cx, top + 70);
    } else if (state !== 'results') {
      const t = run ? (state === 'play' ? run.t : run.fellAt) : 0;
      g.fillStyle = PAL.burgundy;
      g.font = `${Math.round(Math.min(52, L.W * 0.135))}px 'DM Serif Display', Georgia, serif`;
      g.fillText(fmtTime(t), cx, top + 48);
      g.font = `600 10.5px 'Inter', system-ui, sans-serif`;
      g.fillStyle = rgba(PAL.umber, 0.75);
      const best = save.best[save.surface];
      const pts = run ? Math.floor(t * 10) + run.bonus : 0;
      g.fillText(((best ? 'BEST ' + fmtTime(best / 1000) + '   ·   ' : '') + pts + ' PTS'), cx, top + 66);
    }
    // spirit level: the bubble rises to the high end
    const lw = Math.min(150, L.W * 0.38), lh = 18, ly = top + 82;
    const ang = lerp(prev.ang, cur.ang, renderAlpha);
    g.fillStyle = PAL.brass; roundedRect(g, cx - lw / 2 - 4, ly - 4, lw + 8, lh + 8, (lh + 8) / 2); g.fill();
    g.strokeStyle = PAL.brass2; g.lineWidth = 1.5; g.stroke();
    const tilt = Math.abs(ang) / 0.31;
    g.fillStyle = tilt > 0.62 ? mixHex('#c9c48a', PAL.vermilion, Math.min(1, (tilt - 0.62) / 0.38) * 0.75) : '#c9c48a';
    roundedRect(g, cx - lw / 2, ly, lw, lh, lh / 2); g.fill();
    g.strokeStyle = rgba(PAL.umber, 0.6); g.lineWidth = 1;
    for (const dx of [-11, 11]) { g.beginPath(); g.moveTo(cx + dx, ly + 2); g.lineTo(cx + dx, ly + lh - 2); g.stroke(); }
    const bx = cx + Math.max(-1, Math.min(1, ang / 0.31)) * (lw / 2 - 12);
    g.fillStyle = 'rgba(250,246,226,0.95)';
    g.beginPath(); g.ellipse(bx, ly + lh / 2, 9, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(bx - 3, ly + lh / 2 - 2, 3, 1.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(cx - lw / 2 + 8, ly + 3, lw - 16, 2);

    // phase word, briefly
    if (fx.phaseFlash > 0 && state === 'play') {
      g.globalAlpha = Math.min(1, fx.phaseFlash * 1.6);
      g.fillStyle = PAL.burgundy;
      g.font = `italic 300 19px 'Cormorant Garamond', Georgia, serif`;
      g.fillText(PHASES[fx.lastPhase].name, cx, ly + lh + 28);
      g.globalAlpha = 1;
    }
    // instruction, then the personal best, under the level
    if (state === 'ready') {
      const best = save.best[save.surface];
      if (best) {
        g.font = `600 10.5px 'Inter', system-ui, sans-serif`; g.fillStyle = rgba(PAL.umber, 0.75);
        g.fillText('BEST ON ' + SURFACES[save.surface].label.toUpperCase() + '  ' + fmtTime(best / 1000) + ' S', cx, ly + lh + 24);
      }
    } else if (state === 'play' && run && run.t < 9 && fx.phaseFlash <= 0) {
      g.globalAlpha = Math.max(0, Math.min(1, (9 - run.t) / 2));
      g.fillStyle = PAL.umber;
      g.font = `italic 300 ${Math.round(Math.min(21, L.W * 0.055))}px 'Cormorant Garamond', Georgia, serif`;
      g.fillText('Move the weight. Keep the egg alive.', cx, ly + lh + 28);
      g.globalAlpha = 1;
    }
    if (fx.toast) {
      const tt = fx.toast.t, al = tt < 0.2 ? tt / 0.2 : tt > 2.2 ? Math.max(0, 1 - (tt - 2.2) / 0.4) : 1;
      g.globalAlpha = al;
      g.font = `600 12px 'Inter', system-ui, sans-serif`;
      const w = g.measureText(fx.toast.text).width + 28, y = ly + lh + 56;
      g.fillStyle = rgba(PAL.umber, 0.82); roundedRect(g, cx - w / 2, y - 18, w, 28, 14); g.fill();
      g.fillStyle = PAL.ivory; g.fillText(fx.toast.text, cx, y + 1);
      g.globalAlpha = 1;
    }
    g.restore();
  }
  function roundedRect(gg, x, y, w, h, r) { gg.beginPath(); gg.moveTo(x + r, y); gg.arcTo(x + w, y, x + w, y + h, r); gg.arcTo(x + w, y + h, x, y + h, r); gg.arcTo(x, y + h, x, y, r); gg.arcTo(x, y, x + w, y, r); gg.closePath(); }

  // a ghost finger shows the drag on the first visits
  function drawGhost(time) {
    if (state !== 'ready' || (save.runs || 0) >= 3) return;
    const [cx, cy] = W2S(0, GEOM.railY - 0.75);
    const u = (time * 0.45) % 1, x = cx + Math.sin(u * Math.PI * 2) * L.k * 0.7;
    g.save();
    g.globalAlpha = 0.55 + 0.25 * Math.sin(time * 3);
    g.fillStyle = PAL.ivory; g.strokeStyle = PAL.umber; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, cy, 13, 0, Math.PI * 2); g.fill(); g.stroke();
    g.globalAlpha = 0.35; g.lineWidth = 2; g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(cx - L.k * 0.7, cy); g.lineTo(cx + L.k * 0.7, cy); g.stroke();
    g.restore();
  }

  let renderAlpha = 0, clock = 0;
  function render(alpha) {
    renderAlpha = alpha;
    if (!bg) return;
    // camera: pulls back a little to keep a falling egg in view
    const zx = L.px, zy = L.py;
    g.fillStyle = PAL.butter; g.fillRect(0, 0, L.W, L.H);
    g.save();
    g.translate(zx, zy); g.scale(fx.zoom, fx.zoom); g.translate(-zx - fx.pan, -zy);
    g.drawImage(bg, -L.padX, -L.padY, L.W + L.padX * 2, L.H + L.padY * 2);
    if (sim) drawWorld(alpha);
    g.restore();
    if (!sim) { drawHUD(clock); return; }
    drawGhost(clock);
    drawHUD(clock);
  }
  function drawWorld(alpha) {
    const ang = lerp(prev.ang, cur.ang, alpha), cwx = lerp(prev.cw, cur.cw, alpha);
    const ex = lerp(prev.ex, cur.ex, alpha), ey = lerp(prev.ey, cur.ey, alpha), ea = lerp(prev.ea, cur.ea, alpha);
    const c = Math.cos(ang), s = Math.sin(ang);
    const toWorld = (lx, ly) => [lx * c - ly * s, lx * s + ly * c];

    // broken egg lies on the table, behind the stand's plinth line
    if (fx.broken) {
      const [bx, by] = W2S(fx.broken.x, GEOM.tableY);
      blitFrame(g, sprites.broken, bx, by, 0, L.k);
    }
    // egg falling past the table front reads behind the platform
    const plat = sprites.platforms[save.surface];
    blitFrame(g, plat, L.px, L.py, ang, L.k);

    // danger: pigment blooms on the end the egg is near
    const el2 = (() => { const dx = ex - 0, dy = ey; return { x: dx * c + dy * s, y: -dx * s + dy * c }; })();
    if (state === 'play' && fx.danger > 0.02) {
      const sx = Math.sign(el2.x) * (GEOM.half - 0.35);
      const [wx, wy] = toWorld(sx, GEOM.deckBottom);
      const [dx, dy] = W2S(wx, wy);
      g.save(); g.globalAlpha = Math.min(0.85, fx.danger * 0.9);
      blitFrame(g, sprites.danger, dx, dy, ang, L.k);
      g.restore();
    }

    // axle cap, with a slot that turns with the platform
    {
      const R = 0.075 * L.k;
      g.save(); g.translate(L.px, L.py);
      g.fillStyle = PAL.brass2; g.beginPath(); g.arc(0, 0, R * 1.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = PAL.brass; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgba(PAL.brassHi, 0.8); g.beginPath(); g.arc(-R * 0.3, -R * 0.3, R * 0.45, 0, Math.PI * 2); g.fill();
      g.rotate(-ang);
      g.strokeStyle = PAL.umber; g.lineWidth = Math.max(1.2, R * 0.22); g.lineCap = 'round';
      g.beginPath(); g.moveTo(-R * 0.6, 0); g.lineTo(R * 0.6, 0); g.stroke();
      g.restore();
    }

    // counterweight carriage
    {
      const [wx, wy] = toWorld(cwx, GEOM.railY);
      const [sx, sy] = W2S(wx, wy);
      const grabbing = drag.id !== null || (tiltOn && state === 'play');
      fx.grabGlow += ((grabbing ? 1 : 0) - fx.grabGlow) * 0.2;
      if (fx.grabGlow > 0.02) {
        g.save(); g.globalAlpha = 0.28 * fx.grabGlow; g.fillStyle = PAL.brassHi;
        g.beginPath(); g.ellipse(sx, sy + 0.16 * L.k, 0.3 * L.k, 0.3 * L.k, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.save(); g.globalAlpha = 0.16; g.fillStyle = PAL.burgundy2;
      g.beginPath(); g.ellipse(sx + 0.05 * L.k, sy + 0.24 * L.k, 0.3 * L.k, 0.36 * L.k, 0, 0, Math.PI * 2); g.fill(); g.restore();
      // lifted a hair while held
      g.save(); g.translate(0, -1.5 * fx.grabGlow);
      blitFrame(g, sprites.cw, sx, sy, ang, L.k);
      g.restore();
    }

    // egg contact shadow on the deck
    if (state !== 'broken' && state !== 'results') {
      const hgt = el2.y - GEOM.deckTop - GEOM.eggB * 0.9;
      if (Math.abs(el2.x) < GEOM.half + 0.2 && hgt < 0.5) {
        const al = Math.max(0, 0.38 * (1 - hgt / 0.5));
        const [wx, wy] = toWorld(Math.max(-GEOM.half, Math.min(GEOM.half, el2.x)), GEOM.deckTop);
        const [sx, sy] = W2S(wx, wy);
        g.save(); g.translate(sx, sy); g.rotate(-ang);
        g.fillStyle = `rgba(59,36,23,${al})`;
        g.beginPath(); g.ellipse(0, 0, GEOM.eggA * L.k * 0.85, 0.035 * L.k, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      drawEgg(ex, ey, ea);
    }

    // gust warning and gust
    if (state === 'play' && dist) drawStreaks(dist.warningDir, Math.max(dist.warning * 0.7, dist.gustActive ? dist.gustAmp : 0), clock);

    // bonus words rising from the deck
    for (let i = fx.floaters.length - 1; i >= 0; i--) {
      const f = fx.floaters[i];
      if (f.t > 1.8) { fx.floaters.splice(i, 1); continue; }
      const [wx, wy] = toWorld(Math.max(-1.5, Math.min(1.5, f.x)), GEOM.deckTop + 0.78 + f.t * 0.3);
      const [sx, sy] = W2S(wx, wy);
      g.save(); g.globalAlpha = f.t < 0.2 ? f.t / 0.2 : Math.max(0, 1 - (f.t - 1.2) / 0.6);
      g.textAlign = 'center'; g.font = `italic 300 21px 'Cormorant Garamond', Georgia, serif`;
      g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = rgba(PAL.burgundy2, 0.85); g.strokeText(f.text, sx, sy);
      g.fillStyle = PAL.ivory; g.fillText(f.text, sx, sy);
      g.restore();
    }
  }

  function frameUpdate(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000);
    clock += dt;
    if (fx.toast) { fx.toast.t += dt; if (fx.toast.t > 2.6) fx.toast = null; }
    if (fx.phaseFlash > 0) fx.phaseFlash = Math.max(0, fx.phaseFlash - dt / 2.4);
    for (const f of fx.floaters) f.t += dt;
    if (!sim) return;
    // camera pull-back while the egg is off the deck
    let zt = 1, pt = 0;
    if (state === 'falling' || state === 'broken' || state === 'results') {
      const ex = fx.broken ? fx.broken.x : sim.egg.getWorldCenter().x;
      if (Math.abs(ex) > L.W / 2 / L.k - 0.5) {
        zt = 0.72;
        const room = L.padX - (L.W / 2) * (1 / zt - 1) - 6;
        pt = Math.max(-room, Math.min(room, ex * L.k * 0.55));
      }
    }
    const kz = Math.min(1, dt * (state === 'falling' ? 6 : 3));
    fx.zoom += (zt - fx.zoom) * kz;
    fx.pan += (pt - fx.pan) * kz;
    // smoothed audio and danger parameters
    const l = sim.eggLocal(), v = sim.eggLocalVel();
    let danger = 0;
    if (state === 'play') {
      const reach = Math.abs(l.x) + Math.max(0, Math.sign(l.x) * v.x) * 0.5;
      danger = Math.max(0, Math.min(1, (reach - 1.15) / (GEOM.half - 1.15)));
    }
    fx.danger += (danger - fx.danger) * Math.min(1, dt * 6);
    const live = state === 'play' || state === 'ready';
    fx.slide += ((live ? Math.abs(sim.rail.getJointSpeed()) : 0) - fx.slide) * Math.min(1, dt * 14);
    const rollV = sim.eggOnDeck && live ? Math.abs(sim.egg.getAngularVelocity() - sim.platform.getAngularVelocity()) * GEOM.eggB : 0;
    fx.roll += (rollV - fx.roll) * Math.min(1, dt * 10);
    fx.air += (((state === 'play' && dist) ? Math.max(dist.warning * 0.5, dist.gustActive ? dist.gustAmp : 0) : 0) - fx.air) * Math.min(1, dt * 5);
    audio.update({ slide: fx.slide, roll: fx.roll, danger: fx.danger, air: fx.air, surface: save.surface });
  }

  // ---- boot ----
  layout();
  try { buildArt(); } catch (e) { ctx.platform.error({ stage: 'art', message: String(e && e.message || e) }); }
  render(0);
  ctx.markVisualReady('backdrop');

  async function loadPhysics() {
    try {
      await ctx.loadScript('planck', '1.5.0');
      if (disposed) return false;
      pl = window.planck;
      if (!pl || !pl.World) throw new Error('planck global missing after load');
      return true;
    } catch (e) {
      ctx.platform.error({ stage: 'dependency', library: 'planck@1.5.0', message: String(e && e.message || e) });
      return false;
    }
  }
  let errBox = null;
  async function boot() {
    const ok = await loadPhysics();
    if (disposed) return;
    if (!ok) {
      if (!errBox) {
        errBox = el('div', 'ed-err', '<div style="margin-bottom:12px">The physics engine could not be fetched.</div><button class="ed-again">Try again</button>');
        let busy = false;
        ctx.input.activate(errBox.querySelector('button'), async () => { if (busy) return; busy = true; errBox.style.opacity = '0.5'; await boot(); busy = false; if (errBox) errBox.style.opacity = '1'; });
      }
      return;
    }
    if (errBox) { errBox.remove(); errBox = null; }
    newSim();
    state = 'ready';
    render(0);
    ctx.platform.ready();
  }

  ctx.onResize(() => { layout(); try { buildArt(); } catch (e) { } if (state !== 'loading') render(renderAlpha); }, { debounceMs: 80 });

  ctx.game.loop({
    fixedHz: 120, maxSubsteps: 12, maxDeltaMs: 100,
    fixedUpdate: () => { if (!disposed) fixedUpdate(); },
    update: (dtMs) => { if (!disposed) frameUpdate(dtMs); },
    render: (alpha) => { if (!disposed) render(alpha); }
  });

  if (typeof window !== 'undefined' && window.__EGG_DEV) {
    window.__egg = { get sim() { return sim; }, get state() { return state; }, get run() { return run; }, get dist() { return dist; }, L, again, beginRun, selectSurface, fx, save, get drag() { return drag; } };
  }
  await boot();
}

window.plethoraBit = {
  meta: {
    title: 'Egg Drop',
    runtime: 'plethora-bit@2',
    tags: ['arcade', 'physics', 'balance'],
    permissions: ['haptics', 'audio', 'backgroundMusic', 'storage', 'motion']
  },
  init: eggDropInit
};

})();
