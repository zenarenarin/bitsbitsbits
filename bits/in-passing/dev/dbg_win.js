// Print solver edges/windows for a module.
const S = require('./simload');
const kind = process.argv[2], d = +(process.argv[3] || 0), seed = +(process.argv[4] || 1000);
const rng = S.makeRng(seed);
const A = S.sysPier(-6, 0, 6, 'stone');
const mod = S.GENS[kind](rng, { x: 0, y: 0 }, d);
for (const s of mod.systems) console.log(s.kind, JSON.stringify(s.params, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
const W = S.makeWorld([A, ...mod.systems]);
const name = n => n ? (n.len != null ? n.sys.kind + '#' + n.id : 'ring:' + n.sys.kind + '#' + n.id) : 'fall';
const collect = [];
const sol = S.botSolve(W, A.surfaces[0], 5.7, 0, sf => sf === mod.pierB.surfaces[0], { minWindow: 0.01, collect });
for (const g of collect) {
  const by = {};
  for (const r of g.res) { const k = name(r.to); (by[k] = by[k] || new Set()).add(r.snap); }
  const out = Object.entries(by).map(([k, set]) => { const a = [...set].sort((x, y) => x - y); let run = 1, b = 1; for (let i = 1; i < a.length; i++) { run = a[i] === a[i - 1] + 1 ? run + 1 : 1; b = Math.max(b, run); } return k + ' n=' + a.length + ' win=' + (b * 0.05).toFixed(2); });
  console.log('from', name(g.from), '->', out.join(' | '));
}
console.log('solved', sol.ok, sol.ok && sol.t.toFixed(2));
