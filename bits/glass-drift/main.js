window.plethoraBit = {
  meta: {
    title: "Glass Drift",
    runtime: "plethora-bit@2",
    tags: ["arcade", "3d", "relaxing"],
    permissions: ["audio", "backgroundMusic", "haptics"]
  },

  async init(ctx) {
    // ---------------------------------------------------------------- constants
    const HALF_W = 4;            // corridor half width
    const CEIL = 5;              // corridor height
    const CAM_Y = 1.7;
    const START_BALLS = 25;
    const CRASH_COST = 10;
    const CRYSTAL_BALLS = 2;
    const BALL_R = 0.22;
    const BALL_SPEED = 40;
    const BALL_GRAVITY = 4;
    const MAX_BALLS_LIVE = 16;
    const SHARD_COUNT = 220;
    const BLOCKS_PER_STAGE = 8;
    const VIEW_DIST = 85;
    const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];

    const PALETTES = [
      { bg: 0x1b1633, tints: [0x9ad8ff, 0xc7a6ff, 0xffb3e6], crystal: 0xff8fd0, floor: 0x2a2050, glow: 0xb69cff },
      { bg: 0x0c2530, tints: [0x8ff5e0, 0x9ad0ff, 0xd0f7a8], crystal: 0xffe08a, floor: 0x123b48, glow: 0x7ff0d4 },
      { bg: 0x2b1524, tints: [0xffb0b0, 0xffd6a5, 0xffa6d9], crystal: 0x9ffcff, floor: 0x40203a, glow: 0xffa0b8 },
      { bg: 0x0c1c3a, tints: [0x7fb2ff, 0x9fe3ff, 0xb9a3ff], crystal: 0xffc2f0, floor: 0x142c58, glow: 0x88b8ff }
    ];

    // ---------------------------------------------------------------- surfaces + HUD (drawn first, never blank)
    const bgRoot = ctx.createRoot({
      layer: "background",
      input: "passthrough",
      style: "background:linear-gradient(#241c45,#0d0a1f)"
    });
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    const root = ctx.createRoot({
      layer: "overlay",
      input: "passthrough",
      style: "font-family:'Nunito Sans',system-ui,sans-serif;color:#f4f0ff;user-select:none;-webkit-user-select:none"
    });
    root.innerHTML =
      '<style>' +
      '.gd-top{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;justify-content:space-between;align-items:flex-start;padding:0 14px;pointer-events:none}' +
      '.gd-balls{font-size:20px;font-weight:700;letter-spacing:.5px;text-shadow:0 0 10px rgba(160,200,255,.7)}' +
      '.gd-balls span{display:inline-block;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#a9c4ff 60%,#6f86d6);margin-right:7px;vertical-align:-1px;box-shadow:0 0 8px #9ab8ff}' +
      '.gd-balls.low{color:#ff9fb2}' +
      '.gd-mid{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 8px);text-align:center;pointer-events:none}' +
      '.gd-score{font-size:34px;font-weight:700;text-shadow:0 0 14px rgba(200,170,255,.8)}' +
      '.gd-streak{font-size:13px;font-weight:700;letter-spacing:2px;color:#ffe9a8;min-height:16px;text-shadow:0 0 8px rgba(255,220,140,.7)}' +
      '.gd-btn{pointer-events:auto;border:1px solid rgba(190,170,255,.5);background:rgba(30,22,64,.55);color:#e9deff;border-radius:50%;width:34px;height:34px;font-size:16px;line-height:32px;text-align:center;padding:0}' +
      '.gd-panel{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:min(86vw,340px);text-align:center;pointer-events:none}' +
      '.gd-title{font-size:38px;font-weight:700;letter-spacing:3px;text-shadow:0 0 18px rgba(170,150,255,.9),0 0 3px #fff}' +
      '.gd-sub{font-size:15px;letter-spacing:3px;color:#bfe3ff;margin-top:14px;animation:gdp 1.8s ease-in-out infinite}' +
      '.gd-hint{font-size:12px;color:#c9c0e8;margin-top:12px;line-height:1.7;opacity:.85}' +
      '.gd-over{background:rgba(22,16,50,.72);border:1px solid rgba(180,160,255,.35);border-radius:18px;padding:16px 14px 14px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
      '.gd-over .gd-title{font-size:22px;letter-spacing:2px}' +
      '.gd-final{font-size:44px;font-weight:700;margin:2px 0;text-shadow:0 0 16px rgba(255,200,240,.7)}' +
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
      '@keyframes gdp{0%,100%{opacity:.45}50%{opacity:1}}' +
      '</style>' +
      '<div class="gd-top">' +
      '<div class="gd-balls" id="gdBalls"><span></span>25</div>' +
      '<button class="gd-btn" id="gdMute" aria-label="Toggle sound">♪</button>' +
      '</div>' +
      '<div class="gd-mid"><div class="gd-score" id="gdScore">0</div><div class="gd-streak" id="gdStreak"></div></div>' +
      '<div class="gd-panel" id="gdMenu">' +
      '<div class="gd-title">GLASS DRIFT</div>' +
      '<div class="gd-sub">TAP TO START</div>' +
      '<div class="gd-hint">Tap to throw balls at the glass<br>Crystals give +2 balls · crashing costs 10</div>' +
      '</div>' +
      '<div class="gd-panel gd-over" id="gdOver" style="display:none">' +
      '<div class="gd-title">SHATTERED</div>' +
      '<div class="gd-final" id="gdFinal">0</div>' +
      '<div class="gd-best" id="gdBest"></div>' +
      '<div class="gd-board" id="gdBoard"></div>' +
      '<div class="gd-status" id="gdStatus"></div>' +
      '<button class="gd-play" id="gdPlay">PLAY AGAIN</button>' +
      '</div>';

    const ballsEl = root.querySelector("#gdBalls");
    const scoreEl = root.querySelector("#gdScore");
    const streakEl = root.querySelector("#gdStreak");
    const muteBtn = root.querySelector("#gdMute");
    const menuEl = root.querySelector("#gdMenu");
    const overEl = root.querySelector("#gdOver");
    const finalEl = root.querySelector("#gdFinal");
    const bestEl = root.querySelector("#gdBest");
    const boardEl = root.querySelector("#gdBoard");
    const statusEl = root.querySelector("#gdStatus");
    const playBtn = root.querySelector("#gdPlay");

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
    let blockIndex = 0;
    let nextBlockZ = -22;
    let stage = 0;
    let overAt = 0;
    let lastThrow = 0;
    let shake = 0;
    let smashed = 0;
    let sessionBest = 0;
    let shownScore = -1;
    let shownBalls = -1;
    let sfxOn = true;
    let musicHandle = null;
    let musicStarted = false;

    // ---------------------------------------------------------------- audio (soft synthesized SFX; music via ctx.music)
    let ac = null, master = null, noiseBuf = null, lastShatterAt = 0;

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

    function sfxShatter(size) {
      if (!audioOk()) return;
      const nowMs = performance.now();
      if (nowMs - lastShatterAt < 35) return;
      lastShatterAt = nowMs;
      try {
        const t = ac.currentTime;
        const s = Math.min(1.4, 0.55 + size * 0.25);
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = 0.9 + Math.random() * 0.4;
        const hp = ac.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 2400;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.42 * s, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        src.connect(hp); hp.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.6); src.stop(t + 0.5);
        const tinkles = 6 + Math.round(size * 3);
        for (let i = 0; i < tinkles; i++) {
          tone(2400 + Math.random() * 4800, t + Math.random() * 0.3, 0.07 + Math.random() * 0.14, 0.035 * s, "sine");
        }
        tone(180 + Math.random() * 60, t, 0.12, 0.12 * s, "triangle"); // soft body of the crack
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

    function sfxCrystal() {
      if (!audioOk()) return;
      try {
        const t = ac.currentTime + 0.01;
        [0, 2, 4, 6].forEach((n, i) => tone(NOTES[n] * 1.5, t + i * 0.07, 0.6, 0.09, "sine"));
        tone(NOTES[8] * 1.5, t + 0.3, 0.7, 0.05, "triangle");
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
        musicHandle = ctx.music.play({
          preset: "ambient",
          volume: 0.38,
          tempo: 64,
          intensity: 0.2,
          scale: "pentatonic",
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
    const curBg = new THREE.Color(PALETTES[0].bg);
    const curFloor = new THREE.Color(PALETTES[0].floor);
    const curCrystal = new THREE.Color(PALETTES[0].crystal);
    const curGlow = new THREE.Color(PALETTES[0].glow);
    const curTints = PALETTES[0].tints.map(c => new THREE.Color(c));
    const tgtBg = new THREE.Color(), tgtFloor = new THREE.Color(), tgtCrystal = new THREE.Color(), tgtGlow = new THREE.Color();
    const tgtTints = curTints.map(c => c.clone());
    scene.background = curBg;
    scene.fog = new THREE.Fog(curBg.getHex(), 14, VIEW_DIST - 8);

    const camera = new THREE.PerspectiveCamera(70, ctx.width / ctx.height, 0.1, 150);
    function fitCamera() {
      const aspect = ctx.width / Math.max(1, ctx.height);
      camera.fov = aspect < 0.8 ? 80 : aspect < 1.2 ? 68 : 58;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    fitCamera();
    camera.position.set(0, CAM_Y, 0);

    scene.add(new THREE.AmbientLight(0x8a80c0, 0.9));
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x30204a, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    const camLight = new THREE.PointLight(0xffffff, 1.0, 26);
    scene.add(camLight);

    // floor with a world-fixed soft grid texture
    function makeGridTexture() {
      const N = 32, data = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const edge = x < 2 || y < 2;
        const i = (y * N + x) * 4;
        const v = edge ? 150 : 255;
        data[i] = v; data[i + 1] = v; data[i + 2] = Math.min(255, v + 20); data[i + 3] = 255;
      }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    }
    const FLOOR_LEN = 200, TILE = 2;
    const gridTex = makeGridTexture();
    gridTex.repeat.set(HALF_W * 2 / TILE, FLOOR_LEN / TILE);
    const floorMat = new THREE.MeshStandardMaterial({ color: curFloor, map: gridTex, roughness: 0.55, metalness: 0.25 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FLOOR_LEN), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const wallMat = new THREE.MeshBasicMaterial({ color: curFloor, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const wallGeo = new THREE.PlaneGeometry(FLOOR_LEN, CEIL);
    const wallL = new THREE.Mesh(wallGeo, wallMat);
    wallL.rotation.y = Math.PI / 2; wallL.position.set(-HALF_W, CEIL / 2, 0);
    const wallR = new THREE.Mesh(wallGeo, wallMat);
    wallR.rotation.y = -Math.PI / 2; wallR.position.set(HALF_W, CEIL / 2, 0);
    scene.add(wallL, wallR);

    // glowing light strips on the walls give a sense of motion
    const STRIP_SPACING = 6, STRIPS_PER_SIDE = 16;
    const stripMat = new THREE.MeshBasicMaterial({ color: curGlow });
    const stripGeo = new THREE.BoxGeometry(0.08, CEIL, 0.08);
    const strips = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < STRIPS_PER_SIDE; i++) {
        const m = new THREE.Mesh(stripGeo, stripMat);
        m.position.set(s * (HALF_W - 0.05), CEIL / 2, -i * STRIP_SPACING);
        scene.add(m);
        strips.push(m);
      }
    }

    // drifting dust motes
    const DUST = 140;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() * 2 - 1) * (HALF_W + 1);
      dustPos[i * 3 + 1] = Math.random() * CEIL;
      dustPos[i * 3 + 2] = -Math.random() * 65;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false });
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    scene.add(dust);

    // glass materials (3 shared tints) + edge lines
    const glassMats = curTints.map(c => new THREE.MeshPhongMaterial({
      color: c, transparent: true, opacity: 0.5, specular: 0xffffff, shininess: 110,
      side: THREE.DoubleSide, depthWrite: false
    }));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    const shardMats = curTints.map(c => new THREE.MeshPhongMaterial({
      color: c, transparent: true, opacity: 0.7, specular: 0xffffff, shininess: 120, side: THREE.DoubleSide, depthWrite: false
    }));
    const boxCache = new Map();
    function panelGeo(w, h) {
      const key = w.toFixed(2) + "x" + h.toFixed(2);
      let e = boxCache.get(key);
      if (!e) {
        const geo = new THREE.BoxGeometry(w, h, 0.14);
        e = { geo, edges: new THREE.EdgesGeometry(geo) };
        boxCache.set(key, e);
      }
      return e;
    }

    // balls
    const ballGeo = new THREE.SphereGeometry(BALL_R, 14, 10);
    const ballMat = new THREE.MeshPhongMaterial({ color: 0xe8f0ff, emissive: 0x5a78d8, emissiveIntensity: 0.6, specular: 0xffffff, shininess: 140 });
    const ballPool = [];
    for (let i = 0; i < MAX_BALLS_LIVE; i++) {
      const mesh = new THREE.Mesh(ballGeo, ballMat);
      mesh.visible = false;
      scene.add(mesh);
      ballPool.push({ mesh, alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, hit: false });
    }

    // crystals
    const crystalGeo = new THREE.ConeGeometry(0.34, 0.75, 4);
    const crystalMat = new THREE.MeshPhongMaterial({ color: curCrystal, emissive: curCrystal, emissiveIntensity: 0.55, flatShading: true, shininess: 120, specular: 0xffffff });
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

    // ---------------------------------------------------------------- world generation
    function addPanel(x, y, z, w, h) {
      const e = panelGeo(w, h);
      const tint = Math.floor(Math.random() * 3);
      const mesh = new THREE.Mesh(e.geo, glassMats[tint]);
      mesh.add(new THREE.LineSegments(e.edges, edgeMat));
      mesh.position.set(x, y, z);
      scene.add(mesh);
      panels.push({ mesh, x, y, z, w, h, tint, alive: true });
    }

    function addCrystal(x, y, z) {
      const mesh = new THREE.Mesh(crystalGeo, crystalMat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      crystals.push({ mesh, x, y, z, alive: true, phase: Math.random() * 6 });
    }

    function spawnBlock(z) {
      const b = blockIndex++;
      const roll = Math.random();
      const tier = Math.min(4, Math.floor(b / 3));
      let kind = "wall";
      if (b >= 2) {
        const opts = ["wall", "grid"];
        if (tier >= 1) opts.push("pillars", "hoops");
        if (tier >= 2) opts.push("rings", "hoops");
        if (tier >= 3) opts.push("rings", "grid", "pillars");
        kind = opts[Math.floor(roll * opts.length)];
      }
      if (kind === "wall") {
        addPanel(0, CEIL / 2, z, HALF_W * 2 - 0.4, CEIL - 0.2);
      } else if (kind === "grid") {
        for (const sx of [-1, 1]) for (const sy of [0, 1]) addPanel(sx * 1.95, 1.2 + sy * 2.4, z, 3.6, 2.3);
      } else if (kind === "pillars") {
        for (const px of [-2.7, 0, 2.7]) addPanel(px, CEIL / 2, z, 1.4, CEIL - 0.2);
      } else if (kind === "rings") {
        for (let i = 0; i < 3; i++) addPanel(0, 1.8, z - i * 3, 4.6 - i * 0.6, 3.1);
      } else {
        addPanel(0, 1.7, z, 2.4, 2.4);
        for (let i = 0; i < 3; i++) {
          addPanel((Math.random() * 2 - 1) * 2.6, 0.9 + Math.random() * 2.8, z - 2 - i * 2.2, 1.8, 1.8);
        }
      }
      // crystals ahead of the block so ammo stays sustainable
      const count = b < 3 ? 3 : Math.random() < 0.7 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        addCrystal((Math.random() * 2 - 1) * 2.4, 1.1 + Math.random() * 2.4, z + 4 + i * 1.6 + Math.random());
      }
      if (b > 0 && b % BLOCKS_PER_STAGE === 0) setStage(Math.floor(b / BLOCKS_PER_STAGE));
    }

    function currentSpacing() { return Math.max(10, 14 - (-camZ) / 250); }

    function setStage(n) {
      stage = n;
      const p = PALETTES[n % PALETTES.length];
      tgtBg.set(p.bg); tgtFloor.set(p.floor); tgtCrystal.set(p.crystal); tgtGlow.set(p.glow);
      p.tints.forEach((c, i) => tgtTints[i].set(c));
      if (state === "play") {
        ctx.platform.milestone("stage_" + (n + 1));
        setMusicIntensity(Math.min(0.5, 0.2 + n * 0.06));
        popText("STAGE " + (n + 1), ctx.width / 2, ctx.height * 0.3, "#bfe3ff", 22);
      }
    }

    function updatePalette(dt) {
      const k = 1 - Math.exp(-dt * 0.9);
      curBg.lerp(tgtBg, k);
      curFloor.lerp(tgtFloor, k);
      curCrystal.lerp(tgtCrystal, k);
      curGlow.lerp(tgtGlow, k);
      scene.fog.color.copy(curBg);
      floorMat.color.copy(curFloor);
      wallMat.color.copy(curFloor);
      stripMat.color.copy(curGlow);
      crystalMat.color.copy(curCrystal);
      crystalMat.emissive.copy(curCrystal);
      for (let i = 0; i < 3; i++) {
        curTints[i].lerp(tgtTints[i], k);
        glassMats[i].color.copy(curTints[i]);
        shardMats[i].color.copy(curTints[i]);
      }
    }

    function resetWorld() {
      for (const p of panels) scene.remove(p.mesh);
      panels.length = 0;
      for (const c of crystals) scene.remove(c.mesh);
      crystals.length = 0;
      for (const b of ballPool) { b.alive = false; b.mesh.visible = false; }
      for (const s of shards) { s.life = 0; s.mesh.visible = false; }
      camZ = 0; blockIndex = 0; nextBlockZ = -22; stage = 0;
      setStagePalette(0);
    }

    function setStagePalette(n) {
      const p = PALETTES[n % PALETTES.length];
      tgtBg.set(p.bg); tgtFloor.set(p.floor); tgtCrystal.set(p.crystal); tgtGlow.set(p.glow);
      p.tints.forEach((c, i) => tgtTints[i].set(c));
    }

    // ---------------------------------------------------------------- effects
    function popText(text, x, y, color, size) {
      try { ctx.fx.floatText({ text, x, y, color, size: size || 20, rise: 46, durationMs: 850 }); } catch (e) {}
    }

    function project(x, y, z) {
      tmpV.set(x, y, z).project(camera);
      return { x: (tmpV.x * 0.5 + 0.5) * ctx.width, y: (-tmpV.y * 0.5 + 0.5) * ctx.height };
    }

    function spawnShards(cx, cy, cz, w, h, dirx, diry, dirz, tint) {
      const area = w * h;
      const n = Math.max(10, Math.min(34, Math.round(area * 3.2)));
      const size = Math.max(0.22, Math.min(0.7, Math.sqrt(area) * 0.16));
      for (let i = 0; i < n; i++) {
        const s = shards[shardCursor];
        shardCursor = (shardCursor + 1) % SHARD_COUNT;
        const px = cx + (Math.random() - 0.5) * w;
        const py = cy + (Math.random() - 0.5) * h;
        s.mesh.material = shardMats[tint];
        s.mesh.position.set(px, py, cz);
        s.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        s.size = size * (0.5 + Math.random());
        s.max = s.life = 1.1 + Math.random() * 0.9;
        const ox = (px - cx) * 0.9, oy = (py - cy) * 0.9;
        s.vx = ox + dirx * 0.12 + (Math.random() - 0.5) * 2;
        s.vy = oy + diry * 0.1 + Math.random() * 2;
        s.vz = dirz * 0.16 + (Math.random() - 0.5) * 3 - speed * 0.5;
        s.rx = (Math.random() - 0.5) * 12; s.ry = (Math.random() - 0.5) * 12; s.rz = (Math.random() - 0.5) * 12;
        s.mesh.scale.setScalar(s.size);
        s.mesh.visible = true;
      }
    }

    // ---------------------------------------------------------------- gameplay actions
    function multiplier() { return 1 + Math.min(4, Math.floor(streak / 5)); }

    function shatterPanel(p, bx, by, bz, dx, dy, dz, byBall) {
      p.alive = false;
      scene.remove(p.mesh);
      spawnShards(p.x, p.y, p.z, p.w, p.h, dx, dy, dz, p.tint);
      sfxShatter(Math.sqrt(p.w * p.h) * 0.6);
      smashed++;
      if (byBall) {
        const pts = 10 * multiplier();
        score.add(pts, { reason: "glass" });
        const pos = project(p.x, p.y, p.z);
        popText("+" + pts, pos.x, pos.y, "#ffe9a8", 20 + multiplier() * 2);
        sfxPoint(Math.min(8, streak));
        haptic("light");
        try { ctx.music.duck(0.3, 250); } catch (e) {}
      }
    }

    function onBallHitSomething(ball) {
      if (!ball.hit) {
        ball.hit = true;
        streak++;
        if (streak === 10) {
          popText("MULTIBALL!", ctx.width / 2, ctx.height * 0.36, "#ffe9a8", 26);
          haptic("success");
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
        b.alive = true; b.hit = false; b.life = 0;
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
        if (streak >= 5) popText("streak lost", ctx.width / 2, ctx.height * 0.5, "#c9c0e8", 14);
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
          // corridor bounds
          if (b.x < -HALF_W + BALL_R) { b.x = -HALF_W + BALL_R; b.vx = Math.abs(b.vx) * 0.6; }
          else if (b.x > HALF_W - BALL_R) { b.x = HALF_W - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; }
          if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy) * 0.5; b.vx *= 0.92; }
          else if (b.y > CEIL - BALL_R) { b.y = CEIL - BALL_R; b.vy = -Math.abs(b.vy) * 0.5; }
          // glass
          for (const p of panels) {
            if (!p.alive) continue;
            if (Math.abs(b.z - p.z) < 0.07 + BALL_R &&
                Math.abs(b.x - p.x) < p.w / 2 + BALL_R * 0.5 &&
                Math.abs(b.y - p.y) < p.h / 2 + BALL_R * 0.5) {
              onBallHitSomething(b);
              shatterPanel(p, b.x, b.y, b.z, b.vx, b.vy, b.vz, true);
              b.vz *= 0.82; b.vx *= 0.9; // glass slows the ball a little; it can punch through several panes
            }
          }
          // crystals
          for (const c of crystals) {
            if (!c.alive) continue;
            const dx = b.x - c.x, dy = b.y - c.y, dz = b.z - c.z;
            if (dx * dx + dy * dy + dz * dz < (0.5 + BALL_R) * (0.5 + BALL_R)) {
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
      balls += CRYSTAL_BALLS;
      const pts = 25 * multiplier();
      score.add(pts, { reason: "crystal" });
      const pos = project(c.x, c.y, c.z);
      popText("+" + CRYSTAL_BALLS + " balls", pos.x, pos.y, "#bfe3ff", 20);
      sfxCrystal();
      haptic("medium");
      spawnShards(c.x, c.y, c.z, 0.7, 0.7, 0, 0, -1, 1);
    }

    function crash(p) {
      shatterPanel(p, 0, 0, 0, 0, 0, -6, false);
      balls = Math.max(0, balls - CRASH_COST);
      streak = 0;
      shake = 1;
      sfxThud();
      haptic("error");
      try { ctx.fx.flash({ color: "#ff4d6d", opacity: 0.3, durationMs: 300 }); } catch (e) {}
      popText("-" + CRASH_COST, ctx.width / 2, ctx.height * 0.42, "#ff9fb2", 26);
      if (balls <= 0) endRun();
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
    function startRun() {
      run += 1;
      resetWorld();
      updatePalette(10);
      score.reset();
      balls = START_BALLS; streak = 0; smashed = 0; distAccum = 0; time = 0;
      speed = 6.5; shake = 0;
      state = "play";
      menuEl.style.display = "none";
      overEl.style.display = "none";
      shownScore = -1; shownBalls = -1;
      while (nextBlockZ > camZ - VIEW_DIST) { spawnBlock(nextBlockZ); nextBlockZ -= currentSpacing(); }
      setMusicIntensity(0.2);
      ctx.platform.start();
      updateHud();
    }

    function endRun() {
      if (state !== "play") return;
      state = "over";
      overAt = performance.now();
      const attempt = run;
      const finalScore = Math.round(score.value);
      sfxOver();
      setMusicIntensity(0.08);
      ctx.platform.complete({ score: finalScore });
      sessionBest = Math.max(sessionBest, finalScore);
      setTimeout(() => {
        if (disposed || attempt !== run) return;
        finalEl.textContent = String(finalScore);
        bestEl.textContent = "";
        boardEl.textContent = "";
        statusEl.textContent = "Saving score…";
        overEl.style.display = "block";
        playBtn.disabled = true;
        setTimeout(() => { if (!disposed) playBtn.disabled = false; }, 600); // guard against the tap that crashed you
        submitAndShowBoard(attempt, finalScore);
      }, 750);
    }

    function nameOf(row) {
      return row.displayName || row.display_name || row.username || row.userName || row.handle || row.name || "Player";
    }

    function renderBoard(board, finalScore) {
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

    async function submitAndShowBoard(attempt, finalScore) {
      const opts = { scope: "global", period: "all_time", limit: 5 };
      let result = null;
      try {
        result = await score.submit("score", { label: finalScore + " pts" });
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
        renderBoard(board, finalScore);
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
    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      time += dt;
      updatePalette(dt);

      if (state === "play") {
        speed = Math.min(11, 6.5 + (-camZ) / 140);
        camZ -= speed * dt;
        distAccum += speed * dt;
        while (distAccum >= 3) { distAccum -= 3; score.add(1, { reason: "distance" }); }
      } else if (state === "over") {
        speed = Math.max(0, speed - dt * 6);
        camZ -= speed * dt;
      } else {
        camZ -= 2.2 * dt; // gentle drift behind the title
      }

      while (nextBlockZ > camZ - VIEW_DIST) { spawnBlock(nextBlockZ); nextBlockZ -= currentSpacing(); }

      if (state === "play") {
        const px = camera.position.x;
        for (const p of panels) {
          if (!p.alive) continue;
          if (p.z > camZ - 0.3 && p.z < camZ + 1.5 &&
              Math.abs(px - p.x) < p.w / 2 + 0.5 &&
              Math.abs(CAM_Y - p.y) < p.h / 2 + 0.45) {
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
        if (panels[i].z > camZ + 5) { scene.remove(panels[i].mesh); panels.splice(i, 1); }
      }
      for (let i = crystals.length - 1; i >= 0; i--) {
        const c = crystals[i];
        if (c.z > camZ + 4) { if (c.alive) scene.remove(c.mesh); crystals.splice(i, 1); continue; }
        if (c.alive) {
          c.mesh.rotation.y += dt * 1.6;
          c.mesh.position.y = c.y + Math.sin(time * 2 + c.phase) * 0.12;
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

      // camera: gentle sway + crash shake
      shake = Math.max(0, shake - dt * 2.4);
      const sway = Math.sin(time * 0.7) * 0.12;
      camera.position.set(
        sway + (Math.random() - 0.5) * shake * 0.35,
        CAM_Y + Math.sin(time * 1.1) * 0.05 + (Math.random() - 0.5) * shake * 0.3,
        camZ
      );
      camera.rotation.z = Math.sin(time * 0.5) * 0.01 + (Math.random() - 0.5) * shake * 0.02;

      camLight.position.set(0, 3, camZ - 2);
      camLight.color.copy(curGlow);
      const centerZ = camZ - FLOOR_LEN * 0.4;
      floor.position.set(0, 0, centerZ);
      gridTex.offset.y = -centerZ / TILE;
      wallL.position.z = wallR.position.z = centerZ;
      for (const st of strips) {
        if (st.position.z > camZ + 6) st.position.z -= STRIPS_PER_SIDE * STRIP_SPACING;
      }
      for (let i = 0; i < DUST; i++) {
        const zi = i * 3 + 2;
        dustPos[i * 3 + 1] += Math.sin(time + i) * 0.002;
        if (dustPos[zi] > camZ + 5) {
          dustPos[zi] -= 68;
          dustPos[i * 3] = (Math.random() * 2 - 1) * (HALF_W + 1);
          dustPos[i * 3 + 1] = Math.random() * CEIL;
        } else if (dustPos[zi] < camZ - 64) {
          dustPos[zi] += 68;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    function render() { renderer.render(scene, camera); }

    ctx.game.loop({ maxDeltaMs: 50, update, render });

    ctx.onDestroy(() => {
      disposed = true;
      run += 1;
      try { ctx.music.stop({ fadeOutMs: 200 }); } catch (e) {}
      try { if (ac) ac.close(); } catch (e) {}
      try {
        boxCache.forEach(e => { e.geo.dispose(); e.edges.dispose(); });
        [ballGeo, crystalGeo, shardGeo, dustGeo, stripGeo, wallGeo].forEach(g => g.dispose());
        [ballMat, crystalMat, floorMat, wallMat, stripMat, dustMat, edgeMat].forEach(m => m.dispose());
        glassMats.forEach(m => m.dispose());
        shardMats.forEach(m => m.dispose());
        gridTex.dispose();
        floor.geometry.dispose();
        renderer.dispose();
      } catch (e) {}
    });

    // first visible frame (title over a slowly drifting glass corridor)
    update(16);
    render();
    ctx.platform.ready();
  }
};
