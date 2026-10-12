// ---- Anatomy: the creature as one signed-distance + relief field ------------
// A body is a set of primitives (spine capsules, fur lobes, spires, ear,
// mushrooms). Two fields come out of the same primitives:
//   sd(x, y) - signed distance to the silhouette (inside < 0). Collision is
//              the sd = 0 isoline, so terrain and painting cannot disagree.
//   h(x, y)  - relief height facing the camera, used only for lighting.
// World units are metres, x right, y up.

const MAT_FUR = 0, MAT_SPIRE = 1, MAT_SKIN = 2, MAT_EAR = 3, MAT_SHROOM = 4;
const SEG = 0, ELL = 1;

function sdUnevenCapsule(px, py, ax, ay, ra, bx, by, rb) {
  px -= ax;
  py -= ay;
  const vx = bx - ax, vy = by - ay;
  const h = vx * vx + vy * vy;
  const qx = Math.abs((px * vy - py * vx) / h);
  const qy = (px * vx + py * vy) / h;
  const b = (ra - rb) / Math.sqrt(h);
  const cx = Math.sqrt(Math.max(1 - b * b, 1e-6)), cy = b;
  const k = cx * qy - cy * qx;
  const m = cx * qx + cy * qy;
  const n = qx * qx + qy * qy;
  const len = Math.sqrt(h);
  if (k < 0) return len * Math.sqrt(n) - ra;
  if (k > cx) return len * Math.sqrt(n + 1 - 2 * qy) - rb;
  return len * m - ra;
}

class Anatomy {
  constructor(name) {
    this.name = name;
    this.prims = [];
  }

  seg(ax, ay, ra, bx, by, rb, o) {
    return this.add({
      kind: SEG, ax, ay, ra, bx, by, rb,
      minX: Math.min(ax - ra, bx - rb), maxX: Math.max(ax + ra, bx + rb),
      minY: Math.min(ay - ra, by - rb), maxY: Math.max(ay + ra, by + rb)
    }, o);
  }

  ell(cx, cy, a, b, rot, o) {
    const r = Math.max(a, b);
    return this.add({
      kind: ELL, cx, cy, a, b, cos: Math.cos(rot), sin: Math.sin(rot),
      minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r
    }, o);
  }

  add(p, o) {
    p.mat = o.mat ?? MAT_FUR;
    p.k = o.k ?? 2; // silhouette blend radius
    p.hk = o.hk ?? p.k; // relief blend radius
    p.hs = o.hs ?? 0.55; // relief height scale
    p.hz = o.hz ?? 0; // ellipse dome height
    p.base = o.base ?? 0; // relief offset (stacks a form in front of another)
    p.tag = o.tag || null;
    // Outside its silhouette a form's relief drops away; forms stacked in front
    // (large base) drop instantly so they never shade their surroundings.
    p.fall = p.base > 3 ? 1e3 : 3;
    p.id = this.prims.length;
    this.prims.push(p);
    return p;
  }

