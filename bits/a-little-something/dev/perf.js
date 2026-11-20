// Frame pacing under 4x CPU throttle across the heaviest beats. node dev/perf.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.goto('http://localhost:8777/dev/index.html');
  await p.waitForFunction(() => window.__ready === true);
  const sample = async (label) => {
    const r = await p.evaluate(() => new Promise((res) => { const ts = []; const f = (t) => { ts.push(t); if (ts.length < 90) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }));
    const d = r.slice(1).map((t, i) => t - r[i]).sort((a, b) => a - b);
    console.log(label, 'median', d[d.length >> 1].toFixed(1), 'ms  p95', d[Math.floor(d.length * 0.95)].toFixed(1), 'ms');
  };
  await sample('intro');
  for (let i = 0; i < 7; i++) { await p.mouse.click(201, 200); await p.waitForTimeout(i === 3 ? 4200 : 1700); if (i === 3) await sample('afloat'); }
  await p.waitForTimeout(4500);
  await sample('finale/outro');
  await b.close();
})();
