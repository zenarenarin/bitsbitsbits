// A balancing bot: places each arriving object where it best cancels the
// current torque (stacking on what is there), to chart how long a careful
// player lasts. node dev/bot.js [runs]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
(async () => {
  const runs = +process.argv[2] || 6;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 402, height: 874 } });
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready);
  const res = await pg.evaluate(async runs => {
    const U = window.__UT;
    U.loop.stop && U.loop.stop();
    window.__paused = true;
    const out = [];
    for (let k = 0; k < runs; k++) {
      if (k > 0) { U.run.state = 'over'; }
      if (U.run.state !== 'playing') { U.restart(); }
      const log = [];
      let guard = 0;
      while (U.run.state === 'playing' && guard++ < 400) {
        U.step(30);
        if (!U.run.tray.length) continue;
        const item = U.run.tray.shift();
        const def = item.def;
        const P = U.sim.P;
        const { torque } = U.sim.loadTorque();
        // try spots along the table: keep the net torque small, avoid tall stacks
        let best = null;
        for (let cx = -1.35; cx <= 1.351; cx += 0.09) {
          const hw = (def.box[2] - def.box[0]) * 0.35;
          let h = -1e9;
          for (const dx of [-hw, 0, hw]) { const hit = U.sim.supportBelow(cx + dx, 3.5); if (hit) h = Math.max(h, hit.y); }
          const rise = h - U.sim.surfaceY(cx);
          const cost = Math.abs(torque + def.mass * P.g * cx) / (def.mass * P.g) + rise * 3;
          if (!best || cost < best.cost) best = { x: cx, y: h + 0.02, cost };
        }
        const x = best.x, y = best.y;
        U.place(def.id, x, y - U.sim.surfaceY(x));
        log.push(def.id + '@' + x.toFixed(2));
        U.step(150);
      }
      out.push({ placed: U.run.placed, points: U.run.points, cause: U.run.cause, maxStreak: U.run.bestStreak, seq: log.join(' ') });
    }
    return out;
  }, runs);
  for (const r of res) console.log(`placed ${r.placed}  points ${r.points}  streak ${r.maxStreak}  ${r.cause}\n   ${r.seq}`);
  await b.close(); srv.close();
})();
