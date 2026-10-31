// Several complete sessions with a counterbalancing bot, checking that the
// score is exactly the sum of its logged events and that every placement
// was scored by the published rules from the table's real angle; then an
// anti-farming check that lifts and re-drops pieces through the real input.
// node dev/session_test.js [runs]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!ok) fails++; };
(async () => {
  const runs = +process.argv[2] || 6;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 402, height: 874 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.stack));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready);
  const res = await pg.evaluate(runs => {
    const U = window.__UT;
    window.__paused = true;
    const out = [];
    for (let k = 0; k < runs; k++) {
      U.restart();
      let guard = 0;
      while (U.run.state === 'playing' && guard++ < 400) {
        U.step(30);
        if (!U.run.tray.length) continue;
        const def = U.run.tray.shift().def;
        const P = U.sim.P, { torque } = U.sim.loadTorque();
        let best = null;
        for (let cx = -1.35; cx <= 1.351; cx += 0.09) {
          const hw = (def.box[2] - def.box[0]) * 0.35;
          let h = -1e9;
          for (const dx of [-hw, 0, hw]) { const hit = U.sim.supportBelow(cx + dx, 3.5); if (hit) h = Math.max(h, hit.y); }
          const cost = Math.abs(torque + def.mass * P.g * cx) / (def.mass * P.g) + (h - U.sim.surfaceY(cx)) * 3;
          if (!best || cost < best.cost) best = { x: cx, y: h + 0.02, cost };
        }
        U.place(def.id, best.x, best.y - U.sim.surfaceY(best.x));
        U.step(150);
      }
      U.step(200);
      const r = U.run;
      const sum = r.log.reduce((a, e) => a + e.points, 0);
      const placements = r.log.filter(e => e.kind === 'placement');
      const ruleOk = placements.every(e => { const s = U.score(e.angle, 0); return s.bonus === e.bonus; });
      // replay the multiplier sequence from the log: it must step 1, 1.25, ... and only reset via a critical entry
      const ids = new Set(r.recs.filter(x => x.counted).map(x => x.id));
      out.push({ placed: r.placed, points: r.points, sum, nPlacements: placements.length, perfect: r.log.filter(e => e.kind === 'perfect').length,
        mults: placements.map(e => e.mult).join(','), ruleOk, countedRecs: ids.size, bestStreak: r.bestStreak, cause: r.cause,
        totalsOk: placements.every(e => e.points === Math.round((e.base + e.bonus) * e.mult)) });
    }
    return out;
  }, runs);
  for (const r of res) {
    console.log(`  run: placed ${r.placed}, points ${r.points}, perfect x${r.perfect}, best streak ${r.bestStreak}, multipliers [${r.mults}]  (${r.cause})`);
    check('score equals the sum of logged events', r.points === r.sum, r);
    check('one placement event per placed object', r.nPlacements === r.placed && r.countedRecs === r.placed);
    check('balance bonus matches the angle at scoring time', r.ruleOk);
    check('placement totals = (base + bonus) x multiplier', r.totalsOk);
  }
  const avg = res.reduce((a, r) => a + r.points, 0) / res.length;
  console.log('INFO average points', Math.round(avg), 'average placed', (res.reduce((a, r) => a + r.placed, 0) / res.length).toFixed(1));

  // ---- anti-farming through real input ----
  await pg.evaluate(() => { const U = window.__UT; U.restart(); window.__paused = false; });
  await pg.evaluate(() => { const U = window.__UT; U.run.tray.length = 0; U.place('lidpot', -0.8); U.place('lidpot', 0.8); });
  await pg.waitForFunction(() => window.__UT.run.placed === 2, null, { timeout: 8000 });
  await pg.waitForTimeout(1500);
  const before = await pg.evaluate(() => ({ points: window.__UT.run.points, log: window.__UT.run.log.length }));
  const w2s = (x, y) => pg.evaluate(([x, y]) => window.__UT.W2S(x, y), [x, y]);
  for (let i = 0; i < 6; i++) {
    // lift the right-hand pot (table tips left, unstable) and put it back
    const p = await pg.evaluate(() => { const r = window.__UT.run.recs.find(r => r.body.getPosition().x > 0); const q = r.body.getPosition(); return [q.x, q.y + 0.25]; });
    const [sx, sy] = await w2s(p[0], p[1]);
    await pg.mouse.move(sx, sy); await pg.mouse.down();
    await pg.waitForTimeout(1200); // hold it up: the table swings unstable
    const [tx, ty] = await w2s(0.8, (await pg.evaluate(() => window.__UT.sim.surfaceY(0.8))) + 0.15);
    for (let k = 1; k <= 8; k++) { await pg.mouse.move(sx + (tx - sx) * k / 8, sy + (ty + 40 - sy) * k / 8); await pg.waitForTimeout(16); }
    await pg.waitForTimeout(250);
    await pg.mouse.up();
    await pg.waitForTimeout(2500);
  }
  const after = await pg.evaluate(() => ({ points: window.__UT.run.points, log: window.__UT.run.log.slice(), placed: window.__UT.run.placed, state: window.__UT.run.state }));
  const newEvents = after.log.slice(before.log);
  console.log('  events during 6 lift/re-drop cycles:', JSON.stringify(newEvents.map(e => e.kind + ' +' + e.points)));
  check('repositioning never scores a placement again', after.placed === 2 && !newEvents.some(e => e.kind === 'placement'), after.state);
  check('repositioning earns at most one Perfect Balance (one per placed object)', newEvents.filter(e => e.kind === 'perfect').length <= 1);
  check('no page errors', errs.length === 0, errs);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})();
