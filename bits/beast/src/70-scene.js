// ---- Scene: composites sky, cloud sea, depth layers, explorer, foreground ---

// Brush passes per layer (CSS px): broad strokes everywhere, fine strokes on detail.
const BRUSH = {
  sky: [{ cell: 9, len: 30, width: 9, jitter: 0.05, sat: 0.06, alpha: 0.75, edge: 999 }],
  far: [{ cell: 5, len: 14, width: 5, jitter: 0.08, sat: 0.08, alpha: 0.82 }],
  mid: [{ cell: 4.5, len: 12, width: 4.5, jitter: 0.1, sat: 0.1, alpha: 0.85 },
    { cell: 2.5, len: 6, width: 2, jitter: 0.1, sat: 0.1, alpha: 0.85, minGrad: 16 }],
  near: [{ cell: 4.5, len: 11.5, width: 4.4, jitter: 0.12, sat: 0.12, alpha: 0.88 },
    { cell: 2.6, len: 5.5, width: 1.8, jitter: 0.12, sat: 0.12, alpha: 0.9, minGrad: 18 }],
  fore: [{ cell: 7, len: 18, width: 7, jitter: 0.1, sat: 0.15, alpha: 0.9 }]
};

// Depth layers, back to front. par = depth scale (1 = the climbable body).
const LAYER_DEFS = [
  { name: "cloudSea", res: 0.5, par: 0.045, fog: 0, paint: paintCloudSeaTile, flow: [1, 0], seedOffset: 500, maxTiles: 6, repaint: BRUSH.far },
  { name: "cloudsFar", res: 0.5, par: 0.22, fog: 0.35, paint: paintCloudTile, banks: (w) => w.clouds.far, flow: [1, 0], seedOffset: 600, maxTiles: 10, repaint: BRUSH.far },
  { name: "tail", res: 0.5, par: 0.2, fog: 0.66, fogCool: true, clumpCell: 1.2, fringeCell: 1.6, minClumpPx: 7, minLockPx: 9, flow: [0.3, -0.95], gridPx: 6, seedOffset: 300, maxTiles: 12, repaint: BRUSH.far },
  { name: "far", res: 0.5, par: 0.22, fog: 0.6, fogCool: true, clumpCell: 0.8, fringeCell: 1.2, minClumpPx: 7, minLockPx: 9, flow: [0.2, -0.98], gridPx: 5, seedOffset: 700, maxTiles: 14, repaint: BRUSH.far },
  { name: "cloudsMid", res: 0.6, par: 0.45, fog: 0.15, paint: paintCloudTile, banks: (w) => w.clouds.mid, flow: [1, 0], seedOffset: 800, maxTiles: 12, repaint: BRUSH.mid },
  { name: "ridge", res: 0.75, par: 0.9, fog: 0.1, clumpCell: 0.3, fringeCell: 0.6, minClumpPx: 7, minLockPx: 9, flow: [0.53, -0.85], gridPx: 5, seedOffset: 900, maxTiles: 14, repaint: BRUSH.mid },
  { name: "play", par: 1, fog: 0.04, clumpCell: 0.2, fringeCell: 0.5, minClumpPx: 7, minLockPx: 10, flow: [0.53, -0.85], gridPx: 5, moss: true, props: true, seedOffset: 100, maxTiles: 20, urgency: 5, repaint: BRUSH.near },
  { name: "fore", res: 0.5, par: 1.5, fog: 0, valueShift: -0.48, clumpCell: 0.25, fringeCell: 0.5, minClumpPx: 9, minLockPx: 14, flow: [0.3, -0.95], gridPx: 5, seedOffset: 400, maxTiles: 10, repaint: BRUSH.fore }
];

class Scene {
  constructor(world) {
    this.world = world;
    this.sched = new PaintScheduler();
    this.sky = new SkyBackdrop(world.seed);
    this.finish = new FinishOverlay();
    this.layers = {};
    for (const def of LAYER_DEFS) {
      const L = Object.assign({ anatomy: world.layers[def.name], paint: paintAnatomyTile }, def);
      this.layers[def.name] = new PaintedLayer(L, world, this.sched);
    }
  }

  // Paint a view in the background (e.g. the restart point during a fade).
  paintAhead(view) {
    for (const L of Object.values(this.layers)) L.request(view, L.L.name === "play" ? 14 : 9);
  }

  // Paints every layer the view needs right now (used while loading).
  prepare(view, explorer) {
    this.render(makeCanvas(1, 1).getContext("2d"), view, { explorer: { x: explorer.x, y: explorer.y, facing: explorer.facing } });
    this.sched.finishVisible();
  }

