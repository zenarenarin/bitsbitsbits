// Screenshots of the title, early run, hiding, a close chase, and game over.
// node dev/shots.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${port}/dev/index.html`);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: out + '/1_title.png' });
  await pg.evaluate(() => { __hh.reset(); __hh.begin(); });
  await pg.evaluate(() => __hh.advance(4, true));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: out + '/2_run.png' });
  // run to the first hiding place and let go inside it
  const r = await pg.evaluate(() => { const z = __hh.world.feats.find(f => f.k === 'hide' && f.type !== 'corn' && f.x0 > __hh.run.dist); while (__hh.run.dist < z.x0 + 1) __hh.advance(1 / 60, true); __hh.run.c.gap = 9; __hh.advance(0.6, false); return { act: __hh.run.act, gap: __hh.run.c.gap, mode: __hh.run.c.mode }; });
  console.log('hide', r);
  await pg.evaluate(() => __hh.hold(false));
  await pg.waitForTimeout(100);
  await pg.screenshot({ path: out + '/3_hide.png' });
  const r2 = await pg.evaluate(() => { let n = 0; while (__hh.run.c.mode !== 'sweep' && n++ < 1000) __hh.advance(1 / 60, false); return { act: __hh.run.act, gap: __hh.run.c.gap, mode: __hh.run.c.mode }; });
  console.log('search', r2);
  await pg.waitForTimeout(100);
  await pg.screenshot({ path: out + '/4_search.png' });
  // walk out in the open and let it close in
  const r3 = await pg.evaluate(() => { __hh.advance(0.1, true); let n = 0; while (__hh.run.c.gap > 4 && (__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 2000) __hh.advance(1 / 60, false); __hh.hold(false); return { gap: __hh.run.c.gap, mode: __hh.mode, act: __hh.run.act }; });
  console.log('close', r3);
  await pg.waitForTimeout(100);
  await pg.screenshot({ path: out + '/5_close.png' });
  await pg.evaluate(() => { let n = 0; while ((__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 3000) __hh.advance(1 / 60, false); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: out + '/6_caught.png' });
  await pg.waitForTimeout(1600);
  await pg.screenshot({ path: out + '/7_over.png' });
  console.log('errors', errs);
  await b.close(); srv.close();
});
