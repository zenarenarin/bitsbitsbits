// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// THE UNSTABLE TABLE — a physics balancing still life for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Small shared helpers: seeded random numbers, colour mixing, maths.

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
// Mix two hex colours, t = 0 gives a, t = 1 gives b.
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
function rgba(h, a) {
  const c = hexToRgb(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// The palette. Burgundy and cream carry the scene; vermilion and mustard are
// the accents; cobalt is used sparingly.
const PAL = {
  burgundy: '#4a1420', burgundyDeep: '#2e0b13', wine: '#6b1d2a',
  vermilion: '#e0452b', tomato: '#b8321f', orange: '#d9682a',
  mustard: '#e3a931', ochre: '#c58a2c', olive: '#6f7a32', forest: '#2f4a2c',
  cream: '#f3e6c8', creamDeep: '#e2cfa3', cobalt: '#2a4f9e', cobaltDeep: '#1b3570',
  umber: '#3b2416', ink: '#26140e', terracotta: '#a9472b', wood: '#7a4524',
  brass: '#c99a3e', brassLight: '#f2d27a', brassDark: '#7a5418'
};

// ---- 01_paint.js ----
// A small gouache toolkit for Canvas2D. Everything is painted once into
// offscreen buffers at start-up (seeded, so it is the same on every run) and
// then drawn as sprites, so the painterly detail costs nothing per frame.
//
// Painting happens in "unit" space: callers set a transform where 1 unit is
// one world unit and y points up, then describe shapes in the same
// coordinates as the physics. `B.px` converts screen pixels to units so brush
// widths stay consistent at any resolution.

// Offscreen paint buffers. OffscreenCanvas where the WebView has it;
// otherwise a hidden canvas from the runtime's own factory (set in init).
let hiddenCanvasFactory = null;
function makeBuffer(w, h) {
  const cw = Math.max(1, Math.ceil(w)), ch = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas === 'function') {
    try { const o = new OffscreenCanvas(cw, ch); if (o.getContext('2d')) return o; } catch (e) {}
  }
  const c = hiddenCanvasFactory();
  c.width = cw; c.height = ch;
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

// ---- 02_objects.js ----
// The collection. Each object has authored physical properties and its own
// painting. Coordinates are world units with the origin at the middle of the
// object's base and y up, shared by the collision pieces and the artwork.
//
//   mass        kg-like units (the table's ballast is 24)
//   com         centre of mass, when it differs from the shape's centroid
//   pieces      convex collision polygons (planck takes the hull of each)
//   friction / restitution / angDamp (rolling resistance for round things)
//   weight      what the player is told: light, medium or heavy
//   tier        when it can start appearing (1 first, 3 later)

const MATERIAL_SOUND = { ceramic: 'ceramic', brass: 'brass', glass: 'glass', fruit: 'fruit', books: 'books', wood: 'wood' };

function boxPts(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }

const OBJECTS = [
  // ---------------- Ceramics ----------------
  {
    id: 'vase', name: 'Painted vase', material: 'ceramic', mass: 1.5, weight: 'medium', tier: 2,
    friction: 0.55, restitution: 0.08, com: [0, 0.3],
    pieces: [
      [[-0.11, 0], [0.11, 0], [0.2, 0.18], [0.21, 0.36], [0.14, 0.56], [-0.14, 0.56], [-0.21, 0.36], [-0.2, 0.18]],
      [[-0.14, 0.56], [0.14, 0.56], [0.085, 0.72], [-0.085, 0.72]],
      [[-0.085, 0.72], [0.085, 0.72], [0.135, 0.95], [-0.135, 0.95]]
    ],
    box: [-0.24, 0, 0.24, 0.97],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.11, 0], [0.17, 0.06], [0.205, 0.2], [0.215, 0.34], [0.18, 0.5], [0.11, 0.62], [0.085, 0.72], [0.1, 0.84], [0.14, 0.95]];
      const path = wobblePath(lathe(prof), 0.004, rnd);
      B.gouache(path, {
        base: PAL.cobalt, box: this.box, washes: [PAL.cobaltDeep, '#3d66b8'], shadow: 0.7,
        inner: () => {
          // cream band with vermilion flowers around the belly
          B.g.save();
          B.blob([[-0.3, 0.2], [0.3, 0.2], [0.3, 0.44], [-0.3, 0.44]], PAL.cream, 0.94, 0.006);
          for (let i = 0; i < 5; i++) {
            const x = -0.18 + i * 0.09, y = 0.32;
            for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + i; B.petal(x, y, x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04, 0.016, PAL.vermilion, 0.92); }
            B.dot(x, y, 2.2, PAL.mustard);
          }
          B.stroke([[-0.3, 0.2], [0.3, 0.205]], PAL.ochre, 2.2, 0.9, B.px(1));
          B.stroke([[-0.3, 0.44], [0.3, 0.435]], PAL.ochre, 2.2, 0.9, B.px(1));
          // neck chevrons
          for (let i = 0; i < 4; i++) B.stroke([[-0.09, 0.64 + i * 0.04], [0, 0.66 + i * 0.04], [0.09, 0.64 + i * 0.04]], PAL.cream, 1.6, 0.7);
          // little foot band
          B.stroke([[-0.16, 0.05], [0.16, 0.05]], PAL.mustard, 2.6, 0.85, B.px(1));
          B.g.restore();
        }
      });
      B.shine([[-0.16, 0.12], [-0.19, 0.24], [-0.17, 0.4]], PAL.cream, 3.2, 0.8);
      B.shine([[-0.11, 0.8], [-0.12, 0.9]], PAL.cream, 2, 0.6);
    }
  },
  {
    id: 'teapot', name: 'Porcelain teapot', material: 'ceramic', mass: 1.1, weight: 'medium', tier: 1,
    friction: 0.5, restitution: 0.08,
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.22, 0.11], [0.23, 0.23], [0.17, 0.35], [-0.17, 0.35], [-0.23, 0.23], [-0.22, 0.11]],
      [[-0.08, 0.35], [0.08, 0.35], [0.03, 0.45], [-0.03, 0.45]],
      [[0.2, 0.12], [0.25, 0.17], [0.36, 0.34], [0.33, 0.37], [0.2, 0.27]],
      [[-0.34, 0.1], [-0.22, 0.1], [-0.22, 0.31], [-0.33, 0.3]]
    ],
    box: [-0.36, 0, 0.38, 0.47],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      // handle (behind body)
      g.save(); g.strokeStyle = PAL.cream; g.lineWidth = 0.045; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.2, 0.28); g.bezierCurveTo(-0.38, 0.33, -0.38, 0.1, -0.2, 0.1); g.stroke();
      g.strokeStyle = rgba(PAL.umber, 0.6); g.lineWidth = B.px(1.6); g.stroke(); g.restore();
      // spout
      const sp = wobblePath([[0.18, 0.1], [0.27, 0.16], [0.35, 0.33], [0.37, 0.37], [0.31, 0.36], [0.24, 0.26], [0.18, 0.24]], 0.003, rnd);
      B.gouache(sp, { base: PAL.cream, box: [0.18, 0.1, 0.37, 0.37], shadow: 0.4, strokes: 6 });
      const body = wobblePath(ellipsePts(0, 0.18, 0.225, 0.175, 22).map(([x, y]) => [x, Math.max(y, 0.005)]), 0.003, rnd);
      B.gouache(body, {
        base: PAL.cream, box: [-0.23, 0, 0.23, 0.36], washes: [PAL.creamDeep, '#f7eedb'], shadow: 0.45, lit: 0.2,
        inner: () => {
          // cobalt sprays and a tomato red rim
          for (let i = 0; i < 3; i++) {
            const cx = -0.12 + i * 0.12, cy = 0.17 + (i % 2) * 0.03;
            B.stroke([[cx, cy - 0.07], [cx + 0.01, cy], [cx - 0.01, cy + 0.07]], PAL.cobalt, 1.6, 0.9);
            for (let k = 0; k < 4; k++) B.petal(cx, cy - 0.04 + k * 0.03, cx + (k % 2 ? 0.045 : -0.045), cy - 0.02 + k * 0.03, 0.012, PAL.cobalt, 0.85);
            B.dot(cx, cy + 0.075, 2.4, PAL.vermilion);
          }
          B.stroke([[-0.2, 0.31], [0, 0.325], [0.2, 0.31]], PAL.tomato, 3, 0.9);
          B.stroke([[-0.21, 0.05], [0.21, 0.05]], PAL.cobalt, 2, 0.7);
        }
      });
      const lid = wobblePath([[-0.12, 0.34], [0.12, 0.34], [0.08, 0.385], [-0.08, 0.385]], 0.003, rnd);
      B.gouache(lid, { base: PAL.cream, box: [-0.12, 0.34, 0.12, 0.39], strokes: 4 });
      const knob = wobblePath(ellipsePts(0, 0.415, 0.032, 0.035, 10), 0.002, rnd);
      B.gouache(knob, { base: PAL.tomato, box: [-0.04, 0.38, 0.04, 0.45], strokes: 3 });
      B.shine([[-0.17, 0.12], [-0.19, 0.2], [-0.15, 0.28]], '#ffffff', 3, 0.8);
    }
  },
  {
    id: 'bowl', name: 'Decorative bowl', material: 'ceramic', mass: 0.9, weight: 'light', tier: 1,
    friction: 0.55, restitution: 0.06,
    pieces: [
      [[-0.14, 0], [0.14, 0], [0.16, 0.05], [-0.16, 0.05]],
      [[-0.16, 0.05], [0.16, 0.05], [0.39, 0.2], [0.41, 0.27], [-0.41, 0.27], [-0.39, 0.2]]
    ],
    box: [-0.42, 0, 0.42, 0.29],
    paint(B) {
      const rnd = B.rnd;
      const foot = wobblePath([[-0.14, 0], [0.14, 0], [0.16, 0.055], [-0.16, 0.055]], 0.003, rnd);
      B.gouache(foot, { base: PAL.ochre, box: [-0.16, 0, 0.16, 0.06], strokes: 4 });
      const bowl = wobblePath([[-0.16, 0.05], [0.16, 0.05], [0.32, 0.12], [0.4, 0.21], [0.415, 0.27], [0, 0.275], [-0.415, 0.27], [-0.4, 0.21], [-0.32, 0.12]], 0.004, rnd);
      B.gouache(bowl, {
        base: PAL.olive, box: [-0.42, 0.05, 0.42, 0.28], washes: [PAL.forest, '#86913f'], shadow: 0.6,
        inner: () => {
          // mustard scallops and cream dots
          for (let i = 0; i < 7; i++) {
            const x = -0.3 + i * 0.1;
            B.petal(x, 0.24, x, 0.12, 0.04, PAL.mustard, 0.9);
            B.dot(x, 0.21, 2, PAL.cream, 0.95);
            B.dot(x + 0.05, 0.11, 1.4, PAL.vermilion, 0.9);
          }
          B.stroke([[-0.41, 0.255], [0, 0.262], [0.41, 0.255]], PAL.cream, 3.5, 0.95);
        }
      });
      // rim lip: the inside of the bowl seen slightly from above
      const rim = wobblePath(ellipsePts(0, 0.272, 0.41, 0.022, 20), 0.002, rnd);
      B.gouache(rim, { base: mix(PAL.forest, PAL.ink, 0.25), box: [-0.41, 0.25, 0.41, 0.3], strokes: 6, edge: false });
      B.shine([[-0.34, 0.15], [-0.22, 0.09]], PAL.cream, 2.6, 0.7);
    }
  },
  {
    id: 'bottle', name: 'Narrow-necked bottle', material: 'ceramic', mass: 1.0, weight: 'medium', tier: 3,
    friction: 0.5, restitution: 0.08, com: [0, 0.27],
    pieces: [
      [[-0.115, 0], [0.115, 0], [0.12, 0.48], [0.06, 0.6], [-0.06, 0.6], [-0.12, 0.48]],
      [[-0.04, 0.6], [0.04, 0.6], [0.035, 0.84], [-0.035, 0.84]],
      [[-0.055, 0.84], [0.055, 0.84], [0.055, 0.88], [-0.055, 0.88]]
    ],
    box: [-0.13, 0, 0.13, 0.9],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.11, 0], [0.122, 0.04], [0.124, 0.44], [0.1, 0.54], [0.05, 0.61], [0.036, 0.66], [0.034, 0.83], [0.055, 0.85], [0.055, 0.885]];
      const path = wobblePath(lathe(prof), 0.003, rnd);
      B.gouache(path, {
        base: PAL.forest, box: this.box, washes: [PAL.olive, '#1f3320'], shadow: 0.7, strokeAngle: Math.PI / 2,
        inner: () => {
          // glaze drips of ochre from the shoulder
          B.blob([[-0.14, 0.62], [0.14, 0.62], [0.14, 0.5], [0.1, 0.46], [0.06, 0.38], [0.03, 0.47], [-0.02, 0.36], [-0.05, 0.45], [-0.1, 0.4], [-0.14, 0.48]], PAL.ochre, 0.9, 0.006);
          B.blob([[-0.14, 0.62], [0.14, 0.62], [0.14, 0.56], [-0.14, 0.56]], PAL.mustard, 0.5, 0.004);
          for (let i = 0; i < 3; i++) B.stroke([[-0.13, 0.14 + i * 0.07], [0.13, 0.15 + i * 0.07]], PAL.cream, 1.3, 0.55, B.px(1));
          B.stroke([[-0.04, 0.8], [0.04, 0.8]], PAL.vermilion, 2.2, 0.9);
        }
      });
      B.shine([[-0.085, 0.1], [-0.095, 0.3], [-0.08, 0.44]], PAL.cream, 2.8, 0.75);
    }
  },
  {
    id: 'cat', name: 'Ceramic cat', material: 'ceramic', mass: 0.7, weight: 'light', tier: 1,
    friction: 0.6, restitution: 0.06,
    pieces: [
      [[-0.15, 0], [0.15, 0], [0.16, 0.12], [0.11, 0.3], [-0.11, 0.3], [-0.16, 0.12]],
      [[-0.11, 0.28], [0.11, 0.28], [0.12, 0.38], [0.1, 0.48], [-0.1, 0.48], [-0.12, 0.38]]
    ],
    box: [-0.24, 0, 0.17, 0.5],
    paint(B) {
      const rnd = B.rnd;
      // curled tail first
      B.stroke([[0.12, 0.04], [-0.05, 0.02], [-0.2, 0.05], [-0.23, 0.13], [-0.19, 0.19]], PAL.ink, 9, 0.9, B.px(0.5));
      B.stroke([[0.12, 0.04], [-0.05, 0.02], [-0.2, 0.05], [-0.23, 0.13], [-0.19, 0.19]], PAL.mustard, 6.5, 1, B.px(0.5));
      const body = wobblePath([[-0.15, 0], [0.15, 0], [0.165, 0.1], [0.13, 0.22], [0.08, 0.3], [-0.08, 0.3], [-0.13, 0.22], [-0.165, 0.1]], 0.004, rnd);
      B.gouache(body, {
        base: PAL.mustard, box: [-0.17, 0, 0.17, 0.31], washes: [PAL.ochre, PAL.orange], shadow: 0.5,
        inner: () => {
          for (let i = 0; i < 4; i++) B.stroke([[0.16, 0.06 + i * 0.05], [0.09, 0.08 + i * 0.05]], PAL.tomato, 2.4, 0.8);
          B.blob(ellipsePts(0, 0.13, 0.065, 0.1, 12), PAL.cream, 0.85);
          for (let i = 0; i < 3; i++) B.dot(0, 0.07 + i * 0.05, 1.6, PAL.cobalt, 0.9);
        }
      });
      const head = wobblePath([[-0.105, 0.27], [0.105, 0.27], [0.12, 0.36], [0.11, 0.42], [0.105, 0.5], [0.06, 0.44], [-0.06, 0.44], [-0.105, 0.5], [-0.11, 0.42], [-0.12, 0.36]], 0.003, rnd);
      B.gouache(head, {
        base: PAL.mustard, box: [-0.12, 0.27, 0.12, 0.5], washes: [PAL.ochre], shadow: 0.45, strokes: 8,
        inner: () => {
          B.petal(-0.09, 0.44, -0.095, 0.48, 0.012, PAL.vermilion, 0.85);
          B.petal(0.09, 0.44, 0.095, 0.48, 0.012, PAL.vermilion, 0.85);
          B.stroke([[0.06, 0.4], [0.1, 0.39]], PAL.tomato, 2, 0.8);
          B.stroke([[0.06, 0.36], [0.11, 0.35]], PAL.tomato, 2, 0.8);
        }
      });
      // sleepy eyes, nose, whiskers
      B.stroke([[-0.065, 0.375], [-0.04, 0.367], [-0.02, 0.375]], PAL.ink, 1.8, 0.95);
      B.stroke([[0.02, 0.375], [0.04, 0.367], [0.065, 0.375]], PAL.ink, 1.8, 0.95);
      B.dot(0, 0.345, 2.2, PAL.tomato);
      B.stroke([[-0.03, 0.335], [-0.11, 0.33]], PAL.ink, 0.9, 0.7);
      B.stroke([[0.03, 0.335], [0.11, 0.33]], PAL.ink, 0.9, 0.7);
      B.shine([[-0.12, 0.08], [-0.13, 0.16]], PAL.cream, 2.4, 0.8);
      B.shine([[-0.08, 0.32], [-0.09, 0.4]], PAL.cream, 2, 0.7);
    }
  },
  {
    id: 'lidpot', name: 'Ornate lidded pot', material: 'ceramic', mass: 1.8, weight: 'medium', tier: 1,
    friction: 0.55, restitution: 0.07,
    pieces: [
      [[-0.15, 0], [0.15, 0], [0.25, 0.14], [0.26, 0.3], [0.2, 0.42], [-0.2, 0.42], [-0.26, 0.3], [-0.25, 0.14]],
      [[-0.2, 0.42], [0.2, 0.42], [0.12, 0.52], [-0.12, 0.52]],
      [[-0.04, 0.52], [0.04, 0.52], [0.03, 0.62], [-0.03, 0.62]]
    ],
    box: [-0.27, 0, 0.27, 0.64],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.14, 0], [0.16, 0.035], [0.23, 0.12], [0.26, 0.24], [0.245, 0.34], [0.2, 0.42]];
      const body = wobblePath(lathe(prof), 0.004, rnd);
      B.gouache(body, {
        base: PAL.vermilion, box: [-0.27, 0, 0.27, 0.43], washes: [PAL.orange, PAL.tomato], shadow: 0.6,
        inner: () => {
          // olive and cream medallions with a mustard lattice
          for (let i = 0; i < 3; i++) {
            const x = -0.15 + i * 0.15;
            B.blob(ellipsePts(x, 0.23, 0.055, 0.075, 14), PAL.cream, 0.95);
            B.blob(ellipsePts(x, 0.23, 0.03, 0.045, 10), PAL.olive, 0.95);
            B.dot(x, 0.23, 1.6, PAL.mustard);
          }
          for (let i = 0; i < 9; i++) B.dot(-0.24 + i * 0.06, 0.37, 1.8, PAL.mustard, 0.95);
          for (let i = 0; i < 9; i++) B.dot(-0.22 + i * 0.055, 0.09, 1.6, PAL.cream, 0.9);
          B.stroke([[-0.26, 0.32], [0.26, 0.325]], PAL.burgundy, 2.4, 0.8, B.px(1));
          B.stroke([[-0.24, 0.13], [0.24, 0.135]], PAL.burgundy, 2.4, 0.8, B.px(1));
        }
      });
      const lid = wobblePath([[-0.215, 0.41], [0.215, 0.41], [0.16, 0.47], [0.11, 0.52], [-0.11, 0.52], [-0.16, 0.47]], 0.003, rnd);
      B.gouache(lid, {
        base: PAL.olive, box: [-0.22, 0.41, 0.22, 0.53], washes: [PAL.forest], strokes: 6,
        inner: () => { for (let i = 0; i < 6; i++) B.petal(-0.15 + i * 0.06, 0.42, -0.15 + i * 0.06, 0.48, 0.015, PAL.mustard, 0.9); }
      });
      const fin = wobblePath([[-0.035, 0.515], [0.035, 0.515], [0.045, 0.56], [0, 0.635], [-0.045, 0.56]], 0.002, rnd);
      B.gouache(fin, { base: PAL.mustard, box: [-0.05, 0.51, 0.05, 0.64], strokes: 3 });
      B.shine([[-0.21, 0.14], [-0.235, 0.24], [-0.21, 0.33]], PAL.cream, 3, 0.75);
    }
  },

  // ---------------- Brass and metal ----------------
  {
    id: 'candlestick', name: 'Brass candlestick', material: 'brass', mass: 2.0, weight: 'medium', tier: 3,
    friction: 0.33, restitution: 0.05, com: [0, 0.13],
    pieces: [
      [[-0.14, 0], [0.14, 0], [0.1, 0.06], [-0.1, 0.06]],
      [[-0.035, 0.06], [0.035, 0.06], [0.035, 0.72], [-0.035, 0.72]],
      [[-0.07, 0.72], [0.07, 0.72], [0.06, 0.8], [-0.06, 0.8]],
      [[-0.03, 0.8], [0.03, 0.8], [0.03, 1.0], [-0.03, 1.0]]
    ],
    box: [-0.15, 0, 0.15, 1.1],
    paint(B) {
      const rnd = B.rnd;
      // candle and flame
      const wax = wobblePath([[-0.03, 0.79], [0.03, 0.79], [0.031, 0.99], [0.01, 1.005], [-0.03, 0.995]], 0.002, rnd);
      B.gouache(wax, { base: PAL.cream, box: [-0.03, 0.79, 0.03, 1.0], strokes: 3, shadow: 0.35 });
      B.stroke([[0.02, 0.99], [0.024, 0.95], [0.02, 0.93]], PAL.creamDeep, 2, 0.9);
      B.stroke([[0, 1.0], [0, 1.02]], PAL.ink, 1.4, 0.9);
      B.blob([[0, 1.015], [0.022, 1.04], [0.012, 1.075], [0.002, 1.1], [-0.016, 1.07], [-0.02, 1.04]], PAL.mustard, 0.9, 0.002);
      B.blob([[0, 1.02], [0.01, 1.04], [0.004, 1.07], [-0.008, 1.04]], PAL.cream, 0.95, 0.001);
      const prof = [[0.14, 0], [0.135, 0.025], [0.09, 0.045], [0.05, 0.07], [0.034, 0.1], [0.045, 0.2], [0.03, 0.24], [0.03, 0.4], [0.055, 0.44], [0.03, 0.48], [0.03, 0.68], [0.045, 0.71], [0.072, 0.74], [0.06, 0.8]];
      const path = wobblePath(lathe(prof), 0.0025, rnd);
      brassFill(B, path, this.box, () => {
        for (const y of [0.2, 0.44, 0.74]) B.stroke([[-0.05, y], [0.05, y]], PAL.brassDark, 1.6, 0.8);
        B.stroke([[-0.12, 0.022], [0.12, 0.022]], PAL.brassLight, 2, 0.7);
      });
      B.shine([[-0.018, 0.12], [-0.019, 0.38], [-0.018, 0.66]], '#fff6d2', 2.2, 0.9);
      B.dot(-0.03, 0.44, 2.2, '#fff6d2', 0.9);
    }
  },
  {
    id: 'elephant', name: 'Brass elephant', material: 'brass', mass: 4.0, weight: 'heavy', tier: 3,
    friction: 0.4, restitution: 0.04, com: [0, 0.2],
    pieces: [
      [[-0.27, 0], [0.22, 0], [0.3, 0.3], [0.15, 0.44], [-0.2, 0.44], [-0.31, 0.28]],
      [[0.22, 0.1], [0.28, 0.04], [0.38, 0.26], [0.3, 0.4]]
    ],
    box: [-0.34, 0, 0.4, 0.47],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      // far legs (darker), tail
      for (const x of [-0.2, 0.12]) B.blob(boxPts(x - 0.045, 0, x + 0.045, 0.2), PAL.brassDark, 1, 0.004);
      B.stroke([[-0.29, 0.3], [-0.33, 0.2], [-0.32, 0.14]], PAL.brassDark, 3, 1);
      const body = wobblePath([
        [-0.27, 0], [-0.17, 0], [-0.16, 0.12], [0.06, 0.12], [0.07, 0], [0.18, 0], [0.19, 0.16], [0.26, 0.12], [0.3, 0.04], [0.37, 0.03], [0.36, 0.1],
        [0.33, 0.26], [0.3, 0.38], [0.22, 0.45], [0.12, 0.44], [0.0, 0.43], [-0.18, 0.42], [-0.29, 0.34], [-0.31, 0.22], [-0.28, 0.12]
      ], 0.004, rnd);
      brassFill(B, body, this.box, () => {
        // ornamental saddle blanket in vermilion, cobalt and mustard
        B.blob([[-0.17, 0.42], [0.06, 0.43], [0.07, 0.24], [0.0, 0.2], [-0.1, 0.19], [-0.18, 0.23]], PAL.vermilion, 0.95, 0.005);
        B.blob([[-0.14, 0.38], [0.03, 0.39], [0.04, 0.27], [-0.13, 0.25]], PAL.cobalt, 0.9, 0.004);
        for (let i = 0; i < 6; i++) B.dot(-0.16 + i * 0.045, 0.215, 2.2, PAL.mustard);
        for (let i = 0; i < 3; i++) B.petal(-0.1 + i * 0.05, 0.3, -0.1 + i * 0.05, 0.36, 0.015, PAL.cream, 0.9);
        // ear and engraved lines
        B.blob([[0.13, 0.4], [0.2, 0.42], [0.22, 0.3], [0.17, 0.22], [0.12, 0.27]], PAL.brassDark, 0.55, 0.004);
        B.stroke([[0.14, 0.38], [0.19, 0.38], [0.2, 0.3]], PAL.brassLight, 1.4, 0.7);
        for (let i = 0; i < 4; i++) B.stroke([[0.31, 0.24 - i * 0.05], [0.35, 0.23 - i * 0.05]], PAL.brassDark, 1.2, 0.8);
      });
      B.dot(0.26, 0.33, 2.4, PAL.ink);
      B.stroke([[0.27, 0.22], [0.31, 0.19]], PAL.cream, 3, 0.95); // tusk
      g.save(); B.shine([[-0.25, 0.32], [-0.12, 0.43]], '#fff6d2', 2.6, 0.85); g.restore();
      B.shine([[0.22, 0.42], [0.3, 0.36]], '#fff6d2', 2, 0.8);
    }
  },
  {
    id: 'bell', name: 'Heavy brass bell', material: 'brass', mass: 5.0, weight: 'heavy', tier: 3,
    friction: 0.32, restitution: 0.04, com: [0, 0.22],
    pieces: [
      [[-0.24, 0], [0.24, 0], [0.2, 0.08], [0.17, 0.36], [0.1, 0.46], [-0.1, 0.46], [-0.17, 0.36], [-0.2, 0.08]],
      [[-0.045, 0.46], [0.045, 0.46], [0.045, 0.6], [-0.045, 0.6]]
    ],
    box: [-0.25, -0.02, 0.25, 0.62],
    paint(B) {
      const rnd = B.rnd;
      // handle knob in turned olive wood
      const h = wobblePath([[-0.04, 0.45], [0.04, 0.45], [0.05, 0.52], [0.035, 0.56], [0.05, 0.6], [0, 0.625], [-0.05, 0.6], [-0.035, 0.56], [-0.05, 0.52]], 0.002, rnd);
      B.gouache(h, { base: PAL.wood, box: [-0.05, 0.45, 0.05, 0.63], strokes: 4 });
      // clapper peeking under the rim
      B.blob(ellipsePts(0.02, 0.0, 0.035, 0.03, 10), PAL.brassDark, 1);
      const prof = [[0.245, 0], [0.24, 0.03], [0.2, 0.07], [0.18, 0.16], [0.17, 0.3], [0.15, 0.38], [0.1, 0.45], [0.05, 0.465]];
      const path = wobblePath(lathe(prof), 0.003, rnd);
      brassFill(B, path, [-0.25, 0, 0.25, 0.47], () => {
        B.stroke([[-0.23, 0.05], [0, 0.06], [0.23, 0.05]], PAL.brassDark, 2.2, 0.8);
        B.stroke([[-0.2, 0.1], [0, 0.11], [0.2, 0.1]], PAL.brassDark, 1.2, 0.6);
        // engraved vine band
        for (let i = 0; i < 7; i++) {
          const x = -0.15 + i * 0.05;
          B.stroke([[x, 0.2], [x + 0.025, 0.24], [x + 0.05, 0.2]], PAL.brassDark, 1.3, 0.75);
          B.petal(x + 0.025, 0.24, x + 0.04, 0.27, 0.008, PAL.brassDark, 0.7);
        }
        B.stroke([[-0.18, 0.31], [0, 0.32], [0.18, 0.31]], PAL.brassDark, 1.4, 0.7);
        B.stroke([[-0.17, 0.17], [0, 0.18], [0.17, 0.17]], PAL.brassDark, 1.4, 0.7);
      });
      B.shine([[-0.15, 0.08], [-0.13, 0.25], [-0.09, 0.4]], '#fff6d2', 3.2, 0.9);
      B.shine([[0.205, 0.04], [0.19, 0.08]], PAL.brassLight, 2, 0.8);
    }
  },
  {
    id: 'armillary', name: 'Armillary ornament', material: 'brass', mass: 2.6, weight: 'medium', tier: 3,
    friction: 0.38, restitution: 0.05, com: [0, 0.42],
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.13, 0.1], [-0.13, 0.1]],
      [[-0.03, 0.1], [0.03, 0.1], [0.03, 0.4], [-0.03, 0.4]],
      { circle: [0, 0.56, 0.17] }
    ],
    box: [-0.19, 0, 0.19, 0.76],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      const plinth = handPoly(boxPts(-0.13, 0, 0.13, 0.1), 0.003, rnd);
      B.gouache(plinth, {
        base: PAL.burgundyDeep, box: [-0.13, 0, 0.13, 0.1], washes: [PAL.wine], strokes: 6,
        inner: () => { for (let i = 0; i < 5; i++) B.dot(-0.1 + i * 0.05, 0.05, 1.8, PAL.mustard); }
      });
      const col = wobblePath(lathe([[0.05, 0.1], [0.03, 0.14], [0.026, 0.36], [0.045, 0.4]]), 0.002, rnd);
      brassFill(B, col, [-0.05, 0.1, 0.05, 0.4]);
      // rings: drawn as painted ellipses
      const ring = (rx, ry, rot, col, w) => {
        g.save(); g.translate(0, 0.56); g.rotate(rot);
        g.strokeStyle = PAL.brassDark; g.lineWidth = B.px(w + 2.6); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
        g.strokeStyle = col; g.lineWidth = B.px(w); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
        g.strokeStyle = rgba('#fff6d2', 0.7); g.lineWidth = B.px(w * 0.4); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 0.9, Math.PI * 1.35); g.stroke();
        g.restore();
      };
      // a cobalt globe at the centre
      const globe = wobblePath(ellipsePts(0, 0.56, 0.07, 0.07, 14), 0.002, rnd);
      B.gouache(globe, { base: PAL.cobalt, box: [-0.07, 0.49, 0.07, 0.63], strokes: 5, inner: () => B.blob([[-0.03, 0.57], [0.02, 0.6], [0.04, 0.55], [0, 0.53]], PAL.olive, 0.9) });
      ring(0.165, 0.165, 0, PAL.brass, 4.2);
      ring(0.165, 0.06, 0.45, PAL.brass, 3.4);
      ring(0.06, 0.165, 0, PAL.brass, 3);
      ring(0.165, 0.04, -0.3, PAL.ochre, 2.6);
      B.dot(0, 0.735, 3, PAL.brassLight);
      B.dot(0, 0.735, 1.4, PAL.vermilion);
    }
  },
  {
    id: 'oillamp', name: 'Brass oil lamp', material: 'brass', mass: 2.2, weight: 'medium', tier: 3,
    friction: 0.36, restitution: 0.05, com: [-0.03, 0.1],
    pieces: [[[-0.12, 0], [0.12, 0], [0.22, 0.1], [0.4, 0.2], [0.38, 0.23], [0.1, 0.24], [-0.18, 0.22], [-0.27, 0.16], [-0.24, 0.08]]],
    box: [-0.36, 0, 0.42, 0.34],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      g.save(); g.strokeStyle = PAL.brassDark; g.lineWidth = 0.04; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.2, 0.2); g.bezierCurveTo(-0.38, 0.3, -0.4, 0.06, -0.22, 0.09); g.stroke();
      g.strokeStyle = PAL.brass; g.lineWidth = 0.022; g.stroke(); g.restore();
      const body = wobblePath([[-0.11, 0], [0.11, 0], [0.13, 0.04], [0.2, 0.1], [0.32, 0.16], [0.41, 0.2], [0.39, 0.235], [0.28, 0.21], [0.12, 0.235], [-0.05, 0.25], [-0.2, 0.22], [-0.26, 0.16], [-0.23, 0.08], [-0.13, 0.04]], 0.003, rnd);
      brassFill(B, body, [-0.27, 0, 0.42, 0.26], () => {
        for (let i = 0; i < 5; i++) B.stroke([[-0.18 + i * 0.07, 0.12], [-0.15 + i * 0.07, 0.17], [-0.12 + i * 0.07, 0.12]], PAL.brassDark, 1.4, 0.8);
        B.stroke([[-0.23, 0.09], [0.1, 0.1], [0.3, 0.17]], PAL.brassDark, 1.4, 0.6);
        B.dot(0, 0.15, 3, PAL.vermilion, 0.95);
        B.dot(0, 0.15, 1.3, PAL.cream, 0.9);
      });
      const lid = wobblePath([[-0.1, 0.24], [0.06, 0.24], [0.03, 0.29], [-0.01, 0.3], [-0.03, 0.34], [-0.05, 0.3], [-0.08, 0.29]], 0.002, rnd);
      brassFill(B, lid, [-0.1, 0.24, 0.06, 0.34]);
      // a little flame at the spout tip
      B.blob([[0.405, 0.22], [0.425, 0.25], [0.415, 0.29], [0.4, 0.31], [0.392, 0.27]], PAL.mustard, 0.85, 0.002);
      B.shine([[-0.2, 0.19], [-0.05, 0.235], [0.1, 0.22]], '#fff6d2', 2.6, 0.9);
    }
  },

  // ---------------- Natural objects ----------------
  {
    id: 'pomegranate', name: 'Pomegranate', material: 'fruit', mass: 0.6, weight: 'light', tier: 2,
    friction: 0.7, restitution: 0.12, angDamp: 1.6,
    pieces: [
      [[-0.06, 0], [0.07, 0.005], [0.17, 0.06], [0.215, 0.17], [0.19, 0.29], [0.1, 0.37], [-0.02, 0.385], [-0.13, 0.35], [-0.2, 0.25], [-0.205, 0.13], [-0.15, 0.04]],
      [[-0.05, 0.37], [0.05, 0.37], [0.06, 0.45], [-0.06, 0.45]]
    ],
    box: [-0.22, 0, 0.22, 0.46],
    paint(B) {
      const rnd = B.rnd;
      const crown = wobblePath([[-0.045, 0.36], [0.045, 0.36], [0.05, 0.43], [0.07, 0.46], [0.03, 0.44], [0, 0.465], [-0.03, 0.44], [-0.07, 0.46], [-0.05, 0.43]], 0.002, rnd);
      B.gouache(crown, { base: PAL.tomato, box: [-0.07, 0.36, 0.07, 0.47], strokes: 4 });
      const body = wobblePath(this.pieces[0], 0.004, rnd);
      B.gouache(body, {
        base: PAL.tomato, box: [-0.22, 0, 0.22, 0.39], washes: [PAL.vermilion, PAL.burgundy, PAL.orange, PAL.mustard], shadow: 0.75, strokeAngle: 0.6, strokes: 34,
        inner: () => {
          // sun-blush and tiny freckles
          B.blob(ellipsePts(-0.07, 0.24, 0.08, 0.06, 12), PAL.mustard, 0.35, 0.01);
          for (let i = 0; i < 26; i++) B.dot(-0.18 + B.rnd() * 0.36, 0.03 + B.rnd() * 0.33, 0.9, PAL.cream, 0.5);
        }
      });
      B.shine([[-0.14, 0.14], [-0.15, 0.22], [-0.11, 0.3]], PAL.cream, 3, 0.75);
    }
  },
  {
    id: 'pear', name: 'Pear', material: 'fruit', mass: 0.45, weight: 'light', tier: 2,
    friction: 0.65, restitution: 0.1, angDamp: 0.9, com: [0, 0.14],
    pieces: [[[-0.07, 0], [0.08, 0], [0.165, 0.07], [0.18, 0.17], [0.12, 0.29], [0.07, 0.42], [-0.04, 0.44], [-0.09, 0.3], [-0.175, 0.17], [-0.15, 0.06]]],
    box: [-0.19, 0, 0.19, 0.52],
    paint(B) {
      const rnd = B.rnd;
      B.stroke([[0.01, 0.43], [0.02, 0.48], [0.045, 0.52]], PAL.umber, 3.4, 1);
      B.petal(0.03, 0.47, 0.13, 0.5, 0.025, PAL.forest, 0.95);
      B.stroke([[0.035, 0.475], [0.12, 0.497]], PAL.olive, 1, 0.8);
      const body = wobblePath([[-0.07, 0], [0.08, 0.002], [0.155, 0.05], [0.18, 0.15], [0.14, 0.25], [0.085, 0.33], [0.06, 0.42], [0.0, 0.445], [-0.055, 0.42], [-0.08, 0.33], [-0.13, 0.25], [-0.175, 0.16], [-0.155, 0.06]], 0.004, rnd);
      B.gouache(body, {
        base: PAL.mustard, box: [-0.18, 0, 0.18, 0.45], washes: [PAL.olive, PAL.orange, '#e9c55a'], shadow: 0.6, strokeAngle: 1.2,
        inner: () => {
          B.blob(ellipsePts(0.08, 0.15, 0.08, 0.1, 12), PAL.vermilion, 0.28, 0.01);
          for (let i = 0; i < 18; i++) B.dot(-0.15 + B.rnd() * 0.3, 0.02 + B.rnd() * 0.38, 0.8, PAL.umber, 0.45);
        }
      });
      B.shine([[-0.13, 0.1], [-0.12, 0.2], [-0.06, 0.32]], PAL.cream, 2.8, 0.75);
    }
  },
  {
    id: 'grapes', name: 'Bunch of grapes', material: 'fruit', mass: 0.6, weight: 'light', tier: 2,
    friction: 0.95, restitution: 0.02, angDamp: 0.8,
    pieces: [[[-0.3, 0.03], [-0.1, 0], [0.15, 0], [0.3, 0.07], [0.29, 0.2], [0.06, 0.3], [-0.2, 0.27], [-0.32, 0.15]]],
    box: [-0.36, 0, 0.38, 0.34],
    paint(B) {
      const rnd = B.rnd;
      // stem and a vine leaf
      B.stroke([[0.26, 0.17], [0.33, 0.22], [0.37, 0.3]], PAL.umber, 3, 1);
      const leaf = wobblePath([[0.24, 0.22], [0.3, 0.33], [0.22, 0.34], [0.16, 0.3], [0.1, 0.33], [0.12, 0.27]], 0.004, rnd);
      B.gouache(leaf, { base: PAL.olive, box: [0.1, 0.22, 0.3, 0.34], strokes: 5, inner: () => B.stroke([[0.24, 0.23], [0.16, 0.3]], PAL.forest, 1.2, 0.9) });
      // individual grapes, back to front
      const gr = [];
      const r = 0.055;
      const rows = [[-0.25, 0.06, 2], [-0.14, 0.055, 3], [-0.02, 0.055, 4], [0.1, 0.06, 4], [0.21, 0.07, 3]];
      for (const [x, y0, n] of rows) for (let k = 0; k < n; k++) gr.push([x + (rnd() - 0.5) * 0.02, y0 + k * 0.065 + (rnd() - 0.5) * 0.01]);
      gr.sort((a, b) => b[1] - a[1]);
      for (const [x, y] of gr) {
        const hue = mix('#5a2a62', PAL.burgundy, rnd() * 0.6);
        const p = wobblePath(ellipsePts(x, y, r * (0.92 + rnd() * 0.15), r * (0.92 + rnd() * 0.15), 12), 0.002, rnd);
        B.gouache(p, { base: hue, box: [x - r, y - r, x + r, y + r], washes: [PAL.cobaltDeep, PAL.wine], strokes: 3, shadow: 0.6, lit: 0.25, grain: 0.2, edgeW: 1.2, bottomShade: false });
        B.dot(x - r * 0.4, y + r * 0.35, 1.6, '#e9d8f0', 0.8);
      }
    }
  },
  {
    id: 'pumpkin', name: 'Small pumpkin', material: 'fruit', mass: 2.4, weight: 'heavy', tier: 2,
    friction: 0.7, restitution: 0.06, angDamp: 0.5,
    pieces: [
      [[-0.2, 0], [0.2, 0], [0.3, 0.08], [0.32, 0.2], [0.25, 0.32], [-0.25, 0.32], [-0.32, 0.2], [-0.3, 0.08]],
      [[-0.03, 0.31], [0.03, 0.31], [0.05, 0.42], [0.0, 0.43]]
    ],
    box: [-0.33, 0, 0.33, 0.44],
    paint(B) {
      const rnd = B.rnd;
      B.stroke([[0, 0.3], [0.015, 0.37], [0.05, 0.42]], PAL.forest, 7, 1);
      B.stroke([[0, 0.3], [0.015, 0.37], [0.05, 0.42]], PAL.olive, 3.5, 0.9);
      // ribs from the outside in
      const ribs = [[-0.21, 0.12], [0.21, 0.12], [-0.1, 0.15], [0.1, 0.15], [0, 0.16]];
      for (const [cx, rx] of ribs) {
        const p = wobblePath(ellipsePts(cx, 0.165, rx, 0.165, 18).map(([x, y]) => [x, Math.max(y, 0.004)]), 0.004, rnd);
        const base = cx === 0 ? PAL.orange : mix(PAL.orange, PAL.tomato, Math.abs(cx) * 2);
        B.gouache(p, { base, box: [cx - rx, 0, cx + rx, 0.33], washes: [PAL.mustard, PAL.vermilion], strokes: 7, shadow: 0.5, lit: 0.3, strokeAngle: Math.PI / 2, edgeW: 1.4 });
      }
      B.shine([[-0.05, 0.08], [-0.06, 0.18], [-0.045, 0.27]], PAL.cream, 2.6, 0.7);
      B.shine([[-0.25, 0.1], [-0.26, 0.18]], PAL.cream, 2, 0.55);
    }
  },
  {
    id: 'coconut', name: 'Coconut', material: 'fruit', mass: 1.4, weight: 'medium', tier: 2,
    friction: 0.6, restitution: 0.1, angDamp: 1.3,
    pieces: [[[-0.07, 0], [0.09, 0.005], [0.18, 0.06], [0.215, 0.17], [0.19, 0.28], [0.1, 0.36], [-0.02, 0.38], [-0.13, 0.34], [-0.2, 0.25], [-0.21, 0.12], [-0.16, 0.04]]],
    box: [-0.22, 0, 0.22, 0.39],
    paint(B) {
      const rnd = B.rnd;
      const body = wobblePath(this.pieces[0], 0.005, rnd);
      B.gouache(body, {
        base: '#6a3f22', box: this.box, washes: [PAL.umber, PAL.wood, PAL.ochre], shadow: 0.7, strokes: 60, strokeLen: 0.12,
        strokeColors: [PAL.ochre, PAL.umber, '#9a6a3c', PAL.creamDeep],
        inner: () => {
          // fibrous hair strokes
          for (let i = 0; i < 70; i++) {
            const x = -0.2 + B.rnd() * 0.4, y = 0.02 + B.rnd() * 0.35, a = 0.4 + B.rnd() * 0.8;
            B.stroke([[x, y], [x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04]], B.rnd() < 0.5 ? PAL.creamDeep : PAL.umber, 0.9, 0.5);
          }
        }
      });
      // the three eyes
      for (const [x, y] of [[-0.035, 0.3], [0.035, 0.3], [0, 0.26]]) B.dot(x, y, 3.2, PAL.ink, 0.9);
      B.shine([[-0.15, 0.12], [-0.155, 0.2]], PAL.cream, 2.2, 0.45);
    }
  },
  {
    id: 'lemon', name: 'Lemon', material: 'fruit', mass: 0.3, weight: 'light', tier: 1,
    friction: 0.65, restitution: 0.12, angDamp: 1.4,
    pieces: [[[-0.1, 0.005], [0.1, 0.005], [0.155, 0.06], [0.18, 0.12], [0.15, 0.19], [0.09, 0.225], [-0.09, 0.225], [-0.15, 0.19], [-0.18, 0.12], [-0.155, 0.06]]],
    box: [-0.2, 0, 0.2, 0.24],
    paint(B) {
      const rnd = B.rnd;
      const body = wobblePath([[-0.1, 0.005], [0.1, 0.005], [0.15, 0.05], [0.18, 0.1], [0.2, 0.12], [0.18, 0.14], [0.15, 0.19], [0.09, 0.225], [-0.09, 0.225], [-0.15, 0.19], [-0.18, 0.14], [-0.2, 0.12], [-0.18, 0.1], [-0.15, 0.05]], 0.003, rnd);
      B.gouache(body, {
        base: '#efc531', box: this.box, washes: [PAL.mustard, '#f6dc6a', PAL.olive], shadow: 0.55, strokeAngle: 0.1,
        inner: () => { for (let i = 0; i < 30; i++) B.dot(-0.17 + B.rnd() * 0.34, 0.02 + B.rnd() * 0.2, 0.8, PAL.ochre, 0.5); }
      });
      B.petal(0.02, 0.215, -0.1, 0.27, 0.025, PAL.forest, 0.95);
      B.shine([[-0.12, 0.15], [-0.04, 0.19]], PAL.cream, 2.6, 0.85);
    }
  },

  // ---------------- Curiosities ----------------
  {
    id: 'books', name: 'Stack of books', material: 'books', mass: 3.0, weight: 'heavy', tier: 2,
    friction: 0.8, restitution: 0.02,
    pieces: [
      boxPts(-0.4, 0, 0.36, 0.12),
      boxPts(-0.34, 0.12, 0.4, 0.23),
      boxPts(-0.3, 0.23, 0.26, 0.31)
    ],
    box: [-0.41, 0, 0.41, 0.32],
    paint(B) {
      const rnd = B.rnd;
      const book = (x0, y0, x1, y1, cover, band, title) => {
        // page block peeking at the right
        B.blob(boxPts(x1 - 0.03, y0 + 0.012, x1 + 0.005, y1 - 0.012), PAL.cream, 1, 0.002);
        for (let i = 1; i < 4; i++) B.stroke([[x1 - 0.025, y0 + (y1 - y0) * i / 4], [x1, y0 + (y1 - y0) * i / 4]], PAL.creamDeep, 0.8, 0.9);
        const p = handPoly([[x0, y0], [x1 - 0.025, y0], [x1 - 0.025, y1], [x0, y1]], 0.003, rnd);
        B.gouache(p, {
          base: cover, box: [x0, y0, x1, y1], strokeAngle: 0, strokes: 10, shadow: 0.4, bottomShade: false,
          inner: () => {
            const h = y1 - y0;
            B.stroke([[x0 + 0.04, y0], [x0 + 0.04, y1]], band, 3, 0.9);
            B.stroke([[x1 - 0.08, y0], [x1 - 0.08, y1]], band, 3, 0.9);
            if (title) {
              B.blob(boxPts(x0 + 0.1, y0 + h * 0.3, x0 + 0.1 + title, y1 - h * 0.3), band, 0.9, 0.002);
              B.stroke([[x0 + 0.12, y0 + h * 0.5], [x0 + 0.08 + title, y0 + h * 0.5]], cover, 1, 0.7);
            }
            for (let i = 0; i < 3; i++) B.dot(x0 + 0.2 + i * 0.03, y0 + h * 0.5, 1.4, PAL.mustard, 0.9);
          }
        });
      };
      book(-0.4, 0, 0.36, 0.12, PAL.forest, PAL.mustard, 0.18);
      book(-0.34, 0.12, 0.4, 0.23, PAL.vermilion, PAL.cream, 0.22);
      book(-0.3, 0.23, 0.26, 0.31, PAL.cobalt, PAL.ochre, 0.14);
      B.shine([[-0.3, 0.3], [0.1, 0.302]], PAL.cream, 1.6, 0.6);
    }
  },
  {
    id: 'perfume', name: 'Glass perfume bottle', material: 'glass', mass: 0.55, weight: 'light', tier: 2,
    friction: 0.2, restitution: 0.18,
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.14, 0.16], [0.09, 0.24], [-0.09, 0.24], [-0.14, 0.16]],
      [[-0.03, 0.24], [0.03, 0.24], [0.03, 0.29], [-0.03, 0.29]],
      [[-0.07, 0.29], [0.07, 0.29], [0.05, 0.42], [-0.05, 0.42]]
    ],
    box: [-0.15, 0, 0.15, 0.43],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      const bodyPts = [[-0.13, 0], [0.13, 0], [0.142, 0.15], [0.09, 0.24], [-0.09, 0.24], [-0.142, 0.15]];
      const body = handPoly(bodyPts, 0.002, rnd);
      // translucent glass: a thin wash with the backdrop showing through
      g.save();
      g.fillStyle = rgba('#d9a3b5', 0.32); g.fill(body);
      g.clip(body);
      // perfume inside
      B.blob([[-0.14, 0], [0.14, 0], [0.14, 0.13], [0.07, 0.14], [-0.07, 0.13], [-0.14, 0.135]], PAL.vermilion, 0.62, 0.003);
      B.stroke([[-0.14, 0.135], [0, 0.14], [0.14, 0.13]], '#ffb48f', 1.6, 0.8);
      // facets
      B.stroke([[-0.08, 0.02], [-0.07, 0.22]], '#ffffff', 1.2, 0.45);
      B.stroke([[0.08, 0.02], [0.07, 0.22]], PAL.burgundy, 1.4, 0.35);
      B.dryBrush([-0.14, 0, 0.14, 0.24], ['#ffffff', PAL.cream], 8, Math.PI / 2, 0.15);
      g.restore();
      B.edge(body, PAL.wine, 1.3);
      // neck and stopper
      const neck = handPoly(boxPts(-0.03, 0.24, 0.03, 0.29), 0.001, rnd);
      g.fillStyle = rgba(PAL.mustard, 0.85); g.fill(neck); B.edge(neck, PAL.brassDark, 1.1);
      const stop = handPoly([[-0.07, 0.29], [0.07, 0.29], [0.055, 0.36], [0, 0.425], [-0.055, 0.36]], 0.002, rnd);
      g.save(); g.fillStyle = rgba(PAL.cobalt, 0.55); g.fill(stop); g.clip(stop);
      B.stroke([[-0.03, 0.3], [0, 0.42]], '#ffffff', 1.2, 0.6);
      B.stroke([[0.03, 0.3], [0.045, 0.36]], PAL.cobaltDeep, 2, 0.6);
      g.restore();
      B.edge(stop, PAL.cobaltDeep, 1.2);
      // ring highlights that make it read as glass
      B.shine([[-0.115, 0.03], [-0.122, 0.12]], '#ffffff', 2.6, 0.95);
      B.dot(0.1, 0.19, 1.8, '#ffffff', 0.9);
    }
  },
  {
    id: 'frame', name: 'Framed miniature', material: 'wood', mass: 1.2, weight: 'medium', tier: 1,
    friction: 0.5, restitution: 0.05,
    pieces: [
      [[-0.2, 0], [0.2, 0], [0.26, 0.04], [0.26, 0.66], [-0.26, 0.66], [-0.26, 0.04]]
    ],
    box: [-0.28, 0, 0.28, 0.68],
    paint(B) {
      const rnd = B.rnd;
      // feet
      B.blob(boxPts(-0.2, 0, -0.12, 0.05), PAL.brassDark, 1, 0.003);
      B.blob(boxPts(0.12, 0, 0.2, 0.05), PAL.brassDark, 1, 0.003);
      const outer = handPoly(boxPts(-0.26, 0.04, 0.26, 0.66), 0.003, rnd);
      brassFill(B, outer, [-0.26, 0.04, 0.26, 0.66], () => {
        for (let i = 0; i < 9; i++) { B.dot(-0.23, 0.08 + i * 0.065, 1.8, PAL.brassDark, 0.8); B.dot(0.23, 0.08 + i * 0.065, 1.8, PAL.brassDark, 0.8); }
        for (let i = 0; i < 7; i++) { B.dot(-0.19 + i * 0.063, 0.625, 1.8, PAL.brassDark, 0.8); B.dot(-0.19 + i * 0.063, 0.075, 1.8, PAL.brassDark, 0.8); }
      });
      // the painting: a tiny landscape with a cobalt sky and a red sun
      const inner = handPoly(boxPts(-0.2, 0.1, 0.2, 0.6), 0.002, rnd);
      B.gouache(inner, {
        base: PAL.cobalt, box: [-0.2, 0.1, 0.2, 0.6], washes: ['#3d66b8', PAL.cobaltDeep], strokeAngle: 0, strokes: 12, shadow: 0.3, lit: 0.15, bottomShade: false,
        inner: () => {
          B.blob(ellipsePts(0.07, 0.45, 0.05, 0.05, 12), PAL.vermilion, 0.95);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.3], [0.1, 0.36], [-0.02, 0.3], [-0.12, 0.34], [-0.25, 0.28]], PAL.olive, 0.98, 0.006);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.2], [0.05, 0.24], [-0.25, 0.19]], PAL.forest, 0.95, 0.006);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.15], [-0.25, 0.14]], PAL.mustard, 0.9, 0.004);
          for (let i = 0; i < 3; i++) {
            const x = -0.12 + i * 0.07;
            B.stroke([[x, 0.2], [x, 0.3]], PAL.umber, 1.6, 0.9);
            B.blob(ellipsePts(x, 0.32, 0.03, 0.04, 9), PAL.forest, 0.95);
          }
        }
      });
      B.edge(inner, PAL.ink, 1.4);
      B.shine([[-0.245, 0.1], [-0.245, 0.6]], '#fff6d2', 2, 0.8);
    }
  }
];

