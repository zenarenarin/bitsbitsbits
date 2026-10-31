// Record one whole run in real time (title, run, hide while it searches, escape, chase, catch, game over)
// at 1080x1920.  node dev/clip_full.js <outdir> [maxSeconds=60]
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-clip-full', MAX = +process.argv[3] || 60;
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  // the recorder does not scale the page, so the viewport must be exactly the video size
  const ctx = await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: 1080, height: 1920 } } });
  const pg = await ctx.newPage();
  const t0 = Date.now();
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`);
  await pg.waitForTimeout(900);
  await pg.evaluate(() => {
    window.__marks = [];
    const mark = m => window.__marks.push([+(performance.now() / 1000).toFixed(2), m]);
    __hh.begin(); mark('start');
    // run until it comes looking, hide, wait for it to give up, run on; later hide late in whatever is near
    let phase = 1;
    const loop = () => {
      const r = __hh.run, w = __hh.world, cs = __hh.creatureState(), gap = __hh.gapNow();
      if (__hh.mode !== 'PLAYING' && __hh.mode !== 'STARTING') { if (phase !== 9) { phase = 9; mark('end:' + __hh.mode + ':' + r.cause); } if (__hh.mode !== 'GAME_OVER') requestAnimationFrame(loop); else mark('gameover'); return; }
      const ob = w.nextObstacle(r.dist), ahead = ob ? ob.x0 - r.dist : 99;
      let hold = true;
      if (phase === 1 && r.inZone && (cs === 'INVESTIGATING' || cs === 'CHASING') && gap > 4) { phase = 2; mark('hide'); }
      if (phase === 2) {
        hold = false;
        if (r.act === 'hide' && (cs === 'LOSING_INTEREST' || cs === 'RETURNING')) { phase = 3; mark('escape'); }
      }
      if (phase === 3) {
        hold = true;
        if (r.inZone && cs === 'CHASING' && gap < 12 && gap > 4) { phase = 4; mark('late-hide'); }
      }
      if (phase === 4) hold = false;
      if (phase !== 2 && phase !== 4 && ob && ob.k === 'snag' && ahead < 2.2 && ahead > -0.5) hold = false;
      __hh.hold(hold);
      requestAnimationFrame(loop);
    };
    loop();
  });
  let done = false;
  while (!done && (Date.now() - t0) / 1000 < MAX) { await pg.waitForTimeout(500); done = await pg.evaluate(() => __hh.mode === 'GAME_OVER'); }
  await pg.waitForTimeout(3000);
  const marks = await pg.evaluate(() => window.__marks);
  console.log(JSON.stringify(marks), 'mode', await pg.evaluate(() => __hh.mode));
  await ctx.close(); await b.close(); srv.close();
  console.log(fs.readdirSync(out));
});
