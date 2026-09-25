"use strict";

/* ==========================================================================
   RESONANCE
   A field of luminous matter that answers touch with real waves.

   Structure
   1. Field      - 2D damped wave equation on a coarse grid (the physics)
   2. Levels     - hidden "solutions" that are simulated to produce targets
   3. Scoring    - long-exposure interference maps compared by similarity
   4. Bit        - WebGL light renderer, particles, input, audio, flow
   ========================================================================== */

// ---------------------------------------------------------------- 1. Field

const FIELD = {
  GRID_H: 168,          // grid rows; columns follow the screen aspect
  C2: 0.25,             // (wave speed)^2 in cells per substep
  SUBSTEPS: 3,          // substeps per 60 Hz tick
  TICK_HZ: 60,
  DAMP: 0.0022,         // base energy loss per substep
  SPONGE: 12,           // absorbing border width in cells
  OMEGA: (Math.PI * 2) / 30, // sustained emitter angular frequency per substep
  EXPO_HALF_S: 0.85,    // long-exposure half-life
  EXPO_CAP: 0.8,        // saturation of the exposure response (h^2)
  COARSE: 4,            // scoring block size
  MAP_POW: 1.0,         // exposure compression before comparison
  MAP_BLUR: 1,          // softening passes (spatial tolerance)
  SIM_FLOOR: 0.0        // correlation that counts as "nothing alike"
};

function createField(gw, gh) {
  const n = gw * gh;
  const f = {
    gw, gh, n,
    h: new Float32Array(n),
    hp: new Float32Array(n),
    hn: new Float32Array(n),
    expo: new Float32Array(n),
    gate: new Float32Array(n).fill(1), // exposure sensitivity; closed briefly at sources
    wall: new Uint8Array(n),
    damp: new Float32Array(n),
    emitters: [],        // live sustained sources { x, y, amp, sigma }
    fixed: [],           // level-owned persistent sources
    step: 0,             // global substep counter; phase clock for emitters
    c2: FIELD.C2
  };
  const expoDecay = Math.pow(0.5, 1 / (FIELD.EXPO_HALF_S * FIELD.TICK_HZ * FIELD.SUBSTEPS));
  f.expoDecay = expoDecay;
  resetDamping(f);
  return f;
}

function resetDamping(f) {
  const { gw, gh, damp } = f;
  const S = FIELD.SPONGE;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const d = Math.min(x, y, gw - 1 - x, gh - 1 - y);
      let g = FIELD.DAMP;
      if (d < S) {
        const k = (S - d) / S;
        g += 0.16 * k * k;
      }
      damp[y * gw + x] = g;
    }
  }
}

function clearField(f) {
  f.h.fill(0); f.hp.fill(0); f.hn.fill(0); f.expo.fill(0); f.gate.fill(1);
  f.emitters.length = 0;
}

// Walls are reflective: the field is pinned to zero inside them.
function setWalls(f, shapes) {
  const { gw, gh, wall } = f;
  wall.fill(0);
  if (!shapes) return;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const nx = x / (gw - 1), ny = y / (gh - 1);
      for (const s of shapes) {
        if (insideShape(s, nx, ny, gw, gh)) { wall[y * gw + x] = 1; break; }
      }
    }
  }
}

function insideShape(shape, nx, ny, gw, gh) {
  if (shape.type === "rect") return nx >= shape.x0 && nx <= shape.x1 && ny >= shape.y0 && ny <= shape.y1;
  if (shape.type === "circle") {
    // radius is a fraction of the screen width so circles stay round
    const dx = (nx - shape.x) * (gw - 1), dy = (ny - shape.y) * (gh - 1);
    const r = shape.r * (gw - 1);
    return dx * dx + dy * dy <= r * r;
  }
  if (shape.type === "segment") {
    const ax = shape.x0 * (gw - 1), ay = shape.y0 * (gh - 1);
    const bx = shape.x1 * (gw - 1), by = shape.y1 * (gh - 1);
    const px = nx * (gw - 1), py = ny * (gh - 1);
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
    const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return dx * dx + dy * dy <= shape.w * shape.w * (gw - 1) * (gw - 1);
  }
  return false;
}

// Releases a zero-mean "Mexican hat" displacement. Because its net
// displacement is zero, the 2D wave leaves no slowly-decaying tail behind the
// front: a clean luminous ring travels out and the centre falls quiet.
function injectPulse(f, gx, gy, amp, sigma) {
  const { gw, gh, h, hp, wall } = f;
  const R = Math.ceil(sigma * 11);
  const x0 = Math.max(1, Math.floor(gx - R)), x1 = Math.min(gw - 2, Math.ceil(gx + R));
  const y0 = Math.max(1, Math.floor(gy - R)), y1 = Math.min(gh - 2, Math.ceil(gy + R));
  const inv = 1 / (2 * sigma * sigma);
  const gate = f.gate;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * gw + x;
      if (wall[i]) continue;
      const q = ((x - gx) * (x - gx) + (y - gy) * (y - gy)) * inv;
      const v = amp * (1 - q) * Math.exp(-q);
      h[i] += v; hp[i] += v;
      // the source itself does not expose; only the waves it launches
      const shut = Math.exp(-q * 0.02);
      if (1 - shut < gate[i]) gate[i] = 1 - shut;
    }
  }
}

// A directional impulse: a short wavefront whose previous state sits slightly
// behind it, so the leapfrog integrator launches it forward along (dx, dy).
function injectFlick(f, gx, gy, dx, dy, amp) {
  const { gw, gh, h, hp, wall } = f;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sPar = 2.2, sPerp = 6.5;
  const shift = Math.sqrt(f.c2) * 1.6;
  const r = Math.ceil(sPerp * 3);
  const x0 = Math.max(1, Math.floor(gx - r)), x1 = Math.min(gw - 2, Math.ceil(gx + r));
  const y0 = Math.max(1, Math.floor(gy - r)), y1 = Math.min(gh - 2, Math.ceil(gy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * gw + x;
      if (wall[i]) continue;
      const rx = x - gx, ry = y - gy;
      const par = rx * ux + ry * uy, perp = -rx * uy + ry * ux;
      const parB = par + shift;
      const e = Math.exp(-(perp * perp) / (2 * sPerp * sPerp));
      h[i] += amp * e * (par / sPar) * Math.exp(-(par * par) / (2 * sPar * sPar));
      hp[i] += amp * e * (parB / sPar) * Math.exp(-(parB * parB) / (2 * sPar * sPar));
    }
  }
}

function drive(f, src, phase) {
  const { gw, gh, hn, wall } = f;
  const sigma = src.sigma || 1.8;
  const amp = src.amp * phase;
  const gx = src.x * (gw - 1), gy = src.y * (gh - 1);
  const r = Math.ceil(sigma * 2.5);
  const x0 = Math.max(1, Math.floor(gx - r)), x1 = Math.min(gw - 2, Math.ceil(gx + r));
  const y0 = Math.max(1, Math.floor(gy - r)), y1 = Math.min(gh - 2, Math.ceil(gy + r));
  const inv = 1 / (2 * sigma * sigma);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * gw + x;
      if (wall[i]) continue;
      const ddx = x - gx, ddy = y - gy;
      hn[i] += amp * Math.exp(-(ddx * ddx + ddy * ddy) * inv);
    }
  }
}

// One leapfrog substep of the damped wave equation plus long exposure.
function stepField(f) {
  const { gw, gh, wall, damp, expo } = f;
  let h = f.h, hp = f.hp, hn = f.hn;
  const c2 = f.c2;
  for (let y = 1; y < gh - 1; y++) {
    let i = y * gw + 1;
    for (let x = 1; x < gw - 1; x++, i++) {
      if (wall[i]) { hn[i] = 0; continue; }
      const hc = h[i];
      // isotropic 9-point Laplacian: rings stay round instead of squaring off
      const lap = (4 * (h[i - 1] + h[i + 1] + h[i - gw] + h[i + gw]) +
        h[i - gw - 1] + h[i - gw + 1] + h[i + gw - 1] + h[i + gw + 1] - 20 * hc) * (1 / 6);
      const g = damp[i];
      hn[i] = (2 - g) * hc - (1 - g) * hp[i] + c2 * lap;
    }
  }
  const phase = Math.sin(FIELD.OMEGA * f.step);
  for (const s of f.fixed) drive(f, s, phase);
  for (const s of f.emitters) drive(f, s, phase);
  f.hp = h; f.h = hn; f.hn = hp;
  h = f.h;
  // long exposure with a film-like shoulder: bright events saturate instead
  // of burning a hole, so crossings read as clearly as the sources
  const d = f.expoDecay, cap = FIELD.EXPO_CAP, gate = f.gate;
  for (let i = 0; i < f.n; i++) {
    let e = h[i] * h[i];
    if (e > cap) e = cap;
    const g = gate[i];
    expo[i] = expo[i] * d + e * e * g;
    if (g < 1) gate[i] = g + (1 - g) * 0.007;
  }
  f.step++;
}

function fieldEnergy(f) {
  let s = 0;
  const h = f.h;
  for (let i = 0; i < f.n; i++) s += h[i] * h[i];
  return s / f.n;
}

// ---------------------------------------------------------------- 2. Levels
//
// Every level is a small physical score: actions that, when performed, draw a
// specific interference formation. The player only ever sees the formation.
// Coordinates are normalized to the screen (x right, y down). Times in s.

const PULSE_SOFT = 1.0, PULSE_STRONG = 1.7;

function pulseAmp(s) { return 3.0 * s; }
function pulseSigma(s) { return 2.4 + 1.6 * (s - 1); }
const HOLD_AMP = 0.045;
const FLICK_AMP = 2.6;