// Brass: warm metal with strong dark bands, a reflected warm glow from the
// table at the bottom and crisp light streaks.
function brassFill(B, path, box, inner) {
  B.gouache(path, {
    base: PAL.brass, dark: PAL.brassDark, light: PAL.brassLight, box,
    washes: [PAL.ochre, PAL.mustard, '#a8742a'], shadow: 0.85, lit: 0.5,
    strokeColors: [PAL.brassLight, PAL.brassDark, '#e6b955'], strokes: 22,
    edgeColor: '#4a3010',
    inner: () => {
      const w = box[2] - box[0], h = box[3] - box[1];
      // a dark reflected band and a terracotta bounce light from the table
      B.stroke([[box[0] + w * 0.62, box[1]], [box[0] + w * 0.6, box[3]]], PAL.brassDark, Math.max(2, w * B.S * 0.08), 0.35);
      B.stroke([[box[0], box[1] + h * 0.04], [box[2], box[1] + h * 0.04]], PAL.terracotta, Math.max(2, h * B.S * 0.05), 0.3);
      if (inner) inner();
    }
  });
}

const OBJECT_BY_ID = {};
for (const o of OBJECTS) OBJECT_BY_ID[o.id] = o;

// ---- 03_phys.js ----
// Rigid-body simulation (planck.js, a Box2D port).
//
// World units: the tabletop is 3.2 units long. y points up, the pivot is the
// origin. Gravity is scaled so the table reads as roughly a 1.6 m board.
//
// The table is one dynamic body hinged on a revolute joint at the pivot. Its
// tabletop sits above the pivot and a brass ballast hangs below it, so the
// assembly behaves like a real balance: an off-centre load produces a torque
// m * g * x about the pivot, the pivot supplies the reaction force, and the
// table turns until the ballast's restoring torque (M * g * L * sin(angle))
// matches the load. Tall stacks raise the combined centre of mass towards the
// pivot and erode that restoring torque, which is where late-game wobble
// comes from. Nothing about the table's angle is animated.

