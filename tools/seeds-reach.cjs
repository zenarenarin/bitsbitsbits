#!/usr/bin/env node
// Reachability check for Beast's Dream Seeds and mushroom caps. First a
// climbing bot walks the real route (from the base and from the back, careful
// and running, jumping when stalled) to learn where the climb actually goes.
// Then, for every cap and seed, it tries the real Explorer controller from
// nearby standing spots on that route and from caps already proven reachable
// - walking, walking jumps and running jumps - and reports the easiest way it
// was reached. Any seed that cannot be reached from the climb fails.
//   node tools/seeds-reach.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "bits", "beast", "main.js"), "utf8");
let api = null;
const sandbox = { window: {}, console, Math, performance: { now: () => 0 }, globalThis: {} };
sandbox.globalThis.__dwTestHook = (x) => { api = x; };
vm.runInNewContext(src, sandbox);
const { buildWorld, Explorer, WORLD_SEED, seedTouches, capTop } = api;
const world = buildWorld(WORLD_SEED);
const play = world.layers.play;
const caps = world.props.mushrooms.map((m) => m.cap);
const dt = 1 / 120;
// --above Y: only check seeds and caps higher than Y (quick iteration).
const above = process.argv.includes("--above") ? Number(process.argv[process.argv.indexOf("--above") + 1]) : -Infinity;

// Where the climb really goes.
const route = [];
for (const spot of [world.explorerSpots.base, world.explorerSpots.gameplay]) {
  for (const run of [false, true]) {
    const ex = new Explorer(play, spot, caps);
    const input = { dir: -1, run, jumpPressed: false };
    const hist = [];
    for (let i = 0; i < 360 / dt; i++) {
      hist.push(ex.x);
      if (hist.length > 36) hist.shift();
      input.jumpPressed = ex.grounded && hist.length === 36 && Math.abs(hist[0] - ex.x) < 0.1;
      if (input.jumpPressed) hist.length = 0;
      ex.step(dt, input);
      ex.events.length = 0;
      if (i % 12 === 0 && ex.grounded && !ex.onCap) route.push([ex.x, ex.y]);
    }
  }
}
const topY = Math.max(...route.map((p) => p[1]));
console.log(`route: ${route.length} points, from ${Math.min(...route.map((p) => p[1])).toFixed(0)} m up to ${topY.toFixed(0)} m`);
const onRoute = (x, y) => route.some((p) => Math.abs(p[0] - x) < 1 && Math.abs(p[1] - y) < 1);
const reachedCaps = new Set();

function standSpots(x0, y0) {
  const out = [];
  for (let x = x0 - 6; x <= x0 + 6; x += 0.75) {
    const y = play.surfaceBelow(x, y0 + 9, y0 - 9);
    if (y === null) continue;
    const e = 0.05;
    const gx = play.sdAt(x + e, y + 0.02) - play.sdAt(x - e, y + 0.02), gy = play.sdAt(x, y + 0.02 + e) - play.sdAt(x, y + 0.02 - e);
    if (gy / (Math.hypot(gx, gy) || 1) > 0.55 && onRoute(x, y)) out.push({ x, y, from: "ground" });
  }
  for (const c of caps) {
    if (!reachedCaps.has(c)) continue;
    const top = c.y + c.b;
    if (Math.abs(c.x - x0) < 7 && Math.abs(top - y0) < 7) out.push({ x: c.x, y: capTop(c, c.x), from: "cap" });
  }
  return out;
}

function attempt(spot, dir, run, jumpAt, hit, tx, ty) {
  const ex = new Explorer(play, { x: spot.x, y: spot.y, facing: dir }, caps);
  const input = { dir, run, jumpPressed: false };
  for (let i = 0; i < 2.6 / dt; i++) {
    const t = i * dt;
    input.jumpPressed = jumpAt !== null && Math.abs(t - jumpAt) < dt / 2;
    ex.step(dt, input);
    ex.events.length = 0;
    if (hit(ex)) return true;
    if (ex.y < ty - 5 || Math.abs(ex.x - tx) > 8) return false; // fell away or wandered off
  }
  return false;
}

const plans = [];
for (const run of [false, true]) for (const jumpAt of [null, 0, 0.12, 0.3, 0.5, 0.8]) plans.push({ run, jumpAt });
const label = (p, spot) => `${p.jumpAt === null ? "walk" : p.run ? "running jump" : "jump"}${spot.from === "cap" ? " from a cap" : ""}`;

function reach(x, y, hit) {
  for (const p of plans) {
    for (const spot of standSpots(x, y)) {
      if (Math.hypot(spot.x - x, spot.y - y) < 0.3) continue; // not from on top of it
      for (const dir of [-1, 1]) if (attempt(spot, dir, p.run, p.jumpAt, hit, x, y)) return label(p, spot);
    }
  }
  return null;
}

let fail = 0;
const counts = {};
// Caps, repeatedly, so a chain's second cap can be reached from its first.
const capHow = new Map();
for (let pass = 0; pass < 3; pass++) {
  for (const c of caps) {
    if (c.y < above || reachedCaps.has(c)) continue;
    const how = reach(c.x, c.y + c.b, (ex) => ex.onCap === c);
    if (how) { reachedCaps.add(c); capHow.set(c, how); }
  }
}
for (const c of caps) {
  if (c.y < above) continue;
  const how = capHow.get(c);
  console.log(`${how ? "ok  " : "FAIL"} cap at (${c.x.toFixed(1)}, ${(c.y + c.b).toFixed(1)}): ${how || "unreachable from the climb"}`);
  if (!how) fail++;
}
for (const s of world.seeds) {
  if (s.y < above) continue;
  const how = reach(s.x, s.y, (ex) => seedTouches(s, ex));
  counts[s.kind] = (counts[s.kind] || 0) + 1;
  if (!how || s.kind !== "common") console.log(`${how ? "ok  " : "FAIL"} ${s.kind} seed at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}): ${how || "unreachable from the climb"}`);
  if (!how) fail++;
}
console.log(`seeds: ${JSON.stringify(counts)}`);
console.log(fail ? `${fail} unreachable` : "every seed and cap is reachable");
process.exit(fail ? 1 : 0);
