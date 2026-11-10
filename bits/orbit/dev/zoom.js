// Zoomed crop of the board for a daily edition at DPR 3: node dev/zoom.js out.png n
const { chromium } = require('playwright');
(async () => {
  const [out, n] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(700);
  await page.evaluate(n => window.__orbit.goTo('daily', +n), n);
  await page.waitForTimeout(2300);
  const L = await page.evaluate(() => window.__orbit.layout());
  await page.screenshot({ path: out, clip: { x: L.cx - L.R * 0.75, y: L.cy - L.R * 1.05, width: L.R * 1.5, height: L.R * 0.9 } });
  await browser.close();
})();
