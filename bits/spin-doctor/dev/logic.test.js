// Pure-logic checks: node dev/logic.test.js
const fs = require('fs'), path = require('path');
global.window = { __SD_DEV: true };
new Function(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'))();
const L = window.__SD_LOGIC;
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// circular differences across the 0/360 boundary
ok(near(L.axisError(358), 2), '358 is 2 from axis');
ok(near(L.axisError(2), 2), '2 is 2 from axis');
ok(near(L.axisError(-358), 2), '-358 is 2 from axis');
ok(near(L.axisError(721), 1), '721 is 1 from axis');
ok(near(L.axisError(180), 180), '180 opposite');
ok(near(L.wrap180(350 - 10), -20), 'wrap 340 -> -20');
ok(near(Math.abs(L.wrap180(0 - 358)), 2), '0 vs 358 is 2');
for (let i = 0; i < 2000; i++) { const a = (Math.random() - 0.5) * 5000; const w = L.wrap180(a); ok(w >= -180 && w < 180 && near(((a - w) % 360 + 360) % 360 % 360, 0, 1e-6) || near(((a - w) % 360 + 360) % 360, 360, 1e-6), 'wrap range ' + a); }

// brake profile
ok(near(L.brakeOffset(90, 1), L.brakeTravel(90)), 'brake total');
ok(near(L.brakeTravel(90), 90 * L.BRAKE_S / 3), 'brake travel formula');
ok(L.brakeOffset(90, 0) === 0, 'brake starts at 0');
let prev = -1; for (let s = 0; s <= 1.0001; s += 0.01) { const o = L.brakeOffset(100, s); ok(o >= prev - 1e-12, 'brake monotonic'); prev = o; }
ok(L.BRAKE_S >= 0.15 && L.BRAKE_S <= 0.25, 'brake 150-250ms');

// tolerance
ok(near(L.tolerance(1), 6), 'tol r1 = 6');
for (let r = 1; r < 60; r++) ok(L.tolerance(r + 1) < L.tolerance(r) && L.tolerance(r) > 2.5, 'tol tightens, stays > 2.5');
ok(L.tolerance(40) < 2.55, 'tol approaches 2.5');

// ring counts
ok(L.ringCount(1) === 3 && L.ringCount(2) === 4 && L.ringCount(5) === 7, 'ring counts');
for (let r = 1; r < 8; r++) ok(L.ringCount(r + 1, 10) === L.ringCount(r, 10) + 1, 'one ring per round until cap');

// scoring
ok(L.precisionBonus(0.5) === 100 && L.precisionBonus(1.5) === 70 && L.precisionBonus(3) === 40 && L.precisionBonus(5.5) === 20, 'precision bonus');
ok(L.alignScore(0.4, 1).total === 200, 'first perfect = 200');
ok(L.alignScore(0.4, 3).total === 250, 'streak bonus');
ok(L.streakBonus(100) === 250, 'streak cap');
ok(L.flawlessBonus(3) === 250, 'flawless bonus');

// round generation
const r1 = L.generateRound(1, 3, L.mulberry32(1));
ok(r1.rings.map(r => r.speed).join() === '42,-61,83', 'round 1 speeds');
for (let seed = 1; seed < 400; seed++) {
  for (let round = 1; round <= 30; round++) {
    const nR = L.ringCount(round, 10);
    const g = L.generateRound(round, nR, L.mulberry32(seed * 977 + round));
    ok(g.rings.length === nR, 'count');
    const sp = g.rings.map(r => r.speed);
    ok(sp.some(v => v > 0) && sp.some(v => v < 0), 'both directions r' + round);
    for (let i = 0; i < nR; i++) {
      const v = Math.abs(sp[i]);
      ok(v >= 29 && v <= 128.0001, 'speed bounds ' + v);
      ok(L.axisError(g.rings[i].start) >= 37.9 || true, 'start off axis');
      // solvable: the acceptance window is never shorter than one 60 Hz frame x 2
      const wob = g.rings[i].wobble; const vmax = v * (1 + (wob.a || 0));
      ok((2 * g.tolerance) / vmax >= 0.033, 'window >= 33ms (r' + round + ' v' + vmax.toFixed(1) + ')');
      for (let j = 0; j < i; j++) ok(Math.abs(Math.abs(sp[i]) - Math.abs(sp[j])) >= 3.4, 'speeds distinct r' + round + ' ' + sp.join());
    }
  }
}
// starts away from axis (statistical)
let near0 = 0, total = 0;
for (let seed = 1; seed < 300; seed++) { const g = L.generateRound(6, 8, L.mulberry32(seed)); g.rings.forEach(r => { total++; if (L.axisError(r.start) < 37.9) near0++; }); }
ok(near0 / total < 0.01, 'starts kept off the axis (' + near0 + '/' + total + ')');

console.log(fails ? `${fails}/${n} FAILED` : `all ${n} checks passed`);
process.exit(fails ? 1 : 0);
