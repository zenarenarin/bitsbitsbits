// Portrait gameplay montage at 2x speed: node dev/record.js <outdir>
// Game time and CSS animations are stepped together, frame by frame, so the
// clip is exact regardless of how slowly headless Chromium renders.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/rf-rec';
const FPS = 30, SPEED = 2, GAME_DT = SPEED / FPS;
fs.mkdirSync(path.join(out, 'f'), { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(d); }); }).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, hasTouch: true, isMobile: true });
  p.on('pageerror', e => console.log('pageerror', String(e)));
  await p.addInitScript(() => { window.__rfPixelRatio = 2.5; });
  await p.goto(`http://localhost:${port}/dev/index.html?fullscreen`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 120000 });
  await p.evaluate(() => {
    window.__rfHold = true;                       // stop the harness's real-time loop
    document.getElementById('logo').style.display = 'none';
    const cut = document.createElement('div');
    cut.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:100';
    document.body.appendChild(cut); window.__cut = cut;
    // a human-ish bot: copies the reflection 280-520 ms after the cue
    window.__bot = { mode: 'good', next: 0, queue: [] };
    window.__botStep = D => {
      const B = window.__bot, rf = window.__rf;
      if (!D || rf.mode !== 'play') return;
      if (!D.leading()) {
        if (D.t >= B.next) { const acts = ['sit', 'paw', 'stand', 'crouch', 'jump', 'sit', 'stand']; rf.act(acts[Math.floor(D.t / 1.4) % acts.length]); B.next = D.t + 1.25 + Math.random() * 0.4; }
        return;
      }
      if (B.mode === 'idle') return;
      const q = D.pending();
      if (q && !q.resolved && !q.botAt) q.botAt = q.cueAt + 0.28 + Math.random() * 0.24;
      if (q && !q.resolved && D.t >= q.botAt) rf.act(q.action);
    };
    // step CSS animations/transitions in game-locked time
    const seen = new WeakSet();
    window.__stepCss = ms => { for (const a of document.getAnimations()) { if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = 0; } a.currentTime = (a.currentTime || 0) + ms; } };
    window.__adv = sec => { const rf = window.__rf, n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) { rf.frame(1 / 60, i < n - 1); window.__botStep(rf.D); } };
    window.__skip = sec => { const rf = window.__rf, n = Math.round(sec * 60); for (let i = 0; i < n; i++) { rf.frame(1 / 60, true); window.__botStep(rf.D); } };
  });
  let k = 0;
  const shot = async () => { await p.screenshot({ path: path.join(out, 'f', String(k++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 }); };
  const film = async (sec, cut) => {
    // cut: fade in over the first frames and out over the last
    const n = Math.round(sec * FPS / SPEED);
    for (let i = 0; i < n; i++) {
      const fade = cut ? Math.max(0, 1 - Math.min(i, n - 1 - i) / 5) : 0;
      await p.evaluate(([dt, f]) => { window.__adv(dt); window.__stepCss(dt * 1000); window.__cut.style.opacity = f; }, [GAME_DT, fade]);
      await shot();
    }
  };
  const still = async (realSec) => { for (let i = 0; i < realSec * FPS; i++) { await p.evaluate(fps => { window.__rf.frame(1 / fps); window.__stepCss(1000 / fps); window.__cut.style.opacity = 0; }, FPS); await shot(); } };
  const log = async tag => console.log(tag, JSON.stringify(await p.evaluate(() => { const D = window.__rf.D; return D ? { t: +D.t.toFixed(1), sync: Math.round(D.sync), level: D.level, mode: window.__rf.mode, frames: 0 } : { mode: window.__rf.mode }; })), 'frames', k);

  await still(1.0);                                          // title
  await p.evaluate(() => { window.__rf.begin(); });
  await film(9, false); await log('A follower');             // 0-9 s: it follows
  await p.evaluate(() => window.__skip(18.6 - window.__rf.D.t));
  await film(9, true); await log('B takeover');               // ~18.6-27.6 s: "Then it doesn't."
  await p.evaluate(() => window.__skip(54 - window.__rf.D.t));
  await film(8, true); await log('C intruder');               // ~54-62 s: feints, pairs
  // it slips: the bot stops answering, the reflection escapes
  await p.evaluate(() => { window.__bot.mode = 'idle'; for (let i = 0; i < 60 * 60 && window.__rf.D.sync > 31; i++) { window.__rf.frame(1 / 60, true); } });
  await log('D before escape');
  let guard = 0;
  while (guard++ < 400) {
    const m = await p.evaluate(() => window.__rf.mode);
    if (m === 'results') break;
    await film(GAME_DT * SPEED, false);
  }
  await log('E results');
  await film(3.2, false);
  await log('end');
  await b.close(); srv.close();
  console.log('frames', k);
});
