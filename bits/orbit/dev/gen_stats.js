// Generation report: acceptance, timing and the solver's measurements.
const C = require('./load_core.js')();
const preset = process.argv[2] || 'standard', N = +(process.argv[3] || 30);
const agg = { attempts: [], ms: [], par: [], route: [], s1: [], s2: [], s3: [], types: {} };
const reasons = {};
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  const p = C.PuzzleGenerator.generate('stat:' + i, preset);
  agg.ms.push(Date.now() - t0);
  agg.attempts.push(p.attempts); agg.par.push(p.par); agg.route.push(p.route);
  agg.s1.push(p.sizes[0]); agg.s2.push(p.sizes[1]); agg.s3.push(p.sizes[2]);
  p.conds.forEach(c => { agg.types[c.type] = (agg.types[c.type] || 0) + 1; });
  Object.entries(p.reasons || {}).forEach(([k, v]) => { reasons[k] = (reasons[k] || 0) + v; });
  if (p.fallback) console.log('FALLBACK', i);
}
const st = a => { const s = a.slice().sort((x, y) => x - y); return 'min ' + s[0] + ' med ' + s[s.length >> 1] + ' max ' + s[s.length - 1]; };
Object.keys(agg).forEach(k => { if (k !== 'types') console.log(k.padEnd(9), st(agg[k])); });
console.log('types', JSON.stringify(agg.types));
console.log('rejections', JSON.stringify(reasons));
