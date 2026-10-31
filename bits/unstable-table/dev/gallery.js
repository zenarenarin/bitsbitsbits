// Renders every object sprite large on the backdrop colour: node dev/gallery.js <out.png>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 1 });
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready);
  await pg.evaluate(() => {
    window.__paused = true;
    const U = window.__UT, A = U.A;
    const c = document.createElement('canvas'); c.width = 1000; c.height = 1100; c.style.cssText = 'position:fixed;inset:0;z-index:9';
    document.body.appendChild(c);
    const g = c.getContext('2d');
    g.fillStyle = '#4a1420'; g.fillRect(0, 0, 1000, 1100);
    U.OBJECTS.forEach((o, i) => {
      const spr = A.objs[o.id].spr;
      const col = i % 5, row = Math.floor(i / 5);
      const x = 100 + col * 200, y = 230 + row * 260;
      const k = 190 / spr.R;
      g.save(); g.translate(x, y); g.scale(k, k); g.drawImage(spr.canvas, -spr.ox, -spr.oy); g.restore();
      g.fillStyle = '#f3e6c8'; g.font = '14px Georgia'; g.textAlign = 'center'; g.fillText(o.name + ' · ' + o.weight, x, y + 22);
    });
  });
  await pg.screenshot({ path: process.argv[2] || '/tmp/gallery.png' });
  await b.close(); srv.close();
})();
