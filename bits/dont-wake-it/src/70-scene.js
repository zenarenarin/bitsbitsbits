// ---- Scene: composites sky, cloud sea, depth layers, explorer, foreground ---

// Brush passes per layer (CSS px): broad strokes everywhere, fine strokes on detail.
const BRUSH = {
  sky: [{ cell: 9, len: 30, width: 9, jitter: 0.05, sat: 0.06, alpha: 0.75, edge: 999 }],
  far: [{ cell: 5, len: 14, width: 5, jitter: 0.08, sat: 0.08, alpha: 0.82 }],
  mid: [{ cell: 4.5, len: 12, width: 4.5, jitter: 0.1, sat: 0.1, alpha: 0.85 },
    { cell: 2.5, len: 6, width: 2, jitter: 0.1, sat: 0.1, alpha: 0.85, minGrad: 16 }],
  near: [{ cell: 4, len: 11, width: 4, jitter: 0.12, sat: 0.12, alpha: 0.88 },
    { cell: 2, len: 5.5, width: 1.8, jitter: 0.12, sat: 0.12, alpha: 0.9, minGrad: 14 }],
  fore: [{ cell: 7, len: 18, width: 7, jitter: 0.1, sat: 0.15, alpha: 0.9 }]
};

// Depth layers, back to front. par = depth scale (1 = the climbable body).
const LAYER_DEFS = [
  { name: "cloudSea", par: 0.045, fog: 0, paint: paintCloudSeaTile, flow: [1, 0], seedOffset: 500, maxTiles: 6, repaint: BRUSH.far },
  { name: "cloudsFar", par: 0.22, fog: 0.35, paint: paintCloudTile, banks: (w) => w.clouds.far, flow: [1, 0], seedOffset: 600, maxTiles: 10, repaint: BRUSH.far },
  { name: "tail", par: 0.2, fog: 0.66, fogCool: true, clumpCell: 1.2, fringeCell: 1.6, minClumpPx: 7, minLockPx: 9, flow: [0.3, -0.95], gridPx: 6, seedOffset: 300, maxTiles: 12, repaint: BRUSH.far },
  { name: "far", par: 0.22, fog: 0.6, fogCool: true, clumpCell: 0.8, fringeCell: 1.2, minClumpPx: 7, minLockPx: 9, flow: [0.2, -0.98], gridPx: 5, seedOffset: 700, maxTiles: 14, repaint: BRUSH.far },
  { name: "cloudsMid", par: 0.45, fog: 0.15, paint: paintCloudTile, banks: (w) => w.clouds.mid, flow: [1, 0], seedOffset: 800, maxTiles: 12, repaint: BRUSH.mid },
  { name: "flank", par: 0.55, fog: 0.32, clumpCell: 0.5, fringeCell: 1.0, minClumpPx: 7, minLockPx: 9, flow: [0.5, -0.87], gridPx: 5, moss: true, seedOffset: 200, maxTiles: 16, repaint: BRUSH.mid },
  { name: "play", par: 1, fog: 0.04, clumpCell: 0.2, fringeCell: 0.5, minClumpPx: 7, minLockPx: 10, flow: [0.53, -0.85], gridPx: 4, moss: true, props: true, seedOffset: 100, maxTiles: 24, repaint: BRUSH.near },
  { name: "fore", par: 1.5, fog: 0, valueShift: -0.48, clumpCell: 0.25, fringeCell: 0.5, minClumpPx: 9, minLockPx: 14, flow: [0.3, -0.95], gridPx: 5, seedOffset: 400, maxTiles: 10, repaint: BRUSH.fore }
];

class Scene {
  constructor(world) {
    this.world = world;
    this.sky = new SkyBackdrop(world.seed);
    this.layers = {};
    for (const def of LAYER_DEFS) {
      const L = Object.assign({ anatomy: world.layers[def.name], paint: paintAnatomyTile }, def);
      this.layers[def.name] = new PaintedLayer(L, world);
    }
  }

  render(g, view, opts) {
    const w = this.world;
    const ey = view.explorer.y;
    const Ls = this.layers;
    this.sky.draw(g, view);
    Ls.cloudSea.draw(g, view);
    drawMistBand(g, view, 10, 0.12, 60, PAL.mistWarm, 0.5);
    Ls.tail.draw(g, view);
    drawMistBand(g, view, ey - 30, 0.3, 30, PAL.mistWarm, 0.35);
    Ls.far.draw(g, view);
    Ls.cloudsFar.draw(g, view);
    drawMistBand(g, view, ey - 26, 0.3, 26, PAL.mistWarm, 0.45);
    Ls.cloudsMid.draw(g, view);
    Ls.flank.draw(g, view);
    drawMistBand(g, view, ey - 14, 0.8, 8, PAL.mistWarm, 0.35);
    Ls.play.draw(g, view);
    const [sx, sy] = worldToScreen(view, view.explorer.x, view.explorer.y, 1);
    drawExplorer(g, sx, sy, EXPLORER_HEIGHT * view.ppm * view.pr, view.explorer.facing, "idle");
    Ls.fore.draw(g, view);
    drawGrain(g, view);
    if (opts && opts.collision) drawCollisionOverlay(g, view, w.layers.play);
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
        segs.push({ ax, ay, bx, by, ny: gy / l });
      }
    }
  }
  return segs;
}

function drawCollisionOverlay(g, view, anat) {
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
  const [ex, ey] = worldToScreen(view, view.explorer.x, view.explorer.y, 1);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.moveTo(ex - 8 * view.pr, ey); g.lineTo(ex + 8 * view.pr, ey);
  g.moveTo(ex, ey - 8 * view.pr); g.lineTo(ex, ey + 8 * view.pr);
  g.stroke();
  g.restore();
}
