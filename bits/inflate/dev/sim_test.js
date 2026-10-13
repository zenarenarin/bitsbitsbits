// Headless checks for INFLATE's simulation core (no browser needed).
//
//   node bits/inflate/dev/sim_test.js gen               generator stats by distance (segments, open %, difficulty)
//   node bits/inflate/dev/sim_test.js policies          always-hold / never-hold / rapid toggling must all fail early
//   node bits/inflate/dev/sim_test.js autopilot [n] [x] look-ahead bot flies n seeds to distance x using real game collision
//
// main.js only exposes its core when globalThis.__INFLATE_TEST__ is set, so production behaviour is unaffected.
globalThis.window = globalThis;
globalThis.__INFLATE_TEST__ = {};
require(require("path").join(__dirname, "..", "main.js"));
const C = globalThis.__INFLATE_CORE__;
const mode = process.argv[2] || "gen";

function genWorld(seed, toX) {
  const g = new C.WorldGen(seed);
  const segs = [];
  g.fillTo(toX, (s) => segs.push(s));
  return { g, segs };
}

// Fly a policy through generated segments with the game's own step, collision radius and ring reach.
function simulate(segs, policy, toX) {
  const st = { x: 0, y: 500, vy: 0, I: C.CFG.balloon.startI };
  const dt = 1 / C.CFG.sim.hz;
  const fl = [];
  let t = 0, rings = 0;
  for (;;) {
    const hold = policy(st, t);
    fl.length = 0;
    for (const s of segs) if (s.x0 - 100 < st.x && s.x1 + 100 > st.x) for (const f of s.fields) fl.push(f);
    const r = C.physStep(st, hold, dt, fl, fl.length);
    t += dt;
    const rh = r * C.CFG.balloon.hitScale;
    for (const s of segs) {
      if (s.x1 < st.x - 200 || s.x0 > st.x + 200) continue;
      for (const so of s.solids) {
        if (st.x + rh < so.x0 - 5 || st.x - rh > so.x1 + 5) continue;
        if (C.solidClearance(so, st.x, st.y, rh, st.x) < 0) return { x: st.x, died: true, rings, kind: s.kind };
      }
      for (const rg of s.rings) {
        if (rg.simTaken) continue;
        const R = (rg.big ? C.CFG.ring.bigR : C.CFG.ring.r) * C.CFG.ring.reach + r;
        const dx = rg.x - st.x, dy = rg.y - st.y;
        if (dx * dx + dy * dy < R * R) { rg.simTaken = true; rings++; }
      }
    }
    if (st.x > toX) return { x: st.x, died: false, rings, kind: "-" };
  }
}

if (mode === "gen") {
  const bins = {};
  let maxMs = 0, fallbacks = 0, segments = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = new C.WorldGen(seed);
    while (g.frontier < 70000) {
      const t0 = Date.now();
      const s = g.pump(1e9);
      maxMs = Math.max(maxMs, Date.now() - t0);
      const k = Math.floor(s.x0 / 10000) * 10;
      bins[k] = bins[k] || { segs: 0, open: 0, dsum: 0 };
      bins[k].segs++;
      if (s.kind === "open") bins[k].open++;
      bins[k].dsum += s.d;
    }
    fallbacks += g.stats.fallbacks;
    segments += g.stats.segments;
  }
  console.log("x(k)  segs  open%  avg-d");
  for (const k of Object.keys(bins).sort((a, b) => a - b)) {
    const b = bins[k];
    console.log(String(k).padStart(4), String(b.segs).padStart(5), (((100 * b.open) / b.segs).toFixed(0) + "%").padStart(6), (b.dsum / b.segs).toFixed(2));
  }
  console.log("validation fallbacks", fallbacks, "of", segments, "segments; slowest segment (incl. retries)", maxMs, "ms");
}

if (mode === "policies") {
  const policies = { alwaysHold: () => true, neverHold: () => false, toggle8Hz: (t) => Math.floor(t * 16) % 2 === 0 };
  for (const [name, pol] of Object.entries(policies)) {
    const xs = [];
    for (let seed = 1; seed <= 10; seed++) xs.push(simulate(genWorld(seed, 30000).segs, (st, t) => pol(t), 30000).x | 0);
    console.log(name.padEnd(12), "died at x =", xs.join(", "));
  }
}

if (mode === "autopilot") {
  const n = +process.argv[3] || 6, toX = +process.argv[4] || 45000;
  const rows = [];
  for (let seed = 1; seed <= n; seed++) {
    const { segs } = genWorld(seed, toX + 1500);
    let action = 0, nextPlan = 0;
    const res = simulate(segs, (st, t) => {
      if (t >= nextPlan) { action = C.planAction(st, segs, 3.0, 0); nextPlan = t + 0.125; }
      return action === 1;
    }, toX);
    rows.push({ seed, x: res.x | 0, rings: res.rings, died: res.died, kind: res.kind });
  }
  console.table(rows);
}
