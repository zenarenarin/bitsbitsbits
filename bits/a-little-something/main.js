// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// A LITTLE SOMETHING: the first Bit a new Plethora viewer meets.
//
// A small island sits in a pale sea; far off, finished islands float, each one
// made by someone on Plethora. The sky lowers pieces on threads: houses, trees,
// a block of land and finally a lighthouse. Tap to let go. Buildings settle on a
// plot grid and stack, trees take the gaps, land extends or raises the island,
// the sea keeps what misses. Halfway the island tears free and floats. The
// lighthouse brings dusk. Then the Bit teaches Plethora's real gestures, in order:
//   like (swipe the logo right) -> capture (swipe the logo left) -> scroll for more.
// The finished island joins a shared world of everyone's islands.
//
// Visual system: one oblique projection (depth runs up and to the right) and one
// light (upper left). Every solid is a prism with three tones: top lightest,
// front middle, right side darkest. Island tiers, houses, lighthouse, land
// blocks, islets and other people's islands all follow it.
window.plethoraBit = {
  meta: {
    title: "A Little Something",
    runtime: "plethora-bit@2",
    tags: ["toy", "building", "art", "casual", "shared"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    "use strict";

    // ------------------------------------------------------------------ utils
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const sat = (v) => clamp(v, 0, 1);
    const E = {
      inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      out: (t) => 1 - Math.pow(1 - t, 3),
      outQuint: (t) => 1 - Math.pow(1 - t, 5),
      back: (t) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    };
    const win = (t, a, b) => sat((t - a) / (b - a));
    function mulberry(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mixArr(a, b, t) { return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]; }
    function mixRgb(a, b, t) { const m = mixArr(a, b, t); return "rgb(" + m[0] + "," + m[1] + "," + m[2] + ")"; }
    function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

    // ---------------------------------------------------------------- palette
    // A controlled palette: mint air, turquoise sea, sand and olive land, white
    // walls, one orange for roofs and bands, ochre and lime trees, and a single
    // coral used only when the viewer likes the island. Dusk values for solid
    // materials are derived by one night grade so every object darkens the same way.
    const DAWN = {
      skyTop: "#bfe2d6", skyLow: "#e8f1e3", sun: "#f8f1dd",
      sea: "#1fa3a8", seaDeep: "#188f98", seaLine: "#86d8d0", shallow: "#52c2bc",
      cloud: "#f8f4ea", cloudShade: "#e6e7da",
      sandTop: "#f1d899", sand: "#e0b86e", sandSide: "#bf934f",
      grassTop: "#b8c252", earth: "#cd9150", earthSide: "#9f6a37", grassLip: "#97a23d",
      terrTop: "#c7cf5f",
      rockLight: "#a97a4a", rock: "#8c6139", rockDark: "#62432a",
      wall: "#f6f0e4", wallTop: "#fffaf1", wallSide: "#d8cebd",
      roof: "#ee8538", roofLight: "#f6a562", roofDark: "#c45f27",
      glass: "#2c6e77", door: "#2f4c55",
      ochre: "#efab37", ochreS: "#c98620", lime: "#b9c64b", limeS: "#909c33", yellow: "#f3cd4e", yellowS: "#cfa62e",
      trunk: "#6c4f35", thread: "#21403d", shadow: "#2d4a3c",
      ink: "#123c3c"
    };
    const DUSK_EXPLICIT = {
      skyTop: "#143651", skyLow: "#2a6283", sun: "#f3e8c8",
      sea: "#123f5a", seaDeep: "#0c3048", seaLine: "#2f7590", shallow: "#1b5770",
      cloud: "#3e6e8b", cloudShade: "#335f7b", thread: "#d9d2bf", shadow: "#06141c",
      ink: "#f4ecd9"
    };
    const NIGHT = hexRgb("#1a3550");
    function nightGrade(rgb) { return mixArr([rgb[0] * 0.62, rgb[1] * 0.66, rgb[2] * 0.8], NIGHT, 0.32); }
    const PAL_RGB = {};
    for (const k in DAWN) {
      const a = hexRgb(DAWN[k]);
      PAL_RGB[k] = [a, DUSK_EXPLICIT[k] ? hexRgb(DUSK_EXPLICIT[k]) : nightGrade(a)];
    }
    const LAMP = hexRgb("#ffd27a");
    const BLOSSOM = hexRgb("#f2988a");
    const BLOSSOM_S = hexRgb("#d4746a");
    const CREAM = hexRgb("#f8f2e6");
    let P = {}, PR = {};
    const baseP = {}, basePR = {};
    let lastDusk = -1;
    function buildPalette(d) {
      if (Math.abs(d - lastDusk) < 0.002) return;
      lastDusk = d;
      for (const k in PAL_RGB) {
        basePR[k] = mixArr(PAL_RGB[k][0], PAL_RGB[k][1], d);
        baseP[k] = "rgb(" + basePR[k].join(",") + ")";
      }
    }
    buildPalette(0);
    P = baseP; PR = basePR;
    const fogCache = new Map();
    function withFog(k, fogRgb, fn) {
      const key = Math.round(k * 50) + ":" + Math.round(lastDusk * 100);
      let hit = fogCache.get(key);
      if (!hit) {
        if (fogCache.size > 400) fogCache.clear();
        const tP = {}, tPR = {};
        for (const c in basePR) { tPR[c] = mixArr(basePR[c], fogRgb, k); tP[c] = "rgb(" + tPR[c].join(",") + ")"; }
        hit = { tP, tPR };
        fogCache.set(key, hit);
      }
      const sP = P, sPR = PR;
      P = hit.tP; PR = hit.tPR;
      try { fn(); } finally { P = sP; PR = sPR; }
    }

    // ------------------------------------------------------------- surfaces
    const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, layer: "content", input: "auto", touchAction: "none" });
    const g = canvas.getContext("2d");
    if (!g) { ctx.platform.error({ where: "canvas2d", message: "2D context unavailable" }); return; }
    const grainCanvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, layer: "overlay", input: "passthrough" });
    const gg = grainCanvas.getContext("2d");

    const DW = 400, Y0 = 470;
    let W = ctx.width || 400, H = ctx.height || 800, S = 1;
    let area = { top: 0, right: 0, bottom: 120, left: 0 };
    let logo = { x: 0, y: 0, width: 64, height: 48, cx: 0, cy: 0 };
    let hostLayout = null;
    function layout() {
      W = Math.max(1, ctx.width || W);
      H = Math.max(1, ctx.height || H);
      area = ctx.contentSafeArea ?? ctx.safeArea ?? area;
      S = Math.min(W / 365, H / 780);
      const la = ctx.logoArea;
      if (la && la.width > 0) logo = { x: la.x, y: la.y, width: la.width, height: la.height, cx: la.x + la.width / 2, cy: la.y + la.height / 2 };
      else {
        const cy = area.bottom > 70 ? H - area.bottom + 34 : H - 58;
        logo = { x: W / 2 - 32, y: cy - 24, width: 64, height: 48, cx: W / 2, cy };
      }
    }
    ctx.onResize(layout, { immediate: true });
    layout();

    // Film grain, written straight into the overlay's pixels on resize only.
    let grainW = 0, grainH = 0, grainTile = null, grainBlock = 0;
    function paintGrain() {
      if (!gg) return;
      const bw = grainCanvas.width, bh = grainCanvas.height;
      if (!bw || !bh || (grainW === bw && grainH === bh)) return;
      grainW = bw; grainH = bh;
      try {
        const block = Math.max(1, Math.round(bw / Math.max(1, W)));
        const T = 180 * block;
        if (!grainTile || grainBlock !== block) {
          grainBlock = block;
          grainTile = gg.createImageData(T, T);
          const r = mulberry(7), d = grainTile.data;
          for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) {
            const v = r(), dark = v < 0.5, c = dark ? 20 : 255;
            const a = Math.floor((dark ? v * 2 : (v - 0.5) * 2) * 70 * 0.24);
            for (let by = 0; by < block; by++) for (let bx = 0; bx < block; bx++) {
              const i = ((y * block + by) * T + (x * block + bx)) * 4;
              d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = a;
            }
          }
        }
        for (let y = 0; y < bh; y += T) for (let x = 0; x < bw; x += T) gg.putImageData(grainTile, x, y);
      } catch (e) { /* decoration only */ }
    }

    // ------------------------------------------------------------ persistence
    const store = { islands: 0, welcomed: false, learned: { capture: false, like: false }, mine: [] };
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    if (canStore) {
      try {
        const s = ctx.storage.get("als:v1");
        if (s && typeof s === "object") {
          store.islands = Number.isFinite(s.islands) ? Math.max(0, Math.floor(s.islands)) : 0;
          store.welcomed = !!s.welcomed;
          if (s.learned && typeof s.learned === "object") { store.learned.capture = !!s.learned.capture; store.learned.like = !!s.learned.like; }
          if (Array.isArray(s.mine)) store.mine = s.mine.filter((v) => typeof v === "string").slice(-12);
        }
      } catch (e) { /* convenience only */ }
    }
    function save() { if (canStore) { try { ctx.storage.set("als:v1", store); } catch (e) { /* ignore */ } } }
    const firstVisit = !store.welcomed;
    const viewerName = ctx.viewer && ctx.viewer.username ? String(ctx.viewer.username).slice(0, 24) : "";

    // ------------------------------------------------------------------ fonts
    const F_DISPLAY = '"ALS Bebas", "Bebas Neue", "Arial Narrow", "Helvetica Neue", sans-serif';
    const F_TEXT = '"ALS Inter", Inter, "Helvetica Neue", Arial, sans-serif';
    const F_MONO = '"ALS Mono", "Space Mono", ui-monospace, Menlo, monospace';
    const quietly = (p) => (p && p.catch ? p.catch(() => {}) : p);
    quietly(ctx.loadFont("ALS Bebas", "bebas-neue", "1.0.0", { weight: "400" }));
    quietly(ctx.loadFont("ALS Inter", "inter", "1.0.0", { weight: "400" }));
    quietly(ctx.loadFont("ALS Inter", "inter", "1.0.0", { weight: "600" }));
    quietly(ctx.loadFont("ALS Mono", "space-mono", "1.0.0", { weight: "400" }));

    // ------------------------------------------------------------------ audio
    const A = { ac: null, out: null, noise: null, sea: null, seaFilter: null, ready: false, muted: false, music: null };
    function haptic(kind) { if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ } } }
    function audioUnlock() {
      if (A.ac) { if (A.ac.state === "suspended") A.ac.resume().catch(() => {}); }
      else if (ctx.capabilities && ctx.capabilities.audio) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            A.ac = new AC();
            A.out = A.ac.createGain();
            A.out.gain.value = A.muted ? 0 : 0.85;
            const comp = A.ac.createDynamicsCompressor();
            comp.threshold.value = -18;
            A.out.connect(comp); comp.connect(A.ac.destination);
            const len = Math.floor(A.ac.sampleRate * 2);
            const buf = A.ac.createBuffer(1, len, A.ac.sampleRate);
            const d = buf.getChannelData(0), r = mulberry(11);
            for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
            A.noise = buf;
            startSea();
            A.ready = true;
            if (A.ac.state === "suspended") A.ac.resume().catch(() => {});
          }
        } catch (e) { A.ac = null; ctx.platform.error({ where: "audio", message: String((e && e.message) || e) }); }
      }
      if (!A.music && ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music) {
        try {
          quietly(ctx.music.unlock());
          A.music = ctx.music.play({ preset: "ambient", volume: A.muted ? 0 : 0.26, intensity: 0.16, tempo: 66, scale: "pentatonic", fadeInMs: 3000 });
        } catch (e) { A.music = null; }
      }
    }
    function musicSet(fn) { if (A.music) { try { fn(ctx.music); } catch (e) { /* optional */ } } }
    function startSea() {
      const ac = A.ac, src = ac.createBufferSource();
      src.buffer = A.noise; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
      const gn = ac.createGain(); gn.gain.value = 0.045;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.12;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.03;
      lfo.connect(lfoG); lfoG.connect(gn.gain);
      src.connect(f); f.connect(gn); gn.connect(A.out);
      src.start(); lfo.start();
      A.sea = gn; A.seaFilter = f;
    }
    function tone(freq, o) {
      if (!A.ready) return;
      o = o || {};
      const ac = A.ac, t0 = ac.currentTime + (o.at || 0), dur = o.dur || 0.5;
      const osc = ac.createOscillator();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t0 + dur);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(o.gain || 0.1, t0 + (o.attack || 0.006));
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gn); gn.connect(A.out);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    }
    function noiseHit(o) {
      if (!A.ready) return;
      const ac = A.ac, t0 = ac.currentTime + (o.at || 0), dur = o.dur || 0.1;
      const src = ac.createBufferSource(); src.buffer = A.noise;
      const f = ac.createBiquadFilter();
      f.type = o.type || "bandpass";
      f.frequency.setValueAtTime(o.freq || 1200, t0);
      if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
      f.Q.value = o.q || 1;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(o.gain || 0.1, t0 + (o.attack || 0.004));
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(gn); gn.connect(A.out);
      src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
    }
    const PENT = [0, 2, 4, 7, 9];
    const scaleNote = (i) => { i = Math.max(0, Math.floor(i)); return 196 * Math.pow(2, (12 * Math.floor(i / 5) + PENT[i % 5]) / 12); };
    const SFX = {
      snap() { tone(2300, { dur: 0.05, gain: 0.05, glideTo: 1500 }); noiseHit({ dur: 0.03, gain: 0.07, type: "highpass", freq: 3200 }); },
      land(x, level, kind) {
        const n = scaleNote(3 + clamp(Math.floor(((x - 90) / 220) * 6), 0, 6) + level * 2);
        tone(n, { type: "triangle", dur: 1.1, gain: 0.14 });
        tone(n * 2, { dur: 0.6, gain: 0.035 });
        noiseHit({ dur: 0.07, gain: 0.11, freq: kind === "house" ? 950 : kind === "lighthouse" ? 700 : 480, q: 2.5 });
        tone(150, { dur: 0.14, gain: 0.1, glideTo: 80 });
      },
      grow() { tone(scaleNote(8), { type: "triangle", dur: 1.4, gain: 0.08, attack: 0.05 }); noiseHit({ dur: 0.45, gain: 0.09, type: "lowpass", freq: 300, freqTo: 120, attack: 0.05 }); },
      splash() { noiseHit({ dur: 0.7, gain: 0.14, type: "lowpass", freq: 2600, freqTo: 260 }); tone(scaleNote(2), { dur: 0.9, gain: 0.05, attack: 0.04 }); },
      rise() {
        tone(46, { dur: 3.0, gain: 0.22, attack: 0.7 });
        noiseHit({ dur: 2.8, gain: 0.12, type: "lowpass", freq: 180, attack: 0.6 });
        [523.25, 659.25, 783.99, 987.77].forEach((f, i) => tone(f, { at: 1.6 + i * 0.12, dur: 2.6, gain: 0.04, attack: 0.5 }));
      },
      lamp() { [392, 493.88, 587.33, 739.99].forEach((f, i) => tone(f, { type: "triangle", at: i * 0.05, dur: 3.4, gain: 0.05, attack: 0.35 })); tone(1567.98, { at: 0.2, dur: 1.6, gain: 0.03 }); },
      shutter() {
        noiseHit({ dur: 0.03, gain: 0.22, type: "highpass", freq: 2600 });
        noiseHit({ at: 0.075, dur: 0.04, gain: 0.16, type: "highpass", freq: 2000 });
        tone(1318.51, { at: 0.12, dur: 1.4, gain: 0.05 });
        tone(1975.53, { at: 0.12, dur: 1.0, gain: 0.025 });
      },
      like() { [659.25, 783.99, 987.77, 1318.51, 1567.98].forEach((f, i) => tone(f, { at: i * 0.075, dur: 1.0, gain: 0.06 })); tone(329.63, { type: "triangle", dur: 1.8, gain: 0.06, attack: 0.08 }); },
      reveal() { [261.63, 392, 523.25, 659.25].forEach((f, i) => tone(f, { type: "triangle", at: i * 0.18, dur: 2.8, gain: 0.035, attack: 0.4 })); },
      echo() { tone(1046.5, { dur: 0.18, gain: 0.025 }); }
    };
    function setMuted(m) {
      A.muted = m;
      if (A.out) A.out.gain.setTargetAtTime(m ? 0 : 0.85, A.ac.currentTime, 0.05);
      musicSet((mu) => mu.setVolume(m ? 0 : 0.26, { fadeMs: 200 }));
    }
    ctx.onDestroy(() => { try { if (A.ac) A.ac.close(); } catch (e) { /* ignore */ } });

    // ------------------------------------------------------------ geometry
    // One oblique projection for everything: moving one unit back in depth moves
    // V on screen. Positions on the island are given at its middle depth.
    const V = { x: 0.48, y: -0.52 };
    const DEPTH = 56, HALF = 28;
    const UNIT = 50, MARGIN = 28, BEACH = 14, TERR_HW = 28;
    const H_BEACH = 5, H_GRASS = 14, H_TERR = 15;
    const G_TOP = H_BEACH + H_GRASS;
    const HOUSE = { w: 30, d: 20, wall: 20, roof: 14 };
    const DEF = { house: { w: 30, h: 34 }, tree: { w: 16, h: 38 }, hill: { w: 54, h: 26 }, lighthouse: { w: 18, h: 68 } };
    const TREES = ["cone", "round", "cypress"];
    const plotX = (k) => 200 + k * UNIT;
    const gapX = (g) => plotX(g) + UNIT / 2;
    const TREE_BACK = 9; // trees grow on a row behind the buildings
    // Beside a terrace a tree steps down onto level ground instead of its edge.
    const treeX = (g) => gapX(g) + (I.terr[g] && !I.terr[g + 1] ? 8 : !I.terr[g] && I.terr[g + 1] ? -8 : 0);

    function islandModel(seed) {
      return { seed, c0: -1, c1: 1, gL: plotX(-1) - MARGIN, gR: plotX(1) + MARGIN, terr: {}, objects: [], lift: 0, bob: 0, hills: [] };
    }
    let I = null; // the island the helpers act on
    const baseY = () => Y0 - I.lift + I.bob;
    const isLand = (x) => x >= I.gL - BEACH && x <= I.gR + BEACH;
    function tierTop(x) {
      let h = 0;
      if (isLand(x)) h = H_BEACH;
      if (x >= I.gL && x <= I.gR) {
        h = G_TOP;
        for (const k in I.terr) if (Math.abs(x - plotX(+k)) <= TERR_HW) h = Math.max(h, G_TOP + H_TERR * I.terr[k]);
      }
      return h;
    }
    const standY = (x) => baseY() - tierTop(x);
    const plotsOf = () => { const o = []; for (let k = I.c0; k <= I.c1; k++) o.push(k); return o; };
    const buildingsAt = (k) => I.objects.filter((o) => o.type !== "tree" && o.k === k);
    function topHouse(k) {
      let top = null;
      for (const o of buildingsAt(k)) if (o.type === "house" && (!top || o.level > top.level)) top = o;
      return top;
    }
    const nearestK = (x, ks) => ks.reduce((b, k) => (Math.abs(plotX(k) - x) < Math.abs(plotX(b) - x) ? k : b), ks[0]);
    // Seat everything exactly on the surface it stands on; stacks move with their base.
    function reground() {
      for (const o of I.objects) {
        if (o.type === "tree") o.yRel = standY(treeX(o.g)) - baseY() + V.y * TREE_BACK;
        else o.yRel = standY(plotX(o.k)) - baseY() - (o.level || 0) * HOUSE.wall;
        o.x = o.type === "tree" ? treeX(o.g) + V.x * TREE_BACK : plotX(o.k);
      }
    }

    // ------------------------------------------------------------ world state
    let mine = islandModel(1);
    I = mine;
    let islets = [], parts = [], rings = [];
    let rng = mulberry(1);

    // Islands made by other people (shared world), with Plethora's own starters
    // standing in until there are enough. Format 2: seed|c0,c1|terraces|pieces.
    const STARTERS = [
      "2|11|-1,1||H-1.0.0,H0.0.1,T0.c,L1",
      "2|12|-2,1|0|H0.0.0,H0.1.2,T-1.r,T-2.y",
      "2|13|-1,2|2|L2,H0.0.1,H-1.0.0,T0.y",
      "2|14|-1,1|-1|H-1.0.0,H-1.1.1,H-1.2.0,T0.r,L1",
      "2|15|0,2||H1.0.2,T0.c,T1.y,L2"
    ];
    let others = [];
    function decodeIsland(desc) {
      if (typeof desc !== "string" || desc.length > 400) return null;
      const p = desc.split("|");
      if (p[0] !== "2") return null;
      const seed = parseInt(p[1], 10);
      const span = (p[2] || "").split(",").map((v) => parseInt(v, 10));
      if (!Number.isFinite(seed) || span.length !== 2 || !span.every(Number.isFinite)) return null;
      const m = islandModel(seed >>> 0);
      m.c0 = clamp(Math.min(span[0], span[1]), -3, 0);
      m.c1 = clamp(Math.max(span[0], span[1]), 0, 3);
      m.gL = plotX(m.c0) - MARGIN; m.gR = plotX(m.c1) + MARGIN;
      for (const t of (p[3] || "").split(",").filter(Boolean).slice(0, 4)) { const k = parseInt(t, 10); if (k >= m.c0 && k <= m.c1) m.terr[k] = 1; }
      const save = I;
      I = m;
      try {
        const items = (p[4] || "").split(",").filter(Boolean).slice(0, 12)
          .sort((a, b) => (parseInt(a.split(".")[1], 10) || 0) - (parseInt(b.split(".")[1], 10) || 0));
        const usedGaps = new Set();
        for (const s of items) {
          const t = s[0], f = s.slice(1).split(".");
          const k = parseInt(f[0], 10);
          if (!Number.isFinite(k)) continue;
          if (t === "H" && k >= m.c0 && k <= m.c1) {
            const top = topHouse(k);
            if (!top && buildingsAt(k).length) continue;
            const level = top ? top.level + 1 : 0;
            if (level > 3) continue;
            if (top) top.roof = false;
            m.objects.push({ type: "house", k, level, roof: true, variant: clamp(parseInt(f[2], 10) || 0, 0, 2), born: -9, other: true, x: 0, yRel: 0, w: 30 });
          } else if (t === "L" && k >= m.c0 && k <= m.c1 && !buildingsAt(k).length) {
            m.objects.push({ type: "lighthouse", k, level: 0, born: -9, other: true, x: 0, yRel: 0, w: 18 });
          } else if (t === "T" && k >= m.c0 && k < m.c1 && !usedGaps.has(k)) {
            usedGaps.add(k);
            m.objects.push({ type: "tree", g: k, level: 0, variant: { c: "cone", r: "round", y: "cypress" }[f[1]] || "cone", born: -9, other: true, bloomAt: -1, x: 0, yRel: 0, w: 16 });
          }
        }
        reground();
      } finally { I = save; }
      return m;
    }
    function encodeMine() {
      const vc = { cone: "c", round: "r", cypress: "y" };
      const items = mine.objects.map((o) => o.type === "house" ? "H" + o.k + "." + o.level + "." + (o.variant || 0)
        : o.type === "tree" ? "T" + o.g + "." + (vc[o.variant] || "c") : "L" + o.k);
      const terr = Object.keys(mine.terr).filter((k) => mine.terr[k] > 0.5);
      return "2|" + mine.seed + "|" + mine.c0 + "," + mine.c1 + "|" + terr.join(",") + "|" + items.join(",");
    }
    // Where other islands sit: far and hazy at first; gathered around yours at the end.
    const SLOTS = [
      { far: [34, 312, 0.28], near: [-196, -168, 0.52] },
      { far: [384, 296, 0.2], near: [200, -48, 0.56] },
      { far: [296, 404, 0.15], near: [-200, 112, 0.46] },
      { far: [104, 222, 0.14], near: [192, 176, 0.42] },
      { far: [16, 178, 0.11], near: [28, -300, 0.38] }
    ];
    function setOthers(list) {
      const out = [];
      for (const it of list) {
        if (out.length >= SLOTS.length) break;
        const m = decodeIsland(it.d);
        if (m) out.push({ model: m, name: it.n || "", ph: out.length * 1.9 + 0.4 });
      }
      for (let i = 0; out.length < SLOTS.length && i < STARTERS.length; i++) out.push({ model: decodeIsland(STARTERS[i]), name: "plethora", ph: out.length * 1.9 + 0.4 });
      others = out;
    }
    setOthers([]);

    const WORLD = ctx.memory && typeof ctx.memory.world === "function" ? (() => { try { return ctx.memory.world("islands"); } catch (e) { return null; } })() : null;
    function readPoints(snap) {
      const st = snap && (snap.state !== undefined ? snap.state : snap);
      let pts = st && (st.points || st.items || st.objects);
      if (!pts && Array.isArray(st)) pts = st;
      if (pts && !Array.isArray(pts) && typeof pts === "object") pts = Object.values(pts);
      if (!Array.isArray(pts)) return [];
      return pts.filter((p) => p && typeof p === "object" && typeof p.d === "string").map((p) => {
        const by = p.by || p.author || p.user || p.attribution || null;
        const name = (by && (by.username || by.name)) || (typeof by === "string" ? by : "") || (typeof p.n === "string" ? p.n : "");
        return { id: String(p.id || ""), d: p.d, n: String(name).replace(/^@/, "").slice(0, 24), t: p.t || p.updatedAt || 0 };
      });
    }
    let worldLoaded = false;
    if (WORLD) {
      Promise.resolve().then(() => WORLD.get()).then((snap) => {
        const pts = readPoints(snap).filter((p) => store.mine.indexOf(p.id) < 0);
        pts.sort((a, b) => (b.t > a.t ? 1 : -1));
        worldLoaded = true;
        if (pts.length) setOthers(pts);
      }).catch((e) => { ctx.platform.emit("world_read_failed", { message: String((e && e.message) || e).slice(0, 120) }); });
    }
    function contribute() {
      if (!WORLD) return;
      const id = "i" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      const point = { id, x: Math.floor(Math.random() * 1000), y: Math.floor(Math.random() * 1000), d: encodeMine() };
      if (viewerName) point.n = viewerName;
      store.mine.push(id);
      store.mine = store.mine.slice(-12);
      save();
      Promise.resolve().then(() => WORLD.mutate(point)).then(() => ctx.platform.emit("island_shared", {}))
        .catch((e) => ctx.platform.emit("island_share_failed", { message: String((e && e.message) || e).slice(0, 120) }));
    }

    // Scenery: a few graphic cloud bars, a sun that becomes the moon, a handful of stars.
    const clouds = [
      { x: 40, y: 250, s: 1.15, v: 1.6, layer: "back", bars: [[0, 0, 86], [20, -10, 46]] },
      { x: 300, y: 380, s: 0.9, v: 2.2, layer: "back", bars: [[0, 0, 64], [-14, -10, 36]] },
      // One deliberate band beneath the floating island; it sways rather than drifts.
      { x: 196, y: 318, s: 1.3, v: 0, sway: 10, layer: "front", bars: [[-58, -10, 104], [0, 0, 236], [46, 10, 128]] }
    ];
    const stars = [];
    (function () { const r = mulberry(13); for (let i = 0; i < 30; i++) stars.push({ x: r(), y: 0.08 + r() * 0.5, s: r() < 0.2 ? 1.8 : 1.2, ph: r() * TAU }); })();

    // --------------------------------------------------------------- camera
    const cam = { x: 200, y: 400, zoom: 1 };
    let peek = 0;
    const sx = (x) => W / 2 + (x - cam.x) * cam.zoom * S;
    const sy = (y) => H / 2 + (y - cam.y) * cam.zoom * S + peek;
    const viewTop = () => cam.y - H / 2 / (cam.zoom * S);
    const viewH = () => H / (cam.zoom * S);

    // ---------------------------------------------------------------- state
    let now = 0, realNow = 0, timeScale = 1;
    let phase = "intro";
    let phaseT = 0, started = false, attempt = 0;
    let queue = [], qi = 0, riseAfter = 4, risen = false, riseK = 0;
    let dusk = 0, lampK = 0, finaleStart = -1, finaleCam = null;
    let cur = null, threadCut = null, wait = 0, lastInput = 0, pred = null;
    let welcomeK = 1, welcomeOut = -1;
    let missCount = 0, placed = 0;
    let echo = [], jiggle = 0, demoT = -1, swap = null;
    let plateAt = -1, captureAt = -1, likeAt = -1, worldAt = -1;
    let flash = 0, frameSnap = 0, likeGlow = 0;
    let swipeHint = -1;
    const outro = { step: "like", t: 0, cycle0: 0, msg: null, msgT: 0, wait: 0 };
    const done = { like: false, capture: false };
    const passed = { like: false, capture: false };
    let chromeMode = null, chromeAlive = false;

    function newQueue(first) {
      if (first) return ["house", "tree", "house", "hill", "house", "tree", "lighthouse"];
      const pool = ["house", "house", "tree", "tree", "hill", "house"];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      if (pool.indexOf("hill") > 3) { pool.splice(pool.indexOf("hill"), 1); pool.splice(1 + Math.floor(rng() * 3), 0, "hill"); }
      pool.push("lighthouse");
      return pool;
    }

    // ------------------------------------------------------------- pieces
    function tallestY() {
      let t = baseY() - G_TOP - H_TERR;
      for (const o of I.objects) t = Math.min(t, baseY() + o.yRel - (o.type === "house" ? (o.roof ? DEF.house.h : HOUSE.wall) : DEF[o.type].h));
      return t;
    }
    function spawnPiece() {
      const type = queue[qi], def = DEF[type], i = qi;
      const pivotX = 200 + (i === 0 ? 0 : (rng() - 0.5) * 36);
      const vt = viewTop();
      const baseLow = clamp(Math.min(tallestY() - 112, vt + viewH() * 0.4), vt + 200, vt + viewH() * 0.48);
      const L = Math.max(90, baseLow - def.h - (vt - 40));
      cur = {
        type, def, i,
        variant: type === "tree" ? TREES[Math.floor(rng() * 3)] : type === "house" ? Math.floor(rng() * 3) : 0,
        state: i === 0 && phase === "intro" ? "swing" : "lower",
        t: 0, L0: i === 0 && phase === "intro" ? L : 26, L,
        A: [0.3, 0.34, 0.38, 0.4, 0.42, 0.45, 0.36][Math.min(i, 6)],
        w: TAU / [2.9, 2.6, 2.4, 2.2, 2.05, 1.9, 2.3][Math.min(i, 6)],
        pivotX, x: 0, y: 0, vx: 0, vy: 0, rot: 0, spawnReal: realNow
      };
    }
    const pivotY = () => viewTop() - 40;
    function swingState(p) {
      const lowerT = sat(p.t / 0.85);
      const L = p.state === "lower" ? lerp(p.L0, p.L, E.out(lowerT)) : p.L;
      const dL = p.state === "lower" && lowerT < 1 ? ((p.L - p.L0) * 3 * Math.pow(1 - lowerT, 2)) / 0.85 : 0;
      const amp = p.A * (p.state === "lower" ? E.inOut(lowerT) : 1);
      const windA = risen ? 0.06 : 0;
      const th = amp * Math.sin(p.w * p.t) + windA * Math.sin(0.83 * now + 1.3) + jiggle * Math.sin(realNow * 30) * 0.05;
      const thd = amp * p.w * Math.cos(p.w * p.t) + windA * 0.83 * Math.cos(0.83 * now + 1.3);
      const px = p.pivotX, py = pivotY();
      const ax = px + L * Math.sin(th), ay = py + L * Math.cos(th);
      const rot = -th * 0.3; // the piece hangs level-ish; only a hint of lean
      const h = p.def.h;
      return { px, py, ax, ay, rot, L, bx: ax - Math.sin(rot) * h, by: ay + Math.cos(rot) * h,
        vx: L * thd * Math.cos(th) + dL * Math.sin(th), vy: -L * thd * Math.sin(th) + dL * Math.cos(th) };
    }
    function supportAt(x, type, fromY) {
      const hw = DEF[type].w / 2;
      let best = null;
      if (isLand(x)) { const y = standY(x); if (y >= fromY - 6) best = { y, kind: "land", obj: null }; }
      for (const o of I.objects) {
        if (o.type !== "house") continue;
        const dx = x - o.x;
        if (Math.abs(dx) > HOUSE.w / 2 + hw * 0.35) continue;
        const ob = baseY() + o.yRel;
        const y = type === "house" || !o.roof ? ob - HOUSE.wall : ob - HOUSE.wall - HOUSE.roof * sat(1 - Math.abs(dx) / (HOUSE.w / 2 + 3));
        if (y < fromY - 6) continue;
        if (!best || y < best.y) best = { y, kind: "house", obj: o };
      }
      return best || { y: Y0 + 2, kind: "water", obj: null };
    }
    // The composition rules: where a piece really ends up.
    function resolve(type, x, s) {
      if (s.kind === "water") return { kind: "water", x, y: s.y };
      const ks = plotsOf();
      if (type === "hill") {
        const k = Math.round((x - 200) / UNIT);
        if (k < I.c0) return { kind: "extend", side: -1, k: I.c0 - 1, x: plotX(I.c0 - 1), y: standY(plotX(I.c0)) };
        if (k > I.c1) return { kind: "extend", side: 1, k: I.c1 + 1, x: plotX(I.c1 + 1), y: standY(plotX(I.c1)) };
        if (!I.terr[k]) return { kind: "terrace", k, x: plotX(k), y: standY(plotX(k)) };
        const side = x < (plotX(I.c0) + plotX(I.c1)) / 2 ? -1 : 1;
        const nk = side < 0 ? I.c0 - 1 : I.c1 + 1;
        return { kind: "extend", side, k: nk, x: plotX(nk), y: standY(plotX(side < 0 ? I.c0 : I.c1)) };
      }
      if (type === "house") {
        let k = s.kind === "house" ? s.obj.k : nearestK(x, ks);
        if (buildingsAt(k).some((o) => o.type === "lighthouse")) {
          const free = ks.filter((v) => !buildingsAt(v).length);
          k = free.length ? nearestK(x, free) : nearestK(x, ks.filter((v) => topHouse(v)));
        }
        const onto = topHouse(k);
        if (onto) return { kind: "house", k, x: plotX(k), y: baseY() + onto.yRel - HOUSE.wall, onto };
        return { kind: "land", k, x: plotX(k), y: standY(plotX(k)) };
      }
      if (type === "lighthouse") {
        const free = ks.filter((v) => !buildingsAt(v).length);
        if (free.length) { const k = nearestK(x, free); return { kind: "land", k, x: plotX(k), y: standY(plotX(k)) }; }
        // No free plot: the lighthouse makes its own headland at the nearer end.
        const side = x < (plotX(I.c0) + plotX(I.c1)) / 2 ? -1 : 1;
        const nk = side < 0 ? I.c0 - 1 : I.c1 + 1;
        return { kind: "headland", side, k: nk, x: plotX(nk), y: standY(plotX(side < 0 ? I.c0 : I.c1)) };
      }
      const gs = [];
      for (let gk = I.c0; gk < I.c1; gk++) gs.push(gk);
      const byDist = gs.slice().sort((a, b) => Math.abs(gapX(a) - x) - Math.abs(gapX(b) - x));
      const freeGap = (v) => !I.objects.some((o) => o.type === "tree" && o.g === v);
      const clearOfSteps = (v) => !I.terr[v] && !I.terr[v + 1]; // never on a terrace's edge
      const gk = byDist.find((v) => freeGap(v) && clearOfSteps(v)) ?? byDist.find(freeGap);
      const g2 = gk !== undefined ? gk : byDist[0];
      return { kind: "land", g: g2, x: treeX(g2) + V.x * TREE_BACK, y: standY(treeX(g2)) + V.y * TREE_BACK };
    }
    const GRAV = 1500;
    function fallStep(p, dt) {
      const prevY = p.y;
      p.vy += GRAV * dt;
      p.vx *= 1 - 0.12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += (0 - p.rot) * (1 - Math.exp(-6 * dt));
      const s = supportAt(p.x, p.type, prevY);
      return p.y >= s.y ? s : null;
    }
    function predict() {
      if (!cur || (cur.state !== "swing" && cur.state !== "lower")) return null;
      const st = swingState(cur);
      const p = { type: cur.type, x: st.bx, y: st.by, vx: st.vx, vy: st.vy, rot: st.rot };
      for (let i = 0; i < 360; i++) {
        const s = fallStep(p, 1 / 120);
        if (s) { const r = resolve(cur.type, p.x, s); return { x: r.x, y: r.y, kind: r.kind, rawX: p.x }; }
      }
      return null;
    }
    function release() {
      const st = swingState(cur);
      cur.state = "fall";
      cur.x = st.bx; cur.y = st.by; cur.vx = st.vx; cur.vy = st.vy; cur.rot = st.rot;
      threadCut = { px: st.px, ax: st.ax, ay: st.ay, t: 0 };
      jiggle = 0;
      SFX.snap();
      haptic("light");
      ctx.platform.interact({ type: "release", piece: cur.type, index: cur.i });
    }
    function beginPlaying() {
      if (phase !== "intro" || !cur || cur.state === "fall") return;
      if (!started) { started = true; ctx.platform.start(); }
      release();
      phase = "play";
      welcomeOut = realNow;
      store.welcomed = true;
      save();
    }
    function ring(x, y, kind, big) { rings.push({ x, y, t: 0, max: big ? 1.6 : 0.9, kind, big: !!big }); }
    // Grow the island toward plot k on one side, or raise a terrace on plot k.
    function extendTo(k) {
      if (k < I.c0) I.c0 = k;
      if (k > I.c1) I.c1 = k;
    }
    function landPiece(p, s) {
      const type = p.type;
      placed++;
      if (s.kind === "water") {
        missCount++;
        islets.push({ x: p.x, kind: type, variant: p.variant, t: Math.random() * 10, born: now });
        ring(p.x, Y0, "water", true);
        for (let i = 0; i < 5; i++) parts.push({ k: "drop", x: p.x + (i - 2) * 4, y: Y0, vx: (i - 2) * 26, vy: -150 - (2 - Math.abs(i - 2)) * 40, life: 0, max: 0.7, r: 1.8 });
        SFX.splash();
        haptic("light");
        return;
      }
      haptic("medium");
      const r = resolve(type, p.x, s);
      if (type === "hill") {
        if (r.kind === "extend") extendTo(r.k);
        else I.terr[r.k] = I.terr[r.k] || 0.001;
        mine.hills.push(r.k);
        ring(r.x, standY(r.x), "impact", true);
        SFX.grow();
        return;
      }
      if (r.kind === "headland") extendTo(r.k);
      let o;
      if (type === "tree") o = { type, g: r.g, x: r.x, level: 0, variant: p.variant, born: now, bloomAt: -1, slideFrom: p.x, w: 16, yRel: 0 };
      else {
        const level = r.onto ? r.onto.level + 1 : 0;
        if (r.onto) r.onto.roof = false;
        o = { type, k: r.k, x: r.x, level, roof: true, variant: p.variant, born: now, litDelay: 0, slideFrom: p.x, w: DEF[type].w, yRel: 0 };
      }
      I.objects.push(o);
      reground();
      ring(r.x, baseY() + o.yRel, "impact", false);
      SFX.land(r.x, o.level || 0, type);
    }

    // ---------------------------------------------------------- run control
    function beginRun(first) {
      attempt++;
      const sd = first ? 20261120 : Math.floor(Math.random() * 1e9);
      mine = islandModel(sd);
      I = mine;
      rng = mulberry(sd ^ 0x5bd1);
      islets = [];
      parts = []; rings = [];
      queue = newQueue(first);
      qi = 0; placed = 0; missCount = 0;
      risen = false; riseK = 0; dusk = 0; lampK = 0; finaleStart = -1; finaleCam = null;
      plateAt = captureAt = likeAt = worldAt = -1;
      frameSnap = 0; likeGlow = 0; swipeHint = -1;
      cam.y = 400; cam.zoom = 1;
      cur = null; threadCut = null; wait = 0;
      musicSet((m) => { m.setIntensity(0.16, { fadeMs: 1500 }); m.setScale("pentatonic"); });
      if (A.sea) { A.sea.gain.setTargetAtTime(0.045, A.ac.currentTime, 0.5); A.seaFilter.frequency.setTargetAtTime(420, A.ac.currentTime, 0.5); }
    }
    function afterLanding() {
      qi++;
      ctx.platform.setProgress(qi / queue.length);
      if (!risen && qi === riseAfter) { wait = 0.5; pendingRise = true; return; }
      if (qi >= queue.length) { wait = 0.45; pendingFinale = true; return; }
      wait = 0.45;
    }
    let pendingRise = false, pendingFinale = false;
    function setPhase(p) {
      phase = p;
      phaseT = 0;
      if (p === "rise") {
        SFX.rise();
        haptic("heavy");
        ctx.platform.milestone("island_rose");
        musicSet((m) => m.setIntensity(0.32, { fadeMs: 2500 }));
        ring((I.gL + I.gR) / 2, Y0, "water", true);
      }
      if (p === "finale") {
        finaleStart = now;
        let k = 0;
        for (const o of I.objects.slice().sort((a, b) => a.x - b.x)) o.litDelay = 1.1 + (k++) * 0.13;
        ctx.platform.milestone("island_complete");
        store.islands += 1;
        store.welcomed = true;
        save();
        contribute();
        musicSet((m) => { m.setScale("lydian"); m.setIntensity(0.45, { fadeMs: 3000 }); });
        try { ctx.platform.complete({ pieces: queue.length, atSea: missCount }); } catch (e) { /* ignore */ }
      }
      if (p === "outro") { outro.t = 0; outro.cycle0 = realNow; outro.step = "like"; nextOutro(true); }
    }
    function nextOutro(fromStart) {
      const order = ["like", "plate", "capture", "artefact", "world", "scroll"];
      let i = fromStart ? 0 : Math.min(order.indexOf(outro.step) + 1, order.length - 1);
      for (;;) {
        const s = order[i];
        if (s === "like" && (done.like || passed.like || store.learned.like)) { i++; continue; }
        if (s === "plate" && plateAt >= 0) { i++; continue; }
        if (s === "capture" && (done.capture || passed.capture || store.learned.capture)) { i++; continue; }
        if (s === "artefact" && captureAt < 0) { i++; continue; }
        break;
      }
      const s = order[Math.min(i, order.length - 1)];
      if (s !== outro.step || fromStart) {
        outro.step = s;
        outro.t = 0;
        outro.cycle0 = realNow;
        if (s === "plate") plateAt = realNow;
        if (s === "world") { worldAt = realNow; SFX.reveal(); ctx.platform.milestone("world_revealed"); }
      }
    }
    function replay() {
      if (swap) return;
      swap = { t: 0, did: false };
      ctx.platform.start();
      ctx.platform.interact({ type: "replay" });
    }

    // --------------------------------------------------------- host chrome
    // First-party Bits receive ctx.chrome. Plethora's logo button is the real
    // control: swipe right likes, swipe left captures. The Bit teaches these on
    // that control and reacts when the host reports them; it draws no controls.
    const ACTION_MATCH = [["capture", /capture|screenshot|camera|snap|comment/i], ["like", /like|heart|love|fav/i]];
    function classify(name) { const s = String(name || ""); for (const [k, re] of ACTION_MATCH) if (re.test(s)) return k; return null; }
    function onHostAction(e) {
      const kind = classify(e && (e.action || e.name || e.type));
      ctx.platform.emit("host_action_seen", { action: String((e && e.action) || ""), kind: kind || "other" });
      if (kind) onLearned(kind);
    }
    function onHostMode(e) {
      const m = e && (e.mode !== undefined ? e.mode : e);
      const prev = chromeMode;
      chromeMode = m || null;
      if (prev === "browse" && chromeMode === "play" && phase === "intro") ctx.timeout(() => { if (phase === "intro") beginPlaying(); }, 140);
    }
    const chrome = ctx.chrome;
    if (chrome && typeof chrome.on === "function") {
      chromeAlive = true;
      chromeMode = chrome.mode || null;
      hostLayout = chrome.layout || null;
      const evs = Array.isArray(chrome.events) ? chrome.events : ["mode", "layout", "action"];
      try { if (evs.indexOf("action") >= 0) chrome.on("action", onHostAction); } catch (e) { /* ignore */ }
      try { if (evs.indexOf("mode") >= 0) chrome.on("mode", onHostMode, { immediate: true }); } catch (e) { /* ignore */ }
      try { if (evs.indexOf("layout") >= 0) chrome.on("layout", (l) => { hostLayout = (l && l.layout) || l || null; }, { immediate: true }); } catch (e) { /* ignore */ }
    }
    function onLearned(kind) {
      if (kind === "like") { likeAt = realNow; bloomWave(); SFX.like(); haptic("success"); }
      if (kind === "capture") {
        captureAt = realNow;
        if (phase === "outro") { timeScale = 0; flash = 1; frameSnap = 1; if (plateAt < 0) plateAt = realNow - 1; }
        else flash = 0.6;
        SFX.shutter();
        haptic("success");
      }
      const wasDone = done[kind];
      done[kind] = true;
      if (!store.learned[kind]) { store.learned[kind] = true; save(); }
      if (!wasDone) ctx.platform.milestone("learned_" + kind);
      if (phase === "outro" && outro.step === kind) {
        outro.msg = kind === "like" ? "It likes you back." : null;
        outro.msgT = realNow;
        outro.wait = kind === "like" ? 1.9 : 0.05;
      }
    }
    function bloomWave() {
      const span = Math.max(1, mine.gR - mine.gL);
      for (const o of mine.objects) if (o.type === "tree" && o.bloomAt < 0) o.bloomAt = now + 0.15 + ((o.x - mine.gL) / span) * 0.6;
      likeGlow = 1;
      const save = I; I = mine;
      const cx = (mine.gL + mine.gR) / 2, cy = standY(cx);
      I = save;
      ring(cx, cy, "like", true);
      rings.push({ x: cx, y: cy, t: -0.25, max: 1.6, kind: "like", big: true });
      for (let i = 0; i < 10; i++) {
        const x = lerp(mine.gL + 10, mine.gR - 10, (i + 0.5) / 10);
        parts.push({ k: "petal", x, y: cy - 30 - (i % 3) * 8, vx: (i % 2 ? 1 : -1) * 6, vy: -16 - (i % 4) * 4, life: -0.2 - i * 0.05, max: 2.4, r: 3, rot: i });
      }
    }

    // ---------------------------------------------------------------- input
    const muteRect = () => ({ x: W - area.right - 40, y: area.top + 6, w: 34, h: 34 });
    let downAt = null;
    function onDown(ev) {
      if (ev.cancelable) ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      audioUnlock();
      downAt = { x: px, y: py, t: realNow };
      const m = muteRect();
      if (started && px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) { downAt = null; setMuted(!A.muted); return; }
      lastInput = realNow;
      if (swap) return;
      if (phase === "intro") { beginPlaying(); return; }
      if (phase === "play" && cur && (cur.state === "swing" || (cur.state === "lower" && cur.t > 0.3))) { release(); return; }
      if (phase === "outro" && outro.step === "scroll") return;
      echo.push({ x: px, y: py, t: realNow });
      SFX.echo();
      if (phase === "outro") outro.cycle0 = realNow;
    }
    function onUp(ev) {
      if (!downAt) return;
      const r = canvas.getBoundingClientRect();
      const dx = ev.clientX - r.left - downAt.x, dy = ev.clientY - r.top - downAt.y;
      const dt = realNow - downAt.t;
      downAt = null;
      if (phase !== "outro" || outro.step !== "scroll") return;
      if (dy < -40 && Math.abs(dy) > Math.abs(dx)) { swipeHint = realNow; return; }
      if (dt < 0.35 && Math.hypot(dx, dy) < 12 && outro.t > 2.5) replay();
    }
    ctx.listen(canvas, "pointerdown", onDown, { passive: false });
    ctx.listen(canvas, "pointerup", onUp);

    // --------------------------------------------------------------- update
    const FINALE_ZOOM = 0.9;
    const plateBottomPx = () => area.top + 40 + 96;
    function solveFinaleCam() {
      const tallest = tallestY();
      const need = plateBottomPx() + 22, seaMax = logo.y - 100;
      const zoom = clamp(Math.min(FINALE_ZOOM, (seaMax - need) / Math.max(1, Y0 - tallest) / S), 0.5, FINALE_ZOOM);
      const z = zoom * S;
      let c = 232;
      if (H / 2 + (Y0 - c) * z > seaMax) c = Y0 - (seaMax - H / 2) / z;
      if (H / 2 + (tallest - c) * z < need) c = tallest - (need - H / 2) / z;
      return { y: c, zoom };
    }

    function update(dtMs) {
      const rdt = Math.min(0.05, dtMs / 1000);
      realNow += rdt;
      if (timeScale < 1) timeScale = Math.min(1, timeScale + rdt * (realNow - captureAt > 0.75 ? 3 : 0));
      const dt = rdt * timeScale;
      now += dt;
      phaseT += dt;
      if (swap) updateSwap(rdt);
      if (welcomeOut >= 0) welcomeK = 1 - sat((realNow - welcomeOut) / 0.6);
      I = mine;

      // The island's shape eases toward its targets; everything stays seated.
      const tgL = plotX(I.c0) - MARGIN, tgR = plotX(I.c1) + MARGIN;
      let moved = false;
      if (Math.abs(I.gL - tgL) > 0.05 || Math.abs(I.gR - tgR) > 0.05) {
        const k = 1 - Math.exp(-dt * 10);
        I.gL = lerp(I.gL, tgL, k); I.gR = lerp(I.gR, tgR, k);
        moved = true;
      } else { I.gL = tgL; I.gR = tgR; }
      for (const k in I.terr) if (I.terr[k] < 1) { I.terr[k] = Math.min(1, I.terr[k] + dt * 2.6); moved = true; }
      if (moved) reground();

      if (cur) {
        if (cur.state === "lower" || cur.state === "swing") {
          cur.t += dt;
          if (cur.state === "lower" && cur.t > 0.85) cur.state = "swing";
          jiggle *= Math.exp(-5 * rdt);
        } else if (cur.state === "fall") {
          let acc = dt, s = null;
          while (acc > 0 && !s) { const h = Math.min(acc, 1 / 120); s = fallStep(cur, h); acc -= h; }
          if (s) { landPiece(cur, s); cur = null; afterLanding(); }
        }
      } else if (phase === "play" || phase === "intro") {
        wait -= dt;
        if (wait <= 0) {
          if (pendingRise) { pendingRise = false; setPhase("rise"); }
          else if (pendingFinale) { pendingFinale = false; setPhase("finale"); }
          else if (qi < queue.length) spawnPiece();
        }
      }
      pred = predict();
      if (threadCut) { threadCut.t += dt; if (threadCut.t > 0.7) threadCut = null; }

      if (phase === "rise") {
        const lt = E.inOut(win(phaseT, 0.5, 3.0));
        mine.lift = 300 * lt;
        riseK = lt;
        if (phaseT > 3.4) {
          risen = true;
          if (A.seaFilter) { A.seaFilter.frequency.setTargetAtTime(900, A.ac.currentTime, 1); A.sea.gain.setTargetAtTime(0.03, A.ac.currentTime, 1); }
          setPhase("play");
          wait = 0.2;
        }
      }
      if (risen) mine.bob = Math.sin(now * 0.9) * 2.4;
      cam.y = 400 - 0.8 * mine.lift;
      cam.zoom = 1;

      if (phase === "finale" || phase === "outro") {
        const ft = now - finaleStart;
        lampK = ft < 0.3 ? 0 : ft < 0.36 ? 1 : ft < 0.46 ? 0.1 : ft < 0.54 ? 1 : sat(0.6 + (ft - 0.54));
        if (ft > 0.52 && ft - dt <= 0.52) { SFX.lamp(); haptic("success"); }
        dusk = E.inOut(win(ft, 0.4, 2.7));
        const ck = E.inOut(win(ft, 0.8, 2.9));
        if (finaleCam === null) finaleCam = solveFinaleCam();
        cam.y = lerp(400 - 0.8 * mine.lift, finaleCam.y, ck);
        cam.zoom = lerp(1, finaleCam.zoom, ck);
        if (worldAt >= 0) {
          const wk = E.inOut(sat((realNow - worldAt) / 2.6));
          const zFar = finaleCam.zoom * 0.7;
          const cy = (baseY() - 10) - (H * 0.44 - H / 2) / (zFar * S);
          cam.zoom = lerp(cam.zoom, zFar, wk);
          cam.y = lerp(cam.y, cy, wk);
        }
        if (phase === "finale" && ft > 3.3) setPhase("outro");
      }
      if (phase === "outro") updateOutro(rdt);
      frameSnap *= Math.exp(-3.5 * rdt);
      likeGlow = Math.max(0, likeGlow - rdt * 0.5);
      flash = Math.max(0, flash - rdt * 2.6);

      if (cur && (cur.state === "swing" || cur.state === "lower") && (phase === "intro" || phase === "play")) {
        const idle = realNow - Math.max(lastInput, cur.spawnReal);
        if (idle > (phase === "intro" ? 1.4 : 4.5) && realNow - demoT > (phase === "intro" ? 3.6 : 4.4)) {
          demoT = realNow;
          ctx.timeout(() => { jiggle = 1; }, 380);
        }
      }

      for (const c of clouds) {
        if (c.x0 === undefined) c.x0 = c.x;
        if (c.sway) c.x = c.x0 + Math.sin(now * 0.12) * c.sway;
        else { c.x += c.v * dt; if (c.x > 480) c.x = -90; }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt;
        if (p.life < 0) continue;
        if (p.k === "drop") { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > Y0 && p.vy > 0) p.life = p.max; }
        else if (p.k === "petal") { p.x += (p.vx + Math.sin(now * 1.6 + p.rot) * 8) * dt; p.y += p.vy * dt; p.rot += dt * 1.5; }
        if (p.life >= p.max) parts.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t >= rings[i].max) rings.splice(i, 1); }
      for (let i = echo.length - 1; i >= 0; i--) if (realNow - echo[i].t > 0.6) echo.splice(i, 1);
    }

    function updateOutro(rdt) {
      outro.t += rdt;
      if (outro.wait > 0) { outro.wait -= rdt; if (outro.wait <= 0) { outro.wait = 0; nextOutro(); } return; }
      const patience = chromeAlive ? 11 : 8;
      const s = outro.step;
      if (s === "like" && outro.t > patience) { passed.like = true; nextOutro(); }
      else if (s === "plate" && outro.t > 1.0) nextOutro();
      else if (s === "capture" && outro.t > patience) { passed.capture = true; nextOutro(); }
      else if (s === "artefact" && outro.t > 1.7) nextOutro();
      else if (s === "world" && outro.t > 3.4) nextOutro();
      if (outro.step === "scroll") {
        const ct = (realNow - outro.cycle0) % 2.8;
        const target = chromeMode === "browse" ? 0 : -22 * E.inOut(win(ct, 0.35, 1.2)) * (1 - E.inOut(win(ct, 1.5, 2.2)));
        peek = lerp(peek, target, 1 - Math.exp(-rdt * 14));
      } else peek = lerp(peek, 0, 1 - Math.exp(-rdt * 10));
    }
    function updateSwap(rdt) {
      swap.t += rdt;
      if (!swap.did && swap.t >= 0.45) {
        swap.did = true;
        beginRun(false);
        phase = "play"; phaseT = 0; wait = 0.5;
        outro.step = "like";
        peek = 0;
      }
      if (swap.t >= 1.05) swap = null;
    }

    // --------------------------------------------------------------- drawing
    function poly(pts, fill) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
    }
    function splitFill(path, lit, shade, splitX) {
      g.fillStyle = lit; path(); g.fill();
      g.save(); g.beginPath(); g.rect(splitX, -2000, 4000, 4000); g.clip();
      g.fillStyle = shade; path(); g.fill();
      g.restore();
    }
    function tracked(str, x, y, track, align, stroke) {
      g.textAlign = "left";
      let total = 0;
      const ws = [];
      for (const ch of str) { const w = g.measureText(ch).width; ws.push(w); total += w + track; }
      total -= track;
      let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      let i = 0;
      for (const ch of str) { if (stroke) g.strokeText(ch, cx, y); else g.fillText(ch, cx, y); cx += ws[i++] + track; }
      return total;
    }
    const inkFor = (a) => rgba(PR.ink, a);
    // A prism centred on x at middle depth, standing on y: front, right side, top.
    function prism(x0, x1, yBot, yTop, d0, d1, cTop, cFront, cSide) {
      const fx = V.x * d0, fy = V.y * d0, bx = V.x * d1, by = V.y * d1;
      poly([[x0 + fx, yTop + fy], [x1 + fx, yTop + fy], [x1 + bx, yTop + by], [x0 + bx, yTop + by]], cTop);
      poly([[x0 + fx, yTop + fy], [x1 + fx, yTop + fy], [x1 + fx, yBot + fy], [x0 + fx, yBot + fy]], cFront);
      poly([[x1 + fx, yTop + fy], [x1 + bx, yTop + by], [x1 + bx, yBot + by], [x1 + fx, yBot + fy]], cSide);
    }
    function chamfer(pts, c) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
        const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
        out.push([p[0] + ((a[0] - p[0]) / la) * c, p[1] + ((a[1] - p[1]) / la) * c]);
        out.push([p[0] + ((b[0] - p[0]) / lb) * c, p[1] + ((b[1] - p[1]) / lb) * c]);
      }
      return out;
    }

    function drawSky() {
      const grd = g.createLinearGradient(0, 0, 0, Math.max(sy(Y0 - 66), 10));
      grd.addColorStop(0, P.skyTop);
      grd.addColorStop(1, P.skyLow);
      g.fillStyle = grd;
      g.fillRect(0, -40, W, H + 80);
      if (dusk > 0.05) {
        for (const s of stars) {
          const a = dusk * (0.7 + 0.3 * Math.sin(realNow * 0.8 + s.ph));
          g.fillStyle = "rgba(250,244,226," + Math.min(1, a).toFixed(3) + ")";
          g.fillRect(Math.round(s.x * W), Math.round(s.y * H), s.s, s.s);
        }
      }
      const wk = worldAt >= 0 ? E.inOut(sat((realNow - worldAt) / 2.6)) : 0;
      const mx = W * (0.78 + wk * 0.04), my = Math.max(area.top + 150, H * (0.27 + dusk * 0.05 - wk * 0.08)) + peek * 0.3;
      g.fillStyle = P.sun;
      g.beginPath(); g.arc(mx, my, (34 - dusk * 6) * S, 0, TAU); g.fill();
    }
    function pushCam(f) {
      g.save();
      g.translate(W / 2, H / 2 + peek * (0.4 + 0.6 * f));
      g.scale(cam.zoom * S, cam.zoom * S);
      g.translate(-cam.x, -(400 + (cam.y - 400) * f));
    }
    function cloudShape(c) {
      g.fillStyle = P.cloud;
      const s = c.s, h = 9 * s;
      for (const b of c.bars) {
        const x = c.x + b[0] * s - (b[2] * s) / 2, y = c.y + b[1] * s - h / 2, w = b[2] * s;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h);
        g.fill();
      }
    }
    function drawClouds(layer, alpha) {
      if (alpha <= 0.01) return;
      g.globalAlpha = alpha;
      for (const c of clouds) if (c.layer === layer) cloudShape(c);
      g.globalAlpha = 1;
    }

    // Other people's islands: hazy and small at first, gathered close at the end.
    function otherPlacement(i) {
      const sl = SLOTS[i];
      const fy = 400 + (cam.y - 400) * 0.35;
      const fx = W / 2 + (sl.far[0] - 200) * cam.zoom * S;
      const fyy = H / 2 + (sl.far[1] - fy) * cam.zoom * S + peek * 0.5;
      const fs = sl.far[2] * cam.zoom * S;
      const wk = worldAt >= 0 ? E.inOut(sat((realNow - worldAt - 0.2) / 2.4)) : 0;
      const ux = (mine.gL + mine.gR) / 2, uy = Y0 - mine.lift + mine.bob - 10;
      const nx = sx(ux + sl.near[0]), ny = sy(uy + sl.near[1]);
      const ns = sl.near[2] * cam.zoom * S;
      return { x: lerp(fx, nx, wk), y: lerp(fyy, ny, wk), s: lerp(fs, ns, wk), k: wk };
    }
    function drawOthers() {
      const fogCol = mixArr(basePR.skyLow, basePR.skyTop, 0.3);
      for (let i = 0; i < others.length; i++) {
        const o = others[i];
        const pl = otherPlacement(i);
        const bob = Math.sin(realNow * 0.55 + o.ph) * 2.2 * pl.s;
        g.save();
        g.translate(pl.x, pl.y + bob);
        g.scale(pl.s, pl.s);
        g.translate(-200, -Y0);
        const save = I;
        I = o.model;
        try { withFog(lerp(0.74, 0.12, pl.k) + (i % 2) * 0.04, fogCol, () => drawIsland(true)); }
        finally { I = save; }
        g.restore();
      }
    }
    function drawOtherLabels(a) {
      if (a <= 0.01) return;
      g.font = "400 9.5px " + F_MONO;
      for (let i = 0; i < others.length; i++) {
        const o = others[i];
        if (!o.name) continue;
        const pl = otherPlacement(i);
        const save = I; I = o.model;
        const under = underDepth() + 20;
        I = save;
        g.fillStyle = inkFor(0.72 * a);
        tracked("@" + o.name.toUpperCase(), pl.x, pl.y + under * pl.s + 12, 1.4, "center");
      }
    }

    function drawSea(from) {
      const bot = cam.y + H / 2 / (cam.zoom * S) + 60;
      g.fillStyle = P.sea;
      g.fillRect(-800, from, 2000, Math.max(0, Y0 + 150 - from));
      g.fillStyle = P.seaDeep;
      g.fillRect(-800, Math.max(from, Y0 + 150), 2000, bot + 600);
    }
    // The island's footprint on the water: a shallow shelf and one contour line.
    function footprint(pad) {
      const xl = I.gL - BEACH, xr = I.gR + BEACH;
      const yf = Y0 + V.y * -HALF, yb = Y0 + V.y * HALF;
      return chamfer([[xl - HALF * V.x - pad, yf + pad * 0.32], [xr - HALF * V.x + pad, yf + pad * 0.32], [xr + HALF * V.x + pad, yb - pad * 0.32], [xl + HALF * V.x - pad, yb - pad * 0.32]], pad * 0.7);
    }
    function drawShelf() {
      const k = 1 - riseK;
      if (k <= 0.01) return;
      g.globalAlpha = k;
      poly(footprint(9), P.shallow);
      g.strokeStyle = P.seaLine;
      g.lineWidth = 1.2;
      poly(footprint(21 + Math.sin(realNow * 0.7) * 1.5));
      g.stroke();
      g.globalAlpha = 1;
    }
    function drawRings() {
      for (const r of rings) {
        if (r.t < 0) continue;
        const k = r.t / r.max, e = E.out(k);
        const rad = (r.big ? 14 : 8) + e * (r.big ? 70 : 28);
        g.strokeStyle = r.kind === "water" ? rgba(PR.seaLine, 1 - k) : r.kind === "like" ? rgba(BLOSSOM, 0.9 * (1 - k)) : "rgba(255,255,255," + (0.85 * (1 - k)).toFixed(3) + ")";
        g.lineWidth = r.big ? 1.6 : 1.4;
        g.beginPath(); g.ellipse(r.x, r.y, rad, rad * 0.34, 0, 0, TAU); g.stroke();
      }
    }
    function drawIslets() {
      for (const it of islets) {
        const bob = Math.sin(now * 1.1 + it.t) * 0.8;
        const sink = it.born > 0 ? (1 - E.out(sat((now - it.born) / 0.7))) * 8 : 0;
        const y = Y0 + bob + sink;
        if (it.kind === "rock") {
          prism(it.x - 7, it.x + 7, y + 2, y - 5, -6, 6, P.sandTop, P.sand, P.sandSide);
          continue;
        }
        const hw = it.kind === "hill" ? 22 : 17;
        prism(it.x - hw, it.x + hw, y + 2, y - 4, -10, 10, P.sandTop, P.sand, P.sandSide);
        if (it.kind === "hill") prism(it.x - hw + 5, it.x + hw - 5, y - 4, y - 14, -7, 7, P.grassTop, P.earth, P.earthSide);
        else if (it.kind === "house") drawHouse(it.x, y - 4, { level: 0, roof: true, variant: it.variant, lit: dusk });
        else if (it.kind === "tree") drawTree(it.x, y - 4, it.variant, 0);
        else if (it.kind === "lighthouse") drawLighthouse(it.x, y - 4, lampK);
        g.strokeStyle = rgba(PR.seaLine, 0.9);
        g.lineWidth = 1;
        poly(chamfer([[it.x - hw - 8, y + 8], [it.x + hw + 8, y + 8], [it.x + hw + 14, y - 4], [it.x - hw + 2, y - 4]], 5));
        g.stroke();
      }
    }
    function litFor(o) {
      if (o.other) return dusk;
      if (finaleStart < 0) return 0;
      return sat((now - finaleStart - (o.litDelay || 1.6)) / 0.35);
    }
    function underDepth() { return clamp((I.gR - I.gL + 2 * BEACH) * 0.4, 48, 92); }

    // The island: a faceted rock underside, a sand beach slab, a grass plateau,
    // raised terraces, then what stands on them.
    function drawIsland(isOther) {
      const b = baseY();
      const xl = I.gL - BEACH, xr = I.gR + BEACH;
      if (I.lift > 1 || isOther) {
        const yf = b - V.y * HALF, du = underDepth();
        const fl = [xl - V.x * HALF, yf], fr = [xr - V.x * HALF, yf], br = [xr + V.x * HALF, b + V.y * HALF];
        const mx = (fl[0] + fr[0]) / 2;
        const apex = [mx + 10, yf + du];
        const shoulder = [fl[0] + (fr[0] - fl[0]) * 0.2, yf + du * 0.45];
        poly([fl, [mx, yf], apex, shoulder], P.rockLight);
        poly([[mx, yf], fr, apex], P.rock);
        poly([fr, br, apex], P.rockDark);
        if (!isOther && phase === "rise") drawStreams(fl[0], fr[0], yf);
      }
      prism(xl, xr, b, b - H_BEACH, -HALF, HALF, P.sandTop, P.sand, P.sandSide);
      drawJetty(xl, b);
      prism(I.gL, I.gR, b - H_BEACH, b - G_TOP, -HALF + 8, HALF - 8, P.grassTop, P.earth, P.earthSide);
      // A thin grass lip along the plateau's front edge.
      g.fillStyle = P.grassLip;
      g.fillRect(I.gL + V.x * (-HALF + 8), b - G_TOP + V.y * (-HALF + 8), I.gR - I.gL, 2.5);
      const ks = Object.keys(I.terr).map(Number).sort((a, c) => a - c);
      for (const k of ks) {
        const t = I.terr[k];
        if (t <= 0) continue;
        const x = plotX(k), top = b - G_TOP - H_TERR * E.out(t);
        prism(x - TERR_HW, x + TERR_HW, b - G_TOP, top, -HALF + 13, HALF - 13, P.terrTop, P.earth, P.earthSide);
        g.fillStyle = P.grassLip;
        g.fillRect(x - TERR_HW + V.x * (-HALF + 13), top + V.y * (-HALF + 13), TERR_HW * 2, 2.5);
      }
      // Back row of trees first, then buildings in plot order, floors upward.
      for (const o of I.objects) if (o.type === "tree") drawObject(o, b);
      const bs = I.objects.filter((o) => o.type !== "tree").sort((a, c) => a.k - c.k || a.level - c.level);
      for (const o of bs) drawObject(o, b);
    }
    // A small wooden jetty off the left beach: scale, and a hint that someone lives here.
    function drawJetty(xl, b) {
      const d0 = -HALF + 6, d1 = -HALF + 14, y = b - H_BEACH + 1.5;
      const x0 = xl - 34, x1 = xl + 4;
      for (const px of [x0 + 3, x0 + 17]) {
        g.fillStyle = P.trunk;
        g.fillRect(px + V.x * d0, y + V.y * d0, 2, 9);
      }
      prism(x0, x1, y + 2, y, d0, d1, P.sandTop, P.trunk, P.trunk);
    }
    function drawStreams(x0, x1, y0) {
      const a = sat((phaseT - 0.6) / 0.3) * (1 - sat((phaseT - 2.3) / 0.8));
      if (a <= 0) return;
      g.strokeStyle = "rgba(236,250,247," + (0.75 * a).toFixed(3) + ")";
      g.lineWidth = 1.4;
      g.setLineDash([10, 8]);
      g.lineDashOffset = -realNow * 140;
      const n = Math.max(5, Math.round((x1 - x0) / 26));
      for (let i = 0; i <= n; i++) {
        const x = lerp(x0 + 10, x1 - 10, i / n);
        g.beginPath(); g.moveTo(x, y0 + 2); g.lineTo(x, Y0 - 2); g.stroke();
      }
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    function squashFor(o) {
      const t = now - o.born;
      if (t > 0.6 || t < 0) return [1, 1];
      const k = Math.exp(-t * 10) * Math.cos(t * 24);
      return [1 + 0.06 * k, 1 - 0.08 * k];
    }
    function drawObject(o, b) {
      const [ssx, ssy] = squashFor(o);
      const st = now - o.born;
      const x = o.slideFrom !== undefined && st < 0.2 && st >= 0 ? lerp(o.slideFrom, o.x, E.out(st / 0.2)) : o.x;
      const y = b + o.yRel;
      if (!o.level) {
        // Contact shadow, cast to the lower right by the upper-left light.
        g.fillStyle = rgba(PR.shadow, 0.2);
        g.beginPath(); g.ellipse(x + 5, y + 1.5, (o.type === "house" ? 20 : o.type === "lighthouse" ? 13 : 9), 3.2, 0, 0, TAU); g.fill();
      }
      g.save();
      g.translate(x, y);
      g.scale(ssx, ssy);
      if (o.type === "house") drawHouse(0, 0, { level: o.level, roof: o.roof, variant: o.variant, lit: litFor(o) });
      else if (o.type === "tree") drawTree(0, 0, o.variant, o.bloomAt >= 0 ? sat((now - o.bloomAt) / 0.45) : 0, o.bloomAt >= 0 ? now - o.bloomAt : -1);
      else if (o.type === "lighthouse") drawLighthouse(0, 0, o.other ? dusk : lampK);
      g.restore();
    }

    // A house: a white box and a pyramid roof, the same projection as the island.
    function drawHouse(x, y, o) {
      const hw = HOUSE.w / 2, hd = HOUSE.d / 2, wall = HOUSE.wall, rf = HOUSE.roof, oh = 2.5;
      prism(x - hw, x + hw, y, y - wall, -hd, hd, P.wallTop, P.wall, P.wallSide);
      const fx = x - hw + V.x * -hd, fy = y - wall + V.y * -hd; // front face top-left
      const lit = o.lit || 0;
      const glass = lit > 0 ? mixRgb(PR.glass, LAMP, lit) : P.glass;
      if (lit > 0) {
        g.fillStyle = "rgba(255,210,122," + (0.2 * lit).toFixed(3) + ")";
        g.fillRect(fx + 2, fy + 2, HOUSE.w - 4, wall - 4);
      }
      g.fillStyle = glass;
      if (o.level === 0) {
        g.fillRect(fx + 5, fy + 6, 6, 7);
        g.fillStyle = P.door;
        g.fillRect(fx + 18, fy + 8, 7, 12);
      } else if ((o.variant || 0) === 1) g.fillRect(fx + 5, fy + 7, HOUSE.w - 10, 5);
      else { g.fillRect(fx + 5, fy + 6, 6, 7); g.fillRect(fx + 19, fy + 6, 6, 7); }
      if (o.roof) {
        const yt = y - wall;
        const c = (sx0, d) => [x + sx0 + V.x * d, yt + V.y * d];
        const FL = c(-hw - oh, -hd - oh), FR = c(hw + oh, -hd - oh), BR = c(hw + oh, hd + oh), BL = c(-hw - oh, hd + oh);
        const A = [x, yt - rf];
        poly([BL, BR, A], P.roofLight);
        poly([BL, FL, A], P.roofLight);
        poly([FR, BR, A], P.roofDark);
        poly([FL, FR, A], P.roof);
      }
    }
    function treeColors(v) { return v === "round" ? [PR.lime, PR.limeS] : v === "cypress" ? [PR.yellow, PR.yellowS] : [PR.ochre, PR.ochreS]; }
    function drawTree(x, y, variant, bloom, bt) {
      const [c1, c2] = treeColors(variant);
      const lit = bloom > 0 ? mixRgb(c1, BLOSSOM, bloom) : "rgb(" + c1.join(",") + ")";
      const sh = bloom > 0 ? mixRgb(c2, BLOSSOM_S, bloom) : "rgb(" + c2.join(",") + ")";
      const pop = bt >= 0 && bt < 0.5 ? 1 + Math.sin((bt / 0.5) * Math.PI) * 0.08 : 1;
      g.save();
      g.translate(x, y);
      g.scale(pop, pop);
      g.strokeStyle = P.trunk;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -8); g.stroke();
      if (variant === "round") splitFill(() => { g.beginPath(); g.arc(0, -17, 9, 0, TAU); }, lit, sh, 2);
      else if (variant === "cypress") splitFill(() => { g.beginPath(); g.ellipse(0, -21, 5.5, 15, 0, 0, TAU); }, lit, sh, 1);
      else splitFill(() => { g.beginPath(); g.moveTo(0, -38); g.lineTo(8.5, -6); g.lineTo(-8.5, -6); g.closePath(); }, lit, sh, 1.5);
      g.restore();
    }
    function drawLighthouse(x, y, lamp) {
      g.save();
      g.translate(x, y);
      const tower = () => { g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.lineTo(7, -44); g.lineTo(-7, -44); g.closePath(); };
      splitFill(tower, P.wall, P.wallSide, 2.5);
      g.save(); tower(); g.clip();
      g.fillStyle = P.roof; g.fillRect(-12, -18, 24, 6); g.fillRect(-12, -34, 24, 6);
      g.fillStyle = P.roofDark; g.fillRect(2.5, -18, 12, 6); g.fillRect(2.5, -34, 12, 6);
      g.restore();
      if (lamp > 0) {
        const grd = g.createRadialGradient(0, -51, 2, 0, -51, 20);
        grd.addColorStop(0, "rgba(255,220,140," + (0.55 * lamp).toFixed(3) + ")");
        grd.addColorStop(1, "rgba(255,220,140,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(0, -51, 20, 0, TAU); g.fill();
      }
      g.fillStyle = P.thread; g.fillRect(-10, -46.5, 20, 2.5);
      g.fillStyle = lamp > 0 ? mixRgb(PR.glass, LAMP, lamp) : P.glass;
      g.fillRect(-5, -55, 10, 8.5);
      splitFill(() => { g.beginPath(); g.moveTo(-7.5, -55); g.lineTo(7.5, -55); g.lineTo(0, -64); g.closePath(); }, P.roof, P.roofDark, 1);
      g.strokeStyle = P.thread; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -64); g.lineTo(0, -68); g.stroke();
      g.restore();
    }
    function drawLandBlock() {
      // A block of land on a thread: grass on top, earth beneath, a rock keel.
      poly([[-25 + V.x * -14, -8 + V.y * -14], [25 + V.x * -14, -8 + V.y * -14], [6, 4]], P.rock);
      poly([[25 + V.x * -14, -8 + V.y * -14], [25 + V.x * 14, -8 + V.y * 14], [6, 4]], P.rockDark);
      prism(-25, 25, -8, -26, -14, 14, P.grassTop, P.earth, P.earthSide);
      g.fillStyle = P.grassLip;
      g.fillRect(-25 + V.x * -14, -26 + V.y * -14, 50, 2.5);
    }
    function drawPiece(type, variant) {
      if (type === "house") drawHouse(0, 0, { level: 0, roof: true, variant });
      else if (type === "tree") drawTree(0, 0, variant, 0, -1);
      else if (type === "hill") drawLandBlock();
      else drawLighthouse(0, 0, 0);
    }
    function drawThreadAndPiece() {
      const pY = pivotY();
      if (threadCut) {
        const k = threadCut.t / 0.7;
        const len = (1 - E.out(sat(k * 1.2))) * (threadCut.ay - pY);
        g.strokeStyle = rgba(PR.thread, 0.9 * (1 - k));
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(threadCut.px, pY);
        const ex = lerp(threadCut.px, threadCut.ax, len / Math.max(1, threadCut.ay - pY));
        g.lineTo(ex, pY + len);
        g.stroke();
      }
      if (!cur) return;
      if (cur.state === "fall") {
        g.save();
        g.translate(cur.x, cur.y);
        g.rotate(cur.rot);
        drawPiece(cur.type, cur.variant);
        g.restore();
        return;
      }
      const st = swingState(cur);
      if (pred) {
        if (pred.kind === "water") {
          g.strokeStyle = rgba(PR.seaLine, 0.9);
          g.lineWidth = 1.3;
          g.beginPath(); g.ellipse(pred.rawX, Y0 + 2, cur.def.w * 0.55, cur.def.w * 0.18, 0, 0, TAU); g.stroke();
        } else {
          g.fillStyle = rgba(PR.shadow, cur.i < 2 ? 0.24 : 0.17);
          g.beginPath(); g.ellipse(pred.x + 4, pred.y + 1, cur.def.w * 0.62, cur.def.w * 0.14 + 1.5, 0, 0, TAU); g.fill();
        }
      }
      const ca = tapCueAlpha();
      if (ca > 0) {
        const hx = st.bx + Math.sin(st.rot) * cur.def.h * 0.5, hy = st.by - cur.def.h * 0.5;
        const hr = Math.max(cur.def.w, cur.def.h) * 0.62 + 12 / (cam.zoom * S);
        const grd = g.createRadialGradient(hx, hy, hr * 0.2, hx, hy, hr * 1.3);
        grd.addColorStop(0, rgba(CREAM, 0.7 * ca));
        grd.addColorStop(1, rgba(CREAM, 0));
        g.fillStyle = grd;
        g.beginPath(); g.arc(hx, hy, hr * 1.3, 0, TAU); g.fill();
      }
      g.strokeStyle = P.thread;
      g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(st.px, st.py); g.lineTo(st.ax, st.ay); g.stroke();
      g.save();
      g.translate(st.ax, st.ay);
      g.rotate(st.rot);
      g.translate(0, cur.def.h);
      drawPiece(cur.type, cur.variant);
      g.restore();
    }
    function drawParticles() {
      for (const p of parts) {
        if (p.life < 0) continue;
        const k = p.life / p.max;
        if (p.k === "drop") { g.fillStyle = "rgba(255,255,255," + (0.9 * (1 - k)).toFixed(3) + ")"; g.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
        else if (p.k === "petal") {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.fillStyle = rgba(BLOSSOM, sat(Math.min(k * 4, 1 - k)) * 0.95);
          g.beginPath(); g.moveTo(0, -p.r); g.lineTo(p.r * 0.6, 0); g.lineTo(0, p.r); g.lineTo(-p.r * 0.6, 0); g.closePath(); g.fill();
          g.restore();
        }
      }
    }
    function drawBeam() {
      if (lampK <= 0.01) return;
      const lh = mine.objects.find((o) => o.type === "lighthouse");
      const il = !lh ? islets.find((o) => o.kind === "lighthouse") : null;
      let lx, ly;
      if (lh) { lx = lh.x; ly = Y0 - mine.lift + mine.bob + lh.yRel - 51; }
      else if (il) { lx = il.x; ly = Y0 - 4 - 51; }
      else return;
      const ang = Math.sin(now * 0.5) * 1.2, dir = Math.cos(ang) >= 0 ? 1 : -1;
      const a0 = ang - 0.05, a1 = ang + 0.05, R = 900;
      g.fillStyle = "rgba(255,236,186," + (0.15 * lampK * (0.4 + dusk * 0.6)).toFixed(3) + ")";
      poly([[lx, ly], [lx + Math.cos(a0) * R * dir, ly + Math.sin(a0) * R * 0.22], [lx + Math.cos(a1) * R * dir, ly + Math.sin(a1) * R * 0.22 + 26]]);
      g.fill();
    }
    function drawLikeGlow() {
      const cx = (mine.gL + mine.gR) / 2, cy = Y0 - mine.lift + mine.bob - 30;
      const k = Math.sin(Math.PI * Math.min(1, (1 - likeGlow) * 1.4));
      const r = 130 + (1 - likeGlow) * 60;
      const grd = g.createRadialGradient(cx, cy, 10, cx, cy, r);
      grd.addColorStop(0, "rgba(242,152,138," + (0.32 * k).toFixed(3) + ")");
      grd.addColorStop(1, "rgba(242,152,138,0)");
      g.fillStyle = grd;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }

    // ------------------------------------------------------------ overlays
    function drawWelcome() {
      if (welcomeK <= 0.001) return;
      const k = E.out(welcomeK), top = area.top + 58, lift = (1 - k) * -10;
      const title = firstVisit ? "WELCOME TO PLETHORA" : "A LITTLE SOMETHING";
      const sub = firstVisit ? "There's a little something here." : "Make another little island.";
      g.textBaseline = "alphabetic";
      g.font = "400 " + Math.round(clamp(W * 0.118, 36, 58)) + "px " + F_DISPLAY;
      g.lineJoin = "round";
      g.strokeStyle = rgba(PR.skyTop, 0.95 * k);
      g.lineWidth = 7;
      tracked(title, W / 2, top + 30 + lift, 1.2, "center", true);
      g.fillStyle = inkFor(0.96 * k);
      tracked(title, W / 2, top + 30 + lift, 1.2, "center");
      g.font = "400 15px " + F_TEXT;
      g.textAlign = "center";
      g.lineWidth = 6;
      g.strokeText(sub, W / 2, top + 56 + lift * 0.6);
      g.fillStyle = inkFor(0.78 * k);
      g.fillText(sub, W / 2, top + 56 + lift * 0.6);
    }
    function tapCueAlpha() {
      if (!cur || !(cur.state === "swing" || cur.state === "lower")) return 0;
      if (phase === "intro") return sat((realNow + 0.3) / 0.4);
      if (phase !== "play") return 0;
      return sat((realNow - Math.max(lastInput, cur.spawnReal) - 4.5) / 0.5);
    }
    // The tap target is the hanging piece: rings around it, a finger that lands
    // on it, and the words directly beneath it.
    function drawTapCue() {
      const a = tapCueAlpha();
      if (a <= 0) return;
      const st = swingState(cur);
      const cxp = sx(st.bx + Math.sin(st.rot) * cur.def.h * 0.5), cyp = sy(st.by - cur.def.h * 0.5);
      const R = Math.max(cur.def.w, cur.def.h) * 0.62 * cam.zoom * S + 12;
      for (let i = 0; i < 2; i++) {
        const k = ((realNow * 0.5 + i * 0.5) % 1);
        g.strokeStyle = inkFor(0.4 * (1 - k) * a);
        g.lineWidth = 1.3;
        g.beginPath(); g.arc(cxp, cyp, R + k * 20, 0, TAU); g.stroke();
      }
      g.font = "400 12px " + F_MONO;
      g.lineJoin = "round";
      g.strokeStyle = rgba(PR.skyTop, 0.85 * a);
      g.lineWidth = 5;
      const label = phase === "intro" ? "TAP TO PLAY" : "TAP TO DROP";
      const lx = clamp(cxp, 70, W - 70), ly = cyp + R + 26;
      tracked(label, lx, ly, 2.8, "center", true);
      g.fillStyle = inkFor(0.95 * a);
      tracked(label, lx, ly, 2.8, "center");
      const dt = realNow - demoT;
      if (demoT > 0 && dt < 1.5) ghostTap(cxp + 4, cyp + 4, dt, a);
    }
    function ghostTap(x, y, t, a) {
      const appear = sat(t / 0.25), press = win(t, 0.3, 0.45), gone = win(t, 0.8, 1.15);
      const alpha = a * appear * (1 - gone);
      if (alpha <= 0) return;
      const off = (1 - E.out(appear)) * 24;
      const r = 15 * (1 - press * 0.16);
      g.fillStyle = "rgba(255,255,255," + (0.5 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(x + off, y + off, r, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.6 * alpha);
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x + off, y + off, r, 0, TAU); g.stroke();
      if (t > 0.35) {
        const rk = win(t, 0.35, 1.2);
        g.strokeStyle = inkFor(0.5 * (1 - rk) * a);
        g.beginPath(); g.arc(x, y, 15 + rk * 30, 0, TAU); g.stroke();
      }
    }
    function drawMute() {
      if (!started) return;
      const m = muteRect(), cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      const a = 0.42;
      g.strokeStyle = inkFor(a); g.fillStyle = inkFor(a); g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(cx - 6, cy - 2.5); g.lineTo(cx - 3, cy - 2.5); g.lineTo(cx + 2, cy - 6.5); g.lineTo(cx + 2, cy + 6.5); g.lineTo(cx - 3, cy + 2.5); g.lineTo(cx - 6, cy + 2.5); g.closePath();
      g.fill();
      if (A.muted) { g.beginPath(); g.moveTo(cx + 4.5, cy - 3); g.lineTo(cx + 9.5, cy + 3); g.moveTo(cx + 9.5, cy - 3); g.lineTo(cx + 4.5, cy + 3); g.stroke(); }
      else { g.beginPath(); g.arc(cx + 2, cy, 5, -0.7, 0.7); g.stroke(); g.beginPath(); g.arc(cx + 2, cy, 8.5, -0.7, 0.7); g.stroke(); }
    }
    function dateLabel() {
      const d = new Date(), p = (n) => (n < 10 ? "0" : "") + n;
      return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + String(d.getFullYear()).slice(2);
    }
    function plateK() {
      if (plateAt < 0) return 0;
      const k = E.out(sat((realNow - plateAt) / 0.9));
      return worldAt >= 0 ? k * (1 - E.inOut(sat((realNow - worldAt) / 1.2))) : k;
    }
    function frameRect() {
      const inset = 12 + frameSnap * 10;
      return { L: inset, R: W - inset, T: area.top + 40, B: Math.min(logo.y - 84, H - 12) };
    }
    function drawPlate() {
      const pk = plateK();
      if (pk <= 0.001) return;
      const f = frameRect();
      const ins = (1 - pk) * 10;
      const L = f.L + ins, R = f.R - ins, T = f.T + ins, B = f.B - ins;
      g.strokeStyle = inkFor(0.4 * pk);
      g.lineWidth = 1;
      g.strokeRect(L, T, R - L, B - T);
      g.strokeStyle = inkFor(0.85 * pk);
      g.lineWidth = 1.4;
      const cs = 9;
      g.beginPath();
      g.moveTo(L, T + cs); g.lineTo(L, T); g.lineTo(L + cs, T);
      g.moveTo(R - cs, T); g.lineTo(R, T); g.lineTo(R, T + cs);
      g.moveTo(L, B - cs); g.lineTo(L, B); g.lineTo(L + cs, B);
      g.moveTo(R - cs, B); g.lineTo(R, B); g.lineTo(R, B - cs);
      g.stroke();
      g.fillStyle = inkFor(0.97 * pk);
      g.font = "400 " + Math.round(clamp(W * 0.114, 34, 54)) + "px " + F_DISPLAY;
      tracked("A LITTLE SOMETHING", W / 2, f.T + 58, 1.3, "center");
      g.font = "400 15px " + F_TEXT;
      g.textAlign = "center";
      g.fillStyle = inkFor(0.8 * pk);
      g.fillText("An island you made.", W / 2, f.T + 84);
      if (captureAt >= 0) {
        const ck = E.out(sat((realNow - captureAt - 0.4) / 0.6)) * pk;
        g.font = "400 9.5px " + F_MONO;
        g.fillStyle = inkFor(0.72 * ck);
        tracked(dateLabel(), R - 12, B - 12, 1.6, "right");
      }
    }
    // Gesture demonstrations happen on Plethora's own logo button. The Bit draws
    // no hearts, cameras or buttons of its own: only attention around the real
    // control, a finger that presses it, and the direction of the swipe.
    function logoRing(spread, alpha) {
      const w = logo.width + spread * 2, h = logo.height + spread * 2;
      const x = logo.cx - w / 2, y = logo.cy - h / 2, r = Math.min(h / 2, 14 + spread * 0.6);
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
      g.strokeStyle = inkFor(alpha);
      g.lineWidth = 1.4;
      g.stroke();
    }
    function ghostSwipe(dir, t, a) {
      const cx = logo.cx, cy = logo.cy, dist = 92;
      for (let i = 0; i < 2; i++) { const k = (realNow * 0.6 + i * 0.5) % 1; logoRing(5 + k * 16, 0.5 * (1 - k) * a); }
      const appear = sat(t / 0.25), press = win(t, 0.25, 0.35), move = E.inOut(win(t, 0.35, 1.2)), gone = win(t, 1.6, 2.0);
      const alpha = a * appear * (1 - gone);
      if (t > 0.2 && t < 0.65) { const pk = win(t, 0.2, 0.65); logoRing(1 + pk * 9, 0.9 * (1 - pk) * a); }
      if (alpha <= 0) return;
      const fx = cx + dir * dist * move;
      if (move > 0.02) {
        const grd = g.createLinearGradient(cx, cy, fx, cy);
        grd.addColorStop(0, inkFor(0));
        grd.addColorStop(1, inkFor(0.55 * alpha));
        g.strokeStyle = grd; g.lineWidth = 2; g.lineCap = "round";
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(fx, cy); g.stroke();
      }
      g.strokeStyle = inkFor(0.7 * alpha * (1 - move * 0.6));
      g.lineWidth = 1.6; g.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const k = ((realNow * 1.6 + i / 3) % 1);
        const x = fx + dir * (22 + i * 9 + k * 4);
        g.globalAlpha = 0.35 + 0.65 * (1 - Math.abs(k - 0.5) * 2);
        g.beginPath(); g.moveTo(x - dir * 3.5, cy - 5); g.lineTo(x + dir * 1.5, cy); g.lineTo(x - dir * 3.5, cy + 5); g.stroke();
      }
      g.globalAlpha = 1; g.lineCap = "butt";
      const r = 15 * (1 - press * 0.15 + press * move * 0.15);
      g.fillStyle = "rgba(255,255,255," + (0.42 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(fx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.8 * alpha); g.lineWidth = 1.5;
      g.beginPath(); g.arc(fx, cy, r, 0, TAU); g.stroke();
    }
    // A finger pushes the world upward: how the Bits feed is scrolled.
    function ghostScroll(t, a, bottomY) {
      const x = W - area.right - 46;
      const y0 = bottomY - 30, y1 = bottomY - 180;
      const appear = sat(t / 0.3), move = E.inOut(win(t, 0.35, 1.2)), gone = win(t, 1.6, 2.1);
      const alpha = a * appear * (1 - gone);
      if (alpha <= 0) return;
      const fy = lerp(y0, y1, move);
      const grd = g.createLinearGradient(x, y0, x, fy);
      grd.addColorStop(0, inkFor(0));
      grd.addColorStop(1, inkFor(0.5 * alpha));
      g.strokeStyle = grd; g.lineWidth = 2; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, fy); g.stroke();
      g.lineCap = "butt";
      g.fillStyle = "rgba(255,255,255," + (0.36 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(x, fy, 14, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.75 * alpha); g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, fy, 14, 0, TAU); g.stroke();
    }
    function cueLabel(line1, line2, a, y) {
      g.textAlign = "center";
      if (line1) { g.font = "600 15px " + F_TEXT; g.fillStyle = inkFor(0.95 * a); g.fillText(line1, W / 2, y); }
      g.font = "400 11px " + F_MONO;
      g.fillStyle = inkFor(0.82 * a);
      tracked(line2, W / 2, y + (line1 ? 20 : 0), 2.4, "center");
    }
    function drawOutro() {
      if (phase !== "outro") return;
      const labelY = logo.y - 46;
      if (outro.msg && realNow - outro.msgT < 2.0) {
        const t = realNow - outro.msgT, a = sat(t / 0.25) * (1 - win(t, 1.4, 2.0));
        g.textAlign = "center"; g.font = "600 15px " + F_TEXT; g.fillStyle = inkFor(0.95 * a);
        g.fillText(outro.msg, W / 2, labelY + 10);
      }
      if (outro.wait > 0) return;
      const a = sat(outro.t / 0.5);
      const ct = (realNow - outro.cycle0) % 2.6;
      if (outro.step === "like") {
        cueLabel("Enjoyed that?", "SWIPE RIGHT TO LIKE", a, labelY);
        ghostSwipe(1, ct, a);
      } else if (outro.step === "capture") {
        cueLabel("Keep your island.", "SWIPE LEFT TO CAPTURE", a, labelY);
        ghostSwipe(-1, ct, a);
      } else if (outro.step === "world" || outro.step === "scroll") {
        const wa = sat((realNow - worldAt - 1.2) / 0.8);
        g.font = "400 15px " + F_TEXT; g.textAlign = "center";
        g.fillStyle = inkFor(0.9 * wa);
        g.fillText("Your island joins everyone else's.", W / 2, area.top + 58);
        if (outro.step === "scroll") {
          const browse = chromeMode === "browse";
          const cardTop = hostLayout && hostLayout.card && hostLayout.card.y > H * 0.3 ? hostLayout.card.y : H - 250;
          const bottom = browse ? cardTop - 16 : logo.y - 22;
          const st = (realNow - outro.cycle0) % 2.8;
          ghostScroll(st, a, bottom);
          cueLabel(null, "SCROLL TO PLAY MORE", a, bottom - 4);
          if (swipeHint >= 0 && realNow - swipeHint < 2.8 && !browse) {
            const ha = sat((realNow - swipeHint) / 0.2) * (1 - win(realNow - swipeHint, 2.2, 2.8));
            g.font = "400 10.5px " + F_MONO; g.fillStyle = inkFor(0.8 * ha);
            tracked("TAP { } FIRST, THEN SCROLL", W / 2, bottom - 26, 1.8, "center");
          }
        }
      }
    }
    function drawEcho() {
      for (const e of echo) {
        const k = (realNow - e.t) / 0.6;
        g.strokeStyle = inkFor(0.35 * (1 - k)); g.lineWidth = 1.2;
        g.beginPath(); g.arc(e.x, e.y, 6 + k * 18, 0, TAU); g.stroke();
      }
    }

    function drawScene() {
      drawSky();
      pushCam(0.6); drawClouds("back", 0.85); g.restore();
      drawOthers();
      pushCam(1);
            drawBeam();
      if (likeGlow > 0) drawLikeGlow();
      drawSea(Y0 - 66);
      drawShelf();
      I = mine;
      drawIsland(false);
      drawSea(Y0 - V.y * HALF); // water in front of the island hides what is submerged
      drawRings();
      drawIslets();
      drawThreadAndPiece();
      drawParticles();
      if (riseK > 0.05) drawClouds("front", riseK * (worldAt >= 0 ? 0.55 : 0.95));
      g.restore();
      drawPlate();
    }
    function artefactK() {
      if (captureAt < 0 || phase !== "outro") return 0;
      const t = realNow - captureAt;
      if (t < 0.15 || t > 1.9) return 0;
      return Math.sin(Math.PI * sat((t - 0.15) / 1.75));
    }
    function render() {
      paintGrain();
      buildPalette(dusk);
      P = baseP; PR = basePR;
      I = mine;
      const art = artefactK();
      if (art > 0.001) {
        const f = frameRect();
        g.fillStyle = rgba(basePR.seaDeep, 1);
        g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(0,0,0," + (0.35 * art).toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
        const cx = (f.L + f.R) / 2, cy = (f.T + f.B) / 2, s = 1 - 0.07 * art;
        g.save();
        g.translate(cx, cy); g.rotate(-0.012 * art); g.scale(s, s); g.translate(-cx, -cy);
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(f.L + 6, f.T + 10, f.R - f.L, f.B - f.T);
        g.beginPath(); g.rect(f.L, f.T, f.R - f.L, f.B - f.T); g.clip();
        drawScene();
        g.restore();
      } else drawScene();
      if (welcomeK > 0) drawWelcome();
      drawTapCue();
      if (phase === "outro" && (outro.step === "world" || outro.step === "scroll")) drawOtherLabels(sat((realNow - worldAt - 1.6) / 0.8));
      if (art <= 0.001) drawOutro();
      drawEcho();
      drawMute();
      if (flash > 0) { g.fillStyle = "rgba(255,252,244," + (flash * 0.85).toFixed(3) + ")"; g.fillRect(0, 0, W, H); }
      if (swap) {
        const a = swap.t < 0.45 ? E.inOut(swap.t / 0.45) : 1 - E.inOut(sat((swap.t - 0.45) / 0.6));
        g.fillStyle = rgba(basePR.skyLow, a);
        g.fillRect(0, 0, W, H);
      }
    }

    // ------------------------------------------------------------------ boot
    beginRun(true);
    spawnPiece();

    let errorReported = false;
    function safe(fn, where) {
      return function (a, b) {
        try { fn(a, b); } catch (e) {
          I = mine; P = baseP; PR = basePR;
          if (!errorReported) {
            errorReported = true;
            ctx.platform.error({ where, message: String((e && e.message) || e), stack: String((e && e.stack) || "").slice(0, 800) });
          }
        }
      };
    }
    render();
    ctx.markVisualReady("island");
    ctx.platform.ready();
    ctx.game.loop({ update: safe(update, "update"), render: safe(render, "render") });

    if (typeof window !== "undefined" && window.__ALS_DEV) {
      window.__als = {
        get state() {
          return { phase, qi, placed, missCount, risen, dusk, outro: outro.step, done: Object.assign({}, done), cur: cur ? cur.state : null,
            objects: mine.objects.length, islets: islets.length, edgeL: mine.gL, edgeR: mine.gR, others: others.map((o) => o.name), worldLoaded };
        },
        pred: () => pred,
        objects: () => { const s = I; I = mine; const r = mine.objects.map((o) => ({ type: o.type, x: o.x, level: o.level, yRel: Math.round(o.yRel * 10) / 10, ground: Math.round((standY(o.x) - baseY() - (o.level || 0) * HOUSE.wall) * 10) / 10 })); I = s; return r; },
        encode: () => encodeMine()
      };
    }
  }
};
