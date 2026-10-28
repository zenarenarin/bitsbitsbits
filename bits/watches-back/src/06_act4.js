// =====================================================================
// Act IV — Convergence. Ink and bone, a cold overhead light. The network
// stops hiding its threads, and everything turns toward the centre.
// =====================================================================

// ---- 17 The Network -----------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e17', act: 4, name: 'The Network',
  cam: { w: 24, ahead: 3 },
  look: 'act4',
  build(K) {
    K.spawn(0, 20.5);
    K.floor({ x: 0, z: 18, w: 3, l: 5 });
    K.ring({ x: 0, z: 12, r1: 4.4, etch: 'spiral' });
    K.floor({ x: 0, z: 7, w: 3.4, l: 3.6 });
    K.ring({ x: 0, z: -2, r1: 7.4, etch: 'radial' });
    K.floor({ x: 0, z: -10.8, w: 3.4, l: 3.4 });
    K.floor({ x: 0, z: -17, w: 3.6, l: 9.4, etch: 'rungs' });
    K.exit({ x: 0, z: -21, yaw: -Math.PI / 2 });
    K.block({ x: -5.6, z: 6.6, w: 7.8, t: 1, yaw: 0, y1: 3, mat: 'ink', style: 'jamb' });
    K.block({ x: 5.6, z: 6.6, w: 7.8, t: 1, yaw: 0, y1: 3, mat: 'ink', style: 'jamb' });
    K.gate({ id: 'g1', x: 0, z: 6.6, w: 3.4, yaw: 0, signal: S => S.observed('B'), speed: 1.3 });
    K.block({ x: -5.6, z: -11, w: 7.8, t: 1, yaw: 0, y1: 3, mat: 'ink', style: 'jamb' });
    K.block({ x: 5.6, z: -11, w: 7.8, t: 1, yaw: 0, y1: 3, mat: 'ink', style: 'jamb' });
    K.gate({ id: 'g2', x: 0, z: -11, w: 3.4, yaw: 0, signal: S => !S.observed('Z'), speed: 1.3 });
    // B guards the start and is free. C would hold it, if the screen let it see.
    eyeOnPillar(K, { px: -10, pz: 12, pr: 2.3, y: 4.6, look: [0, 0.8, 11], eye: { id: 'B', type: 'watcher', group: 'n', acquireTime: 2.4, range: 13, fov: 17 * DEG, periph: 1.3, home: { sweep: [[-2, 0.8, 13], [2, 0.8, 8.6]], period: 5 } } });
    eyeOnPillar(K, { px: 11, pz: 1, pr: 2.4, y: 7, look: [-4, 2, 6], eye: { id: 'C', type: 'collector', group: 'n', home: { point: [3, 0.5, -2] }, collect: { notice: 0.5, turn: 0.7 }, fov: 9 * DEG, range: 30 } });
    K.rotor({ id: 'r1', x: 4.5, z: 7.2, mode: 'toggle', angles: [0, 1.75], signal: S => !S.link('X', 'Y'), speed: 0.55, r: 3, hub: false });
    K.blade({ x: 4.5, z: 4.7, w: 5, t: 0.7, y0: 4, y1: 11, yaw: 0, mover: 'r1' });
    K.pillar({ x: 4.5, z: 7.2, r: 0.7, top: 4.2, bottom: -70, style: 'tendon', mat: 'ink', block: false, occlude: false, cap: false });
    // X holds Y; Y holds Z; Z holds the second gate shut.
    eyeOnPillar(K, { px: -10.5, pz: -9, pr: 2.4, y: 8, look: [10, 9.5, -9], eye: { id: 'X', type: 'watcher', home: { eye: 'Y' }, fov: 12 * DEG, periph: 1, range: 30 } });
    eyeOnPillar(K, { px: 10.5, pz: -9.5, pr: 2.4, y: 9.5, look: [0, 4.4, -12.4], eye: { id: 'Y', type: 'watcher', home: { eye: 'Z' }, fov: 22 * DEG, range: 20, acquireTime: 2.6 } });
    K.eye({ id: 'Z', type: 'watcher', ignore: ['lintel'], pos: [0, 5.2, -12.4], facing: vNorm([0, -0.6, 1]), home: { sweep: [[-4, 0.8, 0], [4, 0.8, 2]], period: 5 }, acquireTime: 2.4, range: 18, fov: 16 * DEG, maxDev: 50 * DEG });
    K.block({ x: 0, z: -12.6, w: 5, t: 1.8, yaw: 0, y0: 4.8, y1: 9.5, mat: 'bone', style: 'rib', block: false, tag: 'lintel' });
    K.tendon({ from: { eye: 'B' }, to: { mover: 'g1' }, sag: 3 });
    K.tendon({ from: { eye: 'Z' }, to: { mover: 'g2' }, sag: 1.5 });
    K.tendon({ from: { eye: 'X' }, to: { mover: 'r1' }, sag: 6 });
    K.shaft({ x: 0, z: -2, r: 12, depth: 100, rings: 9 });
    K.ribs({ x: 0, z: -2, r: 15, count: 9, h: 26, span: 'over', thick: 1.1, mat: 'bone' });
    K.mass({ seed: 171, style: 'arches' });
  },
  hints: [
    { id: 'n', text: 'Every thread is visible now. Follow them', when: W => W.t > 1.2, until: W => W.t > 7, ms: 5000 },
    { id: 'n2', text: 'The far right eye only lets go of the gate eye if it sees you', when: W => W.player.pos[2] < 4, until: W => W.eyeById.Y.state === 'pinned', ms: 6500 }
  ],
  failHint: 'The left eye moves the screen. The right eye must be tempted away, then held.'
});