const PHYS = {
  g: 24,
  halfLen: 1.6,          // half the tabletop length
  thick: 0.16,
  topY: 0.22,            // tabletop surface height above the pivot
  tableMass: 5,
  ballastMass: 24,
  ballastL: 1.15,        // ballast centre distance below the pivot
  limit: 25 * DEG,       // physical end stops of the hinge
  angDamp: 7,
  pivotFriction: 3,      // joint friction torque
  floorY: -1.85,
  wallX: 2.2,            // inner face of the off-table walls (set from the screen width)
  hz: 60
};

function createSim(planck, opts) {
  const P = Object.assign({}, PHYS, opts || {});
  const V = planck.Vec2;
  const world = new planck.World({ gravity: V(0, -P.g), allowSleep: false });

  const ground = world.createBody({ type: 'static' });
  ground.setUserData({ kind: 'floor' });
  // Floor, side walls (off screen) and the pedestal plinth: these catch what
  // falls so it stays physical after a failure.
  const floorFix = [
    ground.createFixture(planck.Box(9, 0.5, V(0, P.floorY - 0.5), 0), { friction: 0.7 }),
    ground.createFixture(planck.Box(0.3, 4, V(-P.wallX - 0.3, P.floorY + 3.5), 0), { friction: 0.4 }),
    ground.createFixture(planck.Box(0.3, 4, V(P.wallX + 0.3, P.floorY + 3.5), 0), { friction: 0.4 }),
    ground.createFixture(planck.Polygon([V(-0.75, P.floorY), V(0.75, P.floorY), V(0.55, P.floorY + 0.28), V(-0.55, P.floorY + 0.28)]), { friction: 0.6 })
  ];
  for (const f of floorFix) f.setUserData({ kind: 'floor' });

  const table = world.createBody({ type: 'dynamic', position: V(0, 0), angularDamping: P.angDamp, bullet: true });
  table.setUserData({ kind: 'table' });
  const topFix = table.createFixture(planck.Box(P.halfLen, P.thick / 2, V(0, P.topY - P.thick / 2), 0), { friction: 0.62, restitution: 0.05, density: 1 });
  topFix.setUserData({ kind: 'table' });
  // The ballast is a weight on a rod; it never collides with anything.
  const ballastFix = table.createFixture(planck.Circle(V(0, -P.ballastL), 0.24), { density: 1, filterMaskBits: 0, filterCategoryBits: 0 });
  ballastFix.setUserData({ kind: 'ballast' });
  setTableMass();

  const joint = world.createJoint(planck.RevoluteJoint({
    enableLimit: true, lowerAngle: -P.limit, upperAngle: P.limit,
    enableMotor: true, motorSpeed: 0, maxMotorTorque: P.pivotFriction
  }, ground, table, V(0, 0)));

  // Explicit mass properties for the table assembly: tabletop plank plus a
  // point-like ballast, combined with the parallel-axis theorem.
  function setTableMass() {
    const mt = P.tableMass, mb = P.ballastMass;
    const L = P.halfLen * 2, cyT = P.topY - P.thick / 2, cyB = -P.ballastL;
    const m = mt + mb;
    const cy = (mt * cyT + mb * cyB) / m;
    const It = mt * (L * L + P.thick * P.thick) / 12 + mt * cyT * cyT;
    const Ib = mb * 0.5 * 0.24 * 0.24 + mb * cyB * cyB;
    table.setMassData({ mass: m, center: V(0, cy), I: It + Ib });
  }

  // ---- objects ----
  const bodies = [];

  function makeBody(def, x, y, angle) {
    const b = world.createBody({
      type: 'dynamic', position: V(x, y), angle: angle || 0,
      angularDamping: def.angDamp || 0.08, linearDamping: 0.02, bullet: false
    });
    for (const piece of def.pieces) {
      let shape;
      if (piece.circle) shape = planck.Circle(V(piece.circle[0], piece.circle[1]), piece.circle[2]);
      else shape = planck.Polygon(piece.map(p => V(p[0], p[1])));
      const f = b.createFixture(shape, { density: 1, friction: def.friction, restitution: def.restitution });
      f.setUserData({ kind: 'object' });
    }
    // Override mass and centre of mass with the object's authored values,
    // keeping the shape's inertia distribution (scaled to the new mass).
    const md = { mass: 0, center: V(0, 0), I: 0 };
    b.getMassData(md);
    const c0 = md.center, m0 = md.mass;
    const Ic0 = md.I - m0 * (c0.x * c0.x + c0.y * c0.y);
    const com = def.com ? V(def.com[0], def.com[1]) : V(c0.x, c0.y);
    const Ic = Ic0 * (def.mass / m0) * (def.inertiaScale || 1);
    b.setMassData({ mass: def.mass, center: com, I: Ic + def.mass * (com.x * com.x + com.y * com.y) });
    return b;
  }

  function overlapsAny(body) {
    const xf = body.getTransform();
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const aabb = f.getAABB(0);
      let hit = false;
      world.queryAABB(aabb, other => {
        if (other.getBody() === body) return true;
        const od = other.getUserData();
        if (od && od.kind === 'ballast') return true;
        if (!other.getBody().isActive()) return true;
        if (planck.testOverlap(f.getShape(), 0, other.getShape(), 0, xf, other.getBody().getTransform())) { hit = true; return false; }
        return true;
      });
      if (hit) return true;
    }
    return false;
  }

  // What is directly below a point: { kind: 'table' | 'object' | 'floor', y }
  // or null. `skip` is a body to ignore (the one being held).
  function supportBelow(x, y, skip) {
    let best = null, bestF = 2;
    const y1 = P.floorY - 1;
    world.rayCast(V(x, y), V(x, y1), (fix, point, normal, fraction) => {
      const d = fix.getUserData();
      if (!d || d.kind === 'ballast') return -1;
      if (!fix.getBody().isActive() || fix.getBody() === skip) return -1;
      if (fraction < bestF) { bestF = fraction; best = { kind: d.kind, y: point.y }; }
      return fraction;
    });
    return best;
  }

  // Place a body at (x, y), nudging it upward until it no longer overlaps
  // anything, so a release never starts inside another body.
  function placeClear(body, x, y) {
    let yy = y;
    for (let i = 0; i < 200; i++) {
      body.setTransform(V(x, yy), 0);
      if (!overlapsAny(body)) return yy;
      yy += 0.025;
    }
    return yy;
  }

  function addObject(def, x, y, vx, vy) {
    const b = makeBody(def, x, y, 0);
    placeClear(b, x, y);
    b.setLinearVelocity(V(vx || 0, vy || 0));
    bodies.push(b);
    return b;
  }

  function lift(b) { b.setActive(false); }
  function drop(b, x, y, vx, vy) {
    b.setActive(true);
    b.setAngularVelocity(0);
    placeClear(b, x, y);
    b.setLinearVelocity(V(vx || 0, vy || 0));
    b.setAwake(true);
  }
  function remove(b) {
    const i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
    world.destroyBody(b);
  }

  // Does the body touch the floor, the plinth or a wall?
  function touchesGround(b) {
    for (let ce = b.getContactList(); ce; ce = ce.next) {
      if (ce.other === ground && ce.contact.isTouching()) return true;
    }
    return false;
  }
  function touchesTableOrStack(b) {
    for (let ce = b.getContactList(); ce; ce = ce.next) {
      if (!ce.contact.isTouching()) continue;
      if (ce.other === table) return true;
      const ud = ce.other.getUserData();
      if (ud && ud.kind === 'object') return true;
    }
    return false;
  }

  function step() { world.step(1 / P.hz, 10, 4); }

  // Net gravitational torque about the pivot from everything resting on the
  // table (sum of m * g * x), and the combined load.
  function loadTorque() {
    let t = 0, m = 0;
    for (const b of bodies) {
      if (!b.isActive()) continue;
      const c = b.getWorldCenter();
      if (c.y < P.floorY + 0.6) continue;
      t += b.getMass() * P.g * c.x;
      m += b.getMass();
    }
    return { torque: t, mass: m };
  }

  return {
    P, world, table, joint, ground, bodies, planck,
    angle: () => table.getAngle(),
    angVel: () => table.getAngularVelocity(),
    addObject, lift, drop, remove, overlapsAny, supportBelow, placeClear,
    touchesGround, touchesTableOrStack, step, loadTorque, setTableMass,
    // Surface height of the tabletop at world x (for the current angle).
    surfaceY(x) { const a = table.getAngle(); return P.topY / Math.cos(a) + Math.tan(a) * x; }
  };
}

