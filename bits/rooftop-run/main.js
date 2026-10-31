// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// THE LAST SIGNAL — a 3D rooftop traversal game for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// ROOFTOP RUN — shared math (from UNMAKE's 00_util, trimmed).
// World axes: x = across the rooftops, y = up, -z = the way forward.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  return r;
}

// A critically damped spring: x chases target with no overshoot unless
// `zeta` < 1. Used for every "physical" response in the rig and camera.
function spring(s, target, freq, zeta, dt) {
  const w = TAU * freq, f = 1 + 2 * dt * zeta * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const x = (f * s.x + dt * s.v + hhoo * target) * det;
  s.v = (s.v + hoo * (target - s.x)) * det;
  s.x = x;
  return x;
}
const mkSpring = x => ({ x: x || 0, v: 0 });

// ---- 01_tuning.js ----
// =====================================================================
// Every gameplay number lives here. The lab panel edits these live.
// Units: metres, seconds, metres per second.
// =====================================================================

const TUNING = {
  cat: {
    // body: a cat is long and low. The collision box is axis-aligned.
    halfWidth: 0.13, halfLength: 0.26, standHeight: 0.40, crouchHeight: 0.22,
    // forward run: automatic. The stick's vertical axis sets the pace.
    cruise: 5.6, sprint: 7.2, walk: 0, accel: 7.5, brake: 14, startBoost: 0.6,
    paceDead: 0.32,             // vertical stick travel ignored, so steering never brakes by accident
    // lateral steering (target velocity, then acceleration toward it)
    lateral: 4.2, lateralAccel: 24, lateralAccelAir: 10, lateralDecel: 30,
    // narrow surfaces (ledges, pipes): below this width the cat steadies itself
    narrowWidth: 0.75, narrowLateral: 0.55, narrowCentering: 6,
    // thin pipes are balance surfaces: careful pace, stronger roll-off. Squeezing is a crawl.
    balanceWidth: 0.4, balanceSpeed: 3.6, balancePull: 1.6, crawlSpeed: 3.0,
    // slopes: sideways pull toward the eaves; uphill slows, downhill speeds
    slopePush: 1.6, slopeClimb: 0.45, slopeDescend: 0.25,
    // edge grip: steering off a side edge is resisted this long before the cat lets go
    edgeGrip: 0.22,
    // jump. apex = jumpVel^2 / (2 * gravity) ~ 1.16 m
    gravity: 23, jumpVel: 7.3, jumpForward: 0.9, fallMul: 1.55, jumpCut: 2.6, maxFall: 26,
    jumpMinHold: 0.13,           // hold mode: a tap still gets this much full-strength rise
    coyote: 0.11, buffer: 0.14,
    stepUp: 0.2, slopeSnap: 0.28,
    // landing
    hardLanding: 10.5, hardLandingSlow: 0.55, hardLandingTime: 0.35,
    // stumble: running nose-first into a wall
    stumbleSpeed: 0.25, stumbleTime: 0.55,
    // recovery
    killDepth: 5
  },
  assist: {
    enabled: true,
    // in-air lateral nudge toward a surface the cat would narrowly miss
    lateralReach: 0.4, lateralAccel: 9,
    // on the ground: running at a narrow surface slightly off-line lines the cat up with it
    alignReach: 0.45, alignAhead: 2.2, alignStrength: 5,
    // ledge scramble: front paws catch an edge the cat came up just short of
    scramble: true, scrambleReach: 0.32, scrambleDrop: 0.42, scrambleTime: 0.26, scrambleSpeed: 0.7
  },
  hazards: {
    // steam vents cycle: idle, then a visible hissing warning, then the burst
    steamIdle: 1.5, steamWarn: 0.55, steamBurst: 0.7, steamRadius: 0.5, steamHeight: 2.4,
    steamKnockUp: 4.2, steamStumble: 0.6,
    // unstable catwalk: creaks once stood on, then gives way
    creakTime: 0.5, fallGravity: 16, resetTime: 3.5,
    // suspended rope bridges sway and carry the cat sideways
    swayAmp: 0.14, swayRate: 1.7,
    pickupRadius: 0.55, relayRadius: 1.3, waypointRadius: 3
  },
  input: {
    jumpMode: 'hold',            // 'hold' (variable height) or 'tap' (always full)
    stickRadius: 52, stickDead: 0.1, stickCurve: 1.35,
    jumpZone: 0.45               // right fraction of the screen that also jumps
  },
  camera: {
    landscape: { fov: 52, back: 1.42, up: 0.7, lookAhead: 5.5, lookUp: -0.05, follow: 0.82 },
    portrait: { fov: 60, back: 1.95, up: 1.02, lookAhead: 6, lookUp: -0.25, follow: 0.72 },
    speedBack: 0.05, speedFov: 1.2,
    posK: 7, heightK: 3.5, airHeightK: 1.6, lookK: 6,
    terrainProbe: [3, 6, 10, 14], gapLift: 0.3, gapBack: 0.25, arcFollow: 0.35,
    landDip: 0.05, nearClip: 0.4
  }
};

// ---- 02_world.js ----
// =====================================================================
// Collision world. Every solid is a shape with an axis-aligned bound
// (x0..x1, y0..y1, z0..z1) and a height function for its top:
//   box     flat top at y1
//   gableZ  pitched roof, ridge running along z (slopes fall away in x)
//   gableX  pitched roof, ridge running across (slopes fall away in z)
//   shed    lean-to roof, height runs linearly from yNear (z1) to yFar (z0)
//   pipeZ   a cylinder along z: centre (cx, cy), radius r; with cyFar it inclines
//           (cy at the near end z1, cyFar at the far end z0)
// Moving surfaces carry offsets: dy (a walkway giving way), dx (a bridge swaying).
// Slopes and pipe curvature are real collision, not decoration: the cat
// stands on the height function and feels its gradient.
// Tags: kind (what the renderer builds), surface, walk, cam ('block' |
// 'fade' | 'none'), far (scenery: landing there is a fall).
// =====================================================================

class World {
  constructor() { this.boxes = []; this.cell = 8; this.grid = new Map(); }
  add(b) {
    b.shape = b.shape || 'box';
    b.id = this.boxes.length;
    this.boxes.push(b);
    for (let cz = Math.floor(b.z0 / this.cell); cz <= Math.floor(b.z1 / this.cell); cz++) {
      let list = this.grid.get(cz); if (!list) this.grid.set(cz, list = []);
      list.push(b);
    }
    return b;
  }
  near(z0, z1) {
    const out = [], seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
      const list = this.grid.get(cz); if (!list) continue;
      for (const b of list) if (!seen.has(b.id) && !b.gone) { seen.add(b.id); out.push(b); }
    }
    return out;
  }

  // ---- shape functions ----
  pipeY(b, z) { return b.cyFar === undefined ? b.cy : lerp(b.cy, b.cyFar, (b.z1 - z) / (b.z1 - b.z0)); }
  topAt(b, x, z) {
    x -= b.dx || 0;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return -Infinity;
    const dy = b.dy || 0;
    switch (b.shape) {
      case 'gableZ': { const hw = (b.x1 - b.x0) / 2; return dy + b.yr - (b.yr - b.ye) * Math.abs(x - (b.x0 + hw)) / hw; }
      case 'gableX': { const hl = (b.z1 - b.z0) / 2; return dy + b.yr - (b.yr - b.ye) * Math.abs(z - (b.z0 + hl)) / hl; }
      case 'shed': return dy + lerp(b.yNear, b.yFar, (b.z1 - z) / (b.z1 - b.z0));
      case 'pipeZ': { const d = x - b.cx; return Math.abs(d) >= b.r ? -Infinity : dy + this.pipeY(b, z) + Math.sqrt(b.r * b.r - d * d); }
      default: return b.y1 + dy;
    }
  }
  bottomAt(b, x, z) {
    x -= b.dx || 0;
    if (b.shape === 'pipeZ') { const d = x - b.cx; return Math.abs(d) >= b.r ? Infinity : (b.dy || 0) + this.pipeY(b, z) - Math.sqrt(b.r * b.r - d * d); }
    return b.y0 + (b.dy || 0);
  }
  // slope of the top surface: [d top / dx, d top / dz]
  grad(b, x, z) {
    x -= b.dx || 0;
    switch (b.shape) {
      case 'gableZ': { const hw = (b.x1 - b.x0) / 2; return [-(b.yr - b.ye) / hw * sign(x - (b.x0 + hw)), 0]; }
      case 'gableX': { const hl = (b.z1 - b.z0) / 2; return [0, -(b.yr - b.ye) / hl * sign(z - (b.z0 + hl))]; }
      case 'shed': return [0, (b.yNear - b.yFar) / (b.z1 - b.z0)];
      case 'pipeZ': { const d = clamp(x - b.cx, -b.r * 0.97, b.r * 0.97); return [-d / Math.sqrt(b.r * b.r - d * d), b.cyFar === undefined ? 0 : (b.cy - b.cyFar) / (b.z1 - b.z0)]; }
      default: return [0, 0];
    }
  }
  // how wide the cat can comfortably stand across this shape
  walkWidth(b) { return b.shape === 'pipeZ' ? b.r * 1.3 : b.x1 - b.x0; }
  centreX(b) { return (b.dx || 0) + (b.shape === 'pipeZ' ? b.cx : (b.x0 + b.x1) / 2); }

  // points sampled across a footprint for shaped tops
  samples(x, z, hx, hz) {
    const s = this._s || (this._s = []); s.length = 0;
    s.push([x, z], [x - hx, z], [x + hx, z], [x, z - hz], [x, z + hz]);
    return s;
  }
  // highest top at or below fromY under a footprint. -> { y, box }
  groundAt(x, z, fromY, hx, hz) {
    hx = hx || 0; hz = hz || 0;
    let y = -Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      const ox = b.dx || 0;
      if (x + hx <= b.x0 + ox || x - hx >= b.x1 + ox || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.shape === 'box') { if (b.y1 + (b.dy || 0) <= fromY + 1e-4 && b.y1 + (b.dy || 0) > y) { y = b.y1 + (b.dy || 0); box = b; } continue; }
      for (const [sx, sz] of this.samples(x, z, hx * 0.5, hz * 0.5)) {
        const t = this.topAt(b, sx, sz);
        if (t <= fromY + 1e-4 && t > y) { y = t; box = b; }
      }
    }
    return { y, box };
  }
  // lowest underside at or above fromY over a footprint
  ceilingAt(x, z, fromY, hx, hz) {
    let y = Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      const ox = b.dx || 0;
      if (x + hx <= b.x0 + ox || x - hx >= b.x1 + ox || z + hz <= b.z0 || z - hz >= b.z1) continue;
      const u = b.shape === 'pipeZ' ? this.bottomAt(b, x, z) : b.y0 + (b.dy || 0);
      if (u >= fromY - 1e-4 && u < y) { y = u; box = b; }
    }
    return { y, box };
  }
  // solids intruding into a volume; top is the highest intruding surface
  solids(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) {
      const dy = b.dy || 0, ox = b.dx || 0, bx0 = b.x0 + ox, bx1 = b.x1 + ox;
      if (x1 <= bx0 || x0 >= bx1 || z1 <= b.z0 || z0 >= b.z1 || y1 <= b.y0 + dy || y0 >= b.y1 + dy) continue;
      if (b.shape === 'box') { out.push({ b, top: b.y1 + dy }); continue; }
      const cx = clamp((x0 + x1) / 2, bx0, bx1), cz = clamp((z0 + z1) / 2, b.z0, b.z1);
      let top = -Infinity;
      for (const [sx, sz] of [[cx, cz], [clamp(x0, bx0, bx1), cz], [clamp(x1, bx0, bx1), cz], [cx, clamp(z0, b.z0, b.z1)], [cx, clamp(z1, b.z0, b.z1)]]) {
        const t = this.topAt(b, sx, sz);
        if (t > y0 + 1e-3 && this.bottomAt(b, sx, sz) < y1 && t > top) top = t;
      }
      if (top > -Infinity) out.push({ b, top });
    }
    return out;
  }
  overlaps(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) { const ox = b.dx || 0; if (x1 > b.x0 + ox && x0 < b.x1 + ox && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) out.push(b); }
    return out;
  }
  // ray against shapes; returns distance or Infinity
  ray(o, d, maxT, filter) {
    let best = maxT;
    const zs = [o[2], o[2] + d[2] * maxT];
    for (const b of this.near(Math.min(zs[0], zs[1]), Math.max(zs[0], zs[1]))) {
      if (filter && !filter(b)) continue;
      let t0 = 0, t1 = best, ok = true;
      const ox = b.dx || 0, lo = [b.x0 + ox, b.y0, b.z0], hi = [b.x1 + ox, b.y1, b.z1];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) ok = false; continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) ok = false;
      }
      if (!ok || t0 >= best) continue;
      if (b.shape === 'box') { best = t0; continue; }
      // shaped: march through the bound and test the height function
      for (let t = t0; t <= t1; t += 0.12) {
        const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
        if (py < this.topAt(b, px, pz) && py > this.bottomAt(b, px, pz)) { best = t; break; }
      }
    }
    return best < maxT ? best : Infinity;
  }
}

// builders: z0 is always the far end (more negative)
function boxSpan(x0, x1, y0, y1, zFar, zNear, tags) {
  return Object.assign({ shape: 'box', x0, x1, y0, y1, z0: zFar, z1: zNear, surface: 'concrete', cam: 'block' }, tags || {});
}
function gableZ(x0, x1, base, eave, ridge, zFar, zNear, tags) {
  return Object.assign({ shape: 'gableZ', x0, x1, y0: base, y1: ridge, ye: eave, yr: ridge, z0: zFar, z1: zNear, surface: 'tile', cam: 'block', walk: true }, tags || {});
}
function gableX(x0, x1, base, eave, ridge, zFar, zNear, tags) {
  return Object.assign({ shape: 'gableX', x0, x1, y0: base, y1: ridge, ye: eave, yr: ridge, z0: zFar, z1: zNear, surface: 'tile', cam: 'block', walk: true }, tags || {});
}
function shed(x0, x1, base, yNear, yFar, zFar, zNear, tags) {
  return Object.assign({ shape: 'shed', x0, x1, y0: base, y1: Math.max(yNear, yFar), yNear, yFar, z0: zFar, z1: zNear, surface: 'tin', cam: 'block', walk: true }, tags || {});
}
function pipeZ(cx, cy, r, zFar, zNear, tags) {
  const cyFar = tags && tags.cyFar, lo = Math.min(cy, cyFar === undefined ? cy : cyFar), hi = Math.max(cy, cyFar === undefined ? cy : cyFar);
  return Object.assign({ shape: 'pipeZ', cx, cy, r, x0: cx - r, x1: cx + r, y0: lo - r, y1: hi + r, z0: zFar, z1: zNear, surface: 'metal', cam: 'none', walk: true }, tags || {});
}

// ---- 03_slice.js ----
// =====================================================================
// THE LAST SIGNAL — the vertical slice. An old tiled city consumed by
// industry, from a small terrace to the signal relay, with the great relay
// tower always on the horizon. Along the way runs the broken signal line:
// dead waypoint relays that wake as the core passes them.
//
//   ACT 1  ROOFS     A terrace -> B tiled roof (up and over) -> alley jump
//                    -> C ridge run (slopes, chimney, broken section)
//   ACT 2  JUNCTION  the great pipe into a junction tank, then a choice:
//      high road  thin pipe climbing to a scaffold, a swaying rope bridge,
//                 a leap and a drop. Balance and height. Three fragments.
//      centre     the wide pipe through two steam vents. Timing.
//      low road   down to a sunken catwalk, squeeze under a duct, hop a pipe,
//                 climb a ramp. Safe and slower. No fragments.
//                 All three merge on the machine platform (waypoint).
//   ACT 3  CATWALK   a narrow suspended walkway: a broken gap, a squeeze, a
//                    section that gives way if you stall, a fragment overhead
//   ACT 4  RELAY     lean-to tin roof -> 3 m drop -> the relay terrace
//
// Pure data: shapes with a `kind` the renderer turns into architecture,
// hazards, fragments, waypoints, checkpoints. Nothing here knows three.js.
// =====================================================================

const STREET_Y = -16;

function buildSlice(world) {
  const decor = [], vents = [], fragments = [], unstable = [], bridges = [], waypoints = [];
  const add = b => world.add(b);
  const walls = (x0, x1, top, zFar, zNear, tags) => add(boxSpan(x0, x1, STREET_Y, top, zFar, zNear, Object.assign({ kind: 'building' }, tags)));

  // ================= ACT 1: ROOFS =================
  // ---- A: the terrace ----
  walls(-1.7, 1.7, 0, -5, 3, { walk: true, kind: 'terrace' });
  add(boxSpan(-1.7, -1.45, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(1.45, 1.7, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(-1.45, 1.45, 0, 0.42, 2.75, 3, { kind: 'parapet', walk: true }));
  decor.push({ kind: 'pots', x: -1.15, y: 0, z: 0.5 }, { kind: 'pots', x: 1.2, y: 0, z: -2.5 });
  decor.push({ kind: 'lamp', x: 1.4, y: 1.6, z: -4.6, color: 'warm' });
  decor.push({ kind: 'bowl', x: -1.0, y: 0, z: -1.2 });             // someone still feeds the strays here

  // ---- B: tiled roof, ridge across the route ----
  walls(-2.4, 2.4, -0.3, -13, -5, { plaster: 1 });
  add(gableX(-2.65, 2.65, -0.3, 0, 1.3, -13.25, -4.85, { kind: 'roof' }));
  add(boxSpan(-1.6, -0.9, 0.6, 2.2, -9.4, -8.6, { kind: 'chimney' }));
  add(boxSpan(1.15, 1.75, 0.5, 2.0, -9.3, -8.7, { kind: 'chimney' }));
  decor.push({ kind: 'antenna', x: 2.1, y: 0.55, z: -10.5 });

  // ---- C: long roof, ridge along the route; a broken section near its end ----
  walls(-2.2, 2.6, -1.0, -26.0, -14.6, { plaster: 2 });
  walls(-2.2, 2.6, -1.0, -30.2, -27.8, { plaster: 2 });
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -26.0, -14.6, { kind: 'roof' }));
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -30.2, -27.8, { kind: 'roof' }));
  decor.push({ kind: 'brokenRoof', x0: -2.25, x1: 2.65, z0: -27.8, z1: -26.0, y: 0.5, eave: -0.62 });
  add(boxSpan(-0.15, 0.55, 0.2, 1.45, -20.4, -19.6, { kind: 'chimney' }));
  add(boxSpan(1.5, 2.0, -0.3, 0.9, -23.6, -23.0, { kind: 'chimney' }));
  decor.push({ kind: 'lamp', x: -2.3, y: 0.2, z: -17, color: 'warm' });
  fragments.push({ x: -0.75, y: 0.35, z: -22.4 });                 // where the line snapped over the slope
  waypoints.push({ x: 2.3, y: -0.45, z: -29 });                    // first dead relay, on the far eave

  // ================= ACT 2: THE JUNCTION =================
  add(pipeZ(0.2, -0.05, 0.55, -33.2, -29.6, { kind: 'pipe' }));
  add(boxSpan(-1.6, 2.2, -2.5, 0.5, -36.6, -33.2, { kind: 'tank', walk: true, surface: 'metal' }));
  decor.push({ kind: 'lamp', x: -1.5, y: 1.3, z: -36.8, color: 'green' });     // the high road
  decor.push({ kind: 'lamp', x: 2.25, y: 0.1, z: -36.8, color: 'violet' });    // the low road
  decor.push({ kind: 'gauge', x: 0.2, y: 0.5, z: -33.6 });

  // high road: a thin pipe climbing to a scaffold, then a rope bridge, then a drop
  add(pipeZ(-1.1, 0.3, 0.2, -44.6, -36.6, { kind: 'pipe', narrow: true, cyFar: 1.5 }));
  fragments.push({ x: -1.1, y: 1.3, z: -40.6 });
  add(boxSpan(-2.2, -0.3, 1.55, 1.7, -46.6, -44.6, { kind: 'scaffold', walk: true, surface: 'wood' }));
  bridges.push(add(boxSpan(-1.5, -1.0, 1.62, 1.7, -53, -46.6, { kind: 'bridge', walk: true, surface: 'wood', cam: 'none' })));
  fragments.push({ x: -1.25, y: 1.95, z: -50 });
  add(boxSpan(-2.2, -0.4, 1.5, 1.7, -55, -53, { kind: 'scaffold', walk: true, surface: 'wood' }));
  fragments.push({ x: -1.25, y: 2.45, z: -54.3 });                 // leap from the scaffold's edge for it

  // centre: the wide pipe and two vents. Nothing to collect: a test of timing
  const big = add(pipeZ(0.2, -0.05, 0.55, -55, -36.6, { kind: 'pipe' }));
  vents.push({ x: 0.2, y: big.cy + big.r, z: -40, phase: 0 });
  vents.push({ x: 0.2, y: big.cy + big.r, z: -45.4, phase: 1.1 });

  // low road: a sunken catwalk, a squeeze under a duct, a pipe to hop, a ramp back up
  add(boxSpan(1.5, 2.3, -1.08, -1.0, -50.5, -36.6, { kind: 'catwalk', walk: true, surface: 'metal', cam: 'none' }));
  add(boxSpan(1.2, 2.6, -0.7, -0.3, -42, -40.6, { kind: 'duct', cam: 'fade', walk: true }));
  add(boxSpan(1.3, 2.5, -1.0, -0.62, -45.6, -45, { kind: 'hopPipe', walk: true, cam: 'none' }));
  add(shed(1.4, 2.4, -1.6, -1.0, 0.1, -55, -50.5, { kind: 'ramp', surface: 'metal' }));
  decor.push({ kind: 'lamp', x: 2.5, y: -0.2, z: -47, color: 'warm' });

  // the machine platform: the three routes meet
  add(boxSpan(-2.2, 2.6, -0.4, 0.1, -61, -55, { kind: 'grate', walk: true, surface: 'metal' }));
  add(boxSpan(-2.2, -1.4, 0.1, 1.1, -60.5, -58.6, { kind: 'machine' }));
  waypoints.push({ x: 2.2, y: 0.1, z: -59.5 });

  // ================= ACT 3: THE CATWALK =================
  const cw = (zf, zn, extra) => add(boxSpan(-0.4, 0.1, 0.02, 0.1, zf, zn, Object.assign({ kind: 'catwalk', walk: true, surface: 'metal', cam: 'none' }, extra)));
  cw(-64.5, -61);
  // broken gap (1.9 m)
  cw(-69.4, -66.4);
  add(boxSpan(-1.4, 1.2, 0.4, 0.66, -68.2, -67.4, { kind: 'lowPipe', cam: 'fade', walk: true }));
  unstable.push(cw(-72, -69.4, { unstable: true }));
  cw(-78, -72);
  fragments.push({ x: -0.15, y: 1.05, z: -75 });
  decor.push({ kind: 'brokenCatwalk', x0: -0.4, x1: 0.1, z0: -66.4, z1: -64.5, y: 0.1 });
  decor.push({ kind: 'lamp', x: 0.4, y: 1.3, z: -73, color: 'green' });

  // ================= ACT 4: THE RELAY =================
  walls(-1.6, 1.6, -0.9, -84, -78, { plaster: 3 });
  add(shed(-1.65, 1.65, -0.9, 0.1, -0.35, -84, -78, { kind: 'tinRoof' }));
  waypoints.push({ x: 1.35, y: -0.2, z: -82.5 });
  const hY = -1.6;
  walls(-3, 3, hY, -101, -87, { walk: true, kind: 'terrace', plaster: 4 });
  add(boxSpan(-3, -2.75, hY, hY + 0.45, -101, -87, { kind: 'parapet', walk: true }));
  add(boxSpan(2.75, 3, hY, hY + 0.45, -101, -87, { kind: 'parapet', walk: true }));
  add(boxSpan(-2.75, 2.75, hY, hY + 0.45, -101, -100.75, { kind: 'parapet', walk: true }));
  const relay = { x: 0, y: hY, z: -96 };
  decor.push({ kind: 'lamp', x: -2.6, y: hY + 1.6, z: -90, color: 'warm' });

  // the dead signal line: sagging from relay to relay, snapped where fragments fell
  decor.push({ kind: 'signalLine', points: [[-3.5, 3.2, 4], ...waypoints.map(w => [w.x, w.y + 2.9, w.z]), [relay.x, relay.y + 3.15, relay.z]] });
  for (const f of fragments) decor.push({ kind: 'snapped', x: f.x + 0.35, y: f.y + 1.2, z: f.z + 0.4 });

  scenery(world, decor);

  return {
    decor, vents, fragments, unstable, bridges, waypoints, relay,
    tower: { x: 26, z: -255, base: STREET_Y, height: 74 },
    spawn: [0, 0, 1.5],
    endZ: -100,
    checkpoints: [[0, 0, 1.5], [0.2, 0.5, -15.6], [0.2, 0.5, -31], [-1.3, 1.7, -45.6], [1.9, -1.0, -38], [0, 0.1, -57], [-0.15, 0.1, -63], [-0.15, 0.1, -74], [0, 0.1, -78.6], [0, hY, -88.5]]
  };
}

