// Frozen screenshots of the situations that matter for readability: running with the HUD, each hiding
// interaction while it searches beside you, a check aimed at your cover, a close chase, exhaustion.
// node dev/look.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-look';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(400);
  await pg.evaluate(() => {
    window.S = {
      start() { __hh.freeze(false); __hh.reset(); __hh.begin(); __hh.advance(0.1, true); __hh.advance(1.6, true); },
      at(type) {
        const r = __hh.run; let z = null, n = 0;
        while (!(z = __hh.world.feats.find(f => f.k === 'hide' && f.type === type && f.x0 > r.dist + 2)) && n++ < 200) { r.dist += 40; r.score = r.dist; __hh.world.update(r.dist, 0, 0); }
        const shift = z.x0 + 0.4 - r.dist; r.dist += shift; r.score = Math.max(r.score, r.dist); r.c.x += shift; r.act = 'run'; r.speed = 4; r.hideT = 0;
        for (const f of __hh.world.feats) if (f.obs && Math.abs(f.x0 - z.x0) < 10) { f.done = f.hit = true; f.x0 += 40; f.x1 += 40; }
        return z;
      }
    };
  });
  const shots = {
    run: () => { S.start(); __hh.advance(3, true); },
    corn_search: () => { S.start(); S.at('corn'); const r = __hh.run; __hh.advance(0.5, false); r.a = 55; r.lkp = r.dist - 2; r.c.mode = 'investigate'; r.c.x = r.dist - 9; let n = 0; while (r.c.mode !== 'search' && n++ < 400) __hh.advance(1 / 60, false); __hh.advance(0.4, false); },
    hay_check: () => { S.start(); S.at('hay'); const r = __hh.run; __hh.advance(0.5, false); r.a = 60; r.lkp = r.dist; r.c.mode = 'investigate'; r.c.x = r.dist - 8; let n = 0; while (!(r.targeted && r.c.reachT > 0.4) && n++ < 900) __hh.advance(1 / 60, false); },
    cart_hidden: () => { S.start(); S.at('cart'); const r = __hh.run; __hh.advance(0.6, false); r.c.mode = 'investigate'; r.a = 45; r.lkp = r.dist - 3; r.c.x = r.dist - 10; __hh.advance(1.0, false); },
    shed_hidden: () => { S.start(); S.at('shed'); __hh.advance(0.8, false); },
    chase: () => { S.start(); const r = __hh.run; r.c.mode = 'chase'; r.a = 90; r.c.x = r.dist - 6; __hh.advance(0.3, true); },
    exhausted: () => { S.start(); const r = __hh.run; r.stamina = 0; r.tired = true; for (const f of __hh.world.feats) if (f.k === 'hide') { f.x0 += 500; f.x1 += 500; } __hh.advance(0.8, true); }
  };
  for (const [name, fn] of Object.entries(shots)) {
    await pg.evaluate(`(${fn.toString()})()`);
    await pg.evaluate(() => __hh.freeze(true));
    await pg.waitForTimeout(120);
    await pg.screenshot({ path: `${out}/${name}.png` });
    console.log(name, await pg.evaluate(() => ({ ps: __hh.playerState(), cs: __hh.creatureState(), a: Math.round(__hh.run.a), gap: +__hh.gapNow().toFixed(1), targeted: __hh.run.targeted })));
  }
  console.log('errors', errs); await b.close(); srv.close();
});
