// Record a 2x-speed highlight reel of the real game: one screenshot per output frame.
// usage: node dev/clip.js outdir   (then ffmpeg the PNGs)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
const FPS = 30, SPEED = 2, STEPS = Math.round(120 * SPEED / FPS);
// Each segment: setup (runs once in the page), then a scripted input sequence, then a hold.
const SEGS = [
  { title: true, frames: 6 },
  // I: hidden in the balcony doorway, the searchlight passes, then the crossing
  { name: 'I', setup: 'L.beginRun();', seq: [{ d: 3, until: "!litSoon(2,13.8,10.2,1.6) && !litSoon(2,13.8,9.3,1.6)" }, { d: 0.6, mx: 1 }, { d: 0.9, mx: 1, j: true, jp: true }, { d: 0.6, mx: 1, until: 'P.x>12.9' }] },
  // II: caught in a street lantern, detected, broken line of sight in a doorway: it searches the wrong place
  { name: 'II', setup: 'L.world.reset(); L.watcher.reset(); L.at(26.3, 0);', seq: [{ d: 3, until: "L.watcher.mode==='track'" }, { d: 2, mx: 1, until: 'P.x>30.0' }, { d: 1.7 }] },
  // IV: wait in the doorway for the lantern to look away, pull, run in the awning's shadow
  { name: 'IV', setup: 'L.world.reset(); L.watcher.reset(); L.at(53.3, 0);', seq: [{ d: 8, until: "(l => Math.sin(2*Math.PI*l.clock/l.period)>0.85)(L.level.lights.find(l => l.x === 60.4))" }, { d: 1, mx: 1, until: 'P.x>56.1' }, { d: 0.2, a: true }, { d: 0.5 }, { d: 3, mx: 1, until: 'P.x>64.6' }] },
  // V: the shutter coming down; slide under it
  { name: 'V', setup: 'L.world.reset(); L.watcher.reset(); L.watcher.hear(66, 0, "cord"); L.level.shutters[0].y = 2.2; L.level.shutters[0].wait = 1; L.level.shutters[0].closing = true; L.at(76.2, 0);', seq: [{ d: 0.62, mx: 1 }, { d: 1.2, mx: 1, my: -1, until: 'P.x>81.5' }, { d: 0.2, mx: 1 }] },
  // VII: standing in the lamppost's light: exposed, detected, caught, and the card says why
  { name: 'VII', setup: 'L.world.reset(); L.watcher.reset(); L.at(130.6, 0);', seq: [{ d: 5, until: "L.mode==='caughtCard'" }], hold: 1.6 }
];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready);
  await page.waitForTimeout(400);
  await page.evaluate(require('fs').readFileSync(__dirname + '/sim_inject.js', 'utf8'));
  await page.evaluate(() => { window.__ll.mode = 'title'; });
  await page.evaluate(({ SEGS, STEPS }) => {
    window.__paused = true;
    const L = window.__ll, dt = 1 / 120;
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
