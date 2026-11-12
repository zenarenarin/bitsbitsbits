// Smoke test for survival mode: boot, title, start, move, aim, fire, timer, crate + nav arrow,
// low-ammo arrow, boss, death screen and time submission.
// Usage: node dev/smoke.js [outdir]   (serve bits/dead-floors on :8765 first)
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const VW = +(process.env.VW || 402), VH = +(process.env.VH || 874);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__DF && window.__DF.mode === 'title' && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/01_title.png' });
  await page.click('.df-b.primary');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '/02_start.png' });
  console.log('after start', JSON.stringify(await page.evaluate(() => ({ mode: __DF.mode, time: __DF.RUN.time.toFixed(1), zombies: __DF.zombies.filter(z => !z.dead).length, aware: __DF.zombies.every(z => z.aware), owned: __DF.RUN.owned, ammo: __DF.ammoOf('pistol'), pickups: __DF.pickups.map(p => p.kind) }))));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [{ x: 90, y: VH - 174, id: 1 }]);
  for (let i = 0; i < 10; i++) { await touch('touchMove', [{ x: 90, y: VH - 174 - i * 6, id: 1 }]); await page.waitForTimeout(30); }
  await page.waitForTimeout(1000);
  await touch('touchEnd', []);
  await touch('touchStart', [{ x: VW - 100, y: VH / 2, id: 2 }]);
  for (let i = 0; i < 10; i++) { await touch('touchMove', [{ x: VW - 100 - i * 8, y: VH / 2, id: 2 }]); await page.waitForTimeout(20); }
  await touch('touchEnd', []);
  // A zombie in front, then hold FIRE.
  await page.evaluate(() => { const D = __DF; const z = D.spawnFar('walker'); const fx = -Math.sin(D.P.yaw), fz = -Math.cos(D.P.yaw); if (z) { z.x = D.P.x + fx * 4; z.z = D.P.z + fz * 4; } });
  await page.waitForTimeout(300);
  const fire = await page.evaluate(() => { const r = document.querySelector('.df-btn.fire').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await touch('touchStart', [{ x: fire.x, y: fire.y, id: 3 }]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: out + '/03_firing.png' });
  await page.waitForTimeout(1200);
  await touch('touchEnd', []);
  console.log('after fire', JSON.stringify(await page.evaluate(() => ({ kills: __DF.RUN.kills, ammo: __DF.ammoOf('pistol'), time: __DF.RUN.time.toFixed(1), hud: document.querySelector('.df-floor').textContent }))));
  // Weapon crate: arrow points to it; walking onto it gives the next gun.
  await page.evaluate(() => __DF.spawnCrate());
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + '/04_crate.png' });
  console.log('crate nav', JSON.stringify(await page.evaluate(() => __DF.nav)));
  await page.evaluate(() => { const c = __DF.RUN.crate; __DF.P.x = c.x; __DF.P.z = c.z; });
  await page.waitForTimeout(600);
  console.log('after crate', JSON.stringify(await page.evaluate(() => ({ owned: __DF.RUN.owned, crate: !!__DF.RUN.crate, cur: __DF.curW().id, ammo: __DF.ammoOf(__DF.curW().id) }))));
  // Low ammo: the arrow switches to the nearest ammo box.
  await page.evaluate(() => { for (const id of __DF.RUN.owned) { const a = __DF.ammoOf(id); a.mag = 1; a.res = 0; } __DF.markHud(); });
  await page.waitForTimeout(800);
  console.log('low ammo nav', JSON.stringify(await page.evaluate(() => __DF.nav)), await page.evaluate(() => document.querySelector('.df-obj').textContent));
  await page.screenshot({ path: out + '/05_lowammo.png' });
  // Boss.
  await page.evaluate(() => { __DF.spawnBoss(); const D = __DF, b = D.boss; if (b) { const fx = -Math.sin(D.P.yaw), fz = -Math.cos(D.P.yaw); b.x = D.P.x + fx * 6; b.z = D.P.z + fz * 6; b.chargeCd = 99; } });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + '/06_boss.png' });
  console.log('boss', await page.evaluate(() => __DF.boss && __DF.boss.type));
  // Die.
  await page.evaluate(() => { __DF.hurtPlayer(9999, __DF.P.x + 1, __DF.P.z); });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: out + '/07_dead.png' });
  console.log('dead screen', JSON.stringify(await page.evaluate(() => ({ big: document.querySelector('.df-big').textContent, sub: document.querySelectorAll('.df-modal')[2].querySelector('.df-sub').textContent, pb: document.querySelector('.df-pb').textContent }))));
  const log = await page.evaluate(() => window.__log.filter(l => !['sfx', 'haptic', 'music'].includes(l[0])).map(l => l[0] + (l[1] !== undefined ? ':' + JSON.stringify(l[1]) : '')).join(' | '));
  console.log(log);
  console.log('loopError', await page.evaluate(() => window.__loopError || null));
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
