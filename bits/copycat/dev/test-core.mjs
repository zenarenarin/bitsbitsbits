// Headless checks for COPYCAT's physics, validator and paired-challenge generator.
// Run: node bits/copycat/dev/test-core.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "main.js"), "utf8");
const window = { __COPYCAT_TEST__: {} };
vm.runInNewContext(src, { window, performance, console, Math });
const core = window.__copycatCore;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log("FAIL:", msg); } else console.log("ok  :", msg); };

const cfg = { vStart: 4.2, vMax: 6.2, jumpHeight: 1.55, airTime: 0.62, coyote: 0.08, buffer: 0.12, winStart: 0.32, winEnd: 0.13 };
const P = core.makePhys(cfg);
const { EV_JUMP, EV_LAND, EV_DIE } = core.EV;
const RAMP = [[0, 0], [8, 0.12], [20, 0.36], [40, 0.66], [70, 0.9], [110, 1]];
const ramp = (l) => { for (let i = 1; i < RAMP.length; i++) { const a = RAMP[i - 1], b = RAMP[i]; if (l <= b[0]) return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]); } return 1; };

// ---- 1. one input, two outcomes on hand-built worlds ----
{
  const A = core.newWorld(), B = core.newWorld();
  A.blocks.push({ x0: -5, x1: 3, top: 0 }, { x0: 4.2, x1: 20, top: 0 });           // gap 3.0-4.2
  B.blocks.push({ x0: -5, x1: 20, top: 0 });
  B.ceils.push({ x0: 1.0, x1: 2.4, y: 1.05, lethal: true });                         // spiked ceiling
  A.killY = B.killY = -2.2;
  const W = [A, B];
  const run = (tapX) => {
    const s = core.newSim(0, 4.2, 0, 0);
    let tapped = false, evs = [[], []];
    while (s.x < 9 && !(s.c[0].dead || s.c[1].dead)) {
      const t = !tapped && s.x >= tapX; if (t) tapped = true;
      core.stepSim(s, W, P, t);
      for (let i = 0; i < 2; i++) { if (s.c[i].ev & EV_JUMP) evs[i].push("jump"); if (s.c[i].ev & EV_LAND) evs[i].push("land"); }
    }
    return { dead: [s.c[0].dead, s.c[1].dead], evs };
  };
  const early = run(1.6), none = run(99), good = run(2.7);
  check(early.dead[1] === "ceiling" && !early.dead[0], "early jump: original fine, copy hits the spiked ceiling");
  check(none.dead[0] === "fell" && !none.dead[1], "no jump: original falls, copy fine");
  check(!good.dead[0] && !good.dead[1], "jump after the ceiling, before the gap: both survive");
  check(good.evs[0].join() === "jump,land" && good.evs[1].join() === "jump,land", "a single tap made both characters jump and land");
}
// coyote + buffer
{
  const A = core.newWorld(), B = core.newWorld();
  A.blocks.push({ x0: -5, x1: 2, top: 0 }, { x0: 4, x1: 9, top: 0 }); B.blocks.push({ x0: -5, x1: 9, top: 0 });
  A.killY = B.killY = -2.2;
  const s = core.newSim(0, 4.2, 0, 0); let jumpedAt = null;
  while (s.x < 8 && !s.c[0].dead) {
    const t = s.x >= 2.23 + 4.2 * 0.05 && jumpedAt === null && !s.c[0].gr && s.c[0].coy > 0; // tap 50ms after leaving the ledge
    core.stepSim(s, [A, B], P, t);
    if (s.c[0].ev & EV_JUMP && jumpedAt === null) jumpedAt = s.x;
  }
  check(jumpedAt !== null && !s.c[0].dead, "coyote time lets the original jump just after the ledge");
}

// ---- 2. the validator rejects impossible pairs ----
{
  const solver = core.makeSolver(P);
  const A = core.newWorld(), B = core.newWorld();
  A.blocks.push({ x0: 0, x1: 3, top: 0 }, { x0: 4.4, x1: 9, top: 0 });               // gap needs a jump at ~1.8-3.2
  B.blocks.push({ x0: 0, x1: 9, top: 0 });
  B.ceils.push({ x0: 1.0, x1: 4.0, y: 1.05, lethal: true });                          // forbids jumping until 4.0
  A.killY = B.killY = -2.2;
  const res = solver.analyze([A, B], core.newSim(0, 4.2, 0, 0), 9, 0.1, 200000);
  check(!res.ok, "impossible pair (ceiling covers the whole jump window) is rejected: " + res.reason);
  B.ceils[0].x1 = 2.2;
  const res2 = solver.analyze([A, B], core.newSim(0, 4.2, 0, 0), 9, 0.1, 200000);
  check(res2.ok && res2.taps.length === 1, "shortened ceiling: solvable with one shared tap, window " + (res2.taps[0] && res2.taps[0].width.toFixed(3)) + "s");
}

