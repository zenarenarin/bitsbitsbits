// Personal best survives a reload.  node dev/persist.js
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const url = `http://localhost:${srv.address().port}/dev/index.html`;
  await pg.goto(url); await pg.waitForTimeout(400);
  const best = await pg.evaluate(() => { __hh.reset(); __hh.begin(); let n = 0; while ((__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 60 * 60) __hh.advance(1 / 60, true); return __hh.save().best; });
  await pg.reload(); await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => __hh.save().best);
  console.log('best before reload', best, 'after', after, best > 0 && best === after ? 'OK' : 'FAIL');
  await b.close(); srv.close();
});
