// Gameplay audit. Generates several runs exactly as the game does and reports,
// per challenge family and per difficulty stage:
//  - conflict: seconds of take-offs that keep one world safe but doom the
//    other (the smaller of the two worlds) — 0 means one world is redundant
//  - window: width of the shared safe take-off window
//  - preview: time from the first hazard entering view to the window opening
//  - pacing/repetition: speed, beats per challenge, repeated pairings
// Run: node bits/copycat/dev/audit.mjs [runs] [segmentsPerRun]
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
const RUNS = +(process.argv[2] || 4), SEGS = +(process.argv[3] || 160);
// camera: the characters sit at 22% of the panel; 0.78 of the view is ahead
const ahead = (v) => Math.max(7.8, Math.min(11, 8.2 + (v - 4.2))) * 0.78;

const rows = [], chall = [];
let rests = 0, fallbacks = 0;
for (let run = 0; run < RUNS; run++) {
  const gen = core.createGenerator(P, cfg, ramp, 1000 + run * 77, run === 0);
  gen.startSegment();
  let level = 0, prev = null;
  for (let n = 0; n < SEGS; n++) {
    let seg = null;
    while (!seg) seg = gen.tryNext();
    if (seg.kind !== "challenge") { rests++; continue; }
    level++;
    chall.push({ level, fams: seg.fams.join("+") || "authored", repeat: prev === seg.fams.join("+"), v: seg.v, beats: seg.fams.length || 1, len: seg.x1 - seg.x0 });
    prev = seg.fams.join("+");
    const hazards = [0, 1].flatMap((w) => [...seg.w[w].spikes, ...seg.w[w].ceils, ...seg.w[w].pistons, ...seg.w[w].gates, ...seg.w[w].plates].map((o) => o.x0))
      .concat([0, 1].flatMap((w) => seg.w[w].blocks.slice(0, -1).map((b) => b.x1)));
    seg.solution.forEach((t, k) => {
      const loX = seg.x0 + t.lo * P.dt * seg.v;
      const firstHaz = Math.min(...hazards.filter((h) => h > (k ? seg.solution[k - 1].x : seg.x0) - 0.5));
      rows.push({ level, d: seg.d, v: seg.v, fam: seg.fams.length ? seg.fams[Math.min(k, seg.fams.length - 1)] : "authored",
        conflict: t.conflict, trapA: t.trapA, trapB: t.trapB, width: t.width, preview: (loX - (firstHaz - ahead(seg.v))) / seg.v });
    });
  }
}
const avg = (a, f) => a.reduce((m, r) => m + f(r), 0) / Math.max(1, a.length);
const q = (a, f, p) => { const s = a.map(f).sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };
const pct = (a, f) => (100 * a.filter(f).length / Math.max(1, a.length)).toFixed(0) + "%";
console.log(`challenges ${chall.length}, beats ${rows.length}, rest/reward segments ${rests}`);
console.log("\nfamily        beats  conflict p10/p50   one-sided(<0.05s)  window p50  preview p10");
for (const f of [...new Set(rows.map((r) => r.fam))]) {
  const r = rows.filter((x) => x.fam === f);
  console.log(f.padEnd(12), String(r.length).padStart(6), (q(r, (x) => x.conflict, 0.1).toFixed(2) + "/" + q(r, (x) => x.conflict, 0.5).toFixed(2)).padStart(17),
    pct(r, (x) => x.conflict < 0.05).padStart(19), q(r, (x) => x.width, 0.5).toFixed(2).padStart(11), q(r, (x) => x.preview, 0.1).toFixed(2).padStart(12));
}
console.log("\nstage           speed  beats/chal  window p50  conflict p50  one-sided  preview p10  new pairings  repeats");
const seen = new Set();
for (const [a, b] of [[0, 8], [8, 20], [20, 40], [40, 70], [70, 999]]) {
  const r = rows.filter((x) => x.level > a && x.level <= b), c = chall.filter((x) => x.level > a && x.level <= b);
  if (!r.length) continue;
  let fresh = 0;
  for (const x of c) if (!seen.has(x.fams)) { seen.add(x.fams); fresh++; }
  console.log(`levels ${String(a + 1).padStart(2)}-${String(b).padEnd(3)}`.padEnd(15), avg(c, (x) => x.v).toFixed(2).padStart(6), avg(c, (x) => x.beats).toFixed(2).padStart(11),
    q(r, (x) => x.width, 0.5).toFixed(3).padStart(11), q(r, (x) => x.conflict, 0.5).toFixed(2).padStart(13), pct(r, (x) => x.conflict < 0.05).padStart(10),
    q(r, (x) => x.preview, 0.1).toFixed(2).padStart(12), String(fresh).padStart(13), pct(c, (x) => x.repeat).padStart(8));
}
fs.writeFileSync(path.join(here, "audit-last.json"), JSON.stringify({ rows, chall }));
