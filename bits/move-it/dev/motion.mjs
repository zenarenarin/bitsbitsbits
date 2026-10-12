// Motion-quality check. Builds a short scene through real touch drags
// (relaxed stand → wave → jump → landing → lean towards the other figure,
// looping), then simulates playback at several frame rates and measures:
// continuity, loop seam, frame-rate independence, foot sliding, limb length,
// joint flips, anticipation, landing squash and follow-through.
// Usage: node dev/motion.mjs [outDir]   (writes motion-report.json + export.gif)
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || here;
let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await context.newCDPSession(page);
await page.goto("file://" + path.join(here, "index.html"));
await page.evaluate(() => localStorage.clear());
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.__bitReady);

const J = (ci, n) => page.evaluate(([ci, n]) => window.__testHooks.moveIt.joint(ci, n), [ci, n]);
const state = () => page.evaluate(() => window.__testHooks.moveIt.state());
async function drag(from, dx, dy, hold = 0) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= 14; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (dx * i) / 14, y: from.y + (dy * i) / 14 }] });
    await page.waitForTimeout(12);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}
const addPose = async () => {
  await page.locator('[data-a="add"]').tap();
  await page.waitForTimeout(200);
};

// ── Build the scene with direct manipulation ────────────────────────────
// Pose 1: relaxed standing (the opening pose).
await addPose();
// Pose 2: Blue raises a hand to wave.
await drag(await J(0, "rhand"), 40, -150);
await addPose();
// Pose 3: wave the other way (forearm swings).
await drag(await J(0, "rhand"), -45, 5);
await addPose();
// Pose 4: back to relaxed: pull the arm down by its hand.
await drag(await J(0, "rhand"), 25, 135);
await addPose();
// Pose 5: in the air: carry Blue up, tuck the feet, arms up.
await drag(await J(0, "belly"), 0, -95, 480);
await drag(await J(0, "lfoot"), -10, -40);
await drag(await J(0, "rfoot"), 10, -40);
await drag(await J(0, "lhand"), -20, -110);
await drag(await J(0, "rhand"), 20, -110);
await addPose();
// Pose 6: landed: carry back down, feet down, arms relaxed.
await drag(await J(0, "belly"), 0, 95, 480);
await drag(await J(0, "lfoot"), 10, 40);
await drag(await J(0, "rfoot"), -10, 40);
await drag(await J(0, "lhand"), 15, 110);
await drag(await J(0, "rhand"), -15, 110);
await addPose();
// Pose 7: Pink leans towards Blue, reaching (hand pulled past arm's reach).
await drag(await J(1, "lhand"), -95, -40);
let s = await state();
ok(s.poses.length === 7, "scene built with 7 poses through touch drags");
const poses = s.poses;
const ground = (c) => c.y;
ok(poses[4].a.y < poses[3].a.y - 60, "pose 5 has Blue in the air (" + (poses[3].a.y - poses[4].a.y).toFixed(0) + " units up)");
ok(Math.abs(poses[5].a.y - poses[3].a.y) < 6, "pose 6 lands Blue back at ground height");
ok(Math.abs(poses[6].b.sp - poses[0].b.sp) > 0.15, "pose 7 leans Pink's torso into the reach");
await page.waitForTimeout(400);
fs.writeFileSync(path.join(out, "scene-project.json"), await page.evaluate(() => localStorage.getItem("bit:move-it-project")));
await page.screenshot({ path: path.join(out, "scene-last-pose.png"), clip: { x: 0, y: 140, width: 390, height: 480 } });

// ── Simulate playback ───────────────────────────────────────────────────
const NAMES = ["pelvis", "neck", "head", "lhand", "rhand", "lfoot", "rfoot", "lelbow", "relbow", "lknee", "rknee"];
const trace = (dts) => page.evaluate(([dts, names]) => window.__testHooks.moveIt.trace(dts, names), [dts, NAMES]);
const { total } = await page.evaluate(() => window.__testHooks.moveIt.trace([0.001], ["pelvis"]));
const laps = 3;
const fixed = (fps) => Array(Math.ceil((total * laps) * fps)).fill(1 / fps);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = [];
for (let t = 0; t < total * laps;) { const d = 1 / 144 + rnd() * (1 / 20); jitter.push(d); t += d; }

const t60 = await trace(fixed(60));
const t30 = await trace(fixed(30));
const t144 = await trace(fixed(144));
const tj = await trace(jitter);
console.log("cycle length", total.toFixed(2) + "s");

const all = [t60, t30, t144, tj];
ok(all.every((tr) => tr.frames.every((f) => f.ch.every((c) => NAMES.every((n) => Number.isFinite(c[n].x) && Number.isFinite(c[n].y))))), "no NaN at any frame rate");