// ---- 04_scene.js ----
// Painted scene pieces: sprites for every object, the table, its stand and
// ballast, the stage floor, and the backdrop.

// Paint a world-space drawing into a sprite. `box` is [x0, y0, x1, y1] in
// world units (y up); R is pixels per unit.
function renderSprite(box, R, pad, seed, paint) {
  const w = (box[2] - box[0] + pad * 2) * R, h = (box[3] - box[1] + pad * 2) * R;
  const c = makeBuffer(w, h);
  const g = c.getContext('2d');
  const ox = (pad - box[0]) * R, oy = (pad + box[3]) * R;
  g.translate(ox, oy);
  g.scale(R, -R);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, R);
  paint(B, g);
  return { canvas: c, ox, oy, R };
}

function drawSprite(g, spr, x, y, angle, scale, alpha) {
  const k = scale / spr.R;
  g.save();
  g.translate(x, y);
  if (angle) g.rotate(-angle);
  g.scale(k, k);
  if (alpha != null) g.globalAlpha = alpha;
  g.drawImage(spr.canvas, -spr.ox, -spr.oy);
  g.restore();
}

function paintObjectSprite(def, R) {
  return renderSprite(def.box, R, 0.03, hashStr(def.id), B => {
    // a soft painted contact shadow under the base
    B.g.save();
    B.g.fillStyle = rgba(PAL.ink, 0.22);
    B.g.beginPath();
    const w = (def.box[2] - def.box[0]) * 0.42;
    B.g.ellipse((def.box[0] + def.box[2]) / 2, 0.004, w, 0.018, 0, 0, TAU);
    B.g.fill();
    B.g.restore();
    def.paint.call(def, B);
  });
}

