// The score flow: live score, saving on capture and on escape, the board and failures.
const { open } = require('./sim');
(async () => {
  let pass = 0, total = 0;
  const check = (name, ok, info) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(info)); };
  const helpers = () => {
    const L = window.__ll;
    window.T = {
      fresh(x, y) { L.beginRun(); L.world.reset(); L.watcher.reset(); L.player.reset(x, y, 1); L.R.follow(L.player, 1, true); for (const k in L.key) L.key[k] = false; },
      steps(sec, fn) { let t = 0; while (t < sec) { if (fn && fn(t) === false) break; L.step(1 / 120); t += 1 / 120; } return t; },
      L
    };
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let { browser, page, errs } = await open();
  const ev = (f, a) => page.evaluate(f, a);
  await ev(helpers);

  // 1. the live score follows the distance reached
  let r = await ev(() => { const { L } = T; T.fresh(1.4, 9); L.player.reset(51.4, 0); T.steps(0.05); return { v: L.score, dist: Math.floor(L.farX - L.level.start.x) }; });
  check('during play the score is 10 points per metre reached', r.v === r.dist * 10 && r.v >= 500, r);
  // 2. caught: the distance score is submitted and the card says so
  r = await ev(async () => {
    const { L } = T; T.fresh(1.4, 9); L.player.reset(130.6, 0); T.steps(0.05);
    T.steps(6, () => L.mode !== 'caughtCard');
    await new Promise(r => setTimeout(r, 50));
    return { mode: L.mode, submits: window.__board.submits.slice(), line: (document.querySelector('.ll-save') || {}).textContent, best: window.__board.best };
  });
  check('capture submits the distance score (10 per metre) and the card reports it saved', r.mode === 'caughtCard' && r.submits.length === 1 && r.submits[0].value === 1290 && /1,290/.test(r.line) && /new best/.test(r.line), r);
  // 3. a weaker capture later: submitted, board keeps the best, card shows the server best
  r = await ev(async () => {
    const { L } = T; T.fresh(1.4, 9); L.player.reset(130.6, 0); T.steps(6, () => L.mode !== 'caughtCard');
    await new Promise(r => setTimeout(r, 50));
    return { n: window.__board.submits.length, best: window.__board.best, line: (document.querySelector('.ll-save') || {}).textContent };
  });
  check('the same score again is not a new best; the card shows the board best', r.n === 2 && r.best === 1290 && /best is 1,290/.test(r.line), r);
  // 4. escape: submitted before complete, at least 1,500, board rows and rank shown
  r = await ev(async () => {
    const { L } = T; T.fresh(1.4, 9); L.player.reset(142, 0); L.key.r = true; T.steps(3, () => L.mode === 'play'); L.key.r = false;
    await new Promise(r => setTimeout(r, 80));
    const s = window.__board.submits;
    return { mode: L.mode, last: s[s.length - 1], complete: window.__complete, note: document.querySelector('.ll-note').textContent, board: document.querySelector('.ll-board').textContent };
  });
  check('escape submits the escape score, and the board and rank come from the server', r.mode === 'result' && r.last.value >= 1500 && r.complete.score === r.last.value && /new best/i.test(r.note) && /You are 1 of 2/.test(r.board) && /ink/.test(r.board), r);
  // 5. title BEST is the server best
  r = await ev(async () => { const { L } = T; return { best: window.__board.best, shown: L.bestShown() }; });
  check('the BEST shown is the board best', r.shown === r.best, r);
  await browser.close();

  // 6. submits fail: the error is reported, the score goes to the retrying queue, the card is honest
  ({ browser, page, errs } = await open({ query: '?scorefail' }));
  await page.evaluate(helpers);
  r = await page.evaluate(async () => {
    const { L } = T; T.fresh(1.4, 9); L.player.reset(130.6, 0); T.steps(6, () => L.mode !== 'caughtCard');
    await new Promise(r => setTimeout(r, 50));
    return { err: window.__platformError, cps: window.__board.checkpoints, line: (document.querySelector('.ll-save') || {}).textContent };
  });
  check('a failed submit is reported, queued for the host to retry, and shown honestly', r.err && r.err.code === 'score_submit_failed' && r.cps.length === 1 && r.cps[0].value === 1290 && /could not be reached/.test(r.line), r);
  console.log(pass + '/' + total + ' score checks');
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