// limb lengths stay true; the spine only squashes/stretches a little
const BONES = [50, 46, 50, 46, 58, 54, 58, 54];
let worstBone = 0, spineMin = Infinity, spineMax = 0;
for (const f of t60.frames) for (const c of f.ch) {
  c.bones.forEach((b, i) => (worstBone = Math.max(worstBone, Math.abs(b - BONES[i]))));
  spineMin = Math.min(spineMin, c.spine); spineMax = Math.max(spineMax, c.spine);
}
ok(worstBone < 0.01, "limbs never stretch or shrink (max error " + worstBone.toFixed(4) + ")");
ok(spineMin > 94 * 0.9 && spineMax < 94 * 1.08, "spine squash/stretch stays restrained (" + (spineMin / 94).toFixed(3) + "–" + (spineMax / 94).toFixed(3) + ")");

// continuity: per-frame movement at 60fps never spikes (no snapping),
// including across the loop seam; acceleration stays bounded
const lap2 = t60.frames.filter((f) => f.t > total && f.t <= total * 2 + 1e-9);
let maxStep = 0, maxAccel = 0, seamStep = 0, seamAccel = 0;
const jerks = [];
let contactAccel = 0;
for (let i = 2; i < t60.frames.length; i++) {
  const [f0, f1, f2] = [t60.frames[i - 2], t60.frames[i - 1], t60.frames[i]];
  for (let ci = 0; ci < 2; ci++) for (const n of NAMES) {
    const v1x = f1.ch[ci][n].x - f0.ch[ci][n].x, v1y = f1.ch[ci][n].y - f0.ch[ci][n].y;
    const v2x = f2.ch[ci][n].x - f1.ch[ci][n].x, v2y = f2.ch[ci][n].y - f1.ch[ci][n].y;
    const step = Math.hypot(v2x, v2y), acc = Math.hypot(v2x - v1x, v2y - v1y);
    if (f2.t > 0.3) maxStep = Math.max(maxStep, step);
    // Touch-down is an impact: knees may change speed sharply right at foot
    // contact (pose 6 lands Blue). Everywhere else motion must stay smooth.
    const local = f2.t % total, landing = 5 * (total / 7);
    const contact = ci === 0 && /knee|foot/.test(n) && local > landing - 0.25 && local < landing + 0.1;
    if (contact) { contactAccel = Math.max(contactAccel, acc); continue; }
    if (f2.t > 0.3) maxAccel = Math.max(maxAccel, acc);
    if (f2.t > 0.3 && acc > 3.5) jerks.push([+f2.t.toFixed(3), ci, n, +acc.toFixed(2)]);
    const nearSeam = [1, 2].some((k) => Math.abs(f2.t - k * total) < 0.05);
    if (nearSeam) { seamStep = Math.max(seamStep, step); seamAccel = Math.max(seamAccel, acc); }
  }
}
ok(maxStep < 14, "no snapping: largest per-frame move at 60fps is " + maxStep.toFixed(2) + " units");
if (jerks.length) console.log("  jerks (t, char, point, Δv):", JSON.stringify(jerks.slice(0, 12)));
ok(maxAccel < 3.5, "no jerks: largest per-frame change in velocity is " + maxAccel.toFixed(2) + " units");
ok(contactAccel < 8, "landing impact stays bounded at foot contact (" + contactAccel.toFixed(2) + " units)");
ok(seamAccel <= maxAccel * 0.9 + 0.2, "loop seam is smooth (Δv " + seamAccel.toFixed(2) + " vs worst " + maxAccel.toFixed(2) + ")");

// moving through poses: the hips never come to a dead stop at pass-through
// poses while travelling (only where the creator asked for stillness)
const speeds = lap2.map((f, i) => (i ? Math.hypot(f.ch[0].pelvis.x - lap2[i - 1].ch[0].pelvis.x, f.ch[0].pelvis.y - lap2[i - 1].ch[0].pelvis.y) * 60 : 0));
// (pose 4 → takeoff, pose 6 → landing: both are pass-through poses)
const keyTimes = [3, 5].map((k) => total + k * (total / 7));
const atKey = keyTimes.map((kt) => { const i = lap2.findIndex((f) => f.t >= kt); return speeds[i]; });
ok(atKey.every((v) => v > 20), "no dead stops: Blue's hips still moving through the takeoff and landing poses (" + atKey.map((v) => v.toFixed(0)).join(", ") + " units/s)");

// frame-rate independence: same time → same body, at 30, 144 fps and jittered
const at = (tr, t, ci, n) => {
  const i = tr.frames.findIndex((f) => f.t >= t);
  const a = tr.frames[Math.max(0, i - 1)], b = tr.frames[i];
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.ch[ci][n].x + (b.ch[ci][n].x - a.ch[ci][n].x) * k, y: a.ch[ci][n].y + (b.ch[ci][n].y - a.ch[ci][n].y) * k };
};
let worstFps = 0;
for (let t = total + 0.05; t < total * 2; t += 0.05) for (const tr of [t30, t144, tj]) for (let ci = 0; ci < 2; ci++) for (const n of NAMES) {
  const p = at(t60, t, ci, n), q = at(tr, t, ci, n);
  worstFps = Math.max(worstFps, Math.hypot(p.x - q.x, p.y - q.y));
}
ok(worstFps < 3, "frame-rate independent: 30/60/144fps and jittered frames agree within " + worstFps.toFixed(2) + " units");

