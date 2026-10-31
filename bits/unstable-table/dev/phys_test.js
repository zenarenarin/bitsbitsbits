// Headless physics checks against the real simulation code (src/00, 02, 03).
// Run: node dev/phys_test.js
const fs = require('fs'), path = require('path');
const planck = require('./vendor/planck.min.js');
const src = ['00_util.js', '02_objects.js', '03_phys.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const mod = new Function('planck', src + '\nreturn { createSim, OBJECT_BY_ID, OBJECTS, PHYS, DEG };')(planck);
const { createSim, OBJECT_BY_ID: O, OBJECTS, DEG } = mod;

let fails = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
function settle(sim, secs) { for (let i = 0; i < secs * 60; i++) sim.step(); }
function surfaceAt(sim, x) { return sim.surfaceY(x) + 0.002; }
const deg = a => (a / DEG).toFixed(2) + '°';

// 1. Empty table rests level.
{ const s = createSim(planck); settle(s, 3); check('empty table rests level', Math.abs(s.angle()) < 0.001, deg(s.angle())); }

// 2. One object on the right tips the right side down (negative angle).
{ const s = createSim(planck); s.addObject(O.lidpot, 1.2, surfaceAt(s, 1.2)); settle(s, 5);
  check('weight on the right tilts right side down', s.angle() < -1 * DEG, deg(s.angle())); }

// 3. Two equal objects at equal distances balance.
{ const s = createSim(planck); s.addObject(O.lidpot, 1.2, surfaceAt(s, 1.2)); s.addObject(O.lidpot, -1.2, surfaceAt(s, -1.2)); settle(s, 6);
  check('equal objects at ±1.2 counterbalance', Math.abs(s.angle()) < 0.3 * DEG, deg(s.angle())); }

// 4. Leverage: the same heavy object tilts the table more when farther out.
{ const near = createSim(planck); near.addObject(O.bell, 0.4, surfaceAt(near, 0.4)); settle(near, 6);
  const far = createSim(planck); far.addObject(O.bell, 1.2, surfaceAt(far, 1.2)); settle(far, 6);
  check('heavy object near pivot has less leverage', Math.abs(near.angle()) < Math.abs(far.angle()) * 0.5, `near ${deg(near.angle())} far ${deg(far.angle())}`); }

// 5. Torque balance: a heavy object near the pivot balanced by a light object far out.
{ const s = createSim(planck);
  const m1 = O.bell.mass, m2 = O.lidpot.mass; // 5.0 and 1.8
  const x1 = -0.4, x2 = (m1 * 0.4) / m2; // m1*x1 + m2*x2 = 0
  s.addObject(O.bell, x1, surfaceAt(s, x1)); s.addObject(O.lidpot, x2, surfaceAt(s, x2)); settle(s, 8);
  check('m1*x1 = m2*x2 balances (5 at -0.4 vs 1.8 at ' + x2.toFixed(2) + ')', Math.abs(s.angle()) < 1.0 * DEG, deg(s.angle())); }

// 6. Every object settles upright on a level table at the pivot and does not drift.
for (const o of OBJECTS) {
  const s = createSim(planck);
  const b = s.addObject(o, 0, surfaceAt(s, 0)); settle(s, 4);
  const v = b.getLinearVelocity().length(), a = b.getAngle();
  check(`${o.id} settles at the pivot`, v < 0.02 && Math.abs(a) < 0.05, `v=${v.toFixed(3)} a=${deg(a)}`);
}

// 7. Slippery glass slides on a tilted table while grippy books stay.
{ const s = createSim(planck);
  s.addObject(O.bell, 1.4, surfaceAt(s, 1.4)); settle(s, 0.5);
  const p = s.addObject(O.perfume, -0.6, surfaceAt(s, -0.6) + 0.01);
  const k = s.addObject(O.books, -1.15, surfaceAt(s, -1.15) + 0.01);
  const p0 = p.getPosition().x, k0 = k.getPosition().x;
  settle(s, 3);
  check('tilt ' + deg(s.angle()) + ': perfume slides more than books', Math.abs(p.getPosition().x - p0) > Math.abs(k.getPosition().x - k0) + 0.05, `perfume ${(p.getPosition().x - p0).toFixed(3)} books ${(k.getPosition().x - k0).toFixed(3)}`); }

// 8. Bodies fall off the end and land on the floor.
{ const s = createSim(planck);
  const b = s.addObject(O.coconut, 1.55, surfaceAt(s, 1.55) + 0.3, 1.5, 0); settle(s, 4);
  check('object pushed off the end reaches the floor', s.touchesGround(b), `y=${b.getPosition().y.toFixed(2)}`); }

// 9. Tall stack erodes stability: same off-centre load gives more tilt with a tall stack at the pivot.
{ const a = createSim(planck); a.addObject(O.lidpot, 1.3, surfaceAt(a, 1.3)); settle(a, 6);
  const b = createSim(planck);
  let y = surfaceAt(b, 0);
  for (const id of ['books', 'books', 'books']) { const bb = b.addObject(O[id], 0, y + 0.01); settle(b, 1.5); y = bb.getPosition().y + 0.32; }
  b.addObject(O.lidpot, 1.3, surfaceAt(b, 1.3)); settle(b, 6);
  check('tall stack makes the same load tilt further', Math.abs(b.angle()) > Math.abs(a.angle()) * 1.1, `plain ${deg(a.angle())} stacked ${deg(b.angle())}`); }

// 10. Determinism: identical inputs give identical results.
{ const run = () => { const s = createSim(planck); s.addObject(O.vase, 0.8, surfaceAt(s, 0.8)); s.addObject(O.pear, -1.1, surfaceAt(s, -1.1)); settle(s, 1); s.addObject(O.bell, -0.3, surfaceAt(s, -0.3) + 0.2); settle(s, 5); return s.angle(); };
  const a = run(), b = run(); check('deterministic', a === b, `${a} vs ${b}`); }

// 11. Lift and drop: lifting an object removes its weight.
{ const s = createSim(planck); const b = s.addObject(O.bell, 1.2, surfaceAt(s, 1.2)); settle(s, 5);
  const before = s.angle(); s.lift(b); settle(s, 5); const lifted = s.angle();
  s.drop(b, -1.2, surfaceAt(s, -1.2) + 0.05); settle(s, 6);
  check('lifting returns table to level; dropping on the other side mirrors the tilt', Math.abs(lifted) < 0.4 * DEG && Math.abs(s.angle() + before) < 1.0 * DEG, `before ${deg(before)} lifted ${deg(lifted)} after ${deg(s.angle())}`); }

// 12. Natural period and damping report.
{ const s = createSim(planck); s.addObject(O.lidpot, 1.3, surfaceAt(s, 1.3)); let peak = 0, t = 0, settleT = null; const eq = (() => { const t2 = createSim(planck); t2.addObject(O.lidpot, 1.3, surfaceAt(t2, 1.3)); settle(t2, 10); return t2.angle(); })();
  for (let i = 0; i < 600; i++) { s.step(); peak = Math.max(peak, Math.abs(s.angle())); if (settleT == null && i > 30 && Math.abs(s.angle() - eq) < 0.2 * DEG && Math.abs(s.angVel()) < 0.01) settleT = i / 60; }
  console.log('INFO lidpot at 1.3: equilibrium', deg(eq), 'peak', deg(peak), 'settles in', settleT, 's'); }
{ const s = createSim(planck); s.addObject(O.bell, 1.0, surfaceAt(s, 1.0)); settle(s, 8); console.log('INFO bell at 1.0:', deg(s.angle())); }
{ const s = createSim(planck); s.addObject(O.bell, 1.4, surfaceAt(s, 1.4)); settle(s, 8); console.log('INFO bell at 1.4:', deg(s.angle())); }
{ const s = createSim(planck); s.addObject(O.lemon, 1.45, surfaceAt(s, 1.45)); settle(s, 8); console.log('INFO lemon at 1.45:', deg(s.angle())); }

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
