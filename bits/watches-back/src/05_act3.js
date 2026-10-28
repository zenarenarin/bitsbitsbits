// =====================================================================
// Act III — Deception. Amber light from low windows, darker stone.
// Eyes that copy you, eyes that watch places, eyes that lie.
// =====================================================================

// ---- 11 The Mimic -------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e11', act: 3, name: 'The Mimic',
  cam: { w: 20, ahead: 5 },
  look: 'act3',
  build(K) {
    K.spawn(0, 14);
    K.floor({ x: 0, z: 12, w: 5, l: 4.4 });
    K.floor({ x: 0, z: -6, w: 4.6, l: 32, etch: 'rungs' });
    K.floor({ x: 0, z: -24.6, w: 3, l: 5.4 });
    K.exit({ x: 0, z: -26.3, yaw: -Math.PI / 2 });
    // a drifter that runs the whole length, high on the left
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([-4.6, 6.6, lerp(8, -20, i / 8)]);
    K.eye({ id: 'D', type: 'drifter', pos: pts[0], facing: [0.4, -1, 0], rail: { pts, speed: 3.6, look: vNorm([0.42, -1, 0]), pause: 0.4, u: 6 }, acquireTime: 1.7, range: 14, fov: 22 * DEG });
    // the end watcher
    eyeOnPillar(K, { px: 4.5, pz: -24.5, pr: 2.2, y: 4.4, look: [0, 0.8, -12], eye: { id: 'W', type: 'watcher', acquireTime: 2.0, range: 20, home: { sweep: [[1, 0.8, -6], [-1, 0.8, -21]], period: 4.5 } } });
    // the mimic: it looks where you looked, a few heartbeats ago
    eyeOnPillar(K, { px: 10.5, pz: -4, pr: 2.6, y: 10, look: [0, 4, -6], top: 30, style: 'core', eye: { id: 'M', type: 'mimic', mimic: { delay: 3 }, home: { point: [0, 0.8, -4] }, acquireTime: 1.8, range: 40, maxDev: 110 * DEG } });
    K.block({ x: 5.8, z: -6, w: 26, t: 1.2, yaw: -Math.PI / 2, y1: 2.2, mat: 'ink', style: 'rib' });
    K.shaft({ x: 0, z: -6, r: 12, depth: 100, rings: 9 });
    K.ribs({ x: 0, z: 0, r: 7.5, count: 6, along: 'z', z0: 8, z1: -22, h: 13, thick: 0.8, span: 'vault', mat: 'bone' });
    K.mass({ seed: 111, style: 'stairs' });
    K.lamp({ x: -6, y: 3, z: -6, color: '#e0a64e', intensity: 0.6, dist: 16 });
  },
  hints: [
    { id: 'm', text: 'The tall eye looks wherever you looked, three heartbeats later', focus: 'M', when: W => W.t > 1.5, until: W => W.player.pos[2] < 2, ms: 6500 },
    { id: 'self', text: 'Never let it see you looking at it', when: W => W.eyeById.M.target && W.eyeById.M.target.kind === 'player', until: W => !(W.eyeById.M.target && W.eyeById.M.target.kind === 'player'), ms: 3500 }
  ],
  failHint: 'Hold the drifter a while, then the end eye. The mimic keeps holding the drifter for you.'
});

