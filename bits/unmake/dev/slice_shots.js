// Screenshot the playable slice at its key beats. usage: node dev/slice_shots.js <outdir> [route: wall|floor|leap] [view]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || '.', ROUTE = process.argv[3] || 'wall', VIEW = process.argv[4] || 'third';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + '/00_title.png' });
  await page.evaluate(v => { const u = window.__unmake; u.save().settings.view = v; u.save().runs = 0; u.begin(); u.warp('threshold', 1.2); }, VIEW);
  const relz = () => page.evaluate(() => { const u = window.__unmake, r = u.run, s = r.segs.find(q => q.name === 'threshold'); return { rel: s.z0 - r.player.pos[2], y: r.player.pos[1], len: s.meta.len, mode: u.mode, focus: u.targetScreen() }; });
  const go = async (until, inp) => { for (let i = 0; i < 400; i++) { const r = await relz(); if (r.rel >= until || r.mode !== 'play') return r; await page.evaluate(i => window.__unmake.advance(0.1, i), inp || { steer: 0, pace: 0 }); } return relz(); };
  let r = await go(0.5);
  await page.screenshot({ path: out + '/01_approach.png' });
  r = await go(2.5); console.log('near entry', JSON.stringify(r));
  await page.screenshot({ path: out + '/02_read.png' });
  const key = ROUTE === 'floor' ? 'floor' : 'wall';
  await page.evaluate(k => { window.__unmake.preview(k, 'threshold'); window.__unmake.frame(); }, key); await page.screenshot({ path: out + '/02b_preview.png' });
  console.log('act', key, await page.evaluate(k => window.__unmake.act(k, 'threshold'), key));
  await page.evaluate(() => window.__unmake.advance(0.12, { steer: 0, pace: 0 }));
  await page.screenshot({ path: out + '/03_wipe.png' });
  await page.evaluate(() => window.__unmake.advance(0.5, { steer: 0, pace: 0 }));
  await page.screenshot({ path: out + '/04_after.png' });
  if (ROUTE !== 'floor') {
    r = await go(9.5, { steer: 0, pace: ROUTE === 'leap' ? 1 : 0 }); console.log('high road', JSON.stringify(r));
    await page.screenshot({ path: out + '/05_second.png' });
    if (ROUTE === 'wall') { await page.evaluate(() => { window.__unmake.preview('props', 'threshold'); window.__unmake.frame(); }); await page.screenshot({ path: out + '/05b_preview.png' }); console.log('act props', await page.evaluate(() => window.__unmake.act('props', 'threshold'))); await page.evaluate(() => window.__unmake.advance(0.15, { steer: 0, pace: -1 })); await page.screenshot({ path: out + '/06_props.png' }); await page.evaluate(() => window.__unmake.advance(0.9, { steer: 0, pace: -1 })); await page.screenshot({ path: out + '/07_lintel.png' }); }
  } else {
    r = await go(8); await page.screenshot({ path: out + '/05_low.png' }); console.log('low', JSON.stringify(r));
  }
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
