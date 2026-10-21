// The Watcher's rules, exercised through the real systems.
const { open } = require('./sim');
(async () => {
  const { browser, page, errs } = await open();
  let pass = 0, total = 0;
  const check = (name, ok, info) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(info)); };
  const ev = (f, a) => page.evaluate(f, a);
  // a lamp fixed on a spot: stand there and count the time to each state
  let r = await ev(() => {
    const L = window.__ll; if (L.mode !== 'play') L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(130.6, 0);
    const P = L.player, W = L.watcher, log = {}; let t = 0;
    while (t < 6 && L.mode === 'play') { L.step(1 / 120); t += 1 / 120; if (!log[W.mode]) log[W.mode] = +t.toFixed(2); }
    if (L.mode === 'caught') log.caught = +t.toFixed(2);
    return log;
  });
  check('exposure escalates notice -> track -> capture, with a recovery window', r.notice < 0.1 && r.track > 0.6 && r.track < 1.2 && r.caught > 1.6 && r.caught < 3, r);
  r = await ev(() => {
    const L = window.__ll; L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(130.6, 0);
    const W = L.watcher; let t = 0;
    while (t < 0.55) { L.step(1 / 120); t += 1 / 120; }
    const S = W.S; L.at(137, 0); // step into the dark
    let t2 = 0; while (t2 < 3) { L.step(1 / 120); t2 += 1 / 120; }
    return { S, after: W.mode, mode: L.mode };
  });
  check('brief exposure settles back to search after you break line of sight', r.S > 0.3 && r.after === 'search' && r.mode === 'play', r);
  r = await ev(() => {
    const L = window.__ll; L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(130.6, 0);
    const W = L.watcher; let t = 0;
    while (W.mode !== 'track' && t < 3) { L.step(1 / 120); t += 1 / 120; }
    const seenAt = { ...W.last };
    L.at(137, 0); // the doorway at 136.2-137.6 is out of every beam
    let t2 = 0; while (t2 < 2) { L.step(1 / 120); t2 += 1 / 120; }
    return { mode: W.mode, seenAt, last: W.last, px: L.player.x, game: L.mode };
  });
  check('it searches your last known position, not where you are', r.mode === 'track' && Math.abs(r.last.x - r.seenAt.x) < 0.01 && r.px > 136, r);
  r = await ev(() => { const L = window.__ll, W = L.watcher; let t = 0; while (W.mode !== 'search' && t < 9) { L.step(1 / 120); t += 1 / 120; } return { mode: W.mode, t: +t.toFixed(1), game: L.mode }; });
  check('it gives up after losing you', r.mode === 'search' && r.game === 'play', r);
  // the awning's shade: crossing street IV with and without it
  const cross = awning => ev(a => {
    const L = window.__ll; L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(56.2, 0);
    if (a) { L.I.actPressed = true; L.step(1 / 120); for (let i = 0; i < 70; i++) L.step(1 / 120); }
    const W = L.watcher, e0 = W.exposure; W.reset();
    L.key.r = true; let t = 0; while (L.player.x < 66.5 && t < 4 && L.mode === 'play') { L.step(1 / 120); t += 1 / 120; } L.key.r = false;
    return { seen: +(W.exposure - e0).toFixed(2), mode: W.mode, game: L.mode, aw: L.level.awnings[0].t, x: +L.player.x.toFixed(1), t: +t.toFixed(2) };
  }, awning);
  const without = await cross(false), withA = await cross(true);
  check('the awning shades the crossing', withA.seen < without.seen * 0.5, { without, withA });
  // a pull is loud: the lamps look at the cord
  r = await ev(() => { const L = window.__ll; L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(56.2, 0); L.I.actPressed = true; L.step(1 / 120); return { mode: L.watcher.mode, last: L.watcher.last }; });
  check('pulling the cord makes the Watcher investigate the cord', r.mode === 'investigate' && Math.abs(r.last.x - 56.2) < 0.1, r);
  r = await ev(() => { const L = window.__ll, s = L.level.shutters[0]; let t = 0; while (t < 4) { L.step(1 / 120); t += 1 / 120; } return { y: +s.y.toFixed(2), mode: L.watcher.mode }; });
  check('the gate shutter comes down while it investigates', r.y < 1.6, r);
  r = await ev(() => { const L = window.__ll, s = L.level.shutters[0]; let t = 0; while (t < 12) { L.step(1 / 120); t += 1 / 120; } return { y: +s.y.toFixed(2), mode: L.watcher.mode }; });
  check('and lifts again when it gives up', r.y > 2.6 && r.mode === 'search', r);
  // capture -> respawn at the mark, world reset, retry is immediate
  r = await ev(() => {
    const L = window.__ll; L.beginRun(); L.setCp(5); L.world.reset(); L.watcher.reset(); L.at(130.6, 0);
    let t = 0; while (L.mode === 'play' && t < 5) { L.step(1 / 120); t += 1 / 120; }
    const caught = L.mode; let t2 = 0; while (L.mode !== 'play' && t2 < 3) { L.step(1 / 120); t2 += 1 / 120; }
    return { caught, back: L.mode, wait: +t2.toFixed(2), x: L.player.x, w: L.watcher.mode, caps: L.captures, aw: L.level.awnings[1].t };
  });
  check('capture, then back at the last mark within 1.5 s, Watcher calm', r.caught === 'caught' && r.back === 'play' && r.wait < 1.5 && r.w === 'search' && r.caps === 1 && Math.abs(r.x - 119.6) < 0.1, r);
  // hunt: doorway near the last known position opens
  r = await ev(() => {
    const L = window.__ll; L.beginRun(); L.world.reset(); L.watcher.reset(); L.at(130.6, 0);
    const W = L.watcher; W.mode = 'hunt'; W.modeT = 0; W.last = { x: 136.8, y: 0 }; W.lost = 0;
    L.at(136.9, 0); let t = 0; const lock0 = W.L;
    while (t < 3 && L.mode === 'play') { L.step(1 / 120); t += 1 / 120; }
    return { open: +L.level.recesses[4].open.toFixed(2), game: L.mode, lock: +W.L.toFixed(2), lock0 };
  });
  check('in a hunt, the doorway where it lost you opens and stops hiding you', r.open > 0.9 && (r.game === 'caught' || r.lock > 0.5), r);
  console.log(pass + '/' + total + ' threat checks');
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
