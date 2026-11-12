// Renders each weapon in-game to dev/shots/gun_<id>.png for visual tuning.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 402, height: 874 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8765/dev/index.html');
  await p.waitForFunction(() => window.__DF && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await p.click('.df-b.primary');
  await p.waitForTimeout(2500);
  const ids = process.argv[2] ? process.argv[2].split(',') : await p.evaluate(() => __DF.WEAPONS.map(w => w.id));
  for (const id of ids) {
    await p.evaluate((id) => { __DF.giveWeapon(id); __DF.P.pitch = -0.15; }, id);
    await p.waitForTimeout(700);
    await p.screenshot({ path: __dirname + '/shots/gun_' + id + '.png', clip: { x: 0, y: 380, width: 402, height: 494 } });
  }
  await b.close();
})();
