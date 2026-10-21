// Heuristic playtest bot: steers toward ground ahead, jumps gaps, performs each
// encounter's chosen solution, screenshots each encounter. usage: node dev/bot.js out [secs] [sol: 0|1] [view]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2], SECS = +(process.argv[3] || 90), SOL = +(process.argv[4] || 0), VIEW = process.argv[5] || 'third';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(([sol, view]) => {
    const u = window.__unmake; u.save().settings.view = view; u.save().runs = 5; u.begin();
    window.__bot = { log: [], sol };
    window.__botStep = function () {
      const r = u.run, p = r.player, P = r.P, B = window.__bot;
      const seg = r.segs.find(s => s.idx >= 0 && !s.cleared && s.z0 > p.pos[2] - 40);
      let inp = { steer: 0, pace: 0, jump: false };
      // perform the chosen solution's interventions when close
      if (seg) {
        const sols = seg.meta.solutions; const s = sols[Math.min(B.sol, sols.length - 1)];
        seg.botSol = s.name; seg.botDone = seg.botDone || {};
        for (const a of s.acts) {
          if (seg.botDone[a]) continue;
          const o = seg.meta.keys[a]; if (!o) continue;
          const pt = o.isConn ? P.connMid(o) : o.pos;
          if (p.pos[2] - pt[2] < 15 && p.pos[2] - pt[2] > -4) { const res = u.act(a, seg.name); if (res === 'ok') { seg.botDone[a] = r.t; B.log.push(seg.name + ':' + a + '@' + r.t.toFixed(1)); } }
        }
        if (s.sprint) inp.pace = 1;
        // wait for structures to settle after an intervention
        const last = Math.max(0, ...Object.values(seg.botDone));
        if (last && r.t - last < 2.2) inp.pace = -1;
      }
      // where is ground ahead?
      const py = p.pos[1], px = p.pos[0], pz = p.pos[2];
      const ground = (x, z) => P.groundAt(x, z, py + 1.6);
      // is the lane at x blocked at chest height between here and dz ahead?
      const blocked = (x, dz) => { for (let k = 0.6; k <= dz; k += 0.5) { const q = [x, py + 1.0, pz - k]; for (const b of P.near([q[0], q[1], q[2], q[0], q[1], q[2]], 0.05)) { if (b.passable || (b.erase && seg && seg.meta.solutions.some(s => s.acts.includes(b.key)))) continue; const c = P.closestPoint(b, q); if (Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < 0.35) return true; } } return false; };
      let best = null, bd = 1e9;
      for (let dz = 2; dz <= 7; dz += 1) for (let x = -6; x <= 6; x += 0.4) {
        const g = ground(x, pz - dz);
        if (!g.body || g.body.passable || g.y < py - 6 || g.y > py + 1.4 || blocked(x, Math.min(dz, 4))) continue;
        const cost = Math.abs(x - px) + dz * 0.3 + (g.y < py - 1.2 ? 3 : 0) + Math.max(0, g.y - py) * 2;
        if (cost < bd) { bd = cost; best = x; }
      }
      if (best !== null) inp.steer = Math.max(-1, Math.min(1, (best - px) * 0.9));
      const near = ground(px, pz - 0.45);
      const step = near.body && near.y > py + 0.4;
      if (p.grounded && (!near.body || near.y < py - 1.0 || step)) {
        let land = false;
        for (let dz = 1.5; dz <= 5.4; dz += 0.3) { const g = ground(px + inp.steer * dz * 0.6, pz - dz); if (g.body && g.y <= py + 1.4 && g.y > py - 5) { land = true; break; } }
        if (land || step) inp.jump = true; else if (!seg || !seg.meta.solutions[Math.min(B.sol, seg.meta.solutions.length - 1)].sprint) inp.pace = -1;
      }
      return inp;
    };
  }, [SOL, VIEW]);
  const seen = new Set(); let n = 0;
  for (let t = 0; t < SECS; t += 0.25) {
    const st = await page.evaluate(() => {
      const u = window.__unmake; if (u.mode !== 'play') return { mode: u.mode };
      for (let i = 0; i < 15; i++) { const inp = window.__botStep(); u.input.virtual = { steer: inp.steer, pace: inp.pace }; if (inp.jump) { u.input.jumpPressed = true; u.input.jumpHeld = true; } u.step(1 / 60); if (u.mode !== 'play') break; }
      u.frame();
      const r = u.run, p = r.player; const s = r.segs.find(s => p.pos[2] <= s.z0 && p.pos[2] > s.z1);
      return { mode: u.mode, seg: s && s.name, idx: s && s.idx, rel: s ? +(s.z0 - p.pos[2]).toFixed(1) : 0, y: +p.pos[1].toFixed(1), ch: r.charges, catches: r.catches, dist: Math.floor(r.frontier), sol: s && s.botSol };
    });
    if (st.mode !== 'play') { console.log('END', JSON.stringify(st)); break; }
    const key = st.idx + ':' + (st.rel > 6 ? 'b' : 'a');
    if (st.seg && st.seg !== 'lead' && st.seg !== 'approach' && !seen.has(key)) { seen.add(key); await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${st.seg}_${st.rel > 6 ? 'mid' : 'in'}.png` }); console.log('shot', JSON.stringify(st)); }
  }
  console.log(await page.evaluate(() => { const u = window.__unmake, r = u.run; return JSON.stringify({ mode: u.mode, dist: Math.floor(r.frontier), catches: r.catches, chains: r.chains, enc: r.encounters, log: window.__bot.log, segs: r.segs.map(s => s.name + (s.cleared ? '✓' : '')).join(' ') }); }));
  await page.screenshot({ path: `${out}/zz_end.png` });
  await browser.close();
})();
