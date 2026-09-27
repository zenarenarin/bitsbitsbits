// ORIENTATION — a bead of light on a filament. You never touch the ball:
// you tilt the world underneath it, and gravity does the rest.
window.plethoraBit = {
  meta: {
    title: "Orientation",
    runtime: "plethora-bit@2",
    tags: ["interactive-art", "physics", "gravity", "puzzle", "light"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const damp = (k, dt) => 1 - Math.exp(-k * dt);
    const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const rgb = (c, a) => (a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);

    const tune = (id, d) => {
      try { const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined; return v == null || !isFinite(v) ? d : v; }
      catch (e) { return d; }
    };
    const GRAVITY = tune("gravity", 260);
    const HOLD = tune("groove_hold", 1);
    const INERTIA = tune("world_inertia", 1);
    const SENS = tune("rotation_sensitivity", 1);
    const HAZE = tune("haze", 1);
    const GRAIN = tune("grain", 1);
    const VOLUME = tune("volume", 0.8);
    const START_LEVEL = Math.round(tune("start_level", 1));

    // ---------- deterministic helpers ----------
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
    function resample(X, Y, Z) {
      const OX = [X[0]], OY = [Y[0]], OZ = [Z ? Z[0] : 0];
      let carry = 0;
      for (let i = 1; i < X.length; i++) {
        const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1], L = Math.hypot(dx, dy);
        let t = STEP - carry;
        while (t <= L) {
          const u = t / L;
          OX.push(X[i - 1] + dx * u); OY.push(Y[i - 1] + dy * u); OZ.push(Z ? lerp(Z[i - 1], Z[i], u) : 0);
          t += STEP;
        }
        carry = L - (t - STEP);
      }
      return { X: OX, Y: OY, Z: OZ, gaps: [] };
    }
    function makeStrand(tr, opts = {}) {
      const n = tr.X.length;
      const st = {
        n, x: new Float32Array(tr.X), y: new Float32Array(tr.Y), z: new Float32Array(n), s: new Float32Array(n),
        segGap: new Uint8Array(n), sx: new Float32Array(n), sy: new Float32Array(n),
        next: [], parent: -1, dead: !!opts.dead, final: !!opts.final, id: 0, len: 0
      };
      if (tr.Z) for (let i = 0; i < n; i++) st.z[i] = tr.Z[i];
      for (let i = 1; i < n; i++) st.s[i] = st.s[i - 1] + Math.hypot(st.x[i] - st.x[i - 1], st.y[i] - st.y[i - 1]);
      st.len = st.s[n - 1];
      for (let i = 0; i < n - 1; i++) {
        const m = (st.s[i] + st.s[i + 1]) / 2;
        for (const gp of tr.gaps) if (m >= gp[0] && m <= gp[1]) st.segGap[i] = 1;
      }
      return st;
    }
    function link(S, parent, children) { for (const c of children) { S[parent].next.push(c); S[c].parent = parent; } }
    const O = { x: 0, y: 0, h: 0 };

    // Each world is a disc you turn. Geometry, rules, light, and one line of guidance.
    const spiral = (r0, r1, turns, n = 2000) => {
      const X = [], Y = [];
      for (let i = 0; i <= n; i++) { const u = i / n, r = lerp(r0, r1, u), p = turns * TAU * u; X.push(r * Math.cos(p)); Y.push(r * Math.sin(p)); }
      return resample(X, Y, null);
    };
    const LEVELS = [
      {
        name: "TILT", hint: "Drag around the disc to turn it. Keep the line pointing down — lean it too far and the light falls.",
        hue: [140, 205, 255], hold: 0.85, key: 0,
        build: () => [makeStrand(trace([["S", 440]], O), { final: true })]
      },
      {
        name: "CURVE", hint: "Keep turning as the line bends, so it always leads downhill.",
        hue: [110, 235, 220], hold: 0.78, key: 2,
        build: () => [makeStrand(trace([["S", 90], ["A", 140, 120], ["A", 140, -150], ["S", 90]], O), { final: true })]
      },
      {
        name: "ZIGZAG", hint: "Quick reversals. Start turning before each bend arrives.",
        hue: [255, 196, 120], hold: 0.75, key: 4,
        build: () => [makeStrand(trace([["S", 110], ["A", 85, 120], ["A", 85, -150], ["A", 85, 150], ["A", 85, -130], ["S", 100]], O), { final: true })]
      },
      {
        name: "MOMENTUM", hint: "The disc is heavy now. Let go early — it keeps spinning.",
        hue: [200, 165, 255], hold: 0.72, key: 7, inertia: 2.6, zeta: 0.45, spinDamp: 0.55,
        build: () => [makeStrand(trace([["S", 90], ["A", 130, 100], ["S", 50], ["A", 120, -160], ["S", 50], ["A", 130, 130], ["S", 90]], O), { final: true })]
      },
      {
        name: "SPIRAL", hint: "Wind all the way in. You must keep the disc turning the whole way.",
        hue: [120, 240, 175], hold: 0.72, key: 9,
        build: () => [makeStrand(spiral(300, 95, 1.75), { final: true })]
      },
      {
        name: "GAP", hint: "The line breaks. Build speed first — momentum carries you across.",
        hue: [255, 160, 175], hold: 0.7, key: 11,
        build: () => [makeStrand(trace([["S", 150], ["A", 170, 60], ["S", 190, [70, 125]], ["A", 150, -120], ["S", 210, [80, 150]], ["S", 60]], O), { final: true })]
      },
      {
        name: "FORK", hint: "Lean before the split to choose. One branch fades into nothing.",
        hue: [175, 205, 255], hold: 0.7, key: 14,
        build() {
          const t0 = trace([["S", 110], ["A", 180, 35], ["S", 60]], O);
          const a = trace([["A", 200, -45], ["S", 150]], t0.end);
          const b = trace([["A", 200, 45], ["S", 70], ["A", 170, -70], ["S", 50]], t0.end);
          const c = trace([["A", 200, 45], ["S", 130]], b.end);
          const d = trace([["A", 200, -45], ["S", 60], ["A", 170, 60], ["S", 90]], b.end);
          const S = [makeStrand(t0), makeStrand(a, { dead: true }), makeStrand(b), makeStrand(c, { dead: true }), makeStrand(d, { final: true })];
          link(S, 0, [1, 2]); link(S, 2, [3, 4]);
          return S;
        }
      },
      {
        name: "MEMORY", hint: "Study it now. A few seconds after you start, the line disappears.",
        hue: [225, 240, 150], hold: 0.68, key: 16, memory: true,
        build: () => [makeStrand(trace([["S", 80], ["A", 140, 90], ["A", 120, -140], ["S", 70], ["A", 140, 150], ["A", 130, -110], ["S", 90]], O), { final: true })]
      },
      {
        name: "DEPTH", hint: "It passes behind itself. Stay on your own strand at each crossing.",
        hue: [150, 220, 255], hold: 0.68, key: 19, depth: true, skew: 0.35,
        build() {
          const X = [], Y = [], Z = [], K = 105, t0 = 0.55, span = TAU - 0.5;
          for (let i = 0; i <= 1600; i++) {
            const t = t0 + (span * i) / 1600;
            X.push(K * (Math.sin(t) + 2 * Math.sin(2 * t))); Y.push(K * (Math.cos(t) - 2 * Math.cos(2 * t))); Z.push(-Math.sin(3 * t));
          }
          return [makeStrand(resample(X, Y, Z), { final: true })];
        }
      },
      {
        name: "DRIFT", hint: "The disc turns by itself now. Fight it to hold the line.",
        hue: [255, 175, 115], hold: 0.66, key: 21, auto: 1.1, skew: 0.6, spinDamp: 1.6,
        build: () => [makeStrand(trace([["S", 90], ["A", 150, 80], ["A", 140, -130], ["S", 60], ["A", 150, 120], ["A", 140, -90], ["S", 80]], O), { final: true })]
      },
      {
        name: "SYMMETRY", hint: "Go all the way around the rim. Watch the rotation count.",
        hue: [205, 175, 255], hold: 0.66, key: 23, symmetric: true, skew: 0.8,
        build() {
          const X = [], Y = [];
          for (let i = 0; i <= 2400; i++) { const p = (TAU * i) / 2400, r = 250 + 12 * Math.cos(6 * p); X.push(r * Math.cos(p)); Y.push(r * Math.sin(p)); }
          return [makeStrand(resample(X, Y, null), { final: true })];
        }
      },
      {
        name: "NO UP", hint: "No grid. No rim. No down. Trust what you've learned.", hue: [236, 238, 250], hold: 0.65, key: 12, auto: 0.45,
        noShadow: true, noGrid: true, final: true,
        build() {
          const r = rng(7331), cmds = [["S", 80]];
          let sign = 1;
          for (let i = 0; i < 6; i++) { cmds.push(["A", 110 + r() * 60, sign * (60 + r() * 60)]); if (r() < 0.4) cmds.push(["S", 30 + r() * 50]); sign = -sign; }
          cmds.push(["S", 80]);
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
      style: "font-family:'Space Mono',ui-monospace,Menlo,Consolas,monospace;color:rgba(226,232,242,0.8);text-transform:uppercase;user-select:none;-webkit-user-select:none;"
    });
    const BTN = "pointer-events:auto;cursor:pointer;display:inline-block;min-width:112px;padding:14px 22px;margin:0 6px;border-radius:999px;font:inherit;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;border:1px solid rgba(255,255,255,0.32);background:rgba(255,255,255,0.05);color:rgba(240,244,250,0.92);-webkit-tap-highlight-color:transparent;";
    const BTN_P = BTN + "background:rgba(240,246,255,0.92);color:#07090d;border-color:transparent;";
    ui.innerHTML = `
      <style>
        @keyframes or-sway { 0%,100% { transform: translateX(-34px) } 50% { transform: translateX(34px) } }
        .or-fade { transition: opacity .45s ease; }
      </style>
      <div data-k="hud" class="or-fade" style="position:absolute;left:0;right:0;top:0;opacity:0">
        <div style="position:absolute;left:18px;top:var(--top,20px);font-size:10px;letter-spacing:0.3em;line-height:1.7">
          <span data-k="num" style="color:rgba(255,255,255,0.95)">01</span>&nbsp;&nbsp;<span data-k="name">STRAIGHT</span>
          <div data-k="meta" style="opacity:0.5;font-size:9px;white-space:pre"></div>
        </div>
        <div style="position:absolute;right:16px;top:var(--top,20px);text-align:right;font-size:10px;letter-spacing:0.22em;line-height:1.7">
          <div data-k="time">0.0</div>
          <div data-k="sparks" style="opacity:0.7">✦ 0/0</div>
        </div>
        <div data-k="restart" style="position:absolute;right:6px;top:calc(var(--top,20px) + 40px);width:44px;height:44px;line-height:44px;text-align:center;font-size:17px;opacity:0.55;pointer-events:auto;cursor:pointer;text-transform:none">↺</div>
        <div style="position:absolute;left:50%;top:calc(var(--top,20px) + 6px);width:84px;margin-left:-42px;height:1px;background:rgba(255,255,255,0.14)">
          <div data-k="bar" style="height:1px;width:0%;background:rgba(255,255,255,0.85);box-shadow:0 0 6px rgba(255,255,255,0.8)"></div>
        </div>
      </div>
      <div data-k="card" class="or-fade" style="position:absolute;left:24px;right:24px;top:calc(var(--top,20px) + 58px);text-align:center;opacity:0;pointer-events:none">
        <div data-k="cnum" style="font-size:11px;letter-spacing:0.5em;opacity:0.6;padding-left:0.5em">WORLD 01</div>
        <div data-k="cname" style="font-size:26px;letter-spacing:0.42em;margin-top:10px;color:#fff;padding-left:0.42em">STRAIGHT</div>
        <div data-k="chint" style="font-size:11px;letter-spacing:0.12em;line-height:1.7;margin-top:14px;text-transform:none;opacity:0.85"></div>
      </div>
      <div data-k="drag" class="or-fade" style="position:absolute;left:0;right:0;bottom:calc(var(--bottom,20px) + 70px);text-align:center;opacity:0;pointer-events:none">
        <div style="position:relative;height:30px">
          <div style="position:absolute;left:50%;top:9px;width:120px;margin-left:-60px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)"></div>
          <div style="position:absolute;left:50%;top:0;margin-left:-9px;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.8);animation:or-sway 2.2s ease-in-out infinite"></div>
        </div>
        <div style="font-size:9px;letter-spacing:0.4em;opacity:0.7;margin-top:6px;padding-left:0.4em">DRAG AROUND TO TURN THE DISC</div>
      </div>
      <div data-k="dlg" class="or-fade" style="position:absolute;inset:0;opacity:0;pointer-events:none;background:radial-gradient(ellipse 80% 42% at 50% 44%,rgba(2,3,5,0.82),rgba(2,3,5,0.35) 70%,rgba(2,3,5,0.15))">
       <div style="position:absolute;left:16px;right:16px;top:30%;text-align:center">
        <div data-k="dtitle" style="font-size:24px;letter-spacing:0.45em;color:#fff;padding-left:0.45em;text-shadow:0 0 20px rgba(255,255,255,0.35)"></div>
        <div data-k="dstars" style="font-size:18px;letter-spacing:0.5em;margin-top:16px;padding-left:0.5em;text-transform:none"></div>
        <div data-k="dsub" style="font-size:11px;letter-spacing:0.14em;margin-top:14px;line-height:1.8;text-transform:none;opacity:0.85;white-space:pre-line"></div>
        <div data-k="dbtns" style="margin-top:30px"></div>
       </div>
      </div>
      <div data-k="title" class="or-fade" style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,rgba(6,8,12,0.55),rgba(0,0,0,0.9));pointer-events:auto;opacity:1">
        <div style="position:absolute;left:24px;right:24px;top:14%;text-align:center">
          <div style="font-size:26px;letter-spacing:0.5em;color:#fff;padding-left:0.5em;text-shadow:0 0 24px rgba(160,210,255,0.55)">ORIENTATION</div>
          <div style="font-size:11px;letter-spacing:0.2em;margin-top:14px;opacity:0.7;text-transform:none">Turn the world. Guide the light.</div>
          <div style="margin:32px auto 0;max-width:300px;text-align:left;font-size:11px;line-height:1.75;letter-spacing:0.06em;text-transform:none;opacity:0.9">
            <div style="margin-bottom:12px"><span style="color:#fff">◐&nbsp; The world is a disc.</span> Drag your finger around it to turn it, like a dial. You never touch the ball.</div>
            <div style="margin-bottom:12px"><span style="color:#fff">↓&nbsp; Gravity always pulls straight down the screen.</span> Turn the disc so the glowing line leads downhill and the ball rolls along it.</div>
            <div style="margin-bottom:12px"><span style="color:#fff">◌&nbsp; The line only grips so much.</span> Let it lean too far from straight down, or hit a bend too fast, and the ball falls off. Reach the ring.</div>
            <div><span style="color:#fff">✦&nbsp; Collect the sparks</span> and beat the par time for three stars.</div>
          </div>
          <div data-k="tbtns" style="margin-top:32px"></div>
          <div data-k="grid" style="margin-top:24px;font-size:10px;letter-spacing:0.12em"></div>
        </div>
      </div>
      <div data-k="blk" style="position:absolute;inset:0;background:#000;opacity:0;transition:opacity 2.4s ease;pointer-events:none"></div>`;
    const el = {};
    ui.querySelectorAll("[data-k]").forEach((n) => { el[n.getAttribute("data-k")] = n; });
    if (ctx.loadFont) { try { ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400" }).catch(() => {}); } catch (e) {} }
    const show = (n, on) => { n.style.opacity = on ? "1" : "0"; };

    // ---------- sprites (ImageData -> ImageBitmap, with live-gradient fallback) ----------
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
      const sp = { img: null, css: stops.map(([p, c]) => [p, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3]})`]) };
      if (canBitmap) { try { createImageBitmap(rasterStops(stops, size)).then((b) => { sp.img = b; }).catch(() => {}); } catch (e) {} }
      return sp;
    }
    function sprite(sp, x, y, size) {
      if (!(size > 0)) return;
      if (sp.img) { g.drawImage(sp.img, x - size / 2, y - size / 2, size, size); return; }
      const gr = g.createRadialGradient(x, y, 0, x, y, size / 2);
      for (const [p, c] of sp.css) gr.addColorStop(p, c);
      g.fillStyle = gr; g.fillRect(x - size / 2, y - size / 2, size, size);
    }
    const blob = (c, size = 128) => makeSprite([[0, [c[0], c[1], c[2], 1]], [0.3, [c[0], c[1], c[2], 0.45]], [0.65, [c[0], c[1], c[2], 0.1]], [1, [c[0], c[1], c[2], 0]]], size);
    const SPR_WHITE = blob([240, 246, 255]), SPR_DARK = blob([0, 0, 0]), SPR_WARM = blob([255, 170, 95]);
    const SPR_RING = makeSprite([
      [0, [120, 140, 170, 0.25]], [0.3, [80, 100, 130, 0]], [0.56, [90, 115, 150, 0]], [0.66, [90, 115, 150, 0.5]],
      [0.78, [90, 115, 150, 0]], [0.9, [70, 90, 120, 0.22]], [1, [0, 0, 0, 0]]
    ], 256);
    const hueSprites = LEVELS.map(() => null);
    function levelSprites(i) {
      if (!hueSprites[i]) {
        const h = LEVELS[i].hue;
        hueSprites[i] = { glow: blob(h), haze: blob(mix3(h, [40, 50, 70], 0.55)), haze2: blob(mix3(h, [20, 30, 45], 0.75)) };
      }
      return hueSprites[i];
    }

    let grainPattern = null;
    if (canBitmap) {
      try {
        const img = new ImageData(128, 128), r = rng(5);
        for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = r() < 0.5 ? 255 : 0; }
        createImageBitmap(img).then((b) => { try { grainPattern = g.createPattern(b, "repeat"); } catch (e) {} }).catch(() => {});
      } catch (e) {}
    }

    // ---------- layout ----------
    let W = ctx.width || 390, H = ctx.height || 780, cx = W / 2, cy = H / 2, MIN = Math.min(W, H), DIAG = Math.hypot(W, H);
    let bgImg = null, bgToken = 0;
    function buildBackground() {
      if (!canBitmap) return;
      const tok = ++bgToken, bw = 90, bh = Math.max(2, Math.round((90 * H) / Math.max(1, W)));
      const img = new ImageData(bw, bh), d = img.data, r = rng(99), blobs = [];
      for (let i = 0; i < 5; i++) blobs.push({ x: r() * bw, y: r() * bh, rad: (0.3 + r() * 0.5) * Math.max(bw, bh), c: [10 + r() * 6, 12 + r() * 6, 16 + r() * 8] });
      const R = Math.hypot(bw, bh) * 0.62;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const t = Math.min(1, Math.hypot(x - bw * 0.5, y - bh * 0.45) / R);
        let cr, cg, cb;
        if (t < 0.45) { const u = t / 0.45; cr = lerp(17, 9, u); cg = lerp(20, 11, u); cb = lerp(27, 15, u); }
        else { const u = (t - 0.45) / 0.55; cr = lerp(9, 1, u); cg = lerp(11, 1, u); cb = lerp(15, 2, u); }
        for (const b of blobs) { const q = Math.max(0, 1 - Math.hypot(x - b.x, y - b.y) / b.rad) * 0.3; cr += b.c[0] * q; cg += b.c[1] * q; cb += b.c[2] * q; }
        const i = (y * bw + x) * 4;
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255;
      }
      try { createImageBitmap(img).then((b) => { if (tok === bgToken) bgImg = b; }).catch(() => {}); } catch (e) {}
    }
    ctx.onResize((info) => {
      W = info.width || W; H = info.height || H;
      cx = W / 2; cy = H / 2; MIN = Math.min(W, H); DIAG = Math.hypot(W, H);
      const sa = info.safeArea || {};
      ui.style.setProperty("--top", Math.max(16, sa.top || 0) + 8 + "px");
      ui.style.setProperty("--bottom", Math.max(16, sa.bottom || 0) + "px");
      buildBackground();
    }, { immediate: true });

    // ---------- state ----------
    const world = { th: 0, om: 0, finger: 0, dragging: false, thNear: 0, thFar: 0, th0: 0, lastPX: 0, lastPY: 0 };
        const ball = {
      x: 0, y: 0, vx: 0, vy: 0, z: 0, strand: 0, idx: 0, s: 0, d: 0, tx: 1, ty: 0, kappa: 0,
      offT: 0, sink: 0, inGap: false, align: 1, strain: 0, alignHold: 0, fade: 1, scale: 1, slipWhy: ""
    };
    let lvIndex = 0, lv = LEVELS[0], strands = [], status = "title", statusT = 0, globalT = 0;
    let attempts = 0, alignAccum = 0, alignSamples = 0, pathAlpha = 1, lit = 1, memVis = 1, playT = 0;
    let routeLen = 1, sparks = [], sparksGot = 0, endPt = { x: 0, y: 0, z: 0 }, litSet = new Set();
    let haze = [], ghosts = [], curGhost = [], ghostTimer = 0;
    const history = []; let histTimer = 0;
    const particles = []; for (let i = 0; i < 160; i++) particles.push({ life: 0 });
    const rings = [];
    let frag = null, quality = 1, lowFpsT = 0, prevBX = 0, prevBY = 0, haveBPrev = false, spinTotal = 0;
    let speedSm = 0, hazeX = 0, hazeY = 0, dragHintSeen = false, result = null;
    let unlocked = 0; const stars = new Array(NLEV).fill(0);

    let DR = 300, grid = [];
    function setupAtmosphere() {
      const r = rng(1000 + lvIndex * 17), sp = levelSprites(lvIndex);
      haze = [];
      for (let i = 0; i < 6; i++) haze.push({
        a: r() * TAU, rad: (0.15 + r() * 0.5) * DIAG, size: (0.55 + r() * 0.8) * DIAG,
        spr: r() < 0.55 ? sp.haze : sp.haze2, alpha: 0.06 + r() * 0.07, ph: r() * TAU
      });
      // the plate's own markings: a dot lattice that turns with the world
      grid = [];
      if (!lv.noGrid) {
        const gs = DR / 7;
        for (let gx = -DR; gx <= DR; gx += gs) for (let gy = -DR; gy <= DR; gy += gs) {
          const d = Math.hypot(gx, gy);
          if (d < DR * 0.97) grid.push(gx, gy, d / DR);
        }
      }
    }

    // ---------- projection: the whole world is a disc turning about its centre ----------
    const P = { x: 0, y: 0, k: 1 };
    let cosT = 1, sinT = 0, SC = 1, parX = 0, parY = 0, ancX = 0, ancY = 0;
    function beginProjection() {
      cosT = Math.cos(world.th); sinT = Math.sin(world.th);
      SC = Math.min(W * 0.46, H * 0.34) / DR;
      ancX = cx; ancY = H * 0.52;
      if (lv.depth) { parX = 10 * Math.cos(world.thFar * 1.3 + 0.7) - world.om * 3; parY = 10 * Math.sin(world.thFar * 1.3 + 0.7); }
      else { parX = 0; parY = 0; }
    }
    function project(x, y, z) {
      const k = SC / (1 + 0.2 * z);
      P.x = ancX + (cosT * x - sinT * y) * k + z * parX;
      P.y = ancY + (sinT * x + cosT * y) * k + z * parY;
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
      // centre the geometry on the disc
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (const q of strands) for (let k = 0; k < q.n; k++) {
        minx = Math.min(minx, q.x[k]); maxx = Math.max(maxx, q.x[k]); miny = Math.min(miny, q.y[k]); maxy = Math.max(maxy, q.y[k]);
      }
      const ox = (minx + maxx) / 2, oy = (miny + maxy) / 2;
      let rmax = 0;
      for (const q of strands) for (let k = 0; k < q.n; k++) { q.x[k] -= ox; q.y[k] -= oy; rmax = Math.max(rmax, Math.hypot(q.x[k], q.y[k])); }
      DR = rmax + 34;
      routeLen = 0;
      let st = strands[0];
      for (;;) { routeLen += st.len; const nx = st.next.map((k) => strands[k]).find((q) => !q.dead); if (!nx) break; st = nx; }
      const fin = strands.find((q) => q.final);
      endPt = { x: fin.x[fin.n - 1], y: fin.y[fin.n - 1], z: fin.z[fin.n - 1] };
      // sparks along living strands, never inside gaps
      sparks = [];
      for (const q of strands) {
        if (q.dead) continue;
        for (let s = q.id === 0 ? 110 : 70; s < q.len - 50; s += 150) {
          const k = Math.round(s / STEP);
          if (q.segGap[k] || q.segGap[Math.max(0, k - 3)] || q.segGap[Math.min(q.n - 1, k + 3)]) continue;
          sparks.push({ x: q.x[k], y: q.y[k], z: q.z[k], got: false, ph: s * 0.1 });
        }
      }
      setupAtmosphere();
      ghosts = []; attempts = 0;
      el.num.textContent = String(lvIndex + 1).padStart(2, "0");
      el.name.textContent = lv.name || "";
      resetBall(true);
    }

    function resetBall(snapWorld) {
      const st = strands[0], t = tangentAt(st, 0);
      Object.assign(ball, {
        x: st.x[0] + t.x * 6, y: st.y[0] + t.y * 6, vx: 0, vy: 0, strand: 0, idx: 1, s: 6, d: 0, z: st.z[0],
        offT: 0, sink: 0, inGap: false, fade: 1, scale: 1, align: 1, strain: 0, alignHold: 0, tx: t.x, ty: t.y, kappa: 0, cent: 0, slipWhy: ""
      });
      world.th0 = Math.PI / 2 - 1.2 - Math.atan2(t.y, t.x);
      if (snapWorld) { world.th = world.th0; world.om = 0; world.finger = world.th; world.thNear = world.th * 0.99; world.thFar = world.th * 0.96; }
      for (const sp of sparks) sp.got = false;
      sparksGot = 0; litSet = new Set();
      history.length = 0; curGhost = []; haveBPrev = false;
      alignAccum = 0; alignSamples = 0; playT = 0; memVis = 1; spinTotal = 0; speedSm = 0;
    }

    // ---------- tracking ----------
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
      if (Q.st.id !== ball.strand) {
        litSet = new Set();
        for (let p = Q.st.parent; p >= 0; p = strands[p].parent) litSet.add(p);
      }
      ball.strand = Q.st.id; ball.idx = Q.i;
      return Q;
    }

    // ---------- physics ----------
    const WG = 7;
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
      const i2 = Math.min(st.n - 2, i + 3), t2 = tangentAt(st, i2 + 1);
      ball.kappa = (tx * t2.y - ty * t2.x) / Math.max(1, st.s[i2 + 1] - st.s[i]);

      const pastEnd = i === st.n - 2 && q.raw > 1;
      const beforeStart = st.id === 0 && i === 0 && q.raw < 0;
      const gap = st.segGap[i] === 1;
      ball.inGap = gap;
      const grooved = !gap && !(pastEnd && !st.next.length);
      const vt = ball.vx * tx + ball.vy * ty, vn = ball.vx * nx + ball.vy * ny;
      if (beforeStart && vt < 0) { ball.vx -= vt * tx * 1.3; ball.vy -= vt * ty * 1.3; }
      if (grooved) {
        const fmax = lv.hold * HOLD * G;
        const f = -fmax * (d / WG) * Math.exp(0.5 - (d * d) / (2 * WG * WG));
        ax += nx * f; ay += ny * f;
        const near = Math.exp(-(d * d) / (2 * 196));
        ax -= nx * vn * 12 * near; ay -= ny * vn * 12 * near;
        const drag = (0.1 * vt + (G / 13000) * vt * Math.abs(vt)) * near;
        ax -= tx * drag; ay -= ty * drag;
      } else { ax -= ball.vx * 0.1; ay -= ball.vy * 0.1; }
      ball.vx += ax * dt; ball.vy += ay * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      ball.d = grooved ? d : dist;

      if (gap) ball.sink += dt * 1.3; else ball.sink = Math.max(0, ball.sink - dt * 4);
      const a = grooved ? Math.exp(-(d * d) / (WG * WG * 1.4)) : gap ? 0.6 : 0;
      ball.align = a;
      const strainT = grooved ? clamp(Math.abs(d) / WG, 0, 1.5) : gap ? 0.3 : 1.5;
      ball.strain += (strainT - ball.strain) * damp(10, dt);
      ball.alignHold = a > 0.93 && !gap ? ball.alignHold + dt : Math.max(0, ball.alignHold - dt * 2);

      // recent peak demand of the curve on the grip, used to explain a slip honestly
      ball.cent = Math.max((ball.cent || 0) * Math.exp(-dt * 1.5), grooved ? Math.abs(vt * vt * ball.kappa) : 0);
      const slipping = !gap && (Math.abs(ball.d) > WG * 3 || !grooved);
      if (slipping) {
        if (ball.offT === 0) {
          if (st.dead || (pastEnd && !st.final)) ball.slipWhy = "That branch fades into nothing. Lean the other way before the split.";
          else if (ball.cent > lv.hold * HOLD * G * 0.6) ball.slipWhy = "Too fast into the bend. Start turning earlier so gravity helps you round it.";
          else ball.slipWhy = "The line leaned too far from straight down. Keep it inside the fan under the ball.";
        }
        ball.offT += dt;
      } else ball.offT = 0;

      for (const sp of sparks) {
        if (sp.got) continue;
        const ddx = sp.x - ball.x, ddy = sp.y - ball.y;
        if (ddx * ddx + ddy * ddy < 15 * 15) { sp.got = true; sparksGot++; collect(sp); }
      }

      if (st.final && (pastEnd || ball.s > st.len - 3) && dist < WG * 2.5) return "aligned";
      if (ball.sink >= 1) { ball.slipWhy = "Not enough speed to cross the gap. Build momentum first."; return "sank"; }
      if (ball.offT > 0.35) return "slipped";
      return null;
    }
    function freePhysics(dt) {
      ball.vx += (GRAVITY * Math.sin(world.th) - ball.vx * 0.1) * dt;
      ball.vy += (GRAVITY * Math.cos(world.th) - ball.vy * 0.1) * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    }

    function worldStep(dt) {
      const I = (lv.inertia || 1) * INERTIA, zeta = lv.zeta || 1, K = 520;
      let acc;
      const live = status === "play" || status === "ready";
      if (world.dragging && live) {
        acc = (K * (world.finger - world.th) - 2 * Math.sqrt(K * I) * zeta * world.om) / I;
      } else {
        acc = -(lv.spinDamp || 2.6) * world.om;
        if (status === "ready") {
          let d = world.th0 - world.th; d -= TAU * Math.round(d / TAU);
          acc += d * 14 - world.om * 7;
        }
      }
      if (lv.auto && status === "play") {
        const t = playT;
        acc += (lv.auto * (Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.83 + 1.3) * 0.6 + 0.35)) / I;
      }
      if (status === "aligned" || status === "result" || status === "transition" || status === "title") acc = -8 * world.om;
      world.om = clamp(world.om + acc * dt, -14, 14);
      const before = world.th;
      world.th += world.om * dt;
      if (status === "play") spinTotal += world.th - before;
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
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
        master.connect(comp); comp.connect(ac.destination);
        const rev = ac.createConvolver(), irLen = Math.floor(ac.sampleRate * 3), ir = ac.createBuffer(2, irLen, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2); }
        rev.buffer = ir;
        const revGain = ac.createGain(); revGain.gain.value = 0.5; rev.connect(revGain); revGain.connect(master);
        const bus = ac.createGain(); bus.connect(master); bus.connect(rev);
        const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
        const bed = ac.createGain(); bed.gain.value = 0; const bedLp = ac.createBiquadFilter(); bedLp.type = "lowpass"; bedLp.frequency.value = 420;
        bed.connect(bedLp); bedLp.connect(bus);
        const d1 = osc("sine", 55), d2 = osc("sine", 82.6), d3 = osc("triangle", 110.3), d3g = ac.createGain(); d3g.gain.value = 0.18;
        d1.connect(bed); d2.connect(bed); d3.connect(d3g); d3g.connect(bed);
        const voice = ac.createGain(); voice.gain.value = 0;
        const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (pan) { voice.connect(pan); pan.connect(bus); } else voice.connect(bus);
        const vA = osc("sine", 196), vB = osc("sine", 294), vC = osc("sine", 392);
        const gA = ac.createGain(), gB = ac.createGain(), gC = ac.createGain();
        gA.gain.value = 0.55; gB.gain.value = 0.3; gC.gain.value = 0;
        vA.connect(gA); vB.connect(gB); vC.connect(gC); gA.connect(voice); gB.connect(voice); gC.connect(voice);
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
    function chime(freq, gain = 0.12, dur = 4) {
      if (!audio.ok) return;
      const ac = audio.ac, t = ac.currentTime;
      [[1, 1], [2, 0.28], [3.01, 0.08]].forEach(([m, a]) => {
        const o = ac.createOscillator(), gn = ac.createGain();
        o.type = "sine"; o.frequency.value = freq * m;
        gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(gain * a, t + 0.012);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
        o.connect(gn); gn.connect(audio.bus); o.start(t); o.stop(t + dur + 0.1);
      });
    }
    const SCALE = [0, 2, 4, 7, 9];
    const noteFreq = (k) => 146.83 * Math.pow(2, (Math.floor(k / 5) * 12 + SCALE[((k % 5) + 5) % 5]) / 12);
    const baseFreq = () => noteFreq(lv.key) / Math.pow(2, Math.floor(lv.key / 10));
    let audioTick = 0;
    function updateAudio(dt) {
      if (!audio.ok) return;
      audioTick += dt; if (audioTick < 0.033) return; audioTick = 0;
      const playing = status === "play" || status === "ready";
      const masterV = status === "title" ? 0.5 * VOLUME : status === "failing" ? 0.15 * VOLUME : 0.9 * VOLUME;
      setP(audio.master.gain, masterV, status === "failing" ? 0.25 : 0.5);
      setP(audio.bed.gain, 0.05, 1.2);
      const speed = Math.hypot(ball.vx, ball.vy), f0 = baseFreq();
      const present = status === "play" ? 0.05 + 0.07 * clamp(speed / 190, 0, 1) : status === "ready" ? 0.03 : 0;
      setP(audio.voice.gain, present * (1 - ball.sink * 0.8), 0.12);
      setP(audio.vA.frequency, f0);
      const wobble = clamp(ball.strain, 0, 1.2) * (22 + 16 * Math.sin(globalT * 7.3));
      setP(audio.vB.frequency, f0 * 1.5 * Math.pow(2, wobble / 1200), 0.05);
      setP(audio.vC.frequency, f0 * 2 * Math.pow(2, (ball.strain * 10) / 1200));
      setP(audio.gC.gain, playing ? clamp((ball.alignHold - 0.6) / 1.6, 0, 1) * 0.5 : 0, 0.4);
      if (audio.pan) setP(audio.pan.pan, clamp((prevBX - cx) / (W * 0.6), -0.8, 0.8));
      const w = Math.abs(world.om);
      setP(audio.rush.gain, Math.pow(clamp((w - 1.2) / 6, 0, 1), 1.5) * 0.16 + clamp(speed / 190, 0, 1) * 0.025 * (status === "play" ? 1 : 0));
      setP(audio.bp.frequency, 280 + w * 260 + speed * 2);
      setP(audio.grainG.gain, clamp(w / 1.4, 0, 1) * (1 - clamp((w - 3) / 4, 0, 1)) * 0.07);
      try { audio.grains.playbackRate.setTargetAtTime(0.8 + w * 0.12, audio.ac.currentTime, 0.1); } catch (e) {}
    }
    const haptic = (k) => { try { ctx.platform.haptic(k); } catch (e) {} };

    // ---------- progress ----------
    const prog = ctx.game && ctx.game.progress;
    function saveProgress() {
      if (!prog || !prog.save) return;
      try {
        prog.save("main", {
          state: { level: unlocked, stars: stars.slice() }, label: "World " + String(Math.min(NLEV, unlocked + 1)).padStart(2, "0"),
          percent: Math.round((unlocked / NLEV) * 100), stateSchemaVersion: 1
        }).catch(() => {});
      } catch (e) {}
    }

    // ---------- UI flows ----------
    function setStatus(s) { status = s; statusT = 0; }
    function button(label, primary, fn) {
      const b = document.createElement("div");
      b.textContent = label; b.setAttribute("role", "button"); b.style.cssText = primary ? BTN_P : BTN;
      ctx.input.activate(b, fn);
      return b;
    }
    function dialog(title, starsN, sub, btns) {
      el.dtitle.textContent = title;
      el.dstars.innerHTML = starsN == null ? "" : [0, 1, 2].map((i) => `<span style="color:${i < starsN ? "#fff" : "rgba(255,255,255,0.18)"};text-shadow:${i < starsN ? "0 0 12px rgba(255,255,255,0.8)" : "none"}">✦</span>`).join("");
      el.dsub.textContent = sub || "";
      el.dbtns.innerHTML = "";
      for (const b of btns) el.dbtns.appendChild(b);
      show(el.dlg, true);
    }
    function hideDialog() { show(el.dlg, false); el.dbtns.innerHTML = ""; }
    function showCard() {
      el.cnum.textContent = lv.final ? "FINAL WORLD" : "WORLD " + String(lvIndex + 1).padStart(2, "0");
      el.cname.textContent = lv.name || "·";
      el.cname.style.textShadow = `0 0 18px ${rgb(lv.hue, 0.6)}`;
      el.chint.textContent = lv.hint;
      show(el.card, true);
      show(el.drag, !dragHintSeen || lvIndex < 2);
    }
    function hideCard() { show(el.card, false); show(el.drag, false); }

    function buildTitle() {
      el.tbtns.innerHTML = "";
      const cont = unlocked > 0 && unlocked < NLEV;
      el.tbtns.appendChild(button(cont ? "Continue · " + String(unlocked + 1).padStart(2, "0") : "Begin", true, () => startFromTitle(cont ? unlocked : 0)));
      el.grid.innerHTML = "";
      for (let i = 0; i < NLEV; i++) {
        const open = i <= unlocked;
        const d = document.createElement("div");
        d.style.cssText = `display:inline-block;width:38px;height:38px;line-height:38px;margin:3px 3px 12px;border-radius:50%;border:1px solid rgba(255,255,255,${open ? 0.3 : 0.08});color:rgba(255,255,255,${open ? 0.85 : 0.2});pointer-events:${open ? "auto" : "none"};cursor:pointer;position:relative`;
        d.innerHTML = String(i + 1).padStart(2, "0") + (stars[i] ? `<span style="position:absolute;left:0;right:0;top:34px;line-height:12px;font-size:7px;letter-spacing:1px;color:rgba(255,255,255,.7)">${"✦".repeat(stars[i])}</span>` : "");
        if (open) ctx.input.activate(d, () => startFromTitle(i));
        el.grid.appendChild(d);
      }
    }
    function startFromTitle(i) {
      initAudio();
      show(el.title, false); el.title.style.pointerEvents = "none";
      el.blk.style.opacity = "0";
      if (i !== lvIndex) loadLevel(i); else resetBall(true);
      enterReady();
    }
    function enterReady() {
      setStatus("ready"); hideDialog(); showCard(); show(el.hud, !lv.noUi);
      updateHud(true);
    }

    function beginAttempt() {
      attempts++;
      try { ctx.platform.start({ level: lvIndex + 1, attempt: attempts }); } catch (e) {}
      initAudio();
      setStatus("play"); hideCard(); dragHintSeen = true;
    }

    function fail(kind) {
      setStatus("failing");
      if (curGhost.length > 6) { ghosts.push({ pts: new Float32Array(curGhost), born: globalT }); if (ghosts.length > 7) ghosts.shift(); }
      curGhost = [];
      ball.failKind = kind;
      haptic("medium");
      try { ctx.platform.fail({ level: lvIndex + 1, reason: kind }); } catch (e) {}
      ctx.timeout(() => {
        if (status !== "failing") return;
        dialog("SLIPPED", null, ball.slipWhy, [button("Retry", true, retry)]);
      }, 650);
    }
    function retry() {
      if (status === "transition" || status === "title") return;
      hideDialog();
      resetBall(false);
      pathAlpha = Math.max(pathAlpha, 0.4);
      enterReady();
    }

    function succeed() {
      setStatus("aligned");
      const score = alignSamples ? Math.round((alignAccum / alignSamples) * 100) : 100;
      const par = routeLen / 118 + 2;
      const nStars = 1 + (sparksGot === sparks.length ? 1 : 0) + (playT <= par ? 1 : 0);
      result = { score, par, nStars, time: playT };
      stars[lvIndex] = Math.max(stars[lvIndex], nStars);
      unlocked = Math.max(unlocked, Math.min(NLEV - 1, lvIndex + 1));
      if (lv.final) unlocked = NLEV;
      saveProgress();
      chime(baseFreq() * 2, 0.12, 5); ctx.timeout(() => chime(baseFreq() * 3, 0.07, 4), 140);
      haptic("success");
      const b = project(ball.x, ball.y, ball.z);
      rings.push({ x: b.x, y: b.y, t: 0, c: lv.hue });
      burstScreen(b.x, b.y, 40, lv.hue);
      try { ctx.platform.milestone("aligned", { level: lvIndex + 1, alignment: score, attempts, stars: nStars }); } catch (e) {}
      try { ctx.platform.setProgress((lvIndex + 1) / NLEV); } catch (e) {}
      ctx.timeout(() => {
        if (status !== "aligned") return;
        setStatus("result");
        const sub = `TIME ${result.time.toFixed(1)}s  (par ${result.par.toFixed(0)}s)\nSPARKS ${sparksGot}/${sparks.length}   ·   ALIGNMENT ${score}%`;
        if (lv.final) {
          const total = stars.reduce((a, b2) => a + b2, 0);
          dialog("ORIENTED.", nStars, sub + `\n\n${total} / ${NLEV * 3} stars across every world`, [button("Retry", false, retry), button("Worlds", true, toTitle)]);
          try { ctx.pulse && ctx.pulse.complete && ctx.pulse.complete({ text: "ORIENTED.", level: NLEV, timeMs: Math.round(playT * 1000) }); } catch (e) {}
          try { ctx.platform.complete({ levels: NLEV, stars: total }); } catch (e) {}
          if (prog && prog.complete) { try { prog.complete("main").catch(() => {}); } catch (e) {} }
        } else {
          dialog("ALIGNED", nStars, sub, [button("Retry", false, retry), button("Next  →", true, goNext)]);
        }
      }, 700);
    }
    function toTitle() { hideDialog(); hideCard(); show(el.hud, false); buildTitle(); el.title.style.pointerEvents = "auto"; show(el.title, true); setStatus("title"); }

    // NEXT: the finished path bursts into light fragments that re-form as the next world.
    function goNext() {
      if (status !== "result") return;
      hideDialog();
      const N = quality ? 280 : 160;
      const from = samplePathScreen(N), bFrom = { x: prevBX, y: prevBY }, fromHue = lv.hue;
      loadLevel(lvIndex + 1);
      beginProjection();
      const to = samplePathScreen(N), b0 = project(ball.x, ball.y, ball.z), r = rng(lvIndex * 31 + 3);
      frag = { from, to, n: N, bFrom, bTo: { x: b0.x, y: b0.y }, fromHue, delay: new Float32Array(N).map(() => r() * 0.35), curl: new Float32Array(N).map(() => (r() - 0.5) * 140) };
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

    let hudT = 0;
    function updateHud(force) {
      hudT += 1; if (!force && hudT % 6) return;
      el.time.textContent = (status === "ready" ? 0 : playT).toFixed(1) + "s";
      el.sparks.textContent = "✦ " + sparksGot + "/" + sparks.length;
      let pr = 0;
      if (strands.length) {
        let before = 0;
        for (let p = strands[ball.strand].parent; p >= 0; p = strands[p].parent) before += strands[p].len;
        pr = clamp((before + ball.s) / routeLen, 0, 1);
      }
      el.bar.style.width = (status === "result" || status === "aligned" ? 100 : status === "ready" ? 0 : pr * 100).toFixed(1) + "%";
      const rot = Math.round((spinTotal * 180) / Math.PI);
      el.meta.textContent = "TURNED " + rot + "°";
    }

    // ---------- input ----------
    const input = ctx.input.track(canvas, { multitouch: false });
    let steerOverride = false, lastInteract = -10;
    function readInput() {
      if (steerOverride) return;
      const down = !!input.down, px = input.x, py = input.y;
      if (status === "failing" && statusT > 0.65 && (input.pressed || input.tap)) { retry(); return; }
      if (down && !world.dragging) {
        world.dragging = true; world.finger = world.th; world.lastPX = px; world.lastPY = py;
        if (status === "ready") beginAttempt();
      } else if (down) {
        // grab and turn: the finger's angle around the disc centre drives the disc;
        // close to the centre, where angles are unstable, a sideways drag turns it instead
        const a0 = Math.atan2(world.lastPY - ancY, world.lastPX - ancX), a1 = Math.atan2(py - ancY, px - ancX);
        let da = a1 - a0; da -= TAU * Math.round(da / TAU);
        const r = Math.hypot(px - ancX, py - ancY), w = smooth(24, 80, r);
        const dphi = (w * da + (1 - w) * (px - world.lastPX) * (2.5 / W)) * SENS;
        world.finger += dphi; world.lastPX = px; world.lastPY = py;
        if (Math.abs(dphi) > 0.002 && status === "play" && globalT - lastInteract > 2) { lastInteract = globalT; try { ctx.platform.interact({ type: "rotate" }); } catch (e) {} }
      } else world.dragging = false;
    }
    ctx.input.activate(el.restart, () => { if (status === "play" || status === "ready") retry(); });

    // ---------- debug hook (local harness only) ----------
    const DBG = typeof window !== "undefined" && window.__ORIENT_DEBUG__;
    if (DBG) {
      DBG.api = {
        get: () => ({ status, lvIndex, ball, world, strands, sparks, sparksGot }),
        steer(on) { steerOverride = on; world.dragging = on; if (on) world.finger = world.th; },
        setFinger(v) { world.finger = v; },
        start() { if (status === "title") startFromTitle(lvIndex); if (status === "ready") beginAttempt(); else if (status === "failing") retry(); },
        next() { goNext(); }
      };
    }

    // ---------- particles & rings ----------
    function freeParticle() { for (const p of particles) if (p.life <= 0) return p; return null; }
    function burstWorld(x, y, z, n, c, spd = 40) {
      for (let k = 0; k < n; k++) {
        const p = freeParticle(); if (!p) return;
        const a = Math.random() * TAU, s = spd * (0.3 + Math.random());
        Object.assign(p, { world: true, x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.7, c });
        p.max = p.life;
      }
    }
    function burstScreen(x, y, n, c) {
      for (let k = 0; k < n; k++) {
        const p = freeParticle(); if (!p) return;
        const a = Math.random() * TAU, s = 40 + Math.random() * 140;
        Object.assign(p, { world: false, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.9, c });
        p.max = p.life;
      }
    }
    function collect(sp) {
      burstWorld(sp.x, sp.y, sp.z, 14, lv.hue, 50);
      const b = project(sp.x, sp.y, sp.z);
      rings.push({ x: b.x, y: b.y, t: 0, c: lv.hue, small: true });
      chime(noteFreq(lv.key + 5 + sparksGot), 0.06, 1.6);
      haptic("light");
    }
    function spawnStrain(dt) {
      if (status !== "play" || ball.strain < 0.55 || !quality) return;
      let n = (ball.strain - 0.55) * 50 * dt;
      while (n > 0 && Math.random() < n) {
        n -= 1;
        const p = freeParticle(); if (!p) return;
        const off = (Math.random() - 0.5) * 50, sp = 8 + Math.random() * 18, sgn = Math.random() < 0.5 ? -1 : 1;
        Object.assign(p, {
          world: true, x: ball.x - ball.tx * off, y: ball.y - ball.ty * off, z: ball.z,
          vx: -ball.ty * sp * sgn, vy: ball.tx * sp * sgn, life: 0.5 + Math.random() * 0.6, c: [255, 190, 120]
        });
        p.max = p.life;
      }
    }

    // ---------- rendering ----------
    function drawAtmosphere(t) {
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      if (bgImg) { g.imageSmoothingEnabled = true; g.drawImage(bgImg, 0, 0, W, H); }
      else {
        const gr = g.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, DIAG * 0.62);
        gr.addColorStop(0, "rgb(17,20,27)"); gr.addColorStop(0.45, "rgb(9,11,15)"); gr.addColorStop(1, "rgb(1,1,2)");
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = "lighter";
      const nb = quality ? haze.length : Math.min(3, haze.length);
      for (let i = 0; i < nb; i++) {
        const h = haze[i], a = h.a + world.thFar * 0.5 + Math.sin(t * 0.05 + h.ph) * 0.1;
        g.globalAlpha = h.alpha * HAZE * (0.8 + 0.2 * Math.sin(t * 0.11 + h.ph));
        sprite(h.spr, cx + Math.cos(a) * h.rad, cy + Math.sin(a) * h.rad, h.size);
      }
    }

    // The plate: a disc of faint light with a dot lattice and a ticked rim, all turning with the world.
    function drawDisc(t) {
      if (lv.noGrid) return;
      const R = DR * SC, hue = lv.hue;
      g.globalCompositeOperation = "lighter";
      const gr = g.createRadialGradient(ancX, ancY, R * 0.1, ancX, ancY, R);
      gr.addColorStop(0, rgb(mix3(hue, [0, 0, 0], 0.9), 0.5)); gr.addColorStop(0.85, rgb(mix3(hue, [0, 0, 0], 0.93), 0.35)); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = pathAlpha; g.fillStyle = gr;
      g.beginPath(); g.arc(ancX, ancY, R, 0, TAU); g.fill();
      // lattice
      g.fillStyle = rgb(mix3(hue, [255, 255, 255], 0.5));
      for (let i = 0; i < grid.length; i += 3) {
        project(grid[i], grid[i + 1], 0);
        g.globalAlpha = (0.22 - 0.12 * grid[i + 2]) * pathAlpha;
        g.fillRect(P.x - 0.9, P.y - 0.9, 1.8, 1.8);
      }
      // rim with ticks; four long marks make every degree of turn visible
      g.strokeStyle = rgb(mix3(hue, [255, 255, 255], 0.4)); g.lineWidth = 1;
      g.globalAlpha = 0.35 * pathAlpha;
      g.beginPath(); g.arc(ancX, ancY, R, 0, TAU); g.stroke();
      g.beginPath();
      for (let k = 0; k < 72; k++) {
        const a = world.th + (k / 72) * TAU, big = k % 18 === 0, mid = k % 6 === 0;
        const l = big ? 14 : mid ? 8 : 4, ca = Math.cos(a), sa = Math.sin(a);
        g.moveTo(ancX + ca * R, ancY + sa * R); g.lineTo(ancX + ca * (R + l), ancY + sa * (R + l));
      }
      g.globalAlpha = 0.5 * pathAlpha; g.stroke();
      // a single bright notch marks the disc's own "north" so rotation is always legible
      const na = world.th - Math.PI / 2;
      g.globalAlpha = 0.9 * pathAlpha; g.fillStyle = rgb(mix3(hue, [255, 255, 255], 0.6));
      g.beginPath(); g.arc(ancX + Math.cos(na) * (R + 20), ancY + Math.sin(na) * (R + 20), 2.6, 0, TAU); g.fill();
      // gravity: fixed to the room, never turns
      const gy = ancY + R + 34;
      if (gy < H - 40) {
        g.globalAlpha = 0.6; g.strokeStyle = "rgb(230,236,245)"; g.lineWidth = 1.2;
        const bob = Math.sin(t * 3) * 2;
        g.beginPath(); g.moveTo(ancX - 7, gy - 4 + bob); g.lineTo(ancX, gy + 3 + bob); g.lineTo(ancX + 7, gy - 4 + bob); g.stroke();
        g.globalAlpha = 0.3;
        g.beginPath(); g.moveTo(ancX - 7, gy - 11 + bob); g.lineTo(ancX, gy - 4 + bob); g.lineTo(ancX + 7, gy - 11 + bob); g.stroke();
      }
    }

    function drawGhosts() {
      if (!ghosts.length) return;
      g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
      for (let k = 0; k < ghosts.length; k++) {
        const gh = ghosts[k], pts = gh.pts, age = globalT - gh.born;
        const base = (0.04 + 0.12 * Math.exp(-age / 5)) * (0.55 + 0.45 * ((k + 1) / ghosts.length)) * pathAlpha;
        if (base < 0.004) continue;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 3) { project(pts[i], pts[i + 1], pts[i + 2]); if (i === 0) g.moveTo(P.x, P.y); else g.lineTo(P.x, P.y); }
        g.strokeStyle = "rgb(230,190,150)";
        g.globalAlpha = base * 0.35; g.lineWidth = 9; g.stroke();
        g.setLineDash([0.5, 5]); g.globalAlpha = base; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      }
    }

    const CH = 9;
    function chunkAlpha(st, i, t) {
      let a = pathAlpha;
      if (st.dead) a *= 1 - smooth(st.len * 0.25, st.len * 0.95, st.s[i]);
      const flick = lv.flicker || 0.1;
      if (status !== "aligned" && status !== "result") a *= 1 - flick * (0.5 + 0.5 * noise1(st.s[i] * 0.005 + t * 0.06 + st.id * 3.7));
      const dx = st.x[i] - ball.x, dy = st.y[i] - ball.y, dd = dx * dx + dy * dy;
      if (lv.memory) a *= memVis + (1 - memVis) * Math.exp(-dd / (60 * 60)) * 0.8;
      a *= 1 + Math.exp(-dd / (90 * 90)) * (0.5 + ball.strain * 0.6);
      return a * lit;
    }

    function drawPaths(t) {
      g.globalCompositeOperation = "lighter"; g.lineCap = "butt"; g.lineJoin = "round";
      const speedN = clamp(Math.hypot(ball.vx, ball.vy) / 190, 0, 1);
      const strain = clamp(ball.strain, 0, 1.2);
      const coreW = clamp(1.7 * (1 + 0.3 * speedN + 0.5 * strain) * (status === "result" ? 1.3 : 1), 0.8, 3);
      const haloW = 7 + 3.5 * strain + 1.5 * speedN, fieldW = 22 + 8 * strain;
      const shake = status === "play" ? clamp((ball.strain - 0.6) * 1.6, 0, 1) : 0;
      const hue = lv.hue;
      const litAll = status === "aligned" || status === "result";
      const chunks = [];
      for (const st of strands) {
        const ballStrand = st.id === ball.strand;
        for (let i = 0; i < st.n; i++) {
          project(st.x[i], st.y[i], st.z[i]);
          let sx = P.x, sy = P.y;
          if (shake > 0.02 && ballStrand) {
            const ds = st.s[i] - ball.s, fall = Math.exp(-(ds * ds) / (70 * 70));
            if (fall > 0.02) {
              const tn = tangentAt(st, i), nxs = -(sinT * tn.x + cosT * tn.y), nys = cosT * tn.x - sinT * tn.y;
              const amp = shake * shake * 1.4 * fall * Math.sin(t * 41 + st.s[i] * 0.23) + shake * fall * Math.sin(t * 13 - st.s[i] * 0.05);
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
          const mid = Math.min(st.n - 1, i + (CH >> 1));
          const a = chunkAlpha(st, mid, t);
          if (a < 0.01) continue;
          const on = litAll || litSet.has(st.id) || (ballStrand && st.s[mid] < ball.s && status !== "ready");
          chunks.push({ st, i, j, a, on, z: st.z[mid] });
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
      const layer = (color, width, alpha) => { g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = clamp(alpha, 0, 1); g.stroke(); };
      const cField = rgb(mix3(hue, [30, 40, 60], 0.4)), cHalo = rgb(hue), cCore = rgb(mix3(hue, [255, 255, 255], 0.72)), cDim = rgb(mix3(hue, [255, 255, 255], 0.35));
      for (const c of chunks) {
        const zf = lv.depth ? 1 - 0.5 * clamp((c.z + 1) / 2, 0, 1) : 1, k = lv.depth ? 1 / (1 + 0.24 * c.z) : 1;
        const on = c.on ? 1 : 0.5;
        trace(c);
        if (lv.depth && c.z < -0.25) {
          g.globalCompositeOperation = "source-over";
          layer("rgb(6,7,10)", 6 * k, 0.7 * smooth(-0.25, -0.7, c.z));
          g.globalCompositeOperation = "lighter";
        }
        if (quality) layer(cField, fieldW * k, 0.035 * c.a * zf * (0.6 + on * 0.6));
        layer(cHalo, haloW * k * (c.on ? 1.25 : 1), 0.11 * c.a * zf * (0.5 + on));
        layer(c.on ? cCore : cDim, coreW * k * (c.on ? 1.2 : 1), 0.75 * c.a * zf * zf * on);
      }
      const glow = levelSprites(lvIndex).glow;
      for (const st of strands) for (let i = 0; i < st.n - 2; i++) {
        if (st.segGap[i] !== st.segGap[i + 1]) { g.globalAlpha = 0.5 * pathAlpha * lit; sprite(glow, st.sx[i + 1], st.sy[i + 1], 22); }
      }
      // signal pulses racing ahead of the ball along the filament
      if ((status === "play" || status === "ready") && !(lv.memory && memVis < 0.5)) {
        const st = strands[ball.strand];
        for (let k = 0; k < 3; k++) {
          const ds = (t * 260 + k * 160) % 480, i = Math.round((ball.s + 20 + ds) / STEP);
          if (i >= st.n - 1 || st.segGap[i]) continue;
          g.globalAlpha = 0.55 * (1 - ds / 480) * pathAlpha; sprite(glow, st.sx[i], st.sy[i], 12);
        }
      }
    }

    function drawGoalAndSparks(t) {
      g.globalCompositeOperation = "lighter";
      const sp = levelSprites(lvIndex), hue = lv.hue;
      for (const s of sparks) {
        if (s.got) continue;
        project(s.x, s.y, s.z);
        if (P.x < -20 || P.x > W + 20 || P.y < -20 || P.y > H + 20) continue;
        const vis = lv.memory ? Math.max(memVis, 0.35) : 1, r = 4 + Math.sin(t * 4 + s.ph);
        g.globalAlpha = 0.6 * pathAlpha * vis; sprite(sp.glow, P.x, P.y, 26);
        g.save(); g.translate(P.x, P.y); g.rotate(t * 1.2 + s.ph);
        g.strokeStyle = "rgb(255,255,255)"; g.lineWidth = 1; g.globalAlpha = 0.9 * pathAlpha * vis;
        g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r); g.stroke();
        g.restore();
      }
      // the goal: a slow ring of light at the end of the living line
      project(endPt.x, endPt.y, endPt.z);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.6), R = 13 + pulse * 3;
      g.globalAlpha = (0.55 + 0.3 * pulse) * pathAlpha; sprite(sp.glow, P.x, P.y, 70);
      g.strokeStyle = rgb(mix3(hue, [255, 255, 255], 0.6)); g.lineWidth = 1.4; g.globalAlpha = 0.9 * pathAlpha;
      g.beginPath(); g.arc(P.x, P.y, R, 0, TAU); g.stroke();
      g.globalAlpha = 0.35 * pathAlpha; g.setLineDash([2, 5]); g.lineWidth = 1;
      g.beginPath(); g.arc(P.x, P.y, R + 9, t * 0.8, t * 0.8 + TAU); g.stroke(); g.setLineDash([]);
    }

    function drawParticles(dt) {
      g.globalCompositeOperation = "lighter";
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97;
        let x = p.x, y = p.y;
        if (p.world) { project(p.x, p.y, p.z); x = P.x; y = P.y; }
        g.fillStyle = rgb(mix3(p.c, [255, 255, 255], 0.5));
        g.globalAlpha = 0.85 * (p.life / p.max);
        g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.t += dt;
        const T = r.t / (r.small ? 0.5 : 1.1);
        if (T >= 1) { rings.splice(i, 1); continue; }
        g.strokeStyle = rgb(mix3(r.c, [255, 255, 255], 0.5)); g.lineWidth = r.small ? 1 : 1.5;
        g.globalAlpha = (1 - T) * (r.small ? 0.7 : 0.85);
        g.beginPath(); g.arc(r.x, r.y, (r.small ? 6 : 10) + T * (r.small ? 26 : MIN * 0.6), 0, TAU); g.stroke();
      }
    }

    function drawBall(t) {
      if (status === "transition" || status === "title") return;
      project(ball.x, ball.y, ball.z);
      const bx = P.x, by = P.y, k = P.k / SC;
      const speed = Math.hypot(ball.vx, ball.vy), w = Math.abs(world.om);
      const vis = ball.fade * (1 - ball.sink * 0.85);
      if (vis <= 0.005) { prevBX = bx; prevBY = by; return; }
      const core = clamp(MIN / 100, 3.2, 5) * k * ball.scale * (1 - ball.sink * 0.5);
      const strain = clamp(ball.strain, 0, 1);
      const sp = levelSprites(lvIndex);

      if (history.length > 2 && (w > 0.9 || speed > 140)) {
        const amt = clamp((w - 0.9) / 3, 0, 1) * 0.8 + clamp((speed - 140) / 120, 0, 1) * 0.4;
        const sc = cosT, ss = sinT;
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < history.length; i += 2) {
          const h = history[i], f = i / history.length, th = lerp(h.th, world.th, 0.45);
          cosT = Math.cos(th); sinT = Math.sin(th);
          project(h.x, h.y, h.z);
          g.globalAlpha = amt * 0.1 * f * vis; sprite(SPR_WHITE, P.x, P.y, core * 5 * (0.6 + f * 0.4));
        }
        cosT = sc; sinT = ss;
      }
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.16 * vis; sprite(sp.glow, bx, by, core * 34);
      if (strain > 0.3) { g.globalAlpha = (strain - 0.3) * 0.5 * vis * (0.7 + 0.3 * Math.sin(t * 24)); sprite(SPR_WARM, bx, by, core * 22); }
      if (!lv.noShadow) {
        const skew = (lv.skew || 0) * (0.55 + 0.45 * Math.sin(t * 0.21)) + (lv.skew || 0) * 0.35 * noise1(t * 0.3);
        const sd = core * 2.6 * (1 + 0.3 * ball.z);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.5 * vis;
        sprite(SPR_DARK, bx + Math.sin(-skew) * sd, by + Math.cos(skew) * sd, core * 7);
        g.globalCompositeOperation = "lighter";
      }
      if (haveBPrev && speed > 30) {
        const mx = bx - prevBX, my = by - prevBY, ml = Math.hypot(mx, my);
        if (ml > 0.5 && ml < 60) {
          g.strokeStyle = "rgb(245,250,255)"; g.lineCap = "round";
          g.globalAlpha = clamp(speed / 240, 0, 0.6) * vis; g.lineWidth = core * 1.1;
          g.beginPath(); g.moveTo(bx - mx * 2, by - my * 2); g.lineTo(bx, by); g.stroke();
        }
      }
      // tolerance fan: straight down, plus how far the line may lean before the grip gives way
      if (!lv.noShadow && (status === "play" || status === "ready")) {
        const A = Math.asin(Math.min(0.99, lv.hold * HOLD));
        const stx = cosT * ball.tx - sinT * ball.ty, sty = sinT * ball.tx + cosT * ball.ty;
        const lean = Math.acos(clamp(Math.abs(sty), 0, 1));
        const warn = smooth(A * 0.65, A, lean), R0 = core * 2.5, R1 = 44;
        const col = mix3([235, 240, 250], [255, 150, 70], warn);
        g.globalCompositeOperation = "lighter";
        g.fillStyle = rgb(col); g.globalAlpha = (0.07 + 0.16 * warn) * vis;
        g.beginPath(); g.moveTo(bx, by);
        g.arc(bx, by, R1, Math.PI / 2 - A, Math.PI / 2 + A); g.closePath(); g.fill();
        g.strokeStyle = rgb(col); g.lineWidth = 1; g.globalAlpha = (0.3 + 0.4 * warn) * vis;
        g.beginPath();
        g.moveTo(bx + Math.cos(Math.PI / 2 - A) * R0, by + Math.sin(Math.PI / 2 - A) * R0); g.lineTo(bx + Math.cos(Math.PI / 2 - A) * R1, by + Math.sin(Math.PI / 2 - A) * R1);
        g.moveTo(bx + Math.cos(Math.PI / 2 + A) * R0, by + Math.sin(Math.PI / 2 + A) * R0); g.lineTo(bx + Math.cos(Math.PI / 2 + A) * R1, by + Math.sin(Math.PI / 2 + A) * R1);
        g.stroke();
        g.setLineDash([2, 4]); g.globalAlpha = 0.5 * vis;
        g.beginPath(); g.moveTo(bx, by + R0); g.lineTo(bx, by + R1); g.stroke(); g.setLineDash([]);
        // the line's own direction through the ball, drawn across the fan
        const sgn = sty >= 0 ? 1 : -1;
        g.strokeStyle = rgb(warn > 0.99 ? [255, 120, 60] : [255, 255, 255]); g.lineWidth = 1.6; g.globalAlpha = 0.8 * vis;
        g.beginPath(); g.moveTo(bx + stx * sgn * R0, by + sty * sgn * R0); g.lineTo(bx + stx * sgn * (R1 + 4), by + sty * sgn * (R1 + 4)); g.stroke();
      }
      g.globalAlpha = 0.6 * vis; sprite(SPR_WHITE, bx, by, core * 8);
      g.globalAlpha = 0.95 * vis; sprite(SPR_WHITE, bx, by, core * 3);
      g.globalAlpha = vis; g.fillStyle = "rgb(255,255,255)";
      g.beginPath(); g.arc(bx, by, core * 0.6, 0, TAU); g.fill();
      prevBX = bx; prevBY = by; haveBPrev = true;
    }

    function drawTransition() {
      if (!frag) return;
      const T = clamp(statusT / 1.0, 0, 1);
      g.globalCompositeOperation = "lighter";
      const { from, to, n, delay, curl } = frag;
      const cA = rgb(mix3(frag.fromHue, [255, 255, 255], 0.5)), cB = rgb(mix3(lv.hue, [255, 255, 255], 0.5));
      for (let i = 0; i < n; i++) {
        const u = clamp((T - delay[i]) / 0.65, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const bend = Math.sin(u * Math.PI) * curl[i];
        const x0 = from[i * 2], y0 = from[i * 2 + 1], x1 = to[i * 2], y1 = to[i * 2 + 1];
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
        g.fillStyle = u < 0.5 ? cA : cB;
        g.globalAlpha = (0.35 + 0.6 * Math.sin(u * Math.PI)) * (1 - smooth(0.85, 1, T));
        g.fillRect(lerp(x0, x1, e) - (dy / L) * bend - 0.9, lerp(y0, y1, e) + (dx / L) * bend - 0.9, 1.8, 1.8);
      }
      const bu = smooth(0.05, 0.85, T);
      g.globalAlpha = 0.9; sprite(SPR_WHITE, lerp(frag.bFrom.x, frag.bTo.x, bu), lerp(frag.bFrom.y, frag.bTo.y, bu), 12);
    }

    let grainTick = 0, grainOX = 0, grainOY = 0;
    function drawGrain() {
      if (!grainPattern || !quality || GRAIN <= 0) return;
      if (++grainTick % 3 === 0) { grainOX = Math.random() * 128; grainOY = Math.random() * 128; }
      g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.07 * GRAIN;
      g.save(); g.translate(-grainOX, -grainOY); g.fillStyle = grainPattern; g.fillRect(0, 0, W + 128, H + 128); g.restore();
      g.globalCompositeOperation = "source-over";
    }

    // ---------- loop ----------
    function fixedUpdate(stepMs) {
      const dt = stepMs / 1000;
      worldStep(dt);
      if (status === "play") {
        const r = physics(dt);
        playT += dt; alignAccum += ball.align; alignSamples++;
        if (r === "aligned") succeed(); else if (r) fail(r);
      } else if (status === "failing") {
        freePhysics(dt);
        if (ball.failKind === "sank") { ball.scale = Math.max(0, ball.scale - dt * 1.2); ball.z += dt * 0.6; }
      } else if (status === "aligned" || status === "result") {
        const st = strands[ball.strand], ex = st.x[st.n - 1], ey = st.y[st.n - 1];
        ball.x += (ex - ball.x) * damp(5, dt); ball.y += (ey - ball.y) * damp(5, dt);
        ball.vx *= 1 - damp(6, dt); ball.vy *= 1 - damp(6, dt);
      }
    }

    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      globalT += dt; statusT += dt;
      readInput();
      world.thNear += (world.th * 0.99 - world.thNear) * damp(14, dt);
      world.thFar += (world.th * 0.96 - world.thFar) * damp(lv.farK || 3, dt);
      speedSm += (clamp(Math.hypot(ball.vx, ball.vy) / 190, 0, 1) * (status === "play" ? 1 : 0) - speedSm) * damp(1.5, dt);
      if (status === "failing") pathAlpha = Math.max(0.3, pathAlpha - dt / 0.6);
      else if (status === "transition") pathAlpha = smooth(0.55, 1, statusT / 1.0);
      else pathAlpha = Math.min(1, pathAlpha + dt / 0.35);
      lit += ((status === "aligned" || status === "result" ? 1.8 : 1) - lit) * damp(4, dt);
      if (lv.memory) {
        const target = status === "play" ? 1 - smooth(3.5, 5.5, playT) : 1;
        memVis += (target - memVis) * damp(4, dt);
      } else memVis = 1;
      if (status === "transition" && statusT > 1.0) { frag = null; enterReady(); }

      histTimer += dt;
      if (histTimer > 0.035) { histTimer = 0; history.push({ x: ball.x, y: ball.y, z: ball.z, th: world.th }); if (history.length > 22) history.shift(); }
      if (status === "play" || (status === "failing" && statusT < 1)) {
        ghostTimer += dt;
        if (ghostTimer > 0.05 && curGhost.length < 900) { ghostTimer = 0; curGhost.push(ball.x, ball.y, ball.z); }
      }
      if (status === "play" && ball.strain > 0.85 && Math.random() < dt * 6) haptic("light");
      spawnStrain(dt);
      updateAudio(dt);
      if (status === "play" || status === "result") updateHud(false);
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
      drawDisc(t);
      drawGhosts();
      if (status === "transition") drawTransition();
      if (status !== "transition" || statusT > 0.55) { drawPaths(t); drawGoalAndSparks(t); }
      drawParticles(dt);
      drawBall(t);
      drawGrain();
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }

    // ---------- boot ----------
    if (prog && prog.load) {
      try {
        const saved = await Promise.race([prog.load("main"), new Promise((r) => ctx.timeout(() => r(null), 1500))]);
        const st = saved && saved.state;
        if (st && Number.isInteger(st.level) && saved.resumeEligible !== false) {
          unlocked = clamp(st.level, 0, NLEV);
          if (Array.isArray(st.stars)) st.stars.forEach((v, i) => { if (i < NLEV && Number.isInteger(v)) stars[i] = clamp(v, 0, 3); });
        }
      } catch (e) {}
    }
    const firstLevel = START_LEVEL > 1 ? clamp(START_LEVEL - 1, 0, NLEV - 1) : clamp(unlocked, 0, NLEV - 1);
    if (START_LEVEL > 1) unlocked = Math.max(unlocked, firstLevel);
    loadLevel(firstLevel);
    buildTitle();
    beginProjection(); project(ball.x, ball.y, ball.z); hazeX = P.x; hazeY = P.y;
    render(0, null);
    ctx.game.loop({ fixedHz: 120, maxSubsteps: 8, input, fixedUpdate, update, render });
    ctx.platform.ready();
  }
};