// The neighbourhood: blocks close on both sides of the route at very
// different heights, extensions stacked on top and leaning over the
// alleys, occasional towers, cables and bridges strung overhead, and far
// layers climbing toward the tower. Seeded, so the city is the same every
// visit. All of it is out of reach: landing there counts as a fall.
function scenery(world, decor) {
  const rng = makeRng(1702);
  const corridor = z => z > -5 ? 1.9 : z > -30 ? 3 : z > -55 ? 3.2 : z > -78 ? 2.6 : z > -87 ? 2 : 3.3;
  for (const side of [-1, 1]) {
    let z = 6;
    while (z > -115) {
      const len = 3.5 + rng() * 5.5, zf = z - len;
      const inner = Math.max(corridor(z), corridor(zf), corridor((z + zf) / 2)) + 0.5 + rng() * 1.3;
      const w = 3.5 + rng() * 5;
      const x0 = side < 0 ? -inner - w : inner, x1 = side < 0 ? -inner : inner + w;
      const tower = rng() < 0.14;
      const top = tower ? 6 + rng() * 6 : -5 + rng() * 9;
      world.add(boxSpan(x0, x1, STREET_Y, top, zf, z, { kind: 'building', far: true, plaster: (rng() * 5) | 0 }));
      // an extension stacked on top, offset toward the route
      let rt = top, rx0 = x0, rx1 = x1, rz0 = zf, rz1 = z;
      if (!tower && rng() < 0.55) {
        const ew = w * (0.4 + rng() * 0.35), eh = 1.8 + rng() * 1.6;
        rx0 = side < 0 ? x1 - ew : x0; rx1 = side < 0 ? x1 : x0 + ew;
        rz1 = z - rng() * len * 0.3; rz0 = rz1 - len * (0.4 + rng() * 0.4);
        world.add(boxSpan(rx0, rx1, top, top + eh, rz0, rz1, { kind: 'building', far: true, plaster: (rng() * 5) | 0 }));
        rt = top + eh;
        if (rng() < 0.5) rng();
      }
      const roof = rng();
      if (roof < 0.45) world.add(gableZ(rx0 - 0.15, rx1 + 0.15, rt, rt + 0.3, rt + 0.3 + (rx1 - rx0) * 0.32, rz0 - 0.15, rz1 + 0.15, { kind: 'roof', far: true }));
      else if (roof < 0.75) world.add(gableX(rx0 - 0.15, rx1 + 0.15, rt, rt + 0.3, rt + 0.3 + (rz1 - rz0) * 0.3, rz0 - 0.15, rz1 + 0.15, { kind: 'roof', far: true }));
      else decor.push({ kind: 'tank', x: (rx0 + rx1) / 2, y: rt, z: (rz0 + rz1) / 2, r: 0.7, h: 1.3 });
      if (rng() < 0.45) decor.push({ kind: 'stack', x: lerp(x0, x1, 0.2 + rng() * 0.6), y: rt, z: lerp(zf, z, 0.3 + rng() * 0.4), h: 1.5 + rng() * 2.5 });
      // scaffolding and boxed-in balconies on the faces that look onto the route
      if (rng() < 0.4 && top > -2) decor.push({ kind: 'scaffoldFace', x: side < 0 ? x1 + 0.35 : x0 - 0.35, y0: Math.max(STREET_Y, top - 7), y1: top + 0.6, z0: zf + 0.3, z1: z - 0.3 });
      if (rng() < 0.6) decor.push({ kind: 'balcony', x: side < 0 ? x1 : x0, y: top - 2 - rng() * 3, z: lerp(zf, z, 0.5), side: -side });
      z = zf - (rng() < 0.35 ? 1.0 + rng() * 1.5 : 0.1);
    }
  }
  // cables and bridges strung across the route, well above the cat and the camera
  for (let z = 2; z > -112; z -= 2.5 + rng() * 3) {
    const n = 1 + (rng() * 3 | 0);
    for (let i = 0; i < n; i++) decor.push({ kind: 'cable', a: [-4.5 - rng() * 2, 3.4 + rng() * 2.5, z + (rng() - 0.5) * 2], b: [4.5 + rng() * 2, 3.4 + rng() * 2.5, z + (rng() - 0.5) * 2], sag: 0.4 + rng() * 0.6 });
  }
  for (const [z, y] of [[-18, 5.2], [-48, 6.4], [-88, 5.6]]) decor.push({ kind: 'skyBridge', x0: -5, x1: 5, y, z });
  for (const [z, y, r] of [[-11.5, 5.4, 0.45], [-34, 6.2, 0.7], [-66, 4.8, 0.38], [-94, 5.8, 0.55]]) decor.push({ kind: 'crossPipe', x0: -12, x1: 12, y, z, r });
  // far rings: rooflines climbing toward the tower
  for (let ring = 0; ring < 3; ring++) {
    for (let z = 10; z > -245; z -= 7 + ring * 3) {
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const x = side * (16 + ring * 14 + rng() * 10), w = 6 + rng() * 6, d = 5 + rng() * 4;
        const top = -4 + ring * 3 + rng() * 6 + Math.max(0, -z - 80) * 0.03;
        decor.push({ kind: 'farBlock', x, z, w, d, top, roof: rng() < 0.6 ? (rng() < 0.5 ? 'z' : 'x') : null, stack: rng() < 0.25 });
      }
    }
  }
}

// ---- 04_cat.js ----
// =====================================================================
// The cat's body in the world: movement, jumping, landing, balance.
// Pure simulation: no three.js, no DOM. The rig (08_catrig) reads the
// state this produces; it never writes back.
//
// The cat always runs toward -z. The player steers, sets the pace (the
// stick's vertical axis) and jumps. Everything else (ducking under things,
// steadying on a pipe, leaning into a roof slope, catching an edge it came
// up short of) is the cat's own competence.
// =====================================================================

class Cat {
  constructor(world) { this.world = world; this.reset([0, 0, 0]); }

  reset(p, speed) {
    this.pos = p.slice(); this.prev = p.slice();
    this.vel = [0, 0, -(speed || 0)];
    this.fwd = speed || 0;            // forward speed (positive = toward -z)
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.holdT = 0; this.rising = false;
    this.crouch = 0; this.height = TUNING.cat.standHeight;
    this.gripT = 0; this.teeter = 0; this.edgeAhead = 0; this.narrow = 0; this.pace = 0;
    this.slope = [0, 0];
    this.stumble = 0; this.landSlow = 0; this.airTime = 0; this.sinceLand = 9; this.sinceJump = 9; this.scalded = 0;
    this.scr = null; this.assistX = 0; this.halt = false; this.surf = 'flat'; this._rideDx = null;
    this.lastGroundY = p[1]; this.fallFrom = p[1];
    this.events = [];
    this.stats = { lastJump: null };
    this._jump = null;
  }

  // input: { steer -1..1, pace -1..1, jumpPressed (this step), jumpHeld }
  step(dt, input) {
    const C = TUNING.cat, W = this.world;
    this.prev = this.pos.slice();
    this.sinceLand += dt; this.sinceJump += dt;
    this.scalded = Math.max(0, this.scalded - dt);
    if (this.scr) { this.stepScramble(dt); return; }
    // ride a surface that is moving: a catwalk giving way, a bridge swaying
    if (this.grounded && this.ground) {
      const g = this.ground;
      if (g.dx !== undefined) { if (this._rideDx !== null && this._rideB === g) this.pos[0] += g.dx - this._rideDx; this._rideDx = g.dx; this._rideB = g; }
      if (g.dy !== undefined) { const t = W.topAt(g, this.pos[0], this.pos[2]); if (t > -Infinity) this.pos[1] = t; }
    } else this._rideDx = null;

    // ---- 1. pace: always moving forward; the stick's vertical axis sets how fast ----
    const pr = clamp(input.pace || 0, -1, 1), pd = C.paceDead;
    const p = Math.abs(pr) < pd ? 0 : sign(pr) * (Math.abs(pr) - pd) / (1 - pd);
    this.pace = damp(this.pace, p, 10, dt);
    let target = this.pace >= 0 ? lerp(C.cruise, C.sprint, this.pace) : lerp(C.cruise, C.walk, -this.pace);
    if (this.halt) target = 0;
    // the surface sets the rhythm: careful steps on a thin pipe, a crawl when squeezing
    if (this.grounded && this.surf === 'balance') target = Math.min(target, C.balanceSpeed);
    if (this.grounded && this.crouch) target = Math.min(target, C.crawlSpeed);
    if (this.grounded) {
      // slopes: uphill costs speed, downhill gives a little
      const gz = this.slope[1];          // d height / d z: negative means rising ahead
      target *= clamp(1 + (gz < 0 ? gz * C.slopeClimb : gz * C.slopeDescend), 0.45, 1.25);
    }
    if (this.landSlow > 0) { this.landSlow -= dt; target *= lerp(1, C.hardLandingSlow, clamp(this.landSlow / C.hardLandingTime, 0, 1)); }
    if (this.stumble > 0) { this.stumble -= dt; target *= lerp(1, C.stumbleSpeed, clamp(this.stumble / C.stumbleTime, 0, 1)); }
    if (this.grounded) {
      const a = C.accel * (this.fwd < C.cruise * 0.5 ? 1 + C.startBoost : 1);
      this.fwd = this.fwd < target ? Math.min(target, this.fwd + a * dt) : Math.max(target, this.fwd - C.brake * dt);
    }

    // ---- 2. steering ----
    const box = this.grounded ? this.ground : null;
    const w = box ? W.walkWidth(box) : 99;
    this.narrow = damp(this.narrow, box && w < C.narrowWidth ? 1 : 0, 10, dt);
    let steer = this.halt ? 0 : clamp(input.steer || 0, -1, 1);
    let tvx = steer * C.lateral * lerp(1, C.narrowLateral, this.narrow);
    // a sideways slope (roof pitch, pipe curvature) draws the cat downhill
    if (box) tvx -= this.slope[0] * C.slopePush * (this.surf === 'balance' ? C.balancePull : 1);
    // on a ledge or pipe, an idle stick lets the cat find the middle by itself
    if (box && this.narrow > 0.5 && Math.abs(steer) < 0.3) tvx += (W.centreX(box) - this.pos[0]) * C.narrowCentering * (1 - Math.abs(steer) / 0.3);
    if (box && TUNING.assist.enabled && this.narrow < 0.5) tvx += this.alignToNarrow(steer);
    const la = this.grounded ? (Math.abs(tvx) < Math.abs(this.vel[0]) || sign(tvx) !== sign(this.vel[0]) ? C.lateralDecel : C.lateralAccel) : C.lateralAccelAir;
    this.vel[0] += clamp(tvx - this.vel[0], -la * dt, la * dt);

    // ---- 3. edge grip: steering off a side edge is resisted briefly ----
    this.teeter = damp(this.teeter, 0, 6, dt);
    if (this.grounded && Math.abs(this.vel[0]) > 0.05) {
      const s = sign(this.vel[0]);
      const nx = this.pos[0] + this.vel[0] * dt + s * 0.02;
      const g = W.groundAt(nx, this.pos[2], this.pos[1] + C.stepUp, 0.02, C.halfLength * 0.6);
      if (g.y < this.pos[1] - 0.3) {
        if (this.gripT < C.edgeGrip || sign(steer) !== s) {
          this.gripT += sign(steer) === s ? dt : 0;
          this.vel[0] = 0; this.teeter = Math.max(this.teeter, 0.6 + 0.4 * Math.abs(steer));
        }
      } else this.gripT = Math.max(0, this.gripT - dt * 2);
    } else if (this.grounded) this.gripT = Math.max(0, this.gripT - dt * 2);

    // ---- 4. jump: buffered, with coyote time and variable height ----
    if (input.jumpPressed && !this.halt) this.buffer = C.buffer; else this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? C.coyote : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0 && this.sinceJump > 0.15) this.doJump();
    const held = TUNING.input.jumpMode === 'tap' ? true : !!input.jumpHeld;
    if (this.rising) { this.holdT += dt; if (this.vel[1] <= 0) this.rising = false; }

    // ---- 5. gravity ----
    if (!this.grounded) {
      let g = C.gravity;
      if (this.vel[1] < 0) g *= C.fallMul;
      else if (this.rising && !held && this.holdT > C.jumpMinHold) g *= C.jumpCut;
      this.vel[1] = Math.max(-C.maxFall, this.vel[1] - g * dt);
      this.airTime += dt;
    } else this.vel[1] = 0;

    // ---- 6. in-air assistance ----
    this.assistX = 0;
    if (!this.grounded && TUNING.assist.enabled) {
      this.assistLateral(dt);
      if (TUNING.assist.scramble && this.vel[1] < 0.5 && this.tryScramble()) return;
    }

    // ---- 7. ducking: flatten under anything with room for a crouching cat ----
    this.updateCrouch();

    // ---- 8. integrate and collide, one axis at a time ----
    this.vel[2] = -this.fwd;
    this.moveX(this.vel[0] * dt);
    this.moveZ(this.vel[2] * dt);
    this.moveY(this.vel[1] * dt);
    this.support();
    this.slope = this.grounded && this.ground ? W.grad(this.ground, this.pos[0], this.pos[2]) : [0, 0];
    this.surf = this.surfaceOf(this.grounded ? this.ground : null);

    // ---- 9. reading the ground ahead (for the rig and the camera) ----
    this.edgeAhead = 0;
    if (this.grounded) {
      for (let d = 0.5; d <= 2.6; d += 0.35) {
        const g = W.groundAt(this.pos[0], this.pos[2] - C.halfLength - d, this.pos[1] + 0.6, 0.05, 0.05);
        if (g.y < this.pos[1] - 0.6) { this.edgeAhead = 1 - (d - 0.5) / 2.1; break; }
      }
      this.lastGroundY = this.pos[1];
    }
    if (this.grounded && this.ground && this.ground.far) this.events.push({ type: 'fall', reason: 'astray' });
    if (this.pos[1] < this.lastGroundY - C.killDepth) this.events.push({ type: 'fall', reason: 'drop' });
  }

  // what kind of footing this is, for movement and for the rig's posture
  surfaceOf(b) {
    if (!b) return 'air';
    const w = this.world.walkWidth(b);
    if (b.shape === 'pipeZ') return w < TUNING.cat.balanceWidth ? 'balance' : 'pipe';
    if (b.dx !== undefined) return 'bridge';
    if (b.shape !== 'box') return 'roof';
    if (w < TUNING.cat.narrowWidth) return 'ledge';
    return 'flat';
  }

  doJump() {
    const C = TUNING.cat;
    this.vel[1] = C.jumpVel;
    this.fwd += C.jumpForward;
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.sinceJump = 0; this.holdT = 0; this.rising = true;
    this.fallFrom = this.pos[1];
    this._jump = { x: this.pos[0], y: this.pos[1], z: this.pos[2], apex: this.pos[1] };
    this.events.push({ type: 'jump' });
  }

  // steam: a scalding burst throws the cat up and stops it in its tracks
  scald(fromX) {
    const H = TUNING.hazards;
    if (this.scalded > 0) return;
    this.scalded = 0.8;
    this.vel[1] = H.steamKnockUp; this.grounded = false; this.ground = null; this.rising = false;
    this.vel[0] += sign(this.pos[0] - fromX || 1) * 0.6;
    this.fwd = Math.min(this.fwd, 0.6);
    this.stumble = H.steamStumble;
    this.fallFrom = this.pos[1];
    this.events.push({ type: 'scald' });
  }

  updateCrouch() {
    const C = TUNING.cat, W = this.world;
    const ahead = C.halfLength + 0.25 + this.fwd * 0.12;
    const c = W.ceilingAt(this.pos[0], this.pos[2] - ahead / 2, this.pos[1] + 0.02, C.halfWidth, C.halfLength + ahead / 2);
    const room = c.y - this.pos[1];
    const want = room < C.standHeight + 0.04 && room >= C.crouchHeight;
    const above = W.ceilingAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth, C.halfLength).y - this.pos[1];
    this.crouch = want || above < C.standHeight ? 1 : 0;
    this.height = this.crouch ? C.crouchHeight : C.standHeight;
  }

  // ---- collision, axis by axis ----
  hits(x, z) {
    const C = TUNING.cat;
    return this.world.solids(x - C.halfWidth, x + C.halfWidth, this.pos[1] + 0.01, this.pos[1] + this.height, z - C.halfLength, z + C.halfLength);
  }
  moveX(dx) {
    if (!dx) return;
    const C = TUNING.cat;
    this.pos[0] += dx;
    for (const h of this.hits(this.pos[0], this.pos[2])) {
      if (h.b.shape !== 'box' && !this.leadBlocks(h.b, sign(dx), 0)) continue;
      if (this.canStep(h)) { this.stepOnto(h); continue; }
      const o = h.b;
      if (o.shape !== 'box') { this.pos[0] -= dx; this.vel[0] = 0; return; }
      this.pos[0] = dx > 0 ? o.x0 - C.halfWidth - 1e-4 : o.x1 + C.halfWidth + 1e-4;
      this.vel[0] = 0;
    }
  }
  moveZ(dz) {
    if (!dz) return;
    const C = TUNING.cat;
    this.pos[2] += dz;
    for (const h of this.hits(this.pos[0], this.pos[2])) {
      if (h.b.shape !== 'box' && !this.leadBlocks(h.b, 0, sign(dz))) continue;
      if (this.canStep(h)) { this.stepOnto(h); continue; }
      const o = h.b;
      // nose-first into something: push out and stumble
      if (o.shape !== 'box') this.pos[2] -= dz;
      else this.pos[2] = dz < 0 ? o.z1 + C.halfLength + 1e-4 : o.z0 - C.halfLength - 1e-4;
      if (this.fwd > 2.5) this.events.push({ type: 'bump', speed: this.fwd });
      if (this.fwd > 2.5 || this.stumble <= 0) this.stumble = C.stumbleTime;
      this.fwd = Math.min(this.fwd, 1.0);
      return;
    }
  }
  // A shaped surface only blocks where it rises across the cat's leading
  // edge: the slope behind a cat running (or leaping) downhill is not a wall.
  leadBlocks(b, sx, sz) {
    const C = TUNING.cat, W = this.world, x = this.pos[0], z = this.pos[2], feet = this.pos[1];
    const pts = sz ? [[x - C.halfWidth, z + sz * C.halfLength], [x, z + sz * C.halfLength], [x + C.halfWidth, z + sz * C.halfLength]]
                   : [[x + sx * C.halfWidth, z - C.halfLength], [x + sx * C.halfWidth, z], [x + sx * C.halfWidth, z + C.halfLength]];
    const allow = this.grounded ? 0.02 : 0.12;
    for (const [px, pz] of pts) {
      const t = W.topAt(b, px, pz);
      if (t > feet + allow && W.bottomAt(b, px, pz) < feet + this.height) return true;
    }
    return false;
  }

  // small lips are stepped onto: up to stepUp while running (more on slopes),
  // a few centimetres while coming down (so a near-miss isn't a wall)
  canStep(h) {
    const C = TUNING.cat, lift = h.top - this.pos[1];
    if (!h.b.walk || lift < -1e-3) return false;
    const lim = h.b.shape === 'box' ? C.stepUp : C.slopeSnap;
    if (this.grounded ? lift > lim : (this.vel[1] > 0 || lift > 0.12)) return false;
    return this.headroom(h.top);
  }
  stepOnto(h) {
    this.pos[1] = h.top;
    if (!this.grounded) { this.land(h.b); this.grounded = true; }
    this.ground = h.b;
  }
  headroom(y) {
    const C = TUNING.cat;
    return this.world.ceilingAt(this.pos[0], this.pos[2], y + 0.01, C.halfWidth, C.halfLength).y - y >= C.crouchHeight;
  }
  moveY(dy) {
    const C = TUNING.cat, W = this.world;
    const y0 = this.pos[1];
    this.pos[1] += dy;
    if (dy < 0) {
      // swept: land on the highest top crossed this step
      const g = W.groundAt(this.pos[0], this.pos[2], y0 + 1e-4, C.halfWidth * 0.6, C.halfLength * 0.7);
      if (g.box && g.y >= this.pos[1]) {
        this.pos[1] = g.y;
        if (!this.grounded) this.land(g.box);
        this.ground = g.box; this.grounded = true;
      }
    } else if (dy > 0) {
      const c = W.ceilingAt(this.pos[0], this.pos[2], y0 + this.height - 1e-4, C.halfWidth, C.halfLength);
      if (c.y <= this.pos[1] + this.height) { this.pos[1] = c.y - this.height; this.vel[1] = 0; this.rising = false; this.events.push({ type: 'bonk' }); }
    }
  }
  // grounded: follow the surface under the paws, up or down a slope
  support() {
    if (!this.grounded) return;
    const C = TUNING.cat;
    const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + C.slopeSnap, C.halfWidth * 0.45, C.halfLength * 0.55);
    if (g.box && g.y >= this.pos[1] - 0.22 && this.headroom(g.y)) { this.pos[1] = g.y; this.ground = g.box; return; }
    this.grounded = false; this.ground = null; this.fallFrom = this.pos[1];
    this.events.push({ type: 'leave' });
  }
  land(box) {
    const C = TUNING.cat;
    const impact = -this.vel[1];
    this.vel[1] = 0; this.rising = false;
    if (impact > C.hardLanding) this.landSlow = C.hardLandingTime;
    if (this._jump) {
      this.stats.lastJump = { dist: Math.abs(this.pos[2] - this._jump.z), rise: this._jump.apex - this._jump.y, drop: this._jump.y - this.pos[1], air: this.airTime };
      this._jump = null;
    }
    this.events.push({ type: 'land', impact, drop: this.fallFrom - this.pos[1], surface: box.surface, narrow: this.world.walkWidth(box) < C.narrowWidth });
    this.airTime = 0; this.sinceLand = 0;
    this.lastGroundY = this.pos[1];
  }

  // A narrow surface just ahead at running height, and the cat a little
  // off its line: ease toward it. Steering clearly away overrides this.
  alignToNarrow(steer) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    for (let d = 0.3; d <= A.alignAhead; d += 0.3) {
      const z = this.pos[2] - C.halfLength - d;
      const g = W.groundAt(this.pos[0], z, this.pos[1] + C.stepUp, A.alignReach, 0.05);
      const b = g.box;
      if (!b || W.walkWidth(b) >= C.narrowWidth || Math.abs(g.y - this.pos[1]) > C.stepUp) continue;
      const off = W.centreX(b) - this.pos[0];
      if (Math.abs(steer) > 0.5 && sign(steer) !== sign(off)) return 0;
      return off * A.alignStrength * (1 - Math.abs(steer) * 0.5);
    }
    return 0;
  }

  // Predict where this arc lands. If it would just miss a surface to the
  // side, ease toward it: the cat twists in the air, as cats do.
  assistLateral(dt) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    if (this._jump) this._jump.apex = Math.max(this._jump.apex, this.pos[1]);
    let x = this.pos[0], y = this.pos[1], z = this.pos[2], vy = this.vel[1];
    const h = 1 / 30;
    for (let i = 0; i < 40; i++) {
      const ny = y + vy * h; vy -= C.gravity * (vy < 0 ? C.fallMul : 1) * h;
      z -= this.fwd * h; x += this.vel[0] * h;
      if (vy < 0) {
        const exact = W.groundAt(x, z, y, C.halfWidth * 0.6, C.halfLength * 0.7);
        if (exact.box && exact.y >= ny && exact.box.walk && !exact.box.far) return;
        const wide = W.groundAt(x, z, y, C.halfWidth + A.lateralReach, C.halfLength * 0.7);
        if (wide.box && wide.y >= ny && wide.box.walk && !wide.box.far) {
          const b = wide.box, cx = W.centreX(b), m = Math.min(0.15, W.walkWidth(b) / 2);
          const tx = clamp(x, cx - W.walkWidth(b) / 2 + m, cx + W.walkWidth(b) / 2 - m);
          const t = (i + 1) * h, need = (tx - x) / t;
          this.vel[0] += clamp(need, -A.lateralAccel * dt, A.lateralAccel * dt);
          this.assistX = sign(tx - x);
          return;
        }
      }
      y = ny;
      if (y < this.pos[1] - 4) return;
    }
  }

  // Came up just short of an edge in front? Front paws hook it, hind legs push.
  tryScramble() {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    const front = this.pos[2] - C.halfLength;
    for (const o of W.near(front - A.scrambleReach, front + 0.1)) {
      if (!o.walk || o.far) continue;
      if (o.z1 > front + 0.05 || o.z1 < front - A.scrambleReach) continue;
      const top = W.topAt(o, this.pos[0], o.z1 - 0.02);
      if (top === -Infinity) continue;
      const lift = top - this.pos[1];
      if (lift <= 0.02 || lift > A.scrambleDrop) continue;
      if (!this.headroomAt(this.pos[0], o.z1 - C.halfLength, top)) continue;
      this.scr = { t: 0, from: this.pos.slice(), to: [this.pos[0], top, o.z1 - C.halfLength - 0.05], box: o, lift };
      this.vel = [0, 0, 0]; this.grounded = false;
      this.events.push({ type: 'scramble', lift });
      return true;
    }
    return false;
  }
  headroomAt(x, z, y) {
    const C = TUNING.cat;
    return this.world.ceilingAt(x, z, y + 0.01, C.halfWidth, C.halfLength).y - y >= C.crouchHeight;
  }
  stepScramble(dt) {
    const C = TUNING.cat, A = TUNING.assist, s = this.scr;
    s.t += dt / A.scrambleTime;
    const k = clamp(s.t, 0, 1);
    const ky = smooth(clamp(k * 1.5, 0, 1)), kz = smooth(clamp(k * 1.4 - 0.4, 0, 1));
    this.pos = [s.from[0], lerp(s.from[1], s.to[1], ky), lerp(s.from[2], s.to[2], kz)];
    this.crouch = 0; this.height = C.standHeight;
    if (k >= 1) {
      this.scr = null;
      const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + C.slopeSnap, 0.05, 0.05);
      if (g.box) { this.pos[1] = g.y; this.ground = g.box; } else this.ground = s.box;
      this.grounded = true; this.vel = [0, 0, 0];
      this.fwd = C.cruise * A.scrambleSpeed;
      this._jump = null; this.airTime = 0; this.sinceLand = 0; this.lastGroundY = this.pos[1];
      this.events.push({ type: 'land', impact: 3, drop: 0, surface: s.box.surface, scramble: true });
    }
  }
}

