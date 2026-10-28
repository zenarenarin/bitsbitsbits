const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, name] of [[360, 640, 'small'], [430, 932, 'large'], [1280, 720, 'landscape']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto('http://localhost:8765/dev/index.html');
    await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/lay_${name}_title.png` });
    await page.evaluate(() => { window.__ttwb.load(2); });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/lay_${name}_play.png` });
    await page.close();
  }
  await browser.close();
})();
