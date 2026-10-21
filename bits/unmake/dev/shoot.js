// Drive the harness in headless Chromium and capture screenshots.
// usage: node dev/shoot.js <outdir> [scenario]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
const scenario = process.argv[3] || 'basic';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__initError);
  if (err) { console.log('INIT ERROR', err); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/01_title.png' });
  if (scenario === 'basic') {
    await page.evaluate(() => window.__unmake.begin());
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1800);
      await page.screenshot({ path: out + `/p${i}.png` });
    }
  }
  console.log(logs.slice(0, 40).join('\n'));
  await browser.close();
})();
