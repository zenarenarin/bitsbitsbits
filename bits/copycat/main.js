// COPYCAT — one input, two worlds, every move matters twice.
// Plethora Bit (plethora-bit@2). Canvas2D, 2.5D architectural diorama.
//
// Layout of this file:
//   1. utilities
//   2. physics (shared by gameplay, the segment validator and the SYNC timing check)
//   3. solver / validator (proves every generated segment has a fair shared solution)
//   4. paired-challenge generator (challenge grammar + family library)
//   5. audio (tiny synthesised SFX)
//   6. the Bit: state machine, input, scoring, rendering
(function () {
  "use strict";

  // ---------------------------------------------------------------- 1. utils
  const TAU = Math.PI * 2;
  const EV_JUMP = 1, EV_LAND = 2, EV_BONK = 4, EV_TEETER = 8, EV_DIE = 16, EV_PLATE = 32;
  const HMIN = -1.2, HMAX = 1.6; // floor-height band each world may wander within

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function q10(v) { return Math.round(v * 10) / 10; }
  function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (a, b) => a + Math.floor(next() * (b - a + 1)),
      chance: (p) => next() < p,
      pick: (arr) => arr[Math.floor(next() * arr.length)]
    };
  }
  function hash01(n) {
    let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  // -------------------------------------------------------------- 2. physics
  // World units ("u"): the characters are 0.7u tall. y is up. Both characters
  // always share the same x (one forward progression); everything vertical,
  // every collision and every landing is evaluated per world.
  function makePhys(o) {
    const H = o.jumpHeight, Tup = o.airTime / 2;
    const vj = (2 * H) / Tup, g = vj / Tup;
    return {
      H, Tup, air: o.airTime, vj, g,
      hw: 0.23, ch: 0.7,
      coyote: o.coyote, buffer: o.buffer,
      stepTol: 0.12, maxFall: 22, dt: 1 / 120
    };
  }
  function newWorld() {
    return { blocks: [], ceils: [], spikes: [], pistons: [], lifts: [], gates: [], plates: [], prisms: [], killY: -4 };
  }
  function newChar(y) { return { y, vy: 0, gr: true, coy: 0, buf: 0, dead: null, lift: null, sup: null, ev: 0, air: 0 }; }
  function newSim(x, v, hA, hB) { return { x, v, steps: 0, sw: {}, c: [newChar(hA), newChar(hB)] }; }
  function copyChar(d, s) {
    d.y = s.y; d.vy = s.vy; d.gr = s.gr; d.coy = s.coy; d.buf = s.buf; d.dead = s.dead;
    d.lift = s.lift; d.sup = s.sup; d.ev = s.ev; d.air = s.air;
    return d;
  }
  function cloneSim(s) {
    return { x: s.x, v: s.v, steps: s.steps, sw: Object.assign({}, s.sw), c: [copyChar({}, s.c[0]), copyChar({}, s.c[1])] };
  }
  function copySimInto(d, s) {
    d.x = s.x; d.v = s.v; d.steps = s.steps;
    for (const k in d.sw) delete d.sw[k];
    for (const k in s.sw) d.sw[k] = s.sw[k];
    copyChar(d.c[0], s.c[0]); copyChar(d.c[1], s.c[1]);
    return d;
  }
  // Moving objects are a pure function of the shared x, so the validator and
  // the live game see exactly the same motion.
  function osc(o, xs) { return 0.5 - 0.5 * Math.cos((TAU * ((xs - o.ox) / o.ov)) / o.per + o.ph); }
  function pistonBottom(p, xs) { return p.base + p.lo + (p.hi - p.lo) * osc(p, xs); }
  function liftTop(l, xs) { return l.base + l.lo + (l.hi - l.lo) * osc(l, xs); }
  function gateOpen(gt, sw, xs) {
    const px = sw[gt.link];
    if (px === undefined) return 0;
    return clamp((xs - px) / (gt.ov * 0.32), 0, 1);
  }
  function gateBottom(gt, sw, xs) { return gt.y0 + 2.9 * gateOpen(gt, sw, xs); }

  function die(c, cause) { c.dead = cause; c.ev |= EV_DIE; }

  function stepChar(sim, w, c, P, tap) {
    c.ev = 0;
    if (c.dead) return;
    const dt = P.dt, xs = sim.x, L = xs - P.hw, R = xs + P.hw, ch = P.ch;
    const bl = w.blocks;

    // jump request: buffered, honoured while grounded or within coyote time
    if (tap) c.buf = P.buffer;
    if (c.buf > 0 && (c.gr || c.coy > 0)) {
      c.vy = P.vj; c.gr = false; c.coy = 0; c.buf = 0; c.lift = null; c.sup = null; c.air = 0;
      c.ev |= EV_JUMP;
    } else if (c.buf > 0) {
      c.buf = Math.max(0, c.buf - dt);
    }

    // keep ground support (walk-off starts coyote time)
    if (c.gr) {
      let ok = false;
      if (c.lift) {
        const lf = c.lift;
        if (lf.x1 > L && lf.x0 < R) { c.y = liftTop(lf, xs); ok = true; } else c.lift = null;
      }
      if (!ok) {
        for (let i = 0; i < bl.length; i++) {
          const b = bl[i];
          if (b.x1 <= L) continue;
          if (b.x0 >= R) break;
          if (Math.abs(b.top - c.y) < 1e-4) { ok = true; c.sup = b; break; }
        }
      }
      if (!ok) { c.gr = false; c.coy = P.coyote; c.vy = 0; c.air = 0; c.sup = null; }
    }

    // horizontal: walls (a small lip is climbed automatically)
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (b.x1 <= L) continue;
      if (b.x0 >= R) break;
      if (c.y < b.top - 1e-6) {
        if (b.top - c.y <= P.stepTol) {
          c.y = b.top;
          if (c.vy <= 0) {
            c.vy = 0;
            if (!c.gr) { c.gr = true; c.coy = 0; c.ev |= EV_LAND; c.lift = null; }
            c.sup = b;
          }
        } else { die(c, !c.gr && c.vy < 0 && b.top - c.y > P.stepTol ? "fell" : "wall"); return; }
      }
    }
    const lifts = w.lifts;
    for (let i = 0; i < lifts.length; i++) {
      const lf = lifts[i];
      if (lf.x1 <= L || lf.x0 >= R || c.lift === lf) continue;
      const t = liftTop(lf, xs);
      if (c.y < t - 1e-6 && c.y + ch > t - lf.th) {
        if (t - c.y <= P.stepTol + 0.05) {
          c.y = t;
          if (c.vy <= 0) { c.vy = 0; if (!c.gr) { c.gr = true; c.ev |= EV_LAND; } c.lift = lf; c.sup = lf; c.coy = 0; }
        } else { die(c, "wall"); return; }
      }
    }

    // vertical
    const ceils = w.ceils;
    if (!c.gr) {
      if (c.coy > 0) c.coy -= dt;
      c.air += dt;
      c.vy -= P.g * dt;
      if (c.vy < -P.maxFall) c.vy = -P.maxFall;
      let ny = c.y + c.vy * dt;
      if (c.vy > 0) {
        for (let i = 0; i < ceils.length; i++) {
          const ce = ceils[i];
          if (ce.x1 <= L || ce.x0 >= R) continue;
          if (c.y + ch <= ce.y + 1e-6 && ny + ch > ce.y) {
            if (ce.lethal) { c.y = ce.y - ch; die(c, "ceiling"); return; }
            ny = ce.y - ch; c.vy = 0; c.ev |= EV_BONK;
          }
        }
      } else {
        let best = -1e9, sup = null, isLift = false;
        for (let i = 0; i < bl.length; i++) {
          const b = bl[i];
          if (b.x1 <= L) continue;
          if (b.x0 >= R) break;
          if (b.top <= c.y + 1e-6 && b.top >= ny - 1e-9 && b.top > best) { best = b.top; sup = b; isLift = false; }
        }
        for (let i = 0; i < lifts.length; i++) {
          const lf = lifts[i];
          if (lf.x1 <= L || lf.x0 >= R) continue;
          const t = liftTop(lf, xs);
          if (t <= c.y + 0.08 && t >= ny - 0.02 && t > best) { best = t; sup = lf; isLift = true; }
        }
        if (sup) {
          ny = best; c.vy = 0; c.gr = true; c.coy = 0; c.sup = sup; c.lift = isLift ? sup : null;
          c.ev |= EV_LAND;
          if (xs < sup.x0 || xs > sup.x1) c.ev |= EV_TEETER;
        }
      }
      c.y = ny;
    }

    // entering a ceiling volume from the side
    for (let i = 0; i < ceils.length; i++) {
      const ce = ceils[i];
      if (ce.x1 <= L || ce.x0 >= R) continue;
      if (c.y + ch > ce.y + 1e-6) {
        if (ce.lethal) { die(c, "ceiling"); return; }
        if (c.gr) { die(c, "wall"); return; }
        c.y = ce.y - ch; if (c.vy > 0) c.vy = 0; c.ev |= EV_BONK;
      }
    }

    // sealed gates
    const gates = w.gates;
    for (let i = 0; i < gates.length; i++) {
      const gt = gates[i];
      if (gt.x1 <= L || gt.x0 >= R) continue;
      const b = gateBottom(gt, sim.sw, xs);
      if (c.y < b + gt.hgt && c.y + ch > b + 0.02) { die(c, "gate"); return; }
    }
    // lethal hazards (hitboxes slightly smaller than the art)
    const sp = w.spikes;
    for (let i = 0; i < sp.length; i++) {
      const s = sp[i];
      if (s.x1 - 0.08 <= L || s.x0 + 0.08 >= R) continue;
      if (c.y < s.y + s.h && c.y + ch > s.y) { die(c, "spikes"); return; }
    }
    const pis = w.pistons;
    for (let i = 0; i < pis.length; i++) {
      const p = pis[i];
      if (p.x1 - 0.05 <= L || p.x0 + 0.05 >= R) continue;
      const b = pistonBottom(p, xs);
      if (c.y < b + p.th - 0.04 && c.y + ch > b + 0.04) { die(c, "piston"); return; }
    }
    // pressure plates (only while standing on them)
    if (c.gr) {
      const pl = w.plates;
      for (let i = 0; i < pl.length; i++) {
        const p = pl[i];
        if (p.x1 <= L || p.x0 >= R) continue;
        if (Math.abs(c.y - p.y) < 0.02 && sim.sw[p.link] === undefined) { sim.sw[p.link] = xs; c.ev |= EV_PLATE; }
      }
    }
    if (c.y < w.killY) die(c, "fell");
  }

  function stepSim(s, W, P, tap) {
    s.x += s.v * P.dt;
    s.steps++;
    stepChar(s, W[0], s.c[0], P, tap);
    stepChar(s, W[1], s.c[1], P, tap);
  }
  function anyDead(s) { return !!(s.c[0].dead || s.c[1].dead); }
  function canJump(s) {
    const a = s.c[0], b = s.c[1];
    return (!a.dead && (a.gr || a.coy > 0)) || (!b.dead && (b.gr || b.coy > 0));
  }

  // ----------------------------------------------------- 3. solver/validator
  // Depth-first search over shared tap times. A run without taps is simulated
  // until something dies; the tap that saves it must happen within one jump
  // (plus slack) before that moment, so only those candidates are explored.
  function makeSolver(P) {
    const G = 6; // candidate grid: 50 ms
    const LOOK = Math.round((P.air + 0.55) / P.dt);
    const MAXD = 9;

    // Written as generators so validation can be sliced across frames
    // (Bits may not use workers); `drive` runs one to completion.
    function* free(W, s, xEnd, B, snaps) {
      let n = 0;
      while (s.x < xEnd) {
        if (snaps && n % G === 0) snaps.push(cloneSim(s));
        stepSim(s, W, P, false);
        n++;
        if (++B.steps > B.max) { B.blown = true; return false; }
        if (anyDead(s)) return false;
        if ((B.steps & 255) === 0) yield;
      }
      return s.c[0].gr && s.c[1].gr;
    }
    function* dfs(W, s0, xEnd, depth, B, out) {
      const s = cloneSim(s0), snaps = [];
      if (yield* free(W, s, xEnd, B, snaps)) return true;
      if (B.blown || depth >= MAXD) return false;
      const minStep = s.steps - LOOK;
      for (let k = snaps.length - 1; k >= 0; k--) {
        const sn = snaps[k];
        if (sn.steps < minStep) break;
        if (k === 0 && depth > 0) continue;
        if (!canJump(sn)) continue;
        const s2 = cloneSim(sn);
        stepSim(s2, W, P, true);
        B.steps++;
        if (anyDead(s2)) continue;
        out.push(sn.steps);
        if (yield* dfs(W, s2, xEnd, depth + 1, B, out)) return true;
        out.pop();
        if (B.blown) return false;
      }
      return false;
    }
    // Finds a solution, then re-centres every tap inside its own timing window
    // (later taps re-solved each time) and reports each window's width.
    function* analyzeIt(W, s0, xEnd, minWin, maxSteps) {
      const B = { steps: 0, max: maxSteps, blown: false };
      const first = [];
      if (!(yield* dfs(W, s0, xEnd, 0, B, first))) return { ok: false, reason: B.blown ? "budget" : "unsolvable", steps: B.steps };
      const taps = [];
      let cur = cloneSim(s0), rest = first, depth = 0;
      const SC = 3, SPAN = Math.round(0.5 / P.dt), CAP = Math.round(0.7 / P.dt);
      while (rest.length) {
        const t0 = rest[0];
        const lowStep = Math.max(cur.steps + (depth > 0 ? 1 : 0), t0 - SPAN);
        const states = new Map();
        const s = cloneSim(cur);
        while (s.steps <= t0 + SPAN) {
          if (s.steps >= lowStep) states.set(s.steps, cloneSim(s));
          stepSim(s, W, P, false);
          B.steps++;
          if (anyDead(s)) break;
        }
        const test = function* (st) {
          const sn = states.get(st);
          if (!sn || !canJump(sn)) return null;
          const s2 = cloneSim(sn);
          stepSim(s2, W, P, true);
          if (anyDead(s2)) return null;
          const o = [];
          return (yield* dfs(W, s2, xEnd, depth + 1, B, o)) ? { s2, o } : null;
        };
        let lo = t0, hi = t0;
        while (hi + SC <= t0 + SPAN && !B.blown && (yield* test(hi + SC))) hi += SC;
        while (lo - SC >= lowStep && hi - lo < CAP && !B.blown && (yield* test(lo - SC))) lo -= SC;
        if (B.blown) return { ok: false, reason: "budget", steps: B.steps };
        const width = (hi - lo + SC) * P.dt;
        if (width < minWin) return { ok: false, reason: "narrow", width, steps: B.steps };
        let c = lo + Math.round((hi - lo) / 2 / SC) * SC;
        let r = yield* test(c);
        if (!r) { c = t0; r = yield* test(t0); }
        if (!r) return { ok: false, reason: "center", steps: B.steps };
        const sc = states.get(c);
        taps.push({ step: c, x: sc.x, lo, hi, width, ya: sc.c[0].y, yb: sc.c[1].y, ja: sc.c[0].gr || sc.c[0].coy > 0, jb: sc.c[1].gr || sc.c[1].coy > 0 });
        cur = r.s2; rest = r.o; depth++;
      }
      return { ok: true, taps, steps: B.steps };
    }
    function drive(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }
    function* solveIt(W, s0, xEnd, maxSteps) {
      const B = { steps: 0, max: maxSteps, blown: false };
      const out = [];
      return (yield* dfs(W, s0, xEnd, 0, B, out)) ? out : null;
    }
    return {
      analyzeIt,
      analyze: (W, s0, xEnd, minWin, maxSteps) => drive(analyzeIt(W, s0, xEnd, minWin, maxSteps)),
      solve: (W, s0, xEnd, maxSteps) => drive(solveIt(W, s0, xEnd, maxSteps))
    };
  }

  // --------------------------------------------------------- 4. generator
  // A segment = one paired challenge (1-4 beats) or a rest/reward stretch.
  // Families build both worlds around an intended shared take-off point J,
  // then the validator proves a shared solution exists with a timing window
  // at least `minWin` wide for every required tap. Rejected candidates are
  // regenerated; repeated failure falls back to a flat rest segment.
  const FAM = {
    gapgap: { cap: "GAPS AND JUMPS", min: 0, w: 1.0 },
    stepspike: { cap: "STEPS AND SPIKES", min: 0, w: 1.0 },
    ceilgap: { cap: "LOW CEILINGS", min: 2, w: 1.0 },
    split: { cap: "SPLIT HEIGHTS", min: 4, w: 0.9 },
    piston: { cap: "MOVING OBSTACLES", min: 7, w: 0.9, winK: 0.8 },
    falseop: { cap: "LOOK TWICE", min: 11, w: 0.7 },
    switch: { cap: "SWITCHES AND TIMING", min: 16, w: 0.8 },
    lift: { cap: "DRIFTING STONES", min: 24, w: 0.6 }
  };
  const FAM_ORDER = ["gapgap", "stepspike", "ceilgap", "split", "piston", "falseop", "switch", "lift"];

  function WB(x, h) { this.x = x; this.h = h; this.w = newWorld(); this.minTop = h; }
  WB.prototype.ground = function (len) {
    if (len <= 1e-6) return;
    const bl = this.w.blocks, last = bl[bl.length - 1];
    if (last && Math.abs(last.x1 - this.x) < 1e-6 && last.top === this.h) last.x1 += len;
    else bl.push({ x0: this.x, x1: this.x + len, top: this.h });
    this.x += len;
    if (this.h < this.minTop) this.minTop = this.h;
  };
  WB.prototype.to = function (x) { if (x > this.x) this.ground(x - this.x); };
  WB.prototype.gap = function (wd, dh) { this.x += wd; this.h = q10(this.h + (dh || 0)); };
  WB.prototype.rise = function (dh) { this.h = q10(this.h + dh); };
  function addSpikes(W, x0, wd) { W.w.spikes.push({ x0, x1: x0 + wd, y: W.h, h: 0.28 }); }

  function createGenerator(P, cfg, ramp, seed, withTutorial) {
    const R = rngFrom(seed);
    const solver = makeSolver(P);
    const st = { x: 3, h: [0, 0], level: 0, sinceRest: 0, restEvery: 3, recent: [], intro: {}, link: 1, pending: null, tries: 0, id: 0, queue: [], job: null };

    function kin(v, ox) {
      return { v, ox, ov: v, k: v / 4.2, D: (dh) => (v * (P.vj + Math.sqrt(Math.max(0, P.vj * P.vj - 2 * P.g * dh)))) / P.g };
    }
    const rise = (h) => (P.vj - Math.sqrt(Math.max(0, P.vj * P.vj - 2 * P.g * Math.max(0, h)))) / P.g;
    function pickDh(h, d) {
      if (R.next() < lerp(0.75, 0.5, d)) return 0;
      let up = R.chance(0.5);
      if (h > 0.6) up = false; else if (h < -0.6) up = true;
      const m = q10(R.range(0.4, lerp(0.6, 0.9, d)));
      const dh = up ? m : -m;
      if (h + dh > HMAX || h + dh < HMIN) return 0;
      return dh;
    }
    // Constraint builders in local coordinates: 0 is the centre of the intended
    // shared take-off window. [a, b] is the range of take-off positions
    // (character centre) that keeps that one world safe on its own; each family
    // makes one world bind the early edge and the other the late edge.
    function fGap(a, b, dh, K) {
      const g0 = b - P.hw - P.coyote * K.v * 0.8;
      const g1 = a + K.D(dh) - 0.03;
      return { t: "gap", x: g0, w: Math.max(0.9, g1 - g0), dh };
    }
    // A spike strip of width w is clearable from a window of D - w - ~0.57.
    // `bind` says which edge of [a, b] this world must enforce exactly.
    function fSpikes(a, b, K, bind) {
      const lead = 0.17 + rise(0.32) * K.v, tail = 0.27;
      const w = clamp(K.D(0) - lead - tail - (b - a), 0.4, 1.3);
      const q0 = bind === "a" ? a + K.D(0) - tail - w : b + lead;
      return { t: "spikes", x: q0, w };
    }
    function fCeil(a, len, K) {
      const x1 = a - P.hw + rise(0.36) * K.v - 0.03;
      return { t: "ceil", x: x1 - len, x1 };
    }
    function fStep(b, dh, K) { return { t: "step", x: b + P.hw + rise(dh - P.stepTol + 0.05) * K.v + 0.03, dh }; }
    function fPlate(a) { return { t: "plate", x: a + P.hw - 0.05, w: 0.9 }; }
    function loose(K) { return R.range(0.15, 0.7) * K.k; }

    const FN = {
      gapgap(K, tw, d, X, Y) {
        const maxW = K.D(0) + P.hw + P.coyote * K.v * 0.8 - 0.95;
        const room = Math.max(0, maxW - tw);
        return [
          [X, [fGap(-tw / 2 - Math.min(loose(K), room), tw / 2, pickDh(X.h, d), K)]],
          [Y, [fGap(-tw / 2, tw / 2 + Math.min(loose(K), room), pickDh(Y.h, d), K)]]
        ];
      },
      stepspike(K, tw, d, X, Y) {
        const dh = q10(R.range(0.4, lerp(0.55, 0.8, d)));
        const xs = X.h + dh > HMAX ? fGap(-tw / 2 - loose(K) * 0.5, tw / 2, -0.5, K) : fStep(tw / 2, dh, K);
        return [[X, [xs]], [Y, [fSpikes(-tw / 2, tw / 2 + loose(K), K, "a")]]];
      },
      ceilgap(K, tw, d, X, Y) {
        return [
          [X, [fCeil(-tw / 2, R.range(1.1, 1.9) * K.k, K)]],
          [Y, [fGap(-tw / 2 - loose(K), tw / 2, pickDh(Y.h, d * 0.6), K)]]
        ];
      },
      falseop(K, tw, d, X, Y) {
        // the copy-world spikes look jumpable long before it is safe for the other world
        return [
          [X, [fCeil(-tw / 2, R.range(2.2, 2.8) * K.k, K)]],
          [Y, [fSpikes(-tw / 2 - R.range(0.9, 1.4) * K.k, tw / 2, K, "b")]]
        ];
      },
      split(K, tw, d, X, Y) {
        if (X.h > Y.h) { const t = X; X = Y; Y = t; }
        let up = q10(R.range(0.4, lerp(0.6, 0.8, d)));
        if (X.h + up > HMAX) up = 0;
        let dn = -q10(R.range(0.5, lerp(0.8, 1.1, d)));
        if (Y.h + dn < HMIN) dn = 0;
        return [
          [X, [fGap(-tw / 2 - loose(K) * 0.5, tw / 2, up, K)]],
          [Y, [fGap(-tw / 2, tw / 2 + loose(K), dn, K)]]
        ];
      },
      piston(K, tw, d, X, Y, plan) {
        const per = R.range(2.0, 2.8) * lerp(1.15, 0.8, d);
        const down = plan && plan.forceDown ? true : R.chance(0.7);
        const pc = R.range(0.75, 1.15) * K.k;
        return [
          [X, [fGap(-tw / 2, tw / 2, pickDh(X.h, d * 0.5), K)]],
          [Y, [{ t: "piston", x: pc - 0.24, w: 0.48, per, down }]]
        ];
      },
      switch(K, tw, d, X, Y) {
        const plate = fPlate(-tw / 2);
        const fx = [plate];
        if (R.chance(0.5)) {
          const gp = fGap(-tw / 2 - loose(K), tw / 2 + loose(K), 0, K);
          if (gp.x > plate.x + plate.w + 0.05) fx.push(gp);
        }
        return [
          [X, fx],
          [Y, [fSpikes(-tw / 2 - loose(K), tw / 2, K, "b"), { t: "gate", x: tw / 2 + K.D(0) + R.range(0.9, 1.4) * K.k }]]
        ];
      },
      lift(K, tw, d, X, Y) {
        // hop onto a drifting stone, then hop off in time with the other world's spikes
        const D = K.D(0), lw = 2.0;
        const tw1 = Math.max(tw, 0.34 * K.v);
        const g0 = tw1 / 2 - P.hw - P.coyote * K.v * 0.8;
        const lx0 = -tw1 / 2 + D;
        const lx1 = lx0 + lw;
        const hi2 = lx1 + 0.3 - R.range(0, 0.25) * K.k;
        const g1 = lx1 + R.range(0.7, 1.0) * K.k;
        return [
          [X, [{ t: "gap", x: g0, w: g1 - g0, dh: 0 }, { t: "lift", x: lx0, w: lw, per: R.range(2.2, 3.0), amp: R.range(0.2, 0.36), landX: D }]],
          [Y, [fSpikes(hi2 - tw - loose(K), hi2, K, "b")]]
        ];
      }
    };
    function applyFeats(W, feats, J, K, link, out) {
      feats.sort((a, b) => a.x - b.x);
      for (const f of feats) {
        const x = J + f.x;
        if (f.t === "gap") { W.to(x); W.gap(f.w, f.dh); }
        else if (f.t === "spikes") { W.to(x); addSpikes(W, x, f.w); W.to(x + f.w); }
        else if (f.t === "ceil") { W.to(J + f.x1 + 0.4); W.w.ceils.push({ x0: x, x1: J + f.x1, y: W.h + 1.05, lethal: true }); }
        else if (f.t === "step") { W.to(x); W.rise(f.dh); }
        else if (f.t === "plate") {
          W.to(x);
          out.plate = { x0: x, x1: x + f.w, y: W.h, link };
          W.w.plates.push(out.plate);
          W.to(x + f.w);
        } else if (f.t === "piston") {
          W.to(x + f.w + 0.6);
          const a0 = f.down ? R.range(-0.45, 0.45) : Math.PI + R.range(-0.6, 0.6);
          const ph = a0 - (TAU * ((x + f.w / 2 - K.ox) / K.ov)) / f.per;
          W.w.pistons.push({ x0: x, x1: x + f.w, base: W.h, lo: 0, hi: 2.45, th: 0.5, per: f.per, ph, ox: K.ox, ov: K.ov });
        } else if (f.t === "lift") {
          const a0 = Math.PI / 2 + R.range(-0.5, 0.5);
          const ph = a0 - (TAU * ((J + f.landX - K.ox) / K.ov)) / f.per;
          W.w.lifts.push({ x0: x, x1: x + f.w, base: W.h, lo: -f.amp, hi: f.amp, th: 0.42, per: f.per, ph, ox: K.ox, ov: K.ov });
        } else if (f.t === "gate") {
          const gx = Math.max(x, W.x + 1.0);
          W.to(gx);
          out.gate = { x0: gx, x1: gx + 0.34, y0: W.h, hgt: 2.7, link, ov: K.ov };
          W.w.gates.push(out.gate);
          W.to(gx + 0.95);
        }
      }
    }

    // ---- authored opening (first ~60 seconds) ----
    function tutorialPlans() {
      return [
        { kind: "intro", custom: "same", caption: "ONE TAP. TWO WORLDS.", speedK: 0.88 },
        { kind: "challenge", custom: "echo", caption: "LEARN THE ECHO", speedK: 0.9 },
        { kind: "challenge", custom: "sync", caption: "GAPS AND JUMPS", speedK: 0.92, teachSync: true },
        { kind: "challenge", fams: ["ceilgap"], d: 0, caption: "LOOK AT BOTH", hint: "WAIT UNTIL BOTH ARE CLEAR", speedK: 0.95, relax: 0.04 },
        { kind: "challenge", fams: ["piston"], d: 0, caption: "MOVING OBSTACLES", forceDown: true, speedK: 0.97 },
        { kind: "rest", caption: "BREATHE" },
        { kind: "challenge", fams: ["stepspike"], d: 0.05, caption: "THREE IN A ROW", trio: 1 },
        { kind: "challenge", fams: ["gapgap"], d: 0.1, caption: "THREE IN A ROW", trio: 2 },
        { kind: "challenge", fams: ["split"], d: 0.12, caption: "THREE IN A ROW", trio: 3 },
        { kind: "reward", caption: "PRISMS" }
      ];
    }
    function buildCustom(plan, A, B) {
      const x = A.x;
      if (plan.custom === "same") {
        A.to(x + 3.4); A.gap(1.0, 0); A.to(A.x + 3.2);
        B.to(x + 3.4); B.gap(1.0, 0); B.to(B.x + 3.2);
      } else if (plan.custom === "echo") {
        A.to(x + 1.8); A.gap(1.1, 0); A.to(A.x + 3.2);
        B.to(x + 2.05); B.rise(0.5); B.to(A.x);
      } else if (plan.custom === "sync") {
        A.to(x + 1.9); addSpikes(A, x + 1.9, 0.6); A.to(x + 6.6);
        B.to(x + 1.6); B.gap(1.15, -0.5); B.to(x + 6.6);
      }
    }

    function planNext() {
      if (st.queue.length) return st.queue.shift();
      const d = ramp(st.level);
      if (st.sinceRest >= st.restEvery) {
        st.sinceRest = 0;
        st.restEvery = R.int(d < 0.3 ? 3 : 4, d < 0.6 ? 4 : 6);
        return { kind: R.chance(0.45) ? "reward" : "rest" };
      }
      const avail = FAM_ORDER.filter((k) => FAM[k].min <= st.level);
      const fresh = avail.filter((k) => !st.intro[k] && FAM[k].min > 0);
      if (fresh.length) return { kind: "challenge", fams: [fresh[0]], d: d * 0.7, intro: true, relax: 0.05 };
      const beats = d < 0.12 ? 1 : d < 0.35 ? (R.chance(0.7) ? 1 : 2) : d < 0.6 ? R.pick([1, 2, 2, 3]) : R.pick([2, 3, 3, 4]);
      const fams = [];
      for (let i = 0; i < beats; i++) {
        let tot = 0;
        const last = fams.length ? fams[fams.length - 1] : st.recent[st.recent.length - 1];
        const ws = avail.map((k) => {
          let w = FAM[k].w;
          if (k === last) w *= 0.08;
          if (st.recent.slice(-5).filter((r) => r === k).length >= 2) w *= 0.3;
          if ((k === "switch" || k === "lift") && fams.indexOf(k) >= 0) w = 0;
          tot += w;
          return w;
        });
        let r = R.next() * tot, pick = avail[0];
        for (let j = 0; j < avail.length; j++) { r -= ws[j]; if (r <= 0) { pick = avail[j]; break; } }
        fams.push(pick);
      }
      return { kind: "challenge", fams, d };
    }

    function finishSegment(seg, A, B) {
      seg.x1 = Math.max(A.x, B.x);
      A.to(seg.x1); B.to(seg.x1);
      seg.w = [A.w, B.w];
      seg.h1 = [A.h, B.h];
      seg.minTop = [Math.min(A.minTop, seg.h0[0]), Math.min(B.minTop, seg.h0[1])];
      A.w.killY = seg.minTop[0] - 2.2;
      B.w.killY = seg.minTop[1] - 2.2;
    }

    function build(plan) {
      const d = plan.d !== undefined ? plan.d : ramp(st.level);
      const v = cfg.vStart * (plan.speedK || 1) + (plan.speedK ? 0 : (cfg.vMax - cfg.vStart) * Math.pow(clamp(d, 0, 1), 1.1));
      const x0 = st.x;
      const A = new WB(x0, st.h[0]), B = new WB(x0, st.h[1]);
      const K = kin(v, x0);
      const seg = {
        id: ++st.id, kind: plan.kind, plan, x0, v, d,
        h0: [st.h[0], st.h[1]], fams: plan.fams || [],
        caption: plan.caption || "", hint: plan.hint || "",
        teachSync: !!plan.teachSync, trio: plan.trio || 0,
        clearX: x0, hard: false
      };
      if (plan.custom) {
        buildCustom(plan, A, B);
        seg.clearX = Math.max(A.x, B.x) - 2.4;
      } else if (plan.kind === "challenge") {
        const fams = plan.fams;
        const minWin = lerp(cfg.winStart, cfg.winEnd, d) + (plan.relax || 0);
        let prevTw = 0, lastHi = x0;
        for (let i = 0; i < fams.length; i++) {
          const swap = R.chance(0.5);
          const X = swap ? B : A, Y = swap ? A : B;
          const tw = Math.min(K.D(0) - 1.05, Math.max(minWin + 0.04, lerp(cfg.winStart * 1.3, cfg.winEnd * 1.6, d) * R.range(0.95, 1.3)) * v);
          const parts = FN[fams[i]](K, tw, d, X, Y, plan);
          let minL = -tw / 2;
          for (const pr of parts) for (const f of pr[1]) if (f.t !== "gate") minL = Math.min(minL, f.x);
          // later beats leave room for the previous landing, then a short run-up
          const gapBefore = i === 0 ? lerp(1.2, 0.8, d) + R.range(0, 0.4) : prevTw / 2 + (lerp(0.7, 0.25, d) + R.range(0, 0.3)) * K.k;
          let J = Math.max(A.x, B.x) + gapBefore - minL;
          // overhead hazards must start beyond the previous beat's latest landing
          if (i > 0) {
            let minHigh = Infinity;
            for (const pr of parts) for (const f of pr[1]) if (f.t === "ceil" || f.t === "piston") minHigh = Math.min(minHigh, f.x);
            if (minHigh < Infinity) J = Math.max(J, lastHi + K.D(-0.6) + 0.25 - minHigh);
          }
          prevTw = tw;
          let maxEnd = -Infinity;
          for (const pr of parts) for (const f of pr[1]) if (f.t !== "gate") maxEnd = Math.max(maxEnd, f.t === "ceil" ? f.x1 : f.x + (f.w || 0));
          lastHi = J + Math.max(tw / 2, maxEnd - 0.4);
          const out = {};
          const link = st.link++;
          parts.sort((p1, p2) => (p2[1].some((f) => f.t === "plate") ? 1 : 0) - (p1[1].some((f) => f.t === "plate") ? 1 : 0));
          for (const pr of parts) applyFeats(pr[0], pr[1], J, K, link, out);
          if (out.plate && out.gate) out.plate.gateX = out.gate.x0 + 0.17;
          const e = Math.max(A.x, B.x);
          A.to(e); B.to(e);
        }
        seg.clearX = Math.max(A.x, B.x) + 0.25;
        // the exit runway must catch the latest valid jump of the last beat
        const end = Math.max(seg.clearX + lerp(1.7, 1.0, d) + R.range(0, 0.4), lastHi + K.D(-0.6) + 0.35);
        A.to(end); B.to(end);
        if (!seg.caption) seg.caption = FAM[fams[0]].cap;
        seg.hard = fams.length >= 2 || d >= 0.5;
      } else if (plan.kind === "rest") {
        for (const W of [A, B]) {
          if (W.h > 0.45) { W.to(x0 + R.range(1.4, 2.4)); W.rise(-Math.min(0.6, q10(W.h))); }
        }
        const len = R.range(5.0, 6.8);
        A.to(x0 + len); B.to(x0 + len);
        if (st.level >= 10 && R.chance(0.45)) {
          const Wa = R.chance(0.5) ? A : B;
          const ax = x0 + len * R.range(0.45, 0.7);
          const top = blockTopAt(Wa.w, ax);
          if (top !== null && blockTopAt(Wa.w, ax + 0.8) === top) Wa.w.ceils.push({ x0: ax, x1: ax + 0.8, y: top + 1.3, lethal: false, arch: true });
        }
        seg.caption = plan.caption || "BREATHE";
        seg.clearX = x0 + len;
      } else if (plan.kind === "reward") {
        const n = 3, D = K.D(0);
        const lead = 1.8, spacing = D + 1.1;
        const len = lead + n * spacing + 0.8;
        A.to(x0 + len); B.to(x0 + len);
        const pattern = R.pick([[1, 2, 3], [3, 1, 3], [1, 2, 1], [2, 1, 3]]); // 1 = original, 2 = copy, 3 = both
        let twin = 1000 + st.id * 10;
        for (let k = 0; k < n; k++) {
          const xj = x0 + lead + k * spacing;
          const ax = xj + v * (P.Tup + P.dt);
          const who = pattern[k];
          const tg = who === 3 ? twin++ : 0;
          if (who & 1) A.w.prisms.push({ x: ax, y: st.h[0] + P.H + P.ch * 0.5, twin: tg, taken: false });
          if (who & 2) B.w.prisms.push({ x: ax, y: st.h[1] + P.H + P.ch * 0.5, twin: tg, taken: false });
        }
        seg.caption = plan.caption || "PRISM ROUTE";
        seg.clearX = x0 + len;
      } else { // intro-only flat
        A.to(x0 + 5); B.to(x0 + 5);
      }
      finishSegment(seg, A, B);
      return seg;
    }

    function blockTopAt(w, x) {
      for (const b of w.blocks) if (x >= b.x0 && x <= b.x1) return b.top;
      return null;
    }

    function addChallengePrisms(seg, res) {
      if (!res.taps.length) return;
      const k = R.int(0, res.taps.length - 1);
      const t = res.taps[k];
      const who = R.pick([1, 2, 3]);
      const ax = t.x + seg.v * (P.Tup + P.dt);
      const tg = who === 3 ? 2000 + seg.id : 0;
      const place = (w, y0, can) => {
        if (!can) return;
        const py = y0 + P.H + P.ch * 0.5;
        for (const ce of w.ceils) if (ce.x1 > ax - 0.5 && ce.x0 < ax + 0.5 && ce.y < py + 0.6) return;
        for (const p of w.pistons) if (p.x1 > ax - 0.8 && p.x0 < ax + 0.8) return;
        w.prisms.push({ x: ax, y: py, twin: tg, taken: false });
      };
      if (who & 1) place(seg.w[0], t.ya, t.ja);
      if (who & 2) place(seg.w[1], t.yb, t.jb);
    }

    function validate(seg, minWin) {
      const s0 = newSim(seg.x0, seg.v, seg.h0[0], seg.h0[1]);
      return solver.analyze(seg.w, s0, seg.x1, minWin, 240000);
    }

    function commit(seg) {
      st.x = seg.x1;
      st.h = [seg.h1[0], seg.h1[1]];
      if (seg.kind === "challenge") {
        st.level++;
        st.sinceRest++;
        for (const f of seg.fams) { st.recent.push(f); st.intro[f] = true; }
        if (st.recent.length > 12) st.recent.splice(0, st.recent.length - 12);
      }
      st.pending = null;
      st.tries = 0;
    }

    // One candidate = build + validate. Validation is an iterator so the live
    // game can advance it a few milliseconds per frame.
    function startJob() {
      if (!st.pending) st.pending = planNext();
      const plan = st.pending;
      st.tries++;
      if (plan.fams && plan.fams.length > 1 && st.tries % 5 === 0) plan.fams = plan.fams.slice(0, -1); // simplify a stubborn sequence
      if (st.tries > 16) {
        // could not satisfy this plan: fall back to a guaranteed rest stretch
        st.pending = { kind: "rest" };
        st.tries = 0;
        return startJob();
      }
      const seg = build(plan);
      let minWin = 0;
      if (plan.kind === "challenge") {
        minWin = plan.custom ? cfg.winStart : lerp(cfg.winStart, cfg.winEnd, seg.d) + (plan.relax || 0);
        for (const f of plan.fams || []) if (FAM[f].winK) minWin = Math.max(cfg.winEnd, minWin * FAM[f].winK);
      }
      const s0 = newSim(seg.x0, seg.v, seg.h0[0], seg.h0[1]);
      st.job = { plan, seg, it: solver.analyzeIt(seg.w, s0, seg.x1, minWin, 240000) };
    }
    function finishJob(res) {
      const { plan, seg } = st.job;
      st.job = null;
      if (!res.ok) return null;
      if (plan.kind === "challenge" && res.taps.length === 0) return null;
      seg.solution = res.taps;
      seg.minWindow = res.taps.reduce((m, t) => Math.min(m, t.width), 9);
      if (plan.kind === "challenge" && !plan.custom && seg.d >= 0.12 && R.chance(0.3)) addChallengePrisms(seg, res);
      commit(seg);
      return seg;
    }
    function work(deadline) {
      for (;;) {
        if (!st.job) startJob();
        let r = st.job.it.next();
        while (!r.done && performance.now() < deadline) r = st.job.it.next();
        if (!r.done) return null;
        const seg = finishJob(r.value);
        if (seg) return seg;
        if (performance.now() >= deadline) return null;
      }
    }
    function tryNext() {
      if (!st.job) startJob();
      let r = st.job.it.next();
      while (!r.done) r = st.job.it.next();
      return finishJob(r.value);
    }

    function startSegment() {
      const A = new WB(-12, 0), B = new WB(-12, 0);
      A.to(st.x); B.to(st.x);
      const seg = { id: ++st.id, kind: "start", plan: {}, x0: -12, v: cfg.vStart * (withTutorial ? 0.88 : 1), d: 0, h0: [0, 0], fams: [], caption: withTutorial ? "ONE TAP. TWO WORLDS." : "", hint: "", clearX: 0, solution: [] };
      finishSegment(seg, A, B);
      return seg;
    }

    if (withTutorial) st.queue = tutorialPlans();
    return { tryNext, work, startSegment, state: st, validate, build, solver };
  }

  // ------------------------------------------------------------- 5. audio
  function createAudio(ctx) {
    let ac = null, master = null, noiseBuf = null, muted = false, vol = 0.7, failed = false;
    function ensure() {
      if (ac || failed) return ac;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return null; }
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : vol;
        const comp = ac.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.4), ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { failed = true; ac = null; }
      return ac;
    }
    function tone(f0, dur, type, gain, f1, delay) {
      const t0 = ac.currentTime + 0.004 + (delay || 0);
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(dur, gain, cutoff, delay) {
      const t0 = ac.currentTime + 0.004 + (delay || 0);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
      src.buffer = noiseBuf;
      f.type = "lowpass"; f.frequency.value = cutoff;
      gn.gain.setValueAtTime(gain, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(gn); gn.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.02);
    }
    const SFX = {
      jump0() { tone(250, 0.12, "triangle", 0.16, 420); },
      jump1() { tone(375, 0.11, "sine", 0.12, 640); },
      land0() { noise(0.06, 0.12, 700); tone(130, 0.08, "sine", 0.14, 85); },
      land1() { noise(0.05, 0.08, 1600); tone(205, 0.07, "sine", 0.1, 140); },
      pair() { tone(523, 0.14, "sine", 0.06); tone(659, 0.16, "sine", 0.05, null, 0.03); },
      sync() { tone(784, 0.2, "sine", 0.11); tone(1175, 0.26, "sine", 0.08, null, 0.06); },
      perfect() { tone(659, 0.16, "triangle", 0.09); tone(880, 0.16, "triangle", 0.09, null, 0.07); tone(1319, 0.3, "sine", 0.09, null, 0.14); },
      prism() { tone(1568, 0.25, "sine", 0.07); tone(2093, 0.3, "sine", 0.05, null, 0.05); },
      combo(n) { tone(440 * Math.pow(2, Math.min(n, 12) / 12), 0.09, "triangle", 0.05); },
      comboLost() { tone(392, 0.14, "triangle", 0.07, 330); tone(311, 0.2, "triangle", 0.06, 262, 0.1); },
      bonk() { tone(190, 0.07, "square", 0.04, 120); noise(0.04, 0.06, 1200); },
      plate() { tone(330, 0.1, "square", 0.035); tone(495, 0.14, "triangle", 0.05, null, 0.05); },
      fail() { tone(330, 0.6, "triangle", 0.14, 98); noise(0.3, 0.1, 700); },
      restart() { tone(220, 0.2, "sine", 0.07, 440); },
      milestone() { tone(523, 0.18, "triangle", 0.08); tone(784, 0.18, "triangle", 0.08, null, 0.09); tone(1047, 0.4, "sine", 0.08, null, 0.18); }
    };
    return {
      unlock() { if (ensure() && ac.state === "suspended") ac.resume().catch(() => {}); },
      play(name, arg) {
        if (muted || !ensure() || !SFX[name]) return;
        try { if (ac.state === "suspended") ac.resume().catch(() => {}); SFX[name](arg); } catch (e) { /* audio is optional */ }
      },
      setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : vol; },
      setVolume(v) { vol = v; if (master && !muted) master.gain.value = v; },
      get muted() { return muted; },
      dispose() { try { if (ac) ac.close(); } catch (e) { /* ignore */ } ac = null; }
    };
  }

  // ---------------------------------------------------------------- 6. Bit
  const FONT = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
  const PALETTES = {
    day: {
      sky: [["#6d988d", 0], ["#a9bfa2", 0.5], ["#e6e1c0", 1]],
      skyC: [["#78a5a2", 0], ["#b2ccbf", 0.5], ["#e4e8d3", 1]],
      sun: "#f7efcf", sunC: "#eef6ea", haze: [236, 233, 210], hazeC: [229, 237, 226],
      towers: ["#b8c6ad", "#9fb39b", "#879f8a"], towersC: ["#bccdc3", "#a2bab1", "#8aa69f"],
      top: "#f1e3c4", front: "#e0cba3", left: "#c8b089", topC: "#ece6cf", frontC: "#d9d0b0", leftC: "#c0b898",
      mortar: "rgba(120,92,60,0.15)", ao: "rgba(110,84,55,0.22)", shade: "rgba(70,60,40,0.16)",
      iron: "#47464b", ironL: "#615f66", ironD: "#323136", terra: "#d0623a", terraD: "#a6492a", terraL: "#e98a5c",
      leaf: "#6f9150", leafD: "#56763f", leafL: "#8eab67", cypress: "#4f7044", trunk: "#7b6246",
      orig: ["#e2733d", "#f3a06b", "#b4522a", "#3a2a22"], copy: ["#a6dfd8", "#d3f3ee", "#7cbab4", "#294744"],
      ink: "#2e3a35", cream: "#f7f1dc", veil: "rgba(232,229,208,0.84)", prism: "#e6f7f6", prismD: "#8dc6cb"
    },
    dusk: {
      sky: [["#7d7f92", 0], ["#d29a7f", 0.55], ["#f1cfa0", 1]],
      skyC: [["#73879a", 0], ["#b7a7a3", 0.55], ["#ead9bb", 1]],
      sun: "#ffe3b8", sunC: "#f4ecdf", haze: [240, 212, 180], hazeC: [226, 220, 210],
      towers: ["#c7a497", "#a98a86", "#8a7378"], towersC: ["#b0aab0", "#949099", "#7b7987"],
      top: "#f3dcc0", front: "#ddbf9b", left: "#c2a07f", topC: "#e6dccd", frontC: "#d0c3ae", leftC: "#b6a993",
      mortar: "rgba(120,80,60,0.16)", ao: "rgba(100,64,50,0.24)", shade: "rgba(70,40,40,0.18)",
      iron: "#45404a", ironL: "#615a66", ironD: "#302c35", terra: "#d05a3a", terraD: "#a2412a", terraL: "#ec8a62",
      leaf: "#6b8550", leafD: "#526a40", leafL: "#8aa067", cypress: "#4c6644", trunk: "#775c46",
      orig: ["#e46d3c", "#f59b68", "#b14c2a", "#3a2a22"], copy: ["#a9dcd9", "#d6f1f0", "#7db4b6", "#294447"],
      ink: "#352f36", cream: "#fbf0dc", veil: "rgba(236,220,204,0.86)", prism: "#f6eef4", prismD: "#c3a7c4"
    }
  };
  const CAUSE = {
    fell: "FELL INTO THE MIST",
    wall: "RAN INTO A WALL",
    spikes: "TOUCHED THE SPIKES",
    ceiling: "HIT A SPIKED CEILING",
    piston: "WAS CAUGHT BY A PISTON",
    gate: "MET A SEALED GATE"
  };
  const MILESTONES = [
    { at: 10, id: "ivy", name: "IVY" },
    { at: 25, id: "lanterns", name: "LANTERNS" },
    { at: 50, id: "dusk", name: "DUSK ATMOSPHERE" },
    { at: 100, id: "gilded", name: "GILDED PAIR" }
  ];

  window.plethoraBit = {
    meta: {
      title: "Copycat",
      runtime: "plethora-bit@2",
      tags: ["arcade", "endless", "one-tap", "puzzle"],
      permissions: ["haptics", "storage", "audio"]
    },

    async init(ctx) {
      const TEST = (typeof window !== "undefined" && window.__COPYCAT_TEST__) || null;
      let disposed = false;
      ctx.onDestroy(() => { disposed = true; });

      // ---- tuning ----
      const tune = (id, fb) => {
        try {
          if (!ctx.tune || !ctx.tune.has || !ctx.tune.has(id)) return fb;
          const v = ctx.tune.get(id);
          return v === undefined || v === null ? fb : v;
        } catch (e) { return fb; }
      };
      const cfg = {
        vStart: tune("run_speed_start", 4.2),
        vMax: tune("run_speed_max", 6.2),
        jumpHeight: tune("jump_height", 1.55),
        airTime: tune("jump_air_time", 0.62),
        coyote: tune("coyote_ms", 80) / 1000,
        buffer: tune("buffer_ms", 120) / 1000,
        winStart: tune("min_window_start_ms", 320) / 1000,
        winEnd: tune("min_window_end_ms", 130) / 1000,
        sync: tune("sync_precision", 0.6),
        links: tune("show_link_lines", true),
        sfx: tune("sfx_volume", 0.7)
      };
      if (cfg.vMax < cfg.vStart) cfg.vMax = cfg.vStart;
      let curve = null;
      try { if (ctx.tune && ctx.tune.has && ctx.tune.has("difficulty_ramp")) curve = ctx.tune.curve("difficulty_ramp"); } catch (e) { curve = null; }
      const DEFAULT_RAMP = [[0, 0], [8, 0.12], [20, 0.36], [40, 0.66], [70, 0.9], [110, 1]];
      const ramp = (level) => {
        if (curve) { try { const v = curve.at(level); if (Number.isFinite(v)) return clamp(v, 0, 1); } catch (e) { /* fall through */ } }
        for (let i = 1; i < DEFAULT_RAMP.length; i++) {
          const a = DEFAULT_RAMP[i - 1], b = DEFAULT_RAMP[i];
          if (level <= b[0]) return lerp(a[1], b[1], (level - a[0]) / (b[0] - a[0]));
        }
        return 1;
      };
      if (ctx.tune && ctx.tune.onChange) {
        try {
          ctx.tune.onChange(["show_link_lines", "sfx_volume", "sync_precision"], () => {
            cfg.links = tune("show_link_lines", true);
            cfg.sync = tune("sync_precision", 0.6);
            cfg.sfx = tune("sfx_volume", 0.7);
            audio.setVolume(cfg.sfx);
          });
        } catch (e) { /* optional */ }
      }
      const P = makePhys(cfg);

      // ---- persistence (optional) ----
      const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
      const save = { best: 0, bestPairs: 0, bestCombo: 0, perfects: 0, unlocks: [], tutorialDone: false, muted: false, atmosphere: "day" };
      if (canStore) {
        try { const v = ctx.storage.get("copycat.v1"); if (v && typeof v === "object") Object.assign(save, v); } catch (e) { /* ignore */ }
      }
      if (!Array.isArray(save.unlocks)) save.unlocks = [];
      const persist = () => { if (!canStore) return; try { ctx.storage.set("copycat.v1", save); } catch (e) { /* ignore */ } };
      const has = (id) => save.unlocks.indexOf(id) >= 0;

      const audio = createAudio(ctx);
      audio.setMuted(!!save.muted);
      audio.setVolume(cfg.sfx);
      ctx.onDestroy(() => audio.dispose());
      const haptic = (k) => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) { /* ignore */ } };

      // ---- surfaces ----
      const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 2, coordinateSpace: "css", alpha: false, touchAction: "none" });
      const g = canvas.getContext("2d");
      const input = ctx.input.track(canvas);
      let scoreTrack = null;
      try { scoreTrack = ctx.game.score({ initial: 0, min: 0 }); } catch (e) { scoreTrack = null; }

      // fonts are optional polish: system fallbacks render immediately
      (async () => {
        try {
          await Promise.all([
            ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }),
            ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" })
          ]);
        } catch (e) { /* keep the system font */ }
      })();

      // ---- layout ----
      const L = { W: 360, H: 640, mode: "stack", sa: { top: 0, bottom: 0, left: 0, right: 0 }, panels: [], skyGrad: [null, null], fogGrad: [null, null] };
      function viewW(v) { return clamp(8.2 + (v - 4.2) * 1.0, 7.8, 11); }
      function layout() {
        L.W = Math.max(1, ctx.width); L.H = Math.max(1, ctx.height);
        L.sa = ctx.safeArea || L.sa;
        const vw = viewW(cfg.vStart);
        const sSt = Math.min(L.W / vw, L.H / 2 / 5.6);
        const sSi = Math.min(L.W / 2 / vw, L.H / 5.6);
        L.mode = sSi > sSt * 1.02 ? "side" : "stack";
        const pw = L.mode === "side" ? L.W / 2 : L.W, ph = L.mode === "side" ? L.H : L.H / 2;
        const prev = L.panels;
        L.panels = [0, 1].map((i) => ({
          i,
          x: L.mode === "side" ? i * pw : 0,
          y: L.mode === "side" ? 0 : i * ph,
          w: pw, h: ph,
          anchorX: pw * 0.27,
          anchorY: ph * (L.mode === "side" ? 0.6 : i === 0 ? 0.64 : 0.58),
          s: 40, camX: 0, camY: prev[i] ? prev[i].camY : 0, camT: prev[i] ? prev[i].camT : 0,
          ax: 0, ay: 0, dx: 0, dy: 0
        }));
        for (let i = 0; i < 2; i++) {
          const p = L.panels[i];
          const pal = palette();
          const stops = i === 0 ? pal.sky : pal.skyC;
          const gr = g.createLinearGradient(0, p.y, 0, p.y + p.h);
          for (const s of stops) gr.addColorStop(s[1], s[0]);
          L.skyGrad[i] = gr;
          const hz = i === 0 ? pal.haze : pal.hazeC;
          const fg = g.createLinearGradient(0, p.y + p.h * 0.66, 0, p.y + p.h);
          fg.addColorStop(0, `rgba(${hz[0]},${hz[1]},${hz[2]},0)`);
          fg.addColorStop(0.55, `rgba(${hz[0]},${hz[1]},${hz[2]},0.72)`);
          fg.addColorStop(1, `rgba(${hz[0]},${hz[1]},${hz[2]},0.97)`);
          L.fogGrad[i] = fg;
        }
      }
      function palette() { return PALETTES[save.atmosphere === "dusk" && has("dusk") ? "dusk" : "day"]; }

      // ---- run state ----
      let RUN = null;
      let state = "ready"; // ready | playing | dying | over
      let stateT = 0;
      let clock = 0;
      const ringN = 24;
      const ring = [];
      for (let i = 0; i < ringN; i++) ring.push(newSim(0, 0, 0, 0));

      function newRun(first) {
        const tutorial = !save.tutorialDone;
        const seed = TEST && TEST.seed ? TEST.seed : (Math.random() * 1e9) | 0;
        const gen = createGenerator(P, cfg, ramp, seed, tutorial);
        const start = gen.startSegment();
        const W = [newWorld(), newWorld()];
        const run = {
          seed, gen, W, segs: [], segIdx: 0, tutorial,
          sim: newSim(0, start.v, 0, 0),
          prevX: 0, prevY: [0, 0],
          score: 0, pairs: 0, combo: 0, bestCombo: 0, perfects: 0, prisms: 0,
          tapQueue: 0, lastTapStep: -999, beat: null, ringCount: 0,
          dead: -1, cause: null, newBest: false, pbAnnounced: false, unlockedNow: [],
          fx: { floats: [], parts: [], toasts: [], shards: [] },
          anim: [mkAnim(), mkAnim()], trail: [[], []],
          caption: start.caption, captionN: 0, captionT: 0, hint: "", hintT: 0,
          auto: null, perfectFlash: 0, startedAt: 0
        };
        appendSeg(run, start);
        RUN = run;
        // generate a comfortable lead synchronously
        fillAhead(run, 26, 200);
        return run;
      }
      function mkAnim() { return { sqx: 1, sqy: 1, land: 0, jump: 0, teeter: 0, bonk: 0, blink: 0, pulse: 0, airPrev: false }; }

      function appendSeg(run, seg) {
        seg.counts = [{}, {}];
        for (let i = 0; i < 2; i++) {
          const src = seg.w[i], dst = run.W[i];
          for (const k of ["blocks", "ceils", "spikes", "pistons", "lifts", "gates", "plates", "prisms"]) {
            const arr = src[k];
            seg.counts[i][k] = arr.length;
            for (let j = 0; j < arr.length; j++) dst[k].push(arr[j]);
          }
          for (const b of src.blocks) {
            if (b.deco) continue;
            const hz = [];
            for (const k of ["spikes", "ceils", "pistons", "gates", "plates"]) for (const o of src[k]) hz.push(o);
            b.deco = makeDeco(b, i).filter((d) => d.t === "vine" || d.t === "arch" || d.t === "banner" || !hz.some((o) => d.x > o.x0 - 0.9 && d.x < o.x1 + 0.9));
          }
        }
        seg.cleared = false; seg.mistake = false; seg.beats = 0; seg.beatsSync = 0;
        run.segs.push(seg);
        updateKill(run);
      }
      function updateKill(run) {
        for (let i = 0; i < 2; i++) {
          let m = 99;
          for (const s of run.segs) m = Math.min(m, s.minTop[i]);
          run.W[i].killY = m - 2.2;
        }
      }
      function dropOld(run) {
        while (run.segs.length > 2 && run.segs[0].x1 < run.sim.x - 14 && run.segIdx > 0) {
          const seg = run.segs.shift();
          run.segIdx--;
          for (let i = 0; i < 2; i++) {
            for (const k in seg.counts[i]) {
              const n = seg.counts[i][k];
              if (n) run.W[i][k].splice(0, n);
            }
          }
          updateKill(run);
        }
      }
      function genEnd(run) { return run.segs[run.segs.length - 1].x1; }
      // generation is spread over frames; each attempt is bounded by the solver budget
      function fillAhead(run, ahead, budgetMs) {
        const deadline = performance.now() + budgetMs;
        let guard = 0;
        while (genEnd(run) < run.sim.x + ahead && guard++ < 80) {
          const seg = run.gen.work(deadline);
          if (!seg) break;
          appendSeg(run, seg);
        }
      }

      function makeDeco(b, wi) {
        const len = b.x1 - b.x0, items = [];
        let n = Math.floor(b.x0 * 100) ^ (wi * 7919);
        const r = () => hash01(n++ * 31 + 17);
        const trees = Math.floor(len / 2.0);
        for (let k = 0; k < trees; k++) {
          const v = r();
          if (v < 0.55) items.push({ t: v < 0.2 ? "cypress" : v < 0.42 ? "tree" : "bush", x: b.x0 + 0.35 + r() * Math.max(0.1, len - 0.7), s: 0.75 + r() * 0.5, z: 0.82 + r() * 0.12 });
        }
        if (len > 2.4 && r() < 0.6) items.push({ t: "arch", x: b.x0 + len * (0.3 + r() * 0.4), w: Math.min(1.3, len * 0.35) });
        const vines = len > 1 ? 1 + Math.floor(r() * 2) : 0;
        for (let k = 0; k < vines; k++) items.push({ t: "vine", x: b.x0 + 0.15 + r() * Math.max(0.1, len - 0.3), k: r(), len: 0.5 + r() * 1.1 });
        if (len > 1.6 && r() < 0.18) items.push({ t: "banner", x: b.x0 + 0.3 + r() * (len - 0.6) });
        return items;
      }

      // ---- input ----
      function press(px, py) {
        audio.unlock();
        if (state === "ready") {
          state = "playing"; stateT = 0;
          RUN.startedAt = clock;
          try { ctx.platform.start(); } catch (e) { /* ignore */ }
          RUN.tapQueue = 1;
          return;
        }
        if (state === "playing") {
          RUN.tapQueue = Math.min(2, RUN.tapQueue + 1);
          return;
        }
        if (state === "over" && stateT > 0.35) {
          if (px !== undefined && hitAtmosphere(px, py)) return;
          restart();
        }
      }
      function restart() {
        newRun(false);
        state = "playing"; stateT = 0;
        RUN.startedAt = clock;
        audio.play("restart");
        try { ctx.platform.start(); } catch (e) { /* ignore */ }
        try { if (scoreTrack) scoreTrack.reset(); } catch (e) { /* ignore */ }
      }
      const muteBtn = { x: 0, y: 0, r: 16 };
      const atmoBtn = { x: 0, y: 0, w: 0, h: 0, on: false };
      function hitAtmosphere(px, py) {
        if (!atmoBtn.on) return false;
        if (px >= atmoBtn.x && px <= atmoBtn.x + atmoBtn.w && py >= atmoBtn.y && py <= atmoBtn.y + atmoBtn.h) {
          save.atmosphere = save.atmosphere === "dusk" ? "day" : "dusk";
          persist(); layout();
          return true;
        }
        return false;
      }
      ctx.listen(canvas, "pointerdown", (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        if (Math.hypot(px - muteBtn.x, py - muteBtn.y) < muteBtn.r + 8) {
          save.muted = !save.muted; audio.setMuted(save.muted); persist();
          return;
        }
        press(px, py);
      });
      ctx.listen(window, "keydown", (e) => {
        if (e.repeat) return;
        const k = e.code || e.key;
        if (k === "Space" || k === "ArrowUp" || k === "KeyW" || k === "Enter" || e.key === " ") {
          if (e.preventDefault) e.preventDefault();
          press();
        } else if (k === "KeyM") {
          save.muted = !save.muted; audio.setMuted(save.muted); persist();
        }
      });

      // ---- feedback helpers ----
      function floatText(pi, text, wx, wy, color, big) {
        const f = RUN.fx.floats;
        if (f.length > 10) f.shift();
        f.push({ pi, text, wx, wy, color, big: !!big, t: 0, life: big ? 1.3 : 1.0 });
      }
      function toast(text, sub) {
        const t = RUN.fx.toasts;
        if (t.length > 3) t.shift();
        t.push({ text, sub: sub || "", t: 0, life: 2.4 });
      }
      function dust(pi, wx, wy, n, col) {
        const parts = RUN.fx.parts;
        for (let k = 0; k < n; k++) {
          if (parts.length > 90) parts.shift();
          parts.push({ pi, x: wx + (Math.random() - 0.5) * 0.3, y: wy + 0.02, vx: (Math.random() - 0.3) * 1.4, vy: Math.random() * 1.0 + 0.3, t: 0, life: 0.45 + Math.random() * 0.25, r: 0.05 + Math.random() * 0.05, col });
        }
      }
      function addScore(n) {
        RUN.score += n;
        try { if (scoreTrack) scoreTrack.set(RUN.score); } catch (e) { /* ignore */ }
        if (save.best > 0 && RUN.score > save.best && !RUN.pbAnnounced) {
          RUN.pbAnnounced = true;
          toast("NEW BEST", "");
          audio.play("milestone");
        }
      }
      function mistake(kind, pi) {
        const seg = RUN.segs[RUN.segIdx];
        if (seg) seg.mistake = true;
        if (RUN.combo >= 2) {
          floatText(pi, "COMBO LOST", RUN.sim.x, RUN.sim.c[pi].y + 1.2, "muted");
          audio.play("comboLost");
        }
        RUN.combo = 0;
        RUN.comboShake = 0.5;
      }

      // ---- SYNC timing check (runs at the moment of a tap) ----
      // Re-simulates the same tap a little earlier and later from recorded
      // states to find the clean shared window around it; precision is how
      // close to that window's centre the tap landed.
      const tmpA = newSim(0, 0, 0, 0), tmpB = newSim(0, 0, 0, 0);
      function testTap(start, W) {
        copySimInto(tmpB, start);
        if (!canJump(tmpB)) return false;
        stepSim(tmpB, W, P, true);
        const jumped = [!!(tmpB.c[0].ev & EV_JUMP), !!(tmpB.c[1].ev & EV_JUMP)];
        if (!jumped[0] && !jumped[1]) return false;
        if (anyDead(tmpB)) return false;
        const landed = [!jumped[0], !jumped[1]];
        for (let n = 0; n < 200; n++) {
          stepSim(tmpB, W, P, false);
          if (anyDead(tmpB)) return false;
          for (let i = 0; i < 2; i++) {
            const ev = tmpB.c[i].ev;
            if (ev & (EV_TEETER | EV_BONK)) return false;
            if (ev & EV_LAND) landed[i] = true;
          }
          if (landed[0] && landed[1]) return true;
        }
        return false;
      }
      function measureTap(run) {
        const W = run.W, s = run.sim, SPAN = 36, ST = 2;
        // was a jump needed at all? (no-tap run survives one air time)
        copySimInto(tmpA, s);
        let needed = false;
        for (let n = 0; n < Math.round((P.air + 0.35) / P.dt); n++) {
          stepSim(tmpA, W, P, false);
          if (anyDead(tmpA)) { needed = true; break; }
        }
        if (!testTap(s, W)) return { p: 0, needed, constrained: true, ok: false };
        // later offsets: simulate forward without the tap
        let hi = 0;
        copySimInto(tmpA, s);
        const fwd = newSim(0, 0, 0, 0);
        for (let o = 1; o <= SPAN; o++) {
          stepSim(tmpA, W, P, false);
          if (anyDead(tmpA)) break;
          if (o % ST) continue;
          copySimInto(fwd, tmpA);
          if (!testTap(fwd, W)) break;
          hi = o;
        }
        // earlier offsets: recorded ring states (only since the previous tap)
        let lo = 0;
        for (let o = ST; o <= SPAN; o += ST) {
          const want = s.steps - o;
          if (want <= run.lastTapStep + 1) break;
          let st = null;
          for (let k = 0; k < ringN; k++) if (ring[k].steps === want) { st = ring[k]; break; }
          if (!st || !testTap(st, W)) break;
          lo = -o;
        }
        const width = (hi - lo + ST) * P.dt;
        const constrained = hi < SPAN - ST && lo > -SPAN + ST && width < 0.55;
        const mid = (hi + lo) / 2, half = (hi - lo) / 2 + 1;
        const p = clamp(1 - Math.abs(mid) / half, 0, 1);
        return { p, needed, constrained, ok: true, width };
      }

      // ---- autopilot (test harness only) ----
      function autopilot(run) {
        const s = run.sim, seg = run.segs[run.segIdx];
        if (!run.auto || run.auto.seg !== seg.id) {
          if (!(s.c[0].gr && s.c[1].gr)) return false;
          const taps = run.gen.solver.solve(run.W, cloneSim(s), seg.x1, 300000);
          run.auto = { seg: seg.id, taps: taps || [], ok: !!taps };
          if (TEST) TEST.plans = (TEST.plans || 0) + 1;
          if (!taps && TEST) TEST.noPlan = (TEST.noPlan || 0) + 1;
        }
        const a = run.auto;
        if (a.taps.length && a.taps[0] === s.steps) { a.taps.shift(); return true; }
        while (a.taps.length && a.taps[0] < s.steps) a.taps.shift();
        return false;
      }

      // ---- fixed simulation step ----
      function fixedStep() {
        const run = RUN, s = run.sim;
        while (run.segIdx < run.segs.length - 1 && s.x >= run.segs[run.segIdx].x1) run.segIdx++;
        const seg = run.segs[run.segIdx];
        if (s.x >= seg.x0 - 1e-9) s.v = seg.v;
        if (s.x >= seg.x0 && run.captionSeg !== seg.id) enterSeg(run, seg);

        let tap = false;
        if (TEST && TEST.autopilot) tap = autopilot(run);
        else if (run.tapQueue > 0) { run.tapQueue--; tap = true; }

        if (tap) {
          run.tapsTotal = (run.tapsTotal || 0) + 1;
          if (!run.beat || run.beat.done) {
            const m = measureTap(run);
            run.beat = { m, jumped: [false, false], landed: [false, false], clean: true, age: 0, done: false };
          }
          run.lastTapStep = s.steps;
          try { ctx.platform.interact({ type: "jump" }); } catch (e) { /* ignore */ }
        }
        run.prevX = s.x; run.prevY[0] = s.c[0].y; run.prevY[1] = s.c[1].y;
        stepSim(s, run.W, P, tap);
        if ((s.steps & 1) === 0) { copySimInto(ring[run.ringCount % ringN], s); run.ringCount++; }

        for (let i = 0; i < 2; i++) handleEvents(run, i);
        if (run.beat && !run.beat.done) {
          const b = run.beat;
          b.age += P.dt;
          if (b.jumped[0] || b.jumped[1]) {
            if ((!b.jumped[0] || b.landed[0]) && (!b.jumped[1] || b.landed[1])) resolveBeat(run, b);
          } else if (b.age > P.buffer + 0.05) b.done = true;
        }
        collectPrisms(run);
        if (state !== "playing") return;
        checkClear(run);
        if ((s.steps % 60) === 0) dropOld(run);
      }

      function enterSeg(run, seg) {
        run.captionSeg = seg.id;
        if (seg.caption) {
          run.caption = seg.caption;
          run.captionN = seg.kind === "challenge" ? run.pairs + 1 : 0;
          run.captionT = 0;
        }
        if (seg.hint) { run.hint = seg.hint; run.hintT = 0; }
      }

      function handleEvents(run, i) {
        const c = run.sim.c[i], ev = c.ev, an = run.anim[i];
        if (!ev) return;
        const x = run.sim.x;
        if (ev & EV_JUMP) {
          an.jump = 1; an.sqx = 0.86; an.sqy = 1.16;
          audio.play(i === 0 ? "jump0" : "jump1");
          if (run.beat && !run.beat.done) run.beat.jumped[i] = true;
          if (i === 0) haptic("light");
        }
        if (ev & EV_LAND) {
          an.land = 1; an.sqx = 1.2; an.sqy = 0.76;
          audio.play(i === 0 ? "land0" : "land1");
          dust(i, x, c.y, 4, null);
          if (run.beat && !run.beat.done && run.beat.jumped[i]) run.beat.landed[i] = true;
        }
        if (ev & EV_TEETER) {
          an.teeter = 1;
          if (run.beat) run.beat.clean = false;
          floatText(i, "TEETER", x, c.y + 1.15, "muted");
          mistake("teeter", i);
        }
        if (ev & EV_BONK) {
          an.bonk = 1; an.sqy = 0.8; an.sqx = 1.15;
          audio.play("bonk");
          if (run.beat) run.beat.clean = false;
          floatText(i, "BONK", x, c.y + 1.2, "muted");
          mistake("bonk", i);
        }
        if (ev & EV_PLATE) {
          audio.play("plate");
          haptic("medium");
          floatText(i, "SWITCH", x, c.y + 1.1, "terra");
        }
        if (ev & EV_DIE) onDeath(run, i, c.dead);
      }

      function resolveBeat(run, b) {
        b.done = true;
        const seg = run.segs[run.segIdx];
        const m = b.m;
        const both = b.jumped[0] && b.jumped[1];
        if (!b.clean) return;
        if (m.needed && m.constrained) {
          if (seg) seg.beats++;
          if (m.p >= cfg.sync) {
            if (seg) seg.beatsSync++;
            addScore(25);
            run.syncs = (run.syncs || 0) + 1;
            const pi = both ? -1 : b.jumped[0] ? 0 : 1;
            floatText(pi, "SYNC +25", run.sim.x, Math.max(run.sim.c[0].y, run.sim.c[1].y) + 1.25, "cream", true);
            audio.play("sync");
            haptic("light");
            run.anim[0].pulse = 1; run.anim[1].pulse = 1;
            return;
          }
        }
        if (both) audio.play("pair");
      }

      function collectPrisms(run) {
        const s = run.sim;
        for (let i = 0; i < 2; i++) {
          const c = s.c[i];
          if (c.dead) continue;
          const pr = run.W[i].prisms;
          for (let k = 0; k < pr.length; k++) {
            const p = pr[k];
            if (p.taken || Math.abs(p.x - s.x) > P.hw + 0.22) continue;
            if (p.y > c.y - 0.2 && p.y < c.y + P.ch + 0.22) {
              p.taken = true; p.takenT = clock;
              run.prisms++;
              addScore(15);
              audio.play("prism");
              haptic("light");
              floatText(i, "+15", p.x, p.y + 0.35, "cream");
              if (p.twin) {
                const other = run.W[1 - i].prisms.find((o) => o.twin === p.twin);
                if (other && other.taken) {
                  addScore(40);
                  floatText(-1, "TWIN PRISM +40", s.x, p.y + 0.6, "cream", true);
                  audio.play("perfect");
                }
              }
            }
          }
        }
      }

      function checkClear(run) {
        const s = run.sim, seg = run.segs[run.segIdx];
        if (!seg || seg.cleared || s.x < seg.clearX) return;
        if (!(s.c[0].gr && s.c[1].gr)) return;
        seg.cleared = true;
        if (seg.kind !== "challenge") return;
        run.pairs++;
        if (!seg.mistake) {
          run.combo++;
          if (run.combo > run.bestCombo) run.bestCombo = run.combo;
          if (run.combo >= 2) audio.play("combo", run.combo);
        }
        const mult = 1 + Math.min(3, Math.floor(run.combo / 5));
        const base = seg.hard ? 20 : 10;
        addScore(base * mult);
        floatText(-1, "+" + base * mult, s.x, Math.max(s.c[0].y, s.c[1].y) + 0.95, "cream");
        if (seg.teachSync && seg.beatsSync === 0 && !seg.mistake) {
          addScore(25);
          floatText(-1, "SYNC +25", s.x, Math.max(s.c[0].y, s.c[1].y) + 1.4, "cream", true);
          audio.play("sync");
        }
        if (seg.beats > 0 && seg.beatsSync === seg.beats && !seg.mistake) {
          run.perfects++;
          addScore(50);
          run.perfectFlash = 1;
          run.anim[0].pulse = 1; run.anim[1].pulse = 1;
          audio.play("perfect");
          haptic("success");
          floatText(-1, "PERFECT PAIR +50", s.x, Math.max(s.c[0].y, s.c[1].y) + 1.75, "cream", true);
        }
        if (seg.trio === 3 && run.combo >= 3) {
          addScore(30);
          toast("COMBO ×3", "THE ECHO FOLLOWS YOU");
          audio.play("milestone");
        }
        if (seg.trio === 3 && !save.tutorialDone) { save.tutorialDone = true; persist(); }
        for (const m of MILESTONES) {
          if (run.pairs === m.at) {
            let sub = "";
            if (!has(m.id)) { save.unlocks.push(m.id); run.unlockedNow.push(m.name); persist(); sub = "KEEPSAKE · " + m.name; }
            toast(m.at + " PAIRS", sub);
            audio.play("milestone");
            haptic("success");
            try { ctx.platform.milestone("pairs_" + m.at, { score: run.score }); } catch (e) { /* ignore */ }
          }
        }
      }

      function onDeath(run, i, cause) {
        if (state !== "playing") return;
        run.dead = i; run.cause = cause;
        state = "dying"; stateT = 0;
        audio.play("fail");
        haptic("error");
        const c = run.sim.c[i];
        const shards = run.fx.shards;
        shards.length = 0;
        run.fallVy = cause === "fell" ? Math.min(0, c.vy) : null;
        if (cause === "fell") return;
        const pal = palette();
        const cols = i === 0 ? pal.orig : pal.copy;
        for (let k = 0; k < 12; k++) {
          shards.push({ pi: i, x: run.sim.x + (Math.random() - 0.5) * 0.35, y: c.y + 0.1 + Math.random() * 0.6, vx: (Math.random() - 0.4) * 3.2, vy: Math.random() * 4 + 1, r: 0.05 + Math.random() * 0.07, col: cols[k % 3], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
        }
      }

      function finishRun(run) {
        state = "over"; stateT = 0;
        run.newBest = run.score > save.best;
        save.best = Math.max(save.best, run.score);
        save.bestPairs = Math.max(save.bestPairs, run.pairs);
        save.bestCombo = Math.max(save.bestCombo, run.bestCombo);
        save.perfects = (save.perfects || 0) + run.perfects;
        persist();
        try { ctx.platform.fail({ score: run.score, pairs: run.pairs, combo: run.bestCombo }); } catch (e) { /* ignore */ }
        if (scoreTrack && run.score > 0) {
          try { scoreTrack.submit("score", { label: run.score + " pts" }).catch(() => {}); } catch (e) { /* ignore */ }
        }
        if (run.newBest && run.pairs >= 10) {
          try { ctx.pulse.complete({ score: run.score, text: "Copycat: " + run.pairs + " pairs, " + run.score + " points" }); } catch (e) { /* ignore */ }
        }
      }

      // ---- per-frame update (visual timers, camera, generation) ----
      function update(dtMs) {
        const dt = Math.min(0.1, dtMs / 1000);
        clock += dt;
        stateT += dt;
        const run = RUN;
        if (state === "playing") {
          // a few ms per frame keeps ~5 s of validated track ready; if the
          // camera ever catches up with generation, spend more time at once
          const edge = run.sim.x + 16;
          fillAhead(run, 34, genEnd(run) < edge ? 40 : 3);
        }
        if (state === "dying" && stateT > 0.85) finishRun(run);
        if (run.fallVy !== null && run.fallVy !== undefined && run.dead >= 0 && state !== "playing") {
          run.fallVy -= 20 * dt;
          run.sim.c[run.dead].y += run.fallVy * dt;
        }
        for (let i = 0; i < 2; i++) {
          const an = run.anim[i];
          an.sqx += (1 - an.sqx) * Math.min(1, dt * 14);
          an.sqy += (1 - an.sqy) * Math.min(1, dt * 14);
          an.land = Math.max(0, an.land - dt * 4);
          an.jump = Math.max(0, an.jump - dt * 3);
          an.teeter = Math.max(0, an.teeter - dt * 2.4);
          an.bonk = Math.max(0, an.bonk - dt * 3);
          an.pulse = Math.max(0, an.pulse - dt * 2.2);
          an.blink -= dt;
          if (an.blink < -3 - Math.random() * 3) an.blink = 0.12;
        }
        run.perfectFlash = Math.max(0, run.perfectFlash - dt * 1.4);
        run.captionT += dt; run.hintT += dt;
        run.comboShake = Math.max(0, (run.comboShake || 0) - dt);
        const fx = run.fx;
        for (const f of fx.floats) f.t += dt;
        while (fx.floats.length && fx.floats[0].t > fx.floats[0].life) fx.floats.shift();
        for (const t of fx.toasts) t.t += dt;
        while (fx.toasts.length && fx.toasts[0].t > fx.toasts[0].life) fx.toasts.shift();
        for (const p of fx.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 3 * dt; }
        while (fx.parts.length && fx.parts[0].t > fx.parts[0].life) fx.parts.shift();
        for (const s of fx.shards) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy -= 14 * dt; s.rot += s.vr * dt; }
        // cameras
        const vNow = run.sim.v;
        const vw = viewW(vNow);
        for (const p of L.panels) {
          const sTarget = Math.min(p.w / vw, p.h / 5.6);
          p.s = p.s ? p.s + (sTarget - p.s) * Math.min(1, dt * 1.5) : sTarget;
          const c = run.sim.c[p.i];
          let target = p.camT;
          if (c.gr && !c.dead) target = c.y;
          else if (!c.dead && c.y < p.camT - 1.0) target = Math.max(c.y + 1.0, p.camT - 3);
          p.camT = target;
          p.camY += (p.camT - p.camY) * Math.min(1, dt * 3.2);
        }
        // trails
        for (let i = 0; i < 2; i++) {
          const tr = run.trail[i], c = run.sim.c[i];
          if (state === "playing" || state === "ready") {
            tr.push(run.sim.x, c.y);
            if (tr.length > 28) tr.splice(0, 2);
          }
        }
      }

      // ================================================================ render
      let alphaR = 1;
      let renderX = 0;
      const renderY = [0, 0];
      function X(p, wx) { return p.ax + (wx - p.camX) * p.s; }
      function Y(p, wy) { return p.ay - (wy - p.camY) * p.s; }

      function render(alpha) {
        if (disposed) return;
        alphaR = alpha === undefined ? 1 : alpha;
        const run = RUN, s = run.sim;
        const live = state === "playing";
        renderX = live ? lerp(run.prevX, s.x, alphaR) : s.x;
        for (let i = 0; i < 2; i++) renderY[i] = live ? lerp(run.prevY[i], s.c[i].y, alphaR) : s.c[i].y;
        const pal = palette();
        g.fillStyle = pal.cream;
        g.fillRect(0, 0, L.W, L.H);
        for (const p of L.panels) {
          p.camX = renderX;
          p.ax = p.x + p.anchorX;
          p.ay = p.y + p.anchorY;
          p.dx = -0.42 * p.s; p.dy = -0.28 * p.s;
          drawPanel(p, pal, run);
        }
        drawLinks(run, pal);
        drawDivider(pal);
        drawHUD(run, pal);
        if (state === "ready") drawTitle(pal);
        if (state === "over") drawGameOver(run, pal);
      }

      function drawDivider(pal) {
        g.save();
        g.fillStyle = "rgba(247,241,220,0.95)";
        if (L.mode === "stack") {
          const y = L.H / 2;
          g.fillRect(0, y - 1.5, L.W, 3);
          g.fillStyle = "rgba(60,70,60,0.12)";
          g.fillRect(0, y + 1.5, L.W, 2);
        } else {
          const x = L.W / 2;
          g.fillRect(x - 1.5, 0, 3, L.H);
          g.fillStyle = "rgba(60,70,60,0.12)";
          g.fillRect(x + 1.5, 0, 2, L.H);
        }
        g.restore();
      }

      // ---------- background ----------
      function drawSky(p, pal) {
        g.fillStyle = L.skyGrad[p.i];
        g.fillRect(p.x, p.y, p.w, p.h);
        const sx = p.x + p.w * 0.2, sy = p.y + p.h * 0.3, r = Math.min(p.w, p.h) * 0.13;
        g.globalAlpha = 0.35;
        g.fillStyle = p.i === 0 ? pal.sun : pal.sunC;
        g.beginPath(); g.arc(sx, sy, r * 1.7, 0, TAU); g.fill();
        g.globalAlpha = 0.9;
        g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.fill();
        g.globalAlpha = 1;
      }
      function drawSkyline(p, pal) {
        const cols = p.i === 0 ? pal.towers : pal.towersC;
        const layers = [[0.05, 0.42, 0.66], [0.13, 0.6, 0.71], [0.24, 0.8, 0.77]];
        for (let li = 0; li < 3; li++) {
          const f = layers[li][0], sc = layers[li][1], base = p.y + p.h * layers[li][2] + p.camY * p.s * f * 0.4;
          const s = p.s * sc, off = p.camX * f / sc, tileW = 2.3;
          const leftU = off - p.anchorX / s - 2, rightU = off + (p.w - p.anchorX) / s + 2;
          g.fillStyle = cols[li];
          for (let ti = Math.floor(leftU / tileW); ti <= Math.ceil(rightU / tileW); ti++) {
            const h0 = hash01(ti * 7 + li * 1013);
            if (h0 < 0.22) continue;
            const tx = ti * tileW + hash01(ti * 13 + li * 77) * tileW * 0.45;
            const tw = (0.55 + hash01(ti * 19 + li) * 1.1) * s;
            const th = (1.6 + hash01(ti * 23 + li * 5) * (li === 0 ? 7 : 5.5)) * s;
            const type = Math.floor(hash01(ti * 29 + li * 3) * 7);
            const sx = p.ax + (tx - off) * s;
            drawTower(sx, base, tw, th, type, cols[li], li, ti, p);
          }
          // atmospheric haze between layers
          const hz = p.i === 0 ? pal.haze : pal.hazeC;
          g.fillStyle = `rgba(${hz[0]},${hz[1]},${hz[2]},${0.16 + li * 0.04})`;
          g.fillRect(p.x, base - p.h * 0.05, p.w, p.h * 0.6);
        }
      }
      function drawTower(x, base, w, h, type, col, li, ti, p) {
        if (x + w < p.x - 40 || x - w > p.x + p.w + 40) return;
        g.fillStyle = col;
        if (type === 6) { // cypress silhouette
          g.beginPath();
          g.ellipse(x, base - h * 0.32, w * 0.22, h * 0.34, 0, 0, TAU);
          g.fill();
          return;
        }
        if (type === 5) { // aqueduct span
          const ww = w * 3.2, hh = h * 0.35;
          g.fillRect(x - ww / 2, base - hh, ww, hh);
          g.save();
          g.globalCompositeOperation = "destination-out";
          g.restore();
          g.fillStyle = "rgba(255,255,255,0.18)";
          const n = 4, aw = ww / n;
          for (let k = 0; k < n; k++) {
            const ax = x - ww / 2 + aw * k + aw * 0.18, ah = hh * 0.62;
            g.beginPath();
            g.moveTo(ax, base);
            g.lineTo(ax, base - ah + aw * 0.32);
            g.arc(ax + aw * 0.32, base - ah + aw * 0.32, aw * 0.32, Math.PI, 0);
            g.lineTo(ax + aw * 0.64, base);
            g.fill();
          }
          return;
        }
        g.fillRect(x - w / 2, base - h, w, h);
        // roof variants
        g.beginPath();
        if (type === 0) { // crenellations
          const n = 3, cw = w / (n * 2 - 1);
          for (let k = 0; k < n; k++) g.rect(x - w / 2 + k * 2 * cw, base - h - cw * 0.9, cw, cw * 0.9);
        } else if (type === 1) { // pyramid cap
          g.moveTo(x - w * 0.56, base - h); g.lineTo(x, base - h - w * 0.8); g.lineTo(x + w * 0.56, base - h);
        } else if (type === 2) { // dome
          g.arc(x, base - h, w * 0.42, Math.PI, 0);
        } else if (type === 3) { // belfry
          g.rect(x - w * 0.36, base - h - w * 0.75, w * 0.72, w * 0.75);
          g.moveTo(x - w * 0.42, base - h - w * 0.75); g.lineTo(x, base - h - w * 1.25); g.lineTo(x + w * 0.42, base - h - w * 0.75);
        }
        g.fill();
        // shaded right side + window slits
        g.fillStyle = "rgba(40,50,45,0.08)";
        g.fillRect(x + w * 0.12, base - h, w * 0.38, h);
        if (li > 0 && w > 10) {
          g.fillStyle = "rgba(40,50,45,0.16)";
          const ww = Math.max(2, w * 0.12), wh = ww * 2.2;
          for (let k = 0; k < 3; k++) {
            const wy = base - h + h * (0.15 + k * 0.22);
            g.fillRect(x - ww * 0.5, wy, ww, wh);
          }
          if (li === 2 && has("lanterns") && hash01(ti * 41) < 0.4) {
            g.fillStyle = "rgba(255,214,140,0.9)";
            g.beginPath(); g.arc(x - w * 0.18, base - h * 0.55, Math.max(1.5, w * 0.06), 0, TAU); g.fill();
            g.fillStyle = "rgba(255,214,140,0.25)";
            g.beginPath(); g.arc(x - w * 0.18, base - h * 0.55, Math.max(4, w * 0.2), 0, TAU); g.fill();
          }
        }
      }
      function drawClouds(p, pal, near) {
        const hz = p.i === 0 ? pal.haze : pal.hazeC;
        const n = near ? 4 : 5;
        for (let k = 0; k < n; k++) {
          const speed = near ? 0.32 : 0.12;
          const span = p.w + 400;
          const wx = ((k * 211.7 + clock * (near ? 9 : 4) - p.camX * p.s * speed) % span + span) % span - 200;
          const cy = p.y + p.h * (near ? 0.93 : 0.74) + (k % 2) * p.h * 0.04;
          const r = (near ? 0.18 : 0.12) * p.h * (0.8 + hash01(k * 5 + (near ? 9 : 2)) * 0.6);
          g.fillStyle = `rgba(${hz[0]},${hz[1]},${hz[2]},${near ? 0.55 : 0.4})`;
          g.beginPath();
          g.ellipse(p.x + wx, cy, r * 1.9, r * 0.55, 0, 0, TAU);
          g.ellipse(p.x + wx + r * 0.9, cy - r * 0.25, r * 1.1, r * 0.5, 0, 0, TAU);
          g.ellipse(p.x + wx - r * 1.0, cy + r * 0.05, r, r * 0.42, 0, 0, TAU);
          g.fill();
        }
      }

      // ---------- world geometry ----------
      function poly(pts) {
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
        g.closePath();
        g.fill();
      }
      function drawBlock(p, pal, b, prevB, bottomY) {
        const ci = p.i;
        const x0 = X(p, b.x0), x1 = X(p, b.x1), ty = Y(p, b.top), dx = p.dx, dy = p.dy;
        const by = bottomY;
        const top = ci === 0 ? pal.top : pal.topC, front = ci === 0 ? pal.front : pal.frontC, left = ci === 0 ? pal.left : pal.leftC;
        // left face (visible unless an adjacent block on the left is as tall)
        let lfBottom = by;
        const adj = prevB && Math.abs(prevB.x1 - b.x0) < 1e-4;
        if (adj) lfBottom = prevB.top >= b.top ? ty : Math.min(by, Y(p, prevB.top));
        if (lfBottom > ty + 0.5) {
          g.fillStyle = left;
          poly([x0, ty, x0 + dx, ty + dy, x0 + dx, lfBottom + dy, x0, lfBottom]);
        }
        // top face
        g.fillStyle = top;
        poly([x0, ty, x1, ty, x1 + dx, ty + dy, x0 + dx, ty + dy]);
        // subtle course lines on top (paving)
        g.strokeStyle = pal.mortar;
        g.lineWidth = 1;
        g.beginPath();
        const step = 0.62;
        for (let u = Math.ceil(b.x0 / step) * step; u < b.x1; u += step) {
          const sx = X(p, u);
          g.moveTo(sx, ty); g.lineTo(sx + dx, ty + dy);
        }
        g.stroke();
        // front face
        g.fillStyle = front;
        g.fillRect(x0, ty, x1 - x0, by - ty);
        // ambient occlusion under the lip + stone courses
        g.fillStyle = pal.ao;
        g.fillRect(x0, ty, x1 - x0, Math.max(1, p.s * 0.06));
        g.strokeStyle = pal.mortar;
        g.beginPath();
        const rowH = 0.42 * p.s;
        let row = 0;
        for (let yy = ty + rowH; yy < Math.min(by, ty + p.s * 3.4); yy += rowH, row++) {
          g.moveTo(x0, yy); g.lineTo(x1, yy);
          const off = (row % 2) * 0.45;
          for (let u = b.x0 + 0.2 + off; u < b.x1; u += 0.9) {
            const sx = X(p, u);
            g.moveTo(sx, yy - rowH); g.lineTo(sx, yy);
          }
        }
        g.stroke();
        // highlight on the front-top edge
        g.fillStyle = "rgba(255,250,235,0.55)";
        g.fillRect(x0, ty - 0.5, x1 - x0, 1);
      }
      function drawBlockDeco(p, pal, b, front) {
        if (!b.deco) return;
        const ty = Y(p, b.top), s = p.s;
        for (const d of b.deco) {
          if (front) {
            if (d.t === "arch") {
              const cx = X(p, d.x), aw = d.w * s, top = ty + 0.85 * s, ah = 1.6 * s;
              g.fillStyle = "rgba(90,70,48,0.2)";
              g.beginPath();
              g.moveTo(cx - aw / 2, top + ah);
              g.lineTo(cx - aw / 2, top + aw / 2);
              g.arc(cx, top + aw / 2, aw / 2, Math.PI, 0);
              g.lineTo(cx + aw / 2, top + ah);
              g.fill();
              g.fillStyle = "rgba(90,70,48,0.12)";
              g.fillRect(cx - aw / 2, top + aw / 2, aw * 0.18, ah - aw / 2);
            } else if (d.t === "vine" && (d.k < 0.45 || (has("ivy") && d.k < 0.85))) {
              const vx = X(p, d.x);
              const n = Math.floor(d.len * 6);
              for (let k = 0; k < n; k++) {
                const yy = ty + 2 + k * s * 0.16, xx = vx + Math.sin(k * 1.7 + d.k * 9) * s * 0.07;
                g.fillStyle = k % 3 === 0 ? pal.leafD : k % 3 === 1 ? pal.leaf : pal.leafL;
                g.beginPath(); g.arc(xx, yy, s * (0.085 - k * 0.003), 0, TAU); g.fill();
              }
            } else if (d.t === "banner") {
              const bx = X(p, d.x), bw = 0.26 * s, bh = 0.9 * s;
              g.fillStyle = pal.terra;
              g.beginPath();
              g.moveTo(bx - bw / 2, ty + 2); g.lineTo(bx + bw / 2, ty + 2); g.lineTo(bx + bw / 2, ty + bh);
              g.lineTo(bx, ty + bh - bw * 0.45); g.lineTo(bx - bw / 2, ty + bh);
              g.fill();
              g.fillStyle = pal.terraD;
              g.fillRect(bx - bw / 2, ty + 2, bw, s * 0.05);
            }
          } else {
            const z = d.z || 0.85;
            const bx = X(p, d.x) + p.dx * z, byy = ty + p.dy * z;
            if (d.t === "cypress") {
              g.fillStyle = "rgba(60,60,40,0.12)";
              g.beginPath(); g.ellipse(bx + s * 0.18, byy, s * 0.24, s * 0.06, 0, 0, TAU); g.fill();
              g.fillStyle = pal.cypress;
              g.beginPath(); g.ellipse(bx, byy - s * 0.62 * d.s, s * 0.17 * d.s, s * 0.66 * d.s, 0, 0, TAU); g.fill();
              g.fillStyle = "rgba(255,255,220,0.12)";
              g.beginPath(); g.ellipse(bx - s * 0.05, byy - s * 0.7 * d.s, s * 0.07 * d.s, s * 0.5 * d.s, 0, 0, TAU); g.fill();
            } else if (d.t === "tree") {
              g.fillStyle = "rgba(60,60,40,0.12)";
              g.beginPath(); g.ellipse(bx + s * 0.22, byy, s * 0.32, s * 0.07, 0, 0, TAU); g.fill();
              g.fillStyle = pal.trunk;
              g.fillRect(bx - s * 0.03, byy - s * 0.4 * d.s, s * 0.06, s * 0.4 * d.s);
              const cy = byy - s * 0.62 * d.s, r = s * 0.27 * d.s;
              g.fillStyle = pal.leafD; g.beginPath(); g.arc(bx + r * 0.25, cy + r * 0.15, r, 0, TAU); g.fill();
              g.fillStyle = pal.leaf; g.beginPath(); g.arc(bx - r * 0.15, cy - r * 0.1, r * 0.85, 0, TAU); g.fill();
              g.fillStyle = pal.leafL; g.beginPath(); g.arc(bx - r * 0.4, cy - r * 0.35, r * 0.4, 0, TAU); g.fill();
            } else if (d.t === "bush") {
              const r = s * 0.16 * d.s;
              g.fillStyle = pal.leafD; g.beginPath(); g.arc(bx, byy - r * 0.6, r, 0, TAU); g.fill();
              g.fillStyle = pal.leaf; g.beginPath(); g.arc(bx - r * 0.5, byy - r * 0.8, r * 0.7, 0, TAU); g.fill();
            }
          }
        }
      }
      function drawSpikes(p, pal, sp) {
        const s = p.s, base = Y(p, sp.y);
        const n = Math.max(2, Math.round((sp.x1 - sp.x0) / 0.17));
        const w = (sp.x1 - sp.x0) / n;
        for (const z of [0.72, 0.3]) {
          const ox = p.dx * z, oy = p.dy * z;
          g.fillStyle = pal.ironD;
          g.fillRect(X(p, sp.x0) + ox, base + oy - s * 0.05, (sp.x1 - sp.x0) * s, s * 0.05);
          for (let k = 0; k < n; k++) {
            const a = X(p, sp.x0 + k * w) + ox, b2 = X(p, sp.x0 + (k + 1) * w) + ox, m = (a + b2) / 2;
            g.fillStyle = pal.iron;
            poly([a, base + oy - s * 0.04, m, base + oy - s * 0.4, b2, base + oy - s * 0.04]);
            g.fillStyle = pal.ironL;
            poly([a, base + oy - s * 0.04, m, base + oy - s * 0.4, m, base + oy - s * 0.04]);
          }
        }
        g.fillStyle = pal.terra;
        g.fillRect(X(p, sp.x0) + p.dx * 0.15, base + p.dy * 0.15 - s * 0.03, (sp.x1 - sp.x0) * s, s * 0.04);
      }
      function box(p, x0, x1, y0, y1, z0, z1, cFront, cTop, cLeft) {
        const a = X(p, x0), b = X(p, x1), t = Y(p, y1), bt = Y(p, y0);
        const fx = p.dx * z0, fy = p.dy * z0, kx = p.dx * (z1 - z0), ky = p.dy * (z1 - z0);
        g.fillStyle = cLeft;
        poly([a + fx, t + fy, a + fx + kx, t + fy + ky, a + fx + kx, bt + fy + ky, a + fx, bt + fy]);
        g.fillStyle = cTop;
        poly([a + fx, t + fy, b + fx, t + fy, b + fx + kx, t + fy + ky, a + fx + kx, t + fy + ky]);
        g.fillStyle = cFront;
        g.fillRect(a + fx, t + fy, b - a, bt - t);
      }
      function drawCeil(p, pal, ce) {
        const s = p.s;
        if (ce.arch) {
          // non-lethal stone gateway: pillars stand behind the lane, so it only bonks
          const front = p.i === 0 ? pal.front : pal.frontC, top = p.i === 0 ? pal.top : pal.topC, left = p.i === 0 ? pal.left : pal.leftC;
          const ground = groundBelow(p.i === 0 ? RUN.W[0] : RUN.W[1], (ce.x0 + ce.x1) / 2, ce.y) ?? ce.y - 1.3;
          const lintel = ce.y + 0.5;
          box(p, ce.x0, ce.x0 + 0.16, ground, lintel, 0.62, 1, front, top, left);
          box(p, ce.x1 - 0.16, ce.x1, ground, lintel, 0.62, 1, front, top, left);
          box(p, ce.x0 - 0.05, ce.x1 + 0.05, ce.y, lintel, 0, 1, front, top, left);
          const a2 = X(p, ce.x0), b3 = X(p, ce.x1), yb = Y(p, ce.y);
          g.fillStyle = pal.ao;
          g.fillRect(a2 - 0.05 * s, yb - 2, b3 - a2 + 0.1 * s, 2);
          g.fillStyle = "rgba(90,70,48,0.22)";
          g.beginPath();
          g.moveTo(a2 + s * 0.1, yb);
          g.quadraticCurveTo((a2 + b3) / 2, yb - s * 0.36, b3 - s * 0.1, yb);
          g.closePath(); g.fill();
          return;
        }
        // hanging spiked crusher (lethal)
        const yb = ce.y + 0.1, ytop = ce.y + 0.85;
        const mid = (ce.x0 + ce.x1) / 2;
        g.strokeStyle = pal.ironD; g.lineWidth = Math.max(2, s * 0.07);
        for (const xx of [ce.x0 + 0.2, ce.x1 - 0.2]) {
          g.beginPath();
          g.moveTo(X(p, xx) + p.dx * 0.5, Y(p, ytop) + p.dy * 0.5);
          g.lineTo(X(p, xx) + p.dx * 0.5, p.y - 4);
          g.stroke();
        }
        box(p, ce.x0, ce.x1, yb, ytop, 0.18, 0.82, pal.iron, pal.ironL, pal.ironD);
        const a = X(p, ce.x0) + p.dx * 0.18, b = X(p, ce.x1) + p.dx * 0.18;
        g.fillStyle = pal.terra;
        g.fillRect(a + s * 0.12, Y(p, ytop - 0.16) + p.dy * 0.18, b - a - s * 0.24, s * 0.42);
        g.fillStyle = pal.terraD;
        g.fillRect(a + s * 0.12, Y(p, ytop - 0.16) + p.dy * 0.18 + s * 0.36, b - a - s * 0.24, s * 0.06);
        // downward teeth
        const n = Math.max(2, Math.round((ce.x1 - ce.x0) / 0.2)), w = (ce.x1 - ce.x0) / n;
        for (const z of [0.7, 0.32]) {
          const ox = p.dx * z, oy = p.dy * z;
          for (let k = 0; k < n; k++) {
            const l = X(p, ce.x0 + k * w) + ox, r = X(p, ce.x0 + (k + 1) * w) + ox;
            g.fillStyle = z > 0.5 ? pal.ironD : pal.iron;
            poly([l, Y(p, yb) + oy, (l + r) / 2, Y(p, ce.y - 0.03) + oy, r, Y(p, yb) + oy]);
          }
        }
        // shadow on the ground beneath
        void mid;
      }
      function drawPiston(p, pal, pi, xs) {
        const s = p.s, bottom = pistonBottom(pi, xs), top = bottom + pi.th;
        const cx = (pi.x0 + pi.x1) / 2;
        // rail showing the travel range
        g.strokeStyle = "rgba(60,58,62,0.35)"; g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        g.moveTo(X(p, cx) + p.dx * 0.92, Y(p, pi.base + pi.lo) + p.dy * 0.92);
        g.lineTo(X(p, cx) + p.dx * 0.92, Y(p, pi.base + pi.hi + pi.th) + p.dy * 0.92);
        g.stroke();
        g.setLineDash([]);
        // rod
        g.strokeStyle = pal.ironD; g.lineWidth = Math.max(2, s * 0.08);
        g.beginPath();
        g.moveTo(X(p, cx) + p.dx * 0.5, Y(p, top) + p.dy * 0.5);
        g.lineTo(X(p, cx) + p.dx * 0.5, p.y - 4);
        g.stroke();
        box(p, pi.x0, pi.x1, bottom + 0.06, top - 0.06, 0.2, 0.8, pal.iron, pal.ironL, pal.ironD);
        const a = X(p, pi.x0) + p.dx * 0.2, b = X(p, pi.x1) + p.dx * 0.2;
        g.fillStyle = pal.terra;
        g.fillRect(a + s * 0.08, Y(p, top - 0.16) + p.dy * 0.2, b - a - s * 0.16, (pi.th - 0.32) * s);
        // teeth top and bottom
        const n = 3, w = (pi.x1 - pi.x0) / n;
        g.fillStyle = pal.ironD;
        for (let k = 0; k < n; k++) {
          const l = X(p, pi.x0 + k * w) + p.dx * 0.5, r = X(p, pi.x0 + (k + 1) * w) + p.dx * 0.5;
          poly([l, Y(p, bottom + 0.06) + p.dy * 0.5, (l + r) / 2, Y(p, bottom - 0.02) + p.dy * 0.5, r, Y(p, bottom + 0.06) + p.dy * 0.5]);
          poly([l, Y(p, top - 0.06) + p.dy * 0.5, (l + r) / 2, Y(p, top + 0.02) + p.dy * 0.5, r, Y(p, top - 0.06) + p.dy * 0.5]);
        }
      }
      function drawLift(p, pal, lf, xs) {
        const t = liftTop(lf, xs), cx = (lf.x0 + lf.x1) / 2;
        g.strokeStyle = "rgba(60,58,62,0.3)"; g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        g.moveTo(X(p, cx) + p.dx * 0.95, Y(p, lf.base + lf.lo - lf.th) + p.dy * 0.95);
        g.lineTo(X(p, cx) + p.dx * 0.95, Y(p, lf.base + lf.hi) + p.dy * 0.95);
        g.stroke();
        g.setLineDash([]);
        box(p, lf.x0, lf.x1, t - lf.th, t, 0, 1, p.i === 0 ? pal.front : pal.frontC, p.i === 0 ? pal.top : pal.topC, p.i === 0 ? pal.left : pal.leftC);
        g.fillStyle = pal.iron;
        g.fillRect(X(p, lf.x0), Y(p, t - lf.th + 0.08), (lf.x1 - lf.x0) * p.s, p.s * 0.08);
      }
      function drawPlate(p, pal, pl, sw) {
        const pressed = sw[pl.link] !== undefined;
        const a = X(p, pl.x0), b = X(p, pl.x1), y = Y(p, pl.y + (pressed ? 0.0 : 0.05));
        const z0 = 0.2, z1 = 0.8;
        g.fillStyle = pressed ? pal.terraL : pal.terra;
        poly([a + p.dx * z0, y + p.dy * z0, b + p.dx * z0, y + p.dy * z0, b + p.dx * z1, y + p.dy * z1, a + p.dx * z1, y + p.dy * z1]);
        g.fillStyle = pal.terraD;
        g.fillRect(a + p.dx * z0, y + p.dy * z0, b - a, Math.max(1, p.s * 0.05));
        // glyph
        const cx = (a + b) / 2 + p.dx * 0.5, cy = y + p.dy * 0.5;
        g.fillStyle = pressed ? "rgba(255,245,225,0.95)" : "rgba(255,240,220,0.7)";
        poly([cx, cy - p.s * 0.07, cx + p.s * 0.1, cy, cx, cy + p.s * 0.07, cx - p.s * 0.1, cy]);
      }
      function drawGate(p, pal, gt, sw, xs) {
        const b = gateBottom(gt, sw, xs);
        const open = gateOpen(gt, sw, xs) > 0;
        // guide posts
        g.fillStyle = pal.ironD;
        for (const xx of [gt.x0 - 0.06, gt.x1]) {
          const a = X(p, xx) + p.dx * 0.12;
          g.fillRect(a, p.y - 4, Math.max(2, p.s * 0.06), Y(p, gt.y0) + p.dy * 0.12 - p.y + 4);
        }
        box(p, gt.x0, gt.x1, b, b + gt.hgt, 0.1, 0.9, pal.iron, pal.ironL, pal.ironD);
        const a = X(p, gt.x0) + p.dx * 0.1;
        g.fillStyle = open ? pal.terraL : pal.terra;
        g.fillRect(a + p.s * 0.05, Y(p, b + 1.7) + p.dy * 0.1, (gt.x1 - gt.x0 - 0.1) * p.s, p.s * 1.1);
        const cx = a + (gt.x1 - gt.x0) * p.s / 2, cy = Y(p, b + 1.15) + p.dy * 0.1;
        g.fillStyle = "rgba(255,240,220,0.85)";
        poly([cx, cy - p.s * 0.08, cx + p.s * 0.08, cy, cx, cy + p.s * 0.08, cx - p.s * 0.08, cy]);
      }
      function drawPrism(p, pal, pr) {
        if (pr.taken && clock - pr.takenT > 0.4) return;
        const bob = Math.sin(clock * 2.6 + pr.x) * 0.05;
        const x = X(p, pr.x) + p.dx * 0.5, y = Y(p, pr.y + bob) + p.dy * 0.5, r = p.s * 0.17;
        let k = 1, al = 1;
        if (pr.taken) { const t = (clock - pr.takenT) / 0.4; k = 1 + t * 1.2; al = 1 - t; }
        g.globalAlpha = al * 0.28;
        g.fillStyle = pr.twin ? "#fff6e2" : pal.prism;
        g.beginPath(); g.arc(x, y, r * 2.1 * k, 0, TAU); g.fill();
        g.globalAlpha = al;
        const rot = Math.sin(clock * 1.8 + pr.x * 3);
        const wL = r * 0.75 * k * (0.55 + 0.45 * Math.abs(rot)), wR = r * 0.75 * k;
        g.fillStyle = pal.prismD;
        poly([x, y - r * 1.3 * k, x + wR, y, x, y + r * 1.3 * k]);
        g.fillStyle = pal.prism;
        poly([x, y - r * 1.3 * k, x - wL, y, x, y + r * 1.3 * k]);
        if (pr.twin) {
          g.strokeStyle = "rgba(220,110,60,0.7)"; g.lineWidth = 1.2;
          g.beginPath(); g.arc(x, y, r * 1.7 * k, 0, TAU); g.stroke();
        }
        g.globalAlpha = 1;
      }

      // ---------- characters ----------
      function drawChar(p, pal, run, i) {
        const c = run.sim.c[i], an = run.anim[i];
        if (run.dead === i && state !== "playing" && run.cause !== "fell") return;
        const s = p.s;
        const wy = renderY[i];
        const x = X(p, renderX) + p.dx * 0.5, y = Y(p, wy) + p.dy * 0.5;
        const cols = i === 0 ? pal.orig : pal.copy;
        const gilded = has("gilded");
        const phase = renderX * 3.4;
        const grounded = c.gr && state !== "ready";
        const idle = state === "ready";
        let bob = grounded ? Math.abs(Math.sin(phase)) * 0.03 : 0;
        if (idle) bob = Math.sin(clock * 2.4 + i) * 0.012;
        let lean = grounded ? 0.07 : clamp(-c.vy * 0.012, -0.14, 0.14);
        if (idle) lean = 0;
        if (an.teeter > 0) lean += Math.sin(clock * 30) * 0.22 * an.teeter;
        const sq = 1 + an.pulse * 0.12 * Math.sin(an.pulse * 9);

        // trail streaks (the reference's motion arcs)
        const tr = run.trail[i];
        if (tr.length > 6 && !c.gr && !idle) {
          g.strokeStyle = i === 0 ? "rgba(255,240,220,0.45)" : "rgba(235,255,250,0.55)";
          g.lineWidth = Math.max(1.5, s * 0.05);
          g.beginPath();
          for (let k = 0; k < tr.length; k += 2) {
            const tx = X(p, tr[k]) + p.dx * 0.5, ty = Y(p, tr[k + 1] + 0.45) + p.dy * 0.5;
            if (k === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
          }
          g.stroke();
        }
        // shadow on the surface below
        const below = groundBelow(run.W[i], renderX, wy);
        if (below !== null) {
          const h = wy - below;
          const k = clamp(1 - h / 3, 0.25, 1);
          g.fillStyle = `rgba(60,50,30,${0.22 * k})`;
          g.beginPath();
          g.ellipse(X(p, renderX) + p.dx * 0.5 + s * 0.08, Y(p, below) + p.dy * 0.5, s * 0.3 * k, s * 0.08 * k, 0, 0, TAU);
          g.fill();
        }
        // echoes behind the copy
        const echoes = i === 1 && !idle ? 2 : 0;
        for (let e = echoes; e >= 0; e--) {
          let ex = x, ey = y, al = 1;
          if (e > 0) {
            const idx = tr.length - 2 - e * 6;
            if (idx < 0) continue;
            ex = X(p, tr[idx]) + p.dx * 0.5 - 0; ey = Y(p, tr[idx + 1]) + p.dy * 0.5;
            al = e === 1 ? 0.16 : 0.07;
          }
          g.save();
          g.globalAlpha = al;
          g.translate(ex, ey - bob * s);
          g.rotate(lean);
          g.scale(an.sqx * sq, an.sqy * sq);
          drawFigure(s, cols, grounded, phase, an, c, idle, gilded && e === 0, i);
          g.restore();
        }
      }
      function drawFigure(s, cols, grounded, phase, an, c, idle, gilded, i) {
        const front = cols[0], top = cols[1], side = cols[2], eye = cols[3];
        const legW = 0.1 * s, legH = 0.17 * s;
        let l1 = 0, l2 = 0;
        if (grounded && !idle) { l1 = Math.max(0, Math.sin(phase)) * 0.08 * s; l2 = Math.max(0, -Math.sin(phase)) * 0.08 * s; }
        else if (!grounded) { l1 = 0.08 * s; l2 = 0.02 * s; }
        const dz = 0.14 * s, dzy = 0.1 * s;
        // legs
        g.fillStyle = side;
        g.fillRect(-0.13 * s, -legH - l1, legW, legH);
        g.fillStyle = front;
        g.fillRect(0.03 * s, -legH - l2, legW, legH);
        // body
        const bw = 0.32 * s, bh = 0.22 * s, by = -legH - bh + 0.02 * s;
        g.fillStyle = side;
        poly([-bw / 2, by, -bw / 2 - dz * 0.6, by - dzy * 0.6, -bw / 2 - dz * 0.6, by + bh - dzy * 0.6, -bw / 2, by + bh]);
        g.fillStyle = front;
        g.fillRect(-bw / 2, by, bw, bh);
        // arms
        const sw = grounded && !idle ? Math.sin(phase) * 0.06 * s : -0.05 * s;
        g.fillStyle = side;
        g.fillRect(-bw / 2 - 0.07 * s, by + 0.02 * s + sw, 0.07 * s, 0.15 * s);
        g.fillStyle = front;
        g.fillRect(bw / 2, by + 0.02 * s - sw, 0.07 * s, 0.15 * s);
        // head (a small sculpted cube)
        const hw = 0.48 * s, hh = 0.4 * s, hy = by - hh + 0.03 * s, hx = -hw / 2 + 0.02 * s;
        g.fillStyle = side;
        poly([hx, hy, hx - dz, hy - dzy, hx - dz, hy + hh - dzy, hx, hy + hh]);
        g.fillStyle = top;
        poly([hx, hy, hx + hw, hy, hx + hw - dz, hy - dzy, hx - dz, hy - dzy]);
        g.fillStyle = front;
        g.fillRect(hx, hy, hw, hh);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(hx, hy, hw, hh * 0.22);
        if (gilded) {
          g.fillStyle = i === 0 ? "rgba(255,214,120,0.9)" : "rgba(255,255,255,0.85)";
          g.fillRect(hx, hy + hh * 0.78, hw, hh * 0.1);
        }
        // eyes, looking ahead
        const blink = an.blink > 0 ? 0.25 : 1;
        g.fillStyle = eye;
        const ey = hy + hh * 0.42, eh = 0.075 * s * blink;
        g.fillRect(hx + hw * 0.52, ey, 0.055 * s, eh);
        g.fillRect(hx + hw * 0.78, ey, 0.055 * s, eh);
        if (an.bonk > 0) {
          g.fillStyle = "rgba(255,250,230,0.9)";
          for (let k = 0; k < 3; k++) {
            const a = clock * 8 + k * 2.1;
            g.fillRect(Math.cos(a) * 0.25 * s - 1, hy - 0.12 * s + Math.sin(a) * 0.06 * s, 3, 3);
          }
        }
      }
      function groundBelow(w, x, y) {
        let best = null;
        for (const b of w.blocks) {
          if (b.x1 < x - 0.23 || b.x0 > x + 0.23) continue;
          if (b.top <= y + 1e-3 && (best === null || b.top > best)) best = b.top;
        }
        return best;
      }

      function drawPanel(p, pal, run) {
        const w = run.W[p.i], sim = run.sim;
        g.save();
        g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip();
        drawSky(p, pal);
        drawSkyline(p, pal);
        drawClouds(p, pal, false);
        const xL = p.camX - (p.anchorX + 20) / p.s - 1.5, xR = p.camX + (p.w - p.anchorX + 40) / p.s + 1.5;
        const bottomY = p.y + p.h + 4;
        const bl = w.blocks;
        // pass A: blocks right-to-left (farther first)
        let charIdx = -1;
        for (let k = bl.length - 1; k >= 0; k--) {
          const b = bl[k];
          if (b.x0 > xR || b.x1 < xL) continue;
          drawBlock(p, pal, b, k > 0 ? bl[k - 1] : null, bottomY);
          drawBlockDeco(p, pal, b, true);
          if (b.x0 <= renderX + 0.23 && b.x1 >= renderX - 0.23 && charIdx < 0) charIdx = k;
        }
        // step shadows (light from the upper left)
        g.fillStyle = pal.shade;
        for (let k = 1; k < bl.length; k++) {
          const b = bl[k], a = bl[k - 1];
          if (b.x0 > xR || b.x1 < xL) continue;
          if (Math.abs(a.x1 - b.x0) < 1e-4 && a.top > b.top) {
            const len = Math.min(b.x1 - b.x0, (a.top - b.top) * 0.9 + 0.25);
            const ty = Y(p, b.top), x0 = X(p, b.x0), x1 = X(p, b.x0 + len);
            poly([x0, ty, x1, ty, x1 + p.dx, ty + p.dy, x0 + p.dx, ty + p.dy]);
          }
        }
        for (let k = bl.length - 1; k >= 0; k--) {
          const b = bl[k];
          if (b.x0 > xR || b.x1 < xL) continue;
          drawBlockDeco(p, pal, b, false);
        }
        // ceiling shadows on the floor
        g.fillStyle = "rgba(70,55,35,0.13)";
        for (const ce of w.ceils) {
          if (ce.x0 > xR || ce.x1 < xL) continue;
          const top = groundBelow(w, (ce.x0 + ce.x1) / 2, ce.y);
          if (top === null) continue;
          const ty = Y(p, top), a = X(p, ce.x0 + 0.25), b = X(p, ce.x1 + 0.35);
          poly([a + p.dx * 0.15, ty + p.dy * 0.15, b + p.dx * 0.15, ty + p.dy * 0.15, b + p.dx * 0.85, ty + p.dy * 0.85, a + p.dx * 0.85, ty + p.dy * 0.85]);
        }
        for (const pl of w.plates) if (pl.x0 < xR && pl.x1 > xL) drawPlate(p, pal, pl, sim.sw);
        for (const sp of w.spikes) if (sp.x0 < xR && sp.x1 > xL) drawSpikes(p, pal, sp);
        for (const lf of w.lifts) if (lf.x0 < xR && lf.x1 > xL) drawLift(p, pal, lf, renderX);
        for (const gt of w.gates) if (gt.x0 < xR && gt.x1 > xL) drawGate(p, pal, gt, sim.sw, renderX);
        for (const pi of w.pistons) if (pi.x0 < xR && pi.x1 > xL) drawPiston(p, pal, pi, renderX);
        for (const pr of w.prisms) if (pr.x < xR && pr.x > xL) drawPrism(p, pal, pr);
        drawChar(p, pal, run, p.i);
        for (const ce of w.ceils) if (ce.x0 < xR && ce.x1 > xL) drawCeil(p, pal, ce);
        // occlusion: a ledge in front of a character that has dropped below it
        const cy = renderY[p.i];
        for (let k = bl.length - 1; k >= 0; k--) {
          const b = bl[k];
          if (b.x1 > renderX - 0.02 || b.x1 < renderX - 0.75) continue;
          if (b.top > cy + 0.05) {
            const x0 = X(p, b.x0), x1 = X(p, b.x1), ty = Y(p, b.top);
            g.fillStyle = p.i === 0 ? pal.front : pal.frontC;
            g.fillRect(x0, ty, x1 - x0, bottomY - ty);
            g.fillStyle = pal.ao;
            g.fillRect(x0, ty, x1 - x0, Math.max(1, p.s * 0.06));
          }
          break;
        }
        drawParticles(p, pal, run);
        drawClouds(p, pal, true);
        g.fillStyle = L.fogGrad[p.i];
        g.fillRect(p.x, p.y + p.h * 0.66, p.w, p.h * 0.34 + 1);
        drawFloats(p, pal, run);
        if (state === "dying") drawCause(p, pal, run);
        g.restore();
      }
      function drawParticles(p, pal, run) {
        for (const q of run.fx.parts) {
          if (q.pi !== p.i) continue;
          const a = 1 - q.t / q.life;
          g.fillStyle = `rgba(250,244,226,${0.8 * a})`;
          g.beginPath(); g.arc(X(p, q.x) + p.dx * 0.5, Y(p, q.y) + p.dy * 0.5, q.r * p.s * (1 + q.t * 2), 0, TAU); g.fill();
        }
        for (const sh of run.fx.shards) {
          if (sh.pi !== p.i) continue;
          g.save();
          g.translate(X(p, sh.x) + p.dx * 0.5, Y(p, sh.y) + p.dy * 0.5);
          g.rotate(sh.rot);
          g.fillStyle = sh.col;
          const r = sh.r * p.s;
          g.fillRect(-r, -r, r * 2, r * 2);
          g.restore();
        }
      }
      function colorOf(pal, key) {
        if (key === "terra") return pal.terraD;
        if (key === "muted") return "rgba(47,58,53,0.7)";
        return pal.cream;
      }
      function drawFloats(p, pal, run) {
        for (const f of run.fx.floats) {
          if (f.pi === -1) {
            // shared message: draw in both panels near each character
          } else if (f.pi !== p.i) continue;
          const t = f.t / f.life;
          const a = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.6) / 0.4);
          const wy = f.pi === -1 ? Math.max(renderY[p.i], run.sim.c[p.i].y) + 1.25 + (f.big ? 0.35 : 0) : f.wy;
          g.font = (f.big ? "600 " : "400 ") + Math.round(f.big ? 13 : 11) + "px " + FONT;
          const half = measureSpaced(f.text, f.big ? 2.4 : 1.6) / 2 + 10;
          const x = clamp(X(p, f.pi === -1 ? renderX : f.wx) + p.dx * 0.5, p.x + half, p.x + p.w - half), y = Y(p, wy) - t * p.s * 0.5;
          g.globalAlpha = clamp(a, 0, 1);
          const col = colorOf(pal, f.color);
          if (f.color !== "muted") {
            g.fillStyle = "rgba(40,50,45,0.35)";
            spaced(f.text, x + 1, y + 1, f.big ? 2.4 : 1.6, "center");
          }
          g.fillStyle = col;
          spaced(f.text, x, y, f.big ? 2.4 : 1.6, "center");
          g.globalAlpha = 1;
        }
      }
      function drawCause(p, pal, run) {
        if (run.dead !== p.i) return;
        const a = clamp(stateT / 0.3, 0, 1);
        g.globalAlpha = a;
        g.font = "600 11px " + FONT;
        const x = X(p, run.sim.x) + p.dx * 0.5, y = Y(p, Math.max(run.sim.c[p.i].y, p.camY - 1)) - p.s * 1.3;
        const label = (p.i === 0 ? "THE ORIGINAL " : "THE COPY ") + (CAUSE[run.cause] || "STUMBLED");
        g.fillStyle = "rgba(40,45,42,0.55)";
        const wdt = measureSpaced(label, 1.8) + 20;
        roundRect(clamp(x - wdt / 2, p.x + 6, p.x + p.w - wdt - 6), y - 16, wdt, 24, 12);
        g.fill();
        g.fillStyle = pal.cream;
        spaced(label, clamp(x, p.x + 6 + wdt / 2, p.x + p.w - 6 - wdt / 2), y + 0.5, 1.8, "center");
        g.globalAlpha = 1;
      }
      function drawLinks(run, pal) {
        if (!cfg.links) return;
        // dashed line connecting a pressure plate to the gate it controls
        for (let i = 0; i < 2; i++) {
          const pa = L.panels[i], pb = L.panels[1 - i];
          for (const pl of run.W[i].plates) {
            if (pl.gateX === undefined) continue;
            const ax = X(pa, (pl.x0 + pl.x1) / 2) + pa.dx * 0.5, ay = Y(pa, pl.y) + pa.dy * 0.5;
            const bx = X(pb, pl.gateX) + pb.dx * 0.5, gate = run.W[1 - i].gates.find((g2) => g2.link === pl.link);
            if (!gate) continue;
            const by = Y(pb, gate.y0 + 1.0) + pb.dy * 0.5;
            if ((ax < -50 && bx < -50) || (ax > L.W + 50 && bx > L.W + 50)) continue;
            const pressed = run.sim.sw[pl.link] !== undefined;
            g.save();
            g.strokeStyle = pressed ? "rgba(233,138,92,0.85)" : "rgba(208,98,58,0.6)";
            g.lineWidth = 1.5;
            g.setLineDash([4, 5]);
            g.lineDashOffset = -clock * 18;
            g.beginPath();
            if (L.mode === "stack") {
              g.moveTo(ax, ay); g.bezierCurveTo(ax, (ay + by) / 2, bx, (ay + by) / 2, bx, by);
            } else {
              g.moveTo(ax, ay); g.lineTo(ax, ay - 30);
              g.moveTo(bx, by); g.lineTo(bx, by - 40);
            }
            g.stroke();
            g.restore();
          }
        }
      }

      // ---------- typography ----------
      const widthCache = new Map();
      function charW(ch) {
        const key = g.font + "|" + ch;
        let w = widthCache.get(key);
        if (w === undefined) { w = g.measureText(ch).width; if (widthCache.size > 600) widthCache.clear(); widthCache.set(key, w); }
        return w;
      }
      function measureSpaced(text, sp) {
        let w = 0;
        for (let k = 0; k < text.length; k++) w += charW(text[k]) + sp;
        return w - sp;
      }
      function spaced(text, x, y, sp, align) {
        const w = measureSpaced(text, sp);
        let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        for (let k = 0; k < text.length; k++) { g.fillText(text[k], cx, y); cx += charW(text[k]) + sp; }
      }
      function roundRect(x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
      }

      function drawHUD(run, pal) {
        const sa = L.sa;
        const p0 = L.panels[0], p1 = L.panels[1];
        const right = L.mode === "side" ? p1 : p0;
        const top = (sa.top || 0) + 16;
        const left = p0.x + (sa.left || 0) + 16;
        g.save();
        // challenge number + caption (top-left)
        if (state !== "ready") {
          const fade = clamp(run.captionT / 0.4, 0, 1);
          g.globalAlpha = fade;
          g.fillStyle = pal.cream;
          g.font = "300 26px " + FONT;
          const n = run.captionN ? String(run.captionN).padStart(2, "0") : "—";
          spaced(n, left, top + 22, 1, "left");
          g.font = "400 10px " + FONT;
          spaced(run.caption || "", left, top + 42, 2.4, "left");
          g.fillRect(left, top + 52, 16, 1.5);
          g.globalAlpha = 1;
          if (run.hint && run.hintT < 5) {
            g.globalAlpha = clamp(Math.min(run.hintT / 0.4, (5 - run.hintT) / 0.6), 0, 1);
            g.font = "400 10px " + FONT;
            g.fillStyle = "rgba(247,241,220,0.9)";
            spaced(run.hint, left, top + 70, 2, "left");
            g.globalAlpha = 1;
          }
        }
        // score (top-right)
        const rx = right.x + right.w - (sa.right || 0) - 16;
        g.fillStyle = pal.cream;
        g.font = "400 9px " + FONT;
        spaced("SCORE", rx, top + 6, 2.4, "right");
        g.font = "300 24px " + FONT;
        spaced(String(run.score), rx, top + 31, 0.5, "right");
        if (run.combo >= 2 || run.comboShake > 0) {
          const shake = run.comboShake > 0 ? Math.sin(clock * 50) * 3 * run.comboShake : 0;
          g.globalAlpha = run.combo >= 2 ? 1 : clamp(run.comboShake * 2, 0, 1);
          g.font = "600 10px " + FONT;
          const mult = 1 + Math.min(3, Math.floor(run.combo / 5));
          spaced("COMBO ×" + run.combo + (mult > 1 ? "  ·  ×" + mult + " PTS" : ""), rx + shake, top + 48, 1.8, "right");
          g.globalAlpha = 1;
        }
        // world tags
        g.font = "600 9px " + FONT;
        for (let i = 0; i < 2; i++) {
          const p = L.panels[i];
          const tx = p.x + (sa.left || 0) + 16;
          const ty = L.mode === "stack" ? (i === 0 ? p.y + p.h - 14 : p.y + 20) : p.y + p.h - (sa.bottom || 0) - 18;
          g.fillStyle = i === 0 ? pal.orig[0] : pal.copy[0];
          g.fillRect(tx, ty - 7, 7, 7);
          g.fillStyle = i === 0 && L.mode === "stack" ? "rgba(46,58,53,0.62)" : L.mode === "side" ? "rgba(46,58,53,0.62)" : "rgba(247,241,220,0.9)";
          spaced(i === 0 ? "ORIGINAL" : "COPY", tx + 13, ty, 2.2, "left");
        }
        // mute toggle
        const mp = L.mode === "stack" ? p1 : p1;
        muteBtn.x = mp.x + mp.w - (sa.right || 0) - 26;
        muteBtn.y = L.mode === "stack" ? mp.y + 22 : mp.y + mp.h - (sa.bottom || 0) - 26;
        drawMute(pal);
        // toasts
        let ty = L.mode === "stack" ? L.H / 2 - 52 : L.H * 0.22;
        for (const t of run.fx.toasts) {
          const k = t.t / t.life;
          const a = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.75) / 0.25);
          g.globalAlpha = clamp(a, 0, 1);
          g.font = "600 13px " + FONT;
          const wdt = Math.max(measureSpaced(t.text, 3), 0) + 36;
          g.fillStyle = "rgba(40,50,45,0.45)";
          roundRect(L.W / 2 - wdt / 2, ty - 18, wdt, t.sub ? 40 : 28, 14);
          g.fill();
          g.fillStyle = pal.cream;
          spaced(t.text, L.W / 2, ty, 3, "center");
          if (t.sub) { g.font = "400 9px " + FONT; spaced(t.sub, L.W / 2, ty + 14, 2, "center"); }
          g.globalAlpha = 1;
          ty -= 48;
        }
        if (run.perfectFlash > 0) {
          g.globalAlpha = run.perfectFlash * 0.18;
          g.fillStyle = "#fff8e6";
          g.fillRect(0, 0, L.W, L.H);
          g.globalAlpha = 1;
        }
        g.restore();
      }
      function drawMute(pal) {
        const x = muteBtn.x, y = muteBtn.y;
        g.fillStyle = "rgba(40,50,45,0.22)";
        g.beginPath(); g.arc(x, y, 14, 0, TAU); g.fill();
        g.fillStyle = pal.cream;
        poly([x - 6, y - 3, x - 2, y - 3, x + 2, y - 7, x + 2, y + 7, x - 2, y + 3, x - 6, y + 3]);
        g.strokeStyle = pal.cream; g.lineWidth = 1.4;
        g.beginPath();
        if (audio.muted) { g.moveTo(x + 4, y - 4); g.lineTo(x + 9, y + 4); g.moveTo(x + 9, y - 4); g.lineTo(x + 4, y + 4); }
        else { g.arc(x + 2, y, 5, -0.9, 0.9); g.moveTo(x + 2 + 8 * Math.cos(-0.9), y + 8 * Math.sin(-0.9)); g.arc(x + 2, y, 8, -0.9, 0.9); }
        g.stroke();
      }
      function drawTitle(pal) {
        const p0 = L.panels[0];
        const cx = L.mode === "stack" ? L.W / 2 : L.W / 2;
        const ty = L.mode === "stack" ? p0.y + p0.h * 0.2 : L.H * 0.16;
        g.save();
        g.fillStyle = pal.cream;
        const size = Math.round(clamp(L.W * 0.1, 30, 64));
        g.font = "300 " + size + "px " + FONT;
        spaced("COPYCAT", cx, ty + size * 0.4, size * 0.32, "center");
        g.font = "400 10px " + FONT;
        spaced("YOUR MOVES COME BACK", cx, ty + size * 0.4 + 26, 3.2, "center");
        g.fillRect(cx - 12, ty + size * 0.4 + 40, 24, 1.5);
        const py = L.mode === "stack" ? L.H / 2 - 22 : L.H * 0.82;
        const a = 0.65 + 0.35 * Math.sin(clock * 3);
        g.globalAlpha = a;
        g.font = "600 12px " + FONT;
        g.fillStyle = "rgba(40,50,45,0.35)";
        roundRect(cx - 104, py - 18, 208, 28, 14);
        g.fill();
        g.fillStyle = pal.cream;
        spaced("ONE TAP. TWO WORLDS.", cx, py, 2.6, "center");
        g.globalAlpha = 1;
        g.restore();
      }
      function drawGameOver(run, pal) {
        const a = clamp(stateT / 0.25, 0, 1);
        g.save();
        g.globalAlpha = a;
        g.fillStyle = pal.veil;
        g.fillRect(0, 0, L.W, L.H);
        const cx = L.W / 2;
        let y = L.H * 0.22 + (L.sa.top || 0) * 0.5;
        g.fillStyle = pal.ink;
        g.font = "300 30px " + FONT;
        spaced("COPYCAT", cx, y, 9, "center");
        y += 22;
        g.font = "400 10px " + FONT;
        g.fillStyle = "rgba(46,58,53,0.75)";
        const reason = (run.dead === 0 ? "THE ORIGINAL " : "THE COPY ") + (CAUSE[run.cause] || "STUMBLED");
        spaced(reason, cx, y, 2.2, "center");
        if (run.cause === "gate") { y += 16; spaced("STEP ON THE SWITCH IN THE OTHER WORLD", cx, y, 1.8, "center"); }
        y += 14;
        g.fillRect(cx - 10, y, 20, 1.5);
        y += 34;
        const rows = [
          ["SCORE", String(run.score)],
          ["BEST", String(Math.max(save.best, run.score))],
          ["PAIRS", String(run.pairs)],
          ["BEST COMBO", String(run.bestCombo)],
          ["PERFECT PAIRS", String(run.perfects)]
        ];
        const colW = Math.min(220, L.W * 0.6);
        for (const r of rows) {
          g.fillStyle = "rgba(46,58,53,0.7)";
          g.font = "400 10px " + FONT;
          spaced(r[0], cx - colW / 2, y, 2.4, "left");
          g.fillStyle = pal.ink;
          g.font = (r[0] === "SCORE" ? "600 " : "400 ") + "18px " + FONT;
          spaced(r[1], cx + colW / 2, y + 2, 0.5, "right");
          y += 30;
        }
        if (run.newBest && run.score > 0) {
          g.fillStyle = pal.terraD;
          g.font = "600 11px " + FONT;
          spaced("NEW PERSONAL BEST", cx, y + 4, 3, "center");
          y += 24;
        }
        if (run.unlockedNow.length) {
          g.fillStyle = pal.ink;
          g.font = "400 10px " + FONT;
          spaced("KEEPSAKE UNLOCKED · " + run.unlockedNow.join(" · "), cx, y + 4, 2, "center");
          y += 22;
        }
        atmoBtn.on = has("dusk");
        if (atmoBtn.on) {
          const label = "ATMOSPHERE · " + (save.atmosphere === "dusk" ? "DUSK" : "DAY");
          g.font = "600 10px " + FONT;
          const wdt = measureSpaced(label, 2.2) + 28;
          atmoBtn.x = cx - wdt / 2; atmoBtn.y = y + 6; atmoBtn.w = wdt; atmoBtn.h = 26;
          g.strokeStyle = "rgba(46,58,53,0.4)"; g.lineWidth = 1;
          roundRect(atmoBtn.x, atmoBtn.y, wdt, 26, 13); g.stroke();
          g.fillStyle = pal.ink;
          spaced(label, cx, atmoBtn.y + 17, 2.2, "center");
        }
        const by = L.H - Math.max(70, (L.sa.bottom || 0) + 60);
        g.globalAlpha = a * (0.6 + 0.4 * Math.sin(clock * 3.2));
        g.fillStyle = pal.ink;
        g.font = "600 12px " + FONT;
        spaced("TAP TO TRY AGAIN", cx, by, 3.2, "center");
        g.restore();
      }

      // ---- boot ----
      newRun(true);
      layout();
      ctx.onResize(() => { layout(); }, { immediate: true });
      for (const p of L.panels) {
        p.s = Math.min(p.w / viewW(cfg.vStart), p.h / 5.6);
        p.camY = 0; p.camT = 0;
      }
      update(16);
      render(1);
      try { ctx.platform.ready(); } catch (e) { /* ignore */ }

      ctx.game.loop({
        fixedHz: 120,
        maxDeltaMs: 100,
        maxSubsteps: 12,
        resetOnResume: true,
        input,
        fixedUpdate() {
          if (state === "playing") fixedStep();
        },
        update(dtMs) { update(dtMs); },
        render(alpha) { render(alpha); }
      });

      if (TEST) {
        window.__copycat = {
          get state() { return state; },
          get run() { return RUN; },
          P, cfg, ramp,
          press: () => press(),
          restart,
          layoutInfo: () => ({ mode: L.mode, panels: L.panels.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, s: p.s })) })
        };
      }
    }
  };

  if (typeof window !== "undefined" && window.__COPYCAT_TEST__) {
    window.__copycatCore = { makePhys, makeSolver, createGenerator, newSim, stepSim, cloneSim, newWorld, EV: { EV_JUMP, EV_LAND, EV_BONK, EV_TEETER, EV_DIE, EV_PLATE } };
  }
})();
