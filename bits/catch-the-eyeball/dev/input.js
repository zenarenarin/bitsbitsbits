// Real-loop input test: PLAY button, mouse follow, touch drag, keyboard, frame rate.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, dpr, touch] of [[1280, 800, 1, false], [390, 844, 3, true]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.goto('http://localhost:8766/dev/index.html');
    await page.waitForFunction(() => window.__ready);
    await page.waitForTimeout(500);
    const box = await page.locator('.cte-play').boundingBox();
    if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.click('.cte-play');
    await page.waitForTimeout(300);
    const jx = () => page.evaluate(() => Math.round(window.__cte.jar.x));
    console.log(w + 'x' + h, 'mode', await page.evaluate(() => window.__cte.G.mode));
    if (!touch) {
      await page.mouse.move(w * 0.15, h * 0.5); await page.waitForTimeout(400); console.log(' mouse left ->', await jx());
      await page.mouse.move(w * 0.9, h * 0.3); await page.waitForTimeout(400); console.log(' mouse right ->', await jx());
      await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft'); console.log(' key left ->', await jx());
    } else {
      const cdp = await page.context().newCDPSession(page);
      const t = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: h * 0.8 }] });
      await t('touchStart', w * 0.5);
      for (let i = 0; i <= 10; i++) { await t('touchMove', w * 0.5 - i * 15); await page.waitForTimeout(30); }
      await page.waitForTimeout(300); console.log(' drag left ->', await jx(), 'limit', await page.evaluate(() => window.__cte.world.PW - 23.5));
      for (let i = 0; i <= 10; i++) { await t('touchMove', w * 0.35 + i * 60); await page.waitForTimeout(30); }
      await page.waitForTimeout(300); await t('touchEnd'); console.log(' drag far right (clamped) ->', await jx());
    }
    const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
    console.log(' fps (swiftshader)', fps, 'eyes', await page.evaluate(() => window.__cte.eyes.count()));
    await page.close();
  }
  await browser.close();
})();
