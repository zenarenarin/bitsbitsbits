// Dump every eyeball layer, lid and the jar as a zoomed sprite sheet for art review.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const url = await page.evaluate(() => {
    const a = window.__cte.art, Z = 8, kinds = Object.keys(a.big);
    const c = document.createElement('canvas'); c.width = 8 * 30 * Z; c.height = (kinds.length * 2 * 26 + 70) * Z;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#1b1119'; g.fillRect(0, 0, c.width, c.height);
    const put = (cv, x, y) => g.drawImage(cv, x * Z, y * Z, cv.width * Z, cv.height * Z);
    kinds.forEach((k, row) => {
      for (const [set, yo] of [[a.big, 0], [a.small, 26]]) {
        const s = set[k], y = row * 52 + yo + 2, D = s.D, io = (D - s.irisSize) / 2;
        put(s.sclera, 2, y); put(s.sclera, 32, y); put(s.iris, 32 + io, y + io); put(s.gloss, 32, y);
        put(s.sclera, 62, y); put(s.iris, 62 + io + s.look, y + io + s.look); put(s.gloss, 62, y);
        put(s.lidHalf, 92, y); put(s.lidClosed, 122, y); put(s.flash, 152, y); if (s.hot) put(s.hot, 182, y);
        put(s.iris, 212, y);
      }
    });
    put(a.jarBack, 2, kinds.length * 52 + 4); put(a.jarFront, 2, kinds.length * 52 + 4); put(a.jarFront, 60, kinds.length * 52 + 4);
    return c.toDataURL();
  });
  require('fs').writeFileSync(process.argv[2], Buffer.from(url.split(',')[1], 'base64'));
  await browser.close();
})();
