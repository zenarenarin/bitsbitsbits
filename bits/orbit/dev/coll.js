// Collection + persistence across reload (device storage carried over manually).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(600);
  // Solve today + two studies through the engine's committed-move path (taps).
  async function solveViaTaps() {
    const plan = await page.evaluate(() => { const G = window.__orbit.G; const p = []; for (let k = 1; k < G.puzzle.ringCount; k++) p.push([k, G.eng.stepsToAlign(k)]); return p; });
    for (const [k, s] of plan) {
      await page.evaluate(k => { window.__orbit.G.selected = k; window.__orbit.G.selectAt = performance.now(); }, k);
      for (let i = 0; i < Math.abs(s); i++) { await page.evaluate(d => document.querySelectorAll('.rot')[d > 0 ? 1 : 0].click(), s); await page.waitForTimeout(60); }
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(2000);
  }
  // make one partial move on the daily, reload, check restored
  await page.evaluate(() => { window.__orbit.G.selected = 2; document.querySelectorAll('.rot')[1].click(); });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__orbit.G.eng.rot.slice());
  const store1 = await page.evaluate(() => JSON.stringify(window.__store));
  await page.goto('http://localhost:8777/dev/index.html');
  await page.evaluate(s => { Object.assign(window.__store, JSON.parse(s)); }, store1);
  // storage was read at init before we injected; reload again with an init script instead
  await page.addInitScript(s => { window.__preStore = s; }, store1);
  await page.goto('http://localhost:8777/dev/index.html?pre');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ rot: window.__orbit.G.eng.rot.slice(), moves: window.__orbit.G.eng.moves }));
  ok(JSON.stringify(after.rot) === JSON.stringify(before) && after.moves === 1, 'partial daily restored after reload ' + JSON.stringify(after));
  await solveViaTaps();
  ok(await page.evaluate(() => window.__orbit.G.phase === 'done'), 'daily solved');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => [...document.querySelectorAll('.act')].find(b => /Studies|Next study/.test(b.textContent)).click());
    await page.waitForTimeout(2200);
    console.log('  before', await page.evaluate(() => { const G = window.__orbit.G; return G.mode + ' ' + G.level + ' ' + G.phase + ' sel ' + G.selected; }));
    await solveViaTaps();
    console.log('  after', await page.evaluate(() => { const G = window.__orbit.G; return G.mode + ' ' + G.level + ' ' + G.phase + ' ' + G.eng.alignedCount(); }));
  }
  const coll = await page.evaluate(() => window.__orbit.scores.profile.coll.slice());
  ok(coll.length === 3, 'three universes collected ' + coll.join(','));
  await page.evaluate(() => [...document.querySelectorAll('.act')].find(b => b.textContent.includes('Collection')).click());
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'dev/out/collection.png' });
  await page.evaluate(() => document.querySelectorAll('.orbm .card')[1].click());
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'dev/out/detail.png' });
  await page.evaluate(() => [...document.querySelectorAll('.orbm .act')].find(b => b.textContent.includes('View')).click());
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => window.__orbit.G.mode === 'gallery'), 'gallery mode');
  await page.screenshot({ path: 'dev/out/gallery.png' });
  await page.evaluate(() => [...document.querySelectorAll('.act')].find(b => b.textContent.includes('Back')).click());
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => window.__orbit.G.mode === 'study'), 'back from gallery');
  // reopen with storage: today's solved state shows the artwork
  const store2 = await page.evaluate(() => JSON.stringify(window.__store));
  await page.addInitScript(s => { window.__preStore = s; }, store2);
  await page.goto('http://localhost:8777/dev/index.html?pre2');
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.__orbit.G.phase === 'done' && window.__orbit.G.eng.solved), 'reopened daily shows completed artwork');
  ok(await page.evaluate(() => window.__orbit.scores.profile.levels.reached === 3), 'studies progress kept');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors', fails ? fails + ' failures' : 'collection: all passed');
  await browser.close();
})();
