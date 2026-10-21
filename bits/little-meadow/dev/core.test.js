// Headless tests for LITTLE MEADOW core: generation fairness, wildlife rules, bots, scenarios.
// usage: node dev/core.test.js [path/to/main.js]
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "main.js"), "utf8");
global.window = { __LM_TEST__: true };
new Function("window", src)(global.window);
const C = window.__LM_CORE__;
const { Generator, Sim, DEFAULTS, LANES, CELL_OBST, MOWER_R } = C;
const cfg = Object.assign({}, DEFAULTS);
const DT = 1000 / 60;
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// 1) Generation: a survivable route always exists; formation mix; determinism.
{
  let empty = 0, fallbacks = 0, rows = 0, stones = 0, rabbits = 0;
  const names = {};
  for (let seed = 1; seed <= 200; seed++) {
    const g = Generator(seed * 7919, cfg);
    // a rough tier ramp, as if played well
    g.setTier((row) => Math.max(0, Math.min(1, (row - 40) / 1000)));
    g.ensure(2400);
    let m = 1 << 3;
    for (let r = 1; r <= 2400; r++) {
      m = g.advance(g.row(r - 1).cells, g.row(r).cells, m);
      if (!m) { empty++; break; }
      if (g.row(r).pattern === "fallback") fallbacks++;
    }
    rows += 2400;
    for (const o of g.obstacles.values()) if (o.kind === "stone") stones++;
    rabbits += g.rabbitSpawns.length;
    for (const e of g.log) names[e.name] = (names[e.name] || 0) + 1;
  }
  console.log("generation: empty-route rows", empty, "| fallback rows", fallbacks, "| stones/100 rows", (stones / rows * 100).toFixed(1), "| rabbits/100 rows", (rabbits / rows * 100).toFixed(1));
  console.log("  late-run formation mix:", JSON.stringify(names));
  check(empty === 0, "a generated meadow had no survivable route");
  const a = Generator(42, cfg), b = Generator(42, cfg);
  a.ensure(900); b.ensure(900);
  let same = a.rabbitSpawns.length === b.rabbitSpawns.length;
  for (let r = -10; r <= 900 && same; r++) if (JSON.stringify(a.row(r).cells) !== JSON.stringify(b.row(r).cells)) same = false;
  console.log("determinism:", same ? "ok" : "MISMATCH");
  check(same, "same seed produced different meadows");
}

