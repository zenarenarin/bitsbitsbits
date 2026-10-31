// A small gouache toolkit for Canvas2D. Everything is painted once into
// offscreen buffers at start-up (seeded, so it is the same on every run) and
// then drawn as sprites, so the painterly detail costs nothing per frame.
//
// Painting happens in "unit" space: callers set a transform where 1 unit is
// one world unit and y points up, then describe shapes in the same
// coordinates as the physics. `B.px` converts screen pixels to units so brush
// widths stay consistent at any resolution.

function makeBuffer(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Smooth closed (or open) path through points, each point nudged by `jit`
// units so edges look hand painted rather than ruled.
function wobblePath(pts, jit, rnd, closed = true) {
  const p = new Path2D();
  const q = pts.map(([x, y]) => [x + (rnd() - 0.5) * 2 * jit, y + (rnd() - 0.5) * 2 * jit]);
  const n = q.length;
  if (!closed) {
    p.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2;
      p.quadraticCurveTo(q[i][0], q[i][1], mx, my);
    }
    p.lineTo(q[n - 1][0], q[n - 1][1]);
    return p;
  }
  const m0 = [(q[n - 1][0] + q[0][0]) / 2, (q[n - 1][1] + q[0][1]) / 2];
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n];
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  p.closePath();
  return p;
}

// Polygon with straight-ish edges (for books, frames, planks): corners are
// kept but edges get a slight hand wobble.
function handPoly(pts, jit, rnd) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(a);
    const mx = (a[0] + b[0]) / 2 + (rnd() - 0.5) * jit * 2, my = (a[1] + b[1]) / 2 + (rnd() - 0.5) * jit * 2;
    out.push([mx, my]);
  }
  const p = new Path2D();
  const j = () => (rnd() - 0.5) * jit;
  p.moveTo(out[0][0] + j(), out[0][1] + j());
  for (let i = 1; i < out.length; i += 2) {
    const c = out[i], d = out[(i + 1) % out.length];
    p.quadraticCurveTo(c[0], c[1], d[0] + j(), d[1] + j());
  }
  p.closePath();
  return p;
}

