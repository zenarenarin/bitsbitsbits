// Real touch events on an emulated phone: begin, catch a gust, pause, resume, field notes.
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const ok = (name, v) => console.log((v ? 'PASS ' : 'FAIL ') + name);
  const box = async sel => (await page.locator(sel).boundingBox());
  // 1. tap the scene on the title -> play
  await page.touchscreen.tap(200, 450); await page.waitForTimeout(300);
  ok('title tap starts play', await page.evaluate(() => __twk.mode === 'play' && window.__starts === 1));
  // 2. wait for the first gust and tap as it arrives
  await page.evaluate(() => { __twk.freeze(true); __twk.sim(2.5); });
  const tA = await page.evaluate(() => { const o = __twk.G.ops.find(o => o.kind === 'gust'); return o ? o.t : null; });
  await page.evaluate(t => __twk.sim(t - __twk.G.t - 0.0), tA);
  console.log('under finger:', await page.evaluate(() => { const e = document.elementFromPoint(200, 500); return e.tagName + '.' + e.className + ' pe=' + getComputedStyle(e).pointerEvents; }));
  await page.evaluate(() => { window.__pd = 0; document.querySelector('canvas').addEventListener('pointerdown', () => window.__pd++); });
  await page.touchscreen.tap(200, 500);
  console.log('pointerdowns on canvas:', await page.evaluate(() => window.__pd));
  const r = await page.evaluate(tA => ({ q: __twk.run.q.slice(), catches: __twk.run.catches, idle: __twk.run.idleTaps.length, t: __twk.G.t, tA, ops: __twk.G.ops.map(o => o.kind + '@' + o.t.toFixed(2) + (o.done ? 'x' : '')) }), tA);
  ok('touch on arrival is a catch ' + JSON.stringify(r), r.catches === 1);
  await page.evaluate(() => __twk.freeze(false));
  // 3. pause control
  const pb = await box('.twk-pause'); await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.waitForTimeout(700);
  ok('pause control pauses', await page.evaluate(() => __twk.mode === 'paused'));
  const rs = await box('[data-a=resume]'); await page.touchscreen.tap(rs.x + rs.width / 2, rs.y + rs.height / 2); await page.waitForTimeout(400);
  ok('resume resumes', await page.evaluate(() => __twk.mode === 'play'));
  // 4. a tap during play must not be eaten by the HUD (tap over the label area)
  const before = await page.evaluate(() => __twk.run.idleTaps.length + __twk.run.q.length);
  const lb = await box('.twk-obj'); await page.touchscreen.tap(lb.x + 20, lb.y + 8); await page.waitForTimeout(100);
  const after = await page.evaluate(() => __twk.run.idleTaps.length + __twk.run.q.length);
  ok('taps over HUD text reach the world', after > before);
  // 5. pause -> leave -> title -> field notes -> pick entry 01
  await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.waitForTimeout(700);
  const lv = await box('[data-a=leave]'); await page.touchscreen.tap(lv.x + lv.width / 2, lv.y + lv.height / 2); await page.waitForTimeout(900);
  ok('leave returns to title', await page.evaluate(() => __twk.mode === 'title'));
  const nb = await box('.twk-link[data-a=notes]'); await page.touchscreen.tap(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.waitForTimeout(900);
  const en = await box('.twk-ent[data-w]'); await page.touchscreen.tap(en.x + 60, en.y + en.height / 2); await page.waitForTimeout(500);
  ok('notebook entry starts a level', await page.evaluate(() => __twk.mode === 'play' && __twk.run.ref.index === 0));
  ok('no page errors ' + errs.join(' | '), errs.length === 0);
  await browser.close();
})();
