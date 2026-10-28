// THE LAST LIGHT ON THE STREET — a monochrome pursuit arcade for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// =====================================================================
// Small helpers shared by every system. World units are metres, y up,
// time in seconds unless a name says otherwise.
// =====================================================================
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sign = v => v < 0 ? -1 : 1;
const approach = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
const smooth = t => t * t * (3 - 2 * t);
const angNorm = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const deg = d => d * Math.PI / 180;

// Deterministic random, so the city is drawn the same way every visit.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  const f = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}

// Ray (ox,oy)+(dx,dy)*t against segment a-b. Returns t >= 0 or Infinity.
function raySeg(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = ax - ox, fy = ay - oy;
  const t = (fx * ey - fy * ex) / den;
  const u = (fx * dy - fy * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// ---- 01_level.js ----
// =====================================================================
// THE WATCHER'S STREET: the authored slice.
//
// Everything the player can stand on, hang from, climb or hide behind is
// declared here, and the same geometry blocks the Watcher's light. The
// façades behind the street are scenery only; they are drawn from the
// `facades` list and never collide.
//
// Kinds of thing:
//   solids   - boxes you collide with on every side (chimneys, the gate
//              block, crates, the cellar walls). They block light.
//   plats    - one-way slabs (balconies, roof edges, cornices). You land
//              on them from above, jump up through them, hang from their
//              front lip and shimmy along it. They block light.
//   pipes    - drainpipes you climb.
//   ropes    - a pulley rope you swing on.
//   awnings  - the signature mechanic: a cord folds an awning out; while
//              out it is a platform and it throws a shadow.
//   shutters - rolling iron shutters the Watcher lowers when it hunts.
//   recesses - doorways: stand in one and the light cannot reach you.
//   sheets   - laundry that sways and blocks light.
//   lights   - the Watcher's lamps.
// =====================================================================
function buildLevel() {
  const L = {
    solids: [], plats: [], pipes: [], ropes: [], awnings: [], shutters: [], recesses: [],
    sheets: [], lights: [], checkpoints: [], sections: [], facades: [], props: [], windows: [],
    x0: 0, x1: 150, exitX: 143.5, start: { x: 1.4, y: 9 }
  };
  const solid = (x0, y0, x1, y1, o) => { const s = Object.assign({ x0, y0, x1, y1, kind: 'block', grab: true, occ: true }, o); L.solids.push(s); return s; };
  const plat = (x0, x1, y, o) => { const p = Object.assign({ x0, x1, y, th: 0.32, kind: 'balcony', grab: true, occ: true }, o); L.plats.push(p); return p; };
  const pipe = (x, y0, y1, o) => { const p = Object.assign({ x, y0, y1 }, o); L.pipes.push(p); return p; };
  const facade = (x0, x1, h, style, o) => { const f = Object.assign({ x0, x1, h, style, seed: Math.round(x0 * 97 + h * 13) }, o); L.facades.push(f); return f; };
  const light = o => { const l = Object.assign({ half: deg(8), amp: 0, period: 6, phase: 0, range: 44, maxDev: deg(40), kind: 'tower', huntOnly: false, hold: 0 }, o); l.base = deg(o.base); l.amp = deg(o.amp || 0); if (o.half) l.half = deg(o.half); if (o.maxDev) l.maxDev = deg(o.maxDev); L.lights.push(l); return l; };
  const section = (x, name, num) => L.sections.push({ x, name, num });
  const checkpoint = (x, y, face) => L.checkpoints.push({ x, y, face: face || 1 });
  const recess = (x0, x1, h, y0) => { y0 = y0 || 0; const r = { x0, x1, y0, y1: y0 + (h || 2.3), open: 0 }; L.recesses.push(r); return r; };

  // the street, and the city's left edge
  solid(-12, -4, 160, 0, { kind: 'street', grab: false });
  solid(-12, 0, 0, 40, { kind: 'edge', grab: false, occ: false });
  solid(150, 0, 162, 40, { kind: 'edge', grab: false, occ: false });

  // ---------------------------------------------------------------
  // I. THE BALCONY. You begin in a balcony doorway. A searchlight on the
  // tower across the street sweeps the balcony and the street below; the
  // far balcony, under the overhanging roof, is in its shadow. Watch the
  // sweep, then run and jump while it is away. The cornice above is the
  // way on. Dropping to the street is loud, and the street is lit too.
  // ---------------------------------------------------------------
  section(0, 'The balcony', 'I');
  facade(-6, 12.4, 16.5, 'gable');
  plat(0.2, 7.2, 9, { rail: true });
  plat(8.8, 13.8, 9, { rail: true });
  recess(0.6, 2.2, 2.3, 9);
  pipe(8.0, 0, 9);
  plat(1.2, 5.2, 4.6, { rail: true });
  light({ x: 19.2, y: 21.5, base: 222, amp: 14, period: 5.2, phase: -1.2, half: 7.5, range: 34, kind: 'tower', maxDev: 30 });
  checkpoint(1.4, 9);

  // ---------------------------------------------------------------
  // II. FIRST CONTACT. Three ways along the terrace:
  //  - the roof: a lamp on the tall house ahead rakes it; chimneys throw
  //    long shadows. Fast, but you cross in rhythm.
  //  - under the roof's edge: hang and shimmy. Safe, but slow.
  //  - the street: two lanterns sweep it; dart between doorways.
  // ---------------------------------------------------------------
  section(13, 'First contact', 'II');
  facade(12.4, 20.2, 11.6, 'terrace');
  facade(20.2, 44.2, 11.6, 'long');
  plat(12.6, 44.2, 11.6, { kind: 'roof', th: 0.6, shimmy: true });
  solid(21.6, 11.6, 22.8, 13.8, { kind: 'chimney' });
  solid(28.0, 11.6, 29.4, 14.2, { kind: 'chimney' });
  solid(34.6, 11.6, 35.8, 13.6, { kind: 'chimney' });
  solid(40.0, 11.6, 40.9, 12.55, { kind: 'chimney', stub: true });
  light({ x: 47.4, y: 16.4, base: 197, amp: 10, period: 6.4, half: 7, range: 46, kind: 'bracket', maxDev: 30 });
  // the street beneath the terrace
  light({ x: 25.0, y: 6.9, base: 270, amp: 30, period: 4.6, half: 20, range: 9.5, kind: 'lantern', maxDev: 50 });
  light({ x: 36.0, y: 6.9, base: 270, amp: 30, period: 4.6, phase: Math.PI * 0.8, half: 20, range: 9.5, kind: 'lantern', maxDev: 50 });
  recess(19.4, 20.8);
  recess(29.8, 31.2);
  recess(41.0, 42.4);

  // ---------------------------------------------------------------
  // III. DESCENT. Under the lamp is the one place it cannot look. A
  // drainpipe runs down the tall house to the street; two balconies
  // offer a quicker way down.
  // ---------------------------------------------------------------
  section(44.2, 'Descent', 'III');
  facade(44.4, 60, 21, 'tall');
  pipe(44.9, 0, 11.6);
  plat(45.6, 49.2, 7.8, { rail: true });
  plat(45.6, 48.6, 4.2, { rail: true });
  checkpoint(46.6, 0);

  // ---------------------------------------------------------------
  // IV. THE AWNING. A lantern hangs over the street and swings its gaze
  // across it. The cord hangs in the open at the edge of its sweep: pull
  // while the lantern looks away. The awning unrolls under the lantern and
  // its shadow covers the cord and the crossing for a few seconds. The
  // pull is loud: the lantern turns to where you pulled it.
  // The high road (balconies) is exposed to a raking lamp instead.
  // ---------------------------------------------------------------
  section(50, 'The awning', 'IV');
  facade(60, 70, 14, 'shop');
  recess(52.6, 54.0, 2.4);
  const aw1 = { ax: 56.9, ay: 3.2, len: 6.6, dir: 1, cord: { x: 56.2, y: 0 }, holdS: 4.5 };
  L.awnings.push(aw1);
  L.props.push({ kind: 'pilaster', x: 56.85, top: 3.2 });
  light({ x: 60.4, y: 7.4, base: 270, amp: 18, period: 7.5, half: 30, range: 14, kind: 'lantern', maxDev: 55 });
  // the high road
  plat(51.6, 55.2, 8.4, { rail: true });
  recess(51.8, 53.2, 2.3, 8.4);
  plat(58.6, 63.4, 8.4, { rail: true, hook: 60.4 });
  plat(66.4, 70.4, 8.4, { rail: true });
  light({ x: 74.6, y: 13.2, base: 189, amp: 13, period: 5.6, phase: 1.3, half: 4, range: 24, kind: 'bracket', maxDev: 30 });
  pipe(70.0, 0, 8.4);
  recess(64.8, 66.2, 2.4);

  // ---------------------------------------------------------------
  // V. THE WATCHER RESPONDS. A gate passage with an iron shutter. When
  // the Watcher hunts or investigates nearby, the shutter comes down.
  // Slide under it, wait in a doorway until it lifts, or climb over the
  // gatehouse where another lamp sweeps.
  // ---------------------------------------------------------------
  section(71, 'The Watcher responds', 'V');
  facade(70, 80, 13, 'narrow');
  recess(74.2, 75.6, 2.4);
  solid(80, 2.7, 88, 11.8, { kind: 'gate', grabTop: true });
  L.shutters.push({ x0: 80.0, x1: 80.35, top: 2.7, y: 2.7, open: 2.7, reach: 36, delay: 0.5, speed: 0.48, lift: 1.1, wait: 0 });
  pipe(79.4, 0, 11.8);
  light({ x: 92.2, y: 17.6, base: 200, amp: 9, period: 5.6, phase: 2.0, half: 7, range: 21, kind: 'tower', maxDev: 34 });
  checkpoint(72.6, 0);

  // ---------------------------------------------------------------
  // VI. THE ESCAPE. A laundry court over an open cellar. Two lamps sweep
  // the court out of step; the sheets throw moving shade. Swing across on
  // the pulley rope, or drop into the cellar and climb out.
  // ---------------------------------------------------------------
  section(88.5, 'The escape', 'VI');
  facade(88, 96, 16, 'tall');
  facade(96, 110, 10, 'court');
  // cellar: cut the street between 99 and 106
  L.solids[0].x1 = 99;
  solid(106, -4, 160, 0, { kind: 'street', grab: false });
  solid(99, -4, 106, -3, { kind: 'cellar', grab: false });
  pipe(105.6, -3, 0);
  pipe(99.4, -3, 0);
  L.ropes.push({ ax: 102.6, ay: 9.2, len: 6.4 });
  for (let i = 0; i < 4; i++) L.sheets.push({ x: 100.2 + i * 2.4, y: 7.6, w: 1.1, h: 1.6 + (i % 2) * 0.4, phase: i * 1.7 });
  light({ x: 90.8, y: 15.4, base: 318, amp: 14, period: 6.2, half: 9, range: 30, kind: 'bracket', maxDev: 40 });
  light({ x: 115.6, y: 15.0, base: 224, amp: 14, period: 6.2, phase: Math.PI, half: 9, range: 30, kind: 'bracket', maxDev: 40 });
  recess(110.9, 112.4, 2.4);

  // ---------------------------------------------------------------
  // VII. THE LAST LIGHT. The street's last lamp stands on a post over the
  // final crossing. A second awning hangs above it, but its cord is up on
  // the balcony, in the path of a sweeping lamp. Pull it and drop, or
  // take the rooftops and time the sweep.
  // ---------------------------------------------------------------
  section(110, 'The last light', 'VII');
  facade(110, 120, 17, 'gable');
  facade(120, 134, 13, 'shop');
  facade(134, 142.6, 15, 'narrow');
  facade(142.6, 152, 14, 'gate');
  pipe(122.4, 0, 6.4);
  plat(121.8, 126.6, 6.4, { rail: true });
  const aw2 = { ax: 127.2, ay: 3.0, len: 8.2, dir: 1, cord: { x: 125.8, y: 6.4 }, holdS: 5.0 };
  L.awnings.push(aw2);
  L.props.push({ kind: 'pilaster', x: 127.15, top: 3.0 });
  light({ x: 131.0, y: 6.6, base: 270, amp: 0, half: 40, range: 11, kind: 'post' });
  light({ x: 118.4, y: 16.6, base: 302, amp: 9, period: 4.8, half: 5, range: 28, kind: 'tower', maxDev: 40 });
  plat(128.6, 141.6, 13, { kind: 'roof', th: 0.6 });
  pipe(127.9, 6.4, 13);
  light({ x: 146.4, y: 18.4, base: 190, amp: 5, period: 4.4, phase: 0.5, half: 5, range: 26, kind: 'tower', maxDev: 30 });
  recess(136.2, 137.6, 2.4);
  checkpoint(119.6, 0);
  L.props.push({ kind: 'lamppost', x: 131.0, y: 0, top: 6.6 });
  L.props.push({ kind: 'arch', x: 143.0 });

  // Every light remembers which sector it guards, for the Watcher's choice
  // of which lamps join a search.
  L.lights.forEach((l, i) => { l.id = i; l.ang = l.base; l.clock = l.phase * l.period / TAU; });
  L.sections.forEach((s, i) => { s.i = i; s.x1 = i + 1 < L.sections.length ? L.sections[i + 1].x : L.x1; });
  return L;
}

// ---- 02_player.js ----
// =====================================================================
// The runner: one continuous body. Run, brake, jump (variable height,
// coyote time, buffered presses), vault waist-high obstacles, slide and
// crouch, grab a ledge's lip and shimmy along it, pull up, climb pipes,
// swing on a rope and drop through balconies. Every state hands its
// momentum on to the next.
// =====================================================================
const MOVE = {
  run: 6.4, accel: 58, airAccel: 34, decel: 46, airDecel: 10, turn: 90,
  gUp: 31, gDown: 44, jumpH: 2.15, cut: 0.42, maxFall: 21,
  coyote: 0.1, buffer: 0.13, w: 0.5, h: 1.6, crouchH: 0.9, crouchRun: 2.3,
  slideMin: 4.0, slideFriction: 5.5, slideMax: 0.7,
  shimmy: 2.3, climbUp: 3.6, climbDown: 4.8, pullUp: 0.3,
  vaultMax: 1.15, stepMax: 0.36, ropePump: 4.2
};

function createPlayer(world, M) {
  M = M || MOVE;
  const P = {
    x: 0, y: 0, vx: 0, vy: 0, w: M.w, h: M.h, state: 'air', face: 1,
    ground: null, coyote: 0, buf: 0, jumping: false, dropT: 0, dropPlat: null, downT: 0,
    ledge: null, pipe: null, rope: null, rAng: 0, rW: 0, rLen: 0,
    climb: null, slideT: 0, crouch: false, coolLedge: 0, coolPipe: 0, coolRope: 0,
    run: 0, airT: 0, landK: 0, pullT: 0, vaultT: 0, stunT: 0, fallFrom: 0, events: []
  };
  const ev = (type, o) => P.events.push(Object.assign({ type }, o));

  P.reset = function (x, y, face) {
    Object.assign(P, { x, y, vx: 0, vy: 0, h: M.h, state: 'ground', face: face || 1, ground: null, coyote: 0, buf: 0, jumping: false,
      dropT: 0, dropPlat: null, downT: 0, ledge: null, pipe: null, rope: null, climb: null, slideT: 0, crouch: false,
      coolLedge: 0, coolPipe: 0, coolRope: 0, airT: 0, landK: 0, pullT: 0, vaultT: 0, stunT: 0, holdDown: false, fallFrom: y });
    P.events.length = 0;
    support();
    if (!P.ground) P.state = 'air';
  };
  P.box = (h) => ({ x0: P.x - P.w / 2, x1: P.x + P.w / 2, y0: P.y, y1: P.y + (h || P.h) });

  function hitSolid(b) {
    for (const s of world.solids()) if (rectsOverlap(b, s)) return s;
    return null;
  }
  function headroom(h) { return !hitSolid({ x0: P.x - P.w / 2 + 0.02, x1: P.x + P.w / 2 - 0.02, y0: P.y + 0.05, y1: P.y + h }); }

  // what is under the feet right now (solid top or one-way slab)
  function support() {
    let best = null, by = -Infinity;
    const x0 = P.x - P.w / 2 + 0.04, x1 = P.x + P.w / 2 - 0.04;
    for (const s of world.solids()) if (x1 > s.x0 && x0 < s.x1 && Math.abs(s.y1 - P.y) < 0.06 && s.y1 > by) { best = s; by = s.y1; }
    for (const p of world.plats()) if (p !== P.dropPlat && x1 > p.x0 && x0 < p.x1 && Math.abs(p.y - P.y) < 0.06 && p.y > by) { best = p; by = p.y; }
    P.ground = best;
    if (best) P.y = by;
    return best;
  }

  function moveX(dx) {
    P.x += dx;
    const b = P.box();
    for (const s of world.solids()) {
      if (!rectsOverlap(b, s)) continue;
      const rise = s.y1 - P.y;
      // step up kerbs and low sills without breaking stride
      if (P.state === 'ground' && rise > 0 && rise <= M.stepMax && headroom(P.h + rise)) { P.y = s.y1; continue; }
      // vault waist-high obstacles at running pace
      if (P.state === 'ground' && rise > M.stepMax && rise <= M.vaultMax && Math.abs(P.vx) > 2.6 && !P.crouch) {
        P.x -= dx;
        P.state = 'air'; P.ground = null; P.jumping = false;
        P.vy = Math.sqrt(2 * M.gUp * (rise + 0.32)); P.vaultT = 0.32; P.airT = 0;
        ev('vault', { x: P.x, y: P.y });
        return;
      }
      if (dx > 0) P.x = s.x0 - P.w / 2 - 1e-4; else if (dx < 0) P.x = s.x1 + P.w / 2 + 1e-4;
      else P.x = (P.x < (s.x0 + s.x1) / 2) ? s.x0 - P.w / 2 - 1e-4 : s.x1 + P.w / 2 + 1e-4;
      P.vx = 0; b.x0 = P.x - P.w / 2; b.x1 = P.x + P.w / 2;
    }
  }

  function moveY(dy) {
    const py = P.y;
    P.y += dy;
    const b = P.box();
    let landed = null;
    for (const s of world.solids()) {
      if (!rectsOverlap(b, s)) continue;
      if (dy < 0 && py >= s.y1 - 0.02) { P.y = s.y1; landed = s; }
      else if (dy > 0) { P.y = s.y0 - P.h - 1e-4; if (P.vy > 0) { P.vy = 0; ev('bonk', {}); } }
      else if (dy < 0) { P.y = s.y1; landed = s; }
      b.y0 = P.y; b.y1 = P.y + P.h;
    }
    if (dy < 0 && !landed) {
      for (const p of world.plats()) {
        if (p === P.dropPlat) continue;
        if (b.x1 - 0.04 > p.x0 && b.x0 + 0.04 < p.x1 && py >= p.y - 0.02 && P.y < p.y) { P.y = p.y; landed = p; }
      }
    }
    return landed;
  }

  function land(s) {
    const impact = -P.vy;
    P.state = 'ground'; P.ground = s; P.vy = 0; P.jumping = false; P.vaultT = 0;
    P.landK = clamp(impact / 18, 0, 1);
    // a long drop costs a stumble
    if (P.fallFrom - P.y > 5.5) { P.stunT = 0.4; P.vx *= 0.3; }
    ev('land', { v: impact, kind: s.kind, drop: P.fallFrom - P.y, x: P.x, y: P.y });
  }

  function tryJump(I) {
    if (P.buf > 0 && (P.state === 'ground' || P.coyote > 0)) {
      if (I.my < -0.5 && P.ground && P.ground.th !== undefined && P.state === 'ground') return dropThrough();
      if (P.crouch && !headroom(M.h)) return;
      P.state = 'air'; P.ground = null; P.coyote = 0; P.buf = 0; P.jumping = true; P.crouch = false; P.slideT = 0; P.h = M.h;
      P.vy = Math.sqrt(2 * M.gUp * M.jumpH); P.airT = 0; P.fallFrom = P.y;
      ev('jump', { x: P.x, y: P.y });
    }
  }
  function dropThrough() {
    P.dropPlat = P.ground; P.dropT = 0.32; P.state = 'air'; P.ground = null; P.buf = 0; P.vy = -1.5; P.fallFrom = P.y; P.coolLedge = 0.3;
    P.crouch = false; P.h = M.h;
    ev('drop', {});
  }

  function lowerToHang() {
    const p = P.ground;
    if (!p.grab) return dropThrough();
    P.crouch = false; P.slideT = 0; P.h = M.h;
    grabLedge({ y: p.y, x0: p.x0, x1: p.x1, plat: p, lip: true, side: 0, shimmy: true });
    P.dropPlat = p; P.dropT = 0.2;
    // the stick is still held down: let it come back before down means "let go"
    P.holdDown = true;
  }

  // ---------- grabbing ----------
  function findLedge(I) {
    if (P.coolLedge > 0 || I.my < -0.5 || P.vy > 1.4) return null;
    const hy = P.y + P.h + 0.12;
    for (const p of world.plats()) {
      if (!p.grab || p === P.dropPlat) continue;
      if (P.x < p.x0 - 0.12 || P.x > p.x1 + 0.12) continue;
      if (hy > p.y - 0.26 && hy < p.y + 0.34 && P.y + P.h < p.y + 0.28) {
        return { y: p.y, x0: p.x0, x1: p.x1, plat: p, lip: true, side: 0, shimmy: true };
      }
    }
    // the top corners of solid blocks, approached from the side
    for (const s of world.solids()) {
      if (!s.grab || s.kind === 'street') continue;
      if (hy < s.y1 - 0.26 || hy > s.y1 + 0.34) continue;
      if (Math.abs(P.x + P.w / 2 - s.x0) < 0.2 && (I.mx > 0.2 || P.face > 0)) return { y: s.y1, x0: s.x0, x1: s.x1, solid: s, side: -1, corner: true };
      if (Math.abs(P.x - P.w / 2 - s.x1) < 0.2 && (I.mx < -0.2 || P.face < 0)) return { y: s.y1, x0: s.x0, x1: s.x1, solid: s, side: 1, corner: true };
    }
    return null;
  }
  function grabLedge(l) {
    P.state = 'hang'; P.ledge = l; P.vx = 0; P.vy = 0; P.jumping = false; P.crouch = false; P.h = M.h; P.slideT = 0;
    P.y = l.y - P.h - 0.14;
    if (l.corner) { P.x = l.side < 0 ? l.x0 - P.w / 2 - 0.01 : l.x1 + P.w / 2 + 0.01; P.face = -l.side; }
    else P.x = clamp(P.x, l.x0 + 0.18, l.x1 - 0.18);
    ev('grab', { x: P.x, y: l.y, what: 'ledge' });
  }
  function findPipe(I, onGround) {
    if (P.coolPipe > 0) return null;
    for (const p of world.pipes()) {
      const dx = Math.abs(P.x - p.x);
      if (onGround) {
        if (dx > 0.5) continue;
        if (I.my > 0.5 && P.y >= p.y0 - 0.2 && P.y < p.y1 - 0.5) return { p, y: P.y };
        if (I.my < -0.5 && Math.abs(P.y - p.y1) < 0.2) return { p, y: p.y1 - P.h * 0.75 };
      } else {
        if (dx > 0.34 || I.my < -0.5 || P.vy > 4) continue;
        if (P.y + 0.6 >= p.y0 && P.y + 0.6 <= p.y1 - 0.2) return { p, y: P.y };
      }
    }
    return null;
  }
  function grabPipe(g) {
    P.state = 'pipe'; P.pipe = g.p; P.x = g.p.x; P.y = clamp(g.y, g.p.y0, g.p.y1 - 0.4); P.vx = 0; P.vy = 0;
    P.jumping = false; P.crouch = false; P.h = M.h; P.slideT = 0; P.climbPhase = 0;
    ev('grab', { x: P.x, y: P.y + 1, what: 'pipe' });
  }
  function ropeEnd(r) { return { x: r.ax + Math.sin(r.sway || 0) * r.len, y: r.ay - Math.cos(r.sway || 0) * r.len }; }
  function findRope() {
    if (P.coolRope > 0) return null;
    const hx = P.x, hy = P.y + P.h;
    for (const r of world.ropes()) {
      const e = ropeEnd(r);
      const ex = e.x - r.ax, ey = e.y - r.ay, l2 = ex * ex + ey * ey;
      const t = clamp(((hx - r.ax) * ex + (hy - r.ay) * ey) / l2, 0.25, 1);
      const cx = r.ax + ex * t, cy = r.ay + ey * t;
      if (Math.hypot(hx - cx, hy - cy) < 0.55) return r;
    }
    return null;
  }
  function grabRope(r) {
    const hx = P.x, hy = P.y + P.h;
    P.state = 'rope'; P.rope = r;
    P.rLen = clamp(Math.hypot(hx - r.ax, hy - r.ay), 1.6, r.len);
    P.rAng = Math.atan2(hx - r.ax, r.ay - hy);
    P.rW = (P.vx * Math.cos(P.rAng) + P.vy * Math.sin(P.rAng)) / P.rLen;
    P.jumping = false; P.crouch = false; P.h = M.h;
    ev('grab', { x: hx, y: hy, what: 'rope' });
  }

  // ---------- the step ----------
  P.update = function (dt, I) {
    P.coolLedge -= dt; P.coolPipe -= dt; P.coolRope -= dt; P.dropT -= dt; P.vaultT -= dt;
    if (P.dropT <= 0) P.dropPlat = null;
    if (I.jumpPressed) P.buf = M.buffer; else P.buf -= dt;
    P.landK = Math.max(0, P.landK - dt * 4);

    if (P.state === 'caught' || P.state === 'gone') return;
    if (P.state === 'pull') { P.pullT -= dt; P.vx = approach(P.vx, 0, M.decel * dt); if (P.pullT <= 0) P.state = 'ground'; return; }
    if (P.state === 'climbup') return stepClimbUp(dt);
    if (P.state === 'hang') return stepHang(dt, I);
    if (P.state === 'pipe') return stepPipe(dt, I);
    if (P.state === 'rope') return stepRope(dt, I);
    stepBody(dt, I);
  };

  function stepBody(dt, I) {
    const onG = P.state === 'ground';
    if (P.stunT > 0) { P.stunT -= dt; I = { mx: I.mx * 0.15, my: 0, jumpHeld: false }; P.buf = 0; }
    // crouch and slide
    const wantDown = I.my < -0.5;
    if (onG) {
      if (wantDown && P.slideT <= 0 && !P.crouch && Math.abs(P.vx) > M.slideMin) { P.slideT = M.slideMax; P.h = M.crouchH; ev('slide', { x: P.x }); }
      if (P.slideT > 0) {
        P.slideT -= dt; P.vx = approach(P.vx, 0, M.slideFriction * dt);
        if (P.slideT <= 0 || Math.abs(P.vx) < 1.4) { P.slideT = 0; P.crouch = true; }
      }
      if (P.slideT <= 0) {
        if (wantDown) P.crouch = true;
        else if (P.crouch && headroom(M.h)) P.crouch = false;
        P.h = P.crouch ? M.crouchH : M.h;
      }
      // hold down on a slab to lower yourself and hang from its lip
      if (wantDown && Math.abs(P.vx) < 1 && P.ground && P.ground.th !== undefined) { P.downT += dt; if (P.downT > 0.24) { P.downT = 0; lowerToHang(); return; } }
      else P.downT = 0;
    } else if (P.slideT > 0) { P.slideT = 0; P.crouch = false; }

    // horizontal
    if (P.slideT <= 0) {
      const max = (P.crouch && onG ? M.crouchRun : M.run) * Math.min(1, Math.abs(I.mx) * 1.25);
      const want = sign(I.mx) * max;
      if (Math.abs(I.mx) > 0.12) {
        P.face = sign(I.mx);
        const turning = P.vx * want < 0;
        const a = onG ? (turning ? M.turn : M.accel) : M.airAccel * (turning ? 1.4 : 1);
        P.vx = approach(P.vx, want, a * dt);
      } else P.vx = approach(P.vx, 0, (onG ? M.decel : M.airDecel) * dt);
    }

    // pipes from the ground
    if (onG) { const g = findPipe(I, true); if (g) { grabPipe(g); return; } }

    tryJump(I);

    if (P.state === 'air') {
      P.airT += dt;
      if (P.jumping && !I.jumpHeld && P.vy > 0) { P.vy *= M.cut; P.jumping = false; }
      const g = P.vy > 0 ? M.gUp : M.gDown;
      P.vy = Math.max(-M.maxFall, P.vy - g * dt);
      if (P.vy <= 0 && P.fallFrom < P.y) P.fallFrom = P.y;
    }

    moveX(P.vx * dt);
    if (P.state === 'air') {
      const landed = moveY(P.vy * dt);
      if (landed && P.vy <= 0) { land(landed); return; }
      // grabs in the air: ropes, then pipes, then ledges
      const r = findRope(); if (r) { grabRope(r); return; }
      const g = findPipe(I, false); if (g) { grabPipe(g); return; }
      const l = findLedge(I); if (l) { grabLedge(l); return; }
    } else {
      // walking off an edge
      if (!support()) { P.state = 'air'; P.coyote = M.coyote; P.vy = 0; P.fallFrom = P.y; P.jumping = false; P.airT = 0; if (P.slideT > 0) { P.slideT = 0; } if (P.crouch && headroom(M.h)) { P.crouch = false; P.h = M.h; } }
    }
    if (P.state === 'air') P.coyote -= dt;
    P.run += Math.abs(P.vx) * dt;
  }

  function stepHang(dt, I) {
    const l = P.ledge;
    // the slab may vanish under the hands (an awning folding away)
    if (l.plat && world.plats().indexOf(l.plat) < 0) { release(); return; }
    if (l.shimmy && Math.abs(I.mx) > 0.25) {
      P.face = sign(I.mx);
      const nx = clamp(P.x + sign(I.mx) * M.shimmy * Math.min(1, Math.abs(I.mx) * 1.3) * dt, l.x0 + 0.18, l.x1 - 0.18);
      const ox = P.x; P.x = nx;
      if (hitSolid(P.box())) P.x = ox;
      P.run += Math.abs(P.x - ox);
      P.vx = (P.x - ox) / dt;
    } else P.vx = 0;
    if (P.buf > 0) {
      P.buf = 0;
      if (I.my < -0.5) { release(); return; }
      if (l.corner && I.mx * l.side > 0.3) { P.state = 'air'; P.vx = l.side * 4.5; P.vy = 9.5; P.jumping = true; P.coolLedge = 0.35; P.ledge = null; ev('jump', { x: P.x, y: P.y }); return; }
      // a pull-up jump: up and over the lip
      return startClimb(true);
    }
    if (I.my > -0.3) P.holdDown = false;
    if (I.my > 0.5) return startClimb(false);
    if (I.my < -0.6 && !P.holdDown) release();
  }
  function release() { P.state = 'air'; P.ledge = null; P.vy = 0; P.coolLedge = 0.35; P.fallFrom = P.y; P.airT = 0; ev('release', {}); }
  function startClimb(quick) {
    const l = P.ledge;
    const tx = l.corner ? (l.side < 0 ? l.x0 + 0.4 : l.x1 - 0.4) : P.x;
    const ox = P.x, oy = P.y;
    P.x = tx; P.y = l.y;
    const blocked = hitSolid({ x0: P.x - P.w / 2 + 0.02, x1: P.x + P.w / 2 - 0.02, y0: P.y + 0.05, y1: P.y + M.h });
    P.x = ox; P.y = oy;
    if (blocked) return;
    P.state = 'climbup';
    P.climb = { x0: ox, y0: oy, x1: tx, y1: l.y, t: 0, dur: quick ? M.pullUp * 0.75 : M.pullUp, quick, ground: l.plat || l.solid };
    P.ledge = null;
    ev('pullup', { x: tx, y: l.y });
  }
  function stepClimbUp(dt) {
    const c = P.climb;
    c.t += dt / c.dur;
    const k = smooth(Math.min(1, c.t));
    P.x = lerp(c.x0, c.x1, Math.min(1, k * 1.4)); P.y = lerp(c.y0, c.y1, k);
    if (c.t >= 1) {
      P.x = c.x1; P.y = c.y1; P.state = 'ground'; P.ground = c.ground; P.vx = c.quick ? P.face * 2.5 : 0; P.climb = null;
      if (!support()) { P.state = 'air'; }
    }
  }

  function stepPipe(dt, I) {
    const p = P.pipe;
    if (Math.abs(I.mx) > 0.3) P.face = sign(I.mx);
    if (P.buf > 0) {
      P.buf = 0;
      P.state = 'air'; P.pipe = null; P.coolPipe = 0.35; P.jumping = true; P.airT = 0;
      P.vx = (Math.abs(I.mx) > 0.2 ? sign(I.mx) : P.face) * 5.2; P.vy = 9.2; P.fallFrom = P.y;
      ev('jump', { x: P.x, y: P.y });
      return;
    }
    const v = I.my > 0.3 ? M.climbUp * Math.min(1, I.my * 1.3) : I.my < -0.3 ? -M.climbDown * Math.min(1, -I.my * 1.3) : 0;
    P.vy = v;
    P.y += v * dt;
    P.climbPhase += Math.abs(v) * dt;
    // the top: step on to whatever is there
    if (P.y + P.h * 0.75 >= p.y1 && v > 0) {
      const tops = [];
      for (const q of world.plats()) if (Math.abs(q.y - p.y1) < 0.3 && P.x > q.x0 - 1.4 && P.x < q.x1 + 1.4) tops.push({ x: clamp(P.x, q.x0 + 0.3, q.x1 - 0.3), y: q.y, g: q });
      for (const s of world.solids()) if (Math.abs(s.y1 - p.y1) < 0.3 && P.x > s.x0 - 1.4 && P.x < s.x1 + 1.4) tops.push({ x: clamp(P.x, s.x0 + 0.3, s.x1 - 0.3), y: s.y1, g: s });
      tops.sort((a, b) => Math.abs(a.x - P.x + P.face * 0.01) - Math.abs(b.x - P.x + P.face * 0.01));
      if (tops.length) {
        const t = tops[0];
        P.state = 'climbup'; P.climb = { x0: P.x, y0: P.y, x1: t.x, y1: t.y, t: 0, dur: M.pullUp, ground: t.g }; P.pipe = null; P.face = sign(t.x - P.x) || P.face;
        ev('pullup', { x: t.x, y: t.y });
        return;
      }
      P.y = p.y1 - P.h * 0.75;
    }
    // the bottom: feet on the ground
    if (P.y <= p.y0 + 0.001 && v <= 0) {
      P.y = p.y0;
      if (support()) { P.state = 'ground'; P.pipe = null; P.coolPipe = 0.3; ev('land', { v: 1, kind: 'street', drop: 0, x: P.x, y: P.y }); }
    }
    if (Math.abs(I.mx) > 0.6 && I.my < 0.3 && I.my > -0.3) {
      // step off sideways
      P.state = 'air'; P.pipe = null; P.coolPipe = 0.4; P.vx = sign(I.mx) * 2.5; P.vy = 0; P.fallFrom = P.y; P.airT = 0;
    }
  }

  function stepRope(dt, I) {
    const r = P.rope, g = M.gDown * 0.72;
    if (P.buf > 0) {
      P.buf = 0;
      const vx = P.rLen * P.rW * Math.cos(P.rAng), vy = P.rLen * P.rW * Math.sin(P.rAng);
      P.state = 'air'; P.rope = null; P.coolRope = 0.45; P.jumping = true; P.airT = 0;
      P.vx = vx * 1.05; P.vy = Math.max(vy, 0) + 4.2; P.fallFrom = P.y;
      r.sway = P.rAng; r.swayW = P.rW * 0.6;
      ev('jump', { x: P.x, y: P.y, rope: true });
      return;
    }
    let a = -(g / P.rLen) * Math.sin(P.rAng);
    if (Math.abs(I.mx) > 0.2) { a += sign(I.mx) * M.ropePump / P.rLen * Math.cos(P.rAng); P.face = sign(I.mx); }
    P.rW += a * dt; P.rW *= 1 - 0.12 * dt;
    if (Math.abs(I.my) > 0.4) P.rLen = clamp(P.rLen - sign(I.my) * 1.8 * dt, 1.6, r.len);
    const oa = P.rAng, ox = P.x, oy = P.y;
    P.rAng = clamp(P.rAng + P.rW * dt, -1.35, 1.35);
    if (Math.abs(P.rAng) >= 1.35) P.rW *= -0.2;
    const hx = r.ax + Math.sin(P.rAng) * P.rLen, hy = r.ay - Math.cos(P.rAng) * P.rLen;
    P.x = hx; P.y = hy - P.h - 0.1;
    if (hitSolid(P.box())) { P.rAng = oa; P.rW *= -0.3; P.x = ox; P.y = oy; }
    r.sway = P.rAng;
    P.run += Math.abs(P.rW) * P.rLen * dt * 0.3;
    if (I.my < -0.6 && P.rLen >= r.len - 0.01 && Math.abs(P.rW) < 0.6) { P.state = 'air'; P.rope = null; P.coolRope = 0.5; P.vx = 0; P.vy = 0; P.fallFrom = P.y; }
  }

  P.startPull = function () { P.state = 'pull'; P.pullT = 0.38; ev('pull', { x: P.x }); };
  return P;
}

// ---- 03_light.js ----
// =====================================================================
// Light and shadow. One function decides both what is drawn and what the
// Watcher sees: a lamp's lit region is its visibility polygon, built by
// casting rays against the same occluding edges that `isLit` tests. If a
// slab, chimney, awning, shutter or sheet stands between you and a lamp,
// you are in its shadow, on screen and in the rules.
// =====================================================================
function createOptics(level) {
  const O = { stat: [], dyn: [] };
  const seg = (ax, ay, bx, by, src) => ({ ax, ay, bx, by, src });
  const rectSegs = (x0, y0, x1, y1, src, out) => {
    out.push(seg(x0, y0, x1, y0, src), seg(x1, y0, x1, y1, src), seg(x1, y1, x0, y1, src), seg(x0, y1, x0, y0, src));
  };
  for (const s of level.solids) if (s.occ) {
    if (s.kind === 'street' || s.kind === 'cellar') O.stat.push(seg(s.x0, s.y1, s.x1, s.y1, s), seg(s.x0, s.y0, s.x0, s.y1, s), seg(s.x1, s.y0, s.x1, s.y1, s));
    else rectSegs(s.x0, s.y0, s.x1, s.y1, s, O.stat);
  }
  for (const p of level.plats) if (p.occ) rectSegs(p.x0, p.y - p.th, p.x1, p.y, p, O.stat);

  // each lamp keeps the static edges that can matter to it
  for (const l of level.lights) {
    const R = l.range + 1;
    l.segs = O.stat.filter(s => Math.min(s.ax, s.bx) < l.x + R && Math.max(s.ax, s.bx) > l.x - R && Math.min(s.ay, s.by) < l.y + R && Math.max(s.ay, s.by) > l.y - R);
  }

  // moving occluders, rebuilt each step by the game
  O.setDynamic = function (list) { O.dyn = list; };

  function nearest(l, dx, dy, max) {
    let best = max;
    const segs = l.segs;
    for (let i = 0; i < segs.length; i++) { const s = segs[i]; const t = raySeg(l.x, l.y, dx, dy, s.ax, s.ay, s.bx, s.by); if (t < best) best = t; }
    const d = O.dyn;
    for (let i = 0; i < d.length; i++) { const s = d[i]; const t = raySeg(l.x, l.y, dx, dy, s.ax, s.ay, s.bx, s.by); if (t < best) best = t; }
    return best;
  }

  // Visibility polygon of a lamp within its cone. Returns a flat array
  // [x0,y0,x1,y1,...] starting at the lamp.
  O.polygon = function (l, out) {
    out = out || [];
    out.length = 0;
    const half = l.halfNow, a0 = l.ang - half, R = l.range;
    const rel = [];
    const pushRel = r => { if (r >= -half && r <= half) rel.push(r); };
    const add = (x, y) => { const r = angNorm(Math.atan2(y - l.y, x - l.x) - l.ang); pushRel(r - 1e-4); pushRel(r); pushRel(r + 1e-4); };
    const all = [l.segs, O.dyn];
    for (const list of all) for (const s of list) {
      const mx = Math.min(s.ax, s.bx), Mx = Math.max(s.ax, s.bx), my = Math.min(s.ay, s.by), My = Math.max(s.ay, s.by);
      if (mx > l.x + R || Mx < l.x - R || my > l.y + R || My < l.y - R) continue;
      add(s.ax, s.ay); add(s.bx, s.by);
    }
    const steps = Math.max(4, Math.ceil(half * 2 / deg(2.5)));
    for (let i = 0; i <= steps; i++) rel.push(-half + 2 * half * i / steps);
    rel.sort((a, b) => a - b);
    out.push(l.x, l.y);
    let last = -9;
    for (const r of rel) {
      if (r - last < 1e-6) continue;
      last = r;
      const a = l.ang + r, dx = Math.cos(a), dy = Math.sin(a);
      const t = nearest(l, dx, dy, R);
      out.push(l.x + dx * t, l.y + dy * t);
    }
    return out;
  };

  // Can lamp l see point (px,py)? Same edges, same cone, same range.
  O.sees = function (l, px, py) {
    const dx = px - l.x, dy = py - l.y, d = Math.hypot(dx, dy);
    if (d > l.range * 0.985) return false;
    if (Math.abs(angNorm(Math.atan2(dy, dx) - l.ang)) > l.halfNow) return false;
    return nearest(l, dx, dy, 1 - 1e-4) >= 1 - 1e-4;
  };
  return O;
}

// ---- 04_world.js ----
// =====================================================================
// The city's moving parts: awnings, the Watcher's shutters, doorways,
// laundry and the pulley rope. `world` is also the collision view the
// runner queries: static geometry plus whatever is out right now.
// =====================================================================
function createWorld(level) {
  const W = { level };
  const solids = level.solids.slice(), plats = level.plats.slice();
  const shutterBoxes = level.shutters.map(s => ({ x0: s.x0, x1: s.x1, y0: s.y, y1: s.top, kind: 'shutter', grab: false, occ: true, shutter: s }));
  for (const a of level.awnings) {
    a.t = 0; a.hold = 0; a.cool = 0; a.target = 0; a.shake = 0;
    a.plat = { x0: Math.min(a.ax, a.ax + a.dir * a.len), x1: Math.max(a.ax, a.ax + a.dir * a.len), y: a.ay - 0.14, th: 0.12, kind: 'awning', grab: true, occ: false, awning: a };
  }
  let activePlats = plats.slice(), activeSolids = solids.concat(shutterBoxes);
  W.solids = () => activeSolids;
  W.plats = () => activePlats;
  W.pipes = () => level.pipes;
  W.ropes = () => level.ropes;
  W.shutterBoxes = shutterBoxes;

  W.reset = function () {
    for (const a of level.awnings) { a.t = 0; a.hold = 0; a.cool = 0; a.target = 0; a.shake = 0; }
    for (const s of level.shutters) { s.y = s.open; s.wait = 0; s.closing = false; s.vel = 0; }
    for (const r of level.recesses) { r.open = 0; }
    for (const r of level.ropes) { r.sway = 0; r.swayW = 0; }
    rebuild();
  };

  // an awning unrolls from its roller along a shallow pitch: rolled at t = 0,
  // fully out over the street at t = 1
  W.awningAngle = a => deg(-2.5);
  W.awningExt = a => 0.05 + 0.95 * smooth(a.t);
  W.awningTip = a => { const ang = W.awningAngle(a), e = W.awningExt(a) * a.len; return { x: a.ax + a.dir * Math.cos(ang) * e, y: a.ay + Math.sin(ang) * e }; };

  W.pullAwning = function (a) {
    if (a.cool > 0) return false;
    a.target = 1; a.hold = a.holdS * (W.holdScale || 1); a.cool = 0.6;
    return true;
  };

  function rebuild() {
    activePlats = plats.slice();
    for (const a of level.awnings) if (a.t > 0.94) activePlats.push(a.plat);
    for (const b of shutterBoxes) b.y0 = b.shutter.y;
    activeSolids = solids.concat(shutterBoxes.filter(b => b.y1 - b.y0 > 0.02));
  }

  // occluding edges that move
  W.dynamicOccluders = function (out, time) {
    out.length = 0;
    for (const a of level.awnings) {
      if (a.t < 0.02) continue;
      const tip = W.awningTip(a);
      out.push({ ax: a.ax, ay: a.ay, bx: tip.x, by: tip.y, src: a });
    }
    for (const s of level.shutters) {
      if (s.top - s.y < 0.02) continue;
      out.push({ ax: s.x0, ay: s.y, bx: s.x1, by: s.y, src: s }, { ax: s.x0, ay: s.y, bx: s.x0, by: s.top, src: s }, { ax: s.x1, ay: s.y, bx: s.x1, by: s.top, src: s });
    }
    for (const sh of level.sheets) {
      const sw = W.sheetSway(sh, time);
      out.push({ ax: sh.x - sh.w / 2, ay: sh.y, bx: sh.x - sh.w / 2 + sw, by: sh.y - sh.h, src: sh }, { ax: sh.x + sh.w / 2, ay: sh.y, bx: sh.x + sh.w / 2 + sw, by: sh.y - sh.h, src: sh }, { ax: sh.x - sh.w / 2 + sw, ay: sh.y - sh.h, bx: sh.x + sh.w / 2 + sw, by: sh.y - sh.h, src: sh });
    }
    return out;
  };
  W.sheetSway = (sh, time) => Math.sin(time * 1.1 + sh.phase) * 0.32 + Math.sin(time * 2.3 + sh.phase * 2) * 0.08;

  // advance mechanisms; `watch` tells the shutters what the Watcher wants
  W.update = function (dt, player, watch, events) {
    for (const a of level.awnings) {
      a.cool -= dt;
      if (a.target === 1 && a.t >= 1) {
        a.hold -= dt;
        a.shake = a.hold < 1.6 ? 1 : 0;
        if (a.hold <= 0) { a.target = 0; events.push({ type: 'awningBack', a }); }
      }
      const was = a.t;
      a.t = approach(a.t, a.target, dt / (a.target ? 0.45 : 0.9));
      if (was < 1 && a.t >= 1) events.push({ type: 'awningOut', a });
    }
    for (const s of level.shutters) {
      const want = watch.closeShutter(s);
      if (want) { s.wait += dt; if (s.wait > s.delay && s.y > 0) { if (!s.closing) events.push({ type: 'shutterDown', s }); s.closing = true; s.y = Math.max(0, s.y - s.speed * dt); if (s.y <= 0 && s.closing) events.push({ type: 'shutterShut', s }); } }
      else {
        s.wait = Math.min(s.wait, s.delay);
        s.wait -= dt;
        if (s.wait < -s.lift && s.y < s.open) { if (s.closing) events.push({ type: 'shutterUp', s }); s.closing = false; s.y = Math.min(s.open, s.y + 0.9 * dt); }
      }
      // the shutter never closes on someone: it nudges them out from under it
      const b = player.box();
      if (b.x1 > s.x0 && b.x0 < s.x1 && b.y0 < s.top && b.y1 > s.y && player.state !== 'caught') {
        const left = player.x < (s.x0 + s.x1) / 2;
        player.x = left ? s.x0 - player.w / 2 - 0.01 : s.x1 + player.w / 2 + 0.01;
        if (player.state === 'ground' || player.state === 'air') player.vx = 0;
      }
    }
    for (const r of level.ropes) if (player.rope !== r) { r.swayW = (r.swayW || 0) - 7 / r.len * Math.sin(r.sway || 0) * dt; r.swayW *= 1 - 0.6 * dt; r.sway = (r.sway || 0) + r.swayW * dt; }
    for (const r of level.recesses) r.open = approach(r.open, watch.doorOpen(r) ? 1 : 0, dt / 1.4);
    rebuild();
  };

  // what the act button would do here
  W.interactable = function (player) {
    if (player.state !== 'ground') return null;
    for (const a of level.awnings) {
      if (Math.abs(player.x - a.cord.x) < 0.95 && Math.abs(player.y - a.cord.y) < 0.5) return { kind: 'cord', a, ready: a.cool <= 0 && a.target === 0 };
    }
    return null;
  };

  W.inRecess = function (player) {
    if (player.state !== 'ground' && player.state !== 'pull') return null;
    for (const r of level.recesses) if (player.x > r.x0 + 0.2 && player.x < r.x1 - 0.2 && Math.abs(player.y - r.y0) < 0.1) return r;
    return null;
  };
  W.reset();
  return W;
}

// ---- 05_watcher.js ----
// =====================================================================
// The Watcher. It is never shown; it is the city's lamps acting together.
//
// What it knows comes only from the lamps' light: a lamp sees you when a
// sample point on your silhouette (feet, knees, chest, head) is inside its
// visibility polygon, which is exactly the light drawn on screen.
//
// Exposure (what you feel)       Watcher mode (what it does)
//   HIDDEN    no lamp sees you      search       lamps follow their patterns
//   EXPOSED   suspicion rising      notice       the lamp hesitates, iris tightens
//                                   investigate  a noise gave it a place to look
//   DETECTED  suspicion full        track        lamps that can reach your last known
//                                                position turn to it; lock-on rises
//                                                while you are lit
//   HUNTING   it found you twice    hunt         faster lamps, shutters drop near your
//             or held you long                   last known position, doorways open
//   LOST      you broke its sight   (track/hunt) lamps sweep the last known area, not
//                                                where you are; it gives up in time
//   CAPTURED  lock-on full          capture
//
// Suspicion and lock-on both rise with how much of you is lit and fall only
// after a short grace period out of the light, so darting in and out of a
// beam does not reset them.
// =====================================================================
const WATCH = {
  notice: 0.9,        // seconds fully lit before it is sure (EXPOSED -> DETECTED)
  lock: 1.3,          // seconds fully lit while tracked before capture
  lockHunt: 0.95,     // the same during a hunt
  grace: 0.45,        // seconds out of the light before suspicion/lock begin to fall
  decayS: 0.5, decayL: 0.35,
  reacquire: 1.6,     // suspicion rises this much faster while it is already looking for you
  lostTrack: 5.0, lostHunt: 7.5, investigate: 4.2, huntHeat: 1.8, rehunt: 12,
  searchSpeed: deg(80), trackSpeed: deg(46), huntSpeed: deg(72),
  wobble: deg(7), lostWobble: deg(16), focusNarrow: 0.22
};

function createWatcher(level, optics, world, C) {
  C = C || WATCH;
  const W = { mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, unseen: 99, last: { x: 0, y: 0 }, seenFrac: 0, seers: [], modeT: 0,
    alarms: 0, hunts: 0, exposure: 0, calmMode: 'search', lastTrackEnd: -99, time: 0, events: [], hidden: false, litRun: 0, lastSeer: null, noiseT: -99, captureCtx: null };
  const ev = (type, o) => W.events.push(Object.assign({ type }, o));
  const tensionOf = { search: 0, investigate: 0.3, notice: 0.4, track: 0.7, hunt: 1, capture: 1 };

  W.reset = function () {
    Object.assign(W, { reacquired: false, mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, unseen: 99, seenFrac: 0, modeT: 0, calmMode: 'search', lastTrackEnd: -99, litRun: 0, lastSeer: null, noiseT: -99, captureCtx: null, last: { x: 0, y: 0 } });
    W.seers.length = 0; W.events.length = 0;
    for (const l of level.lights) { l.clock = l.phase * l.period / TAU; l.ang = patternAngle(l); l.focus = 0; l.halfNow = l.half; l.on = !l.huntOnly; l.seeing = false; l.engaged = false; }
  };
  W.tension = () => tensionOf[W.mode] || 0;
  // the player-facing exposure state
  W.exposureState = () => W.mode === 'capture' ? 'captured' : W.mode === 'hunt' ? (W.lost > 0.6 ? 'lost' : 'hunting') : W.mode === 'track' ? (W.lost > 0.6 ? 'lost' : 'detected') : W.mode === 'notice' ? 'exposed' : 'hidden';
  function setMode(m, o) { if (W.mode === m) return; const from = W.mode; W.mode = m; W.modeT = 0; ev(m, Object.assign({ from }, o)); }

  function patternAngle(l) { return l.base + (l.amp ? l.amp * Math.sin(TAU * l.clock / l.period) : 0); }
  const hunting = () => W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate';
  W.reaches = function (l, p) {
    const dx = p.x - l.x, dy = p.y + 0.8 - l.y;
    if (Math.hypot(dx, dy) > l.range * 0.96) return false;
    return Math.abs(angNorm(Math.atan2(dy, dx) - l.base)) <= l.maxDev + l.half * 0.5;
  };

  // A noise: somewhere to look. It does not reveal you, but it tells the
  // Watcher where to point its lamps.
  W.hear = function (x, y, what) {
    if (W.mode === 'capture') return;
    W.noiseT = W.time;
    if (W.mode === 'track' || W.mode === 'hunt') { if (W.seenFrac <= 0) { W.last = { x, y }; W.lost = Math.min(W.lost, 0.5); } return; }
    W.last = { x, y }; W.inv = C.investigate; W.calmMode = 'investigate';
    if (W.mode === 'search') setMode('investigate', { what });
    else if (W.mode === 'investigate') ev('investigate', { what, again: true });
  };

  W.closeShutter = s => (W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate' || (W.mode === 'notice' && W.calmMode === 'investigate')) && Math.abs(W.last.x - s.x0) < s.reach;
  W.doorOpen = r => W.mode === 'hunt' && W.modeT > 0.8 && W.last.x > r.x0 - 2.6 && W.last.x < r.x1 + 2.6 && Math.abs(W.last.y - r.y0) < 3;

  // silhouette sample heights, relative to the feet: feet, knees, chest, head
  const SAMPLE = [0.12, 0.4, 0.62, 0.92];

  W.update = function (dt, P, time) {
    W.time = time; W.modeT += dt;
    const speed = W.mode === 'hunt' ? C.huntSpeed : W.mode === 'track' || W.mode === 'investigate' ? C.trackSpeed : C.searchSpeed;
    // 1. aim the lamps
    for (const l of level.lights) {
      l.on = !l.huntOnly || W.mode === 'hunt';
      l.clock += dt * (l.seeing ? 0.22 : 1);
      let target = patternAngle(l);
      l.engaged = hunting() && W.reaches(l, W.last);
      if (l.engaged) {
        const to = Math.atan2(W.last.y + 0.8 - l.y, W.last.x - l.x);
        const rel = clamp(angNorm(to - l.base), -l.maxDev, l.maxDev);
        // seeing you: hold you; lost you: sweep the place it last saw you
        const wob = l.seeing ? 0 : (W.lost > 0.6 ? C.lostWobble : C.wobble) * Math.sin(time * (W.lost > 0.6 ? 1.7 : 2.2) + l.id * 1.7);
        target = l.base + rel + wob;
      }
      const d = angNorm(target - l.ang);
      l.ang += clamp(d, -speed * dt, speed * dt);
      l.halfNow = l.half * (1 - C.focusNarrow * l.focus);
    }
    // 2. what do they see?
    W.seers.length = 0;
    let frac = 0, best = null;
    const rec = world.inRecess(P);
    W.hidden = !!rec && rec.open < 0.6;
    if (P.state !== 'caught' && P.state !== 'gone') {
      for (const l of level.lights) {
        l.seeing = false;
        if (!l.on) continue;
        let n = 0;
        for (const k of SAMPLE) if (optics.sees(l, P.x, P.y + P.h * k)) n++;
        const f = W.hidden ? 0 : n / SAMPLE.length;
        if (f > 0) { l.seeing = true; W.seers.push(l); if (f > frac) { frac = f; best = l; } }
      }
      if (rec && rec.open >= 0.6) { frac = Math.max(frac, 1); best = best || { kind: 'door' }; }
    } else for (const l of level.lights) l.seeing = false;
    for (const l of level.lights) l.focus = approach(l.focus, l.seeing ? 1 : 0, dt * 3);
    W.seenFrac = frac;
    if (frac > 0) { W.exposure += frac * dt; W.unseen = 0; W.litRun += dt; W.lastSeer = best; }
    else { W.unseen += dt; W.litRun = 0; }
    const decaying = W.unseen > C.grace;

    // 3. the state of the hunt
    const seen = frac > 0;
    switch (W.mode) {
      case 'search':
      case 'investigate':
        if (W.mode === 'investigate') { W.inv -= dt; if (W.inv <= 0 && !seen) { W.calmMode = 'search'; setMode('search', { lost: true }); } }
        if (seen) { W.S += dt * frac / C.notice * (W.mode === 'investigate' ? C.reacquire : 1); W.calmMode = W.mode; setMode('notice'); }
        else if (decaying) W.S = Math.max(0, W.S - dt * C.decayS);
        break;
      case 'notice': {
        const fast = W.calmMode === 'investigate' || W.time - W.lastTrackEnd < C.rehunt;
        if (seen) W.S += dt * frac / C.notice * (fast ? C.reacquire : 1);
        else if (decaying) W.S -= dt * C.decayS;
        if (W.S >= 1) {
          W.S = 1; W.last = { x: P.x, y: P.y }; W.alarms++; W.heat = 0; W.lost = 0;
          if (W.time - W.lastTrackEnd < C.rehunt) { W.hunts++; setMode('hunt', { again: true }); } else setMode('track');
        } else if (W.S <= 0) { W.S = 0; setMode(W.calmMode === 'investigate' && W.inv > 0 ? 'investigate' : 'search', { settled: true }); }
        break;
      }
      case 'track':
      case 'hunt': {
        const hunt = W.mode === 'hunt';
        if (seen) {
          // found again after losing you: it hunts, and locks on faster
          if (W.lost > 0.6) { W.reacquired = true; ev('reacquire', {}); if (!hunt) { W.hunts++; setMode('hunt', { again: true }); } }
          W.last = { x: P.x, y: P.y }; W.L += dt * frac / (hunt ? C.lockHunt : C.lock); W.heat += dt * frac; W.lost = 0;
        } else { if (decaying) W.L = Math.max(0, W.L - dt * C.decayL); W.lost += dt; if (W.lost > 0.6 && W.lost - dt <= 0.6) ev('lost', {}); }
        if (W.L >= 1) {
          W.L = 1;
          W.captureCtx = { lamp: W.lastSeer, litRun: W.litRun, x: P.x, y: P.y, state: P.state, speed: Math.hypot(P.vx, P.vy), onAwning: !!(P.ground && P.ground.kind === 'awning'), door: !!(rec && rec.open >= 0.6), hunt: W.mode === 'hunt', reacquired: !!W.reacquired, sinceNoise: W.time - W.noiseT, heat: W.heat };
          setMode('capture', { x: P.x, y: P.y });
          break;
        }
        if (!hunt && W.heat >= C.huntHeat) { W.hunts++; setMode('hunt'); }
        if (W.lost >= (hunt ? C.lostHunt : C.lostTrack)) {
          W.S = 0; W.L = 0; W.heat = 0; W.reacquired = false; W.lastTrackEnd = W.time; W.calmMode = 'search';
          setMode('search', { lost: true });
        }
        break;
      }
    }
  };
  W.reset();
  return W;
}

// ---- 06_art.js ----
// =====================================================================
// The illustrated city. Every façade exists twice: as ink (the city at
// night) and as an engraving on paper (the city where the Watcher's light
// falls). The renderer draws the ink version, then the paper version
// clipped to the lamps' visibility polygons, so light reveals the
// engraving and shadow is the city's own black.
//
// Palette: ink #0d0d0c, night #1c1b19, stone line #3a3833, ambient glass
// #5f5b53 (grey: ordinary light is never white), paper #ece7dc. Only the
// Watcher's light is white.
// =====================================================================
const INK = '#0d0d0c', NIGHT = '#1c1b19', PAPER = '#ece7dc', PAPER2 = '#d9d3c6', STONE = '#3a3833', GLASS = '#47443e';

function facadeRoofH(f) { return f.style === 'gable' ? 3.6 : f.style === 'tall' ? 2.8 : f.style === 'narrow' ? 2.2 : f.style === 'gate' ? 1.4 : 0.9; }

// Draw one façade into a 2D context whose transform maps world metres
// (origin at the façade's bottom-left, y down from the roof) to pixels.
// `lit` chooses the engraving palette.
function drawFacade(g, f, s, lit) {
  const R = rng(f.seed), w = f.x1 - f.x0, H = f.h;
  const base = lit ? PAPER : NIGHT, line = lit ? 'rgba(26,24,21,0.62)' : STONE, deep = lit ? 'rgba(20,18,16,0.9)' : '#121110';
  const roofH = facadeRoofH(f);
  const Y = y => (H + roofH - y) * s; // world y (from street) to canvas y
  const X = x => x * s;
  g.lineCap = 'butt';
  // body
  g.fillStyle = base;
  g.fillRect(0, Y(H), X(w), H * s + 1);
  // roof silhouette
  g.beginPath();
  if (f.style === 'gable') { g.moveTo(X(-0.2), Y(H)); g.lineTo(X(w * 0.48), Y(H + roofH)); g.lineTo(X(w * 0.56), Y(H + roofH - 0.2)); g.lineTo(X(w + 0.2), Y(H)); }
  else if (f.style === 'tall') { g.moveTo(X(-0.1), Y(H)); g.lineTo(X(0.9), Y(H + roofH)); g.lineTo(X(w - 1.4), Y(H + roofH + 0.3)); g.lineTo(X(w + 0.1), Y(H)); }
  else if (f.style === 'narrow') { g.moveTo(X(0), Y(H)); g.lineTo(X(w * 0.3), Y(H + roofH)); g.lineTo(X(w * 0.38), Y(H + roofH + 0.6)); g.lineTo(X(w * 0.44), Y(H + roofH)); g.lineTo(X(w), Y(H + 0.4)); g.lineTo(X(w), Y(H)); }
  else { g.moveTo(X(0), Y(H)); g.lineTo(X(0), Y(H + roofH * 0.5)); g.lineTo(X(w), Y(H + roofH * 0.62)); g.lineTo(X(w), Y(H)); }
  g.closePath(); g.fillStyle = lit ? PAPER2 : '#151413'; g.fill();
  // roof tiles: slanted hatching
  g.save(); g.clip();
  g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.02);
  for (let x = -roofH * 2; x < w + roofH * 2; x += 0.22) { g.beginPath(); g.moveTo(X(x), Y(H)); g.lineTo(X(x + roofH * 0.7), Y(H + roofH + 1)); g.stroke(); }
  g.restore();
  // decorative chimney pots on pitched roofs, leaning a little (Caligari)
  if (f.style !== 'long' && f.style !== 'terrace' && f.style !== 'court') {
    const n = R.int(1, 2);
    for (let i = 0; i < n; i++) {
      const cx = R.range(0.15, 0.8) * w, lean = R.range(-0.12, 0.12), ch = R.range(1.6, 2.6);
      const by = f.style === 'gable' ? H + roofH * (1 - Math.abs(cx / w - 0.5) * 2) - 0.3 : H + roofH * 0.5;
      g.fillStyle = lit ? '#cfc8b9' : '#141312';
      g.beginPath(); g.moveTo(X(cx - 0.35), Y(by - 0.4)); g.lineTo(X(cx - 0.3 + lean * ch), Y(by + ch)); g.lineTo(X(cx + 0.3 + lean * ch), Y(by + ch)); g.lineTo(X(cx + 0.35), Y(by - 0.4)); g.fill();
      g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.025);
      for (let y = by; y < by + ch; y += 0.25) { g.beginPath(); g.moveTo(X(cx - 0.32 + lean * (y - by)), Y(y)); g.lineTo(X(cx + 0.32 + lean * (y - by)), Y(y)); g.stroke(); }
    }
  }
  // ashlar courses
  g.strokeStyle = line; g.lineWidth = Math.max(0.5, s * 0.018);
  const course = 0.36;
  for (let y = course; y < H; y += course) {
    g.globalAlpha = lit ? 0.42 : 0.55;
    g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(X(w), Y(y)); g.stroke();
    const off = R.range(0, 1.1);
    g.beginPath();
    for (let x = off; x < w; x += R.range(0.8, 1.4)) { g.moveTo(X(x), Y(y)); g.lineTo(X(x), Y(y - course)); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // storeys: cornice bands and windows
  const storey = 3, bays = Math.max(1, Math.round(w / 2.3)), bw = w / bays;
  const shear = R.range(-0.05, 0.05);
  for (let k = 0; k * storey + 0.2 < H - 1.2; k++) {
    const y0 = k * storey;
    // cornice band with dentils and the shade beneath it
    if (k > 0) {
      g.fillStyle = lit ? '#c9c2b2' : '#262522';
      g.fillRect(0, Y(y0 + 0.22), X(w), 0.22 * s);
      g.fillStyle = deep;
      for (let x = 0.1; x < w; x += 0.32) g.fillRect(X(x), Y(y0), 0.14 * s, 0.1 * s);
      g.strokeStyle = line; g.lineWidth = Math.max(0.5, s * 0.016);
      for (let i = 0; i < 5; i++) { g.globalAlpha = (lit ? 0.5 : 0.7) * (1 - i / 5); g.beginPath(); g.moveTo(0, Y(y0 - 0.06 - i * 0.07)); g.lineTo(X(w), Y(y0 - 0.06 - i * 0.07)); g.stroke(); }
      g.globalAlpha = 1;
    }
    const shop = (f.style === 'shop' || f.style === 'terrace') && k === 0;
    if (f.style === 'gate' && k === 0) continue;
    for (let b = 0; b < bays; b++) {
      const cx = (b + 0.5) * bw;
      if (k === 0 && !shop && R.chance(0.35)) {
        // a door
        const dw = 1.1, dh = 2.3;
        drawOpening(g, X, Y, cx - dw / 2, y0, dw, dh, true, lit, line, deep, R, 0);
        continue;
      }
      const ww = shop ? Math.min(bw - 0.5, 2.0) : R.range(0.85, 1.1), wh = shop ? 2.1 : R.range(1.6, 2.0);
      const wy = y0 + (shop ? 0.5 : 0.75);
      if (wy + wh > H - 0.4) continue;
      drawOpening(g, X, Y, cx - ww / 2, wy, ww, wh, false, lit, line, deep, R, shear, shop);
    }
  }
  // quoins at the corners
  g.fillStyle = lit ? '#d2cbbd' : '#232220';
  for (let y = 0; y < H - 0.3; y += 0.6) { g.fillRect(0, Y(y + 0.55), (y / 0.6) % 2 ? 0.35 * s : 0.55 * s, 0.5 * s); g.fillRect(X(w) - ((y / 0.6) % 2 ? 0.35 : 0.55) * s, Y(y + 0.55), ((y / 0.6) % 2 ? 0.35 : 0.55) * s, 0.5 * s); }
  // soot: vertical streaks of weathering
  g.strokeStyle = lit ? 'rgba(30,28,24,0.18)' : 'rgba(0,0,0,0.25)';
  for (let i = 0; i < w * 1.4; i++) { const x = R.range(0, w); g.lineWidth = R.range(0.5, 2); g.beginPath(); g.moveTo(X(x), Y(R.range(H * 0.4, H))); g.lineTo(X(x + R.range(-0.05, 0.05)), Y(R.range(0, H * 0.4))); g.stroke(); }
  // eaves line
  g.fillStyle = lit ? INK : '#0b0b0a';
  g.fillRect(-1, Y(H) - 1, X(w) + 2, Math.max(2, 0.12 * s));
  // gate: the arch of the passage
  if (f.style === 'gate') {
    g.fillStyle = deep;
    g.beginPath(); g.moveTo(X(w * 0.12), Y(0)); g.lineTo(X(w * 0.12), Y(3.4)); g.quadraticCurveTo(X(w * 0.5), Y(6.4), X(w * 0.88), Y(3.4)); g.lineTo(X(w * 0.88), Y(0)); g.fill();
    g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.03);
    for (let i = 0; i < 9; i++) { const t = i / 8, ax = lerp(w * 0.12, w * 0.88, t); g.beginPath(); g.moveTo(X(ax), Y(3.4 + Math.sin(t * Math.PI) * 3)); g.lineTo(X(lerp(w * 0.04, w * 0.96, t)), Y(3.9 + Math.sin(t * Math.PI) * 3.4)); g.stroke(); }
  }
}

function drawOpening(g, X, Y, x, y, w, h, door, lit, line, deep, R, shear, shop) {
  const arched = !shop && R.chance(0.5);
  const sh = shear * h;
  const path = () => {
    g.beginPath();
    g.moveTo(X(x), Y(y)); g.lineTo(X(x + w), Y(y));
    if (arched) { g.lineTo(X(x + w + sh), Y(y + h - w / 2)); g.arc(X(x + w / 2 + sh), Y(y + h - w / 2), (w / 2) * (X(1) - X(0)), 0, Math.PI, true); }
    else { g.lineTo(X(x + w + sh), Y(y + h)); g.lineTo(X(x + sh), Y(y + h)); }
    g.closePath();
  };
  // frame
  g.fillStyle = lit ? '#cdc5b5' : '#2d2b28';
  g.fillRect(X(x - 0.12), Y(y + h + 0.18), (w + 0.24) * (X(1) - X(0)), (h + 0.2) * (X(1) - X(0)));
  // ordinary lamplight in some rooms: grey, never white
  const warm = !door && !lit && R.chance(shop ? 0.4 : 0.13);
  path(); g.fillStyle = door ? deep : warm ? GLASS : lit ? '#2a2723' : '#0c0c0b'; g.fill();
  const S = X(1) - X(0);
  g.save(); path(); g.clip();
  if (door) {
    g.strokeStyle = line; g.lineWidth = Math.max(0.5, S * 0.02);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(X(x + w * i / 4), Y(y)); g.lineTo(X(x + w * i / 4), Y(y + h)); g.stroke(); }
  } else {
    // glazing bars
    g.strokeStyle = lit ? 'rgba(236,231,220,0.55)' : warm ? '#3e3b35' : '#22211f';
    g.lineWidth = Math.max(0.6, S * 0.035);
    g.beginPath(); g.moveTo(X(x + w / 2 + sh / 2), Y(y)); g.lineTo(X(x + w / 2 + sh / 2), Y(y + h)); g.stroke();
    for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(X(x), Y(y + h * i / 3)); g.lineTo(X(x + w + sh), Y(y + h * i / 3)); g.stroke(); }
    if (warm) { g.fillStyle = 'rgba(20,19,17,0.8)'; g.fillRect(X(x + w * R.range(0.1, 0.5)), Y(y + h * 0.75), w * 0.35 * S, h * 0.75 * S); }
  }
  g.restore();
  // shutters, folded open beside the window, with louvres
  if (!door && !shop && R.chance(0.6)) {
    const sw = w * 0.5;
    for (const side of [-1, 1]) {
      const sx = side < 0 ? x - sw - 0.08 : x + w + 0.08;
      g.fillStyle = lit ? '#bdb5a4' : '#232220';
      g.fillRect(X(sx), Y(y + h), sw * S, h * S);
      g.strokeStyle = lit ? 'rgba(20,18,16,0.6)' : '#141312'; g.lineWidth = Math.max(0.5, S * 0.02);
      for (let yy = y + 0.12; yy < y + h; yy += 0.13) { g.beginPath(); g.moveTo(X(sx), Y(yy)); g.lineTo(X(sx + sw), Y(yy)); g.stroke(); }
    }
  }
  // sill
  g.fillStyle = lit ? INK : '#0a0a09';
  g.fillRect(X(x - 0.18), Y(y) - 1, (w + 0.36) * S, Math.max(2, 0.1 * S));
}

