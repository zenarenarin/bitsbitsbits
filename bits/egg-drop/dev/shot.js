// Screenshots of the live game in an emulated phone. node dev/shot.js [name] [query]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rs) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(p).pipe(rs);
    }).listen(0, () => res(srv));
  });
}
module.exports = { serve, open };
async function open(query = '', viewport = { width: 402, height: 874 }) {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${srv.address().port}/dev/index.html${query}`);
  await page.waitForFunction(() => window.__ready || window.__initError || window.__platformError, null, { timeout: 15000 });
  return { srv, browser, page, errors, close: async () => { await browser.close(); srv.close(); } };
}
if (require.main === module) (async () => {
  const name = process.argv[2] || 'ready';
  const { page, errors, close } = await open(process.argv[3] || '');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'out', name + '.png') });
  console.log('errors:', errors);
  await close();
})();
