// Headless browser smoke test on an emulated phone: boot, real touch input
// (stick and jump at once), an autopilot run through the whole lab, and
// screenshots of each beat in landscape and portrait.
// Usage: (serve this folder on :8765) node dev/smoke.js <outdir>
const { chromium } = require('playwright');
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
    // autopilot through the lab, stopping at each beat for a screenshot
    await page.evaluate(() => {
      const r = window.__rr, c = r.cat;
      const toward = x => Math.max(-1, Math.min(1, (x - c.pos[0]) * 2.5));
      const plan = z => z > -11 ? 0 : z > -16 ? -0.6 : z > -24 ? 0 : z > -46 ? 0.25 : z > -66 ? 1.4 : 0;
      const jumpAt = [[-29.4, -30.6], [-65.4, -66.4]];
      window.__falls = 0;
      window.__runTo = (zt) => {
        let prev = c.pos[2];
        for (let i = 0; i < 60 * 20 && c.pos[2] > zt; i++) {
          const z = c.pos[2];
          r.sim({ steer: toward(plan(z)), jump: jumpAt.some(([a, b]) => z < a && z > b) });
          if (c.pos[2] > prev + 3) window.__falls++;
          prev = c.pos[2];
        }
        for (let i = 0; i < 4; i++) r.sim({ steer: toward(plan(c.pos[2])) });
        for (let i = 0; i < 45; i++) r.frame();   // let the camera and rig settle
        return { z: c.pos[2], y: c.pos[1], grounded: c.grounded, crouch: c.crouch, falls: window.__falls };
      };
      r.restart();
    });
    const beats = [[-6, 'wide-roof'], [-29.6, 'gap-1-takeoff'], [-31.4, 'gap-1-air'], [-39.4, 'low-passage'], [-53, 'ledge'], [-66.2, 'drop'], [-71, 'landing'], [-94.5, 'end']];
    for (const [z, name] of beats) {
      const st = await page.evaluate(z => window.__runTo(z), z);
      if (name === 'low-passage') check(`${label}: ducks in the low passage`, st.crouch === 1, st);
      if (shots) await page.screenshot({ path: `${out}/${label}-${name}.png` });
    }
    const fin = await page.evaluate(() => window.__runTo(-96));
    check(`${label}: autopilot completes the lab with no falls`, fin.falls === 0, fin);
    const calls = await page.evaluate(() => { window.__rr.frame(); return window.__rr.renderer.info.render.calls; });
    check(`${label}: draw calls under 120`, calls < 120, calls);
    check(`${label}: no page errors`, errs.length === 0, errs.slice(0, 3));
    await bctx.close();
  }
  await browser.close();
  console.log(`\n${pass}/${total} passed`);
})();
