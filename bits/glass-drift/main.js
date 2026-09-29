window.plethoraBit = {
  meta: {
    title: "Glass Drift",
    runtime: "plethora-bit@2",
    tags: ["arcade", "3d", "relaxing"],
    permissions: ["audio", "backgroundMusic", "haptics"]
  },

  async init(ctx) {
    // ---------------------------------------------------------------- constants
    const HALF_W = 4;            // playable half width
    const CEIL = 5;              // playable height
    const CAM_Y = 1.7;
    const START_BALLS = 25;
    const CRASH_COST = 10;
    const BALL_R = 0.22;
    const BALL_SPEED = 40;
    const BALL_GRAVITY = 4;
    const MAX_BALLS_LIVE = 16;
    const SHARD_COUNT = 260;
    const LEVEL_LEN = 150;       // world units per level; a door stands at every boundary
    const CH = 10;               // scenery chunk length
    const VIEW_DIST = 88;
    const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];

    // Glass tiers: 0 thin (1 hit) · 1 medium (2) · 2 thick (3) · 3 armored (4)
    const TIER_HP = [1, 2, 3, 4];
    const TIER_DEPTH = [0.1, 0.2, 0.32, 0.46];
    const TIER_OPACITY = [0.5, 0.58, 0.68, 0.82];
    const TIER_DARK = [1, 0.92, 0.78, 0.55];
    const TIER_POINTS = [10, 20, 35, 60];
    const TIER_EDGE = [0xffffff, 0x9ae8ff, 0xffd58a, 0xff8f8f];

    // Crystal kinds: simple shard → gem → star → grand crystal (more complex = more balls)
    const CRYSTAL_BALLS = [2, 4, 6, 10];
    const CRYSTAL_R = [0.5, 0.62, 0.78, 1.0];
    const CRYSTAL_WEIGHTS = [[78, 20, 2, 0], [66, 28, 5, 1], [56, 32, 9, 3], [48, 34, 13, 5], [42, 36, 16, 6], [36, 38, 20, 6]];
    const CRYSTAL_CHANCE = [0.7, 0.62, 0.55, 0.5, 0.46, 0.42];

    // Glass outlines in a [-1,1] box (no circles: only cut, angular glass)
    const SHAPES = {
      rect: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
      hex: [[-1, 0], [-0.5, 1], [0.5, 1], [1, 0], [0.5, -1], [-0.5, -1]],
      diamond: [[0, 1], [1, 0], [0, -1], [-1, 0]],
      triangle: [[-1, -1], [1, -1], [0, 1]],
      house: [[-1, -1], [1, -1], [1, 0.3], [0, 1], [-1, 0.3]],
      kite: [[0, 1], [0.85, 0.2], [0, -1], [-0.85, 0.2]]
    };

    // Each level: own sky, palette, architecture style, glass shapes/textures, thickness mix and obstacle mix.
    const LEVELS = [
      {
        name: "Coral Terraces", scale: "pentatonic", style: "terraces", floorW: 30,
        skyTop: 0xf3cdb0, horizon: 0xf9e9c4, blk: [0xd9735f, 0xe98a72, 0xb85646], floor: 0xd4715c,
        tints: [0xbfe9ff, 0xffe0c2, 0xffc7d6], crystal: 0x5fd0ff, glow: 0xfff2b0,
        shapes: ["rect", "house"], tex: ["clear", "ribbed"], hp: [55, 40, 5, 0],
        patterns: ["wall", "pendulum", "grid", "pendulum", "doors", "slider"]
      },
      {
        name: "Azure Heights", scale: "lydian", style: "arches", floorW: 30,
        skyTop: 0x0a4a86, horizon: 0xa9d6ff, blk: [0x2f4d68, 0x44718f, 0x1f3348], floor: 0x35536f,
        tints: [0x8fd0ff, 0xb6e0ff, 0xd0c4ff], crystal: 0x66e0ff, glow: 0xb4d0ff,
        shapes: ["rect", "hex", "kite"], tex: ["frosted", "clear"], hp: [30, 48, 20, 2],
        patterns: ["pendulum", "doors", "pillars", "hoops", "rotor", "pendulum", "lift"]
      },
      {
        name: "Violet Caverns", scale: "dorian", style: "cavern", floorW: 30,
        skyTop: 0x9384e0, horizon: 0xd2c8ff, blk: [0xa08ee0, 0xc0b2f6, 0x7f6cc4], floor: 0xb2a2ee,
        tints: [0x7fd6ff, 0xb8a8ff, 0xffb8f0], crystal: 0x2aa8ff, glow: 0xffffff,
        shapes: ["diamond", "triangle", "hex", "kite"], tex: ["lattice", "frosted"], hp: [15, 40, 38, 7],
        patterns: ["pendulum", "rotor", "layers", "grid", "pendulum", "slider", "lift"]
      },
      {
        name: "Verdant Halls", scale: "major", style: "halls", floorW: 30,
        skyTop: 0xa4e4bc, horizon: 0xe8ffd8, blk: [0x4f9a7a, 0x72bd98, 0x357a5f], floor: 0x5aa585,
        tints: [0xc8ffd8, 0xffe9a8, 0xa8e8ff], crystal: 0xffd84a, glow: 0xffffc0,
        shapes: ["hex", "house", "rect", "diamond"], tex: ["mosaic", "ribbed"], hp: [8, 38, 42, 12],
        patterns: ["pendulum", "doors", "lift", "rings", "pendulum", "rotor", "slider"]
      },
      {
        name: "Golden Colonnade", scale: "wholeTone", style: "columns", floorW: 30,
        skyTop: 0xf0b264, horizon: 0xffe7b4, blk: [0xc99a55, 0xe2ba78, 0xa27a3e], floor: 0xd0a563,
        tints: [0xfff0c0, 0xffd0a0, 0xc8e8ff], crystal: 0x6affd8, glow: 0xfff0a0,
        shapes: ["rect", "diamond", "house", "triangle", "kite"], tex: ["clear", "frosted", "lattice", "mosaic"], hp: [3, 30, 47, 20],
        patterns: ["pendulum", "rotor", "doors", "layers", "lift", "pillars", "pendulum", "slider"]
      },
      {
        name: "Midnight Void", scale: "hirajoshi", style: "floating", floorW: 8,
        skyTop: 0x0b0b28, horizon: 0x3c306e, blk: [0x3a3470, 0x5c52a2, 0x231f4a], floor: 0x2c2860,
        tints: [0xff9ad0, 0x9ad8ff, 0xffe08a], crystal: 0xff70e0, glow: 0x9a8aff,
        shapes: ["rect", "hex", "diamond", "triangle", "house", "kite"], tex: ["lattice", "mosaic", "frosted", "ribbed"], hp: [0, 22, 45, 33],
        patterns: ["pendulum", "rotor", "layers", "doors", "lift", "pendulum", "slider", "grid"]
      }
    ];
    const levelOf = (i) => LEVELS[i % LEVELS.length];
    const levelAt = (z) => Math.max(0, Math.floor((-z + 0.001) / LEVEL_LEN));
    const doorZ = (k) => -LEVEL_LEN * k;

    // ---------------------------------------------------------------- surfaces + HUD (drawn first, never blank)
    const bgRoot = ctx.createRoot({
      layer: "background",
      input: "passthrough",
      style: "background:linear-gradient(#f3cdb0,#f9e9c4)"
    });
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    const root = ctx.createRoot({
      layer: "overlay",
      input: "passthrough",
      style: "font-family:'Nunito Sans',system-ui,sans-serif;color:#fff;user-select:none;-webkit-user-select:none"
    });
    root.innerHTML =
      '<style>' +
      '.gd-top{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;justify-content:space-between;align-items:flex-start;padding:0 14px;pointer-events:none}' +
      '.gd-balls{font-size:20px;font-weight:700;letter-spacing:.5px;text-shadow:0 1px 6px rgba(20,20,60,.75)}' +
      '.gd-balls span{display:inline-block;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#a9c4ff 60%,#6f86d6);margin-right:7px;vertical-align:-1px;box-shadow:0 0 8px #9ab8ff}' +
      '.gd-balls.low{color:#ffb0c0}' +
      '.gd-mid{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 8px);text-align:center;pointer-events:none}' +
      '.gd-score{font-size:34px;font-weight:700;text-shadow:0 1px 8px rgba(20,20,60,.8)}' +
      '.gd-level{font-size:11px;font-weight:700;letter-spacing:2px;color:#fff;opacity:.9;min-height:14px;text-shadow:0 1px 5px rgba(20,20,60,.8)}' +
      '.gd-streak{font-size:13px;font-weight:700;letter-spacing:2px;color:#fff1b0;min-height:16px;text-shadow:0 1px 6px rgba(60,30,0,.85)}' +
      '.gd-btn{pointer-events:auto;border:1px solid rgba(255,255,255,.6);background:rgba(30,22,64,.5);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;line-height:32px;text-align:center;padding:0}' +
      '.gd-panel{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:min(86vw,340px);text-align:center;pointer-events:none}' +
      '.gd-title{font-size:38px;font-weight:700;letter-spacing:3px;text-shadow:0 2px 14px rgba(40,20,80,.85),0 0 3px #fff}' +
      '.gd-sub{font-size:15px;letter-spacing:3px;color:#fff;margin-top:14px;text-shadow:0 1px 6px rgba(20,20,60,.8);animation:gdp 1.8s ease-in-out infinite}' +
      '.gd-hint{font-size:12px;color:#fff;margin-top:12px;line-height:1.7;text-shadow:0 1px 5px rgba(20,20,60,.85)}' +
      '.gd-over{background:rgba(22,16,50,.78);border:1px solid rgba(200,180,255,.4);border-radius:18px;padding:16px 14px 14px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
      '.gd-over .gd-title{font-size:22px;letter-spacing:2px}' +
      '.gd-final{font-size:44px;font-weight:700;margin:2px 0;text-shadow:0 0 16px rgba(255,200,240,.7)}' +
      '.gd-reached{font-size:12px;letter-spacing:2px;color:#bfe3ff}' +
      '.gd-best{font-size:13px;font-weight:700;color:#ffe9a8;letter-spacing:2px;min-height:18px}' +
      '.gd-board{margin:8px 4px 4px;font-size:13px;text-align:left;min-height:96px}' +
      '.gd-row{display:flex;gap:8px;padding:3px 6px;border-radius:8px}' +
      '.gd-row.me{background:rgba(255,233,168,.16)}' +
      '.gd-row .r{width:28px;color:#bfe3ff}' +
      '.gd-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.gd-row .v{font-weight:700}' +
      '.gd-status{font-size:11px;color:#a9a0cf;margin:4px 0 8px;min-height:14px}' +
      '.gd-play{pointer-events:auto;border:0;border-radius:24px;padding:12px 34px;font-size:16px;font-weight:700;letter-spacing:2px;color:#241c45;background:linear-gradient(135deg,#bfe3ff,#e0c8ff);box-shadow:0 0 18px rgba(190,170,255,.6)}' +
      '.gd-play:disabled{opacity:.45}' +
      '.gd-banner{position:absolute;left:0;right:0;top:24%;text-align:center;opacity:0;pointer-events:none}' +
      '.gd-banner.show{animation:gdb 2.6s ease-out}' +
      '.gd-banner .b1{font-size:34px;font-weight:700;letter-spacing:5px;text-shadow:0 2px 14px rgba(20,20,60,.8),0 0 3px #fff}' +
      '.gd-banner .b2{font-size:14px;font-weight:700;letter-spacing:4px;margin-top:6px;color:#fff1b0;text-shadow:0 1px 6px rgba(60,30,0,.85)}' +
      '@keyframes gdb{0%{opacity:0;transform:scale(.9)}14%{opacity:1;transform:scale(1)}72%{opacity:1}100%{opacity:0}}' +
      '@keyframes gdp{0%,100%{opacity:.5}50%{opacity:1}}' +
      '</style>' +
      '<div class="gd-top">' +
      '<div class="gd-balls" id="gdBalls"><span></span>25</div>' +
      '<button class="gd-btn" id="gdMute" aria-label="Toggle sound">♪</button>' +
      '</div>' +
      '<div class="gd-mid"><div class="gd-score" id="gdScore">0</div><div class="gd-level" id="gdLevel"></div><div class="gd-streak" id="gdStreak"></div></div>' +
      '<div class="gd-banner" id="gdBanner"><div class="b1"></div><div class="b2"></div></div>' +
      '<div class="gd-panel" id="gdMenu">' +
      '<div class="gd-title">GLASS DRIFT</div>' +
      '<div class="gd-sub">TAP TO START</div>' +
      '<div class="gd-hint">Tap to throw balls · lead moving glass<br>Thick glass takes more hits<br>Rarer crystals give more balls · crashing costs 10</div>' +
      '</div>' +
      '<div class="gd-panel gd-over" id="gdOver" style="display:none">' +
      '<div class="gd-title">SHATTERED</div>' +
      '<div class="gd-final" id="gdFinal">0</div>' +
      '<div class="gd-reached" id="gdReached"></div>' +
      '<div class="gd-best" id="gdBest"></div>' +
      '<div class="gd-board" id="gdBoard"></div>' +
      '<div class="gd-status" id="gdStatus"></div>' +
      '<button class="gd-play" id="gdPlay">PLAY AGAIN</button>' +
      '</div>';

    const ballsEl = root.querySelector("#gdBalls");
    const scoreEl = root.querySelector("#gdScore");
    const levelEl = root.querySelector("#gdLevel");
    const streakEl = root.querySelector("#gdStreak");
    const muteBtn = root.querySelector("#gdMute");
    const menuEl = root.querySelector("#gdMenu");
    const overEl = root.querySelector("#gdOver");
    const finalEl = root.querySelector("#gdFinal");
    const reachedEl = root.querySelector("#gdReached");
    const bestEl = root.querySelector("#gdBest");
    const boardEl = root.querySelector("#gdBoard");
    const statusEl = root.querySelector("#gdStatus");
    const playBtn = root.querySelector("#gdPlay");
    const bannerEl = root.querySelector("#gdBanner");

    ctx.markVisualReady("hud-shown");
    ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "700", style: "normal" }).catch(() => {});

    // ---------------------------------------------------------------- game state
    const score = ctx.game.score({ initial: 0, min: 0 });
    let disposed = false;
    let run = 0;                 // attempt counter, fences detached leaderboard callbacks
    let state = "menu";          // menu | play | over
    let balls = START_BALLS;
    let streak = 0;
    let camZ = 0;
    let speed = 0;
    let time = 0;
    let distAccum = 0;
    let nextBlockZ = -24;
    let blockCount = 0;
    let nextChunkZ = 30;
    let chunkIdx = 0;
    let doorsSpawned = 0;
    let nextDoorK = 1;           // next door the player will cross
    let activeLevel = 0;
    let lastThrow = 0;
    let shake = 0;
    let smashed = 0;
    let shownScore = -1;
    let shownBalls = -1;
    let sfxOn = true;
    let musicStarted = false;

    // ---------------------------------------------------------------- audio (soft synthesized SFX; music via ctx.music)
    let ac = null, master = null, noiseBuf = null, lastShatterAt = 0, lastCrackAt = 0;

    function initAudio() {
      if (ac) { try { ac.resume(); } catch (e) {} return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !ctx.capabilities.audio) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.75;
        master.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 1.2);
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        ac.resume();
      } catch (e) { ac = null; }
    }
    function audioOk() { return ac && sfxOn && ac.state !== "closed"; }

    function tone(freq, when, dur, gain, type) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, when);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(master);
      o.start(when); o.stop(when + dur + 0.05);
    }

    function noiseBurst(t, dur, gain, hpFreq, rate) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = rate;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = hpFreq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.6); src.stop(t + dur + 0.05);
    }

    // tier 0..3: thicker glass = deeper, longer, heavier shatter
    function sfxShatter(tier) {
      if (!audioOk()) return;
      const nowMs = performance.now();
      if (nowMs - lastShatterAt < 35) return;
      lastShatterAt = nowMs;
      try {
        const t = ac.currentTime;
        const s = 0.6 + tier * 0.28;
        noiseBurst(t, 0.36 + tier * 0.1, 0.4 * s, 2600 - tier * 500, 0.9 + Math.random() * 0.4);
        const tinkles = 6 + tier * 3;
        const lo = 2400 - tier * 350;
        for (let i = 0; i < tinkles; i++) {
          tone(lo + Math.random() * 4400, t + Math.random() * 0.3, 0.07 + Math.random() * 0.14, 0.035 * s, "sine");
        }
        tone(190 - tier * 25 + Math.random() * 50, t, 0.14 + tier * 0.04, 0.13 * s, "triangle");
      } catch (e) {}
    }

    function sfxCrack(tier) {
      if (!audioOk()) return;
      const nowMs = performance.now();
      if (nowMs - lastCrackAt < 40) return;
      lastCrackAt = nowMs;
      try {
        const t = ac.currentTime;
        noiseBurst(t, 0.07, 0.16, 4200, 1.2);
        tone(1500 + tier * 240, t, 0.16, 0.08, "triangle");
        tone(2300 + tier * 300, t + 0.02, 0.1, 0.045, "sine");
      } catch (e) {}
    }

    function sfxPoint(level) {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime + 0.02;
        const f = NOTES[Math.min(level, NOTES.length - 1)];
        tone(f, t, 0.55, 0.11, "sine");
        tone(f * 2, t, 0.35, 0.035, "sine");
      } catch (e) {}
    }

    // richer crystals ring longer and higher
    function sfxCrystal(kind) {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime + 0.01;
        const seq = [[0, 2], [0, 2, 4, 6], [0, 2, 4, 6, 7], [0, 2, 4, 5, 6, 7, 8]][kind];
        seq.forEach((n, i) => tone(NOTES[n] * 1.5, t + i * 0.07, 0.6 + kind * 0.2, 0.08, "sine"));
        if (kind >= 1) tone(NOTES[8] * 1.5, t + 0.3, 0.7, 0.05, "triangle");
        if (kind >= 2) tone(NOTES[0] * 0.75, t, 1.0, 0.07, "triangle");
      } catch (e) {}
    }

    function sfxLevel() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime + 0.05;
        [0, 2, 4, 5, 7].forEach((n, i) => tone(NOTES[n], t + i * 0.12, 0.9, 0.09, "sine"));
        tone(NOTES[8], t + 0.6, 1.2, 0.05, "triangle");
      } catch (e) {}
    }

    function sfxDoor() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime;
        tone(62, t, 1.4, 0.2, "sine");
        tone(94, t + 0.1, 1.0, 0.08, "triangle");
        noiseBurst(t, 0.9, 0.05, 300, 0.5);
      } catch (e) {}
    }

    function sfxThrow() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime;
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ac.createBiquadFilter();
        bp.type = "bandpass"; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(1300, t);
        bp.frequency.exponentialRampToValueAtTime(380, t + 0.13);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        src.connect(bp); bp.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.5); src.stop(t + 0.2);
      } catch (e) {}
    }

    function sfxThud() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.4);
      } catch (e) {}
    }

    function sfxOver() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime + 0.1;
        [NOTES[4], NOTES[2], NOTES[0]].forEach((f, i) => tone(f * 0.5, t + i * 0.22, 0.9, 0.09, "triangle"));
      } catch (e) {}
    }

    async function startMusic() {
      if (musicStarted || !ctx.capabilities.backgroundMusic) return;
      musicStarted = true;
      try {
        await ctx.music.unlock();
        ctx.music.play({
          preset: "ambient",
          volume: 0.38,
          tempo: 64,
          intensity: 0.2,
          scale: levelOf(activeLevel).scale,
          drumGain: 0,
          fadeInMs: 2500
        });
        if (!sfxOn) ctx.music.pause();
      } catch (e) { musicStarted = false; }
    }

    function setMusicIntensity(v) {
      if (!musicStarted) return;
      try { ctx.music.setIntensity(v, { fadeMs: 1500 }); } catch (e) {}
    }
    function setMusicScale(name) {
      if (!musicStarted) return;
      try { ctx.music.setScale(name, { fadeMs: 1500 }); } catch (e) {}
    }

    function haptic(kind) {
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (e) {} }
    }

    ctx.input.activate(muteBtn, () => {
      sfxOn = !sfxOn;
      muteBtn.textContent = sfxOn ? "♪" : "×";
      try { if (sfxOn) ctx.music.resume(); else ctx.music.pause(); } catch (e) {}
    });

    // ---------------------------------------------------------------- three.js scene
    const THREE = await ctx.importModule("three", "0.164.1");
    if (disposed) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || 1, 2));
    renderer.setSize(ctx.width, ctx.height);

    const scene = new THREE.Scene();
    const L0 = LEVELS[0];
    const curSky = new THREE.Color(L0.skyTop);
    const curHor = new THREE.Color(L0.horizon);
    const curFloor = new THREE.Color(L0.floor);
    const curCrystal = new THREE.Color(L0.crystal);
    const curGlow = new THREE.Color(L0.glow);
    const curTints = L0.tints.map(c => new THREE.Color(c));
    const tgtSky = new THREE.Color(), tgtHor = new THREE.Color(), tgtFloor = new THREE.Color(), tgtCrystal = new THREE.Color(), tgtGlow = new THREE.Color();
    const tgtTints = curTints.map(c => c.clone());
    const tmpC = new THREE.Color();
    scene.background = curHor;
    scene.fog = new THREE.Fog(curHor.getHex(), 16, VIEW_DIST - 6);

    const camera = new THREE.PerspectiveCamera(70, ctx.width / ctx.height, 0.1, 160);
    function fitCamera() {
      const aspect = ctx.width / Math.max(1, ctx.height);
      camera.fov = aspect < 0.8 ? 80 : aspect < 1.2 ? 68 : 58;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    fitCamera();
    camera.position.set(0, CAM_Y, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x886655, 0.95);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(-4, 9, 5);
    scene.add(sun);

    // sky dome with a vertical gradient that follows the camera
    const SKY_R = 135;
    const skyGeo = new THREE.SphereGeometry(SKY_R, 20, 14);
    skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    function paintSky() {
      const pos = skyGeo.attributes.position, col = skyGeo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / SKY_R;
        const t = y > 0 ? Math.min(1, Math.pow(y, 0.55) * 1.15) : 0;
        tmpC.copy(curHor).lerp(curSky, t);
        col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
      }
      col.needsUpdate = true;
    }

    // ---- procedural glass textures (DataTexture: no canvas needed). Tile = 1 world unit.
    function dataTex(N, fn) {
      const data = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = fn(x, y, N);
        const i = (y * N + x) * 4;
        data[i] = px[0]; data[i + 1] = px[1]; data[i + 2] = px[2]; data[i + 3] = px[3];
      }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    }
    const texBuilders = {
      frosted: () => dataTex(64, () => {
        const n = Math.random();
        return [225 + n * 30, 235 + n * 20, 255, 150 + n * 105];
      }),
      ribbed: () => dataTex(64, (x) => {
        const w = Math.sin((x / 64) * Math.PI * 8);
        const v = 200 + w * 55;
        return [v, v, 255, 130 + (w * 0.5 + 0.5) * 125];
      }),
      lattice: () => dataTex(64, (x, y) => {
        const bar = (x % 32) < 3 || (y % 32) < 3;
        return bar ? [70, 70, 90, 255] : [255, 255, 255, 115];
      }),
      mosaic: () => {
        const cells = [];
        for (let i = 0; i < 16; i++) cells.push(150 + Math.random() * 105);
        return dataTex(64, (x, y) => {
          if ((x % 16) < 2 || (y % 16) < 2) return [40, 40, 60, 255];
          const c = cells[Math.floor(x / 16) + Math.floor(y / 16) * 4];
          return [c, 255 - (255 - c) * 0.6, 255, 215];
        });
      }
    };
    const texMaps = {};
    function texMap(name) {
      if (name === "clear") return null;
      if (!texMaps[name]) texMaps[name] = texBuilders[name]();
      return texMaps[name];
    }

    // floor: wide ground (or a narrow bridge) with a world-fixed soft grid
    const FLOOR_LEN = 200, TILE = 2, FLOOR_MAX = 30;
    const gridTex = dataTex(32, (x, y) => {
      const edge = x < 2 || y < 2;
      const v = edge ? 205 : 255;
      return [v, v, v, 255];
    });
    const floorMat = new THREE.MeshLambertMaterial({ color: curFloor, map: gridTex });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_MAX, FLOOR_LEN), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    function setFloorWidth(w) {
      floor.scale.x = w / FLOOR_MAX;
      gridTex.repeat.set(w / TILE, FLOOR_LEN / TILE);
    }
    setFloorWidth(30);

    // ---- instanced scenery pools (solid architecture, drawn with flat matte colours)
    function makePool(geo, mat, cap) {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.frustumCulled = false;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
      const free = [];
      for (let i = cap - 1; i >= 0; i--) free.push(i);
      const dummy = new THREE.Object3D();
      scene.add(mesh);
      const pool = {
        mesh, free,
        set(i, x, y, z, sx, sy, sz, rx, ry, rz) {
          dummy.position.set(x, y, z);
          dummy.rotation.set(rx || 0, ry || 0, rz || 0);
          dummy.scale.set(sx, sy, sz);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.instanceMatrix.needsUpdate = true;
        },
        alloc(x, y, z, sx, sy, sz, rx, ry, rz, color) {
          if (!free.length) return -1;
          const i = free.pop();
          pool.set(i, x, y, z, sx, sy, sz, rx, ry, rz);
          mesh.setColorAt(i, color);
          mesh.instanceColor.needsUpdate = true;
          return i;
        },
        release(i) {
          if (i < 0) return;
          mesh.setMatrixAt(i, zero);
          mesh.instanceMatrix.needsUpdate = true;
          free.push(i);
        }
      };
      return pool;
    }
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCone = new THREE.ConeGeometry(0.5, 1, 5);
    const boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const glowBoxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const boxPool = makePool(unitBox, boxMat, 520);
    const glowPool = makePool(unitBox, glowBoxMat, 200);
    const conePool = makePool(unitCone, coneMat, 140);

    const chunks = [];
    let movers = [];

    function col(lv, k) {
      return tmpC.set(lv.blk[k % 3]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    }
    // block helper: y is the BOTTOM of the block
    function B(ch, x, yb, z, sx, sy, sz, color, rx, ry, rz, pool) {
      const p = pool || boxPool;
      const i = p.alloc(x, yb + sy / 2, z, sx, sy, sz, rx, ry, rz, color);
      if (i >= 0) ch.items.push([p, i]);
      return i;
    }
    function G(ch, x, yb, z, sx, sy, sz, hex) {
      return B(ch, x, yb, z, sx, sy, sz, tmpC.set(hex), 0, 0, 0, glowPool);
    }
    function moverOf(ch, pool, i, kind, x, yb, z, sx, sy, sz, amp, w, ph) {
      if (i < 0) return;
      movers.push({ ch, pool, i, kind, x, y: yb + sy / 2, z, sx, sy, sz, amp, w, ph });
    }
    function archAt(ch, z, lv, px, h) {
      const c1 = col(lv, 1).clone(), c2 = col(lv, 2).clone();
      B(ch, -px, 0, z, 1.4, h, 1.4, c1);
      B(ch, px, 0, z, 1.4, h, 1.4, c1);
      B(ch, 0, h, z, px * 2 + 1.8, 1.3, 1.5, c2);
      B(ch, 0, 5.4, z, 1.2, h - 5.4, 1.2, c1);
    }

    const STYLES = {
      terraces(ch, z0, lv, idx) {
        const zc = z0 - CH / 2;
        for (const s of [-1, 1]) {
          const n = 2 + (Math.random() < 0.5 ? 1 : 0);
          let xo = 4;
          for (let k = 0; k < n; k++) {
            const w = 2.2 + Math.random() * 2;
            const h = 0.6 + k * 1.1 + Math.random() * 0.7;
            B(ch, s * (xo + w / 2), 0, zc, w, h, CH - 0.05, col(lv, k));
            xo += w - 0.4;
          }
          if (Math.random() < 0.6) B(ch, s * (9 + Math.random() * 5), 0, zc + (Math.random() - 0.5) * 5, 2.4, 8 + Math.random() * 7, 2.4, col(lv, 2));
          const gi = G(ch, s * 4.06, 0.3, zc, 0.12, 3.2, 2.6, lv.glow);
          moverOf(ch, glowPool, gi, "slideY", s * 4.06, 0.3, zc, 0.12, 3.2, 2.6, 1.3, 0.9 + Math.random() * 0.7, Math.random() * 6);
        }
        if (idx % 3 === 0) archAt(ch, zc, lv, 5.0, 6.8);
      },
      arches(ch, z0, lv, idx) {
        const zc = z0 - CH / 2;
        archAt(ch, zc + (Math.random() - 0.5) * 3, lv, 5.2 + Math.random() * 1.5, 7.5 + Math.random() * 3);
        for (const s of [-1, 1]) {
          B(ch, s * 9.5, 0, zc, 6, 1.6, CH - 0.5, col(lv, 0));
          B(ch, s * 9.5, 1.6, zc, 4, 1.6, CH - 2.5, col(lv, 1));
          B(ch, s * 9.5, 3.2, zc, 2, 1.6, CH - 5, col(lv, 2));
          B(ch, s * 4.5, 0, zc, 1.0, 0.8, CH - 0.1, col(lv, 2));
          const gi = G(ch, s * 4.06, 0.3, zc, 0.12, 3.0, 2.4, lv.glow);
          moverOf(ch, glowPool, gi, "slideY", s * 4.06, 0.3, zc, 0.12, 3.0, 2.4, 1.2, 1.0 + Math.random() * 0.6, Math.random() * 6);
        }
      },
      halls(ch, z0, lv, idx) {
        const zc = z0 - CH / 2, seg = CH / 3;
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            if (Math.random() < 0.2) continue; // open window: sky shows through
            B(ch, s * 5.3, 0, z0 - seg * (k + 0.5), 2.6, 6.8, seg - 0.02, col(lv, k));
          }
          const pi = B(ch, s * 3.7, 4.2, zc + (Math.random() - 0.5) * 4, 0.8, 2.2, 0.8, col(lv, 1));
          moverOf(ch, boxPool, pi, "slideY", s * 3.7, 4.2, zc, 0.8, 2.2, 0.8, 0.9, 1.4 + Math.random() * 0.8, Math.random() * 6);
          G(ch, s * 4.05, 3.4, zc, 0.12, 0.5, 1.4, lv.glow);
        }
        B(ch, 0, 5.3, zc, 10.6, 0.8, 1.0, col(lv, 2));
      },
      cavern(ch, z0, lv, idx) {
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            B(ch, s * (4.6 + Math.random() * 2.5), 1 + Math.random() * 3.5, z0 - Math.random() * CH, 3 + Math.random() * 2, 0.5, 4 + Math.random() * 4, col(lv, k), 0, (Math.random() - 0.5) * 0.6, s * (0.35 + Math.random() * 0.7));
          }
          for (let k = 0; k < 3; k++) {
            const h = 1.4 + Math.random() * 2.2;
            const i = conePool.alloc(s * (4.05 + Math.random() * 0.5), 0.5 + Math.random() * 3.6, z0 - Math.random() * CH, 0.7 + Math.random() * 0.5, h, 0.7 + Math.random() * 0.5, 0, 0, -s * (0.55 + Math.random() * 0.4), tmpC.set(lv.crystal));
            if (i >= 0) ch.items.push([conePool, i]);
          }
        }
        B(ch, (Math.random() * 2 - 1) * 2.5, 5.8 + Math.random() * 1.6, z0 - Math.random() * CH, 5 + Math.random() * 3, 0.5, 4 + Math.random() * 3, col(lv, 1), 0, Math.random() * 0.4, (Math.random() - 0.5) * 0.8);
        for (let k = 0; k < 2; k++) {
          const sz = 0.9 + Math.random() * 1.2;
          const yb = 4 + Math.random() * 5, x = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 5), zz = z0 - Math.random() * CH;
          const i = B(ch, x, yb, zz, sz, sz, sz, col(lv, 1));
          moverOf(ch, boxPool, i, "spin", x, yb, zz, sz, sz, sz, 0, 0.4 + Math.random() * 0.7, Math.random() * 6);
        }
      },
      columns(ch, z0, lv, idx) {
        const zc = z0 - CH / 2;
        for (const s of [-1, 1]) {
          for (let k = 0; k < 2; k++) {
            const z = z0 - CH * (k * 2 + 1) / 4;
            B(ch, s * 4.7, 0, z, 1.0, 6.6, 1.0, col(lv, 1));
            B(ch, s * 4.7, 0, z, 1.6, 0.5, 1.6, col(lv, 2));
            B(ch, s * 4.7, 6.3, z, 1.6, 0.5, 1.6, col(lv, 2));
          }
          B(ch, s * 4.6, 0, zc, 0.6, 1.0, CH - 1.6, col(lv, 0));
          const li = G(ch, s * 3.7, 3.2, zc, 0.35, 0.35, 0.35, lv.glow);
          moverOf(ch, glowPool, li, "bob", s * 3.7, 3.2, zc, 0.35, 0.35, 0.35, 0.35, 1.2 + Math.random(), Math.random() * 6);
        }
        if (idx % 2 === 0) B(ch, 0, 6.6, z0 - CH / 4, 10.2, 0.7, 1.0, col(lv, 2));
        B(ch, 0, 6.6, z0 - CH * 3 / 4, 10.2, 0.7, 1.0, col(lv, 2));
      },
      floating(ch, z0, lv, idx) {
        const zc = z0 - CH / 2;
        for (let i = 0; i < 6; i++) {
          const x = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 10);
          const yb = -2 + Math.random() * 12, sz = 0.8 + Math.random() * 2.2, zz = z0 - Math.random() * CH;
          const bi = B(ch, x, yb, zz, sz, sz, sz, col(lv, i));
          moverOf(ch, boxPool, bi, "spin", x, yb, zz, sz, sz, sz, 0, 0.4 + Math.random() * 0.8, Math.random() * 6);
        }
        for (const s of [-1, 1]) {
          G(ch, s * 4.15, 0, zc, 0.25, 0.3, CH - 0.3, lv.glow);
          B(ch, s * (12 + Math.random() * 10), -4, zc, 3, 14 + Math.random() * 8, 3, col(lv, 2));
        }
      }
    };

    function genChunk(z0) {
      const ch = { z0, items: [], dead: false };
      chunks.push(ch);
      const lv = levelOf(levelAt(z0 - CH / 2));
      STYLES[lv.style](ch, z0, lv, chunkIdx++);
      // distant silhouettes fade into the horizon haze
      for (const s of [-1, 1]) {
        if (Math.random() < 0.6 && lv.style !== "floating") {
          B(ch, s * (16 + Math.random() * 10), 0, z0 - Math.random() * CH, 4 + Math.random() * 3, 10 + Math.random() * 12, 4 + Math.random() * 3, col(lv, 2));
        }
      }
    }
    function releaseChunk(ch) {
      ch.dead = true;
      for (const it of ch.items) it[0].release(it[1]);
      ch.items.length = 0;
      movers = movers.filter(m => m.ch !== ch);
    }
    function updateMovers() {
      for (const m of movers) {
        const a = time * m.w + m.ph;
        if (m.kind === "slideY") m.pool.set(m.i, m.x, m.y + Math.sin(a) * m.amp, m.z, m.sx, m.sy, m.sz);
        else if (m.kind === "slideX") m.pool.set(m.i, m.x + Math.sin(a) * m.amp, m.y, m.z, m.sx, m.sy, m.sz);
        else if (m.kind === "bob") m.pool.set(m.i, m.x, m.y + Math.sin(a) * m.amp, m.z, m.sx, m.sy, m.sz, a * 0.5, a, 0);
        else m.pool.set(m.i, m.x, m.y, m.z, m.sx, m.sy, m.sz, a * 0.6, a, 0);
      }
    }

    // ---- level doors: solid gates with sliding leaves, a glowing portal behind them
    const doors = [];
    function spawnDoor(k) {
      const prev = levelOf(k - 1), next = levelOf(k);
      const g = new THREE.Group();
      g.position.set(0, 0, doorZ(k));
      const frameMat = new THREE.MeshLambertMaterial({ color: prev.blk[1] });
      const leafMat = new THREE.MeshLambertMaterial({ color: next.blk[1] });
      const seamMat = new THREE.MeshBasicMaterial({ color: next.glow });
      const portalMat = new THREE.MeshBasicMaterial({ color: next.horizon, fog: false, side: THREE.DoubleSide });
      function box(mat, x, y, z, sx, sy, sz) {
        const m = new THREE.Mesh(unitBox, mat);
        m.position.set(x, y, z); m.scale.set(sx, sy, sz);
        g.add(m);
        return m;
      }
      box(frameMat, -4.9, 3.5, 0, 1.4, 7, 1.6);
      box(frameMat, 4.9, 3.5, 0, 1.4, 7, 1.6);
      box(frameMat, 0, 7.0, 0, 11.2, 1.6, 1.6);
      box(seamMat, 0, 6.35, 0.85, 4, 0.22, 0.1);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 6.2), portalMat);
      portal.position.set(0, 3.1, -0.7);
      g.add(portal);
      const leafL = box(leafMat, -2, 3.1, 0.15, 4.05, 6.2, 0.5);
      const leafR = box(leafMat, 2, 3.1, 0.15, 4.05, 6.2, 0.5);
      const seamL = box(seamMat, 0.15, 0, 0.3, 0.14, 5.4, 0.12); leafL.add(seamL); seamL.position.set(0.47, 0, 0.55); seamL.scale.set(0.035, 0.87, 0.2);
      const seamR = box(seamMat, 0, 0, 0.3, 1, 1, 1); leafR.add(seamR); seamR.position.set(-0.47, 0, 0.55); seamR.scale.set(0.035, 0.87, 0.2);
      scene.add(g);
      doors.push({ k, z: doorZ(k), g, leafL, leafR, portal, mats: [frameMat, leafMat, seamMat, portalMat], sound: false });
    }
    function removeDoor(d) {
      scene.remove(d.g);
      d.mats.forEach(m => m.dispose());
      d.portal.geometry.dispose();
    }
    function updateDoors() {
      for (let i = doors.length - 1; i >= 0; i--) {
        const d = doors[i];
        const dist = camZ - d.z;               // >0 while approaching
        const t = Math.max(0, Math.min(1, (26 - dist) / 18));
        const open = t * t * (3 - 2 * t);
        d.leafL.position.x = -2 - open * 4.4;
        d.leafR.position.x = 2 + open * 4.4;
        if (dist < 26 && !d.sound && state === "play") { d.sound = true; sfxDoor(); }
        if (dist < -8) { removeDoor(d); doors.splice(i, 1); }
      }
    }

    // ---- glass: shapes, cached geometry, cached materials
    function inPoly(poly, u, v) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > v) !== (yj > v)) && (u < (xj - xi) * (v - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    function pointIn(kind, u, v) {
      if (kind === "rect") return Math.abs(u) <= 1 && Math.abs(v) <= 1;
      return inPoly(SHAPES[kind], u, v);
    }
    // world point -> panel-local test (panels can be rotated and moving)
    function insidePanel(p, wx, wy, margin) {
      const dx = wx - p.cx, dy = wy - p.cy;
      const lx = dx * p.c + dy * p.s, ly = -dx * p.s + dy * p.c;
      return pointIn(p.shape, lx / (p.w / 2 + margin), ly / (p.h / 2 + margin));
    }

    const geoCache = new Map();
    function panelGeo(kind, w, h, depth) {
      const key = kind + "|" + w.toFixed(2) + "|" + h.toFixed(2) + "|" + depth;
      let e = geoCache.get(key);
      if (!e) {
        const s = new THREE.Shape();
        SHAPES[kind].forEach((pt, i) => { if (i === 0) s.moveTo(pt[0] * w / 2, pt[1] * h / 2); else s.lineTo(pt[0] * w / 2, pt[1] * h / 2); });
        s.closePath();
        const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
        geo.translate(0, 0, -depth / 2);
        e = { geo, edges: new THREE.EdgesGeometry(geo, 40) };
        geoCache.set(key, e);
      }
      return e;
    }

    const glassCache = new Map();
    function glassMat(tex, tint, tier) {
      const key = tex + "|" + tint + "|" + tier;
      let e = glassCache.get(key);
      if (!e) {
        const mat = new THREE.MeshPhongMaterial({
          color: curTints[tint].clone().multiplyScalar(TIER_DARK[tier]),
          map: texMap(tex),
          transparent: true,
          opacity: TIER_OPACITY[tier],
          specular: 0xffffff,
          shininess: 60 + tier * 25,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        e = { mat, tint, tier };
        glassCache.set(key, e);
      }
      return e.mat;
    }
    const edgeMats = TIER_EDGE.map((c, i) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7 + i * 0.1 }));
    const crackMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const rodMat = new THREE.MeshLambertMaterial({ color: 0x3a3550 });
    const shardMats = curTints.map(c => new THREE.MeshPhongMaterial({
      color: c, transparent: true, opacity: 0.75, specular: 0xffffff, shininess: 120, side: THREE.DoubleSide, depthWrite: false
    }));

    // balls
    const ballGeo = new THREE.SphereGeometry(BALL_R, 14, 10);
    const ballMat = new THREE.MeshPhongMaterial({ color: 0xf2f6ff, emissive: 0x5a78d8, emissiveIntensity: 0.5, specular: 0xffffff, shininess: 140 });
    const ballPool = [];
    for (let i = 0; i < MAX_BALLS_LIVE; i++) {
      const mesh = new THREE.Mesh(ballGeo, ballMat);
      mesh.visible = false;
      scene.add(mesh);
      ballPool.push({ mesh, alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, hit: false, lastPanel: null });
    }

    // crystals: 4 kinds of increasing complexity
    const gCone = new THREE.ConeGeometry(0.3, 0.75, 4);
    const gOcta = new THREE.OctahedronGeometry(0.42);
    const gIco = new THREE.IcosahedronGeometry(0.4, 0);
    const gDodeca = new THREE.DodecahedronGeometry(0.5, 0);
    const gSpike = new THREE.ConeGeometry(0.11, 0.5, 5);
    const gRing = new THREE.TorusGeometry(0.75, 0.025, 6, 32);
    const crystalMats = [0, 1, 2, 3].map(() => new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, flatShading: true, shininess: 120, specular: 0xffffff }));
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const DIAG = [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1], [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]];
    const upV = new THREE.Vector3(0, 1, 0);
    function addSpike(g, mat, dir, dist) {
      const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
      const m = new THREE.Mesh(gSpike, mat);
      m.position.copy(d).multiplyScalar(dist);
      m.quaternion.setFromUnitVectors(upV, d);
      g.add(m);
    }
    function buildCrystal(kind) {
      const g = new THREE.Group();
      const mat = crystalMats[kind];
      if (kind === 0) {
        g.add(new THREE.Mesh(gCone, mat));
      } else if (kind === 1) {
        const core = new THREE.Mesh(gOcta, mat);
        core.scale.set(0.9, 1.35, 0.9);
        g.add(core);
        addSpike(g, mat, [0, 1, 0], 0.7);
        addSpike(g, mat, [0, -1, 0], 0.7);
      } else if (kind === 2) {
        g.add(new THREE.Mesh(gIco, mat));
        AXES.forEach(a => addSpike(g, mat, a, 0.55));
        const ring = new THREE.Mesh(gRing, ringMat);
        ring.scale.setScalar(0.85);
        g.add(ring);
        g.userData.ring = ring;
      } else {
        const core = new THREE.Mesh(gDodeca, mat);
        core.scale.setScalar(1.15);
        g.add(core);
        AXES.forEach(a => addSpike(g, mat, a, 0.75));
        DIAG.forEach(a => addSpike(g, mat, a, 0.68));
        const ring = new THREE.Mesh(gRing, ringMat);
        ring.scale.setScalar(1.15);
        g.add(ring);
        const ring2 = new THREE.Mesh(gRing, ringMat);
        ring2.scale.setScalar(1.15);
        ring2.rotation.x = Math.PI / 2;
        g.add(ring2);
        g.userData.ring = ring;
        g.userData.ring2 = ring2;
      }
      return g;
    }
    const crystals = [];

    // shards
    const shardGeo = new THREE.BufferGeometry();
    shardGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0.5, 0, -0.4, -0.3, 0, 0.4, -0.3, 0]), 3));
    shardGeo.computeVertexNormals();
    const shards = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = new THREE.Mesh(shardGeo, shardMats[i % 3]);
      mesh.visible = false;
      scene.add(mesh);
      shards.push({ mesh, life: 0, max: 1, size: 0.4, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0 });
    }
    let shardCursor = 0;

    const panels = [];
    const raycaster = new THREE.Raycaster();
    const tmpV = new THREE.Vector3();

    // ---------------------------------------------------------------- glass panels (static, pendulum, rotor, sliding, doors, lifts)
    function pickWeighted(weights) {
      let total = 0;
      for (const w of weights) total += w;
      let r = Math.random() * total;
      for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
      return weights.length - 1;
    }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function rnd(a, b) { return a + Math.random() * (b - a); }

    function tierWeights(lvlIndex) {
      const w = levelOf(lvlIndex).hp.slice();
      const cycle = Math.floor(lvlIndex / LEVELS.length);
      if (cycle > 0) { w[0] = Math.max(0, w[0] - 20 * cycle); w[3] += 12 * cycle; w[2] += 6 * cycle; }
      return w;
    }

    // o: { x, y (pivot), ox, oy (pane centre offset from pivot), z, w, h, lvl, shape, tex, tier, maxTier, motion, rod, hub }
    function addPanel(o) {
      const lv = levelOf(o.lvl);
      let tier = o.tier !== undefined ? o.tier : pickWeighted(tierWeights(o.lvl));
      if (o.maxTier !== undefined) tier = Math.min(tier, o.maxTier);
      const shape = o.shape || pick(lv.shapes);
      const tex = o.tex || pick(lv.tex);
      const tint = Math.floor(Math.random() * 3);
      const depth = TIER_DEPTH[tier];
      const e = panelGeo(shape, o.w, o.h, depth);
      const group = new THREE.Group();
      group.position.set(o.x, o.y, o.z);
      const mesh = new THREE.Mesh(e.geo, glassMat(tex, tint, tier));
      mesh.position.set(o.ox || 0, o.oy || 0, 0);
      mesh.add(new THREE.LineSegments(e.edges, edgeMats[tier]));
      group.add(mesh);
      if (o.rod) {
        const rod = new THREE.Mesh(unitBox, rodMat);
        rod.scale.set(0.07, o.rod, 0.07);
        rod.position.set(0, -o.rod / 2, 0);
        group.add(rod);
        const hub = new THREE.Mesh(unitBox, rodMat);
        hub.scale.set(0.3, 0.3, 0.3);
        group.add(hub);
      }
      if (o.hub) {
        const hub = new THREE.Mesh(unitBox, rodMat);
        hub.scale.set(0.45, 0.45, 0.3);
        group.add(hub);
      }
      scene.add(group);
      const p = {
        group, mesh, px: o.x, py: o.y, ox: o.ox || 0, oy: o.oy || 0, z: o.z, w: o.w, h: o.h,
        shape, tex, tint, tier, depth, hp: TIER_HP[tier], alive: true, pulse: 0, crack: null, crackN: 0,
        motion: o.motion || null, cx: 0, cy: 0, c: 1, s: 0, th: 0
      };
      poseAt(p);
      panels.push(p);
      return p;
    }

    function poseAt(p) {
      const m = p.motion, t = time;
      let th = 0, gx = p.px, gy = p.py;
      if (m) {
        const a = m.w * t + m.ph;
        if (m.type === "pendulum") th = m.A * Math.sin(a);
        else if (m.type === "rotor") th = m.dir * a;
        else if (m.type === "slideX") gx = p.px + m.A * Math.sin(a);
        else if (m.type === "door") gx = m.sign * (2.05 + 1.9 * (0.5 + 0.5 * Math.sin(a)));
        else if (m.type === "lift") gy = m.y0 + m.A * (0.5 + 0.5 * Math.sin(a));
      }
      p.th = th; p.c = Math.cos(th); p.s = Math.sin(th);
      p.cx = gx + p.ox * p.c - p.oy * p.s;
      p.cy = gy + p.ox * p.s + p.oy * p.c;
      p.group.position.set(gx, gy, p.z);
      p.group.rotation.z = th;
    }

    function removePanel(p) {
      scene.remove(p.group);
      if (p.crack) { p.crack.geometry.dispose(); p.crack = null; }
    }

    function addCrystal(x, y, z, kind) {
      const mesh = buildCrystal(kind);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      const moving = kind >= 2 || (kind === 1 && Math.random() < 0.4);
      crystals.push({
        mesh, x, y, z, kind, alive: true, phase: Math.random() * 6, cx: x, cy: y,
        ax: moving ? 0.8 + kind * 0.45 : 0, ay: moving ? 0.35 + kind * 0.2 : 0, wx: 0.9 + Math.random() * 0.7
      });
    }

    // ---------------------------------------------------------------- obstacle patterns
    function spawnBlock(z) {
      const lvl = levelAt(z);
      const lv = levelOf(lvl);
      // keep the approach to a door and the first stretch after it clear
      const kDoor = lvl + 1;
      if (z - doorZ(kDoor) < 16) return 0;
      if (lvl > 0 && z > doorZ(lvl) - 16) return 0;
      const b = blockCount++;
      const soft = b < 3 ? { maxTier: 1 } : {};
      const kind = b === 0 ? "wall" : b === 1 ? "pendulum" : pick(lv.patterns);
      const S = () => pick(lv.shapes);
      let len = 3;

      if (kind === "wall") {
        const shape = S();
        const rect = shape === "rect";
        addPanel(Object.assign({ x: 0, y: CEIL / 2, z, w: rect ? 7.6 : 6.8, h: rect ? 4.8 : 4.7, lvl, shape, maxTier: 2 }, soft));
      } else if (kind === "grid") {
        const shape = S();
        for (const sx of [-1, 1]) for (const sy of [0, 1]) {
          addPanel(Object.assign({ x: sx * 1.95, y: 1.2 + sy * 2.4, z, w: 3.7, h: 2.3, lvl, shape }, soft));
        }
      } else if (kind === "pillars") {
        const shape = S();
        for (const px of [-2.7, 0, 2.7]) addPanel(Object.assign({ x: px, y: CEIL / 2, z, w: 1.4, h: 4.8, lvl, shape }, soft));
      } else if (kind === "rings") {
        const shape = S();
        for (let i = 0; i < 3; i++) addPanel(Object.assign({ x: 0, y: 1.9, z: z - i * 3.2, w: 4.6 - i * 0.7, h: 3.2, lvl, shape }, soft));
        len = 9;
      } else if (kind === "layers") {
        const shape = S(), tex = pick(lv.tex);
        for (let i = 0; i < 3; i++) {
          addPanel({ x: 0, y: 1.9, z: z - i * 3.2, w: 3.8 - i * 0.4, h: 3.4 - i * 0.3, lvl, shape, tex, tier: Math.min(3, i + (lvl >= 3 ? 1 : 0)) });
        }
        len = 9;
      } else if (kind === "hoops") {
        addPanel(Object.assign({ x: 0, y: 1.8, z, w: 2.6, h: 2.6, lvl }, soft));
        for (let i = 0; i < 3; i++) {
          addPanel(Object.assign({ x: (i - 1) * 2.1 + rnd(-0.4, 0.4), y: rnd(1.2, 3.3), z: z - 2.6 * (i + 1), w: 1.8, h: 1.8, lvl }, soft));
        }
        len = 9;
      } else if (kind === "pendulum") {
        // panes hanging on rods from above, swinging across the lane
        const n = 2 + (lvl >= 1 ? 1 : 0) + (Math.random() < 0.4 ? 1 : 0);
        const PIVOT_Y = 5.7;
        for (let i = 0; i < n; i++) {
          const h = rnd(2.2, 3.0), w = rnd(2.2, 3.2);
          const rod = PIVOT_Y - h - 0.9;
          addPanel(Object.assign({
            x: (i % 2 ? 1 : -1) * rnd(0, 1.1), y: PIVOT_Y, z: z - i * 3.4, ox: 0, oy: -(rod + h / 2), w, h, lvl, rod,
            motion: { type: "pendulum", A: rnd(0.5, 0.95), w: rnd(1.3, 1.9) + lvl * 0.06, ph: rnd(0, 6.28) }
          }, soft));
        }
        len = (n - 1) * 3.4 + 2;
      } else if (kind === "doors") {
        const shape = "rect", w = rnd(1.1, 1.7), ph = rnd(0, 6.28);
        const sets = lvl >= 2 ? 2 : 1;
        for (let k = 0; k < sets; k++) {
          for (const sign of [-1, 1]) {
            addPanel(Object.assign({ x: sign * 2.05, y: 2.4, z: z - k * 4.5, w: 4.0, h: 4.6, lvl, shape, maxTier: 2, motion: { type: "door", sign, w, ph: ph + k * 2.2 } }, soft));
          }
        }
        len = sets === 2 ? 7 : 3;
      } else if (kind === "slider") {
        const shape = S();
        addPanel(Object.assign({ x: 0, y: 2.4, z, w: 5.2, h: 4.6, lvl, shape, motion: { type: "slideX", A: 3.0, w: rnd(0.9, 1.6), ph: rnd(0, 6.28) } }, soft));
        if (lvl >= 2) addPanel(Object.assign({ x: 0, y: 2.4, z: z - 4.2, w: 5.2, h: 4.6, lvl, shape, motion: { type: "slideX", A: 3.0, w: rnd(1.0, 1.7), ph: rnd(0, 6.28) } }, soft));
        len = lvl >= 2 ? 6 : 3;
      } else if (kind === "lift") {
        addPanel(Object.assign({ x: 0, y: 1.25, z, w: 7.6, h: 2.5, lvl, shape: "rect", motion: { type: "lift", y0: 1.25, A: 2.45, w: rnd(1.3, 2.1), ph: rnd(0, 6.28) } }, soft));
        len = 3;
      } else { // rotor: two-bladed propellers of glass
        const sets = 2;
        for (let k = 0; k < sets; k++) {
          const dir = k % 2 ? -1 : 1, side = k % 2 ? -1 : 1, w = rnd(1.3, 2.0), ph = rnd(0, 6.28);
          for (const bs of [-1, 1]) {
            addPanel(Object.assign({
              x: side * 0.9, y: 2.4, z: z - k * 3.8, ox: bs * 1.45, oy: 0, w: 2.2, h: 1.0, lvl, shape: "rect", maxTier: 2, hub: bs === 1,
              motion: { type: "rotor", dir, w, ph }
            }, soft));
          }
        }
        len = 8;
      }

      // fewer, more valuable crystals: the rarer the kind, the more complex and generous
      if (Math.random() < CRYSTAL_CHANCE[Math.min(lvl, CRYSTAL_CHANCE.length - 1)]) {
        const kindC = pickWeighted(CRYSTAL_WEIGHTS[Math.min(lvl, CRYSTAL_WEIGHTS.length - 1)]);
        addCrystal(rnd(-2.3, 2.3), rnd(1.2, 3.4), z + rnd(3, 5.5), kindC);
      }
      return len;
    }

    function blockSpacing(lvl) { return Math.max(9, 12 - lvl * 0.4); }

    function setTargetTheme(lv) {
      tgtSky.set(lv.skyTop); tgtHor.set(lv.horizon); tgtFloor.set(lv.floor); tgtCrystal.set(lv.crystal); tgtGlow.set(lv.glow);
      lv.tints.forEach((c, i) => tgtTints[i].set(c));
    }

    function showBanner(title, sub) {
      bannerEl.querySelector(".b1").textContent = title;
      bannerEl.querySelector(".b2").textContent = sub;
      bannerEl.classList.remove("show");
      void bannerEl.offsetWidth;
      bannerEl.classList.add("show");
    }

    function activateLevel(i, announce) {
      activeLevel = i;
      const lv = levelOf(i);
      setTargetTheme(lv);
      setFloorWidth(lv.floorW);
      levelEl.textContent = state === "menu" ? "" : "LEVEL " + (i + 1) + " · " + lv.name.toUpperCase();
      if (announce) {
        showBanner("LEVEL " + (i + 1), lv.name.toUpperCase());
        if (i > 0) {
          score.add(100 * i, { reason: "level" });
          sfxLevel();
          haptic("success");
          ctx.platform.milestone("level_" + (i + 1));
        }
        setMusicIntensity(Math.min(0.5, 0.2 + i * 0.05));
        setMusicScale(lv.scale);
      }
    }

    function updatePalette(dt) {
      const k = 1 - Math.exp(-dt * 1.1);
      curSky.lerp(tgtSky, k);
      curHor.lerp(tgtHor, k);
      curFloor.lerp(tgtFloor, k);
      curCrystal.lerp(tgtCrystal, k);
      curGlow.lerp(tgtGlow, k);
      scene.fog.color.copy(curHor);
      scene.background = curHor;
      hemi.color.copy(curHor);
      hemi.groundColor.copy(curFloor);
      floorMat.color.copy(curFloor);
      for (let i = 0; i < 3; i++) {
        curTints[i].lerp(tgtTints[i], k);
        shardMats[i].color.copy(curTints[i]);
      }
      glassCache.forEach((e) => {
        e.mat.color.copy(curTints[e.tint]).multiplyScalar(TIER_DARK[e.tier]);
      });
      // crystal families: simple = level colour, richer = lighter, golden, prismatic
      crystalMats[0].color.copy(curCrystal);
      crystalMats[1].color.copy(curCrystal).lerp(tmpC.set(0xffffff), 0.3);
      crystalMats[2].color.copy(curCrystal).lerp(tmpC.set(0xffd66a), 0.45);
      crystalMats[3].color.copy(tmpC.setHSL((time * 0.15) % 1, 0.85, 0.65));
      for (let i = 0; i < 4; i++) crystalMats[i].emissive.copy(crystalMats[i].color);
      ringMat.color.copy(curGlow);
    }

    function resetWorld() {
      for (const p of panels) removePanel(p);
      panels.length = 0;
      for (const c of crystals) scene.remove(c.mesh);
      crystals.length = 0;
      for (const d of doors) removeDoor(d);
      doors.length = 0;
      for (const ch of chunks) releaseChunk(ch);
      chunks.length = 0;
      movers = [];
      for (const b of ballPool) { b.alive = false; b.mesh.visible = false; b.lastPanel = null; }
      for (const s of shards) { s.life = 0; s.mesh.visible = false; }
      camZ = 0; time = 0; nextBlockZ = -24; blockCount = 0; nextChunkZ = 30; chunkIdx = 0; doorsSpawned = 0; nextDoorK = 1;
      activateLevel(0, false);
      curSky.copy(tgtSky); curHor.copy(tgtHor); curFloor.copy(tgtFloor); curCrystal.copy(tgtCrystal); curGlow.copy(tgtGlow);
      curTints.forEach((c, i) => c.copy(tgtTints[i]));
      updatePalette(1);
    }

    // ---------------------------------------------------------------- effects
    function popText(text, x, y, color, size) {
      try { ctx.fx.floatText({ text, x, y, color, size: size || 20, rise: 46, durationMs: 850 }); } catch (e) {}
    }

    function project(x, y, z) {
      tmpV.set(x, y, z).project(camera);
      return { x: (tmpV.x * 0.5 + 0.5) * ctx.width, y: (-tmpV.y * 0.5 + 0.5) * ctx.height };
    }

    function spawnShards(p, dirx, diry, dirz, countScale) {
      const area = p.w * p.h;
      const n = Math.min(46, Math.max(10, Math.round(area * 3.2 * (1 + p.tier * 0.3) * (countScale || 1))));
      const size = Math.max(0.22, Math.min(0.75, Math.sqrt(area) * 0.16)) * (1 + p.tier * 0.12);
      const c = p.c === undefined ? 1 : p.c, sn = p.s === undefined ? 0 : p.s;
      for (let i = 0; i < n; i++) {
        const s = shards[shardCursor];
        shardCursor = (shardCursor + 1) % SHARD_COUNT;
        let u = 0, v = 0;
        for (let t = 0; t < 8; t++) {
          u = Math.random() * 2 - 1; v = Math.random() * 2 - 1;
          if (pointIn(p.shape, u, v)) break;
        }
        const lx = u * p.w / 2, ly = v * p.h / 2;
        const px = p.cx + lx * c - ly * sn, py = p.cy + lx * sn + ly * c;
        s.mesh.material = shardMats[p.tint];
        s.mesh.position.set(px, py, p.z);
        s.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        s.size = size * (0.5 + Math.random());
        s.max = s.life = 1.1 + Math.random() * 0.9;
        const ox = (px - p.cx) * 0.9, oy = (py - p.cy) * 0.9;
        s.vx = ox + dirx * 0.12 + (Math.random() - 0.5) * 2;
        s.vy = oy + diry * 0.1 + Math.random() * 2;
        s.vz = dirz * 0.16 + (Math.random() - 0.5) * 3 - speed * 0.5;
        s.rx = (Math.random() - 0.5) * 12; s.ry = (Math.random() - 0.5) * 12; s.rz = (Math.random() - 0.5) * 12;
        s.mesh.scale.setScalar(s.size);
        s.mesh.visible = true;
      }
    }

    function addCracks(p, lx, ly) {
      const MAXSEG = 60;
      if (!p.crack) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXSEG * 6), 3));
        geo.setDrawRange(0, 0);
        p.crack = new THREE.LineSegments(geo, crackMat);
        p.crack.frustumCulled = false;
        p.mesh.add(p.crack);
        p.crackN = 0;
      }
      const arr = p.crack.geometry.attributes.position.array;
      const lines = 5 + Math.floor(Math.random() * 3);
      const reach = Math.min(p.w, p.h) * 0.4;
      const zf = p.depth / 2 + 0.012;
      for (let k = 0; k < lines && p.crackN + 2 <= MAXSEG; k++) {
        const a = Math.random() * Math.PI * 2;
        const len = (0.35 + Math.random() * 0.65) * reach;
        const mx = lx + Math.cos(a) * len * 0.5 + (Math.random() - 0.5) * 0.15;
        const my = ly + Math.sin(a) * len * 0.5 + (Math.random() - 0.5) * 0.15;
        const ex = mx + Math.cos(a + (Math.random() - 0.5) * 0.7) * len * 0.5;
        const ey = my + Math.sin(a + (Math.random() - 0.5) * 0.7) * len * 0.5;
        let i = p.crackN * 6;
        arr[i++] = lx; arr[i++] = ly; arr[i++] = zf; arr[i++] = mx; arr[i++] = my; arr[i++] = zf;
        arr[i++] = mx; arr[i++] = my; arr[i++] = zf; arr[i++] = ex; arr[i++] = ey; arr[i++] = zf;
        p.crackN += 2;
      }
      p.crack.geometry.attributes.position.needsUpdate = true;
      p.crack.geometry.setDrawRange(0, p.crackN * 2);
    }

    // ---------------------------------------------------------------- gameplay actions
    function multiplier() { return 1 + Math.min(4, Math.floor(streak / 5)); }

    function breakPanel(p, dx, dy, dz, byBall) {
      p.alive = false;
      spawnShards(p, dx, dy, dz, 1);
      removePanel(p);
      sfxShatter(p.tier);
      smashed++;
      if (byBall) {
        const pts = TIER_POINTS[p.tier] * multiplier();
        score.add(pts, { reason: "glass" });
        const pos = project(p.cx, p.cy, p.z);
        popText("+" + pts, pos.x, pos.y, "#ffe9a8", 20 + multiplier() * 2);
        sfxPoint(Math.min(8, streak));
        haptic(p.tier >= 2 ? "medium" : "light");
        try { ctx.music.duck(0.3, 250); } catch (e) {}
      }
    }

    // ball hits glass: chip it (crack + bounce) or shatter it once the hits run out
    function damagePanel(p, b) {
      p.hp -= 1;
      if (p.hp <= 0) {
        breakPanel(p, b.vx, b.vy, b.vz, true);
        b.vz *= 0.8; b.vx *= 0.9;
        return;
      }
      const dx = b.x - p.cx, dy = b.y - p.cy;
      addCracks(p, dx * p.c + dy * p.s, -dx * p.s + dy * p.c);
      p.pulse = 1;
      spawnShards(p, b.vx, b.vy, b.vz, 0.18);
      sfxCrack(p.tier);
      haptic("light");
      score.add(2, { reason: "chip" });
      b.lastPanel = p;
      b.z = p.z + p.depth / 2 + BALL_R + 0.02;
      b.vz = Math.abs(b.vz) * 0.28;
      b.vx = (Math.random() - 0.5) * 5;
      b.vy = 1.5 + Math.random() * 2;
    }

    function onBallHitSomething(ball) {
      if (!ball.hit) {
        ball.hit = true;
        streak++;
        if (streak === 10) {
          popText("MULTIBALL!", ctx.width / 2, ctx.height * 0.36, "#ffe9a8", 26);
          haptic("success");
        }
        if (streak % 8 === 0) {
          balls += 2;
          popText("STREAK +2 BALLS", ctx.width / 2, ctx.height * 0.44, "#bfe3ff", 18);
        }
      }
    }

    function throwBall(ndcX, ndcY) {
      if (state !== "play" || balls <= 0) return;
      const now = performance.now();
      if (now - lastThrow < 90) return;
      lastThrow = now;
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const dir = raycaster.ray.direction;
      const count = streak >= 10 ? 2 : 1;
      balls -= 1;
      for (let k = 0; k < count; k++) {
        const b = ballPool.find(q => !q.alive);
        if (!b) break;
        const spread = count === 1 ? 0 : (k === 0 ? -0.05 : 0.05);
        b.alive = true; b.hit = false; b.life = 0; b.lastPanel = null;
        b.x = camera.position.x + dir.x * 0.6;
        b.y = camera.position.y + dir.y * 0.6 - 0.25;
        b.z = camera.position.z + dir.z * 0.6;
        b.vx = dir.x * BALL_SPEED + spread * BALL_SPEED;
        b.vy = dir.y * BALL_SPEED;
        b.vz = dir.z * BALL_SPEED - speed;
        b.mesh.position.set(b.x, b.y, b.z);
        b.mesh.visible = true;
      }
      sfxThrow();
      ctx.platform.interact({ type: "throw" });
    }

    function killBall(b) {
      if (!b.hit) {
        if (streak >= 5) popText("streak lost", ctx.width / 2, ctx.height * 0.5, "#ffffff", 14);
        streak = 0;
      }
      b.alive = false; b.mesh.visible = false;
    }

    function stepBalls(dt) {
      for (const b of ballPool) {
        if (!b.alive) continue;
        b.life += dt;
        b.vy -= BALL_GRAVITY * dt;
        const travel = Math.hypot(b.vx, b.vy, b.vz) * dt;
        const steps = Math.max(1, Math.ceil(travel / 0.2));
        const sdt = dt / steps;
        let dead = false;
        for (let s = 0; s < steps && !dead; s++) {
          b.x += b.vx * sdt; b.y += b.vy * sdt; b.z += b.vz * sdt;
          if (b.x < -HALF_W + BALL_R) { b.x = -HALF_W + BALL_R; b.vx = Math.abs(b.vx) * 0.6; }
          else if (b.x > HALF_W - BALL_R) { b.x = HALF_W - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; }
          if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy) * 0.5; b.vx *= 0.92; }
          else if (b.y > CEIL - BALL_R) { b.y = CEIL - BALL_R; b.vy = -Math.abs(b.vy) * 0.5; }
          for (const p of panels) {
            if (!p.alive || b.lastPanel === p) continue;
            if (Math.abs(b.z - p.z) < p.depth / 2 + BALL_R &&
                insidePanel(p, b.x, b.y, BALL_R * 0.5)) {
              onBallHitSomething(b);
              damagePanel(p, b);
              if (b.lastPanel === p) break;
            }
          }
          for (const c of crystals) {
            if (!c.alive) continue;
            const dx = b.x - c.cx, dy = b.y - c.cy, dz = b.z - c.z;
            const r = CRYSTAL_R[c.kind] + BALL_R;
            if (dx * dx + dy * dy + dz * dz < r * r) {
              c.alive = false;
              scene.remove(c.mesh);
              onBallHitSomething(b);
              collectCrystal(c);
            }
          }
          if (b.z > camZ + 1 || b.z < camZ - VIEW_DIST + 4) dead = true;
        }
        if (dead || b.life > 3.2) { killBall(b); continue; }
        b.mesh.position.set(b.x, b.y, b.z);
      }
    }

    function collectCrystal(c) {
      const gain = CRYSTAL_BALLS[c.kind];
      balls += gain;
      const pts = (10 + gain * 8) * multiplier();
      score.add(pts, { reason: "crystal" });
      const pos = project(c.cx, c.cy, c.z);
      popText("+" + gain + " balls", pos.x, pos.y, c.kind >= 2 ? "#ffe9a8" : "#ffffff", 18 + c.kind * 3);
      sfxCrystal(c.kind);
      haptic(c.kind >= 2 ? "success" : "medium");
      spawnShards({ cx: c.cx, cy: c.cy, z: c.z, w: 0.7 + c.kind * 0.3, h: 0.7 + c.kind * 0.3, shape: "rect", tint: c.kind % 3, tier: 0, c: 1, s: 0 }, 0, 0, -1, 1);
    }

    function crash(p) {
      breakPanel(p, 0, 0, -6, false);
      balls = Math.max(0, balls - CRASH_COST);
      streak = 0;
      shake = 1;
      sfxThud();
      haptic("error");
      try { ctx.fx.flash({ color: "#ff4d6d", opacity: 0.3, durationMs: 300 }); } catch (e) {}
      popText("-" + CRASH_COST, ctx.width / 2, ctx.height * 0.42, "#ffb0c0", 26);
      if (balls <= 0) endRun();
    }

    function playerHits(p) {
      const px = camera.position.x;
      return insidePanel(p, px, CAM_Y, 0) ||
        insidePanel(p, px - 0.45, CAM_Y, 0) || insidePanel(p, px + 0.45, CAM_Y, 0) ||
        insidePanel(p, px, CAM_Y - 0.4, 0) || insidePanel(p, px, CAM_Y + 0.4, 0);
    }

    function updateHud() {
      const sv = Math.round(score.value);
      if (sv !== shownScore) { shownScore = sv; scoreEl.textContent = String(sv); }
      if (balls !== shownBalls) {
        shownBalls = balls;
        ballsEl.innerHTML = "<span></span>" + balls;
        ballsEl.className = "gd-balls" + (balls <= 5 ? " low" : "");
      }
      const label = streak >= 3
        ? (streak >= 10 ? "MULTIBALL · " : "") + "x" + multiplier() + " · STREAK " + streak
        : "";
      if (streakEl.textContent !== label) streakEl.textContent = label;
    }

    // ---------------------------------------------------------------- run lifecycle
    function fillWorld() {
      while (nextChunkZ - CH > camZ - VIEW_DIST - 6) { genChunk(nextChunkZ); nextChunkZ -= CH; }
      while (doorZ(doorsSpawned + 1) > camZ - VIEW_DIST) { doorsSpawned++; spawnDoor(doorsSpawned); }
      while (nextBlockZ > camZ - VIEW_DIST) {
        const len = spawnBlock(nextBlockZ);
        nextBlockZ -= len ? Math.max(11, len + 5) - Math.min(3, levelAt(nextBlockZ) * 0.4) : blockSpacing(levelAt(nextBlockZ)) * 1.6;
      }
    }

    function startRun() {
      run += 1;
      resetWorld();
      score.reset();
      balls = START_BALLS; streak = 0; smashed = 0; distAccum = 0;
      speed = 7; shake = 0;
      state = "play";
      menuEl.style.display = "none";
      overEl.style.display = "none";
      shownScore = -1; shownBalls = -1;
      fillWorld();
      activateLevel(0, true);
      ctx.platform.start();
      updateHud();
    }

    function endRun() {
      if (state !== "play") return;
      state = "over";
      const attempt = run;
      const finalScore = Math.round(score.value);
      const reached = activeLevel + 1;
      sfxOver();
      setMusicIntensity(0.08);
      ctx.platform.complete({ score: finalScore, level: reached });
      setTimeout(() => {
        if (disposed || attempt !== run) return;
        finalEl.textContent = String(finalScore);
        reachedEl.textContent = "LEVEL " + reached + " · " + levelOf(reached - 1).name.toUpperCase();
        bestEl.textContent = "";
        boardEl.textContent = "";
        statusEl.textContent = "Saving score…";
        overEl.style.display = "block";
        playBtn.disabled = true;
        setTimeout(() => { if (!disposed) playBtn.disabled = false; }, 600);
        submitAndShowBoard(attempt, finalScore, reached);
      }, 750);
    }

    function nameOf(row) {
      return row.displayName || row.display_name || row.username || row.userName || row.handle || row.name || "Player";
    }

    function renderBoard(board) {
      boardEl.textContent = "";
      const rows = (board && board.rows) || [];
      if (!rows.length) { boardEl.textContent = "No scores yet — you're first!"; return; }
      const myRank = board.viewerRank && board.viewerRank.rank;
      for (const row of rows.slice(0, 5)) {
        const el = document.createElement("div");
        el.className = "gd-row" + (myRank && row.rank === myRank ? " me" : "");
        const r = document.createElement("span"); r.className = "r"; r.textContent = "#" + row.rank;
        const n = document.createElement("span"); n.className = "n"; n.textContent = String(nameOf(row));
        const v = document.createElement("span"); v.className = "v"; v.textContent = String(row.value);
        el.append(r, n, v);
        boardEl.appendChild(el);
      }
    }

    async function submitAndShowBoard(attempt, finalScore, reached) {
      const opts = { scope: "global", period: "all_time", limit: 5 };
      try {
        const result = await score.submit("score", { label: finalScore + " pts · L" + reached });
        if (disposed || attempt !== run) return;
        if (result && result.isPersonalBest) bestEl.textContent = "NEW PERSONAL BEST!";
      } catch (e) {
        if (disposed || attempt !== run) return;
        statusEl.textContent = "Score couldn't be saved. You can still play again.";
      }
      try {
        statusEl.textContent = statusEl.textContent || "Updating leaderboard…";
        const board = await score.leaderboard("score", opts);
        if (disposed || attempt !== run) return;
        renderBoard(board);
        if (board.viewerRank && board.viewerRank.rank) {
          statusEl.textContent = "Your rank: #" + board.viewerRank.rank + (board.totalRanked ? " of " + board.totalRanked : "");
        } else {
          statusEl.textContent = "";
        }
      } catch (e) {
        if (disposed || attempt !== run) return;
        if (!statusEl.textContent || statusEl.textContent === "Updating leaderboard…") {
          statusEl.textContent = "Leaderboard unavailable right now.";
        }
      }
    }

    ctx.input.activate(playBtn, () => {
      if (state !== "over" || playBtn.disabled) return;
      initAudio();
      startMusic();
      startRun();
    });

    // ---------------------------------------------------------------- input
    ctx.listen(canvas, "pointerdown", (event) => {
      event.preventDefault();
      initAudio();
      const rect = canvas.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      if (state === "menu") { startMusic(); startRun(); return; }
      if (state === "play") throwBall(nx, ny);
    }, { passive: false });

    ctx.onResize(({ width, height }) => {
      renderer.setSize(width, height);
      fitCamera();
    });

    // ---------------------------------------------------------------- main loop
    let skyTick = 0;
    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      time += dt;
      updatePalette(dt);
      if ((skyTick++ & 1) === 0) paintSky();

      if (state === "play") {
        const target = Math.min(14, 7 + activeLevel * 0.6);
        speed += (target - speed) * Math.min(1, dt * 0.6);
        camZ -= speed * dt;
        distAccum += speed * dt;
        while (distAccum >= 3) { distAccum -= 3; score.add(1, { reason: "distance" }); }
      } else if (state === "over") {
        speed = Math.max(0, speed - dt * 6);
        camZ -= speed * dt;
      } else {
        camZ -= 2.2 * dt; // gentle drift behind the title
      }

      fillWorld();

      // passing through a door: new world, new theme
      while (camZ <= doorZ(nextDoorK)) {
        activateLevel(nextDoorK, state === "play");
        nextDoorK++;
      }

      // moving glass, scenery and doors
      for (const p of panels) if (p.motion && p.alive) poseAt(p);
      updateMovers();
      updateDoors();

      if (state === "play") {
        for (const p of panels) {
          if (!p.alive) continue;
          if (p.z + p.depth / 2 > camZ - 0.3 && p.z - p.depth / 2 < camZ + 1.5 && playerHits(p)) {
            crash(p);
            if (state !== "play") break;
          }
        }
        stepBalls(dt);
        updateHud();
      } else {
        stepBalls(dt);
      }

      // recycle what's behind us
      for (let i = panels.length - 1; i >= 0; i--) {
        const p = panels[i];
        if (p.z > camZ + 5) { removePanel(p); panels.splice(i, 1); continue; }
        if (p.alive && p.pulse > 0) {
          p.pulse = Math.max(0, p.pulse - dt * 6);
          p.mesh.scale.setScalar(1 + p.pulse * 0.035);
        }
      }
      for (let i = crystals.length - 1; i >= 0; i--) {
        const c = crystals[i];
        if (c.z > camZ + 4) { if (c.alive) scene.remove(c.mesh); crystals.splice(i, 1); continue; }
        if (c.alive) {
          const a = time * c.wx + c.phase;
          c.cx = c.x + Math.sin(a) * c.ax;
          c.cy = c.y + Math.sin(time * 2 + c.phase) * 0.12 + Math.cos(a * 0.8) * c.ay;
          c.mesh.position.set(c.cx, c.cy, c.z);
          c.mesh.rotation.y += dt * (1.4 + c.kind * 0.5);
          const ud = c.mesh.userData;
          if (ud.ring) ud.ring.rotation.x += dt * 1.8;
          if (ud.ring2) ud.ring2.rotation.y += dt * 2.2;
        }
      }
      for (const s of shards) {
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) { s.mesh.visible = false; continue; }
        s.vy -= 9 * dt;
        const m = s.mesh;
        m.position.x += s.vx * dt; m.position.y += s.vy * dt; m.position.z += s.vz * dt;
        if (m.position.y < 0.05) { m.position.y = 0.05; s.vy *= -0.3; s.vx *= 0.8; s.vz *= 0.8; }
        m.rotation.x += s.rx * dt; m.rotation.y += s.ry * dt; m.rotation.z += s.rz * dt;
        m.scale.setScalar(s.size * Math.min(1, s.life / 0.4));
      }
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i].z0 - CH > camZ + 14) { releaseChunk(chunks[i]); chunks.splice(i, 1); }
      }

      // camera: gentle sway + crash shake
      shake = Math.max(0, shake - dt * 2.4);
      const sway = Math.sin(time * 0.7) * 0.12;
      camera.position.set(
        sway + (Math.random() - 0.5) * shake * 0.35,
        CAM_Y + Math.sin(time * 1.1) * 0.05 + (Math.random() - 0.5) * shake * 0.3,
        camZ
      );
      camera.rotation.z = Math.sin(time * 0.5) * 0.01 + (Math.random() - 0.5) * shake * 0.02;
      sky.position.set(camera.position.x, 0, camZ);
      sun.position.set(-4, 9, camZ + 5);
      sun.target.position.set(0, 0, camZ - 10);
      sun.target.updateMatrixWorld();

      const centerZ = camZ - FLOOR_LEN * 0.4;
      floor.position.set(0, 0, centerZ);
      gridTex.offset.y = -centerZ / TILE;
    }

    function render() { renderer.render(scene, camera); }

    ctx.game.loop({ maxDeltaMs: 50, update, render });

    ctx.onDestroy(() => {
      disposed = true;
      run += 1;
      try { ctx.music.stop({ fadeOutMs: 200 }); } catch (e) {}
      try { if (ac) ac.close(); } catch (e) {}
      try {
        for (const p of panels) removePanel(p);
        for (const d of doors) removeDoor(d);
        geoCache.forEach(e => { e.geo.dispose(); e.edges.dispose(); });
        glassCache.forEach(e => e.mat.dispose());
        Object.keys(texMaps).forEach(k => texMaps[k].dispose());
        [ballGeo, shardGeo, skyGeo, unitBox, unitCone, gCone, gOcta, gIco, gDodeca, gSpike, gRing].forEach(g => g.dispose());
        [ballMat, floorMat, skyMat, boxMat, glowBoxMat, coneMat, crackMat, rodMat, ringMat].forEach(m => m.dispose());
        crystalMats.forEach(m => m.dispose());
        edgeMats.forEach(m => m.dispose());
        shardMats.forEach(m => m.dispose());
        [boxPool, glowPool, conePool].forEach(p => p.mesh.dispose());
        gridTex.dispose();
        floor.geometry.dispose();
        renderer.dispose();
      } catch (e) {}
    });

    // first visible frame (title over the drifting first world)
    activateLevel(0, false);
    fillWorld();
    updatePalette(1);
    update(16);
    render();
    ctx.platform.ready();
  }
};
