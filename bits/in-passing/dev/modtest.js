// Success rate and cost of each module generator at several difficulties.
const S = require('./simload');
const kinds = process.argv[2] ? process.argv[2].split(',') : Object.keys(S.GENS);
const ds = process.argv[3] ? process.argv[3].split(',').map(Number) : [0, 0.5, 1];
const letters = process.argv[4] === 'letters';
for (const kind of kinds) for (const d of ds) {
  let ok = 0, n = 10, ms = 0, lt = 0;
  for (let i = 0; i < n; i++) {
    const rng = S.makeRng(1000 + i * 17);
    const start = S.sysPier(-6, 0, 6, 'stone');
    const t0 = Date.now();
    const mod = S.GENS[kind](rng, { x: 0, y: 0 }, d);
    const v = S.validateModule(start, mod, { minWindow: 0.32 - 0.14 * d, letters });
    ms += Date.now() - t0;
    if (v) { ok++; if (v.letters && v.letters.length) lt++; }
  }
  console.log(kind.padEnd(10), 'd', d, 'ok', ok + '/' + n, 'letters', lt, 'avg', (ms / n).toFixed(0) + 'ms');
}
