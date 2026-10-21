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
//   kin     — scripted movement (lifts, floats on water, presses).
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
        case 'kin': if (b.drive) b.drive(this, b, dt); break;
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
