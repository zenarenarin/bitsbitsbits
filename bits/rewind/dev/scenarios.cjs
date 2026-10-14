// Play-test scenarios. Each receives { page, shot, errors } and returns a JSON-able result.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  async smoke({ page, shot }) {
    await sleep(1500);
    await shot("01-title");
    await page.keyboard.press("Space");
    await sleep(1200);
    await shot("02-start");
    await page.keyboard.down("KeyW");
    await sleep(2500);
    await shot("03-time-flowing");
    await sleep(3000);
    await shot("04-gate");
    const st = await page.evaluate(() => {
      const d = window.__rewindDebug;
      return { T: d.clock.T, s: d.player.s, y: d.player.y, state: d.run.state, alive: d.player.alive, log: d.course.log };
    });
    await page.keyboard.up("KeyW");
    return st;
  }
};

// ---------------------------------------------------------------------------
// Autopilot: a simple bot that reads element windows and plays the course using only the
// same inputs a player has (advance / reverse / steer / brake). Used to prove that
// generated encounters are traversable and that failures are not forced.
// ---------------------------------------------------------------------------
async function installAutopilot(page) {
  await page.evaluate(() => {
    const d = window.__rewindDebug;
    const K = d.input.keys;
    const set = (code, on) => { if (on) K.add(code); else K.delete(code); };
    function supportAt(x, s, foot, T) {
      const cols = d.colliders(T, s - 1, s + 1);
      let best = null;
      for (const c of cols) {
        if (!c.sup) continue;
        if (Math.abs(x - c.x) > c.hx + 0.02 || Math.abs(s - c.s) > c.hs + 0.02) continue;
        const top = c.roll != null ? c.top + (x - c.x) * Math.tan(c.roll) : c.top;
        if (top > foot + 0.56 || top < foot - 3.2) continue;
        if (best == null || top > best) best = top;
      }
      return best;
    }
    const ap = { stuckAt: 0, lastProgress: 0, lastS: 0, mode: "" };
    d.autopilot = ap;
    ap.decide = function () {
      const p = d.player, c = d.clock, T = c.T;
      let fwd = false, rev = false, brake = false, tx = p.x;
      const v = Math.max(1, d.runSpeedAt(p.s));
      // next timed element / hazard ahead
      let el = null;
      d.course.forEachElement(p.s - 1, p.s + 16, (e) => {
        if (e.crossS1 == null || e.type === "gyro") return;
        if (e.crossS1 < p.s - 0.1) return;
        if (Math.abs(e.crossX - p.x) > 3.4 && Math.abs(e.crossX) > 0.1) {
          // a parallel route: only consider it if it is the route we are on
          if (Math.abs(e.crossX - p.x) > 1.6) return;
        }
        if (!el || e.crossS0 < el.crossS0) el = e;
      });
      // steering: follow supported ground ahead; prefer the element's line
      const look = p.s + 3.2;
      const candidates = [];
      for (let x = -4.6; x <= 4.6; x += 0.2) {
        const t1 = supportAt(x, look, p.y, T), t0 = supportAt(x, p.s + 1.2, p.y, T);
        if (t1 != null && t0 != null) candidates.push(x);
      }
      if (el && Math.abs(el.crossX - p.x) < 4 && el.crossS0 - p.s < 14) tx = el.crossX;
      else if (candidates.length && !candidates.some((x) => Math.abs(x - p.x) < 0.35)) {
        tx = candidates.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a));
      } else if (candidates.length) {
        // centre within the current lane
        const lane = candidates.filter((x) => Math.abs(x - p.x) < 1.6);
        if (lane.length) tx = (Math.min(...lane) + Math.max(...lane)) / 2;
      }
      ap.mode = "run";
      if (el && el.type === "ferry") {
        const onFerry = p.groundId && p.groundId.startsWith(el.id);
        const cph = el.phaseC(T);
        if (onFerry) { fwd = true; brake = cph < 0.97; ap.mode = "ride"; }
        else if (p.s < el.crossS0) {
          const dist = el.crossS0 - p.s;
          const docked = cph < 0.015;
          if (docked) {
            // board: stand still in time until we are aboard
            fwd = false; rev = false;
          } else {
            // bring the barge back to the near dock the shorter way
            const u = ((T - el.phase) % el.P + el.P) % el.P;
            const toFuture = el.P - u, toPast = u - el.dwell;
            if (toPast > 0 && toPast < toFuture) rev = true; else fwd = true;
          }
          if (!docked && dist < 2.2) brake = true;
          ap.mode = "ferry";
        }
      } else if (el && el.windows && el.type !== "gnomon") {
        const dist = Math.max(0, el.crossS0 - p.s);
        const need = (el.crossS1 - Math.max(p.s, el.crossS0)) / v + dist / v + 0.4;
        const wins = el.windows(Math.max(0, T - 60), T + 60) || [];
        const inWin = wins.find((w) => T >= w[0] && T <= w[1]);
        if (inWin) {
          if (inWin[1] - T > need + 0.8) fwd = true; // flow through
          ap.mode = "in-window";
        } else if (wins.length) {
          let bestW = null, bestCost = Infinity;
          for (const w of wins) {
            const cost = T < w[0] ? (w[0] - T) : (T - w[1]) / 1.5;
            if (cost < bestCost) { bestCost = cost; bestW = w; }
          }
          if (T < bestW[0]) fwd = true; else rev = true;
          const voidAhead = (el.type === "span" && !el.latch) || el.type === "ring";
          if (dist < 2.4 && voidAhead) brake = true;
          ap.mode = T < bestW[0] ? "wait-future" : "seek-past";
        }
      } else {
        fwd = true;
      }
      // gnomon blades within reach: freeze them while clear, nudge them away when in the path
      const hz = [];
      d.course.forEachElement(p.s - 2, p.s + 8, (e) => { if (e.type === "gnomon") hz.push(e); });
      const armHits = (g, TT, xs, s0, s1, pad) => {
        const ang = g.theta(TT);
        for (let t = 0.2; t <= g.len; t += 0.2) {
          const ax = g.px + Math.cos(ang) * t, as = g.ps + Math.sin(ang) * t;
          if (Math.abs(ax - xs) < pad && as > s0 && as < s1) return true;
        }
        return false;
      };
      const near = hz.filter((g) => Math.abs(g.ps - p.s) <= g.len + 3);
      const blockedAt = (TT) => near.some((g) => armHits(g, TT, p.x, p.s - 0.9, p.s + 2.6, 0.9));
      const strikesAt = (TT) => near.some((g) => armHits(g, TT, p.x, p.s - 0.5, p.s + 0.5, 0.6));
      for (const g of near) {
        const blocking = blockedAt(T);
        if (blocking) {
          // stop, and turn time whichever way clears every blade without sweeping one through us
          let choice = 0, bestD = 99;
          const onBridge = p.groundId && p.groundId.includes(":sp");
          for (const dir of onBridge ? [-1] : [1, -1]) {
            for (let dd = 0.05; dd < 8; dd += 0.05) {
              const TT = Math.max(0, T + dir * dd);
              if (strikesAt(TT)) break;
              if (!blockedAt(TT)) { if (dd < bestD) { bestD = dd; choice = dir; } break; }
            }
          }
          fwd = choice > 0; rev = choice < 0; brake = true; ap.mode = "dodge";
          break;
        }
        else if (Math.abs(g.ps - p.s) < g.len + 0.4) { fwd = false; rev = false; brake = false; ap.mode = "freeze"; }
      }
      // falling: reverse and hope history catches us
      if (!p.groundId && p.y < p.lastGroundY - 1.0) { rev = true; fwd = false; ap.mode = "fall"; }
      const steer = Math.abs(tx - p.x) < 0.08 ? 0 : Math.max(-1, Math.min(1, (tx - p.x) * 2));
      set("KeyW", fwd); set("KeyS", rev); set("Space", brake);
      set("KeyA", steer < -0.25); set("KeyD", steer > 0.25);
      return { fwd, rev, brake, steer };
    };
  });
}

