const { pl, createSim } = require('./simload');
const H = 1 / 120;
const hold = (s, th) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * 600 - s.platform.getAngularVelocity() * 60; };
for (const dir of [1, -1]) {
  const s = createSim(pl, { surface: 'wood', eggA: 0.31, eggB: 0.31, eggK: 0 }); s.dragging = true;
  for (let i = 0; i < 240; i++) { hold(s, 0); s.step(H); }
  const out = [];
  for (let t = 0; t < 12; t += H) { hold(s, dir * 0.5 * Math.PI / 180 * t); s.step(H); if (Math.round(t * 120) % 120 === 0) out.push(`${(s.angle() * 57.3).toFixed(1)}:x${s.eggLocal().x.toFixed(3)} rt${s.rollTorque.toFixed(3)} N${s.lastNormal.toFixed(1)} jw${(s.egg.getAngularVelocity()-s.platform.getAngularVelocity()).toFixed(3)}`); }
  console.log(dir, out.join(' | '));
}
