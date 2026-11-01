// Measure the current mechanics: carriage-to-angle sensitivity, egg break-away, creep at rest.
const { pl, createSim, GEOM } = require('./simload');
const H = 1 / 120;
const deg = r => (r * 180 / Math.PI).toFixed(1);
// 1. stiffness: equilibrium angle vs carriage position, egg removed from the deck
for (const x of [0.05, 0.1, 0.2, 0.3, 0.5]) {
  const s = createSim(pl, {}); s.egg.setActive(false); s.dragging = true; s.target = x;
  for (let i = 0; i < 600; i++) s.step(H);
  process.stdout.write(`carriage ${x} m -> ${deg(s.angle())}°  `);
}
{ const s = createSim(pl, {}); s.egg.setActive(false); const k0 = []; for (const a of [0.05]) { s.platform.setTransform(pl.Vec2(0, 0), a); s.cw.setTransform(s.platform.getWorldPoint(pl.Vec2(0, GEOM.railY)), a); } console.log('\nrestoring torque at 0.05 rad (platform+carriage):', s.gravityTorque().toFixed(2), 'N·m  => k =', (-s.gravityTorque() / 0.05).toFixed(2), 'N·m/rad'); }
// 2. break-away on a slow ramp (0.5°/s), measured by the egg's speed along the deck
const servo = (s, th) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * 600 - s.platform.getAngularVelocity() * 60; };
for (const su of ['rubber', 'wood', 'ceramic', 'metal']) {
  const s = createSim(pl, { surface: su }); s.dragging = true;
  for (let i = 0; i < 240; i++) { servo(s, 0); s.step(H); }
  let t = 0, br = null;
  while (t < 40 && br === null) { servo(s, -(0.5 * Math.PI / 180) * t); s.step(H); t += H; if (s.eggLocalVel().x > 0.05) br = -s.angle(); }
  // creep at rest on a level deck
  const q = createSim(pl, { surface: su }); q.dragging = true;
  for (let i = 0; i < 360; i++) { servo(q, 0); q.step(H); }
  const x0 = q.eggLocal().x; for (let i = 0; i < 1200; i++) { servo(q, 0); q.step(H); }
  console.log(su.padEnd(8), 'starts moving at', br ? deg(br) + '°' : '>20°', '| creep on level deck over 10 s', ((q.eggLocal().x - x0) * 1000).toFixed(1), 'mm');
}
