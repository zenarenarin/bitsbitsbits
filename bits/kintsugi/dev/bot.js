// Plays levels through real pointer events in headless Chromium.
// usage: node dev/bot.js <outdir> [level=0] [skill=1]   (skill 1 = careful, 0 = sloppy)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const level = +(process.argv[3] || 0), skill = +(process.argv[4] || 1);
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/dev/index.html?pr=${process.env.PR || 0.5}`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  if (level > 0) { await p.evaluate(l => __kg.goLevel(l), level); await p.waitForFunction(l => __kg.lv() && __kg.state === 'intro', level); await p.waitForTimeout(600); }
  await p.mouse.click(195, 300);
  await p.waitForFunction(() => __kg.state === 'assembly', null, { timeout: 90000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'a_assembly.png') });
  const t0 = Date.now();
  // empty spot for turning the object: just left of the object, above the tray
  for (let guard = 0; guard < 40; guard++) {
    const info = await p.evaluate(() => {
      const sh = __kg.shards();
      const s = sh.find(x => x.state === 'loose');
      if (!s) return null;
      const id = sh.indexOf(s);
      const sp = __kg.toScreen(s.mesh.position);
      return { id, sx: sp[0], sy: sp[1], phi: s.phi, yaw: __kg.yaw, roll: s.roll };
    });
    if (!info) break;
    // 1. turn the object so this piece's gap faces us
    let dy = wrap(-info.phi - info.yaw);
    while (Math.abs(dy) > 0.02) {
      const step = Math.max(-1.4, Math.min(1.4, dy));
      const px = step / 0.0085;
      const sx = px > 0 ? 40 : 350;
      await p.mouse.move(sx, 200); await p.mouse.down();
      for (let k = 1; k <= 8; k++) await p.mouse.move(sx + px * k / 8, 200);
      await p.waitForTimeout(140);
      await p.mouse.up();
      await p.waitForTimeout(120);
      dy = wrap(-info.phi - (await p.evaluate(() => __kg.yaw)));
    }
    // 2. pick it up
    await p.mouse.move(info.sx, info.sy); await p.mouse.down();
    await p.waitForTimeout(150);
    // 3. fix rotation with the keyboard while holding (desktop path)
    let roll = await p.evaluate(id => __kg.shards()[id].roll, info.id);
    let guardR = 0;
    while (Math.abs(wrap(roll)) > 0.06 && guardR++ < 80) { await p.keyboard.press(wrap(roll) > 0 ? 'q' : 'e'); roll = await p.evaluate(id => __kg.shards()[id].roll, info.id); }
    // 4. carry it to the gap, aiming at the live target
    for (let k = 0; k < 14; k++) {
      const e = await p.evaluate(id => { const s = __kg.shards()[id]; const r = __kg.errors(s); return { tx: r.tx, ty: r.ty, sx: __kg.toScreen(s.mesh.position) }; }, info.id);
      const cur = await p.evaluate(id => __kg.toScreen(__kg.shards()[id].mesh.position), info.id);
      const mx = info.sx + (e.tx - cur[0]) * 0.9 + (skill ? 0 : 14), my = info.sy + (e.ty - cur[1]) * 0.9;
      info.sx = mx; info.sy = my;
      await p.mouse.move(mx, my, { steps: 3 });
      await p.waitForTimeout(60);
    }
    await p.waitForTimeout(200);
    await p.mouse.up();
    await p.waitForTimeout(700);
    const st = await p.evaluate(id => __kg.shards()[id].state, info.id);
    console.log('piece', info.id, '->', st);
  }
  console.log('assembly took', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await p.waitForFunction(() => __kg.state === 'gold', null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'b_gold_start.png') });
  // gold: trace each seam through its visible stretch, turning the object as needed
  const ns = await p.evaluate(() => __kg.seams().length);
  for (let pass = 0; pass < 3; pass++) {
    for (let si = 0; si < ns; si++) {
      for (let turnTry = 0; turnTry < 4; turnTry++) {
        const done = await p.evaluate(si => __kg.seams()[si].done, si);
        if (done) break;
        const pts = await p.evaluate(si => __kg.seamPts(si), si);
        // visible, unfilled stretch
        const vis = pts.map((q, i) => ({ q, i })).filter(o => o.q[2] > 0.35);
        const need = pts.filter(q => !q[4]).length;
        if (vis.length > 2 && vis.some(o => !o.q[4])) {
          const jit = skill ? 1.2 : 7;
          await p.mouse.move(vis[0].q[0], vis[0].q[1]); await p.mouse.down();
          for (let k = 0; k < vis.length; k += 2) { const q = vis[k].q; await p.mouse.move(q[0] + (Math.random() - 0.5) * jit, q[1] + (Math.random() - 0.5) * jit); }
          const q = vis[vis.length - 1].q; await p.mouse.move(q[0], q[1]);
          await p.mouse.up();
          await p.waitForTimeout(150);
        }
        if (await p.evaluate(si => __kg.seams()[si].done, si)) break;
        // turn a quarter and look again
        await p.mouse.move(30, 760 - 0); await p.mouse.down(); await p.mouse.move(30 + 90, 760, { steps: 6 }); await p.mouse.up();
        await p.waitForTimeout(600);
      }
    }
    const left = await p.evaluate(() => __kg.seams().filter(s => !s.done).length);
    console.log('pass', pass, 'seams left', left, 'gold', (await p.evaluate(() => __kg.gold())).map(x => x.toFixed(2)).join('/'));
    if (!left) break;
  }
  await p.screenshot({ path: path.join(out, 'c_gold_end.png') });
  await p.waitForFunction(() => __kg.state === 'reveal' || __kg.state === 'results', null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'd_reveal.png') });
  await p.waitForFunction(() => __kg.state === 'results', null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(out, 'e_results.png') });
  console.log('score', JSON.stringify(await p.evaluate(() => __kg.score())), 'stats', JSON.stringify(await p.evaluate(() => { const s = __kg.stats(); return { strokes: s.strokes, stops: s.stops, travel: s.travel.toFixed(2), off: s.offTravel.toFixed(2), dev: (s.devSum / Math.max(1, s.devN)).toFixed(2), rejects: s.rejects }; })));
  console.log('submit', JSON.stringify(await p.evaluate(() => window.__submit)), 'progress', JSON.stringify(await p.evaluate(() => window.__progress && window.__progress.state)));
  await b.close(); srv.close();
})();
