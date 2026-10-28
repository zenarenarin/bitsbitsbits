// Screenshot the opening of every encounter and collect console errors.
// usage: node dev/allshots.js <outdir> [from] [to] [dpr]
const { chromium } = require('playwright');
const out = process.argv[2], from = +(process.argv[3] || 0), to = +(process.argv[4] || 19), dpr = +(process.argv[5] || 1);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  for (let i = from; i <= to; i++) {
    await page.evaluate(i => { window.__ttwb.load(i); }, i);
    await page.evaluate(() => { window.__ttwb.input.keys.KeyW = true; });
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__ttwb.input.keys.KeyW = false; });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/enc_${String(i + 1).padStart(2, '0')}.png` });
  }
  console.log(errs.slice(0, 30).join('\n') || 'no errors');
  await browser.close();
})();
