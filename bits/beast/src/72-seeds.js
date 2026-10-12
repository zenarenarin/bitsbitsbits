// ---- Dream Seeds: luminous growths in the fur --------------------------------
// Drawn live over the painted body (they glow, sway with the breath and are
// picked), in the same brush language: a stalk rooted in the fur, small
// leaves, and a translucent pod lit from inside.
//   common  - one ivory pod with a muted gold core          (1 seed)
//   rare    - an arching stalk hung with three turquoise lanterns (3 seeds)
//   ancient - a curled frond threaded with seven lavender beads   (7 seeds)
// Collecting is brief: the pod brightens and opens, a ring and a few motes
// rise, the fur around it catches the light, a chime, and the counter ticks.
// Nothing pauses. The spent stalk stays, unlit.

const SEED_LOOK = {
  common: { glow: hex("#fff1cf"), core: hex("#f1cf86"), pod: hex("#fbf0dc"), shade: hex("#c9a986") },
  rare: { glow: hex("#d6fbf2"), core: hex("#9fe3d6"), pod: hex("#e3f7f1"), shade: hex("#7fb5b4") },
  ancient: { glow: hex("#efe4ff"), core: hex("#bba5ea"), pod: hex("#f1e9ff"), shade: hex("#8f7cbc") }
};
const SEED_STALK = hex("#6c5a6e"), SEED_STALK_LIT = hex("#a58a86"), SEED_LEAF = hex("#76884a");

// Does the explorer (feet at ex.x, ex.y) touch seed s? The body is about
// 1.5 m tall; the seed sits in the lower half of it when standing on its tread.
function seedTouches(s, ex) {
  const dx = (ex.x - s.x) / 0.8;
  const dy = (ex.y + 0.7 - (s.y + SEED_KINDS[s.kind].h * 0.6)) / 1.05;
  return dx * dx + dy * dy < 1;
}

class DreamSeeds {
  constructor(world) {
    this.world = world;
    this.list = world.seeds;
    this.fx = [];
    this.reset();
  }

  reset() {
    this.taken = new Set();
    this.count = 0;
    this.found = { common: 0, rare: 0, ancient: 0 };
    this.fx.length = 0;
    this.time = 0;
    this.collected = []; // seeds picked since the last drain (for Memory, HUD)
  }