// ---- 05_hazards.js ----
// =====================================================================
// The city's moving parts, as pure simulation: steam vents on a fixed,
// readable cycle; a catwalk section that creaks and gives way if you
// stall on it; rope bridges that sway; the energy fragments; the dead
// waypoint relays that wake as the core passes; the signal relay.
// The renderer reads the state; it never decides an outcome.
// =====================================================================

class Hazards {
  constructor(world, slice) {
    this.world = world; this.slice = slice; this.time = 0;
    this.vents = slice.vents.map(v => Object.assign({ state: 'idle', k: 0 }, v));
    this.unstable = slice.unstable.map(b => { b.dy = 0; return { b, state: 'stable', t: 0, vy: 0, shake: 0 }; });
    this.fragments = slice.fragments.map(f => Object.assign({ taken: false }, f));
    this.relay = Object.assign({ active: false, t: 0 }, slice.relay);
    this.bridges = (slice.bridges || []).map((b, i) => { b.dx = 0; return { b, phase: i * 1.3 }; });
    this.waypoints = (slice.waypoints || []).map(w => Object.assign({ active: false, t: 0 }, w));
    this.charge = 0;
  }
  // a fresh run: everything back where it was
  reset() {
    this.time = 0; this.charge = 0; this.relay.active = false; this.relay.t = 0;
    for (const f of this.fragments) f.taken = false;
    for (const w of this.waypoints) { w.active = false; w.t = 0; }
    this.resetUnstable();
  }
  // after a fall: fallen walkways are back, so the route is always crossable
  resetUnstable() { for (const u of this.unstable) { u.state = 'stable'; u.t = 0; u.vy = 0; u.shake = 0; u.b.dy = 0; u.b.gone = false; } }

  ventCycle() { const H = TUNING.hazards; return H.steamIdle + H.steamWarn + H.steamBurst; }
  // where in its cycle a vent is: idle -> warn (hiss, glow) -> burst
  ventAt(v, time) {
    const H = TUNING.hazards, T = this.ventCycle();
    const t = ((time + v.phase) % T + T) % T;
    if (t < H.steamIdle) return { state: 'idle', k: t / H.steamIdle };
    if (t < H.steamIdle + H.steamWarn) return { state: 'warn', k: (t - H.steamIdle) / H.steamWarn };
    return { state: 'burst', k: (t - H.steamIdle - H.steamWarn) / H.steamBurst };
  }

  step(dt, cat) {
    const H = TUNING.hazards, C = TUNING.cat, out = [];
    this.time += dt;
    // steam
    for (const v of this.vents) {
      const s = this.ventAt(v, this.time);
      if (s.state === 'warn' && v.state === 'idle') out.push({ type: 'hiss', vent: v });
      v.state = s.state; v.k = s.k;
      if (s.state !== 'burst') continue;
      const inX = Math.abs(cat.pos[0] - v.x) < H.steamRadius + C.halfWidth;
      const inZ = Math.abs(cat.pos[2] - v.z) < H.steamRadius * 0.8 + C.halfLength;
      const inY = cat.pos[1] < v.y + H.steamHeight && cat.pos[1] + cat.height > v.y - 0.1;
      if (inX && inZ && inY && cat.scalded <= 0) { cat.scald(v.x); out.push({ type: 'scald', vent: v }); }
    }
    // unstable walkways
    for (const u of this.unstable) {
      const on = cat.grounded && cat.ground === u.b;
      if (u.state === 'stable' && on) { u.state = 'creak'; u.t = 0; out.push({ type: 'creak' }); }
      else if (u.state === 'creak') {
        u.t += dt; u.shake = u.t / H.creakTime;
        if (u.t >= H.creakTime) { u.state = 'falling'; u.t = 0; u.vy = 0; out.push({ type: 'give' }); }
      } else if (u.state === 'falling') {
        u.t += dt; u.vy -= H.fallGravity * dt; u.b.dy += u.vy * dt;
        if (u.b.dy < -9) { u.state = 'gone'; u.b.gone = true; u.t = 0; }
      } else if (u.state === 'gone') {
        u.t += dt; if (u.t > H.resetTime) { u.state = 'stable'; u.b.dy = 0; u.b.gone = false; u.shake = 0; }
      }
    }
    // rope bridges: a slow, steady sway the player learns to lean against
    for (const br of this.bridges) br.b.dx = H.swayAmp * Math.sin(this.time * H.swayRate + br.phase);
    // waypoints: dead relays along the broken line wake as the core passes
    for (const w of this.waypoints) {
      if (w.active) { w.t += dt; continue; }
      if (cat.pos[2] < w.z + 1 && Math.abs(cat.pos[2] - w.z) < H.waypointRadius) { w.active = true; out.push({ type: 'waypoint', w, charge: this.charge }); }
    }
    // fragments
    for (const f of this.fragments) {
      if (f.taken) continue;
      const d = Math.hypot(cat.pos[0] - f.x, cat.pos[1] + 0.2 - f.y, cat.pos[2] - f.z);
      if (d < H.pickupRadius) { f.taken = true; this.charge++; out.push({ type: 'fragment', count: this.charge, of: this.fragments.length, f }); }
    }
    // the relay
    const r = this.relay;
    if (!r.active && Math.hypot(cat.pos[0] - r.x, cat.pos[2] - r.z) < H.relayRadius && Math.abs(cat.pos[1] - r.y) < 1) { r.active = true; out.push({ type: 'relay', charge: this.charge }); }
    if (r.active) r.t += dt;
    return out;
  }
}

// ---- 06_input.js ----
// =====================================================================
// Input: turns fingers and keys into { steer, jumpPressed, jumpHeld }.
// Knows nothing about the cat. Each pointer owns one role for its whole
// life, so steering and jumping work at the same time.
//
// Touch layout (both orientations): the left part of the screen is a
// floating stick (it appears where the thumb lands); the right part is
// the jump zone, with a visible button inside it. The zone, not the
// button, is the hit area, so a thumb never misses the jump.
// =====================================================================

function createInput(ctx, canvas, ui) {
  const I = TUNING.input;
  const state = { steer: 0, pace: 0, jumpHeld: false, presses: 0, stick: null, keys: new Set(), keySteer: 0, enabled: false, virtual: null };
  const roles = new Map();
  const rect = () => canvas.getBoundingClientRect();
  const jumpZoneX = () => ctx.width * (1 - I.jumpZone);
  const anyJumpPointer = () => { for (const r of roles.values()) if (r.role === 'jump') return true; return false; };

  function press() { state.presses++; state.jumpHeld = true; ui.jumpDown(true); }
  function releaseCheck() { state.jumpHeld = anyJumpPointer() || state.keys.has('Space'); if (!state.jumpHeld) ui.jumpDown(false); }

  function onDown(e) {
    if (!state.enabled) return;
    if (e.cancelable) e.preventDefault();
    const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x >= jumpZoneX() || (e.pointerType === 'mouse' && e.button === 2)) {
      roles.set(e.pointerId, { role: 'jump' }); press();
    } else if (!state.stick && y < ctx.height - ((ctx.safeArea && ctx.safeArea.bottom) || 0)) {
      roles.set(e.pointerId, { role: 'stick' });
      state.stick = { ox: x, oy: y, x, y, id: e.pointerId };
      ui.stickShow(x, y);
    } else roles.set(e.pointerId, { role: 'none' });
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
  }
  function onMove(e) {
    const R = roles.get(e.pointerId); if (!R || R.role !== 'stick' || !state.stick) return;
    const r = rect(), s = state.stick;
    s.x = e.clientX - r.left; s.y = e.clientY - r.top;
    // the stick's origin follows a thumb that overshoots, so reversing is instant
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), R0 = I.stickRadius;
    if (d > R0) { s.ox += dx / d * (d - R0); s.oy += dy / d * (d - R0); }
    ui.stickMove(s.ox, s.oy, s.x - s.ox, s.y - s.oy);
  }
  function onUp(e) {
    const R = roles.get(e.pointerId); if (!R) return;
    roles.delete(e.pointerId);
    if (R.role === 'stick') { state.stick = null; ui.stickHide(); }
    if (R.role === 'jump') releaseCheck();
  }
  ctx.listen(canvas, 'pointerdown', onDown);
  ctx.listen(canvas, 'pointermove', onMove);
  ctx.listen(canvas, 'pointerup', onUp);
  ctx.listen(canvas, 'pointercancel', onUp);
  ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

  const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space']);
  ctx.listen(window, 'keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (KEYS.has(e.code)) e.preventDefault();
    if (e.repeat || !state.enabled) return;
    state.keys.add(e.code);
    if (e.code === 'Space') press();
  });
  ctx.listen(window, 'keyup', e => { state.keys.delete(e.code); releaseCheck(); });

  // read once per simulation step
  function sample(dt) {
    if (state.virtual) {
      const v = state.virtual; const p = v.jump && !v._was; v._was = !!v.jump;
      return { steer: v.steer || 0, pace: v.pace || 0, jumpPressed: p, jumpHeld: !!v.jump };
    }
    const k = state.keys;
    const want = ((k.has('ArrowRight') || k.has('KeyD')) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA')) ? 1 : 0);
    // keys are digital; give them a short ramp so they steer like a thumb, not a switch
    state.keySteer += clamp(want - state.keySteer, -dt * 9, dt * 9);
    let steer = state.keySteer;
    // pace: forward hurries, back waits. Keys are digital; the stick is analogue.
    let pace = ((k.has('ArrowUp') || k.has('KeyW')) ? 1 : 0) - ((k.has('ArrowDown') || k.has('KeyS')) ? 1 : 0);
    if (state.stick) {
      const s = state.stick, n = clamp((s.x - s.ox) / I.stickRadius, -1, 1), m = Math.abs(n);
      steer = m < I.stickDead ? 0 : sign(n) * Math.pow((m - I.stickDead) / (1 - I.stickDead), I.stickCurve);
      pace = clamp(-(s.y - s.oy) / I.stickRadius, -1, 1);
    }
    state.steer = steer; state.pace = pace;
    const out = { steer, pace, jumpPressed: state.presses > 0, jumpHeld: state.jumpHeld };
    state.presses = 0;
    return out;
  }
  function clear() { roles.clear(); state.stick = null; state.keys.clear(); state.jumpHeld = false; state.presses = 0; state.keySteer = 0; ui.stickHide(); ui.jumpDown(false); }

  return { state, sample, clear };
}

// ---- 07_assets.js ----
// =====================================================================
// Materials, procedural textures and the static batcher.
//
// Palette: deep charcoal and blue-grey dusk; aged terracotta; dirty cream
// plaster; oxidised teal-grey and rust metal; warm light from old windows;
// toxic green and restrained violet only where the industry glows.
// Walkable surfaces are the warmest, lightest values in their area;
// voids fall to near-black. The black cat carries a cool rim light.
// =====================================================================

const PAL = {
  skyTop: '#0d121b', skyHorizon: '#3a4452', skyBand: '#6e6150', fog: '#2b333d',
  tile: '#a65a3c', plaster: ['#b6aa94', '#8f9aa0', '#a8957a', '#7f8e8c', '#b09a86'],
  metal: '#5b6a6c', rust: '#6d4a37', brick: '#7a4636', tin: '#7b7466',
  warm: '#ffb36b', green: '#7dffb0', violet: '#b48cff', street: '#0b0d10'
};

function createAssets(THREE, renderer, ctx) {
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
  const canvases = [];
  function paint(size, draw, opts) {
    // texture canvases come from the runtime (cleanup-owned) and are never shown
    const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' });
    c.style.display = 'none'; c.width = size; c.height = (opts && opts.h) || size;
    const g = c.getContext('2d'); draw(g, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = opts && opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (!(opts && opts.clamp)) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    canvases.push(c);
    return t;
  }
  const rng = makeRng(7);
  function speckle(g, w, h, n, cols, rmin, rmax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + rng() * 0.6); g.fillStyle = cols[i % cols.length];
      const r = rmin + rng() * (rmax - rmin), x = rng() * w, y = rng() * h;
      for (const [ox, oy] of [[0, 0], [w, 0], [0, h], [-w, 0], [0, -h]]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  function streaks(g, w, h, n, col, len) {
    for (let i = 0; i < n; i++) { const x = rng() * w, ww = 1 + rng() * 5, hh = len * (0.3 + rng()); const gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, rng() * h * 0.3, ww, hh); }
  }

  // terracotta: 1 tile = 1 m. Overlapping courses of half-round tiles.
  const tiles = paint(256, (g, w, h) => {
    g.fillStyle = '#5a2c1e'; g.fillRect(0, 0, w, h);
    const rows = 8, cols = 4;
    for (let r = 0; r < rows; r++) {
      const y = r * h / rows, off = (r % 2) * (w / cols / 2);
      for (let c = -1; c <= cols; c++) {
        const x = c * w / cols + off, tw = w / cols - 2, th = h / rows + 6;
        const v = 0.78 + rng() * 0.32, moss = rng() < 0.04;
        const gr = g.createLinearGradient(x, 0, x + tw, 0);
        const base = moss ? [96, 104, 70] : [178 * v, 96 * v, 64 * v];
        gr.addColorStop(0, `rgb(${base[0] * 0.55 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`);
        gr.addColorStop(0.45, `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`);
        gr.addColorStop(1, `rgb(${base[0] * 0.5 | 0},${base[1] * 0.5 | 0},${base[2] * 0.5 | 0})`);
        g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(x + 1, y - 3, tw, th, 6) : g.rect(x + 1, y - 3, tw, th); g.fill();
        g.fillStyle = 'rgba(20,10,6,.45)'; g.fillRect(x + 1, y + th - 7, tw, 3);
      }
    }
    speckle(g, w, h, 500, ['#2b1a14', '#d9a37f', '#3c3a2a'], 0.5, 2, 0.25);
    streaks(g, w, h, 18, 'rgba(15,12,10,.35)', 120);
  });
  // plaster wall: 1 tile = 3 m. Shutters, dark panes, rain streaks, a slab band.
  const WIN = [[0.12, 0.3, 0.2, 0.42], [0.58, 0.3, 0.2, 0.42]];
  const plaster = paint(256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1500, ['#d0c8bd', '#ffffff', '#a9a196', '#8d867d'], 0.5, 2.2, 0.3);
    speckle(g, w, h, 20, ['#9b8f80', '#7e8a8a'], 14, 40, 0.12);       // patched plaster
    streaks(g, w, h, 40, 'rgba(40,36,34,.3)', 150);
    g.fillStyle = 'rgba(60,54,50,.5)'; g.fillRect(0, 0, w, 8);
    for (const [x, y, ww, hh] of WIN) {
      g.fillStyle = 'rgba(70,64,58,.7)'; g.fillRect((x - 0.02) * w, (y - 0.03) * h, (ww + 0.04) * w, (hh + 0.06) * h);
      g.fillStyle = '#121418'; g.fillRect(x * w, y * h, ww * w, hh * h);
      g.fillStyle = 'rgba(160,170,175,.18)'; g.fillRect(x * w + ww * w / 2 - 1, y * h, 2, hh * h);
    }
  });
  // window light: drawn into the emissive map. Some panes lit warm, a few cold.
  // window light covers a 4 x 4 block of storey-tiles (repeat 0.25), so lit
  // windows scatter irregularly: about a third lit, a few cold and blue
  const windows = paint(512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const tw = w / 4, th = h / 4;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) for (const [x, y, ww, hh] of WIN) {
      const r = rng(); if (r > 0.36) continue;
      const X = tx * tw + x * tw, Y = ty * th + y * th, W2 = ww * tw, H2 = hh * th;
      const cold = r < 0.05, gr = g.createLinearGradient(0, Y, 0, Y + H2);
      gr.addColorStop(0, cold ? '#1d3a4a' : '#6b3410'); gr.addColorStop(1, cold ? '#6fb6c9' : (r < 0.2 ? '#ffb15e' : '#d98a3c'));
      g.fillStyle = gr; g.fillRect(X + 1, Y + 1, W2 - 2, H2 - 2);
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(X + W2 / 2 - 1, Y, 2, H2);
      if (r > 0.25) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(X + 1, Y + 1, W2 * 0.45, H2 - 2); }   // a curtain half drawn
    }
  });
  windows.repeat.set(0.25, 0.25);
  const metal = paint(256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#c8cfcf', '#ffffff', '#8f9897'], 0.5, 2, 0.35);
    speckle(g, w, h, 60, ['#8a5a3c', '#6b3f28', '#b0764a'], 3, 14, 0.45);   // rust blooms
    streaks(g, w, h, 30, 'rgba(110,62,36,.4)', 90);
    g.fillStyle = 'rgba(30,30,30,.5)'; for (let i = 0; i < 4; i++) g.fillRect(0, i * h / 4, w, 2);
    g.fillStyle = 'rgba(25,25,25,.6)'; for (let x = 6; x < w; x += 16) for (let i = 0; i < 4; i++) g.fillRect(x, i * h / 4 + 5, 2, 2);
  });
  const grate = paint(128, (g, w, h) => {
    g.fillStyle = '#2a2724'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8e7a68'; for (let i = 0; i < w; i += 8) { g.fillRect(i, 0, 3, h); }
    g.fillStyle = '#6d5a4a'; for (let j = 0; j < h; j += 32) g.fillRect(0, j, w, 4);
    speckle(g, w, h, 120, ['#a0643a', '#3a2a20'], 1, 4, 0.5);
  });
  const brick = paint(128, (g, w, h) => {
    g.fillStyle = '#3a2620'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 4; c++) {
      const v = 0.75 + rng() * 0.4; g.fillStyle = `rgb(${150 * v | 0},${78 * v | 0},${58 * v | 0})`;
      g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
    }
    streaks(g, w, h, 12, 'rgba(10,10,10,.5)', 70);
  });
  const tin = paint(128, (g, w, h) => {
    for (let x = 0; x < w; x++) { const v = 0.7 + 0.3 * Math.sin(x / w * TAU * 8); g.fillStyle = `rgb(${190 * v | 0},${182 * v | 0},${168 * v | 0})`; g.fillRect(x, 0, 1, h); }
    speckle(g, w, h, 140, ['#7a3e20', '#5b2e18', '#a5603a'], 2, 10, 0.5);
    streaks(g, w, h, 20, 'rgba(90,40,20,.5)', 80);
  });
  const concrete = paint(128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#9a948c', '#c9c2b8', '#ffffff', '#77726c'], 0.4, 1.6, 0.3);
    speckle(g, w, h, 14, ['#6d675f'], 8, 24, 0.12);
    g.fillStyle = 'rgba(50,46,42,.35)'; g.fillRect(0, h / 2 - 1, w, 2); g.fillRect(w / 2 - 1, 0, 2, h);
  });
  const fur = paint(64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); speckle(g, w, h, 400, ['#cfd3dc', '#ffffff', '#9aa0aa'], 0.3, 1, 0.5); });
  const glow = paint(64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, { clamp: true });
  const puff = paint(64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.6, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, { clamp: true });
  const blob = paint(64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, { clamp: true });

  const lam = o => new THREE.MeshLambertMaterial(o);
  const add = (map, col) => new THREE.SpriteMaterial({ map, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // the cat's fur: Lambert plus a fresnel rim so a black cat reads on dark roofs
  const rimU = { rimColor: { value: new THREE.Color('#9fb6dc') }, rimStrength: { value: 0.3 } };
  const rimmed = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, rimU);
      sh.fragmentShader = 'uniform vec3 rimColor; uniform float rimStrength;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        'float rimK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.4);\noutgoingLight += rimColor * rimK * rimStrength;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'rim';
    return m;
  };
  const M = {
    tile: lam({ map: tiles, vertexColors: true }),
    wall: lam({ map: plaster, vertexColors: true, emissiveMap: windows, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9 }),
    metal: lam({ map: metal, vertexColors: true }),
    grate: lam({ map: grate, vertexColors: true }),
    brick: lam({ map: brick, vertexColors: true }),
    tin: lam({ map: tin, vertexColors: true }),
    concrete: lam({ map: concrete, vertexColors: true }),
    plain: lam({ vertexColors: true }),
    dark: lam({ color: '#15181d' }),
    cable: new THREE.MeshBasicMaterial({ color: '#0d0f12' }),
    street: new THREE.MeshBasicMaterial({ color: PAL.street }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, alphaMap: blob }),
    fur: rimmed(lam({ map: fur, vertexColors: true })),
    furPlain: rimmed(lam({ vertexColors: true })),
    eye: new THREE.MeshBasicMaterial({ color: '#c9f25e' }),
    nose: lam({ color: PAL.nose || '#2c2024' }),
    collar: lam({ color: '#5e2a2a' }),
    core: new THREE.MeshBasicMaterial({ color: PAL.green }),
    coreGlow: add(glow, PAL.green),
    glowWarm: add(glow, PAL.warm), glowGreen: add(glow, PAL.green), glowViolet: add(glow, PAL.violet), glowRed: add(glow, '#ff5a3c'),
    fragment: new THREE.MeshBasicMaterial({ color: '#a8ffd0' }),
    steam: new THREE.PointsMaterial({ map: puff, color: '#c9d2d8', size: 0.9, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }),
    smoke: new THREE.PointsMaterial({ map: puff, color: '#3a4049', size: 3.2, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true })
  };
  const T = { tiles, plaster, windows, metal, grate, brick, tin, concrete, fur, glow, puff, blob };
  return { M, T, THREE, canvases };
}