// ---- 18 Unblinking ---------------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e18', act: 4, name: 'Unblinking',
  cam: { w: 24, ahead: 2 },
  look: 'act4',
  build(K) {
    const C = [0, -5];
    K.spawn(0, 10);
    K.floor({ x: 0, z: 8, w: 3, l: 6 });
    K.ring({ x: C[0], z: C[1], r0: 3.4, r1: 11, etch: 'radial' });
    K.floor({ x: 0, z: -17.6, w: 3.4, l: 3.4 });
    K.floor({ x: 0, z: -23, w: 3.6, l: 7.6, etch: 'rungs' });
    K.exit({ x: 0, z: -26.4, yaw: -Math.PI / 2 });
    K.wall({ x: C[0], z: C[1], r0: 11.6, r1: 13, a0: -Math.PI / 2 + 0.2, a1: Math.PI / 2 - 0.16, y1: 14, mat: 'ink', low: 1.6 });
    K.wall({ x: C[0], z: C[1], r0: 11.6, r1: 13, a0: Math.PI / 2 + 0.16, a1: 3 * Math.PI / 2 - 0.2, y1: 14, mat: 'ink', low: 1.6 });
    K.block({ x: -3, z: -17.4, w: 3.8, t: 1, yaw: 0, y1: 6, mat: 'ink', style: 'jamb' });
    K.block({ x: 3, z: -17.4, w: 3.8, t: 1, yaw: 0, y1: 6, mat: 'ink', style: 'jamb' });
    K.gate({ id: 'g', x: 0, z: -17.4, w: 3.4, yaw: 0, signal: S => S.observed('U'), speed: 1.3 });
    // the lidless one, on a stem in the pit
    K.pillar({ x: C[0], z: C[1], r: 1.6, top: 3.2, bottom: -100, style: 'tendon', mat: 'ink', cap: false, occlude: false });
    K.eye({ id: 'U', type: 'unblinking', pos: [C[0], 5.6, C[1]], facing: [0, 0.1, 1], mount: 'free', acquireTime: 3.0, range: 40, fov: 40 * DEG, turn: 0.9, acqTurn: 0.9, maxDev: 180 * DEG });
    for (const a of [0.6, 2.55, 3.75, 5.6]) K.pillar({ x: C[0] + Math.cos(a) * 7.2, z: C[1] + Math.sin(a) * 7.2, r: 1.25, top: 14, style: 'knotted', mat: 'bone' });
    eyeOnPillar(K, { px: -15, pz: -7, pr: 2.6, y: 9, look: [0, 5, -5], top: 26, style: 'core', eye: { id: 'M', type: 'mimic', mimic: { delay: 2.4 }, home: { point: [-6, 0.5, -2] }, acquireTime: 1.8, range: 40, maxDev: 120 * DEG } });
    eyeOnPillar(K, { px: 6.5, pz: -21, pr: 2.1, y: 3.8, look: [0, 0.8, -21], eye: { id: 'W', type: 'watcher', acquireTime: 2.2, range: 13, fov: 20 * DEG, home: { sweep: [[0, 0.8, -19], [0, 0.8, -25]], period: 4 } } });
    K.tendon({ from: { eye: 'M' }, to: { mover: 'g' }, sag: 5 });
    K.shaft({ x: C[0], z: C[1], r: 3.2, depth: 120, rings: 10 });
    K.ribs({ x: C[0], z: C[1], r: 14, count: 10, h: 24, span: 'crown', thick: 1.1, mat: 'ink' });
    K.mass({ seed: 181, style: 'towers' });
  },
  hints: [
    { id: 'u', text: 'It has no lids. Your gaze slides off it', when: W => W.gaze.refused, until: W => W.eyeById.U.target && W.eyeById.U.target.stare, ms: 5000 },
    { id: 'u2', text: 'The tall eye copies what you look at', focus: 'M', when: W => W.t > 6, until: W => W.eyeById.U.target && W.eyeById.U.target.stare, ms: 6000 },
    { id: 'u3', text: 'Keep looking at it. Its own kind holds it for you', when: W => W.eyeById.U.target && W.eyeById.U.target.stare, until: W => W.player.pos[2] < -18, ms: 4000 }
  ],
  failHint: 'Look at the lidless eye and keep looking. The mimic will hold it, and the gate opens.'
});

