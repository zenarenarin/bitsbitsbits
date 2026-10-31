// Records a short gameplay clip with real pointer drags: node dev/clip.js <out.mp4>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const outFile = process.argv[2] || '/tmp/unstable-table.mp4';
const vidDir = path.join(path.dirname(outFile), 'clipraw'); fs.rmSync(vidDir, { recursive: true, force: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, recordVideo: { dir: vidDir, size: { width: 402, height: 874 } } });
  const pg = await c.newPage();
  const t0 = Date.now();
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html?seed`);
  await pg.waitForFunction(() => window.__ready);
  const startOffset = (Date.now() - t0) / 1000;
  const U = (fn, arg) => pg.evaluate(fn, arg);
  const w2s = (x, y) => U(([x, y]) => window.__UT.W2S(x, y), [x, y]);
  const slot = i => U(i => { const L = window.__UT.L; const n = Math.max(3, window.__UT.run.tray.length); const w = (L.right - L.left) / n; return [L.left + w * (i + 0.5), L.trayTop + L.trayH - 50]; }, i);
  async function drag(from, to, ms = 900) {
    await pg.mouse.move(from[0], from[1]); await pg.mouse.down();
    const n = Math.round(ms / 25);
    for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); await pg.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e - Math.sin(k * Math.PI) * 60); await pg.waitForTimeout(25); }
    await pg.waitForTimeout(300); await pg.mouse.up();
  }
  // where a careful player would put the next object: cancel the torque, avoid tall stacks
  async function spotFor(i, bias = 0) {
    return U(([i, bias]) => {
      const UT = window.__UT, def = UT.run.tray[i].def, P = UT.sim.P, { torque } = UT.sim.loadTorque();
      let best = null;
      for (let cx = -1.3; cx <= 1.31; cx += 0.05) {
        let h = -1e9; const hw = (def.box[2] - def.box[0]) * 0.4;
        for (const dx of [-hw, 0, hw]) { const hit = UT.sim.supportBelow(cx + dx, 3.5); if (hit) h = Math.max(h, hit.y); }
        const cost = Math.abs(torque + def.mass * P.g * (cx + bias)) / (def.mass * P.g) + (h - UT.sim.surfaceY(cx)) * 3;
        if (!best || cost < best.cost) best = { x: cx, y: h, cost };
      }
      return best;
    }, [i, bias]);
  }
  async function placeNext(bias = 0, ms) {
    await pg.waitForFunction(() => window.__UT.run.tray.length > 0, null, { timeout: 15000 });
    const s = await spotFor(0, bias);
    const [tx, ty] = await w2s(s.x, s.y + 0.12);
    await drag(await slot(0), [tx, ty + 40], ms);
  }
  await pg.waitForTimeout(2200);           // first frame and the ghost-finger hint
  await placeNext(0.9);                    // off-centre on purpose: the table leans
  await pg.waitForTimeout(2400);
  await placeNext();                       // counterbalance
  await pg.waitForTimeout(3000);
  await placeNext(-0.6);
  await pg.waitForTimeout(2600);
  await placeNext();
  await pg.waitForTimeout(2800);
  // reposition: lift the outermost object and bring it in toward the pivot
  const r = await U(() => { const rs = window.__UT.run.recs.filter(r => r.body.isActive()); rs.sort((a, b) => Math.abs(b.body.getPosition().x) - Math.abs(a.body.getPosition().x)); const p = rs[0].body.getPosition(); return { x: p.x, y: p.y + rs[0].def.box[3] * 0.4 }; });
  const from = await w2s(r.x, r.y);
  const nx = r.x * 0.55;
  const top = await U(x => { const h = window.__UT.sim.supportBelow(x, 3.5); return h ? h.y : 0.22; }, nx);
  const [tx, ty] = await w2s(nx, top + 0.15);
  await drag(from, [tx, ty + 40], 1000);
  await pg.waitForTimeout(3000);
  for (let i = 0; i < 3; i++) { await placeNext(); await pg.waitForTimeout(2600); }
  // the finale: something heavy, too far out
  await pg.waitForFunction(() => window.__UT.run.tray.length > 0, null, { timeout: 15000 });
  await U(() => { const T = window.__UT.run.tray; T[0] = { def: window.__UT.OBJECT_BY_ID.bell, counted: false, born: window.__UT.run.t - 1 }; });
  await pg.waitForTimeout(500);
  const edge = await U(() => { const h = window.__UT.sim.supportBelow(1.35, 3.5); return h ? h.y : 0.3; });
  const [ex, ey] = await w2s(1.35, edge + 0.2);
  await drag(await slot(0), [ex, ey + 40], 1000);
  await pg.waitForFunction(() => window.__UT.run.state === 'over', null, { timeout: 15000 });
  await pg.waitForTimeout(4200);
  const log = await U(() => window.__UT.run.log);
  await pg.close(); await c.close(); await b.close(); srv.close();
  const raw = fs.readdirSync(vidDir).find(f => f.endsWith('.webm'));
  execSync(`ffmpeg -y -loglevel error -ss ${startOffset.toFixed(2)} -i "${path.join(vidDir, raw)}" -vf "scale=804:-2:flags=lanczos,fps=30" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "${outFile}"`);
  console.log('wrote', outFile);
  console.log(JSON.stringify(log.map(e => e.kind + ' +' + e.points + (e.kind === 'placement' ? ` (${e.base}+${e.bonus})x${e.mult} @${e.angle}°` : ''))));
})();
