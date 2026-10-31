const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const server = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'font/ttf' }); s.end(d); }); }).listen(0);
(async () => {
  for (const args of [[], ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ['--enable-gpu', '--ignore-gpu-blocklist']]) {
    const b = await chromium.launch({ args });
    const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: +(process.argv[2] || 1) });
    await p.goto(`http://localhost:${server.address().port}/dev/index.html`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 30000 });
    const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); })(); }));
    const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
    console.log(JSON.stringify(args), fps, gl);
    await b.close();
  }
  server.close();
})();
