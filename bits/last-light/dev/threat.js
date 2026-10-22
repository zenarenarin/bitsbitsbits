// The Watcher's rules and the exploits players try, exercised through the real systems.
const { open } = require('./sim');
(async () => {
  const { browser, page, errs } = await open();
  let pass = 0, total = 0;
  const check = (name, ok, info) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(info)); };
  const ev = (f, a) => page.evaluate(f, a);
  // shared page helpers
  await ev(() => {
    const L = window.__ll;
    window.T = {
      fresh(x, y, face) { L.beginRun(); L.world.reset(); L.watcher.reset(); L.player.reset(x, y, face || 1); L.R.follow(L.player, 1, true); for (const k in L.key) L.key[k] = false; },
      steps(sec, fn) { let t = 0; while (t < sec) { if (fn && fn(t) === false) break; L.step(1 / 120); t += 1 / 120; } return t; },
      W: L.watcher, P: L.player, L
    };
  });

  // 1. standing still in a lamp: exposed -> detected -> captured, with a reason
  let r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    const log = {}; let t = 0;
    while (t < 6 && L.mode === 'play') { L.step(1 / 120); t += 1 / 120; const s = W.exposureState(); if (!log[s]) log[s] = +t.toFixed(2); }
    T.steps(1.1);
    return { log, mode: L.mode, card: (document.querySelector('.ll-why') || {}).textContent };
  });
  check('standing still in a beam: exposed at once, detected ~0.9 s, captured ~2.2 s', r.log.exposed < 0.05 && r.log.detected > 0.75 && r.log.detected < 1.1 && r.log.captured > 1.9 && r.log.captured < 2.6, r.log);
  check('capture ends in a card that names the lamp and the reason', r.mode === 'caughtCard' && /lamppost/.test(r.card) && /stood still/.test(r.card), r.card);

  // 2. a brief touch is survivable and is forgiven only after a grace period
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    T.steps(0.55); const S = W.S;
    L.player.reset(137, 0); T.steps(0.3); const Sgrace = W.S; T.steps(3);
    return { S: +S.toFixed(2), Sgrace: +Sgrace.toFixed(2), mode: W.mode, game: L.mode, alarms: W.alarms };
  });
  check('a brief exposure is survivable; suspicion holds for the grace period, then fades', r.S > 0.4 && r.Sgrace === r.S && r.mode === 'search' && r.game === 'play' && r.alarms === 0, r);

  // 3. darting in and out of the beam edge does not reset suspicion
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    let t = 0; while (t < 6 && W.alarms === 0) { L.player.reset((Math.floor(t / 0.3) % 2) ? 137 : 130.6, 0); T.steps(0.3); t += 0.3; }
    return { t: +t.toFixed(1), alarms: W.alarms, mode: W.mode };
  });
  check('darting in and out of a beam still leads to detection', r.alarms === 1, r);

  // 4. running straight through the middle of a beam
  r = await ev(() => {
    const { L, W } = T; T.fresh(124.2, 0); L.key.r = true;
    T.steps(4, () => L.player.x < 139); L.key.r = false;
    const after = W.exposureState(); T.steps(1.5);
    return { seen: +W.exposure.toFixed(2), state: after, alarms: W.alarms, game: L.mode };
  });
  check('sprinting straight through the lamppost is seen and detected, not ignored', r.seen > 1 && r.alarms === 1, r);

  // 5. after detection: hide in a doorway; it searches where you were, then gives up
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    T.steps(3, () => W.mode !== 'track');
    const seenAt = { ...W.last };
    L.player.reset(136.9, 0); T.steps(1.5);
    const mid = { state: W.exposureState(), last: { ...W.last } };
    T.steps(6, () => W.mode !== 'search');
    return { seenAt, mid, end: W.mode, game: L.mode };
  });
  check('hidden after detection: it searches the last known position, not you, then gives up', r.mid.state === 'lost' && Math.abs(r.mid.last.x - r.seenAt.x) < 0.01 && r.end === 'search' && r.game === 'play', r);

  // 6. returning to the same lit spot while it is still looking: it reacquires faster
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    T.steps(3, () => W.mode !== 'track');
    L.player.reset(136.9, 0); T.steps(1.5);
    const L0 = W.L; L.player.reset(130.6, 0);
    let t = 0; while (t < 3 && L.mode === 'play') { L.step(1 / 120); t += 1 / 120; }
    return { lockBefore: +L0.toFixed(2), caughtAfter: +t.toFixed(2), game: L.mode };
  });
  check('going back into the light while it searches: it hunts and catches you faster', r.game === 'caught' && r.caughtAfter < 1.1, r);

  // 7. in the hunt the doorway near its last sighting opens and stops hiding you
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0);
    W.mode = 'hunt'; W.modeT = 0; W.last = { x: 136.8, y: 0 }; W.lost = 0;
    L.player.reset(136.9, 0); const rec = L.level.recesses.find(r => r.x0 === 136.2);
    T.steps(3, () => L.mode === 'play');
    return { open: +rec.open.toFixed(2), game: L.mode, why: (L.watcher.captureCtx || {}).door };
  });
  check('in a hunt, the doorway near its last sighting opens and stops hiding you', r.open > 0.6 && (r.game === 'caught' || r.game === 'caughtCard'), r);

  // 8. climbing out of a beam: hanging under the roof's edge is never lit
  r = await ev(() => {
    const { L, W } = T; T.fresh(30, 11.6);
    L.key.d = true; T.steps(0.9); L.key.d = false;
    const st = L.player.state; L.key.r = true; T.steps(4); L.key.r = false;
    return { st, seen: W.exposure, x: +L.player.x.toFixed(1) };
  });
  check('hanging below the roof edge keeps you out of the raking lamp', r.st === 'hang' && r.seen === 0 && r.x > 37, r);

  // 9. the light reaches you in the air too
  r = await ev(() => {
    const { L, W } = T; T.fresh(126.6, 0);
    L.I.jumpPressed = true; L.key.j = true; L.key.r = true;
    let air = 0; T.steps(0.5, () => { if (L.player.state === 'air' && W.seenFrac > 0) air++; });
    L.key.j = false; L.key.r = false;
    return { airLitSteps: air };
  });
  check('jumping through a beam: you are seen in mid-air', r.airLitSteps > 10, r);

  // 10. the awning: pull while the lantern looks at the cord vs while it looks away
  const pull = when => ev(when => {
    const { L, W } = T; T.fresh(55.0, 0);
    const lan = L.level.lights.find(l => l.kind === 'lantern' && l.x === 60.4);
    // wait for the lantern's sweep to be where we want it
    T.steps(8, () => !(when === 'away' ? Math.sin(TAU_ * lan.clock / lan.period) > 0.9 : Math.sin(TAU_ * lan.clock / lan.period) < -0.9));
    L.player.reset(56.2, 0); L.I.actPressed = true; L.step(1 / 120);
    const pulled = L.level.awnings[0].target === 1;
    T.steps(1.0);
    L.key.r = true; T.steps(3, () => L.player.x < 64); L.key.r = false;
    return { pulled, mode: W.mode, alarms: W.alarms, seen: +W.exposure.toFixed(2) };
  }, when);
  await ev(() => { window.TAU_ = Math.PI * 2; });
  const away = await pull('away'), toward = await pull('toward');
  check('pulling while the lantern looks away: the awning hides you; it only investigates', away.pulled && away.alarms === 0 && away.seen < 0.5, away);
  check('pulling while the lantern is on the cord: you are seen while you pull', toward.pulled && toward.seen > away.seen + 0.3, toward);

  // 11. the noise of the pull brings the gate shutter down; it lifts when the Watcher settles
  r = await ev(() => {
    const { L, W } = T; T.fresh(53.3, 0); // in the doorway
    W.hear(56.2, 0, 'cord');
    T.steps(4.5); const y1 = L.level.shutters[0].y;
    T.steps(10); return { down: +y1.toFixed(2), up: +L.level.shutters[0].y.toFixed(2), mode: W.mode };
  });
  check('a noise brings the gate shutter down; it lifts when the Watcher gives up', r.down < 1.2 && r.up > 2.6 && r.mode === 'search', r);

  // 12. restart after capture resets everything; retry from a mark keeps the capture
  r = await ev(() => {
    const { L, W } = T; T.fresh(130.6, 0); L.world.pullAwning(L.level.awnings[0]);
    T.steps(4, () => L.mode === 'play' || L.mode === 'caught');
    const card = L.mode;
    L.retryFromMark();
    const mark = { mode: L.mode, x: L.player.x, w: W.mode, S: W.S, L: W.L, caps: L.captures, aw: L.level.awnings[1].t };
    T.steps(3, () => L.mode === 'play'); T.steps(1.2);
    L.beginRun();
    return { card, mark, fresh: { mode: L.mode, x: L.player.x, y: L.player.y, w: W.mode, caps: L.captures, t: L.runT, alarms: W.alarms, seen: W.exposure, shutter: L.level.shutters[0].y } };
  });
  check('retry from the mark: back at the mark, Watcher calm, awnings rolled, capture counted', r.card === 'caughtCard' && r.mark.mode === 'play' && r.mark.w === 'search' && r.mark.S === 0 && r.mark.caps === 1 && r.mark.aw === 0, r.mark);
  check('run again: a complete reset (start, clock, counts, Watcher, shutter)', r.fresh.mode === 'play' && r.fresh.x === 1.4 && r.fresh.y === 9 && r.fresh.caps === 0 && r.fresh.t === 0 && r.fresh.alarms === 0 && r.fresh.seen === 0 && r.fresh.w === 'search' && r.fresh.shutter === 2.7, r.fresh);

  // 13. the pull control: hidden far away, PULL in reach, WAIT while out, hidden in the air
  r = await ev(() => {
    const { L } = T; T.fresh(50, 0); T.steps(0.1); const far = L.act.on;
    L.player.reset(56.0, 0); T.steps(0.05); const near = { on: L.act.on, ready: L.act.it && L.act.it.ready };
    L.player.reset(57.2, 0); T.steps(0.05); const edge = L.act.on; // inside the wider leave radius
    L.player.reset(56.0, 0); L.I.actPressed = true; T.steps(0.6); const out = { on: L.act.on, ready: L.act.it && L.act.it.ready };
    L.I.jumpPressed = true; L.key.j = true; T.steps(0.15); L.key.j = false; const air = L.act.on;
    return { far, near, edge, out, air };
  });
  check('pull control: hidden away from a cord, PULL in reach, stable at the edge, WAIT while the awning is out, hidden mid-jump', !r.far && r.near.on && r.near.ready && r.edge && r.out.on && !r.out.ready && !r.air, r);

  console.log(pass + '/' + total + ' threat checks');
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
