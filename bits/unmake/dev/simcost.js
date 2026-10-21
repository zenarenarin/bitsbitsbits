// CPU cost of one fixed simulation step with a full stretch of route loaded
// (the part of the frame that does not depend on the GPU).
const L = require('./load')('Phys, Player, Builder, buildSegment, makeRng, Sequencer, FAMILIES');
const P = new L.Phys(); const pl = new L.Player(P); P.player = pl;
const lead = new L.Builder(P, [0, 0, 14], -1, L.makeRng(1), 0); lead.deck(0, -14, { w: 4 });
const seq = new L.Sequencer(7, true); let end = [0, 0, 0];
while (end[2] > -190) { const m = L.buildSegment(P, seq.next(0.3, end[1]), 1234 + P.bodies.length, 0.3, end, 1); end = m.exitPos; }
pl.reset([0, 0.02, 10]);
const N = 3000; const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) { pl.step(1 / 60, { steer: 0, pace: 0 }, 0); P.step(1 / 60); if (!pl.alive || pl.pos[1] < -20) pl.reset([0, 0.02, 10]); }
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
console.log(`bodies ${P.bodies.length}, connections ${P.conns.length}: ${ms.toFixed(3)} ms per step (budget at 60 fps: 16.7 ms; phones are roughly 3-5x slower than this machine)`);
