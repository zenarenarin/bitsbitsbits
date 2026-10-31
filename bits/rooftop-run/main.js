// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// ROOFTOP RUN — an endless rooftop traversal game for Plethora.
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
    halfWidth: 0.14, halfLength: 0.26, standHeight: 0.40, crouchHeight: 0.22,
    // forward run: auto, with a real acceleration so the start has weight
    cruise: 6.4, topSpeed: 7.6, speedRamp: 0, accel: 7.5, startBoost: 0.6,
    // lateral steering (target velocity, then acceleration toward it)
    lateral: 4.4, lateralAccel: 24, lateralAccelAir: 10, lateralDecel: 30,
    // narrow surfaces: below this width the cat steadies itself
    narrowWidth: 0.75, narrowLateral: 0.55, narrowCentering: 6,
    // edge grip: steering off a side edge is resisted this long before the cat lets go
    edgeGrip: 0.22,
    // jump. apex = jumpVel^2 / (2 * gravity) ~ 1.16 m
    gravity: 23, jumpVel: 7.3, jumpForward: 0.9, fallMul: 1.55, jumpCut: 2.6, maxFall: 26,
    jumpMinHold: 0.13,           // hold mode: a tap still gets this much full-strength rise
    coyote: 0.11, buffer: 0.14,
    stepUp: 0.2,
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
  input: {
    jumpMode: 'hold',            // 'hold' (variable height) or 'tap' (always full)
    stickRadius: 52, stickDead: 0.1, stickCurve: 1.35,
    jumpZone: 0.45               // right fraction of the screen that also jumps
  },
  camera: {
    landscape: { fov: 52, back: 1.75, up: 0.86, lookAhead: 5.5, lookUp: -0.1, follow: 0.78 },
    portrait: { fov: 62, back: 2.3, up: 1.25, lookAhead: 6, lookUp: -0.3, follow: 0.65 },
    speedBack: 0.05, speedFov: 1.2,
    posK: 7, heightK: 3.5, airHeightK: 1.6, lookK: 6,
    terrainProbe: [3, 6, 10, 14], gapLift: 0.3, gapBack: 0.25, arcFollow: 0.35,
    landDip: 0.05, nearClip: 0.4
  }
};

// ---- 02_world.js ----
// =====================================================================
// Collision world: axis-aligned boxes. Rooftops are boxes; that is all
// this game needs, and it keeps every query cheap on a phone.
// A box: { x0, x1, y0, y1, z0, z1 } with x0 < x1, y0 < y1, z0 < z1,
// plus tags: surface ('concrete' | 'tin' | 'ledge' | ...), cam ('block' | 'fade').
// =====================================================================

class World {
  constructor() { this.boxes = []; this.cell = 8; this.grid = new Map(); }
  add(b) {
    b.id = this.boxes.length;
    this.boxes.push(b);
    for (let cz = Math.floor(b.z0 / this.cell); cz <= Math.floor(b.z1 / this.cell); cz++) {
      let list = this.grid.get(cz); if (!list) this.grid.set(cz, list = []);
      list.push(b);
    }
    return b;
  }
  // boxes whose z range touches [z0, z1]
  near(z0, z1) {
    const out = [], seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
      const list = this.grid.get(cz); if (!list) continue;
      for (const b of list) if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    }
    return out;
  }
  // highest top surface under (x, z) at or below `fromY`, within a footprint
  // half-size (hx, hz). Returns { y, box } or { y: -Infinity, box: null }.
  groundAt(x, z, fromY, hx, hz) {
    hx = hx || 0; hz = hz || 0;
    let y = -Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      if (x + hx <= b.x0 || x - hx >= b.x1 || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.y1 <= fromY + 1e-4 && b.y1 > y) { y = b.y1; box = b; }
    }
    return { y, box };
  }
  // lowest underside above `fromY` over (x, z) footprint: what the cat must fit under
  ceilingAt(x, z, fromY, hx, hz) {
    let y = Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      if (x + hx <= b.x0 || x - hx >= b.x1 || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.y0 >= fromY - 1e-4 && b.y0 < y) { y = b.y0; box = b; }
    }
    return { y, box };
  }
  overlaps(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) if (x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) out.push(b);
    return out;
  }
  // ray against boxes (slab test); returns distance or Infinity
  ray(o, d, maxT, filter) {
    let best = maxT;
    const zs = [o[2], o[2] + d[2] * maxT];
    for (const b of this.near(Math.min(zs[0], zs[1]), Math.max(zs[0], zs[1]))) {
      if (filter && !filter(b)) continue;
      let t0 = 0, t1 = best, ok = true;
      const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) ok = false; continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best < maxT ? best : Infinity;
  }
}

// helper used by course builders: a box from centre/size in the usual units
function boxAt(cx, y0, cz, w, h, len, tags) {
  return Object.assign({ x0: cx - w / 2, x1: cx + w / 2, y0, y1: y0 + h, z0: cz - len / 2, z1: cz + len / 2, surface: 'concrete', cam: 'block' }, tags || {});
}
// a box spanning explicit z (z0 is the far end, more negative)
function boxSpan(x0, x1, y0, y1, zFar, zNear, tags) {
  return Object.assign({ x0, x1, y0, y1, z0: zFar, z1: zNear, surface: 'concrete', cam: 'block' }, tags || {});
}

// ---- 03_lab.js ----
// =====================================================================
// PHASE 1 — the Movement Lab. One short, authored stretch of rooftops
// holding the five things the movement has to feel right on:
//   A  wide concrete roof (steer around a tank stand and a stair room)
//   gap (2.6 m, slightly down)
//   B  roof with a low passage: duck under a pipe bundle between a
//      stair room and a tank platform (or jump onto the platform)
//   narrow ledge (0.4 m) across a void, entered through a parapet gap
//   C  a short roof, then a drop gap onto
//   D  the landing terrace
// Pure data: collision boxes carry a `kind` the renderer turns into
// architecture. Nothing here knows about three.js.
// =====================================================================

const STREET_Y = -14;

function buildLab(world) {
  const decor = [];
  const add = b => world.add(b);
  const building = (x0, x1, top, zFar, zNear, tags) => add(boxSpan(x0, x1, STREET_Y, top, zFar, zNear, Object.assign({ kind: 'building', walk: true }, tags)));
  const parapet = (x0, x1, top, zFar, zNear, h) => add(boxSpan(x0, x1, top, top + (h || 0.42), zFar, zNear, { kind: 'parapet', walk: true }));

  // ---- A: wide roof ----
  building(-4.5, 4.5, 0, -30, 8);
  parapet(-4.5, -4.25, 0, -30, 8); parapet(4.25, 4.5, 0, -30, 8); parapet(-4.25, 4.25, 0, 7.75, 8);
  add(boxSpan(1.5, 3.7, 0, 1.55, -14.6, -12.2, { kind: 'tankStand' }));        // black tank on a stand
  add(boxSpan(-4.25, -1.6, 0, 2.5, -22.5, -17.5, { kind: 'room' }));          // stair room
  decor.push({ kind: 'dish', x: 3.6, y: 0.42, z: 2, face: -0.6 });
  decor.push({ kind: 'pipeRun', x: -4.15, y: 0.1, z0: -29, z1: 6 });
  decor.push({ kind: 'laundry', x0: -1.6, x1: 4.25, y: 1.9, z: -6, poles: true });
  decor.push({ kind: 'crates', x: -3.5, y: 0, z: -4 });

  // ---- gap 1 (2.6 m) ----
  // ---- B: roof with the low passage ----
  const bY = -0.35;
  building(-3.6, 3.6, bY, -50, -32.6);
  parapet(3.35, 3.6, bY, -49.75, -32.6);
  add(boxSpan(-3.6, -0.5, bY, bY + 2.6, -42.4, -38.6, { kind: 'room' }));            // stair room, left
  add(boxSpan(1.0, 3.35, bY, bY + 0.88, -43.4, -37.6, { kind: 'platform', walk: true })); // tank platform, right
  decor.push({ kind: 'tank', x: 2.6, y: bY + 0.88, z: -42.2, r: 0.6, h: 1.0 });
  // the pipe bundle bridging room and platform: 0.3 m of clearance under it
  add(boxSpan(-0.5, 1.0, bY + 0.3, bY + 0.62, -40.9, -39.9, { kind: 'pipes', cam: 'fade', walk: true }));
  // the far parapet, open where the ledge begins
  parapet(-3.6, 0.85, bY, -50, -49.75, 0.45); parapet(1.95, 3.35, bY, -50, -49.75, 0.45);

  // ---- narrow ledge across the void ----
  add(boxSpan(1.2, 1.6, bY - 0.3, bY, -60, -50, { kind: 'ledge', walk: true, narrow: true }));
  decor.push({ kind: 'cable', a: [-3.6, 2.6, -49.8], b: [-1, 3.4, -60.2] });
  decor.push({ kind: 'cable', a: [3.6, 2.2, -49.8], b: [3.4, 2.9, -60.2] });

  // ---- C: a short roof, the run-up for the drop ----
  building(-0.6, 3.4, bY, -66, -60);
  parapet(3.15, 3.4, bY, -66, -60);

  // ---- gap 2 (3.0 m, 1.25 m drop) ----
  // ---- D: the landing terrace ----
  const dY = -1.6;
  building(-5, 5, dY, -96, -69);
  parapet(-5, -4.75, dY, -96, -69); parapet(4.75, 5, dY, -96, -69);
  decor.push({ kind: 'laundry', x0: -4.75, x1: 1.5, y: dY + 1.9, z: -78, poles: true });
  decor.push({ kind: 'laundry', x0: -2, x1: 4.75, y: dY + 2.0, z: -84, poles: true });
  decor.push({ kind: 'dish', x: -4.2, y: dY + 0.42, z: -90, face: 0.7 });
  decor.push({ kind: 'tank', x: 3.6, y: dY, z: -92, r: 0.55, h: 1.0 });

  // neighbours that frame the route (not reachable, never on the path)
  const neighbours = [
    [-11, -5.2, 1.4, -20, 10], [5.2, 12, -2, -26, 10], [-12, -4.4, 4.5, -60, -24],
    [4.4, 11, 1.2, -52, -30], [-9, -1.2, -3.5, -68, -51], [4.2, 10, 2.5, -68, -54],
    [-13, -5.6, 1.6, -100, -70], [5.6, 12, -0.4, -102, -70]
  ];
  for (const [x0, x1, top, zf, zn] of neighbours) add(boxSpan(x0, x1, STREET_Y, top, zf, zn, { kind: 'building', far: true }));

  return {
    decor,
    spawn: [0, 0, 3],
    endZ: -95,
    // respawn points, in order along the route
    checkpoints: [[0, 0, 3], [0, bY, -34], [1.4, bY, -46.5], [1.4, bY, -61.5], [0, dY, -71.5]]
  };
}