  update(dt, ex) {
    this.time += dt;
    for (const s of this.list) {
      if (this.taken.has(s.id) || Math.abs(s.y - ex.y) > 3 || Math.abs(s.x - ex.x) > 3) continue;
      if (seedTouches(s, ex)) this.collect(s);
    }
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < 1.6);
  }

  collect(s) {
    this.taken.add(s.id);
    this.count += s.value;
    this.found[s.kind]++;
    this.collected.push(s);
    const r = rngFrom(s.id * 7919 + 13);
    const motes = [];
    for (let i = 0; i < 7 + s.value * 2; i++) {
      motes.push({ a: r() * 6.28, sp: 0.4 + r() * 0.7, rise: 0.7 + r() * 0.9, s: 0.025 + r() * 0.03 });
    }
    this.fx.push({ s, age: 0, motes });
  }

  // Bonus seeds bloomed by the Quiet Streak, at the explorer's feet.
  bloom(x, y, n) {
    this.count += n;
    const r = rngFrom(Math.floor(this.time * 1000) + n);
    const motes = [];
    for (let i = 0; i < 6 + n * 3; i++) motes.push({ a: r() * 6.28, sp: 0.6 + r() * 0.9, rise: 0.5 + r() * 0.8, s: 0.025 + r() * 0.025 });
    this.fx.push({ s: { kind: "common", x, y, value: n, bloom: true }, age: 0, motes });
  }

  draw(g, view, alert) {
    const k = view.ppm * view.pr;
    const hw = view.W / 2 / k + 2, top = view.camY + view.horizon / k + 2, bot = view.camY - (view.H - view.horizon) / k - 2;
    const breath = alert ? Math.sin(alert.breath) : 0;
    for (const s of this.list) {
      if (s.y > top || s.y < bot || Math.abs(s.x - view.camX) > hw) continue;
      const [sx, sy] = worldToScreen(view, s.x, s.y, 1);
      drawSeedPlant(g, sx, sy, k, s, this.taken.has(s.id) ? 0 : 1, this.time, breath);
    }
    for (const f of this.fx) this.drawCollect(g, view, k, f);
  }

  drawCollect(g, view, k, f) {
    const s = f.s, look = SEED_LOOK[s.kind], t = f.age;
    const h = SEED_KINDS[s.kind].h;
    const [sx, sy] = worldToScreen(view, s.x, s.y, 1);
    const cy = sy - h * 0.75 * k;
    g.save();
    g.globalCompositeOperation = "screen";
    // The fur catches the light: a warm pool that swells and fades.
    const pool = Math.sin(clamp(t / 1.1, 0, 1) * Math.PI) * (0.45 + s.value * 0.05);
    if (pool > 0.01) {
      const rad = (1.6 + s.value * 0.25) * k;
      const gr = g.createRadialGradient(sx, cy, 0, sx, cy, rad);
      gr.addColorStop(0, css(look.glow, 0.55 * pool));
      gr.addColorStop(0.45, css(look.core, 0.22 * pool));
      gr.addColorStop(1, css(look.core, 0));
      g.fillStyle = gr;
      g.fillRect(sx - rad, cy - rad, rad * 2, rad * 2);
    }
    g.restore();
    // A soft ring travelling out across the fur.
    if (t < 0.9) {
      const rr = (0.3 + t * 2.4) * k;
      g.beginPath();
      g.ellipse(sx, sy - 0.05 * k, rr, rr * 0.3, 0, 0, Math.PI * 2);
      g.lineWidth = Math.max(1, 0.045 * k);
      g.strokeStyle = css(look.glow, 0.55 * (1 - t / 0.9));
      g.stroke();
    }
    // Motes spiralling up and away.
    for (const m of f.motes) {
      const u = t / 1.6;
      const a = m.a + t * 2.2;
      const x = sx + Math.cos(a) * m.sp * u * k * 0.9;
      const y = cy - (m.rise * Math.sqrt(u) * 1.6) * k + Math.sin(a) * m.sp * u * k * 0.25;
      const fade = Math.min(1, t * 8) * (1 - u);
      dab(g, x, y, m.s * k * 1.6, m.s * k * 1.6, 0, look.glow, 0.25 * fade);
      dab(g, x, y, m.s * k * 0.6, m.s * k * 0.6, 0, [255, 252, 240], 0.9 * fade);
    }
  }
}

// One seed plant, rooted at (x, y) in px. lit 1 = ripe, 0 = spent.
function drawSeedPlant(g, x, y, k, s, lit, time, breath) {
  const look = SEED_LOOK[s.kind];
  const h = SEED_KINDS[s.kind].h * k;
  const sway = Math.sin(time * 0.9 + s.phase) * 0.05 + breath * 0.03 + s.lean;
  const glowPulse = 0.82 + 0.18 * Math.sin(time * 1.3 + s.phase);
  // Root shadow; while ripe, its light pools warmly on the fur around it.
  dab(g, x, y + 0.02 * k, 0.22 * k, 0.05 * k, 0, PAL.fur[1], 0.35);
  if (lit > 0) {
    g.save();
    g.globalCompositeOperation = "screen";
    const value = SEED_KINDS[s.kind].value;
    const rx = (0.75 + value * 0.04) * k, ry = rx * 0.4;
    g.translate(x, y - 0.05 * k);
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, css(look.glow, 0.45 * glowPulse));
    gr.addColorStop(0.5, css(look.core, 0.16 * glowPulse));
    gr.addColorStop(1, css(look.core, 0));
    g.fillStyle = gr;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  }
  if (s.kind === "ancient") drawAncient(g, x, y, k, s, h, look, lit, sway, glowPulse, time);
  else drawStalkSeed(g, x, y, k, s, h, look, lit, sway, glowPulse, time);
  // A few motes of light drifting up from a ripe seed.
  if (lit > 0) {
    for (let i = 0; i < 2 + Math.min(SEED_KINDS[s.kind].value, 3); i++) {
      const u = (time * 0.22 + i / 3.3 + s.phase) % 1;
      const mx = x + Math.sin(u * 5 + i * 2.1 + s.phase) * 0.22 * k + (i - 1) * 0.08 * k;
      const my = y - (0.25 + u * 1.1) * h;
      const a = Math.sin(u * Math.PI);
      dab(g, mx, my, 0.03 * k, 0.03 * k, 0, look.glow, 0.3 * a);
      dab(g, mx, my, 0.012 * k, 0.012 * k, 0, [255, 252, 240], 0.85 * a);
    }
  }
}

