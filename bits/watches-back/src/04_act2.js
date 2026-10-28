// =====================================================================
// Act II — Relationships. Moss and tendon, deeper shafts, eyes that act
// on one another. Pinning starts to have consequences you didn't choose.
// =====================================================================

// helper: place an eye on a pillar facing a world point
function eyeOnPillar(K, o) {
  const tag = K.pillar({ x: o.px, z: o.pz, r: o.pr, top: o.top === undefined ? 26 : o.top, bottom: o.bottom, style: o.style || 'fluted', mat: o.mat });
  const yaw = Math.atan2(o.look[2] - o.pz, o.look[0] - o.px);
  const m = K.onPillar(o.px, o.pz, o.pr, o.y, yaw, 0);
  const facing = vNorm(vSub(o.look, m.pos));
  const e = K.eye(Object.assign({ host: tag, pos: m.pos, facing }, o.eye));
  return { tag, e };
}

// ---- 05 The Drifter --------------------------------------------------------
ENCOUNTERS.push({
  id: 'e05', act: 2, name: 'The Drifter',
  cam: { w: 22, ahead: 3 },
  look: 'act2',
  build(K) {
    const C = [0, -8];
    K.spawn(-6.3, 10.5);
    K.floor({ x: -6.3, z: 5.5, w: 3, l: 11, etch: 'rungs' });
    K.ring({ x: C[0], z: C[1], r0: 8.5, r1: 11.6, a0: 2.12, a1: 6.05, etch: 'radial' });
    K.floor({ x: 13.4, z: -10.6, w: 3, l: 6.4, yaw: 0, etch: 'rungs' });
    K.exit({ x: 15.6, z: -10.6, yaw: 0 });
    // the outer wall and the shaft
    K.wall({ x: C[0], z: C[1], r0: 12.2, r1: 13.6, a0: 2.3, a1: 5.95, y1: 16, mat: 'moss' });
    K.shaft({ x: C[0], z: C[1], r: 7.6, depth: 100, rings: 10 });
    // screens on the inner edge: cover from the drifter's light
    for (const a of [2.75, 3.4, 4.05, 4.7, 5.35]) {
      const r = 9.05;
      K.block({ x: C[0] + Math.cos(a) * r, z: C[1] + Math.sin(a) * r, w: 2.9, t: 0.6, yaw: a + Math.PI / 2, y1: 4.4, mat: 'ink', style: 'screen' });
    }
    // the drifter rides a rail around the shaft, looking outward and down
    const pts = [];
    for (let i = 0; i <= 14; i++) { const a = 2.3 + (5.95 - 2.3) * i / 14; pts.push([C[0] + Math.cos(a) * 5.4, 6.2, C[1] + Math.sin(a) * 5.4]); }
    K.eye({ id: 'D', type: 'drifter', pos: pts[0], facing: [0, -0.6, 1], rail: { pts, speed: 2.3, center: [C[0], 0, C[1]], out: true, faceY: -0.72, pause: 1.0, u: 4 }, range: 18, acquireTime: 1.6, maxDev: 50 * DEG });
    // a watcher in the north wall covers the far stretch, where the screens don't help
    const wa = 4.6, wr = 11.75;
    K.eye({ id: 'N', type: 'watcher', pos: [C[0] + Math.cos(wa) * wr, 4.2, C[1] + Math.sin(wa) * wr], facing: vNorm([-Math.cos(wa), -0.35, -Math.sin(wa)]), acquireTime: 2.0, range: 15, fov: 20 * DEG, maxDev: 45 * DEG,
      home: { sweep: [[C[0] + Math.cos(4.25) * 10, 0.8, C[1] + Math.sin(4.25) * 10], [C[0] + Math.cos(5.0) * 10, 0.8, C[1] + Math.sin(5.0) * 10]], period: 5 } });
    K.ribs({ x: C[0], z: C[1], r: 14, count: 9, h: 26, span: 'crown', thick: 1.0, mat: 'moss' });
    K.mass({ seed: 51, style: 'towers' });
    K.roots({ x: C[0], z: C[1], r: 12.5, n: 10, top: 26 });
  },
  hints: [
    { id: 'cover', text: 'Its light moves. Wait behind the screens', when: W => W.t > 1, until: W => W.player.pos[2] < -6, ms: 5000 },
    { id: 'north', text: 'The screens cannot hide you from the wall eye', when: W => W.eyeById.N.state === 'alert' || W.eyeById.N.state === 'acquiring', until: W => W.eyeById.N.state === 'pinned', ms: 4000 }
  ],
  failHint: 'Hold the drifter when its light is away from your path.'
});

