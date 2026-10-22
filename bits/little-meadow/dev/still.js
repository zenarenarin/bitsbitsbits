// The settled result screen must be pixel-stable (Plethora's publish poster is re-captured on every
// publish attempt, and its review is keyed to the image), yet still respond to touches.
// usage: node dev/still.js
const path = require("path"), crypto = require("crypto"), { chromium } = require(process.env.PW || "playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 360, height: 783 }, deviceScaleFactor: 2 });
  await p.goto("file://" + path.join(__dirname, "harness.html") + "?manual=1&top=0&bottom=0");
  await p.waitForFunction(() => window.__step && window.__LM_GAME__);
  await p.waitForTimeout(400);
  const step = (n) => p.evaluate((n) => { for (let i = 0; i < n; i++) __step(1000 / 60); }, n);
  const hash = () => p.evaluate(() => document.querySelector("canvas").toDataURL("image/png")).then((d) => crypto.createHash("sha256").update(d).digest("hex").slice(0, 16));
  // start screen
  await step(120); const r1 = await hash(); await step(240); const r2 = await hash();
  // pause screen
  await p.evaluate(() => __LM_GAME__.beginPlay()); await step(120);
  await p.evaluate(() => __LM_GAME__.togglePause()); await step(30); const q1 = await hash(); await step(240); const q2 = await hash();
  await p.evaluate(() => __LM_GAME__.togglePause()); await step(10);
  const p1 = await hash(); await step(10); const p2 = await hash(); // play keeps moving
  console.log({ ready: [r1, r2], paused: [q1, q2], play: [p1, p2] });
  if (r1 !== r2 || q1 !== q2 || p1 === p2) { console.log("FAIL"); process.exit(1); }
  await p.evaluate(() => { __LM_GAME__.sim.s.lives = 1; });
  for (let i = 0; i < 80 && (await p.evaluate(() => __LM_GAME__.phase)) !== "over"; i++) await step(30);
  for (let i = 0; i < 40 && (await p.evaluate(() => __LM_GAME__.overT)) < 3.5; i++) await step(15);
  await p.waitForTimeout(800); await step(5); // leaderboard settles
  const a = await hash(); await step(120); const b2 = await hash(); await step(300); const c = await hash();
  const btn = await p.evaluate(() => __LM_GAME__.buttons.again);
  await p.mouse.move(btn.x + btn.w / 2, btn.y + btn.h / 2); await p.mouse.down(); await step(2);
  const d = await hash();
  await p.mouse.move(btn.x + btn.w / 2, btn.y - 200); await p.mouse.up(); await step(2);
  const e = await hash(); await step(200); const f = await hash();
  const ok = a === b2 && b2 === c && d !== c && e === f;
  console.log({ settled: [a, b2, c], pressed: d, released: [e, f] }, ok ? "still frame OK" : "FAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
