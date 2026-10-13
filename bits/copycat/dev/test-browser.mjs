// End-to-end checks in Chromium against the local mock runtime.
// Run: npx http-server -p 8123 -s . (from the repo root), then
//      node bits/copycat/dev/test-browser.mjs [outDir]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(execSync("npm root -g").toString().trim() + "/");
const { chromium } = require("playwright");

const BASE = process.env.COPYCAT_URL || "http://127.0.0.1:8123/bits/copycat/dev/index.html";
const OUT = process.argv[2] || ".";
let failures = 0;
const check = (c, m) => { if (!c) failures++; console.log((c ? "ok  : " : "FAIL: ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function open(viewport, query, touch) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: !!touch, isMobile: !!touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?" + query);
  await page.waitForFunction(() => window.__booted || window.__bootError, null, { timeout: 15000 });
  return { page, ctx, errors };
}
const st = (page) => page.evaluate(() => {
  const g = window.__copycat, r = g.run;
  return { state: g.state, x: r.sim.x, score: r.score, pairs: r.pairs, combo: r.combo, bestCombo: r.bestCombo, perfects: r.perfects, prisms: r.prisms, syncs: r.syncs || 0,
    dead: r.dead, cause: r.cause, c: r.sim.c.map((c) => ({ y: c.y, gr: c.gr, dead: c.dead })), segs: r.segs.length, objs: r.W.map((w) => w.blocks.length + w.spikes.length + w.ceils.length),
    events: window.__events.map((e) => e.type), layout: g.layoutInfo(), v: r.sim.v };
});

// ---- 1. phone portrait: ready screen, first tap, both jump ----
{
  const { page, ctx, errors } = await open({ width: 390, height: 844 }, "test=1&fresh=1&seed=4242", true);
  await sleep(400);
  await page.screenshot({ path: OUT + "/01-ready-phone.png" });
  let s = await st(page);
  check(s.state === "ready", "boots into READY with characters visible");
  check(s.layout.mode === "stack", "portrait phone uses stacked worlds (" + s.layout.panels.map((p) => p.w + "x" + p.h).join(", ") + ")");
  check(s.events.includes("ready"), "ctx.platform.ready() was called after the first frame");
  await page.touchscreen.tap(195, 600);
  await sleep(120);
  s = await st(page);
  check(s.state === "playing", "first tap starts the run");
  check(!s.c[0].gr && !s.c[1].gr, "first tap made BOTH characters jump");
  check(s.events.includes("start"), "ctx.platform.start() on the first gesture");
  await sleep(1500);
  await page.screenshot({ path: OUT + "/02-intro-running.png" });
  s = await st(page);
  check(s.x > 4, "characters advance automatically (x=" + s.x.toFixed(2) + ")");
  // don't tap: the authored identical gap ends the run
  await page.waitForFunction(() => window.__copycat.state === "dying", null, { timeout: 8000 }).catch(() => {});
  await sleep(1100);
  await page.screenshot({ path: OUT + "/03a-death-feedback.png" });
  const fail = await page.evaluate(() => {
    const g = window.__copycat, f = g.run.fail, p = g.layoutInfo().panels[0];
    if (!f) return null;
    const camX = g.run.sim.x + g.run.camShift, centre = (f.beat.lo + f.beat.hi) / 2;
    return { text: f.text, beat: !!f.beat, sx: p.w * 0.22 + (centre - camX) * p.s, w: p.w };
  });
  check(fail && fail.beat && /NO JUMP/.test(fail.text), "failure names what to change (" + (fail && fail.text) + ") and marks the jump zone");
  check(fail && fail.sx > 20 && fail.sx < fail.w - 20, "the safe jump zone is on screen after the death (x=" + (fail && fail.sx.toFixed(0)) + "px)");
  await page.waitForFunction(() => window.__copycat.state === "over", null, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  s = await st(page);
  await page.screenshot({ path: OUT + "/03-game-over.png" });
  check(s.state === "over", "not jumping the gap ends the run with a game-over screen");
  check(s.cause === "fell" || s.cause === "wall", "failure cause is explained (" + s.cause + ")");
  check(s.events.includes("fail"), "ctx.platform.fail() reported");
  const tRestart = Date.now();
  await page.touchscreen.tap(195, 700);
  await page.waitForFunction(() => window.__copycat.state === "playing", null, { timeout: 3000 });
  const restartMs = Date.now() - tRestart;
  s = await st(page);
  check(restartMs < 1000 && s.score === 0 && s.x < 1.5, "one tap restarts immediately (" + restartMs + "ms) with a reset run");
  check(errors.length === 0, "no page errors (" + errors.slice(0, 3).join(" | ") + ")");
  await ctx.close();
}

// ---- 2. autopilot: the solver plays the real game for a long run ----
{
  const { page, ctx, errors } = await open({ width: 390, height: 844 }, "test=1&autopilot=1&fresh=1&seed=777", true);
  await page.evaluate(() => { window.__timeScale = 3; });
  await page.touchscreen.tap(195, 600);
  const shots = [[2500, "04-onboarding"], [9000, "05-mid-run"], [20000, "06-later-run"]];
  const t0 = Date.now();
  let samples = [];
  for (const [at, name] of shots) {
    while (Date.now() - t0 < at) await sleep(200);
    await page.evaluate(() => { window.__timeScale = 0.0001; });
    await sleep(80);
    await page.screenshot({ path: OUT + "/" + name + ".png" });
    samples.push(await st(page));
    await page.evaluate(() => { window.__timeScale = 3; });
  }
  while (Date.now() - t0 < 60000) {
    await sleep(1000);
    const s = await st(page);
    samples.push(s);
    if (s.state !== "playing") break;
  }
  const s = await st(page);
  const tst = await page.evaluate(() => ({ plans: window.__COPYCAT_TEST__.plans, noPlan: window.__COPYCAT_TEST__.noPlan || 0 }));
  console.log("  autopilot:", JSON.stringify({ state: s.state, x: s.x.toFixed(1), pairs: s.pairs, score: s.score, combo: s.combo, bestCombo: s.bestCombo, perfects: s.perfects, syncs: s.syncs, prisms: s.prisms, v: s.v.toFixed(2), cause: s.cause, dead: s.dead, plans: tst.plans, noPlan: tst.noPlan, segsLive: s.segs, objs: s.objs }));
  check(s.pairs >= 40, "autopilot cleared many generated pairs (" + s.pairs + ")");
  check(s.state === "playing", "the run is still alive after a long autopiloted session (state " + s.state + (s.cause ? ", " + s.cause + " in world " + s.dead : "") + ")");
  check(tst.noPlan === 0, "the live solver always found a plan for the current segment");
  check(s.segs < 14 && Math.max(...s.objs) < 260, "old segments are discarded (live segments " + s.segs + ", objects " + s.objs + ")");
  check(s.score > 0 && s.bestCombo >= 5, "scoring and combo progressed");
  check(s.syncs > 0, "SYNC awards fired during precise shared jumps (" + s.syncs + ")");
  const paired = await page.evaluate(() => window.__events.length);
  check(paired > 0, "events flowed during the run");
  check(errors.length === 0, "no page errors during the long run (" + errors.slice(0, 3).join(" | ") + ")");
  await ctx.close();
}

// ---- 3. desktop: side-by-side, keyboard + mouse input, resize ----
{
  const { page, ctx, errors } = await open({ width: 1280, height: 720 }, "test=1&seed=55", false);
  await sleep(300);
  let s = await st(page);
  check(s.layout.mode === "side", "wide desktop viewport uses side-by-side worlds");
  await page.keyboard.press("Space");
  await sleep(80);
  s = await st(page);
  check(s.state === "playing" && !s.c[0].gr && !s.c[1].gr, "Space starts and jumps both characters");
  await sleep(700);
  await page.mouse.click(640, 360);
  await sleep(60);
  s = await st(page);
  check(!s.c[0].gr || !s.c[1].gr, "mouse click jumps");
  await page.screenshot({ path: OUT + "/07-desktop.png" });
  await page.setViewportSize({ width: 360, height: 640 });
  await sleep(300);
  s = await st(page);
  check(s.layout.mode === "stack" && s.layout.panels[0].w === 360, "resizing to a narrow phone re-lays out the worlds");
  await page.screenshot({ path: OUT + "/08-resized-narrow.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(300);
  s = await st(page);
  check(s.layout.mode === "side", "landscape phone switches to side-by-side");
  await page.screenshot({ path: OUT + "/09-landscape.png" });
  check(errors.length === 0, "no page errors on desktop/resize (" + errors.slice(0, 3).join(" | ") + ")");
  await ctx.close();
}

// ---- 4. repeated restarts don't stack loops or listeners ----
{
  const { page, ctx, errors } = await open({ width: 390, height: 844 }, "test=1&seed=9", true);
  await page.touchscreen.tap(195, 600);
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => window.__copycat.state === "over", null, { timeout: 15000 });
    await sleep(420);
    await page.touchscreen.tap(195, 700);
    await sleep(100);
  }
  const s = await st(page);
  const starts = s.events.filter((e) => e === "start").length;
  check(s.state === "playing" && starts === 7, "six immediate restarts work; one start event per attempt (" + starts + ")");
  // a single tap = a single jump (no double trigger from touch + mouse emulation)
  await page.waitForFunction(() => window.__copycat.run.sim.c.every((c) => c.gr), null, { timeout: 3000 }).catch(() => {});
  const before = await page.evaluate(() => window.__copycat.run.tapsTotal || 0);
  await page.touchscreen.tap(195, 600);
  await sleep(150);
  const after = await page.evaluate(() => window.__copycat.run.tapsTotal || 0);
  check(after - before === 1, "one touch produces exactly one jump request (" + (after - before) + ")");
  check(errors.length === 0, "no page errors across restarts (" + errors.slice(0, 3).join(" | ") + ")");
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
