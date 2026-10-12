window.plethoraBit = {
  meta: {
    title: "Don't Wake It",
    runtime: "plethora-bit@2",
    tags: ["game", "stealth", "climbing", "endless", "atmospheric"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // =====================================================================
    // 1. CONFIG — every gameplay variable lives here. Draft tuning knobs
    //    (manifest.tuning) override the defaults at the start of each run.
    // =====================================================================
    const W = 360; // logical world width in units; the screen shows exactly this width
    const tuneNum = (id, fallback) => {
      try {
        const v = ctx.tune && ctx.tune.has && ctx.tune.has(id) ? ctx.tune.get(id) : undefined;
        return typeof v === "number" && Number.isFinite(v) ? v : fallback;
      } catch (e) { return fallback; }
    };

    function readConfig() {
      return {
        METERS_PER_UNIT: 0.1,

        PLAYER_WALK_SPEED: tuneNum("walk_speed", 70),
        PLAYER_RUN_SPEED: tuneNum("run_speed", 140),
        RUN_DRAG_PX: 38,               // slide a held finger this far outward to hurry (Shift on keyboard)
        PLAYER_ACCELERATION: 640,
        PLAYER_DECELERATION: 1150,
        PLAYER_JUMP_FORCE: tuneNum("jump_force", 505),
        GRAVITY: tuneNum("gravity", 1380),
        AIR_CONTROL: 0.6,
        MAX_FALL_SPEED: 1150,
        LANDING_IMPACT: 505,           // impact speed that counts as an ordinary landing
        LANDING_RECOVERY_MS: 150,
        JUMP_ANTICIPATION_MS: 70,
        COYOTE_MS: 90,
        JUMP_BUFFER_MS: 150,
        COLLISION_RADIUS: 6,
        VINE_CLIMB_SPEED: 52,
        MUSHROOM_BOUNCE: 780,

        BASE_WALK_NOISE: 0.55,
        RUN_NOISE: 1.3,
        JUMP_NOISE: 2.2,
        LANDING_NOISE: 6.0,
        SURFACE_NOISE_MULTIPLIERS: { fur: 0.7, moss: 0.9, stones: 3.6, mushroom: 1.7, skin: 11, ruin: 2.3, vine: 0.3 },
        NOISE_SCALE: tuneNum("noise_scale", 1),
        STATE_NOISE_AMPLIFY: 1 / 200,  // a stirring creature reacts more strongly
        MAX_EVENT_NOISE: 40,
        RESET_SETTLE_NOISE: 1.0,       // events at least this loud restart the settle timer
        STREAK_BREAK_NOISE: 7.5,       // events at least this loud end a quiet streak

        ALERTNESS_DECAY_RATE: tuneNum("calm_rate", 6.5),
        SETTLE_DELAY_MS: 900,
        MOVING_DECAY_FACTOR: 0.4,
        ALERTNESS_THRESHOLD_DISTURBED: 25,
        ALERTNESS_THRESHOLD_STIRRING: 55,
        ALERTNESS_THRESHOLD_AWAKE: 100,

        CREATURE_BREATHING_SPEED: tuneNum("breathing_speed", 1),
        CREATURE_MOVEMENT_INTENSITY: tuneNum("creature_movement", 1),

        DREAM_SEED_SPAWN_RATE: tuneNum("seed_frequency", 0.55),
        RARE_SEED_CHANCE: tuneNum("rare_seed_chance", 0.35),
        ANCIENT_SEED_CHANCE: 0.4,
        COLLECTIBLE_SCORE: { common: 1, rare: 3, ancient: 8 }, // memory light each seed is worth
        RARE_LIGHT_PER_FRAGMENT: 9,    // every 9 light from rare seeds reveals a fragment

        WORLD_GENERATION_DISTANCE: 1300,
        TERRAIN_VARIATION: tuneNum("terrain_variation", 1),
        SAFE_ROUTE_FREQUENCY: 0.6,
        CAMERA_FOLLOW_SPEED: tuneNum("camera_follow", 4.5),
        ENVIRONMENT_TRANSITION_SPEED: tuneNum("environment_speed", 1),
        MASTER_VOLUME: tuneNum("master_volume", 0.8)
      };
    }
    let CFG = readConfig();

    // DIFFICULTY_CURVE: height in metres -> 0..1 difficulty (terrain hazards, creature sensitivity)
    const DIFFICULTY_POINTS = [[0, 0], [60, 0.08], [180, 0.28], [450, 0.6], [900, 0.86], [1600, 1]];
    function difficultyAt(m) {
      try {
        if (ctx.tune && ctx.tune.has && ctx.tune.has("difficulty_ramp")) {
          const v = ctx.tune.curve("difficulty_ramp").at(m);
          if (Number.isFinite(v)) return clamp(v, 0, 1);
        }
      } catch (e) { /* fall through to built-in curve */ }
      return piecewise(DIFFICULTY_POINTS, m);
    }
    const sensitivityAt = m => 1 + 0.6 * difficultyAt(m);

    // =====================================================================
    // 2. UTILITIES
    // =====================================================================
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = t => t * t * (3 - 2 * t);
    const approach = (v, target, amt) => (v < target ? Math.min(v + amt, target) : Math.max(v - amt, target));
    function piecewise(pts, x) {
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) {
          const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
          return lerp(pts[i - 1][1], pts[i][1], smooth(t));
        }
      }
      return pts[pts.length - 1][1];
    }
    function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
    function makeRng(seed) {
      let a = seed >>> 0;
      const f = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return {
        f,
        range: (lo, hi) => lo + (hi - lo) * f(),
        chance: p => f() < p,
        pick: arr => arr[Math.floor(f() * arr.length)],
        weighted(table) {
          let total = 0;
          for (const k in table) total += Math.max(0, table[k]);
          let r = f() * total;
          for (const k in table) { r -= Math.max(0, table[k]); if (r <= 0) return k; }
          return Object.keys(table)[0];
        }
      };
    }
    function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    function rgba(c, a) {
      return a === undefined || a >= 1
        ? "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"
        : "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + Math.max(0, a).toFixed(3) + ")";
    }
    const fmt = n => Math.max(0, Math.floor(n)).toLocaleString("en-US");

    // =====================================================================
    // 3. PALETTE — continuous environmental states keyed by height (m)
    // =====================================================================
    const PALETTE_KEYS = [
      { m: 0, night: 0, c: { skyTop: "#a3a8cc", skyMid: "#dcb6b9", skyBot: "#f8d6b6", haze: "#f3dccb", far: "#d7b1ad", far2: "#deb7b0", cloud: "#fcf0e4", furHi: "#fdf1e4", fur: "#ecccbb", furLo: "#a98aa4", veg: "#8f9c6a", vegDk: "#56653f", flower: "#da7a61", stone: "#b39d97", skin: "#e9a59c", ruin: "#b9a5a8", cap: "#e3877f", light: "#fff0d4" } },
      { m: 140, night: 0, c: { skyTop: "#94a2ca", skyMid: "#d0b5c1", skyBot: "#f3d1b7", haze: "#ecd8cc", far: "#c8a7b1", far2: "#d2b0b2", cloud: "#faeee4", furHi: "#fbefe3", fur: "#e3c1b6", furLo: "#9c84a6", veg: "#83955f", vegDk: "#4f5f3c", flower: "#e0896f", stone: "#a99594", skin: "#e6a09a", ruin: "#ae9ca6", cap: "#e0817e", light: "#fff0d8" } },
      { m: 320, night: 0.05, c: { skyTop: "#7c7cb3", skyMid: "#c999a9", skyBot: "#f4b996", haze: "#e6bfb1", far: "#b48ea6", far2: "#c4949e", cloud: "#f7ddcc", furHi: "#fde3cd", fur: "#dcaca2", furLo: "#81699a", veg: "#7a8858", vegDk: "#4a573a", flower: "#e58a69", stone: "#a08a8f", skin: "#e5978f", ruin: "#a28ea0", cap: "#dd7b76", light: "#ffd9b0" } },
      { m: 540, night: 0.35, c: { skyTop: "#47447f", skyMid: "#87719f", skyBot: "#d49a9b", haze: "#a8909f", far: "#7f6e9a", far2: "#8c7799", cloud: "#dbbfc6", furHi: "#f0d2d2", fur: "#b896ab", furLo: "#5a5584", veg: "#63725a", vegDk: "#3e4a40", flower: "#d98a86", stone: "#8c7f93", skin: "#d48d93", ruin: "#8e819c", cap: "#c7727c", light: "#f6c9b4" } },
      { m: 780, night: 1, c: { skyTop: "#121a38", skyMid: "#283062", skyBot: "#454a82", haze: "#3a4074", far: "#2f3564", far2: "#363c6e", cloud: "#6a71a6", furHi: "#d9dcf7", fur: "#8789bb", furLo: "#363a6c", veg: "#4d665e", vegDk: "#2f4342", flower: "#a596e0", stone: "#6e6f93", skin: "#a07fa6", ruin: "#6f6f98", cap: "#a86f96", light: "#dfe5ff" } },
      { m: 1150, night: 1, c: { skyTop: "#0d1029", skyMid: "#211c49", skyBot: "#3a2d61", haze: "#33295d", far: "#2a2552", far2: "#2f2858", cloud: "#5c5390", furHi: "#d3c9f2", fur: "#7c74ae", furLo: "#2f2a5f", veg: "#4a5f63", vegDk: "#2a3842", flower: "#c3a2ea", stone: "#64608e", skin: "#9c78a8", ruin: "#66628f", cap: "#9a6aa0", light: "#e9ddff" } }
    ];
    for (const k of PALETTE_KEYS) for (const n in k.c) k.c[n] = hexRgb(k.c[n]);
    const palCache = new Map();
    function palAt(meters) {
      const m = Math.max(0, meters * CFG.ENVIRONMENT_TRANSITION_SPEED);
      const key = Math.round(m / 3);
      let pal = palCache.get(key);
      if (pal) return pal;
      const keys = PALETTE_KEYS;
      let i = 1;
      while (i < keys.length - 1 && m > keys[i].m) i++;
      const a = keys[i - 1], b = keys[i];
      const t = smooth(clamp((m - a.m) / (b.m - a.m), 0, 1));
      pal = { night: lerp(a.night, b.night, t) };
      for (const n in a.c) pal[n] = mixRgb(a.c[n], b.c[n], t);
      if (palCache.size > 600) palCache.clear();
      palCache.set(key, pal);
      return pal;
    }
    const INK = hexRgb("#2b2433");
    const CREAM = hexRgb("#fbf3ea");
    const NAVY = hexRgb("#1b2034");
    const SEED_COLORS = {
      common: { core: hexRgb("#fff6e2"), petal: hexRgb("#f4e6cc"), glow: hexRgb("#ffe7b4"), stem: 9, glowR: 15 },
      rare: { core: hexRgb("#eefffb"), petal: hexRgb("#a9e2db"), alt: hexRgb("#d4c6f2"), glow: hexRgb("#bdf0e8"), stem: 11, glowR: 21 },
      ancient: { core: hexRgb("#fff2cf"), petal: hexRgb("#e7bf74"), alt: hexRgb("#f4dca2"), glow: hexRgb("#f6d48e"), stem: 12, glowR: 28 }
    };
    const FONT_NUM = '"Bebas Neue", "Oswald", "Arial Narrow", "Helvetica Neue", sans-serif';
    const FONT_UI = '"Inter", "Helvetica Neue", "Segoe UI", system-ui, sans-serif';
    const FONT_SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';

    // =====================================================================
    // 4. PERSISTENCE — best height, seeds, memory fragments (local only)
    // =====================================================================
    const SAVE_KEY = "dont_wake_it_v1";
    const canStore = !!(ctx.storage && (!ctx.capabilities || ctx.capabilities.storage !== false));
    function defaultSave() { return { best: 0, totalSeeds: 0, rareLight: 0, ancient: 0, fragments: [], muted: false, runs: 0 }; }
    function loadSave() {
      const s = defaultSave();
      if (!canStore) return s;
      try {
        const raw = ctx.storage.get(SAVE_KEY);
        if (raw && typeof raw === "object") {
          if (Number.isFinite(raw.best)) s.best = clamp(raw.best, 0, 1e7);
          if (Number.isFinite(raw.totalSeeds)) s.totalSeeds = clamp(Math.floor(raw.totalSeeds), 0, 1e7);
          if (Number.isFinite(raw.rareLight)) s.rareLight = clamp(Math.floor(raw.rareLight), 0, 1e7);
          if (Number.isFinite(raw.ancient)) s.ancient = clamp(Math.floor(raw.ancient), 0, 1e7);
          if (Number.isFinite(raw.runs)) s.runs = clamp(Math.floor(raw.runs), 0, 1e7);
          if (Array.isArray(raw.fragments)) {
            s.fragments = raw.fragments.filter(i => Number.isInteger(i) && i >= 0 && i < FRAGMENTS.length)
              .filter((v, i, arr) => arr.indexOf(v) === i);
          }
          s.muted = raw.muted === true;
        }
      } catch (e) { /* corrupted or unavailable storage: play with fresh progress */ }
      return s;
    }
    function persist() {
      if (!canStore) return;
      try { ctx.storage.set(SAVE_KEY, save); } catch (e) { /* storage full or unavailable */ }
    }

    // The Creature's Memory: twelve fragments revealed by rare and ancient seeds.
    const FRAGMENTS = [
      { name: "Moonpetal", note: "An unfamiliar flower" },
      { name: "Lantern Caps", note: "A new mushroom now grows" },
      { name: "The Sleeper's Stars", note: "A constellation in the night" },
      { name: "Spiral Sigil", note: "Markings on a distant ridge" },
      { name: "Drift Mites", note: "Tiny lights in the fur" },
      { name: "Whorl of the Coat", note: "A pattern in its markings" },
      { name: "Glowbells", note: "They grow along safe paths" },
      { name: "The Old Sea", note: "Where it slept before" },
      { name: "Ember Fern", note: "Warm leaves in cold places" },
      { name: "First Breath", note: "The oldest sound it made" },
      { name: "The Long Dream", note: "What it sees while sleeping" },
      { name: "Its True Shape", note: "The sky remembers it" }
    ];
    const save = loadSave();
    const hasFragment = i => save.fragments.indexOf(i) >= 0;

    // =====================================================================
    // 5. AUDIO — small procedural Web Audio graph, started from a gesture
    // =====================================================================
    const audio = { ac: null, master: null, noise: null, failed: false, breathGain: null, windGain: null, rumbleGain: null, padGain: null, breathFilter: null };
    function audioInit() {
      if (audio.ac || audio.failed) return;
      if (ctx.capabilities && ctx.capabilities.audio === false) { audio.failed = true; return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { audio.failed = true; return; }
        const ac = new AC();
        audio.ac = ac;
        audio.master = ac.createGain();
        audio.master.gain.value = save.muted ? 0 : CFG.MASTER_VOLUME;
        audio.master.connect(ac.destination);
        const len = ac.sampleRate * 2;
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; data[i] = last; }
        audio.noise = buf;
        // Breathing bed: noise through a lowpass, swelled by the creature's breath.
        const breathSrc = ac.createBufferSource(); breathSrc.buffer = buf; breathSrc.loop = true;
        audio.breathFilter = ac.createBiquadFilter(); audio.breathFilter.type = "lowpass"; audio.breathFilter.frequency.value = 380;
        audio.breathGain = ac.createGain(); audio.breathGain.gain.value = 0;
        breathSrc.connect(audio.breathFilter); audio.breathFilter.connect(audio.breathGain); audio.breathGain.connect(audio.master);
        breathSrc.start();
        // Wind at height.
        const windSrc = ac.createBufferSource(); windSrc.buffer = buf; windSrc.loop = true; windSrc.playbackRate.value = 0.7;
        const windF = ac.createBiquadFilter(); windF.type = "bandpass"; windF.frequency.value = 520; windF.Q.value = 0.6;
        audio.windGain = ac.createGain(); audio.windGain.gain.value = 0;
        windSrc.connect(windF); windF.connect(audio.windGain); audio.windGain.connect(audio.master);
        windSrc.start();
        // Low rumble that rises with alertness.
        const r1 = ac.createOscillator(); r1.type = "sine"; r1.frequency.value = 41;
        const r2 = ac.createOscillator(); r2.type = "triangle"; r2.frequency.value = 55.5;
        const rf = ac.createBiquadFilter(); rf.type = "lowpass"; rf.frequency.value = 140;
        audio.rumbleGain = ac.createGain(); audio.rumbleGain.gain.value = 0;
        r1.connect(rf); r2.connect(rf); rf.connect(audio.rumbleGain); audio.rumbleGain.connect(audio.master);
        r1.start(); r2.start();
        // Quiet harmonic pad for the sleeping world.
        audio.padGain = ac.createGain(); audio.padGain.gain.value = 0;
        const padF = ac.createBiquadFilter(); padF.type = "lowpass"; padF.frequency.value = 900;
        for (const f of [110, 164.8, 220.5]) {
          const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = f;
          const og = ac.createGain(); og.gain.value = f > 200 ? 0.25 : 0.5;
          o.connect(og); og.connect(padF); o.start();
        }
        padF.connect(audio.padGain); audio.padGain.connect(audio.master);
      } catch (e) {
        audio.failed = true;
        audio.ac = null;
      }
    }
    function audioResume() { try { if (audio.ac && audio.ac.state === "suspended") audio.ac.resume(); } catch (e) { /* ignore */ } }
    function setMuted(m) {
      save.muted = m; persist();
      if (audio.master && audio.ac) audio.master.gain.setTargetAtTime(m ? 0 : CFG.MASTER_VOLUME, audio.ac.currentTime, 0.05);
    }
    function noiseBurst(opts) {
      const ac = audio.ac; if (!ac || save.muted) return;
      const t = ac.currentTime + (opts.delay || 0);
      const src = ac.createBufferSource(); src.buffer = audio.noise;
      src.playbackRate.value = opts.rate || 1;
      const f = ac.createBiquadFilter(); f.type = opts.type || "bandpass"; f.frequency.value = opts.freq || 800; f.Q.value = opts.q || 0.8;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.vol), t + (opts.attack || 0.004));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack || 0.004) + opts.dur);
      src.connect(f); f.connect(gn); gn.connect(audio.master);
      src.start(t, Math.random() * 1.5); src.stop(t + opts.dur + 0.05);
    }
    function tone(opts) {
      const ac = audio.ac; if (!ac || save.muted) return;
      const t = ac.currentTime + (opts.delay || 0);
      const o = ac.createOscillator(); o.type = opts.type || "sine";
      o.frequency.setValueAtTime(opts.freq, t);
      if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.vol), t + (opts.attack || 0.01));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
      o.connect(gn); gn.connect(audio.master);
      o.start(t); o.stop(t + opts.dur + 0.05);
    }
    const sfx = {
      step(surface, loud, run) {
        const v = clamp(loud, 0.15, 1.6);
        if (surface === "stones") {
          noiseBurst({ freq: 2600, q: 1.3, vol: 0.05 * v, dur: 0.05 });
          noiseBurst({ freq: 3800, q: 2, vol: 0.03 * v, dur: 0.03, delay: 0.035 });
        } else if (surface === "skin") {
          noiseBurst({ type: "lowpass", freq: 260, q: 0.7, vol: 0.09 * v, dur: 0.09 });
          tone({ freq: 86, to: 60, vol: 0.05 * v, dur: 0.14 });
        } else if (surface === "ruin") {
          noiseBurst({ freq: 540, q: 9, vol: 0.05 * v, dur: 0.28 });
        } else if (surface === "vine") {
          noiseBurst({ freq: 1500, q: 0.6, vol: 0.012, dur: 0.06 });
        } else {
          noiseBurst({ freq: surface === "moss" ? 950 : 720, q: 0.7, vol: (run ? 0.035 : 0.022) * v, dur: run ? 0.07 : 0.06 });
        }
      },
      land(surface, factor) {
        const v = clamp(0.4 + factor * 0.5, 0.3, 2);
        if (surface === "mushroom") { tone({ freq: 170, to: 430, vol: 0.06, dur: 0.26 }); noiseBurst({ type: "lowpass", freq: 300, vol: 0.05, dur: 0.1 }); return; }
        if (surface === "stones") { for (let i = 0; i < 4; i++) noiseBurst({ freq: 2200 + i * 500, q: 1.5, vol: 0.05 * v, dur: 0.04, delay: i * 0.03 + Math.random() * 0.02 }); }
        if (surface === "ruin") { noiseBurst({ freq: 520, q: 12, vol: 0.07 * v, dur: 0.6 }); noiseBurst({ freq: 1040, q: 14, vol: 0.03 * v, dur: 0.5 }); }
        if (surface === "skin") { tone({ freq: 70, to: 48, vol: 0.12 * v, dur: 0.3 }); }
        noiseBurst({ type: "lowpass", freq: 340, q: 0.6, vol: 0.06 * v, dur: 0.12 });
      },
      jump() { noiseBurst({ freq: 1100, q: 0.5, vol: 0.018, dur: 0.06 }); },
      chime(rarity) {
        if (rarity === "ancient") {
          [880, 1108.7, 1318.5, 1760].forEach((f, i) => tone({ freq: f, vol: 0.045, dur: 1.6, delay: i * 0.07, attack: 0.02 }));
        } else if (rarity === "rare") {
          [1174.7, 1760, 2637].forEach((f, i) => tone({ freq: f, vol: 0.04 - i * 0.008, dur: 1.2, delay: i * 0.045, attack: 0.01 }));
        } else {
          tone({ freq: 1318.5, vol: 0.035, dur: 0.9 }); tone({ freq: 1975.5, vol: 0.018, dur: 0.7, delay: 0.03 });
        }
      },
      stir() { tone({ freq: 62, to: 48, vol: 0.12, dur: 1.2, attack: 0.25 }); },
      settle() { tone({ freq: 523, to: 349, vol: 0.022, dur: 1.1, attack: 0.08 }); },
      streak() { tone({ freq: 1568, vol: 0.02, dur: 0.8 }); tone({ freq: 2349, vol: 0.012, dur: 0.7, delay: 0.06 }); },
      shift() { noiseBurst({ type: "lowpass", freq: 160, q: 0.7, vol: 0.12, dur: 0.9, attack: 0.15 }); },
      wake() {
        const ac = audio.ac; if (!ac || save.muted) return;
        const t = ac.currentTime;
        const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(46, t); o.frequency.linearRampToValueAtTime(38, t + 2.2);
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(90, t); f.frequency.exponentialRampToValueAtTime(520, t + 1.1); f.frequency.exponentialRampToValueAtTime(120, t + 2.4);
        const gn = ac.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.22, t + 0.6); gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(f); f.connect(gn); gn.connect(audio.master); o.start(t); o.stop(t + 2.7);
        noiseBurst({ type: "lowpass", freq: 200, vol: 0.2, dur: 1.8, attack: 0.3 });
      },
      ui() { tone({ freq: 880, vol: 0.02, dur: 0.15 }); }
    };
    function updateAmbientAudio() {
      const ac = audio.ac; if (!ac) return;
      const t = ac.currentTime;
      const m = cam.y * CFG.METERS_PER_UNIT;
      const inhale = Math.max(0, creature.breathVel);
      const playing = game.state === "play" || game.state === "title";
      const lvl = creature.shown / 100;
      audio.breathGain.gain.setTargetAtTime(playing ? 0.006 + inhale * (0.02 + lvl * 0.05) : 0.003, t, 0.15);
      audio.breathFilter.frequency.setTargetAtTime(300 + inhale * 260 + lvl * 220, t, 0.2);
      audio.windGain.gain.setTargetAtTime(0.004 + clamp(m / 900, 0, 1) * 0.022, t, 0.5);
      const rumble = game.state === "waking" ? 0.16 : clamp((creature.shown - 18) / 82, 0, 1) * 0.12 + (creature.shift ? 0.05 : 0);
      audio.rumbleGain.gain.setTargetAtTime(rumble, t, 0.3);
      audio.padGain.gain.setTargetAtTime(playing ? 0.011 * (1 - clamp((creature.shown - 30) / 50, 0, 1)) : 0.004, t, 0.8);
    }
    function haptic(kind) {
      if (ctx.capabilities && ctx.capabilities.haptics === false) return;
      try { ctx.platform.haptic(kind); } catch (e) { /* no haptics */ }
    }

    // =====================================================================
    // 6. WORLD GENERATION — one continuous creature, generated in sweeps
    //    Each sweep is a switchback of fur paths climbing across the body.
    //    Between sweeps we place ledges, vines and mushrooms (alternate,
    //    riskier routes) and Dream Seeds with deliberate intent.
    // =====================================================================
    const world = { platforms: [], vines: [], seeds: [], eyes: [], rng: makeRng(1), gen: null, nextId: 1 };

    function jumpHeight() { return CFG.PLAYER_JUMP_FORCE * CFG.PLAYER_JUMP_FORCE / (2 * CFG.GRAVITY); }
    function hopLimit() { return Math.min(jumpHeight() * 0.84, 92); }
    function gapLimit() {
      const air = 2 * CFG.PLAYER_JUMP_FORCE / CFG.GRAVITY;
      return clamp(CFG.PLAYER_WALK_SPEED * air * 0.72, 14, 46);
    }

    function surfaceAt(p, x) {
      const pts = p.pts;
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) {
          const a = pts[i - 1], b = pts[i];
          return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
        }
      }
      return pts[pts.length - 1][1];
    }
    function slopeAt(p, x) {
      const pts = p.pts;
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) return (pts[i][1] - pts[i - 1][1]) / (pts[i][0] - pts[i - 1][0]);
      }
      return 0;
    }

    function addDeco(p, R, m) {
      const deco = [];
      const len = p.x1 - p.x0;
      const night = palAt(m).night;
      const s = p.surface;
      const lantern = hasFragment(1), glowbells = hasFragment(6), embers = hasFragment(8);
      const count = Math.min(9, Math.floor(len / (s === "moss" ? 16 : 24)));
      for (let i = 0; i < count; i++) {
        const x = lerp(p.x0 + 6, p.x1 - 6, (i + R.range(0.1, 0.9)) / count);
        let type;
        if (s === "fur") type = R.weighted({ grass: 4, flower: night > 0.6 ? 1.2 : 2.5, shrub: 1.6, pine: len > 60 ? 1.3 * (1 - night * 0.5) : 0, rock: 0.6, glowbell: glowbells ? 0.9 : 0, ember: embers && m > 300 ? 0.5 : 0 });
        else if (s === "moss") type = R.weighted({ moss: 4, fern: 2, flower: 1.4, minimush: 1.2, lantern: lantern ? 1 : 0, glowbell: glowbells ? 0.8 : 0 });
        else if (s === "stones") type = R.weighted({ rock: 2, grass: 1 });
        else if (s === "skin") type = R.weighted({ hair: 2, none: 1.5 });
        else if (s === "ruin") type = R.weighted({ pillar: len > 50 ? 1.2 : 0.4, glyph: 1, moss: 1, none: 1 });
        else type = "none";
        if (type === "none") continue;
        if (type === "pillar" && deco.some(d => d.type === "pillar")) type = "glyph";
        deco.push({ type, x, y: surfaceAt(p, x), h: type === "pine" ? R.range(0.8, 1.5) : R.range(0.7, 1.3), ph: R.range(0, TAU), v: R.f() });
      }
      // trees are drawn first so ground cover overlaps them
      deco.sort((a, b) => (a.type === "pine" ? -1 : 0) - (b.type === "pine" ? -1 : 0));
      p.deco = deco;
      // Fur strokes give the creature's coat its texture.
      const strokes = [];
      if (s !== "skin" && s !== "ruin") {
        const n = Math.min(110, Math.floor(len / 2.6));
        const comb = R.chance(0.5) ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const x = R.range(p.x0 + 2, p.x1 - 2);
          const dy = Math.pow(R.f(), 2.1) * p.depth * 0.62 + 1.2;
          strokes.push({ x, sy: surfaceAt(p, x), dy, len: R.range(2.2, 4.6) * (1 - dy / p.depth * 0.4), a: Math.PI / 2 + comb * R.range(0.35, 0.75), light: dy < 5 || R.chance(0.28) });
        }
      }
      p.strokes = strokes;
      // lumpy underside so each terrace reads as a hanging mass of fur, not a cut column
      const under = [];
      const steps = Math.max(2, Math.round(len / 26));
      for (let i = 0; i <= steps; i++) {
        const x = lerp(p.x1, p.x0, i / steps);
        under.push([x, (i === 0 || i === steps) ? 0.5 : R.range(0.6, 1)]);
      }
      p.under = under;
      // Loose stones sit on top of the stone surface.
      if (s === "stones") {
        const pebbles = [];
        const n = Math.floor(len / 5.5);
        for (let i = 0; i < n; i++) {
          const x = lerp(p.x0 + 2, p.x1 - 2, (i + R.f()) / n);
          pebbles.push({ x, sy: surfaceAt(p, x), r: R.range(2.2, 4.6), ry: R.range(0.55, 0.85), ph: R.range(0, TAU), shade: R.f() });
        }
        p.pebbles = pebbles;
      }
      if (s === "skin") {
        p.veins = [];
        for (let i = 0; i < 3; i++) p.veins.push({ x: R.range(p.x0 + 4, p.x1 - 4), dy: R.range(3, 12), w: R.range(8, 18), ph: R.f() * TAU });
      }
      if (s === "ruin") {
        p.blocks = [];
        let x = p.x0;
        while (x < p.x1 - 2) { const w = Math.min(p.x1 - x, R.range(9, 17)); p.blocks.push({ x, w, h: R.range(6, 10), shade: R.f() }); x += w + 0.8; }
      }
    }

    function makePlatform(kind, surface, pts, opts) {
      pts.sort((a, b) => a[0] - b[0]);
      let yMin = Infinity, yMax = -Infinity;
      for (const q of pts) { if (q[1] < yMin) yMin = q[1]; if (q[1] > yMax) yMax = q[1]; }
      const R = world.rng;
      const p = {
        id: world.nextId++, kind, surface, pts,
        x0: pts[0][0], x1: pts[pts.length - 1][0], yMin, yMax, yMid: (yMin + yMax) / 2,
        depth: opts.depth || (kind === "path" ? R.range(58, 82) : R.range(24, 36)),
        breathK: opts.breathK || R.range(0.65, 1.1),
        shiftK: R.range(0.6, 1.25),
        squash: 0, bridge: !!opts.bridge, stem: opts.stem || null
      };
      if (surface === "skin" && kind === "path") p.depth *= 0.6;
      addDeco(p, R, p.yMid * CFG.METERS_PER_UNIT);
      world.platforms.push(p);
      return p;
    }

    function makePiece(xa, xb, ya, slope, surface) {
      const R = world.rng;
      const L = Math.abs(xb - xa);
      const n = Math.max(2, Math.ceil(L / 30) + 1);
      const ph = R.range(0, TAU);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const x = lerp(xa, xb, i / (n - 1));
        const dist = Math.abs(x - xa);
        let bump = 0;
        if (i > 0 && i < n - 1) {
          if (surface === "fur" || surface === "moss") bump = Math.sin(i * 1.7 + ph) * 2.6 * CFG.TERRAIN_VARIATION;
          else if (surface === "stones") bump = R.range(-1.4, 1.4) * CFG.TERRAIN_VARIATION;
          else if (surface === "skin") bump = Math.sin(i * 2.1 + ph) * 1.4;
        }
        pts.push([x, ya + slope * dist + bump]);
      }
      return makePlatform("path", surface, pts, {});
    }

    function makeLedge(xc, w, y, surface, opts) {
      const half = w / 2;
      const pts = [[xc - half, y - 1.5], [xc - half * 0.4, y + 0.8], [xc + half * 0.4, y + 0.8], [xc + half, y - 1.5]];
      return makePlatform("ledge", surface, pts, opts || {});
    }

    function makeCap(xc, baseY, height) {
      const w = 46;
      const y = baseY + height;
      const pts = [[xc - w / 2, y - 3], [xc - w / 4, y + 1], [xc + w / 4, y + 1], [xc + w / 2, y - 3]];
      return makePlatform("cap", "mushroom", pts, { depth: 12, breathK: 0.9, stem: { baseY } });
    }

    function pickSurface(m, d, prev, forceSafe) {
      const R = world.rng;
      if (forceSafe || prev === "stones" || prev === "skin" || prev === "ruin") return R.chance(m > 40 ? 0.35 : 0.15) ? "moss" : "fur";
      return R.weighted({
        fur: 5,
        moss: m > 40 ? 2.4 * (1 - palAt(m).night * 0.4) : 0.8,
        stones: m > 12 ? 0.8 + 2.2 * d : 0,
        skin: m > 60 ? 0.5 + 1.8 * d : 0,
        ruin: m > 250 ? 0.6 + 1.2 * d : 0
      });
    }

    function sweepYAt(sw, x) {
      for (const p of sw.pieces) if (x >= p.x0 && x <= p.x1) return { y: surfaceAt(p, x), p };
      return null;
    }

    function newWorld(seed) {
      world.platforms.length = 0; world.vines.length = 0; world.seeds.length = 0; world.eyes.length = 0;
      world.rng = makeRng(seed);
      world.nextId = 1;
      // Sweep 0: the soft ground of the tail. Wide, quiet, safe.
      const floorPts = [];
      for (let i = 0; i <= 13; i++) {
        const x = -24 + i * 31;
        floorPts.push([x, Math.max(0, x) * 0.075 + Math.sin(i * 1.3) * 2.2]);
      }
      const floor = makePlatform("path", "fur", floorPts, { depth: 150 });
      const sw0 = { k: 0, dir: 1, pieces: [floor], endX: W - 16, endY: surfaceAt(floor, W - 16), seedCount: 0 };
      world.gen = { last: sw0, sinceSeed: 0, nextEyeY: 520, eyeIdx: 0, eyeAncientPlaced: false };
      // First Dream Seed: easy to reach, teaches the collection feedback.
      addSeed(232, surfaceAt(floor, 232), floor, "common", "safe");
      while (world.gen.last.endY < 900) genNext();
    }

    function genNext() {
      const R = world.rng;
      const prev = world.gen.last;
      const k = prev.k + 1;
      const dir = -prev.dir;
      const m = prev.endY * CFG.METERS_PER_UNIT;
      const d = difficultyAt(m);
      const hop = hopLimit();
      const startX = clamp(prev.endX + prev.dir * R.range(12, 20), 8, W - 8);
      const startY = prev.endY + clamp(R.range(30, 38 + 9 * d), 24, hop - 26);
      const endX = dir > 0 ? W - 34 - R.range(0, 26) : 34 + R.range(0, 26);
      const slope = clamp(R.range(0.13, 0.22 + 0.05 * d) * CFG.TERRAIN_VARIATION, 0.07, 0.34);
      const sw = { k, dir, pieces: [], endX, endY: startY, seedCount: 0 };
      let x = startX, y = startY, prevSurface = "fur";
      let first = true;
      // Intro sweeps are authored for the first minute of play.
      const intro = k <= 3 ? [[["fur", 140], ["gap", 24], ["fur", 999]], [["fur", 110], ["stones", 56], ["fur", 999]], [["moss", 120], ["gap", 20], ["fur", 999]]][k - 1] : null;
      let introIdx = 0;
      let guard = 0;
      while (dir * (endX - x) > 12 && guard++ < 20) {
        const remaining = Math.abs(endX - x);
        let surface, len;
        if (intro) {
          let step = intro[Math.min(introIdx++, intro.length - 1)];
          if (step[0] === "gap") { x += dir * step[1]; y += slope * step[1] + 2; step = intro[Math.min(introIdx++, intro.length - 1)]; }
          surface = step[0]; len = Math.min(remaining, step[1]);
        } else {
          len = Math.min(remaining, R.range(70, 170));
          if (remaining - len < 40) len = remaining;
          const nearEnd = remaining - len < 50;
          surface = pickSurface(m, d, prevSurface, first || nearEnd);
          if (surface === "skin") len = Math.min(len, R.range(24, 36));
          if (surface === "stones") len = Math.min(len, R.range(40, 90));
          if (surface === "ruin") len = Math.min(len, R.range(50, 90));
        }
        const xb = x + dir * len;
        const piece = makePiece(x, xb, y, slope, surface);
        sw.pieces.push(piece);
        x = xb; y += slope * len; prevSurface = surface; first = false;
        sw.endY = y;
        if (!intro && dir * (endX - x) > 50 && surface !== "skin" && R.chance(0.3 + 0.3 * d)) {
          const gap = R.range(16, Math.max(18, gapLimit() * (0.6 + 0.4 * d)));
          x += dir * gap; y += slope * gap + R.range(0, 5);
          prevSurface = "fur";
        }
      }
      sw.endX = x;
      sw.endY = sw.pieces.length ? surfaceAt(sw.pieces[sw.pieces.length - 1], x) : y;
      placeFeatures(prev, sw, m, d);
      world.gen.last = sw;
    }

    function placeFeatures(A, B, m, d) {
      const R = world.rng;
      const hop = hopLimit();
      const k = B.k;
      const samples = [];
      for (let x = 24; x <= W - 24; x += 6) {
        const a = sweepYAt(A, x), b = sweepYAt(B, x);
        if (a && b) samples.push({ x, a: a.y, pa: a.p, b: b.y, pb: b.p, gap: b.y - a.y });
      }
      const used = [];
      const free = x => used.every(u => Math.abs(u - x) > 62);
      const pickSample = (fn) => {
        const options = samples.filter(s => fn(s) && free(s.x));
        return options.length ? R.pick(options) : null;
      };
      const options = { safe: [], risky: [], rareSpot: [] };
      // Mark an anatomical landmark (a giant closed eye) when the climb passes one.
      let eyeHere = false;
      if (B.endY > world.gen.nextEyeY) {
        world.eyes.push({ y: world.gen.nextEyeY + 60, side: world.gen.eyeIdx % 2 === 0 ? 1 : -1, twitch: 0, twitchCd: R.range(2, 6) });
        world.gen.eyeIdx++;
        world.gen.nextEyeY += R.range(1050, 1350);
        eyeHere = true;
      }

      const wantLedge = k === 2 || (k > 3 && R.chance(0.62));
      const wantVine = k === 3 || (k > 3 && R.chance(CFG.SAFE_ROUTE_FREQUENCY * 0.6));
      const wantMush = k === 3 || (k > 3 && m > 20 && R.chance(0.32));

      if (wantLedge) {
        const bridge = m > 120 && R.chance(0.18);
        const maxHalf = bridge ? hop - 20 : hop - 6;
        const s = pickSample(q => q.gap >= 90 && q.gap <= maxHalf * 2 && q.pa.surface !== "skin");
        if (s) {
          used.push(s.x);
          let surface = k === 2 ? "stones" : R.weighted({ moss: 1.4 - d, stones: 1, skin: m > 60 ? 0.6 * d + 0.2 : 0, ruin: m > 250 ? 0.8 : 0 });
          if (bridge) surface = "fur";
          const w = bridge ? R.range(40, 52) : R.range(34, 62 - 16 * d);
          const ly = s.a + s.gap * R.range(0.46, 0.54);
          const lx = clamp(s.x + R.range(-10, 10), 14 + w / 2, W - 14 - w / 2);
          const ledge = makeLedge(lx, w, ly, surface, bridge ? { breathK: 4.2, bridge: true } : {});
          const risky = surface !== "moss" || bridge || w < 40;
          (risky ? options.risky : options.safe).push({ x: lx + R.range(-w * 0.25, w * 0.25), p: ledge, kind: bridge ? "bridge" : "ledge" });
          if ((surface === "ruin" || bridge) && m > 150) options.rareSpot.push({ x: lx, p: ledge, kind: surface === "ruin" ? "ruin" : "bridge" });
        }
      }
      if (wantVine) {
        const s = pickSample(q => q.gap >= 88 && q.gap <= 215 && q.pb.surface !== "skin" && q.x > 30 && q.x < W - 30);
        if (s) {
          used.push(s.x);
          world.vines.push({ x: s.x, yTop: s.b - 2, yBot: s.a + 30, ph: R.range(0, TAU), leaves: Math.floor(R.range(4, 8)) });
          options.safe.push({ x: s.x + R.range(-18, 18), p: s.pb, kind: "vineTop" });
        }
      }
      if (wantMush) {
        const s = pickSample(q => q.gap >= 100 && q.gap <= 200 && (q.pa.surface === "fur" || q.pa.surface === "moss") && q.x > q.pa.x0 + 24 && q.x < q.pa.x1 - 24);
        if (s) {
          used.push(s.x);
          const cap = makeCap(s.x, s.a, 34);
          options.risky.push({ x: s.x, p: cap, kind: "mushroom", y: cap.yMax + 70 });
        }
      }
      // Main-path spots: just beyond a gap, on skin, or on safe fur/moss.
      for (let i = 0; i < B.pieces.length; i++) {
        const p = B.pieces[i];
        if (p.surface === "skin" && p.x1 - p.x0 > 20) options.risky.push({ x: (p.x0 + p.x1) / 2, p, kind: "skin" });
        else if (p.surface === "stones") options.risky.push({ x: lerp(p.x0, p.x1, R.range(0.3, 0.7)), p, kind: "stones" });
        else if (p.x1 - p.x0 > 40) options.safe.push({ x: lerp(p.x0 + 10, p.x1 - 10, R.f()), p, kind: "path" });
      }

      // Dream Seeds: quiet stretches are deliberate, rarity follows risk, height and landmarks.
      const gen = world.gen;
      let chance = CFG.DREAM_SEED_SPAWN_RATE * (gen.sinceSeed >= 2 ? 1.35 : gen.sinceSeed === 1 ? 0.75 : 0.3);
      if (k === 2 || k === 3) chance = 1;
      if (k === 1) chance = 0;
      if (eyeHere && m > 150) chance = 1;
      if (R.chance(chance) && (options.risky.length || options.safe.length)) {
        let spot, placement;
        if (eyeHere && m > 150 && (options.risky.length || options.rareSpot.length)) {
          spot = options.rareSpot.length ? R.pick(options.rareSpot) : R.pick(options.risky);
          placement = "landmark";
        } else if (options.rareSpot.length && R.chance(0.5)) {
          spot = R.pick(options.rareSpot); placement = "rareSpot";
        } else if (options.risky.length && (R.chance(0.6) || !options.safe.length)) {
          spot = R.pick(options.risky); placement = "risky";
        } else {
          spot = R.pick(options.safe); placement = "safe";
        }
        let rarity = "common";
        if (placement === "landmark") rarity = R.chance(Math.min(0.9, CFG.ANCIENT_SEED_CHANCE * 1.8)) ? "ancient" : "rare";
        else if (placement === "rareSpot") rarity = spot.kind === "ruin" && m > 250 && R.chance(CFG.ANCIENT_SEED_CHANCE * 0.6) ? "ancient" : "rare";
        else if (placement === "risky") rarity = m > 25 && R.chance(CFG.RARE_SEED_CHANCE + 0.25 * d) ? "rare" : "common";
        else rarity = m > 200 && R.chance(0.08) ? "rare" : "common";
        if (k <= 3) rarity = "common";
        const sx = clamp(spot.x, spot.p.x0 + 4, spot.p.x1 - 4);
        const sy = spot.y !== undefined ? spot.y : surfaceAt(spot.p, sx);
        addSeed(sx, sy, spot.p, rarity, placement, spot.y !== undefined);
        gen.sinceSeed = 0;
      } else {
        gen.sinceSeed++;
      }
    }

    function addSeed(x, y, p, rarity, placement, float) {
      world.seeds.push({ x, y, p, rarity, placement, float: !!float, ph: world.rng.range(0, TAU), taken: false, takeT: 0, alt: world.rng.chance(0.5) });
    }

    function recycleWorld() {
      const bottom = cam.y - (VH - ANCHOR) / S - 320;
      const keepBelow = Math.min(bottom, P.y - 420);
      world.platforms = world.platforms.filter(p => p.yMax > keepBelow || p.kind === "cap" && p.stem.baseY > keepBelow);
      world.vines = world.vines.filter(v => v.yTop > keepBelow);
      world.seeds = world.seeds.filter(s => s.y > keepBelow && !(s.taken && s.takeT > 1));
      world.eyes = world.eyes.filter(e => e.y > keepBelow - 200);
      const top = cam.y + ANCHOR / S;
      let guard = 0;
      while (world.gen.last.endY < top + CFG.WORLD_GENERATION_DISTANCE && guard++ < 6) genNext();
    }

    // =====================================================================
    // 7. CREATURE — hidden alertness, breathing, involuntary shifts
    // =====================================================================
    const creature = {
      alert: 0, shown: 0, state: 0, sinceNoise: 99,
      breathPhase: 0, breathVal: 0, breathVel: 0, breathAmp: 2.5,
      shift: null, shiftCd: 18, shiftOffset: 0, lastStateChange: 0,
      tremble: 0
    };
    const STATE_NAMES = ["sleep", "disturbed", "stirring", "awake"];

    function off(p) {
      return creature.breathVal * creature.breathAmp * p.breathK + creature.shiftOffset * p.shiftK + p.squash * -3;
    }

    // Every action reports its disturbance here: ACTION x SURFACE x IMPACT x CREATURE STATE.
    function addNoise(base, surface, x, y) {
      if (game.state !== "play") return 0;
      const mult = surface ? (CFG.SURFACE_NOISE_MULTIPLIERS[surface] || 1) : 1;
      const m = Math.max(0, P.y) * CFG.METERS_PER_UNIT;
      let a = base * mult * sensitivityAt(m) * CFG.NOISE_SCALE * (1 + creature.alert * CFG.STATE_NOISE_AMPLIFY);
      a = Math.min(a, CFG.MAX_EVENT_NOISE);
      const awakeAt = CFG.ALERTNESS_THRESHOLD_AWAKE;
      // Fairness: a creature that is not yet stirring never wakes from a single event.
      if (creature.alert < CFG.ALERTNESS_THRESHOLD_STIRRING && creature.alert + a >= awakeAt) a = Math.max(0, awakeAt - 5 - creature.alert);
      creature.alert = Math.min(awakeAt, creature.alert + a);
      if (noiseLog) { noiseLog.push([+time.toFixed(2), surface || "-", +base.toFixed(2), +a.toFixed(2), +creature.alert.toFixed(1)]); if (noiseLog.length > 400) noiseLog.shift(); }
      if (a >= CFG.RESET_SETTLE_NOISE) creature.sinceNoise = 0;
      if (a >= CFG.STREAK_BREAK_NOISE) breakStreak();
      if (x !== undefined) spawnRipple(x, y, a);
      if (creature.alert >= awakeAt) wake();
      return a;
    }

    const noiseLog = ctx.__testHooks ? [] : null;
    function updateCreature(dt) {
      const C = creature;
      C.sinceNoise += dt;
      if (game.state === "play" && C.sinceNoise * 1000 > CFG.SETTLE_DELAY_MS) {
        const still = Math.abs(P.vx) < 4 && (P.ground || P.vine) && !P.anticOn;
        C.alert = Math.max(0, C.alert - CFG.ALERTNESS_DECAY_RATE * (still ? 1 : CFG.MOVING_DECAY_FACTOR) * dt);
      }
      C.shown += (C.alert - C.shown) * Math.min(1, dt * 2.6);
      // Visible state derives from the smooth value, with a little hysteresis.
      const T = [0, CFG.ALERTNESS_THRESHOLD_DISTURBED, CFG.ALERTNESS_THRESHOLD_STIRRING, CFG.ALERTNESS_THRESHOLD_AWAKE];
      let st = C.state;
      if (game.state === "play") {
        if (st < 2 && C.shown >= T[st + 1]) st++;
        else if (st > 0 && C.shown < T[st] - 5) st--;
        if (st !== C.state) {
          if (st > C.state) {
            if (st === 2) { sfx.stir(); haptic("warning"); C.shiftCd = Math.min(C.shiftCd, 3.5); }
            C.tremble = 1;
          } else if (st < C.state) {
            sfx.settle();
          }
          C.state = st;
        }
      }
      // Breathing: slow and rhythmic in sleep, deeper and irregular as it stirs.
      const lvl = C.shown / 100;
      const rate = 0.17 * CFG.CREATURE_BREATHING_SPEED * (1 + lvl * 0.9);
      const irregular = C.state >= 1 ? Math.sin(time * 0.73) * 0.35 * lvl + Math.sin(time * 2.3) * 0.18 * lvl : 0;
      C.breathPhase += TAU * rate * dt * (1 + irregular);
      const prevVal = C.breathVal;
      C.breathVal = Math.sin(C.breathPhase) * 0.85 + Math.sin(C.breathPhase * 0.5) * 0.15;
      C.breathVel = (C.breathVal - prevVal) / Math.max(dt, 1e-4) / (TAU * rate);
      C.breathAmp = (2.2 + C.state * 2.0 + lvl * 3) * CFG.CREATURE_MOVEMENT_INTENSITY + (C.shift && C.shift.phase === "tele" ? C.shift.t * 4 : 0);
      C.tremble = Math.max(0, C.tremble - dt * 0.6);

      // Involuntary movements: always telegraphed, braced by staying still.
      if (game.state === "play") {
        if (!C.shift) {
          C.shiftCd -= dt;
          if (C.shiftCd <= 0) {
            const strong = C.state >= 1;
            C.shift = { phase: "tele", t: 0, strong, dur: strong ? 1.5 : 1.8 };
            C.shiftCd = C.state >= 2 ? R0.range(5, 8) : C.state === 1 ? R0.range(9, 13) : R0.range(22, 34);
            sfx.shift();
          }
        } else {
          const sh = C.shift;
          sh.t += dt;
          if (sh.phase === "tele") {
            C.shiftOffset = smooth(clamp(sh.t / sh.dur, 0, 1)) * (sh.strong ? 6 : 3) * CFG.CREATURE_MOVEMENT_INTENSITY;
            if (Math.random() < dt * (sh.strong ? 22 : 8)) spawnDust(true);
            if (sh.t >= sh.dur) {
              sh.phase = "jolt"; sh.t = 0;
              cam.shake = sh.strong ? 4 : 1.6;
              if (sh.strong) haptic("medium");
              const braced = P.ground && Math.abs(P.vx) < 22 && !P.anticOn;
              if (P.ground && !braced && sh.strong) slip(true);
              else if (braced) P.braceT = 0.7;
            }
          } else {
            const amp = (sh.strong ? 7 : 3) * CFG.CREATURE_MOVEMENT_INTENSITY;
            C.shiftOffset = Math.sin(sh.t * 17) * amp * Math.max(0, 1 - sh.t / 0.75) + (sh.strong ? 6 : 3) * CFG.CREATURE_MOVEMENT_INTENSITY * Math.max(0, 1 - sh.t / 0.4);
            if (sh.t > 0.75) { C.shift = null; C.shiftOffset = 0; }
          }
        }
      }
      // Landmark eyelids twitch when the creature stirs.
      for (const e of world.eyes) {
        e.twitch = Math.max(0, e.twitch - dt * 2.2);
        e.twitchCd -= dt;
        if (C.state >= 2 && e.twitchCd <= 0) { e.twitch = 1; e.twitchCd = R0.range(2.5, 5); }
      }
    }

    // =====================================================================
    // 8. PLAYER — movement, physics, collision, animation state
    // =====================================================================
    const P = {
      x: 50, y: 4, vx: 0, vy: 0, facing: 1, ground: null, vine: null,
      coyote: 0, jumpBuf: 0, anticOn: false, antic: 0, landT: 0, landHard: false,
      slipT: 0, braceT: 0, collectT: 0, stepDist: 0, phase: 0, climbed: 0,
      running: false, vineT: 0, maxY: 0, rot: 0, teeter: 0, idleT: 0, fallFrom: 0, jumpSurface: "fur"
    };
    const input = { keys: { left: false, right: false, run: false }, keyT: { left: 0, right: 0 }, jumpQueued: false, pointers: new Map(), pointerRun: false };

    // Direction from held keys or the most recent held finger (left/right half).
    // `since` ignores presses that began before a moment (e.g. the swipe that grabbed a vine).
    function inputDir(since) {
      since = since || 0;
      let dir = 0;
      if (input.keys.left && input.keyT.left >= since) dir -= 1;
      if (input.keys.right && input.keyT.right >= since) dir += 1;
      input.pointerRun = false;
      if (dir === 0 && input.pointers.size) {
        let best = null;
        const now = performance.now();
        for (const p of input.pointers.values()) {
          if (p.ui || now - p.t0 < 80 || p.t0 < since) continue;
          if (!best || p.t0 > best.t0) best = p;
        }
        if (best) {
          dir = best.x < VW / 2 ? -1 : 1;
          input.pointerRun = (best.x - best.startX) * dir > CFG.RUN_DRAG_PX;
        }
      }
      return dir;
    }

    function resetPlayer() {
      Object.assign(P, {
        x: 48, y: 0, vx: 0, vy: 0, facing: 1, ground: null, vine: null, coyote: 0, jumpBuf: 0, anticOn: false, antic: 0,
        landT: 0, landHard: false, slipT: 0, braceT: 0, collectT: 0, stepDist: 0, phase: 0, climbed: 0, running: false,
        vineT: 0, maxY: 0, rot: 0, teeter: 0, idleT: 0, fallFrom: 0, jumpSurface: "fur"
      });
      const floor = world.platforms[0];
      P.y = surfaceAt(floor, P.x);
      P.ground = floor;
    }

    function vineAt(x, y) {
      for (const v of world.vines) {
        if (Math.abs(x - v.x) < 13 && y + 44 >= v.yBot && y <= v.yTop - 18) return v;
      }
      return null;
    }

    function slip(fromShift) {
      if (P.slipT > 0) return;
      P.slipT = 0.55;
      P.vx *= 0.3;
      addNoise(fromShift ? 6 : 3, null, P.x, P.y);
      haptic("light");
    }

    function doJump(dir) {
      const surface = P.ground ? P.ground.surface : P.jumpSurface;
      P.vy = CFG.PLAYER_JUMP_FORCE;
      if (dir !== 0) P.vx = dir * Math.max(Math.abs(P.vx), CFG.PLAYER_WALK_SPEED * 0.92);
      P.ground = null; P.coyote = 0; P.anticOn = false;
      P.fallFrom = P.y;
      addNoise(CFG.JUMP_NOISE * 0.6, surface, P.x, P.y);
      sfx.jump();
      try { ctx.platform.interact({ type: "jump" }); } catch (e) { /* analytics only */ }
    }

    function land(p, s) {
      const impact = -P.vy;
      P.y = s; P.vy = 0;
      if (p.kind === "cap") {
        P.vy = CFG.MUSHROOM_BOUNCE; P.ground = null; p.squash = 1;
        const f = clamp(Math.pow(impact / CFG.LANDING_IMPACT, 2), 0.3, 4);
        addNoise(CFG.LANDING_NOISE * f * 0.8, "mushroom", P.x, P.y);
        sfx.land("mushroom", f);
        haptic("light");
        P.fallFrom = P.y;
        return;
      }
      P.ground = p;
      const factor = clamp(Math.pow(impact / CFG.LANDING_IMPACT, 2), 0.12, 6);
      const big = P.fallFrom - P.y > 260;
      addNoise(CFG.LANDING_NOISE * factor * (big ? 1.6 : 1), p.surface, P.x, P.y);
      sfx.land(p.surface, factor);
      P.landT = CFG.LANDING_RECOVERY_MS / 1000 * (factor > 1.6 ? 2.2 : 1);
      P.landHard = factor > 1.6;
      if (factor > 0.7) haptic(factor > 2 ? "medium" : "light");
      if (p.surface === "stones" && factor > 0.5) spawnPebbles(P.x, P.y, 3 + Math.floor(factor * 2));
      if (factor > 2.6 || (p.surface === "stones" && factor > 1.7)) slip(false);
      spawnDustPuff(P.x, P.y, factor);
    }

    function physics(dt) {
      if (game.state !== "play") return;
      let dir = inputDir();
      // Walking is the default; sliding the held finger outward (or Shift) hurries into a run.
      P.running = dir !== 0 && (input.keys.run || input.pointerRun);
      if (P.slipT > 0) { P.slipT -= dt; dir = 0; }
      P.braceT = Math.max(0, P.braceT - dt);
      P.collectT = Math.max(0, P.collectT - dt);
      P.landT = Math.max(0, P.landT - dt);
      if (dir !== 0) P.facing = dir;
      if (dir !== 0 && !game.runStarted) startRun();

      if (input.jumpQueued) { P.jumpBuf = CFG.JUMP_BUFFER_MS / 1000; input.jumpQueued = false; if (!game.runStarted) startRun(); }
      else P.jumpBuf = Math.max(0, P.jumpBuf - dt);

      // Climbing a vine: slow, quiet, and a reliable way up.
      if (P.vine) {
        const v = P.vine;
        P.x = approach(P.x, v.x, 60 * dt);
        P.y += CFG.VINE_CLIMB_SPEED * dt;
        P.climbed += CFG.VINE_CLIMB_SPEED * dt;
        P.stepDist += CFG.VINE_CLIMB_SPEED * dt;
        if (P.stepDist > 22) { P.stepDist = 0; addNoise(CFG.BASE_WALK_NOISE, "vine"); sfx.step("vine", 0.3); }
        P.phase += dt * 7;
        if (P.y >= v.yTop - 2) { P.vine = null; P.vy = 240; P.vx = P.facing * 20; P.fallFrom = P.y + 20; }
        else {
          const fresh = inputDir(P.vineT);
          if (fresh !== 0 && P.climbed > 10) { P.vine = null; P.vx = fresh * 60; P.vy = 90; P.fallFrom = P.y; P.facing = fresh; }
        }
        P.maxY = Math.max(P.maxY, P.y);
        return;
      }
      if (P.jumpBuf > 0 && !P.anticOn) {
        const v = vineAt(P.x, P.y);
        if (v) {
          P.vine = v; P.ground = null; P.vx = 0; P.vy = 0; P.climbed = 0; P.jumpBuf = 0; P.vineT = performance.now() + 1;
          addNoise(0.4, "vine"); sfx.step("vine", 0.5);
          return;
        }
        if (P.ground || P.coyote > 0) {
          P.anticOn = true; P.antic = CFG.JUMP_ANTICIPATION_MS / 1000; P.jumpBuf = 0;
          P.jumpSurface = P.ground ? P.ground.surface : P.jumpSurface;
        }
      }
      if (P.anticOn) {
        P.antic -= dt;
        if (P.antic <= 0) doJump(dir);
      }

      // Horizontal movement with acceleration, slope resistance and air control.
      let target = dir * (P.running ? CFG.PLAYER_RUN_SPEED : CFG.PLAYER_WALK_SPEED);
      if (P.ground && dir !== 0) {
        const sl = slopeAt(P.ground, P.x);
        if (Math.sign(sl) === dir) target *= 1 - clamp(Math.abs(sl), 0, 0.6) * 0.45;
      }
      if (P.anticOn || (P.landT > 0 && P.landHard)) target *= 0.25;
      const ctrl = P.ground ? 1 : CFG.AIR_CONTROL;
      const accel = dir !== 0 ? CFG.PLAYER_ACCELERATION : CFG.PLAYER_DECELERATION;
      P.vx = approach(P.vx, target, accel * ctrl * dt);
      let nx = P.x + P.vx * dt;
      const R = CFG.COLLISION_RADIUS;
      if (nx < R + 2) { nx = R + 2; P.vx = 0; }
      if (nx > W - R - 2) { nx = W - R - 2; P.vx = 0; }
      const dx = nx - P.x;
      P.x = nx;

      if (P.ground) {
        const p = P.ground;
        if (P.x < p.x0 || P.x > p.x1) {
          // walking across a seam onto a touching piece is seamless, not a fall
          let next = null;
          for (const q of world.platforms) {
            if (q === p || q.kind === "cap" || P.x < q.x0 || P.x > q.x1) continue;
            if (Math.abs(surfaceAt(q, P.x) + off(q) - P.y) < 4) { next = q; break; }
          }
          if (next) { P.ground = next; P.y = surfaceAt(next, P.x) + off(next); }
          else { P.ground = null; P.coyote = CFG.COYOTE_MS / 1000; P.vy = 0; P.fallFrom = P.y; P.jumpSurface = p.surface; }
        }
        if (P.ground && P.ground !== p) { /* moved onto a touching piece this step */ }
        else if (P.ground) {
          P.y = surfaceAt(p, P.x) + off(p);
          // Footsteps: each stride is a small noise event on the current surface.
          if (Math.abs(dx) > 0) {
            P.stepDist += Math.abs(dx);
            P.phase += Math.abs(dx) / (P.running ? 20 : 14) * Math.PI;
            const stride = P.running ? 20 : 14;
            if (P.stepDist >= stride) {
              P.stepDist -= stride;
              const base = P.running ? CFG.RUN_NOISE : CFG.BASE_WALK_NOISE;
              const a = addNoise(base, p.surface, P.x, P.y);
              sfx.step(p.surface, 0.5 + a * 0.15, P.running);
              if (p.surface === "stones" && Math.random() < 0.5) spawnPebbles(P.x, P.y, 1);
            }
          }
          // Edge awareness: teeter when standing at a drop.
          const edgeDist = Math.min(P.x - p.x0, p.x1 - P.x);
          let atDrop = edgeDist < 5 && Math.abs(P.vx) < 6;
          if (atDrop) {
            const ex = P.x - p.x0 < p.x1 - P.x ? p.x0 : p.x1;
            for (const q of world.platforms) {
              if (q !== p && q.kind !== "cap" && Math.abs((ex === p.x0 ? q.x1 : q.x0) - ex) < 1.5 && Math.abs(surfaceAt(q, ex) - surfaceAt(p, ex)) < 4) { atDrop = false; break; }
            }
          }
          P.teeter = atDrop ? Math.min(1, P.teeter + dt * 4) : Math.max(0, P.teeter - dt * 5);
        }
      }
      if (!P.ground) {
        P.coyote = Math.max(0, P.coyote - dt);
        P.vy = Math.max(P.vy - CFG.GRAVITY * dt, -CFG.MAX_FALL_SPEED);
        const ny = P.y + P.vy * dt;
        let landed = false;
        if (P.vy <= 0) {
          let best = null, bestY = -Infinity;
          for (const p of world.platforms) {
            if (P.x < p.x0 - 1 || P.x > p.x1 + 1) continue;
            const s = surfaceAt(p, clamp(P.x, p.x0, p.x1)) + off(p);
            if (P.y >= s - 2 && ny <= s && s > bestY) { best = p; bestY = s; }
          }
          if (best) { land(best, bestY); landed = true; }
        }
        if (!landed) P.y = ny;
        P.teeter = 0;
      }
      if (P.ground || P.vine) P.maxY = Math.max(P.maxY, P.y); // height counts once standing or climbing
      if (P.y < -400) wake();
    }

    // =====================================================================
    // 9. COLLECTIBLES & MEMORY
    // =====================================================================
    function updateSeeds(dt) {
      for (const s of world.seeds) {
        if (s.taken) { s.takeT += dt; continue; }
        if (game.state !== "play") continue;
        const sy = s.y + (s.p ? off(s.p) : 0) + (s.float ? 0 : SEED_COLORS[s.rarity].stem * 0.7);
        const dx = s.x - P.x, dy = sy - (P.y + 12);
        if (dx * dx + dy * dy < 19 * 19) collectSeed(s);
      }
    }

    function collectSeed(s) {
      s.taken = true; s.takeT = 0;
      run.seeds++;
      run.seedLight += CFG.COLLECTIBLE_SCORE[s.rarity] || 1;
      save.totalSeeds++;
      P.collectT = 0.4;
      sfx.chime(s.rarity);
      haptic(s.rarity === "common" ? "light" : "success");
      spawnSeedMotes(s);
      hud.seedBump = 1;
      if (s.rarity === "rare") {
        save.rareLight += CFG.COLLECTIBLE_SCORE.rare;
        if (save.rareLight >= CFG.RARE_LIGHT_PER_FRAGMENT) { save.rareLight -= CFG.RARE_LIGHT_PER_FRAGMENT; revealFragment(); }
        else showToast("Rare Dream Seed", "A fragment is gathering", s.rarity);
      } else if (s.rarity === "ancient") {
        save.ancient++;
        revealFragment();
      }
      persist();
      try { ctx.platform.interact({ type: "seed", rarity: s.rarity }); } catch (e) { /* analytics only */ }
    }

    function revealFragment() {
      for (let i = 0; i < FRAGMENTS.length; i++) {
        if (!hasFragment(i)) {
          save.fragments.push(i);
          run.discoveries.push(i);
          showToast("New discovery", FRAGMENTS[i].name, "ancient", i);
          try { ctx.platform.milestone("memory_fragment", { index: i }); } catch (e) { /* analytics only */ }
          return;
        }
      }
      showToast("The memory is complete", "Every fragment found", "ancient");
    }

    // =====================================================================
    // 10. SCORING — height first, seeds and quiet streak second
    // =====================================================================
    const score = (() => { try { return ctx.game.score({ initial: 0, min: 0 }); } catch (e) { return null; } })();
    const run = { seeds: 0, seedLight: 0, discoveries: [], streakStartY: 0, streakTier: 0, bestStreak: 0, lastMilestone: 0 };
    const STREAK_TIERS = [12, 30, 60, 110];
    function heightMeters() { return Math.max(0, P.maxY) * CFG.METERS_PER_UNIT; }
    function streakMeters() { return Math.max(0, P.maxY - run.streakStartY) * CFG.METERS_PER_UNIT; }
    function breakStreak() {
      run.bestStreak = Math.max(run.bestStreak, streakMeters());
      run.streakStartY = P.maxY;
      run.streakTier = 0;
    }
    function updateScore() {
      const h = heightMeters();
      if (score && Math.floor(h) !== score.value) { try { score.set(Math.floor(h)); } catch (e) { /* host score only */ } }
      const sm = streakMeters();
      let tier = 0;
      for (const t of STREAK_TIERS) if (sm >= t) tier++;
      if (tier > run.streakTier) {
        run.streakTier = tier;
        sfx.streak();
        spawnStreakMotes();
      }
      if (Math.floor(h / 100) > run.lastMilestone) {
        run.lastMilestone = Math.floor(h / 100);
        try { ctx.platform.milestone("height_" + run.lastMilestone * 100); } catch (e) { /* analytics only */ }
      }
    }

    // =====================================================================
    // 11. PARTICLES & FEEDBACK (bounded)
    // =====================================================================
    const particles = [];
    const MAX_PARTICLES = 240;
    function addParticle(p) { if (particles.length < MAX_PARTICLES) particles.push(p); }
    function spawnRipple(x, y, amount) {
      if (amount < 0.15) return;
      addParticle({ type: "ripple", x, y, t: 0, life: 0.5 + Math.min(amount, 20) * 0.03, r: 4 + Math.min(amount, 30) * 1.1, a: clamp(0.25 + amount * 0.04, 0.25, 0.85), warm: amount > 4 });
    }
    function spawnPebbles(x, y, n) {
      for (let i = 0; i < n; i++) addParticle({ type: "pebble", x: x + (Math.random() - 0.5) * 10, y: y + 2, vx: (Math.random() - 0.5) * 80, vy: 60 + Math.random() * 90, t: 0, life: 1.4, r: 1.2 + Math.random() * 1.6 });
    }
    function spawnDustPuff(x, y, factor) {
      const n = Math.min(10, 2 + Math.floor(factor * 3));
      for (let i = 0; i < n; i++) addParticle({ type: "puff", x: x + (Math.random() - 0.5) * 8, y: y + 1, vx: (Math.random() - 0.5) * 50 * (0.5 + factor * 0.3), vy: Math.random() * 18, t: 0, life: 0.5 + Math.random() * 0.3, r: 1.5 + Math.random() * 2 });
    }
    function spawnDust(fromAbove) {
      const top = cam.y + ANCHOR / S;
      addParticle({ type: "dust", x: Math.random() * W, y: fromAbove ? top + 10 : P.y + 120 + Math.random() * 100, vx: (Math.random() - 0.5) * 8, vy: -20 - Math.random() * 30, t: 0, life: 4, r: 0.8 + Math.random() * 1.4 });
    }
    function spawnSeedMotes(s) {
      const c = SEED_COLORS[s.rarity];
      const n = s.rarity === "ancient" ? 12 : s.rarity === "rare" ? 9 : 6;
      const sy = s.y + (s.p ? off(s.p) : 0) + (s.float ? 0 : c.stem);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        addParticle({ type: "mote", x: s.x, y: sy, vx: Math.cos(a) * (20 + Math.random() * 30), vy: Math.sin(a) * (20 + Math.random() * 30) + 20, t: 0, life: 0.55 + Math.random() * 0.4, r: 1 + Math.random() * 1.2, color: c.glow });
      }
    }
    function spawnStreakMotes() {
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * TAU;
        addParticle({ type: "mote", x: P.x + Math.cos(a) * 14, y: P.y + 12 + Math.sin(a) * 10, vx: Math.cos(a) * 8, vy: 18 + Math.random() * 12, t: 0, life: 1.2, r: 1, color: palAt(heightMeters()).light });
      }
    }
    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t += dt;
        if (p.t >= p.life) { particles.splice(i, 1); continue; }
        if (p.type === "pebble") { p.vy -= 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        else if (p.type === "puff") { p.vx *= 1 - dt * 4; p.vy += 10 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        else if (p.type === "dust") { p.x += (p.vx + Math.sin(time * 1.3 + p.y) * 4) * dt; p.y += p.vy * dt; }
        else if (p.type === "mote") { p.vx *= 1 - dt * 2.5; p.vy *= 1 - dt * 2.5; p.vy += 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      }
    }

    // Ambient life: distant birds while it sleeps; they leave when it stirs.
    const birds = [];
    function updateBirds(dt) {
      const calm = creature.state === 0 && game.state !== "waking";
      if (calm && birds.length < 4 && Math.random() < dt * 0.25) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        birds.push({ x: dir > 0 ? -20 : W + 20, y: cam.y + R0.range(60, 220), vx: dir * R0.range(16, 26), vy: 0, ph: Math.random() * TAU, flee: false });
      }
      for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i];
        if (!calm && !b.flee) { b.flee = true; b.vy = 40; b.vx *= 2.4; }
        if (b.flee) b.vy += 30 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.ph += dt * (b.flee ? 16 : 7);
        if (b.x < -40 || b.x > W + 40 || b.y > cam.y + ANCHOR / S + 400) birds.splice(i, 1);
      }
    }

    // =====================================================================
    // 12. CAMERA
    // =====================================================================
    const cam = { y: 0, shake: 0, sx: 0, sy: 0, hold: false };
    let VW = 360, VH = 640, S = 1, OX = 0, ANCHOR = 400, SAFE_TOP = 0, SAFE_BOTTOM = 0;
    function minCamY() { return (VH * 0.8 - ANCHOR) / S; }
    function updateCamera(dt) {
      if (!cam.hold) {
        const lead = P.vy > 0 ? 24 : 0;
        const target = Math.max(minCamY(), P.y + lead);
        const k = 1 - Math.exp(-CFG.CAMERA_FOLLOW_SPEED * dt);
        cam.y += (target - cam.y) * k;
        // never let the explorer leave the frame
        const sy = ANCHOR - (P.y - cam.y) * S;
        if (sy < VH * 0.22) cam.y = P.y - (ANCHOR - VH * 0.22) / S;
        if (sy > VH * 0.9 && game.state === "play") cam.y = P.y - (ANCHOR - VH * 0.9) / S;
      }
      cam.shake = Math.max(0, cam.shake - dt * 6);
      const sh = cam.shake + creature.tremble * 0.4 + (creature.state >= 2 ? 0.25 : 0);
      cam.sx = (Math.random() - 0.5) * sh * S;
      cam.sy = (Math.random() - 0.5) * sh * S;
    }
    const toSX = x => OX + x * S + cam.sx;
    const toSY = y => ANCHOR - (y - cam.y) * S + cam.sy;

    // =====================================================================
    // 13. RENDERING
    // =====================================================================
    const canvas = ctx.createCanvas2D({ layer: "content", alpha: false, maxDpr: 2, coordinateSpace: "css", touchAction: "none" });
    const g = canvas.getContext("2d");
    function layout(info) {
      VW = Math.max(200, (info && info.width) || ctx.width || 360);
      VH = Math.max(320, (info && info.height) || ctx.height || 640);
      const sa = (info && info.safeArea) || ctx.safeArea || {};
      SAFE_TOP = sa.top || 0; SAFE_BOTTOM = sa.bottom || 0;
      S = VW / W;
      if (VW / VH > 0.68) S = VH / 600;
      OX = (VW - W * S) / 2;
      ANCHOR = VH * 0.62;
    }
    layout();

    const STARS = [];
    { const r = makeRng(7); for (let i = 0; i < 90; i++) STARS.push({ x: r.f(), y: r.f(), s: r.range(0.4, 1.4), tw: r.range(0, TAU) }); }
    const CONSTELLATION = [[0.62, 0.12], [0.68, 0.17], [0.74, 0.15], [0.79, 0.21], [0.72, 0.25], [0.66, 0.23]];

    function roundRect(x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    const charW = new Map();
    function spaced(text, x, y, spacing, align) {
      const font = g.font;
      let w = 0;
      const widths = [];
      for (const ch of text) {
        const key = font + ch;
        let cw = charW.get(key);
        if (cw === undefined) { cw = g.measureText(ch).width; if (charW.size > 2000) charW.clear(); charW.set(key, cw); }
        widths.push(cw); w += cw + spacing;
      }
      w -= spacing;
      let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      const prev = g.textAlign; g.textAlign = "left";
      let i = 0;
      for (const ch of text) { g.fillText(ch, cx, y); cx += widths[i++] + spacing; }
      g.textAlign = prev;
      return w;
    }

    // --- Background: sky, stars, distant anatomy, clouds -----------------
    function drawSky(pal, camM) {
      const grd = g.createLinearGradient(0, 0, 0, VH);
      grd.addColorStop(0, rgba(pal.skyTop)); grd.addColorStop(0.55, rgba(pal.skyMid)); grd.addColorStop(1, rgba(pal.skyBot));
      g.fillStyle = grd; g.fillRect(0, 0, VW, VH);
      // low warm sun glow in the early climb
      const sunA = clamp(1 - camM / 500, 0, 1);
      if (sunA > 0.01) {
        const sx = VW * 0.82, sy = VH * 0.78 + camM * 0.6;
        const r = VW * 0.9;
        const sg = g.createRadialGradient(sx, sy, 0, sx, sy, r);
        sg.addColorStop(0, rgba(pal.light, 0.55 * sunA)); sg.addColorStop(1, rgba(pal.light, 0));
        g.fillStyle = sg; g.fillRect(0, 0, VW, VH);
      }
      const night = pal.night;
      if (night > 0.05) {
        const shift = (cam.y * 0.02) % VH;
        for (const st of STARS) {
          const y = (st.y * VH * 1.2 + shift) % (VH * 1.05);
          const a = night * (0.45 + 0.4 * Math.sin(time * 1.3 + st.tw));
          g.fillStyle = rgba(CREAM, a * (y < VH * 0.7 ? 1 : 1 - (y - VH * 0.7) / (VH * 0.35)));
          g.fillRect(st.x * VW, y, st.s, st.s);
        }
        // moon
        const mx = VW * 0.8, my = VH * 0.14;
        const mg = g.createRadialGradient(mx, my, 0, mx, my, 70);
        mg.addColorStop(0, rgba(pal.light, 0.35 * night)); mg.addColorStop(1, rgba(pal.light, 0));
        g.fillStyle = mg; g.fillRect(mx - 70, my - 70, 140, 140);
        g.fillStyle = rgba(hexRgb("#f7efd8"), night);
        g.beginPath(); g.arc(mx, my, 15, 0, TAU); g.fill();
        g.fillStyle = rgba(pal.skyTop, night);
        g.beginPath(); g.arc(mx + 7, my - 4, 13.5, 0, TAU); g.fill();
        // fragment reward: The Sleeper's Stars
        if (hasFragment(2)) {
          g.strokeStyle = rgba(CREAM, 0.22 * night); g.lineWidth = 0.8;
          g.beginPath();
          CONSTELLATION.forEach((c, i) => { const x = c[0] * VW, y = c[1] * VH; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
          g.stroke();
          g.fillStyle = rgba(CREAM, 0.85 * night);
          for (const c of CONSTELLATION) { g.beginPath(); g.arc(c[0] * VW, c[1] * VH, 1.6, 0, TAU); g.fill(); }
        }
        // fragment reward: Its True Shape (a faint aurora)
        if (hasFragment(11)) {
          for (let i = 0; i < 3; i++) {
            g.strokeStyle = rgba(hexRgb(i === 1 ? "#a6e3d6" : "#c7b6ee"), 0.07 * night);
            g.lineWidth = 18 - i * 4;
            g.beginPath();
            for (let x = 0; x <= VW; x += 20) {
              const y = VH * (0.2 + i * 0.05) + Math.sin(x * 0.012 + time * 0.3 + i) * 18;
              if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
          }
        }
      }
    }

    function drawFarLayer(pal, camM) {
      const P1 = 0.12;
      const sc = S * 0.75;
      const base = (y) => ANCHOR + 120 - (y - cam.y * P1) * sc;
      // Tail curl rising from the sea of cloud at the start of the climb.
      const tailA = clamp(1 - camM / 160, 0, 1);
      if (tailA > 0.01) {
        const tx = OX + W * S * 0.18, ty = base(-80);
        g.fillStyle = rgba(mixRgb(pal.fur, pal.haze, 0.55), tailA);
        g.beginPath();
        g.moveTo(tx - 140 * sc, ty + 80 * sc);
        g.bezierCurveTo(tx - 40 * sc, ty - 40 * sc, tx - 60 * sc, ty - 220 * sc, tx + 10 * sc, ty - 250 * sc);
        g.bezierCurveTo(tx + 70 * sc, ty - 275 * sc, tx + 95 * sc, ty - 205 * sc, tx + 52 * sc, ty - 185 * sc);
        g.bezierCurveTo(tx + 30 * sc, ty - 175 * sc, tx + 40 * sc, ty - 215 * sc, tx + 18 * sc, ty - 210 * sc);
        g.bezierCurveTo(tx - 20 * sc, ty - 200 * sc, tx + 20 * sc, ty - 40 * sc, tx + 60 * sc, ty + 80 * sc);
        g.closePath(); g.fill();
        g.strokeStyle = rgba(pal.furHi, 0.5 * tailA); g.lineWidth = 1.2;
        g.stroke();
      }
      // Distant spires and body contours, repeating with seeded variety.
      const bandH = 170;
      const lo = Math.floor((cam.y * P1 - 900) / bandH), hi = Math.ceil((cam.y * P1 + 1400) / bandH);
      for (let i = lo; i <= hi; i++) {
        const h0 = hash1(i * 3.1);
        if (h0 < 0.35) continue;
        const x = OX + (hash1(i * 7.7) * 1.3 - 0.15) * W * S;
        const y = base(i * bandH);
        const hgt = (150 + hash1(i * 1.9) * 260) * sc;
        const wid = (34 + hash1(i * 5.3) * 46) * sc;
        const ear = camM > 600 && hash1(i * 9.1) < 0.35;
        g.fillStyle = rgba(mixRgb(pal.far2, pal.haze, 0.5));
        g.beginPath();
        g.moveTo(x - wid, y);
        g.bezierCurveTo(x - wid * 0.9, y - hgt * 0.7, x - wid * 0.35, y - hgt, x + (ear ? wid * 0.25 : 0), y - hgt);
        g.bezierCurveTo(x + wid * 0.4, y - hgt, x + wid * 0.9, y - hgt * 0.7, x + wid, y);
        g.closePath(); g.fill();
        if (ear) {
          g.fillStyle = rgba(mixRgb(pal.skin, pal.haze, 0.5), 0.6);
          g.beginPath();
          g.moveTo(x - wid * 0.45, y - hgt * 0.15);
          g.bezierCurveTo(x - wid * 0.4, y - hgt * 0.7, x, y - hgt * 0.92, x + wid * 0.12, y - hgt * 0.85);
          g.bezierCurveTo(x + wid * 0.35, y - hgt * 0.6, x + wid * 0.3, y - hgt * 0.2, x - wid * 0.45, y - hgt * 0.15);
          g.fill();
        }
        // highlight rim
        g.strokeStyle = rgba(pal.light, 0.18); g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + wid * 0.1, y - hgt * 0.98); g.bezierCurveTo(x + wid * 0.5, y - hgt * 0.95, x + wid * 0.85, y - hgt * 0.6, x + wid * 0.92, y - hgt * 0.2); g.stroke();
        // fragment reward: Spiral Sigil markings on distant ridges
        if (hasFragment(3) && hash1(i * 4.4) < 0.4) {
          g.strokeStyle = rgba(pal.light, 0.35); g.lineWidth = 1;
          g.beginPath();
          const cx = x, cy = y - hgt * 0.45;
          for (let a = 0; a < TAU * 2.2; a += 0.3) { const rr = 1 + a * 1.4 * sc; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (a) g.lineTo(px, py); else g.moveTo(px, py); }
          g.stroke();
        }
      }
    }

    function drawClouds(pal, par, alpha, seedOff) {
      const sc = S * (0.6 + par);
      const bandH = 120;
      const ref = cam.y * par;
      const lo = Math.floor((ref - 700) / bandH), hi = Math.ceil((ref + 1100) / bandH);
      for (let i = lo; i <= hi; i++) {
        const h = hash1(i * 2.3 + seedOff);
        if (h < 0.45) continue;
        const drift = ((time * (4 + h * 6) + hash1(i * 8.1) * 900) % (W * 1.8)) - W * 0.4;
        const x = OX + drift * S;
        const y = ANCHOR + 60 - (i * bandH - ref) * sc;
        const w = (60 + hash1(i * 3.7 + seedOff) * 110) * sc;
        g.fillStyle = rgba(pal.cloud, alpha);
        g.beginPath();
        g.ellipse(x, y, w, w * 0.22, 0, 0, TAU);
        g.ellipse(x - w * 0.35, y - w * 0.1, w * 0.45, w * 0.25, 0, 0, TAU);
        g.ellipse(x + w * 0.3, y - w * 0.13, w * 0.4, w * 0.28, 0, 0, TAU);
        g.fill();
      }
    }

    function drawMidLayer(pal, camM) {
      const par = 0.45;
      const sc = S * 0.9;
      const bandH = 230;
      const ref = cam.y * par;
      const lo = Math.floor((ref - 800) / bandH), hi = Math.ceil((ref + 1200) / bandH);
      const col = mixRgb(pal.fur, pal.haze, 0.5);
      const colDk = mixRgb(pal.furLo, pal.haze, 0.45);
      for (let i = lo; i <= hi; i++) {
        const h = hash1(i * 4.7 + 11);
        const side = h < 0.5 ? -1 : 1;
        const y = ANCHOR - (i * bandH - ref) * sc;
        const cx = side < 0 ? OX - 30 * sc : OX + W * S + 30 * sc;
        const r = (120 + hash1(i * 6.1) * 90) * sc;
        // fur hill / body contour
        const grd = g.createLinearGradient(0, y - r, 0, y + r * 0.6);
        grd.addColorStop(0, rgba(col)); grd.addColorStop(1, rgba(colDk, 0.0));
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(cx, y, r * 1.1, r * 0.75, side * 0.25, 0, TAU); g.fill();
        // trees on the hill
        const treeCol = rgba(mixRgb(pal.vegDk, pal.haze, 0.45));
        const nt = 3 + Math.floor(hash1(i * 9.9) * 4);
        g.fillStyle = treeCol;
        for (let t = 0; t < nt; t++) {
          const ang = -Math.PI / 2 + side * (0.25 + t * 0.16);
          const tx = cx + Math.cos(ang) * r * 1.02, ty = y + Math.sin(ang) * r * 0.72;
          const th = (14 + hash1(i * 13 + t) * 16) * sc;
          g.beginPath(); g.moveTo(tx, ty - th); g.quadraticCurveTo(tx + th * 0.42, ty - th * 0.2, tx + th * 0.3, ty); g.lineTo(tx - th * 0.3, ty); g.quadraticCurveTo(tx - th * 0.42, ty - th * 0.2, tx, ty - th); g.fill();
        }
        // waterfalls through the middle ascent
        if (camM > 80 && camM < 620 && hash1(i * 2.2) < 0.4) {
          const wx = OX + (0.25 + hash1(i * 3.3) * 0.5) * W * S;
          const wtop = y - r * 0.9, wbot = y + r * 0.7;
          const wg = g.createLinearGradient(0, wtop, 0, wbot);
          wg.addColorStop(0, rgba(pal.cloud, 0.0)); wg.addColorStop(0.2, rgba(pal.cloud, 0.55)); wg.addColorStop(1, rgba(pal.cloud, 0.15));
          g.fillStyle = wg;
          g.fillRect(wx - 5 * sc, wtop, 10 * sc, wbot - wtop);
          g.strokeStyle = rgba(CREAM, 0.35); g.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            const off2 = ((time * 60 + k * 37) % 60) * sc;
            g.beginPath(); g.moveTo(wx - 2 * sc + k * 2 * sc, wtop + off2); g.lineTo(wx - 2 * sc + k * 2 * sc, wtop + off2 + 20 * sc); g.stroke();
          }
          g.fillStyle = rgba(pal.cloud, 0.35);
          g.beginPath(); g.ellipse(wx, wbot - 6 * sc, 22 * sc, 7 * sc, 0, 0, TAU); g.fill();
        }
        // a giant distant mushroom now and then
        if (camM > 60 && camM < 700 && hash1(i * 5.5) > 0.78) {
          const mx = OX + (0.15 + hash1(i * 7.3) * 0.7) * W * S, my = y + 30 * sc;
          const mh = (60 + hash1(i * 1.1) * 40) * sc;
          g.fillStyle = rgba(mixRgb(pal.furHi, pal.haze, 0.5));
          g.fillRect(mx - 3 * sc, my - mh, 6 * sc, mh);
          g.fillStyle = rgba(mixRgb(pal.cap, pal.haze, 0.5));
          g.beginPath(); g.ellipse(mx, my - mh, 24 * sc, 9 * sc, 0, Math.PI, TAU); g.fill();
        }
      }
    }

    // Body lobes just behind the climbable terrain: one continuous creature.
    function drawBodyLayer(pal) {
      const par = 0.78;
      const bandH = 190;
      const ref = cam.y * par;
      const lo = Math.floor((ref - 600) / bandH), hi = Math.ceil((ref + 1000) / bandH);
      const col = mixRgb(pal.fur, pal.haze, 0.3);
      for (let i = lo; i <= hi; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const y = ANCHOR - (i * bandH - ref) * S;
        const cx = side < 0 ? OX - 10 * S : OX + W * S + 10 * S;
        const r = (95 + hash1(i * 3.9 + 5) * 55) * S;
        const grd = g.createRadialGradient(cx, y, r * 0.2, cx, y, r);
        grd.addColorStop(0, rgba(col, 0.9)); grd.addColorStop(0.75, rgba(col, 0.65)); grd.addColorStop(1, rgba(col, 0));
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(cx, y, r * 0.9, r, 0, 0, TAU); g.fill();
        // fur grain
        g.strokeStyle = rgba(pal.furHi, 0.22); g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = -Math.PI / 2 + side * (k / 9) * 1.2 + (side < 0 ? 0.3 : -0.3);
          const rr = r * (0.55 + hash1(i * 17 + k) * 0.35);
          const px = cx + Math.cos(a) * rr * 0.9, py = y + Math.sin(a) * rr;
          g.moveTo(px, py); g.lineTo(px + side * 3 * S, py + 6 * S);
        }
        g.stroke();
      }
    }

    // Giant eyes embedded in the climb: the clearest reminder of what this is.
    function drawEyes(pal) {
      for (const e of world.eyes) {
        const sy = toSY(e.y);
        if (sy < -260 || sy > VH + 260) continue;
        const cx = e.side < 0 ? OX + -30 * S : OX + (W + 30) * S;
        const rw = 150 * S, rh = 120 * S;
        const grd = g.createRadialGradient(cx, sy, rw * 0.2, cx, sy, rw * 1.1);
        grd.addColorStop(0, rgba(mixRgb(pal.fur, pal.furHi, 0.3))); grd.addColorStop(0.8, rgba(pal.fur, 0.85)); grd.addColorStop(1, rgba(pal.fur, 0));
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(cx, sy, rw * 1.1, rh, 0, 0, TAU); g.fill();
        // eyelid crease
        const ex = cx - e.side * 70 * S, ew = 62 * S;
        const open = e.twitch > 0 ? Math.sin(e.twitch * Math.PI) * 0.22 : 0;
        if (open > 0.01) {
          g.save();
          g.beginPath();
          g.moveTo(ex - ew, sy); g.quadraticCurveTo(ex, sy - ew * 0.5 * open * 2, ex + ew, sy); g.quadraticCurveTo(ex, sy + ew * 0.18, ex - ew, sy);
          g.clip();
          g.fillStyle = rgba(hexRgb("#c98a3a")); g.fillRect(ex - ew, sy - ew, ew * 2, ew * 2);
          g.fillStyle = rgba(hexRgb("#1d1420")); g.beginPath(); g.ellipse(ex, sy, ew * 0.07, ew * 0.4, 0, 0, TAU); g.fill();
          g.restore();
        }
        g.strokeStyle = rgba(mixRgb(INK, pal.furLo, 0.4), 0.8); g.lineWidth = 2.4 * S; g.lineCap = "round";
        g.beginPath(); g.moveTo(ex - ew, sy); g.quadraticCurveTo(ex, sy + ew * 0.22 - open * ew * 0.5, ex + ew, sy); g.stroke();
        g.lineWidth = 1.4 * S;
        g.beginPath();
        for (let i = 1; i < 8; i++) {
          const t = i / 8;
          const lx = lerp(ex - ew, ex + ew, t);
          const ly = sy + Math.sin(t * Math.PI) * ew * 0.2;
          g.moveTo(lx, ly); g.lineTo(lx + (t - 0.5) * 6 * S, ly + 7 * S);
        }
        g.stroke();
        // fold above the eye
        g.strokeStyle = rgba(pal.furHi, 0.5); g.lineWidth = 1.6 * S;
        g.beginPath(); g.moveTo(ex - ew * 1.1, sy - ew * 0.3); g.quadraticCurveTo(ex, sy - ew * 0.65, ex + ew * 1.1, sy - ew * 0.3); g.stroke();
      }
    }

    // --- Terrain ---------------------------------------------------------
    function drawPlatform(p) {
      const m = p.yMid * CFG.METERS_PER_UNIT;
      const pal = palAt(m);
      const o = off(p);
      const pts = p.pts;
      const n = pts.length;
      if (p.kind === "cap") { drawMushroom(p, pal, o); return; }
      const topY = toSY(p.yMax + o);
      const dpx = p.depth * S;
      const xL = toSX(p.x0), xR = toSX(p.x1);
      const yL = toSY(pts[0][1] + o), yR = toSY(pts[n - 1][1] + o);
      // body mass under the surface
      g.beginPath();
      g.moveTo(xL, yL);
      for (let i = 1; i < n; i++) g.lineTo(toSX(pts[i][0]), toSY(pts[i][1] + o));
      if (p.kind === "path") {
        const u = p.under;
        g.bezierCurveTo(xR + 5 * S, yR + 2 * S, xR + 3 * S, yR + dpx * 0.3, xR - 4 * S, yR + dpx * 0.5);
        let px = xR - 4 * S, py = yR + dpx * 0.5;
        for (let i = 1; i < u.length; i++) {
          const ux = i === u.length - 1 ? xL + 4 * S : toSX(u[i][0]);
          const uy = toSY(surfaceAt(p, u[i][0]) + o) + dpx * u[i][1];
          g.bezierCurveTo(px - (px - ux) * 0.15, Math.max(py, uy) + dpx * 0.16, ux + (px - ux) * 0.15, Math.max(py, uy) + dpx * 0.16, ux, uy);
          px = ux; py = uy;
        }
        g.bezierCurveTo(xL - 3 * S, yL + dpx * 0.3, xL - 5 * S, yL + 2 * S, xL, yL);
      } else {
        g.bezierCurveTo(xR + 5 * S, yR + 2 * S, xR + 2 * S, yR + dpx * 0.55, (xL + xR) / 2 + (xR - xL) * 0.18, yR + dpx);
        g.quadraticCurveTo((xL + xR) / 2, yL + dpx * 1.15, (xL + xR) / 2 - (xR - xL) * 0.18, yL + dpx);
        g.bezierCurveTo(xL - 2 * S, yL + dpx * 0.55, xL - 5 * S, yL + 2 * S, xL, yL);
      }
      g.closePath();
      let top = p.surface === "skin" ? mixRgb(pal.fur, pal.skin, 0.22) : p.surface === "ruin" ? mixRgb(pal.fur, pal.ruin, 0.5) : pal.fur;
      if (p.bridge) top = mixRgb(pal.fur, pal.furHi, 0.4);
      const grd = g.createLinearGradient(0, topY, 0, topY + dpx * 1.25);
      grd.addColorStop(0, rgba(mixRgb(top, pal.furHi, 0.55)));
      grd.addColorStop(0.12, rgba(top));
      grd.addColorStop(0.5, rgba(mixRgb(top, pal.furLo, 0.72), 0.94));
      grd.addColorStop(1, rgba(pal.furLo, p.kind === "path" ? 0 : 0.55));
      g.fillStyle = grd;
      g.fill();

      // fur strokes, combed and densest just under the lit rim
      if (p.strokes.length) {
        const wob = creature.tremble * 0.6 + (creature.state >= 1 ? 0.15 * creature.state : 0);
        g.lineCap = "round";
        for (let pass = 0; pass < 2; pass++) {
          g.strokeStyle = pass === 0 ? rgba(pal.furLo, 0.4) : rgba(pal.furHi, 0.75);
          g.lineWidth = (pass === 0 ? 0.9 : 1) * S;
          g.beginPath();
          for (const st of p.strokes) {
            if (st.light !== (pass === 1)) continue;
            const sx = toSX(st.x), sy = toSY(st.sy + o) + st.dy * S;
            const a = st.a + Math.sin(time * 2.4 + st.x) * wob * 0.35;
            g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * st.len * S, sy + Math.sin(a) * st.len * S);
          }
          g.stroke();
        }
      }
      // surface rim
      g.beginPath();
      g.moveTo(xL, yL);
      for (let i = 1; i < n; i++) g.lineTo(toSX(pts[i][0]), toSY(pts[i][1] + o));
      g.lineJoin = "round"; g.lineCap = "round";
      if (p.surface === "moss") {
        g.strokeStyle = rgba(pal.veg); g.lineWidth = 4.5 * S; g.stroke();
        g.strokeStyle = rgba(mixRgb(pal.veg, pal.furHi, 0.35), 0.8); g.lineWidth = 1.4 * S;
        g.beginPath(); g.moveTo(xL, yL - 1.6 * S);
        for (let i = 1; i < n; i++) g.lineTo(toSX(pts[i][0]), toSY(pts[i][1] + o) - 1.6 * S);
        g.stroke();
      } else if (p.surface === "skin") {
        // bare, sensitive skin: smooth and faintly flushed, swelling with each breath
        const pulse = 0.5 + 0.5 * creature.breathVal;
        g.strokeStyle = rgba(mixRgb(pal.skin, hexRgb("#b8606e"), 0.25)); g.lineWidth = 7 * S; g.stroke();
        g.strokeStyle = rgba(mixRgb(pal.skin, hexRgb("#f2c0b4"), 0.3 + pulse * 0.25)); g.lineWidth = 4.5 * S; g.stroke();
        g.strokeStyle = rgba(mixRgb(pal.skin, hexRgb("#b8606e"), 0.35), 0.7); g.lineWidth = 0.9 * S;
        g.beginPath();
        for (const v of p.veins) {
          const vx = toSX(v.x), vy = toSY(surfaceAt(p, v.x) + o) + v.dy * S * 0.6;
          g.moveTo(vx - v.w * 0.5 * S, vy); g.quadraticCurveTo(vx, vy - 3 * S + Math.sin(time * 3 + v.ph) * S, vx + v.w * 0.5 * S, vy + 2 * S);
        }
        g.stroke();
        // a faint warning sheen that brightens as the creature stirs
        g.strokeStyle = rgba(hexRgb("#ffd9cf"), 0.25 + creature.shown / 300); g.lineWidth = 1.2 * S;
        g.beginPath(); g.moveTo(xL + 3 * S, yL - 1.8 * S);
        for (let i = 1; i < n; i++) g.lineTo(toSX(pts[i][0]) - (i === n - 1 ? 3 * S : 0), toSY(pts[i][1] + o) - 1.8 * S);
        g.stroke();
      } else if (p.surface === "ruin") {
        for (const b of p.blocks) {
          const bx = toSX(b.x), by = toSY(surfaceAt(p, b.x + b.w / 2) + o);
          g.fillStyle = rgba(mixRgb(pal.ruin, b.shade > 0.5 ? pal.furHi : pal.furLo, 0.2 + b.shade * 0.15));
          g.fillRect(bx, by - 1 * S, b.w * S, b.h * S);
          g.fillStyle = rgba(pal.furHi, 0.35);
          g.fillRect(bx, by - 1 * S, b.w * S, 1.2 * S);
        }
      } else {
        g.strokeStyle = rgba(pal.furHi); g.lineWidth = 2.2 * S; g.stroke();
      }
      if (p.surface === "stones") {
        const jit = creature.state >= 1 ? creature.shown / 100 : 0;
        for (const pb of p.pebbles) {
          const px = toSX(pb.x) + Math.sin(time * 23 + pb.ph) * jit * S * 0.8;
          const py = toSY(pb.sy + o) - pb.r * pb.ry * S * 0.6;
          g.fillStyle = rgba(mixRgb(pal.stone, pb.shade > 0.5 ? pal.furHi : pal.furLo, 0.25 + pb.shade * 0.2));
          g.beginPath(); g.ellipse(px, py, pb.r * S, pb.r * pb.ry * S, 0, 0, TAU); g.fill();
          g.fillStyle = rgba(pal.furHi, 0.45);
          g.beginPath(); g.ellipse(px - pb.r * 0.3 * S, py - pb.r * pb.ry * 0.4 * S, pb.r * 0.45 * S, pb.r * 0.22 * S, 0, 0, TAU); g.fill();
        }
      }
      if (p.bridge) {
        // breath bridge: a lighter, softly glowing tuft that rides the creature's breathing
        g.strokeStyle = rgba(pal.light, 0.35 + 0.25 * creature.breathVal); g.lineWidth = 1.2 * S;
        g.beginPath(); g.moveTo(xL + 4 * S, yL + 4 * S); g.quadraticCurveTo((xL + xR) / 2, yL + 10 * S, xR - 4 * S, yR + 4 * S); g.stroke();
      }
      drawDeco(p, pal, o);
    }

    function drawDeco(p, pal, o) {
      const sway = 0.07 + creature.shown / 100 * 0.18 + (creature.shift ? 0.12 : 0);
      const tremble = creature.state >= 1 ? Math.sin(time * 31) * 0.05 * creature.state : 0;
      for (const d of p.deco) {
        const x = toSX(d.x), y = toSY(d.y + o);
        if (x < -40 || x > VW + 40) continue;
        const k = S * d.h;
        const a = Math.sin(time * 1.4 + d.ph) * sway + tremble;
        switch (d.type) {
          case "grass": {
            g.strokeStyle = rgba(d.v > 0.5 ? pal.veg : pal.vegDk); g.lineWidth = 1 * S; g.lineCap = "round";
            g.beginPath();
            for (let i = -2; i <= 2; i++) { g.moveTo(x + i * 1.4 * S, y); g.quadraticCurveTo(x + i * 1.6 * S, y - 4 * k, x + i * 2.4 * S + a * 10 * k, y - (6 + (2 - Math.abs(i)) * 1.6) * k); }
            g.stroke(); break;
          }
          case "flower": {
            g.strokeStyle = rgba(pal.vegDk); g.lineWidth = 0.8 * S;
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x, y - 5 * k, x + a * 8 * k, y - 8 * k); g.stroke();
            g.fillStyle = rgba(d.v > 0.6 ? pal.flower : mixRgb(pal.flower, pal.furHi, 0.45));
            g.beginPath(); g.arc(x + a * 8 * k, y - 8.5 * k, 2 * k, 0, TAU); g.fill();
            if (d.v > 0.3) { g.beginPath(); g.arc(x + 3 * k + a * 6 * k, y - 6 * k, 1.5 * k, 0, TAU); g.fill(); }
            break;
          }
          case "shrub": {
            g.fillStyle = rgba(pal.vegDk);
            g.beginPath(); g.ellipse(x, y - 3 * k, 7 * k, 5 * k, a * 0.5, 0, TAU); g.fill();
            g.fillStyle = rgba(pal.veg);
            g.beginPath(); g.ellipse(x - 1.5 * k, y - 4.5 * k, 4.5 * k, 3.4 * k, a * 0.5, 0, TAU); g.fill();
            break;
          }
          case "pine": {
            const h = 30 * k;
            g.save(); g.translate(x, y); g.rotate(a * 0.25);
            g.fillStyle = rgba(pal.vegDk);
            g.beginPath(); g.moveTo(0, -h); g.quadraticCurveTo(h * 0.35, -h * 0.35, h * 0.26, 0); g.lineTo(-h * 0.26, 0); g.quadraticCurveTo(-h * 0.35, -h * 0.35, 0, -h); g.fill();
            g.fillStyle = rgba(pal.veg, 0.8);
            g.beginPath(); g.moveTo(0, -h); g.quadraticCurveTo(-h * 0.3, -h * 0.4, -h * 0.2, -h * 0.05); g.lineTo(-h * 0.03, -h * 0.1); g.quadraticCurveTo(-h * 0.1, -h * 0.5, 0, -h); g.fill();
            g.restore();
            break;
          }
          case "rock": {
            g.fillStyle = rgba(mixRgb(pal.stone, pal.furLo, 0.2));
            g.beginPath(); g.ellipse(x, y - 1.5 * k, 4.5 * k, 3 * k, 0, 0, TAU); g.fill();
            g.fillStyle = rgba(pal.furHi, 0.4);
            g.beginPath(); g.ellipse(x - 1.2 * k, y - 3 * k, 2 * k, 1 * k, 0, 0, TAU); g.fill();
            break;
          }
          case "moss": {
            g.fillStyle = rgba(d.v > 0.5 ? pal.veg : mixRgb(pal.veg, pal.vegDk, 0.5));
            g.beginPath(); g.ellipse(x, y - 1 * k, 6 * k, 3 * k, 0, 0, TAU); g.fill();
            break;
          }
          case "fern": {
            g.strokeStyle = rgba(pal.veg); g.lineWidth = 0.9 * S;
            g.beginPath();
            for (let i = -1; i <= 1; i++) {
              const tipX = x + (i * 5 + a * 10) * k, tipY = y - (9 - Math.abs(i) * 2) * k;
              g.moveTo(x, y); g.quadraticCurveTo(x + i * 2 * k, y - 6 * k, tipX, tipY);
              for (let j = 1; j < 4; j++) { const t = j / 4; const fx = lerp(x, tipX, t), fy = lerp(y, tipY, t); g.moveTo(fx, fy); g.lineTo(fx + 2 * k, fy + 1 * k); g.moveTo(fx, fy); g.lineTo(fx - 2 * k, fy + 1 * k); }
            }
            g.stroke(); break;
          }
          case "minimush":
          case "lantern": {
            const lantern = d.type === "lantern";
            for (let i = 0; i < 2; i++) {
              const mx = x + i * 4 * k, h = (5 + i * 2) * k;
              g.fillStyle = rgba(pal.furHi); g.fillRect(mx - 0.6 * S, y - h, 1.2 * S, h);
              g.fillStyle = rgba(lantern ? hexRgb("#8fd6c8") : pal.cap);
              g.beginPath(); g.ellipse(mx, y - h, 3 * k, 1.8 * k, 0, Math.PI, TAU); g.fill();
              if (lantern) {
                const lg = g.createRadialGradient(mx, y - h, 0, mx, y - h, 9 * k);
                lg.addColorStop(0, "rgba(170,240,226,0.35)"); lg.addColorStop(1, "rgba(170,240,226,0)");
                g.fillStyle = lg; g.fillRect(mx - 9 * k, y - h - 9 * k, 18 * k, 18 * k);
              }
            }
            break;
          }
          case "glowbell": {
            g.strokeStyle = rgba(pal.vegDk); g.lineWidth = 0.8 * S;
            const tx = x + 4 * k + a * 6 * k, ty = y - 9 * k;
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x, y - 12 * k, tx, ty); g.stroke();
            const lg = g.createRadialGradient(tx, ty + 2 * k, 0, tx, ty + 2 * k, 8 * k);
            lg.addColorStop(0, "rgba(255,236,190,0.45)"); lg.addColorStop(1, "rgba(255,236,190,0)");
            g.fillStyle = lg; g.fillRect(tx - 8 * k, ty - 6 * k, 16 * k, 16 * k);
            g.fillStyle = "rgba(255,240,205,0.95)";
            g.beginPath(); g.ellipse(tx, ty + 2 * k, 1.8 * k, 2.4 * k, 0, 0, TAU); g.fill();
            break;
          }
          case "ember": {
            g.strokeStyle = rgba(hexRgb("#d9875a"), 0.9); g.lineWidth = 1 * S;
            g.beginPath();
            for (let i = -1; i <= 1; i += 2) { g.moveTo(x, y); g.quadraticCurveTo(x + i * 3 * k, y - 5 * k, x + i * 5 * k + a * 6 * k, y - 9 * k); }
            g.stroke(); break;
          }
          case "hair": {
            g.strokeStyle = rgba(pal.furLo, 0.6); g.lineWidth = 0.7 * S;
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2 * k, y - 4 * k, x + 3 * k + a * 6 * k, y - 7 * k); g.stroke();
            break;
          }
          case "pillar": {
            const h = 26 * k;
            g.fillStyle = rgba(mixRgb(pal.ruin, pal.furLo, 0.15));
            g.fillRect(x - 3.5 * k, y - h, 7 * k, h);
            g.fillRect(x - 5 * k, y - h - 2.5 * k, 10 * k, 3 * k);
            g.fillStyle = rgba(pal.furHi, 0.3); g.fillRect(x - 3.5 * k, y - h, 1.5 * k, h);
            // broken arch reaching toward its neighbour
            g.strokeStyle = rgba(mixRgb(pal.ruin, pal.furLo, 0.15)); g.lineWidth = 4 * k;
            g.beginPath(); g.arc(x + 12 * k, y - h, 12 * k, Math.PI, Math.PI * 1.55); g.stroke();
            break;
          }
          case "glyph": {
            g.strokeStyle = rgba(mixRgb(pal.light, pal.ruin, 0.4), 0.7); g.lineWidth = 0.9 * S;
            g.beginPath(); g.arc(x, y + 4 * S, 2.6 * k, 0, TAU * 0.8); g.moveTo(x - 3.5 * k, y + 8 * S); g.lineTo(x + 3.5 * k, y + 8 * S); g.stroke();
            break;
          }
        }
      }
    }

    function drawMushroom(p, pal, o) {
      const cx = toSX((p.x0 + p.x1) / 2);
      const capY = toSY(p.yMax + o) + 2 * S;
      const baseY = toSY(p.stem.baseY + o * 0.5);
      const sq = p.squash;
      const w = (p.x1 - p.x0) / 2 * S * (1 + sq * 0.12);
      const h = 15 * S * (1 - sq * 0.35);
      // stem
      g.fillStyle = rgba(mixRgb(pal.furHi, pal.fur, 0.25));
      g.beginPath();
      g.moveTo(cx - 4 * S, baseY); g.quadraticCurveTo(cx - 6 * S, (baseY + capY) / 2, cx - 3.5 * S, capY);
      g.lineTo(cx + 3.5 * S, capY); g.quadraticCurveTo(cx + 2 * S, (baseY + capY) / 2, cx + 5 * S, baseY); g.closePath(); g.fill();
      // underside / gills
      g.fillStyle = rgba(mixRgb(pal.furHi, pal.cap, 0.25));
      g.beginPath(); g.ellipse(cx, capY + 1 * S, w * 0.96, 3.6 * S, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(mixRgb(pal.cap, pal.furLo, 0.35), 0.6); g.lineWidth = 0.7 * S;
      g.beginPath();
      for (let i = -5; i <= 5; i++) { g.moveTo(cx + i * w * 0.17, capY + 2.8 * S); g.lineTo(cx + i * w * 0.08, capY - 0.5 * S); }
      g.stroke();
      // cap
      const cg = g.createLinearGradient(0, capY - h, 0, capY);
      cg.addColorStop(0, rgba(mixRgb(pal.cap, pal.furHi, 0.35))); cg.addColorStop(1, rgba(mixRgb(pal.cap, pal.furLo, 0.25)));
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(cx - w, capY);
      g.bezierCurveTo(cx - w, capY - h * 1.1, cx + w, capY - h * 1.1, cx + w, capY);
      g.quadraticCurveTo(cx, capY + 3 * S, cx - w, capY);
      g.fill();
      g.fillStyle = rgba(pal.furHi, 0.5);
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(cx - w * 0.5 + i * w * 0.33, capY - h * (0.5 + (i % 2) * 0.2), 2 * S, 1.2 * S, 0, 0, TAU); g.fill(); }
      g.strokeStyle = rgba(pal.light, 0.35); g.lineWidth = 1.2 * S;
      g.beginPath(); g.moveTo(cx - w * 0.75, capY - h * 0.55); g.quadraticCurveTo(cx - w * 0.3, capY - h * 0.95, cx + w * 0.2, capY - h * 0.88); g.stroke();
    }

    function drawVines(pal) {
      for (const v of world.vines) {
        const top = toSY(v.yTop), bot = toSY(v.yBot);
        if (bot < -20 || top > VH + 20) continue;
        const x = toSX(v.x);
        const swayAmp = (2 + creature.shown / 30) * S;
        g.strokeStyle = rgba(mixRgb(pal.vegDk, pal.furLo, 0.25)); g.lineWidth = 2.4 * S; g.lineCap = "round";
        for (let strand = 0; strand < 2; strand++) {
          g.beginPath();
          const segs = 10;
          for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const y = lerp(top, bot, t);
            const sx = x + (strand ? 2.5 * S : -1.5 * S) + Math.sin(time * 0.9 + v.ph + t * 3 + strand) * swayAmp * t;
            if (i) g.lineTo(sx, y); else g.moveTo(sx, y);
          }
          g.stroke();
          g.lineWidth = 1.4 * S;
        }
        g.fillStyle = rgba(pal.veg);
        for (let i = 0; i < v.leaves; i++) {
          const t = (i + 0.5) / v.leaves;
          const y = lerp(top, bot, t);
          const sx = x + Math.sin(time * 0.9 + v.ph + t * 3) * swayAmp * t;
          g.beginPath(); g.ellipse(sx + (i % 2 ? 3 : -3) * S, y, 3 * S, 1.6 * S, i % 2 ? 0.5 : -0.5, 0, TAU); g.fill();
        }
      }
    }

    function drawSeed(s) {
      const c = SEED_COLORS[s.rarity];
      const o = s.p ? off(s.p) : 0;
      const x = toSX(s.x);
      const groundY = toSY(s.y + o);
      if (groundY < -40 || groundY > VH + 40) return;
      const bob = s.float ? Math.sin(time * 1.6 + s.ph) * 2.2 * S : 0;
      const by = s.float ? groundY + bob : groundY - c.stem * S;
      let scale = 1, alpha = 1;
      if (s.taken) {
        const t = s.takeT;
        if (t > 0.5) return;
        scale = t < 0.08 ? 1 - t / 0.08 * 0.25 : 0.75 + (t - 0.08) * 1.8;
        alpha = 1 - clamp((t - 0.08) / 0.42, 0, 1);
        // a delicate light spreading outward
        g.strokeStyle = rgba(c.glow, 0.6 * alpha); g.lineWidth = 1.2 * S;
        g.beginPath(); g.arc(x, by, (6 + t * 70) * S, 0, TAU); g.stroke();
      }
      const pulse = 0.5 + 0.5 * Math.sin(time * (s.rarity === "ancient" ? 1.4 : 2.2) + s.ph);
      const gr = c.glowR * S * (0.85 + 0.15 * pulse) * scale;
      const gg = g.createRadialGradient(x, by, 0, x, by, gr);
      gg.addColorStop(0, rgba(c.glow, (0.42 + 0.12 * pulse) * alpha)); gg.addColorStop(1, rgba(c.glow, 0));
      g.fillStyle = gg; g.fillRect(x - gr, by - gr, gr * 2, gr * 2);
      if (!s.float && !s.taken) {
        const pal = palAt(s.y * CFG.METERS_PER_UNIT);
        g.strokeStyle = rgba(pal.vegDk); g.lineWidth = 0.9 * S;
        g.beginPath(); g.moveTo(x, groundY); g.quadraticCurveTo(x - 2 * S, (groundY + by) / 2, x, by + 2 * S); g.stroke();
        g.fillStyle = rgba(pal.veg);
        g.beginPath(); g.ellipse(x - 3 * S, groundY - 3 * S, 3 * S, 1.3 * S, -0.5, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(x + 3 * S, groundY - 4.5 * S, 2.6 * S, 1.2 * S, 0.5, 0, TAU); g.fill();
      }
      g.save();
      g.translate(x, by); g.scale(scale * S, scale * S);
      g.globalAlpha = alpha;
      if (s.rarity === "common") {
        g.fillStyle = rgba(c.petal);
        g.beginPath(); g.moveTo(0, -5.5); g.bezierCurveTo(3.6, -2, 3.2, 3, 0, 3.4); g.bezierCurveTo(-3.2, 3, -3.6, -2, 0, -5.5); g.fill();
        g.fillStyle = rgba(c.core); g.beginPath(); g.arc(0, 0.2, 1.4 + pulse * 0.4, 0, TAU); g.fill();
      } else if (s.rarity === "rare") {
        const pc = s.alt ? c.alt : c.petal;
        g.fillStyle = rgba(pc);
        for (let i = -1; i <= 1; i++) {
          g.save(); g.rotate(i * 0.55);
          g.beginPath(); g.moveTo(0, 2); g.bezierCurveTo(3.4, -1, 2.4, -6.5, 0, -7.5); g.bezierCurveTo(-2.4, -6.5, -3.4, -1, 0, 2); g.fill();
          g.restore();
        }
        g.fillStyle = rgba(c.core); g.beginPath(); g.arc(0, -1, 1.5 + pulse * 0.5, 0, TAU); g.fill();
      } else {
        g.fillStyle = rgba(c.petal);
        for (let i = 0; i < 7; i++) {
          g.save(); g.rotate(-Math.PI / 2 + (i - 3) * 0.42);
          g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(2.6, 2.5, 2.6, 7, 0, 9.5); g.bezierCurveTo(-2.6, 7, -2.6, 2.5, 0, 0); g.fill();
          g.restore();
        }
        g.fillStyle = rgba(c.alt);
        for (let i = 0; i < 4; i++) {
          g.save(); g.rotate(-Math.PI / 2 + (i - 1.5) * 0.5);
          g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(1.6, 2, 1.6, 5, 0, 6.5); g.bezierCurveTo(-1.6, 5, -1.6, 2, 0, 0); g.fill();
          g.restore();
        }
        g.fillStyle = rgba(c.core); g.beginPath(); g.arc(0, -1, 2 + pulse * 0.6, 0, TAU); g.fill();
        g.fillStyle = rgba(c.glow, 0.8);
        for (let i = 0; i < 3; i++) { const a = time * 0.8 + i * 2.1; g.beginPath(); g.arc(Math.cos(a) * 9, -4 + Math.sin(a * 1.3) * 5 - ((time * 6 + i * 5) % 10), 0.7, 0, TAU); g.fill(); }
      }
      g.restore();
      g.globalAlpha = 1;
    }

    // --- The explorer: small, rust-coloured, procedurally animated --------
    const SKIN = hexRgb("#c98d6c"), HAIR = hexRgb("#2a2027"), JACKET = hexRgb("#c25a32"), JACKET_DK = hexRgb("#9c4428"), PANTS = hexRgb("#3a3346"), BOOT = hexRgb("#251f2b"), PACK = hexRgb("#7b5638");
    function limb(ox, oy, a1, l1, a2, l2) {
      const kx = ox + Math.sin(a1) * l1, ky = oy + Math.cos(a1) * l1;
      return [kx, ky, kx + Math.sin(a2) * l2, ky + Math.cos(a2) * l2];
    }
    function drawPlayer() {
      const sx = toSX(P.x), sy = toSY(P.y);
      if (sy < -60 || sy > VH + 80) return;
      const airborne = !P.ground && !P.vine;
      const speed = Math.abs(P.vx);
      const waking = game.state === "waking" || game.state === "results";
      let crouch = 0, lean = 0, legAmp = 0, armSwing = 0, bob = 0;
      const ph = P.phase;
      if (P.ground && !waking) {
        legAmp = clamp(speed / CFG.PLAYER_WALK_SPEED, 0, 1) * (P.running ? 0.85 : 0.5);
        armSwing = legAmp * 0.9;
        lean = P.running ? 0.2 : speed > 5 ? 0.07 : 0;
        bob = speed > 5 ? Math.abs(Math.sin(ph)) * (P.running ? 1.2 : 0.6) : Math.sin(time * 2.2) * 0.25;
      }
      if (P.anticOn) crouch = 0.8;
      if (P.landT > 0) crouch = Math.max(crouch, P.landT / (CFG.LANDING_RECOVERY_MS / 1000) * (P.landHard ? 0.45 : 0.6));
      if (P.braceT > 0 || (creature.shift && creature.shift.phase === "tele" && creature.shift.strong && speed < 10 && P.ground)) crouch = Math.max(crouch, 0.5);
      if (P.slipT > 0) lean = -0.3 + Math.sin(time * 18) * 0.1;
      g.save();
      g.translate(sx, sy);
      if (waking) g.rotate(P.rot);
      const k = S * 1.08;
      g.scale(k * P.facing, k);
      // soft contact shadow
      if (P.ground) { g.fillStyle = "rgba(60,40,70,0.18)"; g.beginPath(); g.ellipse(0, 0.5, 7, 1.6, 0, 0, TAU); g.fill(); }
      const hipX = 0, hipY = -11 + crouch * 3.6 - bob * 0.4;
      const shX = hipX + Math.sin(lean + crouch * 0.25) * 8.5, shY = hipY - Math.cos(lean + crouch * 0.25) * 8.5;
      const headX = shX + Math.sin(lean) * 4.6, headY = shY - Math.cos(lean) * 4.4;
      const legs = [], arms = [];
      for (let i = 0; i < 2; i++) {
        const p2 = ph + i * Math.PI;
        let a1, a2;
        if (P.vine) { a1 = Math.sin(P.phase + i * Math.PI) * 0.5 - 0.2; a2 = a1 + 0.9; }
        else if (waking) { a1 = (i ? 0.9 : -0.7) + Math.sin(time * 9 + i) * 0.3; a2 = a1 + 0.6; }
        else if (airborne) { a1 = i ? 0.45 : -0.65; a2 = i ? 1.3 : 0.15; if (P.vy < -200) { a1 *= 0.5; a2 = a1 + 0.25; } }
        else if (crouch > 0.05) { a1 = -0.95 * crouch + (i ? 0.25 : -0.1); a2 = 0.85 * crouch + (i ? 0.3 : 0.1); }
        else if (P.teeter > 0.3 && i === 0) { a1 = -0.35; a2 = -0.1; }
        else { a1 = Math.sin(p2) * legAmp; a2 = a1 + Math.max(0, -Math.cos(p2)) * legAmp * 1.6 + 0.04; }
        legs.push(limb(hipX, hipY, a1, 5.8, a2, 5.6));
        let u, f;
        if (P.vine) { u = Math.PI - 0.25 + Math.sin(P.phase + i * Math.PI) * 0.35; f = u - 0.2; }
        else if (waking) { u = Math.PI * 0.7 + Math.sin(time * 11 + i * 2) * 0.8; f = u + 0.4; }
        else if (P.collectT > 0 && i === 0) { u = Math.PI - 0.5; f = u - 0.15; }
        else if (P.slipT > 0 || P.teeter > 0.3) { u = (i ? -1 : 1) * (1.4 + Math.sin(time * (P.slipT > 0 ? 16 : 7) + i * 3) * 0.6); f = u + 0.4; }
        else if (airborne) { u = P.vy > 0 ? (i ? 2.6 : 2.2) : (i ? 1.5 : 1.2); f = u + 0.3; }
        else if (crouch > 0.3 && P.braceT > 0) { u = i ? -1.1 : 1.1; f = u + 0.3; }
        else { u = -Math.sin(p2) * armSwing + 0.08; f = u + 0.45 + (P.running ? 0.6 : 0); }
        arms.push(limb(shX, shY, u, 4.4, f, 4.2));
      }
      g.lineCap = "round"; g.lineJoin = "round";
      // back limbs
      g.strokeStyle = rgba(mixRgb(PANTS, INK, 0.35)); g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(legs[1][0], legs[1][1]); g.lineTo(legs[1][2], legs[1][3]); g.stroke();
      g.fillStyle = rgba(BOOT); g.beginPath(); g.ellipse(legs[1][2] + 0.8, legs[1][3] - 0.4, 1.7, 1.1, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(JACKET_DK); g.lineWidth = 2.1;
      g.beginPath(); g.moveTo(shX, shY); g.lineTo(arms[1][0], arms[1][1]); g.lineTo(arms[1][2], arms[1][3]); g.stroke();
      // backpack
      g.save(); g.translate((hipX + shX) / 2 - 2.6, (hipY + shY) / 2 - 0.6); g.rotate(lean);
      g.fillStyle = rgba(PACK); roundRect(-2.2, -4, 3.8, 7, 1.2); g.fill();
      g.restore();
      // torso
      g.strokeStyle = rgba(JACKET); g.lineWidth = 5.4;
      g.beginPath(); g.moveTo(hipX, hipY - 0.8); g.lineTo(shX, shY + 0.6); g.stroke();
      g.strokeStyle = rgba(mixRgb(JACKET, CREAM, 0.25), 0.7); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(hipX + 1.6, hipY - 1.5); g.lineTo(shX + 1.6, shY + 1); g.stroke();
      // head
      g.fillStyle = rgba(SKIN); g.beginPath(); g.arc(headX, headY, 3.5, 0, TAU); g.fill();
      g.fillStyle = rgba(HAIR);
      g.beginPath(); g.arc(headX - 0.6, headY - 0.5, 3.6, Math.PI * 0.62, Math.PI * 2.05); g.closePath(); g.fill();
      // front limbs
      g.strokeStyle = rgba(PANTS); g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(legs[0][0], legs[0][1]); g.lineTo(legs[0][2], legs[0][3]); g.stroke();
      g.fillStyle = rgba(BOOT); g.beginPath(); g.ellipse(legs[0][2] + 0.8, legs[0][3] - 0.4, 1.8, 1.15, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(JACKET); g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(shX, shY); g.lineTo(arms[0][0], arms[0][1]); g.lineTo(arms[0][2], arms[0][3]); g.stroke();
      g.fillStyle = rgba(SKIN); g.beginPath(); g.arc(arms[0][2], arms[0][3], 1.1, 0, TAU); g.fill();
      g.restore();
    }

    function drawParticles(pal) {
      for (const p of particles) {
        const x = toSX(p.x), y = toSY(p.y);
        const t = p.t / p.life;
        if (p.type === "ripple") {
          g.strokeStyle = p.warm ? rgba(mixRgb(pal.flower, CREAM, 0.3), p.a * (1 - t)) : rgba(pal.furHi, p.a * (1 - t));
          g.lineWidth = 1.1 * S;
          g.beginPath(); g.ellipse(x, y, p.r * S * (0.3 + t), p.r * S * 0.28 * (0.3 + t), 0, 0, TAU); g.stroke();
        } else if (p.type === "pebble") {
          g.fillStyle = rgba(pal.stone, 1 - t * 0.5);
          g.beginPath(); g.arc(x, y, p.r * S, 0, TAU); g.fill();
        } else if (p.type === "puff") {
          g.fillStyle = rgba(pal.furHi, 0.55 * (1 - t));
          g.beginPath(); g.arc(x, y, p.r * S * (1 + t), 0, TAU); g.fill();
        } else if (p.type === "dust") {
          g.fillStyle = rgba(mixRgb(pal.furHi, pal.stone, 0.4), 0.6 * Math.min(1, (1 - t) * 3));
          g.fillRect(x, y, p.r * S, p.r * S);
        } else if (p.type === "mote") {
          g.fillStyle = rgba(p.color, 0.9 * (1 - t));
          g.beginPath(); g.arc(x, y, p.r * S * (1 - t * 0.4), 0, TAU); g.fill();
        }
      }
      for (const b of birds) {
        const x = toSX(b.x), y = toSY(b.y);
        const f = Math.sin(b.ph) * 2.5 * S;
        g.strokeStyle = rgba(mixRgb(INK, pal.haze, 0.45), 0.7); g.lineWidth = 1 * S;
        g.beginPath(); g.moveTo(x - 4 * S, y - f); g.quadraticCurveTo(x - 2 * S, y - 1 * S, x, y); g.quadraticCurveTo(x + 2 * S, y - 1 * S, x + 4 * S, y - f); g.stroke();
      }
      // fragment reward: Drift Mites floating through the air
      if (hasFragment(4)) {
        for (let i = 0; i < 10; i++) {
          const x = ((hash1(i * 3.3) * VW + time * (6 + i)) % (VW + 20)) - 10;
          const y = (hash1(i * 7.1) * VH + Math.sin(time * 0.7 + i) * 20 + cam.y * 0.3 * S) % VH;
          g.fillStyle = rgba(pal.light, 0.35 + 0.3 * Math.sin(time * 2 + i));
          g.beginPath(); g.arc(x, y, 1.1, 0, TAU); g.fill();
        }
      }
    }

    function drawAtmosphere(pal) {
      // cream mist at the bottom gives depth below the climber
      const mg = g.createLinearGradient(0, VH * 0.72, 0, VH);
      mg.addColorStop(0, rgba(pal.haze, 0)); mg.addColorStop(1, rgba(pal.haze, 0.55));
      g.fillStyle = mg; g.fillRect(0, VH * 0.72, VW, VH * 0.28);
      // the creature's attention darkens the edges of the world
      const lvl = clamp(creature.shown / 100, 0, 1);
      const quiet = run.streakTier > 0 && game.state === "play" ? run.streakTier * 0.03 : 0;
      if (lvl > 0.04 || quiet > 0) {
        const vg = g.createRadialGradient(VW / 2, VH * 0.55, Math.min(VW, VH) * 0.35, VW / 2, VH * 0.55, Math.max(VW, VH) * 0.75);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        const breathe = 0.85 + 0.15 * creature.breathVal;
        vg.addColorStop(1, lvl > quiet ? "rgba(48,30,66," + (lvl * lvl * 0.6 * breathe).toFixed(3) + ")" : rgba(pal.light, quiet));
        g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
      }
    }

    // --- Waking: the eye opens -------------------------------------------
    function drawWakeEye(pal) {
      const t = game.wakeT;
      const a = clamp(t / 0.6, 0, 1);
      const open = smooth(clamp((t - 0.35) / 0.9, 0, 1));
      const cx = VW / 2, cy = VH * 0.42;
      const ew = Math.min(VW, VH * 0.6) * 0.62;
      g.save();
      g.globalAlpha = a;
      const bg = g.createRadialGradient(cx, cy, ew * 0.2, cx, cy, ew * 1.6);
      bg.addColorStop(0, rgba(mixRgb(pal.fur, pal.furLo, 0.2))); bg.addColorStop(0.7, rgba(pal.furLo, 0.85)); bg.addColorStop(1, rgba(pal.furLo, 0));
      g.fillStyle = bg; g.fillRect(0, 0, VW, VH);
      // fur grain around the eye
      g.strokeStyle = rgba(pal.furHi, 0.35); g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < 70; i++) {
        const ang = hash1(i * 1.7) * TAU, rr = ew * (1.05 + hash1(i * 3.1) * 0.6);
        const x = cx + Math.cos(ang) * rr * 1.2, y = cy + Math.sin(ang) * rr * 0.75;
        g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * 8, y + Math.sin(ang) * 6);
      }
      g.stroke();
      // almond with lids
      const upper = cy - ew * 0.55 * open, lower = cy + ew * 0.2 * open;
      g.save();
      g.beginPath();
      g.moveTo(cx - ew, cy); g.quadraticCurveTo(cx, upper - ew * 0.15 * open, cx + ew, cy); g.quadraticCurveTo(cx, lower + ew * 0.12 * open, cx - ew, cy); g.closePath();
      g.clip();
      const ig = g.createRadialGradient(cx, cy, 0, cx, cy, ew * 0.55);
      ig.addColorStop(0, "#f2c56a"); ig.addColorStop(0.55, "#c98432"); ig.addColorStop(1, "#5e3420");
      g.fillStyle = "#3a2430"; g.fillRect(cx - ew, cy - ew, ew * 2, ew * 2);
      g.fillStyle = ig; g.beginPath(); g.arc(cx, cy, ew * 0.48, 0, TAU); g.fill();
      g.strokeStyle = "rgba(255,226,160,0.35)"; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 40; i++) { const an = i / 40 * TAU; g.moveTo(cx + Math.cos(an) * ew * 0.12, cy + Math.sin(an) * ew * 0.12); g.lineTo(cx + Math.cos(an) * ew * 0.46, cy + Math.sin(an) * ew * 0.46); }
      g.stroke();
      const pw = ew * (0.05 + 0.03 * (1 - open));
      g.fillStyle = "#140c14"; g.beginPath(); g.ellipse(cx, cy, pw, ew * 0.42, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,248,230,0.85)"; g.beginPath(); g.ellipse(cx - ew * 0.17, cy - ew * 0.16, ew * 0.05, ew * 0.035, -0.5, 0, TAU); g.fill();
      g.restore();
      g.strokeStyle = rgba(INK, 0.85); g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(cx - ew, cy); g.quadraticCurveTo(cx, upper - ew * 0.15 * open, cx + ew, cy); g.stroke();
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 1; i < 12; i++) {
        const tt = i / 12;
        const x = (1 - tt) * (1 - tt) * (cx - ew) + 2 * (1 - tt) * tt * cx + tt * tt * (cx + ew);
        const y = (1 - tt) * (1 - tt) * cy + 2 * (1 - tt) * tt * (upper - ew * 0.15 * open) + tt * tt * cy;
        g.moveTo(x, y); g.lineTo(x + (tt - 0.5) * 14, y - 10 - open * 4);
      }
      g.stroke();
      g.restore();
    }

    // --- HUD, title, overlays ---------------------------------------------
    const hud = { height: 0, seedBump: 0, titleA: 1, cardA: 0, toast: null };
    let uiHits = [];
    function hit(x, y, w, h, fn) { uiHits.push({ x, y, w, h, fn }); }
    function textShadow(on) {
      g.shadowColor = on ? "rgba(45,30,55,0.35)" : "transparent";
      g.shadowBlur = on ? 8 : 0; g.shadowOffsetY = on ? 1 : 0;
    }
    function drawSeedIcon(x, y, r, rarity) {
      const c = SEED_COLORS[rarity || "ancient"];
      const gg = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
      gg.addColorStop(0, rgba(c.glow, 0.55)); gg.addColorStop(1, rgba(c.glow, 0));
      g.fillStyle = gg; g.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
      g.fillStyle = rgba(c.petal);
      g.beginPath(); g.moveTo(x, y - r * 1.4); g.bezierCurveTo(x + r, y - r * 0.4, x + r * 0.9, y + r * 0.8, x, y + r * 0.9); g.bezierCurveTo(x - r * 0.9, y + r * 0.8, x - r, y - r * 0.4, x, y - r * 1.4); g.fill();
      g.fillStyle = rgba(c.core); g.beginPath(); g.arc(x, y, r * 0.35, 0, TAU); g.fill();
    }
    function drawHUD(dt) {
      const top = SAFE_TOP + 14;
      const playA = 1 - hud.titleA;
      if (playA > 0.01 && game.state !== "results") {
        g.save(); g.globalAlpha = playA;
        textShadow(true);
        g.fillStyle = rgba(CREAM, 0.95);
        g.font = "600 10px " + FONT_UI; g.textBaseline = "alphabetic";
        spaced("HEIGHT", 18, top + 10, 1.8, "left");
        g.font = "400 38px " + FONT_NUM;
        const num = fmt(hud.height);
        g.fillText(num, 18, top + 46);
        const w = g.measureText(num).width;
        g.font = "400 22px " + FONT_NUM;
        g.fillText(" m", 18 + w, top + 46);
        // quiet streak: a restrained mark under the height
        if (run.streakTier > 0) {
          g.fillStyle = rgba(CREAM, 0.85);
          for (let i = 0; i < run.streakTier; i++) {
            const lx = 22 + i * 10, ly = top + 58;
            g.beginPath(); g.ellipse(lx, ly, 2.2, 4, 0.6, 0, TAU); g.fill();
          }
          g.font = "600 9px " + FONT_UI;
          spaced("QUIET", 22 + run.streakTier * 10 + 2, top + 62, 1.4, "left");
        }
        // pause
        const pr = 17, px = VW - 18 - pr, py = top + 20;
        textShadow(false);
        g.fillStyle = "rgba(34,30,52,0.32)";
        g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
        g.fillStyle = rgba(CREAM, 0.95);
        g.fillRect(px - 5, py - 6, 3.4, 12); g.fillRect(px + 1.6, py - 6, 3.4, 12);
        hit(px - pr - 8, py - pr - 8, pr * 2 + 16, pr * 2 + 16, () => setPaused(true));
        // dream seeds
        textShadow(true);
        hud.seedBump = Math.max(0, hud.seedBump - dt * 3);
        g.font = "400 " + Math.round(28 + hud.seedBump * 6) + "px " + FONT_NUM;
        g.textAlign = "right"; g.fillStyle = rgba(CREAM, 0.95);
        g.fillText(String(run.seeds), px - pr - 12, py + 10);
        const cw = g.measureText(String(run.seeds)).width;
        g.textAlign = "left";
        textShadow(false);
        drawSeedIcon(px - pr - 22 - cw, py, 5.5, "common");
        g.restore();
      }
      // discovery toast: restrained, never a modal
      if (hud.toast) {
        const tt = hud.toast;
        tt.t += dt;
        const a = Math.min(1, tt.t / 0.3) * (1 - clamp((tt.t - 2.6) / 0.5, 0, 1));
        if (tt.t > 3.1) hud.toast = null;
        else {
          g.save(); g.globalAlpha = a;
          const w = 220, h = 46, x = VW / 2 - w / 2, y = SAFE_TOP + 84;
          g.fillStyle = "rgba(27,32,52,0.78)"; roundRect(x, y, w, h, 10); g.fill();
          drawSeedIcon(x + 22, y + h / 2, 5, tt.rarity);
          g.fillStyle = rgba(hexRgb("#e9c98f")); g.font = "600 8.5px " + FONT_UI;
          spaced(tt.title.toUpperCase(), x + 40, y + 18, 1.6, "left");
          g.fillStyle = rgba(CREAM); g.font = "italic 300 19px " + FONT_SERIF;
          g.fillText(tt.name, x + 40, y + 37);
          g.restore();
        }
      }
    }
    function showToast(title, name, rarity, fragment) { hud.toast = { title, name, rarity, fragment, t: 0 }; }

    function drawTitle() {
      if (hud.titleA <= 0.01) return;
      g.save(); g.globalAlpha = hud.titleA;
      textShadow(true);
      g.fillStyle = rgba(CREAM);
      const big = Math.min(78, VW * 0.19);
      g.font = "400 " + big + "px " + FONT_NUM;
      const top = SAFE_TOP + 34 + big * 0.8;
      g.fillText("DON’T", 22, top);
      g.fillText("WAKE IT", 22, top + big * 0.88);
      g.font = "600 11px " + FONT_UI;
      spaced("CLIMB HIGHER.", 25, top + big * 0.88 + 30, 3.2, "left");
      spaced("STAY QUIET.", 25, top + big * 0.88 + 48, 3.2, "left");
      g.font = "600 9.5px " + FONT_UI;
      g.fillStyle = rgba(CREAM, 0.9);
      const hy = VH * 0.86 - Math.max(SAFE_BOTTOM, 0) - 14;
      spaced("HOLD LEFT OR RIGHT TO MOVE CAREFULLY", VW / 2, hy, 1.5, "center");
      spaced("SLIDE OUTWARD TO HURRY · SWIPE UP TO JUMP", VW / 2, hy + 16, 1.5, "center");
      spaced("LET GO TO BE STILL", VW / 2, hy + 32, 1.5, "center");
      if (save.best > 0) {
        g.font = "600 9px " + FONT_UI; g.fillStyle = rgba(CREAM, 0.8);
        spaced("BEST  " + fmt(save.best) + " M", 25, top + big * 0.88 + 72, 2, "left");
      }
      textShadow(false);
      // the creature's memory, once there is something to remember
      if (save.fragments.length > 0) {
        const bx = VW - 18 - 116, by = SAFE_TOP + 22;
        g.fillStyle = "rgba(27,32,52,0.55)"; roundRect(bx, by, 116, 30, 15); g.fill();
        g.fillStyle = rgba(CREAM); g.font = "600 8.5px " + FONT_UI;
        spaced("MEMORY " + save.fragments.length + "/" + FRAGMENTS.length, bx + 58, by + 19, 1.4, "center");
        hit(bx - 6, by - 6, 128, 42, () => openJournal("title"));
      }
      g.restore();
    }

    function pill(x, y, w, h, label, filled, fn) {
      g.fillStyle = filled ? "#f6e8d6" : "rgba(246,232,214,0.12)";
      roundRect(x, y, w, h, h / 2); g.fill();
      if (!filled) { g.strokeStyle = "rgba(246,232,214,0.45)"; g.lineWidth = 1; g.stroke(); }
      g.fillStyle = filled ? "#22273c" : rgba(CREAM);
      g.font = "700 11px " + FONT_UI;
      spaced(label, x + w / 2, y + h / 2 + 4, 2, "center");
      hit(x, y - 4, w, h + 8, fn);
    }

    function drawResults(dt) {
      hud.cardA = Math.min(1, hud.cardA + dt * 3);
      const a = smooth(hud.cardA);
      g.fillStyle = "rgba(16,16,32," + (0.35 * a).toFixed(3) + ")"; g.fillRect(0, 0, VW, VH);
      const w = Math.min(290, VW - 48), h = 340 + (run.discoveries.length ? 46 : 0);
      const x = VW / 2 - w / 2, y = Math.max(SAFE_TOP + 20, VH * 0.46 - h / 2) + (1 - a) * 24;
      g.save(); g.globalAlpha = a;
      g.fillStyle = "rgba(27,32,52,0.95)"; roundRect(x, y, w, h, 14); g.fill();
      let cy = y + 34;
      g.fillStyle = rgba(hexRgb("#c9b8d8")); g.font = "600 9px " + FONT_UI;
      spaced("THE CREATURE WAKES", x + 24, cy, 2.2, "left");
      cy += 30;
      const row = (label, value, unit, tag) => {
        g.fillStyle = rgba(CREAM, 0.7); g.font = "600 9px " + FONT_UI; spaced(label, x + 24, cy, 1.8, "left");
        g.fillStyle = rgba(CREAM); g.font = "400 36px " + FONT_NUM; g.fillText(value, x + 24, cy + 36);
        if (unit) { const vw = g.measureText(value).width; g.font = "400 20px " + FONT_NUM; g.fillText(unit, x + 26 + vw, cy + 36); }
        if (tag) { g.fillStyle = rgba(hexRgb("#e9c98f")); g.font = "700 8.5px " + FONT_UI; spaced(tag, x + w - 24, cy, 1.6, "right"); }
        cy += 58;
      };
      row("HEIGHT", fmt(game.finalHeight), " m", game.newBest ? "NEW BEST" : "");
      row("DREAM SEEDS", String(run.seeds), "", "");
      row("BEST HEIGHT", fmt(save.best), " m", "");
      if (run.discoveries.length) {
        g.fillStyle = rgba(CREAM, 0.7); g.font = "600 9px " + FONT_UI; spaced("NEW DISCOVERY", x + 24, cy, 1.8, "left");
        drawSeedIcon(x + 30, cy + 20, 5, "ancient");
        g.fillStyle = rgba(CREAM); g.font = "italic 300 20px " + FONT_SERIF;
        g.fillText(FRAGMENTS[run.discoveries[run.discoveries.length - 1]].name + (run.discoveries.length > 1 ? "  +" + (run.discoveries.length - 1) : ""), x + 44, cy + 26);
        cy += 46;
      }
      pill(x + 24, cy - 8, w - 48, 40, "TRY AGAIN", true, () => restart());
      cy += 46;
      g.fillStyle = rgba(CREAM, 0.6); g.font = "600 8.5px " + FONT_UI;
      spaced("THE CREATURE’S MEMORY · " + save.fragments.length + "/" + FRAGMENTS.length, x + w / 2, cy + 10, 1.6, "center");
      hit(x + 20, cy - 6, w - 40, 26, () => openJournal("results"));
      g.restore();
    }

    function drawPause() {
      g.fillStyle = "rgba(16,16,32,0.45)"; g.fillRect(0, 0, VW, VH);
      const w = Math.min(270, VW - 60), h = 214, x = VW / 2 - w / 2, y = VH * 0.42 - h / 2;
      g.fillStyle = "rgba(27,32,52,0.95)"; roundRect(x, y, w, h, 14); g.fill();
      g.fillStyle = rgba(CREAM); g.font = "400 30px " + FONT_NUM; g.textAlign = "center";
      g.fillText("STILL", VW / 2, y + 46); g.textAlign = "left";
      g.fillStyle = rgba(CREAM, 0.6); g.font = "600 8.5px " + FONT_UI;
      spaced("THE CREATURE SLEEPS ON", VW / 2, y + 66, 1.6, "center");
      pill(x + 22, y + 86, w - 44, 36, "RESUME", true, () => setPaused(false));
      pill(x + 22, y + 130, w - 44, 32, save.muted ? "SOUND: OFF" : "SOUND: ON", false, () => setMuted(!save.muted));
      pill(x + 22, y + 170, w - 44, 32, "MEMORY " + save.fragments.length + "/" + FRAGMENTS.length, false, () => openJournal("pause"));
    }

    // Fragment glyphs: a small field-journal line drawing for each memory.
    function drawGlyph(i, x, y, r, known) {
      g.save(); g.translate(x, y);
      g.strokeStyle = known ? "#e9c98f" : "rgba(233,201,143,0.18)"; g.fillStyle = g.strokeStyle;
      g.lineWidth = 1.2; g.lineCap = "round";
      g.beginPath();
      switch (i) {
        case 0: for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a - 0.4) * r, Math.sin(a - 0.4) * r, Math.cos(a) * r, Math.sin(a) * r); g.quadraticCurveTo(Math.cos(a + 0.4) * r, Math.sin(a + 0.4) * r, 0, 0); } break;
        case 1: g.arc(-r * 0.3, 0, r * 0.45, Math.PI, TAU); g.moveTo(-r * 0.3, 0); g.lineTo(-r * 0.3, r * 0.8); g.moveTo(r * 0.55, r * 0.1); g.arc(r * 0.35, r * 0.1, r * 0.3, Math.PI, TAU); g.moveTo(r * 0.35, r * 0.1); g.lineTo(r * 0.35, r * 0.8); break;
        case 2: { const pts = [[-0.8, 0.3], [-0.3, -0.5], [0.2, -0.2], [0.7, -0.7], [0.5, 0.5]]; pts.forEach((q, k) => k ? g.lineTo(q[0] * r, q[1] * r) : g.moveTo(q[0] * r, q[1] * r)); break; }
        case 3: for (let a = 0; a < TAU * 2.3; a += 0.2) { const rr = a / (TAU * 2.3) * r; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; a ? g.lineTo(px, py) : g.moveTo(px, py); } break;
        case 4: g.ellipse(0, 0, r * 0.55, r * 0.3, 0, 0, TAU); for (let k = -2; k <= 2; k++) { g.moveTo(k * r * 0.2, r * 0.25); g.lineTo(k * r * 0.3, r * 0.6); } g.moveTo(r * 0.5, -r * 0.1); g.lineTo(r * 0.85, -r * 0.45); break;
        case 5: for (let k = 0; k < 3; k++) { g.moveTo(r * (0.9 - k * 0.3), 0); g.arc(0, 0, r * (0.9 - k * 0.3), 0, TAU * 0.85); } break;
        case 6: g.moveTo(-r * 0.6, r * 0.8); g.quadraticCurveTo(-r * 0.5, -r * 0.6, r * 0.3, -r * 0.5); g.moveTo(r * 0.3, -r * 0.5); g.arc(r * 0.3, -r * 0.2, r * 0.28, -Math.PI / 2, Math.PI * 1.2); break;
        case 7: for (let k = 0; k < 3; k++) { const yy = (k - 1) * r * 0.45; g.moveTo(-r, yy); for (let s2 = 0; s2 <= 8; s2++) g.lineTo(-r + s2 * r / 4, yy + Math.sin(s2 * 1.6) * r * 0.15); } break;
        case 8: g.moveTo(0, r); g.lineTo(0, -r * 0.8); for (let k = 0; k < 4; k++) { const yy = r * 0.6 - k * r * 0.4; g.moveTo(0, yy); g.quadraticCurveTo(r * 0.5, yy - r * 0.2, r * 0.7 - k * 0.1 * r, yy - r * 0.5); g.moveTo(0, yy); g.quadraticCurveTo(-r * 0.5, yy - r * 0.2, -r * 0.7 + k * 0.1 * r, yy - r * 0.5); } break;
        case 9: for (let k = 0; k < 3; k++) { g.moveTo(-r * 0.8, (k - 1) * r * 0.4); g.bezierCurveTo(-r * 0.2, (k - 1) * r * 0.4 - r * 0.4, r * 0.2, (k - 1) * r * 0.4 + r * 0.4, r * 0.8, (k - 1) * r * 0.4); } break;
        case 10: g.arc(0, 0, r * 0.8, 0.3, Math.PI * 2 - 0.3); g.moveTo(r * 0.2, -r * 0.2); g.arc(r * 0.05, -r * 0.2, r * 0.15, 0, TAU); break;
        default: g.moveTo(-r, 0); g.quadraticCurveTo(0, -r * 0.8, r, 0); g.quadraticCurveTo(0, r * 0.8, -r, 0); g.moveTo(r * 0.25, 0); g.arc(0, 0, r * 0.25, 0, TAU);
      }
      g.stroke();
      if (!known) { g.font = "600 9px " + FONT_UI; g.textAlign = "center"; g.fillText("?", 0, r + 12); g.textAlign = "left"; }
      g.restore();
    }

    function drawJournal() {
      g.fillStyle = "rgba(14,15,30,0.55)"; g.fillRect(0, 0, VW, VH);
      const w = Math.min(330, VW - 28), h = Math.min(VH - SAFE_TOP - 40, 560), x = VW / 2 - w / 2, y = Math.max(SAFE_TOP + 16, VH / 2 - h / 2);
      g.fillStyle = "rgba(24,28,47,0.97)"; roundRect(x, y, w, h, 14); g.fill();
      g.fillStyle = rgba(hexRgb("#e9c98f")); g.font = "600 9.5px " + FONT_UI;
      spaced("THE CREATURE’S MEMORY", x + 22, y + 32, 2.2, "left");
      g.fillStyle = rgba(CREAM, 0.65); g.font = "italic 300 15px " + FONT_SERIF;
      g.fillText("Collect seeds to reveal fragments of a larger secret.", x + 22, y + 54, w - 44);
      // evolving constellation linking every discovered fragment
      const cx = x + w / 2, cy = y + 112, cr = Math.min(w * 0.36, 70);
      const node = i => { const a = i / FRAGMENTS.length * TAU - Math.PI / 2; const rr = cr * (0.62 + hash1(i * 5.1) * 0.38); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.62]; };
      const known = save.fragments.slice().sort((a, b) => a - b);
      g.strokeStyle = "rgba(233,201,143,0.35)"; g.lineWidth = 0.8;
      g.beginPath(); known.forEach((f, k) => { const q = node(f); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (known.length > 2) g.closePath(); g.stroke();
      for (let i = 0; i < FRAGMENTS.length; i++) {
        const q = node(i); const has = hasFragment(i);
        g.fillStyle = has ? "#f3dca8" : "rgba(233,201,143,0.18)";
        g.beginPath(); g.arc(q[0], q[1], has ? 2.2 : 1.4, 0, TAU); g.fill();
      }
      // fragments grid
      const cols = 3, gx = x + 18, gy = y + 172, cw = (w - 36) / cols;
      const rows = Math.ceil(FRAGMENTS.length / cols);
      const ch = Math.min(64, (h - 172 - 92) / rows);
      for (let i = 0; i < FRAGMENTS.length; i++) {
        const col = i % cols, rowI = Math.floor(i / cols);
        const fx = gx + col * cw + cw / 2, fy = gy + rowI * ch + 16;
        const has = hasFragment(i);
        drawGlyph(i, fx, fy, 11, has);
        if (has) {
          g.fillStyle = rgba(CREAM, 0.9); g.font = "italic 300 13px " + FONT_SERIF; g.textAlign = "center";
          g.fillText(FRAGMENTS[i].name, fx, fy + 28, cw - 6); g.textAlign = "left";
        }
      }
      const by = y + h - 70;
      g.fillStyle = rgba(CREAM, 0.7); g.font = "600 8.5px " + FONT_UI;
      spaced(save.totalSeeds + " DREAM SEEDS GATHERED · " + save.fragments.length + "/" + FRAGMENTS.length + " FRAGMENTS", x + w / 2, by, 1.3, "center");
      pill(x + 40, by + 16, w - 80, 34, "CLOSE", false, () => closeJournal());
    }

    const drawList = [];
    function render(dt) {
      uiHits = [];
      const camM = Math.max(0, cam.y) * CFG.METERS_PER_UNIT;
      const pal = palAt(camM);
      drawSky(pal, camM);
      drawClouds(pal, 0.08, 0.55, 0);
      drawFarLayer(pal, camM);
      drawClouds(pal, 0.25, 0.5, 31);
      drawMidLayer(pal, camM);
      drawBodyLayer(pal);
      drawEyes(pal);
      const topAlt = cam.y + (ANCHOR + 40) / S, botAlt = cam.y - (VH - ANCHOR + 160) / S;
      // highest first, so lower walking surfaces read in front
      drawList.length = 0;
      for (const p of world.platforms) {
        if (p.kind === "cap" || p.yMin - p.depth - 20 > topAlt || p.yMax + 60 < botAlt) continue;
        drawList.push(p);
      }
      drawList.sort((a, b) => b.yMax - a.yMax);
      for (const p of drawList) drawPlatform(p);
      drawVines(pal);
      for (const p of world.platforms) {
        if (p.kind !== "cap" || p.yMax < botAlt - 40 || p.stem.baseY > topAlt) continue;
        drawPlatform(p);
      }
      for (const s of world.seeds) drawSeed(s);
      if (game.state === "waking" || game.state === "results") drawWakeEye(pal);
      drawPlayer();
      drawParticles(pal);
      drawAtmosphere(pal);
      hud.height += (heightMeters() - hud.height) * Math.min(1, dt * 6);
      drawTitle();
      drawHUD(dt);
      if (game.state === "results") drawResults(dt);
      if (game.paused && !game.journal) drawPause();
      if (game.journal) drawJournal();
    }

    // =====================================================================
    // 14. INPUT — hold left/right, swipe up, keyboard
    // =====================================================================
    function uiAt(x, y) {
      for (let i = uiHits.length - 1; i >= 0; i--) {
        const h = uiHits[i];
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
      }
      return null;
    }
    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (VW / (r.width || VW)), y: (e.clientY - r.top) * (VH / (r.height || VH)) };
    }
    ctx.listen(canvas, "pointerdown", e => {
      audioInit(); audioResume();
      const pt = localPoint(e);
      const h = uiAt(pt.x, pt.y);
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (h) { sfx.ui(); h.fn(); input.pointers.set(e.pointerId, { ui: true, x: pt.x, y: pt.y, t0: performance.now() }); return; }
      if (game.paused || game.journal || game.state === "results" || game.state === "waking") { input.pointers.set(e.pointerId, { ui: true, x: pt.x, y: pt.y, t0: performance.now() }); return; }
      const now = performance.now();
      input.pointers.set(e.pointerId, { x: pt.x, y: pt.y, startX: pt.x, refY: pt.y, refT: now, t0: now, cool: 0, ui: false });
      if (!game.runStarted && game.state === "play") startRun();
      if (e.cancelable) e.preventDefault();
    });
    ctx.listen(canvas, "pointermove", e => {
      const p = input.pointers.get(e.pointerId);
      if (!p || p.ui) return;
      const pt = localPoint(e);
      const now = performance.now();
      p.x = pt.x; p.y = pt.y;
      // swipe up = jump: a quick upward flick from the finger's lowest recent point
      if (now < p.cool) { p.refY = pt.y; p.refT = now; return; }
      if (pt.y >= p.refY || now - p.refT > 260) { p.refY = pt.y; p.refT = now; }
      else if (p.refY - pt.y > 24) { input.jumpQueued = true; p.refY = pt.y; p.refT = now; p.cool = now + 220; }
    });
    const endPointer = e => { input.pointers.delete(e.pointerId); };
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "lostpointercapture", endPointer);
    const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ShiftLeft: "run", ShiftRight: "run" };
    ctx.listen(window, "keydown", e => {
      audioInit(); audioResume();
      if (KEYMAP[e.code]) {
        const k = KEYMAP[e.code];
        if (!input.keys[k] && input.keyT[k] !== undefined) input.keyT[k] = performance.now();
        input.keys[k] = true; e.preventDefault && e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault && e.preventDefault();
        if (game.state === "results" && e.code === "Space") { restart(); return; }
        if (!game.paused && game.state === "play") input.jumpQueued = true;
      }
      if (e.code === "KeyR" && game.state === "results") restart();
      if (e.code === "Escape" || e.code === "KeyP") { if (game.journal) closeJournal(); else if (game.state === "play") setPaused(!game.paused); }
      if (e.code === "KeyM") setMuted(!save.muted);
    });
    ctx.listen(window, "keyup", e => { if (KEYMAP[e.code]) input.keys[KEYMAP[e.code]] = false; });
    ctx.listen(window, "blur", () => { input.keys.left = input.keys.right = input.keys.run = false; input.pointers.clear(); });

    // =====================================================================
    // 15. GAME STATE — start, pause, game over, restart
    // =====================================================================
    const game = { state: "play", paused: false, journal: null, runStarted: false, wakeT: 0, finalHeight: 0, newBest: false, firstSession: true, attempt: 0 };
    let time = 0;
    let R0 = makeRng(Date.now() & 0xffffffff);

    function startRun() {
      if (game.runStarted) return;
      game.runStarted = true;
      game.attempt++;
      save.runs++;
      try { ctx.platform.start({ attempt: game.attempt }); } catch (e) { /* lifecycle only */ }
    }
    function setPaused(v) {
      if (game.state !== "play" && v) return;
      game.paused = v;
      if (!v) { input.pointers.clear(); input.jumpQueued = false; }
    }
    function openJournal(from) { game.journal = from; if (from !== "pause" && game.state === "play") game.paused = true; }
    function closeJournal() {
      const from = game.journal; game.journal = null;
      if (from === "title") game.paused = false;
      input.pointers.clear();
    }

    function wake() {
      if (game.state !== "play") return;
      game.state = "waking";
      game.wakeT = 0;
      creature.state = 3;
      creature.alert = 100;
      game.finalHeight = heightMeters();
      run.bestStreak = Math.max(run.bestStreak, streakMeters());
      game.newBest = game.finalHeight > save.best + 0.5;
      if (game.newBest) save.best = Math.floor(game.finalHeight);
      persist();
      P.ground = null; P.vine = null; P.anticOn = false;
      P.vy = 260; P.vx = (P.facing || 1) * -70;
      cam.shake = 7;
      sfx.wake();
      haptic("heavy");
      const h = Math.floor(game.finalHeight);
      if (score) {
        try { score.set(h); } catch (e) { /* host score only */ }
        try {
          const pr = score.submit("height", { label: fmt(h) + " m" });
          if (pr && pr.catch) pr.catch(() => { /* leaderboard is optional */ });
        } catch (e) { /* leaderboard is optional */ }
      }
      try { ctx.platform.fail({ height: h, seeds: run.seeds, discoveries: run.discoveries.length }); } catch (e) { /* lifecycle only */ }
    }

    function restart() {
      CFG = readConfig();
      palCache.clear();
      R0 = makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
      newWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0);
      resetPlayer();
      Object.assign(creature, { alert: 0, shown: 0, state: 0, sinceNoise: 99, shift: null, shiftCd: R0.range(18, 26), shiftOffset: 0, tremble: 0 });
      Object.assign(run, { seeds: 0, seedLight: 0, discoveries: [], streakStartY: 0, streakTier: 0, bestStreak: 0, lastMilestone: 0 });
      particles.length = 0; birds.length = 0;
      game.state = "play"; game.paused = false; game.journal = null; game.runStarted = false; game.wakeT = 0;
      hud.cardA = 0; hud.toast = null; hud.height = 0;
      cam.y = minCamY(); cam.hold = false; cam.shake = 0;
      input.pointers.clear(); input.jumpQueued = false;
      if (score) { try { score.reset(); } catch (e) { /* host score only */ } }
    }

    function updateFrame(dt) {
      if (game.paused || game.journal) { updateAmbientAudio(); return; }
      time += dt;
      if (game.runStarted) hud.titleA = Math.max(0, hud.titleA - dt * 1.6);
      if (game.state === "play") {
        updateCreature(dt);
        updateSeeds(dt);
        updateScore();
        if (creature.state >= 2 && Math.random() < dt * 3) spawnDust(true);
      } else if (game.state === "waking" || game.state === "results") {
        game.wakeT += dt;
        creature.breathPhase += dt * 3;
        creature.breathVal = Math.sin(creature.breathPhase);
        creature.shiftOffset = Math.sin(game.wakeT * 13) * 10 * Math.max(0, 1 - game.wakeT / 2.2);
        if (game.state === "waking") {
          P.vy -= CFG.GRAVITY * 0.6 * dt; P.x += P.vx * dt; P.y += P.vy * dt; P.rot += dt * 5 * (P.facing || 1);
          if (game.wakeT > 0.5) cam.hold = true;
          if (Math.random() < dt * 25) spawnDust(true);
          if (game.wakeT > 2.4) game.state = "results";
        }
      }
      for (const p of world.platforms) if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 5);
      updateParticles(dt);
      updateBirds(dt);
      updateCamera(dt);
      if (game.state === "play") recycleWorld();
      updateAmbientAudio();
    }

    // =====================================================================
    // 16. BOOT — fonts, first frame, loop
    // =====================================================================
    newWorld((Date.now() ^ 0x5eed) >>> 0);
    resetPlayer();
    cam.y = minCamY();
    creature.shiftCd = 24;

    ctx.onResize(info => { layout(info); }, { immediate: true });

    // Fonts are a polish layer: the game renders immediately with fallbacks.
    const fontLoads = [
      ["Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }],
      ["Inter", "inter", "1.0.0", { weight: "600" }],
      ["Cormorant Garamond", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }]
    ];
    for (const f of fontLoads) {
      try {
        const pr = ctx.loadFont && ctx.loadFont(f[0], f[1], f[2], f[3]);
        if (pr && pr.then) pr.then(() => charW.clear(), () => { /* fallback font stack */ });
      } catch (e) { /* fallback font stack */ }
    }

    let lastRender = 0;
    render(0);
    try { ctx.markVisualReady && ctx.markVisualReady("first-frame"); } catch (e) { /* optional */ }

    const loop = ctx.game.loop({
      fixedHz: 120,
      maxDeltaMs: 100,
      maxSubsteps: 10,
      fixedUpdate(stepMs) { if (!game.paused && !game.journal) physics(stepMs / 1000); },
      update(dtMs) { updateFrame(Math.min(dtMs, 100) / 1000); },
      render() {
        const now = performance.now();
        const dt = lastRender ? Math.min(0.1, (now - lastRender) / 1000) : 0.016;
        lastRender = now;
        render(dt);
      }
    });

    ctx.onDestroy(() => {
      try { loop && loop.destroy && loop.destroy(); } catch (e) { /* already stopped */ }
      try { if (audio.ac) audio.ac.close(); } catch (e) { /* already closed */ }
      audio.ac = null;
    });

    if (ctx.__testHooks) {
      Object.assign(ctx.__testHooks, {
        P, creature, world, game, run, save, cam, noiseLog, CFG: () => CFG,
        addNoise, wake, restart, collectSeed, setPaused, openJournal, heightMeters,
        teleport(y) {
          while (world.gen.last.endY < y + 1200) genNext();
          let best = null;
          for (const p of world.platforms) if (p.kind === "path" && p.yMin > y && (!best || p.yMin < best.yMin)) best = p;
          if (best) { P.x = (best.x0 + best.x1) / 2; P.y = surfaceAt(best, P.x); P.ground = best; P.maxY = P.y; cam.y = P.y; run.streakStartY = P.y; }
          recycleWorld();
        }
      });
    }

    ctx.platform.ready();
  }
};
