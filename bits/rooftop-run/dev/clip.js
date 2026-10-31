// Record a gameplay clip: an autopilot drives the real controller through the
// slice to the relay; the game's clock is frozen and stepped exactly 1/30 s per video frame.
// Usage: (serve on :8765) node dev/clip.js <framesDir> [landscape|portrait]
const { chromium } = require('playwright');
const pilot = require('./pilot.js');
const out = process.argv[2], orient = process.argv[3] || 'landscape';
const vp = orient === 'portrait' ? { width: 450, height: 976 } : { width: 1280, height: 592 };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  // the harness's white logo stand-in is a layout aid, not part of the game
  await page.evaluate(() => { for (const d of document.body.children) if (d.style && d.style.zIndex === '99') d.style.display = 'none'; const r = window.__rr; r.begin(); r.freeze(true); });
  await page.evaluate(pilot);
  await page.evaluate(() => {
    const r = window.__rr, c = r.cat;
    window.__tick = () => { for (let i = 0; i < 2; i++) { r.sim(window.__pilot(c, r.hazards)); r.frame(); } return r.mode === 'result' ? 1 : 0; };
  });
  let n = 0, endT = null;
  for (; n < 30 * 40; n++) {
    const done = await page.evaluate(() => window.__tick());
    await page.screenshot({ path: `${out}/${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
    if (done && endT === null) endT = n;
    if (endT !== null && n - endT > 75) break;     // hold on the result for 2.5 s
    if (n % 60 === 0) console.log('frame', n);
  }
  console.log('frames', n + 1);
  await browser.close();
})();
