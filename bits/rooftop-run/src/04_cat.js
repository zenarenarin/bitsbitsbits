// =====================================================================
// The cat's body in the world: movement, jumping, landing, balance.
// Pure simulation: no three.js, no DOM. The rig (07_catrig) reads the
// state this produces; it never writes back.
//
// The cat always runs toward -z. The player steers across the roofs and
// jumps. Everything else (ducking under things, steadying on a ledge,
// catching an edge it came up short of) is the cat's own competence.
// =====================================================================

class Cat {
  constructor(world) { this.world = world; this.reset([0, 0, 0]); }

  reset(p, speed) {
    this.pos = p.slice(); this.prev = p.slice();
    this.vel = [0, 0, -(speed || 0)];
    this.fwd = speed || 0;            // forward speed (positive = toward -z)
    this.grounded = false; this.ground = null; this.groundY = p[1];
    this.coyote = 0; this.buffer = 0; this.holdT = 0; this.rising = false;
    this.crouch = 0; this.height = TUNING.cat.standHeight;
    this.gripT = 0; this.teeter = 0; this.edgeAhead = 0; this.narrow = 0;
    this.stumble = 0; this.landSlow = 0; this.airTime = 0; this.sinceLand = 9; this.sinceJump = 9;
    this.scr = null; this.assistX = 0;
    this.lastGroundY = p[1]; this.fallFrom = p[1];
    this.events = [];
    this.stats = { lastJump: null };
    this._jump = null;
  }

  // input: { steer -1..1, jumpPressed (this step), jumpHeld }
  step(dt, input) {
    const C = TUNING.cat, W = this.world;
    this.prev = this.pos.slice();
    this.sinceLand += dt; this.sinceJump += dt;
    if (this.scr) { this.stepScramble(dt); return; }

    // ---- 1. forward momentum: always running, with weight ----
    let target = C.cruise;
    if (this.landSlow > 0) { this.landSlow -= dt; target *= lerp(1, C.hardLandingSlow, clamp(this.landSlow / C.hardLandingTime, 0, 1)); }
    if (this.stumble > 0) { this.stumble -= dt; target *= lerp(1, C.stumbleSpeed, clamp(this.stumble / C.stumbleTime, 0, 1)); }
    if (this.grounded) {
      // accelerate gently, a little quicker from a standstill
      const a = C.accel * (this.fwd < C.cruise * 0.5 ? 1 + C.startBoost : 1);
      this.fwd = this.fwd < target ? Math.min(target, this.fwd + a * dt) : Math.max(target, this.fwd - a * 1.6 * dt);
    }

    // ---- 2. steering ----
    const box = this.grounded ? this.ground : null;
    const w = box ? box.x1 - box.x0 : 99;
    this.narrow = damp(this.narrow, box && w < C.narrowWidth ? 1 : 0, 10, dt);
    let steer = clamp(input.steer || 0, -1, 1);
    let latMax = C.lateral * lerp(1, C.narrowLateral, this.narrow);
    let tvx = steer * latMax;
    // on a ledge, an idle stick lets the cat find the middle by itself
    if (box && this.narrow > 0.5 && Math.abs(steer) < 0.3) tvx += ((box.x0 + box.x1) / 2 - this.pos[0]) * C.narrowCentering * (1 - Math.abs(steer) / 0.3);
    if (box && TUNING.assist.enabled && this.narrow < 0.5) tvx += this.alignToNarrow(steer);
    const la = this.grounded ? (Math.abs(tvx) < Math.abs(this.vel[0]) || sign(tvx) !== sign(this.vel[0]) ? C.lateralDecel : C.lateralAccel) : C.lateralAccelAir;
    this.vel[0] += clamp(tvx - this.vel[0], -la * dt, la * dt);

    // ---- 3. edge grip: steering off the side of a roof is resisted briefly ----
    this.teeter = damp(this.teeter, 0, 6, dt);
    if (this.grounded && Math.abs(this.vel[0]) > 0.05) {
      const s = sign(this.vel[0]);
      const nx = this.pos[0] + this.vel[0] * dt + s * 0.02;
      const g = W.groundAt(nx, this.pos[2], this.pos[1] + C.stepUp, 0.02, C.halfLength * 0.6);
      if (g.y < this.pos[1] - 0.3) {
        if (this.gripT < C.edgeGrip || sign(steer) !== s) {
          this.gripT += sign(steer) === s ? dt : 0;
          this.vel[0] = 0; this.teeter = Math.max(this.teeter, 0.6 + 0.4 * Math.abs(steer));
        }
      } else this.gripT = Math.max(0, this.gripT - dt * 2);
    } else if (this.grounded) this.gripT = Math.max(0, this.gripT - dt * 2);

    // ---- 4. jump: buffered, with coyote time and variable height ----
    if (input.jumpPressed) this.buffer = C.buffer; else this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? C.coyote : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.sinceJump > 0.15) this.doJump();
    const held = TUNING.input.jumpMode === 'tap' ? true : !!input.jumpHeld;
    if (this.rising) { this.holdT += dt; if (this.vel[1] <= 0) this.rising = false; }

