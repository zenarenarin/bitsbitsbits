window.plethoraBit = {
  meta: {
    title: "Pendulum Postman",
    runtime: "plethora-bit@2",
    tags: ["arcade", "physics", "swing", "delivery"],
    permissions: ["haptics", "audio", "backgroundMusic", "storage"],
    dependencies: ["three@0.164.1"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. CONSTANTS
    // World units: x grows to the right (the delivery route), y grows DOWN.
    // The fog sea sits at FOG_Y; anchors live roughly between y 200 and 640.
    // =====================================================================
    const G = 1700;                 // gravity, units/s^2
    const LMIN = 64, LMAX = 300;    // courier line length limits
    const REEL_RATE = 380;          // max reel speed, units/s
    const SWING_DAMP = 0.04;        // angular damping while swinging (1/s)
    const AIR_DRAG = 0.012;         // linear drag in flight (1/s)
    const FIXED_HZ = 120, SUBSTEPS = 2, DT = 1 / (FIXED_HZ * SUBSTEPS);
    const FOG_Y = 1000, DEATH_Y = FOG_Y + 80;
    const HOP_VY = -640, HOP_VX = 170, KICK = 420;
    const ANCHOR_MIN_Y = 220, ANCHOR_MAX_Y = 660;
    const LETTERS_PER_DISTRICT = 4;
    const TAU = Math.PI * 2;
    const FONT_UI = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
    const FONT_DISPLAY = "'Space Grotesk', Inter, 'Helvetica Neue', Arial, sans-serif";
    const GAME_TITLE = "Pendulum Postman";

    const DISTRICTS = [
      {
        name: "The Roof Colony", sky: ["#b9c2b6", "#93a69c"], fog: "#839790", sun: "#ffe1bd", sunI: 2.1, hemiSky: "#c6d1c7", hemiGround: "#3e4943",
        style: "colony", reach: [170, 182], dx: [220, 270], dy: [-55, 55], amp: 0.9, req: 6, reel: false, plat: 0.6, letterEvery: 2,
        sig: "fork", pool: { gap: 2, rise: 2, dip: 1, fork: 3 }, recv: { chute: 2, balcony: 1, flythrough: 2 }, zoneR: 34
      },
      {
        name: "The Wire Market", sky: ["#b8bba8", "#8d9b8f"], fog: "#7b8b81", sun: "#ffdcb0", sunI: 2.0, hemiSky: "#c4c9b8", hemiGround: "#3f4640",
        style: "market", reach: [164, 176], dx: [230, 285], dy: [-65, 70], amp: 0.95, req: 5, reel: true, plat: 0.5, letterEvery: 2,
        sig: "laundry", pool: { gap: 1, rise: 1, dip: 1, fork: 3, laundry: 2, reelroof: 2 }, recv: { chute: 1, balcony: 2, flythrough: 3, roofbox: 2 }, zoneR: 30
      },
      {
        name: "The Liftworks", sky: ["#aeb6b4", "#7f8f90"], fog: "#6f8183", sun: "#f3e1c8", sunI: 1.8, hemiSky: "#bcc6c6", hemiGround: "#363e40",
        style: "lift", reach: [158, 172], dx: [240, 295], dy: [-75, 80], amp: 1.0, req: 4, reel: true, plat: 0.4, letterEvery: 2,
        sig: "pulley", pool: { gap: 1, fork: 2, laundry: 1, pulley: 3, reelroof: 1, longline: 2 }, recv: { chute: 2, balcony: 2, flythrough: 3, roofbox: 2 }, zoneR: 28
      },
      {
        name: "The Clock Spine", sky: ["#c2b9a3", "#94988a"], fog: "#828676", sun: "#ffd6a0", sunI: 2.2, hemiSky: "#cdc5b0", hemiGround: "#433f36",
        style: "spine", reach: [152, 168], dx: [245, 300], dy: [-80, 90], amp: 1.05, req: 3, reel: true, plat: 0.3, letterEvery: 2,
        sig: "clock", pool: { fork: 2, pulley: 1, clock: 3, fragile: 2, longline: 1, reelroof: 1 }, recv: { chute: 1, balcony: 2, flythrough: 2, roofbox: 1, shutter: 2 }, zoneR: 26
      },
      {
        name: "The Upper Stacks", sky: ["#cfd3cb", "#a3b3b0"], fog: "#90a19f", sun: "#fff0dc", sunI: 2.4, hemiSky: "#d6ddd8", hemiGround: "#47504e",
        style: "stacks", reach: [148, 165], dx: [250, 310], dy: [-80, 100], amp: 1.1, req: 3, reel: true, plat: 0.22, letterEvery: 2,
        sig: "wind", pool: { fork: 2, wind: 3, pulley: 1, clock: 1, fragile: 1, laundry: 1, longline: 1, reelroof: 1 }, recv: { chute: 1, balcony: 2, flythrough: 3, roofbox: 2, shutter: 2 }, zoneR: 24
      }
    ];

    const NAMES = [
      "Mrs. Adeyemi", "Old Tomas", "Ilse & Ren", "Bao, tinsmith", "Widow Marchetti", "Dr. Okafor",
      "Kemal the glazier", "Sister Agnes", "Yuki Hara", "Priya Raman", "The Lindqvists", "Mateo, aged 9",
      "Grandmother Wen", "Farouk's Repairs", "Nadia Petrova", "Lantern Tea House", "Ropewalk Clinic",
      "Esi Mensah", "Hollis & Daughter", "Mr. Szabo", "Amara Diallo", "Pip the cable-boy", "The Night School",
      "Rosa Delgado", "Ivo the clockmaker", "Mina Cho", "The Seed Library", "Aunt Lucia", "Oskar Brandt",
      "Tariq Haddad", "Lena Vogel", "Kofi & Ama", "Mrs. Ferreira", "Wren, lamplighter"
    ];
    const SYMBOLS = ["lantern", "fish", "key", "moon", "bell", "leaf", "cup", "star", "bird", "umbrella"];

    // =====================================================================
    // 2. SMALL UTILITIES
    // =====================================================================
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
    const smooth = t => t * t * (3 - 2 * t);
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hash2(a, b) {
      let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
      h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
      return h >>> 0;
    }
    const rr = (rng, a, b) => a + (b - a) * rng();
    const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
    function weighted(rng, pool) {
      let tot = 0; for (const k in pool) tot += pool[k];
      let r = rng() * tot;
      for (const k in pool) { r -= pool[k]; if (r <= 0) return k; }
      return Object.keys(pool)[0];
    }
    function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mix(h1, h2, t) {
      const a = hexRgb(h1), b = hexRgb(h2);
      return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
    }
    function rgba(h, a) { const c = hexRgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
    function jitterColor(rng, h, amt) {
      const c = hexRgb(h), j = () => Math.round((rng() - 0.5) * amt);
      return "rgb(" + clamp(c[0] + j(), 0, 255) + "," + clamp(c[1] + j(), 0, 255) + "," + clamp(c[2] + j(), 0, 255) + ")";
    }
    function makeCanvas(w, h) {
      w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
      if (typeof OffscreenCanvas !== "undefined") {
        try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ }
      }
      // older WebViews: a hidden SDK-owned canvas used only as an image cache
      try {
        const c = ctx.createCanvas2D({ layer: "background", input: "passthrough" });
        c.style.display = "none"; c.width = w; c.height = h;
        return c;
      } catch (e) { return null; }
    }

    // =====================================================================
    // 3. PERSISTENCE (viewer-local convenience only)
    // =====================================================================
    const canStore = !!(ctx.storage && (!ctx.capabilities || ctx.capabilities.storage !== false));
    function loadRecords() {
      let r = null;
      if (canStore) { try { r = ctx.storage.get("pp_records_v2"); } catch (e) { r = null; } }
      return Object.assign({
        best: 0, bestDeliveries: 0, bestStreak: 0, runs: 0, last: null, catches: 0,
        seen: {}, seenDeliver: false, seenPump: false, muted: false
      }, r || {});
    }
    const records = loadRecords();
    function saveRecords() {
      if (!canStore) return;
      try { ctx.storage.set("pp_records_v2", records); } catch (e) { /* storage unavailable */ }
    }

    // =====================================================================
    // 4. PHYSICS — shared by the game and by the route validator.
    // Taut line: exact polar pendulum (theta from straight down, y-down),
    // with angular momentum preserved when the length changes (the Ldot term),
    // so reeling does real work. Slack line / free flight: cartesian ballistic.
    // =====================================================================
    function makePlayer() {
      return {
        x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, mode: "ground", anchor: null, L: 200, th: 0, om: 0, Ldot: 0,
        reelTarget: null, exclude: null, plat: null, leftPlat: null
      };
    }

    function landCheck(p, px, py, W) {
      if (p.vy <= 0) return false;
      const plats = W.platforms;
      for (let i = 0; i < plats.length; i++) {
        const pl = plats[i];
        if (p.x < pl.x0 || p.x > pl.x1 || pl === p.leftPlat) continue;
        if (py <= pl.y + 0.01 && p.y >= pl.y) {
          const impact = p.vy;
          p.y = pl.y; p.vy = 0; p.vx *= 0.5; p.mode = "ground"; p.plat = pl; p.om = 0; p.exclude = null;
          if (W.ev) W.ev("land", impact);
          return true;
        }
      }
      return false;
    }

    function attach(p, a, d, W) {
      p.anchor = a;
      p.L = clamp(d, LMIN, LMAX);
      p.reelTarget = null;
      a.locked = true; a.load = 1;
      const dx = p.x - a.x, dy = p.y - a.y;
      const th = Math.atan2(dx, dy), s = Math.sin(th), c = Math.cos(th);
      const rvx = p.vx - a.vx, rvy = p.vy - a.vy;
      const vt = rvx * c - rvy * s, vr = rvx * s + rvy * c;
      const lost = Math.max(0, vr);
      const retention = (vt * vt + 1) / (vt * vt + lost * lost + 1);
      if (p.mode !== "ground" && d >= p.L - 0.01) {
        p.mode = "swing"; p.th = th; p.om = vt / p.L;
        p.x = a.x + p.L * s; p.y = a.y + p.L * c;
        p.vx = vt * c + a.vx; p.vy = -vt * s + a.vy;
      } else if (p.mode !== "ground") {
        p.mode = "slack";
      }
      if (W.ev) W.ev("catch", { a, retention, speed: Math.hypot(rvx, rvy), jerk: lost });
    }

    function catchCheck(p, W) {
      const list = W.anchors;
      let best = null, bd = 1e9;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.catchable || a.broken || a === p.exclude) continue;
        if (a.y > p.y - 10) continue;
        const dx = p.x - a.x, dy = p.y - a.y;
        if (Math.abs(dx) > a.reach || dy > a.reach) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= a.reach && d < bd) { best = a; bd = d; }
      }
      if (best) attach(p, best, bd, W);
    }

    function stepPlayer(p, dt, W) {
      if (p.leftPlat) {
        const lp = p.leftPlat;
        if (p.y > lp.y + 24 || p.x < lp.x0 - 8 || p.x > lp.x1 + 8 || p.y < lp.y - 60) p.leftPlat = null;
      }
      if (p.exclude) {
        const e = p.exclude;
        if (Math.hypot(p.x - e.x, p.y - e.y) > e.reach + 12) p.exclude = null;
      }
      const wx = W.wind(p.x, p.y);
      const a = p.anchor;
      if (p.mode === "swing") {
        let Ldot = 0;
        if (p.reelTarget !== null) {
          const nl = approach(p.L, p.reelTarget, REEL_RATE * dt);
          Ldot = (nl - p.L) / dt;
        }
        const s = Math.sin(p.th), c = Math.cos(p.th);
        const tension = p.L * p.om * p.om + G * c + wx * s;
        if (tension > 0) {
          const alpha = (wx * c - G * s) / p.L - (2 * Ldot * p.om) / p.L - SWING_DAMP * p.om;
          p.om += alpha * dt;
          p.th += p.om * dt;
          if (p.th > Math.PI) p.th -= TAU; else if (p.th < -Math.PI) p.th += TAU;
          p.L = clamp(p.L + Ldot * dt, LMIN, LMAX);
          p.Ldot = Ldot;
          const s2 = Math.sin(p.th), c2 = Math.cos(p.th);
          const px = p.x, py = p.y;
          p.x = a.x + p.L * s2; p.y = a.y + p.L * c2;
          const vt = p.L * p.om;
          p.vx = vt * c2 + Ldot * s2 + a.vx;
          p.vy = -vt * s2 + Ldot * c2 + a.vy;
          landCheck(p, px, py, W);
          return;
        }
        p.mode = "slack";
        if (W.ev) W.ev("slack", 0);
      }
      const px0 = p.x, py0 = p.y;
      if (p.mode === "ground") {
        const pl = p.plat;
        p.vx *= Math.max(0, 1 - 9 * dt);
        p.vx += wx * dt * 0.3;
        p.x += p.vx * dt;
        p.y = pl.y; p.vy = 0;
        if (p.x < pl.x0 - 1 || p.x > pl.x1 + 1) { p.mode = a ? "slack" : "fly"; p.plat = null; }
      } else {
        p.vx += wx * dt; p.vy += G * dt;
        const k = 1 - AIR_DRAG * dt; p.vx *= k; p.vy *= k;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (a) {
        if (p.reelTarget !== null) p.L = approach(p.L, p.reelTarget, REEL_RATE * dt);
        p.Ldot = 0;
        const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
        // the courier's reel is self-retracting: it quietly takes up slack unless the player is paying line out
        if (d < p.L && p.reelTarget === null) p.L = Math.max(LMIN, d);
        if (d >= p.L) {
          const th = Math.atan2(dx, dy), s = Math.sin(th), c = Math.cos(th);
          const rvx = p.vx - a.vx, rvy = p.vy - a.vy;
          const vt = rvx * c - rvy * s, vr = rvx * s + rvy * c;
          if (p.mode === "ground") {
            const dyp = p.plat.y - a.y;
            if (p.L < dyp - 0.5) {
              // reeled in harder than the roof allows: the line lifts the courier off
              p.plat = null; p.mode = "swing"; p.th = th; p.om = vt / p.L;
              p.x = a.x + p.L * s; p.y = a.y + p.L * c;
              p.vx = vt * c + a.vx; p.vy = -vt * s + a.vy;
            } else {
              const hx = Math.sqrt(Math.max(0, p.L * p.L - dyp * dyp));
              p.x = a.x + (dx >= 0 ? 1 : -1) * hx;
              if ((dx >= 0 && p.vx > 0) || (dx < 0 && p.vx < 0)) p.vx = 0;
            }
          } else {
            p.mode = "swing"; p.th = th; p.om = vt / p.L;
            p.x = a.x + p.L * s; p.y = a.y + p.L * c;
            p.vx = vt * c + a.vx; p.vy = -vt * s + a.vy;
            if (vr > 0 && W.ev) W.ev("taut", vr);
          }
        }
      }
      if (p.mode === "fly" || p.mode === "slack") landCheck(p, px0, py0, W);
      if (!p.anchor) catchCheck(p, W);
    }

    // =====================================================================
    // 5. ANCHORS
    // =====================================================================
    let uid = 0;
    function mkAnchor(kind, x, y, reach, extra) {
      const a = Object.assign({
        id: ++uid, kind, bx: x, by: y, x, y, vx: 0, vy: 0, px: x, py: y, reach, catchable: true,
        locked: false, broken: false, sag: 0, sagV: 0, sagMax: 10, load: 0, hold: 0, glint: 0, vib: 0,
        phase: 0, speed: 0, amp: 0, cx: x, hx: x, hy: y, R: 0, ang: 0, angV: 0, life: 0
      }, extra || {});
      updateAnchorPos(a, 0);
      a.px = a.x; a.py = a.y;
      return a;
    }
    function updateAnchorPos(a, dt) {
      const ox = a.x, oy = a.y;
      if (a.kind === "pulley") {
        if (!a.locked) a.phase += a.speed * dt;
        a.x = a.cx + Math.sin(a.phase) * a.amp; a.y = a.by;
      } else if (a.kind === "clock") {
        if (!a.locked) a.ang += a.angV * dt;
        a.x = a.hx + Math.cos(a.ang) * a.R; a.y = a.hy + Math.sin(a.ang) * a.R;
      } else if (a.kind === "laundry") {
        const tgt = a.load ? a.sagMax : 0;
        // critically damped and stiff: the line visibly gives under load but settles in
        // about a tenth of a second, so a release is never spoiled by a still-moving pivot
        a.sagV += (900 * (tgt - a.sag) - 60 * a.sagV) * dt;
        a.sag += a.sagV * dt;
        a.x = a.bx; a.y = a.by + a.sag;
      } else { a.x = a.bx; a.y = a.by; }
      if (dt > 0) { a.vx = (a.x - ox) / dt; a.vy = (a.y - oy) / dt; }
      if (a.locked && (a.kind === "pulley" || a.kind === "clock")) { a.vx = 0; a.vy = 0; }
    }
    function anchorSamples(a) {
      if (a.kind === "pulley") {
        const out = [];
        for (let i = 0; i < 6; i++) out.push({ x: a.cx + Math.sin((i / 6) * TAU) * a.amp, y: a.by });
        return out;
      }
      if (a.kind === "clock") {
        const out = [];
        for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU; out.push({ x: a.hx + Math.cos(t) * a.R, y: a.hy + Math.sin(t) * a.R }); }
        return out;
      }
      return [{ x: a.bx, y: a.by }];
    }


    // =====================================================================
    // 6. ROUTE VALIDATION — every mandatory transfer is proven with the same
    // integrator the game uses, including "what does this flight meet first".
    // =====================================================================
    const NO_PLATS = [];
    function windFnFor(winds) {
      return (x, y) => {
        let f = 0;
        for (let i = 0; i < winds.length; i++) {
          const w = winds[i];
          if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) f += w.f * smooth(Math.min(x - w.x0, w.x1 - x, 90) / 90);
        }
        return f;
      };
    }
    function swingStates(src, L, amp, n, wind, maxT) {
      const p = makePlayer();
      p.mode = "swing"; p.anchor = { x: src.x, y: src.y, vx: 0, vy: 0 }; p.L = L; p.th = -amp; p.om = 0;
      p.x = src.x + L * Math.sin(-amp); p.y = src.y + L * Math.cos(amp);
      const T = TAU * Math.sqrt(L / G) * (1 + (amp * amp) / 16);
      const total = Math.ceil(Math.min(T, maxT || 99) / DT);
      const every = Math.max(1, Math.floor(total / n));
      const W = { wind, platforms: NO_PLATS, anchors: [], ev: null };
      const out = [];
      for (let i = 0; i < total; i++) {
        stepPlayer(p, DT, W);
        if (p.mode !== "swing") break;
        if (i % every === 0 && p.vx > 0) out.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
      }
      return out;
    }
    function proxyAnchor(a, x, y) {
      return { x, y, bx: x, by: y, vx: 0, vy: 0, reach: a.reach, catchable: true, broken: false, kind: a.kind, ref: a, locked: false, load: 0 };
    }
    // What a released flight actually meets first: a ring, a roof, or the fog.
    function flightOutcome(s, anchors, plats, wind) {
      const q = makePlayer();
      q.x = s.x; q.y = s.y; q.vx = s.vx; q.vy = s.vy; q.mode = "fly";
      let caught = null, landed = null;
      const W = { wind, platforms: plats, anchors, ev: (t, d) => { if (t === "catch") caught = d.a; else if (t === "land") landed = q.plat; } };
      for (let i = 0; i < 640; i++) {
        stepPlayer(q, DT, W);
        if (landed) return { landed, x: q.x, vy: d0(q) };
        if (caught) return { caught };
        if (q.y > DEATH_Y) return null;
      }
      return null;
    }
    function d0(q) { return q.lastImpact || 0; }
    // Number of sampled release moments on src whose flight is caught FIRST by dst.
    function linkScore(src, dst, others, plats, wind, opts) {
      opts = opts || {};
      const sources = opts.srcPoints || [{ x: src.bx, y: src.by + (src.kind === "laundry" ? src.sagMax : 0) }];
      const targets = anchorSamples(dst);
      const Ls = opts.Ls || [1, 0.85];
      let worst = 1e9;
      for (const sp of sources) {
        let best = 0;
        for (const Lf of Ls) {
          const L = clamp(src.reach * Lf, LMIN, LMAX);
          const states = swingStates(sp, L, opts.amp || 0.85, 40, wind, opts.maxT);
          for (const tp of targets) {
            const list = others.map(o => proxyAnchor(o, o.bx, o.by));
            const pd = proxyAnchor(dst, tp.x, tp.y);
            list.push(pd);
            let ok = 0;
            for (const s of states) { const r = flightOutcome(s, list, plats, wind); if (r && r.caught === pd) ok++; }
            if (ok > best) best = ok;
          }
        }
        if (best < worst) worst = best;
      }
      return worst;
    }
    function flightHits(s, tx, ty, R, wind) {
      let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
      const k = 1 - AIR_DRAG * DT;
      for (let i = 0; i < 600; i++) {
        vx += wind(x, y) * DT; vy += G * DT; vx *= k; vy *= k;
        x += vx * DT; y += vy * DT;
        const dx = x - tx, dy = y - ty;
        if (dx * dx + dy * dy <= R * R) return true;
        if (y > DEATH_Y || x > tx + 600) return false;
      }
      return false;
    }
    function rewardReachable(src, pt, r, wind) {
      for (const Lf of [1, 0.8, 1.25]) {
        const L = clamp(src.reach * Lf, LMIN, LMAX);
        for (const amp of [0.85, 1.15]) {
          const states = swingStates({ x: src.bx, y: src.by }, L, amp, 30, wind);
          for (const s of states) if (flightHits(s, pt.x, pt.y, r, wind)) return true;
        }
      }
      return false;
    }
    // A full released flight, sampled, plus what it met first.
    function tracePath(s, anchors, plats, wind) {
      const q = makePlayer();
      q.x = s.x; q.y = s.y; q.vx = s.vx; q.vy = s.vy; q.mode = "fly";
      let caught = null, landed = null, impact = 0;
      const W = { wind, platforms: plats, anchors, ev: (t, d) => { if (t === "catch") caught = d.a; else if (t === "land") { landed = q.plat; impact = d; } } };
      const pts = [];
      for (let i = 0; i < 640; i++) {
        stepPlayer(q, DT, W);
        if (landed || caught || q.y > DEATH_Y) break;
        pts.push(q.x, q.y, q.vx);
      }
      return { caught, landed, impact, pts, x: q.x };
    }
    // Every sampled release on a transfer H -> X, traced against the real surroundings.
    function pairProxies(pair) {
      const list = (pair.opts.others || []).map(o => proxyAnchor(o, o.bx, o.by));
      const px = proxyAnchor(pair.X, pair.X.bx, pair.X.by);
      list.push(px);
      return { list, px };
    }
    function transferFlights(pair, P, plats, wind) {
      const { H } = pair, { list, px } = pairProxies(pair);
      const Ls = pair.opts.Ls || (P.reel ? [1, 0.85, 0.7] : [1, 0.85]);
      const src = { x: H.bx, y: H.by + (H.kind === "laundry" ? H.sagMax : 0) };
      const out = [];
      for (const Lf of Ls) {
        const states = swingStates(src, clamp(H.reach * Lf, LMIN, LMAX), pair.opts.amp || P.amp, 40, wind, pair.opts.maxT);
        for (const st of states) { const f = tracePath(st, list, plats, wind); f.ok = f.caught === px; out.push(f); }
      }
      return out;
    }
    function passesZone(f, zx, zy, zr) {
      const r2 = zr * zr, p = f.pts;
      for (let i = 0; i < p.length; i += 3) { const dx = p[i] - zx, dy = p[i + 1] - zy; if (dx * dx + dy * dy < r2 && p[i + 2] > 0) return true; }
      return false;
    }
    function segDist(a, pl) {
      const x = clamp(a.bx, pl.x0, pl.x1);
      return Math.hypot(a.bx - x, a.by - pl.y);
    }
    // Transfers a receiver can sit on: host and next ring both fixed in place.
    function receiverPairs(c, rng) {
      const out = [];
      for (const [src, dst, opts] of c.links) {
        if (src.kind === "pulley" || src.kind === "clock" || dst.kind === "pulley" || dst.kind === "clock") continue;
        if (src.isDelivery || src.start || dst.bx - src.bx < 170) continue;
        out.push({ H: src, X: dst, opts: opts || {}, pri: c.type === "fork" && dst === c.anchors[1] ? 1 : rng() * 0.5 });
      }
      // the fork's high line first: that is where the choice already is
      return out.sort((a, b) => b.pri - a.pri);
    }
    // A window across the gap: it only takes a letter in flight, and it sits on the line
    // of some successful releases but not most, so the release itself is the delivery.
    const FLY_SWINGS = [[1, 0.8], [0.9, 0.95], [1, 1.1], [0.82, 0.88]];
    function planFlythrough(pair, P, rng, zr, plats, wind) {
      const { H, X } = pair;
      // the swing a player actually has varies, so the window must sit on the line of
      // every typical swing (length and strength), yet on only part of each
      const sets = FLY_SWINGS.map(([Lf, amp]) => transferFlights({ H, X, opts: Object.assign({}, pair.opts, { Ls: [Lf], amp: amp * (P.amp / 0.9) }) }, P, plats, wind).filter(f => f.ok));
      if (sets.some(g => g.length < 4)) return null;
      const all = [].concat(...sets);
      // rasterise every flight onto a grid of candidate window centres
      const STEP = 10, gx0 = H.bx + 70, gx1 = X.bx - 20;
      let gy0 = 1e9, gy1 = -1e9;
      for (const f of all) for (let i = 1; i < f.pts.length; i += 3) { gy0 = Math.min(gy0, f.pts[i]); gy1 = Math.max(gy1, f.pts[i]); }
      gy0 = Math.max(100, gy0 - zr); gy1 = Math.min(FOG_Y - 150, gy1 + zr);
      const nx = Math.floor((gx1 - gx0) / STEP) + 1, ny = Math.floor((gy1 - gy0) / STEP) + 1;
      if (nx < 1 || ny < 1) return null;
      const counts = sets.map(() => new Uint16Array(nx * ny)), stamp = new Int32Array(nx * ny).fill(-1);
      const rc = Math.ceil(zr / STEP), r2 = zr * zr;
      let fid = 0;
      sets.forEach((g, si) => {
        for (const f of g) {
          fid++;
          const p = f.pts;
          for (let i = 0; i < p.length; i += 3) {
            if (p[i + 2] <= 0) continue;
            const cx = Math.round((p[i] - gx0) / STEP), cy = Math.round((p[i + 1] - gy0) / STEP);
            for (let iy = Math.max(0, cy - rc); iy <= Math.min(ny - 1, cy + rc); iy++) {
              for (let ix = Math.max(0, cx - rc); ix <= Math.min(nx - 1, cx + rc); ix++) {
                const c = iy * nx + ix;
                if (stamp[c] === fid) continue;
                const dx = gx0 + ix * STEP - p[i], dy = gy0 + iy * STEP - p[i + 1];
                if (dx * dx + dy * dy < r2) { stamp[c] = fid; counts[si][c]++; }
              }
            }
          }
        }
      });
      const okCells = [];
      let bestWorst = 2;
      for (let c = 0; c < nx * ny; c++) {
        // every typical swing reaches it, and all but one of them with some margin
        let worst = 1e9, second = 1e9, hit = 0;
        for (const cn of counts) { const h = cn[c]; if (h < worst) { second = worst; worst = h; } else if (h < second) second = h; hit += h; }
        if (worst < 1 || second < 2 || hit > all.length * 0.55) continue;
        worst = second;
        if (worst > bestWorst) { bestWorst = worst; okCells.length = 0; }
        // prefer windows off the hanging swing's arc, so the window reads as out in the gap
        const gx = gx0 + (c % nx) * STEP, gy = gy0 + Math.floor(c / nx) * STEP;
        const offArc = Math.hypot(gx - H.bx, gy - H.by) > H.reach + zr * 0.6;
        if (worst >= bestWorst - 1) okCells.push([c, hit, offArc]);
      }
      if (!okCells.length) return null;
      const pool = okCells.some(o => o[2]) ? okCells.filter(o => o[2]) : okCells;
      const [c, hit] = pool[Math.floor(rng() * pool.length)];
      return { type: "flythrough", host: H, next: X, x: gx0 + (c % nx) * STEP, y: gy0 + Math.floor(c / nx) * STEP, r: zr, dir: 1, odds: hit / all.length };
    }
    // A rooftop box: a deck under the gap, below both swings. Early, low releases drop
    // onto it, later ones carry on to the next ring, and a hop from anywhere on it
    // reaches that ring again.
    function planRoofbox(pair, P, rng, plats, wind) {
      const { H, X } = pair;
      const { list, px } = pairProxies(pair);
      for (let k = 0; k < 5; k++) {
        const w = rr(rng, 112, 146);
        const cx = lerp(H.bx, X.bx, rr(rng, 0.42, 0.62));
        const plat = { x0: cx - w / 2, x1: cx + w / 2, y: Math.max(H.by, X.by) + 60, id: -1 };
        while (plat.y < FOG_Y && (segDist(H, plat) < H.reach + 14 || segDist(X, plat) < X.reach + 12)) plat.y += 8;
        plat.y += rr(rng, 0, 24);
        if (plat.y > FOG_Y - 120) continue;
        const pl2 = plats.concat([plat]);
        const fl = transferFlights(pair, P, pl2, wind);
        const land = fl.filter(f => f.landed === plat).length, direct = fl.filter(f => f.ok).length;
        if (land < 4 || direct < 3) continue;
        let hopOk = true;
        for (const hx of [plat.x0 + 8, cx, plat.x1 - 8]) {
          const f = tracePath({ x: hx, y: plat.y, vx: HOP_VX, vy: HOP_VY }, list, pl2, wind);
          if (f.caught !== px) { hopOk = false; break; }
        }
        if (!hopOk) continue;
        const bx = cx + rr(rng, -10, 16);
        return { type: "roofbox", host: H, next: X, x: bx, y: plat.y - 10, r: w / 2, plat, dir: 0, odds: land / (land + direct) };
      }
      return null;
    }

    // =====================================================================
    // 7. ROUTE NETWORK — authored encounter patterns, a taught opening,
    // seeded variation, and receivers with physical approach rules.
    // =====================================================================
    let route = null;
    function newRoute(seed) {
      return {
        seed, anchors: [], clusters: [], platforms: [], deliveries: [], rewards: [], winds: [], decor: [],
        genLog: [], frontX: 0, last: null, encIndex: 0, letters: 0, sinceLetter: 0, district: 0, firstInDistrict: false,
        opening: 0, built: [], hints: {}, districtStarts: [{ x: -1e9, d: 0 }], version: 0
      };
    }
    function districtIndexFor(letters) { return Math.min(4, Math.floor(letters / LETTERS_PER_DISTRICT)); }
    function lapFor(letters) { return Math.max(0, Math.floor(letters / LETTERS_PER_DISTRICT) - 4); }

    // ---- architecture placement (consumed by the 3D builder) ----
    function addCluster(cl) { cl.id = ++uid; cl.brackets = cl.brackets || []; route.clusters.push(cl); return cl; }
    function supportAt(x, y, d, rng, zPref) {
      // reuse a nearby support cluster whose top is above the bracket point
      for (let i = route.clusters.length - 1; i >= 0 && i > route.clusters.length - 24; i--) {
        const c = route.clusters[i];
        if (c.role !== "support") continue;
        if (Math.abs(c.x - x) < c.w * 0.5 + 170 && c.top < y - 24) {
          const pt = { x: clamp(x, c.x - c.w * 0.5 + 8, c.x + c.w * 0.5 - 8), y: Math.max(y, c.top + 30), z: c.z + c.dz * 0.5 + 2 };
          c.brackets.push(pt);
          return pt;
        }
      }
      const P = DISTRICTS[d];
      const w = rr(rng, 80, 140), dz = rr(rng, 70, 120);
      const z = (zPref !== undefined ? zPref : -rr(rng, 170, 300)) - dz * 0.5;
      const c = addCluster({ x, w, dz, z, top: y - rr(rng, 40, 170), d, role: "support", style: P.style, seed: Math.floor(rng() * 1e9) });
      const pt = { x, y, z: c.z + dz * 0.5 + 2 };
      c.brackets.push(pt);
      return pt;
    }
    function decorateAnchor(a, d, rng) {
      if (a.kind === "laundry") {
        a.line = [supportAt(a.bx - rr(rng, 110, 150), a.by - rr(rng, 26, 46), d, rng, -rr(rng, 30, 80)), supportAt(a.bx + rr(rng, 110, 150), a.by - rr(rng, 26, 46), d, rng, -rr(rng, 30, 80))];
        a.clothes = [];
        const n = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          let t = rr(rng, 0.1, 0.9);
          if (Math.abs(t - 0.5) < 0.12) t += 0.2 * Math.sign(t - 0.5 || 1);
          a.clothes.push({ t, w: rr(rng, 9, 16), h: rr(rng, 12, 22), c: pick(rng, ["#b9a98a", "#7f948e", "#8e4b37", "#cfc6b0", "#5d6f6c", "#9a7d55"]), ph: rng() * TAU });
        }
      } else if (a.kind === "pulley") {
        a.track = [supportAt(a.cx - a.amp - rr(rng, 60, 90), a.by - 26, d, rng, -30), supportAt(a.cx + a.amp + rr(rng, 60, 90), a.by - 26, d, rng, -30)];
      } else if (a.kind === "clock") {
        addCluster({ x: a.hx, w: rr(rng, 150, 180), dz: 110, z: -80, top: a.hy - rr(rng, 190, 280), d, role: "clock", style: "spine", seed: Math.floor(rng() * 1e9), hub: { x: a.hx, y: a.hy, R: a.R } });
      } else if (a.kind === "fragile") {
        a.beam = supportAt(a.bx + rr(rng, -40, 40), a.by - rr(rng, 110, 150), d, rng, -40);
      } else {
        a.cables = [
          supportAt(a.bx - rr(rng, 110, 180), a.by - rr(rng, 40, 120), d, rng),
          supportAt(a.bx + rr(rng, 110, 180), a.by - rr(rng, 40, 120), d, rng)
        ];
      }
    }
    function addPlatform(x0, x1, y, d, rng, kind, extra) {
      const pl = Object.assign({ x0, x1, y, id: ++uid, kind: kind || "deck" }, extra || {});
      route.platforms.push(pl);
      addCluster({ x: (x0 + x1) / 2, w: x1 - x0 + 12, dz: rr(rng, 60, 100), z: -30, top: y, d, role: "deck", style: DISTRICTS[d].style, seed: Math.floor(rng() * 1e9), plat: pl });
      return pl;
    }

    function hookFor(P, r) { return r >= P.reach[1] - 4 ? "hook" : r <= 156 ? "eyelet" : "ring"; }

    function buildCandidate(type, A, d, rng, scale, lap) {
      const P = DISTRICTS[d];
      const red = Math.min(18, lap * 4);
      const reach = () => rr(rng, P.reach[0] - red, P.reach[1] - red);
      const dxr = () => rr(rng, P.dx[0], P.dx[1]) * scale + lap * 6;
      const cy = y => clamp(y, ANCHOR_MIN_Y, ANCHOR_MAX_Y);
      const c = { type, anchors: [], links: [], exit: null, rewards: [], winds: [], plats: [], hosts: [], hint: null };
      const ring = (x, y, r, kind) => mkAnchor(kind || hookFor(P, r), x, cy(y), r);
      const reelLs = P.reel ? [1, 0.85, 0.7, 1.25] : [1, 0.85];
      if (type === "gap" || type === "rise" || type === "dip") {
        const dy = type === "rise" ? -rr(rng, 35, 65) : type === "dip" ? rr(rng, 60, 100) : rr(rng, P.dy[0], P.dy[1]) * 0.6;
        const B = ring(A.bx + dxr() * (type === "rise" ? 0.8 : type === "dip" ? 1.05 : 1), A.by + dy * scale, reach());
        c.anchors.push(B); c.links.push([A, B, { others: [] }]); c.exit = B; c.hosts.push(B);
        if (type === "dip") c.plats.push({ x: lerp(A.bx, B.bx, 0.5), w: rr(rng, 140, 200), y: Math.max(A.by, B.by) + B.reach + rr(rng, 90, 130), kind: "deck" });
      } else if (type === "fork") {
        // near and low vs far and high. The high ring needs a later release but leads
        // straight on; the low ring is easy to catch but costs an extra climb.
        const base = Math.min(dxr(), P.reach[0] * 1.42 + lap * 4);
        const N = ring(A.bx + base * 0.7, A.by + rr(rng, 110, 140) * scale, reach());
        const F = ring(A.bx + base * 0.95, A.by - rr(rng, 0, 28) * scale, reach() - 4);
        const N2 = ring(N.bx + base * 0.62, N.by - rr(rng, 30, 50), reach());
        const M = ring(A.bx + base * 1.85, A.by + rr(rng, 30, 60), reach());
        N.noBias = F.noBias = true; // the fork's geometry is relative to the entry ring
        c.anchors.push(N, F, N2, M);
        c.links.push([A, N, { others: [F] }], [A, F, { others: [N], need: 2 }], [N, N2, { others: [F] }], [N2, M, { others: [] }], [F, M, { others: [N2], need: 3 }]);
        c.exit = M; c.hosts.push(F, N);
        c.rewards.push({ src: F, x: lerp(F.bx, M.bx, 0.5), y: Math.min(F.by, M.by) - rr(rng, 30, 60) });
        c.hint = { a: A.id, text: "Two rings ahead. Let go late for the high one, early for the low one", key: "fork", onEntry: true };
      } else if (type === "reelroof") {
        const R = ring(A.bx + dxr(), A.by + rr(rng, -30, 40) * scale, reach());
        const Cn = ring(R.bx + dxr() * 0.9, R.by + rr(rng, -40, 40) * scale, reach());
        const top = R.by + R.reach * rr(rng, 0.78, 0.86);
        c.plats.push({ x: R.bx + rr(rng, -10, 20), w: rr(rng, 150, 190), y: top, kind: "obstacle" });
        c.anchors.push(R, Cn); c.exit = Cn; c.hosts.push(R);
        c.links.push([A, R, { others: [] }], [R, Cn, { others: [], Ls: [0.66, 0.6], obstacle: true }]);
        c.reelHost = { L: 0.64 }; R.reelLesson = true;
        c.hint = { a: R.id, text: "A roof sits under this swing. Drag up to reel in and clear it", key: "reel" };
      } else if (type === "longline") {
        const B = ring(A.bx + A.reach * rr(rng, 1.85, 2.05) * scale, A.by + rr(rng, 40, 80) * scale, reach());
        c.anchors.push(B); c.exit = B; c.hosts.push(B);
        c.links.push([A, B, { others: [], Ls: [1.35, 1.45, 1.25], amp: P.amp + 0.1, need: 3 }]);
        c.rewards.push({ src: A, x: lerp(A.bx, B.bx, 0.5), y: Math.max(A.by, B.by) + rr(rng, 110, 160) });
        c.hint = { a: A.id, text: "Too far for this line. Drag down to let out more and swing wider", key: "longline", onEntry: true };
      } else if (type === "laundry") {
        const B = mkAnchor("laundry", A.bx + dxr() * 0.9, cy(A.by + rr(rng, -40, 40) * scale), reach() - 6);
        const C = mkAnchor("laundry", B.bx + dxr() * 0.88, cy(B.by + rr(rng, -50, 50) * scale), reach() - 6);
        c.anchors.push(B, C); c.links.push([A, B, { others: [C] }], [B, C, { others: [] }]); c.exit = C; c.hosts.push(C);
        c.hint = { a: B.id, text: "Laundry lines give under your weight", key: "laundry" };
      } else if (type === "pulley") {
        const pbx = A.bx + dxr() * 0.86;
        const B = mkAnchor("pulley", pbx, cy(A.by + rr(rng, -40, 40) * scale), reach() - 4, { cx: pbx, amp: rr(rng, 35, 55), speed: rr(rng, 0.8, 1.2), phase: rng() * TAU });
        const C = ring(B.cx + rr(rng, 165, 205) * scale, B.by + rr(rng, 0, 50) * scale, reach());
        c.anchors.push(B, C); c.exit = C; c.hosts.push(C);
        c.links.push([A, B, { others: [] }], [B, C, { others: [], srcPoints: [{ x: B.cx - B.amp, y: B.by }, { x: B.cx, y: B.by }, { x: B.cx + B.amp, y: B.by }], need: 2 }]);
        c.hint = { a: A.id, text: "The pulley keeps moving. Aim where it will be", key: "pulley", onEntry: true };
      } else if (type === "clock") {
        const hx = A.bx + dxr() * 0.9, hy = cy(A.by + rr(rng, -40, 20) * scale);
        const R = rr(rng, 50, 66);
        const B = mkAnchor("clock", hx, hy, reach(), { hx, hy, R, ang: rng() * TAU, angV: (rng() < 0.5 ? -1 : 1) * rr(rng, 0.5, 0.8) });
        const C = ring(hx + rr(rng, 165, 200) * scale, hy + rr(rng, 20, 70) * scale, reach());
        const pts = [];
        for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU; pts.push({ x: hx + Math.cos(t) * R, y: hy + Math.sin(t) * R }); }
        c.anchors.push(B, C); c.exit = C; c.hosts.push(C);
        c.links.push([A, B, { others: [] }], [B, C, { others: [], srcPoints: pts, need: 1 }]);
        c.hint = { a: A.id, text: "The clock arm turns. Its ring stops when you catch it", key: "clock", onEntry: true };
      } else if (type === "fragile") {
        const B = mkAnchor("fragile", A.bx + dxr() * 0.8, cy(A.by + rr(rng, -30, 30) * scale), reach() - 6, { life: 1.6 });
        const C = ring(B.bx + dxr() * 0.8, B.by + rr(rng, -40, 40) * scale, reach());
        c.anchors.push(B, C); c.exit = C; c.hosts.push(C);
        c.links.push([A, B, { others: [] }], [B, C, { others: [], maxT: 1.3 }]);
        c.hint = { a: B.id, text: "Frayed line. Let go before it snaps", key: "fragile" };
      } else if (type === "wind") {
        const head = rng() < 0.35;
        const f = head ? -rr(rng, 150, 210) : rr(rng, 220, 320);
        const B = ring(A.bx + dxr() * (head ? 0.9 : 1.22), A.by + rr(rng, -40, 40) * scale, reach());
        c.winds.push({ x0: A.bx - 30, x1: B.bx + 20, y0: -500, y1: FOG_Y + 200, f });
        c.anchors.push(B); c.links.push([A, B, { others: [] }]); c.exit = B; c.hosts.push(B);
        c.hint = { a: A.id, text: head ? "Headwind in this gap. The cloth shows its pull" : "Tailwind in this gap. It carries you further", key: "wind", onEntry: true };
      }
      // drift correction keeps the network in the middle band of the city
      let bias = clamp((400 - A.by) * 0.5, -70, 70);
      if ((type === "rise" && bias < 0) || (type === "dip" && bias > 0)) bias *= 0.3;
      if (Math.abs(bias) > 1) {
        for (const a of c.anchors) { if (a.noBias) continue; const ny = cy(a.by + bias), dyb = ny - a.by; a.by = ny; a.hy += dyb; updateAnchorPos(a, 0); a.px = a.x; a.py = a.y; }
        for (const rw of c.rewards) rw.y += bias;
        for (const pp of c.plats) pp.y += bias;
      }
      return c;
    }

    function candPlats(c) {
      const near = route.platforms.filter(p => p.x1 > (route.last ? route.last.bx - 200 : -1e9));
      return near.concat(c.plats.map(p => ({ x0: p.x - p.w / 2 + 6, x1: p.x + p.w / 2 - 6, y: Math.min(p.y, FOG_Y - 110) })));
    }
    function validateCandidate(c, d) {
      const P = DISTRICTS[d];
      const wind = windFnFor(route.winds.concat(c.winds));
      const plats = candPlats(c);
      for (const [src, dst, opts] of c.links) {
        const o = Object.assign({ amp: P.amp }, opts);
        const need = Math.min(P.req, o.need || P.req);
        const sc = linkScore(src, dst, o.others || [], plats, wind, o);
        if (sc < need) { route.lastFail = c.type + ":" + c.links.findIndex(l => l[1] === dst && l[0] === src) + "=" + sc + "/" + need + " A" + Math.round(src.by) + "k" + src.kind; return false; }
      }
      return true;
    }

    // ---- receivers: where a letter goes and how it must arrive ----
    const RECV_TEXT = {
      chute: "hatch", balcony: "high balcony", roofbox: "rooftop box", shutter: "shuttered hatch", flythrough: "gap window"
    };
    const RECV_HINT = {
      flythrough: "This window sits out in the gap. Let go so your flight passes through it",
      roofbox: "The rooftop box is below the line. Let go early to drop onto its roof"
    };
    function planReceiver(c, d, rng, lap, forced) {
      const P = DISTRICTS[d];
      const wind = windFnFor(route.winds.concat(c.winds));
      const tries = forced ? [forced, "chute"] : [weighted(rng, P.recv), "chute"];
      const zr = Math.max(18, P.zoneR - Math.min(6, lap * 2));
      for (const type of tries) {
        if (type === "roofbox" || type === "flythrough") {
          const plats = candPlats(c);
          for (const pair of receiverPairs(c, rng)) {
            const r = type === "roofbox" ? planRoofbox(pair, P, rng, plats, wind) : planFlythrough(pair, P, rng, zr + 4, plats, wind);
            if (r) return r;
          }
          continue;
        }
        for (const host of c.hosts) {
          let phi, dz, dir = 1;
          const reelFactor = c.reelHost && host === c.hosts[0] ? c.reelHost.L : null;
          if (reelFactor) dz = host.reach * reelFactor;
          else if (!P.reel || rng() < 0.35) dz = host.reach * rr(rng, 0.92, 0.97);
          else dz = rng() < 0.5 ? host.reach * rr(rng, 0.62, 0.76) : clamp(host.reach * rr(rng, 1.18, 1.32), LMIN + 20, LMAX - 12);
          if (type === "balcony") phi = rr(rng, 0.72, 0.98);
          else { phi = rr(rng, 0.08, 0.42); if (d >= 2 && rng() < 0.3) { phi = -phi; } if (d >= 1 && rng() < 0.25) dir = -1; }
          if (type === "shutter") phi = Math.sign(phi) * Math.min(Math.abs(phi), 0.35);
          return {
            type, host, phi, dz, dir, r: type === "balcony" ? zr + 4 : zr, reelNeed: Math.abs(dz / host.reach - 1) > 0.12,
            x: host.bx + Math.sin(phi) * dz, y: host.by + Math.cos(phi) * dz,
            cycle: type === "shutter" ? { period: rr(rng, 3.2, 4.2), open: 0.55, phase: rng() * TAU } : null
          };
        }
      }
      return null;
    }

    function commitCandidate(c, d, rng, wantLetter, forcedRecv, preRecv) {
      const P = DISTRICTS[d];
      for (const a of c.anchors) { a.d = d; route.anchors.push(a); decorateAnchor(a, d, rng); }
      for (const w of c.winds) route.winds.push(w);
      const wind = windFnFor(route.winds);
      for (const rw of c.rewards) {
        let pt = { x: rw.x, y: rw.y }, ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          if (rewardReachable(rw.src, pt, 20, wind)) ok = true;
          else { pt.x = lerp(pt.x, rw.src.bx + rw.src.reach * 0.7, 0.2); pt.y = lerp(pt.y, rw.src.by + 60, 0.2); }
        }
        if (ok) route.rewards.push({ id: ++uid, x: pt.x, y: pt.y, r: 20, taken: false, ph: rng() * TAU });
      }
      for (const pp of c.plats) {
        const y = Math.min(pp.y, FOG_Y - 110);
        addPlatform(pp.x - pp.w / 2 + 6, pp.x + pp.w / 2 - 6, y, d, rng, pp.kind);
      }
      // safety decks well below ordinary swings
      for (const a of c.anchors) {
        if (rng() < P.plat && a.kind !== "clock" && !c.reelHost) {
          const top = a.by + Math.max(a.reach * 1.3, 230) + rr(rng, 60, 110);
          if (top < FOG_Y - 100) { const x = a.bx + rr(rng, -20, 70), w = rr(rng, 130, 200); addPlatform(x - w / 2, x + w / 2, top, d, rng, "deck"); }
        }
      }
      let recv = null;
      if (wantLetter) recv = preRecv || planReceiver(c, d, rng, lapFor(route.letters), forcedRecv);
      if (recv) {
        const n = route.deliveries.length;
        let hostCluster = null;
        if (recv.plat) {
          const pl = addPlatform(recv.plat.x0, recv.plat.x1, recv.plat.y, d, rng, "roofbox");
          recv.plat = pl;
          hostCluster = route.clusters[route.clusters.length - 1];
          hostCluster.role = "roofhost";
        }
        const L = Object.assign(recv, {
          id: ++uid, index: n, D: recv.host, d, status: "pending",
          name: NAMES[hash2(route.seed, n * 7 + 3) % NAMES.length],
          number: 3 + (hash2(route.seed, n * 13 + 1) % 96),
          symbol: SYMBOLS[hash2(route.seed, n * 11 + 5) % SYMBOLS.length],
          inZone: false, minD: 1e9, prevD: 1e9, entry: null, failedPasses: 0, roofLandings: 0, flash: 0, open: 1
        });
        recv.host.isDelivery = true;
        route.deliveries.push(L);
        if (hostCluster) hostCluster.recv = L;
        else addCluster({ x: L.x + rr(rng, -10, 30) * (L.dir || 1), w: rr(rng, 140, 190), dz: rr(rng, 70, 110), z: -24 - 50, top: L.y - rr(rng, 70, 140), d, role: "recipient", style: P.style, seed: Math.floor(rng() * 1e9), recv: L });
        if (RECV_HINT[L.type] && !route.hints[L.type]) route.hints[L.type] = { a: L.D.id, text: RECV_HINT[L.type], key: L.type, onEntry: true };
        route.letters++;
        route.sinceLetter = 0;
      } else route.sinceLetter++;
      if (c.hint && !route.hints[c.hint.key]) route.hints[c.hint.key] = c.hint;
      // depth layer: decorative wires and dwellings behind the plane, with deliberate gaps
      const x0 = route.frontX, x1 = c.exit.bx;
      if (rng() < 0.8) route.decor.push({ kind: "wire", x0: x0 - rr(rng, 40, 160), y0: rr(rng, 120, 340), z0: -rr(rng, 40, 260), x1: x1 + rr(rng, -40, 80), y1: rr(rng, 120, 340), z1: -rr(rng, 40, 260), sag: rr(rng, 30, 90) });
      if (rng() < 0.35) route.decor.push({ kind: "wire", x0: lerp(x0, x1, 0.2), y0: rr(rng, -40, 120), z0: rr(rng, 60, 140), x1: lerp(x0, x1, 0.9), y1: rr(rng, -40, 120), z1: rr(rng, 60, 140), sag: rr(rng, 30, 70), near: true });
      if (rng() < 0.45) addCluster({ x: rr(rng, x0, x1), w: rr(rng, 90, 160), dz: rr(rng, 80, 150), z: -rr(rng, 620, 900), top: rr(rng, -100, 420), d, role: "mid", style: P.style, seed: Math.floor(rng() * 1e9) });
      route.last = c.exit;
      route.frontX = c.exit.bx;
      route.encIndex++;
      route.lastType = c.type;
      route.version++;
      return recv;
    }

    // The opening teaches the real game in order: read the swing, choose a ring,
    // shape the line, then deliver with intent. Small seeded variation each run.
    const OPENING = [
      { type: "gap", letter: "chute" },
      { type: "fork", letter: "balcony" },
      { type: "reelroof", letter: "chute" },
      { type: "gap", letter: "flythrough" },
      { type: "dip", letter: null }
    ];
    function addEncounter() {
      const opening = route.opening < OPENING.length ? OPENING[route.opening] : null;
      const d = opening ? 0 : districtIndexFor(route.letters);
      const lap = lapFor(route.letters);
      if (d !== route.district) {
        route.district = d; route.firstInDistrict = true;
        route.districtStarts.push({ x: route.frontX + 60, d });
      }
      const P = DISTRICTS[d];
      const rng = mulberry32(hash2(route.seed, route.encIndex + 1));
      let type, wantLetter, forcedRecv = null;
      if (opening) { type = opening.type; wantLetter = !!opening.letter; forcedRecv = opening.letter; route.opening++; }
      else {
        wantLetter = route.sinceLetter >= P.letterEvery - 1;
        if (route.firstInDistrict) type = P.sig;
        else {
          type = weighted(rng, P.pool);
          if (type === route.lastType && rng() < 0.6) type = weighted(rng, P.pool);
          if (type === "fork" && route.last.by > 480) type = "rise";
          if (type === "dip" && route.last.by > 500) type = "rise";
          else if (type === "rise" && route.last.by < 300) type = "dip";
        }
      }
      route.firstInDistrict = false;
      const A = route.last;
      // a fork needs vertical room below the entry ring for its low branch
      if (type === "fork" && A.by > 500) type = "rise";
      // a taught receiver in the opening is worth a few seeded variations of the encounter
      const special = forcedRecv === "flythrough" || forcedRecv === "roofbox";
      for (const scale of [1, 0.92, 0.85, 0.78, 0.7]) {
        for (let v = 0; v < (special ? 5 : 1); v++) {
          const crng = mulberry32(hash2(route.seed, route.encIndex * 31 + Math.round(scale * 100) + v * 7919));
          const c = buildCandidate(type, A, d, crng, scale, lap);
          if (!validateCandidate(c, d)) continue;
          let pre = null;
          if (special) { pre = planReceiver(c, d, crng, lap, forcedRecv); if ((!pre || pre.type !== forcedRecv) && v < 4) continue; }
          commitCandidate(c, d, crng, wantLetter, forcedRecv, pre);
          if (route.genLog.length < 200) route.genLog.push(type + "@" + scale);
          return;
        }
      }
      // fallback: a plain gap, shortened until the physics proves it
      for (let k = 0; k < 14; k++) {
        const crng = mulberry32(hash2(route.seed, route.encIndex * 97 + k));
        const r = DISTRICTS[d].reach[1];
        const B = mkAnchor("hook", A.bx + DISTRICTS[d].dx[0] - k * 12, clamp(A.by + clamp((400 - A.by) * 0.4, -30, 30), ANCHOR_MIN_Y, ANCHOR_MAX_Y), r);
        const c = { type: "gap", anchors: [B], links: [[A, B, { others: [] }]], exit: B, rewards: [], winds: [], plats: [], hosts: [B], hint: null };
        if (k === 13 || validateCandidate(c, d)) {
          commitCandidate(c, d, crng, wantLetter, wantLetter ? "chute" : null);
          if (route.genLog.length < 200) route.genLog.push(type + "!fallback" + k + "(" + route.lastFail + ")");
          return;
        }
      }
    }

    function buildStart(seed) {
      route = newRoute(seed);
      uid = 0;
      const rng = mulberry32(hash2(seed, 0));
      const A0 = mkAnchor("hook", 0, 400, DISTRICTS[0].reach[1]);
      A0.d = 0; A0.start = true; A0.scored = true;
      route.anchors.push(A0);
      decorateAnchor(A0, 0, rng);
      const po = { x0: -236, x1: -122, y: 540, id: ++uid, kind: "post" };
      route.platforms.push(po);
      addCluster({ x: -230, w: 230, dz: 120, z: -30, top: 540, d: 0, role: "post", style: "colony", seed: 777, plat: po });
      route.last = A0; route.frontX = 0; route.sinceLetter = 0;
      route.startPlat = po;
    }
    function ensureRoute(x, maxNew) {
      let n = 0;
      while (route.frontX < x + 2400 && n++ < (maxNew || 1)) addEncounter();
    }
    function pruneRoute(x) {
      const cut = x - 2200;
      const keepA = a => a.bx > cut || a === player.anchor;
      route.anchors = route.anchors.filter(keepA);
      route.platforms = route.platforms.filter(p => p.x1 > cut);
      const dropped = route.clusters.filter(c => c.x + c.w < cut);
      route.clusters = route.clusters.filter(c => c.x + c.w >= cut);
      for (const c of dropped) c.dead = true;
      route.rewards = route.rewards.filter(r => r.x > cut);
      route.decor = route.decor.filter(o => o.x1 > cut);
      route.winds = route.winds.filter(w => w.x1 > cut);
      route.version++;
    }

    // =====================================================================
    // 8. RUN STATE, DELIVERY RULES, SCORING
    // =====================================================================
    let hud = null, world = null;
    const player = makePlayer();
    let run = null;
    let attempt = 0;
    let disposed = false;
    let gameState = "title"; // title | play | dying | results
    let paused = false;
    let simTime = 0;
    let eventStep = 0;
    let stepCounter = 0;
    const score = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;
    const flightNear = new Map();
    let worldWind = () => 0;
    const fx = { ropeVib: 0, ropeExtend: 1, retract: null, renderOff: null, nearMiss: null, catchFlash: null };

    function newRun() {
      attempt++;
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0xffff)) >>> 0;
      buildStart(seed);
      Object.assign(player, makePlayer());
      const A0 = route.anchors[0];
      player.x = -138; player.y = route.startPlat.y; player.mode = "ground"; player.plat = route.startPlat;
      player.anchor = A0; player.L = Math.hypot(player.x - A0.x, player.y - A0.y); A0.locked = true;
      player.px = player.x; player.py = player.y;
      ensureRoute(0, 12);
      run = {
        seed, score: 0, delivered: 0, clean: 0, perfect: 0, missed: 0, streak: 0, bestStreak: 0, airmail: 0, skilled: 0,
        maxX: 0, distPts: 0, district: 0, started: false, dyingT: 0, catches: 0, ledger: [], reelUsed: 0, resultsAt: 0,
        hangT: 0, lastRelease: null, landedSinceLetter: false, deathNear: null, reelOnAnchor: 0, landedOnAnchor: false
      };
      if (score) score.reset();
      fx.retract = null; fx.ropeExtend = 1; fx.nearMiss = null; fx.renderOff = null;
      flightNear.clear();
      cam.snap = true;
      gameState = "title";
      simTime = 0;
      hud && hud.reset();
    }

    function addScore(n, reason) {
      if (!n) return;
      run.score += n;
      if (score) score.add(n, { reason });
    }

    function onEvent(type, data) {
      eventStep = stepCounter;
      if (type === "catch") {
        const a = data.a;
        run.catches++; records.catches++;
        fx.ropeExtend = 0; fx.ropeVib = Math.min(4, 1 + data.jerk * 0.006);
        a.vib = 1;
        const clean = data.retention > 0.92 && data.speed > 250;
        if (!a.scored && !a.start) {
          // transfer quality is judged once per ring: no farming by re-catching
          a.scored = true;
          let pts = 5, label = null;
          const rel = run.lastRelease;
          if (rel) {
            const span = a.x - rel.x;
            if (span > 300) { pts += 25; label = "Long transfer"; run.skilled++; }
            else if (rel.y - a.y > 70) { pts += 20; label = "High transfer"; run.skilled++; }
          }
          if (clean) pts += 10;
          addScore(pts, "transfer");
          if (label) hud.toast(label + "  +" + pts, "quiet");
        }
        // rope work is paid once per ring: clearing a roof by reeling, without touching it
        const prev = run.prevAnchor;
        if (prev && prev !== a && prev.reelLesson && !prev.reelPaid && !run.landedOnAnchor && a.bx > prev.bx) {
          prev.reelPaid = true; run.skilled++;
          addScore(30, "rope");
          hud.toast("Cleared the roof  +30", "quiet");
        }
        run.prevAnchor = a; run.reelOnAnchor = 0; run.landedOnAnchor = false;
        if (a.kind === "fragile") a.hold = 0;
        audio.catchSfx(clean ? 1 : 0.5, a.kind);
        haptic("light");
        fx.catchFlash = { a, t: 0 };
        flightNear.clear();
        // a flight already inside a window posts the letter before the next ring takes the line
        const W0 = activeLetter();
        if (W0 && W0.inZone && W0.type === "flythrough") resolvePass(W0, true);
        const L = activeLetter();
        if (L && a !== L.D && a.bx > L.D.bx + 40 && !a.start) missLetter(L);
        const hint = Object.values(route.hints).find(h => h.a === a.id && !h.onEntry);
        if (hint) hud.teach(hint.key, hint.text);
        try { ctx.platform.interact({ type: "catch" }); } catch (e) { /* ignore */ }
      } else if (type === "taut") {
        fx.ropeVib = Math.min(5, data * 0.012);
        if (data > 160) audio.creak(Math.min(1, data / 700));
      } else if (type === "land") {
        audio.land(Math.min(1, data / 900));
        if (data > 300) haptic("light");
        const L = activeLetter();
        if (L && !(L.type === "roofbox" && player.plat === L.plat)) run.landedSinceLetter = true;
        run.landedOnAnchor = true;
      }
    }

    function activeLetter() {
      const ds = route.deliveries;
      for (let i = 0; i < ds.length; i++) if (ds[i].status === "pending") return ds[i];
      return null;
    }
    function missLetter(L) {
      if (L.status !== "pending") return;
      L.status = "missed";
      run.missed++; run.streak = 0;
      run.ledger.push("missed");
      run.landedSinceLetter = false;
      let why = "";
      if (L.type === "flythrough" && L.nearD < 160) {
        why = L.nearDy < 0 ? "  ·  flew " + Math.round(L.nearD) + " over the window" : "  ·  passed " + Math.round(L.nearD) + " under the window";
        hud.teach("flymiss", L.nearDy < 0 ? "Too high over the window. Let go a little earlier" : "Under the window. Let go a little later, higher in the swing");
      } else if (L.type === "roofbox" && player.anchor === L.next) {
        why = "  ·  the rooftop box was below your line";
        hud.teach("roofmiss", "To post into a rooftop box, let go early and drop onto its roof");
      }
      hud.toast("Letter for " + L.name + " returned" + why, "miss");
      audio.miss();
    }
    function shutterOpen(L, t) {
      if (!L.cycle) return 1;
      const ph = ((t / L.cycle.period) * TAU + L.cycle.phase) % TAU;
      const u = ph / TAU;
      // open for the first part of each cycle, with short eased transitions
      const o = L.cycle.open;
      if (u < o) return smooth(clamp(Math.min(u, o - u) / 0.06, 0, 1));
      return 0;
    }
    // Approach rules per receiver: hatches open to one side, roof boxes take
    // letters from above, balconies take any arrival, shutters only while open.
    function approachOk(L, vx, vy) {
      const sp = Math.hypot(vx, vy) || 1;
      if (L.type === "chute" || L.type === "shutter") return Math.sign(vx) === L.dir && Math.abs(vx) / sp > 0.62;
      if (L.type === "flythrough") return vx > 0;
      return true;
    }
    function deliver(L) {
      const e = L.entry;
      const precision = clamp(1 - L.minD / L.r, 0, 1);
      const clean = L.failedPasses === 0 && !run.landedSinceLetter;
      let perfect = false;
      if (clean && precision >= 0.5) {
        if (L.type === "chute" || L.type === "shutter") perfect = Math.abs(e.vy) / (Math.hypot(e.vx, e.vy) || 1) < 0.35;
        else if (L.type === "balcony") perfect = e.speed < 320;
        else if (L.type === "flythrough") perfect = precision >= 0.55;
      }
      if (clean && L.type === "roofbox") perfect = precision >= 0.6 && e.speed < 900;
      L.status = "delivered"; L.flash = 1;
      run.delivered++; run.streak++; run.bestStreak = Math.max(run.bestStreak, run.streak);
      if (clean) run.clean++;
      if (perfect) run.perfect++;
      const mult = Math.min(2.5, 1 + 0.15 * (run.streak - 1));
      const base = 100 + (clean ? 60 : 0) + (perfect ? 150 : 0);
      const pts = Math.round(base * mult * (1 + 0.1 * L.d));
      addScore(pts, "delivery");
      // a letter posted at a reeled length (the line shaped to reach it) also pays for the rope work
      const lineWork = L.reelNeed && run.reelOnAnchor >= 30 && player.anchor === L.D;
      if (lineWork) { addScore(40, "rope"); run.skilled++; }
      run.ledger.push(perfect ? "perfect" : clean ? "clean" : "delivered");
      hud.toast((perfect ? "Perfect delivery" : clean ? "Clean delivery" : "Delivered") + "  +" + pts + (lineWork ? "  ·  line work +40" : "") + (run.streak >= 3 ? "  ·  streak " + run.streak : ""), perfect ? "gold" : "plain");
      audio.deliver(perfect || clean);
      haptic("success");
      records.seenDeliver = true;
      run.landedSinceLetter = false;
      world && world.onDeliver(L, perfect);
      try { ctx.platform.interact({ type: "delivery" }); } catch (err) { /* ignore */ }
    }
    function trackDelivery() {
      const L = activeLetter();
      if (!L) return;
      if (L.type === "roofbox") {
        // the whole roof takes the letter; landing near the box itself is the precise post
        if (player.mode === "ground" && player.plat === L.plat) {
          L.minD = Math.min(L.r, Math.abs(player.x - L.x));
          L.entry = { vx: player.vx, vy: run.lastImpact || 0, speed: run.lastImpact || 0 };
          deliver(L);
        }
      } else if (player.mode !== "ground") {
        const dd = Math.hypot(player.x - L.x, player.y - L.y);
        if (L.type === "flythrough" && !player.anchor && run.prevAnchor === L.D && !(L.nearD < dd)) { L.nearD = dd; L.nearDy = player.y - L.y; }
        const open = shutterOpen(L, simTime) > 0.6;
        if (L.type === "flythrough" && player.anchor) {
          // a window takes letters only in flight; swinging through it just shows the rule
          if (dd < L.r && !L.swungThrough) { L.swungThrough = true; L.rattle = 1; hud.teach("flyrule", "Windows across a gap take letters in flight. Let go of the line to post it"); }
        } else if (dd < L.r) {
          if (!L.inZone) { L.inZone = true; L.minD = dd; L.entry = { vx: player.vx, vy: player.vy, speed: Math.hypot(player.vx, player.vy) }; }
          if (dd < L.minD) { L.minD = dd; L.entry = { vx: player.vx, vy: player.vy, speed: Math.hypot(player.vx, player.vy) }; }
          if (dd > L.prevD + 0.001) resolvePass(L, open);
        } else if (L.inZone) resolvePass(L, open);
        L.prevD = dd;
      }
      if (L.status === "pending" && player.x > L.x + 720 && player.mode !== "ground") missLetter(L);
    }
    function resolvePass(L, open) {
      L.inZone = false;
      if (open && approachOk(L, L.entry.vx, L.entry.vy)) { deliver(L); return; }
      L.failedPasses++;
      L.rattle = 1;
      audio.thud();
      if (!open) hud.teach("shutterclosed", "The shutters were closed. Watch their rhythm");
      else hud.teach("hatchside", "This hatch opens to the " + (L.dir > 0 ? "left. Swing through it moving right" : "right. Catch it on the backswing"));
    }

    function gameStep(dt) {
      stepCounter++;
      simTime += dt;
      for (const a of route.anchors) {
        if (a.kind === "laundry" && a !== player.anchor) a.load = 0;
        updateAnchorPos(a, dt);
        if (a.vib > 0) a.vib = Math.max(0, a.vib - dt * 1.5);
      }
      const pa = player.anchor;
      if (pa && pa.kind === "fragile" && player.mode !== "ground") {
        pa.hold += dt;
        if (pa.hold > pa.life) {
          pa.broken = true; pa.catchable = false;
          releaseLine(true);
          audio.snap(); haptic("warning");
        }
      }
      const vyBefore = player.vy;
      const W = { wind: worldWind, platforms: route.platforms, anchors: route.anchors, ev: onEvent };
      stepPlayer(player, dt, W);
      if (player.mode === "ground" && vyBefore > 0) run.lastImpact = vyBefore;
      if (player.anchor && player.Ldot) run.reelOnAnchor += Math.abs(player.Ldot) * dt;
      if (player.anchor && player.mode === "swing") {
        run.hangT += dt;
        if (run.hangT > 5 && player.Ldot < -40 && Math.abs(player.th) < 0.3) records.seenPump = true;
      } else run.hangT = 0;

      // near-miss bookkeeping: which ring did this flight pass closest to?
      if (!player.anchor && player.mode === "fly") {
        for (const a of route.anchors) {
          if (!a.catchable || a.broken || a === player.exclude || Math.abs(a.x - player.x) > 360) continue;
          if (a.y < player.y - 10) {
            const gap = Math.hypot(player.x - a.x, player.y - a.y) - a.reach;
            const prev = flightNear.get(a);
            if (prev === undefined || gap < prev.gap) flightNear.set(a, { gap, t: simTime });
            else if (prev.gap < 26 && prev.gap > 0 && gap > prev.gap + 30 && !prev.shown) { prev.shown = true; fx.nearMiss = { a, t: 0 }; }
          }
        }
      }
      trackDelivery();
      for (const rw of route.rewards) {
        if (rw.taken) continue;
        if (Math.abs(rw.x - player.x) < rw.r + 8 && Math.abs(rw.y - player.y) < rw.r + 8 && Math.hypot(rw.x - player.x, rw.y - player.y) < rw.r + 8) {
          rw.taken = true; run.airmail++;
          addScore(75, "airmail");
          hud.toast("Airmail stamp  +75", "gold");
          audio.airmail(); haptic("light");
        }
      }
      if (player.x > run.maxX) {
        run.maxX = player.x;
        const pts = Math.floor(run.maxX / 200);
        if (pts > run.distPts) { addScore(pts - run.distPts, "distance"); run.distPts = pts; }
      }
      for (const ds of route.districtStarts) {
        if (!ds.seen && player.x > ds.x) {
          ds.seen = true;
          if (ds.d > run.district) {
            run.district = ds.d;
            hud.district(DISTRICTS[ds.d].name);
            audio.district();
            try { ctx.platform.milestone("district_" + (ds.d + 1), { name: DISTRICTS[ds.d].name }); } catch (e) { /* ignore */ }
          }
        }
      }
      for (const h of Object.values(route.hints)) {
        if (h.onEntry && !h.shown) {
          const a = route.anchors.find(x => x.id === h.a);
          if (a && player.anchor === a) { h.shown = true; hud.teach(h.key, h.text); }
        }
      }
      if (player.y > FOG_Y - 30 && gameState === "play") {
        gameState = "dying"; run.dyingT = 0;
        let near = null, gap = 1e9;
        flightNear.forEach((g, a) => { if (g.gap < gap) { gap = g.gap; near = a; } });
        run.deathNear = near && gap < 45 ? { a: near, gap: Math.max(1, Math.round(gap)) } : null;
        if (near && gap < 45) fx.nearMiss = { a: near, t: 0 };
        audio.fall(); haptic("error");
      }
    }

    function releaseLine(forced) {
      const a = player.anchor;
      if (!a) return false;
      player.exclude = a;
      player.anchor = null;
      player.reelTarget = null;
      a.locked = false; a.load = 0; a.vib = 1;
      if (player.mode === "swing" || player.mode === "slack") player.mode = "fly";
      fx.retract = { x: a.x, y: a.y, t: 0 };
      run.lastRelease = { x: player.x, y: player.y };
      eventStep = stepCounter;
      flightNear.clear();
      if (!forced) { audio.release(); records.seenRelease = true; hud.learned("release"); }
      return true;
    }
    function hop(dir) {
      const a = player.anchor;
      if (a && player.mode === "ground") {
        const dx = player.x - a.x, dy = player.y - a.y, d = Math.hypot(dx, dy);
        if (d >= player.L - 6 && dy > 0) {
          // push off the roof with the legs while the line stays taut
          player.leftPlat = player.plat;
          player.L = clamp(d, LMIN, LMAX);
          player.mode = "swing"; player.plat = null; player.th = Math.atan2(dx, dy);
          player.om = (dir || 1) * KICK / player.L;
          player.x = a.x + player.L * Math.sin(player.th); player.y = a.y + player.L * Math.cos(player.th);
          eventStep = stepCounter;
          audio.hop();
          if (run.started) hud.learned("pushoff");
          return;
        }
      }
      player.leftPlat = null;
      player.vy = HOP_VY;
      player.vx = (dir || 1) * HOP_VX + player.vx * 0.3;
      player.mode = player.anchor ? "slack" : "fly";
      player.plat = null;
      eventStep = stepCounter;
      audio.hop();
      if (run.started) hud.learned("pushoff");
    }
    function snapshot() {
      return { x: player.x, y: player.y, vx: player.vx, vy: player.vy, mode: player.mode, th: player.th, om: player.om, L: player.L, anchor: player.anchor, step: stepCounter, ev: eventStep };
    }
    // A tap is confirmed on pointer-up but applied from the pointer-down state,
    // so timing feels exact; only when nothing discrete happened in between.
    function releaseFromSnapshot(sn) {
      const elapsed = stepCounter - sn.step;
      if (!sn || sn.anchor !== player.anchor || sn.ev !== eventStep || sn.mode !== "swing" || player.mode !== "swing" || elapsed <= 0 || elapsed > 36) return releaseLine(false);
      const ox = player.x, oy = player.y;
      player.x = sn.x; player.y = sn.y; player.vx = sn.vx; player.vy = sn.vy; player.th = sn.th; player.om = sn.om; player.L = sn.L;
      releaseLine(false);
      const W = { wind: worldWind, platforms: route.platforms, anchors: route.anchors, ev: onEvent };
      for (let i = 0; i < elapsed * SUBSTEPS && player.mode === "fly"; i++) stepPlayer(player, DT, W);
      fx.renderOff = { x: ox - player.x, y: oy - player.y };
      return true;
    }
    // =====================================================================
    // 9. AUDIO — small synthesized palette (no external files)
    // =====================================================================
    const audio = (() => {
      let ac = null, master = null, windG = null, windF = null, ok = false, noiseBuf = null;
      const permitted = !ctx.capabilities || ctx.capabilities.audio !== false;
      function init() {
        if (ac || !permitted) return;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          master = ac.createGain(); master.gain.value = records.muted ? 0 : 0.8; master.connect(ac.destination);
          noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const ch = noiseBuf.getChannelData(0);
          for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
          const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
          windF = ac.createBiquadFilter(); windF.type = "bandpass"; windF.frequency.value = 500; windF.Q.value = 0.7;
          windG = ac.createGain(); windG.gain.value = 0;
          src.connect(windF); windF.connect(windG); windG.connect(master); src.start();
          ok = true;
        } catch (e) { ok = false; }
      }
      function resume() { if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) { /* ignore */ } } }
      function env(g, t0, a, peak, d) {
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
      }
      function tone(freq, type, peak, a, d, when, glide) {
        if (!ok) return;
        const t0 = ac.currentTime + (when || 0);
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t0);
        if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + a + d);
        env(g, t0, a, peak, d);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + a + d + 0.05);
      }
      function noise(peak, a, d, ftype, freq, q, when, freqEnd) {
        if (!ok) return;
        const t0 = ac.currentTime + (when || 0);
        const s = ac.createBufferSource(); s.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(freq, t0); f.Q.value = q || 1;
        if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + a + d);
        const g = ac.createGain(); env(g, t0, a, peak, d);
        s.connect(f); f.connect(g); g.connect(master);
        s.start(t0, Math.random() * 1.5); s.stop(t0 + a + d + 0.05);
      }
      return {
        unlock() { init(); resume(); },
        setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
        suspend() { if (ac && ac.state === "running") { try { ac.suspend(); } catch (e) { /* ignore */ } } },
        resume,
        wind(speed, attached) {
          if (!ok) return;
          const v = clamp((speed - 180) / 700, 0, 1);
          windG.gain.setTargetAtTime(v * v * 0.09, ac.currentTime, 0.12);
          windF.frequency.setTargetAtTime(380 + v * 900, ac.currentTime, 0.15);
        },
        release(sp) { noise(0.08, 0.01, 0.16, "highpass", 1400, 0.7, 0, 3200); tone(520, "triangle", 0.02, 0.005, 0.06); },
        catchSfx(q, kind) {
          const base = kind === "laundry" ? 900 : kind === "pulley" ? 1500 : 1900;
          tone(base, "sine", 0.06 * (0.6 + q * 0.4), 0.002, 0.18);
          tone(base * 1.48, "sine", 0.035 * q, 0.002, 0.12);
          noise(0.05, 0.001, 0.04, "bandpass", 3000, 2);
          tone(140, "triangle", 0.05, 0.003, 0.09, 0, 80);
        },
        creak(v) { tone(90 + Math.random() * 20, "sawtooth", 0.025 * v, 0.01, 0.16, 0, 70); },
        land(v) { noise(0.06 * v + 0.02, 0.002, 0.09, "lowpass", 600, 0.7); tone(110, "sine", 0.05 * v, 0.003, 0.08); },
        hop() { noise(0.03, 0.005, 0.08, "bandpass", 900, 1); },
        deliver(gold) {
          noise(0.06, 0.004, 0.12, "bandpass", 1800, 1.2);
          tone(880, "sine", 0.06, 0.004, 0.6, 0.06);
          tone(1320, "sine", 0.035, 0.004, 0.5, 0.1);
          if (gold) tone(1760, "sine", 0.03, 0.004, 0.55, 0.18);
          tone(160, "triangle", 0.07, 0.002, 0.12, 0.3, 90);
        },
        airmail() { tone(1568, "sine", 0.04, 0.003, 0.22); tone(2093, "sine", 0.03, 0.003, 0.25, 0.07); },
        miss() { tone(330, "triangle", 0.035, 0.01, 0.3, 0, 260); },
        snap() { noise(0.12, 0.001, 0.12, "highpass", 2400, 0.8); tone(220, "sawtooth", 0.03, 0.002, 0.1, 0, 90); },
        fall() { noise(0.09, 0.05, 1.1, "lowpass", 2200, 0.8, 0, 160); },
        district() { tone(196, "sine", 0.05, 0.05, 1.6); tone(294, "sine", 0.035, 0.05, 1.5, 0.08); tone(392, "sine", 0.025, 0.05, 1.4, 0.16); },
        reelTick() { tone(2400 + Math.random() * 300, "square", 0.006, 0.001, 0.02); },
        thud() { noise(0.05, 0.002, 0.1, "lowpass", 500, 0.8); tone(95, "triangle", 0.04, 0.003, 0.1); },
        stamp() { noise(0.06, 0.001, 0.07, "lowpass", 900, 0.8); }
      };
    })();
    let musicOn = false;
    function startMusic() {
      if (musicOn || records.muted || !ctx.music || !ctx.music.play) return;
      try {
        if (ctx.music.unlock) ctx.music.unlock();
        ctx.music.play({ preset: "ambient", volume: 0.16, tempo: 64, intensity: 0.2, density: 0.25, scale: "dorian", fadeInMs: 2500 });
        musicOn = true;
      } catch (e) { musicOn = false; }
    }
    function setMuted(m) {
      records.muted = m; saveRecords();
      audio.setMuted(m);
      try {
        if (m && ctx.music && ctx.music.stop) { ctx.music.stop({ fadeOutMs: 300 }); musicOn = false; }
        else if (!m) startMusic();
      } catch (e) { /* ignore */ }
    }
    function haptic(kind) { try { if (ctx.platform.haptic) ctx.platform.haptic(kind); } catch (e) { /* ignore */ } }


    // =====================================================================
    // 10. THE CITY IN 3D — three.js scene around a fixed gameplay plane (z = 0).
    // World x maps to X, world y (down) maps to -Y, depth is Z (+ toward camera).
    // =====================================================================
    function createWorld(THREE) {
      const glCanvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
      const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x8fa39a, 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 40, 9000);
      const FOV_T = Math.tan((30 * Math.PI) / 360);
      let camD = 2400, pixelRatio = Math.min(2, ctx.dpr || 1);
      const fog = new THREE.Fog(0x7f938b, 2300, 5800);
      scene.fog = fog;
      const C = hex => new THREE.Color(hex);

      // ---- sky ----
      const skyCv = makeCanvas(4, 256), skyG = skyCv.getContext("2d");
      const skyTex = new THREE.CanvasTexture(skyCv); skyTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = skyTex;
      function paintSky(top, mid, bot) {
        const gr = skyG.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot);
        skyG.fillStyle = gr; skyG.fillRect(0, 0, 4, 256); skyTex.needsUpdate = true;
      }

      // ---- light: one directional sun (shadows), hemisphere fill ----
      const hemi = new THREE.HemisphereLight(0xc9d3c8, 0x3d4842, 1.0);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffe0b8, 1.9);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera; sc.left = -1100; sc.right = 1100; sc.top = 1100; sc.bottom = -1100; sc.near = 10; sc.far = 3600;
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.5;
      scene.add(sun); scene.add(sun.target);
      const recvLight = new THREE.PointLight(0xffc27a, 0, 260, 1.6);
      scene.add(recvLight);

      // ---- procedural material textures (painted once) ----
      function tex(size, paint) {
        const cv = makeCanvas(size, size), g2 = cv.getContext("2d");
        paint(g2, size, mulberry32(size * 7 + paint.length));
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        return t;
      }
      const speck = (g2, s, rng, n, a, light) => {
        for (let i = 0; i < n; i++) {
          const v = light ? 255 : 0;
          g2.fillStyle = "rgba(" + v + "," + v + "," + v + "," + (a * rng()) + ")";
          g2.fillRect(rng() * s, rng() * s, 1 + rng() * 6, 1 + rng() * 3);
        }
      };
      const T = {
        plaster: tex(256, (g2, s, rng) => {
          g2.fillStyle = "#d8d2c4"; g2.fillRect(0, 0, s, s);
          for (let i = 0; i < 90; i++) { g2.fillStyle = "rgba(" + (150 + rng() * 60 | 0) + "," + (140 + rng() * 50 | 0) + "," + (120 + rng() * 40 | 0) + ",0.18)"; g2.beginPath(); g2.ellipse(rng() * s, rng() * s, 8 + rng() * 40, 6 + rng() * 22, rng() * 3, 0, TAU); g2.fill(); }
          for (let i = 0; i < 26; i++) { const x = rng() * s, y = rng() * s * 0.7, l = 20 + rng() * 90; const gr = g2.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, "rgba(60,52,40,0.22)"); gr.addColorStop(1, "rgba(60,52,40,0)"); g2.fillStyle = gr; g2.fillRect(x, y, 1 + rng() * 3, l); }
          speck(g2, s, rng, 500, 0.12, false);
        }),
        timber: tex(256, (g2, s, rng) => {
          g2.fillStyle = "#9c8a76"; g2.fillRect(0, 0, s, s);
          let y = 0;
          while (y < s) { const h = 10 + rng() * 9; g2.fillStyle = "rgb(" + (128 + rng() * 38 | 0) + "," + (112 + rng() * 32 | 0) + "," + (94 + rng() * 26 | 0) + ")"; g2.fillRect(0, y, s, h - 1.5); g2.fillStyle = "rgba(40,28,18,0.6)"; g2.fillRect(0, y + h - 1.5, s, 1.5); for (let k = 0; k < 3; k++) { g2.fillStyle = "rgba(40,28,18,0.35)"; g2.fillRect(rng() * s, y, 1.2, h - 1.5); } y += h; }
          for (let i = 0; i < 400; i++) { g2.fillStyle = "rgba(50,35,20," + 0.12 * rng() + ")"; g2.fillRect(rng() * s, rng() * s, 6 + rng() * 30, 1); }
        }),
        metal: tex(128, (g2, s, rng) => {
          for (let x = 0; x < s; x++) { const v = 0.55 + 0.45 * Math.sin((x / s) * TAU * 8); g2.fillStyle = "rgb(" + (120 + v * 50 | 0) + "," + (122 + v * 48 | 0) + "," + (118 + v * 44 | 0) + ")"; g2.fillRect(x, 0, 1, s); }
          for (let i = 0; i < 26; i++) { g2.fillStyle = "rgba(" + (120 + rng() * 30 | 0) + "," + (86 + rng() * 20 | 0) + ",62," + (0.12 + rng() * 0.16) + ")"; g2.beginPath(); g2.ellipse(rng() * s, rng() * s, 4 + rng() * 20, 6 + rng() * 26, 0, 0, TAU); g2.fill(); }
          speck(g2, s, rng, 200, 0.2, false);
        }),
        masonry: tex(256, (g2, s, rng) => {
          g2.fillStyle = "#6d675d"; g2.fillRect(0, 0, s, s);
          const bh = 16;
          for (let r = 0; r < s / bh; r++) { const off = (r % 2) * 20; for (let x = -40 + off; x < s; x += 40) { g2.fillStyle = "rgb(" + (150 + rng() * 40 | 0) + "," + (142 + rng() * 34 | 0) + "," + (126 + rng() * 30 | 0) + ")"; g2.fillRect(x + 1.5, r * bh + 1.5, 37, bh - 3); } }
          speck(g2, s, rng, 700, 0.14, false);
          for (let i = 0; i < 14; i++) { const x = rng() * s, gr = g2.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, "rgba(40,50,45,0.25)"); gr.addColorStop(1, "rgba(40,50,45,0)"); g2.fillStyle = gr; g2.fillRect(x, 0, 2 + rng() * 6, s * rng()); }
        }),
        cloth: tex(64, (g2, s, rng) => { g2.fillStyle = "#e8e2d4"; g2.fillRect(0, 0, s, s); speck(g2, s, rng, 120, 0.08, false); })
      };
      const M = {
        plaster: new THREE.MeshLambertMaterial({ map: T.plaster, vertexColors: true }),
        timber: new THREE.MeshLambertMaterial({ map: T.timber, vertexColors: true }),
        metal: new THREE.MeshLambertMaterial({ map: T.metal, vertexColors: true }),
        masonry: new THREE.MeshLambertMaterial({ map: T.masonry, vertexColors: true }),
        beam: new THREE.MeshLambertMaterial({ vertexColors: true }),
        under: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
        glass: new THREE.MeshLambertMaterial({ color: 0x1f2a2a }),
        warm: new THREE.MeshBasicMaterial({ color: 0xf0a85c, toneMapped: false }),
        cloth: new THREE.MeshLambertMaterial({ map: T.cloth, vertexColors: true, side: THREE.DoubleSide }),
        steel: new THREE.MeshLambertMaterial({ color: 0x2b2e2d }),
        cable: new THREE.MeshLambertMaterial({ color: 0x1e2120 }),
        wire: new THREE.MeshLambertMaterial({ color: 0x262a28 }),
        rope: new THREE.MeshLambertMaterial({ color: 0x3a312a }),
        laundry: new THREE.MeshLambertMaterial({ color: 0xbdb39c }),
        far: new THREE.MeshLambertMaterial({ vertexColors: false }),
        farWin: new THREE.MeshBasicMaterial({ color: 0xe9a35c, toneMapped: false })
      };
      const TILE = { plaster: 140, timber: 90, metal: 46, masonry: 120 };

      // ---- geometry batching: one merged mesh per material per cluster ----
      const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _col = new THREE.Color();
      function Batch() { this.m = new Map(); }
      Batch.prototype.get = function (mat) {
        let b = this.m.get(mat);
        if (!b) { b = { p: [], n: [], u: [], c: [] }; this.m.set(mat, b); }
        return b;
      };
      function pushQuad(B, mat, a, b, c, d, col, uvs) {
        // a,b,c,d counter-clockwise as seen from the front; arrays [x,y,z]
        const t = B.get(mat);
        _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        _n.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
        const nx = _v.y * _n.z - _v.z * _n.y, ny = _v.z * _n.x - _v.x * _n.z, nz = _v.x * _n.y - _v.y * _n.x;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const P = [a, b, c, a, c, d], U = uvs ? [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]] : null;
        _col.set(col);
        for (let i = 0; i < 6; i++) {
          t.p.push(P[i][0], P[i][1], P[i][2]); t.n.push(nx / nl, ny / nl, nz / nl);
          if (U) t.u.push(U[i][0], U[i][1]); else t.u.push(0, 0);
          t.c.push(_col.r, _col.g, _col.b);
        }
      }
      function pushTri(B, mat, a, b, c, col) {
        const t = B.get(mat);
        _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _n.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        const nx = _v.y * _n.z - _v.z * _n.y, ny = _v.z * _n.x - _v.x * _n.z, nz = _v.x * _n.y - _v.y * _n.x, nl = Math.hypot(nx, ny, nz) || 1;
        _col.set(col);
        for (const P of [a, b, c]) { t.p.push(P[0], P[1], P[2]); t.n.push(nx / nl, ny / nl, nz / nl); t.u.push(P[0] / 100, P[1] / 100); t.c.push(_col.r, _col.g, _col.b); }
      }
      // axis-aligned box in WORLD terms: x0..x1, top..bottom (y down), z0..z1
      function box(B, mat, x0, x1, top, bot, z0, z1, col, tile, skip) {
        const Y0 = -bot, Y1 = -top, tl = tile || TILE[mat === M.timber ? "timber" : mat === M.metal ? "metal" : mat === M.masonry ? "masonry" : "plaster"] || 100;
        const ou = (x0 * 0.37 + z0 * 0.61) / tl, ov = (top * 0.23) / tl;
        const uv = (w, h) => [[ou, ov], [ou + w / tl, ov], [ou + w / tl, ov + h / tl], [ou, ov + h / tl]];
        const w = x1 - x0, h = bot - top, d = z1 - z0;
        if (!skip || !skip.f) pushQuad(B, mat, [x0, Y0, z1], [x1, Y0, z1], [x1, Y1, z1], [x0, Y1, z1], col, uv(w, h));        // front
        if (!skip || !skip.b) pushQuad(B, mat, [x1, Y0, z0], [x0, Y0, z0], [x0, Y1, z0], [x1, Y1, z0], col, uv(w, h));        // back
        pushQuad(B, mat, [x0, Y0, z0], [x0, Y0, z1], [x0, Y1, z1], [x0, Y1, z0], col, uv(d, h));                              // left
        pushQuad(B, mat, [x1, Y0, z1], [x1, Y0, z0], [x1, Y1, z0], [x1, Y1, z1], col, uv(d, h));                              // right
        if (!skip || !skip.t) pushQuad(B, mat, [x0, Y1, z1], [x1, Y1, z1], [x1, Y1, z0], [x0, Y1, z0], col, uv(w, d));        // top
        if (!skip || !skip.u) pushQuad(B, mat, [x0, Y0, z0], [x1, Y0, z0], [x1, Y0, z1], [x0, Y0, z1], col, uv(w, d));        // underside
      }
      // a beam between two world points (square section), for braces, stilts, lattice members
      const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
      const unitBox = []; // 36 verts of a unit box centred, y in [0,1]
      (function () {
        const f = [[[-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]], [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5]], [[-.5, 0, -.5], [-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5]], [[.5, 0, .5], [.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5]]];
        for (const q of f) unitBox.push(q);
      })();
      function beam(B, mat, ax, ay, az, bx, by, bz, t, col) {
        const A = new THREE.Vector3(ax, -ay, az), Bv = new THREE.Vector3(bx, -by, bz);
        _dir.subVectors(Bv, A); const len = _dir.length(); if (len < 0.01) return;
        _q.setFromUnitVectors(_up, _dir.normalize());
        _m4.compose(A, _q, new THREE.Vector3(t, len, t));
        for (const q of unitBox) {
          const pts = q.map(p => { const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(_m4); return [v.x, v.y, v.z]; });
          pushQuad(B, mat, pts[0], pts[1], pts[2], pts[3], col, null);
        }
      }
      function gable(B, wallMat, roofMat, x0, x1, eave, z0, z1, ridgeH, ov, wallCol, roofCol, alongX) {
        const Ye = -eave, Yr = -eave + ridgeH;
        if (alongX) {
          const zm = (z0 + z1) / 2;
          pushQuad(B, roofMat, [x0 - ov, Ye - 2, z1 + ov], [x1 + ov, Ye - 2, z1 + ov], [x1 + ov, Yr, zm], [x0 - ov, Yr, zm], roofCol, [[0, 0], [(x1 - x0) / 46, 0], [(x1 - x0) / 46, 1.4], [0, 1.4]]);
          pushQuad(B, roofMat, [x1 + ov, Ye - 2, z0 - ov], [x0 - ov, Ye - 2, z0 - ov], [x0 - ov, Yr, zm], [x1 + ov, Yr, zm], roofCol, [[0, 0], [(x1 - x0) / 46, 0], [(x1 - x0) / 46, 1.4], [0, 1.4]]);
          const und = darker(roofCol, 0.45);
          pushQuad(B, M.under, [x0 - ov, Ye - 2.6, z1 + ov], [x0 - ov, Yr - 0.6, zm], [x1 + ov, Yr - 0.6, zm], [x1 + ov, Ye - 2.6, z1 + ov], und, null);
          pushTri(B, wallMat, [x0, Ye, z1], [x0, Yr - 1, zm], [x0, Ye, z0], wallCol);
          pushTri(B, wallMat, [x1, Ye, z0], [x1, Yr - 1, zm], [x1, Ye, z1], wallCol);
        } else {
          const xm = (x0 + x1) / 2;
          pushQuad(B, roofMat, [x0 - ov, Ye - 2, z0 - ov], [x0 - ov, Ye - 2, z1 + ov], [xm, Yr, z1 + ov], [xm, Yr, z0 - ov], roofCol, [[0, 0], [(z1 - z0) / 46, 0], [(z1 - z0) / 46, 1.4], [0, 1.4]]);
          pushQuad(B, roofMat, [x1 + ov, Ye - 2, z1 + ov], [x1 + ov, Ye - 2, z0 - ov], [xm, Yr, z0 - ov], [xm, Yr, z1 + ov], roofCol, [[0, 0], [(z1 - z0) / 46, 0], [(z1 - z0) / 46, 1.4], [0, 1.4]]);
          const und = darker(roofCol, 0.45);
          pushQuad(B, M.under, [x0 - ov, Ye - 2.6, z1 + ov], [xm, Yr - 0.6, z1 + ov], [x1 + ov, Ye - 2.6, z1 + ov], [x1 + ov, Ye - 2.6, z1 + ov], und, null);
          pushTri(B, wallMat, [x0, Ye, z1], [x1, Ye, z1], [xm, Yr - 1, z1], wallCol);
          pushTri(B, wallMat, [x1, Ye, z0], [x0, Ye, z0], [xm, Yr - 1, z0], wallCol);
        }
      }
      function darker(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); }
      function tint(rng, hex, amt) { const c = new THREE.Color(hex); const j = 1 + (rng() - 0.5) * amt; c.multiplyScalar(j); c.offsetHSL((rng() - 0.5) * 0.02, 0, 0); return c.getHex(); }
      function windowAt(B, rng, cx, top, w, h, zF, lit, frameCol) {
        // glass set back behind a protruding frame, so it reads as inset in the wall
        box(B, lit ? M.warm : M.glass, cx - w / 2, cx + w / 2, top, top + h, zF - 0.6, zF + 0.4, 0xffffff);
        const f = 1.6, p = 2.2;
        box(B, M.beam, cx - w / 2 - f, cx + w / 2 + f, top - f, top, zF, zF + p, frameCol);          // lintel
        box(B, M.beam, cx - w / 2 - f - 1, cx + w / 2 + f + 1, top + h, top + h + f, zF, zF + p + 1.2, frameCol); // sill
        box(B, M.beam, cx - w / 2 - f, cx - w / 2, top, top + h, zF, zF + p, frameCol);
        box(B, M.beam, cx + w / 2, cx + w / 2 + f, top, top + h, zF, zF + p, frameCol);
        if (w > 12) box(B, M.beam, cx - 0.6, cx + 0.6, top, top + h, zF, zF + 1.2, frameCol);
        if (lit) lampSpots.push({ x: cx, y: top + h / 2, z: zF + 2 });
      }
      let lampSpots = [];

      // ---- the architecture library ----
      const PAL = {
        colony: { walls: [[M.timber, 0xb3a28c], [M.plaster, 0xcbc4b2], [M.timber, 0x9a8a76], [M.plaster, 0xb5b3a3], [M.metal, 0x9a9a8f]], roof: [0x6f5c4e, 0x667069, 0x7a5f4c, 0x5a6562], beam: 0x3a3029, core: [M.masonry, 0xa39e93], frame: 0x352d27 },
        market: { walls: [[M.plaster, 0xc4b9a2], [M.timber, 0xa08e78], [M.plaster, 0xa8a896], [M.metal, 0x8f8f85], [M.plaster, 0xb39a85]], roof: [0x7a5a48, 0x5b6865, 0x766a5a, 0x4e5c5a], beam: 0x332b25, core: [M.masonry, 0x99948a], frame: 0x2e2722 },
        lift: { walls: [[M.metal, 0x8e8a80], [M.metal, 0x8a6a55], [M.timber, 0x8d7258], [M.plaster, 0xa8a697]], roof: [0x5b5f5c, 0x7a5442, 0x4b5352], beam: 0x2c2826, core: [M.masonry, 0x86817a], frame: 0x2a2624 },
        spine: { walls: [[M.masonry, 0xb2a792], [M.plaster, 0xc2b69c], [M.timber, 0x9a7b5a], [M.masonry, 0x9d927e]], roof: [0x6e5640, 0x5a5f58, 0x7d6448], beam: 0x30281f, core: [M.masonry, 0xa89c86], frame: 0x2e261f },
        stacks: { walls: [[M.plaster, 0xc8c6bb], [M.timber, 0xa58b70], [M.metal, 0x9c9a90], [M.plaster, 0xb0b8b0]], roof: [0x6c7672, 0x8b5d45, 0x5c6764], beam: 0x332c26, core: [M.masonry, 0x9ea19a], frame: 0x2d2824 }
      };
      function room(B, rng, pal, x0, x1, top, bot, z0, z1, opts) {
        const wall = pick(rng, pal.walls);
        const col = tint(rng, wall[1], 0.16);
        box(B, wall[0], x0, x1, top, bot, z0, z1, col);
        // base band where floor meets wall
        box(B, M.beam, x0 - 1, x1 + 1, bot - 3, bot, z0, z1 + 1.2, pal.beam);
        const w = x1 - x0, h = bot - top;
        const nW = Math.max(1, Math.round(w / 58));
        for (let i = 0; i < nW; i++) {
          if (rng() < 0.3) continue;
          const ww = rr(rng, 9, 15), wh = Math.min(h - 18, rr(rng, 14, 22));
          if (wh < 8) continue;
          const cx = x0 + (w / nW) * (i + 0.5) + rr(rng, -4, 4);
          windowAt(B, rng, cx, top + rr(rng, 9, Math.max(10, h - wh - 10)), ww, wh, z1, rng() < (opts.lit || 0.14), pal.frame);
        }
        // the roof: gable, shed or flat with a parapet
        if (opts.roof) {
          const kind = opts.roofKind || (rng() < 0.55 ? "gable" : rng() < 0.6 ? "shed" : "flat");
          const rc = tint(rng, pick(rng, pal.roof), 0.18);
          if (kind === "gable") gable(B, wall[0], M.metal, x0, x1, top, z0, z1, rr(rng, 12, 24), rr(rng, 3, 7), col, rc, rng() < 0.5);
          else if (kind === "shed") {
            const ov = rr(rng, 3, 7), hi = rr(rng, 8, 16);
            pushQuad(B, M.metal, [x0 - ov, -top + 1, z1 + ov], [x1 + ov, -top + 1, z1 + ov], [x1 + ov, -top + hi, z0 - ov], [x0 - ov, -top + hi, z0 - ov], rc, [[0, 0], [w / 46, 0], [w / 46, 1.2], [0, 1.2]]);
            pushQuad(B, M.under, [x0 - ov, -top + 0.4, z1 + ov], [x0 - ov, -top + hi - 0.6, z0 - ov], [x1 + ov, -top + hi - 0.6, z0 - ov], [x1 + ov, -top + 0.4, z1 + ov], darker(rc, 0.45), null);
            box(B, wall[0], x0, x1, top - hi + 1, top, z0, z0 + 2, col);
          } else {
            box(B, M.beam, x0 - 1.5, x1 + 1.5, top - 4, top, z0 - 1.5, z1 + 1.5, darker(col, 0.7));
            if (rng() < 0.5) { const tx = rr(rng, x0 + 6, x1 - 22); box(B, M.timber, tx, tx + 18, top - 26, top - 4, z0 + 6, z0 + 24, 0x7d6650); beam(B, M.beam, tx + 2, top - 4, z0 + 8, tx + 2, top, z0 + 8, 1.5, pal.beam); }
          }
          if (rng() < 0.45) { const cx = rr(rng, x0 + 6, x1 - 8); box(B, M.masonry, cx, cx + 7, top - rr(rng, 22, 34), top + 2, z0 + 6, z0 + 13, 0x7b7168); opts.chimneys && opts.chimneys.push({ x: cx + 3.5, y: top - 34, z: z0 + 9.5 }); }
        }
        if (opts.balcony) {
          const bw = Math.min(w - 8, rr(rng, 26, 44)), bx = x0 + rr(rng, 4, Math.max(5, w - bw - 4)), by = bot - rr(rng, 2, 6), bd = rr(rng, 12, 18);
          box(B, M.timber, bx, bx + bw, by, by + 3, z1, z1 + bd, 0x8a6e52);
          for (let k = 0; k <= bw; k += 6) beam(B, M.beam, bx + k, by, z1 + bd - 1, bx + k, by - 11, z1 + bd - 1, 1, pal.beam);
          box(B, M.beam, bx, bx + bw, by - 12, by - 11, z1 + bd - 1.6, z1 + bd - 0.4, pal.beam);
          beam(B, M.beam, bx + 2, by + 3, z1 + bd - 2, bx + 2, by + 16, z1 + 1, 1.6, pal.beam);
          beam(B, M.beam, bx + bw - 2, by + 3, z1 + bd - 2, bx + bw - 2, by + 16, z1 + 1, 1.6, pal.beam);
          if (rng() < 0.6) for (let k = 0; k < 3; k++) { const px = bx + rr(rng, 4, bw - 4); box(B, M.beam, px - 2.5, px + 2.5, by - 5, by, z1 + 3, z1 + 8, 0x6e4a33); box(B, M.cloth, px - 4, px + 4, by - 12, by - 5, z1 + 2, z1 + 9, tint(rng, 0x5f7a46, 0.3)); }
        }
      }
      // A cluster: a load-bearing core with dwellings bolted on over generations.
      function buildCluster(cl) {
        const rng = mulberry32(cl.seed);
        const pal = PAL[cl.style] || PAL.colony;
        const B = new Batch();
        lampSpots = [];
        const chimneys = [];
        const zF = cl.z + cl.dz / 2, zB = cl.z - cl.dz / 2;
        const bottom = FOG_Y + 260;
        const mid = cl.role === "mid";
        if (cl.role === "deck" || cl.role === "post" || cl.role === "roofhost") {
          const pl = cl.plat;
          const x0 = pl.x0 - 6, x1 = pl.x1 + 6, y = pl.y;
          // the deck the courier can stand on: a slab cantilevered to the plane
          box(B, M.timber, x0, x1, y, y + 6, -58, 14, 0x9c7c5c, 70);
          for (let x = x0 + 8; x < x1 - 4; x += 26) beam(B, M.beam, x, y + 6, 10, x + (x < (x0 + x1) / 2 ? 14 : -14), y + 40, -30, 2.2, pal.beam);
          box(B, M.beam, x0, x1, y + 6, y + 9, 10, 14, pal.beam);
          const body = pick(rng, pal.walls);
          box(B, body[0], x0 + 6, x1 - 6, y + 9, bottom, -120, -34, tint(rng, body[1], 0.15));
          let yy = y + 9 + rr(rng, 40, 70);
          while (yy < FOG_Y) { const h = rr(rng, 50, 80); const ox = rr(rng, -16, 16); room(B, rng, pal, x0 + 4 + ox, x1 - 4 + ox, yy, yy + h, -110, -28 + rr(rng, 0, 14), { roof: false, lit: 0.12, balcony: rng() < 0.25 }); yy += h + rr(rng, 0, 10); }
          // a hut on the back of the deck
          const hw = Math.min(x1 - x0 - 20, rr(rng, 50, 80)), hx = rng() < 0.5 ? x0 + 6 : x1 - 6 - hw;
          room(B, rng, pal, hx, hx + hw, y - rr(rng, 44, 62), y, -110, -40, { roof: true, lit: 0.4, chimneys });
          if (cl.role === "post") {
            // the post office: the only place in the city with a painted sign
            signs.push({ kind: "post", x: (hx + hx + hw) / 2, y: y - 26, z: -39 });
          }
          if (cl.role === "roofhost" && cl.recv) {
            const L = cl.recv;
            box(B, M.metal, L.x - 7, L.x + 7, y - 20, y, -6, 6, 0x8a4a35, 30);
            box(B, M.beam, L.x - 8, L.x + 8, y - 22, y - 20, -7, 7, 0x3a2a22);
            box(B, M.glass, L.x - 4, L.x + 4, y - 16, y - 14, 5.8, 6.4, 0x101010);
          }
        } else if (cl.role === "clock") {
          // masonry spine carrying a clock face; the hand is the live anchor arm
          const x0 = cl.x - cl.w / 2, x1 = cl.x + cl.w / 2;
          box(B, M.masonry, x0, x1, cl.top, bottom, zB, zF, tint(rng, 0xa89c86, 0.1), 120);
          box(B, M.masonry, x0 - 8, x0 + 4, cl.top + 30, bottom, zF - 14, zF + 6, 0x8f8574, 120);
          box(B, M.masonry, x1 - 4, x1 + 8, cl.top + 30, bottom, zF - 14, zF + 6, 0x8f8574, 120);
          gable(B, M.masonry, M.metal, x0 - 4, x1 + 4, cl.top, zB - 4, zF + 4, 70, 6, 0xa89c86, 0x5d5a50, false);
          for (let y = cl.top + 50; y < FOG_Y - 40; y += rr(rng, 70, 110)) if (Math.abs(y - cl.hub.y) > cl.hub.R + 50) windowAt(B, rng, cl.x + rr(rng, -cl.w * 0.25, cl.w * 0.25), y, 12, 26, zF, rng() < 0.2, pal.frame);
          clockFaces.push({ x: cl.hub.x, y: cl.hub.y, z: zF + 0.5, R: cl.hub.R + 22 });
        } else if ((cl.style === "lift" && cl.role === "support" && rng() < 0.65)) {
          // utility lattice tower with a workshop hung off it
          const w = Math.min(cl.w, 70), x0 = cl.x - w / 2, x1 = cl.x + w / 2, z0 = cl.z - 26, z1 = cl.z + 26;
          const col = tint(rng, 0x5b4636, 0.2);
          for (const [lx, lz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) beam(B, M.beam, lx, cl.top, lz, lx + (lx < cl.x ? -14 : 14), bottom, lz + (lz < cl.z ? -10 : 10), 3.2, col);
          for (let y = cl.top + 10; y < FOG_Y; y += 34) {
            const s = (y - cl.top) / (bottom - cl.top);
            const a = x0 - 14 * s, b = x1 + 14 * s, za = z0 - 10 * s, zb = z1 + 10 * s;
            beam(B, M.beam, a, y, zb, b, y, zb, 1.6, col); beam(B, M.beam, a, y, za, b, y, za, 1.6, col);
            beam(B, M.beam, a, y, za, a, y, zb, 1.6, col); beam(B, M.beam, b, y, za, b, y, zb, 1.6, col);
            beam(B, M.beam, a, y, zb, b, y + 34, zb, 1.1, col); beam(B, M.beam, b, y, zb, a, y + 34, zb, 1.1, col);
          }
          box(B, M.beam, x0 - 6, x1 + 6, cl.top - 4, cl.top + 2, z0 - 6, z1 + 6, 0x3a302a);
          const wy = cl.top + rr(rng, 60, 160);
          room(B, rng, pal, x0 - 26, x1 + 26, wy, wy + rr(rng, 40, 56), z0 - 4, z1 + 16, { roof: true, roofKind: "shed", lit: 0.5 });
          cl.top -= 0;
        } else {
          // stacked dwellings around a load-bearing core
          const coreW = cl.w * rr(rng, 0.55, 0.75);
          const cx = cl.x + rr(rng, -cl.w * 0.1, cl.w * 0.1);
          const core = pal.core;
          const tall = cl.style === "stacks" || cl.style === "spine";
          box(B, core[0], cx - coreW / 2, cx + coreW / 2, cl.top + (tall ? 0 : 20), bottom, zB, zF - 10, tint(rng, core[1], 0.12));
          if (cl.style === "spine") gable(B, core[0], M.metal, cx - coreW / 2, cx + coreW / 2, cl.top, zB, zF - 10, rr(rng, 40, 70), 4, core[1], 0x5a5850, false);
          let y = cl.top;
          let side = rng() < 0.5 ? -1 : 1;
          let first = true;
          while (y < FOG_Y - 20) {
            const h = rr(rng, 44, 76);
            const rw = rr(rng, 40, cl.style === "stacks" ? 80 : 96);
            const proj = cl.style === "stacks" ? rr(rng, 10, 50) : rr(rng, 0, 34);
            let x0;
            if (first) x0 = cx - rw / 2 + rr(rng, -10, 10);
            else x0 = side < 0 ? cx - coreW / 2 - rr(rng, 0, rw * 0.6) : cx + coreW / 2 - rw + rr(rng, 0, rw * 0.6);
            const x1 = x0 + rw;
            const z1 = zF + (mid ? 0 : rr(rng, -4, 22)), z0 = zF - rr(rng, 40, 70);
            room(B, rng, pal, x0, x1, y, y + h, z0, z1, { roof: first || rng() < 0.35, lit: mid ? 0.08 : 0.14, balcony: !mid && rng() < 0.28, chimneys });
            // anything overhanging the core gets visible reinforcement
            if (!mid) {
              if (x0 < cx - coreW / 2 - 4) { beam(B, M.beam, x0 + 4, y + h, z1 - 4, cx - coreW / 2, y + h + Math.min(40, cx - coreW / 2 - x0), z1 - 4, 2.4, pal.beam); }
              if (x1 > cx + coreW / 2 + 4) { beam(B, M.beam, x1 - 4, y + h, z1 - 4, cx + coreW / 2, y + h + Math.min(40, x1 - cx - coreW / 2), z1 - 4, 2.4, pal.beam); }
              if (cl.style === "stacks" && rng() < 0.4) beam(B, M.beam, (x0 + x1) / 2, y + h, z1 - 6, (x0 + x1) / 2 + rr(rng, -10, 10), y + h + rr(rng, 60, 120), z1 - 6, 2.6, pal.beam);
            }
            y += h + rr(rng, -2, 8);
            if (rng() < 0.65) side = -side;
            first = false;
            if (mid && y > cl.top + 260) break;
          }
          // the recipient's receiver: a hatch, shuttered hatch or balcony at the zone
          if (cl.recv && cl.role === "recipient") receiverGeometry(B, cl, rng, pal);
          // rooftop details: antenna, water tank
          if (!mid && rng() < 0.4) beam(B, M.beam, cx + rr(rng, -10, 10), cl.top - 20, zB + 20, cx + rr(rng, -10, 10), cl.top - rr(rng, 60, 110), zB + 20, 1.4, 0x2b2622);
        }
        // brackets where gameplay cables meet the building
        for (const bp of cl.brackets) {
          box(B, M.beam, bp.x - 5, bp.x + 5, bp.y - 4, bp.y + 4, bp.z - 3, bp.z + 4, 0x2a2724);
          box(B, M.beam, bp.x - 1.5, bp.x + 1.5, bp.y - 3, bp.y + 22, bp.z - 3, bp.z + 1, 0x2a2724);
        }
        const group = new THREE.Group();
        B.m.forEach((t, mat) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(t.p, 3));
          geo.setAttribute("normal", new THREE.Float32BufferAttribute(t.n, 3));
          geo.setAttribute("uv", new THREE.Float32BufferAttribute(t.u, 2));
          geo.setAttribute("color", new THREE.Float32BufferAttribute(t.c, 3));
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = !mid && mat !== M.warm && mat !== M.glass;
          mesh.receiveShadow = mat !== M.warm;
          mesh.matrixAutoUpdate = false;
          group.add(mesh);
        });
        cl.lamps = lampSpots.slice(0, 4);
        cl.chimneys = chimneys;
        return group;
      }
      function receiverGeometry(B, cl, rng, pal) {
        const L = cl.recv;
        const x = L.x, y = L.y, zF = cl.z + cl.dz / 2;
        if (L.type === "balcony") {
          // a deep balcony projecting to the plane; the letter lands on its floor
          const bx0 = x - 34, bx1 = x + 34, by = y + L.r * 0.6;
          box(B, M.timber, bx0, bx1, by, by + 4, zF - 2, 8, 0x8e7154, 70);
          for (let k = bx0 + 2; k <= bx1; k += 7) beam(B, M.beam, k, by, 6, k, by - 14, 6, 1.1, pal.beam);
          box(B, M.beam, bx0, bx1, by - 15, by - 13.6, 5, 7, pal.beam);
          beam(B, M.beam, bx0 + 3, by + 4, 4, bx0 + 3, by + 34, zF, 2.4, pal.beam);
          beam(B, M.beam, bx1 - 3, by + 4, 4, bx1 - 3, by + 34, zF, 2.4, pal.beam);
          box(B, M.warm, x - 9, x + 9, by - 34, by, zF - 0.5, zF + 0.5, 0xffffff);
          box(B, M.beam, x - 11, x + 11, by - 36, by - 34, zF, zF + 2, pal.frame);
          signs.push({ kind: "house", L, x: x + 44, y: by - 30, z: zF + 1.5 });
          return;
        }
        if (L.type === "flythrough") {
          // a window frame hung out over the gap on stays: the letter goes through it, in flight
          const w = L.r * 0.72, h = L.r * 0.95, x0 = x - w, x1 = x + w, y0 = y - h, y1 = y + h, zf = -3;
          beam(B, M.beam, x0, y0, zf, x1, y0, zf, 2.4, pal.frame);
          beam(B, M.beam, x0, y1, zf, x1, y1, zf, 2.4, pal.frame);
          beam(B, M.beam, x0, y0, zf, x0, y1, zf, 2.4, pal.frame);
          beam(B, M.beam, x1, y0, zf, x1, y1, zf, 2.4, pal.frame);
          beam(B, M.beam, x0 + 2, y0, zf, x0 + 10, y0 - 70, zF, 1.1, pal.beam);
          beam(B, M.beam, x1 - 2, y0, zf, x1 - 10, y0 - 70, zF, 1.1, pal.beam);
          // the post slot sits on the far jamb, lit, facing the courier
          box(B, M.metal, x1 + 1, x1 + 13, y - 13, y + 13, -12, 3, 0x6f5a48, 30);
          box(B, M.warm, x1 - 0.2, x1 + 0.8, y - 7, y + 7, -8, 1, 0xffffff);
          signs.push({ kind: "house", L, x: x1 + 26, y: y0 + 4, z: 2 });
          L.hatch = { x: x1 + 7, mx: x1, side: -1, hw: 12, hh: 26 };
          return;
        }
        // hatch box mounted on brackets; the open side faces the courier's approach
        const hw = 22, hh = 26, side = -L.dir; // the opening faces -dir (approach moving +dir)
        const hx = x + L.dir * (L.r * 0.4 + 8);
        box(B, M.metal, hx - hw / 2, hx + hw / 2, y - hh / 2, y + hh / 2, -18, 0, 0x6f5a48, 30);
        box(B, M.beam, hx - hw / 2 - 1, hx + hw / 2 + 1, y - hh / 2 - 3, y - hh / 2, -19, 1, 0x2f2620);
        // the mouth: a lit slot on the facing side, framed
        const mx = hx + side * (hw / 2 + 0.5);
        box(B, M.warm, mx - 0.6, mx + 0.6, y - 7, y + 7, -14, -3, 0xffffff);
        beam(B, M.beam, hx, y + hh / 2, -9, hx, y + hh / 2 + 6, zF, 2.2, pal.beam);
        beam(B, M.beam, hx - hw / 2, y, -18, hx - hw / 2, y, zF, 1.8, pal.beam);
        box(B, M.warm, hx - 8, hx + 8, y - hh / 2 - 44, y - hh / 2 - 18, zF - 0.5, zF + 0.4, 0xffffff);
        box(B, M.beam, hx - 10, hx + 10, y - hh / 2 - 46, y - hh / 2 - 44, zF, zF + 2, pal.frame);
        signs.push({ kind: "house", L, x: hx - side * 20, y: y - hh / 2 - 30, z: zF + 1.5 });
        L.hatch = { x: hx, mx, side, hw, hh };
      }
      let signs = [], clockFaces = [];

      // ---- diegetic signs: the address plate and the post office board ----
      function signMesh(s) {
        const W = s.kind === "post" ? 128 : 40, H = s.kind === "post" ? 40 : 48;
        const cv = makeCanvas(W * 4, H * 4), g2 = cv.getContext("2d");
        g2.scale(4, 4);
        if (s.kind === "post") {
          g2.fillStyle = "#24302d"; g2.fillRect(0, 0, W, H);
          g2.strokeStyle = "#b39158"; g2.lineWidth = 1.2; g2.strokeRect(3, 3, W - 6, H - 6);
          g2.fillStyle = "#e3cf9d"; g2.font = "600 19px " + FONT_DISPLAY; g2.textAlign = "center"; g2.textBaseline = "middle";
          g2.fillText("POST", W / 2, H / 2 + 1);
        } else {
          g2.fillStyle = "#e4dcc6"; g2.fillRect(0, 0, W, H);
          g2.strokeStyle = "#2e4440"; g2.lineWidth = 1.5; g2.strokeRect(2.5, 2.5, W - 5, H - 5);
          g2.fillStyle = "#2e4440"; g2.font = "600 17px " + FONT_DISPLAY; g2.textAlign = "center"; g2.textBaseline = "middle";
          g2.fillText(String(s.L.number), W / 2, H * 0.36);
          drawSymbol2D(g2, s.L.symbol, W / 2, H * 0.72, 1.4, "#8a3a2a");
        }
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.5, H * 0.5), new THREE.MeshLambertMaterial({ map: t }));
        m.position.set(s.x, -s.y, s.z);
        m.castShadow = false; m.receiveShadow = true;
        return m;
      }

      // ---- live cluster meshes ----
      const live = new Map(); // cluster id -> {group, cl}
      function syncClusters(viewX0, viewX1) {
        for (const cl of route.clusters) {
          if (live.has(cl.id)) continue;
          if (cl.x + cl.w < viewX0 - 900 || cl.x - cl.w > viewX1 + 1400) continue;
          signs = []; clockFaces = [];
          const grp = buildCluster(cl);
          for (const s of signs) grp.add(signMesh(s));
          for (const f of clockFaces) grp.add(clockFaceMesh(f));
          scene.add(grp);
          live.set(cl.id, { group: grp, cl });
        }
        live.forEach((v, id) => {
          if (v.cl.dead || v.cl.x + v.cl.w < viewX0 - 1600) {
            scene.remove(v.group);
            v.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map && o.material.map.isCanvasTexture && o.userData.own) o.material.map.dispose(); });
            live.delete(id);
          }
        });
      }
      function clockFaceMesh(f) {
        const g = new THREE.Group();
        const face = new THREE.Mesh(new THREE.CircleGeometry(f.R, 48), new THREE.MeshLambertMaterial({ color: 0xd8ccaf }));
        face.position.set(f.x, -f.y, f.z); face.receiveShadow = true; g.add(face);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(f.R, 3.2, 8, 48), M.steel); rim.position.copy(face.position); rim.castShadow = true; g.add(rim);
        for (let k = 0; k < 12; k++) {
          const t = (k / 12) * TAU, tick = new THREE.Mesh(new THREE.BoxGeometry(2.2, 9, 1.2), M.steel);
          tick.position.set(f.x + Math.cos(t) * f.R * 0.84, -f.y + Math.sin(t) * f.R * 0.84, f.z + 0.6); tick.rotation.z = t + Math.PI / 2; g.add(tick);
        }
        return g;
      }

      // ---- distant city: instanced masses in chunks along the route ----
      const farBox = new THREE.BoxGeometry(1, 1, 1); farBox.translate(0, 0.5, 0);
      const farChunks = new Map();
      const CHUNK = 2600;
      function farChunk(i) {
        const rng = mulberry32(hash2(route.seed, 9000 + i));
        const n = 110, grp = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const im = new THREE.InstancedMesh(farBox, mat, n);
        const wins = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), M.farWin, 160);
        const m4 = new THREE.Matrix4(), col = new THREE.Color();
        let wi = 0;
        const d = districtIndexFor(Math.max(0, route.letters - 2));
        const styleK = DISTRICTS[d].farTone || 0;
        for (let k = 0; k < n; k++) {
          const z = -rr(rng, 1300, 5200);
          const x = i * CHUNK + rng() * CHUNK;
          const spire = k % 14 === 0;
          const w = (spire ? rr(rng, 26, 50) : rr(rng, 34, 110)) * (1 + (-z / 5200) * 0.8), dz = rr(rng, 40, 110);
          const top = spire ? rr(rng, -1300, -500) : rr(rng, -250, 700);
          const h = FOG_Y + 400 - top;
          m4.makeScale(w, h, dz); m4.setPosition(x, -(FOG_Y + 400), z);
          im.setMatrixAt(k, m4);
          col.setHSL(0.4 + rng() * 0.1, 0.05 + rng() * 0.05, 0.22 + rng() * 0.1 + styleK);
          im.setColorAt(k, col);
          const lit = rng() < 0.5 ? 1 : 0;
          for (let j = 0; j < lit && wi < 160; j++) {
            m4.makeScale(5, 6, 1); m4.setPosition(x + rr(rng, -w * 0.4, w * 0.4), -rr(rng, Math.max(top + 20, 0), FOG_Y - 60), z + dz / 2 + 1);
            wins.setMatrixAt(wi++, m4);
          }
        }
        wins.count = wi;
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        grp.add(im); grp.add(wins);
        return grp;
      }
      function syncFar(cx) {
        const i0 = Math.floor((cx - 4000) / CHUNK), i1 = Math.floor((cx + 4500) / CHUNK);
        for (let i = i0; i <= i1; i++) if (!farChunks.has(i)) { const g = farChunk(i); scene.add(g); farChunks.set(i, g); }
        farChunks.forEach((g, i) => { if (i < i0 - 1 || i > i1 + 1) { scene.remove(g); g.traverse(o => { if (o.isInstancedMesh) { o.material !== M.farWin && o.material.dispose(); } }); farChunks.delete(i); } });
      }

      // ---- fog sea and depth curtains ----
      const fogSeaMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: C(0x7f938b) }, uLight: { value: C(0xd9dfd6) } },
        vertexShader: "varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: [
          "uniform float uTime; uniform vec3 uColor; uniform vec3 uLight; varying vec2 vW;",
          "float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }",
          "float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }",
          "void main(){ vec2 p = vW*0.0022 + vec2(uTime*0.01, 0.0); float v = n(p)*0.5 + n(p*2.1+3.0)*0.3 + n(p*4.3-uTime*0.02)*0.2;",
          " vec3 c = mix(uColor, uLight, smoothstep(0.35, 0.85, v)*0.55); gl_FragColor = vec4(c, 0.9); }"
        ].join("\n")
      });
      const fogSea = new THREE.Mesh(new THREE.PlaneGeometry(26000, 9000), fogSeaMat);
      fogSea.rotation.x = -Math.PI / 2; fogSea.position.y = -(FOG_Y + 30); fogSea.renderOrder = 2;
      scene.add(fogSea);
      function curtainTex() {
        const cv = makeCanvas(2, 256), g2 = cv.getContext("2d");
        const gr = g2.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.55, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,1)");
        g2.fillStyle = gr; g2.fillRect(0, 0, 2, 256);
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
      }
      const cTex = curtainTex();
      const curtains = [];
      for (const [z, top, bot, op] of [[-40, FOG_Y - 360, FOG_Y + 120, 0.95], [-520, FOG_Y - 520, FOG_Y + 120, 0.9], [26, FOG_Y - 150, FOG_Y + 120, 0.85]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cTex, color: 0x7f938b, transparent: true, opacity: op, depthWrite: false, fog: false }));
        m.scale.set(30000, bot - top, 1); m.position.set(0, -(top + bot) / 2, z); m.renderOrder = 3;
        scene.add(m); curtains.push(m);
      }
      // a few soft shafts of light falling through the haze
      const shafts = [];
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cTex, color: 0xfff1d6, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        m.scale.set(140 + i * 60, 2400, 1); m.rotation.z = -0.42; m.rotation.x = Math.PI; m.renderOrder = 1;
        m.userData.off = i * 1100 + 300; m.userData.z = -260 - i * 240;
        scene.add(m); shafts.push(m);
      }

      // ---- dynamic cable geometry (rope, laundry lines) ----
      function DynTube(segs, radial, radius, mat) {
        this.segs = segs; this.radial = radial; this.radius = radius;
        const nv = (segs + 1) * radial;
        this.pos = new Float32Array(nv * 3); this.nor = new Float32Array(nv * 3);
        const idx = [];
        for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
          const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
          idx.push(a, c, b, b, c, d);
        }
        this.geo = new THREE.BufferGeometry();
        this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
        this.geo.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3));
        this.geo.setIndex(idx);
        this.mesh = new THREE.Mesh(this.geo, mat);
        this.mesh.frustumCulled = false; this.mesh.castShadow = true;
      }
      DynTube.prototype.update = function (pts, radius) {
        const r = radius || this.radius, R = this.radial;
        const t = new THREE.Vector3(), n1 = new THREE.Vector3(), b1 = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
        for (let i = 0; i <= this.segs; i++) {
          const p = pts[i], q = pts[Math.min(this.segs, i + 1)], o = pts[Math.max(0, i - 1)];
          t.set(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
          n1.crossVectors(t, up); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize();
          b1.crossVectors(t, n1).normalize();
          for (let j = 0; j < R; j++) {
            const a = (j / R) * TAU, ca = Math.cos(a), sa = Math.sin(a);
            const nx = n1.x * ca + b1.x * sa, ny = n1.y * ca + b1.y * sa, nz = n1.z * ca + b1.z * sa;
            const k = (i * R + j) * 3;
            this.pos[k] = p[0] + nx * r; this.pos[k + 1] = p[1] + ny * r; this.pos[k + 2] = p[2] + nz * r;
            this.nor[k] = nx; this.nor[k + 1] = ny; this.nor[k + 2] = nz;
          }
        }
        this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
      };
      function sagPts(a, b, sag, n) {
        const out = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag, lerp(a[2], b[2], t)]);
        }
        return out;
      }
      function staticTube(pts, radius, mat) {
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, pts.length * 2), radius, 5, false), mat);
        m.castShadow = true; m.receiveShadow = true;
        return m;
      }

      // ---- gameplay hardware: rings, brackets, pulleys, clock arms ----
      const ringGeo = { hook: new THREE.TorusGeometry(7, 1.9, 8, 24), ring: new THREE.TorusGeometry(6.2, 1.7, 8, 24), eyelet: new THREE.TorusGeometry(5, 1.5, 8, 20) };
      const anchorObjs = new Map();
      function anchorRadius(a) { return a.kind === "hook" ? 7 : a.kind === "eyelet" ? 5 : 6.2; }
      function buildAnchor(a) {
        const o = { grp: new THREE.Group(), a, dyn: [] };
        const ringMat = new THREE.MeshLambertMaterial({ color: a.kind === "fragile" ? 0x8b8068 : 0x9a7b4f, emissive: 0x000000 });
        const ring = new THREE.Mesh(ringGeo[a.kind === "hook" ? "hook" : a.kind === "eyelet" ? "eyelet" : "ring"], ringMat);
        ring.castShadow = true;
        o.ring = ring; o.ringMat = ringMat;
        const head = new THREE.Group(); head.add(ring);
        const r = anchorRadius(a);
        // collar and short drop rod above the ring: the load path is visible
        const collar = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 5), M.steel); collar.position.y = r + 2.5; head.add(collar);
        o.head = head; o.grp.add(head);
        if (a.cables) {
          for (const sp of a.cables) {
            const A = [a.bx, -(a.by - r - 4), 0], Bp = [sp.x, -sp.y, sp.z];
            o.grp.add(staticTube(sagPts(A, Bp, 8, 10), 1.7, M.cable));
          }
        } else if (a.kind === "laundry") {
          o.line = new DynTube(20, 4, 0.75, M.laundry); o.grp.add(o.line.mesh);
          o.cloth = a.clothes.map(cdef => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(cdef.w, cdef.h), new THREE.MeshLambertMaterial({ color: cdef.c, side: THREE.DoubleSide }));
            m.geometry.translate(0, -cdef.h / 2, 0); m.castShadow = true; o.grp.add(m); return { m, cdef };
          });
        } else if (a.kind === "pulley") {
          const [l, rr2] = a.track;
          const ty = a.by - 26;
          o.grp.add(staticTube([[l.x, -ty, 0], [rr2.x, -ty, 0]], 2.2, M.cable));
          o.grp.add(staticTube([[l.x, -ty, 0], [l.x, -l.y, l.z]], 1.4, M.cable));
          o.grp.add(staticTube([[rr2.x, -ty, 0], [rr2.x, -rr2.y, rr2.z]], 1.4, M.cable));
          const car = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(20, 9, 8), new THREE.MeshLambertMaterial({ color: 0x5e4a3a })); body.position.y = -2; car.add(body);
          for (const ox of [-6, 6]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 14), M.steel); w.rotation.x = Math.PI / 2; w.position.set(ox, 2, 0); car.add(w); }
          const rod = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), M.steel); car.add(rod); o.rod = rod;
          o.car = car; o.grp.add(car);
        } else if (a.kind === "clock") {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 5, 3), new THREE.MeshLambertMaterial({ color: 0x6b5032 }));
          arm.geometry.translate(0.5, 0, 0); arm.castShadow = true; o.arm = arm; o.grp.add(arm);
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 8, 18), M.steel); hub.rotation.x = Math.PI / 2; hub.position.set(a.hx, -a.hy, 0); o.grp.add(hub);
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 30, 10), M.steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(a.hx, -a.hy, -15); o.grp.add(shaft);
        } else if (a.kind === "fragile" && a.beam) {
          o.frayed = new DynTube(10, 4, 0.7, new THREE.MeshLambertMaterial({ color: 0x6f604c })); o.grp.add(o.frayed.mesh);
          const tag = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshLambertMaterial({ color: 0x8f3b2b, side: THREE.DoubleSide }));
          tag.geometry.translate(4, 0, 0); o.tag = tag; o.grp.add(tag);
        }
        scene.add(o.grp);
        anchorObjs.set(a.id, o);
        return o;
      }
      function updateAnchor(o, time, glow, alpha) {
        const a = o.a;
        const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
        o.head.position.set(x, -y, 0);
        o.ringMat.emissive.setRGB(0.55 * glow, 0.36 * glow, 0.14 * glow);
        o.head.visible = !a.broken;
        if (a.kind === "laundry" && a.line) {
          const [l, r] = a.line, pts = [];
          for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            let px, py, pz;
            if (t < 0.5) { const u = t / 0.5; px = lerp(l.x, x, u); py = lerp(l.y, y - 4, u) + Math.sin(u * Math.PI) * 6; pz = lerp(l.z, 0, u); }
            else { const u = (t - 0.5) / 0.5; px = lerp(x, r.x, u); py = lerp(y - 4, r.y, u) + Math.sin(u * Math.PI) * 6; pz = lerp(0, r.z, u); }
            pts.push([px, -py, pz]);
          }
          o.line.update(pts);
          for (const c of o.cloth) {
            const idx = Math.round(c.cdef.t * 20), p = pts[idx];
            c.m.position.set(p[0], p[1], p[2] + 0.5);
            c.m.rotation.y = 0.25 + Math.sin(time * 1.7 + c.cdef.ph) * 0.12;
            c.m.rotation.x = Math.sin(time * 2.1 + c.cdef.ph) * 0.12 - worldWind(p[0], -p[1]) * 0.0006;
          }
        } else if (a.kind === "pulley" && o.car) {
          const ty = a.by - 26;
          o.car.position.set(x, -ty, 0);
          const len = (y - r6(a)) - ty;
          o.rod.scale.set(1, Math.max(1, len), 1); o.rod.position.y = -len / 2;
        } else if (a.kind === "clock" && o.arm) {
          const dx = x - a.hx, dy = y - a.hy, len = Math.hypot(dx, dy);
          o.arm.position.set(a.hx, -a.hy, 2.5); o.arm.scale.set(len, 1, 1); o.arm.rotation.z = Math.atan2(-dy, dx);
          o.head.rotation.z = Math.atan2(-dy, dx) + Math.PI / 2;
        } else if (a.kind === "fragile" && o.frayed) {
          const b = a.beam;
          const stress = player.anchor === a ? a.hold / a.life : 0;
          const j = Math.sin(time * 50) * stress * 2;
          if (a.broken) { o.frayed.update(sagPts([b.x, -b.y, b.z], [b.x + 4, -(b.y + 40), b.z * 0.4], 0, 10)); }
          else o.frayed.update(sagPts([b.x, -b.y, b.z], [x + j, -(y - 6), 0], 3, 10));
          const tp = [lerp(b.x, x, 0.4), -lerp(b.y, y, 0.4), lerp(b.z, 0, 0.4)];
          o.tag.position.set(tp[0], tp[1], tp[2]); o.tag.rotation.y = Math.sin(time * 4) * 0.5;
        }
      }
      function r6(a) { return anchorRadius(a) + 4; }

      // ---- decorative wiring with depth (non-catchable, no hardware) ----
      const decorObjs = new Map();
      function buildDecor(o) {
        if (o.kind !== "wire") return null;
        const m = staticTube(sagPts([o.x0, -o.y0, o.z0], [o.x1, -o.y1, o.z1], o.sag, 14), o.near ? 1.4 : 0.8, M.wire);
        if (!o.near) m.castShadow = false;
        scene.add(m); decorObjs.set(o, m);
        return m;
      }

      // ---- wind: cloth streamers and drifting motes, the only wind telltales ----
      const motes = new THREE.BufferGeometry();
      const MOTES = 90;
      const motePos = new Float32Array(MOTES * 6);
      motes.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
      const moteLines = new THREE.LineSegments(motes, new THREE.LineBasicMaterial({ color: 0xeef0e8, transparent: true, opacity: 0.35 }));
      moteLines.frustumCulled = false; scene.add(moteLines);
      const moteState = [];
      for (let i = 0; i < MOTES; i++) moteState.push({ x: 0, y: 0, z: 0, life: 0 });

      // ---- courier: a practical figure in a weatherproof coat ----
      const courier = (function () {
        const root = new THREE.Group();
        const coatMat = new THREE.MeshLambertMaterial({ color: 0x8c3a27 });
        const coatDark = new THREE.MeshLambertMaterial({ color: 0x6a2c1f });
        const cloth = new THREE.MeshLambertMaterial({ color: 0x2f3534 });
        const leather = new THREE.MeshLambertMaterial({ color: 0x6b5034 });
        const skin = new THREE.MeshLambertMaterial({ color: 0xb48e72 });
        const steel = new THREE.MeshLambertMaterial({ color: 0x8f8a7c });
        const dark = new THREE.MeshLambertMaterial({ color: 0x1e2020 });
        const shadow = m => { m.castShadow = true; return m; };
        const torso = new THREE.Group(); root.add(torso);
        const coat = shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.4, 11, 10), coatMat)); coat.position.y = 2.5; torso.add(coat);
        const collar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 2.4, 10), coatDark)); collar.position.y = 8.6; torso.add(collar);
        const skirtPivot = new THREE.Group(); skirtPivot.position.y = -3; torso.add(skirtPivot);
        const skirt = shadow(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.6, 6.5, 10, 1, true), coatMat)); skirt.position.y = -3.2; skirt.material.side = THREE.DoubleSide; skirtPivot.add(skirt);
        const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), skin)); head.position.y = 11.6; torso.add(head);
        const cap = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, 1.8, 12), cloth)); cap.position.y = 13.2; torso.add(cap);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 2.6), cloth); brim.position.set(0, 12.4, 2.4); torso.add(brim);
        // harness: straps over the coat, the reel bolted to the chest plate
        const strapA = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 0.6), dark); strapA.position.set(-1.6, 3, 3.9); strapA.rotation.z = 0.32; torso.add(strapA);
        const strapB = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 0.6), dark); strapB.position.set(1.6, 3, 3.9); strapB.rotation.z = -0.32; torso.add(strapB);
        const belt = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 1.2, 12), dark); belt.position.y = -2.4; torso.add(belt);
        const reel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 2.2, 14), steel)); reel.rotation.x = Math.PI / 2; reel.position.set(0, 6.2, 4.6); torso.add(reel);
        const reelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 8), dark); reelHub.rotation.x = Math.PI / 2; reelHub.position.copy(reel.position); torso.add(reelHub);
        // satchel on the hip, swinging on its strap
        const satPivot = new THREE.Group(); satPivot.position.set(3.8, 3, 0); torso.add(satPivot);
        const satchel = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.6, 5), leather)); satchel.position.set(1.2, -4.6, 0); satPivot.add(satchel);
        const flap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 5.2), coatDark); flap.position.set(1.2, -2.6, 0); satPivot.add(flap);
        // arms: shoulder pivots, gloves at the ends
        const arms = [];
        for (const s of [-1, 1]) {
          const sh = new THREE.Group(); sh.position.set(s * 3.6, 7.4, 0); torso.add(sh);
          const up = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 6.5, 8), coatMat)); up.position.y = -3.2; sh.add(up);
          const glove = shadow(new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 6), dark)); glove.position.y = -6.8; sh.add(glove);
          arms.push(sh);
        }
        // legs: hip pivots, knee pivots, boots
        const legs = [];
        for (const s of [-1, 1]) {
          const hip = new THREE.Group(); hip.position.set(s * 1.7, -5, 0); root.add(hip);
          const thigh = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.15, 6, 8), cloth)); thigh.position.y = -3; hip.add(thigh);
          const knee = new THREE.Group(); knee.position.y = -6; hip.add(knee);
          const shin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 6, 8), cloth)); shin.position.y = -3; knee.add(shin);
          const boot = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3.8), dark)); boot.position.set(0, -6.6, 0.8); knee.add(boot);
          legs.push({ hip, knee });
        }
        scene.add(root);
        return { root, torso, skirtPivot, satPivot, arms, legs, reelLocal: new THREE.Vector3(0, 6.2, 5.8) };
      })();
      const rope = new DynTube(22, 6, 1.0, M.rope);
      scene.add(rope.mesh);
      const letterMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.6), new THREE.MeshLambertMaterial({ color: 0xece4d0, side: THREE.DoubleSide }));
      letterMesh.visible = false; scene.add(letterMesh);
      let letterFly = null;

      // catch-zone hint arc: drawn only for the ring the current release would reach
      const arcGeo = new THREE.BufferGeometry();
      const arcPos = new Float32Array(49 * 3);
      arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
      const arcLine = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xf1e4c4, dashSize: 6, gapSize: 9, transparent: true, opacity: 0.0, fog: false }));
      arcLine.frustumCulled = false; scene.add(arcLine);
      function setArc(a, alpha, color) {
        if (!a || alpha < 0.01) { arcLine.material.opacity = 0; return; }
        for (let i = 0; i <= 48; i++) {
          const t = 0.1 * Math.PI + (i / 48) * 0.8 * Math.PI;
          arcPos[i * 3] = a.x + Math.cos(t) * a.reach; arcPos[i * 3 + 1] = -(a.y + Math.sin(t) * a.reach); arcPos[i * 3 + 2] = 0;
        }
        arcGeo.attributes.position.needsUpdate = true;
        arcLine.computeLineDistances();
        arcLine.material.opacity = alpha;
        arcLine.material.color.set(color || 0xf1e4c4);
      }

      // ---- atmosphere per district, blended over time ----
      const atmo = { from: 0, to: 0, t: 1 };
      function applyAtmo() {
        const A = DISTRICTS[atmo.from], Bd = DISTRICTS[atmo.to], t = smooth(atmo.t);
        const mixC = (a, b) => C(a).lerp(C(b), t);
        const fogC = mixC(A.fog, Bd.fog);
        fog.color.copy(fogC);
        fogSeaMat.uniforms.uColor.value.copy(fogC);
        for (const c of curtains) c.material.color.copy(fogC);
        hemi.color.copy(mixC(A.hemiSky, Bd.hemiSky)); hemi.groundColor.copy(mixC(A.hemiGround, Bd.hemiGround));
        sun.color.copy(mixC(A.sun, Bd.sun)); sun.intensity = lerp(A.sunI, Bd.sunI, t);
        paintSky(mixHex(A.sky[0], Bd.sky[0], t), mixHex(A.sky[1], Bd.sky[1], t), mixHex(A.fog, Bd.fog, t));
      }
      function mixHex(a, b, t) { return "#" + C(a).lerp(C(b), t).getHexString(); }
      applyAtmo();

      // ---- per-frame update ----
      const tmpV = new THREE.Vector3();
      let lastAtmoT = -1;
      const vis = { ang: 0, skirt: 0, sat: 0, legs: 0 };
      function layoutWorld() {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(Wd, Hd, false);
        camera.aspect = Wd / Hd;
        camD = (Hd / S) / 2 / FOV_T;
        camera.near = Math.max(20, camD - 1500); camera.far = camD + 6000;
        camera.updateProjectionMatrix();
        fog.near = camD - 20; fog.far = camD + 2300;
      }
      function frame(dt, time, alpha, rx, ry, pred) {
        camera.position.set(cam.x, -cam.y, camD);
        camera.lookAt(cam.x, -cam.y, 0);
        sun.position.set(cam.x - 700, -cam.y + 1100, 900); sun.target.position.set(cam.x, -cam.y, -80);
        fogSea.position.x = cam.x; fogSea.position.z = -2500;
        for (const c of curtains) c.position.x = cam.x;
        shafts.forEach((m, i) => { m.position.set(cam.x + ((m.userData.off - cam.x * 0.15) % 2600 + 2600) % 2600 - 1300, -cam.y + 100, m.userData.z); });
        fogSeaMat.uniforms.uTime.value = time;
        if (atmo.t < 1) { atmo.t = Math.min(1, atmo.t + dt / 3); applyAtmo(); }
        const vx0 = cam.x - W2 / S, vx1 = cam.x + W2 / S;
        syncClusters(vx0, vx1);
        syncFar(cam.x);
        // anchors
        for (const a of route.anchors) {
          let o = anchorObjs.get(a.id);
          const near = a.x > vx0 - 700 && a.x < vx1 + 900;
          if (!o && near) o = buildAnchor(a);
          if (o) {
            o.grp.visible = near;
            if (near) {
              a.glint = lerp(a.glint || 0, (pred && pred.hit === a ? 1 : 0), 1 - Math.exp(-dt * 10));
              updateAnchor(o, time, a.glint * (0.5 + 0.5 * assistLevel()), alpha);
            }
          }
        }
        anchorObjs.forEach((o, id) => {
          if (o.a.bx < cam.x - 2400 && o.a !== player.anchor) {
            scene.remove(o.grp); o.grp.traverse(m => { if (m.geometry && !Object.values(ringGeo).includes(m.geometry)) m.geometry.dispose(); }); anchorObjs.delete(id);
          }
        });
        for (const o of route.decor) if (!decorObjs.has(o) && o.x0 < vx1 + 1400) buildDecor(o);
        decorObjs.forEach((m, o) => { if (o.x1 < cam.x - 2400) { scene.remove(m); m.geometry.dispose(); decorObjs.delete(o); } });
        // catch-zone hint for the predicted ring; near-miss flash for the ring just missed
        if (fx.nearMiss && fx.nearMiss.t < 1.4) { fx.nearMiss.t += dt; setArc(fx.nearMiss.a, 0.55 * (1 - fx.nearMiss.t / 1.4), 0xe8a07c); }
        else setArc(pred && pred.hit, 0.35 * assistLevel() * (pred && pred.hit ? pred.hit.glint || 0 : 0));
        // receivers: active one gets a warm local light; shutters/hatches animate
        const L = activeLetter();
        if (L) {
          const open = shutterOpen(L, simTime);
          recvLight.position.set(L.x, -L.y + 20, 40);
          recvLight.intensity = (0.9 + 0.25 * Math.sin(time * 2.5)) * (L.cycle ? 0.4 + 0.6 * open : 1) * 3000;
        } else recvLight.intensity = 0;
        updateReceivers(time, dt);
        updateCourier(dt, time, rx, ry);
        updateMotes(dt);
        if (letterFly) {
          letterFly.t += dt / 0.45;
          const t = Math.min(1, letterFly.t), e = smooth(t);
          letterMesh.visible = t < 1;
          letterMesh.position.set(lerp(letterFly.x0, letterFly.x1, e), -lerp(letterFly.y0, letterFly.y1, e) + Math.sin(t * Math.PI) * 16, 6);
          letterMesh.rotation.set(0.4, t * 6, 0);
          if (t >= 1) letterFly = null;
        }
        renderer.render(scene, camera);
      }
      const recvObjs = new Map();
      function updateReceivers(time, dt) {
        for (const L of route.deliveries) {
          if (L.x < cam.x - 1600 || L.x > cam.x + 1800) continue;
          let o = recvObjs.get(L.id);
          if (!o && L.type !== "balcony" && L.type !== "roofbox") {
            // hinged flap on the open side; shutters for shuttered hatches
            o = { grp: new THREE.Group() };
            const flap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 10), new THREE.MeshLambertMaterial({ color: 0x5c4a3a }));
            flap.geometry.translate(0, -7.5, 0); flap.castShadow = true;
            o.flap = flap; o.grp.add(flap);
            if (L.type === "shutter") {
              o.sh = [];
              for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 26, 7), new THREE.MeshLambertMaterial({ color: 0x4f5b56 })); p.geometry.translate(0, 0, s * 3.5); p.castShadow = true; o.sh.push({ p, s }); o.grp.add(p); }
            }
            scene.add(o.grp); recvObjs.set(L.id, o);
          }
          if (o && L.hatch) {
            const h = L.hatch;
            const openK = L.cycle ? shutterOpen(L, simTime) : 1;
            o.flap.position.set(h.mx, -(L.y - 7.5), -9);
            const target = L.status === "delivered" ? 0.2 : (L.rattle > 0 ? Math.sin(time * 60) * 0.15 * L.rattle : 0.5) * openK;
            o.flap.rotation.y = h.side * (0.4 + target);
            if (L.rattle > 0) L.rattle = Math.max(0, L.rattle - dt * 2.5);
            if (o.sh) for (const s of o.sh) { s.p.position.set(h.mx + h.side * 0.6, -L.y, -9 + s.s * 9); s.p.rotation.y = s.s * (1 - openK) * 1.4 * -1 + s.s * 0; s.p.rotation.y = s.s * (openK * 1.35); }
          }
        }
        recvObjs.forEach((o, id) => { const L = route.deliveries.find(x => x.id === id); if (!L || L.x < cam.x - 1800) { scene.remove(o.grp); recvObjs.delete(id); } });
      }
      function onDeliver(L, perfect) {
        letterFly = { t: 0, x0: player.x, y0: player.y, x1: L.hatch ? L.hatch.x : L.x, y1: L.y };
      }
      function updateMotes(dt) {
        let k = 0;
        for (const m of moteState) {
          const w = route.winds.find(w2 => w2.x1 > cam.x - 900 && w2.x0 < cam.x + 900);
          if (m.life <= 0) {
            if (w && Math.random() < 0.5) { m.x = rr(Math.random, w.x0, w.x1); m.y = rr(Math.random, cam.y - 500, cam.y + 400); m.z = rr(Math.random, -120, 60); m.life = 1.5 + Math.random(); m.f = w.f; }
            else m.life = 0;
          }
          if (m.life > 0) { m.life -= dt; m.x += m.f * 0.9 * dt; }
          const len = m.life > 0 ? Math.sign(m.f) * 14 : 0;
          motePos[k++] = m.x; motePos[k++] = -m.y; motePos[k++] = m.z;
          motePos[k++] = m.x - len; motePos[k++] = -m.y; motePos[k++] = m.z;
        }
        motes.attributes.position.needsUpdate = true;
      }
      function updateCourier(dt, time, x, y) {
        const a = player.anchor;
        const sc2 = Math.max(1, 27 / (30 * S));
        const cr = courier;
        vis.lift = lerp(vis.lift || 0, player.mode === "ground" ? 17.5 * sc2 : 0, 1 - Math.exp(-dt * 14));
        cr.root.position.set(x, -y + vis.lift, 2);
        cr.root.scale.setScalar(sc2);
        let target;
        if (a && player.mode !== "ground") target = Math.atan2(a.x - x, -(a.y - y));
        else if (player.mode === "ground") target = 0;
        else target = clamp(player.vx / 1200, -0.45, 0.45);
        if (gameState === "dying") target += time * 4;
        let da = target - vis.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        vis.ang += da * (1 - Math.exp(-dt * (a ? 28 : 7)));
        cr.root.rotation.z = -vis.ang;
        cr.root.rotation.y = player.vx >= 0 ? 0.5 : -0.5;
        const speed = Math.hypot(player.vx, player.vy);
        const om = player.om || 0;
        const hanging = !!a && player.mode !== "ground";
        const flying = !a && player.mode !== "ground";
        // coat and satchel trail the motion; legs lag the swing
        vis.skirt = lerp(vis.skirt, clamp(-om * 0.16 - player.vx / 3000, -0.5, 0.5), 1 - Math.exp(-dt * 8));
        cr.skirtPivot.rotation.z = vis.skirt; cr.skirtPivot.scale.set(1 + Math.min(0.25, speed / 2600), 1, 1);
        vis.sat = lerp(vis.sat, clamp(om * 0.3, -0.7, 0.7), 1 - Math.exp(-dt * 5));
        cr.satPivot.rotation.z = vis.sat;
        const legLag = clamp(-om * 0.2, -0.6, 0.6);
        cr.legs.forEach((l, i) => {
          const s = i ? 1 : -1;
          if (player.mode === "ground") { l.hip.rotation.x = 0; l.knee.rotation.x = 0; l.hip.rotation.z = s * 0.06; }
          else if (flying) { const tuck = player.vy < 0 ? 0.9 : 0.25; l.hip.rotation.x = -tuck + s * 0.15; l.knee.rotation.x = tuck * 1.3; l.hip.rotation.z = 0; }
          else { l.hip.rotation.x = -0.35 + s * 0.1 + legLag * 0.6; l.knee.rotation.x = 0.55; l.hip.rotation.z = legLag * 0.5; }
        });
        cr.arms.forEach((sh, i) => {
          const s = i ? 1 : -1;
          if (hanging) { sh.rotation.x = 0; sh.rotation.z = s * 2.85; }   // both hands up on the line
          else if (flying) { sh.rotation.z = s * (1.4 + Math.sin(time * 9 + i) * 0.15); sh.rotation.x = 0.3; }
          else { sh.rotation.z = s * 0.15; sh.rotation.x = 0; }
        });
        cr.root.updateMatrixWorld(true);
        const reelW = cr.reelLocal.clone(); cr.torso.localToWorld(reelW);
        // the line: from the reel on the harness to the ring's underside
        let pts = null;
        if (a) {
          fx.ropeExtend = Math.min(1, fx.ropeExtend + dt / 0.08);
          const ax = a.px + (a.x - a.px) * renderAlpha, ay = a.py + (a.y - a.py) * renderAlpha;
          const end = [ax, -(ay + anchorRadius(a) - 1.5), 0.5];
          const ex = [lerp(reelW.x, end[0], fx.ropeExtend), lerp(reelW.y, end[1], fx.ropeExtend), lerp(reelW.z, end[2], fx.ropeExtend)];
          const d = Math.hypot(end[0] - reelW.x, end[1] - reelW.y);
          const dPhys = Math.hypot(player.x - a.x, player.y - a.y);
          const slack = player.mode === "slack" ? Math.sqrt(Math.max(0, player.L * player.L - dPhys * dPhys)) * 0.5 : 0;
          fx.ropeVib *= Math.exp(-dt * 8);
          pts = [];
          const nx = -(ex[1] - reelW.y) / (d || 1), ny = (ex[0] - reelW.x) / (d || 1);
          for (let i = 0; i <= 22; i++) {
            const t = i / 22, w = Math.sin(t * Math.PI) * Math.sin(time * 48 + t * 8) * fx.ropeVib;
            pts.push([lerp(reelW.x, ex[0], t) + nx * w, lerp(reelW.y, ex[1], t) + ny * w - Math.sin(t * Math.PI) * slack, lerp(reelW.z, ex[2], t)]);
          }
        } else if (fx.retract) {
          fx.retract.t += dt;
          const t = Math.min(1, fx.retract.t / 0.16);
          const ex = [lerp(fx.retract.x, reelW.x, t), lerp(-fx.retract.y, reelW.y, t), lerp(0, reelW.z, t)];
          pts = [];
          for (let i = 0; i <= 22; i++) { const u = i / 22; pts.push([lerp(reelW.x, ex[0], u) + Math.sin(u * 10 + t * 18) * 4 * (1 - t), lerp(reelW.y, ex[1], u), lerp(reelW.z, ex[2], u)]); }
          if (t >= 1) fx.retract = null;
        }
        rope.mesh.visible = !!pts;
        if (pts) rope.update(pts, Math.max(1.1, 1.15 / S));
      }
      function setQuality(level) {
        // 2: full, 1: no shadows, 0: no shadows and lower resolution
        sun.castShadow = level >= 2;
        pixelRatio = level === 0 ? Math.min(1.25, ctx.dpr || 1) : Math.min(2, ctx.dpr || 1);
        layoutWorld();
      }
      function setDistrict(d) { if (d !== atmo.to) { atmo.from = atmo.to; atmo.to = d; atmo.t = 0; } }
      function reset() {
        live.forEach(v => { scene.remove(v.group); v.group.traverse(o => o.geometry && o.geometry.dispose()); }); live.clear();
        anchorObjs.forEach(o => scene.remove(o.grp)); anchorObjs.clear();
        decorObjs.forEach(m => { scene.remove(m); m.geometry.dispose(); }); decorObjs.clear();
        recvObjs.forEach(o => scene.remove(o.grp)); recvObjs.clear();
        farChunks.forEach(g => scene.remove(g)); farChunks.clear();
        atmo.from = atmo.to = 0; atmo.t = 1; applyAtmo();
      }
      return { renderer, frame, layout: layoutWorld, setQuality, setDistrict, reset, onDeliver, canvas: glCanvas, camera };
    }

    // =====================================================================
    // 11. INTERFACE — quiet, typographic, out of the way of the city
    // =====================================================================
    function drawSymbol2D(g2, sym, x, y, s, color) {
      g2.save(); g2.translate(x, y); g2.scale(s, s);
      g2.fillStyle = color; g2.strokeStyle = color; g2.lineWidth = 1.4;
      g2.beginPath();
      switch (sym) {
        case "lantern": g2.fillRect(-3, -4, 6, 8); g2.fillRect(-1.5, -6, 3, 2); g2.fillRect(-4, 4, 8, 1.5); break;
        case "fish": g2.ellipse(-1, 0, 4, 2.4, 0, 0, TAU); g2.fill(); g2.beginPath(); g2.moveTo(2.5, 0); g2.lineTo(5.5, -2.5); g2.lineTo(5.5, 2.5); g2.closePath(); break;
        case "key": g2.arc(-3, 0, 2.2, 0, TAU); g2.stroke(); g2.beginPath(); g2.fillRect(-1, -0.7, 6, 1.4); g2.fillRect(3, 0, 1.2, 2.2); break;
        case "moon": g2.arc(0, 0, 4.5, 0.6, TAU - 0.6); g2.arc(2, 0, 3.4, TAU - 0.9, 0.9, true); break;
        case "bell": g2.moveTo(-4, 3); g2.quadraticCurveTo(-4, -5, 0, -5); g2.quadraticCurveTo(4, -5, 4, 3); g2.closePath(); g2.fill(); g2.beginPath(); g2.arc(0, 4, 1.3, 0, TAU); break;
        case "leaf": g2.moveTo(-4, 4); g2.quadraticCurveTo(-4, -4, 4, -4); g2.quadraticCurveTo(4, 4, -4, 4); break;
        case "cup": g2.fillRect(-3.5, -2, 6, 6); g2.arc(3.5, 1, 1.8, -1.4, 1.4); g2.stroke(); g2.beginPath(); g2.fillRect(-4.5, 4, 8, 1.2); break;
        case "star": for (let i = 0; i < 10; i++) { const r = i % 2 ? 2 : 5, t = (i / 10) * TAU - Math.PI / 2; g2.lineTo(Math.cos(t) * r, Math.sin(t) * r); } g2.closePath(); break;
        case "bird": g2.moveTo(-5, -1); g2.quadraticCurveTo(-2, -4, 0, 0); g2.quadraticCurveTo(2, -4, 5, -1); g2.lineWidth = 1.6; g2.stroke(); g2.beginPath(); break;
        case "umbrella": g2.arc(0, 0, 5, Math.PI, 0); g2.closePath(); g2.fill(); g2.beginPath(); g2.fillRect(-0.6, 0, 1.2, 5); break;
      }
      g2.fill();
      g2.restore();
    }
    function assistLevel() { return clamp(1 - records.catches / 50, 0, 1) * (run && run.district <= 1 ? 1 : 0.4); }

    function createHud() {
      const root = ctx.createRoot({ layer: "overlay", input: "passthrough" });
      root.innerHTML = `
<style>
  .pp { position:absolute; inset:0; font-family:${FONT_UI}; color:#ede8dc; -webkit-font-smoothing:antialiased; pointer-events:none; }
  .pp * { box-sizing:border-box; }
  .pp .bar { position:absolute; left:0; right:0; top:0; display:flex; justify-content:space-between; align-items:flex-start; padding:0 18px; }
  .pp .to { margin-top:2px; max-width:72%; transition:opacity .4s; text-shadow:0 1px 10px rgba(20,26,24,.45); }
  .pp .to .n { font-weight:600; font-size:15px; letter-spacing:.005em; }
  .pp .to .d { font-weight:400; font-size:12.5px; opacity:.74; margin-top:2px; }
  .pp .right { display:flex; align-items:center; gap:4px; }
  .pp .score { font-weight:500; font-size:15px; font-variant-numeric:tabular-nums; margin-right:6px; text-shadow:0 1px 10px rgba(20,26,24,.45); }
  .pp button { pointer-events:auto; background:none; border:0; color:inherit; font:inherit; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .pp .icon { width:40px; height:40px; display:grid; place-items:center; opacity:.82; }
  .pp .icon svg { width:18px; height:18px; }
  .pp .toast { position:absolute; left:18px; font-size:13.5px; font-weight:500; letter-spacing:.01em; opacity:0; transform:translateY(4px); transition:opacity .35s, transform .35s; text-shadow:0 1px 10px rgba(20,26,24,.5); }
  .pp .toast.on { opacity:1; transform:none; }
  .pp .toast.gold { color:#f0cf95; } .pp .toast.miss { color:#e2bfae; } .pp .toast.quiet { opacity:0; color:#ede8dc; } .pp .toast.quiet.on { opacity:.78; }
  .pp .teach { position:absolute; left:18px; max-width:min(72%, 360px); font-size:14.5px; line-height:1.35; opacity:0; transition:opacity .5s; text-shadow:0 1px 12px rgba(20,26,24,.55); }
  .pp .teach::before { content:""; display:block; width:22px; height:1.5px; background:#d9a46a; margin-bottom:9px; }
  .pp .teach.on { opacity:1; }
  .pp .district { position:absolute; left:0; right:0; text-align:center; font-family:${FONT_DISPLAY}; font-weight:400; font-size:13px; letter-spacing:.32em; text-transform:uppercase; opacity:0; transition:opacity 1s; text-shadow:0 1px 14px rgba(20,26,24,.5); }
  .pp .district.on { opacity:.86; }
  .pp .screen { position:absolute; inset:0; display:none; pointer-events:none; }
  .pp .screen.on { display:block; }
  .pp .shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(18,24,22,0) 38%, rgba(18,24,22,.62) 100%); }
  .pp .block { position:absolute; left:24px; right:24px; }
  .pp .title { font-family:${FONT_DISPLAY}; font-weight:500; font-size:clamp(26px, min(9vw, 7.5vh), 46px); letter-spacing:.18em; line-height:1.02; text-transform:uppercase; }
  .pp .sub { font-size:15px; opacity:.8; margin-top:12px; max-width:320px; line-height:1.4; }
  .pp .cta { margin-top:22px; padding:12px 26px; background:#ece5d6; color:#1d2422; font-weight:600; font-size:15px; letter-spacing:.02em; border-radius:2px; }
  .pp .big { font-family:${FONT_DISPLAY}; font-weight:400; font-size:64px; line-height:1; letter-spacing:-.01em; }
  .pp .lbl { font-size:15px; opacity:.85; margin-top:6px; }
  .pp .facts { font-size:13.5px; opacity:.72; margin-top:14px; line-height:1.6; font-variant-numeric:tabular-nums; }
  .pp .facts b { font-weight:600; opacity:1; color:#f2ede2; }
</style>
<div class="pp">
  <div class="bar">
    <div class="to"><div class="n"></div><div class="d"></div></div>
    <div class="right"><div class="score"></div>
      <button class="icon pause" aria-label="Pause"><svg viewBox="0 0 18 18"><rect x="4" y="3" width="3" height="12" fill="currentColor"/><rect x="11" y="3" width="3" height="12" fill="currentColor"/></svg></button>
      <button class="icon sound" aria-label="Sound"><svg viewBox="0 0 18 18"><path d="M3 7h3l4-3v10l-4-3H3z" fill="currentColor"/><path class="w" d="M12.5 6.2a4 4 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.6" fill="none"/><path class="x" d="M12 6.5l4 5M16 6.5l-4 5" stroke="currentColor" stroke-width="1.6"/></svg></button>
    </div>
  </div>
  <div class="toast"></div>
  <div class="district"></div>
  <div class="teach"></div>
  <div class="screen title-s"><div class="shade"></div><div class="block">
    <div class="title"></div><div class="sub"></div><button class="cta play">Play</button></div></div>
  <div class="screen results-s"><div class="shade" style="background:rgba(18,24,22,.5)"></div><div class="block">
    <div class="big r-n">0</div><div class="lbl r-l">letters delivered</div><div class="facts r-f"></div>
    <button class="cta again">Go again</button></div></div>
  <div class="screen pause-s"><div class="shade" style="background:rgba(18,24,22,.45)"></div><div class="block">
    <div class="title" style="font-size:28px">Paused</div><button class="cta resume">Resume</button></div></div>
</div>`;
      const $ = s => root.querySelector(s);
      const el = {
        bar: $(".bar"), to: $(".to"), n: $(".to .n"), d: $(".to .d"), score: $(".score"), toast: $(".toast"), teach: $(".teach"), district: $(".district"),
        title: $(".title-s"), results: $(".results-s"), pause: $(".pause-s"), tt: $(".title-s .title"), ts: $(".title-s .sub"),
        rn: $(".r-n"), rl: $(".r-l"), rf: $(".r-f"), soundW: $(".sound .w"), soundX: $(".sound .x")
      };
      el.tt.textContent = GAME_TITLE;
      el.ts.textContent = "Carry the post across a city without streets.";
      let toastT = 0, teachKey = null, teachT = 0, distT = 0, lastLetter = null, lastScore = -1;
      const blocks = [el.title.querySelector(".block"), el.results.querySelector(".block"), el.pause.querySelector(".block")];
      function place() {
        const top = (ctx.safeArea && ctx.safeArea.top) || 0, bot = (ctx.safeArea && ctx.safeArea.bottom) || 0;
        el.bar.style.paddingTop = (top + 12) + "px";
        el.toast.style.top = (top + 70) + "px";
        el.district.style.top = (top + 96) + "px";
        el.teach.style.bottom = (bot + 34) + "px";
        for (const b of blocks) b.style.bottom = (bot + 40) + "px";
      }
      function sound() { el.soundW.style.display = records.muted ? "none" : ""; el.soundX.style.display = records.muted ? "" : "none"; }
      ctx.listen($(".pause"), "click", e => { e.stopPropagation(); if (gameState === "play") { paused = true; cancelAllPointers(); } });
      ctx.listen($(".sound"), "click", e => { e.stopPropagation(); audio.unlock(); setMuted(!records.muted); sound(); });
      ctx.listen($(".play"), "click", e => { e.stopPropagation(); audio.unlock(); if (gameState === "title") startPlay(); });
      ctx.listen($(".again"), "click", e => { e.stopPropagation(); audio.unlock(); if (gameState === "results") newRun(); });
      ctx.listen($(".resume"), "click", e => { e.stopPropagation(); resume(); });
      for (const b of root.querySelectorAll("button")) ctx.listen(b, "pointerdown", e => e.stopPropagation());
      place(); sound();
      return {
        place, sound,
        reset() { lastLetter = null; lastScore = -1; el.toast.className = "toast"; el.teach.className = "teach"; teachKey = null; },
        toast(text, kind) { el.toast.textContent = text; el.toast.className = "toast " + (kind || "plain") + " on"; toastT = kind === "quiet" ? 1.2 : 2.2; },
        teach(key, text) {
          if (records.seen[key]) return;
          if (teachKey && teachKey !== key && teachT > 0) records.seen[teachKey] = true;
          teachKey = key; teachT = 7; el.teach.textContent = text; el.teach.className = "teach on";
        },
        learned(key) { records.seen[key] = true; if (teachKey === key) { teachT = 0; el.teach.className = "teach"; } },
        district(name) { el.district.textContent = name; el.district.className = "district on"; distT = 3.2; },
        update(dt) {
          const playing = gameState === "play" || gameState === "dying";
          el.bar.style.visibility = gameState === "results" ? "hidden" : "visible";
          el.to.style.opacity = playing ? 1 : 0;
          el.score.style.opacity = playing ? 0.9 : 0;
          $(".pause").style.visibility = gameState === "play" ? "visible" : "hidden";
          el.title.className = "screen title-s" + (gameState === "title" ? " on" : "");
          el.results.className = "screen results-s" + (gameState === "results" ? " on" : "");
          el.pause.className = "screen pause-s" + (paused && gameState === "play" ? " on" : "");
          if (run && run.score !== lastScore) { lastScore = run.score; el.score.textContent = run.score.toLocaleString("en-US"); }
          const L = activeLetter();
          if (L !== lastLetter) {
            lastLetter = L;
            if (L) {
              el.n.textContent = "To " + L.name;
              const how = L.type === "chute" || L.type === "shutter" ? (L.dir > 0 ? ", from the left" : ", from the right") : L.type === "roofbox" ? ", drop in" : L.type === "flythrough" ? ", fly through" : "";
              el.d.textContent = "No. " + L.number + " · " + RECV_TEXT[L.type] + how;
            } else { el.n.textContent = ""; el.d.textContent = ""; }
          }
          if (!playing) { toastT = 0; distT = 0; el.toast.className = "toast"; el.district.className = "district"; el.teach.className = "teach"; }
          if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.className = el.toast.className.replace(" on", ""); }
          if (teachT > 0 && !paused) { teachT -= dt; if (teachT <= 0) { el.teach.className = "teach"; if (teachKey) records.seen[teachKey] = true; } }
          if (distT > 0) { distT -= dt; if (distT <= 0) el.district.className = "district"; }
          // core control lessons, taught when they first matter
          if (gameState === "play" && run.started) {
            if (!records.seen.release && player.anchor && player.mode === "swing" && run.catches === 0) this.teach("release", "Tap anywhere to let go of the line");
            else if (records.seen.release && !records.seen.reel && run.delivered >= 1 && player.anchor && player.mode === "swing") this.teach("reel", "Drag up or down to reel the line in or out");
            else if (player.mode === "ground" && run.catches > 0 && !records.seen.pushoff) this.teach("pushoff", player.anchor ? "Tap to push off the roof" : "Tap to hop toward a ring");
            else if (player.anchor && player.mode === "swing" && run.hangT > 6 && !records.seenPump && !(L && L.D === player.anchor)) this.teach("pump", "Swing weak? Reel in at the bottom and out at the ends to pump");
          }
        },
        showResults(r) {
          el.rn.textContent = String(r.delivered);
          el.rl.textContent = r.delivered === 1 ? "letter delivered" : "letters delivered";
          const best = r.newBest ? "new best" : "best " + records.best.toLocaleString("en-US");
          const parts = [];
          if (r.perfect || r.clean) parts.push((r.perfect ? "<b>" + r.perfect + "</b> perfect" : "") + (r.perfect && r.clean - r.perfect > 0 ? " · " : "") + (r.clean - r.perfect > 0 ? "<b>" + (r.clean - r.perfect) + "</b> clean" : ""));
          parts.push("Best streak <b>" + r.bestStreak + "</b>");
          parts.push("<b>" + r.score.toLocaleString("en-US") + "</b> points · " + best);
          if (r.deathNear) parts.push("Short of the last ring by " + r.deathNear.gap);
          el.rf.innerHTML = parts.join("<br>");
        }
      };
    }

    // =====================================================================
    // 12. CAMERA, FRAME, INPUT, LIFECYCLE
    // =====================================================================
    let Wd = ctx.width || 390, Hd = ctx.height || 844, S = 0.6, W2 = 0, H2 = 0;
    const cam = { x: 0, y: 470, snap: true };
    function layout(info) {
      Wd = (info && info.width) || ctx.width || 390;
      Hd = (info && info.height) || ctx.height || 844;
      const portrait = Hd > Wd;
      S = clamp(Math.min(Wd / (portrait ? 620 : 900), Hd / 720), 0.35, 2);
      W2 = Wd / 2; H2 = Hd / 2;
      if (world) world.layout();
      if (hud) hud.place();
      cam.snap = true;
    }
    const sx = x => (x - cam.x) * S + W2;

    function updateCamera(dt, rx, ry) {
      const wW = Wd / S, wH = Hd / S;
      let tx = rx + wW * 0.12 + clamp(player.vx * 0.2, -90, 160);
      let ty = ry - 40;
      let nxt = null;
      for (const a of route.anchors) if (a.bx > rx + 60 && a !== player.anchor && (!nxt || a.bx < nxt.bx)) nxt = a;
      if (nxt) ty = lerp(ty, nxt.y + 120, 0.25);
      const L = activeLetter();
      if (L && Math.abs(L.x - rx) < wW * 0.7) ty = lerp(ty, L.y, 0.15);
      ty = Math.min(ty, FOG_Y + 150 - wH / 2);
      if (gameState === "title") { tx = Wd > Hd ? rx - wW * 0.14 : rx + wW * 0.18; ty = Math.min(ry - wH * (Wd > Hd ? 0.12 : 0.08), FOG_Y + 150 - wH / 2); }
      if (gameState === "dying" || gameState === "results") { tx = cam.x; ty = cam.y; }
      if (cam.snap) { cam.x = tx; cam.y = ty; cam.snap = false; }
      else { cam.x += (tx - cam.x) * (1 - Math.exp(-dt * 3.4)); cam.y += (ty - cam.y) * (1 - Math.exp(-dt * 2.6)); }
      if (gameState === "play") {
        const mTop = 120 / S, mBot = 130 / S;
        if (player.anchor) cam.y = Math.min(cam.y, Math.max(player.anchor.y + wH / 2 - 80 / S, ry - wH / 2 + mBot));
        cam.y = clamp(cam.y, ry - wH / 2 + mBot, ry + wH / 2 - mTop);
        cam.x = clamp(cam.x, rx - wW / 2 + 60 / S, rx + wW / 2 - 60 / S);
      }
    }
    // read-ahead of the current release with the real integrator (feeds the subtle ring glint)
    function predict() {
      if (!player.anchor || player.mode === "ground" || gameState !== "play") return null;
      const q = makePlayer();
      q.x = player.x; q.y = player.y; q.vx = player.vx; q.vy = player.vy; q.mode = "fly"; q.exclude = player.anchor;
      let hit = null;
      const W = { wind: worldWind, platforms: route.platforms, anchors: route.anchors, ev: (t, d) => { if (t === "catch") hit = d.a; } };
      const saved = route.anchors.map(a => [a.locked, a.load]);
      for (let i = 0; i < 300 && !hit; i++) { stepPlayer(q, DT, W); if (q.mode === "ground" || q.y > DEATH_Y) break; }
      route.anchors.forEach((a, i) => { a.locked = saved[i][0]; a.load = saved[i][1]; });
      return { hit };
    }

    let renderAlpha = 1, renderTime = 0, frameAvg = 16, quality = 2, slowFor = 0, lastReelTickL = 0;
    function frame(alpha, dtMs) {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      renderAlpha = alpha;
      if (!paused) renderTime += dt;
      let rx = player.px + (player.x - player.px) * alpha, ry = player.py + (player.y - player.py) * alpha;
      if (fx.renderOff) {
        rx += fx.renderOff.x; ry += fx.renderOff.y;
        const k = Math.exp(-dt / 0.06); fx.renderOff.x *= k; fx.renderOff.y *= k;
        if (Math.abs(fx.renderOff.x) + Math.abs(fx.renderOff.y) < 0.05) fx.renderOff = null;
      }
      if (!paused) updateCamera(dt, rx, ry);
      world.setDistrict(gameState === "title" ? 0 : run.district);
      const pred = predict();
      world.frame(paused ? 0 : dt, renderTime, alpha, rx, ry, pred);
      hud.update(paused ? 0 : dt);
      if (dragId !== null && player.anchor && Math.abs(player.L - lastReelTickL) > 10) { lastReelTickL = player.L; audio.reelTick(); }
      audio.wind(gameState === "play" && !paused ? Math.hypot(player.vx, player.vy) : 0);
      // adaptive quality: drop shadows, then resolution, if frames run long
      frameAvg = lerp(frameAvg, dtMs || 16, 0.05);
      if (frameAvg > 26 && quality > 0) { slowFor += dt; if (slowFor > 2.5) { quality--; world.setQuality(quality); slowFor = 0; frameAvg = 16; } } else slowFor = 0;
    }

    const pointers = new Map();
    let dragId = null;
    function localXY(e) { const r = world.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function bindInput(target) {
      ctx.listen(target, "pointerdown", e => {
        if (e.cancelable) e.preventDefault();
        try { target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        audio.unlock();
        const p = localXY(e);
        pointers.set(e.pointerId, { x0: p.x, y0: p.y, lastY: p.y, t0: performance.now(), mode: "pending", sn: gameState === "play" && player.anchor && player.mode === "swing" ? snapshot() : null });
      }, { passive: false });
      ctx.listen(target, "pointermove", e => {
        const st = pointers.get(e.pointerId);
        if (!st) return;
        const p = localXY(e);
        const dx = p.x - st.x0, dy = p.y - st.y0;
        if (st.mode === "pending") {
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 0.9 && dragId === null && gameState === "play" && !paused && player.anchor) {
            st.mode = "drag"; dragId = e.pointerId; st.lastY = p.y; player.reelTarget = player.L;
          } else if (Math.hypot(dx, dy) > 22) st.mode = "void";
        } else if (st.mode === "drag") {
          const d = p.y - st.lastY; st.lastY = p.y;
          if (player.anchor) {
            const base = player.reelTarget === null ? player.L : player.reelTarget;
            player.reelTarget = clamp(base + (d / S) * 0.9, LMIN, LMAX);
            run.reelUsed += Math.abs(d / S);
            if (run.reelUsed > 80) hud.learned("reel");
            if (run.reelUsed > 40) hud.learned("reelroof");
          }
        }
      });
      const end = (e, cancelled) => {
        const st = pointers.get(e.pointerId);
        if (!st) return;
        pointers.delete(e.pointerId);
        if (st.mode === "drag") { if (dragId === e.pointerId) { dragId = null; player.reelTarget = null; } return; }
        if (cancelled || st.mode !== "pending") return;
        const p = localXY(e);
        if (performance.now() - st.t0 < 450 && Math.hypot(p.x - st.x0, p.y - st.y0) < 16) handleTap(p.x, p.y, st.sn);
      };
      ctx.listen(target, "pointerup", e => end(e, false));
      ctx.listen(target, "pointercancel", e => end(e, true));
    }
    // keyboard: Space/Enter taps, Up/W and Down/S hold to reel, P pauses, M mutes
    const keysHeld = new Set();
    function keyReel() {
      if (dragId !== null) return;
      const dir = (keysHeld.has("down") ? 1 : 0) - (keysHeld.has("up") ? 1 : 0);
      if (!dir || !player.anchor || gameState !== "play" || paused) { if (keysHeld.has("reel")) { keysHeld.delete("reel"); player.reelTarget = null; } return; }
      keysHeld.add("reel");
      // a held key reels at a steady, controllable rate (about 260 units a second)
      player.reelTarget = clamp(player.L + dir * 2.2, LMIN, LMAX);
    }
    function bindKeys() {
      const KEY = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down" };
      ctx.listen(window, "keydown", e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = KEY[e.code];
        if (k) { e.preventDefault(); if (!keysHeld.has(k)) { keysHeld.add(k); run.reelUsed += 20; if (run.reelUsed > 80) hud.learned("reel"); if (run.reelUsed > 40) hud.learned("reelroof"); } keyReel(); return; }
        if (e.repeat) return;
        if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); audio.unlock(); handleTap(sx(player.x) + 60, 0, null); }
        else if (e.code === "ArrowLeft" || e.code === "KeyA") { e.preventDefault(); if (gameState === "play" && player.mode === "ground") handleTap(sx(player.x) - 60, 0, null); }
        else if (e.code === "KeyP" || e.code === "Escape") { if (gameState === "play") { if (paused) resume(); else { paused = true; cancelAllPointers(); } } }
        else if (e.code === "KeyM") { audio.unlock(); setMuted(!records.muted); hud.sound(); }
      });
      ctx.listen(window, "keyup", e => { const k = KEY[e.code]; if (k) { keysHeld.delete(k); keyReel(); } });
    }
    function cancelAllPointers() { pointers.clear(); dragId = null; player.reelTarget = null; keysHeld.clear(); }
    function resume() { paused = false; audio.resume(); try { if (ctx.music && ctx.music.resume && musicOn) ctx.music.resume(); } catch (e) { /* ignore */ } }
    function startPlay() {
      gameState = "play";
      run.started = true;
      try { ctx.platform.start({ attempt }); } catch (e) { /* ignore */ }
      startMusic();
      hop(1);
    }
    function handleTap(x, y, sn) {
      if (paused) { resume(); return; }
      if (gameState === "title") { startPlay(); return; }
      if (gameState === "results") { if (performance.now() - run.resultsAt > 600) newRun(); return; }
      if (gameState !== "play") return;
      if (player.anchor && (player.mode === "swing" || player.mode === "slack")) { if (sn) releaseFromSnapshot(sn); else releaseLine(false); }
      else if (player.mode === "ground") hop(x < sx(player.x) - 30 ? -1 : 1);
    }
    function endRun() {
      gameState = "results";
      run.resultsAt = performance.now();
      records.runs++;
      run.newBest = run.score > records.best && records.runs > 1;
      records.best = Math.max(records.best, run.score);
      records.bestStreak = Math.max(records.bestStreak, run.bestStreak);
      records.last = run.score;
      saveRecords();
      cancelAllPointers();
      hud.showResults(run);
      try { ctx.platform.fail({ score: run.score, delivered: run.delivered, district: run.district + 1 }); } catch (e) { /* ignore */ }
      if (score && score.submit) score.submit("score", { label: run.score + " pts" }).catch(() => { /* board refresh is not awaited */ });
    }
    function tick() {
      if (paused || !route) return;
      player.px = player.x; player.py = player.y;
      for (const a of route.anchors) { a.px = a.x; a.py = a.y; }
      if (gameState === "play" || gameState === "dying") {
        if (keysHeld.size) keyReel();
        for (let i = 0; i < SUBSTEPS; i++) gameStep(DT);
        if (gameState === "dying") { run.dyingT += 1 / FIXED_HZ; if (run.dyingT > 1.1) endRun(); }
        ensureRoute(player.x, 1);
        if (stepCounter % 240 === 0) pruneRoute(Math.min(player.x, cam.x));
      } else for (const a of route.anchors) updateAnchorPos(a, 1 / FIXED_HZ);
    }
    worldWind = (x, y) => {
      const ws = route.winds;
      if (!ws.length) return 0;
      let f = 0;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) f += w.f * smooth(Math.min(x - w.x0, w.x1 - x, 90) / 90);
      }
      return f;
    };

    // ---- boot: fonts, renderer, first frame, then ready ----
    const fontJobs = [];
    try {
      if (ctx.loadFont) {
        fontJobs.push(ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0", { weight: "300 700" }));
        fontJobs.push(ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }));
        fontJobs.push(ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }));
      }
    } catch (e) { /* system fonts remain as fallback */ }
    await Promise.race([Promise.allSettled(fontJobs), new Promise(r => setTimeout(r, 1500))]);
    let THREE;
    try { THREE = await ctx.importModule("three", "0.164.1"); }
    catch (e) { try { ctx.platform.error({ stage: "library", message: String(e && e.message || e) }); } catch (err) { /* ignore */ } throw e; }
    layout();
    try { world = createWorld(THREE); }
    catch (e) { try { ctx.platform.error({ stage: "renderer", message: String(e && e.message || e) }); } catch (err) { /* ignore */ } throw e; }
    hud = createHud();
    bindInput(world.canvas);
    bindKeys();
    ctx.listen(window, "blur", () => { cancelAllPointers(); if (gameState === "play") paused = true; });
    ctx.listen(document, "visibilitychange", () => {
      if (document.hidden) { cancelAllPointers(); if (gameState === "play") paused = true; audio.suspend(); }
      else audio.resume();
    });
    layout();
    newRun();
    ctx.onResize(info => layout(info), { immediate: false });
    frame(1, 16);
    ctx.game.loop({ fixedHz: FIXED_HZ, maxSubsteps: 8, fixedUpdate: () => tick(), render: (alpha, state) => frame(alpha, state && state.dtMs) });
    ctx.onDestroy(() => {
      disposed = true; attempt++;
      try { if (ctx.music && ctx.music.stop) ctx.music.stop({ fadeOutMs: 100 }); } catch (e) { /* ignore */ }
      audio.suspend();
      try { world.renderer.dispose(); } catch (e) { /* ignore */ }
    });
    if (window.__PP_DEBUG) {
      window.__pp = {
        get player() { return player; }, get route() { return route; }, get run() { return run; }, get state() { return gameState; },
        records, stepPlayer, linkScore, makePlayer, newRun, handleTap, releaseLine, tick, DT, G, windFnFor, swingStates, cam,
        get S() { return S; }, _gen: () => addEncounter(), _dbg: (type, d, n) => { const out = []; for (let i = 0; i < n; i++) { const rng = mulberry32(i * 77 + 5); const c = buildCandidate(type, route.last, d, rng, 1, 0); const wind = windFnFor(c.winds); const plats = candPlats(c); out.push(c.links.map(([s2, d2, o]) => linkScore(s2, d2, o.others || [], plats, wind, Object.assign({ amp: DISTRICTS[d].amp }, o)) + '/' + Math.min(DISTRICTS[d].req, o.need || DISTRICTS[d].req)).join(',')); } return out; }, frame, setQuality: q => world.setQuality(q), world: () => world, flightOutcome, transferFlights, planFlythrough, planRoofbox, passesZone, DISTRICTS, windFnFor, mulberry32
      };
    }
    ctx.platform.ready();
  }
};
