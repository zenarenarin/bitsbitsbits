// Pacing report: how soon and how often a run demands decisions, compared across builds.
// usage: node dev/pacing.js [main.js] [label]
// A "forced decision" is a hazard (flower, stone, terrain, rabbit) entering the 4 rows ahead of
// the mower in its own lane: the player must act. Rabbit "route changes" are hops that land in
// the mower's path ahead.
const fs = require("fs"), path = require("path");
const file = process.argv[2] || path.join(__dirname, "..", "main.js");
const label = process.argv[3] || path.basename(file);
global.window = { __LM_TEST__: true };
new Function("window", fs.readFileSync(file, "utf8"))(global.window);
const { Sim, DEFAULTS, LANES, CELL_OBST } = window.__LM_CORE__;
const DT = 1000 / 60;

function planner(sim, H) {
  const s = sim.s, gen = sim.gen, blk = new Set();
  for (const rb of sim.rabbits || []) if (!rb.fled) {
    blk.add(Math.floor(rb.y) + ":" + Math.floor(rb.x));
    if (rb.hop) blk.add(Math.floor(rb.hop.y1) + ":" + Math.floor(rb.hop.x1));
    if (rb.state === "alert" || rb.crossLeft > 0) for (const d of [-1, 1]) blk.add(Math.floor(rb.y) + ":" + (Math.floor(rb.x) + d));
  }
  const r0 = Math.floor(s.y + 0.15), V = [];
  for (let k = H; k >= 0; k--) {
    const row = gen.row(r0 + k); V[k] = [];
    for (let l = 0; l < LANES; l++) {
      const c = row.cells[l];
      if (c.f || c.t === CELL_OBST || blk.has((r0 + k) + ":" + l)) { V[k][l] = -1e6; continue; }
      let v = 0; for (const t of row.tufts) if (!t.cut && Math.abs(t.x - l - 0.5) < 0.46) v += t.v;
      let b = k === H ? 0 : -1e6;
      if (k < H) for (let d = -1; d <= 1; d++) {
        const l2 = l + d; if (l2 < 0 || l2 >= LANES) continue;
        const n = gen.row(r0 + k + 1);
        if (d && (n.cells[l].t === CELL_OBST || row.cells[l2].t === CELL_OBST || (row.cells[l2].f && n.cells[l].f))) continue;
        b = Math.max(b, V[k + 1][l2] - (d ? 0.3 : 0));
      }
      V[k][l] = v + b;
    }
  }
  return V;
}
function sweepClear(sim, dir) {
  const s = sim.s, toX = s.lane + dir + 0.5;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const e = 1 - Math.pow(1 - p, 2.2), x = s.x + (toX - s.x) * e, y = s.y + 0.8 * p;
    for (let r = Math.floor(y) - 1; r <= Math.floor(y) + 1; r++) { const row = sim.gen.row(r); if (row) for (const f of row.flowers) if (!f.hit && Math.hypot(f.x - x, f.y - y) < 0.52) return false; }
    if (sim.obstacleAt && sim.obstacleAt(x, y, 0.05)) return false;
    for (const rb of sim.rabbits || []) if (!rb.fled && Math.hypot(rb.x - x, rb.y - y) < 0.55) return false;
  }
  return true;
}
const WIN = [[0, 5], [5, 20], [20, 45], [45, 90], [90, 150]];
function run(kind, seed) {
  const sim = Sim(Object.assign({}, DEFAULTS), seed);
  sim.start();
  const s = sim.s, latency = kind === "expert" ? 0.22 : 0.4;
  let t = 0, pending = null, next = 0;
  const seen = new Set(), forced = [], swipes = [], rabbitRoute = [], speedAt = {}, tierAt = {};
  let firstRabbitNear = -1;
  while (s.phase === "play" && t < 150) {
    t += DT / 1000;
    // forced decisions: hazards newly within 4 rows in the mower's lane
    for (let r = Math.floor(s.y) + 1; r <= Math.floor(s.y) + 4; r++) {
      const c = sim.gen.cell(r, s.lane);
      if (c && (c.f || c.t === CELL_OBST)) { const key = r + ":" + s.lane; if (!seen.has(key)) { seen.add(key); forced.push(t); } }
    }
    for (const rb of sim.rabbits || []) {
      if (rb.fled) continue;
      const ahead = rb.y - s.y;
      if (ahead > 0 && ahead < 4 && Math.floor(rb.x) === s.lane) { const key = "rb" + rb.id + ":" + Math.floor(rb.y); if (!seen.has(key)) { seen.add(key); forced.push(t); } }
      if (firstRabbitNear < 0 && ahead > 0 && ahead < 7 && Math.abs(rb.x - s.x) < 2.5) firstRabbitNear = t;
    }
    if (!pending && t >= next && !s.change) {
      next = t + (kind === "expert" ? 0.04 : 0.12);
      const V = planner(sim, kind === "expert" ? 11 : 7);
      const k = Math.max(1, Math.floor(s.y + 1.2) - Math.floor(s.y + 0.15));
      let bl = s.lane, bv = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l < 0 || l >= LANES) continue; const v = V[Math.min(k, V.length - 1)][l] - (d ? 0.5 : 0); if (v > bv) { bv = v; bl = l; } }
      if (bl !== s.lane && sweepClear(sim, bl > s.lane ? 1 : -1)) pending = { dir: bl > s.lane ? 1 : -1, at: t + latency };
    }
    if (pending && t >= pending.at) { sim.swipe(pending.dir); swipes.push(t); pending = null; }
    const ev = sim.update(DT);
    for (const e of ev) if (e.type === "rabbitHop" && e.intoPath && !e.rb.fled) rabbitRoute.push(t);
    for (const mark of [15, 30, 60]) if (speedAt[mark] === undefined && t >= mark) { speedAt[mark] = s.speed; tierAt[mark] = s.tier || 0; }
  }
  return { t, score: s.score, forced, swipes, rabbitRoute, firstRabbitNear, speedAt, tierAt, hits: s.stats.collisions, firstHit: s.stats.firstHitT, hitsBy: s.stats.hitsBy || {} };
}
const N = 30, out = {};
for (const kind of ["expert", "novice"]) {
  const res = []; for (let i = 1; i <= N; i++) res.push(run(kind, i * 131));
  const med = (a) => { const v = a.filter((x) => x >= 0).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : -1; };
  const perMin = (key, a, b) => { let n = 0, time = 0; for (const r of res) { if (r.t <= a) continue; time += Math.min(r.t, b) - a; n += r[key].filter((x) => x >= a && x < b).length; } return time ? (n / time * 60) : 0; };
  out[kind] = {
    survivalMed: med(res.map((r) => r.t)).toFixed(0) + "s", scoreMed: med(res.map((r) => r.score)),
    firstForced: med(res.map((r) => (r.forced[0] === undefined ? -1 : r.forced[0]))).toFixed(1) + "s",
    firstSwipe: med(res.map((r) => (r.swipes[0] === undefined ? -1 : r.swipes[0]))).toFixed(1) + "s",
    firstRabbitNear: med(res.map((r) => r.firstRabbitNear)).toFixed(1) + "s",
    firstRabbitRoute: med(res.map((r) => (r.rabbitRoute[0] === undefined ? 999 : r.rabbitRoute[0]))).toFixed(1) + "s",
    firstHit: med(res.map((r) => r.firstHit)).toFixed(1) + "s",
    forcedPerMin: WIN.map(([a, b]) => a + "-" + b + "s:" + perMin("forced", a, b).toFixed(0)).join(" "),
    swipesPerMin: WIN.map(([a, b]) => a + "-" + b + "s:" + perMin("swipes", a, b).toFixed(0)).join(" "),
    rabbitRoutePerMin: WIN.map(([a, b]) => a + "-" + b + "s:" + perMin("rabbitRoute", a, b).toFixed(1)).join(" "),
    speed: [15, 30, 60].map((m) => m + "s:" + (med(res.map((r) => (r.speedAt[m] === undefined ? -1 : r.speedAt[m]))).toFixed(2))).join(" "),
    tier: [15, 30, 60].map((m) => m + "s:" + (med(res.map((r) => (r.tierAt[m] === undefined ? -1 : r.tierAt[m]))).toFixed(2))).join(" "),
    hitsBy: res.reduce((a, r) => { for (const k in r.hitsBy) a[k] = (a[k] || 0) + r.hitsBy[k]; return a; }, {})
  };
}
console.log("== " + label);
for (const k in out) { console.log(k); for (const f in out[k]) console.log("   " + f.padEnd(18) + (typeof out[k][f] === "object" ? JSON.stringify(out[k][f]) : out[k][f])); }
