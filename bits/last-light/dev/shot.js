// Screenshots at named places. usage: node dev/shot.js outdir [w h] -- then a list of x,y[,label] warps
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
const W = +(process.argv[3] || 402), H = +(process.argv[4] || 874);
const spots = process.argv.slice(5);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.goto('http://localhost:8766/dev/index.html' + (process.env.Q || ''));
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/00_title.png' });
  for (const sp of spots) {
    const [x, y, label, extra] = sp.split(',');
    await page.evaluate(([x, y, extra]) => {
      const L = window.__ll; if (L.mode !== 'play') L.beginRun();
      L.player.reset(+x, +y, 1); L.R.follow(L.player, 1, true);
      if (extra === 'awning') L.world.pullAwning(L.level.awnings[0]);
      if (extra === 'awning2') L.world.pullAwning(L.level.awnings[1]);
      if (extra === 'debug') L.R.debug = true;
    }, [x, y, extra]);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${label || ('x' + x)}.png` });
  }
  console.log(errs.join('\n') || 'no errors');
  await browser.close();
})();
