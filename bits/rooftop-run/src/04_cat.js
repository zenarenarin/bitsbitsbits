// =====================================================================
// The cat's body in the world: movement, jumping, landing, balance.
// Pure simulation: no three.js, no DOM. The rig (08_catrig) reads the
// state this produces; it never writes back.
//
// The cat always runs toward -z. The player steers, sets the pace (the
// stick's vertical axis) and jumps. Everything else (ducking under things,
// steadying on a pipe, leaning into a roof slope, catching an edge it came
// up short of) is the cat's own competence.
// =====================================================================

class Cat {
  constructor(world) { this.world = world; this.reset([0, 0, 0]); }

  reset(p, speed) {
    this.pos = p.slice(); this.prev = p.slice();
    this.vel = [0, 0, -(speed || 0)];
    this.fwd = speed || 0;            // forward speed (positive = toward -z)
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.holdT = 0; this.rising = false;
    this.crouch = 0; this.height = TUNING.cat.standHeight;
    this.gripT = 0; this.teeter = 0; this.edgeAhead = 0; this.narrow = 0; this.pace = 0;
    this.slope = [0, 0];
    this.stumble = 0; this.landSlow = 0; this.airTime = 0; this.sinceLand = 9; this.sinceJump = 9; this.scalded = 0;
    this.scr = null; this.assistX = 0; this.halt = false;
    this.lastGroundY = p[1]; this.fallFrom = p[1];
    this.events = [];
    this.stats = { lastJump: null };
    this._jump = null;
  }

