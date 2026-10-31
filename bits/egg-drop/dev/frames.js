// Step the real page frame by frame with a balancing bot and capture moments.
const { open } = require('./shot');
const path = require('path');
(async () => {
  const surface = process.argv[2] || 'wood';
  const { page, errors, close } = await open('');
  const out = path.join(__dirname, 'out');
  await page.evaluate((su) => {
    window.__manual = true;
    window.__egg.selectSurface(su);
    window.__egg.drag.id = 999; // a held pointer
    window.__egg.beginRun();
    window.__botOn = true;
    window.__run = (sec) => {
      const E = window.__egg;
      for (let i = 0; i < sec * 60; i++) {
        const s = E.sim;
        if (window.__botOn && E.state === 'play') {
          const e = s.eggLocal(), v = s.eggLocalVel(), a = s.angle(), w = s.platform.getAngularVelocity();
          const want = Math.max(-0.2, Math.min(0.2, 0.12 * e.x + 0.16 * v.x));
          s.target = Math.max(-1.36, Math.min(1.36, -(0.5 / 0.95) * e.x - 4 * (want - a) + 0.6 * w));
        }
        window.__loopStep(1000 / 60);
      }
      return { t: E.run && E.run.t, state: E.state };
    };
  }, surface);
  const shot = async (name) => page.screenshot({ path: path.join(out, `${surface}_${name}.png`) });
  console.log(await page.evaluate(() => window.__run(6))); await shot('t6');
  // run until a gust warning is visible
  let r;
  for (let i = 0; i < 400; i++) { r = await page.evaluate(() => { window.__run(0.25); return { w: window.__egg.dist.warning, g: window.__egg.dist.gustActive, t: window.__egg.run.t, st: window.__egg.state }; }); if (r.w > 0.5 || r.st !== 'play') break; }
  console.log('gust warn', r); await shot('gustwarn');
  // let go of the controls so the egg rolls to the edge
  await page.evaluate(() => { window.__botOn = false; });
  for (let i = 0; i < 200; i++) { r = await page.evaluate(() => { window.__run(1 / 30); return { d: window.__egg.fx.danger, st: window.__egg.state }; }); if (r.d > 0.7 || r.st !== 'play') break; }
  console.log('danger', r); await shot('danger');
  for (let i = 0; i < 300; i++) { r = await page.evaluate(() => { window.__run(1 / 30); return { st: window.__egg.state }; }); if (r.st !== 'play') break; }
  await page.evaluate(() => window.__run(0.25)); await shot('falling');
  for (let i = 0; i < 100; i++) { r = await page.evaluate(() => { window.__run(1 / 30); return { st: window.__egg.state }; }); if (r.st === 'broken') break; }
  await page.evaluate(() => window.__run(0.3)); await shot('broken');
  await page.evaluate(() => window.__run(1.5)); await page.waitForTimeout(700); await shot('results');
  console.log('errors', errors);
  await close();
})();
