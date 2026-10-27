// CPU cost per frame (simulation steps + view update + draw submission) in the densest spirals,
// and memory after repeated restarts. Headless Chromium renders with SwiftShader (a CPU
// rasteriser), so GPU time here says nothing about phones; only the JS costs are meaningful.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  for (const id of [1, 9, 14, 17, 19]) {
    const r = await page.evaluate(id => {
      const w = window.__wtb; w.goto(id);
      for (let i = 0; i < 60; i++) w.stepGame({ move: [0, 0] });
      const S = w.S; let simT = 0, viewT = 0, n = 0;
      for (let f = 0; f < 240 && w.mode === 'play'; f++) {
        const t0 = performance.now(); w.stepGame({ move: [0.3, 0.2], rot: 0.4 }); const t1 = performance.now();
        w.V.update(S, 1 / 60, {}); const t2 = performance.now();
        simT += t1 - t0; viewT += t2 - t1; n++;
      }
      return { id, eyes: S.eyes.length, steps: n, simMs: +(simT / n).toFixed(3), viewMs: +(viewT / n).toFixed(3), draws: (w.V.render(), w.V.scene.children.length) };
    }, id);
    console.log(JSON.stringify(r));
  }
  const mem = await page.evaluate(() => {
    const w = window.__wtb, m = () => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
    const before = m();
    for (let i = 0; i < 30; i++) { w.goto(1 + (i % 20)); w.frame(1 / 60); }
    if (window.gc) window.gc();
    const r = w.V.scene.children.length;
    return { heapBeforeMB: before, heapAfter30RestartsMB: m(), sceneObjects: r, glTextures: w.V.scene.children.length };
  });
  console.log(JSON.stringify(mem));
  const gl = await page.evaluate(() => { const w = window.__wtb; w.goto(19); w.frame(1 / 60); const a = w.glInfo(); for (let i = 0; i < 40; i++) { w.goto(1 + (i % 20)); w.frame(1 / 60); } w.goto(19); w.frame(1 / 60); return { first: a, after40: w.glInfo() }; });
  console.log(JSON.stringify(gl));
  await b.close();
})();
