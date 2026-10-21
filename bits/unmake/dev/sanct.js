const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/title.png' });
  for (const n of [0, 2, 6]) {
    await page.evaluate(n => { const s = window.__unmake.save(); s.restored = n; s.bank = 120; window.__unmake.showSanct(); }, n);
    await page.waitForTimeout(400);
    await page.screenshot({ path: out + `/sanct_${n}.png` });
  }
  await browser.close();
})();
