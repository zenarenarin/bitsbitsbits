// UNMAKE — an endless 3D physics arcade for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// UNMAKE — shared math. Vectors are [x, y, z] arrays, quaternions [x, y, z, w].
// World axes: x = across the route, y = up, -z = the way forward.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

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
const vNorm = a => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const vAddS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

const QI = () => [0, 0, 0, 1];
function qAxis(axis, ang) { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; }
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qConj = q => [-q[0], -q[1], -q[2], q[3]];
function qRot(q, v) {
  const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

// Closest point on segment ab to point p.
function closestOnSeg(a, b, p) {
  const ab = vSub(b, a);
  const t = clamp(vDot(vSub(p, a), ab) / (vDot(ab, ab) || 1e-9), 0, 1);
  return vAddS(a, ab, t);
}
// Closest distance between a ray (o, unit d, length L) and segment ab; returns {dist, t}.
function raySegDist(o, d, L, a, b) {
  const u = d, v = vSub(b, a), w = vSub(o, a);
  const A = 1, B = vDot(u, v), C = vDot(v, v), D = vDot(u, w), E = vDot(v, w);
  const den = A * C - B * B;
  let sc, tc;
  if (den < 1e-8) { sc = 0; tc = C > 0 ? E / C : 0; }
  else { sc = (B * E - C * D) / den; tc = (A * E - B * D) / den; }
  sc = clamp(sc, 0, L); tc = clamp(tc, 0, 1);
  // re-project once for stability after clamping
  sc = clamp(vDot(vSub(vAddS(a, v, tc), o), u), 0, L);
  const p = vAddS(o, u, sc), q = vAddS(a, v, tc);
  return { dist: vLen(vSub(p, q)), t: sc, point: q };
}

// ---- 01_phys.js ----
// =====================================================================
// Structural physics. Controlled, deterministic, fixed-step.
//
// Bodies are oriented boxes (or spheres) with a structural role:
//   static  — never moves
//   hinge   — rotates about a pivot axis under real torque (its own weight,
//             loads resting on it, the traveller standing on it). Held still
//             while any of its `holds` (connections or supporting bodies) live.
//   suspend — hung from two cables; lose one and it swings from the other,
//             lose both and it falls.
//   free    — a falling load: lands, rests, rides whatever it rests on.
//   pend    — a weight on a rod: driven swing, latched, or free.
//   ball    — a released weight in flight or rolling.
//   kin     — scripted motion (lifts, floats on water, presses).
// Connections (cables, chains, pins, braces, latches) are the things the
// player severs. Bodies marked `erase` belong to the preservation layer:
// the traveller can unmake them outright (a wall, a section of floor, a
// prop), and everything they were holding responds.
// =====================================================================

const G = 28;
const PLAYER_MASS = 1.0;

let _uid = 1;

class Phys {
  constructor() {
    this.bodies = [];
    this.conns = [];
    this.waters = [];
    this.byId = new Map();
    this.events = [];
    this.t = 0;
    this.tagSeq = 0;
    this.loads = [];        // external loads this step: { body, point, mass }
  }

  // ---------------- construction ----------------
  addBody(o) {
    o.id = _uid++;
    o.alive = true;
    o.isBody = true;
    o.size = o.size || [0.5, 0.5, 0.5];
    o.rot = o.rot || QI();
    o.pos = o.pos.slice();
    o.prevPos = o.pos.slice();
    o.prevRot = o.rot.slice();
    o.solid = o.solid !== false;
    o.walk = o.walk !== false;
    if (o.type === 'hinge') this.initHinge(o);
    if (o.type === 'pend') this.updatePend(o, 0);
    this.updateAxes(o);
    this.bodies.push(o);
    this.byId.set(o.id, o);
    return o;
  }
  initHinge(o) {
    o.ang = o.ang || 0; o.angVel = o.angVel || 0;
    if (o.min === undefined) o.min = -1e9;
    if (o.max === undefined) o.max = 1e9;
    o.q0 = o.q0 || o.rot.slice();
    o.c0 = o.c0 || vSub(o.pos, o.pivot);
    o.mass = o.mass || 4;
    o.damping = o.damping === undefined ? 1.2 : o.damping;
    o.lastRest = o.ang;
    this.hingeTransform(o);
  }
  addConn(o) {
    o.id = _uid++;
    o.alive = true;
    o.isConn = true;
    o.role = o.role || 'sever';
    this.conns.push(o);
    this.byId.set(o.id, o);
    return o;
  }
  addWater(o) { o.id = _uid++; o.isWater = true; this.waters.push(o); this.byId.set(o.id, o); return o; }
  get(id) { return this.byId.get(id); }
  live(id) { const o = this.byId.get(id); return !!(o && o.alive); }

  // ---------------- geometry ----------------
  updateAxes(b) {
    b.ax = [qRot(b.rot, [1, 0, 0]), qRot(b.rot, [0, 1, 0]), qRot(b.rot, [0, 0, 1])];
    const h = b.size;
    const ex = Math.abs(b.ax[0][0]) * h[0] + Math.abs(b.ax[1][0]) * h[1] + Math.abs(b.ax[2][0]) * h[2];
    const ey = Math.abs(b.ax[0][1]) * h[0] + Math.abs(b.ax[1][1]) * h[1] + Math.abs(b.ax[2][1]) * h[2];
    const ez = Math.abs(b.ax[0][2]) * h[0] + Math.abs(b.ax[1][2]) * h[1] + Math.abs(b.ax[2][2]) * h[2];
    b.aabb = [b.pos[0] - ex, b.pos[1] - ey, b.pos[2] - ez, b.pos[0] + ex, b.pos[1] + ey, b.pos[2] + ez];
  }
  toLocal(b, p) { const d = vSub(p, b.pos); return [vDot(d, b.ax[0]), vDot(d, b.ax[1]), vDot(d, b.ax[2])]; }
  toWorld(b, l) { return [b.pos[0] + b.ax[0][0] * l[0] + b.ax[1][0] * l[1] + b.ax[2][0] * l[2], b.pos[1] + b.ax[0][1] * l[0] + b.ax[1][1] * l[1] + b.ax[2][1] * l[2], b.pos[2] + b.ax[0][2] * l[0] + b.ax[1][2] * l[1] + b.ax[2][2] * l[2]]; }
  closestPoint(b, p) {
    if (b.shape === 'sphere') { const d = vSub(p, b.pos); const l = vLen(d) || 1; return vAddS(b.pos, d, Math.min(1, b.r / l)); }
    const l = this.toLocal(b, p);
    return this.toWorld(b, [clamp(l[0], -b.size[0], b.size[0]), clamp(l[1], -b.size[1], b.size[1]), clamp(l[2], -b.size[2], b.size[2])]);
  }
  // ray vs body: returns distance or Infinity
  rayBody(b, o, d, maxT) {
    if (b.shape === 'sphere') {
      const m = vSub(o, b.pos), bb = vDot(m, d), c = vDot(m, m) - b.r * b.r;
      if (c > 0 && bb > 0) return Infinity;
      const disc = bb * bb - c;
      if (disc < 0) return Infinity;
      const t = Math.max(0, -bb - Math.sqrt(disc));
      return t <= maxT ? t : Infinity;
    }
    const lo = this.toLocal(b, o);
    const ld = [vDot(d, b.ax[0]), vDot(d, b.ax[1]), vDot(d, b.ax[2])];
    let t0 = 0, t1 = maxT;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < -b.size[i] || lo[i] > b.size[i]) return Infinity; continue; }
      let ta = (-b.size[i] - lo[i]) / ld[i], tb = (b.size[i] - lo[i]) / ld[i];
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
    return t0;
  }
  // Highest walkable surface under (x, z) at or below yMax.
  groundAt(x, z, yMax, exclude) {
    let best = -Infinity, bb = null;
    const o = [x, yMax, z], d = [0, -1, 0];
    for (const b of this.bodies) {
      if (!b.alive || !b.solid || b === exclude) continue;
      const a = b.aabb;
      if (x < a[0] || x > a[3] || z < a[2] || z > a[5] || a[1] > yMax) continue;
      const t = this.rayBody(b, o, d, 60);
      if (t < Infinity && yMax - t > best) { best = yMax - t; bb = b; }
    }
    return { y: best, body: bb };
  }
  near(aabb, pad) {
    const out = [];
    for (const b of this.bodies) {
      if (!b.alive || !b.solid) continue;
      const a = b.aabb;
      if (a[3] < aabb[0] - pad || a[0] > aabb[3] + pad || a[4] < aabb[1] - pad || a[1] > aabb[4] + pad || a[5] < aabb[2] - pad || a[2] > aabb[5] + pad) continue;
      out.push(b);
    }
    return out;
  }
  // Point velocity of a moving body at world point p (from its last step).
  pointVel(b, p, dt) {
    const lp = this.localFrom(b.prevPos, b.prevRot, p, b);
    const now = this.toWorld(b, lp);
    return vScale(vSub(now, p), 1 / dt);
  }
  // express world p (assumed attached to body at its previous transform) in body-local coords
  localFrom(pos, rot, p) { return qRot(qConj(rot), vSub(p, pos)); }
  carry(b, p) {
    // where does a point that was riding body b (last step) end up now?
    const lp = qRot(qConj(b.prevRot), vSub(p, b.prevPos));
    return vAdd(b.pos, qRot(b.rot, lp));
  }

  // ---------------- interventions ----------------
  newTag(src) { return { id: ++this.tagSeq, count: 0, awarded: false, src, kinds: [] }; }
  emit(ev) {
    ev.t = this.t;
    this.events.push(ev);
    const USEFUL = { tilt: 1, break: 1, release: 1, land: 1, flood: 1, lift: 1, strike: 1 };
    if (ev.tag && USEFUL[ev.type] && !ev.tag.closed) {
      ev.tag.count++;
      ev.tag.kinds.push(ev.type);
      if (ev.tag.count >= 3 && !ev.tag.awarded) {
        ev.tag.awarded = true;
        this.events.push({ type: 'chain', tag: ev.tag, pos: ev.pos, t: this.t });
      }
    }
  }
  sever(c, how) {
    if (!c || !c.alive) return null;
    const tag = this.newTag({ conn: c.id, how: how || 'sever' });
    c.alive = false;
    this.emit({ type: 'sever', conn: c, pos: this.connMid(c), role: c.role, style: c.style });
    this.afterRemoval(c.id, tag);
    if (c.onCut) c.onCut(this, tag);
    return tag;
  }
  // Unmake an eligible body (and the rest of its erase group). Collision is
  // gone at once; the view handles the visible dissolve.
  eraseGroup(b) {
    if (!b.eraseGroup) return [b];
    return this.bodies.filter(o => o.alive && o.eraseGroup === b.eraseGroup);
  }
  erase(b, point) {
    if (!b || !b.alive || !b.erase) return null;
    const tag = this.newTag({ body: b.id, how: 'erase' });
    const group = this.eraseGroup(b);
    this.emit({ type: 'erase', bodies: group, pos: point || b.pos.slice(), origin: point || b.pos.slice() });
    for (const o of group) this.removeBody(o, tag, 'erased');
    return tag;
  }
  // which bodies will move if this target goes (for the targeting preview)
  dependents(o) {
    const ids = o.isConn ? [o.id] : this.eraseGroup(o).map(b => b.id);
    const out = [];
    for (const b of this.bodies) {
      if (!b.alive || ids.includes(b.id)) continue;
      if (b.holds && b.holds.some(h => ids.includes(h)) && (b.holdsAny || !b.holds.some(h => !ids.includes(h) && this.live(h)))) out.push(b);
      else if (b.restOn && ids.includes(b.restOn)) out.push(b);
      else if (b.type === 'suspend' && (ids.includes(b.cableA) || ids.includes(b.cableB))) out.push(b);
      else if (b.type === 'pend' && ids.includes(b.rod)) out.push(b);
    }
    return out;
  }
  // where a dependent will come to rest once the target is gone (for the preview):
  // fallers drop straight down onto what remains; locking hinges swing to their stop
  predictRest(b, goneIds) {
    if (b.type === 'hinge' && b.lockAt && b.lockAt !== 'any') {
      const ang = b.lockAt === 'max' ? b.max : b.min;
      const qa = qAxis(b.axis, ang);
      return { pos: vAdd(b.pivot, qRot(qa, b.c0)), rot: qMul(qa, b.q0) };
    }
    if (b.fallable || b.type === 'free' || b.type === 'rest' || b.type === 'suspend') {
      const hy = Math.abs(b.ax[0][1]) * b.size[0] + Math.abs(b.ax[1][1]) * b.size[1] + Math.abs(b.ax[2][1]) * b.size[2];
      let best = -Infinity;
      for (const [sx, sz] of [[0, 0], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]]) {
        const p = vAdd(b.pos, vAdd(vScale(b.ax[0], sx * b.size[0]), vScale(b.ax[2], sz * b.size[2])));
        const o = [p[0], b.pos[1] - hy - 0.05, p[2]];
        for (const q of this.bodies) {
          if (!q.alive || !q.solid || q === b || goneIds.includes(q.id)) continue;
          const a = q.aabb; if (o[0] < a[0] || o[0] > a[3] || o[2] < a[2] || o[2] > a[5] || a[1] > o[1]) continue;
          const t = this.rayBody(q, o, [0, -1, 0], 60); if (t < Infinity) best = Math.max(best, o[1] - t);
        }
      }
      if (best > -Infinity && best > b.pos[1] - hy - 40) return { pos: [b.pos[0], best + hy, b.pos[2]], rot: b.rot.slice() };
    }
    return null;
  }
  // dismantling advances in stages; the last stage removes the body
  dismantle(b, amount, tag) {
    if (!b || !b.alive || !b.hp) return null;
    b.dmg = (b.dmg || 0) + amount;
    const stage = Math.min(b.hp, Math.floor(b.dmg + 1e-6));
    if (stage > (b.stage || 0)) {
      b.stage = stage;
      this.emit({ type: stage >= b.hp ? 'crumble' : 'crack', body: b, pos: b.pos.slice(), stage, of: b.hp });
    }
    if (b.dmg >= b.hp) {
      const tg = tag || this.newTag({ body: b.id, how: 'dismantle' });
      this.removeBody(b, tg, 'dismantled');
      return tg;
    }
    return null;
  }
  removeBody(b, tag, why) {
    if (!b.alive) return;
    b.alive = false;
    this.emit({ type: 'break', body: b, tag: why === 'dismantled' || why === 'erased' ? null : tag, pos: b.pos.slice(), why, style: b.style });
    if (b.onBreak) b.onBreak(this, tag);
    this.afterRemoval(b.id, tag);
  }
  afterRemoval(id, tag) {
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.holds && b.holds.includes(id) && (b.holdsAny || !b.holds.some(h => this.live(h)))) { if (!b.released) this.release(b, tag); }
      if (b.type === 'suspend' && (b.cableA === id || b.cableB === id)) this.suspendCut(b, id, tag);
      if (b.restOn === id) { b.restOn = null; b.type = b.shape === 'sphere' ? 'ball' : 'free'; b.vel = [0, 0, 0]; b.tag = b.tag || tag; }
      if (b.type === 'pend' && b.rod === id) this.pendRelease(b, tag);
    }
  }
  release(b, tag) {
    b.tag = tag;
    if (b.holdsAny) b.released = true;
    if (b.type === 'hinge') { b.held = false; this.emit({ type: 'release', body: b, tag, pos: b.pivot.slice() }); }
    else if (b.type === 'static' && b.fallable) { b.type = 'free'; b.vel = [0, 0, 0]; this.emit({ type: 'release', body: b, tag, pos: b.pos.slice() }); }
    else if (b.type === 'pend' && b.mode === 'latched') { b.mode = 'free'; this.emit({ type: 'release', body: b, tag, pos: b.pos.slice() }); }
    else if (b.type === 'kin' && b.onRelease) { b.onRelease(this, tag); this.emit({ type: 'release', body: b, tag, pos: b.pos.slice() }); }
  }
  suspendCut(b, cutId, tag) {
    const other = cutId === b.cableA ? b.cableB : b.cableA;
    const otherLocal = cutId === b.cableA ? b.attachB : b.attachA;
    const cutLocal = cutId === b.cableA ? b.attachA : b.attachB;
    b.tag = tag;
    if (this.live(other)) {
      const pivot = this.toWorld(b, otherLocal);
      const cutW = this.toWorld(b, cutLocal);
      const along = vNorm([cutW[0] - pivot[0], 0, cutW[2] - pivot[2]]);
      const axis = vNorm(vCross([0, 1, 0], along));
      b.type = 'hinge';
      b.pivot = pivot; b.axis = axis; b.q0 = b.rot.slice(); b.c0 = vSub(b.pos, pivot);
      b.ang = 0; b.angVel = 0; b.min = b.swingMin === undefined ? -1.75 : b.swingMin; b.max = b.swingMax === undefined ? 1.75 : b.swingMax;
      b.damping = 0.9; b.held = false; b.holds = [other];
      b.hangingFrom = other;
      b.lastRest = 0;
      this.emit({ type: 'release', body: b, tag, pos: cutW });
    } else {
      b.type = 'free'; b.vel = [0, 0, 0];
      this.emit({ type: 'release', body: b, tag, pos: b.pos.slice() });
    }
  }
  pendRelease(b, tag) {
    // the rod is gone: the weight flies on along its swing
    const tan = this.pendTangent(b);
    const sp = b.phiVel * b.L;
    b.type = 'ball'; b.shape = 'sphere';
    b.vel = vScale(tan, sp);
    b.tag = tag;
    this.emit({ type: 'release', body: b, tag, pos: b.pos.slice() });
  }

  connEnds(c) {
    const end = e => e.body ? this.toWorld(this.get(e.body), e.local) : e.world;
    return [end(c.a), end(c.b)];
  }
  connMid(c) { const [a, b] = this.connEnds(c); return vLerp(a, b, 0.5); }

  // ---------------- stepping ----------------
  step(dt) {
    this.t += dt;
    for (const b of this.bodies) { b.prevPos = b.pos.slice(); b.prevRot = b.rot.slice(); }
    for (const w of this.waters) {
      if (w.level !== w.target) {
        const d = w.target - w.level;
        w.level += Math.sign(d) * Math.min(Math.abs(d), w.rate * dt);
        if (Math.abs(w.target - w.level) < 1e-3 && !w.done) { w.done = true; this.emit({ type: 'flood', tag: w.tag, pos: w.center.slice(), water: w }); }
      }
    }
    for (const b of this.bodies) {
      if (!b.alive) continue;
      switch (b.type) {
        case 'hinge': this.stepHinge(b, dt); break;
        case 'free': this.stepFree(b, dt); break;
        case 'ball': this.stepBall(b, dt); break;
        case 'pend': this.updatePend(b, dt); break;
        case 'kin': if (b.motion) b.motion(this, b, dt); break;
        case 'rest': this.stepRest(b); break;
      }
      if (b.type !== 'static') this.updateAxes(b);
    }
    // autonomous strain: frayed connections give way on their own after a visible warning
    for (const c of this.conns) {
      if (!c.alive || !c.fray) continue;
      if (!c.fray.started && c.fray.trigger(this)) { c.fray.started = this.t; this.emit({ type: 'strain', conn: c, pos: this.connMid(c) }); }
      if (c.fray.started && this.t - c.fray.started > c.fray.warn) { c.alive = false; this.emit({ type: 'snap', conn: c, pos: this.connMid(c) }); this.afterRemoval(c.id, null); }
    }
    this.loads.length = 0;
  }

  hingeTransform(b) {
    const qa = qAxis(b.axis, b.ang);
    b.rot = qMul(qa, b.q0);
    b.pos = vAdd(b.pivot, qRot(qa, b.c0));
  }
  stepHinge(b, dt) {
    if (b.holds && b.holds.length && b.holds.some(h => this.live(h))) b.held = true;
    else if (b.holds) b.held = false;
    if (b.lockedAt !== undefined) return;
    // torques about the pivot axis
    const qa = qAxis(b.axis, b.ang);
    const com = qRot(qa, b.comOff ? vAdd(b.c0, b.comOff) : b.c0);
    let tq = vDot(b.axis, vCross(com, [0, -b.mass * G, 0]));
    let I = b.mass * (vDot(b.c0, b.c0) + (b.size[0] * b.size[0] + b.size[1] * b.size[1] + b.size[2] * b.size[2]) / 3) + 0.05;
    for (const L of this.loads) {
      if (L.body !== b) continue;
      const r = vSub(L.point, b.pivot);
      tq += vDot(b.axis, vCross(r, [0, -L.mass * G, 0]));
      I += L.mass * vDot(r, r);
    }
    for (const o of this.bodies) {
      if (!o.alive || o.type !== 'rest' || o.restOn !== b.id) continue;
      const r = vSub(o.pos, b.pivot);
      tq += vDot(b.axis, vCross(r, [0, -(o.mass || 4) * G, 0]));
      I += (o.mass || 4) * vDot(r, r);
    }
    if (b.spring) tq += -b.spring.k * (b.ang - b.spring.rest);
    if (b.held) {
      // held structures only flex a little under load (bridges sway, terraces creak)
      if (!b.flex) return;
      const target = b.flexRest + clamp(tq / b.flex, -b.flexMax, b.flexMax);
      b.ang = damp(b.ang, target, 6, dt);
      this.hingeTransform(b);
      return;
    }
    const prev = b.ang;
    b.angVel += (tq / I) * dt;
    b.angVel *= Math.exp(-b.damping * dt);
    b.ang += b.angVel * dt;
    let hit = 0;
    if (b.ang < b.min) { b.ang = b.min; hit = -1; }
    if (b.ang > b.max) { b.ang = b.max; hit = 1; }
    if (hit) {
      const v = b.angVel;
      if (Math.abs(v) > 1.2) this.emit({ type: 'impact', body: b, pos: this.toWorld(b, [0, 0, 0]), power: Math.abs(v) * 4 });
      b.angVel = -v * 0.25;
      if (Math.abs(b.angVel) < 0.3) b.angVel = 0;
      if ((b.lockAt === 'min' && hit < 0) || (b.lockAt === 'max' && hit > 0) || b.lockAt === 'any') {
        b.lockedAt = b.ang; b.angVel = 0;
      }
    }
    this.hingeTransform(b);
    const moving = Math.abs(b.angVel) > 0.05 || Math.abs(b.ang - prev) > 1e-4;
    if (moving) {
      b.moving = true;
      // a swinging structure breaks fragile things in its path
      if (Math.abs(b.angVel) > 1.0) {
        for (const o of this.bodies) {
          if (!o.alive || o === b || !o.fragile) continue;
          if (this.overlapOBB(b, o)) { this.removeBody(o, b.tag, 'struck'); this.emit({ type: 'strike', body: o, tag: b.tag, pos: o.pos.slice() }); }
        }
      }
    } else if (b.moving) {
      b.moving = false;
      if (Math.abs(b.ang - b.lastRest) > 0.2) this.emit({ type: 'tilt', body: b, tag: b.tag, pos: b.pos.slice() });
      b.lastRest = b.ang;
    }
    if (b.lockedAt !== undefined && Math.abs(b.ang - b.lastRest) > 0.2) { this.emit({ type: 'tilt', body: b, tag: b.tag, pos: b.pos.slice() }); b.lastRest = b.ang; b.moving = false; }
  }

  pendTangent(b) {
    const qa = qAxis(b.axis, b.phi);
    return vNorm(qRot(qa, vCross(b.axis, [0, -1, 0])));
  }
  updatePend(b, dt) {
    if (b.mode === 'driven') {
      b.phi = b.amp * Math.sin(b.omega * this.t + b.phase);
      b.phiVel = b.amp * b.omega * Math.cos(b.omega * this.t + b.phase);
    } else if (b.mode === 'free') {
      b.phiVel += -(G / b.L) * Math.sin(b.phi) * dt;
      b.phiVel *= Math.exp(-0.15 * dt);
      b.phi += b.phiVel * dt;
    }
    const qa = qAxis(b.axis, b.phi);
    b.pos = vAdd(b.pivot, qRot(qa, [0, -b.L, 0]));
    b.rot = qa;
    if (dt > 0 && b.mode === 'free' && Math.abs(b.phiVel * b.L) > 3) {
      for (const o of this.bodies) {
        if (!o.alive || o === b) continue;
        if (!(o.fragile || o.hp || (o.type === 'hinge' && !o.held && o.strikeable))) continue;
        const cp = this.closestPoint(o, b.pos);
        if (vLen(vSub(cp, b.pos)) > b.r) continue;
        if (o.type === 'hinge') {
          o.angVel += (o.strikeSign || 1) * Math.abs(b.phiVel) * (o.strikeGain || 1);
          o.tag = b.tag; o.moving = true;
          b.phiVel *= -0.3;
          this.emit({ type: 'strike', body: o, tag: b.tag, pos: cp, power: 8 });
        } else {
          this.removeBody(o, b.tag, 'struck');
          this.emit({ type: 'strike', body: o, tag: b.tag, pos: cp, power: 10 });
          b.phiVel *= 0.6;
        }
        break;
      }
    }
  }

  overlapOBB(a, b) {
    if (a.aabb[3] < b.aabb[0] || a.aabb[0] > b.aabb[3] || a.aabb[4] < b.aabb[1] || a.aabb[1] > b.aabb[4] || a.aabb[5] < b.aabb[2] || a.aabb[2] > b.aabb[5]) return false;
    if (a.shape === 'sphere' || b.shape === 'sphere') {
      const s = a.shape === 'sphere' ? a : b, o = s === a ? b : a;
      return vLen(vSub(this.closestPoint(o, s.pos), s.pos)) < s.r;
    }
    const axes = [...a.ax, ...b.ax];
    for (const u of a.ax) for (const v of b.ax) { const c = vCross(u, v); if (vLen(c) > 1e-4) axes.push(vNorm(c)); }
    const d = vSub(b.pos, a.pos);
    for (const L of axes) {
      const ra = a.size[0] * Math.abs(vDot(a.ax[0], L)) + a.size[1] * Math.abs(vDot(a.ax[1], L)) + a.size[2] * Math.abs(vDot(a.ax[2], L));
      const rb = b.size[0] * Math.abs(vDot(b.ax[0], L)) + b.size[1] * Math.abs(vDot(b.ax[1], L)) + b.size[2] * Math.abs(vDot(b.ax[2], L));
      if (Math.abs(vDot(d, L)) > ra + rb) return false;
    }
    return true;
  }

  stepFree(b, dt) {
    b.vel = b.vel || [0, 0, 0];
    b.vel[1] = Math.max(-34, b.vel[1] - G * dt);
    const np = vAddS(b.pos, b.vel, dt);
    // landing: rays from the corners of the bottom face
    const hy = Math.abs(b.ax[0][1]) * b.size[0] + Math.abs(b.ax[1][1]) * b.size[1] + Math.abs(b.ax[2][1]) * b.size[2];
    let best = -Infinity, bb = null;
    for (const [sx, sz] of [[0, 0], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]]) {
      const p = vAdd(b.pos, vAdd(vScale(b.ax[0], sx * b.size[0]), vScale(b.ax[2], sz * b.size[2])));
      const g = this.groundAt(p[0], p[2], b.pos[1] - hy + 0.05, b);
      if (g.y > best) { best = g.y; bb = g.body; }
    }
    if (bb && np[1] - hy <= best) {
      const impact = -b.vel[1];
      if (bb.fragile && impact > 7) {
        this.removeBody(bb, b.tag, 'struck');
        this.emit({ type: 'strike', body: bb, tag: b.tag, pos: [b.pos[0], best, b.pos[2]], power: impact });
        b.vel[1] *= 0.6; b.pos = np;
        return;
      }
      b.pos = [np[0], best + hy, np[2]];
      b.vel = [0, 0, 0];
      b.type = 'rest'; b.restOn = bb.id;
      b.restLocal = qRot(qConj(bb.rot), vSub(b.pos, bb.pos));
      b.restRot = qMul(qConj(bb.rot), b.rot);
      if (bb.type === 'hinge') { bb.tag = b.tag || bb.tag; bb.moving = true; }
      this.emit({ type: 'land', body: b, on: bb, tag: b.tag, pos: b.pos.slice(), power: impact });
      if (bb.onLoad) bb.onLoad(this, b, b.tag);
      if (b.onLanded) b.onLanded(this, b.tag);
      return;
    }
    b.pos = np;
    if (b.pos[1] < -70) { b.alive = false; this.emit({ type: 'lost', body: b, pos: b.pos.slice() }); }
  }
  stepRest(b) {
    const s = this.get(b.restOn);
    if (!s || !s.alive) { b.type = b.shape === 'sphere' ? 'ball' : 'free'; b.vel = [0, 0, 0]; b.restOn = null; return; }
    b.pos = vAdd(s.pos, qRot(s.rot, b.restLocal));
    b.rot = qMul(s.rot, b.restRot);
  }
  stepBall(b, dt) {
    b.vel = b.vel || [0, 0, 0];
    b.vel[1] = Math.max(-34, b.vel[1] - G * dt);
    let np = vAddS(b.pos, b.vel, dt);
    for (const o of this.near([np[0] - b.r, np[1] - b.r, np[2] - b.r, np[0] + b.r, np[1] + b.r, np[2] + b.r], 0.2)) {
      if (o === b) continue;
      const cp = this.closestPoint(o, np);
      const d = vSub(np, cp), dl = vLen(d);
      if (dl >= b.r) continue;
      const n = dl > 1e-6 ? vScale(d, 1 / dl) : [0, 1, 0];
      const vn = vDot(b.vel, n);
      const spd = vLen(b.vel);
      if ((o.hp || o.fragile) && spd > 6) {
        this.removeBody(o, b.tag, 'struck');
        this.emit({ type: 'strike', body: o, tag: b.tag, pos: cp, power: spd });
        if (b.brittle) { b.alive = false; this.emit({ type: 'shatter', body: b, pos: b.pos.slice() }); return; }
        b.vel = vScale(b.vel, 0.6);
        continue;
      }
      np = vAddS(np, n, b.r - dl);
      if (vn < 0) b.vel = vSub(b.vel, vScale(n, vn * (n[1] > 0.6 ? 1.0 : 1.3)));
      if (n[1] > 0.6) { b.vel[0] *= Math.exp(-1.5 * dt); b.vel[2] *= Math.exp(-1.5 * dt); if (-vn > 5) this.emit({ type: 'impact', body: b, pos: cp, power: -vn }); }
      else if (spd > 4) this.emit({ type: 'impact', body: b, pos: cp, power: spd });
    }
    b.pos = np;
    b.spin = (b.spin || 0) + vLen([b.vel[0], 0, b.vel[2]]) * dt / b.r;
    if (b.pos[1] < -70) { b.alive = false; this.emit({ type: 'lost', body: b, pos: b.pos.slice() }); }
  }
}

// ---- 02_player.js ----
// =====================================================================
// The traveller: a capsule moving through the structural world.
// Guided traversal: the traveller keeps running toward the heading; the
// player sets the pace (sprint / brake), steers, and jumps.
// =====================================================================

