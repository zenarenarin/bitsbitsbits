// Screenshots of the shutters encounter and the sealing of a spent stretch. usage: node dev/shutters_shots.js <outdir>
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => { const u = window.__unmake; u.save().runs = 0; u.begin(); u.warp('shutters', 1.2); });
  const st = () => page.evaluate(() => { const u = window.__unmake, r = u.run, s = r.segs.find(q => q.name === 'shutters'); return { rel: +(s.z0 - r.player.pos[2]).toFixed(1), mode: u.mode, used: s.used, budget: s.meta.budget }; });
  const go = async (until, inp) => { for (let i = 0; i < 300; i++) { const r = await st(); if (r.rel >= until || r.mode !== 'play') return r; await page.evaluate(i => window.__unmake.advance(0.1, i), inp || { steer: 0, pace: 0 }); } return st(); };
  await page.evaluate(() => window.__unmake.advance(0.3, { steer: 0, pace: 0 }));
  await page.screenshot({ path: out + '/01_read.png' });
  console.log('w1', await page.evaluate(() => window.__unmake.act('w1', 'shutters')));
  console.log(JSON.stringify(await go(5)));
  await page.screenshot({ path: out + '/02_stone.png' });
  console.log('stone (not eligible)', await page.evaluate(() => window.__unmake.act('stone', 'shutters')));
  console.log('w3', await page.evaluate(() => window.__unmake.act('w3', 'shutters')));
  console.log(JSON.stringify(await st()));
  console.log(errs.join('\n'));
  await browser.close();
})();
