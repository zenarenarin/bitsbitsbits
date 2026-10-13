// Scripted playtests over full generated runs (same physics as the game).
//  one-world players: plan jumps for ONE world only (the other world ignored)
//  dual player: aims for each shared window's centre with human timing noise
// If the dual-world mechanic matters, one-world players die quickly while the
// dual player's survival depends on timing skill and declines with difficulty.
// Run: node bits/copycat/dev/playtest.mjs [runs] [noiseMs]
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "main.js"), "utf8");
const window = { __COPYCAT_TEST__: {} };
vm.runInNewContext(src, { window, performance, console, Math });
const core = window.__copycatCore;
const cfg = { vStart: 4.2, vMax: 6.2, jumpHeight: 1.55, airTime: 0.62, coyote: 0.08, buffer: 0.12, winStart: 0.28, winEnd: 0.13 };
const P = core.makePhys(cfg);
const RAMP = [[0, 0], [8, 0.12], [20, 0.36], [40, 0.66], [70, 0.9], [110, 1]];
const ramp = (l) => { for (let i = 1; i < RAMP.length; i++) { const a = RAMP[i - 1], b = RAMP[i]; if (l <= b[0]) return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]); } return 1; };
const RUNS = +(process.argv[2] || 40), NOISE = +(process.argv[3] || 60) / 1000;
const solver = core.makeSolver(P);
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

function flatClone(w) { const f = core.newWorld(); f.blocks = w.blocks.map((b) => ({ ...b })); f.killY = -99; return f; }
function play(policy, runSeed, maxChallenges = 120) {
  const gen = core.createGenerator(P, cfg, ramp, runSeed, false);
  gen.startSegment();
  const segs = [];
  let challenges = 0;
  const sim = core.newSim(3, cfg.vStart, 0, 0);
  for (;;) {
    let seg = null;
    while (!seg) seg = gen.tryNext();
    segs.push(seg);
    sim.v = seg.v;
    let taps;
    if (policy === "dual") {
      // aim at each validated window centre; later taps re-aimed from the actual state
      taps = [];
      for (const t of seg.solution) taps.push(seg.x0 + t.step * P.dt * seg.v + gauss() * NOISE * seg.v);
    } else {
      // plan for one world only: the other world is replaced by its bare floor
      const w = policy === "original" ? 0 : 1;
      const W = w === 0 ? [seg.w[0], flatClone(seg.w[1])] : [flatClone(seg.w[0]), seg.w[1]];
      // aim at the centre of that one world's own safe window, like a player would
      const s0 = core.cloneSim(sim);
      const res = solver.analyze(W, s0, seg.x1, 0, 400000);
      taps = res.ok ? res.taps.map((t) => sim.x + (t.step - sim.steps) * P.dt * seg.v + gauss() * NOISE * seg.v) : [];
    }
    let ti = 0;
    while (sim.x < seg.x1) {
      const tap = ti < taps.length && sim.x >= taps[ti];
      if (tap) ti++;
      core.stepSim(sim, seg.w, P, tap);
      if (sim.c[0].dead || sim.c[1].dead) {
        return { challenges, cause: sim.c[0].dead ? "original:" + sim.c[0].dead : "copy:" + sim.c[1].dead, fam: seg.fams.join("+"), d: seg.d };
      }
    }
    if (seg.kind === "challenge") challenges++;
    if (challenges >= maxChallenges) return { challenges, cause: "survived", fam: "", d: seg.d };
  }
}
for (const policy of ["original", "copy", "dual"]) {
  const res = [];
  for (let r = 0; r < RUNS; r++) res.push(play(policy, 5000 + r * 31));
  const ch = res.map((r) => r.challenges).sort((a, b) => a - b);
  const causes = {};
  for (const r of res) { const k = r.cause.split(":")[1] || r.cause; causes[k] = (causes[k] || 0) + 1; }
  const fams = {};
  for (const r of res) if (r.fam) for (const f of r.fam.split("+")) fams[f] = (fams[f] || 0) + 1;
  console.log(`${policy.padEnd(9)} challenges cleared: median ${ch[ch.length >> 1]}, p10 ${ch[Math.floor(ch.length * 0.1)]}, p90 ${ch[Math.floor(ch.length * 0.9)]}, max ${ch[ch.length - 1]} | causes ${JSON.stringify(causes)} | fatal pairings ${JSON.stringify(fams)}`);
}
