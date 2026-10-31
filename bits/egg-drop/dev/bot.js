// Headless survival test: a simple controller plays seeded runs.
const { pl, createSim, createDisturbance, GEOM } = require('./simload');
const H = 1/120;
function run(seed, surface, skill, maxT=180, opts={}) {
  const s = createSim(pl, { surface, ...opts });
  const d = createDisturbance(seed, opts.strength);
  let t = 0, lag = [], fellAt = null, maxAbsX = 0;
  const react = skill.react; // seconds of reaction delay
  while (t < maxT) {
    const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
    lag.push({ e, v, a, w });
    const o = lag.length > react / H ? lag.shift() : lag[0];
    const want = Math.max(-0.2, Math.min(0.2, skill.kx * o.e.x + skill.kv * o.v.x));
    let tgt = -(0.5 / 0.95) * o.e.x - skill.ka * (want - o.a) + skill.kw * o.w;
    s.dragging = true; s.target = Math.max(-GEOM.travel, Math.min(GEOM.travel, tgt));
    const side = Math.abs(e.x) > 1.3 ? Math.sign(e.x) : 0;
    s.disturb = d.update(t, H, side);
    s.step(H); t += H;
    maxAbsX = Math.max(maxAbsX, Math.abs(e.x));
    if (s.eggFallen()) { fellAt = t; break; }
  }
  return { fellAt, maxAbsX };
}
const skills = {
  none: { react: 0.2, kx: 0, kv: 0, ka: 0, kw: 0 },
  novice: { react: 0.35, kx: 0.05, kv: 0.05, ka: 1.5, kw: 0.0 },
  good: { react: 0.22, kx: 0.1, kv: 0.12, ka: 3.0, kw: 0.4 },
  expert: { react: 0.15, kx: 0.12, kv: 0.16, ka: 4.0, kw: 0.6 },
};
const which = process.argv[2] ? [process.argv[2]] : Object.keys(skills);
for (const sk of which) for (const surface of ['rubber','wood','ceramic','metal']) {
  const res = [];
  for (let seed = 1; seed <= 8; seed++) {
    if (sk === 'none') { const s = createSim(pl,{surface}); const d = createDisturbance(seed); let t=0; s.dragging=false; while(t<180){ s.disturb=d.update(t,H,0); s.step(H); t+=H; if(s.eggFallen()) break;} res.push(t.toFixed(0)); continue; }
    const r = run(seed, surface, skills[sk]);
    res.push(r.fellAt ? r.fellAt.toFixed(0) : '180+');
  }
  console.log(sk.padEnd(7), surface.padEnd(8), res.join(' '));
}
