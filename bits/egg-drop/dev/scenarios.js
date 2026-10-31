// The brief's physics scenarios, run headless against the real simulation.
const { pl, createSim, createDisturbance, GEOM } = require('./simload');
const H = 1 / 120;
const results = [];
const check = (name, cond, info) => results.push([cond ? 'PASS' : 'FAIL', name, info]);
const deg = r => (r * 180 / Math.PI).toFixed(2) + '°';
const steps = (s, sec, fn) => { for (let i = 0; i < Math.round(sec / H); i++) { fn && fn(i * H); s.step(H); } };
// hold the platform at an angle with an external servo torque (stands in for a hand on the platform)
const servo = (s, th, kp = 600, kd = 60) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * kp - s.platform.getAngularVelocity() * kd; };

// 1-3: counterweight positions genuinely set the torque balance
for (const [name, pos, expect] of [['1 counterweight fully left', -GEOM.travel, 1], ['2 counterweight fully right', GEOM.travel, -1], ['3 counterweight centred', 0, 0]]) {
  const s = createSim(pl, {}); s.dragging = true; s.target = pos;
  // pin the egg: measure the platform alone first, then with the egg
  steps(s, 1.0);
  const a = s.angle();
  const torqueArm = -s.cw.getMass() * s.g * s.cw.getWorldCenter().x;
  check(name, expect === 0 ? Math.abs(a) < 0.005 : Math.sign(a) === expect && Math.abs(a) > 0.3, `angle ${deg(a)}, carriage torque ${torqueArm.toFixed(2)} N·m`);
}
// torque balance: egg held off centre is cancelled by the carriage at -m_e x / m_cw
{
  const s = createSim(pl, { eggX: 1.0 });
  s.dragging = true;
  const xe = s.eggLocal().x;
  const comp = -s.egg.getMass() * xe / s.cw.getMass();
  s.target = comp;
  // keep the egg from rolling by holding the platform level, then read the residual torque the hold needs
  for (let i = 0; i < 240; i++) { servo(s, 0); s.step(H); }
  const net = s.gravityTorque();
  const s0 = createSim(pl, { eggX: 1.0 }); s0.dragging = true; s0.target = 0;
  for (let i = 0; i < 240; i++) { servo(s0, 0); s0.step(H); }
  check('torque: carriage cancels an off-centre egg', Math.abs(net) < 0.05 * Math.abs(s0.gravityTorque()) && Math.abs(s0.gravityTorque()) > 4, `egg x ${xe.toFixed(2)}: gravity torque ${s0.gravityTorque().toFixed(2)} N·m with carriage centred, ${net.toFixed(3)} N·m with carriage at ${s.cwPos().toFixed(3)} (predicted ${comp.toFixed(3)})`);
}
// 4: egg stationary on a level platform
{
  const s = createSim(pl, {}); s.dragging = true; s.target = 0;
  steps(s, 3, () => servo(s, 0));
  const xa = s.eggLocal().x;
  steps(s, 3, () => servo(s, 0));
  const v = s.eggLocalVel();
  check('4 egg at rest on a level deck', Math.abs(s.eggLocal().x - xa) < 0.002 && Math.hypot(v.x, v.y) < 0.005, `settled at x ${xa.toFixed(3)} (off-centre centre of mass rocks it there), drift over the next 3 s ${(s.eggLocal().x - xa).toFixed(4)} m, speed ${Math.hypot(v.x, v.y).toFixed(5)}`);
}
// 5: a gradually tilting platform: the egg holds, then starts downhill and accelerates
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  let startAt = null, vA = null, vB = null, t = 0;
  while (t < 10 && vB === null) {
    servo(s, -0.25 * Math.min(1, t / 7)); s.step(H); t += H;
    const x = s.eggLocal().x;
    if (startAt === null && x > 0.05) startAt = s.angle();
    if (vA === null && x > 0.4) vA = s.eggLocalVel().x;
    if (vB === null && x > 1.4) vB = s.eggLocalVel().x;
  }
  check('5 egg rolls downhill on a slow tilt, accelerating', startAt !== null && vA > 0 && vB > vA, `breaks away at ${deg(Math.abs(startAt || 0))}; ${vA && vA.toFixed(2)} m/s at 0.4 m, ${vB && vB.toFixed(2)} m/s at 1.4 m`);
}
// 6-7: friction: rubber rolls, metal slides (rolling fraction = rω / travel)
const rollFrac = (surface, th) => {
  const s = createSim(pl, { surface }); s.dragging = true;
  steps(s, 0.5, () => servo(s, 0));
  const x0 = s.eggLocal().x, a0 = s.egg.getAngle();
  let t = 0;
  while (t < 4 && Math.abs(s.eggLocal().x - x0) < 1.0) { servo(s, th); s.step(H); t += H; }
  const travel = Math.abs(s.eggLocal().x - x0), spin = Math.abs(s.egg.getAngle() - a0) * 0.3;
  return { frac: spin / Math.max(1e-6, travel), t, travel };
};
{
  const r = rollFrac('rubber', -0.29), m = rollFrac('metal', -0.29), c = rollFrac('ceramic', -0.29), w = rollFrac('wood', -0.29);
  check('6 high friction (rubber): rolls without slipping', r.frac > 0.8, `rolling fraction ${r.frac.toFixed(2)}, 1 m in ${r.t.toFixed(2)} s`);
  check('7 low friction (metal): slips on a steep tilt and gets away faster', m.frac < 0.8 && m.t < r.t, `rolling fraction ${m.frac.toFixed(2)}, 1 m in ${m.t.toFixed(2)} s`);
  check('  rolling fraction by surface', r.frac >= w.frac - 0.02 && w.frac >= m.frac, `rubber ${r.frac.toFixed(2)} wood ${w.frac.toFixed(2)} ceramic ${c.frac.toFixed(2)} metal ${m.frac.toFixed(2)}`);
  // break-away tilt on a slow ramp, and coasting distance on a level deck
  const brk = {}, coast = {};
  for (const su of ['rubber', 'wood', 'ceramic', 'metal']) {
    const s = createSim(pl, { surface: su }); s.dragging = true; brk[su] = 99;
    for (let i = 0; i < 1200; i++) { servo(s, -0.3 * Math.min(1, i * H / 10)); s.step(H); if (s.eggLocal().x > 0.08) { brk[su] = -s.angle() * 180 / Math.PI; break; } }
    const q = createSim(pl, { surface: su }); q.dragging = true;
    steps(q, 0.3, () => servo(q, 0));
    q.egg.setLinearVelocity(pl.Vec2(0.9, 0)); q.egg.setAngularVelocity(-0.9 / 0.3);
    const x0 = q.eggLocal().x;
    steps(q, 3, () => servo(q, 0));
    coast[su] = q.eggLocal().x - x0;
  }
  check('  surfaces: break-away tilt rubber > wood > ceramic > metal', brk.rubber > brk.wood && brk.wood > brk.ceramic && brk.ceramic > brk.metal, Object.entries(brk).map(([k, v]) => k + ' ' + v.toFixed(1) + '°').join(', '));
  check('  surfaces: a pushed egg coasts further on smoother finishes', coast.rubber < coast.wood && coast.wood < coast.ceramic, Object.entries(coast).map(([k, v]) => k + ' ' + v.toFixed(2) + ' m').join(', '));
}
// static friction threshold on metal: below tan⁻¹(μs) and below the shape's tipping angle the egg stays put
{
  // the platform is jerked sideways in rotation: a grippy deck carries the egg, a slick one lets it slip
  const jerk = (su) => {
    const s = createSim(pl, { surface: su }); s.dragging = true;
    steps(s, 1.5, () => servo(s, 0));
    let slipT = 0;
    for (let i = 0; i < 60; i++) { servo(s, 0.12 * Math.sin(i * H * 18), 2500, 120); s.step(H); if (s.slipping) slipT += H; }
    return slipT;
  };
  const jr = jerk('rubber'), jm = jerk('metal');
  check('  static friction: a sharp jolt slips the egg on metal, not on rubber', jr < 0.02 && jm > 0.05, `slipping time over 0.5 s of jolts: rubber ${jr.toFixed(3)} s, metal ${jm.toFixed(3)} s`);
}
// 8: reversing the tilt while the egg has momentum
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  steps(s, 0.3, () => servo(s, 0));
  let t = 0;
  while (s.eggLocalVel().x < 0.45 && t < 5) { servo(s, -0.2); s.step(H); t += H; }
  const vAt = s.eggLocalVel().x, xAt = s.eggLocal().x;
  let more = 0, peak = xAt, tt = 0;
  while (tt < 3) { servo(s, 0.2); s.step(H); tt += H; const x = s.eggLocal().x; if (x > peak) { peak = x; more = tt; } }
  check('8 momentum carries through a reversal', more > 0.25 && peak > xAt + 0.08, `moving ${vAt.toFixed(2)} m/s at reversal, kept going ${more.toFixed(2)} s and ${(peak - xAt).toFixed(2)} m before turning back`);
}
// 9: moving the carriage while the egg rolls: constraints hold
{
  const s = createSim(pl, { surface: 'ceramic' }); s.dragging = true;
  let maxCw = 0, maxOffRail = 0, lost = 0, n = 0;
  steps(s, 6, (t) => {
    // a balancing hand plus an extra back-and-forth sweep of the carriage
    const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
    const want = Math.max(-0.2, Math.min(0.2, 0.12 * e.x + 0.16 * v.x));
    s.target = Math.max(-GEOM.travel, Math.min(GEOM.travel, -(0.5 / 0.95) * e.x - 4 * (want - a) + 0.6 * w + 0.5 * Math.sin(t * 2.1)));
    maxCw = Math.max(maxCw, Math.abs(s.cwPos()));
    const lp = s.platform.getLocalPoint(s.cw.getPosition());
    maxOffRail = Math.max(maxOffRail, Math.abs(lp.y - GEOM.railY));
    n++; if (!s.eggOnDeck) lost++;
  });
  check('9 carriage stays on its rail and in its limits while the egg rolls', maxCw < GEOM.travel + 0.01 && maxOffRail < 0.005 && !s.eggFallen() && lost / n < 0.2, `max |x| ${maxCw.toFixed(3)} (limit ${GEOM.travel}), off-rail ${maxOffRail.toFixed(4)} m, egg airborne ${(100 * lost / n).toFixed(1)}% of steps`);
}
// 10: a strong gust then recovery by a simple controller
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  let t = 0, fell = false, worst = 0;
  while (t < 8) {
    const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
    const want = Math.max(-0.2, Math.min(0.2, 0.12 * e.x + 0.16 * v.x));
    s.target = Math.max(-GEOM.travel, Math.min(GEOM.travel, -(0.5 / 0.95) * e.x - 4 * (want - a) + 0.6 * w));
    s.disturb = (t > 1 && t < 2) ? 6.5 * Math.sin((t - 1) * Math.PI) : 0;
    s.step(H); t += H;
    worst = Math.max(worst, Math.abs(e.x));
    if (s.eggFallen()) { fell = true; break; }
  }
  check('10 strong gust, then recovery', !fell && Math.abs(s.eggLocal().x) < 0.5, `6.5 N·m gust; egg reached ${worst.toFixed(2)} m from centre, ended at ${s.eggLocal().x.toFixed(2)} m`);
}
// 11: approaching the edge and falling: no game over until it is truly off
{
  const s = createSim(pl, { surface: 'wood' }); s.dragging = true;
  let t = 0, flaggedNear = false, fellAt = null, xAtFall = 0;
  while (t < 8 && fellAt === null) {
    servo(s, -0.18); s.step(H); t += H;
    const x = s.eggLocal().x;
    if (x > 1.7 && x < GEOM.half && s.eggFallen()) flaggedNear = true;
    if (s.eggFallen()) { fellAt = t; xAtFall = x; }
  }
  let y0 = s.egg.getWorldCenter().y;
  steps(s, 0.6, () => { s.disturb = 0; });
  const y1 = s.egg.getWorldCenter().y;
  check('11 edge: falls only once past the deck end, then keeps falling', fellAt !== null && !flaggedNear && xAtFall > GEOM.half && y1 < y0 - 0.5, `fell at ${fellAt && fellAt.toFixed(2)} s, ${xAtFall.toFixed(2)} m from centre; dropped ${(y0 - y1).toFixed(2)} m in 0.6 s`);
}
// 12: restart: a new world is independent and deterministic
{
  const runOnce = () => { const s = createSim(pl, {}); const d = createDisturbance(1234); s.dragging = false; let t = 0; while (t < 12) { s.disturb = d.update(t, H, 0); s.step(H); t += H; } return [s.angle(), s.eggLocal().x]; };
  const a = runOnce(), b = runOnce();
  check('12 restart: fresh worlds replay identically for a seed', a[0] === b[0] && a[1] === b[1], `angle ${a[0].toFixed(6)} / ${b[0].toFixed(6)}`);
  const d1 = createDisturbance(1), d2 = createDisturbance(2); let diff = 0;
  for (let t = 0; t < 30; t += H) diff = Math.max(diff, Math.abs(d1.update(t, H, 0) - d2.update(t, H, 0)));
  check('  runs differ by seed', diff > 0.3, `max torque difference ${diff.toFixed(2)} N·m`);
}
// the egg's own weight moves the platform (coupling both ways)
{
  const s = createSim(pl, { eggX: 1.2 }); s.dragging = true; s.target = 0;
  const e0 = s.eggLocal().x;
  steps(s, 0.25);
  check('  egg weight tips the platform', s.angle() < -0.01, `egg at ${e0.toFixed(2)} m, platform ${deg(s.angle())} after 0.25 s`);
}
// the disturbance stays bounded and fair
{
  let peak = 0;
  for (let seed = 1; seed <= 20; seed++) { const d = createDisturbance(seed); for (let t = 0; t < 180; t += H) peak = Math.max(peak, Math.abs(d.update(t, H, 0))); }
  const early = (() => { let p = 0; for (let seed = 1; seed <= 20; seed++) { const d = createDisturbance(seed); for (let t = 0; t < 10; t += H) p = Math.max(p, Math.abs(d.update(t, H, 0))); } return p; })();
  const capacity = 0.95 * 9.81 * GEOM.travel;
  check('  disturbance bounded below what the carriage can answer', peak < capacity * 0.75 && early < 0.75, `peak ${peak.toFixed(2)} N·m over 20 seeds × 3 min (carriage reach ${capacity.toFixed(1)} N·m); first 10 s ≤ ${early.toFixed(2)}`);
}
for (const r of results) console.log(r[0], ' ', r[1], ' — ', r[2]);
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