// ---- 19 The Crown ------------------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e19', act: 4, name: 'The Crown',
  cam: { w: 26, ahead: 4 },
  look: 'act4',
  build(K) {
    const CC = [0, -15];
    K.spawn(0, 10);
    K.floor({ x: 0, z: 8, w: 3, l: 4 });
    K.ring({ x: 0, z: 0, r1: 7.4, etch: 'spiral' });
    K.floor({ x: 9, z: -3, w: 3.2, l: 5.4, yaw: 0 });
    K.bridge({ id: 'span', ax: 10.2, az: -4.4, yaw: -Math.PI / 2, len: 20, w: 2.2, signal: S => S.pinned('X'), speed: 0.55, prime: 0.6 });
    K.ring({ x: 10.2, z: -27.4, r1: 3.4, etch: 'spiral' });
    K.floor({ x: 10.2, z: -32, w: 3, l: 3.4 });
    K.exit({ x: 10.2, z: -33.2, yaw: -Math.PI / 2 });
    for (const a of [0.9, 2.3, 3.9]) K.pillar({ x: Math.cos(a) * 5.2, z: Math.sin(a) * 5.2, r: 1.15, top: 12, style: 'knotted', mat: 'bone' });
    // the crown: a great eye on a spire, ringed by five that hold each other and shield it
    K.pillar({ x: CC[0], z: CC[1], r: 2.3, top: 5, bottom: -100, style: 'core', mat: 'bone', cap: false });
    K.eye({ id: 'X', type: 'crown', shield: 'crown', pos: [CC[0], 8.2, CC[1]], facing: vNorm([0, -0.25, 1]), mount: 'free', home: { sweep: [[-5, 0.8, 1], [6, 0.8, -4]], period: 7 }, acquireTime: 3.0, range: 20, fov: 26 * DEG, maxDev: 100 * DEG, turn: 0.8, acqTurn: 0.8 });
    K.rotor({ id: 'crown', x: CC[0], z: CC[1], mode: 'cont', omega: 0.22, signal: S => !S.pinned('X'), accel: 1.2, r: 6.6, hub: true });
    K.ring({ x: CC[0], z: CC[1], r0: 5.4, r1: 7.4, mover: 'crown', mat: 'ink', y: 3.4, keel: true, lip: true });
    const names = ['s1', 's2', 's3', 's4', 's5'];
    names.forEach((id, i) => {
      const a = i / 5 * TAU + 0.3, x = CC[0] + Math.cos(a) * 6.4, z = CC[1] + Math.sin(a) * 6.4;
      K.eye({ id, type: 'choir', group: 'crown', mover: 'crown', pos: [x, 5.2, z], facing: vNorm([Math.cos(a), 0.1, Math.sin(a)]), home: { eye: names[(i + 1) % 5] }, heal: 1.6, acquireTime: 2.4, fov: 16 * DEG, range: 24, maxDev: 130 * DEG });
    });
    K.tendon({ from: { eye: 'X' }, to: { mover: 'span' }, sag: 3 });
    K.shaft({ x: CC[0], z: CC[1], r: 9, depth: 140, rings: 12 });
    K.ribs({ x: CC[0], z: CC[1], r: 16, count: 11, h: 30, span: 'crown', thick: 1.3, mat: 'bone' });
    K.mass({ seed: 191, style: 'spiral' });
    K.lamp({ x: CC[0], y: 13, z: CC[1], color: '#e9c27c', intensity: 0.8, dist: 24 });
  },
  hints: [
    { id: 'c', text: 'Its ring shields it. Your gaze slides off while the ring is whole', when: W => W.gaze.refused && W.gaze.target === 'X', until: W => W.eyeById.X.state === 'pinned', ms: 6000 },
    { id: 'c2', text: 'Break the ring, then turn to the crown before it closes', when: W => W.gaze.target && W.eyeById[W.gaze.target].group === 'crown' && W.eyeById[W.gaze.target].state === 'pinned', until: W => W.eyeById.X.state === 'pinned', ms: 5000 }
  ],
  failHint: 'Hold one of the five. While the ring is broken, the crown can be held.'
});

