// Endless in the browser: start it, let the bot play several spirals through the real game,
// get caught once, and check the run ends on the results screen with an endless score.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  let pass = 0, total = 0; const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
  const locked = await page.evaluate(() => window.__wtb.H.endless.disabled);
  check('endless is locked until the campaign is complete', locked === true);
  await page.evaluate(() => { const w = window.__wtb; w.save().completed = true; w.showTitle(); });
  const r = await page.evaluate(() => {
    const w = window.__wtb; w.H.endless.click();
    const depths = [];
    for (let spiral = 0; spiral < 4; spiral++) {
      for (let i = 0; i < 300 && w.mode !== 'play'; i++) w.frame(1 / 30);
      if (w.mode !== 'play') break;
      depths.push({ depth: w.run.depth || 1, name: w.run.E.name, validated: w.run.E.validated, eyes: w.S.eyes.length });
      for (let i = 0; i < 6000 && w.mode === 'play'; i++) w.stepGame(botPolicy(w.S));
    }
    return { depths, mode: w.mode, score: Math.floor(w.run.score) };
  });
  check('endless: the bot descends through several validated spirals in the real game', r.depths.length >= 3 && r.depths.every(d => d.validated), r);
  await page.screenshot({ path: out + '/en1.png' });
  const end = await page.evaluate(() => { const w = window.__wtb; for (let i = 0; i < 300 && w.mode !== 'play'; i++) w.frame(1 / 30); for (let i = 0; i < 4000 && w.mode === 'play'; i++) w.stepGame({ move: [0, 0] }); for (let i = 0; i < 200 && w.mode !== 'results'; i++) w.frame(1 / 30); return { mode: w.mode, best: w.save().bestEndless, h: w.H.resH.textContent }; });
  check('endless: a capture ends the run at the results', end.mode === 'results' && end.best > 0, end);
  await page.screenshot({ path: out + '/en2.png' });
  console.log(pass + '/' + total + ' endless browser checks'); if (errs.length) console.log(errs.join('\n'));
  await b.close(); process.exit(pass === total ? 0 : 1);
})();
