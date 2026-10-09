// ONE SECOND AGO — a Plethora Bit.
// You are followed by your own past. Every movement is recorded; translucent
// echoes replay it 1, 2, 3… seconds later. Touch one and the run ends.
//
// Code map (single file, sections in order):
//   CONFIG · STAGES (environment palettes) · UTIL · TIME BUFFER · WORLD GEN
//   PLAYER · ECHO SYSTEM · COLLISION · SCORING · CAMERA · INPUT · AUDIO
//   RENDERING (sky → far → mid → ground plane → tiles → trail → entities → weather) · HUD

window.plethoraBit = {
  meta: {
    title: "One Second Ago",
    runtime: "plethora-bit@2",
    tags: ["arcade", "endless", "time"],
    permissions: ["haptics", "audio", "storage"]
  },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // ------------------------------------------------------------------ UTIL
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (t) => t * t * (3 - 2 * t);
    const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
    function hash2(x, y, s) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 7, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    function rngFrom(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const css = (c, a) => (a === undefined || a >= 1)
      ? "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"
      : "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + Math.max(0, a).toFixed(3) + ")";
    const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

    // ---------------------------------------------------------------- TUNING
    const tune = ctx.tune || null;
    function tget(id, fallback) {
      try {
        if (tune && typeof tune.has === "function" && tune.has(id)) {
          const v = tune.get(id);
          if (v !== undefined && v !== null && !(typeof v === "number" && !isFinite(v))) return v;
        }
      } catch (e) { /* fall through */ }
      return fallback;
    }
    function tcurve(id, x, fallback) {
      try {
        if (tune && typeof tune.has === "function" && tune.has(id)) {
          const c = tune.curve(id);
          const v = c && c.at ? c.at(x) : undefined;
          if (typeof v === "number" && isFinite(v)) return v;
        }
      } catch (e) { /* fall through */ }
      return fallback(x);
    }

    // ---------------------------------------------------------------- CONFIG
    // Every gameplay constant lives here. Most are also exposed as creator
    // tuning knobs in plethora.json; the defaults below are the fallbacks.
    const CFG = {};
    function readConfig() {
      CFG.PLAYER_SPEED = tget("player_speed", 2.5);          // world tiles / second (constant run speed)
      CFG.PLAYER_SPEED_LATE = 1.16;                           // multiplier reached at full difficulty
      CFG.PLAYER_ACCELERATION = 9;                            // tiles/s² from standstill on run start
      CFG.PLAYER_DECELERATION = 14;                           // tiles/s² when pressed into a wall
      CFG.TURN_RATE = tget("turn_rate", 6.0);                 // radians / second (slightly inertial steering)
      CFG.PLAYER_SIZE = 0.14;                                 // body radius in tiles
      CFG.ECHO_DELAY_1 = 1; CFG.ECHO_DELAY_2 = 2; CFG.ECHO_DELAY_3 = 3; CFG.ECHO_DELAY_4 = 4; CFG.ECHO_DELAY_5 = 5;
      CFG.ECHO_DELAY_6 = 6; CFG.ECHO_DELAY_7 = 7;
      CFG.ECHO_DELAYS = [CFG.ECHO_DELAY_1, CFG.ECHO_DELAY_2, CFG.ECHO_DELAY_3, CFG.ECHO_DELAY_4, CFG.ECHO_DELAY_5, CFG.ECHO_DELAY_6, CFG.ECHO_DELAY_7];
      CFG.MAX_ECHOES = clamp(Math.round(tget("max_echoes", 7)), 1, 7);
      CFG.JUMP_HEIGHT = 0.75;                                 // in wall units
      CFG.JUMP_TIME = 0.7;                                    // seconds airborne
      CFG.ECHO_OPACITY = tget("echo_opacity", 0.74);
      CFG.PATH_WIDTH = clamp(Math.round(tget("path_width", 4)), 3, 7);   // starting path width in tiles
      CFG.WORLD_SCALE = tget("world_scale", 6.2);             // tiles across the screen width
      CFG.CAMERA_SPEED = 3.4;                                 // camera follow sharpness
      CFG.SCROLL_START = tget("scroll_start", 0.72);          // walkway advance, tiles / second
      CFG.SCROLL_MAX = tget("scroll_max", 1.8);
      CFG.HURDLE_DENSITY = tget("hurdle_density", 1);         // 0 = no hurdles, 2 = twice as many
      CFG.BAND_START = tget("band_length", 13);               // walkable length of the path in tiles
      CFG.BAND_MIN = 8.5;
      CFG.ENVIRONMENT_TRANSITION_SPEED = tget("environment_pace", 1);   // >1 = world changes faster
      CFG.STAGE_LENGTH = 46 / Math.max(0.2, CFG.ENVIRONMENT_TRANSITION_SPEED); // tiles of path per environment
      CFG.DAY_NIGHT_TRANSITION_SPEED = 0.5;                   // share of each environment spent blending
      CFG.COLLISION_TOLERANCE = tget("collision_tolerance", 0.06);
      CFG.DISTANCE_SCORE_RATE = 2;                            // metres per tile of walkway
      CFG.PREVIEW_ENVIRONMENT = tget("preview_environment", 0);
    }
    // DIFFICULTY_CURVE (0..1 by survival seconds) and echo schedule are tuning curves.
    const difficultyFallback = (t) => {
      const pts = [[0, 0], [15, 0.05], [60, 0.5], [130, 0.85], [200, 1]];
      for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return lerp(a[1], b[1], smooth((t - a[0]) / (b[0] - a[0]))); }
      }
      return 1;
    };
    const echoScheduleFallback = (t) => (t < 12 ? 1 : t < 25 ? 2 : t < 40 ? 3 : t < 55 ? 4 : t < 72 ? 5 : t < 90 ? 6 : 7);
    readConfig();

    // ---------------------------------------------------------------- STAGES
    // Visual states of ONE continuous world. They are never shown as levels;
    // the renderer blends neighbouring states by distance travelled.
    const STAGE_HEX = [
      { // A — city / garden, soft daylight
        sky0: "#a7d0c0", sky1: "#ecead0", haze: "#d4e2c9", far: "#b4ccb2", far2: "#c7d9c2", mid: "#cfa58a", midR: "#b98c74",
        fog: "#d7e0c8", sun: "#fff6dc", path: "#f2dcbd", path2: "#ead0ad", grout: "#d3b48d", wallL: "#df7a4f", wallR: "#b95a3b",
        arch: "#8d3e2c", towerTop: "#f0d7b7", leaf: "#477f52", leaf2: "#79ad69", cypress: "#3b7150", trunk: "#6b4a37",
        water: "#78aba2", water2: "#9cc6b9", cloud: "#fbf3e2", shadow: "#5a4a3c", window: "#ffd38a", ink: "#3f5853",
        n: { sunAmt: 0.55, moonAmt: 0, stars: 0, drop: 3.4, archAmt: 1, windowAmt: 0.12, lights: 0, lamps: 0,
             waterAmt: 0, cloudAmt: 0, floatAmt: 0, rain: 0, leaves: 1, birds: 1, mist: 0, shadowLen: 1.0, shadowAlpha: 0.2,
             skyline: 1, horizon: 0.44, sunX: 0.78, sunY: 0.16, wind: 0.5, pad: 0 } },
      { // B — rooftops, warm afternoon → golden hour
        sky0: "#7c6f9e", sky1: "#f2b893", haze: "#e2b39c", far: "#a98095", far2: "#c79a9c", mid: "#c77a62", midR: "#a35d4f",
        fog: "#d9a594", sun: "#ffd9a0", path: "#f4d0aa", path2: "#ecc39b", grout: "#cf9b78", wallL: "#d7755a", wallR: "#a65046",
        arch: "#6c3036", towerTop: "#e9b48f", leaf: "#5a8155", leaf2: "#8fae6a", cypress: "#4b6a4c", trunk: "#5e3f33",
        water: "#8a8fae", water2: "#a5a4c0", cloud: "#ffe2c8", shadow: "#4a2f38", window: "#ffd08a", ink: "#fff4e6",
        n: { sunAmt: 0.9, moonAmt: 0, stars: 0, drop: 5.5, archAmt: 0.3, windowAmt: 1, lights: 0.45, lamps: 0.55,
             waterAmt: 0, cloudAmt: 0, floatAmt: 0, rain: 0, leaves: 0.25, birds: 0.7, mist: 0, shadowLen: 2.1, shadowAlpha: 0.26,
             skyline: 1, horizon: 0.5, sunX: 0.24, sunY: 0.38, wind: 0.7, pad: 1 } },
      { // C — water gardens, late light over still water
        sky0: "#86bdb5", sky1: "#e3eedd", haze: "#c4ddd2", far: "#a2c7ba", far2: "#bcd8cb", mid: "#e6e1d2", midR: "#c5c2b3",
        fog: "#a9cbc0", sun: "#fdf6e4", path: "#efeadf", path2: "#e5e0d2", grout: "#cbc4b1", wallL: "#e4dfd0", wallR: "#bab6a7",
        arch: "#8ba79f", towerTop: "#ece6d8", leaf: "#447f58", leaf2: "#77a965", cypress: "#356b4d", trunk: "#5d4a3a",
        water: "#4f8f88", water2: "#79b1a4", cloud: "#f4f8f1", shadow: "#2f4f4a", window: "#ffd38a", ink: "#f5f8f2",
        n: { sunAmt: 0.35, moonAmt: 0, stars: 0, drop: 0.75, archAmt: 0, windowAmt: 0, lights: 0.1, lamps: 0.1,
             waterAmt: 1, cloudAmt: 0, floatAmt: 0, rain: 0.12, leaves: 0.6, birds: 0.5, mist: 0.15, shadowLen: 1.3, shadowAlpha: 0.2,
             skyline: 0.7, horizon: 0.4, sunX: 0.7, sunY: 0.2, wind: 0.4, pad: 2 } },
      { // D — night city, blue hour → night, rain
        sky0: "#121a33", sky1: "#3a3f6b", haze: "#2c3358", far: "#252b4b", far2: "#2f3659", mid: "#3b3d63", midR: "#2c2d4d",
        fog: "#222947", sun: "#e8eaff", path: "#a8a2bf", path2: "#9b95b3", grout: "#7c7697", wallL: "#4b4b72", wallR: "#34345a",
        arch: "#20213b", towerTop: "#6a6688", leaf: "#2f4b46", leaf2: "#46675a", cypress: "#253e3a", trunk: "#2c2733",
        water: "#26304f", water2: "#36406a", cloud: "#5e6488", shadow: "#0d0f1f", window: "#ffc46a", ink: "#f2efff",
        n: { sunAmt: 0, moonAmt: 0.8, stars: 0.7, drop: 5.5, archAmt: 0.4, windowAmt: 1, lights: 1, lamps: 1,
             waterAmt: 0, cloudAmt: 0, floatAmt: 0, rain: 1, leaves: 0, birds: 0, mist: 0.1, shadowLen: 0.7, shadowAlpha: 0.32,
             skyline: 1, horizon: 0.48, sunX: 0.8, sunY: 0.14, wind: 0.8, pad: 3 } },
      { // E — clouds, moonlit pale blue, floating architecture
        sky0: "#8fb2d4", sky1: "#eef1f3", haze: "#dbe4ee", far: "#bdcbdc", far2: "#d1dbe7", mid: "#d6dae6", midR: "#b4bccf",
        fog: "#f1f4f8", sun: "#ffffff", path: "#ece8ef", path2: "#e2dee8", grout: "#c7c3d2", wallL: "#cfd5e4", wallR: "#a9b2ca",
        arch: "#8792ae", towerTop: "#e8e4ee", leaf: "#5f8a87", leaf2: "#8db3a3", cypress: "#4f7476", trunk: "#6b6474",
        water: "#a9bfd8", water2: "#c4d4e6", cloud: "#ffffff", shadow: "#56627e", window: "#ffe2a8", ink: "#3f4f6a",
        n: { sunAmt: 0.25, moonAmt: 0.45, stars: 0.15, drop: 4.2, archAmt: 0.8, windowAmt: 0.15, lights: 0.15, lamps: 0.2,
             waterAmt: 0, cloudAmt: 1, floatAmt: 1, rain: 0, leaves: 0, birds: 0.3, mist: 0.7, shadowLen: 0.9, shadowAlpha: 0.16,
             skyline: 0.35, horizon: 0.56, sunX: 0.22, sunY: 0.14, wind: 0.9, pad: 4 } }
    ];
    const STAGES = STAGE_HEX.map((s) => {
      const o = { n: s.n };
      for (const k in s) if (k !== "n") o[k] = hex(s[k]);
      return o;
    });
    const COLOR_KEYS = Object.keys(STAGE_HEX[0]).filter((k) => k !== "n");
    const NUM_KEYS = Object.keys(STAGE_HEX[0].n);
    const NSTAGE = STAGES.length;

    // Current blended palette (recomputed every frame).
    const P = { c: {}, s: {} };
    function envBlend(e) {
      const i = Math.floor(e);
      const f = e - i;
      const hold = 1 - CFG.DAY_NIGHT_TRANSITION_SPEED;
      const t = smooth(clamp((f - hold) / (1 - hold), 0, 1));
      return { a: ((i % NSTAGE) + NSTAGE) % NSTAGE, b: (((i + 1) % NSTAGE) + NSTAGE) % NSTAGE, t };
    }
    function computePalette(e) {
      const bl = envBlend(e);
      const A = STAGES[bl.a], B = STAGES[bl.b];
      for (const k of COLOR_KEYS) { P.c[k] = mixC(A[k], B[k], bl.t); P.s[k] = css(P.c[k]); }
      for (const k of NUM_KEYS) P[k] = lerp(A.n[k], B.n[k], bl.t);
      P.stageA = bl.a; P.stageB = bl.b; P.blend = bl.t;
    }
    // Which environment a freshly generated piece of path belongs to.
    function genStage(d, r) {
      const bl = envBlend(d / CFG.STAGE_LENGTH + CFG.PREVIEW_ENVIRONMENT);
      return r < bl.t ? bl.b : bl.a;
    }

    // ------------------------------------------------------------ SURFACES
    const canvas = ctx.createCanvas2D({ maxDpr: 2, alpha: false, layer: "content" });
    const g = canvas.getContext("2d");
    const input = ctx.input.track(canvas);
    let W = ctx.width || 390, H = ctx.height || 844, S = 1;
    let TW = 60, HW = 30, HH = 15, ZPX = 36, K = 1;
    function layoutWorld() {
      W = ctx.width || W; H = ctx.height || H;
      TW = clamp(W / CFG.WORLD_SCALE, 44, 104);
      HW = TW / 2; HH = TW / 4; ZPX = TW * 0.61; K = TW / 60;
    }
    function setT(a, b, c, d, e, f) { g.setTransform(a * S, b * S, c * S, d * S, e * S, f * S); }
    function resetT() { g.setTransform(S, 0, 0, S, 0, 0); }

    // ----------------------------------------------------------- TIME BUFFER
    // Fixed-rate ring buffer of player states; echoes sample it with interpolation.
    const REC_HZ = 60;
    const REC_STEP = 1 / REC_HZ;
    const timeBuffer = {
      cap: Math.ceil(9 * REC_HZ) + 8,
      buf: [], head: 0, count: 0,
      init() { for (let i = 0; i < this.cap; i++) this.buf.push({ t: 0, x: 0, y: 0, z: 0, phase: 0, facing: 1, moving: 0 }); },
      reset() { this.head = 0; this.count = 0; },
      push(t, p) {
        const s = this.buf[this.head];
        s.t = t; s.x = p.x; s.y = p.y; s.z = p.jz || 0; s.phase = p.phase; s.facing = p.facing; s.moving = p.moving;
        this.head = (this.head + 1) % this.cap;
        if (this.count < this.cap) this.count++;
      },
      at(i) { return this.buf[(this.head - this.count + i + this.cap * 2) % this.cap]; },
      newest() { return this.count ? this.at(this.count - 1) : null; },
      // State of the player at time tq (seconds of run time), or null if not recorded yet.
      sample(tq, out) {
        if (!this.count) return null;
        const first = this.at(0);
        if (tq < first.t - 1e-6) return null;
        const last = this.at(this.count - 1);
        let a, b, f;
        if (tq >= last.t) { a = b = last; f = 0; }
        else {
          const fi = (tq - first.t) * REC_HZ;
          const i = clamp(Math.floor(fi), 0, this.count - 2);
          a = this.at(i); b = this.at(i + 1); f = clamp(fi - i, 0, 1);
        }
        out.x = lerp(a.x, b.x, f); out.y = lerp(a.y, b.y, f);
        out.phase = lerp(a.phase, b.phase, f);
        out.facing = f < 0.5 ? a.facing : b.facing;
        out.moving = lerp(a.moving, b.moving, f);
        out.z = lerp(a.z, b.z, f);
        return out;
      }
    };
    timeBuffer.init();

    // -------------------------------------------------------------- WORLD GEN
    // The endless path is a zig-zag of axis-aligned strips on an isometric grid.
    // Each tile carries `d` (distance along the path). Only tiles inside the moving
    // band [backD, frontD] are walkable: ahead they rise into place, behind they sink.
    const world = { tiles: new Map(), decor: [], rnd: Math.random, cx: 0, cy: 0, d: 0, dir: 0, seed: 1 };
    const tkey = (x, y) => (x + 1048576) * 2097152 + (y + 1048576);
    const PATHLIKE = { path: 1, bridge: 1, plaza: 1 };
    function tileAt(x, y) { return world.tiles.get(tkey(x, y)); }
    function addPath(x, y, d, kind, st) {
      const k = tkey(x, y);
      const ex = world.tiles.get(k);
      if (ex && PATHLIKE[ex.kind]) { if (kind === "plaza" && ex.kind === "path") ex.kind = "plaza"; return ex; }
      const t = { x, y, d, kind, st, h: hash2(x, y, world.seed), block: null, H: 0, top: null };
      world.tiles.set(k, t);
      return t;
    }
    function addTower(x, y, d, st, Hh, top) {
      const k = tkey(x, y);
      if (world.tiles.has(k)) return null;
      const t = { x, y, d, kind: "tower", st, h: hash2(x, y, world.seed + 3), block: null, H: Hh, top };
      world.tiles.set(k, t);
      return t;
    }
    function pick(r, table) { let acc = 0; for (const [name, w] of table) { acc += w; if (r < acc) return name; } return table[table.length - 1][0]; }
    const TOWER_P = [0.34, 0.5, 0.2, 0.46, 0.24];
    const TOWER_H = [[0.8, 2.0], [1.2, 2.6], [0.3, 0.8], [1.2, 2.6], [0.5, 1.3]];
    const TOWER_TOP = [
      [["tree", 0.45], ["pots", 0.25], ["none", 0.3]],
      [["tank", 0.3], ["chimney", 0.25], ["pots", 0.2], ["none", 0.25]],
      [["bush", 0.6], ["none", 0.4]],
      [["antenna", 0.25], ["chimney", 0.2], ["pots", 0.1], ["none", 0.45]],
      [["tree", 0.4], ["none", 0.6]]
    ];
    const FRONT_P = [0.24, 0.07, 0.32, 0.05, 0.0];

    function resetWorld(seed) {
      world.tiles.clear(); world.decor.length = 0;
      world.seed = seed; world.rnd = rngFrom(seed);
      // Opening terrace: wide strip heading up-right; the player starts on it.
      const W0 = CFG.PATH_WIDTH, L0 = 9;
      const h = (W0 - 1) >> 1, h2 = W0 - 1 - h;
      for (let i = 0; i <= L0; i++) for (let j = -h; j <= h2; j++) addPath(j, 8 - i, i - 8, "path", genStage(0, 0));
      world.cx = 0; world.cy = 8 - L0; world.d = L0 - 8; world.dir = 1;
      // A few quiet trees and a tower on the opening terrace's flanks.
      world.decor.push({ type: "cypress", x: h2 + 1.5, y: 5.5, d: -4, s: 1.05 });
      world.decor.push({ type: "round", x: h2 + 1.6, y: 2.2, d: -1, s: 1.1 });
      world.decor.push({ type: "cypress", x: h2 + 1.4, y: 0.6, d: 0, s: 0.9 });
      addTower(-h - 1, 4, -4, 0, 2.2, "tree");
      addTower(-h - 1, 3, -5, 0, 1.4, "none");
    }

    function genSegment() {
      const r = world.rnd;
      const d0 = world.d;
      const prog = clamp(d0 / 260, 0, 1);
      const st = genStage(d0, r());
      const dir = (world.dir ^= 1);
      const base = CFG.PATH_WIDTH;
      let Wd = prog < 0.18 ? base : prog < 0.5 ? (r() < 0.5 ? base - 1 : base) : (r() < 0.65 ? base - 1 : base);
      Wd = clamp(Wd, 3, 7);
      let L = (prog < 0.4 ? 4 : 3) + Math.floor(r() * (prog < 0.4 ? 5 : 4));
      let kind = "path";
      const bridgeP = (st === 4 ? 0.35 : 0.12) * (prog > 0.25 ? 1 : 0);
      if (r() < bridgeP) { kind = "bridge"; Wd = Math.max(prog > 0.6 ? 2 : 3, Wd - 1); L = 3 + (r() < 0.4 ? 1 : 0); }
      const h = (Wd - 1) >> 1, h2 = Wd - 1 - h;
      const cx = world.cx, cy = world.cy;
      // corner square joining the previous strip
      for (let a = -h; a <= h2; a++) for (let b = -h; b <= h2; b++) addPath(cx + a, cy + b, d0, "path", st);
      for (let i = 1; i <= L; i++) {
        for (let j = -h; j <= h2; j++) {
          const x = dir === 0 ? cx - i : cx + j;
          const y = dir === 0 ? cy + j : cy - i;
          addPath(x, y, d0 + i, kind, st);
        }
      }
      // HURDLES: low barriers across the walkway. There is no jump — every hurdle row
      // leaves a gap to steer through. They grow denser and the gaps tighter with distance.
      if (kind !== "bridge" && d0 > 9) {
        const hp = CFG.HURDLE_DENSITY * (0.5 + 0.45 * prog);
        let lastRow = -9, lastFull = false;
        for (let i = 1; i < L; i++) {
          if (i - lastRow < (lastFull ? 3 : 2) || r() > hp) continue;
          // full-width rows must be jumped; never two in a row
          const full = d0 > 16 && !lastFull && r() < 0.25 + 0.3 * prog;
          lastRow = i; lastFull = full;
          const gap = full ? 0 : Wd >= 4 && prog < 0.5 ? 2 : (r() < 0.55 ? 1 : 2);
          const g0 = -h + Math.floor(r() * (Wd - gap + 1));
          const hst = genStage(d0 + i, r());
          const look = hst === 1 ? "crate" : hst === 3 ? "barrier" : hst === 4 ? "column" : r() < 0.5 ? "hedge" : "wall";
          for (let j = -h; j <= h2; j++) {
            if (j >= g0 && j < g0 + gap) continue;
            const x = dir === 0 ? cx - i : cx + j, y = dir === 0 ? cy + j : cy - i;
            const t = tileAt(x, y);
            if (t && PATHLIKE[t.kind] && t.kind !== "plaza" && !t.block) { t.block = "hurdle"; t.look = look; }
          }
        }
      }
      // Side architecture (behind the path) and foreground plants (in front, below path level).
      for (let i = 1; i <= L; i++) {
        const bx = dir === 0 ? cx - i : cx - h - 1, by = dir === 0 ? cy - h - 1 : cy - i;
        const fx = dir === 0 ? cx - i : cx + h2 + 1, fy = dir === 0 ? cy + h2 + 1 : cy - i;
        const stI = genStage(d0 + i, r());
        if (kind !== "bridge" && i >= 2 && i <= L - h2 - 2 && r() < TOWER_P[stI]) {
          const hr = TOWER_H[stI];
          addTower(bx, by, d0 + i, stI, lerp(hr[0], hr[1], r()), pick(r(), TOWER_TOP[stI]));
        }
        if (i < L && r() < FRONT_P[stI]) {
          const type = stI === 2 ? (r() < 0.6 ? "reeds" : "lily") : (r() < 0.55 ? "cypress" : "round");
          world.decor.push({ type, x: fx + 0.5, y: fy + 0.5 + (dir === 0 ? r() * 0.8 : 0), d: d0 + i, s: 0.85 + r() * 0.35 });
        }
        // edge planters / tanks: genuine spatial constraints on wide paths
        if (kind !== "bridge" && Wd >= 4 && i >= 1 && i < L && r() < (stI === 4 ? 0 : 0.09)) {
          const j = r() < 0.5 ? -h : h2;
          const x = dir === 0 ? cx - i : cx + j, y = dir === 0 ? cy + j : cy - i;
          const t = tileAt(x, y);
          if (t && PATHLIKE[t.kind] && !t.block) t.block = stI === 1 && r() < 0.6 ? "tank" : "planter";
        }
        // lamps along the front edge (decorative only)
        if ((stI === 3 || stI === 1) && i % 2 === 0 && r() < (stI === 3 ? 0.7 : 0.35)) {
          const ex = dir === 0 ? cx - i + 0.5 : cx + h2 + 1, ey = dir === 0 ? cy + h2 + 1 : cy - i + 0.5;
          world.decor.push({ type: "lamp", x: ex, y: ey, d: d0 + i, s: 1 });
        }
      }
      world.cx = dir === 0 ? cx - L : cx;
      world.cy = dir === 0 ? cy : cy - L;
      world.d = d0 + L;
      // Occasional wide terrace at a corner: room to breathe (and to weave).
      if (kind !== "bridge" && r() < (prog < 0.3 ? 0.12 : 0.1)) {
        const P2 = Math.min(Wd + 2, 7);
        const a = (P2 - 1) >> 1, b = P2 - 1 - a;
        const pst = genStage(world.d, r());
        for (let u = -a; u <= b; u++) for (let v = -a; v <= b; v++) addPath(world.cx + u, world.cy + v, world.d, "plaza", pst);
        if (P2 >= 6 && r() < 0.5) {
          const t = tileAt(world.cx, world.cy);
          if (t && pst !== 4) t.block = "treeplanter";
        }
      }
    }
    function ensureWorld(frontD) {
      let guard = 0;
      while (world.d < frontD + 70 && guard++ < 50) genSegment();
    }
    function pruneWorld(backD) {
      const lim = backD - 34;
      for (const [k, t] of world.tiles) if (t.d < lim) world.tiles.delete(k);
      if (world.decor.length && world.decor[0].d < lim) world.decor = world.decor.filter((o) => o.d >= lim);
    }

    // ----------------------------------------------------------------- STATE
    const run = {
      state: "title", // title | run | dying | over | paused
      t: 0, frontD: 6, backD: -7, band: 13, scroll: 0.7, diff: 0, echoCount: 0,
      unlockT: [0, 0, 0, 0, 0, 0, 0], meters: 0, best: 0, deathT: 0, overT: 0, cause: "", seed: 1, attempt: 0,
      nearCooldown: 0, prox: 0, startedOnce: false
    };
    const FRONT0 = 17;   // the opening walkway is long: the first seconds are calm
    const player = { x: 0.5, y: 2.5, z: 0, heading: Math.atan2(-1, 2), target: Math.atan2(-1, 2), speed: 0, phase: 0, facing: 1, moving: 0, fallV: 0 };
    const echoes = [];
    for (let k = 0; k < 7; k++) echoes.push({ k, x: 0, y: 0, z: 0, phase: 0, facing: 1, moving: 0, vis: 0, alpha: 0, active: false, near: false, minD: 9, on: false });
    const ECHO_TINT = ["#cfe2ef", "#b6c8ea", "#c4b5e2", "#dfb1c9", "#eeaab4", "#f0b8a6", "#e8c7a4"].map(hex);
    const tmpS = { x: 0, y: 0, z: 0, phase: 0, facing: 1, moving: 0 };
    const GLIDE = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];

    // -------------------------------------------------------------- SCORING
    const scoreTrack = (ctx.game && typeof ctx.game.score === "function") ? ctx.game.score({ initial: 0, min: 0 }) : null;
    async function loadBest() {
      try { const v = await Promise.resolve(ctx.storage && ctx.storage.get ? ctx.storage.get("best_m") : null); if (typeof v === "number") run.best = v; } catch (e) { /* storage unavailable */ }
    }
    function saveBest() { try { if (ctx.storage && ctx.storage.set) { const p = ctx.storage.set("best_m", run.best); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ } }
    loadBest();

    // ---------------------------------------------------------------- CAMERA
    const cam = { x: 0, y: 0, shake: 0 };
    function camTarget() { return { x: (player.x - player.y) * HW, y: (player.x + player.y) * HH }; }
    function snapCamera() { const c = camTarget(); cam.x = c.x; cam.y = c.y; }
    const CAM_ANCHOR_Y = 0.6;
    function sx(wx, wy) { return (wx - wy) * HW - cam.x + W * 0.5; }
    function sy(wx, wy, z) { return (wx + wy) * HH - z * ZPX - cam.y + H * CAM_ANCHOR_Y; }

    // ------------------------------------------------------------- RUN FLOW
    function resetRun() {
      readConfig();
      layoutWorld();
      run.seed = (Math.random() * 1e9) | 0;
      resetWorld(run.seed);
      run.t = 0; run.frontD = FRONT0; run.band = CFG.BAND_START; run.backD = -6;
      run.scroll = CFG.SCROLL_START; run.diff = 0; run.echoCount = 0; run.meters = 0; run.deathT = 0; run.cause = "";
      run.nearCooldown = 0; run.prox = 0;
      for (let k = 0; k < 7; k++) run.unlockT[k] = 1e9;
      for (const e of echoes) { e.vis = 0; e.alpha = 0; e.active = false; e.near = false; e.minD = 9; e.on = false; }
      player.x = 0.5; player.y = 2.5; player.z = 0; player.fallV = 0; player.jz = 0; player.jv = 0; player.jumpQ = 0;
      player.heading = player.target = Math.atan2(-1, 2);
      player.speed = 0; player.phase = 0; player.facing = 1; player.moving = 0;
      timeBuffer.reset();
      ensureWorld(run.frontD);
      snapCamera();
      if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { /* ignore */ } }
    }
    function beginRun() {
      if (run.state !== "title") resetRun();
      run.state = "run";
      run.attempt++;
      run.startedOnce = true;
      try { ctx.platform.start({ attempt: run.attempt }); } catch (e) { /* ignore */ }
      audioInit();
      hudShow("run");
    }
    function die(cause) {
      if (run.state !== "run") return;
      run.state = "dying"; run.deathT = 0; run.cause = cause;
      cam.shake = 0.6;
      try { ctx.platform.haptic("medium"); } catch (e) { /* ignore */ }
      sfx.thud();
      try {
        if (ctx.fx && ctx.fx.ripple && cause === "echo") {
          ctx.fx.ripple({ x: sx(player.x, player.y), y: sy(player.x, player.y, 0) - 14 * K, color: "rgba(255,255,255,0.75)", radius: 46 * K, durationMs: 620 });
        }
      } catch (e) { /* ignore */ }
    }
    function finishRun() {
      run.state = "over"; run.overT = 0;
      const m = run.meters;
      const isBest = m > run.best;
      if (isBest) { run.best = m; saveBest(); }
      try { ctx.platform.fail({ score: m, distance: m, echoes: run.echoCount, cause: run.cause }); } catch (e) { /* ignore */ }
      if (scoreTrack && m > 0) {
        try { const p = scoreTrack.submit("distance", { label: m + " m" }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
      }
      hudResult(m, run.best, isBest);
      hudShow("over");
    }

    // ----------------------------------------------------------------- INPUT
    // One-thumb floating stick: the drag direction is the running direction.
    const stick = { active: false, ax: 0, ay: 0, has: false, dir: 0, mag: 0 };
    const keys = { l: false, r: false, u: false, d: false };
    const KEYMAP = { ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d" };
    ctx.listen(window, "keydown", (ev) => {
      const k = KEYMAP[ev.code];
      if (k) { keys[k] = true; if (ev.preventDefault) ev.preventDefault(); if (run.state === "title" || (run.state === "over" && run.overT > 0.35)) beginRun(); }
      else if ((ev.code === "Space" || ev.code === "KeyJ") && run.state === "run") { requestJump(); if (ev.preventDefault) ev.preventDefault(); }
      else if (ev.code === "Space" || ev.code === "Enter") { if (run.state === "title" || (run.state === "over" && run.overT > 0.35)) beginRun(); else if (run.state === "paused") togglePause(); }
      else if (ev.code === "Escape" || ev.code === "KeyP") togglePause();
    });
    ctx.listen(window, "keyup", (ev) => { const k = KEYMAP[ev.code]; if (k) keys[k] = false; });
    function readSteering() {
      const R = 54 * K;
      if (input.pressed) { stick.active = true; stick.ax = input.x; stick.ay = input.y; stick.mag = 0; }
      if (input.down && stick.active) {
        let dx = input.x - stick.ax, dy = input.y - stick.ay;
        const len = Math.hypot(dx, dy);
        stick.mag = clamp(len / R, 0, 1);
        if (len > 7 * K) { stick.dir = Math.atan2(dy, dx); stick.has = true; player.target = stick.dir; }
        if (len > R) { stick.ax = input.x - (dx / len) * R; stick.ay = input.y - (dy / len) * R; }
      } else if (!input.down) { stick.active = false; }
      const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
      if (kx || ky) player.target = Math.atan2(ky, kx);
    }

    // ------------------------------------------------------------- COLLISION
    let airborne = false;   // while in the air, hurdles don't block
    function walkableTile(t) {
      return !!t && PATHLIKE[t.kind] === 1 && (!t.block || (airborne && t.block === "hurdle")) && t.d <= run.frontD + 1e-6 && t.d >= run.backD - 1e-6;
    }
    function walkable(x, y) {
      const r = CFG.PLAYER_SIZE;
      return walkableTile(tileAt(Math.floor(x - r), Math.floor(y - r))) && walkableTile(tileAt(Math.floor(x + r), Math.floor(y - r))) &&
             walkableTile(tileAt(Math.floor(x - r), Math.floor(y + r))) && walkableTile(tileAt(Math.floor(x + r), Math.floor(y + r)));
    }
    function groundFree(x, y) { const a = airborne; airborne = false; const ok = walkable(x, y); airborne = a; return ok; }
    // JUMP: a short hop over hurdles (and over your own past). Presses are buffered briefly.
    function requestJump() {
      if (run.state !== "run") return;
      player.jumpQ = 0.16;
    }
    function jumpStep(dt) {
      player.jumpQ = Math.max(0, player.jumpQ - dt);
      const grav = 8 * CFG.JUMP_HEIGHT / (CFG.JUMP_TIME * CFG.JUMP_TIME);
      if (player.jumpQ > 0 && player.jz <= 0.001) {
        player.jumpQ = 0; player.jv = grav * CFG.JUMP_TIME / 2; player.jz = 0.001;
        sfx.hop();
        try { ctx.platform.haptic("light"); ctx.platform.interact({ type: "jump" }); } catch (e) { /* ignore */ }
      }
      if (player.jz > 0) {
        player.jv -= grav * dt; player.jz += player.jv * dt;
        if (player.jz <= 0) {
          if (!groundFree(player.x, player.y)) { player.jz = 0.06; player.jv = 0; }   // skim the top until clear
          else { player.jz = 0; player.jv = 0; sfx.footstep(player.phase + Math.PI); }
        }
      }
      airborne = player.jz > 0.05;
    }

    // ---------------------------------------------------------- SIMULATION
    function step(dt) {
      if (run.state === "run") {
        run.t += dt;
        run.diff = clamp(tcurve("difficulty_ramp", run.t, difficultyFallback), 0, 1);
        run.scroll = lerp(CFG.SCROLL_START, CFG.SCROLL_MAX, run.diff);
        const bandTarget = lerp(CFG.BAND_START, CFG.BAND_MIN, run.diff);
        run.band = lerp(run.band, bandTarget, 1 - Math.exp(-dt * 0.5));
        // The walkway assembles slowly at first so the opening seconds stay calm.
        const ease = smooth(clamp(run.t / 4, 0, 1));
        run.frontD += run.scroll * dt * ease;
        // The walkway builds itself ahead of you, so running forward is never blocked.
        const under = tileAt(Math.floor(player.x), Math.floor(player.y));
        if (under && under.d + 4 > run.frontD) run.frontD = lerp(run.frontD, under.d + 4, Math.min(1, dt * 6));
        // The back edge wakes up after a few seconds and closes the band gently.
        const backEase = smooth(clamp((run.t - 6) / 8, 0, 1));
        const excess = Math.max(0, (run.frontD - run.backD) - run.band);
        run.backD = Math.min(run.frontD - CFG.BAND_MIN * 0.8, run.backD + dt * backEase * (run.scroll + 0.3 * excess));

        jumpStep(dt);
        // --- PLAYER: constant-speed run with slightly inertial steering
        const turn = CFG.TURN_RATE * dt;
        player.heading = wrapAngle(player.heading + clamp(wrapAngle(player.target - player.heading), -turn, turn));
        const vmax = CFG.PLAYER_SPEED * lerp(1, CFG.PLAYER_SPEED_LATE, run.diff);
        player.speed = Math.min(vmax, player.speed + CFG.PLAYER_ACCELERATION * dt);
        const scx = Math.cos(player.heading), scy = Math.sin(player.heading);
        let wxv = scx * 0.5 + scy, wyv = scy - scx * 0.5;
        const wl = Math.hypot(wxv, wyv) || 1; wxv /= wl; wyv /= wl;
        const ox = player.x, oy = player.y;
        const stepLen = player.speed * dt;
        const nx = player.x + wxv * stepLen, ny = player.y + wyv * stepLen;
        if (walkable(nx, ny)) { player.x = nx; player.y = ny; }
        else if (walkable(nx, player.y) && Math.abs(wxv) > 0.2) { player.x = nx; }
        else if (walkable(player.x, ny) && Math.abs(wyv) > 0.2) { player.y = ny; }
        else {
          // Wall glide: when pressed flat against an edge, slip toward the nearest open
          // direction; with no thumb on the screen, also turn to follow the walkway.
          const steering = (stick.active && input.down) || keys.l || keys.r || keys.u || keys.d;
          let bestDot = -0.3, bx = 0, by = 0;
          for (const [ux, uy] of GLIDE) {
            const dot = ux * wxv + uy * wyv;
            if (dot <= bestDot) continue;
            if (walkable(player.x + ux * stepLen * 0.8, player.y + uy * stepLen * 0.8)) { bestDot = dot; bx = ux; by = uy; }
          }
          if (bx || by) {
            player.x += bx * stepLen * 0.8; player.y += by * stepLen * 0.8;
            if (!steering) player.target = Math.atan2((bx + by) * HH, (bx - by) * HW);
          }
        }
        const moved = Math.hypot(player.x - ox, player.y - oy);
        if (moved < player.speed * dt * 0.25) player.speed = Math.max(vmax * 0.55, player.speed - CFG.PLAYER_DECELERATION * dt);
        player.phase += moved * 5.2;
        player.moving = lerp(player.moving, moved > 1e-4 ? 1 : 0, 1 - Math.exp(-dt * 12));
        if (Math.abs(scx) > 0.08) player.facing = scx > 0 ? 1 : -1;
        sfx.footstep(player.phase);

        // --- TIME BUFFER
        timeBuffer.push(run.t, player);

        // --- ECHO SYSTEM
        const want = clamp(Math.floor(tcurve("echo_schedule", run.t, echoScheduleFallback) + 1e-6), 1, CFG.MAX_ECHOES);
        while (run.echoCount < want) { run.unlockT[run.echoCount] = run.t; run.echoCount++; }
        let prox = 9;
        const hit = 2 * CFG.PLAYER_SIZE - CFG.COLLISION_TOLERANCE;
        for (let k = 0; k < run.echoCount; k++) {
          const e = echoes[k];
          const delay = CFG.ECHO_DELAYS[k];
          const s = run.t >= delay ? timeBuffer.sample(run.t - delay, tmpS) : null;
          if (!s) { e.on = false; continue; }
          e.on = true;
          e.x = s.x; e.y = s.y; e.z = s.z; e.phase = s.phase; e.facing = s.facing; e.moving = s.moving;
          const born = Math.max(run.unlockT[k], delay);
          e.vis = clamp((run.t - born) / 0.8, 0, 1);
          const dist = Math.hypot(e.x - player.x, e.y - player.y);
          if (!e.active && e.vis >= 1 && dist > hit + 0.35) e.active = true;   // never spawn on top of the player
          if (e.active) {
            prox = Math.min(prox, dist);
            // you can leap over your past, but not land on it
            if (dist < hit && Math.abs(e.z - player.jz) < 0.45) { die("echo"); break; }
            // near-miss relief: came close, then got away
            if (dist < 0.62) { e.near = true; e.minD = Math.min(e.minD, dist); }
            else if (e.near && dist > 0.95) {
              e.near = false;
              if (e.minD < 0.5 && run.nearCooldown <= 0) { sfx.chime(); run.nearCooldown = 0.9; try { ctx.platform.interact({ type: "near_miss" }); } catch (er) { /* ignore */ } }
              e.minD = 9;
            }
          }
        }
        run.prox = prox;
        run.nearCooldown -= dt;

        // --- FALL: the past dissolves behind you
        if (run.state === "run") {
          const t = tileAt(Math.floor(player.x), Math.floor(player.y));
          if (!t || t.d < run.backD - 0.05) die("fall");
        }

        // --- SCORING
        const m = Math.max(0, Math.floor((run.frontD - FRONT0) * CFG.DISTANCE_SCORE_RATE));
        if (m !== run.meters) { run.meters = m; if (scoreTrack) { try { scoreTrack.set(m); } catch (e) { /* ignore */ } } }

        ensureWorld(run.frontD);
        pruneWorld(run.backD);
      } else if (run.state === "dying") {
        // The player freezes; the past keeps walking and reaches them.
        run.deathT += dt;
        const last = timeBuffer.newest();
        for (let k = 0; k < run.echoCount; k++) {
          const e = echoes[k];
          const tq = Math.min(run.t + run.deathT - CFG.ECHO_DELAYS[k], last ? last.t : 0);
          const s = timeBuffer.sample(tq, tmpS);
          if (s) { e.x = s.x; e.y = s.y; e.z = s.z; e.phase = s.phase; e.facing = s.facing; e.moving = s.moving; e.on = true; }
        }
        if (run.cause === "fall") { player.fallV += dt * 9; player.z -= player.fallV * dt; }
        if (run.deathT > 1.05) finishRun();
      }
    }

    // ---------------------------------------------------------------- AUDIO
    // Soft, minimal, synthesized: wind, rain, footsteps, a quiet pad,
    // a low pulse that rises when an echo is near, a chime for an escape.
    const AU = { ac: null };
    function audioInit() {
      if (AU.ac || disposed) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        AU.ac = ac;
        if (ac.state === "suspended" && ac.resume) ac.resume().catch(() => {});
        const master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination); AU.master = master;
        const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; ch[i] = w * 0.5 + b * 2.2; }
        AU.noise = buf;
        const mkLoop = (type, freq, q) => {
          const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
          const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
          const gn = ac.createGain(); gn.gain.value = 0;
          src.connect(f); f.connect(gn); gn.connect(master); src.start();
          return { src, f, g: gn };
        };
        AU.wind = mkLoop("bandpass", 420, 0.7);
        AU.rain = mkLoop("highpass", 2400, 0.3);
        AU.water = mkLoop("lowpass", 300, 0.5);
        // pad
        const padG = ac.createGain(); padG.gain.value = 0; const padF = ac.createBiquadFilter(); padF.type = "lowpass"; padF.frequency.value = 700;
        padF.connect(padG); padG.connect(master);
        AU.pad = { g: padG, oscs: [] };
        for (let i = 0; i < 3; i++) { const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = 220; const og = ac.createGain(); og.gain.value = 0.33; o.connect(og); og.connect(padF); o.start(); AU.pad.oscs.push(o); }
        ctx.onDestroy(() => { try { ac.close(); } catch (e) { /* ignore */ } });
      } catch (e) { AU.ac = null; }
    }
    const PAD_CHORDS = [[196, 246.9, 293.7], [174.6, 220, 261.6], [164.8, 207.7, 246.9], [146.8, 174.6, 220], [196, 261.6, 329.6]];
    let lastFootPhase = 0, pulseT = 0;
    const sfx = {
      env(node, peak, a, d) { const ac = AU.ac, t = ac.currentTime; node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
      footstep(phase) {
        if (!AU.ac) return;
        const stepIdx = Math.floor(phase / Math.PI);
        if (stepIdx === lastFootPhase) return;
        lastFootPhase = stepIdx;
        const ac = AU.ac, src = ac.createBufferSource(); src.buffer = AU.noise;
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700 + Math.random() * 300;
        const gn = ac.createGain(); src.connect(f); f.connect(gn); gn.connect(AU.master);
        this.env(gn, 0.05, 0.004, 0.06); src.start(ac.currentTime, Math.random() * 1.5, 0.1);
      },
      hop() {
        if (!AU.ac) return;
        const ac = AU.ac, o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(330, ac.currentTime); o.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.12);
        const gn = ac.createGain(); o.connect(gn); gn.connect(AU.master); this.env(gn, 0.035, 0.01, 0.18); o.start(); o.stop(ac.currentTime + 0.25);
      },
      chime() {
        if (!AU.ac) return;
        const ac = AU.ac;
        [1046.5, 1568].forEach((fr, i) => { const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = fr; const gn = ac.createGain(); o.connect(gn); gn.connect(AU.master); this.env(gn, 0.035 / (i + 1), 0.01, 0.9); o.start(); o.stop(ac.currentTime + 1.1); });
      },
      pulse(level) {
        if (!AU.ac) return;
        const ac = AU.ac, o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(74, ac.currentTime); o.frequency.exponentialRampToValueAtTime(48, ac.currentTime + 0.25);
        const gn = ac.createGain(); o.connect(gn); gn.connect(AU.master); this.env(gn, 0.02 + 0.09 * level, 0.02, 0.28); o.start(); o.stop(ac.currentTime + 0.4);
      },
      thud() {
        if (!AU.ac) return;
        const ac = AU.ac, o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(110, ac.currentTime); o.frequency.exponentialRampToValueAtTime(38, ac.currentTime + 0.5);
        const gn = ac.createGain(); o.connect(gn); gn.connect(AU.master); this.env(gn, 0.22, 0.01, 0.7); o.start(); o.stop(ac.currentTime + 0.9);
        const src = ac.createBufferSource(); src.buffer = AU.noise; const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500;
        const g2 = ac.createGain(); src.connect(f); f.connect(g2); g2.connect(AU.master); this.env(g2, 0.12, 0.05, 0.8); src.start(ac.currentTime, 0, 1);
      }
    };
    function audioFrame(dt) {
      if (!AU.ac) return;
      const t = AU.ac.currentTime, active = run.state === "run" || run.state === "dying";
      const tc = 0.6;
      AU.wind.g.gain.setTargetAtTime(0.018 + 0.03 * P.wind, t, tc);
      AU.wind.f.frequency.setTargetAtTime(330 + 200 * Math.sin(performance.now() / 3100), t, 0.8);
      AU.rain.g.gain.setTargetAtTime(0.045 * P.rain, t, tc);
      AU.water.g.gain.setTargetAtTime(0.05 * (P.waterAmt + P.cloudAmt * 0.4), t, tc);
      AU.pad.g.gain.setTargetAtTime(active ? 0.03 : 0.012, t, 1.2);
      const ch = PAD_CHORDS[P.stageA];
      const ch2 = PAD_CHORDS[P.stageB];
      AU.pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(lerp(ch[i], ch2[i], P.blend) * (i === 1 ? 1.003 : 1), t, 2));
      if (run.state === "run" && run.prox < 1.6) {
        const lv = clamp(1 - (run.prox - 0.25) / 1.35, 0, 1);
        pulseT -= dt;
        if (pulseT <= 0) { sfx.pulse(lv); pulseT = lerp(0.95, 0.38, lv); }
      } else pulseT = 0;
    }

    // ------------------------------------------------------------ RENDERING
    let clock = 0;
    let gradCache = null;
    function makeFaceGradients(drop) {
      const gL = g.createLinearGradient(0, 0, 0, drop);
      gL.addColorStop(0, P.s.wallL); gL.addColorStop(0.12, P.s.wallL); gL.addColorStop(1, P.s.fog);
      const gR = g.createLinearGradient(0, 0, 0, drop);
      gR.addColorStop(0, P.s.wallR); gR.addColorStop(0.12, P.s.wallR); gR.addColorStop(1, P.s.fog);
      const gA = g.createLinearGradient(0, 0, 0, drop);
      gA.addColorStop(0, P.s.arch); gA.addColorStop(1, css(mixC(P.c.arch, P.c.fog, 0.85)));
      gradCache = { gL, gR, gA, drop };
    }

    // --- sky, sun/moon, stars, far skyline, mid architecture
    function drawSky() {
      resetT();
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, P.s.sky0); gr.addColorStop(0.62, P.s.sky1); gr.addColorStop(1, P.s.haze);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (P.stars > 0.02) {
        for (let i = 0; i < 70; i++) {
          const x = hash2(i, 1, 9) * W, y = hash2(i, 2, 9) * H * 0.5;
          const tw = 0.55 + 0.45 * Math.sin(clock * (0.8 + hash2(i, 3, 9)) + i);
          g.fillStyle = "rgba(255,255,255," + (P.stars * tw * (0.25 + 0.55 * hash2(i, 4, 9))).toFixed(3) + ")";
          g.fillRect(x, y, 1.4, 1.4);
        }
      }
      const sxp = W * P.sunX - cam.x * 0.02, syp = H * P.sunY;
      if (P.sunAmt > 0.01) {
        const r = TW * 2.6;
        const rg = g.createRadialGradient(sxp, syp, 0, sxp, syp, r);
        rg.addColorStop(0, css(P.c.sun, 0.75 * P.sunAmt)); rg.addColorStop(0.18, css(P.c.sun, 0.45 * P.sunAmt)); rg.addColorStop(1, css(P.c.sun, 0));
        g.fillStyle = rg; g.fillRect(sxp - r, syp - r, r * 2, r * 2);
      }
      if (P.moonAmt > 0.01) {
        const r = TW * 0.42, mx = W * 0.8 - cam.x * 0.02, my = H * 0.13;
        const rg = g.createRadialGradient(mx, my, r * 0.6, mx, my, r * 4);
        rg.addColorStop(0, "rgba(235,238,255," + (0.22 * P.moonAmt).toFixed(3) + ")"); rg.addColorStop(1, "rgba(235,238,255,0)");
        g.fillStyle = rg; g.fillRect(mx - r * 4, my - r * 4, r * 8, r * 8);
        g.fillStyle = "rgba(244,244,255," + (0.9 * P.moonAmt).toFixed(3) + ")";
        g.beginPath(); g.arc(mx, my, r, 0, TAU); g.fill();
      }
      // big soft clouds in the sky
      const cl = P.c.cloud;
      for (let i = 0; i < 4; i++) {
        const span = W + TW * 8;
        const x = ((hash2(i, 5, 2) * span - cam.x * 0.05 + clock * 3 * (0.5 + hash2(i, 6, 2))) % span + span) % span - TW * 4;
        const y = H * (0.12 + 0.22 * hash2(i, 7, 2));
        const s = TW * (0.9 + hash2(i, 8, 2) * 1.2);
        g.fillStyle = css(cl, 0.32 + 0.25 * P.cloudAmt);
        g.beginPath();
        g.ellipse(x, y, s * 1.6, s * 0.42, 0, 0, TAU);
        g.ellipse(x - s * 0.6, y - s * 0.25, s * 0.7, s * 0.45, 0, 0, TAU);
        g.ellipse(x + s * 0.4, y - s * 0.35, s * 0.85, s * 0.55, 0, 0, TAU);
        g.fill();
      }
    }
    function drawFar() {
      const base = H * P.horizon;
      const par = 0.1;
      const cw = TW * 0.55;
      const off = cam.x * par;
      const c0 = Math.floor((off - W * 0.6) / cw) - 2, c1 = Math.floor((off + W * 0.6) / cw) + 2;
      const amt = P.skyline;
      if (amt < 0.02) return;
      // far layer (palest)
      for (let pass = 0; pass < 2; pass++) {
        const col = pass === 0 ? mixC(P.c.far2, P.c.haze, 0.35) : P.c.far;
        g.fillStyle = css(col, amt);
        const yb = base + (pass === 0 ? -TW * 0.2 : TW * 0.35);
        g.beginPath();
        g.moveTo(-10, H);
        for (let c = c0; c <= c1; c++) {
          const x = c * cw - off + W * 0.5;
          const hh = hash2(c, pass, 31);
          let top = yb - TW * (0.35 + hh * (pass === 0 ? 1.7 : 1.1));
          const kind = hash2(c, pass + 3, 31);
          g.lineTo(x, yb);
          if (kind < 0.12) { // dome
            g.lineTo(x, top + TW * 0.25); g.quadraticCurveTo(x + cw * 0.5, top - TW * 0.35, x + cw, top + TW * 0.25); g.lineTo(x + cw, yb);
          } else if (kind < 0.24) { // spire tower
            g.lineTo(x + cw * 0.2, top); g.lineTo(x + cw * 0.5, top - TW * 0.5); g.lineTo(x + cw * 0.8, top); g.lineTo(x + cw * 0.8, yb);
          } else if (kind < 0.4) { // cypress
            g.lineTo(x + cw * 0.3, yb - TW * 0.1); g.quadraticCurveTo(x + cw * 0.5, top - TW * 0.4, x + cw * 0.7, yb - TW * 0.1); g.lineTo(x + cw, yb);
          } else {
            g.lineTo(x, top); g.lineTo(x + cw * 0.92, top); g.lineTo(x + cw * 0.92, yb); g.lineTo(x + cw, yb);
          }
        }
        g.lineTo(W + 10, H); g.closePath(); g.fill();
      }
    }
    function drawMid() {
      const base = H * (P.horizon + 0.12);
      const par = 0.28;
      const cw = TW * 1.25;
      const off = cam.x * par;
      const c0 = Math.floor((off - W * 0.6) / cw) - 2, c1 = Math.floor((off + W * 0.6) / cw) + 2;
      const cityAmt = clamp(1 - P.waterAmt * 0.7 - P.cloudAmt, 0, 1);
      const midL = mixC(P.c.mid, P.c.haze, 0.45), midR = mixC(P.c.midR, P.c.haze, 0.45), midT = mixC(P.c.towerTop, P.c.haze, 0.4);
      for (let c = c0; c <= c1; c++) {
        const hh = hash2(c, 11, 5);
        if (hh < 0.18) continue;
        const x = c * cw - off + W * 0.5;
        const w = cw * (0.55 + 0.35 * hash2(c, 12, 5));
        const top = base - TW * (0.6 + 2.6 * hash2(c, 13, 5));
        const side = w * 0.4;
        const bob = P.floatAmt * Math.sin(clock * 0.6 + c) * TW * 0.08;
        if (cityAmt > 0.02) {
          g.fillStyle = css(midL, cityAmt);
          g.fillRect(x, top + bob, w, H - top);
          g.fillStyle = css(midR, cityAmt);
          g.beginPath(); g.moveTo(x + w, top + bob); g.lineTo(x + w + side, top - side * 0.5 + bob); g.lineTo(x + w + side, H); g.lineTo(x + w, H); g.closePath(); g.fill();
          g.fillStyle = css(midT, cityAmt);
          g.beginPath(); g.moveTo(x, top + bob); g.lineTo(x + side, top - side * 0.5 + bob); g.lineTo(x + w + side, top - side * 0.5 + bob); g.lineTo(x + w, top + bob); g.closePath(); g.fill();
          // windows / arches
          const rows = Math.min(6, Math.floor((H - top) / (TW * 0.5)));
          for (let rI = 0; rI < rows; rI++) for (let q = 0; q < 2; q++) {
            const wx0 = x + w * (0.22 + q * 0.38), wy0 = top + bob + TW * (0.3 + rI * 0.5);
            const lit = hash2(c * 7 + q, rI, 17) < P.lights * 0.55;
            g.fillStyle = lit ? css(P.c.window, 0.75 * cityAmt) : css(mixC(P.c.arch, P.c.haze, 0.55), 0.55 * cityAmt);
            g.beginPath(); g.moveTo(wx0, wy0 + TW * 0.22); g.lineTo(wx0, wy0 + TW * 0.06); g.arc(wx0 + w * 0.09, wy0 + TW * 0.06, w * 0.09, Math.PI, 0); g.lineTo(wx0 + w * 0.18, wy0 + TW * 0.22); g.closePath(); g.fill();
          }
          if (hash2(c, 14, 5) < 0.35 * (1 - P.lights)) { // rooftop tree
            g.fillStyle = css(mixC(P.c.leaf, P.c.haze, 0.45), cityAmt);
            g.beginPath(); g.arc(x + w * 0.5, top + bob - TW * 0.2, TW * 0.26, 0, TAU); g.fill();
          }
        }
        if (P.floatAmt > 0.02 && hash2(c, 15, 5) < 0.4) { // floating fragments in the cloud world
          const fy = base - TW * (1.6 + 2.2 * hash2(c, 16, 5)) + Math.sin(clock * 0.7 + c * 1.3) * TW * 0.12;
          const fw = TW * (0.35 + 0.4 * hash2(c, 17, 5));
          g.fillStyle = css(mixC(P.c.wallL, P.c.haze, 0.35), P.floatAmt);
          g.fillRect(x, fy, fw, fw * 0.55);
          g.fillStyle = css(mixC(P.c.wallR, P.c.haze, 0.35), P.floatAmt);
          g.beginPath(); g.moveTo(x + fw, fy); g.lineTo(x + fw * 1.35, fy - fw * 0.18); g.lineTo(x + fw * 1.35, fy + fw * 0.37); g.lineTo(x + fw, fy + fw * 0.55); g.fill();
          g.fillStyle = css(mixC(P.c.leaf2, P.c.haze, 0.3), P.floatAmt);
          g.beginPath(); g.moveTo(x, fy); g.lineTo(x + fw * 0.35, fy - fw * 0.18); g.lineTo(x + fw * 1.35, fy - fw * 0.18); g.lineTo(x + fw, fy); g.closePath(); g.fill();
        }
      }
      // atmospheric haze over the distance
      const hz = g.createLinearGradient(0, base - TW * 2, 0, H);
      hz.addColorStop(0, css(P.c.haze, 0)); hz.addColorStop(0.55, css(P.c.fog, 0.55)); hz.addColorStop(1, css(P.c.fog, 0.92));
      g.fillStyle = hz; g.fillRect(0, base - TW * 2, W, H - base + TW * 2);
    }
    // world-space point → screen, inverse for ground planes
    function screenToWorld(px, py, z) {
      const X = px + cam.x - W * 0.5, Y = py + cam.y - H * CAM_ANCHOR_Y + z * ZPX;
      const a = X / HW, b = Y / HH;
      return [(a + b) / 2, (b - a) / 2];
    }
    function drawGroundPlanes() {
      // water gardens: a still water plane just below the walkway
      if (P.waterAmt > 0.02) {
        const zw = -P.drop;
        const top = Math.max(0, H * (P.horizon + 0.05));
        const wg = g.createLinearGradient(0, top, 0, H);
        wg.addColorStop(0, css(P.c.water2, 0)); wg.addColorStop(0.18, css(P.c.water2, P.waterAmt * 0.85)); wg.addColorStop(1, css(P.c.water, P.waterAmt));
        g.fillStyle = wg; g.fillRect(0, top, W, H - top);
        const c0 = screenToWorld(0, top, zw), c1 = screenToWorld(W, top, zw), c2 = screenToWorld(0, H, zw), c3 = screenToWorld(W, H, zw);
        const minX = Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0])) - 1, maxX = Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0])) + 1;
        const minY = Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1])) - 1, maxY = Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1])) + 1;
        for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
          const hh = hash2(x, y, 77);
          if (hh > 0.16) continue;
          const t = tileAt(x, y);
          if (t && PATHLIKE[t.kind]) continue;
          const wx = x + 0.5 + (hash2(x, y, 78) - 0.5) * 0.6, wy = y + 0.5 + (hash2(x, y, 79) - 0.5) * 0.6;
          const px = sx(wx, wy), py = sy(wx, wy, zw);
          if (px < -TW || px > W + TW || py < top || py > H + TW) continue;
          if (hh < 0.11) { // lily pad
            const r = TW * (0.16 + hh * 1.2);
            g.fillStyle = css(mixC(P.c.leaf2, P.c.water2, 0.25), P.waterAmt);
            g.beginPath(); g.ellipse(px, py, r, r * 0.5, 0, 0.35, TAU - 0.05); g.lineTo(px, py); g.closePath(); g.fill();
            if (hh < 0.03) { g.fillStyle = css(hex("#f0b9c3"), P.waterAmt); g.beginPath(); g.arc(px + r * 0.2, py - r * 0.18, r * 0.22, 0, TAU); g.fill(); }
          } else { // ripple
            const ph = (clock * 0.35 + hh * 13) % 1;
            g.strokeStyle = css(P.c.water2, P.waterAmt * (1 - ph) * 0.7);
            g.lineWidth = 1.2 * K;
            g.beginPath(); g.ellipse(px, py, TW * 0.5 * ph + 2, (TW * 0.5 * ph + 2) * 0.5, 0, 0, TAU); g.stroke();
          }
        }
      }
      // cloud world: a sea of slow cloud below the walkways
      if (P.cloudAmt > 0.02) {
        const zc = -P.drop - 0.6;
        const top = H * (P.horizon - 0.02);
        const cg = g.createLinearGradient(0, top, 0, H);
        cg.addColorStop(0, css(P.c.cloud, 0)); cg.addColorStop(0.3, css(P.c.cloud, 0.55 * P.cloudAmt)); cg.addColorStop(1, css(P.c.cloud, 0.95 * P.cloudAmt));
        g.fillStyle = cg; g.fillRect(0, top, W, H - top);
        const cell = 3;
        const c0 = screenToWorld(0, top, zc), c3 = screenToWorld(W, H, zc), c1 = screenToWorld(W, top, zc), c2 = screenToWorld(0, H, zc);
        const minX = Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0]) / cell) - 1, maxX = Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0]) / cell) + 1;
        const minY = Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1]) / cell) - 1, maxY = Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1]) / cell) + 1;
        const drift = clock * 0.12;
        const shade = mixC(P.c.cloud, P.c.sky0, 0.28);
        for (let i = minX; i <= maxX; i++) for (let j = minY; j <= maxY; j++) {
          if (hash2(i, j, 91) > 0.55) continue;
          const wx = i * cell + hash2(i, j, 92) * cell + drift, wy = j * cell + hash2(i, j, 93) * cell - drift * 0.4;
          const px = sx(wx, wy), py = sy(wx, wy, zc);
          if (px < -TW * 2 || px > W + TW * 2 || py < top - TW || py > H + TW) continue;
          const s = TW * (0.45 + 0.5 * hash2(i, j, 94));
          g.fillStyle = css(shade, P.cloudAmt * 0.9);
          g.beginPath(); g.ellipse(px, py + s * 0.18, s * 1.5, s * 0.5, 0, 0, TAU); g.fill();
          g.fillStyle = css(P.c.cloud, P.cloudAmt);
          g.beginPath();
          g.ellipse(px, py, s * 1.4, s * 0.45, 0, 0, TAU);
          g.arc(px - s * 0.5, py - s * 0.15, s * 0.45, 0, TAU);
          g.arc(px + s * 0.3, py - s * 0.3, s * 0.55, 0, TAU);
          g.fill();
        }
      }
    }

    // --- tiles: path walls and tops (painter's order, back to front)
    function tileLift(t) {
      let z = 0, fade = 0, shake = 0;
      const ahead = t.d - run.frontD;
      if (ahead > 0) { fade = clamp((ahead - 2) / 30, 0, 0.38); }   // the path ahead stays level: no steps, just distance haze
      const behind = run.backD - t.d;
      if (behind > 0) { const k = smooth(clamp(behind / 2.4, 0, 1)); z -= k * 1.9; fade = Math.max(fade, 0.15 + k * 0.7); }
      else if (behind > -1.4 && run.state !== "title") shake = (1.4 + behind) / 1.4;
      return { z, fade, shake };
    }
    function faceL(x, y, z, depth, style) { // face along edge (x,y+1)→(x+1,y+1), facing the viewer's left
      const ox = sx(x, y + 1), oy = sy(x, y + 1, z);
      setT(HW, HH, 0, ZPX, ox, oy);
      g.fillStyle = style; g.fillRect(0, 0, 1, depth);
    }
    function faceR(x, y, z, depth, style) { // face along edge (x+1,y+1)→(x+1,y)
      const ox = sx(x + 1, y + 1), oy = sy(x + 1, y + 1, z);
      setT(HW, -HH, 0, ZPX, ox, oy);
      g.fillStyle = style; g.fillRect(0, 0, 1, depth);
    }
    function faceDetails(t, depth, onLeft) {
      // assumes transform is already set for the face; draws arches or windows in face space
      const hA = hash2(t.x, t.y, onLeft ? 41 : 42);
      const par = onLeft ? (t.x & 1) : (t.y & 1);
      if (depth > 1.4 && par === 0 && hA < P.archAmt) {
        g.fillStyle = gradCache.gA;
        g.beginPath(); g.moveTo(0.2, depth); g.lineTo(0.2, 1.1); g.ellipse(0.5, 1.1, 0.3, 0.42, 0, Math.PI, 0); g.lineTo(0.8, depth); g.closePath(); g.fill();
      } else if (depth > 1.1 && hA < P.windowAmt) {
        for (let r = 0; r < 4; r++) {
          const v = 0.55 + r * 1.05;
          if (v + 0.5 > depth * 0.8) break;
          const lit = hash2(t.x * 3 + r, t.y, onLeft ? 51 : 52) < P.lights * 0.6;
          const a = clamp(1 - v / depth, 0.15, 1);
          g.fillStyle = lit ? css(P.c.window, 0.9 * a) : css(mixC(P.c.arch, P.c.fog, v / depth * 0.8), 0.85);
          g.beginPath(); g.moveTo(0.36, v + 0.48); g.lineTo(0.36, v + 0.12); g.ellipse(0.5, v + 0.12, 0.14, 0.12, 0, Math.PI, 0); g.lineTo(0.64, v + 0.48); g.closePath(); g.fill();
        }
      }
    }
    function topPath(x, y, z, inset) {
      const i = inset || 0;
      g.beginPath();
      g.moveTo(sx(x + i, y + i), sy(x + i, y + i, z));
      g.lineTo(sx(x + 1 - i, y + i), sy(x + 1 - i, y + i, z));
      g.lineTo(sx(x + 1 - i, y + 1 - i), sy(x + 1 - i, y + 1 - i, z));
      g.lineTo(sx(x + i, y + 1 - i), sy(x + i, y + 1 - i, z));
      g.closePath();
    }
    function hullPath(x, y, z, depth) {
      const zb = z - depth;
      g.beginPath();
      g.moveTo(sx(x, y), sy(x, y, z));
      g.lineTo(sx(x + 1, y), sy(x + 1, y, z));
      g.lineTo(sx(x + 1, y), sy(x + 1, y, zb));
      g.lineTo(sx(x + 1, y + 1), sy(x + 1, y + 1, zb));
      g.lineTo(sx(x, y + 1), sy(x, y + 1, zb));
      g.lineTo(sx(x, y + 1), sy(x, y + 1, z));
      g.closePath();
    }
    function frontNeighbourCovers(x, y, z) {
      const n = tileAt(x, y);
      if (!n) return false;
      if (n.kind === "tower") return true;
      return PATHLIKE[n.kind] && n._z >= z - 0.01;
    }
    function drawTileBase(t) {
      const z = t._z;
      const isBridge = t.kind === "bridge";
      const depth = isBridge ? 0.42 : P.drop + (t.kind === "tower" ? 0 : 0) + 1.9;
      const shakeY = t._shake ? Math.sin(clock * 38 + t.h * 40) * 0.035 * t._shake : 0;
      const zz = z + shakeY;
      const coverL = frontNeighbourCovers(t.x, t.y + 1, zz);
      const coverR = frontNeighbourCovers(t.x + 1, t.y, zz);
      if (isBridge) {
        if (!coverL) { faceL(t.x, t.y, zz, depth, P.s.wallR); }
        if (!coverR) { faceR(t.x, t.y, zz, depth, P.s.wallR); }
        if (!coverL && (t.x & 1) === 0) { // bridge arch beneath
          faceL(t.x, t.y, zz - depth, 0.9, css(mixC(P.c.wallL, P.c.fog, 0.25)));
        }
      } else {
        if (!coverL) { faceL(t.x, t.y, zz, depth, gradCache.gL); faceDetails(t, depth, true); }
        if (!coverR) { faceR(t.x, t.y, zz, depth, gradCache.gR); faceDetails(t, depth, false); }
      }
      resetT();
      if (t.kind === "tower") {
        // only the part below walkway level is drawn here; the rest is an entity
        return;
      }
      // top slab
      const stepStone = t.st === 2 && t.kind !== "plaza";
      let top = (t.h < 0.5 ? P.c.path : P.c.path2);
      if (t.kind === "plaza") top = mixC(P.c.path, [255, 250, 240], 0.18);
      g.fillStyle = css(top);
      topPath(t.x, t.y, zz, stepStone ? 0.035 : 0);
      g.fill();
      g.strokeStyle = css(P.c.grout, 0.55);
      g.lineWidth = Math.max(0.8, 0.9 * K);
      g.stroke();
      if (t.kind === "plaza" && ((t.x + t.y) & 1) === 0) {
        g.fillStyle = css(P.c.grout, 0.12); topPath(t.x, t.y, zz, 0.18); g.fill();
      }
      if (t._fade > 0.01) {
        g.fillStyle = css(t.d > run.frontD ? P.c.haze : P.c.fog, t._fade);
        hullPath(t.x, t.y, zz, Math.min(depth, 2.2));
        g.fill();
      }
      if (t._shake > 0.05) { // the past is starting to let go
        g.fillStyle = css(P.c.shadow, 0.12 * t._shake);
        topPath(t.x, t.y, zz, 0.06); g.fill();
      }
    }

    // --- entities: towers, planters, trees, lamps, runners (depth sorted)
    function drawTowerUpper(t, alphaMul) {
      const x = t.x, y = t.y, z0 = t._z, z1 = t._z + t.H;
      g.globalAlpha = alphaMul;
      const tl = t.st === 2 ? mixC(P.c.wallL, P.c.towerTop, 0.3) : P.c.wallL;
      const tr = t.st === 2 ? mixC(P.c.wallR, P.c.towerTop, 0.2) : P.c.wallR;
      // left face
      setT(HW, HH, 0, -ZPX, sx(x, y + 1), sy(x, y + 1, z0));
      g.fillStyle = css(tl); g.fillRect(0, 0, 1, t.H);
      towerFaceDetail(t, true);
      setT(HW, -HH, 0, -ZPX, sx(x + 1, y + 1), sy(x + 1, y + 1, z0));
      g.fillStyle = css(tr); g.fillRect(0, 0, 1, t.H);
      towerFaceDetail(t, false);
      resetT();
      g.fillStyle = P.s.towerTop;
      topPath(x, y, z1, 0); g.fill();
      g.strokeStyle = css(mixC(P.c.towerTop, [255, 255, 255], 0.35), 0.7); g.lineWidth = 1.2 * K; g.stroke();
      const cx = sx(x + 0.5, y + 0.5), cy = sy(x + 0.5, y + 0.5, z1);
      drawTopDecor(t.top, cx, cy, t.h, 1);
      g.globalAlpha = 1;
    }
    function towerFaceDetail(t, onLeft) {
      // face space: u along edge 0..1, v up 0..H
      const H2 = t.H;
      const hA = hash2(t.x, t.y, onLeft ? 61 : 62);
      if (P.windowAmt > 0.3 || t.st === 1 || t.st === 3) {
        for (let r = 0; r < 3; r++) {
          const v = 0.35 + r * 0.75;
          if (v + 0.45 > H2) break;
          const lit = hash2(t.x + r, t.y * 3, onLeft ? 63 : 64) < P.lights * 0.7;
          g.fillStyle = lit ? css(P.c.window, 0.95) : css(mixC(P.c.arch, P.c.wallR, 0.3), 0.8);
          g.beginPath(); g.moveTo(0.38, v); g.lineTo(0.38, v + 0.28); g.ellipse(0.5, v + 0.28, 0.12, 0.1, 0, Math.PI, 0, true); g.lineTo(0.62, v); g.closePath(); g.fill();
        }
      } else if (onLeft && hA < 0.6 && H2 > 0.7) {
        g.fillStyle = css(P.c.arch, 0.9);
        g.beginPath(); g.moveTo(0.3, 0); g.lineTo(0.3, 0.45); g.ellipse(0.5, 0.45, 0.2, 0.2, 0, Math.PI, 0, true); g.lineTo(0.7, 0); g.closePath(); g.fill();
      }
    }
    function drawTree(cx, cy, s, kind, alpha) {
      const k = K * s;
      g.globalAlpha = alpha;
      if (kind === "cypress") {
        const h = 46 * k, w = 9 * k;
        g.fillStyle = P.s.cypress;
        g.beginPath(); g.moveTo(cx, cy - h); g.quadraticCurveTo(cx + w * 1.25, cy - h * 0.45, cx + w * 0.5, cy - 2 * k); g.lineTo(cx - w * 0.5, cy - 2 * k); g.quadraticCurveTo(cx - w * 1.25, cy - h * 0.45, cx, cy - h); g.fill();
        g.fillStyle = css(P.c.leaf2, 0.55);
        g.beginPath(); g.moveTo(cx - 1 * k, cy - h + 3 * k); g.quadraticCurveTo(cx - w * 1.05, cy - h * 0.45, cx - w * 0.45, cy - 4 * k); g.lineTo(cx - 1 * k, cy - 6 * k); g.closePath(); g.fill();
      } else {
        const sway = Math.sin(clock * 1.3 + cx * 0.05) * 1.2 * k * P.wind;
        g.strokeStyle = P.s.trunk; g.lineWidth = 2.6 * k; g.lineCap = "round";
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sway * 0.3, cy - 14 * k); g.stroke();
        g.fillStyle = P.s.leaf;
        g.beginPath();
        g.arc(cx + sway - 6 * k, cy - 18 * k, 8 * k, 0, TAU);
        g.arc(cx + sway + 6 * k, cy - 19 * k, 8.5 * k, 0, TAU);
        g.arc(cx + sway, cy - 27 * k, 9.5 * k, 0, TAU);
        g.fill();
        g.fillStyle = P.s.leaf2;
        g.beginPath();
        g.arc(cx + sway - 4 * k, cy - 29 * k, 6 * k, 0, TAU);
        g.arc(cx + sway - 8 * k, cy - 21 * k, 4.6 * k, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    function drawPot(cx, cy, k, h) {
      g.fillStyle = css(mixC(P.c.wallL, P.c.arch, 0.15));
      g.beginPath(); g.moveTo(cx - 5 * k, cy - 8 * k); g.lineTo(cx + 5 * k, cy - 8 * k); g.lineTo(cx + 3.6 * k, cy); g.lineTo(cx - 3.6 * k, cy); g.closePath(); g.fill();
      g.fillStyle = css(mixC(P.c.wallR, P.c.arch, 0.2)); g.fillRect(cx - 5.4 * k, cy - 9.5 * k, 10.8 * k, 2 * k);
      g.fillStyle = P.s.leaf;
      g.beginPath(); g.arc(cx, cy - 13 * k, 6 * k, 0, TAU); g.fill();
      g.fillStyle = P.s.leaf2;
      g.beginPath(); g.arc(cx - 2 * k, cy - 15 * k, 3.4 * k, 0, TAU); g.fill();
      if (h < 0.3) { g.fillStyle = "rgba(240,150,160,0.9)"; g.beginPath(); g.arc(cx + 2.5 * k, cy - 15 * k, 1.6 * k, 0, TAU); g.fill(); }
    }
    function drawTopDecor(type, cx, cy, h, alpha) {
      const k = K;
      if (type === "tree") drawTree(cx, cy, 0.95, h < 0.35 ? "cypress" : "round", alpha);
      else if (type === "pots") { drawPot(cx - 7 * k, cy + 1 * k, k * 0.85, h); drawPot(cx + 6 * k, cy - 2 * k, k * 0.7, 1); }
      else if (type === "bush") { g.fillStyle = P.s.leaf; g.beginPath(); g.ellipse(cx, cy - 4 * k, 12 * k, 6 * k, 0, 0, TAU); g.fill(); g.fillStyle = P.s.leaf2; g.beginPath(); g.ellipse(cx - 3 * k, cy - 6 * k, 6 * k, 3 * k, 0, 0, TAU); g.fill(); }
      else if (type === "tank") {
        g.strokeStyle = css(P.c.arch, 0.9); g.lineWidth = 1.4 * k;
        g.beginPath(); g.moveTo(cx - 6 * k, cy); g.lineTo(cx - 6 * k, cy - 6 * k); g.moveTo(cx + 6 * k, cy); g.lineTo(cx + 6 * k, cy - 6 * k); g.stroke();
        g.fillStyle = css(mixC(P.c.trunk, P.c.wallL, 0.35)); g.fillRect(cx - 8 * k, cy - 20 * k, 16 * k, 14 * k);
        g.fillStyle = css(mixC(P.c.trunk, P.c.wallR, 0.2)); g.fillRect(cx + 1 * k, cy - 20 * k, 7 * k, 14 * k);
        g.fillStyle = css(mixC(P.c.trunk, P.c.towerTop, 0.4)); g.beginPath(); g.ellipse(cx, cy - 20 * k, 8 * k, 3 * k, 0, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(cx - 8 * k, cy - 21 * k); g.lineTo(cx, cy - 27 * k); g.lineTo(cx + 8 * k, cy - 21 * k); g.fill();
      } else if (type === "chimney") {
        g.fillStyle = P.s.wallR; g.fillRect(cx - 3 * k, cy - 14 * k, 6 * k, 14 * k);
        g.fillStyle = P.s.wallL; g.fillRect(cx - 3 * k, cy - 14 * k, 3 * k, 14 * k);
        for (let i = 0; i < 3; i++) { // smoke
          const p = ((clock * 0.35 + h * 3 + i / 3) % 1);
          g.fillStyle = css(P.c.cloud, 0.35 * (1 - p));
          g.beginPath(); g.arc(cx + p * 10 * k * (0.5 + P.wind), cy - 16 * k - p * 22 * k, (2.5 + p * 5) * k, 0, TAU); g.fill();
        }
      } else if (type === "antenna") {
        g.strokeStyle = css(P.c.arch, 0.9); g.lineWidth = 1.2 * k;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 22 * k); g.moveTo(cx - 5 * k, cy - 16 * k); g.lineTo(cx + 5 * k, cy - 16 * k); g.stroke();
        const blink = (Math.sin(clock * 2.4 + h * 9) > 0.6) ? 1 : 0.25;
        g.fillStyle = "rgba(255,120,110," + (0.85 * blink * P.lights).toFixed(3) + ")";
        g.beginPath(); g.arc(cx, cy - 22 * k, 1.8 * k, 0, TAU); g.fill();
      }
    }
    function drawHurdle(t) {
      const x = t.x, y = t.y, z0 = t._z;
      const look = t.look || "wall";
      const ins = look === "column" ? 0.24 : look === "crate" ? 0.14 : 0.1;
      const hh = look === "column" ? 0.62 : look === "crate" ? 0.48 : look === "hedge" ? 0.42 : 0.36;
      let cl, cr, ct;
      if (look === "hedge") { cl = P.c.leaf; cr = mixC(P.c.leaf, [10, 30, 20], 0.3); ct = P.c.leaf2; }
      else if (look === "crate") { cl = mixC(P.c.trunk, P.c.towerTop, 0.45); cr = mixC(P.c.trunk, P.c.wallR, 0.3); ct = mixC(P.c.trunk, P.c.towerTop, 0.65); }
      else if (look === "barrier") { cl = mixC(P.c.wallL, [230, 225, 240], 0.35); cr = mixC(P.c.wallR, [200, 195, 215], 0.3); ct = mixC(P.c.path, [255, 255, 255], 0.2); }
      else { cl = mixC(P.c.wallL, P.c.arch, 0.12); cr = mixC(P.c.wallR, P.c.arch, 0.15); ct = mixC(P.c.towerTop, P.c.wallL, 0.25); }
      setT(HW, HH, 0, -ZPX, sx(x + ins, y + 1 - ins), sy(x + ins, y + 1 - ins, z0));
      g.fillStyle = css(cl); g.fillRect(0, 0, 1 - 2 * ins, hh);
      if (look === "crate") { g.strokeStyle = css(cr, 0.8); g.lineWidth = 0.04; g.strokeRect(0.06, 0.06, 1 - 2 * ins - 0.12, hh - 0.12); g.beginPath(); g.moveTo(0.06, 0.06); g.lineTo(1 - 2 * ins - 0.06, hh - 0.06); g.stroke(); }
      if (look === "barrier") { g.fillStyle = css(P.c.window, 0.25 + 0.6 * P.lamps); g.fillRect(0, hh * 0.55, 1 - 2 * ins, hh * 0.14); }
      setT(HW, -HH, 0, -ZPX, sx(x + 1 - ins, y + 1 - ins), sy(x + 1 - ins, y + 1 - ins, z0));
      g.fillStyle = css(cr); g.fillRect(0, 0, 1 - 2 * ins, hh);
      if (look === "barrier") { g.fillStyle = css(P.c.window, 0.2 + 0.5 * P.lamps); g.fillRect(0, hh * 0.55, 1 - 2 * ins, hh * 0.14); }
      resetT();
      g.fillStyle = css(ct);
      topPath(x, y, z0 + hh, ins); g.fill();
      if (look === "hedge") {
        g.fillStyle = css(P.c.leaf2, 0.8);
        const cx = sx(x + 0.5, y + 0.5), cy = sy(x + 0.5, y + 0.5, z0 + hh);
        g.beginPath(); g.ellipse(cx - 5 * K, cy - 1 * K, 7 * K, 3.5 * K, 0, 0, TAU); g.ellipse(cx + 6 * K, cy + 1 * K, 6 * K, 3 * K, 0, 0, TAU); g.fill();
        if (t.h < 0.4) { g.fillStyle = "rgba(244,170,150,0.95)"; g.beginPath(); g.arc(cx + 2 * K, cy - 2 * K, 1.5 * K, 0, TAU); g.fill(); }
      } else if (look === "wall" || look === "column") {
        g.strokeStyle = css([255, 255, 255], 0.35); g.lineWidth = 1 * K; g.stroke();
      }
    }
    function drawPlanterBlock(t, alphaMul) {
      const x = t.x, y = t.y, z0 = t._z;
      g.globalAlpha = alphaMul;
      if (t.block === "hurdle") { drawHurdle(t); g.globalAlpha = 1; return; }
      if (t.block === "tank") {
        drawTopDecor("tank", sx(x + 0.5, y + 0.5), sy(x + 0.5, y + 0.5, z0), t.h, 1);
        g.globalAlpha = 1; return;
      }
      const hh = 0.32;
      const ins = 0.08;
      setT(HW, HH, 0, -ZPX, sx(x + ins, y + 1 - ins), sy(x + ins, y + 1 - ins, z0));
      g.fillStyle = css(mixC(P.c.wallL, P.c.towerTop, 0.15)); g.fillRect(0, 0, 1 - 2 * ins, hh);
      setT(HW, -HH, 0, -ZPX, sx(x + 1 - ins, y + 1 - ins), sy(x + 1 - ins, y + 1 - ins, z0));
      g.fillStyle = css(mixC(P.c.wallR, P.c.arch, 0.1)); g.fillRect(0, 0, 1 - 2 * ins, hh);
      resetT();
      g.fillStyle = css(mixC(P.c.trunk, P.c.leaf, 0.3));
      topPath(x, y, z0 + hh, ins); g.fill();
      const cx = sx(x + 0.5, y + 0.5), cy = sy(x + 0.5, y + 0.5, z0 + hh);
      if (t.block === "treeplanter") drawTree(cx, cy, 1.15, "round", 1);
      else {
        g.fillStyle = P.s.leaf;
        g.beginPath(); g.ellipse(cx - 6 * K, cy - 4 * K, 8 * K, 5 * K, 0, 0, TAU); g.ellipse(cx + 6 * K, cy - 3 * K, 8 * K, 5 * K, 0, 0, TAU); g.fill();
        g.fillStyle = P.s.leaf2;
        g.beginPath(); g.ellipse(cx - 4 * K, cy - 7 * K, 5 * K, 3 * K, 0, 0, TAU); g.fill();
        if (t.h < 0.5) { g.fillStyle = "rgba(244,170,150,0.95)"; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx + (i - 1) * 5 * K, cy - 6 * K - (i & 1) * 2 * K, 1.5 * K, 0, TAU); g.fill(); } }
      }
      g.globalAlpha = 1;
    }
    function drawLamp(o, alphaMul) {
      const z = 0;
      const cx = sx(o.x, o.y), cy = sy(o.x, o.y, z);
      const k = K;
      g.globalAlpha = alphaMul;
      g.strokeStyle = css(mixC(P.c.arch, [20, 20, 30], 0.4)); g.lineWidth = 1.6 * k;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 30 * k); g.lineTo(cx + 4 * k, cy - 32 * k); g.stroke();
      const lit = clamp(P.lamps, 0, 1);
      const fl = 0.9 + 0.1 * Math.sin(clock * 17 + o.x * 3) * (hash2(o.x | 0, o.y | 0, 3) < 0.2 ? 1 : 0);
      g.fillStyle = css(mixC([60, 55, 70], P.c.window, lit * fl));
      g.fillRect(cx + 2 * k, cy - 34 * k, 4.5 * k, 5 * k);
      if (lit > 0.05) {
        const rg = g.createRadialGradient(cx + 4 * k, cy - 31 * k, 0, cx + 4 * k, cy - 31 * k, 30 * k);
        rg.addColorStop(0, css(P.c.window, 0.45 * lit * fl)); rg.addColorStop(1, css(P.c.window, 0));
        g.fillStyle = rg; g.fillRect(cx - 26 * k, cy - 61 * k, 60 * k, 60 * k);
        g.fillStyle = css(P.c.window, 0.12 * lit);
        g.beginPath(); g.ellipse(cx + 2 * k, cy + 2 * k, 22 * k, 9 * k, 0, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    function drawReeds(cx, cy, s, lily) {
      const k = K * s;
      if (lily) {
        g.fillStyle = P.s.leaf2; g.beginPath(); g.ellipse(cx, cy, 9 * k, 4 * k, 0, 0.3, TAU - 0.1); g.lineTo(cx, cy); g.fill();
        g.fillStyle = "#f2c2c8"; g.beginPath(); g.arc(cx + 2 * k, cy - 2 * k, 2.2 * k, 0, TAU); g.fill();
        return;
      }
      g.strokeStyle = P.s.leaf; g.lineWidth = 1.5 * k; g.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const bx = cx + (i - 2.5) * 2.6 * k, sw = Math.sin(clock * 1.1 + i + cx * 0.1) * 2 * k * P.wind;
        g.beginPath(); g.moveTo(bx, cy); g.quadraticCurveTo(bx + sw * 0.5, cy - 9 * k, bx + sw, cy - (14 + (i % 3) * 4) * k); g.stroke();
      }
    }

    function drawDecor(o) {
      const zb = o.type === "reeds" || o.type === "lily" ? -P.drop : -P.drop - 0.2;
      const bxs = sx(o.x, o.y), bys = sy(o.x, o.y, zb);
      if (bys < -TW * 2 || bys > H + TW * 3) return;
      if (o.type === "reeds" || o.type === "lily") { if (P.waterAmt > 0.3 || o.type === "reeds") drawReeds(bxs, bys, o.s, o.type === "lily"); }
      else drawTree(bxs, bys + TW * 0.05, o.s * (0.9 + P.drop * 0.18), o.type, clamp(1 - P.cloudAmt * 1.2, 0, 1));
    }

    // --- runners: current player (solid, warm) and past selves (translucent)
    function joints(phase, moving, facing, k) {
      const s = Math.sin(phase), c = Math.cos(phase);
      const run = clamp(moving, 0, 1);
      const bounce = -Math.abs(Math.sin(phase)) * 1.3 * k * run;
      const f = facing;
      const hipY = -12.6 * k + bounce;
      const lean = 1.6 * k * run * f;
      const J = {};
      J.hip = [lean * 0.25, hipY];
      J.sh = [lean, hipY - 10.2 * k];
      J.head = [lean * 1.15 + 0.5 * k * f, hipY - 16.2 * k];
      const leg = 12.6 * k;
      const a1 = s * 0.78 * run, a2 = -s * 0.78 * run;
      J.f1 = [J.hip[0] + Math.sin(a1) * leg * f, J.hip[1] + Math.cos(a1) * leg - Math.max(0, c) * 2.4 * k * run];
      J.f2 = [J.hip[0] + Math.sin(a2) * leg * f, J.hip[1] + Math.cos(a2) * leg - Math.max(0, -c) * 2.4 * k * run];
      J.k1 = [(J.hip[0] + J.f1[0]) / 2 + 1.8 * k * f * run * Math.max(0.15, -s + 0.4), (J.hip[1] + J.f1[1]) / 2];
      J.k2 = [(J.hip[0] + J.f2[0]) / 2 + 1.8 * k * f * run * Math.max(0.15, s + 0.4), (J.hip[1] + J.f2[1]) / 2];
      const arm = 8.8 * k;
      const b1 = -s * 0.85 * run, b2 = s * 0.85 * run;
      J.h1 = [J.sh[0] + Math.sin(b1) * arm * f + 1.2 * k * f * run, J.sh[1] + Math.cos(b1) * arm - 1.5 * k * run];
      J.h2 = [J.sh[0] + Math.sin(b2) * arm * f + 1.2 * k * f * run, J.sh[1] + Math.cos(b2) * arm - 1.5 * k * run];
      J.e1 = [(J.sh[0] + J.h1[0]) / 2 - 1.2 * k * f * run, (J.sh[1] + J.h1[1]) / 2 + 0.6 * k];
      J.e2 = [(J.sh[0] + J.h2[0]) / 2 - 1.2 * k * f * run, (J.sh[1] + J.h2[1]) / 2 + 0.6 * k];
      return J;
    }
    function limb(a, b, c, w, col) {
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.stroke();
    }
    function drawShadow(px, py, k, alpha) {
      const len = 7 * k * P.shadowLen;
      g.fillStyle = css(P.c.shadow, P.shadowAlpha * alpha);
      g.beginPath(); g.ellipse(px + len * 0.55, py + 0.6 * k, 5.5 * k + len * 0.6, 2.3 * k, 0.12, 0, TAU); g.fill();
    }
    const PL = { shirt: hex("#e2643c"), shirtS: hex("#bd4d2c"), pants: hex("#2b2a35"), skin: hex("#e8b28d"), hair: hex("#2a2120") };
    function drawPlayer(px, py, alpha) {
      const k = K * 1.05;
      const J = joints(player.phase, player.moving, player.facing, k);
      g.save();
      resetT();
      g.globalAlpha = alpha;
      g.translate(px, py);
      g.lineCap = "round"; g.lineJoin = "round";
      const night = clamp(P.lights, 0, 1) * 0.22;
      const shirt = css(mixC(PL.shirt, [40, 30, 60], night)), shirtS = css(mixC(PL.shirtS, [30, 20, 50], night));
      const pants = css(PL.pants), skin = css(mixC(PL.skin, [60, 50, 80], night));
      limb(J.hip, J.k2, J.f2, 3.4 * k, css(mixC(PL.pants, [0, 0, 0], 0.25)));
      limb(J.sh, J.e2, J.h2, 2.6 * k, shirtS);
      // torso
      g.fillStyle = shirt;
      g.beginPath();
      g.moveTo(J.sh[0] - 3.9 * k, J.sh[1] - 0.6 * k); g.lineTo(J.sh[0] + 3.9 * k, J.sh[1] - 0.6 * k);
      g.lineTo(J.hip[0] + 3.4 * k, J.hip[1] + 1.2 * k); g.lineTo(J.hip[0] - 3.4 * k, J.hip[1] + 1.2 * k); g.closePath(); g.fill();
      g.fillStyle = shirtS;
      g.beginPath(); g.moveTo(J.sh[0] + 1.2 * k * player.facing, J.sh[1] - 0.4 * k); g.lineTo(J.sh[0] + 3.9 * k * player.facing, J.sh[1] - 0.6 * k);
      g.lineTo(J.hip[0] + 3.4 * k * player.facing, J.hip[1] + 1.2 * k); g.lineTo(J.hip[0] + 1.2 * k * player.facing, J.hip[1] + 1.2 * k); g.closePath(); g.fill();
      limb(J.hip, J.k1, J.f1, 3.4 * k, pants);
      limb(J.sh, J.e1, J.h1, 2.6 * k, shirt);
      g.fillStyle = skin; g.beginPath(); g.arc(J.h1[0], J.h1[1], 1.3 * k, 0, TAU); g.fill();
      // head
      g.fillStyle = skin; g.beginPath(); g.arc(J.head[0], J.head[1], 4.3 * k, 0, TAU); g.fill();
      g.fillStyle = css(PL.hair);
      g.beginPath(); g.arc(J.head[0] - 0.6 * k * player.facing, J.head[1] - 0.8 * k, 4.5 * k, Math.PI * 0.95, Math.PI * 2.08); g.closePath(); g.fill();
      g.beginPath(); g.arc(J.head[0] - 2.2 * k * player.facing, J.head[1] - 0.2 * k, 3 * k, 0, TAU); g.fill();
      g.restore();
    }
    function capsule(p, a, b, r) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-4;
      const nx = -dy / len * r, ny = dx / len * r;
      const q = [a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny];
      let area = 0;
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1]; }
      if (area >= 0) { p.moveTo(q[0], q[1]); p.lineTo(q[2], q[3]); p.lineTo(q[4], q[5]); p.lineTo(q[6], q[7]); }
      else { p.moveTo(q[6], q[7]); p.lineTo(q[4], q[5]); p.lineTo(q[2], q[3]); p.lineTo(q[0], q[1]); }
      p.closePath();
      p.moveTo(a[0] + r, a[1]); p.arc(a[0], a[1], r, 0, TAU);
      p.moveTo(b[0] + r, b[1]); p.arc(b[0], b[1], r, 0, TAU);
    }
    // A past self is one unioned silhouette, so translucency never double-darkens.
    function echoPath(J, k, abstract) {
      const p = new Path2D();
      const lw = (abstract ? 2.2 : 1.7) * k, aw = (abstract ? 1.6 : 1.3) * k;
      capsule(p, J.hip, J.k1, lw); capsule(p, J.k1, J.f1, lw);
      capsule(p, J.hip, J.k2, lw); capsule(p, J.k2, J.f2, lw);
      if (!abstract) { capsule(p, J.sh, J.e1, aw); capsule(p, J.e1, J.h1, aw); capsule(p, J.sh, J.e2, aw); capsule(p, J.e2, J.h2, aw); }
      p.moveTo(J.sh[0] - 3.9 * k, J.sh[1] - 0.6 * k); p.lineTo(J.sh[0] + 3.9 * k, J.sh[1] - 0.6 * k);
      p.lineTo(J.hip[0] + 3.4 * k, J.hip[1] + 1.2 * k); p.lineTo(J.hip[0] - 3.4 * k, J.hip[1] + 1.2 * k); p.closePath();
      p.moveTo(J.head[0] + 4.3 * k, J.head[1]); p.arc(J.head[0], J.head[1], 4.3 * k, 0, TAU);
      return p;
    }
    function drawEcho(e, px, py) {
      const k = K * 1.05;
      const idx = e.k;
      const age = idx / 6;
      const base = CFG.ECHO_OPACITY * lerp(1, 0.48, age) * e.vis;
      if (base < 0.01) return;
      // On pale walkways, deepen the tint so the past stays readable without turning spooky.
      const bgL = lum(P.c.path);
      const tint = mixC(mixC(ECHO_TINT[idx], P.c.fog, 0.08), [118, 134, 178], clamp((bgL - 0.72) * 2.2, 0, 0.5));
      const edge = mixC(tint, [70, 82, 120], 0.45);
      g.save(); resetT();
      g.translate(px, py);
      // afterimage fragments trailing behind (time fading)
      const delay = CFG.ECHO_DELAYS[idx];
      const tNow = run.state === "dying" ? Math.min(run.t + run.deathT, (timeBuffer.newest() || { t: 0 }).t + delay) : run.t;
      for (let f = 2; f >= 1; f--) {
        const s = timeBuffer.sample(tNow - delay - f * 0.075, tmpS);
        if (!s) continue;
        const ox = sx(s.x, s.y) - px, oy = sy(s.x, s.y, 0) - sy(e.x, e.y, 0);
        if (Math.abs(ox) + Math.abs(oy) < 0.5) continue;
        const J2 = joints(s.phase, s.moving, s.facing, k);
        g.save(); g.translate(ox, oy);
        g.fillStyle = css(tint, base * (f === 1 ? 0.28 : 0.14));
        g.fill(echoPath(J2, k, idx >= 3));
        g.restore();
      }
      const J = joints(e.phase, e.moving, e.facing, k);
      const body = echoPath(J, k, idx >= 3);
      g.save(); g.translate(0.7 * k, 0.9 * k);
      g.fillStyle = css(edge, base * 0.32);
      g.fill(body);
      g.restore();
      g.fillStyle = css(tint, base);
      g.fill(body);
      // a soft highlight on head & shoulders keeps the 1–2s echoes human-readable
      if (idx < 3) {
        g.fillStyle = css([255, 255, 255], base * 0.28);
        g.beginPath(); g.arc(J.head[0] - 1 * k * e.facing, J.head[1] - 1.2 * k, 2.4 * k, 0, TAU); g.fill();
      }
      g.restore();
    }
    // faint trace of the route the past selves are about to walk
    function drawTrail() {
      if (run.state !== "run" && run.state !== "dying") return;
      const n = run.echoCount;
      if (!n || !timeBuffer.count) return;
      const maxDelay = CFG.ECHO_DELAYS[n - 1];
      const tEnd = run.t - 0.1, tStart = Math.max(0, run.t - maxDelay - 0.15);
      if (tEnd - tStart < 0.2) return;
      g.lineCap = "round"; g.lineJoin = "round";
      g.lineWidth = 2.2 * K;
      const steps = Math.ceil((tEnd - tStart) * 20);
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const tq = tStart + (tEnd - tStart) * (i / steps);
        const s = timeBuffer.sample(tq, tmpS);
        if (!s) { prev = null; continue; }
        const px = sx(s.x, s.y), py = sy(s.x, s.y, 0);
        if (prev) {
          const age = (run.t - tq) / (maxDelay + 0.2);
          const a = 0.2 * (1 - age) * clamp((run.t - tq - 0.1) / 0.4, 0, 1);
          if (a > 0.005) {
            g.strokeStyle = css([255, 255, 255], a);
            g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(px, py); g.stroke();
          }
        }
        prev = [px, py];
      }
    }
    // the title screen's quiet hint of a past self
    const titleEcho = { k: 0, x: 0, y: 0, phase: 1.2, facing: 1, moving: 0.85, vis: 1 };

    // --- weather and atmosphere (screen space)
    function drawWeather() {
      resetT();
      if (P.rain > 0.02) {
        const n = Math.floor(90 * P.rain);
        g.strokeStyle = "rgba(210,220,255," + (0.28 * P.rain).toFixed(3) + ")";
        g.lineWidth = 1 * K;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const sp = 0.9 + hash2(i, 1, 44) * 0.5;
          const x = (hash2(i, 2, 44) * (W + 80) + clock * 70 * sp) % (W + 80) - 40;
          const y = (hash2(i, 3, 44) * (H + 60) + clock * 620 * sp) % (H + 60) - 30;
          g.moveTo(x, y); g.lineTo(x - 4 * K, y + 13 * K);
        }
        g.stroke();
      }
      if (P.leaves > 0.05) {
        for (let i = 0; i < 7; i++) {
          const x = (hash2(i, 5, 45) * (W + 60) + clock * (18 + 14 * hash2(i, 6, 45))) % (W + 60) - 30;
          const y = (hash2(i, 7, 45) * H + clock * (10 + 8 * hash2(i, 8, 45)) + Math.sin(clock + i) * 12) % H;
          g.fillStyle = css(i % 2 ? P.c.leaf2 : P.c.wallL, 0.55 * P.leaves);
          g.beginPath(); g.ellipse(x, y, 3 * K, 1.4 * K, clock * 2 + i, 0, TAU); g.fill();
        }
      }
      if (P.birds > 0.05) {
        g.strokeStyle = css(mixC(P.c.ink, P.c.sky0, 0.35), 0.6 * P.birds); g.lineWidth = 1.2 * K;
        for (let i = 0; i < 3; i++) {
          const per = 26 + i * 9;
          const ph = ((clock + i * 11) % per) / per;
          const x = -40 + ph * (W + 80), y = H * (0.1 + i * 0.05) + Math.sin(ph * 9 + i) * 8;
          const fl = Math.sin(clock * 9 + i * 2) * 2.4 * K;
          g.beginPath(); g.moveTo(x - 5 * K, y - fl); g.quadraticCurveTo(x - 2 * K, y - 2 * K, x, y); g.quadraticCurveTo(x + 2 * K, y - 2 * K, x + 5 * K, y - fl); g.stroke();
        }
      }
      if (P.mist > 0.03) {
        for (let i = 0; i < 4; i++) {
          const x = ((hash2(i, 9, 46) * (W + 300) + clock * 8 * (1 + i * 0.3)) % (W + 300)) - 150;
          const y = H * (0.45 + 0.15 * i);
          const rg = g.createRadialGradient(x, y, 0, x, y, TW * 3);
          rg.addColorStop(0, css(P.c.fog, 0.22 * P.mist)); rg.addColorStop(1, css(P.c.fog, 0));
          g.fillStyle = rg; g.fillRect(x - TW * 3, y - TW * 3, TW * 6, TW * 6);
        }
      }
      // proximity: the world holds its breath when the past is close
      if (run.state === "run" && run.prox < 1.4) {
        const lv = clamp(1 - (run.prox - 0.25) / 1.15, 0, 1) * 0.2;
        const vg = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
        vg.addColorStop(0, css(P.c.shadow, 0)); vg.addColorStop(1, css(P.c.shadow, lv));
        g.fillStyle = vg; g.fillRect(0, 0, W, H);
      }
      if (run.state === "dying" || run.state === "over") {
        const a = run.state === "over" ? 0.5 : clamp(run.deathT / 1.05, 0, 1) * 0.5;
        g.fillStyle = css(P.c.fog, a); g.fillRect(0, 0, W, H);
      }
      // the one-thumb stick, drawn faintly where the thumb rests
      if (stick.active && input.down && run.state === "run") {
        g.strokeStyle = css([255, 255, 255], 0.22); g.lineWidth = 1.5 * K;
        g.beginPath(); g.arc(stick.ax, stick.ay, 26 * K, 0, TAU); g.stroke();
        g.fillStyle = css([255, 255, 255], 0.25);
        g.beginPath(); g.arc(stick.ax + Math.cos(stick.dir) * 26 * K * stick.mag, stick.ay + Math.sin(stick.dir) * 26 * K * stick.mag, 6 * K, 0, TAU); g.fill();
      }
    }

    // --- main draw
    const visible = [];
    const ents = [];
    function draw() {
      S = canvas.width / Math.max(1, W);
      const e = Math.max(0, run.frontD - FRONT0) / CFG.STAGE_LENGTH + CFG.PREVIEW_ENVIRONMENT;
      computePalette(e);
      const shk = cam.shake > 0 ? cam.shake * 2.2 * K : 0;
      const savedX = cam.x, savedY = cam.y;
      if (shk) { cam.x += Math.sin(clock * 61) * shk; cam.y += Math.cos(clock * 47) * shk * 0.6; }
      drawSky();
      drawFar();
      drawMid();
      drawGroundPlanes();
      makeFaceGradients(P.drop + 1.9);

      // gather visible tiles and static scenery
      visible.length = 0; ents.length = 0;
      const marginTop = -TW * 3.2, marginBot = H + TW * 0.8;
      for (const t of world.tiles.values()) {
        const cxp = sx(t.x + 0.5, t.y + 0.5);
        if (cxp < -TW * 1.2 || cxp > W + TW * 1.2) continue;
        const lift = tileLift(t);
        t._z = lift.z; t._fade = lift.fade; t._shake = lift.shake;
        const cyp = sy(t.x + 0.5, t.y + 0.5, t._z);
        if (cyp < marginTop || cyp > marginBot) continue;
        t._key = t.x + t.y + 1;
        visible.push(t);
      }
      for (const o of world.decor) {
        if (o.type === "lamp") continue;
        const px = sx(o.x, o.y);
        if (px < -TW * 2 || px > W + TW * 2) continue;
        o._key = o.x + o.y; o._deco = true;
        visible.push(o);
      }
      // Static world in strict back-to-front order: walls, slabs, towers, planters, trees.
      visible.sort((a, b) => (a._key - b._key) || (a.x - b.x));
      for (let i = 0; i < visible.length; i++) {
        const t = visible[i];
        if (t._deco) { drawDecor(t); continue; }
        drawTileBase(t);
        if (t.kind === "tower") drawTowerUpper(t, 1 - t._fade * 0.6);
        else if (t.block) drawPlanterBlock(t, 1 - t._fade * 0.6);
      }
      resetT();
      drawTrail();

      // live entities: lamps and runners, depth sorted
      const pk = player.x + player.y;
      for (const o of world.decor) {
        if (o.type !== "lamp") continue;
        const px = sx(o.x, o.y);
        if (px < -TW * 2 || px > W + TW * 2) continue;
        ents.push({ key: o.x + o.y, kind: 3, o });
      }
      if (run.state === "title" && !run.startedOnce) ents.push({ key: titleEcho.x + titleEcho.y, kind: 5, e: titleEcho });
      for (let k = run.echoCount - 1; k >= 0; k--) { const ec = echoes[k]; if (ec.on && ec.vis > 0) ents.push({ key: ec.x + ec.y - 0.001 * (k + 1), kind: 5, e: ec }); }
      ents.push({ key: pk, kind: 4 });
      ents.sort((a, b) => a.key - b.key);
      for (const it of ents) {
        if (it.kind === 4) drawShadow(sx(player.x, player.y), sy(player.x, player.y, 0), K, player.z < -0.05 ? 0 : 1 / (1 + player.jz * 1.4));
        else if (it.kind === 5) drawShadow(sx(it.e.x, it.e.y), sy(it.e.x, it.e.y, 0), K, 0.35 * it.e.vis);
      }
      const ppx = sx(player.x, player.y), ppy = sy(player.x, player.y, player.z + player.jz);
      for (const it of ents) {
        if (it.kind === 3) {
          const o = it.o;
          const bx = sx(o.x, o.y), by = sy(o.x, o.y, 0);
          const front = it.key > pk && Math.abs(bx - ppx) < TW * 0.5 && ppy < by + TW * 0.2 && ppy > by - TW * 1.4;
          drawLamp(o, front ? 0.45 : 1);
        } else if (it.kind === 4) {
          drawPlayer(ppx, ppy, player.z < -0.05 ? clamp(1 + player.z * 0.4, 0, 1) : 1);
        } else if (it.kind === 5) {
          drawEcho(it.e, sx(it.e.x, it.e.y), sy(it.e.x, it.e.y, it.e.z || 0));
        }
      }
      resetT();
      drawWeather();
      cam.x = savedX; cam.y = savedY;
    }

    // ------------------------------------------------------------------- HUD
    const hud = ctx.createRoot({ layer: "overlay", input: "passthrough", style: "font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink,#3f5853);" });
    hud.innerHTML =
      "<style>" +
      ".osa *{box-sizing:border-box;margin:0;padding:0}" +
      ".osa{position:absolute;inset:0;pointer-events:none;-webkit-font-smoothing:antialiased}" +
      ".osa-big{font-family:'Bebas Neue','Oswald','Arial Narrow',sans-serif;font-weight:400;line-height:.9;letter-spacing:.01em;text-transform:uppercase;font-stretch:condensed}" +
      ".osa-lbl{font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;opacity:.85}" +
      ".osa-score{position:absolute;left:20px;top:18px;transition:opacity .5s}" +
      ".osa-score .osa-big{font-size:34px;margin-top:2px}" +
      ".osa-dots{display:flex;gap:5px;margin-top:7px;height:7px}" +
      ".osa-dots i{display:block;width:6px;height:6px;border-radius:50%;opacity:.9;transition:transform .4s}" +
      ".osa-pause{position:absolute;right:16px;top:16px;width:34px;height:34px;border:0;border-radius:8px;background:rgba(255,255,255,.16);" +
      "display:flex;gap:4px;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;transition:opacity .5s;-webkit-tap-highlight-color:transparent}" +
      ".osa-pause b{display:block;width:3px;height:12px;border-radius:1px;background:var(--ink,#fff)}" +
      ".osa-title{position:absolute;left:26px;top:34px;transition:opacity .9s,transform .9s}" +
      ".osa-title .osa-big{font-size:min(23vw,118px);color:var(--title,#445e59)}" +
      ".osa-tag{margin-top:18px;font-size:11px;font-weight:600;letter-spacing:.24em;line-height:1.75;color:var(--title,#445e59)}" +
      ".osa-hint{position:absolute;left:0;right:0;text-align:center;font-size:10.5px;font-weight:600;letter-spacing:.3em;opacity:.7;transition:opacity .6s}" +
      ".osa-res{position:absolute;left:28px;right:28px;top:30%;transition:opacity .5s}" +
      ".osa-res .osa-lbl{margin-top:16px}" +
      ".osa-res .osa-big.d{font-size:64px}" +
      ".osa-res .osa-big.b{font-size:38px;opacity:.85}" +
      ".osa-try{margin-top:30px;display:inline-block;font-size:12px;font-weight:600;letter-spacing:.32em;padding-bottom:6px;border-bottom:1px solid currentColor}" +
      ".osa-pz{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;transition:opacity .3s}" +
      ".osa-u{font-family:Inter,system-ui,sans-serif;font-size:.36em;font-weight:600;letter-spacing:.08em;margin-left:.28em;text-transform:none}" +
      ".osa-new{font-family:Inter,system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;margin-left:12px;vertical-align:middle;opacity:.8}" +
      ".osa-jump{position:absolute;left:22px;width:76px;height:76px;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.2);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);color:var(--ink,#fff);pointer-events:auto;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:600 9.5px Inter,system-ui,sans-serif;letter-spacing:.22em;transition:opacity .4s,transform .08s;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}" +
      ".osa-jump svg{width:22px;height:22px}" +
      ".osa-jump.on{transform:scale(.92);background:rgba(255,255,255,.34)}" +
      ".osa-hide{opacity:0 !important}" +
      "</style>" +
      "<div class='osa'>" +
      "<div class='osa-score osa-hide'><div class='osa-lbl'>Score</div><div class='osa-big' data-m>0</div><div class='osa-dots' data-dots></div></div>" +
      "<button class='osa-pause osa-hide' aria-label='Pause'><b></b><b></b></button>" +
      "<button class='osa-jump osa-hide' aria-label='Jump'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 14l6-6 6 6'/><path d='M6 19l6-6 6 6' opacity='.45'/></svg>JUMP</button>" +
      "<div class='osa-title'><div class='osa-big'>One<br>Second<br>Ago</div><div class='osa-tag'>DON’T MEET<br>YOUR PAST.</div></div>" +
      "<div class='osa-hint'>DRAG TO RUN</div>" +
      "<div class='osa-res osa-hide'><div class='osa-lbl'>Distance</div><div class='osa-big d' data-rd>0 m</div>" +
      "<div class='osa-lbl'>Best</div><div class='osa-big b' data-rb>0 m</div><div class='osa-try'>TRY AGAIN</div></div>" +
      "<div class='osa-pz osa-hide'><div class='osa-big' style='font-size:44px'>Paused</div><div class='osa-lbl'>Tap to continue</div></div>" +
      "</div>";
    const $ = (sel) => hud.querySelector(sel);
    const elScore = $(".osa-score"), elM = $("[data-m]"), elDots = $("[data-dots]"), elPause = $(".osa-pause"), elJump = $(".osa-jump");
    const elTitle = $(".osa-title"), elHint = $(".osa-hint"), elRes = $(".osa-res"), elRD = $("[data-rd]"), elRB = $("[data-rb]"), elPZ = $(".osa-pz");
    const hide = (el, h) => { if (h) el.classList.add("osa-hide"); else el.classList.remove("osa-hide"); };
    function hudShow(mode) {
      hide(elTitle, mode !== "title"); hide(elHint, mode !== "title");
      hide(elScore, mode === "title" || mode === "over"); hide(elPause, mode !== "run" && mode !== "paused"); hide(elJump, mode !== "run");
      hide(elRes, mode !== "over"); hide(elPZ, mode !== "paused");
      if (mode === "run") { elM.textContent = String(run.meters); }
    }
    function fmt(m) { return m.toLocaleString ? m.toLocaleString("en-US") : String(m); }
    function hudResult(m, best, isBest) {
      elRD.innerHTML = fmt(m) + "<span class='osa-u'>m</span>";
      elRB.innerHTML = fmt(best) + "<span class='osa-u'>m</span>" + (isBest && m > 0 ? "<span class='osa-new'>new best</span>" : "");
    }
    function hudLayout() {
      const sa = ctx.safeArea || { top: 0, bottom: 0 };
      elScore.style.top = (16 + (sa.top || 0)) + "px";
      elPause.style.top = (16 + (sa.top || 0)) + "px";
      elJump.style.bottom = Math.max(96, (sa.bottom || 0) + 78) + "px";
      elTitle.style.top = (30 + (sa.top || 0)) + "px";
      elHint.style.bottom = Math.max(110, (sa.bottom || 0) + 96) + "px";
    }
    let lastInk = "", lastDots = -1, lastM = -1;
    function hudFrame() {
      const ink = lum(P.c.sky0) > 0.55 ? css(P.c.ink) : "rgb(248,244,236)";
      const inkTitle = css(mixC(P.c.ink, [70, 95, 90], 0.3));
      const key = ink + inkTitle;
      if (key !== lastInk) { lastInk = key; hud.style.setProperty("--ink", ink); hud.style.setProperty("--title", inkTitle); }
      if (run.meters !== lastM) { lastM = run.meters; elM.textContent = fmt(run.meters); }
      if (run.echoCount !== lastDots) {
        lastDots = run.echoCount;
        let h = "";
        for (let k = 0; k < run.echoCount; k++) h += "<i style='background:" + css(ECHO_TINT[k]) + "'></i>";
        elDots.innerHTML = h;
      }
    }
    function togglePause() {
      if (run.state === "run") { run.state = "paused"; hudShow("paused"); try { ctx.platform.interact({ type: "pause" }); } catch (e) { /* ignore */ } }
      else if (run.state === "paused") { run.state = "run"; hudShow("run"); stick.active = false; }
    }
    ctx.input.activate(elPause, () => togglePause());
    ctx.listen(elJump, "pointerdown", (ev) => {
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
      requestJump();
      elJump.classList.add("on");
    });
    ctx.listen(elJump, "pointerup", () => elJump.classList.remove("on"));
    ctx.listen(elJump, "pointercancel", () => elJump.classList.remove("on"));
    ctx.listen(elJump, "pointerleave", () => elJump.classList.remove("on"));

    // ------------------------------------------------------------ MAIN LOOP
    function frame(dt) {
      clock += dt;
      readSteering();
      if (input.pressed) {
        if (run.state === "title") beginRun();
        else if (run.state === "over" && run.overT > 0.35) { beginRun(); readSteering(); }
        else if (run.state === "paused") togglePause();
        try { ctx.platform.interact({ type: "touch" }); } catch (e) { /* ignore */ }
      }
      if (run.state === "over") run.overT += dt;
      if (run.state === "title") {
        // idle breathing; the past self waits a step behind
        player.phase = 0.95; player.moving = 0.9;
        titleEcho.x = player.x + 0.15; titleEcho.y = player.y + 1.35; titleEcho.phase = 1.1; titleEcho.facing = 1;
      }
      // CAMERA: smooth follow, slight lead in the running direction
      const c = camTarget();
      const lead = run.state === "run" ? 1 : 0;
      const tx = c.x + Math.cos(player.heading) * TW * 0.5 * lead, ty = c.y + Math.sin(player.heading) * TW * 0.35 * lead;
      const a = 1 - Math.exp(-dt * CFG.CAMERA_SPEED);
      cam.x += (tx - cam.x) * a; cam.y += (ty - cam.y) * a;
      cam.shake = Math.max(0, cam.shake - dt * 1.6);
      audioFrame(dt);
      hudFrame();
    }

    // Optional test hook: only populated when a local harness passes ctx.__debug.
    if (ctx.__debug && typeof ctx.__debug === "object") ctx.__debug.api = { run, player, echoes, walkable, groundFree, requestJump, timeBuffer, CFG, world };

    // ------------------------------------------------------------------ BOOT
    layoutWorld();
    resetRun();
    run.state = "title";
    ctx.onResize(() => { layoutWorld(); hudLayout(); }, { immediate: true });
    hudLayout();
    hudShow("title");
    computePalette(CFG.PREVIEW_ENVIRONMENT);
    hudFrame();
    draw();
    try { ctx.markVisualReady && ctx.markVisualReady("first-frame"); } catch (e) { /* ignore */ }

    ctx.game.loop({
      fixedHz: 60,
      maxSubsteps: 6,
      input,
      fixedUpdate(stepMs) { if (run.state !== "paused") step(stepMs / 1000); },
      update(dtMs) { frame(Math.min(0.1, dtMs / 1000)); },
      render() { draw(); }
    });

    // fonts load in the background; text falls back gracefully until they arrive
    (async () => {
      try {
        await Promise.all([
          ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0"),
          ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" })
        ]);
      } catch (e) { /* system fallback */ }
    })();

    ctx.platform.ready();
  }
};
