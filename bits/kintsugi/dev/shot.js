// Screenshots of a phone-sized run. usage: node dev/shot.js <outdir> [level] [steps...]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } const ext = path.extname(f); r.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const logs = [];
  p.on('console', m => logs.push(m.type() + ': ' + m.text()));
  p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await p.goto(`http://localhost:${port}/dev/index.html`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  const err = await p.evaluate(() => window.__initError);
  if (err) { console.log('INIT ERROR', err); }
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(out, '01_intro.png') });
  await p.mouse.click(195, 400);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, '02_break.png') });
  await p.waitForFunction(() => __kg.state === "assembly", null, { timeout: 60000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, '03_assembly.png') });
  console.log(await p.evaluate(() => window.__kg && window.__kg.state));
  console.log(logs.slice(0, 30).join('\n'));
  await b.close(); srv.close();
})();
