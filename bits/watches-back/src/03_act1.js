// =====================================================================
// Act I — Attention. Bone architecture, olive haze, a high cold light.
// =====================================================================
const ENCOUNTERS = [];
const N = -Math.PI / 2, S_ = Math.PI / 2, E_ = 0, W_ = Math.PI;

// ---- 01 First Witness ----------------------------------------------------
ENCOUNTERS.push({
  id: 'e01', act: 1, name: 'First Witness',
  cam: { pitch: 56, dist: 34, fov: 40, z0: 20, z1: -21, x0: -3, x1: 3 },
  look: 'act1',
  build(K) {
    K.spawn(0, 21);
    K.floor({ x: 0, z: 9.5, w: 4, l: 25, etch: 'rungs' });
    K.ring({ x: 0, z: -12, r1: 9.5, etch: 'spiral' });
    K.floor({ x: 0, z: -24, w: 3.2, l: 6, etch: 'rungs' });
    K.wall({ x: 0, z: -12, r0: 10.6, r1: 12.4, a0: S_ + 0.34, a1: N + TAU - 0.24, y1: 15 });
    K.wall({ x: 0, z: -12, r0: 10.6, r1: 12.4, a0: N + 0.24, a1: S_ - 0.34, y1: 15 });
    K.block({ x: -2.3, z: -24.5, w: 7, t: 1.2, yaw: N, y1: 14, mat: 'bone', style: 'jamb' });
    K.block({ x: 2.3, z: -24.5, w: 7, t: 1.2, yaw: N, y1: 14, mat: 'bone', style: 'jamb' });
    const p1 = K.pillar({ x: 4.6, z: -11, r: 2.3, top: 30, mat: 'bone', style: 'fluted' });
    K.pillar({ x: -5.2, z: -13.5, r: 1.3, top: 30, mat: 'bone', style: 'fluted' });
    const yaw = Math.atan2(-2 + 11, 0 - 4.6);
    const m = K.onPillar(4.6, -11, 2.3, 4.6, yaw, -0.3);
    K.eye({ id: 'W', type: 'watcher', host: p1, pos: m.pos, facing: m.facing, acquireTime: 3.2,
      home: { sweep: [[-5.5, 0.8, -4.5], [-3.5, 0.8, -18.5]], period: 9 } });
    K.exit({ x: 0, z: -26.2, yaw: N });
    K.ribs({ x: 0, z: -12, r: 13, count: 7, h: 24, span: 'over', thick: 1.1 });
    K.shaft({ x: 0, z: 8, r: 6, depth: 70 });
    K.mass({ seed: 11, style: 'towers' });
    K.roots({ x: 0, z: -12, r: 11, n: 9, top: 30 });
    K.lamp({ x: 0, y: 9, z: -12, color: '#d9b26a', intensity: 0.6, dist: 22 });
  },
  hints: [
    { id: 'move', text: 'Drag on the left side to move', stick: true, until: W => W.player.pos[2] < 17 },
    { id: 'tap', text: 'Tap the eye to hold its gaze', focus: 'W', when: W => W.eyeById.W.state === 'alert' || W.eyeById.W.state === 'acquiring' || W.player.pos[2] < -4, until: W => W.eyeById.W.state === 'pinned' },
    { id: 'held', text: 'Held eyes see nothing. Walk past', when: W => W.eyeById.W.state === 'pinned', until: W => W.player.pos[2] < -19, ms: 3800 }
  ],
  failHint: 'Tap the eye before it finishes looking at you.'
});