async function autopilotRun(page, seed, maxSteps, opts) {
  opts = opts || {};
  return page.evaluate(({ seed, maxSteps, opts }) => {
    const d = window.__rewindDebug;
    d.loop.setManual && d.loop.setManual(true);
    if (window.__loop && window.__loop.setManual) window.__loop.setManual(true);
    d.startRun(seed);
    const ap = d.autopilot;
    let lastS = 0, lastProgressStep = 0, deaths = 0, falls = 0, knocks = 0;
    const modes = {};
    const trace = [];
    const ring = [];
    let i = 0;
    for (; i < maxSteps; i++) {
      d.course.ensure(d.player.s + 120);
      ap.decide();
      d.fixedStep();
      if (i % 12 === 0) { ring.push([i, +d.player.s.toFixed(2), +d.player.x.toFixed(2), +d.player.y.toFixed(2), +d.clock.T.toFixed(2), ap.mode, d.player.groundId, [...d.input.keys].join("+"), +d.player.stumble.toFixed(2)]); if (ring.length > 40) ring.shift(); }
      modes[ap.mode] = (modes[ap.mode] || 0) + 1;
      if (d.player.s > lastS + 1) { lastS = d.player.s; lastProgressStep = i; }
      if (i % 240 === 0) trace.push([i, +d.player.s.toFixed(1), +d.player.x.toFixed(2), +d.player.y.toFixed(2), +d.clock.T.toFixed(2), ap.mode]);
      if (d.run.state !== "play") { deaths++; break; }
      if (i - lastProgressStep > 120 * 40) break; // stuck 40 s
      if (opts.untilS && d.player.s > opts.untilS) break;
    }
    const seg = d.course.segAt(d.player.s);
    return {
      seed, steps: i, s: +d.player.s.toFixed(1), x: +d.player.x.toFixed(2), y: +d.player.y.toFixed(2), T: +d.clock.T.toFixed(2),
      state: d.run.state, score: d.run.score, shards: d.run.shards, streak: d.run.streak,
      segKind: seg && seg.kind, segIndex: seg && seg.index, stuck: i - lastProgressStep > 120 * 40,
      modes, genLog: d.course.log.slice(0, 5), trace: trace.slice(-8), last: d.run.state !== "play" ? ring.slice(-24) : null,
      segElems: seg ? seg.elements.map((e) => e.type + "@" + (e.crossS0 != null ? e.crossS0.toFixed(1) : e.ps) + "x" + (e.crossX != null ? e.crossX : e.px)) : null, segS0: seg && seg.s0
    };
  }, { seed, maxSteps, opts });
}