function drawStalkSeed(g, x, y, k, s, h, look, lit, sway, glowPulse, time) {
  // Stalk: a tapered curve; rare stalks arch over to hang their lanterns.
  const arch = s.kind === "rare" ? 0.55 : 0.12;
  const tipX = x + (Math.sin(sway) + arch * 0.6) * h * 0.55, tipY = y - h * (s.kind === "rare" ? 0.86 : 0.78);
  const ctrlX = x + sway * h * 0.2 - arch * h * 0.05, ctrlY = y - h * 0.62;
  g.beginPath();
  g.moveTo(x - 0.035 * k, y);
  g.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  g.quadraticCurveTo(ctrlX + 0.045 * k, ctrlY + 0.02 * k, x + 0.035 * k, y);
  g.closePath();
  g.fillStyle = css(mixRGB(SEED_STALK, SEED_STALK_LIT, 0.35 * lit), 1);
  g.fill();
  // Two small leaves low on the stalk.
  const lx = lerp(x, ctrlX, 0.35), ly = lerp(y, ctrlY, 0.35);
  drawLock(g, lx, ly, -0.85, -0.5, 0.22 * k, 0.1 * k, 0.25, mixRGB(SEED_LEAF, PAL.fur[2], 0.25), 0.95);
  drawLock(g, lx + 0.01 * k, ly - 0.05 * k, 0.9, -0.45, 0.18 * k, 0.085 * k, -0.25, mixRGB(SEED_LEAF, PAL.fur[3], 0.2), 0.95);
  if (s.kind === "rare") {
    // Three lanterns hanging from the arch on fine threads.
    for (let i = 0; i < 3; i++) {
      const u = 0.55 + i * 0.22;
      const qx = lerp(lerp(x, ctrlX, u), lerp(ctrlX, tipX, u), u), qy = lerp(lerp(y, ctrlY, u), lerp(ctrlY, tipY, u), u);
      const hang = (0.16 + ((i * 37) % 5) * 0.03) * k;
      const px = qx + Math.sin(time * 1.6 + s.phase + i) * 0.015 * k, py = qy + hang;
      streak(g, qx, qy, (px - qx) / hang, 1, hang, Math.max(0.6, 0.008 * k), SEED_STALK, 0.7);
      drawPod(g, px, py + 0.07 * k, 0.085 * k, 0.115 * k, look, lit, glowPulse, "top");
    }
  } else {
    drawBud(g, tipX, tipY - 0.12 * k, 0.12 * k, 0.17 * k, look, lit, glowPulse);
  }
}

// The common seed: a closed bud of translucent petals with light inside,
// glowing through the gaps. Spent, the petals fall open and dull.
function drawBud(g, x, y, rx, ry, look, lit, pulse) {
  if (lit > 0) {
    g.save();
    g.globalCompositeOperation = "screen";
    const rad = ry * 5.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, css(look.glow, 0.8 * pulse));
    gr.addColorStop(0.25, css(look.core, 0.32 * pulse));
    gr.addColorStop(1, css(look.core, 0));
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    g.restore();
  }
  const base = y + ry * 0.95;
  const open = lit > 0 ? 0 : 0.55;
  const petal = (dx, bend, col, a, w, len) => drawLock(g, x + dx * rx, base, dx * (0.5 + open) , -1, ry * len, rx * w, bend, col, a);
  // Back petals in shadow, the light, then the front petal catching the sun.
  petal(-0.35, -0.12, lit > 0 ? look.shade : PAL.fur[1], 0.95, 1.25, 1.85);
  petal(0.35, 0.12, lit > 0 ? mixRGB(look.shade, look.pod, 0.4) : PAL.fur[1], 0.95, 1.25, 1.85);
  if (lit > 0) {
    dab(g, x, y + ry * 0.05, rx * 0.62, ry * 0.85, 0, look.core, 0.95);
    dab(g, x, y - ry * 0.05, rx * 0.36, ry * 0.55, 0, look.glow, 0.95 * pulse);
  }
  petal(-0.08, 0.06, lit > 0 ? look.pod : mixRGB(look.shade, PAL.fur[1], 0.5), 0.9, 0.95, 1.6);
  if (lit > 0) streak(g, x - rx * 0.28, base - ry * 0.4, 0.15, -1, ry * 1.0, Math.max(1, rx * 0.12), [255, 252, 240], 0.7);
  // Two small sepals at the base.
  for (const side of [-1, 1]) drawLock(g, x, base - ry * 0.05, side * 0.8, -0.35, ry * 0.65, rx * 0.5, side * 0.2, mixRGB(SEED_LEAF, PAL.fur[2], 0.3), 0.95);
}