// ---- 04_cat.js ----
// =====================================================================
// The cat's body in the world: movement, jumping, landing, balance.
// Pure simulation: no three.js, no DOM. The rig (07_catrig) reads the
// state this produces; it never writes back.
//
// The cat always runs toward -z. The player steers across the roofs and
// jumps. Everything else (ducking under things, steadying on a ledge,
// catching an edge it came up short of) is the cat's own competence.
// =====================================================================

class Cat {
  constructor(world) { this.world = world; this.reset([0, 0, 0]); }

  reset(p, speed) {
    this.pos = p.slice(); this.prev = p.slice();
    this.vel = [0, 0, -(speed || 0)];
    this.fwd = speed || 0;            // forward speed (positive = toward -z)
    this.grounded = false; this.ground = null; this.groundY = p[1];
    this.coyote = 0; this.buffer = 0; this.holdT = 0; this.rising = false;
    this.crouch = 0; this.height = TUNING.cat.standHeight;
    this.gripT = 0; this.teeter = 0; this.edgeAhead = 0; this.narrow = 0;
    this.stumble = 0; this.landSlow = 0; this.airTime = 0; this.sinceLand = 9; this.sinceJump = 9;
    this.scr = null; this.assistX = 0;
    this.lastGroundY = p[1]; this.fallFrom = p[1];
    this.events = [];
    this.stats = { lastJump: null };
    this._jump = null;
  }

  // input: { steer -1..1, jumpPressed (this step), jumpHeld }
  step(dt, input) {
    const C = TUNING.cat, W = this.world;
    this.prev = this.pos.slice();
    this.sinceLand += dt; this.sinceJump += dt;
    if (this.scr) { this.stepScramble(dt); return; }

    // ---- 1. forward momentum: always running, with weight ----
    let target = C.cruise;
    if (this.landSlow > 0) { this.landSlow -= dt; target *= lerp(1, C.hardLandingSlow, clamp(this.landSlow / C.hardLandingTime, 0, 1)); }
    if (this.stumble > 0) { this.stumble -= dt; target *= lerp(1, C.stumbleSpeed, clamp(this.stumble / C.stumbleTime, 0, 1)); }
    if (this.grounded) {
      // accelerate gently, a little quicker from a standstill
      const a = C.accel * (this.fwd < C.cruise * 0.5 ? 1 + C.startBoost : 1);
      this.fwd = this.fwd < target ? Math.min(target, this.fwd + a * dt) : Math.max(target, this.fwd - a * 1.6 * dt);
    }

    // ---- 2. steering ----
    const box = this.grounded ? this.ground : null;
    const w = box ? box.x1 - box.x0 : 99;
    this.narrow = damp(this.narrow, box && w < C.narrowWidth ? 1 : 0, 10, dt);
    let steer = clamp(input.steer || 0, -1, 1);
    let latMax = C.lateral * lerp(1, C.narrowLateral, this.narrow);
    let tvx = steer * latMax;
    // on a ledge, an idle stick lets the cat find the middle by itself
    if (box && this.narrow > 0.5 && Math.abs(steer) < 0.3) tvx += ((box.x0 + box.x1) / 2 - this.pos[0]) * C.narrowCentering * (1 - Math.abs(steer) / 0.3);
    if (box && TUNING.assist.enabled && this.narrow < 0.5) tvx += this.alignToNarrow(steer);
    const la = this.grounded ? (Math.abs(tvx) < Math.abs(this.vel[0]) || sign(tvx) !== sign(this.vel[0]) ? C.lateralDecel : C.lateralAccel) : C.lateralAccelAir;
    this.vel[0] += clamp(tvx - this.vel[0], -la * dt, la * dt);

    // ---- 3. edge grip: steering off the side of a roof is resisted briefly ----
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
    if (input.jumpPressed) this.buffer = C.buffer; else this.buffer = Math.max(0, this.buffer - dt);
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
    this.updateCrouch(dt);

    // ---- 8. integrate and collide, one axis at a time ----
    this.vel[2] = -this.fwd;
    this.moveX(this.vel[0] * dt);
    this.moveZ(this.vel[2] * dt);
    this.moveY(this.vel[1] * dt);
    this.support();

    // ---- 9. reading the ground ahead (for the rig and the camera) ----
    this.edgeAhead = 0;
    if (this.grounded) {
      for (let d = 0.5; d <= 2.6; d += 0.35) {
        const g = W.groundAt(this.pos[0], this.pos[2] - C.halfLength - d, this.pos[1] + C.stepUp, 0.05, 0.05);
        if (g.y < this.pos[1] - 0.6) { this.edgeAhead = 1 - (d - 0.5) / 2.1; break; }
      }
      this.lastGroundY = this.pos[1];
    }
    if (this.grounded && this.ground && this.ground.far) this.events.push({ type: 'fall', reason: 'astray' });
    if (this.pos[1] < this.lastGroundY - C.killDepth) this.events.push({ type: 'fall', reason: 'drop' });
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

  // A narrow surface just ahead at running height, and the cat a little
  // off its line: ease toward it. Steering clearly away overrides this.
  alignToNarrow(steer) {
    const C = TUNING.cat, A = TUNING.assist, W = this.world;
    for (let d = 0.3; d <= A.alignAhead; d += 0.3) {
      const z = this.pos[2] - C.halfLength - d;
      const g = W.groundAt(this.pos[0], z, this.pos[1] + C.stepUp, A.alignReach, 0.05);
      const b = g.box;
      if (!b || b.x1 - b.x0 >= C.narrowWidth || Math.abs(g.y - this.pos[1]) > C.stepUp) continue;
      const cx = (b.x0 + b.x1) / 2, off = cx - this.pos[0];
      if (Math.abs(steer) > 0.5 && sign(steer) !== sign(off)) return 0;
      return off * A.alignStrength * (1 - Math.abs(steer) * 0.5);
    }
    return 0;
  }

  updateCrouch(dt) {
    const C = TUNING.cat, W = this.world;
    const ahead = C.halfLength + 0.25 + this.fwd * 0.12;
    const c = W.ceilingAt(this.pos[0], this.pos[2] - ahead / 2, this.pos[1] + 0.02, C.halfWidth, C.halfLength + ahead / 2);
    const room = c.y - this.pos[1];
    const want = room < C.standHeight + 0.04 && room >= C.crouchHeight ? 1 : 0;
    // only stand up once there is room right above
    const above = W.ceilingAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth, C.halfLength).y - this.pos[1];
    if (want || above < C.standHeight) this.crouch = 1;
    else this.crouch = 0;
    this.height = this.crouch ? C.crouchHeight : C.standHeight;
    void dt;
  }

