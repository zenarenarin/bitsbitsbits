// Screenshots in headless Chromium: node dev/shoot.js <outdir> [w] [h] [script]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/rf', W = +(process.argv[3] || 1280), H = +(process.argv[4] || 800), script = process.argv[5] || 'basic';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(d); }); }).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 600, isMobile: W < 600 });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${port}/dev/index.html`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  const ie = await p.evaluate(() => window.__initError); if (ie) console.log('INIT', ie);
  const shot = async n => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
  await p.waitForTimeout(500);
  await shot('title'); console.log('frame ms', await p.evaluate(() => window.__rf.renderMs()));
  const steps = {
    async basic() {
      await p.evaluate(() => window.__rf.begin());
      await p.evaluate(() => window.__rf.advance(1.2)); await shot('play_start');
      await p.evaluate(() => { window.__rf.act('sit'); window.__rf.advance(0.15); }); await shot('real_sit');
      await p.evaluate(() => window.__rf.advance(0.6)); await shot('both_sit');
      await p.evaluate(() => { window.__rf.act('paw'); window.__rf.advance(1.0); }); await shot('both_paw');
      await p.evaluate(() => { window.__rf.act('crouch'); window.__rf.advance(1.0); }); await shot('both_crouch');
      await p.evaluate(() => { window.__rf.act('stand'); window.__rf.advance(1.0); }); await shot('both_stand');
      await p.evaluate(() => { window.__rf.act('jump'); window.__rf.advance(0.36); }); await shot('real_jump');
      await p.evaluate(() => window.__rf.advance(0.7)); await shot('refl_jump');
    },
    async poses() {
      // side and front close-ups of both cats in every pose
      await p.evaluate(() => window.__rf.begin());
      for (const a of ['stand', 'sit', 'crouch', 'paw']) {
        await p.evaluate(a => { const rf = window.__rf; rf.cat.perform(a); rf.refl.perform(a); rf.advance(1.0); }, a);
        await p.evaluate(() => { window.__rfCam = { pos: [1.2, 0.35, 0.62], look: [0, 0.18, 0.62] }; window.__rf.advance(0.02); }); await shot('side_' + a);
        await p.evaluate(() => { window.__rfCam = { pos: [0.5, 0.45, -0.2], look: [0, 0.2, 0.62] }; window.__rf.advance(0.02); }); await shot('front_' + a);
        await p.evaluate(() => { window.__rfCam = null; });
      }
      await p.evaluate(() => { const rf = window.__rf; rf.cat.perform('jump'); window.__rfCam = { pos: [1.4, 0.4, 0.62], look: [0, 0.3, 0.62] }; rf.advance(0.36); }); await shot('side_jump');
    },
    async long() {
      await p.evaluate(() => window.__rf.begin());
      // bot answers every cue quickly; check phases flow without breaks
      await p.evaluate(() => { const rf = window.__rf; window.__bot = D => { const q = D.pending(); if (q && !q.resolved && D.t > q.cueAt + 0.3) rf.act(q.action); }; });
      for (const t of [19, 21, 30, 47, 55, 70, 85]) { await p.evaluate(t => { const rf = window.__rf; rf.advance(t - rf.D.t, window.__bot); }, t); await shot('t' + t); }
      const st = await p.evaluate(() => ({ t: window.__rf.D.t, sync: window.__rf.D.sync, score: window.__rf.D.score, counts: window.__rf.D.counts, mode: window.__rf.mode }));
      console.log(JSON.stringify(st));
      // now stop answering: the reflection escapes
      await p.evaluate(() => { const rf = window.__rf; for (let i = 0; i < 60 * 60 && rf.mode === "play"; i++) rf.frame(1 / 60, true); });
      await shot('over0');
      await p.evaluate(() => window.__rf.advance(2.2)); await shot('over_walk');
      await p.evaluate(() => window.__rf.advance(3.5)); await shot('results');
      await p.evaluate(() => window.__rf.advance(0.2));
      await p.click('text=AGAIN'); await p.evaluate(() => window.__rf.advance(0.5)); await shot('restart');
      console.log(JSON.stringify(await p.evaluate(() => ({ mode: window.__rf.mode, t: window.__rf.D.t, sync: window.__rf.D.sync }))));
    }
  };
  try { await steps[script](); } catch (e) { console.log('ERR', e.message); }
  console.log('errors:', errs.slice(0, 10).join('\n'));
  await b.close(); srv.close();
});
