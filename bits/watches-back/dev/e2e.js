// End-to-end: drive the real game in the browser with the solution steps.
// Movement goes through the game's input path; gazes are pointer taps on the canvas.
// usage: node dev/e2e.js <outdir> [from] [to] [chain]
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2], from = +(process.argv[3] || 0), to = +(process.argv[4] || 19), chain = process.argv[5] === 'chain';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html' + (process.env.Q ? '?q=' + process.env.Q : ''));
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const solSrc = fs.readFileSync(__dirname + '/solutions.js', 'utf8');
  await page.evaluate(src => {
    const module = { exports: {} };
    const require = () => ({ last: { setGaze: (W, id) => window.__ttwb.tapEye(id) } });
    new Function('module', 'require', src)(module, require);
    window.__SOL = module.exports;
  }, solSrc);
  const results = [];
  for (let i = from; i <= to; i++) {
    const r = await page.evaluate(async i => {
      const T = window.__ttwb;
      if (!window.__chained || T.G.idx !== i) T.load(i);
      const def = T.G.W.def, steps = window.__SOL[def.id].solve;
      let k = 0, t0 = performance.now(), stepT = 0, lastT = null, fails = 0;
      const startAttempt = T.G.attempt;
      return await new Promise(res => {
        window.__ttwbBot = W => {
          const now = W.t; if (lastT === null) lastT = now; stepT += Math.max(0, now - lastT); lastT = now;
          T.input.botMove = [0, 0];
          const s = steps[k];
          if (T.mode !== 'play') return;
          if (W.t < 0.05 && k > 0) { k = 0; stepT = 0; fails++; }
          if (!s) return;
          let done = false;
          if (s.go) { const p = W.player.pos, dx = s.go[0] - p[0], dz = s.go[1] - p[2], d = Math.hypot(dx, dz); if (d < (s.tol || 0.35) || (s.max && stepT > s.max)) done = true; else T.input.botMove = [dx / d, dz / d]; }
          else if (s.gaze !== undefined) { if (s.gaze) T.tapEye(s.gaze); else T.tapAt(200, 300); done = true; }
          else if (s.wait !== undefined) done = stepT >= s.wait;
          else if (s.until) done = s.until(W) || stepT > (s.max || 20);
          else if (s.do) { s.do(W); done = true; }
          else if (s.ctl) { const r = s.ctl(W, stepT); if (r === 'done') done = true; else if (r) T.input.botMove = r; }
          if (done) { k++; stepT = 0; }
        };
        const iv = setInterval(() => {
          const W = T.G.W;
          if (T.mode === 'trans' || T.mode === 'ending' || (T.G.idx !== i)) { clearInterval(iv); window.__ttwbBot = null; T.input.botMove = null; res({ ok: true, fails, t: ((performance.now() - t0) / 1000).toFixed(1) }); }
          else if (fails > 1 || performance.now() - t0 > 120000) { clearInterval(iv); window.__ttwbBot = null; T.input.botMove = null; res({ ok: false, fails, step: k, status: W.status, pos: W.player.pos.map(v => +v.toFixed(1)) }); }
        }, 100);
      });
    }, i);
    results.push(`${i + 1}: ${JSON.stringify(r)}`);
    console.log(results[results.length - 1]);
    await page.screenshot({ path: `${out}/e2e_${i + 1}.png` });
    if (chain) await page.evaluate(() => { window.__chained = true; });
    await page.waitForTimeout(chain ? 2600 : 200);
  }
  if (chain) { await page.waitForTimeout(6000); await page.screenshot({ path: `${out}/e2e_end.png` }); console.log('mode', await page.evaluate(() => window.__ttwb.mode), 'complete', await page.evaluate(() => JSON.stringify(window.__complete || null)), 'pulse', await page.evaluate(() => JSON.stringify(window.__pulse || null))); }
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await browser.close();
})();