const LEVELS = [
  { // 1. a single touch makes a wave
    reveal: 2.0, budget: 9, threshold: 0.86,
    solution: [{ t: 0, type: "pulse", x: 0.36, y: 0.42, s: PULSE_SOFT }]
  },
  { // 2. two waves meet
    reveal: 2.0, budget: 10, threshold: 0.82,
    solution: [
      { t: 0, type: "pulse", x: 0.28, y: 0.34, s: PULSE_SOFT },
      { t: 0, type: "pulse", x: 0.7, y: 0.58, s: PULSE_SOFT }
    ]
  },
  { // 3. timing bends the meeting line
    reveal: 2.0, budget: 11, threshold: 0.76,
    solution: [
      { t: 0, type: "pulse", x: 0.24, y: 0.3, s: PULSE_SOFT },
      { t: 0.45, type: "pulse", x: 0.74, y: 0.38, s: PULSE_SOFT },
      { t: 0.9, type: "pulse", x: 0.46, y: 0.72, s: PULSE_SOFT }
    ]
  },
  { // 4. a pressed wave is heavier
    reveal: 1.9, budget: 11, threshold: 0.9,
    solution: [
      { t: 0, type: "pulse", x: 0.66, y: 0.3, s: PULSE_STRONG },
      { t: 0.25, type: "pulse", x: 0.3, y: 0.62, s: PULSE_SOFT }
    ]
  },
  { // 5. a moving source
    reveal: 1.9, budget: 12, threshold: 0.8,
    solution: [{
      t: 0, type: "hold", dur: 1.3,
      track: [[0, 0.22, 0.72], [1.3, 0.72, 0.5]]
    }]
  },
  { // 6. a field that never stops singing
    reveal: 1.8, budget: 12, threshold: 0.64,
    fixed: [{ x: 0.64, y: 0.28 }],
    solution: [{ t: 0, type: "hold", dur: 1.8, track: [[0, 0.34, 0.58]] }]
  },
  { // 7. darkness that pushes back
    reveal: 1.8, budget: 12, threshold: 0.62,
    walls: [
      { type: "rect", x0: 0, y0: 0.47, x1: 0.31, y1: 0.495 },
      { type: "rect", x0: 0.41, y0: 0.47, x1: 0.59, y1: 0.495 },
      { type: "rect", x0: 0.69, y0: 0.47, x1: 1, y1: 0.495 }
    ],
    solution: [{ t: 0, type: "hold", dur: 1.8, track: [[0, 0.43, 0.34]] }]
  },
  { // 8. two formations at once
    reveal: 1.8, budget: 13, threshold: 0.76,
    regions: [
      { type: "rect", x0: 0, y0: 0, x1: 1, y1: 0.5 },
      { type: "rect", x0: 0, y0: 0.5, x1: 1, y1: 1 }
    ],
    solution: [
      { t: 0, type: "pulse", x: 0.2, y: 0.2, s: PULSE_SOFT },
      { t: 0, type: "pulse", x: 0.5, y: 0.3, s: PULSE_SOFT },
      { t: 0.3, type: "pulse", x: 0.56, y: 0.72, s: PULSE_SOFT },
      { t: 0.3, type: "pulse", x: 0.84, y: 0.64, s: PULSE_SOFT }
    ]
  },
  { // 9. only four touches
    reveal: 1.6, budget: 8, threshold: 0.9, maxActions: 4,
    solution: [
      { t: 0, type: "pulse", x: 0.3, y: 0.42, s: PULSE_SOFT },
      { t: 0, type: "pulse", x: 0.7, y: 0.42, s: PULSE_SOFT },
      { t: 0, type: "pulse", x: 0.5, y: 0.64, s: PULSE_STRONG }
    ]
  },
  { // 10. the formation is gone almost at once
    reveal: 0.75, budget: 11, threshold: 0.88,
    solution: [
      { t: 0, type: "pulse", x: 0.22, y: 0.52, s: PULSE_SOFT },
      { t: 0.25, type: "pulse", x: 0.54, y: 0.26, s: PULSE_STRONG },
      { t: 0.5, type: "pulse", x: 0.78, y: 0.56, s: PULSE_SOFT }
    ]
  },
  { // 11. a body in the field
    reveal: 1.2, budget: 13, threshold: 0.84,
    walls: [{ type: "circle", x: 0.52, y: 0.5, r: 0.13 }],
    solution: [{
      t: 0, type: "hold", dur: 1.4,
      track: [[0, 0.2, 0.28], [1.4, 0.26, 0.74]]
    }]
  },
  { // 12. everything the field has taught
    reveal: 0.9, budget: 10, threshold: 0.76, maxActions: 4,
    fixed: [{ x: 0.5, y: 0.14 }],
    walls: [{ type: "segment", x0: 0.12, y0: 0.62, x1: 0.5, y1: 0.5, w: 0.018 }],
    solution: [
      { t: 0, type: "pulse", x: 0.26, y: 0.36, s: PULSE_SOFT },
      { t: 0.35, type: "pulse", x: 0.74, y: 0.44, s: PULSE_STRONG },
      { t: 0.7, type: "pulse", x: 0.6, y: 0.78, s: PULSE_SOFT }
    ]
  }
];

function holdPoint(a, tRel) {
  const pts = a.track;
  if (pts.length === 1 || tRel <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let k = 1; k < pts.length; k++) {
    if (tRel <= pts[k][0]) {
      const u = (tRel - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]);
      return [pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u, pts[k - 1][2] + (pts[k][2] - pts[k - 1][2]) * u];
    }
  }
  const last = pts[pts.length - 1];
  return [last[1], last[2]];
}

function solutionCost(level) {
  let e = 0;
  for (const a of level.solution) {
    if (a.type === "pulse") e += a.s;
    else if (a.type === "flick") e += 2;
    else if (a.type === "hold") e += 0.3 + a.dur;
  }
  return e;
}

function configureField(f, level) {
  clearField(f);
  setWalls(f, level.walls);
  f.fixed = (level.fixed || []).map(s => ({ x: s.x, y: s.y, amp: HOLD_AMP * 0.8, sigma: 1.8 }));
  f.c2 = FIELD.C2;
}

// Replays a timeline of actions into a field, one 60 Hz tick at a time.
function scriptTick(f, actions, time, dt) {
  f.emitters.length = 0;
  for (const a of actions) {
    if (a.type === "hold") {
      if (time >= a.t && time < a.t + a.dur) {
        const [x, y] = holdPoint(a, time - a.t);
        f.emitters.push({ x, y, amp: HOLD_AMP, sigma: 1.8 });
      }
    } else if (a.t > time - dt + 1e-9 && a.t <= time + 1e-9) {
      if (a.type === "pulse") injectPulse(f, a.x * (f.gw - 1), a.y * (f.gh - 1), pulseAmp(a.s), pulseSigma(a.s));
      else if (a.type === "flick") injectFlick(f, a.x * (f.gw - 1), a.y * (f.gh - 1), a.dx, a.dy, FLICK_AMP);
    }
  }
}

// ---------------------------------------------------------------- 3. Scoring

function coarseDims(f) {
  const B = FIELD.COARSE;
  return { cw: Math.ceil(f.gw / B), ch: Math.ceil(f.gh / B) };
}

// Long exposure -> coarse, compressed, softened map used for comparison.
// `base` is the steady exposure of level-owned sources, removed so only the
// player's contribution is judged.
function coarseMap(f, out, tmp, base) {
  const B = FIELD.COARSE;
  const { cw, ch } = coarseDims(f);
  const { gw, gh, expo } = f;
  out.fill(0);
  for (let y = 0; y < gh; y++) {
    const cy = (y / B) | 0;
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const v = base ? Math.max(0, expo[i] - base[i]) : expo[i];
      out[cy * cw + ((x / B) | 0)] += v;
    }
  }
  const P = FIELD.MAP_POW;
  for (let i = 0; i < out.length; i++) out[i] = Math.pow(out[i] / (B * B), P);
  for (let pass = 0; pass < FIELD.MAP_BLUR; pass++) {
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let s = 0, c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= ch) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= cw) continue;
            const w = (ox === 0 ? 2 : 1) * (oy === 0 ? 2 : 1);
            s += out[yy * cw + xx] * w; c += w;
          }
        }
        tmp[y * cw + x] = s / c;
      }
    }
    out.set(tmp);
  }
  return out;
}

function regionMasks(f, level) {
  const { cw, ch } = coarseDims(f);
  const regions = level.regions || [{ type: "rect", x0: 0, y0: 0, x1: 1, y1: 1 }];
  return regions.map(r => {
    const m = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const nx = (x + 0.5) / cw, ny = (y + 0.5) / ch;
        m[y * cw + x] = insideShape(r, nx, ny, f.gw, f.gh) ? 1 : 0;
      }
    }
    return m;
  });
}

// Pearson correlation inside a region mask.
function correlate(a, b, mask) {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    sa += a[i]; sb += b[i]; n++;
  }
  if (!n) return 0;
  const ma = sa / n, mb = sb / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    const da = a[i] - ma, db = b[i] - mb;
    ab += da * db; aa += da * da; bb += db * db;
  }
  if (aa < 1e-12 || bb < 1e-12) return 0;
  return ab / Math.sqrt(aa * bb);
}

// Similarity is the weakest region's correlation, scaled down when the
// region holds much less light than the formation (a faint echo of the right
// shape is not resonance), then rescaled so unrelated fields read near zero.
function matchScore(map, target, masks) {
  let worst = 1;
  for (const m of masks) {
    let sm = 0, st = 0;
    for (let i = 0; i < map.length; i++) if (m[i]) { sm += map[i]; st += target[i]; }
    const fill = st > 0 ? Math.min(1, sm / (st * 0.45)) : 0;
    worst = Math.min(worst, correlate(map, target, m) * fill);
  }
  return Math.max(0, (worst - FIELD.SIM_FLOOR) / (1 - FIELD.SIM_FLOOR));
}

// Steady exposure of the level's own persistent sources, or null.
function buildBaseline(level, gw, gh) {
  if (!level.fixed || !level.fixed.length) return null;
  const f = createField(gw, gh);
  configureField(f, level);
  for (let k = 0; k < 240 * FIELD.SUBSTEPS; k++) stepField(f);
  return Float32Array.from(f.expo);
}

function warmField(f) {
  if (f.fixed.length) for (let k = 0; k < 240 * FIELD.SUBSTEPS; k++) stepField(f);
}

// Simulates a level's solution in a private field and keeps the moment its
// long exposure is richest. That frame becomes the formation to recreate.
function buildTarget(level, gw, gh) {
  const base = buildBaseline(level, gw, gh);
  const f = createField(gw, gh);
  configureField(f, level);
  warmField(f);
  const { cw, ch } = coarseDims(f);
  const coarse = new Float32Array(cw * ch), tmp = new Float32Array(cw * ch);
  let end = 0;
  for (const a of level.solution) end = Math.max(end, a.t + (a.dur || 0));
  const T = end + 1.6;
  const dt = 1 / FIELD.TICK_HZ;
  let best = -1, bestExpo = null, bestCoarse = null, bestTime = 0;
  for (let k = 0; k * dt <= T; k++) {
    const time = k * dt;
    scriptTick(f, level.solution, time, dt);
    for (let s = 0; s < FIELD.SUBSTEPS; s++) stepField(f);
    if (time < end) continue;
    coarseMap(f, coarse, tmp, base);
    let sum = 0;
    for (let i = 0; i < coarse.length; i++) sum += coarse[i];
    if (sum > best) {
      best = sum; bestTime = time;
      bestExpo = Float32Array.from(f.expo);
      if (base) for (let i = 0; i < bestExpo.length; i++) bestExpo[i] = Math.max(0, bestExpo[i] - base[i]);
      bestCoarse = Float32Array.from(coarse);
    }
  }
  return { expo: bestExpo, coarse: bestCoarse, base, time: bestTime, cost: solutionCost(level) };
}

