// Record a 2x-speed gameplay clip: title demo, a full bot-played round, result screen.
// Usage: node dev/record.js <framesDir>   (serve this folder on :8766 first), then encode with ffmpeg at 30 fps.
const { chromium } = require('playwright');
const out = process.argv[2];
const FPS = 30, SPEED = 2, STEP = SPEED / FPS;           // sim seconds per video frame
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready);
  await page.waitForTimeout(600);
  let n = 0;
  const shoot = async () => page.screenshot({ path: `${out}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  const run = async (sec, bot) => { for (let t = 0; t < sec - 1e-6; t += STEP) { await page.evaluate(([s, b]) => window.__cte.advance(s, { bot: b, hold: true }), [STEP, bot]); await shoot(); } };
  await run(2.6, false);                                  // title with the jar demonstrating catches
  const box = await page.locator('.cte-play').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await run(31.8, true);                                  // the whole 30 s round plus the closing beat
  await run(5.2, false);                                  // result count-up, new best, leaderboard
  console.log('frames', n, 'state', JSON.stringify(await page.evaluate(() => ({ mode: window.__cte.G.mode, score: window.__cte.G.score, caught: window.__cte.G.caught, stats: window.__cte.G.stats }))));
  await browser.close();
})();