module.exports.autopilot = async ({ page, shot }) => {
  await installAutopilot(page);
  const seeds = (process.env.SEEDS || "1,2,3").split(",").map(Number);
  const out = [];
  for (const seed of seeds) {
    out.push(await autopilotRun(page, seed, parseInt(process.env.STEPS || "36000", 10)));
    await page.evaluate(() => window.__rewindDebug.render());
    await shot("auto-" + seed);
  }
  return out;
};
module.exports.installAutopilot = installAutopilot;
module.exports.autopilotRun = autopilotRun;
module.exports.debugStuck = async ({ page, shot }) => {
  await installAutopilot(page);
  const r = await autopilotRun(page, parseInt(process.env.SEED || "1", 10), 60000, { untilS: parseFloat(process.env.UNTIL || "143.5") });
  await page.evaluate(() => { const d = window.__rewindDebug; for (let k = 0; k < 1200; k++) { d.course.ensure(d.player.s + 120); d.autopilot.decide(); d.fixedStep(); } });
  const info = await page.evaluate(() => {
    const d = window.__rewindDebug, p = d.player;
    const cols = d.colliders(d.clock.T, p.s - 2, p.s + 2).map((c) => ({ id: c.id, x: +c.x.toFixed(2), s: +c.s.toFixed(2), hx: c.hx, hs: c.hs, top: +c.top.toFixed(2), bottom: +c.bottom.toFixed(2), sup: c.sup }));
    const gn = [];
    d.course.forEachElement(p.s - 8, p.s + 8, (e) => { if (e.type === "gnomon") gn.push({ id: e.id, px: e.px, ps: e.ps, ang: +(((e.theta(d.clock.T) % 6.283) + 6.283) % 6.283).toFixed(2) }); });
    const els = [];
    d.course.forEachElement(p.s - 3, p.s + 10, (e) => els.push({ id: e.id, type: e.type, cs0: e.crossS0, cs1: e.crossS1, x: e.crossX, win: e.windows ? (e.windows(Math.max(0, d.clock.T - 20), d.clock.T + 20) || []).map((w) => w.map((v) => +v.toFixed(2))) : null }));
    return { p: { x: p.x, y: p.y, s: p.s, vs: p.vs, vx: p.vx, blocked: p.blocked, ground: p.groundId, stumble: p.stumble }, T: d.clock.T, keys: [...d.input.keys], mode: d.autopilot.mode, cols, gn, els };
  });
  await page.evaluate(() => window.__rewindDebug.render());
  await shot("debug-stuck");
  return { r: { s: r.s, T: r.T }, info };
};
module.exports.tour = async ({ page, shot }) => {
  await installAutopilot(page);
  const stops = (process.env.STOPS || "8,20,44,52,70,98,106,128,140,150,200,260,330").split(",").map(Number);
  await page.evaluate((seed) => { const d = window.__rewindDebug; if (window.__loop.setManual) window.__loop.setManual(true); d.startRun(seed); }, parseInt(process.env.SEED || "3", 10));
  const out = [];
  for (const st of stops) {
    const r = await page.evaluate((st) => {
      const d = window.__rewindDebug;
      for (let i = 0; i < 40000 && d.player.s < st && d.run.state === "play"; i++) { d.course.ensure(d.player.s + 120); d.autopilot.decide(); d.fixedStep(); }
      for (let i = 0; i < (window.__settle || 90); i++) d.render();
      return { s: +d.player.s.toFixed(1), T: +d.clock.T.toFixed(2), mode: d.autopilot.mode, state: d.run.state, seg: (d.course.segAt(d.player.s) || {}).kind };
    }, st);
    out.push(r);
    await shot("tour-" + String(st).padStart(4, "0"));
  }
  return out;
};

