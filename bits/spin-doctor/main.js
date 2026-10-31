// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// SPIN DOCTOR — a kinetic precision sculpture. Tap each rotating ring to brake it
// so that every marker comes to rest on the shared vertical axis.
(function () {
  'use strict';

  // ==========================================================================
  // Pure game logic (no DOM, no three.js). Exposed for dev tests.
  // ==========================================================================
  const Logic = (function () {
    const BRAKE_S = 0.21;          // braking duration (s)
    const SPINUP_S = 0.30;         // release after a miss (s)
    const START_SPINUP_S = 0.55;   // round start spin-up (s)
    const MAX_MISSES = 3;
    const MIN_RINGS = 3;
    const ABS_MAX_RINGS = 10;

    // Signed circular difference in degrees, result in [-180, 180).
    function wrap180(a) {
      let x = ((a % 360) + 540) % 360 - 180;
      if (x === -180) x = -180; // keep half-open interval
      return x;
    }
    // Angular distance from the 12 o'clock axis (marker angle 0 = axis).
    function axisError(angle) { return Math.abs(wrap180(angle)); }

    // Brake profile: v(s) = v0 (1 - s)^2, s in [0, 1]. Displacement at s:
    // v0 T (s - s^2 + s^3 / 3). Total = v0 T / 3.
    function brakeOffset(v0, s) {
      const c = s < 0 ? 0 : s > 1 ? 1 : s;
      return v0 * BRAKE_S * (c - c * c + (c * c * c) / 3);
    }
    function brakeTravel(v0) { return v0 * BRAKE_S / 3; }

    // Tolerance tightens from ±6° toward ±2.5°.
    function tolerance(round) {
      return 2.5 + 3.5 * Math.exp(-(round - 1) / 4.5);
    }
    function ringCount(round, maxRings) {
      return Math.min(MIN_RINGS + round - 1, maxRings || ABS_MAX_RINGS);
    }

    function precisionBonus(err) {
      if (err <= 1) return 100;
      if (err <= 2) return 70;
      if (err <= 4) return 40;
      return 20;
    }
    function streakBonus(streak) {
      return streak >= 2 ? Math.min(25 * (streak - 1), 250) : 0;
    }
    function alignScore(err, streak) {
      const p = precisionBonus(err), s = streakBonus(streak);
      return { base: 100, precision: p, streak: s, total: 100 + p + s };
    }
    function flawlessBonus(n) { return 100 + 50 * n; }

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Generates one round. Ring 0 is the outermost ring.
    function generateRound(round, n, rng) {
      const r = round;
      const lo = Math.min(30 + 2.6 * (r - 1), 58);
      const hi = Math.min(84 + 5.5 * (r - 1), 128);
      const mags = [];
      if (r === 1 && n === 3) {
        mags.push(42, 61, 83);
      } else {
        // Stratified sampling keeps every ring's speed clearly distinct, and
        // avoids the simple 2:1 and 3:2 ratios that read as predictable.
        const bin = (hi - lo) / n;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let tries = 0; tries < 40; tries++) {
            m = lo + bin * (i + 0.5 + (rng() - 0.5) * 0.5);
            let ok = true;
            for (const e of mags) {
              const ratio = Math.max(m, e) / Math.min(m, e);
              if (Math.abs(ratio - 2) < 0.04 || Math.abs(ratio - 1.5) < 0.03) { ok = false; break; }
            }
            if (ok) break;
          }
          mags.push(m);
        }
        // Outer rings tend to be slower, as with real mass; later rounds shuffle.
        mags.sort((a, b) => a - b);
        const swaps = r >= 5 ? Math.min(n, Math.floor((r - 3) / 2)) : 0;
        for (let i = 0; i < swaps; i++) {
          const a = Math.floor(rng() * n), b = Math.floor(rng() * n);
          const t = mags[a]; mags[a] = mags[b]; mags[b] = t;
        }
      }
      // Directions: alternate, with occasional same-direction neighbours later.
      const signs = [];
      let s = r === 1 ? 1 : (rng() < 0.5 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        signs.push(s);
        if (!(r >= 3 && rng() < Math.min(0.12 + 0.03 * r, 0.35))) s = -s;
      }
      if (signs.every(x => x === signs[0])) signs[n - 1] = -signs[0];
      // Starting marker positions: away from the axis, separated from neighbours.
      // Later rounds start markers just past the axis, so each needs nearly a
      // full revolution of observation first.
      const starts = [];
      for (let i = 0; i < n; i++) {
        let a = 0, tries = 0;
        do {
          tries++;
          if (r >= 4 && rng() < Math.min(0.15 + 0.04 * r, 0.5)) {
            a = signs[i] * (40 + rng() * 40); // just past the axis in its travel direction
          } else {
            a = (rng() * 2 - 1) * 180;
          }
        } while (tries < 60 && (Math.abs(wrap180(a)) < 38 ||
          (i > 0 && Math.abs(wrap180(a - starts[i - 1])) < 24)));
        starts.push(wrap180(a));
      }
      // Speed breathing (less predictable timing) from round 4.
      const wobble = [];
      for (let i = 0; i < n; i++) {
        if (r >= 4 && rng() < Math.min(0.18 * (r - 3), 0.7)) {
          // Keep the peak speed bounded so the acceptance window stays fair.
          const a = Math.min(0.06 + Math.min(0.14, 0.018 * (r - 4)), Math.max(0, 132 / mags[i] - 1));
          wobble.push({ a, f: 0.22 + rng() * 0.33, p: rng() * Math.PI * 2 });
        } else wobble.push({ a: 0, f: 0, p: 0 });
      }
      const rings = [];
      for (let i = 0; i < n; i++) rings.push({ speed: mags[i] * signs[i], start: starts[i], wobble: wobble[i] });
      return { round: r, tolerance: tolerance(r), rings };
    }

    // Instantaneous velocity of a free-spinning ring at time t (s).
    function spinVelocity(base, wob, t) {
      return wob && wob.a ? base * (1 + wob.a * Math.sin(2 * Math.PI * wob.f * t + wob.p)) : base;
    }

    return {
      BRAKE_S, SPINUP_S, START_SPINUP_S, MAX_MISSES, MIN_RINGS, ABS_MAX_RINGS,
      wrap180, axisError, brakeOffset, brakeTravel, tolerance, ringCount,
      precisionBonus, streakBonus, alignScore, flawlessBonus, mulberry32,
      generateRound, spinVelocity
    };
  })();

  if (typeof window !== 'undefined' && window.__SD_DEV) window.__SD_LOGIC = Logic;

  // ==========================================================================
  // The Bit
  // ==========================================================================
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const fmt = n => Math.round(n).toLocaleString('en-US');

  const STORE_KEY = 'spin-doctor.v1';

  // Ring materials, assigned by creation order (ring 0 = outermost).
  const MATERIALS = [
    { name: 'aluminium', color: 0xcfd3d5, metalness: 1.0, roughness: 0.42, brushed: true, env: 1.0 },
    { name: 'glass', color: 0xe6eef0, metalness: 0.0, roughness: 0.4, glass: true, opacity: 0.74, env: 1.5, glow: 0x161b1d },
    { name: 'porcelain', color: 0xebe5dc, metalness: 0.0, roughness: 0.42, clearcoat: 0.7, env: 0.9 },
    { name: 'resin', color: 0xdcd6cb, metalness: 0.0, roughness: 0.34, glass: true, opacity: 0.86, sheen: 0.6, env: 1.1, glow: 0x14120f },
    { name: 'satin silver', color: 0xdedcd8, metalness: 1.0, roughness: 0.3, brushed: true, env: 1.05 },
    { name: 'champagne', color: 0xd8c8ac, metalness: 1.0, roughness: 0.3, brushed: true, env: 1.0 },
    { name: 'pale grey', color: 0xb8bbbc, metalness: 0.0, roughness: 0.55, clearcoat: 0.35, env: 0.9 },
    { name: 'smoke glass', color: 0xd3dcdf, metalness: 0.0, roughness: 0.38, glass: true, opacity: 0.74, env: 1.4, glow: 0x12161a },
    { name: 'bone', color: 0xe4ddd0, metalness: 0.0, roughness: 0.5, clearcoat: 0.5, env: 0.9 },
    { name: 'pewter', color: 0xaeb0b0, metalness: 1.0, roughness: 0.42, brushed: true, env: 1.0 }
  ];

  const COLORS = {
    markerIdle: 0xf3eee5,
    markerLock: 0xbfe9f2,
    markerMiss: 0xd8b08a,
    cyan: 0x9fdcea,
    warm: 0xc89a70
  };

  window.plethoraBit = {
    meta: {
      title: 'SPIN DOCTOR',
      runtime: 'plethora-bit@2',
      tags: ['precision', 'timing', 'puzzle', 'kinetic', 'minimal', 'endless'],
      permissions: ['audio', 'haptics', 'storage']
    },

    async init(ctx) {
      let destroyed = false;
      ctx.onDestroy(() => { destroyed = true; });

      // ---------------------------------------------------------------- state
      const stats = loadStats();
      const G = {
        phase: 'intro',     // intro | transition | play | complete | over
        paused: false,
        round: 0,
        score: 0,
        misses: 0,
        roundMisses: 0,
        streak: 0,
        runBestStreak: 0,
        runBestPrecision: null,
        aligned: 0,
        tol: 6,
        maxRings: Logic.ABS_MAX_RINGS,
        simTime: 0,
        lastUpdatePerf: 0,
        phaseT: 0,
        runId: 0,
        firstAlignDone: false,
        introT: 0,
        completeT: 0,
        overT: 0,
        transitionT: 0,
        transitionDur: 0.95,
        newBest: false,
        hintMissT: -1
      };
      const rings = [];
      let roundSpec = null;
      let rng = Logic.mulberry32((Date.now() ^ 0x5f3759df) >>> 0);

      function loadStats() {
        const base = { best: 0, bestRound: 0, bestStreak: 0, bestPrecision: null, lastScore: 0, released: false, muted: false };
        try {
          if (!ctx.capabilities || !ctx.capabilities.storage) return base;
          const v = ctx.storage.get(STORE_KEY);
          if (v && typeof v === 'object') return Object.assign(base, v);
        } catch (e) { /* storage unavailable */ }
        return base;
      }
      function saveStats() {
        try { if (ctx.capabilities && ctx.capabilities.storage) ctx.storage.set(STORE_KEY, stats); } catch (e) { }
      }

      // ------------------------------------------------------------- haptics
      function haptic(kind) {
        try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) { }
      }

      // -------------------------------------------------------------- score
      let scoreTrack = null;
      try { scoreTrack = ctx.game.score(); } catch (e) { scoreTrack = null; }
      function setScore(v) {
        G.score = v;
        try { if (scoreTrack) scoreTrack.set(v); } catch (e) { }
      }

      // ================================================================ HUD
      const hud = ctx.createRoot({ layer: 'overlay', input: 'passthrough' });
      hud.innerHTML = HUD_HTML;
      const $ = sel => hud.querySelector(sel);
      const el = {
        top: $('.sd-top'), mark: $('.sd-mark'), score: $('.sd-score'), meta: $('.sd-meta'),
        round: $('.sd-round'), aligned: $('.sd-aligned'), misses: $('.sd-misses'), streak: $('.sd-streak'),
        sound: $('.sd-sound'), pause: $('.sd-pause'), hint: $('.sd-hint'), readout: $('.sd-readout'),
        intro: $('.sd-intro'), introBest: $('.sd-intro-best'), play: $('.sd-play'),
        over: $('.sd-over'), overScore: $('.sd-over-score'), overRound: $('.sd-over-round'),
        overPrec: $('.sd-over-prec'), overStreak: $('.sd-over-streak'), overBest: $('.sd-over-best'),
        overRank: $('.sd-over-rank'), overBoard: $('.sd-over-board'), restart: $('.sd-restart'),
        pauseLayer: $('.sd-paused'), resume: $('.sd-resume'), pauseRestart: $('.sd-pause-restart'),
        flash: $('.sd-flash'), fail: $('.sd-fail')
      };
      [el.sound, el.pause, el.play, el.restart, el.resume, el.pauseRestart].forEach(b => { b.style.pointerEvents = 'auto'; });

      function refreshSoundIcon() {
        el.sound.classList.toggle('is-muted', !!stats.muted);
        el.sound.setAttribute('aria-label', stats.muted ? 'Sound off' : 'Sound on');
      }
      refreshSoundIcon();

      let displayScore = 0;
      function renderHud() {
        const n = rings.filter(r => r.alive).length;
        el.round.textContent = 'ROUND ' + pad2(Math.max(1, G.round));
        el.aligned.textContent = pad2(G.aligned) + ' / ' + pad2(n) + ' ALIGNED';
        const left = Logic.MAX_MISSES - G.roundMisses;
        if (el.misses.children.length !== Logic.MAX_MISSES) el.misses.innerHTML = '<i></i><i></i><i></i>';
        for (let i = 0; i < Logic.MAX_MISSES; i++) el.misses.children[i].classList.toggle('on', i < left);
        el.misses.setAttribute('aria-label', left + ' mistakes remaining');
        el.streak.textContent = G.streak >= 2 ? 'STREAK ' + pad2(G.streak) : '';
        el.streak.style.opacity = G.streak >= 2 ? '1' : '0';
      }
      function tickScoreDisplay(dt) {
        if (displayScore !== G.score) {
          const d = G.score - displayScore;
          const step = Math.max(1, Math.abs(d) * Math.min(1, dt * 9));
          displayScore = Math.abs(d) <= step ? G.score : displayScore + Math.sign(d) * step;
          el.score.textContent = fmt(displayScore);
        }
      }

      let hintKey = '';
      function setHint(text) {
        if (hintKey === text) return;
        hintKey = text;
        if (!text) { el.hint.classList.remove('show'); return; }
        el.hint.classList.remove('show');
        void el.hint.offsetWidth;
        el.hint.textContent = text;
        el.hint.classList.add('show');
      }

      let readoutTimer = 0;
      function showReadout(main, sub, kind) {
        el.readout.innerHTML = '<span class="v">' + main + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '');
        el.readout.className = 'sd-readout show ' + (kind || '');
        readoutTimer = 1.5;
      }

      // ============================================================ layout
      const L = { W: 0, H: 0, cx: 0, cy: 0, R: 150, hubR: 22, area: null };
      function computeLayout() {
        const W = ctx.width, H = ctx.height;
        const area = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
        const top = (area.top || 0) + 96;
        const bottom = H - (area.bottom || 0) - 58;
        const availH = Math.max(160, bottom - top);
        L.W = W; L.H = H; L.area = area;
        L.R = Math.max(90, Math.min(W * 0.44, availH * 0.41));
        L.cx = W / 2;
        L.cy = top + availH / 2;
        L.hubR = L.R * 0.15;
        // Rings must stay wide enough to hit reliably with a finger.
        G.maxRings = clamp(Math.floor((L.R - L.hubR) / 14), 6, Logic.ABS_MAX_RINGS);
      }

      function placeHud() {
        const a = L.area;
        hud.style.setProperty('--sd-top', (a.top || 0) + 'px');
        hud.style.setProperty('--sd-bottom', (a.bottom || 0) + 'px');
        hud.style.setProperty('--sd-left', Math.max(16, (a.left || 0) + 16) + 'px');
        hud.style.setProperty('--sd-right', Math.max(16, (a.right || 0) + 16) + 'px');
        hud.style.setProperty('--sd-axis-y', (L.cy - L.R - 30) + 'px');
        hud.style.setProperty('--sd-cy', L.cy + 'px');
        hud.style.setProperty('--sd-sculpt-top', (L.cy - L.R) + 'px');
        hud.style.setProperty('--sd-sculpt-bottom', (L.cy + L.R) + 'px');
      }

      // Fonts load in the background; the HUD has system fallbacks.
      try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
      try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }); } catch (e) { }
      try { ctx.loadFont('Cormorant Garamond', 'cormorant-garamond', '1.0.0', { weight: '300', style: 'italic' }).catch(() => { }); } catch (e) { }

      computeLayout();
      placeHud();

      // ============================================================ three.js
      let THREE;
      function bootFail(stage, err) {
        el.intro.innerHTML = '<div class="sd-title">SPIN DOCTOR</div><div class="sd-instr">THE SCULPTURE COULD NOT BE LIT ON THIS DEVICE.</div>';
        el.intro.classList.add('show');
        try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
        try { ctx.markVisualReady && ctx.markVisualReady('fallback'); ctx.platform.ready(); } catch (e) { }
      }
      try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
      if (destroyed) return;

      const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      } catch (e) { bootFail('renderer', e); return; }
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, 2));
      renderer.setSize(L.W, L.H, false);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.setClearColor(0x17191b, 1);
      ctx.onDestroy(() => { try { renderer.dispose(); } catch (e) { } });

      const scene = new THREE.Scene();
      const FOV = 14;
      const camera = new THREE.PerspectiveCamera(FOV, L.W / L.H, 10, 20000);
      function placeCamera() {
        const dist = (L.H / 2) / Math.tan((FOV / 2) * DEG);
        camera.aspect = L.W / L.H;
        camera.position.set(0, 0, dist);
        camera.near = dist * 0.5; camera.far = dist * 2;
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
      }
      placeCamera();

      // ----- Environment: a procedural studio with soft light panels.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x303437);
      const panel = (w, h, color, intensity, pos, look) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
        m.position.set(pos[0], pos[1], pos[2]); m.lookAt(look[0], look[1], look[2]);
        envScene.add(m);
      };
      panel(8, 3, 0xfff4e6, 4.0, [-1.5, 5, 4], [0, 0, 0]);   // key softbox, upper left front
      panel(1.2, 7, 0xdcebf2, 2.2, [-6, 0, 1], [0, 0, 0]);   // cool vertical strip
      panel(1.0, 6, 0xffe3c8, 1.4, [6, -1, 2], [0, 0, 0]);    // warm rim strip
      panel(10, 2, 0x8f979c, 0.6, [0, -5, 3], [0, 0, 0]);     // floor bounce
      panel(6, 6, 0x6a6f72, 1.0, [0, 0, -6], [0, 0, 0]);      // back wall
      panel(7, 7, 0x8d9295, 1.0, [0.8, 0.6, 7], [0, 0, 0]);   // soft frontal bounce (viewer side)
      panel(2.2, 1.1, 0xfff8ee, 3.0, [2.6, 2.4, 6], [0, 0, 0]); // small high key, read on the faces
      const envRT = pmrem.fromScene(envScene, 0.035);
      scene.environment = envRT.texture;
      envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pmrem.dispose();

      // ----- Background: warm charcoal, an almost imperceptible Turrell-like aura.
      const bgMat = new THREE.ShaderMaterial({
        depthWrite: false, toneMapped: false,
        uniforms: {
          uRes: { value: new THREE.Vector2(1, 1) },
          uCenter: { value: new THREE.Vector2(0, 0) },
          uR: { value: 100 },
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uWarm: { value: 0 },
          uDim: { value: 0 }
        },
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }',
        fragmentShader: [
          'uniform vec2 uRes; uniform vec2 uCenter; uniform float uR; uniform float uTime; uniform float uPulse; uniform float uWarm; uniform float uDim;',
          'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
          'void main(){',
          '  vec2 p = gl_FragCoord.xy;',
          '  float d = length(p - uCenter) / uR;',
          '  float v = p.y / uRes.y;',
          '  vec3 base = mix(vec3(0.090,0.094,0.100), vec3(0.106,0.114,0.122), v);',
          '  base = mix(base, vec3(0.140,0.146,0.150), smoothstep(2.6, 0.2, d) * 0.55);',
          '  float breathe = 0.5 + 0.5 * sin(uTime * 0.25);',
          '  float aura = exp(-pow((d - 1.18) * 2.4, 2.0));',
          '  base += vec3(0.020,0.032,0.038) * aura * (0.55 + 0.25 * breathe + 1.6 * uPulse);',
          '  base += vec3(0.040,0.026,0.012) * aura * uWarm;',
          '  base *= 1.0 - 0.28 * smoothstep(0.55, 1.35, length((p / uRes) - 0.5) * 1.4);',
          '  base *= 1.0 - 0.35 * uDim;',
          '  base += (hash(p + fract(uTime)) - 0.5) / 255.0;',
          '  gl_FragColor = vec4(base, 1.0);',
          '}'
        ].join('\n')
      });
      const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
      bgMesh.frustumCulled = false;
      bgMesh.renderOrder = -10;
      scene.add(bgMesh);

      // ----- Shadow-receiving wall behind the sculpture (transparent, shadows only).
      const WALL_Z = -70;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ color: 0x050607, opacity: 0.55 }));
      wall.position.z = WALL_Z;
      wall.receiveShadow = true;
      wall.renderOrder = -5;
      scene.add(wall);

      // ----- Lights.
      const hemi = new THREE.HemisphereLight(0xe9eef0, 0x1a1816, 0.35);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xfff3e6, 1.6);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 4;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.6;
      scene.add(key); scene.add(key.target);
      const sweep = new THREE.PointLight(0xe8f6fa, 0, 0, 0);
      scene.add(sweep);

      const sculpture = new THREE.Group();
      scene.add(sculpture);

      function placeLights() {
        const R = L.R;
        const dir = new THREE.Vector3(-0.26, 0.42, 1).normalize();
        key.target.position.copy(sculpture.position);
        key.position.copy(sculpture.position).addScaledVector(dir, 1200);
        const cam = key.shadow.camera;
        cam.left = -R * 1.5; cam.right = R * 1.5; cam.top = R * 1.5; cam.bottom = -R * 1.5;
        cam.near = 900; cam.far = 1500;
        cam.updateProjectionMatrix();
      }

      // ----- Shared textures.
      function radialTexture(stops) {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        stops.forEach(s => gr.addColorStop(s[0], s[1]));
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }
      const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
      const brushTex = (function () {
        const c = document.createElement('canvas'); c.width = 4; c.height = 512;
        const g = c.getContext('2d');
        for (let y = 0; y < 512; y++) {
          const v = 205 + Math.floor((Math.random() - 0.5) * 34 + Math.sin(y * 0.9) * 6);
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          g.fillRect(0, y, 4, 1);
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      })();
      ctx.onDestroy(() => { glowTex.dispose(); brushTex.dispose(); envRT.dispose(); });

      // ----- Ring geometry: a lathe of a rounded-rectangle profile, rebuilt on
      // the CPU only when the ring's dimensions change.
      const SEG = 192;
      const CORNER_STEPS = 5;
      const PROFILE = (function () {
        // Each profile point: side (0 inner / 1 outer), zSide (0 back / 1 front),
        // ur/uz (unit bevel offsets), normal (nr, nz).
        const pts = [];
        const corners = [
          { side: 1, zs: 1, a0: 0, a1: 90 },
          { side: 0, zs: 1, a0: 90, a1: 180 },
          { side: 0, zs: 0, a0: 180, a1: 270 },
          { side: 1, zs: 0, a0: 270, a1: 360 }
        ];
        for (const c of corners) {
          for (let k = 0; k <= CORNER_STEPS; k++) {
            const a = (c.a0 + (c.a1 - c.a0) * (k / CORNER_STEPS)) * DEG;
            const ca = Math.cos(a), sa = Math.sin(a);
            pts.push({
              side: c.side, zs: c.zs,
              ur: (c.side ? -1 : 1) + ca,
              uz: (c.zs ? -1 : 1) + sa,
              nr: ca, nz: sa
            });
          }
        }
        pts.push(Object.assign({}, pts[0]));
        return pts;
      })();
      const P = PROFILE.length;

      function buildRingGeometry() {
        const vcount = (SEG + 1) * P;
        const pos = new Float32Array(vcount * 3);
        const nor = new Float32Array(vcount * 3);
        const uv = new Float32Array(vcount * 2);
        const cs = new Float32Array(SEG + 1), sn = new Float32Array(SEG + 1);
        for (let j = 0; j <= SEG; j++) {
          const t = (j / SEG) * Math.PI * 2;
          cs[j] = Math.cos(t); sn[j] = Math.sin(t);
          for (let i = 0; i < P; i++) {
            const v = j * P + i, p = PROFILE[i];
            nor[v * 3] = cs[j] * p.nr; nor[v * 3 + 1] = sn[j] * p.nr; nor[v * 3 + 2] = p.nz;
            uv[v * 2] = j / SEG; uv[v * 2 + 1] = i / (P - 1);
          }
        }
        const idx = [];
        for (let j = 0; j < SEG; j++) {
          for (let i = 0; i < P - 1; i++) {
            const a = j * P + i, b = (j + 1) * P + i, c = j * P + i + 1, d = (j + 1) * P + i + 1;
            idx.push(a, b, c, b, d, c);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.userData.cs = cs; g.userData.sn = sn;
        return g;
      }
      function shapeRingGeometry(g, inner, outer, depth) {
        const w = Math.max(0.001, outer - inner);
        const b = Math.max(0.0005, Math.min(w * 0.34, depth * 0.45));
        const front = depth / 2, back = -depth / 2;
        const pos = g.attributes.position.array, cs = g.userData.cs, sn = g.userData.sn;
        for (let i = 0; i < P; i++) {
          const p = PROFILE[i];
          const r = (p.side ? outer : inner) + p.ur * b;
          const z = (p.zs ? front : back) + p.uz * b;
          for (let j = 0; j <= SEG; j++) {
            const v = (j * P + i) * 3;
            pos[v] = cs[j] * r; pos[v + 1] = sn[j] * r; pos[v + 2] = z;
          }
        }
        g.attributes.position.needsUpdate = true;
        g.computeBoundingSphere();
        return b;
      }

      function makeMaterial(spec) {
        const m = new THREE.MeshPhysicalMaterial({
          color: spec.color, metalness: spec.metalness, roughness: spec.roughness,
          envMapIntensity: spec.env || 1, clearcoat: spec.clearcoat || (spec.glass ? 1 : 0),
          clearcoatRoughness: spec.glass ? 0.18 : 0.3,
          sheen: spec.sheen || 0, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xf2efe8),
          emissive: new THREE.Color(0x000000)
        });
        m.userData.baseEmissive = new THREE.Color(spec.glow || 0x000000);
        if (spec.glass) { m.transparent = true; m.opacity = spec.opacity; m.ior = 1.45; m.specularIntensity = 1; }
        if (spec.brushed) { m.roughnessMap = brushTex; brushTex.repeat.set(1, 3); }
        return m;
      }

      // Marker parts shared geometry.
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const unitPlane = new THREE.PlaneGeometry(1, 1);
      const notchMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.6 });

      // ----- Hub (fixed centre boss).
      const hubGeo = buildRingGeometry();
      const hubMat = makeMaterial({ color: 0xd8c9ae, metalness: 1, roughness: 0.28, brushed: true, env: 1.1 });
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.castShadow = true; hub.receiveShadow = true;
      sculpture.add(hub);
      const hubPin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32), notchMat);
      hubPin.rotation.x = Math.PI / 2;
      sculpture.add(hubPin);

      // ----- Fixed alignment reference: a faint axis line, a top index and the
      // tolerance window ticks.
      const axisMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uOpacity: { value: 0.09 }, uPulse: { value: -1 }, uPulseAmp: { value: 0 },
          uColor: { value: new THREE.Color(0xbfe6ee) }, uWarm: { value: 0 }
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'varying vec2 vUv; uniform float uOpacity; uniform float uPulse; uniform float uPulseAmp; uniform vec3 uColor; uniform float uWarm;',
          'void main(){',
          '  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;',
          '  float taper = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.86, vUv.y);',
          '  float pulse = uPulseAmp * exp(-pow((vUv.y - uPulse) * 7.0, 2.0));',
          '  vec3 col = mix(uColor, vec3(0.85,0.66,0.48), uWarm);',
          '  float a = (uOpacity * taper + pulse) * edge;',
          '  gl_FragColor = vec4(col * a, a);',
          '}'
        ].join('\n')
      });
      const axisLine = new THREE.Mesh(unitPlane, axisMat);
      axisLine.renderOrder = 20;
      scene.add(axisLine);
      const indexMat = new THREE.MeshBasicMaterial({ color: 0xcfeef4, transparent: true, opacity: 0.7, toneMapped: false, depthTest: false, blending: THREE.AdditiveBlending });
      const indexTick = new THREE.Mesh(unitPlane, indexMat);
      indexTick.renderOrder = 21;
      scene.add(indexTick);
      const tolMat = new THREE.MeshBasicMaterial({ color: 0xcfeef4, transparent: true, opacity: 0.28, toneMapped: false, depthTest: false, blending: THREE.AdditiveBlending });
      const tolTicks = [new THREE.Mesh(unitPlane, tolMat), new THREE.Mesh(unitPlane, tolMat)];
      tolTicks.forEach(t => { t.renderOrder = 21; scene.add(t); });
      let tolShown = 6;

      // ------------------------------------------------------------- rings
      function createRing(index) {
        const spec = MATERIALS[index % MATERIALS.length];
        const geo = buildRingGeometry();
        const mat = makeMaterial(spec);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.renderOrder = spec.glass ? 2 : 0;
        const marker = new THREE.Group();
        const notch = new THREE.Mesh(unitBox, notchMat);
        const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.markerIdle, toneMapped: false });
        const line = new THREE.Mesh(unitBox, lineMat);
        const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: COLORS.cyan, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const glow = new THREE.Mesh(unitPlane, glowMat);
        glow.renderOrder = 10;
        marker.add(notch); marker.add(line); marker.add(glow);
        mesh.add(marker);
        sculpture.add(mesh);
        const r = {
          index, spec, geo, mat, mesh, marker, notch, line, lineMat, glow, glowMat,
          inner: L.hubR, outer: L.hubR, depth: 8, z: 0,
          from: null, to: null, dirty: true,
          angle: 0, vel: 0, baseVel: 0, wob: null,
          state: 'idle', bStart: 0, a0: 0, v0: 0, spinT: 0, spinDur: Logic.SPINUP_S, spinFrom: 0,
          settleFrom: 0, settleTo: 0, settleT: 1,
          animFrom: 0, animTo: 0,
          lockGlow: 0, missGlow: 0, flash: 0, alive: true, lastErr: null
        };
        rings.push(r);
        return r;
      }
      function disposeRing(r) {
        sculpture.remove(r.mesh);
        r.geo.dispose(); r.mat.dispose(); r.lineMat.dispose(); r.glowMat.dispose();
      }

      // Dimensions of ring k of n (k = 0 is outermost).
      function ringDims(k, n) {
        const pitch = (L.R - L.hubR) / n;
        const gap = clamp(pitch * 0.2, 2.5, 7);
        const outer = L.R - k * pitch - gap / 2;
        const inner = L.R - (k + 1) * pitch + gap / 2;
        const depth = clamp(pitch * 0.55, 6, 13);
        return { inner, outer, depth, z: k * 1.2 };
      }

      function applyRingShape(r) {
        const b = shapeRingGeometry(r.geo, r.inner, r.outer, r.depth);
        r.mesh.position.z = r.z;
        const w = r.outer - r.inner;
        const flat = Math.max(0.5, w - 2 * b);
        const mid = (r.inner + r.outer) / 2;
        const front = r.depth / 2;
        const len = flat * 0.92;
        r.notch.scale.set(clamp(w * 0.22, 3.6, 5), len, 1.2);
        r.notch.position.set(0, mid, front - 0.25);
        r.line.scale.set(1.6, len * 0.9, 0.6);
        r.line.position.set(0, mid, front + 0.45);
        const gsz = Math.max(18, w * 2.6);
        r.glow.scale.set(gsz * 0.55, gsz, 1);
        r.glow.position.set(0, mid, front + 1.2);
        r.marker.visible = w > 2;
        r.dirty = false;
      }

      function layoutReference() {
        const R = L.R;
        const n = Math.max(1, rings.length);
        const top = R + 26;
        const bottomY = L.hubR * 0.6;
        const maxFront = 16;
        axisLine.scale.set(1.4, top - bottomY, 1);
        axisLine.position.set(sculpture.position.x, sculpture.position.y + (top + bottomY) / 2, maxFront);
        indexTick.scale.set(1.3, 12, 1);
        indexTick.position.set(sculpture.position.x, sculpture.position.y + R + 16, maxFront);
        placeTolTicks();
        // hub
        shapeRingGeometry(hubGeo, 1.6, L.hubR - 2.5, clamp(L.hubR * 0.5, 8, 14));
        hub.position.z = n * 1.2 + 2;
        hubPin.scale.set(1.6, 4, 1.6);
        hubPin.position.z = hub.position.z + 2;
      }
      function placeTolTicks() {
        const r = L.R + 15;
        [-1, 1].forEach((s, i) => {
          const a = s * tolShown * DEG;
          const t = tolTicks[i];
          t.scale.set(1.0, 7, 1);
          t.position.set(sculpture.position.x + Math.sin(a) * r, sculpture.position.y + Math.cos(a) * r, 16);
          t.rotation.z = -a;
        });
      }

      function applyLayout() {
        computeLayout();
        placeHud();
        renderer.setSize(L.W, L.H, false);
        placeCamera();
        bgMat.uniforms.uRes.value.set(L.W * renderer.getPixelRatio(), L.H * renderer.getPixelRatio());
        bgMat.uniforms.uCenter.value.set(L.cx * renderer.getPixelRatio(), (L.H - L.cy) * renderer.getPixelRatio());
        bgMat.uniforms.uR.value = L.R * renderer.getPixelRatio();
        sculpture.position.set(L.cx - L.W / 2, L.H / 2 - L.cy, 0);
        placeLights();
        const alive = rings.filter(r => r.alive);
        alive.forEach((r, k) => {
          const d = ringDims(k, alive.length);
          if (r.to) { r.to = d; } else { Object.assign(r, d); r.dirty = true; }
        });
        layoutReference();
      }

      // ===================================================== round control
      function syncRingCount(n) {
        // Keep the outer rings, add new rings at the centre, retire extras.
        const alive = rings.filter(r => r.alive);
        while (alive.length > n) {
          const r = alive.pop();
          r.alive = false;
          r.from = { inner: r.inner, outer: r.outer, depth: r.depth, z: r.z };
          r.to = { inner: L.hubR, outer: L.hubR + 0.01, depth: r.depth * 0.5, z: r.z };
        }
        let nextIndex = rings.reduce((m, r) => Math.max(m, r.index + 1), 0);
        while (alive.length < n) {
          const r = createRing(nextIndex++);
          r.inner = L.hubR; r.outer = L.hubR + 0.01; r.depth = 4;
          r.angle = Logic.wrap180(rng() * 360);
          alive.push(r);
        }
        alive.forEach((r, k) => {
          r.from = { inner: r.inner, outer: r.outer, depth: r.depth, z: r.z };
          r.to = ringDims(k, alive.length);
        });
        return alive;
      }

      function beginRound(round, fromIntro) {
        G.round = round;
        G.roundMisses = 0;
        G.aligned = 0;
        const n = Logic.ringCount(round, G.maxRings);
        roundSpec = Logic.generateRound(round, n, rng);
        G.tol = roundSpec.tolerance;
        const alive = syncRingCount(n);
        alive.forEach((r, k) => {
          const s = roundSpec.rings[k];
          r.baseVel = s.speed;
          r.wob = s.wobble;
          r.lockGlow = 0; r.missGlow = 0; r.lastErr = null;
          if (fromIntro) {
            r.state = 'spinup'; r.spinT = 0; r.spinDur = 0.7; r.spinFrom = r.vel;
          } else {
            r.state = 'reset';
            r.vel = 0;
            r.animFrom = r.angle;
            let d = Logic.wrap180(s.start - r.angle);
            // Unwind in the ring's coming direction of travel, with a part turn.
            if (Math.sign(d) !== Math.sign(s.speed) && Math.abs(d) > 1) d += 360 * Math.sign(s.speed);
            if (Math.abs(d) < 120) d += 360 * Math.sign(s.speed);
            r.animTo = r.angle + d;
          }
        });
        Sound.tension(clamp((n - 3) / 7, 0, 1));
        G.phase = 'transition';
        G.transitionT = 0;
        G.transitionDur = fromIntro ? 0.7 : 0.95;
        renderHud();
        layoutReference();
      }

      function startRun() {
        G.runId++;
        G.score = 0; displayScore = 0; el.score.textContent = '0';
        setScore(0);
        G.misses = 0; G.streak = 0; G.runBestStreak = 0; G.runBestPrecision = null;
        G.newBest = false; G.firstAlignDone = false; G.hintMissT = -1;
        try { if (scoreTrack) scoreTrack.reset(); } catch (e) { }
        try { ctx.platform.start({ mode: 'endless' }); } catch (e) { }
        const fromIntro = G.phase === 'intro';
        el.overBoard.innerHTML = '';
        computeLayout();
        beginRound(1, fromIntro);
        el.top.classList.add('show');
        setHint('TAP A RING TO ENGAGE THE BRAKE');
      }

      // ============================================================= input
      function ringAtPoint(px, py) {
        const dx = px - L.cx, dy = py - L.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const alive = rings.filter(r => r.alive);
        const n = alive.length;
        if (!n) return null;
        const pitch = (L.R - L.hubR) / n;
        if (d < L.hubR - 2 || d > L.R + Math.min(18, pitch * 0.9)) return null;
        // Each ring owns exactly its radial band, so neighbours never steal a tap.
        let k = Math.floor((L.R - d) / pitch);
        k = clamp(k, 0, n - 1);
        return alive[k];
      }

      function onPointerDown(ev) {
        if (G.paused || G.phase !== 'play') return;
        const rect = canvas.getBoundingClientRect();
        const px = (ev.clientX - rect.left) * (L.W / Math.max(1, rect.width));
        const py = (ev.clientY - rect.top) * (L.H / Math.max(1, rect.height));
        const r = ringAtPoint(px, py);
        if (!r) return;
        // Map the event to simulation time for frame-independent braking.
        const now = performance.now();
        let late = 0;
        if (typeof ev.timeStamp === 'number' && ev.timeStamp > 1e3 && ev.timeStamp <= now + 1) {
          late = clamp((ev.timeStamp - G.lastUpdatePerf) / 1000, 0, 0.05);
        }
        engage(r, late);
      }
      ctx.listen(canvas, 'pointerdown', onPointerDown);

      function engage(r, late) {
        if (r.state === 'spin') {
          r.state = 'brake';
          r.v0 = r.vel;
          r.a0 = r.angle + r.vel * (late || 0);
          r.bStart = G.simTime + (late || 0);
          r.flash = 1;
          Sound.select(); Sound.brake(Math.abs(r.v0));
          haptic('light');
          try { ctx.platform.interact({ action: 'brake' }); } catch (e) { }
          return true;
        }
        if (r.state === 'missed') {
          r.state = 'spinup';
          r.spinT = 0; r.spinDur = Logic.SPINUP_S; r.spinFrom = 0;
          r.missGlow = Math.min(r.missGlow, 0.6);
          if (!stats.released) { stats.released = true; saveStats(); }
          Sound.release();
          haptic('light');
          try { ctx.platform.interact({ action: 'release' }); } catch (e) { }
          return true;
        }
        return false; // braking, settling, locked or spinning up: ignore
      }

      // =========================================================== evaluation
      function evaluate(r) {
        const err = Logic.wrap180(r.angle);
        const abs = Math.abs(err);
        r.lastErr = abs;
        if (abs <= G.tol) {
          r.state = 'settle';
          r.settleFrom = r.angle;
          r.settleTo = r.angle - err;
          r.settleT = 0;
          r.lockGlow = 1;
          r.missGlow = 0;
          G.streak++;
          G.runBestStreak = Math.max(G.runBestStreak, G.streak);
          if (G.runBestPrecision === null || abs < G.runBestPrecision) G.runBestPrecision = abs;
          const s = Logic.alignScore(abs, G.streak);
          setScore(G.score + s.total);
          G.aligned = rings.filter(x => x.alive && (x.state === 'settle' || x.state === 'locked')).length;
          showReadout(abs.toFixed(1) + '°', '+' + s.total, 'lock');
          Sound.lock(G.aligned);
          haptic('medium');
          if (!G.firstAlignDone) { G.firstAlignDone = true; setHint(''); }
          const n = rings.filter(x => x.alive).length;
          if (G.aligned >= n) completeRound();
        } else {
          r.state = 'missed';
          r.vel = 0;
          r.missGlow = 1;
          G.streak = 0;
          G.roundMisses++;
          G.misses++;
          axisMat.uniforms.uWarm.value = 1;
          showReadout(abs.toFixed(1) + '°', 'OFF AXIS', 'miss');
          Sound.miss();
          haptic('warning');
          el.misses.classList.remove('pulse'); void el.misses.offsetWidth; el.misses.classList.add('pulse');
          if (G.roundMisses >= Logic.MAX_MISSES) {
            gameOver();
          } else if (!stats.released) {
            G.hintMissT = 0;
          }
        }
        renderHud();
      }

      function completeRound() {
        G.phase = 'complete';
        G.completeT = 0;
        let bonus = 0;
        const n = rings.filter(r => r.alive).length;
        if (G.roundMisses === 0) {
          bonus = Logic.flawlessBonus(n);
          setScore(G.score + bonus);
        }
        el.flash.innerHTML = '<span>ROUND ' + pad2(G.round) + ' ALIGNED</span>' + (bonus ? '<span class="b">FLAWLESS +' + bonus + '</span>' : '');
        el.flash.classList.remove('show'); void el.flash.offsetWidth; el.flash.classList.add('show');
        Sound.complete(n);
        haptic('success');
        try { ctx.platform.milestone('round_clear', { round: G.round, rings: n, flawless: bonus > 0 }); } catch (e) { }
        if (G.round + 1 > stats.bestRound) { stats.bestRound = G.round + 1; }
        stats.lastScore = G.score;
        saveStats();
      }

      function gameOver() {
        G.phase = 'over';
        G.overT = 0;
        setHint('');
        rings.forEach(r => {
          if (!r.alive) return;
          if (r.state === 'spin' || r.state === 'spinup' || r.state === 'brake') {
            r.state = 'halt'; r.v0 = r.vel; r.a0 = r.angle; r.bStart = G.simTime;
          }
        });
        stats.lastScore = G.score;
        stats.bestRound = Math.max(stats.bestRound, G.round);
        stats.bestStreak = Math.max(stats.bestStreak, G.runBestStreak);
        if (G.runBestPrecision !== null && (stats.bestPrecision === null || G.runBestPrecision < stats.bestPrecision)) stats.bestPrecision = G.runBestPrecision;
        G.newBest = G.score > stats.best;
        if (G.newBest) stats.best = G.score;
        saveStats();
        el.readout.classList.remove('show'); readoutTimer = 0;
        Sound.over(G.newBest && G.score > 0);
        haptic('error');
        try { ctx.platform.fail({ score: G.score, round: G.round }); } catch (e) { }
        fillGameOver();
        submitRecord(G.runId);
      }

      function fillGameOver() {
        el.overScore.textContent = fmt(G.score);
        el.overRound.textContent = pad2(G.round);
        el.overPrec.textContent = G.runBestPrecision === null ? '—' : G.runBestPrecision.toFixed(2) + '°';
        el.overStreak.textContent = pad2(G.runBestStreak);
        el.overBest.innerHTML = G.newBest && G.score > 0
          ? '<span class="nb">NEW BEST</span>'
          : 'BEST ' + fmt(stats.best) + ' &nbsp;·&nbsp; HIGHEST ROUND ' + pad2(stats.bestRound);
        el.overRank.textContent = '';
        el.overBoard.innerHTML = '';
      }

      function submitRecord(runId) {
        if (!scoreTrack || G.score <= 0) return;
        el.overRank.textContent = 'RECORDING…';
        let p;
        try { p = scoreTrack.submit('score', { label: fmt(G.score) + ' pts', metadata: { round: G.round } }); } catch (e) { el.overRank.textContent = ''; return; }
        Promise.resolve(p).then(res => {
          if (destroyed || runId !== G.runId) return;
          const st = res && res.standing;
          const rank = st && (st.rank || (st.viewerRank && st.viewerRank.rank));
          el.overRank.textContent = rank ? 'GLOBAL RANK #' + rank + (st.totalRanked ? ' OF ' + fmt(st.totalRanked) : '') : 'SCORE RECORDED';
          if (G.newBest) {
            try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ score: G.score, level: G.round, mode: 'endless', implicitText: 'Aligned ' + G.round + ' rounds in SPIN DOCTOR' }); } catch (e) { }
          }
          loadBoard(runId);
        }).catch(() => {
          if (destroyed || runId !== G.runId) return;
          el.overRank.textContent = 'LEADERBOARD UNAVAILABLE · BEST SAVED ON THIS DEVICE';
        });
      }

      // Compact top three, read from the same board the score was submitted to.
      function loadBoard(runId) {
        if (!scoreTrack || typeof scoreTrack.leaderboard !== 'function') return;
        let p;
        try { p = scoreTrack.leaderboard('score', { scope: 'global', period: 'all_time', limit: 3 }); } catch (e) { return; }
        Promise.resolve(p).then(board => {
          if (destroyed || runId !== G.runId || !board) return;
          const rows = Array.isArray(board.rows) ? board.rows.slice(0, 3) : [];
          const me = board.viewerRank && board.viewerRank.rank;
          if (me) el.overRank.textContent = 'GLOBAL RANK #' + me + (board.totalRanked ? ' OF ' + fmt(board.totalRanked) : '');
          el.overBoard.innerHTML = rows.map(row => {
            const name = String(row.username || row.displayName || row.name || row.handle || 'PLAYER').toUpperCase().replace(/[<>&"]/g, '');
            const val = row.displayLabel || fmt(row.value || 0);
            const mine = (board.viewerRank && row.userId && row.userId === board.viewerRank.userId) || (me && row.rank === me);
            return '<div class="row' + (mine ? ' me' : '') + '"><span>' + pad2(row.rank || 0) + ' &nbsp; ' + name + '</span><span>' + String(val).replace(/[<>&"]/g, '') + '</span></div>';
          }).join('');
        }).catch(() => { /* board read failed: the rank line already says what we know */ });
      }

      // ============================================================ controls
      ctx.listen(el.play, 'click', () => {
        if (G.phase !== 'intro') return;
        Sound.unlock(!stats.muted);
        el.intro.classList.remove('show');
        startRun();
      });
      ctx.listen(el.restart, 'click', () => {
        if (G.phase !== 'over') return;
        Sound.unlock(!stats.muted);
        el.over.classList.remove('show');
        startRun();
      });
      ctx.listen(el.pause, 'click', () => {
        if (G.phase === 'intro' || G.phase === 'over') return;
        setPaused(!G.paused);
      });
      ctx.listen(el.resume, 'click', () => setPaused(false));
      ctx.listen(el.pauseRestart, 'click', () => {
        if (!G.paused) return;
        setPaused(false);
        startRun();
      });
      ctx.listen(el.sound, 'click', () => {
        stats.muted = !stats.muted;
        saveStats();
        refreshSoundIcon();
        Sound.unlock(!stats.muted);
        Sound.setMuted(stats.muted);
      });
      function setPaused(p) {
        G.paused = p;
        el.pauseLayer.classList.toggle('show', p);
        el.pause.classList.toggle('is-paused', p);
        Sound.setPaused(p);
      }

      // ============================================================ update
      function updateRing(r, dt) {
        const t = G.simTime;
        switch (r.state) {
          case 'idle': {
            const target = r.baseVel * clamp(G.introT / 2.4, 0, 1);
            r.vel = target;
            r.angle += r.vel * dt;
            break;
          }
          case 'spin':
            r.vel = Logic.spinVelocity(r.baseVel, r.wob, t);
            r.angle += r.vel * dt;
            break;
          case 'spinup': {
            r.spinT += dt;
            const s = clamp(r.spinT / r.spinDur, 0, 1);
            const target = Logic.spinVelocity(r.baseVel, r.wob, t);
            r.vel = lerp(r.spinFrom, target, easeInOut(s));
            r.angle += r.vel * dt;
            if (s >= 1) r.state = 'spin';
            break;
          }
          case 'brake':
          case 'halt': {
            const s = (t - r.bStart) / Logic.BRAKE_S;
            if (s < 0) { r.angle += r.vel * dt; break; } // event landed mid-frame
            const c = clamp(s, 0, 1);
            r.angle = r.a0 + Logic.brakeOffset(r.v0, c);
            r.vel = r.v0 * (1 - c) * (1 - c);
            if (c >= 1) {
              r.vel = 0;
              if (r.state === 'brake') evaluate(r); else r.state = 'stopped';
            }
            break;
          }
          case 'settle': {
            r.settleT += dt / 0.16;
            const s = clamp(r.settleT, 0, 1);
            r.angle = lerp(r.settleFrom, r.settleTo, easeOut(s));
            r.vel = 0;
            if (s >= 1) { r.angle = 0; r.state = 'locked'; }
            break;
          }
          case 'reset': {
            const s = easeInOut(clamp(G.transitionT / G.transitionDur, 0, 1));
            r.angle = lerp(r.animFrom, r.animTo, s);
            r.vel = 0;
            break;
          }
          default:
            r.vel = 0;
        }
        // keep angles bounded without visual jumps
        if (r.state !== 'reset' && r.state !== 'settle' && (r.angle > 720 || r.angle < -720)) {
          const w = Logic.wrap180(r.angle);
          if (r.state === 'brake' || r.state === 'halt') r.a0 += w - r.angle;
          r.angle = w;
        }
        // feedback decay
        r.flash = Math.max(0, r.flash - dt * 4);
        if (r.state === 'locked' || r.state === 'settle') r.lockGlow = Math.max(0.32, r.lockGlow - dt * 1.4);
        else r.lockGlow = Math.max(0, r.lockGlow - dt * 3);
        if (r.state === 'missed') r.missGlow = Math.max(0.35, r.missGlow - dt * 1.2);
        else r.missGlow = Math.max(0, r.missGlow - dt * 3);
      }

      const tmpColor = new THREE.Color();
      const cIdle = new THREE.Color(COLORS.markerIdle), cLock = new THREE.Color(COLORS.markerLock), cMiss = new THREE.Color(COLORS.markerMiss);
      const eCyan = new THREE.Color(COLORS.cyan), eWarm = new THREE.Color(COLORS.warm);
      function styleRing(r, completeGlow) {
        r.mesh.rotation.z = -r.angle * DEG;
        const lock = r.lockGlow, miss = r.missGlow;
        tmpColor.copy(cIdle);
        if (lock > 0) tmpColor.lerp(cLock, clamp(lock * 2.2, 0, 1));
        if (miss > 0) tmpColor.lerp(cMiss, clamp(miss * 2, 0, 1));
        r.lineMat.color.copy(tmpColor);
        const g = Math.max(lock * 0.85, completeGlow);
        r.glowMat.opacity = clamp(g * 0.55 + miss * 0.18, 0, 0.7);
        r.glowMat.color.copy(miss > lock ? eWarm : eCyan);
        const e = r.mat.emissive;
        e.copy(r.mat.userData.baseEmissive);
        const ei = Math.max(0, lock - 0.32) * 0.12 + completeGlow * 0.035 + r.flash * 0.03;
        if (ei > 0) e.add(tmpColor.copy(eCyan).multiplyScalar(ei));
        if (miss > 0) e.add(tmpColor.copy(eWarm).multiplyScalar(miss * 0.06));
      }

      function update(dtMs) {
        const dt = Math.min(dtMs, 80) / 1000;
        G.lastUpdatePerf = performance.now();
        bgMat.uniforms.uTime.value += dt;
        if (!G.paused) tick(dt);
        render();
      }

      function tick(dt) {
        G.simTime += dt;
        const n = rings.filter(r => r.alive).length;

        if (G.phase === 'intro') {
          G.introT += dt;
        }
        if (G.phase === 'transition') {
          G.transitionT += dt;
          const s = easeInOut(clamp(G.transitionT / G.transitionDur, 0, 1));
          rings.forEach(r => {
            if (!r.to || !r.from) return;
            r.inner = lerp(r.from.inner, r.to.inner, s);
            r.outer = lerp(r.from.outer, r.to.outer, s);
            r.depth = lerp(r.from.depth, r.to.depth, s);
            r.z = lerp(r.from.z, r.to.z, s);
            r.dirty = true;
          });
          if (G.transitionT >= G.transitionDur) {
            rings.forEach(r => { if (r.to) { Object.assign(r, r.to); r.from = null; r.to = null; r.dirty = true; } });
            for (let i = rings.length - 1; i >= 0; i--) if (!rings[i].alive) { disposeRing(rings[i]); rings.splice(i, 1); }
            rings.forEach(r => {
              if (r.state === 'reset') { r.angle = Logic.wrap180(r.animTo); r.state = 'spinup'; r.spinT = 0; r.spinDur = Logic.START_SPINUP_S; r.spinFrom = 0; }
            });
            G.phase = 'play';
            layoutReference();
          }
        }

        for (const r of rings) updateRing(r, dt);

        // Tolerance window ticks ease toward the current tolerance.
        if (Math.abs(tolShown - G.tol) > 0.01) { tolShown = lerp(tolShown, G.tol, Math.min(1, dt * 4)); placeTolTicks(); }

        // Axis feedback.
        const au = axisMat.uniforms;
        au.uWarm.value = Math.max(0, au.uWarm.value - dt * 1.6);
        let completeGlow = 0;
        if (G.phase === 'complete') {
          G.completeT += dt;
          const ct = G.completeT;
          au.uPulse.value = -0.1 + ct / 0.55 * 1.25;
          au.uPulseAmp.value = ct < 0.75 ? 0.75 * Math.sin(Math.min(1, ct / 0.75) * Math.PI) + 0.1 : 0;
          completeGlow = ct < 0.95 ? Math.sin(clamp(ct / 0.95, 0, 1) * Math.PI) : 0;
          bgMat.uniforms.uPulse.value = completeGlow;
          // A reflection travels across the metal surfaces.
          const sw = clamp((ct - 0.05) / 0.8, 0, 1);
          sweep.intensity = Math.sin(sw * Math.PI) * 2.4;
          sweep.distance = 0;
          sweep.position.set(sculpture.position.x + lerp(-L.R * 1.6, L.R * 1.6, easeInOut(sw)), sculpture.position.y + L.R * 0.6, L.R * 0.9);
          if (ct >= 1.0) {
            au.uPulseAmp.value = 0; bgMat.uniforms.uPulse.value = 0; sweep.intensity = 0;
            beginRound(G.round + 1, false);
          }
        } else {
          au.uPulseAmp.value = Math.max(0, au.uPulseAmp.value - dt * 2);
          bgMat.uniforms.uPulse.value = Math.max(0, bgMat.uniforms.uPulse.value - dt * 2);
        }
        au.uOpacity.value = 0.09 + au.uWarm.value * 0.22;
        indexMat.opacity = 0.62 + au.uWarm.value * 0.3;
        indexMat.color.setHex(au.uWarm.value > 0.05 ? 0xe8c9a8 : 0xcfeef4);
        bgMat.uniforms.uWarm.value = au.uWarm.value * 0.6;

        if (G.phase === 'over') {
          G.overT += dt;
          bgMat.uniforms.uDim.value = clamp(G.overT / 0.8, 0, 1) * 0.6;
          if (G.overT > 0.75 && !el.over.classList.contains('show')) el.over.classList.add('show');
        } else {
          bgMat.uniforms.uDim.value = Math.max(0, bgMat.uniforms.uDim.value - dt * 2);
        }

        for (const r of rings) {
          if (r.dirty) applyRingShape(r);
          styleRing(r, completeGlow);
        }

        // Hints.
        if (G.phase === 'play' && G.hintMissT >= 0) {
          G.hintMissT += dt;
          if (stats.released) { G.hintMissT = -1; if (hintKey === 'TAP THE RING AGAIN TO RELEASE IT') setHint(''); }
          else if (G.hintMissT > 0.9 && rings.some(r => r.state === 'missed')) setHint('TAP THE RING AGAIN TO RELEASE IT');
        }

        if (readoutTimer > 0) {
          readoutTimer -= dt;
          if (readoutTimer <= 0) el.readout.classList.remove('show');
        }
        tickScoreDisplay(dt);

        let spinning = 0;
        for (const r of rings) if (Math.abs(r.vel) > 1) spinning++;
        Sound.ambience(spinning, n);
      }

      function render() {
        if (window.__SD_DEV && window.__SD_SKIP_RENDER) return;
        renderer.render(scene, camera);
      }

      // ============================================================ sound
      const Sound = createSound(ctx, () => stats.muted);

      // ============================================================ boot
      applyLayout();
      // Intro sculpture: three rings at rest that slowly start to turn.
      computeLayout();
      const introRings = syncRingCount(3);
      introRings.forEach((r, k) => {
        Object.assign(r, r.to); r.from = null; r.to = null; r.dirty = true;
        r.angle = [140, -95, 205][k];
        r.baseVel = [42, -61, 83][k] * 0.42;
        r.state = 'idle';
      });
      layoutReference();
      for (const r of rings) { applyRingShape(r); styleRing(r, 0); }
      el.introBest.innerHTML = stats.best > 0
        ? 'BEST ' + fmt(stats.best) + ' &nbsp;·&nbsp; ROUND ' + pad2(stats.bestRound) + (stats.lastScore ? ' &nbsp;·&nbsp; LAST ' + fmt(stats.lastScore) : '')
        : '';
      el.intro.classList.add('show');
      render();
      try { ctx.markVisualReady && ctx.markVisualReady('sculpture'); } catch (e) { }
      try { ctx.platform.ready(); } catch (e) { }

      ctx.onResize(() => { applyLayout(); render(); }, { debounceMs: 60 });
      ctx.game.loop({
        update, maxDeltaMs: 80,
        // When the host suspends the Bit mid-round, come back to the pause screen.
        onPause: () => { if (G.phase === 'play' || G.phase === 'transition') setPaused(true); }
      });

      if (typeof window !== 'undefined' && window.__SD_DEV) {
        window.__SD = {
          G, rings, L, Logic,
          get tol() { return G.tol; },
          ringScreenPoint(r, angleDeg) {
            const mid = (r.inner + r.outer) / 2;
            const a = (angleDeg || 180) * DEG;
            return { x: L.cx + Math.sin(a) * mid, y: L.cy - Math.cos(a) * mid };
          },
          ringAtPoint
        };
      }
    }
  };

  // ==========================================================================
  // Sound: small bespoke synthesis. Quiet, physical, never arcade.
  // ==========================================================================
  function createSound(ctx, isMuted) {
    let ac = null, master = null, dry = null, wet = null, noiseBuf = null;
    let ambGain = null, whirGain = null, whirFilter = null, padGain = null, padFilter = null;
    let ready = false, paused = false, lastAmb = 0;
    const can = () => ready && ac && !paused;

    function unlock(wantSound) {
      if (!ctx.capabilities || !ctx.capabilities.audio) return;
      try {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          build();
          ctx.onDestroy(() => { try { ac.close(); } catch (e) { } });
        }
        if (ac.state === 'suspended') ac.resume().catch(() => { });
        ready = true;
        setMuted(!wantSound);
      } catch (e) { ac = null; ready = false; }
    }

    function build() {
      master = ac.createGain();
      master.gain.value = isMuted() ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ac.destination);
      dry = ac.createGain(); dry.gain.value = 1; dry.connect(master);
      const conv = ac.createConvolver();
      conv.buffer = impulse(2.4, 2.6);
      wet = ac.createGain(); wet.gain.value = 0.32;
      wet.connect(conv); conv.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // Atmosphere: a low room tone and a faint mechanical whir.
      const n1 = ac.createBufferSource(); n1.buffer = noiseBuf; n1.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.4;
      ambGain = ac.createGain(); ambGain.gain.value = 0;
      n1.connect(lp); lp.connect(ambGain); ambGain.connect(dry);
      n1.start();
      const n2 = ac.createBufferSource(); n2.buffer = noiseBuf; n2.loop = true; n2.playbackRate.value = 0.7;
      whirFilter = ac.createBiquadFilter(); whirFilter.type = 'bandpass'; whirFilter.frequency.value = 1150; whirFilter.Q.value = 9;
      whirGain = ac.createGain(); whirGain.gain.value = 0;
      n2.connect(whirFilter); whirFilter.connect(whirGain); whirGain.connect(dry);
      n2.start();
      padGain = ac.createGain(); padGain.gain.value = 0;
      [110, 164.81, 220.5].forEach((f, i) => {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ac.createGain(); g.gain.value = [0.5, 0.32, 0.16][i];
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.05 + i * 0.031;
        const lg = ac.createGain(); lg.gain.value = 0.18;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(padGain);
        o.start(); lfo.start();
      });
      padFilter = ac.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 700; padFilter.Q.value = 0.5;
      padGain.connect(padFilter); padFilter.connect(dry); padFilter.connect(wet);
      const t = ac.currentTime;
      ambGain.gain.setTargetAtTime(0.05, t, 1.5);
      padGain.gain.setTargetAtTime(0.022, t, 2.5);
    }

    function impulse(seconds, decay) {
      const len = Math.floor(ac.sampleRate * seconds);
      const buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function tone(freq, t, peak, attack, decay, type, dest, wetAmt) {
      const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      const g = ac.createGain();
      env(g, t, peak, attack, decay);
      o.connect(g); g.connect(dest || dry);
      if (wetAmt) { const w = ac.createGain(); w.gain.value = wetAmt; g.connect(w); w.connect(wet); }
      o.start(t); o.stop(t + attack + decay + 0.05);
      return o;
    }
    function noise(t, dur, peak, type, freq, q, dest, freqEnd) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      s.playbackRate.value = 1;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = ac.createGain();
      env(g, t, peak, Math.min(0.004, dur * 0.2), dur);
      s.connect(f); f.connect(g); g.connect(dest || dry);
      s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    }

    const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3, 10 / 3, 4];

    return {
      unlock,
      setMuted(m) {
        if (!ac || !master) return;
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05);
      },
      setPaused(p) {
        paused = p;
        if (!ac || !master) return;
        master.gain.setTargetAtTime(p || isMuted() ? 0 : 0.9, ac.currentTime, 0.08);
      },
      tension(t) {
        if (!can()) return;
        const now = ac.currentTime;
        padGain.gain.setTargetAtTime(0.018 + 0.016 * t, now, 1.2);
        padFilter.frequency.setTargetAtTime(700 + 1600 * t, now, 1.5);
        ambGain.gain.setTargetAtTime(0.05 + 0.02 * t, now, 1.5);
      },
      ambience(spinning, total) {
        if (!can()) return;
        const now = ac.currentTime;
        if (now - lastAmb < 0.15) return;
        lastAmb = now;
        whirGain.gain.setTargetAtTime(0.006 * spinning, now, 0.4);
        whirFilter.frequency.setTargetAtTime(900 + 60 * spinning, now, 0.6);
      },
      select() {
        if (!can()) return;
        const t = ac.currentTime;
        noise(t, 0.012, 0.16, 'highpass', 4200, 0.7);
        tone(2350, t, 0.035, 0.001, 0.03, 'triangle');
      },
      brake(speed) {
        if (!can()) return;
        const t = ac.currentTime + 0.005;
        const amt = Math.min(1, speed / 120);
        noise(t, 0.2, 0.05 + 0.04 * amt, 'bandpass', 2600, 5, null, 650);
        noise(t, 0.16, 0.025, 'bandpass', 5200, 12, null, 1800);
      },
      release() {
        if (!can()) return;
        const t = ac.currentTime;
        noise(t, 0.012, 0.1, 'highpass', 3000, 0.7);
        noise(t + 0.01, 0.28, 0.025, 'bandpass', 700, 4, null, 1700);
      },
      lock(alignedCount) {
        if (!can()) return;
        const t = ac.currentTime + 0.01;
        const f = 587.33 * PENTA[Math.min(PENTA.length - 1, Math.max(0, alignedCount - 1))];
        noise(t, 0.01, 0.12, 'highpass', 5000, 0.8);
        const parts = [[1, 0.09, 1.6], [2.32, 0.035, 0.9], [4.25, 0.016, 0.5], [6.63, 0.008, 0.28]];
        parts.forEach(p => tone(f * p[0], t, p[1], 0.002, p[2], 'sine', dry, 0.6));
      },
      miss() {
        if (!can()) return;
        const t = ac.currentTime;
        const o = ac.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(118, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.18);
        const g = ac.createGain(); env(g, t, 0.24, 0.003, 0.26);
        o.connect(g); g.connect(dry); o.start(t); o.stop(t + 0.32);
        noise(t, 0.12, 0.06, 'lowpass', 420, 0.8);
      },
      complete(n) {
        if (!can()) return;
        const t = ac.currentTime + 0.02;
        const root = 293.66;
        const chord = [1, 1.5, 2, 2.5, 3, 3.75, 4.5];
        chord.forEach((m, i) => {
          tone(root * m, t + i * 0.045, 0.05 / (1 + i * 0.25), 0.02, 2.4 - i * 0.15, 'sine', dry, 0.9);
          tone(root * m * 2.01, t + i * 0.045, 0.008, 0.01, 1.2, 'sine', dry, 0.9);
        });
        noise(t, 0.6, 0.012, 'bandpass', 6000, 2, wet, 9000);
      },
      over(newBest) {
        if (!can()) return;
        const t = ac.currentTime + 0.05;
        padGain.gain.setTargetAtTime(0.008, t, 1.5);
        padFilter.frequency.setTargetAtTime(500, t, 1.5);
        if (newBest) {
          [1, 1.25, 1.5, 2].forEach((m, i) => tone(587.33 * m, t + 1.1 + i * 0.12, 0.04, 0.004, 1.8, 'sine', dry, 0.8));
        }
        tone(392, t, 0.05, 0.03, 2.2, 'sine', dry, 0.8);
        tone(293.66, t + 0.35, 0.05, 0.04, 2.8, 'sine', dry, 0.8);
        tone(196, t + 0.35, 0.03, 0.08, 3.2, 'sine', dry, 0.8);
      }
    };
  }

  // ==========================================================================
  // HUD markup and styles.
  // ==========================================================================
  const ICON_SOUND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="square"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path class="w1" d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path class="w2" d="M17.8 6.8a7.5 7.5 0 0 1 0 10.4"/><path class="x" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25"><path class="pz" d="M9 6.5v11M15 6.5v11"/><path class="pl" d="M8.5 6.5l9 5.5-9 5.5z"/></svg>';

  const HUD_HTML = [
    '<style>',
    '.sd{position:absolute;inset:0;color:#ece8e1;font-family:Inter,"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;font-feature-settings:"tnum" 1,"ss01" 1}',
    '.sd *{box-sizing:border-box}',
    '.sd-top{position:absolute;left:var(--sd-left);right:var(--sd-right);top:calc(var(--sd-top) + 10px);height:84px;opacity:0;visibility:hidden;transition:opacity .8s ease,visibility 0s linear .8s}',
    '.sd-top.show{opacity:1;visibility:visible;transition:opacity .8s ease,visibility 0s}',
    '.sd-mark{position:absolute;left:0;top:11px;font-size:9.5px;font-weight:600;letter-spacing:.34em;color:rgba(236,232,225,.62)}',
    '.sd-ctrls{position:absolute;right:-10px;top:0;display:flex}',
    '.sd-btn-i{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:0;padding:0;color:rgba(236,232,225,.7);cursor:pointer;outline:none}',
    '.sd-btn-i:active{color:#fff}',
    '.sd-sound .x{display:none}.sd-sound.is-muted .x{display:inline}.sd-sound.is-muted .w1,.sd-sound.is-muted .w2{display:none}',
    '.sd-pause .pl{display:none}.sd-pause.is-paused .pl{display:inline}.sd-pause.is-paused .pz{display:none}',
    '.sd-score{position:absolute;left:50%;top:2px;transform:translateX(-50%);font-size:24px;font-weight:400;letter-spacing:.02em;color:#f1ede6;font-variant-numeric:tabular-nums}',
    '.sd-meta{position:absolute;left:0;right:0;top:44px;display:flex;justify-content:center;align-items:center;gap:14px;font-size:9.5px;font-weight:600;letter-spacing:.24em;color:rgba(236,232,225,.5);white-space:nowrap}',
    '.sd-meta .sep{width:14px;height:1px;background:rgba(236,232,225,.22)}',
    '.sd-misses{display:flex;gap:5px;align-items:center}',
    '.sd-misses i{display:block;width:10px;height:2px;background:rgba(236,232,225,.16);transition:background .3s}',
    '.sd-misses i.on{background:rgba(236,232,225,.62)}',
    '.sd-misses.pulse i:not(.on){animation:sdpulse .9s ease}',
    '@keyframes sdpulse{0%{background:#d8b08a}100%{}}',
    '.sd-streak{position:absolute;left:0;right:0;top:64px;text-align:center;font-size:9px;font-weight:600;letter-spacing:.3em;color:rgba(191,233,242,.7);transition:opacity .4s}',
    '.sd-hint{position:absolute;left:0;right:0;bottom:calc(var(--sd-bottom) + 18px);text-align:center;font-size:9.5px;font-weight:600;letter-spacing:.28em;color:rgba(236,232,225,.5);opacity:0;transform:translateY(4px);transition:opacity .7s ease,transform .7s ease;padding:0 24px}',
    '.sd-hint.show{opacity:1;transform:none}',
    '.sd-readout{position:absolute;left:0;right:0;top:calc(var(--sd-axis-y) - 14px);display:flex;justify-content:center;align-items:baseline;gap:10px;opacity:0;transition:opacity .35s ease;pointer-events:none}',
    '.sd-readout.show{opacity:1}',
    '.sd-readout .v{font-size:13px;font-weight:400;letter-spacing:.06em;font-variant-numeric:tabular-nums}',
    '.sd-readout .s{font-size:9px;font-weight:600;letter-spacing:.26em;opacity:.7}',
    '.sd-readout.lock{color:#cdeef5}.sd-readout.miss{color:#dcbc9a}',
    '.sd-flash{position:absolute;left:0;right:0;top:calc(var(--sd-sculpt-bottom) + 14px);display:flex;flex-direction:column;align-items:center;gap:6px;font-size:9.5px;font-weight:600;letter-spacing:.3em;color:rgba(205,238,245,.8);opacity:0;pointer-events:none}',
    '.sd-flash .b{color:rgba(236,232,225,.6);font-weight:400}',
    '.sd-flash.show{animation:sdflash 1.6s ease forwards}',
    '@keyframes sdflash{0%{opacity:0;transform:translateY(4px)}18%{opacity:1;transform:none}70%{opacity:1}100%{opacity:0}}',
    '.sd-layer{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .6s ease,visibility 0s linear .6s}',
    '.sd-layer.show{opacity:1;visibility:visible;transition:opacity .6s ease,visibility 0s}',
    '.sd-intro .sd-head{position:absolute;left:24px;right:24px;top:calc(var(--sd-top) + 22px);text-align:center}',
    '.sd-title{font-size:26px;font-weight:600;letter-spacing:.32em;padding-left:.32em;color:#f1ede6}',
    '.sd-tag{margin-top:12px;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:21px;letter-spacing:.01em;color:rgba(236,232,225,.78)}',
    '.sd-intro-foot{position:absolute;left:24px;right:24px;bottom:calc(var(--sd-bottom) + 12px);display:flex;flex-direction:column;align-items:center;gap:18px}',
    '.sd-instr{font-size:9.5px;font-weight:600;letter-spacing:.26em;line-height:1.9;color:rgba(236,232,225,.55);text-align:center;max-width:300px}',
    '.sd-intro-best{font-size:9px;font-weight:600;letter-spacing:.24em;color:rgba(236,232,225,.38);min-height:12px;text-align:center}',
    '.sd-btn{appearance:none;-webkit-appearance:none;background:rgba(23,25,27,.35);border:1px solid rgba(236,232,225,.42);color:#f1ede6;font:inherit;font-size:10.5px;font-weight:600;letter-spacing:.36em;padding:0 0 0 .36em;height:50px;min-width:188px;border-radius:2px;cursor:pointer;outline:none;transition:border-color .25s,background .25s}',
    '.sd-btn:active{background:rgba(191,233,242,.08);border-color:rgba(191,233,242,.7)}',
    '.sd-btn-text{appearance:none;background:none;border:0;color:rgba(236,232,225,.55);font:inherit;font-size:9.5px;font-weight:600;letter-spacing:.3em;padding:12px 16px;cursor:pointer}',
    '.sd-over,.sd-paused{background:radial-gradient(ellipse at 50% var(--sd-cy),rgba(16,17,19,.93) 0%,rgba(16,17,19,.86) 45%,rgba(16,17,19,.8) 100%)}',
    '.sd-over-in{position:absolute;left:24px;right:24px;top:calc(var(--sd-top) + 40px);bottom:calc(var(--sd-bottom) + 16px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
    '.sd-k{font-size:9px;font-weight:600;letter-spacing:.3em;color:rgba(236,232,225,.45)}',
    '.sd-over-label{font-size:9.5px;font-weight:600;letter-spacing:.34em;color:rgba(220,188,154,.85)}',
    '.sd-over-score{margin-top:22px;font-size:54px;font-weight:400;letter-spacing:.01em;color:#f3efe8;font-variant-numeric:tabular-nums;line-height:1}',
    '.sd-over-grid{margin-top:34px;display:grid;grid-template-columns:repeat(3,minmax(0,92px));gap:0;border-top:1px solid rgba(236,232,225,.14);border-bottom:1px solid rgba(236,232,225,.14)}',
    '.sd-over-grid div{padding:16px 4px;display:flex;flex-direction:column;gap:8px}',
    '.sd-over-grid div+div{border-left:1px solid rgba(236,232,225,.1)}',
    '.sd-over-grid b{font-size:17px;font-weight:400;color:#ece8e1;font-variant-numeric:tabular-nums}',
    '.sd-over-best{margin-top:22px;font-size:9px;font-weight:600;letter-spacing:.24em;color:rgba(236,232,225,.5);min-height:12px}',
    '.sd-over-best .nb{color:#cdeef5}',
    '.sd-over-rank{margin-top:10px;font-size:9px;font-weight:600;letter-spacing:.24em;color:rgba(236,232,225,.38);min-height:12px}',
    '.sd-over-board{margin-top:14px;display:flex;flex-direction:column;gap:7px;min-height:0;width:220px}',
    '.sd-over-board .row{display:flex;justify-content:space-between;gap:12px;font-size:10px;letter-spacing:.14em;color:rgba(236,232,225,.55);font-variant-numeric:tabular-nums}',
    '.sd-over-board .row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}',
    '.sd-over-board .row.me{color:#cdeef5}',
    '.sd-over .sd-btn{margin-top:30px}',
    '.sd-paused .sd-over-in{gap:14px}',
    '.sd-paused .sd-title{font-size:13px;letter-spacing:.42em;margin-bottom:22px;color:rgba(236,232,225,.8)}',
    '</style>',
    '<div class="sd">',
    '  <div class="sd-top">',
    '    <div class="sd-mark">SPIN DOCTOR</div>',
    '    <div class="sd-score" aria-live="polite">0</div>',
    '    <div class="sd-ctrls"><button class="sd-btn-i sd-sound" aria-label="Sound">' + ICON_SOUND + '</button><button class="sd-btn-i sd-pause" aria-label="Pause">' + ICON_PAUSE + '</button></div>',
    '    <div class="sd-meta"><span class="sd-round">ROUND 01</span><span class="sep"></span><span class="sd-aligned">00 / 03 ALIGNED</span><span class="sep"></span><span class="sd-misses"></span></div>',
    '    <div class="sd-streak"></div>',
    '  </div>',
    '  <div class="sd-readout"></div>',
    '  <div class="sd-flash"></div>',
    '  <div class="sd-hint"></div>',
    '  <div class="sd-layer sd-intro">',
    '    <div class="sd-head"><div class="sd-title">SPIN DOCTOR</div><div class="sd-tag">Align the impossible.</div></div>',
    '    <div class="sd-intro-foot">',
    '      <div class="sd-instr">TAP EACH RING WHEN ITS MARKER<br>REACHES THE AXIS.</div>',
    '      <button class="sd-btn sd-play">PLAY</button>',
    '      <div class="sd-intro-best"></div>',
    '    </div>',
    '  </div>',
    '  <div class="sd-layer sd-over">',
    '    <div class="sd-over-in">',
    '      <div class="sd-over-label">ALIGNMENT LOST</div>',
    '      <div class="sd-over-score">0</div>',
    '      <div class="sd-k" style="margin-top:12px">FINAL SCORE</div>',
    '      <div class="sd-over-grid">',
    '        <div><span class="sd-k">ROUND</span><b class="sd-over-round">01</b></div>',
    '        <div><span class="sd-k">PRECISION</span><b class="sd-over-prec">—</b></div>',
    '        <div><span class="sd-k">STREAK</span><b class="sd-over-streak">00</b></div>',
    '      </div>',
    '      <div class="sd-over-best"></div>',
    '      <div class="sd-over-rank"></div>',
    '      <div class="sd-over-board"></div>',
    '      <button class="sd-btn sd-restart">RESTART</button>',
    '    </div>',
    '  </div>',
    '  <div class="sd-layer sd-paused">',
    '    <div class="sd-over-in">',
    '      <div class="sd-title">PAUSED</div>',
    '      <button class="sd-btn sd-resume">RESUME</button>',
    '      <button class="sd-btn-text sd-pause-restart">RESTART RUN</button>',
    '    </div>',
    '  </div>',
    '  <div class="sd-fail"></div>',
    '</div>'
  ].join('\n');
})();
