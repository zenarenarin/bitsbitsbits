// Screenshots on an emulated phone. usage: node dev/shoot.js <outdir> [script]
// script steps run in the page: title, then encounter shots driven through the dev hooks.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
const which = process.argv[3] || 'basic';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 400)); });
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError || window.__platformError, null, { timeout: 90000 });
  const ie = await page.evaluate(() => window.__initError || (window.__platformError && JSON.stringify(window.__platformError)));
  if (ie) console.log('INIT', ie);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/00_title.png' });
  const shots = which === 'basic' ? [[1, 1.5], [4, 2], [9, 2], [14, 2.5], [17, 2], [19, 3]] : JSON.parse(which);
  for (const [id, sec] of shots) {
    await page.evaluate(([id, sec]) => { const w = window.__wtb; w.goto(id); w.frame(); for (let i = 0; i < 4; i++) w.frame(); w.advance(sec, { move: [0, 0] }); for (let i = 0; i < 3; i++) w.frame(0.016); }, [id, sec]);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${out}/e${String(id).padStart(2, '0')}.png` });
  }
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await browser.close();
})();