    // ---- 5. gravity ----
    if (!this.grounded) {
      let g = C.gravity;
      if (this.vel[1] < 0) g *= C.fallMul;
      else if (this.rising && !held && this.holdT > C.jumpMinHold) g *= C.jumpCut;
      this.vel[1] = Math.max(-C.maxFall, this.vel[1] - g * dt);
      this.airTime += dt;
    } else this.vel[1] = 0;

    // ---- 6. in-air assistance ----
    this.assistX = 0;
    if (!this.grounded && TUNING.assist.enabled) {
      this.assistLateral(dt);
      if (TUNING.assist.scramble && this.vel[1] < 0.5 && this.tryScramble()) return;
    }

    // ---- 7. ducking: flatten under anything with room for a crouching cat ----
    this.updateCrouch(dt);

    // ---- 8. integrate and collide, one axis at a time ----
    this.vel[2] = -this.fwd;
    this.moveX(this.vel[0] * dt);
    this.moveZ(this.vel[2] * dt);
    this.moveY(this.vel[1] * dt);
    this.support();

    // ---- 9. reading the ground ahead (for the rig and the camera) ----
    this.edgeAhead = 0;
    if (this.grounded) {
      for (let d = 0.5; d <= 2.6; d += 0.35) {
        const g = W.groundAt(this.pos[0], this.pos[2] - C.halfLength - d, this.pos[1] + C.stepUp, 0.05, 0.05);
        if (g.y < this.pos[1] - 0.6) { this.edgeAhead = 1 - (d - 0.5) / 2.1; break; }
      }
      this.lastGroundY = this.pos[1];
    }
    if (this.grounded && this.ground && this.ground.far) this.events.push({ type: 'fall', reason: 'astray' });
    if (this.pos[1] < this.lastGroundY - C.killDepth) this.events.push({ type: 'fall', reason: 'drop' });
  }

  doJump() {
    const C = TUNING.cat;
    this.vel[1] = C.jumpVel;
    this.fwd += C.jumpForward;
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.sinceJump = 0; this.holdT = 0; this.rising = true;
    this.fallFrom = this.pos[1];
    this._jump = { x: this.pos[0], y: this.pos[1], z: this.pos[2], apex: this.pos[1] };
    this.events.push({ type: 'jump' });
  }

  // A narrow surface just ahead at running height, and the cat a little
  // off its line: ease toward it. Steering clearly away overrides this.
  alignToNarrow(steer) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    for (let d = 0.3; d <= A.alignAhead; d += 0.3) {
      const z = this.pos[2] - C.halfLength - d;
      const g = W.groundAt(this.pos[0], z, this.pos[1] + C.stepUp, A.alignReach, 0.05);
      const b = g.box;
      if (!b || b.x1 - b.x0 >= C.narrowWidth || Math.abs(g.y - this.pos[1]) > C.stepUp) continue;
      const cx = (b.x0 + b.x1) / 2, off = cx - this.pos[0];
      if (Math.abs(steer) > 0.5 && sign(steer) !== sign(off)) return 0;
      return off * A.alignStrength * (1 - Math.abs(steer) * 0.5);
    }
    return 0;
  }

  updateCrouch(dt) {
    const C = TUNING.cat, W = this.world;
    const ahead = C.halfLength + 0.25 + this.fwd * 0.12;
    const c = W.ceilingAt(this.pos[0], this.pos[2] - ahead / 2, this.pos[1] + 0.02, C.halfWidth, C.halfLength + ahead / 2);
    const room = c.y - this.pos[1];
    const want = room < C.standHeight + 0.04 && room >= C.crouchHeight ? 1 : 0;
    // only stand up once there is room right above
    const above = W.ceilingAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth, C.halfLength).y - this.pos[1];
    if (want || above < C.standHeight) this.crouch = 1;
    else this.crouch = 0;
    this.height = this.crouch ? C.crouchHeight : C.standHeight;
    void dt;
  }

  // ---- collision, axis by axis, against boxes ----
  catBox(x, y, z, h) {
    const C = TUNING.cat;
    return [x - C.halfWidth, x + C.halfWidth, y, y + h, z - C.halfLength, z + C.halfLength];
  }
  moveX(dx) {
    if (!dx) return;
    const C = TUNING.cat;
    this.pos[0] += dx;
    const b = this.catBox(this.pos[0], this.pos[1] + 0.01, this.pos[2], this.height - 0.01);
    for (const o of this.world.overlaps(...b)) {
      if (this.canStep(o)) { this.stepOnto(o); continue; }
      if (dx > 0) this.pos[0] = o.x0 - C.halfWidth - 1e-4; else this.pos[0] = o.x1 + C.halfWidth + 1e-4;
      this.vel[0] = 0;
    }
  }
  moveZ(dz) {
    if (!dz) return;
    const C = TUNING.cat;
    this.pos[2] += dz;
    const b = this.catBox(this.pos[0], this.pos[1] + 0.01, this.pos[2], this.height - 0.01);
    for (const o of this.world.overlaps(...b)) {
      if (this.canStep(o)) { this.stepOnto(o); continue; }
      // nose-first into something: push out and stumble
      this.pos[2] = dz < 0 ? o.z1 + C.halfLength + 1e-4 : o.z0 - C.halfLength - 1e-4;
      if (this.fwd > 2.5) this.events.push({ type: 'bump', speed: this.fwd });
      if (this.fwd > 2.5 || this.stumble <= 0) this.stumble = C.stumbleTime;
      this.fwd = Math.min(this.fwd, 1.0);
    }
  }
  // small lips are stepped onto: anything up to stepUp while running, and
  // a few centimetres while coming down (so a near-miss isn't a wall)
  canStep(o) {
    const C = TUNING.cat, lift = o.y1 - this.pos[1];
    if (!o.walk || lift < -1e-3) return false;
    if (this.grounded ? lift > C.stepUp : (this.vel[1] > 0 || lift > 0.12)) return false;
    return this.headroom(o.y1);
  }
  stepOnto(o) {
    this.pos[1] = o.y1;
    if (!this.grounded) { this.land(o); this.grounded = true; }
    this.ground = o;
  }
  headroom(y) {
    const C = TUNING.cat;
    return this.world.ceilingAt(this.pos[0], this.pos[2], y + 0.01, C.halfWidth, C.halfLength).y - y >= C.crouchHeight;
  }
  moveY(dy) {
    const C = TUNING.cat, W = this.world;
    const y0 = this.pos[1];
    this.pos[1] += dy;
    if (dy < 0) {
      // swept: land on the highest top we crossed this step
      let best = null;
      for (const o of W.near(this.pos[2] - C.halfLength, this.pos[2] + C.halfLength)) {
        if (this.pos[0] + C.halfWidth * 0.6 <= o.x0 || this.pos[0] - C.halfWidth * 0.6 >= o.x1) continue;
        if (this.pos[2] + C.halfLength * 0.7 <= o.z0 || this.pos[2] - C.halfLength * 0.7 >= o.z1) continue;
        if (o.y1 <= y0 + 1e-4 && o.y1 >= this.pos[1] && (!best || o.y1 > best.y1)) best = o;
      }
      if (best) {
        this.pos[1] = best.y1;
        if (!this.grounded) this.land(best);
        this.ground = best; this.grounded = true;
      }
    } else if (dy > 0) {
      const h = this.height;
      for (const o of W.near(this.pos[2] - C.halfLength, this.pos[2] + C.halfLength)) {
        if (this.pos[0] + C.halfWidth <= o.x0 || this.pos[0] - C.halfWidth >= o.x1 || this.pos[2] + C.halfLength <= o.z0 || this.pos[2] - C.halfLength >= o.z1) continue;
        if (o.y0 >= y0 + h - 1e-4 && o.y0 <= this.pos[1] + h) { this.pos[1] = o.y0 - h; this.vel[1] = 0; this.rising = false; this.events.push({ type: 'bonk' }); }
      }
    }
  }
  // grounded: is there still something under the paws?
  support() {
    if (!this.grounded) return;
    const C = TUNING.cat;
    const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth * 0.45, C.halfLength * 0.55);
    if (g.box && g.y >= this.pos[1] - 0.22) { this.pos[1] = g.y; this.ground = g.box; return; }
    this.grounded = false; this.ground = null; this.fallFrom = this.pos[1];
    this.events.push({ type: 'leave' });
  }
  land(box) {
    const C = TUNING.cat;
    const impact = -this.vel[1];
    this.vel[1] = 0; this.rising = false;
    if (impact > C.hardLanding) this.landSlow = C.hardLandingTime;
    if (this._jump) {
      this.stats.lastJump = { dist: Math.abs(this.pos[2] - this._jump.z), rise: this._jump.apex - this._jump.y, drop: this._jump.y - this.pos[1], air: this.airTime };
      this._jump = null;
    }
    this.events.push({ type: 'land', impact, drop: this.fallFrom - this.pos[1], surface: box.surface, narrow: box.x1 - box.x0 < C.narrowWidth });
    this.airTime = 0; this.sinceLand = 0;
    this.lastGroundY = this.pos[1];
  }

  // Predict where this arc lands. If it would just miss a surface to the
  // side, ease toward it: the cat twists in the air, as cats do.
  assistLateral(dt) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    if (this._jump) this._jump.apex = Math.max(this._jump.apex, this.pos[1]);
    let x = this.pos[0], y = this.pos[1], z = this.pos[2], vy = this.vel[1];
    const h = 1 / 30;
    for (let i = 0; i < 40; i++) {
      const ny = y + vy * h; vy -= C.gravity * (vy < 0 ? C.fallMul : 1) * h;
      z -= this.fwd * h; x += this.vel[0] * h;
      if (vy < 0) {
        const exact = W.groundAt(x, z, y, C.halfWidth * 0.6, C.halfLength * 0.7);
        if (exact.box && exact.y >= ny && exact.box.walk) return;      // already landing on something
        const wide = W.groundAt(x, z, y, C.halfWidth + A.lateralReach, C.halfLength * 0.7);
        if (wide.box && wide.y >= ny && wide.box.walk) {
          const b = wide.box, m = Math.min(0.15, (b.x1 - b.x0) / 2);
          const tx = clamp(x, b.x0 + m, b.x1 - m);
          const t = (i + 1) * h, need = (tx - x) / t;
          this.vel[0] += clamp(need, -A.lateralAccel * dt, A.lateralAccel * dt);
          this.assistX = sign(tx - x);
          return;
        }
      }
      y = ny;
      if (y < this.pos[1] - 4) return;
    }
  }

  // Came up just short of an edge in front? Front paws hook it, hind legs push.
  tryScramble() {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    const front = this.pos[2] - C.halfLength;
    for (const o of W.near(front - A.scrambleReach, front + 0.1)) {
      if (!o.walk || o.far) continue;
      if (o.z1 > front + 0.05 || o.z1 < front - A.scrambleReach) continue;
      if (this.pos[0] < o.x0 + 0.04 || this.pos[0] > o.x1 - 0.04) continue;
      const lift = o.y1 - this.pos[1];
      if (lift <= 0.02 || lift > A.scrambleDrop) continue;
      if (W.ceilingAt(this.pos[0], o.z1 - C.halfLength, o.y1 + 0.01, C.halfWidth, C.halfLength).y - o.y1 < C.crouchHeight) continue;
      this.scr = { t: 0, from: this.pos.slice(), to: [this.pos[0], o.y1, o.z1 - C.halfLength - 0.05], box: o, lift };
      this.vel = [0, 0, 0]; this.grounded = false;
      this.events.push({ type: 'scramble', lift });
      return true;
    }
    return false;
  }
  stepScramble(dt) {
    const C = TUNING.cat, A = TUNING.assist, s = this.scr;
    s.t += dt / A.scrambleTime;
    const k = clamp(s.t, 0, 1);
    // up first, then over the lip
    const ky = smooth(clamp(k * 1.5, 0, 1)), kz = smooth(clamp(k * 1.4 - 0.4, 0, 1));
    this.pos = [s.from[0], lerp(s.from[1], s.to[1], ky), lerp(s.from[2], s.to[2], kz)];
    this.crouch = 0; this.height = C.standHeight;
    if (k >= 1) {
      this.scr = null;
      this.grounded = true; this.ground = s.box; this.vel = [0, 0, 0];
      this.fwd = C.cruise * A.scrambleSpeed;
      this._jump = null; this.airTime = 0; this.sinceLand = 0; this.lastGroundY = this.pos[1];
      this.events.push({ type: 'land', impact: 3, drop: 0, surface: s.box.surface, scramble: true });
    }
  }
}
