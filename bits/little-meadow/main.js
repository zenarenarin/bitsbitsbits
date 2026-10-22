// LITTLE MEADOW: an endless meadow-mowing arcade Bit.
// The core (generator + simulation) is pure and DOM-free so it can be tested headlessly.
// The renderer paints the meadow into cached chunks and stamps the mown trail into them.
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Deterministic helpers
  // ---------------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const f = mulberry32(seed >>> 0);
    return {
      f,
      range(a, b) { return a + (b - a) * f(); },
      int(a, b) { return a + Math.floor(f() * (b - a + 1)); },
      chance(p) { return f() < p; },
      pick(arr) { return arr[Math.floor(f() * arr.length)]; },
      sub() { return makeRng(Math.floor(f() * 4294967295)); }
    };
  }
  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise2(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }
  function fbm(x, y, s) {
    return noise2(x, y, s) * 0.55 + noise2(x * 2.1, y * 2.1, s + 17) * 0.3 + noise2(x * 4.3, y * 4.3, s + 31) * 0.15;
  }
  // Shared lushness field: the painter makes thickets dark and clearings pale, and the
  // generator gives thickets more grass to cut, so what looks rich is worth more.
  function lushAt(x, y, seed) { return fbm(x * 0.21 + 3.1, y * 0.12, (seed % 997) + 1); }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  // ---------------------------------------------------------------------------
  // Tunable defaults (overridden by manifest.tuning knobs through ctx.tune)
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    startSpeed: 2.55,      // rows per second at the start
    maxSpeed: 5.0,         // rows per second at full ramp
    rampRows: 1200,        // difficulty-rows to reach max speed
    laneChangeRows: 0.8,   // forward distance a lane change takes
    swipePx: 22,           // horizontal travel that counts as a swipe
    bufferMs: 260,         // how long a blocked swipe waits for an opening
    flowerDensity: 1,      // multiplier on flower counts in formations
    patchFrequency: 1,     // multiplier on seed-grass patch frequency
    stoneDensity: 1,       // multiplier on stones in mixed formations
    rabbitRate: 1,         // multiplier on how often formations carry rabbits
    rabbitActivity: 1,     // how restless rabbits are
    alertRows: 4.2,        // rows ahead at which a rabbit notices the mower
    hopMs: 300,            // airborne time of a hop at the start
    reactS: 0.8,           // minimum warning (s) before a rabbit may land in the mower's path, at top tier
    narrowRate: 1,         // how often gates are one lane wide
    decisionRate: 1,       // how quickly the gaps between formations shrink
    grassPts: 1,
    densePts: 3,
    patchBonus: 25,
    maxMult: 4,
    graceMs: 1200,
    difficultyRate: 1,
    reliefEvery: 3,
    startTier: 0.3,        // formation difficulty the run starts at once the short opening is done
    lives: 3,
    seed: 0,
    debug: false,
    musicVolume: 0.5,
    sfxVolume: 0.8
  };

  const LANES = 7;
  const CELL_GRASS = 0, CELL_DENSE = 1, CELL_PATH = 2, CELL_OBST = 3;
  const MOWER_R = 0.28;   // mower collision radius (cells)
  const FLOWER_R = 0.2;   // flower base collision radius (cells)
  const CUT_R = 0.46;     // swath half width (cells)
  const NEAR_DIST = 1.18; // lateral distance that counts as a close shave
  const chargeFor = (level) => 4 + level * 3; // charges needed to climb from this rhythm level

  // ---------------------------------------------------------------------------
  // Meadow regions: palettes and botanical mixes that blend along the run
  // ---------------------------------------------------------------------------
  function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function P(o) { const out = {}; for (const k in o) out[k] = Array.isArray(o[k]) && typeof o[k][0] === "string" ? o[k].map(hex) : o[k]; return out; }
  const REGIONS = [
    P({ name: "Early Meadow",
      ground: ["#3c5739", "#57703f", "#76894f"], strokes: ["#223826", "#30472d", "#4b663b", "#6c8250", "#97a675"],
      tuft: ["#2a4430", "#4b6a3c", "#7f9663"], dense: ["#3f4f2a", "#6e7d3c", "#b9b26b", "#d8c47c"],
      cut: ["#b9bd88", "#c7c995", "#abb07b", "#879061"], path: ["#cdbf98", "#a89a76", "#8b8572"],
      border: ["#1b2e21", "#26402c", "#45603c"], flowers: { daisy: 1, buttercup: 0.05, coral: 0, blue: 0.08 },
      wind: 0.28, windAmp: 0.6, density: 0.9 }),
    P({ name: "Buttercup Field",
      ground: ["#4a5832", "#677540", "#878f58"], strokes: ["#2c3d27", "#415532", "#62733d", "#868f58", "#afb179"],
      tuft: ["#38482a", "#62703a", "#959b62"], dense: ["#53542a", "#87823b", "#d0bd70", "#e3c86c"],
      cut: ["#cbc58b", "#d7d098", "#bcb57d", "#9a925c"], path: ["#d2c39a", "#ae9f78", "#8f8770"],
      border: ["#223325", "#30452d", "#566a3b"], flowers: { daisy: 0.4, buttercup: 1, coral: 0.05, blue: 0 },
      wind: 0.35, windAmp: 0.7, density: 1 }),
    P({ name: "Deep Meadow",
      ground: ["#22382a", "#30472f", "#465e3e"], strokes: ["#14261a", "#1e3524", "#304a30", "#4b6745", "#6c8a5c"],
      tuft: ["#182e21", "#2f4c33", "#5f7c56"], dense: ["#2c3c25", "#556733", "#b2a865", "#cbb86b"],
      cut: ["#a9ae7e", "#b7bb8b", "#9aa070", "#78815a"], path: ["#b9ad8a", "#968a6c", "#7c7766"],
      border: ["#101d15", "#192b1f", "#2c442e"], flowers: { daisy: 1, buttercup: 0.1, coral: 0, blue: 0.35 },
      wind: 0.22, windAmp: 0.5, density: 1.18 }),
    P({ name: "Wind-Swept Field",
      ground: ["#465c44", "#657a56", "#8a9a72"], strokes: ["#29402f", "#41573d", "#677d56", "#92a27b", "#bdc59f"],
      tuft: ["#3b523b", "#647a56", "#9eab84"], dense: ["#4b5532", "#7c8547", "#cbbf7b", "#ddc982"],
      cut: ["#c8c69a", "#d4d2a7", "#b9b88c", "#999873"], path: ["#d0c4a0", "#aa9e7c", "#8d8875"],
      border: ["#1d3024", "#2a4230", "#4f6847"], flowers: { daisy: 0.7, buttercup: 0.45, coral: 0, blue: 0.2 },
      wind: 0.95, windAmp: 1.35, density: 0.95 }),
    P({ name: "Wildflower Patch",
      ground: ["#3e5334", "#5b7042", "#798b54"], strokes: ["#243826", "#384f30", "#58703f", "#7b8d55", "#a3ad78"],
      tuft: ["#2f442c", "#566c3b", "#899765"], dense: ["#47512b", "#7a803d", "#c8b76d", "#dcc374"],
      cut: ["#c4c18a", "#d0cc97", "#b5b27d", "#949160"], path: ["#cfc09a", "#ab9c78", "#8d8670"],
      border: ["#1d2f22", "#2a412d", "#4c643d"], flowers: { daisy: 0.55, buttercup: 0.3, coral: 0.85, blue: 0.55 },
      wind: 0.4, windAmp: 0.75, density: 1.05 }),
    P({ name: "Late-Summer Meadow",
      ground: ["#5f6235", "#7d7b43", "#9a9459"], strokes: ["#3e4428", "#565a31", "#807c46", "#a89b5e", "#cbb97c"],
      tuft: ["#4d5330", "#7c7741", "#ab9c62"], dense: ["#655a2c", "#94793a", "#d8bb75", "#e5c56f"],
      cut: ["#ddd09c", "#e8dcab", "#cfc18a", "#ad9c63"], path: ["#d9c9a0", "#b5a27a", "#948a72"],
      border: ["#2b3221", "#40452a", "#69663b"], flowers: { daisy: 0.2, buttercup: 0.45, coral: 1, blue: 0.1 },
      wind: 0.5, windAmp: 0.85, density: 1 })
  ];
  const REGION_LEN = 240, REGION_BLEND = 50;
  function regionAt(row) {
    if (row < 0) return { a: 0, b: 0, t: 0 };
    const idx = Math.floor(row / REGION_LEN);
    const local = row - idx * REGION_LEN;
    const a = idx % REGIONS.length, b = (idx + 1) % REGIONS.length;
    const t = local > REGION_LEN - REGION_BLEND ? smooth((local - (REGION_LEN - REGION_BLEND)) / REGION_BLEND) : 0;
    return { a, b, t };
  }
  function mixRGB(c1, c2, t) { return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; }
  function rgbStr(c, a) {
    const r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
    return a === undefined || a >= 1 ? "rgb(" + r + "," + g + "," + b + ")" : "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
  }
  function shade(c, k) { return k >= 0 ? mixRGB(c, [255, 250, 235], k) : mixRGB(c, [12, 22, 14], -k); }
  // A palette sampled at a row: blends the two neighbouring regions.
  const palCache = new Map();
  function paletteAt(row) {
    const reg = regionAt(row);
    const key = reg.a * 1000 + reg.b * 100 + Math.round(reg.t * 24);
    let p = palCache.get(key);
    if (p) return p;
    const A = REGIONS[reg.a], B = REGIONS[reg.b], t = Math.round(reg.t * 24) / 24;
    p = { key };
    for (const k of ["ground", "strokes", "tuft", "dense", "cut", "path", "border"]) p[k] = A[k].map((c, i) => mixRGB(c, B[k][i], t));
    p.wind = lerp(A.wind, B.wind, t); p.windAmp = lerp(A.windAmp, B.windAmp, t); p.density = lerp(A.density, B.density, t);
    if (palCache.size > 200) palCache.clear();
    palCache.set(key, p);
    return p;
  }
  const FLOWER_TYPES = ["daisy", "buttercup", "coral", "blue"];
  function pickFlowerType(rng, row) {
    const reg = regionAt(row);
    const R = REGIONS[rng.f() < reg.t ? reg.b : reg.a];
    let total = 0; for (const t of FLOWER_TYPES) total += R.flowers[t];
    let v = rng.f() * total;
    for (const t of FLOWER_TYPES) { v -= R.flowers[t]; if (v <= 0) return t; }
    return "daisy";
  }

  // ---------------------------------------------------------------------------
  // Generator: an endless sequence of authored formations, validated for fairness
  // ---------------------------------------------------------------------------
  const STONE_R = [0.27, 0.34, 0.42]; // collision radius by stone size (flat, irregular, boulder)
  function Generator(seed, cfg) {
    const rng = makeRng(seed);
    const rows = new Map();
    const patches = new Map();
    const obstacles = new Map();
    const rabbitSpawns = []; // pending wildlife, in row order
    let next = -10;
    let patchSeq = 1, obSeq = 1, clusterSeq = 1;
    let tensionRun = 0;
    const recent = [];
    let reliefTarget = cfg.reliefEvery + 1; // the first breather comes a little later: pressure builds first
    const log = [];

    // The simulation's difficulty director supplies the tier for a row (0 calm .. 1 expert).
    let tierFn = (row) => clamp01(cfg.startTier + Math.max(0, row - 30) / (1100 / cfg.difficultyRate));
    function tierAt(row) { return tierFn(row); }
    // Formation parameters derived from the tier; each is independently tunable.
    function paramsAt(T) {
      return {
        T,
        stone: cfg.stoneDensity * lerp(0.35, 1, T),
        rabbit: cfg.rabbitRate * lerp(0.3, 0.95, T),
        rabbit2: cfg.rabbitRate * clamp01((T - 0.45) * 1.4),
        narrow: cfg.narrowRate * lerp(0.15, 1, T),
        gapRows: clamp(Math.round(lerp(1.4, -0.2, clamp01(T * cfg.decisionRate))), 0, 2),
        flowers: cfg.flowerDensity * lerp(0.9, 1.2, T)
      };
    }

    function newBlock(n) {
      const b = { rows: [], obs: [], rabs: [], name: "" };
      for (let i = 0; i < n; i++) b.rows.push(newRow());
      return b;
    }
    function newRow() {
      const cells = [];
      for (let l = 0; l < LANES; l++) cells.push({ t: CELL_GRASS, f: null, patch: 0, o: 0, rb: false });
      return cells;
    }
    const inB = (b, i, l) => i >= 0 && i < b.rows.length && l >= 0 && l < LANES;
    const free = (c) => c.t !== CELL_OBST && !c.f && !c.rb;
    function flower(b, i, l, cluster) {
      if (!inB(b, i, l)) return;
      const c = b.rows[i][l];
      if (c.t === CELL_OBST || c.t === CELL_PATH || c.rb) return;
      c.f = { c: cluster || 0 }; c.t = CELL_GRASS; c.patch = 0;
    }
    function dense(b, i, l, id) {
      if (!inB(b, i, l)) return;
      const c = b.rows[i][l];
      if (c.f || c.t !== CELL_GRASS) return;
      c.t = CELL_DENSE; c.patch = id;
    }
    function path(b, i, l) {
      if (!inB(b, i, l)) return;
      const c = b.rows[i][l];
      if (c.t === CELL_OBST) return;
      c.t = CELL_PATH; c.f = null; c.patch = 0;
    }
    function obstacle(b, kind, i, l, w, h, extra) {
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) if (!inB(b, i + a, l + k) || b.rows[i + a][l + k].rb) return false;
      const id = obSeq++;
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) {
        const c = b.rows[i + a][l + k];
        c.t = CELL_OBST; c.f = null; c.patch = 0; c.o = id;
      }
      b.obs.push(Object.assign({ id, kind, i, l, w, h }, extra || {}));
      return true;
    }
    // A stone: one cell, a round collision shape that matches the painted rock.
    // bias nudges it sideways (toward a gap it helps to form).
    function stone(b, r, i, l, size, bias) {
      if (size === undefined) size = r.int(0, 2);
      const ox = (bias || 0) * 0.1 + r.range(-0.06, 0.06), oy = r.range(-0.12, 0.12);
      return obstacle(b, "stone", i, l, 1, 1, { size, ox, oy });
    }
    function rabbit(b, i, l, profile, opts) {
      if (!inB(b, i, l)) return false;
      const c = b.rows[i][l];
      if (!free(c)) return false;
      c.rb = true; c.patch = c.t === CELL_DENSE ? c.patch : 0;
      b.rabs.push({ i, l, profile, opts: opts || {} });
      return true;
    }
    function strip(b, r, i0, i1, l) {
      if (r.f() > Math.min(1, cfg.patchFrequency)) return 0;
      const id = patchSeq++;
      for (let i = i0; i <= i1; i++) dense(b, i, l, id);
      return id;
    }
    function scatterSingles(b, r, p, rowsFrom, rowsTo) {
      for (let i = rowsFrom; i <= rowsTo; i++) for (let l = 0; l < LANES; l++) {
        const c = b.rows[i][l];
        if (c.t === CELL_GRASS && !c.f && !c.rb && r.f() < p) flower(b, i, l, clusterSeq++);
      }
    }
    function scatterStones(b, r, p, rowsFrom, rowsTo) {
      for (let i = rowsFrom; i <= rowsTo; i++) for (let l = 0; l < LANES; l++) {
        const c = b.rows[i][l];
        if (c.t === CELL_GRASS && !c.f && !c.rb && r.f() < p) stone(b, r, i, l);
      }
    }
    function maybeRabbit(b, r, p, i0, i1, profile, opts) {
      if (r.f() > p) return false;
      for (let tries = 0; tries < 8; tries++) {
        if (rabbit(b, r.int(i0, i1), r.int(0, 6), profile || r.pick(["cautious", "wanderer", "skittish"]), opts)) return true;
      }
      return false;
    }

    // --- Formations -------------------------------------------------------
    // Each takes (rng, P) where P = paramsAt(tier). Relief formations keep moments of control.
    const PATTERNS = {
      open(r, P) {
        const b = newBlock(P.T > 0.5 ? r.int(4, 6) : r.int(5, 7));
        if (r.chance(0.6)) strip(b, r, 1, Math.min(b.rows.length - 2, r.int(3, 5)), r.int(0, 6));
        if (P.T > 0.3 && r.chance(0.5)) scatterSingles(b, r, 0.03 * P.flowers, 1, b.rows.length - 2);
        maybeRabbit(b, r, P.rabbit * 0.45, 2, b.rows.length - 2, "cautious");
        return b;
      },
      seedField(r) {
        const b = newBlock(r.int(7, 9));
        const l1 = r.int(0, 6);
        strip(b, r, 1, r.int(4, 6), l1);
        let l2 = r.int(0, 6); if (Math.abs(l2 - l1) < 2) l2 = (l1 + 3) % LANES;
        const id = strip(b, r, 3, 4, l2);
        if (id) { const l3 = clamp(l2 + r.pick([-1, 1]), 0, 6); for (let i = 5; i <= 7; i++) dense(b, i, l3, id); }
        return b;
      },
      // G: relief that does not stay comfortable for long — a forager, a seed strip, then a clear split.
      falseComfort(r, P) {
        const b = newBlock(r.int(9, 11));
        const n = b.rows.length;
        strip(b, r, 1, 5, r.int(1, 5));
        rabbit(b, r.int(2, 4), r.pick([0, 1, 5, 6]), "cautious");
        const c = r.int(2, 4), cl = clusterSeq++;
        stone(b, r, n - 2, c, r.int(1, 2));
        flower(b, n - 3, c, cl); flower(b, n - 2, c + r.pick([-1, 1]), cl);
        return b;
      },
      edgeBand(r, P) {
        const T = P.T;
        const n = 7 + Math.round(5 * T) + r.int(0, 2);
        const b = newBlock(n);
        const k = r.int(1, 5);
        const cl = clusterSeq++;
        const gapP = (1 - T) * 0.35;
        for (let i = 1; i < n - 1; i++) if (r.f() > gapP) flower(b, i, k, cl);
        const side = k <= 1 ? 1 : k >= 5 ? -1 : r.pick([-1, 1]);
        strip(b, r, 1, n - 3, k + side);
        // a stone at the end of the seed strip demands an exit turn
        if (r.f() < P.stone * 0.7) stone(b, r, n - 2, k + side, r.int(0, 2));
        if (T > 0.4 && r.chance(0.6)) {
          const k2 = k + side * 3;
          if (k2 >= 0 && k2 < LANES) { const cl2 = clusterSeq++; for (let i = 2; i < n - 2; i++) if (r.f() > gapP + 0.15) flower(b, i, k2, cl2); }
        }
        maybeRabbit(b, r, P.rabbit * 0.5, 2, n - 2, "wanderer");
        return b;
      },
      gate(r, P) {
        const T = P.T;
        const lead = T < 0.3 ? 5 : T < 0.6 ? 4 : 3;
        const thick = T > 0.5 && r.chance(0.5) ? 2 : 1;
        const w = T < 0.25 ? 3 : r.f() < P.narrow * 0.6 ? 1 : 2;
        const b = newBlock(lead + thick + 2);
        const g = r.int(0, LANES - w);
        const cl = clusterSeq++;
        for (let a = 0; a < thick; a++) for (let l = 0; l < LANES; l++) if (l < g || l >= g + w) flower(b, lead + a, l, cl);
        const id = patchSeq++;
        for (let a = 0; a < thick + 1; a++) dense(b, lead + a, g + Math.floor(w / 2), id);
        if (T > 0.6) { flower(b, lead - 1, g - 1, cl); flower(b, lead - 1, g + w, cl); }
        return b;
      },
      // B: two stones make a narrow gap with seed grass in it; flowers close one side.
      stoneGate(r, P) {
        const T = P.T;
        const lead = T < 0.35 ? 4 : 3;
        const b = newBlock(lead + 4);
        const w = r.f() < P.narrow ? 1 : 2;
        const g = r.int(1, LANES - 1 - w);
        stone(b, r, lead, g - 1, r.int(1, 2), 1);
        stone(b, r, lead, g + w, r.int(1, 2), -1);
        const fl = r.chance(0.5) ? -1 : 1, cl = clusterSeq++;
        if (fl < 0) for (let l = 0; l < g - 1; l++) flower(b, lead, l, cl);
        else for (let l = g + w + 1; l < LANES; l++) flower(b, lead, l, cl);
        const id = patchSeq++;
        for (let i = lead - 1; i <= lead + 2; i++) dense(b, i, g + (w > 1 ? r.int(0, 1) : 0), id);
        if (T > 0.55 && r.chance(0.5)) stone(b, r, lead + 2, fl < 0 ? Math.min(6, g + w + 1) : Math.max(0, g - 2));
        return b;
      },
      bed(r, P) {
        const T = P.T;
        const lead = T < 0.4 ? 3 : 2;
        const L = 4 + Math.round(3 * T) + r.int(0, 2);
        const bw = T < 0.4 ? 2 : r.int(2, 3);
        const b = newBlock(lead + L + 2);
        const left = r.int(1, LANES - 1 - bw);
        const right = left + bw - 1;
        const cl = clusterSeq++;
        for (let i = 0; i < L; i++) for (let l = left; l <= right; l++) {
          const corner = (i === 0 || i === L - 1) && (l === left || l === right) && bw > 1;
          if (!corner || r.chance(0.3)) flower(b, lead + i, l, cl);
        }
        const richSide = r.pick([-1, 1]);
        const richLane = richSide < 0 ? left - 1 : right + 1;
        const safeLane = richSide < 0 ? right + 1 : left - 1;
        strip(b, r, lead, lead + L - 1, richLane);
        if (T > 0.3) {
          const outer = richLane + richSide;
          if (outer >= 0 && outer < LANES) { const cl2 = clusterSeq++; for (let i = lead + 1; i < lead + L - 1; i++) if (r.chance(0.35 + 0.3 * T)) flower(b, i, outer, cl2); }
        }
        if (safeLane >= 0 && safeLane < LANES && r.chance(0.65)) for (let i = lead - 1; i <= lead + L; i++) path(b, i, safeLane);
        // the safe side is not always quiet: a rabbit may sit on the path
        if (safeLane >= 0 && safeLane < LANES && r.f() < P.rabbit * 0.6) rabbit(b, lead + r.int(1, L - 1), safeLane, r.pick(["wanderer", "skittish"]));
        return b;
      },
      // A single obstruction: a small adjustment, often sitting in a seed strip.
      stoneSingle(r, P) {
        const b = newBlock(r.int(6, 8));
        const l = r.int(0, 6), i = r.int(2, 4);
        const id = strip(b, r, 0, b.rows.length - 2, l);
        stone(b, r, i, l, r.int(0, 2));
        if (!id) dense(b, i + 1, l, patchSeq++);
        if (P.T > 0.25 && r.f() < P.stone) stone(b, r, i + r.int(2, 3), clamp(l + r.pick([-2, 2]), 0, 6));
        maybeRabbit(b, r, P.rabbit * 0.4, 1, b.rows.length - 2);
        return b;
      },
      // Several rocks with more than one exit and a seed pocket in the middle.
      stoneCluster(r, P) {
        const b = newBlock(9);
        const c = r.int(1, 5);
        const spots = [[2, c - 1], [2, c + 1], [4, c], [5, c - 2], [5, c + 2], [6, c - 1], [6, c + 1]];
        const nStones = 3 + Math.round(2 * P.stone * r.f());
        r.f(); const order = r.f() < 0.5 ? spots : spots.slice().reverse();
        let placed = 0;
        for (const [i, l] of order) { if (placed >= nStones) break; if (l >= 0 && l < LANES && stone(b, r, i, l)) placed++; }
        const id = patchSeq++;
        dense(b, 3, c, id); dense(b, 2, c, id);
        if (P.T > 0.5) maybeRabbit(b, r, P.rabbit * 0.6, 1, 7);
        return b;
      },
      corner(r, P) {
        const T = P.T;
        const b = newBlock(8);
        const l = r.int(1, 5);
        const kind = r.pick(["stone", "stone", "stump", "shrub"]);
        if (kind === "stone") stone(b, r, 3, l, r.int(1, 2)); else obstacle(b, kind, 3, l, 1, 1);
        const s = r.pick([-1, 1]);
        const cl = clusterSeq++;
        flower(b, 3, l + s, cl); flower(b, 4, l + s, cl);
        if (T > 0.45) flower(b, 5, l + s, cl);
        strip(b, r, 4, 6, l);
        if (T > 0.5 && r.chance(0.5)) flower(b, 2, l - s * 2, clusterSeq++);
        return b;
      },
      scatter(r, P) {
        const T = P.T;
        const n = r.int(8, 12);
        const b = newBlock(n);
        const clusters = r.int(2, 4);
        for (let c = 0; c < clusters; c++) {
          const ci = r.int(1, n - 2), cl0 = r.int(0, 6), cl = clusterSeq++;
          const size = r.int(2, 3 + Math.round(2 * T * P.flowers));
          for (let k = 0; k < size; k++) flower(b, clamp(ci + r.int(-1, 1), 1, n - 2), clamp(cl0 + r.int(-1, 1), 0, 6), cl);
        }
        scatterSingles(b, r, (0.025 + 0.06 * T) * P.flowers, 1, n - 2);
        if (T > 0.25) scatterStones(b, r, 0.035 * P.stone, 1, n - 2);
        for (let k = 0; k < 2; k++) { const l = r.int(0, 6), i = r.int(1, n - 4); strip(b, r, i, i + r.int(1, 3), l); }
        maybeRabbit(b, r, P.rabbit * 0.5, 1, n - 2);
        return b;
      },
      footpath(r, P) {
        const T = P.T;
        const n = r.int(9, 13);
        const b = newBlock(n);
        let l = r.int(1, 5);
        const cells = [];
        for (let i = 0; i < n; i++) {
          path(b, i, l); cells.push([i, l]);
          if (i < n - 1 && r.chance(0.4)) { const nl = clamp(l + r.pick([-1, 1]), 0, 6); path(b, i + 1, nl); l = nl; i++; path(b, i, l); cells.push([i, l]); }
        }
        for (let i = 1; i < n - 1; i++) for (let k = 0; k < LANES; k++) {
          const c = b.rows[i][k];
          if (c.t === CELL_GRASS && r.f() < (0.06 + 0.1 * T) * P.flowers) flower(b, i, k, clusterSeq++);
        }
        for (let k = 0; k < 2; k++) { const lane = r.int(0, 6), i = r.int(1, n - 4); strip(b, r, i, i + 2, lane); }
        // rabbits like paths: the safe route is sometimes occupied
        if (r.f() < P.rabbit * 0.8) { const [pi, pl] = cells[r.int(Math.floor(cells.length / 3), cells.length - 2)]; rabbit(b, pi, pl, r.pick(["wanderer", "skittish", "cautious"])); }
        return b;
      },
      slalom(r, P) {
        const T = P.T;
        const gap = T < 0.75 ? 4 : 3;
        const count = r.int(3, 4);
        const b = newBlock(2 + gap * count);
        let side = r.pick([0, 1]);
        for (let c = 0; c < count; c++) {
          const i = 2 + c * gap;
          const cl = clusterSeq++;
          const from = side ? 3 : 0, to = side ? 6 : 3;
          for (let l = from; l <= to; l++) {
            if (l === (side ? 3 : 3) && r.f() < P.stone * 0.5) stone(b, r, i, l, 1);
            else flower(b, i, l, cl);
          }
          if (T > 0.8 && gap > 3) for (let l = from; l <= to; l++) if (r.chance(0.5)) flower(b, i + 1, l, cl);
          const pocket = side ? 1 : 5;
          const id = patchSeq++;
          dense(b, i, pocket, id); dense(b, i + 1, pocket, id);
          side = 1 - side;
        }
        return b;
      },
      pond(r, P) {
        const T = P.T;
        const h = r.int(2, 3);
        const b = newBlock(h + 6);
        const c = r.int(2, 4);
        obstacle(b, "pond", 2, c - 1, 3, h);
        const narrow = c === 2 ? -1 : c === 4 ? 1 : r.pick([-1, 1]);
        const nl = narrow < 0 ? c - 2 : c + 2;
        strip(b, r, 1, 2 + h, nl);
        const wideFrom = narrow < 0 ? c + 2 : 0, wideTo = narrow < 0 ? 6 : c - 2;
        for (let i = 2; i < 2 + h + 1; i++) for (let l = wideFrom; l <= wideTo; l++) if (r.f() < (0.12 + 0.18 * T) * P.flowers) flower(b, i, l, clusterSeq++);
        if (T > 0.5) flower(b, 3 + h, nl, clusterSeq++);
        // a rabbit drinking at the water's edge on the wide side
        if (r.f() < P.rabbit * 0.7) rabbit(b, 2 + r.int(0, h - 1), narrow < 0 ? c + 2 : c - 2, r.pick(["cautious", "wanderer"]));
        return b;
      },
      fence(r, P) {
        const T = P.T;
        const b = newBlock(8);
        const len = r.int(3, 4);
        const fromLeft = r.chance(0.5);
        const l = fromLeft ? 0 : LANES - len;
        obstacle(b, "fence", 3, l, len, 1);
        const openLane = fromLeft ? len : LANES - len - 1;
        const away = fromLeft ? 1 : -1;
        const id = patchSeq++;
        for (let i = 4; i <= 6; i++) dense(b, i, fromLeft ? len - 1 : l, id);
        if (T > 0.5) flower(b, 3, openLane + away, clusterSeq++);
        if (T > 0.65) flower(b, 4, openLane + away, clusterSeq++);
        return b;
      },
      // A: a rabbit at the meadow edge that tends to cross the open route.
      crossing(r, P) {
        const b = newBlock(r.int(8, 10));
        const n = b.rows.length;
        const sideL = r.chance(0.5);
        strip(b, r, 2, n - 3, r.int(2, 4));
        rabbit(b, r.int(4, n - 3), sideL ? r.int(0, 1) : r.int(5, 6), "wanderer", { cross: true });
        if (P.T > 0.3) scatterSingles(b, r, 0.03 * P.flowers, 1, n - 2);
        if (P.T > 0.35 && r.f() < P.stone) stone(b, r, r.int(2, n - 3), r.int(0, 6));
        return b;
      },
      // C: a passage between a stone and a flower patch with a rabbit wandering by it.
      bottleneck(r, P) {
        const b = newBlock(9);
        const a = r.int(0, 3);
        const lead = 3;
        stone(b, r, lead, a, r.int(1, 2), 1);
        stone(b, r, lead + 1, a, r.int(0, 1), 1);
        const cl = clusterSeq++;
        for (let i = lead; i <= lead + 2; i++) { flower(b, i, a + 2, cl); if (r.chance(0.6)) flower(b, i, a + 3, cl); }
        const id = patchSeq++;
        for (let i = lead - 1; i <= lead + 2; i++) dense(b, i, a + 1, id);
        if (!rabbit(b, lead + 3, a + 2, r.pick(["wanderer", "skittish"]), { cross: r.chance(0.5) })) rabbit(b, lead - 2, a + 3, "wanderer");
        if (r.chance(0.5)) { const flip = (cells) => cells.reverse(); b.rows.forEach(flip); for (const o of b.obs) { o.l = LANES - 1 - o.l - (o.w - 1); o.ox = -(o.ox || 0); } for (const q of b.rabs) q.l = LANES - 1 - q.l; }
        return b;
      },
      // D: a rich strip beyond a stone-constrained gap; the other side is safe bare path.
      shortcut(r, P) {
        const b = newBlock(10);
        const g = r.int(1, 2);
        const right = r.chance(0.5);
        const gl = right ? LANES - 1 - g : g;
        stone(b, r, 3, gl - 1, r.int(1, 2), 1);
        stone(b, r, 3, gl + 1, r.int(1, 2), -1);
        if (P.T > 0.4) stone(b, r, 5, right ? gl + 1 : gl - 1, 0);
        const id = patchSeq++;
        for (let i = 2; i <= 8; i++) dense(b, i, gl, id);
        const pl = right ? r.int(0, 2) : r.int(4, 6);
        for (let i = 1; i <= 9; i++) path(b, i, pl);
        if (P.T > 0.3) scatterSingles(b, r, 0.04 * P.flowers, 4, 8);
        maybeRabbit(b, r, P.rabbit * 0.4, 5, 8, "skittish");
        return b;
      },
      // E: two routes — narrow with a stone, wide with a rabbit. Both stay viable.
      double(r, P) {
        const b = newBlock(10);
        const div = r.int(2, 4); // divider lane
        const cl = clusterSeq++;
        for (let i = 2; i <= 7; i++) flower(b, i, div, cl);
        const narrowLeft = div <= 3 ? r.chance(0.7) : r.chance(0.3);
        const nFrom = narrowLeft ? 0 : div + 1, nTo = narrowLeft ? div - 1 : LANES - 1;
        const wFrom = narrowLeft ? div + 1 : 0, wTo = narrowLeft ? LANES - 1 : div - 1;
        // narrow side: a stone forces a shift inside it, seed grass rewards it
        const nl = narrowLeft ? nTo : nFrom;
        stone(b, r, 4, nl, r.int(0, 1), narrowLeft ? -1 : 1);
        for (let l = nFrom; l <= nTo; l++) if (l !== nl) { const id = patchSeq++; for (let i = 3; i <= 7; i++) dense(b, i, l, id); }
        // wide side: open, but someone lives there
        rabbit(b, r.int(3, 6), r.int(wFrom, wTo), "wanderer", { cross: true });
        if (P.T > 0.6) maybeRabbit(b, r, 0.6, 2, 7, "skittish");
        return b;
      },
      // F: a corridor that narrows step by step, with a rabbit ahead in it.
      corridor(r, P) {
        const b = newBlock(12);
        let lo = r.int(0, 2), hi = lo + 3;
        const cl = clusterSeq++;
        for (let i = 1; i <= 10; i++) {
          if (i === 4 || i === 8) { if (r.chance(0.5)) { lo++; } else { hi--; } if (hi - lo < 1) hi = lo + 1; }
          for (let l = 0; l < LANES; l++) {
            if (l === lo - 1 || l === hi + 1) { if (i % 3 === 1 && r.f() < P.stone) stone(b, r, i, l, r.int(0, 1), l < lo ? 1 : -1); else flower(b, i, l, cl); }
          }
        }
        const id = patchSeq++;
        for (let i = 2; i <= 9; i++) dense(b, i, r.int(lo, hi), id);
        rabbit(b, r.int(6, 9), r.int(lo, hi), r.pick(["skittish", "wanderer"]));
        return b;
      },
      // A stone blocks the direct line, flowers narrow the gap beside it, seed grass rewards the gap,
      // and a rabbit may start across it; the far side is a plainer, wider way round.
      pinch(r, P) {
        const b = newBlock(9);
        const c = r.int(2, 4), side = r.pick([-1, 1]);
        stone(b, r, 4, c, r.int(1, 2));
        const cl = clusterSeq++;
        flower(b, 3, c - side, cl); flower(b, 4, c - side, cl); flower(b, 5, c - side, cl);
        const gap = c + side;
        const id = patchSeq++; for (let i = 2; i <= 7; i++) dense(b, i, gap, id);
        const edge = side > 0 ? LANES - 1 : 0;
        if (gap !== edge) rabbit(b, r.int(5, 6), edge, "wanderer", { cross: true });
        if (P.T > 0.5) stone(b, r, 7, c - side * 2 < 0 || c - side * 2 >= LANES ? c : c - side * 2, 0);
        return b;
      },
      // Two turns in quick succession: handle the first while reading the second.
      chicane(r, P) {
        const b = newBlock(10);
        const a = r.int(1, 5), d = a <= 2 ? 1 : a >= 4 ? -1 : r.pick([-1, 1]);
        stone(b, r, 3, a, r.int(1, 2));
        const cl = clusterSeq++;
        flower(b, 5, a + d, cl); flower(b, 6, a + d, cl);
        stone(b, r, 7, clamp(a + 2 * d, 0, 6), r.int(0, 1));
        const id = patchSeq++; for (let i = 4; i <= 8; i++) dense(b, i, a, id);
        if (r.f() < P.rabbit * 0.6) rabbit(b, 8, clamp(a - d, 0, 6), r.pick(["skittish", "wanderer"]), { cross: true });
        return b;
      },
      // The route forks round an island of flowers and rock; one branch is rich and inhabited.
      fork(r, P) {
        const b = newBlock(11);
        const c = r.int(2, 4), cl = clusterSeq++;
        for (let i = 3; i <= 8; i++) { flower(b, i, c, cl); }
        stone(b, r, 2, c, 2);
        const rich = r.pick([-1, 1]);
        const id = patchSeq++; for (let i = 3; i <= 8; i++) dense(b, i, c + rich, id);
        rabbit(b, r.int(4, 7), clamp(c + rich * 2, 0, 6), r.pick(["skittish", "wanderer"]), { cross: r.chance(0.6) });
        if (P.T > 0.45) stone(b, r, r.int(5, 7), clamp(c - rich * 2, 0, 6), r.int(0, 1));
        return b;
      },
      // H: everything at once, but readable — flowers, rocks and two animals.
      crowded(r, P) {
        const b = newBlock(r.int(10, 12));
        const n = b.rows.length;
        for (let c = 0; c < 3; c++) {
          const ci = r.int(1, n - 2), l0 = r.int(0, 6), cl = clusterSeq++;
          for (let k = 0; k < r.int(2, 4); k++) flower(b, clamp(ci + r.int(-1, 1), 1, n - 2), clamp(l0 + r.int(-1, 1), 0, 6), cl);
        }
        scatterStones(b, r, 0.06 * P.stone, 1, n - 2);
        for (let k = 0; k < 2; k++) { const l = r.int(0, 6), i = r.int(1, n - 4); strip(b, r, i, i + 2, l); }
        maybeRabbit(b, r, 1, 2, n - 3, "wanderer", { cross: true });
        maybeRabbit(b, r, P.rabbit2 + 0.3, 2, n - 2);
        return b;
      }
    };
    const POOL = [
      { name: "edgeBand", min: 0, w: 1.0 }, { name: "bed", min: 0.03, w: 1.1 }, { name: "crossing", min: 0.04, w: 1.1 },
      { name: "stoneSingle", min: 0.02, w: 0.9 }, { name: "gate", min: 0.1, w: 0.8 }, { name: "stoneGate", min: 0.12, w: 1.1 },
      { name: "footpath", min: 0.08, w: 0.8 }, { name: "corner", min: 0.14, w: 0.7 }, { name: "scatter", min: 0.2, w: 0.9 },
      { name: "shortcut", min: 0.2, w: 1.0 }, { name: "stoneCluster", min: 0.25, w: 0.9 }, { name: "pond", min: 0.2, w: 0.6 },
      { name: "bottleneck", min: 0.3, w: 1.2 }, { name: "fence", min: 0.3, w: 0.5 }, { name: "double", min: 0.35, w: 1.2 },
      { name: "slalom", min: 0.4, w: 0.8 }, { name: "corridor", min: 0.5, w: 1.1 }, { name: "crowded", min: 0.65, w: 1.3 },
      { name: "pinch", min: 0.25, w: 1.4 }, { name: "chicane", min: 0.28, w: 1.3 }, { name: "fork", min: 0.3, w: 1.2 }
    ];
    // The first ~30 seconds: a shaped introduction to every rule, one at a time.
    // The opening (~18 s): every block asks for a decision, one new idea at a time.
    const opening = [
      // 0–5 s: a stone sits in the mower's lane; left is a seed strip squeezed by daisies, right is plain grass
      { name: "start", build(r) {
        const b = newBlock(10); stone(b, r, 7, 3, 1);
        const cl = clusterSeq++; flower(b, 6, 1, cl); flower(b, 7, 1, cl); flower(b, 8, 1, cl);
        const id = patchSeq++; for (let i = 4; i <= 9; i++) dense(b, i, 2, id);
        return b; } },
      // 5–10 s: a flower gate with a stone in one of its two gaps: one clean line, with seed grass in it
      { name: "firstPinch", build(r) {
        const b = newBlock(8); const g = r.int(1, 4), cl = clusterSeq++;
        for (let l = 0; l < LANES; l++) if (l < g || l > g + 1) flower(b, 5, l, cl);
        const sl = r.chance(0.5) ? g : g + 1;
        stone(b, r, 5, sl, 0, sl === g ? -1 : 1);
        const id = patchSeq++; for (let i = 3; i <= 7; i++) dense(b, i, sl === g ? g + 1 : g, id);
        return b; } },
      // 10–15 s: the meadow moves — a rabbit crosses the open route, beside a pair of stones
      { name: "firstCrossing", build(r) {
        const b = newBlock(10); const left = r.chance(0.5);
        rabbit(b, 7, left ? 0 : 6, "wanderer", { cross: true, gentle: true });
        stone(b, r, 4, left ? 5 : 1, 1); stone(b, r, 6, left ? 6 : 0, 0);
        const id = patchSeq++; for (let i = 3; i <= 8; i++) dense(b, i, 3, id); return b; } },
      // 15–20 s: a harder choice — seed grass hugging a flower bed, or the bare path where a rabbit sits
      { name: "firstChoice", build(r) {
        const b = newBlock(11); const cl = clusterSeq++;
        for (let i = 2; i < 9; i++) { flower(b, i, 3, cl); if (i > 2 && i < 8) flower(b, i, 2, cl); }
        const id = patchSeq++; for (let i = 2; i <= 8; i++) dense(b, i, 4, id);
        stone(b, r, 9, 4, 1);
        for (let i = 1; i <= 9; i++) path(b, i, 1);
        rabbit(b, 6, 1, "cautious");
        return b; } }
    ];
    let openingIdx = 0;

    // --- Fairness validation ------------------------------------------------
    const isObs = (c) => c.t === CELL_OBST;
    const isFl = (c) => !!c.f || !!c.rb;
    const safe = (c) => !c.f && !c.rb && c.t !== CELL_OBST;
    function advance(prev, cur, mask) {
      let out = 0;
      for (let l = 0; l < LANES; l++) {
        if (!(mask & (1 << l))) continue;
        for (let d = -1; d <= 1; d++) {
          const l2 = l + d;
          if (l2 < 0 || l2 >= LANES || !safe(cur[l2])) continue;
          if (d !== 0) {
            if (isObs(prev[l2]) || isObs(cur[l])) continue;
            if (isFl(prev[l2]) && isFl(cur[l])) continue;
          }
          out |= 1 << l2;
        }
      }
      return out;
    }
    function validate(b, entry, entryMask) {
      // From every lane a player could safely occupy at the entry row, the block must be survivable,
      // treating each rabbit's starting spot as occupied.
      for (let l = 0; l < LANES; l++) {
        if (!(entryMask & (1 << l))) continue;
        let m = 1 << l, prev = entry;
        for (let i = 0; i < b.rows.length; i++) { m = advance(prev, b.rows[i], m); prev = b.rows[i]; if (!m) return false; }
      }
      // Every rabbit needs somewhere to hop: at least one free neighbouring cell.
      for (const q of b.rabs) {
        let room = 0;
        for (const dl of [-1, 1]) { const l = q.l + dl; if (inB(b, q.i, l) && free(b.rows[q.i][l])) room++; }
        if (!room) return false;
      }
      return true;
    }

    function commit(b, name, T) {
      for (const o of b.obs) {
        const ob = { id: o.id, kind: o.kind, x: o.l, y: next + o.i, w: o.w, h: o.h, seed: Math.floor(rng.f() * 1e9), size: o.size || 0, near: false, hitT: -9 };
        if (o.kind === "stone") ob.shape = { type: "circle", cx: o.l + 0.5 + (o.ox || 0), cy: next + o.i + 0.5 + (o.oy || 0), r: STONE_R[o.size || 0] };
        else if (o.kind === "stump") ob.shape = { type: "circle", cx: o.l + 0.5, cy: next + o.i + 0.5, r: 0.33 };
        else if (o.kind === "shrub") ob.shape = { type: "circle", cx: o.l + 0.5, cy: next + o.i + 0.5, r: 0.4 };
        else if (o.kind === "fence") ob.shape = { type: "rect", x0: o.l + 0.02, x1: o.l + o.w - 0.02, y0: next + o.i + 0.32, y1: next + o.i + 0.66 };
        else ob.shape = { type: "rect", x0: o.l + 0.1, x1: o.l + o.w - 0.1, y0: next + o.i + 0.1, y1: next + o.i + o.h - 0.1 };
        obstacles.set(o.id, ob);
      }
      for (const q of b.rabs) {
        rabbitSpawns.push({ x: q.l + 0.5, y: next + q.i + 0.5, profile: q.profile, opts: q.opts, seed: Math.floor(rng.f() * 1e9) });
        b.rows[q.i][q.l].rb = false;
      }
      const clusterTypes = new Map();
      for (let i = 0; i < b.rows.length; i++) {
        const r = next + i;
        const reg = regionAt(r);
        const row = { r, cells: b.rows[i], tufts: [], flowers: [], pattern: name, tier: T };
        for (let l = 0; l < LANES; l++) {
          const c = row.cells[l];
          if (c.f) {
            let type = clusterTypes.get(c.f.c);
            if (!type || rng.chance(0.12)) { type = pickFlowerType(rng, r); if (!clusterTypes.has(c.f.c)) clusterTypes.set(c.f.c, type); }
            row.flowers.push({ x: l + 0.5 + rng.range(-0.1, 0.1), y: r + 0.5 + rng.range(-0.12, 0.12), type, v: rng.int(0, 2),
              hit: false, near: false, ph: rng.f() * 6.283, nearT: -9, hitT: -9, lane: l, row: r });
          }
          let n = 0, val = cfg.grassPts;
          const lush = lushAt(l + 0.5, r + 0.5, seed);
          if (c.t === CELL_GRASS) n = c.f ? 1 : clamp(Math.round(1 + (lush - 0.4) * 13 + rng.range(-0.5, 0.5)), 1, 4);
          else if (c.t === CELL_DENSE) { n = 4; val = cfg.densePts; }
          for (let k = 0; k < n; k++) {
            let tx = l + 0.5 + rng.range(-0.34, 0.34);
            if (c.f) tx = l + 0.5 + (rng.chance(0.5) ? -0.36 : 0.36);
            const ty = r + (k + 0.5) / n + rng.range(-0.5, 0.5) / n;
            row.tufts.push({ x: tx, y: ty, v: val, d: c.t === CELL_DENSE, patch: c.patch, cut: false,
              reg: rng.f() < reg.t ? reg.b : reg.a, sv: rng.int(0, 7), sc: rng.range(0.72, 1.3), fl: rng.chance(0.5), ph: rng.f() * 6.283,
              live: c.t === CELL_DENSE || rng.chance(0.3) });
          }
          if (c.t === CELL_DENSE && c.patch) {
            let p = patches.get(c.patch);
            if (!p) { p = { id: c.patch, total: 0, cut: 0, done: false, row: r }; patches.set(c.patch, p); }
            p.total += n;
          }
        }
        rows.set(r, row);
      }
      log.push({ row: next, n: b.rows.length, name, T, rabbits: b.rabs.length, stones: b.obs.filter((o) => o.kind === "stone").length });
      if (log.length > 80) log.shift();
      next += b.rows.length;
    }

    const RELIEF = { open: 1, seedField: 1, falseComfort: 1 };
    function choose(T) {
      // Rhythm: a run of tension formations, then a moment of relief.
      if (tensionRun >= reliefTarget) {
        tensionRun = 0;
        reliefTarget = Math.max(1, cfg.reliefEvery + (T > 0.6 ? 1 : 0) + rng.int(-1, 1));
        if (T > 0.3 && rng.chance(0.4)) return "falseComfort";
        return rng.chance(0.55) ? "seedField" : "open";
      }
      // Newer, harder formations gain weight as the tier rises; recent ones are avoided.
      let avail = POOL.filter((p) => T >= p.min && recent.indexOf(p.name) < 0);
      if (!avail.length) avail = POOL.filter((p) => T >= p.min);
      const wt = (p) => p.w * (1 + Math.max(0, T - p.min) * (p.min > 0.25 ? 1.5 : 0.3));
      let tw = 0; for (const p of avail) tw += wt(p);
      let v = rng.f() * tw;
      for (const p of avail) { v -= wt(p); if (v <= 0) return p.name; }
      return avail[0].name;
    }

    function step() {
      const T = tierAt(next);
      const P = paramsAt(T);
      const entry = rows.get(next - 1);
      const entryCells = entry ? entry.cells : newRow();
      const entryMask = entry ? safeMaskOf(entryCells) : (1 << 3);
      if (next < 0) { commit(newBlock(-next), "behind", 0); return; }
      let name, build;
      if (openingIdx < opening.length) { name = opening[openingIdx].name; build = opening[openingIdx].build; openingIdx++; }
      else { name = choose(T); build = (r) => PATTERNS[name](r, P); }
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = rng.sub();
        const savedP = patchSeq, savedO = obSeq;
        const b = build(r);
        const gapRows = !PATTERNS[name] ? 0 : RELIEF[name] ? 1 : P.gapRows + (rng.chance(0.2) ? 1 : 0);
        for (let g = 0; g < gapRows; g++) b.rows.push(newRow());
        if (T > 0.6 && !RELIEF[name] && rng.chance(0.35)) scatterSingles(b, r, 0.03 * P.flowers, 0, b.rows.length - 1);
        if (PATTERNS[name] && !RELIEF[name] && !b.rabs.length && b.rows.length > 6 && r.f() < P.rabbit * 0.45) {
          const edge = r.pick([0, 1, 5, 6]);
          rabbit(b, r.int(3, b.rows.length - 3), edge, "wanderer", { cross: true });
        }
        // If a formation cannot be reached from every lane, give it lead-in grass rather than discard it.
        for (const pad of [0, 2, 4, 6]) {
          const cand = pad ? { rows: newBlock(pad).rows.concat(b.rows), obs: b.obs.map((o) => Object.assign({}, o, { i: o.i + pad })), rabs: b.rabs.map((q) => Object.assign({}, q, { i: q.i + pad })) } : b;
          if (validate(cand, entryCells, entryMask)) {
            commit(cand, name, T);
            if (!RELIEF[name] && openingIdx >= opening.length) { tensionRun++; recent.push(name); if (recent.length > 2) recent.shift(); }
            return;
          }
        }
        patchSeq = savedP; obSeq = savedO;
      }
      commit(newBlock(4), "fallback", T);
    }
    function safeMaskOf(cells) { let m = 0; for (let l = 0; l < LANES; l++) if (safe(cells[l])) m |= 1 << l; return m; }

    return {
      rows, patches, obstacles, rabbitSpawns, log,
      ensure(upto) { let guard = 0; while (next <= upto && guard++ < 500) step(); },
      row(r) { return rows.get(r); },
      cell(r, l) { const row = rows.get(r); return row && l >= 0 && l < LANES ? row.cells[l] : null; },
      prune(below) {
        for (const r of rows.keys()) if (r < below) rows.delete(r);
        for (const [id, o] of obstacles) if (o.y + o.h < below) obstacles.delete(id);
        for (const [id, p] of patches) if (p.row < below - 20) patches.delete(id);
      },
      setTier(fn) { tierFn = fn; },
      get next() { return next; },
      tierAt, paramsAt, validate, advance, safeMaskOf
    };
  }

  // ---------------------------------------------------------------------------
  // Shapes
  // ---------------------------------------------------------------------------
  function shapeDist(sh, x, y) {
    // distance from a point to the obstacle's collision shape (negative inside a circle)
    if (sh.type === "circle") return Math.hypot(x - sh.cx, y - sh.cy) - sh.r;
    const dx = Math.max(sh.x0 - x, 0, x - sh.x1), dy = Math.max(sh.y0 - y, 0, y - sh.y1);
    return Math.hypot(dx, dy);
  }

  // ---------------------------------------------------------------------------
  // Simulation: movement, steering, cutting, wildlife, scoring, rhythm, lives
  // ---------------------------------------------------------------------------
  const RABBIT_R = 0.19;
  // How likely each temperament is to bolt (rather than freeze flat) when the mower bears down on it.
  const BOLT = { cautious: 0.8, wanderer: 0.45, skittish: 0.6 };
  const MAX_RABBITS = 8;
  function Sim(cfg, seed) {
    const gen = Generator(seed, cfg);
    const ev = [];
    const rabbits = [];
    const s = {
      phase: "ready", time: 0, x: 3.5, y: 0.5, lane: 3, startY: 0.5,
      change: null, queued: null, speed: 0, startRamp: 0,
      lives: cfg.lives, score: 0, level: 0, charge: 0, lastCut: 0, decay: 0, contRows: 0,
      invuln: 0, jolt: 0, mercy: 1, yaw: 0, bumpT: -9, bumpDir: 0, stuck: 0, ghost: 0, lastPrune: 0,
      dd: 0, tier: 0, lastHitAt: -99, needSide: false, cutRate: 0, terrain: "grass", danger: 0,
      stats: { tufts: 0, near: 0, patches: 0, maxLevel: 0, turns: 0, autoTurns: 0, collisions: 0, firstTurnT: -1,
        firstHitT: -1, bestPatch: 0, collisionLog: [], rowsCut: 0, hitsBy: { flower: 0, stone: 0, rabbit: 0, terrain: 0 },
        rabbitHops: 0, pathHops: 0, rabbitBlocked: 0, rabbitsSeen: 0, stuckEvents: 0 }
    };
    const span = () => 1100 / cfg.difficultyRate;
    const tierOf = (dd) => clamp01(cfg.startTier + Math.max(0, dd - 30) / span());
    gen.setTier((row) => tierOf(s.dd + Math.max(0, row - s.y)));
    gen.ensure(40);

    // Difficulty director: wildlife behaviour by tier.
    function rabbitParams(T) {
      return {
        alertRows: cfg.alertRows * lerp(1, 1.3, T),
        hopS: (cfg.hopMs / 1000) * lerp(1.1, 0.8, T),
        activity: cfg.rabbitActivity * lerp(0.55, 1.3, T),
        react: cfg.reactS * lerp(1.45, 1, T) // minimum warning before a rabbit may land in your path
      };
    }

    function cellObs(r, l) { const c = gen.cell(r, l); return c ? c.t === CELL_OBST : false; }
    function laneClear(l, y0, y1) {
      for (let r = Math.floor(y0); r <= Math.floor(y1); r++) if (cellObs(r, l)) return false;
      return true;
    }
    // Can the mower occupy lane l anywhere between y0 and y1 (by the real collision shapes)?
    function laneFree(l, y0, y1) {
      for (let y = y0; y <= y1 + 1e-6; y += 0.15) if (obstacleAt(l + 0.5, y)) return false;
      return !obstacleAt(l + 0.5, y1);
    }
    function obstacleAt(x, y, pad) {
      for (const o of gen.obstacles.values()) {
        if (o.y > y + 2 || o.y + o.h < y - 2) continue;
        if (shapeDist(o.shape, x, y) < MOWER_R + (pad || 0)) return o;
      }
      return null;
    }
    function speedNow() {
      const t = clamp01(s.dd / cfg.rampRows);
      const base = cfg.startSpeed + (cfg.maxSpeed - cfg.startSpeed) * (1 - Math.pow(1 - t, 1.6));
      return base * s.mercy * s.startRamp;
    }
    function tryChange(dir, auto) {
      const from = s.change ? s.change.to : s.lane;
      const tl = from + dir;
      if (tl < 0 || tl >= LANES) return "edge";
      const len = cfg.laneChangeRows;
      if (s.change) {
        // Reversal mid-change: head straight back from where the mower is.
        if (dir === -Math.sign(s.change.to - s.change.from)) {
          if (!laneFree(tl, s.y, s.y + len * 0.6 + 0.3)) return "blocked";
          const dx = Math.abs(s.x - (tl + 0.5));
          s.change = { from: s.change.to, to: tl, fromX: s.x, p: 0, len: Math.max(0.3, len * dx) };
          s.lane = tl;
          ev.push({ type: "turn", dir, reverse: true });
          return "ok";
        }
        return "busy";
      }
      // Steering into a rock or pond that is right beside the mower is held, not executed.
      if (!laneFree(tl, s.y, s.y + len + 0.3)) return "blocked";
      s.change = { from: s.lane, to: tl, fromX: s.x, p: 0, len };
      s.lane = tl;
      s.stats.turns++;
      if (auto) s.stats.autoTurns++;
      if (s.stats.firstTurnT < 0 && !auto) s.stats.firstTurnT = s.time;
      ev.push({ type: auto ? "auto" : "turn", dir });
      return "ok";
    }
    function addCharge(n) {
      if (s.level >= cfg.maxMult - 1) { s.charge = 0; return; }
      s.charge += n;
      while (s.charge >= chargeFor(s.level) && s.level < cfg.maxMult - 1) {
        s.charge -= chargeFor(s.level); s.level++;
        s.stats.maxLevel = Math.max(s.stats.maxLevel, s.level);
        ev.push({ type: "levelup", level: s.level });
      }
      if (s.level >= cfg.maxMult - 1) s.charge = 0;
    }
    function award(points) { s.score += points; }

    function start() {
      if (s.phase !== "ready") return;
      s.phase = "play";
      ev.push({ type: "start" });
    }
    function swipe(dir) {
      if (s.phase === "ready") start();
      if (s.phase !== "play") return;
      const res = tryChange(dir, false);
      if (res === "edge") { s.bumpT = s.time; s.bumpDir = dir; ev.push({ type: "bump", dir }); s.queued = null; }
      else if (res === "blocked" || res === "busy") s.queued = { dir, t: s.time, busy: res === "busy" };
      else s.queued = null;
    }
    // After bumping a solid obstacle the mower steps aside to the nearest lane that is open ahead
    // (up to three lanes, for a fence or a pond), passing lanes that are only blocked further on.
    function sidestep() {
      const prefs = s.lane < 3 ? [1, -1] : s.lane > 3 ? [-1, 1] : [1, -1];
      let best = 0, bestN = 9, bestScore = -9;
      for (const d of prefs) {
        for (let n = 1; n <= 3; n++) {
          const tl = s.lane + d * n;
          if (tl < 0 || tl >= LANES || !laneFree(tl, s.y, s.y)) break;
          if (!laneFree(tl, s.y, s.y + 1.4)) continue;
          let sc = -n * 2;
          for (let r = Math.floor(s.y); r <= Math.floor(s.y + 2); r++) { const c = gen.cell(r, tl); if (c && c.f) sc--; }
          if (n < bestN || (n === bestN && sc > bestScore)) { best = d * n; bestN = n; bestScore = sc; }
          break;
        }
      }
      if (!best) return false;
      const tl = s.lane + best;
      s.change = { from: s.lane, to: tl, fromX: s.x, p: 0, len: cfg.laneChangeRows * 0.7 };
      s.lane = tl; s.queued = null;
      s.stats.autoTurns++;
      ev.push({ type: "auto", dir: Math.sign(best) });
      return true;
    }

    // ---- Wildlife ---------------------------------------------------------
    function spawnRabbits() {
      const sp = gen.rabbitSpawns;
      while (sp.length && sp[0].y < s.y + 22) {
        const q = sp.shift();
        if (q.y < s.y + 2) continue;
        if (rabbits.length >= MAX_RABBITS) { s.stats.rabbitsDropped = (s.stats.rabbitsDropped || 0) + 1; continue; }
        const rr = mulberry32(q.seed);
        rabbits.push({ id: q.seed, x: q.x, y: q.y, lane: Math.floor(q.x), profile: q.profile, opts: q.opts || {}, rng: rr,
          state: rr() < 0.6 ? "forage" : "idle", t: 0.8 + rr() * 1.6, face: (rr() - 0.5) * 2.4, hop: null, cool: 0,
          crossLeft: 0, crossDir: 0, plan: "", fled: false, near: false, nearT: -9, alertT: -9, landT: -9, hitT: -9, headT: rr() * 6,
          crossBudget: q.profile === "wanderer" ? (q.opts.noCross ? 0 : 1 + (rr() < 0.4 + 0.4 * s.tier ? 1 : 0)) : (q.opts.cross ? 1 : 0) });
        s.stats.rabbitsSeen++;
      }
      for (let i = rabbits.length - 1; i >= 0; i--) {
        const rb = rabbits[i];
        if (rb.y < s.y - 9 || (rb.fled && (rb.x < -1.2 || rb.x > LANES + 1.2) && rb.state !== "hop")) rabbits.splice(i, 1);
      }
    }
    function pathLanes() {
      const set = [s.lane];
      if (s.change && s.change.p < 0.7) set.push(s.change.from);
      if (s.queued) { const q = s.lane + s.queued.dir; if (q >= 0 && q < LANES) set.push(q); }
      return set;
    }
    const tmpCells = [];
    function rowWithBlocks(r, blocks) {
      const row = gen.row(r);
      if (!row) return null;
      let out = row.cells, copied = false;
      for (const b of blocks) {
        if (b.r !== r || b.l < 0 || b.l >= LANES) continue;
        if (!copied) { out = row.cells.slice(); copied = true; }
        out[b.l] = { t: out[b.l].t, f: out[b.l].f || { rabbit: true }, rb: true };
      }
      return out;
    }
    // Is there still a survivable route from where the mower is, if rabbits occupy these cells?
    function routeOK(blocks) {
      const rm = Math.floor(s.y + MOWER_R);
      let mask = 1 << s.lane;
      const l0 = Math.floor(s.x - MOWER_R), l1 = Math.floor(s.x + MOWER_R);
      for (let l = Math.max(0, l0); l <= Math.min(LANES - 1, l1); l++) mask |= 1 << l;
      let prev = rowWithBlocks(rm, blocks);
      if (!prev) return true;
      // the player needs time to react and to swing across: for the first rows the mower can only
      // carry straight on, then it may change one lane per row
      const committed = Math.max(1, Math.ceil(s.speed * 0.3 + cfg.laneChangeRows));
      for (let k = 1; k <= 12; k++) {
        const cur = rowWithBlocks(rm + k, blocks);
        if (!cur) return true;
        mask = k <= committed ? mask & gen.safeMaskOf(cur) : gen.advance(prev, cur, mask);
        if (!mask) return false;
        prev = cur;
      }
      return true;
    }
    function rabbitCellBlocks(except) {
      tmpCells.length = 0;
      for (const o of rabbits) {
        if (o === except || o.fled) continue;
        const x = o.hop ? o.hop.x1 : o.x, y = o.hop ? o.hop.y1 : o.y;
        if (y < s.y - 1 || y > s.y + 13) continue;
        tmpCells.push({ r: Math.floor(y), l: Math.floor(x) });
      }
      return tmpCells;
    }
    function canLand(rb, x1, y1, RP, allowOff, kind) {
      // an escape only gets special treatment when it leads away from where the mower is heading
      const headX = s.change ? s.change.to + 0.5 : s.x;
      const escaping = kind === "escape" && (x1 - rb.x) * (rb.x - headX) > 0;
      const lane = Math.floor(x1), row = Math.floor(y1);
      if (lane < 0 || lane >= LANES) return !!allowOff && x1 > -1.2 && x1 < LANES + 1.2;
      const c = gen.cell(row, lane);
      if (!c || c.t === CELL_OBST) return false;
      for (let r = row - 1; r <= row + 1; r++) { const rw = gen.row(r); if (rw) for (const f of rw.flowers) if (!f.hit && Math.hypot(f.x - x1, f.y - y1) < 0.4) return false; }
      for (const o of gen.obstacles.values()) if (Math.abs(o.y - y1) < 3 && shapeDist(o.shape, x1, y1) < RABBIT_R + 0.06) return false;
      for (const o of rabbits) if (o !== rb && !o.fled && Math.hypot((o.hop ? o.hop.x1 : o.x) - x1, (o.hop ? o.hop.y1 : o.y) - y1) < 0.7) return false;
      if (Math.hypot(x1 - s.x, y1 - s.y) < (escaping ? 0.75 : 1.1)) return false;
      const ahead = y1 - s.y;
      if (ahead > -0.6 && ahead < 13) {
        // Never hop into a dead end: there must be a free cell beside the landing spot to step into
        // (a rabbit trapped in a one-lane passage in front of the mower would be an unfair hazard).
        let side = false;
        for (const d of [-1, 1]) {
          const sc = gen.cell(row, lane + d);
          if (!sc || sc.t === CELL_OBST || sc.f) continue;
          let taken = false;
          for (const o of rabbits) if (o !== rb && !o.fled && Math.floor(o.hop ? o.hop.x1 : o.x) === lane + d && Math.abs((o.hop ? o.hop.y1 : o.y) - y1) < 1) taken = true;
          if (!taken) side = true;
        }
        if (!side) return false;
      }
      if (ahead > -0.6) {
        // Fairness: never land in the mower's projected path without enough warning,
        if (pathLanes().indexOf(lane) >= 0 && ahead < Math.max(1.8, s.speed * RP.react + 0.6)) return false;
        // nor right beside the mower where a swerve could meet it
        // (an escape out of the path, away from where the mower is heading, is exempt)
        if (!escaping && Math.abs(lane + 0.5 - headX) < 1.6 && ahead < Math.max(1.6, s.speed * RP.react * 0.7)) return false;
        // and never close off the last survivable route.
        if (ahead < 13) {
          const blocks = rabbitCellBlocks(rb).slice();
          blocks.push({ r: row, l: lane });
          if (!routeOK(blocks)) { s.stats.rabbitBlocked++; return false; }
        }
      }
      return true;
    }
    function startHop(rb, x1, y1, RP, kind) {
      const dx = x1 - rb.x, dy = y1 - rb.y;
      rb.hop = { x0: rb.x, y0: rb.y, x1, y1, t: 0, crouch: kind === "flee" ? 0.04 : 0.08, dur: RP.hopS * (Math.abs(dx) > 0.5 ? 1 : 0.85), land: 0.07, kind };
      rb.state = "hop";
      rb.face = Math.atan2(dx, dy);
      if (x1 < 0 || x1 >= LANES) rb.fled = true; // into the hedge: gone, no longer an obstacle
      const ahead = y1 - s.y;
      const intoPath = ahead > -0.5 && pathLanes().indexOf(Math.floor(x1)) >= 0;
      s.stats.rabbitHops++;
      if (intoPath && !rb.fled) s.stats.pathHops++;
      ev.push({ type: "rabbitHop", rb, kind, intoPath });
      return true;
    }
    function tryHop(rb, dl, dyRows, RP, kind, allowOff) {
      const x1 = Math.floor(rb.x) + dl + 0.5 + (rb.rng() - 0.5) * 0.12;
      const y1 = rb.y + dyRows;
      if (!canLand(rb, x1, y1, RP, allowOff, kind)) return false;
      return startHop(rb, x1, y1, RP, kind);
    }
    function rabbitReact(rb, RP) {
      const targetX = s.change ? s.change.to + 0.5 : s.x;
      const ahead = rb.y - s.y;
      const inPath = pathLanes().indexOf(rb.lane) >= 0 && ahead > -0.3;
      rb.cool = 1.6 + rb.rng() * 1.6;
      if (rb.plan === "cross") {
        rb.plan = "";
        rb.crossLeft = 1 + Math.floor(rb.rng() * (rb.opts.gentle ? 2 : 3));
        rb.crossBudget--;
        if (tryHop(rb, rb.crossDir, (rb.rng() - 0.5) * 0.3, RP, "cross")) { rb.crossLeft--; return; }
        rb.crossLeft = 0;
      }
      const close = Math.hypot(rb.x - s.x, rb.y - s.y) < 2.6;
      if ((inPath || close) && rb.rng() > BOLT[rb.profile]) {
        // it freezes, pressed flat in the grass, until the mower has passed
        rb.state = "freeze"; rb.t = 1.4 + rb.rng() * 0.6; rb.frozenFor = true;
        return;
      }
      if (inPath || rb.profile === "cautious" || close) {
        // Escape: away from where the mower is heading; at the meadow edge, into the hedge.
        let d0 = Math.sign(rb.x - targetX) || (rb.rng() < 0.5 ? -1 : 1);
        if (rb.profile === "skittish" && rb.rng() < 0.3) d0 = -d0;
        const atEdge = rb.lane === 0 || rb.lane === LANES - 1;
        if (tryHop(rb, d0, rb.rng() * 0.5, RP, "escape", atEdge)) return;
        if (tryHop(rb, -d0, rb.rng() * 0.5, RP, "escape", atEdge)) return;
        if (!inPath && tryHop(rb, 0, 0.9 + rb.rng() * 0.4, RP, "escape")) return;
        rb.state = "freeze"; rb.t = 0.5 + rb.rng() * 0.4; // pressed flat in the grass
        return;
      }
      if (rb.profile === "skittish") {
        const opts = [[-1, 0], [1, 0], [0, 0.8], [0, -0.7]];
        for (let k = 0; k < 4; k++) { const o = opts[Math.floor(rb.rng() * 4)]; if (tryHop(rb, o[0], o[1], RP, "hop")) return; }
      } else if (rb.profile === "wanderer" && rb.rng() < 0.6) {
        const d = rb.rng() < 0.65 ? (Math.sign(s.x - rb.x) || 1) : -(Math.sign(s.x - rb.x) || 1);
        if (tryHop(rb, d, 0, RP, "hop") || tryHop(rb, -d, 0, RP, "hop")) return;
      }
      rb.state = "idle"; rb.t = 0.6 + rb.rng() * 0.8;
    }
    function updateRabbits(dt, y0) {
      const RP = rabbitParams(s.tier);
      for (const rb of rabbits) {
        rb.headT += dt;
        if (rb.cool > 0) rb.cool -= dt;
        const ahead = rb.y - s.y;
        if (!rb.fled && !rb.decided && rb.state !== "hop" && rb.state !== "flee" && ahead > 0 && ahead < 2.6 && pathLanes().indexOf(rb.lane) >= 0) {
          // startled at close range, whatever it was doing: it bolts (never into the path) or freezes
          rb.decided = true; rb.cool = 0; rb.plan = ""; rb.crossLeft = 0;
          if (rb.state !== "freeze") rabbitReact(rb, RP);
        }
        if (rb.decided && (ahead < -0.5 || ahead > 3.5)) rb.decided = false;
        if (rb.state === "hop") {
          const h = rb.hop;
          h.t += dt;
          const ta = h.t - h.crouch;
          if (ta > 0) {
            const p = Math.min(1, ta / h.dur);
            rb.x = h.x0 + (h.x1 - h.x0) * p; rb.y = h.y0 + (h.y1 - h.y0) * p;
          }
          if (h.t >= h.crouch + h.dur + h.land) {
            rb.x = h.x1; rb.y = h.y1; rb.lane = Math.floor(rb.x); rb.hop = null; rb.landT = s.time;
            ev.push({ type: "rabbitLand", rb });
            if (rb.fled) { rb.state = "flee"; rb.t = 0.05 + rb.rng() * 0.08; }
            else { rb.state = "settle"; rb.t = rb.crossLeft > 0 ? 0.2 + rb.rng() * 0.18 : 0.35 + rb.rng() * 0.4; }
          }
        } else if (rb.state === "flee") {
          rb.t -= dt;
          if (rb.t <= 0) {
            const d = rb.x < LANES / 2 ? -1 : 1;
            const x1 = rb.x + d * 1.1, y1 = rb.y + 0.3 + rb.rng() * 0.5;
            startHop(rb, x1, y1, RP, "flee");
          }
        } else if (rb.state === "alert") {
          rb.t -= dt;
          if (rb.t <= 0) rabbitReact(rb, RP);
        } else if (rb.state === "settle") {
          rb.t -= dt;
          if (rb.t <= 0) {
            if (rb.crossLeft > 0) {
              rb.crossLeft--;
              if (!tryHop(rb, rb.crossDir, (rb.rng() - 0.5) * 0.3, RP, "cross")) { rb.crossLeft = 0; rb.state = "idle"; rb.t = 0.5 + rb.rng() * 0.6; }
            } else { rb.state = rb.rng() < 0.6 ? "forage" : "idle"; rb.t = 0.9 + rb.rng() * 1.6; }
          }
        } else if (rb.state === "freeze") {
          rb.t -= dt;
          if (rb.t <= 0 && !(ahead > -0.6 && ahead < 2.6 && Math.abs(rb.x - s.x) < 1.6)) { rb.state = "idle"; rb.t = 0.4; rb.cool = 0.8; }
        } else {
          // forage / idle
          rb.t -= dt;
          const lat = Math.abs(rb.x - s.x);
          if (rb.cool <= 0 && ahead > -0.4 && ahead < RP.alertRows && lat < 2.6) {
            rb.state = "alert"; rb.alertT = s.time;
            rb.t = (rb.profile === "skittish" ? 0.3 + rb.rng() * 0.15 : rb.profile === "cautious" ? 0.55 + rb.rng() * 0.2 : 0.45 + rb.rng() * 0.2);
            ev.push({ type: "rabbitAlert", rb });
          } else if (rb.crossBudget > 0 && ahead > RP.alertRows + 0.5 && ahead < RP.alertRows + 6.5 && rb.rng() < dt * 1.1 * RP.activity) {
            // a wanderer decides to cross the open route ahead of the mower: telegraphed by an alert pose
            rb.plan = "cross";
            rb.crossDir = Math.sign(s.x - rb.x) || (rb.x < LANES / 2 ? 1 : -1);
            rb.state = "alert"; rb.alertT = s.time; rb.t = 0.35 + rb.rng() * 0.15;
            ev.push({ type: "rabbitAlert", rb });
          } else if (rb.t <= 0) {
            if (ahead < 12 && rb.rng() < 0.4 * RP.activity) {
              const lateral = rb.profile === "wanderer" ? 0.6 : 0.35;
              const r = rb.rng();
              let ok = false;
              if (r < lateral) ok = tryHop(rb, rb.rng() < 0.5 ? -1 : 1, (rb.rng() - 0.5) * 0.3, RP, "wander");
              else ok = tryHop(rb, 0, rb.rng() < 0.6 ? 0.6 + rb.rng() * 0.3 : -0.6, RP, "wander");
              if (ok) continue;
            }
            rb.state = rb.state === "forage" ? "idle" : "forage";
            rb.t = 0.9 + rb.rng() * 1.8;
          }
        }
        // collisions and close shaves (fleeing rabbits are never hit again)
        if (rb.fled) continue;
        const dx = rb.x - s.x, dyy = rb.y - s.y;
        if (dx * dx + dyy * dyy < (MOWER_R + RABBIT_R) * (MOWER_R + RABBIT_R)) {
          if (s.invuln > 0) continue;
          rb.hitT = s.time; rb.fled = true; rb.crossLeft = 0;
          const row = gen.row(Math.floor(rb.y)) || { r: Math.floor(rb.y), pattern: "?", tier: s.tier };
          hitHazard("rabbit", rb, row);
          // it bolts for the hedge, unhurt
          if (rb.state !== "hop") { const d = rb.x < s.x ? -1 : 1; startHop(rb, rb.x + d * 1.1, rb.y + 0.4, RP, "flee"); }
          if (s.phase !== "play") return;
          continue;
        }
        if (!rb.near && rb.y <= s.y && rb.y > y0 - 0.001 && Math.abs(dx) < 1.25 && s.invuln <= 0) {
          rb.near = true; rb.nearT = s.time;
          s.stats.near++; addCharge(1);
          ev.push({ type: "near", kind: "rabbit", x: rb.x, y: rb.y });
        }
      }
    }

    function update(dtMs) {
      ev.length = 0;
      if (s.phase !== "play") return ev;
      const dt = Math.min(dtMs, 80) / 1000;
      s.time += dt;
      s.tier = tierOf(s.dd);
      s.stats.multTime = (s.stats.multTime || 0) + (s.level + 1) * dt;
      s.startRamp = Math.min(1, s.startRamp + dt / 0.6);
      s.mercy = Math.min(1, s.mercy + dt * 0.035);
      if (s.invuln > 0) s.invuln -= dt;
      let v = speedNow();
      if (s.jolt > 0) { s.jolt -= dt; v = 0; }
      s.speed = v;
      const y0 = s.y;

      // Lateral motion first (lane change progress; never slower than ~0.3 s).
      if (s.change) {
        const c = s.change;
        const p = Math.min(1, c.p + Math.max((v * dt) / c.len, dt / 0.3));
        const e = 1 - Math.pow(1 - p, 2.2);
        const nx = c.fromX + (c.to + 0.5 - c.fromX) * e;
        if (s.ghost <= 0 && obstacleAt(nx, s.y) && !obstacleAt(s.x, s.y)) {
          // swinging into a rock: turn back to the lane we came from
          s.change = { from: c.to, to: c.from, fromX: s.x, p: 0, len: Math.max(0.3, cfg.laneChangeRows * Math.abs(s.x - (c.from + 0.5))) };
          s.lane = c.from;
        } else {
          c.p = p; s.x = nx;
          if (c.p >= 1) { s.x = c.to + 0.5; s.change = null; }
        }
      }
      // Forward motion: rocks, stumps, fences and water are solid and cost a life on contact.
      let dy = v * dt;
      if (dy > 0 && s.ghost <= 0) {
        const o = obstacleAt(s.x, s.y + dy);
        if (o) {
          dy = 0;
          // one life per bump: pressing against the same obstacle never costs another
          const fresh = s.time - (o.contactT === undefined ? -9 : o.contactT) > 0.6;
          o.contactT = s.time;
          if (s.invuln <= 0 && fresh) {
            o.hitT = s.time;
            const row = gen.row(Math.floor(s.y)) || { r: Math.floor(s.y), pattern: "?", tier: s.tier };
            hitHazard(o.kind === "stone" ? "stone" : "terrain", o, row);
            if (s.phase !== "play") return ev;
          }
          s.needSide = true;
        }
      }
      if (s.needSide && s.jolt <= 0 && !s.change) { if (sidestep()) s.needSide = false; }
      if (dy === 0 && v > 0) { s.stuck += dt; if (s.stuck > 1.2) { s.ghost = 0.8; s.stats.stuckEvents++; s.stuck = 0; s.needSide = false; } } else s.stuck = 0;
      if (s.ghost > 0) { s.ghost -= dt; dy = v * dt; }
      s.y += dy;
      // Difficulty grows with progress, slower right after a mistake, a little faster in a good rhythm.
      const perf = s.time - s.lastHitAt < 10 ? 0.35 : s.level >= 2 ? 1.12 : 1;
      s.dd += dy * perf;

      // Buffered swipe: retried until it fits or expires.
      if (s.queued) {
        const age = (s.time - s.queued.t) * 1000;
        if (!s.change || !s.queued.busy) {
          const r = tryChange(s.queued.dir, false);
          if (r === "ok") s.queued = null;
          else if (r === "edge") s.queued = null;
          else if (r === "busy") { /* keep */ }
          // a swipe held by a rock alongside waits a little longer: it runs as soon as the side opens
          else if (age > cfg.bufferMs + (s.queued.busy ? 400 : 350)) s.queued = null;
        }
        if (s.queued && !s.change && s.queued.busy) s.queued.busy = false, s.queued.t = s.time;
      }
      const vx = s.change ? (s.x - (s.prevX === undefined ? s.x : s.prevX)) / Math.max(dt, 1e-4) : 0;
      s.prevX = s.x;
      s.yaw = Math.atan2(vx, Math.max(v, 1.2)) * 0.55;

      // Cutting.
      let cutN = 0, denseN = 0;
      const rA = Math.floor(s.y - CUT_R), rB = Math.floor(s.y + CUT_R);
      const rr = CUT_R * CUT_R;
      for (let r = rA; r <= rB; r++) {
        const row = gen.row(r);
        if (!row) continue;
        for (const t of row.tufts) {
          if (t.cut) continue;
          const dx = t.x - s.x, dyy = t.y - s.y;
          if (dx * dx + dyy * dyy < rr) {
            t.cut = true; cutN++; if (t.d) denseN++;
            const mult = s.level + 1;
            award(t.v * mult);
            s.stats.tufts++;
            ev.push({ type: "cut", x: t.x, y: t.y, d: t.d, reg: t.reg, mult });
            if (t.patch) {
              const p = gen.patches.get(t.patch);
              if (p && !p.done) {
                p.cut++;
                if (p.cut >= p.total) {
                  p.done = true;
                  const bonus = cfg.patchBonus * (s.level + 1);
                  award(bonus);
                  s.stats.patches++;
                  s.stats.bestPatch = Math.max(s.stats.bestPatch, bonus + p.total * cfg.densePts * (s.level + 1));
                  ev.push({ type: "patch", x: s.x, y: s.y, bonus });
                  addCharge(2);
                }
              }
            }
          }
        }
      }
      // terrain the mower is on, for sound and feel
      s.cutRate += ((dt > 0 ? cutN / dt : 0) - s.cutRate) * Math.min(1, dt * 8);
      const under = gen.cell(Math.floor(s.y), Math.floor(s.x));
      s.terrain = cutN ? (denseN ? "dense" : "grass") : under && under.t === CELL_PATH ? "path" : "cut";
      if (cutN) {
        s.lastCut = s.time; s.decay = 0;
        s.contRows += dy;
      } else if (s.time - s.lastCut > 1.1) {
        s.contRows = 0;
        s.decay += dt;
        if (s.decay > 1.0) {
          s.decay = 0;
          if (s.level > 0) { s.level--; s.charge = 0; ev.push({ type: "leveldown", level: s.level }); }
          else s.charge = Math.max(0, s.charge - 1);
        }
      }

      // Flowers: collision and close shaves.
      const hitD = MOWER_R + FLOWER_R;
      for (let r = Math.floor(s.y) - 1; r <= Math.floor(s.y) + 1; r++) {
        const row = gen.row(r);
        if (!row) continue;
        for (const f of row.flowers) {
          if (f.hit) continue;
          const dx = f.x - s.x, dyy = f.y - s.y;
          if (dx * dx + dyy * dyy < hitD * hitD) {
            if (s.invuln > 0) continue;
            f.hit = true; f.hitT = s.time;
            hitHazard("flower", f, row);
            if (s.phase !== "play") return ev;
            continue;
          }
          if (!f.near && f.y <= s.y && f.y > y0 - 0.001 && Math.abs(dx) < NEAR_DIST && s.invuln <= 0) {
            f.near = true; f.nearT = s.time;
            s.stats.near++;
            addCharge(1);
            ev.push({ type: "near", kind: "flower", x: f.x, y: f.y, f });
          }
        }
      }
      // Rocks passed closely count as close shaves too.
      for (const o of gen.obstacles.values()) {
        if (o.near || o.shape.type !== "circle") continue;
        const cy = o.shape.cy;
        if (cy <= s.y && cy > y0 - 0.001 && s.invuln <= 0 && Math.abs(o.shape.cx - s.x) < 1.15 && s.time - o.hitT > 2) {
          o.near = true; s.stats.near++; addCharge(1);
          ev.push({ type: "near", kind: "stone", x: o.shape.cx, y: cy });
        }
      }

      spawnRabbits();
      updateRabbits(dt, y0);
      if (s.phase !== "play") return ev;

      // how crowded the next few rows of the mower's neighbourhood are (drives tension in the mix)
      let danger = 0;
      for (let r = Math.floor(s.y) + 1; r <= Math.floor(s.y) + 4; r++) {
        for (let l = s.lane - 1; l <= s.lane + 1; l++) { const c = gen.cell(r, l); if (c && (c.f || c.t === CELL_OBST)) danger += l === s.lane ? 1.4 : 0.6; }
      }
      for (const rb of rabbits) if (!rb.fled && rb.y > s.y && rb.y - s.y < 5 && Math.abs(rb.x - s.x) < 2.5) danger += rb.state === "hop" || rb.state === "alert" ? 2 : 1;
      s.danger += (clamp01(danger / 8) - s.danger) * Math.min(1, dt * 3);

      gen.ensure(Math.floor(s.y) + 44);
      if (Math.floor(s.y) - s.lastPrune >= 16) { s.lastPrune = Math.floor(s.y); gen.prune(s.lastPrune - 70); }
      return ev;
    }

    function hitHazard(kind, obj, row) {
      s.lives = Math.max(0, s.lives - 1);
      s.stats.collisions++;
      s.stats.hitsBy[kind] = (s.stats.hitsBy[kind] || 0) + 1;
      s.lastHitAt = s.time;
      if (s.stats.firstHitT < 0) s.stats.firstHitT = s.time;
      const ox = obj.shape ? obj.shape.cx || obj.shape.x0 : obj.x, oy = obj.shape ? obj.shape.cy || obj.shape.y0 : obj.y;
      s.stats.collisionLog.push({ t: +s.time.toFixed(2), kind, row: row.r, pattern: row.pattern, tier: +(row.tier || 0).toFixed(2), dirTier: +s.tier.toFixed(2),
        speed: +s.speed.toFixed(2), lane: s.lane, changing: !!s.change, at: [+(+ox).toFixed(2), +(+oy).toFixed(2)], mower: [+s.x.toFixed(2), +s.y.toFixed(2)],
        rabbit: kind === "rabbit" ? { profile: obj.profile, state: obj.state, sinceLand: +(s.time - obj.landT).toFixed(2) } : undefined });
      const lostLevel = s.level;
      s.level = 0; s.charge = 0; s.contRows = 0;
      ev.push({ type: "hit", kind, obj, f: kind === "flower" ? obj : null, lostLevel, lives: s.lives });
      if (s.lives <= 0) {
        s.phase = "over"; s.speed = 0;
        ev.push({ type: "over" });
        return;
      }
      s.invuln = cfg.graceMs / 1000;
      s.jolt = kind === "stone" || kind === "terrain" ? 0.3 : 0.22;
      s.mercy = 0.84;
    }

    return {
      s, gen, rabbits, update, swipe, start,
      pause() { if (s.phase === "play") s.phase = "paused"; },
      resume() { if (s.phase === "paused") s.phase = "play"; },
      cellObs, laneClear, obstacleAt, routeOK, canLand, rabbitParams
    };
  }

  // ---------------------------------------------------------------------------
  // Audio: a hand-built soundscape in three layers.
  //   Atmosphere — wind, crickets, distant birds, the odd bee, shaped by region and tension.
  //   Interaction — the mower's engine, reel whir and ticks, grass cutting, turns, impacts.
  //   Tension — the mix leans toward the mower as the meadow gets busier; a sparse plucked
  //   motif (Karplus–Strong strings) and a low drone develop with the difficulty.
  // Packaged audio files are not available to Bits, so everything is synthesised. Recorded
  // birdsong, rabbit rustles or cutting grains can be supplied later via registerSample().
  // ---------------------------------------------------------------------------
  const REGION_AMB = [
    { birds: 1.0, crickets: 0.35, wind: 0.8, closed: 0, bees: 0.2 },  // early meadow: airy
    { birds: 1.0, crickets: 0.5, wind: 0.9, closed: 0, bees: 0.5 },   // buttercup
    { birds: 0.55, crickets: 0.85, wind: 0.6, closed: 1, bees: 0 },   // deep meadow: enclosed
    { birds: 0.65, crickets: 0.3, wind: 1.6, closed: 0, bees: 0 },    // wind-swept: rustling
    { birds: 0.9, crickets: 0.6, wind: 0.9, closed: 0, bees: 1 },     // wildflowers: bees
    { birds: 0.6, crickets: 1.0, wind: 1.0, closed: 0.3, bees: 0.3 }  // late summer: crickets
  ];
  const PENTA = [0, 2, 4, 7, 9];
  function SoundKit() {
    let ac = null;
    const bus = {};
    let noiseBuf = null, pinkBuf = null, reverb = null, revSend = null;
    let master = 0.75, sfxOn = true, musicOn = true, musicLevel = 1;
    let voices = 0;
    const samples = {};
    const plucks = new Map();
    // persistent voices
    let eng = null, cut = null, whir = null, scuff = null, wind = null, crickets = null, drone = null;
    // scheduling state
    let tickAt = 0, birdAt = 0, beeAt = 0, cricketAt = [0, 0], musicAt = 0, gustAt = 0, driftAt = 0;
    let gust = 0.5, phraseDeg = 2, lastGrain = 0, lastNear = 0, lastRustle = 0, rustleCount = 0;
    let running = false, paused = false, tension = 0, amb = REGION_AMB[0], speed = 0, cutAmt = 0;
    const k = {};
    const now = () => ac.currentTime;
    const rand = (a, b) => a + Math.random() * (b - a);

    function voice(node, dur) {
      voices++;
      node.onended = () => { voices--; };
      return voices < 34;
    }
    function panNode(p) {
      if (ac.createStereoPanner) { const n = ac.createStereoPanner(); n.pan.value = clamp(p, -1, 1); return n; }
      return ac.createGain();
    }
    function env(g, t, a, peak, dur, curve) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    }
    function noiseShot(dest, t, dur, type, freq, q, peak, opts) {
      if (voices > 30 && !(opts && opts.critical)) return;
      const src = ac.createBufferSource(); src.buffer = opts && opts.pink ? pinkBuf : noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      if (opts && opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
      const g = ac.createGain(); env(g, t, (opts && opts.attack) || 0.004, peak, dur);
      let last = g;
      src.connect(f); f.connect(g);
      if (opts && opts.pan !== undefined) { const p = panNode(opts.pan); g.connect(p); last = p; }
      last.connect(dest);
      if (opts && opts.rev) { const s = ac.createGain(); s.gain.value = opts.rev; last.connect(s); s.connect(revSend); }
      voice(src);
      src.start(t, Math.random() * 1.5, dur + 0.05);
    }
    function tone(dest, t, freq, dur, peak, type, toFreq, opts) {
      if (voices > 30 && !(opts && opts.critical)) return;
      const o = ac.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
      const g = ac.createGain(); env(g, t, (opts && opts.attack) || 0.006, peak, dur);
      o.connect(g); g.connect(dest);
      voice(o);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // Karplus–Strong plucked string, rendered once per pitch and cached.
    function pluckBuffer(freq, bright) {
      const key = Math.round(freq * 10) + "_" + bright;
      let b = plucks.get(key);
      if (b) return b;
      const sr = ac.sampleRate, len = Math.floor(sr * 1.6), N = Math.max(2, Math.round(sr / freq));
      b = ac.createBuffer(1, len, sr);
      const d = b.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev + (w - prev) * (bright ? 0.7 : 0.45); d[i] = prev; }
      const decay = bright ? 0.996 : 0.993;
      for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N + 1 < i ? i - N + 1 : i - N]);
      if (plucks.size > 40) plucks.clear();
      plucks.set(key, b);
      return b;
    }
    function pluck(dest, t, freq, peak, opts) {
      if (voices > 30 && !(opts && opts.critical)) return;
      const src = ac.createBufferSource(); src.buffer = pluckBuffer(freq, !!(opts && opts.bright));
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = (opts && opts.lp) || 2600;
      const g = ac.createGain(); g.gain.value = peak;
      src.connect(f); f.connect(g); g.connect(dest);
      const s = ac.createGain(); s.gain.value = (opts && opts.rev) || 0.35; g.connect(s); s.connect(revSend);
      voice(src);
      src.start(t);
    }
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const pentaHz = (deg, base) => { const o = Math.floor(deg / 5), i = ((deg % 5) + 5) % 5; return midiHz(base + o * 12 + PENTA[i]); };

    k.registerSample = function (name, arrayBuffer) {
      if (!ac) return Promise.resolve(false);
      return ac.decodeAudioData(arrayBuffer).then((buf) => { (samples[name] = samples[name] || []).push(buf); return true; }).catch(() => false);
    };
    function playSample(name, dest, gain, p) {
      const list = samples[name];
      if (!list || !list.length) return false;
      const src = ac.createBufferSource(); src.buffer = list[Math.floor(Math.random() * list.length)];
      src.playbackRate.value = rand(0.94, 1.06);
      const g = ac.createGain(); g.gain.value = gain;
      const pn = panNode(p || 0);
      src.connect(g); g.connect(pn); pn.connect(dest);
      voice(src); src.start();
      return true;
    }

    k.init = function () {
      if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return true; }
      try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; ac = new AC(); } catch (e) { ac = null; return false; }
      const sr = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, sr * 2, sr);
      pinkBuf = ac.createBuffer(1, sr * 2, sr);
      const nd = noiseBuf.getChannelData(0), pd = pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < nd.length; i++) {
        const w = Math.random() * 2 - 1; nd[i] = w * 0.5;
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
        pd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      }
      // master chain: gentle compression keeps phone speakers clean
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.2;
      bus.master = ac.createGain(); bus.master.gain.value = master;
      // make-up gain into a brick-wall limiter: present on phone speakers, never clipping
      const makeup = ac.createGain(); makeup.gain.value = 2.6;
      const lim = ac.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      bus.master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(ac.destination);
      if (window.__LM_TEST__ && ac.createMediaStreamDestination) { k.tap = ac.createMediaStreamDestination(); lim.connect(k.tap); }
      bus.sfx = ac.createGain(); bus.sfx.gain.value = sfxOn ? 1 : 0; bus.sfx.connect(bus.master);
      bus.music = ac.createGain(); bus.music.gain.value = musicOn ? 1 : 0; bus.music.connect(bus.master);
      for (const name of ["amb", "mower", "cut", "wild", "impact", "reward"]) { bus[name] = ac.createGain(); bus[name].connect(bus.sfx); }
      bus.mower.gain.value = 0.9; bus.amb.gain.value = 1;
      // a small room-less "air" reverb for birds and plucked strings
      const rl = Math.floor(sr * 1.6), ir = ac.createBuffer(2, rl, sr);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < rl; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2) * 0.5; }
      reverb = ac.createConvolver(); reverb.buffer = ir;
      revSend = ac.createGain(); revSend.gain.value = 0.5;
      const revLp = ac.createBiquadFilter(); revLp.type = "lowpass"; revLp.frequency.value = 3800;
      revSend.connect(reverb); reverb.connect(revLp); revLp.connect(bus.master);

      // --- the mower: engine murmur with an irregular putter ---
      eng = {};
      eng.o1 = ac.createOscillator(); eng.o1.type = "sawtooth"; eng.o1.frequency.value = 46;
      eng.o2 = ac.createOscillator(); eng.o2.type = "triangle"; eng.o2.frequency.value = 92.4;
      const o2g = ac.createGain(); o2g.gain.value = 0.55;
      eng.shape = ac.createWaveShaper();
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.8); }
      eng.shape.curve = curve;
      eng.lp = ac.createBiquadFilter(); eng.lp.type = "lowpass"; eng.lp.frequency.value = 300; eng.lp.Q.value = 0.8;
      eng.am = ac.createGain(); eng.am.gain.value = 0.65;
      eng.putt = ac.createOscillator(); eng.putt.type = "square"; eng.putt.frequency.value = 22;
      const puttLp = ac.createBiquadFilter(); puttLp.type = "lowpass"; puttLp.frequency.value = 70;
      const puttG = ac.createGain(); puttG.gain.value = 0.32;
      eng.putt.connect(puttLp); puttLp.connect(puttG); puttG.connect(eng.am.gain);
      eng.out = ac.createGain(); eng.out.gain.value = 0;
      eng.o1.connect(eng.shape); eng.o2.connect(o2g); o2g.connect(eng.shape);
      const engHp = ac.createBiquadFilter(); engHp.type = "highpass"; engHp.frequency.value = 75;
      eng.shape.connect(engHp); engHp.connect(eng.lp); eng.lp.connect(eng.am); eng.am.connect(eng.out); eng.out.connect(bus.mower);
      eng.o1.start(); eng.o2.start(); eng.putt.start();
      // reel whir: the cylinder spinning against its bed knife
      whir = { src: ac.createBufferSource(), f: ac.createBiquadFilter(), g: ac.createGain() };
      whir.src.buffer = noiseBuf; whir.src.loop = true;
      whir.f.type = "bandpass"; whir.f.frequency.value = 2300; whir.f.Q.value = 3.5; whir.g.gain.value = 0;
      whir.src.connect(whir.f); whir.f.connect(whir.g); whir.g.connect(bus.mower); whir.src.start();
      // grass cutting: a continuous textured clipping layer with an irregular flutter
      cut = { src: ac.createBufferSource(), hp: ac.createBiquadFilter(), bp: ac.createBiquadFilter(), g: ac.createGain(), mod: ac.createBufferSource(), modLp: ac.createBiquadFilter(), modG: ac.createGain() };
      cut.src.buffer = noiseBuf; cut.src.loop = true;
      cut.hp.type = "highpass"; cut.hp.frequency.value = 1100;
      cut.bp.type = "bandpass"; cut.bp.frequency.value = 2600; cut.bp.Q.value = 0.8;
      cut.g.gain.value = 0;
      cut.mod.buffer = noiseBuf; cut.mod.loop = true; cut.modLp.type = "lowpass"; cut.modLp.frequency.value = 22; cut.modG.gain.value = 0;
      cut.mod.connect(cut.modLp); cut.modLp.connect(cut.modG); cut.modG.connect(cut.g.gain);
      cut.src.connect(cut.hp); cut.hp.connect(cut.bp); cut.bp.connect(cut.g); cut.g.connect(bus.cut);
      cut.src.start(); cut.mod.start(0, 0.7);
      // bare earth under the wheels
      scuff = { src: ac.createBufferSource(), f: ac.createBiquadFilter(), g: ac.createGain() };
      scuff.src.buffer = pinkBuf; scuff.src.loop = true; scuff.f.type = "lowpass"; scuff.f.frequency.value = 700; scuff.g.gain.value = 0;
      scuff.src.connect(scuff.f); scuff.f.connect(scuff.g); scuff.g.connect(bus.mower); scuff.src.start(0, 0.3);

      // --- atmosphere ---
      wind = { low: ac.createBufferSource(), lowF: ac.createBiquadFilter(), lowG: ac.createGain(), hi: ac.createBufferSource(), hiF: ac.createBiquadFilter(), hiG: ac.createGain() };
      wind.low.buffer = pinkBuf; wind.low.loop = true; wind.lowF.type = "lowpass"; wind.lowF.frequency.value = 320; wind.lowG.gain.value = 0.0;
      wind.hi.buffer = noiseBuf; wind.hi.loop = true; wind.hiF.type = "bandpass"; wind.hiF.frequency.value = 1300; wind.hiF.Q.value = 0.6; wind.hiG.gain.value = 0.0;
      const windPan = panNode(0.25);
      wind.low.connect(wind.lowF); wind.lowF.connect(wind.lowG); wind.lowG.connect(bus.amb);
      wind.hi.connect(wind.hiF); wind.hiF.connect(wind.hiG); wind.hiG.connect(windPan); windPan.connect(bus.amb);
      wind.low.start(); wind.hi.start(0, 1.1);
      // two crickets at different pitches, gated by scheduled chirp trains
      crickets = [0, 1].map((i) => {
        const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = i ? 5150 : 4420;
        const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = (i ? 5150 : 4420) * 2.01;
        const g2 = ac.createGain(); g2.gain.value = 0.08;
        const gate = ac.createGain(); gate.gain.value = 0;
        const lvl = ac.createGain(); lvl.gain.value = 0;
        const p = panNode(i ? 0.55 : -0.5);
        o.connect(gate); o2.connect(g2); g2.connect(gate); gate.connect(lvl); lvl.connect(p); p.connect(bus.amb);
        o.start(); o2.start();
        return { gate, lvl };
      });
      // the tension drone: a low open fifth that only rises when the meadow gets busy
      drone = { g: ac.createGain(), lp: ac.createBiquadFilter() };
      drone.lp.type = "lowpass"; drone.lp.frequency.value = 420; drone.g.gain.value = 0;
      for (const [f, d] of [[73.42, 0], [110.0, 4], [146.83, -5]]) { const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.detune.value = d; o.connect(drone.lp); o.start(); }
      drone.lp.connect(drone.g); drone.g.connect(bus.music);
      const t = now();
      tickAt = birdAt = t; beeAt = t + rand(8, 18); cricketAt = [t + 0.5, t + 1.3]; musicAt = t + 2; gustAt = driftAt = t;
      birdAt = t + rand(1.5, 4);
      return true;
    };
    k.ready = () => !!ac;
    k.setMix = function (m) {
      if (m.master !== undefined) master = m.master;
      if (m.sfx !== undefined) sfxOn = m.sfx;
      if (m.music !== undefined) musicOn = m.music;
      if (m.musicLevel !== undefined) musicLevel = m.musicLevel;
      if (!ac) return;
      const t = now();
      bus.master.gain.setTargetAtTime(master, t, 0.05);
      bus.sfx.gain.setTargetAtTime(sfxOn ? 1 : 0, t, 0.05);
      bus.music.gain.setTargetAtTime(musicOn ? musicLevel * (paused ? 0.35 : 1) : 0, t, 0.08);
    };
    k.suspend = function () { if (ac && ac.state === "running") ac.suspend().catch(() => {}); };
    k.resume = function () { if (ac && ac.state === "suspended") ac.resume().catch(() => {}); };
    k.setPaused = function (p) {
      paused = p;
      if (!ac) return;
      const t = now();
      bus.amb.gain.setTargetAtTime(p ? 0.45 : 1 - 0.4 * tension, t, 0.15);
      bus.music.gain.setTargetAtTime(musicOn ? musicLevel * (p ? 0.35 : 1) : 0, t, 0.2);
    };
    // The mower starts: engine and reel come up smoothly.
    k.start = function () { running = true; if (ac) eng.out.gain.setTargetAtTime(0.03, now(), 0.25); };
    // The mower stops for good: engine winds down, cutting falls silent, a resolved chord.
    k.over = function () {
      running = false;
      if (!ac) return;
      const t = now();
      eng.o1.frequency.setTargetAtTime(24, t, 0.5); eng.o2.frequency.setTargetAtTime(48, t, 0.5);
      eng.out.gain.setTargetAtTime(0, t + 0.2, 0.35);
      whir.g.gain.setTargetAtTime(0, t, 0.3); cut.g.gain.setTargetAtTime(0, t, 0.08); scuff.g.gain.setTargetAtTime(0, t, 0.1);
      drone.g.gain.setTargetAtTime(0, t, 0.8);
      [62, 66, 69].forEach((m, i) => pluck(bus.music, t + 0.7 + i * 0.07, midiHz(m), 0.11, { critical: true, rev: 0.5 }));
    };
    k.reset = function () {
      running = false;
      if (!ac) return;
      const t = now();
      eng.o1.frequency.setTargetAtTime(46, t, 0.05); eng.o2.frequency.setTargetAtTime(92.4, t, 0.05);
    };

    // Per-frame update from the game: continuous layers follow the actual state.
    k.update = function (dt, st) {
      if (!ac) return;
      const t = now();
      tension = clamp01(st.tension || 0);
      speed = st.speed || 0;
      const reg = st.region || { a: 0, b: 0, t: 0 };
      const A = REGION_AMB[reg.a], B = REGION_AMB[reg.b];
      amb = { birds: lerp(A.birds, B.birds, reg.t), crickets: lerp(A.crickets, B.crickets, reg.t), wind: lerp(A.wind, B.wind, reg.t), closed: lerp(A.closed, B.closed, reg.t), bees: lerp(A.bees, B.bees, reg.t) };
      const live = running && !paused && st.playing;
      // mix priorities: decorative ambience steps back as tension rises
      if (!paused) {
        bus.amb.gain.setTargetAtTime(1 - 0.42 * tension, t, 0.6);
        bus.mower.gain.setTargetAtTime(0.85 + 0.25 * tension, t, 0.6);
        bus.cut.gain.setTargetAtTime(1 + 0.15 * tension, t, 0.6);
      }
      // engine: pitch and brightness follow speed; quieter while paused or at rest
      if (live) {
        eng.out.gain.setTargetAtTime(0.03 + 0.008 * tension, t, 0.2);
        eng.o1.frequency.setTargetAtTime(42 + speed * 4.2, t, 0.25);
        eng.o2.frequency.setTargetAtTime((42 + speed * 4.2) * 2.01, t, 0.25);
        eng.lp.frequency.setTargetAtTime(480 + speed * 45, t, 0.3);
        whir.g.gain.setTargetAtTime(0.006 + speed * 0.0026, t, 0.2);
        whir.f.frequency.setTargetAtTime(1900 + speed * 160, t, 0.3);
      } else if (running) {
        eng.out.gain.setTargetAtTime(paused ? 0.008 : 0.018, t, 0.2);
        whir.g.gain.setTargetAtTime(0, t, 0.15);
      }
      // cutting: louder and fuller in dense grass, nearly gone on cut ground
      const target = live ? clamp01((st.cutRate || 0) / 9) : 0;
      cutAmt += (target - cutAmt) * Math.min(1, dt * (target > cutAmt ? 18 : 7));
      const dense = st.terrain === "dense";
      cut.g.gain.setTargetAtTime(cutAmt * (dense ? 0.16 : 0.11), t, 0.04);
      cut.modG.gain.setTargetAtTime(cutAmt * 0.09, t, 0.1);
      cut.bp.frequency.setTargetAtTime(dense ? 1750 : 2700, t, 0.15);
      scuff.g.gain.setTargetAtTime(live && st.terrain === "path" ? 0.018 + speed * 0.003 : 0, t, 0.12);
      // slow imperfections in the engine
      if (t > driftAt) {
        driftAt = t + rand(0.25, 0.6);
        eng.o1.detune.setTargetAtTime(rand(-14, 14), t, 0.2);
        eng.putt.frequency.setTargetAtTime(20 + speed * 1.2 + rand(-1.2, 1.2), t, 0.15);
      }
      // reel ticks while moving
      while (tickAt < t + 0.1) {
        const rate = live ? clamp(speed * 3.1, 3, 16) : 0;
        if (!rate) { tickAt = t + 0.1; break; }
        tickAt += (1 / rate) * rand(0.85, 1.15);
        if (tickAt > t) noiseShot(bus.mower, tickAt, 0.006, "highpass", 3800, 0.7, 0.012 + 0.004 * tension);
      }
      // wind: a slow random walk of gusts, stronger in the wind-swept field
      if (t > gustAt) {
        gustAt = t + rand(0.5, 1.1);
        gust = clamp(gust + rand(-0.28, 0.28), 0.1, 1);
        const w = amb.wind * (st.windAmp || 1);
        wind.lowG.gain.setTargetAtTime(0.009 * w * (0.5 + gust * 0.6), t, 0.8);
        wind.hiG.gain.setTargetAtTime(0.012 * w * gust * (1 - amb.closed * 0.5), t, 0.6);
        wind.hiF.frequency.setTargetAtTime((amb.closed ? 900 : 1300) + gust * 500, t, 0.8);
      }
      // crickets
      for (let i = 0; i < 2; i++) {
        crickets[i].lvl.gain.setTargetAtTime(0.0065 * amb.crickets * (1 - 0.5 * tension) * (i ? 0.8 : 1), t, 1);
        while (cricketAt[i] < t + 0.25) {
          const n = 3 + Math.floor(Math.random() * 3);
          let tt = cricketAt[i];
          for (let p = 0; p < n; p++) { crickets[i].gate.gain.setValueAtTime(0, tt); crickets[i].gate.gain.linearRampToValueAtTime(1, tt + 0.006); crickets[i].gate.gain.setValueAtTime(1, tt + 0.016); crickets[i].gate.gain.linearRampToValueAtTime(0, tt + 0.022); tt += 0.042; }
          cricketAt[i] = tt + (Math.random() < 0.15 ? rand(1.5, 4) : rand(0.35, 0.85));
          if (cricketAt[i] < t) cricketAt[i] = t + 0.3;
        }
      }
      // distant birds: sparse, irregular, fewer when the meadow is tense
      if (t > birdAt) {
        const mean = 7 / Math.max(0.15, amb.birds * (1 - 0.6 * tension));
        birdAt = t + Math.max(2.2, -Math.log(Math.random()) * mean);
        if (!paused) bird(t + 0.05);
      }
      if (t > beeAt) { beeAt = t + rand(14, 30); if (!paused && Math.random() < amb.bees) bee(t); }
      // music: a sparse plucked motif that grows denser with tension, over a drone that rises with it
      drone.g.gain.setTargetAtTime(live ? 0.02 * Math.max(0, tension - 0.25) : 0, t, 1.5);
      if (t > musicAt) {
        const gap = lerp(2.2, 0.75, tension) * rand(0.8, 1.25);
        musicAt = t + gap;
        if (!paused && st.playing !== false && Math.random() > lerp(0.4, 0.15, tension)) {
          phraseDeg = clamp(phraseDeg + Math.round(rand(-2.4, 2.4)), 0, 9);
          pluck(bus.music, t + 0.02, pentaHz(phraseDeg, 62), 0.05 + 0.02 * tension, { lp: 1800 + tension * 1400 });
          if (tension > 0.5 && Math.random() < 0.3) pluck(bus.music, t + 0.02 + gap * 0.5, pentaHz(phraseDeg + 2, 62), 0.035, { lp: 2200 });
        }
      }
    };

    function bird(t) {
      const p = rand(-0.7, 0.7);
      if (playSample("bird", bus.amb, rand(0.15, 0.35), p)) return;
      const out = ac.createGain(); out.gain.value = rand(0.012, 0.024) * (1 - amb.closed * 0.4);
      const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1400;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6000 - amb.closed * 1800;
      const pn = panNode(p);
      out.connect(hp); hp.connect(lp); lp.connect(pn); pn.connect(bus.amb);
      const rs = ac.createGain(); rs.gain.value = 0.6; lp.connect(rs); rs.connect(revSend);
      const kind = Math.random();
      // one oscillator per call, with a quiet harmonic, shaped by automation
      const o = ac.createOscillator(); o.type = "sine";
      const o2 = ac.createOscillator(); o2.type = "sine";
      const g = ac.createGain(); g.gain.value = 0;
      const g2 = ac.createGain(); g2.gain.value = 0.12;
      const vib = ac.createOscillator(); vib.frequency.value = rand(24, 38);
      const vibG = ac.createGain(); vibG.gain.value = rand(20, 60);
      vib.connect(vibG); vibG.connect(o.frequency);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
      let end = t;
      const note = (tt, f0, f1, dur, peak) => {
        o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f1, tt + dur);
        o2.frequency.setValueAtTime(f0 * 2, tt); o2.frequency.exponentialRampToValueAtTime(f1 * 2, tt + dur);
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(peak, tt + Math.min(0.015, dur * 0.3)); g.gain.setValueAtTime(peak, tt + dur * 0.7); g.gain.linearRampToValueAtTime(0, tt + dur);
        end = Math.max(end, tt + dur);
      };
      if (kind < 0.3) {
        // two-note whistle, repeated: "tee-oo, tee-oo"
        const f1 = rand(3000, 3700), f2 = f1 * rand(0.74, 0.82), reps = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < reps; i++) { const tt = t + i * 0.42; note(tt, f1, f1 * 1.04, 0.13, 1); note(tt + 0.17, f2, f2 * 0.97, 0.15, 0.85); }
      } else if (kind < 0.55) {
        // descending trill ending in a flourish
        const n = 8 + Math.floor(Math.random() * 7); let f = rand(4800, 5600);
        for (let i = 0; i < n; i++) { note(t + i * 0.055, f, f * 0.84, 0.04, 0.9 - i * 0.03); f *= 0.975; }
        note(t + n * 0.055 + 0.03, f * 1.25, f * 0.9, 0.12, 0.8);
      } else if (kind < 0.8) {
        // a few sharp chips
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) note(t + i * rand(0.12, 0.2), rand(5200, 6400), rand(3200, 3900), 0.03, 1);
      } else {
        // a short warble
        let f = rand(2800, 3600);
        for (let i = 0; i < 9; i++) { const nf = clamp(f * rand(0.85, 1.18), 2400, 4600); note(t + i * 0.07, f, nf, 0.065, 0.7 + Math.random() * 0.3); f = nf; }
      }
      o.start(t); o2.start(t); vib.start(t);
      o.stop(end + 0.1); o2.stop(end + 0.1); vib.stop(end + 0.1);
      voice(o);
    }
    function bee(t) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(rand(205, 235), t);
      o.frequency.linearRampToValueAtTime(rand(185, 205), t + 2.6);
      const v = ac.createOscillator(); v.frequency.value = 9; const vg = ac.createGain(); vg.gain.value = 6; v.connect(vg); vg.connect(o.frequency);
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 650; f.Q.value = 1.2;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.006, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      const pn = panNode(-0.8);
      if (pn.pan) pn.pan.linearRampToValueAtTime(0.8, t + 2.8);
      o.connect(f); f.connect(g); g.connect(pn); pn.connect(bus.amb);
      o.start(t); v.start(t); o.stop(t + 2.9); v.stop(t + 2.9); voice(o);
    }

    // --- interaction one-shots -------------------------------------------------
    // a cut tuft: a soft, varied clipping grain (rate-limited so it never machine-guns)
    k.cut = function (dense) {
      if (!ac || !running) return;
      const t = now();
      if (t - lastGrain < rand(0.07, 0.13)) return;
      lastGrain = t;
      if (playSample("grassCut", bus.cut, rand(0.2, 0.35), rand(-0.15, 0.15))) return;
      if (dense) {
        noiseShot(bus.cut, t, rand(0.035, 0.06), "bandpass", rand(1500, 2300), 1.3, rand(0.05, 0.075));
        noiseShot(bus.cut, t + 0.004, 0.03, "lowpass", 620, 0.7, 0.03);
      } else noiseShot(bus.cut, t, rand(0.022, 0.045), "bandpass", rand(2800, 5000), rand(1.2, 2), rand(0.03, 0.05));
    };
    k.turn = function (auto) {
      if (!ac) return;
      const t = now();
      noiseShot(bus.mower, t, 0.009, "bandpass", 3200, 4, auto ? 0.012 : 0.02);
      noiseShot(bus.mower, t + 0.01, 0.07, "lowpass", 900, 0.7, auto ? 0.012 : 0.022, { pink: true });
      const d = eng.o1.detune; d.cancelScheduledValues(t); d.setValueAtTime(d.value, t); d.linearRampToValueAtTime(-55, t + 0.06); d.linearRampToValueAtTime(0, t + 0.28);
    };
    k.bump = function () { if (!ac) return; const t = now(); tone(bus.impact, t, 160, 0.09, 0.04, "sine", 110); noiseShot(bus.impact, t, 0.05, "lowpass", 600, 0.7, 0.03, { pink: true }); };
    k.near = function (kind, level) {
      if (!ac) return;
      const t = now();
      if (t - lastNear < 0.22) return;
      lastNear = t;
      // a quick airy brush past: a sense of having slipped by, not a reward chime
      noiseShot(bus.reward, t, 0.18, "bandpass", kind === "rabbit" ? 700 : 950, 1.4, 0.014 + level * 0.003, { sweep: kind === "rabbit" ? 1700 : 2500, attack: 0.05 });
    };
    k.level = function (level) {
      if (!ac) return;
      const t = now(), d = 4 + level * 2;
      pluck(bus.reward, t, pentaHz(d, 62), 0.09, { bright: true }); pluck(bus.reward, t + 0.11, pentaHz(d + 2, 62), 0.08, { bright: true });
    };
    k.down = function () { if (!ac) return; pluck(bus.reward, now(), pentaHz(1, 50), 0.06, { lp: 900 }); };
    k.patch = function () { if (!ac) return; const t = now(); [5, 7, 9].forEach((d, i) => pluck(bus.reward, t + i * 0.065, pentaHz(d, 62), 0.06, { bright: true })); };
    // collisions: each hazard has its own voice, then one concise life-lost cue
    k.hit = function (kind, livesLeft) {
      if (!ac) return;
      const t = now();
      if (kind === "stone" || kind === "terrain") {
        tone(bus.impact, t, 130, 0.22, 0.14, "sine", 52, { critical: true });
        noiseShot(bus.impact, t, 0.07, "bandpass", 720, 2, 0.09, { critical: true });
        noiseShot(bus.impact, t + 0.01, 0.12, "lowpass", 400, 0.7, 0.05, { pink: true, critical: true });
        const g = eng.out.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.006, t + 0.05); g.linearRampToValueAtTime(0.03, t + 0.6);
      } else if (kind === "flower") {
        noiseShot(bus.impact, t, 0.02, "highpass", 2600, 0.7, 0.05, { critical: true });
        noiseShot(bus.impact, t + 0.005, 0.2, "bandpass", 1500, 1.1, 0.045, { critical: true, attack: 0.02 });
        tone(bus.impact, t, 110, 0.14, 0.06, "sine", 72, { critical: true });
      } else {
        // a soft bump, then the rabbit scampering off unhurt
        noiseShot(bus.impact, t, 0.06, "lowpass", 420, 0.7, 0.08, { pink: true, critical: true });
        tone(bus.impact, t, 95, 0.12, 0.07, "sine", 60, { critical: true });
        for (let i = 0; i < 4; i++) rustle(t + 0.12 + i * 0.13, 0.9 - i * 0.2, (i + 1) * 0.15, true);
      }
      cut.g.gain.cancelScheduledValues(t); cut.g.gain.setValueAtTime(0, t);
      bus.amb.gain.setTargetAtTime(0.4, t, 0.05); bus.amb.gain.setTargetAtTime(1 - 0.42 * tension, t + 0.6, 0.4);
      // life lost: two muted, descending plucked notes, after the impact has spoken
      if (livesLeft > 0) { pluck(bus.reward, t + 0.16, midiHz(55), 0.08, { lp: 1200, critical: true }); pluck(bus.reward, t + 0.31, midiHz(50), 0.07, { lp: 1000, critical: true }); }
    };
    k.best = function () { if (!ac) return; const t = now(); [0, 2, 4, 5].forEach((d, i) => pluck(bus.reward, t + i * 0.12, pentaHz(d + 5, 62), 0.1, { bright: true, critical: true, rev: 0.6 })); };
    // rabbits: movement through the grass, sized by distance and placed gently left or right
    function rustle(t, strength, p, critical) {
      const n = 3 + Math.floor(Math.random() * 3);
      let tt = t;
      for (let i = 0; i < n; i++) {
        noiseShot(bus.wild, tt, rand(0.012, 0.03), "bandpass", rand(1700, 3600), rand(1, 2.2), 0.02 * strength * rand(0.6, 1), { pan: p, critical });
        tt += rand(0.018, 0.045);
      }
    }
    k.rabbit = function (kind, prox, p, intoPath) {
      if (!ac) return;
      const t = now();
      if (t - lastRustle < 0.3) { if (++rustleCount > 3) return; } else { lastRustle = t; rustleCount = 0; }
      const s = clamp(prox, 0.12, 1);
      if (kind === "land") {
        if (!playSample("rabbitLand", bus.wild, 0.3 * s, p)) { noiseShot(bus.wild, t, 0.03, "lowpass", 280, 0.7, 0.03 * s, { pan: p, pink: true }); tone(bus.wild, t, 82, 0.03, 0.012 * s, "sine"); }
      } else if (kind === "alert") {
        if (!playSample("rabbitRustle", bus.wild, 0.15 * s, p)) rustle(t, 0.35 * s, p);
      } else if (!playSample("rabbitRustle", bus.wild, (intoPath ? 0.4 : 0.25) * s, p)) rustle(t, (intoPath ? 1.25 : 0.8) * s, p);
    };
    k.debug = () => (ac ? { state: ac.state, voices, cut: +cutAmt.toFixed(3), engine: +eng.out.gain.value.toFixed(4), amb: +bus.amb.gain.value.toFixed(3),
      music: +bus.music.gain.value.toFixed(3), sfx: bus.sfx.gain.value, master: +bus.master.gain.value.toFixed(3), tension: +tension.toFixed(2), running, paused } : null);
    k.destroy = function () { try { if (ac) ac.close(); } catch (e) { /* ignore */ } ac = null; };
    return k;
  }

  // ---------------------------------------------------------------------------
  // Exposed for headless tests only.
  // ---------------------------------------------------------------------------
  if (typeof window !== "undefined" && window.__LM_TEST__) {
    window.__LM_CORE__ = { lushAt, chargeFor, Generator, Sim, DEFAULTS, regionAt, REGIONS, LANES, CELL_OBST, CELL_DENSE, CELL_PATH, MOWER_R, FLOWER_R, CUT_R };
  }

  // ---------------------------------------------------------------------------
  // The Bit
  // ---------------------------------------------------------------------------
  window.plethoraBit = {
    meta: {
      title: "Little Meadow",
      runtime: "plethora-bit@2",
      tags: ["arcade", "endless", "painterly"],
      permissions: ["audio", "haptics", "storage"]
    },

    async init(ctx) {
      let destroyed = false;
      ctx.onDestroy(() => { destroyed = true; });

      // ---- Config from tuning --------------------------------------------
      const tune = ctx.tune;
      function tn(id, def) { try { const v = tune && tune.has && tune.has(id) ? tune.get(id) : undefined; return v === undefined || v === null ? def : v; } catch (e) { return def; } }
      function readCfg() {
        return {
          startSpeed: +tn("start_speed", DEFAULTS.startSpeed), maxSpeed: +tn("max_speed", DEFAULTS.maxSpeed),
          rampRows: +tn("ramp_rows", DEFAULTS.rampRows), laneChangeRows: +tn("lane_change_rows", DEFAULTS.laneChangeRows),
          swipePx: +tn("swipe_threshold_px", DEFAULTS.swipePx), bufferMs: +tn("input_buffer_ms", DEFAULTS.bufferMs),
          flowerDensity: +tn("flower_density", DEFAULTS.flowerDensity), patchFrequency: +tn("patch_frequency", DEFAULTS.patchFrequency),
          stoneDensity: +tn("stone_density", DEFAULTS.stoneDensity), rabbitRate: +tn("rabbit_rate", DEFAULTS.rabbitRate),
          rabbitActivity: +tn("rabbit_activity", DEFAULTS.rabbitActivity), alertRows: +tn("rabbit_alert_rows", DEFAULTS.alertRows),
          hopMs: +tn("rabbit_hop_ms", DEFAULTS.hopMs), reactS: +tn("rabbit_warning_s", DEFAULTS.reactS),
          narrowRate: +tn("narrow_rate", DEFAULTS.narrowRate), decisionRate: +tn("decision_rate", DEFAULTS.decisionRate),
          grassPts: +tn("grass_points", DEFAULTS.grassPts), densePts: +tn("seed_grass_points", DEFAULTS.densePts),
          patchBonus: +tn("patch_bonus", DEFAULTS.patchBonus), maxMult: Math.max(1, +tn("max_multiplier", DEFAULTS.maxMult)),
          graceMs: +tn("grace_ms", DEFAULTS.graceMs), difficultyRate: +tn("difficulty_rate", DEFAULTS.difficultyRate),
          reliefEvery: Math.max(1, +tn("relief_every", DEFAULTS.reliefEvery)), startTier: clamp01(+tn("start_tier", DEFAULTS.startTier)), lives: Math.max(1, +tn("lives", DEFAULTS.lives)),
          seed: +tn("seed", 0) || 0, debug: !!tn("debug_metrics", false),
          musicVolume: +tn("music_volume", DEFAULTS.musicVolume), sfxVolume: +tn("sfx_volume", DEFAULTS.sfxVolume)
        };
      }
      let cfg = readCfg();

      // ---- Persistence ----------------------------------------------------
      const canStore = !!(ctx.capabilities && ctx.capabilities.storage !== false && ctx.storage);
      function load(key, def) { try { if (!canStore) return def; const v = ctx.storage.get(key); return v === null || v === undefined ? def : v; } catch (e) { return def; } }
      function save(key, v) { try { if (canStore) ctx.storage.set(key, v); } catch (e) { /* session only */ } }
      let best = +load("lm_best", 0) || 0;
      // sound settings: effects (incl. ambience), music, and a three-step master volume
      let sfxOn = load("lm_sfx", load("lm_sound", true) !== false) !== false;
      let musicOn = load("lm_music", true) !== false;
      let volLevel = clamp((+load("lm_vol", 1)) | 0, 0, 2);
      const VOLS = [0.4, 0.7, 1.0];
      let soundPanel = false, panelBoxes = [];

      if (typeof OffscreenCanvas === "undefined") {
        // The painted meadow is cached in off-screen buffers; without them the Bit cannot draw.
        const root = ctx.createRoot({ style: "display:flex;align-items:center;justify-content:center;background:#30472f;color:#f1e8d5;font:20px Georgia,serif;text-align:center;padding:32px;" });
        root.textContent = "Little Meadow needs a newer version of this app's web view to paint the meadow.";
        try { ctx.platform.error({ stage: "init", reason: "OffscreenCanvas unavailable" }); } catch (e) { /* ignore */ }
        try { ctx.markVisualReady("fallback message"); ctx.platform.ready(); } catch (e) { /* ignore */ }
        return;
      }

      // ---- Surfaces & fonts ---------------------------------------------
      const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, touchAction: "none", layer: "content" });
      canvas.style.cssText += ";touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";
      canvas.tabIndex = 0;
      const g = canvas.getContext("2d");
      // typefaces: approved registry fonts, with system fallbacks until (or unless) they load
      const FONT_SANS = { f: "-apple-system, 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif" };
      const FONT_SERIF = { f: "Georgia, 'Times New Roman', serif" };
      (async () => {
        const sansFallback = FONT_SANS.f;
        try {
          await Promise.all([ctx.loadFont("LM Sans", "inter", "1.0.0", { weight: "400", style: "normal" }), ctx.loadFont("LM Sans", "inter", "1.0.0", { weight: "600", style: "normal" })]);
          if (!destroyed) { FONT_SANS.f = "'LM Sans', " + sansFallback; digitCache.clear(); }
        } catch (e) { /* system sans */ }
        try { await ctx.loadFont("LM Serif", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }); if (!destroyed) FONT_SERIF.f = "'LM Serif', Georgia, serif"; } catch (e) { /* fallback */ }
      })();

      // ---- Layout ------------------------------------------------------------
      let W = ctx.width, H = ctx.height, S = 48, fieldX0 = 0, anchorY = 0, PS = 1.5, chunkW = 0, chunkX = 0, area = { top: 0, right: 0, bottom: 0, left: 0 };
      const CH = 16; // rows per painted chunk
      // Insets for text and controls. Full screen: the host's content-safe area, with a floor in case a
      // host reports zeros or late values (a notch and the logo button are always assumed). Safe frame: as given.
      function readArea() {
        const c = ctx.contentSafeArea, a = c || ctx.safeArea || {};
        const r = { top: +a.top || 0, right: +a.right || 0, bottom: +a.bottom || 0, left: +a.left || 0 };
        if (c) { r.top = Math.max(r.top, 48); r.bottom = Math.max(r.bottom, 100); }
        return r;
      }
      function computeLayout() {
        W = Math.max(200, ctx.width); H = Math.max(300, ctx.height);
        area = readArea();
        S = clamp(Math.min(W / 8.2, H / 14.5), 30, 74);
        fieldX0 = (W - LANES * S) / 2;
        anchorY = Math.min(H * 0.73, H - area.bottom - S * 1.1);
        chunkW = W * 1.42; chunkX = (W - chunkW) / 2;
        PS = Math.min(ctx.dpr || 1, 1.5);
        const px = chunkW * CH * S * PS * PS;
        if (px > 1.8e6) PS = Math.max(0.75, Math.sqrt(1.8e6 / (chunkW * CH * S)));
      }
      computeLayout();

      // ---- Game state ------------------------------------------------------
      let sim = null, runSeed = 0, attempt = 0, scoreTrack = null;
      let phase = "ready";      // ready | play | paused | over (renderer view of sim.s.phase)
      let overT = 0, readyT = 0, hudScorePulse = 0, shownScore = 0, newBest = false, prevBest = 0;
      let camY = 0, camVel = 0, zoom = 1, anchorCur = anchorY;
      let lifeAnim = [0, 0, 0, 0, 0];
      let multAnim = 0, multDropT = -9, multDropFrom = 1, lastLevel = 0, hitFlash = 0;
      let board = { state: "idle", rows: [], rank: null, total: 0 };
      let lastEvents = [];
      const trail = []; // persistent mower path samples for re-painting chunks
      let metrics = null;

      try { scoreTrack = ctx.game.score(); } catch (e) { scoreTrack = null; }

      function newRun(first) {
        cfg = readCfg();
        runSeed = cfg.seed ? cfg.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
        sim = Sim(cfg, runSeed);
        phase = "ready";
        overT = 0; readyT = 0; hudScorePulse = 0; shownScore = 0; newBest = false;
        camY = sim.s.y; camVel = 0; zoom = 1; anchorCur = anchorY;
        lifeAnim = [0, 0, 0, 0, 0, 0];
        multAnim = 0; multDropT = -9; lastLevel = 0; hitFlash = 0;
        board = { state: "idle", rows: [], rank: null, total: 0 };
        trail.length = 0;
        particles.reset();
        chunks.clear(); jobs.length = 0;
        if (scoreTrack) try { scoreTrack.reset(); } catch (e) { /* ignore */ }
        metrics = { seed: runSeed, startedAt: 0 };
        if (!first) paintVisibleNow();
      }

      // ---- Particles (pooled) ------------------------------------------------
      const particles = (function () {
        const clips = [], petals = [], pollen = [], floats = [];
        for (let i = 0; i < 90; i++) clips.push({ on: false });
        for (let i = 0; i < 40; i++) petals.push({ on: false });
        for (let i = 0; i < 4; i++) floats.push({ on: false });
        let butterfly = { on: false, next: 18 + Math.random() * 20 };
        let birdNext = 4 + Math.random() * 6;
        function grab(pool) { for (const p of pool) if (!p.on) return p; return pool[(Math.random() * pool.length) | 0]; }
        return {
          clips, petals, pollen, floats,
          get butterfly() { return butterfly; },
          reset() {
            for (const p of clips) p.on = false; for (const p of petals) p.on = false; for (const p of floats) p.on = false;
            pollen.length = 0;
            for (let i = 0; i < 12; i++) pollen.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, ph: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 });
            butterfly = { on: false, next: 20 + Math.random() * 25 };
          },
          clip(x, y, col, dir) {
            const p = grab(clips);
            p.on = true; p.x = x + (Math.random() - 0.5) * 0.5; p.y = y - 0.15;
            const a = (Math.random() - 0.5) * 2.4;
            const sp = 1.2 + Math.random() * 2.2;
            p.vx = Math.sin(a) * sp + dir * 0.4; p.vy = -Math.abs(Math.cos(a)) * sp * 0.7 - 0.6;
            p.z = 0; p.vz = 1.6 + Math.random() * 1.8;
            p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 18;
            p.life = 0; p.max = 0.45 + Math.random() * 0.35; p.col = col; p.len = 0.05 + Math.random() * 0.07;
          },
          petal(x, y, col) {
            const p = grab(petals);
            p.on = true; p.x = x; p.y = y; const a = Math.random() * 6.28, sp = 0.3 + Math.random() * 0.9;
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 6;
            p.life = 0; p.max = 1.2 + Math.random() * 0.8; p.col = col; p.sz = 0.05 + Math.random() * 0.04;
          },
          float(x, y, text) {
            const p = grab(floats); p.on = true; p.x = x; p.y = y; p.text = text; p.life = 0; p.max = 1.3;
          },
          update(dt, playing) {
            for (const p of clips) {
              if (!p.on) continue;
              p.life += dt; if (p.life > p.max) { p.on = false; continue; }
              p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
              p.z += p.vz * dt; p.vz -= 9 * dt; if (p.z < 0) { p.z = 0; p.vz = 0; p.vr *= 0.5; }
              p.rot += p.vr * dt;
            }
            for (const p of petals) {
              if (!p.on) continue;
              p.life += dt; if (p.life > p.max) { p.on = false; continue; }
              p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.rot += p.vr * dt;
            }
            for (const p of floats) { if (!p.on) continue; p.life += dt; if (p.life > p.max) p.on = false; }
            for (const p of pollen) { p.ph += dt * 0.6; p.x += (Math.sin(p.ph) * 0.004 + 0.003) * dt * 6; p.y += Math.cos(p.ph * 0.7) * 0.003 * dt * 6 - 0.002 * dt; if (p.x > 1.05) p.x = -0.05; if (p.y < -0.05) p.y = 1.05; if (p.y > 1.05) p.y = -0.05; }
            butterfly.next -= dt;
            if (!butterfly.on && butterfly.next <= 0 && playing) {
              const fromLeft = Math.random() < 0.5;
              butterfly = { on: true, t: 0, dur: 7 + Math.random() * 3, fromLeft, y0: 0.08 + Math.random() * 0.3, y1: 0.05 + Math.random() * 0.35, ph: Math.random() * 6.28, col: Math.random() < 0.6 ? [241, 232, 213] : [214, 160, 130], next: 0 };
            }
            if (butterfly.on) { butterfly.t += dt; if (butterfly.t > butterfly.dur) butterfly = { on: false, next: 30 + Math.random() * 40 }; }
            birdNext -= dt;
            if (birdNext <= 0) birdNext = 9;
          }
        };
      })();

      const sound = SoundKit();
      ctx.onDestroy(() => sound.destroy());
      function startAudio() { sound.init(); applyMix(); }
      function applyMix() {
        sound.setMix({ master: VOLS[volLevel] * cfg.sfxVolume, sfx: sfxOn, music: musicOn, musicLevel: clamp(cfg.musicVolume * 2, 0, 1.2) });
        save("lm_sfx", sfxOn); save("lm_music", musicOn); save("lm_vol", volLevel);
      }
      let lastHaptic = 0;
      function haptic(kind) {
        const t = performance.now();
        if (kind === "light" && t - lastHaptic < 90) return;
        lastHaptic = t;
        try { if (ctx.capabilities && ctx.capabilities.haptics === false) return; ctx.platform.haptic(kind); } catch (e) { /* ignore */ }
      }

      // =======================================================================
      // Painting: sprites, tiles and chunks
      // =======================================================================
      // Off-screen paint buffers (chunks, sprites, tiles). The visible surface is the SDK canvas.
      function makeCanvas(w, h) { return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); }
      // A tapered brush blade from (x,y) toward angle a.
      function blade(c2, x, y, a, len, w, bend) {
        const tx = x + Math.sin(a) * len, ty = y - Math.cos(a) * len;
        const mx = x + Math.sin(a + bend) * len * 0.55, my = y - Math.cos(a + bend) * len * 0.55;
        const nx = Math.cos(a) * w * 0.5, ny = Math.sin(a) * w * 0.5;
        c2.beginPath();
        c2.moveTo(x - nx, y - ny);
        c2.quadraticCurveTo(mx - nx * 0.5, my - ny * 0.5, tx, ty);
        c2.quadraticCurveTo(mx + nx * 0.5, my + ny * 0.5, x + nx, y + ny);
        c2.closePath();
        c2.fill();
      }
      // An irregular, smooth-edged dab of paint.
      const blobPts = [];
      function blob(c2, x, y, r, rnd, pts, squash) {
        pts = pts || 11;
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * 6.2832;
          const rr = r * (0.82 + rnd() * 0.3);
          blobPts[i * 2] = x + Math.cos(a) * rr; blobPts[i * 2 + 1] = y + Math.sin(a) * rr * (squash || 1);
        }
        c2.beginPath();
        const mx = (i) => (blobPts[(i % pts) * 2] + blobPts[((i + 1) % pts) * 2]) / 2;
        const my = (i) => (blobPts[(i % pts) * 2 + 1] + blobPts[((i + 1) % pts) * 2 + 1]) / 2;
        c2.moveTo(mx(0), my(0));
        for (let i = 1; i <= pts; i++) c2.quadraticCurveTo(blobPts[(i % pts) * 2], blobPts[(i % pts) * 2 + 1], mx(i), my(i));
        c2.closePath();
        c2.fill();
      }

      // ---- Grain tile (dry brush flecks and paper tooth) ----
      let grainTile = null;
      function makeGrain() {
        const sz = 160;
        const c = makeCanvas(sz, sz), c2 = c.getContext("2d");
        const r = makeRng(77);
        for (let i = 0; i < 900; i++) {
          const x = r.f() * sz, y = r.f() * sz;
          c2.fillStyle = r.chance(0.5) ? "rgba(255,248,226," + (0.03 + r.f() * 0.05).toFixed(3) + ")" : "rgba(10,20,12," + (0.04 + r.f() * 0.06).toFixed(3) + ")";
          c2.fillRect(x, y, 0.6 + r.f() * 1.2, 0.6 + r.f() * 1.2);
        }
        for (let i = 0; i < 26; i++) {
          c2.strokeStyle = "rgba(240,232,210," + (0.03 + r.f() * 0.04).toFixed(3) + ")";
          c2.lineWidth = 0.5 + r.f();
          const x = r.f() * sz, y = r.f() * sz, a = r.f() * 6.28, l = 4 + r.f() * 12;
          c2.beginPath(); c2.moveTo(x, y); c2.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c2.stroke();
        }
        return c;
      }

      // ---- Cut-ground tiles (two stripe values per palette) ----
      const cutTiles = new Map();
      function cutTile(pal, stripe) {
        const key = pal.key * 2 + stripe + "_" + S.toFixed(1) + "_" + PS;
        let t = cutTiles.get(key);
        if (t) return t;
        const sz = Math.round(S * 4);
        const c = makeCanvas(sz * PS, sz * PS), c2 = c.getContext("2d");
        c2.scale(PS, PS);
        const base = stripe ? pal.cut[1] : pal.cut[2];
        c2.fillStyle = rgbStr(base); c2.fillRect(0, 0, sz, sz);
        const r = makeRng(1234 + stripe * 7 + pal.key);
        // Broad imperfect pigment bands following the direction of travel.
        for (let i = 0; i < 26; i++) {
          c2.fillStyle = rgbStr(r.chance(0.5) ? shade(base, 0.06) : shade(base, -0.06), 0.35);
          const x = r.f() * sz, w = S * (0.2 + r.f() * 0.5);
          c2.beginPath(); c2.ellipse(x, r.f() * sz, w * 0.5, S * (0.6 + r.f() * 1.2), 0, 0, 6.283); c2.fill();
          if (x < w) { c2.beginPath(); c2.ellipse(x + sz, r.f() * sz, w * 0.5, S, 0, 0, 6.283); c2.fill(); }
        }
        // Stubble: short upright marks, lighter and darker.
        for (let i = 0; i < sz * sz / 22; i++) {
          const x = r.f() * sz, y = r.f() * sz;
          const dark = r.chance(0.55);
          c2.strokeStyle = rgbStr(dark ? pal.cut[3] : shade(base, 0.14), dark ? 0.45 : 0.45);
          c2.lineWidth = 0.6 + r.f() * 0.7;
          const l = S * (0.03 + r.f() * 0.05), a = (r.f() - 0.5) * 0.6;
          c2.beginPath(); c2.moveTo(x, y); c2.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); c2.stroke();
        }
        // Sparse fallen clippings.
        for (let i = 0; i < 22; i++) {
          c2.strokeStyle = rgbStr(r.chance(0.5) ? pal.tuft[1] : pal.tuft[2], 0.5);
          c2.lineWidth = 0.8;
          const x = r.f() * sz, y = r.f() * sz, a = r.f() * 6.28, l = S * (0.05 + r.f() * 0.06);
          c2.beginPath(); c2.moveTo(x, y); c2.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c2.stroke();
        }
        if (grainTile) { c2.fillStyle = c2.createPattern(grainTile, "repeat"); c2.fillRect(0, 0, sz, sz); }
        t = { canvas: c, size: sz };
        if (cutTiles.size > 24) cutTiles.clear();
        cutTiles.set(key, t);
        return t;
      }

      // ---- Tuft sprites per region ----
      const tuftSprites = [];
      function tuftSpriteSet(reg) {
        let set = tuftSprites[reg];
        if (set) return set;
        const R = REGIONS[reg];
        const sc = 2;
        function make(isDense, seed) {
          const w = S * 1.3, h = S * 1.3;
          const c = makeCanvas(w * sc, h * sc), c2 = c.getContext("2d");
          c2.scale(sc, sc);
          const r = makeRng(seed);
          const bx = w / 2, by = h * 0.8;
          const cols = isDense ? R.dense : R.tuft;
          const style = r.int(0, 2); // 0 fan, 1 sweep, 2 low clump
          const n = isDense ? 13 + r.int(0, 5) : style === 2 ? 10 + r.int(0, 4) : 8 + r.int(0, 5);
          const lean = R.wind * 0.6 + (style === 1 ? 0.25 : 0);
          c2.fillStyle = rgbStr(shade(R.strokes[0], -0.25), 0.3);
          c2.beginPath(); c2.ellipse(bx, by, S * 0.2, S * 0.07, 0, 0, 6.283); c2.fill();
          for (let i = 0; i < n; i++) {
            const spread = style === 1 ? 0.75 : style === 2 ? 1.9 : 1.45;
            const a = lean + (r.f() - 0.5) * spread;
            const len = S * (isDense ? 0.4 + r.f() * 0.3 : style === 2 ? 0.17 + r.f() * 0.15 : style === 1 ? 0.34 + r.f() * 0.3 : 0.26 + r.f() * 0.26);
            const k = r.f();
            c2.fillStyle = rgbStr(k < 0.42 ? cols[0] : k < 0.85 ? cols[1] : cols[2], 0.92);
            blade(c2, bx + (r.f() - 0.5) * S * 0.18, by + (r.f() - 0.5) * S * 0.05, a, len, S * (0.032 + r.f() * 0.032), (r.f() - 0.5) * (style === 1 ? 0.8 : 0.5));
          }
          if (isDense) {
            for (let i = 0; i < 5; i++) {
              const a = lean + (r.f() - 0.5) * 1.1, len = S * (0.44 + r.f() * 0.22);
              const tx = bx + Math.sin(a) * len, ty = by - Math.cos(a) * len;
              c2.strokeStyle = rgbStr(cols[1], 0.9); c2.lineWidth = 0.8;
              c2.beginPath(); c2.moveTo(bx, by); c2.quadraticCurveTo(bx + Math.sin(a) * len * 0.5 + 1, by - Math.cos(a) * len * 0.5, tx, ty); c2.stroke();
              c2.fillStyle = rgbStr(cols[3]);
              c2.save(); c2.translate(tx, ty); c2.rotate(a);
              c2.beginPath(); c2.ellipse(0, -S * 0.03, S * 0.022, S * 0.065, 0, 0, 6.283); c2.fill();
              c2.fillStyle = rgbStr(shade(cols[3], -0.25), 0.6);
              for (let j = 0; j < 4; j++) c2.fillRect(-0.7, -S * 0.075 + j * S * 0.025, 1.4, 0.8);
              c2.restore();
            }
          } else if (r.f() < 0.5) {
            // a single dry-brush highlight, kept quiet
            c2.fillStyle = rgbStr(cols[2], 0.55);
            blade(c2, bx + (r.f() - 0.5) * S * 0.1, by, lean + (r.f() - 0.5) * 0.9, S * (0.2 + r.f() * 0.15), S * 0.018, 0.25);
          }
          return { c, w, h, ax: bx, ay: by };
        }
        set = { normal: [], dense: [] };
        for (let i = 0; i < 8; i++) set.normal.push(make(false, reg * 100 + i));
        for (let i = 0; i < 8; i++) set.dense.push(make(true, reg * 100 + 50 + i));
        tuftSprites[reg] = set;
        return set;
      }

      // ---- Flower sprites ----
      let flowerSprites = null;
      const FLOWER_COL = { daisy: [241, 236, 222], buttercup: [232, 200, 104], coral: [201, 124, 101], blue: [128, 156, 184] };
      function makeFlowerSprites() {
        const sc = 2, sz = S * 0.95;
        const sets = {};
        for (const type of FLOWER_TYPES) {
          sets[type] = [];
          for (let v = 0; v < 4; v++) {
            const crushed = v === 3;
            const c = makeCanvas(sz * sc, sz * sc), c2 = c.getContext("2d");
            c2.scale(sc, sc);
            const r = makeRng(type.length * 31 + v * 7 + 3);
            const cx = sz / 2, cy = sz / 2;
            // dark leaf rosette grounds the bloom on pale, cut ground
            c2.fillStyle = "rgba(20,36,24,0.28)";
            c2.beginPath(); c2.ellipse(cx + S * 0.03, cy + S * 0.04, S * 0.26, S * 0.2, 0, 0, 6.283); c2.fill();
            const leafN = 3 + r.int(0, 2);
            for (let i = 0; i < leafN; i++) {
              const a = r.f() * 6.28;
              c2.fillStyle = rgbStr(r.chance(0.5) ? [38, 60, 42] : [52, 75, 49], crushed ? 0.7 : 1);
              c2.save(); c2.translate(cx, cy); c2.rotate(a);
              c2.beginPath(); c2.ellipse(0, -S * 0.17, S * 0.05, S * 0.14, 0, 0, 6.283); c2.fill();
              c2.strokeStyle = "rgba(120,150,100,0.5)"; c2.lineWidth = 0.6;
              c2.beginPath(); c2.moveTo(0, -S * 0.05); c2.lineTo(0, -S * 0.27); c2.stroke();
              c2.restore();
            }
            if (crushed) {
              const col = FLOWER_COL[type];
              const dull = mixRGB(col, [120, 110, 90], 0.55);
              for (let i = 0; i < 6; i++) {
                c2.fillStyle = rgbStr(shade(dull, (r.f() - 0.5) * 0.2), 0.85);
                c2.save(); c2.translate(cx + (r.f() - 0.5) * S * 0.3, cy + (r.f() - 0.5) * S * 0.25); c2.rotate(r.f() * 6.28);
                c2.beginPath(); c2.ellipse(0, 0, S * 0.025, S * 0.06, 0, 0, 6.283); c2.fill(); c2.restore();
              }
              c2.strokeStyle = "rgba(80,90,50,0.8)"; c2.lineWidth = 1.2;
              c2.beginPath(); c2.moveTo(cx - S * 0.15, cy + S * 0.06); c2.quadraticCurveTo(cx, cy - S * 0.02, cx + S * 0.14, cy + S * 0.1); c2.stroke();
              c2.fillStyle = rgbStr(mixRGB([200, 160, 70], [110, 100, 70], 0.5));
              c2.beginPath(); c2.arc(cx + S * 0.05, cy + S * 0.04, S * 0.04, 0, 6.283); c2.fill();
              sets[type].push({ c, sz });
              continue;
            }
            const rot = r.f() * 6.28;
            if (type === "daisy") {
              const n = 11 + r.int(0, 3);
              for (let i = 0; i < n; i++) {
                const a = rot + (i / n) * 6.283 + (r.f() - 0.5) * 0.2;
                const len = S * (0.16 + r.f() * 0.04);
                c2.save(); c2.translate(cx, cy); c2.rotate(a);
                c2.fillStyle = rgbStr(Math.sin(a - 0.8) > 0.3 ? [214, 214, 200] : [244, 239, 226]);
                c2.beginPath(); c2.ellipse(0, -len * 0.55, S * 0.028, len * 0.5, 0, 0, 6.283); c2.fill();
                c2.restore();
              }
              c2.fillStyle = "rgb(214,170,62)"; c2.beginPath(); c2.arc(cx, cy, S * 0.055, 0, 6.283); c2.fill();
              c2.fillStyle = "rgba(150,105,30,0.7)";
              for (let i = 0; i < 7; i++) { const a = r.f() * 6.28, d = r.f() * S * 0.04; c2.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1, 1); }
              c2.fillStyle = "rgba(255,240,190,0.7)"; c2.beginPath(); c2.arc(cx - S * 0.018, cy - S * 0.02, S * 0.018, 0, 6.283); c2.fill();
            } else if (type === "buttercup") {
              for (let i = 0; i < 5; i++) {
                const a = rot + (i / 5) * 6.283;
                c2.save(); c2.translate(cx, cy); c2.rotate(a);
                c2.fillStyle = rgbStr([176, 132, 46]);
                c2.beginPath(); c2.ellipse(0, -S * 0.09, S * 0.085, S * 0.095, 0, 0, 6.283); c2.fill();
                c2.fillStyle = rgbStr([231, 199, 98]);
                c2.beginPath(); c2.ellipse(0, -S * 0.095, S * 0.072, S * 0.082, 0, 0, 6.283); c2.fill();
                c2.restore();
              }
              c2.fillStyle = "rgba(255,244,196,0.85)";
              c2.beginPath(); c2.ellipse(cx - S * 0.06, cy - S * 0.07, S * 0.03, S * 0.014, -0.6, 0, 6.283); c2.fill();
              c2.fillStyle = "rgb(150,120,40)"; c2.beginPath(); c2.arc(cx, cy, S * 0.04, 0, 6.283); c2.fill();
              c2.fillStyle = "rgba(240,220,140,0.9)";
              for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; c2.fillRect(cx + Math.cos(a) * S * 0.03 - 0.6, cy + Math.sin(a) * S * 0.03 - 0.6, 1.2, 1.2); }
            } else if (type === "coral") {
              for (let i = 0; i < 5; i++) {
                const a = rot + (i / 5) * 6.283;
                c2.save(); c2.translate(cx, cy); c2.rotate(a);
                c2.fillStyle = rgbStr([201, 124, 101]);
                c2.beginPath();
                c2.moveTo(0, 0);
                c2.quadraticCurveTo(S * 0.12, -S * 0.1, S * 0.05, -S * 0.21);
                c2.lineTo(0, -S * 0.17);
                c2.lineTo(-S * 0.05, -S * 0.21);
                c2.quadraticCurveTo(-S * 0.12, -S * 0.1, 0, 0);
                c2.fill();
                c2.strokeStyle = "rgba(140,70,58,0.6)"; c2.lineWidth = 0.6;
                c2.beginPath(); c2.moveTo(0, -S * 0.03); c2.lineTo(0, -S * 0.14); c2.stroke();
                c2.restore();
              }
              c2.fillStyle = "rgb(92,52,44)"; c2.beginPath(); c2.arc(cx, cy, S * 0.035, 0, 6.283); c2.fill();
              c2.fillStyle = "rgba(240,215,170,0.85)";
              for (let i = 0; i < 5; i++) { const a = rot + (i / 5) * 6.28 + 0.6; c2.fillRect(cx + Math.cos(a) * S * 0.05 - 0.6, cy + Math.sin(a) * S * 0.05 - 0.6, 1.3, 1.3); }
            } else {
              // pale blue: a cluster of tiny five-petal florets
              const flo = [[0, 0], [0.09, -0.06], [-0.08, -0.07], [-0.05, 0.08], [0.08, 0.07]];
              for (const [fx, fy] of flo) {
                const px = cx + fx * S, py = cy + fy * S;
                for (let i = 0; i < 5; i++) {
                  const a = rot + (i / 5) * 6.283;
                  c2.fillStyle = rgbStr(Math.sin(a) > 0.4 ? [108, 136, 166] : [140, 168, 196]);
                  c2.beginPath(); c2.arc(px + Math.cos(a) * S * 0.03, py + Math.sin(a) * S * 0.03, S * 0.028, 0, 6.283); c2.fill();
                }
                c2.fillStyle = "rgb(236,214,128)"; c2.beginPath(); c2.arc(px, py, S * 0.012, 0, 6.283); c2.fill();
              }
            }
            sets[type].push({ c, sz });
          }
        }
        return sets;
      }

      // ---- Mower sprite: a small vintage mower, painted ----
      let mowerSprite = null, shadowSprite = null;
      function makeMower() {
        const sc = 3;
        const w = S * 0.9, h = S * 1.55;
        const c = makeCanvas(w * sc, h * sc), c2 = c.getContext("2d");
        c2.scale(sc, sc);
        const r = makeRng(9);
        const cx = w / 2, cy = S * 0.5; // deck centre
        const dw = S * 0.31, dh = S * 0.34;
        // handle (behind): two dark rails meeting at a cream grip
        c2.strokeStyle = "#2b2622"; c2.lineWidth = S * 0.05; c2.lineCap = "round";
        c2.beginPath(); c2.moveTo(cx - dw * 0.62, cy + dh * 0.6); c2.lineTo(cx - S * 0.11, cy + S * 0.98); c2.stroke();
        c2.beginPath(); c2.moveTo(cx + dw * 0.62, cy + dh * 0.6); c2.lineTo(cx + S * 0.11, cy + S * 0.98); c2.stroke();
        c2.strokeStyle = "#3a332c"; c2.lineWidth = S * 0.03;
        c2.beginPath(); c2.moveTo(cx - S * 0.17, cy + S * 0.78); c2.lineTo(cx + S * 0.17, cy + S * 0.78); c2.stroke();
        c2.strokeStyle = "#e9dfc7"; c2.lineWidth = S * 0.07;
        c2.beginPath(); c2.moveTo(cx - S * 0.2, cy + S * 1.0); c2.lineTo(cx + S * 0.2, cy + S * 1.0); c2.stroke();
        c2.strokeStyle = "rgba(120,100,80,0.5)"; c2.lineWidth = 0.7;
        c2.beginPath(); c2.moveTo(cx - S * 0.18, cy + S * 1.02); c2.lineTo(cx + S * 0.18, cy + S * 1.02); c2.stroke();
        // deck: vermilion, imperfect painted edge
        const pts = [];
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * 6.2832;
          const sq = Math.pow(Math.abs(Math.cos(a)), 0.6) * Math.sign(Math.cos(a));
          const sy = Math.pow(Math.abs(Math.sin(a)), 0.6) * Math.sign(Math.sin(a));
          pts.push([cx + sq * dw * (0.97 + r.f() * 0.05), cy + sy * dh * (0.97 + r.f() * 0.05)]);
        }
        c2.fillStyle = "#8f3a2a";
        c2.beginPath(); pts.forEach((p, i) => (i ? c2.lineTo(p[0] + 0.8, p[1] + 1) : c2.moveTo(p[0] + 0.8, p[1] + 1))); c2.closePath(); c2.fill();
        c2.fillStyle = "#c9573f";
        c2.beginPath(); pts.forEach((p, i) => (i ? c2.lineTo(p[0], p[1]) : c2.moveTo(p[0], p[1]))); c2.closePath(); c2.fill();
        // pigment variation on the body
        for (let i = 0; i < 14; i++) {
          c2.fillStyle = r.chance(0.5) ? "rgba(214,110,80,0.35)" : "rgba(160,64,46,0.3)";
          c2.beginPath(); c2.ellipse(cx + (r.f() - 0.5) * dw * 1.4, cy + (r.f() - 0.5) * dh * 1.4, S * 0.05, S * 0.025, r.f() * 3, 0, 6.283); c2.fill();
        }
        // front lip and grille
        c2.fillStyle = "#7d3324";
        c2.fillRect(cx - dw * 0.8, cy - dh * 0.98, dw * 1.6, S * 0.05);
        c2.strokeStyle = "rgba(50,24,18,0.6)"; c2.lineWidth = 0.7;
        for (let i = -3; i <= 3; i++) { c2.beginPath(); c2.moveTo(cx + i * dw * 0.2, cy - dh * 0.92); c2.lineTo(cx + i * dw * 0.2, cy - dh * 0.75); c2.stroke(); }
        // highlight along the upper-left edge
        c2.strokeStyle = "rgba(240,170,130,0.75)"; c2.lineWidth = 1.2; c2.lineCap = "round";
        c2.beginPath(); c2.moveTo(cx - dw * 0.85, cy + dh * 0.2); c2.quadraticCurveTo(cx - dw * 0.9, cy - dh * 0.75, cx - dw * 0.1, cy - dh * 0.84); c2.stroke();
        // engine cap
        c2.fillStyle = "#e7dcc3"; c2.beginPath(); c2.arc(cx, cy + S * 0.02, S * 0.12, 0, 6.283); c2.fill();
        c2.fillStyle = "rgba(150,130,100,0.6)"; c2.beginPath(); c2.arc(cx + S * 0.02, cy + S * 0.04, S * 0.1, 0, 6.283); c2.fill();
        c2.fillStyle = "#efe6d0"; c2.beginPath(); c2.arc(cx - S * 0.008, cy + S * 0.01, S * 0.095, 0, 6.283); c2.fill();
        c2.fillStyle = "#2e2a26"; c2.beginPath(); c2.arc(cx, cy + S * 0.02, S * 0.04, 0, 6.283); c2.fill();
        c2.strokeStyle = "#2e2a26"; c2.lineWidth = 0.8;
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; c2.beginPath(); c2.moveTo(cx + Math.cos(a) * S * 0.055, cy + S * 0.02 + Math.sin(a) * S * 0.055); c2.lineTo(cx + Math.cos(a) * S * 0.085, cy + S * 0.02 + Math.sin(a) * S * 0.085); c2.stroke(); }
        // small fuel cap and rear flap
        c2.fillStyle = "#2e2a26"; c2.beginPath(); c2.arc(cx + dw * 0.55, cy - dh * 0.5, S * 0.025, 0, 6.283); c2.fill();
        c2.fillStyle = "#6d2c20"; c2.fillRect(cx - dw * 0.55, cy + dh * 0.86, dw * 1.1, S * 0.04);
        mowerSprite = { c, w, h, ax: cx, ay: cy, dw, dh };
        // soft cast shadow
        const ss = S * 1.3, sc2 = 2;
        const sh = makeCanvas(ss * sc2, ss * sc2), s2 = sh.getContext("2d");
        s2.scale(sc2, sc2);
        const grd = s2.createRadialGradient(ss / 2, ss / 2, 0, ss / 2, ss / 2, ss / 2);
        grd.addColorStop(0, "rgba(14,26,16,0.5)"); grd.addColorStop(0.55, "rgba(14,26,16,0.22)"); grd.addColorStop(1, "rgba(14,26,16,0)");
        s2.fillStyle = grd; s2.fillRect(0, 0, ss, ss);
        shadowSprite = { c: sh, s: ss };
      }

      // ---- Obstacle sprites ----
      function obstacleSprite(o) {
        if (o.spr && o.spr.S === S) return o.spr;
        const sc = 2, pad = S * 0.35;
        const w = o.w * S + pad * 2, h = o.h * S + pad * 2;
        const c = makeCanvas(w * sc, h * sc), c2 = c.getContext("2d");
        c2.scale(sc, sc);
        const r = makeRng(o.seed);
        const x0 = pad, y0 = pad, ow = o.w * S, oh = o.h * S;
        const cx = x0 + ow / 2, cy = y0 + oh / 2;
        if (o.kind === "pond") {
          c2.fillStyle = "rgba(16,30,20,0.35)";
          blob(c2, cx + S * 0.06, cy + S * 0.08, 1, r.f, 18);
          const rx = ow * 0.5, ry = oh * 0.5;
          const shape = (k, dx, dy) => { c2.beginPath(); for (let i = 0; i <= 22; i++) { const a = (i / 22) * 6.283; const j = 0.9 + 0.12 * Math.sin(a * 3 + o.seed) + 0.05 * Math.sin(a * 7); const px = cx + dx + Math.cos(a) * rx * k * j, py = cy + dy + Math.sin(a) * ry * k * j; if (i) c2.lineTo(px, py); else c2.moveTo(px, py); } c2.closePath(); c2.fill(); };
          c2.fillStyle = "rgba(18,34,24,0.45)"; shape(1.02, S * 0.05, S * 0.07);
          c2.fillStyle = "#4d6e5a"; shape(1, 0, 0);
          c2.fillStyle = "#7daba6"; shape(0.88, 0, -S * 0.02);
          c2.fillStyle = "#93bbb4"; shape(0.6, -S * 0.15, -S * 0.12);
          c2.strokeStyle = "rgba(230,240,230,0.55)"; c2.lineWidth = 1;
          for (let i = 0; i < 4; i++) { const yy = cy - oh * 0.25 + i * oh * 0.15, xx = cx - ow * 0.2 + r.f() * ow * 0.2; c2.beginPath(); c2.moveTo(xx, yy); c2.lineTo(xx + S * (0.2 + r.f() * 0.3), yy); c2.stroke(); }
          for (let i = 0; i < 2; i++) {
            const px = cx + (r.f() - 0.2) * ow * 0.45, py = cy + (r.f() - 0.3) * oh * 0.4;
            c2.fillStyle = "#6f8a5e"; c2.beginPath(); c2.arc(px, py, S * 0.13, 0.4, 6.0); c2.lineTo(px, py); c2.fill();
            c2.strokeStyle = "rgba(40,60,40,0.6)"; c2.lineWidth = 0.7; c2.beginPath(); c2.arc(px, py, S * 0.13, 0.4, 6.0); c2.stroke();
          }
          c2.strokeStyle = "#2f4a30"; c2.lineWidth = 1.4; c2.lineCap = "round";
          for (let i = 0; i < 16; i++) {
            const a = r.f() * 6.283, px = cx + Math.cos(a) * rx * 0.98, py = cy + Math.sin(a) * ry * 0.98;
            const l = S * (0.15 + r.f() * 0.2);
            c2.beginPath(); c2.moveTo(px, py); c2.lineTo(px + Math.cos(a) * l * 0.4 + 2, py - l); c2.stroke();
          }
        } else if (o.kind === "fence") {
          c2.fillStyle = "rgba(16,28,18,0.4)";
          c2.fillRect(x0 + S * 0.05, cy - S * 0.03 + S * 0.1, ow - S * 0.1, S * 0.16);
          c2.fillStyle = "#8e8370"; c2.fillRect(x0, cy - S * 0.12, ow, S * 0.1);
          c2.fillStyle = "#b5a88e"; c2.fillRect(x0, cy - S * 0.12, ow, S * 0.04);
          c2.fillStyle = "#867b68"; c2.fillRect(x0, cy + S * 0.06, ow, S * 0.08);
          c2.fillStyle = "#a99c82"; c2.fillRect(x0, cy + S * 0.06, ow, S * 0.03);
          c2.strokeStyle = "rgba(60,50,40,0.5)"; c2.lineWidth = 0.6;
          for (let i = 0; i < o.w * 3; i++) { const xx = x0 + r.f() * ow; c2.beginPath(); c2.moveTo(xx, cy - S * 0.1); c2.lineTo(xx + S * 0.1, cy - S * 0.09); c2.stroke(); }
          for (let k = 0; k <= o.w; k++) {
            const px = x0 + Math.min(ow - S * 0.12, k * S - (k === o.w ? S * 0.12 : 0));
            c2.fillStyle = "rgba(16,28,18,0.4)"; c2.fillRect(px + S * 0.05, cy - S * 0.12, S * 0.16, S * 0.32);
            c2.fillStyle = "#6e6454"; c2.fillRect(px, cy - S * 0.17, S * 0.13, S * 0.34);
            c2.fillStyle = "#9c8f78"; c2.fillRect(px, cy - S * 0.17, S * 0.13, S * 0.06);
          }
          c2.strokeStyle = "#3b5a37"; c2.lineWidth = 1;
          for (let i = 0; i < 8; i++) { const xx = x0 + r.f() * ow; c2.beginPath(); c2.moveTo(xx, cy + S * 0.2); c2.lineTo(xx + 2, cy - S * 0.05); c2.stroke(); }
        } else if (o.kind === "stone") {
          // a painted stone sitting in the grass; its outline averages the collision circle
          const scx = x0 + (o.shape.cx - o.x) * S, scy = y0 + (o.y + o.h - o.shape.cy) * S;
          const R = o.shape.r * S * 1.02, sz = o.size;
          const outline = (rad, squash, n, dx, dy) => {
            c2.beginPath();
            const pts = [];
            for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832 + o.seed % 7; const k = 0.88 + r.f() * 0.22; pts.push([scx + dx + Math.cos(a) * rad * k, scy + dy + Math.sin(a) * rad * k * squash]); }
            const mid = (i) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
            let m0 = mid(0); c2.moveTo(m0[0], m0[1]);
            for (let i = 1; i <= n; i++) { const m = mid(i); c2.quadraticCurveTo(pts[i % n][0], pts[i % n][1], m[0], m[1]); }
            c2.closePath();
          };
          const flat = sz === 0 ? 0.78 : sz === 1 ? 0.92 : 0.95;
          // contact shadow: soft, offset down-right, deeper for taller stones
          const sh = [0.05, 0.09, 0.13][sz];
          c2.fillStyle = "rgba(12,24,14,0.22)"; outline(R * 1.12, flat, 12, S * sh * 0.9, S * sh * 1.1); c2.fill();
          c2.fillStyle = "rgba(12,24,14,0.3)"; outline(R * 1.0, flat, 12, S * sh * 0.5, S * sh * 0.6); c2.fill();
          const base = sz === 0 ? [178, 171, 152] : sz === 1 ? [142, 136, 122] : [118, 116, 104];
          c2.fillStyle = rgbStr(base); outline(R, flat, sz === 1 ? 8 : 11, 0, 0); c2.fill();
          // shaded lower-right, lit upper-left facets
          c2.save(); outline(R, flat, sz === 1 ? 8 : 11, 0, 0); c2.clip();
          c2.fillStyle = rgbStr(shade(base, -0.28), 0.55); outline(R * 0.9, flat, 9, R * 0.35, R * 0.38); c2.fill();
          c2.fillStyle = rgbStr(shade(base, 0.18), 0.75); outline(R * 0.55, flat * 0.9, 8, -R * 0.3, -R * 0.32); c2.fill();
          c2.fillStyle = rgbStr(shade(base, 0.32), 0.6); outline(R * 0.22, 0.8, 7, -R * 0.42, -R * 0.45); c2.fill();
          if (sz === 2) {
            // moss on the shaded crown, lichen flecks
            for (let i = 0; i < 6; i++) { c2.fillStyle = r.f() < 0.5 ? "rgba(101,119,71,0.85)" : "rgba(137,147,91,0.75)"; blob(c2, scx + (r.f() - 0.3) * R * 0.9, scy + (r.f() - 0.6) * R * 0.8, R * (0.12 + r.f() * 0.16), r.f, 8); }
            c2.fillStyle = "rgba(214,212,180,0.7)"; for (let i = 0; i < 7; i++) { c2.beginPath(); c2.arc(scx + (r.f() - 0.5) * R * 1.2, scy + (r.f() - 0.5) * R, S * 0.012, 0, 6.283); c2.fill(); }
          } else {
            c2.strokeStyle = rgbStr(shade(base, -0.35), 0.5); c2.lineWidth = 0.8;
            c2.beginPath(); c2.moveTo(scx - R * 0.4, scy - R * 0.05); c2.quadraticCurveTo(scx, scy + R * 0.15, scx + R * 0.35, scy + R * 0.05); c2.stroke();
            c2.fillStyle = "rgba(90,110,60,0.6)"; for (let i = 0; i < 4; i++) c2.fillRect(scx + (r.f() - 0.2) * R * 0.8, scy + (r.f() - 0.1) * R * 0.6, 1.3, 1.3);
          }
          c2.restore();
          // grass blades growing against the base embed it in the meadow
          for (let i = 0; i < 7 + sz * 3; i++) {
            const a = Math.PI * (0.15 + r.f() * 0.7);
            c2.fillStyle = r.f() < 0.5 ? "rgba(48,71,45,0.9)" : "rgba(75,102,59,0.9)";
            blade(c2, scx + Math.cos(a) * R * 0.95, scy + Math.sin(a) * R * flat * 0.95, (r.f() - 0.5) * 0.9, S * (0.08 + r.f() * 0.1), S * 0.03, 0.2);
          }
        } else if (o.kind === "stump") {
          c2.fillStyle = "rgba(14,26,16,0.4)"; c2.beginPath(); c2.arc(cx + S * 0.08, cy + S * 0.1, S * 0.36, 0, 6.283); c2.fill();
          c2.fillStyle = "#5a4636"; blob(c2, cx, cy, S * 0.36, r.f, 12);
          c2.fillStyle = "#b8976c"; c2.beginPath(); c2.arc(cx, cy, S * 0.28, 0, 6.283); c2.fill();
          c2.strokeStyle = "rgba(110,80,50,0.7)"; c2.lineWidth = 0.8;
          for (let k = 1; k <= 4; k++) { c2.beginPath(); c2.arc(cx + S * 0.02, cy - S * 0.01, S * 0.06 * k, 0, 6.283); c2.stroke(); }
          c2.strokeStyle = "rgba(70,50,30,0.6)"; c2.beginPath(); c2.moveTo(cx, cy); c2.lineTo(cx + S * 0.22, cy - S * 0.12); c2.stroke();
        } else {
          // shrub: dark, layered, clearly solid
          c2.fillStyle = "rgba(10,20,12,0.45)"; blob(c2, cx + S * 0.08, cy + S * 0.1, S * 0.42, r.f, 12);
          c2.fillStyle = "#1c3022"; blob(c2, cx, cy, S * 0.42, r.f, 13);
          c2.fillStyle = "#2b4630"; for (let i = 0; i < 5; i++) blob(c2, cx + (r.f() - 0.6) * S * 0.4, cy + (r.f() - 0.6) * S * 0.4, S * (0.12 + r.f() * 0.08), r.f, 9);
          c2.fillStyle = "#4b6a43"; for (let i = 0; i < 6; i++) blob(c2, cx + (r.f() - 0.7) * S * 0.35, cy + (r.f() - 0.7) * S * 0.35, S * 0.05, r.f, 7);
          c2.fillStyle = "rgba(201,124,101,0.0)";
        }
        o.spr = { c, w, h, pad, S };
        return o.spr;
      }

      // ---- Chunks: painted meadow sections with the mown trail stamped in ----
      const chunks = new Map();
      const jobs = [];
      function chunkOf(row) { return Math.floor(row / CH); }
      function getChunk(k, sync) {
        let ch = chunks.get(k);
        if (!ch) {
          ch = { k, canvas: makeCanvas(chunkW * PS, CH * S * PS), done: false, job: null, stampsTo: 0 };
          ch.job = paintChunk(ch);
          chunks.set(k, ch);
          jobs.push(ch);
        }
        if (sync && !ch.done) finishChunk(ch);
        return ch;
      }
      function finishChunk(ch) {
        while (!ch.done) { const r = ch.job.next(); if (r.done) ch.done = true; }
        const i = jobs.indexOf(ch); if (i >= 0) jobs.splice(i, 1);
      }
      function runJobs(budgetMs) {
        const t0 = performance.now();
        while (jobs.length && performance.now() - t0 < budgetMs) {
          const ch = jobs[0];
          const r = ch.job.next();
          if (r.done) { ch.done = true; jobs.shift(); }
        }
      }
      function* paintChunk(ch) {
        // Everything is anchored to world coordinates with per-feature seeds, so neighbouring
        // chunks paint identical marks across their shared edge and no seam appears.
        const c2 = ch.canvas.getContext("2d");
        c2.setTransform(PS, 0, 0, PS, 0, 0);
        const r0 = ch.k * CH, top = r0 + CH;
        const offX = fieldX0 - chunkX;
        const HH = CH * S;
        const X = (x) => offX + x * S;
        const Y = (row) => (top - row) * S;
        const sd = (runSeed % 100000) + 11;
        const hs = (a, b, c) => Math.floor(hash2(a, b, sd + c) * 4294967295);
        const xMin = -offX / S, xMax = (chunkW - offX) / S;
        // Layer A: base meadow with slow hue shifts and large soft value masses
        const grd = c2.createLinearGradient(0, 0, 0, HH);
        for (let i = 0; i <= 4; i++) { const pal = paletteAt(top - i * CH / 4); grd.addColorStop(i / 4, rgbStr(pal.ground[1])); }
        c2.fillStyle = grd; c2.fillRect(0, 0, chunkW, HH);
        const B = 1.15;
        for (let gy = Math.floor((r0 - 2.5) / B); gy <= Math.ceil((top + 2.5) / B); gy++) {
          for (let gx = Math.floor(xMin / B) - 2; gx <= Math.ceil(xMax / B) + 2; gx++) {
            const rn = mulberry32(hs(gx, gy, 1));
            if (rn() > 0.6) continue;
            const wx = (gx + rn()) * B, wy = (gy + rn()) * B;
            const pal = paletteAt(wy);
            const n = fbm(wx * 0.22, wy * 0.22, sd);
            const lush = lushAt(wx, wy, runSeed);
            c2.fillStyle = rgbStr(lush > 0.58 ? pal.ground[0] : n > 0.55 ? pal.ground[2] : n < 0.42 ? pal.ground[0] : pal.ground[1], 0.3 + rn() * 0.22);
            blob(c2, X(wx), Y(wy), S * (0.5 + rn() * 1.3), rn, 12, 0.7 + rn() * 0.6);
          }
        }
        // Clearings: a few broad, soft washes of sunlit ground where the meadow thins out
        const Cg = 1.7;
        for (let gy = Math.floor((r0 - 3) / Cg); gy <= Math.ceil((top + 3) / Cg); gy++) {
          for (let gx = Math.floor(-0.5 / Cg); gx <= Math.ceil((LANES + 0.5) / Cg); gx++) {
            const rn = mulberry32(hs(gx, gy, 11));
            const wx = (gx + 0.5 + (rn() - 0.5) * 0.6) * Cg, wy = (gy + 0.5 + (rn() - 0.5) * 0.6) * Cg;
            const lush = lushAt(wx, wy, runSeed);
            if (lush > 0.45 || wx < 0 || wx > LANES) continue;
            const pal = paletteAt(wy);
            const k = clamp01((0.45 - lush) * 6);
            const col = mixRGB(pal.ground[2], pal.cut[0], 0.25 + 0.25 * k);
            for (let j = 0; j < 3; j++) {
              c2.fillStyle = rgbStr(col, 0.13 + 0.1 * k);
              blob(c2, X(wx + (rn() - 0.5) * 0.8), Y(wy + (rn() - 0.5) * 0.8), S * (1.0 + rn() * 0.9), rn, 14, 0.75 + rn() * 0.4);
            }
          }
        }
        yield;
        // Layer B: clustered grass strokes following a soft flow field
        const st = 0.5;
        let count = 0;
        for (let gy = Math.floor((r0 - 1) / st); gy <= Math.ceil((top + 1) / st); gy++) {
          for (let gx = Math.floor(xMin / st) - 1; gx <= Math.ceil(xMax / st) + 1; gx++) {
            const rn = mulberry32(hs(gx, gy, 2));
            const wx = (gx + rn()) * st, wy = (gy + rn()) * st;
            const inField = wx > -0.15 && wx < LANES + 0.15;
            if (!inField && (wx < -0.9 || wx > LANES + 0.9)) continue; // the shrub border covers this
            const pal = paletteAt(wy);
            const lane = Math.floor(wx), cell = (wx >= 0 && wx < LANES) ? sim.gen.cell(Math.floor(wy), lane) : null;
            const isPath = cell && cell.t === CELL_PATH, isDense = cell && cell.t === CELL_DENSE;
            const lush = inField ? lushAt(wx, wy, runSeed) : 0.55;
            let n = Math.round((inField ? 7 : 5) * pal.density * clamp(0.2 + (lush - 0.3) * 3.2, 0.25, 1.6));
            if (isPath) n = 1;
            if (isDense) n += 5;
            const flow = (fbm(wx * 0.18, wy * 0.18, sd + 5) - 0.5) * 1.4 + pal.wind * 0.9;
            const cx = X(wx), cy = Y(wy);
            for (let i = 0; i < n; i++) {
              const bx = cx + (rn() - 0.5) * st * S * 1.2, by = cy + (rn() - 0.5) * st * S * 1.2;
              const li = rn();
              const cols = isDense ? pal.dense : pal.strokes;
              const col = isDense ? cols[li < 0.4 ? 0 : li < 0.8 ? 1 : 2] : cols[li < 0.28 ? 0 : li < 0.6 ? 1 : li < 0.9 ? 2 : 3];
              c2.fillStyle = rgbStr(col, 0.72 + rn() * 0.28);
              blade(c2, bx, by, flow + (rn() - 0.5) * 0.7, S * (0.16 + rn() * 0.3), S * (0.025 + rn() * 0.035), (rn() - 0.5) * 0.4);
            }
            if (rn() < 0.18) {
              c2.fillStyle = rgbStr(pal.strokes[4], 0.45);
              blade(c2, cx, cy, flow + (rn() - 0.5) * 0.5, S * (0.18 + rn() * 0.2), S * 0.016, 0.2);
            }
            if (++count % 80 === 0) yield;
          }
        }
        // broad gouache washes knit the strokes together
        const Wg = 2.6;
        for (let gy = Math.floor((r0 - 3) / Wg); gy <= Math.ceil((top + 3) / Wg); gy++) {
          for (let gx = Math.floor(xMin / Wg) - 1; gx <= Math.ceil(xMax / Wg) + 1; gx++) {
            const rn = mulberry32(hs(gx, gy, 3));
            const wx = (gx + rn()) * Wg, wy = (gy + rn()) * Wg;
            const pal = paletteAt(wy);
            c2.fillStyle = rgbStr(rn() < 0.5 ? pal.ground[0] : pal.ground[2], 0.11);
            blob(c2, X(wx), Y(wy), S * (0.8 + rn()), rn, 10, 0.5);
          }
        }
        yield;
        // Bare footpaths: worn earth through the grass
        for (let row = r0 - 1; row <= top; row++) {
          for (let l = 0; l < LANES; l++) {
            const c = sim.gen.cell(row, l);
            if (!c || c.t !== CELL_PATH) continue;
            const rn = mulberry32(hs(l, row, 4));
            const pal = paletteAt(row);
            const px = X(l + 0.5), py = Y(row + 0.5);
            c2.fillStyle = rgbStr(pal.path[1], 0.8);
            blob(c2, px, py, S * 0.44, rn, 12, 1.25);
            c2.fillStyle = rgbStr(pal.path[0], 0.95);
            blob(c2, px + (rn() - 0.5) * 2, py, S * 0.36, rn, 12, 1.3);
            for (const d of [-1, 0, 1]) {
              const n = sim.gen.cell(row + 1, l + d);
              if (n && n.t === CELL_PATH) {
                c2.strokeStyle = rgbStr(pal.path[0], 0.95); c2.lineWidth = S * 0.62; c2.lineCap = "round";
                c2.beginPath(); c2.moveTo(px, py); c2.lineTo(X(l + d + 0.5), Y(row + 1.5)); c2.stroke();
              }
            }
            for (let i = 0; i < 5; i++) {
              c2.fillStyle = rgbStr(rn() < 0.5 ? pal.path[2] : shade(pal.path[0], 0.15), 0.8);
              c2.beginPath(); c2.ellipse(px + (rn() - 0.5) * S * 0.6, py + (rn() - 0.5) * S * 0.7, S * 0.03, S * 0.022, rn() * 3, 0, 6.283); c2.fill();
            }
            for (let i = 0; i < 6; i++) {
              const side = rn() < 0.5 ? -1 : 1;
              c2.fillStyle = rgbStr(pal.strokes[2], 0.9);
              blade(c2, px + side * S * (0.3 + rn() * 0.1), py + (rn() - 0.5) * S, pal.wind - side * 0.5, S * (0.12 + rn() * 0.1), S * 0.03, 0);
            }
          }
        }
        yield;
        // Layer E: observed details (fallen leaves, small stones, clover)
        const Dg = 2.2;
        for (let gy = Math.floor((r0 - 1) / Dg); gy <= Math.ceil((top + 1) / Dg); gy++) {
          for (let gx = Math.floor(xMin / Dg); gx <= Math.ceil(xMax / Dg); gx++) {
            const rn = mulberry32(hs(gx, gy, 5));
            if (rn() > 0.42) continue;
            const wx = (gx + rn()) * Dg, wy = (gy + rn()) * Dg;
            const x = X(wx), y = Y(wy);
            const kind = rn();
            const pal = paletteAt(wy);
            if (kind < 0.35) {
              c2.fillStyle = rn() < 0.5 ? "rgba(176,128,72,0.8)" : "rgba(150,90,60,0.75)";
              c2.save(); c2.translate(x, y); c2.rotate(rn() * 6.28);
              c2.beginPath(); c2.ellipse(0, 0, S * 0.07, S * 0.035, 0, 0, 6.283); c2.fill();
              c2.strokeStyle = "rgba(90,60,30,0.6)"; c2.lineWidth = 0.6; c2.beginPath(); c2.moveTo(-S * 0.07, 0); c2.lineTo(S * 0.08, 0); c2.stroke();
              c2.restore();
            } else if (kind < 0.6) {
              c2.fillStyle = "rgba(20,30,20,0.3)"; c2.beginPath(); c2.ellipse(x + 1, y + 1.2, S * 0.04, S * 0.03, 0, 0, 6.283); c2.fill();
              c2.fillStyle = "rgba(170,165,150,0.9)"; c2.beginPath(); c2.ellipse(x, y, S * 0.04, S * 0.03, rn(), 0, 6.283); c2.fill();
              c2.fillStyle = "rgba(220,215,200,0.8)"; c2.beginPath(); c2.arc(x - S * 0.012, y - S * 0.01, S * 0.012, 0, 6.283); c2.fill();
            } else {
              c2.fillStyle = rgbStr(shade(pal.ground[2], 0.1), 0.6);
              for (let k = 0; k < 6; k++) {
                const cx = x + (rn() - 0.5) * S * 0.6, cy = y + (rn() - 0.5) * S * 0.4;
                for (let j = 0; j < 3; j++) { const a = j * 2.1 + rn(); c2.beginPath(); c2.arc(cx + Math.cos(a) * S * 0.025, cy + Math.sin(a) * S * 0.025, S * 0.024, 0, 6.283); c2.fill(); }
              }
            }
          }
        }
        yield;
        // Tall grass that does not sway is painted once; the mown stamp covers it where cut.
        for (let row = top + 1; row >= r0 - 1; row--) {
          const rw = sim.gen.row(row);
          if (!rw) continue;
          for (const t of rw.tufts) {
            if (t.live) continue;
            const spr = (t.d ? tuftSpriteSet(t.reg).dense : tuftSpriteSet(t.reg).normal)[t.sv];
            c2.save(); c2.translate(X(t.x), Y(t.y)); c2.rotate((t.ph - 3.14) * 0.03);
            c2.scale(t.fl ? -t.sc : t.sc, t.sc);
            c2.drawImage(spr.c, -spr.ax, -spr.ay, spr.w, spr.h);
            c2.restore();
          }
        }
        yield;
        // Borders: dark shrub masses, tree crowns and an old fence frame the meadow
        for (const side of [-1, 1]) {
          const edge = side < 0 ? 0 : LANES;
          const far = side < 0 ? xMin : xMax;
          const sb = 0.45;
          for (let gy = Math.floor((r0 - 2) / sb); gy <= Math.ceil((top + 2) / sb); gy++) {
            const rn = mulberry32(hs(side, gy, 6));
            const wy = gy * sb;
            const pal = paletteAt(wy);
            const n = fbm(wy * 0.15, side * 10, sd + 9);
            const reach = 0.18 + n * 0.25;
            const bx = edge - side * 0.15 + side * rn() * 0.3;
            const y = Y(wy);
            for (let k = 0; k < 4; k++) {
              const wx = lerp(bx + side * reach, far, rn() * 0.9);
              c2.fillStyle = rgbStr(pal.border[k === 0 ? 0 : rn() < 0.5 ? 0 : 1], 0.85 + rn() * 0.15);
              blob(c2, X(wx), y + (rn() - 0.5) * S * 0.4, S * (0.35 + rn() * 0.4), rn, 12);
            }
            c2.fillStyle = rgbStr(pal.border[2], 0.8);
            for (let k = 0; k < 3; k++) blob(c2, X(lerp(bx + side * reach * 1.2, far, rn() * 0.8)) - side * S * 0.08, y - S * 0.12 + (rn() - 0.5) * S * 0.3, S * (0.08 + rn() * 0.1), rn, 8);
            c2.fillStyle = rgbStr(pal.border[1], 0.9);
            for (let k = 0; k < 4; k++) blade(c2, X(edge) + side * S * (0.12 + rn() * 0.1), y + rn() * S * 0.45, -side * (0.6 + rn() * 0.6), S * (0.15 + rn() * 0.12), S * 0.04, 0);
          }
          // a tree crown now and then, partly off the page
          const TG = 7;
          for (let gy = Math.floor((r0 - 4) / TG); gy <= Math.ceil((top + 4) / TG); gy++) {
            const rn = mulberry32(hs(side * 3, gy, 7));
            if (rn() > 0.55) continue;
            const wy = (gy + rn()) * TG;
            const wx = far - side * rn() * 0.6;
            const pal = paletteAt(wy);
            const R = S * (1.3 + rn() * 0.9);
            const tx = X(wx), ty = Y(wy);
            c2.fillStyle = "rgba(10,20,12,0.35)"; blob(c2, tx + S * 0.3, ty + S * 0.35, R, rn, 16);
            c2.fillStyle = rgbStr(pal.border[0]); blob(c2, tx, ty, R, rn, 16);
            c2.fillStyle = rgbStr(pal.border[1]);
            for (let k = 0; k < 7; k++) blob(c2, tx + (rn() - 0.6) * R, ty + (rn() - 0.6) * R, R * (0.25 + rn() * 0.2), rn, 11);
            c2.fillStyle = rgbStr(pal.border[2], 0.85);
            for (let k = 0; k < 9; k++) blob(c2, tx + (rn() - 0.75) * R * 0.9, ty + (rn() - 0.75) * R * 0.9, R * (0.06 + rn() * 0.08), rn, 8);
          }
          // weathered fence posts along stretches of the edge
          const FG = 12;
          for (let gy = Math.floor((r0 - FG) / FG); gy <= Math.ceil((top + 1) / FG); gy++) {
            const rn = mulberry32(hs(side * 5, gy, 8));
            if (rn() > 0.45) continue;
            const wy0 = gy * FG + rn() * 4, wy1 = wy0 + 4 + rn() * 6;
            const fx = X(edge - side * 0.32);
            c2.strokeStyle = "rgba(150,138,112,0.85)"; c2.lineWidth = S * 0.05;
            c2.beginPath(); c2.moveTo(fx, Y(wy0)); c2.lineTo(fx, Y(wy1)); c2.stroke();
            for (let wy = wy0; wy <= wy1; wy += 1.1) {
              const y = Y(wy);
              c2.fillStyle = "rgba(16,28,18,0.4)"; c2.fillRect(fx - S * 0.04 + S * 0.05, y + S * 0.05, S * 0.12, S * 0.12);
              c2.fillStyle = "#857a66"; c2.fillRect(fx - S * 0.06, y - S * 0.06, S * 0.12, S * 0.12);
              c2.fillStyle = "#a99d84"; c2.fillRect(fx - S * 0.06, y - S * 0.06, S * 0.12, S * 0.04);
            }
          }
        }
        yield;
        // Layer D: grain and paper tooth, aligned to the world so it continues across chunks
        if (grainTile) {
          const pat = c2.createPattern(grainTile, "repeat");
          if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().translateSelf(0, (top * S) % grainTile.height));
          c2.fillStyle = pat; c2.fillRect(0, 0, chunkW, HH);
        }
        // Re-apply any mown trail that already crosses this chunk (resize/repaint).
        replayTrail(ch);
      }

      // ---- Mown trail stamping ----
      function stampOn(ch, ax, ay, bx, by, stripe, pal) {
        const c2 = ch.canvas.getContext("2d");
        const top = ch.k * CH + CH, offX = fieldX0 - chunkX;
        const tile = cutTile(pal, stripe);
        if (!ch.pats) ch.pats = new Map();
        let pat = ch.pats.get(tile);
        if (!pat) {
          pat = c2.createPattern(tile.canvas, "repeat");
          if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") {
            const ty = ((top * S) % tile.size + tile.size) % tile.size;
            pat.setTransform(new DOMMatrix().translateSelf(offX, ty).scaleSelf(1 / PS, 1 / PS));
          }
          if (ch.pats.size > 6) ch.pats.clear();
          ch.pats.set(tile, pat);
        }
        c2.fillStyle = pat || rgbStr(stripe ? pal.cut[1] : pal.cut[2]);
        const x0 = offX + ax * S, y0 = (top - ay) * S, x1 = offX + bx * S, y1 = (top - by) * S;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(dist / (S * 0.1)));
        c2.beginPath();
        for (let i = 0; i <= n; i++) {
          const t = i / n, px = lerp(x0, x1, t), py = lerp(y0, y1, t);
          const wy = lerp(ay, by, t);
          const rr = S * CUT_R * (0.9 + 0.07 * noise2(wy * 3.1, 0, 5) + 0.07 * hash2(Math.floor(wy * 60), 3, 9));
          c2.moveTo(px + rr, py);
          c2.ellipse(px, py, rr, rr * 0.92, 0, 0, 6.2832);
        }
        c2.fill();
        // faint wheel tracks pressed into the cut grass
        c2.strokeStyle = rgbStr(shade(stripe ? pal.cut[1] : pal.cut[2], -0.14), 0.3);
        c2.lineWidth = Math.max(1, S * 0.05); c2.lineCap = "round";
        for (const side of [-1, 1]) {
          c2.beginPath(); c2.moveTo(x0 + side * S * 0.3, y0); c2.lineTo(x1 + side * S * 0.3, y1); c2.stroke();
        }
      }
      function fringeOn(ch, x, y, stripe, pal, rnd) {
        const c2 = ch.canvas.getContext("2d");
        const top = ch.k * CH + CH, offX = fieldX0 - chunkX;
        const px = offX + x * S, py = (top - y) * S;
        // uncut grass at the swath edge flops over the fresh cut
        for (const side of [-1, 1]) {
          for (let k = 0; k < 2; k++) {
            if (rnd() < 0.7) {
              const col = rnd();
              c2.fillStyle = rgbStr(col < 0.4 ? pal.strokes[0] : col < 0.8 ? pal.strokes[1] : pal.strokes[2], 0.92);
              blade(c2, px + side * S * (CUT_R + 0.04 + rnd() * 0.04), py + (rnd() - 0.5) * S * 0.25, -side * (0.35 + rnd() * 0.7), S * (0.1 + rnd() * 0.15), S * 0.034, -side * 0.25);
            }
          }
        }
        if (rnd() < 0.5) {
          // a few clippings settle on the freshly cut ground behind the mower
          c2.strokeStyle = rgbStr(rnd() < 0.5 ? pal.tuft[1] : shade(pal.cut[0], -0.12), 0.65);
          c2.lineWidth = 0.9;
          const cx = px + (rnd() - 0.5) * S * 0.7, cy = py + S * (0.55 + rnd() * 0.3), a = rnd() * 6.28, l = S * (0.04 + rnd() * 0.05);
          c2.beginPath(); c2.moveTo(cx, cy); c2.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); c2.stroke();
        }
      }
      let fringeRnd = mulberry32(5);
      function stampSegment(a, b) {
        const pal = paletteAt(b.y);
        const kLo = chunkOf(Math.floor(Math.min(a.y, b.y) - 1)), kHi = chunkOf(Math.floor(Math.max(a.y, b.y) + 1));
        for (let k = kLo; k <= kHi; k++) {
          const ch = getChunk(k, true);
          if (!b.path) stampOn(ch, a.x, a.y, b.x, b.y, b.stripe, pal);
        }
        if (!b.path) {
          const fb = mulberry32(Math.floor(b.y * 97) + 3);
          const ch = getChunk(chunkOf(Math.floor(b.y)), true);
          fringeOn(ch, b.x, b.y, b.stripe, pal, fb);
          const chb = chunkOf(Math.floor(b.y - 0.9));
          if (chb !== ch.k) fringeOn(getChunk(chb, true), b.x, b.y, b.stripe, pal, fb);
        }
      }
      function replayTrail(ch) {
        const lo = ch.k * CH - 1, hi = ch.k * CH + CH + 1;
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i];
          if (b.y < lo || a.y > hi || b.path) continue;
          const pal = paletteAt(b.y);
          stampOn(ch, a.x, a.y, b.x, b.y, b.stripe, pal);
          fringeOn(ch, b.x, b.y, b.stripe, pal, mulberry32(Math.floor(b.y * 97) + 3));
        }
      }
      function recordTrail() {
        const s = sim.s;
        const last = trail[trail.length - 1];
        const cell = sim.gen.cell(Math.floor(s.y), Math.floor(s.x));
        const pt = { x: s.x, y: s.y, stripe: Math.round(s.x - 0.5) & 1, path: !!(cell && cell.t === CELL_PATH) };
        if (!last) { trail.push(pt); return; }
        if (Math.abs(pt.y - last.y) + Math.abs(pt.x - last.x) < 0.06) return;
        trail.push(pt);
        stampSegment(last, pt);
        if (trail.length > 1400) trail.splice(0, trail.length - 1400);
      }

      function rebuildArt() {
        grainTile = grainTile || makeGrain();
        tuftSprites.length = 0; cutTiles.clear();
        flowerSprites = makeFlowerSprites();
        makeMower();
        chunks.clear(); jobs.length = 0;
      }
      function ensureChunks(bg) {
        const s = sim.s;
        const z = Math.min(zoom, 1);
        const rowsAhead = (anchorCur / (S * z)) + 2, rowsBehind = ((H - anchorCur) / (S * z)) + 2;
        const lo = chunkOf(Math.floor(camY - rowsBehind)), hi = chunkOf(Math.floor(camY + rowsAhead));
        sim.gen.ensure((hi + 2) * CH + CH);
        for (let k = lo; k <= hi; k++) getChunk(k, !bg);
        if (bg) { getChunk(hi + 1, false); }
        for (const [k, ch] of chunks) if (k < lo - 3 || k > hi + 3) { chunks.delete(k); const i = jobs.indexOf(ch); if (i >= 0) jobs.splice(i, 1); }
        return s;
      }
      function paintVisibleNow() { ensureChunks(false); }

      // =======================================================================
      // Rendering the frame
      // =======================================================================
      const screenX = (x) => fieldX0 + x * S;
      const screenY = (y) => anchorCur - (y - camY) * S;
      let windT = 0, rHiT = 0;
      function drawWorld(dt) {
        const s = sim.s;
        g.fillStyle = "#30472f"; g.fillRect(0, 0, W, H);
        g.save();
        if (zoom !== 1) { g.translate(W / 2, anchorCur); g.scale(zoom, zoom); g.translate(-W / 2, -anchorCur); }
        // painted chunks
        const z = zoom;
        const TFc = window.__LM_FLAGS || null;
        const rowsAhead = anchorCur / (S * z) + 1.5, rowsBehind = (H - anchorCur) / (S * z) + 1.5;
        const rLo = Math.floor(camY - rowsBehind), rHi = Math.ceil(camY + rowsAhead);
        for (let k = chunkOf(rLo); k <= chunkOf(rHi); k++) {
          const ch = chunks.get(k);
          if (!ch) continue;
          if (!ch.done) finishChunk(ch);
          if (TFc && TFc.noChunks) continue;
          const topRow = k * CH + CH;
          g.drawImage(ch.canvas, chunkX, Math.round(screenY(topRow) * 2) / 2 - 0.5, chunkW, CH * S + 1);
        }
        // obstacles
        for (const o of sim.gen.obstacles.values()) {
          if (o.y > rHi + 1 || o.y + o.h < rLo - 1) continue;
          const spr = obstacleSprite(o);
          g.drawImage(spr.c, screenX(o.x) - spr.pad, screenY(o.y + o.h) - spr.pad, spr.w, spr.h);
        }
        // tall grass tufts (live, wind-animated, removed when cut)
        windT += dt;
        const TF = window.__LM_FLAGS || null;
        if (TF && TF.noTufts) rHiT = rLo - 1; else rHiT = rHi;
        const mx = s.x, my = s.y;
        for (let r = rHiT; r >= rLo; r--) {
          const row = sim.gen.row(r);
          if (!row) continue;
          const pal = paletteAt(r);
          const amp = 0.05 * pal.windAmp;
          for (const t of row.tufts) {
            if (t.cut || !t.live) continue;
            const set = tuftSpriteSet(t.reg);
            const spr = t.d ? set.dense[t.sv] : set.normal[t.sv];
            const gust = 0.5 + 0.5 * Math.sin(windT * 0.7 - t.y * 0.35 + t.x * 0.4);
            let a = amp * (0.4 + gust) * Math.sin(windT * 2.2 + t.ph);
            const dx = t.x - mx, dy = t.y - my;
            if (dy > -1.2 && dy < 1.3 && dx > -1.5 && dx < 1.5 && phase !== "ready") a += Math.sign(dx) * 0.28 * Math.max(0, 1 - Math.hypot(dx, dy) / 1.5);
            const px = screenX(t.x), py = screenY(t.y);
            g.save(); g.translate(px, py); g.rotate(a);
            const sc = t.sc;
            g.scale(t.fl ? -sc : sc, sc);
            g.drawImage(spr.c, -spr.ax, -spr.ay, spr.w, spr.h);
            g.restore();
          }
        }
        // flowers
        for (let r = rLo; r <= rHi; r++) {
          const row = sim.gen.row(r);
          if (!row) continue;
          for (const f of row.flowers) {
            const set = flowerSprites[f.type];
            const px = screenX(f.x), py = screenY(f.y);
            if (f.hit) {
              const spr = set[3];
              g.drawImage(spr.c, px - spr.sz / 2, py - spr.sz / 2, spr.sz, spr.sz);
              continue;
            }
            const spr = set[f.v];
            let rot = Math.sin(windT * 1.6 + f.ph) * 0.06;
            let sc = 1;
            const since = s.time - f.nearT;
            if (since >= 0 && since < 0.6) { const k = 1 - since / 0.6; sc = 1 + 0.16 * k * Math.sin(since * 18); rot += 0.25 * k * Math.sin(since * 14); }
            const dx = f.x - s.x, dy = f.y - s.y;
            if (s.invuln > 0 && dx * dx + dy * dy < 0.5) sc *= 0.82;
            g.save(); g.translate(px, py); g.rotate(rot); g.scale(sc, sc);
            g.drawImage(spr.c, -spr.sz / 2, -spr.sz / 2, spr.sz, spr.sz);
            g.restore();
            if (since >= 0 && since < 0.45) {
              const k = since / 0.45;
              g.strokeStyle = "rgba(245,236,205," + (0.38 * (1 - k)).toFixed(3) + ")"; g.lineWidth = 1;
              g.beginPath(); g.arc(px, py, S * (0.22 + 0.2 * k), 0, 6.283); g.stroke();
            }
          }
        }
        // petals from a struck flower
        for (const p of particles.petals) {
          if (!p.on) continue;
          const k = p.life / p.max;
          g.fillStyle = rgbStr(p.col, 0.9 * (1 - k * k));
          g.save(); g.translate(screenX(p.x), screenY(p.y)); g.rotate(p.rot);
          g.beginPath(); g.ellipse(0, 0, S * p.sz * 0.45, S * p.sz, 0, 0, 6.283); g.fill(); g.restore();
        }
        for (const rb of sim.rabbits) if (rb.y > rLo - 1 && rb.y < rHi + 1) drawRabbit(rb);
        drawMower(dt);
        // clippings flicked backward
        g.lineCap = "round";
        for (const p of particles.clips) {
          if (!p.on) continue;
          const k = p.life / p.max;
          g.strokeStyle = rgbStr(p.col, 0.95 * (1 - k));
          g.lineWidth = Math.max(1, S * 0.03);
          const px = screenX(p.x), py = screenY(p.y) - p.z * S * 0.25;
          const l = p.len * S;
          g.beginPath(); g.moveTo(px - Math.cos(p.rot) * l, py - Math.sin(p.rot) * l); g.lineTo(px + Math.cos(p.rot) * l, py + Math.sin(p.rot) * l); g.stroke();
        }
        g.restore();
        // pollen drifting in the light (screen space, very quiet)
        for (const p of particles.pollen) {
          g.fillStyle = "rgba(246,236,196," + (0.22 + 0.15 * Math.sin(p.ph * 2)).toFixed(3) + ")";
          g.beginPath(); g.arc(p.x * W, p.y * H, 1.1 * p.s, 0, 6.283); g.fill();
        }
        drawButterfly();
        // gentle light and vignette
        g.drawImage(lightOverlay(), 0, 0, W, H);
        if (hitFlash > 0) {
          const k = hitFlash;
          const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
          grd.addColorStop(0, "rgba(201,124,101,0)"); grd.addColorStop(1, "rgba(160,80,64," + (0.32 * k).toFixed(3) + ")");
          g.fillStyle = grd; g.fillRect(0, 0, W, H);
        }
      }
      let lightCache = null;
      function lightOverlay() {
        if (lightCache && lightCache.W === W && lightCache.H === H) return lightCache.c;
        const c = makeCanvas(W, H), c2 = c.getContext("2d");
        const grd = c2.createRadialGradient(W * 0.38, H * 0.3, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
        grd.addColorStop(0, "rgba(255,244,214,0.07)"); grd.addColorStop(0.55, "rgba(255,244,214,0)"); grd.addColorStop(1, "rgba(14,26,18,0.34)");
        c2.fillStyle = grd; c2.fillRect(0, 0, W, H);
        const band = (area.top || 0) + 112;
        const top = c2.createLinearGradient(0, 0, 0, band);
        top.addColorStop(0, "rgba(12,22,14,0.5)"); top.addColorStop(0.55, "rgba(12,22,14,0.22)"); top.addColorStop(1, "rgba(12,22,14,0)");
        c2.fillStyle = top; c2.fillRect(0, 0, W, band);
        lightCache = { c, W, H };
        return c;
      }
      const RABBIT_COL = { cautious: [152, 134, 113], wanderer: [146, 106, 76], skittish: [128, 114, 99] };
      // A rabbit seen from above. Its logical position is the centre of its body; the pose is
      // drawn around it: crouch, stretch in the air, squash on landing, ears up when alert.
      function drawRabbit(rb) {
        const st = rb.state, time = sim.s.time;
        let px = screenX(rb.x), py = screenY(rb.y);
        let h = 0, sx = 1, sy = 1;
        if (rb.hop) {
          const hp = rb.hop, ta = hp.t - hp.crouch;
          if (ta < 0) { const k = hp.t / hp.crouch; sy = 1 - 0.2 * k; sx = 1 + 0.1 * k; }
          else if (ta < hp.dur) { const p = ta / hp.dur; h = Math.sin(Math.PI * p); sy = 1 + 0.28 * h; sx = 0.9; }
          else { const k = 1 - (ta - hp.dur) / hp.land; sy = 1 - 0.14 * k; sx = 1 + 0.08 * k; }
        } else if (st === "alert") { sy = 0.9; sx = 1.05; }
        else if (st === "freeze") { sy = 0.84; sx = 1.08; }
        let alpha = 1;
        if (rb.x < 0) alpha = clamp01(1 + rb.x * 0.8); else if (rb.x > LANES) alpha = clamp01(1 - (rb.x - LANES) * 0.8);
        if (alpha <= 0) return;
        g.globalAlpha = alpha;
        // ground shadow stays on the grass while the body lifts
        g.fillStyle = "rgba(14,26,16," + (0.3 * (1 - 0.4 * h)).toFixed(3) + ")";
        g.beginPath(); g.ellipse(px + S * (0.04 + 0.1 * h), py + S * (0.05 + 0.16 * h), S * 0.15 * (1 - 0.2 * h), S * 0.11 * (1 - 0.2 * h), 0, 0, 6.283); g.fill();
        py -= h * S * 0.26;
        const base = RABBIT_COL[rb.profile] || RABBIT_COL.cautious;
        const dark = shade(base, -0.32), light = shade(base, 0.24), cream = [236, 228, 210];
        const alert = st === "alert" || (rb.hop && rb.hop.kind !== "wander");
        const frozen = st === "freeze";
        const forage = st === "forage";
        const R = S * 1.18; // drawing scale: body ~0.55 cell long around a 0.19-cell collision radius
        g.save(); g.translate(px, py); g.rotate(rb.face); g.scale(sx * (1 + 0.25 * h), sy * (1 + 0.25 * h));
        // haunches: the wide rear of a teardrop, with a cream scut
        g.fillStyle = rgbStr(base); g.beginPath(); g.ellipse(0, R * 0.06, R * 0.135, R * 0.14, 0, 0, 6.283); g.fill();
        g.beginPath(); g.ellipse(0, -R * 0.03, R * 0.1, R * 0.12, 0, 0, 6.283); g.fill();
        g.fillStyle = rgbStr(light, 0.6);
        for (const e of [-1, 1]) { g.beginPath(); g.ellipse(e * R * 0.1, R * 0.07, R * 0.03, R * 0.085, -e * 0.2, 0, 6.283); g.fill(); }
        g.fillStyle = rgbStr(dark, 0.4); g.beginPath(); g.ellipse(0, R * 0.01, R * 0.045, R * 0.12, 0, 0, 6.283); g.fill();
        if (alert || frozen) { // hind feet show when it crouches
          g.fillStyle = rgbStr(dark, 0.8);
          for (const e of [-1, 1]) { g.beginPath(); g.ellipse(e * R * 0.12, R * 0.15, R * 0.025, R * 0.05, e * 0.15, 0, 6.283); g.fill(); }
        }
        g.fillStyle = rgbStr(cream); g.beginPath(); g.arc(0, R * 0.2, R * 0.038, 0, 6.283); g.fill();
        // head: turns while idle, dips and nibbles while foraging, lifts when alert
        const turn = st === "idle" ? Math.sin(rb.headT * 0.9) * 0.4 : st === "alert" ? Math.sin(rb.headT * 2.5) * 0.15 : 0;
        const dip = forage ? R * (0.03 + 0.008 * Math.sin(rb.headT * 11)) : alert ? -R * 0.01 : 0;
        g.save(); g.translate(0, -R * 0.1); g.rotate(turn); g.translate(0, -dip);
        const tw = alert ? Math.sin(rb.headT * 21) * 0.2 * (Math.sin(rb.headT * 3) > 0.3 ? 1 : 0) : 0;
        const ear = (e) => {
          g.save();
          if (alert) {
            // raised in a V, catching the light on their inner faces
            g.translate(e * R * 0.035, -R * 0.06); g.rotate(e * 0.42 + tw * e);
            g.fillStyle = rgbStr(dark); g.beginPath(); g.ellipse(0, -R * 0.06, R * 0.026, R * 0.075, 0, 0, 6.283); g.fill();
            g.fillStyle = "rgba(214,178,160,0.75)"; g.beginPath(); g.ellipse(0, -R * 0.055, R * 0.012, R * 0.05, 0, 0, 6.283); g.fill();
          } else {
            // laid back along the shoulders (pressed tight when frozen)
            g.translate(e * R * (frozen ? 0.02 : 0.03), -R * 0.0); g.rotate(e * (frozen ? 0.05 : 0.14));
            g.fillStyle = rgbStr(dark); g.beginPath(); g.ellipse(0, R * 0.075, R * 0.024, R * 0.09, 0, 0, 6.283); g.fill();
            g.fillStyle = "#2c2520"; g.beginPath(); g.ellipse(0, R * 0.15, R * 0.016, R * 0.022, 0, 0, 6.283); g.fill();
          }
          g.restore();
        };
        if (!alert) { ear(-1); ear(1); }
        g.fillStyle = rgbStr(shade(base, 0.06)); g.beginPath(); g.ellipse(0, -R * 0.06, R * 0.068, R * 0.08, 0, 0, 6.283); g.fill();
        g.fillStyle = rgbStr(light, 0.55); g.beginPath(); g.ellipse(0, -R * 0.1, R * 0.04, R * 0.03, 0, 0, 6.283); g.fill();
        if (alert) { ear(-1); ear(1); }
        g.fillStyle = "#211b17";
        g.beginPath(); g.arc(-R * 0.052, -R * 0.075, R * 0.013, 0, 6.283); g.fill();
        g.beginPath(); g.arc(R * 0.052, -R * 0.075, R * 0.013, 0, 6.283); g.fill();
        g.fillStyle = "rgba(130,86,74,0.9)"; g.beginPath(); g.arc(0, -R * 0.135, R * 0.011, 0, 6.283); g.fill();
        g.restore();
        g.restore();
        g.globalAlpha = 1;
      }
      let wheelPhase = 0;
      function drawMower(dt) {
        const s = sim.s;
        let px = screenX(s.x), py = screenY(s.y);
        const t = performance.now() / 1000;
        const moving = phase === "play" && s.speed > 0.1;
        wheelPhase += (s.speed || 0) * dt * S * 0.9;
        let rot = s.yaw;
        let vib = phase === "over" ? Math.max(0, 1 - overT * 1.5) : 1;
        if (phase === "paused") vib = 0.3;
        rot += Math.sin(t * 23) * 0.012 * vib + (moving ? Math.sin(t * 7.3) * 0.015 : 0);
        px += (Math.random() - 0.5) * 0.7 * vib; py += (Math.random() - 0.5) * 0.6 * vib;
        // collision jolt: small recoil and shake
        const sinceHit = s.time - (s.lastHitT || -9);
        if (sinceHit >= 0 && sinceHit < 0.4) { const k = 1 - sinceHit / 0.4; rot += Math.sin(sinceHit * 40) * 0.12 * k; py += 3 * k; }
        const sinceBump = s.time - s.bumpT;
        if (sinceBump >= 0 && sinceBump < 0.25) px += s.bumpDir * Math.sin((sinceBump / 0.25) * Math.PI) * S * 0.08;
        const blink = s.invuln > 0 && phase === "play" ? 0.55 + 0.45 * Math.cos(s.invuln * 18) : 1;
        // shadow
        g.globalAlpha = 0.9;
        g.drawImage(shadowSprite.c, px - shadowSprite.s / 2 + S * 0.07, py - shadowSprite.s / 2 + S * 0.16, shadowSprite.s, shadowSprite.s * 1.05);
        g.globalAlpha = blink;
        g.save(); g.translate(px, py); g.rotate(rot);
        // wheels with rolling tread
        const m = mowerSprite;
        const wx = m.dw * 1.02, wy = m.dh * 0.68;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const cx = sx * wx, cy = sy * wy;
          g.fillStyle = "#26231f";
          g.fillRect(cx - S * 0.055, cy - S * 0.1, S * 0.11, S * 0.2);
          g.strokeStyle = "rgba(120,110,95,0.7)"; g.lineWidth = 0.8;
          for (let i = 0; i < 3; i++) {
            const off = ((wheelPhase * 0.5 + i * S * 0.066) % (S * 0.2)) - S * 0.1;
            g.beginPath(); g.moveTo(cx - S * 0.05, cy + off); g.lineTo(cx + S * 0.05, cy + off); g.stroke();
          }
        }
        g.drawImage(m.c, -m.ax, -m.ay, m.w, m.h);
        g.restore();
        g.globalAlpha = 1;
      }
      function drawButterfly() {
        const b = particles.butterfly;
        if (!b.on) return;
        const k = b.t / b.dur;
        const x = b.fromLeft ? lerp(-0.1, 1.1, k) : lerp(1.1, -0.1, k);
        const y = lerp(b.y0, b.y1, k) + Math.sin(b.t * 1.7 + b.ph) * 0.03;
        const px = x * W, py = (area.top + 70) + y * H * 0.5;
        const flap = Math.abs(Math.sin(b.t * 13));
        g.save(); g.translate(px, py); g.rotate(b.fromLeft ? 0.3 : -0.3);
        g.fillStyle = rgbStr(b.col, 0.9);
        const ws = S * 0.11;
        g.beginPath(); g.ellipse(-ws * 0.55 * flap, 0, ws * 0.55 * flap + 0.5, ws * 0.8, -0.3, 0, 6.283); g.fill();
        g.beginPath(); g.ellipse(ws * 0.55 * flap, 0, ws * 0.55 * flap + 0.5, ws * 0.8, 0.3, 0, 6.283); g.fill();
        g.fillStyle = "rgba(50,40,30,0.8)"; g.fillRect(-0.6, -ws * 0.5, 1.2, ws);
        g.restore();
      }

      // =======================================================================
      // HUD — a quiet editorial layer over the painting.
      // Two typefaces: a sans for everything you read while playing (numerals on a fixed grid so
      // the score never shifts), an italic serif for the few moments of stillness.
      // =======================================================================
      const UI = {
        sans: FONT_SANS, serif: FONT_SERIF,
        size: { micro: 11, small: 13, body: 15, score: 30, lead: 21, title: 44, result: 56, button: 16 },
        color: {
          cream: "#f1e8d5", creamDim: "rgba(241,232,213,0.66)", creamFaint: "rgba(241,232,213,0.34)",
          ink: "#26352a", inkSoft: "rgba(38,53,42,0.66)", inkFaint: "rgba(38,53,42,0.34)",
          ochre: "#e2c66f", accent: "#c9573f", accentDown: "#a7432f", paper: "#efe7d4",
          rule: "rgba(38,53,42,0.2)", shade: "rgba(12,22,14,0.55)", veil: "rgba(12,22,14,0.42)"
        },
        space: { edge: 20, top: 14, pad: 24 },
        touch: 44,
        motion: { panelIn: 0.45, lifeFlash: 0.6 }
      };
      let reduceMotion = false;
      try { reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { /* default */ }
      const buttons = { pause: null, sound: null, again: null };
      let uiPress = null; // the control under a finger that has not lifted yet
      let scoreWarm = 0, panelBottom = 0;
      function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
      function setFont(o) { g.font = (o.italic ? "italic " : "") + (o.weight || 400) + " " + o.size + "px " + (o.family || UI.sans.f); }
      function track(px) { try { if ("letterSpacing" in g) g.letterSpacing = (px || 0) + "px"; } catch (e) { /* unsupported */ } }
      // Set type. o: size, weight, family, italic, color, align, alpha, track, shade (soft shadow over the meadow)
      function type(str, x, y, o) {
        setFont(o); track(o.track);
        g.textAlign = o.align || "left"; g.textBaseline = "alphabetic";
        g.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * hudFade;
        if (o.shade) { g.shadowColor = UI.color.shade; g.shadowBlur = 5; g.shadowOffsetY = 1; }
        g.fillStyle = o.color; g.fillText(str, x, y);
        g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
        track(0); g.globalAlpha = 1;
      }
      // Numerals on a fixed advance: canvas cannot ask for tabular figures, so we place them ourselves.
      const digitCache = new Map();
      function digitW(o) {
        setFont(o);
        const key = g.font;
        let w = digitCache.get(key);
        if (!w) { w = { d: 0, comma: g.measureText(",").width, x: g.measureText("×").width }; for (let i = 0; i < 10; i++) w.d = Math.max(w.d, g.measureText(String(i)).width); digitCache.set(key, w); }
        return w;
      }
      function numWidth(str, o) { const w = digitW(o); let t = 0; for (const ch of str) t += ch >= "0" && ch <= "9" ? w.d : ch === "," ? w.comma : g.measureText(ch).width; return t; }
      function num(str, x, y, o) {
        const w = digitW(o), total = numWidth(str, o);
        let cx = o.align === "right" ? x - total : o.align === "center" ? x - total / 2 : x;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * hudFade;
        if (o.shade) { g.shadowColor = UI.color.shade; g.shadowBlur = 5; g.shadowOffsetY = 1; }
        g.fillStyle = o.color;
        for (const ch of str) { const cw = ch >= "0" && ch <= "9" ? w.d : ch === "," ? w.comma : g.measureText(ch).width; g.fillText(ch, cx + cw / 2, y); cx += cw; }
        g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0; g.globalAlpha = 1;
        return total;
      }
      function rule(x0, x1, y, color, alpha) { g.globalAlpha = (alpha === undefined ? 1 : alpha) * hudFade; g.fillStyle = color; g.fillRect(x0, Math.round(y) - 0.5, x1 - x0, 1); g.globalAlpha = 1; }
      const pressed = (id) => uiPress && uiPress.id === id;
      let hudFade = 1;

      function drawHUD(dt) {
        const s = sim.s;
        const T = area.top + UI.space.top, L = area.left + UI.space.edge, R = W - area.right - UI.space.edge;
        hudFade = phase === "over" ? Math.max(0, 1 - overT * 2.5) : 1;
        if (hudFade <= 0.01) { buttons.pause = null; buttons.sound = null; hudFade = 1; return; }
        // score: a small label over a steady number
        shownScore += (s.score - shownScore) * Math.min(1, dt * 14);
        if (Math.abs(s.score - shownScore) < 0.5) shownScore = s.score;
        scoreWarm = Math.max(0, scoreWarm - dt * 2.5);
        type("score", L, T + 10, { size: UI.size.micro, color: UI.color.creamDim, track: 1.2, shade: true });
        num(fmt(shownScore), L - 1, T + 41, { size: UI.size.score, weight: 600, color: scoreWarm > 0.05 ? mixCss(UI.color.cream, UI.color.ochre, scoreWarm) : UI.color.cream, shade: true });
        // lives: three small marks; a lost one flashes the accent, then becomes an empty ring
        const ly = T + 58;
        for (let i = 0; i < cfg.lives; i++) {
          const alive = i < s.lives, x = L + 4 + i * 13;
          if (!alive) lifeAnim[i] = Math.min(1, (lifeAnim[i] || 0) + dt / UI.motion.lifeFlash);
          g.globalAlpha = hudFade;
          g.shadowColor = UI.color.shade; g.shadowBlur = 4;
          g.beginPath(); g.arc(x, ly - 4, 3.6, 0, 6.283);
          if (alive) { g.fillStyle = UI.color.cream; g.fill(); }
          else if (lifeAnim[i] < 1 && !reduceMotion) { g.fillStyle = mixCss(UI.color.accent, "rgba(241,232,213,0)", lifeAnim[i]); g.fill(); }
          g.shadowBlur = 0; g.shadowColor = "transparent";
          if (!alive) { g.strokeStyle = UI.color.creamFaint; g.lineWidth = 1; g.beginPath(); g.arc(x, ly - 4, 3.1, 0, 6.283); g.stroke(); }
        }
        g.globalAlpha = 1;
        // rhythm: "×3" and a hairline that fills toward the next step
        const lvl = s.level;
        if (lvl !== lastLevel) { if (lvl < lastLevel) { multDropT = s.time; multDropFrom = lastLevel + 1; } lastLevel = lvl; }
        const drop = s.time - multDropT;
        const rx = L + cfg.lives * 13 + 12;
        if (lvl > 0) {
          const w = num("×" + (lvl + 1), rx, ly, { size: UI.size.small, weight: 600, color: UI.color.ochre, shade: true });
          const maxed = lvl >= cfg.maxMult - 1, need = chargeFor(lvl), mx = rx + w + 7;
          rule(mx, mx + 24, ly - 4.5, UI.color.creamFaint);
          rule(mx, mx + 24 * (maxed ? 1 : clamp01(s.charge / need)), ly - 4.5, UI.color.ochre);
        } else if (drop >= 0 && drop < 0.6) {
          num("×" + multDropFrom, rx, ly, { size: UI.size.small, weight: 600, color: UI.color.accent, alpha: 1 - drop / 0.6, shade: true });
        } else if (s.charge > 0) {
          rule(rx, rx + 24, ly - 4.5, UI.color.creamFaint);
          rule(rx, rx + 24 * clamp01(s.charge / chargeFor(0)), ly - 4.5, UI.color.ochre);
        }
        // controls, top right: small glyphs, generous touch targets
        const cy = T + 14, half = UI.touch / 2;
        const px = R - 8, sx = px - UI.touch;
        g.globalAlpha = hudFade * (pressed("pause") ? 0.5 : 0.92);
        g.shadowColor = UI.color.shade; g.shadowBlur = 4;
        g.fillStyle = UI.color.cream;
        if (phase === "paused") { g.beginPath(); g.moveTo(px - 4, cy - 6.5); g.lineTo(px + 6, cy); g.lineTo(px - 4, cy + 6.5); g.closePath(); g.fill(); }
        else { g.fillRect(px - 5, cy - 6.5, 3, 13); g.fillRect(px + 2, cy - 6.5, 3, 13); }
        g.globalAlpha = hudFade * (pressed("sound") ? 0.5 : 0.92);
        const on = sfxOn || musicOn;
        g.beginPath(); g.moveTo(sx - 7, cy - 2.5); g.lineTo(sx - 3.5, cy - 2.5); g.lineTo(sx + 1, cy - 6.5); g.lineTo(sx + 1, cy + 6.5); g.lineTo(sx - 3.5, cy + 2.5); g.lineTo(sx - 7, cy + 2.5); g.closePath(); g.fill();
        g.strokeStyle = UI.color.cream; g.lineWidth = 1.3; g.lineCap = "round";
        if (on) { g.beginPath(); g.arc(sx + 2, cy, 4.5, -0.75, 0.75); g.stroke(); g.beginPath(); g.arc(sx + 2, cy, 8, -0.75, 0.75); g.stroke(); }
        else { g.beginPath(); g.moveTo(sx + 4, cy - 3.5); g.lineTo(sx + 9.5, cy + 3.5); g.moveTo(sx + 9.5, cy - 3.5); g.lineTo(sx + 4, cy + 3.5); g.stroke(); }
        g.shadowBlur = 0; g.shadowColor = "transparent"; g.lineCap = "butt"; g.globalAlpha = 1;
        buttons.pause = phase === "play" || phase === "paused" ? { x: px - half, y: cy - half, w: UI.touch, h: UI.touch } : null;
        buttons.sound = { x: sx - half, y: cy - half, w: UI.touch, h: UI.touch };
        // personal best, right-aligned beneath the controls and subordinate to the score
        if (best > 0) {
          const bw = num(fmt(best), R, T + 41, { size: UI.size.small, color: UI.color.creamDim, align: "right", shade: true });
          type("best", R - bw - 6, T + 41, { size: UI.size.micro, color: UI.color.creamFaint, align: "right", track: 1.2, shade: true });
        }
        // seed-patch bonus, beside the mower (never in the HUD band)
        for (const p of particles.floats) {
          if (!p.on) continue;
          const k = p.life / p.max;
          num(p.text, screenX(p.x) + S * 0.6, screenY(p.y) - (reduceMotion ? 0 : k * 22), { size: UI.size.small, weight: 600, color: UI.color.ochre, alpha: 1 - k, shade: true });
        }
        hudFade = 1;
      }
      function mixCss(a, b, t) {
        const p = (c) => { if (c[0] === "#") { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; } const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] === undefined ? 1 : m[3]]; };
        const A = p(a), B = p(b);
        return "rgba(" + Math.round(lerp(A[0], B[0], t)) + "," + Math.round(lerp(A[1], B[1], t)) + "," + Math.round(lerp(A[2], B[2], t)) + "," + lerp(A[3], B[3], t).toFixed(3) + ")";
      }
      function drawReady(dt) {
        readyT += dt;
        const a = Math.min(1, readyT * 1.5);
        // the title sits in the open grass between the mower and its first decision, which stays in view
        const cy = clamp(screenY(sim.s.y + 3.4), area.top + 110, anchorY - S * 2.2);
        const grd = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, W * 0.55);
        grd.addColorStop(0, "rgba(12,22,14," + (0.34 * a).toFixed(3) + ")"); grd.addColorStop(1, "rgba(12,22,14,0)");
        g.fillStyle = grd; g.fillRect(0, cy - W * 0.55, W, W * 1.1);
        type("Little Meadow", W / 2, cy, { size: Math.min(UI.size.title, W * 0.11), family: UI.serif.f, italic: true, weight: 300, color: UI.color.cream, align: "center", alpha: a, shade: true });
        rule(W / 2 - 12, W / 2 + 12, cy + 18, UI.color.creamDim, a);
        type("Swipe left or right to steer", W / 2, cy + 46, { size: UI.size.body, color: UI.color.cream, align: "center", alpha: a, shade: true });
        type("Mow the grass, miss everything else", W / 2, cy + 68, { size: UI.size.body, color: UI.color.creamDim, align: "center", alpha: a, shade: true });
        const pulse = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(readyT * 2.2);
        type("Tap or swipe to begin", W / 2, Math.min(H - area.bottom - 16, screenY(sim.s.y) + S * 1.9), { size: UI.size.small, color: UI.color.creamDim, align: "center", alpha: a * pulse, shade: true });
      }
      function sheet(x, y, w, h, a) {
        // a sheet of paper laid on the meadow: square, faintly grained, one soft shadow
        g.save(); g.globalAlpha = a;
        g.shadowColor = "rgba(10,18,12,0.32)"; g.shadowBlur = 18; g.shadowOffsetY = 6;
        g.fillStyle = UI.color.paper; g.fillRect(x, y, w, h);
        g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
        if (grainTile) { g.globalAlpha = a * 0.8; g.fillStyle = g.createPattern(grainTile, "repeat"); g.fillRect(x, y, w, h); }
        g.restore();
      }
      function drawSoundPanel() {
        const w = Math.min(W - 40, 300), P = UI.space.pad, rowH = 48;
        const h = 72 + rowH * 3 + 40, x = (W - w) / 2, y = area.top + 72;
        g.fillStyle = UI.color.veil; g.fillRect(0, 0, W, H);
        sheet(x, y, w, h, 1);
        type("sound", x + P, y + 40, { size: UI.size.lead, family: UI.serif.f, italic: true, weight: 300, color: UI.color.ink });
        panelBoxes = [];
        const row = (i, label, draw, act) => {
          const ry = y + 60 + i * rowH;
          rule(x + P, x + w - P, ry, UI.color.rule);
          type(label, x + P, ry + 30, { size: UI.size.body, color: UI.color.ink });
          draw(ry + 30);
          panelBoxes.push({ x: x + 8, y: ry, w: w - 16, h: rowH, act });
        };
        const toggle = (onState) => (by) => type(onState ? "On" : "Off", x + w - P, by, { size: UI.size.small, weight: 600, color: onState ? UI.color.accent : UI.color.inkFaint, align: "right" });
        row(0, "Sound effects", toggle(sfxOn), () => { sfxOn = !sfxOn; });
        row(1, "Melody", toggle(musicOn), () => { musicOn = !musicOn; });
        const vy = y + 60 + 2 * rowH;
        rule(x + P, x + w - P, vy, UI.color.rule);
        type("Volume", x + P, vy + 30, { size: UI.size.body, color: UI.color.ink });
        const opts = ["Low", "Mid", "High"];
        let ox = x + w - P;
        for (let i = 2; i >= 0; i--) {
          setFont({ size: UI.size.small, weight: 600 });
          const tw = g.measureText(opts[i]).width;
          type(opts[i], ox, vy + 30, { size: UI.size.small, weight: 600, color: i === volLevel ? UI.color.ink : UI.color.inkFaint, align: "right" });
          if (i === volLevel) rule(ox - tw, ox, vy + 35, UI.color.ink);
          const vi = i;
          panelBoxes.push({ x: ox - tw - 10, y: vy, w: tw + 20, h: rowH, act: () => { volLevel = vi; } });
          ox -= tw + 18;
        }
        rule(x + P, x + w - P, vy + rowH, UI.color.rule);
        type("Tap outside to close", x + P, y + h - 18, { size: UI.size.micro, color: UI.color.inkSoft, track: 0.4 });
      }
      function drawPaused() {
        g.fillStyle = UI.color.veil; g.fillRect(0, 0, W, H);
        const y = H * 0.44;
        type("paused", W / 2, y, { size: 36, family: UI.serif.f, italic: true, weight: 300, color: UI.color.cream, align: "center", shade: true });
        type("Tap anywhere to continue", W / 2, y + 32, { size: UI.size.small, color: UI.color.creamDim, align: "center", shade: true });
      }
      function observation() {
        const st = sim.s.stats;
        const opts = [];
        if (st.maxLevel >= 2) opts.push([st.maxLevel * 3, "Longest rhythm ×" + (st.maxLevel + 1)]);
        if (st.patches >= 2) opts.push([st.patches * 2.2, st.patches + " seed patches mown whole"]);
        if (st.near >= 8) opts.push([st.near * 0.35, st.near + " close shaves"]);
        opts.push([1, Math.floor(sim.s.y - sim.s.startY) + " rows of meadow"]);
        opts.sort((a, b) => b[0] - a[0]);
        return opts[0][1];
      }
      function drawOver(dt) {
        const s = sim.s;
        const k = clamp01((overT - 1.0) / UI.motion.panelIn);
        if (k <= 0) { buttons.again = null; return; }
        const a = smooth(k), rise = reduceMotion ? 0 : (1 - a) * 8;
        const P = UI.space.pad;
        const w = Math.min(W - 2 * UI.space.edge - area.left - area.right, 340), x = (W - w) / 2;
        const top = area.top + 16 + rise;
        const bh = 52, by = H - area.bottom - bh - 16;
        // fit the sheet between the top of the screen and the button: shed secondary lines if needed
        const rows = board.state === "ok" ? Math.max(1, Math.min(3, board.rows.length)) : 1;
        let showObs = true, showBoard = true, boardRows = rows;
        const heightFor = () => 168 + (showObs ? 22 : 0) + (showBoard ? 46 + boardRows * 22 + (board.state === "ok" ? 22 : 0) : 0);
        const room = by - 16 - top;
        while (heightFor() > room && (boardRows > 1 || showBoard || showObs)) { if (boardRows > 1) boardRows--; else if (showObs) showObs = false; else showBoard = false; }
        const h = heightFor();
        panelBottom = top + h;
        sheet(x, top, w, h, a);
        g.save(); g.globalAlpha = a;
        let y = top + 42;
        type("the meadow rests", x + P, y, { size: UI.size.lead, family: UI.serif.f, italic: true, weight: 300, color: UI.color.ink });
        y += 32;
        type("score", x + P, y, { size: UI.size.micro, color: UI.color.inkSoft, track: 1.2 });
        y += 52;
        num(fmt(s.score), x + P - 2, y, { size: UI.size.result, weight: 600, color: UI.color.ink });
        y += 28;
        if (newBest) {
          setFont({ size: UI.size.small, weight: 600 });
          const lab = "New best", lw = g.measureText(lab).width;
          type(lab, x + P, y, { size: UI.size.small, weight: 600, color: UI.color.accent });
          type(prevBest > 0 ? "  ·  " + fmt(s.score - prevBest) + " past your old mark" : "  ·  your first mark in the meadow", x + P + lw, y, { size: UI.size.small, color: UI.color.inkSoft });
        } else {
          const diff = best - s.score;
          type("Best " + fmt(best) + (diff <= Math.max(60, best * 0.15) ? "  ·  " + fmt(diff) + " short" : ""), x + P, y, { size: UI.size.small, color: UI.color.inkSoft });
        }
        if (showObs) { y += 22; type(observation(), x + P, y, { size: UI.size.small, color: UI.color.inkSoft }); }
        if (showBoard) {
          y += 22; rule(x + P, x + w - P, y, UI.color.rule);
          y += 24; type("meadow keepers", x + P, y, { size: UI.size.micro, color: UI.color.inkSoft, track: 1.2 });
          if (board.state === "ok") {
            if (!board.rows.length) { y += 22; type("No marks yet. Yours could be first.", x + P, y, { size: UI.size.small, color: UI.color.inkSoft }); }
            for (const row of board.rows.slice(0, boardRows)) {
              y += 22;
              num(String(row.rank), x + P, y, { size: UI.size.small, color: UI.color.inkSoft });
              type((row.name || "a mower").slice(0, 18), x + P + 22, y, { size: UI.size.small, color: UI.color.ink });
              num(fmt(row.value), x + w - P, y, { size: UI.size.small, color: UI.color.ink, align: "right" });
            }
            y += 22;
            type(board.rank ? "Your place: " + board.rank + (board.total ? " of " + fmt(board.total) : "") : "Your place: not ranked yet", x + P, y, { size: UI.size.small, color: UI.color.inkSoft });
          } else {
            y += 22; type(board.state === "error" ? "Leaderboard unavailable right now" : "Updating…", x + P, y, { size: UI.size.small, color: UI.color.inkSoft });
          }
        }
        g.restore();
        // the one action: a plain vermilion block the width of the sheet, low and thumb-reachable
        const ready = overT > 1.35;
        const down = pressed("again");
        g.save(); g.globalAlpha = a * (ready ? 1 : 0.45);
        g.fillStyle = down ? UI.color.accentDown : UI.color.accent;
        const r = 3, yy = by + (down ? 1 : 0);
        g.beginPath(); g.moveTo(x + r, yy); g.arcTo(x + w, yy, x + w, yy + bh, r); g.arcTo(x + w, yy + bh, x, yy + bh, r); g.arcTo(x, yy + bh, x, yy, r); g.arcTo(x, yy, x + w, yy, r); g.closePath(); g.fill();
        g.restore();
        type("Mow again", W / 2, yy + bh / 2 + 6, { size: UI.size.button, weight: 600, color: UI.color.cream, align: "center", alpha: a * (ready ? 1 : 0.7) });
        buttons.again = ready ? { x, y: by, w, h: bh } : null;
      }

      // =======================================================================
      // Events → feedback (sound, haptics, particles)
      // =======================================================================
      function handleEvents(events) {
        const s = sim.s;
        for (const e of events) {
          switch (e.type) {
            case "cut": {
              const pal = paletteAt(e.y);
              if (Math.random() < 0.8) particles.clip(e.x, e.y, Math.random() < 0.5 ? pal.tuft[2] : (e.d ? pal.dense[2] : pal.tuft[1]), (e.x - s.x) > 0 ? 1 : -1);
              if (e.d && Math.random() < 0.6) particles.clip(e.x, e.y, pal.dense[3], 0);
              sound.cut(e.d);
              break;
            }
            case "turn": sound.turn(false); haptic("light"); interact("turn"); break;
            case "auto": sound.turn(true); break;
            case "bump": sound.bump(); break;
            case "near": sound.near(e.kind, s.level); break;
            case "levelup": sound.level(e.level); hudScorePulse = 0.6; haptic("light"); break;
            case "leveldown": sound.down(); break;
            case "patch": sound.patch(); hudScorePulse = 1; particles.float(e.x, e.y, "+" + e.bonus); break;
            case "rabbitAlert": case "rabbitHop": case "rabbitLand": {
              const rb = e.rb, ahead = rb.y - s.y;
              const prox = clamp(1 - Math.abs(ahead) / 14, 0.1, 1), pan = clamp((rb.x - s.x) / 4, -0.6, 0.6);
              sound.rabbit(e.type === "rabbitAlert" ? "alert" : e.type === "rabbitLand" ? "land" : "hop", prox, pan, !!e.intoPath);
              break;
            }
            case "hit": {
              s.lastHitT = s.time;
              sound.hit(e.kind, e.lives); haptic("warning"); hitFlash = 1;
              if (e.kind === "flower") { const col = FLOWER_COL[e.f.type]; for (let i = 0; i < 9; i++) particles.petal(e.f.x, e.f.y, col); }
              else if (e.kind === "stone" || e.kind === "terrain") { for (let i = 0; i < 7; i++) particles.petal(s.x + (Math.random() - 0.5) * 0.4, s.y + 0.35, [176, 160, 128]); }
              if (cfg.debug) console.log("[little-meadow] collision", JSON.stringify(s.stats.collisionLog[s.stats.collisionLog.length - 1]));
              break;
            }
            case "over": gameOver(); break;
          }
        }
      }
      let lastInteract = 0, lastTrackScore = 0;
      function interact(kind) {
        const t = performance.now();
        if (t - lastInteract < 800) return;
        lastInteract = t;
        try { ctx.platform.interact({ action: kind }); } catch (e) { /* ignore */ }
      }

      // =======================================================================
      // Run lifecycle
      // =======================================================================
      function beginPlay() {
        if (phase !== "ready") return;
        phase = "play";
        sim.start();
        attempt++;
        metrics.startedAt = performance.now();
        startAudio();
        sound.setPaused(false);
        sound.start();
        try { ctx.platform.start({ attempt, seed: runSeed }); } catch (e) { /* ignore */ }
      }
      function gameOver() {
        if (phase === "over") return;
        phase = "over"; overT = 0;
        const s = sim.s;
        prevBest = best;
        newBest = s.score > best;
        if (newBest) { best = s.score; save("lm_best", best); }
        sound.over();
        haptic("heavy");
        if (newBest) ctx.timeout(() => { if (!destroyed) { sound.best(); haptic("success"); } }, 1400);
        if (scoreTrack) try { scoreTrack.set(s.score); } catch (e) { /* ignore */ }
        try { ctx.platform.fail({ score: s.score, rows: Math.floor(s.y - s.startY), seed: runSeed }); } catch (e) { /* ignore */ }
        const myAttempt = attempt;
        board = { state: "loading", rows: [], rank: null, total: 0 };
        (async () => {
          try {
            if (scoreTrack && s.score > 0) await scoreTrack.submit("score", { label: fmt(s.score) + " pts" });
          } catch (e) { /* the read below still shows the accepted board */ }
          try {
            const lb = scoreTrack ? await scoreTrack.leaderboard("score", { scope: "global", period: "all_time", limit: 3 })
              : await ctx.memory.record("score").leaderboard({ scope: "global", period: "all_time", limit: 3 });
            if (destroyed || myAttempt !== attempt || phase !== "over") return;
            const rows = (lb && lb.rows ? lb.rows : []).map((r) => ({ rank: r.rank, value: r.value, name: r.username || r.displayName || r.name || (r.user && (r.user.username || r.user.displayName)) || "" }));
            const vr = lb && lb.viewerRank ? lb.viewerRank.rank : null;
            board = { state: "ok", rows, rank: vr || null, total: lb && lb.totalRanked ? lb.totalRanked : 0 };
          } catch (e) {
            if (destroyed || myAttempt !== attempt) return;
            board = { state: "error", rows: [], rank: null, total: 0 };
          }
        })();
        if (newBest && s.score > 0) ctx.timeout(() => { if (!destroyed && myAttempt === attempt && phase === "over") { try { ctx.pulse.complete({ score: s.score, text: "A new best in Little Meadow: " + fmt(s.score), mode: "endless" }); } catch (e) { /* ignore */ } } }, 1900);
        if (cfg.debug) logMetrics();
      }
      function logMetrics() {
        const st = sim.s.stats, s = sim.s;
        const m = { seed: runSeed, score: s.score, duration: +s.time.toFixed(1), rows: Math.floor(s.y - s.startY), firstTurn: st.firstTurnT, firstCollision: st.firstHitT,
          tuftsCut: st.tufts, efficiency: +(st.tufts / Math.max(1, (s.y - s.startY) * 3)).toFixed(2), maxMult: st.maxLevel + 1, near: st.near,
          turns: st.turns, autoTurns: st.autoTurns, collisions: st.collisions, patches: st.patches, attempts: attempt, collisionsLog: st.collisionLog };
        console.log("[little-meadow] run", JSON.stringify(m));
      }
      function restart() {
        soundPanel = false;
        sound.reset();
        newRun(false);
        beginPlay();
      }
      function togglePause() {
        if (phase === "play") { phase = "paused"; sim.pause(); sound.setPaused(true); }
        else if (phase === "paused") { soundPanel = false; phase = "play"; sim.resume(); sound.setPaused(false); sim.s.startRamp = 0.35; }
      }

      // =======================================================================
      // Input: flick to steer (fires as soon as the finger has travelled far enough)
      // =======================================================================
      const touch = { id: null, x0: 0, y0: 0, t0: 0, fired: 0, ax: 0, ui: false };
      function localPt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      const inBox = (p, b) => b && p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6;
      // Which control is under the finger (no action yet).
      function controlAt(p) {
        if (phase === "over" && inBox(p, buttons.again)) return { id: "again", act: restart };
        if (soundPanel) {
          for (const b of panelBoxes) if (inBox(p, { x: b.x + 6, y: b.y + 6, w: b.w - 12, h: b.h - 12 })) return { id: "panel", act: () => { b.act(); applyMix(); } };
          return { id: "close", act: () => { soundPanel = false; } }; // outside the sheet closes it (the game stays paused)
        }
        if (inBox(p, buttons.pause)) return { id: "pause", act: togglePause };
        if (inBox(p, buttons.sound)) return { id: "sound", act: () => { startAudio(); if (phase === "play") togglePause(); soundPanel = true; } };
        return null;
      }
      function hitUI(p) {
        const c = controlAt(p);
        if (!c) return false;
        if (c.id === "close" || c.id === "panel") { c.act(); return true; } // sheet rows respond at once
        uiPress = c;
        return true;
      }
      function steer(dir) {
        if (phase === "ready") beginPlay();
        if (phase === "paused") return;
        if (phase !== "play") return;
        sim.swipe(dir);
      }
      ctx.listen(canvas, "pointerdown", (e) => {
        e.preventDefault && e.preventDefault();
        try { canvas.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
        const p = localPt(e);
        touch.ui = hitUI(p);
        if (touch.ui) { touch.id = null; return; }
        if (phase === "paused") { togglePause(); touch.id = null; return; }
        touch.id = e.pointerId; touch.x0 = p.x; touch.y0 = p.y; touch.t0 = performance.now(); touch.fired = 0; touch.ax = p.x;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      ctx.listen(canvas, "pointermove", (e) => {
        if (touch.id !== e.pointerId) return;
        const p = localPt(e);
        const th = cfg.swipePx;
        if (!touch.fired) {
          const dx = p.x - touch.x0, dy = p.y - touch.y0;
          if (Math.abs(dx) >= th && Math.abs(dx) > Math.abs(dy) * 0.9) { touch.fired = Math.sign(dx); touch.ax = p.x; steer(touch.fired); }
        } else {
          // keep tracking the extreme in the fired direction; a clear reversal steers back
          if ((p.x - touch.ax) * touch.fired > 0) touch.ax = p.x;
          else if (Math.abs(p.x - touch.ax) >= th * 1.5) { touch.fired = -touch.fired; touch.ax = p.x; steer(touch.fired); }
        }
      });
      function endTouch(e) {
        if (uiPress) {
          const c = controlAt(localPt(e)), was = uiPress;
          uiPress = null;
          if (c && c.id === was.id) was.act();
          return;
        }
        if (touch.id !== e.pointerId) return;
        const p = localPt(e);
        const dt = performance.now() - touch.t0;
        const dx = p.x - touch.x0, dy = p.y - touch.y0;
        if (!touch.fired) {
          if (Math.abs(dx) >= th0() * 0.6 && Math.abs(dx) > Math.abs(dy) && dt < 260) steer(Math.sign(dx));
          else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && phase === "ready") beginPlay();
        }
        touch.id = null;
      }
      const th0 = () => cfg.swipePx;
      ctx.listen(canvas, "pointerup", endTouch);
      ctx.listen(canvas, "pointercancel", (e) => { uiPress = null; if (touch.id === e.pointerId) touch.id = null; });
      ctx.listen(canvas, "contextmenu", (e) => e.preventDefault());
      const keyHandler = (e) => {
        const k = e.key;
        if (k === "ArrowLeft" || k === "a" || k === "A") { steer(-1); e.preventDefault(); }
        else if (k === "ArrowRight" || k === "d" || k === "D") { steer(1); e.preventDefault(); }
        else if (k === " " || k === "Enter") { if (phase === "over" && buttons.again) restart(); else if (phase === "ready") beginPlay(); else togglePause(); e.preventDefault(); }
        else if (k === "Escape" || k === "p" || k === "P") togglePause();
      };
      try { ctx.listen(window, "keydown", keyHandler); } catch (e) { ctx.listen(canvas, "keydown", keyHandler); }

      // =======================================================================
      // Loop
      // =======================================================================
      function frame(dtMs) {
        if (destroyed) return;
        const dt = Math.min(dtMs, 80) / 1000;
        // the host replaces its inset objects when they change; follow them even without a resize event
        const na = readArea();
        if (na.top !== area.top || na.bottom !== area.bottom || na.left !== area.left || na.right !== area.right) { computeLayout(); lightCache = null; }
        if (phase === "play") {
          const events = sim.update(dtMs);
          lastEvents = events;
          recordTrail();
          handleEvents(events);
          if (scoreTrack && sim.s.score !== lastTrackScore) { lastTrackScore = sim.s.score; try { scoreTrack.set(lastTrackScore); } catch (e) { /* ignore */ } }
        } else if (phase === "over") overT += dt;
        hitFlash = Math.max(0, hitFlash - dt * 2.4);
        {
          const s0 = sim.s, pal0 = paletteAt(s0.y);
          sound.update(dt, { playing: phase === "play", speed: s0.speed, cutRate: s0.cutRate, terrain: s0.terrain,
            tension: clamp01(0.65 * s0.tier + 0.35 * s0.danger), region: regionAt(Math.max(0, s0.y)), windAmp: pal0.windAmp });
        }
        particles.update(dt, phase === "play");
        // camera: smooth follow with look-ahead; at rest the view pulls back to show the trail
        const s = sim.s;
        const target = s.y;
        const k = 1 - Math.exp(-dt * 10);
        camY += (target - camY) * k;
        if (phase === "over") {
          const z = smooth(clamp01((overT - 0.6) / 1.6));
          zoom = lerp(1, 0.7, z);
          const cardBottom = panelBottom || area.top + 280;
          const restY = clamp(cardBottom + (H - area.bottom - 90 - cardBottom) * 0.22, H * 0.45, H * 0.62);
          anchorCur = lerp(anchorY, restY, z);
        } else { zoom = 1; anchorCur = anchorY; }
        ensureChunks(true);
        runJobs(phase === "play" ? 3 : 6);
        drawWorld(dt);
        if (phase === "ready") drawReady(dt);
        drawHUD(dt);
        if (phase === "paused") drawPaused();
        if (soundPanel) drawSoundPanel();
        if (phase === "over") drawOver(dt);
      }

      // ---- Resize -----------------------------------------------------------
      ctx.onResize(() => {
        const oldS = S, oldW = W, oldH = H;
        computeLayout();
        lightCache = null;
        if (sim && (Math.abs(oldS - S) > 0.01 || oldW !== W || oldH !== H)) {
          rebuildArt();
          paintVisibleNow();
        }
      }, { immediate: false });

      // ---- First frame -----------------------------------------------------
      grainTile = makeGrain();
      newRun(true);
      rebuildArt();
      paintVisibleNow();
      frame(16);
      try { ctx.markVisualReady && ctx.markVisualReady("meadow painted"); } catch (e) { /* ignore */ }
      try { ctx.platform.ready({ title: "Little Meadow" }); } catch (e) { /* ignore */ }

      const loop = ctx.game.loop({
        update: (dtMs) => frame(dtMs),
        onPause: () => { if (phase === "play") togglePause(); sound.suspend(); },
        onResume: () => { sound.resume(); }
      });
      ctx.onDestroy(() => { try { loop.destroy(); } catch (e) { /* ignore */ } });

      if (typeof window !== "undefined" && window.__LM_TEST__) {
        window.__LM_GAME__ = { get sim() { return sim; }, get phase() { return phase; }, steer, restart, beginPlay, togglePause, get cfg() { return cfg; },
          get overT() { return overT; }, sound, setBest(v) { best = v; }, openSound() { soundPanel = true; }, get buttons() { return buttons; }, get area() { return area; }, get board() { return board; }, get chunks() { return chunks.size; }, get trail() { return trail.length; },
          warp(ticks, pilot) { for (let i = 0; i < ticks && sim.s.phase === "play"; i++) { pilot(sim); sim.update(1000 / 60); } trail.length = 0; chunks.clear(); jobs.length = 0; camY = sim.s.y; } };
      }
    }
  };
})();