// Distant city: Caligari's leaning towers, cut from grey card.
function makeSkyline(seed, x0, x1, par) {
  const R = rng(seed), out = [];
  let x = x0;
  while (x < x1) {
    const w = R.range(2.5, 6.5), h = R.range(9, 26) * (par < 0.5 ? 1.15 : 0.85), lean = R.range(-0.18, 0.18);
    const kind = R.pick(['spire', 'block', 'gable', 'block', 'tower', 'crane']);
    const win = [];
    for (let i = 0; i < R.int(0, 5); i++) win.push({ x: R.range(0.2, 0.8), y: R.range(0.2, 0.8), on: R.chance(0.6), k: R.range(0, 1) });
    out.push({ x, w, h, lean, kind, win, seed: R.int(1, 1e6) });
    x += w * R.range(0.55, 1.05);
  }
  return out;
}

// ---- 07_render.js ----
// =====================================================================
// The renderer: a layered stage in Canvas2D.
//   sky and moon · far and middle skyline (parallax) · the Watcher's
//   shadow · ink façades · light (haze, then the paper engraving clipped
//   to every lamp's visibility polygon) · doorways · the playable
//   architecture · lit edges · the runner · wires · grain and vignette.
// =====================================================================
function createRenderer(canvas, level, world, optics, watcher, makeSurface) {
  const g = canvas.getContext('2d');
  // Offscreen caches are hidden SDK surfaces, pooled and reused.
  const free = [];
  const take = (w, h) => { const c = free.pop() || makeSurface(); c.width = w; c.height = h; return c; };
  const give = c => { if (c) { c.width = c.height = 1; free.push(c); } };
  const R = { cam: { x: level.start.x, yb: -0.6, s: 30, vx: 0 }, W: 1, H: 1, yBase: 1, q: 1, flash: 0, shake: 0, debug: false };
  const fac = new Map();
  const far = makeSkyline(11, -40, level.x1 * 0.3 + 60, 0.25), mid = makeSkyline(29, -30, level.x1 * 0.55 + 50, 0.55);
  const polys = new Map();
  let sky = null, vign = null;
  const scarf = [];

  R.layout = function (W, H, dpr, area, controlsH) {
    R.W = W; R.H = H; R.dpr = dpr; R.area = area;
    R.q = Math.min(dpr || 1, 1.5);
    const top = area.top + 92, bottom = H - area.bottom - controlsH;
    const s = Math.min(W / 13, (bottom - top) / 13.5);
    R.cam.s = clamp(s, 14, 64);
    R.yBase = bottom - 0.2 * R.cam.s;
    R.focusTop = top;
    R.viewM = (R.yBase - top) / R.cam.s;
    for (const v of fac.values()) { give(v.dark); give(v.lit); }
    fac.clear(); give(sky); sky = null; vign = null;
  };
  const X = wx => (wx - R.cam.x) * R.cam.s + R.W / 2;
  const Y = wy => R.yBase - (wy - R.cam.yb) * R.cam.s;
  R.X = X; R.Y = Y;
  R.toWorld = (sx, sy) => ({ x: (sx - R.W / 2) / R.cam.s + R.cam.x, y: (R.yBase - sy) / R.cam.s + R.cam.yb });

  R.follow = function (P, dt, snap) {
    const s = R.cam.s, halfW = R.W / 2 / s;
    const tx = clamp(P.x + P.face * 1.4 + P.vx * 0.22, level.x0 + halfW - 2, level.x1 - halfW + 1);
    // keep the runner in the lower-middle of the frame, never lose the street
    const ty = Math.max(-0.6, P.y + 1.2 - R.viewM * 0.58);
    if (snap) { R.cam.x = tx; R.cam.yb = ty; R.cam.vx = 0; return; }
    const k = 1 - Math.exp(-dt * 4.2);
    R.cam.x += (tx - R.cam.x) * k;
    const dy = ty - R.cam.yb;
    R.cam.yb += dy * (1 - Math.exp(-dt * (Math.abs(dy) > 2 ? 4 : 2.2)));
  };

  function facadeCanvas(f) {
    let c = fac.get(f);
    // the host may resize a surface; a cache that lost its pixels is redrawn
    if (c && c.dark.width === c.pw && c.lit.width === c.pw) return c;
    if (c) { give(c.dark); give(c.lit); fac.delete(f); }
    const s = R.cam.s * R.q, roof = facadeRoofH(f), w = f.x1 - f.x0, h = f.h + roof + 0.3;
    const mk = lit => {
      const cv = take(Math.ceil(w * s), Math.ceil(h * s));
      const cg = cv.getContext('2d');
      cg.translate(0, 0.3 * s);
      drawFacade(cg, f, s, lit);
      return cv;
    };
    // forget façades well off screen before making more
    const halfW = R.W / 2 / R.cam.s + 4;
    for (const [k, v] of fac) if (k.x1 < R.cam.x - halfW || k.x0 > R.cam.x + halfW) { give(v.dark); give(v.lit); fac.delete(k); }
    c = { dark: mk(false), lit: mk(true), roof, w, h };
    c.pw = c.dark.width;
    fac.set(f, c);
    return c;
  }
  function visibleFacades() {
    const halfW = R.W / 2 / R.cam.s + 1;
    return level.facades.filter(f => f.x1 > R.cam.x - halfW && f.x0 < R.cam.x + halfW);
  }
  function drawFacades(list, lit) {
    const s = R.cam.s;
    for (const f of list) {
      const c = facadeCanvas(f);
      g.drawImage(lit ? c.lit : c.dark, X(f.x0), Y(f.h + c.roof + 0.3), c.w * s, c.h * s);
    }
  }

  // -------------------------------------------------------------- sky
  function makeSky() {
    const W = R.W, H = R.H, c = take(Math.ceil(W * R.q), Math.ceil(H * R.q));
    const sg = c.getContext('2d'); sg.scale(R.q, R.q);
    const gr = sg.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#6c6963'); gr.addColorStop(0.55, '#8e8a82'); gr.addColorStop(1, '#a6a197');
    sg.fillStyle = gr; sg.fillRect(0, 0, W, H);
    // engraved sky: fine horizontal rules, denser toward the top
    sg.strokeStyle = 'rgba(30,28,25,0.22)'; sg.lineWidth = 0.7;
    for (let y = 0; y < H; y += 2.6 + y / H * 3.2) { sg.beginPath(); sg.moveTo(0, y); sg.lineTo(W, y + 0.6); sg.stroke(); }
    // clouds: wavy rules
    const r = rng(7);
    sg.strokeStyle = 'rgba(30,28,25,0.28)';
    for (let i = 0; i < 6; i++) {
      const cy = r.range(0.06, 0.4) * H, cx = r.range(0, W), cw = r.range(0.4, 0.9) * W;
      for (let k = 0; k < 9; k++) { sg.beginPath(); for (let x = -cw / 2; x < cw / 2; x += 6) { const yy = cy + k * 3 + Math.sin((x + k * 9) * 0.03) * 4 * (1 - Math.abs(x) / cw * 2); x === -cw / 2 ? sg.moveTo(cx + x, yy) : sg.lineTo(cx + x, yy); } sg.stroke(); }
    }
    // paper grain, baked in once
    const gc = take(128, 128); const gg = gc.getContext('2d'); const id = gg.createImageData(128, 128); const r2 = rng(5);
    for (let i = 0; i < id.data.length; i += 4) { const v = r2() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gg.putImageData(id, 0, 0);
    sg.globalAlpha = 0.07; sg.fillStyle = sg.createPattern(gc, 'repeat'); sg.fillRect(0, 0, W, H); sg.globalAlpha = 1;
    give(gc);
    c.pw = c.width;
    return c;
  }
  function drawMoon() {
    const r = Math.min(R.W, R.H) * 0.075, cx = R.W * 0.8 - R.cam.x * R.cam.s * 0.012, cy = R.focusTop + R.H * 0.2;
    g.fillStyle = '#c9c4b8'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
    g.strokeStyle = 'rgba(40,38,34,0.35)'; g.lineWidth = 0.8;
    for (let y = -r; y < r; y += 3) { g.beginPath(); g.moveTo(cx - r + Math.max(0, y) * 0.4 + r * 0.55, cy + y); g.lineTo(cx + r, cy + y); g.stroke(); }
    g.restore();
  }

  // -------------------------------------------------------------- skyline
  function drawSkyline(list, par, scale, col, winCol, lift) {
    const s = R.cam.s * scale, base = Y(0) - lift * R.cam.s;
    g.fillStyle = col;
    const ox = R.W / 2 - R.cam.x * par * s / scale * scale;
    for (const b of list) {
      const x0 = ox + b.x * s, x1 = x0 + b.w * s;
      if (x1 < -40 || x0 > R.W + 40) continue;
      const h = b.h * s, ln = b.lean * h;
      g.beginPath();
      g.moveTo(x0, base + 10);
      if (b.kind === 'spire') { g.lineTo(x0 + ln * 0.6, base - h * 0.7); g.lineTo(x0 + b.w * s * 0.5 + ln, base - h * 1.15); g.lineTo(x1 + ln * 0.6, base - h * 0.7); }
      else if (b.kind === 'gable') { g.lineTo(x0 + ln * 0.8, base - h * 0.8); g.lineTo(x0 + b.w * s * 0.3 + ln, base - h); g.lineTo(x1 + ln * 0.8, base - h * 0.74); }
      else if (b.kind === 'tower') { g.lineTo(x0 + ln, base - h); g.lineTo(x0 + b.w * s * 0.2 + ln, base - h * 1.08); g.lineTo(x1 - b.w * s * 0.2 + ln, base - h * 1.08); g.lineTo(x1 + ln, base - h); }
      else if (b.kind === 'crane') { g.lineTo(x0 + ln, base - h * 0.6); g.lineTo(x0 + ln + b.w * s * 0.2, base - h * 0.6); g.lineTo(x0 + ln + b.w * s * 0.2, base - h * 1.1); g.lineTo(x1 + b.w * s * 0.8 + ln, base - h * 1.05); g.lineTo(x1 + b.w * s * 0.8 + ln, base - h * 1.0); g.lineTo(x1 + ln, base - h * 1.02); g.lineTo(x1 + ln * 0.5, base - h * 0.6); }
      else { g.lineTo(x0 + ln, base - h); g.lineTo(x1 + ln, base - h * 0.92); }
      g.lineTo(x1, base + 10);
      g.closePath(); g.fill();
      if (winCol) {
        for (const w of b.win) if (w.on || R.hunt > 0.5 && w.k < R.hunt) {
          const wx = x0 + (b.w * w.x) * s + ln * (w.y), wy = base - h * w.y;
          g.fillStyle = w.on ? winCol : '#b9b4a8';
          g.fillRect(wx, wy, Math.max(1.5, 0.35 * s), Math.max(2, 0.55 * s));
        }
        g.fillStyle = col;
      }
    }
  }

  // The Watcher's shadow: a tall hat and a long coat drifting across the far
  // houses toward where it last saw you. Never more than a shape.
  function drawWatcherShade(t) {
    const k = R.shade;
    if (k < 0.02) return;
    const s = R.cam.s * 0.55, base = Y(0) - 3 * R.cam.s;
    const cx = R.W / 2 + (R.shadeX - R.cam.x * 0.3) * s;
    const h = 30 * s;
    g.save();
    g.globalAlpha = k * 0.55;
    g.fillStyle = '#2c2a26';
    g.beginPath();
    const sway = Math.sin(t * 0.7) * 0.4 * s;
    g.moveTo(cx - 4.5 * s, base + 10);
    g.lineTo(cx - 2.2 * s + sway, base - h * 0.62);
    g.lineTo(cx - 1.6 * s + sway, base - h * 0.8);
    g.lineTo(cx - 1.0 * s + sway, base - h * 0.84);
    g.lineTo(cx - 1.1 * s + sway, base - h * 0.88);
    g.lineTo(cx - 2.6 * s + sway, base - h * 0.885);
    g.lineTo(cx - 2.4 * s + sway, base - h * 0.9);
    g.lineTo(cx - 1.0 * s + sway, base - h * 0.905);
    g.lineTo(cx - 0.9 * s + sway, base - h * 1.0);
    g.lineTo(cx + 1.3 * s + sway, base - h * 1.0);
    g.lineTo(cx + 1.4 * s + sway, base - h * 0.905);
    g.lineTo(cx + 2.8 * s + sway, base - h * 0.9);
    g.lineTo(cx + 2.9 * s + sway, base - h * 0.885);
    g.lineTo(cx + 1.4 * s + sway, base - h * 0.88);
    g.lineTo(cx + 1.3 * s + sway, base - h * 0.84);
    g.lineTo(cx + 2.4 * s + sway, base - h * 0.8);
    g.lineTo(cx + 3.6 * s + sway, base - h * 0.6);
    g.lineTo(cx + 5.5 * s, base + 10);
    g.closePath(); g.fill();
    g.restore();
  }

  // -------------------------------------------------------------- light
  function lampVisible(l) {
    const halfW = R.W / 2 / R.cam.s + 2;
    return l.on && l.x + l.range > R.cam.x - halfW && l.x - l.range < R.cam.x + halfW;
  }
  function beamPath(list) {
    g.beginPath();
    for (const p of list) { g.moveTo(X(p[0]), Y(p[1])); for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Y(p[i + 1])); g.closePath(); }
  }

  // -------------------------------------------------------------- geometry
  function railing(p) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.06 * s);
    const top = p.y + 0.95;
    g.beginPath(); g.moveTo(X(p.x0 + 0.05), Y(top)); g.lineTo(X(p.x1 - 0.05), Y(top)); g.stroke();
    g.lineWidth = Math.max(0.8, 0.035 * s);
    g.beginPath();
    for (let x = p.x0 + 0.1; x < p.x1 - 0.05; x += 0.16) { g.moveTo(X(x), Y(p.y)); g.lineTo(X(x), Y(top)); }
    g.stroke();
    // a scroll every bay
    g.beginPath();
    for (let x = p.x0 + 0.5; x < p.x1 - 0.4; x += 1.1) { g.moveTo(X(x + 0.18), Y(p.y + 0.5)); g.arc(X(x), Y(p.y + 0.5), 0.18 * s, 0, TAU); }
    g.stroke();
  }
  function drawPlat(p) {
    const s = R.cam.s;
    g.fillStyle = INK;
    g.fillRect(X(p.x0), Y(p.y), (p.x1 - p.x0) * s, p.th * s);
    if (p.kind === 'balcony') {
      // corbels beneath
      for (let x = p.x0 + 0.3; x < p.x1 - 0.1; x += 1.4) {
        g.beginPath(); g.moveTo(X(x - 0.12), Y(p.y - p.th)); g.lineTo(X(x + 0.12), Y(p.y - p.th)); g.lineTo(X(x + 0.04), Y(p.y - p.th - 0.55)); g.lineTo(X(x - 0.04), Y(p.y - p.th - 0.55)); g.fill();
      }
      if (p.rail) railing(p);
    } else if (p.kind === 'roof') {
      // coping stones
      g.fillStyle = '#191817';
      for (let x = p.x0; x < p.x1; x += 0.9) g.fillRect(X(x) + 1, Y(p.y) + 2, 0.86 * s - 2, Math.max(1, p.th * s * 0.35));
    }
    // the walkable edge: a paper hairline
    g.fillStyle = 'rgba(236,231,220,0.75)';
    g.fillRect(X(p.x0), Y(p.y) - 0.5, (p.x1 - p.x0) * s, Math.max(1, 0.03 * s));
  }
  function drawSolid(b) {
    const s = R.cam.s;
    if (b.kind === 'edge' || b.kind === 'shutter') return;
    if (b.kind === 'street' || b.kind === 'cellar') {
      g.fillStyle = INK;
      g.fillRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s + (b.kind === 'street' ? R.H : 0));
      // cobbles: rows of small arcs
      g.strokeStyle = '#2b2a27'; g.lineWidth = Math.max(0.8, 0.03 * s);
      const xa = Math.max(b.x0, R.cam.x - R.W / 2 / s - 1), xb = Math.min(b.x1, R.cam.x + R.W / 2 / s + 1);
      for (let row = 0; row < 3; row++) {
        g.beginPath();
        const yy = b.y1 - 0.12 - row * 0.22, off = (row % 2) * 0.17;
        for (let x = Math.floor(xa / 0.34) * 0.34 + off; x < xb; x += 0.34) { g.moveTo(X(x), Y(yy)); g.quadraticCurveTo(X(x + 0.17), Y(yy + 0.16), X(x + 0.32), Y(yy)); }
        g.stroke();
      }
      g.fillStyle = 'rgba(236,231,220,0.7)';
      g.fillRect(X(b.x0), Y(b.y1) - 0.5, (b.x1 - b.x0) * s, Math.max(1, 0.03 * s));
      return;
    }
    g.fillStyle = INK;
    g.fillRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
    if (b.kind === 'chimney') {
      // brick courses and a pot
      g.strokeStyle = '#262522'; g.lineWidth = Math.max(0.7, 0.025 * s);
      g.beginPath(); for (let y = b.y0 + 0.25; y < b.y1; y += 0.25) { g.moveTo(X(b.x0), Y(y)); g.lineTo(X(b.x1), Y(y)); } g.stroke();
      g.fillStyle = INK;
      if (!b.stub) { const cx = (b.x0 + b.x1) / 2; g.fillRect(X(cx - 0.18), Y(b.y1 + 0.5), 0.36 * s, 0.5 * s); g.fillRect(X(b.x0 - 0.08), Y(b.y1), (b.x1 - b.x0 + 0.16) * s, 0.14 * s); }
    } else if (b.kind === 'gate') {
      g.strokeStyle = '#25241f'; g.lineWidth = Math.max(0.7, 0.025 * s);
      g.beginPath();
      for (let y = b.y0 + 0.5; y < b.y1; y += 0.5) { g.moveTo(X(b.x0), Y(y)); g.lineTo(X(b.x1), Y(y)); }
      g.stroke();
      // the passage's mouth: voussoirs over the shutter
      g.fillStyle = '#1b1a18';
      for (let i = 0; i < 7; i++) g.fillRect(X(b.x0 + 0.1 + i * 0.32), Y(b.y0 + 0.9 - Math.sin(i / 6 * Math.PI) * 0.4), 0.26 * s, 0.6 * s);
      // a carved eye over the gate: the city watches
      const ex = (b.x0 + b.x1) / 2, ey = b.y0 + 5.2;
      g.strokeStyle = '#3c3a35'; g.lineWidth = Math.max(1, 0.06 * s);
      g.beginPath(); g.moveTo(X(ex - 1.2), Y(ey)); g.quadraticCurveTo(X(ex), Y(ey + 0.9), X(ex + 1.2), Y(ey)); g.quadraticCurveTo(X(ex), Y(ey - 0.9), X(ex - 1.2), Y(ey)); g.stroke();
      g.beginPath(); g.arc(X(ex), Y(ey), 0.3 * s, 0, TAU); g.stroke();
    } else if (b.kind === 'pillar') {
      g.fillStyle = '#1e1d1b'; g.fillRect(X(b.x0 + 0.08), Y(b.y1 - 0.2), (b.x1 - b.x0 - 0.16) * s, (b.y1 - b.y0 - 0.4) * s);
    }
    if (b.kind !== 'pillar') { g.fillStyle = 'rgba(236,231,220,0.7)'; g.fillRect(X(b.x0), Y(b.y1) - 0.5, (b.x1 - b.x0) * s, Math.max(1, 0.03 * s)); }
  }
  function drawPipe(p) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(2, 0.13 * s); g.lineCap = 'butt';
    g.beginPath(); g.moveTo(X(p.x), Y(p.y0)); g.lineTo(X(p.x), Y(p.y1 + 0.2)); g.stroke();
    // hopper at the top, collars on the way down: small paper ticks say "climbable"
    g.fillStyle = INK; g.fillRect(X(p.x - 0.16), Y(p.y1 + 0.35), 0.32 * s, 0.3 * s);
    g.fillStyle = 'rgba(236,231,220,0.8)';
    for (let y = p.y0 + 0.6; y < p.y1; y += 1.2) g.fillRect(X(p.x - 0.11), Y(y), 0.22 * s, Math.max(1, 0.04 * s));
  }
  function drawAwning(a) {
    const s = R.cam.s, tip = world.awningTip(a), ang = world.awningAngle(a);
    const shake = a.shake ? Math.sin(R.t * 38) * 0.035 : 0;
    const ext = Math.hypot(tip.x - a.ax, tip.y - a.ay);
    // bracket arms from the wall
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.05 * s);
    g.beginPath(); g.moveTo(X(a.ax), Y(a.ay - 1.0)); g.lineTo(X(lerp(a.ax, tip.x, 0.55)), Y(lerp(a.ay, tip.y, 0.55))); g.stroke();
    // striped canvas, one stripe every 0.5 m of what has unrolled
    if (ext > 0.3) {
      const n = Math.max(1, Math.round(ext / 0.5));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const ax = lerp(a.ax, tip.x, t0), ay = lerp(a.ay, tip.y, t0) + shake * t0, bx = lerp(a.ax, tip.x, t1), by = lerp(a.ay, tip.y, t1) + shake * t1;
        g.fillStyle = i % 2 ? '#45423d' : INK;
        g.beginPath(); g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.lineTo(X(bx), Y(by - 0.13)); g.lineTo(X(ax), Y(ay - 0.13)); g.fill();
      }
      // scalloped valance
      g.fillStyle = INK;
      const vx = tip.x, vy = tip.y + shake;
      g.beginPath(); g.moveTo(X(vx), Y(vy)); g.lineTo(X(vx), Y(vy - 0.42));
      for (let i = 1; i <= 4; i++) g.quadraticCurveTo(X(vx - a.dir * (i - 0.5) * 0.2), Y(vy - 0.56), X(vx - a.dir * i * 0.2), Y(vy - 0.42));
      g.lineTo(X(vx - a.dir * 0.8), Y(vy)); g.fill();
      g.fillStyle = 'rgba(236,231,220,0.75)'; g.fillRect(Math.min(X(a.ax), X(tip.x)), Y(Math.max(a.ay, tip.y)) - 0.5, Math.abs(X(tip.x) - X(a.ax)), Math.max(1, 0.03 * s));
    }
    // the roller
    g.fillStyle = INK; g.beginPath(); g.arc(X(a.ax + a.dir * 0.1), Y(a.ay - 0.05), (0.2 + 0.12 * (1 - a.t)) * s, 0, TAU); g.fill();
    g.strokeStyle = '#45423d'; g.lineWidth = Math.max(1, 0.04 * s); g.beginPath(); g.arc(X(a.ax + a.dir * 0.1), Y(a.ay - 0.05), (0.1 + 0.08 * (1 - a.t)) * s, 0, TAU); g.stroke();
    // the cord, with a paper toggle so it reads as something to pull
    const cy = a.cord.y + 1.15;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.03 * s);
    g.beginPath(); g.moveTo(X(a.ax + a.dir * 0.1), Y(a.ay - 0.2)); g.lineTo(X(a.cord.x), Y(cy + 0.25)); g.stroke();
    g.fillStyle = a.cool > 0 || a.target ? '#7d786e' : PAPER;
    g.fillRect(X(a.cord.x - 0.07), Y(cy + 0.25), 0.14 * s, 0.28 * s);
  }
  function drawShutter(sh) {
    const s = R.cam.s;
    if (sh.top - sh.y < 0.01) return;
    g.fillStyle = '#24231f';
    g.fillRect(X(sh.x0 - 0.05), Y(sh.top), (sh.x1 - sh.x0 + 0.1) * s, (sh.top - sh.y) * s);
    g.strokeStyle = INK; g.lineWidth = Math.max(0.7, 0.03 * s);
    g.beginPath(); for (let y = sh.y + 0.12; y < sh.top; y += 0.12) { g.moveTo(X(sh.x0 - 0.05), Y(y)); g.lineTo(X(sh.x1 + 0.05), Y(y)); } g.stroke();
    // a hard paper edge on the descending bar: watch it
    g.fillStyle = PAPER; g.fillRect(X(sh.x0 - 0.06), Y(sh.y + 0.06), (sh.x1 - sh.x0 + 0.12) * s, Math.max(1.5, 0.06 * s));
  }
  function drawSheet(sh, lit) {
    const s = R.cam.s, sw = world.sheetSway(sh, R.t);
    g.fillStyle = lit ? PAPER2 : '#5c5850';
    g.beginPath();
    g.moveTo(X(sh.x - sh.w / 2), Y(sh.y));
    g.lineTo(X(sh.x + sh.w / 2), Y(sh.y));
    g.quadraticCurveTo(X(sh.x + sh.w / 2 + sw * 0.6), Y(sh.y - sh.h * 0.5), X(sh.x + sh.w / 2 + sw), Y(sh.y - sh.h));
    for (let i = 4; i >= 0; i--) g.lineTo(X(sh.x - sh.w / 2 + sw + sh.w * i / 4), Y(sh.y - sh.h - (i % 2) * 0.06));
    g.quadraticCurveTo(X(sh.x - sh.w / 2 + sw * 0.6), Y(sh.y - sh.h * 0.5), X(sh.x - sh.w / 2), Y(sh.y));
    g.fill();
    g.strokeStyle = 'rgba(13,13,12,0.6)'; g.lineWidth = Math.max(0.6, 0.025 * s);
    g.beginPath(); for (let i = 1; i < 4; i++) { const fx = sh.x - sh.w / 2 + sh.w * i / 4; g.moveTo(X(fx), Y(sh.y)); g.quadraticCurveTo(X(fx + sw * 0.5), Y(sh.y - sh.h * 0.5), X(fx + sw), Y(sh.y - sh.h)); } g.stroke();
    // pegs
    g.fillStyle = INK; g.fillRect(X(sh.x - sh.w / 2 + 0.1), Y(sh.y + 0.08), 0.06 * s, 0.18 * s); g.fillRect(X(sh.x + sh.w / 2 - 0.16), Y(sh.y + 0.08), 0.06 * s, 0.18 * s);
  }
  function drawLines() {
    // the laundry line and the pulley rope's beam
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.03 * s);
    if (level.sheets.length) {
      const a = level.sheets[0], b = level.sheets[level.sheets.length - 1];
      g.beginPath(); g.moveTo(X(a.x - 2.2), Y(a.y + 0.6)); g.quadraticCurveTo(X((a.x + b.x) / 2), Y(a.y - 0.25), X(b.x + 2.2), Y(a.y + 0.6)); g.stroke();
    }
    for (const r of level.ropes) {
      g.lineWidth = Math.max(2, 0.12 * s);
      g.beginPath(); g.moveTo(X(r.ax - 3), Y(r.ay + 0.25)); g.lineTo(X(r.ax + 3), Y(r.ay + 0.25)); g.stroke();
      g.fillStyle = INK; g.beginPath(); g.arc(X(r.ax), Y(r.ay), 0.22 * s, 0, TAU); g.fill();
      g.fillStyle = PAPER; g.beginPath(); g.arc(X(r.ax), Y(r.ay), 0.07 * s, 0, TAU); g.fill();
      const held = R.P && R.P.rope === r;
      const ang = held ? R.P.rAng : (r.sway || 0), L = held ? R.P.rLen : r.len;
      const ex = r.ax + Math.sin(ang) * L, ey = r.ay - Math.cos(ang) * L;
      g.lineWidth = Math.max(1.2, 0.045 * s);
      g.beginPath(); g.moveTo(X(r.ax), Y(r.ay)); g.lineTo(X(ex), Y(ey));
      if (held && L < r.len - 0.1) { const rest = r.len - L; g.lineTo(X(ex - Math.sin(ang) * 0.2), Y(ey - rest)); }
      g.stroke();
      if (!held) { g.fillStyle = PAPER; g.fillRect(X(ex) - 2, Y(ey) - 2, 4, 6); }
    }
  }
  function drawRecess(r) {
    const s = R.cam.s, b = r.y0, h = r.y1 - b;
    g.fillStyle = '#050505';
    g.beginPath(); g.moveTo(X(r.x0), Y(b)); g.lineTo(X(r.x0), Y(r.y1 - 0.5)); g.quadraticCurveTo(X((r.x0 + r.x1) / 2), Y(r.y1 + 0.3), X(r.x1), Y(r.y1 - 0.5)); g.lineTo(X(r.x1), Y(b)); g.fill();
    if (r.open > 0.01) {
      // a door swings open and the room behind it is lit: the doorway is no longer a hiding place
      const w = (r.x1 - r.x0 - 0.3) * r.open;
      g.fillStyle = PAPER;
      g.fillRect(X(r.x0 + 0.15), Y(r.y1 - 0.6), w * s, (h - 0.6) * s);
      g.globalAlpha = 0.18 * r.open; g.beginPath(); g.moveTo(X(r.x0 + 0.15), Y(b)); g.lineTo(X(r.x0 + 0.15 + w), Y(b)); g.lineTo(X(r.x0 + 0.15 + w * 2.4), Y(b - 0.1)); g.lineTo(X(r.x0 - 0.6), Y(b - 0.1)); g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = INK; g.lineWidth = Math.max(1.5, 0.08 * s);
    g.beginPath(); g.moveTo(X(r.x0 - 0.05), Y(b)); g.lineTo(X(r.x0 - 0.05), Y(r.y1 - 0.5)); g.quadraticCurveTo(X((r.x0 + r.x1) / 2), Y(r.y1 + 0.35), X(r.x1 + 0.05), Y(r.y1 - 0.5)); g.lineTo(X(r.x1 + 0.05), Y(b)); g.stroke();
    g.fillStyle = 'rgba(236,231,220,0.5)'; g.fillRect(X(r.x0 - 0.2), Y(b + 0.04), (r.x1 - r.x0 + 0.4) * s, Math.max(1, 0.03 * s));
  }

  // The Watcher's attention, drawn where it matters. Around the runner an
  // aperture closes while any lamp has them: dashed while exposed, solid
  // with lock-on marks once detected. Where it searches after losing them,
  // a faint dashed ring marks its last known position.
  function drawAttention(P) {
    const s = R.cam.s, m = watcher.mode, st = watcher.exposureState();
    const cx = X(P.x), cy = Y(P.y + P.h * 0.55);
    const tracked = m === 'track' || m === 'hunt';
    const k = tracked ? 0.45 + 0.55 * watcher.L : m === 'notice' ? watcher.S * 0.45 : 0;
    R.ap = approach(R.ap || 0, k, 0.06);
    const lit = watcher.seenFrac > 0, lostYou = tracked && watcher.lost > 0.6;
    R.apA = approach(R.apA || 0, lit ? 0.9 : lostYou ? 0.12 : 0.45, 0.05);
    if (R.ap > 0.02 && (lit || tracked || m === 'notice')) {
      const r = lerp(2.6, 0.75, R.ap) * s;
      g.save();
      g.strokeStyle = PAPER; g.globalAlpha = R.apA; g.lineWidth = tracked ? 2 : 1.3;
      if (!tracked) g.setLineDash([4, 5]);
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      g.setLineDash([]);
      if (tracked) {
        const n = m === 'hunt' ? 6 : 4, tick = (m === 'hunt' ? 0.5 : 0.35) * s, rot = m === 'hunt' ? R.t * 1.4 : 0;
        g.beginPath();
        for (let i = 0; i < n; i++) { const a = rot + i * TAU / n; g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r - tick), cy + Math.sin(a) * (r - tick)); }
        g.stroke();
      }
      g.restore();
    }
    // it is searching somewhere else
    if (tracked && watcher.lost > 0.6) {
      const lx = X(watcher.last.x), ly = Y(watcher.last.y + 0.8), r = (1.5 + 0.15 * Math.sin(R.t * 3)) * s;
      g.save(); g.strokeStyle = PAPER; g.globalAlpha = 0.55 + 0.2 * Math.sin(R.t * 5); g.lineWidth = 1.6; g.setLineDash([3, 6]);
      g.beginPath(); g.arc(lx, ly, r, 0, TAU); g.stroke();
      g.setLineDash([]); g.beginPath(); g.moveTo(lx - 0.2 * s, ly); g.lineTo(lx + 0.2 * s, ly); g.moveTo(lx, ly - 0.2 * s); g.lineTo(lx, ly + 0.2 * s); g.stroke();
      g.restore();
    }
    // being lit: the edges of the page whiten a little
    R.litGlow = approach(R.litGlow || 0, lit ? watcher.seenFrac : 0, 0.08);
    if (R.litGlow > 0.01) {
      const W = R.W, H = R.H;
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
      gr.addColorStop(0, 'rgba(236,231,220,0)'); gr.addColorStop(1, 'rgba(236,231,220,' + (0.22 * R.litGlow).toFixed(3) + ')');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
  }
  // Capture: the light closes on the runner like an iris.
  function drawCaptureIris() {
    const c = R.capture; if (!c) return;
    const k = clamp(c.t / 0.75, 0, 1), W = R.W, H = R.H;
    const cx = X(c.x), cy = Y(c.y + 0.9);
    const rMax = Math.hypot(W, H);
    const r = lerp(rMax, 0.9 * R.cam.s, smooth(Math.min(1, k * 1.15)));
    g.save();
    g.fillStyle = 'rgba(236,231,220,' + (0.55 + 0.4 * k).toFixed(3) + ')';
    g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, r, 0, TAU, true); g.fill('evenodd');
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.restore();
  }

  function drawLamp(l) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = Math.max(1.5, 0.08 * s);
    if (l.kind === 'tower') {
      const f = level.facades.find(f => l.x >= f.x0 && l.x <= f.x1);
      const base = f ? f.h : 0;
      g.lineWidth = Math.max(1, 0.05 * s);
      g.beginPath(); g.moveTo(X(l.x - 0.7), Y(base)); g.lineTo(X(l.x - 0.12), Y(l.y - 0.3)); g.moveTo(X(l.x + 0.7), Y(base)); g.lineTo(X(l.x + 0.12), Y(l.y - 0.3));
      for (let y = base + 0.8; y < l.y - 0.4; y += 1.1) { const k = (y - base) / (l.y - base); const w = lerp(0.7, 0.12, k); g.moveTo(X(l.x - w), Y(y)); g.lineTo(X(l.x + lerp(0.7, 0.12, k + 1.1 / (l.y - base))), Y(y + 1.1)); }
      g.stroke();
    } else if (l.kind === 'bracket') {
      const d = -sign(Math.cos(l.base));
      g.beginPath(); g.moveTo(X(l.x + d * 1.0), Y(l.y + 0.5)); g.quadraticCurveTo(X(l.x + d * 0.3), Y(l.y + 0.6), X(l.x), Y(l.y + 0.15)); g.stroke();
      g.beginPath(); g.moveTo(X(l.x + d * 1.0), Y(l.y - 0.4)); g.lineTo(X(l.x + d * 1.0), Y(l.y + 0.7)); g.stroke();
    } else if (l.kind === 'lantern') {
      g.lineWidth = Math.max(1, 0.04 * s);
      g.beginPath(); g.moveTo(X(l.x), Y(l.y + 0.2)); g.lineTo(X(l.x), Y(l.y + 1.0)); g.stroke();
    }
    // the lamp head points where it looks
    const ang = l.ang, c = Math.cos(ang), sn = Math.sin(ang);
    const bx = l.x - c * 0.35, by = l.y - sn * 0.35;
    g.save(); g.translate(X(bx), Y(by)); g.rotate(-ang);
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(-0.35 * s, -0.18 * s); g.lineTo(0.3 * s, -0.27 * s); g.lineTo(0.3 * s, 0.27 * s); g.lineTo(-0.35 * s, 0.18 * s); g.fill();
    g.fillRect(-0.5 * s, -0.08 * s, 0.2 * s, 0.16 * s);
    // the lens: paper, with an iris that tightens when it sees you
    g.fillStyle = PAPER; g.beginPath(); g.ellipse(0.33 * s, 0, 0.07 * s, 0.24 * s, 0, 0, TAU); g.fill();
    if (l.focus > 0.05) { g.fillStyle = INK; g.beginPath(); g.ellipse(0.34 * s, 0, 0.05 * s, 0.24 * s * (1 - 0.65 * l.focus) * 0.5 + 0.04 * s, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  function drawProps() {
    const s = R.cam.s;
    for (const p of level.props) {
      if (p.kind === 'lamppost') {
        g.fillStyle = INK;
        g.fillRect(X(p.x - 0.09), Y(p.top - 0.3), 0.18 * s, (p.top - 0.3) * s);
        g.fillRect(X(p.x - 0.3), Y(0.6), 0.6 * s, 0.6 * s);
        g.fillRect(X(p.x - 0.5), Y(p.top + 0.2), 1.0 * s, 0.12 * s);
        g.beginPath(); g.moveTo(X(p.x - 0.4), Y(p.top + 0.3)); g.lineTo(X(p.x), Y(p.top + 0.9)); g.lineTo(X(p.x + 0.4), Y(p.top + 0.3)); g.fill();
      } else if (p.kind === 'pilaster') {
        // the awning's post, set into the façade behind the street
        g.fillStyle = '#121211'; g.fillRect(X(p.x - 0.22), Y(p.top), 0.44 * s, p.top * s);
        g.fillStyle = '#262522'; g.fillRect(X(p.x - 0.14), Y(p.top - 0.3), 0.28 * s, (p.top - 0.6) * s);
      } else if (p.kind === 'arch') {
        // the city gate at the end of the street: through it is the dark
        const x0 = p.x, x1 = p.x + 6;
        g.fillStyle = '#030303';
        g.beginPath(); g.moveTo(X(x0 + 0.8), Y(0)); g.lineTo(X(x0 + 0.8), Y(3.6)); g.quadraticCurveTo(X(x0 + 3), Y(6.4), X(x1 - 0.8), Y(3.6)); g.lineTo(X(x1 - 0.8), Y(0)); g.fill();
      }
    }
  }

  // The near side of the street, under the controls: cobbles running toward
  // us and an iron railing in front. Passive scenery only.
  function drawForeground() {
    const s = R.cam.s, y0 = Y(0), W = R.W;
    if (y0 > R.H) return;
    const xa = R.cam.x - W / 2 / s - 1, xb = R.cam.x + W / 2 / s + 1;
    for (let row = 1; row < 6; row++) {
      const yy = -0.25 - row * 0.32, k = 1 - row / 6;
      g.strokeStyle = 'rgba(60,58,53,' + (0.55 * k).toFixed(3) + ')'; g.lineWidth = Math.max(0.8, 0.03 * s);
      const w = 0.34 * (1 + row * 0.12), off = (row % 2) * w / 2;
      g.beginPath();
      for (let x = Math.floor(xa / w) * w + off; x < xb; x += w) { g.moveTo(X(x), Y(yy)); g.quadraticCurveTo(X(x + w / 2), Y(yy + 0.15), X(x + w - 0.03), Y(yy)); }
      g.stroke();
    }
    // a gutter and the kerb of the near pavement
    g.fillStyle = '#080808'; g.fillRect(0, Y(-2.1), W, Math.max(2, 0.12 * s));
    g.fillStyle = '#141312'; g.fillRect(0, Y(-2.22), W, R.H);
    g.fillStyle = 'rgba(236,231,220,0.12)'; g.fillRect(0, Y(-2.22), W, 1);
    // railing, nearer than the street, so it slides by faster
    const par = 1.3, sp = s * par, top = Y(-2.5), base = Y(-2.5) + 1.6 * sp;
    const ox = W / 2 - R.cam.x * sp;
    g.fillStyle = INK; g.strokeStyle = INK;
    g.fillRect(0, top + 0.18 * sp, W, Math.max(2, 0.07 * sp));
    g.fillRect(0, base - 0.25 * sp, W, Math.max(2, 0.07 * sp));
    const step = 0.24 * sp, start = ((ox % step) + step) % step;
    g.lineWidth = Math.max(1, 0.04 * sp);
    g.beginPath();
    for (let x = start - step; x < W + step; x += step) { g.moveTo(x, top + 0.1 * sp); g.lineTo(x, base); }
    g.stroke();
    for (let x = start - step; x < W + step; x += step) { g.beginPath(); g.moveTo(x - 0.05 * sp, top + 0.12 * sp); g.lineTo(x, top - 0.05 * sp); g.lineTo(x + 0.05 * sp, top + 0.12 * sp); g.fill(); }
    // posts and bollards every few metres
    const pstep = 4.8 * sp, pstart = (((ox + 1.1 * sp) % pstep) + pstep) % pstep;
    for (let x = pstart - pstep; x < W + pstep; x += pstep) {
      g.fillRect(x - 0.07 * sp, top - 0.25 * sp, 0.14 * sp, base - top + 0.25 * sp);
      g.beginPath(); g.arc(x, top - 0.28 * sp, 0.1 * sp, 0, TAU); g.fill();
    }
    g.fillStyle = '#0a0a09'; g.fillRect(0, base, W, R.H);
  }

  // -------------------------------------------------------------- the runner
  function pose(P, t) {
    const f = P.face, x = P.x, y = P.y;
    const J = {};
    let lean = 0, hipY = 0.86, neckH = 0.58;
    const sp = clamp(Math.abs(P.vx) / MOVE.run, 0, 1);
    const leg = (hip, a, b, L1, L2) => { const k = { x: hip.x + Math.sin(a) * f * L1, y: hip.y - Math.cos(a) * L1 }; return [k, { x: k.x + Math.sin(b) * f * L2, y: k.y - Math.cos(b) * L2 }]; };
    const arm = (sh, a, b) => { const e = { x: sh.x + Math.sin(a) * f * 0.29, y: sh.y - Math.cos(a) * 0.29 }; return [e, { x: e.x + Math.sin(b) * f * 0.27, y: e.y - Math.cos(b) * 0.27 }]; };
    let la = [0, 0], lb = [0, 0], aa = [0.1, -0.1], ab = [0.25, 0.1];
    const st = P.state;
    if (st === 'ground' || st === 'pull') {
      if (P.slideT > 0) { hipY = 0.34; lean = -0.55; la = [1.45, -0.2]; lb = [1.55, 1.6]; aa = [-0.6, 1.2]; ab = [-0.2, 1.9]; }
      else if (P.crouch) { hipY = 0.5; lean = 0.55; const ph = P.run * TAU / 1.0; la = [0.9 + Math.sin(ph) * 0.3 * sp, -0.5]; lb = [0.7 - Math.sin(ph) * 0.3 * sp, -0.6]; aa = [0.6, 0.5]; ab = [0.3, 1.0]; }
      else if (sp > 0.05) {
        const ph = P.run * TAU / 1.6;
        hipY = 0.84 + Math.abs(Math.sin(ph)) * 0.05 * sp;
        lean = 0.2 * sp;
        for (let i = 0; i < 2; i++) { const q = ph + i * Math.PI; la[i] = Math.sin(q) * 0.75 * sp; lb[i] = la[i] - (0.15 + Math.max(0, -Math.cos(q)) * 1.3) * sp; aa[i] = -Math.sin(q) * 0.85 * sp; ab[i] = aa[i] + 1.2 * sp + 0.2; }
      } else {
        const br = Math.sin(t * 2.1) * 0.012;
        hipY = 0.86 + br; la = [0.06, -0.08]; lb = [0.04, -0.06]; aa = [0.08, -0.12]; ab = [0.2, 0.0];
      }
      if (st === 'pull') { aa = [3.0, 0.4]; ab = [3.0, 0.5]; lean = -0.3; }
      hipY -= P.landK * 0.25;
    } else if (st === 'air') {
      if (P.vaultT > 0) { hipY = 0.75; lean = 0.4; la = [1.4, 1.2]; lb = [-1.0, 0.2]; aa = [0.9, 1.4]; ab = [1.1, 1.4]; }
      else if (P.vy > 1) { la = [1.0, -0.35]; lb = [-0.5, -0.3]; aa = [-0.6, 2.6]; ab = [0.2, 2.9]; lean = 0.15; }
      else { const k = clamp(-P.vy / 12, 0, 1); la = [0.5 - k * 0.3, -0.25]; lb = [-0.2 + k * 0.1, -0.4]; aa = [1.9 + k * 0.5, -1.5 - k * 0.6]; ab = [2.4, -1.0]; lean = 0.1; }
    } else if (st === 'hang' || st === 'climbup' || st === 'rope') {
      const sw = Math.sin(t * 3 + P.run * 3) * 0.12;
      la = [sw + 0.15, sw - 0.2]; lb = [-sw, -sw - 0.3]; aa = [Math.PI - 0.12, Math.PI - 0.05]; ab = [Math.PI + 0.1, Math.PI + 0.05];
      if (st === 'climbup' && P.climb) { const k = P.climb.t; hipY = 0.86 + 0.1 * k; la = [1.5 * Math.sin(k * Math.PI), 0]; lb = [-0.2, 0]; aa = [Math.PI * (1 - k * 0.8), 0.3]; ab = [Math.PI * (1 - k * 0.85), 0.2]; lean = 0.5 * Math.sin(k * Math.PI); }
      if (st === 'rope') { la = [0.35, -0.1]; lb = [0.1, -0.2]; }
    } else if (st === 'pipe') {
      const ph = (P.climbPhase || 0) * 3.2;
      la = [0.9 + Math.sin(ph) * 0.4, -0.6]; lb = [0.4 - Math.sin(ph) * 0.4, -0.8];
      aa = [2.6 + Math.sin(ph) * 0.3, 2.9]; ab = [2.2 - Math.sin(ph) * 0.3, 2.6]; lean = 0.15;
    } else if (st === 'caught' || st === 'gone') {
      hipY = 0.8; la = [0.2, -0.1]; lb = [-0.2, -0.3]; aa = [2.2, 3.4]; ab = [2.0, 3.3]; lean = -0.2;
    }
    const sc = P.crouch || P.slideT > 0 ? 1 : 1;
    const hip = { x, y: y + hipY * sc };
    const neck = { x: hip.x + Math.sin(lean) * f * neckH, y: hip.y + Math.cos(lean) * neckH };
    J.hip = hip; J.neck = neck;
    J.head = { x: neck.x + Math.sin(lean) * f * 0.2, y: neck.y + 0.19 };
    const sh = { x: neck.x - Math.sin(lean) * f * 0.06, y: neck.y - 0.05 };
    J.sh = sh;
    J.legs = [leg(hip, la[0], lb[0], 0.44, 0.44), leg(hip, la[1], lb[1], 0.44, 0.44)];
    J.arms = [arm(sh, aa[0], ab[0]), arm(sh, aa[1], ab[1])];
    // hands on what they hold
    if (st === 'hang' && P.ledge) { const lx = P.x, ly = P.ledge.y + 0.03; J.arms[0][1] = { x: lx - 0.13, y: ly }; J.arms[1][1] = { x: lx + 0.13, y: ly }; J.arms[0][0] = { x: lx - 0.16, y: (ly + sh.y) / 2 }; J.arms[1][0] = { x: lx + 0.16, y: (ly + sh.y) / 2 }; }
    if (st === 'rope') { const hy = P.y + P.h + 0.1; J.arms[0][1] = { x: P.x, y: hy }; J.arms[1][1] = { x: P.x, y: hy - 0.15 }; J.arms[0][0] = { x: P.x - 0.1 * f, y: (hy + sh.y) / 2 }; J.arms[1][0] = { x: P.x + 0.06 * f, y: (hy + sh.y) / 2 - 0.05 }; }
    if (st === 'pipe' && P.pipe) { const ph = (P.climbPhase || 0) * 3.2; J.arms[0][1] = { x: P.pipe.x, y: P.y + 1.55 + Math.sin(ph) * 0.15 }; J.arms[1][1] = { x: P.pipe.x, y: P.y + 1.2 - Math.sin(ph) * 0.15 }; }
    J.lean = lean; J.f = f;
    return J;
  }
  function figure(P, t, rim) {
    const s = R.cam.s, J = pose(P, t), f = J.f;
    const extra = rim ? 0.075 : 0;
    g.strokeStyle = rim ? PAPER : INK; g.fillStyle = rim ? PAPER : INK;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const seg = (a, b, w) => { g.lineWidth = (w + extra) * s; g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke(); };
    const limb = (root, l, w) => { g.lineWidth = (w + extra) * s; g.beginPath(); g.moveTo(X(root.x), Y(root.y)); g.lineTo(X(l[0].x), Y(l[0].y)); g.lineTo(X(l[1].x), Y(l[1].y)); g.stroke(); };
    // far arm and leg first
    limb(J.sh, J.arms[1], 0.1); limb(J.hip, J.legs[1], 0.15);
    // coat: shoulders to a hem that swings behind with speed
    const sp = clamp(P.vx * f / MOVE.run, -1, 1);
    const hemBack = 0.1 + Math.max(0, sp) * 0.22 + (P.state === 'air' ? clamp(-P.vy / 30, -0.1, 0.25) : 0);
    const hx = J.hip.x, hy = J.hip.y;
    g.lineWidth = extra * s;
    g.beginPath();
    g.moveTo(X(J.sh.x - f * 0.13), Y(J.sh.y + 0.04));
    g.lineTo(X(J.sh.x + f * 0.12), Y(J.sh.y + 0.02));
    g.lineTo(X(hx + f * 0.16), Y(hy - 0.05));
    g.lineTo(X(hx + f * 0.06), Y(hy - 0.34));
    g.lineTo(X(hx - f * (0.2 + hemBack)), Y(hy - 0.3 + hemBack * 0.3));
    g.lineTo(X(hx - f * 0.15), Y(hy + 0.02));
    g.closePath();
    g.fill(); if (rim) g.stroke();
    limb(J.hip, J.legs[0], 0.16);
    limb(J.sh, J.arms[0], 0.11);
    // head and a flat cap
    g.beginPath(); g.arc(X(J.head.x), Y(J.head.y), (0.15 + extra * 0.5) * s, 0, TAU); g.fill();
    g.beginPath();
    g.moveTo(X(J.head.x - f * 0.17), Y(J.head.y + 0.06)); g.lineTo(X(J.head.x + f * 0.27), Y(J.head.y + 0.04));
    g.lineTo(X(J.head.x + f * 0.13), Y(J.head.y + 0.16)); g.lineTo(X(J.head.x - f * 0.12), Y(J.head.y + 0.19)); g.closePath();
    g.fill(); if (rim) { g.lineWidth = extra * s; g.stroke(); }
    // scarf
    if (scarf.length) {
      g.lineWidth = (0.07 + extra) * s;
      g.beginPath(); g.moveTo(X(J.neck.x), Y(J.neck.y)); for (const q of scarf) g.lineTo(X(q.x), Y(q.y)); g.stroke();
    }
    return J;
  }
  function updateScarf(P, dt) {
    const J = pose(P, R.t);
    if (!scarf.length) for (let i = 0; i < 4; i++) scarf.push({ x: J.neck.x, y: J.neck.y });
    let px = J.neck.x, py = J.neck.y;
    for (let i = 0; i < scarf.length; i++) {
      const q = scarf[i];
      const tx = px - P.face * 0.14 - P.vx * 0.012, ty = py - 0.06 + Math.sin(R.t * 6 + i) * 0.02 + clamp(P.vy * 0.004, -0.05, 0.05) - (Math.abs(P.vx) < 1 ? 0.07 : 0);
      const k = 1 - Math.exp(-dt * (24 - i * 4));
      q.x += (tx - q.x) * k; q.y += (ty - q.y) * k;
      const dx = q.x - px, dy = q.y - py, d = Math.hypot(dx, dy) || 1;
      if (d > 0.17) { q.x = px + dx / d * 0.17; q.y = py + dy / d * 0.17; }
      px = q.x; py = q.y;
    }
  }

  // -------------------------------------------------------------- frame
  R.draw = function (S, dt) {
    const P = S.player; R.P = P; R.t = S.time;
    const W = R.W, H = R.H, s = R.cam.s;
    R.hunt = approach(R.hunt || 0, watcher.mode === 'hunt' ? 1 : 0, dt * 0.6);
    R.shade = approach(R.shade || 0, watcher.mode === 'track' || watcher.mode === 'hunt' ? 1 : watcher.mode === 'investigate' ? 0.4 : 0, dt * 0.5);
    R.shadeX = lerp(R.shadeX === undefined ? watcher.last.x * 0.55 : R.shadeX, watcher.last.x * 0.55 + 10, 1 - Math.exp(-dt * 0.4));
    updateScarf(P, dt);
    g.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    if (!sky || sky.width !== sky.pw) { give(sky); sky = makeSky(); }
    g.drawImage(sky, 0, 0, W, H);
    drawMoon();
    drawSkyline(far, 0.25, 0.42, '#6b6760', '#9b968b', -2.5);
    drawWatcherShade(S.time);
    drawSkyline(mid, 0.55, 0.62, '#45433e', '#77736a', -1.0);

    const facs = visibleFacades();
    drawFacades(facs, false);

    // the Watcher's light
    const list = [];
    for (const l of level.lights) {
      if (!lampVisible(l)) continue;
      let p = polys.get(l); if (!p) { p = []; polys.set(l, p); }
      optics.polygon(l, p);
      list.push(p);
      l.poly = p;
    }
    if (list.length) {
      // the engraving, where light falls
      g.save(); beamPath(list); g.clip();
      drawFacades(facs, true);
      g.fillStyle = 'rgba(236,231,220,0.16)'; g.fillRect(0, 0, W, H);
      g.restore();
      // haze in the air, stronger as a lamp focuses
      for (const l of level.lights) {
        if (!l.poly || !lampVisible(l)) continue;
        g.save(); beamPath([l.poly]);
        const gr = g.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), l.range * s);
        const a0 = 0.34 + l.focus * 0.2;
        gr.addColorStop(0, 'rgba(236,231,220,' + a0.toFixed(3) + ')');
        gr.addColorStop(0.55, 'rgba(236,231,220,' + (a0 * 0.55).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(236,231,220,0.04)');
        g.fillStyle = gr; g.fill();
        g.strokeStyle = 'rgba(236,231,220,0.5)'; g.lineWidth = 1; g.stroke();
        g.restore();
      }
    }
    // doorways sit on top of the light: inside one, the light cannot reach you
    for (const r of level.recesses) if (r.x1 > R.cam.x - W / 2 / s - 1 && r.x0 < R.cam.x + W / 2 / s + 1) drawRecess(r);
    // the cellar's dark interior, under the court
    for (const b of level.solids) if (b.kind === 'cellar') { g.fillStyle = '#070707'; g.fillRect(X(b.x0), Y(0), (b.x1 - b.x0) * s, 3 * s); }
    drawLines();
    for (const sh of level.sheets) drawSheet(sh);
    for (const p of level.plats) if (p.x1 > R.cam.x - W / 2 / s - 2 && p.x0 < R.cam.x + W / 2 / s + 2) drawPlat(p);
    for (const b of level.solids) if (b.x1 > R.cam.x - W / 2 / s - 2 && b.x0 < R.cam.x + W / 2 / s + 2) drawSolid(b);
    for (const p of level.pipes) drawPipe(p);
    for (const a of level.awnings) drawAwning(a);
    for (const sh of level.shutters) drawShutter(sh);
    drawProps();
    // lit edges: where the light touches geometry it shows as paper
    if (list.length) {
      g.save(); beamPath(list); g.clip();
      g.fillStyle = PAPER;
      for (const p of level.plats) g.fillRect(X(p.x0), Y(p.y) - 1, (p.x1 - p.x0) * s, Math.max(2, 0.09 * s));
      for (const b of level.solids) if (b.kind !== 'edge') g.fillRect(X(b.x0), Y(b.y1) - 1, (b.x1 - b.x0) * s, Math.max(2, 0.09 * s));
      for (const sh of level.sheets) drawSheet(sh, true);
      g.restore();
    }
    for (const l of level.lights) if (l.on && l.x > R.cam.x - W / 2 / s - 3 && l.x < R.cam.x + W / 2 / s + 3) drawLamp(l);

    // the runner: paper rim, then ink
    if (P.state !== 'gone') {
      g.save();
      if (watcher.hidden) g.globalAlpha = 0.55;
      figure(P, S.time, true); figure(P, S.time, false);
      g.restore();
    }
    drawForeground();
    if (P.state !== 'gone' && !R.capture) drawAttention(P);
    drawCaptureIris();
    // wires in the foreground
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.04 * s);
    for (let i = 0; i < 3; i++) {
      const par = 1.18, x0 = (i * 37 + 8), span = 26;
      const ox = R.W / 2 + (x0 - R.cam.x * par) * s;
      if (ox > W + 50 || ox + span * s < -50) continue;
      const y0 = R.focusTop - 30 + i * 8;
      g.beginPath(); g.moveTo(ox, y0); g.quadraticCurveTo(ox + span * s / 2, y0 + 2.5 * s, ox + span * s, y0 - 4); g.stroke();
    }
    // paper grain and vignette
    if (!vign) { vign = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.75); vign.addColorStop(0, 'rgba(0,0,0,0)'); vign.addColorStop(1, 'rgba(0,0,0,0.55)'); }
    g.fillStyle = vign; g.fillRect(0, 0, W, H);
    if (R.flash > 0) { g.fillStyle = 'rgba(236,231,220,' + Math.min(1, R.flash).toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
    if (R.debug) drawDebug(S);
  };

  function drawDebug(S) {
    const s = R.cam.s;
    g.strokeStyle = 'rgba(255,0,0,0.8)'; g.lineWidth = 1;
    for (const b of world.solids()) g.strokeRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
    g.strokeStyle = 'rgba(0,160,255,0.9)';
    for (const p of world.plats()) g.strokeRect(X(p.x0), Y(p.y), (p.x1 - p.x0) * s, p.th * s);
    const P = S.player, b = P.box();
    g.strokeStyle = 'lime'; g.strokeRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
  }
  return R;
}

