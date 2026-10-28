// Per-encounter solutions (what a thoughtful player does) and naive attempts
// (what should fail). Each is a list of bot steps.
const S = {};
const pinned = id => W => W.eyeById[id].state === 'pinned';
S.e01 = {
  solve: [{ go: [0, 2] }, { gaze: 'W' }, { until: pinned('W') }, { go: [0, -12] }, { go: [0, -26.3] }],
  naive: [{ go: [0, 2] }, { go: [0, -12] }, { go: [-1, -14], max: 4 }, { wait: 5 }]
};
S.e02 = {
  solve: [{ go: [0, 14] }, { gaze: 'L' }, { until: pinned('L') }, { go: [1.4, -6.8] }, { gaze: 'R' }, { until: pinned('R') }, { go: [1.9, -16] }, { go: [0, -29.6] }],
  naive: [{ go: [0, -29.6] }]
};
S.e03 = {
  solve: [{ go: [0, 5.2] }, { gaze: 'A' }, { until: pinned('A') }, { until: W => W.moverById.span.e >= 1, max: 8 }, { go: [0, -12] }, { gaze: 'C' }, { go: [0, -22] }],
  naive: [{ go: [0, 5.2] }, { gaze: 'A' }, { until: W => W.moverById.span.e >= 1, max: 8 }, { gaze: 'C' }, { go: [0, -22] }]
};
S.e04 = {
  solve: [
    { go: [0, 0.2] },
    { until: W => { const m = W.moverById.ring; const a = ((m.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return a > 6.0 || a < 0.1; }, max: 30, label: 'ring at south' },
    { gaze: 'X' }, { until: pinned('X') }, { go: [0, -2.4] }, { do: W => { W._a0 = W.moverById.ring.angle; } }, { gaze: 'Wd' },
    { until: W => W.moverById.ring.angle > W._a0 + Math.PI - 0.06, max: 30, label: 'ring at north' },
    { go: [0, -14.4], max: 3 }, { go: [0, -24.5] }
  ],
  naive: null
};

// ---- Act II ----
const polar = (c, a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
const C5 = [0, -8];
const dAng = W => 2.3 + W.eyeById.D.rail.u / 5.4;
const arcGo = (a) => ({ go: polar(C5, a, 10.7), tol: 0.5 });
S.e05 = {
  solve: [
    { go: [-6.3, 0] }, arcGo(2.75),
    { until: W => dAng(W) > 3.5 && W.eyeById.D.rail.dir > 0, max: 30, label: 'drifter past' },
    arcGo(3.1), arcGo(3.6), arcGo(4.05), { gaze: 'N' }, { until: pinned('N'), max: 3 }, arcGo(4.5), arcGo(5.0), arcGo(5.35),
    { until: W => W.eyeById.D.rail.dir < 0 && dAng(W) < 4.8, max: 30, label: 'drifter back past' },
    arcGo(5.8), { go: [10.6, -10.6] }, { go: [15.7, -10.6] }
  ],
  naive: [{ go: [-6.3, 0] }, arcGo(3.4), arcGo(4.4), arcGo(5.4), { go: [10.6, -10.6] }, { go: [15.7, -10.6] }]
};
S.e06 = {
  solve: [{ go: [-3, 9.5] }, { gaze: 'B' }, { until: pinned('B') }, { until: W => W.moverById.g1.e > 0.8, max: 6 }, { go: [0, 7.6] }, { go: [0, 2] }, { go: [0, -6] },
    { until: W => W.moverById.g2.e > 0.8, max: 10, label: 'gate2' }, { go: [0, -12.5] }, { gaze: 'D' }, { go: [0, -23.5] }],
  naive: [{ go: [0, 9] }, { go: [0, 2], max: 6 }, { go: [0, -23.5], max: 10 }]
};
S.e07 = {
  solve: [{ go: [0, 6.5] }, { until: W => W.links.some(l => l.a === 'H' && l.b === 'S'), max: 40, label: 'blade clear' }, { gaze: 'R' }, { until: pinned('R') },
    { go: [0, -13.5] }, { gaze: 'T' }, { go: [0, -25.3] }],
  naive: [{ go: [0, 6.5] }, { go: [0, -13.5] }, { gaze: 'T' }, { go: [0, -25.3] }]
};
S.e08 = {
  solve: [{ go: [0, -2] }, { gaze: 'c2' }, { until: pinned('c2') }, { until: W => W.moverById.g.e > 0.8, max: 8 }, { wait: 3 }, { go: [0, -12.4] }, { go: [0, -18.7] }],
  naive: [{ go: [0, -2] }, { gaze: 'c1' }, { until: W => W.moverById.g.e > 0.8, max: 8 }, { wait: 3 }, { go: [0, -12.4], max: 4 }, { go: [0, -18.7], max: 4 }]
};
// hold D1 while its gate is open, then dodge D2's light and pass g2 when it opens
const lightNear = (W, id, z, d) => { const e = W.eyeById[id]; return e.state !== 'pinned' && Math.abs(e.pos[2] - z) < d; };
S.e09 = {
  solve: [
    { go: [0, 9] },
    { until: W => W.moverById.g1.e > 0.95 && W.eyeById.D1.pos[2] > 3, max: 30, label: 'g1 open, D1 south' },
    { gaze: 'D1' }, { until: pinned('D1') },
    { ctl: W => { const p = W.player.pos; if (p[2] < -5.5) return 'done'; if (lightNear(W, 'D2', p[2] - 2.5, 4.5) && p[2] > 4.5) return [0, 0]; return [0, -1]; }, max: 30 },
    { until: W => W.moverById.g2.e > 0.95 && !lightNear(W, 'D2', -8, 6), max: 30, label: 'g2 open' },
    { gaze: 'D2' }, { go: [0, -31.1] }
  ],
  naive: [{ go: [0, -31.1] }]
};
S.e10 = {
  solve: [{ go: [0, -9] }, { gaze: 'J' }, { until: pinned('J') }, { until: W => W.moverById.g.e > 0.8, max: 6 }, { go: [0, -18] },
    { gaze: 'E1' }, { go: [0, -26] }, { go: [0, -33] }, { gaze: 'E2' }, { go: [0, -43.1] }],
  naive: [{ go: [0, -4] }, { gaze: 'J' }, { until: W => W.moverById.g.e > 0.8, max: 6 }, { wait: 6 }, { go: [0, -43.1], max: 20 }]
};

// ---- Act III ----
S.e11 = {
  solve: [{ go: [0, 8] }, { gaze: 'D' }, { until: pinned('D') }, { wait: 3.2 }, { go: [0, -4] }, { gaze: 'W' }, { go: [0, -26.4] }],
  naive: [{ go: [0, 8] }, { gaze: 'D' }, { go: [0, -26.4] }]
};
S.e12 = {
  solve: [{ go: [0, 9] }, { gaze: 'S' }, { until: pinned('S'), max: 4 }, { go: [0, -4] }, { go: [-3.6, -4] }, { gaze: 'A' }, { until: pinned('A') },
    { until: W => { const s = W.eyeById.S.sentinel; return s.zones[s.idx] === 'zb'; }, max: 20, label: 'zd quiet' }, { go: [-5.3, -6] }, { go: [-5.3, -15.6] }, { go: [0, -15.6] }, { go: [0, -21.7] }],
  naive: [{ go: [0, 9] }, { go: [0, -21.7] }]
};
S.e13 = {
  solve: [{ go: [0, -6] }, { go: [2, -9.8] }, { until: W => W.eyeById.L.liarOpen, max: 10, label: 'liar opens' }, { gaze: 'L' }, { until: pinned('L') },
    { until: W => W.moverById.g.e > 0.8, max: 5 }, { go: [0, -13] }, { go: [0, -20] }, { go: [5.5, -22] }],
  naive: [{ go: [0, -6] }, { gaze: 'F2' }, { go: [0, -12], max: 6 }, { go: [0, -20], max: 6 }, { go: [5.5, -22], max: 4 }]
};
S.e14 = {
  solve: [{ go: [-7, 3] }, { go: [-7, -15.5] }, { go: [5, -16.5] }, { go: [7, -14] }, { go: [7, 3] }, { gaze: 'q1' }, { until: pinned('q1') },
    { until: W => W.moverById.g.e > 0.9, max: 6 }, { go: [13.5, 4.4] }],
  naive: [{ go: [-7, 3] }, { go: [-7, -15.5] }, { go: [5, -16.5] }, { go: [7, -14] }, { go: [7, 3] }, { gaze: 'q2' }, { until: W => W.moverById.g.e > 0.9, max: 6 }, { wait: 3.5 }, { go: [13.5, 4.4], max: 6 }]
};
S.e15 = {
  solve: [{ go: [0, 5.2] }, { until: W => W.eyeById.L.liarOpen, max: 12, label: 'liar opens' }, { gaze: 'L' }, { until: pinned('L') },
    { until: W => W.moverById.span.e >= 1, max: 8 }, { go: [0, 4] }, { go: [0, -12] }, { gaze: 'C' }, { go: [0, -22] }],
  naive: [{ go: [0, 5.2] }, { gaze: 'A' }, { wait: 4 }, { go: [0, -12], max: 6 }, { go: [0, -22], max: 6 }]
};
S.e16 = {
  solve: [{ go: [0, 4] }, { go: [-3, -12.6] }, { gaze: 'P' }, { until: pinned('P') }, { until: W => W.moverById.g.e > 0.8, max: 5 }, { go: [0, -16] }, { go: [0, -24.7] }],
  naive: [{ go: [0, 4] }, { go: [0, -24.7], max: 15 }]
};
// ---- Act IV ----
S.e17 = {
  solve: [{ go: [0, 16.2] }, { gaze: 'X' }, { until: pinned('X') }, { until: W => W.moverById.g1.e > 0.8, max: 12, label: 'g1' }, { go: [0, 6] }, { go: [1.2, -9.2] },
    { until: W => W.moverById.g2.e > 0.5, max: 8, label: 'g2 bait' }, { gaze: 'Y' }, { until: pinned('Y') }, { go: [0, -11] }, { go: [0, -21.1] }],
  naive: [{ go: [3, 11] }, { go: [0, 6], max: 6 }, { go: [0, -21.1], max: 10 }]
};
S.e18 = {
  solve: [{ go: [0, 8] }, { gaze: 'U' }, { until: W => W.eyeById.U.target && W.eyeById.U.target.stare, max: 6, label: 'U stares' }, { go: [3.8, -1.2] }, { go: [3.7, -9.6] },
    { until: W => W.moverById.g.e > 0.85, max: 6 }, { go: [0, -16] }, { go: [0, -18.5] }, { gaze: 'W' }, { go: [0, -26.5] }],
  naive: [{ go: [0, 8] }, { go: [5.4, -2] }, { go: [5, -9] }, { go: [0, -16], max: 6 }, { go: [0, -26.5], max: 6 }]
};
S.e19 = {
  solve: [{ go: [-1.5, 5.5] }, { do: W => { const sat = W.eyes.filter(e => e.group === 'crown').sort((a, b) => b.pos[2] - a.pos[2])[0]; require('./simload').last.setGaze(W, sat.id); } }, { until: W => W.eyes.some(e => e.group === 'crown' && e.state === 'pinned'), max: 4, label: 'sat pinned' }, { gaze: 'X' }, { until: pinned('X'), max: 2 },
    { until: W => W.moverById.span.e > 0.97, max: 8, label: 'span' }, { go: [10.2, -3.2] }, { go: [10.2, -26] }, { go: [10.2, -33.3] }],
  naive: [{ go: [-1.5, 5.5] }, { gaze: 'X' }, { until: W => W.moverById.span.e > 0.95, max: 8 }, { go: [10.2, -3.2] }, { go: [10.2, -33.3], max: 10 }]
};
S.e20 = {
  solve: [{ go: [0, 16] }, { gaze: 'C' }, { until: W => W.moverById.pupil.e > 0.97, max: 10, label: 'pupil' }, { go: [0, 2.6] }],
  naive: [{ go: [0, 16] }, { gaze: 'W1' }, { wait: 3 }, { go: [0, 2.6], max: 8 }]
};
module.exports = S;
