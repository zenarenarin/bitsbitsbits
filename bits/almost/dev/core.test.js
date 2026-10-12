// Headless tests for ALMOST's gameplay core.  Run: node bits/almost/dev/core.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const sandbox = { window: {}, Math, Float64Array, Map, Object, Number, isFinite };
vm.runInNewContext(src, sandbox);
const Core = sandbox.window.plethoraBit.core;
const { G, PIN_POLY, pinGap, simulateLaunch, badInterval, goodIntervals, wrapPi, wrap2Pi } = Core;
const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
const T = Core.DEFAULT_TUNE;
const FLIGHT = T.flightMs / 1000;

let failures = 0, passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; return; }
  failures++;
  console.log("FAIL:", name, info !== undefined ? JSON.stringify(info) : "");
}

// ---------- reference geometry (independent, brute force) ----------
function poly(rel, s) {
  const out = [];
  const c = Math.cos(rel), sn = Math.sin(rel);
  for (let i = 0; i < PIN_POLY.length; i += 2) {
    const x = PIN_POLY[i] + s, y = PIN_POLY[i + 1];
    out.push([x * c - y * sn, x * sn + y * c]);
  }
  return out;
}
function inside(p, P) { // convex CCW
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
}
function segDist(p, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}
function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
// Reference: are two polygons within `clear` of each other?
function refTouch(P, Q, clear) {
  for (const p of P) if (inside(p, Q)) return true;
  for (const q of Q) if (inside(q, P)) return true;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) {
    if (segsIntersect(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length])) return true;
  }
  let d = Infinity;
  for (const p of P) for (let j = 0; j < Q.length; j++) d = Math.min(d, segDist(p, Q[j], Q[(j + 1) % Q.length]));
  for (const q of Q) for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(q, P[i], P[(i + 1) % P.length]));
  return d < clear;
}

const rng = Core.mulberry32(12345);

// 1. pinGap agrees with an independent reference implementation.
{
  const P0 = poly(0, 0);
  let mism = 0;
  for (let n = 0; n < 40000; n++) {
    const rel = (rng() - 0.5) * 0.4;
    const s = rng() < 0.5 ? 0 : rng() * (G.L + 5);
    const gap = pinGap(rel, s, G.CLEARANCE);
    const mine = gap < G.CLEARANCE;
    const ref = refTouch(P0, poly(rel, s), G.CLEARANCE);
    if (mine !== ref) mism++;
  }
  check("pinGap matches brute-force reference (40k random poses)", mism === 0, { mism });
}

// 1b. The drawn blade silhouette (with its outline stroke) lies inside the
// collision polygon: nothing visible ever extends past what collides.
{
  const P0 = poly(0, 0);
  const prof = Core.PIN_PROFILE;
  const half = Core.PIN_OUTLINE / 2;
  const pts = [];
  for (let i = 0; i < prof.length; i += 2) pts.push([G.R + prof[i], prof[i + 1]]);
  const outline = pts.concat(pts.slice().reverse().map(p => [p[0], -p[1]]));
  let worst = Infinity, outside = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    for (let k = 0; k <= 40; k++) {
      const p = [a[0] + (b[0] - a[0]) * k / 40, a[1] + (b[1] - a[1]) * k / 40];
      if (!inside(p, P0)) { outside++; continue; }
      let d = Infinity;
      for (let j = 0; j < P0.length; j++) d = Math.min(d, segDist(p, P0[j], P0[(j + 1) % P0.length]));
      worst = Math.min(worst, d);
    }
  }
  check("visual blade + outline stay inside the collision polygon", outside === 0 && worst >= half - 1e-9, { outside, worst, half });
  // ...and the visual hugs the collision width where pins actually meet
  // (collar / shoulder region), so contact reads as contact.
  const shoulder = Math.max(...pts.filter(p => p[0] > G.R + 13 && p[0] < G.R + 31).map(p => p[1]));
  check("visible width at collar/shoulder within 0.2u of collision width", G.W / 2 - (shoulder + half) <= 0.2, { shoulder });
}

