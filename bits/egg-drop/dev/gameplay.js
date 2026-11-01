// Gameplay checks 18-21 in headless Chromium, stepping the real game loop by hand.
const { open } = require('./shot');
const res = [];
const ok = (n, c, i) => res.push([c ? 'PASS' : 'FAIL', n, i == null ? '' : i]);
(async () => { try {
  const { page, errors, close } = await open('');
  await page.evaluate(() => {
    window.__manual = true;
    const E = window.__egg;
    // record milestones with the run time they fired at
    window.__ms = [];
    const orig = window.__ctx.platform.milestone;
    window.__ctx.platform.milestone = (n, p) => { window.__ms.push([n, E.run ? +E.run.t.toFixed(4) : null]); orig(n, p); };
    E.drag.id = 7; E.sim.target = 0; E.beginRun();
    window.__bot = () => {
      const s = E.sim, e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
      const want = Math.max(-0.2, Math.min(0.2, 0.12 * e.x + 0.16 * v.x));
      s.target = Math.max(-1.36, Math.min(1.36, -(s.egg.getMass() / s.cw.getMass()) * e.x - 1.2 * (want - a) + 0.25 * w));
    };
  });
  // 18. timer: advances by exactly the simulated steps, also through frame hitches; display follows it
  const t = await page.evaluate(() => {
    const E = window.__egg, out = { jumps: 0, back: 0, steps: 0 };
    let last = E.run.t;
    const frames = [16.7, 16.7, 33.4, 8.3, 100, 16.7, 250, 16.7];   // includes a 100 ms and a 250 ms hitch
    for (let k = 0; k < 120; k++) {
      window.__bot(); window.__loopStep(frames[k % frames.length]);
      const d = E.run.t - last; if (d < -1e-9) out.back++; if (d > 12 / 120 + 1e-9) out.jumps++; last = E.run.t;
    }
    out.t = E.run.t; out.stepsExact = Math.abs(E.run.t * 120 - Math.round(E.run.t * 120)) < 1e-6;
    return out;
  });
  ok('18 timer advances in whole simulation steps, never backwards, never more than one frame budget at once', t.back === 0 && t.jumps === 0 && t.stepsExact, JSON.stringify(t));
  // 20. difficulty: thresholds at 10 / 25 / 45 s, each announced once
  await page.evaluate(() => { const E = window.__egg; let n = 0; while (E.state === 'play' && E.run.t < 50 && n++ < 20000) { window.__bot(); window.__loopStep(1000 / 60); } });
  const ph = await page.evaluate(() => ({ ms: window.__ms.filter(m => /^phase_/.test(m[0])), state: window.__egg.state, t: window.__egg.run.t }));
  const names = ph.ms.map(m => m[0]).join(','), at = ph.ms.map(m => m[1]);
  ok('20 difficulty phases fire once each at 10, 25 and 45 s', ph.state === 'play' && names === 'phase_instability,phase_pressure,phase_survival' && Math.abs(at[0] - 10) < 0.01 && Math.abs(at[1] - 25) < 0.01 && Math.abs(at[2] - 45) < 0.01, `${names} at ${at.join(', ')} s (run at ${ph.t.toFixed(1)} s, ${ph.state})`);
  // 21a. a single frame with the egg off the deck does not end the run
  const blip = await page.evaluate(() => {
    const E = window.__egg, s = E.sim, b = s.egg, pos = b.getPosition().clone(), ang = b.getAngle(), v = b.getLinearVelocity().clone(), w = b.getAngularVelocity();
    b.setTransform(window.planck.Vec2(3.2, -1.0), ang); window.__loopStep(1000 / 120);   // one physics step "fallen"
    b.setTransform(pos, ang); b.setLinearVelocity(v); b.setAngularVelocity(w);
    for (let i = 0; i < 30; i++) { window.__bot(); window.__loopStep(1000 / 60); }
    return E.state;
  });
  ok('21a a one-step glitch off the deck does not end the run', blip === 'play', blip);
  // 21b. the platform at its stop is not game over
  const stop = await page.evaluate(() => {
    const E = window.__egg; let maxA = 0, ended = false;
    for (let i = 0; i < 120 && maxA < 0.25 && Math.abs(E.sim.eggLocal().x) < 1.8; i++) { E.sim.target = 1.36; window.__loopStep(1000 / 60); maxA = Math.max(maxA, Math.abs(E.sim.angle())); if (E.state !== 'play') ended = true; }
    return { maxA, ended, x: E.sim.eggLocal().x };
  });
  ok('21b driving the platform to its stop does not end the run by itself', !stop.ended && stop.maxA >= 0.25, JSON.stringify(stop));
  // 21c / 19. real fall: game over, timer frozen at the fall, score = 10 x time + bonuses
  const end = await page.evaluate(() => {
    const E = window.__egg; let n = 0, tAtFall = null, shownAtFall = null;
    while (E.state === 'play' && n++ < 2000) { E.sim.target = 1.36; window.__loopStep(1000 / 60); }
    tAtFall = E.run.fellAt;
    const egg = E.sim.eggLocal();
    for (let i = 0; i < 300 && E.state !== 'results'; i++) window.__loopStep(1000 / 60);
    const c = E.run.counts;
    return { state: E.state, fellAt: tAtFall, runTAfter: E.run.t, eggXAtFall: egg.x, bonus: E.run.bonus, counts: c, expectBonus: 25 * c.steady + 100 * c.rescue + 60 * c.weathered + 20 * c.light };
  });
  await page.waitForTimeout(400);
  const sub = await page.evaluate(() => window.__events.filter(e => e[0] === 'submit').map(e => [e[1], e[2]]));
  const sTime = (sub.find(x => x[0] === 'time') || [])[1], sScore = (sub.find(x => x[0] === 'score') || [])[1];
  ok('21c egg fell past the deck end, results shown after it lands', end.state === 'results' && Math.abs(end.eggXAtFall) > 2.0, `egg ${end.eggXAtFall.toFixed(2)} m from centre at the fall; ${end.state}`);
  ok('18b timer stops at the fall', Math.abs(end.runTAfter - end.fellAt) < 1e-9, `fell at ${end.fellAt.toFixed(3)} s, timer after the fall ${end.runTAfter.toFixed(3)} s`);
  ok('19 score: time counted once (10 points a second) plus bonuses; submitted values match', sTime === Math.round(end.fellAt * 1000) && sScore === Math.floor(end.fellAt * 10) + end.bonus && end.bonus === end.expectBonus, `time ${sTime} ms, score ${sScore} = ${Math.floor(end.fellAt * 10)} + bonus ${end.bonus} (${JSON.stringify(end.counts)})`);
  ok('no page errors', errors.length === 0, errors.join('|'));
  await close();
} catch (e) { res.push(['FAIL', 'test harness error', String(e).split('\n')[0]]); }
  for (const r of res) console.log(r.join('  '));
  console.log(res.filter(r => r[0] === 'PASS').length + '/' + res.length + ' passed');
  process.exit(res.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