  render(g, view, opts) {
    const w = this.world;
    const ex = opts.explorer;
    const ey = ex.y;
    const Ls = this.layers;
    // Distant layers are soft and painted at half resolution: composite them
    // into a half-resolution backdrop and upscale once (a quarter of the fill).
    // Altitude haze thickens with height; near the cloud sea it stays thin so
    // the sky is never washed out.
    const haze = smoothstep(10, 70, view.camY);
    const bw = Math.ceil(view.W / 2), bh = Math.ceil(view.H / 2);
    if (!this.back || this.back.width !== bw || this.back.height !== bh) this.back = makeCanvas(bw, bh);
    const b = this.back.getContext("2d");
    b.setTransform(0.5, 0, 0, 0.5, 0, 0);
    this.sky.draw(b, view);
    Ls.cloudSea.draw(b, view);
    drawMistBand(b, view, 10, 0.12, 60, PAL.mistWarm, 0.5 * haze);
    Ls.tail.draw(b, view);
    drawMistBand(b, view, ey - 30, 0.3, 30, PAL.mistWarm, 0.35 * haze);
    Ls.far.draw(b, view);
    Ls.cloudsFar.draw(b, view);
    drawMistBand(b, view, ey - 26, 0.3, 26, PAL.mistWarm, 0.45 * haze);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.back, 0, 0, bw, bh, 0, 0, bw * 2, bh * 2);
    Ls.cloudsMid.draw(g, view);
    drawMistBand(g, view, ey - 14, 0.8, 8, PAL.mistWarm, 0.35 * haze);
    // The beast's body (and everything on it) rises and falls with its breath.
    const alert = opts.alert, life = opts.life;
    // Whole device pixels: a fractional offset would resample every tile.
    const heavePx = Math.round((alert ? alert.heave : 0) * view.ppm * view.pr);
    g.save();
    g.translate(0, -heavePx);
    Ls.ridge.draw(g, view);
    Ls.play.draw(g, view, true); // the walkable body is never left unpainted
    if (life) life.drawGround(g, view, alert, ex);
    const [sx, sy] = worldToScreen(view, ex.x, ex.y, 1);
    drawExplorer(g, sx, sy, EXPLORER_HEIGHT * view.ppm * view.pr, ex.facing, ex.pose);
    if (life) life.drawAir(g, view);
    Ls.fore.draw(g, view);
    if (opts.collision) drawCollisionOverlay(g, view, w.layers.play, ex, w.props.mushrooms);
    g.restore();
    this.finish.draw(g, view);
    if (life) life.drawWarning(g, view, alert);
  }
}

// ---- Collision overlay: the sd = 0 isoline of the play body ----------------
// Green = walkable (faces up), amber = steep wall, red = overhang.
function collisionSegments(anat, x0, y0, x1, y1, step) {
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1;
  const prims = anat.cull(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const v = new Float32Array(nx * ny), o = {};
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = anat.eval(x0 + i * step, y0 + j * step, prims, o).sd;
  const segs = [];
  const cross = (xa, ya, va, xb, yb, vb) => {
    const t = va / (va - vb);
    return [xa + (xb - xa) * t, ya + (yb - ya) * t];
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const X = x0 + i * step, Y = y0 + j * step;
      const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
      const pts = [];
      if ((a < 0) !== (b < 0)) pts.push(cross(X, Y, a, X + step, Y, b));
      if ((b < 0) !== (c < 0)) pts.push(cross(X + step, Y, b, X + step, Y + step, c));
      if ((c < 0) !== (d < 0)) pts.push(cross(X + step, Y + step, c, X, Y + step, d));
      if ((d < 0) !== (a < 0)) pts.push(cross(X, Y + step, d, X, Y, a));
      for (let p = 0; p + 1 < pts.length; p += 2) {
        const [ax, ay] = pts[p], [bx, by] = pts[p + 1];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, e = step * 0.25;
        const gx = anat.eval(mx + e, my, prims, o).sd - anat.eval(mx - e, my, prims, o).sd;
        const gy = anat.eval(mx, my + e, prims, o).sd - anat.eval(mx, my - e, prims, o).sd;
        const l = Math.hypot(gx, gy) || 1;
        segs.push({ ax, ay, bx, by, nx: gx / l, ny: gy / l });
      }
    }
  }
  return segs;
}

function drawCollisionOverlay(g, view, anat, ex, mushrooms) {
  const w_mushrooms = () => mushrooms || [];
  const k = view.ppm * view.pr;
  const x0 = view.camX - view.W / 2 / k, x1 = view.camX + view.W / 2 / k;
  const y1 = view.camY + view.horizon / k, y0 = view.camY - (view.H - view.horizon) / k;
  const segs = collisionSegments(anat, x0, y0, x1, y1, Math.max(0.15, 3 / view.ppm));
  g.save();
  g.lineWidth = 2.2 * view.pr;
  g.lineCap = "round";
  for (const s of segs) {
    g.strokeStyle = s.ny > 0.64 ? "rgba(70,230,120,0.95)" : s.ny > -0.3 ? "rgba(255,190,60,0.95)" : "rgba(255,70,90,0.95)";
    const [ax, ay] = worldToScreen(view, s.ax, s.ay, 1);
    const [bx, by] = worldToScreen(view, s.bx, s.by, 1);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
  // Mushroom caps: one-way platforms (cyan).
  g.strokeStyle = "rgba(90,220,255,0.95)";
  for (const m of w_mushrooms(anat)) {
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = m.cap.x + (i / 16 * 2 - 1) * m.cap.a * 0.93;
      const [sx, sy] = worldToScreen(view, x, capTop(m.cap, x), 1);
      if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy);
    }
    g.stroke();
  }
  const [px, py] = worldToScreen(view, ex.x, ex.y, 1);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.moveTo(px - 8 * view.pr, py); g.lineTo(px + 8 * view.pr, py);
  g.moveTo(px, py - 8 * view.pr); g.lineTo(px, py + 8 * view.pr);
  g.stroke();
  g.restore();
}
