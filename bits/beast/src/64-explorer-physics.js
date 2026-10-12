// ---- Explorer controller: grounded movement on the creature's body ----------
// Collides against the play anatomy's signed-distance field - the same field
// the painter fills - so the explorer stands exactly where fur is painted.
// Shape: a feet circle and a body circle. Grounded movement follows the
// surface tangent; walkable slopes are limited; small bumps are rolled over;
// ledges need a jump. World units are metres and seconds.

const PHYS = {
  gravity: 26,
  walk: 1.7, // careful pace
  run: 3.8, // faster pace (noisier, in Stage 3)
  accel: 11,
  brake: 16,
  airAccel: 5,
  jumpHeight: 2.1,
  maxFall: 22,
  walkableNy: 0.55, // surface normal y above this is ground (~57 degrees)
  feetR: 0.27,
  bodyR: 0.3,
  bodyY: 0.98,
  coyote: 0.1,
  jumpBuffer: 0.14,
  anticipation: 0.085,
  landTime: 0.16,
  snapDown: 0.45,
  fallReset: 28
};

// Height of a mushroom cap's top at x, or null beyond its rim.
function capTop(c, x) {
  const u = (x - c.x) / (c.a * 0.94);
  return Math.abs(u) < 1 ? c.y + c.b * Math.sqrt(1 - u * u) : null;
}

class Explorer {
  constructor(anat, spot, caps) {
    this.anat = anat;
    this.caps = caps || [];
    this.o = {};
    this.cullAt = null;
    this.prims = [];
    this.reset(spot);
  }

  reset(spot) {
    this.x = spot.x; this.y = spot.y;
    this.vx = 0; this.vy = 0;
    this.nx = 0; this.ny = 1;
    this.grounded = true;
    this.onCap = null;
    this.facing = spot.facing || -1;
    this.state = "idle";
    this.time = 0; this.phase = 0;
    this.anticipate = 0; this.landT = 0; this.landImpact = 0;
    this.coyoteT = 0; this.bufferT = 0; this.airLock = 0;
    this.lastGroundY = spot.y;
    this.safe = { x: spot.x, y: spot.y, facing: this.facing };
    this.safeT = 0;
    this.events = []; // landings / launches for feedback (and Stage 3 noise)
  }

  // Field queries, with a primitive cull cached around the explorer.
  sd(x, y) {
    if (!this.cullAt || Math.abs(x - this.cullAt.x) > 4 || Math.abs(y - this.cullAt.y) > 4) {
      this.cullAt = { x, y };
      this.prims = this.anat.cull(x - 10, y - 10, x + 10, y + 10);
    }
    return this.anat.eval(x, y, this.prims, this.o).sd;
  }

  normal(x, y) {
    const e = 0.02;
    const gx = this.sd(x + e, y) - this.sd(x - e, y);
    const gy = this.sd(x, y + e) - this.sd(x, y - e);
    const l = Math.hypot(gx, gy) || 1;
    return [gx / l, gy / l];
  }

  // Push both circles out of the body; drop velocity into surfaces. Returns
  // the walkable normal under the feet, if any.
  resolve() {
    let ground = null;
    for (let iter = 0; iter < 5; iter++) {
      let moved = false;
      for (const [oy, r, isFeet] of [[PHYS.feetR, PHYS.feetR, true], [PHYS.bodyY, PHYS.bodyR, false]]) {
        const d = this.sd(this.x, this.y + oy) - r;
        if (d >= 0) continue;
        const [nx, ny] = this.normal(this.x, this.y + oy);
        this.x -= nx * d; this.y -= ny * d;
        const vn = this.vx * nx + this.vy * ny;
        if (vn < 0) { this.vx -= nx * vn; this.vy -= ny * vn; }
        if (isFeet && ny > this.walkLimit()) ground = [nx, ny];
        moved = true;
      }
      if (!moved) break;
    }
    return ground;
  }

  // Hysteresis: a steep face must be clearly walkable to land on, but once
  // standing, the explorer keeps footing on it (no flicker at the limit).
  walkLimit() {
    return this.grounded ? PHYS.walkableNy - 0.08 : PHYS.walkableNy;
  }

