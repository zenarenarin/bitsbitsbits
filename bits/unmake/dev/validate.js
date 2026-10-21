const L = require('./load')('Phys, FAMILIES, validateSegment, buildSegment');
const only = process.argv[2], N = +(process.argv[3] || 8);
for (const name of Object.keys(L.FAMILIES)) {
  if (only && only !== name) continue;
  let fails = 0; const st = {};
  for (let i = 0; i < N; i++) {
    const d = (i % 4) / 3, seed = 100 + i * 7919;
    const v = L.validateSegment(name, seed, d);
    if (!v.ok) fails++;
    for (const r of v.results) { st[r.name] = st[r.name] || { ok: 0, n: 0, relic: 0, why: {} }; st[r.name].n++; if (r.ok) st[r.name].ok++; if (r.relic) st[r.name].relic++; if (!r.ok && r.why) st[r.name].why[r.why] = 1; }
  }
  console.log(name.padEnd(13), 'segment-fail', fails + '/' + N, Object.entries(st).map(([k, v]) => `${k}: ${v.ok}/${v.n} relic ${v.relic}${Object.keys(v.why).length ? ' ' + Object.keys(v.why) : ''}`).join(' | '));
}
