// Compare camera pitches. usage: node dev/pitch.js <out> <enc> <pitch...>
const { chromium } = require('playwright');
const out = process.argv[2], enc = +process.argv[3], pitches = process.argv.slice(4).map(Number);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(i => { window.__ttwb.load(i); }, enc);
  await page.evaluate(() => { const T = window.__ttwb; T.G.W.player.pos[2] -= 9; });
  for (const p of pitches) {
    await page.evaluate(p => { window.__ttwb.view().pitchOverride = p; window.__ttwb.view().camInit = false; }, p);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/pitch_${enc}_${p}.png` });
  }
  await browser.close();
})();