  // ---- collision, axis by axis, against boxes ----
  catBox(x, y, z, h) {
    const C = TUNING.cat;
    return [x - C.halfWidth, x + C.halfWidth, y, y + h, z - C.halfLength, z + C.halfLength];
  }
  moveX(dx) {
    if (!dx) return;
    const C = TUNING.cat;
    this.pos[0] += dx;
    const b = this.catBox(this.pos[0], this.pos[1] + 0.01, this.pos[2], this.height - 0.01);
    for (const o of this.world.overlaps(...b)) {
      if (this.canStep(o)) { this.stepOnto(o); continue; }
      if (dx > 0) this.pos[0] = o.x0 - C.halfWidth - 1e-4; else this.pos[0] = o.x1 + C.halfWidth + 1e-4;
      this.vel[0] = 0;
    }
  }
  moveZ(dz) {
    if (!dz) return;
    const C = TUNING.cat;
    this.pos[2] += dz;
    const b = this.catBox(this.pos[0], this.pos[1] + 0.01, this.pos[2], this.height - 0.01);
    for (const o of this.world.overlaps(...b)) {
      if (this.canStep(o)) { this.stepOnto(o); continue; }
      // nose-first into something: push out and stumble
      this.pos[2] = dz < 0 ? o.z1 + C.halfLength + 1e-4 : o.z0 - C.halfLength - 1e-4;
      if (this.fwd > 2.5) this.events.push({ type: 'bump', speed: this.fwd });
      if (this.fwd > 2.5 || this.stumble <= 0) this.stumble = C.stumbleTime;
      this.fwd = Math.min(this.fwd, 1.0);
    }
  }
  // small lips are stepped onto: anything up to stepUp while running, and
  // a few centimetres while coming down (so a near-miss isn't a wall)
  canStep(o) {
    const C = TUNING.cat, lift = o.y1 - this.pos[1];
    if (!o.walk || lift < -1e-3) return false;
    if (this.grounded ? lift > C.stepUp : (this.vel[1] > 0 || lift > 0.12)) return false;
    return this.headroom(o.y1);
  }
  stepOnto(o) {
    this.pos[1] = o.y1;
    if (!this.grounded) { this.land(o); this.grounded = true; }
    this.ground = o;
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
      // swept: land on the highest top we crossed this step
      let best = null;
      for (const o of W.near(this.pos[2] - C.halfLength, this.pos[2] + C.halfLength)) {
        if (this.pos[0] + C.halfWidth * 0.6 <= o.x0 || this.pos[0] - C.halfWidth * 0.6 >= o.x1) continue;
        if (this.pos[2] + C.halfLength * 0.7 <= o.z0 || this.pos[2] - C.halfLength * 0.7 >= o.z1) continue;
        if (o.y1 <= y0 + 1e-4 && o.y1 >= this.pos[1] && (!best || o.y1 > best.y1)) best = o;
      }
      if (best) {
        this.pos[1] = best.y1;
        if (!this.grounded) this.land(best);
        this.ground = best; this.grounded = true;
      }
    } else if (dy > 0) {
      const h = this.height;
      for (const o of W.near(this.pos[2] - C.halfLength, this.pos[2] + C.halfLength)) {
        if (this.pos[0] + C.halfWidth <= o.x0 || this.pos[0] - C.halfWidth >= o.x1 || this.pos[2] + C.halfLength <= o.z0 || this.pos[2] - C.halfLength >= o.z1) continue;
        if (o.y0 >= y0 + h - 1e-4 && o.y0 <= this.pos[1] + h) { this.pos[1] = o.y0 - h; this.vel[1] = 0; this.rising = false; this.events.push({ type: 'bonk' }); }
      }
    }
  }
  // grounded: is there still something under the paws?
  support() {
    if (!this.grounded) return;
    const C = TUNING.cat;
    const g = this.world.groundAt(this.pos[0], this.pos[2], this.pos[1] + 0.02, C.halfWidth * 0.45, C.halfLength * 0.55);
    if (g.box && g.y >= this.pos[1] - 0.22) { this.pos[1] = g.y; this.ground = g.box; return; }
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
    this.events.push({ type: 'land', impact, drop: this.fallFrom - this.pos[1], surface: box.surface, narrow: box.x1 - box.x0 < C.narrowWidth });
    this.airTime = 0; this.sinceLand = 0;
    this.lastGroundY = this.pos[1];
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
        if (exact.box && exact.y >= ny && exact.box.walk) return;      // already landing on something
        const wide = W.groundAt(x, z, y, C.halfWidth + A.lateralReach, C.halfLength * 0.7);
        if (wide.box && wide.y >= ny && wide.box.walk) {
          const b = wide.box, m = Math.min(0.15, (b.x1 - b.x0) / 2);
          const tx = clamp(x, b.x0 + m, b.x1 - m);
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
      if (this.pos[0] < o.x0 + 0.04 || this.pos[0] > o.x1 - 0.04) continue;
      const lift = o.y1 - this.pos[1];
      if (lift <= 0.02 || lift > A.scrambleDrop) continue;
      if (W.ceilingAt(this.pos[0], o.z1 - C.halfLength, o.y1 + 0.01, C.halfWidth, C.halfLength).y - o.y1 < C.crouchHeight) continue;
      this.scr = { t: 0, from: this.pos.slice(), to: [this.pos[0], o.y1, o.z1 - C.halfLength - 0.05], box: o, lift };
      this.vel = [0, 0, 0]; this.grounded = false;
      this.events.push({ type: 'scramble', lift });
      return true;
    }
    return false;
  }
  stepScramble(dt) {
    const C = TUNING.cat, A = TUNING.assist, s = this.scr;
    s.t += dt / A.scrambleTime;
    const k = clamp(s.t, 0, 1);
    // up first, then over the lip
    const ky = smooth(clamp(k * 1.5, 0, 1)), kz = smooth(clamp(k * 1.4 - 0.4, 0, 1));
    this.pos = [s.from[0], lerp(s.from[1], s.to[1], ky), lerp(s.from[2], s.to[2], kz)];
    this.crouch = 0; this.height = C.standHeight;
    if (k >= 1) {
      this.scr = null;
      this.grounded = true; this.ground = s.box; this.vel = [0, 0, 0];
      this.fwd = C.cruise * A.scrambleSpeed;
      this._jump = null; this.airTime = 0; this.sinceLand = 0; this.lastGroundY = this.pos[1];
      this.events.push({ type: 'land', impact: 3, drop: 0, surface: s.box.surface, scramble: true });
    }
  }
}

// ---- 05_input.js ----
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
  const state = { steer: 0, jumpHeld: false, presses: 0, stick: null, keys: new Set(), keySteer: 0, enabled: false, virtual: null };
  const roles = new Map();
  const rect = () => canvas.getBoundingClientRect();
  const jumpZoneX = () => ctx.width * (1 - I.jumpZone);
  const anyJumpPointer = () => { for (const r of roles.values()) if (r.role === 'jump') return true; return false; };

  function press() { state.presses++; state.jumpHeld = true; ui.jumpDown(true); }
  function releaseCheck() { state.jumpHeld = anyJumpPointer() || state.keys.has('Space') || state.keys.has('KeyW') || state.keys.has('ArrowUp'); if (!state.jumpHeld) ui.jumpDown(false); }

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

  const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyW', 'Space']);
  ctx.listen(window, 'keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (KEYS.has(e.code)) e.preventDefault();
    if (e.repeat || !state.enabled) return;
    state.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') press();
  });
  ctx.listen(window, 'keyup', e => { state.keys.delete(e.code); releaseCheck(); });

  // read once per simulation step
  function sample(dt) {
    if (state.virtual) {
      const v = state.virtual; const p = v.jump && !v._was; v._was = !!v.jump;
      return { steer: v.steer || 0, jumpPressed: p, jumpHeld: !!v.jump };
    }
    const k = state.keys;
    const want = ((k.has('ArrowRight') || k.has('KeyD')) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA')) ? 1 : 0);
    // keys are digital; give them a short ramp so they steer like a thumb, not a switch
    state.keySteer += clamp(want - state.keySteer, -dt * 9, dt * 9);
    let steer = state.keySteer;
    if (state.stick) {
      const s = state.stick, n = clamp((s.x - s.ox) / I.stickRadius, -1, 1), m = Math.abs(n);
      steer = m < I.stickDead ? 0 : sign(n) * Math.pow((m - I.stickDead) / (1 - I.stickDead), I.stickCurve);
    }
    state.steer = steer;
    const out = { steer, jumpPressed: state.presses > 0, jumpHeld: state.jumpHeld };
    state.presses = 0;
    return out;
  }
  function clear() { roles.clear(); state.stick = null; state.keys.clear(); state.jumpHeld = false; state.presses = 0; state.keySteer = 0; ui.stickHide(); ui.jumpDown(false); }

  return { state, sample, clear };
}

// ---- 06_assets.js ----
// =====================================================================
// Materials, procedural textures and the static box batcher.
// Palette: weathered concrete in warm afternoon haze. Walkable tops are
// the lightest values in the frame; walls are lime-washed plaster that
// darkens into the street; the street itself is near-black. Readability
// comes from value, not hue.
// =====================================================================

const PAL = {
  skyTop: '#7f8d9b', skyHorizon: '#e3c39b', skyLow: '#a98f7c', sun: '#ffd8a6',
  roof: '#cbbfae', roofEdge: '#e6dccb', plaster: ['#c9a58f', '#b9b89e', '#a9b8b6', '#cfb57f', '#bfa3a6', '#b8ad9f'],
  street: '#1d1a19', tin: '#8b7c6c', tank: '#26292b', cat: '#7a5f4a'
};

function createAssets(THREE, renderer) {
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
  function paint(size, draw, repeat) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  const rng = makeRng(7);
  function speckle(g, s, n, cols, rmin, rmax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + rng() * 0.6); g.fillStyle = cols[i % cols.length];
      const r = rmin + rng() * (rmax - rmin), x = rng() * s, y = rng() * s;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      // wrap so the tile has no seams
      if (x < r) { g.beginPath(); g.arc(x + s, y, r, 0, TAU); g.fill(); }
      if (y < r) { g.beginPath(); g.arc(x, y + s, r, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  // concrete roof: speckle, water stains, hairline cracks. 1 tile = 4 m.
  const concrete = paint(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2400, ['#8f8a85', '#b5ada4', '#ffffff', '#6f6a66'], 0.4, 1.6, 0.25);
    speckle(g, s, 26, ['#7c7068', '#9a8f84'], 10, 34, 0.08);
    g.strokeStyle = 'rgba(60,52,48,.35)'; g.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) { let x = rng() * s, y = rng() * s; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 30; y += (rng() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    // expansion joints every 2 m, as on real terraces
    g.fillStyle = 'rgba(70,62,56,.35)'; g.fillRect(0, s / 2 - 1, s, 2); g.fillRect(s / 2 - 1, 0, 2, s);
  });
  // plaster wall: 1 tile = 3 m (a storey), with a slab band and rain streaks
  const plaster = paint(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1400, ['#cfc8c0', '#ffffff', '#b8b0a8'], 0.5, 2, 0.3);
    for (let i = 0; i < 40; i++) { const x = rng() * s, w = 2 + rng() * 6, h = 30 + rng() * 120; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(70,60,55,.22)'); gr.addColorStop(1, 'rgba(70,60,55,0)'); g.fillStyle = gr; g.fillRect(x, 10, w, h); }
    g.fillStyle = 'rgba(80,70,64,.4)'; g.fillRect(0, 0, s, 7);           // slab edge
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 7, s, 2);
    // a window per storey, dark
    for (const wx of [0.18, 0.62]) { g.fillStyle = 'rgba(30,26,26,.85)'; g.fillRect(wx * s, s * 0.35, s * 0.18, s * 0.36); g.fillStyle = 'rgba(120,110,100,.6)'; g.fillRect(wx * s - 3, s * 0.71, s * 0.18 + 6, 4); }
  });
  const tin = paint(128, (g, s) => {
    for (let x = 0; x < s; x++) { const v = 0.75 + 0.25 * Math.sin(x / s * TAU * 8); g.fillStyle = `rgb(${200 * v | 0},${190 * v | 0},${178 * v | 0})`; g.fillRect(x, 0, 1, s); }
    speckle(g, s, 90, ['#8a4e2c', '#6b3a22', '#a8683c'], 2, 9, 0.35);
  });
  const fur = paint(128, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(40,28,20,.26)';
    for (let i = 0; i < 11; i++) { const y = (i + 0.3) * s / 11; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.11 + i) * 3 + (rng() - 0.5) * 2); g.lineTo(s, y + 3); g.lineTo(0, y + 3.5); g.fill(); }
    speckle(g, s, 500, ['#ffffff', '#d8cfc6'], 0.3, 1.2, 0.3);
  });

  const lam = o => new THREE.MeshLambertMaterial(o);
  const M = {
    roof: lam({ map: concrete, vertexColors: true }),
    wall: lam({ map: plaster, vertexColors: true }),
    tin: lam({ map: tin, vertexColors: true }),
    plain: lam({ vertexColors: true }),
    tank: lam({ color: PAL.tank }),
    rust: lam({ color: '#6e4a36' }),
    cable: new THREE.MeshBasicMaterial({ color: '#211d1c' }),
    street: new THREE.MeshBasicMaterial({ color: PAL.street }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false }),
    fur: lam({ map: fur, vertexColors: true }),
    furPlain: lam({ vertexColors: true }),
    eye: new THREE.MeshBasicMaterial({ color: '#d9c25a' }),
    nose: lam({ color: '#5a3934' })
  };
  M.roof.userData.shared = M.wall.userData.shared = true;

  const T = { concrete, plaster, tin, fur };
  const blob = paint(64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }, false);
  M.shadow.alphaMap = blob; M.shadow.color.set('#000');
  T.blob = blob;

  return { M, T, THREE };
}