// ---- 06 The Gathering --------------------------------------------------------
ENCOUNTERS.push({
  id: 'e06', act: 2, name: 'The Gathering',
  cam: { w: 22, ahead: 4 },
  look: 'act2',
  build(K) {
    K.spawn(0, 20);
    K.floor({ x: 0, z: 14, w: 9, l: 13, etch: 'rungs' });
    K.floor({ x: 0, z: 6.2, w: 3.6, l: 2.8 });
    K.ring({ x: 0, z: -2, r1: 7.6, etch: 'spiral' });
    K.floor({ x: 0, z: -10.6, w: 3.6, l: 3.2 });
    K.floor({ x: 0, z: -18, w: 4, l: 12.4, etch: 'rungs' });
    K.exit({ x: 0, z: -23.4, yaw: -Math.PI / 2 });
    // walls with iris gates
    K.block({ x: -6.2, z: 6.6, w: 8.6, t: 1.1, yaw: 0, y1: 3, mat: 'moss', style: 'jamb' });
    K.block({ x: 6.2, z: 6.6, w: 8.6, t: 1.1, yaw: 0, y1: 3, mat: 'moss', style: 'jamb' });
    K.gate({ id: 'g1', x: 0, z: 6.6, w: 3.8, yaw: 0, signal: S => !S.observed('A'), speed: 1.5 });
    K.block({ x: -6.2, z: -10.6, w: 8.6, t: 1.1, yaw: 0, y1: 3, mat: 'moss', style: 'jamb' });
    K.block({ x: 6.2, z: -10.6, w: 8.6, t: 1.1, yaw: 0, y1: 3, mat: 'moss', style: 'jamb' });
    K.gate({ id: 'g2', x: 0, z: -10.6, w: 3.8, yaw: 0, signal: S => !S.observed('D'), speed: 1.5 });
    // A watches the start platform but is held by B; C collects; D guards the corridor
    eyeOnPillar(K, { px: 10, pz: 1.5, pr: 2.6, y: 5.5, look: [0, 1, 13], eye: { id: 'A', type: 'watcher', group: 'g', acquireTime: 2.1, range: 22, home: { sweep: [[-3.5, 0.8, 17], [3.5, 0.8, 9.5]], period: 6 } } });
    eyeOnPillar(K, { px: -10, pz: -0.5, pr: 2.6, y: 10, look: [10, 5.5, 1.5], eye: { id: 'B', type: 'watcher', acquireTime: 2.2, fov: 15 * DEG, periph: 1, home: { eye: 'A' } } });
    eyeOnPillar(K, { px: -8.5, pz: -13, pr: 2.4, y: 6.5, look: [0, 3, -4], eye: { id: 'C', type: 'collector', group: 'g', home: { eye: 'D' }, collect: { notice: 0.5, turn: 0.55 }, maxDev: 110 * DEG } });
    eyeOnPillar(K, { px: 6.5, pz: -18.5, pr: 2.2, y: 3.8, look: [0, 1, -15], eye: { id: 'D', type: 'watcher', acquireTime: 2.0, range: 16, home: { sweep: [[1.5, 0.8, -12.5], [-1.5, 0.8, -22]], period: 5 } } });
    K.tendon({ from: { eye: 'A' }, to: { mover: 'g1' }, sag: 4 });
    K.tendon({ from: { eye: 'D' }, to: { mover: 'g2' }, sag: 3 });
    K.shaft({ x: 0, z: -2, r: 11, depth: 80, rings: 8 });
    K.ribs({ x: 0, z: -2, r: 13, count: 7, h: 24, span: 'over', thick: 1.0, mat: 'moss' });
    K.mass({ seed: 61, style: 'arches' });
    K.lamp({ x: 0, y: 5, z: -2, color: '#c9b064', intensity: 0.5, dist: 14 });
  },
  hints: [
    { id: 'b', text: 'The left eye holds the one that would see you', focus: 'B', when: W => W.t > 1.5, until: W => W.eyeById.B.state === 'pinned', ms: 6000 },
    { id: 'c', text: 'Watch the one in the back. It gathers what you let go', when: W => W.eyeById.B.state === 'pinned' && W.eyeById.C.target && W.eyeById.C.target.orphan, until: W => W.player.pos[2] < -12, ms: 5000 }
  ],
  failHint: 'Hold the left eye, slip through as the gate opens, then wait for the gatherer to turn.'
});

