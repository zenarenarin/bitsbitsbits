// End-to-end checks for Move it in a portrait phone viewport (390×844, touch).
// Runs the brief's final acceptance scenario plus integrity/edge-case checks.
// Usage: node dev/test.mjs [screenshotDir]
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(here, "index.html");
const shots = process.argv[2] || null;
let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  acceptDownloads: true
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const cdp = await context.newCDPSession(page);

async function open(query = "") {
  await page.goto(url + query);
  await page.waitForFunction(() => window.__bitReady);
  await page.waitForTimeout(100);
}
const state = () => page.evaluate(() => window.__testHooks.moveIt.state());
const joint = (ci, h) => page.evaluate(([ci, h]) => window.__testHooks.moveIt.joint(ci, h), [ci, h]);
const shot = async (name) => shots && page.screenshot({ path: path.join(shots, name + ".png") });

// Real touch drags through CDP so pointerType is "touch".
async function touchDrag(from, to, steps = 12, hold = 0) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // a finger lifts and pauses; avoids Chrome treating the next tap as a fling-cancel
  await page.waitForTimeout(250);
}
async function dragJoint(ci, h, dx, dy) {
  const p = await joint(ci, h);
  await touchDrag(p, { x: p.x + dx, y: p.y + dy });
}
// press and hold on the body, then drag: moves the whole figure
async function carry(ci, dx, dy) {
  const p = await joint(ci, "belly");
  await touchDrag(p, { x: p.x + dx, y: p.y + dy }, 12, 480);
}
async function tap(sel) {
  await page.locator(sel).first().tap();
  await page.waitForTimeout(40);
}
const thumb = (i) => `.mi-th >> nth=${i}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const charOf = (s, i, who) => s.poses[i][who];

// ───────────────────────── Final acceptance scenario
await open();
await page.evaluate(() => localStorage.clear());
await open();
await shot("01-open");
let s = await state();
ok(s.poses.length === 1, "1. opens with one initial pose");
ok(await page.locator("#hint").isVisible(), "1. first-use hint visible before interacting");

// 2. drag A's hand above its head
const headA = await joint(0, "head");
const handA0 = await joint(0, "rhand");
await touchDrag(handA0, { x: headA.x + 30, y: headA.y - 50 });
s = await state();
const handA1 = await joint(0, "rhand");
ok(handA1.y < headA.y, "2. A's hand is above A's head after the drag");
ok(Math.abs(s.poses[0].a.x - 150) < 1e-6 && Math.abs(s.poses[0].a.y - 356) < 1e-6, "2. dragging the hand did not move A's body");
ok(s.undo === 1, "2. one drag = one undo entry");
ok(await page.locator("#hint").evaluate((e) => e.classList.contains("gone")), "2. hint clears once the user interacts");
// limb lengths preserved
const shA = await joint(0, "rshoulder"), elbA = await joint(0, "relbow");
const scale = await page.evaluate(() => window.__testHooks.moveIt.scale());
ok(Math.abs(Math.hypot(elbA.x - shA.x, elbA.y - shA.y) / scale - 50) < 0.5 &&
   Math.abs(Math.hypot(handA1.x - elbA.x, handA1.y - elbA.y) / scale - 46) < 0.5, "2. arm segment lengths preserved by IK");

// 3. move B closer to A: press and hold on the body, then drag
const bBefore = (await state()).poses[0].b;
await carry(1, -45, 0);
s = await state();
const bAfter = s.poses[0].b;
ok(bAfter.x < bBefore.x - 30, "3. dragging B's torso moves B");
ok(["sp", "s2", "s3", "hd", "lsh", "lel", "rsh", "rel", "lhp", "lkn", "rhp", "rkn"].every((k) => Math.abs(bAfter[k] - bBefore[k]) < 1e-9), "3. B's pose preserved while moving");
ok(same(s.poses[0].a, (await state()).poses[0].a) && Math.abs(s.poses[0].a.x - 150) < 1e-6, "3. A untouched when B moves");

// 4. add pose
await tap('[data-a="add"]');
s = await state();
ok(s.poses.length === 2 && s.sel === 1, "4. add pose creates and selects pose 2");
ok(same(s.poses[0].a, s.poses[1].a) && same(s.poses[0].b, s.poses[1].b), "4. new pose captures both characters");

// 5. raise B's arm; 6. bend A's leg
const handB = await joint(1, "lhand");
await touchDrag(handB, { x: handB.x - 10, y: handB.y - 150 });
const footA = await joint(0, "lfoot");
await touchDrag(footA, { x: footA.x - 40, y: footA.y - 55 });
s = await state();
ok(s.poses[1].b.lsh !== s.poses[0].b.lsh, "5. B's arm changed in pose 2");
ok(Math.abs(s.poses[1].a.lkn) > 0.4, "6. A's knee bent in pose 2");
ok(same(s.poses[0].b, bAfter), "5/6. pose 1 unchanged while editing pose 2");
await shot("02-pose2");

// 7. add pose
await tap('[data-a="add"]');
// 8. dramatically different arrangement: A leaps left/up, B crouches right
await carry(0, -60, -120);
const pelB = await joint(1, "pelvis");
await touchDrag(pelB, { x: pelB.x + 50, y: pelB.y + 70 });
const headB = await joint(1, "head");
await touchDrag(headB, { x: headB.x + 60, y: headB.y + 30 });
const neckB = await joint(1, "neck");
await touchDrag(neckB, { x: neckB.x + 40, y: neckB.y + 25 });
// 9. add a third (saved) pose
await tap('[data-a="add"]');
s = await state();
ok(s.poses.length === 4 && s.sel === 3, "9. poses: 1, 2, 3 and the newly added copy");
ok(!same(s.poses[2], s.poses[1]), "8. third pose differs from the second");
const footsB = { l: s.poses[2].b.lhp, r: s.poses[2].b.rhp };
ok(Math.abs(s.poses[2].b.lkn) > 0.3, "8. dragging B's hips down crouched the legs (feet planted)");
await shot("03-pose3");
const saved = await state();

// 10–11. play
await tap('[data-a="play"]');
await page.waitForTimeout(400);
s = await state();
ok(s.playing, "10. playback running");
const pos1 = await page.evaluate(() => window.__testHooks.moveIt.playPos());
await page.waitForTimeout(500);
const pos2 = await page.evaluate(() => window.__testHooks.moveIt.playPos());
ok(pos2 !== pos1, "11. playhead advances through the poses");
await shot("04-playing");
ok(await page.locator('[data-a="play"]').getAttribute("aria-label") === "Pause", "10. play button became pause");
ok(same((await state()).poses, saved.poses), "11. playback did not modify saved poses");

// edits are blocked during playback (tap pauses instead)
// 12. pause
await tap('[data-a="play"]');
s = await state();
const pausedAt = s.playTime;
ok(!s.playing && pausedAt > 0, "12. paused, position kept (" + pausedAt.toFixed(2) + "s)");
ok(same(s.edit, s.poses[s.sel]), "12. canvas shows the selected editable pose again");
await page.waitForTimeout(300);
ok((await state()).playTime === pausedAt, "12. paused position stays put");

// 13. back to pose 2, adjust B's arm
await tap(thumb(1));
s = await state();
ok(s.sel === 1 && same(s.edit, s.poses[1]), "13. selecting pose 2 restores its exact state");
const before13 = await state();
const hB2 = await joint(1, "lhand");
await touchDrag(hB2, { x: hB2.x + 70, y: hB2.y + 40 });
const after13 = await state();
ok(!same(after13.poses[1].b, before13.poses[1].b), "13. pose 2 adjusted");
// 14. others unchanged
ok(same(after13.poses[0], before13.poses[0]) && same(after13.poses[2], before13.poses[2]) && same(after13.poses[3], before13.poses[3]), "14. poses 1, 3, 4 unchanged");
// 15. undo / redo
await tap('[data-a="undo"]');
s = await state();
ok(same(s.poses, before13.poses), "15. undo restores pose 2 exactly");
await tap('[data-a="redo"]');
s = await state();
ok(same(s.poses, after13.poses), "15. redo restores the adjustment exactly");

// resume from paused position, then restart
await tap('[data-a="play"]');
s = await state();
ok(Math.abs(s.playTime - pausedAt) < 0.1, "6.3 play resumes from the paused position");
await tap('[data-a="restart"]');
s = await state();
ok(s.playing && s.playTime < 0.15, "16. restart begins from the first pose");
// loop: 3 transitions + closing transition back to pose 1 (pose 4 != pose 1)
const cycle = s.total;
await page.waitForTimeout((cycle + 0.3) * 1000);
s = await state();
ok(s.playing && s.playTime < 0.9, "16. animation looped back to the start (t=" + s.playTime.toFixed(2) + " of " + cycle.toFixed(2) + ")");
await tap('[data-a="play"]');

// 17–18. save + reload
await page.waitForTimeout(400);
const stored = await page.evaluate(() => localStorage.getItem("bit:move-it-project"));
ok(!!stored, "17. project saved locally");
const beforeReload = await state();
await open();
s = await state();
const close = (a, b) => Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 0.002);
ok(s.poses.length === 4 && s.poses.every((p, i) => close(p.a, beforeReload.poses[i].a) && close(p.b, beforeReload.poses[i].b)), "18. reload restores all poses");
ok(s.sel === beforeReload.sel, "18. reload restores the selected pose");
await shot("05-reloaded");

// 19. export GIF
await tap('[data-a="menu"]');
await shot("06-menu");
await tap('[data-s="export"]');
await page.waitForSelector(".mi-gif", { timeout: 20000 });
await page.waitForFunction(() => document.querySelector(".mi-gif").complete);
const dims = await page.locator(".mi-gif").evaluate((img) => [img.naturalWidth, img.naturalHeight]);
ok(dims[0] === 360 && dims[1] === 490, "19. GIF decodes in the browser at " + dims.join("×"));
await shot("07-export");
// desktop-style save path (download)
await page.evaluate(() => { window.matchMedia = () => ({ matches: false }); });
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-s="save-gif"]').click()]);
const gifPath = path.join(shots || here, "export.gif");
await dl.saveAs(gifPath);
const head = fs.readFileSync(gifPath).subarray(0, 6).toString();
ok(head === "GIF89a", "19. downloaded file is a GIF (" + fs.statSync(gifPath).size + " bytes)");
await tap('[data-s="close"]');

// ───────────────────────── Integrity + edge cases
await page.evaluate(() => localStorage.clear());
await open();
// duplicate independence
await tap(thumb(0)); // opens popover on the selected pose
ok(await page.locator(".mi-pop.on").isVisible(), "popover opens on the selected pose");
await shot("08-popover");
await tap('[data-p="dup"]');
s = await state();
ok(s.poses.length === 2 && s.sel === 1, "duplicate creates and selects a copy");
await dragJoint(1, "rhand", -40, -90);
s = await state();
ok(!same(s.poses[0].b, s.poses[1].b), "editing the duplicate leaves the source unchanged");
// hold
await tap(thumb(1));
await tap('[data-p="hold"]');
s = await state();
ok(s.poses[1].h === 1, "hold cycles on a pose");
await page.mouse.click(200, 300);
// move earlier via popover
const p1 = (await state()).poses[1];
await tap(thumb(1));
await tap('[data-p="left"]');
s = await state();
ok(same(s.poses[0], p1) && s.sel === 0, "move earlier reorders without altering pose data");
await tap('[data-a="undo"]');
s = await state();
ok(same(s.poses[1], p1), "reorder is undoable");
// long-press drag reorder with real touch
const t0 = await page.locator(thumb(0)).boundingBox();
const before = await state();
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: t0.x + 20, y: t0.y + 30 }] });
await page.waitForTimeout(520);
for (let i = 1; i <= 10; i++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: t0.x + 20 + 6 * i, y: t0.y + 30 }] });
  await page.waitForTimeout(16);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(400);
s = await state();
ok(same(s.poses[0], before.poses[1]) && same(s.poses[1], before.poses[0]), "long-press drag reorders thumbnails");
// delete
const n0 = s.poses.length;
await tap(thumb(s.sel));
await tap('[data-p="del"]');
s = await state();
ok(s.poses.length === n0 - 1 && s.sel >= 0 && s.sel < s.poses.length && same(s.edit, s.poses[s.sel]), "delete selects a valid neighbouring pose");
await tap(thumb(0));
ok(await page.locator('[data-p="del"]').getAttribute("aria-disabled") === "true", "cannot delete the last remaining pose");
await page.mouse.click(200, 300);
// play with one pose → hint, no playback
await tap('[data-a="play"]');
s = await state();
ok(!s.playing, "single pose: play explains instead of playing");
// ghost renders previous pose only (pixel probe)
await tap('[data-a="add"]');
await carry(0, 0, -250);
const ghostPixel = await page.evaluate(() => {
  const h = window.__testHooks.moveIt;
  const st = h.state();
  // where A's chest was in the previous pose = current chest + 250 world units down
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  const now = h.joint(0, "chest");
  const s = h.scale();
  const k = c.width / r.width;
  const d = c.getContext("2d").getImageData((now.x - r.left) * k, (now.y - r.top + 250 * s) * k, 1, 1).data;
  return [d[0], d[1], d[2]];
});
ok(ghostPixel[2] > 40 && ghostPixel[2] < 110, "ghost of previous pose drawn faintly (" + ghostPixel + ")");
await shot("09-ghost");
await tap('[data-a="ghost"]');
await page.waitForTimeout(50);
const noGhost = await page.evaluate(() => {
  const h = window.__testHooks.moveIt;
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  const now = h.joint(0, "chest");
  const s = h.scale();
  const k = c.width / r.width;
  const d = c.getContext("2d").getImageData((now.x - r.left) * k, (now.y - r.top + 250 * s) * k, 1, 1).data;
  return [d[0], d[1], d[2]];
});
ok(noGhost[2] < 20, "ghost toggle hides the previous pose (" + noGhost + ")");
// ghost is not selectable: dragging where ghost is should not move A
const ghostSpot = await page.evaluate(() => { const h = window.__testHooks.moveIt; const p = h.joint(0, "chest"); return p; });
await tap('[data-a="ghost"]');
const aBefore = (await state()).poses[1].a;
await touchDrag({ x: ghostSpot.x, y: ghostSpot.y + 250 * scale }, { x: ghostSpot.x + 40, y: ghostSpot.y + 250 * scale });
ok(same((await state()).poses[1].a, aBefore), "ghost is not draggable");

// new animation (with confirm) + undo brings it back
const beforeNew = await state();
await tap('[data-a="menu"]');
await tap('[data-s="new"]');
ok(await page.locator('[data-s="confirm-new"]').isVisible(), "new animation asks before discarding work");
await tap('[data-s="confirm-new"]');
s = await state();
ok(s.poses.length === 1, "new animation resets to a single pose");
await tap('[data-a="undo"]');
s = await state();
ok(same(s.poses, beforeNew.poses), "undo recovers the previous animation");

// loop off: plays once, stops on the last pose, Play starts over
await open();
await page.evaluate(() => localStorage.clear());
await open();
await dragJoint(0, "rhand", 30, -80);
await tap('[data-a="add"]');
await carry(1, -60, 0);
await tap('[data-a="loop"]');
ok((await state()).loop === false, "loop toggles off");
await tap('[data-a="play"]');
await page.waitForTimeout(((await state()).total + 0.35) * 1000);
s = await state();
ok(!s.playing && Math.abs(s.playTime - s.total) < 0.01, "loop off: stops at the end (t=" + s.playTime.toFixed(2) + ")");
ok(same(s.edit, s.poses[s.sel]), "loop off: editing state restored after it ends");
await tap('[data-a="play"]');
s = await state();
ok(s.playing && s.playTime < 0.1, "loop off: Play again starts from the beginning");
await tap('[data-a="play"]');
await tap('[data-a="loop"]');
// seamless loop: when last pose == first pose, no extra closing transition
await tap(thumb(0)); // select
await tap(thumb(0)); // open options
await tap('[data-p="dup"]');
await tap(thumb(1));
await tap('[data-p="right"]');
s = await state();
ok(same(s.poses[0].a, s.poses[2].a) && same(s.poses[0].b, s.poses[2].b), "set up: last pose matches first");
const seam = await page.evaluate(() => {
  document.querySelector('[data-a="restart"]').click();
  return new Promise((r) => setTimeout(() => r(window.__testHooks.moveIt.state()), 300));
});
ok(seam.playing && Math.abs(seam.total - 2 * 0.6) < 1e-6, "seamless loop: 2 transitions per cycle, no extra return (cycle " + seam.total.toFixed(2) + "s)");
await tap('[data-a="play"]');

// page must not scroll while dragging on the canvas
const scrollY = await page.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
ok(scrollY[0] === 0 && scrollY[1] === 0, "no page scroll from touch drags");

// resize keeps poses intact
const beforeResize = await state();
await page.setViewportSize({ width: 360, height: 640 });
await page.waitForTimeout(150);
await shot("10-small-phone");
await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(150);
ok(same((await state()).poses, beforeResize.poses), "resizing never rewrites saved poses");
await page.setViewportSize({ width: 390, height: 844 });

// storage failure keeps the tool usable
await open("?brokenstorage");
await dragJoint(0, "rhand", 20, -60);
await tap('[data-a="add"]');
s = await state();
ok(s.poses.length === 2, "broken storage: editing still works");
await page.waitForTimeout(400);
ok(await page.locator(".mi-status").textContent() === "Not saved", "broken storage: says it isn't saved");

// long session: undo history stays bounded
await open();
for (let i = 0; i < 90; i++) {
  await page.evaluate(() => {
    document.querySelector('[data-a="add"]').click();
  });
}
s = await state();
ok(s.undo <= 80, "undo history is bounded (" + s.undo + ")");

ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failures ? failures + " FAILED" : "ALL PASSED");
process.exitCode = failures ? 1 : 0;