// ---------------------------------------------------------------------
// Batcher: accumulates boxes and other quads into one geometry per
// material, with world-space UVs so textures tile seamlessly across
// merged pieces. One draw call per material for all static architecture.
// ---------------------------------------------------------------------
class Batch {
  constructor() { this.b = new Map(); }
  bucket(key) { let k = this.b.get(key); if (!k) this.b.set(key, k = { p: [], n: [], u: [], c: [], i: [] }); return k; }
  // quad from 4 corners (counter-clockwise seen from outside), colours per corner
  quad(key, a, b, c, d, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c, d]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Box with per-face materials and colours.
  //   o.top / o.side: material keys; o.topCol / o.sideCol / o.sideColLow: [r,g,b]
  //   o.uvTop, o.uvSide: metres per texture tile. o.faces: which faces to emit.
  box(x0, x1, y0, y1, z0, z1, o) {
    const f = o.faces || { top: true, bottom: false, px: true, nx: true, pz: true, nz: true };
    const tt = o.uvTop || 4, ts = o.uvSide || 3;
    const tc = o.topCol || [1, 1, 1], sc = o.sideCol || [1, 1, 1], sl = o.sideColLow || sc;
    // side colour fades toward the street, so depth reads at a glance
    const lowAt = y => { const k = clamp((y1 - y) / (o.fadeDepth || 9), 0, 1); return [lerp(sc[0], sl[0], k), lerp(sc[1], sl[1], k), lerp(sc[2], sl[2], k)]; };
    const cH = lowAt(y1), cL = lowAt(y0);
    if (f.top) this.quad(o.top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / tt, z1 / tt], [x1 / tt, z1 / tt], [x1 / tt, z0 / tt], [x0 / tt, z0 / tt]], [tc, tc, tc, tc]);
    if (f.bottom) this.quad(o.side, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [cL, cL, cL, cL]);
    const side = (a, b, c, d, n, u0, u1) => this.quad(o.side, a, b, c, d, n, [[u0 / ts, y0 / ts], [u1 / ts, y0 / ts], [u1 / ts, y1 / ts], [u0 / ts, y1 / ts]], [cL, cL, cH, cH]);
    if (f.pz) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], x0, x1);
    if (f.nz) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], -x1, -x0);
    if (f.px) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], -z1, -z0);
    if (f.nx) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], z0, z1);
  }
  // Append an existing BufferGeometry (any shape) with a transform matrix and flat colour.
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
      if (!k.i.length) continue;
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

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
    const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of ms) if (m.userData && m.userData.own) m.dispose();
  });
  if (o.parent) o.parent.remove(o);
}

// ---- 07_catrig.js ----
// =====================================================================
// The cat's visible body: a procedural, articulated rig.
//
//   root (at the paws, faces the velocity)
//   └ body (spine height; compresses, pitches, leans)
//      ├ pelvis ── hind legs (thigh, shin, hock; IK) ── tail (8 springs)
//      └ chest ── fore legs (upper, lower; IK) ── neck ── head (ears, eyes)
//
// The rig only reads the cat's state; it never moves the cat. Feet are
// placed by two-bone IK against the ground, so compression, crouching
// and landing bend the legs by themselves.
//
// Replacing it: any rig (e.g. a skinned glTF cat) that provides
// { root, update(dt, s), dispose() } drops in. `s` is built in 11_game.
// =====================================================================

