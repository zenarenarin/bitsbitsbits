const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h] of [[402, 874], [874, 402]]) {
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    const t0 = Date.now();
    await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?unlock`);
    await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    console.log(w + 'x' + h, 'ready in', Date.now() - t0, 'ms');
    await pg.waitForTimeout(1500);
    await pg.screenshot({ path: process.argv[2] + `/land${w}.png` });
    await pg.close();
  }
  await b.close(); srv.close();
})();