const MOVE = {
  radius: 0.3, height: 1.5,
  cruise: 5.4, sprint: 7.6, brakeTo: 0.0, lateral: 5.0,
  accelGround: 26, accelAir: 9, decelGround: 30,
  gravity: 20, jumpVel: 8.1, jumpCut: 2.4, fallMul: 1.35,
  coyote: 0.12, buffer: 0.15, maxFall: 30,
  stepUp: 0.42, snap: 0.45, walkable: 0.6
};

class Player {
  constructor(phys) {
    this.phys = phys;
    this.reset([0, 0, 0]);
  }
  reset(p) {
    this.pos = p.slice();
    this.vel = [0, 0, 0];
    this.grounded = false; this.ground = null; this.groundN = [0, 1, 0];
    this.coyote = 0; this.buffer = 0; this.airTime = 0;
    this.lastSafe = p.slice(); this.safeT = 0; this.safeBody = null; this.safeHist = [];
    this.stagger = 0; this.alive = true; this.deathReason = '';
    this.landImpact = 0; this.justJumped = 0; this.justLanded = 0;
    this.events = [];
    this.fallStartY = p[1];
    this.pace = 0;
  }

  // input: { steer -1..1, pace -1..1, jumpPressed, jumpHeld }, heading: yaw (0 = -z)
  step(dt, input, heading) {
    if (!this.alive) return;
    const P = this.phys;
    const fwd = [-Math.sin(heading), 0, -Math.cos(heading)];
    const right = [Math.cos(heading), 0, -Math.sin(heading)];
    // 1. ride whatever we stand on
    if (this.grounded && this.ground && this.ground.alive && this.ground.type !== 'static') {
      const np = P.carry(this.ground, this.pos);
      this.pos = np;
    }
    // 2. intent
    this.pace = damp(this.pace, input.pace, 10, dt);
    let fs = MOVE.cruise;
    if (this.pace > 0) fs = lerp(MOVE.cruise, MOVE.sprint, this.pace);
    else fs = lerp(MOVE.cruise, MOVE.brakeTo, -this.pace);
    const ls = input.steer * MOVE.lateral * (this.stagger > 0 ? 0.3 : 1);
    if (this.stagger > 0) { this.stagger -= dt; fs *= 0.4; }
    const want = vAdd(vScale(fwd, fs), vScale(right, ls));
    const acc = this.grounded ? MOVE.accelGround : MOVE.accelAir;
    const cur = [this.vel[0], 0, this.vel[2]];
    const dv = vSub(want, cur);
    const dl = Math.hypot(dv[0], dv[2]);
    const lim = (this.grounded && vDot(want, cur) < vDot(cur, cur) ? MOVE.decelGround : acc) * dt;
    if (dl > lim) { this.vel[0] += dv[0] / dl * lim; this.vel[2] += dv[2] / dl * lim; }
    else { this.vel[0] = want[0]; this.vel[2] = want[2]; }
    // 3. jumping: buffered input, coyote time, variable height
    if (input.jumpPressed) this.buffer = MOVE.buffer;
    else this.buffer = Math.max(0, this.buffer - dt);
    if (this.grounded) this.coyote = MOVE.coyote; else this.coyote = Math.max(0, this.coyote - dt);
    this.justJumped = Math.max(0, this.justJumped - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.justJumped <= 0) {
      let inherit = [0, 0, 0];
      if (this.ground && this.ground.alive && this.ground.type !== 'static') inherit = P.pointVel(this.ground, this.pos, dt);
      this.vel[0] += inherit[0] * 0.8; this.vel[2] += inherit[2] * 0.8;
      this.vel[1] = MOVE.jumpVel + Math.max(0, inherit[1]) * 0.4;
      this.grounded = false; this.ground = null; this.coyote = 0; this.buffer = 0; this.justJumped = 0.12;
      this.fallStartY = this.pos[1];
      this.events.push({ type: 'jump' });
    }
    if (!this.grounded) {
      let g = MOVE.gravity;
      if (this.vel[1] < 0) g *= MOVE.fallMul;
      else if (!input.jumpHeld) g *= MOVE.jumpCut;
      this.vel[1] = Math.max(-MOVE.maxFall, this.vel[1] - g * dt);
      this.airTime += dt;
    } else {
      this.vel[1] = Math.min(this.vel[1], 0);
    }
    // 4. side-ledge protection: a sideways drift never carries you off an edge;
    //    only a committed run forward does
    if (this.grounded) {
      const lat = vDot([this.vel[0], 0, this.vel[2]], right);
      const probe = vAddS(this.pos, right, Math.sign(lat) * (MOVE.radius + 0.12) + lat * dt);
      const g = P.groundAt(probe[0], probe[2], this.pos[1] + MOVE.stepUp);
      if (Math.abs(lat) > 0.1 && (!isFinite(g.y) || g.y < this.pos[1] - 1.2)) {
        this.vel[0] -= right[0] * lat; this.vel[2] -= right[2] * lat;
      }
    }
    // 5. integrate and collide
    const wasGrounded = this.grounded;
    const vyBefore = this.vel[1];
    this.pos = vAddS(this.pos, this.vel, dt);
    this.collide(dt);
    // 6. ground snap keeps us glued to slopes and descending platforms
    if (!this.grounded && wasGrounded && this.vel[1] <= 0.5 && this.justJumped <= 0) {
      const g = P.groundAt(this.pos[0], this.pos[2], this.pos[1] + 0.2);
      if (g.body && this.pos[1] - g.y < MOVE.snap) { this.pos[1] = g.y; this.grounded = true; this.ground = g.body; this.vel[1] = 0; }
    }
    if (this.grounded && !wasGrounded) {
      const drop = this.fallStartY - this.pos[1];
      this.landImpact = -vyBefore;
      this.justLanded = 0.25;
      this.events.push({ type: 'land', power: -vyBefore, drop, body: this.ground });
      this.airTime = 0;
    }
    if (!this.grounded && wasGrounded && this.justJumped <= 0) this.fallStartY = this.pos[1];
    this.justLanded = Math.max(0, this.justLanded - dt);
    // 7. weight on structures
    if (this.grounded && this.ground && this.ground.type === 'hinge') P.loads.push({ body: this.ground, point: this.pos.slice(), mass: PLAYER_MASS });
    // 8. hazards
    this.hazards(dt);
    // 9. remember safe footing for recovery
    // (never on something that can itself be unmade, or that is still settling)
    if (this.grounded && this.ground && !this.ground.erase && !this.ground.fallable && (this.ground.type === 'static' || this.ground.lockedAt !== undefined || (this.ground.type === 'hinge' && this.ground.held))) {
      this.safeT += dt;
      if (this.safeT > 0.3) { this.lastSafe = this.pos.slice(); this.safeBody = this.ground; this.safeHist.push({ pos: this.pos.slice(), body: this.ground }); if (this.safeHist.length > 8) this.safeHist.shift(); this.safeT = 0.15; }
    } else this.safeT = 0;
  }

  collide(dt) {
    const P = this.phys, r = MOVE.radius;
    this.grounded = false;
    let groundBody = null, gn = null, gy = -Infinity;
    for (let it = 0; it < 3; it++) {
      const a = [this.pos[0], this.pos[1] + r, this.pos[2]];
      const b = [this.pos[0], this.pos[1] + MOVE.height - r, this.pos[2]];
      const box = [this.pos[0] - r, this.pos[1], this.pos[2] - r, this.pos[0] + r, this.pos[1] + MOVE.height, this.pos[2] + r];
      let moved = false;
      for (const o of P.near(box, 0.1)) {
        if (o.passable) continue;
        // closest points between capsule axis and the body (two refinements)
        let p = closestOnSeg(a, b, o.pos);
        let q = P.closestPoint(o, p);
        p = closestOnSeg(a, b, q);
        q = P.closestPoint(o, p);
        let d = vSub(p, q);
        let dl = vLen(d);
        if (dl >= r) continue;
        let n;
        if (dl < 1e-5) {
          // axis inside the box: push out along the shallowest local axis, preferring up
          const l = P.toLocal(o, p);
          let bestI = 1, bestPen = Infinity, sgn = 1;
          for (let i = 0; i < 3; i++) {
            const pen = o.size[i] - Math.abs(l[i]);
            const bias = i === 1 && l[1] > 0 ? 0.3 : 0;
            if (pen - bias < bestPen) { bestPen = pen - bias; bestI = i; sgn = l[i] >= 0 ? 1 : -1; }
          }
          n = vScale(o.ax[bestI], sgn);
          dl = -bestPen;
        } else n = vScale(d, 1 / dl);
        // small steps: treat low ledges as ground
        if (n[1] < MOVE.walkable && n[1] > -0.2) {
          const top = P.groundAt(this.pos[0] + n[0] * -0.35, this.pos[2] + n[2] * -0.35, this.pos[1] + MOVE.stepUp + 0.05);
          if (top.body === o && top.y - this.pos[1] <= MOVE.stepUp && top.y >= this.pos[1] - 0.05 && this.vel[1] <= 0.5) {
            this.pos[1] = top.y; moved = true; groundBody = o; gn = [0, 1, 0]; gy = top.y;
            continue;
          }
        }
        const push = r - dl;
        if (n[1] >= MOVE.walkable && this.vel[1] <= 1.0) {
          // walkable: resolve straight up so slopes don't bleed forward speed
          this.pos[1] += push / n[1] + 1e-4;
          if (this.vel[1] < 0) this.vel[1] = 0;
        } else {
          this.pos = vAddS(this.pos, n, push + 1e-4);
          const vn = vDot(this.vel, n);
          if (vn < 0) this.vel = vSub(this.vel, vScale(n, vn));
        }
        if (n[1] >= MOVE.walkable) { groundBody = o; gn = n; gy = this.pos[1]; }
        moved = true;
      }
      if (!moved) break;
    }
    if (groundBody && (this.vel[1] <= 1.0 || this.justJumped <= 0)) { this.grounded = true; this.ground = groundBody; this.groundN = gn; this.vel[1] = Math.min(0, this.vel[1]); }
    void gy;
  }

  hazards(dt) {
    const P = this.phys;
    const mid = [this.pos[0], this.pos[1] + 0.8, this.pos[2]];
    for (const o of P.bodies) {
      if (!o.alive) continue;
      if (o.type === 'pend' || o.type === 'ball') {
        const spd = o.type === 'pend' ? Math.abs(o.phiVel * o.L) : vLen(o.vel || [0, 0, 0]);
        if (spd < 2) continue;
        const a = [this.pos[0], this.pos[1] + 0.3, this.pos[2]], b = [this.pos[0], this.pos[1] + 1.2, this.pos[2]];
        const c = closestOnSeg(a, b, o.pos);
        const d = vSub(c, o.pos), dl = vLen(d);
        if (dl < o.r + 0.32 && this.stagger <= 0) {
          const v = o.type === 'pend' ? vScale(P.pendTangent(o), o.phiVel * o.L) : o.vel;
          const k = vNorm([v[0] + d[0] * 2, 0, v[2] + d[2] * 2]);
          this.vel = [k[0] * 9, 5.5, k[2] * 9];
          this.grounded = false; this.stagger = 0.45; this.fallStartY = this.pos[1];
          this.events.push({ type: 'knock', power: spd, by: o });
        }
      } else if (o.type === 'free' && o.vel && o.vel[1] < -4) {
        const cp = P.closestPoint(o, mid);
        if (vLen(vSub(cp, mid)) < 0.75 && cp[1] > this.pos[1] + 0.6) { this.die('crushed'); return; }
      } else if (o.crusher && o.type === 'kin' && o.vy < -1) {
        const cp = P.closestPoint(o, [this.pos[0], this.pos[1] + MOVE.height, this.pos[2]]);
        if (vLen(vSub(cp, [this.pos[0], this.pos[1] + MOVE.height, this.pos[2]])) < 0.25 && this.grounded) { this.die('crushed'); return; }
      }
    }
    void dt;
  }

  die(why) {
    if (!this.alive) return;
    this.alive = false;
    this.deathReason = why;
    this.events.push({ type: 'death', reason: why });
  }
}

// ---- 03_course.js ----
// =====================================================================
// Encounters: authored structures with explicit dependencies, composed
// into an endless route. Every encounter offers at least two approaches
// (usually: spend a charge to change the structure, or use movement skill).
// Validation settles each solution's physics, then checks that a route of
// walkable surfaces connects entry to exit within the traveller's jumps.
// =====================================================================

const JUMP = { cruise: 3.9, sprint: 5.4, up: 1.45 };   // conservative, from the movement model

class Builder {
  constructor(P, origin, seg, rng, d) {
    this.P = P; this.o = origin; this.seg = seg; this.rng = rng; this.d = d;
    this.keys = {}; this.decor = []; this.pickups = []; this.bodies = []; this.conns = [];
  }
  w(x, y, z) { return [this.o[0] + x, this.o[1] + y, this.o[2] + z]; }
  key(k, o) { if (k) { this.keys[k] = o; o.key = k; } return o; }
  body(o, k) {
    o.pos = this.w(o.pos[0], o.pos[1], o.pos[2]);
    if (o.pivot) o.pivot = this.w(o.pivot[0], o.pivot[1], o.pivot[2]);
    o.seg = this.seg;
    const b = this.P.addBody(o);
    this.bodies.push(b);
    return this.key(k, b);
  }
  // a walkable slab whose top is at y, running from local za down to zb (za > zb)
  deck(za, zb, opts) {
    opts = opts || {};
    const w = opts.w || 3.2, y = opts.y || 0, th = opts.th || 0.6, x = opts.x || 0;
    return this.body(Object.assign({ type: 'static', pos: [x, y - th / 2, (za + zb) / 2], size: [w / 2, th / 2, (za - zb) / 2], style: opts.style || 'deck' }, opts.extra || {}), opts.key);
  }
  conn(o, k) {
    const fix = e => e.body ? e : { world: this.w(e.world[0], e.world[1], e.world[2]) };
    o.a = fix(o.a); o.b = fix(o.b); o.seg = this.seg;
    const c = this.P.addConn(o);
    this.conns.push(c);
    return this.key(k, c);
  }
  dec(type, props) {
    const p = Object.assign({ type }, props);
    if (p.at) p.at = this.w(p.at[0], p.at[1], p.at[2]);
    if (p.to) p.to = this.w(p.to[0], p.to[1], p.to[2]);
    this.decor.push(p);
    return p;
  }
  pick(kind, x, y, z, opts) {
    const p = Object.assign({ kind, pos: this.w(x, y, z), alive: true, seg: this.seg }, opts || {});
    this.pickups.push(p);
    return p;
  }
  // jumpable steps from y0 up/down to y1, starting at local z going forward
  stairs(z, y0, y1, x, w, style) {
    const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 1.05));
    for (let i = 1; i <= n; i++) {
      const top = lerp(y0, y1, i / n);
      const bot = Math.min(y0, y1) - 0.6;
      this.body({ type: 'static', pos: [x || 0, (top + bot) / 2, z - (i - 0.5) * 1.3], size: [(w || 2.6) / 2, (top - bot) / 2, 0.65], style: style || 'terrace' });
    }
    return z - n * 1.3;
  }
  // a walkable ramp from (z, y0) forward to (z - len, y1)
  ramp(z, y0, y1, x, w, len, style) {
    const a = Math.atan2(y1 - y0, len), hl = Math.hypot(len, y1 - y0) / 2, th = 0.3;
    const rot = qAxis([1, 0, 0], a);
    const n = qRot(rot, [0, 1, 0]);
    const mid = [x || 0, (y0 + y1) / 2 - n[1] * th, z - len / 2 - n[2] * th];
    this.body({ type: 'static', pos: mid, rot, size: [(w || 2.6) / 2, th, hl], style: style || 'ramp' });
    return z - len;
  }
  salvage(z0, z1, x, y, n) { for (let i = 0; i < n; i++) this.pick('salvage', x, y + 0.9, lerp(z0, z1, n === 1 ? 0.5 : i / (n - 1))); }
}

const sol = (name, acts, o) => Object.assign({ name, acts: acts || [] }, o || {});

