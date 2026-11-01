// Physics checks against the real simulation (headless). Numbered items follow
// the refinement brief's PHYSICS list; unnumbered ones check coupling invariants.
const { pl, createSim, createDisturbance, GEOM, SURFACES } = require('./simload');
const H = 1 / 120;
const results = [];
const check = (name, cond, info) => results.push([cond ? 'PASS' : 'FAIL', name, info]);
const D = r => (r * 180 / Math.PI).toFixed(1) + '°';
const run = (s, sec, fn) => { for (let i = 0; i < Math.round(sec / H); i++) { fn && fn(i * H); s.step(H); } };
// a hand on the platform: an external servo torque that holds a chosen angle
const hold = (s, th) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * 600 - s.platform.getAngularVelocity() * 60; };
const SURF = ['rubber', 'wood', 'ceramic', 'metal'];
// a balancing hand on the carriage (used where a player is needed)
const hand = (s) => {
  const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
  const want = Math.max(-0.2, Math.min(0.2, 0.12 * e.x + 0.16 * v.x));
  s.dragging = true;
  s.target = Math.max(-GEOM.travel, Math.min(GEOM.travel, -(s.egg.getMass() / s.cw.getMass()) * e.x - 1.2 * (want - a) + 0.25 * w));
};

// 1. egg stationary on a horizontal platform, every surface
for (const su of SURF) {
  const s = createSim(pl, { surface: su }); s.dragging = true;
  run(s, 3, () => hold(s, 0));
  const x0 = s.eggLocal().x;
  run(s, 5, () => hold(s, 0));
  const v = s.eggLocalVel();
  check(`1 egg stays put on a level deck (${su})`, Math.abs(s.eggLocal().x - x0) < 0.001 && Math.hypot(v.x, v.y) < 0.002 && s.eggOnDeck, `drift ${((s.eggLocal().x - x0) * 1000).toFixed(2)} mm over 5 s, speed ${Math.hypot(v.x, v.y).toFixed(4)} m/s, in contact ${s.eggOnDeck}`);
}

// 2. egg rolling on a tilted platform: accelerates downhill, turns as it rolls, stays on the deck
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  run(s, 1, () => hold(s, 0));
  const a0 = s.egg.getAngle(), x0 = s.eggLocal().x;
  let vA = null, vB = null, onDeck = 0, n = 0;
  run(s, 1.6, (t) => { hold(s, 0.14); if (t > 0.5 && vA === null) vA = s.eggLocalVel().x; n++; if (s.eggOnDeck) onDeck++; });
  vB = s.eggLocalVel().x;
  const dx = s.eggLocal().x - x0, turn = s.egg.getAngle() - a0;
  check('2 egg rolls downhill on a tilted deck', vA < 0 && vB < vA && dx < -0.3 && turn > 1, `8° left-down: speed ${vA.toFixed(2)} -> ${vB.toFixed(2)} m/s, moved ${dx.toFixed(2)} m, turned ${(turn * 57.3).toFixed(0)}° (rolling turns it anticlockwise), in contact ${(100 * onDeck / n).toFixed(0)}% of steps`);
}

