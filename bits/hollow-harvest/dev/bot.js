// Balance check: several policies play many runs through the real step function.
// node dev/bot.js [runs]
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), RUNS = +process.argv[2] || 12;
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
  const res = await pg.evaluate((RUNS) => {
    const policies = {
      holdForever: () => true,
      neverHold: () => false,
      smart: (r, w) => {
        const c = r.c, ob = w.nextObstacle(r.dist), ahead = ob ? ob.x0 - r.dist : 99, P = __hh.pursuit();
        if (r._leaving) { if (!r.inZone || c.gap > 14) r._leaving = false; else return true; }
        if (r.act === 'hide') {
          const safe = __hh.safeTime(r.spot);
          if (r.exposed) return (r._leaving = true);
          if (c.mode === 'withdraw' || c.mode === 'linger') return (r._leaving = r.stamina > 85 || r.hideT > safe - 0.6);
          if (c.mode === 'approach' && c.gap > 14 && r.stamina > 85) return (r._leaving = true);
          return false;
        }
        if (ob && ob.k === 'snag' && ahead < 2.2 && ahead > -0.5) return false;
        const cr = w.feats.find(f => f.k === 'crows' && !f.done && f.x0 - r.dist < 2.5 && f.x0 > r.dist);
        if (cr) return false;
        if (r.inZone && c.gap > 3.2) {
          // close: only cover that outlasts its approach and sweep; low on breath: any cover, leave when it fails
          const need = 1.2 + Math.max(0, c.gap - 6) / 4 + 1.5;
          if (P < 40 && (__hh.safeTime(r.inZone) > need || r.tired)) return false;
          if (r.stamina < 60) return false;
        }
        return true;
      }
    };
    const out = {};
    for (const name in policies) {
      const res = [];
      for (let i = 0; i < RUNS; i++) {
        __hh.reset(); __hh.begin(); let n = 0; const causes = {};
        while ((__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 60 * 400) { const r = __hh.run; __hh.advance(1 / 60, policies[name](r, __hh.world)); }
        const R = __hh.run; res.push({ t: +R.t.toFixed(1), d: Math.floor(R.score), hits: R.hits, esc: R.escapes, cause: R.cause, dbg: R.cause ? '' : [R.act, R.speed.toFixed(2), R.c.mode, R.c.gap.toFixed(1), R.hideT.toFixed(1), R.stamina.toFixed(2), !!R.inZone].join(' ') });
      }
      out[name] = res;
    }
    return out;
  }, RUNS);
  for (const k in res) { const ts = res[k].map(r => r.t), ds = res[k].map(r => r.d); console.log(k.padEnd(12), 'time', Math.min(...ts), '-', Math.max(...ts), 'avg', (ts.reduce((a, b) => a + b) / ts.length).toFixed(1), '| dist avg', (ds.reduce((a, b) => a + b) / ds.length) | 0, '| hits', (res[k].reduce((a, r) => a + r.hits, 0) / res[k].length).toFixed(1), 'passes', (res[k].reduce((a, r) => a + r.esc, 0) / res[k].length).toFixed(1), '|', res[k].map(r => r.cause[0]).join('')); }
  for (const k in res) for (const r of res[k]) if (r.dbg) console.log(k, r.dbg);
  console.log('errors', errs); await b.close(); srv.close();
});
