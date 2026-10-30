// Screenshots of each stage, a landscape desktop window and a small phone, plus a real-touch hold/release check.
// node dev/stages.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const url = `http://localhost:${srv.address().port}/dev/index.html`;
  const b = await chromium.launch(); const errs = [];
  let pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(url); await pg.waitForTimeout(500);
  for (const d of [200, 330, 520]) {
    await pg.evaluate((d) => { __hh.reset(); __hh.begin(); __hh.advance(0.2, true); const r = __hh.run; r.t = 60; r.dist = d; r.c.mode = 'investigate'; r.a = 45; r.lkp = d; __hh.world.reset(5); __hh.world.genX = d; __hh.world.update(d, 0.5, 2); r.c.x = d - 16; r.lkp = d; __hh.advance(1, true); }, d);
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${out}/stage_${d}.png` });
  }
  // real touch: tap ENTER, then hold with a finger and release
  await pg.evaluate(() => { __hh.hold(false); __hh.reset(); }); await pg.waitForTimeout(500);
  await pg.touchscreen.tap(195, 700); await pg.waitForTimeout(100);
  const m1 = await pg.evaluate(() => __hh.mode);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 500 }] });
  await pg.waitForTimeout(1200);
  const held = await pg.evaluate(() => ({ act: __hh.run.act, speed: __hh.run.speed, st: __hh.run.stamina, dist: __hh.run.dist }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pg.waitForTimeout(600);
  const rel = await pg.evaluate(() => ({ act: __hh.run.act, speed: __hh.run.speed }));
  console.log('touch', m1, held, rel);
  // pause button
  await pg.touchscreen.tap(380, 40); await pg.waitForTimeout(100);
  console.log('after pause tap', await pg.evaluate(() => __hh.mode));
  await pg.screenshot({ path: `${out}/paused.png` });
  await pg.close();
  for (const [w, h, dpr, name] of [[1440, 900, 1, 'desktop'], [360, 640, 2, 'smallphone']]) {
    pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    pg.on('pageerror', e => errs.push(String(e)));
    await pg.goto(url); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${out}/${name}_title.png` });
    console.log(name, await pg.evaluate(() => __hh.size()));
    await pg.close();
  }
  console.log('errors', errs); await b.close(); srv.close();
});
