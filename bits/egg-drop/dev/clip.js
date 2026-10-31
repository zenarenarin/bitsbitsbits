// Record a gameplay clip: step the real page at 30 fps, screenshot each frame, encode with ffmpeg.
// node dev/clip.js <out.mp4> [surface]
const { open } = require('./shot');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
(async () => {
  const outFile = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'clip.mp4'));
  const surface = process.argv[3] || 'wood';
  const frames = fs.mkdtempSync(path.join(require('os').tmpdir(), 'eggclip-'));
  const { page, errors, close } = await open('', { width: 402, height: 874 });
  await page.evaluate((su) => {
    window.__manual = true;
    const E = window.__egg;
    E.selectSurface(su);
    // a fingertip so the viewer sees the drag
    const f = document.createElement('div');
    f.style.cssText = 'position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(245,234,210,.55);box-shadow:0 0 0 2px rgba(59,36,23,.55),0 4px 10px rgba(0,0,0,.25);pointer-events:none;z-index:99;opacity:0;transition:opacity .15s';
    document.getElementById('bit').appendChild(f);
    let ft = 0, lagged = [];
    window.__clip = { mode: 'idle', f };
    window.__frame = () => {
      const s = E.sim, L = E.L;
      const c = window.__clip;
      if (c.mode === 'play' && E.state === 'play') {
        // a human-ish hand: reaction delay and a smoothed finger
        const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
        lagged.push({ e, v, a, w });
        const o = lagged.length > 6 ? lagged.shift() : lagged[0];
        const want = Math.max(-0.2, Math.min(0.2, 0.11 * o.e.x + 0.15 * o.v.x));
        const goal = Math.max(-1.36, Math.min(1.36, -(0.5 / 0.95) * o.e.x - 3.6 * (want - o.a) + 0.5 * o.w));
        ft += (goal - ft) * 0.35;
        s.target = ft;
      } else if (c.mode === 'swing') {
        ft += (c.goal - ft) * 0.12; s.target = ft;
      }
      window.__loopStep(1000 / 30);
      // fingertip under the carriage, a little below the bell
      if (E.drag.id !== null && E.state === 'play') {
        const ang = s.angle(), x = s.cwPos(), ry = -0.5;
        const wx = x * Math.cos(ang) - (ry - 0.62) * Math.sin(ang), wy = x * Math.sin(ang) + (ry - 0.62) * Math.cos(ang);
        f.style.left = (L.px + wx * L.k) + 'px'; f.style.top = (L.py - wy * L.k) + 'px'; f.style.opacity = '1';
      } else f.style.opacity = '0';
      return { t: E.run ? E.run.t : 0, state: E.state, warn: E.dist ? E.dist.warning : 0, gust: E.dist ? E.dist.gustActive : false };
    };
    window.__skip = (sec) => { for (let i = 0; i < sec * 30; i++) window.__frame(); };
  }, surface);
  let n = 0;
  const snap = async () => { await page.screenshot({ path: path.join(frames, String(n++).padStart(5, '0') + '.png') }); };
  const rec = async (count, before) => { let r; for (let i = 0; i < count; i++) { if (before) before(i); r = await page.evaluate(() => window.__frame()); await snap(); } return r; };
  // 1. title screen
  await rec(40);
  // 2. grab the weight, nudge it, then balance
  await page.evaluate(() => { const E = window.__egg; E.drag.id = 1; E.sim.target = 0; E.beginRun(); window.__clip.mode = 'play'; });
  await rec(30 * 10);
  // 3. fast-forward (not recorded) to just before the first gust
  let r;
  for (let i = 0; i < 60 * 30; i++) { r = await page.evaluate(() => window.__frame()); if (r.warn > 0.02 || r.state !== 'play') break; }
  console.log('cut at', r);
  await rec(30 * 7);
  // 4. let go: the egg runs away, falls and cracks
  await page.evaluate(() => { const E = window.__egg; window.__clip.mode = 'swing'; window.__clip.goal = E.sim.eggLocal().x > 0 ? 1.3 : -1.3; });
  for (let i = 0; i < 30 * 12; i++) { r = await page.evaluate(() => window.__frame()); await snap(); if (r.state === 'results') break; }
  await page.evaluate(() => { window.__egg.drag.id = null; });
  await rec(30 * 3.5);
  console.log('frames', n, 'errors', errors);
  await close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(frames, '%05d.png'), '-vf', 'scale=720:-2:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', outFile]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('wrote', outFile);
})();
