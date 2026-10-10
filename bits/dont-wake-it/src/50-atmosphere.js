// ---- Atmosphere: painted golden-hour sky, cloud banks, cloud sea, mist ------
// The sky is screen-fixed (it belongs to the camera's horizon), painted once
// per screen size and repainted with broad brushwork. Clouds live in the
// world at several depths as tiled, repainted layers; the cloud sea is a real
// plane far below, so it sinks as you climb.

function drawSkyGradient(g, view, seed) {
  const { W, H, horizon } = view;
  const grad = g.createLinearGradient(0, horizon - H * 0.8, 0, horizon + H * 0.3);
  grad.addColorStop(0, css(PAL.skyZenith));
  grad.addColorStop(0.32, css(PAL.skyHigh));
  grad.addColorStop(0.56, css(PAL.skyMid));
  grad.addColorStop(0.74, css(PAL.skyLow));
  grad.addColorStop(0.82, css(PAL.horizon));
  grad.addColorStop(1, css(PAL.cloudMid));
  g.fillStyle = grad;
  g.fillRect(-W, -H, W * 3, H * 3);

  const sx = W * (0.5 + 0.36 * SUN_SIDE), sy = horizon - H * 0.03;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, W * 1.1);
  sun.addColorStop(0, css(PAL.sunCore, 1));
  sun.addColorStop(0.12, css(PAL.horizon, 0.75));
  sun.addColorStop(0.45, css(PAL.skyLow, 0.25));
  sun.addColorStop(1, css(PAL.horizon, 0));
  g.fillStyle = sun;
  g.fillRect(-W, -H, W * 3, H * 3);

  const r = rngFrom(seed + 501);
  // High streaks of cirrus catching the light.
  for (let i = 0; i < 14; i++) {
    const y = horizon - H * (0.18 + r() * 0.55);
    const x = r() * W;
    const len = W * (0.25 + r() * 0.4);
    const lit = 1 - (horizon - y) / (H * 0.8);
    for (let s = 0; s < 6; s++) {
      dab(g, x + (r() - 0.5) * len * 0.4, y + s * 3 * view.pr, len * (0.25 + r() * 0.2), (1.5 + r() * 3) * view.pr, -0.03,
        mixRGB(PAL.skyHigh, PAL.cloudLit, clamp(lit, 0, 1)), 0.22);
    }
  }
  // Distant cumulus banks resting on the horizon, brightest toward the sun.
  for (let c = 0; c < 7; c++) {
    const cx = (c / 6) * W * 1.2 - W * 0.1 + (r() - 0.5) * W * 0.12;
    const size = W * (0.09 + r() * 0.09);
    const near = 1 - Math.abs(cx - sx) / W;
    cloudBank(g, cx, horizon + H * 0.02, size, rngFrom(seed + 600 + c), 0.45 - near * 0.15);
  }
}

// Screen-fixed painted sky: rendered with a margin, repainted, cropped.
class SkyBackdrop {
  constructor(seed) {
    this.seed = seed;
    this.key = "";
    this.canvas = null;
  }

  draw(g, view) {
    const M = REPAINT_MARGIN;
    const key = `${view.W}|${view.H}|${view.pr}`;
    if (key !== this.key) {
      this.key = key;
      this.canvas = makeCanvas(view.W + 2 * M, view.H + 2 * M);
      const cg = this.canvas.getContext("2d", { willReadFrequently: true });
      cg.translate(M, M);
      drawSkyGradient(cg, view, this.seed);
      cg.setTransform(1, 0, 0, 1, 0, 0);
      repaintCanvas(cg, -M, -M, scaleRepaint(BRUSH.sky, view.pr, [1, 0]), this.seed + 77);
    }
    g.drawImage(this.canvas, M, M, view.W, view.H, 0, 0, view.W, view.H);
  }
}

// A cumulus bank: soft round puffs with a lit crown toward the sun, a rosy
// body and a flat lavender base. (cx, cy) is the middle of the base, in px.
function cloudBank(g, cx, cy, size, r, fog) {
  const n = 16 + Math.floor(r() * 10);
  const puffs = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI;
    const rad = Math.pow(r(), 0.6);
    const s = size * (0.22 + r() * 0.22) * (1 - rad * 0.35);
    puffs.push({ x: cx + Math.cos(a) * rad * size * 1.3, y: cy - Math.sin(a) * rad * size * 0.62 - s * 0.2, s });
  }
  puffs.sort((p, q) => q.y - p.y);
  const tone = (t) => mixRGB(ramp([PAL.cloudDeep, PAL.cloudShade, PAL.cloudMid, PAL.cloudLit], t), PAL.horizon, fog);
  for (const p of puffs) {
    const h = clamp((cy - p.y) / (size * 0.75), 0, 1);
    const lx = p.x + p.s * 0.35 * SUN_SIDE, ly = p.y - p.s * 0.4;
    const grd = g.createRadialGradient(lx, ly, p.s * 0.1, p.x, p.y, p.s);
    grd.addColorStop(0, css(tone(0.62 + h * 0.38)));
    grd.addColorStop(0.55, css(tone(0.42 + h * 0.4), 0.95));
    grd.addColorStop(0.85, css(tone(0.4 + h * 0.35), 0.6));
    grd.addColorStop(1, css(tone(0.4 + h * 0.3), 0));
    g.beginPath();
    g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
    g.fillStyle = grd;
    g.fill();
  }
}

