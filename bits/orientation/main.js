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

    // Each world: geometry, the rules that govern it, its light, and one line of guidance.
    const LEVELS = [
      {
        name: "STRAIGHT", hint: "Drag left or right to tilt the world. Roll the light to the ring.",
        hue: [140, 205, 255], hold: 1.35, horizon: "world", key: 0,
        build: () => [makeStrand(trace([["S", 820]], O), { final: true })]
      },
      {
        name: "CURVE", hint: "Turn with the line. Keep it pointing down.",
        hue: [110, 235, 220], hold: 1.12, horizon: "world", key: 2,
        build: () => [makeStrand(trace([["S", 150], ["A", 260, 80], ["A", 240, -110], ["A", 260, 90], ["S", 200]], O), { final: true })]
      },
      {
        name: "BRAKE", hint: "Too fast and the curve throws you off. Tilt back to slow down.",
        hue: [255, 196, 120], hold: 1.0, horizon: "world", key: 4,
        build: () => [makeStrand(trace([["S", 380], ["A", 95, 100], ["S", 240], ["A", 90, -130], ["S", 220], ["A", 100, 110], ["S", 160]], O), { final: true })]
      },
      {
        name: "MOMENTUM", hint: "The world is heavy now. Let go early — it keeps turning.",
        hue: [200, 165, 255], hold: 1.05, horizon: "world", key: 7, inertia: 2.6, zeta: 0.45, spinDamp: 0.55,
        build: () => [makeStrand(trace([["S", 140], ["A", 220, 90], ["S", 80], ["A", 200, -150], ["S", 80], ["A", 230, 120], ["S", 160]], O), { final: true })]
      },
      {
        name: "LOOP", hint: "All the way around. Keep turning with it.",
        hue: [120, 240, 175], hold: 1.05, horizon: "world", key: 9,
        build: () => [makeStrand(trace([["S", 180], ["A", 220, 180], ["A", 170, 180], ["S", 120], ["A", 220, -90], ["S", 200]], O), { final: true })]
      },
      {
        name: "GAP", hint: "The line breaks. Build speed — momentum carries you across.",
        hue: [255, 160, 175], hold: 1.0, horizon: "world", key: 11,
        build: () => [makeStrand(trace([
          ["S", 200], ["A", 280, 45], ["S", 200, [70, 130]], ["A", 260, -80],
          ["S", 240, [80, 160]], ["A", 300, 50], ["S", 260, [90, 185]], ["S", 140]
        ], O), { final: true })]
      },
      {
        name: "FORK", hint: "Lean before the split to choose. One branch fades into nothing.",
        hue: [175, 205, 255], hold: 1.0, horizon: "world", key: 14,
        build() {
          const t0 = trace([["S", 170], ["A", 260, 40], ["S", 120]], O);
          const a = trace([["A", 300, -42], ["S", 260]], t0.end);
          const b = trace([["A", 300, 42], ["S", 150], ["A", 250, -70], ["S", 110]], t0.end);
          const c = trace([["A", 300, 42], ["S", 230]], b.end);
          const d = trace([["A", 300, -42], ["S", 120], ["A", 260, 60], ["S", 220]], b.end);
          const S = [makeStrand(t0), makeStrand(a, { dead: true }), makeStrand(b), makeStrand(c, { dead: true }), makeStrand(d, { final: true })];
          link(S, 0, [1, 2]); link(S, 2, [3, 4]);
          return S;
        }
      },
      {
        name: "MEMORY", hint: "Study it. After a few seconds the line disappears.",
        hue: [225, 240, 150], hold: 1.0, horizon: "world", key: 16, memory: true, flicker: 0.25,
        build: () => [makeStrand(trace([["S", 130], ["A", 240, 80], ["A", 210, -125], ["S", 140], ["A", 250, 140], ["S", 70], ["A", 230, -105], ["S", 220]], O), { final: true })]
      },
      {
        name: "DEPTH", hint: "It passes behind itself. Stay on your own strand.",
        hue: [150, 220, 255], hold: 1.0, horizon: "stable", key: 19, depth: true, skew: 0.35, farK: 2.2,
        build() {
          const X = [], Y = [], Z = [], K = 180, t0 = 0.55, span = TAU - 0.5;
          for (let i = 0; i <= 1600; i++) {
            const t = t0 + (span * i) / 1600;
            X.push(K * (Math.sin(t) + 2 * Math.sin(2 * t))); Y.push(K * (Math.cos(t) - 2 * Math.cos(2 * t))); Z.push(-Math.sin(3 * t));
          }
          return [makeStrand(resample(X, Y, Z), { final: true })];
        }
      },
      {
        name: "DRIFT", hint: "The world turns by itself now. Hold it steady.",
        hue: [255, 175, 115], hold: 1.0, horizon: "stable", key: 21, auto: 1.1, skew: 0.6, farK: 1.2, spinDamp: 1.6,
        build: () => [makeStrand(trace([["S", 150], ["A", 280, 70], ["A", 260, -120], ["S", 100], ["A", 280, 100], ["A", 250, -80], ["S", 120], ["A", 300, 60], ["S", 200]], O), { final: true })]
      },
      {
        name: "SYMMETRY", hint: "Go all the way around. Watch the rotation count.",
        hue: [205, 175, 255], hold: 1.0, horizon: "none", key: 23, fixedCam: true, symmetric: true, skew: 0.8, farK: 1.4,
        rose: { R: 250, A: 12, k: 6 },
        build() {
          const X = [], Y = [], { R, A, k } = this.rose;
          for (let i = 0; i <= 2400; i++) { const p = (TAU * i) / 2400, r = R + A * Math.cos(k * p); X.push(r * Math.cos(p)); Y.push(r * Math.sin(p)); }
          return [makeStrand(resample(X, Y, null), { final: true })];
        }
      },
      {
        name: "NO UP", hint: "", hue: [236, 238, 250], hold: 1.0, horizon: "none", key: 12, auto: 0.45,
        noShadow: true, noMotes: true, farK: 0.9, flicker: 0.2, final: true,
        build() {
          const r = rng(7331), cmds = [["S", 160]];
          let sign = 1;
          for (let i = 0; i < 9; i++) {
            cmds.push(["A", 260 + r() * 150, sign * (45 + r() * 65)]);
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
      <div data-k="card" class="or-fade" style="position:absolute;left:24px;right:24px;top:17%;text-align:center;opacity:0;pointer-events:none">
        <div data-k="cnum" style="font-size:11px;letter-spacing:0.5em;opacity:0.6;padding-left:0.5em">WORLD 01</div>
        <div data-k="cname" style="font-size:26px;letter-spacing:0.42em;margin-top:10px;color:#fff;padding-left:0.42em">STRAIGHT</div>
        <div data-k="chint" style="font-size:11px;letter-spacing:0.12em;line-height:1.7;margin-top:14px;text-transform:none;opacity:0.85"></div>
      </div>
      <div data-k="drag" class="or-fade" style="position:absolute;left:0;right:0;bottom:calc(var(--bottom,20px) + 70px);text-align:center;opacity:0;pointer-events:none">
        <div style="position:relative;height:30px">
          <div style="position:absolute;left:50%;top:9px;width:120px;margin-left:-60px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)"></div>
          <div style="position:absolute;left:50%;top:0;margin-left:-9px;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.8);animation:or-sway 2.2s ease-in-out infinite"></div>
        </div>
        <div style="font-size:9px;letter-spacing:0.4em;opacity:0.7;margin-top:6px;padding-left:0.4em">DRAG TO TILT</div>
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
          <div style="font-size:11px;letter-spacing:0.2em;margin-top:14px;opacity:0.7;text-transform:none">Tilt the world. Guide the light.</div>
          <div style="margin:32px auto 0;max-width:300px;text-align:left;font-size:11px;line-height:1.75;letter-spacing:0.06em;text-transform:none;opacity:0.9">
            <div style="margin-bottom:12px"><span style="color:#fff">◐&nbsp; Drag left or right</span> to rotate the whole world. You never move the ball.</div>
            <div style="margin-bottom:12px"><span style="color:#fff">↓&nbsp; Gravity always pulls down.</span> Point the line downhill and the ball rolls along it.</div>
            <div style="margin-bottom:12px"><span style="color:#fff">◌&nbsp; Reach the ring</span> without slipping off. Tilt uphill to brake before tight curves.</div>
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
    const world = { th: 0, om: 0, finger: 0, dragging: false, thNear: 0, thFar: 0, th0: 0, lastPX: 0 };
    const cam = { x: 0, y: 0 };
    const ball = {
      x: 0, y: 0, vx: 0, vy: 0, z: 0, strand: 0, idx: 0, s: 0, d: 0, tx: 1, ty: 0, kappa: 0,
      offT: 0, sink: 0, inGap: false, align: 1, strain: 0, alignHold: 0, fade: 1, scale: 1, slipWhy: ""
    };
    let lvIndex = 0, lv = LEVELS[0], strands = [], status = "title", statusT = 0, globalT = 0;
    let attempts = 0, alignAccum = 0, alignSamples = 0, pathAlpha = 1, lit = 1, memVis = 1, playT = 0;
    let routeLen = 1, sparks = [], sparksGot = 0, endPt = { x: 0, y: 0, z: 0 }, litSet = new Set();
    let haze = [], motes = [], fallers = [], ghosts = [], curGhost = [], ghostTimer = 0;
    const history = []; let histTimer = 0;
    const particles = []; for (let i = 0; i < 160; i++) particles.push({ life: 0 });
    const rings = [];
    let frag = null, quality = 1, lowFpsT = 0, prevBX = 0, prevBY = 0, haveBPrev = false, spinTotal = 0;
    let speedSm = 0, hazeX = 0, hazeY = 0, dragHintSeen = false, result = null;
    let unlocked = 0; const stars = new Array(NLEV).fill(0);

    function setupAtmosphere() {
      const r = rng(1000 + lvIndex * 17), sp = levelSprites(lvIndex);
      haze = [];
      if (!lv.symmetric) for (let i = 0; i < 7; i++) haze.push({
        a: r() * TAU, rad: (0.12 + r() * 0.55) * DIAG, size: (0.55 + r() * 0.8) * DIAG,
        spr: r() < 0.55 ? sp.haze : sp.haze2, alpha: 0.07 + r() * 0.08, drift: (r() - 0.5) * 0.04, ph: r() * TAU
      });
      motes = [];
      if (!lv.symmetric) for (let i = 0; i < 46; i++) motes.push({ a: r() * TAU, rad: Math.sqrt(r()) * 0.75 * DIAG, depth: 0.2 + r() * 0.8, tw: r() * TAU, sz: 0.5 + r() * 1 });
      fallers = [];
      if (!lv.noMotes && lvIndex < 9) for (let i = 0; i < 28; i++) fallers.push({ x: r(), y: r(), v: 0.012 + r() * 0.03, sz: 0.6 + r() * 0.9, a: 0.05 + r() * 0.12 });
    }

    // ---------- projection: the world pivots around the ball ----------
    const P = { x: 0, y: 0, k: 1 };
    let cosT = 1, sinT = 0, SC = 1, parX = 0, parY = 0, ancX = 0, ancY = 0;
    function baseScale() { return lv.fixedCam ? (MIN * 0.41) / (lv.rose.R + lv.rose.A) : MIN / 470; }
    function beginProjection() {
      cosT = Math.cos(world.th); sinT = Math.sin(world.th);
      SC = baseScale() * (lv.fixedCam ? 1 : 1 - 0.16 * speedSm);
      ancX = cx; ancY = lv.fixedCam ? cy : H * 0.4;
      if (lv.depth) { parX = 16 * Math.cos(world.thFar * 1.3 + 0.7) - world.om * 4; parY = 16 * Math.sin(world.thFar * 1.3 + 0.7); }
      else { parX = 0; parY = 0; }
    }
    function project(x, y, z) {
      const dx = x - cam.x, dy = y - cam.y, k = SC / (1 + 0.24 * z);
      P.x = ancX + (cosT * dx - sinT * dy) * k + z * parX;
      P.y = ancY + (sinT * dx + cosT * dy) * k + z * parY;
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
      routeLen = 0;
      let st = strands[0];
      for (;;) { routeLen += st.len; const nx = st.next.map((k) => strands[k]).find((q) => !q.dead); if (!nx) break; st = nx; }
      const fin = strands.find((q) => q.final);
      endPt = { x: fin.x[fin.n - 1], y: fin.y[fin.n - 1], z: fin.z[fin.n - 1] };
      // sparks: every ~210 units along living strands, never inside gaps
      sparks = [];
      for (const q of strands) {
        if (q.dead) continue;
        for (let s = q.id === 0 ? 150 : 90; s < q.len - 60; s += 210) {
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
      world.th0 = -Math.atan2(t.y, t.x);
      if (snapWorld) { world.th = world.th0; world.om = 0; world.finger = world.th; world.thNear = world.th * 0.99; world.thFar = world.th * 0.96; }
      if (lv.fixedCam) { cam.x = 0; cam.y = 0; } else { cam.x = ball.x; cam.y = ball.y; }
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
        const cradle = st.id === 0 && ball.s < 40 ? 3 : 1;
        const fmax = lv.hold * HOLD * G * cradle;
        const f = -fmax * (d / WG) * Math.exp(0.5 - (d * d) / (2 * WG * WG));
        ax += nx * f; ay += ny * f;
        const near = Math.exp(-(d * d) / (2 * 196));
        ax -= nx * vn * 12 * near; ay -= ny * vn * 12 * near;
        const drag = (0.1 * vt + (G / 36000) * vt * Math.abs(vt)) * near;
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
          else if (ball.cent > lv.hold * HOLD * G * 0.6) ball.slipWhy = "Too fast into the curve. Tilt uphill to brake first.";
          else ball.slipWhy = "Tilted too far. Keep the line pointing downhill.";
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
      el.meta.textContent = lv.symmetric ? "ROTATION " + rot + "°" : "GRIP " + (status === "play" ? Math.round(clamp(1 - ball.strain, 0, 1) * 100) + "%" : "—");
    }

    // ---------- input ----------
    const input = ctx.input.track(canvas, { multitouch: false });
    let steerOverride = false, lastInteract = -10;
    function readInput() {
      if (steerOverride) return;
      const down = !!input.down, px = input.x;
      if (status === "failing" && statusT > 0.65 && (input.pressed || input.tap)) { retry(); return; }
      if (down && !world.dragging) {
        world.dragging = true; world.finger = world.th; world.lastPX = px;
        if (status === "ready") beginAttempt();
      } else if (down) {
        const dphi = (px - world.lastPX) * (2.5 / W) * SENS;
        world.finger += dphi; world.lastPX = px;
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
        const gr = g.createRadialGradient(cx, H * 0.45, 0, cx, H * 0.45, DIAG * 0.62);
        gr.addColorStop(0, "rgb(17,20,27)"); gr.addColorStop(0.45, "rgb(9,11,15)"); gr.addColorStop(1, "rgb(1,1,2)");
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = "lighter";
      if (lv.symmetric) {
        g.globalAlpha = 0.16 * HAZE; sprite(SPR_RING, cx, cy, DIAG * 0.95);
        g.globalAlpha = 0.1 * HAZE; sprite(SPR_RING, cx, cy, MIN * 1.25);
      }
      const nb = quality ? haze.length : Math.min(3, haze.length);
      for (let i = 0; i < nb; i++) {
        const h = haze[i];
        const a = h.a + (lv.final ? t * h.drift * 2 : world.thFar) + Math.sin(t * 0.05 + h.ph) * 0.1;
        g.globalAlpha = h.alpha * HAZE * (0.8 + 0.2 * Math.sin(t * 0.11 + h.ph));
        sprite(h.spr, cx + Math.cos(a) * h.rad, cy + Math.sin(a) * h.rad, h.size);
      }
      if (lv.horizon !== "none") {
        const ang = lv.horizon === "world" ? world.thFar : 0;
        g.save(); g.translate(cx, cy + (lv.horizon === "stable" ? MIN * 0.1 : 0)); g.rotate(ang);
        const bh = MIN * 0.5, gr = g.createLinearGradient(0, -bh, 0, bh);
        gr.addColorStop(0, "rgba(90,110,135,0)"); gr.addColorStop(0.47, "rgba(96,116,142,0.07)");
        gr.addColorStop(0.5, "rgba(130,150,172,0.11)"); gr.addColorStop(0.56, "rgba(40,50,64,0.05)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = HAZE; g.fillStyle = gr; g.fillRect(-DIAG, -bh, DIAG * 2, bh * 2);
        g.globalAlpha = 0.07 * HAZE; g.fillStyle = "rgb(170,186,205)"; g.fillRect(-DIAG, -0.25, DIAG * 2, 0.5);
        g.restore();
      }
      g.globalAlpha = 0.09 * HAZE * pathAlpha; sprite(levelSprites(lvIndex).haze, hazeX, hazeY, MIN * 1.1);
      // falling dust: the room's gravity, always straight down
      g.fillStyle = "rgb(210,222,240)";
      for (const f of fallers) { g.globalAlpha = f.a * HAZE; g.fillRect(f.x * W, f.y * H, f.sz, f.sz * 3.5); }
    }

    function drawMotes(t) {
      if (!quality || !motes.length) return;
      g.globalCompositeOperation = "lighter"; g.fillStyle = "rgb(200,214,232)";
      const csx = cam.x * SC, csy = cam.y * SC;
      for (const m of motes) {
        const a = m.a + world.thNear * (0.9 + m.depth * 0.1);
        let x = cx + Math.cos(a) * m.rad, y = cy + Math.sin(a) * m.rad;
        x = ((x - csx * m.depth * 0.25 * cosT + csy * m.depth * 0.25 * sinT) % W + W) % W;
        y = ((y - csx * m.depth * 0.25 * sinT - csy * m.depth * 0.25 * cosT) % H + H) % H;
        g.globalAlpha = (0.05 + 0.1 * m.depth) * (0.6 + 0.4 * Math.sin(t * 0.7 + m.tw)) * HAZE;
        g.fillRect(x, y, m.sz, m.sz);
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
      const coreW = clamp(1.1 * (1 + 0.4 * speedN + 0.5 * strain) * (status === "result" ? 1.3 : 1), 0.8, 3);
      const haloW = 5 + 3.5 * strain + 1.5 * speedN, fieldW = 20 + 8 * strain;
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
              const amp = shake * shake * 2.2 * fall * Math.sin(t * 41 + st.s[i] * 0.23) + shake * fall * Math.sin(t * 13 - st.s[i] * 0.05);
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
      // off-screen: a small chevron at the edge pointing toward the ring
      if ((P.x < 10 || P.x > W - 10 || P.y < 10 || P.y > H - 10) && !lv.noUi && (status === "play" || status === "ready")) {
        const a = Math.atan2(P.y - ancY, P.x - ancX);
        const m = 22, ex = clamp(ancX + Math.cos(a) * DIAG, m, W - m), ey = clamp(ancY + Math.sin(a) * DIAG, m + 60, H - m - 60);
        g.save(); g.translate(ex, ey); g.rotate(a);
        g.globalAlpha = 0.55 + 0.25 * pulse; g.strokeStyle = rgb(hue); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(-5, -5); g.lineTo(2, 0); g.lineTo(-5, 5); g.stroke();
        g.beginPath(); g.arc(-12, 0, 2.2, 0, TAU); g.stroke();
        g.restore();
      }
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
      const core = clamp(MIN / 130, 2.6, 4.2) * k * ball.scale * (1 - ball.sink * 0.5);
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
      // anamorphic streak
      const sl = core * (14 + speed * 0.06);
      const gr = g.createLinearGradient(bx - sl, by, bx + sl, by);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, rgb(mix3(lv.hue, [255, 255, 255], 0.6), 0.5)); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.globalAlpha = 0.5 * vis; g.fillStyle = gr; g.fillRect(bx - sl, by - 0.6, sl * 2, 1.2);
      if (haveBPrev && speed > 30) {
        const mx = bx - prevBX, my = by - prevBY, ml = Math.hypot(mx, my);
        if (ml > 0.5 && ml < 60) {
          g.strokeStyle = "rgb(245,250,255)"; g.lineCap = "round";
          g.globalAlpha = clamp(speed / 240, 0, 0.6) * vis; g.lineWidth = core * 1.1;
          g.beginPath(); g.moveTo(bx - mx * 2, by - my * 2); g.lineTo(bx, by); g.stroke();
        }
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
      if (!lv.fixedCam && status !== "failing" && status !== "transition") {
        const k = status === "ready" ? 12 : 9;
        cam.x += (ball.x - cam.x) * damp(k, dt); cam.y += (ball.y - cam.y) * damp(k, dt);
      }
      if (status === "failing") pathAlpha = Math.max(0.3, pathAlpha - dt / 0.6);
      else if (status === "transition") pathAlpha = smooth(0.55, 1, statusT / 1.0);
      else pathAlpha = Math.min(1, pathAlpha + dt / 0.35);
      lit += ((status === "aligned" || status === "result" ? 1.8 : 1) - lit) * damp(4, dt);
      if (lv.memory) {
        const target = status === "play" ? 1 - smooth(3.5, 5.5, playT) : 1;
        memVis += (target - memVis) * damp(4, dt);
      } else memVis = 1;
      if (status === "transition" && statusT > 1.0) { frag = null; enterReady(); }
      for (const f of fallers) { f.y += f.v * dt; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); } }

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
      drawGhosts();
      if (status === "transition") drawTransition();
      if (status !== "transition" || statusT > 0.55) { drawPaths(t); drawGoalAndSparks(t); }
      drawParticles(dt);
      drawBall(t);
      drawMotes(t);
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
