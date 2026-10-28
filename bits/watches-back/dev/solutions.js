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
module.exports = S;