// ---- 20 The Centre ------------------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e20', act: 4, name: 'The Centre',
  cam: { w: 26, ahead: 1 },
  look: 'act4',
  final: true,
  build(K) {
    K.spawn(0, 25);
    K.floor({ x: 0, z: 19.5, w: 3.4, l: 11 });
    K.ring({ x: 0, z: 0, r0: 12.4, r1: 15.4, etch: 'radial' });
    K.bridge({ id: 'pupil', ax: 0, az: 12.6, yaw: -Math.PI / 2, len: 8.2, w: 2.4, signal: S => S.count('C') >= 3, speed: 0.6 });
    K.ring({ x: 0, z: 2.8, r1: 2.1, etch: 'spiral' });
    K.exit({ x: 0, z: 2.6, r: 1.1, yaw: -Math.PI / 2, size: 1.6 });
    // the thing itself
    K.eye({ id: 'C', type: 'centre', pos: [0, 7.2, -3], facing: vNorm([0, 0, 1]), mount: 'free', size: 6.5, acquireTime: 3.6, range: 90, fov: 60 * DEG, turn: 0.55, acqTurn: 0.55, maxDev: 180 * DEG });
    // three that copy you, slower each
    eyeOnPillar(K, { px: -18, pz: -2, pr: 2.6, y: 9, look: [0, 7, -3], top: 30, style: 'core', eye: { id: 'M1', type: 'mimic', mimic: { delay: 1.0 }, home: { point: [-8, 0.5, 6] }, acquireTime: 2.0, range: 50, maxDev: 120 * DEG } });
    eyeOnPillar(K, { px: 0, pz: -20, pr: 2.6, y: 13, look: [0, 7, -3], top: 32, style: 'core', eye: { id: 'M2', type: 'mimic', mimic: { delay: 2.0 }, home: { point: [0, 0.5, 8] }, acquireTime: 2.0, range: 50, maxDev: 120 * DEG } });
    eyeOnPillar(K, { px: 18, pz: -2, pr: 2.6, y: 9, look: [0, 7, -3], top: 30, style: 'core', eye: { id: 'M3', type: 'mimic', mimic: { delay: 3.0 }, home: { point: [8, 0.5, 6] }, acquireTime: 2.0, range: 50, maxDev: 120 * DEG } });
    // witnesses wake when the way opens
    for (const [id, a] of [['W1', 2.25], ['W2', 0.9]]) {
      const x = Math.cos(a) * 17.4, z = Math.sin(a) * 17.4;
      eyeOnPillar(K, { px: x, pz: z, pr: 2.2, y: 5, look: [0, 0.8, 8], eye: { id, type: 'watcher', dormant: true, wake: S => S.mover('pupil').e > 0.35, acquireTime: 3.4, range: 26, fov: 26 * DEG, home: { point: [0, 0.8, 8] } } });
    }
    for (const a of [0.35, 1.35, 1.8, 2.8, 3.6, 4.4, 5.0, 5.8]) K.pillar({ x: Math.cos(a) * 13.9, z: Math.sin(a) * 13.9, r: 0.9, top: 18, style: 'knotted', mat: 'bone' });
    K.shaft({ x: 0, z: 0, r: 11.6, depth: 160, rings: 14 });
    K.ribs({ x: 0, z: 0, r: 19, count: 14, h: 40, span: 'crown', thick: 1.6, mat: 'bone' });
    K.mass({ seed: 201, style: 'towers' });
    K.lamp({ x: 0, y: 9, z: 4, color: '#f1e2b0', intensity: 0.9, dist: 20 });
  },
  hints: [
    { id: 'c1', text: 'It cannot be held by you', when: W => W.t > 1.5, until: W => W.eyeById.C.target && W.eyeById.C.target.stare, ms: 4500 },
    { id: 'c2', text: 'Look at it, and keep looking', when: W => W.t > 6, until: W => W.moverById.pupil.e > 0.2, ms: 6000 },
    { id: 'c3', text: 'Do not look away', when: W => W.moverById.pupil.e > 0.3, until: W => W.status !== 'play', ms: 4000 }
  ],
  failHint: 'Look only at it. When all three hold it, walk into the eye.'
});
