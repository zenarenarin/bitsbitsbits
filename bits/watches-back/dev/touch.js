// Real touch events (CDP) on an emulated phone: stick, eye tap, look-away, pause.
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/dev/index.html?q=0');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] || i + 1 })) });
  const check = (name, ok, extra) => console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
  // the title button is a real DOM button
  const b = await page.$('.tw-b'); const bb = await b.boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(400);
  check('title -> play', (await page.evaluate(() => window.__ttwb.mode)) === 'play');
  const p0 = await page.evaluate(() => window.__ttwb.G.W.player.pos.slice());
  // stick: press lower-left, drag up, hold
  await touch('touchStart', [[100, 700]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[100, 700 - k * 6]]); await page.waitForTimeout(30); }
  await page.waitForTimeout(1500);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const p1 = await page.evaluate(() => window.__ttwb.G.W.player.pos.slice());
  check('stick moves the traveller up the screen', p1[2] < p0[2] - 2, `dz=${(p1[2] - p0[2]).toFixed(2)}`);
  await page.waitForTimeout(500);
  const p2 = await page.evaluate(() => window.__ttwb.G.W.player.pos.slice());
  check('release stops quickly', Math.abs(p2[2] - p1[2]) < 1.2, `drift=${(p2[2] - p1[2]).toFixed(2)}`);
  // stick and gaze at once: hold the stick, tap the eye with a second finger
  const s = await page.evaluate(() => { const T = window.__ttwb, e = T.G.W.eyes[0]; return T.view().toScreen(e.pos); });
  await touch('touchStart', [[100, 700, 1]]);
  await touch('touchMove', [[100, 650, 1]]);
  await touch('touchStart', [[100, 650, 1], [s.x, s.y, 2]]);
  await touch('touchEnd', [[100, 650, 1]]);
  await page.waitForTimeout(600);
  const g = await page.evaluate(() => ({ t: window.__ttwb.G.W.gaze.target, st: window.__ttwb.G.W.eyes[0].state }));
  await touch('touchEnd', []);
  check('second finger taps an eye while moving', g.t === 'W', JSON.stringify(g));
  await page.screenshot({ path: out + '/touch_gaze.png' });
  // tap on empty sky: look away
  const emptyPt = await page.evaluate(() => { const T = window.__ttwb; for (let y = 560; y > 200; y -= 20) for (let x = 360; x > 230; x -= 20) if (!T.view().pickEye(x, y, 48)) return [x, y]; return [330, 600]; });
  await touch('touchStart', [emptyPt]); await touch('touchEnd', []);
  await page.waitForTimeout(300);
  check('tap on nothing looks away', (await page.evaluate(() => window.__ttwb.G.W.gaze.target)) === null);
  // pause button
  const pb = await page.$('.tw-btn'); const pbb = await pb.boundingBox();
  await page.touchscreen.tap(pbb.x + 22, pbb.y + 22); await page.waitForTimeout(500);
  check('pause', (await page.evaluate(() => window.__ttwb.mode)) === 'pause');
  await page.screenshot({ path: out + '/touch_pause.png' });
  const t0 = await page.evaluate(() => window.__ttwb.G.W.t); await page.waitForTimeout(800);
  check('pause freezes the simulation', (await page.evaluate(() => window.__ttwb.G.W.t)) === t0);
  const rb = (await page.$$('.tw-panel.on .tw-b'))[0]; const rbb = await rb.boundingBox();
  await page.touchscreen.tap(rbb.x + 30, rbb.y + 20); await page.waitForTimeout(400);
  check('resume', (await page.evaluate(() => window.__ttwb.mode)) === 'play');
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await browser.close();
})();
