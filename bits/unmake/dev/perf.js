const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await page.evaluate(() => window.__unmake.begin());
  await page.waitForTimeout(2000);
  console.log(await page.evaluate(() => {
    const R = window.__unmake.R; const info = R.renderer.info;
    const t0 = performance.now(); for (let i = 0; i < 5; i++) R.render(); const ms = (performance.now() - t0) / 5;
    let meshes = 0; R.scene.traverse(o => { if (o.isMesh) meshes++; });
    return JSON.stringify({ calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, meshes, renderMs: ms.toFixed(1) });
  }));
  await browser.close();
})();
