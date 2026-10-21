// Touch input on an emulated phone (real CDP touch events -> pointer events):
// hold to preview, release to unmake, slide off to cancel, and the steering stick.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctxB.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const cdp = await ctxB.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id || i })) });
  let pass = 0, total = 0; const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info ? ' ' + JSON.stringify(info) : '')); };
  await page.evaluate(() => { const u = window.__unmake; u.save().runs = 0; u.begin(); u.warp('threshold', 1.2); u.advance(0.4, { steer: 0, pace: -1 }); });
  // stick: a finger in the lower left steers
  await touch('touchStart', [{ x: 80, y: 700, id: 1 }]); await touch('touchMove', [{ x: 125, y: 700, id: 1 }]);
  const steer = await page.evaluate(() => { const u = window.__unmake; return u.input.stick ? (u.input.stick.x - u.input.stick.ox) : null; });
  await touch('touchEnd', []);
  check('stick: a lower-left finger becomes the steering stick', steer > 30, { steer });
  // hold on the floor: preview without committing
  await page.evaluate(() => { window.__unmake.input.virtual = { steer: 0, pace: -1 }; window.__unmake.frame(); });
  const fl = await page.evaluate(() => window.__unmake.screenOf('floor', 'threshold'));
  await touch('touchStart', [{ x: fl.x, y: fl.y, id: 2 }]);
  await page.evaluate(() => window.__unmake.frame());
  const pressing = await page.evaluate(() => window.__unmake.press);
  await page.screenshot({ path: out + '/01_hold_floor.png' });
  check('hold: touching the floor previews it and does not unmake it yet', pressing === 'floor' && (await page.evaluate(() => window.__unmake.screenOf('floor', 'threshold'))).alive, { pressing });
  // slide off to cancel
  await touch('touchMove', [{ x: fl.x, y: 120, id: 2 }]); await touch('touchEnd', []);
  await page.evaluate(() => window.__unmake.frame());
  check('slide off: lifting the finger over the sky cancels', (await page.evaluate(() => window.__unmake.screenOf('floor', 'threshold'))).alive && !(await page.evaluate(() => window.__unmake.press)));
  // hold the wall, release: unmade
  const wl = await page.evaluate(() => window.__unmake.screenOf('wall', 'threshold'));
  await touch('touchStart', [{ x: wl.x, y: wl.y, id: 3 }]); await page.evaluate(() => window.__unmake.frame());
  await page.screenshot({ path: out + '/02_hold_wall.png' });
  const pw = await page.evaluate(() => window.__unmake.press);
  await touch('touchEnd', []);
  await page.evaluate(() => { window.__unmake.advance(0.1, { steer: 0, pace: -1 }); });
  await page.screenshot({ path: out + '/03_released.png' });
  check('release: letting go over the wall unmakes it', pw === 'wall' && !(await page.evaluate(() => window.__unmake.screenOf('wall', 'threshold'))).alive, { pw });
  // jump button
  const jb = await page.evaluate(() => { const b = document.querySelector('.um-jump').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await touch('touchStart', [{ x: jb.x, y: jb.y, id: 4 }]);
  const jp = await page.evaluate(() => window.__unmake.input.jumpHeld);
  await touch('touchEnd', []);
  check('jump button: a touch presses jump', jp === true);
  console.log(pass + '/' + total + ' touch checks'); if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
