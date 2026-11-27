const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8777/dev/index.html?safe=20,0');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'dev/out/se_play.png' });
  await page.evaluate(() => { const G = window.__orbit.G; for (let k = 1; k < G.puzzle.ringCount; k++) G.eng.rotate(k, G.eng.stepsToAlign(k)); G.vis = G.eng.rot.map(r => r * Math.PI / 6); G.phase = 'play'; });
  // trigger the solved flow through the real path: undo the last, then redo by button
  await page.evaluate(() => { const G = window.__orbit.G; const h = G.eng.history[G.eng.history.length - 1]; G.eng.solved = false; G.eng.undo(); G.vis[h.ring] = h.from * Math.PI / 6; G.selected = h.ring; window.__dir = Math.sign(h.to - h.from); window.__n = Math.abs(h.to - h.from); });
  const n = await page.evaluate(() => window.__n);
  for (let i = 0; i < n; i++) { await page.evaluate(() => document.querySelectorAll('.rot')[window.__dir > 0 ? 1 : 0].click()); await page.waitForTimeout(350); }
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'dev/out/se_done.png' });
  console.log(await page.evaluate(() => window.__orbit.G.phase));
  await browser.close();
})();
