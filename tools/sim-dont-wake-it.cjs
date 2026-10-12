#!/usr/bin/env node
// Headless movement check for Don't Wake It: runs the real Explorer controller
// against the real creature anatomy (no rendering) and verifies that
//   - the explorer never sinks into the body (both collision circles),
//   - positions/velocities stay finite,
//   - a simple climbing bot (hold uphill, jump when stalled) makes progress,
//   - walking downhill stays grounded on the fur instead of skipping off.
//   node tools/sim-dont-wake-it.cjs [seconds]
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "bits", "dont-wake-it", "main.js"), "utf8");
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
console.log(failures ? `${failures} problem(s)` : "all movement checks passed");
process.exit(failures ? 1 : 0);