// 3. the brief's sequence: level, tilt left slowly (holds, then breaks away), then tilt right while it moves left
for (const su of SURF) {
  const s = createSim(pl, { surface: su }); s.dragging = true;
  run(s, 2, () => hold(s, 0));
  const x0 = s.eggLocal().x;
  let th = 0, t = 0, broke = null, stillAt1 = null;
  // ramp 0.6 deg/s; "moving" = 3 cm from where it sat
  while (broke === null && t < 30) {
    th = (0.6 * Math.PI / 180) * t; hold(s, th); s.step(H); t += H;
    if (stillAt1 === null && th >= 0.5 * Math.PI / 180) stillAt1 = Math.abs(s.eggLocal().x - x0);
    if (s.eggLocal().x - x0 < -0.03) broke = th;
  }
  // keep that tilt until it is really rolling, then tilt the other way
  let tb = 0; while (s.eggLocalVel().x > -0.35 && tb < 4) { hold(s, Math.max(th, 0.16)); s.step(H); tb += H; }
  const vRev = s.eggLocalVel().x, xRev = s.eggLocal().x;
  let tt = 0, minX = xRev, keptFor = 0;
  while (tt < 3 && s.eggLocalVel().x < 0) { hold(s, -0.14); s.step(H); tt += H; minX = Math.min(minX, s.eggLocal().x); keptFor = tt; }
  const carry = xRev - minX;
  check(`3 holds, breaks away, carries through a reversal (${su})`, broke !== null && stillAt1 < 0.005 && vRev < -0.3 && keptFor > 0.15 && carry > 0.05, `still at 0.5° (moved ${(stillAt1 * 1000).toFixed(1)} mm); 3 cm of travel at ${D(broke || 0)}; tilted right while moving ${(-vRev).toFixed(2)} m/s left: kept going left ${keptFor.toFixed(2)} s and ${carry.toFixed(2)} m, then came back`);
}

// 4. the materials change the physics, not just the paint
{
  const brk = {}, frac = {}, coast = {}, slip = {}, t1m = {};
  for (const su of SURF) {
    let s = createSim(pl, { surface: su }); s.dragging = true; brk[su] = 99;
    run(s, 2, () => hold(s, 0));
    for (let t = 0; t < 30; t += H) { hold(s, -(0.5 * Math.PI / 180) * t); s.step(H); if (s.eggLocalVel().x > 0.05) { brk[su] = -s.angle() * 180 / Math.PI; break; } }
    s = createSim(pl, { surface: su }); s.dragging = true;
    run(s, 1, () => hold(s, 0));
    const x0 = s.eggLocal().x, a0 = s.egg.getAngle(); let t = 0;
    while (t < 4 && Math.abs(s.eggLocal().x - x0) < 1.0) { hold(s, -0.29); s.step(H); t += H; }
    frac[su] = Math.abs(s.egg.getAngle() - a0) * 0.3 / Math.max(1e-6, Math.abs(s.eggLocal().x - x0)); t1m[su] = t;
    s = createSim(pl, { surface: su }); s.dragging = true;
    run(s, 2, () => hold(s, 0));
    s.egg.setLinearVelocity(pl.Vec2(0.9, 0)); s.egg.setAngularVelocity(-0.9 / 0.3);
    const xc = s.eggLocal().x; run(s, 3, () => hold(s, 0)); coast[su] = s.eggLocal().x - xc;
    s = createSim(pl, { surface: su }); s.dragging = true;
    run(s, 2, () => hold(s, 0));
    let st = 0; for (let i = 0; i < 60; i++) { s.disturb = -s.gravityTorque() + (0.12 * Math.sin(i * H * 18) - s.angle()) * 2500 - s.platform.getAngularVelocity() * 120; s.step(H); if (s.slipping) st += H; }
    slip[su] = st;
  }
  const fmt = (o, d, u) => SURF.map(k => k + ' ' + o[k].toFixed(d) + u).join(', ');
  check('4a break-away tilt: rubber > wood > ceramic > metal', brk.rubber > brk.wood && brk.wood > brk.ceramic && brk.ceramic > brk.metal && brk.rubber - brk.metal > 2, fmt(brk, 1, '°'));
  check('4b steep tilt (17°): metal slides, rubber and wood roll', frac.rubber > 0.9 && frac.wood > 0.9 && frac.metal < 0.6, 'rolling fraction ' + fmt(frac, 2, ''));
  check('4c a pushed egg coasts further on smoother finishes', coast.rubber < coast.wood && coast.wood < coast.ceramic && coast.ceramic < coast.metal, fmt(coast, 2, ' m'));
  check('4d sharp jolts: grip on rubber, slip on metal', slip.rubber < 0.02 && slip.metal > 0.1, 'time slipping in 0.5 s of jolts: ' + fmt(slip, 2, ' s'));
}