// ---- 07 The Blind Seam -------------------------------------------------------
ENCOUNTERS.push({
  id: 'e07', act: 2, name: 'The Blind Seam',
  cam: { w: 20, ahead: 5 },
  look: 'act2',
  build(K) {
    K.spawn(0, 13);
    K.ring({ x: 0, z: 10, r1: 4.6, etch: 'spiral' });
    K.floor({ x: 0, z: -3.5, w: 2.4, l: 20, etch: 'rungs' });
    K.ring({ x: 0, z: -18, r1: 5, etch: 'spiral' });
    K.floor({ x: 0, z: -24.2, w: 3, l: 3 });
    K.exit({ x: 0, z: -25.2, yaw: -Math.PI / 2 });
    // the seam: two high walls
    K.block({ x: -2.1, z: -3.5, w: 18, t: 1.6, yaw: -Math.PI / 2, y1: 6, mat: 'moss', style: 'rib' });
    K.block({ x: 2.1, z: -3.5, w: 18, t: 1.6, yaw: -Math.PI / 2, y1: 6, mat: 'moss', style: 'rib' });
    // S hangs over the seam's end and looks down it, unless H holds it
    K.eye({ id: 'S', type: 'watcher', pos: [0, 8.5, -15.6], facing: vNorm([0, -0.45, 1]), acquireTime: 1.5, range: 21, fov: 16 * DEG, periph: 1, maxDev: 60 * DEG,
      home: { sweep: [[0, 0.8, 4], [0, 0.8, -12]], period: 4 } });
    eyeOnPillar(K, { px: 11, pz: -7, pr: 2.4, y: 8.5, look: [0, 8.5, -15.6], eye: { id: 'H', type: 'watcher', home: { eye: 'S' }, fov: 12 * DEG, periph: 1, range: 20 } });
    // a blade turns between H and S while R watches T
    K.rotor({ id: 'rot', x: 6.3, z: -12.9, mode: 'cont', omega: 0.42, signal: S => S.link('R', 'T'), accel: 0.8, r: 4, hub: false });
    K.blade({ x: 6.3, z: -12.9, w: 9, t: 0.7, y0: 6.2, y1: 12, yaw: 0, mover: 'rot' });
    K.pillar({ x: 6.3, z: -12.9, r: 0.8, top: 6.4, bottom: -70, style: 'tendon', mat: 'moss', block: false, occlude: false, cap: false });
    eyeOnPillar(K, { px: -9, pz: 6, pr: 2.3, y: 6.5, look: [-7, 4, -22], eye: { id: 'R', type: 'watcher', home: { eye: 'T' }, fov: 12 * DEG, periph: 1, range: 14 } });
    eyeOnPillar(K, { px: -7.5, pz: -23, pr: 2.2, y: 4.2, look: [0, 0.8, -18], eye: { id: 'T', type: 'watcher', acquireTime: 2.0, range: 15, home: { sweep: [[3.5, 0.8, -15.5], [-1, 0.8, -21]], period: 5 } } });
    K.tendon({ from: { eye: 'R' }, to: { mover: 'rot' }, sag: 7 });
    K.shaft({ x: 0, z: -4, r: 13, depth: 90, rings: 8 });
    K.mass({ seed: 71, style: 'towers' });
  },
  hints: [
    { id: 'seam', text: 'The eye above the seam is only blind while the right eye holds it', focus: 'H', when: W => W.t > 1.5, until: W => W.player.pos[2] < 4, ms: 7000 },
    { id: 'blade', text: 'The blade turns while the far left eye watches', focus: 'R', when: W => W.t > 9 && W.player.pos[2] > 4, until: W => W.eyeById.R.state === 'pinned', ms: 6000 }
  ],
  failHint: 'Hold the left eye the moment the blade leaves the line between the two right-hand eyes.'
});

