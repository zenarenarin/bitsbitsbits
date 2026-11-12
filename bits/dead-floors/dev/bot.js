// Survival bot: aims at the nearest visible zombie (with human-ish error), fires, backs off
// when they get close, and follows the HUD arrow to ammo/crates. Reports how long it lasts.
// Usage: node dev/bot.js [seconds] [aimError]
const { chromium } = require('playwright');
(async () => {
  const secs = +(process.argv[2] || 200), aimErr = +(process.argv[3] || 0.05);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:8765/dev/index.html');
  await p.waitForFunction(() => window.__DF && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await p.click('.df-b.primary');
  await p.evaluate((aimErr) => {
    const D = __DF;
    setInterval(() => {
      if (D.mode !== 'play') { D.input.keys[' '] = false; return; }
      const P = D.P; let best = null, bd = 20;
      for (const z of D.zombies) { if (z.dead) continue; const d = Math.hypot(z.x - P.x, z.z - P.z); if (d < bd && D.losClear(P.x, P.z, z.x, z.z)) { bd = d; best = z; } }
      let mvx = 0, mvz = 0;
      if (best) {
        P.yaw = Math.atan2(-(best.x - P.x), -(best.z - P.z)) + (Math.random() - 0.5) * aimErr * 2;
        P.pitch = Math.atan2((Math.random() < 0.3 ? best.hy : best.chestY) - 1.62, bd) + (Math.random() - 0.5) * aimErr;
        D.input.keys[' '] = bd < 16;
        if (bd < 4) { mvx = -(best.x - P.x) / bd; mvz = -(best.z - P.z) / bd; }
      } else D.input.keys[' '] = false;
      if ((!best || bd > 7) && D.nav) { mvx = Math.sin(D.nav.ang); mvz = Math.cos(D.nav.ang); if (!best) P.yaw = Math.atan2(-mvx, -mvz); }
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      D.input.mx = mvx * rx + mvz * rz; D.input.mz = mvx * fx + mvz * fz;
      const w = D.curW(), a = D.ammoOf(w.id);
      if (a.mag + a.res === 0) D.cycleWeapon();
    }, 50);
  }, aimErr);
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    await p.waitForTimeout(10000);
    const st = await p.evaluate(() => ({ mode: __DF.mode, t: Math.floor(__DF.RUN.time), hp: Math.round(__DF.P.hp), kills: __DF.RUN.kills, hs: __DF.RUN.headshots, lvl: __DF.RUN.D.level.toFixed(1), alive: __DF.zombies.filter(z => !z.dead).length, guns: __DF.RUN.owned.length, w: __DF.curW().id, ammo: JSON.stringify(__DF.ammoOf(__DF.curW().id)), boxes: __DF.pickups.filter(p => p.kind === 'ammo').length }));
    console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(st));
    if (st.mode === 'dead') break;
  }
  await p.screenshot({ path: __dirname + '/shots/bot_end.png' });
  console.log('errors', errors.length ? errors.join('\n') : 'none', 'loopError', await p.evaluate(() => window.__loopError || null));
  await b.close();
})();
