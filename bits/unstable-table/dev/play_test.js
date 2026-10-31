// Drives the real Bit in headless Chromium with pointer input.
// node dev/play_test.js [outdir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2]; if (out) fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!ok) fails++; };
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.stack)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 20000 });
  check('ready after first frame', await pg.evaluate(() => !!window.__ready && window.__visualReady === 'table-painted'));
  const shot = async n => { if (out) await pg.screenshot({ path: `${out}/${n}.png` }); };
  const st = () => pg.evaluate(() => { const U = window.__UT, r = U.run; return { state: r.state, placed: r.placed, tray: r.tray.length, recs: r.recs.length, held: !!r.held, angle: U.angleDeg(), points: r.points }; });
  const slot = i => pg.evaluate(i => { const U = window.__UT, L = U.L; const n = Math.max(3, U.run.tray.length); const w = (L.right - L.left) / n; return [L.left + w * (i + 0.5), L.trayTop + L.trayH - 50]; }, i);
  const w2s = (x, y) => pg.evaluate(([x, y]) => window.__UT.W2S(x, y), [x, y]);
  const surf = x => pg.evaluate(x => window.__UT.sim.surfaceY(x), x);
  async function drag(from, to, steps = 18) {
    await pg.mouse.move(from[0], from[1]); await pg.mouse.down();
    for (let i = 1; i <= steps; i++) { await pg.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await pg.waitForTimeout(16); }
    await pg.waitForTimeout(250); // let the held object catch up with the finger
    await pg.mouse.up();
  }
  // The held object's base floats ~30-40px above the finger: aim the finger below the target.
  const aim = async (x, above = 0.15) => { const [sx, sy] = await w2s(x, (await surf(x)) + above); return [sx, sy + 40]; };

  let s = await st();
  check('starts playing with one object waiting', s.state === 'playing' && s.tray === 1 && s.recs === 0, s);
  await shot('01_start');

  // 1. drag the first object onto the right side
  await drag(await slot(0), await aim(0.9));
  await pg.waitForTimeout(1800);
  s = await st();
  check('first gesture starts an attempt', await pg.evaluate(() => (window.__starts || []).length === 1));
  check('drag from tray places a body on the table', s.recs === 1 && s.placed === 1, s);
  check('weight on the right tips the table right-down', s.angle < -0.5, s.angle);
  await shot('02_first');

  // 2. next object arrives; put it on the left
  await pg.waitForFunction(() => window.__UT.run.tray.length >= 1, null, { timeout: 5000 });
  await drag(await slot(0), await aim(-0.9));
  await pg.waitForTimeout(2000);
  s = await st();
  check('second object placed on the left', s.recs === 2 && s.placed === 2, s);

  // 3. lift the right-hand object and move it nearer the pivot
  const rp = await pg.evaluate(() => { const U = window.__UT; const r = U.run.recs.slice().sort((a, b) => b.body.getPosition().x - a.body.getPosition().x)[0]; const p = r.body.getPosition(); return { id: r.id, x: p.x, y: p.y + (r.def.box[3]) * 0.4 }; });
  const a0 = s.angle;
  await drag(await w2s(rp.x, rp.y), await aim(0.25), 14);
  await pg.waitForTimeout(2000);
  const moved = await pg.evaluate(id => { const r = window.__UT.run.recs.find(r => r.id === id); return r && r.body.isActive() ? r.body.getPosition().x : null; }, rp.id);
  s = await st();
  check('existing object can be picked up and moved', moved != null && Math.abs(moved - 0.25) < 0.25 && s.recs === 2, { moved, s });
  check('moving it toward the pivot changes the balance', Math.abs(s.angle - a0) > 0.3, { before: a0, after: s.angle });

  // 4. releasing over empty floor returns the object to the tray
  await pg.waitForFunction(() => window.__UT.run.tray.length >= 1, null, { timeout: 5000 });
  const trayBefore = (await st()).tray;
  const offTable = await w2s(-1.95, -0.9);
  await drag(await slot(0), [offTable[0], offTable[1] + 40]);
  await pg.waitForTimeout(400);
  s = await st();
  check('release with no table below returns it to the tray', s.tray === trayBefore && s.recs === 2 && !s.held, s);
  await shot('03_three');

  // 5. no input during the hold leaves the rest of the physics running
  const before = await pg.evaluate(() => window.__UT.run.t);
  await pg.waitForTimeout(500);
  check('simulation keeps running', (await pg.evaluate(() => window.__UT.run.t)) > before + 0.3);

  // 6. topple: a heavy bell at the far edge loses the game; the cause is explained
  await pg.evaluate(() => { window.__UT.place('bell', 1.45, 0.02); window.__UT.place('elephant', 1.1, 0.02); });
  await pg.waitForFunction(() => window.__UT.run.state !== 'playing', null, { timeout: 8000 });
  const cause = await pg.evaluate(() => window.__UT.run.cause);
  check('failure explains itself', /table|fell/.test(cause), cause);
  await pg.waitForTimeout(800);
  await shot('04_collapse');
  await pg.waitForFunction(() => window.__UT.run.state === 'over', null, { timeout: 6000 });
  await pg.waitForTimeout(1200);
  check('objects stay physical after failure', await pg.evaluate(() => window.__UT.run.recs.every(r => r.body.isActive())));
  check('score submitted and fail reported', await pg.evaluate(() => !!window.__submitted && !!window.__failed));
  await shot('05_result');

  // 7. replay
  const btn = await pg.evaluate(() => window.__UT.L.replayBtn);
  await pg.mouse.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
  await pg.waitForTimeout(300);
  s = await st();
  check('Play again starts a fresh run', s.state === 'playing' && s.recs === 0 && s.placed === 0 && s.tray === 1, s);
  check('replay starts a new attempt', await pg.evaluate(() => (window.__starts || []).length === 2));

  check('no page errors', errs.length === 0, errs);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})();
