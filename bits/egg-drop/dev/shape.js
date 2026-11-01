// True break-away (egg reaches 0.15 m/s) in both directions, per egg profile and surface.
const { pl, createSim } = require('./simload');
const H = 1 / 120;
const hold = (s, th) => { s.disturb = -s.gravityTorque() + (th - s.angle()) * 600 - s.platform.getAngularVelocity() * 60; };
const shapes = [[0.32, 0.305, 0.03]];
for (const [A, B, K] of shapes) {
  const row = [];
  for (const su of ['rubber', 'wood', 'ceramic', 'metal']) {
    const r = [];
    for (const dir of [1, -1]) {
      const s = createSim(pl, { surface: su, eggA: A, eggB: B, eggK: K }); s.dragging = true;
      for (let i = 0; i < 240; i++) { hold(s, 0); s.step(H); }
      let t = 0, br = null;
      while (t < 40 && br === null) { hold(s, dir * (0.5 * Math.PI / 180) * t); s.step(H); t += H; if (Math.abs(s.eggLocalVel().x) > 0.15) br = Math.abs(s.angle()); }
      r.push(br ? (br * 57.3).toFixed(1) : '>20');
    }
    row.push(su + ' ' + r.join('/'));
  }
  console.log(`A ${A} B ${B} K ${K} (aspect ${(A / B).toFixed(3)}): ` + row.join('  '));
}
