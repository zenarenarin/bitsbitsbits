// ---- Life: the beast reacting, drawn live over the painted world -----------
// - Live fur: tufts along the silhouette near the explorer that sway in the
//   wind, ripple outward from each noise (with a slight delay, like fur) and
//   bristle as the beast stirs; still and calm when it sleeps.
// - Footstep rings: soft rings on the fur, sized by how loud a step was, so
//   the player learns what is quiet without a meter.
// - Dust and pebbles shaken loose while stirring; spores puffed from caps.
// - A violet edge-darkening that grows as the beast nears waking.
// All bounded: tufts rebuilt only when the camera moves, particles capped.

class Life {
  constructor(world) {
    this.world = world;
    this.anat = world.layers.play;
    this.tufts = [];
    this.tuftKey = "";
    this.parts = [];
    this.rng = rngFrom(world.seed + 4242);
    this.time = 0;
    this.lastPulse = 0;
  }

  // Tufts along the walkable silhouette around the explorer (rebuilt per 3 m
  // cell of travel, over a small window, so it stays cheap).
  rebuildTufts(view, ex) {
    const key = `${Math.round(ex.x / 3)}|${Math.round(ex.y / 3)}`;
    if (key === this.tuftKey) return;
    this.tuftKey = key;
    const segs = collisionSegments(this.anat, ex.x - 7, ex.y - 4, ex.x + 7, ex.y + 5, 0.4);
    const tufts = [];
    for (const s of segs) {
      if (s.ny < 0.35) continue; // walkable ground only, not risers
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      const r = rngFrom(hash2(Math.round(mx * 10), Math.round(my * 10), this.world.seed + 61));
      if (r() < 0.5) continue;
      const nx = s.nx, ny = s.ny; // outward surface normal
      const lit = clamp(0.35 + nx * LIGHT2[0] * 0.5 + ny * LIGHT2[1] * 0.5 + (r() - 0.5) * 0.25, 0, 1);
      tufts.push({ x: mx - nx * 0.05, y: my - ny * 0.05, nx, ny, len: 0.16 + r() * 0.16, w: 0.05 + r() * 0.03, col: ramp(PAL.fur, 0.3 + lit * 0.45), phase: r() * 6.28 });
    }
    this.tufts = tufts;
  }