// ---------------------------------------------------------------- 4. Bit

const MAX_CORES = 6;
const HOLD_MS = 520;          // press longer than this and the touch begins to sing
const CHARGE_FROM = 110, CHARGE_TO = 400;
const DRAG_PX = 22;
const FLICK_SPEED = 1.1;      // px per ms at release

const VERT_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The light of the field itself, written into a persistent exposure buffer.
const FRAG_SCENE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform sampler2D uField;
uniform sampler2D uTarget;
uniform vec2 uGrid;
uniform float uAspect;
uniform float uPersist;
uniform float uTime;
uniform float uGain;
uniform float uGhost;
uniform vec3 uGhostTint;
uniform float uHdr;
uniform vec4 uCores[${MAX_CORES}];
uniform vec4 uRing;
uniform float uChaos;
uniform float uWarmth;

float decodeH(float r) { float s = r * 2.0 - 1.0; return sign(s) * s * s; }
vec2 gridUv(vec2 uv) { return (vec2(uv.x, 1.0 - uv.y) * (uGrid - 1.0) + 0.5) / uGrid; }
float hAt(vec2 g) { return decodeH(texture2D(uField, g).r); }
float vAt(vec2 g) { return decodeH(texture2D(uField, g).a); }

vec4 smoothSample(sampler2D t, vec2 g) {
  vec2 st = g * uGrid - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / s0) / uGrid, c1 = (i + 1.5 + w3 / s1) / uGrid;
  return (texture2D(t, vec2(c0.x, c0.y)) * s0.x + texture2D(t, vec2(c1.x, c0.y)) * s1.x) * s0.y +
         (texture2D(t, vec2(c0.x, c1.y)) * s0.x + texture2D(t, vec2(c1.x, c1.y)) * s1.x) * s1.y;
}

vec3 spectral(float t) {
  vec3 deep = vec3(0.03, 0.06, 0.26);
  vec3 violet = vec3(0.22, 0.2, 0.9);
  vec3 cyan = vec3(0.36, 0.78, 1.0);
  vec3 white = vec3(1.0, 0.94, 0.88);
  vec3 ember = vec3(1.0, 0.56, 0.32);
  vec3 c = mix(deep, violet, smoothstep(0.0, 0.35, t));
  c = mix(c, cyan, smoothstep(0.3, 0.7, t));
  c = mix(c, white, smoothstep(0.65, 1.05, t));
  c = mix(c, ember, smoothstep(1.1, 1.8, t) * 0.7);
  return c;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

float chan(vec4 c, int k) { return k == 1 ? c.g : c.r; }
float ridge(sampler2D t, vec2 g, float c, int k) {
  vec2 r = 3.5 / uGrid;
  float m = 0.0;
  m += chan(texture2D(t, g + vec2(r.x, 0.0)), k) + chan(texture2D(t, g - vec2(r.x, 0.0)), k);
  m += chan(texture2D(t, g + vec2(0.0, r.y)), k) + chan(texture2D(t, g - vec2(0.0, r.y)), k);
  m += chan(texture2D(t, g + r * 0.7), k) + chan(texture2D(t, g - r * 0.7), k);
  m += chan(texture2D(t, g + vec2(r.x, -r.y) * 0.7), k) + chan(texture2D(t, g + vec2(-r.x, r.y) * 0.7), k);
  m *= 0.125;
  return clamp((c - m) * 2.6 + c * 0.32, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (uChaos > 0.0) {
    uv += uChaos * 0.018 * vec2(sin(uv.y * 43.0 + uTime * 9.0), cos(uv.x * 37.0 - uTime * 7.0));
  }
  vec2 g = gridUv(uv);
  vec2 tx = 1.0 / uGrid;
  vec4 F = texture2D(uField, g);
  float h = decodeH(F.r);
  vec2 grad = vec2(hAt(g + vec2(tx.x, 0.0)) - hAt(g - vec2(tx.x, 0.0)),
                   hAt(g - vec2(0.0, tx.y)) - hAt(g + vec2(0.0, tx.y)));
  float gm = length(grad);
  vec2 dir = gm > 1e-5 ? grad / gm : vec2(0.0);
  float v = vAt(g);
  float vr = vAt(g + vec2(dir.x, -dir.y) * tx * 1.5);
  float vb = vAt(g - vec2(dir.x, -dir.y) * tx * 1.5);
  vec3 crest = pow(abs(vec3(vr, v, vb)), vec3(1.6));
  float expoRaw = smoothSample(uField, g).g;
  float expo = ridge(uField, g, expoRaw, 1);
  float wall = F.b;

  float energy = crest.g * 1.6 + expo * 0.9;
  vec3 L = spectral(0.3 + energy * 0.8 + uWarmth * 0.35) * crest.g * 3.2;
  L.r += max(crest.r - crest.g, 0.0) * 1.6;
  L.b += max(crest.b - crest.g, 0.0) * 2.0;
  L.g += max(crest.b - crest.g, 0.0) * 0.6;
  L += vec3(0.02, 0.04, 0.16) * abs(h) * 0.12;

  float ex = pow(expo, 2.4);
  L += spectral(0.7 + expo * 0.5 + uWarmth * 0.3) * ex * 1.4;
  L += vec3(0.04, 0.07, 0.26) * expoRaw * expoRaw * 0.1;

  float tgRaw = smoothSample(uTarget, g).r;
  float tg = ridge(uTarget, g, tgRaw, 0);
  L += uGhostTint * (pow(tg, 1.8) * 1.1 + tgRaw * tgRaw * 0.1) * uGhost;

  vec2 p = vec2(uv.x * uAspect, uv.y);
  for (int i = 0; i < ${MAX_CORES}; i++) {
    vec4 c = uCores[i];
    if (c.z <= 0.0) continue;
    vec2 d = p - vec2(c.x * uAspect, c.y);
    float d2 = dot(d, d);
    float s = c.z;
    float sing = c.w > 0.5 ? 0.75 + 0.25 * sin(uTime * 11.0 + float(i)) : 1.0;
    L += vec3(1.0, 0.95, 0.9) * s * sing * exp(-d2 / 0.000035) * 2.2;
    L += spectral(0.5 + s * 0.4) * s * exp(-d2 / (0.0009 + 0.0022 * s)) * 0.3;
  }

  if (uRing.w > 0.0) {
    vec2 d = p - vec2(uRing.x * uAspect, uRing.y);
    float rr = length(d) - uRing.z;
    L += vec3(1.0, 0.93, 0.86) * uRing.w * (exp(-rr * rr / 0.0003) * 0.5 + exp(-rr * rr / 0.006) * 0.12);
  }

  float wn = texture2D(uField, g + vec2(tx.x, 0.0)).b + texture2D(uField, g - vec2(tx.x, 0.0)).b +
             texture2D(uField, g + vec2(0.0, tx.y)).b + texture2D(uField, g - vec2(0.0, tx.y)).b;
  float rim = clamp(wn * 0.25 - wall, 0.0, 1.0) + clamp(wall - wn * 0.25, 0.0, 1.0);
  L *= 1.0 - wall;
  L += vec3(0.16, 0.14, 0.42) * rim * (0.05 + energy * 0.8);

  L *= uGain;
  if (uChaos > 0.0) L *= 1.0 - uChaos * 0.55 * hash(uv * 311.0 + uTime);
  vec3 prev = texture2D(uPrev, vUv).rgb / uHdr;
  vec3 outc = prev * uPersist + L * (1.0 - uPersist);
  gl_FragColor = vec4(outc * uHdr, 1.0);
}`;

const VERT_PARTICLE = `
attribute vec4 aData;
uniform float uSize;
varying float vB;
varying float vT;
void main() {
  gl_Position = vec4(aData.x * 2.0 - 1.0, 1.0 - aData.y * 2.0, 0.0, 1.0);
  vB = aData.z;
  vT = fract(aData.w);
  gl_PointSize = uSize * (0.8 + min(aData.z, 2.0) * 0.9);
}`;

const FRAG_PARTICLE = `
precision highp float;
varying float vB;
varying float vT;
uniform float uScale;
uniform float uPoint;
void main() {
  float a = 1.0;
  if (uPoint > 0.5) {
    vec2 q = gl_PointCoord - 0.5;
    a = exp(-dot(q, q) * 14.0);
  }
  vec3 cool = vec3(0.34, 0.5, 1.0);
  vec3 warm = vec3(1.0, 0.9, 0.8);
  vec3 c = mix(cool, warm, smoothstep(0.1, 0.9, vT));
  c = mix(c, vec3(1.0, 0.55, 0.7), smoothstep(0.92, 1.0, vT) * 0.5);
  gl_FragColor = vec4(c * vB * a * uScale, 1.0);
}`;

const FRAG_DOWN = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uKnee;
void main() {
  vec3 c = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb +
           texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(max(c.r, c.g), c.b);
  c *= smoothstep(0.0, uKnee, l);
  gl_FragColor = vec4(c, 1.0);
}`;

const FRAG_BLUR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb * 0.227;
  c += (texture2D(uSrc, vUv + uDir * 1.385).rgb + texture2D(uSrc, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(uSrc, vUv + uDir * 3.231).rgb + texture2D(uSrc, vUv - uDir * 3.231).rgb) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

const FRAG_COMPOSITE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform vec2 uRes;
uniform float uHdr;
uniform float uCA;
uniform float uBloom;
uniform float uExposure;
uniform float uGrain;
uniform float uTime;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 ca = c * uCA * (0.004 + r2 * 0.03);
  vec3 col;
  col.r = texture2D(uScene, uv + ca).r;
  col.g = texture2D(uScene, uv).g;
  col.b = texture2D(uScene, uv - ca).b;
  vec3 b1 = vec3(texture2D(uBloom1, uv + ca * 2.0).r, texture2D(uBloom1, uv).g, texture2D(uBloom1, uv - ca * 2.0).b);
  vec3 b2 = texture2D(uBloom2, uv).rgb;
  col = (col + b1 * uBloom * 0.9 + b2 * uBloom * 1.1) / uHdr;
  col *= uExposure;
  col = vec3(1.0) - exp(-col * 1.15);
  col = pow(col, vec3(0.95, 0.97, 1.0));
  col *= 1.0 - smoothstep(0.12, 0.62, r2) * 0.55;
  float l = dot(col, vec3(0.3, 0.55, 0.15));
  float n = hash(uv * uRes + fract(uTime * 7.13) * 517.0) - 0.5;
  col += n * uGrain * (0.018 + l * 0.09);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

function compile(gl, type, glsl) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, glsl);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(shader));
  return shader;
}

