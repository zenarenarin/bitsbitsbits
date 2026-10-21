// Drives the real Bit in Chromium with a mock ctx: screenshots + an in-page autopilot.
const path = require("path");
const { chromium } = require(process.env.PW || "playwright");
const OUT = process.argv[2] || path.join(__dirname, "out");
require("fs").mkdirSync(OUT, { recursive: true });
const URL = "file://" + path.join(__dirname, "harness.html");
const AUTOPILOT = `
(() => {
  const C = window.__LM_CORE__, G = window.__LM_GAME__;
  function plan() {
    const sim = G.sim, s = sim.s, gen = sim.gen;
    if (s.phase !== 'play') return;
    const r0 = Math.floor(s.y + 0.15), H = 10, V = [];
    const safe = (c) => !c.f && c.t !== C.CELL_OBST;
    for (let k = H; k >= 0; k--) {
      const row = gen.row(r0 + k); V[k] = [];
      for (let l = 0; l < 7; l++) {
        const c = row.cells[l]; if (!safe(c)) { V[k][l] = -1e6; continue; }
        let val = 0; for (const t of row.tufts) if (!t.cut && Math.abs(t.x - (l + 0.5)) < 0.46) val += t.v;
        let best = k === H ? 0 : -1e6;
        if (k < H) for (let d = -1; d <= 1; d++) { const l2 = l + d; if (l2 < 0 || l2 > 6) continue; const n = gen.row(r0 + k + 1);
          if (d && (n.cells[l].t === C.CELL_OBST || row.cells[l2].t === C.CELL_OBST || (row.cells[l2].f && n.cells[l].f))) continue;
          best = Math.max(best, V[k + 1][l2] - (d ? 0.3 : 0)); }
        V[k][l] = val + best;
      }
    }
    const k = Math.floor(s.y + 0.15 + 1.1) - r0, cur = s.change ? s.change.to : s.lane;
    let bl = cur, bv = -1e9;
    for (let d = -1; d <= 1; d++) { const l = cur + d; if (l < 0 || l > 6) continue; const v = V[Math.min(k, H)][l] - (d ? 0.5 : 0); if (v > bv) { bv = v; bl = l; } }
    if (bl !== cur && !s.change && !window.__noPilot) G.steer(bl > cur ? 1 : -1);
  }
  window.__pilot = setInterval(plan, 90);
})();`;
(async () => {
  const browser = await (process.env.CHROME ? chromium.launch({ executablePath: process.env.CHROME }) : chromium.launch());
  const vp = { width: 402, height: 874 };
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.text().includes("little-meadow")) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "01-ready.png") });
  // real touch swipe to start (right)
  await page.evaluate(() => {
    const c = document.querySelector("canvas"); const r = c.getBoundingClientRect();
    const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 500, bubbles: true, pointerType: "touch", isPrimary: true }));
    ev("pointerdown", 150); ev("pointermove", 165); ev("pointermove", 185); ev("pointerup", 190);
  });
  await page.waitForTimeout(400);
  const lane1 = await page.evaluate(() => ({ phase: __LM_GAME__.phase, lane: __LM_GAME__.sim.s.lane, x: __LM_GAME__.sim.s.x }));
  console.log("after first swipe:", JSON.stringify(lane1));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(OUT, "02-first-seconds.png") });
  await page.addScriptTag({ content: AUTOPILOT });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(OUT, "03-play-12s.png") });
  // measure frame pacing for 4 s
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(), worst = 0, last = t0; function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), worstMs: worst }); } requestAnimationFrame(f); }));
  console.log("frame pacing (headless desktop, not a phone):", JSON.stringify(fps));
  await page.waitForTimeout(14000);
  await page.screenshot({ path: path.join(OUT, "04-play-30s.png") });
  const st = await page.evaluate(() => { const s = __LM_GAME__.sim.s; return { score: s.score, lives: s.lives, y: s.y, level: s.level, stats: s.stats, chunks: __LM_GAME__.chunks, trail: __LM_GAME__.trail }; });
  console.log("state @30s:", JSON.stringify({ score: st.score, lives: st.lives, rows: Math.floor(st.y), level: st.level, near: st.stats.near, patches: st.stats.patches, hits: st.stats.collisions, chunks: st.chunks, trail: st.trail }));
  // pause / resume
  await page.evaluate(() => __LM_GAME__.togglePause());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "05-paused.png") });
  const y1 = await page.evaluate(() => __LM_GAME__.sim.s.y);
  await page.waitForTimeout(500);
  const y2 = await page.evaluate(() => __LM_GAME__.sim.s.y);
  console.log("paused holds position:", y1 === y2);
  await page.evaluate(() => __LM_GAME__.togglePause());
  // force a crash course: stop the pilot and wait for collisions
  await page.evaluate(() => { window.__noPilot = true; });
  let hitShot = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(250);
    const p = await page.evaluate(() => ({ phase: __LM_GAME__.phase, lives: __LM_GAME__.sim.s.lives, since: __LM_GAME__.sim.s.time - (__LM_GAME__.sim.s.lastHitT || -9) }));
    if (!hitShot && p.since < 0.3) { await page.screenshot({ path: path.join(OUT, "06-hit.png") }); hitShot = true; }
    if (p.phase === "over") break;
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "07-over-early.png") });
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(200); if (await page.evaluate(() => __LM_GAME__.overT > 2.6)) break; }
  await page.screenshot({ path: path.join(OUT, "08-over.png") });
  const log = await page.evaluate(() => __log.filter((e) => e[0] !== "haptic"));
  console.log("platform log:", JSON.stringify(log).slice(0, 900));
  // restart via the real button
  const btn = await page.evaluate(() => { const c = document.querySelector("canvas"); return null; });
  await page.mouse.click(201, 874 - 108.5 - 18 - 29);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ phase: __LM_GAME__.phase, score: __LM_GAME__.sim.s.score, lives: __LM_GAME__.sim.s.lives, trail: __LM_GAME__.trail }));
  console.log("after restart click:", JSON.stringify(after));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "09-restart.png") });
  // small phone + resize
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "10-small.png") });
  console.log("errors:", JSON.stringify(errors.slice(0, 20)));
  await browser.close();
})();
