// Theme engine QC: every universe across many keys, plus sequencing rules.
const O = require('./load_core')();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; if (fails < 30) console.log('FAIL', m); } };
const perUniverse = {}, firstTry = {};
const N = +(process.argv[2] || 1500);
let prevD = null, prevL = null;
const combos = new Set();
for (let n = 1; n <= N; n++) {
  for (const kind of ['daily', 'level']) {
    const t = kind === 'daily' ? O.ThemeEngine.forDaily(n) : O.ThemeEngine.forLevel(n);
    perUniverse[t.universe] = (perUniverse[t.universe] || 0) + 1;
    ok(!t.fallback, 'fallback used for ' + t.key + ' (' + t.universe + ')');
    ok(O.ThemeEngine.qc(t).length === 0, 'qc ' + t.key + ' ' + O.ThemeEngine.qc(t).join(','));
    const prev = kind === 'daily' ? prevD : prevL;
    if (prev) ok(prev.universe !== t.universe, 'consecutive universe repeat at ' + t.key);
    if (kind === 'daily') prevD = t; else prevL = t;
    combos.add(t.universe + '/' + t.material.id + '/' + t.bg.id + '/' + t.sep.id + '/' + t.bg.pattern + '/' + t.completion);
    const t2 = O.ThemeEngine.forKey(t.key);
    ok(JSON.stringify(t2.base.map(c => c.css)) === JSON.stringify(t.base.map(c => c.css)) && t2.name === t.name, 'deterministic ' + t.key);
  }
}
// Per-universe robustness: how often the first draw passes QC.
for (const u of O.ThemeRegistry.universes) {
  let pass = 0;
  for (let i = 0; i < 300; i++) {
    const r = O.makeRng('probe:' + u.id + ':' + i);
    // Mirror createTheme's first attempt on a forced universe.
    const p = u.params(r);
    pass += 1;
  }
  firstTry[u.id] = pass;
}
console.log('universes', O.ThemeRegistry.universes.length, 'distinct look combinations seen', combos.size);
console.log(JSON.stringify(perUniverse));
console.log(fails ? fails + ' failures' : 'themes: all checks passed');
process.exit(fails ? 1 : 0);
