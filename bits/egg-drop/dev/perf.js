const { open } = require('./shot');
(async () => {
  const { page, close } = await open('');
  const r = await page.evaluate(() => {
    window.__manual = true;
    const E = window.__egg; E.drag.id = 999; E.beginRun();
    const t0 = performance.now(); let n = 0;
    for (let i = 0; i < 600; i++) { const s = E.sim; const e = s.eggLocal(); s.target = -0.5 * e.x; window.__loopStep(1000 / 60); n++; }
    const total = performance.now() - t0;
    // physics alone
    const t1 = performance.now(); for (let i = 0; i < 1200; i++) E.sim.step(1 / 120); const phys = (performance.now() - t1) / 1200;
    return { msPerFrame: total / n, physicsStepMs: phys };
  });
  console.log(r);
  await close();
})();
