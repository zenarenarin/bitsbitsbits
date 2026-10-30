// The creature's approach is continuous: its drawn size, position, ground line and crop line change
// smoothly with distance (no jumps), it never overlaps the traveller before a catch, and a contact
// sheet shows it at several distances.  node dev/approach.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-approach';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(400);
  const res = await pg.evaluate(() => {
    __hh.reset(); __hh.begin(); __hh.advance(0.2, true); __hh.run.c.mode = 'investigate';
    let prev = null, worst = { x: 0, gy: 0, h: 0, crop: 0 }, minDx = 1e9;
    const PX = __hh.size().W * 0.42;
    for (let gap = 40; gap >= 0.6; gap -= 0.05) {
      const v = __hh.creatureView(gap), h = v.k * 140;
      if (prev) { worst.x = Math.max(worst.x, Math.abs(v.x - prev.x)); worst.gy = Math.max(worst.gy, Math.abs(v.gy - prev.gy)); worst.h = Math.max(worst.h, Math.abs(h - prev.h)); worst.crop = Math.max(worst.crop, Math.abs(v.crop - prev.crop)); }
      minDx = Math.min(minDx, PX - v.x);
      prev = { x: v.x, gy: v.gy, h, crop: v.crop };
    }
    const at = g => { const v = __hh.creatureView(g); return { gap: g, heightPx: Math.round(v.k * 140), x: v.x, crop: v.crop }; };
    return { worst, minPixelsLeftOfPlayer: Math.round(minDx), samples: [40, 30, 20, 12, 6, 2, 0.6].map(at) };
  });
  console.log(JSON.stringify(res, null, 1));
  const ok = res.worst.x <= 2 && res.worst.gy <= 2 && res.worst.h <= 3.6 && res.worst.crop <= 2 && res.minPixelsLeftOfPlayer >= 15;
  console.log(ok ? 'OK continuous' : 'FAIL');
  // contact sheet: the same scene with it at different distances, frozen
  for (const gap of [38, 26, 16, 9, 4]) {
    await pg.evaluate(g => { __hh.freeze(true); const r = __hh.run; r.c.mode = g < 10 ? 'chase' : 'investigate'; r.a = g < 10 ? 85 : 45; r.c.x = r.dist - g; r.c.gap = g; }, gap);
    await pg.waitForTimeout(120);
    await pg.screenshot({ path: `${out}/gap_${gap}.png` });
  }
  console.log('errors', errs); await b.close(); srv.close(); process.exit(ok && !errs.length ? 0 : 1);
});