// Tile painter for a layer of world-anchored cloud banks (L.banks).
function paintCloudTile(tg, x0, yTop, k, L, world) {
  const span = tg.canvas.width / k;
  let used = false;
  for (const b of L.banks(world)) {
    const m = b.size * 1.6;
    if (b.x + m < x0 || b.x - m > x0 + span || b.y + m < yTop - span || b.y - b.size * 0.3 > yTop) continue;
    cloudBank(tg, (b.x - x0) * k, (yTop - b.y) * k, b.size * k, rngFrom(b.seed), L.fog);
    used = true;
  }
  return used;
}

// Tile painter for the cloud sea: a lit billowing top at y = 0 over a
// lavender body that fills everything below.
function paintCloudSeaTile(tg, x0, yTop, k, L, world) {
  const S = tg.canvas.width, span = S / k;
  if (yTop - span > 12) return false;
  const top = (yTop - 2) * k;
  const fill = tg.createLinearGradient(0, top, 0, top + 70 * k);
  fill.addColorStop(0, css(mixRGB(PAL.cloudMid, PAL.horizon, 0.3)));
  fill.addColorStop(1, css(PAL.cloudShade));
  tg.fillStyle = fill;
  tg.fillRect(0, Math.max(0, top), S, S);
  for (let row = 0; row < 3; row++) {
    const cellW = 34 - row * 6;
    for (let c = Math.floor((x0 - cellW * 2) / cellW); c <= Math.ceil((x0 + span + cellW * 2) / cellW); c++) {
      const r = rngFrom(hash2(c, row, world.seed + 900));
      const bx = (c + r()) * cellW, by = 2 - row * 9 + r() * 4;
      cloudBank(tg, (bx - x0) * k, (yTop - by) * k, cellW * (0.45 + r() * 0.3) * k, r, 0.3 - row * 0.1);
    }
  }
  return true;
}

// Soft horizontal mist band anchored at world height y in a given depth layer.
function drawMistBand(g, view, y, par, thickness, color, alpha) {
  const k = view.ppm * view.pr * par;
  const sy = view.horizon - (y - view.camY) * k;
  const t = thickness * k;
  if (sy + t < 0 || sy - t > view.H) return;
  const grad = g.createLinearGradient(0, sy - t, 0, sy + t);
  grad.addColorStop(0, css(color, 0));
  grad.addColorStop(0.5, css(color, alpha));
  grad.addColorStop(1, css(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, sy - t, view.W, t * 2);
}

let grainTile = null;
function drawGrain(g, view) {
  if (!grainTile) {
    grainTile = makeCanvas(256, 256);
    const gg = grainTile.getContext("2d");
    const img = gg.createImageData(256, 256);
    const r = rngFrom(4242);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 128 + (r() + r() - 1) * 70;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
  }
  g.save();
  g.globalAlpha = 0.08;
  g.globalCompositeOperation = "overlay";
  g.fillStyle = g.createPattern(grainTile, "repeat");
  g.fillRect(0, 0, view.W, view.H);
  g.restore();
  // Warm glow from the sun side and a soft violet vignette, as in the reference.
  const sx = view.W * (0.5 + 0.4 * SUN_SIDE);
  const glow = g.createRadialGradient(sx, view.H * 0.45, 0, sx, view.H * 0.45, view.W * 1.1);
  glow.addColorStop(0, css(PAL.horizon, 0.16));
  glow.addColorStop(1, css(PAL.horizon, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, view.W, view.H);
  const v = g.createRadialGradient(view.W / 2, view.H * 0.55, view.H * 0.32, view.W / 2, view.H * 0.55, view.H * 0.85);
  v.addColorStop(0, css(PAL.fur[0], 0));
  v.addColorStop(1, css(PAL.fur[0], 0.28));
  g.fillStyle = v;
  g.fillRect(0, 0, view.W, view.H);
}
