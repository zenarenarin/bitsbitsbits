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
    startSpeed: 2.35,      // rows per second at the start
    maxSpeed: 5.1,         // rows per second at full ramp
    rampRows: 1300,        // rows travelled to reach max speed
    laneChangeRows: 0.8,   // forward distance a lane change takes
    swipePx: 22,           // horizontal travel that counts as a swipe
    bufferMs: 260,         // how long a blocked swipe waits for an opening
    flowerDensity: 1,      // multiplier on flower counts in formations
    patchFrequency: 1,     // multiplier on seed-grass patch frequency
    grassPts: 1,
    densePts: 3,
    patchBonus: 25,
    maxMult: 4,
    graceMs: 1500,
    difficultyRate: 1,
    reliefEvery: 3,
    lives: 3,
    seed: 0,
    debug: false,
    musicVolume: 0.2,
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
  function Generator(seed, cfg) {
    const rng = makeRng(seed);
    const rows = new Map();
    const patches = new Map();
    const obstacles = new Map();
    let next = -10;
    let patchSeq = 1, obSeq = 1, clusterSeq = 1;
    let lastName = "", lastTension = "", tensionRun = 0;
    let reliefTarget = cfg.reliefEvery;
    const log = [];

    function tierAt(row) { return clamp01((row - 60) / (1500 / cfg.difficultyRate)); }

    function newBlock(n) {
      const b = { rows: [], obs: [], name: "" };
      for (let i = 0; i < n; i++) {
        const cells = [];
        for (let l = 0; l < LANES; l++) cells.push({ t: CELL_GRASS, f: null, patch: 0, o: 0 });
        b.rows.push(cells);
      }
      return b;
    }
    const inB = (b, i, l) => i >= 0 && i < b.rows.length && l >= 0 && l < LANES;
    function flower(b, i, l, cluster) {
      if (!inB(b, i, l)) return;
      const c = b.rows[i][l];
      if (c.t === CELL_OBST || c.t === CELL_PATH) return;
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
    function obstacle(b, kind, i, l, w, h) {
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) if (!inB(b, i + a, l + k)) return false;
      const id = obSeq++;
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) {
        const c = b.rows[i + a][l + k];
        c.t = CELL_OBST; c.f = null; c.patch = 0; c.o = id;
      }
      b.obs.push({ id, kind, i, l, w, h });
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
        if (c.t === CELL_GRASS && !c.f && r.f() < p) flower(b, i, l, clusterSeq++);
      }
    }
    const den = () => cfg.flowerDensity;

    // --- Formations -------------------------------------------------------
    const PATTERNS = {
      open(r, T) {
        const b = newBlock(r.int(5, 8));
        if (r.chance(0.6)) strip(b, r, 1, Math.min(b.rows.length - 2, r.int(3, 5)), r.int(0, 6));
        if (T > 0.3 && r.chance(0.5)) scatterSingles(b, r, 0.03 * den(), 1, b.rows.length - 2);
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
      edgeBand(r, T) {
        const n = 7 + Math.round(5 * T) + r.int(0, 2);
        const b = newBlock(n);
        const k = r.int(1, 5);
        const cl = clusterSeq++;
        const gapP = (1 - T) * 0.35;
        for (let i = 1; i < n - 1; i++) if (r.f() > gapP) flower(b, i, k, cl);
        const side = k <= 1 ? 1 : k >= 5 ? -1 : r.pick([-1, 1]);
        strip(b, r, 1, n - 2, k + side);
        if (T > 0.4 && r.chance(0.6)) {
          const k2 = k + side * 3;
          if (k2 >= 0 && k2 < LANES) { const cl2 = clusterSeq++; for (let i = 2; i < n - 2; i++) if (r.f() > gapP + 0.15) flower(b, i, k2, cl2); }
        }
        return b;
      },
      gate(r, T) {
        const lead = T < 0.3 ? 5 : T < 0.6 ? 4 : 3;
        const thick = T > 0.5 && r.chance(0.5) ? 2 : 1;
        const w = T < 0.25 ? 3 : T < 0.55 ? 2 : r.chance(0.5) ? 1 : 2;
        const b = newBlock(lead + thick + 2);
        const g = r.int(0, LANES - w);
        const cl = clusterSeq++;
        for (let a = 0; a < thick; a++) for (let l = 0; l < LANES; l++) if (l < g || l >= g + w) flower(b, lead + a, l, cl);
        const id = patchSeq++;
        for (let a = 0; a < thick + 1; a++) dense(b, lead + a, g + Math.floor(w / 2), id);
        if (T > 0.6) { flower(b, lead - 1, g - 1, cl); flower(b, lead - 1, g + w, cl); }
        return b;
      },
      bed(r, T) {
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
        // One side is rich (seed grass beside the bed), the other is a safe bare path or plain grass.
        const richSide = r.pick([-1, 1]);
        const richLane = richSide < 0 ? left - 1 : right + 1;
        const safeLane = richSide < 0 ? right + 1 : left - 1;
        strip(b, r, lead, lead + L - 1, richLane);
        if (T > 0.3) {
          const outer = richLane + richSide;
          if (outer >= 0 && outer < LANES) { const cl2 = clusterSeq++; for (let i = lead + 1; i < lead + L - 1; i++) if (r.chance(0.35 + 0.3 * T)) flower(b, i, outer, cl2); }
        }
        if (safeLane >= 0 && safeLane < LANES && r.chance(0.65)) for (let i = lead - 1; i <= lead + L; i++) path(b, i, safeLane);
        return b;
      },
      corner(r, T) {
        const b = newBlock(8);
        const l = r.int(1, 5);
        const kind = r.pick(["rock", "stump", "shrub"]);
        obstacle(b, kind, 3, l, 1, 1);
        const s = r.pick([-1, 1]);
        const cl = clusterSeq++;
        flower(b, 3, l + s, cl); flower(b, 4, l + s, cl);
        if (T > 0.45) flower(b, 5, l + s, cl);
        strip(b, r, 4, 6, l);
        if (T > 0.5 && r.chance(0.5)) flower(b, 2, l - s * 2, clusterSeq++);
        return b;
      },
      scatter(r, T) {
        const n = r.int(8, 12);
        const b = newBlock(n);
        const clusters = r.int(2, 4);
        for (let c = 0; c < clusters; c++) {
          const ci = r.int(1, n - 2), cl0 = r.int(0, 6), cl = clusterSeq++;
          const size = r.int(2, 3 + Math.round(2 * T * den()));
          for (let k = 0; k < size; k++) flower(b, clamp(ci + r.int(-1, 1), 1, n - 2), clamp(cl0 + r.int(-1, 1), 0, 6), cl);
        }
        scatterSingles(b, r, (0.025 + 0.06 * T) * den(), 1, n - 2);
        for (let k = 0; k < 2; k++) { const l = r.int(0, 6), i = r.int(1, n - 4); strip(b, r, i, i + r.int(1, 3), l); }
        return b;
      },
      footpath(r, T) {
        const n = r.int(9, 13);
        const b = newBlock(n);
        let l = r.int(1, 5);
        for (let i = 0; i < n; i++) {
          path(b, i, l);
          if (i < n - 1 && r.chance(0.4)) { const nl = clamp(l + r.pick([-1, 1]), 0, 6); path(b, i + 1, nl); l = nl; i++; path(b, i, l); }
        }
        for (let i = 1; i < n - 1; i++) for (let k = 0; k < LANES; k++) {
          const c = b.rows[i][k];
          if (c.t === CELL_GRASS && r.f() < (0.06 + 0.1 * T) * den()) flower(b, i, k, clusterSeq++);
        }
        for (let k = 0; k < 2; k++) { const lane = r.int(0, 6), i = r.int(1, n - 4); strip(b, r, i, i + 2, lane); }
        return b;
      },
      slalom(r, T) {
        const gap = T < 0.75 ? 4 : 3;
        const count = r.int(3, 4);
        const b = newBlock(2 + gap * count);
        let side = r.pick([0, 1]);
        for (let c = 0; c < count; c++) {
          const i = 2 + c * gap;
          const cl = clusterSeq++;
          const from = side ? 3 : 0, to = side ? 6 : 3;
          for (let l = from; l <= to; l++) flower(b, i, l, cl);
          if (T > 0.8 && gap > 3) for (let l = from; l <= to; l++) if (r.chance(0.5)) flower(b, i + 1, l, cl);
          const pocket = side ? 1 : 5;
          const id = patchSeq++;
          dense(b, i, pocket, id); dense(b, i + 1, pocket, id);
          side = 1 - side;
        }
        return b;
      },
      pond(r, T) {
        const h = r.int(2, 3);
        const b = newBlock(h + 6);
        const c = r.int(2, 4);
        obstacle(b, "pond", 2, c - 1, 3, h);
        const narrow = c === 2 ? -1 : c === 4 ? 1 : r.pick([-1, 1]);
        const nl = narrow < 0 ? c - 2 : c + 2;
        strip(b, r, 1, 2 + h, nl);
        const wideFrom = narrow < 0 ? c + 2 : 0, wideTo = narrow < 0 ? 6 : c - 2;
        for (let i = 2; i < 2 + h + 1; i++) for (let l = wideFrom; l <= wideTo; l++) if (r.f() < (0.12 + 0.18 * T) * den()) flower(b, i, l, clusterSeq++);
        if (T > 0.5) flower(b, 3 + h, nl, clusterSeq++);
        return b;
      },
      fence(r, T) {
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
      }
    };
    const POOL = [
      { name: "edgeBand", min: 0, w: 1.2 }, { name: "bed", min: 0.03, w: 1.3 }, { name: "gate", min: 0.1, w: 1.1 },
      { name: "footpath", min: 0.08, w: 0.9 }, { name: "corner", min: 0.14, w: 0.8 }, { name: "scatter", min: 0.2, w: 1 },
      { name: "pond", min: 0.2, w: 0.8 }, { name: "fence", min: 0.3, w: 0.7 }, { name: "slalom", min: 0.4, w: 0.9 }
    ];
    // The first ~30 seconds are a deliberately shaped sequence: start, first dodge, first choice, first gate.
    const opening = [
      { name: "start", build(r) { const b = newBlock(12); const id = patchSeq++; for (let i = 4; i < 12; i++) dense(b, i, 4, id); return b; } },
      { name: "firstDodge", build(r) {
        const b = newBlock(9); const cl = clusterSeq++;
        flower(b, 2, 3, cl); flower(b, 3, 3, cl); flower(b, 3, 2, cl);
        const id = patchSeq++; for (let i = 0; i < 7; i++) dense(b, i, 4, id); return b; } },
      { name: "firstChoice", build(r) {
        const b = newBlock(13); const cl = clusterSeq++;
        for (let i = 3; i < 10; i++) { flower(b, i, 3, cl); if (i > 3 && i < 9) flower(b, i, 2, cl); }
        const id = patchSeq++; for (let i = 3; i <= 9; i++) dense(b, i, 4, id);
        for (let i = 2; i <= 10; i++) path(b, i, 1);
        return b; } },
      { name: "firstGate", build(r) {
        const b = newBlock(10); const cl = clusterSeq++; const g = r.int(1, 3);
        for (let l = 0; l < LANES; l++) if (l < g || l >= g + 3) flower(b, 6, l, cl);
        const id = patchSeq++; dense(b, 5, g + 1, id); dense(b, 6, g + 1, id); dense(b, 7, g + 1, id);
        return b; } },
      { name: "firstBand", build(r) { return PATTERNS.edgeBand(r, 0.15); } }
    ];
    let openingIdx = 0;

    // --- Fairness validation ------------------------------------------------
    const isObs = (c) => c.t === CELL_OBST;
    const isFl = (c) => !!c.f;
    const safe = (c) => !c.f && c.t !== CELL_OBST;
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
      // From every lane a player could safely occupy at the entry row, the block must be survivable.
      for (let l = 0; l < LANES; l++) {
        if (!(entryMask & (1 << l))) continue;
        let m = 1 << l, prev = entry;
        for (let i = 0; i < b.rows.length; i++) { m = advance(prev, b.rows[i], m); prev = b.rows[i]; if (!m) return false; }
      }
      // Obstacles must always leave a side to steer around (the default route never dead-ends).
      for (let i = 0; i < b.rows.length; i++) {
        const prev = i === 0 ? entry : b.rows[i - 1], cur = b.rows[i];
        for (let l = 0; l < LANES; l++) {
          if (!isObs(cur[l]) || isObs(prev[l])) continue;
          let ok = false;
          for (const d of [-1, 1]) {
            for (let n = 1; n <= 3; n++) {
              const s = l + d * n;
              if (s < 0 || s >= LANES || isObs(prev[s])) break;
              if (!isObs(cur[s])) { ok = true; break; }
            }
          }
          if (!ok) return false;
        }
      }
      return true;
    }

    function commit(b, name, T) {
      for (const o of b.obs) {
        obstacles.set(o.id, { id: o.id, kind: o.kind, x: o.l, y: next + o.i, w: o.w, h: o.h, seed: Math.floor(rng.f() * 1e9) });
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
      log.push({ row: next, n: b.rows.length, name, T });
      if (log.length > 60) log.shift();
      next += b.rows.length;
    }

    function choose(T) {
      // Rhythm: a run of tension formations, then a relief formation.
      if (tensionRun >= reliefTarget) {
        tensionRun = 0;
        reliefTarget = Math.max(1, cfg.reliefEvery + (T > 0.5 ? 1 : 0) + rng.int(-1, 0));
        return rng.chance(0.55) ? "seedField" : "open";
      }
      let avail = POOL.filter((p) => T >= p.min && p.name !== lastTension);
      if (!avail.length) avail = POOL.filter((p) => T >= p.min);
      let tw = 0; for (const p of avail) tw += p.w;
      let v = rng.f() * tw;
      for (const p of avail) { v -= p.w; if (v <= 0) return p.name; }
      return avail[0].name;
    }

    function step() {
      const T = tierAt(next);
      const entry = rows.get(next - 1);
      const entryCells = entry ? entry.cells : newBlock(1).rows[0];
      const entryMask = entry ? safeMaskOf(entryCells) : (1 << 3);
      if (next < 0) {
        // Calm ground behind the starting position.
        commit(newBlock(-next), "behind", 0);
        return;
      }
      let name, build;
      if (openingIdx < opening.length) { name = opening[openingIdx].name; build = opening[openingIdx].build; openingIdx++; }
      else {
        name = choose(T);
        build = (r) => PATTERNS[name](r, T);
      }
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = rng.sub();
        const savedP = patchSeq, savedO = obSeq;
        const b = build(r);
        // Gap rows between formations shrink as the run matures.
        const gapRows = name === "start" ? 0 : T < 0.3 ? 2 : T < 0.7 ? rng.int(1, 2) : rng.int(0, 1);
        for (let g = 0; g < gapRows; g++) b.rows.push(newBlock(1).rows[0]);
        if (T > 0.6 && name !== "open" && name !== "seedField" && rng.chance(0.35)) scatterSingles(b, r, 0.03 * den(), 0, b.rows.length - 1);
        // If a formation cannot be reached from every lane, give it lead-in grass rather than discard it.
        for (const pad of [0, 2, 4, 6]) {
          const cand = pad ? { rows: newBlock(pad).rows.concat(b.rows), obs: b.obs.map((o) => Object.assign({}, o, { i: o.i + pad })) } : b;
          if (validate(cand, entryCells, entryMask)) {
            commit(cand, name, T);
            if (name === "open" || name === "seedField") { /* relief */ } else if (openingIdx >= opening.length) { tensionRun++; lastTension = name; }
            lastName = name;
            return;
          }
        }
        patchSeq = savedP; obSeq = savedO;
      }
      commit(newBlock(4), "fallback", T);
    }
    function safeMaskOf(cells) { let m = 0; for (let l = 0; l < LANES; l++) if (safe(cells[l])) m |= 1 << l; return m; }

    return {
      rows, patches, obstacles, log,
      ensure(upto) { let guard = 0; while (next <= upto && guard++ < 500) step(); },
      row(r) { return rows.get(r); },
      cell(r, l) { const row = rows.get(r); return row && l >= 0 && l < LANES ? row.cells[l] : null; },
      prune(below) {
        for (const r of rows.keys()) if (r < below) rows.delete(r);
        for (const [id, o] of obstacles) if (o.y + o.h < below) obstacles.delete(id);
        for (const [id, p] of patches) if (p.row < below - 20) patches.delete(id);
      },
      get next() { return next; },
      tierAt, validate, advance, safeMaskOf
    };
  }

  // ---------------------------------------------------------------------------
  // Simulation: movement, steering, cutting, scoring, rhythm, lives
  // ---------------------------------------------------------------------------
  function Sim(cfg, seed) {
    const gen = Generator(seed, cfg);
    const ev = [];
    const s = {
      phase: "ready", time: 0, x: 3.5, y: 0.5, lane: 3, startY: 0.5,
      change: null, queued: null, speed: 0, startRamp: 0,
      lives: cfg.lives, score: 0, level: 0, charge: 0, lastCut: 0, decay: 0, contRows: 0,
      invuln: 0, jolt: 0, mercy: 1, yaw: 0, bumpT: -9, bumpDir: 0, stuck: 0, ghost: 0, lastPrune: 0,
      stats: { tufts: 0, near: 0, patches: 0, maxLevel: 0, turns: 0, autoTurns: 0, collisions: 0, firstTurnT: -1,
        firstHitT: -1, bestPatch: 0, collisionLog: [], rowsCut: 0 }
    };
    gen.ensure(40);

    function cellObs(r, l) { const c = gen.cell(r, l); return c ? c.t === CELL_OBST : false; }
    function laneClear(l, y0, y1) {
      for (let r = Math.floor(y0); r <= Math.floor(y1); r++) if (cellObs(r, l)) return false;
      return true;
    }
    function speedNow() {
      const d = Math.max(0, s.y - s.startY);
      const t = clamp01(d / cfg.rampRows);
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
          if (!laneClear(tl, s.y - 0.25, s.y + len * 0.6 + 0.3)) return "blocked";
          const dx = Math.abs(s.x - (tl + 0.5));
          s.change = { from: s.change.to, to: tl, fromX: s.x, p: 0, len: Math.max(0.3, len * dx) };
          s.lane = tl;
          return "ok";
        }
        return "busy";
      }
      if (!laneClear(tl, s.y - 0.25, s.y + len + 0.3)) return "blocked";
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

    function autoSteer() {
      if (s.change) return;
      let R = -1;
      for (let r = Math.floor(s.y + 0.3); r <= Math.floor(s.y + 3.6); r++) if (cellObs(r, s.lane)) { R = r; break; }
      if (R < 0) return;
      const dist = R - (s.y + 0.3);
      const pref = s.lane < 3 ? 1 : s.lane > 3 ? -1 : (R % 2 ? 1 : -1);
      let bestDir = 0, bestN = 9;
      for (const d of [pref, -pref]) {
        for (let n = 1; n <= 3; n++) {
          const l = s.lane + d * n;
          if (l < 0 || l >= LANES || !laneClear(l, s.y - 0.35, R - 0.01)) break;
          if (laneClear(l, R, R + 0.99)) { if (n < bestN) { bestN = n; bestDir = d; } break; }
        }
      }
      if (!bestDir) return;
      if (dist <= bestN * cfg.laneChangeRows + 0.3) {
        if (tryChange(bestDir, true) === "ok") s.queued = null;
      }
    }
    function limitForward(dy) {
      if (s.ghost > 0) return dy;
      const front = s.y + MOWER_R;
      const l0 = Math.floor(s.x - MOWER_R + 1e-4), l1 = Math.floor(s.x + MOWER_R - 1e-4);
      for (let r = Math.floor(front) + 1; r <= Math.floor(front + dy); r++) {
        for (let l = l0; l <= l1; l++) if (cellObs(r, l)) return Math.max(0, Math.min(dy, r - front - 0.001));
      }
      return dy;
    }

    function update(dtMs) {
      ev.length = 0;
      if (s.phase !== "play") return ev;
      const dt = Math.min(dtMs, 80) / 1000;
      s.time += dt;
      s.stats.multTime = (s.stats.multTime || 0) + (s.level + 1) * dt;
      s.startRamp = Math.min(1, s.startRamp + dt / 0.6);
      s.mercy = Math.min(1, s.mercy + dt * 0.035);
      if (s.invuln > 0) s.invuln -= dt;
      let v = speedNow();
      if (s.jolt > 0) { s.jolt -= dt; v = 0; }
      s.speed = v;
      const y0 = s.y;
      let dy = v * dt;

      // Default route: steer around an obstacle in the mower's lane if the player has not.
      autoSteer();
      // Obstacles are solid: the mower's front never enters an obstacle cell.
      dy = limitForward(dy);
      if (dy === 0 && v > 0) { s.stuck += dt; if (s.stuck > 1.5) { s.ghost = 1; s.stats.stuckEvents = (s.stats.stuckEvents || 0) + 1; s.stuck = 0; } } else s.stuck = 0;
      if (s.ghost > 0) { s.ghost -= dt; dy = v * dt; }
      s.y += dy;

      // Lane change progression: distance based, but never slower than ~0.3 s.
      if (s.change) {
        const c = s.change;
        c.p = Math.min(1, c.p + Math.max(dy / c.len, dt / 0.3));
        const e = 1 - Math.pow(1 - c.p, 2.2);
        s.x = c.fromX + (c.to + 0.5 - c.fromX) * e;
        if (c.p >= 1) { s.x = c.to + 0.5; s.change = null; }
      }
      // Buffered swipe: retried until it fits or expires.
      if (s.queued) {
        const age = (s.time - s.queued.t) * 1000;
        if (!s.change || !s.queued.busy) {
          const r = tryChange(s.queued.dir, false);
          if (r === "ok") s.queued = null;
          else if (r === "edge") s.queued = null;
          else if (r === "busy") { /* keep */ }
          else if (age > cfg.bufferMs + (s.queued.busy ? 400 : 0)) s.queued = null;
        }
        if (s.queued && !s.change && s.queued.busy) s.queued.busy = false, s.queued.t = s.time;
      }
      const vx = s.change ? (s.x - (s.prevX === undefined ? s.x : s.prevX)) / Math.max(dt, 1e-4) : 0;
      s.prevX = s.x;
      s.yaw = Math.atan2(vx, Math.max(v, 1.2)) * 0.55;

      // Cutting.
      let cutAny = false;
      const rA = Math.floor(s.y - CUT_R), rB = Math.floor(s.y + CUT_R);
      const rr = CUT_R * CUT_R;
      for (let r = rA; r <= rB; r++) {
        const row = gen.row(r);
        if (!row) continue;
        for (const t of row.tufts) {
          if (t.cut) continue;
          const dx = t.x - s.x, dyy = t.y - s.y;
          if (dx * dx + dyy * dyy < rr) {
            t.cut = true; cutAny = true;
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
      if (cutAny) {
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
            hitFlower(f, row);
            if (s.phase !== "play") return ev;
            continue;
          }
          if (!f.near && f.y <= s.y && f.y > y0 - 0.001 && Math.abs(dx) < NEAR_DIST && s.invuln <= 0) {
            f.near = true; f.nearT = s.time;
            s.stats.near++;
            addCharge(1);
            ev.push({ type: "near", x: f.x, y: f.y, f });
          }
        }
      }

      gen.ensure(Math.floor(s.y) + 44);
      if (Math.floor(s.y) - s.lastPrune >= 16) { s.lastPrune = Math.floor(s.y); gen.prune(s.lastPrune - 70); }
      return ev;
    }

    function hitFlower(f, row) {
      s.lives = Math.max(0, s.lives - 1);
      s.stats.collisions++;
      if (s.stats.firstHitT < 0) s.stats.firstHitT = s.time;
      s.stats.collisionLog.push({ t: +s.time.toFixed(2), row: row.r, pattern: row.pattern, tier: +row.tier.toFixed(2),
        speed: +s.speed.toFixed(2), lane: s.lane, changing: !!s.change, flower: [+f.x.toFixed(2), +f.y.toFixed(2)], mower: [+s.x.toFixed(2), +s.y.toFixed(2)] });
      const lostLevel = s.level;
      s.level = 0; s.charge = 0; s.contRows = 0;
      ev.push({ type: "hit", f, lostLevel, lives: s.lives });
      if (s.lives <= 0) {
        s.phase = "over"; s.speed = 0;
        ev.push({ type: "over" });
        return;
      }
      s.invuln = cfg.graceMs / 1000;
      s.jolt = 0.22;
      s.mercy = 0.84;
    }

    return {
      s, gen, update, swipe, start,
      pause() { if (s.phase === "play") s.phase = "paused"; },
      resume() { if (s.phase === "paused") s.phase = "play"; },
      cellObs, laneClear
    };
  }

  // ---------------------------------------------------------------------------
  // Audio: a small hand-built synth (mower hum, clipping, chimes, wind, birds)
  // ---------------------------------------------------------------------------
  function SoundKit() {
    let ac = null, master = null, humGain = null, humOsc = null, humOsc2 = null, humFilter = null, windGain = null;
    let noiseBuf = null, enabled = true, volume = 0.8, lastClip = 0, started = false;
    const k = {};
    function now() { return ac ? ac.currentTime : 0; }
    k.init = function () {
      if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return true; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ac = new AC();
      } catch (e) { ac = null; return false; }
      master = ac.createGain(); master.gain.value = enabled ? volume : 0; master.connect(ac.destination);
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.6 + b0 * 2.2; }
      // Mower hum: a soft two-stroke murmur.
      humFilter = ac.createBiquadFilter(); humFilter.type = "lowpass"; humFilter.frequency.value = 360; humFilter.Q.value = 0.7;
      humGain = ac.createGain(); humGain.gain.value = 0;
      humOsc = ac.createOscillator(); humOsc.type = "sawtooth"; humOsc.frequency.value = 52;
      humOsc2 = ac.createOscillator(); humOsc2.type = "triangle"; humOsc2.frequency.value = 104.5;
      const o2g = ac.createGain(); o2g.gain.value = 0.5;
      const lfo = ac.createOscillator(); lfo.frequency.value = 10.5;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.012;
      lfo.connect(lfoG); lfoG.connect(humGain.gain);
      humOsc.connect(humFilter); humOsc2.connect(o2g); o2g.connect(humFilter);
      humFilter.connect(humGain); humGain.connect(master);
      humOsc.start(); humOsc2.start(); lfo.start();
      // Wind bed.
      const wsrc = ac.createBufferSource(); wsrc.buffer = noiseBuf; wsrc.loop = true;
      const wf = ac.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 420; wf.Q.value = 0.5;
      windGain = ac.createGain(); windGain.gain.value = 0.018;
      const wl = ac.createOscillator(); wl.frequency.value = 0.07;
      const wlg = ac.createGain(); wlg.gain.value = 0.012;
      wl.connect(wlg); wlg.connect(windGain.gain);
      wsrc.connect(wf); wf.connect(windGain); windGain.connect(master);
      wsrc.start(); wl.start();
      return true;
    };
    k.ready = () => !!ac;
    k.setEnabled = function (on) { enabled = on; if (master) master.gain.setTargetAtTime(on ? volume : 0, now(), 0.05); };
    k.setVolume = function (v) { volume = v; if (master && enabled) master.gain.setTargetAtTime(v, now(), 0.05); };
    k.suspend = function () { if (ac && ac.state === "running") ac.suspend().catch(() => {}); };
    k.resume = function () { if (ac && ac.state === "suspended") ac.resume().catch(() => {}); };
    let humSpeed = -1;
    k.hum = function (on, speed) {
      if (!ac) return;
      if (on === started && on && Math.abs(speed - humSpeed) < 0.08) return;
      humSpeed = speed;
      const t = now();
      humGain.gain.setTargetAtTime(on ? 0.05 : 0, t, on ? 0.15 : 0.5);
      if (on) { humOsc.frequency.setTargetAtTime(48 + speed * 5, t, 0.3); humOsc2.frequency.setTargetAtTime(97 + speed * 10.5, t, 0.3); }
      else { humOsc.frequency.setTargetAtTime(30, t, 0.6); humOsc2.frequency.setTargetAtTime(60, t, 0.6); }
      started = on;
    };
    let lastOpen = -1;
    k.cutOpen = function (amount) {
      if (!ac || !started || Math.abs(amount - lastOpen) < 0.08) return;
      lastOpen = amount;
      humFilter.frequency.setTargetAtTime(340 + amount * 260, now(), 0.08);
    };
    function noiseBurst(t, dur, freq, q, gain, type) {
      const src = ac.createBufferSource(); src.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.8, dur + 0.02);
    }
    function tone(t, freq, dur, gain, type, toFreq) {
      const o = ac.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    k.clip = function (denseCut) {
      if (!ac || !enabled) return;
      const t = now();
      if (t - lastClip < 0.05 + Math.random() * 0.035) return;
      lastClip = t;
      noiseBurst(t, denseCut ? 0.06 : 0.035, (denseCut ? 2100 : 3200) + Math.random() * 1500, 1.3, denseCut ? 0.06 : 0.035);
    };
    k.turn = function () { if (!ac || !enabled) return; const t = now(); noiseBurst(t, 0.02, 5200, 3, 0.03, "highpass"); tone(t, 1650, 0.03, 0.012, "triangle"); };
    k.bump = function () { if (!ac || !enabled) return; const t = now(); tone(t, 180, 0.09, 0.05, "sine", 120); };
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    k.near = function (level) {
      if (!ac || !enabled) return;
      const t = now(); const st = PENTA[Math.min(PENTA.length - 1, 2 + level + Math.floor(Math.random() * 2))];
      const f = 880 * Math.pow(2, st / 12);
      tone(t, f, 0.32, 0.022, "sine"); tone(t, f * 2.01, 0.18, 0.006, "sine");
    };
    k.level = function (level) {
      if (!ac || !enabled) return;
      const t = now(); const base = 523.25 * Math.pow(2, PENTA[Math.min(4, level)] / 12);
      tone(t, base, 0.25, 0.03, "triangle"); tone(t + 0.09, base * 1.5, 0.35, 0.026, "triangle");
    };
    k.down = function () { if (!ac || !enabled) return; const t = now(); tone(t, 520, 0.22, 0.015, "triangle", 390); };
    k.patch = function () {
      if (!ac || !enabled) return;
      const t = now(); [0, 4, 7].forEach((st, i) => tone(t + i * 0.07, 659.25 * Math.pow(2, st / 12), 0.3, 0.02, "sine"));
    };
    k.hit = function () {
      if (!ac || !enabled) return;
      const t = now();
      tone(t, 150, 0.22, 0.12, "sine", 62);
      noiseBurst(t, 0.18, 900, 0.8, 0.05);
      tone(t + 0.05, 392, 0.45, 0.03, "triangle", 262);
    };
    k.over = function () { if (!ac) return; k.hum(false, 0); if (enabled) { const t = now(); tone(t + 0.2, 329.6, 0.9, 0.025, "sine", 246.9); } };
    k.best = function () {
      if (!ac || !enabled) return;
      const t = now(); [0, 4, 7, 12].forEach((st, i) => tone(t + 0.15 + i * 0.12, 523.25 * Math.pow(2, st / 12), 0.6, 0.028, "triangle"));
    };
    k.bird = function () {
      if (!ac || !enabled) return;
      const t = now(); const n = 2 + Math.floor(Math.random() * 3); const base = 2600 + Math.random() * 900;
      for (let i = 0; i < n; i++) tone(t + i * 0.13, base, 0.08, 0.006, "sine", base * (1.18 + Math.random() * 0.15));
    };
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
      permissions: ["audio", "backgroundMusic", "haptics", "storage"]
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
          grassPts: +tn("grass_points", DEFAULTS.grassPts), densePts: +tn("seed_grass_points", DEFAULTS.densePts),
          patchBonus: +tn("patch_bonus", DEFAULTS.patchBonus), maxMult: Math.max(1, +tn("max_multiplier", DEFAULTS.maxMult)),
          graceMs: +tn("grace_ms", DEFAULTS.graceMs), difficultyRate: +tn("difficulty_rate", DEFAULTS.difficultyRate),
          reliefEvery: Math.max(1, +tn("relief_every", DEFAULTS.reliefEvery)), lives: Math.max(1, +tn("lives", DEFAULTS.lives)),
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
      let soundOn = load("lm_sound", true) !== false;

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
      const FONT_NUM = { f: "Georgia, 'Times New Roman', serif" };
      const FONT_IT = { f: "Georgia, 'Times New Roman', serif" };
      (async () => {
        try { await ctx.loadFont("LM Display", "dm-serif-display", "1.0.0", { weight: "400", style: "normal" }); if (!destroyed) FONT_NUM.f = "'LM Display', Georgia, serif"; } catch (e) { /* fallback */ }
        try { await ctx.loadFont("LM Italic", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }); if (!destroyed) FONT_IT.f = "'LM Italic', Georgia, serif"; } catch (e) { /* fallback */ }
      })();

      // ---- Layout ------------------------------------------------------------
      let W = ctx.width, H = ctx.height, S = 48, fieldX0 = 0, anchorY = 0, PS = 1.5, chunkW = 0, chunkX = 0, area = { top: 0, right: 0, bottom: 0, left: 0 };
      const CH = 16; // rows per painted chunk
      function computeLayout() {
        W = Math.max(200, ctx.width); H = Math.max(300, ctx.height);
        area = ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
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
            if (birdNext <= 0) { birdNext = 6 + Math.random() * 10; if (phase === "play" || phase === "ready") sound.bird(); }
          }
        };
      })();

      const sound = SoundKit();
      ctx.onDestroy(() => sound.destroy());
      let musicOn = false;
      function startAudio() {
        sound.init();
        sound.setVolume(cfg.sfxVolume);
        sound.setEnabled(soundOn);
        if (!musicOn) {
          musicOn = true;
          try {
            if (ctx.music && ctx.music.unlock) ctx.music.unlock().catch(() => {});
            ctx.music.play({ preset: "ambient", volume: soundOn ? cfg.musicVolume : 0, tempo: 70, intensity: 0.2, density: 0.35, scale: "pentatonic", fadeInMs: 2500 });
          } catch (e) { /* music optional */ }
        }
      }
      function musicIntensity(v) { try { if (musicOn && ctx.music.setIntensity) ctx.music.setIntensity(v, { fadeMs: 1200 }); } catch (e) { /* ignore */ } }
      function setSound(on) {
        soundOn = on; save("lm_sound", on);
        sound.setEnabled(on);
        try { if (musicOn) ctx.music.setVolume(on ? cfg.musicVolume : 0, { fadeMs: 300 }); } catch (e) { /* ignore */ }
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
        } else if (o.kind === "rock") {
          c2.fillStyle = "rgba(14,26,16,0.4)"; blob(c2, cx + S * 0.08, cy + S * 0.1, S * 0.36, r.f, 9);
          c2.fillStyle = "#7f7a6c"; blob(c2, cx, cy, S * 0.36, r.f, 9);
          c2.fillStyle = "#a29d8c"; blob(c2, cx - S * 0.06, cy - S * 0.07, S * 0.24, r.f, 8);
          c2.fillStyle = "#c2bca9"; blob(c2, cx - S * 0.1, cy - S * 0.12, S * 0.1, r.f, 7);
          c2.fillStyle = "rgba(90,110,60,0.7)";
          for (let i = 0; i < 6; i++) c2.fillRect(cx + S * 0.05 + r.f() * S * 0.15, cy + S * 0.05 + r.f() * S * 0.12, 1.5, 1.5);
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
        const top = c2.createLinearGradient(0, 0, 0, (area.top || 0) + 90);
        top.addColorStop(0, "rgba(14,24,16,0.5)"); top.addColorStop(1, "rgba(14,24,16,0)");
        c2.fillStyle = top; c2.fillRect(0, 0, W, (area.top || 0) + 90);
        lightCache = { c, W, H };
        return c;
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
      // HUD
      // =======================================================================
      const buttons = { pause: null, sound: null, again: null };
      function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
      function text(str, x, y, size, font, color, align, alpha) {
        g.font = size + "px " + font;
        g.textAlign = align || "center"; g.textBaseline = "alphabetic";
        g.globalAlpha = alpha === undefined ? 1 : alpha;
        g.fillStyle = "rgba(14,24,16,0.45)"; g.fillText(str, x + 1, y + 1.5);
        g.fillStyle = color; g.fillText(str, x, y);
        g.globalAlpha = 1;
      }
      function daisyIcon(x, y, r, alive, k) {
        // alive: cream petals; lost: wilted, bowed
        g.save(); g.translate(x, y);
        if (!alive) { g.rotate(0.5 * k); g.translate(0, r * 0.25 * k); }
        g.strokeStyle = alive ? "rgba(140,170,110,0.9)" : "rgba(120,110,80,0.7)"; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(0, r * 0.6); g.quadraticCurveTo(r * 0.3, r * 1.3, r * 0.1, r * 1.8); g.stroke();
        const col = alive ? "rgb(242,236,220)" : "rgba(150,140,115,0.75)";
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * 6.283;
          g.save(); g.rotate(a); g.fillStyle = col;
          g.beginPath(); g.ellipse(0, -r * 0.62, r * 0.2, alive ? r * 0.45 : r * 0.32, 0, 0, 6.283); g.fill(); g.restore();
        }
        g.fillStyle = alive ? "rgb(214,170,62)" : "rgba(130,110,70,0.8)";
        g.beginPath(); g.arc(0, 0, r * 0.3, 0, 6.283); g.fill();
        g.restore();
      }
      function roundBtn(cx, cy, r, draw) {
        g.fillStyle = "rgba(20,34,24,0.42)"; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();
        g.strokeStyle = "rgba(241,232,213,0.35)"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r - 0.5, 0, 6.283); g.stroke();
        draw(cx, cy);
      }
      function drawHUD(dt) {
        const s = sim.s;
        const top = area.top + 8, left = area.left + 16, right = W - area.right - 16;
        const hudAlpha = phase === "over" ? Math.max(0, 1 - overT * 2) : 1;
        if (hudAlpha <= 0.01) { buttons.pause = null; buttons.sound = null; return; }
        g.globalAlpha = hudAlpha;
        // lives
        for (let i = 0; i < cfg.lives; i++) {
          const alive = i < s.lives;
          if (!alive) lifeAnim[i] = Math.min(1, (lifeAnim[i] || 0) + dt * 3);
          daisyIcon(left + 8 + i * 22, top + 18, 8, alive, alive ? 0 : lifeAnim[i]);
        }
        if (best > 0) text("best " + fmt(best), left, top + 56, 15, FONT_IT.f, "rgba(241,232,213,0.85)", "left");
        // score
        shownScore += (s.score - shownScore) * Math.min(1, dt * 14);
        if (Math.abs(s.score - shownScore) < 0.5) shownScore = s.score;
        hudScorePulse = Math.max(0, hudScorePulse - dt * 3);
        const scale = 1 + hudScorePulse * 0.12;
        g.save(); g.translate(W / 2, top + 34); g.scale(scale, scale);
        text(fmt(shownScore), 0, 0, 32, FONT_NUM.f, "#f1e8d5", "center");
        g.restore();
        // rhythm multiplier with charge pips
        const lvl = s.level;
        if (lvl !== lastLevel) { if (lvl < lastLevel) { multDropT = s.time; multDropFrom = lastLevel + 1; } lastLevel = lvl; multAnim = 1; }
        multAnim = Math.max(0, multAnim - dt * 2.5);
        const drop = s.time - multDropT;
        if (lvl > 0 || s.charge > 0 || (drop >= 0 && drop < 0.8)) {
          const my = top + 58;
          if (lvl > 0) {
            g.save(); g.translate(W / 2 - 14, my); const k = 1 + multAnim * 0.3; g.scale(k, k);
            text("×" + (lvl + 1), 0, 0, 19, FONT_NUM.f, "#e8cf77", "center");
            g.restore();
          } else if (drop >= 0 && drop < 0.8) {
            text("×" + multDropFrom, W / 2 - 14, my + drop * 14, 19, FONT_NUM.f, "rgba(201,124,101," + (1 - drop / 0.8).toFixed(2) + ")", "center");
          }
          const maxed = lvl >= cfg.maxMult - 1;
          const need = maxed ? 0 : chargeFor(lvl);
          for (let i = 0; i < need; i++) {
            const on = maxed || i < s.charge;
            g.fillStyle = on ? "rgba(232,207,119,0.95)" : "rgba(241,232,213,0.3)";
            g.beginPath(); g.ellipse(W / 2 + 6 + i * 8, my - 6, 2.4, 3.4, 0.5, 0, 6.283); g.fill();
          }
        }
        // buttons
        const br = 18;
        const pcx = right - br, pcy = top + 22;
        roundBtn(pcx, pcy, br, (x, y) => {
          g.fillStyle = "#f1e8d5";
          if (phase === "paused") { g.beginPath(); g.moveTo(x - 4, y - 7); g.lineTo(x + 7, y); g.lineTo(x - 4, y + 7); g.closePath(); g.fill(); }
          else { g.fillRect(x - 5.5, y - 7, 4, 14); g.fillRect(x + 1.5, y - 7, 4, 14); }
        });
        buttons.pause = phase === "play" || phase === "paused" ? { x: pcx, y: pcy, r: br + 8 } : null;
        const scx = pcx - br * 2 - 10, scy = pcy;
        roundBtn(scx, scy, br, (x, y) => {
          g.fillStyle = "#f1e8d5";
          g.beginPath(); g.moveTo(x - 7, y - 3); g.lineTo(x - 3, y - 3); g.lineTo(x + 2, y - 7); g.lineTo(x + 2, y + 7); g.lineTo(x - 3, y + 3); g.lineTo(x - 7, y + 3); g.closePath(); g.fill();
          g.strokeStyle = "#f1e8d5"; g.lineWidth = 1.4;
          if (soundOn) { g.beginPath(); g.arc(x + 3, y, 5, -0.8, 0.8); g.stroke(); g.beginPath(); g.arc(x + 3, y, 8.5, -0.8, 0.8); g.stroke(); }
          else { g.beginPath(); g.moveTo(x + 4, y - 4); g.lineTo(x + 10, y + 4); g.moveTo(x + 10, y - 4); g.lineTo(x + 4, y + 4); g.stroke(); }
        });
        buttons.sound = { x: scx, y: scy, r: br + 6 };
        // patch bonus floats (restrained)
        for (const p of particles.floats) {
          if (!p.on) continue;
          const k = p.life / p.max;
          text(p.text, screenX(p.x) + S * 0.6, screenY(p.y) - k * 26, 17, FONT_IT.f, "rgba(232,207,119," + (1 - k).toFixed(2) + ")", "left");
        }
        g.globalAlpha = 1;
      }
      function drawReady(dt) {
        readyT += dt;
        const a = Math.min(1, readyT * 1.5);
        const cy = area.top + Math.max(110, (anchorY - area.top) * 0.36);
        g.save();
        const grd = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, W * 0.6);
        grd.addColorStop(0, "rgba(16,28,20," + (0.42 * a).toFixed(3) + ")"); grd.addColorStop(1, "rgba(16,28,20,0)");
        g.fillStyle = grd; g.fillRect(0, cy - W * 0.6, W, W * 1.2);
        text("Little Meadow", W / 2, cy, Math.min(50, W * 0.12), FONT_IT.f, "#f1e8d5", "center", a);
        // a small painted sprig as an ornament
        g.globalAlpha = a; g.strokeStyle = "rgba(168,181,138,0.9)"; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(W / 2 - 46, cy + 16); g.quadraticCurveTo(W / 2, cy + 8, W / 2 + 46, cy + 16); g.stroke();
        g.fillStyle = "rgba(168,181,138,0.9)";
        for (let i = -3; i <= 3; i++) { g.beginPath(); g.ellipse(W / 2 + i * 12, cy + 12 - Math.abs(i) * 0.6, 3.5, 1.6, i * 0.2 - 0.4, 0, 6.283); g.fill(); }
        g.fillStyle = "rgb(232,207,119)"; g.beginPath(); g.arc(W / 2, cy + 10, 2.4, 0, 6.283); g.fill();
        g.globalAlpha = 1;
        text("swipe left or right to steer", W / 2, cy + 46, 19, FONT_IT.f, "rgba(241,232,213,0.95)", "center", a);
        text("mow the grass · spare the flowers", W / 2, cy + 70, 17, FONT_IT.f, "rgba(241,232,213,0.8)", "center", a);
        const pulse = 0.55 + 0.45 * Math.sin(readyT * 3);
        text("swipe or tap to begin", W / 2, Math.min(H - area.bottom - 14, screenY(sim.s.y) + S * 1.9), 17, FONT_IT.f, "rgba(246,238,219," + (0.6 + 0.4 * pulse).toFixed(2) + ")", "center", a);
        g.restore();
      }
      function drawPaused() {
        g.fillStyle = "rgba(16,28,20,0.4)"; g.fillRect(0, 0, W, H);
        text("paused", W / 2, H * 0.42, 40, FONT_IT.f, "#f1e8d5", "center");
        text("tap to continue", W / 2, H * 0.42 + 34, 17, FONT_IT.f, "rgba(241,232,213,0.85)", "center");
      }
      function paperCard(x, y, w, h, a) {
        g.save(); g.globalAlpha = a;
        g.fillStyle = "rgba(10,20,14,0.3)";
        roughRect(x + 3, y + 5, w, h, 9);
        g.fill();
        g.fillStyle = "#efe6d1";
        roughRect(x, y, w, h, 9);
        g.fill();
        if (grainTile) { g.fillStyle = g.createPattern(grainTile, "repeat"); roughRect(x, y, w, h, 9); g.fill(); }
        g.restore();
      }
      function roughRect(x, y, w, h, r) {
        const rn = mulberry32(Math.floor(w * 13 + h));
        g.beginPath();
        const pts = [];
        const n = 10;
        for (let i = 0; i <= n; i++) pts.push([x + r + (w - 2 * r) * i / n, y + (rn() - 0.5) * 1.6]);
        for (let i = 0; i <= n; i++) pts.push([x + w + (rn() - 0.5) * 1.6, y + r + (h - 2 * r) * i / n]);
        for (let i = 0; i <= n; i++) pts.push([x + w - r - (w - 2 * r) * i / n, y + h + (rn() - 0.5) * 1.6]);
        for (let i = 0; i <= n; i++) pts.push([x + (rn() - 0.5) * 1.6, y + h - r - (h - 2 * r) * i / n]);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
      }
      function inkText(str, x, y, size, font, color, align, alpha) {
        g.font = size + "px " + font; g.textAlign = align || "center"; g.textBaseline = "alphabetic";
        g.globalAlpha = alpha === undefined ? 1 : alpha; g.fillStyle = color; g.fillText(str, x, y); g.globalAlpha = 1;
      }
      function observation() {
        const st = sim.s.stats;
        const opts = [];
        if (st.maxLevel >= 2) opts.push([st.maxLevel * 3, "longest rhythm ×" + (st.maxLevel + 1)]);
        if (st.patches >= 2) opts.push([st.patches * 2.2, st.patches + " seed patches mown whole"]);
        if (st.near >= 8) opts.push([st.near * 0.35, st.near + " close shaves"]);
        opts.push([1, Math.floor(sim.s.y - sim.s.startY) + " rows of meadow"]);
        opts.sort((a, b) => b[0] - a[0]);
        return opts[0][1];
      }
      function drawOver(dt) {
        const s = sim.s;
        const a = clamp01((overT - 1.0) / 0.5);
        if (a <= 0) { buttons.again = null; return; }
        const cw = Math.min(W - 40, 340), cx = (W - cw) / 2;
        const cy = area.top + 14;
        const ch = 218 + (board.state === "ok" ? Math.max(1, Math.min(3, board.rows.length)) * 20 + 20 : 0);
        paperCard(cx, cy, cw, ch, a);
        const ink = "#2a3a2a";
        inkText("the meadow rests", W / 2, cy + 30, 17, FONT_IT.f, "rgba(52,75,49,0.85)", "center", a);
        inkText(fmt(s.score), W / 2, cy + 84, 50, FONT_NUM.f, ink, "center", a);
        let line, lineCol = "rgba(52,60,48,0.9)";
        if (newBest) { line = prevBest > 0 ? "a new best — " + fmt(s.score - prevBest) + " past your old mark" : "your first mark in the meadow"; lineCol = "#a5462f"; }
        else {
          const diff = best - s.score;
          line = diff <= Math.max(60, best * 0.15) ? fmt(diff) + " short of your best (" + fmt(best) + ")" : "best " + fmt(best);
        }
        inkText(line, W / 2, cy + 114, 17, FONT_IT.f, lineCol, "center", a);
        inkText(observation(), W / 2, cy + 140, 16, FONT_IT.f, "rgba(70,80,60,0.85)", "center", a);
        g.globalAlpha = a * 0.5; g.strokeStyle = "#6b7a55"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx + 30, cy + 158); g.lineTo(cx + cw - 30, cy + 158); g.stroke(); g.globalAlpha = 1;
        // compact leaderboard
        let ly = cy + 182;
        inkText("meadow keepers", W / 2, ly, 15, FONT_IT.f, "rgba(52,75,49,0.85)", "center", a);
        ly += 22;
        if (board.state === "ok") {
          if (!board.rows.length) { inkText("no marks yet — yours could be first", W / 2, ly, 14, FONT_IT.f, "rgba(70,80,60,0.85)", "center", a); ly += 20; }
          for (const row of board.rows.slice(0, 3)) {
            inkText(String(row.rank), cx + 40, ly, 15, FONT_NUM.f, ink, "left", a);
            const name = (row.name || "a mower").slice(0, 16);
            inkText(name, cx + 64, ly, 16, FONT_IT.f, ink, "left", a);
            inkText(fmt(row.value), cx + cw - 40, ly, 15, FONT_NUM.f, ink, "right", a);
            ly += 20;
          }
          const rk = board.rank ? "your place: " + board.rank + (board.total ? " of " + fmt(board.total) : "") : "your place: not ranked yet";
          inkText(rk, W / 2, ly + 4, 14, FONT_IT.f, "rgba(70,80,60,0.85)", "center", a);
        } else {
          inkText(board.state === "error" ? "leaderboard unavailable right now" : "updating…", W / 2, ly, 14, FONT_IT.f, "rgba(70,80,60,0.75)", "center", a);
        }
        // Mow again: large, low, thumb-reachable
        const bw = Math.min(W - 64, 260), bh = 58;
        const bx = (W - bw) / 2, by = H - area.bottom - bh - 18;
        g.save(); g.globalAlpha = a;
        const pill = (x, y) => { g.beginPath(); g.moveTo(x + bh / 2, y); g.lineTo(x + bw - bh / 2, y + 0.8); g.arc(x + bw - bh / 2, y + bh / 2, bh / 2, -Math.PI / 2, Math.PI / 2); g.lineTo(x + bh / 2, y + bh - 0.6); g.arc(x + bh / 2, y + bh / 2, bh / 2, Math.PI / 2, Math.PI * 1.5); g.closePath(); };
        g.fillStyle = "rgba(10,20,14,0.35)"; pill(bx + 2, by + 4); g.fill();
        g.fillStyle = "#c9573f"; pill(bx, by); g.fill();
        g.fillStyle = "rgba(240,170,130,0.3)"; g.fillRect(bx + bh / 2, by + 7, bw - bh, 2);
        g.restore();
        inkText("Mow again", W / 2, by + 38, 26, FONT_IT.f, "#f6eedb", "center", a);
        buttons.again = overT > 1.35 ? { x: bx, y: by, w: bw, h: bh } : null;
      }

      // =======================================================================
      // Events → feedback (sound, haptics, particles)
      // =======================================================================
      let cutAccum = 0;
      function handleEvents(events) {
        const s = sim.s;
        let cuts = 0;
        for (const e of events) {
          switch (e.type) {
            case "cut": {
              cuts++;
              const pal = paletteAt(e.y);
              if (Math.random() < 0.8) particles.clip(e.x, e.y, Math.random() < 0.5 ? pal.tuft[2] : (e.d ? pal.dense[2] : pal.tuft[1]), (e.x - s.x) > 0 ? 1 : -1);
              if (e.d && Math.random() < 0.6) particles.clip(e.x, e.y, pal.dense[3], 0);
              sound.clip(e.d);
              break;
            }
            case "turn": sound.turn(); haptic("light"); interact("turn"); break;
            case "auto": sound.turn(); break;
            case "bump": sound.bump(); break;
            case "near": sound.near(s.level); break;
            case "levelup": sound.level(e.level); hudScorePulse = 0.6; haptic("light"); musicIntensity(0.2 + e.level * 0.14); break;
            case "leveldown": sound.down(); musicIntensity(0.2 + e.level * 0.14); break;
            case "patch": sound.patch(); hudScorePulse = 1; particles.float(e.x, e.y, "+" + e.bonus); break;
            case "hit": {
              s.lastHitT = s.time;
              sound.hit(); haptic("warning"); hitFlash = 1;
              const col = FLOWER_COL[e.f.type];
              for (let i = 0; i < 9; i++) particles.petal(e.f.x, e.f.y, col);
              musicIntensity(0.18);
              try { ctx.music.duck(0.5, 600); } catch (err) { /* ignore */ }
              if (cfg.debug) console.log("[little-meadow] collision", JSON.stringify(s.stats.collisionLog[s.stats.collisionLog.length - 1]));
              break;
            }
            case "over": gameOver(); break;
          }
        }
        cutAccum = cutAccum * 0.85 + cuts;
        sound.cutOpen(Math.min(1, cutAccum / 3));
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
        sound.hum(true, sim.s.speed);
        try { ctx.platform.start({ attempt, seed: runSeed }); } catch (e) { /* ignore */ }
        musicIntensity(0.22);
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
        musicIntensity(0.1);
        if (newBest) ctx.timeout(() => { if (!destroyed) { sound.best(); haptic("success"); try { ctx.music.sting("success"); } catch (e) { /* ignore */ } } }, 1100);
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
        sound.hum(false, 0);
        newRun(false);
        beginPlay();
      }
      function togglePause() {
        if (phase === "play") { phase = "paused"; sim.pause(); sound.hum(false, 0); }
        else if (phase === "paused") { phase = "play"; sim.resume(); sound.hum(true, sim.s.speed); sim.s.startRamp = 0.35; }
      }

      // =======================================================================
      // Input: flick to steer (fires as soon as the finger has travelled far enough)
      // =======================================================================
      const touch = { id: null, x0: 0, y0: 0, t0: 0, fired: 0, ax: 0, ui: false };
      function localPt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      function hitUI(p) {
        if (phase === "over" && buttons.again && p.x >= buttons.again.x - 8 && p.x <= buttons.again.x + buttons.again.w + 8 && p.y >= buttons.again.y - 8 && p.y <= buttons.again.y + buttons.again.h + 8) { restart(); return true; }
        if (buttons.pause && Math.hypot(p.x - buttons.pause.x, p.y - buttons.pause.y) < buttons.pause.r) { togglePause(); return true; }
        if (buttons.sound && Math.hypot(p.x - buttons.sound.x, p.y - buttons.sound.y) < buttons.sound.r) { startAudio(); setSound(!soundOn); return true; }
        return false;
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
      ctx.listen(canvas, "pointercancel", (e) => { if (touch.id === e.pointerId) touch.id = null; });
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
        if (phase === "play") {
          const events = sim.update(dtMs);
          lastEvents = events;
          recordTrail();
          handleEvents(events);
          sound.hum(true, sim.s.speed);
          if (scoreTrack && sim.s.score !== lastTrackScore) { lastTrackScore = sim.s.score; try { scoreTrack.set(lastTrackScore); } catch (e) { /* ignore */ } }
        } else if (phase === "over") overT += dt;
        hitFlash = Math.max(0, hitFlash - dt * 2.4);
        particles.update(dt, phase === "play");
        // camera: smooth follow with look-ahead; at rest the view pulls back to show the trail
        const s = sim.s;
        const target = s.y;
        const k = 1 - Math.exp(-dt * 10);
        camY += (target - camY) * k;
        if (phase === "over") {
          const z = smooth(clamp01((overT - 0.6) / 1.6));
          zoom = lerp(1, 0.7, z);
          const cardBottom = area.top + 14 + 260;
          const restY = clamp(cardBottom + (H - area.bottom - 90 - cardBottom) * 0.22, H * 0.45, H * 0.62);
          anchorCur = lerp(anchorY, restY, z);
        } else { zoom = 1; anchorCur = anchorY; }
        ensureChunks(true);
        runJobs(phase === "play" ? 3 : 6);
        drawWorld(dt);
        if (phase === "ready") drawReady(dt);
        drawHUD(dt);
        if (phase === "paused") drawPaused();
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
          get overT() { return overT; }, get board() { return board; }, get chunks() { return chunks.size; }, get trail() { return trail.length; },
          warp(ticks, pilot) { for (let i = 0; i < ticks && sim.s.phase === "play"; i++) { pilot(sim); sim.update(1000 / 60); } trail.length = 0; chunks.clear(); jobs.length = 0; camY = sim.s.y; } };
      }
    }
  };
})();