// 5-6. counterweight fully left / right, and a progressive response in between
for (const [n, dir] of [['5 counterweight fully left', -1], ['6 counterweight fully right', 1]]) {
  const s = createSim(pl, {}); s.dragging = true; s.target = dir * GEOM.travel;
  run(s, 2);
  check(n, Math.abs(s.cwPos() - dir * GEOM.travel) < 0.01 && Math.sign(s.angle()) === -dir && Math.abs(s.angle()) > 0.3, `carriage ${s.cwPos().toFixed(3)} m, platform ${D(s.angle())} (${dir < 0 ? 'left' : 'right'} end down, at its stop)`);
}
{
  const out = [];
  for (const x of [0.05, 0.1, 0.2, 0.3]) { const s = createSim(pl, {}); s.egg.setActive(false); s.dragging = true; s.target = x; run(s, 4); out.push([x, -s.angle()]); }
  const mono = out.every((o, i) => i === 0 || o[1] > out[i - 1][1]);
  check('  carriage position maps progressively to tilt', mono && out[0][1] < 0.06 && out[3][1] < 0.3, out.map(o => `${o[0]} m -> ${D(o[1])}`).join(', '));
}
// torque: moving the carriage changes gravitational torque; it can cancel the egg
{
  const s0 = createSim(pl, { eggX: 1.0 }); s0.dragging = true; s0.target = 0;
  run(s0, 2, () => hold(s0, 0));
  const s = createSim(pl, { eggX: 1.0 }); s.dragging = true;
  run(s, 2, () => { s.target = -s.egg.getMass() * s.eggLocal().x / s.cw.getMass(); hold(s, 0); });
  check('  carriage cancels an off-centre egg (torque balance)', Math.abs(s.gravityTorque()) < 0.03 * Math.abs(s0.gravityTorque()), `egg at ${s.eggLocal().x.toFixed(2)} m: ${s0.gravityTorque().toFixed(2)} N·m with carriage centred, ${s.gravityTorque().toFixed(3)} N·m with carriage at ${s.cwPos().toFixed(3)} m`);
  const m = [s.platform, s.cw, s.egg].map(b => b.getMass().toFixed(2));
  check('  platform, carriage and egg masses all in the dynamics', s.platform.getMass() > 1 && s.cw.getMass() > 1 && s.egg.getMass() > 0.4, `platform ${m[0]} kg, carriage ${m[1]} kg, egg ${m[2]} kg; inertia about pivot ${s.inertiaAboutPivot().toFixed(2)} kg·m²`);
}
// the egg's weight moves the platform; the platform's rotation is about the pivot
{
  const s = createSim(pl, { eggX: 1.2 }); s.dragging = true; s.target = 0;
  run(s, 0.3);
  const pv = s.platform.getPosition();
  check('  egg weight tips the platform; platform turns about its pivot', s.angle() < -0.02 && Math.hypot(pv.x, pv.y) < 1e-3, `egg at 1.2 m -> ${D(s.angle())} after 0.3 s; pivot drift ${(Math.hypot(pv.x, pv.y) * 1000).toFixed(3)} mm`);
}

// 7. carriage moved while the egg rolls: everything stays on its constraints
{
  const s = createSim(pl, { surface: 'ceramic' });
  let maxCw = 0, offRail = 0, lost = 0, n = 0, pen = 0;
  run(s, 8, (t) => {
    hand(s); s.target = Math.max(-GEOM.travel, Math.min(GEOM.travel, s.target + 0.25 * Math.sin(t * 2.1)));
    maxCw = Math.max(maxCw, Math.abs(s.cwPos()));
    offRail = Math.max(offRail, Math.abs(s.platform.getLocalPoint(s.cw.getPosition()).y - GEOM.railY));
    const l = s.eggLocal(); pen = Math.max(pen, (GEOM.deckTop + GEOM.eggB * 0.97) - l.y);
    n++; if (!s.eggOnDeck) lost++;
  });
  check('7 carriage moved while the egg rolls', maxCw <= GEOM.travel + 0.006 && offRail < 0.004 && lost / n < 0.1 && !s.eggFallen(), `max |x| ${maxCw.toFixed(3)} m (limit ${GEOM.travel}), off rail ${(offRail * 1000).toFixed(1)} mm, egg out of contact ${(100 * lost / n).toFixed(1)}% of steps`);
}

