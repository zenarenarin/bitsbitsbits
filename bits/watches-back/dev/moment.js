// Run an encounter's solution up to step k (through the real game), then screenshot.
// usage: node dev/moment.js <out> <enc> <step> [extraWaitMs] [dpr]
const { chromium } = require('playwright');
const fs = require('fs');
const [out, enc, stopAt, extra, dpr] = [process.argv[2], +process.argv[3], +process.argv[4], +(process.argv[5] || 0), +(process.argv[6] || 2)];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: dpr });
  page.on('pageerror', e => console.log('PAGEERROR ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html?q=2');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const src = fs.readFileSync(__dirname + '/solutions.js', 'utf8');
  await page.evaluate(src => { const module = { exports: {} }; new Function('module', 'require', src)(module, () => ({ last: { setGaze: (W, id) => window.__ttwb.tapEye(id) } })); window.__SOL = module.exports; }, src);
  await page.evaluate(([i, stopAt]) => new Promise(res => {
    const T = window.__ttwb; T.load(i);
    const steps = window.__SOL[T.G.W.def.id].solve; let k = 0, stepT = 0, lastT = null;
    window.__ttwbBot = W => {
      const now = W.t; if (lastT === null) lastT = now; stepT += Math.max(0, now - lastT); lastT = now;
      T.input.botMove = [0, 0];
      if (k >= stopAt) { res(); return; }
      const s = steps[k]; let done = false;
      if (s.go) { const p = W.player.pos, dx = s.go[0] - p[0], dz = s.go[1] - p[2], d = Math.hypot(dx, dz); if (d < (s.tol || 0.35) || (s.max && stepT > s.max)) done = true; else T.input.botMove = [dx / d, dz / d]; }
      else if (s.gaze !== undefined) { if (s.gaze) T.tapEye(s.gaze); else T.tapAt(200, 300); done = true; }
      else if (s.wait !== undefined) done = stepT >= s.wait;
      else if (s.until) done = s.until(W) || stepT > (s.max || 20);
      else if (s.do) { s.do(W); done = true; }
      else if (s.ctl) { const r = s.ctl(W, stepT); if (r === 'done') done = true; else if (r) T.input.botMove = r; }
      if (done) { k++; stepT = 0; }
    };
  }), [enc, stopAt]);
  await page.waitForTimeout(extra);
  await page.evaluate(() => { window.__hold = true; }); await page.screenshot({ path: `${out}/moment_${enc + 1}_${stopAt}.png`, timeout: 120000 });
  await browser.close();
})();