// The first bridge: arrive with it fallen, reverse while running, capture the rebuild.
module.exports.rewindSeq = async ({ page, shot }) => {
  await installAutopilot(page);
  const out = await page.evaluate(() => {
    const d = window.__rewindDebug;
    if (window.__loop.setManual) window.__loop.setManual(true);
    d.startRun(7);
    const K = d.input.keys;
    // run forward holding time until just before the first bridge
    for (let i = 0; i < 20000 && d.player.s < 41; i++) { d.course.ensure(d.player.s + 120); d.autopilot.decide(); d.fixedStep(); }
    K.clear(); K.add("KeyW");
    for (let i = 0; i < 20000 && d.clock.T < 5.6; i++) { K.add("Space"); d.fixedStep(); }
    K.clear();
    for (let i = 0; i < 60; i++) d.render();
    return { s: d.player.s, T: d.clock.T };
  });
  await shot("seq-0-fallen");
  const frames = [];
  for (let f = 1; f <= 5; f++) {
    frames.push(await page.evaluate(() => {
      const d = window.__rewindDebug; const K = d.input.keys;
      K.clear(); K.add("KeyS"); K.add("Space");
      for (let i = 0; i < 40; i++) { d.fixedStep(); d.render(); }
      return { T: +d.clock.T.toFixed(2), s: +d.player.s.toFixed(2) };
    }));
    await shot("seq-" + f + "-rewind");
  }
  return { out, frames };
};

// ---------------------------------------------------------------------------
// Rule tests: determinism, reward accounting, distance accounting, boundaries.
// ---------------------------------------------------------------------------
module.exports.rules = async ({ page }) => {
  await installAutopilot(page);
  return page.evaluate(() => {
    const d = window.__rewindDebug;
    if (window.__loop.setManual) window.__loop.setManual(true);
    const results = {};
    const snap = (T, sa, sb) => JSON.stringify(d.colliders(T, sa, sb).map((c) => [c.id, +c.x.toFixed(5), +c.s.toFixed(5), +c.top.toFixed(5), c.hs.toFixed(5), c.roll != null ? +c.roll.toFixed(5) : null]));
    d.startRun(4242);
    d.course.ensure(700);
    // 1. world state is a pure function of T: forward sweep vs backward sweep vs random order
    const Ts = []; for (let t = 0; t <= 120; t += 0.37) Ts.push(+t.toFixed(2));
    const fwd = Ts.map((t) => snap(t, 0, 700));
    const bwd = Ts.slice().reverse().map((t) => snap(t, 0, 700)).reverse();
    const shuffled = Ts.map((t, i) => ({ t, i })).sort((a, b) => Math.sin(a.t * 91.7) - Math.sin(b.t * 91.7));
    const rnd = new Array(Ts.length);
    for (const e of shuffled) rnd[e.i] = snap(e.t, 0, 700);
    results.deterministicFwdBwd = fwd.every((v, i) => v === bwd[i]);
    results.deterministicRandomOrder = fwd.every((v, i) => v === rnd[i]);
    results.collidersChecked = fwd.reduce((a, v) => a + JSON.parse(v).length, 0);
    // 2. same seed regenerates identical geometry; different seed differs past the opening
    const sig = () => d.course.segs.map((sg) => sg.kind + ":" + sg.s0.toFixed(2) + ":" + sg.elements.map((e) => e.type + (e.crossS0 != null ? e.crossS0.toFixed(2) : "")).join(",")).join("|");
    d.startRun(4242); d.course.ensure(400); const a1 = sig();
    d.startRun(4242); d.course.ensure(400); const a2 = sig();
    d.startRun(999); d.course.ensure(400); const b1 = sig();
    results.sameSeedSameCourse = a1 === a2;
    results.introIdenticalAcrossSeeds = a1.split("|").slice(0, 6).join("|") === b1.split("|").slice(0, 6).join("|");
    results.differentSeedDiffers = a1 !== b1;
    // 3. validator over many seeds: every generated encounter passes, with few retries
    let segs = 0, retries = 0, fallbacks = 0;
    const kinds = {};
    for (let seed = 1; seed <= 120; seed++) {
      d.startRun(seed); d.course.ensure(2600);
      segs += d.course.segs.length; retries += d.course.log.length;
      for (const sg of d.course.segs) kinds[sg.kind] = (kinds[sg.kind] || 0) + 1;
      fallbacks += d.course.log.filter((l) => l.attempt === 5).length;
    }
    results.validator = { seeds: 120, segments: segs, rejectedAttempts: retries, kinds };
    // 4. reward accounting: collect a shard, then oscillate time across its existence
    d.startRun(77);
    const K = d.input.keys;
    // run down the right walk of the promenade (it holds three shards), holding time
    let guard = 0;
    while (d.player.s < 11 && guard++ < 6000) { K.clear(); K.add("KeyW"); if (d.player.x < 1.75) K.add("KeyD"); d.fixedStep(); }
    while (d.run.shards === 0 && guard++ < 9000) { K.clear(); K.add("KeyW"); if (d.player.x < 1.6) K.add("KeyD"); if (d.player.x > 1.9) K.add("KeyA"); d.fixedStep(); }
    const shardsAfterFirst = d.run.shards, bonusAfterFirst = d.run.bonus;
    const collected = [...d.run.collected];
    // brake and oscillate time for a long while
    for (let k = 0; k < 6; k++) {
      K.clear(); K.add("Space"); K.add("KeyS");
      for (let i = 0; i < 240; i++) d.fixedStep();
      K.clear(); K.add("Space"); K.add("KeyW");
      for (let i = 0; i < 240; i++) d.fixedStep();
    }
    results.shardNoFarming = { shardsAfterFirst, shardsAfterOscillation: d.run.shards, bonusAfterFirst, bonusAfterOscillation: d.run.bonus, collected };
    // 4b. a temporal shard: exists only in its window; collected once; reappears as "spent"
    d.startRun(77);
    const seg2 = d.course.segs.find((sg) => sg.kind === "intro2");
    const tsh = seg2.shards[0];
    const exist = [0, 2, 3.5, 3.9, 4.5, 8].map((t) => +tsh.existence(t).toFixed(2));
    // drive to it with the bridge intact (T paused below collapse)
    K.clear();
    let g2 = 0;
    const lane = () => { const want = d.player.s > 11 && d.player.s < 28.5 ? 1.75 : 0; if (d.player.x < want - 0.15) K.add("KeyD"); if (d.player.x > want + 0.15) K.add("KeyA"); };
    // open the promenade gate (needs T >= 3.8), pass it, then reverse to before the collapse
    while (d.player.s < 38 && g2++ < 9000) { K.clear(); K.add("KeyW"); lane(); d.fixedStep(); }
    while (d.clock.T > 3.0 && g2++ < 12000) { K.clear(); K.add("KeyS"); K.add("Space"); d.fixedStep(); }
    while (d.player.s < 60 && g2++ < 14000) { K.clear(); lane(); d.fixedStep(); }
    const got = d.run.collected.has(tsh.id), shardsAt = d.run.shards;
    for (let k = 0; k < 4; k++) {
      K.clear(); K.add("Space"); K.add("KeyW"); for (let i = 0; i < 300; i++) d.fixedStep();
      K.clear(); K.add("Space"); K.add("KeyS"); for (let i = 0; i < 300; i++) d.fixedStep();
    }
    results.temporalShard = { exist, collected: got, shardsAt, shardsAfterOscillation: d.run.shards, playerS: +d.player.s.toFixed(1), alive: d.player.alive };
    // 5. distance accounting: frontier only
    const distBefore = d.run.distM;
    K.clear(); K.add("Space");
    for (let i = 0; i < 600; i++) d.fixedStep();
    results.distanceStableWhileStopped = d.run.distM === distBefore;
    // 6. beginning of history: reversing at T = 0 holds at 0 and flags it
    d.startRun(5);
    K.clear(); K.add("KeyS"); K.add("Space");
    for (let i = 0; i < 240; i++) d.fixedStep();
    results.historyFloor = { T: d.clock.T, atFloor: d.clock.atFloor };
    // 7. simultaneous input: steering and reversing at once both take effect
    K.clear(); K.add("KeyW"); for (let i = 0; i < 360; i++) d.fixedStep();
    const x0 = d.player.x, T0 = d.clock.T;
    K.clear(); K.add("KeyS"); K.add("KeyA"); for (let i = 0; i < 60; i++) d.fixedStep();
    results.steerWhileReversing = { dx: +(d.player.x - x0).toFixed(3), dT: +(d.clock.T - T0).toFixed(3), sMoved: d.player.s > 0 };
    // 8. restart resets run state
    d.startRun(5);
    results.restartReset = { score: d.run.score, shards: d.run.shards, T: d.clock.T, s: d.player.s, collected: d.run.collected.size, streak: d.run.streak };
    // 9. draw calls in a typical frame
    for (let i = 0; i < 2; i++) d.render();
    results.renderInfo = { calls: d.renderer.info.render.calls, triangles: d.renderer.info.render.triangles, geometries: d.renderer.info.memory.geometries, textures: d.renderer.info.memory.textures };
    return results;
  });
};

