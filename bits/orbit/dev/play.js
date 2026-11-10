// End-to-end: real pointer drags on the canvas solve today's puzzle.
// node dev/play.js [outdir] [touch]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || 'dev/out';
  const touch = process.argv[3] === 'touch';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(800);
  let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
  const S = () => page.evaluate(() => { const G = window.__orbit.G; return { rot: G.eng.rot.slice(), moves: G.eng.moves, solved: G.eng.solved, phase: G.phase, vis: G.vis.slice(), sel: G.selected, aligned: G.eng.alignedCount() }; });
  const L = await page.evaluate(() => { const l = window.__orbit.layout(); const g = window.__orbit.board.painter.geom; return { cx: l.cx, cy: l.cy, R: l.R, rings: g.rings }; });
  // Drag ring k by `deg` degrees along its mid radius, starting at angle a0 (deg, 0 = 3 o'clock).
  async function drag(k, deg, a0 = -90, steps = 24) {
    const r = L.rings[k].mid;
    const pts = [];
    for (let i = 0; i <= steps; i++) { const a = (a0 + deg * i / steps) * Math.PI / 180; pts.push([L.cx + Math.cos(a) * r, L.cy + Math.sin(a) * r]); }
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await page.waitForTimeout(8); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
      for (const p of pts.slice(1)) { await page.mouse.move(p[0], p[1]); await page.waitForTimeout(8); }
      await page.mouse.up();
    }
    await page.waitForTimeout(450);
  }
  let s0 = await S();
  ok(s0.phase === 'play' && !s0.solved, 'starts in play, unsolved');
  // 1. One-segment clockwise drag on ring 2 (+35 degrees -> rounds to +1).
  await drag(2, 35);
  let s1 = await S();
  ok(s1.rot[2] === s0.rot[2] + 1 && s1.moves === 1, 'clockwise drag advances one step');
  ok(Math.abs(s1.vis[2] - s1.rot[2] * Math.PI / 6) < 1e-6, 'snap lands exactly on 30-degree grid');
  ok(s1.rot.every((r, i) => i === 2 || r === s0.rot[i]), 'other rings unaffected');
  // 2. Anticlockwise.
  await drag(2, -35);
  let s2 = await S();
  ok(s2.rot[2] === s0.rot[2] && s2.moves === 2, 'anticlockwise drag moves back');
  // 3. Cross the 0/360 boundary: start just left of 9 o'clock (180deg) ... use the top: from -100 to -80 crosses nothing; use 170 -> 200 crosses atan2 +-PI seam.
  await drag(3, 60, 165);
  let s3 = await S();
  ok(s3.rot[3] === s0.rot[3] + 2, 'drag across the atan2 seam is continuous (+60deg = +2) got ' + (s3.rot[3] - s0.rot[3]));
  await drag(3, -60, 195);
  let s4 = await S();
  ok(s4.rot[3] === s0.rot[3], 'reverse across the seam');
  // 4. Full revolution.
  await drag(1, 360, -90, 60);
  let s5 = await S();
  ok(s5.rot[1] === s0.rot[1] + 12 && s5.moves === 2 + 4 + 12, 'full revolution counts 12 moves, got moves ' + s5.moves);
  // 5. Reference ring refuses.
  await drag(0, 60);
  let s6 = await S();
  ok(s6.rot[0] === 0 && s6.moves === s5.moves, 'reference ring does not move');
  // 6. Undo.
  await page.evaluate(() => [...document.querySelectorAll('.ctl')].find(b => b.textContent.includes('Undo')).click());
  await page.waitForTimeout(400);
  let s7 = await S();
  ok(s7.rot[1] === s0.rot[1] && s7.moves === 6, 'undo restores ring and moves');
  // 7. Tap selection + tap controls.
  const r2 = L.rings[4].mid;
  if (touch) await page.touchscreen.tap(L.cx, L.cy - r2); else await page.mouse.click(L.cx, L.cy - r2);
  await page.waitForTimeout(300);
  let s8 = await S();
  ok(s8.sel === 4 && s8.moves === 6, 'tap selects the ring without moving it');
  const vis = await page.evaluate(() => [...document.querySelectorAll('.rot')].map(b => b.classList.contains('on')));
  ok(vis[0] && vis[1], 'step controls appear');
  await page.screenshot({ path: out + '/selected.png' });
  await page.evaluate(() => document.querySelectorAll('.rot')[1].click());
  await page.waitForTimeout(350);
  let s9 = await S();
  ok(s9.rot[4] === s0.rot[4] + 1 && s9.moves === 7, 'clockwise button steps one segment');
  // 8. Hint.
  await page.evaluate(() => [...document.querySelectorAll('.ctl')].find(b => b.textContent.includes('Hint')).click());
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/hint.png' });
  // 9. Solve with real drags, using the engine only to know how far each ring is.
  for (let pass = 0; pass < 3; pass++) {
    const need = await page.evaluate(() => { const G = window.__orbit.G; const r = []; for (let k = 1; k < G.puzzle.ringCount; k++) r.push(G.eng.stepsToAlign(k)); return r; });
    for (let k = 1; k <= need.length; k++) if (need[k - 1]) { await drag(k, need[k - 1] * 30, -90 + 7, 20); }
    if ((await S()).solved) break;
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/solving.png' });
  let s10 = await S();
  ok(s10.solved, 'solved by dragging');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: out + '/complete.png' });
  const log = await page.evaluate(() => window.__log.map(x => x[0]));
  ok(log.includes('record.submit'), 'daily time submitted');
  ok(log.includes('pulse.complete'), 'pulse completion posted');
  ok(log.includes('progress.complete'), 'progress completed');
  const doneOn = await page.evaluate(() => document.querySelector('.done').classList.contains('on'));
  ok(doneOn, 'completion screen visible');
  // 10. Moves after solve are refused.
  await drag(2, 40);
  ok((await S()).moves === s10.moves, 'board locked after solve');
  // 11. Share.
  await page.evaluate(() => [...document.querySelectorAll('.act')].find(b => b.textContent.includes('Share')).click());
  const shared = await page.evaluate(() => window.__shared);
  ok(shared && /ORBIT/.test(shared.text), 'share text: ' + JSON.stringify(shared && shared.text));
  // 12. Next study -> transition -> new theme in play.
  await page.evaluate(() => [...document.querySelectorAll('.act')].find(b => b.textContent.includes('Studies')).click());
  await page.waitForTimeout(450);
  await page.screenshot({ path: out + '/transition.png' });
  await page.waitForTimeout(1800);
  let s11 = await S();
  ok(s11.phase === 'play' && !s11.solved && s11.rot.length === 4, 'study 1 is an easy 4-ring puzzle in play');
  await page.screenshot({ path: out + '/study1.png' });
  // 13. Reload restores today's solved state.
  const store = await page.evaluate(() => JSON.stringify(window.__store));
  await page.evaluate(s => { sessionStorage.setItem('st', s); }, store);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' failures' : 'play: all checks passed');
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
