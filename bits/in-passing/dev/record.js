// node dev/record.js <route 0-11> <outdir> [speed=1] [dsf=2] [schedule.json]
// Renders a gameplay clip frame by frame at 30 fps; speed 2 plays the world at double speed.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const plan = require('./autoplan'), S = require('./simload'), loadPlan = require('./plans_loader');
const root = path.join(__dirname, '..');
const ri = +(process.argv[2] || 0), out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const speed = +(process.argv[4] || 1), dsf = +(process.argv[5] || 2);
const { sched } = process.argv[6] ? JSON.parse(fs.readFileSync(process.argv[6], 'utf8')) : plan(S.ROUTES[ri], loadPlan(ri));
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: dsf });
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?unlock&manual`);
  await pg.waitForFunction(() => window.__step, null, { timeout: 60000 });
  await pg.evaluate(() => { for (let i = 0; i < 5; i++) window.__step(16); });
  await pg.evaluate(n => { for (let i = 0; i < 12; i++) document.querySelector('[data-a=prev]').click(); for (let i = 0; i < n; i++) document.querySelector('[data-a=next]').click(); }, ri);
  await pg.evaluate(() => { for (let i = 0; i < 30; i++) window.__step(33.333); });
  await pg.waitForTimeout(800); // let the loading card fade out
  let f = 0;
  const shot = async () => { await pg.screenshot({ path: `${out}/f${String(f++).padStart(5, '0')}.png` }); };
  const frame = async () => { await pg.evaluate(ms => window.__step(ms), 1000 / 30 * speed); await shot(); if (f % 30 === 0) console.log('frame', f, new Date().toISOString().slice(11, 19)); };
  for (let i = 0; i < Math.round(45 / speed); i++) await frame();   // a moment on the ledger
  await pg.evaluate(sc => {
    window.__IP.auto = (S2) => { const t = S2.t; let held = false; for (const [a, r] of sc) { if (t > a + 1e-6 && t < r + 1e-6) held = true; if (t > a + 1e-6 && t <= a + 1 / 120 + 1e-6) S2.pressed = true; } S2.held = held; };
  }, sched);
  await pg.mouse.click(201, 300);
  let after = -1;
  for (let i = 0; i < 30 * 200; i++) {
    await frame();
    const mode = await pg.evaluate(() => window.__IP.mode);
    if (mode === 'delivered' && after < 0) { after = 0; }
    if (after >= 0) {
      after++;
      if (after === Math.round(40 / speed)) await pg.waitForTimeout(1900); // the receipt appears on a real-time timer
      if (after > Math.round(40 / speed) + 75) break;
    }
    if (i % 150 === 0) console.log('frame', f, 'mode', mode);
  }
  console.log('frames', f);
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