// 2. Static threshold: the smallest legal angular spacing between two
// attached pins is well defined and symmetric.
const STATIC = (() => {
  let a = 0, b = 0.5;
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (pinGap(m, 0, G.CLEARANCE) < G.CLEARANCE) a = m; else b = m; }
  return b;
})();
check("static spacing positive & sane", STATIC > 0.05 && STATIC < 0.2, STATIC);
check("symmetric static threshold", pinGap(-STATIC * 1.0001, 0, G.CLEARANCE) >= G.CLEARANCE && pinGap(-STATIC * 0.9999, 0, G.CLEARANCE) < G.CLEARANCE);
console.log("static min spacing (rad):", STATIC.toFixed(5), "=> max pins on a circle ~", Math.floor(TAU / STATIC));

// 3. Launch with no rotation (omega = 0): pure placement threshold.
{
  const one = new Float64Array([0]);
  const out = {};
  const just = (rel) => simulateLaunch(one, 1, HALF_PI - rel, 0, FLIGHT, out).hit;
  check("omega=0: just outside threshold attaches (+)", !just(STATIC * 1.002));
  check("omega=0: just inside threshold collides (+)", just(STATIC * 0.998));
  check("omega=0: just outside threshold attaches (-)", !just(-STATIC * 1.002));
  check("omega=0: just inside threshold collides (-)", just(-STATIC * 0.998));
  check("omega=0: large gap attaches", !just(1.0));
  check("omega=0: dead-on collides", just(0));
  // Attachment angle equals trajectory angle.
  simulateLaunch(one, 1, HALF_PI - 1.0, 0, FLIGHT, out);
  check("attach angle equals trajectory", Math.abs(wrapPi(out.beta - 1.0)) < 1e-9, out.beta);
}

// 4. Wraparound at 0 / 2PI.
{
  const out = {};
  const a = new Float64Array([TAU - 0.0005]);
  // incoming relative angle +0.0005 (just past 0): dead-on hit across the seam
  check("wraparound: pin at 2PI-e hit by launch at +e", simulateLaunch(a, 1, HALF_PI - 0.0005, 0, FLIGHT, out).hit);
  const b = new Float64Array([0.0004]);
  check("wraparound: pin at +e hit by launch at 2PI-e", simulateLaunch(b, 1, HALF_PI - (TAU - 0.0004), 0, FLIGHT, out).hit);
  // Proper seam check: pin at 2PI - x, launch at +y with x + y just above/below STATIC.
  const x = STATIC * 0.37;
  const p = new Float64Array([TAU - x]);
  check("seam: x+y > STATIC attaches", !simulateLaunch(p, 1, HALF_PI - (STATIC * 1.002 - x), 0, FLIGHT, out).hit);
  check("seam: x+y < STATIC collides", simulateLaunch(p, 1, HALF_PI - (STATIC * 0.998 - x), 0, FLIGHT, out).hit);
  // Same with theta offset by many turns (large accumulated rotation).
  check("seam with large theta", simulateLaunch(p, 1, HALF_PI - (STATIC * 0.998 - x) + 40 * TAU, 0, FLIGHT, out).hit);
}

// 5. Swept collision vs. an ultra-fine brute-force sweep, at many speeds.
{
  let mism = 0, ambiguous = 0, cases = 0;
  const out = {};
  const one = new Float64Array([0]);
  for (const omega of [0.6, 1.35, 2.0, 2.7, -1.6, -2.7, 6, 12]) {
    for (let n = 0; n < 220; n++) {
      const rel0 = (rng() - 0.5) * 1.0;
      const hit = simulateLaunch(one, 1, HALF_PI - rel0, omega, FLIGHT, out).hit;
      // reference: 20k samples over the whole flight, min gap tracked
      const v = G.S0 / FLIGHT;
      let minGap = Infinity;
      for (let k = 0; k <= 6000; k++) {
        const tau = (FLIGHT * k) / 6000;
        const s = G.S0 - v * tau;
        const rel = wrapPi(rel0 - omega * tau);
        if (Math.abs(rel) > 0.3 || s > G.L + 1) continue;
        minGap = Math.min(minGap, pinGap(rel, Math.max(0, s), 50));
      }
      cases++;
      const refHit = minGap < G.CLEARANCE;
      // Sampling may only disagree inside a SWEEP_EPS band around the clearance.
      if (Math.abs(minGap - G.CLEARANCE) < G.SWEEP_EPS) { ambiguous++; continue; }
      if (refHit !== hit) mism++;
    }
  }
  check("sweep agrees with brute force (outside the eps band)", mism === 0, { mism, cases, ambiguous });
}

