// Close-up stills of the cat rig in each movement state, for judging the animation.
// Usage: (serve on :8765) node dev/closeup.js <outdir>
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => { const r = window.__rr; r.begin(); r.freeze(true); r.root = document.querySelector('.rr'); r.root.style.display = 'none'; });
  // states: [name, warp/setup fn source, steps, input, camera offset]
  const states = [
    ['run-side', 0, 60, { steer: 0 }, [2.2, 0.5, 0.2]],
    ['run-side-b', 0, 70, { steer: 0 }, [2.2, 0.5, 0.2]],
    ['run-back', 0, 80, { steer: 0.6 }, null],
    ['takeoff', 'gap', 0, null, [2.4, 0.5, 0]],
    ['air-rise', 'gap', 6, null, [2.4, 0.5, 0]],
    ['air-fall', 'gap', 22, null, [2.4, 0.4, 0]],
    ['land', 'gap', 33, null, [2.4, 0.4, 0]],
    ['crouch', 1, 0, null, [2.0, 0.3, 0.6]],
    ['ledge', 2, 50, { steer: 0 }, [2.0, 0.6, 0.6]]
  ];
  for (const [name, warp, steps, inp, off] of states) {
    const ok = await page.evaluate(({ warp, steps, inp, off }) => {
      const r = window.__rr, c = r.cat;
      if (warp === 'gap') { r.warp(0); c.pos[2] = -27.5; c.prev = c.pos.slice(); for (let i = 0; i < 400 && c.pos[2] > -29.7; i++) r.sim({ steer: 0 }); for (let i = 0; i < 400 && !c.events.some(e => e.type === 'jump') && c.grounded; i++) r.sim({ steer: 0, jump: true }); for (let i = 0; i < steps; i++) r.sim({ steer: 0, jump: i < 10 }); }
      else if (warp === 1) { r.warp(1); for (let i = 0; i < 400 && c.pos[2] > -39.8; i++) r.sim({ steer: Math.max(-1, Math.min(1, (0.25 - c.pos[0]) * 3)) }); }
      else { r.warp(warp); for (let i = 0; i < steps; i++) r.sim(inp); }
      for (let i = 0; i < 2; i++) r.frame();
      if (off) { r.camera.position.set(c.pos[0] + off[0], c.pos[1] + off[1], c.pos[2] + off[2]); r.camera.lookAt(c.pos[0], c.pos[1] + 0.18, c.pos[2]); r.camera.fov = 40; r.camera.updateProjectionMatrix(); r.renderer.render(r.scene, r.camera); }
      return true;
    }, { warp, steps, inp, off });
    void ok;
    await page.screenshot({ path: `${out}/cat-${name}.png` });
  }
  await browser.close();
})();
