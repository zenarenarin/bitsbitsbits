const S = require('./simload');
const rng = S.makeRng(1000);
const A = S.sysPier(-6, 0, 6, 'stone');
const mod = S.GENS.swing2(rng, { x: 0, y: 0 }, 0);
const W = S.makeWorld([A, ...mod.systems]);
const h2 = mod.systems[1].handles[0];
const collect = [];
S.botSolve(W, A.surfaces[0], 5.7, 0, () => false, { minWindow: 0.01, collect, maxExpand: 1 });
const g = collect[0]; const grab = g.res.find(r => r.kind === 'grab');
console.log('grab at', grab.t.toFixed(2), 'player', grab.st.x.toFixed(2), grab.st.y.toFixed(2));
// sweep releases manually
const q = S.cloneP(grab.st); let t = grab.t; const dt = 1/120;
for (let k = 0; k < 90; k++) {
  const r = S.cloneP(q); let tt = t, md = 99, at = null;
  for (let i = 0; i < 300; i++) { tt += dt; S.playerStep(r, W, tt, dt, tt > t + 0.12, false); const o = {}; if (h2.pos(tt, o)) { const d = Math.hypot(o.x - r.x, o.y - r.y - 1); if (d < md) { md = d; at = [r.x.toFixed(1), (r.y+1).toFixed(1), o.x.toFixed(1), o.y.toFixed(1)]; } } if (r.mode !== 'air') break; }
  if (k % 6 === 0) console.log('rel', (k * 0.05).toFixed(2), 'mode', r.mode, 'mind', md.toFixed(2), at && at.join(','), 'qx', q.x.toFixed(1), q.y.toFixed(1));
  for (let i = 0; i < 6; i++) { t += dt; S.playerStep(q, W, t, dt, true, false); }
}