// 6. No tunnelling: the final pose is clear but a pin swept through the
// incoming pin's body mid-flight. A final-pose-only check would accept it.
{
  const out = {};
  const one = new Float64Array([0]);
  let found = 0, caught = 0;
  for (const omega of [2.7, 6, 12, -2.7, -12]) {
    for (let rel0 = -1.2; rel0 <= 1.2; rel0 += 0.0021) {
      const relEnd = wrapPi(rel0 - omega * FLIGHT);
      const finalClear = pinGap(relEnd, 0, G.CLEARANCE) >= G.CLEARANCE;
      // Did the attached pin's angle cross the incoming pin while the latter
      // was already inside the pin band?
      const v = G.S0 / FLIGHT;
      const tBand = (G.S0 - G.L * 0.6) / v;
      const relBand = wrapPi(rel0 - omega * tBand);
      const crossed = Math.sign(relBand) !== Math.sign(relEnd) && Math.abs(relBand) < 1 && Math.abs(relEnd) < 1;
      if (finalClear && crossed) {
        found++;
        if (simulateLaunch(one, 1, HALF_PI - rel0, omega, FLIGHT, out).hit) caught++;
      }
    }
  }
  check("tunnelling cases exist in the test set", found > 20, found);
  check("every mid-flight pass-through is a collision", caught === found, { found, caught });
}

// 7. Frame-rate independence: identical launch times give identical runs
// at 30/60/90/120/144/240 Hz and with jittery frame times.
{
  function runAt(stepFn) {
    const game = Core.createGame({ tune: {}, hooks: {} });
    game.reset(Core.mulberry32(99));
    const launchTimes = [];
    // a fixed schedule of taps in sim seconds
    for (let i = 0; i < 60; i++) launchTimes.push(0.9 + i * 0.47 + (i % 5) * 0.033);
    const st = game.st;
    let li = 0, frame = 0;
    const log = [];
    while (st.simT < 40 && st.phase !== "over") {
      const dt = stepFn(frame++);
      // tap scheduled inside this frame -> launch with the exact offset
      if (li < launchTimes.length && launchTimes[li] <= st.simT + dt) {
        const off = launchTimes[li] - st.simT;
        if (st.phase === "ready") {
          game.advance(off);
          game.launch(0);
          log.push(["L", +st.simT.toFixed(9)]);
          game.advance(dt - off);
        } else {
          game.advance(dt);
        }
        li++;
        continue;
      }
      const before = st.score;
      game.advance(dt);
      if (st.score !== before) log.push(["A", st.score]);
    }
    return { score: st.score, phase: st.phase, angles: Array.from(st.angles.subarray(0, st.count)).map(a => a.toFixed(9)).join(","), fail: st.fail && st.fail.t.toFixed(9) };
  }
  const ref = runAt(() => 1 / 60);
  const variants = {
    hz30: () => 1 / 30, hz90: () => 1 / 90, hz120: () => 1 / 120, hz144: () => 1 / 144, hz240: () => 1 / 240,
    jitter: f => (f % 3 === 0 ? 1 / 30 : f % 3 === 1 ? 1 / 144 : 1 / 75)
  };
  for (const [k, fn] of Object.entries(variants)) {
    const r = runAt(fn);
    check("frame-rate independent: " + k, r.score === ref.score && r.angles === ref.angles && r.fail === ref.fail && r.phase === ref.phase, { ref: [ref.score, ref.fail], got: [r.score, r.fail] });
  }
  console.log("scripted run reached score", ref.score, "phase", ref.phase);
}

