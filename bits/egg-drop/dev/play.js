// Drive a run with real pointer events: grab, drag left/right, let it fall, check results and replay.
const { open } = require('./shot');
const path = require('path');
(async () => {
  const out = process.argv[2] || path.join(__dirname, 'out');
  const { page, errors, close } = await open('');
  const L = await page.evaluate(() => ({ ...window.__egg.L }));
  const cwY = L.py + 0.75 * L.k;
  const checks = [];
  const ok = (name, cond, info) => { checks.push([cond ? 'PASS' : 'FAIL', name, info || '']); };
  // grab the weight with a mouse-type pointer (touch in headless uses the same pointer path)
  await page.mouse.move(L.px, cwY);
  await page.mouse.down();
  let st = await page.evaluate(() => window.__egg.state);
  ok('grab starts run', st === 'play', st);
  // fully left
  for (let i = 0; i <= 20; i++) { await page.mouse.move(L.px - i * 8, cwY); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  let s1 = await page.evaluate(() => ({ cw: window.__egg.sim.cwPos(), ang: window.__egg.sim.angle(), ex: window.__egg.sim.eggLocal().x }));
  ok('cw fully left reaches limit', Math.abs(s1.cw + 1.36) < 0.02, JSON.stringify(s1));
  ok('cw left tilts platform CCW (left down)', s1.ang > 0.05, s1.ang.toFixed(3));
  await page.screenshot({ path: path.join(out, 'play_left.png') });
  await page.mouse.up();
  // hold it right and wait for the fall
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => window.__egg.state !== 'play', null, { timeout: 20000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, 'falling.png') });
  await page.waitForFunction(() => window.__egg.state === 'results', null, { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, 'results.png') });
  const ev = await page.evaluate(() => window.__events.map(e => e[0]));
  ok('start/fail/submit events', ev.includes('start') && ev.includes('fail') && ev.filter(e => e === 'submit').length === 2, ev.join(','));
  // replay
  await page.click('.ed-again');
  st = await page.evaluate(() => window.__egg.state);
  ok('again resets to ready', st === 'ready', st);
  const e2 = await page.evaluate(() => ({ ex: window.__egg.sim.eggLocal().x, ang: window.__egg.sim.angle(), cw: window.__egg.sim.cwPos() }));
  ok('fresh run state', Math.abs(e2.ex) < 0.05 && Math.abs(e2.ang) < 0.01 && Math.abs(e2.cw) < 0.01, JSON.stringify(e2));
  await page.mouse.move(L.px, cwY); await page.mouse.down();
  st = await page.evaluate(() => window.__egg.state);
  ok('second run starts', st === 'play', st);
  for (let i = 0; i <= 20; i++) { await page.mouse.move(L.px + i * 8, cwY); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => ({ cw: window.__egg.sim.cwPos(), ang: window.__egg.sim.angle() }));
  ok('cw fully right reaches limit', Math.abs(s2.cw - 1.36) < 0.02, JSON.stringify(s2));
  ok('cw right tilts platform CW (right down)', s2.ang < -0.05, s2.ang.toFixed(3));
  await page.screenshot({ path: path.join(out, 'play_right.png') });
  await page.mouse.up();
  const starts = await page.evaluate(() => window.__events.filter(e => e[0] === 'start').length);
  ok('platform.start per attempt', starts === 2, starts);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  for (const c of checks) console.log(c.join('  '));
  await close();
  process.exit(checks.some(c => c[0] === 'FAIL') ? 1 : 0);
})();