// Ellipse sampled as points so it can be wobbled.
function ellipsePts(cx, cy, rx, ry, n = 18, a0 = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

// Mirror a right-hand profile (bottom to top, x >= 0) into a closed silhouette.
function lathe(profile) {
  const right = profile.map(([x, y]) => [x, y]);
  const left = profile.slice().reverse().map(([x, y]) => [-x, y]);
  return right.concat(left);
}

function makeBrush(g, rnd, S) {
  const B = {
    g, rnd, S,
    px: v => v / S,

    // Opaque body colour with layered dry-brush strokes, a painted shadow side
    // and a light side, granulation, then an irregular ink edge.
    gouache(path, o) {
      const base = o.base, dark = o.dark || mix(base, PAL.ink, 0.45), light = o.light || mix(base, PAL.cream, 0.45);
      const bb = o.box; // [x0, y0, x1, y1]
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      g.save();
      g.fillStyle = base;
      g.fill(path);
      g.clip(path);
      // Under-layer variation: broad translucent washes of neighbouring hues.
      const washes = o.washes || [mix(base, PAL.orange, 0.2), mix(base, PAL.burgundy, 0.25)];
      for (let i = 0; i < 7; i++) {
        g.fillStyle = rgba(washes[i % washes.length], 0.18 + rnd() * 0.18);
        g.beginPath();
        g.ellipse(bb[0] + rnd() * w, bb[1] + rnd() * h, w * (0.25 + rnd() * 0.4), h * (0.2 + rnd() * 0.35), rnd() * 3, 0, TAU);
        g.fill();
      }
      // Shadow side (right) and light side (left); light comes from the upper left.
      const lightDir = o.lightDir == null ? -1 : o.lightDir;
      B.sideShade(bb, dark, lightDir > 0 ? -1 : 1, o.shadow == null ? 0.55 : o.shadow);
      B.sideShade(bb, light, lightDir, o.lit == null ? 0.38 : o.lit);
      if (o.bottomShade !== false) B.bottomShade(bb, dark, 0.35);
      B.dryBrush(bb, o.strokeColors || [light, dark, base], o.strokes || 26, o.strokeAngle == null ? Math.PI / 2 : o.strokeAngle, o.strokeLen || Math.max(w, h) * 0.5);
      B.granulate(bb, dark, o.grain == null ? 0.5 : o.grain);
      if (o.inner) o.inner();
      g.restore();
      if (o.edge !== false) B.edge(path, o.edgeColor || mix(dark, PAL.ink, 0.5), o.edgeW || 1.7);
    },

    sideShade(bb, color, side, amt) {
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      const x = side > 0 ? bb[2] : bb[0];
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        g.strokeStyle = rgba(color, amt * (0.16 + rnd() * 0.12));
        g.lineWidth = w * (0.1 + rnd() * 0.16);
        g.lineCap = 'round';
        g.beginPath();
        const xx = x - side * w * (0.06 + t * 0.22 + rnd() * 0.05);
        g.moveTo(xx + (rnd() - 0.5) * w * 0.05, bb[1] - h * 0.05);
        g.bezierCurveTo(xx + (rnd() - 0.5) * w * 0.12, bb[1] + h * 0.35, xx + (rnd() - 0.5) * w * 0.12, bb[1] + h * 0.7, xx + (rnd() - 0.5) * w * 0.05, bb[3] + h * 0.05);
        g.stroke();
      }
    },

    bottomShade(bb, color, amt) {
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = rgba(color, amt * (0.2 + rnd() * 0.15));
        g.lineWidth = h * (0.06 + rnd() * 0.08);
        g.lineCap = 'round';
        g.beginPath();
        const y = bb[1] + h * (0.02 + i * 0.035);
        g.moveTo(bb[0] - w * 0.05, y + (rnd() - 0.5) * h * 0.03);
        g.quadraticCurveTo(bb[0] + w / 2, y + (rnd() - 0.5) * h * 0.05, bb[2] + w * 0.05, y);
        g.stroke();
      }
    },

    // Broken strokes that skip like a half-loaded brush on paper.
    dryBrush(bb, colors, n, ang, len) {
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const c = colors[i % colors.length];
        let x = bb[0] + rnd() * w, y = bb[1] + rnd() * h;
        const a = ang + (rnd() - 0.5) * 0.5;
        const L = len * (0.3 + rnd() * 0.7);
        const segs = 6 + (rnd() * 6) | 0;
        const lw = B.px(1.2 + rnd() * 4.5);
        for (let s = 0; s < segs; s++) {
          const nx = x + Math.cos(a) * L / segs + (rnd() - 0.5) * B.px(1.5);
          const ny = y + Math.sin(a) * L / segs + (rnd() - 0.5) * B.px(1.5);
          if (rnd() > 0.22) {
            g.strokeStyle = rgba(c, 0.1 + rnd() * 0.22);
            g.lineWidth = lw * (0.6 + rnd() * 0.6);
            g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          }
          x = nx; y = ny;
        }
      }
    },

    granulate(bb, color, amt) {
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      const n = Math.round(w * h * S * S * 0.012 * amt);
      for (let i = 0; i < n; i++) {
        g.fillStyle = rgba(rnd() < 0.5 ? color : PAL.cream, 0.05 + rnd() * 0.1);
        const r = B.px(0.4 + rnd() * 1.1);
        g.fillRect(bb[0] + rnd() * w, bb[1] + rnd() * h, r, r);
      }
    },

    // Irregular ink edge: two passes of slightly different weight.
    edge(path, color, wpx) {
      g.save();
      g.strokeStyle = rgba(color, 0.85);
      g.lineJoin = 'round';
      g.lineWidth = B.px(wpx);
      g.stroke(path);
      g.strokeStyle = rgba(color, 0.35);
      g.lineWidth = B.px(wpx * 2.2);
      g.setLineDash([B.px(6 + rnd() * 10), B.px(4 + rnd() * 12)]);
      g.stroke(path);
      g.restore();
    },

    // A loaded stroke of opaque paint (highlights, motifs).
    stroke(pts, color, wpx, alpha = 1, jit = 0) {
      g.save();
      g.strokeStyle = rgba(color, alpha);
      g.lineWidth = B.px(wpx);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.stroke(wobblePath(pts, jit, rnd, false));
      g.restore();
    },
    // Highlight that tapers: several strokes of decreasing width.
    shine(pts, color, wpx, alpha = 0.85) {
      B.stroke(pts, color, wpx * 1.6, alpha * 0.35, B.px(0.6));
      B.stroke(pts, color, wpx, alpha * 0.7, B.px(0.6));
      if (pts.length > 2) B.stroke(pts.slice(0, -1), color, wpx * 0.55, alpha, B.px(0.4));
    },
    dot(x, y, rpx, color, alpha = 1) {
      g.fillStyle = rgba(color, alpha);
      g.beginPath();
      g.ellipse(x, y, B.px(rpx) * (0.85 + rnd() * 0.3), B.px(rpx) * (0.85 + rnd() * 0.3), rnd() * 3, 0, TAU);
      g.fill();
    },
    blob(pts, color, alpha = 1, jit = 0.004) {
      g.fillStyle = rgba(color, alpha);
      g.fill(wobblePath(pts, jit, rnd));
    },
    // A painted leaf / petal shape between two points.
    petal(x0, y0, x1, y1, wid, color, alpha = 1) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * wid, ny = dx / L * wid;
      const p = new Path2D();
      p.moveTo(x0, y0);
      p.quadraticCurveTo(mx + nx, my + ny, x1, y1);
      p.quadraticCurveTo(mx - nx, my - ny, x0, y0);
      g.fillStyle = rgba(color, alpha);
      g.fill(p);
    }
  };
  return B;
}

// Tileable paper grain: warm fibres and specks, used as a multiply layer
// over the whole scene.
function paintPaperGrain(size, seed) {
  const c = makeBuffer(size, size);
  const g = c.getContext('2d');
  const rnd = mulberry(seed);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 255 - Math.pow(rnd(), 3) * 46;
    d[i] = v; d[i + 1] = v - 3; d[i + 2] = v - 9;
  }
  g.putImageData(img, 0, 0);
  // fibres
  for (let i = 0; i < size * 0.9; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * TAU, L = 3 + rnd() * 14;
    g.strokeStyle = `rgba(120,90,60,${0.05 + rnd() * 0.07})`;
    g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  return c;
}
