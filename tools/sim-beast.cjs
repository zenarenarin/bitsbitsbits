#!/usr/bin/env node
// Headless movement check for Beast: runs the real Explorer controller
// against the real creature anatomy (no rendering) and verifies that
//   - the explorer never sinks into the body (both collision circles),
//   - positions/velocities stay finite,
//   - a simple climbing bot (hold uphill, jump when stalled) makes progress,
//   - walking downhill stays grounded on the fur instead of skipping off.
//   node tools/sim-beast.cjs [seconds]
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "bits", "beast", "main.js"), "utf8");
let api = null;
const sandbox = { window: {}, console, Math, performance: { now: () => 0 }, globalThis: {} };
sandbox.globalThis.__dwTestHook = (x) => { api = x; };
vm.runInNewContext(src, sandbox);
if (!api) throw new Error("test hook not reached");

const { buildWorld, Explorer, PHYS, WORLD_SEED } = api;
const world = buildWorld(WORLD_SEED);
const seconds = Number(process.argv[2] || 60);
const dt = 1 / 120;
let failures = 0;

function run(name, spot, bot) {
  const ex = new Explorer(world.layers.play, spot, world.props.mushrooms.map((m) => m.cap));
  const input = { dir: 0, run: false, jumpPressed: false };
  let worstFeet = 0, worstBody = 0, grounded = 0, jumps = 0, lands = 0, falls = 0, maxY = ex.y, minY = ex.y;
  const startY = ex.y;
  const ctx = { stall: 0, lastX: ex.x };
  for (let i = 0; i < seconds / dt; i++) {
    bot(ex, input, ctx, i * dt);
    ex.step(dt, input);
    input.jumpPressed = false;
    for (const e of ex.events) {
      if (e.type === "launch") jumps++;
      if (e.type === "land") lands++;
      if (e.type === "fell") falls++;
    }
    ex.events.length = 0;
    if (![ex.x, ex.y, ex.vx, ex.vy].every(Number.isFinite)) { console.log(`  ${name}: non-finite state at t=${(i * dt).toFixed(2)}`); failures++; return; }
    worstFeet = Math.min(worstFeet, ex.sd(ex.x, ex.y + PHYS.feetR) - PHYS.feetR);
    worstBody = Math.min(worstBody, ex.sd(ex.x, ex.y + PHYS.bodyY) - PHYS.bodyR);
    if (ex.grounded) grounded++;
    maxY = Math.max(maxY, ex.y); minY = Math.min(minY, ex.y);
  }
  const ok = worstFeet > -0.05 && worstBody > -0.05;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: climbed ${(maxY - startY).toFixed(1)} m (min ${(minY - startY).toFixed(1)}), ` +
    `grounded ${((100 * grounded) / (seconds / dt)).toFixed(0)}%, jumps ${jumps}, landings ${lands}, falls ${falls}, ` +
    `worst penetration feet ${worstFeet.toFixed(3)} body ${worstBody.toFixed(3)}`);
  return { maxY, startY, grounded: grounded / (seconds / dt), falls };
}

// Climber: hold uphill (left), jump whenever horizontal progress stalls.
const climber = (runFast) => (ex, input, c) => {
  input.dir = -1;
  input.run = runFast;
  // Stalled = grounded and less than 10 cm of progress in the last 0.3 s.
  c.hist = c.hist || [];
  c.hist.push(ex.x);
  if (c.hist.length > 36) c.hist.shift();
  if (ex.grounded && c.hist.length === 36 && Math.abs(c.hist[0] - ex.x) < 0.1) { input.jumpPressed = true; c.hist.length = 0; }
};
// Wanderer: alternate directions and random jumps (deterministic).
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const wanderer = (ex, input, c, t) => {
  input.dir = Math.floor(t / 2.5) % 2 ? 1 : -1;
  input.run = Math.floor(t / 4) % 2 === 1;
  if (rand() < 0.015) input.jumpPressed = true;
};
const downhill = (ex, input) => { input.dir = 1; input.run = false; };

const spots = world.explorerSpots;
const r1 = run("careful climb from the back", spots.gameplay, climber(false));
run("fast climb from the back", spots.gameplay, climber(true));
const r3 = run("careful climb from the base", spots.base, climber(false));
run("wander + random jumps on the back", spots.gameplay, wanderer);
const r5 = run("walk downhill from the back", spots.gameplay, downhill);
if (r1 && r1.maxY - r1.startY < 8) { console.log("FAIL climber made too little progress from the back"); failures++; }
if (r3 && r3.maxY - r3.startY < 8) { console.log("FAIL climber made too little progress from the base"); failures++; }

// ---- Alertness balance ------------------------------------------------------
// Drives the same controller with the real Alertness model and reports how
// quickly the beast stirs/wakes for different ways of climbing.
const { Alertness } = api;
function alertRun(name, spot, script, secs) {
  const ex = new Explorer(world.layers.play, spot, world.props.mushrooms.map((m) => m.cap));
  const al = new Alertness(world);
  const input = { dir: 0, run: false, jumpPressed: false };
  let firstDisturbed = null, firstStirring = null, woke = null, peak = 0;
  const c = {};
  for (let i = 0; i < secs / dt; i++) {
    const t = i * dt;
    script(ex, input, c, t);
    ex.step(dt, input);
    input.jumpPressed = false;
    al.update(dt, ex, input);
    ex.events.length = 0;
    peak = Math.max(peak, al.level);
    if (al.state === "disturbed" && firstDisturbed === null) firstDisturbed = t;
    if (al.state === "stirring" && firstStirring === null) firstStirring = t;
    if (al.state === "awake") { woke = t; break; }
  }
  const f = (v) => (v === null ? "never" : `${v.toFixed(0)} s`);
  console.log(`  ${name}: disturbed ${f(firstDisturbed)}, stirring ${f(firstStirring)}, awake ${f(woke)}, ` +
    `end level ${al.level.toFixed(2)} (floor ${al.floor.toFixed(2)}), climbed ${(ex.y - spot.y).toFixed(0)} m`);
  return { woke, firstStirring, level: al.level, floor: al.floor, peak };
}
console.log("alertness:");
const careful = alertRun("careful climb, never pausing (120 s)", spots.base, climber(false), 120);
const fast = alertRun("fast climb, never pausing (120 s)", spots.base, climber(true), 120);
const paced = alertRun("fast climb with 6 s pauses every 10 s (120 s)", spots.base, (ex, input, c, t) => {
  if (t % 16 < 10) climber(true)(ex, input, c); else { input.dir = 0; input.run = false; }
}, 120);
const settle = alertRun("run 12 s, then stand still 40 s", spots.base, (ex, input, c, t) => {
  if (t < 12) climber(true)(ex, input, c); else { input.dir = 0; input.run = false; }
}, 52);
const leaps = alertRun("jumping constantly (60 s)", spots.gameplay, (ex, input) => { input.dir = 0; input.jumpPressed = ex.grounded; }, 60);
const expect = (ok, msg) => { if (!ok) { console.log("FAIL " + msg); failures++; } };
expect(careful.woke === null, "careful climbing alone should not wake the beast within 2 minutes");
expect(fast.woke !== null && fast.woke > 15, "nonstop fast climbing should wake it, but not within 15 s");
expect(paced.woke === null || paced.woke > fast.woke + 10, "pausing should buy real time");
expect(settle.level < settle.peak - 0.15 && settle.level > 0, "stillness should settle it, but not to zero");
expect(leaps.woke !== null, "constant jumping should wake it");

// ---- Discovery: Dream Seeds, Quiet Streak, the Creature's Memory -------------
const { DreamSeeds, QuietStreak, Memory, makeStore } = api;
function discoveryRun(name, spot, script, secs, store) {
  const ex = new Explorer(world.layers.play, spot, world.props.mushrooms.map((m) => m.cap));
  const al = new Alertness(world);
  const seeds = new DreamSeeds(world);
  const quiet = new QuietStreak();
  const mem = new Memory(store, world);
  const input = { dir: 0, run: false, jumpPressed: false };
  let bloomed = 0, breaks = 0, lastBroken = null;
  const c = {};
  for (let i = 0; i < secs / dt; i++) {
    script(ex, input, c, i * dt);
    ex.step(dt, input);
    input.jumpPressed = false;
    al.update(dt, ex, input);
    seeds.update(dt, ex);
    quiet.update(dt, ex, al);
    for (const b of quiet.blooms) { seeds.bloom(ex.x, ex.y, b.n); bloomed += b.n; }
    quiet.blooms.length = 0;
    if (quiet.broken !== lastBroken) { breaks++; lastBroken = quiet.broken; }
    mem.observe(dt, ex, al, seeds, quiet);
    ex.events.length = 0;
    if (al.state === "awake") break;
  }
  const res = mem.endRun(ex.y, seeds.count);
  console.log(`  ${name}: ${seeds.count} seeds (${JSON.stringify(seeds.found)}, ${bloomed} from quiet blooms), ` +
    `quiet best ${quiet.best.toFixed(0)} m, ${breaks} breaks, remembered [${res.newly.map((e) => e.id).join(", ")}]`);
  return { seeds, quiet, bloomed, breaks, res, mem };
}
console.log("discovery:");
const disk = {};
const store = { get: (k) => (k in disk ? JSON.parse(disk[k]) : null), set: (k, v) => { disk[k] = JSON.stringify(v); } };
const calm = discoveryRun("careful climb from the base (120 s)", spots.base, climber(false), 120, store);
const loud = discoveryRun("fast climb from the base (120 s)", spots.base, climber(true), 120, store);
expect(calm.seeds.found.common >= 5, "a careful climb along the route should gather common seeds");
expect(calm.quiet.best >= 80 && calm.bloomed >= 6, "a careful climb should reach the top Quiet Streak tier");
expect(loud.quiet.best < 15 && loud.bloomed === 0, "running should never build a Quiet Streak");
expect(calm.res.newly.some((e) => e.id === "seed"), "the first seed should be remembered");
const reloaded = new Memory(store, world);
expect(reloaded.count === loud.mem.count && reloaded.count === calm.res.newly.length + loud.res.newly.length && reloaded.data.runs === 2 && reloaded.data.seeds === calm.seeds.count + loud.seeds.count,
  "the Memory should persist discoveries, runs and seeds across a reload");
expect(loud.res.newly.every((e) => !calm.res.newly.includes(e)), "a discovery is only new once");
const refusing = { get: () => { throw new Error("no storage"); }, set: () => { throw new Error("no storage"); } };
const broken = new Memory(makeStore({ storage: refusing }), world);
broken.discover("seed");
broken.save();
expect(broken.count === 1 && new Memory(makeStore({}), world).count === 0, "unavailable storage should fall back to the session");
console.log(failures ? `${failures} problem(s)` : "all movement, alertness and discovery checks passed");
process.exit(failures ? 1 : 0);
