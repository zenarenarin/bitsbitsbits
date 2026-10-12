// Browser acceptance run for SPINDLE. Run: node bits/spindle/dev/play.mjs [outDir]
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import url from "url";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const here = path.dirname(url.fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, "shots");
fs.mkdirSync(out, { recursive: true });
const harness = "file://" + path.join(here, "harness.html");

let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? "ok   " : "FAIL ") + name + (info !== undefined ? " " + JSON.stringify(info) : "")); if (!cond) fails++; };

// In-page helpers --------------------------------------------------------
const helpers = () => {
  const TAU = Math.PI * 2, HALF = Math.PI / 2;
  const core = window.plethoraBit.core;
  window.__wrap = a => ((a % TAU) + TAU) % TAU;
  // Time (s) until a launch would attach at the centre of the widest window.
  window.__timeToBest = () => {
    const g = window.__game, st = g.st, f = g.tune.flightMs / 1000;
    const gi = core.goodIntervals(st.angles, st.count, st.omega, f);
    let best = gi[0];
    for (const x of gi) if (x.len > best.len) best = x;
    const target = best.start + best.len / 2;
    const beta = __wrap(HALF - g.theta(st.simT));
    const d = __wrap(st.omega > 0 ? beta - target : target - beta);
    return { wait: d / Math.abs(st.omega), windowMs: best.len / Math.abs(st.omega) * 1000 };
  };
  window.__timeToHit = () => {
    const g = window.__game, st = g.st, f = g.tune.flightMs / 1000;
    const beta = __wrap(HALF - g.theta(st.simT));
    const target = st.angles[0] + st.omega * f; // arrive dead-on
    const d = __wrap(st.omega > 0 ? beta - target : target - beta);
    return d / Math.abs(st.omega);
  };
  window.__tap = () => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.8 }));
  };
  // Bot: plays perfectly until `goal` score, using real pointer events.
  window.__bot = goal => new Promise(resolve => {
    function step() {
      const st = window.__game.st;
      if (st.score >= goal || st.phase === "over") return resolve(st.score);
      if (st.phase === "ready") {
        const { wait } = window.__timeToBest();
        if (wait < 0.02) window.__tap();
      }
      requestAnimationFrame(step);
    }
    step();
  });
  window.__crash = () => new Promise(resolve => {
    function step() {
      const st = window.__game.st;
      if (st.phase === "over") return resolve(true);
      if (st.phase === "ready" && window.__timeToHit() < 0.02) window.__tap();
      requestAnimationFrame(step);
    }
    step();
  });
};


async function noGreen(page, name) {
  // Sample canvas + DOM pixels via a screenshot decoded in-page.
  const png = await page.screenshot();
  const res = await page.evaluate(async b64 => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let green = 0, bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (gg > r + 18 && gg > b + 18 && gg > 40) green++;
      if (r + gg + b > 60) bright++;
    }
    return { green, bright, total: d.length / 4 };
  }, png.toString("base64"));
  ok(name + ": no green/lime pixels", res.green === 0, res);
  return res;
}

const browser = await chromium.launch();

