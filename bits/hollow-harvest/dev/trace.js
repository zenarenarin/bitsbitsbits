// Trace one smart-policy run: state every half second.  node dev/trace.js
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
  const policy = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8').match(/smart: (\(r, w\) => \{[\s\S]*?\n      \})/)[1];
  const log = await pg.evaluate((src) => {
    const pol = eval(src); __hh.reset(); __hh.begin(); const out = []; let n = 0;
    while ((__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 60 * 200) {
      const r = __hh.run; __hh.advance(1 / 60, pol(r, __hh.world));
      if (n % 30 === 0) { const z = __hh.world.feats.filter(f => f.x1 > r.dist && f.x0 < r.dist + 30).map(f => (f.type || f.k).slice(0, 2) + Math.round(f.x0 - r.dist)).join(','); out.push([r.t.toFixed(1), r.act, r.speed.toFixed(1), 'st' + r.stamina.toFixed(0), r.c.mode, 'gap' + r.c.gap.toFixed(1), 'h' + r.hideT.toFixed(1), z].join(' ')); }
    }
    out.push('END ' + __hh.run.cause + ' ' + __hh.run.act + ' ' + JSON.stringify(__hh.run.log.slice(-6))); return out;
  }, policy);
  console.log(log.join('\n')); await b.close(); srv.close();
});
