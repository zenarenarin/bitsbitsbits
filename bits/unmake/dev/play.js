// Scripted playthrough: advance sim, erase specific keys, screenshot.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2];
const vw = +(process.argv[3] || 390), vh = +(process.argv[4] || 844);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message + '\n' + e.stack));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 60000 });
  await page.evaluate(() => { window.__unmake.begin(); });
  const state = () => page.evaluate(() => { const r = window.__unmake.run; const t = r.world.trav; const seg = r.segs.find(s => t.s >= s.s0 && t.s < s.s0 + s.len); return { s: +t.s.toFixed(2), st: t.state, why: t.waitReason, seg: seg && seg.name, score: Math.floor(r.score), ch: r.charges, mode: window.__unmake.mode, front: +r.front.toFixed(1) }; });
  // erase by pattern key in the current or next segment
  const erase = (name, key) => page.evaluate(([name, key]) => {
    const u = window.__unmake, r = u.run, t = r.world.trav;
    const seg = r.segs.find(s => s.name === name && s.s0 + s.len > t.s);
    const o = seg && seg.meta.keys[key];
    if (!o || o.gone) return 'missing';
    if (r.charges < 1) return 'nocharge';
    r.charges--; seg.used++; r.world.erase(o); r.castT = 0.4; return 'ok';
  }, [name, key]);
  let n = 0;
  const shot = async (label) => { await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${label}.png` }); };
  const adv = (sec) => page.evaluate(s => window.__unmake.advance(s), sec);
  const until = async (pred, max = 40, chunk = 0.25) => { for (let t = 0; t < max; t += chunk) { const st = await state(); if (pred(st)) return st; await adv(chunk); } return state(); };
  const plan = JSON.parse(process.argv[5] || '[]');
  await adv(0.1); await shot('start');
  for (const p of plan) {
    if (p.until) { const st = await until(s => s.seg === p.until && (p.why ? s.why === p.why : true), p.max || 40); console.log('until', p.until, JSON.stringify(st)); }
    if (p.adv) await adv(p.adv);
    if (p.erase) console.log('erase', p.erase, await erase(p.erase[0], p.erase[1]));
    if (p.shot) { await shot(p.shot); console.log('shot', p.shot, JSON.stringify(await state())); }
  }
  await browser.close();
})();
