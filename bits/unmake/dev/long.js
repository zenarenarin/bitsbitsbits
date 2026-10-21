// Long autoplay: leak check across segment streaming and restarts; sanctuary flow.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message + '\n' + e.stack));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const mem = () => page.evaluate(() => { const R = window.__unmake.R; let n = 0; R.scene.traverse(() => n++); const r = window.__unmake.run; return { nodes: n, geos: R.renderer.info.memory.geometries, tex: R.renderer.info.memory.textures, objs: r ? r.world.objs.length : 0, views: r ? r.views.size : 0, s: r ? Math.floor(r.world.trav.s) : 0, mode: window.__unmake.mode }; });
  for (let runIdx = 0; runIdx < 3; runIdx++) {
    await page.evaluate(() => window.__unmake.begin());
    for (let i = 0; i < 60; i++) {
      const m = await page.evaluate(() => { const u = window.__unmake; u.autoplay(2, seg => seg.idx % 2 ? 99 : 0); return u.mode; });
      if (m !== 'play') break;
      if (i % 15 === 0) console.log('run', runIdx, JSON.stringify(await mem()));
    }
    console.log('end run', runIdx, JSON.stringify(await mem()), await page.evaluate(() => JSON.stringify(window.__unmake.save())));
  }
  await page.screenshot({ path: out + '/over.png' });
  // sanctuary: grant salvage, restore through every milestone
  await page.evaluate(() => { const s = window.__unmake.save(); s.bank += 2000; window.__unmake.showSanct(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out + '/sanct0.png' });
  for (let i = 0; i < 6; i++) {
    const b = page.locator('[data-restore]').first();
    await b.click();
    await page.waitForTimeout(100);
    if (i === 2) await page.screenshot({ path: out + '/sanct3.png' });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/sanct6.png' });
  await page.locator('.u-btn', { hasText: 'BACK' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/title_restored.png' });
  console.log(await page.evaluate(() => JSON.stringify(window.__unmake.save())));
  await browser.close();
})();
