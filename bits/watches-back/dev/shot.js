// Screenshot driver. usage: node dev/shot.js <outdir> <enc index> [script]
const { chromium } = require('playwright');
const out = process.argv[2] || '.', enc = +(process.argv[3] || 0), script = process.argv[4] || 'basic';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 90000 });
  const err = await page.evaluate(() => window.__initError);
  if (err) console.log('INIT ERROR', err);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/title.png' });
  await page.evaluate(i => window.__ttwb.load(i), enc);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + `/e${enc}_a.png` });
  if (script === 'basic') {
    await page.evaluate(() => { window.__ttwb.input.keys.KeyW = true; });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: out + `/e${enc}_b.png` });
    await page.evaluate(() => { window.__ttwb.input.keys.KeyW = false; const W = window.__ttwb.G.W; window.__ttwb.setGaze(W.eyes[0].id); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out + `/e${enc}_c.png` });
  }
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