// ---------------------------------------------------------------------
// Batcher: accumulates quads, triangles, boxes and arbitrary geometry
// into one geometry per material, with world-space UVs, so all static
// architecture costs one draw call per material.
// ---------------------------------------------------------------------
class Batch {
  constructor() { this.b = new Map(); }
  bucket(key) { let k = this.b.get(key); if (!k) this.b.set(key, k = { p: [], n: [], u: [], c: [], i: [] }); return k; }
  quad(key, a, b, c, d, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c, d]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(key, a, b, c, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 3; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2);
  }
  // Box with per-face materials and colours.
  //   o.top / o.side: material keys; o.topCol / o.sideCol / o.sideColLow: [r,g,b]
  //   o.uvTop, o.uvSide: metres per texture tile; o.uvShift: offsets side UVs; o.faces: which faces
  box(x0, x1, y0, y1, z0, z1, o) {
    const f = o.faces || { top: true, bottom: false, px: true, nx: true, pz: true, nz: true };
    const tt = o.uvTop || 4, ts = o.uvSide || 3, sh = o.uvShift || 0;
    const tc = o.topCol || [1, 1, 1], sc = o.sideCol || [1, 1, 1], sl = o.sideColLow || sc;
    const lowAt = y => { const k = clamp((y1 - y) / (o.fadeDepth || 9), 0, 1); return [lerp(sc[0], sl[0], k), lerp(sc[1], sl[1], k), lerp(sc[2], sl[2], k)]; };
    const cH = lowAt(y1), cL = lowAt(y0);
    if (f.top) this.quad(o.top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / tt, z1 / tt], [x1 / tt, z1 / tt], [x1 / tt, z0 / tt], [x0 / tt, z0 / tt]], [tc, tc, tc, tc]);
    if (f.bottom) this.quad(o.side, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [cL, cL, cL, cL]);
    const side = (a, b, c, d, n, u0, u1) => this.quad(o.side, a, b, c, d, n, [[(u0 + sh) / ts, y0 / ts], [(u1 + sh) / ts, y0 / ts], [(u1 + sh) / ts, y1 / ts], [(u0 + sh) / ts, y1 / ts]], [cL, cL, cH, cH]);
    if (f.pz) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], x0, x1);
    if (f.nz) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], -x1, -x0);
    if (f.px) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], -z1, -z0);
    if (f.nx) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], z0, z1);
  }
  geo(key, g, m, col, THREE) {
    const k = this.bucket(key), base = k.p.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); k.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); k.n.push(v.x, v.y, v.z);
      k.u.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      k.c.push(col[0], col[1], col[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) k.i.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) k.i.push(base + i);
  }
  build(THREE, mats, opts) {
    const group = new THREE.Group();
    for (const [key, k] of this.b) {
      if (!k.i.length || !mats[key]) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(k.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
      g.setIndex(k.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(k.i, 1) : new THREE.Uint16BufferAttribute(k.i, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[key]);
      m.castShadow = !!(opts && opts.cast); m.receiveShadow = !!(opts && opts.receive);
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    }
    return group;
  }
}

const hex3 = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
    const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of ms) if (m.userData && m.userData.own) m.dispose();
  });
  if (o.parent) o.parent.remove(o);
}

// ---- 08_catrig.js ----
// =====================================================================
// The black cat: a procedural, articulated rig.
//
//   root (at the paws, faces the velocity)
//   └ body (spine height; compresses, pitches, leans with the slope)
//      ├ pelvis ── hind legs (thigh, shin, hock; IK) ── tail (10 springs)
//      └ chest ── fore legs (upper, lower; IK) ── neck ── head (ears, eyes)
//                └ collar with the power core (brightens with each fragment)
//
// Readability on dark roofs: a cool rim light in the fur material (07),
// lit eyes, and the core's glow. The rig only reads the cat's state; it
// never moves the cat. Feet are placed by two-bone IK, so compression,
// crouching and landing bend the legs by themselves.
//
// Replacing it (Phase 2): any rig providing { root, update(dt, s),
// setShadows(on), dispose() } drops in. `s` is built in 12_game.
// =====================================================================

function createCatRig(THREE, A) {
  const COL = { back: hex3('#0a0b0e'), side: hex3('#14151a'), belly: hex3('#1e1f26'), paw: hex3('#18191e'), ear: hex3('#3b2730'), nose: hex3('#2c2024') };
  const root = new THREE.Group();
  const meshes = [], owned = [];
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // dorsal-dark to belly-light gradient baked into vertex colours
  function shade(g, top, bottom, mid) {
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const k = clamp(n.getY(i) * 0.5 + 0.5, 0, 1);
      const a = mid ? (k > 0.5 ? [mid, top, (k - 0.5) * 2] : [bottom, mid, k * 2]) : [bottom, top, k];
      for (let j = 0; j < 3; j++) c[i * 3 + j] = lerp(a[0][j], a[1][j], a[2]);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  function ellipsoid(rx, ry, rz, top, bottom, mid, seg) {
    const g = new THREE.SphereGeometry(1, seg || 16, Math.round((seg || 16) * 0.75));
    g.rotateX(Math.PI / 2);
    g.scale(rx, ry, rz);
    return shade(g, top, bottom, mid);
  }
  function bone(r0, len, top, bottom) {
    const g = new THREE.CylinderGeometry(r0, r0 * 0.75, len, 8, 1);
    g.translate(0, -len / 2, 0);
    return shade(g, top, bottom);
  }
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat || A.M.fur);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m); meshes.push(m); owned.push(geo);
    return m;
  }
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };

  // ---- body: long and lean ----
  const SPINE_Y = 0.215;
  const body = grp(root, 0, SPINE_Y, 0);
  const pelvis = grp(body), chest = grp(body);
  add(pelvis, ellipsoid(0.06, 0.07, 0.15, COL.back, COL.belly, COL.side), A.M.fur, 0, 0, 0.09);
  add(pelvis, ellipsoid(0.052, 0.06, 0.1, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.004, 0.0);     // the waist
  add(chest, ellipsoid(0.066, 0.088, 0.14, COL.back, COL.belly, COL.side), A.M.fur, 0, -0.004, -0.085);
  for (const sx of [-1, 1]) add(chest, ellipsoid(0.026, 0.03, 0.05, COL.back, COL.side, null, 8), A.M.fur, sx * 0.04, 0.05, -0.13); // shoulder blades
  add(chest, ellipsoid(0.042, 0.05, 0.075, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.042, -0.195).rotation.x = 0.75;
  // collar and the power core
  const collar = new THREE.TorusGeometry(0.044, 0.0065, 6, 18); collar.rotateX(Math.PI / 2 - 0.75);
  add(chest, collar, A.M.collar, 0, 0.045, -0.2);
  const core = add(chest, new THREE.OctahedronGeometry(0.014, 0), A.M.core, 0, 0.0, -0.245); core.castShadow = false;
  const coreGlow = new THREE.Sprite(A.M.coreGlow); coreGlow.scale.setScalar(0.1); coreGlow.position.copy(core.position); chest.add(coreGlow);
  // head
  const head = grp(chest, 0, 0.078, -0.235);
  add(head, ellipsoid(0.062, 0.054, 0.062, COL.back, COL.belly, COL.side, 14), A.M.fur, 0, 0.01, -0.028);
  for (const sx of [-1, 1]) add(head, ellipsoid(0.03, 0.03, 0.035, COL.side, COL.belly, null, 8), A.M.fur, sx * 0.042, -0.012, -0.04);
  add(head, ellipsoid(0.027, 0.021, 0.03, COL.side, COL.belly, null, 10), A.M.fur, 0, -0.012, -0.072);
  add(head, new THREE.SphereGeometry(0.007, 6, 4), A.M.nose, 0, 0.002, -0.1);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.011, 10, 6); g.scale(1, 0.8, 0.6);
    const e = add(head, g, A.M.eye, sx * 0.023, 0.02, -0.074); e.castShadow = false; e.rotation.y = sx * 0.35; eyes.push(e);
  }
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = grp(head, sx * 0.03, 0.046, -0.016);
    const g = new THREE.ConeGeometry(0.03, 0.074, 4, 1); g.translate(0, 0.037, 0); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.45);
    add(pivot, shade(g, COL.back, COL.side), A.M.fur);
    const inner = new THREE.ConeGeometry(0.017, 0.045, 3, 1); inner.translate(0, 0.024, 0); inner.scale(1, 1, 0.25);
    add(pivot, shade(inner, COL.ear, COL.ear), A.M.furPlain, 0, 0.004, -0.008);
    pivot.rotation.z = -sx * 0.24;
    ears.push({ g: pivot, sx });
  }

  // ---- legs: shoulder/hip pivot -> upper -> lower (-> hock) -> paw ----
  function leg(parent, x, y, z, hind) {
    const L1 = hind ? 0.1 : 0.112, L2 = hind ? 0.097 : 0.11, L3 = hind ? 0.078 : 0;
    const pivot = grp(parent, x, y, z);
    const up = grp(pivot); add(up, bone(hind ? 0.03 : 0.023, L1 + 0.01, COL.side, COL.side), A.M.fur);
    if (hind) add(up, ellipsoid(0.04, 0.064, 0.058, COL.back, COL.side, null, 10), A.M.fur, 0, -0.024, 0.006);
    const lo = grp(up, 0, -L1, 0); add(lo, bone(hind ? 0.018 : 0.016, L2 + 0.006, COL.side, COL.side), A.M.fur);
    let hock = null, paw;
    if (hind) { hock = grp(lo, 0, -L2, 0); add(hock, bone(0.014, L3, COL.side, COL.side), A.M.fur); paw = grp(hock, 0, -L3, 0); }
    else paw = grp(lo, 0, -L2, 0);
    add(paw, ellipsoid(0.017, 0.011, 0.025, COL.paw, COL.paw, null, 8), A.M.fur, 0, 0.004, -0.008);
    return { pivot, up, lo, hock, paw, L1, L2, L3, hind, x, side: sign(x), x0: x };
  }
  const legs = {
    fl: leg(chest, -0.038, -0.035, -0.15, false), fr: leg(chest, 0.038, -0.035, -0.15, false),
    hl: leg(pelvis, -0.041, -0.025, 0.165, true), hr: leg(pelvis, 0.041, -0.025, 0.165, true)
  };
  const OFFSET = { hl: 0, hr: 0.09, fl: 0.5, fr: 0.6 };   // rotary gallop

  // ---- tail: a long chain of springs ----
  const TAIL_N = 12, TAIL_L = 0.033;
  const tail = [];
  let tp = grp(pelvis, 0, 0.025, 0.235);
  for (let i = 0; i < TAIL_N; i++) {
    const r = lerp(0.016, 0.007, i / TAIL_N);
    const g = new THREE.CylinderGeometry(r * 0.9, r, TAIL_L + 0.006, 7, 1); g.rotateX(Math.PI / 2); g.translate(0, 0, TAIL_L / 2);
    add(tp, shade(g, COL.back, COL.side), A.M.fur);
    tail.push({ g: tp, p: mkSpring(0), y: mkSpring(0), f: lerp(6, 2.4, i / (TAIL_N - 1)) });
    tp = grp(tp, 0, 0, TAIL_L);
  }

  const S = {
    phase: 0, yaw: mkSpring(0), lift: mkSpring(0), pitch: mkSpring(0), lean: mkSpring(0), flex: mkSpring(0),
    air: 0, crouch: 0, gather: 0, wait: 0, flinch: 0, narrow: 0, prevVy: 0, prevVx: 0, ay: 0, ax: 0, time: 0,
    blink: 2, twitch: 3, twitchEar: 0, twitchSide: 0, run: 0, core: 0, flare: 0, look: 0,
    balance: 0, crawl: 0, stretch: mkSpring(0), sway: 0
  };

  // two-bone IK in the pivot's y-z plane. bend: +1 joint behind (elbow), -1 joint ahead (knee)
  function ik(Lg, ty, tz, bend) {
    const a = Lg.L1, b = Lg.L2;
    const d = clamp(Math.hypot(ty, tz), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const phi = Math.atan2(-tz, -ty);
    const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const beta = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    Lg.up.rotation.x = phi - bend * alpha;
    Lg.lo.rotation.x = bend * (Math.PI - beta);
    return Lg.up.rotation.x + Lg.lo.rotation.x;
  }
  function placeLeg(Lg, rel) {
    Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
    _w.set(_v.x, _v.y + rel[1], _v.z + rel[0]);
    root.localToWorld(_w); Lg.pivot.worldToLocal(_w);
    if (Lg.hind) {
      const sum = ik(Lg, _w.y + Lg.L3 * 0.92, _w.z + Lg.L3 * 0.4, -1);
      Lg.hock.rotation.x = Math.atan2(Lg.L3 * 0.4, Lg.L3 * 0.92) - sum;
      Lg.paw.rotation.x = -(Lg.hock.rotation.x + sum) * 0.9;
    } else {
      const sum = ik(Lg, _w.y, _w.z, 1);
      Lg.paw.rotation.x = -sum * 0.9;
    }
  }

  function update(dt, s) {
    if (dt <= 0) return;
    S.time += dt;
    const speed = s.fwd, run = clamp(speed / 4.5, 0, 1);
    S.run = damp(S.run, run, 6, dt);
    S.ay = damp(S.ay, clamp((s.vy - S.prevVy) / dt, -60, 60), 18, dt); S.prevVy = s.vy;
    S.ax = damp(S.ax, clamp((s.vx - S.prevVx) / dt, -40, 40), 12, dt); S.prevVx = s.vx;
    for (const e of s.events) {
      if (e.type === 'land') { S.lift.v -= clamp(e.impact, 0, 14) * 0.075; S.pitch.v -= clamp(e.impact, 0, 14) * 0.18; S.flex.v += clamp(e.impact, 0, 14) * 0.08; S.stretch.v -= clamp(e.impact, 0, 14) * 0.06; }
      if (e.type === 'jump') { S.lift.v += 0.5; S.flex.v -= 1.4; S.stretch.v += 1.2; }
      if (e.type === 'bump') { S.pitch.v -= 3; S.lift.v -= 0.4; }
      if (e.type === 'scald') { S.flinch = 1; S.pitch.v += 4; }
      if (e.type === 'fragment') S.flare = 1;
    }
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const yawT = Math.atan2(-s.vx, Math.max(0.5, speed)) * 0.85;
    root.rotation.y = spring(S.yaw, yawT, 3.5, 0.9, dt);

    const grounded = s.grounded && s.scr === null;
    S.air = damp(S.air, grounded ? 0 : 1, grounded ? 22 : 12, dt);
    S.crouch = damp(S.crouch, s.crouch ? 1 : 0, 16, dt);
    S.gather = damp(S.gather, grounded ? s.edgeAhead : 0, 8, dt);
    S.narrow = damp(S.narrow, s.narrow, 6, dt);
    S.balance = damp(S.balance, s.surf === 'balance' ? 1 : 0, 5, dt);     // thin pipe: low, narrow stance, tail out
    S.crawl = damp(S.crawl, grounded && s.crouch ? 1 : 0, 10, dt);
    S.sway = damp(S.sway, s.surf === 'bridge' ? s.sway : 0, 8, dt);
    S.wait = damp(S.wait, grounded && speed < 0.4 ? 1 : 0, 5, dt);       // held back: crouched, watching
    S.flinch = Math.max(0, S.flinch - dt * 1.6);

    const stride = (0.5 + speed * 0.16) * (1 - 0.35 * S.balance);
    if (grounded) S.phase = (S.phase + dt * speed / stride) % 1;
    else if (s.scr !== null) S.phase = (S.phase + dt * 6) % 1;
    const ph = S.phase * TAU;
    const duty = lerp(lerp(0.62, 0.38, S.run), 0.7, S.balance);

    // body: height, pitch, lean, spine flex. On a pipe the cat goes low; on a slope it leans into it.
    const bob = grounded ? Math.abs(Math.sin(ph)) * 0.013 * S.run : 0;
    spring(S.lift, -0.095 * S.crouch - 0.03 * S.gather - 0.03 * S.narrow - 0.035 * S.balance - 0.05 * S.wait + bob * (1 - 0.6 * S.balance), 3.4, 0.45, dt);
    let pitchT = grounded ? Math.sin(ph) * 0.05 * S.run - 0.05 * S.crouch - Math.atan(s.slope[1]) * 0.7 : clamp(s.vy * 0.045, -0.35, 0.3);
    if (s.scr !== null) pitchT = 0.7 * (1 - s.scr);
    if (s.stumble > 0) pitchT -= 0.25 * clamp(s.stumble / 0.4, 0, 1);
    pitchT += 0.25 * S.flinch;
    spring(S.pitch, pitchT, 3.2, 0.5, dt);
    const teeter = s.teeter * Math.sin(S.time * 9) * 0.18;
    const slopeRoll = grounded ? Math.atan(s.slope[0]) * 0.75 : 0;
    spring(S.lean, clamp(-s.vx * 0.07, -0.3, 0.3) + teeter + slopeRoll * (1 - 0.7 * S.balance) + S.sway * 1.6, 3, 0.6, dt);
    const flexT = grounded ? Math.sin(ph + Math.PI / 2) * 0.13 * S.run + 0.06 * S.gather + 0.05 * S.wait : lerp(-0.14, 0.08, clamp(-s.vy / 6 + 0.5, 0, 1));
    spring(S.flex, flexT, 4.5, 0.55, dt);
    // in the air the body stretches long; a landing squashes it
    spring(S.stretch, grounded ? 0 : (s.vy > 0 ? 0.12 : 0.06), 3.5, 0.45, dt);
    body.scale.set(1 - S.stretch.x * 0.3, 1 - S.stretch.x * 0.4, 1 + S.stretch.x);
    body.position.y = SPINE_Y + S.lift.x;
    body.rotation.set(S.pitch.x, 0, S.lean.x);
    pelvis.rotation.x = S.flex.x; chest.rotation.x = -S.flex.x;
    root.updateMatrixWorld(true);

    // legs
    const falling = clamp(-s.vy / 5 + 0.5, 0, 1);
    for (const key in legs) {
      const Lg = legs[key];
      Lg.pivot.position.x = Lg.x0 * (1 - 0.65 * S.balance) * (1 + 0.25 * S.crawl);
      Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
      const h = _v.y;
      let gz, gy;
      const lp = (S.phase + OFFSET[key]) % 1;
      const reach = clamp(stride * duty * 0.5, 0.03, 0.15) * S.run * (1 - 0.35 * S.narrow);
      if (lp < duty) { gz = lerp(-reach, reach, lp / duty); gy = -h; }
      else { const u = (lp - duty) / (1 - duty); gz = lerp(reach, -reach, smooth(u)); gy = -h + Math.sin(Math.PI * u) * lerp(0.03, 0.08, S.run) * (1 - 0.4 * S.narrow); }
      gz += Lg.hind ? 0.012 : -0.01;
      if (S.run < 0.05) gz += (Lg.hind ? 0.02 : -0.02) * S.wait;
      let az, ay;
      if (s.sinceJump < 0.12 && !grounded) { az = Lg.hind ? 0.13 : 0.02; ay = Lg.hind ? -0.19 : -0.1; }
      else if (Lg.hind) { az = lerp(0.15, -0.02, falling); ay = lerp(-0.1, -0.15, falling); }
      else { az = lerp(-0.17, -0.09, falling); ay = lerp(-0.1, -0.2, falling); }
      if (s.scr !== null) { if (Lg.hind) { az = Math.sin(ph * 2 + (Lg.side > 0 ? 1.5 : 0)) * 0.06; ay = -0.15 + Math.cos(ph * 2) * 0.03; } else { az = -0.12; ay = 0.02 + 0.12 * s.scr; } }
      placeLeg(Lg, [lerp(gz, az, S.air), lerp(gy, ay, S.air)]);
    }

    // head: level against the body, looking where the cat is going; up at the hazard while waiting
    let look = -0.08 - 0.22 * S.gather - 0.12 * S.narrow - 0.12 * S.balance + 0.3 * S.wait;
    if (!grounded) look = lerp(0.12, -0.38, falling);
    head.rotation.x = -(S.pitch.x - S.flex.x) * 0.85 + look - 0.15 * S.crouch;
    head.position.y = 0.078 - 0.05 * S.crouch - 0.012 * S.narrow;
    head.rotation.y = clamp((-s.vx * 0.12 - s.assistX * 0.15) * (1 - 0.6 * S.balance) + Math.sin(S.time * 0.9) * 0.25 * S.wait, -0.5, 0.5);
    head.rotation.z = -S.lean.x * 0.6;
    // ears: flatten with speed, when ducking and from steam; forward when watching
    S.twitch -= dt; if (S.twitch < 0) { S.twitch = 2 + Math.random() * 3; S.twitchEar = 0.18; S.twitchSide = Math.random() < 0.5 ? 0 : 1; }
    S.twitchEar = Math.max(0, S.twitchEar - dt);
    ears.forEach((e, i) => { e.g.rotation.x = -(0.15 * S.run + 0.9 * S.crouch + 0.3 * S.air * (1 - falling) + 1.1 * S.flinch + 0.3 * S.crawl) + 0.15 * S.wait + (S.twitchEar > 0 && i === S.twitchSide ? 0.35 : 0); });
    S.blink -= dt; if (S.blink < 0) S.blink = 2.5 + Math.random() * 3;
    const ey = S.blink < 0.1 || S.flinch > 0.5 ? 0.15 : 1; for (const e of eyes) e.scale.y = ey;

    // the core: brighter with every fragment, flaring when one is taken
    S.core = damp(S.core, s.charge, 4, dt); S.flare = Math.max(0, S.flare - dt * 1.4);
    const glow = 0.35 + 0.22 * S.core + 0.6 * S.flare + 0.05 * Math.sin(S.time * 4);
    A.M.core.color.setRGB(0.25 + 0.2 * glow, 0.7 + 0.3 * glow, 0.45 + 0.2 * glow);
    coreGlow.scale.setScalar(0.07 + 0.05 * S.core + 0.18 * S.flare);
    A.M.coreGlow.opacity = clamp(0.45 + 0.15 * S.core + 0.4 * S.flare, 0, 1);

    // tail: streams back at speed, out straight and level on pipes for balance, low and
    // twitching while waiting, bristling up from steam
    const upBase = lerp(lerp(-0.85, -0.1, S.run), -0.25, S.balance) - 0.35 * s.teeter + 0.05 * S.narrow + 0.5 * S.wait - 0.9 * S.flinch + 0.25 * S.crawl;
    for (let i = 0; i < TAIL_N; i++) {
      const t = tail[i], k = i / (TAIL_N - 1);
      const curl = lerp(0.07, -0.16, k) * lerp(1.6, 1, S.run) * (1 - 0.8 * S.narrow) + (S.wait * (k > 0.6 ? -0.25 : 0.1));
      const pT = (i === 0 ? upBase : curl) + clamp(S.ay * 0.004, -0.25, 0.25) * (0.4 + k) - S.crouch * (i === 0 ? -0.5 : 0.05);
      const swish = Math.sin(S.time * (7 - 3 * S.wait - 3.5 * S.balance) - i * 0.6) * (0.04 + 0.16 * s.teeter + 0.1 * S.narrow + 0.22 * S.balance + 0.1 * S.wait) * (0.3 + k);
      // on a thin pipe or a swaying bridge the tail swings against the body's lean: a counterweight
      const yT = (i === 0 ? 0 : clamp(S.ax * 0.01, -0.2, 0.2)) + swish - S.lean.x * (0.7 + 1.4 * Math.max(S.balance, Math.abs(S.sway) * 5)) * (i < 5 ? 1 : 0.4);
      t.g.rotation.x = spring(t.p, pT, t.f, 0.4, dt);
      t.g.rotation.y = spring(t.y, yT, t.f, 0.35, dt);
    }
  }

  function setShadows(on) { for (const m of meshes) if (m.material !== A.M.eye && m.material !== A.M.core) m.castShadow = on; }
  function dispose() { for (const g of owned) g.dispose(); if (root.parent) root.parent.remove(root); }
  return { root, update, dispose, setShadows };
}

