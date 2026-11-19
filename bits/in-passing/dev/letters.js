const S = require('./simload');
for (const ri of [0, 1, 2]) {
  const W = S.buildRoute(S.ROUTES[ri]);
  console.log('route', ri + 1, W.modules.map(m => m.kind + (m.letter ? '(' + m.letter.score.toFixed(1) + ')' : '')).join(' '));
}