module.exports.ui = async ({ page, shot }) => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = () => page.evaluate(() => { const d = window.__rewindDebug; d.input.compute(); return { state: d.run.state, fwd: d.input.fwd, rev: d.input.rev, steer: +d.input.steer.toFixed(2), brake: d.input.brake, T: +d.clock.T.toFixed(2), s: +d.player.s.toFixed(1), touches: d.input.touches.size }; });
  const out = {};
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  await sleep2(800);
  // tap title to start (touch)
  await touch("touchStart", [{ id: 1, x: 195, y: 400 }]);
  await touch("touchEnd", []);
  await sleep2(500);
  out.afterTap = await st();
  await shot("ui-1-play-touch");
  const L = await page.evaluate(() => window.__rewindDebug.hud.layout);
  out.layout = L;
  const fwdX = L.fx + L.B / 2, revX = L.rx + L.B / 2, by = L.by + L.B / 2;
  // right thumb holds advance, left thumb drags right to steer
  await touch("touchStart", [{ id: 11, x: fwdX, y: by }]);
  await touch("touchStart", [{ id: 11, x: fwdX, y: by }, { id: 12, x: 80, y: 700 }]);
  await touch("touchMove", [{ id: 11, x: fwdX, y: by }, { id: 12, x: 130, y: 700 }]);
  await sleep2(300);
  out.twoFingers = await st();
  await shot("ui-2-two-fingers");
  // slide the right thumb onto reverse without lifting
  await touch("touchMove", [{ id: 11, x: revX, y: by }, { id: 12, x: 130, y: 700 }]);
  await sleep2(300);
  out.slidToReverse = await st();
  await shot("ui-3-reverse");
  // lift the left finger: reverse must stay held
  await touch("touchMove", [{ id: 11, x: revX, y: by }]);
  await sleep2(150);
  out.liftedSteer = await st();
  // pull down on the left to brake while still reversing
  await touch("touchStart", [{ id: 11, x: revX, y: by }, { id: 13, x: 80, y: 650 }]);
  await touch("touchMove", [{ id: 11, x: revX, y: by }, { id: 13, x: 82, y: 710 }]);
  await sleep2(150);
  out.brakeAndReverse = await st();
  await touch("touchEnd", []);
  await sleep2(150);
  out.allLifted = await st();
  // focus loss clears inputs and pauses
  await page.keyboard.down("KeyW");
  await sleep2(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await sleep2(200);
  out.afterBlur = await st();
  await page.keyboard.up("KeyW");
  await shot("ui-4-paused");
  // resume via Escape
  await page.keyboard.press("Escape");
  await sleep2(300);
  out.resumed = await st();
  // force a death: steer off the side of the first bridge region is guarded, so drop the player
  await page.evaluate(() => { const d = window.__rewindDebug; d.player.y = -30; });
  for (let i = 0; i < 40; i++) { await sleep2(150); const q = await st(); if (q.state === "results") break; }
  await sleep2(900);
  out.afterDeath = await st();
  await shot("ui-5-results");
  const ev = await page.evaluate(() => window.__harnessEvents.map((e) => e.name));
  out.platformEvents = ev.filter((n) => ["ready", "start", "fail", "score.submit", "markVisualReady"].includes(n));
  // tap to restart
  await touch("touchStart", [{ id: 21, x: 195, y: 400 }]);
  await touch("touchEnd", []);
  await sleep2(400);
  out.restarted = await st();
  return out;
};
module.exports.pointers = async ({ page }) => {
  await new Promise((r) => setTimeout(r, 800));
  return page.evaluate(() => {
    const d = window.__rewindDebug;
    const c = d.renderer.domElement;
    const r = c.getBoundingClientRect();
    const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, isPrimary: id === 101 }));
    const snap = () => { d.input.compute(); return { fwd: d.input.fwd, rev: d.input.rev, steer: +d.input.steer.toFixed(2), brake: d.input.brake, n: d.input.touches.size }; };
    const L = d.hud.layout;
    const out = {};
    fire("pointerdown", 100, 195, 400); fire("pointerup", 100, 195, 400); // start the run
    out.state = d.run.state;
    fire("pointerdown", 102, L.fx + L.B / 2, L.by + L.B / 2);
    fire("pointerdown", 101, 80, 700);
    fire("pointermove", 101, 125, 700);
    out.both = snap();
    fire("pointermove", 102, L.rx + L.B / 2, L.by + L.B / 2);
    out.slid = snap();
    fire("pointerup", 101, 125, 700);
    out.liftSteerKeepsReverse = snap();
    fire("pointerdown", 103, 90, 650); fire("pointermove", 103, 92, 700);
    out.brakeWithReverse = snap();
    fire("pointerup", 102, L.rx + L.B / 2, L.by + L.B / 2);
    out.liftTimeKeepsBrake = snap();
    fire("pointercancel", 103, 92, 700);
    out.cancelled = snap();
    return out;
  });
};
module.exports.pauseResume = async ({ page }) => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = () => page.evaluate(() => { const d = window.__rewindDebug, p = d.player; return { time: +d.run.time.toFixed(2), stateAt: +d.run.stateAt.toFixed(2), frame: d.run.frame, state: d.run.state, s: +p.s.toFixed(2), x: +p.x.toFixed(2), vs: +p.vs.toFixed(2), started: p.started, blocked: p.blocked, ground: p.groundId, T: +d.clock.T.toFixed(2) }; });
  await sleep2(600);
  await page.keyboard.press("Space");
  await sleep2(1500);
  const a = await st();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await sleep2(800);
  const b = await st();
  await page.keyboard.press("Escape");
  await sleep2(1500);
  const c = await st();
  return { a, b, c };
};
module.exports.perf = async ({ page }) => {
  await installAutopilot(page);
  return page.evaluate(() => {
    const d = window.__rewindDebug;
    if (window.__loop.setManual) window.__loop.setManual(true);
    d.startRun(3);
    // get into the endless part
    for (let i = 0; i < 20000 && d.player.s < 260; i++) { d.course.ensure(d.player.s + 120); d.autopilot.decide(); d.fixedStep(); }
    const t0 = performance.now();
    for (let i = 0; i < 1200; i++) { d.course.ensure(d.player.s + 120); d.autopilot.decide(); d.fixedStep(); }
    const simMsPerSecond = (performance.now() - t0) / 10; // 120 steps = 1 s of game
    const realRender = d.renderer.render.bind(d.renderer);
    d.renderer.render = () => {};
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) d.render();
    const jsMsPerFrame = (performance.now() - t1) / 200;
    d.renderer.render = realRender;
    const t2 = performance.now();
    for (let i = 0; i < 10; i++) d.render();
    const fullMsPerFrameSoftwareGL = (performance.now() - t2) / 10;
    return { simMsPerGameSecond: +simMsPerSecond.toFixed(2), jsMsPerFrameExcludingGL: +jsMsPerFrame.toFixed(2), fullMsPerFrameSoftwareGL: +fullMsPerFrameSoftwareGL.toFixed(1), s: d.player.s, calls: d.renderer.info.render.calls };
  });
};

