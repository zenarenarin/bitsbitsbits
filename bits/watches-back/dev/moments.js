// Screenshots of moments: a capture and its card, a descent, the ending's beats.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  // capture: stand still in encounter 2
  await page.evaluate(() => { const w = window.__wtb; w.begin('campaign', 2); for (let i = 0; i < 200 && w.mode !== 'play'; i++) w.frame(1 / 30); for (let i = 0; i < 1200 && w.mode === 'play'; i++) w.stepGame({ move: [0, 0] }); w.frame(1 / 60); });
  await page.evaluate(() => { for (let i = 0; i < 18; i++) window.__wtb.frame(1 / 30); }); await page.screenshot({ path: out + '/m1_captured.png' });
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__wtb.frame(1 / 30); }); await page.screenshot({ path: out + '/m2_card.png' });
  // the ending
  await page.evaluate(() => { const w = window.__wtb; w.goto(20); w.S.reached = true; w.stepGame({}); });
  for (const [i, t] of [[3, 2], [4, 6], [5, 10], [6, 16]]) { await page.evaluate(t => { const w = window.__wtb; while (w.mode === 'ending' && w.__t === undefined ? true : false) break; for (let k = 0; k < t * 30; k++) w.frame(1 / 30); }, i === 3 ? 2 : 4); await page.screenshot({ path: `${out}/m${i}_ending.png` }); }
  console.log(errs.join('\n') || 'ok', await page.evaluate(() => window.__wtb.mode));
  await b.close();
})();