// ---- 08 The Choir --------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e08', act: 2, name: 'The Choir',
  cam: { w: 22, ahead: 3 },
  look: 'act2',
  build(K) {
    K.spawn(0, 10);
    K.floor({ x: 0, z: 7, w: 3, l: 6.2 });
    K.ring({ x: 0, z: -4, r1: 8.2, etch: 'radial' });
    K.floor({ x: 0, z: -15.5, w: 3.4, l: 7.4, etch: 'rungs' });
    K.exit({ x: 0, z: -18.6, yaw: -Math.PI / 2 });
    K.block({ x: -5.5, z: -12.4, w: 7.4, t: 1.2, yaw: 0, y1: 7, mat: 'moss', style: 'jamb' });
    K.block({ x: 5.5, z: -12.4, w: 7.4, t: 1.2, yaw: 0, y1: 7, mat: 'moss', style: 'jamb' });
    K.gate({ id: 'g', x: 0, z: -12.4, w: 3.6, yaw: 0, signal: S => !S.synced('ring'), speed: 1.2 });
    // the ring: c1 -> c2 -> c3 -> c4 -> c1, each holding the next
    const P = { c1: [-9.4, -3], c2: [-5, -11], c3: [5, -11], c4: [9.4, -3] };
    const next = { c1: 'c2', c2: 'c3', c3: 'c4', c4: 'c1' };
    for (const id in P) {
      const [x, z] = P[id];
      const tag = K.pillar({ x, z, r: 1.3, top: 3.2, bottom: -60, style: 'knotted', mat: 'bone', cap: false });
      K.eye({ id, type: 'choir', group: 'ring', host: tag, pos: [x, 4.5, z], facing: vNorm([-x * 0.6, 0.15, (-4 - z) * 0.6]), home: { eye: next[id] }, heal: 2.0, acquireTime: 1.9, fov: 18 * DEG, range: 22 });
    }
    // a column that hides c1 and c3 from each other
    K.pillar({ x: -4.8, z: -5.6, r: 1.15, top: 16, style: 'tendon', mat: 'moss' });
    K.tendon({ from: { p: [-5, 2, -11] }, to: { mover: 'g' }, sag: 2 });
    K.tendon({ from: { p: [5, 2, -11] }, to: { mover: 'g' }, sag: 2 });
    K.shaft({ x: 0, z: -4, r: 11, depth: 80, rings: 8 });
    K.ribs({ x: 0, z: -4, r: 14, count: 8, h: 22, span: 'over', thick: 1.0, mat: 'moss' });
    K.mass({ seed: 81, style: 'arches' });
    K.lamp({ x: 0, y: 3, z: -4, color: '#c9b064', intensity: 0.45, dist: 12 });
  },
  hints: [
    { id: 'ring', text: 'Four eyes hold each other. Break the ring and the gate opens', when: W => W.t > 1.2, until: W => W.gaze.target && W.eyeById[W.gaze.target].state === 'pinned', ms: 6000 },
    { id: 'heal', text: 'The ring closes around the one you hold. Find one it cannot close around', when: W => W.flags.healedOnce, until: W => !W.flags.healedOnce || W.player.pos[2] < -12, ms: 6000 }
  ],
  init(W) {
    W.script = { update(W) { if (W.gaze.target && W.eyeById[W.gaze.target].state === 'pinned' && groupSynced(W, 'ring')) W.flags.healedOnce = true; } };
  },
  failHint: 'The column hides two of the eyes from each other.'
});

