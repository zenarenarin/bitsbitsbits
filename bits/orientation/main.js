// ORIENTATION — a luminous bead on a filament. You never touch the ball:
// you tilt the world underneath it, and gravity does the rest.
window.plethoraBit = {
  meta: {
    title: "Orientation",
    runtime: "plethora-bit@2",
    tags: ["interactive-art", "physics", "gravity", "meditative", "light"],
    permissions: ["audio"]
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const damp = (k, dt) => 1 - Math.exp(-k * dt);

    const tune = (id, d) => {
      try { const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined; return v == null || !isFinite(v) ? d : v; }
      catch (e) { return d; }
    };
    const GRAVITY = tune("gravity", 210);
    const HOLD = tune("groove_hold", 1);
    const INERTIA = tune("world_inertia", 1);
    const SENS = tune("rotation_sensitivity", 1);
    const HAZE = tune("haze", 1);
    const GRAIN = tune("grain", 1);
    const VOLUME = tune("volume", 0.8);
    const START_LEVEL = Math.round(tune("start_level", 1));

    // ---------- tiny deterministic helpers ----------
    function hash(i) {
      let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1);
      h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
      return ((h >>> 0) / 4294967295) * 2 - 1;
    }
    function noise1(x) {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return lerp(hash(i), hash(i + 1), u);
    }
    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---------- path construction ----------
    const STEP = 4;

    function trace(cmds, from) {
      let x = from.x, y = from.y, h = from.h, s = 0;
      const X = [x], Y = [y], gaps = [];
      for (const c of cmds) {
        if (c[0] === "S") {
          const L = c[1], n = Math.max(1, Math.ceil(L / STEP)), d = L / n;
          if (c[2]) gaps.push([s + c[2][0], s + c[2][1]]);
          for (let i = 0; i < n; i++) { x += Math.cos(h) * d; y += Math.sin(h) * d; X.push(x); Y.push(y); }
          s += L;
        } else {
          const R = c[1], a = (c[2] * Math.PI) / 180, L = Math.abs(a) * R;
          const n = Math.max(2, Math.ceil(L / STEP)), d = L / n, dh = a / n;
          for (let i = 0; i < n; i++) {
            h += dh / 2; x += Math.cos(h) * d; y += Math.sin(h) * d; h += dh / 2;
            X.push(x); Y.push(y);
          }
          s += L;
        }
      }
      return { X, Y, Z: null, gaps, end: { x, y, h } };
    }

    // Re-sample an arbitrary dense curve to even STEP spacing.
    function resample(X, Y, Z) {
      const OX = [X[0]], OY = [Y[0]], OZ = [Z ? Z[0] : 0];
      let carry = 0;
      for (let i = 1; i < X.length; i++) {
        const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1];
        const L = Math.hypot(dx, dy);
        let t = STEP - carry;
        while (t <= L) {
          const u = t / L;
          OX.push(X[i - 1] + dx * u); OY.push(Y[i - 1] + dy * u);
          OZ.push(Z ? lerp(Z[i - 1], Z[i], u) : 0);
          t += STEP;
        }
        carry = L - (t - STEP);
      }
      return { X: OX, Y: OY, Z: OZ, gaps: [] };
    }

    function makeStrand(tr, opts = {}) {
      const n = tr.X.length;
      const st = {
        n, x: new Float32Array(tr.X), y: new Float32Array(tr.Y),
        z: new Float32Array(n), s: new Float32Array(n),
        segGap: new Uint8Array(n), sx: new Float32Array(n), sy: new Float32Array(n),
        next: [], parent: -1, dead: !!opts.dead, final: !!opts.final, id: 0, len: 0
      };
      if (tr.Z) for (let i = 0; i < n; i++) st.z[i] = tr.Z[i];
      for (let i = 1; i < n; i++) st.s[i] = st.s[i - 1] + Math.hypot(st.x[i] - st.x[i - 1], st.y[i] - st.y[i - 1]);
      st.len = st.s[n - 1];
      for (let i = 0; i < n - 1; i++) {
        const m = (st.s[i] + st.s[i + 1]) / 2;
        for (const g of tr.gaps) if (m >= g[0] && m <= g[1]) st.segGap[i] = 1;
      }
      return st;
    }

    function link(strands, parent, children) {
      for (const c of children) { strands[parent].next.push(c); strands[c].parent = parent; }
    }

    const O = { x: 0, y: 0, h: 0 };

    // Each world: geometry + the physical/perceptual rules that govern it.
    const LEVELS = [
      {
        name: "STRAIGHT", hold: 0.85, horizon: "world", key: 0,
        build() { return [makeStrand(trace([["S", 1000]], O), { final: true })]; }
      },
      {
        name: "CURVE", hold: 0.74, horizon: "world", key: 2,
        build() {
          return [makeStrand(trace([["S", 160], ["A", 300, 70], ["A", 290, -105], ["A", 330, 80], ["S", 220]], O), { final: true })];
        }
      },
      {
        name: "MOMENTUM", hold: 0.72, horizon: "world", key: 4,
        inertia: 4.2, zeta: 0.32, spinDamp: 0.42,
        build() {
          return [makeStrand(trace([["S", 150], ["A", 270, 90], ["S", 90], ["A", 250, -160], ["S", 90], ["A", 290, 120], ["S", 180]], O), { final: true })];
        }
      },
      {
        name: "LOOP", hold: 0.72, horizon: "world", key: 7, inertia: 1.6, zeta: 0.7, spinDamp: 1.0,
        build() {
          return [makeStrand(trace([["S", 200], ["A", 270, 180], ["A", 200, 180], ["S", 150], ["A", 270, -90], ["S", 240]], O), { final: true })];
        }
      },
      {
        name: "GAP", hold: 0.72, horizon: "world", key: 9, inertia: 1.4, zeta: 0.8, spinDamp: 1.2,
        build() {
          return [makeStrand(trace([
            ["S", 170], ["A", 300, 50], ["S", 210, [70, 140]], ["A", 300, -80],
            ["S", 240, [80, 170]], ["A", 330, 45], ["S", 250, [90, 190]], ["S", 140]
          ], O), { final: true })];
        }
      },
      {
        name: "FORK", hold: 0.7, horizon: "world", key: 11, inertia: 1.4, zeta: 0.8, spinDamp: 1.2,
        build() {
          const t0 = trace([["S", 170], ["A", 300, 40], ["S", 120]], O);
          const a = trace([["A", 330, -42], ["S", 280]], t0.end);
          const b = trace([["A", 330, 42], ["S", 150], ["A", 290, -70], ["S", 110]], t0.end);
          const c = trace([["A", 330, 42], ["S", 240]], b.end);
          const d = trace([["A", 330, -42], ["S", 120], ["A", 300, 60], ["S", 230]], b.end);
          const S = [makeStrand(t0), makeStrand(a, { dead: true }), makeStrand(b), makeStrand(c, { dead: true }), makeStrand(d, { final: true })];
          link(S, 0, [1, 2]); link(S, 2, [3, 4]);
          return S;
        }
      },
      {
        name: "MEMORY", hold: 0.72, horizon: "world", key: 14, inertia: 1.4, zeta: 0.8, spinDamp: 1.2,
        memory: true, flicker: 0.3,
        build() {
          return [makeStrand(trace([["S", 130], ["A", 270, 80], ["A", 230, -125], ["S", 140], ["A", 270, 140], ["S", 70], ["A", 250, -105], ["S", 220]], O), { final: true })];
        }
      },
      {
        name: "DEPTH", hold: 0.72, horizon: "stable", key: 16, inertia: 1.4, zeta: 0.8, spinDamp: 1.2,
        depth: true, skew: 0.3, farK: 2.2,
        build() {
          // A trefoil knot flattened into the plate: it passes behind itself three times.
          const X = [], Y = [], Z = [], K = 175, t0 = 0.55, span = TAU - 0.5;
          for (let i = 0; i <= 1600; i++) {
            const t = t0 + (span * i) / 1600;
            X.push(K * (Math.sin(t) + 2 * Math.sin(2 * t)));
            Y.push(K * (Math.cos(t) - 2 * Math.cos(2 * t)));
            Z.push(-Math.sin(3 * t));
          }
          return [makeStrand(resample(X, Y, Z), { final: true })];
        }
      },
      {
        name: "DRIFT", hold: 0.72, horizon: "stable", key: 19, inertia: 1.5, zeta: 0.75, spinDamp: 0.9,
        auto: 1.25, skew: 0.55, farK: 1.2,
        build() {
          return [makeStrand(trace([["S", 150], ["A", 300, 70], ["A", 280, -120], ["S", 100], ["A", 300, 100], ["A", 270, -80], ["S", 120], ["A", 320, 60], ["S", 200]], O), { final: true })];
        }
      },
      {
        name: "SYMMETRY", hold: 0.74, horizon: "none", key: 21, inertia: 1.3, zeta: 0.85, spinDamp: 1.2,
        fixedCam: true, symmetric: true, skew: 0.8, farK: 1.4, showRotation: true,
        rose: { R: 250, A: 12, k: 6 },
        build() {
          const X = [], Y = [], { R, A, k } = this.rose;
          for (let i = 0; i <= 2400; i++) {
            const p = (TAU * i) / 2400, r = R + A * Math.cos(k * p);
            X.push(r * Math.cos(p)); Y.push(r * Math.sin(p));
          }
          return [makeStrand(resample(X, Y, null), { final: true })];
        }
      },
      {
        name: "", hold: 0.74, horizon: "none", key: 12, inertia: 1.5, zeta: 0.8, spinDamp: 1.0,
        auto: 0.45, skew: 0, noShadow: true, noUi: true, farK: 0.9, flicker: 0.25, final: true,
        build() {
          const r = rng(7331), cmds = [["S", 160]];
          let sign = 1;
          for (let i = 0; i < 9; i++) {
            cmds.push(["A", 290 + r() * 150, sign * (45 + r() * 65)]);
            if (r() < 0.5) cmds.push(["S", 60 + r() * 120]);
            sign = -sign;
          }
          cmds.push(["S", 200]);
          return [makeStrand(trace(cmds, O), { final: true })];
        }
      }
    ];
    const NLEV = LEVELS.length;

    // ---------- surfaces ----------
    const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 2, coordinateSpace: "css", alpha: false });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({
      layer: "overlay", input: "passthrough",
      style: "font-family:'Space Mono',ui-monospace,Menlo,Consolas,monospace;color:rgba(214,222,232,0.46);letter-spacing:0.34em;font-size:9px;line-height:1.9;text-transform:uppercase;user-select:none;-webkit-user-select:none;"
    });
    ui.innerHTML =
      '<div data-k="tl" style="position:absolute;left:18px;top:18px;transition:opacity 1.6s ease">ORIENTATION<div data-k="m" style="opacity:0.55;font-size:8px;white-space:pre"></div></div>' +
      '<div data-k="tr" style="position:absolute;right:14px;top:18px;transition:opacity 1.6s ease">01</div>' +
      '<div data-k="msg" style="position:absolute;left:0;right:0;top:62%;text-align:center;font-size:10px;letter-spacing:0.5em;opacity:0;transition:opacity 1.1s ease;color:rgba(232,238,245,0.72);padding-left:0.5em"></div>' +
      '<div data-k="sub" style="position:absolute;left:0;right:0;top:calc(62% + 22px);text-align:center;font-size:8px;opacity:0;transition:opacity 1.4s ease;padding-left:0.34em"></div>' +
      '<div data-k="blk" style="position:absolute;inset:0;background:#000;opacity:0;transition:opacity 3.2s ease;pointer-events:none"></div>';
    const el = {};
    ui.querySelectorAll("[data-k]").forEach((n) => { el[n.getAttribute("data-k")] = n; });
    ctx.loadFont && ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400" }).catch(() => {});

    let msgToken = 0;
    function setMsg(text, sub) {
      const tok = ++msgToken;
      el.msg.style.opacity = "0"; el.sub.style.opacity = "0";
      if (!text) return;
      ctx.timeout(() => {
        if (tok !== msgToken) return;
        el.msg.textContent = text; el.sub.textContent = sub || "";
        el.msg.style.opacity = "1"; el.sub.style.opacity = sub ? "1" : "0";
      }, 700);
    }

    // ---------- layout & pre-rendered atmosphere ----------
    let W = ctx.width || 390, H = ctx.height || 780, cx = W / 2, cy = H / 2, MIN = Math.min(W, H), DIAG = Math.hypot(W, H);
    // Sprites are radial light profiles rasterised into ImageData -> ImageBitmap (no extra canvases).
    // Until a bitmap is ready (or where createImageBitmap is missing) they draw as live gradients.
    function rasterStops(stops, size) {
      const img = new ImageData(size, size), d = img.data, h = size / 2;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const t = Math.min(1, Math.hypot(x + 0.5 - h, y + 0.5 - h) / h);
        let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
        const [p0, c0] = stops[k], [p1, c1] = stops[k + 1], u = clamp((t - p0) / (p1 - p0 || 1), 0, 1);
        const i = (y * size + x) * 4;
        d[i] = lerp(c0[0], c1[0], u); d[i + 1] = lerp(c0[1], c1[1], u); d[i + 2] = lerp(c0[2], c1[2], u); d[i + 3] = lerp(c0[3], c1[3], u) * 255;
      }
      return img;
    }
    const canBitmap = typeof createImageBitmap === "function" && typeof ImageData === "function";
    function makeSprite(stops, size) {
      const sp = { img: null, stops, css: stops.map(([p, c]) => [p, `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`]) };
      if (canBitmap) { try { createImageBitmap(rasterStops(stops, size)).then((b) => { sp.img = b; }).catch(() => {}); } catch (e) {} }
      return sp;
    }
    function sprite(sp, x, y, size) {
      if (size <= 0) return;
      if (sp.img) { g.drawImage(sp.img, x - size / 2, y - size / 2, size, size); return; }
      const gr = g.createRadialGradient(x, y, 0, x, y, size / 2);
      for (const [p, c] of sp.css) gr.addColorStop(p, c);
      g.fillStyle = gr; g.fillRect(x - size / 2, y - size / 2, size, size);
    }
    const blob = (r, g2, b2) => makeSprite([[0, [r, g2, b2, 1]], [0.35, [r, g2, b2, 0.45]], [0.7, [r, g2, b2, 0.1]], [1, [r, g2, b2, 0]]], 128);
    const SPR_COOL = blob(92, 118, 150), SPR_TEAL = blob(80, 128, 132), SPR_WARM = blob(150, 122, 98);
    const SPR_WHITE = blob(235, 242, 255), SPR_DARK = blob(0, 0, 0);
    const SPR_RING = makeSprite([
      [0, [120, 140, 170, 0.25]], [0.3, [80, 100, 130, 0]], [0.56, [90, 115, 150, 0]], [0.66, [90, 115, 150, 0.5]],
      [0.78, [90, 115, 150, 0]], [0.9, [70, 90, 120, 0.22]], [1, [0, 0, 0, 0]]
    ], 256);

    let grainPattern = null;
    if (canBitmap) {
      try {
        const img = new ImageData(128, 128), r = rng(5);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = r() * 255;
          img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = r() < 0.5 ? 255 : 0;
        }
        createImageBitmap(img).then((b) => { try { grainPattern = g.createPattern(b, "repeat"); } catch (e) {} }).catch(() => {});
      } catch (e) {}
    }

    // The dark room: a low-resolution field of light falloff and tonal drift, upscaled smoothly.
    let bgImg = null, bgToken = 0;
    function buildBackground() {
      if (!canBitmap) return;
      const tok = ++bgToken;
      const bw = 90, bh = Math.max(2, Math.round((90 * H) / Math.max(1, W)));
      const img = new ImageData(bw, bh), d = img.data, r = rng(99);
      const blobs = [];
      for (let i = 0; i < 5; i++) blobs.push({ x: r() * bw, y: r() * bh, rad: (0.3 + r() * 0.5) * Math.max(bw, bh), c: [10 + r() * 6, 12 + r() * 6, 16 + r() * 8] });
      const R = Math.hypot(bw, bh) * 0.62;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const t = Math.min(1, Math.hypot(x - bw * 0.5, y - bh * 0.47) / R);
        let cr, cg, cb;
        if (t < 0.45) { const u = t / 0.45; cr = lerp(15, 8, u); cg = lerp(18, 10, u); cb = lerp(24, 13, u); }
        else { const u = (t - 0.45) / 0.55; cr = lerp(8, 1, u); cg = lerp(10, 1, u); cb = lerp(13, 2, u); }
        for (const b of blobs) {
          const q = Math.max(0, 1 - Math.hypot(x - b.x, y - b.y) / b.rad) * 0.3;
          cr += b.c[0] * q; cg += b.c[1] * q; cb += b.c[2] * q;
        }
        const i = (y * bw + x) * 4;
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255;
      }
      try { createImageBitmap(img).then((b) => { if (tok === bgToken) bgImg = b; }).catch(() => {}); } catch (e) {}
    }
    function drawBackground() {
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      if (bgImg) { g.imageSmoothingEnabled = true; g.drawImage(bgImg, 0, 0, W, H); return; }
      const gr = g.createRadialGradient(cx, H * 0.47, 0, cx, H * 0.47, DIAG * 0.62);
      gr.addColorStop(0, "rgb(15,18,24)"); gr.addColorStop(0.45, "rgb(8,10,13)"); gr.addColorStop(1, "rgb(1,1,2)");
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }

    ctx.onResize((info) => {
      W = info.width || W; H = info.height || H;
      cx = W / 2; cy = H / 2; MIN = Math.min(W, H); DIAG = Math.hypot(W, H);
      const top = Math.max(14, (info.safeArea && info.safeArea.top) || 0) + 6;
      el.tl.style.top = top + "px"; el.tr.style.top = top + "px";
      buildBackground();
    }, { immediate: true });

    // ---------- world state ----------
    const world = { th: 0, om: 0, finger: 0, dragging: false, thNear: 0, thFar: 0, thHaze: 0, th0: 0, lastPX: 0, lastPY: 0 };
    const cam = { x: 0, y: 0 };
    const ball = {
      x: 0, y: 0, vx: 0, vy: 0, z: 0, strand: 0, idx: 0, s: 0, d: 0, tx: 1, ty: 0,
      offT: 0, sink: 0, grooved: true, inGap: false, align: 1, instab: 0, alignHold: 0, fade: 1, scale: 1
    };
    let lvIndex = 0, lv = LEVELS[0], strands = [], status = "ready", statusT = 0, levelT = 0, globalT = 0;
    let attempts = 0, alignAccum = 0, alignSamples = 0, pathAlpha = 1, lit = 1, memVis = 1, playT = 0;
    let firstEverTouch = true, pathSeenFrom = 0;
    let haze = [], motes = [], ghosts = [], curGhost = [], ghostTimer = 0;
    const history = []; let histTimer = 0;
    const particles = []; for (let i = 0; i < 90; i++) particles.push({ life: 0 });
    let frag = null;
    let quality = 1, lowFpsT = 0;
    let prevBX = 0, prevBY = 0, haveBPrev = false;
    let spinTotal = 0;

    function setupAtmosphere() {
      const r = rng(1000 + lvIndex * 17);
      haze = [];
      const n = lv.symmetric ? 0 : 7;
      for (let i = 0; i < n; i++) {
        haze.push({
          a: r() * TAU, rad: (0.12 + r() * 0.55) * DIAG, size: (0.55 + r() * 0.8) * DIAG,
          spr: r() < 0.5 ? SPR_COOL : r() < 0.8 ? SPR_TEAL : SPR_WARM,
          alpha: 0.05 + r() * 0.07, drift: (r() - 0.5) * 0.04, ph: r() * TAU
        });
      }
      motes = [];
      if (!lv.symmetric) for (let i = 0; i < 46; i++) motes.push({ a: r() * TAU, rad: Math.sqrt(r()) * 0.75 * DIAG, depth: 0.2 + r() * 0.8, tw: r() * TAU, sz: 0.4 + r() * 0.9 });
    }

    function scale() {
      if (lv.fixedCam) return (MIN * 0.41) / (lv.rose.R + lv.rose.A);
      return MIN / 520;
    }

    // Project a world point (with depth) onto the screen through the current rotation.
    const P = { x: 0, y: 0, k: 1 };
    let cosT = 1, sinT = 0, SC = 1, parX = 0, parY = 0;
    function beginProjection() {
      cosT = Math.cos(world.th); sinT = Math.sin(world.th); SC = scale();
      if (lv.depth) {
        parX = 16 * Math.cos(world.thFar * 1.3 + 0.7) - world.om * 4;
        parY = 16 * Math.sin(world.thFar * 1.3 + 0.7);
      } else { parX = 0; parY = 0; }
    }
    function project(x, y, z) {
      const dx = x - cam.x, dy = y - cam.y, k = SC / (1 + 0.24 * z);
      P.x = cx + (cosT * dx - sinT * dy) * k + z * parX;
      P.y = cy + (sinT * dx + cosT * dy) * k + z * parY;
      P.k = k;
      return P;
    }

    function tangentAt(st, i) {
      const a = Math.max(0, i - 1), b = Math.min(st.n - 1, i + 1);
      const dx = st.x[b] - st.x[a], dy = st.y[b] - st.y[a], L = Math.hypot(dx, dy) || 1;
      return { x: dx / L, y: dy / L };
    }

    function loadLevel(i) {
      lvIndex = clamp(i, 0, NLEV - 1); lv = LEVELS[lvIndex];
      strands = lv.build();
      strands.forEach((s, k) => { s.id = k; });
      setupAtmosphere();
      ghosts = []; attempts = 0;
      el.tr.textContent = String(lvIndex + 1).padStart(2, "0");
      const hideUi = !!lv.noUi;
      el.tl.style.opacity = hideUi ? "0" : "1"; el.tr.style.opacity = hideUi ? "0" : "1";
      resetBall(true);
    }

    function resetBall(snapWorld) {
      const st = strands[0], t = tangentAt(st, 0);
      ball.x = st.x[0] + t.x * 6; ball.y = st.y[0] + t.y * 6; ball.vx = 0; ball.vy = 0;
      ball.strand = 0; ball.idx = 1; ball.s = 6; ball.d = 0; ball.z = st.z[0];
      ball.offT = 0; ball.sink = 0; ball.grooved = true; ball.inGap = false; ball.fade = 1; ball.scale = 1;
      ball.align = 1; ball.instab = 0; ball.alignHold = 0; ball.tx = t.x; ball.ty = t.y;
      world.th0 = -Math.atan2(t.y, t.x);
      if (snapWorld) {
        world.th = world.th0; world.om = 0; world.thNear = world.th * 0.99; world.thFar = world.th * 0.96; world.thHaze = world.th;
      }
      if (lv.fixedCam) { cam.x = 0; cam.y = 0; }
      else if (snapWorld) { cam.x = ball.x + t.x * 50; cam.y = ball.y + t.y * 50; }
      history.length = 0; curGhost = []; haveBPrev = false;
      alignAccum = 0; alignSamples = 0; playT = 0; memVis = 1; spinTotal = 0;
    }

    // ---------- path tracking ----------
    const Q = { d2: 0, i: 0, t: 0, raw: 0, px: 0, py: 0, st: null };
    function search(st, i0, i1, x, y, out) {
      i0 = Math.max(0, i0); i1 = Math.min(st.n - 2, i1);
      for (let i = i0; i <= i1; i++) {
        const ax = st.x[i], ay = st.y[i], dx = st.x[i + 1] - ax, dy = st.y[i + 1] - ay;
        const L2 = dx * dx + dy * dy || 1;
        const raw = ((x - ax) * dx + (y - ay) * dy) / L2, t = clamp(raw, 0, 1);
        const px = ax + dx * t, py = ay + dy * t, d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (d2 < out.d2) { out.d2 = d2; out.i = i; out.t = t; out.raw = raw; out.px = px; out.py = py; out.st = st; }
      }
    }
    function track() {
      Q.d2 = Infinity; Q.st = null;
      const st = strands[ball.strand];
      search(st, ball.idx - 10, ball.idx + 10, ball.x, ball.y, Q);
      const curBest = Q.d2;
      if (ball.idx > st.n - 18) for (const nx of st.next) search(strands[nx], 0, 16, ball.x, ball.y, Q);
      if (st.parent >= 0 && ball.idx < 70) {
        for (const sib of strands[st.parent].next) if (sib !== st.id) search(strands[sib], ball.idx - 12, ball.idx + 12, ball.x, ball.y, Q);
        if (ball.idx < 12) { const p = strands[st.parent]; search(p, p.n - 16, p.n - 2, ball.x, ball.y, Q); }
      }
      if (Q.st !== st && Q.d2 > curBest - 0.01) { Q.d2 = Infinity; search(st, ball.idx - 10, ball.idx + 10, ball.x, ball.y, Q); }
      ball.strand = Q.st.id; ball.idx = Q.i;
      return Q;
    }

    // ---------- physics ----------
    const W_GROOVE = 7;
    function physics(dt) {
      const G = GRAVITY;
      const gx = G * Math.sin(world.th), gy = G * Math.cos(world.th);
      let ax = gx, ay = gy;
      const q = track(), st = q.st, i = q.i;
      const dx = st.x[i + 1] - st.x[i], dy = st.y[i + 1] - st.y[i], L = Math.hypot(dx, dy) || 1;
      const tx = dx / L, ty = dy / L, nx = -ty, ny = tx;
      const d = (ball.x - q.px) * nx + (ball.y - q.py) * ny;
      const dist = Math.sqrt(q.d2);
      ball.tx = tx; ball.ty = ty; ball.z = lerp(st.z[i], st.z[i + 1], q.t);
      ball.s = st.s[i] + L * q.t;

      const pastEnd = i === st.n - 2 && q.raw > 1;
      const beforeStart = st.id === 0 && i === 0 && q.raw < 0;
      const gap = st.segGap[i] === 1;
      ball.inGap = gap;
      let grooved = !gap && !(pastEnd && !st.next.length);
      if (beforeStart) {
        // the filament begins at a node: a soft stop
        const vt = ball.vx * tx + ball.vy * ty;
        if (vt < 0) { ball.vx -= vt * tx * 1.2; ball.vy -= vt * ty * 1.2; }
        ball.x += (st.x[0] - ball.x) * 0.2 * (tx * tx); ball.y += (st.y[0] - ball.y) * 0.2 * (ty * ty);
      }
      ball.grooved = grooved;
      if (grooved) {
        const cradle = st.id === 0 && ball.s < 40 ? 3.2 : 1;
        const fmax = lv.hold * HOLD * G * cradle;
        const f = -fmax * (d / W_GROOVE) * Math.exp(0.5 - (d * d) / (2 * W_GROOVE * W_GROOVE));
        ax += nx * f; ay += ny * f;
        const vn = ball.vx * nx + ball.vy * ny, vt = ball.vx * tx + ball.vy * ty;
        const near = Math.exp(-(d * d) / (2 * 196));
        ax -= nx * vn * 10 * near; ay -= ny * vn * 10 * near;
        const drag = (0.18 * vt + (G / 23000) * vt * Math.abs(vt)) * near;
        ax -= tx * drag; ay -= ty * drag;
        if (cradle > 1 && Math.abs(gx * tx + gy * ty) < 22) { ax -= tx * vt * 4; ay -= ty * vt * 4; }
      } else {
        ax -= ball.vx * 0.12; ay -= ball.vy * 0.12;
      }
      ball.vx += ax * dt; ball.vy += ay * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      ball.d = grooved ? d : dist;

      // gaps: the ball sinks through the plate unless momentum carries it across
      if (gap) ball.sink += dt * 1.05; else ball.sink = Math.max(0, ball.sink - dt * 3);

      const a = grooved ? Math.exp(-(d * d) / (W_GROOVE * W_GROOVE * 1.4)) : gap ? 0.6 : 0;
      ball.align = a;
      const gperp = Math.abs(gx * nx + gy * ny) / G;
      const target = clamp(Math.abs(ball.d) / (W_GROOVE * 1.7) + Math.max(0, gperp - 0.35) * 0.9, 0, 1);
      ball.instab += (target - ball.instab) * damp(6, dt);
      ball.alignHold = a > 0.93 && !gap ? ball.alignHold + dt : Math.max(0, ball.alignHold - dt * 2);

      if (!gap && (Math.abs(ball.d) > W_GROOVE * 3.3 || !grooved)) ball.offT += dt; else ball.offT = 0;

      if (st.final && pastEnd && dist < W_GROOVE * 2.5) return "aligned";
      if (st.final && ball.s > st.len - 3 && Math.abs(d) < W_GROOVE * 2.5) return "aligned";
      if (ball.sink >= 1) return "sank";
      if (ball.offT > 1.05) return "slipped";
      return null;
    }

    function freePhysics(dt) {
      const G = GRAVITY;
      ball.vx += (G * Math.sin(world.th) - ball.vx * 0.1) * dt;
      ball.vy += (G * Math.cos(world.th) - ball.vy * 0.1) * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    }

    function worldStep(dt) {
      const I = (lv.inertia || 1) * INERTIA;
      const zeta = lv.zeta || 1, K = 420;
      let acc;
      if (world.dragging && (status === "play" || status === "ready" || status === "failing")) {
        const C = 2 * Math.sqrt(K * I) * zeta;
        acc = (K * (world.finger - world.th) - C * world.om) / I;
      } else {
        acc = -(lv.spinDamp || 1.8) * world.om;
        if (status === "ready") {
          // between attempts the plate settles back to where it began
          let d = world.th0 - world.th;
          d -= TAU * Math.round(d / TAU);
          acc += d * 5 - world.om * 3;
        }
      }
      if (lv.auto && status === "play") {
        const t = levelT;
        acc += (lv.auto * (Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.83 + 1.3) * 0.6 + 0.35)) / I;
      }
      if (status === "aligned" || status === "transition" || status === "end") acc = -6 * world.om;
      world.om = clamp(world.om + acc * dt, -14, 14);
      const before = world.th;
      world.th += world.om * dt;
      spinTotal += world.th - before;
    }

    // ---------- sound ----------
    const audio = { ac: null, ok: false };
    function initAudio() {
      if (audio.ac) { if (audio.ac.state === "suspended") audio.ac.resume().catch(() => {}); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC(); audio.ac = ac;
        const master = ac.createGain(); master.gain.value = 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
        master.connect(comp); comp.connect(ac.destination);
        // generated room
        const rev = ac.createConvolver(), irLen = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, irLen, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2); }
        rev.buffer = ir;
        const revGain = ac.createGain(); revGain.gain.value = 0.55; rev.connect(revGain); revGain.connect(master);
        const bus = ac.createGain(); bus.connect(master); bus.connect(rev);

        const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
        // ambient bed
        const bed = ac.createGain(); bed.gain.value = 0.0; const bedLp = ac.createBiquadFilter(); bedLp.type = "lowpass"; bedLp.frequency.value = 420;
        bed.connect(bedLp); bedLp.connect(bus);
        const d1 = osc("sine", 55), d2 = osc("sine", 82.6), d3 = osc("triangle", 110.3);
        const d3g = ac.createGain(); d3g.gain.value = 0.18;
        d1.connect(bed); d2.connect(bed); d3.connect(d3g); d3g.connect(bed);
        const lfo = osc("sine", 0.05), lfoG = ac.createGain(); lfoG.gain.value = 0.012; lfo.connect(lfoG); lfoG.connect(bed.gain);

        // the ball's voice
        const voice = ac.createGain(); voice.gain.value = 0;
        const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (pan) { voice.connect(pan); pan.connect(bus); } else voice.connect(bus);
        const vA = osc("sine", 196), vB = osc("sine", 294), vC = osc("sine", 392);
        const gA = ac.createGain(), gB = ac.createGain(), gC = ac.createGain();
        gA.gain.value = 0.55; gB.gain.value = 0.3; gC.gain.value = 0;
        vA.connect(gA); vB.connect(gB); vC.connect(gC); gA.connect(voice); gB.connect(voice); gC.connect(voice);

        // rotation: grains and rushing air
        const nbuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nbuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const noise = ac.createBufferSource(); noise.buffer = nbuf; noise.loop = true; noise.start();
        const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.7;
        const rush = ac.createGain(); rush.gain.value = 0; noise.connect(bp); bp.connect(rush); rush.connect(bus);
        const glen = ac.sampleRate * 3, gbuf = ac.createBuffer(1, glen, ac.sampleRate), gd = gbuf.getChannelData(0);
        const notes = [880, 987.8, 1174.7, 1318.5, 1568, 1760, 1975.5, 2349.3];
        for (let k = 0; k < 70; k++) {
          const at = Math.floor(Math.random() * (glen - 3000)), f = notes[k % notes.length] * (Math.random() < 0.3 ? 0.5 : 1);
          const len = 900 + Math.floor(Math.random() * 1500), amp = 0.2 + Math.random() * 0.5;
          for (let i = 0; i < len; i++) gd[at + i] += Math.sin((TAU * f * i) / ac.sampleRate) * amp * Math.sin((Math.PI * i) / len) ** 2;
        }
        const grains = ac.createBufferSource(); grains.buffer = gbuf; grains.loop = true; grains.start();
        const grainG = ac.createGain(); grainG.gain.value = 0; grains.connect(grainG); grainG.connect(bus);

        Object.assign(audio, { ok: true, master, bus, bed, voice, pan, vA, vB, vC, gC, rush, bp, grains, grainG });
        ctx.onDestroy(() => { try { ac.close(); } catch (e) {} });
      } catch (e) { audio.ok = false; }
    }
    function setP(p, v, tc = 0.08) { try { p.setTargetAtTime(v, audio.ac.currentTime, tc); } catch (e) {} }
    function chime(freq, gain = 0.12, dur = 5) {
      if (!audio.ok) return;
      const ac = audio.ac, t = ac.currentTime;
      [[1, 1], [2, 0.28], [3.01, 0.08]].forEach(([m, a]) => {
        const o = ac.createOscillator(), gn = ac.createGain();
        o.type = "sine"; o.frequency.value = freq * m;
        gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(gain * a, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
        o.connect(gn); gn.connect(audio.bus); o.start(t); o.stop(t + dur + 0.1);
      });
    }
    const SCALE = [0, 2, 4, 7, 9];
    const baseFreq = () => { const k = lv.key; return 146.83 * Math.pow(2, (Math.floor(k / 5) * 12 + SCALE[k % 5]) / 12 / 1.5); };
    let audioTick = 0;
    function updateAudio(dt) {
      if (!audio.ok) return;
      audioTick += dt; if (audioTick < 0.033) return; audioTick = 0;
      const playing = status === "play" || status === "ready";
      const masterV = status === "failing" ? 0 : status === "end" && statusT > 3 ? 0 : 0.9 * VOLUME;
      setP(audio.master.gain, masterV, status === "failing" ? 0.45 : 0.6);
      setP(audio.bed.gain, status === "aligned" ? 0.02 : 0.05, 1.2);
      const speed = Math.hypot(ball.vx, ball.vy);
      const f0 = baseFreq();
      const present = status === "play" ? 0.05 + 0.07 * clamp(speed / 160, 0, 1) : status === "ready" ? 0.03 : 0;
      setP(audio.voice.gain, present * (1 - ball.sink * 0.8), 0.15);
      setP(audio.vA.frequency, f0);
      const wobble = ball.instab * (18 + 14 * Math.sin(globalT * 7.3));
      setP(audio.vB.frequency, f0 * 1.5 * Math.pow(2, wobble / 1200), 0.05);
      setP(audio.vC.frequency, f0 * 2 * Math.pow(2, (ball.instab * 9) / 1200));
      setP(audio.gC.gain, playing ? clamp((ball.alignHold - 0.6) / 1.6, 0, 1) * 0.5 : 0, 0.4);
      if (audio.pan) setP(audio.pan.pan, clamp((prevBX - cx) / (W * 0.6), -0.8, 0.8));
      const w = Math.abs(world.om);
      setP(audio.rush.gain, Math.pow(clamp((w - 1.2) / 6, 0, 1), 1.5) * 0.16);
      setP(audio.bp.frequency, 280 + w * 260);
      setP(audio.grainG.gain, clamp(w / 1.4, 0, 1) * (1 - clamp((w - 3) / 4, 0, 1)) * 0.07);
      try { audio.grains.playbackRate.setTargetAtTime(0.8 + w * 0.12, audio.ac.currentTime, 0.1); } catch (e) {}
    }

    // ---------- progress ----------
    const prog = ctx.game && ctx.game.progress;
    function saveProgress(next) {
      if (!prog || !prog.save) return;
      try {
        prog.save("main", { state: { level: next }, label: "World " + String(next + 1).padStart(2, "0"), percent: Math.round((next / NLEV) * 100), stateSchemaVersion: 1 }).catch(() => {});
      } catch (e) {}
    }

    // ---------- state transitions ----------
    function setStatus(s) { status = s; statusT = 0; }

    function beginAttempt() {
      attempts++;
      try { ctx.platform.start({ level: lvIndex + 1, attempt: attempts }); } catch (e) {}
      initAudio();
      setStatus("play");
      if (firstEverTouch && lvIndex === 0) {
        firstEverTouch = false;
        setMsg("");
        ctx.timeout(() => { if (status === "play" && lvIndex === 0) setMsg("KEEP THE BALL ON THE LINE"); }, 1400);
        ctx.timeout(() => { if (lvIndex === 0 && el.msg.textContent === "KEEP THE BALL ON THE LINE") setMsg(""); }, 6200);
      } else setMsg("");
      pathSeenFrom = globalT;
    }

    function fail(kind) {
      setStatus("failing");
      if (curGhost.length > 6) { ghosts.push({ pts: new Float32Array(curGhost), born: globalT }); if (ghosts.length > 7) ghosts.shift(); }
      curGhost = [];
      try { ctx.platform.fail({ level: lvIndex + 1, reason: kind }); } catch (e) {}
      ball.failKind = kind;
    }

    function restart() {
      resetBall(false);
      ball.finalAlign = 0;
      setStatus("ready");
      setMsg("");
    }

    function succeed() {
      setStatus("aligned");
      const score = alignSamples ? Math.round((alignAccum / alignSamples) * 100) : 100;
      ball.finalAlign = score;
      chime(baseFreq() * 2, 0.11, 6);
      try { ctx.platform.milestone("aligned", { level: lvIndex + 1, alignment: score, attempts }); } catch (e) {}
      try { ctx.platform.setProgress((lvIndex + 1) / NLEV); } catch (e) {}
      if (lv.final) {
        ctx.timeout(() => setMsg("ORIENTED."), 1800);
        if (prog && prog.complete) { try { prog.complete("main").catch(() => {}); } catch (e) {} }
      } else {
        ctx.timeout(() => { if (status === "aligned") setMsg("ALIGNED", lv.noUi ? "" : "ALIGNMENT " + score); }, 1500);
        saveProgress(lvIndex + 1);
      }
    }

    // Dissolve the finished path into light fragments that re-form as the next world.
    function beginTransition() {
      setMsg("");
      const N = quality ? 260 : 150;
      const from = samplePathScreen(N);
      const bFrom = { x: prevBX, y: prevBY };
      loadLevel(lvIndex + 1);
      beginProjection();
      const to = samplePathScreen(N);
      const b0 = project(ball.x, ball.y, ball.z);
      const r = rng(lvIndex * 31 + 3);
      frag = { from, to, n: N, bFrom, bTo: { x: b0.x, y: b0.y }, delay: new Float32Array(N).map(() => r() * 0.55), curl: new Float32Array(N).map(() => (r() - 0.5) * 120) };
      setStatus("transition");
    }
    function samplePathScreen(N) {
      beginProjection();
      let total = 0; for (const s of strands) total += s.len;
      const out = new Float32Array(N * 2);
      for (let k = 0; k < N; k++) {
        let s = (k / N) * total, st = strands[0];
        for (const q of strands) { if (s <= q.len) { st = q; break; } s -= q.len; }
        const i = Math.min(st.n - 1, Math.round(s / STEP));
        project(st.x[i], st.y[i], st.z[i]);
        out[k * 2] = P.x; out[k * 2 + 1] = P.y;
      }
      return out;
    }

    // ---------- input ----------
    const input = ctx.input.track(canvas, { multitouch: false });
    let steerOverride = false, lastInteract = -10;
    function readInput(dt) {
      if (steerOverride) return;
      const down = !!input.down;
      const edge = !!(input.pressed || input.tap);
      const px = input.x, py = input.y;
      if (edge && !down && !world.dragging) {
        // a press and release inside one frame: still counts as a touch
        if (status === "ready") beginAttempt();
        else if (status === "failing" && statusT > 2.0) restart();
        else if (status === "end" && statusT > 7) { loadLevel(0); firstEverTouch = false; el.blk.style.opacity = "0"; setStatus("ready"); setMsg(""); }
      }
      if (down && !world.dragging) {
        world.dragging = true; world.finger = world.th; world.lastPX = px; world.lastPY = py;
        if (status === "ready") beginAttempt();
        else if (status === "failing" && statusT > 2.0) restart();
        else if (status === "end" && statusT > 7) { loadLevel(0); firstEverTouch = false; el.blk.style.opacity = "0"; setStatus("ready"); setMsg(""); }
      } else if (down) {
        const ddx = px - world.lastPX, ddy = py - world.lastPY;
        const rx = (px + world.lastPX) / 2 - cx, ry = (py + world.lastPY) / 2 - cy;
        const r = Math.hypot(rx, ry), R0 = MIN * 0.2;
        const circ = (rx * ddy - ry * ddx) / Math.max(r * r, R0 * R0);
        const w = smooth(MIN * 0.07, MIN * 0.28, r);
        const dphi = (w * circ + (1 - w) * ddx * (3.2 / W)) * SENS;
        world.finger += dphi;
        world.lastPX = px; world.lastPY = py;
        if (Math.abs(dphi) > 0.002 && status === "play" && globalT - lastInteract > 2) { lastInteract = globalT; try { ctx.platform.interact({ type: "rotate" }); } catch (e) {} }
      } else {
        world.dragging = false;
      }
    }

    // ---------- debug hook for local harnesses only ----------
    const DBG = typeof window !== "undefined" && window.__ORIENT_DEBUG__;
    if (DBG) {
      DBG.api = {
        get: () => ({ status, lvIndex, ball, world, strands, levelT }),
        steer(on) { steerOverride = on; world.dragging = on; if (on) world.finger = world.th; },
        setFinger(v) { world.finger = v; },
        start() { if (status === "ready") beginAttempt(); else if (status === "failing") restart(); },
        jump(i) { loadLevel(i); setStatus("ready"); }
      };
    }

    // ---------- rendering ----------
    const PATH_CORE = "rgb(226,236,248)", PATH_HALO = "rgb(150,182,220)", PATH_FIELD = "rgb(98,130,172)";

    function drawAtmosphere(t) {
      drawBackground();
      g.globalCompositeOperation = "lighter";
      const hz = HAZE * (status === "aligned" ? 0.8 : 1);
      if (lv.symmetric) {
        const s = DIAG * 0.95;
        g.globalAlpha = 0.16 * hz; sprite(SPR_RING, cx, cy, s);
        const s2 = MIN * 1.25; g.globalAlpha = 0.1 * hz; sprite(SPR_RING, cx, cy, s2);
      }
      const nb = quality ? haze.length : Math.min(3, haze.length);
      for (let i = 0; i < nb; i++) {
        const h = haze[i];
        const a = h.a + (lv.final ? t * h.drift * 2 : world.thFar) + Math.sin(t * 0.05 + h.ph) * 0.1;
        const x = cx + Math.cos(a) * h.rad, y = cy + Math.sin(a) * h.rad;
        g.globalAlpha = h.alpha * hz * (0.8 + 0.2 * Math.sin(t * 0.11 + h.ph));
        sprite(h.spr, x, y, h.size);
      }
      // horizon: a faint luminous band of denser air
      if (lv.horizon !== "none") {
        const ang = lv.horizon === "world" ? world.thFar : 0;
        g.save(); g.translate(cx, cy + (lv.horizon === "stable" ? MIN * 0.08 : 0)); g.rotate(ang);
        const bh = MIN * 0.5;
        const gr = g.createLinearGradient(0, -bh, 0, bh);
        gr.addColorStop(0, "rgba(90,110,135,0)"); gr.addColorStop(0.47, "rgba(96,116,142,0.07)");
        gr.addColorStop(0.5, "rgba(130,150,172,0.1)"); gr.addColorStop(0.56, "rgba(40,50,64,0.05)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = HAZE; g.fillStyle = gr; g.fillRect(-DIAG, -bh, DIAG * 2, bh * 2);
        g.globalAlpha = 0.05 * HAZE; g.fillStyle = "rgb(170,186,205)"; g.fillRect(-DIAG, -0.25, DIAG * 2, 0.5);
        g.restore();
      }
      // optical haze: a slow bloom trailing the ball
      const hs = MIN * 0.9;
      g.globalAlpha = 0.05 * HAZE * pathAlpha;
      sprite(SPR_COOL, hazeX, hazeY, hs);
    }
    let hazeX = 0, hazeY = 0;

    function drawMotes(t) {
      if (!quality || !motes.length) return;
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "rgb(200,214,232)";
      const camShiftX = cam.x * SC, camShiftY = cam.y * SC;
      for (const m of motes) {
        const a = m.a + world.thNear * (0.9 + m.depth * 0.1);
        let x = cx + Math.cos(a) * m.rad, y = cy + Math.sin(a) * m.rad;
        // parallax against camera travel, wrapped to the screen
        x = ((x - camShiftX * m.depth * 0.25 * cosT + camShiftY * m.depth * 0.25 * sinT) % W + W) % W;
        y = ((y - camShiftX * m.depth * 0.25 * sinT - camShiftY * m.depth * 0.25 * cosT) % H + H) % H;
        g.globalAlpha = (0.05 + 0.08 * m.depth) * (0.6 + 0.4 * Math.sin(t * 0.7 + m.tw)) * HAZE;
        g.fillRect(x, y, m.sz, m.sz);
      }
    }

    function drawGhosts() {
      if (!ghosts.length) return;
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round"; g.lineJoin = "round";
      for (let k = 0; k < ghosts.length; k++) {
        const gh = ghosts[k], pts = gh.pts, age = globalT - gh.born;
        const fresh = Math.exp(-age / 5);
        const base = (0.035 + 0.1 * fresh) * (0.55 + 0.45 * ((k + 1) / ghosts.length)) * pathAlpha;
        if (base < 0.004) continue;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 3) {
          project(pts[i], pts[i + 1], pts[i + 2]);
          if (i === 0) g.moveTo(P.x, P.y); else g.lineTo(P.x, P.y);
        }
        g.strokeStyle = "rgb(210,180,150)";
        g.globalAlpha = base * 0.35; g.lineWidth = 9; g.stroke();
        g.setLineDash([0.5, 5]); g.globalAlpha = base; g.lineWidth = 1.1; g.stroke(); g.setLineDash([]);
      }
    }

    const CH = 9;
    function chunkAlpha(st, i, t) {
      let a = pathAlpha;
      if (st.dead) a *= 1 - smooth(st.len * 0.2, st.len * 0.95, st.s[i]);
      const flick = lv.flicker || 0.14;
      if (status !== "aligned") a *= 1 - flick * (0.5 + 0.5 * noise1(st.s[i] * 0.005 + t * 0.06 + st.id * 3.7)) * (0.6 + 0.4 * noise1(t * 0.13 + 9));
      const dx = st.x[i] - ball.x, dy = st.y[i] - ball.y, dd = dx * dx + dy * dy;
      const nearGlow = Math.exp(-dd / (80 * 80));
      if (lv.memory) a *= memVis + (1 - memVis) * Math.max(Math.exp(-dd / (58 * 58)) * 0.75, 0);
      a *= 1 + nearGlow * (0.35 + ball.instab * 0.7);
      return a * lit;
    }

    function drawPaths(t, dt) {
      g.globalCompositeOperation = "lighter";
      g.lineCap = "butt"; g.lineJoin = "round";
      const speedN = clamp(Math.hypot(ball.vx, ball.vy) / 170, 0, 1);
      const breathe = 1 + 0.5 * speedN + 0.9 * ball.instab;
      const coreW = clamp(0.7 * breathe * (status === "aligned" ? 1.25 : 1), 0.6, 2.4);
      const haloW = 3.6 + 3.2 * ball.instab + 1.2 * speedN;
      const fieldW = 15 + 8 * ball.instab;
      const shake = status === "play" ? ball.instab : 0;
      const chunks = [];
      for (const st of strands) {
        const ballStrand = st.id === ball.strand;
        for (let i = 0; i < st.n; i++) {
          project(st.x[i], st.y[i], st.z[i]);
          let sx = P.x, sy = P.y;
          if (shake > 0.05 && ballStrand) {
            const ds = st.s[i] - ball.s, fall = Math.exp(-(ds * ds) / (70 * 70));
            if (fall > 0.02) {
              const tn = tangentAt(st, i), nxs = -(sinT * tn.x + cosT * tn.y), nys = cosT * tn.x - sinT * tn.y;
              const amp = shake * shake * 2.4 * fall * Math.sin(t * 41 + st.s[i] * 0.23) + shake * 0.8 * fall * Math.sin(t * 13 - st.s[i] * 0.05);
              sx += nxs * amp; sy += nys * amp;
            }
          }
          st.sx[i] = sx; st.sy[i] = sy;
        }
        for (let i = 0; i < st.n - 1; i += CH) {
          const j = Math.min(st.n - 1, i + CH);
          let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
          for (let k = i; k <= j; k++) { const x = st.sx[k], y = st.sy[k]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
          if (maxx < -30 || minx > W + 30 || maxy < -30 || miny > H + 30) continue;
          const a = chunkAlpha(st, Math.min(st.n - 1, i + (CH >> 1)), t);
          if (a < 0.01) continue;
          chunks.push({ st, i, j, a, z: st.z[i + ((j - i) >> 1)] });
        }
      }
      if (lv.depth) chunks.sort((p, q) => q.z - p.z);
      const trace = (c) => {
        const st = c.st; let open = false;
        g.beginPath();
        for (let k = c.i; k <= c.j; k++) {
          if (k > c.i && st.segGap[k - 1]) { open = false; continue; }
          if (!open) { g.moveTo(st.sx[k], st.sy[k]); open = true; } else g.lineTo(st.sx[k], st.sy[k]);
        }
      };
      const layer = (c, color, width, alpha) => { g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha; g.stroke(); };
      if (lv.depth) {
        // depth-sorted so nearer filament occludes the one passing behind
        for (const c of chunks) {
          const zf = 1 - 0.45 * clamp((c.z + 1) / 2, 0, 1), k = 1 / (1 + 0.24 * c.z);
          trace(c);
          if (c.z < -0.25) {
            g.globalCompositeOperation = "source-over";
            layer(c, "rgb(6,7,10)", 6 * k, 0.7 * smooth(-0.25, -0.7, c.z));
            g.globalCompositeOperation = "lighter";
          }
          if (quality) layer(c, PATH_FIELD, fieldW * k * 1.2, 0.03 * c.a * zf);
          layer(c, PATH_HALO, haloW * k * (1.6 - zf * 0.6), 0.1 * c.a * zf);
          layer(c, PATH_CORE, coreW * k, clamp(0.78 * c.a * zf * zf, 0, 1));
        }
      } else {
        if (quality) for (const c of chunks) { trace(c); layer(c, PATH_FIELD, fieldW, 0.026 * c.a); }
        for (const c of chunks) { trace(c); layer(c, PATH_HALO, haloW, 0.07 * c.a); }
        for (const c of chunks) { trace(c); layer(c, PATH_CORE, coreW, clamp(0.5 * c.a, 0, 1)); }
      }
      // gap edges glow faintly where the filament is severed
      g.globalCompositeOperation = "lighter";
      for (const st of strands) {
        for (let i = 0; i < st.n - 2; i++) {
          if (st.segGap[i] !== st.segGap[i + 1]) {
            const k = st.segGap[i] ? i + 1 : i + 1;
            const s = 16; g.globalAlpha = 0.18 * pathAlpha * lit;
            sprite(SPR_WHITE, st.sx[k], st.sy[k], s);
          }
        }
      }
    }

    function spawnParticles(dt) {
      if (status !== "play" || ball.instab < 0.35 || !quality) return;
      let n = (ball.instab - 0.35) * 60 * dt;
      while (n > 0) {
        if (Math.random() > n) break; n -= 1;
        const p = particles.find((q) => q.life <= 0); if (!p) return;
        const off = (Math.random() - 0.5) * 50;
        p.x = ball.x - ball.tx * off - ball.ty * ball.d * 0.3; p.y = ball.y - ball.ty * off + ball.tx * ball.d * 0.3; p.z = ball.z;
        const sp = 6 + Math.random() * 16, sgn = Math.random() < 0.5 ? -1 : 1;
        p.vx = -ball.ty * sp * sgn + (Math.random() - 0.5) * 6; p.vy = ball.tx * sp * sgn + (Math.random() - 0.5) * 6;
        p.life = p.max = 0.6 + Math.random() * 0.8;
      }
    }
    function drawParticles(dt) {
      g.globalCompositeOperation = "lighter"; g.fillStyle = PATH_CORE;
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= 0.98;
        project(p.x, p.y, p.z);
        g.globalAlpha = 0.5 * (p.life / p.max) * pathAlpha;
        g.fillRect(P.x - 0.5, P.y - 0.5, 1.1, 1.1);
      }
    }

    function drawBall(t, dt) {
      if (status === "transition") return;
      project(ball.x, ball.y, ball.z);
      const bx = P.x, by = P.y, k = P.k / scale();
      const speed = Math.hypot(ball.vx, ball.vy), w = Math.abs(world.om);
      const vis = ball.fade * (1 - ball.sink * 0.85);
      if (vis <= 0.005) { prevBX = bx; prevBY = by; return; }
      const core = clamp(MIN / 150, 2.1, 3.6) * k * ball.scale * (1 - ball.sink * 0.5);

      // afterimages: recent positions, re-projected through a lagging rotation so they bend with the world
      if (history.length > 2 && (w > 0.9 || speed > 120)) {
        const amt = clamp((w - 0.9) / 3, 0, 1) * 0.8 + clamp((speed - 120) / 120, 0, 1) * 0.35;
        const saveC = cosT, saveS = sinT;
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < history.length; i += 2) {
          const h = history[i], f = i / history.length;
          const th = lerp(h.th, world.th, 0.45);
          cosT = Math.cos(th); sinT = Math.sin(th);
          project(h.x, h.y, h.z);
          const s = core * 5 * (0.6 + f * 0.4);
          g.globalAlpha = amt * 0.07 * f * vis;
          sprite(SPR_WHITE, P.x, P.y, s);
        }
        cosT = saveC; sinT = saveS;
        // projected future: a faint premonition along the velocity
        project(ball.x + ball.vx * 0.3, ball.y + ball.vy * 0.3, ball.z);
        const s = core * 4; g.globalAlpha = amt * 0.05 * vis;
        sprite(SPR_WHITE, P.x, P.y, s);
      }

      // outer halo
      g.globalCompositeOperation = "lighter";
      let s = core * 26 * (1 + ball.instab * 0.3);
      g.globalAlpha = 0.07 * vis; sprite(SPR_COOL, bx, by, s);
      // the shadow: cast along gravity — until, later, it isn't
      if (!lv.noShadow) {
        const skew = (lv.skew || 0) * (0.55 + 0.45 * Math.sin(t * 0.21)) + (lv.skew || 0) * 0.35 * noise1(t * 0.3);
        const sd = core * 2.6 * (1 + 0.3 * ball.z);
        const sx = bx + Math.sin(-skew) * sd, sy = by + Math.cos(skew) * sd;
        g.globalCompositeOperation = "source-over";
        s = core * 7; g.globalAlpha = 0.55 * vis;
        sprite(SPR_DARK, sx, sy, s);
        g.globalCompositeOperation = "lighter";
      }
      // motion smear
      if (haveBPrev && speed > 30) {
        const mx = bx - prevBX, my = by - prevBY, ml = Math.hypot(mx, my);
        if (ml > 0.5 && ml < 60) {
          g.strokeStyle = PATH_CORE; g.lineCap = "round";
          g.globalAlpha = clamp(speed / 260, 0, 0.5) * vis; g.lineWidth = core * 1.1;
          g.beginPath(); g.moveTo(bx - mx * 1.8, by - my * 1.8); g.lineTo(bx, by); g.stroke();
        }
      }
      // inner glow + core
      s = core * 7.5; g.globalAlpha = 0.45 * vis; sprite(SPR_WHITE, bx, by, s);
      s = core * 2.6; g.globalAlpha = 0.9 * vis; sprite(SPR_WHITE, bx, by, s);
      g.globalAlpha = vis; g.fillStyle = "rgb(250,252,255)";
      g.beginPath(); g.arc(bx, by, core * 0.55, 0, TAU); g.fill();
      prevBX = bx; prevBY = by; haveBPrev = true;
    }

    function drawTransition(t) {
      if (!frag) return;
      const T = clamp(statusT / 2.6, 0, 1);
      g.globalCompositeOperation = "lighter"; g.fillStyle = PATH_CORE;
      const { from, to, n, delay, curl } = frag;
      for (let i = 0; i < n; i++) {
        const u = clamp((T - delay[i]) / (1 - 0.55), 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const bend = Math.sin(u * Math.PI) * curl[i];
        const x0 = from[i * 2], y0 = from[i * 2 + 1], x1 = to[i * 2], y1 = to[i * 2 + 1];
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
        const x = lerp(x0, x1, e) - (dy / L) * bend, y = lerp(y0, y1, e) + (dx / L) * bend;
        const a = 0.25 + 0.55 * Math.sin(u * Math.PI) + (u >= 1 ? 0.1 : 0);
        g.globalAlpha = a * (1 - smooth(0.8, 1, T));
        g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
      }
      const bu = smooth(0.1, 0.9, T);
      const bx = lerp(frag.bFrom.x, frag.bTo.x, bu), by = lerp(frag.bFrom.y, frag.bTo.y, bu);
      const s = 9; g.globalAlpha = 0.8; sprite(SPR_WHITE, bx, by, s);
      g.globalAlpha = 1; g.fillStyle = "rgb(250,252,255)"; g.beginPath(); g.arc(bx, by, 1.4, 0, TAU); g.fill();
    }

    let grainTick = 0, grainOX = 0, grainOY = 0;
    function drawGrain() {
      if (!grainPattern || !quality || GRAIN <= 0) return;
      grainTick++;
      if (grainTick % 3 === 0) { grainOX = Math.random() * 128; grainOY = Math.random() * 128; }
      g.globalCompositeOperation = "overlay";
      g.globalAlpha = 0.07 * GRAIN;
      g.save(); g.translate(-grainOX, -grainOY); g.fillStyle = grainPattern; g.fillRect(0, 0, W + 128, H + 128); g.restore();
      g.globalCompositeOperation = "source-over";
    }

    let metricT = 0;
    function updateUi(dt) {
      metricT += dt; if (metricT < 0.2) return; metricT = 0;
      if (lv.noUi) return;
      const al = status === "play" ? String(Math.round(ball.align * 100)) : status === "failing" ? "—" : status === "ready" ? "·" : String(ball.finalAlign || 100);
      const rot = Math.round((spinTotal * 180) / Math.PI);
      el.m.textContent = "ALIGNMENT " + al.padStart(3, " ") + "\nROTATION " + rot + "°";
    }

    // ---------- main loop ----------
    function fixedUpdate(stepMs) {
      const dt = stepMs / 1000;
      worldStep(dt);
      if (status === "play") {
        const r = physics(dt);
        playT += dt;
        alignAccum += ball.align; alignSamples++;
        if (r === "aligned") succeed();
        else if (r) fail(r);
      } else if (status === "failing") {
        freePhysics(dt);
        if (ball.failKind === "sank") { ball.scale = Math.max(0, ball.scale - dt * 0.8); ball.z += dt * 0.6; }
      } else if (status === "aligned") {
        const st = strands[ball.strand];
        const ex = st.x[st.n - 1], ey = st.y[st.n - 1];
        ball.x += (ex - ball.x) * damp(3, dt); ball.y += (ey - ball.y) * damp(3, dt);
        ball.vx *= 1 - damp(4, dt); ball.vy *= 1 - damp(4, dt);
      }
    }

    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      globalT += dt; statusT += dt; levelT += dt;
      readInput(dt);

      // layered rotation: near air follows closely, far air lags, haze drifts late
      const farK = lv.farK || 3;
      world.thNear += (world.th * 0.99 - world.thNear) * damp(14, dt);
      world.thFar += (world.th * 0.96 - world.thFar) * damp(farK, dt);
      world.thHaze += (world.th - world.thHaze) * damp(1.6, dt);

      if (!lv.fixedCam && (status === "play" || status === "ready" || status === "aligned")) {
        const look = clamp(0.35, 0, 1), lx = clamp(ball.vx * look, -110, 110), ly = clamp(ball.vy * look, -110, 110);
        const tx = ball.x + lx + (status === "ready" ? ball.tx * 50 : 0), ty = ball.y + ly + (status === "ready" ? ball.ty * 50 : 0);
        cam.x += (tx - cam.x) * damp(2.4, dt); cam.y += (ty - cam.y) * damp(2.4, dt);
      }

      // path presence
      if (status === "failing") pathAlpha = Math.max(0, pathAlpha - dt / 1.6);
      else if (status === "transition") pathAlpha = smooth(0.6, 1, statusT / 2.6);
      else pathAlpha = Math.min(1, pathAlpha + dt / 0.9);
      lit += ((status === "aligned" ? 2.2 : 1) - lit) * damp(status === "aligned" ? 1.6 : 3, dt);
      if (lv.memory) {
        const seen = status === "play" ? playT : 0;
        const target = status === "aligned" ? 1 : status === "ready" ? 1 : 1 - smooth(4.2, 6.6, seen);
        memVis += (target - memVis) * damp(status === "aligned" ? 1.5 : 4, dt);
      } else memVis = 1;

      if (status === "failing") {
        if (statusT > 2.0 && statusT - dt <= 2.0) setMsg(ball.failKind === "sank" ? "THE WORLD SLIPPED." : "THE WORLD SLIPPED.");
        if (statusT > 3.9 && statusT - dt <= 3.9) setMsg("AGAIN");
      }
      if (status === "aligned") {
        if (!lv.final && statusT > 3.7) beginTransition();
        if (lv.final && statusT > 4.2) {
          el.blk.style.opacity = "1";
          try { ctx.pulse && ctx.pulse.complete && ctx.pulse.complete({ text: "ORIENTED.", level: NLEV }); } catch (e) {}
          try { ctx.platform.complete({ levels: NLEV }); } catch (e) {}
          setStatus("end");
        }
      }
      if (status === "end" && statusT > 5 && statusT - dt <= 5) setMsg("");
      if (status === "transition" && statusT > 2.6) {
        frag = null; setStatus("ready"); levelT = 0;
        if (lv.name) setMsg(lv.name);
        ctx.timeout(() => { if (status === "ready" || status === "play") { if (el.msg.textContent === lv.name) setMsg(""); } }, 3600);
      }

      // afterimage history + ghost recording
      histTimer += dt;
      if (histTimer > 0.035) {
        histTimer = 0;
        history.push({ x: ball.x, y: ball.y, z: ball.z, th: world.th });
        if (history.length > 22) history.shift();
      }
      if (status === "play" || (status === "failing" && statusT < 1.4)) {
        ghostTimer += dt;
        if (ghostTimer > 0.05 && curGhost.length < 900) { ghostTimer = 0; curGhost.push(ball.x, ball.y, ball.z); }
      }

      spawnParticles(dt);
      updateAudio(dt);
      updateUi(dt);
    }

    function render(alpha, state) {
      const dt = state && state.dtMs ? Math.min(0.05, state.dtMs / 1000) : 1 / 60;
      const t = globalT;
      if (state && state.averageFps) {
        if (state.averageFps < 40) lowFpsT += dt; else lowFpsT = Math.max(0, lowFpsT - dt * 0.5);
        if (lowFpsT > 3) quality = 0;
      }
      beginProjection();
      project(ball.x, ball.y, ball.z);
      hazeX += (P.x - hazeX) * damp(0.8, dt); hazeY += (P.y - hazeY) * damp(0.8, dt);
      drawAtmosphere(t);
      drawGhosts();
      if (status === "transition") drawTransition(t);
      if (status !== "transition" || statusT > 1.5) drawPaths(t, dt);
      drawParticles(dt);
      drawBall(t, dt);
      beginProjection();
      drawMotes(t);
      drawGrain();
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }

    // ---------- boot ----------
    let startAt = clamp(START_LEVEL - 1, 0, NLEV - 1);
    if (startAt === 0 && prog && prog.load) {
      try {
        const saved = await Promise.race([prog.load("main"), new Promise((r) => ctx.timeout(() => r(null), 1500))]);
        if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.level)) startAt = clamp(saved.state.level, 0, NLEV - 1);
      } catch (e) {}
    }
    loadLevel(startAt);
    if (startAt > 0) firstEverTouch = false;
    beginProjection();
    project(ball.x, ball.y, ball.z); hazeX = P.x; hazeY = P.y;
    render(0, null);
    ctx.game.loop({ fixedHz: 120, maxSubsteps: 8, input, fixedUpdate, update, render });
    ctx.platform.ready();
    ctx.timeout(() => {
      if (status === "ready") setMsg(lvIndex === 0 ? "ORIENT YOURSELF" : lv.name || "");
    }, 900);
  }
};
