// node dev/shot.js <outdir> [w h] — load, screenshot menu, start, play a bit, screenshot.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/ip'; fs.mkdirSync(out, { recursive: true });
const W = +(process.argv[3] || 402), H = +(process.argv[4] || 874);
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = []; pg.on('console', m => logs.push(m.type() + ': ' + m.text())); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await pg.goto(`http://localhost:${port}/dev/index.html${process.argv[5] || ''}`);
  await pg.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: out + '/menu.png' });
  await pg.mouse.click(W / 2, H * 0.35);
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: out + '/play0.png' });
  await pg.mouse.click(W / 2, H * 0.35);
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: out + '/play1.png' });
  await pg.waitForTimeout(2000);
  await pg.screenshot({ path: out + '/play2.png' });
  const st = await pg.evaluate(() => { const S = window.__IP; return S && { mode: S.mode, p: S.p && { mode: S.p.mode, x: S.p.x, y: S.p.y }, t: S.t }; });
  console.log(JSON.stringify(st));
  console.log(logs.slice(0, 30).join('\n'));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
