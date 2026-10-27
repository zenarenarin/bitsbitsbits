// =====================================================================
// The campaign: twenty authored spirals, each one deeper inside the last.
// Angles are degrees (world angle at the start, when every ring is aligned).
// doors[w]   openings in wall w (wall w turns with ring w+1)
// barriers[k] radial walls across groove k; veils[w] lashes on wall w that block sight
// =====================================================================

const ACTS = [
  null,
  { n: 1, title: 'Something Is Looking', sub: 'Act I' },
  { n: 2, title: 'The System Moves', sub: 'Act II' },
  { n: 3, title: 'It Learned Your Habits', sub: 'Act III' },
  { n: 4, title: 'The Thing That Watches Back', sub: 'Act IV' },
];

const ENCOUNTERS = [
  // ------------------------------------------------------------ ACT I
  {
    id: 1, act: 1, name: 'The First Eye', whisper: 'Something here has noticed you.', par: 25,
    n: 2, rotation: false,
    doors: [[25], [200]], barriers: [[-122], []],
    player: { k: 0, a: -90 },
    eyes: [{ type: 'watcher', name: 'first', k: 0, a: 50, wakeAfterWalk: 0.8 }],
    hints: ['walk', 'look'],
  },
  {
    id: 2, act: 1, name: 'The Unwatched', whisper: 'It keeps pace with you, wherever you go.', par: 30,
    n: 2, rotation: false,
    doors: [[-30], [70]], barriers: [[40], []],
    player: { k: 0, a: -110 },
    eyes: [
      { type: 'watcher', name: 'behind', k: 0, a: -178, wake: 2.5 },
      { type: 'watcher', name: 'below', k: 1, a: -40 },
    ],
  },
  {
    id: 3, act: 1, name: 'The First Obstruction', whisper: 'Held still, an eye is only a thing in the way.', par: 35,
    n: 2, rotation: false,
    doors: [[-30], [15]], barriers: [[], [30, 170]],
    player: { k: 0, a: -100 },
    eyes: [
      { type: 'watcher', name: 'pacer', k: 1, a: 10, beh: 'patrol', dir: -1, speed: 1.1 },
      { type: 'watcher', name: 'a', k: 1, a: -125 },
      { type: 'watcher', name: 'b', k: 1, a: -150 },
    ],
  },
  {
    id: 4, act: 1, name: 'The Spiral Turns', whisper: 'The ground you stand on is the only thing that keeps still.', par: 45,
    n: 3, rotation: true,
    doors: [[90], [150], [0]], barriers: [[-124, -56], [], []],
    player: { k: 0, a: -90 },
    eyes: [{ type: 'watcher', name: 'keeper', k: 2, a: 110 }],
    hints: ['turn', 'hold-turn'],
  },
  // ------------------------------------------------------------ ACT II
  {
    id: 5, act: 2, name: 'The Drifter', whisper: 'This one does not follow you. It simply goes.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [40], [70]], barriers: [[-132, -48], [-172, 62], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'l1', k: 1, a: -160 },
      { type: 'watcher', name: 'l2', k: 1, a: -146 },
      { type: 'drifter', name: 'drift', k: 1, a: -55, dir: -1 },
      { type: 'watcher', name: 'low', k: 2, a: 100 },
    ],
  },
  {
    id: 6, act: 2, name: 'A Gathering', whisper: 'Some of them prefer company.', par: 55,
    n: 3, rotation: true,
    doors: [[-90], [-170], [150]], barriers: [[-152, -28], [], [60]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'lurk', k: 1, a: -104 },
      { type: 'watcher', name: 'lurk2', k: 1, a: -76 },
      { type: 'collector', name: 'gatherer', k: 1, a: -10 },
      { type: 'drifter', name: 'drift2', k: 2, a: 100, dir: 1 },
    ],
  },
  {
    id: 7, act: 2, name: 'The Wrong Direction', whisper: 'It is shy. It cannot bear to be looked at.', par: 50,
    n: 3, rotation: true,
    doors: [[-10], [30], [200]], barriers: [[-140], [], [120]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'liar', name: 'shy', k: 0, a: 22 },
      { type: 'liar', name: 'shy2', k: 2, a: 30 },
    ],
  },
  {
    id: 8, act: 2, name: 'Broken Formation', whisper: 'They are learning to need one another.', par: 60,
    n: 3, rotation: true,
    doors: [[-90], [-55], [170]], barriers: [[-160, -20], [175], [80]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'liar', name: 'shy', k: 1, a: -90 },
      { type: 'watcher', name: 'pace', k: 1, a: 20, beh: 'patrol', dir: -1, speed: 0.8 },
      { type: 'collector', name: 'gatherer', k: 1, a: -10 },
      { type: 'drifter', name: 'drift', k: 1, a: 120, dir: -1 },
      { type: 'watcher', name: 'low', k: 2, a: -60 },
    ],
  },
  {
    id: 9, act: 2, name: 'The Narrowing', whisper: 'The way in is getting smaller. So is the way out.', par: 70,
    n: 5, rotation: true,
    doors: [[-90], [90], [-150], [30], [-90]],
    barriers: [[-140, -40], [-170, 10], [], [-60, 120], []],
    veils: [[], [[104, 140], [40, 76]], [], [[52, 85], [-25, 8]], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'v1', k: 2, a: 90 },
      { type: 'drifter', name: 'd1', k: 2, a: -60, dir: 1 },
      { type: 'watcher', name: 'v2', k: 4, a: 30 },
    ],
  },
  {
    id: 10, act: 2, name: 'The First Hunt', whisper: 'It has been watching how you walk.', par: 70,
    n: 4, rotation: true,
    doors: [[0], [90], [-90], [90]], barriers: [[-130, -50], [], [], []],
    player: { k: 0, a: -90 },
    eyes: ctx => {
      // the hunters wait on the side the traveller has favoured so far, and aim where they are going
      const d = (ctx.habit && ctx.habit.dir) || 1;
      return [
        { type: 'watcher', name: 'h1', k: 1, a: -90 + d * 25, beh: 'hunt', lead: 0.9, speed: 1.1 },
        { type: 'watcher', name: 'h2', k: 2, a: 90 - d * 35, beh: 'hunt', lead: 0.9, speed: 1.1 },
        { type: 'drifter', name: 'drift', k: 3, a: 0, dir: d },
      ];
    },
  },
  // ------------------------------------------------------------ ACT III
  {
    id: 11, act: 3, name: 'The Mimic', whisper: 'It moves like you. A little late.', par: 55,
    n: 3, rotation: true,
    doors: [[-30], [-120], [-175]], barriers: [[-150], [], [30]],
    player: { k: 0, a: -110 },
    eyes: [
      { type: 'mimic', name: 'copy', k: 1, a: -90, delay: 0.9 },
      { type: 'mimic', name: 'mirror', k: 2, a: -150, delay: 0.9, mirror: -1 },
    ],
  },
  {
    id: 12, act: 3, name: 'The Sentinel', whisper: 'Not everything that watches moves.', par: 60,
    n: 3, rotation: true,
    doors: [[-110], [60], [-60]], barriers: [[-135, -45], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'sentinel', name: 'gate', wall: 0, a: -50, face: 'cw', sweep: 26, period: 5, range: 7.5, half: 15, phase: 90, wake: 2.5, wakeNear: 0 },
      { type: 'watcher', name: 'low', k: 1, a: -100 },
      { type: 'drifter', name: 'drift', k: 2, a: 150, dir: 1 },
    ],
  },
  {
    id: 13, act: 3, name: 'The False Pattern', whisper: 'Most of them are only drawings.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [0, 180], [100]], barriers: [[-130, -50], [], [-120]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'falseeye', name: 'f1', k: 1, a: -62, lookAt: 200 },
      { type: 'watcher', name: 'real', k: 1, a: -36, speed: 0.25 },
      { type: 'falseeye', name: 'f2', k: 1, a: -14, lookAt: 30 },
      { type: 'falseeye', name: 'f3', k: 1, a: -122, lookAt: 120 },
      { type: 'falseeye', name: 'f4', k: 1, a: -158, lookAt: 300 },
      { type: 'falseeye', name: 'f5', k: 1, a: 90, lookAt: 260 },
      { type: 'falseeye', name: 'f6', k: 2, a: -150, lookAt: 10 },
      { type: 'falseeye', name: 'f7', k: 2, a: 60, lookAt: 210 },
      { type: 'liar', name: 'among', k: 2, a: 135, speed: 0.5 },
    ],
  },
  {
    id: 14, act: 3, name: 'The Choir', whisper: 'One of them is singing. The rest are listening.', par: 55,
    n: 3, rotation: true,
    doors: [[-90], [-150], [-120]], barriers: [[-130, -50], [-178, 100], []],
    player: { k: 0, a: -90 },
    eyes: [0, 1, 2, 3, 4].map(i => ({ type: 'choir', name: 'c' + i, k: 1, a: -112 + i * 13 }))
      .concat([{ type: 'watcher', name: 'low', k: 2, a: 150 }]),
    choirs: [{ members: ['c0', 'c1', 'c2', 'c3', 'c4'], conductor: 'c3', dir: 1, spd: 1.0 }],
  },
  {
    id: 15, act: 3, name: 'The Repetition', whisper: 'You have been here before.', par: 50,
    n: 3, rotation: true,
    doors: [[-90], [-90], [0]], barriers: [[-124, -56], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'liar', name: 'keeper', k: 2, a: -90, speed: 0.7 },
      { type: 'drifter', name: 'wedge', k: 2, a: -45, speed: 0.35, dir: 1 },
    ],
  },
  {
    id: 16, act: 3, name: 'No Safe Direction', whisper: 'Everything is in front of you.', par: 75,
    n: 4, rotation: true,
    doors: [[-90], [90], [-30], [150]], barriers: [[-150, -30], [], [-100], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'watcher', name: 'chaser', k: 0, a: -40, beh: 'hunt', lead: 0.6 },
      { type: 'mimic', name: 'copy', k: 1, a: -60 },
      { type: 'sentinel', name: 'eye', wall: 1, a: 20, face: 'in', sweep: 40, period: 6, range: 6, half: 16 },
      { type: 'watcher', name: 'low', k: 2, a: 60 },
      { type: 'liar', name: 'shy', k: 3, a: -170 },
    ],
  },
  // ------------------------------------------------------------ ACT IV
  {
    id: 17, act: 4, name: 'The Convergence', whisper: 'They no longer take turns.', par: 80, dread: 0.4,
    n: 4, rotation: true,
    doors: [[-90], [30], [-150], [60]], barriers: [[-150, -30], [150], [], [-20]],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'collector', name: 'gatherer', k: 1, a: -10 },
      { type: 'drifter', name: 'd1', k: 1, a: -120, dir: 1 },
      { type: 'watcher', name: 'w1', k: 1, a: 90 },
      { type: 'choir', name: 'c0', k: 2, a: 60 }, { type: 'choir', name: 'c1', k: 2, a: 75 }, { type: 'choir', name: 'c2', k: 2, a: 90 }, { type: 'choir', name: 'c3', k: 2, a: 105 },
      { type: 'sentinel', name: 'eye', wall: 2, a: 0, face: 'in', sweep: 35, period: 5, range: 5, half: 18 },
      { type: 'watcher', name: 'w3', k: 3, a: 160 },
    ],
    choirs: [{ members: ['c0', 'c1', 'c2', 'c3'], conductor: 'c1', dir: 1, spd: 0.9 }],
  },
  {
    id: 18, act: 4, name: 'The Unblinking', whisper: 'This one has no lids. Your gaze is nothing to it.', par: 90, dread: 0.55,
    n: 4, rotation: true,
    doors: [[90], [-90], [90], [-90]], barriers: [[-140, -40], [], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'unblinking', name: 'it', k: 1, a: 82, speed: 1.1 },
      { type: 'drifter', name: 'd1', k: 1, a: -150, dir: 1 },
      { type: 'drifter', name: 'd2', k: 2, a: 0, dir: -1 },
      { type: 'drifter', name: 'd3', k: 3, a: 180, dir: 1 },
    ],
  },
  {
    id: 19, act: 4, name: 'The Crown', whisper: 'It has gathered itself into one thing.', par: 110, dread: 0.75,
    n: 4, rotation: true,
    doors: [[-90], [90], [-90], [{ a: 90, sealed: true }, { a: -90, sealed: true }]], barriers: [[-150, -30], [], [], []],
    player: { k: 0, a: -90 },
    eyes: [
      { type: 'crown', name: 'j0', k: 2, a: 0 }, { type: 'crown', name: 'j1', k: 2, a: 30 }, { type: 'crown', name: 'j2', k: 2, a: 60 },
      { type: 'crown', name: 'j3', k: 3, a: 15 }, { type: 'crown', name: 'j4', k: 3, a: 45 }, { type: 'crown', name: 'j5', k: 3, a: 75 },
      { type: 'sentinel', name: 'herald', wall: 1, a: 180, face: 'out', sweep: 40, period: 7, range: 5.5, half: 16 },
      { type: 'liar', name: 'shy', k: 1, a: 150 },
      { type: 'drifter', name: 'd1', k: 1, a: -30, dir: 1 },
    ],
    choirs: [{ name: 'crown', crown: true, members: ['j0', 'j1', 'j2', 'j3', 'j4', 'j5'], conductor: 'j1', dir: 1, spd: 0.7, breaks: 3, ripple: 2.0 }],
    script: {
      // the crown turns the spiral itself, and the centre will not open while it stands
      step(S) {
        const g = S.groups[0];
        S.forcedRot = g.broken ? 0 : 0.22;
        if (g.broken && !S.flags.opened) { S.flags.opened = true; for (const d of S.walls[S.N - 1].doors) d.sealed = false; S.ev('unseal'); }
      },
    },
  },
  {
    id: 20, act: 4, name: 'The Centre', whisper: '', par: 90, dread: 1, quiet: true,
    n: 4, rotation: true, rotMax: 0.32,
    doors: [[-90], [150], [68], [{ a: 88, lid: 'first' }]], barriers: [[-150, -30], [], [], [56, 124]],
    player: { k: 0, a: -90 },
    make: ctx => {
      // the eyes at the centre move the way the traveller moved
      const recs = (ctx.recordings || []).filter(r => r && r.length > 60);
      const fallback = [];
      for (let i = 0; i < 600; i++) fallback.push(0.35 * Math.sin(i / 40) + 0.15 * Math.sin(i / 13));
      const pick = i => recs.length ? recs[(recs.length - 1 - i % recs.length)] : fallback;
      return {
        eyes: [
          { type: 'echo', name: 'echo1', k: 1, a: -60, track: pick(0), extra: { trackScale: 0.9 } },
          { type: 'echo', name: 'echo2', k: 2, a: 170, track: pick(1), extra: { trackScale: 0.8 } },
          { type: 'echo', name: 'echo3', k: 2, a: 30, track: pick(2), extra: { trackScale: 0.8 } },
          { type: 'warden', name: 'first', wall: 3, a: 100 },
          { type: 'echo', name: 'echo4', k: 3, a: 112, track: pick(3), extra: { trackScale: 1.1 } },
        ],
      };
    },
  },
];

function encounterById(id) { return ENCOUNTERS.find(e => e.id === id); }

// Resolve an encounter into a simulation definition. Some encounters depend on the run
// (the traveller's habits, recordings of how they moved); `ctx` carries that.
function buildEncounter(E, ctx) {
  ctx = ctx || {};
  const def = Object.assign({}, E);
  if (typeof E.eyes === 'function') def.eyes = E.eyes(ctx);
  if (typeof E.make === 'function') Object.assign(def, E.make(ctx));
  def.seed = def.seed || E.id * 31 + 5;
  return def;
}
