// STACKED — an endless, timing-based house-building Bit for Plethora.
//
// A floor hangs from a crane cable and swings over the tower. Tap to release.
// Only the part that overlaps the floor below survives; the overhang is cut off
// and falls away. Miss completely and the run ends.
//
// File map (search for the banner comments):
//   CONFIG ............ every gameplay variable worth tuning
//   PALETTE ........... colours for architecture, sky stages, people
//   FLOOR LIBRARY ..... archetypes, weights and procedural layout
//   FLOOR PAINTERS .... how each architectural piece is drawn
//   BACKGROUND ........ sky stages, skyline, clouds, ground street
//   AUDIO ............. tiny synthesized sound kit (WebAudio)
//   GAME STATE ........ run state, spawn / release / landing / overlap
//   RENDER ............ camera, world drawing, HUD, game over
//   INPUT + LIFECYCLE . tap / space / R, Plethora platform hooks

window.plethoraBit = {
  meta: {
    title: "Stacked",
    runtime: "plethora-bit@2",
    tags: ["arcade", "timing", "stacking", "architecture"],
    permissions: ["haptics", "audio", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    // ============================================================ CONFIG
    // All distances are world units. The playfield is ~360 units wide on a
    // 9:16 phone, so 1 unit is roughly one CSS pixel on a 360px-wide screen.
    const tuneNum = (id, fallback) => {
      try {
        const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined;
        return Number.isFinite(v) ? v : fallback;
      } catch (e) { return fallback; }
    };
    let CFG = {};
    function loadConfig() {
      CFG = {
        INITIAL_FLOOR_WIDTH: tuneNum("initial_floor_width", 150), // width of the first floors
        MIN_FLOOR_WIDTH: tuneNum("min_floor_width", 104),         // narrowest new floor at extreme height
        SWING_SPEED: tuneNum("swing_speed", 2.25),                // swing phase speed (rad/s) at floor 0
        MAX_SWING_SPEED: tuneNum("max_swing_speed", 4.4),         // swing phase speed at the top of the ramp
        SWING_AMPLITUDE: tuneNum("swing_amplitude", 112),         // half-width of the swing
        GRAVITY: tuneNum("gravity", 2600),                        // units/s^2 for falling floors
        WIND_STRENGTH: tuneNum("wind_strength", 22),              // max wind drift of the hanging floor
        WIND_START_FLOOR: 30,                                     // wind fades in from here
        PERFECT_THRESHOLD: tuneNum("perfect_threshold", 5),       // |centre offset| that counts as perfect
        MIN_OVERLAP: 6,                                           // less than this = miss
        COMBO_INCREMENT: tuneNum("combo_increment", 1),           // multiplier gained per perfect
        CAMERA_FOLLOW_SPEED: tuneNum("camera_follow_speed", 4.2), // higher = snappier camera
        FLOOR_SPAWN_HEIGHT: tuneNum("floor_spawn_height", 165),   // gap between tower top and hanging floor
        SETTLE_TIME: 0.3,                                         // pause after a landing before next floor
        ARRIVE_TIME: 0.45,                                        // how long a new floor takes to lower in
        MUSIC_VOLUME: tuneNum("music_volume", 0.22)
      };
    }
    loadConfig();
    const MILESTONES = [10, 25, 50, 100];
    const isMilestone = (n) => MILESTONES.includes(n) || (n > 100 && n % 50 === 0);

    // Difficulty ramp 0..1 by floor count (a creator-tunable curve when declared).
    const DEFAULT_RAMP = [[0, 0], [5, 0.04], [15, 0.2], [30, 0.38], [50, 0.6], [75, 0.78], [100, 0.9], [150, 1]];
    function ramp(n) {
      try {
        if (ctx.tune && ctx.tune.has && ctx.tune.has("difficulty_ramp")) {
          const v = ctx.tune.curve("difficulty_ramp").at(n);
          if (Number.isFinite(v)) return clamp(v, 0, 1.2);
        }
      } catch (e) { /* fall through to the built-in ramp */ }
      for (let i = 1; i < DEFAULT_RAMP.length; i++) {
        const [x1, y1] = DEFAULT_RAMP[i], [x0, y0] = DEFAULT_RAMP[i - 1];
        if (n <= x1) return y0 + (y1 - y0) * sstep(x0, x1, n);
      }
      return 1;
    }
    const swingSpeed = (n) => CFG.SWING_SPEED + (CFG.MAX_SWING_SPEED - CFG.SWING_SPEED) * ramp(n);
    const widthCap = (n) => n <= 5 ? CFG.INITIAL_FLOOR_WIDTH
      : lerp(CFG.INITIAL_FLOOR_WIDTH, CFG.MIN_FLOOR_WIDTH, sstep(5, 120, n));
    const windAmount = (n) => sstep(CFG.WIND_START_FLOOR, CFG.WIND_START_FLOOR + 30, n) * (n >= 80 ? 1.2 : 1);

    // ============================================================ UTILS
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function rngFrom(seed) {
      let s = (seed >>> 0) || 1;
      const r = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      r.range = (a, b) => a + (b - a) * r();
      r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
      r.pick = (arr) => arr[Math.floor(r() * arr.length)];
      r.chance = (p) => r() < p;
      return r;
    }
    const hexCache = {};
    function rgb(hex) {
      if (hexCache[hex]) return hexCache[hex];
      const h = hex.replace("#", "");
      const v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      hexCache[hex] = v;
      return v;
    }
    const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    const mixHex = (a, b, t) => css(mixRGB(rgb(a), rgb(b), t));

    // ============================================================ PALETTE
    const WALLS = [
      { name: "terracotta", wall: "#D9805A", shade: "#B6623F", trim: "#F3E3C6", accent: "#6F8F7B" },
      { name: "coral", wall: "#E39877", shade: "#C47758", trim: "#F6E9D1", accent: "#5F8296" },
      { name: "ochre", wall: "#E3AE66", shade: "#C48D45", trim: "#F7EBD3", accent: "#BF5E43" },
      { name: "cream", wall: "#F0DFC0", shade: "#D3BC96", trim: "#D27A55", accent: "#6F8F7B" },
      { name: "sand", wall: "#E7CC97", shade: "#C9AC74", trim: "#F8EED9", accent: "#C8674A" },
      { name: "sage", wall: "#B1C4A5", shade: "#8FA585", trim: "#F4E7CC", accent: "#D27A55" }
    ];
    const INK = "#3E302C";
    const GLASS = "#9CB9C1";
    const GLASS_DEEP = "#7F9EAA";
    const LIT = "#F5D48B";
    const CURTAIN = "#F6EBD8";
    const WOOD = "#8E5D41";
    const LEAF = ["#7FA17A", "#6B8F6C", "#93B27F", "#5E8466"];
    const BLOOM = ["#E0785A", "#F0B85E", "#F3E3C6", "#D9667A"];
    const CLOTHES = ["#3F4B5C", "#C8674A", "#5E7F6A", "#E2B65C", "#7A5A78", "#2F3A40"];
    const SKIN = ["#E5B994", "#C18A64", "#8D5E3F", "#F0C9A6"];
    const BOOKS = ["#C8674A", "#5F8296", "#E2B65C", "#6F8F7B", "#8A5A6A", "#F3E3C6"];

    // Sky stages blend smoothly by altitude (in floors).
    const STAGES = [
      { at: 0, name: "", top: "#C4DCCF", bot: "#F6E4C3", mtn: "#B9D0C4", tall: "#AECABB", far: "#9BBAA4", sun: "#FBF0D5", cloud: "#FBF5E9", star: 0 },
      { at: 12, name: "Upper City", top: "#AACDCB", bot: "#F2DDBA", mtn: "#B2CBC4", tall: "#A6C3B8", far: "#93B3A4", sun: "#FBEACB", cloud: "#FBF4E6", star: 0 },
      { at: 27, name: "Into the Clouds", top: "#B6CDD8", bot: "#EEE5D5", mtn: "#C3D3D3", tall: "#BACECD", far: "#AAC0BF", sun: "#FCF3E1", cloud: "#FCF8F0", star: 0 },
      { at: 52, name: "Above the Clouds", top: "#90B0C9", bot: "#F4D6B3", mtn: "#BACBD3", tall: "#B3C6CE", far: "#A6BBC4", sun: "#FDE4B9", cloud: "#FAEEDD", star: 0.15 },
      { at: 82, name: "The Thin Air", top: "#596590", bot: "#E7A98F", mtn: "#8C8FB0", tall: "#8F93B1", far: "#9C9AB5", sun: "#F4E8D6", cloud: "#EBCFC6", star: 1 }
    ];
    const STAGE_KEYS = ["top", "bot", "mtn", "tall", "far", "sun", "cloud"];
    function stageColors(alt) {
      const out = {};
      for (const k of STAGE_KEYS) out[k] = rgb(STAGES[0][k]);
      out.star = 0;
      for (let i = 1; i < STAGES.length; i++) {
        const t = sstep(STAGES[i].at - 5, STAGES[i].at + 5, alt);
        if (t <= 0) continue;
        for (const k of STAGE_KEYS) out[k] = mixRGB(out[k], rgb(STAGES[i][k]), t);
        out.star = lerp(out.star, STAGES[i].star, t);
      }
      return out;
    }

    // ============================================================ FLOOR LIBRARY
    // h: facade height. weight: how common. min: earliest floor it may appear.
    // Gameplay footprint is always the rectangle (w x h); details stay inside it.
    const TYPES = {
      entrance: { h: 54, weight: 0 },
      living: { h: 46, weight: 10 },
      bedroom: { h: 46, weight: 10 },
      balcony: { h: 48, weight: 8 },
      greenhouse: { h: 50, weight: 5 },
      studio: { h: 52, weight: 5 },
      terrace: { h: 46, weight: 6 },
      library: { h: 46, weight: 5 },
      cafe: { h: 48, weight: 4 },
      workshop: { h: 46, weight: 4 },
      garden: { h: 46, weight: 5 },
      pool: { h: 44, weight: 3, rare: true, min: 6 },
      attic: { h: 54, weight: 2, rare: true, min: 10 },
      clock: { h: 52, weight: 2, rare: true, min: 14 },
      observatory: { h: 52, weight: 2, rare: true, min: 9 }
    };
    // The first few floors tell a little story before randomness takes over.
    const OPENING = ["living", "bedroom", "balcony", "greenhouse", "studio", "terrace", "pool", "garden", "observatory"];

    function chooseType(n, rng, prevType) {
      if (n < OPENING.length) return OPENING[n];
      const pool = [];
      let total = 0;
      for (const k in TYPES) {
        const d = TYPES[k];
        if (!d.weight || k === prevType || (d.min && n < d.min)) continue;
        const wgt = d.weight * (d.rare ? 1 + n / 40 : 1);
        pool.push([k, wgt]);
        total += wgt;
      }
      let r = rng() * total;
      for (const [k, wgt] of pool) { r -= wgt; if (r <= 0) return k; }
      return "living";
    }

    let lastPal = -1;
    function makeFloor(type, w, rng) {
      let pi;
      do { pi = rng.chance(0.08) ? 5 : rng.int(0, 4); } while (pi === lastPal);
      lastPal = pi;
      const f = {
        type, w, h: TYPES[type].h, pal: WALLS[pi], items: [], people: [],
        phase: rng.range(0, 6.28), stip: []
      };
      for (let i = 0; i < 26; i++) f.stip.push([rng(), rng(), rng.range(0.6, 1.4)]);
      LAYOUT[type](f, rng);
      return f;
    }

    // Evenly spaced windows between x0 and x1.
    function windowRow(f, rng, x0, x1, opts) {
      const ww = opts.w, span = x1 - x0;
      const n = clamp(Math.floor((span + 10) / (ww + opts.gap)), opts.min || 1, opts.max || 4);
      const step = span / n;
      const out = [];
      for (let i = 0; i < n; i++) {
        const cx = x0 + step * (i + 0.5);
        const it = {
          k: "win", x: cx - ww / 2, y: opts.y, w: ww, h: opts.h,
          lit: rng.chance(opts.lit ?? 0.25), cur: opts.cur ? (rng.chance(0.5) ? -1 : 1) : 0,
          shut: !!opts.shut, box: !!opts.box, arch: !!opts.arch, books: !!opts.books,
          who: !!opts.who && i === 0 && rng.chance(0.5), phase: rng.range(0, 6.28)
        };
        f.items.push(it);
        out.push(it);
      }
      return out;
    }

    const LAYOUT = {
      entrance(f, rng) {
        const { w, h } = f;
        f.items.push({ k: "door", x: 0, w: 22, h: 32 });
        windowRow(f, rng, -w / 2 + 8, -16, { w: 15, h: 19, gap: 10, y: -h + 15, max: 2, cur: true, shut: true });
        windowRow(f, rng, 16, w / 2 - 8, { w: 15, h: 19, gap: 10, y: -h + 15, max: 2, cur: true, shut: true });
        f.items.push({ k: "pot", x: -19, y: 0 }, { k: "pot", x: 19, y: 0 });
        f.people.push({ pose: "walk", x0: -w / 2 + 10, x1: w / 2 - 10, y: 0, speed: 0.35, front: true, c: rng.pick(CLOTHES), s: rng.pick(SKIN), ph: rng.range(0, 6) });
      },
      living(f, rng) {
        const wins = windowRow(f, rng, -f.w / 2 + 8, f.w / 2 - 8, { w: 17, h: 21, gap: 15, y: -f.h + 13, cur: true, lit: 0.35, who: true });
        if (rng.chance(0.35)) f.items.push({ k: "lamp", x: wins[wins.length - 1].x + 8, y: -f.h + 9 });
      },
      bedroom(f, rng) {
        const wins = windowRow(f, rng, -f.w / 2 + 12, f.w / 2 - 12, { w: 14, h: 19, gap: 26, y: -f.h + 13, shut: true, box: true, cur: true, lit: 0.2, max: 3 });
        if (rng.chance(0.45)) f.items.push({ k: "can", win: rng.pick(wins) });
      },
      balcony(f, rng) {
        const { w, h } = f;
        const side = rng.chance(0.5) ? -1 : 1;
        const rw = Math.min(58, w * 0.44);
        const x0 = side < 0 ? -w / 2 + 6 : w / 2 - 6 - rw, x1 = x0 + rw;
        f.items.push({ k: "balc", x0, x1, plant: rng.chance(0.7), side });
        if (rng.chance(0.65)) f.people.push({ pose: rng.pick(["wave", "stand", "water"]), x: (x0 + x1) / 2 + rng.range(-6, 6), y: -5, c: rng.pick(CLOTHES), s: rng.pick(SKIN), ph: rng.range(0, 6) });
        const wx0 = side < 0 ? x1 + 8 : -w / 2 + 8, wx1 = side < 0 ? w / 2 - 8 : x0 - 8;
        if (wx1 - wx0 > 18) windowRow(f, rng, wx0, wx1, { w: 15, h: 20, gap: 14, y: -h + 13, cur: true, max: 2 });
      },
      greenhouse(f, rng) {
        const plants = [];
        for (let x = -f.w / 2 + 10; x < f.w / 2 - 8; x += rng.range(9, 15)) plants.push({ x, r: rng.range(4, 7.5), c: rng.pick(LEAF), b: rng.chance(0.3) ? rng.pick(BLOOM) : null });
        const vines = [];
        for (let x = -f.w / 2 + 8; x < f.w / 2 - 6; x += rng.range(10, 18)) vines.push({ x, len: rng.range(5, 12) });
        f.items.push({ k: "gh", plants, vines });
        if (rng.chance(0.5)) f.people.push({ pose: "water", x: rng.range(-f.w / 4, f.w / 4), y: -10, c: rng.pick(CLOTHES), s: rng.pick(SKIN), ph: rng.range(0, 6) });
      },
      studio(f, rng) {
        const bw = Math.min(f.w - 22, 92);
        f.items.push({ k: "studio", x: -bw / 2 + rng.range(-4, 4), w: bw, canvasC: rng.pick(BLOOM) });
      },
      terrace(f, rng) {
        const { w, h } = f;
        const side = rng.chance(0.5) ? -1 : 1;
        const tw = w * 0.56;
        const x0 = side < 0 ? -w / 2 + 4 : w / 2 - 4 - tw, x1 = x0 + tw;
        f.items.push({ k: "terr", x0, x1, umb: rng.pick([f.pal.accent, "#C8674A", "#5F8296"]) });
        f.people.push({ pose: "walk", x0: x0 + 6, x1: x1 - 6, y: -4, speed: 0.22, c: rng.pick(CLOTHES), s: rng.pick(SKIN), ph: rng.range(0, 6) });
        const wx0 = side < 0 ? x1 + 6 : -w / 2 + 8, wx1 = side < 0 ? w / 2 - 8 : x0 - 6;
        if (wx1 - wx0 > 16) windowRow(f, rng, wx0, wx1, { w: 15, h: 20, gap: 12, y: -h + 13, cur: true, max: 2 });
      },
      library(f, rng) {
        windowRow(f, rng, -f.w / 2 + 9, f.w / 2 - 9, { w: 20, h: 22, gap: 12, y: -f.h + 12, books: true, arch: true, lit: 0.4, max: 3 });
      },
      cafe(f, rng) {
        const tables = [];
        for (let x = -f.w / 2 + 18; x < f.w / 2 - 14; x += rng.range(20, 28)) tables.push({ x, who: rng.chance(0.75), c: rng.pick(CLOTHES), s: rng.pick(SKIN) });
        f.items.push({ k: "cafe", tables });
      },
      workshop(f, rng) {
        const gw = Math.min(f.w * 0.5, 64);
        const gx = rng.chance(0.5) ? -f.w / 2 + 10 : f.w / 2 - 10 - gw;
        f.items.push({ k: "garage", x: gx, w: gw });
        const ox0 = gx < 0 ? gx + gw + 10 : -f.w / 2 + 10, ox1 = gx < 0 ? f.w / 2 - 10 : gx - 10;
        if (ox1 - ox0 > 16) windowRow(f, rng, ox0, ox1, { w: 15, h: 18, gap: 12, y: -f.h + 14, max: 2, lit: 0.5 });
      },
      garden(f, rng) {
        const trees = [];
        for (let x = -f.w / 2 + 14; x < f.w / 2 - 10; x += rng.range(22, 34)) trees.push({ x, r: rng.range(7, 10), c: rng.pick(LEAF), ph: rng.range(0, 6) });
        f.items.push({ k: "garden", trees, bench: rng.range(-f.w / 4, f.w / 4) });
        if (rng.chance(0.55)) f.people.push({ pose: "sit", x: f.items[0].bench, y: -9, c: rng.pick(CLOTHES), s: rng.pick(SKIN), ph: rng.range(0, 6) });
      },
      pool(f, rng) {
        f.items.push({ k: "pool", swimmer: rng.pick(["#C8674A", "#E2B65C", "#F3E3C6"]) });
      },
      attic(f, rng) {
        f.items.push({ k: "gable", chimney: rng.chance(0.5) ? -1 : 1 });
      },
      clock(f, rng) {
        f.items.push({ k: "clock" });
        const r = Math.min(f.h - 14, f.w * 0.5) / 2;
        if (f.w / 2 - r - 10 > 18) {
          windowRow(f, rng, -f.w / 2 + 8, -r - 8, { w: 12, h: 18, gap: 10, y: -f.h + 15, max: 1, arch: true });
          windowRow(f, rng, r + 8, f.w / 2 - 8, { w: 12, h: 18, gap: 10, y: -f.h + 15, max: 1, arch: true });
        }
      },
      observatory(f, rng) {
        const stars = [];
        for (let i = 0; i < 14; i++) stars.push([rng.range(-1, 1), rng.range(-1, 1), rng.range(0.5, 1.2)]);
        f.items.push({ k: "porthole", stars });
      }
    };

    // ============================================================ FLOOR PAINTERS
    // Local floor space: x in [-w/2, w/2], y in [-h, 0] with y=0 the floor slab.
    function rect(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
    function circle(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

    function drawShell(g, f) {
      const { w, h, pal } = f, x0 = -w / 2;
      rect(g, "rgba(50,30,25,0.18)", x0 + 1, 0, w - 2, 3); // contact shadow onto the floor below
      rect(g, pal.wall, x0, -h, w, h);
      g.globalAlpha = 0.16;
      g.fillStyle = pal.shade;
      for (const d of f.stip) g.fillRect(x0 + d[0] * w, -h + 5 + d[1] * (h - 9), d[2], d[2]);
      g.globalAlpha = 1;
      rect(g, "rgba(255,246,228,0.18)", x0, -h, 3, h);
      rect(g, "rgba(60,30,20,0.08)", w / 2 - 7, -h, 7, h);
      rect(g, pal.trim, x0, -h, w, 4);
      rect(g, "rgba(60,30,20,0.16)", x0, -h + 4, w, 1.5);
      rect(g, pal.shade, x0, -3, w, 3);
    }

    function winPath(g, x, y, w, h, arch) {
      g.beginPath();
      if (arch) {
        const r = w / 2;
        g.moveTo(x, y + h); g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath();
      } else g.rect(x, y, w, h);
    }

    function drawWindow(g, f, it, t) {
      const { x, y, w, h } = it, pal = f.pal;
      if (it.shut) {
        const sw = w * 0.42;
        rect(g, pal.accent, x - sw - 1.5, y - 0.5, sw, h + 1);
        rect(g, pal.accent, x + w + 1.5, y - 0.5, sw, h + 1);
        g.fillStyle = "rgba(30,20,15,0.16)";
        for (let sy = y + 1.5; sy < y + h; sy += 2.6) { g.fillRect(x - sw - 1.5, sy, sw, 0.7); g.fillRect(x + w + 1.5, sy, sw, 0.7); }
      }
      g.fillStyle = pal.trim; winPath(g, x - 1.6, y - 1.6, w + 3.2, h + 3.2, it.arch); g.fill();
      g.fillStyle = it.lit ? LIT : GLASS; winPath(g, x, y, w, h, it.arch); g.fill();
      g.save(); winPath(g, x, y, w, h, it.arch); g.clip();
      if (!it.lit) rect(g, GLASS_DEEP, x, y + h * 0.62, w, h * 0.38);
      if (it.books) {
        for (let row = 0; row < 3; row++) {
          const by = y + h * (0.3 + row * 0.24);
          let bx = x + 1;
          let i = 0;
          while (bx < x + w - 1) {
            const bw = 1.4 + ((i * 7 + row * 3) % 3) * 0.5;
            rect(g, BOOKS[(i + row * 2 + (it.phase * 3 | 0)) % BOOKS.length], bx, by - 4 + ((i % 3) * 0.4), bw, 4 - ((i % 3) * 0.4));
            bx += bw + 0.3; i++;
          }
          rect(g, WOOD, x, by, w, 0.9);
        }
      }
      if (it.who) {
        const bob = Math.sin(t * 0.9 + it.phase) * 0.6;
        const px = x + w * (0.62 + 0.12 * Math.sin(t * 0.25 + it.phase));
        circle(g, "rgba(62,48,44,0.78)", px, y + h * 0.5 + bob, 2.3);
        g.fillStyle = "rgba(62,48,44,0.78)"; g.beginPath(); g.ellipse(px, y + h + 1 + bob, 4.4, 6, 0, Math.PI, 0); g.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.beginPath(); g.moveTo(x + w * 0.1, y + h); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.72, y); g.lineTo(x + w * 0.32, y + h); g.fill();
      if (it.cur) {
        const sway = Math.sin(t * 1.2 + it.phase) * 1.1;
        const xs = it.cur < 0 ? x : x + w, d = -it.cur;
        g.fillStyle = CURTAIN;
        g.beginPath();
        g.moveTo(xs, y);
        g.lineTo(xs + d * w * 0.4, y);
        g.quadraticCurveTo(xs + d * (w * 0.2 + sway), y + h * 0.45, xs + d * (w * 0.28 + sway * 0.6), y + h * 0.85);
        g.lineTo(xs, y + h * 0.85);
        g.fill();
      }
      g.restore();
      if (!it.books) { rect(g, pal.trim, x + w / 2 - 0.6, y, 1.2, h); rect(g, pal.trim, x, y + h * 0.42, w, 1.2); }
      rect(g, pal.shade, x - 2.4, y + h + 1.6, w + 4.8, 2.2);
      if (it.box) {
        rect(g, WOOD, x - 1.5, y + h + 3.8, w + 3, 3.4);
        for (let i = 0; i < 5; i++) {
          const fx = x + (i + 0.5) * (w / 5);
          circle(g, LEAF[i % 4], fx, y + h + 3.2, 1.9);
          if (i % 2 === 0) circle(g, BLOOM[(i + (it.phase | 0)) % 3], fx + 0.6, y + h + 2.2, 1.2);
        }
      }
    }

    function drawPerson(g, p, t, xOverride) {
      const x = xOverride ?? p.x, y = p.y;
      const ink = p.c, skin = p.s;
      let legA = 0, arm = 0.3;
      if (p.pose === "walk") legA = Math.sin(t * 7 + p.ph) * 0.45;
      if (p.pose === "wave") arm = -1.9 + Math.sin(t * 6 + p.ph) * 0.5;
      if (p.pose === "water") arm = -0.6;
      g.strokeStyle = INK; g.lineWidth = 1; g.lineCap = "round";
      if (p.pose === "sit") {
        g.beginPath(); g.moveTo(x - 0.6, y - 1); g.lineTo(x + 2.4, y - 1); g.lineTo(x + 2.4, y + 3); g.stroke();
      } else {
        g.beginPath();
        g.moveTo(x - 0.5, y - 4); g.lineTo(x - 0.5 + Math.sin(legA) * 3, y);
        g.moveTo(x + 0.5, y - 4); g.lineTo(x + 0.5 - Math.sin(legA) * 3, y);
        g.stroke();
      }
      const by = p.pose === "sit" ? y - 1 : y - 4;
      g.fillStyle = ink; g.beginPath(); g.ellipse(x, by - 3, 2, 3.3, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ink; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x + 1.2, by - 5); g.lineTo(x + 1.2 + Math.sin(arm + 1.6) * 3.4, by - 5 + Math.cos(arm + 1.6) * 3.4); g.stroke();
      circle(g, skin, x, by - 7.8, 1.65);
      if (p.pose === "water") {
        const hx = x + 4.6, hy = by - 4.6;
        rect(g, "#6F8F7B", hx - 1, hy - 1, 3, 2.4);
        g.fillStyle = "rgba(156,185,193,0.9)";
        for (let i = 0; i < 3; i++) { const k = ((t * 1.8 + i / 3) % 1); g.fillRect(hx + 2.4 + k * 1.2, hy + k * 6, 0.7, 0.9); }
      }
    }

    function drawItem(g, f, it, t, wind) {
      const { w, h, pal } = f;
      switch (it.k) {
        case "win": drawWindow(g, f, it, t); break;
        case "lamp": {
          g.strokeStyle = INK; g.lineWidth = 0.6; g.beginPath(); g.moveTo(it.x, it.y - 4); g.lineTo(it.x, it.y); g.stroke();
          circle(g, "#F7DA97", it.x, it.y + 1.4, 1.8);
          break;
        }
        case "can": {
          const wn = it.win, k = (t * 0.8 + wn.phase) % 4;
          if (k < 2.6) {
            const cx = wn.x + wn.w + 1, cy = wn.y + wn.h - 3;
            rect(g, "#6F8F7B", cx, cy, 4, 3);
            g.strokeStyle = "#6F8F7B"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx + 4, cy + 0.6); g.lineTo(cx + 6.4, cy + 2.4); g.stroke();
            g.fillStyle = "rgba(156,185,193,0.95)";
            for (let i = 0; i < 3; i++) { const q = (t * 2 + i / 3) % 1; g.fillRect(cx + 6.2, cy + 3 + q * 5, 0.7, 0.9); }
          }
          break;
        }
        case "door": {
          const dx = it.x - it.w / 2, dy = -it.h;
          rect(g, pal.shade, dx - 4, dy - 3, it.w + 8, it.h + 3);
          g.fillStyle = pal.trim; winPath(g, dx - 1.8, dy - 1.8, it.w + 3.6, it.h + 1.8, true); g.fill();
          g.fillStyle = "#6E4A39"; winPath(g, dx, dy, it.w, it.h, true); g.fill();
          g.fillStyle = LIT; g.beginPath(); g.arc(it.x, dy + it.w / 2, it.w / 2 - 2.5, Math.PI, 0); g.fill();
          rect(g, pal.trim, it.x - 0.5, dy + 2, 1, it.w / 2 - 2);
          rect(g, "rgba(0,0,0,0.18)", it.x - 0.4, dy + it.w / 2, 0.8, it.h - it.w / 2);
          rect(g, "rgba(0,0,0,0.12)", dx + 2.5, dy + it.w / 2 + 3, it.w / 2 - 4, it.h * 0.32);
          rect(g, "rgba(0,0,0,0.12)", it.x + 1.5, dy + it.w / 2 + 3, it.w / 2 - 4, it.h * 0.32);
          circle(g, "#E2B65C", it.x + 3, dy + it.h * 0.62, 0.9);
          // awning
          g.fillStyle = pal.accent;
          g.beginPath(); g.moveTo(dx - 8, dy - 6); g.lineTo(dx + it.w + 8, dy - 6); g.lineTo(dx + it.w + 4, dy - 13); g.lineTo(dx - 4, dy - 13); g.fill();
          rect(g, "rgba(0,0,0,0.15)", dx - 8, dy - 6, it.w + 16, 1);
          // wall lamps + number plaque
          for (const s of [-1, 1]) {
            const lx = it.x + s * (it.w / 2 + 7);
            rect(g, INK, lx - 0.5, dy + 6, 1, 4);
            circle(g, "#F7DA97", lx, dy + 5, 2);
          }
          circle(g, pal.trim, it.x + it.w / 2 + 7, dy + 16, 2.4);
          circle(g, pal.accent, it.x + it.w / 2 + 7, dy + 16, 1.4);
          break;
        }
        case "pot": {
          g.fillStyle = "#B5654A"; g.beginPath(); g.moveTo(it.x - 3.5, -9); g.lineTo(it.x + 3.5, -9); g.lineTo(it.x + 2.5, -3); g.lineTo(it.x - 2.5, -3); g.fill();
          const sw = Math.sin(t * 1.4 + it.x) * 0.5 + wind * 0.04;
          circle(g, LEAF[1], it.x - 2 + sw, -12, 3.2); circle(g, LEAF[0], it.x + 2 + sw, -13, 3.4); circle(g, LEAF[2], it.x + sw * 1.4, -16, 2.8);
          break;
        }
        case "balc": {
          const { x0, x1 } = it, top = -h + 6, bw = x1 - x0;
          rect(g, mixHex(pal.wall, "#3E302C", 0.32), x0, top, bw, -3 - top);
          rect(g, "rgba(0,0,0,0.12)", x0, top, bw, 2.5);
          const dw = Math.min(16, bw * 0.35), dx = it.side < 0 ? x0 + 6 : x1 - 6 - dw;
          rect(g, pal.trim, dx - 1.4, top + 4, dw + 2.8, -3 - top - 4);
          rect(g, GLASS, dx, top + 5.4, dw, -3 - top - 5.4);
          rect(g, "rgba(255,255,255,0.2)", dx + dw * 0.2, top + 5.4, dw * 0.18, -3 - top - 5.4);
          if (it.plant) {
            const px = it.side < 0 ? x1 - 7 : x0 + 7;
            rect(g, "#B5654A", px - 2.5, -9, 5, 6);
            const sw = Math.sin(t * 1.3 + x0) * 0.6 + wind * 0.05;
            circle(g, LEAF[0], px + sw, -12, 3.6); circle(g, LEAF[3], px - 2 + sw, -14.5, 2.6); circle(g, BLOOM[0], px + 1.5 + sw, -15, 1.2);
          }
          it._rail = true;
          break;
        }
        case "gh": {
          const top = -h + 4, base = -11;
          rect(g, "#D7E9DB", -w / 2 + 2, top, w - 4, base - top);
          for (const v of it.vines) {
            const sw = Math.sin(t * 1.1 + v.x) * 0.6 + wind * 0.05;
            g.strokeStyle = LEAF[3]; g.lineWidth = 0.9;
            g.beginPath(); g.moveTo(v.x, top); g.quadraticCurveTo(v.x + sw, top + v.len * 0.5, v.x + sw * 1.6, top + v.len); g.stroke();
            circle(g, LEAF[0], v.x + sw * 1.6, top + v.len, 1.5);
          }
          for (const p of it.plants) {
            const sw = Math.sin(t * 1.2 + p.x) * 0.5 + wind * 0.05;
            rect(g, "#B5654A", p.x - 2.6, base - 5, 5.2, 5);
            circle(g, p.c, p.x + sw, base - 5 - p.r * 0.7, p.r);
            if (p.b) circle(g, p.b, p.x + sw + p.r * 0.3, base - 5 - p.r * 1.2, 1.4);
          }
          g.fillStyle = "rgba(255,255,255,0.22)";
          g.beginPath(); g.moveTo(-w / 2 + 10, base); g.lineTo(-w / 2 + 28, top); g.lineTo(-w / 2 + 38, top); g.lineTo(-w / 2 + 20, base); g.fill();
          g.strokeStyle = "#F5EFE0"; g.lineWidth = 1.3;
          g.beginPath();
          for (let x = -w / 2 + 2; x <= w / 2 - 1; x += 13) { g.moveTo(x, top); g.lineTo(x, base); }
          g.moveTo(-w / 2 + 2, top + (base - top) * 0.45); g.lineTo(w / 2 - 2, top + (base - top) * 0.45);
          g.stroke();
          rect(g, pal.wall, -w / 2, base, w, -3 - base);
          rect(g, pal.trim, -w / 2, base, w, 1.6);
          break;
        }
        case "studio": {
          const top = -h + 9, bh = h - 15;
          rect(g, "#4A4644", it.x - 2, top - 2, it.w + 4, bh + 4);
          rect(g, "#C9DCDD", it.x, top, it.w, bh);
          rect(g, "#B5CBCE", it.x, top + bh * 0.55, it.w, bh * 0.45);
          // pendant lamp
          const lx = it.x + it.w * 0.7;
          g.strokeStyle = INK; g.lineWidth = 0.6; g.beginPath(); g.moveTo(lx, top); g.lineTo(lx, top + 8); g.stroke();
          g.fillStyle = INK; g.beginPath(); g.moveTo(lx - 3, top + 11); g.lineTo(lx + 3, top + 11); g.lineTo(lx, top + 8); g.fill();
          circle(g, "#F7DA97", lx, top + 11.6, 1.2);
          // easel + canvas
          const ex = it.x + it.w * 0.32, ey = top + bh;
          g.strokeStyle = "#6E4A39"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(ex - 5, ey); g.lineTo(ex, ey - 20); g.lineTo(ex + 5, ey); g.moveTo(ex, ey - 20); g.lineTo(ex, ey); g.stroke();
          rect(g, "#F6EBD8", ex - 7, ey - 19, 14, 10);
          rect(g, it.canvasC, ex - 5, ey - 16, 6, 5);
          circle(g, "#5F8296", ex + 3, ey - 13, 2.2);
          // steel grid
          g.strokeStyle = "#4A4644"; g.lineWidth = 1.2; g.beginPath();
          for (let i = 1; i < 4; i++) { const gx = it.x + (it.w * i) / 4; g.moveTo(gx, top); g.lineTo(gx, top + bh); }
          for (let j = 1; j < 3; j++) { const gy = top + (bh * j) / 3; g.moveTo(it.x, gy); g.lineTo(it.x + it.w, gy); }
          g.stroke();
          g.fillStyle = "rgba(255,255,255,0.18)";
          g.beginPath(); g.moveTo(it.x + it.w * 0.5, top + bh); g.lineTo(it.x + it.w * 0.75, top); g.lineTo(it.x + it.w * 0.9, top); g.lineTo(it.x + it.w * 0.65, top + bh); g.fill();
          break;
        }
        case "terr": {
          const { x0, x1 } = it, top = -h + 4, tw = x1 - x0;
          rect(g, mixHex(pal.wall, "#F6E8D0", 0.35), x0, top, tw, -3 - top);
          rect(g, "rgba(60,30,20,0.12)", x0, top, tw, 3);
          // pergola + vines
          rect(g, WOOD, x0, top + 4, tw, 2);
          rect(g, WOOD, x0 + 1, top + 4, 2, -3 - top - 4);
          rect(g, WOOD, x1 - 3, top + 4, 2, -3 - top - 4);
          for (let vx = x0 + 5; vx < x1 - 3; vx += 6) {
            const len = 3 + ((vx * 13) % 6);
            const sw = Math.sin(t * 1.3 + vx) * 0.5 + wind * 0.05;
            circle(g, LEAF[(vx | 0) % 4], vx + sw, top + 6 + len * 0.5, 2.1);
          }
          // umbrella + table
          const ux = x0 + tw * 0.62;
          rect(g, INK, ux - 0.4, -22, 0.8, 19);
          g.fillStyle = it.umb; g.beginPath(); g.moveTo(ux - 12, -21); g.quadraticCurveTo(ux, -31, ux + 12, -21); g.fill();
          g.fillStyle = "#F6EBD8"; g.beginPath(); g.moveTo(ux - 4, -21); g.quadraticCurveTo(ux, -29.5, ux + 4, -21); g.fill();
          rect(g, "#F6EBD8", ux - 5, -9.5, 10, 1.2);
          rect(g, INK, ux - 0.4, -9, 0.8, 6);
          it._rail = true;
          break;
        }
        case "cafe": {
          const top = -h + 17, x0 = -w / 2 + 6, x1 = w / 2 - 6;
          rect(g, pal.trim, x0 - 1.5, top - 1.5, x1 - x0 + 3, -3 - top + 1.5);
          rect(g, "#F2DDB3", x0, top, x1 - x0, -4 - top);
          rect(g, "#E9CC98", x0, top + 12, x1 - x0, -4 - top - 12);
          for (const tb of it.tables) {
            if (tb.who) drawPerson(g, { pose: "sit", x: tb.x - 4, y: -9, c: tb.c, s: tb.s, ph: tb.x }, t);
            rect(g, INK, tb.x - 0.4, -10, 0.8, 6);
            rect(g, "#F6EBD8", tb.x - 4, -10.6, 8, 1.2);
            circle(g, "#C8674A", tb.x + 1.5, -11.6, 0.9);
          }
          rect(g, "rgba(255,255,255,0.18)", x0 + 6, top, 5, -4 - top);
          // striped awning with scalloped hem
          const aw0 = -w / 2 + 2, aw1 = w / 2 - 2, ay = -h + 5;
          const stripes = Math.max(4, Math.round((aw1 - aw0) / 8));
          const sw = (aw1 - aw0) / stripes;
          for (let i = 0; i < stripes; i++) {
            g.fillStyle = i % 2 ? pal.trim : pal.accent;
            g.fillRect(aw0 + i * sw, ay, sw + 0.2, 7);
            g.beginPath(); g.arc(aw0 + i * sw + sw / 2, ay + 7, sw / 2, 0, Math.PI); g.fill();
          }
          rect(g, "rgba(0,0,0,0.12)", aw0, ay, aw1 - aw0, 1);
          break;
        }
        case "garage": {
          const top = -h + 13, gh = h - 16, x = it.x, gw = it.w;
          rect(g, pal.trim, x - 2, top - 2, gw + 4, gh + 2);
          rect(g, "#5C4438", x, top, gw, gh);
          rect(g, "#F2CF8C", x + 1, top + gh * 0.45, gw - 2, gh * 0.55);
          // bicycle silhouette inside
          const bx = x + gw * 0.5, by = -6;
          g.strokeStyle = INK; g.lineWidth = 0.9;
          g.beginPath(); g.arc(bx - 6, by, 3.4, 0, Math.PI * 2); g.moveTo(bx + 9.4, by); g.arc(bx + 6, by, 3.4, 0, Math.PI * 2);
          g.moveTo(bx - 6, by); g.lineTo(bx - 1, by - 5); g.lineTo(bx + 4, by - 5); g.lineTo(bx + 6, by); g.moveTo(bx - 1, by - 5); g.lineTo(bx + 1, by);
          g.lineTo(bx + 4, by - 5); g.moveTo(bx - 2, by - 6.5); g.lineTo(bx, by - 6.5); g.stroke();
          // roll-up door slats
          rect(g, mixHex(pal.trim, "#9AA0A0", 0.35), x, top, gw, gh * 0.45);
          g.fillStyle = "rgba(0,0,0,0.13)";
          for (let sy = top + 2; sy < top + gh * 0.45; sy += 2.4) g.fillRect(x, sy, gw, 0.7);
          // tools on the wall
          rect(g, WOOD, x + 3, top + gh * 0.5, gw - 6, 1);
          break;
        }
        case "garden": {
          const top = -h + 4;
          rect(g, mixHex(pal.wall, "#F6E8D0", 0.3), -w / 2 + 3, top, w - 6, -3 - top);
          g.strokeStyle = "rgba(110,80,60,0.09)"; g.lineWidth = 0.7; g.beginPath();
          for (let x = -w / 2 - h; x < w / 2; x += 10) { g.moveTo(x, -3); g.lineTo(x + (-3 - top), top); g.moveTo(x + (-3 - top), -3); g.lineTo(x, top); }
          g.stroke();
          for (const tr of it.trees) {
            const sw = Math.sin(t * 1.1 + tr.ph) * 0.8 + wind * 0.08;
            rect(g, WOOD, tr.x - 0.9, -18, 1.8, 13);
            circle(g, tr.c, tr.x + sw, -22, tr.r);
            circle(g, mixHex(tr.c, "#FFF5DC", 0.18), tr.x - tr.r * 0.35 + sw, -24, tr.r * 0.55);
          }
          rect(g, "#F6EBD8", it.bench - 7, -10, 14, 1.4);
          rect(g, WOOD, it.bench - 6, -9, 1, 4);
          rect(g, WOOD, it.bench + 5, -9, 1, 4);
          rect(g, pal.trim, -w / 2, -9, w, 6);
          rect(g, "rgba(60,30,20,0.12)", -w / 2, -9, w, 1);
          break;
        }
        case "pool": {
          const top = -h + 9, base = -6, x0 = -w / 2 + 5, x1 = w / 2 - 5;
          rect(g, pal.trim, x0 - 1.5, top - 1.5, x1 - x0 + 3, base - top + 3);
          rect(g, "#DCEEEA", x0, top, x1 - x0, base - top);
          const wl = top + (base - top) * 0.38;
          g.fillStyle = "#7FBFC4";
          g.beginPath(); g.moveTo(x0, base);
          for (let x = x0; x <= x1; x += 4) g.lineTo(x, wl + Math.sin(x * 0.25 + t * 2.4) * 0.9);
          g.lineTo(x1, base); g.fill();
          rect(g, "#5FA4AE", x0, base - 4, x1 - x0, 4);
          g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 0.7; g.beginPath();
          for (let x = x0 + 6; x < x1; x += 10) { g.moveTo(x, wl + 4); g.lineTo(x + 4, wl + 4); }
          g.stroke();
          const sx = lerp(x0 + 10, x1 - 10, 0.5 + 0.5 * Math.sin(t * 0.4 + f.phase));
          circle(g, "#E5B994", sx, wl - 0.5 + Math.sin(t * 3) * 0.4, 2);
          g.fillStyle = it.swimmer; g.beginPath(); g.arc(sx, wl - 0.8 + Math.sin(t * 3) * 0.4, 2.1, Math.PI, 0); g.fill();
          g.strokeStyle = "#B8C4C4"; g.lineWidth = 0.8; g.beginPath();
          g.moveTo(x1 - 8, wl - 6); g.lineTo(x1 - 8, base - 2); g.moveTo(x1 - 4, wl - 6); g.lineTo(x1 - 4, base - 2);
          for (let ly = wl - 4; ly < base - 2; ly += 3) { g.moveTo(x1 - 8, ly); g.lineTo(x1 - 4, ly); }
          g.stroke();
          rect(g, "rgba(255,255,255,0.18)", x0 + 8, top, 4, base - top);
          break;
        }
        case "gable": {
          const base = -10, peak = -h + 6;
          rect(g, "#B5573B", -w / 2 + 2, base - 1, w - 4, 2);
          g.fillStyle = "#B5573B";
          g.beginPath(); g.moveTo(-w / 2 + 3, base); g.lineTo(0, peak - 1); g.lineTo(w / 2 - 3, base); g.fill();
          g.fillStyle = pal.trim;
          g.beginPath(); g.moveTo(-w / 2 + 12, base); g.lineTo(0, peak + 6); g.lineTo(w / 2 - 12, base); g.fill();
          g.strokeStyle = "rgba(70,25,15,0.25)"; g.lineWidth = 0.7; g.beginPath();
          for (let k = 0; k < 5; k++) {
            const q = k / 5;
            g.moveTo(lerp(-w / 2 + 3, 0, q), lerp(base, peak - 1, q)); g.lineTo(lerp(-w / 2 + 12, 0, q), lerp(base, peak + 6, q));
            g.moveTo(lerp(w / 2 - 3, 0, q), lerp(base, peak - 1, q)); g.lineTo(lerp(w / 2 - 12, 0, q), lerp(base, peak + 6, q));
          }
          g.stroke();
          const cy = lerp(base, peak + 6, 0.45);
          circle(g, pal.shade, 0, cy, 7.2);
          circle(g, LIT, 0, cy, 5.6);
          rect(g, pal.shade, -0.5, cy - 5.6, 1, 11.2); rect(g, pal.shade, -5.6, cy - 0.5, 11.2, 1);
          // little side windows under the eaves
          for (const s of [-1, 1]) {
            const wx = s * (w / 2 - 14) - 4;
            rect(g, pal.trim, wx - 1, base + 1, 10, -3 - base - 1);
            rect(g, GLASS, wx, base + 2, 8, -3 - base - 3);
          }
          // chimney + smoke (only visible while this is the top floor)
          const chx = it.chimney * w * 0.28;
          rect(g, "#A24E36", chx - 3.5, -h - 9, 7, 9);
          rect(g, "#8C412C", chx - 4.5, -h - 10, 9, 2);
          for (let i = 0; i < 4; i++) {
            const q = ((t * 0.35 + i / 4) % 1);
            g.fillStyle = `rgba(246,236,220,${0.55 * (1 - q)})`;
            g.beginPath(); g.arc(chx + q * 10 + wind * q * 0.4, -h - 12 - q * 22, 2 + q * 4, 0, Math.PI * 2); g.fill();
          }
          break;
        }
        case "clock": {
          const r = Math.min(h - 14, w * 0.5) / 2, cy = -h / 2 - 1;
          circle(g, pal.shade, 0, cy, r + 3);
          circle(g, pal.trim, 0, cy, r + 1.5);
          circle(g, "#FBF3E3", 0, cy, r);
          g.fillStyle = INK;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2, rr = i % 3 === 0 ? r - 3.4 : r - 2.6;
            g.beginPath(); g.arc(Math.cos(a) * rr, cy + Math.sin(a) * rr, i % 3 === 0 ? 0.9 : 0.5, 0, Math.PI * 2); g.fill();
          }
          const mA = t * 0.6 + f.phase, hA = mA / 12;
          g.strokeStyle = INK; g.lineCap = "round";
          g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, cy); g.lineTo(Math.sin(hA) * r * 0.5, cy - Math.cos(hA) * r * 0.5); g.stroke();
          g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, cy); g.lineTo(Math.sin(mA) * r * 0.8, cy - Math.cos(mA) * r * 0.8); g.stroke();
          circle(g, pal.accent, 0, cy, 1.3);
          break;
        }
        case "porthole": {
          const r = (h - 16) / 2, cy = -h / 2 - 1;
          circle(g, "#B58A4E", 0, cy, r + 3.4);
          circle(g, "#2E3A5A", 0, cy, r);
          g.save(); g.beginPath(); g.arc(0, cy, r, 0, Math.PI * 2); g.clip();
          for (const s of it.stars) {
            const tw = 0.55 + 0.45 * Math.sin(t * 2 + s[0] * 9);
            g.fillStyle = `rgba(250,240,215,${tw})`; g.fillRect(s[0] * r, cy + s[1] * r, s[2], s[2]);
          }
          circle(g, "#F3E6CC", r * 0.45, cy - r * 0.4, 3);
          circle(g, "#2E3A5A", r * 0.45 + 1.3, cy - r * 0.4 - 0.8, 2.6);
          g.save(); g.translate(-r * 0.25, cy + r * 0.55); g.rotate(-0.7 + Math.sin(t * 0.3) * 0.08);
          rect(g, "#C9C3B6", -2, -14, 4.2, 16); rect(g, "#9C968B", -2.8, -15, 5.6, 2.4);
          g.restore();
          rect(g, "#3E302C", -r * 0.25 - 4, cy + r * 0.55, 8, 3);
          g.restore();
          g.fillStyle = "#E1C27F";
          for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * (r + 1.7), cy + Math.sin(a) * (r + 1.7), 0.6, 0, Math.PI * 2); g.fill(); }
          for (const s of [-1, 1]) {
            const px = s * (r + (w / 2 - r) / 2);
            if (Math.abs(px) + 5 < w / 2 - 2) { circle(g, pal.trim, px, cy, 5); circle(g, GLASS, px, cy, 3.6); }
          }
          break;
        }
      }
    }

    function drawRailing(g, f, x0, x1) {
      const pal = f.pal;
      rect(g, pal.trim, x0, -15, x1 - x0, 1.6);
      rect(g, pal.trim, x0, -4.5, x1 - x0, 1.4);
      g.fillStyle = pal.trim;
      for (let x = x0 + 1.5; x < x1 - 0.5; x += 3.2) g.fillRect(x, -14, 0.8, 10);
    }

    // Draws one floor in local space (caller sets transform). Clipping handled by caller.
    function drawFloor(g, f, t, wind) {
      drawShell(g, f);
      for (const it of f.items) drawItem(g, f, it, t, wind);
      for (const p of f.people) {
        if (p.pose === "walk") {
          const k = 0.5 + 0.5 * Math.sin(t * p.speed + p.ph);
          drawPerson(g, p, t, lerp(p.x0, p.x1, k));
        } else drawPerson(g, p, t);
      }
      for (const it of f.items) if (it._rail) drawRailing(g, f, it.x0, it.x1);
    }

    // ============================================================ BACKGROUND
    const bgR = rngFrom(20251008);
    function genSkyline(span, minW, maxW, minH, maxH, roofs) {
      const out = [];
      let x = -span;
      while (x < span) {
        const w = bgR.range(minW, maxW);
        out.push({ x, w, h: bgR.range(minH, maxH), roof: bgR.pick(roofs), win: bgR.chance(0.6), seed: bgR() });
        x += w + bgR.range(-4, 10);
      }
      return out;
    }
    const SKY_TALL = genSkyline(900, 22, 50, 110, 300, ["flat", "spire", "dome", "flat", "tank", "chhatri"]);
    const SKY_FAR = genSkyline(900, 30, 72, 34, 110, ["pitch", "flat", "dome", "pitch", "tank", "step"]);
    const MOUNTAINS = [];
    for (let i = 0; i < 3; i++) MOUNTAINS.push({ a: bgR.range(0, 6), f: bgR.range(0.004, 0.009), h: bgR.range(70, 140) });
    const CLOUDS = [];
    for (let i = 0; i < 46; i++) {
      const blobs = [];
      const n = bgR.int(3, 6), s = bgR.range(26, 70);
      for (let j = 0; j < n; j++) blobs.push([bgR.range(-s, s), bgR.range(-s * 0.25, 0), bgR.range(s * 0.35, s * 0.6)]);
      const xs = blobs.map((b) => b[0]);
      CLOUDS.push({ x0: Math.min(...xs), x1: Math.max(...xs), rb: Math.min(...blobs.map((b) => b[2])), x: bgR.range(-700, 700), y: bgR.range(1250, 3100), f: bgR.range(0.72, 0.95), blobs, w: s, drift: bgR.range(3, 9) });
    }
    const WISPS = [];
    for (let i = 0; i < 10; i++) WISPS.push({ x: bgR.range(-400, 400), y: bgR.range(1500, 2900), w: bgR.range(80, 160), drift: bgR.range(6, 14) });
    const SEA = [];
    for (let i = 0; i < 70; i++) SEA.push([i * 28 - 980, bgR.range(18, 38)]);
    const STARS = [];
    for (let i = 0; i < 70; i++) STARS.push([bgR(), bgR() * 0.7, bgR.range(0.6, 1.6), bgR.range(0, 6)]);
    const LANTERNS = [];
    for (let i = 0; i < 9; i++) LANTERNS.push({ x: bgR(), sp: bgR.range(0.012, 0.03), off: bgR(), sw: bgR.range(0, 6) });
    const NEIGHBOURS = [
      { x: -330, w: 96, h: 82, pal: 4, roof: "pitch" }, { x: -228, w: 70, h: 120, pal: 0, roof: "flat" },
      { x: 168, w: 80, h: 96, pal: 3, roof: "pitch" }, { x: 252, w: 104, h: 70, pal: 1, roof: "flat" },
      { x: -470, w: 110, h: 104, pal: 2, roof: "flat" }, { x: 360, w: 90, h: 128, pal: 5, roof: "pitch" }
    ];
    const WALKERS = [];
    for (let i = 0; i < 4; i++) WALKERS.push({ x: bgR.range(-500, 500), v: bgR.pick([-1, 1]) * bgR.range(9, 16), c: bgR.pick(CLOTHES), s: bgR.pick(SKIN), ph: bgR.range(0, 6), dog: i === 2 });

    // ============================================================ AUDIO
    const sfx = (() => {
      let ac = null, master = null, noiseBuf = null;
      function ensure() {
        if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return true; }
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return false;
          ac = new AC();
          master = ac.createGain(); master.gain.value = 0.75;
          const comp = ac.createDynamicsCompressor();
          master.connect(comp); comp.connect(ac.destination);
          noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          return true;
        } catch (e) { ac = null; return false; }
      }
      function tone(o) {
        if (!ac) return;
        const t0 = ac.currentTime + (o.delay || 0);
        const osc = ac.createOscillator(), gn = ac.createGain();
        osc.type = o.type || "sine";
        osc.frequency.setValueAtTime(o.f, t0);
        if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.005));
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
        osc.connect(gn); gn.connect(master);
        osc.start(t0); osc.stop(t0 + o.dur + 0.05);
      }
      function noise(o) {
        if (!ac) return;
        const t0 = ac.currentTime + (o.delay || 0);
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const flt = ac.createBiquadFilter(); flt.type = o.ft || "lowpass"; flt.frequency.value = o.freq; flt.Q.value = o.q || 0.7;
        const gn = ac.createGain();
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.004));
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
        src.connect(flt); flt.connect(gn); gn.connect(master);
        src.start(t0, Math.random() * 0.3); src.stop(t0 + o.dur + 0.05);
      }
      const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568];
      return {
        ensure,
        arrive() { noise({ freq: 600, ft: "bandpass", q: 2, vol: 0.05, dur: 0.35, attack: 0.08 }); tone({ f: 140, f2: 110, type: "triangle", vol: 0.04, dur: 0.3 }); },
        creak() { tone({ f: 1250 + Math.random() * 200, f2: 1100, type: "triangle", vol: 0.012, dur: 0.06 }); },
        release() { noise({ freq: 3800, ft: "highpass", vol: 0.12, dur: 0.05 }); tone({ f: 1900, f2: 1200, type: "square", vol: 0.03, dur: 0.035 }); },
        land(q) {
          tone({ f: 120, f2: 42, type: "sine", vol: 0.5 * (0.6 + 0.4 * q), dur: 0.32 });
          noise({ freq: 380, vol: 0.32, dur: 0.12 });
          tone({ f: 240, f2: 180, type: "triangle", vol: 0.1, dur: 0.09, delay: 0.005 });
        },
        perfect(combo) {
          const f = PENTA[Math.min(combo - 1, PENTA.length - 1)];
          tone({ f, type: "triangle", vol: 0.12, dur: 0.5, delay: 0.04 });
          tone({ f: f * 2, type: "sine", vol: 0.05, dur: 0.35, delay: 0.06 });
        },
        crumble() { for (let i = 0; i < 5; i++) noise({ freq: 900 + i * 300, ft: "bandpass", q: 1.4, vol: 0.07, dur: 0.07, delay: 0.04 + i * 0.045 }); },
        over() { [392, 329.6, 261.6].forEach((f, i) => tone({ f, f2: f * 0.97, type: "triangle", vol: 0.1, dur: 0.38, delay: i * 0.17 })); },
        milestone() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: "triangle", vol: 0.07, dur: 0.6, delay: i * 0.09 })); },
        close() { try { if (ac) ac.close(); } catch (e) { /* already closed */ } ac = null; }
      };
    })();
    ctx.onDestroy(() => sfx.close());

    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (e) { /* optional */ } }

    let musicStarted = false;
    async function startMusic() {
      if (musicStarted || CFG.MUSIC_VOLUME <= 0) return;
      musicStarted = true;
      try {
        await ctx.music.unlock();
        ctx.music.play({ preset: "cozy", volume: CFG.MUSIC_VOLUME, fadeInMs: 2500, intensity: 0.35 });
      } catch (e) { /* music is optional */ }
    }

    // ============================================================ GAME STATE
    const canvas = ctx.createCanvas2D({ touchAction: "none", maxDpr: 2, coordinateSpace: "css", alpha: false });
    const g = canvas.getContext("2d");
    let W = ctx.width, H = ctx.height, scale = 1, viewH = 640, safeTop = 0;
    ctx.onResize((l) => {
      W = l.width; H = l.height;
      safeTop = (l.safeArea && l.safeArea.top) || 0;
      scale = Math.min(W / 360, H / 600);
      viewH = H / scale;
    }, { immediate: true });
    if (!scale || !Number.isFinite(scale)) { scale = Math.min(W / 360, H / 600) || 1; viewH = H / scale; }

    const heightTrack = (() => { try { return ctx.game.score({ initial: 0 }); } catch (e) { return null; } })();
    let best = 0;
    try { Promise.resolve(ctx.storage.get("stacked_best")).then((v) => { if (Number.isFinite(v)) best = Math.max(best, v); }).catch(() => {}); } catch (e) { /* storage optional */ }

    let rng, state, tower, hang, fall, pieces, particles, popups, hook, reveal, caption;
    let floors, points, combo, missTimer, overAt, startedAttempt, attempt = 0, newBest = false;
    let time = 0, wind = 0, stageAlt = 0, shake = 0, hintAlpha = 1, firstTapDone = false;
    const cam = { x: 0, y: 0 };
    let lastCos = 1, lightTimer = 0, birdTimer = 3;
    const birds = [], leaves = [];

    function topFloor() { return tower[tower.length - 1]; }
    function topY() { const t = topFloor(); return t.y + t.f.h; }
    function camTarget() {
      return { x: ((topFloor().cl + topFloor().cr) / 2) * 0.5, y: Math.max(-0.13 * viewH, topY() - 0.42 * viewH) };
    }

    function newRun() {
      loadConfig();
      attempt += 1;
      rng = rngFrom((Date.now() ^ (attempt * 7919)) >>> 0);
      lastPal = -1;
      const base = makeFloor("entrance", CFG.INITIAL_FLOOR_WIDTH, rng);
      tower = [{ f: base, ox: 0, y: 0, cl: -base.w / 2, cr: base.w / 2, land: 9 }];
      pieces = []; particles = []; popups = [];
      hang = null; fall = null; hook = null; reveal = null; caption = null;
      floors = 0; points = 0; combo = 0; newBest = false; startedAttempt = false;
      if (heightTrack) { try { heightTrack.reset(); } catch (e) { /* noop */ } }
      if (attempt === 1) { const c = camTarget(); cam.x = c.x; cam.y = c.y; }
      spawnNext();
    }

    function spawnNext() {
      const prev = tower.length > 1 ? topFloor().f.type : null;
      const type = chooseType(floors, rng, prev);
      const topW = topFloor().cr - topFloor().cl;
      const w = Math.min(topW, widthCap(floors + 1));
      const f = makeFloor(type, w, rng);
      hang = { f, w, phase: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, arrive: 0, x: 0, y: 0, rot: 0, rotV: 0 };
      lastCos = 0;
      updateHang(0);
      state = "swing";
      sfx.arrive();
    }

    function updateHang(dt) {
      const n = floors;
      const tf = topFloor();
      const centre = (tf.cl + tf.cr) / 2 + wind;
      const omega = swingSpeed(n);
      hang.phase += omega * dt;
      hang.arrive = Math.min(1, hang.arrive + dt / CFG.ARRIVE_TIME);
      const s = Math.sin(hang.phase), c = Math.cos(hang.phase);
      hang.x = centre + CFG.SWING_AMPLITUDE * s;
      hang.y = topY() + CFG.FLOOR_SPAWN_HEIGHT + (1 - easeOutBack(hang.arrive)) * 260;
      // A hanging body leans against its acceleration; a damped spring gives it inertia.
      const accel = -CFG.SWING_AMPLITUDE * omega * omega * s;
      const target = clamp(accel * 0.00009 - wind * 0.0016, -0.11, 0.11);
      hang.rotV += ((target - hang.rot) * 70 - hang.rotV * 9) * dt;
      hang.rot += hang.rotV * dt;
      if (dt > 0 && Math.sign(c) !== Math.sign(lastCos) && hang.arrive >= 1) sfx.creak();
      lastCos = c;
    }

    function release() {
      if (state !== "swing" || !hang) return;
      const hk = hookPoint();
      hook = { x: hk.x, y: hk.y, t: 0, rot: hang.rot, w: hang.w };
      fall = { f: hang.f, w: hang.w, x: hang.x, y: hang.y, vy: 0, rot0: hang.rot, dist0: Math.max(1, hang.y - topY()) };
      hang = null;
      state = "fall";
      sfx.release();
      haptic("light");
      try { ctx.platform.interact({ action: "drop", floor: floors + 1 }); } catch (e) { /* optional */ }
    }

    function hookPoint() { return { x: hang.x, y: hang.y + hang.f.h + 16 }; }

    function land() {
      const tf = topFloor();
      const tl = tf.cl, tr = tf.cr, tc = (tl + tr) / 2;
      const f = fall.f, w = fall.w;
      let x = fall.x;
      const y = topY();
      // The perfect window is a little more generous while the swing is slow.
      const perfect = Math.abs(x - tc) <= CFG.PERFECT_THRESHOLD * lerp(1.6, 1.25, ramp(floors));
      if (perfect) x = tc;
      const l = x - w / 2, r = x + w / 2;
      const ol = Math.max(l, tl), or = Math.min(r, tr), ow = or - ol;
      if (ow < CFG.MIN_OVERLAP) { miss(x, y); return; }

      tower.push({ f, ox: x, y, cl: ol, cr: or, land: 0 });
      floors += 1;
      const ratio = ow / w;
      if (l < tl - 0.5) cutPiece(f, x, y, l, tl, -1);
      if (r > tr + 0.5) cutPiece(f, x, y, tr, r, 1);

      let gained;
      if (perfect) {
        combo += CFG.COMBO_INCREMENT;
        gained = 50 * (1 + combo);
        popups.push({ x, y: y + f.h + 10, t: 0, word: "Perfect", pts: `+${gained}`, mult: `×${1 + combo}`, perfect: true });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          particles.push({ k: "spark", x: x + Math.cos(a) * w * 0.45, y: y + f.h * 0.5 + Math.sin(a) * f.h * 0.6, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0, max: 0.6, size: 3.2 });
        }
        sfx.perfect(combo); haptic("success");
        shake = 1.5;
      } else {
        combo = 0;
        gained = Math.round(10 + 30 * ratio);
        const word = ratio > 0.9 ? "Neat" : ratio < 0.4 ? "Tight" : "";
        popups.push({ x: (ol + or) / 2, y: y + f.h + 10, t: 0, word, pts: `+${gained}`, mult: "", perfect: false });
        for (const sx of [ol + 4, or - 4]) for (let i = 0; i < 3; i++) {
          particles.push({ k: "dust", x: sx, y: y + 1, vx: (sx < x ? -1 : 1) * (12 + Math.random() * 18), vy: 6 + Math.random() * 8, life: 0, max: 0.55, size: 3 + Math.random() * 2 });
        }
        haptic("medium");
        shake = 2.5 * (1 - ratio) + 1;
      }
      points += gained;
      sfx.land(ratio);
      if (heightTrack) { try { heightTrack.set(floors); } catch (e) { /* noop */ } }
      const stage = STAGES.find((s) => s.at === floors && s.name);
      if (stage) caption = { text: stage.name, sub: `${floors} floors up`, t: 0 };
      if (isMilestone(floors)) {
        try { ctx.platform.milestone(`floors_${floors}`, { floors }); } catch (e) { /* optional */ }
      }
      state = "settle";
      missTimer = CFG.SETTLE_TIME;
      fall = null;
    }

    function cutPiece(f, ox, y, a, b, dir) {
      pieces.push({ f, ox, y, cl: a, cr: b, dx: 0, dy: 0, vx: dir * (26 + Math.random() * 18), vy: 30, rot: 0, vr: dir * (1.4 + Math.random()), life: 0 });
      const ex = dir < 0 ? b : a;
      for (let i = 0; i < 7; i++) {
        particles.push({ k: "chip", x: ex, y: y + Math.random() * f.h, vx: dir * (20 + Math.random() * 50), vy: 20 + Math.random() * 50, life: 0, max: 0.9, size: 1.6 + Math.random() * 2.2, c: Math.random() < 0.5 ? f.pal.wall : f.pal.shade, rot: Math.random() * 6 });
      }
      sfx.crumble();
    }

    function miss(x, y) {
      const dir = x >= (topFloor().cl + topFloor().cr) / 2 ? 1 : -1;
      pieces.push({ f: fall.f, ox: x, y, cl: x - fall.w / 2, cr: x + fall.w / 2, dx: 0, dy: 0, vx: dir * 30, vy: fall.vy, rot: 0, vr: dir * 0.9, life: 0, miss: true });
      fall = null;
      combo = 0;
      state = "miss";
      missTimer = 0.85;
      sfx.over();
      haptic("error");
    }

    function gameOver() {
      state = "over";
      overAt = time;
      if (floors > best) { best = floors; newBest = floors > 0; try { Promise.resolve(ctx.storage.set("stacked_best", best)).catch(() => {}); } catch (e) { /* optional */ } }
      try { ctx.platform.fail({ score: floors, floors, points }); } catch (e) { /* optional */ }
      if (heightTrack && floors > 0) {
        const run = attempt;
        try { heightTrack.submit("height", { label: `${floors} floors` }).catch(() => { if (run !== attempt) return; }); } catch (e) { /* optional */ }
      }
      try { ctx.music.duck(0.5, 1400); } catch (e) { /* optional */ }
    }

    function startReveal() {
      const tY = topY();
      const z = clamp((viewH * 0.78) / (tY + 70), 0.06, 1);
      reveal = { t: 0, dur: 2.9, z, camY: -40 };
      caption = caption || { text: `${floors} floors`, sub: "", t: 0 };
      if (!caption.sub) caption.sub = "";
      state = "reveal";
      sfx.milestone();
    }

    // ============================================================ UPDATE
    function update(dt) {
      time += dt;
      const wa = windAmount(floors);
      wind = CFG.WIND_STRENGTH * wa * (0.6 * Math.sin(time * 0.33) + 0.4 * Math.sin(time * 0.71 + 1.3));

      if (state === "swing") updateHang(dt);
      else if (state === "fall") {
        fall.vy -= CFG.GRAVITY * dt;
        fall.y += fall.vy * dt;
        if (fall.y <= topY()) { fall.y = topY(); land(); }
      } else if (state === "settle") {
        missTimer -= dt;
        if (missTimer <= 0) { if (isMilestone(floors)) startReveal(); else spawnNext(); }
      } else if (state === "reveal") {
        reveal.t += dt;
        if (reveal.t >= reveal.dur) { reveal = null; spawnNext(); }
      } else if (state === "miss") {
        missTimer -= dt;
        if (missTimer <= 0) gameOver();
      }

      if (hook) { hook.t += dt; if (hook.t > 0.6) hook = null; }
      for (const tf of tower) if (tf.land < 2) tf.land += dt;

      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i];
        p.life += dt; p.vy -= CFG.GRAVITY * 0.55 * dt;
        p.dx += p.vx * dt; p.dy += p.vy * dt; p.rot += p.vr * dt;
        if (p.y + p.dy < cam.y - 400 || p.life > 4) pieces.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.k === "chip") { p.vy -= 500 * dt; p.rot += dt * 8; }
        else { p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.life > p.max) particles.splice(i, 1);
      }
      for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > 1.25) popups.splice(i, 1); }
      if (caption) { caption.t += dt; if (caption.t > 3.2) caption = null; }

      const ct = camTarget();
      const swoop = cam.y - ct.y > 300 ? 2.4 : 1;
      const k = 1 - Math.exp(-CFG.CAMERA_FOLLOW_SPEED * swoop * dt);
      cam.x += (ct.x - cam.x) * k;
      cam.y += (ct.y - cam.y) * k;
      stageAlt += (floors - stageAlt) * (1 - Math.exp(-1.5 * dt));
      shake *= Math.exp(-10 * dt);
      if (firstTapDone) hintAlpha = Math.max(0, hintAlpha - dt * 3);

      // Ambient life: lights flicking on, birds, wind-blown leaves.
      lightTimer -= dt;
      if (lightTimer <= 0) {
        lightTimer = 1.2 + Math.random() * 1.8;
        const lo = Math.max(1, tower.length - 8);
        const tf = tower[lo + Math.floor(Math.random() * (tower.length - lo))];
        if (tf) {
          const wins = tf.f.items.filter((it) => it.k === "win");
          if (wins.length) { const wi = wins[Math.floor(Math.random() * wins.length)]; wi.lit = Math.random() < 0.35 + stageAlt / 160; }
        }
      }
      birdTimer -= dt;
      if (birdTimer <= 0 && stageAlt < 40) {
        birdTimer = 7 + Math.random() * 8;
        const dir = Math.random() < 0.5 ? 1 : -1, n = 2 + Math.floor(Math.random() * 3), by = 0.18 + Math.random() * 0.3;
        for (let i = 0; i < n; i++) birds.push({ x: dir > 0 ? -0.1 - i * 0.03 : 1.1 + i * 0.03, y: by + (i % 2) * 0.02 + i * 0.008, v: dir * (0.045 + Math.random() * 0.01), ph: Math.random() * 6 });
      }
      for (let i = birds.length - 1; i >= 0; i--) { const b = birds[i]; b.x += b.v * dt; b.ph += dt * 9; if (b.x < -0.3 || b.x > 1.3) birds.splice(i, 1); }
      const leafRate = wa * 3.5;
      if (Math.random() < leafRate * dt && leaves.length < 14) leaves.push({ x: wind >= 0 ? -10 : W + 10, y: Math.random() * H * 0.8, vx: (wind >= 0 ? 1 : -1) * (50 + Math.random() * 50), vy: 8 + Math.random() * 12, r: Math.random() * 6, c: LEAF[Math.floor(Math.random() * 4)] });
      for (let i = leaves.length - 1; i >= 0; i--) {
        const lf = leaves[i];
        lf.x += lf.vx * dt; lf.y += (lf.vy + Math.sin(time * 3 + lf.r) * 20) * dt; lf.r += dt * 4;
        if (lf.x < -20 || lf.x > W + 20 || lf.y > H + 20) leaves.splice(i, 1);
      }
    }

    // ============================================================ RENDER
    const FONT_NUM = '"Bebas Neue", "Oswald", "Arial Narrow", "Helvetica Neue", sans-serif';
    const FONT_SERIF = '"DM Serif Display", Georgia, "Times New Roman", serif';

    function spaced(text, x, y, spacing, align) {
      let total = 0;
      const widths = [];
      for (const ch of text) { const m = g.measureText(ch).width; widths.push(m); total += m + spacing; }
      total -= spacing;
      let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      const prev = g.textAlign;
      g.textAlign = "left";
      let i = 0;
      for (const ch of text) { g.fillText(ch, cx, y); cx += widths[i++] + spacing; }
      g.textAlign = prev;
    }

    function drawSky(sc) {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, css(sc.top));
      grd.addColorStop(1, css(sc.bot));
      g.fillStyle = grd; g.fillRect(0, 0, W, H);

      if (sc.star > 0.01) {
        for (const s of STARS) {
          const tw = 0.5 + 0.5 * Math.sin(time * 1.5 + s[3]);
          g.fillStyle = `rgba(255,246,226,${sc.star * (0.35 + 0.55 * tw)})`;
          g.fillRect(s[0] * W, s[1] * H, s[2], s[2]);
        }
      }
      // Sun becomes a pale moon in the thin air.
      const sx = W * 0.74, sy = H * 0.2, sr = Math.min(W, H * 0.56) * 0.12;
      g.fillStyle = css(sc.sun, 0.35); g.beginPath(); g.arc(sx, sy, sr * 1.45, 0, Math.PI * 2); g.fill();
      g.fillStyle = css(sc.sun, 0.95); g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      const strange = sstep(78, 92, stageAlt);
      if (strange > 0) {
        g.fillStyle = css(sc.top, 0.18 * strange); g.beginPath(); g.arc(sx - sr * 0.3, sy - sr * 0.15, sr * 0.22, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(sx + sr * 0.35, sy + sr * 0.3, sr * 0.14, 0, Math.PI * 2); g.fill();
        // soft aurora ribbons
        for (let k = 0; k < 2; k++) {
          g.strokeStyle = k ? `rgba(168,214,196,${0.08 * strange})` : `rgba(240,170,150,${0.08 * strange})`;
          g.lineWidth = H * 0.05;
          g.beginPath();
          for (let x = -20; x <= W + 20; x += 20) {
            const y = H * (0.28 + k * 0.1) + Math.sin(x * 0.008 + time * 0.25 + k * 2) * H * 0.05;
            if (x === -20) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    }

    function bgX(x, f) { return W / 2 + (x - cam.x * f) * scale; }
    function bgY(y, f) { return H - (y - cam.y * f) * scale; }

    function drawBackdrop(sc) {
      // Distant mountains (barely move).
      const mf = 0.05;
      const mBase = bgY(-20, mf);
      if (mBase - 160 * scale < H) {
        g.fillStyle = css(sc.mtn);
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) {
          const wx = (x - W / 2) / scale + cam.x * mf;
          let hgt = 0;
          for (const m of MOUNTAINS) hgt += Math.sin(wx * m.f + m.a) * m.h * 0.5 + m.h * 0.5;
          g.lineTo(x, mBase - (hgt / MOUNTAINS.length + 40) * scale);
        }
        g.lineTo(W, H); g.fill();
      }
      drawSkyline(SKY_TALL, 0.2, css(sc.tall), css(mixRGB(sc.tall, sc.bot, 0.35)));
      drawSkyline(SKY_FAR, 0.38, css(sc.far), css(mixRGB(sc.far, sc.bot, 0.4)));

      // Clouds the camera rises through.
      const cloudC = sc.cloud;
      for (const c of CLOUDS) {
        const x = bgX(c.x + ((time * c.drift + 900) % 1800) - 900, c.f * 0.3), y = bgY(c.y, c.f);
        if (y < -120 || y > H + 80) continue;
        g.fillStyle = css(cloudC, 0.88);
        for (const b of c.blobs) { g.beginPath(); g.arc(x + b[0] * scale, y + b[1] * scale, b[2] * scale, 0, Math.PI * 2); g.fill(); }
        g.fillRect(x + c.x0 * scale, y - c.rb * 0.2 * scale, (c.x1 - c.x0) * scale, c.rb * 0.75 * scale);
      }
      // Sea of clouds below once above them.
      const seaOff = Math.max(2350 - cam.y * 0.9, 0.17 * viewH);
      const seaY = H - seaOff * scale;
      if (seaY < H + 40 && stageAlt > 30) {
        g.fillStyle = css(cloudC, 0.97);
        g.beginPath(); g.moveTo(0, H);
        for (const s of SEA) {
          const x = bgX(s[0] + Math.sin(time * 0.1 + s[1]) * 6, 0.15);
          if (x < -60 || x > W + 60) continue;
          g.lineTo(x, seaY - s[1] * scale * 0.6);
        }
        g.lineTo(W, H); g.fill();
        for (const s of SEA) {
          const x = bgX(s[0], 0.15);
          if (x < -60 || x > W + 60) continue;
          g.beginPath(); g.arc(x, seaY - s[1] * scale * 0.4, s[1] * scale, 0, Math.PI * 2); g.fill();
        }
        g.fillRect(0, seaY, W, H - seaY);
      }
      // Paper lanterns drifting up in the thin air.
      const la = sstep(84, 96, stageAlt);
      if (la > 0) {
        for (const l of LANTERNS) {
          const y = H * (1.1 - ((time * l.sp + l.off) % 1) * 1.3);
          const x = l.x * W + Math.sin(time * 0.6 + l.sw) * 10;
          g.fillStyle = `rgba(244,190,120,${0.75 * la})`;
          g.beginPath(); g.ellipse(x, y, 4, 5.5, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = `rgba(255,236,190,${0.6 * la})`; g.fillRect(x - 1.5, y + 3, 3, 2);
        }
      }
      // Birds.
      g.strokeStyle = "rgba(70,60,60,0.55)"; g.lineWidth = 1.2;
      for (const b of birds) {
        const x = b.x * W, y = b.y * H, fl = Math.sin(b.ph) * 2.2;
        g.beginPath(); g.moveTo(x - 4, y - fl); g.quadraticCurveTo(x - 1.5, y - 1, x, y); g.quadraticCurveTo(x + 1.5, y - 1, x + 4, y - fl); g.stroke();
      }
    }

    function drawSkyline(list, f, col, winCol) {
      const base = bgY(-10, f);
      if (base - 320 * scale > H) return;
      g.fillStyle = col;
      for (const b of list) {
        const x = bgX(b.x, f), w = b.w * scale, h = b.h * scale;
        if (x + w < -10 || x > W + 10 || base - h > H) continue;
        g.fillRect(x, base - h, w, h + 2);
        const top = base - h;
        g.beginPath();
        switch (b.roof) {
          case "pitch": g.moveTo(x - 2, top); g.lineTo(x + w / 2, top - w * 0.42); g.lineTo(x + w + 2, top); break;
          case "dome": g.arc(x + w / 2, top, w * 0.36, Math.PI, 0); g.rect(x + w / 2 - 0.6 * scale, top - w * 0.36 - 5 * scale, 1.2 * scale, 6 * scale); break;
          case "spire": g.moveTo(x + w * 0.3, top); g.lineTo(x + w / 2, top - w * 1.1); g.lineTo(x + w * 0.7, top); break;
          case "tank": g.rect(x + w * 0.55, top - 9 * scale, w * 0.28, 7 * scale); g.rect(x + w * 0.58, top - 2 * scale, 1 * scale, 2 * scale); g.rect(x + w * 0.78, top - 2 * scale, 1 * scale, 2 * scale); break;
          case "chhatri": g.arc(x + w / 2, top - 4 * scale, w * 0.22, Math.PI, 0); g.rect(x + w * 0.3, top - 4 * scale, w * 0.4, 4 * scale); break;
          case "step": g.rect(x + w * 0.15, top - 6 * scale, w * 0.7, 6 * scale); g.rect(x + w * 0.32, top - 11 * scale, w * 0.36, 5 * scale); break;
          default: g.rect(x - 1, top - 2 * scale, w + 2, 2 * scale);
        }
        g.fill();
        if (b.win) {
          g.fillStyle = winCol;
          for (let wy = top + 6 * scale; wy < base - 6 * scale; wy += 9 * scale) {
            for (let wx = x + 4 * scale; wx < x + w - 5 * scale; wx += 8 * scale) g.fillRect(wx, wy, 3 * scale, 4 * scale);
          }
          g.fillStyle = col;
        }
      }
    }

    // World view: zoom + camera, possibly pulled back during a milestone reveal.
    let view = { x: 0, y: 0, z: 1, S: 1 };
    function computeView() {
      let vx = cam.x, vy = cam.y, vz = 1;
      if (reveal) {
        const p = clamp(reveal.t / reveal.dur, 0, 1);
        const e = p < 0.35 ? easeInOut(p / 0.35) : p < 0.72 ? 1 : 1 - easeInOut((p - 0.72) / 0.28);
        vz = lerp(1, reveal.z, e); vy = lerp(cam.y, reveal.camY, e); vx = lerp(cam.x, 0, e);
      }
      view = { x: vx, y: vy, z: vz, S: scale * vz };
    }
    function enterWorld() {
      g.save();
      g.translate(W / 2 - view.x * view.S, H + view.y * view.S + shake * Math.sin(time * 60));
      g.scale(view.S, view.S);
    }

    function drawGround(sc) {
      // World space here: x right, y DOWN (world y negated). Ground line at y=0.
      const L = -1400, R = 1400;
      // hedge band hiding the skyline seam
      g.fillStyle = "#9DB79A";
      g.beginPath(); g.moveTo(L, 0);
      for (let x = L; x <= R; x += 14) g.lineTo(x, -14 - Math.sin(x * 0.07) * 3 - Math.sin(x * 0.23) * 2);
      g.lineTo(R, 0); g.fill();
      for (const nb of NEIGHBOURS) {
        const pal = WALLS[nb.pal];
        const wall = mixHex(pal.wall, "#E9E2CF", 0.38), sh = mixHex(pal.shade, "#E9E2CF", 0.38), tr = mixHex(pal.trim, "#E9E2CF", 0.3);
        rect(g, wall, nb.x, -nb.h, nb.w, nb.h);
        rect(g, sh, nb.x + nb.w - 6, -nb.h, 6, nb.h);
        if (nb.roof === "pitch") {
          g.fillStyle = mixHex("#B5573B", "#E9E2CF", 0.4);
          g.beginPath(); g.moveTo(nb.x - 4, -nb.h); g.lineTo(nb.x + nb.w / 2, -nb.h - nb.w * 0.38); g.lineTo(nb.x + nb.w + 4, -nb.h); g.fill();
        } else rect(g, tr, nb.x - 2, -nb.h - 4, nb.w + 4, 5);
        const cols = Math.max(1, Math.floor((nb.w - 10) / 22));
        for (let fy = -nb.h + 12; fy < -18; fy += 30) {
          for (let c = 0; c < cols; c++) {
            const wx = nb.x + 8 + c * ((nb.w - 16) / cols) + ((nb.w - 16) / cols - 11) / 2;
            rect(g, tr, wx - 1, fy - 1, 13, 17);
            rect(g, mixHex(GLASS, "#E9E2CF", 0.3), wx, fy, 11, 15);
          }
        }
        rect(g, mixHex("#6E4A39", "#E9E2CF", 0.35), nb.x + nb.w / 2 - 6, -18, 12, 18);
      }
      // trees + lamps behind the tower
      for (const tx of [-128, 132, -300, 420, -420]) {
        const sway = Math.sin(time * 1.1 + tx) * (1.2 + Math.abs(wind) * 0.06) + wind * 0.15;
        rect(g, "#7A5843", tx - 2, -30, 4, 30);
        circle(g, "#6F946F", tx + sway, -40, 15);
        circle(g, "#7FA37A", tx - 9 + sway, -34, 10);
        circle(g, "#86AB80", tx + 8 + sway * 1.1, -46, 10);
        circle(g, "rgba(255,245,220,0.18)", tx - 5 + sway, -48, 6);
      }
      for (const lx of [-92, 104, -250, 300]) {
        rect(g, INK, lx - 1, -44, 2, 44);
        rect(g, INK, lx - 3, -46, 6, 2);
        circle(g, "#F7DA97", lx, -42.5, 2.4);
      }
      // parked bicycle
      const bx = -185;
      g.strokeStyle = INK; g.lineWidth = 1;
      g.beginPath(); g.arc(bx - 7, -5, 4.5, 0, Math.PI * 2); g.moveTo(bx + 11.5, -5); g.arc(bx + 7, -5, 4.5, 0, Math.PI * 2);
      g.moveTo(bx - 7, -5); g.lineTo(bx - 1, -11); g.lineTo(bx + 5, -11); g.lineTo(bx + 7, -5); g.moveTo(bx - 1, -11); g.lineTo(bx + 1, -5); g.lineTo(bx + 5, -11);
      g.moveTo(bx - 3, -13); g.lineTo(bx, -13); g.moveTo(bx + 5, -11); g.lineTo(bx + 6, -14); g.stroke();
      rect(g, "#C8674A", bx - 4, -13.6, 3.6, 1.4);
      // street
      rect(g, "#E8D8BA", L, 0, R - L, 7);
      rect(g, "#CDBB98", L, 7, R - L, 2);
      rect(g, "#A2A690", L, 9, R - L, 34);
      g.fillStyle = "#EFE3C8";
      for (let x = L; x < R; x += 34) g.fillRect(x, 25, 16, 1.6);
      rect(g, "#C9B996", L, 43, R - L, 3);
      rect(g, "#8DA585", L, 46, R - L, 900);
      // foundation under the tower
      const bw = tower[0].f.w;
      rect(g, "#CDBB98", -bw / 2 - 8, -2, bw + 16, 4);
      rect(g, "#BCA987", -bw / 2 - 4, 2, bw + 8, 3);
    }

    function drawWalkers() {
      for (const wk of WALKERS) {
        let x = ((wk.x + time * wk.v + 1600) % 1200) - 600;
        const p = { pose: "walk", y: 4, c: wk.c, s: wk.s, ph: wk.ph };
        drawPerson(g, p, time, x);
        if (wk.dog) {
          const dx = x + Math.sign(wk.v) * 9;
          rect(g, "#8A5A3C", dx - 3, 0.5, 6, 2.6);
          circle(g, "#8A5A3C", dx + Math.sign(wk.v) * 3.4, 0.2, 1.6);
          g.strokeStyle = "#8A5A3C"; g.lineWidth = 0.8; g.beginPath();
          const ls = Math.sin(time * 10) * 1.2;
          g.moveTo(dx - 2, 3); g.lineTo(dx - 2 + ls, 4.6); g.moveTo(dx + 2, 3); g.lineTo(dx + 2 - ls, 4.6); g.stroke();
          g.strokeStyle = "rgba(62,48,44,0.6)"; g.lineWidth = 0.5; g.beginPath(); g.moveTo(x + 1.5, -3); g.lineTo(dx, 0); g.stroke();
        }
      }
    }

    function squash(tSince) {
      if (tSince > 0.6) return 0;
      return 0.085 * Math.exp(-9 * tSince) * Math.cos(26 * tSince);
    }

    function drawPlaced(tf) {
      const f = tf.f;
      const sq = squash(tf.land);
      g.save();
      g.translate(tf.ox, -tf.y);
      g.scale(1 + sq * 0.6, 1 - sq);
      g.beginPath(); g.rect(tf.cl - tf.ox, -f.h - 30, tf.cr - tf.cl, f.h + 34); g.clip();
      drawFloor(g, f, time, wind);
      g.restore();
      // Finished edges where the floor was cut.
      if (tf.cl > tf.ox - f.w / 2 + 0.5) { rect(g, f.pal.shade, tf.cl, -tf.y - f.h, 2.4, f.h); }
      if (tf.cr < tf.ox + f.w / 2 - 0.5) { rect(g, f.pal.shade, tf.cr - 2.4, -tf.y - f.h, 2.4, f.h); }
    }

    function drawPiece(p) {
      const f = p.f, pc = (p.cl + p.cr) / 2;
      g.save();
      g.translate(pc + p.dx, -(p.y + p.dy + f.h / 2));
      g.rotate(p.rot);
      g.translate(p.ox - pc, f.h / 2);
      g.beginPath(); g.rect(p.cl - p.ox, -f.h - 30, p.cr - p.cl, f.h + 34); g.clip();
      g.globalAlpha = p.miss ? 1 : clamp(1.6 - p.life, 0, 1);
      drawFloor(g, f, time, wind);
      g.restore();
    }

    function drawHang() {
      const topScreen = view.y + viewH / view.z + 30; // world y just above the screen
      let hx, hy, rot, f = null;
      if (hang) { const hp = hookPoint(); hx = hp.x; hy = hp.y; rot = hang.rot; f = hang.f; }
      else if (hook) {
        hx = hook.x; hy = hook.y + easeOutCubic(Math.min(1, hook.t / 0.45)) * 320; rot = hook.rot * (1 - hook.t);
      } else return;
      const tf = topFloor();
      const pivotX = ((tf.cl + tf.cr) / 2) + (hx - (tf.cl + tf.cr) / 2) * 0.16 + wind * 0.5;
      // cable (bends a touch with wind)
      g.strokeStyle = "#2B2321"; g.lineWidth = 1.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(pivotX, -topScreen);
      g.quadraticCurveTo((pivotX + hx) / 2 + wind * 0.7, -(topScreen + hy) / 2, hx, -hy);
      g.stroke();
      g.save();
      g.translate(hx, -hy);
      g.rotate(rot);
      // pulley + hook block
      g.fillStyle = "#3A3230";
      g.beginPath(); g.moveTo(-5.5, -11); g.lineTo(5.5, -11); g.lineTo(4, 0); g.lineTo(-4, 0); g.closePath(); g.fill();
      circle(g, "#C9A35E", 0, -6.5, 3);
      circle(g, "#3A3230", 0, -6.5, 1);
      rect(g, "#C9A35E", -4.6, -2, 9.2, 1.2);
      g.strokeStyle = "#3A3230"; g.lineWidth = 1.4;
      g.beginPath(); g.arc(0, 2, 2, 0, Math.PI * 2); g.stroke();
      if (f) {
        // bridle lines to the floor's top corners
        const bw = f.w * 0.36;
        g.strokeStyle = "#2B2321"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 2); g.lineTo(-bw, 16); g.moveTo(0, 2); g.lineTo(bw, 16); g.stroke();
        rect(g, "#3A3230", -bw - 2, 14.5, 4, 2.5); rect(g, "#3A3230", bw - 2, 14.5, 4, 2.5);
        g.translate(0, 16 + f.h);
        drawFloor(g, f, time, wind);
        // first-run hint
        if (hintAlpha > 0 && attempt === 1) {
          g.fillStyle = `rgba(62,48,44,${0.75 * hintAlpha})`;
          g.font = `italic 13px ${FONT_SERIF}`;
          g.textAlign = "center";
          g.fillText("tap to drop", 0, 20);
        }
      } else if (hook) {
        // snapped bridles flick upward
        const k = Math.min(1, hook.t / 0.25), bw = hook.w * 0.36;
        g.strokeStyle = `rgba(43,35,33,${1 - k})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 2); g.lineTo(-bw * (1 - k * 0.7), 16 - k * 10); g.moveTo(0, 2); g.lineTo(bw * (1 - k * 0.7), 16 - k * 10); g.stroke();
      }
      g.restore();
    }

    function drawFalling() {
      if (!fall) return;
      const f = fall.f;
      const rot = fall.rot0 * clamp((fall.y - topY()) / fall.dist0, 0, 1);
      g.save();
      g.translate(fall.x, -(fall.y + f.h / 2));
      g.rotate(rot);
      g.translate(0, f.h / 2);
      drawFloor(g, f, time, wind);
      g.restore();
    }

    function drawParticles() {
      for (const p of particles) {
        const a = 1 - p.life / p.max;
        if (p.k === "dust") {
          g.fillStyle = `rgba(240,228,205,${0.75 * a})`;
          g.beginPath(); g.arc(p.x, -p.y, p.size * (1 + p.life * 2.5), 0, Math.PI * 2); g.fill();
        } else if (p.k === "spark") {
          const s = p.size * (0.4 + a);
          g.fillStyle = `rgba(250,226,150,${a})`;
          g.beginPath();
          g.moveTo(p.x, -p.y - s); g.lineTo(p.x + s * 0.25, -p.y - s * 0.25); g.lineTo(p.x + s, -p.y); g.lineTo(p.x + s * 0.25, -p.y + s * 0.25);
          g.lineTo(p.x, -p.y + s); g.lineTo(p.x - s * 0.25, -p.y + s * 0.25); g.lineTo(p.x - s, -p.y); g.lineTo(p.x - s * 0.25, -p.y - s * 0.25);
          g.fill();
        } else if (p.k === "chip") {
          g.save(); g.translate(p.x, -p.y); g.rotate(p.rot); g.globalAlpha = a;
          rect(g, p.c, -p.size / 2, -p.size / 2, p.size, p.size * 0.7); g.restore();
        }
      }
    }

    function drawPopups() {
      for (const p of popups) {
        const k = p.t / 1.25;
        const a = k < 0.15 ? k / 0.15 : 1 - sstep(0.6, 1, k);
        const y = -(p.y + easeOutCubic(Math.min(1, k * 1.4)) * 26);
        g.save();
        g.translate(p.x, y);
        const s = 1 / view.z;
        g.scale(s * (p.perfect ? 1 + 0.25 * Math.max(0, 1 - p.t * 6) : 1), s * (p.perfect ? 1 + 0.25 * Math.max(0, 1 - p.t * 6) : 1));
        g.textAlign = "center";
        if (p.word) {
          g.font = `italic ${p.perfect ? 22 : 16}px ${FONT_SERIF}`;
          g.fillStyle = `rgba(255,248,232,${a * 0.85})`;
          g.fillText(p.word, 0.8, -14 + 0.8);
          g.fillStyle = p.perfect ? `rgba(168,72,44,${a})` : `rgba(62,48,44,${a * 0.85})`;
          g.fillText(p.word, 0, -14);
        }
        g.font = `${p.perfect ? 20 : 16}px ${FONT_NUM}`;
        g.fillStyle = `rgba(62,48,44,${a * 0.9})`;
        spaced(p.pts + (p.mult ? "  " + p.mult : ""), 0, p.word ? 6 : -4, 1.2, "center");
        g.restore();
      }
    }

    function drawForeground(sc) {
      // Thin cloud wisps passing in front of the tower in the cloud band.
      for (const w of WISPS) {
        const x = bgX(w.x + ((time * w.drift + 800) % 1600) - 800, 0.2), y = bgY(w.y, 1.12);
        if (y < -60 || y > H + 60) continue;
        g.fillStyle = css(sc.cloud, 0.32);
        g.beginPath(); g.ellipse(x, y, w.w * scale, 10 * scale, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(x + w.w * 0.3 * scale, y - 7 * scale, w.w * 0.45 * scale, 9 * scale, 0, 0, Math.PI * 2); g.fill();
      }
      for (const lf of leaves) {
        g.save(); g.translate(lf.x, lf.y); g.rotate(lf.r);
        g.fillStyle = lf.c; g.beginPath(); g.ellipse(0, 0, 3.4, 1.6, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }

    function drawHUD() {
      const top = Math.max(16, safeTop + 12);
      const ink = "rgba(62,48,44,0.88)";
      g.fillStyle = ink;
      g.font = `12px ${FONT_NUM}`;
      g.textBaseline = "alphabetic";
      spaced("HEIGHT", 20, top + 10, 2.4, "left");
      g.font = `46px ${FONT_NUM}`;
      spaced(String(floors), 19, top + 52, 1, "left");
      const mult = 1 + combo;
      g.font = `12px ${FONT_NUM}`;
      g.fillStyle = mult > 1 ? "rgba(168,72,44,0.9)" : "rgba(62,48,44,0.45)";
      spaced("COMBO", W - 20, top + 10, 2.4, "right");
      g.font = `34px ${FONT_NUM}`;
      spaced(`×${mult}`, W - 20, top + 44, 1, "right");
      g.font = `12px ${FONT_NUM}`;
      g.fillStyle = "rgba(62,48,44,0.6)";
      spaced(`${points} PTS`, W - 20, top + 62, 1.6, "right");
      // altitude tick: a thin rule that fills toward the next stage
      const next = STAGES.find((s) => s.at > floors);
      const prev = [...STAGES].reverse().find((s) => s.at <= floors);
      if (next) {
        const k = (floors - prev.at) / (next.at - prev.at);
        rect(g, "rgba(62,48,44,0.15)", 20, top + 60, 54, 1.4);
        rect(g, "rgba(168,72,44,0.7)", 20, top + 60, 54 * k, 1.4);
      }
    }

    function drawCaption() {
      if (!caption) return;
      const k = caption.t / 3.2;
      const a = k < 0.15 ? k / 0.15 : 1 - sstep(0.7, 1, k);
      const y = Math.max(16, safeTop + 12) + 104;
      g.textAlign = "center";
      g.font = `italic 24px ${FONT_SERIF}`;
      g.fillStyle = `rgba(62,48,44,${a * 0.85})`;
      g.fillText(caption.text, W / 2, y);
      if (caption.sub) {
        g.font = `12px ${FONT_NUM}`;
        g.fillStyle = `rgba(62,48,44,${a * 0.55})`;
        spaced(caption.sub.toUpperCase(), W / 2, y + 20, 2.4, "center");
      }
    }

    function drawGameOver() {
      if (state !== "over") return;
      const a = clamp((time - overAt) / 0.3, 0, 1);
      g.fillStyle = `rgba(246,234,212,${0.62 * a})`;
      g.fillRect(0, 0, W, H);
      const cy = H * 0.36;
      g.textAlign = "center";
      g.fillStyle = `rgba(150,66,40,${a})`;
      g.font = `${Math.round(Math.min(W * 0.34, 132))}px ${FONT_NUM}`;
      spaced(String(floors), W / 2, cy, 2, "center");
      g.fillStyle = `rgba(62,48,44,${a * 0.9})`;
      g.font = `16px ${FONT_NUM}`;
      spaced(floors === 1 ? "FLOOR" : "FLOORS", W / 2, cy + 26, 4, "center");
      rect(g, `rgba(62,48,44,${a * 0.35})`, W / 2 - 26, cy + 42, 52, 1.2);
      g.font = `15px ${FONT_NUM}`;
      g.fillStyle = `rgba(62,48,44,${a * 0.75})`;
      spaced(`BEST ${best}    ·    ${points} PTS`, W / 2, cy + 66, 2, "center");
      if (newBest) {
        g.font = `italic 18px ${FONT_SERIF}`;
        g.fillStyle = `rgba(150,66,40,${a})`;
        g.fillText("a new best", W / 2, cy - Math.min(W * 0.34, 132) * 0.82);
      }
      const pulse = 0.55 + 0.45 * Math.sin((time - overAt) * 4);
      g.font = `15px ${FONT_NUM}`;
      g.fillStyle = `rgba(62,48,44,${a * pulse})`;
      spaced("TAP TO BUILD AGAIN", W / 2, cy + 110, 3, "center");
    }

    function render() {
      const sc = stageColors(stageAlt);
      g.textBaseline = "alphabetic";
      drawSky(sc);
      drawBackdrop(sc);
      computeView();
      enterWorld();
      drawGround(sc);
      for (const p of pieces) drawPiece(p);
      // Only draw floors that are on screen.
      const viewTop = view.y + viewH / view.z + 60, viewBottom = view.y - 80;
      for (const tf of tower) {
        if (tf.y > viewTop || tf.y + tf.f.h < viewBottom) continue;
        drawPlaced(tf);
      }
      if (view.y < 60) drawWalkers();
      drawFalling();
      drawHang();
      drawParticles();
      drawPopups();
      g.restore();
      drawForeground(sc);
      drawHUD();
      drawCaption();
      drawGameOver();
    }

    // ============================================================ INPUT + LIFECYCLE
    function onTap() {
      firstTapDone = true;
      sfx.ensure();
      startMusic();
      if (state === "over") {
        if (time - overAt < 0.35) return;
        newRun();
        return;
      }
      if (!startedAttempt) {
        startedAttempt = true;
        try { ctx.platform.start({ attempt }); } catch (e) { /* optional */ }
      }
      if (state === "reveal") { reveal.t = Math.max(reveal.t, reveal.dur * 0.72); return; }
      if (state === "swing") release();
    }

    ctx.listen(canvas, "pointerdown", (e) => { if (e.cancelable) e.preventDefault(); onTap(); });
    ctx.listen(window, "keydown", (e) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); if (!e.repeat) onTap(); }
      else if (e.key === "r" || e.key === "R") { sfx.ensure(); newRun(); }
    });

    // Local preview harness hook (preview.html only; the Plethora runtime never sets this).
    if (ctx.__preview) ctx.__preview.peek = () => ({ state, floors, combo, points, hang, tower, top: topFloor() });

    newRun();
    render();
    ctx.platform.ready();

    // Fonts are optional polish; the game is already playable with fallbacks.
    try {
      Promise.all([
        ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400", style: "normal" }),
        ctx.loadFont("DM Serif Display", "dm-serif-display", "1.0.0", { weight: "400", style: "italic" })
      ]).catch(() => {});
    } catch (e) { /* fallback fonts */ }

    ctx.game.loop({
      maxDeltaMs: 50,
      update(dtMs) { update(Math.min(dtMs, 50) / 1000); },
      render() { render(); }
    });
  }
};