// ---- 09_camera.js ----
// =====================================================================
// The follow camera. Behind and above the cat, never orbiting.
//
// What it does, in order of importance:
//  1. Rides a smoothed ground reference, not the cat: a jump arc doesn't
//     bob the frame, but a new roof height is followed promptly.
//  2. Reads the terrain ahead (probes at fixed distances): pitches toward
//     drops and rises before the cat gets there, and when a gap is coming
//     it lifts and eases back so the landing surface is in frame.
//  3. Keeps the route in frame: sits partly toward the middle of the
//     surface the cat is on, so the next choice is visible.
//  4. Stays out of walls: pulls in along the cat-to-camera line when
//     something solid is in the way; thin things it can see past are faded.
//  5. Frames portrait and landscape differently (presets in TUNING).
// =====================================================================

function createFollowCamera(THREE, camera, world) {
  const T = TUNING.camera;
  const st = {
    pos: new THREE.Vector3(), look: new THREE.Vector3(), refY: 0, aheadY: 0, gap: 0, laneX: 0, pull: 1, dip: mkSpring(0),
    fov: 54, init: false, fade: new Set(), preset: 'auto', portraitK: 0
  };
  const want = new THREE.Vector3(), lookWant = new THREE.Vector3();

  function frame(portrait) {
    const k = st.portraitK = st.preset === 'auto' ? (portrait ? 1 : 0) : st.preset === 'portrait' ? 1 : 0;
    const a = T.landscape, b = T.portrait, o = {};
    for (const key in a) o[key] = lerp(a[key], b[key], k);
    return o;
  }

  // terrain under a probe, ignoring the overhead things the camera fades (ducts, low pipes)
  function groundAhead(x, z, fromY) {
    let y = fromY;
    for (let i = 0; i < 3; i++) {
      const g = world.groundAt(x, z, y, 0.3, 0.3);
      if (!g.box || g.box.cam !== 'fade') return g;
      y = g.box.y0 - 0.01;
    }
    return { y: -Infinity, box: null };
  }
  // ground heights ahead of the cat; a missing or much lower probe is a gap
  function probe(cat) {
    let sum = 0, wsum = 0, gap = 0;
    for (let i = 0; i < T.terrainProbe.length; i++) {
      const d = T.terrainProbe[i], z = cat.pos[2] - d;
      const g = groundAhead(cat.pos[0], z, cat.pos[1] + 1.1);
      const w = 1 / (1 + i);
      if (g.box && !g.box.far && g.y > cat.pos[1] - 3) { sum += g.y * w; wsum += w; if (g.y < st.refY - 0.6 && d < 10) gap = Math.max(gap, 0.5); }
      else if (d <= 10) gap = Math.max(gap, 1 - (d - T.terrainProbe[0]) / 10);
    }
    return { y: wsum ? sum / wsum : st.refY, gap };
  }

  function update(dt, cat, portrait, events) {
    const F = frame(portrait);
    const grounded = cat.grounded;
    // 1. ground reference
    if (!st.init) { st.refY = cat.pos[1]; st.aheadY = cat.pos[1]; st.laneX = cat.pos[0]; }
    const refTarget = grounded ? cat.pos[1] : Math.min(st.refY, cat.pos[1]);
    // follow a real drop promptly (falling fast, or landed below the reference); ignore jump arcs
    const dropping = !grounded && cat.vel[1] < -3, below = grounded && cat.pos[1] < st.refY - 0.3;
    st.refY = damp(st.refY, refTarget, below ? T.heightK * 2 : grounded ? T.heightK : dropping ? T.heightK : T.airHeightK, dt);
    // 2. terrain ahead
    const p = probe(cat);
    st.aheadY = damp(st.aheadY, p.y, 2.5, dt);
    st.gap = damp(st.gap, p.gap, p.gap > st.gap ? 4 : 1.5, dt);
    // 3. lane: the middle of whatever is underfoot (or the cat, in the air)
    const g = grounded && cat.ground && !cat.ground.far ? cat.ground : null;
    const lane = g ? clamp((g.x0 + g.x1) / 2, cat.pos[0] - 1.6, cat.pos[0] + 1.6) : cat.pos[0];
    st.laneX = damp(st.laneX, lane, 1.5, dt);
    for (const e of events) if (e.type === 'land') st.dip.v -= clamp(e.impact, 0, 14) * T.landDip;
    spring(st.dip, 0, 2.2, 0.6, dt);

    const speed = cat.fwd;
    // the finale: rise and pull back so the beam to the tower fills the frame
    const fin = smooth(cat.finale || 0);
    const back = F.back + speed * T.speedBack + st.gap * T.gapBack + fin * 2.2;
    const up = F.up + st.gap * T.gapLift + fin * 1.4;
    const x = lerp(st.laneX, cat.pos[0], F.follow);
    // in the air, rise with a third of the arc: enough to keep looking down onto the landing
    const arc = grounded ? 0 : Math.max(0, cat.pos[1] - st.refY) * T.arcFollow;
    want.set(x, Math.max(st.refY, st.aheadY - 0.5) + up + arc + st.dip.x, cat.pos[2] + back);
    lookWant.set(lerp(x, cat.pos[0] + cat.vel[0] * 0.25, 0.6) + fin * 1.4, lerp(st.refY, st.aheadY, 0.55) + F.lookUp + 0.35 + fin * 7, cat.pos[2] - F.lookAhead - fin * 10);
    if (!st.init) { st.pos.copy(want); st.look.copy(lookWant); st.init = true; }
    st.pos.x = damp(st.pos.x, want.x, T.posK * 0.7, dt);
    st.pos.y = damp(st.pos.y, want.y, T.posK * 0.8, dt);
    st.pos.z = damp(st.pos.z, want.z, T.posK * 1.6, dt);
    st.look.x = damp(st.look.x, lookWant.x, T.lookK, dt);
    st.look.y = damp(st.look.y, lookWant.y, T.lookK * 0.6, dt);
    st.look.z = damp(st.look.z, lookWant.z, T.lookK * 2, dt);

    // 4. obstruction: pull in toward the cat; fade the thin things instead
    const o = [cat.pos[0], cat.pos[1] + 0.3, cat.pos[2]];
    const d = [st.pos.x - o[0], st.pos.y - o[1], st.pos.z - o[2]], dl = Math.hypot(d[0], d[1], d[2]);
    for (let i = 0; i < 3; i++) d[i] /= dl;
    const hit = world.ray(o, d, dl, b => b.cam === 'block' && !b.far);
    const pullT = hit < Infinity ? clamp((hit - T.nearClip) / dl, 0.25, 1) : 1;
    st.pull = pullT < st.pull ? pullT : damp(st.pull, pullT, 2.5, dt);
    st.fade.clear();
    // anticipate: anything thin between the camera and the next 1.5 m of the cat's path fades
    // before the cat goes under it, not once it is already hidden
    const ahead = o[2] - 1.5 - cat.fwd * 0.15;
    for (const b of world.overlaps(Math.min(o[0], st.pos.x) - 0.3, Math.max(o[0], st.pos.x) + 0.3, Math.min(o[1] - 0.3, st.pos.y), Math.max(o[1], st.pos.y) + 0.2, Math.min(ahead, st.pos.z), Math.max(o[2], st.pos.z))) if (b.cam === 'fade') st.fade.add(b.id);

    camera.position.set(o[0] + d[0] * dl * st.pull, o[1] + d[1] * dl * st.pull, o[2] + d[2] * dl * st.pull);
    camera.lookAt(st.look);
    const fov = F.fov + speed * T.speedFov * 0.5 + st.gap * 2;
    st.fov = damp(st.fov, fov, 3, dt);
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
  }
  function reset() { st.init = false; st.pull = 1; st.dip.x = st.dip.v = 0; }
  return { update, reset, st };
}

// ---- 10_scene.js ----
// =====================================================================
// The visible city. Architecture is built from the collision shapes
// (what you see is exactly what you stand on): tiled roofs with ridge
// caps and gable ends, plaster blocks with lit windows, oxidised pipes
// with flanges and supports, grated catwalks on hangers. Around them,
// lived-in detail, moving machinery, steam, and the relay tower on the
// horizon. Static geometry is merged per material: a handful of draw calls.
// =====================================================================