  // input: { steer -1..1, pace -1..1, jumpPressed (this step), jumpHeld }
  step(dt, input) {
    const C = TUNING.cat, W = this.world;
    this.prev = this.pos.slice();
    this.sinceLand += dt; this.sinceJump += dt;
    this.scalded = Math.max(0, this.scalded - dt);
    if (this.scr) { this.stepScramble(dt); return; }
    // ride a surface that is moving (a catwalk giving way)
    if (this.grounded && this.ground && this.ground.dy !== undefined) this.pos[1] = W.topAt(this.ground, this.pos[0], this.pos[2]) > -Infinity ? W.topAt(this.ground, this.pos[0], this.pos[2]) : this.pos[1];

    // ---- 1. pace: always moving forward; the stick's vertical axis sets how fast ----
    const pr = clamp(input.pace || 0, -1, 1), pd = C.paceDead;
    const p = Math.abs(pr) < pd ? 0 : sign(pr) * (Math.abs(pr) - pd) / (1 - pd);
    this.pace = damp(this.pace, p, 10, dt);
    let target = this.pace >= 0 ? lerp(C.cruise, C.sprint, this.pace) : lerp(C.cruise, C.walk, -this.pace);
    if (this.halt) target = 0;
    if (this.grounded) {
      // slopes: uphill costs speed, downhill gives a little
      const gz = this.slope[1];          // d height / d z: negative means rising ahead
      target *= clamp(1 + (gz < 0 ? gz * C.slopeClimb : gz * C.slopeDescend), 0.45, 1.25);
    }
    if (this.landSlow > 0) { this.landSlow -= dt; target *= lerp(1, C.hardLandingSlow, clamp(this.landSlow / C.hardLandingTime, 0, 1)); }
    if (this.stumble > 0) { this.stumble -= dt; target *= lerp(1, C.stumbleSpeed, clamp(this.stumble / C.stumbleTime, 0, 1)); }
    if (this.grounded) {
      const a = C.accel * (this.fwd < C.cruise * 0.5 ? 1 + C.startBoost : 1);
      this.fwd = this.fwd < target ? Math.min(target, this.fwd + a * dt) : Math.max(target, this.fwd - C.brake * dt);
    }

    // ---- 2. steering ----
    const box = this.grounded ? this.ground : null;
    const w = box ? W.walkWidth(box) : 99;
    this.narrow = damp(this.narrow, box && w < C.narrowWidth ? 1 : 0, 10, dt);
    let steer = this.halt ? 0 : clamp(input.steer || 0, -1, 1);
    let tvx = steer * C.lateral * lerp(1, C.narrowLateral, this.narrow);
    // a sideways slope (roof pitch, pipe curvature) draws the cat downhill
    if (box) tvx -= this.slope[0] * C.slopePush;
    // on a ledge or pipe, an idle stick lets the cat find the middle by itself
    if (box && this.narrow > 0.5 && Math.abs(steer) < 0.3) tvx += (W.centreX(box) - this.pos[0]) * C.narrowCentering * (1 - Math.abs(steer) / 0.3);
    if (box && TUNING.assist.enabled && this.narrow < 0.5) tvx += this.alignToNarrow(steer);
    const la = this.grounded ? (Math.abs(tvx) < Math.abs(this.vel[0]) || sign(tvx) !== sign(this.vel[0]) ? C.lateralDecel : C.lateralAccel) : C.lateralAccelAir;
    this.vel[0] += clamp(tvx - this.vel[0], -la * dt, la * dt);

    // ---- 3. edge grip: steering off a side edge is resisted briefly ----
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
    if (input.jumpPressed && !this.halt) this.buffer = C.buffer; else this.buffer = Math.max(0, this.buffer - dt);
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
    this.updateCrouch();

    // ---- 8. integrate and collide, one axis at a time ----
    this.vel[2] = -this.fwd;
    this.moveX(this.vel[0] * dt);
    this.moveZ(this.vel[2] * dt);
    this.moveY(this.vel[1] * dt);
    this.support();
    this.slope = this.grounded && this.ground ? W.grad(this.ground, this.pos[0], this.pos[2]) : [0, 0];

    // ---- 9. reading the ground ahead (for the rig and the camera) ----
    this.edgeAhead = 0;
    if (this.grounded) {
      for (let d = 0.5; d <= 2.6; d += 0.35) {
        const g = W.groundAt(this.pos[0], this.pos[2] - C.halfLength - d, this.pos[1] + 0.6, 0.05, 0.05);
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

  // steam: a scalding burst throws the cat up and stops it in its tracks
  scald(fromX) {
    const H = TUNING.hazards;
    if (this.scalded > 0) return;
    this.scalded = 0.8;
    this.vel[1] = H.steamKnockUp; this.grounded = false; this.ground = null; this.rising = false;
    this.vel[0] += sign(this.pos[0] - fromX || 1) * 0.6;
    this.fwd = Math.min(this.fwd, 0.6);
    this.stumble = H.steamStumble;
    this.fallFrom = this.pos[1];
    this.events.push({ type: 'scald' });
  }

  updateCrouch() {
    const C = TUNING.cat, W = this.world;
    const ahead = C.halfLength + 0.25 + this.fwd * 0.12;
    const c = W.ceilingAt(this.pos[0], this.pos[2] - ahead / 2, this.pos[1] + 0.02, C.halfWidth, C.halfLength + ahead / 2);
    const room = c.y - this.pos[1];
    const want = room < C.standHeight + 0.04 && room >= C.crouchHeight;
    const above = W.ceilingAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth, C.halfLength).y - this.pos[1];
    this.crouch = want || above < C.standHeight ? 1 : 0;
    this.height = this.crouch ? C.crouchHeight : C.standHeight;
  }

  // ---- collision, axis by axis ----
  hits(x, z) {
    const C = TUNING.cat;
    return this.world.solids(x - C.halfWidth, x + C.halfWidth, this.pos[1] + 0.01, this.pos[1] + this.height, z - C.halfLength, z + C.halfLength);
  }
  moveX(dx) {
    if (!dx) return;
    const C = TUNING.cat;
    this.pos[0] += dx;
    for (const h of this.hits(this.pos[0], this.pos[2])) {
      if (h.b.shape !== 'box' && !this.leadBlocks(h.b, sign(dx), 0)) continue;
      if (this.canStep(h)) { this.stepOnto(h); continue; }
      const o = h.b;
      if (o.shape !== 'box') { this.pos[0] -= dx; this.vel[0] = 0; return; }
      this.pos[0] = dx > 0 ? o.x0 - C.halfWidth - 1e-4 : o.x1 + C.halfWidth + 1e-4;
      this.vel[0] = 0;
    }
  }
  moveZ(dz) {
    if (!dz) return;
    const C = TUNING.cat;
    this.pos[2] += dz;
    for (const h of this.hits(this.pos[0], this.pos[2])) {
      if (h.b.shape !== 'box' && !this.leadBlocks(h.b, 0, sign(dz))) continue;
      if (this.canStep(h)) { this.stepOnto(h); continue; }
      const o = h.b;
      // nose-first into something: push out and stumble
      if (o.shape !== 'box') this.pos[2] -= dz;
      else this.pos[2] = dz < 0 ? o.z1 + C.halfLength + 1e-4 : o.z0 - C.halfLength - 1e-4;
      if (this.fwd > 2.5) this.events.push({ type: 'bump', speed: this.fwd });
      if (this.fwd > 2.5 || this.stumble <= 0) this.stumble = C.stumbleTime;
      this.fwd = Math.min(this.fwd, 1.0);
      return;
    }
  }
  // A shaped surface only blocks where it rises across the cat's leading
  // edge: the slope behind a cat running (or leaping) downhill is not a wall.
  leadBlocks(b, sx, sz) {
    const C = TUNING.cat, W = this.world, x = this.pos[0], z = this.pos[2], feet = this.pos[1];
    const pts = sz ? [[x - C.halfWidth, z + sz * C.halfLength], [x, z + sz * C.halfLength], [x + C.halfWidth, z + sz * C.halfLength]]
                   : [[x + sx * C.halfWidth, z - C.halfLength], [x + sx * C.halfWidth, z], [x + sx * C.halfWidth, z + C.halfLength]];
    const allow = this.grounded ? 0.02 : 0.12;
    for (const [px, pz] of pts) {
      const t = W.topAt(b, px, pz);
      if (t > feet + allow && W.bottomAt(b, px, pz) < feet + this.height) return true;
    }
    return false;
  }

  // small lips are stepped onto: up to stepUp while running (more on slopes),
  // a few centimetres while coming down (so a near-miss isn't a wall)
  canStep(h) {
    const C = TUNING.cat, lift = h.top - this.pos[1];
    if (!h.b.walk || lift < -1e-3) return false;
    const lim = h.b.shape === 'box' ? C.stepUp : C.slopeSnap;
    if (this.grounded ? lift > lim : (this.vel[1] > 0 || lift > 0.12)) return false;
    return this.headroom(h.top);
  }
  stepOnto(h) {
    this.pos[1] = h.top;
    if (!this.grounded) { this.land(h.b); this.grounded = true; }
    this.ground = h.b;
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
      // swept: land on the highest top crossed this step
      const g = W.groundAt(this.pos[0], this.pos[2], y0 + 1e-4, C.halfWidth * 0.6, C.halfLength * 0.7);
      if (g.box && g.y >= this.pos[1]) {
        this.pos[1] = g.y;
        if (!this.grounded) this.land(g.box);
        this.ground = g.box; this.grounded = true;
      }
    } else if (dy > 0) {
      const c = W.ceilingAt(this.pos[0], this.pos[2], y0 + this.height - 1e-4, C.halfWidth, C.halfLength);
      if (c.y <= this.pos[1] + this.height) { this.pos[1] = c.y - this.height; this.vel[1] = 0; this.rising = false; this.events.push({ type: 'bonk' }); }
    }
  }
  // grounded: follow the surface under the paws, up or down a slope
  support() {
    if (!this.grounded) return;
    const C = TUNING.cat;
    const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + C.slopeSnap, C.halfWidth * 0.45, C.halfLength * 0.55);
    if (g.box && g.y >= this.pos[1] - 0.22 && this.headroom(g.y)) { this.pos[1] = g.y; this.ground = g.box; return; }
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
    this.events.push({ type: 'land', impact, drop: this.fallFrom - this.pos[1], surface: box.surface, narrow: this.world.walkWidth(box) < C.narrowWidth });
    this.airTime = 0; this.sinceLand = 0;
    this.lastGroundY = this.pos[1];
  }

