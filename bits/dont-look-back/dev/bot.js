// Balance bot: plays many runs in simulation (no rendering) and reports distances and causes.
// Usage: node dev/bot.js [runs] [skill 0..1]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(d); }); }).listen(8768);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack));
  await p.goto('http://localhost:8768/dev/index.html');
  await p.waitForFunction(() => window.__dlb, null, { timeout: 60000 });
  const res = await p.evaluate(([runs, skill]) => {
    window.__dlbManual = true;
    const D = __dlb, out = [];
    for (let k = 0; k < runs; k++) {
      D.begin(false); const prevTr = window.__tr; window.__tr = [];
      let t = 0, trips = 0, hides = 0, passes = 0, searches = 0, lastState = '', maxStage = 0, exh = 0;
      while (D.mode === 'play' && t < 900) {
        const r = D.run, M = r.M, hw = 2.7;
        let hold = true;
        // steer: look for blocking obstacles ahead and pick a free lane
        const ahead = D.W.obstacles.filter(o => !o.low && o.s > r.s - 0.5 && o.s - r.s < 12 + (1 - skill) * -6).sort((a, b) => a.s - b.s)[0];
        if (ahead) {
          const cands = []; for (let u = -2.4; u <= 2.4; u += 0.2) if (!ahead.blocks.some(bk => u + 0.45 > bk[0] && u - 0.45 < bk[1])) cands.push(u);
          if (cands.length) { cands.sort((a, b) => Math.abs(a - r.u) - Math.abs(b - r.u)); r.uT = cands[0]; }
        } else if (Math.random() < 0.02) r.uT = (Math.random() - 0.5) * 2;
        const hidden = r.state === 'hide' || r.state === 'toHide';
        const cover = D.W.coverNear(r.s, r.u);
        // lean toward the side of upcoming cover when under pressure
        const nextCover = D.W.spots.find(sp => sp.s > r.s + 2 && sp.s < r.s + 25);
        const pressure = (M.mode === 'stalk' && M.gap < 22) || r.stamina < 35;
        if (!ahead && nextCover && pressure) r.uT = Math.sign(nextCover.objU) * 1.6;
        if (!hidden && cover && pressure && !(M.mode === 'stalk' && M.gap < 5.5)) hold = false;
        if (hidden) {
          const win = 7.8 - 2.8 * Math.min(1, r.s / 2600);
          const safe = M.mode === 'lost' || (M.mode === 'stalk' && M.gap > 16 && r.hideT > 2.5 && r.stamina > 90) || M.mode === 'search' || (M.mode === 'pass' && M.gap < -12.5);
          hold = safe || (r.hideT > win * (0.6 + skill * 0.3) && M.mode !== 'pass' && !(M.mode === 'stalk' && M.gap < 14));
          if (M.mode === 'pass' && Math.abs(M.gap) < 12) hold = false;
        }
        if (r.state !== lastState) { if (r.state === 'trip') trips++; if (r.state === 'toHide') hides++; lastState = r.state; }
        if (M.mode === 'pass' && !r._p) { passes++; r._p = 1; } if (M.mode !== 'pass') r._p = 0;
        if (M.mode === 'search' && !r._q) { searches++; r._q = 1; } if (M.mode !== 'search') r._q = 0;
        if (r.exhausted && !r._e) { exh++; r._e = 1; } if (!r.exhausted) r._e = 0;
        D.advance(1 / 15, hold, true);
        if (Math.round(t * 15) % 6 === 0) (window.__tr = window.__tr || []).push(`t=${t.toFixed(1)} s=${r.s.toFixed(0)} u=${r.u.toFixed(1)} st=${r.stamina.toFixed(0)}${r.exhausted ? 'X' : ''} ${r.state} hold=${hold} ${M.mode}:${M.gap.toFixed(1)} hideT=${r.hideT.toFixed(1)} cover=${!!cover} next=${nextCover ? (nextCover.s - r.s).toFixed(0) : '-'}`);
        t += 1 / 15; maxStage = Math.max(maxStage, r.stage);
      }
      if (!out.length || Math.floor(D.run.s) < Math.min(...out.map(o => o.dist))) window.__worst = window.__tr.slice(-45);
      out.push({ dist: Math.floor(D.run.s), t: Math.round(t), reason: D.run.reason, trips, hides, passes, searches, exh, stage: maxStage + 1 });
    }
    out.trace = window.__worst || []; return { out, trace: out.trace };
  }, [+(process.argv[2] || 8), +(process.argv[3] || 0.8)]);
  if (process.env.TRACE) console.log(res.trace.join('\n'));
  const rs = res.out;
  for (const r of rs) console.log(JSON.stringify(r));
  const d = rs.map(r => r.dist).sort((a, b) => a - b);
  console.log('median', d[d.length >> 1], 'min', d[0], 'max', d[d.length - 1]);
  if (errs.length) console.log(errs.join('\n'));
  await b.close(); srv.close();
})();
