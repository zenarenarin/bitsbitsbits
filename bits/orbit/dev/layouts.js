// Layout screenshots: small phone (play, stage 3, done) and wide.
// node dev/layouts.js [outdir]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'dev/out';
  const browser = await chromium.launch();
  const errs = [];
  async function shoot(name, w, h, query, stage) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    await page.goto('http://localhost:8777/dev/index.html' + (query ? '?' + query : ''));
    await page.waitForTimeout(1600);
    // Play forward through the real commit path until the requested stage (3 = solved).
    for (let g = 0; g < 80; g++) {
      const st = await page.evaluate(() => { const E = window.__orbit.G.eng; return E.solved ? 3 : E.stage; });
      if (st >= stage) break;
      await page.evaluate(() => window.__orbit.step());
      await page.waitForTimeout(stage === 3 ? 60 : 120);
    }
    await page.waitForTimeout(stage === 3 ? 4200 : 3000);
    await page.screenshot({ path: out + '/' + name + '.png' });
    await page.close();
  }
  await shoot('se_play', 375, 667, 'safe=20,0', 0);
  await shoot('se_stage3', 375, 667, 'safe=20,0', 2);
  await shoot('se_done', 375, 667, 'safe=20,0', 3);
  await shoot('wide_stage3', 1180, 820, '', 2);
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'layouts: no page errors');
  await browser.close();
})();