function createScene(THREE, A, scene, world, slice, hazards, opts) {
  const { M } = A;
  const root = new THREE.Group(); scene.add(root);
  const ownGeo = [], ownMat = [];
  const keep = g => { ownGeo.push(g); return g; };
  const own = m => { ownMat.push(m); return m; };
  const B = new Batch();          // near: casts and receives shadows
  const BF = new Batch();         // scenery and far layers: no shadows
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const xf = (x, y, z, sx, sy, sz, rx, ry, rz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx, sy, sz));
  const G = {
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 20, 1)), cyl8: keep(new THREE.CylinderGeometry(1, 1, 1, 8, 1)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)), dish: keep(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, 0.9)),
    torus: keep(new THREE.TorusGeometry(1, 0.12, 6, 16)), cone: keep(new THREE.ConeGeometry(1, 1, 7))
  };
  const PL = PAL.plaster.map(hex3), WHITE = [1, 1, 1];
  const plasterOf = b => PL[((b.plaster !== undefined ? b.plaster : b.id) % PL.length + PL.length) % PL.length];
  const lowCol = hex3('#14161b');
  const T = b => (b.far ? BF : B);

  // ---------------- architecture from shapes ----------------
  const fades = new Map(), unstableViews = [], bridges = [];
  for (const b of world.boxes) {
    const pc = plasterOf(b), Bt = T(b), dark = b.far ? 0.72 : 1;
    switch (b.kind) {
      case 'terrace':
        Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: mul3(hex3('#a39c90'), dark), sideCol: mul3(pc, dark), sideColLow: lowCol, fadeDepth: 9, uvSide: 3, uvShift: b.id * 1.7 });
        cornice(Bt, b, pc);
        break;
      case 'building':
        Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: mul3(hex3('#6f6a63'), dark), sideCol: mul3(pc, dark * 0.95), sideColLow: lowCol, fadeDepth: b.far ? 7 : 9, uvSide: 3, uvShift: b.id * 1.7 });
        cornice(Bt, b, pc);
        break;
      case 'parapet':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: hex3('#b8b0a2'), sideCol: mul3(pc, 1.05), sideColLow: mul3(pc, 0.8), fadeDepth: 0.5, uvSide: 1.5 });
        break;
      case 'roof': roof(Bt, b, dark); break;
      case 'chimney':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'dark', side: 'brick', sideCol: WHITE, sideColLow: mul3(WHITE, 0.7), fadeDepth: 1.5, uvSide: 1 });
        B.box(b.x0 - 0.06, b.x1 + 0.06, b.y1 - 0.08, b.y1 + 0.02, b.z0 - 0.06, b.z1 + 0.06, { top: 'concrete', side: 'concrete', topCol: hex3('#7f7a72'), sideCol: hex3('#8d877e') });
        break;
      case 'pipe': pipe(b); break;
      case 'valve':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#b9a28a'), sideCol: hex3('#4e5a5c'), sideColLow: hex3('#2e3436'), fadeDepth: 0.6, uvTop: 1, uvSide: 1 });
        B.geo('metal', G.torus, xf(b.x0 + 0.35, b.y1 + 0.32, (b.z0 + b.z1) / 2, 0.24, 0.24, 0.24, 0, Math.PI / 2, 0), hex3('#8c3b2c'), THREE);
        B.geo('metal', G.cyl8, xf(b.x0 + 0.35, b.y1 + 0.16, (b.z0 + b.z1) / 2, 0.04, 0.32, 0.04), hex3('#4e5a5c'), THREE);
        break;
      case 'grate':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#c0a891'), sideCol: hex3('#4a5355'), sideColLow: hex3('#2a2f31'), fadeDepth: 0.5, uvTop: 1, uvSide: 1 });
        for (const x of [b.x0 + 0.1, b.x1 - 0.1]) for (const z of [b.z0 + 0.1, b.z1 - 0.1]) B.geo('metal', G.box, xf(x, (b.y0 + STREET_Y) / 2, z, 0.1, b.y0 - STREET_Y, 0.1), hex3('#3c4446'), THREE);
        break;
      case 'catwalk': {
        const target = b.unstable ? new Batch() : B;
        catwalk(target, b);
        if (b.unstable) {
          const g = target.build(THREE, { grate: M.grate, metal: M.metal, cable: M.cable }, { cast: true, receive: true });
          const spark = new THREE.Sprite(M.glowWarm); spark.scale.setScalar(0.25); spark.position.set(b.x1, b.y1 + 0.02, b.z1); g.add(spark);
          root.add(g); unstableViews.push({ b, g, spark });
        }
        break;
      }
      case 'rail':
        for (let z = b.z1 - 0.2; z > b.z0; z -= 0.9) B.geo('metal', G.box, xf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z, 0.035, b.y1 - b.y0, 0.035), hex3('#5a5048'), THREE);
        B.box(b.x0, b.x1, b.y1 - 0.04, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#7a6a5c'), sideCol: hex3('#5a4c40'), uvSide: 1 });
        break;
      case 'lowPipe': fades.set(b.id, lowPipe(b)); break;
      case 'tinRoof': shedRoof(b, 'tin'); break;
      case 'ramp': shedRoof(b, 'grate'); break;
      case 'tank':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#7d8a86'), sideCol: hex3('#45524f'), sideColLow: hex3('#1c2224'), fadeDepth: 3, uvTop: 1.5, uvSide: 1.5 });
        for (const y of [b.y1 - 0.15, b.y1 - 1.1, b.y1 - 2.1]) B.box(b.x0 - 0.04, b.x1 + 0.04, y - 0.06, y, b.z0 - 0.04, b.z1 + 0.04, { top: 'metal', side: 'metal', topCol: hex3('#3a4442'), sideCol: hex3('#2c3432'), faces: { pz: true, nz: true, px: true, nx: true } });
        break;
      case 'scaffold': scaffold(b); break;
      case 'bridge': bridges.push({ b, g: ropeBridge(b) }); break;
      case 'duct': fades.set(b.id, fadeBox(b, '#55605f')); break;
      case 'hopPipe':
        B.geo('metal', G.cyl, xf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, (b.y1 - b.y0) / 2, b.x1 - b.x0 + 0.8, (b.z1 - b.z0) / 2, 0, 0, Math.PI / 2), hex3('#7a5a46'), THREE);
        break;
      case 'machine':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#4c5654'), sideCol: hex3('#3a4341'), uvSide: 1 });
        for (let i = 0; i < 4; i++) B.box(b.x1 - 0.02, b.x1 + 0.01, b.y0 + 0.25 + i * 0.16, b.y0 + 0.3 + i * 0.16, b.z0 + 0.3, b.z1 - 0.3, { top: 'dark', side: 'dark', faces: { px: true } });
        { const sp = new THREE.Sprite(M.glowRed); sp.position.set(b.x1 + 0.05, b.y1 - 0.15, b.z1 - 0.2); sp.scale.setScalar(0.25); root.add(sp); }
        break;
    }
  }
  function cornice(Bt, b, pc) {
    if (b.y1 - b.y0 < 2) return;
    Bt.box(b.x0 - 0.06, b.x1 + 0.06, b.y1 - 0.22, b.y1 - 0.05, b.z0 - 0.06, b.z1 + 0.06, { top: 'plain', side: 'plain', topCol: mul3(pc, 0.8), sideCol: mul3(pc, 0.62), faces: { pz: true, nz: true, px: true, nx: true, top: true } });
  }
  // pitched roofs: two tiled slopes, a ridge cap, plaster gable ends, dark eaves
  function roof(Bt, b, dark) {
    const tc = mul3(WHITE, dark * (0.85 + ((b.id * 37) % 10) / 40)), eaveC = mul3(tc, 0.72), pc = mul3(plasterOf(b), dark * 0.9);
    const slope = (a, bb, c, d, n, len, w) => Bt.quad('tile', a, bb, c, d, n, [[0, 0], [w, 0], [w, len], [0, len]], [eaveC, eaveC, tc, tc]);
    if (b.shape === 'gableX') {
      const zc = (b.z0 + b.z1) / 2, hl = (b.z1 - b.z0) / 2, rise = b.yr - b.ye, len = Math.hypot(hl, rise), w = b.x1 - b.x0;
      const nN = [0, hl / len, rise / len], nF = [0, hl / len, -rise / len];
      slope([b.x0, b.ye, b.z1], [b.x1, b.ye, b.z1], [b.x1, b.yr, zc], [b.x0, b.yr, zc], nN, len, w);
      slope([b.x1, b.ye, b.z0], [b.x0, b.ye, b.z0], [b.x0, b.yr, zc], [b.x1, b.yr, zc], nF, len, w);
      Bt.geo('tile', G.cyl8, xf((b.x0 + b.x1) / 2, b.yr, zc, 0.075, w + 0.04, 0.075, 0, 0, Math.PI / 2), mul3(tc, 0.75), THREE);
      for (const [x, s] of [[b.x0 + 0.18, -1], [b.x1 - 0.18, 1]]) {
        Bt.tri('wall', [x, b.ye, s < 0 ? b.z1 - 0.15 : b.z0 + 0.15], [x, b.ye, s < 0 ? b.z0 + 0.15 : b.z1 - 0.15], [x, b.yr - 0.08, zc], [s, 0, 0], [[0, 0], [1, 0], [0.5, 0.4]], [pc, pc, pc]);
        Bt.quad('wall', [x, b.y0, b.z1 - 0.15], [x, b.y0, b.z0 + 0.15], [x, b.ye, b.z0 + 0.15], [x, b.ye, b.z1 - 0.15], [s, 0, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], [pc, pc, pc, pc]);
      }
      for (const z of [b.z0, b.z1]) Bt.box(b.x0, b.x1, b.ye - 0.1, b.ye + 0.01, z - 0.04, z + 0.04, { top: 'dark', side: 'dark' });
    } else {
      const xc = (b.x0 + b.x1) / 2, hw = (b.x1 - b.x0) / 2, rise = b.yr - b.ye, len = Math.hypot(hw, rise), w = b.z1 - b.z0;
      const nL = [-rise / len, hw / len, 0], nR = [rise / len, hw / len, 0];
      slope([b.x0, b.ye, b.z0], [b.x0, b.ye, b.z1], [xc, b.yr, b.z1], [xc, b.yr, b.z0], nL, len, w);
      slope([b.x1, b.ye, b.z1], [b.x1, b.ye, b.z0], [xc, b.yr, b.z0], [xc, b.yr, b.z1], nR, len, w);
      Bt.geo('tile', G.cyl8, xf(xc, b.yr, (b.z0 + b.z1) / 2, 0.075, w + 0.04, 0.075, Math.PI / 2, 0, 0), mul3(tc, 0.75), THREE);
      for (const [z, s] of [[b.z1 - 0.12, 1], [b.z0 + 0.12, -1]]) {
        Bt.tri('wall', [s > 0 ? b.x0 + 0.15 : b.x1 - 0.15, b.ye, z], [s > 0 ? b.x1 - 0.15 : b.x0 + 0.15, b.ye, z], [xc, b.yr - 0.08, z], [0, 0, s], [[0, 0], [1, 0], [0.5, 0.4]], [pc, pc, pc]);
        Bt.quad('wall', [b.x0 + 0.15, b.y0, z], [b.x1 - 0.15, b.y0, z], [b.x1 - 0.15, b.ye, z], [b.x0 + 0.15, b.ye, z], [0, 0, s], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], [pc, pc, pc, pc]);
      }
      for (const x of [b.x0, b.x1]) Bt.box(x - 0.04, x + 0.04, b.ye - 0.1, b.ye + 0.01, b.z0, b.z1, { top: 'dark', side: 'dark' });
    }
  }
  function shedRoof(b, mat) {
    const tc = hex3('#c9bca8'), lc = mul3(tc, 0.75), w = b.x1 - b.x0, len = Math.hypot(b.z1 - b.z0, b.yNear - b.yFar);
    const n = [0, (b.z1 - b.z0) / len, (b.yNear - b.yFar) / len];
    B.quad(mat, [b.x0, b.yFar, b.z0], [b.x0, b.yNear, b.z1], [b.x1, b.yNear, b.z1], [b.x1, b.yFar, b.z0], n, [[0, 0], [len, 0], [len, w], [0, w]], [lc, tc, tc, lc]);
    const pc = plasterOf(b);
    for (const [x, s] of [[b.x0 + 0.05, -1], [b.x1 - 0.05, 1]]) B.quad('wall', [x, b.y0, b.z1], [x, b.y0, b.z0], [x, b.yFar, b.z0], [x, b.yNear, b.z1], [s, 0, 0], [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [pc, pc, pc, pc]);
    B.box(b.x0, b.x1, b.yFar - 0.12, b.yFar, b.z0 - 0.05, b.z0 + 0.03, { top: 'dark', side: 'dark' });
  }
  // pipes: oxidised steel with flanges, and supports down into the alley
  function pipe(b) {
    const len = b.z1 - b.z0, zc = (b.z0 + b.z1) / 2, c = b.narrow ? hex3('#6f4f3e') : hex3('#4f6366');
    // inclined pipes run from cy at the near end to cyFar at the far end
    const yAt = z => world.pipeY(b, z), dir = new THREE.Vector3(0, yAt(b.z0) - yAt(b.z1), -len), L = dir.length(); dir.normalize();
    const along = (z, sx, sy, sz) => { _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); return _m.compose(_p.set(b.cx, yAt(z), z), _q, _s.set(sx, sy, sz)); };
    const g = keep(new THREE.CylinderGeometry(b.r, b.r, L, b.narrow ? 14 : 22, 1, true));
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b.r * TAU), uv.getY(i) * L / 1.5);
    B.geo('metal', g, along(zc, 1, 1, 1), c, THREE);
    for (let z = b.z1 - 1.2; z > b.z0 + 0.4; z -= 2.4) B.geo('metal', G.cyl, along(z, b.r * 1.13, 0.09, b.r * 1.13), mul3(c, 0.7), THREE);
    for (let z = b.z1 - 3; z > b.z0 + 1; z -= 6) {
      const y = yAt(z);
      B.geo('metal', G.box, xf(b.cx, (y - b.r + STREET_Y) / 2, z, 0.12, y - b.r - STREET_Y, 0.12), hex3('#3a4244'), THREE);
      B.geo('metal', G.box, xf(b.cx, y - b.r - 0.05, z, b.r * 2.2, 0.1, 0.14), hex3('#3a4244'), THREE);
    }
  }
  function catwalk(Bt, b) {
    Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#c2a993'), sideCol: hex3('#52504a'), uvTop: 1, uvSide: 1 });
    for (let z = b.z1 - 0.3; z > b.z0; z -= 2) {
      Bt.geo('metal', G.box, xf((b.x0 + b.x1) / 2, b.y0 - 0.04, z, b.x1 - b.x0 + 0.1, 0.06, 0.08), hex3('#3a3a36'), THREE);
      for (const x of [b.x0 - 0.03, b.x1 + 0.03]) Bt.geo('cable', G.cyl8, xf(x, b.y1 + 2.2, z, 0.012, 4.4, 0.012), WHITE, THREE);
    }
  }
  // scaffolding: plank deck on a pole frame that runs down into the alley
  function scaffold(b) {
    for (let x = b.x0 + 0.08; x < b.x1; x += 0.24) B.box(x, Math.min(b.x1, x + 0.21), b.y0, b.y1, b.z0, b.z1, { top: 'plain', side: 'plain', topCol: mul3(hex3('#8a6a48'), 0.85 + ((x * 31) % 1) * 0.3), sideCol: hex3('#5a4430') });
    for (const x of [b.x0 + 0.05, b.x1 - 0.05]) for (const z of [b.z0 + 0.05, b.z1 - 0.05]) B.geo('metal', G.cyl8, xf(x, (b.y1 + 0.9 + STREET_Y) / 2, z, 0.03, b.y1 + 0.9 - STREET_Y, 0.03), hex3('#6b6a62'), THREE);
    for (let y = b.y0 - 1.5; y > STREET_Y; y -= 2) for (const z of [b.z0 + 0.05, b.z1 - 0.05]) B.geo('metal', G.cyl8, xf((b.x0 + b.x1) / 2, y, z, 0.025, b.x1 - b.x0, 0.025, 0, 0, Math.PI / 2), hex3('#6b6a62'), THREE);
    B.geo('metal', G.cyl8, xf((b.x0 + b.x1) / 2, b.y1 + 0.85, b.z0 + 0.05, 0.025, b.x1 - b.x0, 0.025, 0, 0, Math.PI / 2), hex3('#6b6a62'), THREE);
  }
  // rope bridge: slatted planks on two ropes, hung from anchors; moves with the sway
  function ropeBridge(b) {
    const T2 = new Batch(), w = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2;
    for (let z = b.z1 - 0.1; z > b.z0; z -= 0.27) T2.box(b.x0 - 0.04, b.x1 + 0.04, b.y0, b.y1, z - 0.2, z, { top: 'plain', side: 'plain', topCol: mul3(hex3('#7d5f40'), 0.8 + ((z * 7.3) % 1 + 1) % 1 * 0.35), sideCol: hex3('#4a3828') });
    const len = b.z1 - b.z0;
    for (const x of [b.x0 - 0.05, b.x1 + 0.05]) {
      for (const y of [b.y1 - 0.03, b.y1 + 0.45]) T2.geo('cable', G.cyl8, xf(x, y, (b.z0 + b.z1) / 2, 0.012, len, 0.012, Math.PI / 2, 0, 0), WHITE, THREE);
      for (let z = b.z1 - 0.5; z > b.z0; z -= 1) T2.geo('cable', G.cyl8, xf(x, b.y1 + 0.22, z, 0.008, 0.45, 0.008), WHITE, THREE);
    }
    void w; void cx;
    const g = T2.build(THREE, { plain: M.plain, cable: M.cable }, { cast: true, receive: true });
    root.add(g);
    // anchors on each end stay put
    for (const z of [b.z0, b.z1]) for (const x of [b.x0 - 0.12, b.x1 + 0.12]) B.geo('metal', G.box, xf(x, b.y1 + 0.3, z, 0.06, 0.7, 0.06), hex3('#4a4a44'), THREE);
    return g;
  }
  // a fading obstruction the camera must see past (ducts, low pipes)
  function fadeBox(b, col) {
    const g = new THREE.Group(), mat = own(new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 1 }));
    const m = new THREE.Mesh(G.box, mat); m.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0); m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2); m.castShadow = true; g.add(m);
    for (const x of [b.x0 + 0.15, b.x1 - 0.15]) { const s2 = new THREE.Mesh(G.box, mat); s2.scale.set(0.06, 0.6, (b.z1 - b.z0) + 0.06); s2.position.set(x, b.y1 + 0.2, (b.z0 + b.z1) / 2); g.add(s2); }
    root.add(g);
    return { g, mat, k: 1 };
  }
  function lowPipe(b) {
    const g = new THREE.Group(), mat = own(new THREE.MeshLambertMaterial({ color: '#6c7e80', transparent: true, opacity: 1 }));
    const len = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, h = b.y1 - b.y0;
    for (const [dz, r] of [[-0.18, h * 0.45], [0.2, h * 0.38]]) { const m = new THREE.Mesh(G.cyl, mat); m.scale.set(r, len, r); m.rotation.z = Math.PI / 2; m.position.set(cx, b.y0 + r, cz + dz); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    for (const sx of [b.x0 + 0.2, b.x1 - 0.2]) { const s = new THREE.Mesh(G.box, mat); s.scale.set(0.05, h + 0.06, (b.z1 - b.z0) * 0.95); s.position.set(sx, b.y0 + h / 2, cz); g.add(s); }
    root.add(g);
    return { g, mat, k: 1 };
  }

  // ---------------- steam and smoke: pooled particles ----------------
  const PART_VS = 'attribute float aLife; attribute float aSize; varying float vLife; uniform float uScale; void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (0.6 + aLife * 1.6) * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }';
  const PART_FS = 'uniform sampler2D map; uniform vec3 color; uniform float opacity; varying float vLife; void main(){ if (vLife <= 0.0 || vLife >= 1.0) discard; vec4 t = texture2D(map, gl_PointCoord); float a = t.a * opacity * smoothstep(0.0, 0.12, vLife) * (1.0 - vLife); gl_FragColor = vec4(color, a); }';
  const partMats = {};
  function partMat(kind) {
    if (partMats[kind]) return partMats[kind];
    const steam = kind === 'steam';
    return partMats[kind] = own(new THREE.ShaderMaterial({
      uniforms: { map: { value: A.T.puff }, color: { value: new THREE.Color(steam ? '#d4dde2' : '#2f353d') }, opacity: { value: steam ? 0.65 : 0.5 }, uScale: { value: 300 } },
      vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false
    }));
  }
  function emitter(_unused, n, at, kind) {
    const g = keep(new THREE.BufferGeometry());
    const pos = new Float32Array(n * 3), life = new Float32Array(n), size = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(life, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(g, partMat(kind)); pts.frustumCulled = false; root.add(pts);
    return { g, pos, life, size, vel: new Float32Array(n * 3), dur: new Float32Array(n), n, at, kind, acc: 0, next: 0 };
  }
  function emit(e, rate, dt, spawn) {
    e.acc += rate * dt;
    while (e.acc >= 1) { e.acc -= 1; const i = e.next; e.next = (e.next + 1) % e.n; spawn(i); }
  }
  function stepEmitter(e, dt, buoy) {
    for (let i = 0; i < e.n; i++) {
      if (e.life[i] <= 0 || e.life[i] >= 1) { e.life[i] = 0; continue; }
      e.life[i] += dt / e.dur[i];
      e.vel[i * 3 + 1] += buoy * dt; e.vel[i * 3] *= 1 - dt * 0.8; e.vel[i * 3 + 2] *= 1 - dt * 0.8;
      for (let k = 0; k < 3; k++) e.pos[i * 3 + k] += e.vel[i * 3 + k] * dt;
    }
    e.g.attributes.position.needsUpdate = true; e.g.attributes.aLife.needsUpdate = true; e.g.attributes.aSize.needsUpdate = true;
  }
  // ---------------- lived-in detail and machinery ----------------
  const lamps = [], fans = [], smokes = [], signal = [], sparks = [];
  const glowMat = c => (c === 'green' ? M.glowGreen : c === 'violet' ? M.glowViolet : M.glowWarm);
  for (const d of slice.decor) {
    switch (d.kind) {
      case 'pots':
        for (let i = 0; i < 3; i++) {
          const x = d.x + (i - 1) * 0.2, s = 0.07 + i * 0.012;
          B.geo('brick', G.cyl8, xf(x, d.y + s * 0.9, d.z, s, s * 1.8, s), WHITE, THREE);
          for (let k = 0; k < 3; k++) B.geo('plain', G.cone, xf(x + (k - 1) * 0.03, d.y + s * 1.8 + 0.08, d.z + (k % 2) * 0.02, s * 0.45, 0.18 + k * 0.03, s * 0.45, 0, 0, (k - 1) * 0.35), hex3('#2c3d27'), THREE);
        }
        break;
      case 'lamp': {
        B.geo('metal', G.box, xf(d.x, d.y, d.z, 0.12, 0.08, 0.16), hex3('#2a2d30'), THREE);
        const sp = new THREE.Sprite(glowMat(d.color)); sp.scale.setScalar(d.color === 'warm' ? 1.4 : 1.8); sp.position.set(d.x, d.y - 0.06, d.z); root.add(sp);
        lamps.push({ sp, base: sp.scale.x, ph: lamps.length * 1.7, flicker: d.color !== 'warm' });
        break;
      }
      case 'antenna':
        B.geo('metal', G.cyl8, xf(d.x, d.y + 0.9, d.z, 0.02, 1.8, 0.02), hex3('#3a3c40'), THREE);
        for (let i = 0; i < 3; i++) B.geo('metal', G.box, xf(d.x, d.y + 1.2 + i * 0.22, d.z, 0.7 - i * 0.15, 0.02, 0.02), hex3('#3a3c40'), THREE);
        B.geo('plain', G.dish, xf(d.x - 0.2, d.y + 0.7, d.z + 0.2, 0.28, 0.28, 0.1, Math.PI / 2 - 0.3, 0.6, 0), hex3('#9a9890'), THREE);
        break;
      case 'brokenRoof': {
        // the hole: dark rafters across it, splintered tiles at its edges
        for (let x = d.x0 + 0.3; x < d.x1; x += 0.55) B.geo('plain', G.box, xf(x, d.eave + (d.y - d.eave) * (1 - Math.abs(x - (d.x0 + d.x1) / 2) / ((d.x1 - d.x0) / 2)) - 0.08, (d.z0 + d.z1) / 2, 0.07, 0.07, d.z1 - d.z0 + 0.2), hex3('#2a211b'), THREE);
        B.geo('plain', G.box, xf((d.x0 + d.x1) / 2, d.y - 0.12, (d.z0 + d.z1) / 2, 0.1, 0.1, d.z1 - d.z0 + 0.3), hex3('#2a211b'), THREE);
        break;
      }
      case 'tank':
        BF.geo('dark', G.cyl, xf(d.x, d.y + 0.35 + d.h / 2, d.z, d.r, d.h, d.r), WHITE, THREE);
        for (const s of [-1, 1]) BF.geo('metal', G.box, xf(d.x + s * d.r * 0.6, d.y + 0.17, d.z, 0.08, 0.35, d.r * 1.6), hex3('#4a4f52'), THREE);
        break;
      case 'stack': {
        BF.geo('metal', G.cyl, xf(d.x, d.y + d.h / 2, d.z, 0.28, d.h, 0.28), hex3('#5a5650'), THREE);
        BF.geo('metal', G.cyl, xf(d.x, d.y + d.h - 0.1, d.z, 0.33, 0.12, 0.33), hex3('#2c2b2a'), THREE);
        if (smokes.length < 6) smokes.push(emitter(M.smoke, 26, [d.x, d.y + d.h + 0.1, d.z], 'smoke'));
        break;
      }
      case 'crossPipe': {
        const len = d.x1 - d.x0, c = hex3('#57686a');
        BF.geo('metal', G.cyl, xf((d.x0 + d.x1) / 2, d.y, d.z, d.r, len, d.r, 0, 0, Math.PI / 2), c, THREE);
        for (let x = d.x0 + 1.5; x < d.x1; x += 3) BF.geo('metal', G.cyl, xf(x, d.y, d.z, d.r * 1.12, 0.1, d.r * 1.12, 0, 0, Math.PI / 2), mul3(c, 0.7), THREE);
        for (const x of [d.x0 + 2, d.x1 - 2]) BF.geo('cable', G.cyl8, xf(x, d.y + 3, d.z, 0.02, 6, 0.02), WHITE, THREE);
        break;
      }
      case 'bowl':
        B.geo('plain', G.cyl8, xf(d.x, d.y + 0.03, d.z, 0.09, 0.06, 0.09), hex3('#8a3a2c'), THREE);
        B.geo('plain', G.cyl8, xf(d.x + 0.2, d.y + 0.02, d.z + 0.1, 0.07, 0.04, 0.07), hex3('#7a7f86'), THREE);
        break;
      case 'gauge':
        B.geo('metal', G.cyl8, xf(d.x + 1.5, d.y + 0.25, d.z, 0.16, 0.06, 0.16, Math.PI / 2, 0, 0), hex3('#c9c1a8'), THREE);
        B.geo('metal', G.cyl8, xf(d.x + 1.5, d.y + 0.1, d.z, 0.03, 0.2, 0.03), hex3('#3a3a36'), THREE);
        break;
      case 'brokenCatwalk':
        for (const [z, s2] of [[d.z1, 1], [d.z0, -1]]) B.geo('grate', G.box, xf((d.x0 + d.x1) / 2, d.y - 0.35, z - s2 * 0.12, d.x1 - d.x0, 0.05, 0.75, s2 * 1.1, 0, 0.1 * s2), hex3('#9a846e'), THREE);
        B.geo('cable', G.cyl8, xf(d.x1 + 0.05, d.y - 0.9, (d.z0 + d.z1) / 2, 0.01, 1.8, 0.01, 0.2, 0, 0), WHITE, THREE);
        break;
      case 'signalLine':
        for (let i = 0; i + 1 < d.points.length; i++) {
          const a = new THREE.Vector3(...d.points[i]), c = new THREE.Vector3(...d.points[i + 1]), mid = a.clone().lerp(c, 0.5); mid.y -= 0.6 + a.distanceTo(c) * 0.03;
          const mat = own(new THREE.MeshBasicMaterial({ color: '#16191d' }));
          const m = new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 24, 0.025, 5, false)), mat);
          root.add(m); signal.push({ m, mat, lit: 0 });
        }
        break;
      case 'snapped': {
        B.geo('cable', G.cyl8, xf(d.x, d.y - 0.35, d.z, 0.014, 0.7, 0.014, 0.25, 0, 0.15), WHITE, THREE);
        const sp = new THREE.Sprite(M.glowGreen); sp.position.set(d.x + 0.05, d.y - 0.72, d.z + 0.08); sp.scale.setScalar(0.3); root.add(sp); sparks.push(sp);
        break;
      }
      case 'struts':
        for (let z = d.z1 - 0.4; z > d.z0; z -= 1.6) BF.geo('metal', G.box, xf(d.x + d.side * 0.35, d.y - 0.5, z, 0.06, 1.25, 0.06, 0, 0, d.side * 0.7), hex3('#4a4642'), THREE);
        break;
      case 'scaffoldFace':
        for (let z = d.z1; z >= d.z0; z -= 1.6) BF.geo('metal', G.cyl8, xf(d.x, (d.y0 + d.y1) / 2, z, 0.03, d.y1 - d.y0, 0.03), hex3('#5f5e57'), THREE);
        for (let y = d.y1 - 0.2; y > d.y0; y -= 2) {
          BF.geo('metal', G.cyl8, xf(d.x, y, (d.z0 + d.z1) / 2, 0.025, d.z1 - d.z0, 0.025, Math.PI / 2, 0, 0), hex3('#5f5e57'), THREE);
          BF.box(d.x - 0.25, d.x + 0.25, y - 0.05, y, d.z0, d.z1, { top: 'plain', side: 'plain', topCol: hex3('#6e553a'), sideCol: hex3('#4a3a2a') });
        }
        break;
      case 'balcony': {
        const s2 = d.side, x0 = Math.min(d.x, d.x + s2 * 0.9), x1 = Math.max(d.x, d.x + s2 * 0.9);
        BF.box(x0, x1, d.y - 0.1, d.y, d.z - 0.9, d.z + 0.9, { top: 'concrete', side: 'plain', topCol: hex3('#6f6a62'), sideCol: hex3('#5a5650') });
        BF.box(s2 > 0 ? x1 - 0.04 : x0, s2 > 0 ? x1 : x0 + 0.04, d.y, d.y + 0.8, d.z - 0.9, d.z + 0.9, { top: 'metal', side: 'metal', sideCol: hex3('#2c2e30'), topCol: hex3('#2c2e30') });
        BF.box(x0 + 0.1, x1 - 0.1, d.y, d.y + 0.45, d.z - 0.7, d.z - 0.1, { top: 'metal', side: 'metal', sideCol: hex3('#a9aca6'), topCol: hex3('#b9bcb6') });
        break;
      }
      case 'cable': {
        const a = new THREE.Vector3(...d.a), c = new THREE.Vector3(...d.b), mid = a.clone().lerp(c, 0.5); mid.y -= d.sag || 0.6;
        const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 12, 0.014, 4, false);
        BF.geo('cable', g, _m.identity(), WHITE, THREE); g.dispose();
        break;
      }
      case 'skyBridge':
        BF.box(d.x0, d.x1, d.y, d.y + 1.6, d.z - 0.8, d.z + 0.8, { top: 'metal', side: 'wall', topCol: hex3('#3a4241'), sideCol: hex3('#7f8478'), sideColLow: hex3('#5a5e56'), fadeDepth: 2, uvSide: 3, uvShift: d.z });
        BF.box(d.x0, d.x1, d.y - 0.2, d.y, d.z - 0.9, d.z + 0.9, { top: 'metal', side: 'metal', topCol: hex3('#3a4241'), sideCol: hex3('#2a302f') });
        break;
      case 'farBlock': {
        const k = clamp(1 - Math.abs(d.x) / 70, 0.45, 0.85), pc = mul3(PL[(Math.abs(d.x * 7 + d.z) | 0) % PL.length], k);
        BF.box(d.x - d.w / 2, d.x + d.w / 2, STREET_Y, d.top, d.z - d.d / 2, d.z + d.d / 2, { top: 'concrete', side: 'wall', topCol: mul3(pc, 0.6), sideCol: pc, sideColLow: lowCol, fadeDepth: 10, uvSide: 3, uvShift: d.z * 0.37 });
        if (d.roof) {
          const rb = d.roof === 'z' ? { shape: 'gableZ', x0: d.x - d.w / 2 - 0.2, x1: d.x + d.w / 2 + 0.2, z0: d.z - d.d / 2 - 0.2, z1: d.z + d.d / 2 + 0.2, y0: d.top, ye: d.top + 0.3, yr: d.top + 0.3 + d.w * 0.3, id: (d.z * 3) | 0 }
                                    : { shape: 'gableX', x0: d.x - d.w / 2 - 0.2, x1: d.x + d.w / 2 + 0.2, z0: d.z - d.d / 2 - 0.2, z1: d.z + d.d / 2 + 0.2, y0: d.top, ye: d.top + 0.3, yr: d.top + 0.3 + d.d * 0.3, id: (d.z * 3) | 0 };
          roof(BF, rb, k * 0.9);
        }
        if (d.stack) { BF.geo('metal', G.cyl, xf(d.x, d.top + 3, d.z, 0.5, 6, 0.5), hex3('#3c3a38'), THREE); if (smokes.length < 6) smokes.push(emitter(M.smoke, 26, [d.x, d.top + 6.2, d.z], 'smoke')); }
        break;
      }
    }
  }
  // two industrial fans in the alleys, turning
  for (const [x, y, z, ry] of [[3.6, 0.9, -39, -Math.PI / 2], [-2.6, 1.1, -57.5, Math.PI / 2]]) {
    B.box(x - 0.15, x + 0.15, y - 0.75, y + 0.75, z - 0.75, z + 0.75, { top: 'metal', side: 'metal', sideCol: hex3('#3e4648'), topCol: hex3('#4a5355'), uvSide: 1 });
    const hub = new THREE.Group(); hub.position.set(x - Math.sign(x) * 0.17, y, z); hub.rotation.y = ry;
    const mat = M.dark;
    for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(G.box, mat); bl.scale.set(0.16, 0.62, 0.03); bl.position.y = 0.3; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
    B.geo('metal', G.torus, xf(x - Math.sign(x) * 0.16, y, z, 0.7, 0.7, 1.4, 0, ry, 0), hex3('#59605e'), THREE);
    for (let i = -2; i <= 2; i++) B.geo('metal', G.box, xf(x - Math.sign(x) * 0.2, y + i * 0.22, z, 0.02, 0.02, 1.3), hex3('#2a2e30'), THREE);   // a grille over it
    root.add(hub); fans.push(hub);
  }

  const rp = makeRng(5);
  // vents on the great pipe: a stub, a warning lamp, and a column of steam
  const vents = hazards.vents.map(v => {
    B.geo('metal', G.cyl8, xf(v.x, v.y + 0.04, v.z, 0.16, 0.12, 0.16), hex3('#3a3f42'), THREE);
    B.geo('metal', G.cyl8, xf(v.x, v.y + 0.11, v.z, 0.2, 0.03, 0.2), hex3('#8c3b2c'), THREE);
    const lamp = new THREE.Sprite(M.glowRed); lamp.position.set(v.x, v.y + 0.16, v.z); lamp.scale.setScalar(0.4); root.add(lamp);
    return { v, lamp, e: emitter(null, 70, [v.x, v.y + 0.12, v.z], 'steam') };
  });

  // ---------------- the objective: fragments, relay, tower ----------------
  const frags = hazards.fragments.map(f => {
    const g = new THREE.Group(); g.position.set(f.x, f.y, f.z);
    const m = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.085, 0)), M.fragment); m.scale.set(0.8, 1.3, 0.8); g.add(m);
    const sp = new THREE.Sprite(M.glowGreen); sp.scale.setScalar(0.9); g.add(sp);
    root.add(g); return { f, g, m, sp, pop: 0 };
  });
  const wps = hazards.waypoints.map(w => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.geo('metal', G.box, xf(w.x + sx * 0.12, w.y + 1.4, w.z + sz * 0.12, 0.03, 2.8, 0.03, sz * 0.04, 0, -sx * 0.04), hex3('#3c4244'), THREE);
    for (let i = 1; i < 6; i++) B.geo('metal', G.box, xf(w.x, w.y + i * 0.5, w.z, 0.26, 0.025, 0.26), hex3('#3c4244'), THREE);
    B.geo('plain', G.dish, xf(w.x - 0.1, w.y + 2.3, w.z, 0.28, 0.28, 0.1, -0.3, -0.8, Math.PI / 2), hex3('#8a887e'), THREE);
    const lamp = new THREE.Sprite(M.glowRed); lamp.position.set(w.x, w.y + 2.9, w.z); lamp.scale.setScalar(0.35); root.add(lamp);
    return { w, lamp };
  });
  const R = hazards.relay;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.geo('metal', G.box, xf(R.x + sx * 0.22, R.y + 1.5, R.z + sz * 0.22, 0.04, 3, 0.04, sz * 0.06, 0, -sx * 0.06), hex3('#3c4244'), THREE);
  for (let i = 1; i < 6; i++) B.geo('metal', G.box, xf(R.x, R.y + i * 0.5, R.z, 0.46 - i * 0.03, 0.03, 0.46 - i * 0.03), hex3('#3c4244'), THREE);
  B.geo('plain', G.dish, xf(R.x + 0.25, R.y + 2.4, R.z, 0.45, 0.45, 0.16, -0.3, -0.9, Math.PI / 2), hex3('#a8a69c'), THREE);
  const relayLamp = new THREE.Sprite(M.glowRed); relayLamp.position.set(R.x, R.y + 3.15, R.z); relayLamp.scale.setScalar(0.9); root.add(relayLamp);
  const TW = slice.tower, beamMat = own(new THREE.MeshBasicMaterial({ color: PAL.green, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const beam = new THREE.Mesh(G.cyl8, beamMat); root.add(beam);
  { const a = new THREE.Vector3(R.x, R.y + 3.15, R.z), b = new THREE.Vector3(TW.x, TW.base + TW.height + 2, TW.z), d = b.clone().sub(a);
    beam.position.copy(a).addScaledVector(d, 0.5); beam.scale.set(0.05, d.length(), 0.05); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }
  // the relay tower: a tapering lattice, silhouetted, with its beacon
  const towerMat = own(new THREE.MeshBasicMaterial({ color: '#121822', fog: false }));
  const TB = new Batch();
  const legAt = (t, sx, sz) => { const w = lerp(7, 1.2, t); return new THREE.Vector3(TW.x + sx * w, TW.base + t * TW.height, TW.z + sz * w); };
  const strut = (a, b2, r) => { const d = b2.clone().sub(a), mid = a.clone().addScaledVector(d, 0.5); _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); _m.compose(mid, _q, _s.set(r, d.length(), r)); TB.geo('t', G.box, _m, WHITE, THREE); };
  const C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C4) strut(legAt(0, sx, sz), legAt(1, sx, sz), 0.5);
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9, t1 = (i + 1) / 9;
    for (let k = 0; k < 4; k++) { const [ax, az] = C4[k], [bx, bz] = C4[(k + 1) % 4]; strut(legAt(t0, ax, az), legAt(t1, bx, bz), 0.2); strut(legAt(t0, bx, bz), legAt(t1, ax, az), 0.2); strut(legAt(t1, ax, az), legAt(t1, bx, bz), 0.25); }
  }
  strut(new THREE.Vector3(TW.x, TW.base + TW.height, TW.z), new THREE.Vector3(TW.x, TW.base + TW.height + 10, TW.z), 0.3);
  _m.compose(_p.set(TW.x, TW.base + TW.height * 0.62, TW.z), _q.identity(), _s.set(8, 1.2, 8)); TB.geo('t', G.box, _m, WHITE, THREE);
  const tower = TB.build(THREE, { t: towerMat }); root.add(tower);
  const beaconMat = own(new THREE.SpriteMaterial({ map: A.T.glow, color: PAL.green, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const beacon = new THREE.Sprite(beaconMat); beacon.position.set(TW.x, TW.base + TW.height + 10, TW.z); beacon.scale.setScalar(16); root.add(beacon);
  const towerLights = [];
  for (let i = 1; i < 5; i++) { const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: A.T.glow, color: i % 2 ? PAL.violet : PAL.green, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))); sp.position.copy(legAt(i / 5, 1, 1)); sp.scale.setScalar(5); root.add(sp); towerLights.push(sp); }

  // ---------------- build the static batches ----------------
  const MATS = { tile: M.tile, wall: M.wall, metal: M.metal, grate: M.grate, brick: M.brick, tin: M.tin, concrete: M.concrete, plain: M.plain, dark: M.dark, cable: M.cable };
  const near = B.build(THREE, MATS, { cast: true, receive: true });
  const far = BF.build(THREE, MATS, { cast: false, receive: false });
  root.add(near); root.add(far);
  // the street, far below, with a few warm lights deep in the alleys
  const street = new THREE.Mesh(keep(new THREE.PlaneGeometry(500, 700)), M.street);
  street.rotation.x = -Math.PI / 2; street.position.set(0, STREET_Y, -120); root.add(street);
  for (let z = 0; z > -95; z -= 13) { const sp = new THREE.Sprite(M.glowWarm); sp.position.set((z % 2 ? -1 : 1) * (2 + rp() * 1.5), STREET_Y + 2.5, z - rp() * 4); sp.scale.setScalar(5); root.add(sp); }

  // ---------------- sky, haze and light ----------------
  const skyMat = own(new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, hor: { value: new THREE.Color(PAL.skyHorizon) }, band: { value: new THREE.Color(PAL.skyBand) }, tdir: { value: new THREE.Vector3(TW.x, 30, TW.z).normalize() }, tcol: { value: new THREE.Color('#2f6b58') } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 top,hor,band,tdir,tcol; varying vec3 vD; void main(){ float h = vD.y; vec3 c = mix(hor, top, pow(clamp(h * 1.8, 0.0, 1.0), 0.6)); c = mix(c, band, exp(-abs(h - 0.03) * 22.0) * 0.55); if (h < 0.0) c = mix(hor, vec3(0.08,0.09,0.11), clamp(-h * 6.0, 0.0, 1.0)); float t = max(dot(normalize(vD), tdir), 0.0); c += tcol * pow(t, 30.0) * 0.5; gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(350, 24, 12)), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0105);
  scene.background = new THREE.Color(PAL.skyHorizon);
  const hemi = new THREE.HemisphereLight('#8a9ab2', '#2a221e', 1.15); scene.add(hemi);
  const key = new THREE.DirectionalLight('#d8cbb6', 1.7);
  const KEY = new THREE.Vector3(-0.5, 0.78, -0.42).normalize().multiplyScalar(30);
  key.shadow.mapSize.set(opts.small ? 1024 : 2048, opts.small ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
  scene.add(key); scene.add(key.target);
  function setShadows(on) { key.castShadow = on; }
  setShadows(opts.shadows);

  // ---------------- per frame ----------------
  let time = 0;
  const H = TUNING.hazards;
  function update(dt, focus, camera) {
    time += dt;
    key.position.set(focus[0] + KEY.x, focus[1] + KEY.y, focus[2] - 5 + KEY.z);
    key.target.position.set(focus[0], focus[1], focus[2] - 5); key.target.updateMatrixWorld();
    sky.position.copy(camera.position);
    // steam: wisps at rest, a hiss and a red lamp as warning, then the column
    for (const V of vents) {
      const st = V.v.state, e = V.e;
      const rate = st === 'burst' ? 110 : st === 'warn' ? 22 : 3;
      emit(e, rate, dt, i => {
        const burst = st === 'burst';
        e.pos[i * 3] = e.at[0] + (rp() - 0.5) * 0.1; e.pos[i * 3 + 1] = e.at[1]; e.pos[i * 3 + 2] = e.at[2] + (rp() - 0.5) * 0.1;
        e.vel[i * 3] = (rp() - 0.5) * (burst ? 0.9 : 0.3); e.vel[i * 3 + 1] = burst ? 4 + rp() * 3 : 0.6 + rp() * 0.6; e.vel[i * 3 + 2] = (rp() - 0.5) * (burst ? 0.9 : 0.3);
        e.dur[i] = burst ? 0.55 + rp() * 0.3 : 0.9 + rp() * 0.6; e.size[i] = burst ? 0.55 + rp() * 0.35 : 0.25 + rp() * 0.15; e.life[i] = 1e-3;
      });
      stepEmitter(e, dt, 0.8);
      const warn = st === 'warn' ? 0.6 + 0.4 * Math.sin(time * 30) : st === 'burst' ? 1 : 0.15;
      V.lamp.material.opacity = 1; V.lamp.scale.setScalar(0.25 + 0.55 * warn);
    }
    for (const s of smokes) {
      emit(s, 5, dt, i => { s.pos[i * 3] = s.at[0]; s.pos[i * 3 + 1] = s.at[1]; s.pos[i * 3 + 2] = s.at[2]; s.vel[i * 3] = 0.3 + rp() * 0.3; s.vel[i * 3 + 1] = 0.8 + rp() * 0.4; s.vel[i * 3 + 2] = (rp() - 0.5) * 0.3; s.dur[i] = 4 + rp() * 2; s.size[i] = 2.2 + rp() * 1.5; s.life[i] = 1e-3; });
      stepEmitter(s, dt, 0.05);
    }
    // the unstable walkway: shakes as it creaks, then drops
    for (const u of unstableViews) {
      const st = hazards.unstable.find(x => x.b === u.b);
      const shake = st.state === 'creak' ? st.shake : 0;
      u.g.position.set((Math.random() - 0.5) * 0.02 * shake, u.b.dy, 0);
      u.g.rotation.z = st.state === 'falling' ? Math.min(0.5, st.t * 0.8) : (Math.random() - 0.5) * 0.03 * shake;
      u.g.visible = st.state !== 'gone';
      u.spark.visible = st.state === 'creak' && Math.random() < 0.6;
    }
    // fragments bob and turn; taken ones burst and fade
    for (const F of frags) {
      if (F.f.taken) { F.pop = Math.min(1, F.pop + dt * 3); F.g.scale.setScalar(1 + F.pop * 1.5); F.sp.material.opacity = 1; F.g.visible = F.pop < 1; F.m.visible = false; continue; }
      F.pop = 0; F.g.visible = true; F.m.visible = true; F.g.scale.setScalar(1);
      F.g.position.y = F.f.y + Math.sin(time * 2.4 + F.f.z) * 0.05; F.m.rotation.y += dt * 1.8;
    }
    // the relay: red until reached; then green, and the signal climbs to the tower
    const on = hazards.relay.active, rt = hazards.relay.t;
    relayLamp.material = on ? M.glowGreen : M.glowRed;
    relayLamp.scale.setScalar(on ? 1.4 + 0.3 * Math.sin(time * 6) : 0.7 + 0.2 * Math.sin(time * 2));
    beamMat.opacity = on ? clamp(rt * 1.5, 0, 0.75) * (0.75 + 0.25 * Math.sin(time * 9)) : 0;
    beacon.scale.setScalar(on ? 22 + 10 * clamp(rt - 0.4, 0, 1) + 3 * Math.sin(time * 5) : 12 + 2 * Math.sin(time * 1.5));
    beaconMat.opacity = on ? 1 : 0.55;
    for (const [i, l] of towerLights.entries()) l.material.opacity = on ? 0.9 : 0.25 + 0.2 * Math.sin(time * 1.3 + i);
    for (const f of fans) f.rotation.z += dt * 5;
    for (const br of bridges) br.g.position.x = br.b.dx || 0;
    // the signal line: each segment lights as the relay at its end wakes
    const woke = hazards.waypoints.map(w => w.active).concat([hazards.relay.active]);
    signal.forEach((sg, i) => {
      sg.lit = damp(sg.lit, woke[i] ? 1 : 0, 3, dt);
      sg.mat.color.setRGB(lerp(0.086, 0.35, sg.lit), lerp(0.098, 0.95, sg.lit) * (0.85 + 0.15 * Math.sin(time * 6 - i)), lerp(0.114, 0.6, sg.lit));
    });
    for (const W of wps) {
      W.lamp.material = W.w.active ? M.glowGreen : M.glowRed;
      W.lamp.scale.setScalar(W.w.active ? 0.9 + 0.4 * Math.exp(-W.w.t * 2) * 3 + 0.1 * Math.sin(time * 5) : 0.3 + 0.08 * Math.sin(time * 1.7));
    }
    for (const [i, sp] of sparks.entries()) { const on = Math.sin(time * 23 + i * 7) > 0.55 || Math.sin(time * 3.1 + i) > 0.97; sp.visible = on; sp.scale.setScalar(0.18 + Math.random() * 0.25); }
    for (const l of lamps) if (l.flicker) l.sp.scale.setScalar(l.base * (0.9 + 0.1 * Math.sin(time * 13 + l.ph) * (Math.sin(time * 0.7 + l.ph) > 0.85 ? 3 : 1)));
    void H;
  }
  function setFaded(ids, dt) {
    for (const [id, f] of fades) {
      const want = ids.has(id) ? 0.35 : 1;
      f.k = damp(f.k, want, want < f.k ? 22 : 6, dt);
      // stays transparent: three.js compiles opaque materials to ignore opacity
      f.mat.opacity = f.k; f.mat.depthWrite = f.k > 0.99;
    }
  }
  function dispose() {
    disposeTree(root); disposeTree(sky);
    for (const g of ownGeo) g.dispose();
    for (const m of ownMat) m.dispose();
    scene.remove(hemi); scene.remove(key); scene.remove(key.target);
  }
  function setPointScale(v) { for (const k in partMats) partMats[k].uniforms.uScale.value = v; }
  return { update, setFaded, setShadows, setPointScale, dispose, root, key };
}

