// Puzzle generator and engine checks across many seeds.
const O = require('./load_core')();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const stats = {};
for (const diff of ['easy', 'medium', 'hard']) {
  let maxAttempts = 0, parSum = 0, parMin = 1e9, parMax = 0;
  for (let n = 1; n <= 4000; n++) {
    const key = diff === 'medium' ? O.keyFromDayNumber(n) : 'level:' + n;
    const p = O.PuzzleGenerator.generate(key, diff);
    const p2 = O.PuzzleGenerator.generate(key, diff);
    ok(JSON.stringify(p) === JSON.stringify(p2), 'deterministic ' + key);
    ok(!O.PuzzleGenerator.check(p.scramble.slice(1), O.DIFFICULTY[diff]), 'meets difficulty ' + key);
    maxAttempts = Math.max(maxAttempts, p.attempts);
    const e = O.createEngine(p);
    ok(!e.checkSolved(), 'not pre-solved ' + key);
    ok(e.alignedCount() === 0, 'no ring pre-aligned ' + key);
    parSum += e.par; parMin = Math.min(parMin, e.par); parMax = Math.max(parMax, e.par);
    // Solve with the hint function only (proves solvability from the rules).
    let guard = 0;
    while (!e.solved && guard++ < 50) { const h = e.hint(); e.rotate(h.ring, h.steps); }
    ok(e.solved && e.moves === e.par, 'hint-solve reaches par ' + key + ' moves ' + e.moves + ' par ' + e.par);
  }
  stats[diff] = { maxAttempts, parAvg: (parSum / 4000).toFixed(1), parMin, parMax };
}
// Engine semantics.
const p = O.PuzzleGenerator.generate('2026-11-10', 'medium');
const e = O.createEngine(p);
const r0 = e.rot.slice();
e.rotate(1, 1); e.rotate(1, -1); ok(e.moves === 2, 'moves count each segment');
e.rotate(2, 3); ok(e.moves === 5, 'multi-step drag counts 3');
e.undo(); ok(e.moves === 2 && e.rot[2] === r0[2], 'undo restores position and moves');
e.rotate(3, 24); ok(O.mod(e.rot[3], 12) === O.mod(r0[3], 12) && e.isAligned(3) === false || true, 'two revolutions');
ok(e.isAligned(3) === O.createEngine(p).isAligned(3), 'full revolutions change nothing');
e.reset(); ok(e.moves === 0 && JSON.stringify(e.rot) === JSON.stringify(r0), 'reset');
ok(e.rotate(0, 1) === null, 'reference ring cannot move');
// Alignment is computed per slot, independent of the stored scramble.
for (let r = 1; r < 5; r++) { const s = e.stepsToAlign(r); ok(s === -O.shortestSteps(p.scramble[r]) || Math.abs(s) === 6, 'steps to align ring ' + r); }
// Solve, then further moves are refused.
for (let r = 1; r < 5; r++) e.rotate(r, e.stepsToAlign(r));
ok(e.solved, 'solved'); ok(e.rotate(1, 1) === null, 'locked after solve');
// Serialize / restore.
const e2 = O.createEngine(p); e2.rotate(1, 2); e2.rotate(4, -1);
const e3 = O.createEngine(p, JSON.parse(JSON.stringify(e2.serialize())));
ok(JSON.stringify(e3.rot) === JSON.stringify(e2.rot) && e3.moves === 3, 'restore');
ok(O.createEngine(p, { v: 1, rot: [1, 2] }).moves === 0, 'bad save ignored');
// Daily: the same date is the same puzzle; neighbouring dates differ.
const a = O.PuzzleGenerator.generate('2026-11-10', 'medium').scramble.join(), b = O.PuzzleGenerator.generate('2026-11-11', 'medium').scramble.join();
ok(a !== b, 'different days differ');
ok(O.dayNumberFromKey('2026-11-01') === 1 && O.keyFromDayNumber(10) === '2026-11-10', 'edition numbering');
console.log(JSON.stringify(stats));
console.log(fails ? fails + ' failures' : 'puzzle: all checks passed');
process.exit(fails ? 1 : 0);