// A silhouette of the object for selection halos and lift shadows.
function silhouetteSprite(spr, color) {
  const c = makeBuffer(spr.canvas.width, spr.canvas.height);
  const g = c.getContext('2d');
  g.drawImage(spr.canvas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return { canvas: c, ox: spr.ox, oy: spr.oy, R: spr.R };
}

// ---- Table ----
// Body-local coordinates (origin at the pivot). The collision plank is
// 4 x 0.16 with its top at y = 0.22. The painting adds a sliver of the top
// plane seen from slightly above, so objects stand *on* the table.
function paintTable(R) {
  const P = PHYS;
  const L = P.halfLen, top = P.topY;
  return renderSprite([-L - 0.08, -0.12, L + 0.08, top + 0.1], R, 0.04, 77, (B, g) => {
    const rnd = B.rnd;
    // top plane: warm wood with grain, seen from just above
    const plane = handPoly([[-L, top - 0.03], [L, top - 0.03], [L - 0.05, top + 0.075], [-L + 0.05, top + 0.075]], 0.004, rnd);
    B.gouache(plane, {
      base: '#8a4f28', box: [-L, top - 0.03, L, top + 0.08], washes: [PAL.wood, PAL.ochre, PAL.umber], strokeAngle: 0, strokes: 70, strokeLen: 1.2,
      strokeColors: [PAL.ochre, PAL.umber, '#b06a34'], shadow: 0.2, lit: 0.15, bottomShade: false, edge: false,
      inner: () => {
        for (let i = 0; i < 14; i++) {
          const y = top - 0.02 + rnd() * 0.09, x = -L + rnd() * 2 * L;
          B.stroke([[x, y], [x + 0.3 + rnd() * 0.5, y + (rnd() - 0.5) * 0.01]], PAL.umber, 1, 0.35);
        }
        // a cream inlay line along the back
        B.stroke([[-L + 0.08, top + 0.06], [L - 0.08, top + 0.06]], PAL.creamDeep, 1.4, 0.45, B.px(0.6));
      }
    });
    B.edge(plane, PAL.ink, 1.4);
    // front apron: terracotta with a painted frieze
    const apron = handPoly([[-L - 0.03, top - 0.03], [L + 0.03, top - 0.03], [L + 0.03, top - P.thick - 0.01], [-L - 0.03, top - P.thick - 0.01]], 0.003, rnd);
    B.gouache(apron, {
      base: PAL.terracotta, box: [-L - 0.03, top - P.thick, L + 0.03, top - 0.03], washes: [PAL.tomato, PAL.orange, PAL.burgundy], strokeAngle: 0, strokes: 40, strokeLen: 0.9,
      shadow: 0.3, lit: 0.2, bottomShade: true,
      inner: () => {
        const y0 = top - P.thick - 0.01, y1 = top - 0.03, ym = (y0 + y1) / 2;
        B.stroke([[-L, y1 - 0.012], [L, y1 - 0.012]], PAL.forest, 3.2, 0.95, B.px(0.6));
        B.stroke([[-L, y0 + 0.012], [L, y0 + 0.012]], PAL.forest, 3.2, 0.95, B.px(0.6));
        // repeating motif: mustard half-moons, cream dots, olive leaves
        for (let x = -L + 0.12, i = 0; x < L - 0.08; x += 0.16, i++) {
          if (i % 2 === 0) {
            B.g.fillStyle = rgba(PAL.mustard, 0.95);
            B.g.beginPath(); B.g.ellipse(x, ym - 0.015, 0.035, 0.03, 0, 0, Math.PI); B.g.fill();
            B.dot(x, ym + 0.022, 1.5, PAL.cream, 0.95);
          } else {
            B.petal(x - 0.045, ym, x, ym + 0.02, 0.01, PAL.olive, 0.95);
            B.petal(x + 0.045, ym, x, ym + 0.02, 0.01, PAL.olive, 0.95);
            B.dot(x, ym - 0.012, 1.8, PAL.cream, 0.95);
          }
        }
      }
    });
    B.edge(apron, PAL.ink, 1.6);
    // scalloped skirt hanging under the apron
    const sk = [];
    const y0 = top - P.thick - 0.01;
    sk.push([-L + 0.06, y0]);
    for (let x = -L + 0.06, i = 0; x <= L - 0.05; x += 0.1, i++) sk.push([x + 0.05, y0 - 0.055 - (i % 2) * 0.006]);
    sk.push([L - 0.06, y0]);
    const skirt = wobblePath(sk, 0.003, rnd);
    B.gouache(skirt, { base: PAL.forest, box: [-L, y0 - 0.07, L, y0], washes: [PAL.olive], strokeAngle: 0, strokes: 18, shadow: 0.3, lit: 0.2, bottomShade: false });
    for (let x = -L + 0.11; x < L - 0.05; x += 0.1) B.dot(x, y0 - 0.035, 1.6, PAL.mustard, 0.9);
    // brass end caps
    for (const s of [-1, 1]) {
      const cap = wobblePath(ellipsePts(s * (L + 0.035), top - 0.095, 0.035, 0.075, 12), 0.002, rnd);
      brassFill(B, cap, [s * (L + 0.035) - 0.035, top - 0.17, s * (L + 0.035) + 0.035, top - 0.02]);
    }
    // the hinge boss at the pivot
    const boss = wobblePath(ellipsePts(0, top - 0.14, 0.07, 0.07, 14), 0.002, rnd);
    brassFill(B, boss, [-0.07, top - 0.21, 0.07, top - 0.07]);
    B.dot(0, top - 0.14, 3, PAL.ink, 0.9);
  });
}

// Ballast: rod from the pivot to an ornamental brass plumb, body-local.
function paintBallast(R) {
  const Lb = PHYS.ballastL;
  return renderSprite([-0.3, -Lb - 0.4, 0.3, 0.1], R, 0.04, 91, (B, g) => {
    const rnd = B.rnd;
    B.stroke([[0, 0.02], [0, -Lb + 0.2]], PAL.brassDark, 6, 1);
    B.stroke([[0, 0.02], [0, -Lb + 0.2]], PAL.brass, 3.2, 1);
    B.stroke([[-0.004, 0], [-0.004, -Lb + 0.22]], PAL.brassLight, 1, 0.7);
    for (const y of [-0.35, -0.7]) { const k = wobblePath(ellipsePts(0, y, 0.03, 0.03, 10), 0.002, rnd); brassFill(B, k, [-0.03, y - 0.03, 0.03, y + 0.03]); }
    const prof = [[0.0, -Lb - 0.33], [0.06, -Lb - 0.22], [0.2, -Lb - 0.06], [0.24, -Lb + 0.04], [0.2, -Lb + 0.13], [0.09, -Lb + 0.19], [0.05, -Lb + 0.24]];
    const bob = wobblePath(lathe(prof), 0.003, rnd);
    brassFill(B, bob, [-0.24, -Lb - 0.33, 0.24, -Lb + 0.24], () => {
      B.stroke([[-0.235, -Lb + 0.02], [0, -Lb + 0.03], [0.235, -Lb + 0.02]], PAL.vermilion, 4, 0.95);
      for (let i = 0; i < 6; i++) B.dot(-0.17 + i * 0.068, -Lb + 0.025, 1.8, PAL.cream, 0.95);
      B.stroke([[-0.18, -Lb - 0.1], [0, -Lb - 0.09], [0.18, -Lb - 0.1]], PAL.brassDark, 1.6, 0.8);
      B.stroke([[-0.16, -Lb + 0.12], [0, -Lb + 0.125], [0.16, -Lb + 0.12]], PAL.brassDark, 1.6, 0.8);
    });
    B.shine([[-0.16, -Lb - 0.06], [-0.19, -Lb + 0.04], [-0.14, -Lb + 0.12]], '#fff6d2', 3, 0.9);
  });
}

// The lyre-shaped stand: two green legs rising from a plinth to the hinge,
// open in the middle so the plumb can swing between them. World coordinates.
function paintStand(R) {
  const fy = PHYS.floorY;
  return renderSprite([-0.95, fy - 0.02, 0.95, 0.12], R, 0.05, 55, (B, g) => {
    const rnd = B.rnd;
    // plinth (matches the collision trapezoid)
    const plinth = handPoly([[-0.75, fy], [0.75, fy], [0.55, fy + 0.28], [-0.55, fy + 0.28]], 0.004, rnd);
    B.gouache(plinth, {
      base: PAL.burgundyDeep, box: [-0.75, fy, 0.75, fy + 0.28], washes: [PAL.wine, PAL.umber], strokeAngle: 0, strokes: 20,
      inner: () => {
        B.stroke([[-0.7, fy + 0.05], [0.7, fy + 0.05]], PAL.mustard, 2.4, 0.9);
        for (let i = 0; i < 9; i++) B.petal(-0.48 + i * 0.12, fy + 0.12, -0.48 + i * 0.12, fy + 0.22, 0.02, PAL.ochre, 0.9);
      }
    });
    // legs
    for (const s of [-1, 1]) {
      const leg = wobblePath([
        [s * 0.34, fy + 0.27], [s * 0.5, fy + 0.27], [s * 0.52, fy + 0.6], [s * 0.42, fy + 1.1], [s * 0.3, fy + 1.55], [s * 0.15, fy + 1.95], [s * 0.06, -0.02],
        [s * 0.02, -0.02], [s * 0.08, fy + 1.9], [s * 0.2, fy + 1.5], [s * 0.3, fy + 1.05], [s * 0.38, fy + 0.62]
      ], 0.003, rnd);
      B.gouache(leg, {
        base: PAL.forest, box: [Math.min(s * 0.52, s * 0.02), fy + 0.27, Math.max(s * 0.52, s * 0.02), 0], washes: [PAL.olive, '#24391f'], strokes: 22, strokeAngle: Math.PI / 2 - s * 0.25,
        inner: () => {
          for (let i = 0; i < 5; i++) { const t = 0.15 + i * 0.17; B.dot(s * lerp(0.44, 0.08, t), lerp(fy + 0.4, -0.1, t), 2, PAL.mustard, 0.9); }
        }
      });
      // brass collars
      const col = wobblePath(ellipsePts(s * 0.37, fy + 1.1, 0.07, 0.03, 10), 0.002, rnd);
      brassFill(B, col, [s * 0.37 - 0.07, fy + 1.07, s * 0.37 + 0.07, fy + 1.13]);
    }
    // the knife-edge fulcrum the hinge rests on
    const knife = handPoly([[-0.12, -0.08], [0.12, -0.08], [0, 0.04]], 0.002, rnd);
    brassFill(B, knife, [-0.12, -0.08, 0.12, 0.04]);
  });
}

// Stage floor: dark boards with a painted front edge. World coordinates.
function paintFloor(R) {
  const fy = PHYS.floorY;
  return renderSprite([-5.2, fy - 3.2, 5.2, fy + 0.08], R, 0, 33, (B, g) => {
    const rnd = B.rnd;
    const top = handPoly([[-5.2, fy - 0.25], [5.2, fy - 0.25], [5.2, fy + 0.06], [-5.2, fy + 0.06]], 0.004, rnd);
    B.gouache(top, {
      base: '#5a2e1c', box: [-5.2, fy - 0.25, 5.2, fy + 0.06], washes: [PAL.umber, PAL.wood, PAL.burgundy], strokeAngle: 0, strokes: 90, strokeLen: 1.6,
      strokeColors: [PAL.wood, PAL.umber, '#7d4a2a'], shadow: 0.1, lit: 0.1, edge: false
    });
    for (let x = -5; x < 5.2; x += 0.9 + rnd() * 0.4) B.stroke([[x, fy + 0.05], [x - 0.15, fy - 0.24]], PAL.ink, 1, 0.35);
    const front = handPoly([[-5.2, fy - 3.2], [5.2, fy - 3.2], [5.2, fy - 0.25], [-5.2, fy - 0.25]], 0.004, rnd);
    B.gouache(front, {
      base: PAL.burgundyDeep, box: [-5.2, fy - 3.2, 5.2, fy - 0.25], washes: [PAL.wine, '#1f070d'], strokeAngle: 0, strokes: 60, strokeLen: 2, shadow: 0.2, lit: 0.1, edge: false,
      inner: () => {
        B.stroke([[-5.2, fy - 0.3], [5.2, fy - 0.3]], PAL.ochre, 3, 0.9, B.px(0.8));
        B.stroke([[-5.2, fy - 0.36], [5.2, fy - 0.36]], PAL.ochre, 1.2, 0.7, B.px(0.6));
      }
    });
    B.stroke([[-5.2, fy + 0.06], [5.2, fy + 0.06]], PAL.ink, 1.6, 0.6, B.px(0.5));
  });
}

// Backdrop at screen resolution: muted burgundy wall, faint painted damask,
// a warm pool of light behind the table and darker theatrical edges.
function paintBackdrop(W, H, dpr, focusY, seed) {
  const c = makeBuffer(W * dpr, H * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, 1);
  g.fillStyle = PAL.burgundy;
  g.fillRect(0, 0, W, H);
  // broad layered washes
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rgba([PAL.wine, PAL.burgundyDeep, '#5a1a26', PAL.umber][i % 4], 0.08 + rnd() * 0.1);
    g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 60 + rnd() * 180, 40 + rnd() * 140, rnd() * 3, 0, TAU); g.fill();
  }
  // vertical dry-brush texture
  B.dryBrush([0, 0, W, H], [PAL.wine, PAL.burgundyDeep, '#62202c'], 180, Math.PI / 2, H * 0.25);
  // damask: rows of painted medallions, very low contrast
  const step = 92;
  for (let row = 0, y = 30; y < H + step; y += step, row++) {
    for (let x = (row % 2) * step / 2 - 10; x < W + step; x += step) {
      const col = rgba('#7a2a36', 0.22 + rnd() * 0.08);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.785;
        B.petal(x, y, x + Math.cos(a) * 22, y + Math.sin(a) * 22, 7, '#7a2a36', 0.2 + rnd() * 0.06);
      }
      g.fillStyle = col; g.beginPath(); g.ellipse(x, y, 5, 5, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(PAL.ochre, 0.07); g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(x, y, 30, 34, 0, 0, TAU); g.stroke();
    }
  }
  // warm light behind the table
  const gl = g.createRadialGradient(W / 2, focusY, 10, W / 2, focusY, Math.max(W, H) * 0.6);
  gl.addColorStop(0, 'rgba(226,120,60,0.30)');
  gl.addColorStop(0.45, 'rgba(160,60,40,0.12)');
  gl.addColorStop(1, 'rgba(20,4,8,0)');
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
  // darker painted edges (theatrical vignette), drawn as brushy bands
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side > 0 ? W - rnd() * 34 : rnd() * 34;
    g.strokeStyle = rgba(PAL.burgundyDeep, 0.18 + rnd() * 0.2);
    g.lineWidth = 18 + rnd() * 30; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, -20); g.bezierCurveTo(x + (rnd() - 0.5) * 30, H * 0.3, x + (rnd() - 0.5) * 30, H * 0.7, x, H + 20); g.stroke();
  }
  const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,3,8,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}

// The presentation shelf at the bottom: an olive cloth with a mustard fringe.
function paintTray(W, h, dpr, seed) {
  const c = makeBuffer(W * dpr, (h + 16) * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, 1);
  const cloth = handPoly([[-6, 10], [W + 6, 8], [W + 6, h + 16], [-6, h + 16]], 3, rnd);
  B.gouache(cloth, { base: PAL.forest, box: [0, 8, W, h + 16], washes: [PAL.olive, '#1d301b'], strokeAngle: 0, strokes: 80, strokeLen: W * 0.3, shadow: 0.2, lit: 0.12, bottomShade: false, edge: false });
  // fringe and border
  B.stroke([[0, 14], [W, 13]], PAL.mustard, 3.5, 0.95, 1);
  B.stroke([[0, 20], [W, 19.5]], PAL.ochre, 1.5, 0.8, 1);
  for (let x = 4; x < W; x += 7) B.stroke([[x, 9], [x + (rnd() - 0.5) * 2, 2 + rnd() * 3]], PAL.mustard, 1.6, 0.85);
  for (let x = 18; x < W; x += 36) B.dot(x, 26, 2, PAL.cream, 0.6);
  return c;
}

// ---- 05_audio.js ----
// Material sounds, synthesised with WebAudio so every contact can be tuned to
// the object's size and the strength of the impact. No samples are loaded.

function createAudio() {
  let ac = null, master = null, verb = null, muted = false, noiseBuf = null;
  let lastCreak = 0;
  const lastHit = new Map();

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ac = new AC(); } catch (e) { ac = null; return false; }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ac.destination);
    // a small, dark room: a feedback delay network is enough for warmth
    verb = ac.createGain(); verb.gain.value = 0.18;
    const d1 = ac.createDelay(0.2), d2 = ac.createDelay(0.2), fb = ac.createGain(), lp = ac.createBiquadFilter();
    d1.delayTime.value = 0.037; d2.delayTime.value = 0.053; fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 2400;
    verb.connect(d1); d1.connect(d2); d2.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(master);
    const len = ac.sampleRate * 0.5;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; ch[i] = (s / 2147483647) * 2 - 1; }
    return true;
  }

  function out(node, wet) {
    node.connect(master);
    if (wet) { const w = ac.createGain(); w.gain.value = wet; node.connect(w); w.connect(verb); }
  }

  // A decaying sine partial.
  function partial(t, f, amp, decay, wet, attack = 0.002) {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(amp, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(gn); out(gn, wet);
    o.start(t); o.stop(t + decay + 0.05);
  }
  // A filtered noise burst.
  function noise(t, f, q, amp, decay, type = 'bandpass', wet = 0) {
    const src = ac.createBufferSource(), flt = ac.createBiquadFilter(), gn = ac.createGain();
    src.buffer = noiseBuf; flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    gn.gain.setValueAtTime(amp, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(flt); flt.connect(gn); out(gn, wet);
    src.start(t, Math.random() * 0.3); src.stop(t + decay + 0.05);
  }

  // strength 0..1, size ~ object height in units (bigger sounds lower)
  const VOICES = {
    ceramic(t, s, k) { // delicate hollow clink
      partial(t, 1850 * k, 0.22 * s, 0.16, 0.5);
      partial(t, 2980 * k, 0.13 * s, 0.11, 0.5);
      partial(t, 4410 * k, 0.07 * s, 0.07, 0.4);
      noise(t, 900 * k, 3, 0.18 * s, 0.05);
    },
    brass(t, s, k) { // soft metallic resonance
      partial(t, 410 * k, 0.16 * s, 1.3, 0.8, 0.004);
      partial(t, 1105 * k, 0.11 * s, 0.9, 0.8, 0.004);
      partial(t, 1890 * k, 0.07 * s, 0.6, 0.7);
      partial(t, 2710 * k, 0.04 * s, 0.4, 0.6);
      noise(t, 2600 * k, 2, 0.06 * s, 0.03);
    },
    glass(t, s, k) { // light ringing
      partial(t, 3150 * k, 0.12 * s, 0.7, 0.9);
      partial(t, 4720 * k, 0.07 * s, 0.5, 0.9);
      partial(t, 6930 * k, 0.04 * s, 0.35, 0.8);
      noise(t, 5000, 4, 0.05 * s, 0.02);
    },
    fruit(t, s, k) { // muted organic thud
      partial(t, 95 * k, 0.4 * s, 0.09, 0.1);
      noise(t, 380 * k, 1, 0.35 * s, 0.07, 'lowpass');
    },
    books(t, s, k) { // soft heavy contact
      partial(t, 72, 0.45 * s, 0.12, 0.15);
      noise(t, 260, 0.8, 0.45 * s, 0.11, 'lowpass');
      noise(t, 1600, 1.2, 0.06 * s, 0.03);
    },
    wood(t, s, k) {
      partial(t, 190 * k, 0.25 * s, 0.12, 0.3);
      partial(t, 360 * k, 0.12 * s, 0.08, 0.3);
      noise(t, 700 * k, 2, 0.15 * s, 0.05);
    }
  };

  return {
    unlock: ensure,
    get ready() { return !!ac; },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
    get muted() { return muted; },
    // Impact between a body and something; throttled per body.
    hit(key, material, strength, size) {
      if (!ac || muted || strength < 0.03) return;
      const now = ac.currentTime;
      const last = lastHit.get(key) || 0;
      if (now - last < 0.07) return;
      lastHit.set(key, now);
      const k = clamp(0.55 / Math.max(0.2, size), 0.55, 1.8);
      const v = VOICES[material] || VOICES.wood;
      v(now + 0.005, clamp(strength, 0, 1), k);
    },
    // Restrained wooden creak: stick-slip grains through a resonant filter.
    creak(intensity) {
      if (!ac || muted) return;
      const now = ac.currentTime;
      if (now - lastCreak < 0.9) return;
      lastCreak = now;
      const o = ac.createOscillator(), flt = ac.createBiquadFilter(), gn = ac.createGain();
      o.type = 'sawtooth';
      const f0 = 70 + Math.random() * 40;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.linearRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), now + 0.45);
      flt.type = 'bandpass'; flt.frequency.value = 640 + Math.random() * 300; flt.Q.value = 7;
      gn.gain.setValueAtTime(0.0001, now);
      const a = 0.05 + 0.08 * clamp(intensity, 0, 1);
      for (let i = 0; i < 9; i++) {
        const t = now + i * 0.05 + Math.random() * 0.02;
        gn.gain.linearRampToValueAtTime(a * (0.4 + Math.random() * 0.6), t + 0.008);
        gn.gain.linearRampToValueAtTime(a * 0.08, t + 0.035);
      }
      gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      o.connect(flt); flt.connect(gn); out(gn, 0.4);
      o.start(now); o.stop(now + 0.6);
    },
    // Quiet paper/cloth swish when an object is picked up.
    pick() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      noise(t, 1800, 0.7, 0.05, 0.12, 'bandpass');
    },
    // Two soft brass chimes for a bonus.
    chime(up) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      partial(t, up ? 880 : 660, 0.07, 1.1, 0.9, 0.005);
      partial(t + 0.11, up ? 1320 : 990, 0.06, 1.2, 0.9, 0.005);
    },
    dispose() { if (ac) { try { ac.close(); } catch (e) {} ac = null; } }
  };
}

