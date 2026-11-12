// Bot playthrough: aims at visible zombies, holds fire, follows the exit path. Reports progress.
// Usage: node dev/bot.js [seconds]
const { chromium } = require('playwright');
(async () => {
  const secs = +(process.argv[2] || 150);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:8765/dev/index.html');
  await p.waitForFunction(() => window.__DF && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await p.click('.df-b.primary');
  const startFloor = +(process.argv[3] || 1);
  if (startFloor > 1) { await p.waitForTimeout(1500); await p.evaluate((f) => { for (let i = 1; i < Math.min(f, 12); i++) __DF.giveWeapon(__DF.WEAPONS[i].id); __DF.enterFloor(f, true); }, startFloor); }
  await p.evaluate(() => {
    const D = __DF, CELL = 3.4, ws = { x: 0, z: 0 };
    window.__bot = { floors: [], deaths: 0, samples: [] };
    setInterval(() => {
      if (D.mode !== 'play') { D.input.keys[' '] = false; return; }
      const P = D.P; let best = null, bd = 22;
      for (const z of D.zombies) { if (z.dead) continue; const d = Math.hypot(z.x - P.x, z.z - P.z); if (d < bd && D.losClear(P.x, P.z, z.x, z.z)) { bd = d; best = z; } }
      let mvx = 0, mvz = 0;
      if (best) {
        P.yaw = Math.atan2(-(best.x - P.x), -(best.z - P.z)) + (Math.random() - 0.5) * 0.06;
        P.pitch = Math.atan2(best.chestY - 1.62, bd) + (Math.random() - 0.5) * 0.04;
        D.input.keys[' '] = true;
        if (bd < 3) { mvx = -(best.x - P.x) / bd; mvz = -(best.z - P.z) / bd; }
      } else D.input.keys[' '] = false;
      const L = D.L();
      if (!best || bd > 7) {
        if (D.exitFlow) { D.flowStep(D.exitFlow, P.x, P.z, ws); let tx = ws.x, tz = ws.z; if (D.exitOpen && Math.hypot(P.x - (L.exit.rx + .5) * CELL, P.z - (L.exit.ry + .5) * CELL) < CELL * 1.2) { tx = (L.exit.ex + .5) * CELL; tz = (L.exit.ey + .5) * CELL; } const d = Math.hypot(tx - P.x, tz - P.z) || 1; mvx = (tx - P.x) / d; mvz = (tz - P.z) / d; }
        if (!best) P.yaw = Math.atan2(-mvx, -mvz);
      }
      // world move -> stick
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      D.input.mx = mvx * rx + mvz * rz; D.input.mz = mvx * fx + mvz * fz;
      const w = D.curW(), a = D.ammoOf(w.id);
      if (a.mag + a.res === 0) D.cycleWeapon();
    }, 50);
    setInterval(() => { const R = D.RUN; window.__bot.samples.push([D.mode, R.floor, Math.round(D.P.hp), R.kills, R.floorKills, D.zombies.filter(z => !z.dead).length, D.curW().id, JSON.stringify(D.ammoOf(D.curW().id))]); }, 5000);
  });
  const t0 = Date.now();
  let lastFloor = 1;
  while (Date.now() - t0 < secs * 1000) {
    await p.waitForTimeout(5000);
    const st = await p.evaluate(() => ({ mode: __DF.mode, floor: __DF.RUN.floor, hp: Math.round(__DF.P.hp), kills: __DF.RUN.kills, fk: __DF.RUN.floorKills, q: __DF.RUN.D.quota, alive: __DF.zombies.filter(z => !z.dead).length, w: __DF.curW().id, ammo: JSON.stringify(__DF.ammoOf(__DF.curW().id)), fps: __DF.renderer().info.render.frame }));
    console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(st));
    if (st.floor !== lastFloor) { lastFloor = st.floor; await p.screenshot({ path: __dirname + '/shots/bot_floor' + st.floor + '.png' }); }
    if (st.mode === 'dead') { await p.screenshot({ path: __dirname + '/shots/bot_dead.png' }); break; }
  }
  await p.screenshot({ path: __dirname + '/shots/bot_end.png' });
  console.log('errors', errors.length ? errors.join('\n') : 'none', 'loopError', await p.evaluate(() => window.__loopError || null));
  await b.close();
})();
