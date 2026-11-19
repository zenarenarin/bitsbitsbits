// Plays every level with a timing bot. node dev/levels.js [skill] [offsetSecs] [world]
const { chromium } = require('playwright');
(async () => {
  const skill = +(process.argv[2] ?? 1), offset = +(process.argv[3] ?? 0), only = process.argv[4], noise = +(process.argv[5] ?? 0);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await page.evaluate(() => { __twk.freeze(true); __twk.unlockAll(); });
  const worlds = await page.evaluate(() => ['windmill', 'clock'].filter(w => __twk.world && true));
  for (const w of only ? [only] : ['windmill', 'clock']) {
    for (let i = 0; i < 7; i++) {
      const r = await page.evaluate(async ([w, i, skill, offset, noise]) => {
        try { __twk.start(w, i); } catch (e) { return { err: String(e) }; }
        if (!__twk.run || __twk.run.L !== __twk.world.levels[i] && !__twk.run.L.daily) return null;
        let secs = 0; const tl = [];
        while (secs < 300 && __twk.mode === 'play') { __twk.sim(2, skill, offset, noise); secs += 2; }
        while (secs < 320 && __twk.mode === 'finale') { __twk.sim(1); secs += 1; }
        const run = __twk.run, o = __twk.world.objective(__twk.G);
        return { mode: __twk.mode, secs, score: Math.floor(run.score), chain: run.bestChain, catches: run.catches, flow: +__twk.G.flow.toFixed(2), ticks: o.ticks + '/' + o.need, stats: JSON.stringify(__twk.world.stats()) };
      }, [w, i, skill, offset, noise]).catch(e => ({ err: e.message }));
      if (r === null) break;
      console.log(w, i + 1, JSON.stringify(r));
    }
  }
  if (errs.length) console.log('ERRORS', errs.slice(0, 5));
  await browser.close();
})();
