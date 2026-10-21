// Autoplay the live game with validated solutions; screenshot each encounter.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
const prefer = process.argv[3] || 'first'; // 'first' | 'last' (clever)
const secs = +(process.argv[4] || 120);
const vw = +(process.argv[5] || 390), vh = +(process.argv[6] || 844);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message + '\n' + e.stack));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await page.evaluate(() => window.__unmake.begin());
  const seen = new Set();
  let n = 0;
  for (let t = 0; t < secs; t += 0.4) {
    const st = await page.evaluate(pref => {
      const u = window.__unmake;
      u.autoplay(0.4, seg => pref === 'last' ? 99 : 0);
      const r = u.run; if (!r) return { mode: u.mode };
      const tr = r.world.trav;
      const seg = r.segs.find(s => tr.s >= s.s0 - 1 && tr.s < s.s0 + s.len);
      return { mode: u.mode, s: +tr.s.toFixed(1), st: tr.state, why: tr.waitReason, seg: seg && seg.name, idx: seg && seg.idx, rel: seg ? +(tr.s - seg.s0).toFixed(1) : 0, score: Math.floor(r.score), ch: r.charges, buf: +(tr.s - r.front).toFixed(1), sol: seg && seg.autoName, bonus: JSON.stringify(r.bonus) };
    }, prefer);
    if (st.mode !== 'play') { console.log('ENDED', JSON.stringify(st)); await page.screenshot({ path: `${out}/zz_end.png` }); break; }
    const key = st.idx + ':' + (st.rel > 3 ? 'mid' : 'in');
    if (st.seg && st.seg !== 'recovery' && !seen.has(key) && st.rel > 3) {
      seen.add(key);
      await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${st.seg}.png` });
      console.log('shot', JSON.stringify(st));
    }
  }
  console.log(await page.evaluate(() => { const r = window.__unmake.run; return r ? JSON.stringify({ s: r.world.trav.s, score: r.score, bonus: r.bonus, segs: r.segs.map(s => s.name + (s.autoName ? '(' + s.autoName + ')' : '')).join(' ') }) : 'no run'; }));
  await browser.close();
})();
