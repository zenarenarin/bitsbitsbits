window.plethoraBit = {
  meta: {
    title: "Pendulum Postman",
    runtime: "plethora-bit@2",
    tags: ["arcade", "physics", "swing", "delivery"],
    permissions: ["haptics", "audio", "backgroundMusic", "storage"]
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
    const ANCHOR_MIN_Y = 220, ANCHOR_MAX_Y = 620;
    const LETTERS_PER_DISTRICT = 4;
    const TAU = Math.PI * 2;
    const SERIF = "Georgia, 'Times New Roman', serif";

    const DISTRICTS = [
      {
        name: "The Roof Colony", numeral: "I",
        sky: ["#e4dcc4", "#b4c9b8", "#6f9289"], far: "#8aa69c", mid: "#617f76", fog: "#7d9a90",
        mats: ["#7a5a3e", "#8b6a48", "#6e4f36", "#a07a52", "#66705a", "#8e7f63", "#9a6b4b"],
        roofs: ["#a07c5a", "#7c8c86", "#a5623f", "#6f7d74", "#8f6e4c"],
        reach: [214, 232], dx: [235, 285], dy: [-50, 60], zoneR: 44, plat: 0.9, letterEvery: 2, amp: 0.85,
        sig: "gap", pool: { gap: 3, rise: 2, dip: 2 }, phi: [2, 24], reel: false, req: 7, style: "house"
      },
      {
        name: "The Wire Market", numeral: "II",
        sky: ["#e0d7bf", "#a7c3b6", "#5b8580"], far: "#86a39c", mid: "#5a7a74", fog: "#76968d",
        mats: ["#7f5b40", "#5f7a6e", "#9b7650", "#6c5a48", "#a2694a", "#58706b", "#8c7a5c"],
        roofs: ["#b06a45", "#5f7c78", "#a58a5c", "#7d6a55", "#4f6b66"],
        reach: [200, 220], dx: [265, 320], dy: [-70, 80], zoneR: 38, plat: 0.65, letterEvery: 2, amp: 0.95,
        sig: "laundry", pool: { gap: 2, rise: 1, dip: 1, laundry: 3, fork: 2 }, phi: [-24, 30], reel: false, req: 5, style: "market"
      },
      {
        name: "The Liftworks", numeral: "III",
        sky: ["#d3d2c6", "#97aeaa", "#45656a"], far: "#7f9799", mid: "#526a6c", fog: "#6c8888",
        mats: ["#6d5a4a", "#5a6b6c", "#8a5a3e", "#4f5f61", "#7b6a58", "#94603f"],
        roofs: ["#8a5a3e", "#5d6f70", "#9b7a55", "#4c5c5e"],
        reach: [190, 210], dx: [280, 340], dy: [-80, 90], zoneR: 34, plat: 0.45, letterEvery: 2, amp: 1.0,
        sig: "pulley", pool: { gap: 1, rise: 1, laundry: 1, fork: 1, pulley: 3, longswing: 1 }, phi: [-34, 40], reel: true, req: 4, style: "lattice"
      },
      {
        name: "The Clock Spine", numeral: "IV",
        sky: ["#ddd2b6", "#a2b7a6", "#4a675e"], far: "#8b9f92", mid: "#56705f", fog: "#728f81",
        mats: ["#7a6248", "#5f6d5e", "#9a7448", "#6a5644", "#83734f", "#4f6358"],
        roofs: ["#9a7448", "#5d6f63", "#a8865a", "#6b5a46"],
        reach: [180, 202], dx: [290, 350], dy: [-90, 100], zoneR: 31, plat: 0.35, letterEvery: 2, amp: 1.05,
        sig: "clock", pool: { gap: 1, rise: 1, pulley: 2, clock: 3, fragile: 2, fork: 1 }, phi: [-44, 46], reel: true, req: 3, style: "spine"
      },
      {
        name: "The Upper Stacks", numeral: "V",
        sky: ["#e8e4d6", "#b2cbc8", "#5b7f83"], far: "#93adab", mid: "#5f7f80", fog: "#7f9c9c",
        mats: ["#6f6352", "#5c7272", "#8d6d4f", "#4f6566", "#7f7563", "#9a6a4a"],
        roofs: ["#7f8f8c", "#a06a48", "#5f7777", "#8e8068"],
        reach: [172, 196], dx: [300, 365], dy: [-90, 110], zoneR: 28, plat: 0.25, letterEvery: 2, amp: 1.1,
        sig: "wind", pool: { gap: 1, wind: 3, pulley: 1, clock: 1, fragile: 2, fork: 1, laundry: 1, longswing: 1 }, phi: [-54, 54], reel: true, req: 3, style: "stack"
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
      let c = null;
      try { c = document.createElement("canvas"); c.width = w; c.height = h; } catch (e) { c = null; }
      if (!c && typeof OffscreenCanvas !== "undefined") c = new OffscreenCanvas(w, h);
      return c;
    }

    // =====================================================================
    // 3. PERSISTENCE (viewer-local convenience only)
    // =====================================================================
    const canStore = !!(ctx.storage && (!ctx.capabilities || ctx.capabilities.storage !== false));
    function loadRecords() {
      let r = null;
      if (canStore) { try { r = ctx.storage.get("pp_records_v1"); } catch (e) { r = null; } }
      return Object.assign({
        best: 0, bestDeliveries: 0, bestStreak: 0, runs: 0, last: null, catches: 0,
        seenRelease: false, seenDeliver: false, seenReel: false, seenHop: false, seenPump: false, muted: false, bestDistrict: 0
      }, r || {});
    }
    const records = loadRecords();
    function saveRecords() {
      if (!canStore) return;
      try { ctx.storage.set("pp_records_v1", records); } catch (e) { /* storage unavailable */ }
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
        locked: false, broken: false, sag: 0, sagV: 0, sagMax: 14, load: 0, hold: 0, glint: 0, vib: 0,
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
        // critically damped: the line gives under load and settles, so the pivot stays readable
        a.sagV += (140 * (tgt - a.sag) - 2 * Math.sqrt(140) * a.sagV) * dt;
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
    // 6. ROUTE VALIDATION — real trajectories under the same physics.
    // =====================================================================
    const NO_PLATS = [];
    function windFnFor(winds) {
      return (x, y) => {
        let f = 0;
        for (let i = 0; i < winds.length; i++) {
          const w = winds[i];
          if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) {
            const e = Math.min(x - w.x0, w.x1 - x, 90) / 90;
            f += w.f * smooth(e);
          }
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
    function flightHits(s, tx, ty, R, wind, needAbove) {
      let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
      const k = 1 - AIR_DRAG * DT;
      for (let i = 0; i < 600; i++) {
        vx += wind(x, y) * DT; vy += G * DT; vx *= k; vy *= k;
        x += vx * DT; y += vy * DT;
        if (!needAbove || ty < y - 10) {
          const dx = x - tx, dy = y - ty;
          if (dx * dx + dy * dy <= R * R) return true;
        }
        if (y > DEATH_Y || x > tx + 600) return false;
      }
      return false;
    }
    // How many sampled release moments on `src` carry the courier into dst's catch zone.
    function linkScore(src, dst, wind, opts) {
      opts = opts || {};
      const sources = opts.srcPoints || [{ x: src.bx, y: src.by + (src.kind === "laundry" ? src.sagMax : 0) }];
      const targets = anchorSamples(dst);
      let worst = 1e9;
      for (const sp of sources) {
        let best = 0;
        for (const Lf of [0.97, 0.78]) {
          const L = clamp(src.reach * Lf, LMIN, LMAX);
          const states = swingStates(sp, L, opts.amp || 0.8, 40, wind, opts.maxT);
          for (const tp of targets) {
            let ok = 0;
            for (const s of states) if (flightHits(s, tp.x, tp.y, dst.reach * 0.95, wind, true)) ok++;
            if (ok > best) best = ok;
          }
        }
        if (best < worst) worst = best;
      }
      return worst;
    }
    function rewardReachable(src, pt, r, wind) {
      for (const Lf of [0.97, 0.8, 0.65]) {
        const L = clamp(src.reach * Lf, LMIN, LMAX);
        for (const amp of [0.8, 1.15]) {
          const states = swingStates({ x: src.bx, y: src.by }, L, amp, 30, wind);
          for (const s of states) if (flightHits(s, pt.x, pt.y, r, wind, false)) return true;
        }
      }
      return false;
    }

    // =====================================================================
    // 7. ROUTE GENERATION — authored encounter patterns assembled by seeded
    // rules; every mandatory link is validated before it becomes playable.
    // =====================================================================
    let route = null;
    function newRoute(seed) {
      return {
        seed, anchors: [], structures: [], platforms: [], deliveries: [], rewards: [], winds: [], decor: [],
        gates: [], genLog: [], frontX: 0, last: null, encIndex: 0, letters: 0, sinceLetter: 0, district: 0, firstInDistrict: false
      };
    }
    function districtIndexFor(letters) { return Math.min(4, Math.floor(letters / LETTERS_PER_DISTRICT)); }
    function lapFor(letters) { return Math.max(0, Math.floor(letters / LETTERS_PER_DISTRICT) - 4); }

    function addStructure(st) {
      st.id = ++uid;
      st.sprite = null;
      route.structures.push(st);
      return st;
    }
    function structureAt(x, y) {
      // reuse a support structure already near this point
      for (let i = route.structures.length - 1; i >= 0 && i > route.structures.length - 30; i--) {
        const s = route.structures[i];
        if (s.role !== "support") continue;
        if (Math.abs(s.x - x) < s.w * 0.5 + 10 && s.top < y - 10) return s;
      }
      return null;
    }
    function supportPoint(x, y, d, rng, kind) {
      const ex = structureAt(x, y);
      if (ex) return { x: clamp(x, ex.x - ex.w * 0.5 + 6, ex.x + ex.w * 0.5 - 6), y };
      const w = kind === "lattice" ? rr(rng, 46, 64) : rr(rng, 70, 130);
      const top = y - rr(rng, 30, 140);
      addStructure({ x, w, top, d, role: "support", style: kind || DISTRICTS[d].style, seed: Math.floor(rng() * 1e9), depth: 1 });
      return { x, y };
    }

    function decorateAnchor(a, d, rng) {
      const style = DISTRICTS[d].style;
      if (a.kind === "laundry") {
        const l = { x: a.bx - rr(rng, 120, 160), y: a.by - rr(rng, 26, 46) };
        const r = { x: a.bx + rr(rng, 120, 160), y: a.by - rr(rng, 26, 46) };
        a.line = [supportPoint(l.x, l.y, d, rng, "house"), supportPoint(r.x, r.y, d, rng, "house")];
        a.clothes = [];
        const n = 4 + Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) {
          let t = rr(rng, 0.08, 0.92);
          if (Math.abs(t - 0.5) < 0.1) t += 0.18 * Math.sign(t - 0.5 || 1);
          a.clothes.push({ t, w: rr(rng, 9, 18), h: rr(rng, 12, 24), c: pick(rng, ["#c9b48a", "#8fa9a3", "#b36a4f", "#d8d0bc", "#6e8c8a", "#a8875a", "#9b4f3f"]), ph: rng() * TAU, kind: rng() < 0.5 ? "shirt" : "sheet" });
        }
      } else if (a.kind === "pulley") {
        a.track = [supportPoint(a.cx - a.amp - rr(rng, 70, 110), a.by - 24, d, rng, "lattice"), supportPoint(a.cx + a.amp + rr(rng, 70, 110), a.by - 24, d, rng, "lattice")];
      } else if (a.kind === "clock") {
        addStructure({ x: a.hx, w: rr(rng, 150, 190), top: a.hy - rr(rng, 170, 260), d, role: "clock", style: "clock", seed: Math.floor(rng() * 1e9), depth: 1, hub: { x: a.hx, y: a.hy, R: a.R } });
      } else if (a.kind === "fragile") {
        a.beam = supportPoint(a.bx + rr(rng, -40, 40), a.by - rr(rng, 120, 160), d, rng, style);
      } else {
        a.cables = [
          supportPoint(a.bx - rr(rng, 120, 190), a.by - rr(rng, 50, 130), d, rng, style),
          supportPoint(a.bx + rr(rng, 120, 190), a.by - rr(rng, 50, 130), d, rng, style)
        ];
      }
    }

    function addPlatform(x, top, w, d, rng, opts) {
      const pl = { x0: x - w / 2 + 6, x1: x + w / 2 - 6, y: top, id: ++uid };
      route.platforms.push(pl);
      addStructure(Object.assign({ x, w, top, d, role: "platform", style: DISTRICTS[d].style, seed: Math.floor(rng() * 1e9), depth: 0, plat: pl }, opts || {}));
      return pl;
    }

    function buildCandidate(type, A, d, rng, scale, lap) {
      const P = DISTRICTS[d];
      const red = Math.min(30, lap * 6);
      const reach = () => rr(rng, P.reach[0] - red, P.reach[1] - red);
      const dxr = () => rr(rng, P.dx[0], P.dx[1]) * scale + lap * 8;
      const clampAY = y => clamp(y, ANCHOR_MIN_Y, ANCHOR_MAX_Y);
      const c = { anchors: [], links: [], exit: null, rewards: [], winds: [], platforms: [], delivery: null };
      const hook = (x, y, r, kind) => mkAnchor(kind || (r < 175 ? "eyelet" : r > 210 ? "hook" : "ring"), x, clampAY(y), r);
      if (type === "gap" || type === "rise" || type === "dip") {
        const dy = type === "rise" ? -rr(rng, 55, 95) : type === "dip" ? rr(rng, 70, 120) : rr(rng, P.dy[0], P.dy[1]) * 0.6;
        const B = hook(A.bx + dxr() * (type === "rise" ? 0.85 : type === "dip" ? 1.08 : 1), A.by + dy * scale, reach());
        c.anchors.push(B); c.links.push([A, B]); c.exit = B;
        if (type === "rise" && rng() < 0.55) c.rewards.push({ src: A, x: lerp(A.bx, B.bx, 0.55), y: Math.min(A.by, B.by) - rr(rng, 30, 70) });
        if (type === "dip") c.platforms.push({ x: lerp(A.bx, B.bx, 0.5), w: rr(rng, 150, 220), under: Math.max(A.by + A.reach, B.by + B.reach) + rr(rng, 70, 110) });
      } else if (type === "laundry") {
        const B = mkAnchor("laundry", A.bx + dxr() * 0.88, clampAY(A.by + rr(rng, -50, 50) * scale), reach() - 8);
        const C = mkAnchor("laundry", B.bx + dxr() * 0.86, clampAY(B.by + rr(rng, -60, 60) * scale), reach() - 8);
        c.anchors.push(B, C); c.links.push([A, B], [B, C]); c.exit = C;
        if (rng() < 0.5) c.rewards.push({ src: B, x: lerp(B.bx, C.bx, 0.5), y: Math.min(B.by, C.by) - rr(rng, 40, 80) });
      } else if (type === "fork") {
        const span = dxr() * 1.85;
        const Hh = hook(A.bx + span * 0.47, A.by - rr(rng, 55, 85) * scale, reach() - 10);
        const Lo = hook(A.bx + span * 0.55, A.by + rr(rng, 80, 120) * scale, reach());
        const M = hook(A.bx + span, A.by + rr(rng, -40, 40), reach());
        c.anchors.push(Hh, Lo, M);
        c.links.push([A, Hh], [A, Lo], [Hh, M], [Lo, M]); c.exit = M;
        c.rewards.push({ src: Hh, x: lerp(Hh.bx, M.bx, 0.5), y: Math.min(Hh.by, M.by) - rr(rng, 40, 90) });
      } else if (type === "pulley") {
        const pbx = A.bx + dxr() * 1.02;
        const B = mkAnchor("pulley", pbx, clampAY(A.by + rr(rng, -40, 50) * scale), reach() - 6,
          { cx: pbx, amp: rr(rng, 60, 95), speed: rr(rng, 0.8, 1.25), phase: rng() * TAU });
        const C = hook(B.cx + dxr() * 0.95, B.by + rr(rng, -60, 50) * scale, reach());
        c.anchors.push(B, C); c.exit = C;
        c.links.push([A, B], [B, C, { srcPoints: [{ x: B.cx - B.amp, y: B.by }, { x: B.cx, y: B.by }, { x: B.cx + B.amp, y: B.by }], need: 2 }]);
      } else if (type === "clock") {
        const hx = A.bx + dxr() * 1.05, hy = clampAY(A.by + rr(rng, -50, 20) * scale);
        const R = rr(rng, 52, 72);
        const B = mkAnchor("clock", hx, hy, reach(), { hx, hy, R, ang: rng() * TAU, angV: (rng() < 0.5 ? -1 : 1) * rr(rng, 0.55, 0.85) });
        const C = hook(hx + dxr() * 0.82 + R * 0.3, hy + rr(rng, 0, 70) * scale, reach());
        const pts = [];
        for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU; pts.push({ x: hx + Math.cos(t) * R, y: hy + Math.sin(t) * R }); }
        c.anchors.push(B, C); c.exit = C;
        c.links.push([A, B], [B, C, { srcPoints: pts, need: 1 }]);
      } else if (type === "fragile") {
        const B = mkAnchor("fragile", A.bx + dxr() * 0.82, clampAY(A.by + rr(rng, -40, 40) * scale), reach() - 10, { life: 1.7 });
        const C = hook(B.bx + dxr() * 0.82, B.by + rr(rng, -50, 50) * scale, reach());
        c.anchors.push(B, C); c.exit = C;
        c.links.push([A, B], [B, C, { maxT: 1.35 }]);
      } else if (type === "wind") {
        const head = rng() < 0.3;
        const f = head ? -rr(rng, 160, 230) : rr(rng, 240, 340);
        const span = dxr() * (head ? 0.9 : 1.22);
        const B = hook(A.bx + span, A.by + rr(rng, -50, 50) * scale, reach());
        c.winds.push({ x0: A.bx - 40, x1: B.bx + 20, y0: -500, y1: FOG_Y + 200, f });
        c.anchors.push(B); c.links.push([A, B]); c.exit = B;
        if (!head && rng() < 0.6) c.rewards.push({ src: A, x: lerp(A.bx, B.bx, 0.5), y: Math.min(A.by, B.by) - rr(rng, 50, 100) });
      } else if (type === "longswing") {
        const B = hook(A.bx + dxr(), A.by + rr(rng, -70, 0) * scale, reach() + 12, "hook");
        const C = hook(B.bx + dxr() * 0.95, B.by + rr(rng, -40, 60) * scale, reach());
        c.anchors.push(B, C); c.links.push([A, B], [B, C]); c.exit = C;
        const rad = rr(rng, 262, 288), ang = rr(rng, -0.35, 0.35);
        c.rewards.push({ src: null, x: B.bx + Math.sin(ang) * rad, y: B.by + Math.cos(ang) * rad, fixed: true });
      } else if (type === "delivery") {
        const D = hook(A.bx + dxr() * 0.98, A.by + rr(rng, -50, 50) * scale, reach(), "hook");
        const E = hook(D.bx + dxr() * 0.95, D.by + rr(rng, -50, 50) * scale, reach());
        c.anchors.push(D, E); c.links.push([A, D], [D, E]); c.exit = E;
        const phi = (P.phi[0] + rng() * (P.phi[1] - P.phi[0])) * (Math.PI / 180);
        let dz;
        if (!P.reel || rng() < 0.3) dz = D.reach * rr(rng, 0.9, 0.96);
        else dz = rng() < 0.5 ? D.reach * rr(rng, 0.62, 0.78) : clamp(D.reach * rr(rng, 1.15, 1.3), LMIN + 20, LMAX - 12);
        const zr = P.zoneR - Math.min(8, lap * 2);
        const zx = D.bx + Math.sin(phi) * dz, zy = D.by + Math.cos(phi) * dz;
        c.delivery = { D, x: zx, y: zy, r: zr, dz, phi, parcel: d >= 2 && rng() < 0.4 };
      }
      // drift correction: keep the route in the middle band of the city
      let bias = clamp((430 - A.by) * 0.35, -60, 60);
      if ((type === "rise" && bias < 0) || (type === "dip" && bias > 0)) bias *= 0.3;
      if (Math.abs(bias) > 1) {
        for (const a of c.anchors) {
          const ny = clampAY(a.by + bias), dyb = ny - a.by;
          a.by = ny; a.hy += dyb;
          updateAnchorPos(a, 0); a.px = a.x; a.py = a.y;
        }
        for (const rw of c.rewards) rw.y += bias;
        for (const pp of c.platforms) pp.under += bias;
        if (c.delivery) { const dv = c.delivery; dv.x = dv.D.bx + Math.sin(dv.phi) * dv.dz; dv.y = dv.D.by + Math.cos(dv.phi) * dv.dz; }
      }
      return c;
    }

    function validateCandidate(c, d) {
      const wind = windFnFor(route.winds.concat(c.winds));
      const need = DISTRICTS[d].req, amp = DISTRICTS[d].amp;
      for (const [src, dst, opts] of c.links) {
        if (linkScore(src, dst, wind, Object.assign({ amp }, opts)) < Math.min(need, (opts && opts.need) || need)) return false;
      }
      return true;
    }

    function commitCandidate(c, d, rng, type) {
      const P = DISTRICTS[d];
      for (const a of c.anchors) { a.d = d; route.anchors.push(a); decorateAnchor(a, d, rng); }
      for (const w of c.winds) {
        route.winds.push(w);
        const hosts = route.structures.filter(st => st.x > w.x0 && st.x < w.x1 && st.depth < 2);
        for (let i = 0; i < Math.min(5, hosts.length * 2); i++) {
          const st = pick(rng, hosts), side = Math.sign(w.f) || 1;
          route.decor.push({ kind: "flag", x: st.x + side * st.w * 0.5, y: clamp(st.top + rr(rng, 30, 260), 200, 820), f: w.f, ph: rng() * TAU, len: rr(rng, 30, 54), c: pick(rng, ["#b5523b", "#c9b48a", "#6e8c8a", "#a8875a"]) });
        }
      }
      const wind = windFnFor(route.winds);
      for (const rw of c.rewards) {
        let pt = { x: rw.x, y: rw.y }, ok = rw.fixed;
        for (let i = 0; i < 6 && !ok; i++) {
          if (rewardReachable(rw.src, pt, 22, wind)) ok = true;
          else { pt.x = lerp(pt.x, rw.src.bx + rw.src.reach * 0.6, 0.18); pt.y = lerp(pt.y, rw.src.by + 40, 0.22); }
        }
        if (ok) route.rewards.push({ id: ++uid, x: pt.x, y: pt.y, r: 20, taken: false, ph: rng() * TAU });
      }
      // safety roofs under anchors (one-way platforms the courier can land on)
      for (const a of c.anchors) {
        if (rng() < P.plat && a.kind !== "clock") {
          const top = Math.min(FOG_Y - 110, a.by + Math.max(a.reach, 220) + rr(rng, 70, 130));
          if (top < FOG_Y - 100) addPlatform(a.bx + rr(rng, -30, 70), top, rr(rng, 140, 220), d, rng);
        }
      }
      for (const pp of c.platforms) {
        const top = Math.min(FOG_Y - 110, pp.under);
        addPlatform(pp.x, top, pp.w, d, rng);
      }
      if (c.delivery) {
        const dv = c.delivery;
        const n = route.deliveries.length;
        const recip = {
          id: ++uid, index: n, D: dv.D, x: dv.x, y: dv.y, r: dv.r, dz: dv.dz, phi: dv.phi, parcel: dv.parcel,
          name: NAMES[hash2(route.seed, n * 7 + 3) % NAMES.length], symbol: SYMBOLS[hash2(route.seed, n * 11 + 5) % SYMBOLS.length],
          number: 3 + (hash2(route.seed, n * 13 + 1) % 96), status: "pending", d, inZone: false, minD: 1e9, prevD: 1e9, speedAtMin: 0,
          flash: 0, wave: 0
        };
        recip.D.isDelivery = true;
        route.deliveries.push(recip);
        // recipient house sits behind the swing plane with the lit window at the zone
        const w = rr(rng, 150, 200);
        addStructure({ x: dv.x + rr(rng, -25, 25), w, top: dv.y - rr(rng, 90, 170), d, role: "recipient", style: P.style, seed: Math.floor(rng() * 1e9), depth: 1, recip });
        route.letters++;
        route.sinceLetter = 0;
      } else route.sinceLetter++;
      // decorative non-catchable wires (telephone/power) — no rings, thin, insulated
      if (rng() < 0.85) {
        const x0 = c.anchors[0].bx - rr(rng, 60, 200), x1 = c.exit.bx + rr(rng, -60, 80);
        route.decor.push({ kind: "wire", x0, y0: rr(rng, 120, 320), x1, y1: rr(rng, 120, 320), sag: rr(rng, 30, 90), w: rr(rng, 0.8, 1.4) });
      }
      // tall spires that run above the frame: the city keeps going up
      if (rng() < 0.75) addStructure({ x: rr(rng, route.frontX + 60, c.exit.bx - 60), w: rr(rng, 70, 120), top: rr(rng, -520, -120), d, role: "spire", style: P.style === "lattice" ? "house" : P.style, seed: Math.floor(rng() * 1e9), depth: 2 });
      // deep background stacks for density
      for (let i = 0; i < 2; i++) {
        addStructure({ x: rr(rng, route.frontX, c.exit.bx), w: rr(rng, 110, 190), top: rr(rng, 760, 880), d, role: "deep", style: P.style, seed: Math.floor(rng() * 1e9), depth: 2 });
      }
      route.last = c.exit;
      route.frontX = c.exit.bx;
      route.encIndex++;
      route.lastType = type;
    }

    function addEncounter() {
      const d = districtIndexFor(route.letters);
      const lap = lapFor(route.letters);
      if (d !== route.district) {
        route.district = d; route.firstInDistrict = true;
        route.gates.push({ x: route.frontX + 120, d });
      }
      const P = DISTRICTS[d];
      const rng = mulberry32(hash2(route.seed, route.encIndex + 1));
      let type;
      if (route.sinceLetter >= P.letterEvery) type = "delivery";
      else if (route.firstInDistrict) type = P.sig;
      else {
        type = weighted(rng, P.pool);
        if (type === route.lastType && rng() < 0.5) type = weighted(rng, P.pool);
        if (type === "dip" && route.last.by > 520) type = "rise";
        else if (type === "rise" && route.last.by < 300) type = "dip";
      }
      route.firstInDistrict = false;
      const A = route.last;
      for (const scale of [1, 0.92, 0.85, 0.78, 0.7, 0.62]) {
        const crng = mulberry32(hash2(route.seed, route.encIndex * 31 + Math.round(scale * 100)));
        const c = buildCandidate(type, A, d, crng, scale, lap);
        if (validateCandidate(c, d)) { commitCandidate(c, d, crng, type); if (route.genLog.length < 200) route.genLog.push(type + "@" + scale); return; }
      }
      // Guaranteed fallback: a plain gap, shortened until the physics proves it reachable.
      for (let k = 0; k < 12; k++) {
        const crng = mulberry32(hash2(route.seed, route.encIndex * 97 + k));
        const reach = DISTRICTS[d].reach[1];
        const B = mkAnchor("hook", A.bx + DISTRICTS[d].dx[0] - k * 14, clamp(A.by + 20, ANCHOR_MIN_Y, ANCHOR_MAX_Y), reach);
        const c = { anchors: [B], links: [[A, B]], exit: B, rewards: [], winds: [], platforms: [], delivery: null };
        if (type === "delivery") {
          const dz = B.reach * 0.93;
          c.delivery = { D: B, x: B.bx + Math.sin(0.2) * dz, y: B.by + Math.cos(0.2) * dz, r: DISTRICTS[d].zoneR, dz, phi: 0.2, parcel: false };
        }
        if (k === 11 || validateCandidate(c, d)) { commitCandidate(c, d, crng, type); if (route.genLog.length < 200) route.genLog.push(type + "!fallback" + k); return; }
      }
    }

    function buildStart(seed) {
      route = newRoute(seed);
      uid = 0;
      const rng = mulberry32(hash2(seed, 0));
      const A0 = mkAnchor("hook", 0, 380, 232);
      A0.d = 0; A0.start = true;
      route.anchors.push(A0);
      decorateAnchor(A0, 0, rng);
      // the post office: roof ledge the courier steps off
      const po = { x0: -250, x1: -130, y: 532, id: ++uid };
      route.platforms.push(po);
      addStructure({ x: -250, w: 260, top: 532, d: 0, role: "post", style: "post", seed: 777, depth: 0, plat: po });
      route.last = A0; route.frontX = 0; route.sinceLetter = 1;
      route.startPlat = po;
    }
    function ensureRoute(x) {
      let guard = 0;
      while (route.frontX < x + 2600 && guard++ < 8) addEncounter();
    }
    function pruneRoute(x) {
      const cut = x - 2400;
      const keep = o => (o.x1 !== undefined ? o.x1 : o.x !== undefined ? o.x : o.bx) > cut;
      route.anchors = route.anchors.filter(a => a.bx > cut || a === player.anchor);
      route.platforms = route.platforms.filter(p => p.x1 > cut);
      route.structures = route.structures.filter(s => { const k = s.x + s.w > cut; if (!k) s.sprite = null; return k; });
      route.rewards = route.rewards.filter(keep);
      route.decor = route.decor.filter(o => (o.x1 !== undefined ? o.x1 : o.x) > cut);
      route.winds = route.winds.filter(w => w.x1 > cut);
    }

    // =====================================================================
    // 8. GAME STATE
    // =====================================================================
    const player = makePlayer();
    let run = null;
    let attempt = 0;
    let disposed = false;
    let gameState = "title"; // title | play | dying | results
    let paused = false;
    let simTime = 0;
    let eventStep = 0;      // increments on any discrete event (for tap rollback)
    let stepCounter = 0;
    const score = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;
    let worldWind = () => 0;

    const fx = { texts: [], parts: [], stamps: [], shake: 0, flash: 0, banner: null, hint: null, ropeVib: 0, ropeExtend: 1, retract: null, nearMiss: null };

    function newRun() {
      attempt++;
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0xffff)) >>> 0;
      buildStart(seed);
      Object.assign(player, makePlayer());
      const A0 = route.anchors[0];
      player.x = -150; player.y = route.startPlat.y; player.mode = "ground"; player.plat = route.startPlat;
      player.anchor = A0; player.L = Math.hypot(player.x - A0.x, player.y - A0.y); A0.locked = true; A0.load = 1;
      player.px = player.x; player.py = player.y;
      ensureRoute(0);
      run = {
        seed, score: 0, delivered: 0, gold: 0, missed: 0, streak: 0, bestStreak: 0, airmail: 0, clean: 0, chain: 0, bestChain: 0,
        maxX: 0, distPts: 0, district: 0, started: false, deathReason: "", dyingT: 0, lastFlightNear: null, catches: 0, ledger: [],
        reelUsed: 0, resultsAt: 0, hangT: 0
      };
      if (score) score.reset();
      fx.texts.length = 0; fx.parts.length = 0; fx.banner = null; fx.nearMiss = null; fx.retract = null; fx.ropeExtend = 1;
      cam.x = player.x + 160; cam.y = 470; cam.snap = true;
      gameState = "title";
      simTime = 0;
      flightNear.clear();
    }

    function addScore(n, reason) {
      if (!n) return;
      run.score += n;
      if (score) score.add(n, { reason });
    }

    function floatText(x, y, text, color, size) {
      fx.texts.push({ x, y, text, color: color || "#f3e7c9", size: size || 13, t: 0, life: 1.3 });
    }
    function burst(x, y, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = (0.3 + Math.random() * 0.7) * (spd || 120);
        fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, t: 0, life: (life || 0.6) * (0.6 + Math.random() * 0.6), c: color || "#f6d38a", s: 1.5 + Math.random() * 2, g: 260, kind: "spark" });
      }
    }

    // ---- gameplay events from physics
    const flightNear = new Map();
    function onEvent(type, data) {
      eventStep = stepCounter;
      if (type === "catch") {
        const a = data.a;
        const prevAnchorId = run.lastReleasedId;
        run.catches++;
        records.catches++;
        fx.ropeExtend = 0; fx.ropeVib = Math.min(9, 2 + data.jerk * 0.01);
        a.vib = 1;
        const clean = data.retention > 0.9 && data.speed > 260;
        let pts = 0;
        if (prevAnchorId && prevAnchorId !== a.id && !a.start) {
          if (clean) {
            run.clean++; run.chain++; run.bestChain = Math.max(run.bestChain, run.chain);
            pts += 10;
            if (run.chain >= 3) { pts += 5 * Math.min(run.chain, 10); if (run.chain % 3 === 0 || run.chain < 6) floatText(a.x, a.y - 24, "Flow ×" + run.chain, "#f6d38a", 12); }
          } else run.chain = 0;
          if (a.reach < 168) { pts += 15; floatText(a.x, a.y - 44, "Tight catch", "#e9dcc0", 11); }
          addScore(pts, "transfer");
        }
        if (a.kind === "fragile") a.hold = 0;
        audio.catchSfx(clean ? 1 : 0.5, a.kind);
        haptic(clean ? "light" : "light");
        burst(a.x, a.y, clean ? 7 : 3, clean ? "#f6d38a" : "#cbbf9f", 90, 0.4);
        flightNear.clear();
        // missed letters: catching an anchor clearly past the active recipient
        const L = activeLetter();
        if (L && a !== L.D && a.bx > L.D.bx + 40 && !a.start) missLetter(L, "passed");
        ctx.platform.interact && ctx.platform.interact({ type: "catch" });
      } else if (type === "taut") {
        fx.ropeVib = Math.min(10, data * 0.02);
        if (data > 140) audio.creak(Math.min(1, data / 700));
      } else if (type === "land") {
        audio.land(Math.min(1, data / 900));
        burst(player.x, player.y, 5, "#b9ad92", 60, 0.35);
        if (data > 300) haptic("light");
      }
    }

    function activeLetter() {
      const ds = route.deliveries;
      for (let i = 0; i < ds.length; i++) if (ds[i].status === "pending") return ds[i];
      return null;
    }

    function missLetter(L, why) {
      if (L.status !== "pending") return;
      L.status = "missed";
      run.missed++;
      run.streak = 0;
      run.ledger.push({ kind: "missed", symbol: L.symbol });
      floatText(player.x, player.y - 40, "Letter returned", "#d9b3a3", 12);
      audio.miss();
    }

    function deliver(L) {
      L.status = "delivered";
      const precision = clamp(1 - L.minD / L.r, 0, 1);
      const gentle = !L.parcel || L.speedAtMin < 430;
      const gold = precision >= 0.45 && gentle;
      run.delivered++; run.streak++; run.bestStreak = Math.max(run.bestStreak, run.streak);
      if (gold) run.gold++;
      const mult = 1 + 0.2 * Math.min(run.streak - 1, 10);
      const pts = Math.round((100 + 60 * precision) * (gold ? 1.5 : 1) * mult * (1 + 0.15 * L.d));
      addScore(pts, "delivery");
      run.ledger.push({ kind: gold ? "gold" : "ink", symbol: L.symbol });
      L.flash = 1; L.wave = 1;
      floatText(L.x, L.y - 30, "+" + pts, "#ffe2a0", 16);
      if (gold) floatText(L.x, L.y - 50, L.parcel ? "Gentle hands" : "Clean delivery", "#f6d38a", 11);
      else if (!gentle) floatText(L.x, L.y - 50, "Parcel rattled", "#d9c3a3", 11);
      fx.stamps.push({ t: 0, gold, symbol: L.symbol });
      burst(L.x, L.y, 14, "#f3e2b8", 140, 0.8);
      for (let i = 0; i < 6; i++) fx.parts.push({ x: L.x, y: L.y, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 60, t: 0, life: 1.6, c: "#efe4c8", s: 3, g: 60, kind: "paper", r: Math.random() * TAU });
      audio.deliver(gold);
      haptic("success");
      records.seenDeliver = true;
      ctx.platform.interact && ctx.platform.interact({ type: "delivery" });
      if (route.deliveries.filter(x => x.status !== "pending").length % LETTERS_PER_DISTRICT === 0) {
        // district progression milestone is announced when the gate is crossed
      }
    }

    function gameStep(dt) {
      stepCounter++;
      simTime += dt;
      for (const a of route.anchors) {
        if (a.kind === "laundry" && a !== player.anchor) a.load = 0;
        updateAnchorPos(a, dt);
        if (a.vib > 0) a.vib = Math.max(0, a.vib - dt * 1.5);
      }
      // fragile line: holds only briefly under load
      const pa = player.anchor;
      if (pa && pa.kind === "fragile" && player.mode !== "ground") {
        pa.hold += dt;
        if (pa.hold > pa.life) {
          pa.broken = true; pa.catchable = false;
          releaseLine(true);
          floatText(pa.x, pa.y - 20, "The frayed line snaps", "#d9b3a3", 11);
          audio.snap();
          haptic("warning");
        }
      }
      const W = { wind: worldWind, platforms: route.platforms, anchors: route.anchors, ev: onEvent };
      stepPlayer(player, dt, W);
      if (player.anchor && player.mode === "swing") {
        run.hangT += dt;
        if (run.hangT > 5 && player.Ldot < -40 && Math.abs(player.th) < 0.3) records.seenPump = true;
      } else run.hangT = 0;

      // airborne near-miss bookkeeping (why did a fall happen?)
      if (!player.anchor && player.mode === "fly") {
        for (const a of route.anchors) {
          if (!a.catchable || a.broken || a === player.exclude) continue;
          if (Math.abs(a.x - player.x) > 420) continue;
          if (a.y < player.y - 10) {
            const gap = Math.hypot(player.x - a.x, player.y - a.y) - a.reach;
            const prev = flightNear.get(a);
            if (prev === undefined || gap < prev) flightNear.set(a, gap);
          }
        }
      }

      // deliveries: deliver at the closest point of the pass through the window zone
      const L = activeLetter();
      if (L && player.mode !== "ground") {
        const dd = Math.hypot(player.x - L.x, player.y - L.y);
        if (dd < L.r) {
          if (!L.inZone) { L.inZone = true; L.minD = dd; L.speedAtMin = Math.hypot(player.vx, player.vy); }
          if (dd < L.minD) { L.minD = dd; L.speedAtMin = Math.hypot(player.vx, player.vy); }
          if (dd > L.prevD + 0.001) deliver(L);
        } else if (L.inZone) deliver(L);
        L.prevD = dd;
        if (L.status === "pending" && player.x > L.x + 760 && player.mode !== "ground") missLetter(L, "far");
      }
      // airmail stamps: stable identities, each scores once
      for (const rw of route.rewards) {
        if (rw.taken) continue;
        if (Math.abs(rw.x - player.x) < rw.r + 8 && Math.abs(rw.y - player.y) < rw.r + 8 && Math.hypot(rw.x - player.x, rw.y - player.y) < rw.r + 8) {
          rw.taken = true; run.airmail++;
          addScore(75, "airmail");
          floatText(rw.x, rw.y - 18, "Airmail +75", "#f6d38a", 12);
          burst(rw.x, rw.y, 10, "#f0c87a", 110, 0.6);
          audio.airmail(); haptic("light");
        }
      }
      // progress: only new ground covered counts
      if (player.x > run.maxX) {
        run.maxX = player.x;
        const pts = Math.floor(run.maxX / 100) * 2;
        if (pts > run.distPts) { addScore(pts - run.distPts, "distance"); run.distPts = pts; }
      }
      // district gate crossing
      for (const g of route.gates) {
        if (!g.seen && player.x > g.x) {
          g.seen = true; run.district = Math.max(run.district, g.d);
          fx.banner = { t: 0, d: g.d };
          audio.district();
          ctx.platform.milestone && ctx.platform.milestone("district_" + (g.d + 1), { name: DISTRICTS[g.d].name });
        }
      }
      if (player.y > FOG_Y - 30 && gameState === "play") {
        gameState = "dying"; run.dyingT = 0;
        let near = null, gap = 1e9;
        flightNear.forEach((g, a) => { if (g < gap) { gap = g; near = a; } });
        run.deathNear = near && gap < 45 ? { a: near, gap: Math.max(1, Math.round(gap)) } : null;
        fx.nearMiss = run.deathNear ? { a: near, t: 0 } : null;
        audio.fall();
        haptic("error");
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
      run.lastReleasedId = a.id;
      eventStep = stepCounter;
      flightNear.clear();
      if (!forced) { audio.release(Math.hypot(player.vx, player.vy)); records.seenRelease = true; }
      return true;
    }

    function hop(dir) {
      const a = player.anchor;
      if (a) {
        // Stepping off a ledge while hooked: the taut line turns the ledge angle into a swing.
        const dx = player.x - a.x, dy = player.y - a.y, d = Math.hypot(dx, dy);
        const th = Math.atan2(dx, dy);
        if (player.mode === "ground" && d >= player.L - 6 && dy > 0) {
          // push off the roof with the legs while the line stays taut
          player.leftPlat = player.plat;
          player.L = clamp(d, LMIN, LMAX);
          player.mode = "swing"; player.plat = null; player.th = th;
          player.om = (dir || 1) * KICK / player.L;
          player.x = a.x + player.L * Math.sin(th); player.y = a.y + player.L * Math.cos(th);
          eventStep = stepCounter;
          audio.hop();
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
      if (gameState === "play" && run.started) records.seenHop = true;
    }

    // Snapshot-based release: a tap is confirmed on pointer-up, but the release
    // is applied from the state at pointer-down so timing feels exact. Only
    // used when nothing discrete happened in between.
    function snapshot() {
      return {
        x: player.x, y: player.y, vx: player.vx, vy: player.vy, mode: player.mode, th: player.th, om: player.om,
        L: player.L, anchor: player.anchor, step: stepCounter, ev: eventStep, time: simTime
      };
    }
    function releaseFromSnapshot(sn) {
      const elapsed = stepCounter - sn.step;
      if (!sn || sn.anchor !== player.anchor || sn.ev !== eventStep || sn.mode !== "swing" || player.mode !== "swing" || elapsed <= 0 || elapsed > 36) {
        return releaseLine(false);
      }
      const ox = player.x, oy = player.y;
      player.x = sn.x; player.y = sn.y; player.vx = sn.vx; player.vy = sn.vy;
      player.th = sn.th; player.om = sn.om; player.L = sn.L;
      releaseLine(false);
      const W = { wind: worldWind, platforms: route.platforms, anchors: route.anchors, ev: onEvent };
      for (let i = 0; i < elapsed * SUBSTEPS && player.mode === "fly"; i++) stepPlayer(player, DT, W);
      // visual smoothing of the tiny correction
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
    // 10. RENDERING SETUP
    // =====================================================================
    const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, alpha: false, touchAction: "none" });
    const mainG = canvas.getContext("2d");
    let g = mainG;
    // low-resolution buffer for the hazy backdrop (sky, distant city, deep stacks)
    const bg = { cv: null, g: null, k: 1, w: 0, h: 0 };
    function ensureBg() {
      const k = Math.max(0.7, 0.55 * dpr);
      const w = Math.ceil(Wd * k), h = Math.ceil(Hd * k);
      if (!bg.cv || bg.w !== w || bg.h !== h) {
        bg.cv = makeCanvas(w, h); bg.g = bg.cv ? bg.cv.getContext("2d") : null; bg.w = w; bg.h = h;
      }
      bg.k = k;
      return !!bg.g;
    }
    let Wd = ctx.width || 390, Hd = ctx.height || 844, S = 0.6, dpr = 1, spriteRes = 1, W2 = 0, H2 = 0;
    const cam = { x: 0, y: 470, snap: true, vx: 0 };
    const safe = { top: 0, bottom: 0 };
    let farTiles = {};
    function layout(info) {
      Wd = (info && info.width) || ctx.width || 390;
      Hd = (info && info.height) || ctx.height || 844;
      dpr = Math.min(2, ctx.dpr || window.devicePixelRatio || 1);
      const sa = (info && info.safeArea) || ctx.safeArea || {};
      safe.top = sa.top || 0; safe.bottom = sa.bottom || 0;
      const portrait = Hd > Wd;
      S = Math.min(Wd / (portrait ? 640 : 900), Hd / 720);
      S = clamp(S, 0.35, 2);
      W2 = Wd / 2; H2 = Hd / 2;
      const nr = clamp(S * dpr, 0.55, 1.25);
      if (Math.abs(nr - spriteRes) / spriteRes > 0.25) {
        spriteRes = nr;
        if (route) for (const s of route.structures) s.sprite = null;
        farTiles = {};
      }
      spriteRes = nr;
      cam.snap = true;
    }
    const sx = x => (x - cam.x) * S + W2;
    const sy = y => (y - cam.y) * S + H2;

    // =====================================================================
    // 11. PAINTERLY SPRITES — every structure is painted once into a cached
    // canvas: layered material dabs, grime, patched roofs, warm windows.
    // =====================================================================
    function dabs(c, rng, x, y, w, h, base, n, amt, alpha) {
      for (let i = 0; i < n; i++) {
        c.globalAlpha = (alpha || 0.22) * (0.5 + rng());
        c.fillStyle = jitterColor(rng, base, amt);
        const dw = rr(rng, 3, 14), dh = rr(rng, 1.5, 5);
        c.save();
        c.translate(x + rng() * w, y + rng() * h);
        c.rotate((rng() - 0.5) * 0.5);
        c.fillRect(-dw / 2, -dh / 2, dw, dh);
        c.restore();
      }
      c.globalAlpha = 1;
    }
    function grime(c, rng, x, y, w, h, n) {
      for (let i = 0; i < n; i++) {
        const gx = x + rng() * w, gy = y + rng() * h * 0.6, gl = rr(rng, 10, h * 0.7);
        const gr = c.createLinearGradient(0, gy, 0, gy + gl);
        gr.addColorStop(0, "rgba(30,28,24,0.22)"); gr.addColorStop(1, "rgba(30,28,24,0)");
        c.fillStyle = gr; c.fillRect(gx, gy, rr(rng, 1, 3.5), gl);
      }
    }
    function paintWindow(c, rng, x, y, w, h, lit, st, P) {
      c.fillStyle = "#2a2622"; c.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
      if (lit) {
        const gr = c.createLinearGradient(x, y, x, y + h);
        gr.addColorStop(0, "#ffd890"); gr.addColorStop(1, "#d9883e");
        c.fillStyle = gr; c.fillRect(x, y, w, h);
        c.globalAlpha = 0.35; c.fillStyle = "#7a3f22";
        if (rng() < 0.5) c.fillRect(x, y, w * rr(rng, 0.2, 0.45), h); // curtain
        c.globalAlpha = 1;
        const glow = c.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, w * 1.6);
        glow.addColorStop(0, "rgba(255,200,120,0.28)"); glow.addColorStop(1, "rgba(255,200,120,0)");
        c.fillStyle = glow; c.fillRect(x - w, y - h, w * 3, h * 3);
        if (st && st.lamps && rng() < 0.35) st.lamps.push({ x: st.ox + x + w / 2, y: st.oy + y + h / 2, r: w * 1.4, ph: rng() * TAU, fl: rng() < 0.3 });
      } else {
        const gr = c.createLinearGradient(x, y, x + w, y + h);
        gr.addColorStop(0, "#3d5552"); gr.addColorStop(1, "#1f2c2c");
        c.fillStyle = gr; c.fillRect(x, y, w, h);
        c.fillStyle = "rgba(220,235,225,0.18)"; c.fillRect(x + 1, y + 1, w * 0.3, h * 0.5);
      }
      c.strokeStyle = "rgba(40,34,28,0.8)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.moveTo(x, y + h * 0.45); c.lineTo(x + w, y + h * 0.45); c.stroke();
      c.fillStyle = "#5a4a3a"; c.fillRect(x - 2.5, y + h, w + 5, 2.2);
      if (rng() < 0.3) { // plant on the sill
        for (let i = 0; i < 6; i++) { c.fillStyle = jitterColor(rng, "#5d7d43", 40); c.beginPath(); c.arc(x + rng() * w, y + h - 2 - rng() * 5, rr(rng, 1.5, 3), 0, TAU); c.fill(); }
        c.fillStyle = "#8a4f34"; c.fillRect(x + w * 0.3, y + h - 2, w * 0.4, 3);
      }
    }
    function corrugatedRoof(c, rng, x0, x1, y, pitch, color, over) {
      over = over || 8;
      const mid = (x0 + x1) / 2 + rr(rng, -10, 10);
      c.fillStyle = color;
      c.beginPath(); c.moveTo(x0 - over, y + 3); c.lineTo(mid, y - pitch); c.lineTo(x1 + over, y + 3); c.lineTo(x1 + over, y + 6); c.lineTo(x0 - over, y + 6); c.closePath(); c.fill();
      // patchwork sheets
      c.save(); c.clip();
      for (let i = 0; i < 5; i++) {
        c.fillStyle = jitterColor(rng, pick(rng, ["#8a8f86", "#a0623f", "#7c6a52", "#5f7774", "#b08a5e"]), 30);
        c.globalAlpha = 0.55;
        const px = rr(rng, x0 - over, x1), pw = rr(rng, 14, 40);
        c.fillRect(px, y - pitch, pw, pitch + 8);
      }
      c.globalAlpha = 0.25; c.strokeStyle = "#1f1d1a"; c.lineWidth = 0.8;
      for (let x = x0 - over; x < x1 + over; x += 3.2) { c.beginPath(); c.moveTo(x, y - pitch); c.lineTo(x, y + 6); c.stroke(); }
      c.globalAlpha = 1; c.restore();
      c.strokeStyle = "rgba(240,225,190,0.45)"; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x0 - over, y + 3); c.lineTo(mid, y - pitch); c.lineTo(x1 + over, y + 3); c.stroke();
      c.fillStyle = "rgba(20,18,16,0.35)"; c.fillRect(x0 - over, y + 6, x1 - x0 + over * 2, 3);
    }
    function paintRoom(c, rng, r, P, st, litChance, style) {
      const base = jitterColor(rng, r.mat, 26);
      c.fillStyle = base; c.fillRect(r.x, r.y, r.w, r.h);
      const sh = c.createLinearGradient(r.x, 0, r.x + r.w, 0);
      sh.addColorStop(0, "rgba(255,240,210,0.10)"); sh.addColorStop(0.55, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(10,14,16,0.28)");
      c.fillStyle = sh; c.fillRect(r.x, r.y, r.w, r.h);
      dabs(c, rng, r.x, r.y, r.w, r.h, r.mat, Math.floor(r.w * r.h / 260) + 8, 50, 0.22);
      if (rng() < 0.55) { // timber planks
        c.strokeStyle = "rgba(25,20,15,0.16)"; c.lineWidth = 0.8;
        for (let yy = r.y + 6; yy < r.y + r.h; yy += rr(rng, 5, 8)) { c.beginPath(); c.moveTo(r.x, yy); c.lineTo(r.x + r.w, yy + rr(rng, -1, 1)); c.stroke(); }
      }
      const nw = Math.max(1, Math.floor(r.w / 44));
      for (let i = 0; i < nw; i++) {
        if (rng() < 0.15) continue;
        const ww = rr(rng, 10, 18), wh = rr(rng, 15, 26);
        const wxp = r.x + (r.w / nw) * (i + 0.5) - ww / 2 + rr(rng, -5, 5);
        const wyp = r.y + rr(rng, 12, Math.max(13, r.h - wh - 12));
        paintWindow(c, rng, wxp, wyp, ww, wh, rng() < litChance, st, P);
      }
      grime(c, rng, r.x, r.y, r.w, r.h, Math.floor(r.w / 18));
      c.fillStyle = "rgba(25,22,18,0.55)"; c.fillRect(r.x - 2, r.y + r.h - 3, r.w + 4, 3.5);
      if (style === "market" && rng() < 0.55) { // shop sign / awning
        if (rng() < 0.5) {
          const aw = Math.min(r.w - 6, rr(rng, 30, 60)), ax = r.x + rr(rng, 3, Math.max(4, r.w - aw - 3)), ay = r.y + r.h - 22;
          for (let k = 0; k < aw; k += 6) { c.fillStyle = (k / 6) % 2 ? "#d8cfb6" : pick(rng, ["#a8483a", "#4f7b75", "#b58a42"]); c.beginPath(); c.moveTo(ax + k, ay); c.lineTo(ax + k + 6, ay); c.lineTo(ax + k + 7, ay + 9); c.lineTo(ax + k - 1, ay + 9); c.fill(); }
        } else {
          const sw = rr(rng, 14, 26), sh2 = rr(rng, 24, 44), sxp = r.x + (rng() < 0.5 ? -4 : r.w - sw + 4), syp = r.y + 6;
          c.fillStyle = pick(rng, ["#8f3b2f", "#c49a4c", "#3f6a64", "#d9cdb0"]); c.fillRect(sxp, syp, sw, sh2);
          c.strokeStyle = "rgba(30,25,20,0.7)"; c.lineWidth = 1.2;
          for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(sxp + sw * 0.3, syp + 6 + k * 11); c.lineTo(sxp + sw * 0.7, syp + 6 + k * 11 + rr(rng, -2, 4)); c.stroke(); }
        }
      }
      if (rng() < 0.22) { // air-con box / vent
        c.fillStyle = "#a9aaa0"; const bx = r.x + rr(rng, 2, r.w - 18); c.fillRect(bx, r.y + r.h - 18, 15, 10);
        c.fillStyle = "rgba(30,30,30,0.5)"; c.fillRect(bx + 2, r.y + r.h - 16, 11, 1); c.fillRect(bx + 2, r.y + r.h - 13, 11, 1);
      }
      if (rng() < 0.3) { // drainpipe
        c.fillStyle = "rgba(60,55,48,0.8)"; c.fillRect(r.x + (rng() < 0.5 ? 2 : r.w - 4), r.y, 2.2, r.h);
      }
    }
    function paintBrace(c, x, y, len, dir) {
      c.strokeStyle = "#3a2e24"; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + dir * len, y + len); c.stroke();
    }
    function paintStack(c, rng, st, P, w, H, opts) {
      const rooms = [];
      let y = 0;
      while (y < H) {
        const h = rr(rng, 56, 96);
        let rw = w * rr(rng, 0.78, 1), rx = (w - rw) * rng();
        if (y === 0 && opts.flatTop) { rw = w; rx = 0; }
        if (opts.narrow) { rw = w * rr(rng, 0.7, 1.1); rx = (w - rw) / 2 + rr(rng, -10, 10); }
        rooms.push({ x: rx, y, w: rw, h, mat: pick(rng, P.mats) });
        y += h;
      }
      for (let i = rooms.length - 1; i >= 0; i--) {
        const r = rooms[i];
        paintRoom(c, rng, r, P, st, i < 4 ? 0.42 : 0.18, opts.style);
        const below = rooms[i + 1];
        if (below) {
          if (r.x < below.x - 4) paintBrace(c, below.x, r.y + r.h, Math.min(16, below.x - r.x), -1);
          if (r.x + r.w > below.x + below.w + 4) paintBrace(c, below.x + below.w, r.y + r.h, Math.min(16, r.x + r.w - below.x - below.w), 1);
        }
        if (i > 0 && rng() < 0.25) { // little balcony
          const bw = rr(rng, 18, 34), bx = r.x + (rng() < 0.5 ? -bw * 0.4 : r.w - bw * 0.6);
          c.fillStyle = "#4a3b2e"; c.fillRect(bx, r.y + r.h - 16, bw, 3);
          c.strokeStyle = "rgba(50,40,32,0.9)"; c.lineWidth = 1;
          for (let k = 0; k <= bw; k += 4) { c.beginPath(); c.moveTo(bx + k, r.y + r.h - 16); c.lineTo(bx + k, r.y + r.h - 26); c.stroke(); }
          c.beginPath(); c.moveTo(bx, r.y + r.h - 26); c.lineTo(bx + bw, r.y + r.h - 26); c.stroke();
          if (rng() < 0.6) for (let k = 0; k < 7; k++) { c.fillStyle = jitterColor(rng, "#58783f", 40); c.beginPath(); c.arc(bx + rng() * bw, r.y + r.h - 20 - rng() * 8, rr(rng, 1.5, 3.4), 0, TAU); c.fill(); }
        }
      }
      const top = rooms[0];
      if (opts.flatTop) {
        c.fillStyle = "#3b332b"; c.fillRect(top.x - 3, -1, top.w + 6, 5);
        c.fillStyle = "rgba(255,226,170,0.9)"; c.fillRect(top.x - 3, -1.5, top.w + 6, 1.6);
        if (rng() < 0.7) { // potted plants at the roof's back edge
          for (let k = 0; k < 2; k++) {
            const px = top.x + rr(rng, 8, top.w - 8);
            c.fillStyle = "#7d4a30"; c.fillRect(px - 3, -6, 6, 5);
            for (let j = 0; j < 6; j++) { c.fillStyle = jitterColor(rng, "#62843f", 40); c.beginPath(); c.arc(px + rr(rng, -5, 5), -8 - rng() * 6, rr(rng, 1.5, 3), 0, TAU); c.fill(); }
          }
        }
      } else {
        corrugatedRoof(c, rng, top.x, top.x + top.w, top.y, rr(rng, 14, 30), jitterColor(rng, pick(rng, P.roofs), 20));
        if (rng() < 0.6) { // chimney
          const cx = top.x + rr(rng, 10, top.w - 14);
          c.fillStyle = "#4b3e34"; c.fillRect(cx, top.y - 30, 8, 26);
          c.fillStyle = "#2c2520"; c.fillRect(cx - 1, top.y - 32, 10, 3);
          st.chimneys.push({ x: st.ox + cx + 4, y: st.oy + top.y - 32 });
        }
        if (rng() < 0.35) { // antenna
          const ax = top.x + rr(rng, 6, top.w - 6);
          c.strokeStyle = "#2f2a26"; c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(ax, top.y - 10); c.lineTo(ax, top.y - 48); c.moveTo(ax - 8, top.y - 40); c.lineTo(ax + 8, top.y - 40); c.moveTo(ax - 5, top.y - 32); c.lineTo(ax + 5, top.y - 32); c.stroke();
        }
        if (rng() < 0.3) { // water tank
          const tx = top.x + rr(rng, 4, top.w - 26);
          c.fillStyle = "#6c5a46"; c.fillRect(tx, top.y - 34, 22, 22);
          c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(tx + 14, top.y - 34, 8, 22);
          c.strokeStyle = "#2f2721"; c.lineWidth = 1; c.strokeRect(tx, top.y - 34, 22, 22);
          c.beginPath(); c.moveTo(tx + 3, top.y - 12); c.lineTo(tx - 2, top.y - 2); c.moveTo(tx + 19, top.y - 12); c.lineTo(tx + 24, top.y - 2); c.stroke();
        }
      }
    }
    function paintLattice(c, rng, st, P, w, H) {
      const col = jitterColor(rng, "#5d4636", 20);
      c.strokeStyle = col; c.lineWidth = 3;
      const lx = y => (w * 0.5) - (w * 0.18 + (y / H) * w * 0.32);
      const rx = y => (w * 0.5) + (w * 0.18 + (y / H) * w * 0.32);
      c.beginPath(); c.moveTo(lx(0), 0); c.lineTo(lx(H), H); c.moveTo(rx(0), 0); c.lineTo(rx(H), H); c.stroke();
      c.lineWidth = 1.4;
      let y = 0, step = 26;
      while (y < H) {
        c.beginPath(); c.moveTo(lx(y), y); c.lineTo(rx(y + step), y + step); c.moveTo(rx(y), y); c.lineTo(lx(y + step), y + step);
        c.moveTo(lx(y), y); c.lineTo(rx(y), y); c.stroke();
        y += step; step *= 1.04;
      }
      c.fillStyle = "#3d3129"; c.fillRect(w * 0.15, -6, w * 0.7, 6);
      c.fillStyle = "rgba(255,220,160,0.55)"; c.fillRect(w * 0.15, -7, w * 0.7, 1.4);
      for (let k = 0; k < 3; k++) { c.fillStyle = "#cfc7b2"; c.fillRect(w * (0.25 + k * 0.25) - 1.5, -14, 3, 8); }
      if (rng() < 0.7) { // workshop box on the tower
        const by = rr(rng, 60, Math.min(H * 0.5, 240)), bw = w * 1.3;
        const r = { x: (w - bw) / 2, y: by, w: bw, h: rr(rng, 40, 60), mat: pick(rng, P.mats) };
        paintRoom(c, rng, r, P, st, 0.6, "lattice");
        corrugatedRoof(c, rng, r.x, r.x + r.w, r.y, 10, jitterColor(rng, pick(rng, P.roofs), 20), 4);
      }
      const lampY = rr(rng, 20, 60);
      st.lamps.push({ x: st.ox + w * 0.5, y: st.oy + lampY, r: 18, ph: rng() * TAU, fl: true });
      c.fillStyle = "#e9b866"; c.beginPath(); c.arc(w * 0.5, lampY, 2.5, 0, TAU); c.fill();
    }
    function paintSpine(c, rng, st, P, w, H, clock) {
      const base = jitterColor(rng, "#6f6150", 20);
      c.fillStyle = base; c.fillRect(w * 0.08, 0, w * 0.84, H);
      const sh = c.createLinearGradient(0, 0, w, 0);
      sh.addColorStop(0, "rgba(255,240,210,0.12)"); sh.addColorStop(0.5, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(10,14,16,0.32)");
      c.fillStyle = sh; c.fillRect(w * 0.08, 0, w * 0.84, H);
      dabs(c, rng, w * 0.08, 0, w * 0.84, H, "#6f6150", Math.floor(w * H / 200), 40, 0.25);
      c.strokeStyle = "rgba(30,26,22,0.25)"; c.lineWidth = 0.8;
      for (let y = 8; y < H; y += 9) { c.beginPath(); c.moveTo(w * 0.08, y); c.lineTo(w * 0.92, y); c.stroke(); }
      // buttresses
      c.fillStyle = "rgba(40,34,28,0.55)"; c.fillRect(w * 0.06, 0, 5, H); c.fillRect(w * 0.9, 0, 5, H);
      // arched windows
      for (let y = 40; y < H - 40; y += rr(rng, 70, 110)) {
        const ww = rr(rng, 10, 16), x = w * rr(rng, 0.3, 0.6);
        const lit = rng() < 0.35;
        c.fillStyle = "#2a2622"; c.beginPath(); c.moveTo(x - 1.5, y + 26); c.lineTo(x - 1.5, y + 6); c.arc(x + ww / 2, y + 6, ww / 2 + 1.5, Math.PI, 0); c.lineTo(x + ww + 1.5, y + 26); c.fill();
        c.fillStyle = lit ? "#f2b45c" : "#2c3c3c"; c.beginPath(); c.moveTo(x, y + 25); c.lineTo(x, y + 6); c.arc(x + ww / 2, y + 6, ww / 2, Math.PI, 0); c.lineTo(x + ww, y + 25); c.fill();
        if (lit && rng() < 0.4) st.lamps.push({ x: st.ox + x + ww / 2, y: st.oy + y + 14, r: 18, ph: rng() * TAU, fl: false });
      }
      // crown
      c.fillStyle = jitterColor(rng, "#5a4a3a", 20);
      c.beginPath(); c.moveTo(0, 8); c.lineTo(w * 0.5, -rr(rng, 26, 46)); c.lineTo(w, 8); c.fill();
      c.strokeStyle = "rgba(240,215,160,0.45)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, 8); c.lineTo(w * 0.5, -30); c.stroke();
      if (clock) {
        const hy = clock.y - st.oy, hx = clock.x - st.ox, R = clock.R + 26;
        c.fillStyle = "#3a3027"; c.beginPath(); c.arc(hx, hy, R + 7, 0, TAU); c.fill();
        // gear teeth
        c.fillStyle = "#6b5233";
        for (let k = 0; k < 28; k++) { const t = (k / 28) * TAU; c.save(); c.translate(hx + Math.cos(t) * (R + 7), hy + Math.sin(t) * (R + 7)); c.rotate(t); c.fillRect(-2, -3.5, 6, 7); c.restore(); }
        const face = c.createRadialGradient(hx - R * 0.3, hy - R * 0.3, 4, hx, hy, R);
        face.addColorStop(0, "#efe3c4"); face.addColorStop(1, "#bfae86");
        c.fillStyle = face; c.beginPath(); c.arc(hx, hy, R, 0, TAU); c.fill();
        dabs(c, rng, hx - R, hy - R, R * 2, R * 2, "#cdbb92", 50, 30, 0.2);
        c.strokeStyle = "#3a2e22"; c.lineWidth = 2;
        for (let k = 0; k < 12; k++) { const t = (k / 12) * TAU; c.beginPath(); c.moveTo(hx + Math.cos(t) * R * 0.82, hy + Math.sin(t) * R * 0.82); c.lineTo(hx + Math.cos(t) * R * 0.94, hy + Math.sin(t) * R * 0.94); c.stroke(); }
        c.lineWidth = 1; c.beginPath(); c.arc(hx, hy, R * 0.97, 0, TAU); c.stroke();
      }
    }
    function paintPost(c, rng, st, P, w, H) {
      const r0 = { x: 0, y: 0, w, h: 110, mat: "#7d5a40" };
      paintRoom(c, rng, r0, P, st, 0.8, "house");
      c.fillStyle = "#3b332b"; c.fillRect(-3, -1, w + 6, 5);
      c.fillStyle = "rgba(255,226,170,0.9)"; c.fillRect(-3, -1.5, w + 6, 1.6);
      let y = 110;
      while (y < H) { const r = { x: rr(rng, -12, 6), y, w: w + rr(rng, -6, 16), h: rr(rng, 70, 100), mat: pick(rng, P.mats) }; paintRoom(c, rng, r, P, st, 0.45, "house"); y += r.h; }
      // painted sign
      c.fillStyle = "#2e4a47"; c.fillRect(w * 0.18, 26, w * 0.64, 30);
      c.strokeStyle = "#c9a45c"; c.lineWidth = 1.5; c.strokeRect(w * 0.18 + 3, 29, w * 0.64 - 6, 24);
      c.fillStyle = "#e6cf96"; c.font = "bold 17px " + SERIF; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("POST · LETTERS", w * 0.5, 42);
      // red pillar box by the door
      c.fillStyle = "#9a3b2c"; c.fillRect(w * 0.82, 70, 14, 34); c.beginPath(); c.arc(w * 0.82 + 7, 70, 7, Math.PI, 0); c.fill();
      c.fillStyle = "#2a1c18"; c.fillRect(w * 0.82 + 3, 78, 8, 2);
      st.lamps.push({ x: st.ox + w * 0.12, y: st.oy + 70, r: 26, ph: 1, fl: false });
      c.fillStyle = "#f2c06c"; c.beginPath(); c.arc(w * 0.12, 70, 3, 0, TAU); c.fill();
    }
    function paintRecipientWindow(c, st, recip) {
      const x = recip.x - st.ox, y = recip.y - st.oy;
      // recessed frame, hatch and enamel sign
      c.fillStyle = "#2a2018"; c.fillRect(x - 17, y - 21, 34, 42);
      const gr = c.createLinearGradient(x, y - 18, x, y + 18);
      gr.addColorStop(0, "#ffe2a6"); gr.addColorStop(1, "#e0913f");
      c.fillStyle = gr; c.fillRect(x - 14, y - 18, 28, 36);
      c.strokeStyle = "#4a3424"; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(x, y - 18); c.lineTo(x, y + 18); c.moveTo(x - 14, y - 2); c.lineTo(x + 14, y - 2); c.stroke();
      c.fillStyle = "#5b4636"; c.fillRect(x - 20, y + 20, 40, 4);
      const glow = c.createRadialGradient(x, y, 2, x, y, 60);
      glow.addColorStop(0, "rgba(255,205,130,0.35)"); glow.addColorStop(1, "rgba(255,205,130,0)");
      c.fillStyle = glow; c.fillRect(x - 60, y - 60, 120, 120);
    }

    function paintStructure(st) {
      const P = DISTRICTS[st.d] || DISTRICTS[0];
      const rng = mulberry32(st.seed);
      const m = 30;
      const w = st.w, H = FOG_Y + 160 - st.top;
      st.ox = st.x - w / 2; st.oy = st.top;
      st.lamps = []; st.chimneys = [];
      const cw = (w + m * 2) * spriteRes, ch = (H + m * 2) * spriteRes;
      const cv = makeCanvas(cw, ch);
      if (!cv) return null;
      const c = cv.getContext("2d");
      c.scale(spriteRes, spriteRes);
      c.translate(m, m);
      const style = st.style;
      if (st.role === "post") paintPost(c, rng, st, P, w, H);
      else if (style === "clock") paintSpine(c, rng, st, P, w, H, st.hub);
      else if (st.role === "platform") paintStack(c, rng, st, P, w, H, { flatTop: true, style });
      else if (style === "lattice" && st.role === "support") paintLattice(c, rng, st, P, w, H);
      else if (style === "spine" && st.role === "support") paintSpine(c, rng, st, P, w, H, null);
      else paintStack(c, rng, st, P, w, H, { style, narrow: style === "stack" });
      if (st.recip) paintRecipientWindow(c, st, st.recip);
      // depth haze + fog fade, painted onto the structure only
      c.globalCompositeOperation = "source-atop";
      const hazeA = st.depth === 0 ? 0.0 : st.depth === 1 ? 0.2 : 0.5;
      if (hazeA > 0) { c.fillStyle = rgba(P.far, hazeA); c.fillRect(-m, -m - 60, w + m * 2, H + m * 2 + 60); }
      const fy0 = (FOG_Y - 380) - st.top, fy1 = (FOG_Y + 40) - st.top;
      const fg = c.createLinearGradient(0, fy0, 0, fy1);
      fg.addColorStop(0, rgba(P.fog, 0)); fg.addColorStop(1, rgba(P.fog, 0.96));
      c.fillStyle = fg; c.fillRect(-m, fy0, w + m * 2, H + m - fy0 + 30);
      c.globalCompositeOperation = "source-over";
      return { cv, x0: st.ox - m, y0: st.top - m, w: w + m * 2, h: H + m * 2, res: spriteRes };
    }

    // ---- distant city tiles (two parallax depths per district)
    const FAR = [{ f: 0.3, TW: 3000, y0: -1300, y1: 1200 }, { f: 0.56, TW: 2400, y0: -1100, y1: 1250 }];
    function paintFar(d, layer) {
      const P = DISTRICTS[d], L = FAR[layer];
      const res = clamp(S * L.f * dpr, 0.2, 1);
      const TW = L.TW, TH = L.y1 - L.y0;
      const cv = makeCanvas(TW * res, TH * res);
      if (!cv) return null;
      const c = cv.getContext("2d");
      c.scale(res, res); c.translate(0, -L.y0);
      const rng = mulberry32(hash2(d * 7 + 1, layer * 13 + 5));
      const col = layer === 0 ? mix(P.far, P.sky[1], 0.45) : P.mid;
      const lit = layer === 0 ? 0.25 : 0.55;
      const items = [];
      const count = layer === 0 ? 46 : 34;
      for (let i = 0; i < count; i++) {
        items.push({ x: rng() * TW, w: rr(rng, 40, layer === 0 ? 120 : 150), top: i % 5 === 0 ? rr(rng, L.y0 + 150, L.y0 + 600) : rr(rng, layer === 0 ? -300 : -160, layer === 0 ? 520 : 640) });
      }
      items.sort((a, b) => a.top - b.top);
      const drawItem = (it, ox) => {
        const x = it.x + ox;
        let y = it.top;
        if (P.style === "lattice" && rng() < 0.35) {
          c.strokeStyle = col; c.lineWidth = 2.2;
          c.beginPath(); c.moveTo(x - it.w * 0.15, y); c.lineTo(x - it.w * 0.4, L.y1); c.moveTo(x + it.w * 0.15, y); c.lineTo(x + it.w * 0.4, L.y1); c.stroke();
          c.lineWidth = 1;
          for (let yy = y; yy < L.y1; yy += 30) { c.beginPath(); c.moveTo(x - it.w * 0.2, yy); c.lineTo(x + it.w * 0.2, yy + 30); c.stroke(); }
          return;
        }
        if (P.style === "spine" && rng() < 0.25) {
          c.fillStyle = col; c.beginPath(); c.arc(x, y + 60, it.w * 0.7, 0, TAU); c.fill();
          for (let k = 0; k < 20; k++) { const t = k / 20 * TAU; c.fillRect(x + Math.cos(t) * it.w * 0.75 - 4, y + 60 + Math.sin(t) * it.w * 0.75 - 4, 8, 8); }
        }
        c.fillStyle = col;
        while (y < L.y1) {
          const h = rr(rng, 40, 90), ww = it.w * rr(rng, 0.7, 1.15) * (P.style === "stack" ? 0.7 : 1);
          const xx = x - ww / 2 + rr(rng, -8, 8);
          c.globalAlpha = 1; c.fillStyle = jitterColor(rng, layer === 0 ? P.far : P.mid, 14);
          c.fillRect(xx, y, ww, h + 1);
          if (y === it.top) { c.beginPath(); c.moveTo(xx - 5, y + 1); c.lineTo(xx + ww * rr(rng, 0.3, 0.7), y - rr(rng, 8, 22)); c.lineTo(xx + ww + 5, y + 1); c.fill(); }
          for (let k = 0; k < ww / 16; k++) {
            if (rng() < 0.18 * lit) { c.fillStyle = "rgba(245,190,110," + (0.35 + lit * 0.4) + ")"; c.fillRect(xx + 4 + rng() * (ww - 10), y + 8 + rng() * (h - 16), 4, 5); }
          }
          y += h;
        }
        if (rng() < 0.4) { c.strokeStyle = col; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, it.top - 10); c.lineTo(x, it.top - 50); c.stroke(); }
      };
      for (const it of items) { drawItem(it, 0); if (it.x < 200) drawItem(it, TW); if (it.x > TW - 200) drawItem(it, -TW); }
      // cables between distant towers
      c.strokeStyle = layer === 0 ? "rgba(50,60,60,0.25)" : "rgba(30,36,36,0.45)"; c.lineWidth = layer === 0 ? 1 : 1.3;
      for (let i = 0; i < (P.style === "market" ? 30 : 16); i++) {
        const a = pick(rng, items), b = pick(rng, items);
        if (Math.abs(a.x - b.x) > 500 || a === b) continue;
        const y0 = a.top + rr(rng, 0, 80), y1 = b.top + rr(rng, 0, 80);
        c.beginPath(); c.moveTo(a.x, y0); c.quadraticCurveTo((a.x + b.x) / 2, Math.max(y0, y1) + rr(rng, 20, 70), b.x, y1); c.stroke();
      }
      c.globalCompositeOperation = "source-atop";
      const hz = c.createLinearGradient(0, L.y0, 0, L.y1);
      hz.addColorStop(0, rgba(P.sky[0], layer === 0 ? 0.25 : 0.08));
      hz.addColorStop(0.55, rgba(P.sky[1], layer === 0 ? 0.35 : 0.18));
      hz.addColorStop(0.85, rgba(P.fog, 0.85)); hz.addColorStop(1, rgba(P.fog, 1));
      c.fillStyle = hz; c.fillRect(0, L.y0, TW, TH);
      c.globalCompositeOperation = "source-over";
      return { cv, res, TW, L };
    }
    function getFar(d, layer) {
      const k = d + ":" + layer;
      if (!farTiles[k]) farTiles[k] = paintFar(d, layer);
      return farTiles[k];
    }

    // =====================================================================
    // 12. DYNAMIC WORLD DRAWING
    // =====================================================================
    let glowSprite = null;
    function glow(x, y, r, alpha) {
      if (!glowSprite) {
        glowSprite = makeCanvas(64, 64);
        const c = glowSprite.getContext("2d");
        const gr = c.createRadialGradient(32, 32, 1, 32, 32, 32);
        gr.addColorStop(0, "rgba(255,196,118,1)"); gr.addColorStop(0.35, "rgba(255,190,110,0.45)"); gr.addColorStop(1, "rgba(255,190,110,0)");
        c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
      }
      if (alpha <= 0.005) return;
      g.globalAlpha = Math.min(1, alpha);
      g.drawImage(glowSprite, x - r, y - r, r * 2, r * 2);
      g.globalAlpha = 1;
    }
    let fogTile = null;
    function getFogTile() {
      if (fogTile) return fogTile;
      const w = 720, h = 220;
      const cv = makeCanvas(w * 0.6, h * 0.6);
      if (!cv) return null;
      const c = cv.getContext("2d"); c.scale(0.6, 0.6);
      const rng = mulberry32(99);
      for (let i = 0; i < 70; i++) {
        const x = rng() * w, y = h * 0.25 + rng() * h * 0.6, r = rr(rng, 30, 90);
        for (const ox of [0, -w, w]) {
          const gr = c.createRadialGradient(x + ox, y, 1, x + ox, y, r);
          gr.addColorStop(0, "rgba(225,232,222,0.30)"); gr.addColorStop(1, "rgba(225,232,222,0)");
          c.fillStyle = gr; c.fillRect(x + ox - r, y - r, r * 2, r * 2);
        }
      }
      fogTile = { cv, w, h, k: 0.6, pat: null };
      return fogTile;
    }

    function districtAtX(x) {
      let d0 = 0, t = 0, d1 = 0;
      for (const gt of route.gates) {
        if (x >= gt.x) { d0 = d1; d1 = gt.d; t = clamp((x - gt.x) / 700, 0, 1); }
      }
      if (!route.gates.length || x < route.gates[0].x) return { a: 0, b: 0, t: 0 };
      return { a: d0, b: d1, t };
    }

    function drawSky(db) {
      const A = DISTRICTS[db.a], B = DISTRICTS[db.b];
      const gr = g.createLinearGradient(0, 0, 0, Hd);
      gr.addColorStop(0, mix(A.sky[0], B.sky[0], db.t));
      gr.addColorStop(0.45, mix(A.sky[1], B.sky[1], db.t));
      gr.addColorStop(1, mix(A.fog, B.fog, db.t));
      g.fillStyle = gr; g.fillRect(0, 0, Wd, Hd);
      // pale sun glow behind the haze
      const sxp = Wd * 0.72 - ((cam.x * 0.02) % (Wd * 0.4)), syp = Hd * 0.12;
      const sg = g.createRadialGradient(sxp, syp, 4, sxp, syp, Hd * 0.45);
      sg.addColorStop(0, "rgba(255,248,226,0.55)"); sg.addColorStop(1, "rgba(255,248,226,0)");
      g.fillStyle = sg; g.fillRect(0, 0, Wd, Hd);
    }
    function drawFarLayers(db) {
      for (let layer = 0; layer < 2; layer++) {
        const L = FAR[layer];
        const passes = db.a === db.b ? [[db.a, 1]] : [[db.a, 1], [db.b, db.t]];
        for (const pass of passes) {
          const d = pass[0], alpha = pass[1];
          if (alpha <= 0.01) continue;
          const tile = getFar(d, layer);
          if (!tile) continue;
          const k = S * L.f;
          const left = cam.x - W2 / k;
          const startTile = Math.floor(left / L.TW);
          const yTop = H2 + (L.y0 - cam.y) * k;
          g.globalAlpha = alpha;
          for (let i = startTile; i * L.TW < cam.x + W2 / k + L.TW; i++) {
            const xs = W2 + (i * L.TW - cam.x) * k;
            g.drawImage(tile.cv, xs, yTop, L.TW * k + 1, (L.y1 - L.y0) * k);
          }
          g.globalAlpha = 1;
        }
        // haze between depth layers
        const P = DISTRICTS[db.b];
        const yb = H2 + (L.y1 - cam.y) * S * L.f;
        g.fillStyle = mix(DISTRICTS[db.a].fog, P.fog, db.t);
        if (yb < Hd) g.fillRect(0, yb - 1, Wd, Hd - yb + 1);
        if (layer === 0) drawShafts();
      }
    }
    function drawShafts() {
      g.save();
      for (let i = 0; i < 3; i++) {
        const x = ((i * 470 + 200 - cam.x * 0.08) % (Wd + 600) + Wd + 600) % (Wd + 600) - 300;
        const w = 60 + i * 30;
        const gr = g.createLinearGradient(x, 0, x + Hd * 0.5, Hd);
        gr.addColorStop(0, "rgba(255,246,220,0.13)"); gr.addColorStop(1, "rgba(255,246,220,0)");
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x, -10); g.lineTo(x + w, -10); g.lineTo(x + w + Hd * 0.55, Hd); g.lineTo(x + Hd * 0.55, Hd); g.closePath(); g.fill();
      }
      g.restore();
    }
    let birds = [];
    function drawBirds(dt) {
      if (birds.length < 5 && Math.random() < dt * 0.4) birds.push({ x: -20, y: Hd * (0.1 + Math.random() * 0.25), v: 25 + Math.random() * 30, ph: Math.random() * TAU, s: 0.7 + Math.random() * 0.6 });
      g.strokeStyle = "rgba(40,48,46,0.55)"; g.lineWidth = 1.2;
      for (const b of birds) {
        b.x += b.v * dt; b.ph += dt * 9;
        const f = Math.sin(b.ph) * 3 * b.s;
        g.beginPath(); g.moveTo(b.x - 5 * b.s, b.y - f); g.lineTo(b.x, b.y); g.lineTo(b.x + 5 * b.s, b.y - f); g.stroke();
      }
      birds = birds.filter(b => b.x < Wd + 30);
    }

    function worldBegin() { g.save(); g.translate(W2 - cam.x * S, H2 - cam.y * S); g.scale(S, S); }
    function worldEnd() { g.restore(); }
    const px = n => n / S; // screen-pixel size expressed in world units

    function drawStructures(view, depths) {
      let budget = 2;
      const lists = [[], [], []];
      for (const st of route.structures) {
        if (st.x + st.w < view.x0 - 900 || st.x - st.w > view.x1 + 900) continue;
        lists[st.depth].push(st);
      }
      for (const dpt of depths) {
        for (const st of lists[dpt]) {
          const visible = !(st.x + st.w < view.x0 || st.x - st.w > view.x1 || st.top > view.y1);
          if (!st.sprite && (visible || budget > 0)) { st.sprite = paintStructure(st); if (!visible) budget--; }
          if (!st.sprite || !visible) continue;
          const sp = st.sprite;
          // crop to what is on screen and above the opaque fog
          const top = Math.max(sp.y0, view.y0 - 4), bot = Math.min(sp.y0 + sp.h, view.y1 + 4, FOG_Y + 70);
          if (bot <= top) continue;
          const sy0 = (top - sp.y0) * sp.res, sh0 = (bot - top) * sp.res;
          g.drawImage(sp.cv, 0, sy0, sp.cv.width, Math.min(sh0, sp.cv.height - sy0), sp.x0, top, sp.w, bot - top);
        }
      }
    }
    function drawLamps(view, time) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const st of route.structures) {
        if (!st.lamps || st.x + st.w < view.x0 || st.x - st.w > view.x1) continue;
        for (const l of st.lamps) {
          let a = 0.16 + 0.05 * Math.sin(time * 1.3 + l.ph);
          if (l.fl) a *= (Math.sin(time * 13 + l.ph * 3) > 0.92 ? 0.3 : 1);
          glow(l.x, l.y, l.r * 1.6, a * 1.4);
        }
      }
      g.restore();
    }
    function cableCurve(x0, y0, x1, y1, sag) {
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag, x1, y1);
    }
    function drawDecor(view, time) {
      for (const o of route.decor) {
        if (o.kind === "wire") {
          if (o.x1 < view.x0 || o.x0 > view.x1) continue;
          g.strokeStyle = "rgba(28,30,29,0.55)"; g.lineWidth = px(1);
          cableCurve(o.x0, o.y0, o.x1, o.y1, o.sag + Math.sin(time * 0.7 + o.x0) * 2); g.stroke();
          g.fillStyle = "rgba(210,205,190,0.7)";
          g.fillRect(o.x0 + 30, o.y0 + o.sag * 0.12 - px(1.5), px(3), px(3));
          g.fillRect(o.x1 - 30, o.y1 + o.sag * 0.12 - px(1.5), px(3), px(3));
        } else if (o.kind === "flag") {
          if (o.x < view.x0 - 60 || o.x > view.x1 + 60) continue;
          const dir = Math.sign(o.f) || 1;
          g.strokeStyle = "#2f2822"; g.lineWidth = px(1.6);
          g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(o.x, o.y - 30); g.stroke();
          g.fillStyle = o.c;
          g.beginPath(); g.moveTo(o.x, o.y - 30);
          const n = 6;
          for (let i = 1; i <= n; i++) { const t = i / n; g.lineTo(o.x + dir * o.len * t, o.y - 30 + Math.sin(time * 9 + o.ph + t * 4) * 3 * t); }
          for (let i = n; i >= 0; i--) { const t = i / n; g.lineTo(o.x + dir * o.len * t, o.y - 22 + Math.sin(time * 9 + o.ph + t * 4) * 3 * t + t * 2); }
          g.closePath(); g.fill();
        }
      }
      // wind streaks
      for (const w of route.winds) {
        if (w.x1 < view.x0 || w.x0 > view.x1) continue;
        const dir = Math.sign(w.f);
        g.strokeStyle = "rgba(235,240,232,0.22)"; g.lineWidth = px(1);
        for (let i = 0; i < 14; i++) {
          const span = w.x1 - w.x0;
          const xx = w.x0 + ((((i * 137.5 + time * Math.abs(w.f) * 1.1 * dir) % span) + span) % span);
          const yy = 180 + ((i * 89) % 520) + Math.sin(time + i) * 8;
          g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx - dir * 28, yy + 1); g.stroke();
        }
      }
    }
    function drawGates(view, time) {
      for (const gt of route.gates) {
        if (gt.x < view.x0 - 300 || gt.x > view.x1 + 300) continue;
        const P = DISTRICTS[gt.d];
        const x0 = gt.x - 140, x1 = gt.x + 140, top = 150;
        g.fillStyle = "#3a312a";
        g.fillRect(x0 - 8, top, 16, FOG_Y - top); g.fillRect(x1 - 8, top, 16, FOG_Y - top);
        g.strokeStyle = "#2a2420"; g.lineWidth = px(2.5);
        cableCurve(x0, top + 10, x1, top + 10, 30); g.stroke();
        // cloth banner
        const sway = Math.sin(time * 1.4) * 3;
        g.fillStyle = "#8f3b2f";
        g.beginPath(); g.moveTo(gt.x - 50, top + 30); g.lineTo(gt.x + 50, top + 30); g.lineTo(gt.x + 46 + sway, top + 110); g.lineTo(gt.x + sway, top + 98); g.lineTo(gt.x - 46 + sway, top + 110); g.closePath(); g.fill();
        g.fillStyle = "#e6cf96"; g.font = "bold " + 26 + "px " + SERIF; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(P.numeral, gt.x + sway * 0.5, top + 62);
      }
    }

    function drawAnchorSupport(a, time) {
      const heavy = "#24272a";
      if (a.kind === "laundry" && a.line) {
        const [l, r] = a.line;
        g.strokeStyle = "#d8cfb8"; g.lineWidth = px(1.4);
        g.beginPath(); g.moveTo(l.x, l.y); g.quadraticCurveTo((l.x + a.x) / 2, (l.y + a.y) / 2 + 8, a.x, a.y);
        g.quadraticCurveTo((r.x + a.x) / 2, (r.y + a.y) / 2 + 8, r.x, r.y); g.stroke();
        for (const cl of a.clothes) {
          const t = cl.t;
          let x, y;
          if (t < 0.5) { const u = t / 0.5; x = lerp(l.x, a.x, u); y = lerp(l.y, a.y, u) + Math.sin(u * Math.PI) * 6; }
          else { const u = (t - 0.5) / 0.5; x = lerp(a.x, r.x, u); y = lerp(a.y, r.y, u) + Math.sin(u * Math.PI) * 6; }
          const sw = Math.sin(time * 2.2 + cl.ph) * 3 + worldWind(x, y) * 0.02;
          g.fillStyle = cl.c;
          g.beginPath();
          if (cl.kind === "shirt") {
            g.moveTo(x - cl.w / 2, y); g.lineTo(x + cl.w / 2, y); g.lineTo(x + cl.w / 2 + 3 + sw * 0.3, y + 5); g.lineTo(x + cl.w * 0.35 + sw, y + cl.h); g.lineTo(x - cl.w * 0.35 + sw, y + cl.h); g.lineTo(x - cl.w / 2 - 3 + sw * 0.3, y + 5);
          } else { g.moveTo(x - cl.w / 2, y); g.lineTo(x + cl.w / 2, y); g.lineTo(x + cl.w / 2 + sw, y + cl.h); g.lineTo(x - cl.w / 2 + sw, y + cl.h); }
          g.closePath(); g.fill();
          g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(x - cl.w / 2 + sw * 0.5, y + cl.h * 0.6, cl.w, cl.h * 0.4);
          g.fillStyle = "#6b5a46"; g.fillRect(x - 1, y - 2, 2, 4);
        }
      } else if (a.kind === "pulley" && a.track) {
        const [l, r] = a.track, ty = a.by - 24;
        g.strokeStyle = heavy; g.lineWidth = px(3);
        g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(r.x, r.y); g.stroke();
        g.strokeStyle = "rgba(200,190,170,0.35)"; g.lineWidth = px(1); g.beginPath(); g.moveTo(l.x, l.y - px(1)); g.lineTo(r.x, r.y - px(1)); g.stroke();
        // carriage
        g.fillStyle = "#6a4a33"; g.fillRect(a.x - 11, ty - 4, 22, 10);
        g.fillStyle = "#c79a52";
        for (const ox of [-6, 6]) { g.beginPath(); g.arc(a.x + ox, ty - 3, 4, 0, TAU); g.fill(); g.fillStyle = "#2a2420"; g.beginPath(); g.arc(a.x + ox, ty - 3, 1.4, 0, TAU); g.fill(); g.fillStyle = "#c79a52"; }
        g.strokeStyle = heavy; g.lineWidth = px(2);
        g.beginPath(); g.moveTo(a.x, ty + 6); g.lineTo(a.x, a.y); g.stroke();
        // travel hint: faint rail marks at the ends of travel
        g.fillStyle = "rgba(240,220,180,0.4)";
        g.fillRect(a.cx - a.amp - 1, ty - 8, 2, 8); g.fillRect(a.cx + a.amp - 1, ty - 8, 2, 8);
      } else if (a.kind === "clock") {
        g.strokeStyle = "#7a5a32"; g.lineWidth = px(5);
        g.beginPath(); g.moveTo(a.hx, a.hy); g.lineTo(a.x, a.y); g.stroke();
        g.strokeStyle = "#c79a52"; g.lineWidth = px(1.5);
        g.beginPath(); g.moveTo(a.hx, a.hy); g.lineTo(a.x, a.y); g.stroke();
        g.fillStyle = "#3a2e22"; g.beginPath(); g.arc(a.hx, a.hy, px(8), 0, TAU); g.fill();
        g.fillStyle = "#c79a52"; g.beginPath(); g.arc(a.hx, a.hy, px(4), 0, TAU); g.fill();
        // short counter-hand for life
        g.strokeStyle = "#3a2e22"; g.lineWidth = px(3);
        g.beginPath(); g.moveTo(a.hx, a.hy); g.lineTo(a.hx - Math.cos(a.ang) * a.R * 0.45, a.hy - Math.sin(a.ang) * a.R * 0.45); g.stroke();
      } else if (a.kind === "fragile" && a.beam) {
        const b = a.beam;
        g.fillStyle = "#3a312a"; g.fillRect(b.x - 30, b.y - 5, 60, 8);
        if (a.broken) {
          g.strokeStyle = "#5a4c3c"; g.lineWidth = px(1.2);
          g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x + 4, b.y + 46 + Math.sin(time * 2) * 3); g.stroke();
          return;
        }
        const stress = player.anchor === a ? a.hold / a.life : 0;
        const jx = stress > 0 ? Math.sin(time * 60) * stress * 2 : 0;
        g.strokeStyle = "#7d6a52"; g.lineWidth = px(1.3);
        g.beginPath(); g.moveTo(b.x, b.y); g.quadraticCurveTo((b.x + a.x) / 2 + 3 + jx, (b.y + a.y) / 2, a.x, a.y); g.stroke();
        g.strokeStyle = "rgba(125,106,82,0.6)"; g.lineWidth = px(0.8);
        g.beginPath(); g.moveTo(b.x + 2, b.y); g.quadraticCurveTo((b.x + a.x) / 2 - 4 - jx, (b.y + a.y) / 2 + 6, a.x + 1, a.y - 2); g.stroke();
        // faded red tag: marks a line that will not hold for long
        const ty = lerp(b.y, a.y, 0.35);
        const tx = lerp(b.x, a.x, 0.35) + 2;
        g.fillStyle = "#a8483a";
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 9 + Math.sin(time * 5) * 2, ty + 3); g.lineTo(tx + 7 + Math.sin(time * 5 + 1) * 2, ty + 8); g.lineTo(tx, ty + 5); g.fill();
      } else if (a.cables) {
        const sag = 10 + a.vib * Math.sin(time * 40) * 4;
        g.strokeStyle = heavy; g.lineWidth = px(2.6);
        for (const sp of a.cables) { g.beginPath(); g.moveTo(sp.x, sp.y); g.quadraticCurveTo((sp.x + a.x) / 2, (sp.y + a.y) / 2 + sag, a.x, a.y - 4); g.stroke(); }
        g.strokeStyle = "rgba(210,200,180,0.25)"; g.lineWidth = px(0.9);
        for (const sp of a.cables) { g.beginPath(); g.moveTo(sp.x, sp.y - px(1)); g.quadraticCurveTo((sp.x + a.x) / 2, (sp.y + a.y) / 2 + sag - px(1), a.x, a.y - 4 - px(1)); g.stroke(); }
        for (const sp of a.cables) { g.fillStyle = "#3a312a"; g.fillRect(sp.x - px(4), sp.y - px(3), px(8), px(6)); }
      }
    }
    function drawRing(a, time, glowAmt) {
      const r = px(a.kind === "hook" ? 7.5 : a.kind === "eyelet" ? 5 : 6.3);
      if (glowAmt > 0.01) glow(a.x, a.y, r * 4.5, 0.75 * glowAmt);
      if (a.kind !== "laundry" && a.kind !== "clock" && a.kind !== "pulley") {
        g.fillStyle = "#2b2622"; g.fillRect(a.x - px(4), a.y - r - px(5), px(8), px(5));
        g.fillStyle = "#c79a52"; g.fillRect(a.x - px(1), a.y - r - px(4), px(2), px(2));
      } else if (a.kind === "laundry") {
        g.fillStyle = "#6b5a46"; g.fillRect(a.x - px(1.5), a.y - r - px(4), px(3), px(6));
      }
      g.lineWidth = px(3.6); g.strokeStyle = "#231f1c";
      g.beginPath(); g.arc(a.x, a.y, r, 0, TAU); g.stroke();
      g.lineWidth = px(2.2); g.strokeStyle = a.kind === "fragile" ? "#9a8a6c" : "#c49650";
      g.beginPath(); g.arc(a.x, a.y, r, 0, TAU); g.stroke();
      g.lineWidth = px(1); g.strokeStyle = "rgba(255,236,190,0.8)";
      g.beginPath(); g.arc(a.x, a.y, r, -2.6, -1.2); g.stroke();
    }
    function drawReach(a, alpha) {
      if (alpha < 0.02) return;
      g.save();
      g.strokeStyle = "rgba(246,232,198," + alpha + ")";
      g.lineWidth = px(1.2);
      g.setLineDash([px(5), px(7)]);
      g.beginPath(); g.arc(a.x, a.y, a.reach, 0.08 * Math.PI, 0.92 * Math.PI); g.stroke();
      g.restore();
    }

    function drawSymbol(sym, x, y, s, color) {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 1.4;
      g.beginPath();
      switch (sym) {
        case "lantern": g.fillRect(-3, -4, 6, 8); g.fillRect(-1.5, -6, 3, 2); g.fillRect(-4, 4, 8, 1.5); break;
        case "fish": g.ellipse(-1, 0, 4, 2.4, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(2.5, 0); g.lineTo(5.5, -2.5); g.lineTo(5.5, 2.5); g.closePath(); break;
        case "key": g.arc(-3, 0, 2.2, 0, TAU); g.stroke(); g.beginPath(); g.fillRect(-1, -0.7, 6, 1.4); g.fillRect(3, 0, 1.2, 2.2); g.fillRect(4.6, 0, 1, 1.6); break;
        case "moon": g.arc(0, 0, 4.5, 0.6, TAU - 0.6); g.arc(2, 0, 3.4, TAU - 0.9, 0.9, true); break;
        case "bell": g.moveTo(-4, 3); g.quadraticCurveTo(-4, -5, 0, -5); g.quadraticCurveTo(4, -5, 4, 3); g.closePath(); g.fill(); g.beginPath(); g.arc(0, 4, 1.3, 0, TAU); break;
        case "leaf": g.moveTo(-4, 4); g.quadraticCurveTo(-4, -4, 4, -4); g.quadraticCurveTo(4, 4, -4, 4); break;
        case "cup": g.fillRect(-3.5, -2, 6, 6); g.arc(3.5, 1, 1.8, -1.4, 1.4); g.stroke(); g.beginPath(); g.fillRect(-4.5, 4, 8, 1.2); break;
        case "star": for (let i = 0; i < 10; i++) { const r = i % 2 ? 2 : 5, t = (i / 10) * TAU - Math.PI / 2; g.lineTo(Math.cos(t) * r, Math.sin(t) * r); } g.closePath(); break;
        case "bird": g.moveTo(-5, -1); g.quadraticCurveTo(-2, -4, 0, 0); g.quadraticCurveTo(2, -4, 5, -1); g.lineWidth = 1.6; g.stroke(); g.beginPath(); break;
        case "umbrella": g.arc(0, 0, 5, Math.PI, 0); g.closePath(); g.fill(); g.beginPath(); g.fillRect(-0.6, 0, 1.2, 5); g.arc(-1.2, 5, 1.2, 0, Math.PI); g.stroke(); g.beginPath(); break;
      }
      g.fill();
      g.restore();
    }

    function drawRecipients(view, time, assist) {
      const active = activeLetter();
      for (const L of route.deliveries) {
        if (L.x < view.x0 - 80 || L.x > view.x1 + 80) continue;
        const isActive = L === active;
        // dynamic window light
        const wl = L.status === "delivered" ? 0.55 + 0.4 * L.flash : L.status === "missed" ? 0.0 : isActive ? 0.35 + 0.15 * Math.sin(time * 3) : 0.2;
        if (wl > 0) { g.save(); g.globalCompositeOperation = "lighter"; glow(L.x, L.y, 70, wl * 0.6); g.restore(); }
        if (L.status === "missed") { g.fillStyle = "rgba(40,36,32,0.65)"; g.fillRect(L.x - 14, L.y - 18, 28, 36); }
        if (L.wave > 0) { // resident at the window
          const t = 1 - L.wave;
          g.fillStyle = "rgba(40,28,22,0.85)";
          g.beginPath(); g.arc(L.x - 4, L.y - 4, 4, 0, TAU); g.fill();
          g.fillRect(L.x - 8, L.y, 9, 18);
          g.strokeStyle = "rgba(40,28,22,0.85)"; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(L.x + 1, L.y + 3); g.lineTo(L.x + 7 + Math.sin(t * 30) * 3, L.y - 8); g.stroke();
        }
        // enamel house sign with number and symbol
        const sx0 = L.x + 24, sy0 = L.y - 30, sw = px(22), sh = px(30);
        g.strokeStyle = "#2a2420"; g.lineWidth = px(1);
        g.beginPath(); g.moveTo(sx0 + sw * 0.25, sy0 - px(8)); g.lineTo(sx0 + sw * 0.25, sy0); g.moveTo(sx0 + sw * 0.75, sy0 - px(8)); g.lineTo(sx0 + sw * 0.75, sy0); g.stroke();
        g.fillStyle = "#e9dcbc"; g.fillRect(sx0, sy0, sw, sh);
        g.strokeStyle = "#2e4a47"; g.lineWidth = px(1.4); g.strokeRect(sx0 + px(1.5), sy0 + px(1.5), sw - px(3), sh - px(3));
        g.fillStyle = "#2e4a47"; g.font = "bold " + px(10) + "px " + SERIF; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(L.number), sx0 + sw / 2, sy0 + px(9));
        drawSymbol(L.symbol, sx0 + sw / 2, sy0 + px(21), px(1.1), "#8f3b2f");
        if (isActive && L.status === "pending") {
          // the courier's pending letter: a small bobbing envelope over the sign
          const by = sy0 - px(22) + Math.sin(time * 3) * px(2);
          drawEnvelope(sx0 + sw / 2, by, px(1), L.parcel);
          const za = clamp(0.14 + assist * 0.3, 0, 0.5);
          g.save(); g.strokeStyle = "rgba(255,226,160," + za + ")"; g.lineWidth = px(1.4); g.setLineDash([px(3), px(5)]);
          g.beginPath(); g.arc(L.x, L.y, L.r, 0, TAU); g.stroke(); g.restore();
        }
      }
    }
    function drawEnvelope(x, y, s, parcel) {
      g.save(); g.translate(x, y); g.scale(s, s);
      if (parcel) {
        g.fillStyle = "#b48a5a"; g.fillRect(-8, -6, 16, 12);
        g.strokeStyle = "#5a3e26"; g.lineWidth = 1.2; g.strokeRect(-8, -6, 16, 12);
        g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 6); g.moveTo(-8, 0); g.lineTo(8, 0); g.stroke();
      } else {
        g.fillStyle = "#efe4c8"; g.fillRect(-9, -6, 18, 12);
        g.strokeStyle = "#6b5a46"; g.lineWidth = 1.1; g.strokeRect(-9, -6, 18, 12);
        g.beginPath(); g.moveTo(-9, -6); g.lineTo(0, 1); g.lineTo(9, -6); g.stroke();
        g.fillStyle = "#a8483a"; g.beginPath(); g.arc(0, 1.5, 1.8, 0, TAU); g.fill();
      }
      g.restore();
    }
    function drawRewards(view, time) {
      for (const rw of route.rewards) {
        if (rw.taken || rw.x < view.x0 - 40 || rw.x > view.x1 + 40) continue;
        const bob = Math.sin(time * 2 + rw.ph) * 3;
        g.save(); g.translate(rw.x, rw.y + bob); g.rotate(Math.sin(time * 1.3 + rw.ph) * 0.25);
        const s = px(1);
        g.strokeStyle = "rgba(40,36,30,0.6)"; g.lineWidth = s;
        g.beginPath(); g.moveTo(0, -9 * s); g.lineTo(0, -22 * s); g.stroke();
        glow(0, 0, 24 * s, 0.4);
        g.fillStyle = "#efe4c8"; g.fillRect(-9 * s, -7 * s, 18 * s, 14 * s);
        for (let i = -9; i < 9; i += 4) { g.fillStyle = (i / 4) % 2 ? "#3f6a8a" : "#a8483a"; g.fillRect(i * s, -7 * s, 2 * s, 2 * s); g.fillRect(i * s, 5 * s, 2 * s, 2 * s); }
        g.fillStyle = "#3f6a8a"; g.beginPath(); g.moveTo(-4 * s, 2 * s); g.lineTo(5 * s, -2 * s); g.lineTo(-1 * s, 0); g.closePath(); g.fill();
        g.restore();
      }
    }

    // ---- courier
    const vis = { ang: 0, coat: 0, legs: 0, tumble: 0 };
    function drawCourier(x, y, dt, time) {
      const a = player.anchor;
      let target;
      if (a && player.mode !== "ground") target = Math.atan2(a.x - x, -(a.y - y));
      else if (player.mode === "ground") target = 0;
      else target = clamp(player.vx / 1100, -0.5, 0.5) + (player.vy > 300 ? Math.sign(player.vx) * 0.2 : 0);
      if (gameState === "dying") { vis.tumble += dt * 5; target += vis.tumble; }
      let da = target - vis.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      vis.ang += da * (1 - Math.exp(-dt * (a ? 30 : 8)));
      const sc = Math.max(1, 20 / (28 * S));
      g.save(); g.translate(x, y); g.rotate(vis.ang); g.scale(sc, sc);
      const speed = Math.hypot(player.vx, player.vy);
      const lag = clamp(-(player.om || 0) * 0.12, -0.5, 0.5);
      const flying = !a && player.mode !== "ground";
      const ground = player.mode === "ground";
      const face = player.vx >= 0 ? 1 : -1;
      // legs
      g.strokeStyle = "#263234"; g.lineWidth = 3; g.lineCap = "round";
      const legSpread = ground ? 2.5 : flying ? (player.vy < 0 ? 4 : 2) : 2;
      const kneeBend = flying && player.vy < 0 ? 4 : ground ? 0.5 : 1.5;
      for (const sgn of [-1, 1]) {
        const kx = sgn * legSpread * 0.6 + lag * 6 + face * kneeBend, ky = 8;
        const fx2 = sgn * legSpread + lag * 12 + (flying ? -face * 2 : 0), fy2 = ground ? 13 : 13 - (flying && player.vy < 0 ? 3 : 0);
        g.beginPath(); g.moveTo(sgn * 1.4, 3); g.quadraticCurveTo(kx, ky, fx2, fy2); g.stroke();
      }
      g.fillStyle = "#1b1a18"; // boots
      g.beginPath(); g.arc(legSpread + lag * 12 + (flying ? -face * 2 : 0), 13.5, 1.6, 0, TAU); g.arc(-legSpread + lag * 12 + (flying ? -face * 2 : 0), 13.5, 1.6, 0, TAU); g.fill();
      // coat with a tail that trails the motion
      const tail = clamp(-player.vx / 600, -1, 1) * 3 + lag * 5;
      g.fillStyle = "#a84a36";
      g.beginPath(); g.moveTo(-4.2, -6); g.lineTo(4.2, -6); g.lineTo(5, 3); g.lineTo(4 + tail, 7); g.lineTo(-4 + tail, 7); g.lineTo(-5, 3); g.closePath(); g.fill();
      g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(0.5, -6, 4, 12);
      g.strokeStyle = "#e3d2a8"; g.lineWidth = 1; g.beginPath(); g.moveTo(-3.5, -5.5); g.lineTo(4.5, 4); g.stroke(); // satchel strap
      g.fillStyle = "#d6c49a"; g.fillRect(3.2, 1, 5, 5); g.fillStyle = "#8c7650"; g.fillRect(3.2, 1, 5, 1.6);
      // arms
      g.strokeStyle = "#943f2e"; g.lineWidth = 2.4;
      if (a && !ground) { g.beginPath(); g.moveTo(-3, -5); g.lineTo(-0.5, -15); g.moveTo(3, -5); g.lineTo(0.5, -15); g.stroke(); }
      else if (flying) { const fl = Math.sin(time * 14) * (player.vy > 400 ? 3 : 1); g.beginPath(); g.moveTo(-3, -5); g.lineTo(-9, -8 + fl); g.moveTo(3, -5); g.lineTo(9, -9 - fl); g.stroke(); }
      else { g.beginPath(); g.moveTo(-3.5, -5); g.lineTo(-5, 2); g.moveTo(3.5, -5); g.lineTo(face * 6, -9); g.stroke(); }
      // head + cap
      g.fillStyle = "#d9b08a"; g.beginPath(); g.arc(0, -9.5, 3.4, 0, TAU); g.fill();
      g.fillStyle = "#2c4648"; g.beginPath(); g.arc(0, -10.4, 3.6, Math.PI, 0); g.fill();
      g.fillRect(face > 0 ? 0 : -6, -10.6, 6, 1.4);
      g.fillStyle = "#c9a45c"; g.fillRect(-1, -13, 2, 1.4);
      // reel at the hand
      if (a && !ground) { g.fillStyle = "#b08a4e"; g.beginPath(); g.arc(0, -15.5, 2.3, 0, TAU); g.fill(); g.fillStyle = "#3a2e22"; g.beginPath(); g.arc(0, -15.5, 0.9, 0, TAU); g.fill(); }
      g.restore();
      const hx = x + Math.sin(vis.ang) * 15.5 * sc, hy = y - Math.cos(vis.ang) * 15.5 * sc;
      return { hx, hy };
    }
    function drawRope(hand, time, dt) {
      const a = player.anchor;
      const braid = (path) => {
        g.lineCap = "round";
        g.strokeStyle = "#2f2823"; g.lineWidth = px(2.6); path(); g.stroke();
        g.save(); g.strokeStyle = "#b9a888"; g.lineWidth = px(1.1); g.setLineDash([px(2.5), px(2.5)]); g.lineDashOffset = -player.L * 0.5; path(); g.stroke(); g.restore();
      };
      if (a) {
        fx.ropeExtend = Math.min(1, fx.ropeExtend + dt / 0.07);
        const ax = a.px + (a.x - a.px) * renderAlpha, ay = a.py + (a.y - a.py) * renderAlpha;
        const ex = lerp(hand.hx, ax, fx.ropeExtend), ey = lerp(hand.hy, ay, fx.ropeExtend);
        const d = Math.hypot(ax - hand.hx, ay - hand.hy);
        const slack = player.mode === "slack" || player.mode === "ground" ? Math.sqrt(Math.max(0, player.L * player.L - d * d)) * 0.55 : 0;
        fx.ropeVib *= Math.exp(-dt * 7);
        const vib = fx.ropeVib;
        braid(() => {
          g.beginPath(); g.moveTo(hand.hx, hand.hy);
          if (slack > 2 || vib < 0.2 || fx.ropeExtend < 1) {
            g.quadraticCurveTo((hand.hx + ex) / 2, (hand.hy + ey) / 2 + slack, ex, ey);
          } else {
            const nx = -(ey - hand.hy) / (d || 1), ny = (ex - hand.hx) / (d || 1);
            for (let i = 1; i <= 12; i++) {
              const t = i / 12, w = Math.sin(t * Math.PI) * Math.sin(time * 55 + t * 9) * vib;
              g.lineTo(lerp(hand.hx, ex, t) + nx * w, lerp(hand.hy, ey, t) + ny * w);
            }
          }
        });
        if (fx.ropeExtend < 1) { g.fillStyle = "#c49650"; g.beginPath(); g.arc(ex, ey, px(3), 0, TAU); g.fill(); }
      } else if (fx.retract) {
        fx.retract.t += dt;
        const t = Math.min(1, fx.retract.t / 0.16);
        const ex = lerp(fx.retract.x, hand.hx, t), ey = lerp(fx.retract.y, hand.hy, t);
        braid(() => {
          g.beginPath(); g.moveTo(hand.hx, hand.hy);
          for (let i = 1; i <= 8; i++) { const u = i / 8; g.lineTo(lerp(hand.hx, ex, u) + Math.sin(u * 12 + t * 20) * 5 * (1 - t), lerp(hand.hy, ey, u)); }
        });
        g.fillStyle = "#c49650"; g.beginPath(); g.arc(ex, ey, px(2.6), 0, TAU); g.fill();
        if (t >= 1) fx.retract = null;
      }
    }

    // trajectory read-ahead using the real flight integrator (assist; fades with experience)
    function predict(assist) {
      for (const a of route.anchors) a.glintT = 0;
      if (!player.anchor || player.mode === "ground" || gameState !== "play") return null;
      const pts = [];
      let x = player.x, y = player.y, vx = player.vx, vy = player.vy;
      const k = 1 - AIR_DRAG * DT;
      let hit = null;
      const ex = player.anchor;
      for (let i = 0; i < 300 && !hit; i++) {
        vx += worldWind(x, y) * DT; vy += G * DT; vx *= k; vy *= k; x += vx * DT; y += vy * DT;
        if (i % 6 === 0) pts.push(x, y);
        if (y > DEATH_Y) break;
        if (i % 2 === 0) {
          for (const a of route.anchors) {
            if (a === ex || !a.catchable || a.broken || a.y > y - 10) continue;
            const dx = x - a.x, dy = y - a.y;
            if (dx * dx + dy * dy <= a.reach * a.reach) { hit = a; break; }
          }
        }
      }
      if (hit) hit.glintT = 1;
      return { pts, hit };
    }

    // =====================================================================
    // 13. HUD
    // =====================================================================
    function roundRect(x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
      g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    function paper(x, y, w, h, rot) {
      g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(rot || 0); g.translate(-w / 2, -h / 2);
      g.fillStyle = "rgba(20,18,15,0.28)"; roundRect(2, 3, w, h, 3); g.fill();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#efe4c8"); gr.addColorStop(1, "#ddcca6");
      g.fillStyle = gr; roundRect(0, 0, w, h, 3); g.fill();
      g.strokeStyle = "rgba(110,90,60,0.55)"; g.lineWidth = 1; roundRect(0.5, 0.5, w - 1, h - 1, 3); g.stroke();
      g.restore();
    }
    const UI = { pause: null, mute: null, again: null };
    function drawButton(x, y, r, kind) {
      g.fillStyle = "rgba(28,30,28,0.45)"; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = "rgba(240,228,200,0.85)"; g.fillStyle = "rgba(240,228,200,0.9)"; g.lineWidth = 2;
      if (kind === "pause") { g.fillRect(x - 5, y - 6, 3.5, 12); g.fillRect(x + 1.5, y - 6, 3.5, 12); }
      else {
        g.beginPath(); g.moveTo(x - 7, y - 3); g.lineTo(x - 3, y - 3); g.lineTo(x + 2, y - 7); g.lineTo(x + 2, y + 7); g.lineTo(x - 3, y + 3); g.lineTo(x - 7, y + 3); g.closePath(); g.fill();
        if (records.muted) { g.beginPath(); g.moveTo(x + 5, y - 4); g.lineTo(x + 10, y + 4); g.moveTo(x + 10, y - 4); g.lineTo(x + 5, y + 4); g.stroke(); }
        else { g.beginPath(); g.arc(x + 3, y, 5, -0.8, 0.8); g.stroke(); }
      }
    }
    function drawHUD(time, dt) {
      const top = safe.top + 10;
      // buttons
      const br = 16;
      UI.mute = { x: Wd - 12 - br, y: top + br, r: br + 6 };
      UI.pause = { x: Wd - 12 - br * 3 - 8, y: top + br, r: br + 6 };
      if (gameState !== "results") { drawButton(UI.mute.x, UI.mute.y, br, "mute"); if (gameState === "play") drawButton(UI.pause.x, UI.pause.y, br, "pause"); }
      if (gameState === "title" || gameState === "results") return;
      // score
      g.textAlign = "right"; g.textBaseline = "top";
      g.font = "bold 22px " + SERIF;
      g.fillStyle = "rgba(20,18,15,0.45)"; g.fillText(String(run.score), Wd - 13, top + br * 2 + 9);
      g.fillStyle = "#f3e7c9"; g.fillText(String(run.score), Wd - 14, top + br * 2 + 8);
      if (run.streak >= 2) { g.font = "12px " + SERIF; g.fillStyle = "#f6d38a"; g.fillText("streak ×" + (1 + 0.2 * Math.min(run.streak - 1, 10)).toFixed(1), Wd - 14, top + br * 2 + 34); }
      // letter card
      const L = activeLetter();
      const cw = Math.min(236, Wd * 0.6), ch = 52;
      paper(12, top, cw, ch, -0.012);
      g.save(); g.translate(12, top);
      if (L) {
        drawEnvelopeUI(20, 26, L.parcel);
        g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = "#2b2a26";
        g.font = "bold 13px " + SERIF; g.fillText(fitText("To " + L.name, cw - 74), 40, 22);
        g.font = "11.5px " + SERIF; g.fillStyle = "#4a443a";
        g.fillText(fitText(L.parcel ? "No. " + L.number + " · parcel, handle gently" : "No. " + L.number + ", sign of the " + L.symbol, cw - 74), 40, 39);
        g.fillStyle = "#e9dcbc"; g.fillRect(cw - 30, 9, 22, 32); g.strokeStyle = "#2e4a47"; g.lineWidth = 1.2; g.strokeRect(cw - 28.5, 10.5, 19, 29);
        g.fillStyle = "#2e4a47"; g.font = "bold 9px " + SERIF; g.textAlign = "center"; g.fillText(String(L.number), cw - 19, 21);
        drawSymbol(L.symbol, cw - 19, 31, 1, "#8f3b2f");
      } else {
        g.textAlign = "left"; g.fillStyle = "#2b2a26"; g.font = "italic 12px " + SERIF; g.fillText("Collecting the next bag…", 14, 30);
      }
      g.restore();
      // ledger stamps
      const st = run.ledger.slice(-9);
      for (let i = 0; i < st.length; i++) {
        const e = st[i], x = 16 + i * 17, y = top + ch + 8;
        if (e.kind === "missed") { g.strokeStyle = "rgba(230,215,190,0.6)"; g.lineWidth = 1; g.strokeRect(x, y, 13, 13); g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + 10, y + 10); g.moveTo(x + 10, y + 3); g.lineTo(x + 3, y + 10); g.stroke(); continue; }
        g.fillStyle = e.kind === "gold" ? "#d9a441" : "#e3d6b6"; g.fillRect(x, y, 13, 13);
        g.strokeStyle = "rgba(60,40,20,0.6)"; g.lineWidth = 0.8; g.strokeRect(x + 1.5, y + 1.5, 10, 10);
        drawSymbol(e.symbol, x + 6.5, y + 6.5, 0.8, e.kind === "gold" ? "#5a3412" : "#6d6252");
      }
      // incoming stamp animation
      for (const s of fx.stamps) s.t += dt;
      fx.stamps = fx.stamps.filter(s => s.t < 0.7);
      for (const s of fx.stamps) {
        const i = Math.min(st.length - 1, 8), x = 16 + i * 17 + 6.5, y = top + ch + 14.5;
        const k = 1 + (1 - smooth(Math.min(1, s.t / 0.3))) * 1.6;
        g.globalAlpha = Math.min(1, s.t / 0.12) * (1 - Math.max(0, (s.t - 0.45) / 0.25));
        g.fillStyle = s.gold ? "rgba(217,164,65,0.9)" : "rgba(227,214,182,0.9)";
        g.fillRect(x - 7 * k, y - 7 * k, 14 * k, 14 * k);
        drawSymbol(s.symbol, x, y, 0.8 * k, "#5a3412");
        g.globalAlpha = 1;
        if (s.t > 0.33 && !s.sounded) { s.sounded = true; audio.stamp(); }
      }
      // district banner
      if (fx.banner) {
        fx.banner.t += dt;
        const t = fx.banner.t, a = t < 0.4 ? t / 0.4 : t > 3 ? Math.max(0, 1 - (t - 3) / 0.6) : 1;
        if (t > 3.6) fx.banner = null;
        else {
          const P = DISTRICTS[fx.banner.d];
          g.globalAlpha = a;
          const bw = Math.min(300, Wd - 40), bx = (Wd - bw) / 2, by = top + 92;
          paper(bx, by, bw, 46, 0.006);
          g.fillStyle = "#2b2a26"; g.textAlign = "center"; g.textBaseline = "middle";
          g.font = "11px " + SERIF; g.fillText("DISTRICT " + P.numeral, Wd / 2, by + 14);
          g.font = "bold 18px " + SERIF; g.fillText(P.name.toUpperCase(), Wd / 2, by + 31);
          g.globalAlpha = 1;
        }
      }
      // target indicator when the recipient is off screen
      if (L && L.status === "pending") {
        const tx = sx(L.x), ty = sy(L.y), m = 30;
        if (tx < -10 || tx > Wd + 10 || ty < -10 || ty > Hd + 10) {
          const cx = clamp(tx, m, Wd - m), cy = clamp(ty, top + 90, Hd - safe.bottom - 70);
          const ang = Math.atan2(ty - cy, tx - cx);
          g.save(); g.translate(cx, cy);
          g.fillStyle = "rgba(25,24,22,0.5)"; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill();
          drawEnvelopeUI(0, 0, L.parcel, 0.8);
          g.rotate(ang); g.fillStyle = "#f3e7c9"; g.beginPath(); g.moveTo(21, 0); g.lineTo(15, -4); g.lineTo(15, 4); g.closePath(); g.fill();
          g.restore();
        }
      }
    }
    function drawEnvelopeUI(x, y, parcel, s) {
      g.save(); g.translate(x, y); g.scale(s || 1, s || 1);
      if (parcel) { g.fillStyle = "#b48a5a"; g.fillRect(-9, -7, 18, 14); g.strokeStyle = "#5a3e26"; g.lineWidth = 1.2; g.strokeRect(-9, -7, 18, 14); g.beginPath(); g.moveTo(0, -7); g.lineTo(0, 7); g.moveTo(-9, 0); g.lineTo(9, 0); g.stroke(); }
      else { g.fillStyle = "#f6edd6"; g.fillRect(-10, -7, 20, 14); g.strokeStyle = "#6b5a46"; g.lineWidth = 1.1; g.strokeRect(-10, -7, 20, 14); g.beginPath(); g.moveTo(-10, -7); g.lineTo(0, 1); g.lineTo(10, -7); g.stroke(); g.fillStyle = "#a8483a"; g.beginPath(); g.arc(0, 1.5, 2, 0, TAU); g.fill(); }
      g.restore();
    }
    function fitText(t, w) {
      if (g.measureText(t).width <= w) return t;
      while (t.length > 3 && g.measureText(t + "…").width > w) t = t.slice(0, -1);
      return t + "…";
    }
    function hintText(time) {
      if (paused) return null;
      if (gameState === "title") return null;
      if (gameState !== "play") return null;
      const p = player;
      if (!run.started) return null;
      if (p.mode === "ground" && run.catches > 0 && !records.seenHop) return p.anchor ? "Tap to push off the roof" : "Tap to hop toward a ring";
      if (!records.seenRelease && p.anchor && p.mode === "swing" && p.om > 0.3 && p.th > -0.2) return "Tap to let go — fly to the next ring";
      if (!records.seenDeliver && activeLetter() && Math.abs(activeLetter().x - p.x) < 420) return "Swing through the lit window to post the letter";
      if (records.seenDeliver && !records.seenReel && run.delivered >= 1 && p.anchor && p.mode === "swing") return "Drag up or down to reel the line in or out";
      if (p.anchor && p.mode === "swing" && run.hangT > 5 && !(activeLetter() && activeLetter().D === p.anchor) && !records.seenPump) return "Weak swing? Reel in at the bottom, out at the ends, to pump higher";
      return null;
    }
    function drawHint(time) {
      const h = hintText(time);
      if (!h) { hintAlpha = Math.max(0, hintAlpha - 0.05); if (hintAlpha <= 0) return; }
      else { lastHint = h; hintAlpha = Math.min(1, hintAlpha + 0.08); }
      const y = Hd - safe.bottom - (Hd > 600 ? 96 : 52);
      g.font = "15px " + SERIF;
      const w = Math.min(Wd - 30, g.measureText(lastHint).width + 30);
      g.globalAlpha = hintAlpha;
      g.fillStyle = "rgba(24,26,24,0.62)"; roundRect((Wd - w) / 2, y - 18, w, 36, 18); g.fill();
      g.fillStyle = "#f3e7c9"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(fitText(lastHint, w - 20), Wd / 2, y + 1);
      g.globalAlpha = 1;
    }
    let hintAlpha = 0, lastHint = "";

    function drawTitle(time) {
      const bw = Math.min(330, Wd - 40), bx = (Wd - bw) / 2, by = safe.top + Hd * 0.13;
      paper(bx, by, bw, 104, -0.01);
      g.fillStyle = "#2b2a26"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "11px " + SERIF; g.fillText("THE STACKS POSTAL SERVICE", Wd / 2, by + 18);
      g.font = "bold 28px " + SERIF; g.fillText("Pendulum Postman", Wd / 2, by + 48);
      g.font = "italic 13px " + SERIF; g.fillStyle = "#4a443a"; g.fillText("Swing the city's cables. Deliver every letter.", Wd / 2, by + 76);
      if (records.best > 0) { g.font = "12px " + SERIF; g.fillText("Best ledger: " + records.best, Wd / 2, by + 94); }
      const a = 0.6 + 0.4 * Math.sin(time * 3);
      const y = Hd - safe.bottom - 96;
      g.globalAlpha = a;
      g.font = "16px " + SERIF;
      const msg = "Tap to step off the ledge";
      const w = g.measureText(msg).width + 34;
      g.fillStyle = "rgba(24,26,24,0.62)"; roundRect((Wd - w) / 2, y - 19, w, 38, 19); g.fill();
      g.fillStyle = "#f3e7c9"; g.fillText(msg, Wd / 2, y + 1);
      g.globalAlpha = 1;
    }
    function drawResults(time) {
      const r = run;
      const bw = Math.min(330, Wd - 32), bh = 336, bx = (Wd - bw) / 2, by = Math.max(safe.top + 16, (Hd - safe.bottom - bh) / 2 - 20);
      g.fillStyle = "rgba(15,18,17,0.35)"; g.fillRect(0, 0, Wd, Hd);
      paper(bx, by, bw, bh, -0.006);
      g.save(); g.translate(bx, by);
      g.textBaseline = "middle"; g.textAlign = "center"; g.fillStyle = "#2b2a26";
      g.font = "11px " + SERIF; g.fillText("POSTAL LEDGER · SHIFT " + records.runs, bw / 2, 20);
      g.font = "bold 21px " + SERIF; g.fillText("Lost to the fog", bw / 2, 44);
      g.font = "italic 12px " + SERIF; g.fillStyle = "#5a4f40";
      const why = r.deathNear ? "Missed a ring by " + r.deathNear.gap + " paces" : "Reached " + DISTRICTS[r.district].name;
      g.fillText(fitText(why, bw - 30), bw / 2, 64);
      const rows = [
        ["Letters delivered", r.delivered + (r.gold ? "  (" + r.gold + " clean)" : "")],
        ["Best delivery streak", String(r.bestStreak)],
        ["Airmail stamps", String(r.airmail)],
        ["Clean transfers", r.clean + (r.bestChain >= 3 ? "  (flow ×" + r.bestChain + ")" : "")],
        ["District reached", DISTRICTS[r.district].numeral + " · " + DISTRICTS[r.district].name.replace("The ", "")]
      ];
      g.font = "13px " + SERIF;
      for (let i = 0; i < rows.length; i++) {
        const y = 92 + i * 23;
        g.textAlign = "left"; g.fillStyle = "#4a443a"; g.fillText(rows[i][0], 18, y);
        g.textAlign = "right"; g.fillStyle = "#2b2a26"; g.fillText(fitText(rows[i][1], bw * 0.5), bw - 18, y);
        g.strokeStyle = "rgba(110,90,60,0.25)"; g.beginPath(); g.moveTo(18, y + 11); g.lineTo(bw - 18, y + 11); g.stroke();
      }
      g.textAlign = "center"; g.fillStyle = "#2b2a26";
      g.font = "bold 30px " + SERIF; g.fillText(String(r.score), bw / 2, 222);
      g.font = "12px " + SERIF; g.fillStyle = "#5a4f40";
      let sub = "Best " + records.best;
      if (r.newBest) sub = "New personal best";
      if (r.prev !== null && r.prev !== undefined) { const dlt = r.score - r.prev; sub += "  ·  " + (dlt >= 0 ? "+" : "") + dlt + " on last shift"; }
      g.fillText(fitText(sub, bw - 24), bw / 2, 248);
      // stamps of this run
      const st = r.ledger.slice(-12);
      const sw = st.length * 17;
      for (let i = 0; i < st.length; i++) {
        const e = st[i], x = bw / 2 - sw / 2 + i * 17, y = 262;
        if (e.kind === "missed") { g.strokeStyle = "rgba(110,90,60,0.6)"; g.strokeRect(x, y, 13, 13); continue; }
        g.fillStyle = e.kind === "gold" ? "#d9a441" : "#cbbd9b"; g.fillRect(x, y, 13, 13);
        drawSymbol(e.symbol, x + 6.5, y + 6.5, 0.8, "#5a3412");
      }
      const ready = (performance.now() - r.resultsAt) > 600;
      g.globalAlpha = ready ? 1 : 0.4;
      const bw2 = 170, bx2 = (bw - bw2) / 2, by2 = bh - 28;
      g.fillStyle = "#2e4a47"; roundRect(bx2, by2 - 16, bw2, 32, 16); g.fill();
      g.fillStyle = "#efe4c8"; g.font = "bold 14px " + SERIF; g.fillText("Next shift  ▸", bw / 2, by2);
      g.globalAlpha = 1;
      g.restore();
      UI.again = { x: bx + bw / 2, y: by + by2, r: 90 };
    }
    function drawPaused() {
      g.fillStyle = "rgba(15,18,17,0.45)"; g.fillRect(0, 0, Wd, Hd);
      const bw = Math.min(260, Wd - 40), bx = (Wd - bw) / 2, by = Hd * 0.38;
      paper(bx, by, bw, 70, 0);
      g.fillStyle = "#2b2a26"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "bold 18px " + SERIF; g.fillText("Paused", Wd / 2, by + 24);
      g.font = "italic 12px " + SERIF; g.fillText("Tap to keep swinging", Wd / 2, by + 48);
    }

    // =====================================================================
    // 14. FRAME
    // =====================================================================
    let renderAlpha = 1, renderTime = 0, lastReelTickL = 0;
    function updateCamera(dt, rx, ry) {
      const wW = Wd / S, wH = Hd / S;
      let tx = rx + wW * 0.12 + clamp(player.vx * 0.2, -90, 170);
      let ty = ry - 40;
      let nxt = null;
      for (const a of route.anchors) { if (a.bx > rx + 60 && a !== player.anchor) { if (!nxt || a.bx < nxt.bx) nxt = a; } }
      if (nxt) ty = lerp(ty, nxt.y + 130, 0.25);
      const L = activeLetter();
      if (L && Math.abs(L.x - rx) < wW * 0.7) ty = lerp(ty, L.y, 0.15);
      ty = Math.min(ty, FOG_Y + 150 - wH / 2);
      if (gameState === "dying") { tx = cam.x; ty = cam.y + 20 * dt; }
      if (cam.snap) { cam.x = tx; cam.y = ty; cam.snap = false; }
      else {
        cam.x += (tx - cam.x) * (1 - Math.exp(-dt * 3.4));
        cam.y += (ty - cam.y) * (1 - Math.exp(-dt * 2.6));
      }
      if (gameState !== "dying") {
        const mTop = 110 / S, mBot = 120 / S;
        // keep the ring the courier hangs from in frame when the view allows it
        if (player.anchor) cam.y = Math.min(cam.y, Math.max(player.anchor.y + wH / 2 - 70 / S, ry - wH / 2 + mBot));
        cam.y = clamp(cam.y, ry - wH / 2 + mBot, ry + wH / 2 - mTop);
        cam.x = clamp(cam.x, rx - wW / 2 + 60 / S, rx + wW / 2 - 60 / S);
      }
    }

    function render(alpha, dtMs) {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      renderAlpha = alpha;
      renderTime += paused ? 0 : dt;
      const time = renderTime;
      let rx = player.px + (player.x - player.px) * alpha, ry = player.py + (player.y - player.py) * alpha;
      if (fx.renderOff) {
        rx += fx.renderOff.x; ry += fx.renderOff.y;
        const k = Math.exp(-dt / 0.06);
        fx.renderOff.x *= k; fx.renderOff.y *= k;
        if (Math.abs(fx.renderOff.x) + Math.abs(fx.renderOff.y) < 0.05) fx.renderOff = null;
      }
      if (!paused) updateCamera(dt, rx, ry);
      const db = districtAtX(cam.x);
      const view = { x0: cam.x - W2 / S - 40, x1: cam.x + W2 / S + 40, y0: cam.y - H2 / S, y1: cam.y + H2 / S };
      const useBg = ensureBg();
      if (useBg) { g = bg.g; g.setTransform(bg.k, 0, 0, bg.k, 0, 0); }
      drawSky(db);
      drawFarLayers(db);
      drawBirds(paused ? 0 : dt);
      worldBegin(); drawStructures(view, [2]); worldEnd();
      if (useBg) { g = mainG; g.drawImage(bg.cv, 0, 0, Wd, Hd); }
      const assist = clamp(1 - records.catches / 45, 0, 1) * (run.district <= 1 ? 1 : 0.5);
      const pred = predict(assist);
      worldBegin();
      drawStructures(view, [1, 0]);
      drawLamps(view, time);
      drawGates(view, time);
      drawDecor(view, time);
      drawRecipients(view, time, assist);
      drawRewards(view, time);
      // smoke from chimneys
      if (!paused) {
        for (const st of route.structures) {
          if (!st.chimneys || st.x < view.x0 || st.x > view.x1) continue;
          for (const c of st.chimneys) if (Math.random() < dt * 1.2) fx.parts.push({ x: c.x, y: c.y, vx: 6 + worldWind(c.x, c.y) * 0.05, vy: -18, t: 0, life: 3.2, c: "rgba(225,225,215,", s: 4, g: -2, kind: "smoke" });
        }
      }
      for (const a of route.anchors) {
        if (a.x < view.x0 - 260 || a.x > view.x1 + 260) continue;
        drawAnchorSupport(a, time);
      }
      for (const a of route.anchors) {
        if (a.x < view.x0 - 40 || a.x > view.x1 + 40) continue;
        a.glint = lerp(a.glint, a.glintT || 0, 1 - Math.exp(-dt * 12));
        if (a !== player.anchor && !a.broken && a !== player.exclude) drawReach(a, (0.1 + 0.12 * assist) + a.glint * (0.15 + 0.25 * assist));
        drawRing(a, time, a.glint * (0.4 + 0.6 * assist));
      }
      if (pred && assist > 0.02) {
        g.fillStyle = "rgba(246,236,210," + (0.55 * assist) + ")";
        for (let i = 0; i < pred.pts.length; i += 2) { g.beginPath(); g.arc(pred.pts[i], pred.pts[i + 1], px(1.6), 0, TAU); g.fill(); }
      }
      if (fx.nearMiss) {
        fx.nearMiss.t += dt;
        const a = fx.nearMiss.a;
        g.save(); g.strokeStyle = "rgba(255,170,130," + Math.max(0, 0.8 - fx.nearMiss.t * 0.4) + ")"; g.lineWidth = px(2);
        g.setLineDash([px(4), px(4)]); g.beginPath(); g.arc(a.x, a.y, a.reach, 0, Math.PI); g.stroke(); g.restore();
      }
      const hand = drawCourier(rx, ry, paused ? 0 : dt, time);
      drawRope(hand, time, paused ? 0 : dt);
      // reel gauge while dragging
      if (dragId !== null && player.anchor) {
        const gx = rx + px(26), gy = ry - px(30), gh = px(44);
        g.fillStyle = "rgba(24,26,24,0.5)"; g.fillRect(gx - px(3), gy, px(6), gh);
        const t = (player.L - LMIN) / (LMAX - LMIN);
        g.fillStyle = "#f3d79a"; g.fillRect(gx - px(3), gy + gh * t - px(1.5), px(6), px(3));
        if (Math.abs(player.L - lastReelTickL) > 10) { lastReelTickL = player.L; audio.reelTick(); }
      }
      // particles
      for (const p of fx.parts) {
        if (!paused) { p.t += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        const k = 1 - p.t / p.life;
        if (k <= 0) continue;
        if (p.kind === "smoke") { const r = p.s + p.t * 9; g.fillStyle = p.c + (0.14 * k) + ")"; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill(); }
        else if (p.kind === "paper") { g.save(); g.translate(p.x, p.y); g.rotate(p.r + p.t * 4); g.globalAlpha = k; g.fillStyle = p.c; g.fillRect(-px(3), -px(2), px(6), px(4)); g.restore(); g.globalAlpha = 1; }
        else { g.globalAlpha = k; g.fillStyle = p.c; g.fillRect(p.x - px(p.s / 2), p.y - px(p.s / 2), px(p.s), px(p.s)); g.globalAlpha = 1; }
      }
      fx.parts = fx.parts.filter(p => p.t < p.life);
      if (fx.parts.length > 400) fx.parts.splice(0, fx.parts.length - 400);
      // floating texts
      for (const t of fx.texts) {
        if (!paused) t.t += dt;
        const k = 1 - t.t / t.life;
        if (k <= 0) continue;
        g.globalAlpha = Math.min(1, k * 2);
        g.font = "bold " + px(t.size) + "px " + SERIF; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "rgba(20,18,15,0.55)"; g.fillText(t.text, t.x + px(1), t.y - t.t * 26 + px(1));
        g.fillStyle = t.color; g.fillText(t.text, t.x, t.y - t.t * 26);
        g.globalAlpha = 1;
      }
      fx.texts = fx.texts.filter(t => t.t < t.life);
      // fog sea
      const P = DISTRICTS[db.b];
      const fogCol = mix(DISTRICTS[db.a].fog, P.fog, db.t);
      const fgr = g.createLinearGradient(0, FOG_Y - 300, 0, FOG_Y + 60);
      fgr.addColorStop(0, "rgba(120,150,140,0)"); fgr.addColorStop(0.7, fogCol.replace("rgb", "rgba").replace(")", ",0.55)")); fgr.addColorStop(1, fogCol);
      g.fillStyle = fgr; g.fillRect(view.x0 - 50, FOG_Y - 300, view.x1 - view.x0 + 100, 360);
      g.fillStyle = fogCol; g.fillRect(view.x0 - 50, FOG_Y + 59, view.x1 - view.x0 + 100, Math.max(0, view.y1 - FOG_Y + 200));
      const ft = getFogTile();
      if (ft) {
        if (!ft.pat) ft.pat = g.createPattern(ft.cv, "repeat-x");
        for (const [yy, sp, al] of [[FOG_Y - 150, 12, 0.8], [FOG_Y - 60, -8, 0.9]]) {
          const off = ((time * sp) % ft.w + ft.w) % ft.w;
          g.save(); g.globalAlpha = al;
          g.translate(off, yy); g.scale(1 / ft.k, 1 / ft.k);
          g.fillStyle = ft.pat;
          g.fillRect((view.x0 - off - ft.w) * ft.k, 0, (view.x1 - view.x0 + ft.w * 2) * ft.k, ft.h * ft.k);
          g.restore();
        }
      }
      worldEnd();
      drawForeground(time);
      if (gameState === "dying") { g.fillStyle = "rgba(110,135,128," + Math.min(0.6, run.dyingT * 0.6) + ")"; g.fillRect(0, 0, Wd, Hd); }
      drawHUD(time, dt);
      if (gameState === "title") drawTitle(time);
      else if (gameState === "results") drawResults(time);
      else drawHint(time);
      if (paused && gameState !== "results") drawPaused();
      for (const L of route.deliveries) { if (L.flash > 0) L.flash = Math.max(0, L.flash - dt * 0.8); if (L.wave > 0) L.wave = Math.max(0, L.wave - dt * 0.45); }
      const sp = Math.hypot(player.vx, player.vy);
      audio.wind(gameState === "play" && !paused ? sp : 0, !!player.anchor);
    }
    function drawForeground(time) {
      // dark near-camera cables and leaves framing the top edge (never mid-screen)
      const par = 1.35;
      g.save();
      g.strokeStyle = "rgba(18,22,22,0.7)"; g.lineWidth = 2.4;
      const cell = 1100;
      const base = cam.x * par;
      const i0 = Math.floor((base - W2 / S * par) / cell);
      for (let i = i0; i < i0 + 4; i++) {
        const r = mulberry32(hash2(i, 77));
        if (r() < 0.35) continue;
        const x0 = (i * cell - base) * S + W2, x1 = x0 + rr(r, 500, 900) * S;
        const y0 = safe.top - 10 + rr(r, 0, 30), y1 = safe.top - 10 + rr(r, 0, 30), sag = rr(r, 30, 70);
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag, x1, y1); g.stroke();
        if (r() < 0.6) {
          const lx = lerp(x0, x1, 0.3);
          for (let k = 0; k < 9; k++) {
            g.fillStyle = "rgba(24,38,30," + rr(r, 0.55, 0.85) + ")";
            g.beginPath(); g.ellipse(lx + rr(r, -30, 30), y0 + sag * 0.4 + rr(r, -6, 18), rr(r, 6, 14), rr(r, 3, 6), rr(r, 0, 3) + Math.sin(time + k) * 0.05, 0, TAU); g.fill();
          }
        }
      }
      g.restore();
    }

    // =====================================================================
    // 15. INPUT — tap releases, vertical drag reels; a real drag never releases
    // =====================================================================
    const pointers = new Map();
    let dragId = null;
    function localXY(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function hitUI(b, x, y) { return b && Math.hypot(x - b.x, y - b.y) <= b.r; }
    ctx.listen(canvas, "pointerdown", e => {
      if (e.cancelable) e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      audio.unlock();
      const p = localXY(e);
      pointers.set(e.pointerId, {
        x0: p.x, y0: p.y, lastY: p.y, t0: performance.now(), mode: "pending",
        sn: gameState === "play" && player.anchor && player.mode === "swing" ? snapshot() : null
      });
    }, { passive: false });
    ctx.listen(canvas, "pointermove", e => {
      const st = pointers.get(e.pointerId);
      if (!st) return;
      const p = localXY(e);
      const dx = p.x - st.x0, dy = p.y - st.y0;
      if (st.mode === "pending") {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 0.9 && dragId === null && gameState === "play" && !paused && player.anchor) {
          st.mode = "drag"; dragId = e.pointerId; st.lastY = p.y;
          player.reelTarget = player.L;
        } else if (Math.hypot(dx, dy) > 22) st.mode = "void";
      } else if (st.mode === "drag") {
        const d = p.y - st.lastY; st.lastY = p.y;
        if (player.anchor) {
          const base = player.reelTarget === null ? player.L : player.reelTarget;
          player.reelTarget = clamp(base + (d / S) * 0.9, LMIN, LMAX);
          run.reelUsed += Math.abs(d / S);
          if (run.reelUsed > 90 && !records.seenReel) { records.seenReel = true; saveRecords(); }
        }
      }
    });
    function endPointer(e, cancelled) {
      const st = pointers.get(e.pointerId);
      if (!st) return;
      pointers.delete(e.pointerId);
      if (st.mode === "drag") { if (dragId === e.pointerId) { dragId = null; player.reelTarget = null; } return; }
      if (cancelled || st.mode !== "pending") return;
      const p = localXY(e);
      if (performance.now() - st.t0 < 450 && Math.hypot(p.x - st.x0, p.y - st.y0) < 16) handleTap(p.x, p.y, st.sn);
    }
    ctx.listen(canvas, "pointerup", e => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", e => endPointer(e, true));
    function cancelAllPointers() { pointers.clear(); dragId = null; player.reelTarget = null; }

    function startPlay() {
      gameState = "play";
      run.started = true;
      try { ctx.platform.start({ attempt }); } catch (e) { /* ignore */ }
      startMusic();
      hop(1);
    }
    function handleTap(x, y, sn) {
      if (gameState !== "results" && hitUI(UI.mute, x, y)) { setMuted(!records.muted); return; }
      if (paused) { paused = false; audio.resume(); try { if (ctx.music && ctx.music.resume && musicOn) ctx.music.resume(); } catch (e) { /* ignore */ } return; }
      if (gameState === "play" && hitUI(UI.pause, x, y)) { paused = true; cancelAllPointers(); return; }
      if (gameState === "title") { startPlay(); return; }
      if (gameState === "results") {
        if (performance.now() - run.resultsAt > 600) newRun();
        return;
      }
      if (gameState !== "play") return;
      if (player.anchor && (player.mode === "swing" || player.mode === "slack")) {
        if (sn) releaseFromSnapshot(sn); else releaseLine(false);
      } else if (player.mode === "ground") {
        hop(x < sx(player.x) - 30 ? -1 : 1);
      }
    }
    ctx.listen(window, "blur", () => { cancelAllPointers(); if (gameState === "play") paused = true; });
    ctx.listen(document, "visibilitychange", () => {
      if (document.hidden) { cancelAllPointers(); if (gameState === "play") paused = true; audio.suspend(); }
      else audio.resume();
    });

    function endRun() {
      gameState = "results";
      run.resultsAt = performance.now();
      records.runs++;
      run.prev = records.last;
      run.newBest = run.score > records.best;
      records.best = Math.max(records.best, run.score);
      records.bestDeliveries = Math.max(records.bestDeliveries, run.delivered);
      records.bestStreak = Math.max(records.bestStreak, run.bestStreak);
      records.bestDistrict = Math.max(records.bestDistrict, run.district);
      records.last = run.score;
      saveRecords();
      cancelAllPointers();
      try { ctx.platform.fail({ score: run.score, delivered: run.delivered, district: run.district + 1 }); } catch (e) { /* ignore */ }
      if (score && score.submit) {
        const at = attempt;
        score.submit("score", { label: run.score + " pts" }).catch(() => { if (disposed || at !== attempt) return; });
      }
    }

    // =====================================================================
    // 16. LOOP + LIFECYCLE
    // =====================================================================
    function tick() {
      if (paused || !route) return;
      player.px = player.x; player.py = player.y;
      for (const a of route.anchors) { a.px = a.x; a.py = a.y; }
      if (gameState === "play" || gameState === "dying") {
        for (let i = 0; i < SUBSTEPS; i++) gameStep(DT);
        if (gameState === "dying") { run.dyingT += 1 / FIXED_HZ; if (run.dyingT > 1.15) endRun(); }
        ensureRoute(player.x);
        if (stepCounter % 240 === 0) pruneRoute(Math.min(player.x, cam.x));
      } else {
        for (const a of route.anchors) updateAnchorPos(a, 1 / FIXED_HZ);
      }
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

    layout();
    newRun();
    ctx.onResize(info => { layout(info); }, { immediate: false });
    // first meaningful frame before ready
    for (const st of route.structures) if (st.x - st.w < cam.x + 900 && st.x + st.w > cam.x - 900) st.sprite = paintStructure(st);
    render(1, 16);
    const loop = ctx.game.loop({
      fixedHz: FIXED_HZ,
      maxSubsteps: 8,
      fixedUpdate: () => tick(),
      render: (alpha, state) => render(alpha, state && state.dtMs)
    });
    ctx.onDestroy(() => {
      disposed = true; attempt++;
      try { if (ctx.music && ctx.music.stop) ctx.music.stop({ fadeOutMs: 100 }); } catch (e) { /* ignore */ }
      audio.suspend();
    });
    if (window.__PP_DEBUG) {
      window.__pp = {
        get player() { return player; }, get route() { return route; }, get run() { return run; }, get state() { return gameState; },
        records, stepPlayer, linkScore, makePlayer, newRun, handleTap, releaseLine, tick, DT, G, setPaused: v => { paused = v; },
        windFnFor, swingStates, flightHits, cam, get S() { return S; }, _gen: () => addEncounter(), _paint: st => paintStructure(st), _far: (d, l) => paintFar(d, l)
      };
    }
    ctx.platform.ready();
  }
};
