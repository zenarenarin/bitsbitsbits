const { pl, createSim, GEOM } = require('./simload');
const H = 1/120;
const servo = (s, th) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * 600 - s.platform.getAngularVelocity() * 60; };
function breakaway(surface, A, B, K) {
  const s = createSim(pl, { surface, eggA: A, eggB: B, eggK: K }); s.dragging = true;
  for (let i = 0; i < 1200; i++) { const t = i * H; servo(s, -0.3 * Math.min(1, t / 10)); s.step(H); if (s.eggLocal().x > 0.08) return (s.angle() * -180 / Math.PI).toFixed(1); }
  return '>17';
}
for (const [A, B, K] of [[0.31, 0.31, 0], [0.33, 0.305, 0], [0.33, 0.305, 0.06], [0.34, 0.3, 0.04]]) {
  console.log(A, B, K, ['rubber','wood','ceramic','metal'].map(su => su + ' ' + breakaway(su, A, B, K)).join('  '));
}
