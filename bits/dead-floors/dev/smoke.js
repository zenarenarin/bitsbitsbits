// Smoke test: boot, title, start, move, aim, fire, kill, exit floor, die, death screen.
// Usage: node dev/smoke.js [outdir]   (serve bits/dead-floors on :8765 first)
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const VW = +(process.env.VW || 402), VH = +(process.env.VH || 874);
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8765/dev/index.html' + (process.argv[3] || ''));
  await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
  await page.screenshot({ path: out + '/00_first.png' });
  await page.waitForFunction(() => window.__DF && window.__DF.mode === 'title' && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/01_title.png' });
  await page.click('.df-b.primary');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '/02_floor1.png' });
  const info = await page.evaluate(() => ({ mode: __DF.mode, P: { x: __DF.P.x, z: __DF.P.z, hp: __DF.P.hp }, zombies: __DF.zombies.length, owned: __DF.RUN.owned, doors: __DF.doors.start.open }));
  console.log('after start', JSON.stringify(info));
  // Walk forward with the stick (touch on the left).
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [{ x: 90, y: VH - 174, id: 1 }]);
  for (let i = 0; i < 10; i++) { await touch('touchMove', [{ x: 90, y: VH - 174 - i * 6, id: 1 }]); await page.waitForTimeout(30); }
  await page.waitForTimeout(1200);
  await touch('touchEnd', []);
  const moved = await page.evaluate(() => ({ x: __DF.P.x, z: __DF.P.z }));
  console.log('after move', JSON.stringify(moved));
  // Look right by dragging on the right side.
  await touch('touchStart', [{ x: VW - 100, y: VH / 2, id: 2 }]);
  for (let i = 0; i < 10; i++) { await touch('touchMove', [{ x: VW - 100 - i * 8, y: VH / 2, id: 2 }]); await page.waitForTimeout(20); }
  await touch('touchEnd', []);
  const yaw = await page.evaluate(() => __DF.P.yaw);
  console.log('yaw', yaw);
  // Put a zombie in front and hold FIRE.
  await page.evaluate(() => {
    const D = __DF; const z = D.spawnFar('walker');
    const fx = -Math.sin(D.P.yaw), fz = -Math.cos(D.P.yaw);
    if (z) { z.x = D.P.x + fx * 4; z.z = D.P.z + fz * 4; }
  });
  await page.waitForTimeout(300);
  const fire = await page.evaluate(() => { const r = document.querySelector('.df-btn.fire').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await touch('touchStart', [{ x: fire.x, y: fire.y, id: 3 }]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: out + '/03_firing.png' });
  await page.waitForTimeout(1500);
  await touch('touchEnd', []);
  const afterFire = await page.evaluate(() => ({ kills: __DF.RUN.kills, ammo: JSON.stringify(__DF.RUN.ammo), score: __DF.RUN.score }));
  console.log('after fire', JSON.stringify(afterFire));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/04_after.png' });
  // Clear the floor and walk into the exit.
  await page.evaluate(() => { const D = __DF; D.RUN.floorKills = 999; D.openExit(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/05_exitopen.png' });
  await page.evaluate(() => { const D = __DF, L = D.L(); D.P.x = (L.exit.ex + 0.5) * 3.4; D.P.z = (L.exit.ey + 0.5) * 3.4; });
  await page.waitForTimeout(3200);
  const f2 = await page.evaluate(() => ({ floor: __DF.RUN.floor, owned: __DF.RUN.owned, mode: __DF.mode }));
  console.log('floor2', JSON.stringify(f2));
  await page.screenshot({ path: out + '/06_floor2.png' });
  // Boss floor.
  await page.evaluate(() => { __DF.enterFloor(5, false); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const D = __DF, L = D.L(); const a = L.arena; D.P.x = (a.x + 1.5) * 3.4; D.P.z = (a.y + a.h / 2) * 3.4; D.P.yaw = -Math.PI / 2; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const D = __DF, b = D.boss; if (b) { const fx = -Math.sin(D.P.yaw), fz = -Math.cos(D.P.yaw); b.x = D.P.x + fx * 6; b.z = D.P.z + fz * 6; b.chargeCd = 99; } });
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + '/07_boss.png' });
  console.log('boss', await page.evaluate(() => __DF.boss && { type: __DF.boss.type, hp: __DF.boss.hp }));
  // Die.
  await page.evaluate(() => { __DF.hurtPlayer(9999, __DF.P.x + 1, __DF.P.z); });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: out + '/08_dead.png' });
  const log = await page.evaluate(() => window.__log.filter(l => l[0] !== 'sfx' && l[0] !== 'haptic').map(l => l[0] + (l[1] !== undefined ? ':' + JSON.stringify(l[1]) : '')).join('\n'));
  console.log(log);
  console.log('loopError', await page.evaluate(() => window.__loopError || null));
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