// 8. recovery from a near-fall
{
  const s = createSim(pl, { surface: 'wood', eggX: 1.62 });
  s.egg.setLinearVelocity(pl.Vec2(0.25, 0));
  let fell = false, worst = 0;
  run(s, 10, () => { if (fell) return; hand(s); worst = Math.max(worst, s.eggLocal().x); if (s.eggFallen()) fell = true; });
  check('8 egg recovered from the brink', !fell && Math.abs(s.eggLocal().x) < 0.6, `start 1.62 m out, moving outward 0.25 m/s; got to ${worst.toFixed(2)} m (deck end ${GEOM.half} m), finished at ${s.eggLocal().x.toFixed(2)} m`);
}
// a strong gust, then recovery
{
  const s = createSim(pl, { surface: 'wood' });
  let fell = false, worst = 0, t = 0;
  while (t < 8) { hand(s); s.disturb = (t > 1 && t < 2) ? 13 * Math.sin((t - 1) * Math.PI) : 0; s.step(H); t += H; worst = Math.max(worst, Math.abs(s.eggLocal().x)); if (s.eggFallen()) { fell = true; break; } }
  check('  strong gust, then recovery', !fell && Math.abs(s.eggLocal().x) < 0.5, `13 N·m gust; egg reached ${worst.toFixed(2)} m from centre, ended ${s.eggLocal().x.toFixed(2)} m`);
}

// 9. falling beyond the platform; never called fallen for an angle alone
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  let t = 0, early = false, fellAt = null, xAt = 0;
  while (t < 8 && fellAt === null) { hold(s, -0.25); s.step(H); t += H; const x = s.eggLocal().x; if (s.eggFallen() && x < GEOM.half) early = true; if (s.eggFallen()) { fellAt = t; xAt = x; } }
  const y0 = s.egg.getWorldCenter().y; run(s, 0.5, () => { s.disturb = 0; }); const y1 = s.egg.getWorldCenter().y;
  check('9 egg falls past the deck end, then keeps falling', fellAt !== null && !early && xAt > GEOM.half && y0 - y1 > 0.4, `fallen at ${fellAt && fellAt.toFixed(2)} s, ${xAt.toFixed(2)} m out; dropped ${(y0 - y1).toFixed(2)} m in the next 0.5 s`);
  const q = createSim(pl, { surface: 'rubber' }); q.dragging = true; q.target = GEOM.travel;
  let any = false; run(q, 0.25, () => { if (q.eggFallen()) any = true; });
  check('  platform at its stop is not a game over', !any && Math.abs(q.angle()) > 0.2, `platform reached ${D(q.angle())} with the egg still on the deck at ${q.eggLocal().x.toFixed(2)} m; fallen flagged: ${any}`);
}

// determinism, disturbance fairness
{
  const once = () => { const s = createSim(pl, {}); const d = createDisturbance(1234); let t = 0; while (t < 12) { s.disturb = d.update(t, H, 0); s.step(H); t += H; } return [s.angle(), s.eggLocal().x]; };
  const a = once(), b = once();
  check('  a seed replays identically (fixed step)', a[0] === b[0] && a[1] === b[1], `angle ${a[0].toFixed(6)} / ${b[0].toFixed(6)}`);
  let peak = 0;
  for (let seed = 1; seed <= 20; seed++) { const d = createDisturbance(seed); for (let t = 0; t < 180; t += H) peak = Math.max(peak, Math.abs(d.update(t, H, 0))); }
  const reach = 1.4 * 9.81 * GEOM.travel;
  check('  disturbance stays below what the carriage can answer', peak < reach * 0.8, `peak ${peak.toFixed(1)} N·m over 20 seeds × 3 min; carriage reach ${reach.toFixed(1)} N·m`);
}
for (const r of results) console.log(r[0], ' ', r[1], ' — ', r[2]);
console.log(results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' passed');
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