function program(gl, vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, "");
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// Picks the best renderable format for the exposure buffers: half float
// keeps faint trails alive; 8-bit falls back to a trail-free look.
function pickTargetFormat(gl, isGL2) {
  const tryFormat = (internal, format, type) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && !gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(t);
    return ok;
  };
  if (isGL2) {
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("EXT_color_buffer_half_float");
    gl.getExtension("OES_texture_float_linear");
    if (tryFormat(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)) return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, hdr: 1 };
  } else {
    const hf = gl.getExtension("OES_texture_half_float");
    gl.getExtension("OES_texture_half_float_linear");
    gl.getExtension("EXT_color_buffer_half_float");
    if (hf && tryFormat(gl.RGBA, gl.RGBA, hf.HALF_FLOAT_OES)) return { internal: gl.RGBA, format: gl.RGBA, type: hf.HALF_FLOAT_OES, hdr: 1 };
  }
  return { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE, hdr: 0.3, lowPrecision: true };
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

window.plethoraBit = {
  meta: {
    title: "Resonance",
    runtime: "plethora-bit@2",
    tags: ["puzzle", "physics", "generative-art"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    // ------------------------------------------------ tuning
    const tune = (id, d) => { const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined; return v == null || !isFinite(v) ? d : v; };
    const cfg = {
      waveSpeed: tune("wave_speed", 1),
      tolerance: tune("tolerance", 0),
      revealScale: tune("reveal_scale", 1),
      density: tune("particle_density", 1),
      persist: tune("trail_persistence", 0.6),
      bloom: tune("bloom_strength", 1),
      chroma: tune("chromatic_aberration", 1),
      grain: tune("grain", 1),
      exposure: tune("exposure", 1),
      volume: tune("audio_volume", 0.7)
    };
    if (ctx.tune && ctx.tune.onChange) {
      const live = { tolerance: "tolerance", reveal_scale: "revealScale", trail_persistence: "persist", bloom_strength: "bloom", chromatic_aberration: "chroma", grain: "grain", exposure: "exposure", audio_volume: "volume" };
      for (const id of Object.keys(live)) {
        ctx.tune.onChange(id, () => { cfg[live[id]] = tune(id, cfg[live[id]]); if (id === "audio_volume") audio.setVolume(); });
      }
    }

    // ------------------------------------------------ surfaces
    const canvas = ctx.createCanvas({ touchAction: "none", layer: "content" });
    canvas.style.cssText += ";position:absolute;inset:0;width:100%;height:100%;display:block;background:#000;";
    const ui = ctx.createRoot({ layer: "overlay", input: "passthrough" });
    buildUi(ui);

    let gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    const isGL2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", { antialias: false, alpha: false }) || canvas.getContext("experimental-webgl");
    if (!gl) {
      ui.querySelector(".rs-center").innerHTML = '<div class="rs-line">this field needs webgl</div>';
      ui.querySelector(".rs-center").style.opacity = "0.5";
      ctx.markVisualReady && ctx.markVisualReady("no-webgl");
      ctx.platform.ready();
      return;
    }

    const fmt = pickTargetFormat(gl, isGL2);
    const HDR = fmt.hdr;
    if (fmt.lowPrecision) cfg.persist = 0;

    const progScene = program(gl, VERT_QUAD, FRAG_SCENE, ["aPos"]);
    const progDown = program(gl, VERT_QUAD, FRAG_DOWN, ["aPos"]);
    const progBlur = program(gl, VERT_QUAD, FRAG_BLUR, ["aPos"]);
    const progComp = program(gl, VERT_QUAD, FRAG_COMPOSITE, ["aPos"]);
    const progPart = program(gl, VERT_PARTICLE, FRAG_PARTICLE, ["aData"]);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const partBuf = gl.createBuffer();

    function makeTex(w, h, f) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (f) gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
      return t;
    }
    function makeTarget(w, h) {
      const tex = makeTex(w, h, fmt);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fb, w, h };
    }
    function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

    const fieldTex = makeTex(1, 1, null);
    const targetTex = makeTex(1, 1, null);

    // ------------------------------------------------ sizing
    let W = 0, H = 0, sceneW = 0, sceneH = 0, dpr = 1;
    let acc = [null, null], bloomA = null, bloomB = null, bloomC = null, bloomD = null;
    let accIndex = 0;
    let field = null, gw = 0, gh = 0, fieldBytes = null;
    let coarse = null, coarseTmp = null, masks = null;
    let particles = null;

    function resize(force) {
      const w = Math.max(1, Math.round(ctx.width)), h = Math.max(1, Math.round(ctx.height));
      if (!force && w === W && h === H) return false;
      W = w; H = h;
      dpr = Math.min(ctx.dpr || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const sceneScale = Math.min(1, 1.25 / dpr) * dpr;
      sceneW = Math.max(2, Math.round(W * sceneScale));
      sceneH = Math.max(2, Math.round(H * sceneScale));
      freeTarget(acc[0]); freeTarget(acc[1]); freeTarget(bloomA); freeTarget(bloomB); freeTarget(bloomC); freeTarget(bloomD);
      acc = [makeTarget(sceneW, sceneH), makeTarget(sceneW, sceneH)];
      const bw = Math.max(2, sceneW >> 2), bh = Math.max(2, sceneH >> 2);
      bloomA = makeTarget(bw, bh); bloomB = makeTarget(bw, bh);
      const cw2 = Math.max(2, sceneW >> 3), ch2 = Math.max(2, sceneH >> 3);
      bloomC = makeTarget(cw2, ch2); bloomD = makeTarget(cw2, ch2);

      const ngh = FIELD.GRID_H;
      const ngw = Math.max(48, Math.min(260, Math.round(ngh * W / H)));
      if (ngw !== gw || !field) {
        gw = ngw; gh = ngh;
        field = createField(gw, gh);
        fieldBytes = new Uint8Array(gw * gh * 4);
        const cd = coarseDims(field);
        coarse = new Float32Array(cd.cw * cd.ch);
        coarseTmp = new Float32Array(cd.cw * cd.ch);
        particles = createParticles();
        return true;
      }
      return false;
    }

    // ------------------------------------------------ particles
    function createParticles() {
      const N = Math.round(Math.max(1500, Math.min(14000, 8000 * cfg.density * Math.sqrt((W * H) / (390 * 844)))));
      const P = {
        N,
        x: new Float32Array(N), y: new Float32Array(N),
        vx: new Float32Array(N), vy: new Float32Array(N),
        seed: new Float32Array(N),
        verts: new Float32Array(N * 4 * 3),
        streakOffset: N * 4      // points first, then head/tail line pairs
      };
      for (let i = 0; i < N; i++) {
        P.x[i] = 1 + Math.random() * (gw - 3);
        P.y[i] = 1 + Math.random() * (gh - 3);
        P.seed[i] = Math.random();
      }
      return P;
    }

    let wallPushX = null, wallPushY = null;
    function buildWallPush() {
      wallPushX = new Float32Array(gw * gh);
      wallPushY = new Float32Array(gw * gh);
      const blur = new Float32Array(gw * gh);
      const R = 4;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let s = 0, c = 0;
        for (let oy = -R; oy <= R; oy += 2) for (let ox = -R; ox <= R; ox += 2) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          s += field.wall[yy * gw + xx]; c++;
        }
        blur[y * gw + x] = s / c;
      }
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        wallPushX[i] = -(blur[i + 1] - blur[i - 1]);
        wallPushY[i] = -(blur[i + gw] - blur[i - gw]);
      }
    }

    function updateParticles(dt, t) {
      const P = particles;
      const { h, wall } = field;
      const hang = state.hang;
      const expoNorm = level.expoNorm;
      const vis = 0.42 + 0.58 * Math.min(1, display.match * 1.1) + state.bloomBoost * 0.3;
      const ampBoost = 0.7 + display.match * 0.5 + state.bloomBoost * 0.3;
      const damp = Math.exp(-dt * 2.4);
      const K = 650;
      const pinch = input.pinch;
      const trail = 0.045 + state.bloomBoost * 0.03;
      const verts = P.verts;
      const invW = 1 / (gw - 1), invH = 1 / (gh - 1);
      let o = 0;
      for (let i = 0; i < P.N; i++) {
        let x = P.x[i], y = P.y[i];
        const xi = Math.min(gw - 2, Math.max(1, x | 0)), yi = Math.min(gh - 2, Math.max(1, y | 0));
        const k = yi * gw + xi;
        const hc = h[k];
        const dhx = (h[k + 1] - h[k - 1]) * 0.5, dhy = (h[k + gw] - h[k - gw]) * 0.5;
        const sd = P.seed[i] * 6.283;
        let ax = -dhx * K + Math.sin(y * 0.09 + t * 0.23 + sd) * 1.6;
        let ay = -dhy * K + Math.cos(x * 0.11 - t * 0.19 + sd) * 1.6 - 0.4;
        if (pinch.active) {
          const px = pinch.x * (gw - 1) - x, py = pinch.y * (gh - 1) - y;
          const dd = Math.sqrt(px * px + py * py) + 6;
          const f = pinch.force * 900 / dd;
          ax += px / dd * f; ay += py / dd * f;
        }
        if (wallPushX) { ax += wallPushX[k] * 900; ay += wallPushY[k] * 900; }
        if (state.scatter > 0) { ax += (Math.random() - 0.5) * 900 * state.scatter; ay += (Math.random() - 0.5) * 900 * state.scatter; }
        let vx = P.vx[i] * damp + ax * dt, vy = P.vy[i] * damp + ay * dt;
        P.vx[i] = vx; P.vy[i] = vy;
        x += vx * dt * hang; y += vy * dt * hang;
        if (x < 1 || y < 1 || x > gw - 2 || y > gh - 2 || wall[k] || Math.random() < 0.0012) {
          x = 1 + Math.random() * (gw - 3); y = 1 + Math.random() * (gh - 3);
          P.vx[i] = 0; P.vy[i] = 0; vx = 0; vy = 0;
        }
        P.x[i] = x; P.y[i] = y;
        const ex = Math.min(1, Math.sqrt(field.expo[k]) * expoNorm);
        const speed = Math.sqrt(vx * vx + vy * vy);
        const motion = Math.abs(hc - field.hp[k]) * 2.5;
        const energy = Math.min(1.2, motion + ex * ex * 0.35 + speed * 0.01);
        let b = (0.05 + energy * 1.4) * ampBoost;
        if (P.seed[i] > vis) b *= 0.08;
        const temp = Math.min(0.999, energy * 0.7 + state.warmth * 0.4);
        const nx = x * invW, ny = y * invH;
        // head point
        verts[o++] = nx; verts[o++] = ny; verts[o++] = b; verts[o++] = temp;
        // streak: head to tail
        const L = P.streakOffset;
        verts[L + i * 8] = nx; verts[L + i * 8 + 1] = ny; verts[L + i * 8 + 2] = b * 0.8; verts[L + i * 8 + 3] = temp;
        verts[L + i * 8 + 4] = nx - vx * trail * invW * hang; verts[L + i * 8 + 5] = ny - vy * trail * invH * hang;
        verts[L + i * 8 + 6] = 0; verts[L + i * 8 + 7] = temp;
      }
    }

    // ------------------------------------------------ audio (installation-like)
    const audio = createAudio(cfg);
    ctx.onDestroy(() => audio.dispose());

    // ------------------------------------------------ memory / platform
    const score = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;

    // ------------------------------------------------ state
    const state = {
      mode: "prelude",       // prelude | reveal | play | resonance | collapse | lost | finale
      t: 0,                  // time in mode
      clock: 0,
      simScale: 1,
      simAcc: 0,
      hang: 1,
      gain: 1,
      ghost: 0,
      ghostTint: [0.62, 0.7, 1.0],
      warmth: 0,
      chaos: 0,
      scatter: 0,
      bloomBoost: 0,
      ring: [0.5, 0.5, 0, 0],
      started: false,
      preludeTouched: -1,
      levelIndex: 0,
      total: 0,
      fails: 0,
      runLevelScores: []
    };
    const level = {
      def: null, target: null, masks: null, energyUsed: 0, actions: 0, playTime: 0,
      peak: 0, expoNorm: 1, centroid: [0.5, 0.5], lastActionAt: 0, baseEnergy: 0
    };
    const display = { match: 0, shown: -1, energyShown: "", levelShown: "" };
    const input = { pointers: new Map(), pinch: { active: false, x: 0.5, y: 0.5, force: 0, d0: 0 }, c2Mul: 1 };

    resize(true);

    // ------------------------------------------------ level flow
    function currentDef() { return LEVELS[state.levelIndex]; }

    function prepareLevel(idx) {
      state.levelIndex = idx;
      const def = LEVELS[idx];
      level.def = def;
      field.c2 = FIELD.C2 * cfg.waveSpeed * cfg.waveSpeed;
      const savedC2 = FIELD.C2;
      FIELD.C2 = field.c2;
      level.target = buildTarget(def, gw, gh);
      configureField(field, def);
      FIELD.C2 = savedC2;
      field.c2 = FIELD.C2 * cfg.waveSpeed * cfg.waveSpeed;
      warmField(field);
      level.baseEnergy = fieldEnergy(field);
      level.masks = regionMasks(field, def);
      buildWallPush();
      // brightness normalisation shared by target ghost and live exposure
      const e = level.target.expo;
      const vals = [];
      for (let i = 0; i < e.length; i += 3) vals.push(Math.sqrt(e[i]));
      vals.sort((a, b) => a - b);
      const ref = vals[Math.floor(vals.length * 0.995)] || 1;
      level.expoNorm = 0.85 / ref;
      // target texture and centroid
      const bytes = new Uint8Array(gw * gh * 4);
      let cx = 0, cy = 0, cs = 0;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const v = 1 - Math.exp(-Math.sqrt(e[i]) * level.expoNorm * 1.4);
        bytes[i * 4] = v * 255;
        bytes[i * 4 + 3] = 255;
        const w = v * v; cx += x * w; cy += y * w; cs += w;
      }
      level.centroid = cs > 0 ? [cx / cs / (gw - 1), cy / cs / (gh - 1)] : [0.5, 0.5];
      gl.bindTexture(gl.TEXTURE_2D, targetTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      resetAttempt();
    }

    function resetAttempt() {
      level.energyUsed = 0; level.actions = 0; level.playTime = 0; level.peak = 0; level.lastActionAt = 0;
      display.match = 0;
      releaseAllPointers(false);
    }

    // true once the player's own waves have died away (level sources keep singing)
    function fieldCalm() {
      return fieldEnergy(field) < level.baseEnergy * 1.2 + 0.0005;
    }

    function budget() { return level.def ? level.def.budget : 0; }
    function energyLeft() { return Math.max(0, budget() - level.energyUsed); }
    function actionsLeft() { return level.def && level.def.maxActions ? level.def.maxActions - level.actions : Infinity; }
    function threshold() { return Math.min(0.95, Math.max(0.4, level.def.threshold + cfg.tolerance)); }

    function setMode(m) { state.mode = m; state.t = 0; }

    function beginReveal() {
      clearField(field);
      configureField(field, level.def);
      warmField(field);
      resetAttempt();
      setMode("reveal");
      showCenter("");
      audio.reveal();
    }

    function beginPlay() { setMode("play"); }

    function spend(cost) {
      level.energyUsed += cost;
      level.actions++;
      level.lastActionAt = level.playTime;
    }

    function winLevel() {
      const def = level.def;
      const thr = threshold();
      const R = Math.min(1, 0.9 + 0.1 * (level.peak - thr) / Math.max(0.05, 1 - thr));
      const solActs = def.solution.length;
      const C = Math.pow(Math.min(1, solActs / Math.max(solActs, level.actions)), 0.7);
      const cost = level.target.cost;
      const slack = Math.max(0.5, def.budget - cost);
      const E = level.energyUsed <= cost ? 1 : Math.max(0.1, 1 - (level.energyUsed - cost) / slack);
      const Fl = Math.max(0.3, Math.min(1, 1 - (level.playTime - 4) / 40));
      const pts = Math.round(1000 * (0.45 * R + 0.2 * C + 0.2 * E + 0.15 * Fl) * Math.pow(0.88, state.fails));
      state.total += pts;
      state.lastResult = { R, C, E, pts };
      if (score) score.set(state.total, { reason: "level" });
      releaseAllPointers(false);
      setMode("resonance");
      state.ring = [level.centroid[0], level.centroid[1], 0, 0];
      audio.resonance();
      haptic("success");
      try { ctx.platform.milestone("level_clear", { level: state.levelIndex + 1, points: pts }); } catch (e) {}
      saveCheckpoint(state.levelIndex + 1);
      submitTotal();
    }

    function loseLevel() {
      state.fails++;
      releaseAllPointers(false);
      setMode("lost");
      audio.lost();
      try { ctx.platform.fail({ level: state.levelIndex + 1 }); } catch (e) {}
    }

    function nextLevel() {
      state.fails = 0;
      if (state.levelIndex + 1 >= LEVELS.length) { beginFinale(); return; }
      prepareLevel(state.levelIndex + 1);
      beginReveal();
    }

    function beginFinale() {
      setMode("finale");
      clearField(field);
      showCenter(
        '<div class="rs-label">total resonance</div>' +
        '<div class="rs-total">' + state.total.toLocaleString("en-US") + '</div>' +
        '<div class="rs-gap"></div><button class="rs-btn" data-act="restart">begin again</button>'
      );
      completeRun();
    }

    // ------------------------------------------------ persistence
    async function loadCheckpoint() {
      try {
        if (!ctx.game || !ctx.game.progress) return;
        const saved = await ctx.game.progress.load("main");
        if (!saved || saved.resumeEligible !== true) return;
        const s = saved.state || {};
        if (Number.isInteger(s.level) && s.level > 0 && s.level < LEVELS.length && isFinite(s.total)) {
          state.levelIndex = s.level;
          state.total = Math.max(0, s.total | 0);
          if (score) score.set(state.total, { reason: "resume" });
        }
      } catch (e) {}
    }
    function saveCheckpoint(nextIdx) {
      if (nextIdx >= LEVELS.length) return;
      try {
        if (ctx.game && ctx.game.progress) {
          ctx.game.progress.save("main", {
            state: { level: nextIdx, total: state.total },
            label: "Level " + pad2(nextIdx + 1) + " / " + LEVELS.length,
            percent: nextIdx / LEVELS.length,
            stateSchemaVersion: 1
          }).catch(() => {});
        }
      } catch (e) {}
    }
    function submitTotal() {
      try { if (score) score.submit("total").catch(() => {}); } catch (e) {}
    }
    function completeRun() {
      try { if (ctx.game && ctx.game.progress) ctx.game.progress.complete("main").catch(() => {}); } catch (e) {}
      try { ctx.platform.complete({ score: state.total }); } catch (e) {}
      ctx.timeout(() => {
        try { ctx.pulse.complete({ score: state.total, text: "Held " + LEVELS.length + " resonances · " + state.total.toLocaleString("en-US") }); } catch (e) {}
      }, 900);
    }
    function restartRun() {
      try { if (ctx.game && ctx.game.progress) ctx.game.progress.abandon("main").catch(() => {}); } catch (e) {}
      state.total = 0; state.fails = 0;
      if (score) score.reset({ reason: "restart" });
      prepareLevel(0);
      beginReveal();
    }

    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (e) {} }

    // ------------------------------------------------ input
    function toNorm(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height), px: e.clientX - r.left, py: e.clientY - r.top };
    }
    function canAct() {
      return state.mode === "play" || state.mode === "prelude" || (state.mode === "reveal" && state.t > 0.45);
    }
    function scored() { return state.mode === "play"; }

    ctx.listen(canvas, "pointerdown", e => {
      e.preventDefault();
      if (!state.started) { state.started = true; try { ctx.platform.start(); } catch (err) {} }
      audio.unlock();
      if (state.mode === "resonance" && state.t > 1.3) { state.t = Math.max(state.t, RES_COLLAPSE_AT); return; }
      if (!canAct()) return;
      if (state.mode === "reveal") beginPlay();
      if (state.mode === "play" && (actionsLeft() <= 0 || energyLeft() < 0.5)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const n = toNorm(e);
      input.pointers.set(e.pointerId, {
        id: e.pointerId, x: n.x, y: n.y, px: n.px, py: n.py, sx: n.px, sy: n.py,
        ex: n.x, ey: n.y, t0: performance.now(), lastT: performance.now(), vx: 0, vy: 0,
        mode: "press", charge: 0, emitter: null
      });
      if (input.pointers.size === 2) startPinch();
      if (state.mode === "prelude" && state.preludeTouched < 0) state.preludeTouched = state.clock;
    });

    ctx.listen(canvas, "pointermove", e => {
      const p = input.pointers.get(e.pointerId);
      if (!p) return;
      const n = toNorm(e);
      const now = performance.now();
      const dtm = Math.max(1, now - p.lastT);
      const k = 0.35;
      p.vx = p.vx * (1 - k) + ((n.px - p.px) / dtm) * k;
      p.vy = p.vy * (1 - k) + ((n.py - p.py) / dtm) * k;
      p.x = n.x; p.y = n.y; p.px = n.px; p.py = n.py; p.lastT = now;
      if (p.mode === "press" && Math.hypot(p.px - p.sx, p.py - p.sy) > DRAG_PX) startEmitting(p);
    });

    const endPointer = (e, cancelled) => {
      const p = input.pointers.get(e.pointerId);
      if (!p) return;
      input.pointers.delete(e.pointerId);
      if (input.pointers.size < 2) input.pinch.active = false;
      if (cancelled) { stopEmitting(p); return; }
      const age = performance.now() - p.t0;
      const recent = performance.now() - p.lastT < 60;
      const speed = recent ? Math.hypot(p.vx, p.vy) : 0;
      if (p.mode === "press") {
        const charge = Math.max(0, Math.min(1, (age - CHARGE_FROM) / (CHARGE_TO - CHARGE_FROM)));
        emitPulse(p.x, p.y, PULSE_SOFT + (PULSE_STRONG - PULSE_SOFT) * charge);
      } else if (p.mode === "emit") {
        stopEmitting(p);
        if (speed > FLICK_SPEED) emitFlick(p.x, p.y, p.vx, p.vy, speed);
      }
    };
    ctx.listen(canvas, "pointerup", e => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", e => endPointer(e, true));

    function startPinch() {
      const [a, b] = [...input.pointers.values()];
      input.pinch.d0 = Math.hypot(a.px - b.px, a.py - b.py) || 1;
      input.pinch.active = true;
    }

    function emitPulse(x, y, s) {
      if (!canAct()) return;
      if (scored()) {
        if (actionsLeft() <= 0 || energyLeft() < 0.5) return;
        spend(Math.min(s, energyLeft()));
      }
      injectPulse(field, x * (gw - 1), y * (gh - 1), pulseAmp(s), pulseSigma(s));
      audio.pulse(x, y, s);
      haptic("light");
      interact("pulse");
    }

    function emitFlick(x, y, vx, vy, speed) {
      if (!canAct()) return;
      if (scored()) {
        if (energyLeft() < 0.5) return;
        spend(Math.min(2, energyLeft()));
        level.actions--; // the hold that became a flick already counted
      }
      const amp = FLICK_AMP * Math.min(1.4, 0.7 + speed * 0.3);
      injectFlick(field, x * (gw - 1), y * (gh - 1), vx, vy, amp);
      audio.flick(x, y, speed);
      haptic("medium");
      interact("flick");
    }

    function startEmitting(p) {
      if (p.mode !== "press") return;
      if (scored()) {
        if (actionsLeft() <= 0 || energyLeft() < 0.5) { p.mode = "spent"; return; }
        spend(0.3);
      }
      p.mode = "emit";
      p.ex = p.x; p.ey = p.y;
      p.emitter = { x: p.x, y: p.y, amp: 0, sigma: 1.8 };
      field.emitters.push(p.emitter);
      p.voice = audio.holdStart(p.x, p.y);
      interact("hold");
    }

    function stopEmitting(p) {
      if (p.emitter) {
        const i = field.emitters.indexOf(p.emitter);
        if (i >= 0) field.emitters.splice(i, 1);
        p.emitter = null;
      }
      if (p.voice) { audio.holdStop(p.voice); p.voice = null; }
      if (p.mode === "emit") p.mode = "done";
    }

    function releaseAllPointers(clearMap) {
      for (const p of input.pointers.values()) { stopEmitting(p); p.mode = "spent"; }
      field.emitters.length = 0;
      if (clearMap !== false) input.pointers.clear();
    }

    let lastInteract = 0;
    function interact(type) {
      const now = performance.now();
      if (now - lastInteract < 250) return;
      lastInteract = now;
      try { ctx.platform.interact({ type }); } catch (e) {}
    }

    // per-tick pointer physics: charging, singing, inertia, pinch
    function updatePointers(dt) {
      const now = performance.now();
      for (const p of input.pointers.values()) {
        const age = now - p.t0;
        if (p.mode === "press") {
          p.charge = Math.max(0, Math.min(1, (age - CHARGE_FROM) / (CHARGE_TO - CHARGE_FROM)));
          if (age > HOLD_MS) startEmitting(p);
        }
        if (p.mode === "emit" && p.emitter) {
          // light has inertia: the source trails the finger
          p.ex += (p.x - p.ex) * 0.28;
          p.ey += (p.y - p.ey) * 0.28;
          p.emitter.x = p.ex; p.emitter.y = p.ey;
          p.emitter.amp += (HOLD_AMP - p.emitter.amp) * 0.25;
          if (scored()) {
            level.energyUsed += dt;
            if (energyLeft() <= 0) { stopEmitting(p); p.mode = "spent"; }
          }
          if (p.voice) audio.holdMove(p.voice, p.ex, p.ey);
        }
      }
      const pin = input.pinch;
      let mul = 1;
      if (pin.active && input.pointers.size >= 2) {
        const [a, b] = [...input.pointers.values()];
        const d = Math.hypot(a.px - b.px, a.py - b.py);
        const s = d / pin.d0;
        pin.x = (a.x + b.x) / 2; pin.y = (a.y + b.y) / 2;
        pin.force = Math.max(-1, Math.min(1, (1 - s) * 1.6));
        mul = Math.max(0.4, Math.min(1.75, Math.pow(s, 0.9)));
      } else {
        pin.force *= 0.9;
      }
      input.c2Mul += (mul - input.c2Mul) * 0.05;
      field.c2 = Math.min(0.46, FIELD.C2 * cfg.waveSpeed * cfg.waveSpeed * input.c2Mul);
    }

    // ------------------------------------------------ UI (editorial, tiny)
    function buildUi(root) {
      root.innerHTML = `
<style>
.rs-ui{position:absolute;inset:0;pointer-events:none;color:#dfe4ff;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,"Roboto Mono",monospace;
  -webkit-font-smoothing:antialiased;letter-spacing:.08em;user-select:none;-webkit-user-select:none}
.rs-tl,.rs-tr{position:absolute;top:0;padding:18px 20px;transition:opacity 1.2s ease}
.rs-tl{left:0}.rs-tr{right:0;text-align:right}
.rs-k{font-size:9px;opacity:.32;text-transform:uppercase;letter-spacing:.24em}
.rs-v{font-size:12px;opacity:.62;margin-top:4px}
.rs-e{font-size:9px;opacity:.26;margin-top:10px;letter-spacing:.2em}
.rs-dots{margin-top:9px;height:6px;display:flex;gap:6px}
.rs-dots i{width:4px;height:4px;border-radius:50%;background:#dfe4ff;opacity:.45;transition:opacity .6s}
.rs-dots i.u{opacity:.08}
.rs-center{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;transition:opacity .9s ease}
.rs-center.low{top:76%}
.rs-line{font-size:10px;letter-spacing:.3em;text-transform:uppercase;opacity:0;margin:9px 0;transition:opacity 1.1s ease}
.rs-line.on{opacity:.62}
.rs-line b{font-weight:400;opacity:.5;margin-right:1.4em}
.rs-label{font-size:9px;letter-spacing:.34em;text-transform:uppercase;opacity:.35}
.rs-total{font-size:22px;letter-spacing:.14em;opacity:.8;margin-top:12px}
.rs-gap{height:34px}
.rs-btn{pointer-events:auto;display:block;margin:0 auto;background:none;border:0;color:inherit;font:inherit;font-size:10px;
  letter-spacing:.38em;text-transform:uppercase;opacity:.55;padding:16px 36px;min-width:180px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.rs-btn:active{opacity:.95}
.rs-title{position:absolute;left:0;right:0;top:64%;text-align:center;font-size:10px;letter-spacing:.8em;text-indent:.8em;opacity:0;transition:opacity 2.4s ease}
</style>
<div class="rs-ui">
  <div class="rs-tl" style="opacity:0"><div class="rs-k">level</div><div class="rs-v rs-level">01 / 12</div><div class="rs-dots"></div></div>
  <div class="rs-tr" style="opacity:0"><div class="rs-k">resonance</div><div class="rs-v rs-res">0%</div><div class="rs-e"><span class="rs-en"></span></div></div>
  <div class="rs-center"></div>
  <div class="rs-title">RESONANCE</div>
</div>`;
    }
    const $ = sel => ui.querySelector(sel);
    const elTL = $(".rs-tl"), elTR = $(".rs-tr"), elLevel = $(".rs-level"), elRes = $(".rs-res"), elEn = $(".rs-en");
    const elDots = $(".rs-dots"), elCenter = $(".rs-center"), elTitle = $(".rs-title");
    const sa = ctx.safeArea || { top: 0 };
    elTL.style.paddingTop = elTR.style.paddingTop = (Math.max(18, (sa.top || 0) + 14)) + "px";

    function showCenter(html, low) {
      elCenter.innerHTML = html;
      elCenter.classList.toggle("low", !!low);
      for (const b of elCenter.querySelectorAll("[data-act]")) {
        ctx.input.activate(b, () => onButton(b.getAttribute("data-act")));
      }
    }
    function onButton(act) {
      audio.unlock();
      if (act === "retrace" && state.mode === "lost") beginReveal();
      else if (act === "again" && state.mode === "lost") {
        clearField(field); configureField(field, level.def); warmField(field);
        resetAttempt(); showCenter(""); setMode("play");
      } else if (act === "restart" && state.mode === "finale") { showCenter(""); restartRun(); }
    }

    function updateHud() {
      const playing = state.mode === "play" || state.mode === "reveal" || state.mode === "resonance";
      const visible = playing ? "1" : "0";
      if (elTL.style.opacity !== visible) { elTL.style.opacity = visible; elTR.style.opacity = visible; }
      const lv = pad2(state.levelIndex + 1) + " / " + LEVELS.length;
      if (display.levelShown !== lv) { display.levelShown = lv; elLevel.textContent = lv; }
      const thr = level.def ? threshold() : 1;
      const shownMatch = state.mode === "resonance" ? state.lastResult.R : Math.min(0.99, display.match / thr * 0.9);
      const pct = Math.round(shownMatch * 100);
      if (pct !== display.shown) { display.shown = pct; elRes.textContent = pct + "%"; }
      const en = level.def ? "ENERGY " + energyLeft().toFixed(2) : "";
      if (en !== display.energyShown) { display.energyShown = en; elEn.textContent = en; }
      const maxA = level.def && level.def.maxActions;
      const want = maxA ? maxA + ":" + Math.max(0, actionsLeft()) : "";
      if (elDots.dataset.k !== want) {
        elDots.dataset.k = want;
        let s = "";
        if (maxA) for (let i = 0; i < maxA; i++) s += i < actionsLeft() ? "<i></i>" : '<i class="u"></i>';
        elDots.innerHTML = s;
      }
    }

    // ------------------------------------------------ simulation tick (60 Hz)
    let tickCount = 0;
    const RES_COLLAPSE_AT = 3.3, RES_END_AT = 4.4;

    function fixedTick(stepMs) {
      const dt = stepMs / 1000;
      tickCount++;
      state.clock += dt;
      state.t += dt;
      updatePointers(dt);

      state.simAcc += FIELD.SUBSTEPS * state.simScale;
      let n = 0;
      while (state.simAcc >= 1 && n < 6) { stepField(field); state.simAcc -= 1; n++; }

      const m = state.mode;
      if (m === "prelude") {
        if (state.preludeTouched >= 0 && state.clock - state.preludeTouched > 3.2 && input.pointers.size === 0 && fieldCalm()) {
          elTitle.style.opacity = "0";
          prepareLevel(state.levelIndex);
          beginReveal();
        }
      } else if (m === "reveal") {
        const dur = level.def.reveal * cfg.revealScale;
        if (state.t > dur + 0.9) beginPlay();
      } else if (m === "play") {
        level.playTime += dt;
        if (tickCount % 3 === 0) {
          coarseMap(field, coarse, coarseTmp, level.target.base);
          const s = matchScore(coarse, level.target.coarse, level.masks);
          display.match = s > display.match ? display.match + (s - display.match) * 0.6 : display.match + (s - display.match) * 0.12;
          level.peak = Math.max(level.peak, s);
          audio.setMatch(display.match);
          if (s >= threshold()) { level.peak = s; winLevel(); return; }
        }
        const exhausted = actionsLeft() <= 0 || energyLeft() < 0.5;
        if (exhausted && input.pointers.size === 0 && field.emitters.length === 0 &&
            level.playTime - level.lastActionAt > 1.6 && fieldCalm()) {
          loseLevel();
        }
      } else if (m === "resonance") {
        if (state.t > RES_END_AT) { setMode("collapse"); }
      } else if (m === "collapse") {
        if (state.t > 0.7) { showCenter(""); nextLevel(); }
      }
    }

    // ------------------------------------------------ presentation (per frame)
    function presentation(dt) {
      const m = state.mode, t = state.t;
      const ease = (a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
      let simScale = 1, hang = 1, gain = 1, ghost = 0, warmth = 0, chaos = 0, scatter = 0, bloomBoost = 0;
      state.ring[3] = 0;
      if (m === "prelude") {
        ghost = 0;
      } else if (m === "reveal") {
        const dur = level.def.reveal * cfg.revealScale;
        const fin = ease(0.1, 0.5), fout = 1 - ease(dur + 0.25, dur + 0.9);
        ghost = 1.6 * fin * fout;
        state.ghostTint = [0.6, 0.68, 1.0];
      } else if (m === "play") {
        const mm = display.match;
        ghost = Math.pow(mm, 3) * 0.55;
        warmth = mm * mm * 0.6;
        state.ghostTint = [0.55, 0.65, 1.0];
        const lowEnergy = level.def && (energyLeft() < 0.5 || actionsLeft() <= 0);
        if (lowEnergy) gain = 0.85;
      } else if (m === "resonance") {
        simScale = Math.max(0.015, 1 - ease(0, 0.18));
        hang = Math.max(0.02, 1 - ease(0, 0.25));
        bloomBoost = ease(0, 0.35) * (1 - ease(RES_COLLAPSE_AT, RES_END_AT)) * (0.9 + 0.1 * Math.sin(t * 2.4));
        gain = 1 + bloomBoost * 0.25;
        ghost = bloomBoost * 0.25;
        warmth = 0.35 + bloomBoost * 0.3;
        state.ghostTint = [1.0, 0.9, 0.82];
        state.ring = [level.centroid[0], 1 - level.centroid[1], 0.03 + t * 0.32, 0.22 * Math.max(0, 1 - t / 2.4) * ease(0.1, 0.3)];
        if (t > RES_COLLAPSE_AT) {
          const c = ease(RES_COLLAPSE_AT, RES_END_AT);
          gain *= 1 - c;
          scatter = c * 0.3;
          hang = c;
        }
        if (t > 1.0 && !state.shownScores) {
          state.shownScores = true;
          const r = state.lastResult;
          showCenter(
            '<div class="rs-line"><b>resonance</b>' + Math.round(r.R * 100) + '%</div>' +
            '<div class="rs-line"><b>control</b>' + Math.round(r.C * 100) + '%</div>' +
            '<div class="rs-line"><b>energy</b>' + Math.round(r.E * 100) + '%</div>', true
          );
          const lines = elCenter.querySelectorAll(".rs-line");
          lines.forEach((el, i) => ctx.timeout(() => el.classList.add("on"), 60 + i * 380));
        }
        if (t > RES_COLLAPSE_AT && elCenter.style.opacity !== "0") elCenter.style.opacity = "0";
      } else if (m === "collapse") {
        gain = 0;
        hang = 1;
      } else if (m === "lost") {
        const c = ease(0, 1.4);
        chaos = c * (1 - ease(2.2, 3.4));
        scatter = (1 - ease(0, 1.2)) * 0.8;
        gain = 1 - c * 0.85;
        simScale = 1;
        if (t > 1.2 && !state.shownLost) {
          state.shownLost = true;
          showCenter(
            '<div class="rs-line on">resonance lost</div><div class="rs-gap"></div>' +
            '<button class="rs-btn" data-act="retrace">retrace</button>' +
            '<button class="rs-btn" data-act="again">again</button>'
          );
          elCenter.style.opacity = "1";
        }
      } else if (m === "finale") {
        gain = 0.8;
        warmth = 0.4;
      }
      if (m !== "resonance") state.shownScores = false;
      if (m !== "lost") state.shownLost = false;
      if (m !== "resonance" && m !== "lost" && elCenter.style.opacity === "0") elCenter.style.opacity = "1";
      const k = 1 - Math.exp(-dt * 6);
      state.simScale = simScale;
      state.hang += (hang - state.hang) * k;
      state.gain += (gain - state.gain) * (m === "collapse" ? 1 : k);
      state.ghost += (ghost - state.ghost) * k;
      state.warmth += (warmth - state.warmth) * k;
      state.chaos += (chaos - state.chaos) * k;
      state.scatter = scatter;
      state.bloomBoost += (bloomBoost - state.bloomBoost) * k;
    }

    // ------------------------------------------------ render
    const coresData = new Float32Array(MAX_CORES * 4);
    function uploadField() {
      const { h, hp, expo, wall } = field;
      const b = fieldBytes;
      const norm = level.expoNorm;
      const base = level.target && level.target.base;
      for (let i = 0, o = 0; i < field.n; i++, o += 4) {
        const v = h[i];
        const a = Math.min(1, Math.abs(v));
        b[o] = 127.5 + (v < 0 ? -1 : 1) * Math.sqrt(a) * 127.5;
        const ev = base ? Math.max(0, expo[i] - base[i]) : expo[i];
        b[o + 1] = 255 * (1 - Math.exp(-Math.sqrt(ev) * norm * 1.4));
        b[o + 2] = wall[i] ? 255 : 0;
        const w = (v - hp[i]) * 4;
        const aw = Math.min(1, Math.abs(w));
        b[o + 3] = 127.5 + (w < 0 ? -1 : 1) * Math.sqrt(aw) * 127.5;
      }
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
    }

    function fillCores() {
      coresData.fill(0);
      let c = 0;
      const put = (x, y, s, sing) => {
        if (c >= MAX_CORES) return;
        coresData[c * 4] = x; coresData[c * 4 + 1] = 1 - y; coresData[c * 4 + 2] = s; coresData[c * 4 + 3] = sing ? 1 : 0;
        c++;
      };
      if (field.fixed) for (const f of field.fixed) put(f.x, f.y, 0.55 * state.gain, true);
      for (const p of input.pointers.values()) {
        if (p.mode === "press") put(p.x, p.y, 0.25 + p.charge * 0.9, false);
        else if (p.mode === "emit") put(p.ex, p.ey, 0.9, true);
      }
      if (state.mode === "prelude") {
        const breathe = 0.16 + 0.07 * Math.sin(state.clock * 1.3);
        const d = LEVELS[0].solution[0];
        put(d.x, d.y, breathe * (state.preludeTouched < 0 ? 1 : Math.max(0, 1 - (state.clock - state.preludeTouched))), false);
      }
    }

    function bindQuad(prog) {
      gl.useProgram(prog.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    function tex(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
    function drawTo(target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    }

    // trail persistence is defined per 60 Hz frame; keep it time-true
    function framePersist(dt) {
      const p = Math.max(0, Math.min(0.97, cfg.persist));
      return p <= 0 ? 0 : Math.pow(p, dt * 60);
    }

    function render(dt) {
      if (resize(false)) {
        // the grid changed shape: rebuild the level for the new field
        if (state.mode !== "prelude" && state.mode !== "finale") { prepareLevel(state.levelIndex); beginReveal(); }
      }
      presentation(dt);
      updateParticles(Math.min(dt, 0.05), state.clock);
      uploadField();
      fillCores();

      const prev = acc[accIndex], next = acc[1 - accIndex];
      gl.disable(gl.BLEND);
      drawTo(next);
      bindQuad(progScene);
      const u = progScene.u;
      tex(0, prev.tex, u.uPrev); tex(1, fieldTex, u.uField); tex(2, targetTex, u.uTarget);
      gl.uniform2f(u.uGrid, gw, gh);
      gl.uniform1f(u.uAspect, W / H);
      const persist = framePersist(dt);
      gl.uniform1f(u.uPersist, persist);
      gl.uniform1f(u.uTime, state.clock);
      gl.uniform1f(u.uGain, state.gain * cfg.exposure);
      gl.uniform1f(u.uGhost, state.ghost);
      gl.uniform3f(u.uGhostTint, state.ghostTint[0], state.ghostTint[1], state.ghostTint[2]);
      gl.uniform1f(u.uHdr, HDR);
      gl.uniform4fv(u.uCores, coresData);
      gl.uniform4f(u.uRing, state.ring[0], state.ring[1], state.ring[2], state.ring[3]);
      gl.uniform1f(u.uChaos, state.chaos);
      gl.uniform1f(u.uWarmth, state.warmth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // particles: additive into the same exposure
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progPart.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      const P = particles;
      if (partBuf.n !== P.N) {
        gl.bufferData(gl.ARRAY_BUFFER, P.verts.byteLength, gl.DYNAMIC_DRAW);
        partBuf.n = P.N;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.verts);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      const pScale = (1 - persist) * HDR * state.gain * cfg.exposure;
      gl.uniform1f(progPart.u.uSize, Math.max(1, sceneW / W) * 1.1);
      gl.uniform1f(progPart.u.uScale, pScale * 1.3);
      gl.uniform1f(progPart.u.uPoint, 1);
      gl.drawArrays(gl.POINTS, 0, P.N);
      gl.uniform1f(progPart.u.uScale, pScale * 1.1);
      gl.uniform1f(progPart.u.uPoint, 0);
      gl.drawArrays(gl.LINES, P.N, P.N * 2);
      gl.disable(gl.BLEND);

      // bloom: a tight glow and a wide atmospheric haze
      drawTo(bloomA); bindQuad(progDown);
      tex(0, next.tex, progDown.u.uSrc);
      gl.uniform2f(progDown.u.uTexel, 1 / next.w, 1 / next.h);
      gl.uniform1f(progDown.u.uKnee, 0.35 * HDR);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      blur(bloomA, bloomB);
      drawTo(bloomC); bindQuad(progDown);
      tex(0, bloomA.tex, progDown.u.uSrc);
      gl.uniform2f(progDown.u.uTexel, 1 / bloomA.w, 1 / bloomA.h);
      gl.uniform1f(progDown.u.uKnee, 0.2 * HDR);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      blur(bloomC, bloomD);
      blur(bloomC, bloomD);

      drawTo(null); bindQuad(progComp);
      const c = progComp.u;
      tex(0, next.tex, c.uScene); tex(1, bloomA.tex, c.uBloom1); tex(2, bloomC.tex, c.uBloom2);
      gl.uniform2f(c.uRes, canvas.width, canvas.height);
      gl.uniform1f(c.uHdr, HDR);
      gl.uniform1f(c.uCA, cfg.chroma * (1 + state.chaos * 3));
      gl.uniform1f(c.uBloom, cfg.bloom * (1 + state.bloomBoost * 0.3));
      gl.uniform1f(c.uExposure, 1.0);
      gl.uniform1f(c.uGrain, cfg.grain);
      gl.uniform1f(c.uTime, state.clock);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      accIndex = 1 - accIndex;

      updateHud();
    }

    function blur(a, tmp) {
      bindQuad(progBlur);
      drawTo(tmp);
      tex(0, a.tex, progBlur.u.uSrc);
      gl.uniform2f(progBlur.u.uDir, 1 / a.w, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawTo(a);
      tex(0, tmp.tex, progBlur.u.uSrc);
      gl.uniform2f(progBlur.u.uDir, 0, 1 / a.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    ctx.onDestroy(() => {
      releaseAllPointers();
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    });

    // ------------------------------------------------ start
    await loadCheckpoint();
    prepareLevel(state.levelIndex);
    ctx.game.loop({ fixedHz: 60, maxSubsteps: 4, fixedUpdate: fixedTick, render: (alpha, s) => render(Math.min(0.1, (s && s.dtMs ? s.dtMs : 16.7) / 1000)) });
    render(1 / 60);
    ctx.timeout(() => { if (state.mode === "prelude") elTitle.style.opacity = "0.3"; }, 400);
    if (ctx.markVisualReady) ctx.markVisualReady("field");
    ctx.platform.ready();
  }
};

// ------------------------------------------------------------ generative sound
//
// Pulses ring like struck glass; held sources sing; the field's resonance is
// a quiet harmonic bed that opens up as the formation approaches.
function createAudio(cfg) {
  let ac = null, master = null, wet = null, bed = null;
  const SCALE = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19]; // lydian, two octaves
  const ROOT = 130.81;
  const noteFor = (y, s) => {
    const idx = Math.max(0, Math.min(SCALE.length - 1, Math.round((1 - y) * (SCALE.length - 1))));
    return ROOT * Math.pow(2, SCALE[idx] / 12) / (s > 1.35 ? 2 : 1);
  };

  function unlock() {
    if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
    } catch (e) { ac = null; return; }
    master = ac.createGain();
    master.gain.value = 0.55 * cfg.volume;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    // long synthetic room
    const conv = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 3.2);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    wet = ac.createGain(); wet.gain.value = 0.5;
    wet.connect(conv); conv.connect(master);
    // harmonic bed
    bed = { gain: ac.createGain(), filter: ac.createBiquadFilter(), oscs: [] };
    bed.gain.gain.value = 0;
    bed.filter.type = "lowpass"; bed.filter.frequency.value = 400;
    bed.filter.connect(bed.gain); bed.gain.connect(master); bed.gain.connect(wet);
    [1, 1.5, 2, 3].forEach((m, i) => {
      const o = ac.createOscillator();
      o.type = i === 3 ? "triangle" : "sine";
      o.frequency.value = ROOT / 2 * m;
      o.detune.value = (i - 1.5) * 4;
      const g = ac.createGain(); g.gain.value = [0.5, 0.3, 0.22, 0.08][i];
      o.connect(g); g.connect(bed.filter); o.start();
      bed.oscs.push({ o, g });
    });
  }

  function voice(freq, peak, attack, decay, type, when) {
    if (!ac) return;
    const t = (when || ac.currentTime);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    const f = ac.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 2400;
    f.connect(g); g.connect(master); g.connect(wet);
    [0, 5].forEach(det => {
      const o = ac.createOscillator();
      o.type = type || "sine";
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + attack + decay + 0.1);
    });
  }

  return {
    unlock,
    setVolume() { if (master) master.gain.setTargetAtTime(0.55 * cfg.volume, ac.currentTime, 0.1); },
    pulse(x, y, s) {
      if (!ac) return;
      const f = noteFor(y, s);
      voice(f, 0.12 * Math.min(1.5, s), 0.012, 2.2 + s, "sine");
      voice(f * 2.01, 0.025, 0.02, 1.2, "triangle");
    },
    flick(x, y, speed) {
      if (!ac) return;
      const f = noteFor(y, 1.7);
      voice(f, 0.15, 0.008, 3, "sine");
      voice(f * 3, 0.02, 0.01, 0.9, "triangle");
      // a breath of air
      const len = Math.floor(ac.sampleRate * 0.5);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900 + speed * 500; bp.Q.value = 1.2;
      const g = ac.createGain(); g.gain.value = 0.05;
      src.connect(bp); bp.connect(g); g.connect(wet); src.start();
    },
    holdStart(x, y) {
      if (!ac) return null;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, ac.currentTime);
      g.gain.linearRampToValueAtTime(0.06, ac.currentTime + 0.35);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1600;
      f.connect(g); g.connect(master); g.connect(wet);
      const freq = noteFor(y, 1);
      const oscs = [0, 7, 1200].map((det, i) => {
        const o = ac.createOscillator();
        o.type = i === 2 ? "triangle" : "sine";
        o.frequency.value = freq; o.detune.value = det;
        const og = ac.createGain(); og.gain.value = i === 2 ? 0.15 : 0.5;
        o.connect(og); og.connect(f); o.start();
        return o;
      });
      return { g, oscs };
    },
    holdMove(v, x, y) {
      if (!ac || !v) return;
      const freq = ROOT * Math.pow(2, ((1 - y) * 19) / 12);
      for (const o of v.oscs) o.frequency.setTargetAtTime(freq, ac.currentTime, 0.08);
    },
    holdStop(v) {
      if (!ac || !v) return;
      const t = ac.currentTime;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0, t, 0.25);
      for (const o of v.oscs) o.stop(t + 1.5);
    },
    setMatch(m) {
      if (!ac || !bed) return;
      const t = ac.currentTime;
      bed.gain.gain.setTargetAtTime(Math.pow(m, 2) * 0.09, t, 0.3);
      bed.filter.frequency.setTargetAtTime(300 + m * m * 2600, t, 0.3);
    },
    reveal() {
      if (!ac) return;
      voice(ROOT * 2, 0.03, 0.6, 2.5, "sine");
      if (bed) bed.gain.gain.setTargetAtTime(0, ac.currentTime, 0.4);
    },
    resonance() {
      if (!ac) return;
      const t = ac.currentTime;
      [1, 1.5, 2.25, 3].forEach((m, i) => voice(ROOT * m, [0.09, 0.06, 0.04, 0.025][i], 0.5 + i * 0.1, 4.5, "sine", t));
      if (bed) {
        bed.filter.frequency.setTargetAtTime(3200, t, 0.2);
        bed.gain.gain.setTargetAtTime(0.1, t, 0.2);
        bed.gain.gain.setTargetAtTime(0, t + 3.2, 0.6);
      }
    },
    lost() {
      if (!ac) return;
      const t = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      const f = ac.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 2.6);
      f.connect(g); g.connect(master); g.connect(wet);
      [0, 23].forEach(det => {
        const o = ac.createOscillator();
        o.frequency.setValueAtTime(ROOT * 1.5, t);
        o.frequency.exponentialRampToValueAtTime(ROOT * 0.75, t + 2.6);
        o.detune.value = det; o.connect(f); o.start(t); o.stop(t + 3);
      });
      if (bed) bed.gain.gain.setTargetAtTime(0, t, 0.3);
    },
    dispose() {
      try { if (ac) ac.close(); } catch (e) {}
      ac = null;
    }
  };
}
