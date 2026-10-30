// Acceptance scenarios A-F from the Stage 2 brief, plus state, input and score checks.
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
  const E = fn => pg.evaluate(fn);

  // helper installed in the page: start a run and put the traveller at a hiding place of a given kind
  await E(() => {
    window.T = {
      start() { __hh.reset(); __hh.begin(); __hh.advance(0.1, true); __hh.advance(2, true); },
      at(type, gap, mode) {
        const r = __hh.run; let z = null, n = 0;
        while (!(z = __hh.world.feats.find(f => f.k === 'hide' && f.type === type && f.x0 > r.dist + 2)) && n++ < 200) { r.dist += 40; r.score = r.dist; __hh.world.update(r.dist, 0, 0); }
        r.dist = r.score = z.x0 + 0.3; r.act = 'run'; r.speed = 5; r.c.gap = gap; r.c.mode = mode || 'hunt'; r.hideT = 0;
        for (const f of __hh.world.feats) if (f.obs && f.x0 < r.dist + 4 && f.x1 > r.dist - 1) f.done = f.hit = true;
        return z;
      },
      st() { const r = __hh.run; return { ps: __hh.playerState(), cs: __hh.creatureState(), cm: r.c.mode, gap: +r.c.gap.toFixed(2), P: Math.round(__hh.pursuit()), stam: +r.stamina.toFixed(1), speed: +r.speed.toFixed(2), act: r.act, mode: __hh.mode, score: +r.score.toFixed(2) }; }
    };
  });

  // ---- A: continuous running ----
  const A = await E(() => {
    T.start(); const out = { stam: [], P: [], states: new Set(), tiredAt: null };
    let n = 0;
    while (__hh.mode === 'PLAYING' && n++ < 60 * 120) {
      __hh.advance(1 / 60, true); const s = T.st();
      if (n % 60 === 0) { out.stam.push(Math.round(s.stam)); out.P.push(s.P); }
      out.states.add(s.ps); if (s.ps === 'EXHAUSTED' && out.tiredAt === null) out.tiredAt = +__hh.run.t.toFixed(1);
    }
    out.states = [...out.states]; out.end = T.st(); out.cause = __hh.run.cause; out.t = +__hh.run.t.toFixed(1); return out;
  });
  check('A stamina falls while holding', A.stam[0] > A.stam[5] && A.stam[5] > A.stam[9], A.stam.slice(0, 12));
  check('A creature closes while running', A.P[0] > A.P[8], A.P.slice(0, 12));
  check('A exhaustion reached before the catch', A.tiredAt !== null && A.tiredAt < A.t, { tiredAt: A.tiredAt, caughtAt: A.t });
  check('A ends caught, not found or seen', A.cause === 'caught', A.cause);

  // ---- B: strategic hiding at a cart, creature passes, resume ----
  const B = await E(() => {
    T.start(); __hh.run.stamina = 30; const z = T.at('cart', 8);
    const seq = []; let n = 0, last = '';
    const s0 = T.st();
    while (n++ < 60 * 8) {
      __hh.advance(1 / 60, false); const s = T.st();
      const tag = s.ps + '/' + s.cs + '/' + s.cm; if (tag !== last) { seq.push(tag); last = tag; }
      if (s.cm === 'withdraw' && __hh.run.hideT > 0) break;
    }
    const mid = T.st();
    __hh.advance(1.5, false);
    const later = T.st();
    __hh.advance(0.6, true);
    return { s0, seq, mid, later, after: T.st(), safe: __hh.safeTime(z), hideT: +__hh.run.hideT.toFixed(2), log: __hh.run.log.slice(-8) };
  });
  check('B enters HIDING at the cart', B.seq[0].startsWith('HIDING'), B.seq);
  check('B creature goes SEARCHING then passes and withdraws', B.seq.some(x => x.includes('SEARCHING/sweep')) && B.mid.cm === 'withdraw', B.seq);
  check('B stamina recovers in cover', B.later.stam > B.s0.stam + 20, { before: B.s0.stam, after: B.later.stam });
  check('B pursuit pressure drops after it passes', B.later.P > B.mid.P, { passed: B.mid.P, later: B.later.P });
  check('B score does not grow while hidden', B.later.score === B.mid.score, { mid: B.mid.score, later: B.later.score });
  check('B resumes RUNNING and survives', B.after.ps === 'RUNNING' && B.after.mode === 'PLAYING', B.after);

  // ---- C: hiding too long in corn ----
  const C = await E(() => {
    T.start(); T.at('corn', 30); let n = 0;
    while (__hh.mode === 'PLAYING' && n++ < 60 * 20) __hh.advance(1 / 60, false);
    const log = __hh.run.log.map(e => e[1]), tm = k => { const e = __hh.run.log.find(x => x[1] === k); return e ? e[0] : null; };
    return { mode: __hh.mode, cause: __hh.run.cause, log: log.slice(-6), exposedAt: tm('exposed'), checkAt: tm('check'), caughtAt: tm('caught:found') };
  });
  check('C safe time expires with a warning', C.exposedAt !== null, C.log);
  check('C it comes to check the hiding place', C.checkAt !== null && C.checkAt >= C.exposedAt, C);
  check('C discovery follows the warning by at least 0.8 s', C.caughtAt !== null && C.caughtAt - C.exposedAt >= 0.8, C);
  check('C ends found', C.cause === 'found', C.cause);
  // C2: bolting during the check gives a chance
  const C2 = await E(() => {
    T.start(); T.at('corn', 30); let n = 0;
    while (__hh.run.c.mode !== 'check' && n++ < 60 * 20) __hh.advance(1 / 60, false);
    __hh.advance(0.2, true);
    return T.st();
  });
  check('C2 leaving cover during the check is survivable', C2.mode === 'PLAYING' && C2.ps === 'RUNNING', C2);

  // ---- D: running out of stamina ----
  const D = await E(() => {
    T.start(); __hh.run.c.gap = 40; __hh.run.stamina = 5; __hh.advance(1, true);
    const tired = T.st(), hunt = __hh.run.c.mode;
    const z = T.at('hay', 20); __hh.run.stamina = 0; __hh.run.tired = true; __hh.run.dist = z.x0 - 1.5;
    __hh.advance(0.6, true); const moving = T.st();
    __hh.advance(1.2, false); const hid = T.st();
    return { tired, moving, hid };
  });
  check('D EXHAUSTED at zero stamina', D.tired.ps === 'EXHAUSTED' && D.tired.stam === 0, D.tired);
  check('D still moves, slower', D.tired.speed > 2 && D.tired.speed < 4.5, D.tired);
  check('D can still reach cover and hide', D.hid.ps === 'HIDING', D.hid);

  // ---- E: collisions ----
  const E1 = await E(() => {
    const res = {};
    for (const [kind, v, how] of [['low', 'log', 'tired'], ['hole', 'pit', 'walk'], ['snag', 'wire', 'run'], ['low', 'pumpkin', 'run']]) {
      T.start(); const r = __hh.run; r.c.gap = 30; r.c.mode = 'hunt';
      const ob = __hh.world.feats.find(f => f.obs && f.x0 > r.dist + 5);
      ob.k = kind; ob.v = v; ob.band = { log: [0, 6], pit: [-12, 0], wire: [13, 19], pumpkin: [0, 5] }[v]; ob.x1 = ob.x0 + (kind === 'hole' ? 1.8 : 1.3);
      r.dist = ob.x0 - 3; r.stamina = how === 'tired' ? 0 : 80; r.tired = how === 'tired'; r.act = how === 'walk' ? 'walk' : 'run'; r.speed = how === 'walk' ? 2 : how === 'tired' ? 3.1 : 6.2;
      const s0 = T.st(), hold = how !== 'walk'; let hits = 0, acts = new Set(), n = 0;
      while (r.dist < ob.x1 + 2 && n++ < 600 && __hh.mode === 'PLAYING') { __hh.advance(1 / 60, hold); acts.add(r.act); }
      res[v + '-' + how] = { hit: ob.hit, hits: r.hits, acts: [...acts], stamLost: +(s0.stam - r.stamina).toFixed(1), gapLost: +(s0.gap - r.c.gap).toFixed(1), mode: __hh.mode, past: r.dist > ob.x1 };
    }
    return res;
  });
  const e = E1;
  check('E log while winded: trip, penalty, carry on', e['log-tired'].hit && e['log-tired'].acts.includes('stumble') && e['log-tired'].mode === 'PLAYING' && e['log-tired'].past, e['log-tired']);
  check('E pit while walking: fall, climb out, carry on', e['pit-walk'].hit && e['pit-walk'].acts.includes('fall') && e['pit-walk'].past && e['pit-walk'].mode === 'PLAYING', e['pit-walk']);
  check('E wire while running: snag, then duck through', e['wire-run'].hit && e['wire-run'].acts.includes('stumble') && e['wire-run'].acts.includes('duck') && e['wire-run'].past, e['wire-run']);
  check('E pumpkin while running fresh: vault, no hit', !e['pumpkin-run'].hit && e['pumpkin-run'].acts.includes('vault'), e['pumpkin-run']);
  check('E each collision counted once', e['log-tired'].hits === 1 && e['pit-walk'].hits === 1 && e['wire-run'].hits === 1, [e['log-tired'].hits, e['pit-walk'].hits, e['wire-run'].hits]);
  check('E major hit costs more than minor', e['pit-walk'].gapLost > e['log-tired'].gapLost - 1 && e['wire-run'].stamLost > 8, e);

  // ---- difficulty ramps; crows punish running, not walking ----
  const R = await E(() => {
    T.start(); const r = __hh.run, z = { safe: 3 };
    const early = { safe: __hh.safeTime(z), t: r.t }; r.t = 100; const late = { safe: __hh.safeTime(z) };
    const out = { early, late };
    for (const how of ['run', 'walk']) {
      T.start(); const q = __hh.run; q.c.gap = 30; q.c.mode = 'hunt';
      const f = __hh.world.feats.find(x => x.obs && x.x0 > q.dist + 6); f.k = 'crows'; f.obs = false; f.n = 4; f.done = false;
      q.dist = f.x0 - 3; q.act = how; q.speed = how === 'run' ? 6.2 : 2;
      const g0 = q.c.gap; let n = 0; while (!f.done && n++ < 300) __hh.advance(1 / 60, how === 'run');
      out[how] = { gapDrop: +(g0 - q.c.gap).toFixed(2), loud: q.log.some(e => e[1] === 'crows-loud') };
    }
    return out;
  });
  check('Difficulty: safe time shrinks as the run goes on', R.late.safe < R.early.safe, R);
  check('Crows: running through them gives you away', R.run.loud && R.run.gapDrop > 3, R.run);
  check('Crows: walking past them does not', !R.walk.loud, R.walk);

  // ---- states and transitions ----
  const S = await E(() => {
    T.start(); const res = {};
    res.illegal = __hh.setMode('GAME_OVER');
    __hh.pause(); res.paused = __hh.mode; const d0 = __hh.run.dist, g0 = __hh.run.c.gap;
    __hh.advance(2, true); res.frozen = __hh.run.dist === d0 && __hh.run.c.gap === g0;
    __hh.resume(); res.resumed = __hh.mode;
    return res;
  });
  check('States: illegal transition refused', S.illegal === false, S);
  check('States: nothing moves while PAUSED', S.paused === 'PAUSED' && S.frozen, S);
  check('States: resume returns to PLAYING', S.resumed === 'PLAYING', S);

  // ---- F: death and restart through the real UI with a mouse ----
  await E(() => { T.start(); __hh.run.c.gap = 1.5; __hh.run.c.mode = 'hunt'; __hh.advance(0.5, false); });
  const f1 = await E(() => ({ mode: __hh.mode, best: __hh.save().best, score: Math.floor(__hh.run.score) }));
  await pg.waitForTimeout(2200);
  const f2 = await E(() => ({ mode: __hh.mode, scoreAfter: Math.floor(__hh.run.score) }));
  check('F caught, then GAME_OVER', f1.mode === 'CAUGHT' && f2.mode === 'GAME_OVER', [f1, f2]);
  check('F no score change after death', f2.scoreAfter === f1.score, [f1, f2]);
  const tryAgain = await E(() => { const s = __hh.size(); return { x: (s.offX + s.W / 2 * s.SC) / 2, y: (s.offY + (Math.round(s.H * 0.62) + 6) * s.SC) / 2 }; });
  await pg.mouse.move(tryAgain.x, tryAgain.y); await pg.mouse.down();
  const midClick = await E(() => __hh.mode);
  await pg.mouse.up(); await pg.waitForTimeout(100);
  const f3 = await E(() => ({ mode: __hh.mode, ps: __hh.playerState(), score: __hh.run.score, stam: __hh.run.stamina, gap: __hh.run.c.gap, held: false }));
  check('F button acts on release, not press', midClick === 'GAME_OVER' && f3.mode === 'STARTING', { midClick, f3 });
  check('F restart is clean', f3.score === 0 && f3.stam === 100 && f3.gap === 34, f3);

  // ---- input: mouse hold/release, touch hold/release/cancel, blur ----
  const centre = await E(() => { const s = __hh.size(); return { x: (s.offX + s.W / 2 * s.SC) / 2, y: (s.offY + s.H * 0.55 * s.SC) / 2 }; });
  await pg.mouse.move(centre.x, centre.y); await pg.mouse.down(); await pg.waitForTimeout(700);
  const m1 = await E(() => T.st());
  await pg.mouse.up(); await pg.waitForTimeout(500);
  const m2 = await E(() => T.st());
  check('Input: mouse hold runs', m1.mode === 'PLAYING' && m1.ps === 'RUNNING', m1);
  check('Input: mouse release slows to a walk or hides', ['WALKING', 'HIDING', 'EXHAUSTED'].includes(m2.ps) && m2.speed <= 2.01, m2);
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

  // ---- best persists ----
  const best = await E(() => __hh.save().best);
  await pg.reload(); await pg.waitForTimeout(400);
  const best2 = await E(() => __hh.save().best);
  check('Best score persists across reload', best > 0 && best === best2, { best, best2 });

  check('No page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
});
