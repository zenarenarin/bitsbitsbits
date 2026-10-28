// Draw calls, triangles and per-frame CPU cost (sim + view update) per encounter.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(async i => {
      const T = window.__ttwb; window.__hold = true; T.load(i);
      const V = T.view(), W = T.G.W;
      V.update(W, 0.016); V.render();
      const info = V.renderer.info;
      const calls = info.render.calls, tris = info.render.triangles;
      // CPU: 120 steps of sim + view update without GPU wait
      let t0 = performance.now();
      for (let k = 0; k < 120; k++) { W.input.mz = -0.5; stepWorld_dev(W); }
      const sim = (performance.now() - t0) / 120;
      t0 = performance.now();
      for (let k = 0; k < 60; k++) V.update(W, 0.016);
      const upd = (performance.now() - t0) / 60;
      window.__hold = false;
      return { i: i + 1, calls, tris, geoms: info.memory.geometries, sim: sim.toFixed(3), view: upd.toFixed(3) };
    }, i);
    console.log(JSON.stringify(r));
  }
  await browser.close();
})();
