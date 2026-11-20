// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// A LITTLE SOMETHING: the first Bit a new Plethora viewer meets.
//
// A small island sits in a pale sea; far off, finished islands float, each one
// made by someone on Plethora. The sky lowers pieces on threads: houses, trees,
// a piece of hill and finally a lighthouse. Tap to let go. Houses settle on level
// plots and stack, trees grow between them, land grows the island, the sea keeps
// what misses. Halfway the island tears free of the sea and floats. The lighthouse
// brings dusk. Then the Bit teaches Plethora's real gestures, in order:
//   like (swipe the logo right) -> capture (swipe the logo left) -> scroll for more.
// The finished island is added to a shared world, so it joins everyone else's.
// Host gestures are observed through ctx.chrome (first-party Bits); nothing is faked.
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
      back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
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
    // Dawn (0) to dusk (1). Everything in the world is drawn from these.
    const PAL = {
      skyTop: ["#9fd2c6", "#163a57"], skyLow: ["#e6f0de", "#2f6886"],
      farDark: ["#a3cbbf", "#1d4864"],
      sea: ["#20a5ac", "#103d58"], seaDeep: ["#17909a", "#0b2f48"], seaLine: ["#72d3cd", "#2f7690"], shallow: ["#58c5bf", "#1c5b74"],
      sand: ["#dcb46a", "#937246"], sandDark: ["#c19750", "#6e5536"],
      grass: ["#a7a94c", "#557040"], grassLit: ["#b5b656", "#5f7a46"], grassDark: ["#878b3c", "#405834"],
      rock: ["#a9804b", "#4f3e2e"], rockDark: ["#7c5a35", "#372b21"],
      wall: ["#f6efe0", "#ccd0c7"], wallShade: ["#d7cdb8", "#8e999b"],
      roof: ["#ec8a3f", "#bf6a3b"], roofShade: ["#c8672d", "#8a4b2d"], glass: ["#2a7b82", "#24546a"],
      treeA: ["#eaa83c", "#a9772f"], treeAS: ["#c88a2b", "#7d5725"],
      treeB: ["#f1cd52", "#ad9440"], treeBS: ["#d2ab3b", "#82702f"],
      treeC: ["#8f9b40", "#4d6137"], treeCS: ["#717c31", "#3a4b2b"],
      trunk: ["#6b5233", "#3e3124"], ink: ["#123c3c", "#f4ecd9"], thread: ["#22413e", "#d9d2bf"],
      cloud: ["#f7f2e6", "#40708d"], cloudShade: ["#e3e5d5", "#33617e"], gull: ["#ffffff", "#ede7d8"], sun: ["#f6efd8", "#f3e8c9"],
      shadow: ["#2f4a2a", "#0e1f22"]
    };
    const PAL_RGB = {};
    for (const k in PAL) PAL_RGB[k] = [hexRgb(PAL[k][0]), hexRgb(PAL[k][1])];
    const LAMP = hexRgb("#ffd27a");
    const BLOSSOM = hexRgb("#f2988a");
    const BLOSSOM_S = hexRgb("#d8776b");
    const CREAM = hexRgb("#f6efe0");
    let P = {}, PR = {};          // current palette (css strings / rgb arrays)
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
    // Atmospheric perspective: draw with every colour pulled toward the air.
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
      const tP = hit.tP, tPR = hit.tPR;
      const sP = P, sPR = PR;
      P = tP; PR = tPR;
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

    // ---------------------------------------------------------- island model
    // An island is a height profile seen in three-quarter view: a level top
    // surface (grass ringed by beach), a front cliff, and a rocky underside.
    // Everything stands on the middle of the top surface.
    const N = 161, DX = DW / (N - 1);
    const HOUSE = { w: 34, wall: 22, roof: 14, d: 7 };
    const DEF = { house: { w: 34, h: 36 }, tree: { w: 18, h: 42 }, hill: { w: 78, h: 32 }, lighthouse: { w: 22, h: 76 } };
    const TREE_VARIANTS = ["cypress", "round", "cone"];

    function islandShape(seed) {
      const r = mulberry(seed);
      const land = new Float32Array(N), jag = new Float32Array(N);
      const cx = 200 + (r() - 0.5) * 16, hw = 80 + r() * 10, peak = (r() - 0.5) * 50;
      const ph1 = r() * TAU, ph2 = r() * TAU;
      for (let i = 0; i < N; i++) {
        const x = i * DX, u = (x - cx) / hw;
        let h = 0;
        if (Math.abs(u) < 1) {
          h = 16 * Math.pow(1 - u * u, 0.5);
          const pu = (x - (cx + peak)) / (hw * 0.55);
          h += 14 * Math.max(0, 1 - pu * pu);
          h += 1.6 * Math.sin(x * 0.09 + ph1) + 1.1 * Math.sin(x * 0.21 + ph2);
          h *= Math.min(1, (1 - Math.abs(u)) * 7);
        }
        land[i] = Math.max(0, h);
      }
      let prev = 1;
      for (let i = 0; i < N; i++) { prev = lerp(prev, 0.82 + r() * 0.36, 0.45); jag[i] = prev; }
      const m = { seed, land, jag, edgeL: 120, edgeR: 280, peakX: 200, objects: [], tufts: [], lift: 0, bob: 0, hills: [] };
      measure(m);
      for (let i = 0; i < 9; i++) m.tufts.push({ x: lerp(m.edgeL + 14, m.edgeR - 14, r()), f: 0.15 + r() * 0.75, s: 0.7 + r() * 0.5, born: -9, kind: r() < 0.3 ? "flower" : "grass" });
      return m;
    }
    function measure(m) {
      let l = -1, r = -1, best = -1;
      for (let i = 0; i < N; i++) if (m.land[i] > 2.5) { if (l < 0) l = i; r = i; if (m.land[i] > best) { best = m.land[i]; m.peakX = i * DX; } }
      m.edgeL = l < 0 ? 200 : l * DX;
      m.edgeR = r < 0 ? 200 : r * DX;
    }
    let I = null; // the island the terrain helpers act on
    function hAt(x) {
      const f = x / DX, i = Math.floor(f);
      if (i < 0 || i >= N - 1) return 0;
      const t = f - i;
      return I.land[i] * (1 - t) + I.land[i + 1] * t;
    }
    const isLand = (x) => hAt(x) > 2.5;
    const baseY = () => Y0 - I.lift + I.bob;
    // Depth of the visible top surface at x (how far it recedes behind the front edge).
    function band(x) {
      if (!isLand(x)) return 0;
      const mid = (I.edgeL + I.edgeR) / 2, half = Math.max(10, (I.edgeR - I.edgeL) / 2);
      const u = clamp((x - mid) / half, -1, 1);
      return clamp(half * 0.17, 9, 17) * Math.sqrt(1 - u * u);
    }
    const frontY = (x) => baseY() - hAt(x);
    const standY = (x) => frontY(x) - band(x) * 0.5; // where things stand
    function depthAt(x) {
      if (!isLand(x)) return 0;
      const mid = (I.edgeL + I.edgeR) / 2, half = Math.max(10, (I.edgeR - I.edgeL) / 2);
      const u = clamp((x - mid) / half, -1, 1);
      const i = clamp(Math.round(x / DX), 0, N - 1);
      return Math.pow(1 - u * u, 0.8) * clamp(half * 1.05, 60, 135) * I.jag[i];
    }
    // Flatten a plot so a building's whole footprint touches the ground.
    function levelPlot(x, halfW) {
      const target = hAt(x);
      for (let i = 0; i < N; i++) {
        const d = Math.abs(i * DX - x);
        if (d > halfW + 5) continue;
        const k = d <= halfW ? 1 : 1 - (d - halfW) / 5;
        I.land[i] = lerp(I.land[i], target, k);
      }
    }
    function addHill(x, amount, objects) {
      const sig = 27;
      for (let i = 0; i < N; i++) {
        const dx = i * DX - x;
        I.land[i] = Math.max(0, I.land[i] + amount * Math.exp(-(dx * dx) / (2 * sig * sig)));
      }
      measure(I);
      if (objects) reground(false);
    }
    // Seat every ground-floor thing exactly on the surface; stacks move with their base.
    function reground(relevel) {
      const cols = new Map();
      for (const o of I.objects) {
        if (o.type === "tree") { o.yRel = standY(o.x) - baseY(); continue; }
        const key = Math.round(o.x);
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(o);
      }
      for (const [, col] of cols) {
        const base = col.reduce((b, o) => (o.level < b.level ? o : b), col[0]);
        if (relevel) levelPlot(base.x, base.w / 2 + 1);
        const delta = standY(base.x) - baseY() - base.yRel;
        for (const o of col) o.yRel += delta;
      }
      if (relevel) for (const o of I.objects) if (o.type === "tree") o.yRel = standY(o.x) - baseY();
    }
    // Composition grid: houses and the lighthouse take plots, trees take the gaps.
    function plots() {
      const out = [];
      for (let k = -6; k <= 6; k++) { const x = 200 + k * 40; if (x >= I.edgeL + 18 && x <= I.edgeR - 18) out.push(x); }
      if (!out.length) out.push((I.edgeL + I.edgeR) / 2);
      return out;
    }
    function gaps() {
      const out = [];
      for (let k = -6; k <= 6; k++) { const x = 220 + k * 40; if (x >= I.edgeL + 9 && x <= I.edgeR - 9) out.push(x); }
      out.push(I.edgeL + 12, I.edgeR - 12);
      return out;
    }
    const nearest = (xs, x) => xs.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), xs[0]);
    const column = (x) => I.objects.filter((o) => (o.type === "house" || o.type === "lighthouse") && Math.abs(o.x - x) < 1);
    function topHouse(x) {
      let top = null;
      for (const o of column(x)) if (o.type === "house" && (!top || o.level > top.level)) top = o;
      return top;
    }

    // ------------------------------------------------------------ world state
    let mine = islandShape(1);
    I = mine;
    let islets = [], parts = [], rings = [], hillGrow = [];
    let nextId = 1;
    let rng = mulberry(1);

    // Islands made by other people. Filled from the shared world; Plethora's own
    // starter islands stand in until there are enough.
    const STARTERS = [
      "1|91031|190|H200.0.0,T220.c,H240.0.1,L160",
      "1|52777||H200.0.0,H200.1.2,T180.r,T220.n",
      "1|30418|230|L240,H200.0.1,T160.c,T180.n",
      "1|77311||H160.0.0,T180.r,H200.0.2,H200.1.0,T220.c",
      "1|12903|170|H200.0.1,T220.n,L240,T180.r"
    ];
    let others = [];
    function decodeIsland(desc) {
      if (typeof desc !== "string" || desc.length > 400) return null;
      const p = desc.split("|");
      if (p[0] !== "1") return null;
      const seed = parseInt(p[1], 10);
      if (!Number.isFinite(seed)) return null;
      const m = islandShape(seed >>> 0);
      const save = I;
      I = m;
      try {
        for (const hx of (p[2] || "").split(",").filter(Boolean).slice(0, 3)) {
          const x = clamp(parseInt(hx, 10) || 200, 60, 340);
          addHill(x, 24, false);
          measure(m);
        }
        const objs = (p[3] || "").split(",").filter(Boolean).slice(0, 12);
        // Ground floors first so stacks build upward.
        objs.sort((a, b) => (parseInt(a.split(".")[1], 10) || 0) - (parseInt(b.split(".")[1], 10) || 0));
        for (const s of objs) {
          const t = s[0], f = s.slice(1).split(".");
          const x = clamp(parseInt(f[0], 10) || 200, 50, 350);
          if (!isLand(x)) continue;
          if (t === "H") {
            const top = topHouse(x);
            const level = top ? top.level + 1 : 0;
            if (level > 3) continue;
            if (!top) levelPlot(x, HOUSE.w / 2 + 1);
            if (top) top.roof = false;
            const y = top ? top.yRel - HOUSE.wall : standY(x) - baseY();
            I.objects.push({ type: "house", x, yRel: y, w: 34, level, roof: true, variant: clamp(parseInt(f[2], 10) || 0, 0, 2), born: -9, other: true });
          } else if (t === "T") {
            const v = { c: "cypress", r: "round", n: "cone" }[f[1]] || "cypress";
            I.objects.push({ type: "tree", x, yRel: standY(x) - baseY(), w: 18, level: 0, variant: v, born: -9, other: true, bloomAt: -1 });
          } else if (t === "L") {
            if (column(x).length) continue;
            levelPlot(x, 14);
            I.objects.push({ type: "lighthouse", x, yRel: standY(x) - baseY(), w: 22, level: 0, born: -9, other: true });
          }
        }
        measure(m);
        reground(true);
      } finally { I = save; }
      return m;
    }
    function encodeMine() {
      const vc = { cypress: "c", round: "r", cone: "n" };
      const objs = mine.objects.map((o) => o.type === "house" ? "H" + Math.round(o.x) + "." + o.level + "." + (o.variant || 0)
        : o.type === "tree" ? "T" + Math.round(o.x) + "." + (vc[o.variant] || "c")
        : "L" + Math.round(o.x));
      return "1|" + mine.seed + "|" + mine.hills.map((x) => Math.round(x)).join(",") + "|" + objs.join(",");
    }
    // Where other islands sit: far silhouettes at first, then gathered around yours.
    const SLOTS = [
      { far: [44, 300, 0.3], near: [-196, -168, 0.56] },
      { far: [352, 236, 0.26], near: [200, -40, 0.6] },
      { far: [262, 352, 0.18], near: [-200, 118, 0.5] },
      { far: [126, 214, 0.17], near: [190, 182, 0.46] },
      { far: [318, 380, 0.14], near: [30, -300, 0.42] }
    ];
    function setOthers(list) {
      const out = [];
      for (const it of list) {
        if (out.length >= SLOTS.length) break;
        const m = decodeIsland(it.d);
        if (m) out.push({ model: m, name: it.n || "", ph: out.length * 1.7 + 0.3 });
      }
      for (let i = 0; out.length < SLOTS.length && i < STARTERS.length; i++) out.push({ model: decodeIsland(STARTERS[i]), name: "plethora", ph: out.length * 1.7 + 0.3 });
      others = out;
    }
    setOthers([]);

    // The shared world channel: a bounded set of points, one per finished island.
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
      const r = Math.random;
      const point = { id, x: Math.floor(r() * 1000), y: Math.floor(r() * 1000), d: encodeMine() };
      if (viewerName) point.n = viewerName;
      store.mine.push(id);
      store.mine = store.mine.slice(-12);
      save();
      Promise.resolve().then(() => WORLD.mutate(point)).then(() => ctx.platform.emit("island_shared", {}))
        .catch((e) => ctx.platform.emit("island_share_failed", { message: String((e && e.message) || e).slice(0, 120) }));
    }

    // Scenery.
    const clouds = [];
    (function () {
      const r = mulberry(5);
      for (let i = 0; i < 4; i++) clouds.push({ x: r() * 520 - 60, y: 120 + r() * 170, s: 0.7 + r() * 0.6, v: 3 + r() * 4, layer: "back" });
      for (let i = 0; i < 4; i++) clouds.push({ x: r() * 520 - 60, y: Y0 - 34 - r() * 50, s: 0.9 + r() * 0.8, v: 4 + r() * 5, layer: "low" });
      for (let i = 0; i < 3; i++) clouds.push({ x: r() * 520 - 60, y: 200 + r() * 90, s: 1.0 + r() * 0.6, v: 8 + r() * 6, layer: "front" });
    })();
    const gulls = [];
    (function () {
      const r = mulberry(9);
      for (let i = 0; i < 5; i++) gulls.push({ x: r() * 420 - 10, y: 150 + r() * 220, vx: (r() < 0.5 ? -1 : 1) * (14 + r() * 12), vy: 0, ph: r() * TAU, mode: "drift", t: 0, cx: 0, cy: 0, rad: 0, ang: 0 });
    })();
    const stars = [];
    (function () { const r = mulberry(13); for (let i = 0; i < 54; i++) stars.push({ x: r(), y: r() * 0.62, s: r() < 0.15 ? 1.7 : 1.05, ph: r() * TAU }); })();

    // --------------------------------------------------------------- camera
    const cam = { x: 200, y: 400, zoom: 1, shake: 0 };
    let peek = 0; // the whole world nudges upward while the scroll gesture is demonstrated
    const sx = (x) => W / 2 + (x - cam.x) * cam.zoom * S;
    const sy = (y) => H / 2 + (y - cam.y) * cam.zoom * S + peek;
    const viewTop = () => cam.y - H / 2 / (cam.zoom * S);
    const viewH = () => H / (cam.zoom * S);

    // ---------------------------------------------------------------- state
    let now = 0, realNow = 0, timeScale = 1;
    let phase = "intro";      // intro | play | rise | finale | outro
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
    const outro = { step: "like", t: 0, cycle0: 0, msg: null, msgT: 0 };
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
    function spawnPiece() {
      const type = queue[qi], def = DEF[type], i = qi;
      const pivotX = 200 + (i === 0 ? 0 : (rng() - 0.5) * 36);
      let tallest = baseY() - 40;
      for (let k = 0; k < N; k++) if (I.land[k] > 2.5) tallest = Math.min(tallest, baseY() - I.land[k] - 16);
      for (const o of I.objects) tallest = Math.min(tallest, baseY() + o.yRel - DEF[o.type].h);
      const vt = viewTop();
      const baseLow = clamp(Math.min(tallest - 118, vt + viewH() * 0.4), vt + 200, vt + viewH() * 0.48);
      const L = Math.max(90, baseLow - def.h - (vt - 40));
      cur = {
        type, def, i,
        variant: type === "tree" ? TREE_VARIANTS[Math.floor(rng() * 3)] : type === "house" ? Math.floor(rng() * 3) : 0,
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
      const windA = risen ? 0.07 : 0;
      const th = amp * Math.sin(p.w * p.t) + windA * Math.sin(0.83 * now + 1.3) + jiggle * Math.sin(realNow * 38) * 0.06;
      const thd = amp * p.w * Math.cos(p.w * p.t) + windA * 0.83 * Math.cos(0.83 * now + 1.3);
      const px = p.pivotX, py = pivotY();
      const ax = px + L * Math.sin(th), ay = py + L * Math.cos(th);
      const rot = -th * 0.5; // a hanging piece leans with the thread, but calmly
      const h = p.def.h;
      return { px, py, ax, ay, rot, L, bx: ax - Math.sin(rot) * h, by: ay + Math.cos(rot) * h,
        vx: L * thd * Math.cos(th) + dL * Math.sin(th), vy: -L * thd * Math.sin(th) + dL * Math.cos(th) };
    }
    // Support under a falling piece. Only surfaces at or below fromY count, so a
    // piece beside a tall stack slides past it instead of teleporting onto it.
    function supportAt(x, type, fromY) {
      const hw = DEF[type].w / 2;
      let best = null;
      if (isLand(x)) {
        const y = standY(x);
        if (y >= fromY - 6) best = { y, kind: "land", obj: null };
      }
      for (const o of I.objects) {
        if (o.type !== "house") continue;
        const dx = x - o.x;
        if (Math.abs(dx) > o.w / 2 + hw * 0.35) continue;
        const ob = baseY() + o.yRel;
        const y = type === "house" || !o.roof ? ob - HOUSE.wall : ob - HOUSE.wall - HOUSE.roof * sat(1 - Math.abs(dx) / (o.w / 2 + 3));
        if (y < fromY - 6) continue;
        if (!best || y < best.y) best = { y, kind: "house", obj: o };
      }
      return best || { y: Y0 + 2, kind: "water", obj: null };
    }
    // Where a piece really ends up: the composition rules applied to a raw landing.
    function resolve(type, x, s) {
      if (s.kind === "water" || type === "hill") return { kind: s.kind, x, y: s.y, onto: null };
      if (type === "house") {
        const target = s.kind === "house" ? s.obj : null;
        const px = target ? target.x : nearest(plots(), x);
        let onto = topHouse(px); // always the top of the column, never a buried floor
        let fx = px;
        if (!onto && column(px).some((o) => o.type === "lighthouse")) {
          const free = plots().filter((v) => !column(v).length);
          fx = free.length ? nearest(free, x) : px;
          onto = topHouse(fx);
        }
        if (onto) return { kind: "house", x: onto.x, y: baseY() + onto.yRel - HOUSE.wall, onto };
        return { kind: "land", x: fx, y: standY(fx), onto: null };
      }
      if (type === "lighthouse") {
        const free = plots().filter((v) => !column(v).length);
        const fx = free.length ? nearest(free, x) : nearest(gaps(), x);
        return { kind: "land", x: fx, y: standY(fx), onto: null };
      }
      // Trees grow in the gaps between plots, never on roofs, one tree per gap.
      const byDist = gaps().sort((p, q) => Math.abs(p - x) - Math.abs(q - x));
      const freeGap = byDist.find((v) => !I.objects.some((o) => o.type === "tree" && Math.abs(o.x - v) < 6));
      const gx = freeGap !== undefined ? freeGap : byDist[0] + (Math.random() < 0.5 ? -7 : 7);
      return { kind: "land", x: gx, y: standY(gx), onto: null };
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

    function puff(x, y, n, col, spread) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1 || 1)) * Math.PI;
        parts.push({ k: "dust", x, y, vx: Math.cos(a) * spread * (0.6 + Math.random() * 0.6), vy: Math.sin(a) * spread * 0.35 - 6, life: 0, max: 0.5 + Math.random() * 0.25, r: 2.2 + Math.random() * 2.4, col });
      }
    }
    function sprout(x, s) {
      I.tufts.push({ x, f: 0.2 + Math.random() * 0.6, s, born: now, kind: Math.random() < 0.35 ? "flower" : "grass" });
      if (I.tufts.length > 60) I.tufts.shift();
    }
    function landPiece(p, s) {
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
        return;
      }
      haptic("medium");
      if (type === "hill") {
        hillGrow.push({ x: p.x, t: 0, prev: 0, amp: 24 });
        mine.hills.push(p.x);
        puff(p.x, s.y, 9, PR.sand, 70);
        SFX.grow();
        for (let i = 0; i < 4; i++) sprout(p.x + (Math.random() - 0.5) * 50, 0.8 + Math.random() * 0.5);
        return;
      }
      const r = resolve(type, p.x, s);
      let level = 0, yRel;
      if (r.onto) { r.onto.roof = false; level = r.onto.level + 1; yRel = r.onto.yRel - HOUSE.wall; }
      else {
        if (type !== "tree") levelPlot(r.x, (type === "house" ? HOUSE.w / 2 : 11) + 1);
        yRel = standY(r.x) - baseY();
      }
      const o = { id: nextId++, type, x: r.x, slideFrom: p.x, yRel, w: DEF[type].w, level, roof: true, variant: p.variant, born: now, litDelay: 0, bloomAt: -1 };
      I.objects.push(o);
      puff(r.x, baseY() + yRel, 7, r.onto ? PR.wall : PR.sand, 50);
      if (!r.onto && type !== "lighthouse") { sprout(r.x - o.w / 2 - 6, 0.8); sprout(r.x + o.w / 2 + 6, 0.9); }
      SFX.land(r.x, level, type);
    }

    // ---------------------------------------------------------- run control
    function beginRun(first) {
      attempt++;
      const sd = first ? 20261120 : Math.floor(Math.random() * 1e9);
      mine = islandShape(sd);
      I = mine;
      rng = mulberry(sd ^ 0x5bd1);
      islets = [
        { x: 58 + rng() * 20, kind: "rock", w: 18, h: 9, t: rng() * 10, born: -9 },
        { x: 330 + rng() * 24, kind: "rock", w: 26, h: 11, t: rng() * 10, born: -9 }
      ];
      parts = []; rings = []; hillGrow = [];
      queue = newQueue(first);
      qi = 0; placed = 0; missCount = 0;
      risen = false; riseK = 0; dusk = 0; lampK = 0; finaleStart = -1; finaleCam = null;
      plateAt = captureAt = likeAt = worldAt = -1;
      frameSnap = 0; likeGlow = 0; swipeHint = -1;
      cam.y = 400; cam.zoom = 1;
      cur = null; threadCut = null; wait = 0;
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
        for (let i = 0; i < 4; i++) rings.push({ x: (I.edgeL + I.edgeR) / 2 + (i - 1.5) * 18, y: Y0, r: (I.edgeR - I.edgeL) * 0.5, life: -i * 0.2, max: 1.8, w: 1.4, grow: 90 });
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
    // Like, then capture, then the shared world and scrolling for more.
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
    // control: swipe right likes, swipe left captures. The Bit teaches these and
    // reacts when the host reports them; names are matched loosely on purpose.
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
      // The host takes the first tap to enter play: that tap means "play", so the house drops.
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
      const span = Math.max(1, mine.edgeR - mine.edgeL);
      for (const o of mine.objects) if (o.type === "tree" && o.bloomAt < 0) o.bloomAt = now + ((o.x - mine.edgeL) / span) * 0.7;
      for (const t of mine.tufts) if (t.kind === "flower") t.bloom = now + ((t.x - mine.edgeL) / span) * 0.7;
      likeGlow = 1;
      gulls.forEach((gl, i) => {
        gl.mode = "circle"; gl.t = 0;
        gl.cx = (mine.edgeL + mine.edgeR) / 2; gl.cy = baseY() - 120;
        gl.rad = 70 + i * 16; gl.ang = (i / gulls.length) * TAU;
        gl.x = lerp(mine.edgeL, mine.edgeR, (i + 0.5) / gulls.length); gl.y = baseY() - 30;
      });
      for (let i = 0; i < 44; i++) {
        const x = lerp(mine.edgeL, mine.edgeR, Math.random());
        parts.push({ k: "petal", x, y: frontY(x) - 20 - Math.random() * 20, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 40, life: -Math.random() * 0.7, max: 2.2, r: 2 + Math.random() * 2, rot: Math.random() * TAU });
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
      if (phase === "outro" && outro.step === "scroll") return; // decided on release: a tap or a scroll
      echo.push({ x: px, y: py, t: realNow });
      SFX.echo();
      scatterGulls(px, py);
      if (phase === "outro") outro.cycle0 = realNow;
    }
    function onUp(ev) {
      if (!downAt) return;
      const r = canvas.getBoundingClientRect();
      const dx = ev.clientX - r.left - downAt.x, dy = ev.clientY - r.top - downAt.y;
      const dt = realNow - downAt.t;
      downAt = null;
      if (phase !== "outro" || outro.step !== "scroll") return;
      if (dy < -40 && Math.abs(dy) > Math.abs(dx)) { swipeHint = realNow; return; } // a scroll the host did not take
      if (dt < 0.35 && Math.hypot(dx, dy) < 12 && outro.t > 2.5) replay();
    }
    ctx.listen(canvas, "pointerdown", onDown, { passive: false });
    ctx.listen(canvas, "pointerup", onUp);
    function scatterGulls(px, py) {
      for (const gl of gulls) {
        if (gl.mode !== "drift") continue;
        const gx = sx(gl.x), gy = sy(gl.y);
        if (Math.hypot(gx - px, gy - py) < 140) { gl.vx = Math.sign(gx - px || 1) * 60; gl.vy = -40; gl.t = 0; gl.mode = "scatter"; }
      }
    }

    // --------------------------------------------------------------- update
    const FINALE_ZOOM = 0.88;
    function plateBottomPx() { return area.top + 40 + 96; }
    function solveFinaleCam() {
      let tallest = baseY();
      for (let k = 0; k < N; k++) if (I.land[k] > 2.5) tallest = Math.min(tallest, baseY() - I.land[k] - 16);
      for (const o of I.objects) tallest = Math.min(tallest, baseY() + o.yRel - DEF[o.type].h);
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
      if (welcomeOut >= 0) welcomeK = 1 - sat((realNow - welcomeOut) / 0.7);

      if (cur) {
        if (cur.state === "lower" || cur.state === "swing") {
          cur.t += dt;
          if (cur.state === "lower" && cur.t > 0.85) cur.state = "swing";
          jiggle *= Math.exp(-4 * rdt);
        } else if (cur.state === "fall") {
          let acc = dt, s = null;
          while (acc > 0 && !s) { const h = Math.min(acc, 1 / 120); s = fallStep(cur, h); acc -= h; }
          if (s) { landPiece(cur, s); cur = null; afterLanding(); }
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
        addHill(hg.x, hg.amp * (e - hg.prev), true);
        hg.prev = e;
        if (hg.t >= 0.5) { hillGrow.splice(k, 1); reground(true); }
      }

      if (phase === "rise") {
        const lt = E.inOut(win(phaseT, 0.55, 2.9));
        mine.lift = 300 * lt;
        riseK = lt;
        cam.shake = phaseT < 0.7 ? 2.2 * (1 - phaseT / 0.7) : phaseT < 2.9 ? 0.6 : 0;
        if (phaseT > 0.5 && phaseT < 3.3 && Math.random() < 0.9) {
          const x = lerp(I.edgeL + 6, I.edgeR - 6, Math.random());
          parts.push({ k: "drip", x, y: baseY() + depthAt(x) * (0.3 + Math.random() * 0.7), vx: 0, vy: 40 + Math.random() * 60, life: 0, max: 1.2, r: 3 + Math.random() * 5 });
        }
        if (phaseT > 3.4) {
          risen = true;
          cam.shake = 0;
          if (A.seaFilter) { A.seaFilter.frequency.setTargetAtTime(900, A.ac.currentTime, 1); A.sea.gain.setTargetAtTime(0.03, A.ac.currentTime, 1); }
          setPhase("play");
          wait = 0.1;
        }
      }
      if (risen) mine.bob = Math.sin(now * 1.15) * 3.2;
      cam.y = 400 - 0.8 * mine.lift;
      cam.zoom = 1;

      if (phase === "finale" || phase === "outro") {
        const ft = now - finaleStart;
        lampK = ft < 0.25 ? 0 : ft < 0.32 ? 1 : ft < 0.42 ? 0.15 : ft < 0.5 ? 1 : ft < 0.58 ? 0.4 : sat(ft - 0.5) * 0.4 + 0.6;
        if (ft > 0.48 && ft - dt <= 0.48) { SFX.lamp(); haptic("success"); }
        dusk = E.inOut(win(ft, 0.4, 2.7));
        const ck = E.inOut(win(ft, 0.8, 2.9));
        if (finaleCam === null) finaleCam = solveFinaleCam();
        cam.y = lerp(400 - 0.8 * mine.lift, finaleCam.y, ck);
        cam.zoom = lerp(1, finaleCam.zoom, ck);
        if (worldAt >= 0) {
          // Pull back: your island among everyone's.
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
      likeGlow = Math.max(0, likeGlow - rdt * 0.55);
      flash = Math.max(0, flash - rdt * 2.6);

      // Ghost-tap demonstration on the hanging piece while waiting for a release.
      if (cur && (cur.state === "swing" || cur.state === "lower") && (phase === "intro" || phase === "play")) {
        const idle = realNow - Math.max(lastInput, cur.spawnReal);
        if (idle > (phase === "intro" ? 1.4 : 4.5) && realNow - demoT > (phase === "intro" ? 3.2 : 4.2)) {
          demoT = realNow;
          ctx.timeout(() => { jiggle = 1; }, 380);
        }
      }

      for (const c of clouds) { c.x += c.v * dt * (c.layer === "front" ? 1 : 0.6); if (c.x > 470) c.x = -80 - Math.random() * 40; }
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
          gl.x += gl.vx * dt; gl.y += gl.vy * dt; gl.vy += 30 * dt;
          if (gl.t > 1.4) { gl.mode = "drift"; gl.vx = Math.sign(gl.vx) * 18; gl.vy = 0; }
        } else if (gl.mode === "circle") {
          gl.ang += dt * 0.9;
          const k = sat(gl.t / 1.6);
          const tx = gl.cx + Math.cos(gl.ang) * gl.rad, ty = gl.cy + Math.sin(gl.ang) * gl.rad * 0.35;
          gl.x = lerp(gl.x, tx, 1 - Math.exp(-dt * (1 + k * 3)));
          gl.y = lerp(gl.y, ty, 1 - Math.exp(-dt * (1 + k * 3)));
          if (gl.t > 6) { gl.mode = "drift"; gl.vx = (Math.random() < 0.5 ? -1 : 1) * 18; }
        }
      }
    }

    function updateOutro(rdt) {
      outro.t += rdt;
      if (outro.wait > 0) { outro.wait -= rdt; if (outro.wait <= 0) { outro.wait = 0; nextOutro(); } return; }
      const patience = chromeAlive ? 11 : 8; // a cue gives way if ignored; nobody gets stuck
      const s = outro.step;
      if (s === "like" && outro.t > patience) { passed.like = true; nextOutro(); }
      else if (s === "plate" && outro.t > 1.0) nextOutro();
      else if (s === "capture" && outro.t > patience) { passed.capture = true; nextOutro(); }
      else if (s === "artefact" && outro.t > 1.7) nextOutro();
      else if (s === "world" && outro.t > 3.4) nextOutro();
      if (outro.step === "scroll") {
        // While the scroll gesture is demonstrated, the world nudges up as if scrolled.
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
        phase = "play";
        phaseT = 0;
        wait = 0.5;
        outro.step = "like";
        peek = 0;
      }
      if (swap.t >= 1.05) swap = null;
    }

    // --------------------------------------------------------------- drawing
    function poly(pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill(); }
    function splitFill(path, lit, shade, splitX) {
      g.fillStyle = lit; path(); g.fill();
      g.save(); g.beginPath(); g.rect(splitX, -400, 400, 800); g.clip();
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

    function drawSky() {
      const hy = sy(Y0);
      const grd = g.createLinearGradient(0, 0, 0, Math.max(hy, 10));
      grd.addColorStop(0, P.skyTop);
      grd.addColorStop(1, P.skyLow);
      g.fillStyle = grd;
      g.fillRect(0, -40, W, H + 80);
      if (dusk > 0.05) {
        for (const s of stars) {
          const a = dusk * (0.55 + 0.45 * Math.sin(realNow * 1.3 + s.ph));
          g.fillStyle = "rgba(250,244,226," + Math.min(1, a).toFixed(3) + ")";
          g.fillRect(s.x * W, s.y * H, s.s * 1.3, s.s * 1.3);
        }
      }
      const wk = worldAt >= 0 ? E.inOut(sat((realNow - worldAt) / 2.6)) : 0;
      const mx = W / 2 + (100 + dusk * 8 + wk * 70) * S, my = Math.max(area.top + 120 + 40 * S, H / 2 + (205 - (400 + (cam.y - 400) * 0.2)) * S + dusk * 78 * S - wk * 120 * S) + peek * 0.3;
      g.fillStyle = rgba(PR.sun, 0.55 + dusk * 0.35);
      g.beginPath();
      g.arc(mx, my, (44 - dusk * 8) * S, 0, TAU);
      g.fill();
    }

    function pushCam(f) {
      g.save();
      const shx = cam.shake ? (Math.random() - 0.5) * cam.shake * 2 : 0;
      const shy = cam.shake ? (Math.random() - 0.5) * cam.shake * 2 : 0;
      g.translate(W / 2 + shx, H / 2 + shy + peek * (0.4 + 0.6 * f));
      g.scale(cam.zoom * S, cam.zoom * S);
      g.translate(-cam.x, -(400 + (cam.y - 400) * f));
    }

    function drawHorizon() {
      pushCam(0.35);
      g.fillStyle = P.farDark;
      poly([[-120, Y0 + 1], [-60, Y0 - 16], [-10, Y0 - 9], [30, Y0 + 1]]);
      poly([[300, Y0 + 1], [350, Y0 - 12], [380, Y0 - 20], [440, Y0 - 6], [520, Y0 + 1]]);
      g.restore();
    }

    // Other people's islands. Far and hazy at first; gathered close at the end.
    function otherPlacement(i) {
      const sl = SLOTS[i];
      const fy = 400 + (cam.y - 400) * 0.35;
      const fx = W / 2 + (sl.far[0] - 200) * cam.zoom * S;
      const fyy = H / 2 + (sl.far[1] - fy) * cam.zoom * S + peek * 0.5;
      const fs = sl.far[2] * cam.zoom * S;
      const wk = worldAt >= 0 ? E.inOut(sat((realNow - worldAt - 0.2) / 2.4)) : 0;
      const ux = (mine.edgeL + mine.edgeR) / 2, uy = baseY() - 10;
      const nx = sx(ux + sl.near[0]), ny = sy(uy + sl.near[1]);
      const ns = sl.near[2] * cam.zoom * S;
      return { x: lerp(fx, nx, wk), y: lerp(fyy, ny, wk), s: lerp(fs, ns, wk), k: wk };
    }
    function drawOthers() {
      const fogCol = mixArr(basePR.skyLow, basePR.skyTop, 0.35);
      for (let i = 0; i < others.length; i++) {
        const o = others[i];
        const pl = otherPlacement(i);
        const bob = Math.sin(realNow * 0.7 + o.ph) * 3 * pl.s;
        g.save();
        g.translate(pl.x, pl.y + bob);
        g.scale(pl.s, pl.s);
        g.translate(-200, -Y0);
        const save = I;
        I = o.model;
        try { withFog(lerp(0.72, 0.12, pl.k) + (i % 2) * 0.05, fogCol, () => drawIsland(true)); }
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
        const save = I;
        I = o.model;
        const under = (Y0 + depthAt((I.edgeL + I.edgeR) / 2) - Y0) * 0.55 + 14;
        I = save;
        g.fillStyle = inkFor(0.72 * a);
        tracked("@" + o.name.toUpperCase(), pl.x, pl.y + under * pl.s + 12, 1.4, "center");
      }
    }

    function cloudShape(c) {
      const s = c.s;
      g.fillStyle = P.cloud;
      g.beginPath();
      g.arc(c.x - 22 * s, c.y - 6 * s, 14 * s, 0, TAU);
      g.arc(c.x, c.y - 14 * s, 20 * s, 0, TAU);
      g.arc(c.x + 24 * s, c.y - 7 * s, 15 * s, 0, TAU);
      g.rect(c.x - 36 * s, c.y - 8 * s, 74 * s, 8 * s);
      g.fill();
      g.fillStyle = P.cloudShade;
      g.fillRect(c.x - 36 * s, c.y - 3 * s, 74 * s, 3 * s);
    }
    function drawClouds(layer, alpha) {
      if (alpha <= 0.01) return;
      g.globalAlpha = alpha;
      for (const c of clouds) if (c.layer === layer) cloudShape(c);
      g.globalAlpha = 1;
    }

    function drawSea() {
      const bot = cam.y + H / 2 / (cam.zoom * S) + 60;
      g.fillStyle = P.sea;
      g.fillRect(-600, Y0, 1600, bot - Y0 + 400);
      g.fillStyle = P.seaDeep;
      g.fillRect(-600, Y0 + 150, 1600, bot + 400);
      g.strokeStyle = rgba(PR.seaLine, 0.7);
      g.lineWidth = 1.1;
      for (let i = 0; i < 9; i++) {
        const y = Y0 + 12 + i * 17 + (i % 3) * 3;
        const x = ((i * 97 + realNow * (6 + (i % 4) * 3)) % 520) - 60;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 26 + (i % 3) * 14, y); g.stroke();
      }
    }
    function drawHalo() {
      const k = 1 - riseK;
      if (k <= 0.01 || I.edgeR <= I.edgeL) return;
      const l = I.edgeL, r = I.edgeR, m = (l + r) / 2;
      g.globalAlpha = k;
      g.fillStyle = P.shallow;
      poly([[l - 16, Y0], [l - 4, Y0 + 9], [m - 30, Y0 + 15], [m + 34, Y0 + 14], [r + 6, Y0 + 9], [r + 18, Y0]]);
      g.fillStyle = rgba(PR.seaDeep, 0.55);
      g.beginPath();
      g.moveTo(l, Y0 + 1);
      for (let x = l; x <= r; x += DX) g.lineTo(x, Y0 + 1 + hAt(x) * 0.45);
      g.lineTo(r, Y0 + 1);
      g.fill();
      g.strokeStyle = rgba(PR.seaLine, 0.9);
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(l - 30, Y0 + 1); g.lineTo(l - 14, Y0 + 15); g.lineTo(m - 20, Y0 + 24); g.lineTo(m + 44, Y0 + 22); g.lineTo(r + 16, Y0 + 15); g.lineTo(r + 34, Y0 + 1);
      g.stroke();
      g.globalAlpha = 1;
    }
    function drawRings() {
      for (const r of rings) {
        if (r.life < 0) continue;
        const k = r.life / r.max, rad = r.r + k * (r.grow || 34);
        g.strokeStyle = rgba(PR.seaLine, (1 - k) * 0.9);
        g.lineWidth = r.w;
        g.beginPath(); g.ellipse(r.x, r.y + 1, rad, rad * 0.22, 0, 0, TAU); g.stroke();
      }
    }
    function drawIslets() {
      for (const it of islets) {
        const bob = Math.sin(now * 1.6 + it.t) * 1.2;
        const sink = it.born > 0 ? (1 - E.out(sat((now - it.born) / 0.6))) * 10 : 0;
        g.save();
        g.translate(it.x, Y0 + bob + sink);
        const w = it.w, h = it.h;
        splitFill(() => { g.beginPath(); g.moveTo(-w / 2, 1); g.quadraticCurveTo(-w * 0.2, -h * 1.3, w * 0.1, -h); g.quadraticCurveTo(w * 0.35, -h * 0.9, w / 2, 1); g.closePath(); }, P.sand, P.sandDark, w * 0.08);
        if (it.kind !== "rock") {
          g.fillStyle = P.grass;
          g.beginPath(); g.moveTo(-w * 0.32, -h * 0.55); g.quadraticCurveTo(-w * 0.1, -h * 1.15, w * 0.1, -h * 0.98); g.quadraticCurveTo(w * 0.3, -h * 0.85, w * 0.34, -h * 0.5); g.closePath(); g.fill();
        }
        if (it.kind === "house") drawHouseAt(0, -h * 0.85, { level: 0, roof: true, variant: it.variant, lit: dusk });
        else if (it.kind === "tree") drawTreeAt(0, -h * 0.85, it.variant, 0);
        else if (it.kind === "lighthouse") drawLighthouseAt(0, -h * 0.85, lampK);
        g.restore();
        g.strokeStyle = rgba(PR.seaLine, 0.8);
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(it.x - it.w * 0.75, Y0 + 3); g.lineTo(it.x - it.w * 0.2, Y0 + 7); g.lineTo(it.x + it.w * 0.55, Y0 + 6); g.lineTo(it.x + it.w * 0.85, Y0 + 2); g.stroke();
      }
    }
    function litFor(o) {
      if (o.other) return dusk;
      if (finaleStart < 0) return 0;
      return sat((now - finaleStart - (o.litDelay || 1.6)) / 0.35);
    }

    // The island: underside, front cliff, top surface, then what stands on it.
    function drawIsland(isOther) {
      const b = baseY();
      const DXS = isOther ? DX * 4 : DX;
      if (I.edgeR <= I.edgeL) return;
      const L = I.edgeL, R = I.edgeR;
      if (I.lift > 1 || isOther) {
        g.fillStyle = P.rock;
        g.beginPath();
        g.moveTo(L, b);
        for (let x = L; x <= R; x += DXS) g.lineTo(x, b + depthAt(x));
        g.lineTo(R, b);
        g.closePath();
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = P.rockDark;
        g.beginPath();
        g.moveTo(I.peakX, b - 2);
        for (let x = I.peakX; x <= R + DX; x += DXS) g.lineTo(x, b + depthAt(Math.min(x, R)) + 2);
        g.lineTo(R + 4, b - 2);
        g.closePath();
        g.fill();
        g.fillStyle = rgba(PR.rockDark, 0.55);
        g.beginPath();
        for (let x = L; x <= R; x += DXS) g.lineTo(x, b + depthAt(x) * 0.42);
        for (let x = R; x >= L; x -= DXS) g.lineTo(x, b + depthAt(x) * 0.48 + 3);
        g.closePath();
        g.fill();
        g.restore();
        if (!isOther) {
          g.strokeStyle = rgba(PR.trunk, 0.85);
          g.lineWidth = 1;
          for (let i = 0; i < 9; i++) {
            const x = lerp(L + 14, R - 14, (i + 0.5) / 9), y0 = b + depthAt(x) - 1, len = 10 + ((i * 37) % 23), sw = Math.sin(realNow * 0.9 + i) * 2.4;
            g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + sw * 0.5, y0 + len * 0.5, x + sw, y0 + len); g.stroke();
          }
        }
      }
      // Front cliff.
      g.fillStyle = P.sand;
      g.beginPath();
      g.moveTo(L - 1, b + 2);
      for (let x = L; x <= R; x += DXS) g.lineTo(x, b - hAt(x));
      g.lineTo(R + 1, b + 2);
      g.closePath();
      g.fill();
      g.save();
      g.clip();
      g.fillStyle = P.sandDark;
      g.fillRect(I.peakX, b - 80, 400, 90);
      g.fillStyle = P.sandDark;
      g.fillRect(L - 2, b - 4, R - L + 4, 8);
      g.restore();
      // Top surface: a beach ring around the grass, receding behind the front edge.
      g.fillStyle = P.sand;
      g.beginPath();
      for (let x = L; x <= R; x += DXS) g.lineTo(x, b - hAt(x));
      for (let x = R; x >= L; x -= DXS) g.lineTo(x, b - hAt(x) - band(x));
      g.closePath();
      g.fill();
      const gl = L + 9, gr = R - 9;
      if (gr > gl) {
        g.beginPath();
        for (let x = gl; x <= gr; x += DXS) { const bd = band(x); g.lineTo(x, b - hAt(x) - bd * 0.12); }
        for (let x = gr; x >= gl; x -= DXS) { const bd = band(x); g.lineTo(x, b - hAt(x) - bd * 0.86); }
        g.closePath();
        g.fillStyle = P.grassLit;
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = rgba(PR.grassDark, 0.55);
        g.fillRect(I.peakX + 4, b - 120, 400, 140);
        g.restore();
      }
      // Front lip.
      g.strokeStyle = P.grassDark;
      g.lineWidth = 1.4;
      g.beginPath();
      for (let x = gl; x <= gr; x += DXS) g.lineTo(x, b - hAt(x) - band(x) * 0.12);
      g.stroke();
      // Tufts and flowers across the surface.
      for (const t of isOther ? [] : I.tufts) {
        const k = t.born < 0 ? 1 : E.back(sat((now - t.born) / 0.45));
        if (k <= 0 || !isLand(t.x)) continue;
        const y = b - hAt(t.x) - band(t.x) * (0.15 + t.f * 0.7) + 1;
        const s = t.s * k;
        if (t.kind === "grass") {
          g.fillStyle = P.grassDark; poly([[t.x - 4 * s, y], [t.x - 1.5 * s, y - 7 * s], [t.x, y]]);
          g.fillStyle = P.grass; poly([[t.x - 1 * s, y], [t.x + 1.5 * s, y - 9 * s], [t.x + 4 * s, y]]);
        } else {
          const bl = t.bloom ? sat((now - t.bloom) / 0.4) : 0;
          g.strokeStyle = P.grassDark; g.lineWidth = 0.9;
          g.beginPath(); g.moveTo(t.x, y); g.lineTo(t.x, y - 6 * s); g.stroke();
          g.fillStyle = bl > 0 ? mixRgb(CREAM, BLOSSOM, bl) : "#f6efe0";
          g.beginPath(); g.arc(t.x, y - 6.5 * s, 1.7 * s * (1 + bl * 0.6), 0, TAU); g.fill();
        }
      }
      // Trees stand behind buildings; buildings in placement order so stacks build up.
      const sorted = I.objects.slice().sort((a, c) => (a.type === "tree" ? 0 : 1) - (c.type === "tree" ? 0 : 1));
      for (const o of sorted) drawObject(o, b);
    }

    function squashFor(o) {
      const t = now - o.born;
      if (t > 0.8 || t < 0) return [1, 1];
      const k = Math.exp(-t * 9) * Math.cos(t * 26);
      return [1 + 0.16 * k, 1 - 0.2 * k];
    }
    function drawObject(o, b) {
      const [ssx, ssy] = squashFor(o);
      const st = now - o.born;
      const x = o.slideFrom !== undefined && st < 0.22 && st >= 0 ? lerp(o.slideFrom, o.x, E.out(st / 0.22)) : o.x;
      const y = b + o.yRel;
      // Contact shadow on the ground.
      if (o.level === 0) {
        g.fillStyle = rgba(PR.shadow, 0.22);
        g.beginPath();
        g.ellipse(x + 3, y + 0.5, o.w * 0.62, 2.6, 0, 0, TAU);
        g.fill();
      }
      g.save();
      g.translate(x, y);
      g.scale(ssx, ssy);
      if (o.type === "house") drawHouseAt(0, 0, { level: o.level, roof: o.roof, variant: o.variant, lit: litFor(o) });
      else if (o.type === "tree") drawTreeAt(0, 0, o.variant, o.bloomAt >= 0 ? sat((now - o.bloomAt) / 0.5) : 0);
      else if (o.type === "lighthouse") drawLighthouseAt(0, 0, o.other ? dusk : lampK);
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
        g.fillStyle = P.roofShade; g.fillRect(4, -12, 7, 12);
        g.fillStyle = glass; g.fillRect(6.3, -10, 2.4, 3);
      } else if ((o.variant || 0) === 1) g.fillRect(-12, -15, 24, 5);
      else { g.fillRect(-11, -16, 6, 7); g.fillRect(5, -16, 6, 7); }
      if (o.level > 0) { g.fillStyle = P.wallShade; g.fillRect(-w / 2, -1.2, w, 1.2); }
      if (o.roof) {
        g.fillStyle = P.roof;
        poly([[-w / 2 - 2.5, -wall], [w / 2 + 2.5, -wall], [0, -wall - roof]]);
        g.fillStyle = P.roofShade;
        poly([[0, -wall - roof], [w / 2 + 2.5, -wall], [w / 2 + 2.5 + d, -wall - d * 0.55], [d, -wall - roof - d * 0.55]]);
      }
      g.restore();
    }
    function treeColors(v) { return v === "round" ? [PR.treeB, PR.treeBS] : v === "cone" ? [PR.treeC, PR.treeCS] : [PR.treeA, PR.treeAS]; }
    function drawTreeAt(x, y, variant, bloom) {
      const [c1, c2] = treeColors(variant);
      const lit = bloom > 0 ? mixRgb(c1, BLOSSOM, bloom) : "rgb(" + c1.join(",") + ")";
      const sh = bloom > 0 ? mixRgb(c2, BLOSSOM_S, bloom) : "rgb(" + c2.join(",") + ")";
      g.save();
      g.translate(x, y);
      g.strokeStyle = P.trunk; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -10); g.stroke();
      if (variant === "round") {
        splitFill(() => { g.beginPath(); g.arc(0, -21, 11, 0, TAU); }, lit, sh, 1.5);
        splitFill(() => { g.beginPath(); g.arc(-5, -29, 6.5, 0, TAU); }, lit, sh, 1.5);
      } else if (variant === "cone") {
        splitFill(() => { g.beginPath(); g.moveTo(0, -42); g.lineTo(10, -7); g.lineTo(-10, -7); g.closePath(); }, lit, sh, 0);
      } else {
        splitFill(() => {
          g.beginPath(); g.moveTo(0, -42); g.bezierCurveTo(7, -30, 9, -16, 6, -7); g.quadraticCurveTo(0, -3, -6, -7); g.bezierCurveTo(-9, -16, -7, -30, 0, -42); g.closePath();
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
      g.save(); tower(); g.clip();
      g.fillStyle = P.roof; g.fillRect(-20, -22, 40, 7); g.fillRect(-20, -42, 40, 6);
      g.fillStyle = P.roofShade; g.fillRect(1, -22, 20, 7); g.fillRect(1, -42, 20, 6);
      g.restore();
      g.fillStyle = P.thread; g.fillRect(-ht - 3, -h - 2, 2 * ht + 6, 2.5);
      if (lamp > 0) { g.fillStyle = "rgba(255,214,130," + (0.35 * lamp).toFixed(3) + ")"; g.beginPath(); g.arc(0, -h - 7, 13 + 4 * lamp, 0, TAU); g.fill(); }
      g.fillStyle = lamp > 0 ? mixRgb(PR.glass, LAMP, lamp) : P.glass;
      g.fillRect(-5, -h - 11, 10, 9);
      g.fillStyle = P.roof; poly([[-7.5, -h - 11], [7.5, -h - 11], [0, -h - 20]]);
      g.restore();
    }
    function drawHillChunk() {
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
        g.strokeStyle = P.thread; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(0, -cur.def.h); g.lineTo(Math.sin(now * 20) * 2, -cur.def.h - 9); g.stroke();
        drawPieceShape(cur.type, cur.variant);
        g.restore();
        return;
      }
      const st = swingState(cur);
      if (pred) {
        const a = cur.i < 2 ? 0.9 : 0.6;
        if (pred.kind === "water") {
          g.strokeStyle = rgba(PR.seaLine, a); g.lineWidth = 1.4;
          g.beginPath(); g.ellipse(pred.x, Y0 + 2, cur.def.w * 0.55, 3.2, 0, 0, TAU); g.stroke();
        } else {
          g.fillStyle = rgba(PR.shadow, 0.26 * a);
          g.beginPath(); g.ellipse(pred.x + 2, pred.y + 0.5, cur.def.w * 0.6, 3, 0, 0, TAU); g.fill();
        }
        if (cur.i < 2) {
          g.strokeStyle = "rgba(18,60,60,0.16)";
          g.setLineDash([2, 5]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(st.bx, st.by + 4); g.lineTo(pred.kind === "water" ? pred.rawX : pred.x, pred.kind === "water" ? Y0 - 2 : pred.y - 4); g.stroke();
          g.setLineDash([]);
        }
      }
      const ca = tapCueAlpha();
      if (ca > 0) {
        const hx = st.bx + Math.sin(st.rot) * cur.def.h * 0.5, hy = st.by - cur.def.h * 0.5;
        const hr = Math.max(cur.def.w, cur.def.h) * 0.62 + 10 / (cam.zoom * S);
        const grd = g.createRadialGradient(hx, hy, hr * 0.2, hx, hy, hr * 1.25);
        grd.addColorStop(0, rgba(CREAM, 0.75 * ca));
        grd.addColorStop(1, rgba(CREAM, 0));
        g.fillStyle = grd;
        g.beginPath(); g.arc(hx, hy, hr * 1.25, 0, TAU); g.fill();
      }
      g.strokeStyle = P.thread; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(st.px, st.py); g.quadraticCurveTo((st.px + st.ax) / 2 + Math.sin(st.rot) * 6, (st.py + st.ay) / 2, st.ax, st.ay); g.stroke();
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
        if (p.k === "dust") { g.fillStyle = rgba(p.col, (1 - k) * 0.85); g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k * 0.6), 0, TAU); g.fill(); }
        else if (p.k === "drop") { g.fillStyle = "rgba(255,255,255," + (0.9 * (1 - k)).toFixed(3) + ")"; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
        else if (p.k === "drip") { g.strokeStyle = "rgba(240,250,248," + (0.85 * (1 - k * 0.5)).toFixed(3) + ")"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y + p.r); g.stroke(); }
        else if (p.k === "petal") { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = rgba(BLOSSOM, sat(1 - k) * 0.95); g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore(); }
      }
    }
    function drawGulls() {
      g.strokeStyle = P.gull; g.lineWidth = 1.5; g.lineCap = "round";
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
    function drawBeam() {
      if (lampK <= 0.01) return;
      const lh = mine.objects.find((o) => o.type === "lighthouse");
      const il = !lh ? islets.find((o) => o.kind === "lighthouse") : null;
      let lx, ly;
      if (lh) { lx = lh.x; ly = baseY() + lh.yRel - 63; }
      else if (il) { lx = il.x; ly = Y0 - il.h * 0.85 - 63; }
      else return;
      const ang = Math.sin(now * 0.55) * 1.25, dir = Math.cos(ang) >= 0 ? 1 : -1;
      const a0 = ang - 0.055, a1 = ang + 0.055, R = 900;
      g.fillStyle = "rgba(255,236,186," + (0.16 * lampK * (0.4 + dusk * 0.6)).toFixed(3) + ")";
      g.beginPath();
      g.moveTo(lx, ly);
      g.lineTo(lx + Math.cos(a0) * R * dir, ly + Math.sin(a0) * R * 0.25);
      g.lineTo(lx + Math.cos(a1) * R * dir, ly + Math.sin(a1) * R * 0.25 + 30);
      g.closePath();
      g.fill();
    }
    function drawLikeGlow() {
      const cx = (mine.edgeL + mine.edgeR) / 2, cy = baseY() - 20;
      const k = Math.sin(Math.PI * Math.min(1, (1 - likeGlow) * 1.6));
      const r = 120 + (1 - likeGlow) * 90;
      const grd = g.createRadialGradient(cx, cy, 10, cx, cy, r);
      grd.addColorStop(0, "rgba(242,152,138," + (0.42 * k).toFixed(3) + ")");
      grd.addColorStop(1, "rgba(242,152,138,0)");
      g.fillStyle = grd;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }

    // ------------------------------------------------------------ overlays
    function drawWelcome() {
      if (welcomeK <= 0.001) return;
      const k = E.out(welcomeK), top = area.top + 58, lift = (1 - k) * -14;
      const title = firstVisit ? "WELCOME TO PLETHORA" : "A LITTLE SOMETHING";
      const sub = firstVisit ? "There's a little something here." : "Make another little island.";
      g.textBaseline = "alphabetic";
      g.font = "400 " + Math.round(clamp(W * 0.122, 38, 60)) + "px " + F_DISPLAY;
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

    // The tap target is the hanging piece itself: a halo around it, a finger that
    // lands on it, and the words right beneath it.
    function tapCueAlpha() {
      if (!cur || !(cur.state === "swing" || cur.state === "lower")) return 0;
      if (phase === "intro") return sat((realNow + 0.3) / 0.4);
      if (phase !== "play") return 0;
      return sat((realNow - Math.max(lastInput, cur.spawnReal) - 4.5) / 0.5);
    }
    function drawTapCue() {
      const a = tapCueAlpha();
      if (a <= 0) return;
      const st = swingState(cur);
      const cxp = sx(st.bx - Math.sin(st.rot) * -cur.def.h * 0.5), cyp = sy(st.by - cur.def.h * 0.5);
      const R = Math.max(cur.def.w, cur.def.h) * 0.62 * cam.zoom * S + 10;
      // Two rings breathing outward from the piece (its glow is drawn behind it, in the world).
      for (let i = 0; i < 2; i++) {
        const k = ((realNow * 0.55 + i * 0.5) % 1);
        g.strokeStyle = inkFor(0.45 * (1 - k) * a);
        g.lineWidth = 1.4;
        g.beginPath(); g.arc(cxp, cyp, R + k * 22, 0, TAU); g.stroke();
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
      const off = (1 - E.out(appear)) * 26; // the finger arrives from below-right
      const r = 15 * (1 - press * 0.18);
      g.fillStyle = "rgba(255,255,255," + (0.5 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(x + off, y + off, r, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.6 * alpha);
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x + off, y + off, r, 0, TAU); g.stroke();
      if (t > 0.35) {
        const rk = win(t, 0.35, 1.2);
        g.strokeStyle = inkFor(0.55 * (1 - rk) * a);
        g.beginPath(); g.arc(x, y, 15 + rk * 34, 0, TAU); g.stroke();
      }
    }

    function drawMute() {
      if (!started) return;
      const m = muteRect(), cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      const a = phase === "outro" || phase === "finale" ? 0.55 : 0.4;
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

    // The plate: a print of the island, appearing once the viewer has liked it.
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
      g.strokeStyle = inkFor(0.5 * pk);
      g.lineWidth = 1;
      g.strokeRect(f.L + ins, f.T + ins, f.R - f.L - ins * 2, f.B - f.T - ins * 2);
      g.strokeStyle = inkFor(0.85 * pk);
      g.lineWidth = 1.4;
      const cs = 9, L = f.L + ins, R = f.R - ins, T = f.T + ins, B = f.B - ins;
      g.beginPath();
      g.moveTo(L, T + cs); g.lineTo(L, T); g.lineTo(L + cs, T);
      g.moveTo(R - cs, T); g.lineTo(R, T); g.lineTo(R, T + cs);
      g.moveTo(L, B - cs); g.lineTo(L, B); g.lineTo(L + cs, B);
      g.moveTo(R - cs, B); g.lineTo(R, B); g.lineTo(R, B - cs);
      g.stroke();
      g.fillStyle = inkFor(0.97 * pk);
      g.font = "400 " + Math.round(clamp(W * 0.118, 36, 56)) + "px " + F_DISPLAY;
      tracked("A LITTLE SOMETHING", W / 2, f.T + 58, 1.3, "center");
      g.font = "400 15px " + F_TEXT;
      g.textAlign = "center";
      g.fillStyle = inkFor(0.82 * pk);
      g.fillText("An island you made.", W / 2, f.T + 84);
      if (captureAt >= 0) {
        const ck = E.out(sat((realNow - captureAt - 0.4) / 0.6)) * pk;
        g.font = "400 9.5px " + F_MONO;
        g.fillStyle = inkFor(0.75 * ck);
        tracked(dateLabel(), R - 12, B - 12, 1.6, "right");
      }
    }

    // Host gesture demonstrations around the real logo button.
    function drawCameraIcon(x, y, a) {
      g.strokeStyle = inkFor(a); g.lineWidth = 1.5;
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
      const cx = logo.cx, cy = logo.cy, dist = 96;
      const appear = sat(t / 0.25), move = E.inOut(win(t, 0.3, 1.15)), gone = win(t, 1.7, 2.05);
      const alpha = a * appear * (1 - gone);
      const ix = cx + dir * (dist + 14);
      g.fillStyle = inkFor(0.1 * a);
      g.beginPath(); g.arc(ix, cy, 19, 0, TAU); g.fill();
      if (icon === "camera") drawCameraIcon(ix, cy, (0.45 + 0.5 * move) * a);
      else {
        heartPath(ix, cy, 1.15);
        if (move > 0.9) { g.fillStyle = "rgba(226,82,70," + (0.85 * a).toFixed(3) + ")"; g.fill(); }
        g.strokeStyle = inkFor((0.45 + 0.5 * move) * a); g.lineWidth = 1.5; g.stroke();
      }
      if (alpha <= 0) return;
      const fx = cx + dir * dist * move;
      g.strokeStyle = inkFor(0.5 * alpha);
      g.setLineDash([3, 4]); g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(cx + dir * 24, cy); g.lineTo(fx, cy); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255," + (0.3 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(fx, cy, 14, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.75 * alpha); g.lineWidth = 1.5;
      g.beginPath(); g.arc(fx, cy, 14, 0, TAU); g.stroke();
    }
    // A finger pushes the world upward: how the Bits feed is scrolled.
    function ghostScroll(t, a, bottomY) {
      const x = W - area.right - 46;
      const y0 = bottomY - 30, y1 = bottomY - 180;
      const appear = sat(t / 0.3), move = E.inOut(win(t, 0.35, 1.2)), gone = win(t, 1.6, 2.1);
      const alpha = a * appear * (1 - gone);
      if (alpha <= 0) return;
      const fy = lerp(y0, y1, move);
      g.strokeStyle = inkFor(0.45 * alpha);
      g.setLineDash([3, 4]); g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, fy); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255," + (0.32 * alpha).toFixed(3) + ")";
      g.beginPath(); g.arc(x, fy, 14, 0, TAU); g.fill();
      g.strokeStyle = inkFor(0.75 * alpha); g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, fy, 14, 0, TAU); g.stroke();
    }
    function cueLabel(line1, line2, a, y) {
      g.textAlign = "center";
      if (line1) { g.font = "600 15px " + F_TEXT; g.fillStyle = inkFor(0.95 * a); g.fillText(line1, W / 2, y); }
      g.font = "400 11px " + F_MONO;
      g.fillStyle = inkFor(0.85 * a);
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
        ghostSwipe(1, ct, a, "heart");
      } else if (outro.step === "capture") {
        cueLabel("Keep your island.", "SWIPE LEFT TO CAPTURE", a, labelY);
        ghostSwipe(-1, ct, a, "camera");
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
        g.strokeStyle = inkFor(0.4 * (1 - k)); g.lineWidth = 1.2;
        g.beginPath(); g.arc(e.x, e.y, 6 + k * 20, 0, TAU); g.stroke();
      }
    }

    function drawScene() {
      drawSky();
      drawHorizon();
      drawOthers();
      pushCam(0.6); drawClouds("back", 0.75); g.restore();
      pushCam(1);
      drawClouds("low", 0.55 + riseK * 0.4);
      drawBeam();
      if (likeGlow > 0) drawLikeGlow();
      I = mine;
      drawIsland(false);
      drawSea();
      drawHalo();
      drawRings();
      drawIslets();
      drawThreadAndPiece();
      drawParticles();
      drawGulls();
      if (riseK > 0.05) drawClouds("front", riseK * 0.92 * (worldAt >= 0 ? 0.6 : 1));
      g.restore();
      drawPlate();
    }
    // After a capture the framed island lifts off the world like a print.
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
            objects: mine.objects.length, islets: islets.length, edgeL: mine.edgeL, edgeR: mine.edgeR, others: others.map((o) => o.name), worldLoaded };
        },
        pred: () => pred,
        objects: () => mine.objects.map((o) => ({ type: o.type, x: o.x, yRel: Math.round(o.yRel * 10) / 10, level: o.level, ground: Math.round((standY(o.x) - baseY()) * 10) / 10 })),
        encode: () => encodeMine()
      };
    }
  }
};
