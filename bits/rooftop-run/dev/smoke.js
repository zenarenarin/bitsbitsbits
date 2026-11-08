// Headless browser smoke test on an emulated phone: boot, real touch input
// (stick and jump at once), an autopilot run through the whole slice to the
// relay, and screenshots of each beat in landscape and portrait.
// Usage: (serve this folder on :8765) node dev/smoke.js <outdir>
const { chromium } = require('playwright');
const pilot = require('./pilot.js');
const out = process.argv[2] || '.';
const shots = process.argv.includes('--no-shots') ? false : true;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let pass = 0, total = 0; const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
  for (const [label, vp] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }]]) {
    const bctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await bctx.newPage();
    page.setDefaultTimeout(240000);   // SwiftShader renders slowly; this is the software renderer, not the game
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('http://localhost:8765/dev/index.html');
    await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 90000 });
    const initErr = await page.evaluate(() => window.__initError || null);
    check(`${label}: boots`, !initErr, initErr || undefined);
    if (shots) await page.screenshot({ path: `${out}/${label}-0-title.png` });
    const cdp = await bctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id })) });
    await page.evaluate(() => { window.__rr.begin(); window.__rr.freeze(true); });
    // real touches: left thumb steers, right thumb jumps, at the same time
    const W = vp.width, H = vp.height;
    const L0 = { x: W * 0.18, y: H * 0.75, id: 1 }, R0 = { x: W * 0.85, y: H * 0.7, id: 2 };
    await page.evaluate(() => window.__rr.advance(0.6));
    await touch('touchStart', [L0]);
    await touch('touchMove', [{ ...L0, x: L0.x + 40 }]);
    await touch('touchStart', [{ ...L0, x: L0.x + 40 }, R0]);
    const both = await page.evaluate(() => { const r = window.__rr, p = r.input.state.presses, s = r.input.sample(1 / 60); r.input.state.presses = p; return { steer: s.steer, jump: s.jumpPressed, held: s.jumpHeld }; });
    check(`${label}: stick and jump work at the same time`, both.steer > 0.5 && both.jump && both.held, both);
    await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__rr.sim(undefined); window.__rr.frame(); });
    const jumped = await page.evaluate(() => ({ air: !window.__rr.cat.grounded, vy: window.__rr.cat.vel[1] }));
    check(`${label}: a real touch on the jump zone jumps`, jumped.air, jumped);
    await touch('touchEnd', [{ ...L0, x: L0.x + 40 }]);
    await touch('touchEnd', []);
    const released = await page.evaluate(() => ({ stick: !!window.__rr.input.state.stick, held: window.__rr.input.state.jumpHeld }));
    check(`${label}: releasing both clears the input`, !released.stick && !released.held, released);
    // the endless run: autopilot through three sections, then a deliberate run of falls to game over
    await page.evaluate(pilot);
    await page.evaluate(() => { window.__rr.restart(); window.__rr.freeze(true); });
    const beats = [[-40.5, 'climbing-pipe'], [-50, 'rope-bridge'], [-67.8, 'squeeze'], [-96.5, 'relay-1'], [-150, 'section-2'], [-205, 'relay-2'], [-320, 'section-4']];
    for (const [z, name] of beats) {
      await page.evaluate(z => { const r = window.__rr, c = r.cat; let n = 0; while (c.pos[2] > z && n++ < 6000 && r.mode === 'play') { r.sim(window.__pilot(c, r.hazards)); if (n % 3 === 0) r.frame(); } for (let i = 0; i < 6; i++) r.frame(); }, z);
      if (shots) await page.screenshot({ path: `${out}/${label}-${name}.png` });
    }
    const st = await page.evaluate(() => { const r = window.__rr.run; return { distance: Math.round(r.distance), relays: r.relays, lives: r.lives, sections: r.sections.map(s => s.index), mode: window.__rr.mode, fragments: r.fragments }; });
    check(`${label}: endless run: three relays passed, no end screen, sections disposed behind`, st.relays >= 3 && st.mode === 'play' && st.sections[0] >= 2 && st.lives === 7, st);
    const over = await page.evaluate(() => { const r = window.__rr; let n = 0, lost = 0; while (r.mode === 'play' && n++ < 60 * 120) { r.sim({ steer: 1 }); if (n % 10 === 0) r.frame(); } r.frame(); return { mode: r.mode, lives: r.run.lives, card: document.querySelector('.rr-card.on') && document.querySelector('.rr-card.on').textContent.slice(0, 80) }; });
    check(`${label}: seven lives lost ends the run with the result card`, over.mode === 'over' && over.lives === 0 && /SEVEN LIVES/.test(over.card || ''), over);
    if (shots) await page.screenshot({ path: `${out}/${label}-game-over.png` });
    const calls = await page.evaluate(() => { const r = window.__rr; r.restart(); r.freeze(true); r.warp(2); r.frame(); return r.renderer.info.render.calls; });
    check(`${label}: draw calls under 180`, calls < 180, calls);
    check(`${label}: no page errors`, errs.length === 0, errs.slice(0, 3));
    await bctx.close();
  }
  await browser.close();
  console.log(`\n${pass}/${total} passed`);
})();
