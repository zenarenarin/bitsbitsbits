// Movement proof: every traversal in the slice, driven through the real controller with the lamps blind.
const { open } = require('./sim');
(async () => {
  const { browser, page, errs } = await open();
  let pass = 0, total = 0;
  const check = (name, ok, info) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(info)); };
  const run = (x, y, seq, face) => page.evaluate(([x, y, seq, face]) => { const L = window.__ll; if (L.mode !== 'play') L.beginRun(); L.watcher.reset(); L.world.reset(); L.at(x, y, face); return L.run(seq, { blind: true }); }, [x, y, seq, face]);
  const last = tr => tr[tr.length - 1];
  let t;
  // I. run, jump the gap, reach the cornice
  t = await run(2.6, 9, [{ d: 0.6, mx: 1 }, { d: 0.9, mx: 1, j: true, jp: true }, { d: 0.6, mx: 1 , until: 'P.x>12.9'}, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.8, my: 1, until: "P.state==='ground'" }]);
  check('I: balcony gap, then grab the cornice and pull up', last(t).y > 11.5 && last(t).st === 'ground', t);
  t = await run(6.5, 9, [{ d: 0.6, mx: 1, until: 'P.x>7.6' }, { d: 1.5, until: "P.state==='ground' || P.state==='pipe'" }, { d: 0.2 }, { d: 4, my: 1, until: "P.state==='ground' && P.y>8.9" }]);
  check('I: fall into the gap, climb the drainpipe back up', last(t).y > 8.9, t);
  // II. roof run over chimneys, and the shimmy route
  const over = until => [{ d: 3, mx: 1, until }, { d: 0.8, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" }];
  t = await run(15, 11.6, [...over('P.x>21'), ...over('P.x>27.4'), ...over('P.x>34'), { d: 3, mx: 1, until: 'P.x>42' }]);
  check('II: run the roof, clearing three chimneys', last(t).x > 41.9 && last(t).y > 11.5, t);
  t = await run(15, 11.6, [{ d: 0.6, my: -1, until: "P.state==='hang'" }, { d: 0.1 }, { d: 14, mx: 1, until: 'P.x>43.5' }]);
  check('II: drop to the roof lip and shimmy beneath it', last(t).st === 'hang' && last(t).x > 43.4, t);
  // III. down the drainpipe or the balconies
  t = await run(42, 11.6, [{ d: 2, mx: 1, until: "P.state==='pipe'" }, { d: 6, my: -1, until: "P.state==='ground'" }]);
  check('III: run off the roof onto the drainpipe and climb down', last(t).y < 0.1 && last(t).st === 'ground', t);
  t = await run(42, 11.6, [{ d: 0.5, mx: 1, until: 'P.x>43.6' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='ground'" }, { d: 0.6, mx: 0.4, until: 'P.x>48.8' }, { d: 1.6, until: "P.state==='ground' && P.y<5" }]);
  check('III: hop down by the balconies', last(t).y < 8 && last(t).st === 'ground', t);
  // IV. pull the cord, walk the awning
  t = await run(55.6, 0, [{ d: 0.5, a: true }, { d: 0.6 }]);
  const aw = await page.evaluate(() => window.__ll.level.awnings[0].t);
  check('IV: the cord unrolls the awning', aw > 0.9, { aw, tr: t });
  t = await run(56, 0, [{ d: 0.3, a: true }, { d: 0.6 }, { d: 0.5, mx: 1, until: 'P.x>59' }, { d: 0.9, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" }]);
  check('IV: the awning out is a platform', last(t).y > 2.8, t);
  t = await run(52.4, 0, [{ d: 0.7, my: 1, until: "P.state==='pipe'" }]);
  // the high road: climb from the street? there is no pipe here; jump up via balconies from D
  t = await run(46.5, 7.8, [{ d: 0.5, mx: 1, until: 'P.x>48.8' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='ground' || P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 1.5, mx: 1, until: 'P.x>54.9' }, { d: 1.4, mx: 1, j: true, jp: true, until: "(P.state==='ground' || P.state==='hang') && P.x>58" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 2, mx: 1, until: 'P.x>63' }, { d: 1.4, mx: 1, j: true, jp: true, until: "(P.state==='ground' || P.state==='hang') && P.x>66" }, { d: 0.6, my: 1, until: "P.state==='ground'" }]);
  check('IV: the high road along the balconies', last(t).x > 66 && last(t).y > 8.3, t);
  // V. the gate: under it, or over it
  t = await run(76, 0, [{ d: 3, mx: 1, until: 'P.x>90' }]);
  check('V: walk the open gate passage', last(t).x > 89.9, t);
  t = await run(78.6, 0, [{ d: 0.5, mx: 1, until: "P.x>79.2" }, { d: 6, my: 1, until: "P.state==='ground' && P.y>11" }, { d: 3, mx: 1, until: 'P.x>87.6' }]);
  check('V: climb over the gatehouse', last(t).y > 11.7 && last(t).x > 87.5, t);
  // slide under a half-closed shutter
  t = await page.evaluate(() => { const L = window.__ll; L.watcher.reset(); L.world.reset(); L.level.shutters[0].y = 1.05; L.at(74, 0); L.world.update = (function (u) { return function (dt, p, w, e) { const s = L.level.shutters[0]; const y = s.y; u(dt, p, { closeShutter: () => false, doorOpen: () => false }, e); s.y = y; }; })(L.world.update); return L.run([{ d: 0.9, mx: 1 }, { d: 1.2, mx: 1, my: -1, until: 'P.x>81' }], { blind: true }); });
  check('V: slide under the half-shut shutter', last(t).x > 80.9, t);
  await page.reload(); await page.waitForFunction(() => window.__ready);
  await page.evaluate(() => { window.__paused = true; });
  await page.evaluate(require('fs').readFileSync(__dirname + '/sim_inject.js', 'utf8'));
  // VI. swing the rope over the cellar
  t = await run(95, 0, [{ d: 1.5, mx: 1, until: 'P.x>98.3' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='rope'" }, { d: 0.9, mx: 1 }, { d: 0.6, mx: -1 }, { d: 0.8, mx: 1, until: 'P.rW < 0 && false' }, { d: 1.5, mx: 1, until: 'P.rAng>0.75' }, { d: 1.5, mx: 1, jp: true, j: true, until: "P.state==='ground'" }]);
  check('VI: swing across the cellar on the rope', last(t).x > 106 && last(t).y > -0.1, t);
  t = await run(97.5, 0, [{ d: 1.5, mx: 1, until: 'P.x>99.6' }, { d: 1.5, until: "P.state==='ground' || P.state==='pipe'" }, { d: 0.6, mx: 1, until: 'P.x>105.6' }, { d: 3, my: 1, until: "P.state==='ground' && P.y>-0.1" }]);
  check('VI: drop into the cellar and climb out', last(t).x > 105 && last(t).y > -0.1, t);
  t = await run(4, 9, [{ d: 0.6, my: -1, until: "P.state==='hang'" }, { d: 0.1 }, { d: 0.6, my: -1, until: "P.state==='ground'" }]);
  check('I: lower yourself from a balcony, let go, land below', last(t).y > 4.5 && last(t).y < 4.7, t);
  // VII. up the pipe, pull the high cord, drop, run under the awning, out through the arch
  t = await run(120, 0, [{ d: 1, mx: 1, until: 'P.x>122.3' }, { d: 4, my: 1, until: "P.state==='ground' && P.y>6" }, { d: 1, mx: 1, until: 'P.x>125.6' }, { d: 0.4, a: true }, { d: 0.6 }, { d: 1.5, mx: 1, until: "P.state==='ground' && P.y<4 && P.x>127.5" }, { d: 4, mx: 1, until: 'L.mode!=="play"' }]);
  check('VII: pull the high cord and run for the arch', (await page.evaluate(() => window.__ll.mode)) === 'result', t);
  t = await run(127.5, 6.4, [{ d: 0.5, mx: 1, until: 'P.x>127.85' }, { d: 4, my: 1, until: "P.state==='ground' && P.y>12" }, { d: 3, mx: 1, until: 'P.x>141' }]);
  check('VII: the rooftop route', last(t).y > 12.9 && last(t).x > 140.9, t);
  console.log(pass + '/' + total + ' movement checks');
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
