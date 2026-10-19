// REWIND — a time-manipulation arcade run through a horological city.
//
// The world moves through time. The player moves through the world.
//
// Architecture (all inside init so every resource is cleanup-owned by Plethora):
//   1. Constants and math helpers
//   2. Temporal clock ........ world time T, rate, frontier. The only world state.
//   3. Visual kit ............ procedural textures, materials, geometry baking
//   4. Elements .............. Span, Ferry, Orrery ring, Fold stair, Gate, Gnomon, Shard.
//                              Every element is a pure function of T: render(T) and
//                              colliders(T) read the same state function, so what you
//                              see is exactly what you can stand on, in either direction.
//   5. Encounters ............ designed templates + seeded endless generator + validator
//   6. Course ................ lazy segment building/disposal, collider queries
//   7. Player ................ independent fixed-step physics (never rewound)
//   8. Character rig ......... procedural animation
//   9. Camera, atmosphere .... fixed three-quarter follow camera, sky, fog, motes, monuments
//  10. Audio ................. procedural WebAudio (ticks follow world time)
//  11. Input ................. keyboard + independent multitouch zones
//  12. HUD ................... score, time ribbon, hints, screens
//  13. Run loop .............. scoring, rewards, failure, restart

window.plethoraBit = {
  meta: {
    title: "REWIND",
    runtime: "plethora-bit@2",
    tags: ["arcade", "runner", "time", "3d", "puzzle"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    try {
      return await window.plethoraBit._run(ctx);
    } catch (err) {
      const msg = String((err && (err.stack || err.message)) || err);
      try { ctx.platform.error({ stage: "init", message: msg.slice(0, 500) }); } catch (e) {}
      try {
        const r = ctx.createRoot({ style: "z-index:99;background:rgba(240,234,222,.94);color:#3a2a20;font:12px/1.4 monospace;padding:16px;white-space:pre-wrap;overflow:auto;" });
        r.textContent = "REWIND could not start (REWIND 2.0 b1).\n\n" + msg.slice(0, 1200);
      } catch (e) {}
      try { ctx.platform.ready(); } catch (e) {}
    }
  },

  async _run(ctx) {
    // =====================================================================
    // 1. CONSTANTS AND MATH
    // =====================================================================
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
    const easeOutBack = (t) => {
      t = clamp(t, 0, 1);
      const c1 = 1.25, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };
    const wrapAngle = (a) => {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    };
    const posMod = (a, m) => ((a % m) + m) % m;
    const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hash1(n) {
      let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      x ^= x >>> 16;
      return (x >>> 0) / 4294967296;
    }

    // World units: 1 unit ~ 0.8 m. Course runs along s (world z = -s), x is lateral, y is up.
    const G = 24;                 // gravity for the player and for falling stone
    const RUN_BASE = 5.6;         // cruise speed at the start of a run
    const RUN_MAX = 7.0;          // cruise speed deep into a run
    const STEER_SPEED = 4.4;
    const BRAKE_DECEL = 18;
    const RUN_ACCEL = 7;
    const BODY_R = 0.26;
    const BODY_H = 1.3;
    const STEP_UP = 0.55;
    const KILL_DEPTH = 19;        // fall this far below the last ground and history can no longer help
    // The temporal current: the world always flows forward at FWD_RATE during play.
    // Holding REWIND reverses it; holding FAST-FORWARD hurries it. Only the pause menu stops it.
    const FWD_RATE = 1.0;
    const FF_RATE = 2.2;
    const REV_RATE = 1.6;
    const MOVE_ACCEL = 30;        // ground acceleration toward the stick's intended velocity
    const MOVE_DECEL = 34;        // ground deceleration when the stick is released
    const AIR_ACCEL = 7;
    const FIXED_HZ = 120;
    const DT = 1 / FIXED_HZ;
    const METERS_PER_UNIT = 0.8;

    const runSpeedAt = (s) => RUN_BASE + (RUN_MAX - RUN_BASE) * smooth(s / 1600);

    const reducedMotionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

    const storage = {
      get(k, d) {
        try {
          if (!ctx.capabilities || !ctx.capabilities.storage || !ctx.storage) return d;
          const v = ctx.storage.get(k);
          return v == null ? d : v;
        } catch (e) { return d; }
      },
      set(k, v) {
        try { if (ctx.capabilities && ctx.capabilities.storage && ctx.storage) ctx.storage.set(k, v); } catch (e) {}
      }
    };

    const settings = {
      muted: !!storage.get("muted", false),
      reducedMotion: storage.get("reducedMotion", null),
      hintsSeen: storage.get("hintsSeen2", {}) || {}
    };
    if (settings.reducedMotion == null) settings.reducedMotion = !!(reducedMotionQuery && reducedMotionQuery.matches);

    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // =====================================================================
    // 2. TEMPORAL CLOCK
    // World time is the only world state. Everything in the world is evaluated from it.
    // History policy: the world is fully time-addressable from T = 0 (the beginning of
    // recorded history) to any future time, because every element is a deterministic
    // function of T. Reversing is never capped by snapshot buffers; it stops only at 0.
    // =====================================================================
    const clock = {
      T: 0,
      prevT: 0,
      rate: 0,          // smoothed actual rate
      target: 0,        // requested rate from input
      frontier: 0,      // furthest world time reached this run
      atFloor: false,   // pressing reverse at the beginning of history
      dir: 0,           // -1, 0, +1 for HUD/audio/colour
      reset() {
        this.T = 0; this.prevT = 0; this.rate = 0; this.target = 0; this.frontier = 0; this.atFloor = false; this.dir = 0;
      },
      // mode: "rev" | "ff" | "flow" | "stop"
      step(dt, mode) {
        this.prevT = this.T;
        this.target = mode === "rev" ? -REV_RATE : mode === "ff" ? FF_RATE : mode === "flow" ? FWD_RATE : 0;
        // Short spool so direction changes feel weighty but stay responsive (~70 ms).
        this.rate = damp(this.rate, this.target, 15, dt);
        if (Math.abs(this.rate - this.target) < 0.002) this.rate = this.target;
        let next = this.T + this.rate * dt;
        this.atFloor = false;
        if (next <= 0) {
          next = 0;
          if (this.target < 0) this.atFloor = true;
          if (this.rate < 0) this.rate = 0;
        }
        this.T = next;
        if (this.T > this.frontier) this.frontier = this.T;
        this.dir = this.rate > 0.15 ? 1 : this.rate < -0.15 ? -1 : 0;
        this.fast = this.rate > FWD_RATE + 0.3;
      }
    };

    // =====================================================================
    // HUD shell first, so the very first frame is never blank.
    // =====================================================================
    // Surfaces, in stacking order: the play canvas first (plain surface, native interactivity,
    // the same pattern as this repo's pinball bit), then the HUD root above it, which lets
    // touches pass through except on its own buttons.
    const canvas = ctx.createCanvas({ touchAction: "none" });
    try { if (ctx.surface && ctx.surface.enableInput) ctx.surface.enableInput(canvas); } catch (e) {}
    const hudRoot = ctx.createRoot({ style: "pointer-events:none;touch-action:none;" });
    hudRoot.innerHTML =
      '<div id="rw-boot" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(#efe6d6,#c9c3b8 60%,#8d9aa0);font-family:Georgia,serif;color:#3d4a4e;letter-spacing:0.5em;font-size:28px">REWIND</div>';
    ctx.markVisualReady("boot-title");

    // =====================================================================
    // THREE + RENDERER
    // =====================================================================
    let THREE;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (err) {
      ctx.platform.error({ stage: "library-load", message: String(err && err.message || err) });
      hudRoot.querySelector("#rw-boot").textContent = "Could not load the 3D library. Please reopen REWIND.";
      ctx.platform.ready();
      return;
    }
    if (disposed) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch (err) {
      ctx.platform.error({ stage: "renderer-init", message: String(err && err.message || err) });
      hudRoot.querySelector("#rw-boot").textContent = "WebGL is unavailable on this device.";
      ctx.platform.ready();
      return;
    }
    const isSmallScreen = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, isSmallScreen ? 2 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (e) {} });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, ctx.width / ctx.height, 0.3, 700);

    // =====================================================================
    // 3. VISUAL KIT
    // =====================================================================
    const TEX_UNIT = 4.8; // world units covered by one texture repeat

    // Offscreen paint surfaces for procedural textures: created through the runtime, then
    // detached so they never take part in layout or input.
    function makeCanvas(w, h) {
      if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.style.pointerEvents = "none";
      c.width = w; c.height = h;
      return c;
    }
    function canvasTexture(c, repeat) {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      return t;
    }

    // Limestone paving: 4x4 tiles per repeat, faint tone variation, fine grain, recessed seams.
    function makeTileTexture() {
      const S = 512, c = makeCanvas(S, S), g = c.getContext("2d");
      const rnd = mulberry32(1234);
      const tile = S / 4;
      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const v = 0.96 + rnd() * 0.07;
          const r = Math.round(233 * v), gg = Math.round(223 * v), b = Math.round(203 * v);
          g.fillStyle = "rgb(" + r + "," + gg + "," + b + ")";
          g.fillRect(tx * tile, ty * tile, tile, tile);
        }
      }
      const img = g.getImageData(0, 0, S, S);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 14;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9;
      }
      g.putImageData(img, 0, 0);
      // soft mottling
      for (let k = 0; k < 90; k++) {
        g.fillStyle = "rgba(150,135,110," + (0.025 + rnd() * 0.035) + ")";
        g.beginPath();
        g.arc(rnd() * S, rnd() * S, 4 + rnd() * 22, 0, TAU);
        g.fill();
      }
      for (let i = 0; i <= 4; i++) {
        const p = i * tile;
        g.fillStyle = "rgba(120,104,84,0.55)";
        g.fillRect(p - 2, 0, 3, S); g.fillRect(0, p - 2, S, 3);
        g.fillStyle = "rgba(255,250,238,0.35)";
        g.fillRect(p + 1, 0, 1, S); g.fillRect(0, p + 1, S, 1);
      }
      return canvasTexture(c, true);
    }
    // Sedimentary strata for vertical faces.
    function makeGrainTexture(base) {
      const S = 256, c = makeCanvas(S, S), g = c.getContext("2d");
      const rnd = mulberry32(99);
      g.fillStyle = base;
      g.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y += 2) {
        const a = 0.03 + 0.05 * Math.abs(Math.sin(y * 0.11) * Math.sin(y * 0.037));
        g.fillStyle = "rgba(90,80,64," + a.toFixed(3) + ")";
        g.fillRect(0, y, S, 2);
      }
      const img = g.getImageData(0, 0, S, S);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 12;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      // course joints every 64px
      for (let y = 0; y < S; y += 64) {
        g.fillStyle = "rgba(80,70,56,0.32)"; g.fillRect(0, y, S, 2);
        for (let x = (y / 64) % 2 ? 32 : 0; x < S; x += 96) { g.fillRect(x, y, 2, 64); }
      }
      return canvasTexture(c, true);
    }
    function makeCrackTexture() {
      const S = 256, c = makeCanvas(S, S), g = c.getContext("2d");
      const rnd = mulberry32(7);
      g.clearRect(0, 0, S, S);
      g.strokeStyle = "rgba(255,214,150,1)";
      g.lineCap = "round";
      function crack(x, y, a, len, w, depth) {
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x, y);
        let px = x, py = y;
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          a += (rnd() - 0.5) * 0.9;
          px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
          g.lineTo(px, py);
          if (depth > 0 && rnd() < 0.3) crack(px, py, a + (rnd() - 0.5) * 2, len * 0.5, w * 0.6, depth - 1);
        }
        g.stroke();
      }
      for (let k = 0; k < 4; k++) crack(S * 0.5 + (rnd() - 0.5) * 40, S * 0.5 + (rnd() - 0.5) * 40, rnd() * TAU, S * 0.55, 3, 2);
      const t = canvasTexture(c, false);
      return t;
    }
    function makeGlowTexture() {
      const S = 128, c = makeCanvas(S, S), g = c.getContext("2d");
      const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
      return canvasTexture(c, false);
    }
    function makeDialTexture() {
      const S = 256, c = makeCanvas(S, S), g = c.getContext("2d");
      g.fillStyle = "#e6dcc6"; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, TAU); g.fill();
      g.strokeStyle = "#6c5d48"; g.lineWidth = 6; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 8, 0, TAU); g.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.lineWidth = i % 3 === 0 ? 8 : 4;
        g.beginPath();
        g.moveTo(S / 2 + Math.cos(a) * (S / 2 - 18), S / 2 + Math.sin(a) * (S / 2 - 18));
        g.lineTo(S / 2 + Math.cos(a) * (S / 2 - (i % 3 === 0 ? 44 : 32)), S / 2 + Math.sin(a) * (S / 2 - (i % 3 === 0 ? 44 : 32)));
        g.stroke();
      }
      return canvasTexture(c, false);
    }

    const tex = {
      tile: makeTileTexture(),
      grain: makeGrainTexture("#cdbb9e"),
      grainCool: makeGrainTexture("#9aa8ab"),
      crack: makeCrackTexture(),
      glow: makeGlowTexture(),
      dial: makeDialTexture()
    };

    // Occlusion dither: any surface between the camera and the player dissolves into a
    // stipple so the player is never hidden by monumental architecture.
    const occl = {
      uRwPlayer: { value: new THREE.Vector3() },
      uRwCam: { value: new THREE.Vector3() },
      uRwAhead: { value: new THREE.Vector3() },
      uRwAbyss: { value: new THREE.Color(0x5d7480) }
    };
    // decor=true also keeps the route ahead visible (arches, ring stonework, gate frames)
    function patchOcclusion(mat, decor) {
      const aheadTest = decor
        ? " { vec3 ab = uRwAhead - uRwCam; float L2 = dot(ab, ab);" +
          "   float t = clamp(dot(vRwWorld - uRwCam, ab) / L2, 0.0, 1.0);" +
          "   float d = length(vRwWorld - (uRwCam + ab * t));" +
          "   float r = mix(3.0, 2.2, t);" +
          "   float fade = (1.0 - smoothstep(r * 0.5, r, d)) * smoothstep(0.03, 0.12, t) * (1.0 - smoothstep(0.8, 0.92, t)) * 0.8;" +
          "   if (fade > 0.0 && rwBayer(gl_FragCoord.xy + 1.0) < fade) discard; }"
        : "";
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uRwPlayer = occl.uRwPlayer;
        shader.uniforms.uRwCam = occl.uRwCam;
        shader.uniforms.uRwAhead = occl.uRwAhead;
        shader.uniforms.uRwAbyss = occl.uRwAbyss;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vRwWorld;")
          .replace("#include <project_vertex>",
            "#include <project_vertex>\n vec4 rwW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n rwW = instanceMatrix * rwW;\n#endif\n vRwWorld = (modelMatrix * rwW).xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>",
            "#include <common>\nvarying vec3 vRwWorld;\nuniform vec3 uRwPlayer;\nuniform vec3 uRwCam;\nuniform vec3 uRwAhead;\nuniform vec3 uRwAbyss;\n" +
            "float rwBayer(vec2 p){ vec2 q = mod(floor(p), 4.0); int i = int(q.x) + int(q.y) * 4;" +
            " float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;" +
            " for(int k=0;k<16;k++){ if(k==i) return (m[k]+0.5)/16.0; } return 0.5; }")
          .replace("#include <clipping_planes_fragment>",
            "#include <clipping_planes_fragment>\n" +
            " { vec3 ab = uRwPlayer - uRwCam; float L2 = dot(ab, ab);" +
            "   float t = clamp(dot(vRwWorld - uRwCam, ab) / L2, 0.0, 1.0);" +
            "   float d = length(vRwWorld - (uRwCam + ab * t));" +
            "   float r = mix(3.2, 1.25, t);" +
            "   float fade = (1.0 - smoothstep(r * 0.55, r, d)) * smoothstep(0.03, 0.12, t) * (1.0 - smoothstep(0.86, 0.95, t));" +
            "   if (fade > 0.0 && rwBayer(gl_FragCoord.xy) < fade * 0.92) discard; }" + aheadTest)
          // depth fog: what lies below the course sinks into blue-grey air, what lies far
          // away dissolves into the horizon haze
          .replace("#include <fog_fragment>",
            "#ifdef USE_FOG\n float rwDeep = smoothstep(-3.0, -46.0, vRwWorld.y);\n" +
            " gl_FragColor.rgb = mix(gl_FragColor.rgb, uRwAbyss, rwDeep * 0.82);\n" +
            " float rwFog = smoothstep(fogNear, fogFar, vFogDepth);\n" +
            " gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uRwAbyss, rwDeep), rwFog);\n#endif");
      };
      mat.customProgramCacheKey = () => (decor ? "rw-occl-decor" : "rw-occl");
      return mat;
    }
    function stdMat(opts, decor) { return patchOcclusion(new THREE.MeshStandardMaterial(opts), decor); }

    const mats = {
      top: stdMat({ map: tex.tile, roughness: 0.92, metalness: 0 }),
      side: stdMat({ map: tex.grain, roughness: 0.95 }),
      deep: stdMat({ map: tex.grainCool, color: 0x9eb0b6, roughness: 1 }),
      trim: stdMat({ color: 0xd2c3a6, roughness: 0.85 }),
      ivory: stdMat({ color: 0xefe6d4, roughness: 0.8 }),
      patina: stdMat({ color: 0x4c8d86, roughness: 0.45, metalness: 0.35 }),
      patinaDark: stdMat({ color: 0x3d6762, roughness: 0.55, metalness: 0.3 }),
      brass: stdMat({ color: 0xc9a45e, roughness: 0.36, metalness: 0.7 }),
      slate: stdMat({ color: 0x75858a, roughness: 0.9 }),
      dial: stdMat({ map: tex.dial, roughness: 0.7 }, true),
      dSide: stdMat({ map: tex.grain, roughness: 0.95 }, true),
      dTrim: stdMat({ color: 0xd2c3a6, roughness: 0.85 }, true),
      dIvory: stdMat({ color: 0xefe6d4, roughness: 0.8 }, true),
      dBrass: stdMat({ color: 0xc9a45e, roughness: 0.36, metalness: 0.7 }, true),
      dPatina: stdMat({ color: 0x4c8d86, roughness: 0.45, metalness: 0.35 }, true),
      far: stdMat({ color: 0xb8b2a6, roughness: 1, map: tex.grain }),
      farCool: stdMat({ color: 0x8aa2aa, roughness: 1 }),
      cloak: new THREE.MeshStandardMaterial({ color: 0xbd5d3a, roughness: 0.72 }),
      cloakDark: new THREE.MeshStandardMaterial({ color: 0x7b3826, roughness: 0.8 }),
      mask: new THREE.MeshStandardMaterial({ color: 0xf3ebdc, roughness: 0.55 }),
      legs: new THREE.MeshStandardMaterial({ color: 0x3e3a3c, roughness: 0.85 }),
      charm: new THREE.MeshBasicMaterial({ color: 0xffd28a }),
      shard: new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffa53a, emissiveIntensity: 1.25, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.94 }),
      shardCore: new THREE.MeshBasicMaterial({ color: 0xfff6dc }),
      shardSpent: new THREE.MeshBasicMaterial({ color: 0xbfe6ea, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
      glowGold: new THREE.SpriteMaterial({ map: tex.glow, color: 0xffc46e, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
      cyanLine: new THREE.MeshBasicMaterial({ color: 0x8fe3ea, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
      openArc: new THREE.MeshBasicMaterial({ color: 0x5fb9b8, side: THREE.DoubleSide }),
      groove: new THREE.MeshBasicMaterial({ color: 0x8f7f68, transparent: true, opacity: 0.45, depthWrite: false })
    };

    // ---- geometry baking: many static boxes -> one mesh per material, world-planar UVs ----
    const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const geoCache = new Map();
    function cachedGeo(key, make) {
      let g = geoCache.get(key);
      if (!g) { g = make(); geoCache.set(key, g); }
      return g;
    }
    ctx.onDestroy(() => { geoCache.forEach((g) => g.dispose()); });

    // box spec: { x, top, s0, s1, w, depth, mat:'stone'|'deep'|'trim'|..., ry? }
    function bakeBoxes(boxes) {
      const buckets = new Map();
      const push = (m) => { let b = buckets.get(m); if (!b) { b = { pos: [], nor: [], uv: [] }; buckets.set(m, b); } return b; };
      const P = unitBox.attributes.position.array, N = unitBox.attributes.normal.array;
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      const mtx = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
      for (const b of boxes) {
        const d = b.s1 - b.s0;
        tr.set(b.x, b.top - b.depth / 2, -(b.s0 + b.s1) / 2);
        sc.set(b.w, b.depth, d);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry || 0);
        mtx.compose(tr, q, sc);
        nm.getNormalMatrix(mtx);
        const kind = b.mat || "stone";
        for (let i = 0; i < P.length; i += 9) {
          n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(nm).normalize();
          let m;
          if (kind === "stone") m = n.y > 0.5 ? mats.top : mats.side;
          else m = mats[kind] || mats.side;
          const bucket = push(m);
          for (let k = 0; k < 9; k += 3) {
            v.set(P[i + k], P[i + k + 1], P[i + k + 2]).applyMatrix4(mtx);
            bucket.pos.push(v.x, v.y, v.z);
            bucket.nor.push(n.x, n.y, n.z);
            const ax = Math.abs(n.x), ay = Math.abs(n.y);
            if (ay > 0.5) bucket.uv.push(v.x / TEX_UNIT, -v.z / TEX_UNIT);
            else if (ax > 0.5) bucket.uv.push(-v.z / TEX_UNIT, v.y / TEX_UNIT);
            else bucket.uv.push(v.x / TEX_UNIT, v.y / TEX_UNIT);
          }
        }
      }
      const group = new THREE.Group();
      buckets.forEach((b, m) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.ownGeo = true;
        group.add(mesh);
      });
      return group;
    }

    // Box mesh with world-scaled UVs for moving parts (cached by size).
    function boxMesh(w, h, d, mat, opts) {
      const key = "b" + w.toFixed(3) + "_" + h.toFixed(3) + "_" + d.toFixed(3);
      const geo = cachedGeo(key, () => {
        const g = new THREE.BoxGeometry(w, h, d);
        const uv = g.attributes.uv, nrm = g.attributes.normal;
        for (let i = 0; i < uv.count; i++) {
          const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
          const su = ny > 0.5 ? w : nx > 0.5 ? d : w;
          const sv = ny > 0.5 ? d : h;
          uv.setXY(i, uv.getX(i) * su / TEX_UNIT, uv.getY(i) * sv / TEX_UNIT);
        }
        return g;
      });
      let m = mat;
      if (Array.isArray(mat)) m = mat;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = !(opts && opts.noShadow);
      mesh.receiveShadow = true;
      return mesh;
    }
    // stone block: paved top + strata sides
    const stoneMats = [mats.side, mats.side, mats.top, mats.side, mats.side, mats.side];
    function stoneBox(w, h, d) { return boxMesh(w, h, d, stoneMats); }

    // Merge every mesh rigidly attached under `group` into one mesh per material (fewer draw
    // calls on phones). Objects listed in `keep` (and their subtrees) are left untouched.
    function mergeRigid(group, keep) {
      const keepSet = new Set(keep || []);
      group.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
      const buckets = new Map();
      const victims = [];
      const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
      const visit = (o) => {
        if (keepSet.has(o)) return;
        if (o.isMesh && !o.isInstancedMesh && o !== group) {
          victims.push(o);
          m.multiplyMatrices(inv, o.matrixWorld);
          nm.getNormalMatrix(m);
          const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
          const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
          const groups = Array.isArray(o.material) ? (g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }]) : [{ start: 0, count: P.count, materialIndex: -1 }];
          for (const gr of groups) {
            const mat = gr.materialIndex < 0 ? o.material : o.material[gr.materialIndex];
            let bk = buckets.get(mat);
            if (!bk) { bk = { pos: [], nor: [], uv: [], shadow: false }; buckets.set(mat, bk); }
            bk.shadow = bk.shadow || o.castShadow;
            for (let i = gr.start; i < gr.start + gr.count; i++) {
              v.fromBufferAttribute(P, i).applyMatrix4(m);
              n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
              bk.pos.push(v.x, v.y, v.z); bk.nor.push(n.x, n.y, n.z);
              if (U) bk.uv.push(U.getX(i), U.getY(i)); else bk.uv.push(0, 0);
            }
          }
          if (g !== o.geometry) g.dispose();
        }
        for (const c of o.children.slice()) visit(c);
      };
      visit(group);
      for (const o of victims) if (o.parent) o.parent.remove(o);
      buckets.forEach((bk, mat) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(bk.pos, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(bk.nor, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(bk.uv, 2));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = bk.shadow; mesh.receiveShadow = true;
        mesh.userData.ownGeo = true;
        group.add(mesh);
      });
      return group;
    }

    function disposeGroup(group) {
      group.traverse((o) => {
        if (o.userData && o.userData.ownGeo && o.geometry) o.geometry.dispose();
        if (o.userData && o.userData.ownMat && o.material) o.material.dispose();
      });
      if (group.parent) group.parent.remove(group);
    }

    // =====================================================================
    // 4. ELEMENTS — every timeline-dependent object is a pure function of world time T.
    //
    // Collider format (course space): { x, s, hx, hs, top, bottom, sup, roll, px, py, id }
    //   sup=true  -> a surface the player can stand on (also blocks if taller than a step)
    //   sup=false -> a barrier only (latches, gates, rails)
    //   roll      -> deck rotated about the course axis around pivot (px, py)
    // =====================================================================
    const ABYSS = -46; // visual depth of piers; fog swallows everything below

    // Analytic dust: particles whose positions are a function of (T - birth), so every
    // puff of dust un-happens exactly when time reverses.
    const dustMaterial = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(0xeadfca) }, uScale: { value: 300 } },
      vertexShader:
        "attribute vec3 aVel; attribute float aBirth; attribute float aLife; uniform float uT; uniform float uScale; varying float vA;" +
        "void main(){ float age = uT - aBirth; float alive = step(0.0, age) * step(age, aLife);" +
        " vec3 p = position + aVel * age + vec3(0.0, -0.35 * age * age, 0.0);" +
        " vA = alive * (1.0 - age / aLife) * smoothstep(0.0, 0.08, age);" +
        " vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;" +
        " gl_PointSize = alive * uScale * (0.35 + 0.65 * age / aLife) / -mv.z; }",
      fragmentShader:
        "uniform vec3 uColor; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c);" +
        " if (d > 0.25) discard; gl_FragColor = vec4(uColor, vA * 0.55 * (1.0 - d * 4.0)); }",
      transparent: true,
      depthWrite: false
    });
    function makeDust(entries) {
      // entries: [{ x, y, s, birth, life, count, spread, up, down, seed }]
      const pos = [], vel = [], birth = [], life = [];
      for (const e of entries) {
        const r = mulberry32(e.seed);
        for (let i = 0; i < e.count; i++) {
          const a = r() * TAU, sp = e.spread * (0.4 + r() * 0.6);
          pos.push(e.x + (r() - 0.5) * (e.wx || 1), e.y + (r() - 0.5) * 0.2, -(e.s + (r() - 0.5) * (e.ws || 1)));
          vel.push(Math.cos(a) * sp, e.up * (0.3 + r() * 0.7) - e.down * r(), Math.sin(a) * sp);
          birth.push(e.birth + r() * 0.08);
          life.push(e.life * (0.7 + r() * 0.5));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aVel", new THREE.Float32BufferAttribute(vel, 3));
      g.setAttribute("aBirth", new THREE.Float32BufferAttribute(birth, 1));
      g.setAttribute("aLife", new THREE.Float32BufferAttribute(life, 1));
      const pts = new THREE.Points(g, dustMaterial);
      pts.frustumCulled = false;
      pts.userData.ownGeo = true;
      pts.renderOrder = 5;
      return pts;
    }

    function intervalsIntersect(list, a, b) {
      const out = [];
      for (const [x, y] of list) {
        const lo = Math.max(a, x), hi = Math.min(b, y);
        if (hi > lo) out.push([lo, hi]);
      }
      return out;
    }
    // windows by sampling a predicate over [a, b]
    function sampleWindows(ok, a, b) {
      const out = [];
      const t0 = Math.max(0, a), dt = 0.05;
      let on = false, start = 0;
      for (let t = t0; t <= b; t += dt) {
        const v = ok(t);
        if (v && !on) { on = true; start = t; }
        if (!v && on) { on = false; if (t - start > 0.15) out.push([start, t]); }
      }
      if (on) out.push([start, b]);
      return out;
    }
    // periodic windows: open when ((T - phase) mod P) in [o0, o1)
    function periodicWindows(P, phase, o0, o1, a, b) {
      const out = [];
      const k0 = Math.floor((a - phase) / P) - 1, k1 = Math.ceil((b - phase) / P) + 1;
      for (let k = k0; k <= k1; k++) {
        const lo = phase + k * P + o0, hi = phase + k * P + o1;
        if (hi > a && lo < b) out.push([Math.max(0, lo), hi]);
      }
      return out.filter((w) => w[1] > w[0]);
    }

    // ---------------------------------------------------------------------
    // SPAN — a voussoir bridge that assembles from the abyss and/or collapses in a cascade.
    // ---------------------------------------------------------------------
    class Span {
      constructor(o) {
        this.type = "span";
        this.id = o.id;
        this.x = o.x; this.s0 = o.s0; this.s1 = o.s1; this.w = o.w; this.y = o.y || 0;
        this.collapseAt = o.collapseAt == null ? Infinity : o.collapseAt;
        this.collapseDir = o.collapseDir || 1;
        this.cascade = o.cascade == null ? 0.14 : o.cascade;
        this.assembleAt = o.assembleAt == null ? -Infinity : o.assembleAt;
        this.assembleDir = o.assembleDir || 1;
        this.assembleStagger = o.assembleStagger == null ? 0.1 : o.assembleStagger;
        this.latch = !!o.latch;
        this.chase = !!o.chase;
        this.sMin = this.s0 - 2; this.sMax = this.s1 + 2;
        this.crossS0 = this.s0; this.crossS1 = this.s1; this.crossX = this.x;
        const len = this.s1 - this.s0;
        const n = Math.max(4, Math.round(len / 1.45));
        this.n = n; this.bl = len / n;
        const rnd = mulberry32(o.seed || 1);
        this.group = new THREE.Group();
        this.blocks = [];
        const dustEntries = [];
        for (let i = 0; i < n; i++) {
          const sc = this.s0 + (i + 0.5) * this.bl;
          const tc = this.collapseAt + (this.collapseDir > 0 ? i : n - 1 - i) * this.cascade;
          const ta = this.assembleAt + (this.assembleDir > 0 ? i : n - 1 - i) * this.assembleStagger;
          // arch silhouette: deeper wedges near the piers, thin at mid-span
          const u = (i + 0.5) / n;
          const under = 0.35 + 1.5 * Math.pow(Math.abs(u - 0.5) * 2, 2.2);
          const b = {
            i, s: sc, tc, ta, under,
            vx: (rnd() - 0.5) * 2.2, vs: (rnd() - 0.5) * 1.2,
            wx: (rnd() - 0.5) * 2.4, wz: (rnd() - 0.5) * 1.6,
            ax: (rnd() - 0.5) * 2.0, az: (rnd() - 0.5) * 2.0,
            g: new THREE.Group()
          };
          const deck = stoneBox(this.bl * 0.985, 0.42, this.w);
          deck.position.y = -0.21;
          const wedge = boxMesh(this.bl * 0.94, under, this.w * 0.82, mats.side);
          wedge.position.y = -0.42 - under / 2;
          const trimL = boxMesh(this.bl * 0.985, 0.12, 0.1, mats.brass, { noShadow: true });
          trimL.position.set(0, -0.06, this.w / 2 - 0.02);
          const trimR = trimL.clone(); trimR.position.z = -this.w / 2 + 0.02;
          // deck runs along s: rotate so local x is along s
          const inner = new THREE.Group();
          inner.rotation.y = Math.PI / 2;
          inner.add(deck, wedge, trimL, trimR);
          b.g.add(inner);
          const crackMat = new THREE.MeshBasicMaterial({ map: tex.crack, color: 0xffc27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
          const crack = new THREE.Mesh(cachedGeo("crackPlane", () => new THREE.PlaneGeometry(1, 1)), crackMat);
          crack.scale.set(this.w * 0.9, this.bl * 0.95, 1);
          crack.rotation.x = -Math.PI / 2;
          crack.rotation.z = rnd() * TAU;
          crack.position.y = 0.006;
          crack.userData.ownMat = true;
          b.crack = crack;
          b.g.add(crack);
          // chips flake off just before a block falls
          b.chips = [];
          for (let c = 0; c < 3; c++) {
            const chip = boxMesh(0.22 + rnd() * 0.15, 0.18, 0.2 + rnd() * 0.15, mats.side, { noShadow: true });
            chip.visible = false;
            this.group.add(chip);
            b.chips.push({ m: chip, ox: (rnd() - 0.5) * this.w, os: (rnd() - 0.5) * this.bl, oy: -0.3 - rnd() * 0.5,
              vx: (rnd() - 0.5) * 3, vy: 1 + rnd() * 2, vs: (rnd() - 0.5) * 2, lead: 0.25 + rnd() * 0.25, spin: (rnd() - 0.5) * 9 });
          }
          mergeRigid(b.g, [crack]);
          b.g.position.set(this.x, this.y, -sc);
          this.group.add(b.g);
          this.blocks.push(b);
          if (isFinite(tc)) dustEntries.push({ x: this.x, y: this.y - 0.4, s: sc, wx: this.w, ws: this.bl, birth: tc - 0.05, life: 2.0, count: 9, spread: 1.2, up: 0.4, down: 1.5, seed: o.seed * 31 + i });
          if (isFinite(ta)) dustEntries.push({ x: this.x, y: this.y - 0.1, s: sc, wx: this.w, ws: this.bl, birth: ta - 0.04, life: 1.4, count: 7, spread: 1.6, up: 0.6, down: 0, seed: o.seed * 17 + i });
        }
        if (dustEntries.length) this.group.add(makeDust(dustEntries));
        if (this.latch) {
          this.latchMesh = new THREE.Group();
          const bar = boxMesh(this.w + 0.2, 0.16, 0.2, mats.brass);
          bar.position.y = 0;
          const postL = boxMesh(0.14, 1.0, 0.14, mats.patinaDark); postL.position.set(-this.w / 2 + 0.25, -0.5, 0);
          const postR = postL.clone(); postR.position.x = this.w / 2 - 0.25;
          this.latchMesh.add(bar, postL, postR);
          mergeRigid(this.latchMesh);
          this.latchMesh.position.set(this.x, 0, -(this.s0 - 0.3));
          this.group.add(this.latchMesh);
        }
        this.winStart = isFinite(this.assembleAt) ? this.assembleAt + (n - 1) * this.assembleStagger : 0;
        this.winEnd = isFinite(this.collapseAt) ? this.collapseAt : Infinity;
      }
      blockState(b, T, out) {
        out.dx = 0; out.dy = 0; out.ds = 0; out.rx = 0; out.rz = 0; out.k = 0; out.sup = true; out.vis = true;
        if (T < b.ta) {
          const AD = 1.5;
          const u = (T - (b.ta - AD)) / AD;
          if (u <= 0) { out.dy = -60; out.vis = false; out.sup = false; return out; }
          const e = easeOutBack(u);
          out.dy = -38 * (1 - e);
          out.rx = (1 - e) * b.ax; out.rz = (1 - e) * b.az;
          out.sup = false;
          return out;
        }
        if (T >= b.tc) {
          const t = T - b.tc;
          out.dy = -0.5 * G * t * t - 0.6 * t - 0.05;
          out.dx = b.vx * t; out.ds = b.vs * t;
          out.rx = b.wx * t; out.rz = b.wz * t;
          out.sup = false; out.k = 1;
          if (out.dy < -70) out.vis = false;
          return out;
        }
        if (T > b.tc - 1.15) {
          const k = (T - (b.tc - 1.15)) / 1.15;
          out.k = k;
          out.dy = -0.05 * k * k + Math.sin(T * 61 + b.i * 2.3) * 0.014 * k;
          out.rz = Math.sin(T * 47 + b.i) * 0.006 * k;
        }
        return out;
      }
      latchOpen(T) {
        // The latch lowers only while every block is in place, with a little margin.
        const a = isFinite(this.assembleAt) ? smooth((T - this.winStart) / 0.3) : 1;
        const b = isFinite(this.collapseAt) ? 1 - smooth((T - (this.winEnd - 0.5)) / 0.3) : 1;
        return a * b;
      }
      colliders(T, out) {
        const st = this._st || (this._st = {});
        for (const b of this.blocks) {
          this.blockState(b, T, st);
          if (!st.sup) continue;
          out.push({ id: this.id + ":" + b.i, x: this.x, s: b.s, hx: this.w / 2, hs: this.bl / 2 + 0.01, top: this.y + st.dy, bottom: this.y + st.dy - 0.6, sup: true });
        }
        if (this.latch) {
          const h = 0.95 * (1 - this.latchOpen(T));
          if (h > 0.22) out.push({ id: this.id + ":latch", x: this.x, s: this.s0 - 0.3, hx: this.w / 2 + 0.1, hs: 0.12, top: h, bottom: -0.2, sup: false, pushDir: -1 });
        }
      }
      render(T) {
        const st = this._rs || (this._rs = {});
        for (const b of this.blocks) {
          this.blockState(b, T, st);
          b.g.visible = st.vis;
          b.g.position.set(this.x + st.dx, this.y + st.dy, -(b.s + st.ds));
          b.g.rotation.set(st.rx, 0, st.rz);
          b.crack.material.opacity = st.k > 0 ? Math.min(1, st.k * 1.1) * (T >= b.tc ? 0.35 : 0.95) : 0;
          b.crack.visible = b.crack.material.opacity > 0.01;
          for (const c of b.chips) {
            const t = T - (b.tc - c.lead);
            if (t <= 0 || !isFinite(b.tc)) { c.m.visible = false; continue; }
            const y = this.y + c.oy + c.vy * t - 0.5 * G * t * t;
            if (y < -60) { c.m.visible = false; continue; }
            c.m.visible = true;
            c.m.position.set(this.x + c.ox + c.vx * t, y, -(b.s + c.os + c.vs * t));
            c.m.rotation.set(c.spin * t, c.spin * 0.6 * t, 0);
          }
        }
        if (this.latchMesh) {
          const h = 0.95 * (1 - this.latchOpen(T));
          this.latchMesh.position.y = h - 0.02;
          this.latchMesh.visible = h > 0.02;
        }
      }
      windows(a, b) {
        // the safe crossing window; with a latch, it is the time the latch is fully open
        const lo = this.winStart + (this.latch && isFinite(this.assembleAt) ? 0.3 : 0);
        const hi = this.winEnd - (this.latch ? 0.5 : 0);
        return intervalsIntersect([[lo, hi]], a, b);
      }
      events(prevT, T, sink) {
        if (prevT === T) return;
        const lo = Math.min(prevT, T), hi = Math.max(prevT, T), fwd = T > prevT;
        for (const b of this.blocks) {
          if (b.tc > lo && b.tc <= hi) sink(fwd ? "crumble" : "settle", this.x, b.s, b.i);
          if (b.ta > lo && b.ta <= hi) sink(fwd ? "settle" : "lift", this.x, b.s, b.i);
        }
      }
    }

    // ---------------------------------------------------------------------
    // FERRY — a barge that shuttles across a chasm on its own timetable.
    // Escapement rails rise while it travels so it carries, rather than flings, the player.
    // ---------------------------------------------------------------------
    class Ferry {
      constructor(o) {
        this.type = "ferry";
        this.id = o.id;
        this.x = o.x; this.s0 = o.s0; this.s1 = o.s1; this.w = o.w; this.len = o.len || 4.6;
        this.dwell = o.dwell; this.travel = o.travel; this.phase = o.phase;
        this.P = 2 * (this.dwell + this.travel);
        this.sA = this.s0 + this.len / 2; this.sB = this.s1 - this.len / 2;
        this.dockLatch = !!o.dockLatch;
        this.sMin = this.s0 - 2; this.sMax = this.s1 + 2;
        this.crossS0 = this.s0; this.crossS1 = this.s1; this.crossX = this.x;
        this.group = new THREE.Group();
        // track beams beneath, so the trajectory is always readable
        const trackLen = this.s1 - this.s0 + 1.2;
        for (const sx of [-1, 1]) {
          const beam = boxMesh(0.22, 0.28, trackLen, mats.patinaDark);
          beam.position.set(this.x + sx * (this.w / 2 - 0.35), -1.15, -(this.s0 + this.s1) / 2);
          this.group.add(beam);
        }
        const glide = boxMesh(0.06, 0.04, trackLen - 0.6, mats.cyanLine, { noShadow: true });
        glide.position.set(this.x, -1.02, -(this.s0 + this.s1) / 2);
        this.group.add(glide);
        this.barge = new THREE.Group();
        const deck = stoneBox(this.w, 0.5, this.len);
        deck.position.y = -0.25;
        const keel = boxMesh(this.w * 0.55, 0.55, this.len * 0.8, mats.patina);
        keel.position.y = -0.75;
        const shoeL = boxMesh(0.3, 0.3, this.len * 0.5, mats.brass); shoeL.position.set(-(this.w / 2 - 0.35), -0.92, 0);
        const shoeR = shoeL.clone(); shoeR.position.x = this.w / 2 - 0.35;
        const edgeF = boxMesh(this.w, 0.1, 0.12, mats.brass, { noShadow: true }); edgeF.position.set(0, -0.02, -this.len / 2 + 0.05);
        const edgeB = edgeF.clone(); edgeB.position.z = this.len / 2 - 0.05;
        this.barge.add(deck, keel, shoeL, shoeR, edgeF, edgeB);
        const mkRail = () => {
          const r = new THREE.Group();
          const bar = boxMesh(this.w - 0.3, 0.12, 0.12, mats.brass);
          const p1 = boxMesh(0.12, 1.0, 0.12, mats.patinaDark); p1.position.set(-(this.w / 2 - 0.3), -0.5, 0);
          const p2 = p1.clone(); p2.position.x = this.w / 2 - 0.3;
          r.add(bar, p1, p2);
          return mergeRigid(r);
        };
        this.railF = mkRail(); this.railF.position.z = -this.len / 2 + 0.15;
        this.railB = mkRail(); this.railB.position.z = this.len / 2 - 0.15;
        mergeRigid(this.barge);
        this.barge.add(this.railF, this.railB);
        this.group.add(this.barge);
        if (this.dockLatch) {
          this.latchMesh = mkRail();
          this.latchMesh.scale.x = (this.w + 0.3) / (this.w - 0.3);
          this.latchMesh.position.set(this.x, 0, -(this.s0 - 0.3));
          this.group.add(this.latchMesh);
        }
      }
      phaseC(T) {
        const u = posMod(T - this.phase, this.P);
        const d = this.dwell, tr = this.travel;
        if (u < d) return 0;
        if (u < d + tr) return smoother((u - d) / tr);
        if (u < 2 * d + tr) return 1;
        return 1 - smoother((u - 2 * d - tr) / tr);
      }
      deckS(T) { return lerp(this.sA, this.sB, this.phaseC(T)); }
      rails(T) {
        const c = this.phaseC(T);
        return { f: 1 - smooth((c - 0.9) / 0.08), b: 1 - smooth((0.1 - c) / 0.08), c };
      }
      colliders(T, out) {
        const s = this.deckS(T), r = this.rails(T);
        out.push({ id: this.id + ":deck", x: this.x, s, hx: this.w / 2, hs: this.len / 2 + 0.02, top: 0, bottom: -0.5, sup: true, carry: true });
        // rails always push a rider inward, onto the deck, never off it
        if (r.f > 0.3) out.push({ id: this.id + ":rf", x: this.x, s: s + this.len / 2 - 0.15, hx: this.w / 2, hs: 0.08, top: 1.0 * r.f, bottom: -0.3, sup: false, pushDir: -1 });
        if (r.b > 0.3) out.push({ id: this.id + ":rb", x: this.x, s: s - this.len / 2 + 0.15, hx: this.w / 2, hs: 0.08, top: 1.0 * r.b, bottom: -0.3, sup: false, pushDir: 1 });
        if (this.dockLatch) {
          const h = 1.0 * smooth((r.c - 0.015) / 0.05);
          if (h > 0.22) out.push({ id: this.id + ":latch", x: this.x, s: this.s0 - 0.3, hx: this.w / 2 + 0.1, hs: 0.12, top: h, bottom: -0.2, sup: false, pushDir: -1 });
        }
      }
      render(T) {
        const s = this.deckS(T), r = this.rails(T);
        this.barge.position.set(this.x, 0, -s);
        this.railF.position.y = 1.0 * r.f - 0.02; this.railF.visible = r.f > 0.02;
        this.railB.position.y = 1.0 * r.b - 0.02; this.railB.visible = r.b > 0.02;
        if (this.latchMesh) {
          const h = 1.0 * smooth((r.c - 0.015) / 0.05);
          this.latchMesh.position.y = h - 0.02; this.latchMesh.visible = h > 0.02;
        }
      }
      attach(T, key) {
        const s = this.deckS(T);
        return { x: this.x + key.x, y: 0.75, s: s + key.s };
      }
      // windows: when the barge rests at the near dock
      windows(a, b) { return periodicWindows(this.P, this.phase, -this.travel * 0.04, this.dwell + this.travel * 0.04, a, b); }
      events(prevT, T, sink) {
        if (prevT === T) return;
        const c0 = this.phaseC(prevT), c1 = this.phaseC(T);
        if ((c0 <= 0.001) !== (c1 <= 0.001) || (c0 >= 0.999) !== (c1 >= 0.999)) sink("clunk", this.x, this.deckS(T));
      }
    }

    // ---------------------------------------------------------------------
    // ORRERY RING — a monumental ring turning about the course axis. Its decks form the
    // path only when they pass through the bottom of the turn.
    // ---------------------------------------------------------------------
    const RING_SUPPORT_ANGLE = 0.34;
    class Ring {
      constructor(o) {
        this.type = "ring";
        this.id = o.id;
        this.x = o.x; this.s0 = o.s0; this.s1 = o.s1;
        this.R = o.R || 4.6; this.period = o.period; this.phase = o.phase || 0; this.dirn = o.dir || 1;
        this.deckW = o.deckW || 2.6;
        this.cy = this.R; // deck top surface sits on the walkway plane at the bottom of the turn
        this.sMin = this.s0 - 3; this.sMax = this.s1 + 3;
        this.crossS0 = this.s0; this.crossS1 = this.s1; this.crossX = this.x;
        const D = this.s1 - this.s0;
        this.D = D;
        this.group = new THREE.Group();
        this.rot = new THREE.Group();
        this.rot.position.set(this.x, this.cy, -(this.s0 + this.s1) / 2);
        const N = 30, Rm = this.R + 1.05;
        const arc = (TAU * Rm) / N;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU;
          const v = boxMesh(arc * 0.94, 1.1, D * 0.96, i % 5 === 0 ? mats.dIvory : mats.dSide);
          v.position.set(Math.sin(a) * Rm, -Math.cos(a) * Rm, 0);
          v.rotation.z = a;
          this.rot.add(v);
          if (i % 5 === 0) {
            const tick = boxMesh(0.16, 0.7, 0.06, mats.dBrass, { noShadow: true });
            tick.position.set(Math.sin(a) * Rm, -Math.cos(a) * Rm, D * 0.49);
            tick.rotation.z = a;
            this.rot.add(tick);
          }
        }
        for (const z of [D / 2 + 0.03, -D / 2 - 0.03]) {
          const band = new THREE.Mesh(cachedGeo("ringBand" + this.R, () => new THREE.TorusGeometry(this.R + 0.5, 0.1, 6, 72)), mats.dPatina);
          band.position.z = z;
          this.rot.add(band);
        }
        this.decks = [];
        for (let k = 0; k < 2; k++) {
          const pivot = new THREE.Group();
          pivot.rotation.z = k * Math.PI;
          const deck = new THREE.Group();
          const slab = stoneBox(this.deckW, 0.45, D + 0.02);
          slab.position.y = -0.225;
          const lip = boxMesh(0.12, 0.14, D, mats.brass, { noShadow: true });
          lip.position.set(this.deckW / 2 - 0.06, -0.05, 0);
          const lip2 = lip.clone(); lip2.position.x = -this.deckW / 2 + 0.06;
          const strutL = boxMesh(0.3, 0.6, D * 0.6, mats.patinaDark); strutL.position.set(-this.deckW / 2 + 0.3, -0.6, 0);
          const strutR = strutL.clone(); strutR.position.x = this.deckW / 2 - 0.3;
          deck.add(slab, lip, lip2, strutL, strutR);
          deck.position.y = -this.R;
          pivot.add(deck);
          this.rot.add(pivot);
          this.decks.push(pivot);
        }
        mergeRigid(this.rot);
        this.group.add(this.rot);
        // cradle rollers
        this.rollers = [];
        for (const sgn of [-1, 1]) {
          const a = sgn * 0.62;
          const rr = 0.8;
          const roller = new THREE.Mesh(cachedGeo("roller", () => new THREE.CylinderGeometry(rr, rr, D * 0.7, 16)), mats.patina);
          roller.rotation.x = Math.PI / 2;
          const holder = new THREE.Group();
          const rad = this.R + 1.6 + rr;
          holder.position.set(this.x + Math.sin(a) * rad, this.cy - Math.cos(a) * rad, -(this.s0 + this.s1) / 2);
          holder.add(roller);
          const spoke = boxMesh(0.25, 1.7, 0.25, mats.brass, { noShadow: true });
          spoke.position.z = D * 0.36;
          roller.add(spoke);
          spoke.rotation.x = -Math.PI / 2;
          this.group.add(holder);
          const pier = boxMesh(1.2, 40, D * 0.6, mats.deep);
          pier.position.set(holder.position.x, holder.position.y - 20.6, holder.position.z);
          this.group.add(pier);
          this.rollers.push({ holder, roller, ratio: (this.R + 1.6) / rr, sgn });
        }
      }
      theta(T) { return (this.dirn * TAU * (T - this.phase)) / this.period; }
      colliders(T, out) {
        const th = this.theta(T);
        for (let k = 0; k < 2; k++) {
          const a = wrapAngle(th + k * Math.PI);
          if (Math.abs(a) > RING_SUPPORT_ANGLE) continue;
          const dx = this.x + Math.sin(a) * this.R, dy = this.cy - Math.cos(a) * this.R;
          out.push({ id: this.id + ":d" + k, x: dx, s: (this.s0 + this.s1) / 2, hx: this.deckW / 2, hs: this.D / 2 + 0.03,
            top: dy, bottom: dy - 0.45, sup: true, roll: a, px: this.x, py: this.cy, carry: true });
        }
      }
      render(T) {
        const th = this.theta(T);
        this.rot.rotation.z = th;
        for (const r of this.rollers) r.roller.rotation.y = -th * r.ratio;
      }
      attach(T, key) {
        const a = this.theta(T) + key.k * Math.PI;
        const r = this.R - 0.75;
        return { x: this.x + Math.sin(a) * r, y: this.cy - Math.cos(a) * r, s: (this.s0 + this.s1) / 2 + key.s };
      }
      windows(a, b) {
        const half = this.period / 2;
        const w = (RING_SUPPORT_ANGLE * 0.85 / TAU) * this.period;
        // deck aligned when theta = m*pi: T = phase + m*half
        return periodicWindows(half, this.phase, -w, w, a, b);
      }
      events() {}
    }

    // ---------------------------------------------------------------------
    // FOLD STAIR — steps slide out of a terrace wall like drawers, top step first.
    // ---------------------------------------------------------------------
    class FoldStair {
      constructor(o) {
        this.type = "stair";
        this.id = o.id;
        this.x = o.x; this.sWall = o.sWall; this.H = o.H; this.w = o.w;
        this.K = o.K || 4;
        this.tread = o.tread || 0.85;
        this.extendAt = o.extendAt; this.retractAt = o.retractAt == null ? Infinity : o.retractAt;
        this.dur = 0.9; this.stag = 0.32;
        this.sMin = this.sWall - this.K * this.tread - 2; this.sMax = this.sWall + 1;
        this.crossS0 = this.sWall - this.K * this.tread; this.crossS1 = this.sWall; this.crossX = this.x;
        this.group = new THREE.Group();
        this.steps = [];
        const rise = this.H / (this.K + 1);
        for (let i = 0; i < this.K; i++) {
          const top = rise * (i + 1);
          const D = (this.K - i) * this.tread;
          const order = this.K - 1 - i; // top step first
          const g = new THREE.Group();
          const slab = stoneBox(this.w, 0.5, D);
          slab.position.y = -0.25;
          const nose = boxMesh(this.w, 0.1, 0.12, mats.brass, { noShadow: true });
          nose.position.set(0, -0.03, -D / 2 + 0.06);
          g.add(slab, nose);
          mergeRigid(g);
          this.group.add(g);
          this.steps.push({ i, top, D, order, g });
        }
      }
      ext(st, T) {
        const tEnd = this.extendAt + st.order * this.stag;
        let e = smoother((T - (tEnd - this.dur)) / this.dur);
        if (isFinite(this.retractAt)) {
          const rStart = this.retractAt + (this.K - 1 - st.order) * this.stag;
          e *= 1 - smoother((T - rStart) / this.dur);
        }
        return e;
      }
      colliders(T, out) {
        for (const st of this.steps) {
          const e = this.ext(st, T);
          const L = e * st.D;
          if (L < 0.12) continue;
          out.push({ id: this.id + ":" + st.i, x: this.x, s: this.sWall - L / 2, hx: this.w / 2, hs: L / 2, top: st.top, bottom: st.top - 0.5, sup: true });
        }
      }
      render(T) {
        for (const st of this.steps) {
          const e = this.ext(st, T);
          st.g.visible = e > 0.01;
          st.g.position.set(this.x, st.top, -(this.sWall - e * st.D + st.D / 2));
        }
      }
      windows(a, b) {
        const lastOut = this.extendAt + (this.K - 1) * this.stag;
        const firstIn = isFinite(this.retractAt) ? this.retractAt : Infinity;
        return intervalsIntersect([[lastOut, firstIn]], a, b);
      }
      events(prevT, T, sink) {
        if (prevT === T) return;
        for (const st of this.steps) {
          const tEnd = this.extendAt + st.order * this.stag;
          if ((prevT < tEnd) !== (T < tEnd)) sink("slide", this.x, this.sWall);
        }
      }
    }

    // ---------------------------------------------------------------------
    // GATE — an escapement door. Its lintel dial shows where in its cycle it is.
    // ---------------------------------------------------------------------
    class Gate {
      constructor(o) {
        this.type = "gate";
        this.id = o.id;
        this.x = o.x; this.s = o.s; this.w = o.w; this.y = o.y || 0;
        this.period = o.period || 0;      // periodic if > 0
        this.phase = o.phase || 0;
        this.openFrac = o.openFrac || 0.5;
        this.openAt = o.openAt;           // one-shot: opens at openAt (for period 0)
        this.closeAt = o.closeAt == null ? Infinity : o.closeAt;
        this.sMin = this.s - 2; this.sMax = this.s + 2;
        this.crossS0 = this.s - 0.3; this.crossS1 = this.s + 0.3; this.crossX = this.x;
        this.group = new THREE.Group();
        const H = 3.3;
        this.slab = new THREE.Group();
        const door = boxMesh(this.w + 0.1, H, 0.45, mats.ivory);
        door.position.y = H / 2;
        const band1 = boxMesh(this.w + 0.14, 0.18, 0.5, mats.patina); band1.position.y = 0.5;
        const band2 = band1.clone(); band2.position.y = H - 0.5;
        const teeth = [];
        for (let i = 0; i < 5; i++) {
          const t = boxMesh(0.16, 0.28, 0.5, mats.brass, { noShadow: true });
          t.position.set(-this.w / 2 + (i + 0.5) * (this.w / 5), 0.1, 0);
          teeth.push(t);
        }
        this.slab.add(door, band1, band2, ...teeth);
        mergeRigid(this.slab);
        this.slab.position.set(this.x, this.y, -this.s);
        this.group.add(this.slab);
        this.frame = new THREE.Group();
        this.frame.position.y = this.y;
        this.group.add(this.frame);
        // frame
        const pillarH = 5.2;
        for (const sx of [-1, 1]) {
          const p = boxMesh(0.7, pillarH + 30, 0.9, mats.dSide);
          p.position.set(this.x + sx * (this.w / 2 + 0.4), pillarH / 2 - 15, -this.s);
          this.frame.add(p);
          const cap = boxMesh(0.9, 0.3, 1.1, mats.dTrim);
          cap.position.set(this.x + sx * (this.w / 2 + 0.4), pillarH + 0.15, -this.s);
          this.frame.add(cap);
        }
        const lintel = boxMesh(this.w + 1.8, 1.2, 1.0, mats.dTrim);
        lintel.position.set(this.x, pillarH - 0.6, -this.s);
        this.frame.add(lintel);
        // dial
        const dialR = 0.62;
        const face = new THREE.Mesh(cachedGeo("dialFace", () => new THREE.CircleGeometry(dialR, 40)), mats.dial);
        face.position.set(this.x, pillarH - 0.6, -this.s + 0.51);
        this.frame.add(face);
        const openLen = TAU * (this.period > 0 ? this.openFrac : 0.5);
        const arc = new THREE.Mesh(new THREE.RingGeometry(dialR * 0.62, dialR * 0.82, 32, 1, Math.PI / 2 - openLen, openLen), mats.openArc);
        arc.userData.ownGeo = true;
        arc.position.set(this.x, pillarH - 0.6, -this.s + 0.52);
        this.frame.add(arc);
        this.hand = new THREE.Group();
        const handM = boxMesh(0.07, dialR * 0.85, 0.04, mats.patinaDark, { noShadow: true });
        handM.position.y = dialR * 0.42;
        this.hand.add(handM);
        this.hand.position.set(this.x, pillarH - 0.6, -this.s + 0.55);
        mergeRigid(this.frame);
        this.frame.add(this.hand);
      }
      openness(T) {
        const ramp = 0.7;
        if (this.period > 0) {
          const u = posMod(T - this.phase, this.period);
          const oEnd = this.openFrac * this.period;
          // open during [0, oEnd), with eased edges inside that span
          if (u < oEnd) return smooth(u / ramp) * (1 - smooth((u - (oEnd - ramp)) / ramp));
          return 0;
        }
        return smooth((T - this.openAt) / ramp) * (1 - smooth((T - this.closeAt) / ramp));
      }
      bottom(T) { return 3.0 * this.openness(T); }
      colliders(T, out) {
        const b = this.bottom(T);
        if (b < BODY_H + 0.15) out.push({ id: this.id, x: this.x, s: this.s, hx: this.w / 2 + 0.05, hs: 0.23, top: this.y + b + 3.3, bottom: this.y + b, sup: false, gate: true });
      }
      render(T) {
        this.slab.position.y = this.y + this.bottom(T);
        // dial hand: one revolution per cycle; the open arc spans the open part of the cycle
        let f;
        if (this.period > 0) f = posMod(T - this.phase, this.period) / this.period;
        else f = clamp((T - (this.openAt - 6)) / 12, 0, 1);
        this.hand.rotation.z = -f * TAU;
      }
      windows(a, b) {
        if (this.period > 0) return periodicWindows(this.period, this.phase, 0.5, this.openFrac * this.period - 0.5, a, b);
        return intervalsIntersect([[this.openAt + 0.5, this.closeAt]], a, b);
      }
      events(prevT, T, sink) {
        if (prevT === T) return;
        const o0 = this.openness(prevT), o1 = this.openness(T);
        if ((o0 > 0.02) !== (o1 > 0.02)) sink("gate", this.x, this.s);
      }
    }

    // ---------------------------------------------------------------------
    // GNOMON — a bronze sundial blade sweeping across the path at body height.
    // ---------------------------------------------------------------------
    class Gnomon {
      constructor(o) {
        this.type = "gnomon";
        this.id = o.id;
        this.px = o.px; this.ps = o.ps; this.len = o.len; this.period = o.period; this.phase = o.phase || 0; this.dirn = o.dir || 1;
        this.pathX = o.pathX; this.pathW = o.pathW;
        this.y0 = 0.32; this.y1 = 0.98;
        this.sMin = this.ps - this.len - 1; this.sMax = this.ps + this.len + 1;
        this.group = new THREE.Group();
        const col = new THREE.Mesh(cachedGeo("gnCol", () => new THREE.CylinderGeometry(0.5, 0.6, 36, 14)), mats.side);
        col.position.set(this.px, 1.1 - 18, -this.ps);
        col.castShadow = true; col.receiveShadow = true;
        this.group.add(col);
        const capital = new THREE.Mesh(cachedGeo("gnCap", () => new THREE.CylinderGeometry(0.72, 0.55, 0.3, 14)), mats.trim);
        capital.position.set(this.px, 1.25, -this.ps);
        this.group.add(capital);
        this.arm = new THREE.Group();
        this.arm.position.set(this.px, 0, -this.ps);
        const hub = new THREE.Mesh(cachedGeo("gnHub", () => new THREE.CylinderGeometry(0.42, 0.42, 0.9, 14)), mats.brass);
        hub.position.y = 0.65 + 0.5;
        hub.castShadow = true;
        const blade = boxMesh(this.len - 0.3, 0.6, 0.22, mats.patina);
        blade.position.set((this.len - 0.3) / 2 + 0.3, (this.y0 + this.y1) / 2 + 0.02, 0);
        const edge = boxMesh(this.len - 0.4, 0.08, 0.26, mats.brass, { noShadow: true });
        edge.position.set((this.len - 0.4) / 2 + 0.35, this.y1 + 0.02, 0);
        const tip = boxMesh(0.3, 0.75, 0.3, mats.brass);
        tip.position.set(this.len - 0.12, (this.y0 + this.y1) / 2, 0);
        const counter = boxMesh(1.2, 0.5, 0.5, mats.patinaDark);
        counter.position.set(-0.9, 1.1, 0);
        this.arm.add(hub, blade, edge, tip, counter);
        mergeRigid(this.arm);
        this.group.add(this.arm);
        // engraved sweep grooves where the tip crosses the walkway
        const runs = [];
        let cur = null;
        const NS = 144;
        for (let i = 0; i <= NS; i++) {
          const a = (i / NS) * TAU;
          const tx = this.px + Math.cos(a) * this.len;
          const on = Math.abs(tx - this.pathX) < this.pathW / 2 - 0.05;
          if (on && !cur) { cur = [a, a]; runs.push(cur); }
          if (on && cur) cur[1] = a;
          if (!on) cur = null;
        }
        for (const [a0, a1] of runs) {
          const geo = new THREE.RingGeometry(this.len - 0.07, this.len + 0.05, 24, 1, a0, Math.max(0.01, a1 - a0));
          const m = new THREE.Mesh(geo, mats.groove);
          m.userData.ownGeo = true;
          m.rotation.x = -Math.PI / 2;
          m.position.set(this.px, 0.012, -this.ps);
          this.group.add(m);
        }
      }
      theta(T) { return (this.dirn * TAU * (T - this.phase)) / this.period; }
      hazards(T, prevT, out) {
        out.push({ id: this.id, px: this.px, ps: this.ps, ang: this.theta(T), dAng: this.theta(T) - this.theta(prevT), len: this.len, y0: this.y0, y1: this.y1, half: 0.16 });
      }
      colliders() {}
      render(T) { this.arm.rotation.y = this.theta(T); }
      windows() { return null; }
      events() {}
    }

    // ---------------------------------------------------------------------
    // DIVIDING BRIDGE — a bridge that splits into two halves sliding apart sideways, then
    // reconnects. Fully apart, neither half lines up with the walkways; riding a half carries
    // the player sideways with it.
    // ---------------------------------------------------------------------
    class SplitBridge {
      constructor(o) {
        this.type = "split";
        this.id = o.id;
        this.x = o.x; this.s0 = o.s0; this.s1 = o.s1; this.w = o.w;
        this.period = o.period; this.phase = o.phase || 0;
        this.closedFrac = o.closedFrac || 0.36;
        this.maxGap = this.w / 2 + 0.9;
        this.sMin = this.s0 - 2; this.sMax = this.s1 + 2;
        this.crossS0 = this.s0; this.crossS1 = this.s1; this.crossX = this.x;
        const len = this.s1 - this.s0, hw = this.w / 2;
        this.group = new THREE.Group();
        // guide rails beneath, across the gap, showing where the halves travel
        for (const sc of [this.s0 + 0.6, this.s1 - 0.6]) {
          const rail = boxMesh(this.w + this.maxGap * 2 + 1.2, 0.22, 0.24, mats.patinaDark);
          rail.position.set(this.x, -1.0, -sc);
          this.group.add(rail);
        }
        this.halves = [];
        for (const side of [-1, 1]) {
          const g = new THREE.Group();
          const slab = stoneBox(hw - 0.02, 0.5, len);
          slab.position.y = -0.25;
          const under = boxMesh(hw * 0.7, 0.7, len * 0.86, mats.side);
          under.position.y = -0.85;
          // interlocking teeth along the inner edge: they read as "these two belong together"
          const teeth = new THREE.Group();
          const n = Math.max(3, Math.round(len / 1.2));
          for (let i = 0; i < n; i++) {
            const t = boxMesh(0.16, 0.12, len / n * 0.5, mats.brass, { noShadow: true });
            t.position.set(-side * (hw / 2 - 0.02), -0.03, -len / 2 + (i + (side > 0 ? 0.25 : 0.75)) * len / n);
            teeth.add(t);
          }
          const edge = boxMesh(0.08, 0.1, len, mats.patina, { noShadow: true });
          edge.position.set(side * (hw / 2 - 0.04), -0.02, 0);
          g.add(slab, under, teeth, edge);
          mergeRigid(g);
          this.group.add(g);
          this.halves.push({ side, g });
        }
      }
      gap(T) {
        const u = posMod(T - this.phase, this.period) / this.period;
        const c = this.closedFrac, m = (1 - c) / 3;
        if (u < c) return 0;
        if (u < c + m) return this.maxGap * smoother((u - c) / m);
        if (u < c + 2 * m) return this.maxGap;
        return this.maxGap * (1 - smoother((u - c - 2 * m) / m));
      }
      colliders(T, out) {
        const d = this.gap(T), hw = this.w / 2;
        for (const h of this.halves) {
          out.push({ id: this.id + ":" + h.side, x: this.x + h.side * (hw / 2 + d), s: (this.s0 + this.s1) / 2, hx: hw / 2, hs: (this.s1 - this.s0) / 2 + 0.02,
            top: 0, bottom: -0.6, sup: true, carry: true });
        }
      }
      render(T) {
        const d = this.gap(T), hw = this.w / 2;
        for (const h of this.halves) h.g.position.set(this.x + h.side * (hw / 2 + d), 0, -(this.s0 + this.s1) / 2);
      }
      attach(T, key) {
        const d = this.gap(T), hw = this.w / 2;
        return { x: this.x + key.side * (hw / 2 + d) + (key.dx || 0), y: 0.8, s: (this.s0 + this.s1) / 2 + key.s };
      }
      // walkable straight through while the halves still overlap the walkways comfortably
      // the window is "joined": the seam down the middle is closed enough to walk straight over
      windows(a, b) { return sampleWindows((t) => this.gap(t) <= 0.12, a, b); }
      events(prevT, T, sink) {
        if (prevT === T) return;
        const a = this.gap(prevT) < 0.01, b = this.gap(T) < 0.01;
        if (a !== b) sink("clunk", this.x, (this.s0 + this.s1) / 2);
      }
    }

    // ---------------------------------------------------------------------
    // PILLAR WAVE — a field of pillars rising and sinking as a travelling wave. Along a column
    // neighbours never differ by more than a step, so you can always walk with the wave; getting
    // in, getting out and changing column depend on its phase. Reversing sends the wave back.
    // ---------------------------------------------------------------------
    class PillarWave {
      constructor(o) {
        this.type = "pillars";
        this.id = o.id;
        this.x = o.x; this.s0 = o.s0; this.w = o.w;
        this.rows = o.rows; this.cols = 3; this.pitch = o.pitch || 1.25;
        this.s1 = this.s0 + this.rows * this.pitch;
        this.A = o.A || 1.35; this.k = o.k || 0.3; this.period = o.period || 6.5; this.phase = o.phase || 0;
        this.colPhase = o.colPhase || [0.0, 1.0, 2.0];
        this.holes = new Set(o.holes || []);
        this.sMin = this.s0 - 2; this.sMax = this.s1 + 2;
        this.crossS0 = this.s0; this.crossS1 = this.s1; this.crossX = this.x;
        this.cw = this.w / this.cols;
        this.group = new THREE.Group();
        const n = this.rows * this.cols;
        this.body = new THREE.InstancedMesh(cachedGeo("pillarBody", () => new THREE.BoxGeometry(1, 1, 1)), mats.side, n);
        this.cap = new THREE.InstancedMesh(cachedGeo("pillarCap", () => new THREE.BoxGeometry(1, 1, 1)), mats.ivory, n);
        this.band = new THREE.InstancedMesh(cachedGeo("pillarBand", () => new THREE.BoxGeometry(1, 1, 1)), mats.patina, n);
        for (const m of [this.body, this.cap, this.band]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
        this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._sc = new THREE.Vector3();
      }
      h(T, r, c) { return this.A * Math.sin((TAU * (T - this.phase)) / this.period - this.k * r + this.colPhase[c]); }
      key(r, c) { return r * 3 + c; }
      colliders(T, out) {
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          if (this.holes.has(this.key(r, c))) continue;
          const top = this.h(T, r, c);
          out.push({ id: this.id + ":" + r + ":" + c, x: this.x + (c - 1) * this.cw, s: this.s0 + (r + 0.5) * this.pitch, hx: this.cw / 2, hs: this.pitch / 2 + 0.01, top, bottom: top - 40, sup: true });
        }
      }
      render(T) {
        let i = 0;
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++, i++) {
          const hole = this.holes.has(this.key(r, c));
          const top = hole ? -200 : this.h(T, r, c);
          const px = this.x + (c - 1) * this.cw, pz = -(this.s0 + (r + 0.5) * this.pitch);
          const W = this.cw * 0.94, D = this.pitch * 0.94;
          this._p.set(px, top - 0.2 - 15, pz); this._sc.set(W * 0.92, 30, D * 0.92); this._m.compose(this._p, this._q, this._sc); this.body.setMatrixAt(i, this._m);
          this._p.set(px, top - 0.2, pz); this._sc.set(W, 0.4, D); this._m.compose(this._p, this._q, this._sc); this.cap.setMatrixAt(i, this._m);
          this._p.set(px, top - 0.75, pz); this._sc.set(W * 0.96, 0.14, D * 0.96); this._m.compose(this._p, this._q, this._sc); this.band.setMatrixAt(i, this._m);
        }
        this.body.instanceMatrix.needsUpdate = true; this.cap.instanceMatrix.needsUpdate = true; this.band.instanceMatrix.needsUpdate = true;
      }
      attach(T, key) { return { x: this.x + (key.c - 1) * this.cw, y: this.h(T, key.r, key.c) + 0.8, s: this.s0 + (key.r + 0.5) * this.pitch }; }
      // centre column: in (first row no taller than a step) and out (last row no lower than a step)
      windows(a, b) { return sampleWindows((t) => this.h(t, 0, 1) <= STEP_UP - 0.05 && this.h(t, this.rows - 1, 1) >= -STEP_UP + 0.05, a, b); }
      events() {}
    }

    // ---------------------------------------------------------------------
    // ECHO SHARD — refracted light lodged in the architecture. Its existence follows the
    // world timeline; whether it has already been scored is a separate run achievement.
    // ---------------------------------------------------------------------
    const shardGeo = new THREE.OctahedronGeometry(0.2, 0);
    shardGeo.scale(1, 1.7, 1);
    const shardCoreGeo = new THREE.OctahedronGeometry(0.08, 0);
    ctx.onDestroy(() => { shardGeo.dispose(); shardCoreGeo.dispose(); unitBox.dispose(); });
    class Shard {
      constructor(o) {
        this.type = "shard";
        this.id = o.id;
        this.x = o.x; this.y = o.y == null ? 0.8 : o.y; this.s = o.s;
        this.host = o.host || null; this.key = o.key || null;
        this.a = o.a == null ? -Infinity : o.a; this.b = o.b == null ? Infinity : o.b;
        this.group = new THREE.Group();
        this.mesh = new THREE.Mesh(shardGeo, mats.shard);
        this.core = new THREE.Mesh(shardCoreGeo, mats.shardCore);
        this.spent = new THREE.Mesh(shardGeo, mats.shardSpent);
        this.glow = new THREE.Sprite(mats.glowGold);
        this.glow.scale.set(1.3, 1.3, 1);
        this.mesh.castShadow = true;
        this.group.add(this.mesh, this.core, this.spent, this.glow);
        this.sMin = (this.host ? this.host.sMin : this.s) - 1; this.sMax = (this.host ? this.host.sMax : this.s) + 1;
        this.phaseOff = hash1(this.id.length * 131 + o.s * 7) * TAU;
      }
      existence(T) {
        return smooth((T - this.a) / 0.45) * (1 - smooth((T - (this.b - 0.45)) / 0.45));
      }
      pos(T) {
        if (this.host) return this.host.attach(T, this.key);
        return { x: this.x, y: this.y, s: this.s };
      }
      render(T, collected) {
        const e = this.existence(T);
        const p = this.pos(T);
        const bob = Math.sin(T * 2.1 + this.phaseOff) * 0.08;
        this.group.position.set(p.x, p.y + bob, -p.s);
        this.group.visible = e > 0.01;
        const sc = 0.2 + 0.8 * e;
        this.mesh.visible = !collected; this.core.visible = !collected; this.glow.visible = !collected;
        this.spent.visible = collected;
        this.mesh.scale.setScalar(sc); this.core.scale.setScalar(sc); this.spent.scale.setScalar(sc);
        this.glow.material.opacity = 0.55;
        this.glow.scale.setScalar(1.3 * e);
        this.mesh.rotation.y = T * 1.3 + this.phaseOff;
        this.spent.rotation.y = this.mesh.rotation.y;
        this.core.rotation.y = -T * 2 + this.phaseOff;
      }
    }

    // =====================================================================
    // 5. ENCOUNTERS — designed templates, a seeded endless generator and a validator.
    // Each segment has a stable identity, seed and anchor time A: the world time at which
    // a player who keeps time flowing at cruise speed would arrive. Element timetables are
    // authored relative to that anchor, so the world's history is fixed once generated.
    // =====================================================================
    const MAIN_W = 3.6;

    function makeBuilder(index, s0, A, v, seed, diff, kind) {
      const rnd = mulberry32(seed);
      let uid = 0;
      const b = {
        index, s0, A, v, seed, diff, kind, rnd,
        floors: [], boxes: [], elements: [], shards: [], extras: [], route: [], hints: [],
        tn(s) { return A + (s - s0) / v; },
        id(p) { return "g" + index + ":" + p + (uid++); },
        r(a, bb) { return a + (bb - a) * rnd(); },
        pick(list) { return list[Math.floor(rnd() * list.length) % list.length]; },
        floor(x, sa, sb, w, o) {
          o = o || {};
          const top = o.top || 0;
          const depth = o.depth || 1.4;
          b.floors.push({ id: b.id("f"), x, s: (sa + sb) / 2, hx: w / 2, hs: (sb - sa) / 2, top, bottom: top - depth, sup: true });
          b.route.push([sa, sb, x, w, top]);
          b.boxes.push({ x, top, s0: sa, s1: sb, w, depth: 0.6, mat: "stone" });
          b.boxes.push({ x, top: top - 0.6, s0: sa + 0.05, s1: sb - 0.05, w: w + 0.28, depth: 0.22, mat: "trim" });
          b.boxes.push({ x, top: top - 0.82, s0: sa + 0.1, s1: sb - 0.1, w: w * 0.72, depth: 0.9, mat: "side" });
          if (o.piers !== false) {
            const L = sb - sa;
            const n = Math.max(1, Math.round(L / 9));
            for (let i = 0; i <= n; i++) {
              if ((i === 0 && o.noPierStart) || (i === n && o.noPierEnd)) continue;
              const ps = clamp(sa + (L * i) / n, sa + 0.7, sb - 0.7);
              b.boxes.push({ x, top: top - 1.7, s0: ps - 0.6, s1: ps + 0.6, w: Math.min(w * 0.6, 2.2), depth: top - 1.7 - ABYSS, mat: "deep" });
            }
          }
          const par = o.parapet;
          if (par) {
            for (const side of [-1, 1]) {
              if (par === "left" && side > 0) continue;
              if (par === "right" && side < 0) continue;
              const px = x + side * (w / 2 - 0.14);
              b.floors.push({ id: b.id("p"), x: px, s: (sa + sb) / 2, hx: 0.14, hs: (sb - sa) / 2, top: top + 0.64, bottom: top, sup: true });
              b.boxes.push({ x: px, top: top + 0.64, s0: sa, s1: sb, w: 0.28, depth: 0.64, mat: "trim" });
            }
          }
          return b;
        },
        terrace(x, sa, sb, w, top) {
          b.floors.push({ id: b.id("t"), x, s: (sa + sb) / 2, hx: w / 2, hs: (sb - sa) / 2, top, bottom: ABYSS, sup: true });
          b.route.push([sa, sb, x, w, top]);
          b.boxes.push({ x, top, s0: sa, s1: sb, w, depth: 0.6, mat: "stone" });
          b.boxes.push({ x, top: top - 0.6, s0: sa, s1: sb, w: w + 0.1, depth: top - 0.6 - ABYSS, mat: "side" });
          b.boxes.push({ x, top: top - 0.5, s0: sa - 0.06, s1: sb, w: w + 0.3, depth: 0.25, mat: "trim" });
          return b;
        },
        steps(x, sa, w, fromTop, toTop, n) {
          const L = 1.0;
          for (let i = 0; i < n; i++) {
            const t = lerp(fromTop, toTop, (i + 1) / (n + 1));
            b.floors.push({ id: b.id("st"), x, s: sa + (i + 0.5) * L, hx: w / 2, hs: L / 2, top: t, bottom: ABYSS, sup: true });
            b.route.push([sa + i * L, sa + (i + 1) * L, x, w, t]);
            b.boxes.push({ x, top: t, s0: sa + i * L, s1: sa + (i + 1) * L, w, depth: t - ABYSS, mat: "stone" });
          }
          return sa + n * L;
        },
        add(el) { b.elements.push(el); return el; },
        shard(x, s, o) {
          o = o || {};
          const sh = new Shard({ id: b.id("sh"), x, s, y: o.y, a: o.a, b: o.b, host: o.host, key: o.key });
          b.shards.push(sh);
          return sh;
        },
        arch(s, hw, xc) {
          xc = xc || 0;
          const H = 8.2;
          for (const sd of [-1, 1]) {
            const px = xc + sd * (hw + 0.75);
            b.boxes.push({ x: px, top: H, s0: s - 0.6, s1: s + 0.6, w: 1.0, depth: H - ABYSS, mat: "dSide" });
            b.boxes.push({ x: px, top: H + 0.3, s0: s - 0.75, s1: s + 0.75, w: 1.3, depth: 0.3, mat: "dTrim" });
            b.boxes.push({ x: px, top: 1.1, s0: s - 0.7, s1: s + 0.7, w: 1.2, depth: 0.25, mat: "dTrim" });
          }
          b.boxes.push({ x: xc, top: H + 1.4, s0: s - 0.55, s1: s + 0.55, w: hw * 2 + 3.1, depth: 1.1, mat: "dIvory" });
          b.boxes.push({ x: xc, top: H + 1.75, s0: s - 0.65, s1: s + 0.65, w: hw * 2 + 3.4, depth: 0.35, mat: "dTrim" });
        },
        obelisk(x, s, h) {
          h = h || 4.5;
          b.floors.push({ id: b.id("ob"), x, s, hx: 0.6, hs: 0.6, top: h, bottom: 0, sup: true });
          b.boxes.push({ x, top: 0.4, s0: s - 0.6, s1: s + 0.6, w: 1.2, depth: 0.4, mat: "dTrim" });
          b.boxes.push({ x, top: h, s0: s - 0.35, s1: s + 0.35, w: 0.7, depth: h - 0.4, mat: "dIvory" });
          b.boxes.push({ x, top: h + 0.45, s0: s - 0.2, s1: s + 0.2, w: 0.4, depth: 0.45, mat: "dBrass" });
        },
        // a balustrade across the gap where a walkway forks: indecision stops you, it never drops you
        prow(xc, gapW, s) {
          b.floors.push({ id: b.id("prow"), x: xc, s: s - 0.25, hx: gapW / 2, hs: 0.25, top: 0.95, bottom: -0.3, sup: true });
          b.boxes.push({ x: xc, top: 0.95, s0: s - 0.5, s1: s, w: gapW, depth: 0.95, mat: "trim" });
          b.boxes.push({ x: xc, top: 1.12, s0: s - 0.6, s1: s + 0.1, w: gapW + 0.2, depth: 0.17, mat: "brass" });
          b.boxes.push({ x: xc, top: 2.1, s0: s - 0.55, s1: s + 0.05, w: 0.5, depth: 1.0, mat: "dIvory" });
        },
        hint(key, sa, sb) { b.hints.push({ key, sa, sb }); }
      };
      return b;
    }

    // ---- designed opening: the magic within three seconds, then one idea at a time ----
    function tplStart(b) {
      const s0 = b.s0;
      b.floor(0, s0, s0 + 9, 6.4, { parapet: "both" });
      b.obelisk(-2.6, s0 + 1.5); b.obelisk(2.6, s0 + 1.5);
      b.hint("move", s0, s0 + 9);
      return 9;
    }

    // Seconds into the run, the bridge ahead is already cracking and falls away. A latch stops
    // the player at the edge; rewinding pulls it back together; holding REWIND while crossing
    // keeps it whole. Its shards exist only while the bridge stands.
    function tplFirstSpan(b) {
      const s0 = b.s0;
      b.floor(0, s0, s0 + 2, MAIN_W, { parapet: "both", noPierEnd: true });
      const Tc = 1.0;
      b.add(new Span({ id: b.id("sp"), x: 0, s0: s0 + 2, s1: s0 + 12, w: MAIN_W, collapseAt: Tc, collapseDir: -1, cascade: 0.12, latch: true, seed: b.seed + 3 }));
      for (let i = 0; i < 5; i++) b.shard(Math.sin(i * 1.3) * 0.7, s0 + 3.2 + i * 1.9, { b: Tc + 0.35 });
      b.floor(0, s0 + 12, s0 + 17, MAIN_W, { parapet: "both", noPierStart: true });
      b.hint("rewind", s0 - 4, s0 + 2.6);
      b.hint("hold", s0 + 1, s0 + 11);
      return 17;
    }

    // First choice: the ring is short and direct but needs its deck aligned; the dividing
    // bridge is longer, carries shards on its halves, and asks you to cross while it is joined.
    function tplFirstChoice(b) {
      const s0 = b.s0, PX = 3.2, PW = 2.4;
      b.floor(0, s0, s0 + 4, PX * 2 + PW, { parapet: "both" });
      b.arch(s0 + 1.0, PX + PW / 2);
      b.prow(0, PX * 2 - PW, s0 + 4);
      b.floor(-PX, s0 + 4, s0 + 6, PW, { parapet: "left", noPierEnd: true });
      const ring = b.add(new Ring({ id: b.id("rg"), x: -PX, s0: s0 + 6, s1: s0 + 10, R: 3.4, period: 7, phase: b.tn(s0 + 6) + 2.4, deckW: PW + 0.2 }));
      b.shard(0, 0, { host: ring, key: { k: 0, s: 0 } });
      b.floor(-PX, s0 + 10, s0 + 16, PW, { parapet: "left", noPierStart: true });
      b.floor(PX, s0 + 4, s0 + 6, PW + 0.4, { parapet: "right", noPierEnd: true });
      const sp = b.add(new SplitBridge({ id: b.id("sb"), x: PX, s0: s0 + 6, s1: s0 + 14, w: PW + 0.4, period: 6.5, phase: b.tn(s0 + 6) - 2.2 }));
      for (let i = 0; i < 3; i++) b.shard(0, 0, { host: sp, key: { side: i % 2 ? 1 : -1, dx: 0, s: -2.6 + i * 2.6 } });
      b.floor(PX, s0 + 14, s0 + 16, PW + 0.4, { parapet: "right", noPierStart: true });
      b.floor(0, s0 + 16, s0 + 21, PX * 2 + PW, { parapet: "both" });
      b.hint("choice", s0, s0 + 5);
      return 21;
    }

    // First combination: a fallen bridge you must rewind, guarded by a blade that rewinds with
    // it; then a stair that has not unfolded yet — the first reason to HURRY time.
    function tplFirstCombo(b) {
      const s0 = b.s0;
      b.floor(0, s0, s0 + 3, MAIN_W, { parapet: "both", noPierEnd: true });
      const sp = b.add(new Span({ id: b.id("sp"), x: 0, s0: s0 + 3, s1: s0 + 13, w: MAIN_W, collapseAt: b.tn(s0 + 3) - 1.2, collapseDir: 1, cascade: 0.1, seed: b.seed + 5 }));
      const w = sp.windows(0, 1e9)[0];
      b.shard(0, s0 + 8, { a: w[0] - 0.2, b: w[1] + 0.35 });
      b.floor(0, s0 + 13, s0 + 27, MAIN_W, { parapet: "right", noPierStart: true });
      b.add(new Gnomon({ id: b.id("gn"), px: -MAIN_W / 2 - 0.75, ps: s0 + 19, len: 4.0, period: 4.2, phase: b.r(0, 4.2), dir: 1, pathX: 0, pathW: MAIN_W }));
      b.shard(0.9, s0 + 19);
      b.add(new FoldStair({ id: b.id("fs"), x: 0, sWall: s0 + 27, H: 2.4, w: MAIN_W, K: 4, extendAt: b.tn(s0 + 24) + 4.5 }));
      b.terrace(0, s0 + 27, s0 + 33, MAIN_W, 2.4);
      b.shard(0, s0 + 30, { y: 3.2 });
      const e = b.steps(0, s0 + 33, MAIN_W, 2.4, 0, 4);
      b.floor(0, e, e + 4, MAIN_W, { parapet: "both" });
      b.hint("hurry", s0 + 21, s0 + 27);
      return e + 4 - s0;
    }

    // ---- endless templates (difficulty d in 0..1) ----
    function tplSpan(b) {
      const s0 = b.s0, d = b.diff, v = b.v;
      b.floor(0, s0, s0 + 5, MAIN_W, { parapet: d < 0.3 ? "both" : null, noPierEnd: true });
      b.arch(s0 + 1.5, MAIN_W / 2);
      const len = Math.round(b.r(9, 11 + d * 4));
      const sa = s0 + 5, sb = sa + len;
      const mode = b.pick(d < 0.25 ? ["past", "future"] : ["past", "future", "chase", "past"]);
      const o = { id: b.id("sp"), x: 0, s0: sa, s1: sb, w: MAIN_W, seed: b.seed + 1, latch: d < 0.3 };
      if (mode === "past") { o.collapseAt = b.tn(sa) - b.r(0.6, 1.6 + d * 2); o.collapseDir = b.pick([1, -1]); o.cascade = b.r(0.08, 0.16); }
      else if (mode === "future") { o.assembleAt = b.tn(sa) + b.r(0.4, 1.2 + d); o.assembleDir = b.pick([1, -1]); o.assembleStagger = 0.1; o.collapseAt = o.assembleAt + len * 0.13 + b.r(5, 9 - d * 3); }
      else { o.collapseAt = b.tn(sa) + b.r(0.5, 1.2); o.collapseDir = 1; o.cascade = (len / Math.max(4, Math.round(len / 1.45))) / (b.r(0.72, 0.86) * v); o.latch = false; o.chase = true; }
      const sp = b.add(new Span(o));
      // these shards are lodged in the bridge's own moment: they exist only while it stands
      const w = sp.windows(0, 1e9)[0] || [0, 1e9];
      for (let i = 0; i < 3; i++) b.shard(i === 1 ? 0 : (i === 0 ? -0.9 : 0.9), sa + len * (0.25 + i * 0.25), { a: w[0] - 0.2, b: Math.min(1e9, w[1] + 0.35) });
      b.floor(0, sb, sb + 6, MAIN_W, { parapet: d < 0.3 ? "both" : null, noPierStart: true });
      return sb + 6 - s0;
    }

    function tplTwinSpan(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 5, MAIN_W, { noPierEnd: true });
      b.arch(s0 + 1.5, MAIN_W / 2);
      const sa = s0 + 5, sb = sa + 9, sc = sb + 4.5, sd = sc + 9;
      // first bridge already fell: reverse. Second has not yet risen: advance.
      b.add(new Span({ id: b.id("sp"), x: 0, s0: sa, s1: sb, w: MAIN_W, collapseAt: b.tn(sa) - b.r(0.5, 1.5), collapseDir: -1, cascade: 0.1, seed: b.seed + 2 }));
      b.floor(0, sb, sc, MAIN_W, { noPierStart: true, noPierEnd: true, parapet: "both" });
      b.add(new Span({ id: b.id("sp"), x: 0, s0: sc, s1: sd, w: MAIN_W, assembleAt: b.tn(sc) + b.r(0.6, 1.4 + d), assembleDir: -1, assembleStagger: 0.09, seed: b.seed + 4 }));
      const [s1, s2] = b.elements.slice(-2);
      const w1 = s1.windows(0, 1e9)[0], w2 = s2.windows(0, 1e9)[0];
      b.shard(0, (sa + sb) / 2, { a: w1[0] - 0.2, b: w1[1] + 0.35 }); b.shard(0, (sb + sc) / 2); b.shard(0, (sc + sd) / 2, { a: w2[0] - 0.2, b: Math.min(1e9, w2[1] + 0.35) });
      b.floor(0, sd, sd + 6, MAIN_W, { noPierStart: true });
      return sd + 6 - s0;
    }

    function tplFerry(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 5, MAIN_W, { parapet: d < 0.35 ? "both" : null, noPierEnd: true });
      const L = Math.round(b.r(14, 17 + d * 6));
      const dwell = b.r(1.6, 2.4) - d * 0.5, travel = L * b.r(0.16, 0.2);
      const fe = b.add(new Ferry({ id: b.id("fe"), x: 0, s0: s0 + 5, s1: s0 + 5 + L, w: 3.2, len: 4.6, dwell, travel, phase: b.tn(s0 + 5) + b.r(-2, 2), dockLatch: d < 0.35 }));
      b.shard(0, 0, { host: fe, key: { x: -0.8, s: 0.6 } });
      b.shard(0, 0, { host: fe, key: { x: 0.8, s: -0.6 } });
      b.floor(0, s0 + 5 + L, s0 + 11 + L, MAIN_W, { parapet: d < 0.35 ? "both" : null, noPierStart: true });
      return 11 + L;
    }

    function tplRing(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 5, MAIN_W, { noPierEnd: true });
      const two = d >= 0.45 && b.rnd() < 0.6;
      const D = 4;
      let s = s0 + 5;
      const p1 = b.r(7, 10) - d * 2;
      const r1 = b.add(new Ring({ id: b.id("rg"), x: 0, s0: s, s1: s + D, R: 3.6, period: p1, phase: b.tn(s) + b.r(-2, 2), dir: b.pick([1, -1]), deckW: MAIN_W }));
      b.shard(0, 0, { host: r1, key: { k: 1, s: 0 } });
      s += D;
      if (two) {
        b.floor(0, s, s + 3, MAIN_W, { noPierStart: true, noPierEnd: true });
        b.shard(0, s + 1.5);
        s += 3;
        const r2 = b.add(new Ring({ id: b.id("rg"), x: 0, s0: s, s1: s + D, R: 3.0, period: p1 * b.pick([0.75, 1.33]), phase: b.tn(s) + b.r(-2, 2), dir: -r1.dirn, deckW: MAIN_W }));
        b.shard(0, 0, { host: r2, key: { k: 0, s: 0 } });
        s += D;
      }
      b.floor(0, s, s + 6, MAIN_W, { noPierStart: true });
      return s + 6 - s0;
    }

    function tplStair(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 8, MAIN_W, { parapet: "both" });
      b.arch(s0 + 1.5, MAIN_W / 2);
      const ext = b.tn(s0 + 7) + b.r(-1.5, 1.5);
      const H = 2.4;
      b.add(new FoldStair({ id: b.id("fs"), x: 0, sWall: s0 + 8, H, w: MAIN_W, K: 4, extendAt: ext, retractAt: ext + b.r(6, 9) - d * 3 }));
      // the terrace leaps over a chasm: the stair is the only way up
      b.terrace(0, s0 + 8, s0 + 12, MAIN_W, H);
      b.floor(0, s0 + 12, s0 + 22, MAIN_W, { top: H, parapet: d < 0.5 ? "both" : null });
      b.shard(0, s0 + 15, { y: H + 0.8 }); b.shard(0, s0 + 18, { y: H + 0.8 });
      let gateS = 0;
      if (d > 0.35 && b.rnd() < 0.6) {
        gateS = s0 + 20;
        b.add(new Gate({ id: b.id("gt"), x: 0, s: gateS, y: H, w: MAIN_W - 0.4, period: b.r(5, 7), phase: b.r(0, 5), openFrac: b.r(0.45, 0.6) - d * 0.1 }));
      }
      b.terrace(0, s0 + 22, s0 + 24, MAIN_W, H);
      const e = b.steps(0, s0 + 24, MAIN_W, H, 0, 4);
      b.floor(0, e, e + 6, MAIN_W);
      return e + 6 - s0;
    }

    function tplGnomons(b) {
      const s0 = b.s0, d = b.diff;
      const n = d < 0.3 ? 1 : d < 0.65 ? 2 : 3;
      const L = 8 + n * 11;
      const parapet = d < 0.3 ? "both" : null;
      b.floor(0, s0, s0 + L + 6, MAIN_W, { parapet });
      b.arch(s0 + 1.5, MAIN_W / 2);
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? b.pick([-1, 1]) : -1 * (b._lastSide || 1);
        b._lastSide = side;
        // 11 units apart with 3.8-unit blades: a clear pocket of stone between each sweep, since
        // a blade can no longer be frozen in place — only reversed or hurried
        const ps = s0 + 8 + i * 11;
        b.add(new Gnomon({ id: b.id("gn"), px: side * (MAIN_W / 2 + 0.75), ps, len: 3.8, period: b.r(3.2, 4.6) - d * 0.8, phase: b.r(0, 4), dir: b.pick([1, -1]), pathX: 0, pathW: MAIN_W }));
        b.shard(-side * 0.9, ps);
      }
      return L + 6;
    }

    function tplGates(b) {
      const s0 = b.s0, d = b.diff, PX = 2.3, PW = 2.2;
      b.floor(0, s0, s0 + 5, PX * 2 + PW, {});
      b.arch(s0 + 1.5, PX + PW / 2);
      const P = b.r(5, 7.5), ph = b.r(0, P);
      const frac = b.r(0.42, 0.55) - d * 0.08;
      b.prow(0, PX * 2 - PW, s0 + 5);
      b.floor(-PX, s0 + 5, s0 + 21, PW, { parapet: "left" });
      b.floor(PX, s0 + 5, s0 + 21, PW, { parapet: "right" });
      // alternating escapements: when one opens, the other closes
      b.add(new Gate({ id: b.id("gt"), x: -PX, s: s0 + 12, w: PW - 0.3, period: P, phase: ph, openFrac: frac }));
      b.add(new Gate({ id: b.id("gt"), x: PX, s: s0 + 12, w: PW - 0.3, period: P, phase: ph + P / 2, openFrac: frac }));
      const rich = b.pick([-1, 1]);
      for (let i = 0; i < 3; i++) b.shard(rich * PX, s0 + 14 + i * 1.6);
      if (d > 0.5) b.add(new Gnomon({ id: b.id("gn"), px: rich * (PX + PW / 2 + 0.75), ps: s0 + 17.5, len: 3.4, period: b.r(3, 4), phase: b.r(0, 3), dir: 1, pathX: rich * PX, pathW: PW }));
      b.floor(0, s0 + 21, s0 + 27, PX * 2 + PW, {});
      return 27;
    }

    function tplSpanGnomon(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 5, MAIN_W, { noPierEnd: true });
      const sa = s0 + 5, sb = sa + 10;
      b.add(new Span({ id: b.id("sp"), x: 0, s0: sa, s1: sb, w: MAIN_W, collapseAt: b.tn(sa) - b.r(0.5, 2), collapseDir: b.pick([1, -1]), cascade: 0.12, seed: b.seed + 6 }));
      b.shard(0, sa + 5);
      b.floor(0, sb, sb + 17, MAIN_W, { noPierStart: true });
      // reversing to rebuild the bridge also rewinds the blade across the landing;
      // a few strides of safe stone separate the two
      b.add(new Gnomon({ id: b.id("gn"), px: b.pick([-1, 1]) * (MAIN_W / 2 + 0.75), ps: sb + 8.5, len: 4.2, period: b.r(3.4, 4.4) - d * 0.6, phase: b.r(0, 4), dir: b.pick([1, -1]), pathX: 0, pathW: MAIN_W }));
      b.shard(0, sb + 8.5);
      return sb + 17 - s0;
    }

    function tplFerryRing(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 5, MAIN_W, { noPierEnd: true });
      const L = 15;
      const fe = b.add(new Ferry({ id: b.id("fe"), x: 0, s0: s0 + 5, s1: s0 + 5 + L, w: 3.2, len: 4.6, dwell: 1.8, travel: 2.8, phase: b.tn(s0 + 5) + b.r(-2, 2) }));
      b.shard(0, 0, { host: fe, key: { x: 0, s: 0 } });
      let s = s0 + 5 + L;
      b.floor(0, s, s + 4, MAIN_W, { noPierStart: true, noPierEnd: true });
      s += 4;
      const rg = b.add(new Ring({ id: b.id("rg"), x: 0, s0: s, s1: s + 4, R: 3.6, period: b.r(6, 8) - d, phase: b.r(0, 8), dir: b.pick([1, -1]), deckW: MAIN_W }));
      b.shard(0, 0, { host: rg, key: { k: 0, s: 0 } });
      s += 4;
      b.floor(0, s, s + 6, MAIN_W, { noPierStart: true });
      return s + 6 - s0;
    }

    function tplSplit(b) {
      const s0 = b.s0, d = b.diff, W = MAIN_W;
      b.floor(0, s0, s0 + 4, W, { noPierEnd: true });
      const L = Math.round(b.r(8, 10 + d * 3));
      const sp = b.add(new SplitBridge({ id: b.id("sb"), x: 0, s0: s0 + 4, s1: s0 + 4 + L, w: W, period: b.r(5.5, 7) - d, phase: b.tn(s0 + 4) + b.r(-3, 3), closedFrac: 0.38 - d * 0.1 }));
      // shards ride the outer edges of the halves: reach them while the bridge is splitting
      b.shard(0, 0, { host: sp, key: { side: -1, dx: -0.4, s: -L / 4 } });
      b.shard(0, 0, { host: sp, key: { side: 1, dx: 0.4, s: L / 4 } });
      b.floor(0, s0 + 4 + L, s0 + 9 + L, W, { noPierStart: true });
      return 9 + L;
    }

    function tplPillars(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 4, MAIN_W, { noPierEnd: true, parapet: d < 0.4 ? "both" : null });
      b.arch(s0 + 1.2, MAIN_W / 2);
      const rows = Math.round(b.r(7, 9 + d * 4));
      const holes = [];
      if (d > 0.3) for (let r = 1; r < rows - 1; r++) if (b.rnd() < 0.18 + d * 0.15) holes.push(r * 3 + (b.rnd() < 0.5 ? 0 : 2));
      const pw = b.add(new PillarWave({ id: b.id("pw"), x: 0, s0: s0 + 4, w: MAIN_W, rows, period: b.r(5.5, 7.5) - d, phase: b.tn(s0 + 4) + b.r(-3, 3), A: 1.25 + d * 0.3, holes }));
      for (let i = 0; i < 3; i++) b.shard(0, 0, { host: pw, key: { r: Math.floor((rows - 1) * (0.25 + i * 0.25)), c: i === 1 ? 1 : (i === 0 ? 0 : 2) } });
      b.floor(0, pw.s1, pw.s1 + 5, MAIN_W, { noPierStart: true });
      return pw.s1 + 5 - s0;
    }

    function tplSplitGnomon(b) {
      const s0 = b.s0, d = b.diff, W = MAIN_W;
      b.floor(0, s0, s0 + 4, W, { noPierEnd: true });
      const sp = b.add(new SplitBridge({ id: b.id("sb"), x: 0, s0: s0 + 4, s1: s0 + 13, w: W, period: b.r(5.5, 6.5), phase: b.tn(s0 + 4) + b.r(-2, 2) }));
      b.shard(0, 0, { host: sp, key: { side: 1, dx: 0.3, s: 0 } });
      b.floor(0, s0 + 13, s0 + 27, W, { noPierStart: true });
      b.add(new Gnomon({ id: b.id("gn"), px: b.pick([-1, 1]) * (W / 2 + 0.75), ps: s0 + 20.5, len: 4.0, period: b.r(3.4, 4.4) - d * 0.5, phase: b.r(0, 4), dir: b.pick([1, -1]), pathX: 0, pathW: W }));
      b.shard(0, s0 + 20.5);
      return 27;
    }

    function tplPillarsSpan(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 4, MAIN_W, { noPierEnd: true });
      const pw = b.add(new PillarWave({ id: b.id("pw"), x: 0, s0: s0 + 4, w: MAIN_W, rows: 7, period: b.r(6, 7), phase: b.tn(s0 + 4) + b.r(-2, 2), A: 1.3 }));
      b.shard(0, 0, { host: pw, key: { r: 3, c: 1 } });
      let s = pw.s1;
      b.floor(0, s, s + 3, MAIN_W, { noPierStart: true, noPierEnd: true });
      s += 3;
      // the bridge ahead fell a moment ago: rewinding restores it, but also sends the wave back
      const sp = b.add(new Span({ id: b.id("sp"), x: 0, s0: s, s1: s + 9, w: MAIN_W, collapseAt: b.tn(s) - b.r(0.6, 1.4), collapseDir: -1, cascade: 0.1, seed: b.seed + 8 }));
      const w = sp.windows(0, 1e9)[0];
      b.shard(0, s + 4.5, { a: w[0] - 0.2, b: w[1] + 0.35 });
      b.floor(0, s + 9, s + 14, MAIN_W, { noPierStart: true });
      void d;
      return s + 14 - s0;
    }

    function tplRingSplit(b) {
      const s0 = b.s0, d = b.diff;
      b.floor(0, s0, s0 + 4, MAIN_W, { noPierEnd: true });
      const rg = b.add(new Ring({ id: b.id("rg"), x: 0, s0: s0 + 4, s1: s0 + 8, R: 3.6, period: b.r(6, 8) - d, phase: b.tn(s0 + 4) + b.r(-3, 3), dir: b.pick([1, -1]), deckW: MAIN_W }));
      b.shard(0, 0, { host: rg, key: { k: 1, s: 0 } });
      b.floor(0, s0 + 8, s0 + 11, MAIN_W, { noPierStart: true, noPierEnd: true });
      const sp = b.add(new SplitBridge({ id: b.id("sb"), x: 0, s0: s0 + 11, s1: s0 + 19, w: 3.4, period: b.r(5.5, 7), phase: b.tn(s0 + 11) + b.r(-3, 3) }));
      b.shard(0, 0, { host: sp, key: { side: -1, dx: -0.3, s: 1 } });
      b.floor(0, s0 + 19, s0 + 24, MAIN_W, { noPierStart: true });
      return 24;
    }

    const INTRO = [tplStart, tplFirstSpan, tplFirstChoice, tplFirstCombo];
    // Five regions. Each unlocks new mechanisms and favours them, then recombines the old.
    const PHASES = [
      { at: 0, name: "I · First Contact", tint: 0xffffff },
      { at: 5, name: "II · Interlocking", tint: 0xd7efec },
      { at: 11, name: "III · Verticality", tint: 0xf3d9d2 },
      { at: 17, name: "IV · Convergence", tint: 0xd8dcf2 },
      { at: 24, name: "V · Transformation", tint: 0xf6e3b8 }
    ];
    const phaseOf = (k) => { const e = Math.max(0, k - INTRO.length); let p = 0; for (let i = 0; i < PHASES.length; i++) if (e >= PHASES[i].at) p = i; return p; };
    const LIBRARY = [
      { fn: tplSpan, phase: 0, w: 3, name: "span" },
      { fn: tplRing, phase: 0, w: 2, name: "ring" },
      { fn: tplSplit, phase: 0, w: 2.5, name: "split" },
      { fn: tplFerry, phase: 0, w: 2, name: "ferry" },
      { fn: tplGnomons, phase: 1, w: 2, name: "gnomons" },
      { fn: tplGates, phase: 1, w: 2, name: "gates" },
      { fn: tplSpanGnomon, phase: 1, w: 2.5, name: "spanGnomon" },
      { fn: tplSplitGnomon, phase: 1, w: 2, name: "splitGnomon" },
      { fn: tplTwinSpan, phase: 1, w: 2, name: "twin" },
      { fn: tplStair, phase: 2, w: 2.5, name: "stair" },
      { fn: tplPillars, phase: 2, w: 3, name: "pillars" },
      { fn: tplPillarsSpan, phase: 3, w: 2.5, name: "pillarsSpan" },
      { fn: tplFerryRing, phase: 3, w: 2, name: "ferryRing" },
      { fn: tplRingSplit, phase: 3, w: 2.5, name: "ringSplit" }
    ];

    function chooseTemplate(rnd, k, last) {
      const d = clamp((k - INTRO.length) / 16, 0, 1);
      const ph = phaseOf(k);
      const pool = LIBRARY.filter((t) => t.phase <= ph && t.name !== last);
      let total = 0;
      // the newest region's mechanisms appear more often while that region lasts
      const weight = (t) => t.w * (t.phase === ph ? 2.2 : 1);
      for (const t of pool) total += weight(t);
      let x = rnd() * total;
      for (const t of pool) { x -= weight(t); if (x <= 0) return { t, d }; }
      return { t: pool[pool.length - 1], d };
    }

    // Validation: every generated encounter must offer a continuous route (floors or
    // timed elements cover the whole length), every timed element must open within reach,
    // and every chase must be outrunnable.
    function validateSegment(b, L) {
      const problems = [];
      const covered = (s) => {
        for (const r of b.route) if (s >= r[0] - 0.02 && s <= r[1] + 0.02) return true;
        for (const el of b.elements) if (el.crossS0 != null && s >= el.crossS0 - 0.05 && s <= el.crossS1 + 0.05) return true;
        return false;
      };
      for (let s = b.s0; s <= b.s0 + L; s += 0.25) if (!covered(s)) { problems.push("gap@" + s.toFixed(2)); break; }
      for (const el of b.elements) {
        if (!el.windows) continue;
        const w = el.windows(Math.max(0, b.A - 10), b.A + 200);
        if (w && w.length === 0) problems.push("never-open:" + el.id);
        if (el.type === "span" && el.chase) {
          // a designed chase must be outrunnable at cruise speed
          const front = el.bl / el.cascade;
          if (front >= runSpeedAt(el.s0) * 0.92) problems.push("chase-too-fast:" + el.id);
        }
        if (el.type === "stair" && el.H / (el.K + 1) > STEP_UP) problems.push("stair-too-steep:" + el.id);
      }
      const first = b.route.find((r) => r[0] <= b.s0 + 0.01);
      const last = b.route.find((r) => r[1] >= b.s0 + L - 0.01 && r[4] === 0 && Math.abs(r[2]) < 0.01);
      if (!first || first[3] < MAIN_W - 0.01 || first[4] !== 0) problems.push("bad-entry");
      if (!last || last[3] < MAIN_W - 0.01) problems.push("bad-exit");
      return problems;
    }

    // Decorative armillary for the opening light well: the first thing that visibly obeys T.
    class Gyro {
      constructor(o) {
        this.type = "gyro";
        this.id = o.id;
        this.sMin = o.s - 4; this.sMax = o.s + 4;
        this.group = new THREE.Group();
        this.group.position.set(o.x, o.y, -o.s);
        this.rings = [];
        const radii = [1.5, 1.15, 0.8];
        const ms = [mats.brass, mats.patina, mats.brass];
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(cachedGeo("gyro" + i, () => new THREE.TorusGeometry(radii[i], 0.07, 8, 56)), ms[i]);
          r.castShadow = true;
          this.group.add(r);
          this.rings.push(r);
        }
        const core = new THREE.Mesh(cachedGeo("gyroCore", () => new THREE.IcosahedronGeometry(0.32, 0)), mats.shard);
        this.group.add(core);
        this.core = core;
        const shaft = boxMesh(1.2, 30, 1.2, mats.deep);
        shaft.position.y = -16.6;
        this.group.add(shaft);
        const plinth = boxMesh(1.6, 0.4, 1.6, mats.trim);
        plinth.position.y = -1.7;
        this.group.add(plinth);
      }
      colliders() {}
      render(T) {
        this.rings[0].rotation.set(T * 0.7, 0, 0.3);
        this.rings[1].rotation.set(0, T * 1.1, T * 0.4);
        this.rings[2].rotation.set(T * 1.6, T * 0.5, 0);
        this.core.rotation.y = T * 0.9;
        this.core.position.y = Math.sin(T * 1.7) * 0.12;
      }
      windows() { return null; }
      events() {}
    }

    // =====================================================================
    // 6. COURSE — lazy segment construction ahead of the player, disposal behind.
    // =====================================================================
    class Segment {
      constructor(b, L) {
        this.index = b.index; this.kind = b.kind; this.s0 = b.s0; this.s1 = b.s0 + L; this.A = b.A; this.v = b.v; this.diff = b.diff; this.seed = b.seed;
        this.group = new THREE.Group();
        this.staticGroup = bakeBoxes(b.boxes);
        this.group.add(this.staticGroup);
        this.floors = b.floors;
        this.elements = b.elements;
        this.shards = b.shards;
        this.hints = b.hints;
        this.cleared = false; this.fellHere = false;
        for (const el of this.elements) this.group.add(el.group);
        for (const sh of this.shards) this.group.add(sh.group);
        // gnomon columns are solid
        for (const el of this.elements) {
          if (el.type === "gnomon") this.floors.push({ id: el.id + ":col", x: el.px, s: el.ps, hx: 0.55, hs: 0.55, top: 1.4, bottom: -40, sup: true });
        }
      }
      colliders(T, sa, sb, out) {
        for (const f of this.floors) if (f.s + f.hs >= sa && f.s - f.hs <= sb) out.push(f);
        for (const el of this.elements) if (el.sMax >= sa && el.sMin <= sb) el.colliders(T, out);
      }
      hazards(T, prevT, sa, sb, out) {
        for (const el of this.elements) if (el.hazards && el.sMax >= sa && el.sMin <= sb) el.hazards(T, prevT, out);
      }
      render(T, collected) {
        for (const el of this.elements) el.render(T);
        for (const sh of this.shards) sh.render(T, collected.has(sh.id));
      }
      dispose() {
        disposeGroup(this.group);
      }
    }

    const course = {
      segs: [],
      seed: 1,
      k: 0,
      nextS: -6,
      lastTpl: "",
      rnd: mulberry32(1),
      root: new THREE.Group(),
      log: [],
      reset(seed) {
        for (const sg of this.segs) sg.dispose();
        this.segs = [];
        this.seed = seed >>> 0;
        this.rnd = mulberry32(this.seed ^ 0xa5a5a5);
        this.k = 0; this.nextS = -6; this.lastTpl = ""; this.log = [];
      },
      buildNext() {
        const k = this.k;
        const s0 = this.nextS, v = runSpeedAt(Math.max(0, s0));
        // Anchor: the world time at which a player who keeps time flowing from *now* would
        // arrive. Segments are generated ~20 s ahead, deep in the fog, so their history is
        // fixed long before it is visible, and rewinds earlier in the run never accumulate
        // into long waits later.
        const A = clock.T + (s0 - player.s) / v;
        let seg = null;
        if (k < INTRO.length) {
          const b = makeBuilder(k, s0, A, v, 1000 + k * 7919, 0, "intro" + k);
          const L = INTRO[k](b);
          const pr = validateSegment(b, L);
          if (pr.length) this.log.push({ k, kind: b.kind, problems: pr });
          seg = new Segment(b, L);
        } else {
          for (let attempt = 0; attempt < 6 && !seg; attempt++) {
            const pick = chooseTemplate(this.rnd, k, this.lastTpl);
            const segSeed = (Math.imul(this.seed, 2654435761) ^ (k * 40503 + attempt * 977)) >>> 0;
            const b = makeBuilder(k, s0, A, v, segSeed, pick.d, pick.t.name);
            const L = pick.t.fn(b);
            const pr = validateSegment(b, L);
            if (pr.length) {
              this.log.push({ k, kind: b.kind, problems: pr, attempt });
              for (const el of b.elements) disposeGroup(el.group);
              for (const sh of b.shards) disposeGroup(sh.group);
              continue;
            }
            seg = new Segment(b, L);
            this.lastTpl = pick.t.name;
          }
          if (!seg) {
            const b = makeBuilder(k, s0, A, v, k * 13 + 7, 0, "gnomons");
            seg = new Segment(b, tplGnomons(b));
          }
        }
        seg.phase = k < INTRO.length ? 0 : phaseOf(k);
        this.segs.push(seg);
        this.root.add(seg.group);
        this.k++;
        this.nextS = seg.s1;
        return seg;
      },
      ensure(sAhead) {
        while (this.nextS < sAhead) this.buildNext();
      },
      cull(sBehind) {
        while (this.segs.length && this.segs[0].s1 < sBehind) {
          const sg = this.segs.shift();
          sg.dispose();
        }
      },
      segAt(s) {
        for (const sg of this.segs) if (s >= sg.s0 && s < sg.s1) return sg;
        return null;
      },
      colliders(T, sa, sb, out) {
        for (const sg of this.segs) if (sg.s1 >= sa && sg.s0 <= sb) sg.colliders(T, sa, sb, out);
        return out;
      },
      hazards(T, prevT, sa, sb, out) {
        for (const sg of this.segs) if (sg.s1 >= sa && sg.s0 <= sb) sg.hazards(T, prevT, sa, sb, out);
        return out;
      },
      render(T, collected, sa, sb) {
        for (const sg of this.segs) {
          const vis = sg.s1 >= sa && sg.s0 <= sb;
          sg.group.visible = vis;
          if (vis) sg.render(T, collected);
        }
      },
      forEachElement(sa, sb, fn) {
        for (const sg of this.segs) {
          if (sg.s1 < sa || sg.s0 > sb) continue;
          for (const el of sg.elements) if (el.sMax >= sa && el.sMin <= sb) fn(el, sg);
        }
      }
    };
    scene.add(course.root);

    // =====================================================================
    // SCENERY — distant monuments and abyss columns, so the world reads as enormous.
    // Several monuments are themselves clocks driven by world time.
    // =====================================================================
    const scenery = {
      districts: [],
      nextS: -40,
      root: new THREE.Group(),
      seed: 1,
      pillarGeo: new THREE.BoxGeometry(1, 1, 1),
      reset(seed) {
        for (const d of this.districts) disposeGroup(d.group);
        this.districts = [];
        this.nextS = -60;
        this.seed = seed;
      },
      ensure(sAhead) {
        while (this.nextS < sAhead) {
          this.districts.push(this.build(this.nextS, this.districts.length));
          this.nextS += 62;
        }
      },
      cull(sBehind) {
        while (this.districts.length && this.districts[0].s1 < sBehind) disposeGroup(this.districts.shift().group);
      },
      build(s0, idx) {
        const rnd = mulberry32((this.seed * 31 + idx * 7907) >>> 0);
        const group = new THREE.Group();
        const anim = [];
        // the drowned colonnades: rows of piers stepping down into the abyss on both sides
        const rows = [[-13, -16], [13, -19], [-24, -24], [24, -27], [-40, -20], [40, -23]];
        const count = rows.length * 6;
        const inst = new THREE.InstancedMesh(this.pillarGeo, mats.farCool, count);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
        let n = 0;
        for (const [rx, rtop] of rows) {
          const pitch = 10 + Math.abs(rx) * 0.12;
          const off = rnd() * pitch;
          for (let k = 0; k < 6; k++) {
            const s = s0 + off + k * pitch;
            const w = 2.2 + Math.abs(rx) * 0.06;
            const top = rtop - 6 * Math.abs(Math.sin(s * 0.05 + rx)) - (rnd() < 0.2 ? 10 : 0);
            const h = 80;
            tr.set(rx + (rnd() - 0.5) * 1.5, top - h / 2, -s); sc.set(w, h, w * 1.6);
            q.identity();
            m4.compose(tr, q, sc);
            inst.setMatrixAt(n++, m4);
          }
        }
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
        // monument
        const side = idx % 2 === 0 ? -1 : 1;
        const type = idx === 0 ? 0 : Math.floor(rnd() * 5);
        const mx = side * (34 + rnd() * 22), ms = s0 + 20 + rnd() * 25;
        const M = new THREE.Group();
        M.position.set(mx, 0, -ms);
        const far = mats.far;
        const addBox = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(this.pillarGeo, m || far); b.scale.set(w, h, d); b.position.set(x, y, z); M.add(b); return b; };
        if (type === 0) {
          // armillary sphere on a column
          addBox(4, 70, 4, 0, -30, 0);
          addBox(7, 1.4, 7, 0, 5, 0);
          const piv = new THREE.Group(); piv.position.y = 17; M.add(piv);
          const rings = [];
          for (let i = 0; i < 3; i++) {
            const r = new THREE.Mesh(new THREE.TorusGeometry(11 - i * 2.4, 0.45, 8, 72), i === 1 ? mats.farCool : far);
            r.userData.ownGeo = true;
            piv.add(r); rings.push(r);
          }
          const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), far);
          orb.userData.ownGeo = true;
          piv.add(orb);
          const tilt = rnd() * 0.6;
          anim.push((T) => {
            rings[0].rotation.set(T * 0.11 + tilt, 0, 0.4);
            rings[1].rotation.set(0.3, T * 0.17, T * 0.07);
            rings[2].rotation.set(T * 0.23, 0.2, T * 0.05);
          });
        } else if (type === 1) {
          // great sundial: tilted face with a leaning gnomon
          addBox(5, 60, 5, 0, -28, 0);
          const face = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1.4, 48), far);
          face.userData.ownGeo = true;
          face.position.y = 3; face.rotation.x = 0.25; M.add(face);
          const g = addBox(1.2, 16, 9, 0, 9, 0); g.rotation.x = -0.6;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU;
            const t = addBox(0.6, 0.5, 2.4, Math.cos(a) * 12.5, 3.9, Math.sin(a) * 12.5, mats.farCool);
            t.rotation.y = -a;
          }
        } else if (type === 2) {
          // aqueduct running alongside, a bridge between distant destinations
          const n = 9;
          for (let i = 0; i < n; i++) {
            addBox(2.2, 60, 2.6, 0, -25, -i * 7.5 + 30);
            addBox(2.6, 3, 7.5, 0, 6.5, -i * 7.5 + 30 - 3.75);
          }
          addBox(3.6, 0.8, n * 7.5, 0, 8.4, 30 - (n * 7.5) / 2 + 3.75, mats.farCool);
        } else if (type === 3) {
          // stepped tower with a stair that climbs its face
          for (let i = 0; i < 6; i++) addBox(16 - i * 2.4, 6, 16 - i * 2.4, 0, -20 + i * 6, 0);
          for (let i = 0; i < 18; i++) addBox(3, 0.8, 1.2, -side * 2, -22 + i * 2, 8.6 - i * 0.35, mats.farCool);
          addBox(2, 70, 2, 0, -50, 0);
        } else {
          // pendulum gantry: swings with world time
          addBox(2, 70, 2, -7, -20, 0); addBox(2, 70, 2, 7, -20, 0);
          addBox(17, 2, 2.6, 0, 15, 0);
          const pend = new THREE.Group(); pend.position.y = 14; M.add(pend);
          const rod = new THREE.Mesh(this.pillarGeo, far); rod.scale.set(0.5, 22, 0.5); rod.position.y = -11; pend.add(rod);
          const bob = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 32), mats.farCool);
          bob.userData.ownGeo = true;
          bob.rotation.x = Math.PI / 2; bob.position.y = -22; pend.add(bob);
          const ph = rnd() * TAU;
          anim.push((T) => { pend.rotation.z = Math.sin(T * 1.05 + ph) * 0.42; });
        }
        mergeRigid(M, M.children.filter((c) => c.isGroup));
        M.scale.setScalar(0.8 + rnd() * 0.5);
        M.position.y = -6 + rnd() * 6;
        group.add(M);
        this.root.add(group);
        return { s0, s1: s0 + 62, group, anim };
      },
      render(T) { for (const d of this.districts) for (const a of d.anim) a(T); }
    };
    scene.add(scenery.root);
    ctx.onDestroy(() => scenery.pillarGeo.dispose());

    // =====================================================================
    // 7. PLAYER — independent physics. Never rewound, never immune.
    // Rules at the temporal boundary:
    //  * Surfaces that rise through the player's feet catch and lift them (a bridge
    //    reassembling under a falling player is a real save, not a teleport).
    //  * Surfaces that vanish leave the player in free fall; reversing can bring them back.
    //  * Barriers that close on the player push them out along the course to the side they
    //    came from, by at most the barrier's thickness.
    //  * Rotating/moving decks carry the player; tilt past ~20 degrees and they slide off.
    //  * Riders never inherit upward velocity, so a platform stopping cannot launch them.
    //  * Falling more than KILL_DEPTH below the last ground is unrecoverable.
    // =====================================================================
    const player = {
      x: 0, y: 0, s: 0, vx: 0, vy: 0, vs: 0,
      px: 0, py: 0, ps: 0,
      groundId: null, ground: null, lastGroundY: 0, airTime: 0, maxFallSpeed: 0,
      stumble: 0, blocked: false, started: false, alive: true, intent: 0, atLedge: false,
      frontierS: 0, landedImpact: 0, wasFalling: false, deepFall: false,
      reset() {
        this.x = 0; this.y = 0; this.s = 0; this.vx = 0; this.vy = 0; this.vs = 0;
        this.px = 0; this.py = 0; this.ps = 0;
        this.groundId = null; this.ground = null; this.lastGroundY = 0; this.airTime = 0; this.maxFallSpeed = 0;
        this.stumble = 0; this.blocked = false; this.started = false; this.alive = true;
        this.frontierS = 0; this.landedImpact = 0; this.wasFalling = false; this.deepFall = false;
      }
    };

    let prevCols = new Map();
    let curCols = new Map();
    let colList = [];
    let hazList = [];

    function colContains(c, x, s, m) {
      if (c.roll != null) {
        const cr = Math.cos(c.roll);
        return Math.abs(x - c.x) <= c.hx * cr + m && Math.abs(s - c.s) <= c.hs + m;
      }
      return Math.abs(x - c.x) <= c.hx + m && Math.abs(s - c.s) <= c.hs + m;
    }
    function colTopAt(c, x) {
      return c.roll != null ? c.top + (x - c.x) * Math.tan(c.roll) : c.top;
    }
    function supportBelow(x, s, foot, list) {
      for (const c of list) {
        if (!c.sup || !colContains(c, x, s, 0.04)) continue;
        const t = colTopAt(c, x);
        if (t <= foot + STEP_UP && t >= foot - 3.2) return true;
      }
      return false;
    }

    function gatherColliders(T) {
      const tmp = prevCols; prevCols = curCols; curCols = tmp;
      curCols.clear();
      colList.length = 0;
      course.colliders(T, player.s - 6, player.s + 8, colList);
      for (const c of colList) curCols.set(c.id, c);
      hazList.length = 0;
      course.hazards(T, clock.prevT, player.s - 6, player.s + 8, hazList);
    }

    const simEvents = [];
    function emit(type, data) { simEvents.push({ type, data }); }

    function playerStep(dt, inp) {
      const p = player;
      p.px = p.x; p.py = p.y; p.ps = p.s;
      // 1. carried by the surface we stood on
      if (p.groundId) {
        const a = prevCols.get(p.groundId), b = curCols.get(p.groundId);
        if (a && b && b.carry) {
          if (b.roll != null && a.roll != null) {
            const d = wrapAngle(b.roll - a.roll);
            const rx = p.x - b.px, ry = p.y - b.py;
            const cs = Math.cos(d), sn = Math.sin(d);
            p.x = b.px + rx * cs - ry * sn;
            p.y = b.py + rx * sn + ry * cs;
          } else {
            p.x += b.x - a.x; p.s += b.s - a.s;
          }
        }
      }
      // 2. intent
      const grounded = !!p.groundId;
      if (p.stumble > 0) p.stumble -= dt;
      const ctrl = p.stumble > 0 ? 0.12 : grounded ? 1 : 0.3;
      // Continuous, camera-relative movement: the stick says where on the visible ground the
      // player wants to go; velocity eases toward that intent with a little weight.
      let mag = 0;
      if (p.alive) {
        const mx = inp.mx || 0, my = inp.my || 0;
        mag = Math.min(1, Math.hypot(mx, my));
        const spd = runSpeedAt(p.s) * mag;
        let tx = 0, ts = 0;
        if (mag > 0.001) {
          const ux = (mx * cam.right.x + my * cam.fwd.x), us = (mx * cam.right.s + my * cam.fwd.s);
          const ul = Math.hypot(ux, us) || 1;
          let dxn = ux / ul, dsn = us / ul;
          // gentle path assist: a push within ~20 degrees of along-the-course goes straight along it
          if (Math.abs(dxn) < 0.34) { dxn = 0; dsn = Math.sign(dsn) || 1; }
          tx = dxn * spd; ts = dsn * spd;
        }
        if (p.stumble > 0) { tx = p.vx; ts = p.vs; }
        const rate = !grounded ? AIR_ACCEL : (mag > 0.05 ? MOVE_ACCEL : MOVE_DECEL) * (p.stumble > 0 ? 0.5 : 1);
        // ease the velocity vector toward the target (no per-axis snapping, so turns are round)
        const dvx = tx - p.vx, dvs = ts - p.vs, dl = Math.hypot(dvx, dvs);
        const stepv = rate * dt;
        if (dl <= stepv) { p.vx = tx; p.vs = ts; } else { p.vx += (dvx / dl) * stepv; p.vs += (dvs / dl) * stepv; }
        if (grounded && p.stumble > 0) { p.vx = moveToward(p.vx, 0, 16 * dt); p.vs = moveToward(p.vs, 0, 16 * dt); }
      } else {
        p.vs = moveToward(p.vs, 0, BRAKE_DECEL * dt);
        p.vx = moveToward(p.vx, 0, 20 * dt);
      }
      p.intent = mag;
      // 3. gravity
      p.vy = Math.max(-38, p.vy - G * dt);
      p.atLedge = false;
      // 4. integrate. Ledge care: stepping sideways or backwards toward a drop stops at the edge
      // (and slides along it), so a misleading nudge never drops you. Only a committed run
      // forward, off the end of a walkway, carries you over.
      let nx = p.x + p.vx * dt, ns = p.s + p.vs * dt;
      const committed = mag >= 0.88 && p.vs > Math.abs(p.vx) * 1.2;
      if (grounded && p.stumble <= 0 && (nx !== p.x || ns !== p.s) && !committed && supportBelow(p.x, p.s, p.y, colList)) {
        const lx = nx + Math.sign(p.vx) * 0.05, ls = ns + Math.sign(p.vs) * 0.05;
        if (!supportBelow(lx, ls, p.y, colList)) {
          if (supportBelow(lx, p.s, p.y, colList)) { ns = p.s; p.vs = 0; }
          else if (supportBelow(p.x, ls, p.y, colList)) { nx = p.x; p.vx = 0; }
          else { nx = p.x; ns = p.s; p.vx = 0; p.vs = 0; }
          p.atLedge = true;
        }
      }
      // even a committed run only goes over a walkway's end, never over its side
      if (grounded && p.stumble <= 0 && committed && nx !== p.x && supportBelow(p.x, p.s, p.y, colList) && !supportBelow(nx + Math.sign(p.vx) * 0.05, p.s, p.y, colList)) {
        nx = p.x; p.vx = 0; p.atLedge = true;
      }
      // the world behind the oldest kept segment is gone: a soft wall
      const sMinWorld = course.segs.length ? course.segs[0].s0 + 1 : -1e9;
      if (ns < sMinWorld) { ns = sMinWorld; if (p.vs < 0) p.vs = 0; }
      p.x = nx;
      p.s = ns;
      p.y += p.vy * dt;
      // 5. barriers and walls
      p.blocked = false;
      for (const c of colList) {
        if (c.roll != null) continue;
        const climb = c.sup ? STEP_UP : 0.04;
        if (!(c.bottom < p.y + BODY_H && c.top > p.y + climb)) continue;
        const qx = clamp(p.x, c.x - c.hx, c.x + c.hx), qs = clamp(p.s, c.s - c.hs, c.s + c.hs);
        const dx = p.x - qx, ds = p.s - qs;
        const d2 = dx * dx + ds * ds;
        if (d2 >= BODY_R * BODY_R) continue;
        if (c.gate || !c.sup) {
          // thin barrier: resolve along the course toward its safe side if it has one
          // (rails push riders onto the deck, latches push walkers back off the void),
          // otherwise toward the side we came from
          const from = c.pushDir || (p.ps <= c.s ? -1 : 1);
          p.s = c.s + from * (c.hs + BODY_R + 0.001);
          if (from < 0) { p.vs = Math.min(p.vs, 0); p.blocked = true; }
          continue;
        }
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = BODY_R - d;
          p.x += (dx / d) * push; p.s += (ds / d) * push;
          if (Math.abs(ds) > Math.abs(dx)) { if (ds < 0) { p.vs = Math.min(p.vs, 0); p.blocked = true; } } else p.vx = 0;
        } else {
          // centre inside the block: leave by the shallowest face
          const ex = c.hx - Math.abs(p.x - c.x) + BODY_R, es = c.hs - Math.abs(p.s - c.s) + BODY_R;
          if (ex < es) { p.x += Math.sign(p.x - c.x || 1) * ex; p.vx = 0; }
          else { const sg = Math.sign(p.ps - c.s || -1); p.s = c.s + sg * (c.hs + BODY_R); if (sg < 0) { p.vs = Math.min(p.vs, 0); p.blocked = true; } }
        }
      }
      // 6. support: the highest surface our feet reached this step, or that rose through them
      let best = null, bestTop = -Infinity, bestPrevTop = 0;
      for (const c of colList) {
        if (!c.sup || !colContains(c, p.x, p.s, 0.06)) continue;
        const top = colTopAt(c, p.x);
        const pc = prevCols.get(c.id);
        const prevTop = pc ? colTopAt(pc, p.px) : top;
        if (top >= p.y - 1e-4 && prevTop <= p.py + STEP_UP + 1e-3 && top > bestTop) { best = c; bestTop = top; bestPrevTop = prevTop; }
      }
      const wasAir = !p.groundId;
      if (best) {
        const impact = -p.vy;
        p.y = bestTop;
        const platVy = (bestTop - bestPrevTop) / dt;
        p.vy = Math.min(0, platVy);
        if (wasAir && p.airTime > 0.1) {
          const fellFar = p.lastGroundY - bestTop > 1.5 || p.deepFall;
          emit("land", { impact, caught: p.deepFall && clock.dir < 0, el: best.id, fellFar });
        }
        p.groundId = best.id; p.ground = best;
        p.lastGroundY = bestTop; p.airTime = 0; p.maxFallSpeed = 0; p.deepFall = false;
        if (p.started) p.frontierS = Math.max(p.frontierS, p.s);
      } else {
        p.groundId = null; p.ground = null;
        p.airTime += dt;
        p.maxFallSpeed = Math.max(p.maxFallSpeed, -p.vy);
        if (p.y < p.lastGroundY - 2.2 && !p.deepFall) { p.deepFall = true; emit("deepfall", {}); }
      }
      // 7. gnomon blades
      for (const h of hazList) {
        if (p.y > h.y1 || p.y + BODY_H < h.y0) continue;
        const ax = Math.cos(h.ang), as = Math.sin(h.ang);
        const t = clamp((p.x - h.px) * ax + (p.s - h.ps) * as, 0, h.len);
        const cx = h.px + ax * t, cs = h.ps + as * t;
        let dx = p.x - cx, ds = p.s - cs;
        let d = Math.hypot(dx, ds);
        const minD = BODY_R + h.half;
        if (d >= minD) continue;
        if (d < 1e-5) { dx = -as; ds = ax; d = 1; }
        const nxv = dx / d, nsv = ds / d;
        p.x = cx + nxv * (minD + 0.002); p.s = cs + nsv * (minD + 0.002);
        const w = h.dAng / dt;
        const bvx = -as * w * t, bvs = ax * w * t;
        const closing = bvx * nxv + bvs * nsv;
        if (closing > 0.6) {
          p.vx = clamp(bvx * 0.55 + nxv * 1.4, -4.5, 4.5);
          p.vs = clamp(bvs * 0.55 + nsv * 1.4 + p.vs * 0.3, -3.5, 8);
          p.vy = 1.7;
          p.stumble = 0.45;
          p.groundId = null; p.ground = null;
          emit("knock", { speed: Math.hypot(bvx, bvs) });
        } else {
          if (nsv < -0.3) { p.vs = Math.min(p.vs, 0); p.blocked = true; }
        }
      }
      // 8. unrecoverable fall
      if (p.alive && p.y < p.lastGroundY - KILL_DEPTH) { p.alive = false; emit("death", { cause: "fall" }); }
    }
    function moveToward(v, t, step) { return v < t ? Math.min(t, v + step) : Math.max(t, v - step); }

    // =====================================================================
    // 8. CHARACTER RIG — a small cloaked surveyor with a time-charm on the chest.
    // =====================================================================
    const rig = (() => {
      const root = new THREE.Group();
      const body = new THREE.Group();
      root.add(body);
      const cyl = (rt, rb, h, seg) => cachedGeo("cyl" + rt + "_" + rb + "_" + h, () => new THREE.CylinderGeometry(rt, rb, h, seg || 10));
      function limb(len, r, m) {
        const j = new THREE.Group();
        const mesh = new THREE.Mesh(cyl(r, r * 0.85, len), m);
        mesh.position.y = -len / 2;
        mesh.castShadow = true;
        j.add(mesh);
        return j;
      }
      const hips = new THREE.Group(); hips.position.y = 0.6; body.add(hips);
      const legs = [];
      for (const sx of [-1, 1]) {
        const thigh = limb(0.31, 0.058, mats.legs); thigh.position.x = sx * 0.085; hips.add(thigh);
        const shin = limb(0.29, 0.05, mats.legs); shin.position.y = -0.31; thigh.add(shin);
        const foot = new THREE.Mesh(cachedGeo("foot", () => new THREE.BoxGeometry(0.1, 0.06, 0.2)), mats.cloakDark);
        foot.position.set(0, -0.3, -0.04); foot.castShadow = true; shin.add(foot);
        legs.push({ thigh, shin });
      }
      const torso = new THREE.Group(); torso.position.y = 0.6; body.add(torso);
      const cloak = new THREE.Mesh(cyl(0.12, 0.3, 0.62, 14), mats.cloak);
      cloak.position.y = 0.27; cloak.castShadow = true; torso.add(cloak);
      const hem = new THREE.Mesh(cyl(0.305, 0.31, 0.05, 14), mats.cloakDark);
      hem.position.y = -0.03; torso.add(hem);
      const head = new THREE.Group(); head.position.y = 0.68; torso.add(head);
      const face = new THREE.Mesh(cachedGeo("face", () => new THREE.SphereGeometry(0.13, 16, 12)), mats.mask);
      face.castShadow = true; head.add(face);
      const hood = new THREE.Mesh(cachedGeo("hood", () => new THREE.SphereGeometry(0.16, 16, 12, Math.PI * 0.15, Math.PI * 1.7)), mats.cloak);
      hood.rotation.y = Math.PI * 0.5 + Math.PI;
      hood.castShadow = true;
      head.add(hood);
      const tip = new THREE.Mesh(cachedGeo("hoodtip", () => new THREE.ConeGeometry(0.07, 0.2, 8)), mats.cloak);
      tip.position.set(0, 0.06, 0.14); tip.rotation.x = 1.9; head.add(tip);
      const eye = new THREE.Mesh(cachedGeo("eye", () => new THREE.BoxGeometry(0.12, 0.018, 0.01)), mats.legs);
      eye.position.set(0, 0.015, -0.128); head.add(eye);
      const arms = [];
      for (const sx of [-1, 1]) {
        const arm = limb(0.36, 0.04, mats.cloak);
        arm.position.set(sx * 0.15, 0.5, 0);
        torso.add(arm);
        const hand = new THREE.Mesh(cachedGeo("hand", () => new THREE.SphereGeometry(0.045, 8, 6)), mats.mask);
        hand.position.y = -0.37; arm.children[0].parent.add(hand);
        arms.push(arm);
      }
      const charm = new THREE.Mesh(cachedGeo("charm", () => new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16)), mats.charm);
      charm.rotation.x = Math.PI / 2; charm.position.set(0, 0.38, -0.17); torso.add(charm);
      const charmGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffc070, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      charmGlow.scale.set(0.45, 0.45, 1); charmGlow.position.copy(charm.position); torso.add(charmGlow);
      const cape = new THREE.Group(); cape.position.set(0, 0.55, 0.1); torso.add(cape);
      const capeMesh = new THREE.Mesh(cachedGeo("cape", () => new THREE.BoxGeometry(0.34, 0.5, 0.025)), mats.cloakDark);
      capeMesh.position.y = -0.25; capeMesh.castShadow = true; cape.add(capeMesh);
      // contact shadow so the player always reads against the ground
      const blob = new THREE.Mesh(cachedGeo("blob", () => new THREE.CircleGeometry(0.42, 24)), new THREE.MeshBasicMaterial({ map: tex.glow, color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      root.add(blob);

      const st = { phase: 0, squash: 0, lean: 0, roll: 0, yaw: 0, air: 0, prevSin: 0, push: 0, fallPose: 0, idle: 0 };
      return {
        root, blob, charm, charmGlow,
        update(dtReal, p, accel, onStep) {
          const speed = Math.hypot(p.vs, p.vx);
          const grounded = !!p.groundId;
          const r = clamp(speed / RUN_BASE, 0, 1.25);
          if (grounded) st.phase += (speed * dtReal) / 1.25;
          const ph = st.phase * TAU;
          const sn = Math.sin(ph);
          if (grounded && speed > 0.6 && Math.sign(sn) !== Math.sign(st.prevSin)) onStep(r);
          st.prevSin = sn;
          st.air = damp(st.air, grounded ? 0 : 1, 12, dtReal);
          st.fallPose = damp(st.fallPose, !grounded && p.vy < -5 ? 1 : 0, 6, dtReal);
          st.squash = damp(st.squash, 0, 9, dtReal);
          st.push = damp(st.push, p.blocked && grounded ? 1 : 0, 10, dtReal);
          st.lean = damp(st.lean, clamp(0.1 * r + accel * 0.025, -0.3, 0.35) + st.push * 0.35, 8, dtReal);
          // face the direction of travel; turn the short way round, and lean into the turn
          let turn = 0;
          if (speed > 0.35) {
            turn = wrapAngle(Math.atan2(-p.vx, p.vs) - st.yaw);
            st.yaw = wrapAngle(st.yaw + turn * (1 - Math.exp(-11 * dtReal)));
          }
          st.roll = damp(st.roll, clamp(turn * speed * 0.09, -0.32, 0.32), 9, dtReal);
          st.idle += dtReal;
          const runAmt = grounded ? r : 0;
          for (let i = 0; i < 2; i++) {
            const sgn = i === 0 ? 1 : -1;
            const swing = Math.sin(ph + (i ? Math.PI : 0));
            const pushStride = st.push * Math.sin(st.idle * 6 + i * Math.PI) * 0.35;
            const t = swing * 0.85 * runAmt + pushStride;
            const knee = (0.15 + 0.95 * Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 1.3))) * runAmt + st.push * 0.4;
            legs[i].thigh.rotation.x = lerp(t, -0.7 - 0.25 * sgn, st.air);
            legs[i].shin.rotation.x = lerp(knee, 1.15, st.air * (1 - st.fallPose * 0.6));
            arms[i].rotation.x = lerp(-swing * 0.75 * runAmt - st.push * 1.1, -0.4, st.air);
            arms[i].rotation.z = sgn * lerp(-0.12 - 0.05 * runAmt, -2.3, st.fallPose) * -1;
          }
          const bob = grounded ? Math.abs(Math.sin(ph)) * 0.05 * r + Math.sin(st.idle * 2.2) * 0.008 * (1 - r) : 0;
          body.position.y = bob - st.squash * 0.12;
          body.scale.set(1 + st.squash * 0.12, 1 - st.squash * 0.18, 1 + st.squash * 0.12);
          body.rotation.set(-st.lean + st.fallPose * 0.3, st.yaw, st.roll + (p.stumble > 0 ? Math.sin(st.idle * 30) * 0.15 : 0));
          cape.rotation.x = 0.15 + clamp(speed * 0.09, 0, 0.9) + Math.sin(st.idle * 9) * 0.06 * r + st.air * 0.5 + st.fallPose * 0.6;
          head.rotation.x = st.lean * 0.4 - st.fallPose * 0.4;
        },
        land(impact) { st.squash = clamp(impact / 14, 0.15, 1); }
      };
    })();
    scene.add(rig.root);

    // =====================================================================
    // 9. CAMERA AND ATMOSPHERE
    // =====================================================================
    // fwd/right: the camera's ground-plane axes in course space (x, s). Movement input is
    // mapped through these, so "up" on the stick is "into the picture".
    const cam = { fx: 0, fy: 0, fs: 0, shake: 0, init: false, fwd: { x: 0, s: 1 }, right: { x: 1, s: 0 } };
    const camV0 = new THREE.Vector3(), camV1 = new THREE.Vector3(), camV2 = new THREE.Vector3();
    function cameraUpdate(dtReal, rx, ry, rs) {
      const aspect = ctx.width / ctx.height;
      const portrait = clamp((1.15 - aspect) / 0.65, 0, 1); // 0 landscape .. 1 tall phone
      const k = lerp(1.0, 1.42, portrait);
      camera.fov = lerp(44, 56, portrait);
      const groundRef = player.groundId ? ry : Math.max(ry, player.lastGroundY - 3.5);
      if (!cam.init) { cam.fx = rx * 0.5; cam.fy = groundRef; cam.fs = rs; cam.init = true; }
      cam.fx = damp(cam.fx, rx * 0.5, 3.2, dtReal);
      cam.fy = damp(cam.fy, groundRef, player.groundId ? 4 : 1.6, dtReal);
      cam.fs = damp(cam.fs, rs, 14, dtReal);
      cam.shake = damp(cam.shake, 0, 7, dtReal);
      const sh = settings.reducedMotion ? 0 : cam.shake;
      const lookAhead = 6.8 + portrait * 1.5;
      camera.position.set(cam.fx + 3.3 * k, cam.fy + 10.6 * k + Math.sin(performance.now() * 0.05) * sh * 0.05, -cam.fs + 11.2 * k);
      camera.lookAt(cam.fx * 0.9, cam.fy + 0.4, -(cam.fs + lookAhead));
      camera.updateProjectionMatrix();
      // Ground axes that look like "up" and "right" on screen at the player's position: project a
      // step along the course and a step across it, then invert that 2x2 map.
      camera.updateMatrixWorld();
      const P0 = camV0.set(rx, ry, -rs).project(camera);
      const Pf = camV1.set(rx, ry, -(rs + 1)).project(camera);
      const Pr = camV2.set(rx + 1, ry, -rs).project(camera);
      const Fx = Pf.x - P0.x, Fy = Pf.y - P0.y, Rx = Pr.x - P0.x, Ry = Pr.y - P0.y; // NDC: y up
      const det = Fx * Ry - Rx * Fy;
      if (Math.abs(det) > 1e-9) {
        // a·F + b·R = target, with a along +s (into the course) and b along +x
        const ua = -Rx / det, ub = Fx / det;      // target (0, 1): screen up
        const ra = Ry / det, rb = -Fy / det;      // target (1, 0): screen right
        const ul = Math.hypot(ua, ub) || 1, rl = Math.hypot(ra, rb) || 1;
        cam.fwd.s = ua / ul; cam.fwd.x = ub / ul;
        cam.right.s = ra / rl; cam.right.x = rb / rl;
      }
    }

    const palettes = {
      pause: { top: new THREE.Color(0x93aab3), hor: new THREE.Color(0xdcd6ca), bot: new THREE.Color(0x5f747d), sun: new THREE.Color(0xfff0dc), sunI: 2.3, hemiS: new THREE.Color(0xd9dcd6), hemiG: new THREE.Color(0x56676e), mote: new THREE.Color(0xf4ecdc) },
      fwd: { top: new THREE.Color(0x8fb0bd), hor: new THREE.Color(0xe8cfac), bot: new THREE.Color(0x5d7480), sun: new THREE.Color(0xffdcae), sunI: 2.7, hemiS: new THREE.Color(0xe3ddd0), hemiG: new THREE.Color(0x5c6869), mote: new THREE.Color(0xffd29a) },
      rev: { top: new THREE.Color(0x76aebb), hor: new THREE.Color(0xc6dfde), bot: new THREE.Color(0x48707e), sun: new THREE.Color(0xe3f1ff), sunI: 2.2, hemiS: new THREE.Color(0xcfe2e4), hemiG: new THREE.Color(0x4a6872), mote: new THREE.Color(0xa6eef4) }
    };
    const skyUniforms = {
      cTop: { value: palettes.fwd.top.clone() }, cHor: { value: palettes.fwd.hor.clone() }, cBot: { value: palettes.fwd.bot.clone() },
      sunDir: { value: new THREE.Vector3(-0.42, 0.55, -0.72).normalize() }, sunCol: { value: new THREE.Color(0xfff2da) }
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
      fragmentShader:
        "uniform vec3 cTop; uniform vec3 cHor; uniform vec3 cBot; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;" +
        "void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(cHor, cTop, pow(smoothstep(0.0, 0.75, y), 0.8)) : mix(cHor, cBot, smoothstep(0.0, 0.5, -y));" +
        " float sd = max(dot(normalize(vDir), sunDir), 0.0); c += sunCol * (pow(sd, 220.0) * 0.9 + pow(sd, 10.0) * 0.16 + pow(sd, 3.0) * 0.05);" +
        " gl_FragColor = vec4(c, 1.0); }",
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    ctx.onDestroy(() => { sky.geometry.dispose(); skyMat.dispose(); });

    // environment reflections from the sky itself
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat);
      envScene.add(envSky);
      const rt = pm.fromScene(envScene, 0.02);
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.35;
      envSky.geometry.dispose();
      pm.dispose();
      ctx.onDestroy(() => rt.dispose());
    } catch (e) {}

    scene.fog = new THREE.Fog(palettes.fwd.hor.clone(), 30, 150);
    const hemi = new THREE.HemisphereLight(0xf2ece2, 0x6f8288, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.castShadow = true;
    const shadowSize = isSmallScreen ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -17; sun.shadow.camera.right = 17; sun.shadow.camera.top = 17; sun.shadow.camera.bottom = -17;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
    scene.add(sun); scene.add(sun.target);

    // motes: dust in the air, moving in WORLD time — they hang still when time stops,
    // and stream backward when it reverses.
    const MOTES = isSmallScreen ? 420 : 700;
    const moteUniforms = { uT: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(44, 18, 64) }, uColor: { value: new THREE.Color(0xffe0b0) }, uScale: { value: 70 } };
    const moteMat = new THREE.ShaderMaterial({
      uniforms: moteUniforms,
      vertexShader:
        "attribute vec3 aVel; attribute float aSize; uniform float uT; uniform vec3 uCenter; uniform vec3 uBox; uniform float uScale; varying float vA;" +
        "void main(){ vec3 p = position + aVel * uT + vec3(sin(uT * 0.7 + position.x) * 0.4, 0.0, cos(uT * 0.5 + position.z) * 0.4);" +
        " p = uCenter + mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;" +
        " vec3 q = abs(p - uCenter) / (uBox * 0.5); vA = (1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z))));" +
        " vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; }",
      fragmentShader:
        "uniform vec3 uColor; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if (d > 0.25) discard; gl_FragColor = vec4(uColor, vA * 0.55 * (1.0 - d * 4.0)); }",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const motes = (() => {
      const r = mulberry32(42), pos = [], vel = [], size = [];
      for (let i = 0; i < MOTES; i++) {
        pos.push((r() - 0.5) * 44, (r() - 0.5) * 18, (r() - 0.5) * 64);
        vel.push((r() - 0.5) * 0.6, 0.15 + r() * 0.35, (r() - 0.5) * 0.6 + 0.3);
        size.push(0.6 + r() * 1.4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aVel", new THREE.Float32BufferAttribute(vel, 3));
      g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
      const pts = new THREE.Points(g, moteMat);
      pts.frustumCulled = false;
      ctx.onDestroy(() => { g.dispose(); moteMat.dispose(); });
      return pts;
    })();
    scene.add(motes);

    // The beacon: a far column of light standing over the way ahead. It tells you where the
    // journey goes, never how to get there.
    const beacon = new THREE.Group();
    const beamMat = new THREE.SpriteMaterial({ map: tex.glow, color: 0xffe2b0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beam = new THREE.Sprite(beamMat); beam.scale.set(5, 120, 1); beam.position.y = 20;
    const crown = new THREE.Sprite(beamMat.clone()); crown.scale.set(26, 26, 1); crown.position.y = 34; crown.material.opacity = 0.5;
    beacon.add(beam, crown);
    scene.add(beacon);
    ctx.onDestroy(() => { beamMat.dispose(); crown.material.dispose(); });

    // mist banks in the abyss
    function makeMistTexture() {
      const S = 256, c = makeCanvas(S, S), g = c.getContext("2d");
      const r = mulberry32(5);
      g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, S, S);
      for (let i = 0; i < 70; i++) {
        const x = r() * S, y = r() * S, rad = 18 + r() * 60;
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          grd.addColorStop(0, "rgba(255,255,255," + (0.08 + r() * 0.1) + ")");
          grd.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = grd; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
      return canvasTexture(c, true);
    }
    tex.mist = makeMistTexture();
    const mists = [];
    for (const [y, scale, op] of [[-10, 3, 0.55], [-23, 5, 0.7]]) {
      const t = tex.mist.clone();
      t.needsUpdate = true;
      t.repeat.set(scale, scale);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshBasicMaterial({ map: t, color: 0xe6ecea, transparent: true, opacity: op * 0.8, depthWrite: false, fog: true }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = 2;
      scene.add(m);
      mists.push({ m, t, scale, y });
      ctx.onDestroy(() => { m.geometry.dispose(); m.material.dispose(); t.dispose(); });
    }

    const atmo = { dirS: 1, color: new THREE.Color(), tint: new THREE.Color(0xffffff), tintNow: new THREE.Color(0xffffff) };
    function atmosphereUpdate(dtReal, T, fx, fs) {
      atmo.dirS = damp(atmo.dirS, clock.dir, 3.5, dtReal);
      const d = atmo.dirS;
      const a = d >= 0 ? palettes.pause : palettes.pause, b = d >= 0 ? palettes.fwd : palettes.rev, t = Math.abs(d);
      skyUniforms.cTop.value.copy(a.top).lerp(b.top, t);
      skyUniforms.cHor.value.copy(a.hor).lerp(b.hor, t);
      skyUniforms.cBot.value.copy(a.bot).lerp(b.bot, t);
      skyUniforms.sunCol.value.copy(a.sun).lerp(b.sun, t);
      // region tint: each region of the journey lights the world a little differently
      atmo.tintNow.lerp(atmo.tint, 1 - Math.exp(-0.6 * dtReal));
      skyUniforms.cHor.value.multiply(atmo.tintNow);
      skyUniforms.cTop.value.multiply(atmo.tintNow);
      scene.fog.color.copy(skyUniforms.cHor.value);
      hemi.color.copy(a.hemiS).lerp(b.hemiS, t);
      hemi.groundColor.copy(a.hemiG).lerp(b.hemiG, t);
      sun.color.copy(a.sun).lerp(b.sun, t);
      sun.intensity = lerp(a.sunI, b.sunI, t);
      moteUniforms.uColor.value.copy(a.mote).lerp(b.mote, t);
      occl.uRwAbyss.value.copy(skyUniforms.cBot.value);
      moteUniforms.uT.value = T;
      moteUniforms.uCenter.value.set(fx, cam.fy + 2, -fs - 10);
      moteUniforms.uScale.value = 70 * renderer.getPixelRatio() * (ctx.height / 800);
      dustMaterial.uniforms.uScale.value = 320 * renderer.getPixelRatio() * (ctx.height / 800);
      for (const mi of mists) {
        mi.m.position.x = fx; mi.m.position.z = -fs - 40;
        mi.t.offset.set(fx / 320 * mi.scale + T * 0.004, (fs + 40) / 320 * mi.scale + T * 0.002);
      }
      beacon.position.set(0, cam.fy, -(fs + 135));
      beam.material.color.copy(d < 0 ? palettes.rev.mote : palettes.fwd.mote);
      sun.position.set(fx - 12, cam.fy + 17, -fs - 11);
      sun.target.position.set(fx, cam.fy, -fs - 5);
    }

    // =====================================================================
    // 10. AUDIO — procedural, restrained. Ticks are driven by WORLD time: they tick when
    // time advances, tock backward when it reverses, and fall silent when it stops.
    // =====================================================================
    const audio = (() => {
      let ac = null, master = null, padGain = null, padFilter = null, revGain = null, revFilter = null, windGain = null, noiseBuf = null;
      let ok = false;
      const pentatonic = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      function init() {
        if (ac || !ctx.capabilities || !ctx.capabilities.audio) return;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = settings.muted ? 0 : 0.8;
          const comp = ac.createDynamicsCompressor();
          comp.threshold.value = -18; comp.ratio.value = 3;
          master.connect(comp); comp.connect(ac.destination);
          noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const nd = noiseBuf.getChannelData(0);
          for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
          // ambient pad: an open D chord, slowly breathing
          padFilter = ac.createBiquadFilter(); padFilter.type = "lowpass"; padFilter.frequency.value = 900; padFilter.Q.value = 0.5;
          padGain = ac.createGain(); padGain.gain.value = 0;
          padFilter.connect(padGain); padGain.connect(master);
          const freqs = [73.42, 110, 146.83, 220, 277.18, 329.63];
          freqs.forEach((f, i) => {
            const o = ac.createOscillator();
            o.type = i % 2 ? "sine" : "triangle";
            o.frequency.value = f;
            o.detune.value = (i - 2.5) * 3;
            const g = ac.createGain(); g.gain.value = 0.06 / (1 + i * 0.5);
            const lfo = ac.createOscillator(); lfo.frequency.value = 0.05 + i * 0.013;
            const lg = ac.createGain(); lg.gain.value = 0.025 / (1 + i * 0.5);
            lfo.connect(lg); lg.connect(g.gain);
            o.connect(g); g.connect(padFilter);
            o.start(); lfo.start();
          });
          // reverse texture: band-passed noise that swells while history rewinds
          const rn = ac.createBufferSource(); rn.buffer = noiseBuf; rn.loop = true;
          revFilter = ac.createBiquadFilter(); revFilter.type = "bandpass"; revFilter.frequency.value = 1400; revFilter.Q.value = 2.5;
          revGain = ac.createGain(); revGain.gain.value = 0;
          rn.connect(revFilter); revFilter.connect(revGain); revGain.connect(master);
          rn.start();
          // wind of a fall
          const wn = ac.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
          const wf = ac.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 700;
          windGain = ac.createGain(); windGain.gain.value = 0;
          wn.connect(wf); wf.connect(windGain); windGain.connect(master);
          wn.start();
          ok = true;
        } catch (e) { ok = false; }
      }
      function resume() { if (ac && ac.state === "suspended") ac.resume().catch(() => {}); }
      function env(g, t0, a, peak, decay) {
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + decay);
      }
      function tone(freq, type, peak, a, decay, dest, when) {
        if (!ok) return;
        const t0 = (when || ac.currentTime);
        const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
        const g = ac.createGain();
        env(g, t0, a, peak, decay);
        o.connect(g); g.connect(dest || master);
        o.start(t0); o.stop(t0 + a + decay + 0.05);
        return o;
      }
      function noise(peak, a, decay, ftype, freq, q) {
        if (!ok) return;
        const t0 = ac.currentTime;
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ac.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; f.Q.value = q || 1;
        const g = ac.createGain();
        env(g, t0, a, peak, decay);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t0, Math.random() * 1.5); src.stop(t0 + a + decay + 0.05);
      }
      return {
        init, resume,
        setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
        update(dir, rate, playing, falling) {
          if (!ok) return;
          const t = ac.currentTime;
          padGain.gain.setTargetAtTime(playing ? (dir === 0 ? 0.35 : 0.6) : 0.25, t, 0.4);
          padFilter.frequency.setTargetAtTime(dir < 0 ? 520 : dir > 0 ? 1100 : 650, t, 0.25);
          revGain.gain.setTargetAtTime(dir < 0 && playing ? 0.05 : 0, t, 0.08);
          revFilter.frequency.setTargetAtTime(900 + Math.random() * 900, t, 0.2);
          windGain.gain.setTargetAtTime(falling ? clamp(falling / 30, 0, 0.18) : 0, t, 0.1);
        },
        tick(fwd) {
          if (!ok) return;
          if (fwd) { tone(2350, "sine", 0.05, 0.002, 0.05); noise(0.03, 0.001, 0.02, "highpass", 4000); }
          else {
            // a "tock" with a reversed envelope: swells in, cuts off
            const t0 = ac.currentTime;
            const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = 1480;
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.06); g.gain.setValueAtTime(0.0001, t0 + 0.062);
            o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.08);
          }
        },
        floor() { tone(180, "sine", 0.08, 0.005, 0.18); },
        step(r) { noise(0.05 + r * 0.03, 0.002, 0.05, "lowpass", 900 + Math.random() * 400); },
        land(impact) { noise(clamp(impact / 40, 0.05, 0.25), 0.003, 0.14, "lowpass", 500); tone(70, "sine", clamp(impact / 60, 0.04, 0.2), 0.004, 0.2); },
        shard(chain) {
          const n = pentatonic[Math.min(chain, pentatonic.length - 1)];
          const f = 880 * Math.pow(2, n / 12);
          tone(f, "sine", 0.12, 0.003, 0.5); tone(f * 2.76, "sine", 0.035, 0.003, 0.25); tone(f * 1.5, "triangle", 0.03, 0.01, 0.4);
        },
        bonus() {
          if (!ok) return;
          const t0 = ac.currentTime;
          [0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), "triangle", 0.06, 0.005, 0.35, master, t0 + i * 0.06));
        },
        crumble(near) { noise(0.12 * near, 0.01, 0.6, "lowpass", 260, 0.7); tone(48, "sine", 0.12 * near, 0.02, 0.5); },
        settle(near) { noise(0.12 * near, 0.002, 0.08, "bandpass", 1200, 1.4); tone(160, "sine", 0.07 * near, 0.002, 0.12); },
        slide(near) { noise(0.06 * near, 0.05, 0.35, "bandpass", 500, 0.8); },
        clunk(near) { tone(110, "square", 0.04 * near, 0.003, 0.12); noise(0.05 * near, 0.002, 0.08, "lowpass", 700); },
        gate(near) { noise(0.07 * near, 0.08, 0.5, "lowpass", 340, 1); },
        knock() { noise(0.2, 0.002, 0.2, "lowpass", 1200); tone(240, "triangle", 0.12, 0.002, 0.2); },
        death() {
          if (!ok) return;
          const t0 = ac.currentTime;
          const o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(330, t0); o.frequency.exponentialRampToValueAtTime(82, t0 + 1.1);
          const g = ac.createGain(); env(g, t0, 0.02, 0.12, 1.1); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.2);
        },
        best() {
          if (!ok) return;
          const t0 = ac.currentTime;
          [0, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), "triangle", 0.07, 0.005, 0.6, master, t0 + 0.2 + i * 0.09));
        },
        dispose() { try { if (ac) ac.close(); } catch (e) {} }
      };
    })();
    ctx.onDestroy(() => audio.dispose());

    function haptic(kind) {
      try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) {}
    }

    // =====================================================================
    // 11. INPUT — temporal and spatial controls are fully independent.
    // Keyboard: W/Up advance time, S/Down reverse, A/D or Left/Right steer, Space/Shift brake,
    // Esc/P pause, M mute. Touch: left side steers (drag) and brakes (pull down); right side
    // holds the time controls. Each finger owns one role; lifting one never releases another.
    // =====================================================================
    // Movement and time are separate inputs. Movement: an analog vector (mx right, my into
    // the picture), from WASD/arrows or a floating left-thumb stick. Time: REWIND and
    // FAST-FORWARD holds (Space / Shift, or the right-thumb buttons). Releasing both = normal flow.
    const STICK_R = 56;
    const input = {
      keys: new Set(),
      touches: new Map(),  // pointerId -> { role: "move"|"time", ox, oy, x, y, zone }
      mx: 0, my: 0, rew: false, ff: false, steer: 0,
      virtual: null,       // test hook: { mx, my, rew, ff }
      usedTouch: coarsePointer,
      clearAll() { this.keys.clear(); this.touches.clear(); this.mx = 0; this.my = 0; this.rew = false; this.ff = false; this.steer = 0; },
      compute() {
        let mx = 0, my = 0, rew = false, ff = false;
        const k = this.keys;
        if (k.has("ArrowLeft") || k.has("KeyA")) mx -= 1;
        if (k.has("ArrowRight") || k.has("KeyD")) mx += 1;
        if (k.has("ArrowUp") || k.has("KeyW")) my += 1;
        if (k.has("ArrowDown") || k.has("KeyS")) my -= 1;
        const kl = Math.hypot(mx, my);
        if (kl > 1) { mx /= kl; my /= kl; } // diagonals are not faster
        if (k.has("Space") || k.has("KeyK")) rew = true;
        if (k.has("ShiftLeft") || k.has("ShiftRight") || k.has("KeyL")) ff = true;
        for (const t of this.touches.values()) {
          if (t.role === "move") {
            let dx = (t.x - t.ox) / STICK_R, dy = -(t.y - t.oy) / STICK_R;
            let m = Math.hypot(dx, dy);
            if (m > 0.12) {
              const curved = Math.pow(Math.min(1, (m - 0.12) / 0.88), 1.2);
              mx = (dx / m) * curved; my = (dy / m) * curved;
            }
          } else if (t.role === "time") {
            if (t.zone === "rev") rew = true; else ff = true;
          }
        }
        const v = this.virtual;
        if (v) { mx = v.mx || 0; my = v.my || 0; rew = !!v.rew; ff = !!v.ff; }
        this.mx = mx; this.my = my; this.rew = rew; this.ff = ff && !rew; this.steer = mx;
      }
    };
    const GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS", "Space", "ShiftLeft", "ShiftRight", "KeyK", "KeyL"]);
    function isTypingTarget(e) {
      const t = e.target;
      return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    }

    // =====================================================================
    // 12. HUD
    // =====================================================================
    const FONT_TITLE = "'Cormorant Garamond', 'Iowan Old Style', Georgia, serif";
    const FONT_UI = "Inter, 'Helvetica Neue', Arial, sans-serif";
    hudRoot.innerHTML =
      "<style>" +
      ".rw{position:absolute;inset:0;color:#2f3d42;font-family:" + FONT_UI + ";-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}" +
      ".rw-top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px 0 16px;pointer-events:none}" +
      ".rw-score{font-family:" + FONT_TITLE + ";font-weight:300;font-size:34px;line-height:1;color:#25343a;text-shadow:0 1px 0 rgba(255,250,240,.6);font-variant-numeric:tabular-nums}" +
      ".rw-sub{margin-top:4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#4d5f64;display:flex;gap:10px;align-items:center}" +
      ".rw-mult{color:#9a6a2c;font-weight:600;letter-spacing:.06em}" +
      ".rw-pips{display:inline-flex;gap:3px}.rw-pips i{display:block;width:5px;height:5px;border-radius:50%;background:rgba(60,80,86,.2)}.rw-pips i.on{background:#c48c3c}" +
      ".rw-btns{display:flex;gap:8px;pointer-events:auto}" +
      ".rw-btn{width:36px;height:36px;border-radius:50%;border:1px solid rgba(47,61,66,.25);background:rgba(250,246,238,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "display:flex;align-items:center;justify-content:center;color:#2f3d42;font-size:13px;cursor:pointer;padding:0}" +
      ".rw-btn svg{width:14px;height:14px}" +
      ".rw-hint{position:absolute;left:50%;top:70px;transform:translate(-50%,0);padding:9px 16px;border-radius:999px;background:rgba(250,246,238,.78);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-size:14px;letter-spacing:.02em;color:#2b393e;white-space:nowrap;opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;box-shadow:0 4px 18px rgba(40,50,55,.12)}" +
      ".rw-hint.show{opacity:1;transform:translate(-50%,4px)}" +
      ".rw-hint b{font-weight:600;color:#1f6f73}" +
      ".rw-toasts{position:absolute;left:0;right:0;top:118px;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none}" +
      ".rw-toast{font-family:" + FONT_TITLE + ";font-size:21px;font-style:italic;color:#7a5220;text-shadow:0 1px 0 rgba(255,250,240,.8);animation:rwt 1.6s ease-out forwards}" +
      ".rw-toast span{font-family:" + FONT_UI + ";font-style:normal;font-size:12px;letter-spacing:.1em;margin-left:6px;color:#9a6a2c}" +
      "@keyframes rwt{0%{opacity:0;transform:translateY(6px)}12%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}" +
      ".rw-touch{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s}.rw-touch.on{opacity:1}" +
      ".rw-tb{position:absolute;border-radius:50%;background:rgba(250,246,238,.42);border:1.5px solid rgba(47,61,66,.22);display:flex;align-items:center;justify-content:center;" +
      "backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);transition:background .12s,transform .12s,border-color .12s}" +
      ".rw-tb svg{width:42%;height:42%}.rw-tb.down{background:rgba(255,242,214,.85);border-color:rgba(190,130,50,.7);transform:scale(.94)}" +
      ".rw-tb.rev.down{background:rgba(220,246,247,.9);border-color:rgba(60,150,160,.75)}" +
      ".rw-tb small{position:absolute;bottom:-18px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(40,55,60,.65)}" +
      ".rw-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:1.5px solid rgba(47,61,66,.28);background:radial-gradient(circle,rgba(250,246,238,.08),rgba(250,246,238,.3));display:none}" +
      ".rw-stick i{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px;border-radius:50%;background:rgba(250,246,238,.9);border:1.5px solid rgba(190,110,70,.55);box-shadow:0 2px 8px rgba(0,0,0,.12)}" +
      ".rw-rest{position:absolute;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;border:1.5px dashed rgba(47,61,66,.22);display:flex;align-items:center;justify-content:center;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(40,55,60,.5)}" +
      ".rw-padhint{position:absolute;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(40,55,60,.55);text-align:center}" +
      ".rw-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none;opacity:0;transition:opacity .5s}" +
      ".rw-screen.show{opacity:1}" +
      ".rw-screen.show.click{pointer-events:auto}" +
      ".rw-veil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(248,243,233,.62),rgba(236,229,216,.86) 75%)}" +
      "#rw-title .rw-veil{background:radial-gradient(ellipse at 50% 40%,rgba(248,243,233,.55),rgba(236,229,216,.1) 72%)}" +
      ".rw-title{position:relative;font-family:" + FONT_TITLE + ";font-weight:300;font-size:min(17vw,84px);letter-spacing:.32em;margin-right:-.32em;color:#22323a}" +
      ".rw-tag{position:relative;font-family:" + FONT_TITLE + ";font-style:italic;font-weight:300;font-size:19px;color:#4a5b60;margin-top:6px;padding:0 24px;line-height:1.35}" +
      ".rw-cta{position:relative;margin-top:30px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#1f6f73;animation:rwp 2.2s ease-in-out infinite}" +
      "@keyframes rwp{50%{opacity:.45}}" +
      ".rw-best{position:relative;margin-top:16px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#6a7a7e}" +
      ".rw-legend{position:relative;margin-top:26px;display:grid;grid-template-columns:auto auto;gap:6px 14px;font-size:12px;color:#4a5b60;text-align:left}" +
      ".rw-legend b{font-weight:600;color:#2a3a40;text-align:right}" +
      ".rw-big{position:relative;font-family:" + FONT_TITLE + ";font-weight:300;font-size:56px;color:#22323a;line-height:1;font-variant-numeric:tabular-nums}" +
      ".rw-label{position:relative;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#6a7a7e;margin-top:6px}" +
      ".rw-row{position:relative;display:flex;gap:28px;margin-top:22px}" +
      ".rw-row div{display:flex;flex-direction:column;align-items:center}" +
      ".rw-row b{font-family:" + FONT_TITLE + ";font-weight:300;font-size:28px;color:#2a3a40}" +
      ".rw-pb{position:relative;margin-top:14px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#a0661e;font-weight:600}" +
      ".rw-menu{position:relative;margin-top:22px;display:flex;flex-direction:column;gap:10px;align-items:center}" +
      ".rw-mbtn{min-width:190px;padding:11px 18px;border-radius:999px;border:1px solid rgba(47,61,66,.25);background:rgba(250,246,238,.75);font:500 13px " + FONT_UI + ";letter-spacing:.12em;text-transform:uppercase;color:#2a3a40;cursor:pointer}" +
      ".rw-mbtn.primary{background:#2c4a4f;color:#f4efe5;border-color:#2c4a4f}" +
      ".rw-vignette{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(40,70,80,.35) 100%);transition:opacity .25s}" +
      "</style>" +
      '<div class="rw">' +
      '<div class="rw-vignette" id="rw-vig"></div>' +
      '<div id="rw-diag" style="position:absolute;left:8px;top:2px;font:9px/1 monospace;color:rgba(40,55,60,.55);pointer-events:none;z-index:5">REWIND 2.0 b1</div>' +
      '<div class="rw-top" id="rw-top">' +
      '<div><div class="rw-score" id="rw-score">0</div><div class="rw-sub"><span id="rw-dist">0 m</span><span class="rw-mult" id="rw-mult"></span><span class="rw-pips" id="rw-pips"></span></div></div>' +
      '<div class="rw-btns"><button class="rw-btn" id="rw-mute" aria-label="Sound"></button><button class="rw-btn" id="rw-pause" aria-label="Pause"><svg viewBox="0 0 10 10"><rect x="1.5" y="1" width="2.4" height="8" fill="currentColor"/><rect x="6.1" y="1" width="2.4" height="8" fill="currentColor"/></svg></button></div>' +
      "</div>" +
      '<div class="rw-hint" id="rw-hint"></div>' +
      '<div class="rw-toasts" id="rw-toasts"></div>' +
      '<div class="rw-touch" id="rw-touch">' +
      '<div class="rw-tb rev" id="rw-trev"><svg viewBox="0 0 20 20"><path d="M10 4 L2 10 L10 16 Z M18 4 L10 10 L18 16 Z" fill="#2f5f63"/></svg><small>rewind</small></div>' +
      '<div class="rw-tb fwd" id="rw-tfwd"><svg viewBox="0 0 20 20"><path d="M2 4 L10 10 L2 16 Z M10 4 L18 10 L10 16 Z" fill="#8a5a22"/></svg><small>hurry</small></div>' +
      '<div class="rw-rest" id="rw-padhint">move</div>' +
      '<div class="rw-stick" id="rw-stick"><i id="rw-knob"></i></div>' +
      "</div>" +
      '<div class="rw-screen" id="rw-title"><div class="rw-veil"></div>' +
      '<div class="rw-title">REWIND</div>' +
      '<div class="rw-tag">Time never stops.<br>Bend it to make a way.</div>' +
      '<div class="rw-cta" id="rw-cta">Tap to begin</div>' +
      '<div class="rw-legend" id="rw-legend"></div>' +
      '<div class="rw-best" id="rw-tbest"></div>' +
      "</div>" +
      '<div class="rw-screen" id="rw-results"><div class="rw-veil"></div>' +
      '<div class="rw-label" style="margin:0 0 14px">history closes</div>' +
      '<div class="rw-big" id="rw-rscore">0</div><div class="rw-label">score</div>' +
      '<div class="rw-pb" id="rw-rpb"></div>' +
      '<div class="rw-row"><div><b id="rw-rdist">0</b><span class="rw-label">metres</span></div><div><b id="rw-rshards">0</b><span class="rw-label">echo shards</span></div><div><b id="rw-rbest">0</b><span class="rw-label">best</span></div></div>' +
      '<div class="rw-cta" id="rw-again">Tap to go again</div>' +
      "</div>" +
      '<div class="rw-screen" id="rw-pausescr"><div class="rw-veil"></div>' +
      '<div class="rw-big" style="font-size:40px">Paused</div>' +
      '<div class="rw-menu"><button class="rw-mbtn primary" id="rw-resume">Resume</button><button class="rw-mbtn" id="rw-restart">Restart run</button>' +
      '<button class="rw-mbtn" id="rw-sound"></button><button class="rw-mbtn" id="rw-motion"></button></div>' +
      "</div>" +
      "</div>";

    const $ = (id) => hudRoot.querySelector("#" + id);
    const hud = {
      score: $("rw-score"), dist: $("rw-dist"), mult: $("rw-mult"), pips: $("rw-pips"), top: $("rw-top"),
      ribbon: null, hint: $("rw-hint"), toasts: $("rw-toasts"), touch: $("rw-touch"),
      trev: $("rw-trev"), tfwd: $("rw-tfwd"), stick: $("rw-stick"), knob: $("rw-knob"), padhint: $("rw-padhint"),
      title: $("rw-title"), results: $("rw-results"), pausescr: $("rw-pausescr"), vig: $("rw-vig"),
      mute: $("rw-mute"), pause: $("rw-pause"), sound: $("rw-sound"), motion: $("rw-motion"),
      lastScore: -1, lastDist: -1, lastMult: "", ribbonCtx: null, layout: null
    };
    // the time ribbon is drawn on its own input-transparent overlay canvas, in CSS pixels
    hud.ribbon = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2 });
    hud.ribbon.style.pointerEvents = "none";
    hud.ribbon.style.touchAction = "none";
    hud.ribbonCtx = hud.ribbon.getContext("2d");
    for (let i = 0; i < 8; i++) hud.pips.appendChild(document.createElement("i"));

    const ICON_SOUND = '<svg viewBox="0 0 14 14"><path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor"/><path d="M10 4.5c1 .8 1 4.2 0 5" stroke="currentColor" fill="none" stroke-width="1.3"/></svg>';
    const ICON_MUTE = '<svg viewBox="0 0 14 14"><path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor"/><path d="M10 5l3 4M13 5l-3 4" stroke="currentColor" stroke-width="1.3"/></svg>';
    function refreshSettingsUI() {
      hud.mute.innerHTML = settings.muted ? ICON_MUTE : ICON_SOUND;
      hud.sound.textContent = settings.muted ? "Sound: off" : "Sound: on";
      hud.motion.textContent = settings.reducedMotion ? "Motion: reduced" : "Motion: full";
    }
    refreshSettingsUI();

    function legendHTML() {
      if (input.usedTouch) {
        return "<b>Left thumb</b><span>drag to move</span><b>Right thumb</b><span>hold ◀◀ to rewind · ▶▶ to hurry</span><b>Time</b><span>always flows unless you bend it</span>";
      }
      return "<b>WASD / arrows</b><span>move</span><b>Space</b><span>hold to rewind time</span><b>Shift</b><span>hold to hurry time</span>";
    }

    function layoutHUD() {
      const W = ctx.width, H = ctx.height, sb = (ctx.safeArea && ctx.safeArea.bottom) || 0;
      const rw = Math.round(Math.min(250, W * 0.5)), rh = 40;
      const dpr = Math.min(2, ctx.nativeDpr || 1);
      const narrow = W < 420;
      const ribbonTop = narrow ? 78 : 14;
      hud.hint.style.top = (narrow ? 126 : 66) + "px";
      hud.toasts.style.top = (narrow ? 172 : 112) + "px";
      // right thumb: a large REWIND button, a smaller HURRY (fast-forward) button beside it
      const B = Math.round(clamp(W * 0.23, 74, 96)), Bf = Math.round(B * 0.72);
      const by = H - sb - 34 - B;
      const rx = W - 16 - B;
      const fx = rx - Bf - 12, fy = by + (B - Bf) * 0.15 - 6;
      Object.assign(hud.trev.style, { left: rx + "px", top: by + "px", width: B + "px", height: B + "px" });
      Object.assign(hud.tfwd.style, { left: fx + "px", top: fy + "px", width: Bf + "px", height: Bf + "px" });
      Object.assign(hud.padhint.style, { left: "78px", top: (by + B / 2) + "px" });
      hud.layout = { W, H, B, Bf, by, fx, fy, rx, rw, rh, dpr, ribbonX: Math.round((W - rw) / 2), ribbonTop, splitX: W * 0.48,
        revC: { x: rx + B / 2, y: by + B / 2 }, ffC: { x: fx + Bf / 2, y: fy + Bf / 2 } };
    }

    function toast(text, pts) {
      const el = document.createElement("div");
      el.className = "rw-toast";
      el.innerHTML = text + (pts ? "<span>+" + pts + "</span>" : "");
      hud.toasts.appendChild(el);
      ctx.timeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1700);
      while (hud.toasts.children.length > 3) hud.toasts.removeChild(hud.toasts.firstChild);
    }

    const HINTS = {
      move: () => input.usedTouch ? "Drag on the <b>left</b> to move" : "<b>WASD</b> or <b>arrows</b> to move",
      rewind: () => input.usedTouch ? "Hold <b>◀◀</b> to rewind the bridge" : "Hold <b>Space</b> to rewind the bridge",
      hold: () => "Keep holding — cross while it is whole",
      choice: () => "Two routes: the ring is quicker, the split bridge richer",
      hurry: () => input.usedTouch ? "Hold <b>▶▶</b> to hurry time" : "Hold <b>Shift</b> to hurry time",
      fall: () => input.usedTouch ? "Falling? Hold <b>◀◀</b> — history may catch you" : "Falling? Hold <b>Space</b> — history may catch you"
    };
    const hintState = { key: null, shownAt: 0, progress: {} };
    function markHintDone(key) {
      if (settings.hintsSeen[key]) return;
      settings.hintsSeen[key] = true;
      storage.set("hintsSeen2", settings.hintsSeen);
    }
    function showHint(key) {
      if (hintState.key === key) return;
      hintState.key = key;
      hintState.shownAt = run.time;
      if (key) { hud.hint.innerHTML = HINTS[key](); hud.hint.classList.add("show"); }
      else hud.hint.classList.remove("show");
    }

    function drawRibbon(T) {
      const L = hud.layout, g = hud.ribbonCtx;
      if (!L) return;
      const w = L.rw, h = L.rh;
      // CSS-pixel surface: the runtime keeps the DPR transform; we only translate
      g.clearRect(0, 0, ctx.width, ctx.height);
      g.save();
      g.translate(L.ribbonX, L.ribbonTop);
      const span = 9; // seconds visible each side
      const cx = w / 2, y = 15;
      const tx = (t) => cx + ((t - T) / span) * (w / 2 - 6);
      // track
      g.fillStyle = "rgba(250,246,238,0.62)";
      roundRect(g, 0, 4, w, 22, 11); g.fill();
      // explored history
      const fr = clamp(tx(clock.frontier), 0, w);
      g.fillStyle = "rgba(60,90,96,0.08)";
      g.fillRect(Math.max(4, tx(0)), y - 2, Math.max(0, fr - Math.max(4, tx(0))), 4);
      // beginning of history
      if (tx(0) > 2) {
        g.fillStyle = "rgba(47,61,66,0.35)";
        g.fillRect(Math.max(2, tx(0) - 2), 6, 2, 18);
        g.fillStyle = "rgba(47,61,66,0.12)";
        g.fillRect(2, 6, Math.max(0, tx(0) - 4), 18);
      }
      // window of the next timed element ahead
      const nx = nextTimedElement();
      let inWin = false;
      if (nx) {
        const wins = nx.windows(T - span, T + span) || [];
        for (const [a, b] of wins) {
          const x0 = clamp(tx(a), 4, w - 4), x1 = clamp(tx(b), 4, w - 4);
          if (x1 - x0 < 1) continue;
          const on = T >= a && T <= b;
          if (on) inWin = true;
          g.fillStyle = on ? "rgba(70,170,170,0.55)" : "rgba(70,150,155,0.3)";
          roundRect(g, x0, 8, x1 - x0, 14, 5); g.fill();
        }
      }
      // ticks every second of world time: they slide as time flows
      g.fillStyle = "rgba(47,61,66,0.4)";
      const t0 = Math.ceil(T - span), t1 = Math.floor(T + span);
      for (let t = Math.max(0, t0); t <= t1; t++) {
        const x = tx(t);
        const big = t % 5 === 0;
        g.fillRect(x - 0.5, big ? 9 : 12, 1, big ? 12 : 6);
      }
      // needle
      const d = clock.dir;
      g.fillStyle = d > 0 ? "#b07a2e" : d < 0 ? "#2f8a8e" : "#2f3d42";
      g.fillRect(cx - 1, 3, 2, 24);
      g.beginPath(); g.moveTo(cx - 5, 2); g.lineTo(cx + 5, 2); g.lineTo(cx, 7); g.closePath(); g.fill();
      // direction glyph
      g.font = "600 10px " + FONT_UI;
      g.textAlign = "center";
      g.fillStyle = "rgba(40,55,60,0.75)";
      const label = clock.atFloor ? "BEGINNING OF HISTORY" : d < 0 ? "◀◀ REWINDING" : clock.fast ? "TIME ▶▶" : d > 0 ? "TIME ▶" : "PAUSED";
      g.fillText(label, cx, h - 3);
      if (inWin) { g.fillStyle = "rgba(47,138,142,0.9)"; g.fillRect(cx - 14, 26, 28, 2); }
      g.restore();
    }
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    let cachedNext = null, cachedNextAt = -1;
    function nextTimedElement() {
      if (cachedNextAt === run.frame) return cachedNext;
      cachedNextAt = run.frame;
      let best = null;
      course.forEachElement(player.s - 1, player.s + 26, (el) => {
        if (el.crossS1 == null || !el.windows || el.type === "gyro") return;
        if (el.crossS1 < player.s - 0.2) return;
        if (Math.abs(el.crossX - player.x) > 3.4) return;
        if (!best || el.crossS0 < best.crossS0) best = el;
      });
      cachedNext = best;
      return best;
    }

    // =====================================================================
    // 13. RUN — state, rewards, failure, restart
    // Reward accounting is separate from world state: each shard / bonus has a stable id
    // and can contribute once per run, however often time oscillates across it.
    // Distance is measured from the forward frontier only.
    // =====================================================================
    const best = {
      score: storage.get("bestScore", 0) || 0,
      dist: storage.get("bestDist", 0) || 0
    };
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    const run = {
      state: "title", time: 0, frame: 0, seed: 1, attempt: 0,
      bonus: 0, shards: 0, collected: new Set(), given: new Set(), crossing: new Map(),
      streak: 0, chain: 0, chainAt: -9, crossings: 0, leftId: null, leftAt: -9, stateAt: 0, newBest: false, deathAt: 0,
      revTime: 0, steerTime: 0, ffTime: 0, lastTick: 0,
      get mult() { return 1 + 0.25 * Math.min(this.streak, 8); },
      get distM() { return Math.floor(player.frontierS * METERS_PER_UNIT); },
      get score() { return this.distM * 10 + this.bonus; }
    };

    function award(id, label, base) {
      if (id && run.given.has(id)) return 0;
      if (id) run.given.add(id);
      const pts = Math.round(base * run.mult);
      run.bonus += pts;
      if (label) toast(label, pts);
      return pts;
    }

    function startRun(forcedSeed) {
      run.attempt++;
      run.seed = forcedSeed != null ? forcedSeed >>> 0 : (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffff)) >>> 0;
      course.reset(run.seed);
      scenery.reset(run.seed & 0xffff);
      clock.reset();
      player.reset();
      run.time = 0; run.bonus = 0; run.shards = 0; run.collected.clear(); run.given.clear(); run.crossing.clear();
      run.streak = 0; run.chain = 0; run.newBest = false; run.leftId = null; run.passedBest = false; run.crossings = 0; run.phase = -1;
      course.ensure(130); scenery.ensure(220);
      prevCols.clear(); curCols.clear();
      cam.init = false;
      setState("play");
      showHint(null);
      try { ctx.platform.start({ attempt: run.attempt }); } catch (e) {}
      if (scoreTrack) scoreTrack.set(0);
    }

    function setState(s) {
      run.state = s;
      run.stateAt = run.time;
      hud.title.classList.toggle("show", s === "title");
      hud.title.classList.toggle("click", s === "title");
      hud.results.classList.toggle("show", s === "results");
      hud.results.classList.toggle("click", s === "results");
      hud.pausescr.classList.toggle("show", s === "paused");
      hud.pausescr.classList.toggle("click", s === "paused");
      hud.top.style.visibility = s === "title" ? "hidden" : "visible";
      hud.ribbon.style.visibility = s === "play" || s === "paused" || s === "dying" ? "visible" : "hidden";
      hud.touch.classList.toggle("on", input.usedTouch && s === "play");
      if (s !== "play") input.clearAll();
      if (s !== "play" && s !== "paused") showHint(null);
      if (s === "title") {
        $("rw-legend").innerHTML = legendHTML();
        $("rw-cta").textContent = input.usedTouch ? "Tap to begin" : "Press Space or click to begin";
        $("rw-tbest").textContent = best.score > 0 ? "Best " + best.score.toLocaleString() + " · " + best.dist + " m" : "";
      }
    }

    function endRun(cause) {
      if (run.state !== "play") return;
      setState("dying");
      run.deathAt = run.time;
      audio.death();
      haptic("error");
      const score = run.score, dist = run.distM;
      run.newBest = score > best.score;
      if (score > best.score) { best.score = score; storage.set("bestScore", score); }
      if (dist > best.dist) { best.dist = dist; storage.set("bestDist", dist); }
      try { ctx.platform.fail({ score, distance: dist, cause }); } catch (e) {}
      if (scoreTrack) {
        scoreTrack.set(score);
        const attempt = run.attempt;
        Promise.resolve().then(() => scoreTrack.submit("score", { label: score.toLocaleString() + " pts" })).catch(() => {}).then(() => { void attempt; });
      } else if (ctx.memory && ctx.memory.record) {
        try { ctx.memory.record("score").submit(score, { label: score + " pts" }).catch(() => {}); } catch (e) {}
      }
    }

    function showResults() {
      setState("results");
      $("rw-rscore").textContent = run.score.toLocaleString();
      $("rw-rdist").textContent = run.distM;
      $("rw-rshards").textContent = run.shards;
      $("rw-rbest").textContent = best.score.toLocaleString();
      $("rw-rpb").textContent = run.newBest ? "new personal best" : "";
      $("rw-again").textContent = input.usedTouch ? "Tap to go again" : "Press Space or click to go again";
      if (run.newBest) { audio.best(); haptic("success"); }
    }

    function togglePause(force) {
      const want = force != null ? force : run.state === "play";
      if (want && run.state === "play") setState("paused");
      else if (!want && run.state === "paused") setState("play");
    }

    // ---- per-step game logic ----
    const idleInput = { mx: 0, my: 0, rew: false, ff: false, steer: 0 };
    function fixedStep() {
      run.time += DT;
      if (run.state === "paused") return; // the whole simulation holds: world and player
      input.compute();
      const playing = run.state === "play";
      const inp = playing ? input : idleInput;
      if (playing && !player.started && (inp.rew || inp.ff || Math.hypot(inp.mx, inp.my) > 0.1)) player.started = true;
      // The temporal current never stops in play: flow, or the player's rewind / fast-forward.
      // The title screen lets the world flow too, so it is visibly alive behind the menu.
      clock.step(DT, playing ? (inp.rew ? "rev" : inp.ff ? "ff" : "flow") : (run.state === "title" || run.state === "dying" || run.state === "results") ? "flow" : "stop");
      if (playing && clock.atFloor && !run.floorBuzz) { run.floorBuzz = true; audio.floor(); haptic("light"); }
      if (!clock.atFloor) run.floorBuzz = false;
      gatherColliders(clock.T);
      const prevGround = player.groundId;
      if (run.state !== "title") playerStep(DT, inp);
      if (player.groundId !== prevGround && prevGround) { run.leftId = prevGround; run.leftAt = run.time; }
      if (playing) {
        if (inp.rew) run.revTime += DT;
        if (inp.ff) run.ffTime += DT;
        if (Math.hypot(inp.mx, inp.my) > 0.2) run.steerTime += DT;
      }
      // world-time ticks
      const tk = Math.floor(clock.T * 2);
      if (tk !== run.lastTick) { if (playing && (clock.dir < 0 || clock.fast)) audio.tick(clock.T > clock.prevT); run.lastTick = tk; }
      // element events near the player (sound)
      if (clock.T !== clock.prevT) {
        course.forEachElement(player.s - 12, player.s + 34, (el) => {
          el.events(clock.prevT, clock.T, (kind, x, s, idx) => {
            const near = clamp(1 - Math.abs(s - player.s) / 34, 0, 1);
            if (near <= 0 || !playing) return;
            if (kind === "crumble") {
              audio.crumble(near);
              if (el.type === "span" && run.leftId === el.id + ":" + idx && run.time - run.leftAt < 0.45 && player.groundId) award(el.id + ":knife", "Knife-edge", 120);
            } else if (kind === "settle") audio.settle(near * 0.8);
            else if (kind === "slide") audio.slide(near);
            else if (kind === "clunk") audio.clunk(near);
            else if (kind === "gate") audio.gate(near);
          });
        });
      }
      if (playing) {
        collectShards();
        crossingBonuses();
        segmentProgress();
        updateHints();
      }
      // events from the player simulation
      for (const ev of simEvents) {
        if (ev.type === "land") {
          rig.land(ev.data.impact);
          if (ev.data.impact > 6) { audio.land(ev.data.impact); haptic(ev.data.impact > 14 ? "medium" : "light"); cam.shake = Math.min(1, ev.data.impact / 18); }
          if (ev.data.caught && playing) award(String(ev.data.el).split(":").slice(0, 2).join(":") + ":caught", "Caught by history", 200);
        } else if (ev.type === "knock") { audio.knock(); haptic("warning"); cam.shake = 0.6; }
        else if (ev.type === "deepfall" && playing) {
          const sg = course.segAt(player.s);
          if (sg) sg.fellHere = true;
          run.streak = Math.floor(run.streak / 2);
          if (!settings.hintsSeen.fall) showHint("fall");
        } else if (ev.type === "death" && playing) endRun("fall");
      }
      simEvents.length = 0;
      if (run.state === "dying" && run.time - run.deathAt > 1.1) showResults();
    }

    function collectShards() {
      const p = player;
      const cy = p.y + 0.7;
      for (const sg of course.segs) {
        if (sg.s1 < p.s - 8 || sg.s0 > p.s + 8) continue;
        for (const sh of sg.shards) {
          if (run.collected.has(sh.id)) continue;
          if (sh.existence(clock.T) < 0.5) continue;
          const q = sh.pos(clock.T);
          const dx = q.x - p.x, dy = q.y - cy, ds = q.s - p.s;
          if (dx * dx + dy * dy + ds * ds < 0.8 * 0.8) {
            run.collected.add(sh.id);
            run.shards++;
            if (run.time - run.chainAt < 1.6) run.chain++; else run.chain = 0;
            run.chainAt = run.time;
            const pts = award(null, null, 100 + run.chain * 20);
            audio.shard(run.chain);
            haptic("light");
            sparkle(q);
            void pts;
          }
        }
      }
    }

    // Outcome rewards. Each timed structure is judged once, when the player steps off its far
    // end: was it closed when they approached, and did they open it by bending time?
    //   Perfect reversal  — shut on approach, crossed by rewinding (250)
    //   Ahead of time     — not yet open on approach, crossed by hurrying (180)
    //   Clean crossing    — crossed without falling (60)
    // Holding a button earns nothing by itself.
    function crossingBonuses() {
      const p = player;
      course.forEachElement(p.s - 3, p.s + 8, (el) => {
        if (el.crossS0 == null || !el.windows || el.type === "gate" || el.type === "gyro") return;
        if (run.given.has(el.id + ":x")) return;
        if (Math.abs(p.x - el.crossX) > 2.8) return;
        let c = run.crossing.get(el.id);
        if (!c && p.s >= el.crossS0 - 7 && p.s <= el.crossS1) {
          const open = (el.windows(clock.T - 0.01, clock.T + 0.01) || []).length > 0;
          c = { closedOnApproach: !open && p.s < el.crossS0, rev: 0, ff: 0, fell: false, onIt: false };
          run.crossing.set(el.id, c);
        }
        if (!c) return;
        // "shut on approach": at any moment before stepping on, the way was closed
        if (p.s < el.crossS0 && !c.closedOnApproach && (el.windows(clock.T - 0.01, clock.T + 0.01) || []).length === 0) c.closedOnApproach = true;
        if (clock.dir < 0) c.rev += DT;
        if (clock.fast) c.ff += DT;
        if (p.deepFall) c.fell = true;
        if (p.s >= el.crossS0 && p.s <= el.crossS1) c.onIt = true;
        if (p.s > el.crossS1 + 0.2 && p.groundId) {
          run.crossing.delete(el.id);
          run.given.add(el.id + ":x");
          if (!c.onIt || c.fell) return;
          if (c.closedOnApproach && c.rev > 0.2) { award(null, "Perfect reversal", 250); audio.bonus(); ripple(0x9feef2); haptic("success"); }
          else if (c.closedOnApproach && c.ff > 0.2) { award(null, "Ahead of time", 180); audio.bonus(); ripple(0xffd18a); }
          else award(null, "Clean crossing", 60);
          run.crossings++;
        }
      });
    }
    function ripple(color) {
      const ring = new THREE.Mesh(cachedGeo("rippleRing", () => new THREE.RingGeometry(0.5, 0.62, 48)), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(player.x, player.y + 0.05, -player.s);
      ring.userData.ownMat = true;
      scene.add(ring);
      sparkles.push({ m: ring, ring: true, flat: true, life: 0.7, age: 0 });
    }

    function segmentProgress() {
      const p = player;
      for (const sg of course.segs) {
        if (sg.cleared || sg.index === 0) continue;
        if (p.s > sg.s1 && p.groundId) {
          sg.cleared = true;
          if (!sg.fellHere) {
            run.streak++;
            award("seg" + sg.index, null, 50);
          }
          try { ctx.platform.milestone("encounter_" + sg.index, { kind: sg.kind }); } catch (e) {}
        }
      }
      if (scoreTrack) scoreTrack.set(run.score);
      // entering a new region: a banner, and the light of the world shifts
      const here = course.segAt(p.s);
      if (here && here.phase > run.phase) {
        if (run.phase >= 0 || here.phase > 0) { toast(PHASES[here.phase].name, 0); audio.best(); }
        run.phase = here.phase;
        atmo.tint.setHex(PHASES[here.phase].tint);
      }
      if (!run.passedBest && best.dist > 20 && run.distM > best.dist) {
        run.passedBest = true;
        toast("Beyond your furthest", 0);
        audio.bonus();
      }
    }

    function updateHints() {
      const p = player;
      if (run.steerTime > 0.35) markHintDone("move");
      if (run.revTime > 0.5 && hintState.key === "rewind") markHintDone("rewind");
      if (run.ffTime > 0.5) markHintDone("hurry");
      if (p.groundId && hintState.key === "fall" && run.time - hintState.shownAt > 1.5) markHintDone("fall");
      if (hintState.key === "choice" && run.time - hintState.shownAt > 4.5) markHintDone("choice");
      if (hintState.key === "hold" && clock.dir >= 0 && run.time - hintState.shownAt > 0.6) showHint(null);
      if (hintState.key && settings.hintsSeen[hintState.key]) showHint(null);
      if (hintState.key === "fall" && !p.deepFall && run.time - hintState.shownAt > 2.5) showHint(null);
      if (hintState.key) return;
      for (const sg of course.segs) {
        if (sg.s1 < p.s - 20 || sg.s0 > p.s + 20) continue;
        for (const h of sg.hints) {
          if (settings.hintsSeen[h.key]) continue;
          if (p.s < h.sa || p.s > h.sb) continue;
          if (h.key === "hold" && p.s > h.sb - 0.5) { markHintDone("hold"); continue; }
          if (h.key === "move" && run.time - run.stateAt < 0.8) continue;
          if (h.key === "rewind" || h.key === "hold") {
            const span = sg.elements.find((el) => el.type === "span");
            if (!span) continue;
            const open = span.windows(clock.T - 0.01, clock.T + 0.01).length > 0;
            if (h.key === "rewind" && open) continue;            // only once the bridge has fallen
            if (h.key === "hold" && !(open && clock.dir < 0)) continue; // while rewinding it back
          }
          if (h.key === "hurry") {
            const st = sg.elements.find((el) => el.type === "stair");
            if (!st || st.windows(clock.T - 0.01, clock.T + 0.01).length > 0) continue;
          }
          showHint(h.key);
          return;
        }
      }
    }

    // collection sparkle: a short, restrained burst in real time
    const sparkles = [];
    const sparkGeo = new THREE.OctahedronGeometry(0.05, 0);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ctx.onDestroy(() => { sparkGeo.dispose(); sparkMat.dispose(); });
    function sparkle(q) {
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(sparkGeo, sparkMat);
        const a = (i / 10) * TAU, up = 0.8 + Math.random() * 1.6;
        m.position.set(q.x, q.y, -q.s);
        scene.add(m);
        sparkles.push({ m, vx: Math.cos(a) * 2.2, vy: up, vz: Math.sin(a) * 2.2, life: 0.55 });
      }
      const ring = new THREE.Mesh(cachedGeo("sparkRing", () => new THREE.RingGeometry(0.3, 0.36, 32)), new THREE.MeshBasicMaterial({ color: 0xffd99a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.position.set(q.x, q.y, -q.s);
      ring.userData.ownMat = true;
      scene.add(ring);
      sparkles.push({ m: ring, ring: true, life: 0.45, age: 0 });
    }
    function updateSparkles(dt) {
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.life -= dt;
        if (sp.ring) {
          sp.age += dt;
          sp.m.scale.setScalar(1 + sp.age * (sp.flat ? 9 : 5));
          sp.m.material.opacity = Math.max(0, sp.life / (sp.flat ? 0.7 : 0.45));
          if (!sp.flat) sp.m.lookAt(camera.position);
        } else {
          sp.vy -= 6 * dt;
          sp.m.position.x += sp.vx * dt; sp.m.position.y += sp.vy * dt; sp.m.position.z += sp.vz * dt;
          sp.m.scale.setScalar(Math.max(0.01, sp.life / 0.55));
        }
        if (sp.life <= 0) {
          scene.remove(sp.m);
          if (sp.ring) sp.m.material.dispose();
          sparkles.splice(i, 1);
        }
      }
    }

    // ---- input wiring ----
    function anyStart() {
      audio.init(); audio.resume();
      if (run.state === "title") startRun();
      else if (run.state === "results" && run.time - run.stateAt > 0.6) startRun();
    }
    ctx.listen(window, "keydown", (e) => {
      if (isTypingTarget(e)) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat && GAME_KEYS.has(e.code)) return;
      if (e.code === "Escape" || e.code === "KeyP") { if (run.state === "play" || run.state === "paused") togglePause(); return; }
      if (e.code === "KeyM") { toggleMute(); return; }
      if (run.state === "title" || run.state === "results") {
        if (e.code === "Space" || e.code === "Enter") { input.usedTouch = false; anyStart(); }
        return;
      }
      if (input.usedTouch && GAME_KEYS.has(e.code)) { input.usedTouch = false; hud.touch.classList.remove("on"); }
      input.keys.add(e.code);
    });
    ctx.listen(window, "keyup", (e) => { input.keys.delete(e.code); });
    ctx.listen(window, "blur", () => { input.clearAll(); if (run.state === "play") togglePause(true); });
    ctx.listen(document, "visibilitychange", () => { if (document.hidden) { input.clearAll(); if (run.state === "play") togglePause(true); } });

    // a right-thumb touch belongs to whichever time button is nearer (forgiving, and a thumb can
    // slide from one to the other without lifting)
    function timeZone(x, y) {
      const L = hud.layout;
      const dr = Math.hypot(x - L.revC.x, y - L.revC.y) / (L.B / 2), df = Math.hypot(x - L.ffC.x, y - L.ffC.y) / (L.Bf / 2);
      return df < dr ? "ff" : "rev";
    }
    function refreshTouchVisuals() {
      let rev = false, fwd = false, stick = null;
      for (const t of input.touches.values()) {
        if (t.role === "time") { if (t.zone === "rev") rev = true; else fwd = true; }
        if (t.role === "move") stick = t;
      }
      hud.trev.classList.toggle("down", rev);
      hud.tfwd.classList.toggle("down", fwd && !rev);
      if (stick) {
        hud.stick.style.display = "block";
        hud.stick.style.left = stick.ox + "px"; hud.stick.style.top = stick.oy + "px";
        let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
        const m = Math.hypot(dx, dy);
        if (m > STICK_R) { dx *= STICK_R / m; dy *= STICK_R / m; }
        hud.knob.style.transform = "translate(" + dx + "px," + dy + "px)";
        hud.padhint.style.opacity = "0";
      } else { hud.stick.style.display = "none"; hud.padhint.style.opacity = "1"; }
    }
    // Touch routing. On device, the play canvas itself received no touches (diagnostics showed
    // taps reaching the bit but 0 reaching the canvas: a surface above it takes them). So all
    // play input is read at the bit container, in the capture phase, whatever element is on
    // top. Real HUD buttons keep their own handlers.
    const inputHost = ctx.container;
    function localXY(e) {
      const r = inputHost.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (ctx.width / (r.width || ctx.width)), y: (e.clientY - r.top) * (ctx.height / (r.height || ctx.height)) };
    }
    const diag = { bit: 0, canvas: 0, play: 0, target: "", err: "" };
    function refreshDiag() {
      const el = hudRoot.querySelector("#rw-diag");
      if (el) el.textContent = "REWIND 2.0 b1 · taps " + diag.bit + "/" + diag.canvas + "/" + diag.play + (diag.target ? " · on " + diag.target : "") + (diag.err ? " · ERR " + diag.err : "");
    }
    function reportError(where, e) {
      if (diag.err) return;
      diag.err = where + ": " + String((e && e.message) || e).slice(0, 80);
      refreshDiag();
      try { ctx.platform.error({ stage: where, message: String((e && (e.stack || e.message)) || e).slice(0, 500) }); } catch (x) {}
    }
    function describe(el) {
      if (!el || !el.tagName) return "?";
      return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
    }
    const isHudButton = (e) => !!(e.target && e.target.closest && e.target.closest("button"));
    // If another surface covers the HUD, a tap on a button's position still presses it.
    function hudButtonAt(cx, cy) {
      for (const b of hudButtons) {
        const scr = b.el.closest(".rw-screen");
        if (scr && !scr.classList.contains("show")) continue;
        if (!scr && hud.top.style.visibility === "hidden") continue;
        const r = b.el.getBoundingClientRect();
        if (r.width && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return b;
      }
      return null;
    }
    ctx.listen(window, "error", (ev) => reportError("window", ev.error || ev.message));
    ctx.listen(window, "unhandledrejection", (ev) => reportError("promise", ev.reason));
    ctx.listen(canvas, "pointerdown", () => { diag.canvas++; refreshDiag(); }, true);
    ctx.listen(inputHost, "pointerdown", (e) => {
      diag.bit++; diag.target = describe(e.target); refreshDiag();
      if (isHudButton(e)) return; // the button's own handler runs
      const hb = hudButtonAt(e.clientX, e.clientY);
      if (hb) { if (e.cancelable) e.preventDefault(); hb.fn(); return; }
      if (e.cancelable) e.preventDefault();
      if (e.pointerType === "touch" && !input.usedTouch) { input.usedTouch = true; }
      if (run.state !== "play") { anyStart(); if (run.state !== "play") return; }
      audio.resume();
      const q = localXY(e);
      const role = q.x < hud.layout.splitX ? "move" : "time";
      input.touches.set(e.pointerId, { role, ox: q.x, oy: q.y, x: q.x, y: q.y, zone: role === "time" ? timeZone(q.x, q.y) : null });
      diag.play++; refreshDiag();
      if (input.usedTouch) hud.touch.classList.add("on");
      refreshTouchVisuals();
      try { ctx.platform.interact({ type: role }); } catch (err) {}
    }, true);
    ctx.listen(inputHost, "pointermove", (e) => {
      const t = input.touches.get(e.pointerId);
      if (!t) return;
      const q = localXY(e);
      t.x = q.x; t.y = q.y;
      if (t.role === "time") t.zone = timeZone(q.x, q.y);
      refreshTouchVisuals();
    }, true);
    const endTouch = (e) => {
      if (input.touches.delete(e.pointerId)) refreshTouchVisuals();
    };
    ctx.listen(inputHost, "pointerup", endTouch, true);
    ctx.listen(inputHost, "pointercancel", endTouch, true);
    ctx.listen(window, "pointerup", endTouch);
    ctx.listen(window, "pointercancel", endTouch);
    // keep the browser from turning a held or dragged thumb into scrolling / zooming
    ctx.listen(inputHost, "touchmove", (e) => { if (run.state === "play" && e.cancelable) e.preventDefault(); }, { passive: false, capture: true });
    ctx.listen(canvas, "contextmenu", (e) => e.preventDefault());

    function toggleMute() {
      settings.muted = !settings.muted;
      storage.set("muted", settings.muted);
      audio.init();
      audio.setMuted(settings.muted);
      refreshSettingsUI();
    }
    const hudButtons = [];
    const btn = (el, fn) => {
      hudButtons.push({ el, fn });
      ctx.listen(el, "pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); fn(); });
    };
    btn(hud.mute, toggleMute);
    btn(hud.pause, () => { if (run.state === "play" || run.state === "paused") togglePause(); });
    btn($("rw-resume"), () => togglePause(false));
    btn($("rw-restart"), () => { audio.init(); startRun(); });
    void 0;
    btn(hud.sound, toggleMute);
    btn(hud.motion, () => { settings.reducedMotion = !settings.reducedMotion; storage.set("reducedMotion", settings.reducedMotion); refreshSettingsUI(); });
    ctx.listen(hud.title, "pointerdown", (e) => { e.preventDefault(); if (e.pointerType === "touch") input.usedTouch = true; anyStart(); });
    ctx.listen(hud.results, "pointerdown", (e) => { e.preventDefault(); if (e.pointerType === "touch") input.usedTouch = true; anyStart(); });

    // ---- resize ----
    ctx.onResize(({ width, height }) => {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      layoutHUD();
    }, { immediate: true });

    // ---- frame ----
    let prevVs = 0;
    const tmpV = new THREE.Vector3();
    function renderFrame(alpha, dtReal) {
      run.frame++;
      const a = clamp(alpha, 0, 1);
      const Tr = lerp(clock.prevT, clock.T, a);
      const p = player;
      const rx = lerp(p.px, p.x, a), ry = lerp(p.py, p.y, a), rs = lerp(p.ps, p.s, a);
      const sView = rs;
      course.ensure(sView + 120); course.cull(sView - 30);
      scenery.ensure(sView + 220); scenery.cull(sView - 80);
      course.render(Tr, run.collected, sView - 24, sView + 150);
      scenery.render(Tr);
      dustMaterial.uniforms.uT.value = Tr;
      // character
      const spNow = Math.hypot(p.vx, p.vs);
      const accel = (spNow - prevVs) / Math.max(dtReal, 1e-3);
      prevVs = spNow;
      rig.root.position.set(rx, ry, -rs);
      rig.root.scale.setScalar(1.12);
      rig.update(dtReal, p, clamp(accel, -20, 20), (r) => { if (run.state === "play") audio.step(r); });
      // contact shadow sits on the ground beneath, fading with height
      let gy = -1e9;
      for (const c of colList) if (c.sup && colContains(c, rx, rs, 0.02)) { const t = colTopAt(c, rx); if (t <= ry + 0.05 && t > gy) gy = t; }
      if (gy > -1e8) { rig.blob.visible = true; rig.blob.position.y = gy - ry + 0.015; rig.blob.material.opacity = 0.32 * clamp(1 - (ry - gy) / 4, 0, 1); }
      else rig.blob.visible = false;
      const cd = clock.dir;
      const charmCol = cd > 0 ? 0xffc36e : cd < 0 ? 0x9ff0f4 : 0xf2eadc;
      rig.charm.material.color.setHex(charmCol);
      rig.charmGlow.material.color.setHex(charmCol);
      rig.charmGlow.material.opacity = cd === 0 ? 0.2 : 0.7;
      cameraUpdate(dtReal, rx, ry, rs);
      occl.uRwPlayer.value.set(rx, ry + 0.8, -rs);
      occl.uRwCam.value.copy(camera.position);
      occl.uRwAhead.value.set(rx * 0.5, ry + 0.3, -(rs + 7.5));
      atmosphereUpdate(dtReal, Tr, cam.fx, cam.fs);
      updateSparkles(dtReal);
      // HUD
      const sc = run.score;
      if (sc !== hud.lastScore) { hud.score.textContent = sc.toLocaleString(); hud.lastScore = sc; }
      const dm = run.distM;
      if (dm !== hud.lastDist) { hud.dist.textContent = dm + " m"; hud.lastDist = dm; }
      const ms = run.streak > 0 ? "×" + run.mult.toFixed(2).replace(/0$/, "") : "";
      if (ms !== hud.lastMult) {
        hud.mult.textContent = ms; hud.lastMult = ms;
        const pips = hud.pips.children;
        for (let i = 0; i < pips.length; i++) pips[i].className = i < Math.min(run.streak, 8) ? "on" : "";
      }
      if (run.state !== "title") drawRibbon(Tr);
      const falling = !p.groundId && p.y < p.lastGroundY - 1 && p.alive;
      hud.vig.style.opacity = falling ? String(clamp((p.lastGroundY - p.y) / KILL_DEPTH, 0, 1)) : "0";
      audio.update(clock.dir, clock.rate, run.state === "play", falling ? p.maxFallSpeed : 0);
      void tmpV;
      renderer.render(scene, camera);
    }

    // ---- loop ----
    const loop = ctx.game.loop({
      fixedHz: FIXED_HZ,
      maxDeltaMs: 100,
      maxSubsteps: 14,
      fixedUpdate: () => { try { fixedStep(); } catch (e) { reportError("step", e); } },
      render: (alpha, state) => { try { renderFrame(alpha, Math.min((state && state.dtMs) || 16.7, 100) / 1000); } catch (e) { reportError("render", e); } }
    });

    // ---- debug hooks (local harness only; ctx.debugHooks is undefined in Plethora) ----
    if (ctx.debugHooks) {
      Object.assign(ctx.debugHooks, {
        THREE, scene, camera, renderer, clock, player, course, run, input, settings, loop, hud, cam,
        startRun, fixedStep, setState, validateSegment, makeBuilder, LIBRARY, INTRO, runSpeedAt,
        colliders(T, sa, sb) { return course.colliders(T, sa, sb, []); },
        stepN(n) { for (let i = 0; i < n; i++) fixedStep(); renderFrame(1, DT); },
        render() { renderFrame(1, DT); },
        renderAt(dt) { renderFrame(1, dt); }
      });
    }

    // ---- first frame, then ready ----
    course.reset(1);
    scenery.reset(1);
    course.ensure(130); scenery.ensure(220);
    gatherColliders(0);
    setState("title");
    renderFrame(1, 0.016);
    const boot = hudRoot.querySelector("#rw-boot");
    if (boot) boot.remove();
    ctx.markVisualReady("scene");
    ctx.platform.ready();
    // fonts refine the typography once they arrive; the HUD works with fallbacks meanwhile
    Promise.all([
      ctx.loadFont("Cormorant Garamond", "cormorant-garamond", "1.0.0", { weight: "300", style: "normal" }),
      ctx.loadFont("Cormorant Garamond", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }),
      ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400", style: "normal" }),
      ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600", style: "normal" })
    ]).catch(() => {});
  }
};