  update(dt, alert, ex, view) {
    this.time += dt;
    const stir = alert.stir;
    // Spores when landing on a cap; dust motes and pebbles while stirring.
    for (const p of alert.pulses) {
      if (p.t <= this.lastPulse) continue;
      if (p.surface === "cap") for (let i = 0; i < 10; i++) this.spawn("spore", p.x + (this.rng() - 0.5) * 0.8, p.y + 0.1, (this.rng() - 0.5) * 0.6, 0.4 + this.rng() * 0.6);
      this.lastPulse = p.t;
    }
    if (view) {
      const k = view.ppm * view.pr, hw = view.W / 2 / k, hh = view.H / 2 / k;
      const rate = stir * stir * 26 + (alert.state === "awake" ? 60 : 0);
      for (let n = this.rng() < (rate * dt) % 1 ? 1 : 0, i = 0; i < Math.floor(rate * dt) + n; i++) {
        const x = view.camX + (this.rng() - 0.5) * hw * 2.2, y = view.camY + hh + 1;
        this.spawn(this.rng() < 0.25 ? "pebble" : "dust", x, y, (this.rng() - 0.3) * 0.6, -0.5 - this.rng());
      }
    }
    for (const p of this.parts) {
      p.age += dt;
      if (p.kind === "pebble") p.vy -= 14 * dt;
      else p.vy += ((p.kind === "spore" ? 0.15 : -0.6) - p.vy) * dt * 1.5;
      p.vx += (Math.sin(this.time * 0.7 + p.y * 0.3) * 0.4 * (0.3 + stir) - p.vx) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  spawn(kind, x, y, vx, vy) {
    if (this.parts.length > 140) return;
    const life = kind === "spore" ? 1.6 + this.rng() : kind === "pebble" ? 2.5 : 4 + this.rng() * 2;
    this.parts.push({ kind, x, y, vx, vy, age: 0, life, s: kind === "pebble" ? 0.035 + this.rng() * 0.035 : 0.03 + this.rng() * 0.04 });
  }

  // Under the explorer: swaying fur and footstep rings.
  drawGround(g, view, alert, ex) {
    this.rebuildTufts(view, ex);
    const k = view.ppm * view.pr, t = this.time, stir = alert.stir;
    for (const tf of this.tufts) {
      const [sx, sy] = worldToScreen(view, tf.x, tf.y, 1);
      if (sx < -40 || sx > view.W + 40 || sy < -40 || sy > view.H + 40) continue;
      let sway = Math.sin(t * (1.1 + stir * 2.5) + tf.phase + tf.x * 0.6) * (0.08 + stir * 0.35);
      for (const p of alert.pulses) {
        const age = t - p.t;
        if (age < 0 || age > 1.6) continue;
        const front = age * 5; // ripple travels ~5 m/s along the fur
        const d = Math.hypot(tf.x - p.x, tf.y - p.y);
        sway += Math.exp(-((d - front) * (d - front)) / 0.6) * Math.exp(-age * 2) * Math.min(0.9, p.amount * 70);
      }
      // Lean downslope like the painted fur, plus the sway.
      // Lie mostly along the slope (downhill), lifting with the sway.
      let dx = tf.nx * 0.35 + tf.ny * 0.75 * SUN_SIDE, dy = tf.ny * 0.35 - tf.nx * 0.75 * SUN_SIDE - 0.2;
      const ca = Math.cos(sway), sa = Math.sin(sway);
      [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
      const l = Math.hypot(dx, dy) || 1;
      drawLock(g, sx, sy, dx / l, -dy / l, tf.len * k, tf.w * k, sway * 0.3, tf.col, 0.7);
    }
    for (const p of alert.pulses) {
      const age = t - p.t;
      if (age < 0 || age > 0.9 || p.amount < 0.0015) continue;
      const [sx, sy] = worldToScreen(view, p.x, p.y, 1);
      const r = (0.25 + age * (1.2 + p.amount * 90)) * k;
      const a = Math.min(0.5, p.amount * 30) * (1 - age / 0.9);
      g.beginPath();
      g.ellipse(sx, sy, r, r * 0.32, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.lineWidth = Math.max(1, 0.05 * k);
      g.strokeStyle = css(mixRGB([255, 244, 228], [255, 170, 150], alert.stir), a);
      g.stroke();
    }
  }

  // Over everything in the body group: dust, pebbles, spores.
  drawAir(g, view) {
    const k = view.ppm * view.pr;
    for (const p of this.parts) {
      const [sx, sy] = worldToScreen(view, p.x, p.y, 1);
      const fade = Math.min(1, p.age * 3) * (1 - p.age / p.life);
      const col = p.kind === "pebble" ? hex("#a8868a") : p.kind === "spore" ? hex("#ffe6a8") : hex("#fbe6d4");
      dab(g, sx, sy, p.s * k, p.s * k * (p.kind === "dust" ? 0.7 : 1), 0, col, (p.kind === "pebble" ? 0.75 : 0.6) * fade);
    }
  }

  // The warning at the edges of the screen.
  drawWarning(g, view, alert) {
    const w = smoothstep(0.45, 1, alert.level) * (0.75 + 0.25 * Math.sin(alert.breath));
    if (w <= 0.01) return;
    const v = g.createRadialGradient(view.W / 2, view.H * 0.55, view.H * 0.25, view.W / 2, view.H * 0.55, view.H * 0.75);
    v.addColorStop(0, css(PAL.fur[0], 0));
    v.addColorStop(1, css([46, 30, 70], 0.55 * w));
    g.fillStyle = v;
    g.fillRect(0, 0, view.W, view.H);
  }
}