// ---- 12 The Sentinel ------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e12', act: 3, name: 'The Sentinel',
  cam: { w: 22, ahead: 4 },
  look: 'act3',
  build(K) {
    K.spawn(0, 15);
    K.ring({ x: 0, z: 12.5, r1: 3.6, etch: 'spiral' });
    K.floor({ x: 0, z: 8, w: 13, l: 2.4, etch: 'rungs' });
    for (const x of [-5.3, 5.3]) K.floor({ x, z: -4, w: 2.4, l: 22, etch: 'rungs' });
    K.floor({ x: 0, z: 1.8, w: 2.4, l: 10.4, etch: 'rungs' });
    K.floor({ x: 0, z: -4, w: 13, l: 2.4 });
    K.floor({ x: 0, z: -15.6, w: 13, l: 2.4 });
    K.floor({ x: 0, z: -19.5, w: 3, l: 6 });
    K.exit({ x: 0, z: -21.6, yaw: -Math.PI / 2 });
    // the patches it watches
    K.zone('za', { x: -5.3, z: 2, hw: 1.6, hl: 5, show: 'ring' });
    K.zone('zb', { x: 0, z: 2, hw: 1.6, hl: 5, show: 'ring' });
    K.zone('zc', { x: 5.3, z: 2, hw: 1.6, hl: 5, show: 'ring' });
    K.zone('zd', { x: -5.3, z: -10, hw: 1.6, hl: 5, show: 'ring' });
    K.zone('ze', { x: 0, z: -15.6, hw: 3, hl: 1.5, yaw: 0, show: 'ring' });
    K.zone('zf', { x: 5.3, z: -10, hw: 1.6, hl: 5, show: 'ring' });
    K.eye({ id: 'S', type: 'sentinel', pos: [0, 12, -27], facing: vNorm([0, -0.55, 1]), sentinel: { zones: ['zb', 'zd', 'za', 'zf', 'zc', 'ze'], period: 2.6, alarm: 30 }, acquireTime: 1.0, range: 60 });
    K.pillar({ x: 0, z: -29.5, r: 3, top: 9.5, bottom: -80, style: 'core', mat: 'ochre', occlude: false });
    // two watchers on the flanks answer alarms
    eyeOnPillar(K, { px: -13, pz: -5, pr: 2.3, y: 5, look: [-5, 0.8, -6], eye: { id: 'A', type: 'watcher', acquireTime: 2.0, range: 11.5, fov: 17 * DEG, home: { sweep: [[-5.3, 0.8, 4], [-5.3, 0.8, -14]], period: 6 } } });
    eyeOnPillar(K, { px: 13, pz: -3, pr: 2.3, y: 5, look: [5, 0.8, -4], eye: { id: 'B', type: 'watcher', acquireTime: 2.0, range: 11.5, fov: 17 * DEG, home: { sweep: [[5.3, 0.8, -14], [5.3, 0.8, 4]], period: 6 } } });
    K.shaft({ x: 0, z: -4, r: 13, depth: 90, rings: 8 });
    K.ribs({ x: 0, z: -12, r: 16, count: 9, h: 28, span: 'over', thick: 1.2, mat: 'bone' });
    K.mass({ seed: 121, style: 'towers' });
  },
  hints: [
    { id: 's', text: 'It watches places, not people. Do not stand where it is looking', focus: 'S', when: W => W.t > 1.2, until: W => W.player.pos[2] < 4, ms: 6500 },
    { id: 'alarm', text: 'When it sees you, every free eye looks there', when: W => W.eyeById.S.state === 'acquiring', until: W => W.eyeById.S.state !== 'acquiring', ms: 3500 }
  ],
  failHint: 'Watch which patch is warming next, and take the lane it has just left.'
});

