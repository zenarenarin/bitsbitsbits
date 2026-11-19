// node dev/autoplay.js <route 0-11> <outdir> — plays the route in the real page with a solved schedule.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const plan = require('./autoplan'), S = require('./simload'), loadPlan = require('./plans_loader');
const root = path.join(__dirname, '..');
const ri = +(process.argv[2] || 0), out = process.argv[3] || '/tmp/ipa'; fs.mkdirSync(out, { recursive: true });
const { sched, t: solveT, fail } = plan(S.ROUTES[ri], loadPlan(ri));
console.log('solver time', solveT && solveT.toFixed(2), fail || '', 'presses', sched.length);
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 402, height: 874 } });
  const logs = []; pg.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?unlock`);
  await pg.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await pg.evaluate(n => { for (let i = 0; i < 12; i++) document.querySelector('[data-a=prev]').click(); for (let i = 0; i < n; i++) document.querySelector('[data-a=next]').click(); }, ri);
  console.log('route shown', await pg.evaluate(() => document.querySelector('.num').textContent));
  // unlock for testing
  await pg.evaluate(() => { window.__IP.unlockAll = true; });
  await pg.evaluate(() => { localStorage; });
  await pg.evaluate(sc => {
    const S = window.__IP;
    window.__timeScale = 6;
    S.auto = (S2) => {
      const t = S2.t; let held = false;
      for (const [a, r] of sc) { if (t > a + 1e-6 && t < r + 1e-6) held = true; if (t > a + 1e-6 && t <= a + 1 / 120 + 1e-6) S2.pressed = true; }
      S2.held = held;
    };
  }, sched);
  await pg.mouse.click(201, 300);
  let k = 0;
  for (let i = 0; i < 400; i++) {
    await pg.waitForTimeout(500);
    const st = await pg.evaluate(() => { const S = window.__IP; return { mode: S.mode, t: S.t, run: S.runT, pm: S.p.mode, x: S.p.x, y: S.p.y, falls: S.falls, letters: S.letters }; });
    if (i % 6 === 0) { await pg.screenshot({ path: `${out}/a${String(k++).padStart(2, '0')}.png` }); console.log(JSON.stringify(st)); }
    if (st.mode === 'delivered') { await pg.waitForTimeout(2500); await pg.screenshot({ path: out + '/result.png' }); console.log('DELIVERED', JSON.stringify(st)); break; }
  }
  console.log(logs.slice(0, 20).join('\n'));
  console.log(JSON.stringify(await pg.evaluate(() => window.__events)).slice(0, 600));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