// ---------------- Phone portrait ----------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(harness + "?st=47&sb=34");
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(helpers);
  await page.evaluate(() => localStorage.clear());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "phone-start.png") });
  await noGreen(page, "phone start");

  // Backing store is DPR-sized (crisp on high-density screens).
  const dims = await page.evaluate(() => { const c = document.querySelector("canvas"); return [c.width, c.height, c.clientWidth, c.clientHeight]; });
  ok("canvas backing store at 3x DPR", dims[0] === 390 * 3 && dims[1] === 844 * 3, dims);

  // Rotation is smooth/continuous (angle changes over time).
  const th = await page.evaluate(async () => { const g = window.__game; const a = g.theta(g.st.simT); await new Promise(r => setTimeout(r, 300)); return [a, g.theta(g.st.simT)]; });
  ok("structure rotates", Math.abs(th[1] - th[0]) > 0.2, th);

  // Rapid double tap launches exactly one pin.
  const dbl = await page.evaluate(async () => {
    const st = window.__game.st;
    const before = st.launches;
    while (window.__timeToBest().wait > 0.05) await new Promise(r => requestAnimationFrame(r));
    window.__tap(); window.__tap(); window.__tap();
    const after = st.launches;
    await new Promise(r => setTimeout(r, 400));
    return { launched: after - before, score: st.score, phase: st.phase };
  });
  ok("triple tap launches one pin", dbl.launched === 1, dbl);
  ok("well-timed pin scores", dbl.score === 1, dbl);

  // Mid-flight capture.
  await page.evaluate(async () => {
    while (window.__timeToBest().wait > 0.02) await new Promise(r => requestAnimationFrame(r));
    window.__tap();
    await new Promise(r => setTimeout(r, 70));
  });
  await page.screenshot({ path: path.join(out, "phone-flight.png") });

  // Bot plays through a few spindles with real pointer events.
  const reached = await page.evaluate(() => window.__bot(20));
  ok("bot reached 20 with real taps", reached >= 20, reached);
  const st1 = await page.evaluate(() => ({ score: window.__game.st.score, spindle: window.__game.st.spec.index, ev: window.__events.filter(e => e[0] === "milestone").length }));
  ok("spindle milestones fired", st1.ev >= 2, st1);

  // Dense structure screenshot: play to near the end of a spindle.
  await page.evaluate(async () => {
    const st = window.__game.st;
    while (!(st.phase === "ready" && st.placed >= st.spec.quota - 2 && st.spec.index >= 3)) {
      if (st.phase === "ready" && window.__timeToBest().wait < 0.02) window.__tap();
      await new Promise(r => requestAnimationFrame(r));
    }
    await new Promise(r => setTimeout(r, 250));
  });
  await page.screenshot({ path: path.join(out, "phone-dense.png") });
  await noGreen(page, "phone dense");

  // Worst-case density: pins clustered at the minimum legal spacing.
  await page.evaluate(() => {
    const core = window.plethoraBit.core, st = window.__game.st;
    let lo = 0, hi = 0.5;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (core.pinGap(m, 0, core.G.CLEARANCE) < core.G.CLEARANCE) lo = m; else hi = m; }
    window.__saved = { a: Array.from(st.angles.slice(0, st.count)), c: st.count };
    let n = 0, a = 0.3;
    for (let cl = 0; cl < 5; cl++) { for (let k = 0; k < 7; k++) { st.angles[n++] = a; a += hi * 1.01; } a += 0.32; }
    st.count = n;
    window.__packedOk = core.staticOk(st.angles, st.count, 0);
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(out, "phone-packed.png") });
  ok("packed stress structure is legal", await page.evaluate(() => window.__packedOk));
  await page.evaluate(() => { const st = window.__game.st; st.angles.set(window.__saved.a); st.count = window.__saved.c; });

  // Transition frame.
  await page.evaluate(async () => {
    const st = window.__game.st;
    while (st.phase !== "transition") {
      if (st.phase === "ready" && window.__timeToBest().wait < 0.02) window.__tap();
      await new Promise(r => requestAnimationFrame(r));
    }
    await new Promise(r => setTimeout(r, 160));
  });
  await page.screenshot({ path: path.join(out, "phone-transition.png") });

  // Crash on purpose: collision ends the run and shows the panel.
  const pre = await page.evaluate(() => window.__game.st.score);
  await page.evaluate(() => new Promise(r => { const w = () => window.__game.st.phase === "ready" ? r() : requestAnimationFrame(w); w(); }));
  await page.evaluate(() => window.__crash());
  // Frantic taps right after the collision are ignored: no launch, no instant retry.
  const blocked = await page.evaluate(() => { const l = window.__game.st.launches; window.__tap(); window.__tap(); return [window.__game.st.phase, window.__game.st.launches - l]; });
  ok("taps during the post-collision lockout do nothing", blocked[0] === "over" && blocked[1] === 0, blocked);
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(out, "phone-impact.png") });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, "phone-over.png") });
  await noGreen(page, "phone over");
  const over = await page.evaluate(() => ({
    phase: window.__game.st.phase, score: window.__game.st.score,
    panel: getComputedStyle(document.querySelector(".sp-panel")).opacity,
    best: localStorage.getItem("bit:best"),
    failEv: window.__events.filter(e => e[0] === "fail").length,
    submit: window.__events.filter(e => e[0] === "submit")
  }));
  ok("collision ends run", over.phase === "over", over);
  ok("no points for the collision", over.score === pre, { pre, over: over.score });
  ok("game-over panel visible", Number(over.panel) > 0.95, over.panel);
  ok("personal best stored", Number(over.best) === over.score, over);
  ok("fail + submit reported once", over.failEv === 1 && over.submit.length === 1, over);

  // Retry via the button resets the run.
  await page.click(".sp-retry");
  await page.waitForTimeout(150);
  const reset = await page.evaluate(() => { const st = window.__game.st; return { phase: st.phase, score: st.score, spindle: st.spec.index, count: st.count, placed: st.placed }; });
  ok("retry resets to a fresh gentle run", reset.phase === "ready" && reset.score === 0 && reset.spindle === 0 && reset.count === 3 && reset.placed === 0, reset);

  // Best persists across reloads.
  const bestBefore = over.best;
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "phone-reload.png") });
  const bestAfter = await page.evaluate(() => localStorage.getItem("bit:best"));
  ok("best persists across reload", bestAfter === bestBefore, { bestBefore, bestAfter });

  // Resize mid-run keeps the state intact.
  await page.evaluate(helpers);
  await page.evaluate(() => window.__bot(3));
  const sBefore = await page.evaluate(() => ({ s: window.__game.st.score, c: window.__game.st.count, a: Array.from(window.__game.st.angles.slice(0, window.__game.st.count)) }));
  await page.setViewportSize({ width: 360, height: 700 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const sAfter = await page.evaluate(() => ({ s: window.__game.st.score, c: window.__game.st.count, a: Array.from(window.__game.st.angles.slice(0, window.__game.st.count)) }));
  ok("resize keeps game state", JSON.stringify(sBefore) === JSON.stringify(sAfter));

  ok("no page errors (phone)", errors.length === 0, errors);
  const jsErr = await page.evaluate(() => window.__events.filter(e => e[0] === "jsError" || e[0] === "initError"));
  ok("no runtime errors", jsErr.length === 0, jsErr);
  await ctx.close();
}

// ---------------- Desktop: Space launches, composition stays narrow --------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(harness);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(helpers);
  const r = await page.evaluate(async () => {
    const st = window.__game.st;
    while (window.__timeToBest().wait > 0.03) await new Promise(r => requestAnimationFrame(r));
    return st.launches;
  });
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await page.keyboard.down("Space"); // held / repeated space must not double launch
  await page.waitForTimeout(30);
  await page.keyboard.up("Space");
  const after = await page.evaluate(() => window.__game.st.launches);
  ok("Space launches exactly one pin", after - r === 1, { before: r, after });
  await page.waitForTimeout(300);
  // Click launches too.
  await page.evaluate(async () => { while (window.__timeToBest().wait > 0.03) await new Promise(r => requestAnimationFrame(r)); });
  const l0 = await page.evaluate(() => window.__game.st.launches);
  await page.mouse.click(720, 700);
  const l1 = await page.evaluate(() => window.__game.st.launches);
  ok("mouse click launches", l1 - l0 === 1, { l0, l1 });
  await page.evaluate(() => window.__bot(9));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "desktop-play.png") });
  await noGreen(page, "desktop");
  await page.evaluate(() => window.__crash());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, "desktop-over.png") });
  // Enter retries on desktop.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const ph = await page.evaluate(() => window.__game.st.phase);
  ok("Enter retries after game over", ph === "ready", ph);
  ok("no page errors (desktop)", errors.length === 0, errors);
  await ctx.close();
}

