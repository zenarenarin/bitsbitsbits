const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
  page.on('console', m => console.log(m.type() + ': ' + m.text().slice(0, 600)));
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForTimeout(8000);
  console.log(await page.evaluate(() => JSON.stringify({ ready: window.__ready, err: window.__initError, perr: window.__platformError })));
  await browser.close();
})();
