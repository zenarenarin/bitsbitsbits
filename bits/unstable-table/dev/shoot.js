// Screenshots in headless Chromium at phone size.
// node dev/shoot.js <outdir> [scenario]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/ut'; fs.mkdirSync(out, { recursive: true });
const scenario = process.argv[3] || 'basic';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const logs = []; pg.on('console', m => logs.push(m.type() + ': ' + m.text())); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.stack));
  await pg.goto(`http://localhost:${port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 20000 });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: out + '/01_start.png' });
  if (scenario === 'basic' || scenario === 'many') {
    await pg.evaluate(() => { const U = window.__UT; U.place('vase', -1.2); U.place('bell', 0.5); U.place('pomegranate', 1.5); U.place('books', -0.4); });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: out + '/02_some.png' });
  }
  if (scenario === 'many') {
    await pg.evaluate(() => { const U = window.__UT; const ids = ['teapot', 'cat', 'perfume', 'frame', 'lemon', 'grapes']; ids.forEach((id, i) => U.place(id, -1.7 + i * 0.6, 0.9)); });
    await pg.waitForTimeout(3000);
    await pg.screenshot({ path: out + '/03_many.png' });
  }
  if (scenario === 'gallery') {
    await pg.evaluate(() => { const U = window.__UT; U.sim.world.setGravity(planck.Vec2(0, 0)); });
  }
  console.log(logs.join('\n'));
  await b.close(); srv.close();
})();
