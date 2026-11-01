// Edge paths: dependency failure + retry, tilt control on/denied, resize, keyboard.
const { open, serve } = require('./shot');
const { chromium } = require('playwright');
(async () => {
  const res = [];
  const ok = (n, c, i) => res.push([c ? 'PASS' : 'FAIL', n, i || '']);
  // 1. dependency failure, then retry
  {
    const srv = await serve(); const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://localhost:${srv.address().port}/dev/index.html?fail`);
    await page.waitForSelector('.ed-err button', { timeout: 8000 });
    ok('dependency failure shows retry and reports platform error', await page.evaluate(() => !!window.__platformError && window.__platformError.stage === 'dependency'), JSON.stringify(await page.evaluate(() => window.__platformError)));
    ok('first frame visible before ready', await page.evaluate(() => window.__visualReady === 'backdrop' && !window.__ready));
    await page.click('.ed-err button');
    await page.waitForFunction(() => window.__ready, null, { timeout: 8000 });
    ok('retry loads physics and becomes ready', await page.evaluate(() => window.__egg.state === 'ready' && !document.querySelector('.ed-err')));
    ok('no page errors (failure path)', errs.length === 0, errs.join('|'));
    await browser.close(); srv.close();
  }
  // tilt control has its own suite: dev/tilt.js
  // 4. no motion capability: no tilt button
  {
    const { page, close } = await open('');
    ok('control switch offers touch and phone tilt', await page.evaluate(() => !!document.querySelector('.ed-mode button[aria-label="Touch control"].sel') && !!document.querySelector('.ed-mode button[aria-label="Phone tilt control"]')));
    // resize to a small phone and a tablet-ish width
    for (const vp of [{ width: 360, height: 640 }, { width: 430, height: 932 }, { width: 600, height: 900 }]) {
      await page.setViewportSize(vp); await page.waitForTimeout(300);
      const L = await page.evaluate(() => ({ ...window.__egg.L }));
      const deckL = L.px - 2 * L.k, deckR = L.px + 2 * L.k, table = L.py - (-2.6) * L.k;
      const box = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const m = r('.ed-mode'), c = r('.ed-chips button'); return { modeBottom: m.bottom, chipTop: c.top, modeL: m.left, modeR: m.right }; });
      ok(`layout ${vp.width}x${vp.height}: control switch clear of the chips and on screen`, box.modeBottom <= box.chipTop && box.modeL >= 0 && box.modeR <= vp.width, JSON.stringify(box));
      ok(`layout ${vp.width}x${vp.height}: deck on screen, table above chips`, deckL > 0 && deckR < vp.width && table < vp.height - (34 + 74) - 40, `deck ${deckL.toFixed(0)}..${deckR.toFixed(0)}, table ${table.toFixed(0)}`);
      await page.screenshot({ path: require('path').join(__dirname, 'out', `vp_${vp.width}.png`) });
    }
    // keyboard drives the weight
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
    ok('keyboard moves the weight and starts a run', await page.evaluate(() => window.__egg.state === 'play' && window.__egg.sim.cwPos() > 0.3), String(await page.evaluate(() => window.__egg.sim.cwPos())));
    await close();
  }
  for (const r of res) console.log(r.join('  '));
  process.exit(res.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
