const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text()); });
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await page.evaluate(() => window.__unmake.begin());
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1000);
    console.log(await page.evaluate(() => { const r = window.__unmake.run; const t = r.world.trav; return JSON.stringify({ mode: window.__unmake.mode, t: r.t.toFixed(2), s: t.s.toFixed(2), y: t.y.toFixed(2), st: t.state, why: t.waitReason, front: r.front.toFixed(2), segs: r.segs.map(s => s.name).join(',') }); }));
  }
  await browser.close();
})();
