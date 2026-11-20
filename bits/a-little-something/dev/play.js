// Full playthrough in headless Chromium against dev/index.html, with screenshots
// of every beat. Usage: node dev/play.js <outdir> [aim|miss|idle] [WxH]
// Serve this folder first: python3 -m http.server 8777
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || 'shots';
const mode = process.argv[3] || 'aim';
const [vw, vh] = (process.argv[4] || '402x874').split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8777/dev/index.html' + (process.argv[5] || ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name, JSON.stringify(await page.evaluate(() => window.__als.state))); };
  const state = () => page.evaluate(() => window.__als.state);
  await sleep(400);
  await shot('01_first_frame');
  await sleep(2200);
  await shot('02_demo');

  // Tap when the predicted landing is where we want it.
  async function dropWhen(goal, maxMs = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const s = await state();
      const p = await page.evaluate(() => window.__als.pred());
      if (s.cur === 'swing' && p && goal(p, s)) {
        await page.mouse.click(vw / 2, vh * 0.25);
        return true;
      }
      await sleep(16);
    }
    await page.mouse.click(vw / 2, vh * 0.25);
    return false;
  }
  async function waitPhase(fn, maxMs = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { if (fn(await state())) return true; await sleep(30); }
    return false;
  }
  if (mode === 'idle') {
    await sleep(9000);
    await shot('03_idle');
    await browser.close();
    console.log('errors', JSON.stringify(errors));
    return;
  }
  const n0 = (await state()).placed;
  const plan = mode === 'miss'
    ? ['water', 'land', 'water', 'land', 'land', 'water', 'land']
    : ['center', 'land', 'stack', 'edge', 'stack', 'land', 'land'];
  for (let i = 0; i < plan.length; i++) {
    await waitPhase((s) => s.cur === 'swing' && (s.phase === 'play' || s.phase === 'intro'));
    await sleep(300);
    const want = plan[i];
    await dropWhen((p, s) => {
      if (want === 'water') return p.kind === 'water';
      if (want === 'stack') return p.kind === 'house' || (p.kind === 'land' && Math.abs(p.x - 200) < 10);
      if (want === 'edge') return p.kind === 'land' && (p.x < s.edgeL + 18 || p.x > s.edgeR - 18);
      if (want === 'center') return p.kind === 'land' && Math.abs(p.x - 200) < 8;
      return p.kind === 'land' && Math.abs(p.x - 200) < 50;
    });
    await sleep(220);
    if (i === 0) await shot('03_first_fall');
    await waitPhase((s) => s.placed > n0 + i);
    await sleep(120);
    await shot(`04_landed_${i + 1}_${want}`);
    if (i === 3) {
      await sleep(900); await shot('05_rise_mid');
      await waitPhase((s) => s.phase === 'play' && s.risen); await sleep(600); await shot('06_afloat');
    }
  }
  await sleep(1300); await shot('07_finale_mid');
  await waitPhase((s) => s.phase === 'outro'); await sleep(1500);
  await shot('08_capture_cue');
  // Real host action: swipe the logo left.
  const lb = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight - 36 - 24 }));
  await page.mouse.move(lb.x, lb.y); await page.mouse.down(); await page.mouse.move(lb.x - 90, lb.y, { steps: 6 }); await page.mouse.up();
  await sleep(150); await shot('09_captured_flash');
  await sleep(900); await shot('10_captured');
  await waitPhase((s) => s.outro === 'like'); await sleep(1200);
  await shot('11_like_cue');
  await page.mouse.move(lb.x, lb.y); await page.mouse.down(); await page.mouse.move(lb.x + 90, lb.y, { steps: 6 }); await page.mouse.up();
  await sleep(700); await shot('12_liked');
  await waitPhase((s) => s.outro === 'nav'); await sleep(1600);
  await shot('13_nav_cue');
  await page.mouse.click(lb.x, lb.y);
  await sleep(600); await shot('14_nav_open');
  await page.evaluate(() => window.__host.setMode('play', 'back'));
  await sleep(1200); await shot('15_back');
  await page.mouse.click(vw / 2, vh * 0.3);
  await sleep(1500); await shot('16_replay');
  console.log('haptics', JSON.stringify(await page.evaluate(() => window.__haptics)));
  console.log('log', JSON.stringify(await page.evaluate(() => window.__log)));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