// ---- Bot players -----------------------------------------------------------
const blockedCells = (sim, withAlert) => {
  const set = new Set();
  for (const rb of sim.rabbits) {
    if (rb.fled) continue;
    const xs = [rb.x]; const ys = [rb.y];
    if (rb.hop) { xs.push(rb.hop.x1); ys.push(rb.hop.y1); }
    // a rabbit's body spans parts of two rows; treat the neighbouring row as occupied too
    for (let i = 0; i < xs.length; i++) for (let dr = -1; dr <= 1; dr++) set.add((Math.floor(ys[i]) + dr) + ":" + Math.floor(xs[i]));
    // an expert gives an alert rabbit's neighbours a wide berth
    if (withAlert && (rb.state === "alert" || rb.crossLeft > 0)) for (const d of [-1, 1]) set.add(Math.floor(rb.y) + ":" + (Math.floor(rb.x) + d));
  }
  return set;
};
function planner(sim, horizon, greed, withAlert) {
  const s = sim.s, gen = sim.gen, blk = blockedCells(sim, withAlert);
  const r0 = Math.floor(s.y + 0.15);
  const safe = (r, l) => { const c = gen.row(r).cells[l]; return !c.f && c.t !== CELL_OBST && !blk.has(r + ":" + l); };
  const V = [];
  for (let k = horizon; k >= 0; k--) {
    const row = gen.row(r0 + k);
    V[k] = [];
    for (let l = 0; l < LANES; l++) {
      if (!safe(r0 + k, l)) { V[k][l] = -1e6; continue; }
      let val = 0;
      for (const t of row.tufts) if (!t.cut && Math.abs(t.x - (l + 0.5)) < 0.46) val += t.v;
      val *= greed;
      let best = k === horizon ? 0 : -1e6;
      if (k < horizon) for (let d = -1; d <= 1; d++) {
        const l2 = l + d; if (l2 < 0 || l2 >= LANES) continue;
        const nrow = gen.row(r0 + k + 1);
        if (d !== 0 && (nrow.cells[l].t === CELL_OBST || row.cells[l2].t === CELL_OBST || (row.cells[l2].f && nrow.cells[l].f))) continue;
        best = Math.max(best, V[k + 1][l2] - (d !== 0 ? 0.3 : 0));
      }
      V[k][l] = val + best;
    }
  }
  return V;
}
// Would a lane change started now sweep through a flower, rock or rabbit? (judged by eye)
function sweepClear(sim, dir) {
  const s = sim.s, toX = s.lane + dir + 0.5;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const e = 1 - Math.pow(1 - p, 2.2), x = s.x + (toX - s.x) * e, y = s.y + 0.8 * p;
    for (let r = Math.floor(y) - 1; r <= Math.floor(y) + 1; r++) {
      const row = sim.gen.row(r); if (!row) continue;
      for (const f of row.flowers) if (!f.hit && Math.hypot(f.x - x, f.y - y) < 0.52) return false;
    }
    if (sim.obstacleAt(x, y, 0.05)) return false;
    for (const rb of sim.rabbits) if (!rb.fled && Math.hypot(rb.x - x, rb.y - y) < 0.55) return false;
  }
  return true;
}
function runBot(kind, seed, maxSeconds, inv) {
  const sim = Sim(Object.assign({}, cfg), seed);
  sim.start();
  const s = sim.s;
  const latency = { novice: 0.45, expert: 0.22, oracle: 0 }[kind] || 0;
  let t = 0, pending = null, swipes = 0, nextDecision = 0;
  let minWarn = 99;
  const rngA = (() => { let a = seed * 13 + 7; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  const lastPos = new Map();
  while (s.phase === "play" && t < maxSeconds) {
    t += DT / 1000;
    if (kind !== "passive" && !pending && t >= nextDecision && !s.change) {
      nextDecision = t + (kind === "novice" ? 0.15 : 0.04);
      const H = kind === "novice" ? 6 : 11;
      const V = planner(sim, H, kind === "novice" ? 0.3 : 1, kind !== "novice");
      const k = Math.max(1, Math.floor(s.y + 1.2) - Math.floor(s.y + 0.15));
      let bl = s.lane, bv = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l < 0 || l >= LANES) continue; const v = V[Math.min(k, H)][l] - (d ? 0.5 : 0); if (v > bv) { bv = v; bl = l; } }
      if (bl !== s.lane) {
        const dir = bl > s.lane ? 1 : -1;
        const careful = kind === "novice" ? rngA() < 0.6 : true;
        if (!careful || sweepClear(sim, dir)) {
          if (kind === "novice" && rngA() < 0.12) { /* hesitates and misses this one */ }
          else pending = { dir, at: t + latency };
        }
      }
    }
    if (pending && t >= pending.at) { sim.swipe(pending.dir); swipes++; pending = null; }
    const ev = sim.update(DT);
    if (inv) {
      // wildlife invariants
      for (const e of ev) if (e.type === "rabbitHop" && e.intoPath && !e.rb.fled) {
        const warn = (e.rb.hop.y1 - s.y) / Math.max(0.5, s.speed);
        minWarn = Math.min(minWarn, warn);
      }
      check(sim.rabbits.length <= 8, "too many rabbits");
      for (const rb of sim.rabbits) {
        const lp = lastPos.get(rb);
        if (lp) check(Math.hypot(rb.x - lp[0], rb.y - lp[1]) < 0.35, "rabbit teleported");
        lastPos.set(rb, [rb.x, rb.y]);
        if (rb.state !== "hop" && !rb.fled) {
          const l = Math.floor(rb.x), c = sim.gen.cell(Math.floor(rb.y), l);
          check(l >= 0 && l < LANES, "rabbit outside the meadow while not fleeing");
          check(!c || c.t !== CELL_OBST, "rabbit resting inside an obstacle");
          for (const o of sim.gen.obstacles.values()) if (Math.abs(o.y - rb.y) < 3) check(o.shape.type !== "circle" || Math.hypot(o.shape.cx - rb.x, o.shape.cy - rb.y) > o.shape.r, "rabbit inside a stone");
        }
      }
    }
  }
  const st = s.stats;
  return { kind, t, rows: Math.floor(s.y), score: s.score, hits: st.collisions, by: st.hitsBy, near: st.near, patches: st.patches, swipes,
    tier: s.tier, avgMult: st.multTime / Math.max(1, t), pathHops: st.pathHops, hops: st.rabbitHops, minWarn, log: st.collisionLog, stuck: st.stuckEvents, blocked: st.rabbitBlocked };
}
const N = 30;
for (const kind of ["passive", "novice", "expert", "oracle"]) {
  const res = [];
  for (let seed = 1; seed <= N; seed++) res.push(runBot(kind, seed * 101, kind === "expert" || kind === "oracle" ? 600 : 300, true));
  const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
  const med = (f) => { const v = res.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
  const by = {}; for (const r of res) for (const k in r.by) by[k] = (by[k] || 0) + r.by[k];
  const mins = res.reduce((a, r) => a + r.t, 0) / 60;
  console.log(kind.padEnd(8), "survive med", med((r) => r.t).toFixed(0) + "s", "| score med", med((r) => r.score), "| rows", avg((r) => r.rows).toFixed(0),
    "| tier", avg((r) => r.tier).toFixed(2), "| hits by", JSON.stringify(by), "| swipes/min", (res.reduce((a, r) => a + r.swipes, 0) / mins).toFixed(1),
    "| avgMult", avg((r) => r.avgMult).toFixed(2), "| rabbit hops into path/min", (res.reduce((a, r) => a + r.pathHops, 0) / mins).toFixed(1),
    "| min warning", Math.min(...res.map((r) => r.minWarn)).toFixed(2) + "s", "| stuck", res.reduce((a, r) => a + r.stuck, 0));
  if (kind === "expert" || kind === "oracle") {
    const pats = {};
    for (const r of res) for (const c of r.log) pats[c.kind + ":" + c.pattern] = (pats[c.kind + ":" + c.pattern] || 0) + 1;
    console.log("  collisions by hazard:formation", JSON.stringify(pats));
    const rabbitHits = res.flatMap((r) => r.log).filter((c) => c.kind === "rabbit").slice(0, 3);
    if (rabbitHits.length) console.log("  sample rabbit hits", JSON.stringify(rabbitHits));
  }
}

// ---- Hand-built scenarios ------------------------------------------------------
function blankSim(seedN) {
  const sim = Sim(Object.assign({}, cfg), seedN || 5);
  sim.start();
  for (let i = 0; i < 30; i++) sim.update(DT);
  // clear the meadow ahead so scenarios are controlled
  const s = sim.s;
  for (let r = Math.floor(s.y) - 2; r < Math.floor(s.y) + 40; r++) { const row = sim.gen.row(r); if (!row) continue; row.flowers.length = 0; for (const c of row.cells) { c.t = 0; c.f = null; c.o = 0; } }
  for (const [id, o] of sim.gen.obstacles) if (o.y > s.y - 3) sim.gen.obstacles.delete(id);
  sim.rabbits.length = 0; sim.gen.rabbitSpawns.length = 0;
  return sim;
}
function addRabbit(sim, x, y, profile, opts) {
  const rr = (() => { let a = 9; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  const rb = { id: 1, x, y, lane: Math.floor(x), profile, opts: opts || {}, rng: rr, state: "forage", t: 5, face: 0, hop: null, cool: 0, crossLeft: 0, crossDir: 0, plan: "",
    fled: false, near: false, nearT: -9, alertT: -9, landT: -9, hitT: -9, headT: 0, crossBudget: profile === "wanderer" ? 2 : 0 };
  sim.rabbits.push(rb); return rb;
}
function addStone(sim, x, y, size) {
  const id = 900000 + Math.floor(y * 10 + x);
  sim.gen.obstacles.set(id, { id, kind: "stone", x: Math.floor(x), y: Math.floor(y), w: 1, h: 1, size, near: false, hitT: -9, shape: { type: "circle", cx: x, cy: y, r: [0.27, 0.34, 0.42][size] } });
  sim.gen.cell(Math.floor(y), Math.floor(x)).t = CELL_OBST;
}
const run = (sim, secs, onEv) => { for (let i = 0; i < secs * 60 && sim.s.phase === "play"; i++) { const ev = sim.update(DT); if (onEv) for (const e of ev) onEv(e); } };
{
  // 1. A rabbit beside an open route reacts when the mower approaches (alert, then a hop) and never lands in the path too late.
  let sim = blankSim(), s = sim.s;
  const rb = addRabbit(sim, s.lane + 1.5, s.y + 9, "wanderer", { cross: true });
  const seen = []; let warn = 99;
  run(sim, 6, (e) => { if (e.rb === rb) seen.push(e.type); if (e.type === "rabbitHop" && e.intoPath) warn = Math.min(warn, (e.rb.hop.y1 - s.y) / s.speed); });
  console.log("scenario crossing rabbit: events", seen.slice(0, 6).join(","), "| warning when entering path", warn === 99 ? "never entered" : warn.toFixed(2) + "s", "| mower lives", s.lives);
  check(seen[0] === "rabbitAlert", "rabbit did not telegraph with an alert first");
  check(warn >= 0.8 || warn === 99, "rabbit landed in the path with too little warning");

  // 2. A rabbit directly in the path escapes sideways, away from where the mower is heading.
  sim = blankSim(); s = sim.s;
  const rb2 = addRabbit(sim, s.lane + 0.5, s.y + 5, "cautious");
  sim.swipe(-1); // mower heads left
  let hit = false; run(sim, 4, (e) => { if (e.type === "hit") hit = true; });
  console.log("scenario rabbit in path: escaped to lane", Math.floor(rb2.x), "(mower went to lane", s.lane + ") | collision", hit);
  check(!hit, "rabbit in the path was hit although the mower steered away");

  // 3. Edge escape: a rabbit at the meadow edge in the path dives into the hedge rather than getting stuck.
  sim = blankSim(); s = sim.s;
  while (s.lane > 0) { sim.swipe(-1); run(sim, 0.5); }
  const rb3 = addRabbit(sim, 0.5, s.y + 5, "cautious");
  sim.swipe(1);
  run(sim, 4);
  console.log("scenario edge escape: rabbit x", rb3.x.toFixed(2), "fled", rb3.fled, "removed", sim.rabbits.indexOf(rb3) < 0, "| lives", s.lives);

  // 4. Rabbit collision: one hit event, life lost, streak reset, rabbit hops away unhurt, recovery window.
  sim = blankSim(); s = sim.s; s.level = 2;
  const rb4 = addRabbit(sim, s.x, s.y + 1.6, "wanderer");
  rb4.cool = 99; rb4.state = "freeze"; rb4.t = 99; rb4.decided = true; // frozen flat: the mower must steer, and here it doesn't
  let hits = 0, lostLevel = -1; run(sim, 3, (e) => { if (e.type === "hit") { hits++; lostLevel = e.lostLevel; } });
  console.log("scenario rabbit collision: hits", hits, "| lives", s.lives, "| streak lost from x" + (lostLevel + 1), "-> x" + (s.level + 1), "| rabbit fled", rb4.fled, "dist", Math.hypot(rb4.x - s.x, rb4.y - s.y).toFixed(1));
  check(hits === 1 && s.lives === cfg.lives - 1 && rb4.fled, "rabbit collision did not resolve once");

  // 5. Stone collision: life lost once, the mower stops, steps aside and carries on; no second hit in recovery.
  sim = blankSim(); s = sim.s;
  addStone(sim, s.x, s.y + 2.5, 1);
  let sh = 0; const y0 = s.y; run(sim, 4, (e) => { if (e.type === "hit") sh++; });
  console.log("scenario stone collision: hits", sh, "| lives", s.lives, "| moved on", (s.y - y0).toFixed(1), "rows | now lane", s.lane, "| stuck", s.stats.stuckEvents);
  check(sh === 1 && s.y - y0 > 4 && s.stats.stuckEvents === 0, "stone collision did not recover cleanly");

  // 6. Two stones with a one-lane gap: driving straight through the gap is clean.
  sim = blankSim(); s = sim.s;
  addStone(sim, s.lane - 0.5 + 0.1, s.y + 3.5, 2); addStone(sim, s.lane + 1.5 - 0.1, s.y + 3.5, 2);
  let gh = 0; run(sim, 3, (e) => { if (e.type === "hit") gh++; });
  console.log("scenario narrow stone gap (boulders nudged in): hits", gh);
  check(gh === 0, "a one-lane stone gap was not traversable");

  // 7. Swipe toward a rock right beside the mower is held, then runs when clear (no impossible turn).
  sim = blankSim(); s = sim.s;
  addStone(sim, s.lane + 1.5, s.y + 0.2, 1);
  const l0 = s.lane; sim.swipe(1);
  const held = s.lane === l0 && !!s.queued;
  let ms = 0; while (s.lane === l0 && ms < 1500) { sim.update(DT); ms += DT; }
  console.log("scenario swipe beside a rock: held", held, "| ran after", Math.round(ms), "ms | hits", s.stats.collisions);

  // 8. Fence across four lanes: the mower bumps it once and steps around through the open side.
  sim = blankSim(); s = sim.s;
  while (s.lane > 1) { sim.swipe(-1); run(sim, 0.5); }
  const fy = Math.floor(s.y) + 3;
  sim.gen.obstacles.set(777, { id: 777, kind: "fence", x: 0, y: fy, w: 4, h: 1, near: false, hitT: -9, shape: { type: "rect", x0: 0.02, x1: 3.98, y0: fy + 0.32, y1: fy + 0.66 } });
  for (let l = 0; l < 4; l++) sim.gen.cell(fy, l).t = CELL_OBST;
  let fh = 0; run(sim, 5, (e) => { if (e.type === "hit") fh++; });
  console.log("scenario fence: hits", fh, "| got past", s.y > fy + 2, "in lane", s.lane, "| stuck", s.stats.stuckEvents);
  check(s.y > fy + 2 && fh === 1, "mower could not get past a fence cleanly");

  // 9. Double swipe chains, reversal returns, edge bump refused.
  sim = blankSim(); s = sim.s; const a0 = s.lane; sim.swipe(1); sim.swipe(1); sim.swipe(1); run(sim, 1.5);
  const chained = s.lane - a0;
  sim = blankSim(); s = sim.s; const b0 = s.lane; sim.swipe(1); sim.update(DT); sim.update(DT); sim.swipe(-1); run(sim, 1);
  console.log("scenario input: double swipe moved", chained, "lanes | reversal back home", s.lane === b0);

  // 10. Passive run ends exactly once with lives at zero.
  sim = Sim(Object.assign({}, cfg), 77); sim.start(); let overs = 0; run(sim, 200, (e) => { if (e.type === "over") overs++; });
  console.log("scenario passive run: over events", overs, "| lives", sim.s.lives, "| lasted", sim.s.time.toFixed(1), "s");
}

// ---- Long run: bounded memory and wildlife -------------------------------------
{
  const sim = Sim(Object.assign({}, cfg), 99);
  sim.start();
  const s = sim.s;
  let maxRows = 0, maxObs = 0, maxRab = 0;
  for (let i = 0; i < 60 * 60 * 20; i++) {
    s.invuln = 1; s.lives = 3;
    if (!s.change && i % 5 === 0) {
      const V = planner(sim, 8, 1, true);
      let bl = s.lane, bv = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l < 0 || l >= LANES) continue; if (V[1][l] > bv) { bv = V[1][l]; bl = l; } }
      if (bl !== s.lane) sim.swipe(bl > s.lane ? 1 : -1);
    }
    sim.update(DT);
    if (i % 600 === 0) { maxRows = Math.max(maxRows, sim.gen.rows.size); maxObs = Math.max(maxObs, sim.gen.obstacles.size); maxRab = Math.max(maxRab, sim.rabbits.length); }
  }
  console.log("long run (20 min): rows", Math.floor(s.y), "| max live rows", maxRows, "| max obstacles", maxObs, "| max rabbits", maxRab, "| pending spawns", sim.gen.rabbitSpawns.length, "| stuck", s.stats.stuckEvents);
  check(maxRows < 200 && maxObs < 60 && maxRab <= 8 && sim.gen.rabbitSpawns.length < 40, "unbounded growth in a long run");
}

console.log(fails.length ? "FAILURES:\n  " + [...new Set(fails)].join("\n  ") : "all checks passed");
