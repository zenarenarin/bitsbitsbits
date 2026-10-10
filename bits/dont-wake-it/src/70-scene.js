// ---- Scene: composites sky, cloud sea, depth layers, explorer, foreground ---

const LAYER_DEFS = {
  tail: { par: 0.2, fog: 0.72, clumpCell: 1.2, fringeCell: 1.6, minClumpPx: 7, minLockPx: 9, flow: [0.3, -0.95], gridPx: 6, moss: false, props: false, seedOffset: 300, maxTiles: 12 },
  flank: { par: 0.55, fog: 0.4, clumpCell: 0.5, fringeCell: 1.0, minClumpPx: 7, minLockPx: 9, flow: [0.5, -0.87], gridPx: 5, moss: true, props: false, seedOffset: 200, maxTiles: 16 },
  play: { par: 1, fog: 0.05, clumpCell: 0.2, fringeCell: 0.5, minClumpPx: 7, minLockPx: 10, flow: [0.53, -0.85], gridPx: 4, moss: true, props: true, seedOffset: 100, maxTiles: 24 },
  fore: { par: 1.5, fog: 0, valueShift: -0.34, clumpCell: 0.25, fringeCell: 0.5, minClumpPx: 9, minLockPx: 14, flow: [0.3, -0.95], gridPx: 5, moss: false, props: false, seedOffset: 400, maxTiles: 10 }
};

class Scene {
  constructor(world) {
    this.world = world;
    this.layers = {};
    for (const name of Object.keys(LAYER_DEFS)) {
      const L = Object.assign({ name, anatomy: world.layers[name], paint: paintAnatomyTile }, LAYER_DEFS[name]);
      this.layers[name] = new PaintedLayer(L, world);
    }
  }

  render(g, view, opts) {
    const w = this.world, s = w.seed;
    const ey = view.explorer.y;
    drawSky(g, view, s);
    drawCloudSea(g, view, s);
    drawMistBand(g, view, 20, 0.2, 40, PAL.mistWarm, 0.55);
    this.layers.tail.draw(g, view);
    drawCloudWrap(g, view, 96, 8, 0.2, 40, s + 1, 0.3, 0.9);
    drawMistBand(g, view, ey - 4, 0.45, 30, PAL.mistWarm, 0.4);
    this.layers.flank.draw(g, view);
    drawMistBand(g, view, ey - 14, 0.8, 9, PAL.mistWarm, 0.55);
    drawCloudWrap(g, view, view.explorer.x + 14, ey - 16, 0.55, 14, s + 2, 0.25, 0.85);
    this.layers.play.draw(g, view);
    const [sx, sy] = worldToScreen(view, view.explorer.x, view.explorer.y, 1);
    drawExplorer(g, sx, sy, EXPLORER_HEIGHT * view.ppm * view.pr, view.explorer.facing, "idle");
    this.layers.fore.draw(g, view);
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
