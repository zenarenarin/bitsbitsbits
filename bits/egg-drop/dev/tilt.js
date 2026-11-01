// Phone-tilt tests in headless Chromium against the dev harness's emulated sensors.
// These prove the code paths; they are not a physical-device test.
const { open } = require('./shot');
const res = [];
const ok = (n, c, i) => res.push([c ? 'PASS' : 'FAIL', n, i == null ? '' : i]);
const T = (page, f, a) => page.evaluate(f, a);
const tiltBtn = '.ed-mode button[aria-label="Phone tilt control"]';
const touchBtn = '.ed-mode button[aria-label="Touch control"]';
const settle = (page, ms) => page.waitForTimeout(ms || 120);
async function feed(page, kind, deg, ms) {
  // send samples at ~60 Hz for ms
  const n = Math.round((ms || 300) / 16);
  for (let i = 0; i < n; i++) {
    if (kind === 'host') await T(page, d => window.__motionSample(d), deg);
    else await T(page, d => window.__orient(30, d), deg);   // beta 30 (phone held up), gamma = tilt
    await page.waitForTimeout(16);
  }
}
(async () => { try {
  // --- 10. iOS-style browser permission (DeviceOrientationEvent.requestPermission) granted
  {
    const { page, errors, close } = await open('?iosperm=granted');
    await page.click(tiltBtn); await settle(page);
    const ev = await T(page, () => window.__events.map(e => e[0]));
    const st = await T(page, () => document.querySelector('.ed-tp .st').textContent);
    ok('10 iOS-style permission requested from the tap and granted', ev.includes('requestPermission') && /granted/i.test(st), st);
    // 12. calibration
    await feed(page, 'browser', 9, 200);
    await page.click('.ed-tp .cal'); await feed(page, 'browser', 9, 100);
    const cal = await T(page, () => ({ st: document.querySelector('.ed-tp .st').textContent, done: document.querySelector('.ed-tp .done').disabled }));
    ok('12 calibration takes the current pose as zero', /\+?0\.0°|-0\.0°/.test(cal.st) && !cal.done, JSON.stringify(cal));
    await page.click('.ed-tp .done');
    // start the run by tilting, then 13. right/left response through the carriage
    // short tilts, so the egg is still on the deck for the neutral and jitter checks that follow
    await feed(page, 'browser', 9 + 12, 350);
    let r = await T(page, () => ({ state: window.__egg.state, cw: window.__egg.sim.cwPos(), target: window.__egg.sim.target }));
    ok('13a tilting right moves the weight right (and starts the run)', r.state === 'play' && r.cw > 0.3, JSON.stringify(r));
    await feed(page, 'browser', 9 - 12, 450);
    r = await T(page, () => ({ cw: window.__egg.sim.cwPos() }));
    ok('13b tilting left moves the weight left', r.cw < -0.3, JSON.stringify(r));
    // 14. back to neutral
    await feed(page, 'browser', 9, 700);
    r = await T(page, () => ({ state: window.__egg.state, cw: window.__egg.sim.cwPos(), target: window.__egg.sim.target }));
    ok('14 returning to neutral brings the weight back to the centre', r.state === 'play' && Math.abs(r.target) < 0.01 && Math.abs(r.cw) < 0.05, JSON.stringify(r));
    // 15. noise: +-0.8 deg jitter around neutral stays inside the dead zone; jitter at an offset is smoothed
    let maxT = 0;
    for (let i = 0; i < 40; i++) { await T(page, d => window.__orient(30, d), 9 + (i % 2 ? 0.8 : -0.8)); await page.waitForTimeout(16); maxT = Math.max(maxT, Math.abs(await T(page, () => window.__egg.tilt.value * 1.36))); }
    const st15 = await T(page, () => window.__egg.state);
    ok('15a sensor jitter (±0.8°) at neutral does not move the weight', maxT < 0.005, 'tilt input -> carriage target, max ' + maxT.toFixed(4) + ' m');
    const tg = [];
    for (let i = 0; i < 60; i++) { await T(page, d => window.__orient(30, d), 9 + 8 + (i % 2 ? 1.5 : -1.5)); await page.waitForTimeout(16); tg.push(await T(page, () => window.__egg.tilt.value * 1.36)); }
    const tail = tg.slice(30), mean = tail.reduce((a, b) => a + b, 0) / tail.length, sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    const rawSwing = await T(page, () => { const E = window.__egg, u1 = E.tiltCurve(8 + 1.5, E.tilt.sensitivity), u0 = E.tiltCurve(8 - 1.5, E.tilt.sensitivity); return (u1 - u0) * 1.36; });
    ok('15b ±1.5° jitter at a steady tilt is smoothed', sd < rawSwing * 0.35, `target ${mean.toFixed(3)} m ± ${sd.toFixed(4)} (unsmoothed swing would be ±${(rawSwing / 2).toFixed(3)})`);
    ok('no page errors (iOS path)', errors.length === 0, errors.join('|'));
    await close();
  }
  // --- 11. Android-style: no requestPermission, events just flow
  {
    const { page, errors, close } = await open('');
    await page.click(tiltBtn); await settle(page);
    await feed(page, 'browser', 4, 200);
    const st = await T(page, () => ({ st: document.querySelector('.ed-tp .st').textContent, req: window.__events.some(e => e[0] === 'requestPermission') }));
    ok('11 Android-style: sensor data arrives and is accepted (Chromium answers requestPermission with "denied" yet sends events)', /sensor live/.test(st.st) && !/denied/i.test(st.st), st.st);
    // orientation change asks for a new zero
    await page.click('.ed-tp .cal'); await feed(page, 'browser', 4, 60);
    await T(page, () => window.dispatchEvent(new Event('orientationchange')));
    await feed(page, 'browser', 4, 60);
    const st2 = await T(page, () => document.querySelector('.ed-tp .st').textContent);
    ok('  screen rotation clears the calibration', /not calibrated/.test(st2), st2);
    // landscape mapping: with the screen rotated 90°, the device's y axis is the screen's horizontal
    const m = (await T(page, () => { const f = window.__egg.lateralFromOrientation; return [f(0, 20, 0), f(0, -20, 0), f(60, 15, 0), f(20, 0, 90), f(20, 0, 270)]; })).map(v => +v.toFixed(1));
    ok('  axis mapping: right edge down = right, in portrait and both landscapes', m[0] > 19 && m[1] < -19 && m[2] > 7 && m[3] > 19 && m[4] < -19, 'portrait +20/-20, held at 60° with gamma 15: ' + m.slice(0, 3).join(', ') + '; landscape 90/270 with beta 20: ' + m.slice(3).join(', '));
    ok('no page errors (Android path)', errors.length === 0, errors.join('|'));
    await close();
  }
  // --- host (Plethora app) motion path, granted
  {
    const { page, errors, close } = await open('?motion&motionok');
    await page.click(tiltBtn); await settle(page);
    await feed(page, 'host', 3, 200);
    await page.click('.ed-tp .cal'); await feed(page, 'host', 3, 60); await page.click('.ed-tp .done');
    const ev = await T(page, () => window.__events.map(e => e[0]));
    await feed(page, 'host', 3 + 14, 350);
    const r = await T(page, () => ({ state: window.__egg.state, cw: window.__egg.sim.cwPos(), source: window.__egg.tilt.source }));
    ok('  Plethora app path: host motion started from the tap, calibrated, steers the weight', ev.includes('motion.start') && ev.includes('motion.calibrate') && r.source === 'plethora' && r.state === 'play' && r.cw > 0.2, JSON.stringify(r));
    ok('no page errors (host path)', errors.length === 0, errors.join('|'));
    await close();
  }
  // --- a lost sensor mid-run hands control back to touch
  {
    const { page, errors, close } = await open('?motion&motionok');
    await page.click(tiltBtn); await settle(page);
    await feed(page, 'host', 0, 200);
    await page.click('.ed-tp .cal'); await feed(page, 'host', 0, 60); await page.click('.ed-tp .done');
    const L = await T(page, () => ({ ...window.__egg.L }));
    await page.mouse.click(L.px, L.py + 100);            // a tap starts the run in tilt mode
    await feed(page, 'host', 0, 300);
    const before = await T(page, () => window.__egg.state);
    await page.waitForTimeout(1800);                     // the sensor goes quiet
    const lost = await T(page, () => ({ state: window.__egg.state, mode: window.__egg.mode, toast: window.__egg.fx.toast && window.__egg.fx.toast.text }));
    ok('  a lost sensor mid-run falls back to touch', before === 'play' && lost.state === 'play' && lost.mode === 'touch' && /lost/.test(lost.toast || ''), 'before: ' + before + ', after 1.8 s of silence: ' + JSON.stringify(lost));
    if (errors.length) ok('no page errors (signal loss)', false, errors.join('|'));
    await close();
  }
  // --- 17. denial and fallbacks
  for (const [q, label, expect] of [['?iosperm=denied', 'iOS permission denied', /refused/], ['?motion', 'host motion denied, no browser sensor left', null], ['?nodoe', 'no motion API at all', /no motion data/], ['?insecure', 'insecure (http) page', /secure/]]) {
    const { page, errors, close } = await open(q);
    await page.click(tiltBtn); await settle(page, 250);
    const r = await T(page, () => ({ msg: document.querySelector('.ed-tp .msg').textContent, st: document.querySelector('.ed-tp .st').textContent, done: document.querySelector('.ed-tp .done').disabled }));
    await page.click('.ed-tp .use-touch');
    const L = await T(page, () => ({ ...window.__egg.L }));
    await page.mouse.move(L.px, L.py + 100); await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(L.px + i * 15, L.py + 100); await page.waitForTimeout(16); }
    await page.waitForTimeout(300);
    const after = await T(page, () => ({ state: window.__egg.state, cw: window.__egg.sim.cwPos() }));
    await page.mouse.up();
    const msgOk = expect ? expect.test(r.msg) : r.done;
    ok(`17 ${label}: clear message, touch still plays`, msgOk && r.done && after.state === 'play' && after.cw > 0.3, `"${r.msg}" [${r.st}] -> touch drag moved weight to ${after.cw.toFixed(2)} m`);
    if (errors.length) ok('no page errors ' + q, false, errors.join('|'));
    await close();
  }
  // --- 16. switching modes, and restart clears residual input
  {
    const { page, errors, close } = await open('');
    await page.click(tiltBtn); await settle(page); await feed(page, 'browser', 0, 100);
    await page.click('.ed-tp .cal'); await feed(page, 'browser', 0, 60); await page.click('.ed-tp .done');
    let sel = await T(page, () => document.querySelector('.ed-mode button.sel').getAttribute('aria-label'));
    ok('16a selecting Phone tilt shows it as the active mode', /tilt/i.test(sel), sel);
    // in tilt mode a touch drag does not fight the phone
    const L = await T(page, () => ({ ...window.__egg.L }));
    await page.mouse.move(L.px, L.py + 100); await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(L.px + i * 15, L.py + 100); await T(page, () => window.__orient(30, 0)); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(200);
    let r = await T(page, () => ({ state: window.__egg.state, cw: window.__egg.sim.cwPos(), locked: document.querySelector('.ed-mode').classList.contains('locked') }));
    ok('16b in tilt mode a tap starts the run, dragging does not override the phone', r.state === 'play' && Math.abs(r.cw) < 0.05 && r.locked, JSON.stringify(r));
    // finish this run quickly, then switch to touch at the results screen
    await T(page, () => { const E = window.__egg; E.sim.egg.setTransform(window.planck.Vec2(3.5, -1.0), 0); E.sim.egg.setAwake(true); });
    for (let i = 0; i < 80; i++) { await T(page, () => window.__orient(30, 0)); await page.waitForTimeout(40); if (await T(page, () => window.__egg.state === 'results')) break; }
    await page.waitForFunction(() => window.__egg.state === 'results', null, { timeout: 6000 });
    await page.click(touchBtn);
    sel = await T(page, () => document.querySelector('.ed-mode button.sel').getAttribute('aria-label'));
    ok('16c switching back to touch at the results screen', /Touch/.test(sel), sel);
    // 22. restart without residual physics or input
    await page.click('.ed-again');
    r = await T(page, () => { const E = window.__egg, s = E.sim; return { state: E.state, cw: s.cwPos(), target: s.target, ang: s.angle(), ex: s.eggLocal().x, w: s.platform.getAngularVelocity(), tiltValue: E.tilt.value, drag: E.drag.id, zoom: E.fx.zoom }; });
    ok('22 restart: fresh world, no carried-over input', r.state === 'ready' && Math.abs(r.cw) < 1e-3 && r.target === 0 && Math.abs(r.ang) < 1e-3 && Math.abs(r.ex) < 0.05 && r.tiltValue === 0 && r.drag === null, JSON.stringify(r));
    ok('no page errors (switching)', errors.length === 0, errors.join('|'));
    await close();
  }
  } catch (e) { res.push(['FAIL', 'test harness error', String(e).split('\n')[0]]); }
  for (const r of res) console.log(r.join('  '));
  console.log(res.filter(r => r[0] === 'PASS').length + '/' + res.length + ' passed');
  process.exit(res.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
