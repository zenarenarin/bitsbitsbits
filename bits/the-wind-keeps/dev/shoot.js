// node dev/shoot.js <name> [w] [h] [script...]  — load the Bit, run steps, screenshot
const { chromium } = require('playwright');
(async () => {
  const [name = 'shot', w = 402, h = 874, ...steps] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DSF || 1) });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html' + (process.env.Q || ''));
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__initError);
  if (err) console.log('INIT ERROR', err);
  for (const s of steps) {
    if (s.startsWith('wait:')) await page.waitForTimeout(+s.slice(5));
    else if (s.startsWith('shot:')) await page.screenshot({ path: `dev/out/${s.slice(5)}.png` });
    else console.log(s.slice(0, 40), '=>', JSON.stringify(await page.evaluate(s)));
  }
  await page.screenshot({ path: `dev/out/${name}.png` });
  console.log(logs.slice(0, 20).join('\n'));
  await browser.close();
})();
