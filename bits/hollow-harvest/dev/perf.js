// Frame cost while a bot plays in real time, at phone size, with the CPU throttled to approximate a
// mid-range phone.  node dev/perf.js [throttle=4]
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), RATE = +process.argv[2] || 4;
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  const res = await pg.evaluate(() => new Promise(done => {
    __hh.reset(); __hh.begin(); __hh.hold(true);
    const p = __hh.perf; p.frames = 0; p.simMs = 0; p.drawMs = 0;
    const gaps = []; let last = performance.now(), heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const loop = now => {
      gaps.push(now - last); last = now;
      const r = __hh.run;
      // keep it alive and moving: hide when low, go when it leaves
      if (__hh.mode === 'PLAYING') __hh.hold(!(r.inZone && r.stamina < 50 && r.c.gap > 3.5) && !(r.act === 'hide' && r.stamina < 95 && !r.exposed));
      if (__hh.mode === 'GAME_OVER' || __hh.mode === 'CAUGHT') { __hh.reset(); __hh.begin(); __hh.hold(true); }
      if (gaps.length < 600) requestAnimationFrame(loop);
      else {
        gaps.sort((a, b) => a - b);
        done({ frames: p.frames, simMs: +(p.simMs / p.frames).toFixed(2), drawMs: +(p.drawMs / p.frames).toFixed(2),
          frameP50: +gaps[300].toFixed(1), frameP95: +gaps[570].toFixed(1), frameMax: +gaps[599].toFixed(1),
          heapGrowthKB: performance.memory ? Math.round((performance.memory.usedJSHeapSize - heap0) / 1024) : null });
      }
    };
    requestAnimationFrame(loop);
  }));
  console.log('cpu throttle x' + RATE, res);
  await b.close(); srv.close();
});