// ---- 13 The False Pattern ---------------------------------------------------------
ENCOUNTERS.push({
  id: 'e13', act: 3, name: 'The False Pattern',
  cam: { w: 22, ahead: 4 },
  look: 'act3',
  build(K) {
    K.spawn(0, 14);
    K.floor({ x: 0, z: 2, w: 7, l: 26, etch: 'rungs' });
    K.floor({ x: 0, z: -13.2, w: 3.6, l: 4.6 });
    K.floor({ x: 0, z: -19.5, w: 4, l: 8.4, etch: 'rungs' });
    K.floor({ x: 3.6, z: -22, w: 3, l: 4.4, yaw: 0 });
    K.exit({ x: 5.4, z: -22, yaw: 0 });
    K.pillar({ x: -2.4, z: -26.6, r: 2, top: 9, bottom: -70, style: 'knotted', mat: 'ochre', cap: false });
    K.block({ x: -5.2, z: -13.4, w: 6.8, t: 1.2, yaw: 0, y1: 4, mat: 'ochre', style: 'jamb' });
    K.block({ x: 5.2, z: -13.4, w: 6.8, t: 1.2, yaw: 0, y1: 4, mat: 'ochre', style: 'jamb', tag: 'jambE' });
    K.gate({ id: 'g', x: 0, z: -13.4, w: 3.6, yaw: 0, signal: S => !S.observed('K'), speed: 1.2 });
    // colonnade walls with eyes that turn to you: carvings, mostly
    K.block({ x: -4.6, z: 2, w: 26, t: 1.6, yaw: -Math.PI / 2, y1: 3, mat: 'bone', style: 'colonnade' });
    K.block({ x: 4.6, z: 2, w: 26, t: 1.6, yaw: -Math.PI / 2, y1: 3, mat: 'bone', style: 'colonnade' });
    const F = [[-4.6, 8, 0.2], [4.6, 3, Math.PI - 0.2], [-4.6, -3, 0.25], [4.6, -8, Math.PI - 0.25]];
    F.forEach(([x, z, yaw], i) => K.eye({ id: 'F' + (i + 1), type: 'falseeye', pos: [x + Math.cos(yaw) * 0.6, 4.6, z], facing: vNorm([Math.cos(yaw), -0.3, Math.sin(yaw)]), range: 18, home: { dir: vNorm([Math.cos(yaw), -0.4, Math.sin(yaw) + 0.3]) } }));
    // the liar sleeps above the gate. Its gaze holds K, which holds the gate shut.
    K.eye({ id: 'L', type: 'liar', pos: [-2.4, 7, -24.4], facing: vNorm([0.4, -0.25, 1]), home: { eye: 'K' }, fov: 26 * DEG, range: 28, acquireTime: 2.4, maxDev: 80 * DEG });
    K.eye({ id: 'K', type: 'watcher', ignore: ['jambE'], pos: [2.9, 5.0, -13.2], facing: vNorm([0.3, -0.2, 1]), home: { point: [9, 1, -2] }, acquireTime: 2.2, range: 9, fov: 12 * DEG, periph: 1, maxDev: 30 * DEG });
    K.tendon({ from: { eye: 'K' }, to: { mover: 'g' }, sag: 1.5 });
    K.shaft({ x: 0, z: -2, r: 12, depth: 90, rings: 8 });
    K.mass({ seed: 131, style: 'arches' });
    K.lamp({ x: 0, y: 4, z: 2, color: '#e0a64e', intensity: 0.55, dist: 16 });
  },
  hints: [
    { id: 'f', text: 'Real eyes carry your light in them, and cast a beam at you', when: W => W.eyes.some(e => e.isFalse && e.state === 'acquiring'), until: W => W.player.pos[2] < -9, ms: 6500 },
    { id: 'l', text: 'A closed eye is holding something', focus: 'L', when: W => W.player.pos[2] < -6, until: W => W.eyeById.L.liarOpen, ms: 6000 },
    { id: 'l2', text: 'It opened. Hold it now', focus: 'L', when: W => W.eyeById.L.liarOpen && W.eyeById.L.state !== 'pinned', until: W => W.eyeById.L.state === 'pinned', ms: 4000 }
  ],
  failHint: 'Let the sleeping eye see you. It must look away from what it holds, and it opens.'
});

