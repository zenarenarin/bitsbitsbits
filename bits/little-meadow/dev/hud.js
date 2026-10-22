// HUD screenshots across phone sizes, safe-area modes and every UI state (frame-stepped, deterministic).
// usage: node dev/hud.js [outDir]   — also checks that controls clear the insets and the game-over sheet fits.
const path = require("path"), fs = require("fs");
const { chromium } = require(process.env.PW || "playwright");
const OUT = process.argv[2] || path.join(__dirname, "out", "hud");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "file://" + path.join(__dirname, "harness.html");
const VIEWS = [
  { name: "402x874", w: 402, h: 874, q: "" },
  { name: "360x640", w: 360, h: 640, q: "&top=24&bottom=48" },
  { name: "430x932", w: 430, h: 932, q: "&top=59&bottom=34" },
  { name: "375x812", w: 375, h: 812, q: "&top=47&bottom=34" },
  { name: "402x874-safe", w: 402, h: 874, q: "&frame=safe" },
  { name: "320x568-nofonts", w: 320, h: 568, q: "&top=20&bottom=0&nofonts=1" }
];
const problems = [];
(async () => {
  const browser = await chromium.launch();
  for (const v of VIEWS) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2, hasTouch: true });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE + "?manual=1" + v.q);
    await page.waitForFunction(() => window.__step && window.__LM_GAME__);
    await page.waitForTimeout(400); // fonts
    const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) __step(1000 / 60); }, n);
    // no steering: the mower runs into something, then the real loop plays the ending
    const untilOver = async () => {
      for (let i = 0; i < 80 && (await page.evaluate(() => __LM_GAME__.phase)) !== "over"; i++) await step(30);
      for (let i = 0; i < 20 && (await page.evaluate(() => __LM_GAME__.overT)) < 2.4; i++) await step(15);
      await page.waitForTimeout(700); await step(2); // leaderboard fetch settles
    };
    const shot = (n) => page.screenshot({ path: path.join(OUT, v.name + "-" + n + ".png") });
    await page.evaluate(() => { __LM_GAME__.setBest(4280); });
    await step(60); await shot("1-ready");
    await page.evaluate(() => __LM_GAME__.beginPlay());
    // fly a careful pilot ahead so the HUD has a score, a rhythm and a lost life
    await page.evaluate(() => {
      const G = __LM_GAME__;
      const C = window.__LM_CORE__;
      G.warp(1500, (sim) => { const s = sim.s; if (s.change) return; for (const d of [0, -1, 1]) { const l = s.lane + d; if (l < 0 || l > 6) continue; let ok = true; for (let r = 1; r <= 3; r++) { const c = sim.gen.cell(Math.floor(s.y) + r, l); if (!c || c.f || c.t === C.CELL_OBST) ok = false; } if (ok) { if (d) sim.swipe(d); return; } } });
      G.sim.s.lives = Math.min(G.sim.s.lives, 2);
    });
    await step(90); await shot("2-play");
    const ui = await page.evaluate(() => ({ b: __LM_GAME__.buttons, a: __LM_GAME__.area, W: innerWidth, H: innerHeight }));
    for (const k of ["pause", "sound"]) { const b = ui.b[k]; if (!b) { problems.push(v.name + ": no " + k + " button"); continue; } if (b.w < 44 || b.h < 44) problems.push(v.name + ": " + k + " target " + b.w + "x" + b.h); if (b.y < ui.a.top - 1 || b.x + b.w > ui.W - ui.a.right + 1) problems.push(v.name + ": " + k + " outside safe area " + JSON.stringify(b)); }
    await page.evaluate(() => __LM_GAME__.togglePause()); await step(10); await shot("3-paused");
    await page.evaluate(() => __LM_GAME__.openSound()); await step(10); await shot("4-sound");
    // close the panel by tapping outside, resume, then run out of lives
    await page.mouse.click(10, v.h - 10); await step(2);
    await page.evaluate(() => __LM_GAME__.togglePause());
    await page.evaluate(() => { __LM_GAME__.sim.s.lives = 1; });
    await untilOver(); await shot("5-over");
    const ov = await page.evaluate(() => ({ b: __LM_GAME__.buttons.again, a: __LM_GAME__.area, H: innerHeight }));
    if (!ov.b) problems.push(v.name + ": restart not active");
    else {
      if (ov.b.h < 44) problems.push(v.name + ": restart height " + ov.b.h);
      if (ov.b.y + ov.b.h > ov.H - ov.a.bottom) problems.push(v.name + ": restart overlaps bottom inset");
      // pressed state, then release elsewhere (cancel), then a real tap restarts
      await page.mouse.move(ov.b.x + ov.b.w / 2, ov.b.y + ov.b.h / 2); await page.mouse.down(); await step(1); await shot("6-over-pressed");
      await page.mouse.move(ov.b.x + ov.b.w / 2, ov.b.y - 120); await page.mouse.up(); await step(1);
      const still = await page.evaluate(() => __LM_GAME__.phase);
      if (still !== "over") problems.push(v.name + ": release outside restarted (" + still + ")");
      await page.mouse.click(ov.b.x + ov.b.w / 2, ov.b.y + ov.b.h / 2); await step(2);
      const ph = await page.evaluate(() => __LM_GAME__.phase);
      if (ph === "over") problems.push(v.name + ": tap on restart did nothing");
    }
    // a new-best run
    await page.evaluate(() => { const G = __LM_GAME__; G.setBest(10); if (G.phase === "ready") G.beginPlay(); G.sim.s.lives = 1; });
    await untilOver(); await shot("7-over-newbest");
    if (errs.length) problems.push(v.name + ": " + errs.join(" | "));
    await page.close();
    console.log("done", v.name);
  }
  await browser.close();
  console.log(problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "all HUD checks passed");
})();
