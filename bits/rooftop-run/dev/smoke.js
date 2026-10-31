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
    // autopilot through the slice, rendering every step, with a screenshot at each beat
    await page.evaluate(pilot);
    await page.evaluate(() => {
      const r = window.__rr, c = r.cat;
      window.__falls = 0;
      window.__runTo = (zt) => {
        let prev = c.pos[2], crouched = 0;
        for (let i = 0; i < 60 * 30 && c.pos[2] > zt && r.mode !== 'result'; i++) {
          r.sim(window.__pilot(c, r.hazards)); if (c.crouch) crouched = 1;
          if (c.pos[2] > prev + 3) window.__falls++;
          prev = c.pos[2];
          if (i % 2 === 0) r.frame();
        }
        r.frame();
        return { z: +c.pos[2].toFixed(2), y: +c.pos[1].toFixed(2), crouched, falls: window.__falls, charge: r.hazards.charge, mode: r.mode };
      };
      r.restart();
    });
    const beats = [[-8.5, 'roof'], [-19, 'ridge'], [-33, 'pipe'], [-40, 'narrow-pipe'], [-51.6, 'squeeze'], [-55.4, 'unstable'], [-66.5, 'tin-roof'], [-200, 'relay']];
    for (const [z, name] of beats) {
      const st = await page.evaluate(z => window.__runTo(z), z);
      if (name === 'squeeze') check(`${label}: squeezes under the low pipe`, st.crouched === 1, st);
      if (shots) await page.screenshot({ path: `${out}/${label}-${name}.png` });
    }
    const fin = await page.evaluate(() => { const r = window.__rr; for (let i = 0; i < 160; i++) { r.sim(window.__pilot(r.cat, r.hazards)); r.frame(); } return { mode: r.mode, charge: r.hazards.charge, falls: window.__falls }; });
    check(`${label}: autopilot reaches the relay with all fragments and no falls`, fin.mode === 'result' && fin.charge === 3 && fin.falls === 0, fin);
    if (shots) await page.screenshot({ path: `${out}/${label}-result.png` });
    const calls = await page.evaluate(() => { const r = window.__rr; r.restart(); r.warp(2); r.frame(); return r.renderer.info.render.calls; });
    check(`${label}: draw calls under 160`, calls < 160, calls);
    check(`${label}: no page errors`, errs.length === 0, errs.slice(0, 3));
    await bctx.close();
  }
  await browser.close();
  console.log(`\n${pass}/${total} passed`);
})();
