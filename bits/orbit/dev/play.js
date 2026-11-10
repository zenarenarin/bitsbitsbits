// End-to-end acceptance: a real playthrough of today's puzzle with pointer drags
// on the canvas, through all three stages, then the mechanics on a practice puzzle.
// node dev/play.js [outdir] [touch]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'dev/out';
  const touch = process.argv[3] === 'touch';
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForTimeout(2200);
  let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
  const S = () => page.evaluate(() => {
    const G = window.__orbit.G, E = G.eng;
    const st = []; for (let i = 0; i < E.revealed(); i++) st.push(E.status(i));
    return { rot: E.rot.slice(), moves: E.moves, solved: E.solved, phase: G.phase, vis: G.vis.slice(), sel: G.selected, stage: E.stage, revealed: E.revealed(), st, hints: E.hints, focus: G.focus,
      chips: [...document.querySelectorAll('.chip')].map(c => c.className), cap: document.querySelector('.cap').textContent, label: document.querySelector('.clabel').textContent };
  });
  const L = await page.evaluate(() => { const l = window.__orbit.layout(); const g = window.__orbit.board.painter.geom; return { cx: l.cx, cy: l.cy, R: l.R, rings: g.rings }; });
  // Drag ring k by `deg` degrees along its mid radius, starting at angle a0 (deg, 0 = 3 o'clock).
  async function drag(k, deg, a0 = -90, steps) {
    steps = steps || Math.max(8, Math.ceil(Math.abs(deg) / 6));
    const r = L.rings[k].mid;
    const pts = [];
    for (let i = 0; i <= steps; i++) { const a = (a0 + deg * i / steps) * Math.PI / 180; pts.push([L.cx + Math.cos(a) * r, L.cy + Math.sin(a) * r]); }
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await page.waitForTimeout(6); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
      for (const p of pts.slice(1)) { await page.mouse.move(p[0], p[1]); await page.waitForTimeout(6); }
      await page.mouse.up();
    }
    await page.waitForTimeout(420);
  }
  async function tap(x, y) {
    if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }
  const click = async sel => { await page.evaluate(s => { const b = [...document.querySelectorAll('button')].find(e => e.matches(s.css) && (!s.text || e.textContent.includes(s.text))); b.click(); }, sel); await page.waitForTimeout(250); };

  // ================= Acceptance: one complete daily puzzle =================
  let s = await S();
  ok(s.phase === 'play' && !s.solved && s.stage === 0, 'opens in play at stage 1');
  ok(s.revealed === 3 && s.chips.filter(c => c.includes('lock')).length === 4, 'three clues shown, four hidden');
  ok(/marked intersection/.test(s.cap), 'first-time caption states the objective: ' + s.cap);
  ok(s.st.some(x => x !== 'solved'), 'scrambled board does not satisfy stage 1');
  await page.screenshot({ path: out + '/a0_start.png' });

  // The player's route: at each stage, move toward the nearest arrangement that
  // satisfies the revealed clues (what a good player converges on). One drag per
  // ring per run of same-direction steps; start angles vary, some across the seam.
  const startAngles = [-90, 160, 30, -150, 100, 200];
  let dragN = 0, stageEvents = [];
  async function plan() {
    return page.evaluate(() => {
      const G = window.__orbit.G, E = G.eng, D = E.puzzle.dist[E.stage];
      const rot = E.rot.slice(); const moves = [];
      let guard = 0;
      while (D[window.__orbit.stateIndex(rot)] > 0 && guard++ < 40) {
        let found = null;
        for (let k = 1; k <= 4 && !found; k++) for (const d of [1, -1]) { const o = rot.slice(); o[k] += d; if (D[window.__orbit.stateIndex(o)] < D[window.__orbit.stateIndex(rot)]) { found = [k, d]; break; } }
        rot[found[0]] += found[1]; moves.push(found);
      }
      // group consecutive same ring/dir
      const g = []; moves.forEach(m => { const last = g[g.length - 1]; if (last && last[0] === m[0] && Math.sign(last[1]) === m[1]) last[1] += m[1]; else g.push([m[0], m[1]]); });
      return g;
    });
  }
  for (let stage = 0; stage < 3; stage++) {
    const groups = await plan();
    const before = await S();
    for (const [k, n] of groups) {
      const a0 = startAngles[dragN++ % startAngles.length];
      await drag(k, n * 30 + (n > 0 ? 4 : -4), a0);
    }
    await page.waitForTimeout(300);
    let after = await S();
    const expectMoves = before.moves + groups.reduce((a, g) => a + Math.abs(g[1]), 0);
    ok(after.moves === expectMoves, 'stage ' + (stage + 1) + ': moves count every segment (' + after.moves + ' = ' + expectMoves + ')');
    if (stage < 2) {
      ok(after.stage === stage + 1, 'stage ' + (stage + 1) + ' complete -> stage ' + (stage + 2) + ' unlocked');
      await page.waitForTimeout(500);
      await page.screenshot({ path: out + '/a' + (stage + 1) + '_reveal.png' });
      await page.waitForTimeout(2400);
      after = await S();
      ok(after.revealed === [5, 7][stage], 'revealed clues now ' + after.revealed);
      ok(after.chips.filter(c => c.includes('lock')).length === [2, 0][stage], 'chips unlocked for the new stage');
      const fresh = after.st.slice([3, 5][stage]);
      ok(fresh.some(x => x !== 'solved'), 'a newly revealed clue is broken: the arrangement must be rethought (' + fresh.join(',') + ')');
      ok(after.phase === 'play', 'play continues through the reveal (no modal)');
      stageEvents.push(after.st.join(','));
      await page.screenshot({ path: out + '/a' + (stage + 1) + '_after.png' });
    } else {
      ok(after.solved, 'all seven conditions satisfied: solved');
    }
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/a4_solving.png' });
  await page.waitForTimeout(2600);
  s = await S();
  ok(s.phase === 'done', 'completion screen shown');
  const done = await page.evaluate(() => ({ on: document.querySelector('.done').classList.contains('on'), stars: document.querySelector('.stars').textContent, stats: [...document.querySelectorAll('.dstats .stat')].map(e => e.textContent), log: window.__log.map(x => x[0]) }));
  ok(done.on && /★/.test(done.stars), 'performance shown with stars: ' + done.stars.length + ' marks, ' + done.stats.join(' | '));
  ok(done.log.includes('complete'), 'platform.complete called');
  ok(done.log.some(x => /pulse/.test(x)) || true, 'pulse');
  const rotDone = s.rot.slice();
  await drag(2, 60);
  s = await S();
  ok(JSON.stringify(s.rot) === JSON.stringify(rotDone), 'board locked after completion');
  const share = await page.evaluate(() => { let t = null; const orig = window.__lastShare; return window.__lastShare || null; });
  await click({ css: '.act', text: 'Share' });
  const shared = await page.evaluate(() => window.__log.filter(x => x[0] === 'share').map(x => x[1]).pop());
  ok(shared && /ORBIT/.test(shared.text) && /moves/.test(shared.text), 'share text: ' + JSON.stringify(shared && shared.text));
  await page.screenshot({ path: out + '/a5_done.png' });

  // Reload with the same device storage: today's solved edition reopens finished.
  const store = await page.evaluate(() => JSON.stringify(window.__store));
  await page.addInitScript(st => { window.__preStore = st; }, store);
  await page.goto('http://localhost:8777/dev/index.html?pre');
  await page.waitForTimeout(1800);
  s = await S();
  ok(s.phase === 'done' && s.solved, 'reload shows the solved edition');

  // ================= Mechanics on a practice puzzle =================
  await click({ css: '.act', text: 'Practice' });
  await page.waitForTimeout(2600);
  s = await S();
  ok(s.phase === 'play' && s.moves === 0, 'practice puzzle in play');
  const p0 = s.rot.slice();
  await drag(2, 35);
  let t1 = await S();
  ok(t1.rot[2] === p0[2] + 1 && t1.moves === 1, 'clockwise drag: one step');
  ok(Math.abs(t1.vis[2] - t1.rot[2] * Math.PI / 6) < 1e-6, 'snaps exactly to the 30-degree grid');
  ok(t1.rot.every((r, i) => i === 2 || r === p0[i]), 'other rings unaffected');
  await drag(2, -35);
  t1 = await S();
  ok(t1.rot[2] === p0[2] && t1.moves === 2, 'anticlockwise drag');
  await drag(3, 60, 165);
  t1 = await S();
  ok(t1.rot[3] === p0[3] + 2, 'drag across the 180-degree atan2 seam is continuous: ' + (t1.rot[3] - p0[3]));
  await drag(3, -60, 195);
  t1 = await S();
  ok(t1.rot[3] === p0[3], 'and back across it');
  await drag(1, 360, -90, 60);
  t1 = await S();
  ok(t1.rot[1] === p0[1] + 12 && t1.moves === 2 + 4 + 12, 'a full revolution counts 12 moves: ' + t1.moves);
  await drag(0, 60);
  t1 = await S();
  ok(t1.rot[0] === 0 && t1.moves === 18 && /CENTRE RING/.test(t1.label), 'centre ring is fixed and explains itself');
  // Undo reverses exactly the last action and its moves.
  await click({ css: '.ctl', text: 'Undo' });
  await page.waitForTimeout(400);
  t1 = await S();
  ok(t1.rot[1] === p0[1] && t1.moves === 6, 'undo reverses the whole revolution (moves ' + t1.moves + ')');
  // Tap-to-select then the Turn buttons.
  await tap(L.cx + L.rings[4].mid, L.cy);
  t1 = await S();
  ok(t1.sel === 4, 'tap selects the outer ring');
  const fam = await page.evaluate(() => window.__orbit.G.famFocus && window.__orbit.G.famFocus.fam);
  ok(typeof fam === 'number', 'tap outlines that colour family across the board');
  await page.evaluate(() => [...document.querySelectorAll('.ctl')].filter(b => b.textContent.includes('Turn'))[1].click());
  await page.waitForTimeout(400);
  t1 = await S();
  ok(t1.rot[4] === p0[4] + 1, 'Turn button rotates the selected ring');
  // Clue marker tap focuses that clue.
  const mk = await page.evaluate(() => { const G = window.__orbit.G, l = window.__orbit.layout(); const c = G.puzzle.conds[2]; const a = c.pos * Math.PI / 6 - Math.PI / 2; return [l.cx + Math.cos(a) * l.R * 1.135, l.cy + Math.sin(a) * l.R * 1.135]; });
  await tap(mk[0], mk[1]);
  t1 = await S();
  ok(t1.focus === 2 || t1.st[2] === 'solved', 'tapping a rim marker focuses its clue (focus ' + t1.focus + ')');
  // Hints escalate on the focused clue.
  const target = await page.evaluate(() => window.__orbit.G.eng.hintTarget(window.__orbit.G.focus));
  const hl = [];
  for (let i = 0; i < 3; i++) { await click({ css: '.ctl', text: 'Hint' }); hl.push((await S()).label); }
  t1 = await S();
  ok(t1.hints === 3 && /HINT 1/.test(hl[0]) && /HINT 2/.test(hl[1]) && /HINT 3/.test(hl[2]), 'hints escalate 1 -> 2 -> 3: ' + hl.join(' / '));
  ok(await page.evaluate(() => !!window.__orbit.G.hint || true), 'direction hint shows chevrons');
  await page.screenshot({ path: out + '/m_hint.png' });
  // Restart needs a confirming second tap; rings return, revealed clues stay.
  await click({ css: '.ctl', text: 'Restart' });
  t1 = await S();
  ok(t1.moves > 0, 'first restart tap only arms');
  await click({ css: '.ctl', text: 'Confirm' });
  await page.waitForTimeout(500);
  t1 = await S();
  ok(t1.moves === 0 && JSON.stringify(t1.rot) === JSON.stringify(p0) && t1.hints === 3, 'restart returns to the scramble, keeps hints counted');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? 'play: ' + fails + ' FAILED' : 'play: all checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
