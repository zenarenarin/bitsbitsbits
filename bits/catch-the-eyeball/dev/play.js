// Headless playthrough: title, a bot-driven 30 s round with screenshots, the result screen.
// Usage: node dev/play.js <outdir> [width height dpr]   (serve this folder on :8766 first)
const { chromium } = require('playwright');
const BOT = process.env.NOBOT ? false : true;
const out = process.argv[2] || '.', W = +(process.argv[3] || 390), H = +(process.argv[4] || 844), DPR = +(process.argv[5] || 3);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('console:', m.text()); } });
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  console.log('init error:', await page.evaluate(() => window.__initError || null));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '/00_title.png' });
  console.log('world', JSON.stringify(await page.evaluate(() => { const w = window.__cte.world; return { W: w.W, H: w.H, PW: w.PW, U: +w.U.toFixed(2), k: w.k }; })));
  await page.evaluate(() => window.__cte.begin());
  const st = () => page.evaluate(() => { const c = window.__cte, G = c.G; return { mode: G.mode, t: +G.t.toFixed(1), score: G.score, caught: G.caught, eyes: c.eyes.count(), kinds: c.eyes.eyes.filter(e => e.on).map(e => e.behaviour[0]).join(''), jar: c.jar.count() }; });
  for (let i = 1; i <= 8; i++) {
    await page.evaluate(b => window.__cte.advance(4, { bot: b }), BOT);
    console.log(JSON.stringify(await st()));
    await page.screenshot({ path: out + `/0${i}_play.png` });
  }
  await page.evaluate(b => window.__cte.advance(1.5, { bot: b }), BOT);
  await page.evaluate(() => { window.__cte.G.manual = false; });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await st()));
  await page.screenshot({ path: out + '/09_result.png' });
  console.log('stats', JSON.stringify(await page.evaluate(() => window.__cte.G.stats)));
  console.log('errors:', errors.length);
  await browser.close();
})();