// ---- 09 The Narrow Crossing ---------------------------------------------------------
ENCOUNTERS.push({
  id: 'e09', act: 2, name: 'The Narrow Crossing',
  cam: { w: 18, ahead: 5 },
  look: 'act2',
  build(K) {
    K.spawn(0, 13.5);
    K.ring({ x: 0, z: 12, r1: 4.2, etch: 'spiral' });
    K.floor({ x: 0, z: -6, w: 1.9, l: 28.4, etch: 'rungs' });
    K.ring({ x: 0, z: -24.2, r1: 4.6, etch: 'spiral' });
    K.floor({ x: 0, z: -30, w: 3, l: 3.4 });
    K.exit({ x: 0, z: -31, yaw: -Math.PI / 2 });
    // each gate answers to where a drifter is
    K.gate({ id: 'g1', x: 0, z: 0, w: 1.9, h: 3.6, yaw: 0, signal: S => S.eye('D1').pos[2] > -5, speed: 1.6, sight: false });
    K.gate({ id: 'g2', x: 0, z: -11.5, w: 1.9, h: 3.6, yaw: 0, signal: S => S.eye('D2').pos[2] < -7, speed: 1.6, sight: false });
    const r1 = [], r2 = [];
    for (let i = 0; i <= 8; i++) { const z = lerp(6, -19.5, i / 8); r1.push([-2.3, 6.8, z]); r2.push([2.3, 7.4, z]); }
    K.eye({ id: 'D1', type: 'drifter', pos: r1[0], facing: [0.25, -1, 0], rail: { pts: r1, speed: 3.0, look: vNorm([0.32, -1, 0.05]), pause: 0.6, u: 0 }, acquireTime: 1.9, range: 13, fov: 20 * DEG });
    K.eye({ id: 'D2', type: 'drifter', pos: r2[0], facing: [-0.25, -1, 0], rail: { pts: r2, speed: 2.4, look: vNorm([-0.32, -1, -0.05]), pause: 0.6, u: 14 }, acquireTime: 1.9, range: 13, fov: 20 * DEG });
    K.tendon({ from: { p: [-2.3, 4, -5] }, to: { mover: 'g1' }, sag: 2 });
    K.tendon({ from: { p: [2.3, 4, -7] }, to: { mover: 'g2' }, sag: 2 });
    K.shaft({ x: 0, z: -6, r: 12, depth: 110, rings: 10 });
    K.ribs({ x: 0, z: 0, r: 6, count: 7, along: 'z', z0: 6, z1: -20, h: 12, thick: 0.7, span: 'vault', mat: 'moss' });
    K.mass({ seed: 91, style: 'towers' });
  },
  hints: [
    { id: 'two', text: 'Each gate opens with a drifter. Holding one keeps its gate as it is', when: W => W.t > 1.2, until: W => W.player.pos[2] < -1, ms: 6500 }
  ],
  failHint: 'Hold the left drifter while its gate is open. Then wait for the right one.'
});