// ---- 06_game.js ----
// The game: layout, input, rules, scoring, rendering and the Plethora lifecycle.

const SAFE_DEFAULT = 17;   // degrees: beyond this for too long and the table is lost
const GRACE = 1.0;         // seconds the table may spend past the safe angle
const BAL = 3.5 * DEG;     // "balanced" zone of the gauge
const TRAY_CAP = 3;

window.plethoraBit = {
  meta: {
    title: 'The Unstable Table',
    runtime: 'plethora-bit@2',
    tags: ['physics', 'balance', 'casual', 'art'],
    permissions: ['audio', 'backgroundMusic', 'haptics', 'storage']
  },

  async init(ctx) {
    const DEV = !!window.__UT_DEV;
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    const canvas = ctx.createCanvas2D({ coordinateSpace: 'css', maxDpr: 2, alpha: false, layer: 'content', touchAction: 'none' });
    const g = canvas.getContext('2d');
    hiddenCanvasFactory = () => {
      const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' });
      c.style.display = 'none';
      return c;
    };
    let W = ctx.width, H = ctx.height;
    const dprOf = () => Math.min(2, ctx.dpr || 1);

    // ---- tuning (creator knobs; defaults when unavailable) ----
    const tune = ctx.tune;
    const tn = (id, d) => { try { const v = tune && tune.number(id); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const tms = (id, d) => { try { const v = tune && tune.durationMs(id); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const SAFE = tn('safe_angle', SAFE_DEFAULT) * DEG;
    const CRIT = SAFE * 0.66;
    const simOpts = { ballastMass: tn('ballast_mass', PHYS.ballastMass), angDamp: tn('table_damping', PHYS.angDamp) };
    const ARRIVE_START = tms('arrival_start', 9000) / 1000, ARRIVE_MIN = tms('arrival_min', 3200) / 1000;

    // ---- first frame while the physics library loads ----
    g.fillStyle = PAL.burgundy; g.fillRect(0, 0, W, H);
    g.fillStyle = rgba(PAL.cream, 0.7); g.font = 'italic 18px Georgia, serif'; g.textAlign = 'center';
    g.fillText('laying the table…', W / 2, H / 2);

    const fontLoads = Promise.all([
      ctx.loadFont('UT Serif', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }),
      ctx.loadFont('UT Serif', 'dm-serif-display', '1.0.0', { weight: '400', style: 'italic' })
    ]).then(() => { fontsReady = true; }).catch(e => { if (DEV) console.warn('font', e); });
    let fontsReady = false;
    const F = (size, italic) => `${italic ? 'italic ' : ''}${size}px ${fontsReady ? '"UT Serif", ' : ''}Georgia, "Times New Roman", serif`;

    let planck;
    try {
      await ctx.loadScript('planck', '1.5.0');
      planck = window.planck;
      if (!planck || !planck.World) throw new Error('planck global missing after load');
    } catch (err) {
      ctx.platform.error({ stage: 'dependency', message: String(err && err.message || err) });
      g.fillStyle = PAL.burgundy; g.fillRect(0, 0, W, H);
      g.fillStyle = PAL.cream; g.font = 'italic 17px Georgia, serif';
      g.fillText('The physics engine could not be loaded.', W / 2, H / 2 - 10);
      g.fillText('Please reopen the Bit.', W / 2, H / 2 + 16);
      ctx.markVisualReady('dependency-error');
      ctx.platform.ready();
      return;
    }
    if (destroyed) return;

    // ---- persistent bits ----
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    const load = (k, d) => { if (!canStore) return d; try { const v = ctx.storage.get(k); return v == null ? d : v; } catch (e) { return d; } };
    const save = (k, v) => { if (!canStore) return; try { ctx.storage.set(k, v); } catch (e) {} };
    let best = load('best', { score: 0, placed: 0, streak: 0 });
    let seenHint = !!load('seenHint', false);

    // ---- audio ----
    const audio = createAudio();
    audio.setMuted(!!load('muted', false));
    ctx.onDestroy(() => audio.dispose());
    let music = null;
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music);
    const musicVol = tn('music_volume', 0.32);
    function startMusic() {
      if (!canMusic || music || audio.muted) return;
      try {
        ctx.music.unlock && ctx.music.unlock().catch(() => {});
        music = ctx.music.play({ preset: 'ambient', volume: musicVol, tempo: 66, scale: 'dorian', intensity: 0.25, fadeInMs: 2400 });
      } catch (e) { music = null; }
    }
    function musicIntensity(v) { try { music && music.setIntensity(v, { fadeMs: 900 }); } catch (e) {} }
    function sting(name) { try { if (music && !audio.muted) ctx.music.sting(name).catch(() => {}); } catch (e) {} }
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    const haptic = k => { if (canHaptic) try { ctx.platform.haptic(k); } catch (e) {} };

    const scoreTrack = ctx.game.score();

    // ---- layout ----
    const L = {};
    function layout() {
      W = ctx.width; H = ctx.height;
      const a = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      L.top = a.top + 10; L.left = Math.max(16, a.left + 12); L.right = W - Math.max(16, a.right + 12);
      L.bottom = H - Math.max(a.bottom, 16) - 6;
      L.hudH = 74; L.hudBottom = L.top + L.hudH;
      L.viewTop = L.top + 112; // the scene is framed below this line (keeps the table zoomed out a little)
      L.trayH = clamp(H * 0.15, 104, 130);
      L.trayTop = L.bottom - L.trayH;
      L.s0 = Math.min((W - 28) / (PHYS.halfLen * 2 + 0.45), (L.trayTop - L.viewTop) / (-PHYS.floorY + 0.3 + 2.5));
      L.pivotX = W / 2;
      L.pivotY = L.trayTop - 0.3 * L.s0 + PHYS.floorY * L.s0; // a strip of stage floor shows above the tray
      if (!cam.s) cam.s = L.s0;
      L.gauge = { x: W / 2, y: L.top + 46, r: Math.min(40, W * 0.1) };
      L.mute = { x: L.right - 16, y: L.top + 62, r: 16 };
    }
    const cam = { s: 0 };
    const W2S = (x, y) => [L.pivotX + x * cam.s, L.pivotY - y * cam.s];
    const S2W = (x, y) => [(x - L.pivotX) / cam.s, (L.pivotY - y) / cam.s];

    // ---- painted assets ----
    let A = null, assetsR = 0;
    function buildAssets() {
      const dpr = dprOf();
      const R = Math.round(clamp(L.s0 * dpr * 1.1, 110, 280));
      if (!A || Math.abs(R - assetsR) / assetsR > 0.2) {
        assetsR = R;
        const objs = {};
        for (const o of OBJECTS) { const spr = paintObjectSprite(o, R); objs[o.id] = { spr, halo: silhouetteSprite(spr, PAL.cream), shadow: silhouetteSprite(spr, PAL.ink) }; }
        A = Object.assign(A || {}, { objs, table: paintTable(R), ballast: paintBallast(R), stand: paintStand(R), floor: paintFloor(Math.round(R * 0.5)) });
        A.grain = A.grain || paintPaperGrain(256, 4242);
      }
      A.backdrop = paintBackdrop(W, H, dpr, L.pivotY, 1717);
      A.tray = paintTray(W, H - L.trayTop + 8, dpr, 919);
      A.grainPat = g.createPattern(A.grain, 'repeat');
      try { A.grainPat.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) {}
    }

    // ---- run state ----
    let sim = null, run = null, attempt = 0, started = false;
    const popups = [], puffs = [], flashes = [];

    function newRun() {
      attempt++;
      sim = createSim(planck, Object.assign({ wallX: clamp(W / 2 / L.s0, 2.0, 3.5) }, simOpts));
      sim.world.on('post-solve', onPostSolve);
      const seed = DEV && window.__UT_SEED != null ? window.__UT_SEED + attempt : ((Date.now() ^ (attempt * 2654435761)) >>> 0);
      run = {
        state: 'playing', t: 0, seed, rnd: mulberry(seed),
        recs: [], tray: [], held: null, recent: [],
        placed: 0, points: 0, mult: 1, streak: 0, bestStreak: 0,
        arriveT: 0, emptyT: 0, overT: 0, eqT: 0, critAt: -1, inCrit: false, zone: 0,
        cause: '', collapseT: 0, result: null, pulsed: false, newBest: false, heavyPlaced: 0, recoveries: 0
      };
      popups.length = 0; puffs.length = 0; flashes.length = 0;
      cam.s = L.s0;
      scoreTrack.reset();
      prevTable = 0;
      arrive(); // the first object is waiting
    }

    // ---- choosing objects: controlled randomness ----
    function tableKeff() {
      // Restoring stiffness left once the load's height is accounted for.
      const P = sim.P;
      let k = P.ballastMass * P.g * P.ballastL - P.tableMass * P.g * (P.topY - P.thick / 2);
      for (const r of run.recs) if (r.body.isActive()) k -= r.body.getMass() * P.g * Math.max(0, r.body.getWorldCenter().y);
      return k;
    }
    function canHost(def) {
      const P = sim.P;
      const k = tableKeff() - def.mass * P.g * (P.topY + (def.com ? def.com[1] : 0.25));
      if (k <= 0) return true; // the endgame: anything is risky now
      const tq = Math.abs(sim.loadTorque().torque);
      return Math.max(0, tq - def.mass * P.g * 0.45) <= k * Math.sin(CRIT) * 0.8;
    }
    function pickDef() {
      const n = run.placed + run.tray.length;
      const tiers = n < 3 ? [1] : n < 8 ? [1, 2] : [1, 2, 3];
      const wTier = { 1: n < 8 ? 1 : 0.55, 2: 1, 3: n < 14 ? 0.9 : 1.4 };
      if (n === 0) return OBJECT_BY_ID[['bowl', 'teapot', 'lidpot'][Math.floor(run.rnd() * 3)]];
      for (let tries = 0; tries < 24; tries++) {
        const pool = OBJECTS.filter(o => tiers.includes(o.tier) && !run.recent.includes(o.id));
        let tot = 0; for (const o of pool) tot += wTier[o.tier];
        let r = run.rnd() * tot, pick = pool[0];
        for (const o of pool) { r -= wTier[o.tier]; if (r <= 0) { pick = o; break; } }
        // at most one round, rolling thing waiting at once
        const rolling = o => (o.angDamp || 0) > 1;
        if (rolling(pick) && run.tray.some(t => rolling(t.def)) && tries < 20) continue;
        if (!canHost(pick) && tries < 20) continue;
        return pick;
      }
      return OBJECT_BY_ID.lemon;
    }
    function arrive() {
      const def = pickDef();
      run.recent.push(def.id); if (run.recent.length > 4) run.recent.shift();
      run.tray.push({ def, counted: false, born: run.t });
      run.arriveT = 0;
      if (run.placed > 0) audio.chime(false);
    }
    function arrivalInterval() {
      if (run.placed < 5) return Infinity;
      return Math.max(ARRIVE_MIN, ARRIVE_START - (run.placed - 5) * 0.35);
    }

    // ---- contacts: sound and paint ----
    const hits = [];
    function onPostSolve(contact, imp) {
      let n = 0;
      const ni = imp.normalImpulses;
      for (let i = 0; i < ni.length; i++) n += ni[i] || 0;
      const prev = contact.__ut || 0;
      contact.__ut = n;
      const jump = n - prev;
      if (jump <= 0) return;
      const fa = contact.getFixtureA(), fb = contact.getFixtureB();
      const ba = fa.getBody(), bb = fb.getBody();
      const ra = ba.getUserData && ba.getUserData(), rb = bb.getUserData && bb.getUserData();
      const recA = ra && ra.rec, recB = rb && rb.rec;
      const m = Math.min(recA ? ba.getMass() : 1e9, recB ? bb.getMass() : 1e9);
      if (m === 1e9) return;
      const strength = jump / (m * 2.2);
      if (strength < 0.12) return;
      hits.push({ contact, recA, recB, a: ba, b: bb, strength: Math.min(1, strength) });
    }
    function processHits() {
      for (const h of hits) {
        const wm = h.contact.getWorldManifold(null);
        const p = wm && wm.points && wm.points[0];
        const rec = h.recA || h.recB, other = h.recA ? h.recB : h.recA;
        const otherBody = h.recA ? h.b : h.a;
        const s = h.strength;
        audio.hit(rec.id, MATERIAL_SOUND[rec.def.material], s * 0.9, rec.def.box[3]);
        if (other) audio.hit(other.id + 'b', MATERIAL_SOUND[other.def.material], s * 0.5, other.def.box[3]);
        else if (otherBody === sim.table) { audio.hit('table', 'wood', s * 0.5, 0.6); if (p && s > 0.2) flashes.push({ x: sim.table.getLocalPoint(p).x, t: 0, s }); }
        if (p && s > 0.28) {
          const cols = { ceramic: PAL.cream, brass: PAL.brassLight, glass: '#ffffff', fruit: PAL.mustard, books: PAL.creamDeep, wood: PAL.ochre };
          puffs.push({ x: p.x, y: p.y, t: 0, s, c: cols[rec.def.material] || PAL.cream, seed: (run.t * 1000) | 0 });
        }
        if (s > 0.5 && rec.def.mass > 2) haptic('light');
      }
      hits.length = 0;
    }

    // ---- object records ----
    let recId = 0;
    function makeRec(def, body, counted) {
      const rec = { id: 'o' + (recId++), def, body, counted, settleT: 0, px: 0, py: 0, pa: 0, dropT: run.t };
      body.setUserData({ kind: 'object', rec });
      const p = body.getPosition(); rec.px = p.x; rec.py = p.y; rec.pa = body.getAngle();
      run.recs.push(rec);
      return rec;
    }

    // ---- scoring ----
    function popup(text, x, y, color) { popups.push({ text, x, y, t: 0, color: color || PAL.cream }); }
    function addPoints(p) { run.points += p; scoreTrack.set(run.points); }
    function onPlaced(rec) {
      run.placed++;
      run.streak++;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      run.mult = Math.min(3, 1 + 0.5 * Math.floor(run.streak / 3));
      let pts = 100 * run.mult;
      const [sx, sy] = W2S(rec.body.getPosition().x, rec.body.getPosition().y + rec.def.box[3]);
      if (rec.def.weight === 'heavy') { pts += 60 * run.mult; run.heavyPlaced++; popup('heavy  +' + Math.round(160 * run.mult), sx, sy - 6, PAL.mustard); haptic('medium'); }
      else { popup('+' + Math.round(pts), sx, sy - 6); haptic('light'); }
      if (run.streak > 0 && run.streak % 3 === 0 && run.mult > 1) { popup('steady hand  ×' + run.mult, W / 2, L.hudBottom + 62, PAL.mustard); audio.chime(true); }
      addPoints(Math.round(pts));
      try { ctx.platform.interact({ kind: 'placed', id: rec.def.id }); } catch (e) {}
      if (run.placed % 10 === 0) try { ctx.platform.milestone('placed_' + run.placed); } catch (e) {}
      if (!seenHint) { seenHint = true; save('seenHint', true); }
    }

    // ---- failure ----
    function fail(cause) {
      if (run.state !== 'playing') return;
      run.state = 'collapse';
      run.cause = cause;
      run.collapseT = 0;
      popups.length = 0;
      if (run.held) cancelHeld(true);
      haptic('error');
      sting('lose');
      try { music && music.setIntensity(0.1, { fadeMs: 1500 }); } catch (e) {}
      audio.creak(1);
    }
    function finish() {
      run.state = 'over';
      const res = { score: run.points, placed: run.placed, streak: run.bestStreak, board: { status: 'saving', rows: [], rank: null } };
      run.result = res;
      run.newBest = res.score > (best.score || 0);
      best = { score: Math.max(best.score || 0, res.score), placed: Math.max(best.placed || 0, res.placed), streak: Math.max(best.streak || 0, res.streak) };
      save('best', best);
      if (run.newBest && res.score > 0) { sting('success'); }
      try { ctx.platform.fail({ score: res.score, placed: res.placed, cause: run.cause }); } catch (e) {}
      const my = attempt;
      // Leaderboard work never blocks replay; results are fenced to this attempt.
      (async () => {
        try {
          await scoreTrack.submit('score', { label: res.score.toLocaleString() + ' pts', metadata: { placed: res.placed, streak: res.streak } });
          const lb = await scoreTrack.leaderboard('score', { scope: 'global', period: 'all_time', limit: 3 });
          if (destroyed || my !== attempt) return;
          res.board = { status: 'ok', rows: (lb && lb.rows || []).slice(0, 3), rank: lb && lb.viewerRank ? lb.viewerRank.rank : null };
        } catch (e) {
          if (destroyed || my !== attempt) return;
          res.board = { status: 'unavailable', rows: [], rank: null };
        }
      })();
    }

    // ---- input ----
    let pointerId = null, finger = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
    function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    function slotRects() {
      const n = Math.max(TRAY_CAP, run.tray.length);
      const w = (L.right - L.left) / n;
      const rects = [];
      for (let i = 0; i < n; i++) rects.push({ x: L.left + i * w, y: L.trayTop + 10, w, h: L.trayH - 10 });
      return rects;
    }
    function trayScale(def, r) {
      const ow = def.box[2] - def.box[0], oh = def.box[3] - def.box[1];
      return Math.min(r.w * 0.78 / ow, (r.h - 34) * 0.92 / oh, cam.s * 1.05);
    }

    function firstGesture() {
      audio.unlock();
      startMusic();
      if (!started) { started = true; try { ctx.platform.start({ attempt }); } catch (e) {} }
    }

    function pickAt(x, y) {
      const [wx, wy] = S2W(x, y);
      const V = planck.Vec2;
      const tol = 16 / cam.s;
      const offs = [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol], [tol * 0.7, tol * 0.7], [-tol * 0.7, tol * 0.7], [tol * 0.7, -tol * 0.7], [-tol * 0.7, -tol * 0.7]];
      for (const [dx, dy] of offs) {
        for (let i = run.recs.length - 1; i >= 0; i--) {
          const r = run.recs[i];
          if (!r.body.isActive()) continue;
          for (let f = r.body.getFixtureList(); f; f = f.getNext()) if (f.testPoint(V(wx + dx, wy + dy))) return r;
        }
      }
      return null;
    }

    function startHold(def, rec, x, y, sx, sy, scale0, trayItem) {
      run.held = {
        def, rec, trayItem, x: sx, y: sy, ang: rec ? rec.body.getAngle() : 0, scale: scale0,
        off: [sx - x, sy - y], t: 0, sway: 0
      };
      audio.pick();
      haptic('light');
    }

    ctx.listen(canvas, 'pointerdown', e => {
      const [x, y] = local(e);
      firstGesture();
      if (run.state !== 'over' && Math.hypot(x - L.mute.x, y - L.mute.y) < L.mute.r + 10) { toggleMute(); return; }
      if (run.state === 'over') {
        const b = L.replayBtn;
        if (b && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h && run.result && run.t - run.overAt > 0.5) replay();
        return;
      }
      if (run.state !== 'playing' || run.held || pointerId != null) return;
      pointerId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      finger = { x, y, vx: 0, vy: 0, t: performance.now() };
      // from the tray?
      const rects = slotRects();
      for (let i = 0; i < run.tray.length; i++) {
        const r = rects[i];
        if (x > r.x && x < r.x + r.w && y > r.y - 14 && y < r.y + r.h) {
          const item = run.tray.splice(i, 1)[0];
          const sc = trayScale(item.def, r);
          const bx = r.x + r.w / 2, by = r.y + r.h - 36;
          startHold(item.def, null, x, y, bx, by, sc / cam.s, item);
          return;
        }
      }
      // an object already on the table?
      const rec = pickAt(x, y);
      if (rec) {
        const p = rec.body.getPosition();
        const [bx, by] = W2S(p.x, p.y);
        sim.lift(rec.body);
        startHold(rec.def, rec, x, y, bx, by, 1, null);
        return;
      }
      pointerId = null;
    });
    ctx.listen(canvas, 'pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const [x, y] = local(e);
      const now = performance.now(), dt = Math.max(1, now - finger.t);
      finger.vx = lerp(finger.vx, (x - finger.x) / dt * 1000, 0.5);
      finger.vy = lerp(finger.vy, (y - finger.y) / dt * 1000, 0.5);
      finger.x = x; finger.y = y; finger.t = now;
    });
    const endPointer = cancelled => e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!run.held) return;
      if (cancelled) cancelHeld(false); else release();
    };
    ctx.listen(canvas, 'pointerup', endPointer(false));
    ctx.listen(canvas, 'pointercancel', endPointer(true));
    ctx.listen(canvas, 'lostpointercapture', e => { if (e.pointerId === pointerId) endPointer(false)(e); });

    function toggleMute() {
      audio.setMuted(!audio.muted);
      save('muted', audio.muted);
      if (audio.muted) { try { ctx.music.stop({ fadeOutMs: 300 }); } catch (e) {} music = null; }
      else startMusic();
    }

    // Where the held object would be released, in world units.
    function heldWorld() {
      const h = run.held;
      const [wx, wy] = S2W(h.x, h.y);
      return [wx, wy];
    }
    function dropTarget() {
      const [wx, wy] = heldWorld();
      if (wy < sim.P.floorY + 0.3 || Math.abs(wx) > 4) return null;
      const surf = sim.surfaceY(wx);
      const y0 = Math.max(wy, surf + 0.03);
      const hit = sim.supportBelow(wx, y0, run.held.rec ? run.held.rec.body : null);
      if (!hit || hit.kind === 'floor') return { ok: false, x: wx, y: hit ? hit.y : sim.P.floorY };
      return { ok: true, x: wx, y: hit.y, from: y0 };
    }

    function release() {
      const h = run.held;
      const tgt = dropTarget();
      if (h.y > L.trayTop - 4 || !tgt || !tgt.ok) { cancelHeld(false); return; }
      const [wx, wy] = heldWorld();
      const y = Math.max(wy, sim.surfaceY(wx) + 0.005);
      const vx = clamp(finger.vx / cam.s * 0.15, -1.2, 1.2), vy = clamp(-finger.vy / cam.s * 0.15, -1.2, 1.2);
      if (h.rec) {
        sim.drop(h.rec.body, wx, y, vx, vy);
        h.rec.settleT = 0; h.rec.dropT = run.t;
        const p = h.rec.body.getPosition(); h.rec.px = p.x; h.rec.py = p.y; h.rec.pa = 0;
      } else {
        const body = sim.addObject(h.def, wx, y, vx, vy);
        makeRec(h.def, body, h.trayItem ? h.trayItem.counted : false);
      }
      run.held = null;
      if (run.tray.length === 0) run.emptyT = 0;
    }

    // Return what is held to the tray (or discard it after a failure).
    function cancelHeld(discard) {
      const h = run.held;
      run.held = null;
      if (h.rec) {
        const i = run.recs.indexOf(h.rec);
        if (i >= 0) run.recs.splice(i, 1);
        sim.remove(h.rec.body);
        if (!discard) run.tray.unshift({ def: h.def, counted: h.rec.counted, born: run.t });
      } else if (!discard && h.trayItem) {
        run.tray.unshift(h.trayItem);
      }
    }

    function replay() {
      newRun();
      started = true;
      try { ctx.platform.start({ attempt }); } catch (e) {}
      musicIntensity(0.25);
    }

    // ---- simulation step (fixed 60 Hz) ----
    let prevTable = 0, lastCreakAngle = 0;
    function fixedUpdate(stepMs) {
      if (!run) return;
      const dt = stepMs / 1000;
      run.t += dt;
      if (run.state === 'over') { stepWorld(); return; }
      stepWorld();
      processHits();
      if (run.state === 'collapse') {
        run.collapseT += dt;
        if (run.collapseT > 2.4) { finish(); run.overAt = run.t; }
        return;
      }
      rules(dt);
    }
    function stepWorld() {
      prevTable = sim.table.getAngle();
      for (const r of run.recs) { const p = r.body.getPosition(); r.px = p.x; r.py = p.y; r.pa = r.body.getAngle(); }
      sim.step();
    }

    function rules(dt) {
      const a = sim.angle(), aa = Math.abs(a);
      // objects: settling, scoring, falling
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        if (sim.touchesGround(r.body) || r.body.getPosition().y < sim.P.floorY + 0.15) {
          fail(`The ${r.def.name.toLowerCase()} fell off the table.`); return;
        }
        if (!r.counted) {
          const v = r.body.getLinearVelocity().length(), w = Math.abs(r.body.getAngularVelocity());
          if (v < 0.08 && w < 0.25 && sim.touchesTableOrStack(r.body)) r.settleT += dt; else r.settleT = 0;
          if (r.settleT > 0.45) { r.counted = true; onPlaced(r); }
        }
      }
      // the table's angle
      if (aa > SAFE) {
        run.overT += dt;
        if (run.overT > GRACE) { fail('The table tipped past its safe angle.'); return; }
      } else run.overT = Math.max(0, run.overT - dt * 2);

      const zone = aa < BAL ? 0 : aa < CRIT ? 1 : 2;
      if (zone === 2 && !run.inCrit) {
        run.inCrit = true; run.critAt = run.t;
        if (run.streak > 0) popup('streak lost', W / 2, L.hudBottom + 62, PAL.vermilion);
        run.streak = 0; run.mult = 1;
        haptic('warning'); sting('danger');
      }
      if (run.inCrit && zone === 0) {
        run.inCrit = false;
        if (run.t - run.critAt < 6) {
          run.recoveries++;
          addPoints(75); popup('recovered  +75', W / 2, L.hudBottom + 62, PAL.mustard); audio.chime(true); haptic('success');
        }
      }
      if (zone !== run.zone) { run.zone = zone; musicIntensity([0.25, 0.45, 0.75][zone]); }
      if (aa > CRIT * 0.92 && Math.abs(a - lastCreakAngle) > 0.03) { lastCreakAngle = a; audio.creak((aa - CRIT) / (SAFE - CRIT)); }

      // equilibrium bonus: a loaded table held nearly level
      const loaded = run.recs.filter(r => r.body.isActive() && r.counted).length;
      if (loaded >= 2 && aa < 1.5 * DEG && Math.abs(sim.angVel()) < 0.05) {
        run.eqT += dt;
        if (run.eqT > 4) {
          run.eqT = 0;
          const pts = 20 + 10 * Math.min(loaded, 8);
          addPoints(pts); popup('equilibrium  +' + pts, W / 2, L.hudBottom + 62, PAL.cream); audio.chime(true);
        }
      } else run.eqT = Math.max(0, run.eqT - dt * 2);

      // arrivals
      if (run.tray.length === 0 && !(run.held && !run.held.rec)) {
        run.emptyT += dt;
        if (run.emptyT > 0.6) { arrive(); run.emptyT = 0; }
      } else if (run.tray.length < TRAY_CAP) {
        run.arriveT += dt;
        if (run.arriveT > arrivalInterval()) arrive();
      }
    }

    // ---- rendering ----
    let lastFrame = performance.now();
    function render(alpha) {
      if (!run || !A) return;
      const now = performance.now();
      const fdt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      updateCamera(fdt);
      updateHeld(fdt);

      g.drawImage(A.backdrop, 0, 0, W, H);
      const s = cam.s;
      // floor and stand (world-anchored)
      drawSprite(g, A.floor, L.pivotX, L.pivotY, 0, s);
      const ta = lerp(prevTable, sim.table.getAngle(), alpha);
      // table shadow on the floor
      g.save(); g.fillStyle = rgba(PAL.ink, 0.3);
      const [fx, fy] = W2S(0, sim.P.floorY + 0.01);
      g.beginPath(); g.ellipse(fx, fy, 2.3 * s * Math.cos(ta), 0.07 * s, 0, 0, TAU); g.fill(); g.restore();
      drawSprite(g, A.stand, L.pivotX, L.pivotY, 0, s);
      drawSprite(g, A.ballast, L.pivotX, L.pivotY, ta, s);
      drawSprite(g, A.table, L.pivotX, L.pivotY, ta, s);
      // table flashes: a brief pale glint where something landed
      for (const f of flashes) {
        const k = 1 - f.t / 0.35;
        if (k <= 0) continue;
        g.save(); g.translate(L.pivotX, L.pivotY); g.rotate(-ta);
        g.fillStyle = rgba(PAL.cream, 0.35 * k * f.s);
        g.beginPath(); g.ellipse(f.x * s, -sim.P.topY * s - 2, (0.12 + 0.3 * (1 - k)) * s, 3, 0, 0, TAU); g.fill();
        g.restore();
      }
      // objects
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        const p = r.body.getPosition();
        const x = lerp(r.px, p.x, alpha), y = lerp(r.py, p.y, alpha), an = lerp(r.pa, r.body.getAngle(), alpha);
        const [sx, sy] = W2S(x, y);
        drawSprite(g, A.objs[r.def.id].spr, sx, sy, an, s);
      }
      drawPuffs(fdt);
      if (run.held) drawHeld();
      // paper grain over the painted scene
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.6; g.fillStyle = A.grainPat; g.fillRect(0, 0, W, H); g.restore();
      drawTray();
      if (run.state !== 'over') drawHUD();
      drawPopups(fdt);
      if (run.state === 'over') drawResult();
      if (run.state === 'collapse') drawCause();
      for (const f of flashes) f.t += fdt;
      while (flashes.length && flashes[0].t > 0.4) flashes.shift();
    }

    function updateCamera(dt) {
      let top = 0;
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        const p = r.body.getPosition();
        top = Math.max(top, p.y + (r.def.box[3] - r.def.box[1]));
      }
      const avail = L.pivotY - L.viewTop - 34;
      const target = clamp(Math.min(L.s0, avail / Math.max(0.5, top + 0.6)), L.s0 * 0.55, L.s0);
      cam.s += (target - cam.s) * Math.min(1, dt * 1.6);
    }

    function updateHeld(dt) {
      const h = run.held;
      if (!h) return;
      h.t += dt;
      const lift = 30 + (h.def.box[3] - h.def.box[1]) * cam.s * 0.08;
      const k = Math.min(1, h.t / 0.22);
      const ox = lerp(h.off[0], 0, k), oy = lerp(h.off[1], -lift, k);
      const tx = finger.x + ox, ty = finger.y + oy;
      const f = Math.min(1, dt * 22);
      h.x += (tx - h.x) * f; h.y += (ty - h.y) * f;
      h.scale += (1 - h.scale) * Math.min(1, dt * 12);
      h.ang += (0 - h.ang) * Math.min(1, dt * 12);
      h.sway += (clamp(-finger.vx * 0.00008, -0.07, 0.07) - h.sway) * Math.min(1, dt * 10);
    }

    function drawHeld() {
      const h = run.held, s = cam.s * h.scale;
      const set = A.objs[h.def.id];
      // drop guide: a dotted plumb line and a painted landing mark
      const tgt = h.y < L.trayTop - 4 ? dropTarget() : null;
      if (tgt) {
        const [gx, gy] = W2S(tgt.x, tgt.y);
        const col = tgt.ok ? PAL.cream : PAL.vermilion;
        g.save();
        g.strokeStyle = rgba(col, 0.55); g.lineWidth = 1.5; g.setLineDash([2, 5]);
        g.beginPath(); g.moveTo(h.x, h.y + 4); g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
        g.fillStyle = rgba(tgt.ok ? PAL.ink : PAL.vermilion, tgt.ok ? 0.3 : 0.4);
        const hw = (h.def.box[2] - h.def.box[0]) * 0.45 * cam.s;
        g.beginPath(); g.ellipse(gx, gy - 1, hw, 4, 0, 0, TAU); g.fill();
        g.restore();
      }
      // lift shadow, cream halo, then the object
      drawSprite(g, set.shadow, h.x + 6, h.y + 10, h.ang + h.sway, s, 0.22);
      const halo = 0.55 + 0.15 * Math.sin(run.t * 6);
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) drawSprite(g, set.halo, h.x + dx, h.y + dy, h.ang + h.sway, s, halo * 0.5);
      drawSprite(g, set.spr, h.x, h.y, h.ang + h.sway, s * 1.03);
    }

    function drawPuffs(dt) {
      for (const p of puffs) {
        p.t += dt;
        const k = p.t / 0.5;
        if (k >= 1) continue;
        const rnd = mulberry(p.seed);
        const [x, y] = W2S(p.x, p.y);
        for (let i = 0; i < 5; i++) {
          const a = Math.PI + rnd() * Math.PI, d = (6 + rnd() * 14) * (0.3 + k) * p.s;
          g.fillStyle = rgba(p.c, (1 - k) * 0.55);
          g.beginPath(); g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5 - k * 4, 1.5 + rnd() * 2.5, 1 + rnd() * 1.5, rnd() * 3, 0, TAU); g.fill();
        }
      }
      while (puffs.length && puffs[0].t > 0.5) puffs.shift();
    }

    function drawTray() {
      g.drawImage(A.tray, 0, L.trayTop - 8, W, H - L.trayTop + 24);
      const rects = slotRects();
      for (let i = 0; i < rects.length && run.state !== 'over'; i++) {
        const r = rects[i];
        const item = run.tray[i];
        const cx = r.x + r.w / 2;
        if (!item) {
          g.save(); g.strokeStyle = rgba(PAL.cream, 0.12); g.setLineDash([3, 6]); g.lineWidth = 1.2;
          g.beginPath(); g.ellipse(cx, r.y + r.h - 36, r.w * 0.28, 6, 0, 0, TAU); g.stroke(); g.restore();
          continue;
        }
        const age = run.t - item.born;
        const slide = age < 0.4 ? Math.pow(1 - age / 0.4, 3) : 0;
        const sc = trayScale(item.def, r);
        const by = r.y + r.h - 36;
        drawSprite(g, A.objs[item.def.id].spr, cx + slide * W * 0.6, by - Math.sin(age * 2.2 + i) * 1.2, 0, sc);
        drawWeight(cx + slide * W * 0.6, by + 18, item.def.weight);
      }
      // first-time guidance
      if (run.state === 'playing' && run.placed === 0 && !run.held && run.recs.length === 0) {
        g.save();
        g.font = F(17, true); g.textAlign = 'center'; g.fillStyle = PAL.cream;
        g.shadowColor = 'rgba(30,5,10,0.8)'; g.shadowBlur = 6;
        g.fillText('Drag an object. Keep the table balanced.', W / 2, L.trayTop - 18);
        g.restore();
        if (!seenHint && run.tray.length) {
          // a ghost finger travelling from the first slot to the table
          const r = rects[0];
          const cyc = (run.t % 2.6) / 2.6;
          const k = clamp((cyc - 0.15) / 0.6, 0, 1), e = k * k * (3 - 2 * k);
          const [tx, ty] = W2S(-0.9, sim.P.topY + 0.3);
          const x = lerp(r.x + r.w / 2, tx, e), y = lerp(r.y + r.h - 50, ty, e);
          const alpha = cyc < 0.1 ? cyc * 10 : cyc > 0.85 ? (1 - cyc) / 0.15 : 1;
          g.save(); g.globalAlpha = alpha * 0.8;
          g.fillStyle = rgba(PAL.cream, 0.85); g.beginPath(); g.ellipse(x, y, 11, 11, 0, 0, TAU); g.fill();
          g.strokeStyle = rgba(PAL.ink, 0.6); g.lineWidth = 1.5; g.stroke();
          g.restore();
        }
      }
    }

    // Weight cue: one, two or three small brass weights and a word.
    function drawWeight(x, y, w) {
      const n = w === 'heavy' ? 3 : w === 'medium' ? 2 : 1;
      const total = n * 11 + (n - 1) * 3;
      g.save();
      for (let i = 0; i < n; i++) {
        const wx = x - total / 2 + i * 14 + 5.5;
        g.fillStyle = PAL.brass; g.strokeStyle = PAL.brassDark; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(wx - 5.5, y + 4); g.lineTo(wx + 5.5, y + 4); g.lineTo(wx + 3.5, y - 4); g.lineTo(wx - 3.5, y - 4); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(wx, y - 6, 2, 2, 0, 0, TAU); g.stroke();
        g.fillStyle = rgba(PAL.brassLight, 0.8); g.fillRect(wx - 3, y - 2.5, 1.4, 5);
      }
      g.font = F(12, true); g.textAlign = 'center'; g.fillStyle = rgba(PAL.cream, 0.85);
      g.fillText(w, x, y + 18);
      g.restore();
    }

    function drawHUD() {
      g.save();
      g.textBaseline = 'alphabetic';
      const shadow = () => { g.shadowColor = 'rgba(25,4,9,0.7)'; g.shadowBlur = 5; };
      shadow();
      // placed count and score
      g.textAlign = 'left'; g.fillStyle = PAL.cream;
      g.font = F(40); g.fillText(String(run.placed), L.left, L.top + 34);
      const nw = g.measureText(String(run.placed)).width;
      g.font = F(15, true); g.fillStyle = rgba(PAL.cream, 0.8);
      g.fillText(run.placed === 1 ? 'object' : 'objects', L.left + nw + 6, L.top + 33);
      g.font = F(16); g.fillStyle = PAL.mustard;
      g.fillText(run.points.toLocaleString(), L.left, L.top + 58);
      if (run.mult > 1) {
        const sw = g.measureText(run.points.toLocaleString()).width;
        g.font = F(14, true); g.fillStyle = PAL.vermilion;
        g.fillText('×' + run.mult, L.left + sw + 8, L.top + 58);
      }
      // best and mute on the right
      g.textAlign = 'right'; g.font = F(13, true); g.fillStyle = rgba(PAL.cream, 0.7);
      g.fillText('best', L.right, L.top + 14);
      g.font = F(17); g.fillStyle = PAL.cream;
      g.fillText(Math.max(best.score || 0, run.points).toLocaleString(), L.right, L.top + 34);
      g.shadowBlur = 0;
      drawMute();
      drawGauge();
      g.restore();
    }

    function drawMute() {
      const m = L.mute;
      g.save();
      g.translate(m.x, m.y);
      g.fillStyle = rgba(PAL.burgundyDeep, 0.55); g.strokeStyle = rgba(PAL.cream, 0.45); g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 0, m.r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = PAL.cream;
      g.beginPath(); g.moveTo(-7, -3); g.lineTo(-3, -3); g.lineTo(2, -7); g.lineTo(2, 7); g.lineTo(-3, 3); g.lineTo(-7, 3); g.closePath(); g.fill();
      g.strokeStyle = PAL.cream; g.lineWidth = 1.5;
      if (audio.muted) { g.beginPath(); g.moveTo(5, -4); g.lineTo(10, 4); g.moveTo(10, -4); g.lineTo(5, 4); g.stroke(); }
      else { g.beginPath(); g.arc(3, 0, 5, -0.8, 0.8); g.stroke(); g.beginPath(); g.arc(3, 0, 8.5, -0.8, 0.8); g.stroke(); }
      g.restore();
    }

    // The balance gauge: an ornamental half dial. The needle shows the
    // table's actual angle; the coloured bands are the balanced, unstable and
    // critical ranges; a ring fills while the table is past its safe angle.
    function drawGauge() {
      const G = L.gauge, r = G.r;
      const span = 72 * DEG; // dial half-range drawn for the safe angle
      const toDial = ang => clamp(-ang / SAFE, -1.25, 1.25) * span; // right side down => needle right
      g.save();
      g.translate(G.x, G.y);
      // plate
      g.fillStyle = rgba(PAL.burgundyDeep, 0.65);
      g.beginPath(); g.arc(0, 0, r + 8, Math.PI, 0); g.lineTo(r + 8, 6); g.lineTo(-r - 8, 6); g.closePath(); g.fill();
      g.strokeStyle = rgba(PAL.brass, 0.9); g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 8, Math.PI, 0); g.stroke();
      // bands
      const band = (a0, a1, col) => { g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, r - 2, -Math.PI / 2 + a0, -Math.PI / 2 + a1); g.stroke(); };
      const b = BAL / SAFE * span, c = CRIT / SAFE * span;
      band(-b, b, PAL.olive);
      band(b, c, PAL.ochre); band(-c, -b, PAL.ochre);
      band(c, span * 1.25, PAL.vermilion); band(-span * 1.25, -c, PAL.vermilion);
      // ticks
      g.strokeStyle = rgba(PAL.cream, 0.6); g.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        const a = -Math.PI / 2 + i / 4 * span;
        g.beginPath(); g.moveTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3)); g.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7)); g.stroke();
      }
      // safe-angle marks
      g.strokeStyle = PAL.cream; g.lineWidth = 2;
      for (const sgn of [-1, 1]) { const a = -Math.PI / 2 + sgn * span; g.beginPath(); g.moveTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8)); g.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8)); g.stroke(); }
      // grace ring
      if (run.overT > 0) {
        g.strokeStyle = PAL.vermilion; g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, r + 12, Math.PI, Math.PI + Math.PI * clamp(run.overT / GRACE, 0, 1)); g.stroke();
      }
      // needle
      const ang = sim.angle();
      const zone = Math.abs(ang) < BAL ? 0 : Math.abs(ang) < CRIT ? 1 : 2;
      const na = -Math.PI / 2 + toDial(ang);
      g.strokeStyle = PAL.ink; g.lineWidth = 4.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(na) * (r - 4), Math.sin(na) * (r - 4)); g.stroke();
      g.strokeStyle = zone === 2 ? PAL.vermilion : zone === 1 ? PAL.mustard : PAL.cream; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(na) * (r - 4), Math.sin(na) * (r - 4)); g.stroke();
      g.fillStyle = PAL.brass; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
      g.strokeStyle = PAL.brassDark; g.lineWidth = 1.2; g.stroke();
      g.font = F(12, true); g.textAlign = 'center'; g.fillStyle = rgba(PAL.cream, 0.8);
      g.fillText(['balanced', 'unstable', 'critical'][zone], 0, 22);
      g.restore();
    }

    function drawPopups(dt) {
      for (const p of popups) {
        p.t += dt;
        const k = p.t / 1.6;
        if (k >= 1) continue;
        g.save();
        g.globalAlpha = k < 0.1 ? k * 10 : 1 - Math.max(0, (k - 0.6) / 0.4);
        g.font = F(18, true); g.textAlign = 'center'; g.fillStyle = p.color;
        g.shadowColor = 'rgba(25,4,9,0.85)'; g.shadowBlur = 6;
        g.fillText(p.text, p.x, p.y - k * 26);
        g.restore();
      }
      while (popups.length && popups[0].t > 1.6) popups.shift();
    }

    function drawCause() {
      const k = clamp(run.collapseT / 0.5, 0, 1);
      g.save(); g.globalAlpha = k;
      g.font = F(19, true); g.textAlign = 'center'; g.fillStyle = PAL.cream;
      g.shadowColor = 'rgba(25,4,9,0.9)'; g.shadowBlur = 8;
      g.fillText(run.cause, W / 2, L.hudBottom + 34);
      g.restore();
    }

    // Result: a painted card in the headroom above the table (the collapsed
    // still life stays in view below it) and Play again in the tray zone.
    function drawResult() {
      const res = run.result;
      const k = clamp((run.t - run.overAt) / 0.45, 0, 1), e = 1 - Math.pow(1 - k, 3);
      const cw = Math.min(L.right - L.left, 360), ch = 214;
      const cx = W / 2 - cw / 2, cy = L.top + (1 - e) * -30;
      g.save();
      g.globalAlpha = e;
      if (!A.card || A.card.w !== cw || A.card.h !== ch) A.card = paintCard(cw, ch);
      g.drawImage(A.card.c, cx - 6, cy - 6, cw + 12, ch + 12);
      g.textAlign = 'center';
      g.fillStyle = PAL.burgundy; g.font = F(15, true);
      g.fillText(run.cause, W / 2, cy + 30, cw - 24);
      g.font = F(46); g.fillStyle = PAL.ink;
      g.fillText(res.score.toLocaleString(), W / 2, cy + 78);
      if (run.newBest && res.score > 0) { g.font = F(14, true); g.fillStyle = PAL.vermilion; g.fillText('a new best', W / 2, cy + 98); }
      const stats = [['placed', res.placed], ['best streak', res.streak], ['best', best.score.toLocaleString()]];
      for (let i = 0; i < 3; i++) {
        const sx = cx + cw * (i + 0.5) / 3;
        g.font = F(22); g.fillStyle = PAL.ink; g.fillText(String(stats[i][1]), sx, cy + 132);
        g.font = F(12, true); g.fillStyle = PAL.wine; g.fillText(stats[i][0], sx, cy + 148);
      }
      // compact leaderboard: top three and the viewer's rank when known
      g.font = F(13, true); g.fillStyle = PAL.umber;
      const bd = res.board;
      let line = '';
      if (bd.status === 'saving') line = 'saving to the leaderboard…';
      else if (bd.status === 'unavailable') line = 'leaderboard unavailable right now';
      else line = bd.rows.map(r => `${r.rank}. ${shortName(r)} ${Number(r.value).toLocaleString()}`).join('   ') || 'no scores yet';
      g.fillText(line, W / 2, cy + 176, cw - 24);
      if (bd.status === 'ok' && bd.rank) { g.fillStyle = PAL.burgundy; g.fillText('you are #' + bd.rank, W / 2, cy + 196); }
      // replay, in the tray zone
      const bw = Math.min(230, W - 80), bh = 52;
      const b = { x: W / 2 - bw / 2, y: L.trayTop + (L.bottom - L.trayTop - bh) / 2 + 4, w: bw, h: bh };
      L.replayBtn = b;
      g.fillStyle = 'rgba(30,6,12,0.35)'; roundRect(b.x + 3, b.y + 5, b.w, b.h, 26); g.fill();
      g.fillStyle = PAL.vermilion; roundRect(b.x, b.y, b.w, b.h, 26); g.fill();
      g.strokeStyle = rgba(PAL.ink, 0.6); g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = rgba(PAL.cream, 0.35); g.lineWidth = 2; roundRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10, 21); g.stroke();
      g.fillStyle = PAL.cream; g.font = F(20);
      g.fillText('Play again', W / 2, b.y + 33);
      g.restore();
      if (!run.pulsed && k >= 1 && run.t - run.overAt > 0.8) {
        run.pulsed = true;
        if (res.placed >= 3) try { ctx.pulse.complete({ score: res.score, text: `Balanced ${res.placed} curiosities on The Unstable Table`, mode: 'endless' }); } catch (e) {}
      }
    }
    function shortName(r) {
      const n = r.displayName || r.username || r.name || r.displayLabel || '';
      return n.length > 10 ? n.slice(0, 9) + '…' : n;
    }
    function roundRect(x, y, w, h, rr) {
      g.beginPath(); g.moveTo(x + rr, y); g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr); g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath();
    }
    function paintCard(w, h) {
      const dpr = dprOf();
      const c = makeBuffer((w + 12) * dpr, (h + 12) * dpr);
      const cg = c.getContext('2d');
      cg.scale(dpr, dpr); cg.translate(6, 6);
      const rnd = mulberry(5150);
      const B = makeBrush(cg, rnd, 1);
      const p = handPoly([[0, 0], [w, 0], [w, h], [0, h]], 2.5, rnd);
      B.gouache(p, { base: PAL.cream, box: [0, 0, w, h], washes: [PAL.creamDeep, '#f7ecd2'], strokeAngle: 0, strokes: 40, strokeLen: w * 0.4, shadow: 0.15, lit: 0.1, bottomShade: false, edgeColor: PAL.umber });
      B.stroke([[14, 10], [w - 14, 11]], PAL.vermilion, 2, 0.6, 1);
      B.stroke([[14, h - 9], [w - 14, h - 10]], PAL.vermilion, 2, 0.6, 1);
      return { c, w, h };
    }

    // ---- start ----
    layout();
    const t0 = performance.now();
    buildAssets();
    if (DEV) console.log('assets painted in', Math.round(performance.now() - t0), 'ms');
    newRun();
    ctx.onResize(() => { layout(); buildAssets(); }, { immediate: false, debounceMs: 120 });
    fontLoads.then(() => {});

    const loop = ctx.game.loop({ fixedHz: 60, maxSubsteps: 4, fixedUpdate, render });
    render(1);
    ctx.markVisualReady('table-painted');
    ctx.platform.ready();

    if (DEV) {
      window.__UT = {
        get sim() { return sim; }, get run() { return run; }, get A() { return A; }, OBJECT_BY_ID, OBJECTS, L, cam, W2S, S2W, loop,
        place(id, x, yAbove = 0.01) { const def = OBJECT_BY_ID[id]; const b = sim.addObject(def, x, sim.surfaceY(x) + yAbove); return makeRec(def, b, false); },
        angleDeg: () => sim.angle() / DEG,
        restart: () => newRun(),
        step(n) { for (let i = 0; i < n; i++) fixedUpdate(1000 / 60); }
      };
    }
  }
};

})();