// ---- 02 The Unwatched -------------------------------------------------------
ENCOUNTERS.push({
  id: 'e02', act: 1, name: 'The Unwatched',
  cam: { pitch: 56, dist: 34, fov: 40, z0: 22, z1: -24, x0: -2, x1: 2 },
  look: 'act1',
  build(K) {
    K.spawn(0, 24);
    K.floor({ x: 0, z: 0, w: 5.4, l: 52, etch: 'rungs' });
    K.floor({ x: 0, z: -28.5, w: 3, l: 5, etch: 'rungs' });
    // flanking walls with deep alcoves
    K.block({ x: -4.4, z: 0, w: 52, t: 1.6, yaw: N, y1: 22, mat: 'bone', style: 'colonnade', tag: 'wl' });
    K.block({ x: 4.4, z: 0, w: 52, t: 1.6, yaw: N, y1: 22, mat: 'bone', style: 'colonnade', tag: 'wr' });
    const pc = K.pillar({ x: 0.2, z: -5, r: 1.15, top: 22, style: 'fluted' });
    // left watcher low in the wall, right watcher further on
    K.eye({ id: 'L', type: 'watcher', pos: [-3.4, 3.4, 4], facing: dirYP(-0.25, -0.35), acquireTime: 2.0, ignore: ['wl'], maxDev: 52 * DEG, range: 18,
      home: { sweep: [[-1.4, 0.8, 7], [1.6, 0.8, -7]], period: 7 } });
    K.eye({ id: 'R', type: 'watcher', pos: [3.4, 3.4, -13], facing: dirYP(W_ + 0.25, -0.35), acquireTime: 2.0, ignore: ['wr'], maxDev: 52 * DEG, range: 18,
      home: { sweep: [[1.4, 0.8, -2], [-1.6, 0.8, -21]], period: 7, phase: 0.5 } });
    K.exit({ x: 0, z: -29.5, yaw: N });
    K.ribs({ x: 0, z: 0, r: 7, count: 6, along: 'z', z0: 14, z1: -26, h: 11, thick: 0.8, span: 'vault' });
    K.mass({ seed: 23, style: 'towers' });
    K.shaft({ x: 0, z: -31, r: 5, depth: 60 });
  },
  hints: [
    { id: 'one', text: 'You can hold only one', when: W => W.player.pos[2] < 10, until: W => W.player.pos[2] < -8, ms: 4200 },
    { id: 'away', text: 'Look at another eye and the first is released', when: W => W.player.pos[2] < -2 && W.eyeById.L.state === 'pinned', until: W => W.eyeById.R.state === 'pinned', ms: 4000 }
  ],
  failHint: 'Hide behind the column while you change which eye you hold.'
});

// ---- 03 The Bridge -------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e03', act: 1, name: 'The Bridge',
  cam: { pitch: 57, dist: 36, fov: 40, z0: 12, z1: -18, x0: -2, x1: 2 },
  look: 'act1',
  build(K) {
    K.spawn(0, 13);
    K.ring({ x: 0, z: 9, r1: 5.4, etch: 'spiral' });
    K.floor({ x: 0, z: 15.5, w: 3, l: 3 });
    K.ring({ x: 0, z: -14, r1: 5.2, etch: 'spiral' });
    K.floor({ x: 0, z: -20.5, w: 3, l: 4 });
    K.bridge({ id: 'span', ax: 0, az: 4.2, yaw: N, len: 13.6, w: 2.4, signal: S => !S.observed('B'), speed: 0.55 });
    const pa = K.pillar({ x: -8.5, z: -3, r: 2.7, top: 34, bottom: -70, style: 'fluted' });
    const pb = K.pillar({ x: 8.5, z: -5, r: 2.6, top: 34, bottom: -70, style: 'fluted' });
    const a = K.onPillar(-8.5, -3, 2.7, 7.5, Math.atan2(-5 + 3, 8.5 + 8.5), -0.1);
    K.eye({ id: 'A', type: 'watcher', host: pa, pos: a.pos, facing: a.facing, home: { eye: 'B' }, acquireTime: 2.4 });
    const b = K.onPillar(8.5, -5, 2.6, 5.5, W_ + 0.12, -0.15);
    K.eye({ id: 'B', type: 'watcher', host: pb, pos: b.pos, facing: b.facing, home: { point: [14, 0.5, -24] }, acquireTime: 2.4, maxDev: 50 * DEG });
    const pc = K.pillar({ x: -5.8, z: -18.8, r: 2.1, top: 28, style: 'fluted' });
    const c = K.onPillar(-5.8, -18.8, 2.1, 3.4, Math.atan2(-11 + 18.8, 0 + 5.8), -0.25);
    K.eye({ id: 'C', type: 'watcher', host: pc, pos: c.pos, facing: c.facing, acquireTime: 2.6, range: 13, home: { sweep: [[3.5, 0.8, -12], [-1.5, 0.8, -9]], period: 6 } });
    K.tendon({ from: { eye: 'B' }, to: { mover: 'span' }, sag: 6 });
    K.exit({ x: 0, z: -22, yaw: N });
    K.shaft({ x: 0, z: -2, r: 14, depth: 90, rings: 9 });
    K.ribs({ x: 0, z: -3, r: 16, count: 6, h: 28, span: 'over', thick: 1.3 });
    K.mass({ seed: 31, style: 'arches' });
    K.lamp({ x: 0, y: 6, z: -14, color: '#d9b26a', intensity: 0.5, dist: 16 });
  },
  hints: [
    { id: 'watch', text: 'The left eye holds the right one. Hold the left', focus: 'A', when: W => W.t > 1.2, until: W => W.eyeById.A.state === 'pinned', ms: 7000 },
    { id: 'keep', text: 'Keep holding it until you are across', when: W => W.eyeById.A.state === 'pinned' && W.moverById.span.e > 0.5, until: W => W.player.pos[2] < -9.5, ms: 4000 }
  ],
  failHint: 'Cross first. Only then look at the eye on the far side.'
});

