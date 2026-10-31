// Close-up stills of the cat in each movement state along the slice, for
// judging the animation. Usage: (serve on :8765) node dev/closeup.js <outdir>
const { chromium } = require('playwright');
const pilot = require('./pilot.js');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(pilot);
  await page.evaluate(() => { const r = window.__rr; r.begin(); r.freeze(true); document.querySelector('.rr').style.display = 'none'; for (const d of document.body.children) if (d.style && d.style.zIndex === '99') d.style.display = 'none'; });
  // [name, run until z, extra steps, camera offset from the cat]
  const states = [['run', -4, 0, [1.6, 0.4, 0.2]], ['ridge-slope', -21.3, 0, [1.6, 0.5, 0.5]], ['jump', -25.75, 8, [1.8, 0.5, 0]],
    ['pipe', -31.5, 0, [1.4, 0.45, 0.4]], ['narrow-pipe', -38, 0, [1.4, 0.4, 0.4]], ['squeeze', -51.5, 0, [1.4, 0.35, 0.6]],
    ['fragment-leap', -58.75, 10, [1.8, 0.6, 0]], ['wait', -34.1, 0, [1.2, 0.35, 0.6]]];
  for (const [name, z, extra, off] of states) {
    await page.evaluate(({ z, extra, off, name }) => {
      const r = window.__rr, c = r.cat;
      if (name === 'wait') { r.restart(); r.freeze(true); r.warp(2); r.hazards.time = 1.6; }
      let n = 0; while (c.pos[2] > z && n++ < 4000) r.sim(window.__pilot(c, r.hazards));
      for (let i = 0; i < extra; i++) r.sim(window.__pilot(c, r.hazards));
      if (name === 'wait') for (let i = 0; i < 30; i++) r.sim({ steer: 0, pace: -1 });
      for (let i = 0; i < 3; i++) r.frame();
      r.camera.position.set(c.pos[0] + off[0], c.pos[1] + off[1], c.pos[2] + off[2]); r.camera.lookAt(c.pos[0], c.pos[1] + 0.18, c.pos[2]);
      r.camera.fov = 40; r.camera.clearViewOffset(); r.camera.updateProjectionMatrix(); r.renderer.render(r.scene, r.camera);
    }, { z, extra, off, name });
    await page.screenshot({ path: `${out}/cat-${name}.png` });
  }
  await browser.close();
})();
