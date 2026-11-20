// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// A LITTLE SOMETHING: the first Bit a new Plethora viewer meets.
//
// A small island sits in a pale sea. The sky lowers pieces of a world on threads:
// houses, trees, a piece of hill, and at the end a lighthouse. Tap to let go.
// Houses stack, land grows the island, and the sea keeps whatever misses. After
// the fourth piece the island tears free of the sea and floats. The last piece
// lights the lamp, dusk falls, and the island becomes a framed plate that is worth
// capturing. The Bit then teaches Plethora's real host gestures on the logo
// button (swipe left = capture, swipe right = like, tap = navigation) and reacts
// when the viewer actually performs them, via ctx.chrome (first-party Bits).
window.plethoraBit = {
  meta: {
    title: "A Little Something",
    runtime: "plethora-bit@2",
    tags: ["toy", "building", "art", "casual", "welcome"],
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
      in: (t) => t * t * t,
      back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    };
    const win = (t, a, b) => sat((t - a) / (b - a)); // 0..1 progress of t through [a,b]
    function mulberry(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hexRgb(h) {
      const n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function mixRgb(a, b, t) {
      return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
    }
    function rgba(rgbArr, a) { return "rgba(" + rgbArr[0] + "," + rgbArr[1] + "," + rgbArr[2] + "," + a + ")"; }

    // ---------------------------------------------------------------- palette
    // Dawn (index 0) to dusk (index 1). Everything in the world is drawn from these.
    const PAL = {
      skyTop: ["#9fd2c6", "#163a57"],
      skyLow: ["#e6f0de", "#2f6886"],
      far: ["#b9d9cd", "#24526e"],
      farDark: ["#a3cbbf", "#1d4864"],
      sea: ["#20a5ac", "#103d58"],
      seaDeep: ["#17909a", "#0b2f48"],
      seaLine: ["#72d3cd", "#2f7690"],
      shallow: ["#58c5bf", "#1c5b74"],
      sand: ["#dcb46a", "#937246"],
      sandDark: ["#c19750", "#6e5536"],
      grass: ["#a7a94c", "#557040"],
      grassDark: ["#878b3c", "#405834"],
      rock: ["#a9804b", "#4f3e2e"],
      rockDark: ["#7c5a35", "#372b21"],
      wall: ["#f6efe0", "#ccd0c7"],
      wallShade: ["#d7cdb8", "#8e999b"],
      roof: ["#ec8a3f", "#bf6a3b"],
      roofShade: ["#c8672d", "#8a4b2d"],
      glass: ["#2a7b82", "#24546a"],
      treeA: ["#eaa83c", "#a9772f"],
      treeAS: ["#c88a2b", "#7d5725"],
      treeB: ["#f1cd52", "#ad9440"],
      treeBS: ["#d2ab3b", "#82702f"],
      treeC: ["#8f9b40", "#4d6137"],
      treeCS: ["#717c31", "#3a4b2b"],
      trunk: ["#6b5233", "#3e3124"],
      ink: ["#123c3c", "#f4ecd9"],
      inkSoft: ["#2f5f5a", "#c3d3d0"],
      thread: ["#22413e", "#d9d2bf"],
      cloud: ["#f7f2e6", "#40708d"],
      cloudShade: ["#e3e5d5", "#33617e"],
      gull: ["#ffffff", "#ede7d8"],
      sun: ["#f6efd8", "#f3e8c9"]
    };
    const PAL_RGB = {};
    for (const k in PAL) PAL_RGB[k] = [hexRgb(PAL[k][0]), hexRgb(PAL[k][1])];
    const LAMP = hexRgb("#ffd27a");
    const BLOSSOM = hexRgb("#f2988a");
    const BLOSSOM_S = hexRgb("#d8776b");
    const P = {}; // current mixed palette, rebuilt per frame
    const PR = {}; // current mixed palette as rgb arrays
    let lastDusk = -1;
    function buildPalette(d) {
      if (Math.abs(d - lastDusk) < 0.002) return;
      lastDusk = d;
      for (const k in PAL_RGB) {
        const a = PAL_RGB[k][0], b = PAL_RGB[k][1];
        PR[k] = [Math.round(lerp(a[0], b[0], d)), Math.round(lerp(a[1], b[1], d)), Math.round(lerp(a[2], b[2], d))];
        P[k] = "rgb(" + PR[k][0] + "," + PR[k][1] + "," + PR[k][2] + ")";
      }
    }
    buildPalette(0);

    // ------------------------------------------------------------- surfaces
    const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, layer: "content", input: "auto", touchAction: "none" });
    const g = canvas.getContext("2d");
    if (!g) {
      ctx.platform.error({ where: "canvas2d", message: "2D context unavailable" });
      return;
    }

    // Design space: 400 x 800, sea level at Y0. World units are design pixels.
    const DW = 400, DH = 800, Y0 = 470;
    let W = ctx.width || 400, H = ctx.height || 800, S = 1;
    let area = { top: 0, right: 0, bottom: 120, left: 0 };
    let logo = { x: 0, y: 0, width: 64, height: 48, cx: 0, cy: 0, real: false };
    let hostLayout = null;

    function layout() {
      W = Math.max(1, ctx.width || W);
      H = Math.max(1, ctx.height || H);
      area = ctx.contentSafeArea ?? ctx.safeArea ?? area;
      S = Math.min(W / 365, H / 780);
      const la = ctx.logoArea;
      if (la && la.width > 0) {
        logo = { x: la.x, y: la.y, width: la.width, height: la.height, cx: la.x + la.width / 2, cy: la.y + la.height / 2, real: true };
      } else {
        const lw = 64, lh = 48;
        const cy = area.bottom > 70 ? H - area.bottom + 34 : H - 58;
        logo = { x: W / 2 - lw / 2, y: cy - lh / 2, width: lw, height: lh, cx: W / 2, cy, real: false };
      }
    }
    ctx.onResize(layout, { immediate: true });
    layout();

    // Film grain lives on its own static overlay surface, painted only on resize,
    // so it costs nothing per frame.
    const grainCanvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, layer: "overlay", input: "passthrough" });
    const gg = grainCanvas.getContext("2d");
    // Grain is written straight into the overlay's pixels (no extra canvases),
    // in tiles of a fixed seeded noise block.
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
          const r = mulberry(7);
          const d = grainTile.data;
          for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) {
            const v = r();
            const dark = v < 0.5;
            const c = dark ? 20 : 255;
            const a = Math.floor((dark ? v * 2 : (v - 0.5) * 2) * 70 * 0.24);
            for (let by = 0; by < block; by++) for (let bx = 0; bx < block; bx++) {
              const i = ((y * block + by) * T + (x * block + bx)) * 4;
              d[i] = d[i + 1] = d[i + 2] = c;
              d[i + 3] = a;
            }
          }
        }
        for (let y = 0; y < bh; y += T) for (let x = 0; x < bw; x += T) gg.putImageData(grainTile, x, y);
      } catch (e) { /* grain is decoration only */ }
    }

    // ------------------------------------------------------------ persistence
    const store = { islands: 0, welcomed: false, learned: { capture: false, like: false, nav: false } };
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    if (canStore) {
      try {
        const s = ctx.storage.get("als:v1");
        if (s && typeof s === "object") {
          store.islands = Number.isFinite(s.islands) ? Math.max(0, Math.floor(s.islands)) : 0;
          store.welcomed = !!s.welcomed;
          if (s.learned && typeof s.learned === "object") {
            store.learned.capture = !!s.learned.capture;
            store.learned.like = !!s.learned.like;
            store.learned.nav = !!s.learned.nav;
          }
        }
      } catch (e) { /* storage is a convenience only */ }
    }
    function save() {
      if (!canStore) return;
      try { ctx.storage.set("als:v1", store); } catch (e) { /* ignore */ }
    }
    const firstVisit = !store.welcomed;

    // ------------------------------------------------------------------ fonts
    const F_DISPLAY = '"ALS Bebas", "Bebas Neue", "Arial Narrow", "Helvetica Neue", sans-serif';
    const F_TEXT = '"ALS Inter", Inter, "Helvetica Neue", Arial, sans-serif';
    const F_MONO = '"ALS Mono", "Space Mono", ui-monospace, Menlo, monospace';
    // The runtime registers approved faces; until they arrive the fallbacks draw.
    function addFace(p) { return p.catch(() => {}); }
    addFace(ctx.loadFont("ALS Bebas", "bebas-neue", "1.0.0", { weight: "400" }));
    addFace(ctx.loadFont("ALS Inter", "inter", "1.0.0", { weight: "400" }));
    addFace(ctx.loadFont("ALS Inter", "inter", "1.0.0", { weight: "600" }));
    addFace(ctx.loadFont("ALS Mono", "space-mono", "1.0.0", { weight: "400" }));

    // ------------------------------------------------------------------ audio
    // Music bed through ctx.music; world sounds are synthesised so they belong
    // to this place (wood, water, thread, wind) rather than stock game stings.
    const A = { ac: null, out: null, noise: null, sea: null, seaFilter: null, ready: false, muted: false, music: null };
    function haptic(kind) {
      if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ } }
    }
    function audioUnlock() {
      if (A.ac) {
        if (A.ac.state === "suspended") A.ac.resume().catch(() => {});
      } else if (ctx.capabilities && ctx.capabilities.audio) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            A.ac = new AC();
            A.out = A.ac.createGain();
            A.out.gain.value = A.muted ? 0 : 0.85;
            const comp = A.ac.createDynamicsCompressor();
            comp.threshold.value = -18;
            A.out.connect(comp);
            comp.connect(A.ac.destination);
            const len = Math.floor(A.ac.sampleRate * 2);
            const buf = A.ac.createBuffer(1, len, A.ac.sampleRate);
            const d = buf.getChannelData(0);
            const r = mulberry(11);
            for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
            A.noise = buf;
            startSea();
            A.ready = true;
            if (A.ac.state === "suspended") A.ac.resume().catch(() => {});
          }
        } catch (e) {
          A.ac = null;
          ctx.platform.error({ where: "audio", message: String((e && e.message) || e) });
        }
      }
      if (!A.music && ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music) {
        try {
          const u = ctx.music.unlock();
          if (u && u.catch) u.catch(() => {});
          A.music = ctx.music.play({ preset: "ambient", volume: A.muted ? 0 : 0.26, intensity: 0.16, tempo: 66, scale: "pentatonic", fadeInMs: 3000 });
        } catch (e) { A.music = null; }
      }
    }
    function musicSet(fn) {
      if (!A.music) return;
      try { fn(ctx.music); } catch (e) { /* music is optional */ }
    }
    function startSea() {
      const ac = A.ac;
      const src = ac.createBufferSource();
      src.buffer = A.noise;
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 420;
      const gn = ac.createGain();
      gn.gain.value = 0.045;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.12;
      const lfoG = ac.createGain();
      lfoG.gain.value = 0.03;
      lfo.connect(lfoG);
      lfoG.connect(gn.gain);
      src.connect(f);
      f.connect(gn);
      gn.connect(A.out);
      src.start();
      lfo.start();
      A.sea = gn;
      A.seaFilter = f;
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
      osc.connect(gn);
      gn.connect(A.out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    function noiseHit(o) {
      if (!A.ready) return;
      const ac = A.ac, t0 = ac.currentTime + (o.at || 0), dur = o.dur || 0.1;
      const src = ac.createBufferSource();
      src.buffer = A.noise;
      const f = ac.createBiquadFilter();
      f.type = o.type || "bandpass";
      f.frequency.setValueAtTime(o.freq || 1200, t0);
      if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
      f.Q.value = o.q || 1;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(o.gain || 0.1, t0 + (o.attack || 0.004));
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(gn);
      gn.connect(A.out);
      src.start(t0, Math.random() * 1.5);
      src.stop(t0 + dur + 0.05);
    }
    const PENT = [0, 2, 4, 7, 9];
    function scaleNote(i) {
      i = Math.max(0, Math.floor(i));
      return 196 * Math.pow(2, (12 * Math.floor(i / 5) + PENT[i % 5]) / 12);
    }
    const SFX = {
      snap() {
        tone(2300, { dur: 0.05, gain: 0.05, glideTo: 1500 });
        noiseHit({ dur: 0.03, gain: 0.07, type: "highpass", freq: 3200 });
      },
      land(x, level, kind) {
        const idx = 3 + clamp(Math.floor(((x - 90) / 220) * 6), 0, 6) + level * 2;
        const n = scaleNote(idx);
        tone(n, { type: "triangle", dur: 1.1, gain: 0.14 });
        tone(n * 2, { dur: 0.6, gain: 0.035 });
        noiseHit({ dur: 0.07, gain: 0.11, freq: kind === "house" ? 950 : kind === "lighthouse" ? 700 : 480, q: 2.5 });
        tone(150, { dur: 0.14, gain: 0.1, glideTo: 80 });
      },
      grow() {
        tone(scaleNote(8), { type: "triangle", dur: 1.4, gain: 0.08, attack: 0.05 });
        noiseHit({ dur: 0.45, gain: 0.09, type: "lowpass", freq: 300, freqTo: 120, attack: 0.05 });
      },
      splash() {
        noiseHit({ dur: 0.7, gain: 0.14, type: "lowpass", freq: 2600, freqTo: 260 });
        tone(scaleNote(2), { type: "sine", dur: 0.9, gain: 0.05, attack: 0.04 });
      },
      rise() {
        tone(46, { dur: 3.0, gain: 0.22, attack: 0.7 });
        noiseHit({ dur: 2.8, gain: 0.12, type: "lowpass", freq: 180, attack: 0.6 });
        [523.25, 659.25, 783.99, 987.77].forEach((f, i) => tone(f, { at: 1.6 + i * 0.12, dur: 2.6, gain: 0.04, attack: 0.5 }));
      },
      lamp() {
        [392, 493.88, 587.33, 739.99].forEach((f, i) => tone(f, { type: "triangle", at: i * 0.05, dur: 3.4, gain: 0.05, attack: 0.35 }));
        tone(1567.98, { at: 0.2, dur: 1.6, gain: 0.03 });
      },
      shutter() {
        noiseHit({ dur: 0.03, gain: 0.22, type: "highpass", freq: 2600 });
        noiseHit({ at: 0.075, dur: 0.04, gain: 0.16, type: "highpass", freq: 2000 });
        tone(1318.51, { at: 0.12, dur: 1.4, gain: 0.05 });
        tone(1975.53, { at: 0.12, dur: 1.0, gain: 0.025 });
      },
      like() {
        [659.25, 783.99, 987.77, 1318.51, 1567.98].forEach((f, i) => tone(f, { at: i * 0.075, dur: 1.0, gain: 0.06, attack: 0.01 }));
        tone(329.63, { type: "triangle", dur: 1.8, gain: 0.06, attack: 0.08 });
      },
      nav() { tone(880, { dur: 0.6, gain: 0.05, glideTo: 440 }); },
      echo() { tone(1046.5, { dur: 0.18, gain: 0.025 }); }
    };
    function setMuted(m) {
      A.muted = m;
      if (A.out) A.out.gain.setTargetAtTime(m ? 0 : 0.85, A.ac.currentTime, 0.05);
      musicSet((mu) => mu.setVolume(m ? 0 : 0.26, { fadeMs: 200 }));
    }
    ctx.onDestroy(() => {
      try { if (A.ac) A.ac.close(); } catch (e) { /* ignore */ }
    });

    // ------------------------------------------------------------ world model
    const N = 161, DX = DW / (N - 1);
    const land = new Float32Array(N);
    const jag = new Float32Array(N);
    let edgeL = 120, edgeR = 280, peakX = 200;

    function hAt(x) {
      const f = x / DX, i = Math.floor(f);
      if (i < 0 || i >= N - 1) return 0;
      const t = f - i;
      return land[i] * (1 - t) + land[i + 1] * t;
    }
    const isLand = (x) => hAt(x) > 2.5;
    function measureEdges() {
      let l = -1, r = -1, best = -1;
      for (let i = 0; i < N; i++) {
        if (land[i] > 2.5) {
          if (l < 0) l = i;
          r = i;
          if (land[i] > best) { best = land[i]; peakX = i * DX; }
        }
      }
      edgeL = l < 0 ? 200 : l * DX;
      edgeR = r < 0 ? 200 : r * DX;
    }

    const isle = { lift: 0, bob: 0 };
    const baseY = () => Y0 - isle.lift + isle.bob;
    function depthAt(x) {
      if (!isLand(x)) return 0;
      const mid = (edgeL + edgeR) / 2, half = Math.max(10, (edgeR - edgeL) / 2);
      const u = clamp((x - mid) / half, -1, 1);
      const dmax = clamp(half * 1.05, 60, 135);
      const i = clamp(Math.round(x / DX), 0, N - 1);
      return Math.pow(1 - u * u, 0.8) * dmax * jag[i];
    }

    const HOUSE = { w: 34, wall: 22, roof: 14, d: 7 };
    const DEF = {
      house: { w: 34, h: 36 },
      tree: { w: 18, h: 42 },
      hill: { w: 78, h: 32 },
      lighthouse: { w: 22, h: 76 }
    };

    let objects = [];  // things standing on the island
    let islets = [];   // things the sea kept
    let tufts = [];    // grass and flowers that sprout on the island
    let parts = [];    // short-lived particles
    let rings = [];    // water rings
    let hillGrow = []; // terrain bumps that are still growing
    let nextId = 1;
    let seed = 1;
    let rng = mulberry(1);
    let islandNo = store.islands + 1;

    function buildIsland(sd) {
      seed = sd;
      rng = mulberry(sd);
      const cx = 200 + (rng() - 0.5) * 16;
      const hw = 80 + rng() * 10;
      const peak = (rng() - 0.5) * 50;
      const ph1 = rng() * TAU, ph2 = rng() * TAU;
      for (let i = 0; i < N; i++) {
        const x = i * DX;
        const u = (x - cx) / hw;
        let h = 0;
        if (Math.abs(u) < 1) {
          h = 16 * Math.pow(1 - u * u, 0.5);
          const pu = (x - (cx + peak)) / (hw * 0.55);
          h += 18 * Math.max(0, 1 - pu * pu);
          h += 2.2 * Math.sin(x * 0.09 + ph1) + 1.6 * Math.sin(x * 0.21 + ph2);
          h *= Math.min(1, (1 - Math.abs(u)) * 7);
        }
        land[i] = Math.max(0, h);
      }
      let prev = 1;
      for (let i = 0; i < N; i++) {
        prev = lerp(prev, 0.82 + rng() * 0.36, 0.45);
        jag[i] = prev;
      }
      measureEdges();
      objects = [];
      islets = [
        { x: 58 + rng() * 20, kind: "rock", w: 18, h: 9, t: rng() * 10, born: -9 },
        { x: 330 + rng() * 24, kind: "rock", w: 26, h: 11, t: rng() * 10, born: -9 }
      ];
      tufts = [];
      for (let i = 0; i < 7; i++) {
        const x = lerp(edgeL + 12, edgeR - 12, rng());
        tufts.push({ x, s: 0.7 + rng() * 0.5, born: -9, kind: rng() < 0.3 ? "flower" : "grass" });
      }
      parts = [];
      rings = [];
      hillGrow = [];
      isle.lift = 0;
      isle.bob = 0;
    }

    // Clouds, far islands, gulls and stars: the world before anyone touches it.
    const clouds = [];
    (function () {
      const r = mulberry(5);
      for (let i = 0; i < 4; i++) clouds.push({ x: r() * 520 - 60, y: 120 + r() * 170, s: 0.7 + r() * 0.6, v: 3 + r() * 4, layer: "back" });
      for (let i = 0; i < 4; i++) clouds.push({ x: r() * 520 - 60, y: Y0 - 34 - r() * 50, s: 0.9 + r() * 0.8, v: 4 + r() * 5, layer: "low" });
      for (let i = 0; i < 3; i++) clouds.push({ x: r() * 520 - 60, y: 200 + r() * 90, s: 1.0 + r() * 0.6, v: 8 + r() * 6, layer: "front" });
    })();
    const farIsles = [
      { x: 44, y: 300, s: 0.62, ph: 0.3, houses: 2 },
      { x: 352, y: 238, s: 0.5, ph: 1.7, houses: 1 },
      { x: 262, y: 356, s: 0.34, ph: 2.9, houses: 1 }
    ];
    const gulls = [];
    (function () {
      const r = mulberry(9);
      for (let i = 0; i < 5; i++) gulls.push({ x: r() * 420 - 10, y: 150 + r() * 220, vx: (r() < 0.5 ? -1 : 1) * (14 + r() * 12), vy: 0, ph: r() * TAU, mode: "drift", t: 0, cx: 0, cy: 0, rad: 0, ang: 0 });
    })();
    const stars = [];
    (function () {
      const r = mulberry(13);
      for (let i = 0; i < 54; i++) stars.push({ x: r(), y: r() * 0.62, s: r() < 0.15 ? 1.7 : 1.05, ph: r() * TAU });
    })();

    // --------------------------------------------------------------- camera
    const cam = { x: 200, y: 400, zoom: 1, shake: 0 };
    const sx = (x) => W / 2 + (x - cam.x) * cam.zoom * S;
    const sy = (y) => H / 2 + (y - cam.y) * cam.zoom * S;
    const viewTop = () => cam.y - H / 2 / (cam.zoom * S);
    const viewH = () => H / (cam.zoom * S);

    // ---------------------------------------------------------------- state
    let now = 0;             // world clock, seconds (freezes during the capture beat)
    let realNow = 0;         // real clock, seconds
    let timeScale = 1;
    let phase = "intro";     // intro | play | rise | finale | outro | swap
    let phaseT = 0;
    let started = false;
    let attempt = 0;
    let queue = [];
    let qi = 0;
    let riseAfter = 4;
    let risen = false;
    let riseK = 0;           // 0 on the sea, 1 afloat
    let dusk = 0;
    let lampK = 0;
    let finaleStart = -1;
    let cur = null;          // current piece
    let threadCut = null;    // the retracting thread after a cut
    let wait = 0;            // pause before the next piece
    let lastInput = 0;       // realNow of last tap
    let pred = null;         // predicted landing
    let welcomeK = 1;        // welcome copy visibility
    let welcomeOut = -1;
    let hint = null;         // { text, t0, dur }
    let shownHints = {};
    let missCount = 0;
    let placed = 0;
    let echo = [];           // tap echoes (feedback when a tap does nothing)
    let jiggle = 0;          // demonstration impulse on the hanging piece
    let demoT = -1;          // time of last ghost-tap demonstration
    let swap = null;         // replay transition
    let plateK = 0;          // plate (finale framing) visibility
    let frameSnap = 0;       // capture: frame tightens
    let flash = 0;
    let stampK = 0;
    let likeAt = -1;
    let captureAt = -1;
    let navAt = -1;
    let likeGlow = 0;
    const outro = { step: "capture", t: 0, gap: 0, cycle0: 0, msg: null, msgT: 0 };
    const done = { capture: false, like: false, nav: false };
    let chromeMode = null;
    let chromeAlive = false;

    function newQueue(first) {
      if (first) return ["house", "tree", "house", "hill", "house", "tree", "lighthouse"];
      const pool = ["house", "house", "tree", "tree", "hill", "house"];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      if (pool.indexOf("hill") > 3) { // keep the hill before the island rises
        pool.splice(pool.indexOf("hill"), 1);
        pool.splice(1 + Math.floor(rng() * 3), 0, "hill");
      }
      pool.push("lighthouse");
      return pool;
    }

    // ------------------------------------------------------------- pieces
    const TREE_VARIANTS = ["cypress", "round", "cone"];
    function spawnPiece() {
      const type = queue[qi];
      const def = DEF[type];
      const i = qi;
      const pivotX = 200 + (i === 0 ? 0 : (rng() - 0.5) * 36);
      // Clearance: the piece swings well above the tallest thing on the island.
      let tallest = baseY() - 40;
      for (let k = 0; k < N; k++) if (land[k] > 2.5) tallest = Math.min(tallest, baseY() - land[k]);
      for (const o of objects) tallest = Math.min(tallest, baseY() + o.yRel - DEF[o.type].h);
      const vt = viewTop();
      const baseLow = clamp(Math.min(tallest - 118, vt + viewH() * 0.4), vt + 200, vt + viewH() * 0.48);
      const pivotY = vt - 40;
      const L = Math.max(90, baseLow - def.h - pivotY);
      cur = {
        type, def, i,
        variant: type === "tree" ? TREE_VARIANTS[Math.floor(rng() * 3)] : type === "house" ? Math.floor(rng() * 3) : 0,
        state: "lower",
        t: 0,
        L0: i === 0 && phase === "intro" ? L : 26,
        L,
        A: [0.3, 0.34, 0.38, 0.4, 0.42, 0.45, 0.36][Math.min(i, 6)],
        w: TAU / [2.9, 2.6, 2.4, 2.2, 2.05, 1.9, 2.3][Math.min(i, 6)],
        pivotX,
        x: 0, y: 0, vx: 0, vy: 0, rot: 0
      };
      if (i === 0 && phase === "intro") cur.state = "swing";
      if (type === "lighthouse") showHint("THE LAST PIECE", 2.2);
      else if (type === "hill") showHint("LAND MAKES MORE ISLAND", 2.4);
      else if (type === "house" && objects.some((o) => o.type === "house")) showHint("HOUSES STACK", 2.2);
    }
    function pivotY() { return viewTop() - 40; }
    function swingState(p) {
      const lowerT = sat(p.t / 0.85);
      const L = p.state === "lower" ? lerp(p.L0, p.L, E.out(lowerT)) : p.L;
      const dL = p.state === "lower" && lowerT < 1 ? ((p.L - p.L0) * 3 * Math.pow(1 - lowerT, 2)) / 0.85 : 0;
      const amp = p.A * (p.state === "lower" ? E.inOut(lowerT) : 1);
      const windA = risen ? 0.07 : 0;
      const th = amp * Math.sin(p.w * p.t) + windA * Math.sin(0.83 * now + 1.3) + jiggle * Math.sin(realNow * 38) * 0.06;
      const thd = amp * p.w * Math.cos(p.w * p.t) + windA * 0.83 * Math.cos(0.83 * now + 1.3);
      const px = p.pivotX, py = pivotY();
      const ax = px + L * Math.sin(th), ay = py + L * Math.cos(th);
      const rot = -th * 0.92;
      const h = p.def.h;
      return {
        px, py, ax, ay, rot, L,
        bx: ax - Math.sin(rot) * h, by: ay + Math.cos(rot) * h,
        vx: L * thd * Math.cos(th) + dL * Math.sin(th),
        vy: -L * thd * Math.sin(th) + dL * Math.cos(th)
      };
    }

    // Support under a falling piece. Only surfaces at or below fromY count, so a
    // piece beside a tall stack slides past it instead of teleporting onto it.
    function supportAt(x, type, fromY) {
      const hw = DEF[type].w / 2;
      const b = baseY();
      let best = null;
      if (isLand(x)) {
        let y = Infinity;
        for (const o of [-0.4, 0, 0.4]) {
          const xs = x + o * hw;
          if (isLand(xs)) y = Math.min(y, b - hAt(xs));
        }
        if (y >= fromY - 6) best = { y, kind: "land", obj: null };
      }
      for (const o of objects) {
        if (o.type !== "house") continue;
        const dx = x - o.x;
        if (Math.abs(dx) > o.w / 2 + hw * 0.35) continue;
        const ob = b + o.yRel;
        let y;
        if (type === "house") y = ob - HOUSE.wall;
        else if (o.roof) y = ob - HOUSE.wall - HOUSE.roof * sat(1 - Math.abs(dx) / (o.w / 2 + 3));
        else y = ob - HOUSE.wall;
        if (y < fromY - 6) continue;
        if (!best || y < best.y) best = { y, kind: "house", obj: o };
      }
      if (best) return best;
      return { y: Y0 + 2, kind: "water", obj: null };
    }
    const G = 1500;
    function fallStep(p, dt) {
      const prevY = p.y;
      p.vy += G * dt;
      p.vx *= 1 - 0.12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += (0 - p.rot) * (1 - Math.exp(-5 * dt));
      const s = supportAt(p.x, p.type, prevY);
      if (p.y >= s.y) return s;
      return null;
    }
    function predict() {
      if (!cur || (cur.state !== "swing" && cur.state !== "lower")) return null;
      const st = swingState(cur);
      const p = { type: cur.type, x: st.bx, y: st.by, vx: st.vx, vy: st.vy, rot: st.rot };
      for (let i = 0; i < 360; i++) {
        const s = fallStep(p, 1 / 120);
        if (s) return { x: s.kind === "house" && cur.type === "house" ? s.obj.x : p.x, y: s.y, kind: s.kind };
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

    function puff(x, y, n, col, spread) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1 || 1)) * Math.PI;
        parts.push({ k: "dust", x, y, vx: Math.cos(a) * spread * (0.6 + Math.random() * 0.6), vy: Math.sin(a) * spread * 0.35 - 6, life: 0, max: 0.5 + Math.random() * 0.25, r: 2.2 + Math.random() * 2.4, col });
      }
    }
    function sprout(x, s) {
      tufts.push({ x, s, born: now, kind: Math.random() < 0.35 ? "flower" : "grass" });
      if (tufts.length > 60) tufts.shift();
    }

    function land_(p, s) {
      const type = p.type;
      placed++;
      if (s.kind === "water") {
        missCount++;
        islets.push({ x: p.x, kind: type, variant: p.variant, w: type === "hill" ? 44 : DEF[type].w + 10, h: type === "hill" ? 14 : 7, t: Math.random() * 10, born: now });
        rings.push({ x: p.x, y: Y0, r: 4, life: 0, max: 1.4, w: 2 });
        rings.push({ x: p.x, y: Y0, r: 2, life: -0.18, max: 1.4, w: 1.2 });
        for (let i = 0; i < 9; i++) parts.push({ k: "drop", x: p.x + (Math.random() - 0.5) * 14, y: Y0, vx: (Math.random() - 0.5) * 120, vy: -120 - Math.random() * 160, life: 0, max: 0.8, r: 1.6 + Math.random() * 1.6 });
        SFX.splash();
        haptic("light");
        if (!shownHints.sea) { shownHints.sea = 1; showHint("THE SEA KEEPS WHAT YOU MISS", 2.6); }
        return;
      }
      haptic("medium");
      if (type === "hill") {
        hillGrow.push({ x: p.x, t: 0, prev: 0, amp: 24, sig: 27 });
        puff(p.x, s.y, 9, PR.sand, 70);
        SFX.grow();
        for (let i = 0; i < 4; i++) sprout(p.x + (Math.random() - 0.5) * 50, 0.8 + Math.random() * 0.5);
        return;
      }
      const x = s.kind === "house" && type === "house" ? s.obj.x : p.x;
      let level = 0;
      if (s.kind === "house" && type === "house") { s.obj.roof = false; level = s.obj.level + 1; }
      const o = {
        id: nextId++, type, x, yRel: s.y - baseY(), w: DEF[type].w, level, roof: true,
        variant: p.variant, born: now, litDelay: 0, bloomAt: -1
      };
      objects.push(o);
      puff(x, s.y, 7, s.kind === "land" ? PR.sand : PR.wall, 50);
      if (s.kind === "land" && type !== "lighthouse") { sprout(x - o.w / 2 - 5 - Math.random() * 8, 0.8); sprout(x + o.w / 2 + 4 + Math.random() * 8, 0.9); }
      SFX.land(x, level, type);
      if (level >= 2 && !shownHints.tower) { shownHints.tower = 1; showHint("A TOWER!", 1.6); }
    }

    function showHint(text, dur) { hint = { text, t0: realNow, dur: dur || 2.2 }; }

    // ---------------------------------------------------------- run control
    function beginRun(first) {
      attempt++;
      buildIsland(first ? 20261120 : Math.floor(Math.random() * 1e9));
      queue = newQueue(first);
      qi = 0;
      placed = 0;
      missCount = 0;
      risen = false;
      riseK = 0;
      dusk = 0;
      lampK = 0;
      finaleStart = -1;
      plateK = 0;
      frameSnap = 0;
      stampK = 0;
      likeAt = captureAt = navAt = -1;
      cam.y = 400; cam.zoom = 1;
      finaleCam = null;
      likeGlow = 0;
      cur = null;
      threadCut = null;
      wait = 0;
      shownHints = {};
      hint = null;
      islandNo = store.islands + 1;
      for (const gl of gulls) { gl.mode = "drift"; gl.vy = 0; }
      musicSet((m) => { m.setIntensity(0.16, { fadeMs: 1500 }); m.setScale("pentatonic"); });
      if (A.sea) { A.sea.gain.setTargetAtTime(0.045, A.ac.currentTime, 0.5); A.seaFilter.frequency.setTargetAtTime(420, A.ac.currentTime, 0.5); }
    }

    function afterLanding() {
      qi++;
      ctx.platform.setProgress(qi / queue.length);
      if (!risen && qi === riseAfter) { setPhase("rise"); return; }
      if (qi >= queue.length) { setPhase("finale"); return; }
      wait = 0.35;
    }

    function setPhase(p) {
      phase = p;
      phaseT = 0;
      if (p === "rise") {
        SFX.rise();
        haptic("heavy");
        ctx.platform.milestone("island_rose");
        musicSet((m) => m.setIntensity(0.32, { fadeMs: 2500 }));
        for (let i = 0; i < 4; i++) rings.push({ x: lerp(edgeL, edgeR, 0.5) + (i - 1.5) * 18, y: Y0, r: (edgeR - edgeL) * 0.5, life: -i * 0.2, max: 1.8, w: 1.4, grow: 90 });
      }
      if (p === "finale") {
        finaleStart = now;
        let k = 0;
        const order = objects.slice().sort((a, b) => a.x - b.x);
        for (const o of order) o.litDelay = 1.1 + (k++) * 0.13;
        ctx.platform.milestone("island_complete");
        store.islands = islandNo;
        store.welcomed = true;
        save();
        musicSet((m) => { m.setScale("lydian"); m.setIntensity(0.45, { fadeMs: 3000 }); });
        try { ctx.platform.complete({ pieces: queue.length, atSea: missCount, island: islandNo }); } catch (e) { /* ignore */ }
      }
      if (p === "outro") {
        outro.step = nextOutroStep();
        outro.t = 0;
        outro.cycle0 = realNow;
      }
    }
    // Teach each host gesture until the viewer has used it once (ever), and
    // never repeat a cue they let pass in this session.
    const passed = { capture: false, like: false, nav: false };
    function nextOutroStep() {
      for (const k of ["capture", "like", "nav"]) if (!done[k] && !store.learned[k] && !passed[k]) return k;
      return "free";
    }

    function replay() {
      if (swap) return;
      swap = { t: 0, did: false };
      ctx.platform.start();
      ctx.platform.interact({ type: "replay" });
    }

    // --------------------------------------------------------- host chrome
    // First-party Bits receive ctx.chrome. Plethora's logo button is the real
    // action control: swipe left captures, swipe right likes, tap opens
    // navigation. The Bit never fakes these; it teaches them and reacts when
    // the host reports them. Action names are matched loosely on purpose.
    const ACTION_MATCH = [
      ["capture", /capture|screenshot|camera|snap|comment/i],
      ["like", /like|heart|love|fav/i],
      ["nav", /nav|menu|browse|explore|logo|open|home/i]
    ];
    function classify(name) {
      const s = String(name || "");
      for (const [k, re] of ACTION_MATCH) if (re.test(s)) return k;
      return null;
    }
    function onHostAction(e) {
      const kind = classify(e && (e.action || e.name || e.type));
      ctx.platform.emit("host_action_seen", { action: String((e && e.action) || ""), kind: kind || "other" });
      if (kind) onLearned(kind);
    }
    function onHostMode(e) {
      const m = e && (e.mode !== undefined ? e.mode : e);
      const prev = chromeMode;
      chromeMode = m || null;
      if (prev === "play" && chromeMode === "browse") onLearned("nav");
      if (prev === "browse" && chromeMode === "play" && phase === "outro" && done.nav && outro.step !== "free") {
        outro.step = nextOutroStep();
        outro.t = 0;
        outro.cycle0 = realNow;
      }
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
      if (kind === "capture") {
        captureAt = realNow;
        if (phase === "finale" || phase === "outro") {
          timeScale = 0;
          flash = 1;
          frameSnap = 1;
          stampK = 0.001;
        } else flash = 0.6;
        SFX.shutter();
        haptic("success");
      } else if (kind === "like") {
        likeAt = realNow;
        bloomWave();
        SFX.like();
        haptic("success");
      } else if (kind === "nav") {
        navAt = realNow;
        SFX.nav();
        for (const gl of gulls) { gl.mode = "away"; gl.t = 0; }
      }
      const wasDone = done[kind];
      done[kind] = true;
      if (!store.learned[kind]) { store.learned[kind] = true; save(); }
      if (!wasDone) ctx.platform.milestone("learned_" + kind);
      if (phase === "outro" && outro.step === kind) {
        outro.msg = kind === "capture" ? "IT'S YOURS NOW." : kind === "like" ? "IT LIKES YOU BACK." : null;
        outro.msgT = realNow;
        outro.gap = kind === "nav" ? 0 : 1.9;
      }
    }

    function bloomWave() {
      const span = Math.max(1, edgeR - edgeL);
      for (const o of objects) if (o.type === "tree" && o.bloomAt < 0) o.bloomAt = now + ((o.x - edgeL) / span) * 0.7;
      for (const t of tufts) if (t.kind === "flower") t.bloom = now + ((t.x - edgeL) / span) * 0.7;
      // Gulls lift off the island and circle it.
      gulls.forEach((gl, i) => {
        gl.mode = "circle";
        gl.t = 0;
        gl.cx = (edgeL + edgeR) / 2;
        gl.cy = baseY() - 120;
        gl.rad = 70 + i * 16;
        gl.ang = (i / gulls.length) * TAU;
        gl.x = lerp(edgeL, edgeR, (i + 0.5) / gulls.length);
        gl.y = baseY() - 30;
      });
      likeGlow = 1;
      for (let i = 0; i < 44; i++) {
        const x = lerp(edgeL, edgeR, Math.random());
        parts.push({ k: "petal", x, y: baseY() - hAt(x) - 20 - Math.random() * 20, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 40, life: -Math.random() * 0.7, max: 2.2, r: 2 + Math.random() * 2, rot: Math.random() * TAU });
      }
    }

    // ---------------------------------------------------------------- input
    function muteRect() {
      return { x: W - area.right - 40, y: area.top + 6, w: 34, h: 34 };
    }
    function onDown(ev) {
      if (ev.cancelable) ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      audioUnlock();
      const m = muteRect();
      if (started && px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) {
        setMuted(!A.muted);
        return;
      }
      lastInput = realNow;
      if (!started) {
        started = true;
        ctx.platform.start();
      }
      if (swap) return;
      if ((phase === "intro" || phase === "play") && cur && (cur.state === "swing" || (cur.state === "lower" && cur.t > 0.3))) {
        release();
        if (phase === "intro") {
          phase = "play";
          welcomeOut = realNow;
          store.welcomed = true;
          save();
        }
        return;
      }
      if (phase === "outro" && ((outro.step === "nav" && outro.t > 2.2) || outro.step === "free")) {
        replay();
        return;
      }
      // A tap with nothing to do still gets an answer, never a dead screen.
      echo.push({ x: px, y: py, t: realNow });
      SFX.echo();
      scatterGulls(px, py);
      if (phase === "outro") outro.cycle0 = realNow - 0.0; // replay the gesture demo right away
    }
    ctx.listen(canvas, "pointerdown", onDown, { passive: false });

    function scatterGulls(px, py) {
      for (const gl of gulls) {
        if (gl.mode !== "drift") continue;
        const gx = sx(gl.x), gy = sy(gl.y);
        const d = Math.hypot(gx - px, gy - py);
        if (d < 140) {
          gl.vx = Math.sign(gx - px || 1) * 60;
          gl.vy = -40;
          gl.t = 0;
          gl.mode = "scatter";
        }
      }
    }

    // --------------------------------------------------------------- update
    function update(dtMs) {
      const rdt = Math.min(0.05, dtMs / 1000);
      realNow += rdt;
      if (timeScale < 1) timeScale = Math.min(1, timeScale + rdt * (realNow - captureAt > 0.75 ? 3 : 0));
      const dt = rdt * timeScale;
      now += dt;
      phaseT += dt;

      if (swap) updateSwap(rdt);

      // Welcome copy dissolves after the first release.
      if (welcomeOut >= 0) welcomeK = 1 - sat((realNow - welcomeOut) / 0.7);

      // Piece lifecycle.
      if (cur) {
        if (cur.state === "lower" || cur.state === "swing") {
          cur.t += dt;
          if (cur.state === "lower" && cur.t > 0.85) cur.state = "swing";
          jiggle *= Math.exp(-4 * rdt);
        } else if (cur.state === "fall") {
          let acc = dt, s = null;
          while (acc > 0 && !s) {
            const h = Math.min(acc, 1 / 120);
            s = fallStep(cur, h);
            acc -= h;
          }
          if (s) { land_(cur, s); cur = null; afterLanding(); }
          else if (cur.y > Y0 + 400) { cur = null; afterLanding(); }
        }
      } else if ((phase === "play" || phase === "intro") && qi < queue.length) {
        wait -= dt;
        if (wait <= 0) spawnPiece();
      }
      pred = predict();

      if (threadCut) { threadCut.t += dt; if (threadCut.t > 0.9) threadCut = null; }

      // Growing hills lift whatever stands on them.
      for (let k = hillGrow.length - 1; k >= 0; k--) {
        const hg = hillGrow[k];
        hg.t += dt;
        const e = E.back(sat(hg.t / 0.5));
        const de = e - hg.prev;
        hg.prev = e;
        for (let i = 0; i < N; i++) {
          const x = i * DX;
          const gss = Math.exp(-((x - hg.x) * (x - hg.x)) / (2 * hg.sig * hg.sig));
          land[i] = Math.max(0, land[i] + hg.amp * de * gss);
        }
        for (const o of objects) o.yRel -= hg.amp * de * Math.exp(-((o.x - hg.x) * (o.x - hg.x)) / (2 * hg.sig * hg.sig));
        measureEdges();
        if (hg.t >= 0.5) hillGrow.splice(k, 1);
      }

      // Phase scripts.
      if (phase === "rise") {
        const lt = E.inOut(win(phaseT, 0.55, 2.9));
        isle.lift = 300 * lt;
        riseK = lt;
        cam.shake = phaseT < 0.7 ? 2.2 * (1 - phaseT / 0.7) : phaseT < 2.9 ? 0.6 : 0;
        if (phaseT > 0.5 && phaseT < 3.3 && Math.random() < 0.9) {
          const x = lerp(edgeL + 6, edgeR - 6, Math.random());
          parts.push({ k: "drip", x, y: baseY() + depthAt(x) * (0.3 + Math.random() * 0.7), vx: 0, vy: 40 + Math.random() * 60, life: 0, max: 1.2, r: 3 + Math.random() * 5 });
        }
        if (phaseT > 3.4) {
          risen = true;
          cam.shake = 0;
          if (A.seaFilter) { A.seaFilter.frequency.setTargetAtTime(900, A.ac.currentTime, 1); A.sea.gain.setTargetAtTime(0.03, A.ac.currentTime, 1); }
          setPhase("play");
          showHint("IT FLOATS.", 1.8);
          wait = 0.1;
        }
      }
      if (risen) isle.bob = Math.sin(now * 1.15) * 3.2;
      cam.y = 400 - 0.8 * isle.lift;

      if (phase === "finale" || phase === "outro") {
        const ft = now - finaleStart;
        lampK = ft < 0.25 ? 0 : ft < 0.32 ? 1 : ft < 0.42 ? 0.15 : ft < 0.5 ? 1 : ft < 0.58 ? 0.4 : sat(ft - 0.5) * 0.4 + 0.6;
        if (ft > 0.48 && ft - dt <= 0.48) { SFX.lamp(); haptic("success"); }
        dusk = E.inOut(win(ft, 0.4, 2.7));
        const ck = E.inOut(win(ft, 0.8, 2.9));
        if (finaleCam === null) finaleCam = solveFinaleCam();
        cam.y = lerp(400 - 0.8 * isle.lift, finaleCam.y, ck);
        cam.zoom = lerp(1, finaleCam.zoom, ck);
        plateK = E.out(win(ft, 2.0, 2.9));
        if (phase === "finale" && ft > 3.3) setPhase("outro");
      }
      if (phase === "outro") updateOutro(rdt);
      if (stampK > 0) stampK = Math.min(1, stampK + rdt * 2.5);
      frameSnap *= Math.exp(-3.5 * rdt);
      likeGlow = Math.max(0, likeGlow - rdt * 0.55);
      flash = Math.max(0, flash - rdt * 2.6);

      // Ghost-tap demonstration while waiting for a release.
      if (cur && (cur.state === "swing" || cur.state === "lower") && (phase === "intro" || phase === "play")) {
        const idle = realNow - Math.max(lastInput, cur.spawnReal || 0);
        const firstDelay = phase === "intro" ? 1.6 : 4.5;
        if (idle > firstDelay && realNow - demoT > (phase === "intro" ? 3.4 : 4.2)) {
          demoT = realNow;
          ctx.timeout(() => { jiggle = 1; }, 300);
        }
      }
      if (cur && cur.spawnReal === undefined) cur.spawnReal = realNow;

      // Clouds drift; low clouds become the sky beneath the island once it floats.
      for (const c of clouds) {
        c.x += c.v * dt * (c.layer === "front" ? 1 : 0.6);
        if (c.x > 470) c.x = -80 - Math.random() * 40;
      }
      updateGulls(dt);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt;
        if (p.life < 0) continue;
        if (p.k === "dust") { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 3 * dt; p.vy += 20 * dt; }
        else if (p.k === "drop") { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > Y0 && p.vy > 0) p.life = p.max; }
        else if (p.k === "drip") { p.vy += 700 * dt; p.y += p.vy * dt; if (p.y > Y0) { p.life = p.max; if (Math.random() < 0.25) rings.push({ x: p.x, y: Y0, r: 2, life: 0, max: 0.8, w: 1 }); } }
        else if (p.k === "petal") { p.x += (p.vx + Math.sin(now * 2 + p.r * 3) * 14) * dt; p.y += p.vy * dt; p.vy += 10 * dt; p.rot += dt * 2; }
        if (p.life >= p.max) parts.splice(i, 1);
      }
      if (parts.length > 260) parts.splice(0, parts.length - 260);
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].life += dt; if (rings[i].life >= rings[i].max) rings.splice(i, 1); }
      for (let i = echo.length - 1; i >= 0; i--) if (realNow - echo[i].t > 0.6) echo.splice(i, 1);
      if (hint && realNow - hint.t0 > hint.dur + 0.5) hint = null;
    }

    // Frame the finished island under the plate title, with the sea in view below.
    const FINALE_ZOOM = 0.88;
    let finaleCam = null;
    function plateBottomPx() { return area.top + 40 + 30 + 88 + 10; }
    function solveFinaleCam() {
      let tallest = baseY();
      for (let k = 0; k < N; k++) if (land[k] > 2.5) tallest = Math.min(tallest, baseY() - land[k]);
      for (const o of objects) tallest = Math.min(tallest, baseY() + o.yRel - DEF[o.type].h);
      const need = plateBottomPx() + 22; // the tallest point stays below the title
      const seaMax = logo.y - 100;         // the sea stays above the cue labels
      // Zoom out on short screens so both fit.
      const zoom = clamp(Math.min(FINALE_ZOOM, (seaMax - need) / Math.max(1, Y0 - tallest) / S), 0.5, FINALE_ZOOM);
      const z = zoom * S;
      let c = 232;
      if (H / 2 + (Y0 - c) * z > seaMax) c = Y0 - (seaMax - H / 2) / z;
      if (H / 2 + (tallest - c) * z < need) c = tallest - (need - H / 2) / z;
      return { y: c, zoom };
    }

    function updateGulls(dt) {
      for (const gl of gulls) {
        gl.t += dt;
        gl.ph += dt * (gl.mode === "drift" ? 5 : 9);
        if (gl.mode === "drift") {
          gl.x += gl.vx * dt;
          gl.y += Math.sin(gl.ph * 0.2) * 4 * dt;
          if (gl.x > 440) gl.x = -40;
          if (gl.x < -40) gl.x = 440;
        } else if (gl.mode === "scatter") {
          gl.x += gl.vx * dt;
          gl.y += gl.vy * dt;
          gl.vy += 30 * dt;
          if (gl.t > 1.4) { gl.mode = "drift"; gl.vx = Math.sign(gl.vx) * 18; gl.vy = 0; }
        } else if (gl.mode === "circle") {
          gl.ang += dt * 0.9;
          const k = sat(gl.t / 1.6);
          const tx = gl.cx + Math.cos(gl.ang) * gl.rad, ty = gl.cy + Math.sin(gl.ang) * gl.rad * 0.35;
          gl.x = lerp(gl.x, tx, 1 - Math.exp(-dt * (1 + k * 3)));
          gl.y = lerp(gl.y, ty, 1 - Math.exp(-dt * (1 + k * 3)));
          if (gl.t > 6) { gl.mode = "drift"; gl.vx = (Math.random() < 0.5 ? -1 : 1) * 18; }
        } else if (gl.mode === "away") {
          gl.x += (gl.x < 200 ? -1 : 1) * 70 * dt;
          gl.y += 20 * dt;
          if (gl.t > 4) { gl.mode = "drift"; gl.y = 160 + Math.random() * 180; }
        }
      }
    }

    function updateOutro(rdt) {
      outro.t += rdt;
      if (outro.gap > 0) {
        outro.gap -= rdt;
        if (outro.gap <= 0) { outro.step = nextOutroStep(); outro.t = 0; outro.cycle0 = realNow; }
        return;
      }
      // Never trap anyone: each cue gives way after a while even if ignored.
      const patience = chromeAlive ? 11 : 8;
      if ((outro.step === "capture" || outro.step === "like") && outro.t > patience) {
        passed[outro.step] = true;
        outro.step = nextOutroStep();
        outro.t = 0;
        outro.cycle0 = realNow;
      }
    }

    function updateSwap(rdt) {
      swap.t += rdt;
      if (!swap.did && swap.t >= 0.45) {
        swap.did = true;
        beginRun(false);
        phase = "play";
        phaseT = 0;
        wait = 0.5;
      }
      if (swap.t >= 1.05) swap = null;
    }

    // --------------------------------------------------------------- drawing
    function poly(pts) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill();
    }
    // Fill a shape lit on the left, shaded on the right of splitX.
    function splitFill(path, lit, shade, splitX) {
      g.fillStyle = lit;
      path();
      g.fill();
      g.save();
      g.beginPath();
      g.rect(splitX, -400, 400, 800);
      g.clip();
      g.fillStyle = shade;
      path();
      g.fill();
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

    function drawSky() {
      const hy = sy(Y0);
      const grd = g.createLinearGradient(0, 0, 0, Math.max(hy, 10));
      grd.addColorStop(0, P.skyTop);
      grd.addColorStop(1, P.skyLow);
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      // Stars belong to dusk only.
      if (dusk > 0.05) {
        for (const s of stars) {
          const a = dusk * (0.55 + 0.45 * Math.sin(realNow * 1.3 + s.ph));
          g.fillStyle = "rgba(250,244,226," + Math.min(1, a).toFixed(3) + ")";
          g.fillRect(s.x * W, s.y * H, s.s * 1.3, s.s * 1.3);
        }
      }
      // A pale disc: the morning sun that becomes the moon.
      const mx = W / 2 + (300 - 200 + dusk * 8) * S, my = H / 2 + (205 - (400 + (cam.y - 400) * 0.2)) * S + dusk * 78 * S;
      g.fillStyle = rgba(PR.sun, 0.55 + dusk * 0.35);
      g.beginPath();
      g.arc(mx, my, (44 - dusk * 8) * S, 0, TAU);
      g.fill();
    }

    function pushCam(f) {
      g.save();
      const shx = cam.shake ? (Math.random() - 0.5) * cam.shake * 2 : 0;
      const shy = cam.shake ? (Math.random() - 0.5) * cam.shake * 2 : 0;
      g.translate(W / 2 + shx, H / 2 + shy);
      g.scale(cam.zoom * S, cam.zoom * S);
      g.translate(-cam.x, -(400 + (cam.y - 400) * f));
    }

    function drawFar() {
      pushCam(0.35);
      const top = 400 + (cam.y - 400) * 0.35 - H / 2 / (cam.zoom * S) - 20;
      // Low distant islands on the horizon.
      g.fillStyle = P.farDark;
      poly([[-120, Y0 + 1], [-60, Y0 - 16], [-10, Y0 - 9], [30, Y0 + 1]]);
      poly([[300, Y0 + 1], [350, Y0 - 12], [380, Y0 - 20], [440, Y0 - 6], [520, Y0 + 1]]);
      // Far islands hanging on their own threads: how this world delivers things.
      for (const f of farIsles) {
        const sw = Math.sin(realNow * 0.35 + f.ph) * 0.04;
        const L = f.y - top;
        const ax = f.x + Math.sin(sw) * L, ay = top + Math.cos(sw) * L;
        g.strokeStyle = rgba(PR.far, 0.9);
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(f.x, top);
        g.lineTo(ax, ay);
        g.stroke();
        g.save();
        g.translate(ax, ay);
        g.scale(f.s, f.s);
        g.fillStyle = P.farDark;
        poly([[-46, 2], [46, 2], [24, 20], [6, 36], [-12, 27], [-32, 13]]);
        g.fillStyle = P.far;
        g.beginPath();
        g.moveTo(-48, 3);
        g.quadraticCurveTo(-24, -11, 0, -12);
        g.quadraticCurveTo(26, -11, 48, 3);
        g.closePath();
        g.fill();
        g.fillStyle = P.farDark;
        for (let i = 0; i < f.houses; i++) {
          const hx = -14 + i * 24;
          g.fillRect(hx - 7, -24, 14, 14);
          poly([[hx - 9, -24], [hx + 9, -24], [hx, -33]]);
        }
        poly([[24, -9], [30, -30], [36, -9]]);
        g.restore();
      }
      g.restore();
    }

    function cloudShape(c, col, shade) {
      const s = c.s;
      g.fillStyle = col;
      g.beginPath();
      g.arc(c.x - 22 * s, c.y - 6 * s, 14 * s, 0, TAU);
      g.arc(c.x, c.y - 14 * s, 20 * s, 0, TAU);
      g.arc(c.x + 24 * s, c.y - 7 * s, 15 * s, 0, TAU);
      g.rect(c.x - 36 * s, c.y - 8 * s, 74 * s, 8 * s);
      g.fill();
      g.fillStyle = shade;
      g.fillRect(c.x - 36 * s, c.y - 3 * s, 74 * s, 3 * s);
    }
    function drawClouds(layer, alpha) {
      if (alpha <= 0.01) return;
      g.globalAlpha = alpha;
      for (const c of clouds) if (c.layer === layer) cloudShape(c, P.cloud, P.cloudShade);
      g.globalAlpha = 1;
    }

    function drawSea() {
      const bot = cam.y + H / 2 / (cam.zoom * S) + 20;
      g.fillStyle = P.sea;
      g.fillRect(-400, Y0, 1200, bot - Y0 + 400);
      g.fillStyle = P.seaDeep;
      g.fillRect(-400, Y0 + 150, 1200, bot);
      // Long flat glints.
      g.strokeStyle = rgba(PR.seaLine, 0.7);
      g.lineWidth = 1.1;
      for (let i = 0; i < 9; i++) {
        const y = Y0 + 12 + i * 17 + (i % 3) * 3;
        const x = ((i * 97 + realNow * (6 + (i % 4) * 3)) % 520) - 60;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 26 + (i % 3) * 14, y);
        g.stroke();
      }
    }

    function drawHalo() {
      const k = 1 - riseK;
      if (k <= 0.01 || edgeR <= edgeL) return;
      const l = edgeL, r = edgeR, m = (l + r) / 2;
      g.globalAlpha = k;
      g.fillStyle = P.shallow;
      poly([[l - 16, Y0], [l - 4, Y0 + 9], [m - 30, Y0 + 15], [m + 34, Y0 + 14], [r + 6, Y0 + 9], [r + 18, Y0]]);
      // Mirrored island, a faint reflection.
      g.fillStyle = rgba(PR.seaDeep, 0.55);
      g.beginPath();
      g.moveTo(l, Y0 + 1);
      for (let x = l; x <= r; x += DX) g.lineTo(x, Y0 + 1 + hAt(x) * 0.45);
      g.lineTo(r, Y0 + 1);
      g.fill();
      g.strokeStyle = rgba(PR.seaLine, 0.9);
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(l - 30, Y0 + 1);
      g.lineTo(l - 14, Y0 + 15);
      g.lineTo(m - 20, Y0 + 24);
      g.lineTo(m + 44, Y0 + 22);
      g.lineTo(r + 16, Y0 + 15);
      g.lineTo(r + 34, Y0 + 1);
      g.stroke();
      g.globalAlpha = 1;
    }

    function drawRings() {
      for (const r of rings) {
        if (r.life < 0) continue;
        const k = r.life / r.max;
        const rad = r.r + k * (r.grow || 34);
        g.strokeStyle = rgba(PR.seaLine, (1 - k) * 0.9);
        g.lineWidth = r.w;
        g.beginPath();
        g.ellipse(r.x, r.y + 1, rad, rad * 0.22, 0, 0, TAU);
        g.stroke();
      }
    }

    function drawIslets() {
      for (const it of islets) {
        const bob = Math.sin(now * 1.6 + it.t) * 1.2;
        const born = sat((now - it.born) / 0.6);
        const sink = it.born > 0 ? (1 - E.out(born)) * 10 : 0;
        const y = Y0 + bob + sink;
        g.save();
        g.translate(it.x, y);
        const w = it.w, h = it.h;
        splitFill(() => { g.beginPath(); g.moveTo(-w / 2, 1); g.quadraticCurveTo(-w * 0.2, -h * 1.3, w * 0.1, -h); g.quadraticCurveTo(w * 0.35, -h * 0.9, w / 2, 1); g.closePath(); }, P.sand, P.sandDark, w * 0.08);
        if (it.kind !== "rock") {
          g.fillStyle = P.grass;
          g.beginPath();
          g.moveTo(-w * 0.32, -h * 0.55);
          g.quadraticCurveTo(-w * 0.1, -h * 1.15, w * 0.1, -h * 0.98);
          g.quadraticCurveTo(w * 0.3, -h * 0.85, w * 0.34, -h * 0.5);
          g.closePath();
          g.fill();
        }
        if (it.kind === "house") drawHouseAt(0, -h * 0.85, { level: 0, roof: true, variant: it.variant, lit: litFor(it) });
        else if (it.kind === "tree") drawTreeAt(0, -h * 0.85, it.variant, 0);
        else if (it.kind === "lighthouse") drawLighthouseAt(0, -h * 0.85, lampK);
        g.restore();
        g.strokeStyle = rgba(PR.seaLine, 0.8);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(it.x - it.w * 0.75, Y0 + 3);
        g.lineTo(it.x - it.w * 0.2, Y0 + 7);
        g.lineTo(it.x + it.w * 0.55, Y0 + 6);
        g.lineTo(it.x + it.w * 0.85, Y0 + 2);
        g.stroke();
      }
    }

    function litFor(o) {
      if (finaleStart < 0) return 0;
      return sat((now - finaleStart - (o.litDelay || 1.6)) / 0.35);
    }

    function drawIsland() {
      const b = baseY();
      if (edgeR <= edgeL) return;
      // Underside: the part of the island that was always under the sea.
      if (isle.lift > 1) {
        g.fillStyle = P.rock;
        g.beginPath();
        g.moveTo(edgeL, b);
        for (let x = edgeL; x <= edgeR; x += DX) g.lineTo(x, b + depthAt(x));
        g.lineTo(edgeR, b);
        g.closePath();
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = P.rockDark;
        g.beginPath();
        g.moveTo(peakX, b - 2);
        for (let x = peakX; x <= edgeR + DX; x += DX) g.lineTo(x, b + depthAt(Math.min(x, edgeR)) + 2);
        g.lineTo(edgeR + 4, b - 2);
        g.closePath();
        g.fill();
        g.fillStyle = rgba(PR.rockDark, 0.55);
        g.beginPath();
        for (let x = edgeL; x <= edgeR; x += DX) g.lineTo(x, b + depthAt(x) * 0.42);
        for (let x = edgeR; x >= edgeL; x -= DX) g.lineTo(x, b + depthAt(x) * 0.48 + 3);
        g.closePath();
        g.fill();
        g.restore();
        // Hanging roots.
        g.strokeStyle = rgba(PR.trunk, 0.85);
        g.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const x = lerp(edgeL + 14, edgeR - 14, (i + 0.5) / 9);
          const y0 = b + depthAt(x) - 1;
          const len = 10 + ((i * 37) % 23);
          const sw = Math.sin(realNow * 0.9 + i) * 2.4;
          g.beginPath();
          g.moveTo(x, y0);
          g.quadraticCurveTo(x + sw * 0.5, y0 + len * 0.5, x + sw, y0 + len);
          g.stroke();
        }
      }
      // Land body.
      g.fillStyle = P.sand;
      g.beginPath();
      g.moveTo(edgeL - 1, b + 2);
      for (let x = edgeL; x <= edgeR; x += DX) g.lineTo(x, b - hAt(x));
      g.lineTo(edgeR + 1, b + 2);
      g.closePath();
      g.fill();
      g.save();
      g.clip();
      g.fillStyle = P.sandDark;
      g.fillRect(peakX, b - 80, 400, 90);
      g.fillStyle = rgba(PR.sandDark, 0.9);
      g.fillRect(edgeL - 2, b - 4, edgeR - edgeL + 4, 8);
      g.restore();
      // Grass cap.
      g.beginPath();
      let startedPath = false;
      const tops = [];
      for (let x = edgeL; x <= edgeR; x += DX) {
        const h = hAt(x);
        if (h > 6) tops.push([x, b - h, Math.min(8, h - 4)]);
      }
      if (tops.length > 1) {
        for (const t of tops) { if (!startedPath) { g.moveTo(t[0], t[1]); startedPath = true; } else g.lineTo(t[0], t[1]); }
        for (let i = tops.length - 1; i >= 0; i--) g.lineTo(tops[i][0], tops[i][1] + tops[i][2]);
        g.closePath();
        g.fillStyle = P.grass;
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = P.grassDark;
        g.fillRect(peakX, b - 90, 400, 100);
        g.restore();
      }
      // Tufts and flowers.
      for (const t of tufts) {
        const k = t.born < 0 ? 1 : E.back(sat((now - t.born) / 0.45));
        if (k <= 0 || !isLand(t.x)) continue;
        const y = b - hAt(t.x) + 1;
        const s = t.s * k;
        if (t.kind === "grass") {
          g.fillStyle = P.grassDark;
          poly([[t.x - 4 * s, y], [t.x - 1.5 * s, y - 7 * s], [t.x, y]]);
          g.fillStyle = P.grass;
          poly([[t.x - 1 * s, y], [t.x + 1.5 * s, y - 9 * s], [t.x + 4 * s, y]]);
        } else {
          const bl = t.bloom ? sat((now - t.bloom) / 0.4) : 0;
          g.strokeStyle = P.grassDark;
          g.lineWidth = 0.9;
          g.beginPath(); g.moveTo(t.x, y); g.lineTo(t.x, y - 6 * s); g.stroke();
          g.fillStyle = bl > 0 ? mixRgb(hexRgb("#f6efe0"), BLOSSOM, bl) : "#f6efe0";
          g.beginPath(); g.arc(t.x, y - 6.5 * s, 1.7 * s * (1 + bl * 0.6), 0, TAU); g.fill();
        }
      }
      // Things standing on the island.
      for (const o of objects) drawObject(o, b);
    }

    function squashFor(o) {
      const t = now - o.born;
      if (t > 0.8 || t < 0) return [1, 1];
      const k = Math.exp(-t * 9) * Math.cos(t * 26);
      return [1 + 0.16 * k, 1 - 0.2 * k];
    }

    function drawObject(o, b) {
      const [ssx, ssy] = squashFor(o);
      g.save();
      g.translate(o.x, b + o.yRel);
      g.scale(ssx, ssy);
      if (o.type === "house") drawHouseAt(0, 0, { level: o.level, roof: o.roof, variant: o.variant, lit: litFor(o) });
      else if (o.type === "tree") drawTreeAt(0, 0, o.variant, o.bloomAt >= 0 ? sat((now - o.bloomAt) / 0.5) : 0);
      else if (o.type === "lighthouse") drawLighthouseAt(0, 0, lampK);
      g.restore();
    }

    function drawHouseAt(x, y, o) {
      const w = HOUSE.w, wall = HOUSE.wall, roof = HOUSE.roof, d = HOUSE.d;
      g.save();
      g.translate(x, y);
      g.fillStyle = P.wallShade;
      poly([[w / 2, 0], [w / 2 + d, -d * 0.55], [w / 2 + d, -wall - d * 0.55], [w / 2, -wall]]);
      g.fillStyle = P.wall;
      g.fillRect(-w / 2, -wall, w, wall);
      const lit = o.lit || 0;
      const glass = lit > 0 ? mixRgb(PR.glass, LAMP, lit) : P.glass;
      if (lit > 0) {
        g.fillStyle = "rgba(255,210,122," + (0.22 * lit).toFixed(3) + ")";
        if (o.level === 0) g.fillRect(-w / 2 + 2, -wall + 2, 14, 14);
        else g.fillRect(-w / 2 + 2, -wall + 2, w - 4, 12);
      }
      g.fillStyle = glass;
      if (o.level === 0) {
        g.fillRect(-11, -16, 6, 7);
        g.fillStyle = P.roofShade;
        g.fillRect(4, -12, 7, 12);
        g.fillStyle = glass;
        g.fillRect(6.3, -10, 2.4, 3);
      } else {
        const v = o.variant || 0;
        if (v === 1) { g.fillRect(-12, -15, 24, 5); }
        else { g.fillRect(-11, -16, 6, 7); g.fillRect(5, -16, 6, 7); }
      }
      if (o.level > 0) {
        g.fillStyle = P.wallShade;
        g.fillRect(-w / 2, -1.2, w, 1.2);
      }
      if (o.roof) {
        g.fillStyle = P.roof;
        poly([[-w / 2 - 2.5, -wall], [w / 2 + 2.5, -wall], [0, -wall - roof]]);
        g.fillStyle = P.roofShade;
        poly([[0, -wall - roof], [w / 2 + 2.5, -wall], [w / 2 + 2.5 + d, -wall - d * 0.55], [d, -wall - roof - d * 0.55]]);
      }
      g.restore();
    }

    function treeColors(variant) {
      if (variant === "round") return [PR.treeB, PR.treeBS];
      if (variant === "cone") return [PR.treeC, PR.treeCS];
      return [PR.treeA, PR.treeAS];
    }
    function drawTreeAt(x, y, variant, bloom) {
      const [c1, c2] = treeColors(variant);
      const lit = bloom > 0 ? mixRgb(c1, BLOSSOM, bloom) : "rgb(" + c1.join(",") + ")";
      const sh = bloom > 0 ? mixRgb(c2, BLOSSOM_S, bloom) : "rgb(" + c2.join(",") + ")";
      g.save();
      g.translate(x, y);
      g.strokeStyle = P.trunk;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -10);
      g.stroke();
      if (variant === "round") {
        splitFill(() => { g.beginPath(); g.arc(0, -21, 11, 0, TAU); }, lit, sh, 1.5);
        splitFill(() => { g.beginPath(); g.arc(-5, -29, 6.5, 0, TAU); }, lit, sh, 1.5);
      } else if (variant === "cone") {
        splitFill(() => { g.beginPath(); g.moveTo(0, -42); g.lineTo(10, -7); g.lineTo(-10, -7); g.closePath(); }, lit, sh, 0);
      } else {
        splitFill(() => {
          g.beginPath();
          g.moveTo(0, -42);
          g.bezierCurveTo(7, -30, 9, -16, 6, -7);
          g.quadraticCurveTo(0, -3, -6, -7);
          g.bezierCurveTo(-9, -16, -7, -30, 0, -42);
          g.closePath();
        }, lit, sh, 0.5);
      }
      g.restore();
    }

    function drawLighthouseAt(x, y, lamp) {
      const hb = 11, ht = 7.5, h = 56;
      g.save();
      g.translate(x, y);
      const tower = () => { g.beginPath(); g.moveTo(-hb, 0); g.lineTo(hb, 0); g.lineTo(ht, -h); g.lineTo(-ht, -h); g.closePath(); };
      splitFill(tower, P.wall, P.wallShade, 1);
      g.save();
      tower();
      g.clip();
      g.fillStyle = P.roof;
      g.fillRect(-20, -22, 40, 7);
      g.fillRect(-20, -42, 40, 6);
      g.fillStyle = P.roofShade;
      g.fillRect(1, -22, 20, 7);
      g.fillRect(1, -42, 20, 6);
      g.restore();
      g.fillStyle = P.thread;
      g.fillRect(-ht - 3, -h - 2, 2 * ht + 6, 2.5);
      if (lamp > 0) {
        g.fillStyle = "rgba(255,214,130," + (0.35 * lamp).toFixed(3) + ")";
        g.beginPath();
        g.arc(0, -h - 7, 13 + 4 * lamp, 0, TAU);
        g.fill();
      }
      g.fillStyle = lamp > 0 ? mixRgb(PR.glass, LAMP, lamp) : P.glass;
      g.fillRect(-5, -h - 11, 10, 9);
      g.fillStyle = P.roof;
      poly([[-7.5, -h - 11], [7.5, -h - 11], [0, -h - 20]]);
      g.restore();
    }

    function drawHillChunk() {
      // A torn-off piece of hill: grass on top, rock beneath. Base (0,0) = rock tip.
      splitFill(() => { g.beginPath(); g.moveTo(-36, -14); g.lineTo(36, -14); g.lineTo(12, -3); g.lineTo(0, 0); g.lineTo(-13, -4); g.closePath(); }, P.rock, P.rockDark, 4);
      splitFill(() => { g.beginPath(); g.moveTo(-39, -13); g.quadraticCurveTo(-14, -34, 6, -32); g.quadraticCurveTo(26, -30, 39, -13); g.closePath(); }, P.sand, P.sandDark, 6);
      splitFill(() => { g.beginPath(); g.moveTo(-31, -19); g.quadraticCurveTo(-12, -35, 6, -32); g.quadraticCurveTo(22, -30, 31, -19); g.quadraticCurveTo(0, -24, -31, -19); g.closePath(); }, P.grass, P.grassDark, 6);
    }

    function drawPieceShape(type, variant) {
      if (type === "house") drawHouseAt(0, 0, { level: 0, roof: true, variant });
      else if (type === "tree") drawTreeAt(0, 0, variant, 0);
      else if (type === "hill") drawHillChunk();
      else drawLighthouseAt(0, 0, 0);
    }

    function drawThreadAndPiece() {
      const pY = pivotY();
      if (threadCut) {
        const k = threadCut.t / 0.9;
        const len = (1 - E.out(sat(k * 1.3))) * (threadCut.ay - pY);
        const wob = Math.sin(threadCut.t * 30) * 10 * (1 - k);
        g.strokeStyle = rgba(PR.thread, 0.9 * (1 - k));
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(threadCut.px, pY);
        const ex = lerp(threadCut.px, threadCut.ax, len / Math.max(1, threadCut.ay - pY));
        g.quadraticCurveTo((threadCut.px + ex) / 2 + wob, pY + len * 0.5, ex + wob * 0.4, pY + len);
        g.stroke();
      }
      if (!cur) return;
      if (cur.state === "fall") {
        g.save();
        g.translate(cur.x, cur.y);
        g.rotate(cur.rot);
        g.strokeStyle = P.thread;
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(0, -cur.def.h);
        g.lineTo(Math.sin(now * 20) * 2, -cur.def.h - 9);
        g.stroke();
        drawPieceShape(cur.type, cur.variant);
        g.restore();
        return;
      }
      const st = swingState(cur);
      // Landing shadow, so aiming is something you can see.
      if (pred) {
        const a = cur.i < 2 ? 0.9 : 0.6;
        if (pred.kind === "water") {
          g.strokeStyle = rgba(PR.seaLine, a);
          g.lineWidth = 1.4;
          g.beginPath();
          g.ellipse(pred.x, Y0 + 2, cur.def.w * 0.55, 3.2, 0, 0, TAU);
          g.stroke();
        } else {
          g.fillStyle = "rgba(18,60,60," + (0.22 * a).toFixed(3) + ")";
          g.beginPath();
          g.ellipse(pred.x, pred.y + 0.5, cur.def.w * 0.55, 3, 0, 0, TAU);
          g.fill();
        }
        if (cur.i < 2) {
          g.strokeStyle = "rgba(18,60,60,0.16)";
          g.setLineDash([2, 5]);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(st.bx, st.by + 4);
          g.lineTo(pred.x, pred.kind === "water" ? Y0 - 2 : pred.y - 4);
          g.stroke();
          g.setLineDash([]);
        }
      }
      g.strokeStyle = P.thread;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(st.px, st.py);
      g.quadraticCurveTo((st.px + st.ax) / 2 + Math.sin(st.rot) * 6, (st.py + st.ay) / 2, st.ax, st.ay);
      g.stroke();
      g.save();
      g.translate(st.ax, st.ay);
      g.rotate(st.rot);
      g.translate(0, cur.def.h);
      drawPieceShape(cur.type, cur.variant);
      g.restore();
    }

    function drawParticles() {
      for (const p of parts) {
        if (p.life < 0) continue;
        const k = p.life / p.max;
        if (p.k === "dust") {
          g.fillStyle = rgba(p.col, (1 - k) * 0.85);
          g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k * 0.6), 0, TAU); g.fill();
        } else if (p.k === "drop") {
          g.fillStyle = "rgba(255,255,255," + (0.9 * (1 - k)).toFixed(3) + ")";
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
        } else if (p.k === "drip") {
          g.strokeStyle = "rgba(240,250,248," + (0.85 * (1 - k * 0.5)).toFixed(3) + ")";
          g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y + p.r); g.stroke();
        } else if (p.k === "petal") {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = rgba(BLOSSOM, sat(1 - k) * 0.95);
          g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
          g.restore();
        }
      }
    }

    function drawGulls() {
      g.strokeStyle = P.gull;
      g.lineWidth = 1.5;
      g.lineCap = "round";
      for (const gl of gulls) {
        const f = Math.sin(gl.ph) * 3;
        const dir = gl.mode === "drift" || gl.mode === "scatter" ? Math.sign(gl.vx) || 1 : 1;
        g.beginPath();
        g.moveTo(gl.x - 7, gl.y - f);
        g.quadraticCurveTo(gl.x - 3, gl.y - 3 - f * 0.4, gl.x + dir * 0.6, gl.y);
        g.quadraticCurveTo(gl.x + 3, gl.y - 3 - f * 0.4, gl.x + 7, gl.y - f);
        g.stroke();
      }
      g.lineCap = "butt";
    }

    function drawLikeGlow() {
      // A warm breath around the island: the world answering a like.
      const cx = (edgeL + edgeR) / 2, cy = baseY() - 20;
      const k = Math.sin(Math.PI * Math.min(1, (1 - likeGlow) * 1.6)) ;
      const r = 120 + (1 - likeGlow) * 90;
      const grd = g.createRadialGradient(cx, cy, 10, cx, cy, r);
      grd.addColorStop(0, "rgba(242,152,138," + (0.42 * k).toFixed(3) + ")");
      grd.addColorStop(1, "rgba(242,152,138,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }

    function drawBeam() {
      if (lampK <= 0.01) return;
      const lh = objects.find((o) => o.type === "lighthouse");
      const il = !lh ? islets.find((o) => o.kind === "lighthouse") : null;
      let lx, ly;
      if (lh) { lx = lh.x; ly = baseY() + lh.yRel - 63; }
      else if (il) { lx = il.x; ly = Y0 - il.h * 0.85 - 63; }
      else return;
      const ang = Math.sin(now * 0.55) * 1.25;
      const dir = Math.cos(ang) >= 0 ? 1 : -1;
      const a0 = ang - 0.055, a1 = ang + 0.055;
      const R = 900;
      g.fillStyle = "rgba(255,236,186," + (0.16 * lampK * (0.4 + dusk * 0.6)).toFixed(3) + ")";
      g.beginPath();
      g.moveTo(lx, ly);
      g.lineTo(lx + Math.cos(a0) * R * dir, ly + Math.sin(a0) * R * 0.25);
      g.lineTo(lx + Math.cos(a1) * R * dir, ly + Math.sin(a1) * R * 0.25 + 30);
      g.closePath();
      g.fill();
    }

    // ------------------------------------------------------------ overlays
    function drawGrain() { paintGrain(); }

    function inkFor(alpha) { return rgba(PR.ink, alpha); }

    function drawWelcome() {
      if (welcomeK <= 0.001) return;
      const k = E.out(welcomeK);
      const top = area.top + 58;
      const lift = (1 - k) * -14;
      g.textBaseline = "alphabetic";
      g.fillStyle = inkFor(0.95 * k);
      const title = firstVisit ? "WELCOME TO PLETHORA" : "A LITTLE SOMETHING";
      const sub = firstVisit ? "There's a little something here." : "Another island is waiting.";
      g.font = "400 " + Math.round(clamp(W * 0.122, 38, 60)) + "px " + F_DISPLAY;
      // A sky-coloured knockout lets the thread pass behind the letters.
      g.lineJoin = "round";
      g.strokeStyle = rgba(PR.skyTop, 0.9 * k);
      g.lineWidth = 7;
      tracked(title, W / 2, top + 30 + lift, 1.2, "center", true);
      g.fillStyle = inkFor(0.95 * k);
      tracked(title, W / 2, top + 30 + lift, 1.2, "center");
      g.font = "400 15px " + F_TEXT;
      g.textAlign = "center";
      g.lineWidth = 6;
      g.strokeText(sub, W / 2, top + 56 + lift * 0.6);
      g.fillStyle = inkFor(0.8 * k);
      g.fillText(sub, W / 2, top + 56 + lift * 0.6);
    }

    function drawTapCue() {
      if (!cur || !(cur.state === "swing" || cur.state === "lower")) return;
      if (!(phase === "intro" || phase === "play")) return;
      const idle = realNow - Math.max(lastInput, cur.spawnReal || 0);
      let a = 0;
      if (phase === "intro") a = sat((realNow - 0.9) / 0.6);
      else if (idle > 4.5) a = sat((idle - 4.5) / 0.5);
      if (a <= 0) return;
      const st = swingState(cur);
      const ly = clamp(sy((st.by + (baseY() - 40)) / 2 + 10), area.top + 150, H - area.bottom - 30);
      g.font = "400 12px " + F_MONO;
      g.fillStyle = inkFor(0.92 * a);
      tracked("TAP TO LET IT GO", W / 2, ly, 2.8, "center");
      // Ghost tap beside the piece, demonstrating once every few seconds.
      const dt = realNow - demoT;
      if (demoT > 0 && dt < 1.5) {
        const px = sx(st.bx) + 42 * (st.bx < 200 ? 1 : -1), py = sy(st.by - cur.def.h * 0.5);
        ghostTap(px, py, dt, a);
      }
    }

    function ghostTap(x, y, t, a) {
      const appear = sat(t / 0.2), press = win(t, 0.25, 0.4), gone = win(t, 0.75, 1.1);
      const alpha = a * appear * (1 - gone);
      if (alpha <= 0) return;
      const r = 15 * (1 - press * 0.18);
      g.fillStyle = inkFor(0.2 * alpha);
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.55 * alpha);
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      if (t > 0.3) {
        const rk = win(t, 0.3, 1.2);
        g.strokeStyle = inkFor(0.5 * (1 - rk) * a);
        g.beginPath(); g.arc(x, y, 15 + rk * 34, 0, TAU); g.stroke();
      }
    }

    function drawProgress() {
      if (phase === "intro" || phase === "finale" || phase === "outro" || welcomeK > 0.02) return;
      const n = queue.length;
      const gap = 11, y = area.top + 22;
      const x0 = W / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * gap;
        if (i < qi) {
          g.fillStyle = inkFor(0.75);
          g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
        } else {
          g.strokeStyle = inkFor(i === qi ? 0.7 : 0.3);
          g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, i === qi ? 3.2 : 2.4, 0, TAU); g.stroke();
        }
      }
      if (hint) {
        const t = realNow - hint.t0;
        const a = sat(t / 0.25) * (1 - win(t, hint.dur, hint.dur + 0.45));
        if (a > 0) {
          g.font = "400 10.5px " + F_MONO;
          g.fillStyle = inkFor(0.8 * a);
          tracked(hint.text, W / 2, y + 26 + (1 - a) * 4, 2.2, "center");
        }
      }
    }

    function drawMute() {
      if (!started) return;
      const m = muteRect();
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      const a = phase === "outro" || phase === "finale" ? 0.55 : 0.4;
      g.strokeStyle = inkFor(a);
      g.fillStyle = inkFor(a);
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(cx - 6, cy - 2.5); g.lineTo(cx - 3, cy - 2.5); g.lineTo(cx + 2, cy - 6.5); g.lineTo(cx + 2, cy + 6.5); g.lineTo(cx - 3, cy + 2.5); g.lineTo(cx - 6, cy + 2.5); g.closePath();
      g.fill();
      if (A.muted) {
        g.beginPath(); g.moveTo(cx + 4.5, cy - 3); g.lineTo(cx + 9.5, cy + 3); g.moveTo(cx + 9.5, cy - 3); g.lineTo(cx + 4.5, cy + 3); g.stroke();
      } else {
        g.beginPath(); g.arc(cx + 2, cy, 5, -0.7, 0.7); g.stroke();
        g.beginPath(); g.arc(cx + 2, cy, 8.5, -0.7, 0.7); g.stroke();
      }
    }

    function dateLabel() {
      const d = new Date();
      const p = (n) => (n < 10 ? "0" : "") + n;
      return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + String(d.getFullYear()).slice(2);
    }

    function drawPlate() {
      if (plateK <= 0.001) return;
      const inset = 12 + (1 - plateK) * 10 + frameSnap * 10;
      const top = area.top + 40;
      const bottom = Math.min(H - area.bottom - 74, H - 12);
      g.strokeStyle = inkFor(0.5 * plateK);
      g.lineWidth = 1;
      g.strokeRect(inset, top + inset * 0.3, W - inset * 2, bottom - top - inset * 0.3);
      // Corner ticks: a print's registration marks.
      g.strokeStyle = inkFor(0.85 * plateK);
      g.lineWidth = 1.4;
      const cs = 9;
      const L = inset, R = W - inset, T = top + inset * 0.3, B = bottom;
      g.beginPath();
      g.moveTo(L, T + cs); g.lineTo(L, T); g.lineTo(L + cs, T);
      g.moveTo(R - cs, T); g.lineTo(R, T); g.lineTo(R, T + cs);
      g.moveTo(L, B - cs); g.lineTo(L, B); g.lineTo(L + cs, B);
      g.moveTo(R - cs, B); g.lineTo(R, B); g.lineTo(R, B - cs);
      g.stroke();
      const ty = top + 30;
      g.fillStyle = inkFor(0.8 * plateK);
      g.font = "400 10.5px " + F_MONO;
      tracked("A LITTLE SOMETHING", W / 2, ty, 2.6, "center");
      g.fillStyle = inkFor(0.97 * plateK);
      g.font = "400 " + Math.round(clamp(W * 0.13, 40, 62)) + "px " + F_DISPLAY;
      tracked("ISLAND Nº " + islandNo, W / 2, ty + 46, 1.4, "center");
      g.font = "400 10.5px " + F_MONO;
      g.fillStyle = inkFor(0.78 * plateK);
      const who = ctx.viewer && ctx.viewer.username ? "@" + String(ctx.viewer.username).toUpperCase().slice(0, 18) : "YOU";
      tracked("MADE BY " + who + "  ·  " + dateLabel(), W / 2, ty + 70, 1.8, "center");
      const lostLine = missCount === 0 ? "NOTHING LOST TO THE SEA" : missCount === 1 ? "ONE PIECE KEPT BY THE SEA" : missCount + " PIECES KEPT BY THE SEA";
      tracked(queue.length + " PIECES  ·  " + lostLine, W / 2, ty + 88, 1.8, "center");
      if (stampK > 0) {
        const a = E.out(stampK);
        g.save();
        g.translate(R - 46, B - 22);
        g.rotate(-0.08);
        g.globalAlpha = a;
        g.strokeStyle = inkFor(0.9);
        g.lineWidth = 1.2;
        g.strokeRect(-36, -12, 72, 22);
        g.fillStyle = inkFor(0.9);
        g.font = "400 10px " + F_MONO;
        tracked("CAPTURED", 0, 3, 1.6, "center");
        g.restore();
      }
    }

    // Host gesture demonstrations around the real logo button.
    function drawCameraIcon(x, y, a) {
      g.strokeStyle = inkFor(a);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 8, y - 4); g.lineTo(x - 4, y - 4); g.lineTo(x - 2.5, y - 6.5); g.lineTo(x + 2.5, y - 6.5); g.lineTo(x + 4, y - 4); g.lineTo(x + 8, y - 4); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.closePath();
      g.stroke();
      g.beginPath(); g.arc(x, y + 1, 3.2, 0, TAU); g.stroke();
    }
    function heartPath(x, y, s) {
      g.beginPath();
      g.moveTo(x, y + 6 * s);
      g.bezierCurveTo(x - 9 * s, y - 1 * s, x - 6 * s, y - 8 * s, x, y - 3.5 * s);
      g.bezierCurveTo(x + 6 * s, y - 8 * s, x + 9 * s, y - 1 * s, x, y + 6 * s);
      g.closePath();
    }
    function ghostSwipe(dir, t, a, icon) {
      // A finger lands on the logo, slides out, and the destination icon appears.
      const cx = logo.cx, cy = logo.cy;
      const dist = 96;
      const appear = sat(t / 0.25), move = E.inOut(win(t, 0.3, 1.15)), gone = win(t, 1.7, 2.05);
      const alpha = a * appear * (1 - gone);
      const ix = cx + dir * (dist + 14);
      // Destination target.
      g.fillStyle = inkFor(0.1 * a);
      g.beginPath(); g.arc(ix, cy, 19, 0, TAU); g.fill();
      if (icon === "camera") drawCameraIcon(ix, cy, (0.45 + 0.5 * move) * a);
      else { heartPath(ix, cy, 1.15); g.fillStyle = move > 0.9 ? "rgba(226,82,70," + (0.85 * a).toFixed(3) + ")" : inkFor(0); g.fill(); g.strokeStyle = inkFor((0.45 + 0.5 * move) * a); g.lineWidth = 1.5; g.stroke(); }
      if (alpha <= 0) return;
      const fx = cx + dir * dist * move;
      g.strokeStyle = inkFor(0.5 * alpha);
      g.setLineDash([3, 4]);
      g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(cx + dir * 24, cy); g.lineTo(fx, cy); g.stroke();
      g.setLineDash([]);
      g.fillStyle = inkFor(0.2 * alpha);
      g.beginPath(); g.arc(fx, cy, 14, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.75 * alpha);
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(fx, cy, 14, 0, TAU); g.stroke();
    }

    function drawCueLabel(line1, line2, a, y) {
      g.textAlign = "center";
      g.font = "600 15px " + F_TEXT;
      g.fillStyle = inkFor(0.95 * a);
      g.fillText(line1, W / 2, y);
      g.font = "400 10.5px " + F_MONO;
      g.fillStyle = inkFor(0.8 * a);
      tracked(line2, W / 2, y + 19, 2.2, "center");
    }

    function drawOutro() {
      if (phase !== "outro") return;
      const labelY = logo.y - 46;
      if (outro.msg && realNow - outro.msgT < 2.2) {
        const t = realNow - outro.msgT;
        const a = sat(t / 0.25) * (1 - win(t, 1.6, 2.2));
        g.textAlign = "center";
        g.font = "600 15px " + F_TEXT;
        g.fillStyle = inkFor(0.95 * a);
        g.fillText(outro.msg === "IT'S YOURS NOW." ? "It's yours now." : "It likes you back.", W / 2, labelY + 10);
      }
      if (outro.gap > 0) return;
      const a = sat(outro.t / 0.5);
      const ct = (realNow - outro.cycle0) % 2.6;
      if (outro.step === "capture") {
        drawCueLabel("Keep this one.", "SWIPE LEFT TO CAPTURE", a, labelY);
        ghostSwipe(-1, ct, a, "camera");
      } else if (outro.step === "like") {
        drawCueLabel("Enjoyed that?", "SWIPE RIGHT TO LIKE", a, labelY);
        ghostSwipe(1, ct, a, "heart");
      } else if (outro.step === "nav" || outro.step === "free") {
        if (outro.step === "nav") {
          drawNavThread(a);
          drawCueLabel("There's a lot more here.", "TAP { } TO LOOK AROUND", a, labelY - 18);
        }
        const rt = outro.step === "free" ? outro.t : outro.t - 5.5;
        if (rt > 0) {
          const ra = sat(rt / 0.6);
          g.font = "400 10.5px " + F_MONO;
          g.fillStyle = inkFor(0.7 * ra);
          tracked("OR TAP THE SKY FOR ANOTHER ISLAND", W / 2, area.top + 22, 1.8, "center");
        }
      }
    }

    function drawNavThread(a) {
      // The motif comes home: a thread runs from the island down to the logo button.
      const tipX = (edgeL + edgeR) / 2;
      let tipY = baseY() + depthAt(tipX);
      const x0 = sx(tipX), y0 = sy(tipY) + 6;
      const x1 = logo.cx, y1 = logo.y - 6;
      const k = E.out(sat(outro.t / 1.2));
      const yk = lerp(y0, y1, k);
      g.strokeStyle = inkFor(0.55 * a);
      g.lineWidth = 1.2;
      g.setLineDash([2, 6]);
      g.lineDashOffset = -realNow * 18;
      g.beginPath();
      g.moveTo(x0, y0);
      g.bezierCurveTo(x0, lerp(y0, yk, 0.5), x1, lerp(y0, yk, 0.5), lerp(x0, x1, k), yk);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
      if (k > 0.95) {
        for (let i = 0; i < 2; i++) {
          const rk = ((realNow * 0.7 + i * 0.5) % 1);
          g.strokeStyle = inkFor(0.5 * (1 - rk) * a);
          g.lineWidth = 1.3;
          g.beginPath();
          g.ellipse(logo.cx, logo.cy, logo.width / 2 + 6 + rk * 22, logo.height / 2 + 4 + rk * 16, 0, 0, TAU);
          g.stroke();
        }
      }
    }

    function drawEcho() {
      for (const e of echo) {
        const k = (realNow - e.t) / 0.6;
        g.strokeStyle = inkFor(0.4 * (1 - k));
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(e.x, e.y, 6 + k * 20, 0, TAU); g.stroke();
      }
    }

    function render() {
      buildPalette(dusk);
      drawSky();
      drawFar();
      pushCam(0.6);
      drawClouds("back", 0.75);
      g.restore();
      pushCam(1);
      drawClouds("low", 0.55 + riseK * 0.4);
      drawBeam();
      if (likeGlow > 0) drawLikeGlow();
      drawIsland();
      drawSea();
      drawHalo();
      drawRings();
      drawIslets();
      drawThreadAndPiece();
      drawParticles();
      drawGulls();
      if (riseK > 0.05) drawClouds("front", riseK * 0.92);
      g.restore();
      drawGrain();
      drawWelcome();
      drawTapCue();
      drawProgress();
      drawPlate();
      drawOutro();
      drawEcho();
      drawMute();
      if (flash > 0) {
        g.fillStyle = "rgba(255,252,244," + (flash * 0.85).toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
      }
      if (swap) {
        const a = swap.t < 0.45 ? E.inOut(swap.t / 0.45) : 1 - E.inOut(sat((swap.t - 0.45) / 0.6));
        g.fillStyle = rgba(PR.skyLow, a);
        g.fillRect(0, 0, W, H);
      }
    }

    // ------------------------------------------------------------------ boot
    beginRun(true);
    spawnPiece();
    cur.spawnReal = 0;

    let errorReported = false;
    function safe(fn, where) {
      return function (a, b) {
        try { fn(a, b); } catch (e) {
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

    // Dev hook for automated tests in the local harness only.
    if (typeof window !== "undefined" && window.__ALS_DEV) {
      window.__als = {
        get state() { return { phase, qi, placed, missCount, risen, dusk, outro: outro.step, done: Object.assign({}, done), cur: cur ? cur.state : null, objects: objects.length, islets: islets.length, edgeL, edgeR }; },
        pred: () => pred,
        cur: () => (cur ? swingState(cur) : null),
        toScreen: (x, y) => ({ x: sx(x), y: sy(y) })
      };
    }
  }
};