// ---- 04 The Turning Structure ------------------------------------------------------
ENCOUNTERS.push({
  id: 'e04', act: 1, name: 'The Turning Structure',
  cam: { pitch: 58, dist: 38, fov: 40, z0: 6, z1: -20, x0: -3, x1: 3 },
  look: 'act1',
  build(K) {
    const cz = -8;
    K.spawn(0, 8);
    K.floor({ x: 0, z: 3.6, w: 3.2, l: 10.6, etch: 'rungs' });
    K.floor({ x: 0, z: -20, w: 3.2, l: 10.6, etch: 'rungs' });
    K.rotor({ id: 'ring', x: 0, z: cz, mode: 'cont', omega: 0.38, angle: -1.7, signal: S => S.link('X', 'Y'), accel: 0.5, r: 7.2 });
    K.ring({ x: 0, z: cz, r0: 4.3, r1: 7.3, a0: S_ - 0.62, a1: S_ + 0.62, mover: 'ring', etch: 'rungs', lip: true });
    const col = K.pillar({ x: 0, z: cz, r: 3, top: 40, bottom: -80, style: 'core' });
    const x = K.onPillar(0, cz, 3, 6, 0, -0.08);
    K.eye({ id: 'X', type: 'watcher', host: col, pos: x.pos, facing: x.facing, home: { eye: 'Y' }, acquireTime: 2.4, maxDev: 40 * DEG });
    const py = K.pillar({ x: 13.5, z: cz, r: 2.4, top: 34, bottom: -70 });
    const y = K.onPillar(13.5, cz, 2.4, 5.5, W_, -0.05);
    K.eye({ id: 'Y', type: 'watcher', host: py, pos: y.pos, facing: y.facing, home: { sweep: [[3, 0.8, -15.5], [-3, 0.8, -15.5]], period: 5 }, acquireTime: 2.0, maxDev: 70 * DEG });
    const pw = K.pillar({ x: -13.5, z: cz + 2, r: 2.3, top: 34, bottom: -70 });
    const w = K.onPillar(-13.5, cz + 2, 2.3, 3.8, 0, -0.2);
    K.eye({ id: 'Wd', type: 'watcher', host: pw, pos: w.pos, facing: w.facing, home: { sweep: [[-6.5, 0.8, cz + 4], [-6.5, 0.8, cz - 4]], period: 6 }, acquireTime: 2.3, fov: 20 * DEG, range: 10, maxDev: 35 * DEG });
    K.block({ x: -2.4, z: -21, w: 9, t: 1.2, yaw: N, y1: 10, mat: 'bone', style: 'jamb' });
    K.block({ x: 2.4, z: -21, w: 9, t: 1.2, yaw: N, y1: 10, mat: 'bone', style: 'jamb' });
    K.tendon({ from: { eye: 'X' }, to: { p: [0, -1, cz] }, sag: 2 });
    K.exit({ x: 0, z: -24.4, yaw: N });
    K.shaft({ x: 0, z: cz, r: 15, depth: 100, rings: 10 });
    K.ribs({ x: 0, z: cz, r: 17, count: 8, h: 28, span: 'crown', thick: 1.2 });
    K.mass({ seed: 41, style: 'towers' });
  },
  hints: [
    { id: 'ride', text: 'While the column watches, the ring turns', focus: 'X', when: W => W.t > 1, until: W => W.player.region && W.player.region.mover === 'ring', ms: 6000 },
    { id: 'stop', text: 'Hold the column eye to stop the ring', when: W => W.player.region && W.player.region.mover === 'ring', until: W => W.player.pos[2] < -15, ms: 5000 }
  ],
  failHint: 'Ride the ring past the left eye, then step off at the far side.'
});
