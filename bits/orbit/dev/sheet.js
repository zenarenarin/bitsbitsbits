// Contact sheet of generated themes: node dev/sheet.js out.png [daily|level|universe] [from] [count]
const { chromium } = require('playwright');
(async () => {
  const [out, kind = 'daily', from = '1', count = '24'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(700);
  const h = await page.evaluate(([kind, from, count]) => {
    const O = window.__orbit;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;display:grid;grid-template-columns:repeat(6,200px);gap:0;font:11px sans-serif;color:#ccc;overflow:auto';
    document.body.appendChild(wrap);
    const n = +count;
    for (let i = 0; i < n; i++) {
      let t, rings = 5;
      if (kind === 'universe') {
        const u = O.ThemeRegistry.universes[(+from + i) % O.ThemeRegistry.universes.length];
        for (let d = 1; d < 400; d++) { const c = O.ThemeEngine.forDaily(d); if (c.universe === u.id) { t = c; break; } }
      } else t = kind === 'daily' ? O.ThemeEngine.forDaily(+from + i) : O.ThemeEngine.forLevel(+from + i);
      const c = O.renderThumbnail(t, rings, 200, 1);
      const cell = document.createElement('div'); cell.style.position = 'relative';
      cell.appendChild(c);
      const lab = document.createElement('div'); lab.style.cssText = 'position:absolute;left:4px;bottom:2px;color:' + t.ink.css + ';text-shadow:0 0 3px rgba(0,0,0,.4)';
      lab.textContent = t.key + ' ' + t.name + ' · ' + t.universe + '/' + t.material.id + '/' + t.bg.id;
      cell.appendChild(lab);
      wrap.appendChild(cell);
    }
    return Math.ceil(n / 6) * 200;
  }, [kind, from, count]);
  await page.setViewportSize({ width: 1200, height: h });
  await page.screenshot({ path: out });
  await browser.close();
})();
