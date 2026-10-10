// ---- Atmosphere: golden-hour sky, cloud sea, mist bands, paper grain --------
// Distant things dissolve into warm mist; the cloud sea sinks as you climb
// because it is a real plane far below (its screen height follows altitude).

function drawSky(g, view, seed) {
  const { W, H, horizon } = view;
  const grad = g.createLinearGradient(0, horizon - H * 0.78, 0, horizon + H * 0.35);
  grad.addColorStop(0, css(PAL.skyZenith));
  grad.addColorStop(0.3, css(PAL.skyHigh));
  grad.addColorStop(0.55, css(PAL.skyMid));
  grad.addColorStop(0.74, css(PAL.skyLow));
  grad.addColorStop(0.8, css(PAL.horizon));
  grad.addColorStop(1, css(PAL.cloudMid));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const sx = W * (0.5 + 0.34 * SUN_SIDE), sy = horizon - H * 0.04;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, W * 0.95);
  sun.addColorStop(0, css(PAL.sunCore, 0.95));
  sun.addColorStop(0.18, css(PAL.horizon, 0.55));
  sun.addColorStop(1, css(PAL.horizon, 0));
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);

  // High wisps: long thin strokes, lit peach underneath, lavender above.
  const r = rngFrom(seed + 501);
  for (let i = 0; i < 9; i++) {
    const y = horizon - H * (0.25 + r() * 0.45);
    const x = r() * W;
    const len = W * (0.2 + r() * 0.35);
    for (let s = 0; s < 5; s++) {
      dab(g, x + (r() - 0.5) * len * 0.3, y + s * 2.5 * view.pr, len * (0.3 + r() * 0.2), (1.2 + r() * 2.2) * view.pr, -0.04,
        s < 2 ? PAL.skyHigh : mixRGB(PAL.cloudLit, PAL.skyMid, 0.4), 0.18);
    }
  }
  // Cumulus banks resting on the horizon.
  for (let c = 0; c < 6; c++) {
    const cx = (c / 5) * W * 1.1 - W * 0.05 + (r() - 0.5) * W * 0.12;
    const size = W * (0.1 + r() * 0.1);
    cloudCluster(g, cx, horizon + H * 0.012, size, rngFrom(seed + 600 + c), 0.3 + r() * 0.2, 0.9);
  }
}

// A billowing cluster of round dabs, lit from the upper left.
function cloudCluster(g, cx, baseY, size, r, fog, alpha) {
  const n = 26;
  const puffs = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + r() * Math.PI;
    const rad = Math.pow(r(), 0.7);
    puffs.push({
      x: cx + Math.cos(a) * rad * size * 1.25,
      y: baseY + Math.sin(a) * rad * size * 0.6,
      s: size * (0.18 + r() * 0.24)
    });
  }
  puffs.sort((p, q) => q.y - p.y);
  for (const p of puffs) {
    const h = clamp((baseY - p.y) / (size * 0.7), 0, 1);
    const base = mixRGB(PAL.cloudShade, PAL.cloudMid, h);
    dab(g, p.x, p.y, p.s, p.s * 0.82, 0, mixRGB(base, PAL.horizon, fog), alpha);
    dab(g, p.x + p.s * 0.22 * SUN_SIDE, p.y - p.s * 0.28, p.s * 0.72, p.s * 0.52, 0, mixRGB(mixRGB(PAL.cloudLit, PAL.cloudMid, 0.3 - h * 0.3), PAL.horizon, fog * 0.6), alpha * 0.85);
  }
}

// The cloud sea: a vast plane at y = 0, seen from altitude.
function drawCloudSea(g, view, seed) {
  const par = 0.045;
  const k = view.ppm * view.pr * par;
  const top = view.horizon + view.camY * k;
  if (top > view.H + 50) return;
  const { W, H } = view;
  const fill = g.createLinearGradient(0, top, 0, H);
  fill.addColorStop(0, css(mixRGB(PAL.cloudMid, PAL.horizon, 0.35)));
  fill.addColorStop(1, css(PAL.cloudShade));
  g.fillStyle = fill;
  g.fillRect(0, top, W, H - top + 1);
  // Rows of billows: farther rows smaller and warmer, nearer rows larger and cooler.
  for (let row = 0; row < 4; row++) {
    const depth = 1 + row * 0.6;
    const cellW = 34 / depth;
    const y = top + row * row * 7 * view.pr + row * 9 * view.pr;
    if (y > H + 40) break;
    const xw0 = view.camX - (W / 2) / k - cellW * 2, xw1 = view.camX + (W / 2) / k + cellW * 2;
    for (let c = Math.floor(xw0 / cellW); c <= Math.ceil(xw1 / cellW); c++) {
      const r = rngFrom(hash2(c, row, seed + 900));
      const x = W / 2 + ((c + r()) * cellW - view.camX) * k;
      cloudCluster(g, x, y + r() * 6 * view.pr, cellW * k * (0.5 + r() * 0.4) * (0.8 + row * 0.25), r, 0.35 - row * 0.08, 0.85);
    }
  }
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

// Low clouds wrapping the body at a given depth: world-anchored clusters.
function drawCloudWrap(g, view, x, y, par, size, seed, fog, alpha) {
  const k = view.ppm * view.pr * par;
  const sx = view.W / 2 + (x - view.camX) * k;
  const sy = view.horizon - (y - view.camY) * k;
  if (sx < -size * k * 2 || sx > view.W + size * k * 2 || sy < -size * k || sy > view.H + size * k) return;
  cloudCluster(g, sx, sy, size * k, rngFrom(seed), fog, alpha);
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
  g.globalAlpha = 0.07;
  g.globalCompositeOperation = "overlay";
  g.fillStyle = g.createPattern(grainTile, "repeat");
  g.fillRect(0, 0, view.W, view.H);
  g.restore();
  // Gentle lavender vignette pulls focus toward the explorer.
  const v = g.createRadialGradient(view.W / 2, view.H * 0.55, view.H * 0.3, view.W / 2, view.H * 0.55, view.H * 0.8);
  v.addColorStop(0, css(PAL.fur[0], 0));
  v.addColorStop(1, css(PAL.fur[0], 0.22));
  g.fillStyle = v;
  g.fillRect(0, 0, view.W, view.H);
}
