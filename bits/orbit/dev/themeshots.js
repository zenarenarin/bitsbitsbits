// Full-size phone screenshots of chosen daily editions: node dev/themeshots.js outdir n1 n2 ...
const { chromium } = require('playwright');
(async () => {
  const [out, ...ns] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(700);
  for (const n of ns) {
    await page.evaluate(n => window.__orbit.goTo('daily', +n), n);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: out + '/day' + n + '.png' });
  }
  await browser.close();
})();
