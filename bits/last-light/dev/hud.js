// HUD check: the same states on several screens, with the reserved zones optionally overlaid.
// usage: node dev/hud.js outdir
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
const SCREENS = [['iphone', 402, 874, ''], ['android', 412, 915, 'android'], ['frame', 390, 844, 'frame'], ['small', 360, 740, '']];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [name, w, h, q] of SCREENS) {
    for (const show of [false, true]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const query = [q, show ? 'show' : ''].filter(Boolean).join('&');
      await page.goto('http://localhost:8766/dev/index.html' + (query ? '?' + query : ''));
      await page.waitForFunction(() => window.__ready);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const tag = name + (show ? '_zones' : '');
      await page.screenshot({ path: `${out}/${tag}_0title.png` });
      await page.evaluate(() => { window.__paused = true; const L = window.__ll; L.beginRun(); L.player.reset(46.6, 0, 1); L.R.follow(L.player, 1, true); for (let i = 0; i < 120; i++) L.step(1 / 120); L.frame(1 / 60); });
      await page.screenshot({ path: `${out}/${tag}_1dark.png` });
      await page.evaluate(() => { const L = window.__ll; L.player.reset(14.5, 11.6, 1); L.R.follow(L.player, 1, true); for (let i = 0; i < 300; i++) { L.step(1 / 120); } L.watcher.reset(); L.frame(1 / 60); });
      await page.screenshot({ path: `${out}/${tag}_2bright.png` });
      await page.evaluate(() => { const L = window.__ll; L.player.reset(56.1, 0, 1); L.R.follow(L.player, 1, true); for (let i = 0; i < 30; i++) L.step(1 / 120); L.touch.stick = { id: 9, ox: 70, oy: L.btn.jump.y - 10, x: 96, y: L.btn.jump.y - 14 }; L.touch.jump = 8; for (let i = 0; i < 12; i++) L.frame(1 / 60); });
      await page.screenshot({ path: `${out}/${tag}_3pull.png` });
      await page.close();
    }
  }
  await browser.close();
})();