  // A narrow surface just ahead at running height, and the cat a little
  // off its line: ease toward it. Steering clearly away overrides this.
  alignToNarrow(steer) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    for (let d = 0.3; d <= A.alignAhead; d += 0.3) {
      const z = this.pos[2] - C.halfLength - d;
      const g = W.groundAt(this.pos[0], z, this.pos[1] + C.stepUp, A.alignReach, 0.05);
      const b = g.box;
      if (!b || W.walkWidth(b) >= C.narrowWidth || Math.abs(g.y - this.pos[1]) > C.stepUp) continue;
      const off = W.centreX(b) - this.pos[0];
      if (Math.abs(steer) > 0.5 && sign(steer) !== sign(off)) return 0;
      return off * A.alignStrength * (1 - Math.abs(steer) * 0.5);
    }
    return 0;
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
        if (exact.box && exact.y >= ny && exact.box.walk && !exact.box.far) return;
        const wide = W.groundAt(x, z, y, C.halfWidth + A.lateralReach, C.halfLength * 0.7);
        if (wide.box && wide.y >= ny && wide.box.walk && !wide.box.far) {
          const b = wide.box, cx = W.centreX(b), m = Math.min(0.15, W.walkWidth(b) / 2);
          const tx = clamp(x, cx - W.walkWidth(b) / 2 + m, cx + W.walkWidth(b) / 2 - m);
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
      const top = W.topAt(o, this.pos[0], o.z1 - 0.02);
      if (top === -Infinity) continue;
      const lift = top - this.pos[1];
      if (lift <= 0.02 || lift > A.scrambleDrop) continue;
      if (!this.headroomAt(this.pos[0], o.z1 - C.halfLength, top)) continue;
      this.scr = { t: 0, from: this.pos.slice(), to: [this.pos[0], top, o.z1 - C.halfLength - 0.05], box: o, lift };
      this.vel = [0, 0, 0]; this.grounded = false;
      this.events.push({ type: 'scramble', lift });
      return true;
    }
    return false;
  }
  headroomAt(x, z, y) {
    const C = TUNING.cat;
    return this.world.ceilingAt(x, z, y + 0.01, C.halfWidth, C.halfLength).y - y >= C.crouchHeight;
  }
  stepScramble(dt) {
    const C = TUNING.cat, A = TUNING.assist, s = this.scr;
    s.t += dt / A.scrambleTime;
    const k = clamp(s.t, 0, 1);
    const ky = smooth(clamp(k * 1.5, 0, 1)), kz = smooth(clamp(k * 1.4 - 0.4, 0, 1));
    this.pos = [s.from[0], lerp(s.from[1], s.to[1], ky), lerp(s.from[2], s.to[2], kz)];
    this.crouch = 0; this.height = C.standHeight;
    if (k >= 1) {
      this.scr = null;
      const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + C.slopeSnap, 0.05, 0.05);
      if (g.box) { this.pos[1] = g.y; this.ground = g.box; } else this.ground = s.box;
      this.grounded = true; this.vel = [0, 0, 0];
      this.fwd = C.cruise * A.scrambleSpeed;
      this._jump = null; this.airTime = 0; this.sinceLand = 0; this.lastGroundY = this.pos[1];
      this.events.push({ type: 'land', impact: 3, drop: 0, surface: s.box.surface, scramble: true });
    }
  }
}
