// Quick visual check: node dev/shot.js out.png [round] [aligned]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const server = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'font/ttf' }); s.end(d); }); }).listen(0);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  await p.goto(`http://localhost:${server.address().port}/dev/index.html?manual`);
  await p.waitForFunction(() => window.__ready && window.__loopUpdate, null, { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready);
  const round = +(process.argv[3] || 0);
  await p.evaluate(async (round) => {
    const st = s => { for (let i = 0; i < s * 60; i++) __loopUpdate(1000 / 60); };
    window.__SD_SKIP_RENDER = true; st(2.5);
    if (round) {
      document.querySelector('.sd-play').click(); st(1.5);
      for (let r = 1; r < round; r++) { __SD.rings.forEach(x => { if (x.state === 'spin') { x.state = 'settle'; x.settleFrom = x.angle; x.settleTo = 0; x.settleT = 1; x.lockGlow = 1; } }); __SD.G.phase = 'complete'; __SD.G.completeT = 0.99; st(2.6); }
      await new Promise(r => setTimeout(r, 900));
    }
    window.__SD_SKIP_RENDER = false; __loopUpdate(1);
  }, round);
  await p.waitForTimeout(300);
  await p.screenshot({ path: process.argv[2] });
  await b.close(); server.close();
})();
