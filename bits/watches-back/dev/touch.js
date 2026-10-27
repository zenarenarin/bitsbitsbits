// Real touch input on an emulated phone (CDP touch events -> pointer events):
// the stick walks, a touch on an eye holds it, the gaze stays after the finger lifts,
// the dial turns the spiral, two fingers at once, pause, and Encounter 1 played by touch alone.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await bctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const cdp = await bctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id })) });
  const frames = (n, dt) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__wtb.frame(dt); }, [n, dt || 1 / 60]);
  let pass = 0, total = 0; const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
  // tap BEGIN
  const bb = await page.evaluate(() => { const r = window.__wtb.H.begin.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(bb.x, bb.y);
  await frames(5);
  check('title: tapping BEGIN starts the campaign', await page.evaluate(() => window.__wtb.mode === 'card' || window.__wtb.mode === 'play'));
  await frames(30);
  await touch('touchStart', [{ x: 195, y: 300, id: 9 }]); await touch('touchEnd', []);
  await frames(3);
  check('act card: a tap dismisses it', await page.evaluate(() => window.__wtb.mode === 'play'));
  // stick: drag right in the lower left -> the traveller walks (counter-clockwise at the bottom)
  const a0 = await page.evaluate(() => window.__wtb.S.P.a);
  await touch('touchStart', [{ x: 90, y: 760, id: 1 }]);
  await touch('touchMove', [{ x: 140, y: 760, id: 1 }]);
  await frames(60);
  const a1 = await page.evaluate(() => window.__wtb.S.P.a);
  check('stick: dragging in the lower left walks the traveller', a1 > a0 + 0.1, { a0, a1 });
  await page.screenshot({ path: out + '/t1_walk.png' });
  // second finger on the eye while still walking: both at once
  await frames(30);
  const eye = await page.evaluate(() => { const w = window.__wtb; return { s: w.screenOf('first'), state: w.S.eye('first').state }; });
  await touch('touchMove', [{ x: 140, y: 760, id: 1 }, { x: eye.s[0], y: eye.s[1], id: 2 }]);
  await touch('touchStart', [{ x: 140, y: 760, id: 1 }, { x: eye.s[0], y: eye.s[1], id: 2 }]);
  await frames(20);
  const st = await page.evaluate(() => ({ st: window.__wtb.S.eye('first').state, k: window.__wtb.S.P.k, v: window.__wtb.S.P.v }));
  check('gaze: a touch on the eye pins it while the other thumb walks', st.st === 'pinned' && Math.abs(st.v) > 0.2, st);
  await page.screenshot({ path: out + '/t2_pin.png' });
  // lift the gaze finger: gaze persists
  await touch('touchEnd', [{ x: 140, y: 760, id: 1 }]);
  await frames(30);
  check('gaze: it stays held after the finger lifts', await page.evaluate(() => window.__wtb.S.eye('first').state === 'pinned'));
  // walk to the opening and push toward the centre with the stick
  await touch('touchEnd', []);
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => { const S = window.__wtb.S; const nd = S.nearestDoor(S.P.k, S.playerTheta(), true); return { k: S.P.k, dth: nd ? nd.dth : 0, arc: nd ? nd.arc : 9, th: S.playerTheta(), mode: window.__wtb.mode }; });
    if (s.k > 0 || s.mode !== 'play') break;
    // a screen direction: along the tangent toward the door, or toward the centre when near
    let dx, dy;
    if (s.arc > 0.4) { const t = Math.sign(s.dth); dx = -Math.sin(s.th) * t; dy = -Math.cos(s.th) * t; } else { dx = -Math.cos(s.th); dy = Math.sin(s.th); }
    if (i === 0) await touch('touchStart', [{ x: 90, y: 760, id: 3 }]);
    await touch('touchMove', [{ x: 90 + dx * 40, y: 760 + dy * 40, id: 3 }]);
    await frames(6);
  }
  await touch('touchEnd', []);
  console.log(JSON.stringify(await page.evaluate(() => { const w = window.__wtb, S = w.S; return { mode: w.mode, th: S.playerTheta() * 57.3, k: S.P.k, eye: S.eye('first').state, eth: S.eyeTheta(S.eye('first')) * 57.3, over: S.over, t: S.t }; })));
  const k = await page.evaluate(() => window.__wtb.S.P.k);
  check('stick: pushing toward the centre at the opening steps through', k === 1, { k });
  // the dial: in encounter 4 (rotation unlocked), drag in the lower right
  await page.evaluate(() => window.__wtb.goto(4)); await frames(5);
  const phi0 = await page.evaluate(() => window.__wtb.S.phi[1]);
  await touch('touchStart', [{ x: 300, y: 770, id: 4 }]); await touch('touchMove', [{ x: 350, y: 770, id: 4 }]);
  await frames(40);
  const phi1 = await page.evaluate(() => window.__wtb.S.phi.slice());
  await page.screenshot({ path: out + '/t3_dial.png' });
  await touch('touchEnd', []); await frames(20);
  const phi2 = await page.evaluate(() => window.__wtb.S.phi[1]);
  check('dial: dragging in the lower right turns the spiral; the ring underfoot holds', Math.abs(phi1[1] - phi0) > 0.3 && phi1[0] === 0, { phi0, phi1 });
  await frames(10);
  check('dial: releasing it stops the turn', Math.abs((await page.evaluate(() => window.__wtb.S.phi[1])) - phi2) < 0.05);
  // stuck input: a touch cancelled by the system must not keep walking
  await touch('touchStart', [{ x: 90, y: 760, id: 5 }]); await touch('touchMove', [{ x: 140, y: 760, id: 5 }]);
  await touch('touchCancel', []);
  await frames(30);
  check('cancel: a cancelled touch stops the walk', Math.abs(await page.evaluate(() => window.__wtb.S.P.v)) < 0.05);
  // pause
  const pb = await page.evaluate(() => { const r = window.__wtb.H.pause.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(pb.x, pb.y); await frames(5);
  const t0 = await page.evaluate(() => window.__wtb.S.t); await frames(30);
  check('pause: the button pauses and time stops', await page.evaluate(t0 => window.__wtb.mode === 'paused' && window.__wtb.S.t === t0, t0));
  await page.screenshot({ path: out + '/t4_pause.png' });
  console.log(pass + '/' + total + ' touch checks'); if (errs.length) console.log(errs.join('\n'));
  await browser.close();
  process.exit(pass === total ? 0 : 1);
})();