// 8. The analysis interval is conservative (every real collision lies
// inside it), tight (deep inside it always collides), contiguous, and
// shifted towards the rotation direction.
{
  const one = new Float64Array([0]);
  const out = {};
  const M = Core.ANALYSIS_MARGIN;
  for (const omega of [0.5, 1.35, 2.0, 2.5, 2.7, -1.35, -2.0, -2.5]) {
    const bad = badInterval(omega, FLIGHT);
    let escaped = 0, loose = 0, transitions = 0, prev = null;
    for (let r = -1.0; r <= 1.0; r += 0.0005) {
      const h = simulateLaunch(one, 1, HALF_PI - r, omega, FLIGHT, out).hit;
      if (h && !(r >= bad.lo && r <= bad.hi)) escaped++;
      if (!h && r > bad.lo + 2.5 * M && r < bad.hi - 2.5 * M) loose++;
      if (prev !== null && h !== prev) transitions++;
      prev = h;
    }
    check("analysis interval conservative/tight/contiguous, omega=" + omega, escaped === 0 && loose === 0 && transitions === 2, { bad, escaped, loose, transitions });
    if (omega > 0) check("shadow shifted with rotation (+)", bad.hi + bad.lo > 0, bad);
    else check("shadow shifted with rotation (-)", bad.hi + bad.lo < 0, bad);
    console.log("omega", omega, "bad interval", bad.lo.toFixed(4), bad.hi.toFixed(4), "width", (bad.hi - bad.lo).toFixed(4));
  }
}

// 8b. Monotonic edges in speed (assumption behind grid unions) and mirror symmetry.
{
  let bad = 0, prev = null;
  for (let i = 0; i <= 70; i++) {
    const g = Core.gridInterval(i, FLIGHT);
    if (prev && (g.lo < prev.lo - 1e-6 || g.hi < prev.hi - 1e-6)) bad++;
    prev = g;
  }
  check("interval edges increase monotonically with speed", bad === 0, bad);
  const p = badInterval(1.83, FLIGHT), n = badInterval(-1.83, FLIGHT);
  check("reverse rotation mirrors", Math.abs(p.lo + n.hi) < 1e-12 && Math.abs(p.hi + n.lo) < 1e-12);
}

// 9. Generator: every spindle is valid and fair for many seeds.
{
  let bad = 0, fallbacks = 0;
  const tune = Object.assign({}, T);
  const t0 = Date.now();
  let gens = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const r = Core.mulberry32(seed * 7919);
    for (let k = 0; k < 18; k++) {
      const g = Core.generateSpindle(k, r, tune);
      gens++;
      if (!Core.staticOk(g.angles, g.count, 0)) bad++;
      const cap = Core.greedyCapacity(g.angles, g.count, g.spec, tune, g.spec.quota + 1);
      if (cap < g.spec.quota) { bad++; }
      const om = Core.omegaFor(g.spec, 0, tune);
      const gi = goodIntervals(g.angles, g.count, om, FLIGHT);
      const widest = Math.max(...gi.map(x => x.len)) / Math.abs(om) * 1000;
      if (widest < g.spec.minWindowMs) bad++;
      if (Math.abs(om) > tune.maxSpeed + 1e-9) bad++;
    }
  }
  const ms = (Date.now() - t0) / gens;
  check("all generated spindles valid, feasible and within speed cap", bad === 0, { bad });
  console.log("avg spindle generation+checks:", ms.toFixed(2), "ms");
  // Print the difficulty schedule.
  for (const k of [0, 1, 2, 3, 5, 8, 12, 20]) {
    const s = Core.spindleSpec(k, tune);
    const r = Core.mulberry32(5 + k);
    const g = Core.generateSpindle(k, r, tune);
    const om = Core.omegaFor(s, 0, tune);
    const gi = goodIntervals(g.angles, g.count, om, FLIGHT);
    const widest = Math.max(...gi.map(x => x.len)) / Math.abs(om) * 1000;
    console.log(`spindle ${k}: start pins ${s.initial}, quota ${s.quota}, speed ${Math.abs(om).toFixed(2)}→${Math.abs(Core.omegaFor(s, s.quota, tune)).toFixed(2)} rad/s, widest window ${widest.toFixed(0)} ms`);
  }
}