function createCatRig(THREE, A) {
  const COL = { back: hex3('#5e4535'), side: hex3('#8a6a52'), belly: hex3('#d6c4ad'), sock: hex3('#e9e0d3'), dark: hex3('#3a2a22') };
  const root = new THREE.Group();
  const meshes = [];
  const owned = [];
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // geometry helpers: dorsal-dark to belly-light gradient baked into vertex colours
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
    g.rotateX(Math.PI / 2);          // poles along the spine: tabby stripes wrap across the back
    g.scale(rx, ry, rz);
    return shade(g, top, bottom, mid);
  }
  function bone(r0, len, top, bottom) {
    // a tapered limb from the joint (origin) down -y
    const g = new THREE.CylinderGeometry(r0, r0 * 0.78, len, 8, 1);
    g.translate(0, -len / 2, 0);
    return shade(g, top, bottom);
  }
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat || A.M.furPlain);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m); meshes.push(m); owned.push(geo);
    return m;
  }
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };

  // ---- body ----
  const SPINE_Y = 0.22;
  const body = grp(root, 0, SPINE_Y, 0);
  const pelvis = grp(body), chest = grp(body);
  add(pelvis, ellipsoid(0.072, 0.082, 0.16, COL.back, COL.belly, COL.side), A.M.fur, 0, -0.005, 0.075);
  add(chest, ellipsoid(0.078, 0.09, 0.15, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.002, -0.07);
  // neck and head
  add(chest, ellipsoid(0.048, 0.056, 0.07, COL.back, COL.belly, COL.side), null, 0, 0.04, -0.19).rotation.x = 0.7;
  const head = grp(chest, 0, 0.075, -0.225);
  add(head, ellipsoid(0.066, 0.058, 0.066, COL.back, COL.belly, COL.side, 14), A.M.fur, 0, 0.012, -0.03);
  add(head, ellipsoid(0.03, 0.024, 0.032, COL.belly, COL.belly, null, 10), null, 0, -0.012, -0.078);
  add(head, new THREE.SphereGeometry(0.008, 6, 4), A.M.nose, 0, 0.004, -0.106);
  const eyes = [];
  for (const sx of [-1, 1]) { const e = add(head, new THREE.SphereGeometry(0.0095, 8, 6), A.M.eye, sx * 0.024, 0.022, -0.078); e.castShadow = false; eyes.push(e); }
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = grp(head, sx * 0.032, 0.048, -0.02);
    const g = new THREE.ConeGeometry(0.024, 0.055, 4, 1); g.translate(0, 0.0275, 0); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.55);
    add(pivot, shade(g, COL.dark, COL.side), null);
    pivot.rotation.z = -sx * 0.28;
    ears.push({ g: pivot, sx });
  }

  // ---- legs: shoulder/hip pivot -> upper -> lower (-> hock) -> paw ----
  function leg(parent, x, y, z, hind) {
    const L1 = hind ? 0.1 : 0.115, L2 = hind ? 0.098 : 0.112, L3 = hind ? 0.078 : 0;
    const pivot = grp(parent, x, y, z);
    const up = grp(pivot); add(up, bone(hind ? 0.034 : 0.026, L1 + 0.01, COL.side, COL.side), A.M.fur);
    if (hind) add(up, ellipsoid(0.04, 0.06, 0.055, COL.back, COL.side, null, 10), A.M.fur, 0, -0.025, 0.004);
    const lo = grp(up, 0, -L1, 0); add(lo, bone(hind ? 0.02 : 0.018, L2 + 0.006, COL.side, COL.side));
    let hock = null, paw;
    if (hind) { hock = grp(lo, 0, -L2, 0); add(hock, bone(0.016, L3, COL.side, COL.side)); paw = grp(hock, 0, -L3, 0); }
    else paw = grp(lo, 0, -L2, 0);
    add(paw, ellipsoid(0.02, 0.012, 0.028, COL.sock, COL.sock, null, 8), null, 0, 0.004, -0.008);
    return { pivot, up, lo, hock, paw, L1, L2, L3, hind, x, phase: 0, side: sign(x) };
  }
  const legs = {
    fl: leg(chest, -0.042, -0.035, -0.145, false), fr: leg(chest, 0.042, -0.035, -0.145, false),
    hl: leg(pelvis, -0.045, -0.025, 0.16, true), hr: leg(pelvis, 0.045, -0.025, 0.16, true)
  };
  // rotary gallop: hinds paired, then fores
  const OFFSET = { hl: 0, hr: 0.09, fl: 0.5, fr: 0.6 };

  // ---- tail: a chain of springs ----
  const TAIL_N = 8, TAIL_L = 0.038;
  const tail = [];
  let tp = grp(pelvis, 0, 0.025, 0.225);
  for (let i = 0; i < TAIL_N; i++) {
    const r = lerp(0.019, 0.011, i / TAIL_N);
    const g = new THREE.CylinderGeometry(r * 0.9, r, TAIL_L + 0.006, 7, 1); g.rotateX(Math.PI / 2); g.translate(0, 0, TAIL_L / 2);
    const c = i % 2 ? COL.side : COL.back;
    add(tp, shade(g, i === TAIL_N - 1 ? COL.dark : c, c), A.M.furPlain);
    tail.push({ g: tp, p: mkSpring(0), y: mkSpring(0), f: lerp(6, 2.6, i / (TAIL_N - 1)) });
    tp = grp(tp, 0, 0, TAIL_L);
  }

  // ---- state ----
  const S = {
    phase: 0, yaw: mkSpring(0), lift: mkSpring(0), pitch: mkSpring(0), lean: mkSpring(0), flex: mkSpring(0),
    air: 0, crouch: 0, gather: 0, prevVy: 0, prevVx: 0, ay: 0, ax: 0, time: 0, blink: 2, twitch: 3, twitchEar: 0, run: 0
  };

  // two-bone IK in the pivot's y-z plane. bend: +1 joint behind (elbow), -1 joint ahead (knee)
  function ik(Lg, ty, tz, bend) {
    const a = Lg.L1, b = Lg.L2;
    let d = Math.hypot(ty, tz);
    d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const phi = Math.atan2(-tz, -ty);
    const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const beta = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    Lg.up.rotation.x = phi - bend * alpha;
    Lg.lo.rotation.x = bend * (Math.PI - beta);
    return Lg.up.rotation.x + Lg.lo.rotation.x;
  }
  // a root-space target (relative to the leg pivot's root-space position) into pivot space
  function placeLeg(Lg, rel) {
    Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
    _w.set(_v.x, _v.y + rel[1], _v.z + rel[0]);
    root.localToWorld(_w); Lg.pivot.worldToLocal(_w);
    if (Lg.hind) {
      // hock stays near-vertical, leaning back: solve thigh+shin to the ankle
      const ankle = [_w.y + Lg.L3 * 0.92, _w.z + Lg.L3 * 0.4];
      const sum = ik(Lg, ankle[0], ankle[1], -1);
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
    // accelerations drive secondary motion (tail, ears)
    S.ay = damp(S.ay, clamp((s.vy - S.prevVy) / dt, -60, 60), 18, dt); S.prevVy = s.vy;
    S.ax = damp(S.ax, clamp((s.vx - S.prevVx) / dt, -40, 40), 12, dt); S.prevVx = s.vx;
    for (const e of s.events) {
      if (e.type === 'land') { S.lift.v -= clamp(e.impact, 0, 14) * 0.075; S.pitch.v -= clamp(e.impact, 0, 14) * 0.18; S.flex.v += clamp(e.impact, 0, 14) * 0.08; }
      if (e.type === 'jump') { S.lift.v += 0.5; S.flex.v -= 1.4; }
      if (e.type === 'bump') { S.pitch.v -= 3; S.lift.v -= 0.4; }
    }
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    // face the direction of travel
    const yawT = Math.atan2(-s.vx, Math.max(0.5, speed)) * 0.85;
    root.rotation.y = spring(S.yaw, yawT, 3.5, 0.9, dt);

    const grounded = s.grounded && !s.scr;
    S.air = damp(S.air, grounded ? 0 : 1, grounded ? 22 : 12, dt);
    S.crouch = damp(S.crouch, s.crouch ? 1 : 0, 16, dt);
    S.gather = damp(S.gather, grounded ? s.edgeAhead : 0, 8, dt);

    // gait phase: stride grows with speed
    const stride = 0.5 + speed * 0.16;
    if (grounded) S.phase = (S.phase + dt * speed / stride) % 1;
    else if (s.scr !== null) S.phase = (S.phase + dt * 6) % 1;
    const ph = S.phase * TAU;
    const duty = lerp(0.62, 0.38, S.run);

    // body: height, pitch, lean, spine flex
    const bob = grounded ? Math.abs(Math.sin(ph)) * 0.014 * S.run : 0;
    const liftT = -0.095 * S.crouch - 0.03 * S.gather + bob - 0.012 * s.narrow;
    spring(S.lift, liftT, 3.4, 0.45, dt);
    let pitchT = grounded ? Math.sin(ph) * 0.05 * S.run - 0.05 * S.crouch : clamp(s.vy * 0.045, -0.35, 0.3);
    if (s.scr !== null) pitchT = 0.7 * (1 - s.scr);
    if (s.stumble > 0) pitchT -= 0.25 * clamp(s.stumble / 0.4, 0, 1);
    spring(S.pitch, pitchT, 3.2, 0.5, dt);
    const teeter = s.teeter * Math.sin(S.time * 9) * 0.18;
    spring(S.lean, clamp(-s.vx * 0.07, -0.3, 0.3) + teeter, 3, 0.6, dt);
    const flexT = grounded ? Math.sin(ph + Math.PI / 2) * 0.13 * S.run + 0.06 * S.gather : lerp(-0.12, 0.08, clamp(-s.vy / 6 + 0.5, 0, 1));
    spring(S.flex, flexT, 4.5, 0.55, dt);
    body.position.y = SPINE_Y + S.lift.x;
    body.rotation.set(S.pitch.x, 0, S.lean.x);
    pelvis.rotation.x = S.flex.x; chest.rotation.x = -S.flex.x;
    root.updateMatrixWorld(true);

    // legs
    const falling = clamp(-s.vy / 5 + 0.5, 0, 1);
    for (const key in legs) {
      const Lg = legs[key];
      Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
      const h = _v.y;                                    // pivot height above the paws' ground
      // ground pose: gait or stance
      let gz, gy;
      const lp = (S.phase + OFFSET[key]) % 1;
      const reach = clamp(stride * duty * 0.5, 0.03, 0.15) * S.run;
      if (lp < duty) { gz = lerp(-reach, reach, lp / duty); gy = -h; }
      else { const u = (lp - duty) / (1 - duty); gz = lerp(reach, -reach, smooth(u)); gy = -h + Math.sin(Math.PI * u) * lerp(0.03, 0.085, S.run); }
      gz += Lg.hind ? 0.012 : -0.01;
      if (S.run < 0.05) gz += (Lg.side > 0 ? 0.01 : -0.01) * (Lg.hind ? 1 : -1);
      // air pose: fore reach, hind stretch; then reach down to land
      let az, ay;
      if (s.sinceJump < 0.12 && !grounded) { az = Lg.hind ? 0.13 : 0.02; ay = Lg.hind ? -0.19 : -0.1; }
      else if (Lg.hind) { az = lerp(0.15, -0.02, falling); ay = lerp(-0.1, -0.15, falling); }
      else { az = lerp(-0.17, -0.09, falling); ay = lerp(-0.1, -0.2, falling); }
      // scramble: front paws hook the lip, hinds scrabble
      if (s.scr !== null) { if (Lg.hind) { az = Math.sin(ph * 2 + (Lg.side > 0 ? 1.5 : 0)) * 0.06; ay = -0.15 + Math.cos(ph * 2) * 0.03; } else { az = -0.12; ay = 0.02 + 0.12 * s.scr; } }
      placeLeg(Lg, [lerp(gz, az, S.air), lerp(gy, ay, S.air)]);
    }

    // head: held level against the body's pitch, looking where the cat is going
    let look = -0.08 - 0.22 * S.gather - 0.12 * s.narrow;
    if (!grounded) look = lerp(0.12, -0.38, falling);
    head.rotation.x = -(S.pitch.x - S.flex.x) * 0.85 + look - 0.15 * S.crouch;
    head.position.y = 0.075 - 0.05 * S.crouch;
    head.rotation.y = clamp(-s.vx * 0.12 - s.assistX * 0.15, -0.5, 0.5);
    head.rotation.z = -S.lean.x * 0.6;
    // ears: flatten with speed and when ducking; an occasional twitch
    S.twitch -= dt; if (S.twitch < 0) { S.twitch = 2 + Math.random() * 3; S.twitchEar = 0.18; S.twitchSide = Math.random() < 0.5 ? 0 : 1; }
    S.twitchEar = Math.max(0, S.twitchEar - dt);
    ears.forEach((e, i) => { e.g.rotation.x = -(0.15 * S.run + 0.9 * S.crouch + 0.3 * S.air * (1 - falling)) + (S.twitchEar > 0 && i === S.twitchSide ? 0.35 : 0); });
    // blink
    S.blink -= dt; if (S.blink < 0) S.blink = 2.5 + Math.random() * 3;
    const ey = S.blink < 0.1 ? 0.15 : 1; for (const e of eyes) e.scale.y = ey;

    // tail: streams back at speed, rises for balance; lags vertical and lateral acceleration
    const upBase = lerp(-0.85, -0.08, S.run) - 0.4 * s.teeter - 0.3 * s.narrow;
    for (let i = 0; i < TAIL_N; i++) {
      const t = tail[i], k = i / (TAIL_N - 1);
      const pT = (i === 0 ? upBase : lerp(0.07, -0.16, k) * lerp(1.6, 1, S.run)) + clamp(S.ay * 0.004, -0.25, 0.25) * (0.4 + k) - S.crouch * (i === 0 ? -0.5 : 0.05);
      const yT = (i === 0 ? 0 : clamp(S.ax * 0.01, -0.2, 0.2)) + Math.sin(S.time * 7 - i * 0.6) * (0.04 + 0.16 * s.teeter) * (0.3 + k) - S.lean.x * 0.6 * (i < 3 ? 1 : 0);
      t.g.rotation.x = spring(t.p, pT, t.f, 0.4, dt);
      t.g.rotation.y = spring(t.y, yT, t.f, 0.35, dt);
    }
  }

  function setShadows(on) { for (const m of meshes) m.castShadow = on; }
  function dispose() { for (const g of owned) g.dispose(); if (root.parent) root.parent.remove(root); }
  return { root, update, dispose, setShadows };
}

