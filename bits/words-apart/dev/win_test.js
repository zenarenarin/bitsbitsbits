// Plays all five words (clock frozen for slow software rendering) and captures the finale and results.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8766/dev/index.html');
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.click('.wa-cta'); await p.evaluate(() => window.__wa.freeze(true));
  for (let i = 0; i < 5; i++) {
    await p.waitForFunction(() => window.__wa.mode === 'play' && window.__wa.run.accepting(performance.now()), null, { timeout: 120000 });
    await p.waitForTimeout(500);
    const a = await p.evaluate(() => window.__wa.run.puzzle.answer);
    await p.keyboard.type(a.slice(1, -1));
    await p.waitForFunction(n => window.__wa.run.solved.length === n, i + 1, { timeout: 60000 });
    if (i === 4) { await p.waitForTimeout(300); await p.screenshot({ path: 'dev/out/win-lock.png' }); }
  }
  await p.waitForFunction(() => document.querySelector('.wa-panel:not(.wa-title):not(.wa-board)').classList.contains('on'), null, { timeout: 300000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'dev/out/win-result.png' });
  console.log(JSON.stringify(await p.evaluate(() => ({ state: window.__wa.run.state, score: window.__wa.run.score, sub: window.__submitted, done: window.__completed, words: window.__wa.run.solved.map(e => e.word) }))), errs);
  await b.close();
})();
