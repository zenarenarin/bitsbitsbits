// Record a gameplay clip: an autopilot drives the real controller through the
// lab; the game's clock is frozen and stepped exactly 1/30 s per video frame.
// Usage: (serve on :8765) node dev/clip.js <framesDir> [landscape|portrait]
const { chromium } = require('playwright');
const out = process.argv[2], orient = process.argv[3] || 'landscape';
const vp = orient === 'portrait' ? { width: 450, height: 976 } : { width: 1280, height: 592 };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  // the harness's white logo stand-in is a layout aid, not part of the game
  await page.evaluate(() => { for (const d of document.body.children) if (d.style && d.style.zIndex === '99') d.style.display = 'none'; const r = window.__rr; r.begin(); r.freeze(true); });
  await page.evaluate(() => {
    const r = window.__rr, c = r.cat;
    const toward = x => Math.max(-1, Math.min(1, (x - c.pos[0]) * 2.2));
    // a route a player might take: weave past the tank, thread the low passage,
    // line up the ledge, then drop onto the terrace and drift across it
    const plan = z => z > -9 ? 0.4 : z > -16 ? -0.7 : z > -24 ? 0.1 : z > -46 ? 0.25 : z > -66 ? 1.4 : z > -80 ? -1.2 : 1.0;
    const jumps = [[-29.4, -30.5, 0.12], [-65.3, -66.3, 0.3]];
    window.__tick = () => {
      for (let i = 0; i < 2; i++) {
        const z = c.pos[2], j = jumps.find(([a, b]) => z < a && z > b);
        r.sim({ steer: toward(plan(z)), jump: !!j || (c._held > 0) });
        if (j && !c._held) c._held = j[2]; if (c._held > 0) c._held -= 1 / 60;
        r.frame();
      }
      return c.pos[2];
    };
  });
  let n = 0, endT = null;
  for (; n < 30 * 24; n++) {
    const z = await page.evaluate(() => window.__tick());
    await page.screenshot({ path: `${out}/${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
    if (z < -95 && endT === null) endT = n;
    if (endT !== null && n - endT > 20) break;
    if (n % 60 === 0) console.log('frame', n, 'z', z.toFixed(1));
  }
  console.log('frames', n + 1);
  await browser.close();
})();
