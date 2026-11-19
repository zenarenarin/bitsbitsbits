// Generate every journey route plus a run of daily errands; report validity and cost.
const S = require('./simload');
const which = process.argv[2];
const specs = which === 'daily' ? Array.from({ length: +(process.argv[3] || 20) }, (_, i) => S.dailyRouteSpec('2026-' + (11 + Math.floor(i / 28)) + '-' + (1 + i % 28)))
  : which != null ? [S.ROUTES[+which]] : S.ROUTES;
for (const spec of specs) {
  const t0 = Date.now();
  const W = S.buildRoute(spec);
  const ms = Date.now() - t0;
  const kinds = W.modules.map(m => m.kind).join(' ');
  console.log(`${spec.daily ? spec.dateKey : 'route ' + (spec.index + 1)}  ${ms}ms  len ${W.finalX.toFixed(0)}m  brisk ${W.brisk}s  letters ${W.letters.length}  stones ${W.modules.filter(m => m.kind === 'stones').length}  | ${kinds}`);
}
