const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(d); }); }).listen(8767);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.stack)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8767/dev/index.html');
  await p.waitForFunction(() => window.__dlb || window.__initError, null, { timeout: 60000 });
  const r = await p.evaluate(process.argv[2] ? new Function('return (' + fs.readFileSync(process.argv[2], 'utf8') + ')()') : () => 0);
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  console.log(errs.join('\n'));
  await b.close(); srv.close();
})();
