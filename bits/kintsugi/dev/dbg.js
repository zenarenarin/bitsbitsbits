const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(`http://localhost:${srv.address().port}/dev/index.html`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  for (let i = 0; i < 4; i++) { console.log(await p.evaluate(() => JSON.stringify({ s: __kg.state }))); await p.waitForTimeout(500); }
  const hit = await p.evaluate(() => document.elementFromPoint(195, 400).tagName + ' ' + document.elementFromPoint(195, 400).className);
  console.log('hit', hit);
  await p.mouse.click(195, 400);
  await p.waitForTimeout(500);
  console.log(await p.evaluate(() => __kg.state));
  await b.close(); srv.close();
})();