// ---- 11_hud.js ----
// =====================================================================
// HUD and the lab panel. DOM only; the game wires callbacks in.
// Type: system UI stack. 11 px tracked labels, 14 px body, 28 px numerals.
// Grid: 16 px gutter (plus safe area), 8 px rhythm. Chalk on soot.
// =====================================================================

const HUD_CSS = `
.rr{position:absolute;inset:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#f3ece2;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px}
.rr *{box-sizing:border-box}
.rr-lab{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.rr-top{position:absolute;left:var(--g);right:var(--g);top:0;display:flex;justify-content:space-between;align-items:flex-start}
.rr-num{font-size:28px;font-weight:300;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 1px 10px rgba(20,14,12,.5)}
.rr-num small{font-size:11px;font-weight:700;letter-spacing:.16em;margin-left:4px;opacity:.8}
.rr-sub{margin-top:6px;opacity:.8;text-shadow:0 1px 6px rgba(20,14,12,.6)}
.rr-core{display:flex;gap:6px;align-items:center}
.rr-core i{width:14px;height:14px;transform:rotate(45deg);border:1.5px solid rgba(125,255,176,.55);background:rgba(10,20,16,.35);transition:background .25s,box-shadow .25s}
.rr-core i.on{background:#7dffb0;box-shadow:0 0 10px #7dffb0}
.rr-stats{display:flex;justify-content:space-around;margin:8px 0}
.rr-stats div{font-size:11px;font-weight:700;letter-spacing:.16em;opacity:.85}
.rr-stats b{display:block;font-size:28px;font-weight:300;letter-spacing:0;margin-bottom:2px}
.rr-title.small{font-size:24px}
.rr-icons{display:flex;gap:8px}
.rr-ib{pointer-events:auto;height:40px;min-width:40px;padding:0 12px;border-radius:20px;border:1.5px solid rgba(243,236,226,.55);background:rgba(30,24,22,.28);color:#f3ece2;display:flex;align-items:center;justify-content:center;font:700 11px system-ui,sans-serif;letter-spacing:.14em;touch-action:none;cursor:pointer}
.rr-ib.on{background:#f3ece2;color:#231c19}
.rr-stick{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:1.5px solid rgba(243,236,226,.4);background:rgba(30,24,22,.12);display:none}
.rr-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(243,236,226,.38)}
.rr-jump{position:absolute;border-radius:50%;border:1.5px solid rgba(243,236,226,.6);background:rgba(30,24,22,.25);display:flex;align-items:center;justify-content:center;transition:transform .06s,background .06s}
.rr-jump.down{transform:scale(.92);background:rgba(243,236,226,.3)}
.rr-jump svg{width:42%;height:42%}
.rr-zone{position:absolute;top:0;bottom:0;right:0;border-left:1px dashed rgba(243,236,226,.0);transition:border-color .4s}
.rr-zone.hint{border-left-color:rgba(243,236,226,.28)}
.rr-hint{position:absolute;bottom:0;font-size:11px;font-weight:700;letter-spacing:.16em;opacity:0;transition:opacity .5s;text-shadow:0 1px 8px rgba(20,14,12,.7)}
.rr-hint.on{opacity:.85}
.rr-fade{position:absolute;inset:0;background:#e4d4bd;opacity:0;transition:opacity .18s}
.rr-card{position:absolute;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:380px;border-radius:12px;padding:16px;background:rgba(32,26,24,.8);border:1px solid rgba(243,236,226,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto;display:none;text-align:center}
.rr-card.on{display:block}
.rr-title{font-size:36px;font-weight:800;letter-spacing:.12em;line-height:1}
.rr-p{font-size:14px;line-height:1.5;opacity:.85;margin:8px 0}
.rr-b{display:block;width:100%;border:0;border-radius:10px;padding:14px;margin-top:8px;font:800 13px system-ui,sans-serif;letter-spacing:.18em;color:#231c19;background:#f3ece2;cursor:pointer}
.rr-b.sec{background:transparent;color:#f3ece2;border:1px solid rgba(243,236,226,.4)}
.rr-panel{position:absolute;top:0;right:0;bottom:0;width:min(320px,86vw);background:rgba(26,21,19,.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-left:1px solid rgba(243,236,226,.14);pointer-events:auto;overflow-y:auto;padding:16px;transform:translateX(105%);transition:transform .2s;touch-action:pan-y}
.rr-panel.on{transform:none}
.rr-panel h3{margin:16px 0 8px;font-size:11px;letter-spacing:.16em;opacity:.6}
.rr-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;font-size:13px}
.rr-row input{width:52%;accent-color:#f3ece2}
.rr-row output{width:44px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;font-size:12px}
.rr-seg{display:flex;gap:4px}
.rr-seg button{border:1px solid rgba(243,236,226,.35);background:transparent;color:#f3ece2;border-radius:8px;padding:6px 8px;font:700 10px system-ui,sans-serif;letter-spacing:.12em;cursor:pointer}
.rr-seg button.on{background:#f3ece2;color:#231c19}
.rr-dbg{position:absolute;left:var(--g);font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre;background:rgba(20,16,14,.55);padding:8px;border-radius:8px;display:none}
.rr-dbg.on{display:block}
`;

