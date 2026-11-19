const S = require('./simload');
const kind = process.argv[2], d = +(process.argv[3] || 0), seed = +(process.argv[4] || 1000);
const rng = S.makeRng(seed);
const A = S.sysPier(-6, 0, 6, 'stone');
const mod = S.GENS[kind](rng, { x: 0, y: 0 }, d);
for (const s of mod.systems) console.log(s.kind, JSON.stringify(s.params, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
const W = S.makeWorld([A, ...mod.systems]);
const surfs = [A.surfaces[0], ...mod.systems.flatMap(s => s.surfaces)];
for (const sf of surfs) {
  if (sf === mod.pierB.surfaces[0]) continue;
  const res = S.expandSurface(W, sf, sf.isStatic ? sf.len - 0.3 : sf.len / 2, 0, {});
  const k = {}; for (const r of res) { const n = r.to ? r.to.sys.kind + '#' + r.to.id : 'x'; k[n] = (k[n] || 0) + 1; }
  console.log('from', sf.sys.kind + '#' + sf.id, k);
}
console.log('valid:', !!S.validateModule(A, mod, { minWindow: 0.3, letters: false }));