  probeGround(dist) {
    for (const c of this.caps) {
      const t = capTop(c, this.x);
      if (t !== null && this.y >= t - 0.02 - dist && this.y <= t + 0.02) { this.y = Math.max(this.y, t); this.onCap = c; return [0, 1]; }
    }
    const r = PHYS.feetR;
    if (this.sd(this.x, this.y + r - dist) < r + 0.005) {
      const n = this.normal(this.x, this.y + r - dist);
      if (n[1] > this.walkLimit()) return n;
    }
    return null;
  }

  step(dt, input) {
    this.time += dt;
    this.coyoteT -= dt; this.bufferT -= dt; this.landT -= dt; this.airLock -= dt;
    if (input.jumpPressed) this.bufferT = PHYS.jumpBuffer;
    const run = input.run && input.dir !== 0;
    const target = input.dir * (run ? PHYS.run : PHYS.walk) * (input.speedScale || 1);
    if (input.dir) this.facing = Math.sign(input.dir);
    const wasGrounded = this.grounded;

    // Jump: anticipation crouch first, then launch.
    if (this.anticipate > 0) {
      this.anticipate -= dt;
      this.vx *= Math.exp(-12 * dt);
      if (this.anticipate <= 0) {
        this.vy = Math.sqrt(2 * PHYS.gravity * PHYS.jumpHeight * (input.jumpScale || 1));
        this.vx = this.vx * 0.6 + target * 0.55;
        this.grounded = false;
        this.coyoteT = 0;
        this.airLock = 0.12; // just launched: the feet still touch the fur
        this.events.push({ type: "launch", speed: Math.abs(this.vx) });
      }
    } else if (this.bufferT > 0 && (this.grounded || this.coyoteT > 0)) {
      this.anticipate = PHYS.anticipation;
      this.bufferT = 0;
    }

    if (this.grounded && this.anticipate <= 0) {
      // Move along the surface tangent; uphill is slower on steep fur.
      const tx = this.ny, ty = -this.nx;
      let s = this.vx * tx + this.vy * ty;
      const uphill = ty * Math.sign(target) > 0;
      const tgt = target * (uphill ? 1 - clamp((1 - this.ny) * 1.1, 0, 0.45) : 1);
      const rate = Math.abs(tgt) > Math.abs(s) && Math.sign(tgt) === Math.sign(s || tgt) ? PHYS.accel : PHYS.brake;
      s = s + clamp(tgt - s, -rate * dt, rate * dt);
      if (tgt === 0 && Math.abs(s) < 0.05) s = 0; // at rest: no creep on slopes
      this.vx = tx * s; this.vy = ty * s;
    } else if (this.anticipate <= 0) {
      this.vx += clamp(target - this.vx, -PHYS.airAccel * dt, PHYS.airAccel * dt);
      this.vy = Math.max(this.vy - PHYS.gravity * dt, -PHYS.maxFall);
    }

    // Integrate in small substeps so fast falls never tunnel through fur.
    const vyBefore = this.vy;
    const n = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 0.08));
    let ground = null, wall = false, blocked = false;
    const walking = wasGrounded && this.anticipate <= 0;
    for (let i = 0; i < n; i++) {
      const px = this.x, py = this.y;
      this.x += (this.vx * dt) / n;
      this.y += (this.vy * dt) / n;
      let gnd = this.resolve();
      if (this.vy <= 0.01) {
        for (const c of this.caps) {
          const t = capTop(c, this.x);
          if (t !== null && py >= t - 0.04 && this.y <= t + 0.01) {
            this.y = t; this.vy = Math.max(this.vy, 0); this.onCap = c; gnd = [0, 1];
          }
        }
      }
      // On foot, never step onto ground too steep to stand on (the curve up
      // into a riser): stop at its foot instead of sliding back and forth.
      if (walking && !this.onCap && this.vy >= -0.5) {
        const climbingSteep = gnd && gnd[1] < PHYS.walkableNy && this.y > py + 1e-4;
        const steep = !gnd && !this.probeGround(0.08) && this.sd(this.x, this.y + PHYS.feetR) < PHYS.feetR + 0.06;
        if (climbingSteep || steep) { this.x = px; this.y = py; this.vx = 0; this.vy = 0; blocked = true; ground = [this.nx, this.ny]; break; }
      }
      if (gnd) ground = gnd;
    }
    if (blocked) this.blockedT = (this.blockedT || 0) + dt; else this.blockedT = 0;
    // Ground checks: always while walking (uphill walking has upward speed
    // too); never in the instant after a launch; when airborne only on the way down.
    const mayGround = this.airLock <= 0 && (walking || this.vy <= 0.5);
    if (this.airLock > 0 && this.vy > 0) ground = null;
    if (!ground && mayGround) ground = this.probeGround(0.04);
    // Stick to the ground over crests and down gentle slopes instead of hopping.
    if (!ground && walking && mayGround) {
      for (let d = 0.05; d <= PHYS.snapDown; d += 0.05) {
        const g = this.probeGround(d);
        if (g) { this.y -= d - 0.01; this.resolve(); ground = g; break; }
      }
    }
    // Touching a steep wall while airborne: friction instead of a free slide.
    if (!ground && this.sd(this.x, this.y + PHYS.feetR) < PHYS.feetR + 0.03) {
      wall = true;
      this.vy = Math.max(this.vy, -5);
    }

    this.grounded = !!ground;
    if (!ground) this.onCap = null;
    if (ground && !this.onCap) {
      const gap = this.sd(this.x, this.y + PHYS.feetR) - PHYS.feetR;
      if (gap > 0.002 && gap < 0.12) this.y -= gap;
    }
    if (ground) {
      [this.nx, this.ny] = ground;
      this.coyoteT = PHYS.coyote;
      this.lastGroundY = this.y;
      if (!wasGrounded) {
        const impact = Math.max(0, -vyBefore);
        this.landImpact = impact;
        this.landT = PHYS.landTime * clamp(impact / 9, 0.35, 1.5);
        this.events.push({ type: "land", impact });
        const vn = this.vx * this.nx + this.vy * this.ny;
        this.vx -= this.nx * vn; this.vy -= this.ny * vn;
        this.vx *= impact > 10 ? 0.3 : 0.75;
      }
      // Remember a safe spot to return to after a fall.
      this.safeT += dt;
      if (this.safeT > 0.4 && this.ny > 0.8 && Math.abs(this.vx) < 2.5) {
        this.safe = { x: this.x, y: this.y, facing: this.facing };
        this.safeT = 0;
      }
    } else {
      this.safeT = 0;
    }

    // Walk-cycle phase advances with distance travelled.
    const speed = Math.hypot(this.vx, this.vy);
    if (this.grounded) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += (speed * dt / (run ? 0.62 : 0.42)) * Math.PI;
      // A footfall each half stride: the noise system listens for these.
      if (Math.floor(this.phase / Math.PI) !== before) this.events.push({ type: "step", run, speed });
    }

    if (this.anticipate > 0) this.state = "anticipate";
    else if (!this.grounded) this.state = wall ? "brace" : "air";
    else if (this.landT > 0) this.state = "land";
    else if (speed > 0.25) this.state = run && speed > PHYS.walk * 1.15 ? "run" : "walk";
    else this.state = "idle";

    if (this.y < this.lastGroundY - PHYS.fallReset) {
      this.events.push({ type: "fell" });
      this.reset(this.safe);
    }
  }

  // What the feet are on: "cap", "skin", "ear", "moss" or "fur". Moss is the
  // same patch mask the painter uses, so painted moss really is quieter.
  surface(mossSeed) {
    if (this.onCap) return "cap";
    this.sd(this.x, this.y - 0.05);
    const m = this.o.mat;
    if (m === MAT_SKIN) return "skin";
    if (m === MAT_EAR) return "ear";
    if (mossSeed !== undefined && fbm(this.x * 0.09, this.y * 0.09, mossSeed + 29, 3) > 0.6 && this.ny > 0.45) return "moss";
    return "fur";
  }

  // Everything the renderer needs to pose the figure.
  pose() {
    const speed = Math.hypot(this.vx, this.vy);
    const s = this.state;
    return {
      state: s,
      time: this.time,
      phase: this.phase,
      move: this.grounded ? clamp(speed / PHYS.walk, 0, 1) : 0,
      run: clamp((speed - PHYS.walk) / (PHYS.run - PHYS.walk), 0, 1),
      crouch: s === "anticipate" ? 1 : s === "land" ? clamp(this.landT / PHYS.landTime, 0, 1) * clamp(this.landImpact / 9, 0.4, 1) : 0,
      air: this.grounded ? 0 : 1,
      rising: this.vy > 0,
      brace: s === "brace",
      slope: this.grounded ? Math.atan2(-this.nx, this.ny) : 0
    };
  }
}