// A translucent pod: soft halo, shaded body, petal sheath, inner light.
function drawPod(g, x, y, rx, ry, look, lit, pulse, sepal) {
  if (lit > 0) {
    g.save();
    g.globalCompositeOperation = "screen";
    const rad = ry * 5;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, css(look.glow, 0.75 * pulse));
    gr.addColorStop(0.3, css(look.core, 0.3 * pulse));
    gr.addColorStop(1, css(look.core, 0));
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    g.restore();
  }
  const body = lit > 0 ? look.pod : mixRGB(look.shade, PAL.fur[1], 0.5);
  dab(g, x, y, rx, ry, 0, lit > 0 ? look.shade : PAL.fur[1], 0.9);
  dab(g, x - rx * 0.12, y - ry * 0.08, rx * 0.86, ry * 0.88, 0, body, 0.95);
  if (lit > 0) {
    dab(g, x - rx * 0.1, y + ry * 0.05, rx * 0.5, ry * 0.55, 0, look.core, 0.85 * pulse);
    dab(g, x - rx * 0.25, y - ry * 0.3, rx * 0.22, ry * 0.2, 0, [255, 252, 240], 0.9);
  }
  // Sepal petals cupping the pod (over the top of a hanging lantern).
  if (!sepal) return;
  const hanging = sepal === "top";
  const sy = hanging ? y - ry * 0.85 : y + ry * 0.75;
  const dir = hanging ? 1 : -1;
  for (const side of [-1, 1]) {
    drawLock(g, x, sy, side * 0.55, dir * 0.85, ry * 0.95, rx * 0.7, side * 0.2, mixRGB(SEED_STALK_LIT, PAL.fur[2], 0.4), 0.85);
  }
}

// The ancient frond: a curled crozier threaded with seven beads of light.
function drawAncient(g, x, y, k, s, h, look, lit, sway, pulse, time) {
  const pts = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    // Rise, then curl inward (a fiddlehead): radius shrinks along the spiral.
    if (u < 0.55) {
      const v = u / 0.55;
      pts.push([x + Math.sin(sway) * v * h * 0.35 + v * v * h * 0.12, y - v * h * 0.82]);
    } else {
      const v = (u - 0.55) / 0.45;
      const ang = Math.PI + v * Math.PI * 1.6;
      const rad = h * 0.22 * (1 - v * 0.7);
      const c = [x + Math.sin(sway) * h * 0.35 + h * 0.12 + h * 0.22, y - h * 0.82];
      pts.push([c[0] + Math.cos(ang) * rad, c[1] + Math.sin(ang) * rad]);
    }
  }
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const [w, col, a] of [[0.05, SEED_STALK, 1], [0.022, SEED_STALK_LIT, 0.8]]) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) g.lineTo(p[0], p[1]);
    g.lineWidth = Math.max(1, w * k);
    g.strokeStyle = css(col, a);
    g.stroke();
  }
  // Small pinnae along the rising stem.
  for (let i = 3; i < 13; i += 2) {
    const [px, py] = pts[i];
    const side = i % 4 === 1 ? 1 : -1;
    drawLock(g, px, py, side * 0.9, -0.4, 0.1 * k, 0.045 * k, side * 0.3, mixRGB(SEED_LEAF, PAL.fur[2], 0.3), 0.9);
  }
  // Seven beads along the curl; the innermost is the heart of the seed.
  for (let i = 0; i < 7; i++) {
    const p = pts[Math.min(n, 15 + i + (i > 4 ? 1 : 0))];
    const big = i === 6;
    const r = (big ? 0.1 : 0.06) * k;
    const pp = pulse * (0.85 + 0.15 * Math.sin(time * 2 + i));
    drawPod(g, p[0], p[1], r, r, look, lit, pp, null);
  }
}
