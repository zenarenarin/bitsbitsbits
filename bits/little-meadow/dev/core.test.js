// Headless tests for LITTLE MEADOW core: generation fairness, determinism, bots.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "main.js"), "utf8");
global.window = { __LM_TEST__: true };
new Function("window", src)(global.window);
const C = window.__LM_CORE__;
const { Generator, Sim, DEFAULTS, LANES, CELL_OBST, CELL_DENSE } = C;
const cfg = Object.assign({}, DEFAULTS);

const safe = (c) => !c.f && c.t !== CELL_OBST;
function stepMask(gen, prev, cur, m) { return gen.advance(prev.cells, cur.cells, m); }

// 1) Fairness: global reachability never empties; count reachable dead-end cells.
let worst = { empty: 0, traps: 0, cells: 0 }, names = {}, fallbacks = 0, obsCount = 0;
const SEEDS = 300, ROWS = 2600;
for (let seed = 1; seed <= SEEDS; seed++) {
  const g = Generator(seed * 7919, cfg);
  g.ensure(ROWS);
  // reachable from lane 3 at row 0
  let m = 1 << 3;
  const reach = [];
  for (let r = 1; r <= ROWS; r++) {
    m = stepMask(g, g.row(r - 1), g.row(r), m);
    reach[r] = m;
    if (!m) { worst.empty++; console.log("EMPTY reach seed", seed, "row", r, g.row(r).pattern); break; }
  }
  // backward survivability over a 14-row horizon
  const H = 14;
  for (let r = 1; r < ROWS - H; r++) {
    let alive = reach[r];
    for (let l = 0; l < LANES; l++) {
      if (!(alive & (1 << l))) continue;
      worst.cells++;
      let mm = 1 << l;
      for (let k = 1; k <= H && mm; k++) mm = stepMask(g, g.row(r + k - 1), g.row(r + k), mm);
      if (!mm) worst.traps++;
    }
  }
  for (const e of g.log) names[e.name] = (names[e.name] || 0) + 1;
  for (let r = 0; r <= ROWS; r++) { const row = g.row(r); if (row && row.pattern === "fallback") fallbacks++; }
  obsCount += g.obstacles.size;
}
console.log("fairness:", JSON.stringify(worst), "trap ratio", (worst.traps / worst.cells).toFixed(4), "fallback rows", fallbacks, "obstacles", obsCount);
console.log("pattern mix (last 60 per seed):", JSON.stringify(names));

// 2) Determinism
{
  const a = Generator(42, cfg), b = Generator(42, cfg);
  a.ensure(800); b.ensure(800);
  let same = true;
  for (let r = -10; r <= 800; r++) {
    const x = a.row(r), y = b.row(r);
    if (JSON.stringify(x.cells) !== JSON.stringify(y.cells) || x.flowers.length !== y.flowers.length) { same = false; break; }
  }
  console.log("determinism:", same ? "ok" : "MISMATCH");
}

