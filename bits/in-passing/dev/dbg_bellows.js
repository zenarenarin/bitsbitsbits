const S = require('./simload');
const rng = S.makeRng(1000);
const A = S.sysPier(-6, 0, 6, 'stone');
const mod = S.GENS.bellows(rng, { x: 0, y: 0 }, 0);
const W = S.makeWorld([A, ...mod.systems]);
const sA = A.surfaces[0];
console.log('bellows', JSON.stringify(mod.systems[0].params), 'B', JSON.stringify(mod.pierB.params));
// direct jump check
const W2 = S.makeWorld([A, mod.pierB]);
const r2 = S.botExpand(W2, sA, 5.7, 0, { waitMax: 0.2 });
console.log('direct', r2.map(r => r.to && r.to.sys.kind));
const res = S.botExpand(W, sA, 5.7, 0, {});
const bel = mod.systems[0].surfaces[0];
console.log('from A ->', [...new Set(res.map(r => r.to && r.to.sys.kind))]);
const res2 = S.botExpand(W, bel, 1.9, 0, { trace: true });
const kinds = {};
for (const r of res2) { const k = r.to ? r.to.sys.kind : 'fall'; kinds[k] = (kinds[k] || 0) + 1; }
console.log('from bellows', kinds);
let maxY = -9; for (const r of res2) if (r.trace) for (let i = 1; i < r.trace.length; i += 2) maxY = Math.max(maxY, r.trace[i]);
console.log('max apex from bellows', maxY.toFixed(2));
// standing sim: watch launches
const p = S.makePlayer(bel, 1.9, 0); let t = 0;
for (let i = 0; i < 120 * 6; i++) { t += 1/120; S.playerStep(p, W, t, 1/120, false, false); if (p.ev.length) { console.log(t.toFixed(2), p.ev.map(e => e.type + (e.speed ? e.speed.toFixed(1) : '')).join(','), p.mode, p.y.toFixed(2)); p.ev.length = 0; } }
