// Freeform manipulation acceptance test: grab real body surfaces (not joint
// handles) and check each gesture does what it should, keeps the feet
// planted, and plays back as a full-body transition.
// Usage: node dev/freeform.mjs [screenshotDir]
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || null;
let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("file://" + path.join(here, "index.html"));
await page.evaluate(() => localStorage.clear());
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.__bitReady);
const cdp = await context.newCDPSession(page);
const J = (ci, n) => page.evaluate(([ci, n]) => window.__testHooks.moveIt.joint(ci, n), [ci, n]);
const st = () => page.evaluate(() => window.__testHooks.moveIt.state());
const feet = async (ci) => [await J(ci, "lfoot"), await J(ci, "rfoot")];
const feetStill = (a, b) => a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 1);
async function drag(from, dx, dy, hold = 0) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= 14; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (dx * i) / 14, y: from.y + (dy * i) / 14 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}
const shot = (name) => out && page.screenshot({ path: path.join(out, name + ".png"), clip: { x: 0, y: 140, width: 390, height: 480 } });
const changed = (a, b) => Object.keys(a).filter((k) => Math.abs(a[k] - b[k]) > 0.01);
async function step(name, fn, check) {
  const before = (await st()).edit, f0 = [await feet(0), await feet(1)];
  const start = Date.now();
  await fn();
  const after = (await st()).edit, f1 = [await feet(0), await feet(1)];
  await shot(name);
  const res = { a: changed(before.a, after.a), b: changed(before.b, after.b), before, after, feetA: feetStill(f0[0], f1[0]), feetB: feetStill(f0[1], f1[1]), feetLB: feetStill([f0[1][0]], [f1[1][0]]) };
  if (process.env.DEBUG) console.log("   ", name, "A:", res.a.join(","), "B:", res.b.join(","), "feet moved A:", f0[0].map((p, i) => Math.hypot(p.x - f1[0][i].x, p.y - f1[0][i].y).toFixed(2)).join("/"));
  check(res);
}
const addPose = async () => { await page.locator('[data-a="add"]').tap(); await page.waitForTimeout(300); };

await addPose();
await step("1-torso-sideways", async () => drag(await J(0, "belly"), 45, 10), (r) => {
  ok(r.a.includes("sp") && !r.a.includes("x"), "grab the torso, push sideways: the body leans (not translated)");
  ok(r.feetA, "  feet stay planted");
  ok(r.b.length === 0, "  other figure untouched");
});
await step("2-chest-curve", async () => drag(await J(0, "chest"), -35, 10), (r) => {
  ok(r.a.includes("s2") && r.a.includes("s3"), "grab the chest: the spine curves through several segments");
  ok(r.feetA, "  feet stay planted");
});
await addPose();
await step("3-upper-arm", async () => drag(await J(0, "ruarm"), 30, -45), (r) => {
  ok(r.a.includes("rsh") && r.a.every((k) => k === "rsh"), "grab the upper arm: it swings from the shoulder, elbow angle kept");
});
await step("4-forearm", async () => drag(await J(0, "rfarm"), 10, -50), (r) => {
  ok(r.a.includes("rel") && !r.a.includes("x"), "grab the forearm: the whole arm reshapes around it (IK)");
  ok(r.feetA, "  feet stay planted");
});
await step("5-head", async () => drag(await J(0, "head"), -30, 20), (r) => {
  ok(r.a.includes("hd"), "pull the head: it tilts" + (r.a.some((k) => k === "s2" || k === "s3") ? " and the neck/upper spine follow" : ""));
  ok(r.feetA, "  feet stay planted");
});
await addPose();
await step("6-carry", async () => drag(await J(0, "belly"), 70, -10, 480), (r) => {
  ok(r.a.length === 2 && r.a.includes("x") && r.a.includes("y"), "press, hold and drag: the whole figure moves, pose untouched");
});
await step("7-hips", async () => drag(await J(1, "pelvis"), 0, 40), (r) => {
  ok(r.b.includes("y") && r.b.includes("lkn") && r.b.includes("rkn") && r.feetB, "drag the hips down: a crouch with planted feet");
});
await step("8-reach", async () => drag(await J(1, "lhand"), -110, -10), (r) => {
  ok(r.b.includes("sp") && r.feetB, "pull a hand out of reach: the body leans into the reach, feet planted");
});
await step("9-thigh", async () => drag(await J(1, "rthigh"), 35, -25), (r) => {
  ok(r.b.includes("rhp"), "grab a thigh: the leg lifts from the hip");
  ok(r.feetLB, "  the standing foot stays planted");
});
await step("10-shin", async () => drag(await J(1, "rshin"), 20, 20), (r) => {
  ok(r.b.includes("rkn") || r.b.includes("rhp"), "grab a shin: the leg reshapes around it (IK)");
});
await addPose();

const s = await st();
ok(s.poses.length === 5, "saved 5 poses from freeform manipulation");
// Play back and check the whole body moves between them, smoothly.
const tr = await page.evaluate(() => window.__testHooks.moveIt.trace(Array(240).fill(1 / 60), ["head", "chest", "rhand", "lfoot", "pelvis"]));
let moved = 0, worst = 0;
for (let i = 2; i < tr.frames.length; i++) {
  const [a, b, c] = [tr.frames[i - 2], tr.frames[i - 1], tr.frames[i]];
  for (const n of ["head", "chest", "rhand"]) {
    moved = Math.max(moved, Math.hypot(c.ch[0][n].x - tr.frames[0].ch[0][n].x, c.ch[0][n].y - tr.frames[0].ch[0][n].y));
    const acc = Math.hypot(c.ch[0][n].x - 2 * b.ch[0][n].x + a.ch[0][n].x, c.ch[0][n].y - 2 * b.ch[0][n].y + a.ch[0][n].y);
    worst = Math.max(worst, acc);
  }
}
ok(moved > 40, "playback moves the full body between the freeform poses (" + moved.toFixed(0) + " units)");
ok(worst < 3.5, "playback is smooth (max per-frame Δv " + worst.toFixed(2) + ")");
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failures ? failures + " FAILED" : "ALL PASSED");
process.exitCode = failures ? 1 : 0;
