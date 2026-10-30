// Record ~22 s of real-time play (title, then a bot run) at phone size.  node dev/clip.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-clip';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 780, height: 1688 } } });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`);
  await pg.waitForTimeout(2200);
  await pg.evaluate(() => {
    __hh.begin();
    // a player who runs, hides late when it is close, waits for it to turn away, then goes
    let leaving = false;
    const loop = () => {
      const r = __hh.run, c = r.c, w = __hh.world;
      if (__hh.mode !== 'play') return;
      const ob = w.nextObstacle(r.dist), ahead = ob ? ob.x0 - r.dist : 99;
      let hold = true;
      if (leaving) { if (!r.inZone || c.gap > 14) leaving = false; }
      else if (r.act === 'hide') hold = leaving = c.mode === 'leave' || c.mode === 'lost' || r.hideT > 4.6;
      else if (ob && ob.k === 'snag' && ahead < 2.2 && ahead > -0.5) hold = false;
      else if (r.inZone && (c.gap < 12 || r.stamina < 0.45) && c.gap > 3.2) hold = false;
      __hh.hold(hold);
      requestAnimationFrame(loop);
    };
    loop();
  });
  await pg.waitForTimeout(20500);
  console.log(await pg.evaluate(() => ({ mode: __hh.mode, dist: __hh.run.dist | 0, t: __hh.run.t })));
  await ctx.close(); await b.close(); srv.close();
  console.log(fs.readdirSync(out));
});