// ---- 14 The Choir Returns ------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e14', act: 3, name: 'The Choir Returns',
  cam: { w: 22, ahead: 3 },
  look: 'act3',
  build(K) {
    // a square spiral descending around a shaft; the choir hangs around it
    K.spawn(-7, 8);
    K.floor({ x: -7, z: 6, w: 3, l: 5 });
    K.floor({ x: -7, z: -5.5, w: 3, l: 18, y: 0, y2: -4, etch: 'rungs' });
    K.ring({ x: -7, z: -16.5, r1: 2.6, y: -4 });
    K.floor({ x: 0, z: -16.5, w: 3, l: 11, yaw: 0, y: -4, y2: -8, etch: 'rungs' });
    K.ring({ x: 7, z: -16.5, r1: 2.6, y: -8 });
    K.floor({ x: 7, z: -6, w: 3, l: 18, yaw: Math.PI / 2, y: -8, y2: -12, etch: 'rungs' });
    K.ring({ x: 7, z: 4.4, r1: 3, y: -12 });
    K.floor({ x: 11.6, z: 4.4, w: 3, l: 5, yaw: 0, y: -12 });
    K.zone('cp1', { x: 7, z: -16.5, r: 2.4 });
    K.block({ x: 11.6, z: 2.4, w: 5, t: 0.8, yaw: 0, y0: -14, y1: -8, mat: 'ochre', style: 'jamb' });
    K.block({ x: 11.6, z: 6.4, w: 5, t: 0.8, yaw: 0, y0: -14, y1: -8, mat: 'ochre', style: 'jamb' });
    K.gate({ id: 'g', x: 10.4, z: 4.4, y: -12, w: 3.2, yaw: Math.PI / 2, signal: S => !S.synced('ring2'), speed: 1.2 });
    K.exit({ x: 13.4, z: 4.4, y: -12, yaw: 0 });
    // the central column hides opposite members from each other
    K.pillar({ x: 0, z: -6, r: 3.2, top: 24, bottom: -90, style: 'core', mat: 'ochre' });
    // choir: q1 -> q2 -> q3 -> q4 -> q1, set around the shaft at different heights
    const Q = { q1: [-12, 2, -9], q2: [-2, 1, -21], q3: [12, -4, -12], q4: [4, -7, 7] };
    const nx = { q1: 'q2', q2: 'q3', q3: 'q4', q4: 'q1' };
    for (const id in Q) {
      const [x, y, z] = Q[id];
      const tag = K.pillar({ x, z, r: 1.2, top: y - 1, bottom: -90, style: 'knotted', mat: 'bone', cap: false });
      K.eye({ id, type: 'choir', group: 'ring2', host: tag, pos: [x, y + 0.3, z], facing: vNorm([-x, 0.1, -6 - z]), home: { eye: nx[id] }, heal: 2.0, acquireTime: 1.8, fov: 20 * DEG, range: 24, maxDev: 120 * DEG });
    }
    // a blade turns slowly about the column, sometimes cutting a pair apart
    K.rotor({ id: 'rot', x: 0, z: -6, mode: 'cont', omega: 0.18, signal: () => true, r: 6, hub: false });
    K.blade({ x: 0, z: -12.2, w: 5.4, t: 0.8, y0: -9, y1: 4, yaw: 0, mover: 'rot' });
    K.shaft({ x: 0, z: -6, r: 14, depth: 120, rings: 11 });
    K.mass({ seed: 141, style: 'spiral' });
    K.lamp({ x: 7, y: -10, z: 4, color: '#e0a64e', intensity: 0.6, dist: 14 });
  },
  hints: [
    { id: 'r', text: 'The ring again. This time the column and the blade decide which eye is weak', when: W => W.t > 1.2, until: W => W.player.pos[1] < -3, ms: 6500 }
  ],
  failHint: 'Hold an eye whose neighbours cannot see each other past the column.'
});

