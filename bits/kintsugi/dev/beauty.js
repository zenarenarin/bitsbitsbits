// Beauty shots of the repaired object: node dev/beauty.js <outdir> <level> [dev=0.15] [dsf=2]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const level = +(process.argv[3] || 0), dev = +(process.argv[4] || 0.15), dsf = +(process.argv[5] || 2);
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/dev/index.html?pr=${dsf}`);
  await p.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  if (level > 0) { await p.evaluate(l => __kg.goLevel(l), level); await p.waitForFunction(() => __kg.lv() && __kg.state === 'intro'); }
  await p.evaluate(() => __kg.autoAssemble());
  await p.waitForFunction(() => __kg.state === 'gold', null, { timeout: 60000 });
  await p.evaluate(() => { __kg.yaw = 0.35; });
  await p.evaluate(d => __kg.autoGold(d, 0.6), dev);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, `L${level + 1}_wet.png`) });
  await p.evaluate(d => __kg.autoGold(d, 1), dev);
  await p.waitForFunction(() => __kg.state === 'results', null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: path.join(out, `L${level + 1}_result.png`) });
  await p.screenshot({ path: path.join(out, `L${level + 1}_close.png`), clip: { x: 40, y: 120, width: 310, height: 380 } });
  console.log(JSON.stringify(await p.evaluate(() => __kg.score())));
  await b.close(); srv.close();
})();
