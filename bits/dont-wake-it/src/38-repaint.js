// ---- Repaint: turn a rendered tile into brushwork ---------------------------
// Stroke-based painterly rendering: sample the tile's own render and lay
// textured, colour-jittered brush strokes over it - broad strokes first, then
// small strokes only where there is detail (edges, eyes, mushrooms). Strokes
// follow edges where the image has structure and the fur flow elsewhere, so
// fur, spires, plants and props share one painted surface like the reference.
// Strokes are seeded by global pixel cell; tiles are painted with a margin and
// cropped, so neighbouring tiles repaint identically and seams never show.

const REPAINT_MARGIN = 40;

// Repaint passes are authored in CSS pixels (brush size is a property of the
// painting, not of the world zoom) and scaled to the backing store here.
function scaleRepaint(R, pr, flow) {
  return {
    flow,
    passes: R.map((P) => Object.assign({}, P, {
      cell: P.cell * pr, len: P.len * pr, width: P.width * pr, probe: Math.max(1, Math.round((P.probe || 2) * pr))
    }))
  };
}

function repaintCanvas(g, gx0, gy0, R, seed) {
  const W = g.canvas.width, H = g.canvas.height;
  const src = g.getImageData(0, 0, W, H).data;
  const lumAt = (x, y) => {
    x = clamp(x | 0, 0, W - 1); y = clamp(y | 0, 0, H - 1);
    const o = (y * W + x) * 4;
    return (src[o] * 0.3 + src[o + 1] * 0.59 + src[o + 2] * 0.11) * (src[o + 3] / 255);
  };
  const alphaAt = (x, y) => {
    x = clamp(x | 0, 0, W - 1); y = clamp(y | 0, 0, H - 1);
    return src[(y * W + x) * 4 + 3];
  };
  const flowX = (R.flow || [0, -1])[0], flowY = -(R.flow || [0, -1])[1];
  for (let p = 0; p < R.passes.length; p++) {
    const P = R.passes[p];
    const c = P.cell;
    const reach = P.len * 0.75;
    for (let cy = Math.floor((gy0 + reach) / c); cy <= Math.ceil((gy0 + H - reach) / c); cy++) {
      for (let cx = Math.floor((gx0 + reach) / c); cx <= Math.ceil((gx0 + W - reach) / c); cx++) {
        const r = rngFrom(hash2(cx, cy, seed + p * 7919));
        const x = (cx + r()) * c - gx0, y = (cy + r()) * c - gy0;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const o = ((y | 0) * W + (x | 0)) * 4;
        if (src[o + 3] < 150) continue;
        const d = P.probe;
        const gxl = lumAt(x + d, y) - lumAt(x - d, y), gyl = lumAt(x, y + d) - lumAt(x, y - d);
        const gxa = alphaAt(x + d, y) - alphaAt(x - d, y), gya = alphaAt(x, y + d) - alphaAt(x, y - d);
        const gl = Math.hypot(gxl, gyl), ga = Math.hypot(gxa, gya);
        if (P.minGrad && gl < P.minGrad && ga < 60) continue;
        // Direction: along silhouettes, along strong edges, else the fur flow.
        let dx, dy;
        if (ga > 60) { dx = -gya / ga; dy = gxa / ga; }
        else if (gl > (P.edge || 18)) { dx = -gyl / gl; dy = gxl / gl; }
        else { dx = flowX; dy = flowY; }
        const ang = (vnoise((cx * c) * 0.02, (cy * c) * 0.02, seed + 31) - 0.5) * 0.9 + (r() - 0.5) * 0.4;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
        if (dy < 0 && ga <= 60 && gl <= (P.edge || 18)) { dx = -dx; dy = -dy; }
        // Colour: sampled, then nudged warm in the light and cool in shadow,
        // with a little saturation, as a painter mixes on the palette.
        let col = [src[o], src[o + 1], src[o + 2]];
        const l = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) / 255;
        const jv = (r() - 0.5) * P.jitter;
        col = l > 0.6 ? mixRGB(col, [255, 222, 200], 0.04 + r() * 0.06) : l < 0.45 ? mixRGB(col, [104, 86, 150], 0.04 + r() * 0.08) : col;
        col = shade(col, jv);
        const m = (col[0] + col[1] + col[2]) / 3;
        col = [col[0] + (col[0] - m) * P.sat, col[1] + (col[1] - m) * P.sat, col[2] + (col[2] - m) * P.sat].map((v) => clamp(v, 0, 255));
        const len = P.len * (0.65 + r() * 0.7);
        const w = P.width * (0.7 + r() * 0.5);
        const bend = (r() - 0.5) * 0.3;
        const sx = x - dx * len * 0.5, sy = y - dy * len * 0.5;
        g2Stroke(g, sx, sy, dx, dy, len, w, bend, col, P.alpha * (0.8 + r() * 0.2));
        // Bristle marks: a lighter and a darker hair-line inside the stroke.
        if (w > 3) {
          const px = -dy, py = dx;
          for (let b = 0; b < 2; b++) {
            const off = (r() - 0.5) * w * 0.6;
            streak(g, sx + px * off, sy + py * off, dx, dy, len * (0.55 + r() * 0.35), Math.max(0.6, w * 0.12),
              shade(col, b ? 0.12 : -0.12), 0.32);
          }
        }
      }
    }
  }
}
