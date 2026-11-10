const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(800);
  for (const n of [10, 9, 11, 23, 13]) {
    await page.evaluate(n => window.__orbit.goTo('daily', n), n);
    await page.waitForTimeout(2200);
    const ms = await page.evaluate(() => { const O = window.__orbit, G = O.G; G.selected = 2; G.selectT = 1; G.focus = 0; G.focusT = 1; for (let s = 0; s < 6; s++) O.step(); const t0 = performance.now(); for (let i = 0; i < 60; i++) { G.vis[2] += 0.01; O.board.drawScene(G.theme, O.scene(), performance.now()); } return (performance.now() - t0) / 60; });
    console.log('day', n, await page.evaluate(() => window.__orbit.G.theme.material.id), ms.toFixed(2), 'ms/frame @DPR3');
  }
  await browser.close();
})();