// ---- 3. generator: endless, validated, gradually harder ----
for (const tutorial of [true, false]) {
  const seed = 12345 + (tutorial ? 1 : 0);
  const gen = core.createGenerator(P, cfg, ramp, seed, tutorial);
  const solver = core.makeSolver(P);
  gen.startSegment();
  const segs = [], t0 = Date.now();
  let attempts = 0, maxAttemptMs = 0;
  while (segs.length < 400) {
    const a0 = Date.now();
    const seg = gen.tryNext(); attempts++;
    maxAttemptMs = Math.max(maxAttemptMs, Date.now() - a0);
    if (seg) segs.push(seg);
    if (attempts > 6000) break;
  }
  const ms = Date.now() - t0;
  const ch = segs.filter((s) => s.kind === "challenge");
  console.log(`\n[tutorial=${tutorial}] ${segs.length} segments (${ch.length} challenges) in ${ms}ms, ${attempts} attempts, slowest attempt ${maxAttemptMs}ms`);
  check(segs.length === 400, "generator keeps producing segments");
  // contiguity
  let contiguous = true;
  for (let i = 1; i < segs.length; i++) {
    if (Math.abs(segs[i].x0 - segs[i - 1].x1) > 1e-6) contiguous = false;
    if (segs[i].h0[0] !== segs[i - 1].h1[0] || segs[i].h0[1] !== segs[i - 1].h1[1]) contiguous = false;
  }
  check(contiguous, "segments join cleanly (x and floor height)");
  // independent re-validation of every segment
  let bad = 0;
  for (const s of segs) {
    const r = solver.analyze(s.w, core.newSim(s.x0, s.v, s.h0[0], s.h0[1]), s.x1, 0.0, 400000);
    if (!r.ok) { bad++; if (bad < 4) console.log("  unsolvable", s.kind, s.fams, r.reason); }
  }
  check(bad === 0, "every generated segment re-validates as solvable");
  // heights within band
  check(segs.every((s) => s.h1.every((h) => h >= -1.21 && h <= 1.61)), "floor heights stay inside the band");
  // difficulty trend
  const bucket = (a, b) => ch.slice(a, b);
  const avg = (arr, f) => arr.reduce((m, s) => m + f(s), 0) / Math.max(1, arr.length);
  for (const [a, b] of [[0, 15], [15, 40], [40, 80], [80, 140], [140, 300]]) {
    const bk = bucket(a, b);
    if (!bk.length) continue;
    console.log(`  challenges ${a}-${b}: speed ${avg(bk, (s) => s.v).toFixed(2)}  beats ${avg(bk, (s) => s.fams.length || 1).toFixed(2)}  minWindow ${avg(bk, (s) => s.minWindow).toFixed(3)}s  taps ${avg(bk, (s) => s.solution.length).toFixed(2)}  fams ${[...new Set(bk.flatMap((s) => s.fams))].join(",")}`);
  }
  const early = avg(bucket(0, 15), (s) => s.minWindow), late = avg(bucket(80, 300), (s) => s.minWindow);
  check(late < early, "timing windows tighten as the run progresses");
  check(avg(bucket(80, 300), (s) => s.fams.length) > avg(bucket(0, 15), (s) => s.fams.length || 1), "later challenges combine more beats");
  const vmax = Math.max(...segs.map((s) => s.v));
  check(vmax <= cfg.vMax + 1e-9, "speed is capped at vMax (" + vmax.toFixed(2) + ")");
  check(ch.every((s) => s.minWindow >= cfg.winEnd - 1e-9), "every challenge's narrowest tap window >= the lower bound");
  const restGaps = []; let since = 0;
  for (const s of segs) { if (s.kind === "challenge") since++; else { restGaps.push(since); since = 0; } }
  check(Math.max(...restGaps) <= 8, "recovery segments keep arriving (max challenges between rests: " + Math.max(...restGaps) + ")");
  const famCount = {}; for (const s of ch) for (const f of s.fams) famCount[f] = (famCount[f] || 0) + 1;
  console.log("  family usage", JSON.stringify(famCount));
  check(Object.keys(famCount).length >= 8, "all challenge families appear");
  const prisms = segs.reduce((m, s) => m + s.w[0].prisms.length + s.w[1].prisms.length, 0);
  check(prisms > 20, "collectible prisms are placed (" + prisms + ")");
}
// ---- 4. generation can be sliced into small per-frame budgets ----
{
  const gen = core.createGenerator(P, cfg, ramp, 99, false);
  gen.startSegment();
  let made = 0, worst = 0;
  while (made < 120) {
    const t = performance.now();
    const seg = gen.work(t + 2);
    worst = Math.max(worst, performance.now() - t);
    if (seg) made++;
  }
  check(worst < 8, "sliced generation never blocks a frame for long (worst slice " + worst.toFixed(2) + "ms with a 2ms budget)");
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall core checks passed");
process.exit(failures ? 1 : 0);
