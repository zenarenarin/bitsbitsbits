// Screenshots of each stage and of obstacles. Usage: node dev/stages.js <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = process.argv[2] || path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(d); }); }).listen(8769);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack));
  await p.goto('http://localhost:8769/dev/index.html');
  await p.waitForFunction(() => window.__dlb, null, { timeout: 60000 });
  const ev = (f, a) => p.evaluate(f, a);
  await ev(() => { window.__dlbManual = true; __dlb.begin(false); });
  for (const s of [500, 1150, 1950]) {
    // run up to the first obstacle of the stretch
    const info = await ev(s => { const D = __dlb; D.jump(s); D.run.M.gap = 50; for (let i = 0; i < 200; i++) { D.run.stamina = 100; D.run.M.gap = 50; D.advance(1 / 30, true, true); const o = D.W.obstacles.find(o => o.s - D.run.s > 8 && o.s - D.run.s < 14); if (o && D.run.s > s + 5) return o.kind + '@' + (o.s - D.run.s).toFixed(1); } return 'none'; }, s);
    await ev(() => __dlb.frame(1));
    await p.screenshot({ path: `${out}/stage_${s}.png` });
    console.log(s, info);
  }
  console.log(errs.join('\n'));
  await b.close(); srv.close();
})();
