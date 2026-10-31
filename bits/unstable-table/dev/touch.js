// Emulated phone with real touch events (CDP), plus layout shots at other sizes
// and in the legacy safe frame. node dev/touch.js <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/ut-touch'; fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!ok) fails++; };
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  for (const [name, vw, vh, q] of [['iphone', 402, 874, ''], ['android', 360, 780, ''], ['small', 360, 640, ''], ['legacy', 393, 852, '&safe=frame'], ['tablet', 820, 1180, '']]) {
    const ctxb = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const pg = await ctxb.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(e.stack));
    await pg.goto(`http://localhost:${port}/dev/index.html?seed${q}`);
    await pg.waitForFunction(() => window.__ready, null, { timeout: 20000 });
    await pg.waitForTimeout(400);
    const cdp = await ctxb.newCDPSession(pg);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    const from = await pg.evaluate(() => { const L = window.__UT.L; const w = (L.right - L.left) / 3; return [L.left + w / 2, L.trayTop + L.trayH - 50]; });
    const to = await pg.evaluate(() => { const U = window.__UT; const [x, y] = U.W2S(-0.7, U.sim.surfaceY(-0.7) + 0.2); return [x, y + 40]; });
    await touch('touchStart', from[0], from[1]);
    for (let i = 1; i <= 20; i++) { await touch('touchMove', from[0] + (to[0] - from[0]) * i / 20, from[1] + (to[1] - from[1]) * i / 20); await pg.waitForTimeout(16); }
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: `${out}/${name}_holding.png` });
    await touch('touchEnd');
    await pg.waitForTimeout(1600);
    const s = await pg.evaluate(() => ({ recs: window.__UT.run.recs.length, placed: window.__UT.run.placed, angle: window.__UT.angleDeg() }));
    check(`${name}: touch drag places an object`, s.recs === 1 && s.placed === 1 && s.angle > 0.2, s);
    // layout sanity: HUD below the top inset, tray above the logo / bottom inset
    const lay = await pg.evaluate(() => { const L = window.__UT.L, c = window.__ctx; const a = c.contentSafeArea || c.safeArea; return { top: L.top, safeTop: a.top, bottom: L.bottom, limit: c.height - a.bottom, s0: L.s0, tableW: 3.2 * L.s0, W: c.width }; });
    check(`${name}: HUD and tray inside the content safe area`, lay.top >= lay.safeTop && lay.bottom <= lay.limit, lay);
    check(`${name}: no page errors`, errs.length === 0, errs);
    await pg.evaluate(() => { const U = window.__UT; ['vase', 'books', 'pumpkin', 'perfume', 'grapes'].forEach((id, i) => U.place(id, -1.2 + i * 0.6, 0.05)); });
    await pg.waitForTimeout(2200);
    await pg.screenshot({ path: `${out}/${name}_play.png` });
    await ctxb.close();
  }
  // frame cost with a crowded table (headless, software rendering: relative only)
  const pg = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  await pg.goto(`http://localhost:${port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready);
  const perf = await pg.evaluate(async () => {
    const U = window.__UT;
    ['books', 'bowl', 'teapot', 'books', 'vase', 'lidpot', 'pumpkin', 'cat', 'frame', 'lemon', 'grapes', 'coconut'].forEach((id, i) => U.place(id, -1.3 + (i % 6) * 0.52, 0.05 + Math.floor(i / 6) * 0.6));
    await new Promise(r => setTimeout(r, 1500));
    const t0 = performance.now(); U.step(600); const sim = (performance.now() - t0) / 600;
    return { simMsPerStep: +sim.toFixed(3), state: U.run.state };
  });
  console.log('INFO', JSON.stringify(perf));
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})();
