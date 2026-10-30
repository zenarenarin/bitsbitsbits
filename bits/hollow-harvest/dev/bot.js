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
      // walk everywhere; hold only to get through cover without stopping
      walker: (r) => !!r.inZone,
      // hide in the first cover and never come out
      camper: (r) => r.act !== 'hide' && !r.inZone,
      // a sensible player, using only what the screen shows: the creature's behaviour, the labels, stamina
      smart: (r, w) => {
        const cs = __hh.creatureState(), gap = __hh.gapNow(), ob = w.nextObstacle(r.dist), ahead = ob ? ob.x0 - r.dist : 99;
        if (r.act === 'hide') {
          const away = cs === 'LOSING_INTEREST' || cs === 'RETURNING' || (cs === 'FOLLOWING' && gap > 18);
          return away && (r.stamina > 70 || r.overtime);
        }
        if (ob && ob.k === 'snag' && ahead < 2.2 && ahead > -0.5) return false;
        if (w.feats.some(f => f.k === 'crows' && !f.done && f.x0 - r.dist < 2.5 && f.x0 > r.dist)) return false;
        if (r.inZone && !(cs === 'CHASING' && gap < 4) && (r.stamina < 45 || cs === 'INVESTIGATING' || cs === 'CHASING' || cs === 'SEARCHING')) return false;
        return true;
      }
    };
    const out = {};
    for (const name in policies) {
      const res = [];
      for (let i = 0; i < RUNS; i++) {
        __hh.reset(); __hh.begin(); let n = 0; const causes = {};
        while ((__hh.mode === 'PLAYING' || __hh.mode === 'STARTING') && n++ < 60 * 300) { const r = __hh.run; __hh.advance(1 / 60, policies[name](r, __hh.world)); }
        const R = __hh.run; res.push({ t: +R.t.toFixed(1), d: Math.floor(R.score), hits: R.hits, esc: R.escapes, finds: R.finds, cause: R.cause, dbg: R.cause ? '' : [R.act, R.speed.toFixed(2), R.c.mode, R.c.gap.toFixed(1), R.hideT.toFixed(1), R.stamina.toFixed(2), !!R.inZone].join(' ') });
      }
      out[name] = res;
    }
    return out;
  }, RUNS);
  for (const k in res) { const ts = res[k].map(r => r.t), ds = res[k].map(r => r.d); console.log(k.padEnd(12), 'time', Math.min(...ts), '-', Math.max(...ts), 'avg', (ts.reduce((a, b) => a + b) / ts.length).toFixed(1), '| dist avg', (ds.reduce((a, b) => a + b) / ds.length) | 0, '| hits', (res[k].reduce((a, r) => a + r.hits, 0) / res[k].length).toFixed(1), 'passes', (res[k].reduce((a, r) => a + r.esc, 0) / res[k].length).toFixed(1), '|', res[k].map(r => r.cause[0]).join('')); }
  for (const k in res) for (const r of res[k]) if (r.dbg) console.log(k, r.dbg);
  console.log('errors', errs); await b.close(); srv.close();
});
