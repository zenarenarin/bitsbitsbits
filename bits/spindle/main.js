(function () {
  "use strict";

  // ===================================================================
  // SPINDLE — endless radial pin arcade
  //
  // Layout of this file:
  //   1. Core      — pure gameplay model: geometry, swept collision,
  //                  rotation, difficulty, spindle generation, game state.
  //                  No DOM, no canvas. Exposed as plethoraBit.core so it
  //                  can be tested headlessly.
  //   2. init(ctx) — Plethora runtime glue: canvas setup/resizing,
  //                  rendering, input, audio, score + personal best, HUD.
  // ===================================================================

  const TAU = Math.PI * 2;
  const HALF_PI = Math.PI / 2;

  // -------------------------------------------------------------------
  // 1. CORE
  // -------------------------------------------------------------------
  const Core = (function () {
    // World units. The target sits at the origin; screen-style axes
    // (x right, y down), so world angle PI/2 points down at the launcher.
    const G = Object.freeze({
      R: 36,            // target radius
      L: 84,            // pin length (tip on the rim to outer end)
      W: 4.6,           // shaft width
      TAPER: 14,        // tip taper length
      TIP: 0.6,         // half-width of the blunt needle point
      CHAMFER: 1.0,     // outer-end chamfer
      CLEARANCE: 0.5,   // pins closer than this are touching = collision
      SWEEP_EPS: 0.2,   // max relative motion between swept samples
      S0: 150,          // waiting pin offset: its tip rests at R + S0
      MAX_PINS: 72
    });

    // The one collision shape every pin uses, in pin-local coordinates:
    // x is radial (outwards from the centre), y is tangential. Convex,
    // counter-clockwise. The renderer fills exactly this polygon.
    const PIN_POLY = (function () {
      const h = G.W / 2;
      const x0 = G.R, xt = G.R + G.TAPER, x1 = G.R + G.L, c = G.CHAMFER;
      return new Float64Array([
        x0, -G.TIP,
        xt, -h,
        x1 - c, -h,
        x1, -h + c,
        x1, h - c,
        x1 - c, h,
        xt, h,
        x0, G.TIP
      ]);
    })();
    const PIN_N = PIN_POLY.length / 2;

    // Pin edge normals (outward), precomputed.
    const PIN_NORMALS = (function () {
      const out = new Float64Array(PIN_POLY.length);
      for (let i = 0; i < PIN_N; i++) {
        const j = (i + 1) % PIN_N;
        const ex = PIN_POLY[2 * j] - PIN_POLY[2 * i];
        const ey = PIN_POLY[2 * j + 1] - PIN_POLY[2 * i + 1];
        const len = Math.hypot(ex, ey);
        out[2 * i] = ey / len;
        out[2 * i + 1] = -ex / len;
      }
      return out;
    })();

    // Two pins further apart than this (in angle) can never be within
    // CLEARANCE of each other: every pin point lies at radius >= R inside
    // a sector of half-angle PIN_HALF_ANGLE.
    const PIN_HALF_ANGLE = (function () {
      let a = 0;
      for (let i = 0; i < PIN_N; i++) {
        a = Math.max(a, Math.abs(Math.atan2(PIN_POLY[2 * i + 1], PIN_POLY[2 * i])));
      }
      return a;
    })();
    const BROAD_ANGLE = 2 * PIN_HALF_ANGLE + G.CLEARANCE / G.R + 0.01;

    function wrapPi(a) {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    }
    function wrap2Pi(a) {
      a %= TAU;
      return a < 0 ? a + TAU : a;
    }

    // Scratch buffers (no allocation in hot paths).
    const Q = new Float64Array(PIN_POLY.length);
    const QN = new Float64Array(PIN_POLY.length);
    const contactScratch = { x: 0, y: 0 };

    // Place the pin polygon at angle `rel` with radial offset `s`, expressed
    // in the frame of a reference pin at angle 0 / offset 0.
    function placePin(rel, s, out) {
      const c = Math.cos(rel), sn = Math.sin(rel);
      for (let i = 0; i < PIN_N; i++) {
        const x = PIN_POLY[2 * i] + s, y = PIN_POLY[2 * i + 1];
        out[2 * i] = x * c - y * sn;
        out[2 * i + 1] = x * sn + y * c;
      }
    }

    function rotateNormals(rel, out) {
      const c = Math.cos(rel), sn = Math.sin(rel);
      for (let i = 0; i < PIN_N; i++) {
        const x = PIN_NORMALS[2 * i], y = PIN_NORMALS[2 * i + 1];
        out[2 * i] = x * c - y * sn;
        out[2 * i + 1] = x * sn + y * c;
      }
    }

    // Max over A's edges of the min signed distance of B's vertices.
    function satSep(A, AN, B) {
      let best = -Infinity;
      for (let i = 0; i < PIN_N; i++) {
        const ax = A[2 * i], ay = A[2 * i + 1];
        const nx = AN[2 * i], ny = AN[2 * i + 1];
        let mn = Infinity;
        for (let k = 0; k < PIN_N; k++) {
          const d = (B[2 * k] - ax) * nx + (B[2 * k + 1] - ay) * ny;
          if (d < mn) mn = d;
        }
        if (mn > best) best = mn;
      }
      return best;
    }

    // Exact Euclidean distance between the boundaries of two convex polygons
    // (vertex-to-edge minimum, both ways). Writes the midpoint of the
    // closest pair into `contact`.
    function boundaryDistance(A, B, contact) {
      let best = Infinity;
      for (let pass = 0; pass < 2; pass++) {
        const P = pass === 0 ? A : B;
        const V = pass === 0 ? B : A;
        for (let i = 0; i < PIN_N; i++) {
          const j = (i + 1) % PIN_N;
          const ax = P[2 * i], ay = P[2 * i + 1];
          const ex = P[2 * j] - ax, ey = P[2 * j + 1] - ay;
          const ee = ex * ex + ey * ey;
          for (let k = 0; k < PIN_N; k++) {
            const vx = V[2 * k], vy = V[2 * k + 1];
            let t = ((vx - ax) * ex + (vy - ay) * ey) / ee;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + ex * t, py = ay + ey * t;
            const d = Math.hypot(vx - px, vy - py);
            if (d < best) {
              best = d;
              contact.x = (vx + px) / 2;
              contact.y = (vy + py) / 2;
            }
          }
        }
      }
      return best;
    }

    // Gap between the reference pin (angle 0, offset 0) and a pin at
    // relative angle `rel` with radial offset `s`. Positive = exact distance,
    // <= 0 = overlapping. Early-outs once the gap is known to be >= limit.
    function pinGap(rel, s, limit, contact) {
      placePin(rel, s, Q);
      rotateNormals(rel, QN);
      const sep = Math.max(satSep(PIN_POLY, PIN_NORMALS, Q), satSep(Q, QN, PIN_POLY));
      if (sep >= limit) return sep; // distance >= SAT separation >= limit
      const d = boundaryDistance(PIN_POLY, Q, contact || contactScratch);
      return sep > 0 ? d : -d;
    }

    // ---- Swept launch ------------------------------------------------
    // The incoming pin travels straight up the fixed launch axis (world
    // angle PI/2) while the structure keeps rotating. In the structure's
    // frame the incoming pin's angle is beta(t) = PI/2 - theta(t) and its
    // radial offset is s(t) = S0 - v t.
    //
    // The trajectory is swept with conservative advancement: no point of
    // either pin moves faster than relSpeed, so if every pin is at least
    // `gap` away now, nothing can reach CLEARANCE for (gap - CLEARANCE) /
    // relSpeed seconds. Near contact the step falls back to a floor where
    // relative motion is at most SWEEP_EPS per sample. Nothing can tunnel,
    // and the final pose (s = 0) is always tested. The whole flight is
    // resolved from the launch time alone, so the outcome is independent of
    // the display frame rate.
    function simulateLaunch(angles, count, theta0, omega, flightSec, out, sweepEps) {
      const v = G.S0 / flightSec;
      const reach = G.R + 2 * G.L + G.W;
      const relSpeed = v + Math.abs(omega) * reach;
      const dtMin = (sweepEps || G.SWEEP_EPS) / relSpeed;
      // No radial overlap is possible until the tip is inside R + L + clearance.
      let tau = Math.max(0, (G.S0 - (G.L + G.CLEARANCE + 0.05)) / v);
      out.hit = false;
      out.pin = -1;
      out.samples = 0;
      for (;;) {
        let last = false;
        if (tau >= flightSec) { tau = flightSec; last = true; }
        out.samples++;
        const s = last ? 0 : G.S0 - v * tau;
        const beta = HALF_PI - (theta0 + omega * tau);
        let minGap = Infinity;
        for (let j = 0; j < count; j++) {
          const rel = wrapPi(beta - angles[j]);
          const ar = rel < 0 ? -rel : rel;
          if (ar > BROAD_ANGLE) {
            // Sector bound: angular clearance beyond BROAD_ANGLE, chord >= (2/PI) arc.
            const lb = 0.63 * G.R * (ar - BROAD_ANGLE) + G.CLEARANCE;
            if (lb < minGap) minGap = lb;
            continue;
          }
          const gap = pinGap(rel, s, G.CLEARANCE, contactScratch);
          if (gap < G.CLEARANCE) {
            // Contact point back into the structure frame.
            const c = Math.cos(angles[j]), sn = Math.sin(angles[j]);
            out.hit = true;
            out.pin = j;
            out.tau = tau;
            out.s = s;
            out.beta = wrap2Pi(beta);
            out.cx = contactScratch.x * c - contactScratch.y * sn;
            out.cy = contactScratch.x * sn + contactScratch.y * c;
            return out;
          }
          if (gap < minGap) minGap = gap;
        }
        if (last) break;
        tau += Math.max(dtMin, (minGap - G.CLEARANCE) / relSpeed);
      }
      out.tau = flightSec;
      out.s = 0;
      out.beta = wrap2Pi(HALF_PI - (theta0 + omega * flightSec));
      return out;
    }

    // ---- Feasibility analysis ---------------------------------------------
    // For a single attached pin, the set of launch-time relative angles
    // (incoming minus attached) that collide is one interval [lo, hi]
    // (verified in tests). It is not centred on 0: an attached pin can rotate
    // out of the way before the incoming pin arrives. All pins are identical,
    // so one interval per rotation speed describes the whole structure.
    // Used only to generate fair spindles; play always uses the full sweep.
    // The analysis samples more coarsely and then widens the interval by a
    // margin that covers anything the coarse sweep could miss, so it is
    // conservative (it never reports room that is not there).
    const ANALYSIS_EPS = 0.6;
    const ANALYSIS_MARGIN = 0.012;
    const badCache = new Map();
    const one = new Float64Array(1);
    const probe = {};
    const GRID = 0.05;
    function collidesAt(rel0, omega, flightSec) {
      one[0] = 0;
      return simulateLaunch(one, 1, HALF_PI - rel0, omega, flightSec, probe, ANALYSIS_EPS).hit;
    }
    function gridKey(i, flightSec) { return i + "|" + flightSec.toFixed(4); }
    // Exact (margin-widened) interval for a non-negative grid speed.
    function gridInterval(i, flightSec) {
      const key = gridKey(i, flightSec);
      const hit = badCache.get(key);
      if (hit) return hit;
      const omega = i * GRID;
      // Launching so the pin would arrive dead-on always collides.
      const centre = omega * flightSec;
      const edge = dir => {
        let inside = centre, outside = centre + dir * 0.05;
        while (collidesAt(outside, omega, flightSec)) { inside = outside; outside += dir * 0.05; }
        for (let k = 0; k < 13; k++) {
          const m = (inside + outside) / 2;
          if (collidesAt(m, omega, flightSec)) inside = m; else outside = m;
        }
        return outside + dir * ANALYSIS_MARGIN;
      };
      const res = { lo: edge(-1), hi: edge(1) };
      badCache.set(key, res);
      return res;
    }
    // Both edges grow monotonically with speed (tested), so the union of the
    // two neighbouring grid speeds contains the interval for any speed in
    // between. Reverse rotation is the mirror image.
    function badInterval(omega, flightSec) {
      const a = Math.abs(omega) / GRID;
      const i0 = Math.floor(a + 1e-9), i1 = Math.ceil(a - 1e-9);
      const A = gridInterval(i0, flightSec), B = gridInterval(Math.max(i0, i1), flightSec);
      const lo = Math.min(A.lo, B.lo), hi = Math.max(A.hi, B.hi);
      return omega >= 0 ? { lo, hi } : { lo: -hi, hi: -lo };
    }
    // Grid speeds a spindle will need, for idle-time warming.
    function gridNeeds(spec, tune) {
      const out = [];
      const f = tune.flightMs / 1000;
      for (let p = 0; p <= spec.quota + 1; p++) {
        const a = Math.abs(omegaFor(spec, p, tune)) / GRID;
        for (const i of [Math.floor(a + 1e-9), Math.ceil(a - 1e-9)]) {
          if (!badCache.has(gridKey(i, f)) && out.indexOf(i) < 0) out.push(i);
        }
      }
      return out;
    }

    // Free launch windows (in launch-relative angle) for a structure.
    function goodIntervals(angles, count, omega, flightSec) {
      if (count === 0) return [{ start: 0, len: TAU }];
      const bad = badInterval(omega, flightSec);
      const iv = [];
      for (let j = 0; j < count; j++) {
        iv.push([wrap2Pi(angles[j] + bad.lo), bad.hi - bad.lo]);
      }
      iv.sort((a, b) => a[0] - b[0]);
      // Merge on the circle: unroll once.
      const merged = [];
      for (const [st, len] of iv) {
        const last = merged[merged.length - 1];
        if (last && st <= last[1]) last[1] = Math.max(last[1], st + len);
        else merged.push([st, st + len]);
      }
      // Wrap overlap between the last and first.
      if (merged.length > 1) {
        const first = merged[0], last = merged[merged.length - 1];
        if (last[1] >= first[0] + TAU) {
          first[0] = last[0] - TAU;
          first[1] = Math.max(first[1], last[1] - TAU);
          merged.pop();
        }
      }
      const good = [];
      for (let i = 0; i < merged.length; i++) {
        const end = merged[i][1];
        const next = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + TAU;
        if (next > end) good.push({ start: wrap2Pi(end), len: next - end });
      }
      return good;
    }

    // ---- Difficulty --------------------------------------------------------
    const DEFAULT_TUNE = Object.freeze({
      startSpeed: 1.35,   // rad/s on the first spindle
      maxSpeed: 2.5,      // readability ceiling
      flightMs: 150,      // launch animation length
      quota: 6,           // pins to add on the first spindle
      spindleGrowth: 0.09 // speed growth per completed spindle
    });

    function spindleSpec(k, tune) {
      const dir = k % 2 === 0 ? 1 : -1;
      return {
        index: k,
        dir,
        base: Math.min(tune.maxSpeed, tune.startSpeed * (1 + tune.spindleGrowth * k)),
        initial: Math.min(8, 3 + Math.floor(k * 0.55)),
        quota: Math.min(10, tune.quota + Math.floor(k / 2)),
        // How far apart initial pins must be: generous at first, tighter later.
        minSep: Math.max(0.3, 1.05 - 0.08 * k),
        // Narrowest launch window (ms) the generator will count on.
        minWindowMs: Math.max(120, 260 - 24 * k)
      };
    }

    // Speed for the i-th placement on a spindle (gradual ramp, capped).
    function omegaFor(spec, placed, tune) {
      return spec.dir * Math.min(tune.maxSpeed, spec.base * (1 + 0.022 * placed));
    }

    // Constructive lower bound on how many more pins fit, each placement
    // keeping a launch window of at least minWindowMs. Packs like a skilled
    // player would: tight against one edge of a long window, centred in a short one.
    function greedyCapacity(angles, count, spec, tune, need) {
      const a = new Float64Array(G.MAX_PINS);
      a.set(angles.subarray(0, count));
      let n = count;
      const flight = tune.flightMs / 1000;
      let placed = 0;
      while (placed < need && n < G.MAX_PINS) {
        const omega = omegaFor(spec, placed, tune);
        const win = (Math.abs(omega) * spec.minWindowMs) / 1000;
        const good = goodIntervals(a, n, omega, flight);
        let best = null;
        for (const gI of good) if (!best || gI.len > best.len) best = gI;
        if (!best || best.len < win) break;
        // A placed pin's shadow falls on the side the structure carries it
        // towards, so pack against that edge of the window.
        let beta0 = best.start + best.len / 2;
        if (best.len >= 2 * win) beta0 = omega > 0 ? best.start + win / 2 : best.start + best.len - win / 2;
        a[n++] = wrap2Pi(beta0 - omega * flight);
        placed++;
      }
      return placed;
    }

    function staticOk(angles, count, minSep) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          if (Math.abs(wrapPi(angles[i] - angles[j])) < minSep) return false;
          if (pinGap(wrapPi(angles[j] - angles[i]), 0, G.CLEARANCE) < G.CLEARANCE) return false;
        }
      }
      return true;
    }

    // A new spindle: random initial pins (never overlapping, spaced by the
    // spindle's minSep) whose remaining room is proven by construction to
    // take the whole quota. If an arrangement cannot, it is rejected; the
    // quota only shrinks as a last resort, so a spindle is never impossible.
    function generateSpindle(k, rng, tune, out) {
      const spec = spindleSpec(k, tune);
      const angles = out || new Float64Array(G.MAX_PINS);
      const bestAngles = new Float64Array(G.MAX_PINS);
      let bestCap = -1, bestN = 0;
      for (let attempt = 0; attempt < 40; attempt++) {
        let n = 0;
        let tries = 0;
        while (n < spec.initial && tries < 400) {
          tries++;
          const a = rng() * TAU;
          let ok = true;
          for (let j = 0; j < n; j++) {
            if (Math.abs(wrapPi(a - angles[j])) < spec.minSep) { ok = false; break; }
          }
          if (ok) angles[n++] = a;
        }
        if (n < spec.initial || !staticOk(angles, n, spec.minSep)) continue;
        const cap = greedyCapacity(angles, n, spec, tune, spec.quota + 1);
        if (cap >= spec.quota + 1) return { spec, angles, count: n };
        if (cap > bestCap) { bestCap = cap; bestN = n; bestAngles.set(angles.subarray(0, n)); }
      }
      // Evenly spaced arrangement as a candidate too.
      const n = spec.initial;
      const off = rng() * TAU;
      for (let i = 0; i < n; i++) angles[i] = wrap2Pi(off + (i * TAU) / n);
      const capEven = greedyCapacity(angles, n, spec, tune, spec.quota + 1);
      if (capEven < bestCap) { angles.set(bestAngles.subarray(0, bestN)); }
      const count = capEven < bestCap ? bestN : n;
      spec.quota = Math.max(1, Math.min(spec.quota, Math.max(capEven, bestCap) - 1));
      return { spec, angles, count };
    }

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---- Game state ----------------------------------------------------------
    const TRANSITION_SEC = 0.62;

    function createGame(opts) {
      const tune = Object.assign({}, DEFAULT_TUNE, (opts && opts.tune) || {});
      const hooks = (opts && opts.hooks) || {};
      let rng = (opts && opts.rng) || Math.random;
      const flight = () => tune.flightMs / 1000;
      const result = {};

      const st = {
        phase: "ready",      // ready | flying | transition | over
        simT: 0,
        thetaBase: 0, tBase: 0, omega: 0,
        angles: new Float64Array(G.MAX_PINS),
        count: 0,
        spec: null,
        placed: 0,
        score: 0,
        run: 0,
        launches: 0,
        flight: { tL: 0, tEnd: 0, hit: false },
        lastAttach: { t: -10, angle: 0 },
        fail: null,
        trans: null,
        oldAngles: new Float64Array(G.MAX_PINS)
      };

      function theta(t) { return st.thetaBase + st.omega * (t - st.tBase); }
      function setOmega(t, w) { st.thetaBase = theta(t); st.tBase = t; st.omega = w; }

      let warmQueue = [];
      function startSpindle(k, t) {
        const gen = generateSpindle(k, rng, tune, st.angles);
        st.spec = gen.spec;
        st.count = gen.count;
        st.placed = 0;
        st.thetaBase = rng() * TAU;
        st.tBase = t;
        st.omega = omegaFor(st.spec, 0, tune);
        // Analyse the next spindle's speeds ahead of time, a bit per idle frame,
        // so the hand-over never stalls.
        warmQueue = gridNeeds(spindleSpec(k + 1, tune), tune);
      }
      // Do one small unit of background analysis. Returns true if work was done.
      function idleWork() {
        if (!warmQueue.length || st.phase === "transition") return false;
        gridInterval(warmQueue.shift(), flight());
        return true;
      }

      function reset(seedRng) {
        if (seedRng) rng = seedRng;
        st.run++;
        st.score = 0;
        st.launches = 0;
        st.fail = null;
        st.trans = null;
        st.phase = "ready";
        st.lastAttach.t = -10;
        startSpindle(0, st.simT);
      }

      // offsetSec: real time elapsed since the last simulated frame, so the
      // launch happens at the moment the player actually tapped.
      function launch(offsetSec) {
        if (st.phase !== "ready") return false;
        const tL = st.simT + Math.max(0, Math.min(offsetSec || 0, 0.05));
        const f = flight();
        simulateLaunch(st.angles, st.count, theta(tL), st.omega, f, result);
        st.flight.tL = tL;
        st.flight.hit = result.hit;
        st.flight.tEnd = tL + result.tau;
        st.flight.s = result.s;
        st.flight.beta = result.beta;
        st.flight.pin = result.pin;
        st.flight.cx = result.cx;
        st.flight.cy = result.cy;
        st.phase = "flying";
        st.launches++;
        if (hooks.onLaunch) hooks.onLaunch();
        return true;
      }

      function resolveFlight() {
        const t = st.flight.tEnd;
        if (st.flight.hit) {
          st.phase = "over";
          st.fail = {
            t,
            pin: st.flight.pin,
            s: st.flight.s,
            beta: st.flight.beta,
            cx: st.flight.cx,
            cy: st.flight.cy,
            theta: theta(t)
          };
          setOmega(t, 0);
          if (hooks.onFail) hooks.onFail(st.score);
          return;
        }
        // Attach exactly where the trajectory put it.
        st.angles[st.count++] = st.flight.beta;
        st.placed++;
        st.score++;
        st.lastAttach.t = t;
        st.lastAttach.angle = st.flight.beta;
        setOmega(t, omegaFor(st.spec, st.placed, tune));
        st.phase = "ready";
        if (hooks.onAttach) hooks.onAttach(st.score, st.placed, st.spec.quota);
        if (st.placed >= st.spec.quota || st.count >= G.MAX_PINS - 1) {
          st.trans = {
            t0: t,
            count: st.count,
            theta0: theta(t),
            omega: st.omega,
            index: st.spec.index
          };
          st.oldAngles.set(st.angles.subarray(0, st.count));
          startSpindle(st.spec.index + 1, t);
          st.phase = "transition";
          if (hooks.onSpindle) hooks.onSpindle(st.trans.index + 1);
        }
      }

      function advance(dt) {
        const target = st.simT + dt;
        for (let guard = 0; guard < 8; guard++) {
          if (st.phase === "flying" && st.flight.tEnd <= target) {
            st.simT = Math.max(st.simT, st.flight.tEnd);
            resolveFlight();
          } else if (st.phase === "transition" && st.trans.t0 + TRANSITION_SEC <= target) {
            st.simT = Math.max(st.simT, st.trans.t0 + TRANSITION_SEC);
            st.phase = "ready";
          } else break;
        }
        st.simT = target;
      }

      // Incoming pin offset at time t during a flight.
      function flightOffset(t) {
        const f = flight();
        const tau = Math.max(0, Math.min(t, st.flight.tEnd) - st.flight.tL);
        return Math.max(0, G.S0 - (G.S0 / f) * tau);
      }

      return { st, tune, theta, launch, advance, reset, flightOffset, idleWork };
    }

    return {
      G, PIN_POLY, BROAD_ANGLE, TRANSITION_SEC, DEFAULT_TUNE, ANALYSIS_MARGIN,
      wrapPi, wrap2Pi, pinGap, simulateLaunch, badInterval, gridInterval, goodIntervals,
      spindleSpec, omegaFor, greedyCapacity, generateSpindle, staticOk,
      mulberry32, createGame
    };
  })();

  // -------------------------------------------------------------------
  // 2. PLETHORA RUNTIME
  // -------------------------------------------------------------------
  const C = Object.freeze({
    bg: "#08090C",
    target: "#191C23",
    shaft: "#AEB7C7",
    hi: "#F3F5FA",
    blue: "#72A7FF",
    blue2: "#C6D9FF",
    red: "#FF5964",
    muted: "#6C7483",
    dim: "#3A404C"
  });
  const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  window.plethoraBit = {
    meta: {
      title: "Spindle",
      runtime: "plethora-bit@2",
      tags: ["arcade", "timing", "endless", "minimal"],
      permissions: ["haptics", "storage", "audio"]
    },

    core: Core,

    async init(ctx) {
      const G = Core.G;
      let disposed = false;

      // ---- Tuning --------------------------------------------------------
      const tn = (id, fallback) => {
        try {
          const t = ctx.tune;
          const v = t ? (t.get ? t.get(id) : t.number ? t.number(id) : undefined) : undefined;
          return typeof v === "number" && isFinite(v) ? v : fallback;
        } catch (e) { return fallback; }
      };
      const tune = {
        startSpeed: tn("start_speed", Core.DEFAULT_TUNE.startSpeed),
        maxSpeed: tn("max_speed", Core.DEFAULT_TUNE.maxSpeed),
        flightMs: tn("flight_ms", Core.DEFAULT_TUNE.flightMs),
        quota: Math.round(tn("first_spindle_pins", Core.DEFAULT_TUNE.quota)),
        spindleGrowth: Core.DEFAULT_TUNE.spindleGrowth
      };
      tune.maxSpeed = Math.max(tune.maxSpeed, tune.startSpeed);

      // ---- Personal best (viewer-local storage, safe fallback) -----------
      const memoryStore = {};
      const store = {
        get(key) {
          try {
            if (ctx.storage) {
              const v = ctx.storage.get(key);
              if (v !== null && v !== undefined) return v;
            }
          } catch (e) { /* storage unavailable */ }
          return key in memoryStore ? memoryStore[key] : null;
        },
        set(key, value) {
          memoryStore[key] = value;
          try { if (ctx.storage) ctx.storage.set(key, value); } catch (e) { /* ignore */ }
        }
      };
      let best = Math.max(0, Math.floor(Number(store.get("best")) || 0));
      let muted = store.get("muted") === true;

      // ---- Audio: small original synthesized cues ------------------------
      const audio = (function () {
        let ac = null, master = null, noise = null;
        const allowed = !ctx.capabilities || ctx.capabilities.audio !== false;
        function ensure() {
          if (!allowed || disposed) return null;
          if (!ac) {
            try {
              const AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return null;
              ac = new AC();
              master = ac.createGain();
              master.gain.value = muted ? 0 : 0.55;
              master.connect(ac.destination);
              const len = Math.floor(ac.sampleRate * 0.25);
              noise = ac.createBuffer(1, len, ac.sampleRate);
              const d = noise.getChannelData(0);
              let seed = 7;
              for (let i = 0; i < len; i++) {
                seed = (seed * 16807) % 2147483647;
                d[i] = (seed / 2147483647) * 2 - 1;
              }
            } catch (e) { ac = null; return null; }
          }
          if (ac.state === "suspended") ac.resume().catch(() => {});
          return ac;
        }
        function tone(freq, start, dur, gain, type, endFreq) {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.type = type || "sine";
          o.frequency.setValueAtTime(freq, start);
          if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(gain, start + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          o.connect(g); g.connect(master);
          o.start(start); o.stop(start + dur + 0.02);
        }
        function hiss(start, dur, gain, freq, q) {
          const src = ac.createBufferSource();
          src.buffer = noise;
          const f = ac.createBiquadFilter();
          f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(gain, start + 0.003);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          src.connect(f); f.connect(g); g.connect(master);
          src.start(start); src.stop(start + dur + 0.02);
        }
        return {
          unlock() { ensure(); },
          setMuted(m) {
            if (ac && master) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.02);
          },
          launch() {
            if (muted || !ensure()) return;
            const t = ac.currentTime;
            hiss(t, 0.07, 0.10, 3800, 0.9);
            tone(1900, t, 0.05, 0.035, "sine", 1100);
          },
          attach(progress) {
            if (muted || !ensure()) return;
            const t = ac.currentTime;
            const p = 1 + 0.06 * Math.min(progress, 12);
            hiss(t, 0.018, 0.22, 6000, 2.5);
            tone(1720 * p, t, 0.16, 0.09, "sine");
            tone(2870 * p, t, 0.10, 0.05, "sine");
            tone(4410 * p, t, 0.06, 0.025, "triangle");
          },
          fail() {
            if (muted || !ensure()) return;
            const t = ac.currentTime;
            hiss(t, 0.16, 0.28, 900, 0.7);
            tone(196, t, 0.26, 0.20, "triangle", 92);
            tone(1430, t, 0.22, 0.06, "sine", 1310);
            tone(1517, t, 0.22, 0.05, "sine", 1390);
          },
          complete() {
            if (muted || !ensure()) return;
            const t = ac.currentTime;
            tone(1318.5, t, 0.32, 0.06, "sine");
            tone(1975.5, t + 0.07, 0.42, 0.05, "sine");
          },
          dispose() {
            if (ac) { try { ac.close(); } catch (e) { /* ignore */ } ac = null; }
          }
        };
      })();

      const haptic = kind => {
        try { if (ctx.capabilities && ctx.capabilities.haptics === false) return; ctx.platform.haptic(kind); } catch (e) { /* ignore */ }
      };

      // ---- Score (host track) + leaderboard submit ------------------------
      let scoreTrack = null;
      try { scoreTrack = ctx.game.score({ initial: 0, min: 0 }); } catch (e) { scoreTrack = null; }

      // ---- Gameplay model -----------------------------------------------------
      let attemptStarted = false;
      let newBest = false;
      let overAtWall = 0;
      let firstLaunchDone = false;
      const fx = { scorePop: -10, failWall: 0, completeT: -10 };

      const game = Core.createGame({
        tune,
        hooks: {
          onLaunch() {
            audio.launch();
            firstLaunchDone = true;
          },
          onAttach(score, placed, quota) {
            if (scoreTrack) { try { scoreTrack.add(1); } catch (e) { /* ignore */ } }
            if (score > best) {
              best = score;
              newBest = true;
            }
            fx.scorePop = game.st.simT;
            audio.attach(placed);
            haptic("light");
          },
          onSpindle(index) {
            fx.completeT = game.st.simT;
            audio.complete();
            haptic("success");
            try { ctx.platform.milestone("spindle_complete", { spindle: index }); } catch (e) { /* ignore */ }
          },
          onFail(score) {
            audio.fail();
            haptic("error");
            overAtWall = now();
            if (newBest) store.set("best", best);
            try { ctx.platform.fail({ score }); } catch (e) { /* ignore */ }
            if (scoreTrack && score > 0) {
              try {
                const p = scoreTrack.submit("score", { label: score + (score === 1 ? " pin" : " pins") });
                if (p && p.catch) p.catch(() => {});
              } catch (e) { /* ignore */ }
            }
            hud.showOver(score);
          }
        }
      });
      game.reset(Core.mulberry32((Math.random() * 4294967296) >>> 0));
      const st = game.st;

      function now() { return (typeof performance !== "undefined" ? performance : Date).now(); }

      // ---- Canvas setup and resizing -------------------------------------------
      const canvas = ctx.createCanvas2D({
        layer: "content",
        alpha: false,
        maxDpr: 3,
        coordinateSpace: "css",
        touchAction: "none"
      });
      const g = canvas.getContext("2d");

      const view = { w: 1, h: 1, cx: 0, cy: 0, sc: 1, top: 0, bottom: 0, scoreY: 0, bestY: 0 };
      // Vertical budget in world units: HUD above the structure, the
      // structure itself, the launcher and its remaining-pin dots below.
      const HUD_U = 96, ABOVE_U = G.R + G.L + 10, BELOW_U = G.R + G.S0 + G.L + 26;

      function layout(info) {
        const w = Math.max(1, (info && info.width) || ctx.width || 1);
        const h = Math.max(1, (info && info.height) || ctx.height || 1);
        const sa = (info && info.safeArea) || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
        const top = (sa.top || 0) + 8;
        const bottom = h - (sa.bottom || 0) - 12;
        const availH = Math.max(100, bottom - top);
        const totalU = HUD_U + ABOVE_U + BELOW_U;
        const sc = Math.min((w - 32) / (2 * (G.R + G.L) + 20), availH / totalU, 2.4);
        view.w = w;
        view.h = h;
        view.sc = Math.max(0.3, sc);
        const used = totalU * view.sc;
        const y0 = top + Math.max(0, (availH - used) * 0.42);
        view.cx = w / 2;
        view.cy = y0 + (HUD_U + ABOVE_U) * view.sc;
        view.top = y0;
        view.scoreY = y0 + 50 * view.sc;
        view.bestY = y0 + 76 * view.sc;
        view.ambient = null;
        hud.layout();
      }

      // ---- Rendering: cached paints (world units) ----------------------------
      const pinPath = (function () {
        const p = new Path2D();
        const P = Core.PIN_POLY;
        p.moveTo(P[0], P[1]);
        for (let i = 2; i < P.length; i += 2) p.lineTo(P[i], P[i + 1]);
        p.closePath();
        return p;
      })();
      const H = G.W / 2;
      const COLLAR_X = G.R + G.L - 12;
      const COLLAR_W = 2.6;

      // Cylinder shading across the shaft. The light comes from the upper
      // left, so the highlight slides across the shaft depending on how the
      // pin is oriented: 9 cached gradients, picked per pin.
      const LIGHT = { x: -0.6, y: -0.8 };
      const shaftGrads = [];
      for (let i = 0; i < 9; i++) {
        const l = i / 4 - 1; // -1..1: light along local +y
        const gr = g.createLinearGradient(0, -H, 0, H);
        const hp = 0.5 + l * 0.26;
        const k = 0.75 + 0.25 * Math.abs(l);
        gr.addColorStop(0, "#3B414C");
        gr.addColorStop(Math.max(0.02, hp - 0.34), "#7D8697");
        gr.addColorStop(Math.max(0.04, hp - 0.12), C.shaft);
        gr.addColorStop(hp, k > 0.9 ? C.hi : "#DDE2EC");
        gr.addColorStop(Math.min(0.96, hp + 0.14), "#9AA3B4");
        gr.addColorStop(Math.min(0.98, hp + 0.36), "#5F6776");
        gr.addColorStop(1, "#2C3139");
        shaftGrads.push(gr);
      }
      function shaftGrad(worldAngle) {
        const l = LIGHT.x * -Math.sin(worldAngle) + LIGHT.y * Math.cos(worldAngle);
        return shaftGrads[Math.max(0, Math.min(8, Math.round((l + 1) * 4)))];
      }
      const capPath = (function () {
        const p = new Path2D();
        const x1 = G.R + G.L, c = G.CHAMFER;
        p.moveTo(x1 - 2.2, -H); p.lineTo(x1 - c, -H); p.lineTo(x1, -H + c);
        p.lineTo(x1, H - c); p.lineTo(x1 - c, H); p.lineTo(x1 - 2.2, H);
        p.closePath();
        return p;
      })();

      const targetBody = g.createRadialGradient(-G.R * 0.38, -G.R * 0.44, G.R * 0.05, 0, 0, G.R);
      targetBody.addColorStop(0, "#2C313C");
      targetBody.addColorStop(0.55, C.target);
      targetBody.addColorStop(1, "#0E1015");
      const rimGrad = g.createLinearGradient(-G.R, -G.R, G.R, G.R);
      rimGrad.addColorStop(0, C.hi);
      rimGrad.addColorStop(0.45, "#8D95A4");
      rimGrad.addColorStop(1, "#262A33");
      const hubGrad = g.createRadialGradient(-1.5, -2, 0.5, 0, 0, G.R * 0.24);
      hubGrad.addColorStop(0, "#252A33");
      hubGrad.addColorStop(1, "#0A0B0E");

      // Draw one pin in the current (structure) frame.
      function drawPin(angle, worldAngle, offset, collar, tint) {
        g.save();
        g.rotate(angle);
        if (offset) g.translate(offset, 0);
        g.fillStyle = shaftGrad(worldAngle);
        g.fill(pinPath);
        g.fillStyle = collar;
        g.fillRect(COLLAR_X, -H, COLLAR_W, G.W);
        g.fillStyle = "rgba(243,245,250,0.55)";
        g.fill(capPath);
        if (tint) {
          g.fillStyle = tint;
          g.fill(pinPath);
        }
        g.restore();
      }

      function drawTarget(theta, alpha) {
        const R = G.R;
        g.fillStyle = targetBody;
        g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        // Machined face ring + restrained blue detail ring.
        g.lineWidth = 0.6;
        g.strokeStyle = "rgba(174,183,199,0.10)";
        g.beginPath(); g.arc(0, 0, R * 0.66, 0, TAU); g.stroke();
        g.strokeStyle = "rgba(114,167,255,0.30)";
        g.lineWidth = 0.7;
        g.beginPath(); g.arc(0, 0, R * 0.80, 0, TAU); g.stroke();
        // Rotating index marks: they make the spin readable on the face.
        g.save();
        g.rotate(theta);
        g.fillStyle = C.blue;
        g.beginPath(); g.arc(R * 0.80, 0, 1.25, 0, TAU); g.fill();
        g.fillStyle = "rgba(174,183,199,0.28)";
        for (let i = 1; i < 3; i++) {
          const a = (i * TAU) / 3;
          g.beginPath(); g.arc(Math.cos(a) * R * 0.80, Math.sin(a) * R * 0.80, 0.8, 0, TAU); g.fill();
        }
        g.restore();
        // Hub / axle.
        g.fillStyle = hubGrad;
        g.beginPath(); g.arc(0, 0, R * 0.24, 0, TAU); g.fill();
        g.strokeStyle = "rgba(174,183,199,0.45)";
        g.lineWidth = 0.5;
        g.stroke();
        g.fillStyle = "rgba(243,245,250,0.55)";
        g.beginPath(); g.arc(-R * 0.07, -R * 0.08, 0.9, 0, TAU); g.fill();
        // Silver rim with a fixed top-left specular.
        g.strokeStyle = rimGrad;
        g.lineWidth = 1.3;
        g.beginPath(); g.arc(0, 0, R - 0.65, 0, TAU); g.stroke();
        g.strokeStyle = "rgba(243,245,250,0.65)";
        g.lineWidth = 0.8;
        g.beginPath(); g.arc(0, 0, R - 0.65, Math.PI * 1.08, Math.PI * 1.36); g.stroke();
      }

      function drawStructure(angles, count, theta, opts) {
        g.save();
        if (opts && opts.scale && opts.scale !== 1) g.scale(opts.scale, opts.scale);
        g.save();
        g.rotate(theta);
        const failPin = st.fail && opts && opts.live ? st.fail.pin : -1;
        for (let i = 0; i < count; i++) {
          let collar = C.blue;
          if (i === failPin) collar = C.red;
          else if (opts && opts.live && i === count - 1 && opts.flashAge < 0.35 && opts.flashAge >= 0) {
            collar = opts.flashAge < 0.12 ? C.hi : C.blue2;
          }
          drawPin(angles[i], angles[i] + theta, 0, collar, null);
        }
        g.restore();
        drawTarget(theta);
        g.restore();
      }

      // ---- Frame ----------------------------------------------------------------
      function render() {
        const t = st.simT;
        const sc = view.sc;
        g.fillStyle = C.bg;
        g.fillRect(0, 0, view.w, view.h);

        // Subtle ambient pool so the object reads as floating in space.
        if (!view.ambient) {
          const r = (G.R + G.L) * sc * 1.55;
          const amb = g.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, r);
          amb.addColorStop(0, "rgba(30,35,46,0.55)");
          amb.addColorStop(0.55, "rgba(18,20,27,0.35)");
          amb.addColorStop(1, "rgba(8,9,12,0)");
          view.ambient = amb;
        }
        g.fillStyle = view.ambient;
        g.fillRect(0, 0, view.w, view.h);

        // Camera nudge: a tiny push on attach, a short jolt on failure.
        // Applied to the whole play scene (structure and incoming pin alike)
        // so what you see is always the geometry being simulated.
        let nx = 0, ny = 0;
        const sinceAttach = t - st.lastAttach.t;
        if (sinceAttach >= 0 && sinceAttach < 0.12) {
          const k = 1 - sinceAttach / 0.12;
          ny -= 1.2 * k * k;
        }
        if (st.phase === "over" && st.fail) {
          const a = t - st.fail.t;
          if (a < 0.28) {
            const k = 1 - a / 0.28;
            ny -= 3.2 * k * k * Math.cos(a * 70);
            nx += 1.4 * k * k * Math.sin(a * 90);
          }
        }

        g.save();
        g.translate(view.cx + nx * sc, view.cy + ny * sc);
        g.scale(sc, sc);

        const theta = game.theta(t);

        // Launch axis hairline: shows exactly where the pin will strike.
        if (st.phase === "ready" || st.phase === "transition") {
          const y0 = G.R + 2, y1 = G.R + G.S0 - 4;
          const lg = g.createLinearGradient(0, y0, 0, y1);
          lg.addColorStop(0, "rgba(198,217,255,0.16)");
          lg.addColorStop(1, "rgba(198,217,255,0)");
          g.strokeStyle = lg;
          g.lineWidth = 0.5;
          g.beginPath(); g.moveTo(0, y0); g.lineTo(0, y1); g.stroke();
        }

        // Structure (with spindle hand-over when a spindle completes).
        if (st.trans && t - st.trans.t0 < Core.TRANSITION_SEC) {
          const p = Math.max(0, (t - st.trans.t0) / Core.TRANSITION_SEC);
          const out = Math.min(1, p / 0.62);
          const e = out * out;
          const tt = t - st.trans.t0;
          const oldTheta = st.trans.theta0 + st.trans.omega * tt + Math.sign(st.trans.omega || 1) * 5.5 * tt * tt;
          g.globalAlpha = 1 - e;
          drawStructure(st.oldAngles, st.trans.count, oldTheta, { scale: 1 + 0.16 * e });
          const inp = Math.max(0, (p - 0.35) / 0.65);
          const ein = 1 - Math.pow(1 - inp, 3);
          g.globalAlpha = ein;
          drawStructure(st.angles, st.count, theta, { scale: 0.86 + 0.14 * ein });
          g.globalAlpha = 1;
          // Completion ring.
          const ra = tt / 0.5;
          if (ra < 1) {
            g.strokeStyle = "rgba(114,167,255," + (0.45 * (1 - ra)).toFixed(3) + ")";
            g.lineWidth = 1.2 * (1 - ra) + 0.3;
            g.beginPath(); g.arc(0, 0, G.R + (G.L + 14) * (1 - Math.pow(1 - ra, 2)), 0, TAU); g.stroke();
          }
        } else {
          drawStructure(st.angles, st.count, theta, { live: true, flashAge: t - st.lastAttach.t });
        }

        // Attach flash at the contact point on the rim.
        if (sinceAttach >= 0 && sinceAttach < 0.2 && !(st.trans && t - st.trans.t0 < 0.05)) {
          const a = st.lastAttach.angle + theta;
          const px = Math.cos(a) * G.R, py = Math.sin(a) * G.R;
          const k = 1 - sinceAttach / 0.2;
          const rg = g.createRadialGradient(px, py, 0, px, py, 7 + 5 * (1 - k));
          rg.addColorStop(0, "rgba(198,217,255," + (0.95 * k).toFixed(3) + ")");
          rg.addColorStop(0.35, "rgba(114,167,255," + (0.55 * k).toFixed(3) + ")");
          rg.addColorStop(1, "rgba(114,167,255,0)");
          g.fillStyle = rg;
          g.beginPath(); g.arc(px, py, 12, 0, TAU); g.fill();
        }

        // Incoming / waiting pin (world frame, launch axis = angle PI/2).
        if (st.phase === "flying") {
          drawPin(HALF_PI, HALF_PI, game.flightOffset(t), C.blue, null);
        } else if (st.phase === "over" && st.fail) {
          drawPin(HALF_PI, HALF_PI, st.fail.s, C.red, "rgba(255,89,100,0.22)");
        } else {
          // Reload slide: purely cosmetic, the launch always starts from S0.
          const age = t - Math.max(st.lastAttach.t, st.flight.tEnd || -10);
          const k = Math.max(0, 1 - age / 0.09);
          const blocked = st.phase === "transition";
          drawPin(HALF_PI, HALF_PI, G.S0 + 22 * k * k, blocked ? "#4A5A78" : C.blue, null);
        }

        // Failure flash at the exact contact point.
        if (st.phase === "over" && st.fail) {
          const a = t - st.fail.t;
          const ct = Math.cos(st.fail.theta), snt = Math.sin(st.fail.theta);
          const px = st.fail.cx * ct - st.fail.cy * snt;
          const py = st.fail.cx * snt + st.fail.cy * ct;
          const k = Math.max(0, 1 - a / 0.42);
          if (k > 0) {
            const rg = g.createRadialGradient(px, py, 0, px, py, 10 + 8 * (1 - k));
            rg.addColorStop(0, "rgba(255,200,205," + (0.9 * k).toFixed(3) + ")");
            rg.addColorStop(0.3, "rgba(255,89,100," + (0.7 * k).toFixed(3) + ")");
            rg.addColorStop(1, "rgba(255,89,100,0)");
            g.fillStyle = rg;
            g.beginPath(); g.arc(px, py, 20, 0, TAU); g.fill();
          }
          g.strokeStyle = "rgba(255,89,100,0.85)";
          g.lineWidth = 0.6;
          g.beginPath(); g.arc(px, py, 3.2, 0, TAU); g.stroke();
        }

        // Remaining pins on this spindle, below the launcher.
        if (st.phase !== "over" && st.spec) {
          const remaining = st.phase === "transition" ? st.spec.quota : st.spec.quota - st.placed;
          const y = G.R + G.S0 + G.L + 14;
          const gap = 7;
          const x0 = -((remaining - 1) * gap) / 2;
          for (let i = 0; i < remaining; i++) {
            g.fillStyle = i === 0 ? C.blue : "rgba(174,183,199,0.42)";
            g.beginPath(); g.arc(x0 + i * gap, y, i === 0 ? 1.5 : 1.2, 0, TAU); g.fill();
          }
        }
        g.restore();

        // Brief red wash on failure (restrained).
        if (st.phase === "over" && st.fail) {
          const a = t - st.fail.t;
          if (a < 0.18) {
            g.fillStyle = "rgba(255,89,100," + (0.07 * (1 - a / 0.18)).toFixed(3) + ")";
            g.fillRect(0, 0, view.w, view.h);
          }
        }

        drawHud(t);
      }

      function drawHud(t) {
        const sc = view.sc;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        const pop = t - fx.scorePop;
        const bump = pop >= 0 && pop < 0.16 ? 1 + 0.07 * (1 - pop / 0.16) : 1;
        const size = Math.max(30, 44 * sc) * bump;
        g.font = "200 " + size.toFixed(1) + "px " + FONT;
        g.fillStyle = st.phase === "over" ? C.hi : C.hi;
        g.fillText(String(st.score), view.cx, view.scoreY + 6 * sc);

        const small = Math.max(10, 10.5 * sc);
        g.font = "600 " + small.toFixed(1) + "px " + FONT;
        if ("letterSpacing" in g) g.letterSpacing = (small * 0.22).toFixed(1) + "px";
        let label, color;
        if (!firstLaunchDone && st.score === 0 && st.phase === "ready") {
          const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3.2));
          label = "TAP TO LAUNCH";
          color = "rgba(198,217,255," + pulse.toFixed(3) + ")";
        } else if (newBest && st.score > 0 && st.score >= best) {
          label = "NEW BEST";
          color = C.blue;
        } else {
          label = "BEST " + best;
          color = C.muted;
        }
        g.fillStyle = color;
        g.fillText(label, view.cx, view.bestY + 6 * sc);

        // Wordmark.
        g.textAlign = "left";
        g.font = "600 10px " + FONT;
        if ("letterSpacing" in g) g.letterSpacing = "4px";
        g.fillStyle = C.dim;
        const sa = ctx.safeArea || { top: 0, left: 0 };
        g.fillText("SPINDLE", (sa.left || 0) + 18, (sa.top || 0) + 34);
        if ("letterSpacing" in g) g.letterSpacing = "0px";
      }

      // ---- HUD (DOM): mute toggle and the game-over panel ------------------------
      const hud = (function () {
        const root = ctx.createRoot({
          layer: "overlay",
          input: "passthrough",
          className: "spindle-hud",
          style: "font-family:" + FONT.replace(/"/g, "'") + ";color:" + C.hi + ";"
        });
        const css =
          ".spindle-hud button{pointer-events:auto;-webkit-tap-highlight-color:transparent;font:inherit;cursor:pointer}" +
          ".sp-mute{position:absolute;width:40px;height:40px;border-radius:20px;border:1px solid rgba(174,183,199,0.16);background:rgba(8,9,12,0.6);color:#AEB7C7;display:flex;align-items:center;justify-content:center;padding:0}" +
          ".sp-mute:focus-visible,.sp-retry:focus-visible{outline:1px solid #72A7FF;outline-offset:3px}" +
          ".sp-panel{position:absolute;transform:translate(-50%,8px);display:flex;flex-direction:column;align-items:center;gap:14px;opacity:0;transition:opacity .22s ease,transform .22s ease;pointer-events:none}" +
          ".sp-panel.on{opacity:1;transform:translate(-50%,0)}" +
          ".sp-row{display:flex;gap:22px;align-items:baseline;letter-spacing:.2em;font-size:11px;font-weight:600;color:#6C7483;white-space:nowrap}" +
          ".sp-row b{font-weight:300;font-size:22px;letter-spacing:.02em;color:#F3F5FA;margin-left:8px}" +
          ".sp-row .nb b{color:#72A7FF}" +
          ".sp-retry{min-width:150px;height:46px;border-radius:23px;border:1px solid rgba(198,217,255,0.55);background:rgba(114,167,255,0.08);color:#F3F5FA;letter-spacing:.32em;font-size:12px;font-weight:600;padding:0 22px 0 26px}" +
          ".sp-retry:active{background:rgba(114,167,255,0.22)}";
        const style = document.createElement("style");
        style.textContent = css;
        root.appendChild(style);

        const mute = document.createElement("button");
        mute.className = "sp-mute";
        mute.setAttribute("aria-label", "Mute sound");
        root.appendChild(mute);

        const panel = document.createElement("div");
        panel.className = "sp-panel";
        panel.innerHTML =
          '<div class="sp-row"><span>PINS<b class="sp-final">0</b></span><span class="sp-bestwrap">BEST<b class="sp-best">0</b></span></div>' +
          '<button class="sp-retry" aria-label="Retry">RETRY</button>';
        root.appendChild(panel);
        const retry = panel.querySelector(".sp-retry");
        const finalEl = panel.querySelector(".sp-final");
        const bestEl = panel.querySelector(".sp-best");
        const bestWrap = panel.querySelector(".sp-bestwrap");
        retry.style.pointerEvents = "none";

        // Keep the panel clear of the play scene: below the stopped pin on
        // tall screens, beside the structure on wide ones.
        function place() {
          const sc = view.sc;
          const ph = 104, pw = 230;
          const sa = ctx.safeArea || { bottom: 0 };
          const reachR = (G.R + G.L + 12) * sc;
          if (view.w - (view.cx + reachR) >= pw + 24 && view.h < view.w) {
            panel.style.left = Math.min(view.w - pw / 2 - 16, view.cx + reachR + pw / 2 + 12) + "px";
            panel.style.top = (view.cy - ph / 2) + "px";
            return;
          }
          const s = st.fail ? st.fail.s : G.S0;
          const below = view.cy + (G.R + s + G.L + 18) * sc;
          const maxTop = view.h - (sa.bottom || 0) - ph - 10;
          panel.style.left = view.cx + "px";
          panel.style.top = Math.max(view.cy + (G.R + 24) * sc, Math.min(below, maxTop)) + "px";
        }

        const hasAudio = !ctx.capabilities || ctx.capabilities.audio !== false;
        if (!hasAudio) mute.style.display = "none";
        function paintMute() {
          mute.setAttribute("aria-pressed", muted ? "true" : "false");
          mute.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/>' +
            (muted
              ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'
              : '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11" opacity=".55"/>') +
            "</svg>";
        }
        paintMute();

        function activate(el, fn) {
          if (ctx.input && ctx.input.activate) ctx.input.activate(el, fn);
          else ctx.listen(el, "click", fn);
        }
        activate(mute, () => {
          muted = !muted;
          store.set("muted", muted);
          audio.setMuted(muted);
          if (!muted) audio.unlock();
          paintMute();
        });
        activate(retry, () => restart());

        return {
          layout() {
            const sa = ctx.safeArea || { top: 0, right: 0 };
            mute.style.top = ((sa.top || 0) + 10) + "px";
            mute.style.right = ((sa.right || 0) + 12) + "px";
            place();
          },
          showOver(score) {
            finalEl.textContent = String(score);
            bestEl.textContent = String(best);
            bestWrap.className = newBest ? "sp-bestwrap nb" : "sp-bestwrap";
            place();
            ctx.timeout(() => {
              if (disposed || st.phase !== "over") return;
              panel.classList.add("on");
              retry.style.pointerEvents = "auto";
            }, 320);
          },
          hideOver() {
            panel.classList.remove("on");
            retry.style.pointerEvents = "none";
          }
        };
      })();

      // ---- Input --------------------------------------------------------------------
      let lastFrameWall = now();

      function act() {
        if (disposed) return;
        if (st.phase === "over") {
          if (now() - overAtWall > 650) restart();
          return;
        }
        if (st.phase !== "ready") return; // one pin at a time; extra taps are dropped
        audio.unlock();
        if (!attemptStarted) {
          attemptStarted = true;
          try { ctx.platform.start(); } catch (e) { /* ignore */ }
        }
        const offset = (now() - lastFrameWall) / 1000;
        if (game.launch(offset)) {
          try { ctx.platform.interact({ type: "launch" }); } catch (e) { /* ignore */ }
        }
      }

      function restart() {
        if (disposed) return;
        hud.hideOver();
        newBest = false;
        attemptStarted = true;
        firstLaunchDone = true;
        try { ctx.platform.start(); } catch (e) { /* ignore */ }
        if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { /* ignore */ } }
        game.reset(Core.mulberry32((Math.random() * 4294967296) >>> 0));
      }

      ctx.listen(canvas, "pointerdown", e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        act();
      });
      ctx.listen(window, "keydown", e => {
        const space = e.code === "Space" || e.key === " " || e.key === "Spacebar";
        const enter = e.key === "Enter";
        if (!space && !enter) return;
        const tgt = e.target;
        if (tgt && tgt.tagName === "BUTTON" && enter) return; // let the button handle it
        if (e.cancelable) e.preventDefault();
        if (e.repeat) return;
        if (space || st.phase === "over") act();
      });

      // ---- Loop -----------------------------------------------------------------------
      ctx.onResize(layout, { immediate: true });
      if (!view.sc || view.w <= 1) layout();

      ctx.game.loop({
        maxDeltaMs: 50,
        update(dtMs, state) {
          game.advance(Math.max(0, dtMs) / 1000);
          if (state && state.frame % 4 === 2) game.idleWork();
          lastFrameWall = now();
        },
        render
      });

      ctx.onDestroy(() => {
        disposed = true;
        if (newBest) store.set("best", best);
        audio.dispose();
      });

      render();
      try { ctx.markVisualReady && ctx.markVisualReady("first-frame"); } catch (e) { /* ignore */ }
      ctx.platform.ready();
    }
  };
})();
