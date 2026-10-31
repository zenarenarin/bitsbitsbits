// Records a 10 s, 30 fps clip frame by frame (simulation and timers advance in lockstep with frames).
// Usage: node dev/clip.js <hide|catch|loop|deep> <out.mp4> [scale] [seconds]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), which = process.argv[2], out = process.argv[3], scale = +(process.argv[4] || 1.5);
const SECS = +(process.argv[5] || 10), PORT = 8771 + ['hide', 'catch', 'loop', 'deep'].indexOf(which);
const tmp = fs.mkdtempSync('/tmp/dlbclip-');
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(d); }); }).listen(PORT);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
  const errs = []; p.on('pageerror', e => errs.push(e.stack));
  await p.goto(`http://localhost:${PORT}/dev/index.html`);
  await p.waitForFunction(() => window.__dlb, null, { timeout: 60000 });
  // CSS fades run at a matching slow rate; ctx timers run on virtual time
  const cdp = await p.context().newCDPSession(p); await cdp.send('Animation.enable');
  await p.evaluate(() => {
    window.__dlbManual = true; window.__vt = 0; window.__q = [];
    __ctx.timeout = (fn, ms) => { __q.push({ at: __vt + ms / 1000, fn }); };
    window.__tickTimers = dt => { __vt += dt; const due = __q.filter(t => t.at <= __vt); window.__q = __q.filter(t => t.at > __vt); due.forEach(t => t.fn()); };
  });
  await p.evaluate(which => {
    const D = __dlb;
    window.__script = which;
    window.__f = 0;
    // a simple pilot: keep a free lane through whatever blocks the trail ahead
    window.__steer = (lean) => {
      const r = D.run, ahead = D.W.obstacles.filter(o => !o.low && o.s > r.s - 0.5 && o.s - r.s < 14).sort((a, b) => a.s - b.s)[0];
      if (ahead) { const c = []; for (let u = -2.2; u <= 2.2; u += 0.2) if (!ahead.blocks.some(b => u + 0.45 > b[0] && u - 0.45 < b[1])) c.push(u); if (c.length) { c.sort((a, b) => Math.abs(a - r.u) - Math.abs(b - r.u)); r.uT = c[0]; } }
      else if (lean != null) r.uT = lean;
    };
    if (which === 'catch') {
      D.begin(false); D.jump(430); D.run.stage = 1;
      D.run.M.gap = 16; D.run.stamina = 4; D.run.heat = 1; D.run.time = 30;
      D.W.spots.length = 0; // nowhere left to hide
      D.advance(0.5, true, true);
    }
  }, which);
  const N = SECS * 30;
  for (let i = 0; i < N; i++) {
    await p.evaluate(i => {
      const D = __dlb, t = i / 30;
      if (__script === 'hide') {
        if (D.mode === 'title') { if (t >= 1.5) { D.begin(true); D.input.hold = true; } else { D.frame(2); return; } }
        const r = D.run;
        const sp = D.W.spots.find(s => s.s > r.s - 2 && s.s < r.s + 30);
        if (r.state === 'run' || r.state === 'stop') { if (sp) r.uT = Math.sign(sp.objU) * 1.7; if (D.W.coverNear(r.s, r.u) && t > 3.5) { D.input.hold = false; } }
        if (r.state === 'toHide' && !window.__set) { window.__set = 1; r.M.gap = Math.min(r.M.gap, 13); }
        D.advance(1 / 30, D.input.hold, true);
      } else if (__script === 'loop') {
        // title, run, hide, it walks past, break cover and run on
        if (D.mode === 'title') { if (t >= 1.6) { D.begin(true); D.input.hold = true; } else { D.frame(2); return; } }
        const r = D.run, M = r.M, hidden = r.state === 'hide' || r.state === 'toHide';
        if (!window.__hid) {
          const sp = D.W.spots.find(s => s.s > r.s - 2 && s.s < r.s + 30);
          if (sp) __steer(Math.sign(sp.objU) * 1.7);
          if (D.W.coverNear(r.s, r.u) && t > 3.5) { D.input.hold = false; window.__hid = 1; }
        } else if (hidden) {
          if (!window.__set) { window.__set = 1; M.gap = Math.min(M.gap, 12); }
          D.input.hold = M.mode === 'lost' || (M.mode === 'pass' && M.gap < -12.6);
        } else { D.input.hold = true; __steer(Math.sin(t * 0.7) * 0.8); r.stamina = Math.max(r.stamina, 40); }
        D.advance(1 / 30, D.input.hold, true);
      } else if (__script === 'deep') {
        // stages II to IV: obstacles and events, then exhausted, caught, game over
        const r = D.run;
        if (i === 0) { D.begin(false); D.jump(420); r.M.gap = 40; r.stamina = 90; r.time = 40; }
        if (i === 30) D.startBats();
        if (i === 75) { const hw = 2.5; r.apparition = { kind: 'stand', t: 0, side: 1, s: r.s + 34, u: hw + 7, dur: 3.5 }; }
        if (i === 165) { D.jump(1000); r.M.gap = 38; r.stamina = 80; }
        if (i === 180) D.W.spawnFaller(r.s + 38);
        if (i === 330) { D.jump(1760); r.M.gap = 15; r.stamina = 6; r.heat = 1; D.W.spots.length = 0; }
        if (D.mode === 'play') { if (r.state !== 'trip') __steer(null); if (i < 330) r.M.gap = Math.max(r.M.gap, 30); if (i > 330) D.W.spots.length = 0; }
        D.advance(1 / 30, D.mode === 'play', true);
      } else {
        D.advance(1 / 30, D.mode === 'play', true);
      }
      D.renderer.render(D.scene, D.camera);
      __tickTimers(1 / 30);
    }, i);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.08 });
    await p.screenshot({ path: `${tmp}/f${String(i).padStart(4, '0')}.png` });
    if (i % 30 === 0) console.log(which, 'frame', i, await p.evaluate(() => `${__dlb.mode} ${__dlb.run.state} ${__dlb.run.M.mode}:${__dlb.run.M.gap.toFixed(1)} s=${__dlb.run.s.toFixed(0)}`));
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close(); srv.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${tmp}/f%04d.png`, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
  fs.rmSync(tmp, { recursive: true });
  console.log('wrote', out);
})();