const FAMILIES = {
  // ------------------------------------------------------------------
  // Old terraces of the first settlement: movement for its own sake.
  approach: {
    tier: 0, rest: true,
    build(b, rng, d) {
      let z = 0, y = 0, x = 0;
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const len = rng.range(4, 7);
        const w = rng.chance(0.25 + d * 0.3) && i > 0 ? 0.7 : rng.range(2.6, 3.6);
        b.deck(z, z - len, { x, y, w, style: w < 1 ? 'beam' : 'terrace' });
        if (i === 1 && rng.chance(0.5)) b.salvage(z - 1, z - len + 1, x, y, 3);
        z -= len;
        if (i < n - 1) {
          const hy = b.o[1] + y;
          const dy = rng.chance(0.5) ? rng.pick(hy > 3 ? [-0.35, -0.9, -0.9] : hy < -3 ? [0.3, 0.8, 0.8] : [-0.35, 0.3, -0.9, 0.8]) : 0;
          const gap = rng.chance(0.7) ? rng.range(1.4, (dy > 0.4 ? 2.3 : 2.6) + d * 0.7) : 0;
          const dx = rng.chance(0.4) ? rng.pick([-1.1, 1.1]) : 0;
          if (gap === 0 && dy > 0.4) { z -= 0.5; }
          z -= gap; y += dy; x = clamp(x + dx, -1.6, 1.6);
        }
      }
      // an optional relic on a side ledge reached by a deliberate jump
      if (rng.chance(0.35)) {
        const lz = -rng.range(4, -z - 4);
        b.deck(lz + 1.2, lz - 1.2, { x: x + 4.6, y: y + 0.9, w: 1.8, style: 'terrace' });
        b.pick('relic', x + 4.6, y + 1.9, lz);
      }
      b.deck(z, z - 3, { x: 0, y, w: 3.2, style: 'terrace' });
      z -= 3;
      b.dec('dwellings', { at: [0, y, z / 2], len: -z });
      return { len: -z, exit: [0, y], need: 0, solutions: [sol('run', [])] };
    }
  },

  // ------------------------------------------------------------------
  // The threshold: the preservers sealed this crossing. A glazed wall blocks
  // the high road; the floor before it is glazed infill over the old street.
  // Unmake the wall and keep the height (then: unmake the props and let the
  // lintel down as a bridge, or sprint and leap the gap). Or unmake the floor
  // and drop to the old street, where something was sealed away. A missed
  // leap lands in the old street too: a fall costs time, not the run.
  threshold: {
    tier: 0,
    build(b, rng, d) {
      const la = rng.range(6, 7.5);                 // entry
      const lf = rng.range(3.4, 3.9);               // glazed infill
      const lb = rng.range(5.8, 6.6);               // high road
      const gap = rng.range(4.4, 4.7) + d * 0.2;
      const zF = -la, zB = zF - lf, zG = zB - lb, zC = zG - gap;
      const ly = -3.8;
      b.deck(0, zF, { w: 3.2, style: 'terrace' });
      const floor = b.deck(zF, zB, { w: 3.2, style: 'preserved', key: 'floor', extra: { erase: true } });
      void floor;
      b.deck(zB, zG, { w: 3.2, style: 'span' });
      b.body({ type: 'static', pos: [0, 1.45, zB - 0.6], size: [1.7, 1.45, 0.35], style: 'preserved', erase: true }, 'wall');
      // the lintel, held high over the gap by a preservation scaffold
      const lz = (zG + zC) / 2, lh = gap / 2 + 1.3, top = 4.15;
      const lintel = b.body({ type: 'static', fallable: true, pos: [0, top + 0.2, lz], size: [1.5, 0.2, lh], mass: 5, style: 'lintel', holdsAny: true }, 'lintel');
      const props = [];
      for (const z of [zG + 0.4, zC - 0.4]) for (const x of [-1.3, 1.3]) props.push(b.body({ type: 'static', pos: [x, top / 2, z], size: [0.18, top / 2, 0.18], style: 'preserved', erase: true, eraseGroup: 'props' + b.seg }, null));
      b.key('props', props[0]);
      lintel.holds = props.map(p => p.id);
      // the old street below: a landing under the infill, a channel, a stair back up
      b.deck(zF - 0.2, zG - 4, { y: ly, w: 3.0, style: 'channel', extra: { low: true } });
      const zc0 = zG - 2.4, zc1 = zC - 4.5, cx = -2.9;
      b.deck(zc0, zc1, { y: ly, x: cx, w: 2.6, style: 'channel', extra: { low: true } });
      const zs = b.ramp(zc1 + 0.1, ly, 0, cx, 2.6, 8.4);
      b.deck(zC, zs, { w: 3.2, style: 'span' });
      const zEnd = zs - 5;
      b.deck(zs + 0.1, zEnd, { w: 7.0, x: -1.7, style: 'span' });
      b.pick('relic', 0, ly + 1.0, (zB + zG) / 2 - 0.5);
      b.salvage(zF - 1, zF - lf + 0.6, 0, ly, 2);
      b.salvage(zG + 1.5, zB - 2.2, 0, 0, 2);
      b.dec('dwellings', { at: [0, 0, -la / 2], len: la });
      return {
        len: -zEnd, exit: [0, 0], need: 1,
        solutions: [sol('wall, then lintel', ['wall', 'props']), sol('wall, then leap', ['wall'], { skill: true, sprint: true }), sol('floor', ['floor'], { relic: true })]
      };
    }
  },

  // ------------------------------------------------------------------
  // Shutters: a causeway the preservers closed off, wall after wall. Read
  // them at speed: the glazed ones can be unmade as you run; the old stone
  // one in the middle cannot, and the way past it is the side beam. The
  // last shutter stands at the lip of a gap, so unmake it early and keep
  // your run-up.
  shutters: {
    tier: 1,
    build(b, rng, d) {
      const side = rng.chance(0.5) ? 1 : -1;
      const z1 = -rng.range(7.5, 9), z2 = z1 - rng.range(6, 7), z3 = z2 - rng.range(6, 7);
      const zEnd = z3 - 1.6, gap = rng.range(2.8, 3.2) + d * 0.4;
      b.deck(0, -5, { w: 3.2, style: 'terrace' });
      b.deck(-5, zEnd, { w: 2.6, style: 'span' });
      b.body({ type: 'static', pos: [0, 1.4, z1], size: [1.35, 1.4, 0.3], style: 'preserved', erase: true }, 'w1');
      b.body({ type: 'static', pos: [0, 1.45, z2], size: [1.35, 1.45, 0.4], style: 'oldWall' }, 'stone');
      b.body({ type: 'static', pos: [0, 1.4, z3], size: [1.35, 1.4, 0.3], style: 'preserved', erase: true }, 'w3');
      // the way round the stone: a beam along the side, close enough to step onto
      b.deck(z2 + 2.6, z2 - 2.6, { x: side * 1.75, w: 0.9, style: 'beam' });
      b.salvage(z2 + 1.6, z2 - 1.6, side * 1.75, 0, 3);
      const zx = zEnd - gap;
      b.deck(zx, zx - 6, { w: 4.0, style: 'terrace' });
      b.dec('dwellings', { at: [0, 0, zx - 3], len: 6 });
      return { len: -(zx - 6), exit: [0, 0], need: 2, solutions: [sol('read the glaze', ['w1', 'w3'])] };
    }
  },

  // ------------------------------------------------------------------
  // A bridge leaf held up by a tension cable. Sever it and the bridge drops
  // into place — or take the restrained root along the side, if your feet
  // are good enough.
  drawbridge: {
    tier: 0,
    build(b, rng, d) {
      const gap = rng.range(6.6, 7.4);
      b.deck(0, -8, { w: 4.8, x: 0.8 });
      const z1 = -8 - gap;
      b.deck(z1, z1 - 7, { w: 4.8, x: 0.8 });
      const L = gap + 0.5;
      const raised = 1.32;
      const leaf = b.body({ type: 'hinge', pos: [0, -0.25, z1 + L / 2], size: [1.5, 0.25, L / 2], pivot: [0, 0, z1], axis: [1, 0, 0], ang: 0, min: 0, max: 0, mass: 5, style: 'leaf', comOff: [0, 0, 0] }, 'leaf');
      // raise it: rotate about the pivot so the leaf stands up toward the traveller
      leaf.ang = -raised; leaf.min = -raised; leaf.max = 0; leaf.lockAt = 'max'; leaf.damping = 0.6;
      P_hingeSet(b.P, leaf);
      const tip = b.P.toWorld(leaf, [0, 0.25, L / 2]);
      const anchor = [0, 0 + 7.6, z1 - 3.2];
      const cable = b.conn({ style: 'cable', role: 'sever', a: { body: leaf.id, local: [0, 0.25, L / 2 - 0.3] }, b: { world: anchor } }, 'cable');
      leaf.holds = [cable.id];
      b.dec('tensionTower', { at: [0, 0, z1 - 3.2], h: 7.6, toward: 1 });
      // the skill route: a restrained root running along the right side, broken in the middle
      const rx = 3.1;
      const half = gap / 2 - 1.1;
      b.body({ type: 'static', pos: [rx, -0.2, -8 - half / 2 + 0.6], size: [0.32, 0.25, half / 2 + 0.6], style: 'root' });
      b.body({ type: 'static', pos: [rx, -0.2 + 0.25, z1 + half / 2 - 0.6], size: [0.32, 0.25, half / 2 + 0.6], style: 'root' });
      b.pick('salvage', rx, 1.2, -8 - gap / 2);
      b.dec('rootClamp', { at: [rx, -0.2, -8 - 0.4] });
      b.dec('rootClamp', { at: [rx, 0.05, z1 + 0.4] });
      return {
        len: -(z1 - 7), exit: [0.8, 0], need: 1,
        solutions: [sol('sever', ['cable']), sol('root', [], { skill: true })]
      };
    }
  },

  // ------------------------------------------------------------------
  // A balance bridge pinned wrong by a hanging ballast. Cut the ballast and
  // it levels — or walk out over the pivot and let your own weight tip it.
  counterpoise: {
    tier: 1,
    build(b, rng, d) {
      const gap = rng.range(9.5, 10.5);
      b.deck(0, -6, {});
      const z1 = -6 - gap;
      b.deck(z1, z1 - 6, {});
      const pz = -6 - gap / 2;
      const half = gap / 2 + 0.3;
      b.body({ type: 'static', pos: [0, -9, pz], size: [0.7, 8.6, 0.7], style: 'pier' });
      const up = 0.3;
      const plank = b.body({ type: 'hinge', pos: [0, -0.2, pz], size: [1.5, 0.2, half], pivot: [0, 0, pz], axis: [1, 0, 0], ang: up, min: 0, max: up, mass: 2.4, comOff: [0, 0, -1.1], damping: 1.6, style: 'balance', lockAt: 'min' }, 'plank');
      P_hingeSet(b.P, plank);
      // ballast hangs from the near end on a chain
      const nearEnd = b.P.toWorld(plank, [0, -0.2, half - 0.6]);
      const ballast = b.P.addBody({ type: 'rest', pos: [nearEnd[0], nearEnd[1] - 2.2, nearEnd[2]], size: [0.7, 0.7, 0.7], mass: 1.45, style: 'counterweight', seg: b.seg, solid: true });
      ballast.restOn = plank.id; ballast.restLocal = qRot(qConj(plank.rot), vSub(ballast.pos, plank.pos)); ballast.restRot = qConj(plank.rot);
      b.bodies.push(ballast); b.key('ballast', ballast);
      const chain = b.conn({ style: 'chain', role: 'sever', a: { body: plank.id, local: [0, -0.2, half - 0.6] }, b: { body: ballast.id, local: [0, 0.7, 0] } }, 'chain');
      ballast.holds = [chain.id];
      chain.onCut = (P, tag) => { ballast.type = 'free'; ballast.vel = [0, 0, 0]; ballast.restOn = null; ballast.tag = tag; plank.tag = tag; plank.moving = true; P.emit({ type: 'release', body: ballast, tag, pos: ballast.pos.slice() }); };
      b.salvage(pz + 2, pz - 2, 0, 0.3, 3);
      b.dec('pivotFrame', { at: [0, 0, pz] });
      return { len: -(z1 - 6), exit: [0, 0], need: 1, solutions: [sol('cut ballast', ['chain']), sol('ride', [], { skill: true, dynamic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A cradle hung across a chasm from two cables. Jump across it as it
  // sways — or cut the near cable and it swings down into a ramp toward
  // an older lower route, where something has been waiting.
  cradle: {
    tier: 1,
    build(b, rng, d) {
      const g = rng.range(2.6, 3.2);
      b.deck(0, -6, { w: 6.6, x: -1.7 });
      const L = 5.2;
      const cz = -6 - g - L / 2;
      const cr = b.body({ type: 'suspend', pos: [0, -0.25, cz], size: [1.4, 0.25, L / 2], style: 'cradle', mass: 3, swingMin: -0.62, swingMax: 0.62 }, 'cradle');
      cr.attachA = [0, 0.25, L / 2 - 0.3]; cr.attachB = [0, 0.25, -L / 2 + 0.3];
      const cA = b.conn({ style: 'cable', role: 'sever', a: { body: cr.id, local: cr.attachA }, b: { world: [0, 8, cz + L / 2 - 0.3] } }, 'near');
      const cB = b.conn({ style: 'cable', role: 'sever', a: { body: cr.id, local: cr.attachB }, b: { world: [0, 8, cz - L / 2 + 0.3] } }, 'far');
      cr.cableA = cA.id; cr.cableB = cB.id;
      const z1 = cz - L / 2 - g;
      // the old lower route: a dry channel beside and below, climbing back up
      const ly = -4.2, lx = -2.9;
      b.deck(cz - L / 2 + 1.2, z1 - 2, { y: ly, x: lx, w: 2.4, style: 'channel' });
      const zs = b.stairs(z1 - 2, ly, 0, lx, 2.4);
      b.deck(z1, zs, { w: 3.2 });
      b.deck(zs, zs - 4, { w: 6.6, x: -1.7 });
      b.pick('relic', lx, ly + 1.1, cz - L / 2 - 2.2);
      b.salvage(z1 + 1, z1 - 2, lx, ly, 3);
      b.dec('gantry', { at: [0, 0, cz], h: 8, span: L - 0.6 });
      return { len: -(zs - 4), exit: [0, 0], need: 0, solutions: [sol('jump across', []), sol('swing down', ['far'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A great root held up out of the way by a restraint clamp. Pull the pin
  // and it drops across the gap as a bridge; its weight springs a sealed
  // casket on the far bank. Or sprint and leap the gap beneath it.
  root: {
    tier: 1, signature: true,
    build(b, rng, d) {
      const gap = rng.range(4.6, 4.9);
      b.deck(0, -7, { w: 4.4, x: -0.6 });
      const z1 = -7 - gap;
      b.deck(z1, z1 - 8, { w: 5.0, x: -0.9 });
      const L = gap + 2.0;
      const hy = 5.4;
      const root = b.body({ type: 'static', fallable: true, pos: [0, hy, -7 - gap / 2], size: [0.55, 0.3, L / 2], mass: 6, style: 'rootBridge' }, 'root');
      const pin = b.conn({ style: 'pin', role: 'redirect', a: { world: [0, hy + 2.6, -7 - gap / 2] }, b: { body: root.id, local: [0, 0.3, 0] } }, 'pin');
      root.holds = [pin.id];
      b.dec('restraintFrame', { at: [0, hy - 2.2, -7 - gap / 2], h: 4.9 });
      // the casket on the far bank, sealed until something heavy lands
      const cx = -2.6, czz = z1 - 3.2;
      const casket = b.body({ type: 'kin', pos: [cx, -1.5, czz], size: [0.6, 0.5, 0.6], style: 'casket', passable: true }, 'casket');
      casket.solid = false;
      casket.motion = (P, c, dt) => { if (c.rising) { c.pos[1] = Math.min(c.top, c.pos[1] + 3 * dt); if (c.pos[1] >= c.top && !c.done) { c.done = true; P.emit({ type: 'lift', body: c, tag: c.tag, pos: c.pos.slice() }); } } };
      casket.top = b.o[1] + 0.2;
      const relic = b.pick('relic', cx, -1.0, czz, { ride: casket.id, sealed: true });
      const lever = b.body({ type: 'static', pos: [-1.5, 0.15, z1 - 0.9], size: [0.12, 0.08, 0.9], style: 'lever', passable: true, walk: false }, 'lever');
      root.onLanded = (P, tag) => { if (casket.rising) return; casket.rising = true; casket.tag = tag; relic.sealed = false; P.emit({ type: 'strike', body: lever, tag, pos: lever.pos.slice() }); };
      b.dec('casketWell', { at: [cx, 0, czz] });
      return { len: -(z1 - 8), exit: [-0.9, 0], need: 1, solutions: [sol('release root', ['pin'], { chain: true }), sol('sprint jump', [], { skill: true, sprint: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A counterweight swinging across a narrow causeway. Time the crossing,
  // or cut its chain as it swings outward and send it through the old
  // repair wall beside the path.
  pendulum: {
    tier: 1,
    build(b, rng, d) {
      b.deck(0, -5, {});
      b.deck(-5, -15, { w: 1.8, style: 'causeway' });
      b.deck(-15, -21, {});
      const pz = -10;
      const L = 6.4;
      const amp = rng.range(0.85, 0.95);
      const bob = b.body({ type: 'pend', pos: [0, 0, pz], size: [0.75, 0.75, 0.75], shape: 'sphere', r: 0.75, pivot: [0, L + 0.9, pz], axis: [0, 0, 1], L, mode: 'driven', amp, omega: lerp(1.25, 1.55, d), phase: rng.range(0, TAU), phi: 0, phiVel: 0, style: 'weight', brittle: true, passable: true }, 'bob');
      const rod = b.conn({ style: 'chain', role: 'redirect', a: { world: [0, L + 0.9, pz] }, b: { body: bob.id, local: [0, 0.75, 0] } }, 'rod');
      bob.rod = rod.id;
      // the repair wall out to the side, with a sealed alcove behind it
      const side = 2.9;
      b.body({ type: 'static', pos: [side + 0.35, 0.8, pz], size: [0.35, 2.4, 2.0], style: 'repairWall', hp: 3, fragile: true }, 'wall');
      b.deck(pz + 2.2, pz - 2.2, { x: side + 2.3, y: 0, w: 3.6, style: 'terrace' });
      b.pick('relic', side + 2.6, 1.0, pz);
      b.deck(pz + 3.5, pz - 3.5, { x: 0, y: -5.2, w: 5, style: 'net' });
      b.body({ type: 'static', pos: [0, -2.6, pz - 4.6], size: [1.5, 2.6, 1.1], style: 'terrace' });
      b.dec('gantry', { at: [0, 0, pz], h: L + 0.9, span: 0.5, across: true });
      return { len: 21, exit: [0, 0], need: 0, solutions: [sol('time it', [], { timing: true }), sol('redirect', ['rod'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // Terraces held up by a frayed brace. Step on and they start to go: ride
  // them down to the lower route. Or break through the repair wall ahead
  // and keep the high road.
  collapse: {
    tier: 2,
    build(b, rng, d) {
      b.deck(0, -4, { w: 6.8, x: 1.8 });
      const n = 4, len = 3.0, drop = 1.2;
      const ts = [];
      for (let i = 0; i < n; i++) {
        const za = -4 - i * len, zb = za - len + 0.15;
        const t = b.body({ type: 'kin', pos: [0, -0.3, (za + zb) / 2], size: [1.6, 0.3, (za - zb) / 2], style: 'terraceSlab', crusher: false }, 't' + i);
        t.y0 = t.pos[1]; t.y1 = t.y0 - drop * (i + 1) - 0.6; t.delay = 0.35 * i;
        t.motion = (P, s, dt) => {
          const start = s.start;
          if (start === undefined) return;
          const k = clamp((P.t - start - s.delay) / 1.1, 0, 1);
          const prev = s.pos[1];
          s.pos[1] = lerp(s.y0, s.y1, k * k * (3 - 2 * k));
          s.vy = (s.pos[1] - prev) / Math.max(dt, 1e-4);
          if (k >= 1 && !s.settled) { s.settled = true; P.emit({ type: 'impact', body: s, pos: s.pos.slice(), power: 9 }); }
        };
        ts.push(t);
      }
      const brace = b.conn({ style: 'brace', role: 'sever', a: { world: [-2.4, -3.4, -4.3] }, b: { body: ts[0].id, local: [-1.4, -0.3, 1.0] } }, 'brace');
      const startAll = (P, tag) => { for (const t of ts) if (t.start === undefined) { t.start = P.t; t.tag = tag; } P.emit({ type: 'release', body: ts[0], tag, pos: ts[0].pos.slice() }); };
      brace.onCut = (P, tag) => startAll(P, tag);
      brace.fray = { warn: 0.7, trigger: P => P.player && P.player.pos[2] < b.o[2] - 4.6 && P.player.pos[1] > b.o[1] - 0.5 };
      brace.onSnap = startAll;
      const zEnd = -4 - n * len;
      // the lower route the terraces settle onto
      const ly = -drop * n - 0.6;
      b.deck(zEnd, zEnd - 6, { y: ly, style: 'channel' });
      b.salvage(zEnd - 1, zEnd - 5, 0, ly, 3);
      // the high road: blocked by generations of repairs
      b.deck(-4, zEnd - 9, { x: 3.8, y: 0, w: 2.0, style: 'terrace' });
      b.body({ type: 'static', pos: [3.8, 1.4, zEnd - 2.2], size: [1.0, 1.4, 0.35], style: 'preserved', erase: true }, 'wall');
      b.pick('relic', 3.8, 1.0, zEnd - 6);
      // the two roads rejoin
      const zs = b.stairs(zEnd - 6, ly, 0, 0, 2.6);
      b.deck(Math.min(zs, zEnd - 9), Math.min(zs, zEnd - 9) - 4, { y: 0, w: 6.8, x: 1.8 });
      if (zs > zEnd - 9) b.deck(zs, zEnd - 9, { y: 0, w: 2.6 });
      const rz = Math.min(zs, zEnd - 9) - 4;
      return { len: -rz, exit: [0, 0], need: 0, solutions: [sol('ride down', ['brace']), sol('high road', ['wall'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A drained lock basin. Dismantle the sluice gate and the water returns,
  // floating the old barge up to the walkway. Or cross on the staggered
  // posts the lock-keepers once used.
  sluice: {
    tier: 2,
    build(b, rng, d) {
      b.deck(0, -6, { w: 6.4, x: -1.2 });
      const len = 9.5;
      const z1 = -6 - len;
      b.deck(z1, z1 - 6, { w: 6.4, x: -1.2 });
      const floorY = -6;
      b.body({ type: 'static', pos: [-1.2, floorY - 0.5, -6 - len / 2], size: [3.4, 0.5, len / 2], style: 'basin' });
      const water = b.P.addWater({ x0: b.o[0] - 4.5, x1: b.o[0] + 2.1, z0: b.o[2] - 6, z1: b.o[2] + z1, level: b.o[1] + floorY, target: b.o[1] + floorY, rate: 2.2, center: b.w(-1.2, -1, -6 - len / 2), seg: b.seg });
      b.key('water', water);
      const barge = b.body({ type: 'kin', pos: [0, floorY + 0.35, -6 - len / 2], size: [1.3, 0.35, len / 2 - 0.25], style: 'barge' }, 'barge');
      barge.motion = (P, s) => { s.pos[1] = Math.max(b.o[1] + floorY + 0.35, water.level - 0.05); };
      // the gate sits low in a side channel, below the walkway: it can be reached by
      // intervention, never walked on
      const gate = b.body({ type: 'static', pos: [-4.6, -3.6, -6 - len / 2], size: [0.3, 1.6, 1.2], style: 'preserved', erase: true }, 'gate');
      gate.onBreak = (P, tag) => { water.target = b.o[1] - 0.45; water.tag = tag; water.done = false; P.emit({ type: 'release', body: gate, tag, pos: gate.pos.slice() }); };
      // the lock-keepers' posts
      const posts = [[-2.7, -3.6, 0.1], [-3.0, -8.35, 0.35]];
      for (const [x, z, y] of posts) b.body({ type: 'static', pos: [x, y - 3.5, -6 + z], size: [0.85, 3.5, 0.85], style: 'post' });
      b.pick('salvage', -3.0, 1.8, -6 - 8.35);
      // a lock-keeper's stair out of the basin: a fall costs time, not the run
      b.stairs(-6.8, floorY, 0, 1.75, 0.9, 'post');
      b.dec('reservoir', { at: [-6.5, 0, -6 - len / 2] });
      return { len: -(z1 - 6), exit: [-1.2, 0], need: 1, solutions: [sol('flood', ['gate']), sol('posts', [], { skill: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A counterweighted lift to the upper city. Unlatch the counterweight and
  // ride up — or climb the root knuckles.
  lift: {
    tier: 1,
    build(b, rng, d) {
      const H = 4.6;
      b.deck(0, -6, { w: 8.4, x: -0.5 });
      const lift = b.body({ type: 'kin', pos: [-2.2, -0.2, -7.6], size: [1.3, 0.2, 1.4], style: 'liftDeck' }, 'lift');
      lift.y0 = lift.pos[1]; lift.y1 = lift.y0 + H; lift.vy = 0;
      lift.motion = (P, s, dt) => {
        if (!s.go) return;
        const prev = s.pos[1];
        s.pos[1] = Math.min(s.y1, s.pos[1] + 2.9 * dt);
        s.vy = (s.pos[1] - prev) / dt;
        if (s.pos[1] >= s.y1 && !s.done) { s.done = true; P.emit({ type: 'lift', body: s, tag: s.tag, pos: s.pos.slice() }); }
      };
      lift.onRelease = (P, tag) => { lift.go = true; lift.tag = tag; };
      const latch = b.conn({ style: 'pin', role: 'sever', a: { world: [-3.9, 0.9, -7.6] }, b: { body: lift.id, local: [-1.2, 0.2, 0] } }, 'latch');
      lift.holds = [latch.id];
      b.dec('liftFrame', { at: [-2.2, 0, -7.6], h: H + 3 });
      // the knuckle climb on the right
      const steps = [[3.2, -7.8, 1.2], [3.5, -10.0, 2.4], [3.15, -12.3, 3.6]];
      for (const [x, z, y] of steps) b.body({ type: 'static', pos: [x, y - 0.6, z], size: [0.85, 0.6, 0.85], style: 'knuckle' });
      b.deck(-5.9, -9.2, { w: 1.7, x: 3.2, y: 0, style: 'terrace' });
      b.deck(-9.2, -24, { y: H, w: 6.6, x: -1.0, style: 'terrace' });
      b.pick('salvage', 3.5, 2.4 + 1, -10);
      return { len: 24, exit: [-1.0, H], need: 1, solutions: [sol('ride lift', ['latch'], { ride: 'lift' }), sol('climb', [], { skill: true })] };
    }
  }
};

// set hinge transform after manual angle edits during building
function P_hingeSet(P, b) { b.lastRest = b.ang; P.hingeTransform(b); P.updateAxes(b); }

// root settle hook: called when the root bridge locks into place
(function hookSettle() {
  const orig = Phys.prototype.stepHinge;
  Phys.prototype.stepHinge = function (b, dt) {
    const was = b.lockedAt;
    orig.call(this, b, dt);
    if (was === undefined && b.lockedAt !== undefined && b.onSettle) b.onSettle(this, b.tag);
  };
  const origStep = Phys.prototype.step;
  Phys.prototype.step = function (dt) {
    // snapped connections may carry a custom consequence
    const before = this.conns.filter(c => c.alive && c.fray && c.onSnap);
    origStep.call(this, dt);
    for (const c of before) if (!c.alive && !c.snapHandled) { c.snapHandled = true; c.onSnap(this, null); }
  };
})();

// =====================================================================
// Validation: settle each solution, then search the walkable surfaces
// =====================================================================
function buildSegment(P, name, seed, d, origin, seg) {
  const rng = makeRng(seed);
  const b = new Builder(P, origin, seg, rng, d);
  const meta = FAMILIES[name].build(b, rng, d);
  Object.assign(meta, { name, keys: b.keys, decor: b.decor, pickups: b.pickups, bodies: b.bodies, conns: b.conns, origin: origin.slice(), seed, d });
  meta.exitPos = [origin[0] + meta.exit[0], origin[1] + meta.exit[1], origin[2] - meta.len];
  // how many things this stretch lets you unmake: enough for its biggest solution, no more
  if (meta.budget === undefined) meta.budget = Math.max(1, ...meta.solutions.map(s => s.acts.length));
  return meta;
}

function surfacesOf(P, bodies) {
  const out = [];
  for (const b of bodies) {
    if (!b.alive || !b.solid || b.walk === false || b.passable) continue;
    if (b.shape === 'sphere') continue;
    // the face whose normal points most upward
    let best = -1, bi = 1, sg = 1;
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) { const ny = b.ax[i][1] * s; if (ny > best) { best = ny; bi = i; sg = s; } }
    if (best < 0.75) continue;
    const j = (bi + 1) % 3, k = (bi + 2) % 3;
    const c = vAdd(b.pos, vScale(b.ax[bi], sg * b.size[bi]));
    const corners = [];
    for (const [a, e] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) corners.push(vAdd(c, vAdd(vScale(b.ax[j], a * b.size[j]), vScale(b.ax[k], e * b.size[k]))));
    out.push({ body: b, corners, minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])), minZ: Math.min(...corners.map(p => p[2])), maxZ: Math.max(...corners.map(p => p[2])), n: vScale(b.ax[bi], sg), c });
  }
  return out;
}
function surfY(s, x, z) { const n = s.n; return s.c[1] - (n[0] * (x - s.c[0]) + n[2] * (z - s.c[2])) / n[1]; }
function surfGap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  const px = clamp((a.minX + a.maxX) / 2, b.minX, b.maxX), pz = clamp((a.minZ + a.maxZ) / 2, b.minZ, b.maxZ);
  const qx = clamp(px, a.minX, a.maxX), qz = clamp(pz, a.minZ, a.maxZ);
  return { h: Math.hypot(dx, dz), dy: surfY(b, px, pz) - surfY(a, qx, qz) };
}
function reachable(surfs, from, to, sprint) {
  const maxD = sprint ? JUMP.sprint : JUMP.cruise;
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const s = q.shift();
    if (s === to) return true;
    for (const t of surfs) {
      if (seen.has(t)) continue;
      const g = surfGap(s, t);
      let ok = false;
      if (g.h < 0.3 && g.dy <= MOVE.stepUp && g.dy > -1.4) ok = true;           // walk / step
      else if (g.dy <= JUMP.up && g.dy > -9) {
        const lim = maxD - Math.max(0, g.dy) * 1.1 + Math.min(1.2, Math.max(0, -g.dy) * 0.35);
        ok = g.h <= lim;
      }
      if (ok) { seen.add(t); q.push(t); }
    }
  }
  return false;
}

function validateSegment(name, seed, d) {
  const results = [];
  const probe = buildSegment(new Phys(), name, seed, d, [0, 0, 0], 0);
  for (const s of probe.solutions) {
    if (s.dynamic) { results.push({ name: s.name, ok: true, note: 'dynamic route (tested by simulation)' }); continue; }
    const P = new Phys();
    const lead = new Builder(P, [0, 0, 6], -1, makeRng(1), d); lead.deck(0, -6, {});
    const meta = buildSegment(P, name, seed, d, [0, 0, 0], 0);
    const tail = new Builder(P, meta.exitPos, 1, makeRng(2), d); tail.deck(0, -6, {});
    P.player = { pos: [0, 0, -1000] };
    for (const a of s.acts) {
      const o = meta.keys[a];
      if (!o) { results.push({ name: s.name, ok: false, why: 'missing ' + a }); continue; }
      if (o.isConn) P.sever(o); else if (o.erase) P.erase(o); else if (o.hp) P.dismantle(o, o.hp);
    }
    for (let i = 0; i < 60 * 6; i++) P.step(1 / 60);
    const surfs = surfacesOf(P, [...lead.bodies, ...meta.bodies, ...tail.bodies]);
    const from = surfs.find(x => x.body === lead.bodies[0]);
    const to = surfs.find(x => x.body === tail.bodies[0]);
    const ok = !!(from && to && reachable(surfs, from, to, !!s.sprint));
    let relic = true;
    if (s.relic) {
      const rp = meta.pickups.find(p => p.kind === 'relic');
      const rs = rp && surfs.filter(x => Math.abs(surfY(x, rp.pos[0], rp.pos[2]) - (rp.pos[1] - 1.0)) < 1.3 && rp.pos[0] >= x.minX - 0.5 && rp.pos[0] <= x.maxX + 0.5 && rp.pos[2] >= x.minZ - 0.5 && rp.pos[2] <= x.maxZ + 0.5);
      relic = !!(rs && rs.length && rs.some(x => reachable(surfs, from, x, !!s.sprint)));
    }
    results.push({ name: s.name, ok, relic, acts: s.acts.length });
  }
  const primaryOk = results[0].ok;
  const anyAlt = results.length < 2 || results.slice(1).some(r => r.ok);
  return { ok: primaryOk && anyAlt, results, meta: probe };
}

// =====================================================================
// Pacing: one idea at a time, then combinations, with breathing room.
// =====================================================================
const OPENING = ['approach', 'threshold', 'approach', 'drawbridge', 'cradle', 'approach', 'lift', 'counterpoise', 'approach', 'shutters', 'pendulum', 'approach', 'threshold', 'root', 'collapse', 'approach', 'sluice'];

class Sequencer {
  constructor(seed, opening) { this.rng = makeRng(seed); this.i = 0; this.opening = opening; this.hist = []; this.since = 0; }
  next(d, y) {
    let name;
    if (this.opening && this.i < OPENING.length) name = OPENING[this.i];
    else if (this.since >= (d > 0.6 ? 3 : 2)) name = 'approach';
    else {
      const maxTier = d < 0.2 ? 1 : 2;
      // keep the route within the basin's comfortable band of heights
      const pool = Object.keys(FAMILIES).filter(k => !FAMILIES[k].rest && FAMILIES[k].tier <= maxTier && k !== this.hist[this.hist.length - 1] && !(k === 'lift' && (y || 0) > 3));
      const wts = pool.map(k => { const recent = this.hist.slice(-6).filter(h => h === k).length; return Math.pow(0.3, recent) * (FAMILIES[k].tier === 2 ? lerp(0.6, 1.4, d) : 1); });
      let r = this.rng() * wts.reduce((a, c) => a + c, 0);
      name = pool[0];
      for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) { name = pool[i]; break; } }
    }
    this.i++;
    this.hist.push(name);
    this.since = FAMILIES[name].rest ? 0 : this.since + 1;
    return name;
  }
}

// ---- 04_assets.js ----
// =====================================================================
// Visual language: procedural textures, materials, sky, atmosphere.
//
// Three architectural layers, each with its own materials:
//   settlement   — chalk mineral stone, sun-worn ceramic, mineral-stained plaster,
//                  red-brown pigment marks, waterline scars
//   preservation — rusted iron frames, verdigris copper, rivets, bolted plates,
//                  and the glaze: the cool, regular tile the preservers clad
//                  their additions in. Anything glazed can be unmade.
//   returning    — roots, moss, blue-green water, desaturated green growth
// =====================================================================

const PALETTE = {
  chalk: '#d6cfbf', chalkWarm: '#e2d6bf', plaster: '#c9b79a', ceramic: '#e7ddca', pigment: '#7c3526',
  rust: '#6d3a27', rustLight: '#8f5236', verdigris: '#4f7f72', iron: '#3c3a3b',
  cavity: '#2a2830', root: '#7a6a5d', rootLight: '#a49383', moss: '#5e7556', leaf: '#76815c', water: '#4e7f7c',
  skyTop: '#857f8a', skyHorizon: '#e5c79c', basin: '#3b3136', sun: '#ffc88c',
  sever: '#ffb24a', dismantle: '#e8653c', redirect: '#63c7ad',
  glaze: '#d9dbd0', glazeGrout: '#9aa49c', unmake: '#fff1d6', consequence: '#e3b06a', ink: '#2a2326',
  mantle: '#3e4a5f', mantleDark: '#2b3343', hat: '#d9cdb1', sash: '#b4813a', mask: '#efe6d6'
};

function createAssets(THREE, renderer, scratch) {
  const A = { THREE, renderer };
  const trng = makeRng(77);

  // ---------- texture painting on the SDK scratch surface ----------
  function paint(w, h, draw, srgb, repeat) {
    scratch.width = w; scratch.height = h;
    const g = scratch.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    const src = g.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  }
  function grain(g, w, h, n, cols, smin, smax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + trng() * 0.6);
      g.fillStyle = cols[Math.floor(trng() * cols.length)];
      const s = smin + trng() * (smax - smin);
      g.fillRect(trng() * w, trng() * h, s, s * (0.4 + trng()));
    }
    g.globalAlpha = 1;
  }
  function noiseFill(g, w, h, base, amp) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (trng() - 0.5) * amp; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9; }
    g.putImageData(img, 0, 0);
  }
  // waterline scars: pale mineral bands with a darker stain beneath
  function waterlines(g, w, h, rows) {
    for (const r of rows) {
      const y = r * h;
      const grd = g.createLinearGradient(0, y - 6, 0, y + 26);
      grd.addColorStop(0, 'rgba(244,238,224,0.0)'); grd.addColorStop(0.18, 'rgba(244,238,224,0.55)'); grd.addColorStop(0.3, 'rgba(110,98,84,0.32)'); grd.addColorStop(1, 'rgba(110,98,84,0)');
      g.fillStyle = grd; g.fillRect(0, y - 6, w, 32);
      g.strokeStyle = 'rgba(250,246,236,0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.07 + r * 9) * 1.5); g.stroke();
    }
  }
  const T = {};
  // chalk flagstones: irregular, sun-worn, mortar with fine moss
  T.flag = paint(512, 512, (g, w, h) => {
    noiseFill(g, w, h, '#d5cdbd', 16);
    const rows = [0, 140, 260, 390, 512];
    for (let r = 0; r < rows.length - 1; r++) {
      let x = -trng() * 80;
      while (x < w) {
        const ww = 110 + trng() * 120;
        const v = 0.93 + trng() * 0.1;
        g.fillStyle = `rgba(${Math.round(218 * v)},${Math.round(208 * v)},${Math.round(190 * v)},0.55)`;
        g.fillRect(x + 3, rows[r] + 3, ww - 6, rows[r + 1] - rows[r] - 6);
        g.fillStyle = 'rgba(92,80,66,0.55)'; g.fillRect(x, rows[r], 3, rows[r + 1] - rows[r]);
        x += ww;
      }
      g.fillStyle = 'rgba(92,80,66,0.6)'; g.fillRect(0, rows[r], w, 3);
      g.fillStyle = 'rgba(255,250,240,0.35)'; g.fillRect(0, rows[r] + 3, w, 1);
    }
    grain(g, w, h, 2400, ['#bfb4a0', '#e8e1d2', '#a89c86'], 1, 4, 0.35);
    for (let i = 0; i < 220; i++) { g.fillStyle = trng() < 0.6 ? 'rgba(88,108,78,0.45)' : 'rgba(70,96,84,0.4)'; g.fillRect(trng() * w, rows[Math.floor(trng() * 4)] - 2 + trng() * 4, 2 + trng() * 5, 2 + trng() * 3); }
    for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(160,120,70,0.07)'; g.beginPath(); g.arc(trng() * w, trng() * h, 20 + trng() * 60, 0, TAU); g.fill(); }
  });
  // settlement walls: plaster over stone, mineral stains, waterline scars, pigment marks
  T.plaster = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#cdbca0', 14);
    grain(g, w, h, 1600, ['#b8a486', '#ddcdb3', '#a8916f'], 1, 5, 0.3);
    for (let i = 0; i < 26; i++) { g.globalAlpha = 0.07; g.fillStyle = '#5f4936'; g.fillRect(trng() * w, trng() * h * 0.4, 2 + trng() * 3, 40 + trng() * 120); }
    g.globalAlpha = 1;
    waterlines(g, w, h, [0.42, 0.71]);
    // a band of red-brown pigment: old markings of the first settlement
    g.fillStyle = 'rgba(124,53,38,0.55)'; g.fillRect(0, h * 0.14, w, 5);
    for (let x = 8; x < w; x += 32) { g.fillRect(x, h * 0.14 - 9, 4, 9); g.beginPath(); g.arc(x + 14, h * 0.14 + 12, 4, 0, TAU); g.fill(); }
  });
  // carved mineral stone: strata and course joints
  T.stone = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#bdb3a2', 14);
    for (let y = 0; y < h; y += 2) { const a = 0.03 + 0.05 * Math.abs(Math.sin(y * 0.09) * Math.sin(y * 0.031)); g.fillStyle = `rgba(80,70,58,${a.toFixed(3)})`; g.fillRect(0, y, w, 2); }
    for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(70,60,48,0.4)'; g.fillRect(0, y, w, 2); for (let x = (y / 64) % 2 ? 40 : 0; x < w; x += 104) g.fillRect(x, y, 2, 64); }
    waterlines(g, w, h, [0.6]);
  });
  // preservation iron: rust over plate, rivet lines, verdigris on the copper fittings
  T.rust = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#6b3c2a', 20);
    grain(g, w, h, 1400, ['#7f4a30', '#55301f', '#9a5e3c', '#4a3a34'], 1, 5, 0.45);
    for (let i = 0; i < 26; i++) { g.globalAlpha = 0.18; g.fillStyle = '#3c2a22'; g.fillRect(trng() * w, trng() * h, 2, 30 + trng() * 60); }
    g.globalAlpha = 1;
    for (let i = 0; i < 6; i++) { const x = trng() * w, y = trng() * h; const grd = g.createRadialGradient(x, y, 0, x, y, 30 + trng() * 30); grd.addColorStop(0, 'rgba(80,128,112,0.45)'); grd.addColorStop(1, 'rgba(80,128,112,0)'); g.fillStyle = grd; g.fillRect(x - 60, y - 60, 120, 120); }
    g.fillStyle = 'rgba(30,22,20,0.6)'; g.fillRect(0, 62, w, 3); g.fillRect(0, 190, w, 3);
    g.fillStyle = '#9b6a4c'; for (const yy of [52, 74, 180, 202]) for (let x = 10; x < w; x += 22) { g.beginPath(); g.arc(x, yy, 2.6, 0, TAU); g.fill(); }
  });
  T.verdigris = paint(128, 128, (g, w, h) => { noiseFill(g, w, h, '#4d7c6f', 22); grain(g, w, h, 600, ['#6fa190', '#3a5f55', '#8a6a46'], 1, 4, 0.4); });
  T.timber = paint(256, 128, (g, w, h) => {
    noiseFill(g, w, h, '#7d6248', 12);
    for (let i = 0; i < 90; i++) { g.strokeStyle = trng() < 0.5 ? 'rgba(50,36,26,0.35)' : 'rgba(170,140,108,0.2)'; g.lineWidth = 1 + trng(); g.beginPath(); const y = trng() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2); g.stroke(); }
    for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(36,26,18,0.6)'; g.fillRect(0, k * h / 4 - 1, w, 2); }
    for (const x of [14, w - 26]) { g.fillStyle = '#5a2f20'; g.fillRect(x, 0, 12, h); g.fillStyle = '#a8724e'; for (let y = 8; y < h; y += 20) g.fillRect(x + 4, y, 4, 4); }
  });
  // root bark: long fibres, paler ridges, mineral dust
  T.bark = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#76675a', 18);
    for (let i = 0; i < 160; i++) { g.strokeStyle = trng() < 0.5 ? 'rgba(48,38,32,0.4)' : 'rgba(176,160,140,0.32)'; g.lineWidth = 1 + trng() * 2.5; g.beginPath(); let x = trng() * w; g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) { x += (trng() - 0.5) * 6; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(92,118,86,0.3)'; g.fillRect(trng() * w, trng() * h, 6 + trng() * 10, 3 + trng() * 6); }
  });
  T.ceramic = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#e3d8c4', 10);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < w; x += 32) { const v = 0.94 + trng() * 0.08; g.fillStyle = `rgba(${Math.round(228 * v)},${Math.round(214 * v)},${Math.round(192 * v)},0.8)`; g.fillRect(x + 1, y + 1, 30, 30); }
    g.fillStyle = 'rgba(120,96,74,0.4)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(124,53,38,0.45)'; const x = Math.floor(trng() * 8) * 32, y = Math.floor(trng() * 8) * 32; g.fillRect(x + 12, y + 6, 8, 20); }
  });
  // the preservers' glaze: machine-regular square tiles, cool and even, a seal on every fourth
  T.glaze = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#d8dace', 6);
    const n = 8, c = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 0.97 + trng() * 0.05; g.fillStyle = `rgba(${Math.round(222 * v)},${Math.round(225 * v)},${Math.round(214 * v)},0.9)`; g.fillRect(x * c + 2, y * c + 2, c - 4, c - 4); }
    g.fillStyle = 'rgba(122,136,128,0.55)'; for (let i = 0; i <= n; i++) { g.fillRect(0, i * c - 1, w, 2); g.fillRect(i * c - 1, 0, 2, h); }
    g.strokeStyle = 'rgba(79,127,114,0.5)'; g.lineWidth = 1.5;
    for (let y = 0; y < n; y += 4) for (let x = 2; x < n; x += 4) { g.beginPath(); g.arc(x * c + c / 2, y * c + c / 2, c * 0.22, 0, TAU); g.stroke(); }
    for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(90,110,100,0.08)'; g.fillRect(trng() * w, 0, 3, h); }
  });
  T.cracks = paint(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round';
    const crack = (x, y, a, len, wd, depth) => {
      g.lineWidth = wd; g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 6; i++) { a += (trng() - 0.5) * 0.9; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; g.lineTo(x, y); if (depth > 0 && trng() < 0.3) crack(x, y, a + (trng() - 0.5) * 2, len * 0.5, wd * 0.6, depth - 1); }
      g.stroke();
    };
    for (let k = 0; k < 5; k++) crack(w * 0.5 + (trng() - 0.5) * 60, h * 0.5 + (trng() - 0.5) * 60, trng() * TAU, w * 0.55, 3, 2);
  }, false, false);
  T.glow = paint(64, 64, (g, w, h) => { const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, true, false);
  T.water = paint(128, 128, (g, w, h) => { noiseFill(g, w, h, '#4c7c79', 10); for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(232,236,214,${0.1 + trng() * 0.25})`; g.lineWidth = 1.4; g.beginPath(); const x = trng() * w, y = trng() * h; g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16, y); g.stroke(); } });
  T.mist = paint(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const x = trng() * w, y = trng() * h, r = 18 + trng() * 60; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); grd.addColorStop(0, `rgba(255,255,255,${0.08 + trng() * 0.1})`); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
  });
  A.T = T;

  // ---------- occlusion dither + basin depth fog ----------
  // Anything between the camera and the traveller dissolves into a stipple, so
  // the architecture can stay monumental without ever hiding the player.
  const U = {
    uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() },
    uBasin: { value: new THREE.Color(PALETTE.basin) }, uOccl: { value: 1 }, uTime: { value: 0 }
  };
  A.U = U;
  function patch(mat, key, extra) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPlayer = U.uPlayer; sh.uniforms.uCam = U.uCam; sh.uniforms.uBasin = U.uBasin; sh.uniforms.uOccl = U.uOccl;
      if (extra) extra(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vec4 uw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n uw = instanceMatrix * uw;\n#endif\n vUW = (modelMatrix * uw).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUW; uniform vec3 uPlayer; uniform vec3 uCam; uniform vec3 uBasin; uniform float uOccl;\n' +
          'float ditherB(vec2 p){ vec2 q = mod(floor(p), 4.0); float a = q.x + q.y * 4.0;' +
          ' return fract(sin(a * 12.9898 + 78.233) * 43758.5453) * 0.0 + mod(a * 7.0, 16.0) / 16.0 + 0.03; }')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' +
          ' if (uOccl > 0.5) { vec3 ab = uPlayer - uCam; float L2 = max(dot(ab, ab), 0.01);' +
          '   float t = clamp(dot(vUW - uCam, ab) / L2, 0.0, 1.0);' +
          '   float d = length(vUW - (uCam + ab * t));' +
          '   float r = mix(2.6, 1.0, t);' +
          '   float f = (1.0 - smoothstep(r * 0.5, r, d)) * smoothstep(0.05, 0.15, t) * (1.0 - smoothstep(0.86, 0.94, t));' +
          '   if (f > 0.0 && ditherB(gl_FragCoord.xy) < f) discard; }')
        .replace('#include <fog_fragment>', '#ifdef USE_FOG\n float deep = smoothstep(-4.0, -42.0, vUW.y - uPlayer.y);\n' +
          ' gl_FragColor.rgb = mix(gl_FragColor.rgb, uBasin, deep * 0.85);\n' +
          ' float ff = smoothstep(fogNear, fogFar, vFogDepth);\n' +
          ' gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uBasin, deep * 0.7), ff);\n#endif');
    };
    mat.customProgramCacheKey = () => 'unmake-' + key;
    return mat;
  }
  let mk = 0;
  const std = (o) => patch(new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.92, metalness: 0 }, o)), 's' + (mk++ % 3));
  const M = {};
  M.flag = std({ map: T.flag });
  M.stone = std({ map: T.stone });
  M.stoneDark = std({ map: T.stone, color: '#8f857c' });
  M.plaster = std({ map: T.plaster });
  M.ceramic = std({ map: T.ceramic, roughness: 0.7 });
  M.rust = std({ map: T.rust, roughness: 0.75, metalness: 0.35 });
  M.rustDark = std({ map: T.rust, color: '#8a8080', roughness: 0.8, metalness: 0.3 });
  M.verdigris = std({ map: T.verdigris, roughness: 0.55, metalness: 0.45 });
  M.iron = std({ color: '#3d3b3c', roughness: 0.55, metalness: 0.6 });
  M.brass = std({ color: '#b48a46', roughness: 0.35, metalness: 0.75 });
  M.timber = std({ map: T.timber });
  M.bark = std({ map: T.bark, roughness: 1 });
  M.pigment = std({ color: PALETTE.pigment, roughness: 0.85 });
  M.cavity = std({ color: PALETTE.cavity, roughness: 1 });
  M.moss = std({ color: PALETTE.moss, roughness: 1, flatShading: true });
  M.leaf = std({ color: PALETTE.leaf, roughness: 0.95, flatShading: true });
  M.water = patch(new THREE.MeshStandardMaterial({ map: T.water, color: '#7fb2aa', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.86 }), 'w');
  M.rope = std({ color: '#2f2c2b', roughness: 0.6, metalness: 0.5 });
  M.cloth = new THREE.MeshStandardMaterial({ color: '#c7b69a', roughness: 0.95, side: THREE.DoubleSide });
  M.vcStone = std({ vertexColors: true, map: T.stone });
  M.vcPlaster = std({ vertexColors: true, map: T.plaster });
  M.vcRust = std({ vertexColors: true, map: T.rust, color: '#b3a7a2', metalness: 0.3, roughness: 0.8 });
  M.vcBark = std({ vertexColors: true, map: T.bark });
  M.vcFlat = std({ vertexColors: true, flatShading: true });
  M.mantle = new THREE.MeshStandardMaterial({ color: PALETTE.mantle, roughness: 0.85 });
  M.mantleDark = new THREE.MeshStandardMaterial({ color: PALETTE.mantleDark, roughness: 0.9 });
  M.hat = new THREE.MeshStandardMaterial({ color: PALETTE.hat, roughness: 0.75 });
  M.sash = new THREE.MeshStandardMaterial({ color: PALETTE.sash, roughness: 0.8 });
  M.mask = new THREE.MeshStandardMaterial({ color: PALETTE.mask, roughness: 0.55 });
  M.legs = new THREE.MeshStandardMaterial({ color: '#2f2b2c', roughness: 0.85 });
  M.key = new THREE.MeshStandardMaterial({ color: '#f3d7a2', emissive: new THREE.Color('#ff9e3a'), emissiveIntensity: 0.6, roughness: 0.25 });
  M.relic = new THREE.MeshStandardMaterial({ color: '#f1e3c2', emissive: new THREE.Color('#ffb25a'), emissiveIntensity: 0.9, roughness: 0.3 });
  M.salvage = new THREE.MeshStandardMaterial({ color: '#b98a4a', metalness: 0.75, roughness: 0.35, emissive: new THREE.Color('#4a2c10'), emissiveIntensity: 0.4 });
  M.hidden = new THREE.MeshBasicMaterial({ visible: false });
  M.crackOverlay = new THREE.MeshBasicMaterial({ map: T.cracks, color: '#ffb070', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  A.M = M;
  A.patch = patch;

  // ---------- the glaze, and the language of unmaking ----------
  // Every glazed body gets its own material so it can carry its own frame:
  //   copper edges   — oxidised trim along every edge: "this was added"
  //   uFocus         — targeted: a fine demolition hatch over its faces and a
  //                    chalk line on its edges — the exact region that will go
  //   uWipe          — unmade: the body is erased outward from where it was
  //                    touched, a clean front with a thin chalk rim. No debris.
  const glazeFrag = `
    uniform mat4 uInv; uniform vec3 uHalf; uniform vec3 uOrigin; uniform float uRad; uniform float uWipe; uniform float uFocus; uniform float uTime; uniform float uSealed;
    vec3 gLp; float gEdge; float gWipeD;
    void glazeFrame(){
      gLp = (uInv * vec4(vUW, 1.0)).xyz;
      vec3 e = max(uHalf - abs(gLp), 0.0);
      float m1 = min(e.x, min(e.y, e.z)); float m3 = max(e.x, max(e.y, e.z)); float m2 = e.x + e.y + e.z - m1 - m3;
      gEdge = m2;
      gWipeD = length(gLp - uOrigin) / max(uRad, 0.01);
    }`;
  const glazeExtra = (u) => (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n glazeFrame();\n if (uWipe > 0.0 && gWipeD < uWipe) discard;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float trim = 1.0 - smoothstep(0.05, 0.09, gEdge);\n diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.20, 0.36, 0.31), vec3(0.30, 0.29, 0.29), uSealed), trim * 0.9);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 0.86, uSealed * 0.6);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' +
        ' float hatch = step(0.82, fract((gLp.x + gLp.y - gLp.z) * 3.2 - uTime * 0.6));\n' +
        ' float line = 1.0 - smoothstep(0.0, 0.035, gEdge);\n' +
        ' float rim = uWipe > 0.0 ? 1.0 - smoothstep(0.0, 0.12, gWipeD - uWipe) : 0.0;\n' +
        ' totalEmissiveRadiance += vec3(1.0, 0.93, 0.80) * (uFocus * (hatch * 0.55 + line * 1.4 + 0.06) + rim * 2.2);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>' + glazeFrag);
  };
  A.glaze = function (b) {
    const u = {
      uInv: { value: new THREE.Matrix4() }, uHalf: { value: new THREE.Vector3(b.size[0], b.size[1], b.size[2]) },
      uOrigin: { value: new THREE.Vector3() }, uRad: { value: Math.hypot(b.size[0], b.size[1], b.size[2]) * 2 },
      uWipe: { value: 0 }, uFocus: { value: 0 }, uSealed: { value: 0 }, uTime: U.uTime
    };
    const m = patch(new THREE.MeshStandardMaterial({ map: T.glaze, roughness: 0.42, metalness: 0.02, color: '#f2f2ea' }), 'glaze', glazeExtra(u));
    m.userData.own = true; m.userData.u = u;
    return m;
  };

  // ---------- geometry helpers ----------
  // box with UVs in world units so textures keep their scale on every face
  A.box = function (w, h, d, ts) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, s = ts || 2.4;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / s, uv.getY(i) * dims[f][1] / s); }
    return g;
  };
  A.merge = function (parts) {
    let total = 0;
    const list = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); if (p.m) g.applyMatrix4(p.m); total += g.attributes.position.count; return { g, c: p.c }; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
    let o = 0; const tc = new THREE.Color();
    for (const { g, c } of list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      tc.set(c || '#ffffff');
      for (let i = 0; i < n; i++) { col[(o + i) * 3] = tc.r; col[(o + i) * 3 + 1] = tc.g; col[(o + i) * 3 + 2] = tc.b; }
      o += n; g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.computeBoundingSphere();
    return m;
  };
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  A.mat = function (x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x, y, z);
    _s.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
    return new THREE.Matrix4().compose(_p, _q, _s);
  };
  A.G = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
    sphere: new THREE.SphereGeometry(1, 20, 14), sphereLo: new THREE.SphereGeometry(1, 10, 7), dome: new THREE.SphereGeometry(1, 18, 9, 0, TAU, 0, Math.PI / 2),
    ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1), torus: new THREE.TorusGeometry(1, 0.16, 8, 20), cone: new THREE.ConeGeometry(1, 1, 10), plane: new THREE.PlaneGeometry(1, 1)
  };
  for (const g of Object.values(A.G)) g.userData.shared = true;
  // a root: a tapering tube along a curve, with world-scale bark UVs
  A.rootGeo = function (points, r0, r1, seg) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const n = seg || 40, rad = 9;
    const g = new THREE.TubeGeometry(curve, n, 1, rad, false);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const len = curve.getLength();
    const pts = curve.getSpacedPoints(n);
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = lerp(r0, r1, t) * (1 + 0.08 * Math.sin(t * 23) + 0.05 * Math.sin(t * 61));
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j;
        const c = pts[i];
        const nx = nor.getX(k), ny = nor.getY(k), nz = nor.getZ(k);
        const lump = 1 + 0.12 * Math.sin(j * 2.1 + i * 0.7);
        pos.setXYZ(k, c.x + nx * r * lump, c.y + ny * r * lump, c.z + nz * r * lump);
        uv.setXY(k, j / rad * (r * TAU) / 2.4, t * len / 2.4);
      }
    }
    g.computeVertexNormals();
    return g;
  };

  // ---------- sky ----------
  const skyU = { cTop: { value: new THREE.Color(PALETTE.skyTop) }, cHor: { value: new THREE.Color(PALETTE.skyHorizon) }, cBot: { value: new THREE.Color(PALETTE.basin) }, sunDir: { value: new THREE.Vector3(-0.55, 0.32, -0.77).normalize() }, sunCol: { value: new THREE.Color('#ffd7a0') } };
  A.skyU = skyU;
  A.skyMat = new THREE.ShaderMaterial({
    uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: 'uniform vec3 cTop; uniform vec3 cHor; uniform vec3 cBot; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vD;' +
      'void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(cHor, cTop, pow(smoothstep(0.0, 0.8, y), 0.7)) : mix(cHor, cBot, smoothstep(0.0, 0.32, -y));' +
      ' float sd = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(sd, 400.0) * 1.2 + pow(sd, 18.0) * 0.22 + pow(sd, 3.0) * 0.07);' +
      ' float band = smoothstep(0.02, 0.0, abs(y - 0.06)) * 0.05; c += vec3(band * 0.9, band * 0.7, band * 0.4);' +
      ' gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  return A;
}

// ---- 05_views.js ----
// =====================================================================
// Views: authored geometry for every structural style, connections,
// pickups, the traveller rig, the first-person hand and particles.
// A view is a THREE.Group in the body's local frame; sync() copies the
// simulated transform every frame.
// =====================================================================

function createViews(THREE, A, scene) {
  const V = {};
  const { M, G, box } = A;
  const root = new THREE.Group();
  scene.add(root);
  V.root = root;

  const mesh = (geo, mat, parent, x, y, z, sx, sy, sz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const faces = (side, top, bottom) => [side, side, top, bottom || side, side, side];

  // an I-beam girder along local z
  function girder(g, x, y, len, h, w, mat) {
    mesh(box(w, 0.06, len, 2), mat, g, x, y + h / 2 - 0.03, 0);
    mesh(box(w, 0.06, len, 2), mat, g, x, y - h / 2 + 0.03, 0);
    mesh(box(0.05, h, len, 2), mat, g, x, y, 0);
  }
  // a lattice column dropping into the basin
  function lattice(g, x, z, top, depth, w) {
    const parts = [];
    const h = depth;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ geo: G.box, m: A.mat(x + sx * w / 2, top - h / 2, z + sz * w / 2, 0, 0, 0, 0.12, h, 0.12) });
    for (let y = top - 1.2; y > top - h; y -= 2.2) {
      parts.push({ geo: G.box, m: A.mat(x, y, z - w / 2, 0, 0, 0, w, 0.08, 0.08) });
      parts.push({ geo: G.box, m: A.mat(x, y, z + w / 2, 0, 0, 0, w, 0.08, 0.08) });
      parts.push({ geo: G.box, m: A.mat(x - w / 2, y, z, 0, 0, 0, 0.08, 0.08, w) });
      parts.push({ geo: G.box, m: A.mat(x + w / 2, y, z, 0, 0, 0, 0.08, 0.08, w) });
      parts.push({ geo: G.box, m: A.mat(x, y - 1.1, z - w / 2, 0, 0, Math.atan2(2.2, w), Math.hypot(w, 2.2), 0.06, 0.06) });
    }
    const m = new THREE.Mesh(A.merge(parts), M.vcRust);
    m.castShadow = true; g.add(m);
  }

  const builders = {
    deck(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, 0.24, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g, 0, hy - 0.12, 0);
      girder(g, -hx + 0.3, hy - 0.5, hz * 2 - 0.1, 0.52, 0.3, M.rust);
      girder(g, hx - 0.3, hy - 0.5, hz * 2 - 0.1, 0.52, 0.3, M.rust);
      for (let z = -hz + 0.6; z <= hz - 0.5; z += 2.4) mesh(box(hx * 2 - 0.5, 0.18, 0.16, 1), M.rustDark, g, 0, hy - 0.62, z);
      if (hz > 3.2 && hx > 0.8) lattice(g, hx - 0.35, -hz + 0.8, hy - 0.8, 18 + (s[2] * 13) % 7, 0.7);
    },
    terrace(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.plaster, M.flag, M.stone), g, 0, 0, 0);
      mesh(box(hx * 2 + 0.16, 0.12, hz * 2 + 0.16, 2), M.ceramic, g, 0, hy - 0.06, 0);
      // the old footing, wider and darker, sinking into the basin
      mesh(box(hx * 2 + 0.3, 8, hz * 2 + 0.3, 3), M.stoneDark, g, 0, -hy - 4, 0);
      if (hz > 1.5) mesh(box(hx * 2 + 0.34, 0.2, 0.5, 1), M.pigment, g, 0, -hy - 0.9, hz * 0.4);
    },
    channel(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.stone, M.stoneDark), g, 0, 0, 0);
      mesh(box(0.7, 0.04, hz * 2 - 0.2, 2), M.cavity, g, 0, hy + 0.01, 0);
      for (const sx of [-1, 1]) mesh(box(0.3, 0.5, hz * 2, 2), M.stone, g, sx * (hx - 0.15), hy + 0.0, 0);
      mesh(box(hx * 2 + 0.3, 10, hz * 2 + 0.3, 3), M.stoneDark, g, 0, -hy - 5, 0);
    },
    causeway(g, s) { builders.deck(g, s); },
    beam(g, s) {
      const [hx, hy, hz] = s;
      girder(g, 0, 0, hz * 2, hy * 2, hx * 2, M.rust);
      mesh(box(hx * 2 - 0.1, 0.05, hz * 2, 2), M.timber, g, 0, hy - 0.02, 0);
    },
    leaf(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2 - 0.2, 0.14, hz * 2, 1.6), faces(M.timber, M.timber, M.timber), g, 0, hy - 0.07, 0);
      for (const sx of [-1, 1]) {
        girder(g, sx * (hx - 0.12), -0.05, hz * 2, 0.42, 0.24, M.rust);
        mesh(box(0.06, 0.06, hz * 2, 2), M.verdigris, g, sx * (hx - 0.08), hy + 0.65, 0);
        for (let z = -hz + 0.4; z <= hz; z += 1.4) mesh(box(0.06, 0.65, 0.06, 1), M.verdigris, g, sx * (hx - 0.08), hy + 0.33, z);
      }
    },
    balance(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 1.6), faces(M.timber, M.timber, M.rust), g, 0, 0, 0);
      for (const sx of [-1, 1]) girder(g, sx * (hx + 0.08), -0.15, hz * 2, 0.5, 0.18, M.rust);
      mesh(G.cyl, M.verdigris, g, 0, -hy - 0.15, 0, 0.32, hx * 2 + 0.7, 0.32, 0, 0, Math.PI / 2);
      mesh(box(hx * 2 + 0.2, 0.3, 1.0, 1), M.rust, g, 0, -0.05, -hz + 0.5);
    },
    counterweight(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.2), M.rust, g);
      mesh(box(s[0] * 2 + 0.08, 0.2, s[2] * 2 + 0.08, 1), M.verdigris, g, 0, s[1] * 0.4, 0);
      mesh(G.torus, M.iron, g, 0, s[1] + 0.12, 0, 0.22, 0.22, 0.22, Math.PI / 2, 0, 0);
    },
    cradle(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, 0.14, hz * 2, 2), faces(M.rust, M.ceramic, M.rust), g, 0, hy - 0.07, 0);
      girder(g, -hx + 0.1, -0.1, hz * 2, 0.36, 0.2, M.rust);
      girder(g, hx - 0.1, -0.1, hz * 2, 0.36, 0.2, M.rust);
      for (const z of [-hz + 0.3, hz - 0.3]) mesh(box(hx * 2, 0.12, 0.2, 1), M.verdigris, g, 0, hy + 0.06, z);
    },
    root(g, s) {
      const [hx, hy, hz] = s;
      const r = Math.max(hx, hy) * 1.2;
      const pts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([Math.sin(t * 5 + hz) * 0.08, hy - r + Math.sin(t * Math.PI) * 0.12, lerp(hz + 0.2, -hz - 0.2, t)]); }
      const m = mesh(A.rootGeo(pts, r, r * 0.92, 24), M.bark, g);
      m.position.y = 0;
      for (let i = 0; i < 3; i++) mesh(A.rootGeo([[0, -r * 0.6, lerp(hz, -hz, 0.2 + i * 0.3)], [0.3, -r - 0.7, lerp(hz, -hz, 0.2 + i * 0.3) - 0.2], [0.1, -r - 1.6, lerp(hz, -hz, 0.2 + i * 0.3)]], 0.09, 0.02, 8), M.bark, g);
    },
    rootBridge(g, s) { builders.root(g, s); },
    knuckle(g, s) {
      const m = mesh(G.ico1, M.bark, g, 0, 0, 0, s[0] * 1.15, s[1] * 1.25, s[2] * 1.15);
      m.rotation.set(0.3, 0.6, 0.2);
      mesh(A.rootGeo([[0, -s[1], 0], [0.3, -s[1] - 2, 0.4], [-0.2, -s[1] - 5, 0.1]], s[0] * 0.55, s[0] * 0.3, 10), M.bark, g);
    },
    lever(g, s) { mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1), M.brass, g); mesh(G.cyl, M.iron, g, 0, -0.3, 0, 0.12, 0.6, 0.12); },
    casket(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1), M.ceramic, g);
      mesh(box(s[0] * 2 + 0.06, 0.1, s[2] * 2 + 0.06, 1), M.pigment, g, 0, s[1] * 0.5, 0);
      mesh(G.dome, M.ceramic, g, 0, s[1], 0, s[0] * 0.9, 0.3, s[2] * 0.9);
    },
    weight(g) {
      const b = mesh(G.sphere, M.rust, g, 0, 0, 0, 0.75, 0.75, 0.75);
      for (const r of [0, Math.PI / 2]) mesh(G.torus, M.verdigris, b, 0, 0, 0, 1.01, 1.01, 1.01, r, 0, 0);
    },
    repairWall(g, s, b) {
      const [hx, hy, hz] = s;
      // generations of patches: the original stone, then plaster, then iron plates
      mesh(box(hx * 2, hy * 2, hz * 2, 1.6), M.stone, g);
      const r = makeRng(b.id * 31);
      for (let i = 0; i < 7; i++) {
        const w = 0.5 + r() * 1.0, h = 0.4 + r() * 0.9;
        const mat = r() < 0.4 ? M.rust : r() < 0.6 ? M.plaster : M.ceramic;
        const big = hx > hz;
        mesh(box(big ? w : hx * 2 + 0.08 + r() * 0.06, h, big ? hz * 2 + 0.08 + r() * 0.06 : w, 1.2), mat, g, big ? (r() - 0.5) * (hx * 2 - w) : 0, (r() - 0.5) * (hy * 2 - h), big ? 0 : (r() - 0.5) * (hz * 2 - w));
      }
      for (const yy of [-hy * 0.5, hy * 0.4]) mesh(box(hx * 2 + 0.12, 0.12, hz * 2 + 0.12, 1), M.iron, g, 0, yy, 0);
      const ov = mesh(box(hx * 2 + 0.14, hy * 2 + 0.02, hz * 2 + 0.14, 1.6), M.crackOverlay.clone(), g); ov.material.userData.own = true;
      ov.castShadow = false; ov.receiveShadow = false;
      g.userData.cracks = ov;
    },
    terraceSlab(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.plaster, M.flag, M.stoneDark), g);
      mesh(box(hx * 2 + 0.12, 0.1, hz * 2 + 0.12, 2), M.ceramic, g, 0, hy - 0.05, 0);
      for (let i = 0; i < 3; i++) mesh(A.rootGeo([[(i - 1) * 0.9, -hy, 0], [(i - 1) * 1.1, -hy - 1.2, 0.3], [(i - 1) * 0.8, -hy - 2.6, -0.2]], 0.07, 0.02, 8), M.bark, g);
    },
    basin(g, s) { mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 2.4), faces(M.stone, M.stoneDark, M.stoneDark), g); },
    barge(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2 - 0.6, 1.5), faces(M.timber, M.timber, M.timber), g);
      for (const sz of [-1, 1]) mesh(box(hx * 1.6, hy * 1.6, 0.6, 1), M.timber, g, 0, hy * 0.2, sz * (hz - 0.3), sz * 0.35, 0, 0);
      for (const sx of [-1, 1]) mesh(box(0.08, 0.3, hz * 2 - 0.4, 1), M.rust, g, sx * (hx - 0.04), hy + 0.12, 0);
    },
    sluice(g, s, b) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.2), M.rust, g);
      for (let y = -s[1] + 0.4; y < s[1]; y += 0.6) mesh(box(s[0] * 2 + 0.1, 0.08, s[2] * 2 + 0.06, 1), M.verdigris, g, 0, y, 0);
      const wheel = mesh(G.torus, M.verdigris, g, s[0] + 0.25, s[1] * 0.6, 0, 0.5, 0.5, 0.5, 0, Math.PI / 2, 0);
      void wheel; void b;
      const ov = mesh(box(s[0] * 2 + 0.14, s[1] * 2 + 0.02, s[2] * 2 + 0.14, 1.2), M.crackOverlay.clone(), g); ov.material.userData.own = true;
      ov.castShadow = false; g.userData.cracks = ov;
    },
    post(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.6), faces(M.stone, M.flag, M.stone), g);
      mesh(G.torus, M.rust, g, 0, s[1] - 0.6, 0, s[0] * 1.05, s[0] * 1.05, 0.5, Math.PI / 2, 0, 0);
    },
    liftDeck(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.6), faces(M.rust, M.timber, M.rust), g);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(G.cyl6, M.rope, g, sx * (s[0] - 0.1), 3.5, sz * (s[2] - 0.1), 0.03, 7, 0.03);
    },
    net(g, s) {
      for (let x = -s[0]; x <= s[0] + 1e-3; x += 0.5) mesh(G.cyl6, M.rope, g, x, s[1], 0, 0.025, s[2] * 2, 0.025, Math.PI / 2, 0, 0);
      for (let z = -s[2]; z <= s[2] + 1e-3; z += 0.5) mesh(G.cyl6, M.rope, g, 0, s[1], z, 0.025, s[0] * 2, 0.025, 0, 0, Math.PI / 2);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(box(0.25, 6, 0.25, 1), M.rust, g, sx * s[0], s[1] - 3, sz * s[2]);
    },
    // ---- the glaze: preservation additions, every one of them unmakeable ----
    preserved(g, s, b) {
      const [hx, hy, hz] = s;
      const m = A.glaze(b);
      g.userData.glaze = m;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), m, g);
      // walls get a plinth and a cap; long floors a pair of keel ribs: all glaze, so they go together
      if (hy > 0.8 && Math.max(hx, hz) > 0.6) {
        mesh(box(hx * 2 + 0.12, 0.16, hz * 2 + 0.12, 2.4), m, g, 0, hy - 0.08, 0);
        mesh(box(hx * 2 + 0.16, 0.22, hz * 2 + 0.16, 2.4), m, g, 0, -hy + 0.11, 0);
      } else if (hy < 0.5 && hz > 1.2) {
        for (const sx of [-1, 1]) mesh(box(0.22, 0.34, hz * 2, 2.4), m, g, sx * (hx - 0.3), -hy - 0.17, 0);
      }
    },
    // an old settlement wall: carved stone, pigment band, a blind niche. Not glazed, so it stays.
    oldWall(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stone), g);
      mesh(box(hx * 2 + 0.06, 0.16, hz * 2 + 0.06, 1), M.pigment, g, 0, hy * 0.55, 0);
      mesh(box(0.7, 1.0, 0.1, 1), M.cavity, g, 0, -0.2, hz + 0.01);
      mesh(G.dome, M.stone, g, 0, 0.3, hz + 0.01, 0.35, 0.35, 0.12, Math.PI / 2, 0, 0);
    },
    // settlement stone spans: no deep footing, so the old street below stays open
    span(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      mesh(box(hx * 2 + 0.16, 0.12, hz * 2 + 0.16, 2), M.ceramic, g, 0, hy - 0.06, 0);
      for (const sx of [-1, 1]) mesh(box(0.34, 0.5, hz * 2, 2.4), M.stoneDark, g, sx * (hx - 0.17), -hy - 0.25, 0);
    },
    lintel(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      for (const sz of [-1, 1]) mesh(box(hx * 2 + 0.1, hy * 2 + 0.08, 0.3, 1), M.pigment, g, 0, 0, sz * (hz - 0.5));
    },
    ramp(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      for (let z = -hz + 0.65; z < hz; z += 0.65) mesh(box(hx * 2 - 0.2, 0.02, 0.06, 1), M.stoneDark, g, 0, hy + 0.005, z);
      mesh(box(hx * 2 + 0.3, 3, hz * 2, 2.4), M.stoneDark, g, 0, -hy - 1.5, 0);
    },
    pier(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 2.4), M.stoneDark, g);
      mesh(box(s[0] * 2 + 0.3, 0.5, s[2] * 2 + 0.3, 1), M.rust, g, 0, s[1] - 0.25, 0);
    }
  };

  // fewer draw calls: a body's parts that share one material become one mesh
  // (multi-material parts and specially referenced parts are left alone)
  function compact(g) {
    const keep = new Set(Object.values(g.userData).filter(v => v && v.isObject3D));
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || Array.isArray(c.material) || keep.has(c) || c.children.length) continue;
      c.updateMatrix();
      const k = c.material.uuid;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geo = A.merge(list.map(c => ({ geo: c.geometry, m: c.matrix })));
      const m = new THREE.Mesh(geo, list[0].material);
      m.castShadow = true; m.receiveShadow = true;
      for (const c of list) { g.remove(c); if (!c.geometry.userData.shared) c.geometry.dispose(); }
      g.add(m);
    }
  }
  // A segment's settlement stone never moves and never goes: bake all of it
  // into one mesh per material (multi-material boxes are split by face group).
  V.canBatch = b => b.type === 'static' && !b.erase && !b.hp && !b.fragile && !b.fallable && !b.holds && b.shape !== 'sphere' && b.style !== 'lever';
  V.batchStatic = function (bodies) {
    const buckets = new Map(), temp = [];
    const push = (mat, geo, m) => { if (!buckets.has(mat.uuid)) buckets.set(mat.uuid, { mat, parts: [] }); buckets.get(mat.uuid).parts.push({ geo, m }); };
    for (const b of bodies) {
      const g = new THREE.Group();
      (builders[b.style] || builders.deck)(g, b.size, b);
      g.position.set(b.pos[0], b.pos[1], b.pos[2]); g.quaternion.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
      g.updateMatrixWorld(true);
      g.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.userData.shared) temp.push(o.geometry);
        if (!Array.isArray(o.material)) { push(o.material, o.geometry, o.matrixWorld.clone()); return; }
        const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        if (src !== o.geometry) temp.push(src);
        for (const gr of o.geometry.groups) {
          const sub = new THREE.BufferGeometry();
          for (const name of ['position', 'normal', 'uv']) { const a = src.attributes[name]; if (a) sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); }
          temp.push(sub);
          push(o.material[gr.materialIndex], sub, o.matrixWorld.clone());
        }
      });
    }
    const out = new THREE.Group();
    for (const { mat, parts } of buckets.values()) { const m = new THREE.Mesh(A.merge(parts), mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; out.add(m); }
    for (const geo of temp) geo.dispose();
    out.matrixAutoUpdate = false;
    root.add(out);
    return out;
  };
  V.makeBody = function (b) {
    const g = new THREE.Group();
    const f = builders[b.style] || builders.deck;
    if (b.shape === 'sphere') builders.weight(g, b.size, b);
    else f(g, b.size, b);
    g.userData.body = b;
    compact(g);
    root.add(g);
    V.syncBody(b, g);
    if (b.style === 'deck' || b.style === 'terrace' || b.style === 'channel' || b.style === 'pier' || b.style === 'basin' || b.style === 'post' || b.style === 'span' || b.style === 'ramp') g.matrixAutoUpdate = b.type !== 'static';
    return g;
  };
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  V.syncBody = function (b, g) {
    g.position.set(b.pos[0], b.pos[1], b.pos[2]);
    g.quaternion.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
    if (g.userData.glaze) { _m4.compose(g.position, g.quaternion, _one).invert(); g.userData.glaze.userData.u.uInv.value.copy(_m4); }
    if (b.type === 'ball' && g.children[0]) g.children[0].rotation.x = -(b.spin || 0);
    if (g.userData.cracks && b.hp) g.userData.cracks.material.opacity = Math.min(0.85, (b.dmg || 0) / b.hp * 0.9);
    if (!g.matrixAutoUpdate) g.updateMatrix();
  };

  // ---------------- connections ----------------
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function setLine(m, a, b) {
    _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
    _d.subVectors(_b, _a);
    const L = Math.max(0.01, _d.length());
    m.position.copy(_a).addScaledVector(_d, 0.5);
    m.quaternion.setFromUnitVectors(_up, _d.normalize());
    m.scale.y = L;
    return L;
  }
  V.setLine = setLine;
  V.makeConn = function (c) {
    const g = new THREE.Group();
    // every restraint the preservers added is copper: the same family as the glaze trim
    const mat = M.verdigris.clone();
    mat.emissive = new THREE.Color(PALETTE.unmake);
    mat.emissiveIntensity = 0;
    mat.userData.own = true;
    g.userData.mat = mat;
    const r = c.style === 'brace' ? 0.11 : c.style === 'chain' ? 0.07 : c.style === 'pin' ? 0.09 : 0.045;
    const line = new THREE.Mesh(c.style === 'brace' ? G.box : G.cyl6, mat);
    line.scale.set(r * (c.style === 'brace' ? 2 : 1), 1, r * (c.style === 'brace' ? 2 : 1));
    line.castShadow = true;
    g.add(line); g.userData.line = line;
    if (c.style === 'chain') {
      g.userData.links = [];
      for (let i = 0; i < 10; i++) { const l = new THREE.Mesh(G.torus, M.iron); l.scale.setScalar(0.11); l.castShadow = true; g.add(l); g.userData.links.push(l); }
    }
    if (c.style === 'cable') {
      // a tension marker: a small weight on a thread; it trembles when the cable strains
      const tag = new THREE.Group();
      const thread = new THREE.Mesh(G.cyl6, M.rope); thread.scale.set(0.01, 0.4, 0.01); thread.position.y = -0.2; tag.add(thread);
      const bob = new THREE.Mesh(G.cone, M.brass); bob.scale.set(0.07, 0.16, 0.07); bob.position.y = -0.46; bob.rotation.x = Math.PI; tag.add(bob);
      g.add(tag); g.userData.tag = tag;
    }
    if (c.style === 'pin') {
      const head = new THREE.Mesh(G.cyl, M.brass); head.scale.set(0.22, 0.12, 0.22); g.add(head); g.userData.head = head;
      const plate = new THREE.Mesh(box(0.6, 0.6, 0.1, 1), M.rust); g.add(plate); g.userData.plate = plate;
    }
    root.add(g);
    return g;
  };
  V.syncConn = function (P, c, g, t) {
    const [a, b] = P.connEnds(c);
    let jitter = 0;
    if (c.fray && c.fray.started) jitter = 0.06;
    const bb = jitter ? [b[0] + (Math.random() - 0.5) * jitter, b[1], b[2] + (Math.random() - 0.5) * jitter] : b;
    const L = setLine(g.userData.line, a, bb);
    if (g.userData.links) g.userData.links.forEach((l, i) => { const k = (i + 0.5) / g.userData.links.length; l.position.set(lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)); l.quaternion.copy(g.userData.line.quaternion); l.rotateY(i % 2 ? Math.PI / 2 : 0); });
    if (g.userData.tag) { const k = 0.38; g.userData.tag.position.set(lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)); g.userData.tag.rotation.z = Math.sin(t * (c.fray && c.fray.started ? 40 : 2) + c.id) * (c.fray && c.fray.started ? 0.3 : 0.05); }
    if (g.userData.head) { g.userData.head.position.set(b[0], b[1], b[2]); g.userData.head.quaternion.copy(g.userData.line.quaternion); g.userData.plate.position.set(a[0], a[1], a[2]); }
    void L;
  };

  // ---------------- pickups ----------------
  V.makePickup = function (p) {
    const g = new THREE.Group();
    if (p.kind === 'relic') {
      const seed = new THREE.Mesh(G.ico1, M.relic); seed.scale.set(0.2, 0.3, 0.2); g.add(seed);
      const ring = new THREE.Mesh(G.torus, M.brass); ring.scale.setScalar(0.32); ring.rotation.x = Math.PI / 2; g.add(ring);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.T.glow, color: '#ffc27a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(1.5); g.add(halo);
      g.userData.spin = seed; g.userData.ring = ring;
    } else {
      const cog = new THREE.Mesh(G.torus, M.salvage); cog.scale.setScalar(0.17); g.add(cog);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const t = new THREE.Mesh(G.box, M.salvage); t.scale.set(0.07, 0.07, 0.05); t.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); g.add(t); }
      g.userData.spin = g;
    }
    root.add(g);
    return g;
  };

  // ---------------- the traveller ----------------
  // A lantern-keeper's silhouette: broad pale hat, long slate mantle, ochre sash,
  // and the unmaking key slung across the back.
  V.makeTraveller = function () {
    const rootG = new THREE.Group();
    const body = new THREE.Group(); rootG.add(body);
    const limb = (len, r, m) => { const j = new THREE.Group(); const mm = new THREE.Mesh(G.cyl, m); mm.scale.set(r, len, r); mm.position.y = -len / 2; mm.castShadow = true; j.add(mm); return j; };
    const hips = new THREE.Group(); hips.position.y = 0.66; body.add(hips);
    const legs = [];
    for (const sx of [-1, 1]) {
      const thigh = limb(0.34, 0.062, M.legs); thigh.position.x = sx * 0.09; hips.add(thigh);
      const shin = limb(0.32, 0.052, M.legs); shin.position.y = -0.34; thigh.add(shin);
      const foot = new THREE.Mesh(G.box, M.mantleDark); foot.scale.set(0.1, 0.07, 0.22); foot.position.set(0, -0.33, -0.05); foot.castShadow = true; shin.add(foot);
      legs.push({ thigh, shin });
    }
    const torso = new THREE.Group(); torso.position.y = 0.66; body.add(torso);
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.34, 0.72, 14, 1, true), M.mantle);
    mantle.material = M.mantle; mantle.position.y = 0.28; mantle.castShadow = true; torso.add(mantle);
    const mantleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.32, 0.7, 14), M.mantleDark); mantleIn.position.y = 0.28; torso.add(mantleIn);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 16), M.sash); sash.rotation.x = Math.PI / 2; sash.position.y = 0.35; torso.add(sash);
    const tail = new THREE.Group(); tail.position.set(0.12, 0.35, 0.16); torso.add(tail);
    const tailM = new THREE.Mesh(G.box, M.sash); tailM.scale.set(0.08, 0.36, 0.02); tailM.position.y = -0.18; tail.add(tailM);
    const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
    const face = new THREE.Mesh(G.sphere, M.mask); face.scale.setScalar(0.125); face.castShadow = true; head.add(face);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.03, 20), M.hat); brim.position.y = 0.08; brim.castShadow = true; head.add(brim);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 16), M.hat); crown.position.y = 0.19; crown.castShadow = true; head.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.04, 16), M.sash); band.position.y = 0.11; head.add(band);
    const eye = new THREE.Mesh(G.box, M.legs); eye.scale.set(0.11, 0.016, 0.01); eye.position.set(0, 0.0, -0.122); head.add(eye);
    const arms = [];
    for (const sx of [-1, 1]) {
      const arm = limb(0.38, 0.042, M.mantle); arm.position.set(sx * 0.16, 0.56, 0); torso.add(arm);
      const hand = new THREE.Mesh(G.sphereLo, M.mask); hand.scale.setScalar(0.045); hand.position.y = -0.39; arm.add(hand);
      arms.push(arm);
    }
    // the key, slung diagonally across the back
    const key = new THREE.Group(); key.position.set(0, 0.42, 0.2); key.rotation.z = 0.7; torso.add(key);
    const keyRod = new THREE.Mesh(G.cyl6, M.brass); keyRod.scale.set(0.02, 0.8, 0.02); key.add(keyRod);
    const keyTip = new THREE.Mesh(G.ico, M.key); keyTip.scale.set(0.05, 0.09, 0.05); keyTip.position.y = 0.42; key.add(keyTip);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ map: A.T.glow, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; rootG.add(blob);
    scene.add(rootG);
    const st = { phase: 0, squash: 0, lean: 0, roll: 0, yaw: 0, air: 0, fall: 0, balance: 0, idle: 0, prevSin: 0, reach: 0 };
    return {
      root: rootG, blob, key, keyTip, head,
      update(dt, p, info) {
        const speed = Math.hypot(p.vel[0], p.vel[2]);
        const grounded = p.grounded;
        const r = clamp(speed / MOVE.cruise, 0, 1.4);
        if (grounded) st.phase += speed * dt / 1.35;
        const ph = st.phase * TAU, sn = Math.sin(ph);
        if (grounded && speed > 0.8 && Math.sign(sn) !== Math.sign(st.prevSin) && info.onStep) info.onStep(r);
        st.prevSin = sn;
        st.air = damp(st.air, grounded ? 0 : 1, 12, dt);
        st.fall = damp(st.fall, !grounded && p.vel[1] < -6 ? 1 : 0, 6, dt);
        st.squash = damp(st.squash, 0, 10, dt);
        st.balance = damp(st.balance, info.narrow ? 1 : 0, 6, dt);
        st.reach = damp(st.reach, info.reach ? 1 : 0, 14, dt);
        st.lean = damp(st.lean, clamp(0.08 * r + info.accel * 0.03, -0.3, 0.32), 8, dt);
        let turn = 0;
        if (speed > 0.4) { turn = wrapAngle(Math.atan2(-p.vel[0], -p.vel[2]) - st.yaw); st.yaw = wrapAngle(st.yaw + turn * (1 - Math.exp(-10 * dt))); }
        st.roll = damp(st.roll, clamp(-turn * speed * 0.08, -0.3, 0.3), 9, dt);
        st.idle += dt;
        const run = grounded ? r : 0;
        for (let i = 0; i < 2; i++) {
          const sw = Math.sin(ph + (i ? Math.PI : 0));
          const knee = (0.15 + 0.95 * Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 1.3))) * run;
          legs[i].thigh.rotation.x = lerp(sw * 0.85 * run, -0.75 - 0.2 * (i ? 1 : -1), st.air);
          legs[i].shin.rotation.x = lerp(knee, 1.1, st.air * (1 - st.fall * 0.6));
          const armSwing = -sw * 0.7 * run;
          arms[i].rotation.x = lerp(lerp(armSwing, -0.5, st.air), -1.4, i === 1 ? st.reach : 0);
          arms[i].rotation.z = (i ? -1 : 1) * (0.12 + st.balance * 1.1 + st.fall * 1.2 + Math.sin(st.idle * 7 + i) * 0.1 * st.balance);
        }
        const bob = grounded ? Math.abs(Math.sin(ph)) * 0.05 * r + Math.sin(st.idle * 2) * 0.008 * (1 - r) : 0;
        body.position.y = bob - st.squash * 0.14;
        body.scale.set(1 + st.squash * 0.12, 1 - st.squash * 0.2, 1 + st.squash * 0.12);
        body.rotation.set(-st.lean + st.fall * 0.25, st.yaw, st.roll + Math.sin(st.idle * 6) * 0.05 * st.balance + (p.stagger > 0 ? Math.sin(st.idle * 30) * 0.15 : 0));
        tail.rotation.x = 0.2 + clamp(speed * 0.1, 0, 0.9) + st.air * 0.5 + Math.sin(st.idle * 9) * 0.08 * r;
        mantle.scale.set(1 + st.air * 0.1, 1, 1 + st.air * 0.1 + clamp(speed * 0.02, 0, 0.15));
        head.rotation.x = st.lean * 0.4 - st.fall * 0.3;
        rootG.position.set(p.pos[0], p.pos[1], p.pos[2]);
        // contact shadow sits on whatever is under us
        blob.position.y = (info.groundY !== undefined ? info.groundY - p.pos[1] : 0) + 0.02;
        blob.material.opacity = 0.35 * clamp(1 - (p.pos[1] - (info.groundY !== undefined ? info.groundY : p.pos[1])) / 6, 0, 1);
      },
      land(impact) { st.squash = clamp(impact / 16, 0.12, 1); },
      takeoff() { st.squash = 0.35; }
    };
  };

  // ---------------- first-person hand ----------------
  V.makeHand = function (camera) {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(G.cyl, M.mantle); arm.scale.set(0.045, 0.42, 0.045); arm.rotation.x = -1.2; arm.position.set(0, -0.05, 0.1); g.add(arm);
    const hand = new THREE.Mesh(G.sphereLo, M.mask); hand.scale.set(0.05, 0.045, 0.06); hand.position.set(0, 0.06, -0.12); g.add(hand);
    const rod = new THREE.Mesh(G.cyl6, M.brass); rod.scale.set(0.012, 0.32, 0.012); rod.rotation.x = -1.35; rod.position.set(0, 0.09, -0.26); g.add(rod);
    const tip = new THREE.Mesh(G.ico, M.key); tip.scale.set(0.03, 0.05, 0.03); tip.position.set(0, 0.13, -0.42); g.add(tip);
    g.position.set(0.2, -0.24, -0.5);
    g.scale.setScalar(0.62);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
    camera.add(g);
    g.visible = false;
    return { g, tip, rest: g.position.clone() };
  };

  // ---------------- particles ----------------
  const NP = 700;
  const pg = new THREE.BufferGeometry();
  const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pSize = new Float32Array(NP), pA = new Float32Array(NP);
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pg.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pg.setAttribute('alpha', new THREE.BufferAttribute(pA, 1));
  const pm = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 300 }, map: { value: A.T.glow } },
    vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }',
    transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; scene.add(pts);
  V.pmat = pm;
  const parts = []; for (let i = 0; i < NP; i++) parts.push({ life: 0 });
  let cur = 0; const tc = new THREE.Color();
  V.spawn = function (p, n, o) {
    for (let k = 0; k < n; k++) {
      const q = parts[cur]; cur = (cur + 1) % NP;
      q.life = q.max = (o.life || 1) * (0.6 + Math.random() * 0.6);
      q.x = p[0] + (Math.random() - 0.5) * (o.sx || 0.6); q.y = p[1] + (Math.random() - 0.5) * (o.sy || 0.6); q.z = p[2] + (Math.random() - 0.5) * (o.sz || 0.6);
      const sp = o.speed || 1;
      q.vx = (Math.random() - 0.5) * sp + (o.vx || 0); q.vy = (Math.random() - 0.2) * sp + (o.vy || 0); q.vz = (Math.random() - 0.5) * sp + (o.vz || 0);
      q.g = o.g === undefined ? -2 : o.g; q.drag = o.drag || 1.5; q.size = (o.size || 0.3) * (0.6 + Math.random() * 0.8); q.grow = o.grow || 0;
      tc.set(o.color || '#e2d6c0'); q.r = tc.r; q.gg = tc.g; q.b = tc.b; q.a = o.alpha || 0.8;
    }
  };
  // cosmetic debris (never collides)
  const chunks = [];
  for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(G.ico, M.stone); m.visible = false; m.castShadow = true; scene.add(m); chunks.push({ m, life: 0 }); }
  let cc = 0;
  V.debris = function (p, n, mat, size, spread) {
    for (let k = 0; k < n; k++) {
      const c = chunks[cc]; cc = (cc + 1) % chunks.length;
      c.m.material = mat || M.stone; c.m.visible = true; c.life = 1.0 + Math.random() * 0.6;
      c.m.position.set(p[0] + (Math.random() - 0.5) * spread, p[1] + (Math.random() - 0.5) * spread, p[2] + (Math.random() - 0.5) * spread);
      c.s = (size || 0.2) * (0.5 + Math.random()); c.m.scale.setScalar(c.s);
      c.vx = (Math.random() - 0.5) * 5; c.vy = 1 + Math.random() * 4; c.vz = (Math.random() - 0.5) * 5;
    }
  };
  V.updateFx = function (dt) {
    for (let i = 0; i < NP; i++) {
      const q = parts[i];
      if (q.life > 0) {
        q.life -= dt; q.vy += q.g * dt; const dr = Math.exp(-q.drag * dt);
        q.vx *= dr; q.vy *= dr; q.vz *= dr; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.size += q.grow * dt;
        const k = Math.max(0, q.life / q.max);
        pPos[i * 3] = q.x; pPos[i * 3 + 1] = q.y; pPos[i * 3 + 2] = q.z;
        pCol[i * 3] = q.r; pCol[i * 3 + 1] = q.gg; pCol[i * 3 + 2] = q.b;
        pSize[i] = q.size; pA[i] = q.a * Math.min(1, k * 2.5);
      } else { pA[i] = 0; pSize[i] = 0; }
    }
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true; pg.attributes.size.needsUpdate = true; pg.attributes.alpha.needsUpdate = true;
    for (const c of chunks) {
      if (c.life <= 0) continue;
      c.life -= dt; c.vy -= 20 * dt;
      c.m.position.x += c.vx * dt; c.m.position.y += c.vy * dt; c.m.position.z += c.vz * dt;
      c.m.rotation.x += dt * 5; c.m.rotation.z += dt * 4;
      if (c.life < 0.4) c.m.scale.setScalar(c.s * Math.max(0.01, c.life / 0.4));
      if (c.life <= 0) c.m.visible = false;
    }
  };

  // ---------------- the exact region: chalk outlines ----------------
  // A pool of 12-edge box outlines drawn as thin boxes (lines stay legible at
  // any pixel ratio). Thickness follows camera distance so they read evenly.
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.unmake, transparent: true, depthWrite: false, fog: false });
  const EDGES = [];
  for (const a of [0, 1, 2]) { const o = [(a + 1) % 3, (a + 2) % 3]; for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) EDGES.push({ a, o, s1, s2 }); }
  const pool = [];
  function makeOutline() {
    const g = new THREE.Group(); const mat = lineMat.clone(); g.userData.mat = mat;
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(G.box, mat); m.renderOrder = 5; g.add(m); }
    g.visible = false; scene.add(g); return g;
  }
  let used = 0;
  V.beginOutlines = function () { used = 0; };
  V.outline = function (pos, rot, size, col, alpha, px, camPos, xray) {
    if (used >= pool.length) pool.push(makeOutline());
    const g = pool[used++];
    g.visible = true; g.position.set(pos[0], pos[1], pos[2]); g.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
    g.userData.mat.color.set(col); g.userData.mat.opacity = alpha; g.userData.mat.depthTest = !xray;
    const d = camPos ? camPos.distanceTo(g.position) : 10;
    const t = Math.max(0.012, d * (px || 0.0035));
    const h = [size[0] + t * 0.5, size[1] + t * 0.5, size[2] + t * 0.5];
    EDGES.forEach((e, i) => {
      const m = g.children[i]; const sc = [t, t, t]; sc[e.a] = h[e.a] * 2 + t; m.scale.set(sc[0], sc[1], sc[2]);
      const p = [0, 0, 0]; p[e.o[0]] = e.s1 * h[e.o[0]]; p[e.o[1]] = e.s2 * h[e.o[1]]; m.position.set(p[0], p[1], p[2]);
    });
  };
  V.endOutlines = function () { for (let i = used; i < pool.length; i++) pool[i].visible = false; };

  // ---------------- unmaking: the body's view becomes a ghost ----------------
  const ghosts = [];
  V.unmake = function (g, b, origin) {
    const m = g.userData.glaze;
    if (m) {
      const lp = new THREE.Vector3(origin[0], origin[1], origin[2]).applyMatrix4(m.userData.u.uInv.value);
      m.userData.u.uOrigin.value.copy(lp);
      const far = Math.max(...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => Math.hypot(x * b.size[0] - lp.x, y * b.size[1] - lp.y, z * b.size[2] - lp.z)))));
      m.userData.u.uRad.value = far;
      m.userData.u.uFocus.value = 0;
    }
    ghosts.push({ g, b: { pos: b.pos.slice(), rot: b.rot.slice(), size: b.size.slice() }, t: 0 });
  };
  V.unmakeConn = function (g) { ghosts.push({ g, conn: true, t: 0 }); };
  const WIPE = 0.34, LINGER = 1.0;
  V.updateGhosts = function (dt, camPos) {
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const q = ghosts[i]; q.t += dt;
      if (q.conn) {
        const k = Math.min(1, q.t / WIPE), mat = q.g.userData.mat, line = q.g.userData.line;
        mat.emissiveIntensity = 2.0 * (1 - k); line.scale.x = line.scale.z = Math.max(0.001, line.scale.x * (1 - k * 0.5));
        q.g.traverse(o => { if (o.isMesh && o !== line) o.visible = k < 0.5; });
        if (q.t > WIPE) { V.dispose(q.g); ghosts.splice(i, 1); }
        continue;
      }
      const m = q.g.userData.glaze;
      if (m) m.userData.u.uWipe.value = Math.min(1.01, smooth(Math.min(1, q.t / WIPE)) * 1.01);
      if (q.t > WIPE && q.g.parent) { V.dispose(q.g); }
      // the plan of what was there lingers, then is gone
      let a = q.t < WIPE ? 0.9 : 0.9 * (1 - (q.t - WIPE) / LINGER);
      if (camPos) a *= clamp((camPos.distanceTo(_p4.set(q.b.pos[0], q.b.pos[1], q.b.pos[2])) - 3) / 4, 0, 1);
      if (a > 0) V.outline(q.b.pos, q.b.rot, q.b.size, PALETTE.unmake, a, 0.0026, camPos);
      if (q.t > WIPE + LINGER) ghosts.splice(i, 1);
    }
  };
  V.clearGhosts = function () { for (const q of ghosts) V.dispose(q.g); ghosts.length = 0; };

  V.dispose = function (g) {
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.traverse(o => {
      if (o.isMesh || o.isSprite) {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m && m !== M.crackOverlay && ((m.userData && m.userData.own) || o.isSprite)) m.dispose();
      }
    });
  };
  return V;
}

// ---- 06_world.js ----
// =====================================================================
// The basin: route decor that explains each mechanism, the streamed
// backdrop of the city, and the sanctuary.
// =====================================================================

function createWorld(THREE, A, scene) {
  const W = {};
  const { M, G, box, mat, merge } = A;

  // ---------------- route decor (explains what holds what) ----------------
  function partsMesh(list, m) { const me = new THREE.Mesh(merge(list), m); me.castShadow = true; me.receiveShadow = true; return me; }
  function frameTower(P, x, y0, z, h, w) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.rust.push({ geo: G.box, m: mat(x + sx * w / 2, y0 + h / 2, z + sz * w / 2, 0, 0, 0, 0.16, h, 0.16) });
    for (let y = y0 + 1.5; y < y0 + h; y += 2.0) {
      P.rust.push({ geo: G.box, m: mat(x, y, z - w / 2, 0, 0, 0, w, 0.1, 0.1) }); P.rust.push({ geo: G.box, m: mat(x, y, z + w / 2, 0, 0, 0, w, 0.1, 0.1) });
      P.rust.push({ geo: G.box, m: mat(x - w / 2, y, z, 0, 0, 0, 0.1, 0.1, w) }); P.rust.push({ geo: G.box, m: mat(x + w / 2, y, z, 0, 0, 0, 0.1, 0.1, w) });
      P.rust.push({ geo: G.box, m: mat(x, y - 1, z + w / 2, 0, 0, Math.atan2(2, w), Math.hypot(w, 2), 0.07, 0.07) });
    }
    P.rust.push({ geo: G.box, m: mat(x, y0 - 9, z, 0, 0, 0, w + 0.3, 18, w + 0.3) });
  }
  const DECOR = {
    tensionTower(d, P) {
      const [x, y, z] = d.at;
      frameTower(P, x, y - 0.2, z - 0.8, d.h + 1, 1.3);
      P.rust.push({ geo: G.box, m: mat(x, y + d.h, z - 0.2, 0, 0, 0, 1.8, 0.3, 1.8) });
      P.verd.push({ geo: G.cyl, m: mat(x, y + d.h, z, 0, 0, Math.PI / 2, 0.38, 0.4, 0.38) });
      // the counterweight that keeps the bridge cable taut
      P.rust.push({ geo: G.box, m: mat(x + 0.9, y + d.h - 3.2, z - 0.8, 0, 0, 0, 0.8, 1.2, 0.8) });
      P.rope.push({ geo: G.cyl6, m: mat(x + 0.9, y + d.h - 1.3, z - 0.8, 0, 0, 0, 0.04, 2.6, 0.04) });
    },
    rootClamp(d, P) {
      const [x, y, z] = d.at;
      P.rust.push({ geo: G.torus, m: mat(x, y - 0.2, z, 0, 0, 0, 0.62, 0.62, 1.6) });
      P.rust.push({ geo: G.box, m: mat(x + 0.75, y - 1.4, z, 0, 0, 0, 0.18, 2.6, 0.18) });
      P.verd.push({ geo: G.cyl, m: mat(x + 0.6, y - 0.2, z, 0, 0, Math.PI / 2, 0.1, 0.4, 0.1) });
    },
    pivotFrame(d, P) {
      const [x, y, z] = d.at;
      for (const sx of [-1, 1]) {
        P.rust.push({ geo: G.box, m: mat(x + sx * 2.0, y - 2.6, z + 0.9, 0.35, 0, 0, 0.22, 5.4, 0.22) });
        P.rust.push({ geo: G.box, m: mat(x + sx * 2.0, y - 2.6, z - 0.9, -0.35, 0, 0, 0.22, 5.4, 0.22) });
      }
      P.verd.push({ geo: G.cyl, m: mat(x, y - 0.35, z, 0, 0, Math.PI / 2, 0.22, 4.4, 0.22) });
    },
    gantry(d, P) {
      const [x, y, z] = d.at;
      if (d.across) {
        for (const sx of [-1, 1]) frameTower(P, x + sx * 7.6, y - 8, z, d.h + 8.2, 1.0);
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 15.6, 0.55, 0.7) });
        P.verd.push({ geo: G.cyl, m: mat(x, y + d.h, z, Math.PI / 2, 0, 0, 0.3, 0.8, 0.3) });
      } else {
        for (const sx of [-1, 1]) frameTower(P, x + sx * 3.4, y - 8, z, d.h + 8.2, 1.0);
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 7.6, 0.5, 0.6) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z + d.span / 2, 0, 0, 0, 1.0, 0.4, 0.4) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z - d.span / 2, 0, 0, 0, 1.0, 0.4, 0.4) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 0.5, 0.35, d.span + 1.0) });
      }
    },
    restraintFrame(d, P) {
      const [x, y, z] = d.at;
      // the clamp that holds a living root up out of the way
      for (const sx of [-1, 1]) {
        P.rust.push({ geo: G.box, m: mat(x + sx * 1.6, y + d.h / 2 - 2, z, 0, 0, 0, 0.35, d.h + 4, 0.5) });
        P.rust.push({ geo: G.box, m: mat(x + sx * 1.6, y - 4.5, z, 0, 0, 0, 0.7, 5, 0.9) });
      }
      P.rust.push({ geo: G.box, m: mat(x, y + d.h, z, 0, 0, 0, 3.7, 0.45, 0.7) });
      P.verd.push({ geo: G.torus, m: mat(x, y + d.h - 0.4, z - 0.3, Math.PI / 2, 0, 0, 0.55, 0.55, 0.55) });
    },
    casketWell(d, P) {
      const [x, y, z] = d.at;
      P.stone.push({ geo: G.cyl, m: mat(x, y - 1.1, z, 0, 0, 0, 0.85, 2.2, 0.85) });
      P.pig.push({ geo: G.cyl, m: mat(x, y + 0.02, z, 0, 0, 0, 0.9, 0.06, 0.9) });
    },
    reservoir(d, P) {
      const [x, y, z] = d.at;
      frameTower(P, x, y - 10, z, 16, 3.4);
      P.rust.push({ geo: G.cyl, m: mat(x, y + 3, z, 0, 0, 0, 2.6, 4.2, 2.6) });
      P.verd.push({ geo: G.torus, m: mat(x, y + 1.2, z, Math.PI / 2, 0, 0, 2.62, 2.62, 1) });
      P.verd.push({ geo: G.torus, m: mat(x, y + 4.8, z, Math.PI / 2, 0, 0, 2.62, 2.62, 1) });
      P.rust.push({ geo: G.box, m: mat(x + 2.2, y - 1.5, z, 0, 0, 0.4, 2.4, 0.5, 0.6) });
    },
    liftFrame(d, P) {
      const [x, y, z] = d.at;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.rust.push({ geo: G.box, m: mat(x + sx * 1.5, y + d.h / 2 - 3, z + sz * 1.6, 0, 0, 0, 0.16, d.h + 6, 0.16) });
      P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.2, z, 0, 0, 0, 3.4, 0.4, 3.6) });
      P.verd.push({ geo: G.cyl, m: mat(x - 1.7, y + d.h + 0.3, z, Math.PI / 2, 0, 0, 0.5, 0.5, 0.5) });
      // the counterweight it trades height with
      P.rust.push({ geo: G.box, m: mat(x - 2.6, y + d.h - 1.6, z, 0, 0, 0, 0.9, 1.6, 0.9) });
      P.rope.push({ geo: G.cyl6, m: mat(x - 2.6, y + d.h - 0.3, z, 0, 0, 0, 0.04, 1.2, 0.04) });
    },
    dwellings(d, P, rng) {
      const [x, y, z] = d.at;
      // the first settlement grows down the basin wall beside the route
      const n = Math.max(2, Math.floor(d.len / 5));
      for (let i = 0; i < n; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        const xx = x + side * (5.5 + rng() * 4), zz = z + (i - n / 2) * (d.len / n) + rng() * 2;
        const top = y - 1 - rng() * 4, w = 2 + rng() * 2, h = 2.4 + rng() * 2, dd = 2 + rng() * 2;
        P.plaster.push({ geo: box(w, h + 8, dd, 2.4), m: mat(xx, top - h / 2 - 4 + h / 2 - 0.0, zz, 0, rng() * 0.3, 0), c: rng() < 0.5 ? '#e0cdb0' : '#cdb699' });
        P.cav.push({ geo: G.box, m: mat(xx - side * w / 2, top - h + 1.0, zz, 0, 0, 0, 0.08, 1.4, 0.7), c: '#2a2629' });
        P.ceram.push({ geo: G.dome, m: mat(xx, top + 4 - 0.0, zz, 0, 0, 0, w * 0.45, 0.45, dd * 0.45), c: '#ded2bd' });
        P.pig.push({ geo: G.box, m: mat(xx, top + 3.2, zz, 0, 0, 0, w + 0.06, 0.18, dd + 0.06) });
        if (rng() < 0.6) P.leaf.push({ geo: G.ico, m: mat(xx + side * 0.4, top + 4.2, zz + 0.3, 0, rng() * 3, 0, 0.6, 0.5, 0.6), c: rng() < 0.5 ? '#6f7b57' : '#5a6f58' });
      }
    }
  };
  W.buildDecor = function (list, seed) {
    const P = { rust: [], verd: [], rope: [], stone: [], plaster: [], cav: [], ceram: [], pig: [], leaf: [] };
    const rng = makeRng(seed);
    for (const d of list) if (DECOR[d.type]) DECOR[d.type](d, P, rng);
    const g = new THREE.Group();
    const add = (l, m) => { if (l.length) g.add(partsMesh(l, m)); };
    add(P.rust, M.vcRust); add(P.verd, M.verdigris); add(P.rope, M.rope); add(P.stone, M.vcStone); add(P.plaster, M.vcPlaster); add(P.cav, M.cavity); add(P.ceram, M.ceramic); add(P.pig, M.pigment); add(P.leaf, M.vcFlat);
    scene.add(g);
    return g;
  };

  // ---------------- the backdrop: the basin ----------------
  const back = new THREE.Group(); scene.add(back);
  const CH = 60, chunks = new Map();
  const cliffCols = ['#b9ad9a', '#a89c88', '#c4b7a2', '#9d9081'];
  function cliff(P, rng, side, z0) {
    // stepped mineral walls with the first settlement clinging to the contours
    const base = side * (46 + rng() * 10);
    for (let i = 0; i < 4; i++) {
      const z = z0 - i * CH / 4 - rng() * 6;
      const top = 8 + rng() * 26, w = 18 + rng() * 14;
      P.stone.push({ geo: box(w, top + 70, CH / 4 + 4, 8), m: mat(base + side * w / 2, top / 2 - 35, z, 0, 0, 0), c: cliffCols[Math.floor(rng() * 4)] });
      // terraces of dwellings stepping down the face
      for (let k = 0; k < 6; k++) {
        const ty = top - 4 - k * 5.5 - rng() * 2;
        const tx = base - side * (1.5 + k * 1.2 + rng() * 1.5);
        const n = 2 + Math.floor(rng() * 3);
        for (let j = 0; j < n; j++) {
          const zz = z + (j - n / 2) * 4 + rng() * 2;
          const hw = 1.2 + rng() * 1.2, hh = 1.8 + rng() * 1.6;
          P.plaster.push({ geo: box(hw * 2, hh * 2, 3, 2.4), m: mat(tx, ty + hh, zz, 0, (rng() - 0.5) * 0.4, 0), c: rng() < 0.5 ? '#ddc9ab' : '#cfb89a' });
          P.cav.push({ geo: G.box, m: mat(tx - side * hw, ty + 1.2, zz, 0, 0, 0, 0.1, 1.6, 0.9), c: '#29252a' });
          if (rng() < 0.5) P.ceram.push({ geo: G.dome, m: mat(tx, ty + hh * 2, zz, 0, 0, 0, hw * 0.9, 0.7, 1.4), c: '#e2d6c2' });
          if (rng() < 0.35) P.leaf.push({ geo: G.ico, m: mat(tx - side * hw, ty + hh * 2 + 0.3, zz + 1, 0, rng() * 3, 0, 1, 0.8, 1), c: rng() < 0.5 ? '#68765a' : '#596c5a' });
        }
        P.pig.push({ geo: G.box, m: mat(tx + side * 1.5, ty - 0.2, z, 0, 0, 0, 3, 0.3, CH / 4), c: '#7c3526' });
      }
      // waterline scars across the cliff: where the basin once held water
      for (const wl of [-6, -14]) P.scar.push({ geo: G.box, m: mat(base - side * 0.2, wl, z, 0, 0, 0, 0.3, 0.6, CH / 4 + 4), c: '#efe8d8' });
    }
  }
  function bigFrame(P, rng, x, z) {
    const h = 70 + rng() * 30, w = 6 + rng() * 3;
    frameTower({ rust: P.rust }, x, -70, z, h, w);
    // hanging counterweights and the cables that tie the city together
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const cy = -70 + h - 12 - rng() * 20;
      P.rust.push({ geo: G.box, m: mat(x + (rng() - 0.5) * w, cy, z + w * 0.9, 0, 0, 0, 3, 4.5, 3) });
      P.rope.push({ geo: G.cyl6, m: mat(x + (rng() - 0.5) * w, cy + (h - 70 - cy) / 2 + 2, z + w * 0.9, 0, 0, 0, 0.12, (-70 + h - cy), 0.12) });
    }
    return [x, -70 + h, z];
  }
  function giantRoot(P, rng, z, y) {
    // a root as thick as a building, arching across the basin, clamped
    const side = rng() < 0.5 ? -1 : 1;
    const x0 = side * (60 + rng() * 10), x1 = -side * (55 + rng() * 15);
    const pts = [[x0, y - 20, z + 10], [x0 * 0.5, y + 2 + rng() * 6, z + rng() * 10], [x1 * 0.4, y + rng() * 5, z - 8], [x1, y - 25, z - 18]];
    const r = 2.6 + rng() * 2;
    P.roots.push({ geo: A.rootGeo(pts, r, r * 0.7, 36) });
    // restraint collars and their tethers
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    for (const t of [0.3, 0.55, 0.78]) {
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(r * 1.25, r * 1.25, 4));
      P.rust.push({ geo: G.torus, m });
      P.rope.push({ geo: G.cyl6, m: mat(p.x, p.y + 16, p.z, 0, 0, 0, 0.14, 32, 0.14) });
    }
  }
  function reservoir(P, rng, x, z, y) {
    P.rust.push({ geo: G.cyl, m: mat(x, y, z, 0, 0, 0, 5, 7, 5) });
    P.verd.push({ geo: G.torus, m: mat(x, y - 2.5, z, Math.PI / 2, 0, 0, 5.05, 5.05, 2) });
    P.verd.push({ geo: G.torus, m: mat(x, y + 2.5, z, Math.PI / 2, 0, 0, 5.05, 5.05, 2) });
    for (const sx of [-1, 1]) P.rope.push({ geo: G.cyl6, m: mat(x + sx * 4, y + 18, z, 0, 0, sx * 0.15, 0.15, 30, 0.15) });
    P.water.push({ geo: G.cyl6, m: mat(x + 5.2, y - 22, z, 0, 0, 0, 0.35, 40, 0.35) });
  }
  function buildChunk(k, baseY) {
    const rng = makeRng(424242 + k * 977);
    const P = { stone: [], plaster: [], cav: [], ceram: [], pig: [], leaf: [], rust: [], verd: [], rope: [], roots: [], scar: [], water: [] };
    const z0 = -k * CH;
    cliff(P, rng, -1, z0);
    cliff(P, rng, 1, z0);
    // one preservation frame per stretch, kept back from the route so the stone reads first
    if (rng() < 0.7) bigFrame(P, rng, (rng() < 0.5 ? -1 : 1) * (26 + rng() * 18), z0 - rng() * CH);
    if (rng() < 0.75) giantRoot(P, rng, z0 - rng() * CH, 20 + rng() * 16);
    if (rng() < 0.5) reservoir(P, rng, (rng() < 0.5 ? -1 : 1) * (22 + rng() * 14), z0 - rng() * CH, 6 + rng() * 12);
    // the lower city deep in the basin
    for (let i = 0; i < 10; i++) {
      const x = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 34), z = z0 - rng() * CH, y = -26 - rng() * 14;
      P.plaster.push({ geo: box(3 + rng() * 5, 24, 3 + rng() * 5, 3), m: mat(x, y - 12, z, 0, rng(), 0), c: rng() < 0.5 ? '#c7b39a' : '#b9a68c' });
      if (rng() < 0.5) P.leaf.push({ geo: G.ico, m: mat(x, y + 0.6, z, 0, 0, 0, 2, 1.4, 2), c: '#5f6e55' });
    }
    const g = new THREE.Group();
    const add = (l, m) => { if (l.length) { const me = new THREE.Mesh(merge(l), m); me.receiveShadow = false; g.add(me); } };
    add(P.stone, M.vcStone); add(P.plaster, M.vcPlaster); add(P.cav, M.cavity); add(P.ceram, M.ceramic); add(P.pig, M.pigment); add(P.leaf, M.vcFlat);
    add(P.rust, M.vcRust); add(P.verd, M.verdigris); add(P.rope, M.rope); add(P.roots, M.bark); add(P.scar, M.vcPlaster); add(P.water, M.water);
    g.position.y = baseY;
    back.add(g);
    return g;
  }
  // the mother trunk: the oldest living thing, girdled by generations of restraints
  const trunk = new THREE.Group();
  {
    const P = { rust: [], roots: [] };
    P.roots.push({ geo: A.rootGeo([[0, -120, 0], [6, -40, 10], [-4, 40, -6], [3, 120, 4]], 30, 22, 30) });
    for (let i = 0; i < 9; i++) P.rust.push({ geo: G.torus, m: mat(Math.sin(i) * 3, -60 + i * 18, 0, Math.PI / 2, 0, 0, 33 - i * 0.6, 33 - i * 0.6, 14) });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; P.roots.push({ geo: A.rootGeo([[Math.cos(a) * 28, 60, Math.sin(a) * 28], [Math.cos(a) * 70, 95, Math.sin(a) * 70], [Math.cos(a) * 120, 80, Math.sin(a) * 120]], 8, 3, 16) }); }
    trunk.add(new THREE.Mesh(merge(P.roots), M.bark));
    trunk.add(new THREE.Mesh(merge(P.rust), M.vcRust));
    scene.add(trunk);
  }
  // mist layers in the basin
  const mists = [];
  for (const [y, s, op] of [[-14, 4, 0.5], [-30, 6, 0.7]]) {
    const t = A.T.mist.clone(); t.needsUpdate = true; t.repeat.set(s, s);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: t, color: '#d9c7b4', transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 2;
    scene.add(m); mists.push({ m, t, s, y });
  }
  W.update = function (pz, py, t) {
    const k0 = Math.floor(-(pz + 60) / CH) - 0, k1 = Math.floor(-(pz - 260) / CH);
    for (let k = k0; k <= k1; k++) if (!chunks.has(k)) chunks.set(k, buildChunk(k, Math.round(py)));
    for (const [k, g] of chunks) if (k < k0 - 1 || k > k1 + 1) { back.remove(g); g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); chunks.delete(k); }
    trunk.position.set(-30, py - 10, pz - 420);
    for (const mi of mists) { mi.m.position.set(0, py + mi.y, pz - 60); mi.t.offset.set(t * 0.004, (-pz + 60) / 420 * mi.s); }
  };
  W.setVisible = v => { back.visible = v; trunk.visible = v; for (const mi of mists) mi.m.visible = v; };
  W.reset = function () { for (const [, g] of chunks) { back.remove(g); g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); } chunks.clear(); };
  return W;
}

// =====================================================================
// The sanctuary: a hollow among roots around a young tree. Each
// restoration removes a constraint and lets something return.
// =====================================================================
const RESTORATIONS = [
  { id: 'clamp', name: 'Unclamp the sapling', cost: 25 },
  { id: 'water', name: 'Open the water channel', cost: 70 },
  { id: 'roots', name: 'Let the roots spread', cost: 140 },
  { id: 'green', name: 'Let the green return', cost: 230 },
  { id: 'shelter', name: 'Raise a shelter for travellers', cost: 350 },
  { id: 'aqueduct', name: 'Reconnect the old aqueduct', cost: 520 }
];

function createSanctuary(THREE, A, scene) {
  const S = {};
  const { M, G, box } = A;
  const g = new THREE.Group(); g.position.set(0, 0, 600); scene.add(g);
  S.center = new THREE.Vector3(0, 0, 600);
  const add = (geo, m, x, y, z, sx, sy, sz, rx, ry, rz, parent) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.scale.set(sx, sy, sz); me.rotation.set(rx || 0, ry || 0, rz || 0); me.castShadow = true; me.receiveShadow = true; (parent || g).add(me); return me; };
  const rng = makeRng(8);
  // the hollow: a ring of roots around a flagstone floor, on a mineral outcrop
  add(new THREE.CylinderGeometry(9.5, 7, 26, 9), M.stoneDark, 0, -13.2, 0, 1, 1, 1);
  add(new THREE.CylinderGeometry(9.2, 9.2, 0.4, 9), M.flag, 0, -0.2, 0, 1, 1, 1);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + 0.3; add(A.rootGeo([[Math.cos(a) * 12, -6, Math.sin(a) * 12], [Math.cos(a) * 9.5, 1.6, Math.sin(a) * 9.5], [Math.cos(a + 0.5) * 9, 0.4, Math.sin(a + 0.5) * 9], [Math.cos(a + 0.9) * 11, -4, Math.sin(a + 0.9) * 11]], 0.9, 0.5, 20), M.bark, 0, 0, 0, 1, 1, 1); }
  const broken = [];
  for (let i = 0; i < 10; i++) broken.push(add(G.ico, M.stone, (rng() - 0.5) * 12, 0.2, (rng() - 0.5) * 12, 0.4, 0.3, 0.4));
  // the dry channel crossing the floor
  add(box(1.2, 0.1, 16, 2), M.cavity, 0, 0.02, 0, 1, 1, 1, 0, 0.5, 0);
  const water = add(box(1.0, 0.06, 15.6, 2), M.water, 0, 0.08, 0, 1, 1, 1, 0, 0.5, 0);
  // the sapling and its clamp
  const tree = new THREE.Group(); tree.position.set(2.4, 0, -1.2); g.add(tree);
  const trunk = add(A.rootGeo([[0, -0.3, 0], [0.1, 1.2, 0.05], [-0.1, 2.6, 0.1], [0.05, 3.8, 0]], 0.18, 0.08, 16), M.bark, 0, 0, 0, 1, 1, 1, 0, 0, 0, tree);
  const clamp = add(G.torus, M.rust, 0, 1.4, 0, 0.32, 0.32, 0.5, Math.PI / 2, 0, 0, tree);
  const stakes = [add(G.box, M.rust, 0.6, 1.0, 0, 0.08, 2.0, 0.08, 0, 0, 0.3, tree), add(G.box, M.rust, -0.6, 1.0, 0, 0.08, 2.0, 0.08, 0, 0, -0.3, tree)];
  const crown = add(G.ico1, M.leaf, 0, 4.3, 0, 1.6, 1.1, 1.6, 0, 0, 0, tree);
  const crownTop = add(G.ico1, M.leaf, 0.3, 5.0, -0.2, 1.0, 0.8, 1.0, 0, 0, 0, tree);
  const spreading = [];
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; spreading.push(add(A.rootGeo([[2.4, 0.1, -1.2], [2.4 + Math.cos(a) * 2.5, 0.25, -1.2 + Math.sin(a) * 2.5], [2.4 + Math.cos(a + 0.3) * 5, 0.15, -1.2 + Math.sin(a + 0.3) * 5]], 0.22, 0.06, 14), M.bark, 0, 0, 0, 1, 1, 1)); }
  const green = [];
  for (let i = 0; i < 18; i++) { const a = rng() * TAU, r = 3 + rng() * 5.5; green.push(add(G.ico, rng() < 0.5 ? M.leaf : M.moss, Math.cos(a) * r, 0.25, Math.sin(a) * r, 0.5 + rng() * 0.5, 0.35 + rng() * 0.3, 0.5 + rng() * 0.5)); }
  const shelter = new THREE.Group(); shelter.position.set(-4.4, 0, 2.2); g.add(shelter);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(box(0.24, 2.4, 0.24, 1), M.timber, sx * 1.2, 1.2, sz * 1.0, 1, 1, 1, 0, 0, 0, shelter);
  add(G.dome, M.ceramic, 0, 2.4, 0, 1.7, 0.7, 1.5, 0, 0, 0, shelter);
  add(box(3.5, 0.15, 0.2, 1), M.pigment, 0, 2.38, 1.05, 1, 1, 1, 0, 0, 0, shelter);
  add(box(1.8, 0.4, 0.6, 1), M.stone, 0, 0.2, 0.5, 1, 1, 1, 0, 0, 0, shelter);
  const aq = new THREE.Group(); g.add(aq);
  for (let i = 0; i < 6; i++) add(box(1.2, 18, 1.2, 3), M.stone, 9 + i * 5, -8, -9 - i * 3, 1, 1, 1, 0, 0, 0, aq);
  add(box(1.4, 0.8, 34, 3), M.stone, 21, 1.1, -16, 1, 1, 1, 0, -1.03, 0, aq);
  const aqWater = add(box(0.8, 0.1, 34, 3), M.water, 21, 1.55, -16, 1, 1, 1, 0, -1.03, 0, aq);
  S.apply = function (n) {
    const has = i => n > i;
    clamp.visible = !has(0); for (const s of stakes) s.visible = !has(0);
    trunk.scale.set(has(0) ? 1.15 : 1, 1, has(0) ? 1.15 : 1);
    water.visible = has(1);
    for (const r of spreading) r.visible = has(2);
    tree.scale.setScalar(has(2) ? 1.35 : 1);
    crown.visible = has(1); crownTop.visible = has(2);
    for (const b of broken) b.visible = !has(2);
    for (const v of green) v.visible = has(3);
    shelter.visible = has(4);
    aq.visible = has(5); aqWater.visible = has(5);
  };
  S.apply(0);
  S.group = g;
  return S;
}

// ---- 07_audio.js ----
// =====================================================================
// Procedural sound: material, scale and anticipation.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, vol: 0.8 };
  let ac, master, wet, nb, wind, windGain, waterGain;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.6 * A.vol;
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 2.2), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.3; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // a constant wind over the basin, and a water bed that swells when water returns
        const mk = (f, q, g) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; const gg = ac.createGain(); gg.gain.value = g; s.connect(fl); fl.connect(gg); gg.connect(master); s.start(); return { gg, fl }; };
        wind = mk(420, 0.6, 0.05); windGain = wind.gg;
        waterGain = mk(1600, 0.8, 0.0).gg;
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setVolume = v => { A.vol = v; if (master) master.gain.value = 0.6 * v; };
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.4 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.3 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // distance attenuation: callers pass d (metres) and pan (-1..1)
  const att = d => clamp(1 - (d || 0) / 45, 0.05, 1);
  A.step = (mat, k) => {
    const v = 0.05 * (0.6 + k * 0.4);
    if (mat === 'metal') { tone(380 + Math.random() * 60, 0.06, 'triangle', v * 0.7, 300, 0, 0.15); noise(0.04, 'highpass', 3000, 1, v * 0.5, 0, 0, 0.1); }
    else if (mat === 'wood') { tone(160 + Math.random() * 30, 0.07, 'sine', v * 1.2, 120, 0, 0.1); noise(0.05, 'bandpass', 900, 2, v * 0.6, 0, 0, 0.1); }
    else if (mat === 'root') { noise(0.08, 'lowpass', 500, 1, v * 0.9, 300, 0, 0.1); }
    else { noise(0.05, 'bandpass', 1500 + Math.random() * 400, 1.4, v, 900, 0, 0.12); }
  };
  A.jump = () => { noise(0.18, 'bandpass', 700, 1, 0.05, 1600, 0, 0.1); };
  A.land = (p, mat) => { const k = clamp(p / 14, 0.1, 1); noise(0.2 + k * 0.2, 'lowpass', 700, 1, 0.12 * k + 0.03, 120, 0, 0.2); tone(90, 0.2, 'sine', 0.12 * k, 50, 0, 0.1); if (mat === 'metal') tone(260, 0.3, 'triangle', 0.05 * k, 200, 0, 0.3); };
  A.reach = () => { tone(880, 0.25, 'sine', 0.05, 1320, 0, 0.6); noise(0.2, 'bandpass', 3000, 6, 0.04, 6000, 0, 0.6); };
  A.sever = (style, d, pan) => {
    const a = att(d);
    if (style === 'cable') { noise(0.06, 'highpass', 4000, 1, 0.3 * a, 0, 0, 0.4, pan); tone(520, 0.9, 'sawtooth', 0.06 * a, 140, 0, 0.6, pan); tone(1040, 0.6, 'sine', 0.04 * a, 300, 0, 0.6, pan); }
    else if (style === 'chain') { for (let i = 0; i < 6; i++) tone(900 + Math.random() * 500, 0.08, 'triangle', 0.05 * a, 0, i * 0.04, 0.3, pan); }
    else if (style === 'pin') { tone(240, 0.3, 'square', 0.05 * a, 180, 0, 0.3, pan); noise(0.2, 'bandpass', 1800, 4, 0.12 * a, 0, 0, 0.4, pan); }
    else { noise(0.3, 'lowpass', 900, 1, 0.2 * a, 200, 0, 0.4, pan); tone(110, 0.5, 'sawtooth', 0.05 * a, 70, 0, 0.5, pan); }
  };
  // unmaking is quiet: a breath drawn in, a soft paper hush, a low settling tone
  A.unmake = (d, pan, k) => { const a = att(d) * (k || 1); noise(0.42, 'bandpass', 2600, 0.9, 0.16 * a, 500, 0, 0.7, pan); tone(330, 0.5, 'sine', 0.06 * a, 165, 0.02, 0.8, pan); tone(495, 0.35, 'sine', 0.03 * a, 247, 0.05, 0.9, pan); };
  A.crack = (stage, d, pan) => { const a = att(d); noise(0.25, 'highpass', 1500 + stage * 300, 0.8, 0.22 * a, 500, 0, 0.4, pan); tone(120 - stage * 15, 0.3, 'sine', 0.15 * a, 60, 0, 0.3, pan); };
  A.crumble = (d, pan) => { const a = att(d); noise(1.1, 'lowpass', 1400, 0.8, 0.35 * a, 140, 0, 0.6, pan); tone(70, 0.9, 'sine', 0.3 * a, 35, 0, 0.5, pan); for (let i = 0; i < 6; i++) noise(0.1, 'bandpass', 900 + Math.random() * 1500, 2, 0.08 * a, 0, 0.1 + i * 0.12, 0.4, pan); };
  A.strain = (d, pan) => { const a = att(d); tone(70, 1.2, 'sawtooth', 0.08 * a, 52, 0, 0.8, pan); noise(1.0, 'bandpass', 260, 5, 0.12 * a, 180, 0, 0.7, pan); tone(1800, 0.7, 'sine', 0.02 * a, 2400, 0.2, 0.5, pan); };
  A.creak = (d, pan) => { const a = att(d); tone(95, 0.8, 'sawtooth', 0.05 * a, 72, 0, 0.6, pan); tone(140, 0.6, 'sawtooth', 0.03 * a, 120, 0.1, 0.6, pan); };
  A.impact = (p, d, pan) => { const a = att(d), k = clamp(p / 14, 0.15, 1) * a; tone(62, 0.8, 'sine', 0.5 * k, 30, 0, 0.5, pan); noise(0.7, 'lowpass', 500, 1, 0.35 * k, 80, 0, 0.6, pan); };
  A.mech = (d, pan) => { const a = att(d); for (let i = 0; i < 4; i++) tone(200 + i * 40, 0.12, 'square', 0.03 * a, 0, i * 0.09, 0.3, pan); };
  A.flood = (d) => { const a = att(d); noise(3, 'lowpass', 600, 0.7, 0.25 * a, 2000, 0, 0.6); if (waterGain) waterGain.gain.setTargetAtTime(0.03, ac.currentTime, 2); };
  A.relic = () => { [392, 494, 587, 784].forEach((f, i) => tone(f, 1.6, 'sine', 0.07, 0, i * 0.1, 1)); };
  A.salvage = () => { tone(1400, 0.1, 'triangle', 0.05, 0, 0, 0.5); tone(1870, 0.14, 'sine', 0.04, 0, 0.04, 0.6); };
  A.charge = () => { tone(660, 0.25, 'sine', 0.05, 990, 0, 0.6); };
  A.chain = () => { [330, 415, 494, 660].forEach((f, i) => tone(f, 0.7, 'triangle', 0.06, 0, i * 0.08, 0.8)); };
  A.deny = () => { tone(150, 0.12, 'square', 0.04, 120, 0, 0.1); };
  A.knock = () => { noise(0.3, 'lowpass', 600, 1, 0.3, 100, 0, 0.3); tone(80, 0.3, 'sine', 0.25, 40, 0, 0.2); };
  A.catch = () => { tone(300, 0.6, 'sine', 0.08, 600, 0, 0.8); noise(0.5, 'bandpass', 2000, 3, 0.06, 500, 0, 0.8); };
  A.death = () => { tone(110, 1.8, 'sawtooth', 0.07, 40, 0, 0.9); noise(1.5, 'lowpass', 800, 1, 0.16, 90, 0, 0.9); };
  A.restore = () => { [262, 330, 392, 523, 659].forEach((f, i) => tone(f, 2.2, 'sine', 0.06, 0, i * 0.15, 1)); noise(2, 'lowpass', 1200, 0.7, 0.08, 400, 0, 1); };
  A.ambient = (height) => { if (windGain) windGain.gain.setTargetAtTime(0.03 + clamp(height / 40, 0, 0.05), ac.currentTime, 0.5); };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}

// ---- 08_game.js ----
// =====================================================================
// UNMAKE — the game: input, targeting, interventions, camera, run loop,
// HUD, sanctuary and the Plethora lifecycle.
// =====================================================================

const MEMORIES = [
  'The first houses were built in the shade of the roots. No one owned the shade.',
  'Channels followed the slope of the basin, and the roots drank in summer.',
  'The first brace was raised when a terrace slipped. We thanked its builders.',
  'Every brace needed a brace. Every machine needed a keeper. Every keeper, a rule.',
  'The rule said: nothing may fall. So nothing was allowed to grow.',
  'They lifted the water into tanks so it could not wander. The courtyards dried.',
  'Old streets were sealed beneath new ones, kept still like pressed leaves.',
  'The roots pushed. The city clamped them. It called this maintenance.',
  'Some of us learned to unmake. Not to ruin. To loosen.',
  'A wall that holds nothing up is only a wall that holds you in.',
  'The Stillness is not a monster. It is the city, remembering only how to stay.',
  'Let the water find its old line. Let the tree be untidy. Let it change.'
];
const SAVE_KEY = 'unmake2_save';
const defaultSave = () => ({ best: 0, bestDist: 0, bank: 0, restored: 0, relics: [], runs: 0, seenIntro: false, settings: { view: 'third', look: 1, steer: 1, reduceMotion: false, volume: 0.8, music: true, highVis: false, freeUnmaking: false } });

// Typography: DM Serif Display for numerals and titles, Nunito Sans for labels.
// Scale (px): 11 label · 14 body · 24 heading · 32 numeral · 60 title.
// Grid: 16px outer gutter (plus safe area), 8px rhythm. Colours: chalk on ink.
const UI_CSS = `
.um{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#f4ecdd;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px;--chalk:#f4ecdd;--ink:#221c1f;--ochre:#e3b06a}
.um *{box-sizing:border-box}
.um-lab{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
.um-top{position:absolute;left:var(--g);right:var(--g);top:0;display:flex;justify-content:space-between;align-items:flex-start;transition:opacity .3s}
.um-dist{font-family:'DM Serif Display',Georgia,serif;font-size:32px;line-height:1;letter-spacing:.01em;text-shadow:0 1px 12px rgba(20,14,16,.45);font-variant-numeric:tabular-nums}
.um-dist small{font-family:'Nunito Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;margin-left:6px;opacity:.8}
.um-still{position:relative;width:104px;height:1px;margin-top:10px;background:rgba(244,236,221,.35)}
.um-still b{position:absolute;right:0;top:-1px;height:3px;width:0;background:var(--chalk);transition:background .3s}
.um-still.near b{background:var(--ochre)}
.um-score{margin-top:8px;opacity:.75;text-shadow:0 1px 6px rgba(20,14,16,.6);font-variant-numeric:tabular-nums}
.um-icons{display:flex;gap:8px}
.um-btn{pointer-events:auto;border-radius:50%;border:1.5px solid rgba(244,236,221,.6);background:rgba(34,28,31,.22);color:var(--chalk);display:flex;align-items:center;justify-content:center;touch-action:none}
.um-btn svg{width:46%;height:46%;overflow:visible}
.um-btn.small{width:40px;height:40px}
.um-jump{position:absolute}
.um-jump:active,.um-btn.small:active{background:rgba(244,236,221,.25)}
.um-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(80,86,96,.8) 100%);opacity:0;transition:opacity .4s}
.um-fade{position:absolute;inset:0;background:#e9dcc6;opacity:0;transition:opacity .25s}
.um-cross{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px;display:none}
.um-cross svg{width:100%;height:100%;overflow:visible}
.um-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:1.5px solid rgba(244,236,221,.35);display:none}
.um-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(244,236,221,.3)}
.um-stick.hint{display:block;opacity:.0;animation:umh 3s ease-in-out 2}
.um-stick.hint b{animation:umk 1.5s ease-in-out infinite alternate}
@keyframes umh{15%,85%{opacity:.9}}
@keyframes umk{from{transform:translateX(-26px)}to{transform:translateX(26px)}}
.um-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 var(--g)}
.um-panel.on{display:flex}
.um-card{width:100%;max-width:400px;border-radius:12px;padding:16px;background:rgba(34,28,31,.78);border:1px solid rgba(244,236,221,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto}
.um-logo{font-family:'DM Serif Display',Georgia,serif;font-size:60px;line-height:1;letter-spacing:.14em;text-indent:.14em;text-align:center;text-shadow:0 2px 30px rgba(40,20,20,.45)}
.um-tag{text-align:center;font-size:14px;line-height:1.5;margin-top:8px;opacity:.9;text-shadow:0 1px 10px rgba(40,20,20,.6)}
.um-rule{width:48px;height:1px;background:rgba(244,236,221,.6);margin:16px auto 0}
.um-head{position:absolute;left:var(--g);right:var(--g);display:flex;flex-direction:column;align-items:center}
.um-b{display:block;width:100%;border:0;border-radius:10px;padding:14px 16px;margin-top:8px;font:700 13px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.18em;color:var(--ink);background:var(--chalk);pointer-events:auto;cursor:pointer}
.um-b:active{opacity:.85}
.um-b.sec{background:transparent;color:var(--chalk);border:1px solid rgba(244,236,221,.4)}
.um-row{display:flex;gap:8px}.um-row .um-b{flex:1}
.um-stats{display:flex;justify-content:space-between;padding:0 8px 8px;border-bottom:1px solid rgba(244,236,221,.14);margin-bottom:8px}
.um-stats>div{font-size:11px;font-weight:700;letter-spacing:.18em;opacity:.85;text-align:center;flex:1}
.um-stats b{display:block;font-family:'DM Serif Display',Georgia,serif;font-size:24px;letter-spacing:0;font-weight:400;margin-bottom:2px;opacity:1}
.um-h{font-family:'DM Serif Display',Georgia,serif;font-size:24px;line-height:1.2;text-align:center;margin-bottom:8px}
.um-sub{font-size:14px;line-height:1.5;text-align:center;opacity:.8;margin-bottom:8px}
.um-list{font-size:14px;line-height:1.5;margin:0 0 8px;max-height:30vh;overflow:auto;pointer-events:auto}
.um-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(244,236,221,.1)}
.um-li b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:16px}
.um-li.done{opacity:.5}
.um-mini{border:0;border-radius:8px;padding:8px 12px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.14em;color:var(--ink);background:var(--chalk);pointer-events:auto}
.um-mini[disabled]{background:rgba(244,236,221,.14);color:rgba(244,236,221,.5)}
.um-mem{padding:8px 0;border-bottom:1px solid rgba(244,236,221,.1);font-family:'DM Serif Display',Georgia,serif;font-size:16px;line-height:1.45}
.um-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:14px}
.um-set input[type=range]{width:46%;pointer-events:auto;accent-color:#f4ecdd}
.um-tog{pointer-events:auto;border:1px solid rgba(244,236,221,.4);background:transparent;color:var(--chalk);border-radius:8px;padding:6px 10px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.14em}
.um-tog.on{background:var(--chalk);color:var(--ink)}
.um-new{color:var(--ochre);font-weight:700}
`;

window.plethoraBit = {
  meta: { title: 'UNMAKE 2.0', runtime: 'plethora-bit@2', tags: ['arcade', 'physics', '3d', 'endless'], permissions: ['haptics', 'audio', 'backgroundMusic', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s, { settings: Object.assign(defaultSave().settings, s.settings || {}) }); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(#857f8a,#e5c79c 55%,#3b3136)';
    const ui = ctx.createRoot({ className: 'um', layer: 'overlay', input: 'passthrough' });
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'um-vig'); H.fade = el('div', 'um-fade');
    // HUD: distance, the Stillness as a hairline beneath it, score; two icons; jump.
    const ICON = {
      pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
      view: '<svg viewBox="-10 -10 20 20"><path d="M-8,0C-5,-5.5 5,-5.5 8,0C5,5.5 -5,5.5 -8,0Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle r="2.4" fill="currentColor"/></svg>',
      jump: '<svg viewBox="-10 -10 20 20"><path d="M-7,4L0,-4L7,4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    H.top = el('div', 'um-top');
    const tl = el('div', '', '', H.top); H.dist = el('div', 'um-dist', '0<small>M</small>', tl);
    H.still = el('div', 'um-still', '<b></b>', tl); H.stillB = H.still.firstChild;
    H.score = el('div', 'um-score um-lab', '0', tl);
    const icons = el('div', 'um-icons', '', H.top);
    H.view = el('div', 'um-btn small', ICON.view, icons); H.pause = el('div', 'um-btn small', ICON.pause, icons);
    H.cross = el('div', 'um-cross', '<svg viewBox="-14 -14 28 28"><circle r="1.6" fill="#f4ecdd"/><path class="t" d="M-11,-6V-11H-6M6,-11H11V-6M11,6V11H6M-6,11H-11V6" fill="none" stroke="#f4ecdd" stroke-width="1.6" opacity="0"/></svg>');
    H.stick = el('div', 'um-stick', '<b></b>'); H.knob = H.stick.firstChild;
    H.jump = el('div', 'um-btn um-jump', ICON.jump);
    H.title = el('div', 'um-panel');
    const hd = el('div', 'um-head', '', H.title); el('div', 'um-logo', 'UNMAKE', hd); el('div', 'um-rule', '', hd); el('div', 'um-tag', 'The city that forgot how to grow.<br>Unmake what holds it still.', hd); H.head = hd;
    const tc = el('div', 'um-card', '', H.title); H.tstats = el('div', 'um-stats', '', tc);
    H.begin = el('button', 'um-b', 'BEGIN', tc);
    const trow = el('div', 'um-row', '', tc); H.toSanct = el('button', 'um-b sec', 'SANCTUARY', trow); H.toSet = el('button', 'um-b sec', 'SETTINGS', trow);
    H.over = el('div', 'um-panel'); const oc = el('div', 'um-card', '', H.over);
    H.oh = el('div', 'um-h', '', oc); H.osub = el('div', 'um-sub', '', oc); H.ostats = el('div', 'um-stats', '', oc); H.olist = el('div', 'um-list', '', oc);
    const orow = el('div', 'um-row', '', oc); H.again = el('button', 'um-b', 'AGAIN', orow); H.oSanct = el('button', 'um-b sec', 'SANCTUARY', orow);
    H.sanct = el('div', 'um-panel'); const sc = el('div', 'um-card', '', H.sanct);
    el('div', 'um-h', 'The Sanctuary', sc); H.sbank = el('div', 'um-sub', '', sc); H.slist = el('div', 'um-list', '', sc);
    const srow = el('div', 'um-row', '', sc); H.smem = el('button', 'um-b sec', 'MEMORIES', srow); H.sback = el('button', 'um-b', 'BACK', srow);
    H.mems = el('div', 'um-panel'); const mc = el('div', 'um-card', '', H.mems); el('div', 'um-h', 'Memories', mc); H.mlist = el('div', 'um-list', '', mc); H.mback = el('button', 'um-b', 'BACK', mc);
    H.set = el('div', 'um-panel'); const setc = el('div', 'um-card', '', H.set); el('div', 'um-h', 'Settings', setc); H.slist2 = el('div', 'um-list', '', setc);
    const setrow = el('div', 'um-row', '', setc); H.resume = el('button', 'um-b', 'RESUME', setrow); H.quit = el('button', 'um-b sec', 'END RUN', setrow); H.setBack = el('button', 'um-b', 'BACK', setc);
    H.title.classList.add('on');
    H.tstats.innerHTML = '<div><b>…</b>LOADING</div>';
    for (const e of [H.top, H.jump]) e.style.display = 'none';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }

    // ---------- boot with distinct diagnostics ----------
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen UNMAKE.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen UNMAKE.' }[stage];
      H.tstats.innerHTML = `<div style="text-align:center;line-height:1.4"><b style="font-size:16px">${msg}</b></div>`;
      H.begin.style.display = 'none'; trow.style.display = 'none';
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    const scratch = ctx.createCanvas2D({ layer: 'background', input: 'passthrough', willReadFrequently: true });
    scratch.style.display = 'none';
    const A = createAssets(THREE, renderer, scratch);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, ctx.width / ctx.height, 0.08, 900);
    scene.add(camera);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), A.skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    try {
      const pm = new THREE.PMREMGenerator(renderer); const es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), A.skyMat));
      scene.environment = pm.fromScene(es, 0.03).texture; scene.environmentIntensity = 0.45; pm.dispose();
    } catch (e) { }
    scene.fog = new THREE.Fog(new THREE.Color(PALETTE.skyHorizon), 34, 230);
    const hemi = new THREE.HemisphereLight('#d7cfc2', '#4a3c39', 0.9); scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffd09a', 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    const SUN = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    const fill = new THREE.DirectionalLight('#8fa7b0', 0.35); fill.position.set(8, 3, 10); scene.add(fill);

    const V = createViews(THREE, A, scene);
    const W = createWorld(THREE, A, scene);
    const S = createSanctuary(THREE, A, scene);
    S.apply(save.restored);
    const hand = V.makeHand(camera);
    const rig = V.makeTraveller();
    const audio = createAudio(!!caps.audio);
    audio.setVolume(save.settings.volume);
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    ctx.onDestroy(() => audio.close());

    // motes drifting in the low sun
    const motes = (() => {
      const n = small ? 260 : 420, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
      const r = makeRng(3); for (let i = 0; i < n * 3; i += 3) { p[i] = (r() - 0.5) * 40; p[i + 1] = (r() - 0.5) * 16; p[i + 2] = (r() - 0.5) * 60; }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffe2b8', size: 0.07, map: A.T.glow, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; scene.add(m); return m;
    })();

    // ---------- state ----------
    let mode = 'title', run = null, time = 0;
    const cam = { pos: new THREE.Vector3(0, 4, 8), look: new THREE.Vector3(), fp: save.settings.view === 'first' ? 1 : 0, yaw: 0, pitch: -0.1, pull: 0, shake: 0, init: false };
    const input = { steer: 0, pace: 0, jumpPressed: false, jumpHeld: false, keys: new Set(), stick: null, interact: null, lookDrag: null, virtual: null };
    const difficulty = z => clamp(-z / 900, 0, 1);

    function haptic(k) { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } }

    // ---------- runs ----------
    function disposeRun() {
      if (!run) return;
      for (const g of run.views.values()) V.dispose(g);
      for (const g of run.connViews.values()) V.dispose(g);
      for (const p of run.pickups) if (p.view) V.dispose(p.view);
      for (const s of run.segs) { if (s.decor) V.dispose(s.decor); if (s.batch) V.dispose(s.batch); for (const w of s.waterViews || []) V.dispose(w); }
      V.clearGhosts();
      run = null;
    }
    function newRun() {
      disposeRun();
      const P = new Phys();
      const player = new Player(P);
      P.player = player;
      const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      run = {
        P, player, seed, rng: makeRng(seed), seq: new Sequencer(seed, save.runs < 2), segs: [], end: [0, 0, 0],
        views: new Map(), connViews: new Map(), pickups: [],
        score: 0, frontier: 0, salvage: 0, relicsNew: [], interventions: 0, chains: 0, catches: 0, encounters: 0, skillful: 0,
        stillZ: 26, t: 0, dying: 0, over: false, focus: null, beam: 0, beamTo: null, lastStepMat: 'stone', intro: !save.seenIntro ? 7 : 0
      };
      const lead = new Builder(P, [0, 0, 14], -1, makeRng(1), 0);
      lead.deck(0, -14, { w: 4 });
      lead.dec('dwellings', { at: [0, 0, -7], len: 14 });
      register(lead, { idx: -1, name: 'lead', meta: { len: 14 }, z0: 14, z1: 0 });
      player.reset([0, 0.02, 10]);
      while (run.end[2] > -140) addSegment();
      cam.init = false;
      W.reset();
    }
    function register(b, seg) {
      const still = b.bodies.filter(V.canBatch);
      if (still.length) seg.batch = V.batchStatic(still);
      for (const body of b.bodies) if (!V.canBatch(body)) run.views.set(body.id, V.makeBody(body));
      for (const c of b.conns) run.connViews.set(c.id, V.makeConn(c));
      for (const p of b.pickups) { p.view = V.makePickup(p); run.pickups.push(p); }
      seg.decor = W.buildDecor(b.decor, (seg.seed || 1) + seg.idx);
      seg.waterViews = [];
      run.segs.push(seg);
    }
    function addSegment() {
      const idx = run.segs.length;
      const d = difficulty(run.end[2]);
      let name = run.seq.next(d, run.end[1]), seed = 0, ok = false;
      for (let i = 0; i < 5 && !ok; i++) { seed = (run.rng() * 1e9) >>> 0; ok = validateSegment(name, seed, d).ok; }
      if (!ok) { name = 'approach'; seed = 11; }
      const P = run.P;
      const nb0 = P.bodies.length, nc0 = P.conns.length, nw0 = P.waters.length;
      const meta = buildSegment(P, name, seed, d, run.end, idx);
      const b = { bodies: P.bodies.slice(nb0), conns: P.conns.slice(nc0), pickups: meta.pickups, decor: meta.decor };
      const seg = { idx, name, seed, meta, z0: run.end[2], z1: meta.exitPos[2], used: 0, entered: false, cleared: false, chained: false };
      register(b, seg);
      for (const w of P.waters.slice(nw0)) {
        const m = new THREE.Mesh(A.G.plane, A.M.water);
        m.rotation.x = -Math.PI / 2; m.scale.set(w.x1 - w.x0, w.z0 - w.z1, 1);
        m.position.set((w.x0 + w.x1) / 2, w.level, (w.z0 + w.z1) / 2);
        m.userData.water = w; V.root.add(m); seg.waterViews.push(m);
      }
      run.end = meta.exitPos;
    }
    function dropBehind() {
      const pz = run.player.pos[2];
      for (const s of run.segs) {
        if (s.dropped || s.z1 < pz + 40 || s.idx === undefined) continue;
        s.dropped = true;
        const P = run.P;
        P.bodies = P.bodies.filter(b => { if (b.seg === s.idx || (s.idx === -1 && b.seg === -1)) { P.byId.delete(b.id); const v = run.views.get(b.id); if (v) { V.dispose(v); run.views.delete(b.id); } return false; } return true; });
        P.conns = P.conns.filter(c => { if (c.seg === s.idx) { P.byId.delete(c.id); const v = run.connViews.get(c.id); if (v) { V.dispose(v); run.connViews.delete(c.id); } return false; } return true; });
        P.waters = P.waters.filter(w => w.seg !== s.idx);
        run.pickups = run.pickups.filter(p => { if (p.seg === s.idx) { if (p.view) V.dispose(p.view); return false; } return true; });
        if (s.decor) { V.dispose(s.decor); s.decor = null; }
        if (s.batch) { V.dispose(s.batch); s.batch = null; }
        for (const w of s.waterViews || []) V.dispose(w);
      }
    }

    // ---------- targeting ----------
    // Eligibility is the limit: only what the preservers added (glazed bodies,
    // copper restraints) can be unmade. There is no meter and no cooldown.
    function targets() {
      const out = [];
      for (const c of run.P.conns) if (c.alive && c.role) out.push({ o: c, role: 'unmake' });
      for (const b of run.P.bodies) if (b.alive && b.erase) out.push({ o: b, role: 'unmake' });
      return out;
    }
    function targetPoint(t) { return t.o.isConn ? run.P.connMid(t.o) : t.o.pos; }
    function pickRay(o, d, maxT) {
      // a true hit on an element always beats a near miss; near misses (thin
      // props, cables, a fingertip's slop) rank only among themselves
      let best = null, bt = Infinity, bpt = Infinity;
      for (const t of targets()) {
        let hit = Infinity, rank = Infinity;
        if (t.o.isConn) {
          const [a, b] = run.P.connEnds(t.o);
          const r = raySegDist(o, d, maxT, a, b);
          if (r.dist < 0.45 + r.t * 0.018) { hit = r.t; rank = r.t; }
        } else {
          hit = run.P.rayBody(t.o, o, d, maxT);
          if (hit < Infinity) rank = hit;
          else {
            const t0 = clamp(vDot(vSub(t.o.pos, o), d), 0, maxT), p = vAddS(o, d, t0), cp = run.P.closestPoint(t.o, p);
            if (vLen(vSub(p, cp)) < 0.5 + t0 * 0.015) { hit = t0; rank = 1000 + t0; }
          }
        }
        if (rank < bt) { bt = rank; bpt = hit; best = t; }
      }
      if (best) best = { o: best.o, role: best.role, point: vAddS(o, d, bpt) };
      return best;
    }
    const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), _v = new THREE.Vector3();
    function rayFromScreen(x, y) {
      ndc.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return [[ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]];
    }
    function inRange(t) { return vLen(vSub(targetPoint(t), run.player.pos)) < 28; }
    // the focused target: under the crosshair in first person, else the best one ahead
    function updateFocus() {
      const pl = run.player;
      if (cam.fp > 0.5) {
        const [o, d] = rayFromScreen(ctx.width / 2, ctx.height / 2);
        const t = pickRay(o, d, 40);
        run.focus = t && inRange(t) ? t : null;
        if (run.focus) run.focus.deps = run.P.dependents(run.focus.o);
        return;
      }
      let best = null, bs = Infinity;
      for (const t of targets()) {
        if (t.o === pl.ground) continue;
        // only what the traveller can see from where they stand: not overhead, not far below
        const chest = [pl.pos[0], pl.pos[1] + 1.2, pl.pos[2]];
        const cp = t.o.isConn ? (() => { const [a, b] = run.P.connEnds(t.o); return closestOnSeg(a, b, chest); })() : run.P.closestPoint(t.o, chest);
        if (!t.o.isConn && cp[1] - pl.pos[1] > 3.2 || cp[1] - pl.pos[1] < -6) continue;
        const p = targetPoint(t);
        const dz = pl.pos[2] - p[2];
        if (dz < -3 || dz > 26) continue;
        _v.set(p[0], p[1], p[2]).project(camera);
        if (_v.z > 1 || Math.abs(_v.x) > 0.95 || Math.abs(_v.y) > 0.95) continue;
        const score = dz * 0.6 + Math.hypot(_v.x, _v.y) * 6;
        if (score < bs) { bs = score; best = t; }
      }
      if (best && run.focus && run.focus.o === best.o) return;
      run.focus = best;
      if (best) best.deps = run.P.dependents(best.o);
    }
    // what each dependent will do: its pose now, and where it will come to rest
    function consequences(t) {
      if (!t.deps) t.deps = run.P.dependents(t.o);
      const gone = t.o.isConn ? [t.o.id] : run.P.eraseGroup(t.o).map(b => b.id);
      return t.deps.filter(b => b.alive).map(b => ({ b, rest: run.P.predictRest(b, gone) }));
    }

    // ---------- unmaking ----------
    function canAct() { return run && !run.dying && !run.over && run.player.alive; }
    function segOf(o) { return run.segs.find(s => s.idx === o.seg); }
    // each stretch allows as many unmakings as its biggest solution needs; then the rest seals
    function sealed(o) { if (save.settings.freeUnmaking) return false; const s = segOf(o); return !!(s && s.meta && s.used >= s.meta.budget); }
    function deny(t) { audio.deny(); haptic('warning'); run.denied = { o: t.o, t: 0.5 }; }
    function intervene(t, point) {
      if (!canAct() || !t || !inRange(t)) return false;
      const o = t.o;
      if (!(o.isConn ? o.alive && o.role : o.alive && o.erase)) { deny(t); return false; }
      if (sealed(o)) { deny(t); return false; }
      const seg = segOf(o);
      run.interventions++; if (seg) seg.used++;
      const at = point || t.point || (o.isConn ? run.P.connMid(o) : run.P.closestPoint(o, [run.player.pos[0], run.player.pos[1] + 1.2, run.player.pos[2]]));
      run.beam = 0.22; run.beamTo = at;
      if (o.isConn) run.P.sever(o, 'unmake'); else run.P.erase(o, at);
      run.focus = null;
      haptic('light');
      try { ctx.platform.interact({ type: 'unmake', style: o.style }); } catch (e) { }
      return true;
    }

    // ---------- events → feel ----------
    function where(p) { const pl = run.player.pos; const d = vLen(vSub(p, pl)); const pan = clamp((p[0] - pl[0]) / 12, -1, 1); return [d, pan]; }
    function processEvents() {
      const P = run.P;
      for (const ev of P.events) {
        const p = ev.pos || run.player.pos;
        const [d, pan] = where(p);
        switch (ev.type) {
          case 'sever': { audio.unmake(d, pan, 0.6); audio.sever(ev.style, d * 1.6, pan); const v = run.connViews.get(ev.conn.id); if (v) { run.connViews.delete(ev.conn.id); V.unmakeConn(v); } break; }
          case 'erase': {
            audio.unmake(d, pan, 1);
            for (const b of ev.bodies) { const v = run.views.get(b.id); if (v) { run.views.delete(b.id); V.unmake(v, b, ev.origin); } }
            break;
          }
          case 'snap': audio.sever('cable', d, pan); V.spawn(p, 12, { color: '#d9c9b0', speed: 2, size: 0.2, life: 0.6 }); break;
          case 'strain': audio.strain(d, pan); V.spawn(p, 10, { color: '#d8cab4', speed: 0.6, size: 0.35, life: 1.2, g: -3 }); camKick(0.08, p); break;
          case 'release': audio.creak(d, pan); if (d < 30) cam.pull = Math.max(cam.pull, 1); break;
          case 'crack': audio.crack(ev.stage, d, pan); V.spawn(p, 14, { color: '#e0d3bd', speed: 2.5, size: 0.35, life: 0.8, g: -6, sx: 1.4, sy: 1.6 }); V.debris(p, 3, A.M.stone, 0.14, 1.2); break;
          case 'crumble': case 'break': case 'strike': {
            const b = ev.body;
            if (ev.type !== 'strike') {
              const v = b && run.views.get(b.id);
              if (v) { V.dispose(v); run.views.delete(b.id); }
            }
            if (ev.type === 'break' && ev.why === 'erased') break;
            if (ev.type === 'break' || ev.type === 'crumble') { audio.crumble(d, pan); V.spawn(p, 40, { color: '#e3d6c0', speed: 3, size: 0.9, life: 1.5, grow: 0.8, g: -1, sx: 2, sy: 2, alpha: 0.55 }); V.debris(p, 12, b && b.style === 'sluice' ? A.M.rust : A.M.stone, 0.24, 1.6); camKick(0.3, p); }
            else { audio.impact(10, d, pan); camKick(0.25, p); }
            break;
          }
          case 'impact': if ((ev.power || 0) > 3) { audio.impact(ev.power, d, pan); V.spawn(p, 16, { color: '#ddd0bb', speed: 2.2, size: 0.7, life: 1.1, grow: 0.7, g: 0.2, sx: 2.2, sy: 0.3, alpha: 0.45 }); camKick(Math.min(0.35, ev.power * 0.025), p); } break;
          case 'land': if ((ev.power || 0) > 3) { audio.impact(ev.power * 0.8, d, pan); camKick(0.2, p); } break;
          case 'tilt': audio.mech(d, pan); break;
          case 'lift': audio.mech(d, pan); break;
          case 'flood': audio.flood(d); if (ev.water) livingReturns(ev.water); break;
          case 'chain': {
            run.chains++;
            const src = ev.tag && ev.tag.src ? run.P.get(ev.tag.src.conn || ev.tag.src.body) : null;
            const seg = run.segs.find(s => s.idx === (src ? src.seg : -9));
            if (seg) seg.chained = true;
            run.score += 300;
            audio.chain(); haptic('success');
            try { ctx.platform.milestone('chain'); } catch (e) { }
            break;
          }
        }
        if (ev.type === 'release' && ev.body && ev.body.type === 'free' && ev.body.style === 'counterweight') audio.sever('chain', d, pan);
        if (ev.type === 'release' && ev.water === undefined && ev.body && ev.body.style === 'sluice') audio.flood(d);
      }
      P.events.length = 0;
      for (const ev of run.player.events) {
        if (ev.type === 'jump') { audio.jump(); rig.takeoff(); }
        if (ev.type === 'land') { const mat = matOf(ev.body); audio.land(ev.power, mat); rig.land(ev.power); if (ev.power > 9) { camKick(Math.min(0.25, (ev.power - 9) * 0.03)); haptic('light'); } if (ev.power > 6) V.spawn(run.player.pos, 8, { color: '#ddd0bb', speed: 1.2, size: 0.4, life: 0.6, sy: 0.1, g: 0.5, alpha: 0.4 }); }
        if (ev.type === 'knock') { audio.knock(); camKick(0.35); haptic('heavy'); }
        if (ev.type === 'death') { run.dying = 1.4; run.deathReason = ev.reason; audio.death(); haptic('error'); }
      }
      run.player.events.length = 0;
    }
    function matOf(b) {
      if (!b) return 'stone';
      const s = b.style;
      if (s === 'leaf' || s === 'balance' || s === 'barge' || s === 'beam') return 'wood';
      if (s === 'cradle' || s === 'liftDeck' || s === 'net') return 'metal';
      if (s === 'root' || s === 'rootBridge' || s === 'knuckle') return 'root';
      return 'stone';
    }
    function camKick(k, p) { if (save.settings.reduceMotion) return; if (p) { const d = vLen(vSub(p, run.player.pos)); k *= clamp(1 - d / 30, 0, 1); } cam.shake = Math.max(cam.shake, k); }
    // when water returns, so does green: moss and leaves along the wet edges
    function livingReturns(w) {
      const seg = run.segs.find(s => s.idx === w.seg);
      if (!seg) return;
      const g = new THREE.Group(); const r = makeRng(w.id);
      for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(A.G.ico, r() < 0.5 ? A.M.leaf : A.M.moss); const x = r() < 0.5 ? w.x0 + r() * 0.8 : w.x1 - r() * 0.8; m.position.set(x, w.target + 0.2 + r() * 0.4, lerp(w.z1, w.z0, r())); m.scale.set(0.3 + r() * 0.4, 0.2 + r() * 0.3, 0.3 + r() * 0.4); g.add(m); }
      V.root.add(g); seg.waterViews.push(g);
      g.scale.setScalar(0.01); g.userData.grow = 0;
      run.growing = (run.growing || []).concat([g]);
    }

    // ---------- run step ----------
    function step(dt) {
      if (mode !== 'play' || !run) return;
      const P = run.P, pl = run.player;
      if (run.dying > 0) {
        run.dying -= dt;
        P.step(dt * 0.4); processEvents();
        if (run.dying <= 0) endRun(run.deathReason);
        return;
      }
      run.t += dt;
      // input → player
      const ki = keyInput();
      const inp = { steer: clamp(ki.steer * save.settings.steer, -1, 1), pace: ki.pace, jumpPressed: input.jumpPressed, jumpHeld: input.jumpHeld };
      input.jumpPressed = false;
      const heading = cam.fp > 0.5 ? cam.yaw : 0;
      pl.step(dt, inp, heading);
      P.step(dt);
      processEvents();
      // the Stillness follows
      const d = difficulty(pl.pos[2]);
      const sp = MOVE.cruise * lerp(0.62, 0.82, d) * (run.t < 3 ? 0 : 1) * (save.runs < 1 ? 0.85 : 1);
      run.stillZ -= sp * dt;
      if (run.stillZ - pl.pos[2] > 24) run.stillZ = pl.pos[2] + 24;
      if (pl.alive && run.stillZ <= pl.pos[2]) { pl.die('stilled'); }
      // falling into the basin: the city catches you and sets you back on the
      // last sound footing — and the Stillness gains 3 m on you (never leaving
      // you more than 14 m ahead). Run well and the margin comes back; fall
      // when it is already at your heels and nothing catches you.
      if (pl.alive && pl.pos[1] < pl.lastSafe[1] - 13) {
        let safe = null;
        for (let i = pl.safeHist.length - 1; i >= 0 && !safe; i--) { const h = pl.safeHist[i]; if (h.body && h.body.alive) { const g = P.groundAt(h.pos[0], h.pos[2], h.pos[1] + 0.5); if (g.body && Math.abs(g.y - h.pos[1]) < 0.3) safe = h.pos; } }
        if (!safe && pl.safeBody && pl.safeBody.alive) safe = pl.lastSafe;
        const margin = safe ? Math.min(run.stillZ - safe[2] - 3, 14) : -1;
        if (margin >= 2.5) {
          run.catches++;
          pl.pos = vAdd(safe, [0, 0.05, 0]); pl.vel = [0, 0, 0]; pl.grounded = false;
          run.stillZ = pl.pos[2] + margin;
          H.fade.style.opacity = 0.9; ctx.timeout(() => { H.fade.style.opacity = 0; }, 160);
          audio.catch(); haptic('medium');
        } else pl.die('fell');
      }
      // pickups
      for (const p of run.pickups) {
        if (!p.alive) continue;
        if (p.ride) { const b = P.get(p.ride); if (b && b.alive) p.pos = [b.pos[0], b.pos[1] + 0.9, b.pos[2]]; }
        if (p.sealed) continue;
        const dd = vLen(vSub(p.pos, [pl.pos[0], pl.pos[1] + 0.8, pl.pos[2]]));
        if (dd < 1.0) {
          p.alive = false;
          if (p.view) { V.dispose(p.view); p.view = null; }
          if (p.kind === 'relic') {
            run.score += 400; run.salvage += 8;
            const missing = []; for (let i = 0; i < MEMORIES.length; i++) if (!save.relics.includes(i)) missing.push(i);
            if (missing.length) { save.relics.push(missing[0]); run.relicsNew.push(missing[0]); persist(); }
            audio.relic(); haptic('success');
            V.spawn(p.pos, 50, { color: '#ffd59a', speed: 2.6, size: 0.35, life: 1.4, g: 1 });
          } else { run.salvage++; run.score += 20; audio.salvage(); V.spawn(p.pos, 8, { color: '#e6b46c', speed: 1.6, size: 0.22, life: 0.5, g: 1 }); }
        }
      }
      // encounter bookkeeping
      for (const s of run.segs) {
        if (s.idx < 0) continue;
        if (!s.entered && pl.pos[2] < s.z0) { s.entered = true; }
        if (!s.cleared && s.entered && pl.pos[2] < s.z1 && pl.alive) {
          s.cleared = true;
          if (!FAMILIES[s.name].rest) {
            run.encounters++;
            run.score += 120;
            if (s.used <= (s.meta.need || 0) && s.meta.solutions.length > 1) { run.score += 150; run.skillful++; }
            try { ctx.platform.milestone('encounter', { name: s.name }); } catch (e) { }
          }
        }
      }
      // distance
      if (-pl.pos[2] > run.frontier + 1) { const n = Math.floor(-pl.pos[2] - run.frontier); run.frontier += n; run.score += n * 10; }
      while (run.end[2] > pl.pos[2] - 150) addSegment();
      dropBehind();
      if (scoreTrack) try { scoreTrack.set(Math.floor(run.score)); } catch (e) { }
    }

    function keyInput() {
      if (input.virtual) return input.virtual;
      let steer = 0, pace = 0;
      const k = input.keys;
      if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
      if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
      if (k.has('ArrowUp') || k.has('KeyW')) pace += 1;
      if (k.has('ArrowDown') || k.has('KeyS')) pace -= 1;
      if (input.stick) {
        const s = input.stick; let dx = (s.x - s.ox) / 50, dy = -(s.y - s.oy) / 50;
        const m = Math.hypot(dx, dy);
        if (m > 0.12) { const c = Math.min(1, (m - 0.12) / 0.88); steer = dx / m * c; pace = dy / m * c; }
      }
      return { steer, pace };
    }

    // ---------- camera ----------
    const camTarget = new THREE.Vector3(), camWant = new THREE.Vector3(), fpPos = new THREE.Vector3(), q3 = new THREE.Quaternion(), qf = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
    function updateCamera(dt) {
      const pl = run.player, portrait = ctx.height > ctx.width;
      const speed = Math.hypot(pl.vel[0], pl.vel[2]);
      const air = pl.grounded ? 0 : 1;
      cam.pull = Math.max(0, cam.pull - dt * 0.55);
      const pull = save.settings.reduceMotion ? 0 : smooth(Math.min(1, cam.pull));
      const back = (portrait ? 7.2 : 6.0) + speed * 0.12 + pull * 2.4;
      const up = (portrait ? 3.7 : 3.1) + air * 0.6 + pull * 1.6;
      const lookAhead = portrait ? 7.5 : 6.5;
      const groundRef = pl.grounded ? pl.pos[1] : Math.max(pl.pos[1], pl.lastSafe[1] - 2.5);
      if (!cam.init) { cam.pos.set(pl.pos[0] * 0.6, groundRef + up, pl.pos[2] + back); cam.ly = groundRef; cam.init = true; }
      cam.ly = damp(cam.ly, groundRef, pl.grounded ? 5 : 2, dt);
      camWant.set(pl.pos[0] * 0.65 + 0.6, cam.ly + up, pl.pos[2] + back);
      cam.pos.x = damp(cam.pos.x, camWant.x, 5, dt); cam.pos.y = damp(cam.pos.y, camWant.y, 4.5, dt); cam.pos.z = damp(cam.pos.z, camWant.z, 9, dt);
      camTarget.set(pl.pos[0] * 0.8, cam.ly + 1.1 - air * 0.5, pl.pos[2] - lookAhead);
      // keep the camera out of solid structure behind it
      const P = run.P;
      const o = [pl.pos[0], pl.pos[1] + 1.4, pl.pos[2]];
      const dvec = [cam.pos.x - o[0], cam.pos.y - o[1], cam.pos.z - o[2]];
      const dl = vLen(dvec), dn = vScale(dvec, 1 / dl);
      let hit = dl;
      for (const b of P.near([Math.min(o[0], cam.pos.x), Math.min(o[1], cam.pos.y), Math.min(o[2], cam.pos.z), Math.max(o[0], cam.pos.x), Math.max(o[1], cam.pos.y), Math.max(o[2], cam.pos.z)], 0.3)) {
        if (b.passable) continue;
        const t = P.rayBody(b, o, dn, dl); if (t < hit) hit = t;
      }
      const c3 = hit < dl ? new THREE.Vector3(o[0] + dn[0] * (hit - 0.3), o[1] + dn[1] * (hit - 0.3), o[2] + dn[2] * (hit - 0.3)) : cam.pos.clone();
      // third-person orientation
      const m4 = new THREE.Matrix4().lookAt(c3, camTarget, new THREE.Vector3(0, 1, 0));
      q3.setFromRotationMatrix(m4);
      // first person: eye height, look yaw/pitch, gentle bob
      const bob = save.settings.reduceMotion || !pl.grounded ? 0 : Math.sin(time * 11 * clamp(speed / 5, 0, 1.4)) * 0.035 * clamp(speed / 5, 0, 1);
      fpPos.set(pl.pos[0], pl.pos[1] + 1.42 + bob - (pl.justLanded > 0 ? pl.justLanded * 0.4 : 0), pl.pos[2]);
      eul.set(cam.pitch, cam.yaw, 0); qf.setFromEuler(eul);
      // blend between the two
      const want = save.settings.view === 'first' ? 1 : 0;
      cam.fp = damp(cam.fp, want, 9, dt); if (Math.abs(cam.fp - want) < 0.002) cam.fp = want;
      const k = smooth(cam.fp);
      camera.position.lerpVectors(c3, fpPos, k);
      camera.quaternion.slerpQuaternions(q3, qf, k);
      if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt * 1.8); camera.position.x += (Math.random() - 0.5) * cam.shake * 0.4; camera.position.y += (Math.random() - 0.5) * cam.shake * 0.4; }
      camera.fov = lerp(portrait ? 64 : 55, portrait ? 78 : 72, k);
      camera.updateProjectionMatrix();
      rig.root.visible = k < 0.6;
      hand.g.visible = k > 0.85;
      A.U.uOccl.value = k < 0.5 ? 1 : 0;
      A.U.uPlayer.value.set(pl.pos[0], pl.pos[1] + 0.9, pl.pos[2]);
      A.U.uCam.value.copy(camera.position);
      // in third person the traveller always faces the course
      if (k < 0.5) { cam.yaw = damp(cam.yaw, 0, 6, dt); cam.pitch = damp(cam.pitch, -0.08, 6, dt); }
    }

    // ---------- render ----------
    function frame(dt) {
      time += dt;
      if ((mode === 'play' || mode === 'over' || mode === 'paused') && run) {
        const pl = run.player;
        updateCamera(dt);
        W.setVisible(true);
        W.update(pl.pos[2], pl.pos[1], time);
        sky.position.copy(camera.position);
        sun.position.set(pl.pos[0] + SUN.x * -40, pl.pos[1] + 40 * SUN.y, pl.pos[2] + SUN.z * -40 + 0);
        sun.position.set(pl.pos[0] - 26, pl.pos[1] + 30, pl.pos[2] - 16);
        sun.target.position.set(pl.pos[0], pl.pos[1], pl.pos[2] - 6); sun.target.updateMatrixWorld();
        updateFocus();
        if (run.press && (!run.press.o.alive || !inRange(run.press))) run.press = null;
        const F = run.press || (run.focus && inRange(run.focus) ? run.focus : null);
        const strong = !!run.press || cam.fp > 0.5;
        for (const [id, g] of run.views) {
          const b = run.P.get(id); if (!b || !b.alive) { V.dispose(g); run.views.delete(id); continue; }
          V.syncBody(b, g);
          const gm = g.userData.glaze;
          if (gm) gm.userData.u.uSealed.value = damp(gm.userData.u.uSealed.value, sealed(b) ? 1 : 0, 4, dt);
          if (gm) { const on = F && !F.o.isConn && !sealed(b) && (F.o === b || (b.eraseGroup && b.eraseGroup === F.o.eraseGroup)); gm.userData.u.uFocus.value = damp(gm.userData.u.uFocus.value, on ? (strong ? 1 : 0.4) : (save.settings.highVis ? 0.35 : 0), 12, dt); }
        }
        for (const [id, g] of run.connViews) { const c = run.P.get(id); if (!c || !c.alive) { V.dispose(g); run.connViews.delete(id); continue; } V.syncConn(run.P, c, g, time); const f = F && F.o === c && !sealed(c); g.userData.mat.color.set(sealed(c) ? '#6e6a68' : '#ffffff'); g.userData.mat.emissiveIntensity = damp(g.userData.mat.emissiveIntensity, f ? 1.2 : (save.settings.highVis ? 0.45 : 0), 10, dt); }
        // the exact region: chalk outline on what will go, ochre on what will move because of it
        V.beginOutlines();
        if (run.denied) { run.denied.t -= dt; const o = run.denied.o; if (run.denied.t <= 0 || !o.alive) run.denied = null; else if (!o.isConn) for (const b of run.P.eraseGroup(o)) V.outline(b.pos, b.rot, b.size, PALETTE.ink, run.denied.t * 1.6, 0.003, camera.position); }
        if (F && sealed(F.o)) { if (!F.o.isConn) for (const b of run.P.eraseGroup(F.o)) V.outline(b.pos, b.rot, b.size, PALETTE.ink, strong ? 0.5 : 0.25, 0.0022, camera.position); }
        else if (F) {
          const k = strong ? 1 : 0.6, pulse = 0.8 + 0.2 * Math.sin(time * 5);
          if (!F.o.isConn) for (const b of run.P.eraseGroup(F.o)) V.outline(b.pos, b.rot, b.size, PALETTE.unmake, 0.95 * pulse * k, 0.0032, camera.position);
          for (const c of consequences(F)) {
            const sz = c.b.shape === 'sphere' ? [c.b.r, c.b.r, c.b.r] : c.b.size;
            // ink, like a drawing: what moves, and (seen through anything) where it will settle
            V.outline(c.b.pos, c.b.rot, sz, PALETTE.ink, 0.85 * k, 0.003, camera.position);
            if (c.rest) V.outline(c.rest.pos, c.rest.rot, sz, PALETTE.ink, (0.45 + 0.35 * pulse) * k, 0.0026, camera.position, true);
          }
        }
        V.updateGhosts(dt, camera.position);
        V.endOutlines();
        for (const s of run.segs) for (const w of s.waterViews || []) if (w.userData.water) { w.position.y = w.userData.water.level; w.visible = w.userData.water.level > w.userData.water.target - 50 && w.userData.water.level > (w.userData.water.minShow || -1e9); }
        if (run.growing) for (const g of run.growing) if (g.userData.grow < 1) { g.userData.grow = Math.min(1, g.userData.grow + dt * 0.5); g.scale.setScalar(smooth(g.userData.grow)); }
        for (const p of run.pickups) if (p.view) { p.view.position.set(p.pos[0], p.pos[1] + Math.sin(time * 2.2 + p.pos[2]) * 0.08, p.pos[2]); p.view.visible = !p.sealed || p.ride; if (p.view.userData.spin) p.view.userData.spin.rotation.y += dt * 2; }
        const g = run.P.groundAt(pl.pos[0], pl.pos[2], pl.pos[1] + 0.3);
        const narrow = pl.grounded && pl.ground && Math.min(pl.ground.size[0], pl.ground.size[2]) < 0.6;
        rig.update(dt, pl, { onStep: k => audio.step(matOf(pl.ground), k), narrow, reach: run.beam > 0, accel: 0, groundY: isFinite(g.y) ? g.y : undefined });
        // the thread of unmaking: from the key to the target
        if (run.beam > 0 && run.beamTo) {
          run.beam -= dt; beam.visible = true;
          const from = cam.fp > 0.5 ? (hand.tip.getWorldPosition(_v), [_v.x, _v.y, _v.z]) : (rig.keyTip.getWorldPosition(_v), [_v.x, _v.y, _v.z]);
          V.setLine(beamLine, from, run.beamTo);
          beamMat.opacity = clamp(run.beam / 0.2, 0, 1) * 0.85;
        } else beam.visible = false;
        hand.g.position.copy(hand.rest).add(new THREE.Vector3(0, run.beam > 0 ? 0.05 : 0, run.beam > 0 ? -0.08 : 0));
        hand.g.position.y += Math.sin(time * 10) * 0.004 * clamp(Math.hypot(pl.vel[0], pl.vel[2]) / 5, 0, 1);
        // motes follow the eye
        motes.position.set(camera.position.x, camera.position.y, camera.position.z - 20);
        hud(dt);
        A.U.uBasin.value.set(PALETTE.basin);
        scene.fog.color.set(PALETTE.skyHorizon);
        audio.ambient(pl.pos[1] + 30);
      } else {
        // sanctuary / title: a slow orbit
        const c = S.center, a = time * 0.06, portrait = ctx.height > ctx.width;
        const dist = portrait ? 34 : 25;
        camera.position.set(c.x + Math.sin(a) * dist, c.y + dist * 0.46, c.z + Math.cos(a) * dist);
        camera.lookAt(c.x, c.y + 0.6, c.z);
        camera.fov = portrait ? 56 : 48; camera.updateProjectionMatrix();
        camera.setViewOffset(ctx.width, ctx.height, 0, ctx.height * (portrait ? 0.17 : 0.1), ctx.width, ctx.height);
        W.setVisible(true); W.update(c.z + 40, 0, time);
        sky.position.copy(camera.position);
        sun.position.set(c.x - 26, c.y + 30, c.z - 16); sun.target.position.copy(c); sun.target.updateMatrixWorld();
        rig.root.visible = true; hand.g.visible = false;
        rig.update(dt, { pos: [c.x - 2.6, 0, c.z + 2.4], vel: [0, 0, 0], grounded: true, stagger: 0 }, { accel: 0, groundY: 0 });
        A.U.uOccl.value = 0;
        A.U.uPlayer.value.set(c.x, -100, c.z);
        H.cross.style.display = 'none';
      }
      if (camera.view && camera.view.enabled && (mode === 'play' || mode === 'over' || mode === 'paused')) camera.clearViewOffset();
      V.updateFx(dt);
      A.U.uTime.value = time;
      renderer.render(scene, camera);
    }
    const beamMat = new THREE.MeshBasicMaterial({ color: PALETTE.unmake, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Group(); const beamLine = new THREE.Mesh(A.G.cyl6, beamMat); beamLine.scale.set(0.02, 1, 0.02); beam.add(beamLine); beam.visible = false; scene.add(beam);

    // ---------- HUD ----------
    let hc = {};
    function hud(dt) {
      const pl = run.player;
      const dist = Math.max(0, Math.floor(run.frontier));
      if (hc.d !== dist) { hc.d = dist; H.dist.innerHTML = dist + '<small>M</small>'; }
      const sc = Math.floor(run.score); if (hc.s !== sc) { hc.s = sc; H.score.textContent = sc.toLocaleString(); }
      // the Stillness: a hairline that fills from the right as it closes in
      const buf = run.stillZ - pl.pos[2];
      const near = clamp(1 - buf / 24, 0, 1);
      const w = Math.round(near * 104);
      if (hc.w !== w) { hc.w = w; H.stillB.style.width = w + 'px'; H.still.classList.toggle('near', buf < 9); }
      H.vig.style.opacity = clamp((7 - buf) / 6, 0, 1).toFixed(2);
      // first person: a dot, and corner ticks when something unmakeable is under it
      const fpMode = cam.fp > 0.5;
      H.cross.style.display = fpMode ? 'block' : 'none';
      if (fpMode) { const on = !!(run.focus && inRange(run.focus)); if (hc.x !== on) { hc.x = on; H.cross.querySelector('.t').setAttribute('opacity', on ? '1' : '0'); } }
      // first run: a ghost of the stick shows where steering lives, once
      if (run.intro > 0 && !hc.hint) { hc.hint = true; H.stick.classList.add('hint'); H.stick.style.left = (ctx.width * 0.22) + 'px'; H.stick.style.top = (ctx.height * 0.78) + 'px'; }
      if (run.intro > 0) { run.intro -= dt; if (run.intro <= 0 || input.stick) { H.stick.classList.remove('hint'); if (!input.stick) H.stick.style.display = 'none'; run.intro = 0; if (!save.seenIntro) { save.seenIntro = true; persist(); } } }
    }

    // ---------- flow ----------
    function showOnly(p) { for (const x of [H.title, H.over, H.sanct, H.mems, H.set]) x.classList.toggle('on', x === p); }
    function setPlayHud(on) { for (const e of [H.top, H.jump]) e.style.display = on ? '' : 'none'; if (!on) { H.cross.style.display = 'none'; H.stick.style.display = 'none'; H.stick.classList.remove('hint'); } }
    function begin() {
      audio.unlock();
      try { if (caps.backgroundMusic && ctx.music && save.settings.music) { ctx.music.unlock(); ctx.music.play({ preset: 'drift', volume: 0.22, intensity: 0.25, fadeInMs: 2500 }); } } catch (e) { }
      newRun();
      mode = 'play'; hc = {};
      showOnly(null); setPlayHud(true);
      camera.clearViewOffset();
      try { ctx.platform.start({ run: save.runs + 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function endRun(reason) {
      if (!run || run.over) return;
      run.over = true; mode = 'over';
      const dist = Math.floor(run.frontier);
      const best = run.score > save.best;
      save.best = Math.max(save.best, Math.floor(run.score)); save.bestDist = Math.max(save.bestDist, dist);
      save.bank += run.salvage; save.runs++;
      persist();
      try { ctx.platform.fail({ score: Math.floor(run.score), distance: dist, reason }); } catch (e) { }
      if (scoreTrack) { try { scoreTrack.set(Math.floor(run.score)); scoreTrack.submit('score', { label: Math.floor(run.score) + ' pts' }).catch(() => { }); } catch (e) { } }
      const titles = { stilled: 'The Stillness reached you', crushed: 'Caught beneath the falling city', fell: 'The basin took you' };
      const lessons = { stilled: 'Waiting costs ground. Read the structure while you move.', crushed: 'The outline shows what will fall. Stand clear of it.', fell: 'With the Stillness this close, nothing could catch you.' };
      H.oh.textContent = titles[reason] || 'The journey ends';
      H.osub.innerHTML = (best ? '<span class="um-new">New best</span> · ' : '') + (lessons[reason] || '');
      H.ostats.innerHTML = `<div><b>${Math.floor(run.score).toLocaleString()}</b>SCORE</div><div><b>${dist} m</b>DISTANCE</div><div><b>${run.salvage}</b>SALVAGE</div>`;
      const lines = [];
      lines.push(`<div class="um-li"><span>Encounters crossed</span><b>${run.encounters}</b></div>`);
      if (run.skillful) lines.push(`<div class="um-li"><span>Crossed on movement alone</span><b>${run.skillful}</b></div>`);
      if (run.chains) lines.push(`<div class="um-li"><span>Chain reactions</span><b>${run.chains}</b></div>`);
      lines.push(`<div class="um-li"><span>Unmade</span><b>${run.interventions}</b></div>`);
      for (const r of run.relicsNew) lines.push(`<div class="um-mem"><span class="um-new">Recovered</span> — “${MEMORIES[r]}”</div>`);
      const next = RESTORATIONS[save.restored];
      if (next) lines.push(`<div class="um-li"><span>Sanctuary: ${next.name}</span><b>${save.bank}/${next.cost}</b></div>`);
      H.olist.innerHTML = lines.join('');
      showOnly(H.over); setPlayHud(false);
    }
    function showTitle() {
      mode = 'title'; disposeRun();
      showOnly(H.title); setPlayHud(false);
      H.tstats.innerHTML = `<div><b>${save.best.toLocaleString()}</b>BEST</div><div><b>${save.bank}</b>SALVAGE</div><div><b>${save.relics.length}/${MEMORIES.length}</b>MEMORIES</div>`;
      S.apply(save.restored);
    }
    function showSanct() {
      mode = 'sanct'; disposeRun(); showOnly(H.sanct); setPlayHud(false); renderSanct();
    }
    function renderSanct() {
      H.sbank.textContent = `Salvage ${save.bank} · ${save.restored}/${RESTORATIONS.length} restored`;
      H.slist.innerHTML = RESTORATIONS.map((m, i) => i < save.restored ? `<div class="um-li done"><span>${m.name}</span><b>✓</b></div>` : i === save.restored ? `<div class="um-li"><span>${m.name}<br><small>${m.cost} salvage</small></span><button class="um-mini" data-r="${i}" ${save.bank < m.cost ? 'disabled' : ''}>RESTORE</button></div>` : `<div class="um-li" style="opacity:.4"><span>${m.name}</span><b>${m.cost}</b></div>`).join('');
      S.apply(save.restored);
    }
    function renderSettings(inRun) {
      const s = save.settings;
      H.slist2.innerHTML =
        `<div class="um-set"><span>View</span><span><button class="um-tog ${s.view === 'third' ? 'on' : ''}" data-v="third">THIRD</button> <button class="um-tog ${s.view === 'first' ? 'on' : ''}" data-v="first">FIRST</button></span></div>` +
        `<div class="um-set"><span>Look sensitivity</span><input type="range" min="0.4" max="2" step="0.1" value="${s.look}" data-k="look"></div>` +
        `<div class="um-set"><span>Steering sensitivity</span><input type="range" min="0.5" max="1.5" step="0.05" value="${s.steer}" data-k="steer"></div>` +
        `<div class="um-set"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></div>` +
        `<div class="um-set"><span>Music</span><button class="um-tog ${s.music ? 'on' : ''}" data-t="music">${s.music ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>Reduce camera motion</span><button class="um-tog ${s.reduceMotion ? 'on' : ''}" data-t="reduceMotion">${s.reduceMotion ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>Free unmaking (no limit per stretch)</span><button class="um-tog ${s.freeUnmaking ? 'on' : ''}" data-t="freeUnmaking">${s.freeUnmaking ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>High-visibility targets</span><button class="um-tog ${s.highVis ? 'on' : ''}" data-t="highVis">${s.highVis ? 'ON' : 'OFF'}</button></div>`;
      H.resume.parentNode.style.display = inRun ? '' : 'none';
      H.setBack.style.display = inRun ? 'none' : '';
    }
    function pauseGame() { if (mode !== 'play') return; mode = 'paused'; renderSettings(true); showOnly(H.set); }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; showOnly(null); }
    const click = (e, fn) => ctx.listen(e, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    click(H.begin, begin); click(H.again, begin);
    click(H.toSanct, showSanct); click(H.oSanct, showSanct); click(H.sback, showTitle);
    click(H.smem, () => { showOnly(H.mems); const got = save.relics.slice().sort((a, b) => a - b); H.mlist.innerHTML = got.length ? got.map(i => `<div class="um-mem">“${MEMORIES[i]}”</div>`).join('') + `<div class="um-sub" style="margin-top:8px">${MEMORIES.length - got.length} still sealed somewhere in the city.</div>` : '<div class="um-sub">Relics wait behind repairs, beneath the routes, inside the mechanisms.</div>'; });
    click(H.mback, () => showOnly(H.sanct));
    click(H.toSet, () => { mode = 'settings'; renderSettings(false); showOnly(H.set); });
    click(H.setBack, showTitle); click(H.resume, resumeGame);
    click(H.quit, () => { mode = 'play'; showOnly(null); endRun('stilled'); });
    ctx.listen(H.slist, 'click', e => {
      const b = e.target.closest && e.target.closest('[data-r]'); if (!b) return;
      const i = +b.getAttribute('data-r'), m = RESTORATIONS[i];
      if (i !== save.restored || save.bank < m.cost) return;
      save.bank -= m.cost; save.restored++; persist(); audio.restore(); haptic('success');
      try { ctx.platform.milestone('restore_' + m.id); } catch (e) { }
      renderSanct();
    });
    ctx.listen(H.slist2, 'click', e => {
      const t = e.target;
      if (t.dataset.v) { save.settings.view = t.dataset.v; persist(); renderSettings(mode === 'paused'); }
      if (t.dataset.t) { save.settings[t.dataset.t] = !save.settings[t.dataset.t]; persist(); renderSettings(mode === 'paused'); if (t.dataset.t === 'music') { try { if (!save.settings.music) ctx.music.stop({ fadeOutMs: 600 }); } catch (er) { } } }
    });
    ctx.listen(H.slist2, 'input', e => { const t = e.target; if (t.dataset.k) { save.settings[t.dataset.k] = +t.value; if (t.dataset.k === 'volume') audio.setVolume(+t.value); persist(); } });

    // ---------- input ----------
    const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyE', 'KeyV', 'KeyP', 'Escape']);
    ctx.listen(window, 'keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (mode === 'title' && (e.code === 'Space' || e.code === 'Enter')) { begin(); return; }
      if (mode === 'over' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR')) { begin(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); return; }
      if (mode !== 'play') return;
      audio.unlock();
      if (e.repeat) return;
      input.keys.add(e.code);
      if (e.code === 'Space') { input.jumpPressed = true; input.jumpHeld = true; }
      if (e.code === 'KeyV') toggleView();
      if (e.code === 'KeyE') { if (run.focus) intervene(run.focus); }
    });
    ctx.listen(window, 'keyup', e => {
      input.keys.delete(e.code);
      if (e.code === 'Space') input.jumpHeld = false;
    });
    ctx.listen(window, 'blur', () => { input.keys.clear(); input.jumpHeld = false; if (mode === 'play') pauseGame(); });
    function toggleView() { save.settings.view = save.settings.view === 'first' ? 'third' : 'first'; persist(); if (save.settings.view === 'first') { cam.yaw = 0; cam.pitch = -0.1; } }
    // pointers: each finger owns one role (stick, jump, look, intervene)
    const roles = new Map();
    const rect = () => canvas.getBoundingClientRect();
    function onDown(e) {
      if (mode !== 'play') return;
      audio.unlock();
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.cancelable) e.preventDefault();
      const fp = cam.fp > 0.5;
      const touch = e.pointerType === 'touch';
      if (touch && x < ctx.width * 0.45 && y > ctx.height * 0.38) {
        roles.set(e.pointerId, { role: 'stick' });
        input.stick = { ox: x, oy: y, x, y, id: e.pointerId };
        H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = '';
        return;
      }
      // intervene: tap a target (third person), or the crosshair (first person)
      let t = null;
      if (!fp) { const [o, d] = rayFromScreen(x, y); t = pickRay(o, d, 60); if (t && !inRange(t)) t = null; }
      roles.set(e.pointerId, { role: fp ? 'look' : 'act', x0: x, y0: y, x, y, t0: performance.now(), target: t, acted: false });
      if (!fp && t) { const R = roles.get(e.pointerId); R.acted = true; R.press = t; t.deps = run.P.dependents(t.o); run.press = t; if (e.pointerType !== 'touch') { intervene(t, t.point); run.press = null; R.press = null; } else haptic('light'); }
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    }
    function onMove(e) {
      const R = roles.get(e.pointerId);
      if (!R) {
        // desktop: hovering an element previews exactly what it will do
        if (e.pointerType === 'mouse' && mode === 'play' && run && cam.fp < 0.5) {
          const r = rect(); const [o, d] = rayFromScreen(e.clientX - r.left, e.clientY - r.top); const t = pickRay(o, d, 60);
          if (t && inRange(t)) { if (!run.press || run.press.o !== t.o) { t.deps = run.P.dependents(t.o); run.press = t; } else run.press.point = t.point; } else run.press = null;
        }
        return;
      }
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (R.role === 'stick' && input.stick) {
        input.stick.x = x; input.stick.y = y;
        const dx = clamp(x - input.stick.ox, -50, 50), dy = clamp(y - input.stick.oy, -50, 50);
        H.knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (R.role === 'look') {
        const s = save.settings.look * 0.0055;
        cam.yaw = clamp(cam.yaw - (x - R.x) * s, -1.3, 1.3);
        cam.pitch = clamp(cam.pitch - (y - R.y) * s, -1.2, 0.9);
        R.x = x; R.y = y;
      } else if (R.press && run) {
        // sliding off the element cancels; sliding onto another retargets
        R.x = x; R.y = y;
        const [o, d] = rayFromScreen(x, y); const t = pickRay(o, d, 60);
        if (!t || !inRange(t)) { R.press = null; run.press = null; }
        else if (t.o !== R.press.o) { t.deps = run.P.dependents(t.o); R.press = t; run.press = t; }
        else R.press.point = t.point;
      }
    }
    function onUp(e) {
      const R = roles.get(e.pointerId); if (!R) return;
      roles.delete(e.pointerId);
      if (R.role === 'stick') { input.stick = null; H.stick.style.display = 'none'; }
      if (R.press && run) { const t = R.press; run.press = null; if (e.type === 'pointerup' && t.o.alive) intervene(t, t.point); }
      if (R.role === 'look') {
        const moved = Math.hypot(R.x - R.x0, R.y - R.y0);
        if (moved < 10 && performance.now() - R.t0 < 350 && run && run.focus) intervene(run.focus, run.focus.point);
      }
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(H.jump, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); input.jumpPressed = true; input.jumpHeld = true; audio.unlock(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ctx.listen(H.jump, ev, () => { input.jumpHeld = false; });
    ctx.listen(H.view, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); toggleView(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    // desktop first person: mouse movement looks while a button is held
    ctx.listen(canvas, 'wheel', e => e.preventDefault(), { passive: false });

    // ---------- layout ----------
    function layout(w, h, safe) {
      const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
      H.top.style.paddingTop = (16 + top) + 'px';
      const js = Math.round(clamp(Math.min(w, h) * 0.2, 72, 88));
      Object.assign(H.jump.style, { width: js + 'px', height: js + 'px', right: '24px', bottom: (bot + 32) + 'px' });
      H.head.style.top = (top + h * 0.08) + 'px';
      for (const p of [H.title, H.over, H.sanct, H.mems, H.set]) p.style.paddingBottom = (bot + 16) + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      V.pmat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.5;
    }
    ctx.onResize(({ width, height, safeArea }) => layout(width, height, safeArea || ctx.safeArea), { immediate: true });

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (mode === 'play') { acc += dt; let n = 0; while (acc >= DT && n < 5) { step(DT); acc -= DT; n++; } if (n === 5) acc = 0; }
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    showTitle();
    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__UNMAKE_DEV) {
      window.__unmake = {
        begin, showSanct, showTitle, toggleView, pauseGame, resumeGame,
        get run() { return run; }, get mode() { return mode; }, save: () => save, cam, input, camera, scene, renderer,
        advance(sec, inp) { if (inp) input.virtual = inp; const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) { if (inp && inp.jump) { input.jumpPressed = true; input.jumpHeld = true; } step(DT); } frame(DT); },
        act(key, segName) { const s = run.segs.find(q => q.name === segName && !q.cleared); const o = s && s.meta.keys[key]; if (!o) return 'missing'; if (!o.alive) return 'gone'; if (sealed(o)) return 'sealed'; return intervene({ o, role: 'unmake' }) ? 'ok' : 'fail'; },
        targetScreen() { if (!run.focus) return null; const p = targetPoint(run.focus); _v.set(p[0], p[1], p[2]).project(camera); return { x: (_v.x * 0.5 + 0.5) * ctx.width, y: (-_v.y * 0.5 + 0.5) * ctx.height, role: run.focus.role, key: run.focus.o.key, deps: (run.focus.deps || []).length }; },
        screenOf(key, segName) { const s = run.segs.find(q => q.name === segName); const o = s && s.meta.keys[key]; if (!o) return null; const p = o.isConn ? run.P.connMid(o) : o.pos; _v.set(p[0], p[1], p[2]).project(camera); return { x: (_v.x * 0.5 + 0.5) * ctx.width, y: (-_v.y * 0.5 + 0.5) * ctx.height, alive: o.alive }; },
        get press() { return run && run.press ? (run.press.o.key || run.press.o.id) : null; },
        preview(key, segName) { const s = run.segs.find(q => q.name === segName && !q.cleared); const o = s && s.meta.keys[key]; if (!o) return false; run.press = { o, role: 'unmake', deps: run.P.dependents(o) }; return true; },
        warp(segName, dz) { for (let i = 0; i < 30 && !run.segs.some(q => q.name === segName); i++) addSegment(); const s = run.segs.find(q => q.name === segName); if (!s) return false; const p = [s.meta.origin[0], s.meta.origin[1] + 0.02, s.z0 + (dz || 0)]; run.player.reset(p); run.stillZ = p[2] + 24; cam.init = false; return true; },
        frame: () => frame(DT), step
      };
    }
  }
};

})();
