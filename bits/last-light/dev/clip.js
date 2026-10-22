// Record a 2x-speed highlight reel of the real game: one screenshot per output frame.
// usage: node dev/clip.js outdir   (then ffmpeg the PNGs)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
const FPS = 30, SPEED = 2, STEPS = Math.round(120 * SPEED / FPS);
// Each segment: setup (runs once in the page), then a scripted input sequence, then a hold.
const SEGS = [
  { title: true, frames: 6 },
  { name: 'I', setup: 'L.beginRun();', seq: [{ d: 0.6, mx: 1 }, { d: 0.9, mx: 1, j: true, jp: true }, { d: 0.6, mx: 1, until: 'P.x>12.9' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.8, my: 1, until: "P.state==='ground'" }] },
  { name: 'II', setup: 'L.world.reset(); L.watcher.reset(); L.at(24.5, 11.6); for (const l of L.level.lights) l.clock += 1.2;', seq: [{ d: 3, mx: 1, until: 'P.x>27.4' }, { d: 0.8, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 1.6, mx: 1, until: 'P.x>33.6' }, { d: 0.6, my: -1, until: "P.state==='hang'" }, { d: 0.5, mx: 1 }] },
  { name: 'III', setup: 'L.world.reset(); L.watcher.reset(); L.at(42.4, 11.6);', seq: [{ d: 2, mx: 1, until: "P.state==='pipe'" }, { d: 1.6, my: -1, until: "P.state==='ground'" }] },
  { name: 'IV', setup: 'L.world.reset(); L.watcher.reset(); L.at(55.4, 0);', seq: [{ d: 1, mx: 1, until: 'P.x>56.1' }, { d: 0.15 }, { d: 0.2, a: true }, { d: 0.55 }, { d: 3, mx: 1, until: 'P.x>65.6' }] },
  { name: 'V', setup: 'L.world.reset(); L.watcher.reset(); L.watcher.hear(66, 0, "cord"); L.level.shutters[0].y = 2.2; L.level.shutters[0].wait = 1; L.level.shutters[0].closing = true; L.at(76.2, 0);', seq: [{ d: 0.62, mx: 1 }, { d: 1.2, mx: 1, my: -1, until: 'P.x>81.5' }, { d: 0.2, mx: 1 }] },
  { name: 'VI', setup: 'L.world.reset(); L.watcher.reset(); L.at(99.5, 0); const P = L.player, r = L.level.ropes[0]; P.state = "rope"; P.rope = r; P.rLen = 5.6; P.rAng = -0.8; P.rW = 0.4; P.x = r.ax + Math.sin(P.rAng) * P.rLen; P.y = r.ay - Math.cos(P.rAng) * P.rLen - P.h - 0.1; L.R.follow(P, 1, true);', seq: [{ d: 2, mx: 1, until: 'P.rAng>0.75' }, { d: 1.5, mx: 1, jp: true, j: true, until: "P.state==='ground'" }, { d: 0.2, mx: 1 }] },
  { name: 'VII', setup: 'L.world.reset(); L.watcher.reset(); L.at(124.4, 6.4);', seq: [{ d: 1, mx: 1, until: 'P.x>125.6' }, { d: 0.2, a: true }, { d: 0.45 }, { d: 0.1, my: -1, j: true, jp: true }, { d: 1.5, until: "P.state==='ground' && P.y<1" }, { d: 5, mx: 1, until: 'L.mode!=="play"' }], hold: 1.2 }
];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready);
  await page.waitForTimeout(400);
  await page.evaluate(({ SEGS, STEPS }) => {
    window.__paused = true;
    const L = window.__ll, dt = 1 / 120;
    L.at = (x, y) => { L.player.reset(x, y, 1); L.R.follow(L.player, 1, true); };
    let si = 0, ii = 0, t = 0, first = true, holdT = 0, setupDone = false, titleN = 0;
    window.__tick = function () {
      for (let k = 0; k < STEPS; k++) {
        const s = SEGS[si]; if (!s) return true;
        if (s.title) { if (k === 0) titleN++; if (titleN > s.frames) { si++; } else continue; continue; }
        if (!setupDone) { new Function('L', s.setup)(L); setupDone = true; ii = 0; t = 0; first = true; holdT = 0; }
        const P = L.player, it = s.seq[ii];
        if (it) {
          L.key.l = (it.mx || 0) < 0; L.key.r = (it.mx || 0) > 0; L.key.u = (it.my || 0) > 0; L.key.d = (it.my || 0) < 0; L.key.j = !!it.j;
          if (first && it.jp) L.I.jumpPressed = true;
          if (first && it.a) L.I.actPressed = true;
          first = false;
          L.step(dt); t += dt;
          if (t >= (it.d || 10) || (it.until && new Function('P', 'L', 'return (' + it.until + ')')(P, L))) { ii++; t = 0; first = true; }
        } else {
          for (const q in L.key) L.key[q] = false;
          L.step(dt); holdT += dt;
          if (holdT >= (s.hold || 0)) { si++; setupDone = false; }
        }
      }
      L.frame(STEPS / 120);
      return si >= SEGS.length;
    };
  }, { SEGS, STEPS });
  let n = 0;
  while (true) {
    const done = await page.evaluate(() => window.__tick());
    await page.screenshot({ path: `${out}/f${String(n++).padStart(4, '0')}.png` });
    if (done || n > 600) break;
  }
  console.log('frames', n, errs.join('\n'));
  await browser.close();
})();