// ---- 15 The Familiar Solution ------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e15', act: 3, name: 'The Familiar Solution',
  cam: { w: 22, ahead: 3 },
  look: 'act3',
  build(K) {
    // the same room as before. Almost.
    K.spawn(0, 13);
    K.ring({ x: 0, z: 9, r1: 5.4, etch: 'spiral' });
    K.ring({ x: 0, z: -14, r1: 5.2, etch: 'spiral' });
    K.floor({ x: 0, z: -20.5, w: 3, l: 4 });
    K.bridge({ id: 'span', ax: 0, az: 4.2, yaw: -Math.PI / 2, len: 13.6, w: 2.4, signal: S => !S.observed('B'), speed: 0.55 });
    const pa = K.pillar({ x: -8.5, z: -3, r: 2.7, top: 34, bottom: -70, style: 'fluted' });
    const a = K.onPillar(-8.5, -3, 2.7, 7.5, Math.atan2(-5 + 3, 8.5 + 8.5), -0.1);
    K.eye({ id: 'A', type: 'falseeye', host: pa, pos: a.pos, facing: a.facing, home: { eye: 'B' }, range: 24 });
    const pb = K.pillar({ x: 8.5, z: -5, r: 2.6, top: 34, bottom: -70, style: 'fluted' });
    const b = K.onPillar(8.5, -5, 2.6, 5.5, Math.PI + 0.12, -0.15);
    K.eye({ id: 'B', type: 'watcher', host: pb, pos: b.pos, facing: b.facing, home: { point: [14, 0.5, -24] }, acquireTime: 2.4, maxDev: 50 * DEG });
    // the one that really holds B sleeps low on the right, by the start
    eyeOnPillar(K, { px: 13.5, pz: -20, pr: 2.4, y: 9.5, look: [2, 1, 8], style: 'knotted', eye: { id: 'L', type: 'liar', home: { eye: 'B' }, fov: 22 * DEG, range: 42, acquireTime: 2.2, maxDev: 60 * DEG } });
    const pc = K.pillar({ x: -5.8, z: -18.8, r: 2.1, top: 28, style: 'fluted' });
    const c = K.onPillar(-5.8, -18.8, 2.1, 3.4, Math.atan2(-11 + 18.8, 0 + 5.8), -0.25);
    K.eye({ id: 'C', type: 'watcher', host: pc, pos: c.pos, facing: c.facing, acquireTime: 2.4, range: 13, home: { sweep: [[3.5, 0.8, -12], [-1.5, 0.8, -9]], period: 6 } });
    K.tendon({ from: { eye: 'B' }, to: { mover: 'span' }, sag: 6 });
    K.exit({ x: 0, z: -22, yaw: -Math.PI / 2 });
    K.shaft({ x: 0, z: -2, r: 14, depth: 90, rings: 9 });
    K.ribs({ x: 0, z: -3, r: 16, count: 6, h: 28, span: 'over', thick: 1.3 });
    K.mass({ seed: 151, style: 'arches' });
    K.lamp({ x: 0, y: 6, z: -14, color: '#e0a64e', intensity: 0.5, dist: 16 });
  },
  hints: [
    { id: 'a', text: 'You have been here before', when: W => W.t > 0.8, until: W => W.t > 4, ms: 3000 },
    { id: 'b', text: 'Which eye is really holding the right one?', when: W => W.eyeById.A.revealed, until: W => W.eyeById.L.liarOpen, ms: 6000 }
  ],
  failHint: 'Follow the beam that holds the right eye. It starts at a closed eye.'
});

