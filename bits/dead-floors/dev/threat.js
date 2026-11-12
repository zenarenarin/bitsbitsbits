// Checks the in-floor threat meter fills over time and resets on the next floor.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 402, height: 874 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8765/dev/index.html');
  await p.waitForFunction(() => window.__DF && !document.querySelector('.df-b.primary').disabled, null, { timeout: 30000 });
  await p.click('.df-b.primary');
  await p.waitForTimeout(1000);
  await p.evaluate(() => { __DF.RUN.heat = 0.7; });
  await p.waitForTimeout(3000);
  console.log('heat after 3s from 0.7:', await p.evaluate(() => __DF.RUN.heat.toFixed(3)), 'bar', await p.evaluate(() => document.querySelector('.df-threat i').style.transform));
  await p.screenshot({ path: __dirname + '/shots/threat.png', clip: { x: 0, y: 60, width: 402, height: 110 } });
  await p.evaluate(() => { __DF.enterFloor(2, false); });
  await p.waitForTimeout(500);
  console.log('heat on new floor:', await p.evaluate(() => __DF.RUN.heat.toFixed(3)), 'D', await p.evaluate(() => JSON.stringify(__DF.RUN.D)));
  await b.close();
})();
