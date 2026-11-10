// Screenshot the harness: node dev/shot.js <out.png> [query] [w] [h] [waitMs]
const { chromium } = require('playwright');
(async () => {
  const [out, query = '', w = '402', h = '874', wait = '1500'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto('http://localhost:8777/dev/index.html' + (query ? '?' + query : ''));
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  const st = await page.evaluate(() => ({ ready: window.__ready, init: window.__initError || null, log: window.__log.map(x => x[0]).join(',') }));
  console.log(JSON.stringify(st), errors.length ? '\nERRORS:\n' + errors.join('\n') : '');
  await browser.close();
})();
