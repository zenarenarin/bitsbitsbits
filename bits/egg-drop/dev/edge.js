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
  // 2. tilt control granted
  {
    const { page, errors, close } = await open('?motion&motionok');
    await page.click('.ed-icon[aria-label="Tilt control"]');
    await page.waitForTimeout(200);
    ok('tilt toggle turns on', await page.evaluate(() => document.querySelector('.ed-icon[aria-label="Tilt control"]').classList.contains('on')));
    await page.evaluate(() => { window.__tilt.x = 1; });
    // tilt alone does not start a run; a touch does
    const L = await page.evaluate(() => ({ ...window.__egg.L }));
    await page.mouse.click(L.px, L.py + 100);
    await page.evaluate(() => { window.__tilt.x = 1; });
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ cw: window.__egg.sim.cwPos(), state: window.__egg.state }));
    ok('tilting the phone slides the weight', st.cw > 1.0, JSON.stringify(st));
    ok('no page errors (tilt)', errors.length === 0, errors.join('|'));
    await close();
  }
  // 3. tilt denied falls back to drag
  {
    const { page, errors, close } = await open('?motion');
    await page.click('.ed-icon[aria-label="Tilt control"]');
    await page.waitForTimeout(200);
    ok('tilt denied stays off with a message', await page.evaluate(() => !document.querySelector('.ed-icon[aria-label="Tilt control"]').classList.contains('on') && window.__egg.fx.toast && /unavailable/.test(window.__egg.fx.toast.text)));
    await close();
  }
  // 4. no motion capability: no tilt button
  {
    const { page, close } = await open('');
    ok('tilt button hidden without motion capability', await page.evaluate(() => !document.querySelector('.ed-icon[aria-label="Tilt control"]')));
    // resize to a small phone and a tablet-ish width
    for (const vp of [{ width: 360, height: 640 }, { width: 430, height: 932 }, { width: 600, height: 900 }]) {
      await page.setViewportSize(vp); await page.waitForTimeout(300);
      const L = await page.evaluate(() => ({ ...window.__egg.L }));
      const deckL = L.px - 2 * L.k, deckR = L.px + 2 * L.k, table = L.py - (-2.6) * L.k;
      ok(`layout ${vp.width}x${vp.height}: deck on screen, table above chips`, deckL > 0 && deckR < vp.width && table < vp.height - (34 + 74) - 40, `deck ${deckL.toFixed(0)}..${deckR.toFixed(0)}, table ${table.toFixed(0)}`);
      await page.screenshot({ path: `dev/out/vp_${vp.width}.png` });
    }
    // keyboard drives the weight
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
    ok('keyboard moves the weight and starts a run', await page.evaluate(() => window.__egg.state === 'play' && window.__egg.sim.cwPos() > 0.4), String(await page.evaluate(() => window.__egg.sim.cwPos())));
    await close();
  }
  for (const r of res) console.log(r.join('  '));
  process.exit(res.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
