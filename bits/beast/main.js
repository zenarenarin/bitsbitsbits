// Generated from the modules in src - edit those, not this file.
(() => {
"use strict";

// ==== module 00-core ====
// ---- Core: seeded randomness, noise, math and colour helpers ----------------
// Everything procedural is seeded from world coordinates so neighbouring tiles
// repaint identical strokes and the world never shows repeated stamps.

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed) / 4294967296;
  const b = hash2(xi + 1, yi, seed) / 4294967296;
  const c = hash2(xi, yi + 1, seed) / 4294967296;
  const d = hash2(xi + 1, yi + 1, seed) / 4294967296;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < (octaves || 4); i++) {
    sum += vnoise(x, y, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c, alpha) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha === undefined ? 1 : alpha})`;
}
// Brighten (dv > 0) toward warm cream or darken (dv < 0) toward cool violet,
// the way the reference shifts hue with value instead of adding black/white.
function shade(c, dv) {
  if (dv >= 0) return mixRGB(c, [255, 244, 228], clamp(dv, 0, 1));
  return mixRGB(c, [74, 62, 104], clamp(-dv, 0, 1));
}
function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  return mixRGB(stops[i], stops[i + 1], t - i);
}

// ==== module 10-palette ====
// ---- Palette: sampled by eye from the approved reference -----------------------
// Dusty lavender shadows, warm peach light, cream fur, sage moss, rose spires,
// and a rust-orange explorer that stays readable against all of it.

const PAL = {
  skyZenith: hex("#5a6aa6"),
  skyHigh: hex("#8e95c6"),
  skyMid: hex("#d6a6b6"),
  skyLow: hex("#f2b48f"),
  horizon: hex("#ffd59a"),
  sunCore: hex("#fff3d2"),
  cloudLit: hex("#ffdcb4"),
  cloudMid: hex("#e7b2b0"),
  cloudShade: hex("#9a88bb"),
  cloudDeep: hex("#76699f"),
  mistWarm: hex("#f3cdb6"),
  mistCool: hex("#b8a9d2"),

  fur: [hex("#574a7a"), hex("#8f7cae"), hex("#d6a2a6"), hex("#f4cdbd"), hex("#fff2e6")],
  furRim: hex("#ffd0a2"),
  furBounce: hex("#a59ad0"),

  spire: [hex("#7d6696"), hex("#c48a98"), hex("#e8ab9e"), hex("#fcd8c0")],
  skin: [hex("#7e6893"), hex("#c48f9f"), hex("#ebb7a8"), hex("#fde0cc")],
  earInner: hex("#cf7f8a"),
  lash: hex("#3d3048"),

  moss: [hex("#2f3d33"), hex("#4b6040"), hex("#76884a"), hex("#adb35a"), hex("#e2d27c")],
  shroomCap: [hex("#7e4466"), hex("#c45f72"), hex("#e5867f"), hex("#fbb7a0")],
  shroomGill: [hex("#9a87a6"), hex("#dcbcb0"), hex("#f2dccb")],
  shroomStem: [hex("#9b8aa8"), hex("#e2cdbf"), hex("#f7ebdc")],

  explorer: {
    tunic: hex("#c5623b"),
    tunicLit: hex("#ea8a55"),
    tunicShade: hex("#8a4440"),
    trousers: hex("#363047"),
    trousersLit: hex("#5a4f69"),
    boots: hex("#2a2331"),
    skin: hex("#b97a5c"),
    skinLit: hex("#dc9f78"),
    hair: hex("#231c29"),
    hairLit: hex("#4a3a4c")
  }
};

// ==== module 20-anatomy ====
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

// ==== module 25-world ====
// ---- World: one sleeping creature laid across depth layers ------------------
// The creature lies diagonally up a slope, facing left, as in the reference
// title panel: tail low on the right, back rising up-left, shoulder, neck,
// and the head at the top with its muzzle to the left. The low sun sits on
// the right, so the climbing surface (the back) faces the light.
//
// play  (depth 1.0)  - the body the explorer climbs. Its upper-right face is
//                      the route: fur shelves on the back make the treads.
// ridge (depth 0.9)  - dorsal spires standing just behind the route.
// far   (depth 0.22) - distant dorsal spires rising out of cloud.
// tail  (depth 0.2)  - the tail curling up out of the cloud sea.
// fore  (depth 1.5)  - near fur clumps that frame the bottom of the screen.
// Props (mushrooms, trees, the closed eye) are rooted on anatomy surfaces.

const EXPLORER_HEIGHT = 1.5;
const SUN_SIDE = 1; // +1: sun on the right

// Point on the dorsal (sun-facing, upper-right) surface of a spine sample.
function dorsalAt(samples, i) {
  const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
  let tx = b[0] - a[0], ty = b[1] - a[1];
  const l = Math.hypot(tx, ty) || 1;
  tx /= l; ty /= l;
  const nx = ty, ny = -tx; // right-hand normal: up-right for a spine rising up-left
  const s = samples[i];
  return { x: s[0] + nx * s[2], y: s[1] + ny * s[2], nx, ny, tx, ty, r: s[2], cx: s[0], cy: s[1] };
}

function buildWorld(seed) {
  const rnd = rngFrom(seed);
  const R = (a, b) => a + (b - a) * rnd();

  // -- Play layer: the climbable body ---------------------------------------
  const play = new Anatomy("play");
  const spine = sampleSpine([
    // A broad back rising at ~42 degrees (rolling ridges you can walk), then
    // a steeper shoulder and neck up to the head.
    [110, -80, 46], [47, -14, 42], [0, 34, 38], [-48, 78, 34], [-90, 116, 31],
    [-132, 154, 29], [-170, 192, 25], [-196, 224, 19], [-208, 250, 14], [-210, 270, 12.5]
  ], 8);
  addSpine(play, spine, { k: 8, hk: 6, hs: 0.5 });

  // Head, facing left: furred cranium, muzzle, cheek ruff, two ears.
  const NX = -153; // the neck/head group sits at the top of the back
  const HX = -58 + NX; // head sits over the neck, muzzle forward (left)
  // Forelimb stretched up-slope with the chin resting on it: upper arm along
  // the neck, forearm under the jaw, a broad paw with toe lobes.
  play.seg(-46 + NX, 206, 11, -42 + NX, 240, 8.5, { k: 5, hk: 4, hs: 0.5, base: 1 });
  play.seg(-42 + NX, 240, 8.5, -58 + NX, 260, 6.8, { k: 4, hk: 3, hs: 0.5, base: 2 });
  play.seg(-58 + NX, 260, 6.8, -72 + NX, 261, 6, { k: 3, hk: 3, hs: 0.5, base: 2.5 });
  play.ell(-79 + NX, 259.5, 6.5, 4.6, 0.05, { k: 2.5, hk: 2, hz: 3, base: 3 });
  for (const [tx, ty, ta] of [[-84.5, 257.5, 2.2], [-83, 262, 2.1], [-79.5, 264.2, 2]]) {
    play.ell(tx + NX, ty, ta, ta * 0.72, 0.3, { k: 1, hk: 1, hz: 1.4, base: 5, tag: "lobe" });
  }
  play.ell(HX, 284, 14, 10.5, 0.12, { k: 6, hk: 4, hz: 9, base: 2, tag: "cranium" });
  play.ell(HX - 12.5, 279.5, 7, 4.8, 0.22, { k: 4.5, hk: 4, hz: 2.6, base: 4, tag: "muzzle" });
  play.ell(HX + 12, 274, 7, 8.5, -0.3, { k: 4, hk: 3, hz: 5, base: 4 });
  play.seg(HX - 3, 292, 3.4, HX - 5, 302, 2.0, { mat: MAT_EAR, k: 2, hk: 1.5, hs: 0.4, base: 1, tag: "ear-far" });
  play.seg(HX + 7, 290, 6.6, HX + 12.5, 309, 3.4, { mat: MAT_EAR, k: 2.4, hk: 1.5, hs: 0.6, base: 9, tag: "ear" });

  // Fur shelves on the back: drooping lobes whose flat-ish tops are the
  // treads of the climb, spaced by distance along the back so the route is a
  // staircase of rounded fur ledges. They belong to the body field, so every
  // shelf is painted fur and walkable ground at once.
  const dorsal = [];
  for (let i = 1; i < spine.length - 1; i++) dorsal.push(dorsalAt(spine, i));
  const shelves = [];
  let dist = 0, next = 2;
  for (let i = 1; i < dorsal.length; i++) {
    const p0 = dorsal[i - 1], p1 = dorsal[i];
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    while (next <= dist + segLen) {
      const t = (next - dist) / segLen;
      const x = lerp(p0.x, p1.x, t), y = lerp(p0.y, p1.y, t);
      if (y > 262) break;
      // Fur steps: rounded lobes set into the slope so each one makes a
      // tread and a riser of about a metre or two - never an overhang over
      // the step below, so every step can be reached with a jump.
      const roll = rnd();
      const big = roll < 0.2, tiny = roll > 0.82;
      const a = big ? R(4.2, 5.6) : tiny ? R(1.8, 2.4) : R(2.4, 3.8);
      const b = a * R(0.34, 0.46);
      const cx = x + a * R(-0.25, 0.2), cy = y - b * R(0.15, 0.45);
      play.ell(cx, cy, a, b, -R(0.0, 0.16), { k: R(0.5, 0.9), hk: 0.8, hz: b * 2.4, base: 1.4, tag: "shelf" });
      shelves.push({ x: cx, y: cy, a, b });
      next += (tiny ? R(2.4, 3.2) : R(3, 4.8)) + (big ? R(0.8, 1.8) : 0);
    }
    dist += segLen;
  }
  // Soft lobes along the belly side so the lower silhouette is never a tube.
  for (let i = 1; i < spine.length - 2; i += 1 + Math.floor(rnd() * 2)) {
    const s = spine[i];
    const d = dorsalAt(spine, i);
    const a = R(4, 8);
    play.ell(s[0] - d.nx * s[2], s[1] - d.ny * s[2], a, a * R(0.45, 0.6), R(0.05, 0.3), { k: 3, hk: 2, hz: a * 0.5, base: 0.4, tag: "lobe" });
  }

  // Interior fur masses on the flank facing the camera: big soft forms so the
  // body reads as rounded anatomy rather than a flat fill.
  for (let i = 0; i < spine.length; i++) {
    const d = dorsalAt(spine, i);
    if (d.cy > 205) break;
    const n = rnd() < 0.5 ? 1 : 0;
    for (let j = 0; j < n; j++) {
      const depth = R(4, d.r * 1.6);
      const x = d.x - d.nx * depth + d.tx * R(-3, 3), y = d.y - d.ny * depth + d.ty * R(-3, 3);
      const a = R(7, 13), b = a * R(0.5, 0.7), hz = R(1.6, 3);
      const base = reliefAt(play, x, y) - hz * 0.6;
      play.ell(x, y, a, b, Math.atan2(d.ty, d.tx) + R(-0.3, 0.3), { k: 0.5, hk: 5, hz, base });
    }
  }

  // Dorsal spires rising from the back (rose-cream monoliths), like the
  // reference BACK panel. They stand just behind the route in their own
  // depth layer ("ridge"), so they frame the climb without walling it off.
  const ridge = new Anatomy("ridge");
  const backAt = (y) => {
    let best = dorsal[0];
    for (const d of dorsal) if (Math.abs(d.y - y) < Math.abs(best.y - y)) best = d;
    return best;
  };
  for (const [y, len, lean, ra] of [[140, 15, -0.12, 2.6], [176, 21, 0.06, 3.4], [206, 13, -0.2, 2.2], [92, 12, 0.1, 2.2]]) {
    const d = backAt(y);
    const ax = d.x - d.nx * 2.2, ay = d.y - d.ny * 2.2;
    const bx = ax + Math.sin(lean) * len, by = ay + Math.cos(lean) * len;
    ridge.seg(ax, ay - 4, ra, bx, by, ra * 0.5, { mat: MAT_SPIRE, k: 1.0, hk: 1.2, hs: 0.7, base: 8 });
    ridge.ell(ax, ay - 3, ra * 2.6, ra * 1.3, 0, { k: 2, hk: 2, hz: ra, base: 0.5 });
  }

  // -- Props rooted on the body ---------------------------------------------
  const props = { mushrooms: [], trees: [], eyes: [] };
  props.eyes.push({ x: HX - 5.5, y: 284.5, w: 5.8, tilt: 0.1, outer: 1 });

  function addMushroom(x, yHint, capR, stemH, lean) {
    const y = play.surfaceBelow(x, yHint + 10, yHint - 14);
    if (y === null) return false;
    const root = { x, y: y - 0.3 };
    const top = { x: x + lean, y: y + stemH };
    // The cap is a one-way platform: land on it from above, jump up through it.
    const cap = { x: top.x, y: top.y + capR * 0.12, a: capR, b: capR * 0.32 };
    props.mushrooms.push({ root, top, capR, cap });
    return true;
  }
  const reserved = [];
  function addTree(x, yHint, h, kind) {
    const y = play.surfaceBelow(x, yHint + 10, yHint - 14);
    if (y === null || reserved.some((p) => Math.abs(p.x - x) < 2.2 && Math.abs(p.y - y) < 2.5)) return;
    props.trees.push({ x, y, h, kind, seed: hash2(x * 10, y * 10, seed) });
  }

  // A standing spot on top of a shelf (searches across the tread).
  function standOn(s) {
    for (const f of [0.2, 0.35, 0.05, 0.5, 0.65, 0.8]) {
      const x = s.x + s.a * f;
      const y = play.surfaceBelow(x, s.y + s.b + 7, s.y - s.b - 3);
      if (y !== null && y > s.y - s.b * 0.5) return { x, y };
    }
    return null;
  }
  const nearestShelf = (y, ok) => {
    let best = null;
    for (const s of shelves) if ((!best || Math.abs(s.y - y) < Math.abs(best.y - y)) && (!ok || ok(s))) best = s;
    return best;
  };

  // The gameplay showcase: the shelf on the back nearest 124 m.
  const show = nearestShelf(124, (s) => standOn(s));
  const { x: gx, y: gy } = standOn(show);
  reserved.push({ x: gx, y: gy });
  addTree(gx + 2.2, gy + 1, 2.6, "cypress");
  addTree(gx - 2.8, gy + 7, 3.4, "cypress");
  addTree(gx + 4, gy - 4, 1.6, "shrub");
  // Sparse vegetation along the rest of the back.
  for (const s of shelves) {
    const n = rnd() < 0.75 ? 1 + Math.floor(rnd() * 3) : 0;
    for (let i = 0; i < n; i++) {
      const x = s.x + R(-s.a * 0.3, s.a * 0.7);
      if (Math.abs(x - gx) < 3 && Math.abs(s.y - gy) < 4) continue; // keep the explorer's spot clear
      addTree(x, s.y + s.b + 4, rnd() < 0.7 ? R(0.8, 1.8) : R(2, 3.6), rnd() < 0.65 ? "shrub" : "cypress");
    }
  }
  addMushroom(gx - 4.6, gy + 6, 1.9, 2.4, -0.4);
  addMushroom(gx + 3.6, gy - 4.5, 1.6, 1.8, 0.3);
  addMushroom(gx - 1.6, gy + 3.4, 1.0, 1.1, -0.15);
  addMushroom(gx + 6.5, gy - 10, 2.2, 2.6, 0.4);

  // Establishing: on a shelf of the neck, below and behind the head.
  // Establishing: standing on the brow, right above the closed eye (the
  // reference's summit panel) - a spot the climb really reaches.
  const ex = HX - 11;
  const ey = play.surfaceBelow(ex, 310, 270);
  if (ey === null) throw new Error("brow has no standing surface");
  // Where a climb can start (the "start" tuning knob picks one).
  const base = standOn(nearestShelf(6, (s) => s.y > 2 && standOn(s)));
  const explorerSpots = {
    gameplay: { x: gx, y: gy, facing: -1 },
    establishing: { x: ex, y: ey, facing: -1 },
    base: { x: base.x, y: base.y, facing: -1 }
  };
  const focus = { head: { x: HX - 4, y: 285 } };

  // -- Far layer: the creature's far-side dorsal spires through the haze -----
  // Tall rounded monoliths rising from a rolling far-back ridge, placed along
  // the whole climb (to the sunward side) so every altitude has them.
  const far = new Anatomy("far");
  const routeX = (y) => {
    let best = dorsal[0];
    for (const d of dorsal) if (Math.abs(d.y - y) < Math.abs(best.y - y)) best = d;
    return best.x;
  };
  // Spires rise out of far cloud banks (their feet stay hidden in cloud, as in
  // the reference), so nothing floats and nothing walls off the sky.
  const farFeet = [];
  for (let y = 10; y < 340; y += R(24, 36)) {
    const bx = routeX(y) + R(26, 50), by = y - R(30, 40);
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const ax = bx + R(-6, 6), ay = by - 4;
      const h = R(34, 66), lean = R(-0.1, 0.1), ra = R(1.5, 2.6);
      far.seg(ax, ay, ra, ax + Math.sin(lean) * h, ay + Math.cos(lean) * h, ra * R(0.55, 0.7),
        { mat: MAT_SPIRE, k: 1.6, hk: 1.5, hs: 0.7, base: 8 + i });
    }
    farFeet.push({ x: bx, y: by + 3, size: R(14, 20), seed: Math.floor(rnd() * 1e9) });
  }

  // -- Cloud banks: painted cumulus wrapping the body at two depths ----------
  const clouds = { mid: [], far: farFeet.slice() };
  for (let y = 0; y < 310; y += R(12, 20)) {
    clouds.mid.push({ x: routeX(y) + R(6, 22), y: y - R(16, 26), size: R(7, 13), seed: Math.floor(rnd() * 1e9) });
    if (rnd() < 0.6) clouds.mid.push({ x: routeX(y) - R(20, 40), y: y - R(18, 30), size: R(8, 14), seed: Math.floor(rnd() * 1e9) });
    clouds.far.push({ x: routeX(y) + R(-30, 50), y: y - R(34, 50), size: R(16, 28), seed: Math.floor(rnd() * 1e9) });
  }

  // -- Tail layer: the tail curling up out of the clouds ---------------------
  const tail = new Anatomy("tail");
  const tailSpine = sampleSpine([
    [76, -100, 15], [80, -10, 13], [74, 60, 11], [58, 102, 9], [36, 114, 7],
    [24, 104, 5.5], [27, 88, 4], [37, 86, 3]
  ], 6);
  addSpine(tail, tailSpine, { k: 4, hk: 3, hs: 0.5 });

  // -- Foreground: near fur clumps framing the bottom of the frame -----------
  const fore = new Anatomy("fore");
  const gs = explorerSpots.gameplay;
  fore.ell(gs.x - 3.6, gs.y - 5.4, 2.2, 1.5, 0.3, { k: 1, hk: 1, hz: 1.5, tag: "lobe" });
  fore.ell(gs.x - 1.4, gs.y - 5.9, 2.0, 1.4, -0.15, { k: 1, hk: 1, hz: 1.4, tag: "lobe" });
  fore.ell(gs.x + 4.4, gs.y - 5.6, 2.2, 1.3, -0.3, { k: 1, hk: 1, hz: 1.3, tag: "lobe" });

  return {
    seed,
    spine,
    layers: { play, tail, far, fore, ridge },
    clouds,
    props,
    explorerSpots,
    focus
  };
}

// ==== module 30-brush ====
// ---- Brush primitives -------------------------------------------------------
// All marks are filled shapes with soft value shifts, not outlines: tapered
// fur locks, round dabs for moss and leaves, and long thin streaks.

// Offscreen paint buffers. Where OffscreenCanvas is missing (older WebViews),
// buffers come from the runtime's own canvas factory (set at init), hidden.
let canvasFallback = null;
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = canvasFallback();
  c.width = w;
  c.height = h;
  return c;
}
function discardCanvas(c) {
  if (c && typeof c.remove === "function") c.remove();
}

// Finished paintings become GPU-friendly bitmaps: the scratch canvas was read
// back during the repaint (CPU-backed), and drawing it every frame would
// re-upload it. Falls back to a plain copy where bitmaps are unavailable.
function toDrawable(c) {
  if (typeof c.transferToImageBitmap === "function") return c.transferToImageBitmap();
  return c;
}

// A tapered lock of fur: rounded root, swelling body, pointed tip.
// (x, y) root in px, (dx, dy) unit direction in px space, bend in [-0.5, 0.5].
function lockPath(g, x, y, dx, dy, len, w, bend) {
  const px = -dy, py = dx;
  const bx = px * bend * len, by = py * bend * len;
  const tx = x + dx * len + bx, ty = y + dy * len + by;
  const mx = x + dx * len * 0.42 + bx * 0.5, my = y + dy * len * 0.42 + by * 0.5;
  g.beginPath();
  g.moveTo(x - px * w * 0.45, y - py * w * 0.45);
  g.quadraticCurveTo(mx - px * w * 0.7, my - py * w * 0.7, tx, ty);
  g.quadraticCurveTo(mx + px * w * 0.7, my + py * w * 0.7, x + px * w * 0.45, y + py * w * 0.45);
  g.quadraticCurveTo(x - dx * w * 0.55, y - dy * w * 0.55, x - px * w * 0.45, y - py * w * 0.45);
  g.closePath();
}

function drawLock(g, x, y, dx, dy, len, w, bend, col, alpha) {
  lockPath(g, x, y, dx, dy, len, w, bend);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function dab(g, x, y, rx, ry, rot, col, alpha) {
  g.beginPath();
  g.ellipse(x, y, Math.max(rx, 0.3), Math.max(ry, 0.3), rot, 0, Math.PI * 2);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function streak(g, x, y, dx, dy, len, width, col, alpha) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dx * len, y + dy * len);
  g.lineCap = "round";
  g.lineWidth = Math.max(width, 0.5);
  g.strokeStyle = css(col, alpha);
  g.stroke();
}

// ==== module 35-fur ====
// ---- Fur: soft clumps, dripping tips, and a broken silhouette fringe ---------
// The reference fur is not hair noise: it is large, soft, rounded clumps lit
// on top and lavender underneath, ending in pointed tips that hang over the
// clump below. Fine detail lives at clump tips and at the silhouette only.

function clumpCell(L, k) { return Math.max(L.clumpCell, L.minClumpPx / k); }
function fringeCell(L, k) { return Math.max(L.fringeCell, L.minLockPx / k); }
function furReach(L, k) { return Math.max(clumpCell(L, k) * 3.2, fringeCell(L, k) * 4); }

// Flow: toward the tail, falling with gravity, combed outward at the
// silhouette and around relief forms.
function furDir(F, idx, nrm, L, X, Y, seed, edge, jitter) {
  F.normals(idx, nrm);
  const fl = L.flow || [0, -1];
  let dx = fl[0] * 0.75 + nrm.ox * edge * 0.95 - nrm.nx * 0.2;
  let dy = fl[1] * 0.75 - 0.45 + nrm.oy * edge * 0.95 - nrm.ny * 0.2;
  const ang = (vnoise(X * 0.28, Y * 0.28, seed + 3) - 0.5) * 0.8 + jitter;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
  const l = Math.hypot(rx, ry) || 1;
  return [rx / l, ry / l];
}

// Lit colour at a world point, falling back toward the body interior when the
// point is off the fur (so fringe locks never sample empty sky).
function furColorAt(F, X, Y, seed, nrm, fallbackIdx) {
  let idx = F.index(X, Y);
  if (idx < 0 || F.sd[idx] > -0.05 || F.mat[idx] !== MAT_FUR) idx = fallbackIdx;
  const c = surfaceColor(F, idx, X, Y, seed, nrm);
  return { c, t: nrm.t };
}

// A tapered curved brush stroke (wide at the root, thin at the tip).
function g2Stroke(g, x, y, dx, dy, len, w, bend, col, alpha) {
  const px = -dy, py = dx;
  const tx = x + dx * len + px * bend * len, ty = y + dy * len + py * bend * len;
  const mx = x + dx * len * 0.5 + px * bend * len * 0.6, my = y + dy * len * 0.5 + py * bend * len * 0.6;
  g.beginPath();
  g.moveTo(x - px * w * 0.5, y - py * w * 0.5);
  g.quadraticCurveTo(mx - px * w * 0.35, my - py * w * 0.35, tx, ty);
  g.quadraticCurveTo(mx + px * w * 0.35, my + py * w * 0.35, x + px * w * 0.5, y + py * w * 0.5);
  g.arc(x, y, w * 0.5, Math.atan2(py, px), Math.atan2(py, px) + Math.PI);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function* paintFur(tg, F, L, x0, yTop, k, span, seed) {
  const nrm = {};
  const toPx = (X, Y) => [(X - x0) * k, (yTop - Y) * k];
  const reach = furReach(L, k);

  // Pass A: brush strokes. Short opaque streaks along the fur flow, a
  // little lighter on lit forms and a little darker in shade, so the fur
  // reads as gouache texture over the big lit forms beneath.
  const C = clumpCell(L, k);
  for (let cy = Math.floor((yTop - span - reach) / C); cy <= Math.ceil((yTop + reach) / C); cy++) {
    for (let cx = Math.floor((x0 - reach) / C); cx <= Math.ceil((x0 + span + reach) / C); cx++) {
      const r = rngFrom(hash2(cx, cy, seed));
      const X = (cx + r()) * C, Y = (cy + r()) * C;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_FUR || F.sd[idx] > -0.05) continue;
      const edge = 1 - smoothstep(0, 2.2, -F.sd[idx]);
      const [dx, dy] = furDir(F, idx, nrm, L, X, Y, seed, edge, (r() - 0.5) * 0.35);
      const base = surfaceColor(F, idx, X, Y, seed, nrm);
      const lit = nrm.t;
      const dv = (lit > 0.55 ? 0.1 : -0.08) + (r() - 0.5) * 0.16;
      const col = finishColor(shade(lit > 0.6 && r() < 0.3 ? mixRGB(base, PAL.furRim, 0.35) : base, dv), Y, L);
      const len = C * (2.2 + r() * 2.2) * k;
      const w = Math.max(1, C * (0.32 + r() * 0.3) * k);
      const [px, py] = toPx(X, Y);
      const bend = (r() - 0.5) * 0.25;
      g2Stroke(tg, px, py, dx, -dy, len, w, bend, col, 0.62 + r() * 0.3);
    }
    yield;
  }

  // Pass B: silhouette fringe - small locks combed outward so the edge of the
  // body breaks up into fur instead of a hard outline.
  const f = fringeCell(L, k);
  for (let cy = Math.floor((yTop - span - reach) / f); cy <= Math.ceil((yTop + reach) / f); cy++) {
    for (let cx = Math.floor((x0 - reach) / f); cx <= Math.ceil((x0 + span + reach) / f); cx++) {
      const r = rngFrom(hash2(cx, cy, seed + 5));
      const X = (cx + r()) * f, Y = (cy + r()) * f;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_FUR) continue;
      const sd = F.sd[idx];
      if (sd > 0.05 || sd < -0.9) continue;
      const [dx, dy] = furDir(F, idx, nrm, L, X, Y, seed, 1, (r() - 0.5) * 0.5);
      const inner = F.index(X - nrm.ox * 0.6, Y - nrm.oy * 0.6);
      const col = furColorAt(F, X - nrm.ox * 0.6, Y - nrm.oy * 0.6, seed, nrm, inner < 0 ? idx : inner);
      const c = finishColor(shade(col.c, (r() - 0.5) * 0.12), Y, L);
      const [px, py] = toPx(X, Y);
      drawLock(tg, px, py, dx, -dy, f * (2.2 + r() * 1.6) * k, f * (0.2 + r() * 0.16) * k, (r() - 0.5) * 0.5, c, 0.92);
    }
    yield;
  }
}

// Scalloped drips under every fur form (shelves, belly lobes, interior
// masses): pointed locks hang from each form's lower edge over the shadow
// beneath it - the signature edge of the reference fur.
function paintDrips(tg, F, L, prims, x0, yTop, k, span, seed) {
  const nrm = {};
  const spacing = Math.max(L.fringeCell * 0.75, 6 / k);
  const flow = L.flow || [0, -1];
  for (const p of prims) {
    if (p.kind !== ELL || p.mat !== MAT_FUR || (p.tag !== "shelf" && p.tag !== "lobe")) continue;
    if (p.maxX < x0 - 2 || p.minX > x0 + span + 2 || p.maxY < yTop - span - 3 || p.minY > yTop + 3) continue;
    const arc = Math.PI * (p.a + p.b) * 0.42;
    const n = Math.max(3, Math.round(arc / spacing));
    for (let i = 0; i <= n; i++) {
      const r = rngFrom(hash2(p.id * 977 + i, p.id, seed + 9));
      const th = Math.PI * (1.08 + 0.84 * (i + (r() - 0.5) * 0.6) / n);
      const lx = Math.cos(th) * p.a * 0.97, ly = Math.sin(th) * p.b * 0.97;
      const X = p.cx + lx * p.cos - ly * p.sin, Y = p.cy + lx * p.sin + ly * p.cos;
      const idx = F.index(X, Y);
      if (idx < 0) continue;
      // Only where this form is the visible surface (not buried in the body).
      const own = p.hz * 0.24 + p.base;
      if (F.h[idx] > own + 0.35 || F.sd[idx] < (p.tag === "shelf" ? -4 : -1.4)) continue;
      const inner = F.index(X - (lx * p.cos - ly * p.sin) * 0.25, Y - (lx * p.sin + ly * p.cos) * 0.25);
      const col = furColorAt(F, X, Y + p.b * 0.25, seed, nrm, inner < 0 ? idx : inner);
      let dx = flow[0] * 0.35 + Math.cos(th) * 0.2 + (r() - 0.5) * 0.3, dy = -1;
      const dl = Math.hypot(dx, dy);
      dx /= dl; dy /= dl;
      const len = Math.max(p.b * (0.45 + r() * 0.55), 12 / k);
      const w = spacing * (0.4 + r() * 0.25);
      const c0 = finishColor(shade(col.c, (r() - 0.5) * 0.08), Y, L);
      const c1 = finishColor(shade(mixRGB(col.c, PAL.fur[1], 0.15), -0.06), Y - len, L);
      const px = (X - x0) * k, py = (yTop - Y) * k;
      const sx = px - dx * len * k * 0.35, sy = py + dy * len * k * 0.35;
      const grad = tg.createLinearGradient(sx, sy, px + dx * len * k, py - dy * len * k);
      grad.addColorStop(0, css(c0, 0.95));
      grad.addColorStop(1, css(c1, 0.95));
      lockPath(tg, sx, sy, dx, -dy, len * k * 1.35, w * k, (r() - 0.5) * 0.35);
      tg.fillStyle = grad;
      tg.fill();
    }
  }
}

// ==== module 38-repaint ====
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

function* repaintCanvas(g, gx0, gy0, R, seed) {
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
  let work = 0;
  for (let p = 0; p < R.passes.length; p++) {
    const P = R.passes[p];
    const c = P.cell;
    const reach = P.len * 0.75;
    for (let cy = Math.floor((gy0 + reach) / c); cy <= Math.ceil((gy0 + H - reach) / c); cy++) {
      for (let cx = Math.floor((gx0 + reach) / c); cx <= Math.ceil((gx0 + W - reach) / c); cx++) {
        if ((++work & 47) === 0) yield;
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
        if (w > 3 && !P.minGrad && r() < 0.5) {
          const px = -dy, py = dx;
          for (let b = 0; b < 2; b++) {
            const off = (r() - 0.5) * w * 0.6;
            streak(g, sx + px * off, sy + py * off, dx, dy, len * (0.55 + r() * 0.35), Math.max(0.6, w * 0.12),
              shade(col, b ? 0.12 : -0.12), 0.32);
          }
        }
      }
      yield;
    }
  }
}

// ==== module 40-painter ====
// ---- Painter: turns an anatomy layer into painted, cached tiles -------------
// Per tile:
//   1. Sample sd / relief / material on a grid (with margin for brush reach).
//   2. Light the relief (low sun from the upper left), darken creases,
//      warm the rims and push fog in by depth: a soft painted under-layer.
//   3. Lay fur locks along the anatomy's flow (down the body, outward at the
//      silhouette so edges break up into fur), then moss, spire streaks and
//      rooted props.
// Marks are seeded by world cell, so tile borders are invisible.

const LIGHT = (() => {
  const v = [0.8 * SUN_SIDE, 0.5, 0.36];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const LIGHT2 = (() => {
  const l = Math.hypot(LIGHT[0], LIGHT[1]);
  return [LIGHT[0] / l, LIGHT[1] / l];
})();

function fogColor(y) {
  return mixRGB(PAL.mistWarm, PAL.mistCool, smoothstep(40, 420, y));
}

const TILE = 512;

// Field sample buffers are pooled by size: tiles are painted continuously
// while climbing, and reallocating megabytes per tile causes GC pauses.
const FIELD_POOL = new Map();
function takeFieldBuffers(n) {
  const list = FIELD_POOL.get(n);
  if (list && list.length) return list.pop();
  return { sd: new Float32Array(n), h: new Float32Array(n), mat: new Uint8Array(n), prim: new Array(n), cav: new Float32Array(n), tmp: new Float32Array(n) };
}
function releaseFieldBuffers(n, b) {
  if (!FIELD_POOL.has(n)) FIELD_POOL.set(n, []);
  const list = FIELD_POOL.get(n);
  if (list.length < 4) list.push(b);
}

class FieldGrid {
  constructor(x0, yTop, step, n, mg) {
    const N = n + 2 * mg;
    this.N = N; this.n = n; this.mg = mg; this.step = step; this.x0 = x0; this.yTop = yTop;
    this.buf = takeFieldBuffers(N * N);
    this.sd = this.buf.sd;
    this.h = this.buf.h;
    this.mat = this.buf.mat;
    this.prim = this.buf.prim;
    this.mat.fill(0);
    this.any = false;
  }

  release() {
    releaseFieldBuffers(this.N * this.N, this.buf);
    this.buf = this.sd = this.h = this.mat = this.prim = this.cav = null;
  }

  // Samples both fields block by block; each block only evaluates the
  // primitives near it. Yields between blocks so painting can be time-sliced.
  *fill(anat, prims) {
    const N = this.N, mg = this.mg, step = this.step, B = 16, pad = 3;
    const o = {};
    for (let bj = 0; bj < N; bj += B) {
      for (let bi = 0; bi < N; bi += B) {
        const bx0 = this.x0 + (bi - mg) * step, bx1 = bx0 + B * step;
        const by1 = this.yTop - (bj - mg) * step, by0 = by1 - B * step;
        const sub = prims.filter((p) => {
          const m = p.k * 2 + pad;
          return p.maxX + m >= bx0 && p.minX - m <= bx1 && p.maxY + m >= by0 && p.minY - m <= by1;
        });
        for (let j = bj; j < Math.min(bj + B, N); j++) {
          const Y = this.yTop - (j - mg + 0.5) * step;
          for (let i = bi; i < Math.min(bi + B, N); i++) {
            const idx = j * N + i;
            if (!sub.length) { this.sd[idx] = 1e3; this.h[idx] = -1e3; continue; }
            anat.eval(this.x0 + (i - mg + 0.5) * step, Y, sub, o);
            this.sd[idx] = o.sd;
            this.h[idx] = o.h;
            this.mat[idx] = o.mat;
            this.prim[idx] = o.prim;
            if (o.sd < 2) this.any = true;
          }
        }
        yield;
      }
    }
    yield* this.cavity(Math.max(1, Math.round(1.3 / step)));
  }

  // Box-blurred relief minus relief: positive in creases and folds.
  *cavity(r) {
    const N = this.N, src = this.h, tmp = this.buf.tmp, out = this.buf.cav;
    const pass = (from, to, horizontal) => {
      for (let a = 0; a < N; a++) {
        let sum = 0, cnt = 0;
        const at = (b) => (horizontal ? a * N + b : b * N + a);
        for (let b = 0; b < Math.min(r, N); b++) { sum += Math.max(from[at(b)], 0); cnt++; }
        for (let b = 0; b < N; b++) {
          if (b + r < N) { sum += Math.max(from[at(b + r)], 0); cnt++; }
          if (b - r - 1 >= 0) { sum -= Math.max(from[at(b - r - 1)], 0); cnt--; }
          to[at(b)] = sum / cnt;
        }
      }
    };
    pass(src, tmp, true);
    yield;
    pass(tmp, out, false);
    for (let i = 0; i < N * N; i++) out[i] = out[i] - Math.max(src[i], 0);
    this.cav = out;
  }

  index(X, Y) {
    const i = Math.floor((X - this.x0) / this.step + this.mg);
    const j = Math.floor((this.yTop - Y) / this.step + this.mg);
    if (i < 1 || j < 1 || i >= this.N - 1 || j >= this.N - 1) return -1;
    return j * this.N + i;
  }

  // Relief normal (camera-facing 3D) and silhouette normal (in-plane, outward).
  normals(idx, out) {
    const N = this.N, s2 = this.step * 2, h = this.h, hc = h[idx];
    const p = this.prim[idx];
    if (p && p.fall > 3) {
      // Stacked forms are lit from their own shape so their edges never alias.
      const X = this.x0 + ((idx % N) - this.mg + 0.5) * this.step;
      const Y = this.yTop - (Math.floor(idx / N) - this.mg + 0.5) * this.step;
      const e = this.step;
      const gx = (primRelief(p, X + e, Y) - primRelief(p, X - e, Y)) / s2;
      const gy = (primRelief(p, X, Y + e) - primRelief(p, X, Y - e)) / s2;
      const l = Math.min(Math.hypot(gx, gy, 1), 6);
      const g = Math.hypot(gx, gy) || 1;
      const nz = 1 / l, inPlane = Math.sqrt(Math.max(0, 1 - nz * nz));
      out.nx = (-gx / g) * inPlane; out.ny = (-gy / g) * inPlane; out.nz = nz;
      const sx = (this.sd[idx + 1] - this.sd[idx - 1]) / s2;
      const sy = (this.sd[idx - N] - this.sd[idx + N]) / s2;
      const sl = Math.hypot(sx, sy) || 1;
      out.ox = sx / sl; out.oy = sy / sl;
      return out;
    }
    // A jump bigger than J is the edge of a form stacked in front (ear, spire,
    // mushroom); treat it as a cliff, not a slope, so edges do not alias.
    const J = 1.5;
    const side = (v) => (Math.abs(v - hc) > J ? hc : v);
    const hx = (side(h[idx + 1]) - side(h[idx - 1])) / s2;
    const hy = (side(h[idx - N]) - side(h[idx + N])) / s2;
    let l = Math.hypot(hx, hy, 1);
    out.nx = -hx / l; out.ny = -hy / l; out.nz = 1 / l;
    const sx = (this.sd[idx + 1] - this.sd[idx - 1]) / s2;
    const sy = (this.sd[idx - N] - this.sd[idx + N]) / s2;
    l = Math.hypot(sx, sy) || 1;
    out.ox = sx / l; out.oy = sy / l;
    return out;
  }
}

// Lit surface colour for one grid sample (before fog).
function surfaceColor(F, idx, X, Y, seed, nrm) {
  F.normals(idx, nrm);
  const mat = F.mat[idx];
  const lam = nrm.nx * LIGHT[0] + nrm.ny * LIGHT[1] + nrm.nz * LIGHT[2];
  const cav = F.cav[idx];
  let t = 0.22 + lam * 0.68;
  t -= clamp(cav * 0.2, 0, 0.55);
  t += clamp(-cav * 0.05, 0, 0.08);
  t += (fbm(X * 0.11, Y * 0.11, seed, 3) - 0.5) * 0.26;
  const edge = 1 - nrm.nz;
  let c;
  if (mat === MAT_SPIRE) {
    const p = F.prim[idx];
    const ax = p.bx - p.ax, ay = p.by - p.ay, al = Math.hypot(ax, ay);
    const along = ((X - p.ax) * ax + (Y - p.ay) * ay) / al;
    const across = ((X - p.ax) * ay - (Y - p.ay) * ax) / al;
    t += (vnoise(across * 1.6, along * 0.08, seed + 7) - 0.5) * 0.22;
    c = ramp(PAL.spire, t + 0.08);
  } else if (mat === MAT_EAR || mat === MAT_SKIN) {
    c = ramp(PAL.skin, t + 0.05);
    if (mat === MAT_EAR) {
      const p = F.prim[idx];
      const vx = p.bx - p.ax, vy = p.by - p.ay;
      const u = clamp(((X - p.ax) * vx + (Y - p.ay) * vy) / (vx * vx + vy * vy), 0, 1);
      const dx = X - (p.ax + vx * u), dy = Y - (p.ay + vy * u);
      const r = p.ra + (p.rb - p.ra) * u;
      const inner = 1 - Math.hypot(dx, dy) / r;
      c = mixRGB(c, shade(PAL.earInner, (t - 0.55) * 0.5), smoothstep(0.32, 0.75, inner) * 0.75 * smoothstep(0.02, 0.15, u));
    }
  } else {
    c = ramp(PAL.fur, t);
    c = mixRGB(c, PAL.furBounce, clamp(-nrm.ny, 0, 1) * edge * 0.35);
  }
  const rim = edge * clamp(nrm.nx * LIGHT2[0] + nrm.ny * LIGHT2[1], 0, 1) * smoothstep(-2.5, 0, F.sd[idx]);
  c = mixRGB(c, PAL.furRim, rim * 0.7);
  nrm.t = t;
  return c;
}

function finishColor(c, Y, L) {
  if (L.valueShift) c = shade(c, L.valueShift);
  if (L.fog) c = mixRGB(c, L.fogCool ? mixRGB(PAL.mistCool, PAL.skyMid, 0.35) : fogColor(Y), L.fog);
  return c;
}

// Paints one anatomy tile. A generator: it yields often so the scheduler
// can spread the work across frames; returns whether anything was drawn.
function* paintAnatomyTile(tg, x0, yTop, k, L, world) {
  const anat = L.anatomy;
  const T = tg.canvas.width;
  const span = T / k;
  const reach = furReach(L, k);
  const margin = reach + 1.6;
  const prims = anat.cull(x0 - margin, yTop - span - margin, x0 + span + margin, yTop + margin);
  const hasProps = L.props && propsInRect(world, x0 - 6, yTop - span - 6, x0 + span + 6, yTop + 6);
  if (!prims.length && !hasProps) return false;

  const gp = L.gridPx;
  const step = gp / k;
  const n = Math.ceil(T / gp);
  const mg = Math.ceil(margin / step);
  const F = new FieldGrid(x0, yTop, step, n, mg);
  yield* F.fill(anat, prims);
  if (!F.any && !hasProps) { F.release(); return false; }
  const nrm = {};
  const seed = world.seed + L.seedOffset;

  // 1-2. Painted under-layer at grid resolution, upscaled smoothly.
  const iw = n + 2;
  const img = makeCanvas(iw, iw);
  const ig = img.getContext("2d");
  const data = ig.createImageData(iw, iw);
  for (let j = 0; j < iw; j++) {
    const gj = mg - 1 + j;
    const Y = yTop - (gj - mg + 0.5) * step;
    for (let i = 0; i < iw; i++) {
      const gi = mg - 1 + i;
      const idx = gj * F.N + gi;
      const sd = F.sd[idx];
      const a = clamp(0.5 - (sd + 0.08) / step, 0, 1);
      if (a <= 0 || F.mat[idx] === MAT_SHROOM) continue;
      const X = x0 + (gi - mg + 0.5) * step;
      const c = finishColor(surfaceColor(F, idx, X, Y, seed, nrm), Y, L);
      const o = (j * iw + i) * 4;
      data.data[o] = c[0]; data.data[o + 1] = c[1]; data.data[o + 2] = c[2]; data.data[o + 3] = a * 255;
    }
    if ((j & 15) === 15) yield;
  }
  ig.putImageData(data, 0, 0);
  tg.imageSmoothingEnabled = true;
  tg.imageSmoothingQuality = "low"; // bilinear: higher filters ring at alpha edges
  tg.drawImage(img, -gp, -gp, iw * gp, iw * gp);
  discardCanvas(img);
  yield;

  const toPx = (X, Y) => [(X - x0) * k, (yTop - Y) * k];

  // 3a. Fur: brush strokes along the flow, a fringe at the silhouette, drips.
  yield* paintFur(tg, F, L, x0, yTop, k, span, seed);
  paintDrips(tg, F, L, prims, x0, yTop, k, span, seed);
  yield;
  // 3b. Spire streaks: long strokes along each monolith's axis.
  const sc = Math.max(0.5, 5 / k);
  for (let cy = Math.floor((yTop - span) / sc); cy <= Math.ceil(yTop / sc); cy++) {
    for (let cx = Math.floor(x0 / sc); cx <= Math.ceil((x0 + span) / sc); cx++) {
      const r = rngFrom(hash2(cx, cy, seed + 11));
      const X = (cx + r()) * sc, Y = (cy + r()) * sc;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_SPIRE || F.sd[idx] > -0.2 || r() < 0.55) continue;
      const p = F.prim[idx];
      const ax = p.bx - p.ax, ay = p.by - p.ay, al = Math.hypot(ax, ay);
      const col = finishColor(shade(surfaceColor(F, idx, X, Y, seed, nrm), (r() - 0.45) * 0.25), Y, L);
      const [px, py] = toPx(X, Y);
      streak(tg, px, py, ax / al, -ay / al, (1.5 + r() * 3) * k, Math.max(0.8, 0.12 * k), col, 0.45);
    }
  }

  // 3c. Moss on upward faces and in creases (patchy, denser on the back).
  if (L.moss) {
    const mc = Math.max(0.3, 6 / k);
    for (let cy = Math.floor((yTop - span - 1) / mc); cy <= Math.ceil((yTop + 1) / mc); cy++) {
      for (let cx = Math.floor((x0 - 1) / mc); cx <= Math.ceil((x0 + span + 1) / mc); cx++) {
        const r = rngFrom(hash2(cx, cy, seed + 23));
        const X = (cx + r()) * mc, Y = (cy + r()) * mc;
        const idx = F.index(X, Y);
        if (idx < 0 || F.mat[idx] !== MAT_FUR) continue;
        const sd = F.sd[idx];
        F.normals(idx, nrm);
        const mask = fbm(X * 0.09, Y * 0.09, seed + 29, 3);
        const top = sd > -0.9 && sd < 0.05 && nrm.oy > 0.45 && mask > 0.6;
        const crease = F.cav[idx] > 0.55 && mask > 0.56 && sd < -0.6;
        if (!top && !crease) continue;
        const [px, py] = toPx(X, Y);
        const tint = (lit) => finishColor(mixRGB(ramp(PAL.moss, lit), PAL.fur[1], 0.22), Y, L);
        const count = top ? 9 + Math.floor(r() * 8) : 4;
        for (let d = 0; d < count; d++) {
          const ox = (r() - 0.5) * 0.45, h = (0.07 + r() * 0.14) * (top ? 1 : 0.6);
          const lit = clamp(0.3 + ox * 0.5 * SUN_SIDE + h * 1.5 + (r() - 0.5) * 0.3 + (crease ? -0.15 : 0), 0, 1);
          streak(tg, px + ox * k, py + 0.05 * k, (r() - 0.5) * 0.5, -1, h * k, Math.max(1, 0.035 * k), tint(lit), 0.85);
        }
      }
    }
  }

  yield;
  // 3d. Props rooted on this layer (mushrooms, trees, the closed eye).
  if (hasProps) drawProps(tg, world, x0, yTop, k, L, seed);
  F.release();
  return true;
}

// Runs a painting generator to completion (loading, or must-show tiles).
function runSync(gen) {
  let r;
  while (!(r = gen.next()).done);
  return r.value;
}

// Spreads tile painting across frames: jobs are generators, the most urgent
// (visible, then nearest the camera) run first, within a per-frame budget.
class PaintScheduler {
  constructor() {
    this.jobs = new Set();
  }

  request(entry, priority) {
    if (entry.done) return;
    entry.priority = Math.max(entry.priority || 0, priority);
    this.jobs.add(entry);
  }

  finish(entry) {
    if (entry.done) return;
    const t0 = performance.now();
    while (!entry.done) entry.step();
    this.syncMs = (this.syncMs || 0) + performance.now() - t0;
    this.syncCount = (this.syncCount || 0) + 1;
    this.jobs.delete(entry);
  }

  // Loading: finish what the first frame shows plus the walkable body around
  // it (priority >= 6: visible tiles, and the play layer's ring); the rest
  // streams in.
  finishVisible() {
    for (const j of [...this.jobs]) if (j.priority >= 6) this.finish(j);
  }

  pump(budgetMs) {
    const end = performance.now() + budgetMs;
    while (this.jobs.size && performance.now() < end) {
      let best = null;
      for (const j of this.jobs) if (!best || j.priority > best.priority) best = j;
      while (!best.done && performance.now() < end) best.step();
      if (best.done) this.jobs.delete(best);
    }
    for (const j of this.jobs) j.priority = 0; // re-earned by the next frame's requests
  }

  get busy() {
    return this.jobs.size > 0;
  }
}

// Tile cache for one depth layer. Layer pixel space: lx = X * k, ly = -Y * k.
// Tiles are painted with a margin (so brushwork crosses tile borders
// identically on both sides), repainted, and drawn cropped. Distant layers
// paint at reduced resolution (L.res) and are scaled up when drawn.
class PaintedLayer {
  constructor(L, world, sched) {
    this.L = L;
    this.world = world;
    this.sched = sched;
    this.tiles = new Map();
    this.maxTiles = L.maxTiles || 24;
    this.res = L.res || 1;
    this.frame = 0;
  }

  entry(tx, ty, k, pr) {
    const key = `${k.toFixed(4)}|${pr}|${tx}|${ty}`;
    let e = this.tiles.get(key);
    if (!e) {
      e = { key, done: false, canvas: null, priority: 0, used: this.frame };
      const gen = this.job(e, tx, ty, k, pr);
      e.step = () => {
        const t0 = performance.now();
        if (gen.next().done) e.done = true;
        e.ms = (e.ms || 0) + performance.now() - t0;
        if (e.done && globalThis.__dwProfile) globalThis.__dwProfile.push({ layer: this.L.name, ms: e.ms, used: !!e.canvas });
      };
      this.tiles.set(key, e);
    }
    e.used = this.frame;
    return e;
  }

  *job(e, tx, ty, k, pr) {
    const M = REPAINT_MARGIN, res = this.res, kp = k * res;
    const c = makeCanvas(Math.round((TILE + 2 * M) * res), Math.round((TILE + 2 * M) * res));
    const tg = c.getContext("2d", { willReadFrequently: true });
    const x0 = (tx * TILE - M) / k, yTop = (-ty * TILE + M) / k;
    const used = yield* this.L.paint(tg, x0, yTop, kp, this.L, this.world);
    if (used && this.L.repaint) {
      yield* repaintCanvas(tg, (tx * TILE - M) * res, (ty * TILE - M) * res,
        scaleRepaint(this.L.repaint, pr * res, this.L.flow), this.world.seed + this.L.seedOffset + 17);
    }
    if (used && this.L.props) drawPostProps(tg, this.world, x0, yTop, kp, this.L, this.world.seed + this.L.seedOffset);
    e.canvas = used ? toDrawable(c) : null;
  }

  evict() {
    if (this.tiles.size <= this.maxTiles) return;
    const old = [...this.tiles.values()].filter((e) => e.used < this.frame).sort((a, b) => a.used - b.used);
    for (const e of old) {
      if (this.tiles.size <= this.maxTiles) break;
      this.tiles.delete(e.key);
      this.sched.jobs.delete(e);
      if (e.canvas && e.canvas.close) e.canvas.close();
      else discardCanvas(e.canvas);
    }
  }

  // Requests (without drawing) every tile a view will need: used to paint a
  // view in the background before cutting to it.
  request(view, priority) {
    const k = view.ppm * view.pr * this.L.par;
    const ox = Math.round(view.W / 2 - view.camX * k);
    const oy = Math.round(view.horizon + view.camY * k);
    for (let ty = Math.floor(-oy / TILE); ty <= Math.floor((view.H - oy) / TILE); ty++) {
      for (let tx = Math.floor(-ox / TILE); tx <= Math.floor((view.W - ox) / TILE); tx++) {
        const e = this.entry(tx, ty, k, view.pr);
        e.used = this.frame + 1; // keep through the next draw's eviction
        if (!e.done) this.sched.request(e, priority);
      }
    }
  }

  // Draws ready tiles, requests missing ones (visible first, then a one-tile
  // ring ahead of the camera). Must-show layers finish visible tiles now.
  draw(g, view, mustShow) {
    this.frame++;
    const k = view.ppm * view.pr * this.L.par;
    const ox = Math.round(view.W / 2 - view.camX * k);
    const oy = Math.round(view.horizon + view.camY * k);
    const tx0 = Math.floor(-ox / TILE), tx1 = Math.floor((view.W - ox) / TILE);
    const ty0 = Math.floor(-oy / TILE), ty1 = Math.floor((view.H - oy) / TILE);
    const M = REPAINT_MARGIN * this.res, S = TILE * this.res;
    const cx = (view.W / 2 - ox) / TILE, cy = (view.H / 2 - oy) / TILE;
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        const visible = ty >= ty0 && ty <= ty1 && tx >= tx0 && tx <= tx1;
        const e = this.entry(tx, ty, k, view.pr);
        if (!e.done) {
          const near = 1 / (1 + Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy));
          this.sched.request(e, (visible ? 10 : 1) + near + (this.L.urgency || 0));
          if (visible && mustShow) this.sched.finish(e);
        }
        if (visible && e.done && e.canvas) g.drawImage(e.canvas, M, M, S, S, tx * TILE + ox, ty * TILE + oy, TILE, TILE);
      }
    }
    // Paint ahead: the tiles the camera will reach soon (its predicted view).
    if (view.aheadX || view.aheadY) {
      const ax = Math.round(view.aheadX * this.L.par), ay = Math.round(view.aheadY * this.L.par);
      const fx0 = Math.floor((ax - ox) / TILE), fx1 = Math.floor((view.W + ax - ox) / TILE);
      const fy0 = Math.floor((ay - oy) / TILE), fy1 = Math.floor((view.H + ay - oy) / TILE);
      for (let ty = fy0; ty <= fy1; ty++) {
        for (let tx = fx0; tx <= fx1; tx++) {
          const e = this.entry(tx, ty, k, view.pr);
          if (!e.done) this.sched.request(e, 3 + (this.L.urgency || 0));
        }
      }
    }
    this.evict();
  }
}

// ==== module 45-props ====
// ---- Props rooted in the anatomy: mushrooms, small trees, the closed eye ----
// Each prop is painted with the same light and fog as the body under it.
// Mushroom caps and stems also exist in the anatomy field (MAT_SHROOM), so
// what you see is what you can stand on.

function propsInRect(world, x0, y0, x1, y1) {
  const P = world.props;
  for (const m of P.mushrooms) if (m.top.x + m.capR > x0 && m.top.x - m.capR < x1 && m.top.y + m.capR > y0 && m.root.y < y1) return true;
  for (const t of P.trees) if (t.x + t.h > x0 && t.x - t.h < x1 && t.y + t.h > y0 && t.y - 0.5 < y1) return true;
  for (const e of P.eyes) if (e.x + e.w > x0 && e.x - e.w < x1 && e.y + e.w > y0 && e.y - e.w < y1) return true;
  return false;
}

function drawProps(g, world, x0, yTop, k, L, seed) {
  const P = (X, Y) => [(X - x0) * k, (yTop - Y) * k];
  const span = g.canvas.width / k;
  const inRect = (ax, ay, bx, by) => bx > x0 - 1 && ax < x0 + span + 1 && by > yTop - span - 1 && ay < yTop + 1;
  for (const t of world.props.trees) {
    if (inRect(t.x - t.h, t.y - 0.5, t.x + t.h, t.y + t.h)) drawTree(g, P, k, t, L);
  }
  for (const m of world.props.mushrooms) {
    if (inRect(m.top.x - m.capR - 1, m.root.y - 1, m.top.x + m.capR + 1, m.top.y + m.capR)) drawMushroom(g, P, k, m, L, seed);
  }
}

// Fine features drawn after the repaint so they stay crisp (the lash line).
function drawPostProps(g, world, x0, yTop, k, L, seed) {
  const P = (X, Y) => [(X - x0) * k, (yTop - Y) * k];
  const span = g.canvas.width / k;
  for (const e of world.props.eyes) {
    if (e.x + e.w > x0 - 1 && e.x - e.w < x0 + span + 1 && e.y + e.w > yTop - span - 1 && e.y - e.w < yTop + 1) drawClosedEye(g, P, k, e, L, seed);
  }
}

function drawTree(g, P, k, t, L) {
  const r = rngFrom(t.seed);
  const [bx, by] = P(t.x, t.y);
  const hp = t.h * k;
  const fin = (c, y) => finishColor(c, y, L);
  // Grounding shadow where the plant meets the fur.
  dab(g, bx, by + 0.05 * k, 0.5 * hp * (t.kind === "shrub" ? 0.9 : 0.45), 0.08 * hp + 1, 0, fin(PAL.fur[1], t.y), 0.45);
  // Many small leaf dabs: dark core, sun-side highlights, muted toward the fur.
  const leaf = (lit, y) => fin(mixRGB(ramp(PAL.moss, lit), PAL.fur[1], 0.12), y);
  if (t.kind === "cypress") {
    streak(g, bx, by, 0, -1, hp * 0.2, Math.max(1, 0.05 * k), fin(hex("#4a3b3c"), t.y), 0.9);
    const n = 40 + Math.floor(t.h * 14);
    for (let i = 0; i < n; i++) {
      const yy = 0.1 + Math.pow(r(), 0.8) * 0.9;
      const half = (1 - yy) * 0.2 + 0.035;
      const ox = (r() - 0.5) * 2 * half * hp;
      const side = ox * SUN_SIDE / (half * hp + 1);
      const lit = clamp(0.12 + side * 0.35 + yy * 0.3 + (i > n * 0.75 ? 0.25 : 0) + (r() - 0.5) * 0.2, 0, 1);
      const rr = (0.022 + r() * 0.03) * hp + 0.6;
      dab(g, bx + ox, by - yy * hp, rr * 0.75, rr * 1.4, (r() - 0.5) * 0.4, leaf(lit, t.y + yy * t.h), 0.95);
    }
  } else {
    const n = 34 + Math.floor(t.h * 12);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI;
      const rad = Math.sqrt(r());
      const ox = Math.cos(a) * rad * 0.55 * hp, oy = Math.sin(a) * rad * 0.5 * hp;
      const lit = clamp(0.15 + (ox * SUN_SIDE / hp) * 0.5 + (oy / hp) * 0.6 + (i > n * 0.75 ? 0.2 : 0) + (r() - 0.5) * 0.2, 0, 1);
      const rr = (0.035 + r() * 0.04) * hp + 0.6;
      dab(g, bx + ox, by - oy, rr * 1.2, rr, (r() - 0.5) * 0.8, leaf(lit, t.y + oy / k), 0.95);
    }
  }
}

function drawMushroom(g, P, k, m, L, seed) {
  const r = rngFrom(hash2(m.root.x * 100, m.root.y * 100, seed + 41));
  const fin = (c) => finishColor(c, m.top.y, L);
  const [rx, ry] = P(m.root.x, m.root.y);
  const [tx, ty] = P(m.top.x, m.top.y);
  const cr = m.capR * k;
  const sw0 = (0.32 + m.capR * 0.05) * k, sw1 = (0.24 + m.capR * 0.04) * k;
  // Stem: lit on the sun side, lavender on the far side.
  const stem = (w0, w1, col, a, shift) => {
    g.beginPath();
    g.moveTo(rx - w0 + shift, ry);
    g.quadraticCurveTo((rx + tx) / 2 - w0 * 0.8 + shift, (ry + ty) / 2, tx - w1 + shift, ty);
    g.lineTo(tx + w1 + shift, ty);
    g.quadraticCurveTo((rx + tx) / 2 + w0 * 0.8 + shift, (ry + ty) / 2, rx + w0 + shift, ry);
    g.closePath();
    g.fillStyle = css(col, a);
    g.fill();
  };
  stem(sw0, sw1, fin(PAL.shroomStem[0]), 1, 0);
  stem(sw0 * 0.7, sw1 * 0.7, fin(PAL.shroomStem[1]), 0.95, sw1 * 0.25 * SUN_SIDE);
  stem(sw0 * 0.25, sw1 * 0.25, fin(PAL.shroomStem[2]), 0.8, sw1 * 0.55 * SUN_SIDE);
  // Moss collar where the stem roots into fur.
  for (let i = 0; i < 6; i++) {
    dab(g, rx + (r() - 0.5) * sw0 * 3, ry - r() * sw0 * 0.6, sw0 * (0.3 + r() * 0.3), sw0 * 0.22, 0, fin(mixRGB(ramp(PAL.moss, 0.2 + r() * 0.5), PAL.fur[1], 0.2)), 0.9);
  }
  const cy = ty - m.capR * 0.12 * k;
  // Gills: pale underside band with radial lines.
  dab(g, tx, cy + cr * 0.06, cr * 0.96, cr * 0.2, 0, fin(PAL.shroomGill[1]), 1);
  for (let i = 0; i < 14; i++) {
    const u = (i / 13 - 0.5) * 1.8;
    streak(g, tx + u * cr * 0.12, cy + cr * 0.14, u * 0.98, -0.12, cr * 0.4, Math.max(0.6, cr * 0.02), fin(PAL.shroomGill[0]), 0.4);
  }
  // Cap dome.
  const dome = (sx, sy, col, a) => {
    g.beginPath();
    g.moveTo(tx - cr * sx, cy);
    g.bezierCurveTo(tx - cr * sx * 0.95, cy - cr * 0.5 * sy, tx + cr * sx * 0.95, cy - cr * 0.5 * sy, tx + cr * sx, cy);
    g.quadraticCurveTo(tx, cy + cr * 0.12, tx - cr * sx, cy);
    g.closePath();
    g.fillStyle = css(col, a);
    g.fill();
  };
  dome(1, 1, fin(PAL.shroomCap[1]), 1);
  g.save();
  g.beginPath();
  g.moveTo(tx - cr, cy);
  g.bezierCurveTo(tx - cr * 0.95, cy - cr * 0.5, tx + cr * 0.95, cy - cr * 0.5, tx + cr, cy);
  g.quadraticCurveTo(tx, cy + cr * 0.12, tx - cr, cy);
  g.clip();
  // Light from the upper left: lit crown, shadowed right flank, pale rim band.
  const sun = SUN_SIDE;
  dab(g, tx + cr * 0.3 * sun, cy - cr * 0.3, cr * 0.75, cr * 0.28, 0.1 * sun, fin(PAL.shroomCap[2]), 0.85);
  dab(g, tx + cr * 0.42 * sun, cy - cr * 0.34, cr * 0.38, cr * 0.12, 0.15 * sun, fin(PAL.shroomCap[3]), 0.7);
  dab(g, tx - cr * 0.75 * sun, cy - cr * 0.05, cr * 0.5, cr * 0.3, -0.2 * sun, fin(PAL.shroomCap[0]), 0.55);
  dab(g, tx, cy + cr * 0.02, cr * 1.05, cr * 0.07, 0, fin(PAL.shroomGill[2]), 0.6);
  for (let i = 0; i < 9; i++) {
    const a = r() * 2 - 1;
    dab(g, tx + a * cr * 0.8, cy - cr * (0.08 + r() * 0.3) * (1 - a * a), cr * 0.035 + 0.5, cr * 0.025 + 0.5, 0, fin(PAL.shroomCap[3]), 0.7);
  }
  g.restore();
}

// A closed, lashed eye painted into the cranium fur.
function drawClosedEye(g, P, k, e, L, seed) {
  const fin = (c) => finishColor(c, e.y, L);
  const [cx, cy] = P(e.x, e.y);
  const w = e.w * k;
  g.save();
  g.translate(cx, cy);
  g.rotate(-e.tilt);
  g.scale(-(e.outer || -1), 1); // drawn with the outer corner on local -x
  // Socket: a lavender hollow above the lid, warm swell of the lid itself.
  for (let i = 0; i < 5; i++) dab(g, 0, w * 0.06, w * (0.58 - i * 0.07), w * (0.1 - i * 0.015), 0, fin(PAL.fur[0]), 0.05);
  // Lid crease: a tapered crescent sagging downward.
  const lw = w * 0.03;
  g.beginPath();
  g.moveTo(-w * 0.5, -w * 0.02);
  g.quadraticCurveTo(0, w * 0.13, w * 0.48, w * 0.0);
  g.quadraticCurveTo(0, w * 0.13 + lw * 2.2, -w * 0.5, -w * 0.02 + lw * 0.6);
  g.closePath();
  g.fillStyle = css(fin(PAL.lash), 0.95);
  g.fill();
  // Lashes: heavier toward the outer (left) corner.
  const r = rngFrom(seed + 77);
  for (let i = 0; i < 15; i++) {
    const u = i / 14;
    const x = lerp(-w * 0.47, w * 0.4, u);
    const yb = (1 - Math.pow((x / (w * 0.49)), 2)) * w * 0.065 - w * 0.01;
    const len = w * (0.07 + (1 - u) * 0.08 + r() * 0.02);
    const dx = -0.35 - (1 - u) * 0.35, dy = 1;
    const l = Math.hypot(dx, dy);
    g.beginPath();
    g.moveTo(x, yb);
    g.quadraticCurveTo(x + (dx / l) * len * 0.4, yb + (dy / l) * len * 0.7, x + (dx / l) * len - len * 0.15, yb + (dy / l) * len * 0.8);
    g.lineWidth = Math.max(0.8, w * 0.012 * (1.2 - u * 0.5));
    g.lineCap = "round";
    g.strokeStyle = css(fin(PAL.lash), 0.85);
    g.stroke();
  }
  g.restore();
}

// ==== module 50-atmosphere ====
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
      runSync(repaintCanvas(cg, -M, -M, scaleRepaint(BRUSH.sky, view.pr, [1, 0]), this.seed + 77));
      this.canvas = toDrawable(this.canvas);
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
function* paintCloudTile(tg, x0, yTop, k, L, world) {
  const span = tg.canvas.width / k;
  let used = false;
  for (const b of L.banks(world)) {
    const m = b.size * 1.6;
    if (b.x + m < x0 || b.x - m > x0 + span || b.y + m < yTop - span || b.y - b.size * 0.3 > yTop) continue;
    cloudBank(tg, (b.x - x0) * k, (yTop - b.y) * k, b.size * k, rngFrom(b.seed), L.fog);
    used = true;
    yield;
  }
  return used;
}

// Tile painter for the cloud sea: a lit billowing top at y = 0 over a
// lavender body that fills everything below.
function* paintCloudSeaTile(tg, x0, yTop, k, L, world) {
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
      yield;
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

// Warm glow from the sun side, a soft violet vignette and a little paper
// grain, baked once per screen size and laid over each frame in one draw.
class FinishOverlay {
  constructor() {
    this.key = "";
    this.canvas = null;
  }

  draw(g, view) {
    const key = `${view.W}|${view.H}`;
    if (key !== this.key) {
      this.key = key;
      this.canvas = makeCanvas(view.W, view.H);
      const c = this.canvas.getContext("2d");
      const sx = view.W * (0.5 + 0.4 * SUN_SIDE);
      const glow = c.createRadialGradient(sx, view.H * 0.45, 0, sx, view.H * 0.45, view.W * 1.1);
      glow.addColorStop(0, css(PAL.horizon, 0.16));
      glow.addColorStop(1, css(PAL.horizon, 0));
      c.fillStyle = glow;
      c.fillRect(0, 0, view.W, view.H);
      const v = c.createRadialGradient(view.W / 2, view.H * 0.55, view.H * 0.32, view.W / 2, view.H * 0.55, view.H * 0.85);
      v.addColorStop(0, css(PAL.fur[0], 0));
      v.addColorStop(1, css(PAL.fur[0], 0.28));
      c.fillStyle = v;
      c.fillRect(0, 0, view.W, view.H);
      const r = rngFrom(4242);
      for (let i = 0; i < (view.W * view.H) / 90; i++) {
        c.fillStyle = r() < 0.5 ? "rgba(255,245,230,0.05)" : "rgba(60,40,90,0.05)";
        c.fillRect(r() * view.W, r() * view.H, 1 + r() * view.pr, 1 + r() * view.pr);
      }
    }
    g.drawImage(this.canvas, 0, 0);
  }
}

// ==== module 55-explorer ====
// ---- Explorer figure: a small traveller, ~4 heads tall, posed by state ------
// A light skeleton (hip, neck, two-bone legs and arms) drives the painted
// shapes: idle breathing, careful walk, faster pace with forward lean, jump
// anticipation crouch, airborne tuck, landing squash and bracing. Lit by the
// same low sun as the world, with a contact shadow so the feet sit in the fur.
// Coordinates: units of the figure height, origin at the feet, y up.

function ik2(h, f, l1, l2, bend) {
  const dx = f[0] - h[0], dy = f[1] - h[1];
  const d = clamp(Math.hypot(dx, dy), 1e-4, l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return [h[0] + ux * a - uy * hh * bend, h[1] + uy * a + ux * hh * bend];
}

function drawExplorer(g, x, y, hp, facing, pose) {
  pose = pose || {};
  const E = PAL.explorer;
  const crouch = pose.crouch || 0, air = pose.air || 0, run = pose.run || 0, move = pose.move || 0;
  const ph = pose.phase || 0, t = pose.time || 0;
  const breathe = Math.sin(t * 2.1) * 0.007 * (1 - move) * (1 - air);
  const lit = SUN_SIDE * facing;

  g.save();
  g.translate(x, y);
  dab(g, -SUN_SIDE * hp * 0.05, -hp * 0.005, hp * 0.24 * (1 - air * 0.5), hp * 0.045 * (1 - air * 0.5), 0, PAL.fur[0], 0.45 * (1 - air * 0.75));
  g.scale(facing, 1);
  // Lean into the slope a little when walking uphill/downhill.
  g.rotate(-(pose.slope || 0) * 0.25 * facing);

  const P = (pts) => pts.map(([px, py]) => [px * hp, -py * hp]);
  const limb = (pts, w, col) => {
    const q = P(pts);
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]);
    g.lineWidth = w * hp;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = css(col);
    g.stroke();
  };
  const poly = (pts, col, a) => {
    const q = P(pts);
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]);
    g.closePath();
    g.fillStyle = css(col, a === undefined ? 1 : a);
    g.fill();
  };

  // Skeleton.
  const stride = 0.12 + run * 0.1;
  const bob = move * Math.abs(Math.sin(ph)) * (0.012 + run * 0.02);
  const hipY = 0.46 - crouch * 0.13 + bob + breathe - air * 0.02;
  const lean = 0.04 + run * 0.14 + move * 0.03 + (pose.brace ? 0.1 : 0) - crouch * 0.05 + air * (pose.rising ? 0.02 : -0.04);
  const hip = [0, hipY];
  const neck = [lean * 0.3, hipY + 0.29 - crouch * 0.03];
  const head = [neck[0] + 0.035 + lean * 0.12, neck[1] + 0.13];

  let feet;
  if (air) {
    feet = pose.rising ? [[0.1, hipY - 0.27], [-0.07, hipY - 0.38]] : [[0.07, hipY - 0.4], [-0.05, hipY - 0.42]];
  } else {
    feet = [0, 1].map((i) => {
      const a = ph + i * Math.PI;
      return [Math.sin(a) * stride * move + (i ? -0.035 : 0.04), Math.max(0, Math.cos(a)) * (0.045 + run * 0.06) * move];
    });
    if (crouch) feet = feet.map(([fx, fy]) => [fx + (fx >= 0 ? 0.05 : -0.05) * crouch, fy * (1 - crouch)]);
  }
  const knees = feet.map((f) => ik2(hip, f, 0.245, 0.235, 1));
  const shoulder = [neck[0] - 0.01, neck[1] - 0.03];
  const hands = [0, 1].map((i) => {
    if (air) return pose.rising ? [shoulder[0] + (i ? -0.12 : 0.16), shoulder[1] + 0.08] : [shoulder[0] + (i ? -0.16 : 0.14), shoulder[1] - 0.06];
    if (pose.brace) return [shoulder[0] + 0.18, shoulder[1] - 0.12 + i * 0.05];
    const swing = Math.sin(ph + (i ? 0 : Math.PI)) * (0.07 + run * 0.08) * move;
    return [shoulder[0] + swing - crouch * 0.08 + (i ? -0.02 : 0.03), shoulder[1] - 0.25 + crouch * 0.05 + Math.abs(swing) * 0.2];
  });
  const elbows = hands.map((h) => ik2(shoulder, h, 0.135, 0.13, -1));

  const backCol = (c) => mixRGB(c, PAL.fur[0], 0.28);
  // Back leg and arm (the far side, in shadow).
  limb([hip, knees[1], feet[1]], 0.1, backCol(E.trousers));
  limb([[feet[1][0] - 0.02, feet[1][1] + 0.025], [feet[1][0] + 0.07, feet[1][1] + 0.02]], 0.06, E.boots);
  limb([shoulder, elbows[1], hands[1]], 0.075, E.tunicShade);
  dab(g, hands[1][0] * hp, -hands[1][1] * hp, 0.034 * hp, 0.034 * hp, 0, backCol(E.skin), 1);

  // Front leg.
  limb([hip, knees[0], feet[0]], 0.105, E.trousers);
  limb([[hip[0] - 0.01, hip[1] - 0.02], [knees[0][0] - 0.012, knees[0][1]], [feet[0][0] - 0.012, feet[0][1] + 0.04]], 0.03, E.trousersLit);
  limb([[feet[0][0] - 0.02, feet[0][1] + 0.025], [feet[0][0] + 0.075, feet[0][1] + 0.02]], 0.065, E.boots);

  // Tunic: A-line from the shoulders to mid-thigh, following the torso lean.
  const ax = neck[0] - hip[0], ay = neck[1] - hip[1], al = Math.hypot(ax, ay);
  const ux = ax / al, uy = ay / al, px = uy, py = -ux;
  const at = (s, w) => [hip[0] + ux * s + px * w, hip[1] + uy * s + py * w];
  const top = al + 0.01, hem = -0.08;
  poly([at(top, -0.115), at(top, 0.11), at(hem, 0.14), at(hem, -0.15)], E.tunic);
  poly(lit < 0 ? [at(top, -0.115), at(top, -0.04), at(hem, -0.06), at(hem, -0.15)] : [at(top, 0.04), at(top, 0.11), at(hem, 0.14), at(hem, 0.06)], E.tunicLit, 0.85);
  poly(lit < 0 ? [at(top, 0.06), at(top, 0.11), at(hem, 0.14), at(hem, 0.08)] : [at(top, -0.115), at(top, -0.07), at(hem, -0.09), at(hem, -0.15)], E.tunicShade, 0.8);
  poly([at(0.05, -0.135), at(0.05, 0.125), at(0.02, 0.127), at(0.02, -0.138)], E.boots, 0.8);
  limb([at(top - 0.01, 0.09), at(0.12, -0.02), at(0.02, -0.12)], 0.02, hex("#5b3f35"));
  poly([at(0.04, -0.17), at(0.04, -0.09), at(-0.05, -0.09), at(-0.05, -0.17)], hex("#6b4a3c"));

  // Head, face toward the facing direction, tousled dark hair.
  const [hx, hy] = head;
  dab(g, (hx - 0.035) * hp, -(hy - 0.09) * hp, 0.045 * hp, 0.03 * hp, 0, E.skin, 1);
  dab(g, hx * hp, -hy * hp, 0.105 * hp, 0.115 * hp, 0, E.skin, 1);
  dab(g, (hx + 0.05) * hp, -(hy + 0.01) * hp, 0.05 * hp, 0.07 * hp, 0, E.skinLit, 0.7);
  for (const [ox, oy, rx, ry] of [[-0.06, 0.06, 0.11, 0.1], [0.02, 0.11, 0.09, 0.06], [-0.1, -0.01, 0.07, 0.09], [0.06, 0.08, 0.06, 0.045], [-0.12, 0.08, 0.05, 0.06], [-0.02, 0.14, 0.06, 0.04]]) {
    dab(g, (hx + ox) * hp, -(hy + oy) * hp, rx * hp, ry * hp, 0.2, E.hair, 1);
  }
  dab(g, (hx + (lit < 0 ? -0.1 : 0.01)) * hp, -(hy + 0.13) * hp, 0.05 * hp, 0.02 * hp, 0.3, E.hairLit, 0.8);

  // Front arm.
  limb([shoulder, elbows[0], hands[0]], 0.078, E.tunic);
  limb([[shoulder[0] + 0.01, shoulder[1]], [elbows[0][0] + 0.01, elbows[0][1]]], 0.028, lit < 0 ? E.tunicShade : E.tunicLit);
  dab(g, hands[0][0] * hp, -hands[0][1] * hp, 0.036 * hp, 0.036 * hp, 0, E.skin, 1);

  // Sun rim along the lit edge of head and back.
  g.globalAlpha = 0.55;
  dab(g, (hx + (lit < 0 ? -0.12 : 0.1)) * hp, -hy * hp, 0.02 * hp, 0.07 * hp, 0, PAL.furRim, 1);
  const rim = at(al * 0.5, lit < 0 ? -0.13 : 0.12);
  dab(g, rim[0] * hp, -rim[1] * hp, 0.018 * hp, 0.12 * hp, 0, PAL.furRim, 1);
  g.restore();
}

// ==== module 60-camera ====
// ---- Camera: portrait framing that mirrors the reference -------------------
// gameplay:     explorer ~1/14 of the screen height, 60% down, 58% across, so
//               the body mass fills the lower left and sky opens up-right.
// establishing: the title-panel shot - the same world pulled back so the head,
//               ear and closed eye loom over a tiny explorer.
// The horizon (camera height) sits at mid-screen; depth layers converge on it.

const VIEW_PRESETS = {
  gameplay: { spanHeights: 14, ex: 0.58, ey: 0.6 },
  establishing: { spanHeights: 40, focus: "head", fx: 0.6, fy: 0.45 },
  map: { spanHeights: 260, ex: 0.5, ey: 0.6 } // development only: whole-creature layout check
};

function makeView(kind, world, W, H, pr, focus) {
  const preset = VIEW_PRESETS[kind] || VIEW_PRESETS.gameplay;
  const spot = focus || world.explorerSpots[kind] || world.explorerSpots.gameplay;
  const cssH = H / pr;
  const ppm = cssH / (preset.spanHeights * EXPLORER_HEIGHT);
  const k = ppm * pr;
  // Either keep the explorer at a screen anchor, or compose on a named
  // anatomical feature (the establishing shot frames the head).
  const target = preset.focus ? world.focus[preset.focus] : spot;
  const fx = preset.focus ? preset.fx : preset.ex, fy = preset.focus ? preset.fy : preset.ey;
  return {
    kind, W, H, pr, ppm,
    horizon: H * 0.5,
    camX: target.x - (fx - 0.5) * W / k,
    camY: target.y + (fy - 0.5) * H / k,
    explorer: spot
  };
}

function worldToScreen(view, x, y, par) {
  const k = view.ppm * view.pr * (par || 1);
  return [view.W / 2 + (x - view.camX) * k, view.horizon - (y - view.camY) * k];
}

// Follows the explorer smoothly. Leads a little in the direction of travel,
// holds height through ordinary jumps (so the world does not bob), and only
// rises or drops once the explorer has truly changed level.
class FollowCamera {
  constructor(ex) {
    this.x = ex.x;
    this.y = ex.y;
    this.lead = 0;
    this.vx = 0;
    this.vy = 0;
  }

  update(dt, ex) {
    const want = clamp(ex.vx * 0.45, -1.6, 1.6);
    this.lead += (want - this.lead) * (1 - Math.exp(-dt * 1.6));
    let ty = ex.y;
    if (!ex.grounded && ex.y > ex.lastGroundY - 0.5) ty = Math.max(ex.lastGroundY, ex.y - 1.8);
    const kx = 1 - Math.exp(-dt * 3.2), ky = 1 - Math.exp(-dt * (ty < this.y ? 4.5 : 2.6));
    const px = this.x, py = this.y;
    this.x += (ex.x + this.lead - this.x) * kx;
    this.y += (ty - this.y) * ky;
    if (dt > 0) {
      this.vx += ((this.x - px) / dt - this.vx) * 0.2;
      this.vy += ((this.y - py) / dt - this.vy) * 0.2;
    }
  }

  snap(ex) {
    this.x = ex.x;
    this.y = ex.y;
    this.lead = 0;
  }
}

// ==== module 62-controls ====
// ---- Controls --------------------------------------------------------------
// Touch: hold the left or right half of the screen to move; slide that finger
// further outward to move faster. Swipe up (any finger) to jump; a finger
// that swiped up stops steering, so a second thumb can keep moving for a
// running jump. Lift every finger to stand still - stillness is a choice.
// Keyboard (testing): A/D or arrows to move, Shift to move faster,
// Space/W/Up to jump.

const SWIPE_UP_PX = 34;
const SWIPE_MS = 320;
const RUN_DRAG_PX = 46;

class Controls {
  constructor(ctx, target, onFirstGesture) {
    this.ctx = ctx;
    this.pointers = new Map();
    this.keys = new Set();
    this.jumpPressed = false;
    this.speedScale = 1;
    this.jumpScale = 1;
    this.first = onFirstGesture;
    const L = (t, ev, fn, o) => ctx.listen(t, ev, fn, o);
    L(target, "pointerdown", (e) => this.down(e));
    L(target, "pointermove", (e) => this.move(e));
    L(target, "pointerup", (e) => this.up(e));
    L(target, "pointercancel", (e) => this.up(e));
    L(window, "keydown", (e) => this.key(e, true));
    L(window, "keyup", (e) => this.key(e, false));
    L(window, "blur", () => { this.keys.clear(); this.pointers.clear(); });
    this.target = target;
  }

  gesture() {
    if (this.first) { this.first(); this.first = null; }
  }

  down(e) {
    this.gesture();
    const r = this.target.getBoundingClientRect();
    const x = e.clientX - r.left;
    this.pointers.set(e.pointerId, {
      x, y: e.clientY - r.top, sx: x, sy: e.clientY - r.top, t0: performance.now(),
      side: x < r.width / 2 ? -1 : 1, swiped: false, order: performance.now()
    });
    if (this.target.setPointerCapture) {
      try { this.target.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const r = this.target.getBoundingClientRect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    if (!p.swiped && p.sy - p.y > SWIPE_UP_PX && performance.now() - p.t0 < SWIPE_MS && Math.abs(p.x - p.sx) < (p.sy - p.y) * 1.2) {
      p.swiped = true;
      this.jumpPressed = true;
    }
    if (p.swiped && Math.abs(p.x - p.sx) > 30) p.swiped = false; // dragged sideways: steer again
  }

  up(e) {
    this.pointers.delete(e.pointerId);
  }

  key(e, isDown) {
    const k = e.key.toLowerCase();
    const known = ["arrowleft", "arrowright", "arrowup", "a", "d", "w", " ", "shift"];
    if (!known.includes(k)) return;
    if (e.preventDefault) e.preventDefault();
    if (isDown) {
      this.gesture();
      if ((k === " " || k === "w" || k === "arrowup") && !e.repeat) this.jumpPressed = true;
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
  }

  // Current steering: the most recent active finger wins, else the keyboard.
  get dir() {
    let best = null;
    for (const p of this.pointers.values()) {
      if (p.swiped) continue;
      if (performance.now() - p.t0 < 70 && Math.abs(p.x - p.sx) < 12) continue; // could still become a swipe
      if (!best || p.order > best.order) best = p;
    }
    if (best) return best.side;
    const l = this.keys.has("arrowleft") || this.keys.has("a");
    const r = this.keys.has("arrowright") || this.keys.has("d");
    return l === r ? 0 : l ? -1 : 1;
  }

  get run() {
    for (const p of this.pointers.values()) {
      if (!p.swiped && (p.x - p.sx) * p.side > RUN_DRAG_PX) return true;
    }
    return this.keys.has("shift");
  }

  consume() {
    this.jumpPressed = false;
  }

  // Active touches (for the faint on-screen touch marks).
  touches() {
    return [...this.pointers.values()];
  }
}

// ==== module 64-explorer-physics ====
// ---- Explorer controller: grounded movement on the creature's body ----------
// Collides against the play anatomy's signed-distance field - the same field
// the painter fills - so the explorer stands exactly where fur is painted.
// Shape: a feet circle and a body circle. Grounded movement follows the
// surface tangent; walkable slopes are limited; small bumps are rolled over;
// ledges need a jump. World units are metres and seconds.

const PHYS = {
  gravity: 26,
  walk: 1.7, // careful pace
  run: 3.8, // faster pace (noisier, in Stage 3)
  accel: 11,
  brake: 16,
  airAccel: 5,
  jumpHeight: 2.1,
  maxFall: 22,
  walkableNy: 0.55, // surface normal y above this is ground (~57 degrees)
  feetR: 0.27,
  bodyR: 0.3,
  bodyY: 0.98,
  coyote: 0.1,
  jumpBuffer: 0.14,
  anticipation: 0.085,
  landTime: 0.16,
  snapDown: 0.45,
  fallReset: 28
};

// Height of a mushroom cap's top at x, or null beyond its rim.
function capTop(c, x) {
  const u = (x - c.x) / (c.a * 0.94);
  return Math.abs(u) < 1 ? c.y + c.b * Math.sqrt(1 - u * u) : null;
}

class Explorer {
  constructor(anat, spot, caps) {
    this.anat = anat;
    this.caps = caps || [];
    this.o = {};
    this.cullAt = null;
    this.prims = [];
    this.reset(spot);
  }

  reset(spot) {
    this.x = spot.x; this.y = spot.y;
    this.vx = 0; this.vy = 0;
    this.nx = 0; this.ny = 1;
    this.grounded = true;
    this.onCap = null;
    this.facing = spot.facing || -1;
    this.state = "idle";
    this.time = 0; this.phase = 0;
    this.anticipate = 0; this.landT = 0; this.landImpact = 0;
    this.coyoteT = 0; this.bufferT = 0; this.airLock = 0;
    this.lastGroundY = spot.y;
    this.safe = { x: spot.x, y: spot.y, facing: this.facing };
    this.safeT = 0;
    this.events = []; // landings / launches for feedback (and Stage 3 noise)
  }

  // Field queries, with a primitive cull cached around the explorer.
  sd(x, y) {
    if (!this.cullAt || Math.abs(x - this.cullAt.x) > 4 || Math.abs(y - this.cullAt.y) > 4) {
      this.cullAt = { x, y };
      this.prims = this.anat.cull(x - 10, y - 10, x + 10, y + 10);
    }
    return this.anat.eval(x, y, this.prims, this.o).sd;
  }

  normal(x, y) {
    const e = 0.02;
    const gx = this.sd(x + e, y) - this.sd(x - e, y);
    const gy = this.sd(x, y + e) - this.sd(x, y - e);
    const l = Math.hypot(gx, gy) || 1;
    return [gx / l, gy / l];
  }

  // Push both circles out of the body; drop velocity into surfaces. Returns
  // the walkable normal under the feet, if any.
  resolve() {
    let ground = null;
    for (let iter = 0; iter < 5; iter++) {
      let moved = false;
      for (const [oy, r, isFeet] of [[PHYS.feetR, PHYS.feetR, true], [PHYS.bodyY, PHYS.bodyR, false]]) {
        const d = this.sd(this.x, this.y + oy) - r;
        if (d >= 0) continue;
        const [nx, ny] = this.normal(this.x, this.y + oy);
        this.x -= nx * d; this.y -= ny * d;
        const vn = this.vx * nx + this.vy * ny;
        if (vn < 0) { this.vx -= nx * vn; this.vy -= ny * vn; }
        if (isFeet && ny > this.walkLimit()) ground = [nx, ny];
        moved = true;
      }
      if (!moved) break;
    }
    return ground;
  }

  // Hysteresis: a steep face must be clearly walkable to land on, but once
  // standing, the explorer keeps footing on it (no flicker at the limit).
  walkLimit() {
    return this.grounded ? PHYS.walkableNy - 0.08 : PHYS.walkableNy;
  }

  probeGround(dist) {
    for (const c of this.caps) {
      const t = capTop(c, this.x);
      if (t !== null && this.y >= t - 0.02 - dist && this.y <= t + 0.02) { this.y = Math.max(this.y, t); this.onCap = c; return [0, 1]; }
    }
    const r = PHYS.feetR;
    if (this.sd(this.x, this.y + r - dist) < r + 0.005) {
      const n = this.normal(this.x, this.y + r - dist);
      if (n[1] > this.walkLimit()) return n;
    }
    return null;
  }

  step(dt, input) {
    this.time += dt;
    this.coyoteT -= dt; this.bufferT -= dt; this.landT -= dt; this.airLock -= dt;
    if (input.jumpPressed) this.bufferT = PHYS.jumpBuffer;
    const run = input.run && input.dir !== 0;
    const target = input.dir * (run ? PHYS.run : PHYS.walk) * (input.speedScale || 1);
    if (input.dir) this.facing = Math.sign(input.dir);
    const wasGrounded = this.grounded;

    // Jump: anticipation crouch first, then launch.
    if (this.anticipate > 0) {
      this.anticipate -= dt;
      this.vx *= Math.exp(-12 * dt);
      if (this.anticipate <= 0) {
        this.vy = Math.sqrt(2 * PHYS.gravity * PHYS.jumpHeight * (input.jumpScale || 1));
        this.vx = this.vx * 0.6 + target * 0.55;
        this.grounded = false;
        this.coyoteT = 0;
        this.airLock = 0.12; // just launched: the feet still touch the fur
        this.events.push({ type: "launch", speed: Math.abs(this.vx) });
      }
    } else if (this.bufferT > 0 && (this.grounded || this.coyoteT > 0)) {
      this.anticipate = PHYS.anticipation;
      this.bufferT = 0;
    }

    if (this.grounded && this.anticipate <= 0) {
      // Move along the surface tangent; uphill is slower on steep fur.
      const tx = this.ny, ty = -this.nx;
      let s = this.vx * tx + this.vy * ty;
      const uphill = ty * Math.sign(target) > 0;
      const tgt = target * (uphill ? 1 - clamp((1 - this.ny) * 1.1, 0, 0.45) : 1);
      const rate = Math.abs(tgt) > Math.abs(s) && Math.sign(tgt) === Math.sign(s || tgt) ? PHYS.accel : PHYS.brake;
      s = s + clamp(tgt - s, -rate * dt, rate * dt);
      if (tgt === 0 && Math.abs(s) < 0.05) s = 0; // at rest: no creep on slopes
      this.vx = tx * s; this.vy = ty * s;
    } else if (this.anticipate <= 0) {
      this.vx += clamp(target - this.vx, -PHYS.airAccel * dt, PHYS.airAccel * dt);
      this.vy = Math.max(this.vy - PHYS.gravity * dt, -PHYS.maxFall);
    }

    // Integrate in small substeps so fast falls never tunnel through fur.
    const vyBefore = this.vy;
    const n = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 0.08));
    let ground = null, wall = false, blocked = false;
    const walking = wasGrounded && this.anticipate <= 0;
    for (let i = 0; i < n; i++) {
      const px = this.x, py = this.y;
      this.x += (this.vx * dt) / n;
      this.y += (this.vy * dt) / n;
      let gnd = this.resolve();
      if (this.vy <= 0.01) {
        for (const c of this.caps) {
          const t = capTop(c, this.x);
          if (t !== null && py >= t - 0.04 && this.y <= t + 0.01) {
            this.y = t; this.vy = Math.max(this.vy, 0); this.onCap = c; gnd = [0, 1];
          }
        }
      }
      // On foot, never step onto ground too steep to stand on (the curve up
      // into a riser): stop at its foot instead of sliding back and forth.
      if (walking && !this.onCap && this.vy >= -0.5) {
        const climbingSteep = gnd && gnd[1] < PHYS.walkableNy && this.y > py + 1e-4;
        const steep = !gnd && !this.probeGround(0.08) && this.sd(this.x, this.y + PHYS.feetR) < PHYS.feetR + 0.06;
        if (climbingSteep || steep) { this.x = px; this.y = py; this.vx = 0; this.vy = 0; blocked = true; ground = [this.nx, this.ny]; break; }
      }
      if (gnd) ground = gnd;
    }
    if (blocked) this.blockedT = (this.blockedT || 0) + dt; else this.blockedT = 0;
    // Ground checks: always while walking (uphill walking has upward speed
    // too); never in the instant after a launch; when airborne only on the way down.
    const mayGround = this.airLock <= 0 && (walking || this.vy <= 0.5);
    if (this.airLock > 0 && this.vy > 0) ground = null;
    if (!ground && mayGround) ground = this.probeGround(0.04);
    // Stick to the ground over crests and down gentle slopes instead of hopping.
    if (!ground && walking && mayGround) {
      for (let d = 0.05; d <= PHYS.snapDown; d += 0.05) {
        const g = this.probeGround(d);
        if (g) { this.y -= d - 0.01; this.resolve(); ground = g; break; }
      }
    }
    // Touching a steep wall while airborne: friction instead of a free slide.
    if (!ground && this.sd(this.x, this.y + PHYS.feetR) < PHYS.feetR + 0.03) {
      wall = true;
      this.vy = Math.max(this.vy, -5);
    }

    this.grounded = !!ground;
    if (!ground) this.onCap = null;
    if (ground && !this.onCap) {
      const gap = this.sd(this.x, this.y + PHYS.feetR) - PHYS.feetR;
      if (gap > 0.002 && gap < 0.12) this.y -= gap;
    }
    if (ground) {
      [this.nx, this.ny] = ground;
      this.coyoteT = PHYS.coyote;
      this.lastGroundY = this.y;
      if (!wasGrounded) {
        const impact = Math.max(0, -vyBefore);
        this.landImpact = impact;
        this.landT = PHYS.landTime * clamp(impact / 9, 0.35, 1.5);
        this.events.push({ type: "land", impact });
        const vn = this.vx * this.nx + this.vy * this.ny;
        this.vx -= this.nx * vn; this.vy -= this.ny * vn;
        this.vx *= impact > 10 ? 0.3 : 0.75;
      }
      // Remember a safe spot to return to after a fall.
      this.safeT += dt;
      if (this.safeT > 0.4 && this.ny > 0.8 && Math.abs(this.vx) < 2.5) {
        this.safe = { x: this.x, y: this.y, facing: this.facing };
        this.safeT = 0;
      }
    } else {
      this.safeT = 0;
    }

    // Walk-cycle phase advances with distance travelled.
    const speed = Math.hypot(this.vx, this.vy);
    if (this.grounded) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += (speed * dt / (run ? 0.62 : 0.42)) * Math.PI;
      // A footfall each half stride: the noise system listens for these.
      if (Math.floor(this.phase / Math.PI) !== before) this.events.push({ type: "step", run, speed });
    }

    if (this.anticipate > 0) this.state = "anticipate";
    else if (!this.grounded) this.state = wall ? "brace" : "air";
    else if (this.landT > 0) this.state = "land";
    else if (speed > 0.25) this.state = run && speed > PHYS.walk * 1.15 ? "run" : "walk";
    else this.state = "idle";

    if (this.y < this.lastGroundY - PHYS.fallReset) {
      this.events.push({ type: "fell" });
      this.reset(this.safe);
    }
  }

  // What the feet are on: "cap", "skin", "ear", "moss" or "fur". Moss is the
  // same patch mask the painter uses, so painted moss really is quieter.
  surface(mossSeed) {
    if (this.onCap) return "cap";
    this.sd(this.x, this.y - 0.05);
    const m = this.o.mat;
    if (m === MAT_SKIN) return "skin";
    if (m === MAT_EAR) return "ear";
    if (mossSeed !== undefined && fbm(this.x * 0.09, this.y * 0.09, mossSeed + 29, 3) > 0.6 && this.ny > 0.45) return "moss";
    return "fur";
  }

  // Everything the renderer needs to pose the figure.
  pose() {
    const speed = Math.hypot(this.vx, this.vy);
    const s = this.state;
    return {
      state: s,
      time: this.time,
      phase: this.phase,
      move: this.grounded ? clamp(speed / PHYS.walk, 0, 1) : 0,
      run: clamp((speed - PHYS.walk) / (PHYS.run - PHYS.walk), 0, 1),
      crouch: s === "anticipate" ? 1 : s === "land" ? clamp(this.landT / PHYS.landTime, 0, 1) * clamp(this.landImpact / 9, 0.4, 1) : 0,
      air: this.grounded ? 0 : 1,
      rising: this.vy > 0,
      brace: s === "brace",
      slope: this.grounded ? Math.atan2(-this.nx, this.ny) : 0
    };
  }
}

// ==== module 66-alertness ====
// ---- Alertness: the beast hears every step ---------------------------------
// One continuous level, 0 (deep sleep) .. 1 (awake). Noise comes from the
// explorer's footsteps, launches and landings, scaled by what the feet are on
// (moss is soft, mushroom caps spring, the ears and face are sensitive) and
// by height - the closer to the head, the lighter the sleep.
// Stillness lets it settle, slowly, down to a floor that rises with every
// disturbance the beast remembers, so waiting can never erase all tension.
//
//   DEEP SLEEP  < 0.3   slow breathing, quiet, still fur
//   DISTURBED   < 0.62  quicker breath, fur ripples, small reactions
//   STIRRING    < 1     heaving body, falling dust, wind - the warning
//   AWAKE       = 1     irreversible: the awakening begins

const NOISE = {
  stepCareful: 0.0016,
  stepRun: 0.0085,
  launch: 0.004,
  landSoft: 0.012, // an ordinary jump landing on fur
  landPerSpeed: 0.006, // extra per m/s of impact above 5 m/s
  hardFall: 0.16, // impact above 12 m/s
  surface: { fur: 1, moss: 0.55, cap: 0.7, skin: 2.2, ear: 2.6 },
  recoverPerSec: 0.03,
  stillAfter: 0.7, // seconds of stillness before the beast starts to settle
  memory: 0.14, // share of each noise that raises the floor
  floorMax: 0.42,
  disturbed: 0.3,
  stirring: 0.62
};

const ALERT_STATES = ["sleep", "disturbed", "stirring", "awake"];

class Alertness {
  constructor(world) {
    this.world = world;
    this.mossSeed = world.seed + 100;
    this.rng = rngFrom(world.seed + 5);
    this.reset();
  }

  reset() {
    this.level = 0;
    this.floor = 0;
    this.still = 0;
    this.state = "sleep";
    this.breath = 0; // breathing phase (radians)
    this.heave = 0; // current body rise (m)
    this.hitch = 0; // a caught breath while stirring
    this.pulses = []; // recent noises, for fur ripples and footstep rings
    this.time = 0;
  }

  // Sleep grows lighter toward the head, and the face itself is sensitive.
  get sensitivity() {
    return 1 + clamp(this.explorerY / 320, 0, 1) * 0.8 + (this.nearHead ? 0.8 : 0);
  }

  noise(amount, ex, surface) {
    if (this.state === "awake" || amount <= 0) return;
    const n = amount * (NOISE.surface[surface] || 1) * this.sensitivity * (this.scale || 1);
    this.level = Math.min(1, this.level + n);
    this.floor = Math.min(NOISE.floorMax, this.floor + n * NOISE.memory);
    this.still = 0;
    this.pulses.push({ x: ex.x, y: ex.y, amount: n, surface, t: this.time });
    if (this.pulses.length > 24) this.pulses.shift();
  }

  update(dt, ex, input) {
    this.time += dt;
    this.explorerY = ex.y;
    const h = this.world.focus.head;
    this.nearHead = Math.hypot(ex.x - h.x, ex.y - h.y) < 18;
    const surface = ex.grounded ? ex.surface(this.mossSeed) : "fur";

    for (const e of ex.events) {
      if (e.type === "step") this.noise(e.run ? NOISE.stepRun : NOISE.stepCareful, ex, surface);
      else if (e.type === "launch") this.noise(NOISE.launch, ex, surface);
      else if (e.type === "fell") this.noise(NOISE.hardFall * 1.5, ex, "fur");
      else if (e.type === "land") {
        const extra = Math.max(0, e.impact - 5) * NOISE.landPerSpeed;
        this.noise(NOISE.landSoft + extra + (e.impact > 12 ? NOISE.hardFall : 0), ex, surface);
      }
    }

    // Stillness: no input, standing on something. Settling is slow, slower
    // still once the beast is stirring, and never below the remembered floor.
    const idle = ex.grounded && input.dir === 0 && Math.hypot(ex.vx, ex.vy) < 0.1;
    this.still = idle ? this.still + dt : 0;
    if (this.state !== "awake" && this.still > NOISE.stillAfter) {
      const rate = NOISE.recoverPerSec * (this.recovery || 1) * (this.level > NOISE.stirring ? 0.55 : 1);
      this.level = Math.max(this.floor, this.level - rate * dt);
    }

    const prev = this.state;
    if (this.level >= 1) this.state = "awake";
    else if (this.state !== "awake") {
      this.state = this.level >= NOISE.stirring ? "stirring" : this.level >= NOISE.disturbed ? "disturbed" : "sleep";
    }
    if (prev !== this.state) this.changed = { from: prev, to: this.state, t: this.time };

    // Breathing: slow and deep asleep, quicker and shallower when disturbed,
    // heaving with caught breaths when stirring.
    const a = this.level;
    const period = lerp(6.5, 2.8, smoothstep(0.1, 0.9, a));
    if (this.state === "stirring" && this.hitch <= 0 && this.rng() < dt * 0.25) this.hitch = 0.9;
    this.hitch -= dt;
    if (this.hitch <= 0) this.breath += (dt / period) * Math.PI * 2;
    const amp = lerp(0.05, 0.2, smoothstep(0.2, 0.95, a));
    this.heave = Math.sin(this.breath) * amp;
  }

  // 0..1 intensity of a band, for effects.
  get stir() {
    return smoothstep(NOISE.disturbed, 1, this.level);
  }
}

// ==== module 68-life ====
// ---- Life: the beast reacting, drawn live over the painted world -----------
// - Live fur: tufts along the silhouette near the explorer that sway in the
//   wind, ripple outward from each noise (with a slight delay, like fur) and
//   bristle as the beast stirs; still and calm when it sleeps.
// - Footstep rings: soft rings on the fur, sized by how loud a step was, so
//   the player learns what is quiet without a meter.
// - Dust and pebbles shaken loose while stirring; spores puffed from caps.
// - A violet edge-darkening that grows as the beast nears waking.
// All bounded: tufts rebuilt only when the camera moves, particles capped.

class Life {
  constructor(world) {
    this.world = world;
    this.anat = world.layers.play;
    this.tufts = [];
    this.tuftKey = "";
    this.parts = [];
    this.rng = rngFrom(world.seed + 4242);
    this.time = 0;
    this.lastPulse = 0;
  }

  // Tufts along the walkable silhouette around the explorer (rebuilt per 3 m
  // cell of travel, over a small window, so it stays cheap).
  rebuildTufts(view, ex) {
    const key = `${Math.round(ex.x / 3)}|${Math.round(ex.y / 3)}`;
    if (key === this.tuftKey) return;
    this.tuftKey = key;
    const segs = collisionSegments(this.anat, ex.x - 7, ex.y - 4, ex.x + 7, ex.y + 5, 0.4);
    const tufts = [];
    for (const s of segs) {
      if (s.ny < 0.35) continue; // walkable ground only, not risers
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      const r = rngFrom(hash2(Math.round(mx * 10), Math.round(my * 10), this.world.seed + 61));
      if (r() < 0.5) continue;
      const nx = s.nx, ny = s.ny; // outward surface normal
      const lit = clamp(0.35 + nx * LIGHT2[0] * 0.5 + ny * LIGHT2[1] * 0.5 + (r() - 0.5) * 0.25, 0, 1);
      tufts.push({ x: mx - nx * 0.05, y: my - ny * 0.05, nx, ny, len: 0.16 + r() * 0.16, w: 0.05 + r() * 0.03, col: ramp(PAL.fur, 0.3 + lit * 0.45), phase: r() * 6.28 });
    }
    this.tufts = tufts;
  }

  update(dt, alert, ex, view) {
    this.time += dt;
    const stir = alert.stir;
    // Spores when landing on a cap; dust motes and pebbles while stirring.
    for (const p of alert.pulses) {
      if (p.t <= this.lastPulse) continue;
      if (p.surface === "cap") for (let i = 0; i < 10; i++) this.spawn("spore", p.x + (this.rng() - 0.5) * 0.8, p.y + 0.1, (this.rng() - 0.5) * 0.6, 0.4 + this.rng() * 0.6);
      this.lastPulse = p.t;
    }
    if (view) {
      const k = view.ppm * view.pr, hw = view.W / 2 / k, hh = view.H / 2 / k;
      const rate = stir * stir * 26 + (alert.state === "awake" ? 60 : 0);
      for (let n = this.rng() < (rate * dt) % 1 ? 1 : 0, i = 0; i < Math.floor(rate * dt) + n; i++) {
        const x = view.camX + (this.rng() - 0.5) * hw * 2.2, y = view.camY + hh + 1;
        this.spawn(this.rng() < 0.25 ? "pebble" : "dust", x, y, (this.rng() - 0.3) * 0.6, -0.5 - this.rng());
      }
    }
    for (const p of this.parts) {
      p.age += dt;
      if (p.kind === "pebble") p.vy -= 14 * dt;
      else p.vy += ((p.kind === "spore" ? 0.15 : -0.6) - p.vy) * dt * 1.5;
      p.vx += (Math.sin(this.time * 0.7 + p.y * 0.3) * 0.4 * (0.3 + stir) - p.vx) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  spawn(kind, x, y, vx, vy) {
    if (this.parts.length > 140) return;
    const life = kind === "spore" ? 1.6 + this.rng() : kind === "pebble" ? 2.5 : 4 + this.rng() * 2;
    this.parts.push({ kind, x, y, vx, vy, age: 0, life, s: kind === "pebble" ? 0.035 + this.rng() * 0.035 : 0.03 + this.rng() * 0.04 });
  }

  // Under the explorer: swaying fur and footstep rings.
  drawGround(g, view, alert, ex) {
    this.rebuildTufts(view, ex);
    const k = view.ppm * view.pr, t = this.time, stir = alert.stir;
    for (const tf of this.tufts) {
      const [sx, sy] = worldToScreen(view, tf.x, tf.y, 1);
      if (sx < -40 || sx > view.W + 40 || sy < -40 || sy > view.H + 40) continue;
      let sway = Math.sin(t * (1.1 + stir * 2.5) + tf.phase + tf.x * 0.6) * (0.08 + stir * 0.35);
      for (const p of alert.pulses) {
        const age = t - p.t;
        if (age < 0 || age > 1.6) continue;
        const front = age * 5; // ripple travels ~5 m/s along the fur
        const d = Math.hypot(tf.x - p.x, tf.y - p.y);
        sway += Math.exp(-((d - front) * (d - front)) / 0.6) * Math.exp(-age * 2) * Math.min(0.9, p.amount * 70);
      }
      // Lean downslope like the painted fur, plus the sway.
      // Lie mostly along the slope (downhill), lifting with the sway.
      let dx = tf.nx * 0.35 + tf.ny * 0.75 * SUN_SIDE, dy = tf.ny * 0.35 - tf.nx * 0.75 * SUN_SIDE - 0.2;
      const ca = Math.cos(sway), sa = Math.sin(sway);
      [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
      const l = Math.hypot(dx, dy) || 1;
      drawLock(g, sx, sy, dx / l, -dy / l, tf.len * k, tf.w * k, sway * 0.3, tf.col, 0.7);
    }
    for (const p of alert.pulses) {
      const age = t - p.t;
      if (age < 0 || age > 0.9 || p.amount < 0.0015) continue;
      const [sx, sy] = worldToScreen(view, p.x, p.y, 1);
      const r = (0.25 + age * (1.2 + p.amount * 90)) * k;
      const a = Math.min(0.5, p.amount * 30) * (1 - age / 0.9);
      g.beginPath();
      g.ellipse(sx, sy, r, r * 0.32, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.lineWidth = Math.max(1, 0.05 * k);
      g.strokeStyle = css(mixRGB([255, 244, 228], [255, 170, 150], alert.stir), a);
      g.stroke();
    }
  }

  // Over everything in the body group: dust, pebbles, spores.
  drawAir(g, view) {
    const k = view.ppm * view.pr;
    for (const p of this.parts) {
      const [sx, sy] = worldToScreen(view, p.x, p.y, 1);
      const fade = Math.min(1, p.age * 3) * (1 - p.age / p.life);
      const col = p.kind === "pebble" ? hex("#a8868a") : p.kind === "spore" ? hex("#ffe6a8") : hex("#fbe6d4");
      dab(g, sx, sy, p.s * k, p.s * k * (p.kind === "dust" ? 0.7 : 1), 0, col, (p.kind === "pebble" ? 0.75 : 0.6) * fade);
    }
  }

  // The warning at the edges of the screen.
  drawWarning(g, view, alert) {
    const w = smoothstep(0.45, 1, alert.level) * (0.75 + 0.25 * Math.sin(alert.breath));
    if (w <= 0.01) return;
    const v = g.createRadialGradient(view.W / 2, view.H * 0.55, view.H * 0.25, view.W / 2, view.H * 0.55, view.H * 0.75);
    v.addColorStop(0, css(PAL.fur[0], 0));
    v.addColorStop(1, css([46, 30, 70], 0.55 * w));
    g.fillStyle = v;
    g.fillRect(0, 0, view.W, view.H);
  }
}

// ==== module 70-scene ====
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

// ==== module 90-main ====
// ---- Bit entry -------------------------------------------------------------
// Beast. Stage 3 (alertness): the explorer climbs the sleeping beast's body;
// every step, launch and landing makes noise; the beast breathes, stirs and
// settles; stillness lets it calm, slowly, never fully. Interface stays
// hidden; the world itself is the feedback.

const WORLD_SEED = 7331;
// Painting gets what is left of a ~14 ms frame after drawing (3-10 ms).
const FRAME_TARGET_MS = 14;

window.plethoraBit = {
  meta: {
    title: "Beast",
    runtime: "plethora-bit@2",
    tags: ["adventure", "climbing", "atmospheric"],
    permissions: []
  },

  async init(ctx) {
    const canvas = ctx.createCanvas2D({ maxDpr: 2, alpha: false, layer: "content", touchAction: "none" });
    canvasFallback = () => {
      const c = ctx.createCanvas2D({ layer: "background", input: "passthrough" });
      c.style.display = "none";
      return c;
    };
    const g = canvas.getContext("2d");
    const tune = ctx.tune;
    const knob = (id, d) => {
      const v = tune && tune.has(id) ? tune.get(id) : undefined;
      return v === undefined || v === null ? d : v;
    };
    const DEFAULT_PHYS = { walk: PHYS.walk, run: PHYS.run, jumpHeight: PHYS.jumpHeight };
    const applyNoise = () => {
      if (!alert) return;
      alert.scale = knob("noise_scale", 1);
      alert.recovery = knob("recovery_rate", 1);
    };
    const applyPhys = () => {
      PHYS.walk = DEFAULT_PHYS.walk * knob("walk_speed", 1);
      PHYS.run = DEFAULT_PHYS.run * knob("run_speed", 1);
      PHYS.jumpHeight = DEFAULT_PHYS.jumpHeight * knob("jump_height", 1);
    };

    let stage = "world";
    let world, scene, ex, cam, alert, life;
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    const startSpot = () => {
      const s = knob("start", "back");
      return s === "base" ? world.explorerSpots.base : s === "head" ? world.explorerSpots.establishing : world.explorerSpots.gameplay;
    };
    const currentView = () => {
      const pr = canvas.width / Math.max(1, ctx.width);
      const v = makeView("gameplay", world, canvas.width, canvas.height, pr, { x: cam.x, y: cam.y });
      // Where the camera will be in ~0.8 s, in screen px of the play layer.
      const k = v.ppm * v.pr;
      v.aheadX = clamp(cam.vx * 0.8, -6, 6) * k;
      v.aheadY = -clamp(cam.vy * 0.8, -6, 6) * k;
      return v;
    };

    try {
      applyPhys();
      world = buildWorld(WORLD_SEED);
      scene = new Scene(world);
      stage = "explorer";
      ex = new Explorer(world.layers.play, startSpot(), world.props.mushrooms.map((m) => m.cap));
      cam = new FollowCamera(ex);
      alert = new Alertness(world);
      life = new Life(world);
      stage = "first-frame";
      scene.prepare(currentView(), ex); // paint everything the first frame needs
      scene.sched.syncMs = 0;
      scene.sched.syncCount = 0;
    } catch (err) {
      ctx.platform.error({ stage, message: String((err && err.message) || err) });
      throw err;
    }

    const controls = new Controls(ctx, canvas, () => ctx.platform.start());
    applyNoise();

    // Temporary stand-in for the awakening (Stage 6 builds the real
    // sequence): the body heaves, one impact, the explorer loses footing,
    // the world fades into mist, and the climb restarts.
    let wake = null, shake = 0, fade = 0;
    const still = { dir: 0, run: false, jumpPressed: false };
    const restart = () => {
      ex.reset(startSpot());
      alert.reset();
      cam.snap(ex);
      life.parts.length = 0;
      wake = null;
    };

    let lastView = null;
    const draw = () => {
      if (disposed || !canvas.width || !canvas.height) return;
      const view = currentView();
      if (shake > 0.01) {
        view.camX += Math.sin(alert.time * 47) * shake * 0.35;
        view.camY += Math.cos(alert.time * 39) * shake * 0.25;
      }
      lastView = view;
      scene.render(g, view, {
        explorer: { x: ex.x, y: ex.y, facing: ex.facing, pose: ex.pose() },
        collision: !!knob("collision_overlay", false),
        alert,
        life
      });
      if (fade > 0.001) {
        g.fillStyle = css(PAL.mistWarm, fade);
        g.fillRect(0, 0, view.W, view.H);
      }
      if (knob("show_alertness", false)) {
        const s = view.pr;
        g.font = `${12 * s}px sans-serif`;
        g.fillStyle = "rgba(40,30,60,0.75)";
        g.fillText(`${alert.state} ${alert.level.toFixed(2)}  floor ${alert.floor.toFixed(2)}  height ${ex.y.toFixed(0)} m`, 12 * s, (ctx.safeArea.top + 22) * s);
      }
      // Faint marks where fingers are held: feedback without a HUD.
      for (const p of controls.touches()) {
        const s = view.pr;
        dab(g, p.sx * s, p.sy * s, 22 * s, 22 * s, 0, [255, 244, 228], 0.12);
        dab(g, p.x * s, p.y * s, 7 * s, 7 * s, 0, [255, 244, 228], 0.28);
      }
      if (globalThis.__dwProfile) {
        globalThis.__dwState = {
          x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy, grounded: ex.grounded, state: ex.state,
          feetSd: ex.sd(ex.x, ex.y + PHYS.feetR) - PHYS.feetR, bodySd: ex.sd(ex.x, ex.y + PHYS.bodyY) - PHYS.bodyR,
          pending: scene.sched.jobs.size, syncMs: scene.sched.syncMs || 0, syncCount: scene.sched.syncCount || 0,
          alert: alert.level, alertState: alert.state, floor: alert.floor
        };
        globalThis.__dwAlert = alert; // test harness only (profile flag)
      }
    };

    ctx.game.loop({
      fixedHz: 120,
      maxSubsteps: 8,
      fixedUpdate: (stepMs) => {
        ex.step(stepMs / 1000, wake ? still : controls);
        controls.consume();
      },
      update: (dtMs) => {
        const dt = Math.min(dtMs, 100) / 1000;
        cam.update(dt, ex);
        alert.update(dt, ex, wake ? still : controls);
        if (alert.state === "awake" && !wake) wake = { t: 0, hit: false };
        if (wake) {
          wake.t += dt;
          alert.heave = Math.sin(wake.t * 3.4) * 0.9 * smoothstep(0, 0.6, wake.t);
          if (!wake.hit && wake.t > 1) {
            wake.hit = true;
            shake = 1;
            ex.vx = -ex.facing * 2.5;
            ex.vy = 7;
            ex.grounded = false;
            ex.airLock = 0.3;
          }
          fade = smoothstep(1.9, 2.9, wake.t);
          // Paint the restart point while the world fades, so the cut is clean.
          if (wake.t > 0.8 && lastView) {
            const s = startSpot();
            const v = makeView("gameplay", world, lastView.W, lastView.H, lastView.pr, { x: s.x, y: s.y });
            scene.paintAhead(v);
          }
          if (wake.t > 3.1) restart();
        } else {
          fade = Math.max(0, fade - dt * 1.2);
        }
        shake *= Math.exp(-dt * 5);
        life.update(dt, alert, ex, lastView);
        ex.events.length = 0;
      },
      render: () => {
        const t0 = performance.now();
        draw();
        const t1 = performance.now();
        scene.sched.pump(clamp(FRAME_TARGET_MS - (t1 - t0), 3, 10));
        if (globalThis.__dwProfile) {
          const p = (globalThis.__dwPerf = globalThis.__dwPerf || { n: 0, draw: 0, pump: 0, maxDraw: 0, maxPump: 0 });
          const d = t1 - t0, q = performance.now() - t1;
          p.n++; if (d > 40) (p.spikes = p.spikes || []).push([p.n, Math.round(d)]); p.draw += d; p.pump += q; p.maxDraw = Math.max(p.maxDraw, d); p.maxPump = Math.max(p.maxPump, q);
        }
      }
    });

    if (tune) {
      tune.onChange(["start"], () => { ex.reset(startSpot()); cam.snap(ex); });
      tune.onChange(["walk_speed", "run_speed", "jump_height"], applyPhys);
      tune.onChange(["noise_scale", "recovery_rate"], applyNoise);
    }
    draw();
    ctx.markVisualReady("first-frame");
    ctx.platform.ready();
  }
};

// Test hook: lets offline tools drive the world and controller headlessly.
if (typeof globalThis.__dwTestHook === "function") {
  globalThis.__dwTestHook({ buildWorld, Explorer, PHYS, WORLD_SEED, Alertness, NOISE });
}

})();
