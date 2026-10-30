// Does the picture fill the screen? Title and play screenshots at several screen shapes, and a check
// that the low-res frame covers the whole device canvas.  node dev/fill.js <outdir>
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/hh-fill';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript'); r.end(d); }); });
srv.listen(0, async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h, dpr, name] of [[390, 844, 3, 'iphone'], [412, 915, 2.6, 'android'], [820, 1180, 2, 'ipad'], [1440, 900, 1, 'desktop'], [844, 390, 3, 'phone-landscape']]) {
    const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    pg.on('pageerror', e => errs.push(String(e)));
    await pg.goto(`http://localhost:${srv.address().port}/dev/index.html`); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${out}/${name}_title.png` });
    await pg.evaluate(() => { __hh.reset(); __hh.begin(); __hh.advance(0.1, true); __hh.advance(3, true); __hh.hold(false); });
    await pg.waitForTimeout(200);
    await pg.screenshot({ path: `${out}/${name}_play.png` });
    const s = await pg.evaluate(() => { const z = __hh.size(), c = document.querySelector('canvas'); return { ...z, devW: c.width, devH: c.height, coversW: z.offX <= 0 && z.offX + z.W * z.SC >= c.width, coversH: z.offY <= 0 && z.offY + z.H * z.SC >= c.height }; });
    console.log(name.padEnd(16), JSON.stringify(s));
    await pg.close();
  }
  console.log('errors', errs); await b.close(); srv.close();
});
