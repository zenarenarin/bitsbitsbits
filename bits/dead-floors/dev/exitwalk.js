// Clears the floor and walks the player along the exit compass path; checks the exit triggers.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8765/dev/index.html');
  await p.waitForFunction(() => window.__DF && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await p.click('.df-b.primary');
  for (let floor = 1; floor <= 4; floor++) {
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      const D = __DF; D.killAll(); D.RUN.floorKills = 999; D.openExit(); D.RUN.D.cap = 0;
      const CELL = 3.4, ws = { x: 0, z: 0 };
      clearInterval(window.__wk);
      window.__wk = setInterval(() => {
        if (D.mode !== 'play') return;
        const P = D.P, L = D.L();
        D.flowStep(D.exitFlow, P.x, P.z, ws);
        let tx = ws.x, tz = ws.z;
        const rx = (L.exit.rx + .5) * CELL, rz = (L.exit.ry + .5) * CELL;
        if (Math.hypot(P.x - rx, P.z - rz) < CELL * 0.6) { tx = (L.exit.ex + .5) * CELL; tz = (L.exit.ey + .5) * CELL; }
        const d = Math.hypot(tx - P.x, tz - P.z) || 1;
        P.yaw = Math.atan2(-(tx - P.x), -(tz - P.z));
        D.input.mx = 0; D.input.mz = 1;
      }, 50);
    });
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 60000) {
      await p.waitForTimeout(1000);
      const st = await p.evaluate(() => ({ floor: __DF.RUN.floor, mode: __DF.mode, x: __DF.P.x.toFixed(1), z: __DF.P.z.toFixed(1), d: __DF.exitFlow[Math.floor(__DF.P.z / 3.4) * __DF.L().N + Math.floor(__DF.P.x / 3.4)] }));
      if (st.floor > floor) { ok = true; console.log('floor', floor, 'cleared in', Math.round((Date.now() - t0) / 1000), 's'); break; }
      if ((Date.now() - t0) % 10000 < 1000) console.log(JSON.stringify(st));
    }
    if (!ok) { console.log('STUCK on floor', floor); await p.screenshot({ path: __dirname + '/shots/stuck.png' }); break; }
  }
  await b.close();
})();
