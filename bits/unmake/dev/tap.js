// Real pointer test: project the arch wall to screen, click it, verify erase & charge use.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  // press BEGIN with a real tap
  const box = await page.locator('.u-btn', { hasText: 'BEGIN' }).boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  console.log('mode after BEGIN tap:', await page.evaluate(() => window.__unmake.mode));
  // walk to the arch
  for (let i = 0; i < 40; i++) {
    const near = await page.evaluate(() => { const u = window.__unmake; u.advance(0.25); const r = u.run; const seg = r.segs.find(s => s.name === 'arch'); return r.world.trav.s > seg.s0 + 2; });
    if (near) break;
  }
  // tap empty sky first: must not consume a charge
  await page.touchscreen.tap(40, 200);
  await page.waitForTimeout(50);
  console.log('charges after empty tap:', await page.evaluate(() => window.__unmake.run.charges));
  const pt = await page.evaluate(() => {
    const u = window.__unmake, r = u.run, seg = r.segs.find(s => s.name === 'arch'); const o = seg.meta.keys.wall;
    const v = r.views.get(o.id); const p = v.userData.proxy; const THREEv = p.position.clone(); p.getWorldPosition(THREEv); THREEv.project(u.R.camera);
    return { x: (THREEv.x * 0.5 + 0.5) * 390, y: (-THREEv.y * 0.5 + 0.5) * 844, gone: o.gone };
  });
  console.log('wall screen pos', JSON.stringify(pt));
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(50);
  console.log(await page.evaluate(() => { const r = window.__unmake.run; const seg = r.segs.find(s => s.name === 'arch'); return JSON.stringify({ wallGone: seg.meta.keys.wall.gone, charges: r.charges, used: seg.used }); }));
  // tap again quickly on the same spot: nothing erasable there now → no charge
  await page.touchscreen.tap(pt.x, pt.y);
  console.log('charges after 2nd tap:', await page.evaluate(() => window.__unmake.run.charges));
  // mouse click path (desktop)
  await page.evaluate(() => window.__unmake.advance(0.5));
  await page.screenshot({ path: process.argv[2] + '/tap_after.png' });
  await browser.close();
})();
