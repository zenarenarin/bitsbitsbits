// End-to-end run in headless Chromium against the dev harness, with the game
// loop stepped manually at 60 Hz so timing is deterministic on software GL.
// node dev/play.test.js [outdir] [rounds]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(__dirname, 'out');
const ROUNDS = +(process.argv[3] || 9);
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const server = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(0);
const port = server.address().port;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}/dev/index.html?manual`);
  await page.waitForFunction(() => window.__ready && window.__SD && window.__loopUpdate, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);

  // In-page helpers: step(seconds, bot) advances the real loop at 60 Hz.
  await page.evaluate(() => {
    const cv = document.querySelector('#bit canvas');
    window.__tapAt = (x, y) => {
      const rect = cv.getBoundingClientRect();
      const o = { clientX: rect.left + x, clientY: rect.top + y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
      cv.dispatchEvent(new PointerEvent('pointerdown', o));
      cv.dispatchEvent(new PointerEvent('pointerup', o));
    };
    window.__tapRing = (r, ang) => { const p = __SD.ringScreenPoint(r, ang == null ? 200 : ang); __tapAt(p.x, p.y); };
    window.__bot = { mode: 'off', taps: 0, errs: [], misses: 0 };
    function botTick() {
      const b = __bot;
      if (b.mode === 'off' || __SD.G.phase !== 'play' || __SD.G.paused) return;
      for (const r of __SD.rings) {
        if (!r.alive) continue;
        if (b.mode === 'hit' && r.state === 'missed') { __tapRing(r); b.taps++; continue; }
        if (r.state !== 'spin') continue;
        const pred = __SD.Logic.wrap180(r.angle + __SD.Logic.brakeTravel(r.vel));
        if (b.mode === 'hit' && Math.abs(pred) <= Math.abs(r.vel) * 0.0084 + 0.02) { __tapRing(r); b.taps++; b.errs.push(Math.abs(pred)); }
        if (b.mode === 'miss' && Math.abs(pred) > 60 && Math.abs(pred) < 120) { __tapRing(r); b.taps++; b.mode = 'off'; b.misses++; return; }
      }
    }
    window.__step = (secs, until) => {
      window.__SD_SKIP_RENDER = true;
      const n = Math.round(secs * 60);
      for (let i = 0; i < n; i++) { botTick(); __loopUpdate(1000 / 60); if (until && until()) break; }
      window.__SD_SKIP_RENDER = false;
      __loopUpdate(0.0001); // render one frame
    };
  });
  const step = (s, until) => page.evaluate(([s, u]) => __step(s, u ? new Function('return (' + u + ')') : null), [s, until || null]);
  const shot = async name => { await page.waitForTimeout(80); await page.screenshot({ path: path.join(out, name) }); };
  const G = () => page.evaluate(() => ({ phase: __SD.G.phase, round: __SD.G.round, score: __SD.G.score, roundMisses: __SD.G.roundMisses, aligned: __SD.G.aligned, n: __SD.rings.filter(r => r.alive).length, total: __SD.rings.length, streak: __SD.G.streak, states: __SD.rings.map(r => r.state), vels: __SD.rings.map(r => r.vel), base: __SD.rings.map(r => r.baseVel) }));

  await step(2.6);
  await shot('01-intro.png');
  let g = await G();
  ok(g.phase === 'intro' && g.n === 3, 'intro shows three rings');
  ok(g.vels.every(v => Math.abs(v) > 1), 'intro rings have begun rotating');
  await page.evaluate(() => __tapRing(__SD.rings[0]));
  ok((await G()).states.every(s => s === 'idle'), 'intro ignores ring taps');

  await page.tap('.sd-play');
  await step(1.4);
  g = await G();
  ok(g.round === 1 && g.n === 3, 'round 1 has 3 rings');
  ok(g.base.join() === '42,-61,83', 'round 1 speeds 42 / -61 / 83');
  ok(g.phase === 'play', 'play phase after the intro transition');
  ok(new Set(g.vels.map(v => Math.round(v))).size === 3, 'rings rotate independently: ' + g.vels.map(v => v.toFixed(0)).join(' / '));
  await shot('02-round1.png');

  // Hit testing: each ring's band selects that ring only.
  const hit = await page.evaluate(() => {
    const res = [];
    const alive = __SD.rings.filter(r => r.alive);
    alive.forEach((r, k) => {
      for (const f of [0.05, 0.5, 0.95]) {
        const pitch = (__SD.L.R - __SD.L.hubR) / alive.length;
        const d = __SD.L.R - (k + f) * pitch;
        for (const a of [0, 77, 190, 300]) {
          const x = __SD.L.cx + Math.sin(a * Math.PI / 180) * d, y = __SD.L.cy - Math.cos(a * Math.PI / 180) * d;
          res.push(__SD.ringAtPoint(x, y) === r);
        }
      }
    });
    const outside = __SD.ringAtPoint(__SD.L.cx, __SD.L.cy - __SD.L.R - 40) === null && __SD.ringAtPoint(__SD.L.cx, __SD.L.cy) === null;
    return { all: res.every(Boolean), outside };
  });
  ok(hit.all, 'radial hit testing selects exactly the tapped ring');
  ok(hit.outside, 'taps outside the sculpture or on the hub select nothing');

  // A deliberate miss, then release.
  await page.evaluate(() => { __bot.mode = 'miss'; });
  await step(6, "__SD.rings.some(r => r.state === 'missed')");
  g = await G();
  const missed = await page.evaluate(() => { const r = __SD.rings.find(r => r.state === 'missed'); return { a: r.angle, err: Math.abs(__SD.Logic.wrap180(r.angle)), tag: document.querySelector('.sd-readout').textContent }; });
  ok(g.roundMisses === 1 && missed.err > 6, 'off-axis stop is a miss (' + missed.err.toFixed(1) + '°), one mistake counted');
  await step(1.5);
  await shot('03-missed.png');
  const still = await page.evaluate(() => { const r = __SD.rings.find(r => r.state === 'missed'); return r ? r.angle : null; });
  ok(still === missed.a, 'missed ring stays put until tapped');
  ok(await page.evaluate(() => document.querySelector('.sd-hint').textContent.includes('AGAIN')), 'release hint after a miss');
  await page.evaluate(() => __tapRing(__SD.rings.find(r => r.state === 'missed')));
  await step(0.5);
  ok((await G()).states.every(s => s === 'spin'), 'tapping the missed ring releases it');

  // Braking is a visible deceleration.
  const brake = await page.evaluate(() => {
    const r = __SD.rings.find(x => x.state === 'spin');
    const v0 = r.vel; __tapRing(r);
    const samples = [];
    for (let i = 0; i < 16; i++) { __loopUpdate(1000 / 60); samples.push(r.vel); }
    return { v0, samples, state: r.state };
  });
  const mono = brake.samples.every((v, i, a) => i === 0 || Math.abs(v) <= Math.abs(a[i - 1]) + 1e-9);
  const frames = brake.samples.findIndex(v => v === 0);
  ok(mono && frames >= 9 && frames <= 16, 'brake eases to rest over ' + Math.round(frames * 16.7) + ' ms');
  await step(0.6);
  await page.evaluate(() => { __SD.G.roundMisses = 0; }); // the brake probe may have missed; keep the run alive
  if ((await G()).states.includes('missed')) { await page.evaluate(() => __tapRing(__SD.rings.find(r => r.state === 'missed'))); await step(0.5); }

  // Rapid duplicate taps on one ring register once.
  const dup = await page.evaluate(() => {
    const r = __SD.rings.find(x => x.state === 'spin');
    const before = __SD.G.roundMisses + __SD.G.aligned;
    for (let i = 0; i < 5; i++) __tapRing(r);
    for (let i = 0; i < 30; i++) __loopUpdate(1000 / 60);
    const after = __SD.G.roundMisses + __SD.G.aligned;
    if (r.state === 'missed') __tapRing(r);
    return after - before;
  });
  ok(dup === 1, 'five rapid taps on one ring register a single stop');
  await page.evaluate(() => { __SD.G.roundMisses = 0; });
  await step(0.5);

  // 0/360 boundary: a ring braked to stop at -1.5° (i.e. 358.5°) locks.
  await step(3, "__SD.rings.some(r => r.state === 'spin')");
  const boundary = await page.evaluate(() => {
    const r = __SD.rings.find(x => x.state === 'spin');
    const travel = __SD.Logic.brakeTravel(r.vel);
    r.angle = 358.5 - travel + 720; // lands at 358.5 + 2 turns
    const s0 = __SD.G.score;
    r.state = 'spin'; __tapRing(r);
    for (let i = 0; i < 30; i++) __loopUpdate(1000 / 60);
    return { state: r.state, angle: r.angle, gained: __SD.G.score - s0 };
  });
  ok(boundary.state === 'locked' && Math.abs(boundary.angle) < 1e-9, 'stop at 358.5° locks and settles exactly on the axis');
  ok(boundary.gained >= 170, 'precision bonus applied across the boundary (+' + boundary.gained + ')');
  const lockedA = boundary.angle;
  await step(1.0);
  ok(await page.evaluate(a => __SD.rings.find(r => r.state === 'locked').angle === a, lockedA), 'locked ring remains stationary');
  await page.evaluate(() => __tapRing(__SD.rings.find(r => r.state === 'locked')));
  ok(await page.evaluate(() => __SD.rings.some(r => r.state === 'locked')), 'tapping a locked ring does nothing');

  // Perfect play for several rounds.
  await page.evaluate(() => { __bot.mode = 'hit'; });
  const counts = {}, tols = {};
  let shot5 = false, shotC = false, shotHud = false;
  for (let i = 0; i < 4000; i++) {
    await step(0.25);
    g = await page.evaluate(() => ({ phase: __SD.G.phase, round: __SD.G.round, n: __SD.rings.filter(r => r.alive).length, ct: __SD.G.completeT, tol: __SD.G.tol, aligned: __SD.G.aligned }));
    if (g.phase === 'play' && counts[g.round] === undefined) { counts[g.round] = g.n; tols[g.round] = g.tol; }
    if (!shotHud && g.round === 2 && g.phase === 'play' && g.aligned >= 2) { await shot('04-round2-hud.png'); shotHud = true; }
    if (!shot5 && g.round === 5 && g.phase === 'play' && g.aligned >= 1) { await shot('05-round5.png'); shot5 = true; }
    if (!shotC && g.round >= 3 && g.phase === 'complete') {
      await page.evaluate(() => __step(0.3)); await shot('06-complete.png'); shotC = true;
    }
    if (g.phase === 'over' || g.round > ROUNDS) break;
  }
  const prog = await page.evaluate(() => ({ round: __SD.G.round, score: __SD.G.score, phase: __SD.G.phase, host: window.__hostScore, errs: __bot.errs, streak: __SD.G.streak }));
  ok(prog.phase !== 'over' && prog.round > ROUNDS, 'perfect play clears ' + (prog.round - 1) + ' rounds, score ' + prog.score + ', streak ' + prog.streak);
  const rs = Object.keys(counts).map(Number).sort((a, b) => a - b);
  ok(rs.every((r, i) => i === 0 || counts[r] === Math.min(counts[rs[i - 1]] + 1, 10) || counts[r] === counts[rs[i - 1]]), 'ring counts per round: ' + rs.map(r => counts[r]).join(','));
  ok(rs.every((r, i) => i === 0 || tols[r] < tols[rs[i - 1]]), 'tolerance tightens: ' + rs.map(r => tols[r].toFixed(2)).join(','));
  ok(prog.host === prog.score, 'host score track mirrors the score');
  await shot('07-late.png');

  // Pause.
  await page.evaluate(() => { __bot.mode = 'off'; });
  await step(2, "__SD.G.phase === 'play'");
  await page.tap('.sd-pause');
  const p1 = await page.evaluate(() => JSON.stringify(__SD.rings.map(r => r.angle)) + __SD.G.simTime);
  await step(1);
  const p2 = await page.evaluate(() => JSON.stringify(__SD.rings.map(r => r.angle)) + __SD.G.simTime);
  ok(p1 === p2, 'pause freezes the sculpture');
  await page.evaluate(() => __tapRing(__SD.rings.find(r => r.state === 'spin') || __SD.rings[0]));
  ok(await page.evaluate(() => !__SD.rings.some(r => r.state === 'brake')), 'ring taps ignored while paused');
  await shot('08-paused.png');
  await page.tap('.sd-resume');
  await step(0.5);
  ok(await page.evaluate(j => JSON.stringify(__SD.rings.map(r => r.angle)) + __SD.G.simTime !== j, p2), 'resume continues');

  // Three misses end the run.
  const scoreBefore = await page.evaluate(() => __SD.G.score);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { __bot.mode = 'miss'; });
    await step(8, "__bot.mode === 'off'");
    await step(0.4);
  }
  await step(1.2);
  const over = await page.evaluate(() => ({ phase: __SD.G.phase, shown: document.querySelector('.sd-over').classList.contains('show'), score: __SD.G.score, sub: window.__submitted, sv: window.__submittedValue, store: JSON.parse(localStorage.getItem('sdstore') || '{}'), vels: __SD.rings.map(r => r.vel) }));
  ok(over.phase === 'over' && over.shown, 'third miss in a round ends the run');
  ok(over.score === scoreBefore, 'misses add no points');
  ok(over.vels.every(v => v === 0), 'sculpture frozen at game over');
  await page.waitForTimeout(300);
  ok(over.sub === 1 && over.sv === over.score, 'score submitted once to the leaderboard');
  const st = JSON.parse(over.store['spin-doctor.v1'] || '{}');
  ok(st.best === over.score && st.bestRound >= ROUNDS && st.bestStreak > 0 && st.bestPrecision !== null && st.lastScore === over.score, 'best score, round, streak, precision and last score persisted');
  await page.waitForTimeout(700);
  await shot('09-over.png');
  ok(await page.evaluate(() => document.querySelectorAll('.sd-over-board .row').length === 3 && document.querySelector('.sd-over-board .row.me') && document.querySelector('.sd-over-rank').textContent.includes('#3')), 'result screen shows the top three and the viewer rank');
  await page.evaluate(() => __tapRing(__SD.rings[0]));
  ok((await G()).phase === 'over', 'ring taps ignored after game over');

  // Restart.
  await page.tap('.sd-restart');
  await step(1.8);
  g = await G();
  ok(g.round === 1 && g.score === 0 && g.roundMisses === 0 && g.n === 3 && g.total === 3 && g.aligned === 0 && g.streak === 0 && g.phase === 'play', 'restart resets the run: ' + JSON.stringify({ r: g.round, s: g.score, n: g.total, p: g.phase }));
  ok(g.states.every(s => s === 'spin') && g.base.join() === '42,-61,83', 'rings rotating at round-1 speeds after restart');
  await shot('10-restart.png');

  // Persistence across reload.
  await page.goto(`http://localhost:${port}/dev/index.html?manual`);
  await page.waitForFunction(() => window.__ready && window.__loopUpdate, null, { timeout: 30000 });
  ok(await page.evaluate(() => document.querySelector('.sd-intro-best').textContent.includes('BEST')), 'best score shown on the intro after reload');

  // Small phone and resize.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(400);
  await page.evaluate(() => __loopUpdate(16));
  await shot('11-small-intro.png');
  const lay = await page.evaluate(() => ({ R: __SD.L.R, cy: __SD.L.cy, max: __SD.G.maxRings }));
  ok(lay.R > 100, 'small phone: R ' + lay.R.toFixed(0) + ' px, ring cap ' + lay.max);

  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