// feet stay planted: Pink never moves its feet in this scene, Blue only jumps
let pinkSlide = 0;
const f0 = lap2[0].ch[1];
for (const f of lap2) for (const n of ["lfoot", "rfoot"]) pinkSlide = Math.max(pinkSlide, Math.hypot(f.ch[1][n].x - f0[n].x, f.ch[1][n].y - f0[n].y));
ok(pinkSlide < 1.5, "no foot sliding: Pink's planted feet move at most " + pinkSlide.toFixed(2) + " units");
let blueSlide = 0;
const waveEnd = total + 3 * (total / 7);
const w0 = lap2[0].ch[0];
for (const f of lap2.filter((f) => f.t < waveEnd)) for (const n of ["lfoot", "rfoot"]) blueSlide = Math.max(blueSlide, Math.hypot(f.ch[0][n].x - w0[n].x, f.ch[0][n].y - w0[n].y));
ok(blueSlide < 1.5, "no foot sliding while Blue waves (" + blueSlide.toFixed(2) + " units)");

// no joint flips: an elbow/knee bend only changes side if the poses do
let flips = 0;
for (const k of ["lel", "rel", "lkn", "rkn"]) for (let ci = 0; ci < 2; ci++) {
  // straight-ish keys (< 0.2 rad) carry no meaningful side
  const keySigns = new Set(poses.map((p) => (ci ? p.b : p.a)[k]).filter((v) => Math.abs(v) > 0.2).map(Math.sign));
  if (keySigns.size !== 1) continue;
  for (const f of lap2) if (Math.sign(f.ch[ci].state[k]) !== [...keySigns][0] && Math.abs(f.ch[ci].state[k]) > 0.2) {
    flips++;
    console.log("  flip:", k, "char", ci, "t", (f.t - total).toFixed(3), "value", f.ch[ci].state[k].toFixed(3), "base", f.ch[ci].base[k].toFixed(3), "keys", poses.map((p) => (ci ? p.b : p.a)[k].toFixed(2)).join(" "));
    break;
  }
}
ok(flips === 0, "no visible elbow/knee flips (bending > 0.2 rad the wrong way)");

// anticipation: Blue's hips dip below standing before taking off
const standY = poses[3].a.y;
const takeoff = total + 3 * (total / 7);
const preDip = Math.max(...lap2.filter((f) => f.t > takeoff - 0.2 && f.t < takeoff + 0.2).map((f) => f.ch[0].pelvis.y - standY));
ok(preDip > 2, "anticipation: hips dip " + preDip.toFixed(1) + " units before the jump");
// landing: the knees absorb (hips sink below standing), then it settles
const landT = total + 5 * (total / 7);
const sink = Math.max(...lap2.filter((f) => f.t > landT - 0.15 && f.t < landT + 0.35).map((f) => f.ch[0].pelvis.y - standY));
const settled = lap2.filter((f) => f.t > landT + 0.55 && f.t < landT + 0.6).map((f) => Math.abs(f.ch[0].pelvis.y - f.ch[0].base.y));
ok(sink > 3, "landing absorbs weight: hips sink " + sink.toFixed(1) + " units");
// follow-through: head lags the torso during the lean
let headLag = 0;
for (const f of lap2) headLag = Math.max(headLag, Math.abs(f.ch[0].state.hd - f.ch[0].base.hd), Math.abs(f.ch[1].state.hd - f.ch[1].base.hd));
ok(headLag > 0.03 && headLag < 0.46, "head follows through (max lag " + headLag.toFixed(2) + " rad)");
// overlap: forearm trails the upper arm in the wave
let overlap = 0;
for (const f of lap2) overlap = Math.max(overlap, Math.abs(f.ch[0].state.rel - f.ch[0].base.rel));
ok(overlap > 0.03, "forearm overlaps/whips behind the upper arm (" + overlap.toFixed(2) + " rad)");

// playback never touched the saved poses
ok(JSON.stringify((await state()).poses) === JSON.stringify(poses), "saved poses untouched by simulation");

fs.writeFileSync(path.join(out, "motion-report.json"), JSON.stringify({
  total, pelvisA: lap2.map((f) => [+(f.t - total).toFixed(3), +f.ch[0].pelvis.y.toFixed(2), +f.ch[0].base.y.toFixed(2)]),
}, null, 0));

// Export the scene as a GIF (same pipeline as playback) for visual review.
await page.locator('[data-a="menu"]').tap();
await page.locator('[data-s="export"]').tap();
await page.waitForSelector(".mi-gif", { timeout: 60000 });
await page.evaluate(() => { window.matchMedia = () => ({ matches: false }); });
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-s="save-gif"]').click()]);
await dl.saveAs(path.join(out, "scene.gif"));

ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failures ? failures + " FAILED" : "ALL PASSED");
process.exitCode = failures ? 1 : 0;