// ---- 08_camera.js ----
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

  // ground heights ahead of the cat; a missing or much lower probe is a gap
  function probe(cat) {
    let sum = 0, wsum = 0, gap = 0;
    for (let i = 0; i < T.terrainProbe.length; i++) {
      const d = T.terrainProbe[i], z = cat.pos[2] - d;
      const g = world.groundAt(cat.pos[0], z, cat.pos[1] + 1.5, 0.3, 0.3);
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
    st.refY = damp(st.refY, refTarget, grounded ? T.heightK : T.airHeightK, dt);
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
    const back = F.back + speed * T.speedBack + st.gap * T.gapBack;
    const up = F.up + st.gap * T.gapLift;
    const x = lerp(st.laneX, cat.pos[0], F.follow);
    // in the air, rise with a third of the arc: enough to keep looking down onto the landing
    const arc = grounded ? 0 : Math.max(0, cat.pos[1] - st.refY) * T.arcFollow;
    want.set(x, Math.max(st.refY, st.aheadY - 0.5) + up + arc + st.dip.x, cat.pos[2] + back);
    lookWant.set(lerp(x, cat.pos[0] + cat.vel[0] * 0.25, 0.6), lerp(st.refY, st.aheadY, 0.55) + F.lookUp + 0.35, cat.pos[2] - F.lookAhead);
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
    for (const b of world.overlaps(Math.min(o[0], st.pos.x) - 0.2, Math.max(o[0], st.pos.x) + 0.2, Math.min(o[1], st.pos.y), Math.max(o[1], st.pos.y) + 0.2, Math.min(o[2], st.pos.z), Math.max(o[2], st.pos.z))) if (b.cam === 'fade') st.fade.add(b.id);

    camera.position.set(o[0] + d[0] * dl * st.pull, o[1] + d[1] * dl * st.pull, o[2] + d[2] * dl * st.pull);
    camera.lookAt(st.look);
    const fov = F.fov + speed * T.speedFov * 0.5 + st.gap * 2;
    st.fov = damp(st.fov, fov, 3, dt);
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
  }
  function reset() { st.init = false; st.pull = 1; st.dip.x = st.dip.v = 0; }
  return { update, reset, st };
}

// ---- 09_scene.js ----
// =====================================================================
// The visible city: architecture built from the collision boxes (what
// you see is exactly what you stand on), small lived-in details, a
// backdrop of neighbouring roofs, the sky, the haze and the light.
// Static geometry is merged per material: a handful of draw calls.
// =====================================================================

function createScene(THREE, A, scene, world, lab, opts) {
  const { M } = A;
  const root = new THREE.Group(); scene.add(root);
  const ownGeo = [];
  const keep = g => { ownGeo.push(g); return g; };
  const B = new Batch();          // casts and receives shadows
  const BF = new Batch();         // far: receives nothing, casts nothing
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const xf = (x, y, z, sx, sy, sz, rx, ry, rz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx, sy, sz));
  const G = {
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 12, 1)), cyl6: keep(new THREE.CylinderGeometry(1, 1, 1, 6, 1)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)), dish: keep(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, 0.9))
  };
  const roofC = hex3(PAL.roof), edgeC = hex3(PAL.roofEdge), low = hex3('#2b2422');

  // ---- architecture from boxes ----
  const fades = new Map();
  for (const b of world.boxes) {
    const plaster = hex3(PAL.plaster[(b.id * 7 + 3) % PAL.plaster.length]);
    const T = b.far ? BF : B;
    if (b.kind === 'building') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: b.far ? mul3(roofC, 0.9) : roofC, sideCol: plaster, sideColLow: low, fadeDepth: 10 });
      if (!b.far) coping(b, plaster);
    } else if (b.kind === 'parapet') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'plain', side: 'wall', topCol: edgeC, sideCol: mul3(plaster, 1.05), sideColLow: mul3(plaster, 0.8), fadeDepth: 0.5, uvSide: 1.5 });
    } else if (b.kind === 'room') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.9), sideCol: mul3(plaster, 1.08), sideColLow: mul3(plaster, 0.8), fadeDepth: 3 });
      // a door on the face toward the run, and a slab overhang
      const dw = Math.min(0.9, (b.x1 - b.x0) * 0.4), cx = (b.x0 + b.x1) / 2;
      T.quad('plain', [cx - dw / 2, b.y0, b.z1 + 0.01], [cx + dw / 2, b.y0, b.z1 + 0.01], [cx + dw / 2, b.y0 + 1.9, b.z1 + 0.01], [cx - dw / 2, b.y0 + 1.9, b.z1 + 0.01], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], Array(4).fill(hex3('#3d4a52')));
      T.box(b.x0 - 0.12, b.x1 + 0.12, b.y1 - 0.1, b.y1 + 0.02, b.z0 - 0.12, b.z1 + 0.12, { top: 'roof', side: 'plain', topCol: mul3(roofC, 0.92), sideCol: mul3(edgeC, 0.85) });
    } else if (b.kind === 'tankStand') {
      // a brick plinth (solid: you cannot pass under it) carrying a black tank
      T.box(b.x0, b.x1, b.y0, b.y0 + 0.55, b.z0, b.z1, { top: 'plain', side: 'wall', topCol: mul3(edgeC, 0.9), sideCol: hex3('#a5674e'), sideColLow: hex3('#7d4c3b'), fadeDepth: 0.6, uvSide: 1 });
      tank((b.x0 + b.x1) / 2, b.y0 + 0.55, (b.z0 + b.z1) / 2, Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.45, b.y1 - b.y0 - 0.55);
    } else if (b.kind === 'platform') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.95), sideCol: hex3('#a5674e'), sideColLow: hex3('#7d4c3b'), fadeDepth: 0.8, uvSide: 1 });
      T.box(b.x0 - 0.02, b.x1 + 0.02, b.y1 - 0.06, b.y1 + 0.01, b.z0 - 0.02, b.z1 + 0.02, { top: 'plain', side: 'plain', topCol: edgeC, sideCol: edgeC, faces: { pz: true, nx: true, px: true, nz: true } });
    } else if (b.kind === 'ledge') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'plain', topCol: edgeC, sideCol: hex3('#8e8579'), sideColLow: hex3('#5a524b'), fadeDepth: 0.3 });
      // the old pipe the ledge was built around, underneath
      B.geo('rust', G.cyl, xf((b.x0 + b.x1) / 2, b.y0 - 0.09, (b.z0 + b.z1) / 2, 0.07, b.z1 - b.z0, 0.07, Math.PI / 2), [1, 1, 1], THREE);
    } else if (b.kind === 'pipes') {
      fades.set(b.id, pipeBundle(b));
    }
  }
  // a lighter coping band around every roof edge: edges read at a glance
  function coping(b, plaster) {
    const y = b.y1, w = 0.09, c = edgeC, cs = mul3(plaster, 1.15);
    const strip = (x0, x1, z0, z1) => B.quad('roof', [x0, y + 0.004, z1], [x1, y + 0.004, z1], [x1, y + 0.004, z0], [x0, y + 0.004, z0], [0, 1, 0], [[x0 / 4, z1 / 4], [x1 / 4, z1 / 4], [x1 / 4, z0 / 4], [x0 / 4, z0 / 4]], [c, c, c, c]);
    strip(b.x0, b.x1, b.z1 - w, b.z1); strip(b.x0, b.x1, b.z0, b.z0 + w);
    strip(b.x0, b.x0 + w, b.z0, b.z1); strip(b.x1 - w, b.x1, b.z0, b.z1);
    B.box(b.x0 - 0.03, b.x1 + 0.03, y - 0.16, y + 0.003, b.z0 - 0.03, b.z1 + 0.03, { top: 'plain', side: 'plain', topCol: c, sideCol: cs, faces: { pz: true, nz: true, px: true, nx: true } });
  }
  function tank(x, y, z, r, h) {
    B.geo('tank', G.cyl, xf(x, y + h / 2, z, r, h, r), [1, 1, 1], THREE);
    for (let i = 1; i < 4; i++) B.geo('tank', G.cyl, xf(x, y + h * i / 4, z, r * 1.03, 0.04, r * 1.03), [1, 1, 1], THREE);
    B.geo('tank', G.cyl, xf(x, y + h + 0.04, z, r * 0.35, 0.08, r * 0.35), [1, 1, 1], THREE);
  }
  function pipeBundle(b) {
    const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: '#7b6c5f', transparent: true, opacity: 1 });
    mat.userData.own = true;
    const len = b.x1 - b.x0 + 0.6, cx = (b.x0 + b.x1) / 2, h = b.y1 - b.y0;
    const rows = [[b.y0 + 0.07, -0.25, 0.07], [b.y0 + 0.07, 0.0, 0.07], [b.y0 + 0.07, 0.25, 0.07], [b.y0 + h - 0.09, -0.12, 0.09], [b.y0 + h - 0.09, 0.15, 0.09]];
    const cz = (b.z0 + b.z1) / 2;
    for (const [y, dz, r] of rows) { const m = new THREE.Mesh(G.cyl, mat); m.scale.set(r, len, r); m.rotation.z = Math.PI / 2; m.position.set(cx, y, cz + dz); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    // a strap, so it reads as built, not floating
    for (const sx of [b.x0 + 0.2, b.x1 - 0.2]) { const s = new THREE.Mesh(G.box, mat); s.scale.set(0.04, h + 0.04, (b.z1 - b.z0) * 0.9); s.position.set(sx, b.y0 + h / 2, cz); g.add(s); }
    root.add(g);
    return { g, mat, k: 1 };
  }

  // ---- lived-in details ----
  const cloths = [];
  const CLOTH = ['#b5562f', '#2f4a7a', '#7a2b35', '#e8e2d4', '#c99a2e', '#55704f', '#a8473f', '#d9cfc0'].map(hex3);
  const rngD = makeRng(11);
  for (const d of lab.decor) {
    if (d.kind === 'dish') {
      B.geo('plain', G.cyl6, xf(d.x, d.y + 0.35, d.z, 0.025, 0.7, 0.025), hex3('#59534e'), THREE);
      B.geo('plain', G.dish, xf(d.x, d.y + 0.75, d.z, 0.32, 0.32, 0.12, Math.PI / 2 - 0.4, d.face, 0), hex3('#d8d3cb'), THREE);
    } else if (d.kind === 'pipeRun') {
      B.geo('rust', G.cyl, xf(d.x, d.y, (d.z0 + d.z1) / 2, 0.05, d.z1 - d.z0, 0.05, Math.PI / 2), [1, 1, 1], THREE);
    } else if (d.kind === 'tank') {
      tank(d.x, d.y, d.z, d.r, d.h);
    } else if (d.kind === 'crates') {
      B.box(d.x - 0.3, d.x + 0.3, d.y, d.y + 0.45, d.z - 0.25, d.z + 0.25, { top: 'plain', side: 'plain', topCol: hex3('#8a6a48'), sideCol: hex3('#76593d') });
      B.box(d.x - 0.22, d.x + 0.2, d.y + 0.45, d.y + 0.8, d.z - 0.2, d.z + 0.18, { top: 'plain', side: 'plain', topCol: hex3('#9a7a55'), sideCol: hex3('#806246') });
    } else if (d.kind === 'cable') {
      const a = new THREE.Vector3(...d.a), c = new THREE.Vector3(...d.b), mid = a.clone().lerp(c, 0.5); mid.y -= 0.6;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      const g = keep(new THREE.TubeGeometry(curve, 16, 0.012, 4, false));
      B.geo('cable', g, _m.identity(), [1, 1, 1], THREE);
    } else if (d.kind === 'laundry') {
      if (d.poles) for (const x of [d.x0 + 0.05, d.x1 - 0.05]) B.geo('rust', G.cyl6, xf(x, d.y - 1.0, d.z, 0.025, 2.1, 0.025), [1, 1, 1], THREE);
      const line = new THREE.Group(); line.position.set(0, d.y, d.z); root.add(line);
      const bl = new Batch();
      bl.geo('cable', G.cyl6, xf((d.x0 + d.x1) / 2, 0, 0, 0.008, d.x1 - d.x0, 0.008, 0, 0, Math.PI / 2), [1, 1, 1], THREE);
      for (let x = d.x0 + 0.3; x < d.x1 - 0.4;) {
        const w = 0.35 + rngD() * 0.6, h = 0.45 + rngD() * 0.55, c = CLOTH[(rngD() * CLOTH.length) | 0];
        bl.quad('cloth', [x, -h, 0], [x + w, -h, 0], [x + w, 0, 0], [x, 0, 0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [mul3(c, 0.75), mul3(c, 0.75), c, c]);
        x += w + 0.08 + rngD() * 0.25;
      }
      const clothMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true }); clothMat.userData.own = true;
      const built = bl.build(THREE, { cable: M.cable, cloth: clothMat }, { cast: true });
      line.add(built); cloths.push({ g: line, ph: rngD() * TAU, mat: clothMat, z: d.z });
    }
  }

  // ---- the neighbourhood beyond the route ----
  const rngB = makeRng(23);
  for (let z = 30; z > -200; z -= 9) {
    for (const side of [-1, 1]) {
      let x = 14 + rngB() * 3;
      while (x < 70) {
        const w = 5 + rngB() * 7, d = 6 + rngB() * 3, top = -9 + rngB() * 14 + (x > 35 ? 3 : 0);
        const cx = side * (x + w / 2), cz = z - d / 2;
        const col = mul3(hex3(PAL.plaster[(rngB() * PAL.plaster.length) | 0]), 0.9);
        BF.box(cx - w / 2, cx + w / 2, STREET_Y, top, cz - d / 2, cz + d / 2, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.85), sideCol: col, sideColLow: low, fadeDepth: 12, faces: { top: true, pz: true, nz: true, px: true, nx: true } });
        if (rngB() < 0.5) BF.geo('tank', G.cyl, xf(cx + (rngB() - 0.5) * w * 0.5, top + 0.5, cz + (rngB() - 0.5) * d * 0.5, 0.6, 1, 0.6), [1, 1, 1], THREE);
        if (rngB() < 0.4) BF.box(cx - w * 0.3, cx + w * 0.05, top, top + 2.4, cz - 1.2, cz + 1.2, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.8), sideCol: col, sideColLow: col });
        x += w + 1 + rngB() * 4;
      }
    }
  }
  const near = B.build(THREE, { roof: M.roof, wall: M.wall, plain: M.plain, tank: M.tank, rust: M.rust, cable: M.cable }, { cast: true, receive: true });
  const far = BF.build(THREE, { roof: M.roof, wall: M.wall, plain: M.plain, tank: M.tank }, { cast: false, receive: false });
  root.add(near); root.add(far);

  // ---- the street, far below ----
  const street = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 600)), M.street);
  street.rotation.x = -Math.PI / 2; street.position.set(0, STREET_Y, -80); root.add(street);

  // ---- sky: afternoon haze ----
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, hor: { value: new THREE.Color(PAL.skyHorizon) }, bot: { value: new THREE.Color(PAL.skyLow) }, sunDir: { value: new THREE.Vector3(-0.45, 0.32, -0.83).normalize() }, sunCol: { value: new THREE.Color(PAL.sun) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 top,hor,bot,sunDir,sunCol; varying vec3 vD; void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h*1.6,0.0,1.0), 0.7)) : mix(hor, bot, clamp(-h*5.0,0.0,1.0)); float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 900.0) * 0.55 + pow(s, 10.0) * 0.16); gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  skyMat.userData.own = true;
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(300, 24, 12)), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  scene.fog = new THREE.Fog(PAL.skyHorizon, 28, 150);
  scene.background = new THREE.Color(PAL.skyHorizon);

  // ---- light: one warm sun from ahead-left, a cool sky fill ----
  const hemi = new THREE.HemisphereLight('#d9dde0', '#6a5548', 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9ad', 2.1);
  const SUN = new THREE.Vector3(-0.45, 0.75, -0.48).normalize().multiplyScalar(30);
  sun.shadow.mapSize.set(opts.small ? 1024 : 2048, opts.small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 70 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);

  function setShadows(on) { sun.castShadow = on; }
  setShadows(opts.shadows);

  let time = 0;
  function update(dt, focus, camera) {
    time += dt;
    sun.position.set(focus[0] + SUN.x, focus[1] + SUN.y, focus[2] - 5 + SUN.z);
    sun.target.position.set(focus[0], focus[1], focus[2] - 5); sun.target.updateMatrixWorld();
    sky.position.copy(camera.position);
    for (const c of cloths) {
      c.g.rotation.x = Math.sin(time * 1.3 + c.ph) * 0.07 + 0.04;
      // laundry the camera is passing through thins out, so it never blinds the run
      const k = clamp((Math.abs(camera.position.z - c.z) - 0.6) / 2.4, 0.15, 1);
      c.mat.opacity = k; c.mat.depthWrite = k > 0.99;
    }
  }
  function setFaded(ids, dt) {
    for (const [id, f] of fades) {
      const want = ids.has(id) ? 0.28 : 1;
      f.k = damp(f.k, want, 10, dt);
      f.mat.opacity = f.k; f.mat.transparent = f.k < 0.99; f.mat.depthWrite = f.k > 0.99;
    }
  }
  function dispose() {
    disposeTree(root); disposeTree(sky);
    for (const g of ownGeo) g.dispose();
    scene.remove(hemi); scene.remove(sun); scene.remove(sun.target);
  }
  return { update, setFaded, setShadows, dispose, root, sun };
}

