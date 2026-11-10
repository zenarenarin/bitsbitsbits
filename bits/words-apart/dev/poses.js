// Fast composition check: node dev/poses.js <outdir> [phone|desktop] [labels...]
// Labels: s0..s4 (puzzle stops), m<level>_<u> (mid-descent), fin (finale), title
const { chromium } = require('playwright');
const out = process.argv[2] || 'dev/out', kind = process.argv[3] || 'phone';
const labels = process.argv.slice(4).length ? process.argv.slice(4) : ['title', 's0', 'm0_0.4', 's1', 'm1_0.5', 's2', 'm2_0.35', 'm2_0.7', 's3', 'm3_0.5', 's4', 'm4_0.6', 'fin'];
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const vp = kind === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8766/dev/index.html');
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  for (const l of labels) {
    await p.evaluate(l => {
      const w = window.__wa;
      if (l === 'title') { w.toTitle(); return; }
      if (w.mode === 'title') { w.begin('daily'); w.freeze(true); }
      if (l[0] === 's') w.jump(+l.slice(1));
      else if (l[0] === 'm') { const [a, u] = l.slice(1).split('_'); w.jump(+a, +u); }
      else if (l === 'fin') w.jump(5, null, 1);
    }, l);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${kind}-${l}.png` });
  }
  console.log('errors:', errs);
  await b.close();
})();