// ---- 16 No Safe Direction -------------------------------------------------------------------
ENCOUNTERS.push({
  id: 'e16', act: 3, name: 'No Safe Direction',
  cam: { w: 24, ahead: 3 },
  look: 'act3',
  build(K) {
    const C = [0, -5];
    K.spawn(0, 9.5);
    K.floor({ x: 0, z: 7, w: 3, l: 5 });
    K.ring({ x: C[0], z: C[1], r0: 2.6, r1: 10, etch: 'radial' });
    K.floor({ x: 0, z: -16.4, w: 3.4, l: 3.6 });
    K.floor({ x: 0, z: -21.5, w: 3.4, l: 7, etch: 'rungs' });
    K.exit({ x: 0, z: -24.6, yaw: -Math.PI / 2 });
    K.wall({ x: C[0], z: C[1], r0: 10.6, r1: 12, a0: -Math.PI / 2 + 0.22, a1: Math.PI / 2 - 0.2, y1: 12, mat: 'ochre', low: 1.6 });
    K.wall({ x: C[0], z: C[1], r0: 10.6, r1: 12, a0: Math.PI / 2 + 0.2, a1: 3 * Math.PI / 2 - 0.22, y1: 12, mat: 'ochre', low: 1.6 });
    K.pillar({ x: C[0], z: C[1], r: 2.4, top: 16, bottom: -90, style: 'core', mat: 'bone' });
    K.block({ x: -2.6, z: -15.8, w: 3.4, t: 1, yaw: 0, y1: 5, mat: 'ochre', style: 'jamb' });
    K.block({ x: 2.6, z: -15.8, w: 3.4, t: 1, yaw: 0, y1: 5, mat: 'ochre', style: 'jamb' });
    K.gate({ id: 'g', x: 0, z: -15.8, w: 3.4, yaw: 0, signal: S => !S.observed('Q'), speed: 1.4 });
    // Q over the gate, held by P across the room. C gathers Q back when it is free.
    K.eye({ id: 'Q', type: 'watcher', group: 'q', ignore: ['lintel'], pos: [0, 7.4, -17.2], facing: vNorm([0, -0.5, 1]), home: { sweep: [[-5, 0.8, 2], [5, 0.8, 2]], period: 5 }, acquireTime: 2.2, range: 24, fov: 18 * DEG, maxDev: 55 * DEG });
    K.block({ x: 0, z: -17.4, w: 5, t: 1.8, yaw: 0, y0: 5, y1: 9.5, mat: 'bone', style: 'rib', block: false, tag: 'lintel' });
    eyeOnPillar(K, { px: 12, pz: 3, pr: 2.2, y: 8, look: [0, 7.4, -17.2], eye: { id: 'P', type: 'watcher', home: { eye: 'Q' }, fov: 12 * DEG, periph: 1, range: 30 } });
    eyeOnPillar(K, { px: -12.5, pz: -9, pr: 2.3, y: 7.5, look: [0, 2, -5], eye: { id: 'C', type: 'collector', group: 'q', home: { point: [-4, 0.5, 2] }, collect: { notice: 0.7, turn: 0.5 }, range: 20, fov: 9 * DEG } });
    // a drifter circles above, and a sentinel watches the quarters
    const pts = []; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; pts.push([C[0] + Math.cos(a) * 6.5, 7.5, C[1] + Math.sin(a) * 6.5]); }
    K.eye({ id: 'D', type: 'drifter', pos: pts[0], facing: [0, -1, 0], rail: { pts, loop: true, speed: 2.2, center: [C[0], 0, C[1]], out: true, faceY: -1.2, u: 10 }, acquireTime: 1.8, range: 14, fov: 19 * DEG });
    K.zone('nw', { x: -5, z: -9.5, hw: 3.4, hl: 3.4, show: 'ring' });
    K.zone('ne', { x: 5, z: -9.5, hw: 3.4, hl: 3.4, show: 'ring' });
    K.zone('se', { x: 5, z: -0.5, hw: 3.4, hl: 3.4, show: 'ring' });
    K.zone('sw', { x: -5, z: -0.5, hw: 3.4, hl: 3.4, show: 'ring' });
    K.eye({ id: 'S', type: 'sentinel', pos: [9, 11, -16], facing: vNorm([-0.5, -0.6, 0.6]), sentinel: { zones: ['ne', 'sw', 'nw', 'se'], period: 3.2, alarm: 30 }, acquireTime: 1.2, range: 50 });
    K.pillar({ x: 10.2, z: -17.2, r: 2, top: 9, bottom: -80, style: 'core', mat: 'ochre', occlude: false });
    K.tendon({ from: { eye: 'Q' }, to: { mover: 'g' }, sag: 1.5 });
    K.shaft({ x: C[0], z: C[1], r: 14, depth: 110, rings: 10 });
    K.ribs({ x: C[0], z: C[1], r: 15, count: 10, h: 26, span: 'crown', thick: 1.1, mat: 'ochre' });
    K.mass({ seed: 161, style: 'towers' });
  },
  hints: [
    { id: 'q', text: 'The eye over the gate is held from across the room', focus: 'P', when: W => W.t > 1.5, until: W => W.eyeById.P.state === 'pinned', ms: 6000 }
  ],
  failHint: 'Get close to the gate first. Then let the eye above it go.'
});
