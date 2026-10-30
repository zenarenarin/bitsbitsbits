// Screenshots of every kind of hiding place: within reach (HIDE tag and glint), then hidden with it searching.
// node dev/spots.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-spots';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
  for (const type of ['corn', 'hay', 'cart', 'tree', 'shed']) {
    await pg.evaluate((type) => {
      __hh.reset(); __hh.begin(); __hh.advance(0.1, true); __hh.advance(2, true);
      const r = __hh.run; let z, n = 0;
      while (!(z = __hh.world.feats.find(f => f.k === 'hide' && f.type === type && f.x0 > r.dist + 2)) && n++ < 200) { r.dist += 40; __hh.world.update(r.dist, 0, 0); }
      for (const f of __hh.world.feats) if (f.obs && Math.abs(f.x0 - z.x0) < 6) { f.done = f.hit = true; f.x0 += 30; f.x1 += 30; }
      r.dist = r.score = z.x0 - Math.max(0, z.radius) + 0.2; r.c.gap = 16; r.c.mode = 'hunt'; r.stamina = 40;
      __hh.advance(1 / 60, true); __hh.hold(true);
    }, type);
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: `${out}/${type}_reach.png` });
    await pg.evaluate(() => { __hh.advance(0.4, false); let n = 0; while (__hh.run.c.mode !== 'sweep' && n++ < 600) __hh.advance(1 / 60, false); __hh.advance(0.5, false); __hh.hold(false); __hh.pause(); __hh.resume(); });
    await pg.evaluate(() => __hh.pause());
    await pg.evaluate(() => { __hh.resume(); });
    await pg.waitForTimeout(60);
    await pg.screenshot({ path: `${out}/${type}_hidden.png` });
  }
  console.log('errors', errs); await b.close(); srv.close();
});
