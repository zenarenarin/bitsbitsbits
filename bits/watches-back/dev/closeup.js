// Close-up of eyes in an encounter, to judge the drawing at size. usage: node dev/closeup.js <out.png> <id> <eyeName> [zoom] [sec] [gazeEye]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [out, id, name, zoom, sec, gz] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8766/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(([id, name, zoom, sec, gz]) => {
    const w = window.__wtb; w.goto(+id); w.frame();
    w.advance(+sec || 1.5, { move: [0, 0], gaze: gz ? w.S.eyePos(w.S.eye(gz)) : undefined });
    const p = name === 'player' ? w.S.playerPos() : w.S.eyePos(w.S.eye(name)); const V = w.V;
    V.zoom = +zoom || 3.5; const s = V.scale * V.zoom; V.cx = 195 - p[0] * s; V.cy = 380 + p[1] * s; V.applyCamera();
    w.frame(0.016); w.frame(0.016);
  }, [id, name, zoom, sec, gz]);
  await page.screenshot({ path: out, clip: { x: 0, y: 130, width: 390, height: 500 } });
  console.log(errs.join('\n') || 'ok'); await b.close();
})();