// End-to-end touch pipeline with real (CDP) touches, so browser hit testing decides which
// element receives each touch. Records: topmost hit-testable element at each control, whether
// the game's input handler saw the touch, the game-state change, and a pixel diff of the frame.
module.exports.touchPipeline = async ({ page, shot }) => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const st = () => page.evaluate(() => { const d = window.__rewindDebug, p = d.player; d.input.compute(); return { state: d.run.state, started: p.started, touches: d.input.touches.size, fwd: d.input.fwd, rev: d.input.rev, steer: +d.input.steer.toFixed(2), brake: d.input.brake, T: +d.clock.T.toFixed(3), s: +p.s.toFixed(2), x: +p.x.toFixed(3) }; });
  const hitAt = (x, y) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const d = window.__rewindDebug;
    const isGame = el === d.renderer.domElement;
    return { tag: el && el.tagName, id: el && el.id, cls: el && String(el.className).slice(0, 30), isGameCanvas: isGame, gamePE: getComputedStyle(d.renderer.domElement).pointerEvents };
  }, [x, y]);
  const frameSig = () => page.evaluate(() => { const d = window.__rewindDebug; d.render(); const c = d.renderer.domElement; const g = document.createElement("canvas"); g.width = 48; g.height = 104; const x = g.getContext("2d"); x.drawImage(c, 0, 0, 48, 104); return Array.from(x.getImageData(0, 0, 48, 104).data); });
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n; };
  await sleep2(800);
  const out = {};
  const L0 = await page.evaluate(() => window.__rewindDebug.hud.layout);
  const fwdX = L0.fx + L0.B / 2, revX = L0.rx + L0.B / 2, by = L0.by + L0.B / 2, steerX = 80, steerY = by;
  out.hitTitle = await hitAt(195, 400);
  await touch("touchStart", [{ id: 1, x: 195, y: 400 }]); await touch("touchEnd", []);
  await sleep2(400);
  out.afterStartTap = await st();
  // in play: what does each control point hit?
  out.hitFwd = await hitAt(fwdX, by);
  out.hitRev = await hitAt(revX, by);
  out.hitSteer = await hitAt(steerX, steerY);
  out.hitCentre = await hitAt(195, 420);
  out.hitPause = await hitAt(L0.W - 14 - 18, 12 + 18);
  // 1) advance: hold the forward control; world time must advance and the frame must change
  const s0 = await st(); const f0 = await frameSig();
  await touch("touchStart", [{ id: 11, x: fwdX, y: by }]);
  await sleep2(1200);
  const s1 = await st(); const f1 = await frameSig();
  out.advance = { before: s0, during: s1, frameChangedPixels: diff(f0, f1) };
  // 2) simultaneous: add a steering finger on the left while still holding advance
  await touch("touchStart", [{ id: 11, x: fwdX, y: by }, { id: 12, x: steerX, y: steerY }]);
  await touch("touchMove", [{ id: 11, x: fwdX, y: by }, { id: 12, x: steerX + 50, y: steerY }]);
  await sleep2(900);
  const s2 = await st();
  out.advancePlusSteer = { state: s2, dx: +(s2.x - s1.x).toFixed(3), dT: +(s2.T - s1.T).toFixed(3) };
  // 3) slide the right thumb onto reverse while still steering: time must run backward
  await touch("touchMove", [{ id: 11, x: revX, y: by }, { id: 12, x: steerX + 50, y: steerY }]);
  await sleep2(900);
  const s3 = await st();
  out.reversePlusSteer = { state: s3, dT: +(s3.T - s2.T).toFixed(3) };
  await shot("touchpipe-reverse");
  // 4) release everything
  await touch("touchEnd", []);
  await sleep2(300);
  out.released = await st();
  // 5) HUD pause button by touch, then resume by touch
  const P = { x: L0.W - 14 - 18, y: 12 + 18 };
  await touch("touchStart", [{ id: 21, x: P.x, y: P.y }]); await touch("touchEnd", []);
  await sleep2(300);
  out.afterPauseTap = (await st()).state;
  const resumeBtn = await page.evaluate(() => { const r = document.getElementById("rw-resume").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  out.hitResume = await hitAt(resumeBtn.x, resumeBtn.y);
  await touch("touchStart", [{ id: 22, x: resumeBtn.x, y: resumeBtn.y }]); await touch("touchEnd", []);
  await sleep2(400);
  out.afterResumeTap = (await st()).state;
  // 6) keyboard still works: S reverses, D steers
  const k0 = await st();
  await page.keyboard.down("KeyS"); await page.keyboard.down("KeyD");
  await sleep2(700);
  const k1 = await st();
  await page.keyboard.up("KeyS"); await page.keyboard.up("KeyD");
  out.keyboard = { rev: k1.rev, steer: k1.steer, dT: +(k1.T - k0.T).toFixed(3), dx: +(k1.x - k0.x).toFixed(3) };
  return out;
};
module.exports.keyboardCheck = async ({ page }) => {
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = () => page.evaluate(() => { const d = window.__rewindDebug, p = d.player; return { state: d.run.state, T: +d.clock.T.toFixed(3), s: +p.s.toFixed(2), x: +p.x.toFixed(3), y: +p.y.toFixed(2) }; });
  await sleep2(800);
  await page.keyboard.press("Space");
  await sleep2(300);
  const out = { start: await st() };
  await page.keyboard.down("KeyW"); await sleep2(1500); out.afterW = await st();
  await page.keyboard.down("KeyA"); await sleep2(1200); out.afterWA = await st();
  await page.keyboard.up("KeyA"); await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyS"); await sleep2(1000); out.afterS = await st(); await page.keyboard.up("KeyS");
  await page.keyboard.press("Escape"); await sleep2(200); out.esc = (await st()).state;
  await page.keyboard.press("Escape"); await sleep2(200); out.esc2 = (await st()).state;
  return out;
};
// Real key events (window keydown/keyup listeners), deterministic simulation stepping.
module.exports.keyboardSteps = async ({ page }) => {
  const st = () => page.evaluate(() => { const d = window.__rewindDebug, p = d.player; return { state: d.run.state, T: +d.clock.T.toFixed(3), s: +p.s.toFixed(2), x: +p.x.toFixed(3) }; });
  const step = (n) => page.evaluate((n) => { const d = window.__rewindDebug; for (let i = 0; i < n; i++) { d.course.ensure(d.player.s + 120); d.fixedStep(); } }, n);
  await page.evaluate(() => { if (window.__loop.setManual) window.__loop.setManual(true); });
  await page.keyboard.press("Space"); // keyboard start from title
  const out = { start: await st() };
  await page.keyboard.down("KeyW"); await step(240); out.W2s = await st();
  await page.keyboard.down("KeyA"); await step(60); out.WA05s = await st();
  await page.keyboard.up("KeyA"); await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyS"); await step(60); out.S05s = await st(); await page.keyboard.up("KeyS");
  await page.keyboard.down("KeyD"); await step(60); out.D05s = await st(); await page.keyboard.up("KeyD");
  return out;
};
module.exports.hitScan = async ({ page }) => {
  await page.evaluate(() => { if (window.__loop.setManual) window.__loop.setManual(true); });
  await page.keyboard.press("Space");
  await new Promise((r) => setTimeout(r, 700)); // let the title fade transition finish
  return page.evaluate(() => {
    const d = window.__rewindDebug, W = innerWidth, H = innerHeight, c = d.renderer.domElement;
    const tally = {};
    for (let y = 4; y < H; y += 20) for (let x = 4; x < W; x += 20) {
      const el = document.elementFromPoint(x, y);
      let k = el === c ? "GAME_CANVAS" : (el.closest("button") ? "button#" + el.closest("button").id : el.tagName + (el.id ? "#" + el.id : "") + "." + String(el.className).slice(0, 18));
      tally[k] = (tally[k] || 0) + 1;
    }
    const surfaces = [...document.querySelectorAll("#stage > *")].map((e) => ({ tag: e.tagName, z: getComputedStyle(e).zIndex, pe: getComputedStyle(e).pointerEvents, display: getComputedStyle(e).display }));
    return { state: d.run.state, tally, surfaces };
  });
};

// Same pipeline, but with a full-screen overlay deliberately intercepting touches above the
// play canvas, like the device showed (taps reached the bit, 0 reached the canvas).
module.exports.touchPipelineBlocked = async (c) => {
  await c.page.evaluate(() => { const d = window.__rewindDebug; d.hud.ribbon.style.pointerEvents = "auto"; });
  const r = await module.exports.touchPipeline(c);
  r.diagLine = await c.page.evaluate(() => document.getElementById("rw-diag").textContent);
  return r;
};
