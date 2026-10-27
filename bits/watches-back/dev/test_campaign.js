// Every encounter: each intended plan reaches the centre; the naive player (walk to the
// nearest opening, never look, never turn) does not. usage: node dev/test_campaign.js [id] [-v]
const L = require('./load')('createSim, ENCOUNTERS, buildEncounter');
const { runPlan, NAIVE } = require('./policy');
const PLANS = require('./plans');
const only = +process.argv[2] || 0, verbose = process.argv.includes('-v');
let pass = 0, total = 0;
const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const recordings = [];
const variants = E => E.id === 10 ? [{ habit: { dir: 1 } }, { habit: { dir: -1 } }] : [{ recordings }];
for (const E of L.ENCOUNTERS) for (const ctx of variants(E)) {
  if (only && E.id !== only) continue;
  const tag = ctx.habit ? ` (habit ${ctx.habit.dir > 0 ? 'ccw' : 'cw'})` : E.id === 20 ? ` (echoing ${recordings.length} recordings)` : '';
  const mk = () => L.createSim(L.buildEncounter(E, ctx), {});
  for (const [name, plan] of Object.entries((ctx.habit && ctx.habit.dir < 0 && PLANS[E.id + 'cw']) || PLANS[E.id] || {})) {
    const sim = mk();
    const r = runPlan(sim, plan, { verbose });
    if (r.ok && E.id < 20) recordings.push(sim.rec);
    check(`E${E.id} ${E.name}${tag}: plan "${name}" reaches the centre`, r.ok, { t: r.t, over: r.over, ring: r.ring, step: r.step, chains: r.stats.chains });
    if (verbose || !r.ok) console.log('   ' + r.log.join('\n   '));
    // a plan that only works frame-perfectly proves little: start it 0 to 57 steps late
    const late = [];
    for (let pre = 3; pre < 60; pre += 3) { const S = mk(); for (let i = 0; i < pre; i++) S.step({ move: [0, 0] }); if (!runPlan(S, plan).ok) late.push(pre); }
    check(`E${E.id}${tag}: plan "${name}" still works started up to 1 s late`, !late.length, late.length ? { failsAtSteps: late } : undefined);
  }
  if (!PLANS[E.id]) check(`E${E.id} has a plan`, false);
  if (PLANS['familiar' + E.id]) { const f = runPlan(mk(), PLANS['familiar' + E.id], { max: 60 }); check(`E${E.id} ${E.name}: the familiar strategy from earlier fails here`, !f.ok, { t: f.t, over: f.over && f.over.type }); }
  const n = runPlan(mk(), NAIVE, { max: 90 });
  check(`E${E.id} ${E.name}: naive play fails`, !n.ok, { t: n.t, over: n.over && n.over.type });
}
console.log(pass + '/' + total + ' campaign checks');
process.exit(pass === total ? 0 : 1);