// 10. Game state: score increments once per attach, never on failure;
// reset clears everything.
{
  let attaches = 0, fails = 0;
  const game = Core.createGame({ hooks: { onAttach() { attaches++; }, onFail() { fails++; } } });
  game.reset(Core.mulberry32(3));
  const st = game.st;
  // Bot that launches into the centre of the widest window.
  let safety = 0;
  while (st.score < 12 && safety++ < 20000) {
    if (st.phase !== "ready") { game.advance(1 / 60); continue; }
    const gi = goodIntervals(st.angles, st.count, st.omega, FLIGHT);
    let best = gi[0];
    for (const x of gi) if (x.len > best.len) best = x;
    const target = best.start + best.len / 2; // desired beta at launch
    const beta = wrap2Pi(HALF_PI - game.theta(st.simT));
    // time until beta reaches target (beta decreases at rate omega)
    let d = wrap2Pi(st.omega > 0 ? beta - target : target - beta);
    const wait = d / Math.abs(st.omega);
    if (wait > 1 / 60) { game.advance(Math.min(wait - 1e-6, 1 / 60)); continue; }
    game.advance(Math.max(0, wait));
    const scoreBefore = st.score;
    check("launch accepted when ready", game.launch(0));
    check("second launch while flying is rejected", game.launch(0) === false);
    for (let i = 0; i < 30 && st.phase === "flying"; i++) game.advance(1 / 60);
    if (st.phase === "over") break;
    check("score +1 exactly", st.score === scoreBefore + 1, { scoreBefore, now: st.score });
  }
  check("bot reached 12 by aiming at window centres", st.score >= 12, st.score);
  check("attach hook count == score", attaches === st.score, { attaches, score: st.score });
  // Now force a collision: aim dead-on at an existing pin.
  while (st.phase !== "ready") game.advance(1 / 60);
  const scoreBefore = st.score;
  // find time when beta == angles[0]
  const beta = wrap2Pi(HALF_PI - game.theta(st.simT));
  const d = wrap2Pi(st.omega > 0 ? beta - st.angles[0] : st.angles[0] - beta);
  // aim so the pin arrives dead-on: account for flight rotation
  game.advance(wrap2Pi(d - Math.abs(st.omega) * FLIGHT) / Math.abs(st.omega));
  game.launch(0);
  for (let i = 0; i < 30; i++) game.advance(1 / 60);
  check("dead-on launch ends the run", st.phase === "over", st.phase);
  check("no points for failure", st.score === scoreBefore);
  check("fail hook once", fails === 1, fails);
  check("no launches after game over", game.launch(0) === false);
  const frozen = game.theta(st.simT);
  game.advance(0.5);
  check("structure stops after collision", game.theta(st.simT) === frozen);
  // reset
  game.reset(Core.mulberry32(4));
  check("reset: score 0", st.score === 0);
  check("reset: back to first spindle", st.spec.index === 0 && st.placed === 0);
  check("reset: initial pin count is the gentle start", st.count === Core.spindleSpec(0, T).initial);
  check("reset: phase ready, fail cleared", st.phase === "ready" && st.fail === null);
}

// 11. Pins never overlap in any attached structure produced by play.
{
  const game = Core.createGame({});
  game.reset(Core.mulberry32(77));
  const st = game.st;
  let violations = 0;
  for (let n = 0; n < 4000 && st.phase !== "over"; n++) {
    if (st.phase === "ready" && Math.random() < 0.08) game.launch(Math.random() * 0.016);
    game.advance(1 / 60);
    if (!Core.staticOk(st.angles, st.count, 0)) violations++;
  }
  check("attached pins never overlap", violations === 0, violations);
}

