const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => { const u = window.__unmake; u.save().runs = 0; u.save().seenIntro = true; u.begin(); });
  for (let i = 0; i < 6; i++) await page.evaluate(() => window.__unmake.advance(0.5, { steer: 0, pace: -0.4 }));
  await page.screenshot({ path: process.argv[2] + '/land_play.png' });
  await page.evaluate(() => { const u = window.__unmake; u.save().restored = 4; u.save().bank = 300; u.showSanct(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.argv[2] + '/land_sanct.png' });
  await browser.close();
})();
