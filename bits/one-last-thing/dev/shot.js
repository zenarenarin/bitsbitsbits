// Screenshot the Bit in an emulated phone. usage: node dev/shot.js <out.png> [query] [script.js]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); });
});
module.exports = async function open(opts = {}) {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: opts.dpr || 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}/dev/index.html?${opts.query || ''}`);
  await page.waitForFunction(() => window.__ready || window.__initError || window.__platformError, null, { timeout: 60000 }).catch(() => {});
  const close = async () => { await browser.close(); srv.close(); };
  return { page, logs, close };
};
if (require.main === module) (async () => {
  const out = process.argv[2] || 'shot.png';
  const { page, logs, close } = await module.exports({ query: process.argv[3] || '' });
  await page.waitForTimeout(1500);
  if (process.argv[4]) { const fn = require(path.resolve(process.argv[4])); await fn(page); }
  await page.screenshot({ path: out });
  console.log(logs.slice(0, 30).join('\n'));
  console.log(await page.evaluate(() => JSON.stringify({ ready: window.__ready, err: window.__initError, perr: window.__platformError })));
  await close();
})();