// 12. CONTINUITY REGRESSION: one run is one structure. Pins are never lost,
// moved, regenerated or replaced while the run is active; each successful
// landing adds exactly one pin and exactly one point; only reset() clears.
{
  // Skilled-player bot: aims tight against the edge of the widest window.
  function aimWait(game, margin) {
    const st = game.st;
    const gi = goodIntervals(st.angles, st.count, st.omega, FLIGHT);
    let best = null;
    for (const x of gi) if (!best || x.len > best.len) best = x;
    if (!best || best.len < 2 * margin) return null;
    const target = st.omega > 0 ? best.start + margin : best.start + best.len - margin;
    const beta = wrap2Pi(HALF_PI - game.theta(st.simT));
    return wrap2Pi(st.omega > 0 ? beta - target : target - beta) / Math.abs(st.omega);
  }
  let worstViolations = 0;
  for (const seed of [11, 22, 33, 44, 55, 66]) {
    const attached = [];
    let hookScores = [];
    const game = Core.createGame({ hooks: { onAttach(score) { attached.push(game.st.lastAttach.angle); hookScores.push(score); } } });
    game.reset(Core.mulberry32(seed));
    const st = game.st;
    const initial = st.initialCount;
    const seeded = Array.from(st.angles.subarray(0, initial));
    let violations = 0;
    const milestones = {};
    let prevCount = st.count, prevScore = st.score;
    let prev = Float64Array.from(st.angles.subarray(0, st.count));
    const frame = dt => {
      game.advance(dt);
      // never shrinks, never rewrites an existing pin
      if (st.count < prevCount) violations++;
      for (let i = 0; i < prevCount; i++) if (st.angles[i] !== prev[i]) { violations++; break; }
      // grows by at most one, always with exactly one point
      if (st.count - prevCount > 1) violations++;
      if (st.score - prevScore !== st.count - prevCount) violations++;
      if (st.count !== initial + st.score) violations++;
      if (st.phase === "over" && st.score !== prevScore) violations++;
      prevCount = st.count; prevScore = st.score;
      prev = Float64Array.from(st.angles.subarray(0, st.count));
      for (const m of [5, 10, 20, 30, 40]) {
        if (!milestones[m] && st.score === m) {
          // every pin placed so far is still attached, in order, unchanged
          const placed = Array.from(st.angles.subarray(initial, st.count));
          const seedOk = seeded.every((a, i) => st.angles[i] === a);
          milestones[m] = seedOk && placed.length === m && placed.every((a, i) => a === attached[i]);
        }
      }
    };
    let guard = 0;
    while (st.phase !== "over" && guard++ < 200000) {
      if (st.phase !== "ready") { frame(1 / 60); continue; }
      const wait = aimWait(game, 0.006);
      if (wait === null) {           // structure full: a real collision must end it
        const before = st.count;
        game.launch(0);
        for (let i = 0; i < 20 && st.phase === "flying"; i++) frame(1 / 60);
        check("seed " + seed + ": full structure ends in a genuine collision", st.phase === "over" && st.count === before, { phase: st.phase });
        break;
      }
      if (wait > 1 / 60) { frame(Math.min(wait - 1e-7, 1 / 60)); continue; }
      frame(Math.max(0, wait));
      game.launch(0);
      // duplicate input while flying is ignored
      if (game.launch(0)) violations++;
    }
    worstViolations += violations;
    for (const m of [5, 10, 20, 30, 40]) check(`seed ${seed}: after ${m} placements all ${m} pins remain attached`, milestones[m] === true, { reached: st.score });
    check(`seed ${seed}: no pin lost/moved, count = initial + score on every frame`, violations === 0, violations);
    check(`seed ${seed}: onAttach fired once per point`, hookScores.length === st.score && hookScores.every((v, i) => v === i + 1));
    check(`seed ${seed}: run ended only by collision`, st.phase === "over" && st.fail !== null);
    console.log(`seed ${seed}: extended run placed ${st.score} pins (structure ${st.count}) before the circle was full`);

    // Rotation keeps going but never touches pins.
    // Retry: everything resets, nothing is inherited.
    const oldPlaced = Array.from(st.angles.subarray(initial, st.count));
    game.reset(Core.mulberry32(seed + 1000));
    check(`seed ${seed}: retry resets score, pins and speed`, st.score === 0 && st.placed === 0 && st.count === st.initialCount && st.count === Core.spindleSpec(0, T).initial && st.phase === "ready" && st.fail === null && st.omega === Core.omegaFor(st.spec, 0, T));
    check(`seed ${seed}: new run inherits no placed pins`, oldPlaced.every(a => Array.from(st.angles.subarray(0, st.count)).indexOf(a) < 0));
    // Idle rotation for 30 s with no input: structure untouched.
    const snap = Array.from(st.angles.subarray(0, st.count));
    for (let i = 0; i < 1800; i++) game.advance(1 / 60);
    check(`seed ${seed}: 30 s of rotation leaves the structure untouched`, st.count === snap.length && snap.every((a, i) => st.angles[i] === a));
  }
  check("continuity: zero violations across all extended runs", worstViolations === 0, worstViolations);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
