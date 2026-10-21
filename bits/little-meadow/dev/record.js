// Renders a deterministic gameplay clip: game time advances `speed`x per output frame.
// usage: node record.js [seconds=10] [speed=2] [seed=0]  -> out/little-meadow.mp4
const path = require("path"), fs = require("fs"), { execFileSync } = require("child_process");
const { chromium } = require(process.env.PW || "playwright");
const [secs = 10, speed = 2, seed = 0] = process.argv.slice(2).map(Number);
const FPS = 30, OUT = path.join(__dirname, "out"), FR = path.join(OUT, "frames");
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
(async () => {
  const browser = await (process.env.CHROME ? chromium.launch({ executablePath: process.env.CHROME }) : chromium.launch());
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  await page.addInitScript((sd) => { if (sd) localStorage.setItem("b_lm_best", "0"); }, seed);
  await page.goto("file://" + path.join(__dirname, "harness.html") + "?manual=1");
  await page.waitForFunction(() => window.__step && window.__LM_GAME__);
  // in-page autopilot: plans lanes like a careful player and waits for clean gaps
  await page.evaluate(() => {
    const C = __LM_CORE__, G = __LM_GAME__;
    const safe = (c) => !c.f && c.t !== C.CELL_OBST;
    function sweepClear(sim, dir) {
      const s = sim.s, fromX = s.x, toX = s.lane + dir + 0.5;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const e = 1 - Math.pow(1 - p, 2.2), x = fromX + (toX - fromX) * e, y = s.y + 0.8 * p;
        for (let r = Math.floor(y) - 1; r <= Math.floor(y) + 1; r++) { const row = sim.gen.row(r); if (row) for (const f of row.flowers) if (!f.hit && Math.hypot(f.x - x, f.y - y) < 0.52) return false; }
        if (sim.obstacleAt(x, y, 0.05)) return false;
        for (const rb of sim.rabbits) if (!rb.fled && Math.hypot(rb.x - x, rb.y - y) < 0.55) return false;
      }
      return true;
    }
    window.__pilot = () => {
      const sim = G.sim, s = sim.s, gen = sim.gen;
      if (G.phase !== "play" || s.change) return;
      const r0 = Math.floor(s.y + 0.15), H = 10, V = [];
      const blocked = new Set();
      for (const rb of sim.rabbits) if (!rb.fled) { blocked.add(Math.floor(rb.y) + ":" + Math.floor(rb.x)); if (rb.hop) blocked.add(Math.floor(rb.hop.y1) + ":" + Math.floor(rb.hop.x1)); }
      for (let k = H; k >= 0; k--) {
        const row = gen.row(r0 + k); V[k] = [];
        for (let l = 0; l < 7; l++) {
          const c = row.cells[l]; if (!safe(c) || blocked.has((r0 + k) + ":" + l)) { V[k][l] = -1e6; continue; }
          let val = 0; for (const t of row.tufts) if (!t.cut && Math.abs(t.x - (l + 0.5)) < 0.46) val += t.v;
          for (const f of row.flowers) if (Math.abs(f.x - (l + 0.5)) < 1.2) val += 1.5; // likes close shaves
          let best = k === H ? 0 : -1e6;
          if (k < H) for (let d = -1; d <= 1; d++) { const l2 = l + d; if (l2 < 0 || l2 > 6) continue; const n = gen.row(r0 + k + 1);
            if (d && (n.cells[l].t === C.CELL_OBST || row.cells[l2].t === C.CELL_OBST || (row.cells[l2].f && n.cells[l].f))) continue;
            best = Math.max(best, V[k + 1][l2] - (d ? 0.6 : 0)); }
          V[k][l] = val + best;
        }
      }
      const k = Math.max(1, Math.floor(s.y + 1.2) - r0);
      let bl = s.lane, bv = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l < 0 || l > 6) continue; const v = V[k][l] - (d ? 0.8 : 0); if (v > bv) { bv = v; bl = l; } }
      if (bl !== s.lane && sweepClear(sim, bl > s.lane ? 1 : -1)) G.steer(bl > s.lane ? 1 : -1);
    };
  });
  const total = secs * FPS, sub = 4, stepMs = (1000 / FPS) * speed / sub;
  for (let i = 0; i < total; i++) {
    await page.evaluate(([n, ms, i]) => {
      if (i === 12) __LM_GAME__.steer(1); // first flick, after a beat on the title
      for (let k = 0; k < n; k++) { window.__pilot(); window.__step(ms); }
    }, [sub, stepMs, i]);
    await page.screenshot({ path: path.join(FR, String(i).padStart(4, "0") + ".jpg"), type: "jpeg", quality: 92 });
  }
  const st = await page.evaluate(() => { const s = __LM_GAME__.sim.s; return { score: s.score, lives: s.lives, rows: Math.floor(s.y), near: s.stats.near, patches: s.stats.patches }; });
  await browser.close();
  const mp4 = path.join(OUT, "little-meadow.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(FR, "%04d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", mp4]);
  console.log("wrote", mp4, JSON.stringify(st));
})();
