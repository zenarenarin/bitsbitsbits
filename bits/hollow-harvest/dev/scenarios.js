// Acceptance scenarios for the run / hide / awareness design, plus obstacles, states, input,
// concealment (measured on the rendered frame) and persistence.
// Mechanics run through the real simulation step; input goes through real touch and mouse events.
// node dev/scenarios.js
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
  const E = (fn, arg) => pg.evaluate(fn, arg);

  await E(() => {
    window.T = {
      start() { __hh.freeze(false); __hh.reset(); __hh.begin(); __hh.advance(0.1, true); __hh.advance(1.6, true); },
      // stand the traveller at the start of a hiding place of this kind, clear of obstacles
      at(type) {
        const r = __hh.run; let z = null, n = 0;
        while (!(z = __hh.world.feats.find(f => f.k === 'hide' && f.type === type && f.x0 > r.dist + 2)) && n++ < 200) { r.dist += 40; r.score = r.dist; __hh.world.update(r.dist, 0, 0); }
        const shift = z.x0 + 0.4 - r.dist;
        r.dist += shift; r.score = Math.max(r.score, r.dist); r.c.x += shift; r.lkp = r.dist;
        r.act = 'run'; r.speed = 4; r.hideT = 0;
        for (const f of __hh.world.feats) if (f.obs && f.x0 < r.dist + 8 && f.x1 > r.dist - 2) f.done = f.hit = true;
        return z;
      },
      st() { const r = __hh.run; return { ps: __hh.playerState(), cs: __hh.creatureState(), aw: __hh.awarenessLevel(), a: Math.round(r.a), gap: +__hh.gapNow().toFixed(2), stam: +r.stamina.toFixed(1), speed: +r.speed.toFixed(2), mode: __hh.mode, score: +r.score.toFixed(1) }; }
    };
  });

  // ---- A: continuous running ----
  const A = await E(() => {
    T.start(); const out = { a: [], gap: [], score: [], states: new Set(), tiredAt: null };
    let n = 0;
    while (__hh.mode === 'PLAYING' && n++ < 60 * 90) {
      __hh.advance(1 / 60, true); const s = T.st();
      if (n % 60 === 0) { out.a.push(s.a); out.gap.push(Math.round(s.gap)); out.score.push(Math.round(s.score)); }
      out.states.add(s.cs); if (s.ps === 'EXHAUSTED' && out.tiredAt === null) out.tiredAt = +__hh.run.t.toFixed(1);
    }
    out.states = [...out.states]; out.t = +__hh.run.t.toFixed(1); out.cause = __hh.run.cause; return out;
  });
  check('A running makes steady progress', A.score[4] > A.score[0] + 20 && A.score[8] > A.score[4] + 20, A.score.slice(0, 10));
  check('A running does not by itself bring it closer while it is unaware', A.gap[3] >= A.gap[0], A.gap.slice(0, 6));
  check('A running raises its awareness', A.a[8] > A.a[1] + 10, A.a.slice(0, 14));
  check('A it investigates and then chases', A.states.includes('INVESTIGATING') && A.states.includes('CHASING'), A.states);
  check('A exhaustion comes before the catch', A.tiredAt !== null && A.tiredAt < A.t, { tiredAt: A.tiredAt, caughtAt: A.t });

  // ---- B: walking ----
  const B = await E(() => {
    // no cover on this stretch, so letting go can only mean walking
    T.start(); for (const f of __hh.world.feats) if (f.k === 'hide') { f.x0 += 5000; f.x1 += 5000; }
    __hh.run.stamina = 50; const s0 = T.st(); __hh.advance(10, false); const s1 = T.st();
    T.start(); __hh.advance(10, true); const r1 = T.st();
    return { s0, walked: s1, ran: r1 };
  });
  check('B walking is quieter: it stays unaware', B.walked.aw === 'UNAWARE' && B.walked.a < B.ran.a, { walk: B.walked.a, run: B.ran.a });
  check('B walking is slower', B.walked.score - B.s0.score < (B.ran.score - B.s0.score) / 2, { walk: B.walked.score, run: B.ran.score });
  check('B walking barely recovers stamina', B.walked.ps === 'WALKING' && B.walked.stam >= B.s0.stam && B.walked.stam < B.s0.stam + 15, { before: B.s0.stam, after: B.walked.stam, ps: B.walked.ps });

  // ---- C: hiding in corn reduces awareness and restores stamina ----
  const C = await E(() => {
    T.start(); T.at('corn'); const r = __hh.run; r.a = 55; r.stamina = 20; r.c.mode = 'follow'; r.c.x = r.dist - 30;
    __hh.advance(0.3, false); const s0 = T.st(); __hh.advance(3, false); const s1 = T.st();
    return { s0, s1 };
  });
  check('C hiding: HIDING state in valid cover', C.s0.ps === 'HIDING', C.s0);
  check('C hiding: awareness falls (not reset at once)', C.s1.a < C.s0.a && C.s0.a > 30, { before: C.s0.a, after: C.s1.a });
  check('C hiding: stamina recovers, not instantly', C.s1.stam > C.s0.stam + 30 && C.s0.stam < 40, { before: C.s0.stam, after: C.s1.stam });
  const C2 = await E(() => { T.start(); const r = __hh.run; const z = __hh.world.nextHide(r.dist); r.dist = z.x1 + 4; r.score = r.dist; r.act = 'walk'; r.speed = 2; __hh.world.update(r.dist, 0, 0); while (__hh.world.zoneAt(r.dist)) r.dist += 1; __hh.advance(0.5, false); return T.st(); });
  check('C hiding only works in cover: letting go in the open walks', C2.ps === 'WALKING', C2);

  // ---- D: it investigates the last known position ----
  const D = await E(() => {
    T.start(); const r = __hh.run; r.c.mode = 'follow'; r.c.x = r.dist - 30; r.a = 40;
    const target = r.dist - 6; r.lkp = target; const d0 = Math.abs(r.c.x - target);
    for (let i = 0; i < 60; i++) { __hh.advance(1 / 60, false); r.lkp = target; r.a = 40; }
    const d1 = Math.abs(r.c.x - target);
    let n = 0; while (__hh.run.c.mode !== 'search' && n++ < 600) { __hh.advance(1 / 60, false); r.lkp = target; r.a = 40; }
    const out = { d0: +d0.toFixed(1), d1: +d1.toFixed(1), mode: __hh.creatureState(), at: +Math.abs(r.c.x - target).toFixed(2) };
    // and if it stops hearing anything on the way, it gives up instead
    T.start(); const q = __hh.run; q.c.mode = 'investigate'; q.c.x = q.dist - 30; q.a = 22; q.lkp = q.dist - 6;
    let m = 0; while (q.c.mode === 'investigate' && m++ < 600) __hh.advance(1 / 60, false);
    out.givesUp = __hh.creatureState();
    return out;
  });
  check('D it walks toward where it last heard you', D.d1 < D.d0, D);
  check('D it searches when it gets there', D.mode === 'SEARCHING' && D.at < 1.3, D);
  check('D it loses interest if it stops hearing you', D.givesUp === 'LOSING_INTEREST', D);

  // ---- E: successful escape (good cover, moderate awareness), 20 trials ----
  const Ev = await E(() => {
    const res = { escaped: 0, found: 0, other: 0, resumed: 0, lost: 0 };
    for (let i = 0; i < 20; i++) {
      T.start(); T.at('shed'); const r = __hh.run; r.c.mode = 'investigate'; r.c.x = r.dist - 12; r.a = 45; r.lkp = r.dist;
      let n = 0, sawLose = false;
      while (__hh.mode === 'PLAYING' && n++ < 60 * 20) {
        __hh.advance(1 / 60, false);
        if (r.c.mode === 'lose' || r.c.mode === 'ret') { sawLose = true; break; }
      }
      if (__hh.mode !== 'PLAYING') { res.found++; continue; }
      if (!sawLose) { res.other++; continue; }
      res.escaped++;
      __hh.advance(2.5, false); __hh.advance(3, true);
      if (__hh.mode === 'PLAYING' && T.st().ps === 'RUNNING') res.resumed++;
    }
    return res;
  });
  check('E most players who wait in good cover outlast the search (designed for about 85%)', Ev.escaped >= 15, Ev);
  check('E after it loses interest you can run on', Ev.resumed >= Ev.escaped - 1, Ev);

  // ---- F: failed hiding (weak cover, hid while detected), 20 trials ----
  const F = await E(() => {
    const res = { found: 0, survived: 0, warned: 0, warnGap: [] };
    for (let i = 0; i < 20; i++) {
      T.start(); T.at('hay'); const r = __hh.run; r.c.mode = 'chase'; r.c.x = r.dist - 9; r.a = 95; r.lkp = r.dist;
      let n = 0;
      while (__hh.mode === 'PLAYING' && n++ < 60 * 25) __hh.advance(1 / 60, false);
      if (r.cause === 'found') {
        res.found++;
        const lastWarn = [...r.log].reverse().find(e => e[1] === 'check-you'), caughtAt = r.log.find(e => e[1] === 'caught:found');
        if (lastWarn && caughtAt) { res.warned++; res.warnGap.push(+(caughtAt[0] - lastWarn[0]).toFixed(2)); }
      } else res.survived++;
    }
    res.minWarn = Math.min(...res.warnGap); delete res.warnGap; return res;
  });
  check('F hiding late in weak cover usually gets you found', F.found >= 12, F);
  check('F every discovery is preceded by a visible reach of at least 0.8 s', F.warned === F.found && F.minWarn >= 0.8, F);

  // ---- G: exhaustion ----
  const G = await E(() => {
    T.start(); const r = __hh.run; r.c.mode = 'follow'; r.c.x = r.dist - 20; r.a = 10; r.stamina = 0; r.tired = true;
    const a0 = r.a; __hh.advance(1, true); const tired = T.st(), aTired = r.a - a0;
    T.start(); const q = __hh.run; q.c.mode = 'follow'; q.c.x = q.dist - 20; q.a = 10; __hh.advance(1, true); const aFresh = q.a - 10;
    T.start(); const z = T.at('hay'); const s = __hh.run; s.dist = z.x0 - 4; s.c.x = s.dist - 20; s.stamina = 0; s.tired = true;
    __hh.advance(1.2, true); __hh.advance(0.4, false);
    return { tired, aTired: +aTired.toFixed(1), aFresh: +aFresh.toFixed(1), reached: T.st() };
  });
  check('G exhausted: slower but still moving', G.tired.ps === 'EXHAUSTED' && G.tired.speed > 2.5 && G.tired.speed < 5, G.tired);
  check('G exhausted running is noisier', G.aTired > G.aFresh, { tired: G.aTired, fresh: G.aFresh });
  check('G exhausted: can still reach cover', G.reached.ps === 'HIDING', G.reached);

  // ---- obstacles: penalties are breath, time and noise; no jump in its position ----
  const O = await E(() => {
    const res = {};
    for (const [kind, v, how] of [['low', 'log', 'tired'], ['hole', 'pit', 'walk'], ['snag', 'wire', 'run'], ['low', 'pumpkin', 'run']]) {
      T.start(); const r = __hh.run;
      const ob = __hh.world.feats.find(f => f.obs && f.x0 > r.dist + 5);
      ob.k = kind; ob.v = v; ob.band = { log: [0, 6], pit: [-12, 0], wire: [13, 19], pumpkin: [0, 5] }[v]; ob.x1 = ob.x0 + (kind === 'hole' ? 1.8 : 1.3);
      r.dist = ob.x0 - 3; r.c.mode = 'follow'; r.c.x = r.dist - 30; r.a = 0;
      r.stamina = how === 'tired' ? 0 : 80; r.tired = how === 'tired'; r.act = how === 'walk' ? 'walk' : 'run'; r.speed = how === 'walk' ? 2 : how === 'tired' ? 3.7 : 6.2;
      const s0 = { stam: r.stamina, a: r.a }, hold = how !== 'walk'; let acts = new Set(), n = 0, maxGapJump = 0, prevGap = __hh.gapNow();
      while (r.dist < ob.x1 + 2 && n++ < 600 && __hh.mode === 'PLAYING') { __hh.advance(1 / 60, hold); acts.add(r.act); const g = __hh.gapNow(); maxGapJump = Math.max(maxGapJump, prevGap - g - r.speed / 60 * 0); prevGap = g; }
      res[v + '-' + how] = { hit: ob.hit, hits: r.hits, acts: [...acts], stamLost: +(s0.stam - r.stamina).toFixed(1), aGain: Math.round(r.a - s0.a), maxGapJumpPerFrame: +maxGapJump.toFixed(2), mode: __hh.mode, past: r.dist > ob.x1 };
    }
    return res;
  });
  check('Obstacles: winded into a log trips, is heard, play continues', O['log-tired'].hit && O['log-tired'].acts.includes('stumble') && O['log-tired'].aGain >= 10 && O['log-tired'].past, O['log-tired']);
  check('Obstacles: walking into a pit falls in and climbs out', O['pit-walk'].hit && O['pit-walk'].acts.includes('fall') && O['pit-walk'].past, O['pit-walk']);
  check('Obstacles: running into wire snags then ducks through', O['wire-run'].hit && O['wire-run'].acts.includes('duck') && O['wire-run'].past, O['wire-run']);
  check('Obstacles: fresh running vaults a pumpkin cleanly', !O['pumpkin-run'].hit && O['pumpkin-run'].acts.includes('vault'), O['pumpkin-run']);
  check('Obstacles: no collision makes the creature jump closer', Object.values(O).every(o => o.maxGapJumpPerFrame < 0.2), Object.fromEntries(Object.entries(O).map(([k, o]) => [k, o.maxGapJumpPerFrame])));

  // ---- concealment measured on the rendered frame: coat pixels visible ----
  const coat = async () => pg.evaluate(() => {
    const c = document.querySelector('canvas'), g = c.getContext('2d'), s = __hh.size();
    const x0 = s.offX + Math.round((s.W * 0.42 - 12) * s.SC), y0 = s.offY + Math.round((s.H * 0.8 - 30) * s.SC);
    const d = g.getImageData(x0, y0, 26 * s.SC, 32 * s.SC).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; if ((r === 0xdc && gg === 0xbb && bb === 0x7c) || (r === 0x8a && gg === 0x73 && bb === 0x50)) n++; }
    return n;
  });
  const vis = {};
  for (const type of ['open', 'corn', 'hay', 'cart', 'tree', 'shed']) {
    await E(type => {
      T.start();
      if (type === 'open') { __hh.advance(0.2, false); const r = __hh.run; r.c.mode = 'follow'; r.c.x = r.dist - 40; }
      else { T.at(type); const r = __hh.run; r.c.mode = 'follow'; r.c.x = r.dist - 40; r.a = 0; __hh.advance(0.6, false); }
      __hh.freeze(true);
    }, type);
    await pg.waitForTimeout(100);
    vis[type] = await coat();
  }
  await E(() => __hh.freeze(false));
  const ratio = t => +(vis[t] / Math.max(1, vis.open)).toFixed(2);
  check('Concealed: corn hides most of the traveller', ratio('corn') <= 0.5, vis);
  check('Concealed: haystack and cart hide most of the traveller', ratio('hay') <= 0.4 && ratio('cart') <= 0.5, vis);
  check('Concealed: inside the tree or shed nothing of the coat shows', vis.tree === 0 && vis.shed === 0, vis);

  // ---- states and transitions ----
  const S = await E(() => {
    T.start(); const res = {};
    res.illegal = __hh.setMode('GAME_OVER');
    __hh.pause(); res.paused = __hh.mode; const d0 = __hh.run.dist, x0 = __hh.run.c.x, a0 = __hh.run.a;
    __hh.advance(2, true); res.frozen = __hh.run.dist === d0 && __hh.run.c.x === x0 && __hh.run.a === a0;
    __hh.resume(); res.resumed = __hh.mode;
    return res;
  });
  check('States: illegal transition refused', S.illegal === false, S);
  check('States: nothing moves while PAUSED', S.paused === 'PAUSED' && S.frozen, S);
  check('States: resume returns to PLAYING', S.resumed === 'PLAYING', S);

  // ---- H: death and restart through the real UI with a mouse ----
  await E(() => { T.start(); const r = __hh.run; r.c.mode = 'chase'; r.a = 90; r.c.x = r.dist - 2; __hh.advance(1, false); });
  const f1 = await E(() => ({ mode: __hh.mode, score: Math.floor(__hh.run.score) }));
  await pg.waitForTimeout(2200);
  const f2 = await E(() => ({ mode: __hh.mode, scoreAfter: Math.floor(__hh.run.score) }));
  check('H caught, then GAME_OVER', f1.mode === 'CAUGHT' && f2.mode === 'GAME_OVER', [f1, f2]);
  check('H no score change after death', f2.scoreAfter === f1.score, [f1, f2]);
  const tryAgain = await E(() => { const s = __hh.size(); return { x: (s.offX + s.W / 2 * s.SC) / 2, y: (s.offY + (Math.round(s.H * 0.62) + 6) * s.SC) / 2 }; });
  await pg.mouse.move(tryAgain.x, tryAgain.y); await pg.mouse.down();
  const midClick = await E(() => __hh.mode);
  await pg.mouse.up(); await pg.waitForTimeout(100);
  const f3 = await E(() => { const r = __hh.run; return { mode: __hh.mode, score: r.score, stam: r.stamina, a: r.a, gap: __hh.gapNow(), cmode: r.c.mode, hideT: r.hideT, hits: r.hits, spot: r.spot }; });
  check('H button acts on release, not press', midClick === 'GAME_OVER' && f3.mode === 'STARTING', { midClick, f3 });
  check('H restart resets every variable', f3.score === 0 && f3.stam === 100 && f3.a === 0 && f3.gap === 38 && f3.cmode === 'wake' && f3.hideT === 0 && f3.hits === 0 && f3.spot === null, f3);

  // ---- input: mouse hold/release, touch hold/cancel, focus loss ----
  const centre = await E(() => { const s = __hh.size(); return { x: (s.offX + s.W / 2 * s.SC) / 2, y: (s.offY + s.H * 0.55 * s.SC) / 2 }; });
  await pg.mouse.move(centre.x, centre.y); await pg.mouse.down(); await pg.waitForTimeout(700);
  const m1 = await E(() => T.st());
  await pg.mouse.up(); await pg.waitForTimeout(500);
  const m2 = await E(() => T.st());
  check('Input: mouse hold runs', m1.mode === 'PLAYING' && m1.ps === 'RUNNING', m1);
  check('Input: mouse release walks or hides', ['WALKING', 'HIDING'].includes(m2.ps) && m2.speed <= 2.01, m2);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.y, id: 7 }] });
  await pg.waitForTimeout(500);
  const t1 = await E(() => T.st());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await pg.waitForTimeout(400);
  const t2 = await E(() => T.st());
  check('Input: touch hold runs', t1.ps === 'RUNNING', t1);
  check('Input: touch cancel releases safely', t2.ps !== 'RUNNING', t2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.y, id: 8 }] });
  await pg.waitForTimeout(300);
  await E(() => window.dispatchEvent(new Event('blur')));
  await pg.waitForTimeout(400);
  const t3 = await E(() => T.st());
  check('Input: focus loss releases the hold', t3.ps !== 'RUNNING', t3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  const best = await E(() => __hh.save().best);
  await pg.reload(); await pg.waitForTimeout(400);
  const best2 = await E(() => __hh.save().best);
  check('Best score persists across reload', best > 0 && best === best2, { best, best2 });

  check('No page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
});