// ---- 10_hud.js ----
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
  H.dist = el('div', 'rr-num', '0<small>M</small>', tl);
  H.sub = el('div', 'rr-sub rr-lab', 'Movement lab', tl);
  const icons = el('div', 'rr-icons', '', H.top);
  H.labBtn = el('div', 'rr-ib', 'LAB', icons);
  H.pauseBtn = el('div', 'rr-ib', '<svg viewBox="-10 -10 20 20" width="14" height="14"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>', icons);
  H.dbg = el('div', 'rr-dbg');
  H.stick = el('div', 'rr-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.jump = el('div', 'rr-jump', '<svg viewBox="-10 -10 20 20"><path d="M-7,4L0,-4L7,4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  H.hintL = el('div', 'rr-hint', 'DRAG TO STEER'); H.hintR = el('div', 'rr-hint', 'TAP · HOLD TO JUMP HIGHER');
  // cards
  H.start = el('div', 'rr-card on');
  el('div', 'rr-title', 'ROOFTOP<br>RUN', H.start);
  H.startText = el('div', 'rr-p', '', H.start);
  H.go = el('button', 'rr-b', 'RUN', H.start);
  H.retry = el('button', 'rr-b sec', 'RETRY', H.start); H.retry.style.display = 'none';
  H.pause = el('div', 'rr-card');
  el('div', 'rr-p', 'Paused', H.pause);
  H.resume = el('button', 'rr-b', 'RESUME', H.pause);
  H.restart = el('button', 'rr-b sec', 'RESTART LAB', H.pause);
  H.panel = el('div', 'rr-panel');

  const touchy = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  H.startText.innerHTML = touchy
    ? 'The cat runs by itself.<br><b>Left thumb</b>: drag to steer. <b>Right thumb</b>: tap to jump, hold to jump higher.'
    : 'The cat runs by itself.<br><b>A / D</b> or <b>← →</b> steer. <b>Space</b> jumps; hold it to jump higher.';

  const api = {
    root: ui, H, touchy,
    stickShow(x, y) { H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = ''; },
    stickMove(ox, oy, dx, dy) { H.stick.style.left = ox + 'px'; H.stick.style.top = oy + 'px'; H.knob.style.transform = `translate(${dx}px,${dy}px)`; },
    stickHide() { H.stick.style.display = 'none'; },
    jumpDown(on) { H.jump.classList.toggle('down', on); },
    setPlay(on) { for (const e of [H.top, H.jump]) e.style.display = on ? '' : 'none'; if (!on) H.stick.style.display = 'none'; },
    hints(on) { H.hintL.classList.toggle('on', on); H.hintR.classList.toggle('on', on); H.zone.classList.toggle('hint', on); },
    card(which) { for (const [k, e] of [['start', H.start], ['pause', H.pause]]) e.classList.toggle('on', k === which); },
    fade(v) { H.fade.style.opacity = v; },
    distance(m, lap) { const s = m + '<small>M</small>'; if (api._d !== s) { api._d = s; H.dist.innerHTML = s; } const t = lap > 1 ? 'Movement lab · lap ' + lap : 'Movement lab'; if (api._l !== t) { api._l = t; H.sub.textContent = t; } },
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
      for (const c of [H.start, H.pause]) { c.style.bottom = 'auto'; c.style.top = (top + (h - top - bot) * (portrait ? 0.42 : 0.5)) + 'px'; c.style.transform = 'translate(-50%,-50%)'; c.style.maxHeight = (h - top - bot - 16) + 'px'; c.style.overflowY = 'auto'; }
    }
  };

  // ---- lab panel: live tuning ----
  const SLIDERS = [
    ['Movement'],
    ['cat.cruise', 'Run speed', 3, 10, 0.1], ['cat.accel', 'Acceleration', 2, 20, 0.5], ['cat.lateral', 'Steer speed', 2, 8, 0.1], ['cat.lateralAccel', 'Steer response', 6, 50, 1],
    ['Jump'],
    ['cat.jumpVel', 'Jump strength', 5, 10, 0.1], ['cat.gravity', 'Gravity', 12, 40, 0.5], ['cat.fallMul', 'Fall speed-up', 1, 2.5, 0.05], ['cat.jumpMinHold', 'Tap rise (s)', 0, 0.3, 0.01],
    ['cat.coyote', 'Coyote (s)', 0, 0.3, 0.01], ['cat.buffer', 'Buffer (s)', 0, 0.3, 0.01], ['cat.jumpForward', 'Pounce boost', 0, 3, 0.1],
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

// ---- 11_game.js ----
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
  meta: { title: 'Rooftop Run', runtime: 'plethora-bit@2', tags: ['3d', 'endless', 'platformer'], permissions: ['haptics'] },

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

    const A = createAssets(THREE, renderer);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, ctx.width / ctx.height, 0.05, 400);
    const world = new World();
    const lab = buildLab(world);
    let shadows = true;
    const view = createScene(THREE, A, scene, world, lab, { small, shadows });
    const cat = new Cat(world);
    const rig = createCatRig(THREE, A);
    scene.add(rig.root);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), A.M.shadow);
    blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2; scene.add(blob);
    const cam = createFollowCamera(THREE, camera, world);
    const input = createInput(ctx, canvas, hud);

    // ---------- state ----------
    let mode = 'title', frozen = false, acc = 0, lap = 1, cpIdx = 0, best = 0, respawn = null, contextLost = false, hintT = 0;
    const frameEvents = [];
    const fps = { t: 0, n: 0, v: 0 };
    function haptic(kind) { try { if (caps.haptics) ctx.platform.haptic(kind); } catch (e) { } }

    function place(p, speed) {
      cat.reset(p, speed);
      const g = world.groundAt(p[0], p[2], p[1] + 0.5, 0.05, 0.05);
      if (g.box) { cat.pos[1] = g.y; cat.prev = cat.pos.slice(); cat.grounded = true; cat.ground = g.box; cat.lastGroundY = g.y; }
    }
    function resetLab() {
      lap = 1; cpIdx = 0; best = 0; respawn = null;
      place(lab.spawn, 0);
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
      if (hud.touchy) { hintT = 4; hud.hints(true); }
      try { ctx.platform.start({ phase: 'movement-lab' }); } catch (e) { }
    }
    function pause() {
      if (mode !== 'play') return;
      mode = 'paused'; input.clear(); input.state.enabled = false;
      hud.card('pause'); hud.hints(false);
    }
    function resume() { if (mode !== 'paused' || contextLost) return; mode = 'play'; input.state.enabled = true; hud.card(null); }
    function restart() {
      hud.panel(false); resetLab(); mode = 'paused'; resume(); if (mode !== 'play') return;
      try { ctx.platform.start({ phase: 'movement-lab', replay: true }); } catch (e) { }
    }
    const tap = (e, fn) => ctx.listen(e, 'click', ev => { ev.stopPropagation(); fn(ev); });
    tap(hud.H.go, begin); tap(hud.H.resume, resume); tap(hud.H.restart, restart);
    ctx.listen(hud.H.pauseBtn, 'pointerdown', e => { e.stopPropagation(); if (mode === 'play') pause(); else resume(); });
    ctx.listen(hud.H.labBtn, 'pointerdown', e => { e.stopPropagation(); hud.panel(!hud.panelOpen()); });
    ctx.listen(window, 'keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
      else if ((e.code === 'Enter' || e.code === 'Space') && mode === 'title' && !hud.H.go.disabled) begin();
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
          cam.reset();
        }
        if (respawn.done) { hud.fade(clamp(1 - (respawn.t - 0.24) / 0.3, 0, 1)); if (respawn.t > 0.54) { respawn = null; hud.fade(0); } }
        if (respawn && !respawn.done) { cat.step(dt, { steer: 0 }); cat.events.length = 0; return; }
      }
      const inp = input.sample(dt);
      cat.step(dt, inp);
      for (const e of cat.events) {
        frameEvents.push(e);
        if (e.type === 'jump') { try { ctx.platform.interact({ type: 'jump' }); } catch (er) { } }
        else if (e.type === 'land') { if (e.impact > 7) haptic('light'); }
        else if (e.type === 'bump' || e.type === 'scramble') haptic('medium');
        else if (e.type === 'fall' && !respawn) {
          respawn = { t: 0, at: lab.checkpoints[cpIdx] };
          try { ctx.platform.interact({ type: 'fall', at: Math.round(-cat.pos[2]) }); } catch (er) { }
        }
      }
      cat.events.length = 0;
      // checkpoints only advance on sound footing
      const next = lab.checkpoints[cpIdx + 1];
      if (next && cat.grounded && cat.pos[2] < next[2] && Math.abs(cat.pos[1] - next[1]) < 0.3) cpIdx++;
      best = Math.max(best, -cat.pos[2]);
      // the end of the lab: around again, without a menu
      if (cat.pos[2] < lab.endZ && !respawn) {
        lap++; cpIdx = 0; best = 0;
        respawn = { t: 0, at: lab.spawn };
        try { ctx.platform.milestone('lab_lap', { lap }); } catch (er) { }
      }
    }

    // ---------- render ----------
    const rs = { pos: [0, 0, 0], fwd: 0, vx: 0, vy: 0, grounded: true, crouch: 0, teeter: 0, edgeAhead: 0, narrow: 0, scr: null, stumble: 0, assistX: 0, sinceJump: 9, events: frameEvents };
    const camCat = { pos: rs.pos, vel: [0, 0, 0], fwd: 0, grounded: true, ground: null };
    function frame(dt) {
      const a = mode === 'play' ? clamp(acc / SIM_DT, 0, 1) : 1;
      for (let i = 0; i < 3; i++) rs.pos[i] = lerp(cat.prev[i], cat.pos[i], a);
      Object.assign(rs, { fwd: mode === 'title' ? 0 : cat.fwd, vx: cat.vel[0], vy: cat.vel[1], grounded: cat.grounded, crouch: cat.crouch, teeter: cat.teeter, edgeAhead: cat.edgeAhead, narrow: cat.narrow, scr: cat.scr ? clamp(cat.scr.t, 0, 1) : null, stumble: cat.stumble, assistX: cat.assistX, sinceJump: cat.sinceJump });
      rig.update(dt, rs);
      Object.assign(camCat, { vel: cat.vel, fwd: rs.fwd, grounded: cat.grounded, ground: cat.ground });
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
      hud.distance(Math.floor(Math.max(0, best)), lap);
      if (hintT > 0) { hintT -= dt; if (hintT <= 0 || input.state.stick) { hintT = 0; hud.hints(false); } }
      fps.t += dt; fps.n++; if (fps.t > 0.5) { fps.v = fps.n / fps.t; fps.t = 0; fps.n = 0; }
      if (hud.H.dbg.classList.contains('on')) {
        const j = cat.stats.lastJump, inf = renderer.info.render;
        hud.debug(`fps ${fps.v.toFixed(0)}  calls ${inf.calls}  tris ${(inf.triangles / 1000).toFixed(1)}k\n` +
          `speed ${cat.fwd.toFixed(2)}  vx ${cat.vel[0].toFixed(2)}  vy ${cat.vel[1].toFixed(2)}\n` +
          `${cat.grounded ? 'ground' : 'air'}${cat.crouch ? ' crouch' : ''}${cat.narrow > 0.5 ? ' narrow' : ''}${cat.scr ? ' scramble' : ''}  coyote ${cat.coyote.toFixed(2)}  buffer ${cat.buffer.toFixed(2)}\n` +
          `steer ${input.state.steer.toFixed(2)}  jump ${TUNING.input.jumpMode}${input.state.jumpHeld ? ' (held)' : ''}  grip ${cat.gripT.toFixed(2)}\n` +
          (j ? `last jump ${j.dist.toFixed(2)} m  rise ${j.rise.toFixed(2)} m  ${(j.air * 1000).toFixed(0)} ms` : 'last jump —'));
      }
      if (!contextLost) renderer.render(scene, camera);
    }

    // ---------- layout ----------
    function layout(w, h, a) {
      hud.layout(w, h, a);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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
      if (mode === 'play') {
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
        begin, pause, resume, restart, cat, world, lab, input, camera, renderer, cam, scene, TUNING,
        get mode() { return mode; },
        // drive the real loop deterministically: input = { steer, jump }
        advance(sec, inp) { if (inp !== undefined) input.state.virtual = inp; const n = Math.round(sec / SIM_DT); for (let i = 0; i < n && mode === 'play'; i++) step(SIM_DT); acc = 0; frame(SIM_DT); },
        frame: () => frame(SIM_DT),
        freeze(on) { frozen = on; },
        sim(inp) { input.state.virtual = inp; if (mode === 'play') step(SIM_DT); },
        warp(i) { place(lab.checkpoints[i], TUNING.cat.cruise); cpIdx = i; cam.reset(); frame(SIM_DT); }
      };
    }
  }
};

})();
