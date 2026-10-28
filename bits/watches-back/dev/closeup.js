// Close-up of an eye with a debug camera. usage: node dev/closeup.js <out> <enc> <eyeId> [state]
const { chromium } = require('playwright');
const [out, enc, eid, mode] = [process.argv[2], +process.argv[3], process.argv[4], process.argv[5] || ''];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(([i, id, mode]) => {
    const T = window.__ttwb; T.load(i);
    const W = T.G.W, e = W.eyeById[id];
    const p = e.pos, f = e.facing, d = e.size * 7;
    T.view().debugCam = { pos: [p[0] + f[0] * d, p[1] + f[1] * d + e.size * 1.5, p[2] + f[2] * d], target: p };
    if (mode === 'pin') T.setGaze(id);
  }, [enc, eid, mode]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/eye_${eid}${mode}.png` });
  await browser.close();
})();
