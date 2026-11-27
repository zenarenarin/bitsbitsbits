// Assembly layout for each level: node dev/layouts.js <outdir> [levels]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const which = (process.argv[3] || '0,1,2,3,4,5,6,7').split(',').map(Number);
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 390), height: +(process.env.H || 844) } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/dev/index.html?pr=${process.env.PR || 0.75}`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  for (const i of which) {
    await p.evaluate(i => __kg.goLevel(i), i);
    await p.waitForFunction(() => __kg.lv() && __kg.state === 'intro', null, { timeout: 60000 });
    await p.waitForTimeout(400);
    await p.evaluate(() => __kg.startBreak());
    await p.waitForFunction(() => __kg.state === 'assembly', null, { timeout: 120000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(out, `as${i + 1}.png`) });
  }
  console.log('load ms', JSON.stringify(await p.evaluate(() => window.__kgLoadMs)));
  await b.close(); srv.close();
})();
