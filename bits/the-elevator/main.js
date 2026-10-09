/*
 * THE ELEVATOR — everyone has somewhere to be.
 *
 * A Plethora Bit (plethora-bit@2). One file, Canvas2D, no packaged assets:
 * every building, passenger and sound is generated in code.
 *
 * Module map (search for the banner to jump):
 *   1. TUNABLE VARIABLES      7. PASSENGER SYSTEM
 *   2. HELPERS                8. ROUTE / SERVICE LOGIC (doors, boarding)
 *   3. LAYOUT                 9. SCORING + COMBO
 *   4. PALETTE / WORLD GEN   10. DIFFICULTY + SPAWNING
 *   5. AUDIO                 11. CAMERA
 *   6. ELEVATOR PHYSICS      12. RENDERING   13. INPUT   14. GAME FLOW
 */
window.plethoraBit = {
  meta: {
    title: "The Elevator",
    runtime: "plethora-bit@2",
    tags: ["arcade", "strategy", "elevator", "cozy"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ======================================================================
     * 1. TUNABLE VARIABLES
     * Live values come from manifest.tuning (Plethora Draft Tools) and fall
     * back to these defaults. BRAKING_DISTANCE is derived, not stored:
     *   distance = v² / (2 · elevator_deceleration)  (≈1 floor at full speed)
     * ==================================================================== */
    const DEFAULTS = {
      elevator_max_speed: 3.4,      // floors / second at full drag
      elevator_acceleration: 5.2,   // floors / s² while speeding up
      elevator_deceleration: 6.0,   // floors / s² natural braking after release
      stop_tolerance: 0.1,          // floors of release error that still reads PERFECT
      door_open_time: 260,          // ms
      door_close_time: 230,         // ms
      passenger_board_time: 300,    // ms between passengers stepping in/out (early game)
      passenger_patience: 26,       // seconds of patience before the travel allowance
      max_capacity: 6,
      passenger_spawn_rate: 1,      // multiplier on arrival frequency
      destination_range: 14,        // longest trip (floors) once the run is busy
      combo_duration: 9,            // seconds a ROUTE combo survives between serving stops
      score_multiplier: 1,
      world_scroll_speed: 0.7,      // floors the busy part of the building climbs per passenger served
      camera_follow_speed: 6,
      missed_limit: 3
    };
    const DIFFICULTY_FALLBACK = [
      [0, 0], [15, 0.08], [35, 0.22], [60, 0.36], [120, 0.52], [200, 0.7], [300, 0.86], [420, 1]
    ];
    const CFG = {};
    function readTuning() {
      for (const id in DEFAULTS) {
        let v;
        try { v = ctx.tune ? ctx.tune.get(id) : undefined; } catch (e) { v = undefined; }
        CFG[id] = typeof v === "number" && isFinite(v) ? v : DEFAULTS[id];
      }
      CFG.max_capacity = Math.round(clamp(CFG.max_capacity, 3, 10));
      CFG.missed_limit = Math.round(clamp(CFG.missed_limit, 1, 9));
    }
    function difficultyAt(sec) {
      try {
        const c = ctx.tune && ctx.tune.curve ? ctx.tune.curve("difficulty_curve") : null;
        if (c && typeof c.at === "function") {
          const y = c.at(sec);
          if (typeof y === "number" && isFinite(y)) return clamp(y, 0, 1);
        }
      } catch (e) { /* fall through */ }
      const pts = DIFFICULTY_FALLBACK;
      if (sec <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (sec <= pts[i][0]) {
          const a = pts[i - 1], b = pts[i];
          return lerp(a[1], b[1], smooth((sec - a[0]) / (b[0] - a[0])));
        }
      }
      return pts[pts.length - 1][1];
    }

    /* ======================================================================
     * 2. HELPERS
     * ==================================================================== */
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    function approach(v, target, amt) {
      return v < target ? Math.min(v + amt, target) : Math.max(v - amt, target);
    }
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    let worldSeed = (Date.now() % 100000) | 0;
    let rng = mulberry32(worldSeed);
    function rand(a, b) { return a + (b - a) * rng(); }
    function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
    function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
    function hash(a, b) {
      let h = (a * 374761393 + b * 668265263 + worldSeed * 2246822519) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    function hex(c) {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgb(a, alpha) {
      const r = Math.round(a[0]), g2 = Math.round(a[1]), b = Math.round(a[2]);
      return alpha === undefined ? "rgb(" + r + "," + g2 + "," + b + ")"
        : "rgba(" + r + "," + g2 + "," + b + "," + alpha + ")";
    }
    function mixA(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

    readTuning();
    try { if (ctx.tune && ctx.tune.onChange) ctx.tune.onChange(Object.keys(DEFAULTS), readTuning); } catch (e) { /* optional */ }

    /* ======================================================================
     * 3. LAYOUT — portrait column; the shaft is the compositional spine.
     * ==================================================================== */
    const canvas = ctx.createCanvas2D({ maxDpr: 2, coordinateSpace: "css", alpha: false, touchAction: "none" });
    const g = canvas.getContext("2d");
    const L = {};
    function layout(info) {
      const W = (info && info.width) || ctx.width || 390;
      const H = (info && info.height) || ctx.height || 844;
      const sa = (info && info.safeArea) || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      L.W = W; L.H = H;
      L.safeTop = sa.top || 0;
      L.safeBottom = sa.bottom || 0;
      L.CW = Math.min(W, H * 0.68);
      L.X0 = (W - L.CW) / 2;
      L.U = clamp(L.CW / 390, 0.82, 1.5);
      L.FH = clamp(H / 7.6, 74, 140);
      L.slab = Math.max(6, L.FH * 0.085);
      L.shaftW = clamp(L.CW * 0.25, 88, 170);
      L.shaftL = L.X0 + L.CW * 0.275;
      L.shaftR = L.shaftL + L.shaftW;
      L.shaftCx = L.shaftL + L.shaftW / 2;
      L.cabW = L.shaftW - 14;
      L.cabH = L.FH - L.slab - 4;
      L.stripW = clamp(L.CW * 0.095, 32, 56);
      L.stripL = L.X0 + L.CW - L.stripW;
      L.roomL = L.shaftR;
      L.facadeL = L.X0 + L.CW * 0.135;
      L.anchorY = H * 0.6;
      L.ps = L.FH * 0.35; // standing passenger height in px
      L.roomU0 = (L.roomL - L.shaftCx) / L.FH;
      L.roomU1 = (L.stripL - L.shaftCx) / L.FH;
      L.cabHalfU = L.cabW / 2 / L.FH;
    }
    layout();
    ctx.onResize(layout, { immediate: true });

    const TITLE_FONT = '"Bebas Neue", "Oswald", "Arial Narrow", Impact, sans-serif';
    const UI_FONT = '"Nunito Sans", "Avenir Next", system-ui, sans-serif';
    (async () => {
      try {
        await Promise.all([
          ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }),
          ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "400" }),
          ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "700" })
        ]);
      } catch (e) { /* system fallback fonts are fine */ }
    })();

    function setSpacing(px) { if ("letterSpacing" in g) g.letterSpacing = px + "px"; }

    /* ======================================================================
     * 4. PALETTE / WORLD GENERATION
     * One continuous building. Colour keys are by altitude (floor number);
     * nothing announces a change — the light simply shifts as you climb.
     * ==================================================================== */
    const KEYS = [
      { a: 0, skyT: "#78aebb", skyB: "#f1dcb2", far: "#dcb594", far2: "#c99f80", fac: "#c97d5c", facD: "#a6634a", room: "#e2a47a", wall2: "#cf8a65", slab: "#ead6bf", shaft: "#2a2e3c", night: 0 },
      { a: 20, skyT: "#86b4c2", skyB: "#eedab8", far: "#d4b199", far2: "#c39b84", fac: "#cf8d6b", facD: "#ac6b51", room: "#e8b28c", wall2: "#d69a76", slab: "#eedcc7", shaft: "#2a2e3c", night: 0 },
      { a: 40, skyT: "#8cb9b3", skyB: "#e9e2c4", far: "#a9c1aa", far2: "#93ac97", fac: "#bb8f6d", facD: "#977150", room: "#d8c39b", wall2: "#c2ac83", slab: "#ece2cc", shaft: "#283039", night: 0 },
      { a: 54, skyT: "#c2977d", skyB: "#f5c27c", far: "#d9946e", far2: "#c27c5d", fac: "#c06d53", facD: "#9b523f", room: "#e9a374", wall2: "#d88a5f", slab: "#efd2b4", shaft: "#2b2a36", night: 0.15 },
      { a: 64, skyT: "#4c5f88", skyB: "#cc928b", far: "#7f7290", far2: "#6a5f80", fac: "#86687a", facD: "#6a5064", room: "#a8879a", wall2: "#937486", slab: "#cfbcc4", shaft: "#232536", night: 0.55 },
      { a: 74, skyT: "#1d2542", skyB: "#3d4872", far: "#38416b", far2: "#2f375d", fac: "#43496d", facD: "#30365a", room: "#585c86", wall2: "#4b4f79", slab: "#7f82a2", shaft: "#171a2a", night: 1 },
      { a: 86, skyT: "#34497a", skyB: "#8a9ec6", far: "#7086b4", far2: "#5f74a2", fac: "#7a87b2", facD: "#5f6c98", room: "#9aa6cc", wall2: "#8894bc", slab: "#c3cbe2", shaft: "#232a40", night: 0.45 },
      { a: 98, skyT: "#86a6d6", skyB: "#e3ebf6", far: "#cdd9ee", far2: "#b9c8e4", fac: "#c9d1e8", facD: "#aab5d4", room: "#e6e8f3", wall2: "#d7dbec", slab: "#f1f2f8", shaft: "#2c3350", night: 0 },
      { a: 118, skyT: "#a9b5e6", skyB: "#f7ecef", far: "#e4dcf1", far2: "#d6cbe9", fac: "#ddd5ee", facD: "#c3b8de", room: "#f0e9f4", wall2: "#e4dbee", slab: "#f8f4fa", shaft: "#353756", night: 0 }
    ];
    const KEY_FIELDS = ["skyT", "skyB", "far", "far2", "fac", "facD", "room", "wall2", "slab", "shaft"];
    for (const k of KEYS) for (const f of KEY_FIELDS) k[f] = hex(k[f]);
    const palCache = new Map();
    function palette(alt) {
      const key = Math.round(clamp(alt, 0, 130) * 4);
      let p = palCache.get(key);
      if (p) return p;
      const a = key / 4;
      let i = 0;
      while (i < KEYS.length - 2 && a > KEYS[i + 1].a) i++;
      const A = KEYS[i], B = KEYS[i + 1];
      const t = smooth((a - A.a) / (B.a - A.a));
      p = { night: lerp(A.night, B.night, t) };
      for (const f of KEY_FIELDS) { p[f + "A"] = mixA(A[f], B[f], t); p[f] = rgb(p[f + "A"]); }
      palCache.set(key, p);
      return p;
    }
    function rainAt(alt) { return smooth((alt - 70) / 5) * (1 - smooth((alt - 86) / 5)); }

    // Architecture by height: residential → shops → offices → restaurants →
    // gardens → golden luxury → night district → sky bridges → dreamlike.
    const ZONES = [0, 12, 24, 36, 48, 58, 68, 82, 96];
    function themeOf(f) {
      const j = f + (hash(f, 3) - 0.5) * 9;
      let z = 0;
      for (let i = 0; i < ZONES.length; i++) if (j >= ZONES[i]) z = i;
      if (f > 6 && f < 64 && hash(f, 4) < 0.16) z = 0; // homes appear all the way up
      return z;
    }

    // Distant skyline layers (parallax). Generated once per run.
    let farLayers = [];
    function buildFarLayers() {
      const r = mulberry32(worldSeed + 77);
      farLayers = [0.14, 0.28].map((par, li) => {
        const towers = [];
        let x = -40;
        while (x < 1600) {
          const w = 26 + r() * (li ? 46 : 60);
          towers.push({ x, w, h: (li ? 260 : 420) + r() * (li ? 520 : 900), roof: r(), win: r() });
          x += w + r() * 18;
        }
        return { par, towers };
      });
    }
    buildFarLayers();

    /* ======================================================================
     * 5. AUDIO — soft mechanical hum, cable hiss, wind that grows with
     * height, rain in the storm band, bells, doors, footsteps. All synthesised.
     * ==================================================================== */
    const audio = {
      ac: null, master: null, nodes: null, noise: null,
      init() {
        if (this.ac) { if (this.ac.state === "suspended") this.ac.resume().catch(() => {}); return; }
        if (ctx.capabilities && ctx.capabilities.audio === false) return;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ac = new AC();
          this.ac = ac;
          const master = ac.createGain(); master.gain.value = 0.65;
          const comp = ac.createDynamicsCompressor();
          master.connect(comp); comp.connect(ac.destination);
          this.master = master;
          const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          this.noise = buf;
          const loopNoise = () => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
          // motor hum
          const hum = ac.createOscillator(); hum.type = "sawtooth"; hum.frequency.value = 46;
          const hum2 = ac.createOscillator(); hum2.type = "sine"; hum2.frequency.value = 92;
          const humF = ac.createBiquadFilter(); humF.type = "lowpass"; humF.frequency.value = 170;
          const humG = ac.createGain(); humG.gain.value = 0;
          hum.connect(humF); hum2.connect(humF); humF.connect(humG); humG.connect(master);
          hum.start(); hum2.start();
          // cable hiss
          const cab = loopNoise();
          const cabF = ac.createBiquadFilter(); cabF.type = "bandpass"; cabF.frequency.value = 1300; cabF.Q.value = 2.5;
          const cabG = ac.createGain(); cabG.gain.value = 0;
          cab.connect(cabF); cabF.connect(cabG); cabG.connect(master);
          // wind
          const wind = loopNoise();
          const windF = ac.createBiquadFilter(); windF.type = "lowpass"; windF.frequency.value = 420; windF.Q.value = 0.8;
          const windG = ac.createGain(); windG.gain.value = 0;
          const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
          const lfoG = ac.createGain(); lfoG.gain.value = 160;
          lfo.connect(lfoG); lfoG.connect(windF.frequency); lfo.start();
          wind.connect(windF); windF.connect(windG); windG.connect(master);
          // rain
          const rain = loopNoise();
          const rainF = ac.createBiquadFilter(); rainF.type = "highpass"; rainF.frequency.value = 2200;
          const rainG = ac.createGain(); rainG.gain.value = 0;
          rain.connect(rainF); rainF.connect(rainG); rainG.connect(master);
          // a very quiet warm pad: the building's room tone
          const padG = ac.createGain(); padG.gain.value = 0;
          const padF = ac.createBiquadFilter(); padF.type = "lowpass"; padF.frequency.value = 900;
          padF.connect(padG); padG.connect(master);
          const pads = [220, 277.18, 329.63].map(f => {
            const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(padF); o.start(); return o;
          });
          this.nodes = { hum, hum2, humG, cabG, windG, rainG, padG, pads };
        } catch (e) { this.ac = null; }
      },
      t() { return this.ac ? this.ac.currentTime : 0; },
      set(param, v, tc) { if (param) param.setTargetAtTime(v, this.ac.currentTime, tc || 0.08); },
      lastUpd: 0,
      update(speedNorm, alt, rainAmt, running) {
        if (!this.ac || !this.nodes) return;
        if (this.ac.currentTime - this.lastUpd < 0.05) return;
        this.lastUpd = this.ac.currentTime;
        const n = this.nodes;
        const s = running ? speedNorm : 0;
        this.set(n.humG.gain, 0.012 + s * 0.05, 0.1);
        this.set(n.hum.frequency, 42 + s * 22, 0.15);
        this.set(n.hum2.frequency, 84 + s * 44, 0.15);
        this.set(n.cabG.gain, s * 0.018, 0.1);
        this.set(n.windG.gain, 0.006 + clamp(alt / 110, 0, 1) * 0.05, 0.6);
        this.set(n.rainG.gain, rainAmt * 0.05, 0.8);
        this.set(n.padG.gain, running ? 0.012 : 0.008, 1.2);
        const zone = themeOf(Math.round(alt));
        const roots = [220, 233.08, 246.94, 261.63, 196, 207.65, 174.61, 196, 233.08];
        const root = roots[zone] || 220;
        const ratios = zone >= 4 && zone <= 6 ? [1, 1.189, 1.498] : [1, 1.26, 1.498];
        n.pads.forEach((o, i) => this.set(o.frequency, root * ratios[i], 2));
      },
      bell(freq, at, dur, vol) {
        const ac = this.ac, t0 = at || ac.currentTime;
        [1, 2.01, 3.02].forEach((m, i) => {
          const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = freq * m;
          const gn = ac.createGain();
          gn.gain.setValueAtTime(0.0001, t0);
          gn.gain.exponentialRampToValueAtTime(vol / (1 + i * 2.2), t0 + 0.008);
          gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / (1 + i * 0.6));
          o.connect(gn); gn.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
        });
      },
      noiseBurst(freqA, freqB, dur, vol, type, at) {
        const ac = this.ac, t0 = at || ac.currentTime;
        const s = ac.createBufferSource(); s.buffer = this.noise;
        const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.Q.value = 1.2;
        f.frequency.setValueAtTime(freqA, t0); f.frequency.exponentialRampToValueAtTime(freqB, t0 + dur);
        const gn = ac.createGain();
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.3));
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        s.connect(f); f.connect(gn); gn.connect(this.master);
        s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02);
      },
      tone(type, fA, fB, dur, vol, at) {
        const ac = this.ac, t0 = at || ac.currentTime;
        const o = ac.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(fA, t0); o.frequency.exponentialRampToValueAtTime(fB, t0 + dur);
        const gn = ac.createGain();
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(gn); gn.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
      },
      play(name, arg) {
        if (!this.ac || this.ac.state !== "running") return;
        try {
          const t = this.ac.currentTime;
          switch (name) {
            case "ding": this.bell(1318.5, t, 1.1, 0.09); this.bell(1046.5, t + 0.16, 1.3, 0.08); break;
            case "brake": this.noiseBurst(500, 180, 0.35, 0.05 * (arg || 1), "lowpass"); break;
            case "doorOpen": this.noiseBurst(500, 1500, 0.32, 0.035, "bandpass"); break;
            case "doorClose": this.noiseBurst(1400, 500, 0.26, 0.035, "bandpass"); this.tone("square", 1900, 1700, 0.018, 0.02, t + 0.25); break;
            case "step": this.noiseBurst(1800, 1100, 0.045, 0.03, "bandpass"); this.noiseBurst(1600, 1000, 0.04, 0.022, "bandpass", t + 0.13); break;
            case "board": this.tone("sine", 660, 700, 0.12, 0.03); break;
            case "deliver": this.tone("triangle", 880, 990, 0.16, 0.035); this.tone("sine", 1320, 1320, 0.2, 0.02, t + 0.06); break;
            case "perfect": this.bell(2093, t, 0.6, 0.05); this.bell(2637, t + 0.07, 0.6, 0.035); break;
            case "combo": [0, 1, 2].forEach(i => this.tone("triangle", 523.25 * Math.pow(1.26, i + (arg || 0) * 0.5), 523.25 * Math.pow(1.26, i + (arg || 0) * 0.5), 0.14, 0.03, t + i * 0.06)); break;
            case "leave": this.tone("sine", 330, 196, 0.45, 0.06); break;
            case "milestone": [0, 4, 7, 12].forEach((s, i) => this.bell(523.25 * Math.pow(2, s / 12), t + i * 0.09, 1.2, 0.05)); break;
            case "best": [0, 7, 12].forEach((s, i) => this.bell(659.25 * Math.pow(2, s / 12), t + i * 0.1, 1.0, 0.045)); break;
            case "over": [0, -3, -7].forEach((s, i) => this.tone("triangle", 392 * Math.pow(2, s / 12), 392 * Math.pow(2, (s - 1) / 12), 0.5, 0.05, t + i * 0.18)); break;
            case "full": this.tone("square", 220, 210, 0.12, 0.02); break;
          }
        } catch (e) { /* audio is decoration */ }
      },
      suspend() { if (this.ac && this.ac.state === "running") this.ac.suspend().catch(() => {}); },
      resume() { if (this.ac && this.ac.state === "suspended") this.ac.resume().catch(() => {}); }
    };
    try {
      ctx.listen(document, "visibilitychange", () => { document.hidden ? audio.suspend() : audio.resume(); });
    } catch (e) { /* optional */ }
    ctx.onDestroy(() => { try { if (audio.ac) audio.ac.close(); } catch (e) { /* ignore */ } });

    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (e) { /* optional */ } }

    /* ======================================================================
     * GAME STATE
     * ==================================================================== */
    const scoreServed = ctx.game.score({ initial: 0, min: 0 });
    const scorePoints = ctx.game.score("points", { initial: 0, min: 0 });

    const S = {
      mode: "title",     // title | play | over
      t: 0,              // seconds of play this run
      served: 0, points: 0, misses: 0,
      chain: 0, mult: 1, comboT: 0, streak: 0,
      best: 0, bestAtStart: 0, newBestShown: false,
      nextMilestone: 0,
      overT: 0, attempt: 0,
      hint: 0,           // in-world first-run pointers: 0 drag, 1 release, 2 done
      runsThisSession: 0,
      d: 0               // current difficulty 0..1
    };
    const MILESTONES = [25, 50, 100, 150, 200, 300, 400, 500];

    let storedBest = 0;
    try {
      Promise.resolve(ctx.storage.get("best")).then(v => {
        if (typeof v === "number" && v > storedBest) { storedBest = v; if (S.mode !== "over") S.best = Math.max(S.best, v); }
      }).catch(() => {});
      Promise.resolve(ctx.storage.get("hintsDone")).then(v => { if (v === true && S.hint < 2) S.hint = 2; }).catch(() => {});
    } catch (e) { /* storage optional */ }
    function saveBest(v) { try { Promise.resolve(ctx.storage.set("best", v)).catch(() => {}); } catch (e) { /* optional */ } }

    /* ======================================================================
     * 6. ELEVATOR PHYSICS
     * Input sets a target velocity; the car accelerates toward it. On release
     * we compute where natural braking would stop (p + v|v|/2a), pick the
     * nearest floor ahead, and follow a braking profile onto it. The release
     * error decides PERFECT / GOOD / ROUGH; the car always settles exactly.
     * ==================================================================== */
    const E = {
      p: 1, v: 0, mode: "idle", target: 1, brakeA: 0,
      releaseErr: 0, releaseSpeed: 0, travel: 0,
      bounceAmp: 0, bounceT: 9, doors: 0, seq: null, lastFloor: 1,
      sway: 0
    };
    function beginBrake() {
      const dec = CFG.elevator_deceleration;
      const s = Math.sign(E.v);
      const natural = E.p + E.v * Math.abs(E.v) / (2 * dec);
      let tgt = Math.round(natural);
      if (s > 0 && tgt < E.p - 1e-4) tgt = Math.ceil(E.p - 1e-4);
      if (s < 0 && tgt > E.p + 1e-4) tgt = Math.floor(E.p + 1e-4);
      tgt = Math.max(1, tgt);
      const dist = Math.abs(tgt - E.p);
      let a = dist > 1e-4 ? (E.v * E.v) / (2 * dist) : dec;
      if (a > dec * 2.6 && s !== 0) { // cannot stop in time: carry on to the next floor
        tgt += s; a = (E.v * E.v) / (2 * Math.abs(tgt - E.p));
      }
      E.brakeA = clamp(a, dec * 0.35, dec * 2.6);
      E.target = Math.max(1, tgt);
      E.releaseErr = Math.abs(natural - E.target);
      E.releaseSpeed = Math.abs(E.v);
      E.mode = "brake";
      if (E.releaseSpeed > 1.2) audio.play("brake", clamp(E.releaseSpeed / CFG.elevator_max_speed, 0.3, 1));
    }
    function stepElevator(dt, axis) {
      if (E.seq) { stepDoors(dt, axis !== 0); return; }
      const maxV = CFG.elevator_max_speed;
      if (axis !== 0 && S.mode === "play") {
        E.mode = "drive";
        const tv = axis * maxV;
        const speedingUp = Math.sign(tv) === Math.sign(E.v) && Math.abs(tv) > Math.abs(E.v);
        const rate = speedingUp || Math.abs(E.v) < 0.05 ? CFG.elevator_acceleration : CFG.elevator_deceleration * 1.25;
        E.v = approach(E.v, tv, rate * dt);
      } else if (E.mode === "drive" || (E.mode === "idle" && Math.abs(E.p - Math.round(E.p)) > 1e-3)) {
        if (Math.abs(E.v) < 1e-3) E.v = Math.sign(Math.round(E.p) - E.p) * 1e-3;
        beginBrake();
      }
      if (E.mode === "brake") {
        const d = E.target - E.p;
        if (Math.abs(d) < 0.0015) { arrive(); return; }
        const vd = Math.sign(d) * Math.sqrt(2 * E.brakeA * Math.abs(d));
        E.v = approach(E.v, vd, E.brakeA * 3 * dt);
        const np = E.p + E.v * dt;
        if ((np - E.target) * Math.sign(d) >= 0) { E.p = E.target; arrive(); return; }
      }
      const prev = E.p;
      E.p += E.v * dt;
      if (E.p < 1) {
        E.p = 1;
        if (E.v < 0) {
          const hit = -E.v;
          E.v = 0;
          if (E.mode === "drive") { E.mode = "idle"; if (hit > 0.3) kickBounce(hit * 0.8); }
        }
      }
      E.travel += Math.abs(E.p - prev);
    }
    function kickBounce(speed) {
      E.bounceAmp = clamp(1.5 + speed * 1.6, 1.5, 9);
      E.bounceT = 0;
    }
    function arrive() {
      E.p = E.target; E.v = 0; E.mode = "idle";
      const floor = E.target;
      E.lastFloor = floor;
      const traveled = E.travel; E.travel = 0;
      let quality = "rough";
      if (E.releaseErr <= CFG.stop_tolerance) quality = "perfect";
      else if (E.releaseErr <= CFG.stop_tolerance * 2.6) quality = "good";
      kickBounce(E.releaseSpeed * (quality === "rough" ? 1.6 : 1));
      if (S.mode !== "play") return;
      const exits = riders().filter(p => p.dest === floor).length;
      const waiting = waitingOn(floor).length;
      const room = CFG.max_capacity - riders().length + exits;
      if (exits > 0 || (waiting > 0 && room > 0)) {
        startDoors(floor, traveled >= 0.9 ? quality : null);
        haptic(quality === "perfect" ? "medium" : "light");
      } else {
        if (waiting > 0) { floatText("FULL", floor, "#c4563e", 0); audio.play("full"); }
        haptic("light");
      }
    }

    /* ======================================================================
     * 7. PASSENGER SYSTEM
     * States: arriving → waiting → boarding → riding → exiting → resident
     *         (or waiting → leaving when patience runs out).
     * Position u is horizontal, in floor-height units from the shaft centre.
     * ==================================================================== */
    let pax = [];
    let paxId = 1;
    const SKIN = ["#f0d2b4", "#e2b48e", "#c48d68", "#8f5d43", "#6e4532"];
    const TOPS = ["#f4efe6", "#3d4f6b", "#7c9a86", "#d97a5f", "#e2b64f", "#5f7f9c", "#a6544a", "#efe3cf", "#4d6a5d", "#c98f7a"];
    const PANTS = ["#2f3446", "#45506a", "#5a4a42", "#3b4a44", "#6b5d55", "#d9cbb5"];
    const HAIR = ["#2a2422", "#4a3328", "#7a5a40", "#c9c2b8", "#1d1b22", "#8a4a2e"];
    const PROPS = ["none", "none", "bag", "briefcase", "backpack", "umbrella", "flowers", "box", "suitcase", "none", "groceries", "cane"];
    function makeLook(kind) {
      const look = {
        skin: pick(SKIN), top: pick(TOPS), pants: pick(PANTS), hair: pick(HAIR),
        h: rand(0.9, 1.08), w: rand(0.9, 1.12), prop: pick(PROPS), dress: rng() < 0.22,
        hairLong: rng() < 0.35, phase: rng() * 6.28
      };
      if (kind === "child") { look.h = 0.62; look.prop = "none"; look.dress = rng() < 0.4; }
      if (look.prop === "cane") { look.hair = "#d8d2c8"; look.h *= 0.95; }
      return look;
    }
    function riders() { return pax.filter(p => p.state === "riding" || p.state === "boarding"); }
    function waitingOn(floor) {
      return pax.filter(p => p.floor === floor && (p.state === "waiting" || p.state === "arriving"));
    }
    function waitingSlotsUsed(floor) {
      const used = new Set();
      for (const p of pax) if (p.floor === floor && (p.state === "waiting" || p.state === "arriving")) used.add(p.slot);
      return used;
    }
    function slotU(slot) { return L.roomU0 + 0.3 + slot * 0.21; }
    function cabinSlotU(i) {
      const perRow = 5;
      const col = i % perRow, row = Math.floor(i / perRow);
      const span = L.cabHalfU * 1.5;
      return -span / 2 + (col + row * 0.5) * (span / (perRow - 1)) - (row ? span / (perRow - 1) * 0.25 : 0);
    }
    function freeCabinSlot() {
      const used = new Set(riders().map(p => p.cslot));
      for (let i = 0; i < 10; i++) if (!used.has(i)) return i;
      return 0;
    }
    function spawnPassenger(floor, dest, opts) {
      const used = waitingSlotsUsed(floor);
      let slot = -1;
      for (let i = 0; i < 4; i++) if (!used.has(i)) { slot = i; break; }
      if (slot < 0) return null;
      const travel = Math.abs(floor - E.p) / (CFG.elevator_max_speed * 0.7) + 3;
      const p = {
        id: paxId++, floor, origin: floor, dest, state: "arriving",
        u: L.roomU1 + 0.15 + slot * 0.08, tu: slotU(slot), slot, cslot: -1,
        waited: 0, patience: CFG.passenger_patience * lerp(1.2, 0.78, S.d) + travel + (opts && opts.extraPatience || 0),
        look: makeLook(opts && opts.kind), group: opts && opts.group || 0,
        walk: 0, alpha: 0, stateT: 0, spawnT: S.t, boardT: 0, ttl: 0, sit: false
      };
      pax.push(p);
      return p;
    }
    function patienceStage(p) {
      const r = p.waited / p.patience;
      return r < 0.45 ? 0 : r < 0.72 ? 1 : 2;
    }
    function updatePassengers(dt) {
      const walkSpeed = 2.3 * (E.seq && E.seq.hurry ? 1.5 : 1);
      for (const p of pax) {
        p.stateT += dt;
        if (p.alpha < 1 && p.state !== "leaving" && p.state !== "resident") p.alpha = Math.min(1, p.alpha + dt * 3);
        switch (p.state) {
          case "arriving":
          case "waiting": {
            if (S.mode === "play") p.waited += dt;
            const du = p.tu - p.u;
            if (Math.abs(du) > 0.005) { p.u += Math.sign(du) * Math.min(Math.abs(du), dt * 1.1); p.walk += dt * 9; }
            else { p.u = p.tu; if (p.state === "arriving") p.state = "waiting"; }
            if (S.mode === "play" && p.waited >= p.patience) passengerLeaves(p);
            break;
          }
          case "boarding": {
            const tu = cabinSlotU(p.cslot);
            const du = tu - p.u;
            if (Math.abs(du) > 0.01) { p.u += Math.sign(du) * Math.min(Math.abs(du), dt * walkSpeed); p.walk += dt * 11; }
            else { p.u = tu; p.state = "riding"; p.walk = 0; }
            break;
          }
          case "exiting": {
            const du = p.tu - p.u;
            if (Math.abs(du) > 0.01) { p.u += Math.sign(du) * Math.min(Math.abs(du), dt * walkSpeed); p.walk += dt * 11; }
            else { p.u = p.tu; p.state = "resident"; p.stateT = 0; p.ttl = rand(25, 45); p.walk = 0; }
            break;
          }
          case "resident":
            if (p.stateT > p.ttl) p.alpha -= dt * 0.8;
            break;
          case "leaving":
            p.u += dt * 0.9; p.walk += dt * 8;
            if (p.stateT > 1.1) p.alpha -= dt * 1.6;
            break;
        }
      }
      // tidy: drop faded people, cap residents
      pax = pax.filter(p => !((p.state === "leaving" || p.state === "resident") && p.alpha <= 0));
      const res = pax.filter(p => p.state === "resident");
      if (res.length > 28) { res.sort((a, b) => b.stateT - a.stateT); res.slice(0, res.length - 28).forEach(p => { p.ttl = 0; }); }
    }
    function passengerLeaves(p) {
      p.state = "leaving"; p.stateT = 0;
      S.misses++; S.chain = 0; S.mult = 1; S.comboT = 0; S.streak = 0;
      floatText("✕", p.floor, "#c4563e", p.u, true);
      audio.play("leave");
      haptic("warning");
      try { ctx.platform.emit("passenger_left", { floor: p.floor, misses: S.misses }); } catch (e) { /* analytics */ }
      // the group leaves together — partners share the walk-out but only count once each
      if (S.misses >= CFG.missed_limit) gameOver();
    }

    /* ======================================================================
     * 8. ROUTE / SERVICE LOGIC — ding, doors, people, close, go.
     * ==================================================================== */
    function startDoors(floor, quality) {
      E.seq = { floor, phase: "settle", t: 0, quality, boarded: 0, delivered: 0, hurry: false, launchT: 0 };
      audio.play("ding");
    }
    function stepDoors(dt, hurry) {
      const q = E.seq;
      if (hurry) q.hurry = true;
      const k = q.hurry ? 1.8 : 1;
      q.t += dt * 1000 * k;
      if (q.phase === "settle") {
        if (q.t >= 150) {
          q.phase = "open"; q.t = 0; audio.play("doorOpen");
          serviceRating(q);
        }
      } else if (q.phase === "open") {
        E.doors = clamp(q.t / CFG.door_open_time, 0, 1);
        if (q.t >= CFG.door_open_time) { q.phase = "xchg"; q.t = 0; q.launchT = 9999; }
      } else if (q.phase === "xchg") {
        E.doors = 1;
        q.launchT += dt * 1000 * k;
        const interval = CFG.passenger_board_time * lerp(1, 0.6, S.d);
        if (q.launchT >= interval) {
          const exiting = riders().filter(p => p.state === "riding" && p.dest === q.floor);
          if (exiting.length) {
            const p = exiting[0];
            p.state = "exiting"; p.stateT = 0; p.floor = q.floor;
            p.tu = L.roomU0 + rand(0.35, Math.max(0.5, L.roomU1 - L.roomU0 - 0.25));
            q.launchT = 0; q.delivered++;
            deliver(p);
            audio.play("step");
          } else {
            const room = CFG.max_capacity - riders().length;
            const queue = waitingOn(q.floor).sort((a, b) => b.waited - a.waited);
            if (room > 0 && queue.length) {
              const p = queue[0];
              p.state = "boarding"; p.stateT = 0; p.cslot = freeCabinSlot(); p.boardT = S.t;
              q.launchT = 0; q.boarded++;
              audio.play("step"); audio.play("board");
              if (S.hint === 0 || S.hint === 1) { /* first pickup teaches by itself */ }
            } else if (!pax.some(p => p.state === "boarding" || p.state === "exiting" && p.floor === q.floor && Math.abs(p.u) < L.cabHalfU + 0.2)) {
              if (q.launchT >= interval + 120) {
                if (queue.length && room <= 0) floatText("FULL", q.floor, "#c4563e", 0);
                q.phase = "close"; q.t = 0; audio.play("doorClose");
                if (q.boarded >= 2) groupBonus(q.boarded, q.floor);
              }
            }
          }
        }
      } else if (q.phase === "close") {
        E.doors = 1 - clamp(q.t / CFG.door_close_time, 0, 1);
        if (q.t >= CFG.door_close_time) {
          E.doors = 0; E.seq = null; E.mode = "idle";
          if (S.hint === 1) { S.hint = 2; try { Promise.resolve(ctx.storage.set("hintsDone", true)).catch(() => {}); } catch (e) { /* optional */ } }
        }
      }
    }

    /* ======================================================================
     * 9. SCORING + COMBO
     * Primary score: passengers served. Points add flavour:
     *   +10 delivered, +5 perfect stop, +10 group pickup, +20 fast route,
     *   +50 every 10-passenger streak — all × ROUTE multiplier.
     * ==================================================================== */
    function addPoints(n) {
      const v = Math.round(n * S.mult * CFG.score_multiplier);
      S.points += v;
      scorePoints.set(S.points);
      return v;
    }
    function serviceRating(q) {
      try { ctx.platform.interact({ type: "stop", floor: q.floor }); } catch (e) { /* analytics */ }
      if (!q.quality) return;
      if (q.quality === "rough") {
        if (S.chain > 0) floatText("ROUGH STOP", q.floor, "#9a6a58", -0.2);
        S.chain = 0; S.mult = 1; S.comboT = 0;
        return;
      }
      S.chain++;
      S.comboT = CFG.combo_duration;
      const m = Math.min(4, 1 + Math.floor(S.chain / 3));
      if (q.quality === "perfect") {
        addPoints(5);
        floatText("PERFECT STOP", q.floor, "#fff4d6", -0.2, false, true);
        pulseT = 0;
        audio.play("perfect");
      }
      if (m > S.mult) {
        S.mult = m;
        floatText("ROUTE ×" + m, q.floor, "#f3c46b", 0.0, false, false, 0.35);
        audio.play("combo", m);
      }
    }
    function deliver(p) {
      S.served++; S.streak++;
      scoreServed.set(S.served);
      const ride = S.t - p.boardT;
      const dist = Math.abs(p.dest - p.origin);
      const expected = dist / (CFG.elevator_max_speed * 0.55) + 5;
      let pts = addPoints(10);
      audio.play("deliver");
      haptic("light");
      if (ride <= expected) { pts += addPoints(20); floatText("FAST", p.dest, "#e9d8a6", p.tu - 0.1, false, false, 0.45); }
      floatText("+" + pts, p.dest, "#fff4d6", p.tu, false, false, 0.15);
      if (S.streak > 0 && S.streak % 10 === 0) {
        addPoints(50);
        floatText("STREAK " + S.streak, p.dest, "#f3c46b", -0.1, false, true, 0.6);
      }
      if (S.hint < 2 && S.served >= 1) S.hint = 2;
      checkMilestones();
      if (!S.newBestShown && S.bestAtStart >= 5 && S.served > S.bestAtStart) {
        S.newBestShown = true;
        banner("NEW BEST", "", 2.6);
        audio.play("best");
        haptic("success");
      }
      if (S.served > S.best) S.best = S.served;
    }
    function groupBonus(n, floor) {
      addPoints(10 * (n - 1));
      floatText("GROUP PICKUP", floor, "#f6e6c4", 0.25, false, true, 0.2);
    }
    function checkMilestones() {
      const m = MILESTONES[S.nextMilestone];
      if (m && S.served >= m) {
        S.nextMilestone++;
        pullT = 0;
        banner(String(m), "PASSENGERS", 2.4);
        audio.play("milestone");
        haptic("success");
        try { ctx.platform.milestone("served_" + m, { served: S.served }); } catch (e) { /* analytics */ }
        try { ctx.fx.burst({ x: L.shaftCx, y: L.anchorY - L.cabH / 2, color: "#ffd98a", count: 18 }); } catch (e) { /* optional */ }
      }
    }

    /* ======================================================================
     * 10. DIFFICULTY + SPAWNING
     * Difficulty raises decision density (more people, longer & conflicting
     * trips, tighter patience, faster boarding) — never elevator speed.
     * The busy band of the building climbs as you serve people.
     * ==================================================================== */
    let spawnT = 0;
    let script = [];
    function bandCenter() { return 3 + S.served * CFG.world_scroll_speed; }
    function bandSpan() { return lerp(7, 18, S.d) * (CFG.destination_range / 14); }
    function spawnTick(dt) {
      // scripted opening: one person at a time while the player learns to drive
      while (script.length && S.t >= script[0].t) {
        const s = script.shift();
        spawnPassenger(s.f, s.dest, { extraPatience: 12 });
      }
      if (S.t < 11) return;
      spawnT -= dt;
      if (spawnT > 0) return;
      const interval = lerp(4.0, 1.55, S.d) / clamp(CFG.passenger_spawn_rate, 0.2, 4);
      spawnT = interval * rand(0.75, 1.25);
      const waitingNow = pax.filter(p => p.state === "waiting" || p.state === "arriving").length;
      const maxWaiting = Math.round(lerp(2.5, 10, S.d));
      if (waitingNow >= maxWaiting) return;
      const c = bandCenter(), span = bandSpan();
      const lo = Math.max(1, Math.floor(c - span * 0.5));
      const hi = Math.max(lo + 4, Math.ceil(c + span * 0.5));
      // choose an origin: near the elevator early, anywhere in the band later
      const reach = lerp(0.45, 0.05, S.d);
      const cands = [];
      let total = 0;
      for (let f = lo; f <= hi; f++) {
        if (waitingSlotsUsed(f).size >= (S.d < 0.3 ? 2 : 4)) continue;
        if (E.seq && E.seq.floor === f) continue;
        const w = 1 / (1 + Math.abs(f - E.p) * reach);
        cands.push([f, w]); total += w;
      }
      if (!cands.length) return;
      let r = rng() * total, origin = cands[0][0];
      for (const [f, w] of cands) { r -= w; if (r <= 0) { origin = f; break; } }
      // believable demand: low floors mostly travel up, high floors mostly down
      const pUp = origin <= 1 ? 1 : clamp(0.5 + (c - origin) / span * 1.1, 0.15, 0.85);
      const up = rng() < pUp;
      const maxDist = Math.max(3, Math.round(lerp(4, CFG.destination_range, S.d)));
      let dist = randInt(2, maxDist);
      let dest = origin + (up ? dist : -dist);
      if (dest < 1) dest = origin + dist;
      if (dest === origin) dest = origin + 2;
      // groups and couples become more common as the building gets busy
      const groupRoll = rng();
      let n = 1, kind = null;
      if (groupRoll < lerp(0.04, 0.26, S.d)) n = rng() < 0.7 ? 2 : 3;
      const gid = n > 1 ? paxId : 0;
      for (let i = 0; i < n; i++) {
        if (i === 1 && n === 2 && rng() < 0.35) kind = "child";
        spawnPassenger(origin, dest, { group: gid, kind });
      }
    }

    /* ======================================================================
     * 11. CAMERA — follows the car with a little look-ahead; milestones pull
     * back briefly to reveal more of the building.
     * ==================================================================== */
    let camY = 1;
    let pullT = 99;
    let pulseT = 99;
    function zoomNow() {
      if (pullT > 2.6) return 1;
      const x = pullT / 2.6;
      return 1 - 0.3 * Math.sin(Math.PI * smooth(x));
    }
    function updateCamera(dt) {
      const lead = clamp(E.v * 0.32, -1.3, 1.3);
      const target = Math.max(1.25, E.p + lead);
      const k = 1 - Math.exp(-CFG.camera_follow_speed * dt);
      camY += (target - camY) * k;
    }
    function baseY(f) { return L.anchorY - (f - camY) * L.FH; }

    /* ======================================================================
     * Floating feedback text + banners (small, elegant, never modal)
     * ==================================================================== */
    let floats = [];
    function floatText(text, floor, color, u, cross, caps, delay) {
      floats.push({ text, floor, color, u: u || 0, t: -(delay || 0), cross: !!cross, caps: !!caps });
      if (floats.length > 24) floats.shift();
    }
    let banners = [];
    function banner(big, small, dur) { banners.push({ big, small, t: 0, dur }); }

    /* ======================================================================
     * 12. RENDERING
     * ==================================================================== */
    function rr(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
    function archPath(x, y, w, h) {
      const r = w / 2;
      g.beginPath();
      g.moveTo(x, y + h);
      g.lineTo(x, y + r);
      g.arc(x + r, y + r, r, Math.PI, 0);
      g.lineTo(x + w, y + h);
      g.closePath();
    }

    function drawSky(P, time) {
      const W = L.W, H = L.H;
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, P.skyT);
      grad.addColorStop(1, P.skyB);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      const alt = camY;
      // sun / moon: sinks through golden hour, moon at night, sun again above the clouds
      const night = P.night;
      const sunR = L.CW * 0.2;
      let sunY = H * 0.62 + clamp((alt - 30) / 30, 0, 1) * H * 0.25;
      if (alt > 84) sunY = lerp(H * 0.9, H * 0.3, smooth((alt - 84) / 24));
      const sunX = L.X0 + L.CW * 0.16;
      if (night < 0.6) {
        g.fillStyle = rgb(mixA(P.skyBA, [255, 236, 200], 0.55), 0.75 * (1 - night));
        g.beginPath(); g.arc(sunX, sunY, sunR, 0, Math.PI * 2); g.fill();
      }
      if (night > 0.3) {
        // stars + moon
        g.fillStyle = "rgba(255,248,230," + (0.6 * night).toFixed(3) + ")";
        for (let i = 0; i < 46; i++) {
          const sx = hash(i, 91) * W, sy = hash(i, 92) * H * 0.7;
          const tw = 0.6 + 0.4 * Math.sin(time * 1.3 + i);
          g.globalAlpha = night * tw;
          g.fillRect(sx, sy, 1.4, 1.4);
        }
        g.globalAlpha = 1;
        g.fillStyle = "rgba(250,240,214," + (0.9 * night).toFixed(3) + ")";
        g.beginPath(); g.arc(L.X0 + L.CW * 0.18, H * 0.2, sunR * 0.32, 0, Math.PI * 2); g.fill();
        g.fillStyle = P.skyT;
        g.beginPath(); g.arc(L.X0 + L.CW * 0.18 + sunR * 0.12, H * 0.2 - sunR * 0.06, sunR * 0.28, 0, Math.PI * 2); g.fill();
      }
      // distant skyline layers: parallax so you feel how high you are
      farLayers.forEach((layer, li) => {
        const groundY = H * 0.95 + (camY - 1) * L.FH * layer.par;
        const col = li === 0 ? mixA(P.farA, P.skyBA, 0.45) : mixA(P.far2A, P.skyBA, 0.25);
        g.fillStyle = rgb(col);
        for (const t of layer.towers) {
          const top = groundY - t.h;
          if (top > H || groundY < -20) continue;
          const x = t.x * (W / 1500) * 1.1 - 10;
          g.fillRect(x, top, t.w, Math.min(H - top, t.h + 4));
          if (t.roof < 0.3) { g.beginPath(); g.moveTo(x, top); g.lineTo(x + t.w / 2, top - t.w * 0.7); g.lineTo(x + t.w, top); g.fill(); }
          else if (t.roof < 0.5) { g.beginPath(); g.arc(x + t.w / 2, top, t.w / 2, Math.PI, 0); g.fill(); }
          if (night > 0.35 && li === 1) {
            g.fillStyle = "rgba(255,214,140," + (0.55 * night).toFixed(3) + ")";
            for (let k = 0; k < 6; k++) {
              const wy = top + 10 + hash(k, t.x | 0) * Math.min(t.h, H - top) * 0.9;
              g.fillRect(x + 4 + hash(k + 9, t.x | 0) * (t.w - 8), wy, 2.5, 3);
            }
            g.fillStyle = rgb(col);
          }
        }
      });
      // a low band of cypress trees near the ground early on
      const treeY = H * 0.98 + (camY - 1) * L.FH * 0.45;
      if (treeY < H + 200) {
        g.fillStyle = rgb(mixA([92, 130, 112], P.skyBA, 0.35));
        for (let i = 0; i < 9; i++) {
          const x = (hash(i, 31) * 1.1 - 0.05) * W, h = 70 + hash(i, 32) * 90;
          g.beginPath(); g.ellipse(x, treeY - h / 2, 9 + hash(i, 33) * 6, h / 2, 0, 0, Math.PI * 2); g.fill();
        }
      }
      // sea of clouds you rise through and then above
      const cloudAlt = 90;
      const cy = L.anchorY + (camY - cloudAlt) * L.FH * 0.5;
      if (cy > -200 && cy < H + 400) {
        for (let i = 0; i < 14; i++) {
          const x = ((hash(i, 41) * 1.3 - 0.15) * W + time * (6 + hash(i, 42) * 8)) % (W * 1.3) - W * 0.15;
          const y = cy + hash(i, 43) * 70 - 20;
          const r = 40 + hash(i, 44) * 70;
          g.fillStyle = "rgba(255,255,255," + (0.55 + hash(i, 45) * 0.3).toFixed(3) + ")";
          g.beginPath(); g.ellipse(x, y, r * 1.6, r * 0.55, 0, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "rgba(255,255,255,0.75)";
        g.fillRect(0, cy + 30, W, H);
      }
      // dreamlike floating architecture high above the clouds
      if (alt > 92) {
        const k = smooth((alt - 92) / 16);
        g.fillStyle = rgb(mixA(P.far2A, P.skyBA, 0.35), 0.8 * k);
        for (let i = 0; i < 5; i++) {
          const x = L.X0 + (hash(i, 51) * 1.2 - 0.1) * L.CW;
          const y = H * (0.2 + hash(i, 52) * 0.5) + Math.sin(time * 0.3 + i) * 6;
          const w = 22 + hash(i, 53) * 30, h = 60 + hash(i, 54) * 90;
          g.fillRect(x, y, w, h);
          g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + w / 2, y - w * 1.1); g.lineTo(x + w + 4, y); g.fill();
          g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w / 2, y + h + 26); g.lineTo(x + w, y + h); g.fill();
        }
      }
    }

    function drawRain(amount, time, front) {
      if (amount <= 0.02) return;
      g.strokeStyle = "rgba(210,220,240," + ((front ? 0.28 : 0.18) * amount).toFixed(3) + ")";
      g.lineWidth = front ? 1.1 : 0.8;
      g.beginPath();
      const n = front ? 40 : 70;
      for (let i = 0; i < n; i++) {
        const sp = front ? 900 : 600;
        const x = (hash(i, front ? 61 : 62) * L.W + time * 30) % L.W;
        const y = (hash(i, front ? 63 : 64) * L.H + time * sp) % (L.H + 40) - 20;
        const len = front ? 18 : 10;
        g.moveTo(x, y); g.lineTo(x - 3, y + len);
      }
      g.stroke();
    }

    function drawGround(P) {
      const y0 = baseY(1) + L.slab;
      if (y0 > L.H) return;
      const x0 = L.X0, x1 = L.X0 + L.CW;
      // terracotta plinth with a row of arches, like a viaduct under the tower
      g.fillStyle = P.facD;
      g.fillRect(x0 - 2, y0, x1 - x0 + 4, L.H - y0 + 2);
      g.fillStyle = rgb(mixA(P.facDA, [40, 30, 30], 0.35));
      const aw = L.CW * 0.16;
      for (let i = 0; i < 6; i++) {
        const ax = x0 + L.CW * 0.04 + i * aw * 1.25;
        archPath(ax, y0 + L.FH * 0.25, aw * 0.8, L.FH * 1.2);
        g.fill();
      }
      g.fillStyle = "rgba(255,210,140,0.6)";
      for (let i = 0; i < 6; i++) {
        const ax = x0 + L.CW * 0.04 + i * aw * 1.25 + aw * 0.4;
        g.beginPath(); g.arc(ax, y0 + L.FH * 0.55, 3, 0, Math.PI * 2); g.fill();
      }
    }

    function drawFacade(f, Pcam, time) {
      const P = palette(f);
      const top = baseY(f + 1) + L.slab, bot = baseY(f);
      const xL = L.facadeL, xR = L.shaftL;
      const h = bot - top;
      const theme = themeOf(f);
      const hv = hash(f, 7);
      const airy = theme >= 7;
      // wall
      g.fillStyle = airy && hv < 0.5 ? "rgba(0,0,0,0)" : P.fac;
      if (!(airy && hv < 0.5)) g.fillRect(xL, top - L.slab, xR - xL, h + L.slab);
      else {
        // open colonnade high up
        g.fillStyle = P.fac;
        g.fillRect(xR - 10, top - L.slab, 10, h + L.slab);
        g.fillRect(xL, top - L.slab, 8, h + L.slab);
      }
      // slab / balcony floor
      g.fillStyle = P.slab;
      const bal = hv < 0.62;
      const bx = bal ? L.X0 + L.CW * 0.015 : xL;
      g.fillRect(bx, bot, xR - bx, L.slab);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(bx, bot + L.slab - 2, xR - bx, 2);
      // window / arch opening
      const ww = (xR - xL) * 0.42, wh = h * 0.68;
      const wx = xL + (xR - xL) * 0.32, wy = bot - wh;
      if (!(airy && hv < 0.5)) {
        const lit = P.night > 0.3 ? hash(f, 8) < 0.75 : hash(f, 8) < 0.3;
        archPath(wx, wy, ww, wh);
        g.fillStyle = lit ? rgb(mixA([255, 210, 140], P.roomA, 0.25)) : rgb(mixA(P.facDA, [30, 34, 50], 0.35));
        g.fill();
        if (lit) {
          g.fillStyle = "rgba(255,226,170,0.35)";
          g.fillRect(wx + ww * 0.15, bot - wh * 0.35, ww * 0.7, 2);
        }
        g.strokeStyle = P.facD; g.lineWidth = 2;
        archPath(wx, wy, ww, wh); g.stroke();
      }
      // balcony railing + plants + the odd resident on the balcony
      if (bal) {
        g.strokeStyle = rgb(mixA(P.facDA, [40, 40, 50], 0.4));
        g.lineWidth = 1.2;
        g.beginPath();
        const ry = bot - h * 0.26;
        g.moveTo(bx + 2, ry); g.lineTo(xL + 2, ry);
        for (let x = bx + 4; x < xL; x += 5) { g.moveTo(x, ry); g.lineTo(x, bot); }
        g.stroke();
        if (hash(f, 9) < 0.7) drawPlant(bx + (xL - bx) * 0.35, bot, L.FH * (0.35 + hash(f, 10) * 0.25), P, time, f, hash(f, 11) < 0.4);
        if (hash(f, 12) < 0.22) {
          const look = lookFor(f, 0);
          drawPerson(bx + (xL - bx) * 0.7, bot, L.ps * 0.85, look, { face: -1, idle: time + f, alpha: 0.95 });
        }
      } else if (hash(f, 13) < 0.5) {
        drawPlant(wx - 6, bot, L.FH * 0.32, P, time, f, false);
      }
    }
    const lookCache = new Map();
    function lookFor(f, k) {
      const key = f * 10 + k;
      let l = lookCache.get(key);
      if (!l) {
        const r = mulberry32(worldSeed + key * 13);
        l = {
          skin: SKIN[Math.floor(r() * SKIN.length)], top: TOPS[Math.floor(r() * TOPS.length)],
          pants: PANTS[Math.floor(r() * PANTS.length)], hair: HAIR[Math.floor(r() * HAIR.length)],
          h: 0.9 + r() * 0.15, w: 1, prop: "none", dress: r() < 0.3, hairLong: r() < 0.4, phase: r() * 6
        };
        lookCache.set(key, l);
        if (lookCache.size > 400) lookCache.clear();
      }
      return l;
    }

    function drawPlant(x, yb, h, P, time, seed, cypress) {
      const sway = Math.sin(time * 1.4 + seed) * 1.5;
      g.fillStyle = rgb(mixA([178, 104, 76], P.facA, 0.3));
      g.fillRect(x - h * 0.13, yb - h * 0.2, h * 0.26, h * 0.2);
      const green = P.night > 0.5 ? [60, 86, 82] : [104, 140, 104];
      g.fillStyle = rgb(green);
      if (cypress) {
        g.beginPath(); g.ellipse(x + sway * 0.5, yb - h * 0.62, h * 0.13, h * 0.44, 0, 0, Math.PI * 2); g.fill();
      } else {
        g.beginPath();
        g.arc(x + sway, yb - h * 0.52, h * 0.22, 0, Math.PI * 2);
        g.arc(x - h * 0.15 + sway * 0.7, yb - h * 0.4, h * 0.17, 0, Math.PI * 2);
        g.arc(x + h * 0.16 + sway * 0.8, yb - h * 0.38, h * 0.16, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = rgb(mixA(green, [200, 220, 170], 0.25));
        g.beginPath(); g.arc(x + sway - h * 0.06, yb - h * 0.6, h * 0.09, 0, Math.PI * 2); g.fill();
      }
    }

    function drawLampGlow(x, y, r, strength) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,214,140," + (0.55 * strength).toFixed(3) + ")");
      gr.addColorStop(1, "rgba(255,214,140,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function drawRoom(f, P, time) {
      const top = baseY(f + 1) + L.slab, bot = baseY(f);
      const x0 = L.roomL, x1 = L.stripL;
      const w = x1 - x0, h = bot - top;
      if (bot < -L.FH || top > L.H + L.FH) return;
      const theme = themeOf(f);
      const fp = palette(f);
      const night = fp.night;
      const open = theme === 4 && hash(f, 21) < 0.5 || theme === 7;
      // back wall (slight perspective: inset back plane + floor/ceiling wedges)
      const inset = Math.min(10, w * 0.06);
      g.fillStyle = fp.wall2;
      g.fillRect(x0, top, w, h);
      if (open) {
        // open terrace: the sky shows through the back
        const sg = g.createLinearGradient(0, top, 0, bot);
        sg.addColorStop(0, fp.skyT); sg.addColorStop(1, fp.skyB);
        g.fillStyle = sg;
        g.fillRect(x0 + inset, top + inset * 0.6, w - inset * 2, h - inset * 1.4);
      } else {
        g.fillStyle = rgb(mixA(fp.roomA, hash(f, 29) < 0.5 ? [255, 236, 214] : [196, 120, 96], hash(f, 30) * 0.16));
        g.fillRect(x0 + inset, top + inset * 0.6, w - inset * 2, h - inset * 1.4);
      }
      // floor plane
      g.fillStyle = rgb(mixA(fp.slabA, fp.roomA, 0.35));
      g.beginPath();
      g.moveTo(x0, bot); g.lineTo(x0 + inset, bot - inset * 0.8); g.lineTo(x1 - inset, bot - inset * 0.8); g.lineTo(x1, bot);
      g.closePath(); g.fill();
      // ceiling shadow
      g.fillStyle = "rgba(0,0,0,0.10)";
      g.fillRect(x0, top, w, 3);
      const cx = x0 + w * 0.55;
      const lampStrength = 0.35 + night * 0.65;
      switch (theme) {
        case 0: { // residential: three kinds of home
          const variant = Math.floor(hash(f, 31) * 3);
          if (variant === 1) { // arched window, little dining table under a pendant
            archPath(x0 + w * 0.56, top + h * 0.14, w * 0.26, h * 0.56);
            g.fillStyle = night > 0.5 ? "#2c3456" : rgb(mixA(fp.skyBA, [255, 240, 210], 0.3)); g.fill();
            g.strokeStyle = rgb(mixA(fp.roomA, [90, 60, 50], 0.4)); g.lineWidth = 1.5;
            archPath(x0 + w * 0.56, top + h * 0.14, w * 0.26, h * 0.56); g.stroke();
            const tx = x0 + w * 0.36;
            g.strokeStyle = "#3a3432"; g.lineWidth = 1;
            g.beginPath(); g.moveTo(tx, top); g.lineTo(tx, top + h * 0.28); g.stroke();
            drawLampGlow(tx, top + h * 0.32, h * 0.55, lampStrength);
            g.fillStyle = "#f3d38e"; g.beginPath(); g.arc(tx, top + h * 0.31, 5, Math.PI, 0); g.fill();
            g.fillStyle = "#7a5646"; g.fillRect(tx - 13, bot - h * 0.22, 26, 3); g.fillRect(tx - 1, bot - h * 0.22, 2, h * 0.22 - 3);
            g.fillRect(tx + 16, bot - h * 0.3, 2, h * 0.3 - 3); g.fillRect(tx + 16, bot - h * 0.14, 8, 2);
            drawPlant(x0 + w * 0.9, bot - 2, h * 0.5, fp, time, f, true);
            break;
          }
          if (variant === 2) { // bookshelf, sofa, a framed picture
            g.fillStyle = "#7a5646"; g.fillRect(x0 + w * 0.68, top + h * 0.2, w * 0.2, h * 0.66);
            for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) {
              g.fillStyle = TOPS[(i + r * 2 + f) % TOPS.length];
              g.fillRect(x0 + w * 0.7 + i * w * 0.033, top + h * (0.24 + r * 0.2), w * 0.024, h * 0.15);
            }
            g.fillStyle = rgb(mixA([120, 140, 120], fp.roomA, 0.2));
            rr(x0 + w * 0.3, bot - h * 0.26, w * 0.32, h * 0.26, 5); g.fill();
            g.fillStyle = "rgba(0,0,0,0.1)"; g.fillRect(x0 + w * 0.3, bot - h * 0.12, w * 0.32, 2);
            g.fillStyle = "#f2e6d4"; g.fillRect(x0 + w * 0.38, top + h * 0.2, w * 0.16, h * 0.22);
            g.fillStyle = rgb(mixA(fp.skyTA, [120, 150, 130], 0.4)); g.fillRect(x0 + w * 0.39, top + h * 0.22, w * 0.14, h * 0.18);
            if (night > 0.2) drawLampGlow(x0 + w * 0.5, top + h * 0.5, h * 0.6, lampStrength * 0.7);
            break;
          }
          const wx = x0 + w * 0.38, ww = w * 0.36, wy = top + h * 0.16, wh = h * 0.5;
          g.fillStyle = night > 0.5 ? "#2c3456" : rgb(mixA(fp.skyBA, [255, 240, 210], 0.3));
          g.fillRect(wx, wy, ww, wh);
          g.strokeStyle = rgb(mixA(fp.roomA, [90, 60, 50], 0.4)); g.lineWidth = 1.5;
          g.strokeRect(wx, wy, ww, wh);
          g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke();
          const cs = Math.sin(time * 0.9 + f) * 2;
          g.fillStyle = rgb(mixA(fp.roomA, [240, 220, 190], 0.5));
          g.beginPath(); g.moveTo(wx - 2, wy); g.lineTo(wx + ww * 0.22, wy); g.quadraticCurveTo(wx + ww * 0.12 + cs, wy + wh * 0.6, wx + ww * 0.08 + cs, wy + wh + 2); g.lineTo(wx - 2, wy + wh + 2); g.fill();
          g.beginPath(); g.moveTo(wx + ww + 2, wy); g.lineTo(wx + ww * 0.78, wy); g.quadraticCurveTo(wx + ww * 0.88 + cs, wy + wh * 0.6, wx + ww * 0.92 + cs, wy + wh + 2); g.lineTo(wx + ww + 2, wy + wh + 2); g.fill();
          drawPlant(x0 + w * 0.86, bot - 2, h * 0.42, fp, time, f, false);
          if (hash(f, 22) < 0.5) {
            drawLampGlow(x0 + w * 0.2, top + h * 0.35, h * 0.6, lampStrength);
            g.fillStyle = "#3a3432"; g.fillRect(x0 + w * 0.2 - 1, top + h * 0.35, 2, h * 0.6);
            g.fillStyle = "#f6dfae"; g.beginPath(); g.moveTo(x0 + w * 0.2 - 7, top + h * 0.4); g.lineTo(x0 + w * 0.2 + 7, top + h * 0.4); g.lineTo(x0 + w * 0.2 + 4, top + h * 0.3); g.lineTo(x0 + w * 0.2 - 4, top + h * 0.3); g.fill();
          }
          break;
        }
        case 1: { // shops: awning + shelves of goods
          const awning = [[201, 112, 88], [118, 150, 124], [96, 124, 156], [214, 170, 84]][Math.floor(hash(f, 32) * 4)];
          const sw = w / 7;
          for (let i = 0; i < 7; i++) {
            g.fillStyle = i % 2 ? "#f2e6d4" : rgb(mixA(awning, fp.roomA, 0.15));
            g.beginPath(); g.moveTo(x0 + i * sw, top + 2); g.lineTo(x0 + (i + 1) * sw, top + 2); g.lineTo(x0 + (i + 1) * sw, top + h * 0.14); g.arc(x0 + (i + 0.5) * sw, top + h * 0.14, sw / 2, 0, Math.PI); g.fill();
          }
          for (let s = 0; s < 2; s++) {
            const sy = top + h * (0.42 + s * 0.2);
            g.fillStyle = "rgba(90,60,50,0.45)"; g.fillRect(x0 + w * 0.3, sy, w * 0.6, 2);
            for (let i = 0; i < 7; i++) {
              const c = TOPS[(i * 3 + f + s) % TOPS.length];
              g.fillStyle = c; g.fillRect(x0 + w * 0.32 + i * w * 0.08, sy - 8 - (i % 3) * 2, w * 0.05, 8 + (i % 3) * 2);
            }
          }
          drawLampGlow(cx, top + h * 0.3, h * 0.7, lampStrength * 0.8);
          break;
        }
        case 2: { // offices: blinds + desks with glowing screens
          g.fillStyle = night > 0.5 ? "#2a3150" : rgb(mixA(fp.skyBA, [235, 235, 225], 0.4));
          g.fillRect(x0 + w * 0.12, top + h * 0.12, w * 0.76, h * 0.4);
          g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1;
          g.beginPath();
          for (let y = top + h * 0.12 + 3; y < top + h * 0.5; y += 4) { g.moveTo(x0 + w * 0.12, y); g.lineTo(x0 + w * 0.88, y); }
          g.stroke();
          for (let i = 0; i < 2; i++) {
            const dx = x0 + w * (0.3 + i * 0.36);
            g.fillStyle = "#5d4a40"; g.fillRect(dx - w * 0.12, bot - h * 0.3, w * 0.24, 3);
            g.fillRect(dx - w * 0.1, bot - h * 0.3, 2, h * 0.3 - 4); g.fillRect(dx + w * 0.1, bot - h * 0.3, 2, h * 0.3 - 4);
            g.fillStyle = "#2c3140"; g.fillRect(dx - 7, bot - h * 0.3 - 11, 14, 10);
            g.fillStyle = "rgba(170,210,230," + (0.5 + 0.4 * night).toFixed(2) + ")"; g.fillRect(dx - 6, bot - h * 0.3 - 10, 12, 7);
          }
          break;
        }
        case 3: { // restaurants: pendant lamps, tables, diners
          for (let i = 0; i < 2; i++) {
            const tx = x0 + w * (0.42 + i * 0.36);
            g.strokeStyle = "#3a3432"; g.lineWidth = 1;
            g.beginPath(); g.moveTo(tx, top); g.lineTo(tx, top + h * 0.3); g.stroke();
            drawLampGlow(tx, top + h * 0.34, h * 0.55, lampStrength);
            g.fillStyle = "#f3d38e"; g.beginPath(); g.arc(tx, top + h * 0.33, 5, Math.PI, 0); g.fill();
            g.fillStyle = "#efe3cf"; g.fillRect(tx - 12, bot - h * 0.24, 24, 3);
            g.fillStyle = "#6b5045"; g.fillRect(tx - 1, bot - h * 0.24, 2, h * 0.24 - 3);
            if (hash(f, 23 + i) < 0.75) drawPerson(tx - 15, bot - 3, L.ps * 0.85, lookFor(f, 1 + i), { face: 1, seated: true, idle: time + i, alpha: 0.95 });
            if (hash(f, 25 + i) < 0.5) drawPerson(tx + 15, bot - 3, L.ps * 0.85, lookFor(f, 3 + i), { face: -1, seated: true, idle: time + 2 + i, alpha: 0.95 });
          }
          break;
        }
        case 4: { // gardens: arches, trees, hedges
          if (!open) {
            for (let i = 0; i < 2; i++) {
              const ax = x0 + w * (0.22 + i * 0.36), aw = w * 0.26;
              archPath(ax, top + h * 0.18, aw, h * 0.62);
              const sg = g.createLinearGradient(0, top, 0, bot);
              sg.addColorStop(0, fp.skyT); sg.addColorStop(1, fp.skyB);
              g.fillStyle = sg; g.fill();
            }
          }
          drawPlant(x0 + w * 0.35, bot - 2, h * 0.8, fp, time, f, false);
          drawPlant(x0 + w * 0.78, bot - 2, h * 0.65, fp, time, f + 3, hash(f, 26) < 0.5);
          g.fillStyle = rgb(night > 0.5 ? [58, 84, 78] : [118, 150, 112]);
          rr(x0 + w * 0.08, bot - h * 0.16, w * 0.84, h * 0.16, 5); g.fill();
          break;
        }
        case 5: { // golden luxury: tall arch window + chandelier
          archPath(x0 + w * 0.32, top + h * 0.1, w * 0.4, h * 0.72);
          const sg = g.createLinearGradient(0, top, 0, bot);
          sg.addColorStop(0, fp.skyT); sg.addColorStop(1, fp.skyB);
          g.fillStyle = sg; g.fill();
          g.strokeStyle = "rgba(255,230,180,0.7)"; g.lineWidth = 1.5;
          archPath(x0 + w * 0.32, top + h * 0.1, w * 0.4, h * 0.72); g.stroke();
          drawLampGlow(x0 + w * 0.15, top + h * 0.28, h * 0.6, lampStrength);
          g.fillStyle = "#f3d38e";
          for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x0 + w * 0.15 + i * 5, top + h * 0.27, 2.2, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = rgb(mixA([150, 80, 70], fp.roomA, 0.2));
          rr(x0 + w * 0.68, bot - h * 0.2, w * 0.26, h * 0.2, 4); g.fill();
          break;
        }
        case 6: { // night district: lit window grid, warm sign
          g.fillStyle = "rgba(20,24,44,0.55)";
          g.fillRect(x0 + w * 0.1, top + h * 0.12, w * 0.8, h * 0.45);
          for (let i = 0; i < 10; i++) {
            const lit = hash(f * 10 + i, 27) < 0.55;
            g.fillStyle = lit ? "rgba(255,206,130,0.8)" : "rgba(60,70,110,0.6)";
            g.fillRect(x0 + w * (0.14 + (i % 5) * 0.15), top + h * (0.18 + Math.floor(i / 5) * 0.18), w * 0.08, h * 0.1);
          }
          const flick = 0.75 + 0.25 * Math.sin(time * 3 + f * 2);
          drawLampGlow(x0 + w * 0.5, bot - h * 0.32, h * 0.7, lampStrength * flick);
          g.fillStyle = "rgba(255,214,150," + (0.8 * flick).toFixed(2) + ")";
          rr(x0 + w * 0.38, bot - h * 0.38, w * 0.24, h * 0.1, 3); g.fill();
          break;
        }
        case 7: { // sky terrace: railing, clouds drifting past
          g.fillStyle = "rgba(255,255,255,0.7)";
          const cxp = (time * 8 + f * 37) % (w + 60) - 30;
          g.beginPath(); g.ellipse(x0 + cxp, top + h * 0.45, 22, 7, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = rgb(mixA(fp.facDA, [60, 60, 80], 0.3)); g.lineWidth = 1.2;
          g.beginPath();
          const ry = bot - h * 0.24;
          g.moveTo(x0 + inset, ry); g.lineTo(x1 - inset, ry);
          for (let x = x0 + inset; x < x1 - inset; x += 6) { g.moveTo(x, ry); g.lineTo(x, bot - inset * 0.8); }
          g.stroke();
          drawPlant(x0 + w * 0.82, bot - 2, h * 0.6, fp, time, f, true);
          break;
        }
        default: { // dreamlike: pale arches and floating orbs
          for (let i = 0; i < 3; i++) {
            const ax = x0 + w * (0.14 + i * 0.27);
            g.strokeStyle = "rgba(170,160,210,0.6)"; g.lineWidth = 2;
            archPath(ax, top + h * 0.15, w * 0.2, h * 0.7); g.stroke();
          }
          for (let i = 0; i < 3; i++) {
            const ox = x0 + w * (0.25 + i * 0.25), oy = top + h * 0.3 + Math.sin(time * 1.2 + i + f) * 4;
            drawLampGlow(ox, oy, 18, 0.8);
            g.fillStyle = "#fff6e6"; g.beginPath(); g.arc(ox, oy, 3, 0, Math.PI * 2); g.fill();
          }
        }
      }
      // a quiet resident moving about at the back of some rooms
      if (hash(f, 28) < 0.3 && theme !== 3) {
        const range = w * 0.25;
        const px = x0 + w * 0.55 + Math.sin(time * 0.25 + f * 3) * range;
        const face = Math.cos(time * 0.25 + f * 3) > 0 ? 1 : -1;
        drawPerson(px, bot - inset * 0.8, L.ps * 0.78, lookFor(f, 6), { face, walk: time * 6, alpha: 0.8 });
      }
      // night tint and warm interior light
      if (night > 0.05) {
        g.fillStyle = "rgba(18,22,48," + (0.32 * night).toFixed(3) + ")";
        g.fillRect(x0, top, w, h);
        drawLampGlow(x0 + w * 0.5, top + h * 0.45, w * 0.55, 0.5 * night);
      }
      // landing doorway next to the shaft
      g.fillStyle = rgb(mixA(fp.shaftA, fp.wall2A, 0.25));
      g.fillRect(x0, bot - L.cabH * 0.86, 4, L.cabH * 0.86);
      // floor slab
      g.fillStyle = fp.slab;
      g.fillRect(x0, bot, w, L.slab);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(x0, bot + L.slab - 2, w, 2);
    }

    function drawStrip(fLo, fHi) {
      const x = L.stripL, w = L.stripW;
      const P = palette(camY);
      g.fillStyle = rgb(mixA(P.wall2A, [40, 40, 60], 0.35), 0.92);
      g.fillRect(x, 0, w, L.H);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(x, 0, 1.5, L.H);
      const destSet = new Set(riders().map(p => p.dest));
      const cur = Math.round(E.p);
      setSpacing(0);
      for (let f = fLo; f <= fHi; f++) {
        const cy = baseY(f) - (L.FH - L.slab) / 2;
        const isDest = destSet.has(f);
        const isCur = f === cur && Math.abs(E.p - f) < 0.5;
        const size = Math.round((isCur ? 0.27 : 0.22) * L.FH);
        g.font = size + "px " + TITLE_FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        if (isDest) {
          const pulse = 0.6 + 0.4 * Math.sin(perfNow * 4);
          g.fillStyle = "rgba(243,196,107," + (0.22 + 0.18 * pulse).toFixed(3) + ")";
          rr(x + 4, cy - L.FH * 0.2, w - 8, L.FH * 0.4, 4); g.fill();
          g.fillStyle = "#ffe2a0";
        } else {
          g.fillStyle = isCur ? "rgba(255,246,228,1)" : "rgba(246,236,220,0.72)";
        }
        g.fillText(String(f), x + w / 2, cy + 1);
        if (isDest) {
          const n = riders().filter(p => p.dest === f).length;
          g.font = "700 " + Math.round(L.FH * 0.1) + "px " + UI_FONT;
          g.fillStyle = "#ffe2a0";
          g.fillText("●".repeat(Math.min(n, 3)), x + w / 2, cy + L.FH * 0.17);
        }
      }
    }

    function drawShaft(fLo, fHi, P, time) {
      const x = L.shaftL, w = L.shaftW;
      const shaft = rgb(mixA(P.shaftA, [20, 22, 34], P.night * 0.3));
      g.fillStyle = shaft;
      g.fillRect(x, 0, w, L.H);
      // rails
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 4, 0, 3, L.H); g.fillRect(x + w - 7, 0, 3, L.H);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x, 0, 3, L.H); g.fillRect(x + w - 3, 0, 3, L.H);
      // beams + warm landing lamps at each floor
      for (let f = fLo; f <= fHi + 1; f++) {
        const y = baseY(f);
        g.fillStyle = "rgba(0,0,0,0.28)";
        g.fillRect(x, y, w, L.slab * 0.7);
        g.fillStyle = "rgba(255,255,255,0.04)";
        g.fillRect(x, y - 1, w, 1);
        const glow = 0.6 + 0.4 * P.night;
        g.fillStyle = "rgba(255,196,110," + (0.85 * glow).toFixed(3) + ")";
        rr(x + 1.5, y - L.FH * 0.42, 3, L.FH * 0.16, 1.5); g.fill();
        rr(x + w - 4.5, y - L.FH * 0.42, 3, L.FH * 0.16, 1.5); g.fill();
      }
      // counterweight gliding the other way
      const cwPos = 30 - E.p * 1.0;
      const cwy = L.anchorY - (((cwPos - camY) % 24) + 24) % 24 * L.FH + L.FH * 6;
      if (cwy > -60 && cwy < L.H + 60) {
        g.fillStyle = "rgba(10,12,20,0.6)";
        g.fillRect(x + w - 16, cwy - 40, 9, 40);
        g.fillStyle = "rgba(255,255,255,0.08)";
        g.fillRect(x + w - 16, cwy - 40, 9, 2);
      }
    }

    // ---- passengers ------------------------------------------------------
    function drawPerson(x, yFeet, H0, look, o) {
      const H = H0 * look.h;
      const a = o.alpha === undefined ? 1 : o.alpha;
      if (a <= 0.01) return;
      g.globalAlpha = a;
      const face = o.face || 1;
      const walking = o.walk && o.walk > 0 && !o.seated;
      const sw = walking ? Math.sin(o.walk) : 0;
      const breathe = Math.sin((o.idle || 0) * 1.6 + look.phase) * H * 0.008;
      const shift = o.shift ? Math.sin((o.idle || 0) * 2.2 + look.phase) * H * 0.03 : 0;
      const bodyW = H * 0.22 * look.w;
      const hipY = yFeet - H * (o.seated ? 0.3 : 0.46);
      const shoulderY = hipY - H * 0.32 + breathe;
      const cx = x + shift;
      // legs
      g.fillStyle = look.pants;
      const lw = H * 0.075;
      if (o.seated) {
        g.fillRect(cx - bodyW * 0.35, hipY - lw * 0.2, face * H * 0.2 + (face < 0 ? -lw : 0), lw * 1.1);
        g.fillRect(cx + face * H * 0.16 - lw / 2, hipY, lw, H * 0.28);
      } else {
        const tap = o.tap ? Math.max(0, Math.sin((o.idle || 0) * 16)) * H * 0.03 : 0;
        g.save();
        g.translate(cx - bodyW * 0.18, hipY);
        g.rotate(sw * 0.35);
        g.fillRect(-lw / 2, 0, lw, H * 0.46);
        g.restore();
        g.save();
        g.translate(cx + bodyW * 0.18, hipY - tap);
        g.rotate(-sw * 0.35);
        g.fillRect(-lw / 2, 0, lw, H * 0.46);
        g.restore();
      }
      // backpack behind
      if (look.prop === "backpack") {
        g.fillStyle = "#6a5a4a";
        rr(cx - face * bodyW * 0.75 - bodyW * 0.22, shoulderY + H * 0.03, bodyW * 0.45, H * 0.22, 2); g.fill();
      }
      // torso / dress
      g.fillStyle = look.top;
      if (look.dress) {
        g.beginPath();
        g.moveTo(cx - bodyW * 0.42, shoulderY);
        g.lineTo(cx + bodyW * 0.42, shoulderY);
        g.lineTo(cx + bodyW * 0.62, hipY + H * 0.14);
        g.lineTo(cx - bodyW * 0.62, hipY + H * 0.14);
        g.closePath(); g.fill();
      } else {
        rr(cx - bodyW / 2, shoulderY, bodyW, hipY - shoulderY + H * 0.03, bodyW * 0.3); g.fill();
      }
      // arms
      g.strokeStyle = look.top;
      g.lineWidth = H * 0.06;
      g.lineCap = "round";
      g.beginPath();
      const armSw = walking ? -sw * H * 0.07 : 0;
      if (o.watch) {
        g.moveTo(cx + face * bodyW * 0.42, shoulderY + H * 0.04);
        g.lineTo(cx + face * bodyW * 0.75, shoulderY + H * 0.14);
        g.lineTo(cx + face * bodyW * 0.15, shoulderY + H * 0.12);
      } else {
        g.moveTo(cx + bodyW * 0.45, shoulderY + H * 0.04);
        g.lineTo(cx + bodyW * 0.55 + armSw, shoulderY + H * 0.3);
      }
      g.moveTo(cx - bodyW * 0.45, shoulderY + H * 0.04);
      g.lineTo(cx - bodyW * 0.55 - armSw, shoulderY + H * 0.3);
      g.stroke();
      // head
      const headR = H * 0.095;
      const hy = shoulderY - headR * 1.05;
      g.fillStyle = look.skin;
      g.beginPath(); g.arc(cx + (o.lookUp ? face * 1 : 0), hy, headR, 0, Math.PI * 2); g.fill();
      g.fillStyle = look.hair;
      g.beginPath(); g.arc(cx, hy - headR * 0.18, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95); g.fill();
      if (look.hairLong) { g.fillRect(cx - face * headR * 0.9 - headR * 0.3, hy - headR * 0.3, headR * 0.6, headR * 1.3); }
      // props in hand
      const hx = cx + face * bodyW * 0.6, hyH = shoulderY + H * 0.3;
      switch (look.prop) {
        case "bag": g.fillStyle = "#b9855f"; rr(hx - H * 0.05, hyH, H * 0.1, H * 0.12, 2); g.fill(); break;
        case "groceries": g.fillStyle = "#d9c09a"; g.fillRect(hx - H * 0.06, hyH - H * 0.02, H * 0.12, H * 0.13);
          g.fillStyle = "#6f9a5f"; g.beginPath(); g.arc(hx, hyH - H * 0.03, H * 0.04, 0, Math.PI * 2); g.fill(); break;
        case "briefcase": g.fillStyle = "#4a3a32"; g.fillRect(hx - H * 0.07, hyH + H * 0.02, H * 0.14, H * 0.09); break;
        case "umbrella": g.strokeStyle = "#3a3a46"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx, hyH - H * 0.05); g.lineTo(hx + face * H * 0.03, yFeet - 1); g.stroke();
          g.fillStyle = "#5f7f9c"; g.beginPath(); g.ellipse(hx + face * H * 0.015, hyH + H * 0.08, H * 0.025, H * 0.1, 0, 0, Math.PI * 2); g.fill(); break;
        case "flowers": g.fillStyle = "#6f9a5f"; g.fillRect(hx - 1, hyH - H * 0.12, 2, H * 0.14);
          g.fillStyle = "#e48a76"; g.beginPath(); g.arc(hx - 2, hyH - H * 0.13, H * 0.035, 0, Math.PI * 2); g.arc(hx + 2.5, hyH - H * 0.15, H * 0.03, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#f2d07a"; g.beginPath(); g.arc(hx + 0.5, hyH - H * 0.18, H * 0.025, 0, Math.PI * 2); g.fill(); break;
        case "box": g.fillStyle = "#c79a6a"; g.fillRect(cx + face * bodyW * 0.2 - H * 0.09, shoulderY + H * 0.08, H * 0.18, H * 0.15);
          g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(cx + face * bodyW * 0.2 - H * 0.09, shoulderY + H * 0.14, H * 0.18, 1.5); break;
        case "suitcase": g.fillStyle = "#8a5a48"; rr(hx + face * H * 0.03 - H * 0.07, yFeet - H * 0.24, H * 0.14, H * 0.22, 2); g.fill();
          g.fillStyle = "#3a3432"; g.fillRect(hx - 0.5, hyH, 1.5, yFeet - H * 0.24 - hyH); break;
        case "cane": g.strokeStyle = "#5a4636"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx, hyH); g.lineTo(hx + face * H * 0.06, yFeet); g.stroke(); break;
      }
      g.globalAlpha = 1;
    }

    function personOpts(p, time) {
      const st = patienceStage(p);
      const o = { face: -1, idle: time, alpha: p.alpha, walk: 0 };
      if (p.state === "arriving" || p.state === "leaving") { o.walk = p.walk; o.face = p.state === "leaving" ? 1 : -1; }
      else if (p.state === "boarding") { o.walk = p.walk; o.face = -1; }
      else if (p.state === "exiting") { o.walk = p.walk; o.face = 1; }
      else if (p.state === "resident") { o.face = Math.sin(p.id) > 0 ? 1 : -1; }
      else if (p.state === "waiting") {
        if (st === 0) o.face = Math.sin(time * 0.3 + p.id) > 0.6 ? 1 : -1;
        if (st >= 1) { o.shift = true; o.lookUp = true; }
        if (st >= 2) { o.tap = true; o.watch = Math.sin(time * 0.8 + p.id) > 0.2; }
      }
      return o;
    }

    function drawWaiting(time) {
      for (const p of pax) {
        if (p.state === "riding") continue;
        if (p.state === "boarding" && Math.abs(p.u) < L.cabHalfU + 0.3) continue; // drawn inside the car
        const yb = baseY(p.floor);
        if (yb < -40 || yb > L.H + 80) continue;
        const x = L.shaftCx + p.u * L.FH;
        if (p.state === "exiting" && Math.abs(p.u) < L.cabHalfU + 0.05) continue; // drawn inside the car
        drawPerson(x, yb - 1, L.ps, p.look, personOpts(p, time));
      }
    }

    function cabinY() {
      let bounce = 0;
      if (E.bounceT < 1.2) bounce = E.bounceAmp * Math.exp(-E.bounceT * 6) * Math.sin(E.bounceT * 26);
      return baseY(E.p) + bounce;
    }

    function drawCabin(time, P, pass) {
      const cb = cabinY();
      const w = L.cabW, h = L.cabH;
      const x = L.shaftCx - w / 2, y = cb - h;
      if (pass === 0) {
        // the lantern's glow spills into the dark shaft
        drawLampGlow(L.shaftCx, y + h * 0.5, L.shaftW * 1.1, 0.75);
        // cables (with moving markers so you see them run)
        g.strokeStyle = "rgba(160,160,170,0.55)"; g.lineWidth = 1;
        g.beginPath();
        g.moveTo(L.shaftCx - 4, 0); g.lineTo(L.shaftCx - 4, y - h * 0.2);
        g.moveTo(L.shaftCx + 4, 0); g.lineTo(L.shaftCx + 4, y - h * 0.2);
        g.stroke();
        const off = ((E.p * L.FH * 0.9) % 22 + 22) % 22;
        g.fillStyle = "rgba(200,200,210,0.5)";
        for (let yy = -off; yy < y - h * 0.2; yy += 22) { g.fillRect(L.shaftCx - 5, yy, 2, 4); g.fillRect(L.shaftCx + 3, yy + 11, 2, 4); }
        // crown + finial (lantern top)
        g.fillStyle = "#1f222c";
        g.beginPath();
        g.moveTo(x + 4, y); g.lineTo(x + w * 0.2, y - h * 0.14); g.lineTo(x + w * 0.8, y - h * 0.14); g.lineTo(x + w - 4, y);
        g.closePath(); g.fill();
        g.fillRect(L.shaftCx - 3, y - h * 0.24, 6, h * 0.11);
        g.beginPath(); g.moveTo(L.shaftCx - 5, y - h * 0.24); g.lineTo(L.shaftCx, y - h * 0.33); g.lineTo(L.shaftCx + 5, y - h * 0.24); g.fill();
        // floor indicator
        g.fillStyle = "#14161e";
        rr(L.shaftCx - 13, y - h * 0.125, 26, h * 0.1, 2); g.fill();
        g.fillStyle = "#ffcf7a";
        g.font = Math.round(h * 0.1) + "px " + TITLE_FONT;
        g.textAlign = "center"; g.textBaseline = "middle"; setSpacing(0);
        const arrow = E.v > 0.2 ? "▲" : E.v < -0.2 ? "▼" : "";
        g.fillText(String(Math.round(E.p)), L.shaftCx + (arrow ? 3 : 0), y - h * 0.072);
        if (arrow) { g.font = Math.round(h * 0.06) + "px " + UI_FONT; g.fillText(arrow, L.shaftCx - 8, y - h * 0.075); }
        // frame + warm interior
        g.fillStyle = "#1c1e27";
        rr(x - 3, y - 2, w + 6, h + 4, 3); g.fill();
        const ig = g.createLinearGradient(0, y, 0, y + h);
        ig.addColorStop(0, "#ffe6a8");
        ig.addColorStop(0.55, "#f7c46f");
        ig.addColorStop(1, "#e69a4a");
        g.fillStyle = ig;
        g.fillRect(x, y, w, h);
        // back wall panels + ceiling light
        g.fillStyle = "rgba(160,90,40,0.12)";
        for (let i = 1; i < 4; i++) g.fillRect(x + (w * i) / 4, y + h * 0.08, 1, h * 0.8);
        g.fillStyle = "rgba(255,250,230,0.9)";
        g.fillRect(x + w * 0.2, y + 2, w * 0.6, 2);
        g.fillStyle = "rgba(120,60,30,0.25)";
        g.fillRect(x, y + h - 4, w, 4);
        // riders: back row first
        const inside = pax.filter(p => p.state === "riding" || (p.state === "boarding" && Math.abs(p.u) < L.cabHalfU + 0.3) || (p.state === "exiting" && Math.abs(p.u) < L.cabHalfU + 0.05));
        inside.sort((a, b) => (b.cslot >= 5 ? 1 : 0) - (a.cslot >= 5 ? 1 : 0));
        g.save();
        g.beginPath(); g.rect(x - 2, y - 30, w + 40, h + 30); g.clip();
        for (const p of inside) {
          const back = p.cslot >= 5;
          const px = L.shaftCx + p.u * L.FH;
          const o = personOpts(p, time);
          if (p.state === "riding") { o.face = Math.sin(p.id * 1.7) > 0 ? 1 : -1; o.walk = 0; }
          drawPerson(px, cb - 4 - (back ? 3 : 0), L.ps * (back ? 0.92 : 1), p.look, o);
        }
        g.restore();
        // tiny destination tags above riders
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.font = Math.round(L.FH * 0.105) + "px " + TITLE_FONT;
        for (const p of inside) {
          if (p.state !== "riding") continue;
          const px = L.shaftCx + p.u * L.FH;
          const ty = cb - 4 - L.ps * p.look.h - 5 - (p.cslot >= 5 ? 9 : 0);
          const up = p.dest > E.p;
          g.fillStyle = "rgba(40,30,30,0.55)";
          rr(px - 9, ty - L.FH * 0.1, 18, L.FH * 0.12, 3); g.fill();
          g.fillStyle = up ? "#d9f0dd" : "#ffd9cc";
          g.fillText((up ? "↑" : "↓") + p.dest, px, ty);
        }
      } else {
        // doors (glass, sliding apart) + reflections + frame details
        const o = E.doors;
        const pw = (w / 2) * (1 - o);
        g.fillStyle = "rgba(255,226,170,0.20)";
        g.fillRect(x, y, pw, h); g.fillRect(x + w - pw, y, pw, h);
        g.fillStyle = "#2a2d38";
        if (pw > 1) { g.fillRect(x + pw - 2, y, 2, h); g.fillRect(x + w - pw, y, 2, h); }
        g.fillRect(x, y, 2, h); g.fillRect(x + w - 2, y, 2, h);
        // reflections
        g.save();
        g.beginPath(); g.rect(x, y, w, h); g.clip();
        g.fillStyle = "rgba(255,255,255,0.10)";
        g.beginPath(); g.moveTo(x + w * 0.1, y); g.lineTo(x + w * 0.3, y); g.lineTo(x + w * 0.05, y + h); g.lineTo(x - w * 0.15, y + h); g.fill();
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.beginPath(); g.moveTo(x + w * 0.62, y); g.lineTo(x + w * 0.7, y); g.lineTo(x + w * 0.5, y + h); g.lineTo(x + w * 0.42, y + h); g.fill();
        g.restore();
        // sill + bolts
        g.fillStyle = "#1c1e27";
        g.fillRect(x - 3, cb - 2, w + 6, 4);
        g.fillStyle = "rgba(255,220,160,0.6)";
        g.fillRect(x - 1, y + 3, 2, 2); g.fillRect(x + w - 1, y + 3, 2, 2);
        // perfect-stop pulse
        if (pulseT < 0.6) {
          const k = pulseT / 0.6;
          g.strokeStyle = "rgba(255,240,200," + (0.7 * (1 - k)).toFixed(3) + ")";
          g.lineWidth = 2;
          rr(x - 4 - k * 14, y - 4 - k * 14, w + 8 + k * 28, h + 8 + k * 28, 6); g.stroke();
        }
      }
    }

    function drawBubbles(time) {
      // one tiny neutral bubble per destination group per floor
      const groups = new Map();
      for (const p of pax) {
        if (p.state !== "waiting" && p.state !== "arriving") continue;
        const key = p.floor * 1000 + p.dest;
        let gp = groups.get(key);
        if (!gp) { gp = { floor: p.floor, dest: p.dest, n: 0, minU: 9, maxU: -9, worst: 0, tallest: 0 }; groups.set(key, gp); }
        gp.n++;
        gp.minU = Math.min(gp.minU, p.u); gp.maxU = Math.max(gp.maxU, p.u);
        gp.worst = Math.max(gp.worst, p.waited / p.patience);
        gp.tallest = Math.max(gp.tallest, p.look.h);
      }
      const perFloor = new Map();
      const fs = Math.round(L.FH * 0.16);
      for (const gp of groups.values()) {
        const yb = baseY(gp.floor);
        if (yb < -20 || yb > L.H + 60) continue;
        const placed = perFloor.get(gp.floor) || [];
        perFloor.set(gp.floor, placed);
        const near = 1 - clamp((Math.abs(gp.floor - E.p) - 2) / 4, 0, 1);
        const alpha = lerp(0.78, 1, near);
        const sc = lerp(0.92, 1.04, near);
        const up = gp.dest > gp.floor;
        const label = (up ? "↑" : "↓") + gp.dest;
        g.font = fs + "px " + TITLE_FONT;
        setSpacing(0);
        const tw = g.measureText(label).width;
        const iconW = gp.n > 1 ? fs * 1.15 : fs * 0.55;
        const bw = (tw + iconW + fs * 0.75) * sc, bh = fs * 1.35 * sc;
        let bx = L.shaftCx + ((gp.minU + gp.maxU) / 2) * L.FH - bw / 2;
        bx = clamp(bx, L.roomL + 3, L.stripL - bw - 3);
        let by = yb - L.ps * gp.tallest - bh - 8;
        for (let tries = 0; tries < 4 && placed.some(r => bx < r.x + r.w + 2 && bx + bw > r.x - 2 && by < r.y + r.h + 2 && by + bh > r.y - 2); tries++) by -= bh + 4;
        placed.push({ x: bx, y: by, w: bw, h: bh });
        by += Math.sin(time * 2 + gp.floor) * 0.8;
        const urgent = gp.worst > 0.72;
        const wob = urgent ? Math.sin(time * 18) * 0.8 : 0;
        g.globalAlpha = alpha;
        g.fillStyle = "rgba(60,40,30,0.18)";
        rr(bx + 1 + wob, by + 2, bw, bh, bh / 2); g.fill();
        g.fillStyle = "#f8f1e6";
        rr(bx + wob, by, bw, bh, bh / 2); g.fill();
        g.beginPath(); g.moveTo(bx + bw * 0.4 + wob, by + bh - 0.5); g.lineTo(bx + bw * 0.5 + wob, by + bh + 5); g.lineTo(bx + bw * 0.58 + wob, by + bh - 0.5); g.fill();
        // tiny person glyph(s)
        g.fillStyle = "#3b4150";
        const gx = bx + fs * 0.45 + wob, gy = by + bh / 2;
        for (let i = 0; i < Math.min(gp.n, 3); i++) {
          const ox = gx + i * fs * 0.3;
          g.beginPath(); g.arc(ox, gy - fs * 0.22, fs * 0.13, 0, Math.PI * 2); g.fill();
          rr(ox - fs * 0.13, gy - fs * 0.06, fs * 0.26, fs * 0.36, fs * 0.1); g.fill();
        }
        g.fillStyle = up ? "#3f6e5b" : "#b4533b";
        g.textAlign = "left"; g.textBaseline = "middle";
        g.fillText(label, bx + iconW + fs * 0.4 + wob, by + bh / 2 + 1);
        // patience: a hairline that drains, sage → coral
        const rem = clamp(1 - gp.worst, 0, 1);
        g.fillStyle = "rgba(0,0,0,0.08)";
        g.fillRect(bx + bh / 2, by + bh - 3, bw - bh, 1.6);
        g.fillStyle = rem > 0.28 ? "#7fa88e" : "#d0644a";
        g.fillRect(bx + bh / 2, by + bh - 3, (bw - bh) * rem, 1.6);
        g.globalAlpha = 1;
      }
    }

    function drawFloats(dt) {
      for (const fl of floats) fl.t += dt;
      floats = floats.filter(f => f.t < 1.6);
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const fl of floats) {
        if (fl.t < 0) continue;
        const k = fl.t / 1.6;
        const y = baseY(fl.floor) - L.FH * 0.55 - k * L.FH * 0.4;
        const x = fl.cross ? L.shaftCx + fl.u * L.FH : clamp(L.shaftCx + fl.u * L.FH, L.X0 + 50, L.stripL - 40);
        g.globalAlpha = (1 - smooth((k - 0.6) / 0.4)) * smooth(fl.t / 0.12);
        if (fl.cross) {
          g.fillStyle = "#d0644a";
          g.beginPath(); g.arc(x, y + L.FH * 0.1, L.FH * 0.11, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#fff4ea";
          g.font = "700 " + Math.round(L.FH * 0.13) + "px " + UI_FONT;
          g.fillText("✕", x, y + L.FH * 0.11);
        } else {
          g.font = fl.caps ? "700 " + Math.round(L.FH * 0.1) + "px " + UI_FONT : Math.round(L.FH * 0.2) + "px " + TITLE_FONT;
          setSpacing(fl.caps ? 1.5 : 0.5);
          g.fillStyle = "rgba(40,30,30,0.35)";
          g.fillText(fl.text, x + 1, y + 1.5);
          g.fillStyle = fl.color;
          g.fillText(fl.text, x, y);
        }
      }
      g.globalAlpha = 1;
      setSpacing(0);
    }

    function drawOffscreen() {
      // where am I needed? tiny edge chips for waiting people & rider stops off-screen
      const z = zoomNow();
      const topF = camY + (L.anchorY - L.safeTop - 10) / (L.FH * z);
      const botF = camY - (L.H - L.anchorY - L.safeBottom - 10) / (L.FH * z);
      const ups = [], downs = [];
      for (const p of pax) {
        let f = null, kind = null;
        if (p.state === "waiting" || p.state === "arriving") { f = p.floor; kind = patienceStage(p) >= 2 ? "urgent" : "wait"; }
        else if (p.state === "riding") { f = p.dest; kind = "dest"; }
        if (f === null) continue;
        if (f > topF - 0.6) ups.push({ f, kind });
        else if (f < botF + 0.2) downs.push({ f, kind });
      }
      const chip = (list, yTop, dir) => {
        if (!list.length) return;
        list.sort((a, b) => dir > 0 ? a.f - b.f : b.f - a.f);
        const nearest = list[0];
        const urgent = list.some(e => e.kind === "urgent");
        const dest = list.some(e => e.kind === "dest");
        const waiting = list.filter(e => e.kind !== "dest").length;
        const fs = Math.round(L.FH * 0.15);
        const w = L.stripW + 18, h = fs * 2.1;
        const x = L.stripL - 18 + (L.stripW + 18 - w);
        g.fillStyle = urgent ? "rgba(208,100,74,0.95)" : dest ? "rgba(243,196,107,0.95)" : "rgba(248,241,230,0.95)";
        rr(x, yTop, w - 4, h, 5); g.fill();
        g.fillStyle = urgent ? "#fff4ea" : "#3b4150";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.font = fs + "px " + TITLE_FONT; setSpacing(0);
        g.fillText((dir > 0 ? "▲ " : "▼ ") + nearest.f, x + (w - 4) / 2, yTop + h * 0.36);
        g.font = "700 " + Math.round(fs * 0.62) + "px " + UI_FONT;
        g.fillText(waiting ? waiting + " WAITING" : "DROP", x + (w - 4) / 2, yTop + h * 0.76);
      };
      chip(ups, L.safeTop + L.H * 0.135, 1);
      chip(downs, L.H - L.safeBottom - L.FH * 0.95, -1);
    }

    function drawHUD(time) {
      const U = L.U;
      const x = L.X0 + 12, y = L.safeTop + 12;
      if (S.mode === "title") {
        // title, like the poster
        g.fillStyle = "rgba(255,248,236,0.96)";
        g.textAlign = "left"; g.textBaseline = "alphabetic";
        g.font = Math.round(62 * U) + "px " + TITLE_FONT; setSpacing(1);
        const maxW = L.CW * 0.62;
        g.fillText("THE", x + 4, y + 58 * U, maxW);
        g.fillText("ELEVATOR", x + 4, y + 114 * U, maxW);
        g.font = "400 " + Math.round(11 * U) + "px " + UI_FONT; setSpacing(2.6);
        g.fillText("EVERYONE HAS", x + 6, y + 140 * U);
        g.fillText("SOMEWHERE TO BE.", x + 6, y + 157 * U);
        setSpacing(0);
        if (S.best > 0) {
          g.font = "700 " + Math.round(10 * U) + "px " + UI_FONT; setSpacing(2);
          g.fillStyle = "rgba(255,248,236,0.8)";
          g.fillText("BEST  " + S.best, x + 6, y + 182 * U);
          setSpacing(0);
        }
        return;
      }
      // slate panel: FLOOR / SERVED
      const pw = 76 * U, ph = 112 * U;
      g.fillStyle = "rgba(78,92,100,0.86)";
      g.fillRect(x, y, pw, ph);
      g.textAlign = "left";
      g.fillStyle = "rgba(240,234,224,0.85)";
      g.font = "700 " + Math.round(9 * U) + "px " + UI_FONT; setSpacing(1.8);
      g.fillText("FLOOR", x + 10 * U, y + 18 * U);
      g.fillText("SERVED", x + 10 * U, y + 66 * U);
      setSpacing(0);
      g.fillStyle = "#fbf5ea";
      g.font = Math.round(34 * U) + "px " + TITLE_FONT;
      g.fillText(String(Math.round(E.p)), x + 10 * U, y + 50 * U);
      g.fillText(String(S.served), x + 10 * U, y + 98 * U);
      // points + route multiplier, quietly
      g.font = "700 " + Math.round(9 * U) + "px " + UI_FONT; setSpacing(1.2);
      g.fillStyle = "rgba(255,248,236,0.85)";
      g.fillText(S.points + " PTS", x + 2, y + ph + 14 * U);
      if (S.mult > 1) {
        const k = clamp(S.comboT / CFG.combo_duration, 0, 1);
        g.fillStyle = "#f3c46b";
        g.fillText("ROUTE ×" + S.mult, x + 2, y + ph + 28 * U);
        g.fillStyle = "rgba(243,196,107,0.35)"; g.fillRect(x + 2, y + ph + 32 * U, pw - 4, 2);
        g.fillStyle = "#f3c46b"; g.fillRect(x + 2, y + ph + 32 * U, (pw - 4) * k, 2);
      }
      setSpacing(0);
      // capacity, over the shaft (like the poster's 4/6)
      const n = riders().length, cap = CFG.max_capacity;
      const cx = L.shaftCx, cy = y + 16 * U;
      g.font = Math.round(24 * U) + "px " + TITLE_FONT;
      g.textAlign = "left"; g.textBaseline = "middle";
      const label = n + "/" + cap;
      const tw = g.measureText(label).width;
      const iw = 9 * U;
      const total = iw * 2 + 6 + tw;
      const sx = cx - total / 2;
      g.fillStyle = n >= cap ? "#f08a6c" : "#fbf5ea";
      for (let i = 0; i < 2; i++) {
        const ox = sx + i * iw + iw / 2;
        g.beginPath(); g.arc(ox, cy - 6 * U, 2.6 * U, 0, Math.PI * 2); g.fill();
        rr(ox - 3 * U, cy - 2.5 * U, 6 * U, 10 * U, 2 * U); g.fill();
      }
      g.fillText(label, sx + iw * 2 + 6, cy + 1);
      // missed passengers: small marks, not a health bar
      const ml = CFG.missed_limit;
      for (let i = 0; i < ml; i++) {
        const mx = cx + (i - (ml - 1) / 2) * 11 * U, my = cy + 18 * U;
        if (i < S.misses) {
          g.fillStyle = "#e0775c"; g.beginPath(); g.arc(mx, my, 3.4 * U, 0, Math.PI * 2); g.fill();
        } else {
          g.strokeStyle = "rgba(251,245,234,0.55)"; g.lineWidth = 1.2;
          g.beginPath(); g.arc(mx, my, 3 * U, 0, Math.PI * 2); g.stroke();
        }
      }
      // best, top-right
      g.textAlign = "right"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(251,245,234,0.85)";
      g.font = "700 " + Math.round(9 * U) + "px " + UI_FONT; setSpacing(1.8);
      g.fillText("BEST", L.X0 + L.CW - 10, y + 12 * U);
      setSpacing(0);
      g.font = Math.round(22 * U) + "px " + TITLE_FONT;
      g.fillText(String(Math.max(S.best, S.served)), L.X0 + L.CW - 10, y + 34 * U);
    }

    function drawHint(time) {
      if (S.mode === "over" || S.hint >= 2) return;
      const y = cabinY() + L.FH * 0.32;
      let text;
      if (S.mode === "title" || S.hint === 0) text = "HOLD & DRAG UP";
      else if (S.hint === 1) text = Math.abs(E.v) > 0.2 ? "RELEASE TO STOP" : "STOP AT THEIR FLOOR";
      if (!text) return;
      const fs = Math.round(10 * L.U);
      g.font = "700 " + fs + "px " + UI_FONT; setSpacing(1.6);
      const tw = g.measureText(text).width;
      const w = tw + 22, h = fs * 2.2;
      const x = clamp(L.shaftCx - w / 2, L.X0 + 6, L.X0 + L.CW - w - 6);
      const bob = Math.sin(time * 3) * 2;
      g.fillStyle = "rgba(30,32,44,0.72)";
      rr(x, y - h / 2 + bob, w, h, h / 2); g.fill();
      g.fillStyle = "#fbf1dc";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, x + w / 2, y + bob + 1);
      setSpacing(0);
      if (S.hint === 0 || S.mode === "title") {
        // animated arrow
        const k = (time * 0.9) % 1;
        g.strokeStyle = "rgba(251,241,220," + (1 - k).toFixed(3) + ")";
        g.lineWidth = 2;
        const ax = x + w / 2, ay = y + h / 2 + 22 - k * 14 + bob;
        g.beginPath(); g.moveTo(ax - 6, ay + 6); g.lineTo(ax, ay); g.lineTo(ax + 6, ay + 6); g.stroke();
      }
    }

    function drawBanners(dt) {
      for (const b of banners) b.t += dt;
      banners = banners.filter(b => b.t < b.dur);
      for (const b of banners) {
        const a = smooth(b.t / 0.25) * (1 - smooth((b.t - b.dur + 0.5) / 0.5));
        g.globalAlpha = a;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        const y = L.safeTop + L.H * 0.27 - (1 - smooth(b.t / 0.4)) * 8;
        const cx = L.X0 + L.CW * 0.56;
        g.fillStyle = "rgba(30,32,44,0.28)";
        g.font = Math.round(44 * L.U) + "px " + TITLE_FONT; setSpacing(2);
        g.fillText(b.big, cx + 1, y + 2);
        g.fillStyle = "#fff6e2";
        g.fillText(b.big, cx, y);
        if (b.small) {
          g.font = "700 " + Math.round(10 * L.U) + "px " + UI_FONT; setSpacing(3);
          g.fillText(b.small, cx, y + 18 * L.U);
        }
        setSpacing(0);
      }
      g.globalAlpha = 1;
    }

    function drawOver() {
      if (S.mode !== "over") return;
      const k = smooth((S.overT - 0.35) / 0.5);
      if (k <= 0) return;
      g.fillStyle = "rgba(28,30,44," + (0.62 * k).toFixed(3) + ")";
      g.fillRect(0, 0, L.W, L.H);
      g.globalAlpha = k;
      const cx = L.W / 2, U = L.U;
      let y = L.H * 0.36;
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.fillStyle = "#f3c9b8";
      g.font = "700 " + Math.round(11 * U) + "px " + UI_FONT; setSpacing(3.2);
      g.fillText("SERVICE OVERLOAD", cx, y);
      y += 48 * U;
      g.fillStyle = "rgba(251,245,234,0.75)";
      g.font = "700 " + Math.round(9 * U) + "px " + UI_FONT; setSpacing(2.4);
      g.fillText("PASSENGERS", cx, y);
      g.fillStyle = "#fbf5ea";
      g.font = Math.round(64 * U) + "px " + TITLE_FONT; setSpacing(1);
      g.fillText(String(S.served), cx, y + 58 * U);
      y += 92 * U;
      g.fillStyle = "rgba(251,245,234,0.75)";
      g.font = "700 " + Math.round(9 * U) + "px " + UI_FONT; setSpacing(2.4);
      g.fillText(S.served >= S.best && S.served > S.bestAtStart && S.served > 0 ? "NEW BEST" : "BEST", cx, y);
      g.fillStyle = "#fbf5ea";
      g.font = Math.round(30 * U) + "px " + TITLE_FONT; setSpacing(1);
      g.fillText(String(Math.max(S.best, S.served)), cx, y + 30 * U);
      y += 64 * U;
      g.fillStyle = "rgba(251,245,234,0.6)";
      g.font = "400 " + Math.round(10 * U) + "px " + UI_FONT; setSpacing(1.2);
      g.fillText(S.points + " pts  ·  floor " + Math.round(E.p), cx, y);
      if (S.overT > 0.9) {
        const blink = 0.55 + 0.45 * Math.sin(perfNow * 3);
        g.globalAlpha = k * blink;
        g.fillStyle = "#fff6e2";
        g.font = "700 " + Math.round(11 * U) + "px " + UI_FONT; setSpacing(3);
        g.fillText("TAP TO RUN AGAIN", cx, y + 44 * U);
      }
      setSpacing(0);
      g.globalAlpha = 1;
    }

    let perfNow = 0;
    function render() {
      const time = perfNow;
      const P = palette(camY);
      const z = zoomNow();
      drawSky(P, time);
      drawRain(rainAt(camY), time, false);
      g.save();
      if (z !== 1) {
        g.translate(L.W / 2, L.anchorY); g.scale(z, z); g.translate(-L.W / 2, -L.anchorY);
      }
      const fHi = Math.floor(camY + L.anchorY / (L.FH * z)) + 1;
      const fLo = Math.max(1, Math.floor(camY - (L.H - L.anchorY) / (L.FH * z)) - 1);
      for (let f = fLo; f <= fHi; f++) { drawRoom(f, P, time); drawFacade(f, P, time); }
      drawGround(P);
      drawShaft(fLo, fHi, P, time);
      drawCabin(time, P, 0);
      drawWaiting(time);
      drawCabin(time, P, 1);
      drawStrip(fLo, fHi);
      drawBubbles(time);
      drawFloats(lastDt);
      g.restore();
      drawRain(rainAt(camY), time, true);
      drawOffscreen();
      drawHUD(time);
      drawHint(time);
      drawBanners(lastDt);
      drawOver();
    }

    /* ======================================================================
     * 13. INPUT — hold/drag vertically to drive, release to brake.
     * Holding without dragging drives toward the side you touched.
     * Keyboard (desktop): W/↑ up, S/↓ down, Space brake, R restart.
     * ==================================================================== */
    const input = ctx.input.track(canvas, { pointerCapture: true });
    const keys = { up: false, down: false, brake: false };
    let axis = 0;
    function readAxis() {
      let a = 0;
      if (input.down) {
        const dy = input.startY - input.y;
        if (Math.abs(dy) > 10 * L.U) {
          const mag = clamp((Math.abs(dy) - 6) / (L.FH * 0.8), 0.3, 1);
          a = Math.sign(dy) * mag;
        } else {
          const cy = cabinY() - L.cabH / 2;
          const off = input.startY - cy;
          if (Math.abs(off) > L.cabH * 0.6) a = off < 0 ? 0.55 : -0.55;
        }
      }
      if (keys.up && !keys.down) a = 1;
      if (keys.down && !keys.up) a = -1;
      if (keys.brake) a = 0;
      return a;
    }
    function onKey(e, down) {
      const k = e.key;
      if (k === "ArrowUp" || k === "w" || k === "W") { keys.up = down; e.preventDefault && e.preventDefault(); }
      else if (k === "ArrowDown" || k === "s" || k === "S") { keys.down = down; e.preventDefault && e.preventDefault(); }
      else if (k === " ") { keys.brake = down; e.preventDefault && e.preventDefault(); }
      else if ((k === "r" || k === "R") && down) { if (S.mode !== "title") restart(); }
      if (down && (keys.up || keys.down)) userGesture();
    }
    try {
      ctx.listen(window, "keydown", e => onKey(e, true));
      ctx.listen(window, "keyup", e => onKey(e, false));
    } catch (e) { /* keyboard optional */ }

    /* ======================================================================
     * 14. GAME FLOW
     * ==================================================================== */
    function resetRun() {
      worldSeed = (Date.now() % 100000) | 0;
      rng = mulberry32(worldSeed);
      buildFarLayers();
      lookCache.clear();
      pax = []; floats = []; banners = [];
      S.t = 0; S.served = 0; S.points = 0; S.misses = 0; S.chain = 0; S.mult = 1; S.comboT = 0; S.streak = 0;
      S.nextMilestone = 0; S.overT = 0; S.newBestShown = false; S.d = 0;
      S.bestAtStart = Math.max(S.best, storedBest);
      S.best = S.bestAtStart;
      scoreServed.reset(); scorePoints.reset();
      E.p = 1; E.v = 0; E.mode = "idle"; E.target = 1; E.seq = null; E.doors = 0; E.travel = 0; E.bounceT = 9;
      camY = 1.25; pullT = 99; pulseT = 99;
      spawnT = 0;
      script = [{ t: 0, f: 3, dest: 6 }, { t: 5.5, f: 5, dest: 2 }, { t: 9.5, f: 2, dest: 8 }];
      spawnTick(0); // the first passenger is already waiting on the title screen
    }
    function userGesture() {
      audio.init();
      if (S.mode === "title") startRun();
    }
    function startRun() {
      S.mode = "play";
      S.bestAtStart = Math.max(S.best, storedBest);
      S.best = S.bestAtStart;
      S.attempt++;
      S.runsThisSession++;
      try { ctx.platform.start({ attempt: S.attempt }); } catch (e) { /* lifecycle */ }
    }
    function restart() {
      resetRun();
      startRun();
    }
    function gameOver() {
      if (S.mode !== "play") return;
      S.mode = "over"; S.overT = 0;
      audio.play("over");
      haptic("error");
      if (S.served > storedBest) { storedBest = S.served; saveBest(S.served); }
      S.best = Math.max(S.best, S.served);
      scoreServed.set(S.served);
      const attempt = S.attempt;
      try {
        scoreServed.submit("served", { label: S.served + " served" }).catch(() => {});
      } catch (e) { /* records optional */ }
      try { ctx.platform.fail({ score: S.served, points: S.points, floor: Math.round(E.p), attempt }); } catch (e) { /* lifecycle */ }
    }

    let lastDt = 0;
    resetRun();

    ctx.game.loop({
      input,
      fixedHz: 120,
      maxDeltaMs: 100,
      fixedUpdate(stepMs) {
        const dt = stepMs / 1000;
        if (S.mode === "play") {
          stepElevator(dt, axis);
        } else if (S.mode === "over") {
          E.v = approach(E.v, 0, CFG.elevator_deceleration * 2 * dt);
          E.p = Math.max(1, E.p + E.v * dt);
        }
      },
      update(dtMs) {
        const dt = Math.min(dtMs, 100) / 1000;
        lastDt = dt;
        perfNow += dt;
        if (input.pressed) {
          userGesture();
          if (S.mode === "over" && S.overT > 0.75) restart();
        }
        axis = readAxis();
        if (S.mode === "play") {
          S.t += dt;
          S.d = difficultyAt(S.t);
          spawnTick(dt);
          if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) { S.chain = 0; S.mult = 1; } }
          if (S.hint === 0 && Math.abs(E.p - 1) > 0.5) S.hint = 1;
        } else if (S.mode === "over") {
          S.overT += dt;
        }
        updatePassengers(dt);
        updateCamera(dt);
        E.bounceT += dt;
        pullT += dt;
        pulseT += dt;
        audio.update(Math.abs(E.v) / CFG.elevator_max_speed, camY, rainAt(camY), S.mode === "play");
      },
      render
    });

    render();
    try { ctx.markVisualReady("first-frame"); } catch (e) { /* older hosts */ }
    ctx.platform.ready();
  }
};
