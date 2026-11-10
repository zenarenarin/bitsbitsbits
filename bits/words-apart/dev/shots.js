// Screenshots of every beat of a run: node dev/shots.js <outdir> [phone|desktop] [win|lose]
const { chromium } = require('playwright');
const out = process.argv[2] || 'dev/out', kind = process.argv[3] || 'phone', end = process.argv[4] || 'win';
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const vp = kind === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await p.goto('http://localhost:8766/dev/index.html');
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${kind}-0-title.png` });
  await p.evaluate(() => { window.__wa.begin('daily'); window.__wa.freeze(true); });
  await p.waitForTimeout(3200);
  await p.keyboard.type(await p.evaluate(() => window.__wa.run.puzzle.answer.slice(1, 3)));
  await p.screenshot({ path: `${out}/${kind}-1-stop.png` });
  for (let i = 0; i < 5; i++) {
    if (end === 'lose' && i === 2) {
      await p.evaluate(() => window.__wa.hint()); await p.waitForTimeout(600);
      await p.keyboard.type('QQQQQQQQ'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
      await p.screenshot({ path: `${out}/${kind}-wrong.png` });
      await p.evaluate(() => { window.__wa.freeze(false); window.__wa.spend(80); }); await p.waitForTimeout(800);
      await p.screenshot({ path: `${out}/${kind}-dark.png` });
      await p.waitForTimeout(2600); await p.screenshot({ path: `${out}/${kind}-fail.png` }); break;
    }
    const ans = await p.evaluate(() => window.__wa.run.puzzle.answer);
    await p.keyboard.type(ans.slice(1, -1));
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${kind}-${i + 1}-lock.png` });
    if (i < 4) { await p.waitForTimeout(1600); await p.screenshot({ path: `${out}/${kind}-${i + 1}-mid.png` }); await p.waitForTimeout(3600); await p.screenshot({ path: `${out}/${kind}-${i + 2}-stop.png` }); }
    else { await p.waitForTimeout(3500); await p.screenshot({ path: `${out}/${kind}-final-mid.png` }); await p.waitForTimeout(5500); await p.screenshot({ path: `${out}/${kind}-final.png` }); }
  }
  const st = await p.evaluate(() => ({ mode: window.__wa.mode, state: window.__wa.run.state, score: window.__wa.run.score, sub: window.__submitted, done: window.__completed, failed: window.__failed }));
  console.log(JSON.stringify(st)); console.log('errors:', errs.slice(0, 10));
  await b.close();
})();
