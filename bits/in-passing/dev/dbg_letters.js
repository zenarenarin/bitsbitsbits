const S = require('./simload');
const kind = process.argv[2] || 'bellows';
const A = S.sysPier(-6, 0, 6, 'stone');
const mod = S.GENS[kind](S.makeRng(1000), { x: 0, y: 0 }, 0.2);
const W = S.makeWorld([A, ...mod.systems]);
const collect = [];
const sol = S.botSolve(W, A.surfaces[0], 5.7, 0, sf => sf === mod.pierB.surfaces[0], { minWindow: 0.2, trace: true, collect });
console.log('solved', sol.ok, 'groups', collect.length);
for (const g of collect) {
  const ok = g.res.filter(r => r.to && r.to.len != null && r.trace && r.trace.length > 6);
  const ap = ok.map(r => { let m = -1e9; for (let i = 1; i < r.trace.length; i += 2) m = Math.max(m, r.trace[i]); return m; }).sort((a, b) => a - b);
  console.log(g.from.sys ? g.from.sys.kind : 'ring', 'res', g.res.length, 'ok', ok.length, 'apex min/med/max', ap[0] && ap[0].toFixed(2), ap[ap.length >> 1] && ap[ap.length >> 1].toFixed(2), ap.length && ap[ap.length - 1].toFixed(2));
}
