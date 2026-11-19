const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  console.log(await page.evaluate(process.argv[2]));
  await browser.close();
})();
