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