// ---- 10 The First Collapse ------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e10', act: 2, name: 'The First Collapse',
  cam: { w: 20, ahead: 5 },
  look: 'act2',
  build(K) {
    K.spawn(0, 9.5);
    K.floor({ x: 0, z: 6.5, w: 3, l: 6 });
    K.ring({ x: 0, z: -3, r1: 7, etch: 'spiral' });
    K.floor({ x: 0, z: -11.2, w: 3.4, l: 3 });
    K.block({ x: -5.2, z: -11.6, w: 7, t: 1.2, yaw: 0, y1: 6, mat: 'moss', style: 'jamb' });
    K.block({ x: 5.2, z: -11.6, w: 7, t: 1.2, yaw: 0, y1: 6, mat: 'moss', style: 'jamb' });
    K.gate({ id: 'g', x: 0, z: -11.6, w: 3.4, yaw: 0, signal: S => !S.observed('K'), speed: 1.3 });
    // the escape: two spans that will not wait for you
    K.bridge({ id: 'b1', ax: 0, az: -12.5, yaw: -Math.PI / 2, len: 8.2, w: 2.2, open: true, speed: 0.55, signal: S => !(S.flag('collapse') && S.t > S.num('collapseAt') + 6.5) });
    K.ring({ x: 0, z: -23.4, r1: 3.2, etch: 'spiral' });
    K.bridge({ id: 'b2', ax: 0, az: -26.4, yaw: -Math.PI / 2, len: 8.6, w: 2.2, open: true, speed: 0.55, signal: S => !(S.flag('collapse') && S.t > S.num('collapseAt') + 11) });
    K.ring({ x: 0, z: -37.6, r1: 3.6, etch: 'spiral' });
    K.floor({ x: 0, z: -42.2, w: 3, l: 3 });
    K.exit({ x: 0, z: -43, yaw: -Math.PI / 2 });
    // K sits over the gate, held by J. Free it and everything starts to go.
    K.eye({ id: 'K', type: 'watcher', ignore: ['lintel'], pos: [0, 8.6, -12.6], facing: vNorm([0, -0.4, 1]), acquireTime: 2.4, range: 22, fov: 20 * DEG, maxDev: 55 * DEG, home: { sweep: [[-4, 0.8, -1], [4, 0.8, -8]], period: 4 } });
    K.block({ x: 0, z: -12.6, w: 5, t: 2.2, yaw: 0, y0: 6.5, y1: 11, mat: 'bone', style: 'rib', block: false, tag: 'lintel' });
    eyeOnPillar(K, { px: -9.5, pz: -3, pr: 2.4, y: 7.5, look: [0, 8.6, -12.6], eye: { id: 'J', type: 'watcher', home: { eye: 'K' }, fov: 14 * DEG, periph: 1, range: 18 } });
    // sleepers along the escape
    eyeOnPillar(K, { px: 5.5, pz: -20.5, pr: 2, y: 3.6, look: [0, 0.8, -23], eye: { id: 'E1', type: 'watcher', dormant: true, wake: S => S.flag('collapse') && S.t > S.num('collapseAt') + 2.5, acquireTime: 1.9, range: 14, home: { sweep: [[2, 0.8, -16], [-2, 0.8, -26]], period: 3.5 } } });
    eyeOnPillar(K, { px: -5.5, pz: -34, pr: 2, y: 3.6, look: [0, 0.8, -36], eye: { id: 'E2', type: 'watcher', dormant: true, wake: S => S.flag('collapse') && S.t > S.num('collapseAt') + 7, acquireTime: 1.9, range: 14, home: { sweep: [[-2, 0.8, -29], [2, 0.8, -39]], period: 3.5 } } });
    K.tendon({ from: { eye: 'K' }, to: { mover: 'g' }, sag: 1.5 });
    K.shaft({ x: 0, z: -24, r: 12, depth: 120, rings: 11 });
    K.ribs({ x: 0, z: -3, r: 12, count: 7, h: 22, span: 'over', thick: 1.0, mat: 'moss' });
    K.mass({ seed: 101, style: 'arches' });
  },
  init(W) {
    W.script = { update(W) { const g = W.moverById.g; if (!W.flags.collapse && g.e > 0.5) { W.flags.collapse = true; W.flags.collapseAt = W.t; W.emit('collapse'); } } };
  },
  hints: [
    { id: 'k', text: 'The eye over the gate is held from the left', focus: 'J', when: W => W.t > 1.2, until: W => W.eyeById.J.state === 'pinned', ms: 6000 },
    { id: 'run', text: 'Run', when: W => W.flags.collapse, until: W => W.player.pos[2] < -20, ms: 2500 }
  ],
  failHint: 'The spans fall in order. Hold only what you must, and keep moving.'
});
