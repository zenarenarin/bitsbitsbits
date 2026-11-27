// Intro frame of every level: node dev/gallery.js <outdir> [levels]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const which = (process.argv[3] || '0,1,2,3,4,5,6,7').split(',').map(Number);
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: +(process.env.DSF || 1) });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/dev/index.html`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  for (const i of which) {
    await p.evaluate(i => __kg.goLevel(i), i);
    await p.waitForFunction(i => __kg.lv() && __kg.state === 'intro', i, { timeout: 30000 });
    await p.waitForTimeout(1300);
    await p.screenshot({ path: path.join(out, `lv${i + 1}.png`) });
  }
  await b.close(); srv.close();
})();
