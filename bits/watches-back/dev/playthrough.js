// The whole campaign, played through the real game in a browser: every encounter's
// intended plan is fed through the game's own step (events, scoring, captures,
// descents, act cards), then the ending and the results screen.
// usage: node dev/playthrough.js <outdir> [fromId] [toId]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const out = process.argv[2] || '.', from = +(process.argv[3] || 1), to = +(process.argv[4] || 20);
const shim = `const module = { exports: {} }; const __L = { DEG: Math.PI / 180, wrap: a => { a = a % (2 * Math.PI); if (a > Math.PI) a -= 2 * Math.PI; else if (a <= -Math.PI) a += 2 * Math.PI; return a; } }; const require = p => Object.assign(() => __L, __L);`;
const src = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.addScriptTag({ content: `(function(){ ${shim} ${src('policy.js')}; window.__runPlan = module.exports.runPlan; })(); (function(){ ${shim} ${src('plans.js')}; window.__plans = module.exports; })();` });
  let pass = 0, total = 0; const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
  await page.evaluate(from => { window.__wtb.begin('campaign', from); }, from);
  for (let id = from; id <= to; id++) {
    // wait out the act card / descent into this encounter
    const ready = await page.evaluate(async id => {
      const w = window.__wtb;
      for (let i = 0; i < 600 && !(w.mode === 'play' && w.run.E.id === id); i++) { if (w.mode === 'card') w.H.act.dispatchEvent(new PointerEvent('pointerdown')); w.frame(1 / 30); }
      return w.mode === 'play' && w.run.E.id === id;
    }, id);
    check(`E${id}: the game brings the traveller to this spiral`, ready);
    if (!ready) break;
    const r = await page.evaluate(id => {
      const w = window.__wtb;
      const key = id === 10 && w.run.habit.dir < 0 ? '10cw' : String(id);
      const plan = Object.values(window.__plans[key])[0];
      const S = w.S;
      // a sim facade whose step goes through the game
      const F = new Proxy(S, { get: (t, k) => k === 'step' ? (inp => { if (!w.stepGame(inp)) t.reached = t.reached || w.mode !== 'play'; }) : t[k] });
      const res = window.__runPlan(F, plan, { max: 200 });
      for (let i = 0; i < 4; i++) w.frame(1 / 60);
      return { ok: res.ok || S.reached, over: S.over, t: res.t, mode: w.mode, score: Math.floor(w.run.score), habit: w.run.habit.dir };
    }, id);
    check(`E${id}: played through the game, the plan reaches the centre`, r.ok && !r.over, r);
    if (id % 5 === 0 || id === 1) await page.screenshot({ path: `${out}/p${String(id).padStart(2, '0')}.png` });
  }
  if (to === 20) {
    const end = await page.evaluate(async () => {
      const w = window.__wtb; const seen = [];
      for (let i = 0; i < 1200 && w.mode !== 'results'; i++) { w.frame(1 / 30); if (!seen.includes(w.mode)) seen.push(w.mode); if (i === 200) window.__endShot = true; }
      return { mode: w.mode, seen, title: w.H.resH.textContent, score: Math.floor(w.run.score), completed: w.save().completed, best: w.save().best };
    });
    check('ending: the centre plays its ending, then the results', end.mode === 'results' && end.seen.includes('ending') && end.completed, end);
    await page.screenshot({ path: `${out}/p99_results.png` });
  }
  console.log(pass + '/' + total + ' playthrough checks'); if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(pass === total ? 0 : 1);
})();