  cull(x0, y0, x1, y1) {
    const out = [];
    for (const p of this.prims) {
      const m = p.k * 2;
      if (p.maxX + m >= x0 && p.minX - m <= x1 && p.maxY + m >= y0 && p.minY - m <= y1) out.push(p);
    }
    return out;
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.prims) {
      x0 = Math.min(x0, p.minX); x1 = Math.max(x1, p.maxX);
      y0 = Math.min(y0, p.minY); y1 = Math.max(y1, p.maxY);
    }
    return { x0, y0, x1, y1 };
  }

  // Evaluates both fields at (x, y). `out` receives sd, h, mat and prim (the
  // primitive whose surface is frontmost there).
  eval(x, y, prims, out) {
    let sd = 1e9, h = -1e9, bestH = -1e9, bestSd = 1e9, front = null, nearest = null;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      let d, hv;
      if (p.kind === SEG) {
        d = sdUnevenCapsule(x, y, p.ax, p.ay, p.ra, p.bx, p.by, p.rb);
        const vx = p.bx - p.ax, vy = p.by - p.ay;
        const t = clamp(((x - p.ax) * vx + (y - p.ay) * vy) / (vx * vx + vy * vy), 0, 1);
        const dx = x - (p.ax + vx * t), dy = y - (p.ay + vy * t);
        const r = p.ra + (p.rb - p.ra) * t;
        const q = r * r - dx * dx - dy * dy;
        hv = q > 0 ? Math.sqrt(q) * p.hs + p.base : p.base - d * p.fall;
      } else {
        const lx = (x - p.cx) * p.cos + (y - p.cy) * p.sin;
        const ly = -(x - p.cx) * p.sin + (y - p.cy) * p.cos;
        const q = Math.sqrt((lx / p.a) * (lx / p.a) + (ly / p.b) * (ly / p.b));
        d = (q - 1) * Math.min(p.a, p.b);
        hv = q < 1 ? p.hz * Math.sqrt(1 - q * q) + p.base : p.base - d * p.fall;
      }
      sd = p.k > 0.01 ? smin(sd, d, p.k) : Math.min(sd, d);
      h = smax(h, hv, p.hk);
      if (d < 0.05 && hv > bestH) { bestH = hv; front = p; }
      if (d < bestSd) { bestSd = d; nearest = p; }
    }
    out.sd = sd;
    out.h = h;
    out.prim = front || nearest;
    out.mat = out.prim ? out.prim.mat : MAT_FUR;
    return out;
  }

  sdAt(x, y) {
    const o = {};
    return this.eval(x, y, this.cull(x - 1, y - 1, x + 1, y + 1), o).sd;
  }

  // Walks down from (x, yFrom) and returns the first surface height, or null.
  surfaceBelow(x, yFrom, yTo) {
    const prims = this.cull(x - 1, yTo - 1, x + 1, yFrom + 1);
    const o = {};
    let prev = yFrom;
    if (this.eval(x, yFrom, prims, o).sd < 0) return null;
    for (let y = yFrom - 0.2; y >= yTo; y -= 0.2) {
      if (this.eval(x, y, prims, o).sd < 0) {
        let lo = y, hi = prev;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (this.eval(x, mid, prims, o).sd < 0) lo = mid; else hi = mid;
        }
        return hi;
      }
      prev = y;
    }
    return null;
  }
}

// A primitive's own relief (no blending, no base): used to light forms
// stacked in front of the body from their own shape.
function primRelief(p, x, y) {
  if (p.kind === SEG) {
    const vx = p.bx - p.ax, vy = p.by - p.ay;
    const t = clamp(((x - p.ax) * vx + (y - p.ay) * vy) / (vx * vx + vy * vy), 0, 1);
    const dx = x - (p.ax + vx * t), dy = y - (p.ay + vy * t);
    const r = p.ra + (p.rb - p.ra) * t;
    return Math.sqrt(Math.max(r * r - dx * dx - dy * dy, 0)) * p.hs;
  }
  const lx = (x - p.cx) * p.cos + (y - p.cy) * p.sin;
  const ly = -(x - p.cx) * p.sin + (y - p.cy) * p.cos;
  const q = (lx / p.a) * (lx / p.a) + (ly / p.b) * (ly / p.b);
  return p.hz * Math.sqrt(Math.max(1 - q, 0));
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Smooth spine through control points [x, y, radius].
function sampleSpine(ctrl, perSpan) {
  const out = [];
  const P = (i) => ctrl[clamp(i, 0, ctrl.length - 1)];
  for (let i = 0; i < ctrl.length - 1; i++) {
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan;
      const v = [0, 1, 2].map((k) => catmullRom(P(i - 1)[k], P(i)[k], P(i + 1)[k], P(i + 2)[k], t));
      out.push(v);
    }
  }
  out.push(ctrl[ctrl.length - 1].slice());
  return out;
}

// Interpolated spine sample at height y (spine must rise monotonically there).
function spineAtY(samples, y) {
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) {
      const t = (y - a[1]) / (b[1] - a[1] || 1);
      return [lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)];
    }
  }
  return y < samples[0][1] ? samples[0] : samples[samples.length - 1];
}

function addSpine(anat, samples, o) {
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    anat.seg(a[0], a[1], a[2], b[0], b[1], b[2], o);
  }
}

// Relief height of what is already in `anat` at (x, y); used to stack new
// forms on top of the body so they read as growing out of it.
function reliefAt(anat, x, y) {
  return anat.eval(x, y, anat.cull(x - 1, y - 1, x + 1, y + 1), {}).h;
}