// 3) Bots
function planner(sim, horizon, greed) {
  const s = sim.s, gen = sim.gen;
  const r0 = Math.floor(s.y + 0.15);
  // DP from far to near: value of being in lane l at row r
  const V = [];
  for (let k = horizon; k >= 0; k--) {
    const row = gen.row(r0 + k);
    V[k] = [];
    for (let l = 0; l < LANES; l++) {
      const c = row.cells[l];
      if (!safe(c)) { V[k][l] = -1e6; continue; }
      let val = 0;
      for (const t of row.tufts) if (!t.cut && Math.abs(t.x - (l + 0.5)) < 0.46) val += t.v;
      val *= greed;
      // flowers in neighbouring lanes are close shaves (worth a little), but risky to timing
      let best = -1e6;
      if (k === horizon) best = 0;
      else for (let d = -1; d <= 1; d++) {
        const l2 = l + d; if (l2 < 0 || l2 >= LANES) continue;
        const nrow = gen.row(r0 + k + 1);
        if (d !== 0) {
          if (nrow.cells[l].t === CELL_OBST || row.cells[l2].t === CELL_OBST) continue;
          if (row.cells[l2].f && nrow.cells[l].f) continue;
        }
        best = Math.max(best, V[k + 1][l2] - (d !== 0 ? 0.3 : 0));
      }
      V[k][l] = val + best;
    }
  }
  return V;
}
// Would a lane change started now sweep through a flower? (what a careful player judges by eye)
function sweepClear(sim, dir) {
  const s = sim.s, len = sim.s.speed > 0 ? Math.max(0.3 * s.speed, 0.8) : 0.8;
  const fromX = s.x, toX = s.lane + dir + 0.5;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const e = 1 - Math.pow(1 - p, 2.2), x = fromX + (toX - fromX) * e, y = s.y + Math.min(len, 0.8) * p;
    for (let r = Math.floor(y) - 1; r <= Math.floor(y) + 1; r++) {
      const row = sim.gen.row(r); if (!row) continue;
      for (const f of row.flowers) if (!f.hit && Math.hypot(f.x - x, f.y - y) < 0.5) return false;
    }
  }
  // and the destination lane must be clear a little further on
  for (let y = s.y + 0.8; y < s.y + 1.4; y += 0.1) { const row = sim.gen.row(Math.floor(y)); if (row) for (const f of row.flowers) if (!f.hit && Math.abs(f.x - toX) < 0.5 && Math.abs(f.y - y) < 0.5) return false; }
  return true;
}
function runBot(kind, seed, maxSeconds) {
  const c = Object.assign({}, cfg);
  const sim = Sim(c, seed);
  sim.start();
  const s = sim.s;
  let t = 0, nextDecision = 0, pendingSwipe = null, decisions = 0, lastSwipeT = -9;
  const dt = 1000 / 60;
  const rng = (() => { let a = seed * 13 + 7; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  while (s.phase === "play" && t < maxSeconds) {
    t += dt / 1000;
    if (kind === "oracle" && !s.change) {
      const V = planner(sim, 11, 1);
      const k = Math.max(1, Math.floor(s.y + 0.15 + 1.05) - Math.floor(s.y + 0.15));
      let bestL = s.lane, bestV = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l < 0 || l >= LANES) continue; const v = V[k][l] - (d ? 0.5 : 0); if (v > bestV) { bestV = v; bestL = l; } }
      if (bestL !== s.lane && sweepClear(sim, bestL > s.lane ? 1 : -1)) { sim.swipe(bestL > s.lane ? 1 : -1); decisions++; }
    } else if (kind !== "passive" && kind !== "oracle" && t >= nextDecision) {
      nextDecision = t + (kind === "novice" ? 0.18 : 0.06);
      const horizon = kind === "novice" ? 5 : 11;
      const V = planner(sim, horizon, kind === "novice" ? 0.2 : 1);
      // choose lane for the row the mower will reach after a lane-change distance
      const k = Math.floor(s.y + 0.15 + c.laneChangeRows + 0.3) - Math.floor(s.y + 0.15);
      const cur = s.change ? s.change.to : s.lane;
      let bestL = cur, bestV = -1e9;
      for (let d = -1; d <= 1; d++) {
        const l = cur + d; if (l < 0 || l >= LANES) continue;
        const v = (V[Math.min(k, horizon)] || V[horizon])[l] - (d ? 0.5 : 0);
        if (v > bestV) { bestV = v; bestL = l; }
      }
      if (bestL !== cur && !s.change) {
        const dir = bestL > cur ? 1 : -1;
        if (pendingSwipe) {} else if (kind === "novice") { if (rng() < 0.85) pendingSwipe = { dir, at: t + 0.25 + rng() * 0.25 }; }
        else if (!pendingSwipe) pendingSwipe = { dir, at: t + 0.1 };
      }
    }
    if (pendingSwipe && t >= pendingSwipe.at) { sim.swipe(pendingSwipe.dir); decisions++; lastSwipeT = t; pendingSwipe = null; }
    sim.update(dt);
  }
  const st = s.stats;
  return { kind, seed, t: +t.toFixed(1), rows: Math.floor(s.y), score: s.score, lives: s.lives, collisions: st.collisions, near: st.near, patches: st.patches,
    maxMult: st.maxLevel + 1, avgMult: +(st.multTime / Math.max(1, t)).toFixed(2), turns: st.turns, auto: st.autoTurns, swipes: decisions, stuck: st.stuckEvents || 0, firstHit: st.firstHitT, log: st.collisionLog };
}
for (const kind of ["passive", "novice", "skilled", "oracle"]) {
  const res = [];
  for (let seed = 1; seed <= 40; seed++) res.push(runBot(kind, seed * 101, kind === "skilled" || kind === "oracle" ? 600 : 300));
  const avg = (k) => (res.reduce((a, r) => a + r[k], 0) / res.length).toFixed(1);
  const med = (k) => { const v = res.map((r) => r[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  console.log(kind.padEnd(8), "time avg", avg("t"), "med", med("t"), "| score avg", avg("score"), "med", med("score"), "| rows", avg("rows"),
    "| hits", avg("collisions"), "| near", avg("near"), "| patches", avg("patches"), "| maxMult", avg("maxMult"), "avgMult", avg("avgMult"), "| swipes/min", (res.reduce((a, r) => a + r.swipes, 0) / res.reduce((a, r) => a + r.t, 0) * 60).toFixed(1),
    "| auto", avg("auto"), "| stuck", res.reduce((a, r) => a + r.stuck, 0), "| firstHit med", med("firstHit"));
  if (kind === "skilled" || kind === "oracle") {
    const pats = {};
    for (const r of res) for (const c of r.log) { const key = c.pattern; pats[key] = (pats[key] || 0) + 1; }
    console.log("  skilled collisions by pattern:", JSON.stringify(pats));
    console.log("  sample:", JSON.stringify(res.flatMap((r) => r.log).slice(0, 4)));
  }
  if (kind === "passive") {
    const pats = {};
    for (const r of res) for (const c of r.log) { pats[c.pattern] = (pats[c.pattern] || 0) + 1; }
    console.log("  passive collisions by pattern:", JSON.stringify(pats));
  }
}

// 4) Long-run memory bound: an invulnerable autopilot for 25 simulated minutes.
{
  const sim = Sim(Object.assign({}, cfg), 99);
  sim.start();
  const s = sim.s;
  let maxRows = 0, maxObs = 0, maxPatches = 0;
  for (let i = 0; i < 60 * 60 * 25; i++) {
    s.invuln = 1; s.lives = 3;
    if (!s.change && i % 6 === 0) {
      const r = sim.gen.row(Math.floor(s.y + 1));
      if (r && (r.cells[s.lane].f || r.cells[s.lane].t === CELL_OBST)) sim.swipe(s.lane > 3 ? -1 : 1);
    }
    sim.update(1000 / 60);
    if (i % 600 === 0) { maxRows = Math.max(maxRows, sim.gen.rows.size); maxObs = Math.max(maxObs, sim.gen.obstacles.size); maxPatches = Math.max(maxPatches, sim.gen.patches.size); }
  }
  console.log("long run: rows travelled", Math.floor(s.y), "speed", s.speed.toFixed(2), "max live rows", maxRows, "max obstacles", maxObs, "max patches", maxPatches, "stuck events", s.stats.stuckEvents || 0, "score", s.score);
}
// 5) Input checks on a hand-made situation
{
  const mk = () => { const sim = Sim(Object.assign({}, cfg), 5); sim.start(); for (let i = 0; i < 60; i++) sim.update(1000 / 60); return sim; };
  // a) a swipe beside a short obstacle is held and runs as soon as the side lane opens (within the buffer)
  let sim = mk(), s = sim.s;
  const r = Math.floor(s.y);
  for (let k = 0; k < 3; k++) { const c = sim.gen.cell(r + k, s.lane + 1); c.t = CELL_OBST; c.f = null; }
  for (let k = 3; k < 6; k++) { const c = sim.gen.cell(r + k, s.lane + 1); c.t = 0; c.f = null; }
  // advance until the obstacle beside ends ~0.35 rows ahead of the mower's rear
  while (s.y - 0.25 < r + 3 - 0.45) sim.update(1000 / 60);
  const lane0 = s.lane; sim.swipe(1);
  const heldFirst = !!s.queued && s.lane === lane0;
  let tMs = 0; while (s.lane === lane0 && tMs < 1000) { sim.update(1000 / 60); tMs += 1000 / 60; }
  console.log("buffer: held while blocked:", heldFirst, "| executed after", Math.round(tMs), "ms (buffer", cfg.bufferMs, "ms) | lane", lane0, "->", s.lane);
  // b) a swipe toward the meadow edge is refused with a bump, not lost silently
  sim = mk(); s = sim.s; while (s.lane > 0) { sim.swipe(-1); for (let i = 0; i < 30; i++) sim.update(1000 / 60); }
  const before = s.stats.turns; sim.swipe(-1);
  console.log("edge swipe: lane", s.lane, "bumped", s.bumpT === s.time, "turn counted", s.stats.turns !== before);
  // c) a queued second swipe during a lane change chains into a two-lane move; at most one is queued
  sim = mk(); s = sim.s; const l0 = s.lane; sim.swipe(1); sim.swipe(1); sim.swipe(1);
  for (let i = 0; i < 90; i++) sim.update(1000 / 60);
  console.log("double swipe: lanes moved", s.lane - l0, "(expected 2, third swipe dropped)");
  // d) reversal mid-change heads straight back
  sim = mk(); s = sim.s; const l1 = s.lane; sim.swipe(1); sim.update(1000 / 60); sim.update(1000 / 60); sim.swipe(-1);
  for (let i = 0; i < 60; i++) sim.update(1000 / 60);
  console.log("reversal: back in lane", s.lane === l1, "x", s.x.toFixed(2));
  // e) the mower never enters an obstacle; with nothing pressed it steers around (default route)
  sim = mk(); s = sim.s; const ro = Math.floor(s.y) + 4;
  const c = sim.gen.cell(ro, s.lane); c.t = CELL_OBST; c.f = null;
  for (const d of [-1, 1]) for (let k = -1; k < 3; k++) { const cc = sim.gen.cell(ro + k, s.lane + d); if (cc) { cc.t = 0; cc.f = null; } }
  let entered = false; for (let i = 0; i < 180; i++) { sim.update(1000 / 60); if (sim.cellObs(Math.floor(s.y + 0.28), Math.floor(s.x))) entered = true; }
  console.log("obstacle ahead: auto-steered", s.stats.autoTurns > 0, "| entered obstacle", entered);
  // f) previously cut grass never scores twice; hit flowers do not hit twice
  sim = mk(); s = sim.s; let cuts = 0; const seen = new Set(); let dup = false;
  for (let i = 0; i < 600; i++) { const ev = sim.update(1000 / 60); for (const e of ev) if (e.type === "cut") { const k = e.x.toFixed(4) + "," + e.y.toFixed(4); if (seen.has(k)) dup = true; seen.add(k); cuts++; } }
  console.log("cut events", cuts, "duplicate tuft scored:", dup);
  // g) lives stop at zero and the run ends exactly once
  sim = mk(); s = sim.s; let overs = 0;
  for (let i = 0; i < 60 * 120 && s.phase === "play"; i++) { const ev = sim.update(1000 / 60); for (const e of ev) if (e.type === "over") overs++; }
  console.log("passive run end: phase", s.phase, "lives", s.lives, "over events", overs);
}
