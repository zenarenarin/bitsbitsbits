// UI flows: daily tab, start, pause, resume, restart, ledger, route arrows. Reports page errors.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/ipf'; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 402, height: 874 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`);
  await pg.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  const mode = () => pg.evaluate(() => window.__IP.mode);
  const click = sel => pg.evaluate(s => document.querySelector(s).click(), sel);
  // locked route II
  await click('[data-a=next]'); await pg.waitForTimeout(400);
  console.log('route II locked text:', await pg.evaluate(() => document.querySelector('.best').textContent));
  await pg.mouse.click(201, 300); await pg.waitForTimeout(300); console.log('after tap on locked:', await mode());
  await click('[data-a=prev]'); await pg.waitForTimeout(300);
  // daily
  await click('[data-a=daily]');
  const t0 = Date.now();
  await pg.waitForFunction(() => !document.querySelector('.go').textContent.includes('moment'), null, { timeout: 120000 });
  console.log('daily ready in', Date.now() - t0, 'ms;', await pg.evaluate(() => document.querySelector('.best').textContent));
  await pg.screenshot({ path: out + '/daily_menu.png' });
  await pg.mouse.click(201, 300); await pg.waitForTimeout(800); console.log('started:', await mode());
  await click('[data-a=pause]'); await pg.waitForTimeout(500); console.log('paused:', await mode());
  const t1 = await pg.evaluate(() => window.__IP.t); await pg.waitForTimeout(600); const t2 = await pg.evaluate(() => window.__IP.t);
  console.log('world frozen while paused:', t1 === t2);
  await pg.screenshot({ path: out + '/pause.png' });
  await click('[data-a=resume]'); await pg.waitForTimeout(400); console.log('resumed:', await mode());
  await click('[data-a=pause]'); await click('[data-a=restart]'); await pg.waitForTimeout(500); console.log('restart ->', await mode(), 'runT', (await pg.evaluate(() => window.__IP.runT)).toFixed(2));
  await click('[data-a=pause]'); await click('[data-a=ledger]'); await pg.waitForTimeout(500); console.log('ledger ->', await mode());
  await click('[data-a=journey]'); await pg.waitForTimeout(500); console.log('journey tab, route', await pg.evaluate(() => document.querySelector('.num').textContent));
  await click('[data-a=sound]'); console.log('muted icon toggled');
  console.log('errors:', errs.filter(e => !e.includes('GL Driver')).slice(0, 10));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