// ---------------- Small landscape + tiny phone: everything fits -------------------
for (const vp of [{ width: 844, height: 390, name: "landscape" }, { width: 320, height: 568, name: "small-phone" }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(harness);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(helpers);
  await page.evaluate(() => window.__bot(4));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, vp.name + ".png") });
  await page.evaluate(() => window.__crash());
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, vp.name + "-over.png") });
  const fits = await page.evaluate(() => {
    const r = document.querySelector(".sp-retry").getBoundingClientRect();
    return r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0 && r.top >= 0;
  });
  ok(vp.name + ": retry button fully on screen", fits);
  await ctx.close();
}

// ---------------- Frame-rate independence in the real page ------------------------
{
  const results = [];
  for (const hz of [30, 60, 144]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(harness + "?manual=1");
    await page.waitForFunction(() => window.__ready === true);
    const res = await page.evaluate(async hz => {
      const g = window.__game;
      g.reset(window.plethoraBit.core.mulberry32(42));
      const st = g.st;
      const dt = 1000 / hz;
      const step = () => new Promise(r => { window.__clock.step = dt; requestAnimationFrame(() => requestAnimationFrame(r)); });
      const taps = [0.8, 1.31, 1.97, 2.4, 3.05, 3.5, 4.2, 4.71, 5.3, 6.02, 6.6, 7.1];
      let i = 0;
      while (st.simT < 8.5 && st.phase !== "over") {
        if (i < taps.length && st.simT + dt / 1000 >= taps[i]) {
          // tap lands between frames at the exact scheduled time
          g.advance(taps[i] - st.simT);
          g.launch(0);
          i++;
        }
        await step();
      }
      return { score: st.score, phase: st.phase, angles: Array.from(st.angles.slice(0, st.count)).map(a => a.toFixed(8)).join(",") };
    }, hz);
    results.push(res);
    await ctx.close();
  }
  ok("same taps, same outcome at 30/60/144 Hz", results.every(r => r.angles === results[0].angles && r.score === results[0].score && r.phase === results[0].phase), results.map(r => [r.score, r.phase]));
}

await browser.close();
console.log(fails ? `\n${fails} browser checks failed` : "\nall browser checks passed");
process.exit(fails ? 1 : 0);