// ---- 08_audio.js ----
// =====================================================================
// Sound: procedural, physical and sparse. The city has a slow mechanical
// heartbeat and a wind; each lamp hums while it turns; the Watcher's
// states each have a voice (a breath drawn in when it notices, a ping
// when it tracks, a bell when it hunts, a hard shut when it captures).
// Materials sound different underfoot. Silence is allowed.
// =====================================================================
function createAudio() {
  const A = { ok: false, on: true };
  let ac, master, sfx, wet, nb, wind, hum, humGain, tick = 0, pingT = 0;
  A.unlock = function () {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.on ? 0.9 : 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; master.connect(comp); comp.connect(ac.destination);
        sfx = ac.createGain(); sfx.gain.value = 0.8; sfx.connect(master);
        const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.32; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // wind between the houses
        const ws = ac.createBufferSource(); ws.buffer = nb; ws.loop = true;
        const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.7;
        wind = ac.createGain(); wind.gain.value = 0.035; ws.connect(wf); wf.connect(wind); wind.connect(master); ws.start();
        A.windF = wf;
        // the lamps' motor: a low, filtered saw
        hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 52;
        const hf = ac.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 240; hf.Q.value = 3;
        humGain = ac.createGain(); humGain.gain.value = 0; hum.connect(hf); hf.connect(humGain); humGain.connect(sfx); hum.start();
        A.humF = hf;
        // being lit: a thin, high hiss that grows with how much of you is in the light
        const es = ac.createBufferSource(); es.buffer = nb; es.loop = true;
        const ef = ac.createBiquadFilter(); ef.type = 'bandpass'; ef.frequency.value = 5200; ef.Q.value = 4;
        A.litGain = ac.createGain(); A.litGain.gain.value = 0; es.connect(ef); ef.connect(A.litGain); A.litGain.connect(sfx); es.start();
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setOn = on => { A.on = on; if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05); };
  function out(node, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    n.connect(sfx);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, rev === undefined ? 0.3 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, rev === undefined ? 0.2 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const R = () => Math.random();
  // ---- the body
  A.step = (mat, k) => {
    const v = 0.05 * (0.5 + k * 0.5);
    if (mat === 'balcony') { tone(520 + R() * 80, 0.05, 'triangle', v * 0.5, 380, 0, 0.12); noise(0.035, 'highpass', 3500, 1, v * 0.5, 0, 0, 0.08); }
    else if (mat === 'roof') { noise(0.05, 'bandpass', 2400 + R() * 600, 2, v * 0.9, 1400, 0, 0.1); tone(300 + R() * 60, 0.04, 'triangle', v * 0.3, 0, 0.015, 0.1); }
    else if (mat === 'awning') { noise(0.09, 'lowpass', 500, 1, v * 1.2, 200, 0, 0.05); }
    else { noise(0.05, 'bandpass', 1300 + R() * 400, 1.5, v, 700, 0, 0.12); }
  };
  A.jump = () => { noise(0.16, 'bandpass', 900, 1, 0.035, 2200, 0, 0.06); };
  A.land = (v, mat) => {
    const k = clamp(v / 18, 0.08, 1);
    noise(0.12 + k * 0.2, 'lowpass', mat === 'awning' ? 380 : 800, 1, 0.07 + 0.12 * k, 120, 0, 0.15);
    if (mat === 'balcony') tone(180, 0.25, 'triangle', 0.05 * k, 120, 0, 0.3);
    if (k > 0.7) tone(70, 0.3, 'sine', 0.18 * k, 40, 0, 0.2);
  };
  A.grab = what => {
    noise(0.04, 'bandpass', 2200, 2, 0.08, 0, 0, 0.1);
    if (what === 'pipe') tone(880 + R() * 60, 0.18, 'triangle', 0.035, 840, 0, 0.3);
    if (what === 'rope') { noise(0.25, 'bandpass', 600, 4, 0.05, 300, 0, 0.3); tone(140, 0.4, 'sawtooth', 0.02, 110, 0, 0.2); }
  };
  A.pullup = () => { noise(0.2, 'bandpass', 700, 1, 0.04, 400, 0, 0.1); };
  A.climb = () => { noise(0.06, 'bandpass', 1800 + R() * 400, 3, 0.03, 900, 0, 0.1); };
  A.slide = () => { noise(0.45, 'bandpass', 1800, 0.8, 0.06, 500, 0, 0.1); };
  A.vault = () => { noise(0.2, 'bandpass', 1200, 1, 0.04, 2400, 0, 0.1); };
  A.ropeCreak = k => { tone(160 + R() * 30, 0.3, 'sawtooth', 0.012 * k, 120, 0, 0.3); };
  // ---- the city's mechanisms
  A.awningOut = () => {
    for (let i = 0; i < 6; i++) { tone(1400 + i * 30, 0.03, 'square', 0.022, 0, i * 0.045, 0.3); noise(0.02, 'highpass', 4000, 1, 0.03, 0, i * 0.045, 0.2); }
    noise(0.5, 'lowpass', 900, 0.8, 0.16, 150, 0.32, 0.4);
    tone(90, 0.4, 'sine', 0.12, 60, 0.34, 0.3);
  };
  A.awningWarn = () => { for (let i = 0; i < 3; i++) tone(1700, 0.025, 'square', 0.018, 0, i * 0.12, 0.2); };
  A.awningBack = () => { noise(0.5, 'lowpass', 700, 0.8, 0.1, 200, 0, 0.3); for (let i = 0; i < 8; i++) tone(1500 - i * 40, 0.025, 'square', 0.015, 0, 0.05 + i * 0.05, 0.2); };
  A.shutter = (d, pan) => { const a = clamp(1 - d / 40, 0.15, 1); for (let i = 0; i < 10; i++) noise(0.06, 'bandpass', 1200 + R() * 900, 3, 0.07 * a, 0, i * 0.11, 0.35, pan); tone(110, 1.2, 'sawtooth', 0.025 * a, 90, 0, 0.4, pan); };
  A.shutterShut = (d, pan) => { const a = clamp(1 - d / 40, 0.15, 1); noise(0.5, 'lowpass', 1200, 1, 0.3 * a, 120, 0, 0.6, pan); tone(60, 0.6, 'sine', 0.25 * a, 35, 0, 0.5, pan); };
  A.door = (d, pan) => { const a = clamp(1 - d / 30, 0.2, 1); tone(220, 1.1, 'sawtooth', 0.03 * a, 160, 0, 0.5, pan, 0.3); tone(330, 0.9, 'sawtooth', 0.015 * a, 300, 0.2, 0.5, pan, 0.2); };
  A.cityTick = () => { noise(0.08, 'bandpass', 420, 6, 0.035, 300, 0, 0.9); tone(98, 0.5, 'sine', 0.025, 92, 0, 0.9); };
  // ---- the Watcher's voice
  A.notice = () => { tone(330, 0.9, 'sine', 0.06, 494, 0, 0.7, 0, 0.25); tone(990, 0.7, 'sine', 0.012, 1480, 0.1, 0.8, 0, 0.3); noise(0.8, 'bandpass', 3000, 8, 0.02, 5000, 0, 0.8, 0, 0.3); };
  A.settle = () => { tone(494, 0.9, 'sine', 0.035, 330, 0, 0.8, 0, 0.1); };
  A.investigate = () => { tone(196, 0.6, 'triangle', 0.04, 247, 0, 0.8); tone(247, 0.6, 'triangle', 0.03, 196, 0.35, 0.8); };
  A.track = () => { tone(740, 0.35, 'square', 0.03, 0, 0, 0.5); tone(988, 0.5, 'square', 0.025, 0, 0.12, 0.6); noise(0.4, 'highpass', 2000, 1, 0.05, 0, 0, 0.4); };
  A.hunt = () => { [196, 233, 311, 466, 523].forEach((f, i) => tone(f * 1.003 ** i, 2.6, 'sine', 0.05 / (1 + i * 0.4), f * 0.99, 0, 1, 0, 0.004)); noise(1.4, 'bandpass', 900, 2, 0.05, 300, 0, 0.8); };
  A.lost = () => { tone(392, 1.2, 'sine', 0.035, 262, 0, 0.9, 0, 0.15); };
  A.capture = () => { noise(0.08, 'highpass', 3000, 1, 0.3, 0, 0, 0.3); tone(55, 1.4, 'sine', 0.35, 35, 0, 0.6); [523, 554, 587, 622].forEach((f, i) => tone(f, 1.8, 'sine', 0.03, f * 0.98, 0.02, 1, 0, 0.01)); };
  A.escape = () => { [262, 330, 392, 494, 587].forEach((f, i) => tone(f, 2.6, 'sine', 0.045, 0, i * 0.16, 1, 0, 0.05)); noise(2.4, 'lowpass', 900, 0.7, 0.05, 300, 0, 1, 0, 0.6); };
  A.ui = () => { tone(660, 0.08, 'sine', 0.03, 0, 0, 0.2); };
  // ---- continuous: called every frame with the scene's state
  A.frame = function (dt, S) {
    if (!A.ok) return;
    const t = ac.currentTime;
    // the lamps hum when they are near and turning
    humGain.gain.setTargetAtTime(S.hum * 0.06, t, 0.15);
    A.litGain.gain.setTargetAtTime((S.lit || 0) * 0.05, t, 0.05);
    hum.frequency.setTargetAtTime(48 + S.humTurn * 40, t, 0.2);
    A.humF.frequency.setTargetAtTime(200 + S.tension * 600, t, 0.3);
    wind.gain.setTargetAtTime(0.03 + S.height * 0.003, t, 0.6);
    // the city's slow heartbeat, faster when the Watcher hunts
    tick -= dt;
    if (tick <= 0) { tick = S.tension > 0.8 ? 0.7 : S.tension > 0.5 ? 1.0 : 1.6; if (S.playing) A.cityTick(); }
    // tracking pings carry the lock-on
    if (S.lock > 0 && S.tracking) {
      pingT -= dt;
      if (pingT <= 0) { pingT = lerp(0.6, 0.16, S.lock); tone(1320, 0.06, 'sine', 0.02 + S.lock * 0.04, 0, 0, 0.3); }
    } else pingT = 0;
  };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}

// ---- 09_game.js ----
// =====================================================================
// THE LAST LIGHT ON THE STREET — the game: input, the run, captures and
// marks, the HUD, title, pause, result and the Plethora lifecycle.
// =====================================================================
const SAVE_KEY = 'lastlight_v1';
const SCORE = { base: 10000, perSecond: 40, perSeen: 250, perAlarm: 500, perCapture: 1500, floor: 100, perMetre: 10, escapeMin: 1500 };
// While running, the score is the distance reached (10 points a metre, at most ~1,420).
// An escape scores at least escapeMin, so any escape outranks any capture.
const LAMP_NAME = { tower: 'the tower searchlight', bracket: 'the wall lamp', lantern: 'the lantern', post: 'the lamppost', door: 'the open doorway' };

const UI_CSS = `
.ll{position:absolute;inset:0;font-family:Inter,system-ui,sans-serif;color:#ece7dc;user-select:none;-webkit-user-select:none;pointer-events:none;
  --top:max(var(--plethora-content-safe-top,0px),64px);--bot:max(var(--plethora-content-safe-bottom,120px),120px)}
.ll-play{position:absolute;left:calc(var(--plethora-content-safe-left,0px) + 26px);top:calc(var(--top) + 16px + 188px);pointer-events:auto;border:0;background:#ece7dc;color:#0d0d0c;font:600 15px Inter,system-ui,sans-serif;padding:13px 30px;cursor:pointer}
.ll-play:active{opacity:.85}
.ll *{box-sizing:border-box}
.ll-panel{position:absolute;inset:0;display:none;flex-direction:column;justify-content:flex-end;align-items:center;padding:calc(var(--top) + 16px) 16px calc(var(--bot) + 16px);background:rgba(13,13,12,.62)}
.ll-panel.on{display:flex}
.ll-card{width:100%;max-width:380px;pointer-events:auto;background:#ece7dc;color:#0d0d0c;padding:24px 20px 20px;box-shadow:0 0 0 1px #0d0d0c,0 0 0 5px #ece7dc,0 0 0 6px #0d0d0c}
.ll-h{font-family:'DM Serif Display',Georgia,serif;font-size:34px;line-height:1.05;margin:0}
.ll-it{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:20px;line-height:1.2;margin:4px 0 0;opacity:.85}
.ll-rule{height:1px;background:#0d0d0c;margin:16px 0}
.ll-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:left}
.ll-stats div{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
.ll-stats b{display:block;text-transform:none;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px;letter-spacing:0;opacity:1;margin-bottom:2px;font-variant-numeric:tabular-nums}
.ll-score{display:flex;align-items:baseline;justify-content:space-between;margin-top:16px}
.ll-score b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:44px;line-height:1;font-variant-numeric:tabular-nums}
.ll-score span{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.ll-note{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;margin-top:4px;min-height:20px}
.ll-board{font-size:13px;margin-top:8px}
.ll-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(13,13,12,.15);font-variant-numeric:tabular-nums}
.ll-row.me{font-weight:600}
.ll-dim{opacity:.6;font-size:12px;padding:4px 0}
.ll-b{display:block;width:100%;margin-top:8px;padding:14px;border:0;background:#0d0d0c;color:#ece7dc;font:600 12px Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;pointer-events:auto;cursor:pointer}
.ll-b.sec{background:transparent;color:#0d0d0c;box-shadow:inset 0 0 0 1px #0d0d0c}
.ll-b:active{opacity:.8}
.ll-keys{font-size:12px;line-height:1.6;margin-top:12px;opacity:.75}
.ll-why{font-size:15px;line-height:1.45;margin:0}
.ll-tip{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;line-height:1.3;margin:10px 0 0}
.ll-break{font-size:11px;line-height:1.5;opacity:.7;margin-top:6px;font-variant-numeric:tabular-nums}
`;

window.plethoraBit = {
  meta: { title: 'The Last Light on the Street', runtime: 'plethora-bit@2' },
  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number(id); return Number.isFinite(v) ? v : d; } catch (e) { return d; } };
    const safe = fn => { try { return fn(); } catch (e) { return undefined; } };
    // Layout area: ctx.contentSafeArea ?? ctx.safeArea, never smaller than the
    // documented reserves (the 120px content-safe-bottom fallback, and room for
    // a camera cutout/island at the top) even if a host reports smaller insets.
    const SAFE_MIN = { top: 64, bottom: 120 };
    const area = () => {
      const a = ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
      return { top: Math.max(a.top || 0, SAFE_MIN.top), right: a.right || 0, bottom: Math.max(a.bottom || 0, SAFE_MIN.bottom), left: a.left || 0 };
    };

    // fonts: wanted, not required
    safe(() => ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }));
    safe(() => ctx.loadFont('Cormorant Garamond', 'cormorant-garamond', '1.0.0', { weight: '300', style: 'italic' }).catch(() => { }));
    safe(() => ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }));
    safe(() => ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }));

    // ---- persistence (device-local conveniences)
    let save = { best: 0, bestTime: 0, runs: 0, sound: true };
    if (caps.storage) { const s = safe(() => ctx.storage.get(SAVE_KEY)); if (s && typeof s === 'object') save = Object.assign(save, s); }
    const persist = () => { if (caps.storage) safe(() => ctx.storage.set(SAVE_KEY, save)); };

    // ---- the world
    Object.assign(MOVE, { run: tune('run_speed', MOVE.run), jumpH: tune('jump_height', MOVE.jumpH) });
    Object.assign(WATCH, { notice: tune('notice_time', WATCH.notice), lock: tune('lock_time', WATCH.lock), lockHunt: tune('lock_time', WATCH.lock) * 0.7 });
    const level = buildLevel();
    const lampPace = tune('lamp_pace', 1);
    for (const l of level.lights) l.period /= lampPace;
    const world = createWorld(level);
    world.holdScale = tune('awning_hold', 1);
    const optics = createOptics(level);
    const player = createPlayer(world);
    const watcher = createWatcher(level, optics, world);
    const dynOcc = [];
    world.dynamicOccluders(dynOcc, 0); optics.setDynamic(dynOcc);

    // ---- surfaces
    const canvas = ctx.createCanvas2D({ maxDpr: 1.5, layer: 'content', input: 'auto', touchAction: 'none' });
    const ui = ctx.createRoot({ className: 'll', layer: 'overlay', input: 'passthrough' });
    const style = document.createElement('style'); style.textContent = UI_CSS; ui.appendChild(style);
    const R = createRenderer(canvas, level, world, optics, watcher, () => {
      const c = ctx.createCanvas2D({ layer: 'background', order: -100, input: 'passthrough' });
      c.style.display = 'none';
      return c;
    });
    const audio = createAudio(); audio.on = save.sound;
    const g = canvas.getContext('2d');
    let dpr = 1, W = 1, H = 1;
    let controlsH = 150;
    function layout() {
      W = ctx.width; H = ctx.height;
      dpr = canvas.width / Math.max(1, W) || 1;
      const a = area();
      controlsH = W > H * 1.2 ? 0 : 150;
      R.layout(W, H, dpr, a, controlsH);
      R.follow(player, 1, true);
      placeControls();
    }

    // ---- input: keyboard, and touch drawn on the canvas
    const key = {};
    const I = { mx: 0, my: 0, jumpPressed: false, jumpHeld: false, actPressed: false };
    const touch = { stick: null, jump: null, act: null };
    const btn = { jump: { x: 0, y: 0, r: 38 }, act: { x: 0, y: 0, r: 28 }, pause: { x: 0, y: 0, r: 20 } };
    // The usable band: below the top inset and above both the bottom inset
    // and Plethora's logo button, with a 16px margin from each.
    function bottomLimit() {
      const a = area(), logo = ctx.logoArea;
      let b = H - a.bottom;
      if (logo && logo.height > 0) b = Math.min(b, logo.y);
      return b - 16;
    }
    function inReservedZone(x, y) {
      const a = area(), logo = ctx.logoArea;
      if (y > H - a.bottom || y < a.top) return true;
      if (logo && logo.width > 0 && x > logo.x - 8 && x < logo.x + logo.width + 8 && y > logo.y - 8 && y < logo.y + logo.height + 8) return true;
      return false;
    }
    function placeControls() {
      const a = area(), b = bottomLimit();
      btn.jump.x = W - a.right - 16 - btn.jump.r; btn.jump.y = b - btn.jump.r - 8;
      btn.act.x = btn.jump.x - 78; btn.act.y = btn.jump.y - 30;
      // clear of the top inset: centre at a.top + 16 + 20 + 16, so its top edge sits a.top + 32
      btn.pause.x = W - a.right - 16 - btn.pause.r; btn.pause.y = a.top + 16 + 20 + 16;
      touch.home = { x: a.left + 16 + 56, y: b - 56 - 8 };
    }
    const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', Space: 'j', KeyK: 'j', KeyZ: 'j', KeyE: 'a', KeyJ: 'a', KeyX: 'a', Enter: 'enter', Escape: 'esc', KeyP: 'esc', KeyR: 'restart' };
    ctx.listen(window, 'keydown', e => {
      const k = KEYMAP[e.code]; if (!k) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (key[k]) return;
      key[k] = true;
      if (k === 'j') { I.jumpPressed = true; }
      if (k === 'a') I.actPressed = true;
      if (mode === 'title' && (k === 'j' || k === 'enter')) beginRun();
      else if (k === 'esc') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
      else if (k === 'restart' && (mode === 'play' || mode === 'paused')) { resume(); respawn(false); }
      else if (mode === 'result' && (k === 'enter' || k === 'j')) beginRun();
      else if (mode === 'caughtCard' && (k === 'enter' || k === 'j')) retryFromMark();
      else if (mode === 'caughtCard' && k === 'restart') beginRun();
    });
    ctx.listen(window, 'keyup', e => { const k = KEYMAP[e.code]; if (k) key[k] = false; });
    ctx.listen(window, 'blur', () => { for (const k in key) key[k] = false; });

    const hit = (b, x, y, pad) => Math.hypot(x - b.x, y - b.y) <= b.r + (pad || 12);
    ctx.listen(canvas, 'pointerdown', e => {
      const x = e.offsetX, y = e.offsetY;
      safe(() => canvas.setPointerCapture(e.pointerId));
      audio.unlock();
      if (mode === 'title') { beginRun(); return; }
      if (mode !== 'play') return;
      // never act on touches under the insets or on the logo button
      if (inReservedZone(x, y)) return;
      if (hit(btn.pause, x, y, 10)) { pause(); return; }
      if (hit(btn.jump, x, y, 18)) { touch.jump = e.pointerId; I.jumpPressed = true; return; }
      if (actVis.on && hit(btn.act, x, y, 14)) { touch.act = e.pointerId; I.actPressed = true; return; }
      if (x < W * 0.6 && !touch.stick) { touch.stick = { id: e.pointerId, ox: x, oy: y, x, y }; save.stickSeen = true; return; }
      // a tap elsewhere on the right side also jumps
      if (x >= W * 0.6) { touch.jump = e.pointerId; I.jumpPressed = true; }
    });
    ctx.listen(canvas, 'pointermove', e => {
      const t = touch.stick;
      if (t && t.id === e.pointerId) {
        t.x = e.offsetX; t.y = e.offsetY;
        // the stick's origin follows a finger that drags far
        const dx = t.x - t.ox, dy = t.y - t.oy, d = Math.hypot(dx, dy), max = 56;
        if (d > max) { t.ox = t.x - dx / d * max; t.oy = t.y - dy / d * max; }
      }
    });
    const up = e => {
      if (touch.stick && touch.stick.id === e.pointerId) touch.stick = null;
      if (touch.jump === e.pointerId) touch.jump = null;
      if (touch.act === e.pointerId) touch.act = null;
    };
    ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up); ctx.listen(canvas, 'lostpointercapture', up);

    function readInput() {
      let mx = (key.r ? 1 : 0) - (key.l ? 1 : 0), my = (key.u ? 1 : 0) - (key.d ? 1 : 0);
      const t = touch.stick;
      if (t) {
        const dx = t.x - t.ox, dy = t.y - t.oy;
        const ax = Math.abs(dx) < 9 ? 0 : sign(dx) * Math.min(1, (Math.abs(dx) - 6) / 30);
        const ay = Math.abs(dy) < 16 ? 0 : -sign(dy) * Math.min(1, (Math.abs(dy) - 12) / 26);
        mx = clamp(mx + ax, -1, 1); my = clamp(my + ay, -1, 1);
      }
      I.mx = mx; I.my = my;
      I.jumpHeld = !!key.j || touch.jump !== null;
    }

    // ---- the run
    let farX = 0, mode = 'title', runT = 0, time = 0, captures = 0, cp = 0, sectionSeen = -1, caption = null, captureT = 0, attempt = 0, result = null;
    let titleT = 0, stepAcc = 0, cityStepT = 0;
    const score = safe(() => ctx.game.score()) || { set() { }, reset() { }, value: 0 };
    const progressPts = () => Math.max(0, Math.floor(farX - level.start.x)) * SCORE.perMetre;
    // ---- the board: the server's numbers are the truth; ctx.storage is only a fallback
    const BOARD = { scope: 'global', period: 'all_time' };
    let serverBest = null, runSaved = 0;
    const bestShown = () => serverBest != null ? serverBest : save.best;
    const standingOf = s => { const v = s && ((s.viewerRank && s.viewerRank.value) ?? (s.standing && s.standing.value)); return typeof v === 'number' && isFinite(v) ? v : null; };
    function refreshBest() {
      return Promise.resolve().then(() => score.rank('score', BOARD)).then(s => { if (destroyed) return; const v = standingOf(s); if (v != null) serverBest = v; }).catch(() => { });
    }
    // submit one run result; if the server cannot take it, report it and hand
    // it to the host's retrying checkpoint queue so it is not lost
    function saveScore(value, kind, metadata) {
      const label = value.toLocaleString() + ' pts';
      if (value > save.best) { save.best = value; persist(); }
      return Promise.resolve().then(() => score.submit('score', { label, metadata }))
        .then(res => { const pb = !!(res && res.isPersonalBest); if (pb) serverBest = Math.max(serverBest || 0, value); return refreshBest().then(() => ({ state: 'ok', pb })); })
        .catch(err => {
          safe(() => ctx.platform.error({ code: 'score_submit_failed', message: String(err && (err.code || err.message) || err), kind, value }));
          return Promise.resolve().then(() => ctx.memory.record('score').checkpoint(value, { label, metadata }))
            .then(() => ({ state: 'queued' }), () => ({ state: 'fail' }));
        });
    }
    refreshBest();
    function resetWorld() {
      world.reset(); watcher.reset();
      world.dynamicOccluders(dynOcc, time); optics.setDynamic(dynOcc);
    }
    function respawn(capturedNow) {
      const c = level.checkpoints[cp];
      resetWorld();
      player.reset(c.x, c.y, c.face);
      R.follow(player, 1, true);
      I.jumpPressed = false; I.actPressed = false;
      if (capturedNow) captures++;
      R.capture = null; actVis.k = 0; actVis.on = false;
      mode = 'play';
    }
    function beginRun() {
      attempt++;
      audio.unlock(); audio.setOn(save.sound);
      safe(() => ctx.platform.start({ attempt }));
      safe(() => ctx.platform.interact({ type: 'begin' }));
      if (caps.backgroundMusic && save.sound) safe(() => { ctx.music.unlock(); ctx.music.play({ preset: 'drone', volume: 0.22, intensity: 0.15, tempo: 60, scale: 'minor', fadeInMs: 2400 }); });
      runT = 0; farX = level.start.x; runSaved = 0; captures = 0; cp = 0; sectionSeen = -1; caption = null; result = null; R.capture = null;
      watcher.alarms = 0; watcher.hunts = 0; watcher.exposure = 0;
      score.reset && score.reset();
      hidePanels(); playBtn.style.display = 'none';
      save.runs++; persist();
      respawn(false);
    }

    function retryFromMark() { if (mode !== 'caughtCard') return; hidePanels(); respawn(false); safe(() => ctx.platform.start({ attempt, retry: true })); }

    // why it caught you, from the state at the moment of capture
    function captureReason() {
      const c = watcher.captureCtx || {};
      const lamp = LAMP_NAME[c.lamp && c.lamp.kind] || 'the light';
      const secs = (c.litRun || 0).toFixed(1);
      if (c.door) return ['You hid in a doorway near where it lost you.', 'During a hunt, doorways near its last sighting open. Move on instead.'];
      if (c.onAwning) return ['You were on top of the awning, under ' + lamp + '.', 'The shadow falls beneath the awning, not on it.'];
      if (c.state === 'hang' || c.state === 'pipe' || c.state === 'climbup' || c.state === 'rope') return ['It locked on while you were climbing in ' + lamp + '’s light.', 'Climb while the beam is away, or climb out of its reach.'];
      if (c.reacquired) return ['It had lost you, and you went back into ' + lamp + '\u2019s light while it was still searching.', 'After it loses you, it hunts that spot. Leave by another way.'];
      if (c.sinceNoise < 3.5) return ['The noise told it where to look, and you were still in ' + lamp + '’s reach.', 'Pull when the lamp is turned away, then move at once.'];
      if (c.speed < 1) return ['You stood still in ' + lamp + '’s light for ' + secs + ' s.', 'Once it has found you, get something solid between you and the lamp.'];
      if (c.hunt) return ['It was already hunting you, and you stayed in ' + lamp + '’s light for ' + secs + ' s.', 'In a hunt it locks on faster. Break its line of sight, then change route.'];
      return ['It found you in ' + lamp + '’s light and you stayed in it for ' + secs + ' s.', 'A quick crossing is survivable. Lingering is not.'];
    }
    function showCaught() {
      const [why, tip] = captureReason();
      const sec = level.sections[currentSection()];
      const mark = level.sections[markSection()];
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      card.innerHTML = `<p class="ll-h">Caught.</p><p class="ll-it">${esc(sec.num + '. ' + sec.name)}, at ${fmtTime(runT)}</p><div class="ll-rule"></div>
        <p class="ll-why">${esc(why)}</p><p class="ll-tip">${esc(tip)}</p>`;
      card.appendChild(button('Run the street again', '', () => beginRun()));
      card.appendChild(button('From the last mark (' + mark.num + ')', 'sec', () => retryFromMark()));
      const k = document.createElement('div'); k.className = 'll-break';
      k.textContent = 'From the mark, the clock keeps running and this capture costs ' + SCORE.perCapture.toLocaleString() + ' points.';
      card.appendChild(k);
      const pts = progressPts();
      const saveLine = document.createElement('div'); saveLine.className = 'll-dim ll-save';
      card.insertBefore(saveLine, card.querySelector('.ll-b'));
      panel.appendChild(card); panel.className = 'll-panel on';
      // the distance reached is a result too: save it (best_per_user keeps the best)
      score.set && score.set(pts);
      const show = t => { if (!destroyed && saveLine.isConnected) saveLine.textContent = t; };
      if (pts > runSaved) {
        runSaved = pts;
        show('Score ' + pts.toLocaleString() + '. Saving…');
        saveScore(pts, 'caught', { timeMs: Math.round(runT * 1000), captures, metres: pts / SCORE.perMetre }).then(r => show(
          r.state === 'ok' ? 'Score ' + pts.toLocaleString() + (r.pb ? ', a new best.' : ' saved. Your best is ' + bestShown().toLocaleString() + '.')
            : r.state === 'queued' ? 'Score ' + pts.toLocaleString() + '. The board could not be reached; it will be saved when it can.'
              : 'Score ' + pts.toLocaleString() + '. It could not be saved.'));
      } else show('Score ' + pts.toLocaleString() + '. Your best is ' + bestShown().toLocaleString() + '.');
      safe(() => ctx.platform.fail({ section: currentSection() + 1, timeMs: Math.round(runT * 1000) }));
    }
    function markSection() { const c = level.checkpoints[Math.min(cp, level.checkpoints.length - 1)]; let s = 0; for (let i = 0; i < level.sections.length; i++) if (c.x >= level.sections[i].x) s = i; return s; }

    function pause() { if (mode !== 'play') return; mode = 'paused'; showPause(); safe(() => ctx.music.pause()); }
    function resume() { if (mode !== 'paused') return; mode = 'play'; hidePanels(); safe(() => ctx.music.resume()); }

    // ---- events from the systems
    function handleEvents() {
      for (const e of player.events) {
        if (e.type === 'jump') audio.jump();
        else if (e.type === 'land') {
          audio.land(e.v, e.kind);
          if (e.v > 15 && e.drop > 4) watcher.hear(e.x, e.y, 'landing');
          if (e.v > 13) safe(() => caps.haptics && ctx.platform.haptic('light'));
        }
        else if (e.type === 'grab') { audio.grab(e.what); }
        else if (e.type === 'pullup') audio.pullup();
        else if (e.type === 'slide') audio.slide();
        else if (e.type === 'vault') audio.vault();
      }
      player.events.length = 0;
    }
    function handleWatcher() {
      const pan = x => clamp((x - R.cam.x) / 12, -1, 1);
      for (const e of watcher.events) {
        if (e.type === 'notice') audio.notice();
        else if (e.type === 'investigate') audio.investigate();
        else if (e.type === 'track') { audio.track(); safe(() => caps.haptics && ctx.platform.haptic('warning')); setMusic(0.6, 78); }
        else if (e.type === 'hunt') { audio.hunt(); setMusic(0.9, 96); }
        else if (e.type === 'search') { if (e.from === 'track' || e.from === 'hunt') { audio.lost(); setMusic(0.15, 60); } else if (e.settled || e.from === 'notice') audio.settle(); }
        else if (e.type === 'lost') audio.settle();
        else if (e.type === 'reacquire') audio.track();
        else if (e.type === 'capture') capture();
      }
      watcher.events.length = 0;
      for (const e of worldEvents) {
        if (e.type === 'awningOut') audio.awningOut();
        else if (e.type === 'awningBack') audio.awningBack();
        else if (e.type === 'shutterDown') audio.shutter(Math.abs(e.s.x0 - player.x), pan(e.s.x0));
        else if (e.type === 'shutterShut') audio.shutterShut(Math.abs(e.s.x0 - player.x), pan(e.s.x0));
      }
      worldEvents.length = 0;
    }
    function setMusic(intensity, tempo) { if (caps.backgroundMusic && save.sound) safe(() => { ctx.music.setIntensity(intensity, { fadeMs: 1200 }); ctx.music.setTempo(tempo); }); }
    function capture() {
      mode = 'caught'; captureT = 0;
      player.state = 'caught'; player.vx = 0; player.vy = 0;
      R.capture = { x: player.x, y: player.y, t: 0 };
      // every lamp that can reach turns on the runner
      for (const l of level.lights) if (watcher.reaches(l, player)) l.engaged = true;
      audio.capture();
      safe(() => caps.haptics && ctx.platform.haptic('error'));
      safe(() => ctx.platform.milestone('captured', { section: currentSection() }));
      setMusic(0.15, 60);
    }
    function currentSection() { let s = 0; for (let i = 0; i < level.sections.length; i++) if (player.x >= level.sections[i].x) s = i; return s; }

    const worldEvents = [];
    let lastDoor = [];
    function step(dt) {
      readInput();
      if (mode === 'play') {
        runT += dt;
        farX = Math.max(farX, player.x);
        { const pp = progressPts(); if (pp > score.value) score.set && score.set(pp); }
        // act: pull the cord in reach
        if (I.actPressed) {
          updateActVis();
          const it = actVis.it;
          if (it && it.kind === 'cord' && it.ready) {
            player.startPull();
            world.pullAwning(it.a);
            watcher.hear(it.a.cord.x, it.a.cord.y, 'cord');
            safe(() => ctx.platform.interact({ type: 'awning' }));
            safe(() => caps.haptics && ctx.platform.haptic('medium'));
          }
        }
        player.update(dt, I);
        world.update(dt, player, watcher, worldEvents);
        world.dynamicOccluders(dynOcc, time); optics.setDynamic(dynOcc);
        watcher.update(dt, player, time);
        handleEvents(); handleWatcher();
        // marks along the street
        for (let i = cp + 1; i < level.checkpoints.length; i++) { const c = level.checkpoints[i]; if (player.x >= c.x && player.state === 'ground' && Math.abs(player.y - c.y) < 1 && watcher.mode !== 'track' && watcher.mode !== 'hunt') { cp = i; } }
        const sec = currentSection();
        if (sec > sectionSeen) { sectionSeen = sec; caption = { s: level.sections[sec], t: 0 }; if (sec > 0) safe(() => ctx.platform.milestone('section', { n: sec + 1 })); safe(() => ctx.platform.setProgress(sec / (level.sections.length))); }
        if (player.y < -8) respawn(false);
        if (player.x >= level.exitX && player.y < 1.5 && (player.state === 'ground' || player.state === 'air')) finish();
        updateActVis();
        // doors that open during a hunt creak
        level.recesses.forEach((r, i) => { const o = r.open > 0.05; if (o && !lastDoor[i]) audio.door(Math.abs(r.x0 - player.x), clamp((r.x0 - R.cam.x) / 12, -1, 1)); lastDoor[i] = o; });
      } else if (mode === 'caught') {
        captureT += dt;
        watcher.update(dt, player, time);
        watcher.events.length = 0;
        R.capture.t = captureT;
        if (captureT > 0.95) { captures++; mode = 'caughtCard'; showCaught(); }
      }
      I.jumpPressed = false; I.actPressed = false;
    }

    // ---- result
    function finish() {
      mode = 'result';
      player.state = 'gone';
      const t = runT, seen = watcher.exposure, alarms = watcher.alarms;
      const value = Math.max(SCORE.escapeMin, Math.round(SCORE.base - SCORE.perSecond * t - SCORE.perSeen * seen - SCORE.perAlarm * alarms - SCORE.perCapture * captures));
      const prevBest = bestShown();
      if (!save.bestTime || t < save.bestTime) save.bestTime = t;
      persist();
      result = { t, seen, alarms, captures, value, prevBest, attempt, saved: { state: 'saving' }, board: { state: 'loading' } };
      audio.escape();
      safe(() => caps.backgroundMusic && save.sound && ctx.music.sting('win'));
      setMusic(0.1, 56);
      score.set && score.set(value);
      showResult();
      // records: submit first, then mark the outcome; detached, fenced to this attempt
      const mine = attempt, live = () => !destroyed && mine === attempt && result && mode === 'result';
      runSaved = value;
      const saving = saveScore(value, 'escape', { timeMs: Math.round(t * 1000), captures, alarms });
      safe(() => ctx.platform.complete({ score: value, timeMs: Math.round(t * 1000), captures }));
      saving.then(sv => { if (live()) { result.saved = sv; renderBoard(); } })
        .then(() => score.leaderboard('score', Object.assign({ limit: 3 }, BOARD)))
        .then(b => { if (!live()) return; const v = standingOf(b); if (v != null) serverBest = v; result.board = { state: 'ok', rows: (b && b.rows) || [], me: b && b.viewerRank, total: b && b.totalRanked, failed: !!(b && b.checkpointStatus && b.checkpointStatus.failed) }; renderBoard(); })
        .catch(() => { if (live()) { result.board = { state: 'fail' }; renderBoard(); } });
      safe(() => ctx.timeout(() => { if (!destroyed && mine === attempt && mode === 'result') safe(() => ctx.pulse.complete({ timeMs: Math.round(t * 1000), score: value, text: 'Escaped the Watcher\'s street in ' + fmtTime(t) + '.' })); }, 900));
    }
    const fmtTime = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

    // ---- DOM panels: pause and result
    const panel = document.createElement('div'); panel.className = 'll-panel'; ui.appendChild(panel);
    // the start control: a real button under the title, laid out from the
    // content-safe CSS variables, nowhere near the bottom of the screen
    const playBtn = document.createElement('button'); playBtn.className = 'll-play'; playBtn.textContent = 'Play';
    ctx.input.activate(playBtn, () => { audio.unlock(); if (mode === 'title') beginRun(); });
    ui.appendChild(playBtn);
    function hidePanels() { panel.className = 'll-panel'; panel.innerHTML = ''; }
    function button(label, cls, fn) { const b = document.createElement('button'); b.className = 'll-b' + (cls ? ' ' + cls : ''); b.textContent = label; ctx.input.activate(b, e => { audio.ui(); fn(e); }); return b; }
    function showPause() {
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      card.innerHTML = '<p class="ll-h">Paused</p><p class="ll-it">The Watcher waits with you.</p><div class="ll-rule"></div>';
      card.appendChild(button('Resume', '', resume));
      card.appendChild(button('Back to the last mark', 'sec', () => { resume(); respawn(false); }));
      card.appendChild(button('Restart the street', 'sec', () => { mode = 'play'; beginRun(); }));
      card.appendChild(button('Sound: ' + (save.sound ? 'on' : 'off'), 'sec', () => { save.sound = !save.sound; persist(); audio.setOn(save.sound); safe(() => save.sound ? ctx.music.resume() : ctx.music.pause()); showPause(); }));
      const k = document.createElement('div'); k.className = 'll-keys';
      k.textContent = 'Drag on the left to run, climb and drop. Right side: jump (hold for height) and pull. Keys: arrows or WASD, Space to jump, E to pull, Esc to pause.';
      card.appendChild(k);
      panel.appendChild(card); panel.className = 'll-panel on';
    }
    function showResult() {
      const r = result;
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      const verdict = r.captures === 0 && r.alarms === 0 ? 'Unseen.' : r.captures === 0 ? 'Escaped.' : 'Escaped, at last.';
      const sub = r.captures === 0 && r.alarms === 0 ? 'It never knew you were there.' : r.captures === 0 ? 'It found you ' + (r.alarms === 1 ? 'once' : r.alarms + ' times') + ', and you shook it off.' : 'It caught you ' + (r.captures === 1 ? 'once' : r.captures + ' times') + ' on the way.';
      card.innerHTML = `<p class="ll-h">${verdict}</p><p class="ll-it">${sub}</p><div class="ll-rule"></div>
        <div class="ll-stats"><div><b>${fmtTime(r.t)}</b>Time</div><div><b>${r.seen.toFixed(1)}s</b>In light</div><div><b>${r.alarms}</b>Detected</div><div><b>${r.captures}</b>Caught</div></div>
        <div class="ll-score"><b>${r.value.toLocaleString()}</b><span>Score</span></div>
        <div class="ll-break">${SCORE.base.toLocaleString()} − ${Math.round(SCORE.perSecond * r.t)} time − ${Math.round(SCORE.perSeen * r.seen)} light − ${SCORE.perAlarm * r.alarms} detected − ${SCORE.perCapture * r.captures} caught</div>
        <div class="ll-note"></div>
        <div class="ll-board"></div>`;
      card.appendChild(button('Run again', '', () => beginRun()));
      panel.appendChild(card); panel.className = 'll-panel on';
      renderBoard();
    }
    function renderBoard() {
      const el = panel.querySelector('.ll-board'); if (!el || !result) return;
      const note = panel.querySelector('.ll-note'), sv = result.saved, r0 = result;
      if (note) note.textContent = sv.state === 'saving' ? 'Saving your score…'
        : sv.state === 'ok' ? (sv.pb ? (r0.prevBest ? 'A new best: ' + r0.prevBest.toLocaleString() + ' before.' : 'Your first score on the board.') : 'Saved. Your best is ' + bestShown().toLocaleString() + '.')
          : sv.state === 'queued' ? 'The board could not be reached. Your score will be saved when it can.'
            : 'Your score could not be saved.';
      const b = result.board;
      if (b.state === 'loading') { el.innerHTML = '<div class="ll-dim">Updating the board…</div>'; return; }
      if (b.state === 'fail') { el.innerHTML = '<div class="ll-dim">The board is unavailable right now.</div>'; return; }
      const isMe = r => !!b.me && (r.userId && b.me.userId ? r.userId === b.me.userId : r.rank === b.me.rank);
      const who = r => r.username || r.displayName || r.name || (isMe(r) ? 'you' : '');
      const rows = (b.rows || []).slice(0, 3).map(r => `<div class="ll-row${isMe(r) ? ' me' : ''}"><span>${r.rank}.${who(r) ? ' ' + esc(who(r)) : ''}</span><span>${esc(r.displayLabel || (typeof r.value === 'number' ? r.value.toLocaleString() + ' pts' : ''))}</span></div>`).join('');
      const me = b.me && b.me.rank ? `<div class="ll-dim">You are ${b.me.rank}${b.total ? ' of ' + b.total : ''}.</div>` : '';
      const warn = b.failed ? '<div class="ll-dim">Some scores were not saved. Showing the scores the board accepted.</div>' : '';
      el.innerHTML = (rows ? rows + me : '<div class="ll-dim">No scores yet.</div>') + warn;
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    // ---- HUD on the canvas
    function drawHUD(dt) {
      const a = area();
      g.save();
      g.textBaseline = 'alphabetic';
      if (mode === 'title') {
        const x = a.left + 24, y = a.top + 16 + 68;
        g.fillStyle = 'rgba(13,13,12,0.0)';
        g.fillStyle = PAPER;
        g.font = '400 46px "DM Serif Display", Georgia, serif';
        g.fillText('The Last Light', x, y);
        g.font = 'italic 300 32px "Cormorant Garamond", Georgia, serif';
        g.fillText('on the Street', x + 2, y + 36);
        g.fillRect(x + 2, y + 58, 40, 1);
        g.font = '600 11px Inter, system-ui, sans-serif';
        if (g.letterSpacing !== undefined) g.letterSpacing = '2px';
        g.fillText('THE WATCHER’S STREET', x + 2, y + 82);
        if (bestShown()) { g.globalAlpha = 0.75; g.fillText('BEST ' + bestShown().toLocaleString(), x + 2, y + 102); g.globalAlpha = 1; }
        if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
        g.restore();
        return;
      }
      // time
      g.fillStyle = PAPER;
      g.font = '400 26px "DM Serif Display", Georgia, serif';
      // distance covered: the furthest point reached along the street
      const dist = String(Math.max(0, Math.floor(farX - level.start.x)));
      const hudY = a.top + 40 + 16; // readout baseline, well below the top inset
      g.fillText(dist, a.left + 16, hudY);
      const dw = g.measureText(dist).width;
      g.font = '400 17px "DM Serif Display", Georgia, serif';
      g.fillText('m', a.left + 16 + dw + 4, hudY);
      // section caption, like a chapter heading
      if (caption) {
        caption.t += dt;
        const k = caption.t < 0.5 ? caption.t / 0.5 : caption.t > 3 ? Math.max(0, 1 - (caption.t - 3) / 0.8) : 1;
        if (k > 0) {
          g.globalAlpha = k;
          g.font = 'italic 300 22px "Cormorant Garamond", Georgia, serif';
          g.fillText(caption.s.num + '.  ' + caption.s.name, a.left + 16, hudY + 28);
          g.globalAlpha = 1;
        }
      }
      drawEye(W / 2, btn.pause.y);
      // pause
      const p = btn.pause;
      g.strokeStyle = 'rgba(236,231,220,0.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
      g.fillStyle = PAPER; g.fillRect(p.x - 5, p.y - 7, 3, 14); g.fillRect(p.x + 2, p.y - 7, 3, 14);
      drawControls();
      g.restore();
    }
    function drawEye(cx, cy) {
      const m = watcher.mode, w = 18;
      const open = m === 'search' ? 0 : m === 'investigate' ? 0.25 : m === 'notice' ? 0.2 + watcher.S * 0.6 : 1;
      R.eye = approach(R.eye || 0, open, 0.08);
      const o = R.eye;
      g.strokeStyle = PAPER; g.fillStyle = PAPER; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - w, cy); g.quadraticCurveTo(cx, cy - 13 * o - 0.5, cx + w, cy); g.quadraticCurveTo(cx, cy + 13 * o + 0.5, cx - w, cy); g.stroke();
      if (o > 0.3) {
        const pr = (m === 'hunt' ? 2.5 : 4.5) * Math.min(1, (o - 0.3) / 0.5);
        const lx = clamp((watcher.last.x - player.x) * 0.4, -6, 6);
        g.beginPath(); g.arc(cx + (m === 'investigate' ? lx : 0), cy, pr, 0, TAU); g.fill();
      }
      if (m === 'hunt') { g.lineWidth = 1; for (let i = 0; i < 7; i++) { const a = -Math.PI + (i + 0.5) * Math.PI / 7; g.beginPath(); g.moveTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 15); g.lineTo(cx + Math.cos(a) * 27, cy + Math.sin(a) * 19); g.stroke(); } }
      // a hairline that fills: suspicion (grey) then lock-on (paper)
      const lw = 84, ly = cy + 22;
      g.fillStyle = 'rgba(236,231,220,0.25)'; g.fillRect(cx - lw / 2, ly, lw, 1);
      if (m === 'notice' || m === 'search' || m === 'investigate') { g.fillStyle = 'rgba(236,231,220,0.6)'; const v = watcher.S; g.fillRect(cx - lw / 2 * v, ly - 0.5, lw * v, 2); }
      else { g.fillStyle = PAPER; const v = watcher.L; g.fillRect(cx - lw / 2 * v, ly - 1, lw * v, 3); }
    }
    // the pull button exists only while there is something to pull; a wider
    // radius to leave than to enter keeps it from flickering at the edge
    const actVis = { k: 0, on: false, it: null };
    function updateActVis() {
      let it = null;
      if (mode === 'play' && (player.state === 'ground' || player.state === 'pull')) {
        for (const a of level.awnings) {
          const d = Math.abs(player.x - a.cord.x), dy = Math.abs(player.y - a.cord.y);
          if (dy < 0.5 && d < (actVis.on ? 1.35 : 0.95)) it = { kind: 'cord', a, ready: a.cool <= 0 && a.target === 0 && player.state !== 'pull' };
        }
      }
      actVis.on = !!it; actVis.it = it;
    }
    function drawControls() {
      const it = actVis.it;
      // stick
      const t = touch.stick, home = touch.home;
      g.lineWidth = 1.5;
      if (t) {
        g.strokeStyle = 'rgba(236,231,220,0.45)'; g.beginPath(); g.arc(t.ox, t.oy, 50, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(236,231,220,0.35)'; g.beginPath(); g.arc(t.x, t.y, 20, 0, TAU); g.fill();
      } else {
        const hint = !save.stickSeen ? 0.5 + 0.3 * Math.sin(time * 3) : 0.22;
        g.strokeStyle = 'rgba(236,231,220,' + hint.toFixed(2) + ')';
        g.beginPath(); g.arc(home.x, home.y, 50, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(236,231,220,' + (hint * 0.6).toFixed(2) + ')';
        g.beginPath(); g.arc(home.x + (!save.stickSeen ? Math.sin(time * 1.6) * 22 : 0), home.y, 18, 0, TAU); g.fill();
      }
      // jump
      const j = btn.jump, held = touch.jump !== null;
      g.fillStyle = held ? 'rgba(236,231,220,0.3)' : 'rgba(13,13,12,0.25)';
      g.beginPath(); g.arc(j.x, j.y, j.r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(236,231,220,0.7)'; g.stroke();
      g.strokeStyle = PAPER; g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(j.x - 11, j.y + 5); g.lineTo(j.x, j.y - 7); g.lineTo(j.x + 11, j.y + 5); g.stroke();
      // act: appears with something to pull; WAIT while the awning is out
      actVis.k = approach(actVis.k, actVis.on && mode === 'play' ? 1 : 0, 0.12);
      if (actVis.k > 0.01) {
        const ac = btn.act, live = it && it.ready;
        g.save(); g.globalAlpha = actVis.k;
        g.lineWidth = 1.5;
        g.fillStyle = live ? 'rgba(236,231,220,0.94)' : 'rgba(13,13,12,0.35)';
        g.beginPath(); g.arc(ac.x, ac.y, ac.r, 0, TAU); g.fill();
        g.strokeStyle = live ? PAPER : 'rgba(236,231,220,0.4)'; g.stroke();
        if (live) { const k = (time * 1.4) % 1; g.globalAlpha = actVis.k * (1 - k); g.beginPath(); g.arc(ac.x, ac.y, ac.r + k * 14, 0, TAU); g.stroke(); g.globalAlpha = actVis.k; }
        // glyph: a cord and its toggle
        const col = live ? INK : 'rgba(236,231,220,0.5)';
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(ac.x, ac.y - 15); g.lineTo(ac.x, ac.y - 3); g.stroke();
        g.fillRect(ac.x - 3, ac.y - 4, 6, 9);
        g.font = '600 9px Inter, system-ui, sans-serif'; g.textAlign = 'center';
        if (g.letterSpacing !== undefined) g.letterSpacing = '1.5px';
        g.fillText(live ? 'PULL' : 'WAIT', ac.x + 1, ac.y + 17);
        if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
        g.textAlign = 'left';
        g.restore();
      }
    }

    // ---- frame
    function frame(dt) {
      time += dt;
      if (mode === 'title') {
        titleT += dt;
        // the title holds on the roofs while the first lamp searches
        R.cam.x = 26 + Math.sin(titleT * 0.08) * 3; R.cam.yb = 4.2;
        player.update(0, I);
        watcher.update(dt, player, time);
        watcher.events.length = 0;
      } else if (mode === 'play' || mode === 'caught' || mode === 'caughtCard') R.follow(player, dt);
      R.flash = 0;
      R.dpr = canvas.width / Math.max(1, ctx.width) || 1;
      R.draw({ player, time }, dt);
      drawHUD(dt);
      // audio scene
      let hum = 0, turn = 0;
      for (const l of level.lights) { if (!l.on) continue; const d = Math.hypot(l.x - player.x, l.y - player.y); const k = clamp(1 - d / 24, 0, 1); if (k > hum) { hum = k; turn = Math.abs(angNorm(l.ang - (l.prevAng === undefined ? l.ang : l.prevAng))) / Math.max(dt, 1e-3); } l.prevAng = l.ang; }
      audio.frame(dt, { lit: mode === 'play' ? watcher.seenFrac : 0, hum: mode === 'title' ? hum * 0.5 : hum, humTurn: clamp(turn / 0.8, 0, 1), tension: watcher.tension(), height: player.y, playing: mode === 'play', lock: watcher.L, tracking: watcher.mode === 'track' || watcher.mode === 'hunt' });
      // footsteps
      if (mode === 'play' && player.state === 'ground' && Math.abs(player.vx) > 0.8 && player.slideT <= 0) {
        stepAcc += Math.abs(player.vx) * dt;
        if (stepAcc > 0.8) { stepAcc = 0; audio.step(player.ground ? player.ground.kind : 'street', Math.abs(player.vx) / MOVE.run); }
      }
      if (mode === 'play' && player.state === 'pipe' && Math.abs(player.vy) > 0.5) { cityStepT += dt * Math.abs(player.vy); if (cityStepT > 0.55) { cityStepT = 0; audio.climb(); } }
      for (const a of level.awnings) { if (a.shake && !a.warned) { a.warned = true; audio.awningWarn(); } if (!a.shake) a.warned = false; }
    }

    ctx.onResize(layout, { immediate: true });
    if (!W || !H) layout();
    // a first frame before the host reveals the Bit
    R.cam.x = 26; R.cam.yb = 4.2;
    player.reset(level.start.x, level.start.y, 1);
    frame(0);
    ctx.game.loop({
      fixedHz: 120,
      maxDeltaMs: 80,
      fixedUpdate: ms => { if (mode === 'play' || mode === 'caught') step(ms / 1000); },
      update: ms => frame(Math.min(0.05, ms / 1000)),
      onError: (err, phase) => { safe(() => ctx.platform.error({ stage: 'loop_' + phase, message: String((err && err.message) || err) })); }
    });
    ctx.onDestroy(() => audio.close());
    if (window.__LL_DEV) window.__ll = { act: actVis, level, world, player, watcher, optics, R, I, key, touch, btn, get mode() { return mode; }, set mode(v) { mode = v; }, beginRun, retryFromMark, respawn, step, frame, finish, setCp: i => { cp = i; }, get cp() { return cp; }, get runT() { return runT; }, get captures() { return captures; }, get result() { return result; }, get farX() { return farX; }, set farX(v) { farX = v; }, bestShown, get score() { return score.value; } };
    ctx.markVisualReady('title');
    ctx.platform.ready();
  }
};

})();
