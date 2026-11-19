// Solve a route module by module and print an input schedule:
// [[pressTime, releaseTime], ...] in route time (run starts at t=0).
const S = require('./simload');
function plan(spec, planData) {
  const W = S.buildRoute(spec, planData ? { plan: planData } : {});
  let sf = W.start, s = W.start.len - 2.2, t = 0;
  const sched = [];
  const goals = W.modules.map(m => m.pierB ? m.pierB.surfaces[0] : W.goal);
  for (const g of goals) {
    const sol = S.botSolve(W, sf, s, t, x => x === g || x.isGoal, { minWindow: 0.15, maxExpand: 60 });
    if (!sol.ok) return { W, sched, fail: 'module to ' + g.id };
    const chain = []; for (let n = sol.node; n.prev; n = n.prev) chain.unshift(n);
    let open = null;
    for (const n of chain) {
      const v = n.via;
      if (v.kind === 'tap') sched.push([v.ts, v.ts + S.BOT.TAP]);
      else if (v.kind === 'grab') open = v.ts;
      else if (v.kind === 'release') { sched.push([open, v.ts]); open = null; }
      else if (v.kind === 'regrab') { sched.push([open, v.ts]); open = v.ts + S.BOT.REHOLD; }
    }
    sf = sol.node.node; s = sol.node.s; t = sol.t;
    if (g.isGoal) break;
  }
  return { W, sched, t };
}
module.exports = plan;
if (require.main === module) {
  const i = +(process.argv[2] || 0);
  const r = plan(S.ROUTES[i], require('./plans_loader')(i));
  console.log(JSON.stringify({ t: r.t, fail: r.fail, sched: r.sched }));
}