function createHud(ctx) {
  const ui = ctx.createRoot({ className: 'rr', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = HUD_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = {};
  H.zone = el('div', 'rr-zone');
  H.fade = el('div', 'rr-fade');
  H.top = el('div', 'rr-top');
  const tl = el('div', '', '', H.top);
  H.core = el('div', 'rr-core', '<i></i><i></i><i></i>', tl);
  H.sub = el('div', 'rr-sub rr-lab', 'Power core', tl);
  const icons = el('div', 'rr-icons', '', H.top);
  H.labBtn = el('div', 'rr-ib', 'LAB', icons);
  H.pauseBtn = el('div', 'rr-ib', '<svg viewBox="-10 -10 20 20" width="14" height="14"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>', icons);
  H.dbg = el('div', 'rr-dbg');
  H.stick = el('div', 'rr-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.jump = el('div', 'rr-jump', '<svg viewBox="-10 -10 20 20"><path d="M-7,4L0,-4L7,4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  H.hintL = el('div', 'rr-hint', 'DRAG TO STEER · PULL BACK TO WAIT'); H.hintR = el('div', 'rr-hint', 'TAP · HOLD TO JUMP HIGHER');
  // cards
  H.start = el('div', 'rr-card on');
  el('div', 'rr-title', 'THE LAST<br>SIGNAL', H.start);
  H.startText = el('div', 'rr-p', '', H.start);
  H.go = el('button', 'rr-b', 'RUN', H.start);
  H.retry = el('button', 'rr-b sec', 'RETRY', H.start); H.retry.style.display = 'none';
  H.pause = el('div', 'rr-card');
  el('div', 'rr-p', 'Paused', H.pause);
  H.resume = el('button', 'rr-b', 'RESUME', H.pause);
  H.restart = el('button', 'rr-b sec', 'RESTART LAB', H.pause);
  H.result = el('div', 'rr-card');
  el('div', 'rr-title small', 'SIGNAL RELAYED', H.result);
  H.resultStats = el('div', 'rr-stats', '', H.result);
  H.resultNote = el('div', 'rr-p', '', H.result);
  H.again = el('button', 'rr-b', 'RUN AGAIN', H.result);
  H.panel = el('div', 'rr-panel');

  const touchy = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  H.startText.innerHTML = touchy
    ? 'Carry the core to the relay.<br><b>Left thumb</b>: steer; pull back to wait. <b>Right thumb</b>: jump.'
    : 'Carry the core to the relay.<br><b>A / D</b> steer, <b>S</b> wait, <b>W</b> hurry, <b>Space</b> jump (hold: higher).';

  const api = {
    root: ui, H, touchy,
    stickShow(x, y) { H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = ''; },
    stickMove(ox, oy, dx, dy) { H.stick.style.left = ox + 'px'; H.stick.style.top = oy + 'px'; H.knob.style.transform = `translate(${dx}px,${dy}px)`; },
    stickHide() { H.stick.style.display = 'none'; },
    jumpDown(on) { H.jump.classList.toggle('down', on); },
    setPlay(on) { for (const e of [H.top, H.jump]) e.style.display = on ? '' : 'none'; if (!on) H.stick.style.display = 'none'; },
    hints(on) { H.hintL.classList.toggle('on', on); H.hintR.classList.toggle('on', on); H.zone.classList.toggle('hint', on); },
    card(which) { for (const [k, e] of [['start', H.start], ['pause', H.pause], ['result', H.result]]) e.classList.toggle('on', k === which); },
    charge(n) { if (api._c === n) return; api._c = n; [...H.core.children].forEach((e, i) => e.classList.toggle('on', i < n)); },
    result(frags, of, secs, best) {
      H.resultStats.innerHTML = `<div><b>${frags}/${of}</b>FRAGMENTS</div><div><b>${secs.toFixed(1)}s</b>TIME</div>`;
      H.resultNote.textContent = frags === of ? (best ? 'Full charge. A new best time.' : 'Full charge.') : 'Fragments hide on the harder lines.';
    },
    fade(v) { H.fade.style.opacity = v; },
    debug(text) { if (api._dbg !== text) { api._dbg = text; H.dbg.textContent = text; } },
    // area: ctx.contentSafeArea ?? ctx.safeArea (clears the island, home bar and Plethora's logo)
    layout(w, h, area) {
      const top = area.top || 0, bot = area.bottom || 0, right = area.right || 0, left = area.left || 0;
      const portrait = h > w;
      H.top.style.paddingTop = (12 + top) + 'px';
      H.top.style.left = (16 + left) + 'px'; H.top.style.right = (16 + right) + 'px';
      H.dbg.style.top = (top + 80) + 'px'; H.dbg.style.left = (16 + left) + 'px';
      const js = Math.round(clamp(Math.min(w, h) * 0.22, 72, 96));
      Object.assign(H.jump.style, { width: js + 'px', height: js + 'px', right: (24 + right) + 'px', bottom: (bot + (portrait ? 16 : 12)) + 'px' });
      H.zone.style.width = (w * TUNING.input.jumpZone) + 'px';
      H.hintL.style.left = (24 + left) + 'px'; H.hintL.style.bottom = (bot + 16) + 'px';
      H.hintR.style.right = (24 + right) + 'px'; H.hintR.style.bottom = (bot + (portrait ? 16 : 12) + js + 12) + 'px';
      H.panel.style.paddingTop = (16 + top) + 'px'; H.panel.style.paddingBottom = (16 + bot) + 'px'; H.panel.style.paddingRight = (16 + right) + 'px';
      for (const c of [H.start, H.pause, H.result]) { c.style.bottom = 'auto'; c.style.top = (top + (h - top - bot) * (portrait ? 0.42 : 0.5)) + 'px'; c.style.transform = 'translate(-50%,-50%)'; c.style.maxHeight = (h - top - bot - 16) + 'px'; c.style.overflowY = 'auto'; }
      // the result sits low, so the signal climbing to the tower stays in view
      // (landscape is too short for that: there the card stands at the left, clear of the tower)
      if (portrait) Object.assign(H.result.style, { top: 'auto', bottom: (bot + 12) + 'px', left: '50%', transform: 'translateX(-50%)', width: '', maxWidth: '380px' });
      else Object.assign(H.result.style, { top: (top + 12) + 'px', bottom: 'auto', left: (16 + left) + 'px', transform: 'none', width: 'min(300px, 40vw)', maxWidth: '300px' });
    }
  };

  // ---- lab panel: live tuning ----
  const SLIDERS = [
    ['Movement'],
    ['cat.cruise', 'Run speed', 3, 10, 0.1], ['cat.accel', 'Acceleration', 2, 20, 0.5], ['cat.lateral', 'Steer speed', 2, 8, 0.1], ['cat.lateralAccel', 'Steer response', 6, 50, 1],
    ['Jump'],
    ['cat.jumpVel', 'Jump strength', 5, 10, 0.1], ['cat.gravity', 'Gravity', 12, 40, 0.5], ['cat.fallMul', 'Fall speed-up', 1, 2.5, 0.05], ['cat.jumpMinHold', 'Tap rise (s)', 0, 0.3, 0.01],
    ['cat.coyote', 'Coyote (s)', 0, 0.3, 0.01], ['cat.buffer', 'Buffer (s)', 0, 0.3, 0.01], ['cat.jumpForward', 'Pounce boost', 0, 3, 0.1],
    ['Pace and slopes'],
    ['cat.sprint', 'Hurry speed', 5, 10, 0.1], ['cat.brake', 'Braking', 4, 30, 1], ['cat.paceDead', 'Pace dead zone', 0, 0.6, 0.02], ['cat.slopePush', 'Slope pull', 0, 4, 0.1], ['cat.slopeClimb', 'Uphill drag', 0, 1, 0.05],
    ['Hazards'],
    ['hazards.steamIdle', 'Steam rest (s)', 0.6, 3, 0.05], ['hazards.steamWarn', 'Steam warning (s)', 0.2, 1.2, 0.05], ['hazards.steamBurst', 'Steam burst (s)', 0.3, 1.5, 0.05], ['hazards.creakTime', 'Walkway creak (s)', 0.2, 1.5, 0.05],
    ['Assistance'],
    ['assist.lateralReach', 'Air nudge reach', 0, 1, 0.05], ['assist.alignReach', 'Ledge line-up reach', 0, 1, 0.05], ['cat.edgeGrip', 'Edge grip (s)', 0, 0.6, 0.02], ['assist.scrambleDrop', 'Scramble reach', 0, 0.7, 0.02],
    ['Camera (landscape)'],
    ['camera.landscape.back', 'Distance', 2.5, 9, 0.1], ['camera.landscape.up', 'Height', 0.8, 5, 0.05], ['camera.landscape.fov', 'Field of view', 40, 80, 1], ['camera.landscape.lookAhead', 'Look ahead', 2, 12, 0.5],
    ['Camera (portrait)'],
    ['camera.portrait.back', 'Distance', 2.5, 10, 0.1], ['camera.portrait.up', 'Height', 0.8, 6, 0.05], ['camera.portrait.fov', 'Field of view', 40, 90, 1], ['camera.portrait.lookAhead', 'Look ahead', 2, 12, 0.5],
    ['Touch'],
    ['input.stickRadius', 'Stick radius (px)', 30, 90, 1], ['input.stickCurve', 'Stick curve', 1, 2.5, 0.05]
  ];
  const get = p => p.split('.').reduce((o, k) => o[k], TUNING);
  const set = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], TUNING)[last] = v; };
  const seg = (label, opts, cur, fn) => {
    const r = el('div', 'rr-row', `<span>${label}</span>`, H.panel), box = el('div', 'rr-seg', '', r);
    const bs = opts.map(([v, t]) => { const b = el('button', v === cur() ? 'on' : '', t, box); ctx.listen(b, 'click', e => { e.stopPropagation(); fn(v); bs.forEach(x => x.classList.toggle('on', x === b)); }); return b; });
  };
  api.buildPanel = (handlers) => {
    H.panel.innerHTML = '';
    el('h3', 'rr-lab', 'Lab', H.panel).style.marginTop = '0';
    seg('Jump input', [['hold', 'HOLD'], ['tap', 'TAP']], () => TUNING.input.jumpMode, v => { TUNING.input.jumpMode = v; });
    seg('Assistance', [[true, 'ON'], [false, 'OFF']], () => TUNING.assist.enabled, v => { TUNING.assist.enabled = v; });
    seg('Scramble', [[true, 'ON'], [false, 'OFF']], () => TUNING.assist.scramble, v => { TUNING.assist.scramble = v; });
    seg('Camera', [['auto', 'AUTO'], ['landscape', 'LAND'], ['portrait', 'PORT']], handlers.camPreset, handlers.setCamPreset);
    seg('Shadows', [[true, 'ON'], [false, 'OFF']], handlers.shadows, handlers.setShadows);
    seg('Readout', [[true, 'ON'], [false, 'OFF']], () => H.dbg.classList.contains('on'), v => H.dbg.classList.toggle('on', v));
    for (const s of SLIDERS) {
      if (s.length === 1) { el('h3', 'rr-lab', s[0], H.panel); continue; }
      const [path, label, lo, hi, step] = s;
      const r = el('div', 'rr-row', `<span>${label}</span>`, H.panel);
      const inp = el('input', '', undefined, r); Object.assign(inp, { type: 'range', min: lo, max: hi, step, value: get(path) });
      const out = el('output', '', String(get(path)), r);
      ctx.listen(inp, 'input', () => { set(path, +inp.value); out.textContent = inp.value; if (path === 'input.stickRadius') handlers.relayout(); });
    }
    const reset = el('button', 'rr-b sec', 'RESTART LAB', H.panel);
    ctx.listen(reset, 'click', e => { e.stopPropagation(); handlers.restart(); });
    const dump = el('button', 'rr-b sec', 'COPY TUNING', H.panel);
    ctx.listen(dump, 'click', e => { e.stopPropagation(); const t = JSON.stringify(TUNING, null, 1); try { navigator.clipboard.writeText(t); dump.textContent = 'COPIED'; } catch (er) { console.log(t); dump.textContent = 'LOGGED TO CONSOLE'; } });
  };
  api.panel = on => { H.panel.classList.toggle('on', on); H.labBtn.classList.toggle('on', on); };
  api.panelOpen = () => H.panel.classList.contains('on');
  return api;
}

// ---- 12_game.js ----
// =====================================================================
// The game shell: Plethora lifecycle, boot diagnostics, the fixed-step
// loop, respawning, and wiring between simulation, rig, camera and HUD.
//
// Plethora APIs used here are the ones both existing bits use the same
// way (createCanvas, createRoot, listen, onResize, onDestroy, onFrame /
// game.loop, importModule, platform.ready/start/error/haptic).
// Score submission is deliberately absent: the two existing bits submit
// scores through different APIs, and neither can be verified here.
// =====================================================================

const SIM_DT = 1 / 60;

window.plethoraBit = {
  meta: { title: 'The Last Signal', runtime: 'plethora-bit@2', tags: ['3d', 'platformer', 'adventure'], permissions: ['haptics'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(#7f8d9b,#e3c39b 60%,#1d1a19)';
    const hud = createHud(ctx);
    hud.setPlay(false);
    hud.card('start');
    hud.H.go.disabled = true; hud.H.go.textContent = 'LOADING…';
    try { if (ctx.markVisualReady) ctx.markVisualReady('title'); } catch (e) { }

    let readySent = false;
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      hud.H.startText.textContent = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      hud.H.go.style.display = 'none';
      if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } }
    }
    ctx.onDestroy(() => { destroyed = true; });
    // the 3D library: a failed download offers one user-triggered retry at a time
    let THREE = null, loading = null;
    const loadThree = () => loading || (loading = ctx.importModule('three', '0.164.1').finally(() => { loading = null; }));
    try { THREE = await loadThree(); } catch (e) {
      bootFail('library', e);
      hud.H.retry.style.display = '';
      THREE = await new Promise(res => {
        ctx.listen(hud.H.retry, 'click', async ev => {
          ev.stopPropagation(); if (loading || destroyed) return;
          hud.H.retry.textContent = 'LOADING…';
          try { const T = await loadThree(); hud.H.retry.style.display = 'none'; hud.H.go.style.display = ''; res(T); }
          catch (er) { hud.H.retry.textContent = 'RETRY'; try { ctx.platform.error({ stage: 'library', message: String(er && er.message || er) }); } catch (x) { } }
        });
      });
    }
    if (destroyed || !THREE) return;

    const small = Math.min(ctx.width, ctx.height) < 600;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const A = createAssets(THREE, renderer, ctx);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, ctx.width / ctx.height, 0.05, 400);
    const world = new World();
    const slice = buildSlice(world);
    const hazards = new Hazards(world, slice);
    let shadows = true;
    const view = createScene(THREE, A, scene, world, slice, hazards, { small, shadows });
    const cat = new Cat(world);
    const rig = createCatRig(THREE, A);
    scene.add(rig.root);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), A.M.shadow);
    blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2; scene.add(blob);
    const cam = createFollowCamera(THREE, camera, world);
    const input = createInput(ctx, canvas, hud);

    // ---------- state ----------
    let mode = 'title', frozen = false, acc = 0, cpIdx = 0, respawn = null, contextLost = false, hintT = 0;
    let runT = 0, finish = null, bestTime = Infinity, attempt = 0;
    const frameEvents = [];
    const fps = { t: 0, n: 0, v: 0 };
    function haptic(kind) { try { if (caps.haptics) ctx.platform.haptic(kind); } catch (e) { } }

    function place(p, speed) {
      cat.reset(p, speed);
      const g = world.groundAt(p[0], p[2], p[1] + 0.5, 0.05, 0.05);
      if (g.box) { cat.pos[1] = g.y; cat.prev = cat.pos.slice(); cat.grounded = true; cat.ground = g.box; cat.lastGroundY = g.y; }
    }
    function resetLab() {
      cpIdx = 0; respawn = null; runT = 0; finish = null;
      hazards.reset();
      place(slice.spawn, 0);
      cam.reset();
      input.clear();
    }
    resetLab();

    // ---------- flow ----------
    function begin() {
      if (mode === 'play') return;
      if (mode === 'title') resetLab();
      mode = 'play'; acc = 0;
      input.state.enabled = true;
      hud.card(null); hud.setPlay(true);
      if (hud.touchy) { hintT = 5; hud.hints(true); }
      attempt++;
      try { ctx.platform.start({ phase: 'vertical-slice' }); } catch (e) { }
    }
    function pause() {
      if (mode !== 'play') return;
      mode = 'paused'; input.clear(); input.state.enabled = false;
      hud.card('pause'); hud.hints(false);
    }
    function resume() { if (mode !== 'paused' || contextLost) return; mode = 'play'; input.state.enabled = true; hud.card(null); }
    function restart() {
      hud.panel(false); resetLab(); mode = 'paused'; resume(); if (mode !== 'play') return;
      hud.setPlay(true); attempt++;
      try { ctx.platform.start({ phase: 'vertical-slice', replay: true }); } catch (e) { }
    }
    const tap = (e, fn) => ctx.listen(e, 'click', ev => { ev.stopPropagation(); fn(ev); });
    tap(hud.H.go, begin); tap(hud.H.resume, resume); tap(hud.H.restart, restart);
    tap(hud.H.again, () => { if (mode === 'result') { mode = 'paused'; restart(); } });
    ctx.listen(hud.H.pauseBtn, 'pointerdown', e => { e.stopPropagation(); if (mode === 'play') pause(); else resume(); });
    ctx.listen(hud.H.labBtn, 'pointerdown', e => { e.stopPropagation(); hud.panel(!hud.panelOpen()); });
    ctx.listen(window, 'keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
      else if ((e.code === 'Enter' || e.code === 'Space') && mode === 'title' && !hud.H.go.disabled) begin();
      else if ((e.code === 'Enter' || e.code === 'KeyR') && mode === 'result') { mode = 'paused'; restart(); }
      else if (e.code === 'Backquote' || e.code === 'KeyL') hud.panel(!hud.panelOpen());
      else if (e.code === 'KeyR' && mode === 'play') restart();
    });
    hud.buildPanel({
      camPreset: () => cam.st.preset, setCamPreset: v => { cam.st.preset = v; },
      shadows: () => shadows, setShadows: v => { shadows = v; view.setShadows(v); rig.setShadows(v); },
      restart, relayout: () => layout(ctx.width, ctx.height, area())
    });

    // lifecycle: background, blur, context loss
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    ctx.listen(window, 'blur', () => pause());
    ctx.listen(canvas, 'webglcontextlost', e => { e.preventDefault(); contextLost = true; pause(); hud.H.resume.textContent = 'RESTORING…'; });
    ctx.listen(canvas, 'webglcontextrestored', () => {
      contextLost = false; hud.H.resume.textContent = 'RESUME';
      scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { if (m.map) m.map.needsUpdate = true; if (m.alphaMap) m.alphaMap.needsUpdate = true; m.needsUpdate = true; } });
    });

    // ---------- simulation ----------
    function step(dt) {
      if (respawn) {
        respawn.t += dt;
        hud.fade(clamp(respawn.t / 0.18, 0, 1));
        if (respawn.t >= 0.24 && !respawn.done) {
          respawn.done = true;
          place(respawn.at, TUNING.cat.cruise * 0.55);
          hazards.resetUnstable();
          cam.reset();
        }
        if (respawn.done) { hud.fade(clamp(1 - (respawn.t - 0.24) / 0.3, 0, 1)); if (respawn.t > 0.54) { respawn = null; hud.fade(0); } }
        if (respawn && !respawn.done) { cat.step(dt, { steer: 0 }); cat.events.length = 0; hazards.step(dt, cat); return; }
      }
      const inp = input.sample(dt);
      if (mode === 'play' && !finish) runT += dt;
      cat.step(dt, inp);
      for (const e of hazards.step(dt, cat)) cat.events.push(e);
      for (const e of cat.events) {
        frameEvents.push(e);
        if (e.type === 'jump') { try { ctx.platform.interact({ type: 'jump' }); } catch (er) { } }
        else if (e.type === 'land') { if (e.impact > 7) haptic('light'); }
        else if (e.type === 'bump' || e.type === 'scramble') haptic('medium');
        else if (e.type === 'scald') haptic('warning');
        else if (e.type === 'give') haptic('heavy');
        else if (e.type === 'waypoint') { haptic('light'); try { ctx.platform.milestone('waypoint', { z: Math.round(-e.w.z) }); } catch (er) { } }
        else if (e.type === 'fragment') { haptic('success'); try { ctx.platform.interact({ type: 'fragment', count: e.count }); ctx.platform.milestone('fragment', { count: e.count }); } catch (er) { } }
        else if (e.type === 'relay' && !finish) {
          finish = { t: 0, time: runT, frags: hazards.charge };
          cat.halt = true; haptic('success');
          const best = finish.frags === hazards.fragments.length && runT < bestTime; if (best) bestTime = runT;
          finish.best = best;
          try { ctx.platform.complete({ fragments: finish.frags, timeMs: Math.round(runT * 1000) }); } catch (er) { }
        }
        else if (e.type === 'fall' && !respawn) {
          respawn = { t: 0, at: slice.checkpoints[cpIdx] };
          try { ctx.platform.interact({ type: 'fall', at: Math.round(-cat.pos[2]) }); } catch (er) { }
        }
      }
      cat.events.length = 0;
      // checkpoints only advance on sound footing
      // checkpoints: routes branch, so take the furthest one reached on sound footing at its height
      if (cat.grounded && !cat.ground.unstable && cat.ground.dx === undefined)
        for (let i = cpIdx + 1; i < slice.checkpoints.length; i++) { const c = slice.checkpoints[i]; if (cat.pos[2] < c[2] && Math.abs(cat.pos[1] - c[1]) < 0.6 && Math.abs(cat.pos[0] - c[0]) < 2.2) cpIdx = i; }
      // the relay is reached: the signal climbs to the tower, then the result
      if (finish) {
        finish.t += dt;
        if (finish.t > 2.2 && mode === 'play') {
          mode = 'result'; input.clear(); input.state.enabled = false;
          hud.result(finish.frags, hazards.fragments.length, finish.time, finish.best);
          hud.card('result'); hud.setPlay(false); hud.hints(false);
        }
      }
    }

    // ---------- render ----------
    const rs = { pos: [0, 0, 0], fwd: 0, vx: 0, vy: 0, grounded: true, crouch: 0, teeter: 0, edgeAhead: 0, narrow: 0, scr: null, stumble: 0, assistX: 0, sinceJump: 9, slope: [0, 0], charge: 0, surf: 'flat', sway: 0, events: frameEvents };
    const camCat = { pos: rs.pos, vel: [0, 0, 0], fwd: 0, grounded: true, ground: null, finale: 0 };
    function frame(dt) {
      const a = mode === 'play' || mode === 'result' ? clamp(acc / SIM_DT, 0, 1) : 1;
      for (let i = 0; i < 3; i++) rs.pos[i] = lerp(cat.prev[i], cat.pos[i], a);
      Object.assign(rs, { fwd: mode === 'title' ? 0 : cat.fwd, vx: cat.vel[0], vy: cat.vel[1], grounded: cat.grounded, crouch: cat.crouch, teeter: cat.teeter, edgeAhead: cat.edgeAhead, narrow: cat.narrow, scr: cat.scr ? clamp(cat.scr.t, 0, 1) : null, stumble: cat.stumble, assistX: cat.assistX, sinceJump: cat.sinceJump, slope: cat.slope, charge: hazards.charge, surf: cat.surf, sway: cat.grounded && cat.ground && cat.ground.dx !== undefined ? cat.ground.dx : 0 });
      rig.update(dt, rs);
      Object.assign(camCat, { vel: cat.vel, fwd: rs.fwd, grounded: cat.grounded, ground: cat.ground, finale: finish ? clamp(finish.t / 1.5, 0, 1) : 0 });
      cam.update(dt, camCat, ctx.height > ctx.width, frameEvents);
      frameEvents.length = 0;
      view.update(dt, rs.pos, camera);
      view.setFaded(cam.st.fade, dt);
      // the contact shadow: always straight down, so every landing can be judged
      const g = world.groundAt(rs.pos[0], rs.pos[2], rs.pos[1] + 0.05, 0.05, 0.1);
      if (g.box && !g.box.far) {
        const h = rs.pos[1] - g.y, k = clamp(1 - h / 5, 0.25, 1);
        blob.visible = true; blob.position.set(rs.pos[0], g.y + 0.012, rs.pos[2]);
        blob.scale.set(0.42 * (0.7 + 0.3 * k), 0.75 * (0.7 + 0.3 * k), 1);
        A.M.shadow.opacity = 0.42 * k;
      } else blob.visible = false;
      hud.charge(hazards.charge);
      if (hintT > 0) { hintT -= dt; if (hintT <= 0 || input.state.stick) { hintT = 0; hud.hints(false); } }
      fps.t += dt; fps.n++; if (fps.t > 0.5) { fps.v = fps.n / fps.t; fps.t = 0; fps.n = 0; }
      if (hud.H.dbg.classList.contains('on')) {
        const j = cat.stats.lastJump, inf = renderer.info.render;
        hud.debug(`fps ${fps.v.toFixed(0)}  calls ${inf.calls}  tris ${(inf.triangles / 1000).toFixed(1)}k\n` +
          `speed ${cat.fwd.toFixed(2)}  vx ${cat.vel[0].toFixed(2)}  vy ${cat.vel[1].toFixed(2)}\n` +
          `${cat.grounded ? 'ground' : 'air'}${cat.crouch ? ' crouch' : ''}${cat.narrow > 0.5 ? ' narrow' : ''}${cat.scr ? ' scramble' : ''}  coyote ${cat.coyote.toFixed(2)}  buffer ${cat.buffer.toFixed(2)}\n` +
          `steer ${input.state.steer.toFixed(2)}  pace ${input.state.pace.toFixed(2)}  jump ${TUNING.input.jumpMode}${input.state.jumpHeld ? ' (held)' : ''}  grip ${cat.gripT.toFixed(2)}\n` +
          (j ? `last jump ${j.dist.toFixed(2)} m  rise ${j.rise.toFixed(2)} m  ${(j.air * 1000).toFixed(0)} ms` : 'last jump —'));
      }
      if (!contextLost) renderer.render(scene, camera);
    }

    // ---------- layout ----------
    function layout(w, h, a) {
      hud.layout(w, h, a);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      view.setPointScale(h * renderer.getPixelRatio() * 0.5 / Math.tan(camera.fov * Math.PI / 360));
      // centre the picture in the content safe area, so Plethora's logo button
      // (bottom centre) never sits on the cat
      const shift = Math.round(Math.max(0, (a.bottom || 0) * 0.8 - (a.top || 0) * 0.5));
      if (shift > 0) camera.setViewOffset(w, h, 0, shift, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
    ctx.onResize(({ width, height }) => layout(width, height, area()), { immediate: true });

    // ---------- loop: fixed 60 Hz simulation, rendered with interpolation ----------
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (frozen) return;
      if (mode === 'play' || mode === 'result') {
        acc += dt; let n = 0;
        while (acc >= SIM_DT && n < 5) { step(SIM_DT); acc -= SIM_DT; n++; }
        if (n === 5) acc = 0;
      }
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    ctx.onDestroy(() => {
      destroyed = true;
      input.clear();
      try { view.dispose(); rig.dispose(); blob.geometry.dispose(); } catch (e) { }
      for (const k in A.M) try { A.M[k].dispose(); } catch (e) { }
      for (const k in A.T) try { A.T[k].dispose(); } catch (e) { }
      try { renderer.dispose(); } catch (e) { }
    });

    try { frame(SIM_DT); } catch (e) { bootFail('frame', e); return; }
    hud.H.go.disabled = false; hud.H.go.textContent = 'RUN';
    if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } }

    if (window.__RR_DEV) {
      window.__rr = {
        begin, pause, resume, restart, cat, world, slice, hazards, input, camera, renderer, cam, scene, TUNING,
        get mode() { return mode; },
        // drive the real loop deterministically: input = { steer, jump }
        advance(sec, inp) { if (inp !== undefined) input.state.virtual = inp; const n = Math.round(sec / SIM_DT); for (let i = 0; i < n && mode === 'play'; i++) step(SIM_DT); acc = 0; frame(SIM_DT); },
        frame: () => frame(SIM_DT),
        freeze(on) { frozen = on; },
        sim(inp) { input.state.virtual = inp; if (mode === 'play' || mode === 'result') step(SIM_DT); },
        warp(i) { place(slice.checkpoints[i], TUNING.cat.cruise); cpIdx = i; cam.reset(); frame(SIM_DT); }
      };
    }
  }
};

})();
