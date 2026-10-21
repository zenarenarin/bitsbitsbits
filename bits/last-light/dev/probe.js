// Fraction of time each spot is lit by any lamp (pattern only, Watcher calm), and
// agreement between the drawn polygons and the detection test.
const { open } = require('./sim');
(async () => {
  const { browser, page, errs } = await open();
  const r = await page.evaluate(() => {
    const L = window.__ll, lv = L.level, O = L.optics;
    const rows = [
      ['roof y11.6 (head)', 13, 44, 13.0], ['roof lip hang (body)', 13, 44, 10.8],
      ['street (chest)', 44, 99, 0.9], ['high road 8.4 (chest)', 51, 71, 9.3], ['gate roof 11.8', 79, 89, 12.7],
      ['court street', 88, 143, 0.9], ['balcony 6.4', 121, 127, 7.3], ['roof 13', 128, 142, 13.9]
    ];
    const out = [];
    for (const [name, x0, x1, y] of rows) {
      let line = '';
      for (let x = x0; x <= x1; x += 1) {
        let lit = 0, n = 0;
        L.watcher.reset();
        for (let t = 0; t < 12; t += 0.1) {
          for (const l of lv.lights) { l.clock += 0.1; l.ang = l.base + (l.amp ? l.amp * Math.sin(2 * Math.PI * l.clock / l.period) : 0); l.halfNow = l.half; }
          n++; if (lv.lights.some(l => O.sees(l, x, y))) lit++;
        }
        const f = lit / n;
        line += f === 0 ? '.' : f < 0.25 ? '-' : f < 0.6 ? '+' : '#';
      }
      out.push(name.padEnd(24) + ' ' + x0 + ' ' + line + ' ' + x1);
    }
    // agreement: point in drawn polygon vs sees()
    const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    let agree = 0, tot = 0, bad = [];
    for (const l of lv.lights) { l.halfNow = l.half; const p = O.polygon(l, []); for (let k = 0; k < 3000; k++) { const x = l.x + (Math.random() * 2 - 1) * l.range, y = l.y - Math.random() * l.range * 1.1 + 2; if (Math.hypot(x - l.x, y - l.y) > l.range * 0.97) continue; const a = O.sees(l, x, y), b = inPoly(p, x, y); tot++; if (a === b) agree++; else if (bad.length < 5) bad.push([l.id, x.toFixed(2), y.toFixed(2), a, b]); } }
    out.push('polygon/detection agreement ' + agree + '/' + tot + ' ' + JSON.stringify(bad));
    return out.join('\n');
  });
  console.log(r); if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
