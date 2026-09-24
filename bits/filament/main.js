// Filament — a single point of light that must never cross its own past.
// The trail is the score, the artwork, and the player's history at once.

window.plethoraBit = {
  meta: {
    title: "Filament",
    runtime: "plethora-bit@2",
    tags: ["arcade", "art", "generative", "minimal"],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const LEVELS = 12;
    const STORE_KEY = "filament.v1";
    // Three hues per level; the trail slowly drifts between them.
    const PALETTES = [
      [38, 340, 280], [190, 225, 275], [25, 48, 350], [265, 305, 200],
      [160, 188, 95], [340, 20, 290], [210, 172, 250], [48, 15, 330],
      [290, 322, 230], [185, 140, 210], [10, 36, 320], [0, 120, 240]
    ];
    const WELLS = [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 4];

    const tn = (id, fallback) => {
      try {
        const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined;
        return Number.isFinite(v) ? v : fallback;
      } catch (e) {
        return fallback;
      }
    };
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const angDelta = (a, b) => {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    };
    const pad2 = n => (n < 10 ? "0" : "") + n;
    const fmtClock = sec => pad2(Math.floor(sec / 60)) + ":" + pad2(Math.floor(sec % 60));
    const lvlLabel = L => pad2(L);
    function mulberry(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function makeBuffer(w, h) {
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      const c = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : canvas.ownerDocument.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }

    // ---------------------------------------------------------------- surfaces
    const canvas = ctx.createCanvas2D({ maxDpr: 2, alpha: false, layer: "content", touchAction: "none" });
    const g = canvas.getContext("2d");
    const input = ctx.input.track(canvas, { touchAction: "none", multitouch: false });

    const hud = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "fl" });
    hud.innerHTML = `
<style>
.fl{font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#ece9e2;text-transform:uppercase;letter-spacing:.2em;font-size:10px;line-height:1.5;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.fl *{box-sizing:border-box}
.fl button{pointer-events:auto;background:none;border:0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;padding:14px 14px;margin:-14px -14px;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none}
.fl-tl,.fl-tr,.fl-tc{position:absolute;top:calc(var(--st) + 18px);opacity:.62;transition:opacity 1.8s ease}
.fl-tl{left:calc(var(--sl) + 22px)}
.fl-tr{right:calc(var(--sr) + 22px);text-align:right}
.fl-tl small,.fl-tr small{display:block;font-size:8.5px;opacity:.5;margin-top:3px;letter-spacing:.24em}
.fl-k{opacity:.45;margin-right:.7em}
.fl-tc{left:0;right:0;text-align:center;pointer-events:none}
.fl-dim .fl-tl,.fl-dim .fl-tr,.fl-dim .fl-tc{opacity:.2}
.fl-glow .fl-tl{opacity:1;text-shadow:0 0 12px rgba(255,248,230,.7)}
.fl-hint{position:absolute;left:0;right:0;text-align:center;transition:opacity 1.2s ease;opacity:0}
.fl-hint b{display:block;font-weight:400;letter-spacing:.62em;margin-right:-.62em;font-size:10px;opacity:.75}
.fl-rules{margin:18px auto 26px;text-transform:none;letter-spacing:.06em;font-size:11px;line-height:2.05;opacity:.6}
.fl-rules span{opacity:.55}
.fl-hint.brief b,.fl-hint.brief .fl-rules{display:none}
.fl .fl-start{padding:13px 38px;margin:0;border:1px solid rgba(236,233,226,.4);border-radius:0;letter-spacing:.5em;font-size:10.5px;text-indent:.5em;transition:border-color .4s ease,background .4s ease;pointer-events:none}
.fl .fl-start:active{background:rgba(236,233,226,.1);border-color:rgba(236,233,226,.8)}
.fl-hint.on{opacity:1}
.fl-hint.on .fl-start{pointer-events:auto}
.fl-end{position:absolute;left:calc(var(--sl) + 22px);right:calc(var(--sr) + 22px);bottom:calc(var(--sb) + 58px);display:flex;justify-content:space-between;align-items:flex-end;pointer-events:none}
.fl-stats div{opacity:0;transform:translateY(6px);transition:opacity 1.4s ease,transform 1.4s ease}
.fl-stats .fl-big{font-size:24px;letter-spacing:.05em;line-height:1.1;margin-bottom:8px}
.fl-stats .fl-big .fl-u{font-size:10px;letter-spacing:.2em;opacity:.55;margin-left:.6em}
.fl-stats .fl-row{font-size:10.5px;margin-top:2px}
.fl-stats .fl-note{font-size:8.5px;opacity:0;margin-top:16px;letter-spacing:.26em}
.fl-acts{display:flex;flex-direction:column;align-items:flex-end;gap:22px}
.fl-acts button{opacity:0;transition:opacity 1.2s ease;pointer-events:none;font-size:10.5px}
.fl-acts .fl-sec{font-size:9.5px}
.fl-show .fl-stats div{opacity:1;transform:none}
.fl-show .fl-stats .fl-note{opacity:.5}
.fl-live .fl-acts button{opacity:.95;pointer-events:auto}
.fl-live .fl-acts .fl-sec{opacity:.5}
.fl-pause{position:absolute;left:0;right:0;text-align:center;opacity:0;transition:opacity .9s ease}
.fl-pause .fl-bars{display:inline-block;width:9px;height:14px;border-left:1px solid #ece9e2;border-right:1px solid #ece9e2}
.fl-pause i{display:block;font-style:normal;font-size:8.5px;letter-spacing:.4em;margin-right:-.4em;opacity:.45;margin-top:16px}
.fl-paused .fl-pause{opacity:.8}
.fl .fl-ranks2{display:block;margin:20px auto 0;padding:10px 16px;font-size:9px;opacity:.45;pointer-events:none}
.fl-hint.on .fl-ranks2{pointer-events:auto}
.fl-lb{position:absolute;inset:0;background:rgba(3,3,5,.84);opacity:0;pointer-events:none;transition:opacity .6s ease;display:flex;align-items:center;justify-content:center}
.fl-lb.on{opacity:1;pointer-events:auto}
.fl .fl-lb button{pointer-events:none;margin:0}
.fl .fl-lb.on button{pointer-events:auto}
.fl-lb-in{width:min(320px,84%)}
.fl-lb-h{display:flex;justify-content:space-between;font-size:10px}
.fl-lb-h span:last-child{opacity:.45}
.fl-lb-tabs{margin-top:22px;display:flex;gap:26px}
.fl .fl-lb-tabs button{padding:8px 0;font-size:9px;opacity:.38;border-bottom:1px solid transparent}
.fl .fl-lb-tabs button.on{opacity:.95;border-bottom-color:rgba(236,233,226,.6)}
.fl-lb-list{list-style:none;padding:0;margin:16px 0 28px;min-height:120px}
.fl-lb-list li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid rgba(236,233,226,.08);font-size:10.5px;text-transform:none;letter-spacing:.06em}
.fl-lb-list .r{opacity:.4;width:2.4em}
.fl-lb-list .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fl-lb-list .v{opacity:.8}
.fl-lb-list li.me{color:#fff}
.fl-lb-list li.me .n::after{content:"  \\00b7  you";opacity:.45}
.fl-lb-list li.gap{border:0;justify-content:center;opacity:.35;padding:4px 0}
.fl-lb-list li.msg{border:0;justify-content:center;opacity:.45;text-transform:uppercase;letter-spacing:.2em;font-size:9px;padding-top:40px}
.fl .fl-lb-close{padding:10px 0;font-size:9.5px;opacity:.7}
</style>
<button class="fl-tl" type="button" aria-label="level"><span class="fl-lv">01 / 12</span><small class="fl-lvsub">&nbsp;</small></button>
<div class="fl-tc"><span class="fl-k">TRACE</span><span class="fl-pct">0%</span></div>
<div class="fl-tr"><div><span class="fl-k">TIME</span><span class="fl-time">00:00</span></div><small class="fl-sub">&nbsp;</small></div>
<div class="fl-hint"><b>FILAMENT</b><p class="fl-rules">the light never stops moving<br>drag anywhere to steer it<br>never touch your own trail<br>or the edge of the space<br><span>tap once to pause</span></p><button class="fl-start" type="button">START</button><button class="fl-ranks2" type="button">RANKS</button></div>
<div class="fl-pause"><span class="fl-bars"></span><i>touch to continue</i></div>
<div class="fl-end">
  <div class="fl-stats">
    <div class="fl-big"><span class="fl-v-time">0.0</span><span class="fl-u">SEC</span></div>
    <div class="fl-row fl-v-dist">0 M</div>
    <div class="fl-row fl-v-trace">TRACE 0%</div>
    <div class="fl-note fl-v-note">&nbsp;</div>
  </div>
  <div class="fl-acts">
    <button class="fl-again" type="button">AGAIN</button>
    <button class="fl-sec fl-retrace" type="button">RETRACE</button>
    <button class="fl-sec fl-ranks" type="button">RANKS</button>
  </div>
</div>
<div class="fl-lb" aria-hidden="true"><div class="fl-lb-in">
  <div class="fl-lb-h"><span>LONGEST DRIFT</span><span class="fl-lb-lv">LEVEL 01</span></div>
  <div class="fl-lb-tabs"><button class="on" type="button" data-scope="global">GLOBAL</button><button type="button" data-scope="following">FOLLOWING</button></div>
  <ol class="fl-lb-list"></ol>
  <button class="fl-lb-close" type="button">CLOSE</button>
</div></div>`;
    const $ = sel => hud.querySelector(sel);
    const el = {
      lvBtn: $(".fl-tl"), lv: $(".fl-lv"), lvSub: $(".fl-lvsub"),
      time: $(".fl-time"), sub: $(".fl-sub"), pct: $(".fl-pct"),
      hint: $(".fl-hint"), pause: $(".fl-pause"), start: $(".fl-start"),
      vTime: $(".fl-v-time"), vDist: $(".fl-v-dist"), vTrace: $(".fl-v-trace"), vNote: $(".fl-v-note"),
      again: $(".fl-again"), retrace: $(".fl-retrace"), ranks: $(".fl-ranks"), ranks2: $(".fl-ranks2"),
      lb: $(".fl-lb"), lbLv: $(".fl-lb-lv"), lbList: $(".fl-lb-list"), lbClose: $(".fl-lb-close"),
      lbTabs: Array.from(hud.querySelectorAll(".fl-lb-tabs button"))
    };

    // ------------------------------------------------------------------ layout
    let W = 0, H = 0, pxr = 1, U = 1, CX = 0, CY = 0, RX = 1, RY = 1;
    let bgBuf = null, trailBuf = null, tg = null, bloomBuf = null, bg2 = null, grainPat = null;
    let bgHueBuilt = -1;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      const sa = ctx.safeArea || {};
      const st = sa.top || 0, sb = sa.bottom || 0, sl = sa.left || 0, sr = sa.right || 0;
      hud.style.setProperty("--st", st + "px");
      hud.style.setProperty("--sb", sb + "px");
      hud.style.setProperty("--sl", sl + "px");
      hud.style.setProperty("--sr", sr + "px");
      U = clamp(Math.min(W, H) / 400, 0.75, 1.8);
      const top = st + 58, bottom = sb + 40;
      CX = W / 2;
      CY = top + (H - top - bottom) / 2;
      RX = Math.max(60, W / 2 - 16 - Math.max(sl, sr));
      RY = Math.max(60, (H - top - bottom) / 2);
      el.hint.style.top = Math.round(CY + 44 * U) + "px";
      el.pause.style.top = Math.round(st + 70) + "px";
    }

    function buildBuffers() {
      pxr = clamp(canvas.width / W || 1, 1, 3);
      trailBuf = makeBuffer(W * pxr, H * pxr);
      tg = trailBuf.getContext("2d");
      tg.lineCap = "round";
      tg.lineJoin = "round";
      bloomBuf = makeBuffer(W / 4, H / 4);
      bg2 = bloomBuf.getContext("2d");
      bgHueBuilt = -1;
      if (!grainPat) buildGrain();
    }

    function buildGrain() {
      const n = 140;
      const c = makeBuffer(n, n);
      const cg = c.getContext("2d");
      const img = cg.createImageData(n, n);
      const r = mulberry(77);
      for (let i = 0; i < n * n; i++) {
        const v = r() < 0.5 ? 0 : 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.floor(r() * 90);
      }
      cg.putImageData(img, 0, 0);
      grainPat = g.createPattern(c, "repeat");
    }

    function buildBackground(P) {
      const hue = P.hue, sat = P.sat;
      bgBuf = makeBuffer(W * pxr, H * pxr);
      const b = bgBuf.getContext("2d");
      b.setTransform(pxr, 0, 0, pxr, 0, 0);
      const s = sat * 0.5;
      b.fillStyle = `hsl(${hue},${s}%,2.6%)`;
      b.fillRect(0, 0, W, H);
      let gr = b.createRadialGradient(CX, CY - RY * 0.2, 0, CX, CY, Math.max(W, H) * 0.75);
      gr.addColorStop(0, `hsla(${hue},${s}%,9%,1)`);
      gr.addColorStop(0.55, `hsla(${hue},${s}%,4.5%,1)`);
      gr.addColorStop(1, `hsla(${hue},${s}%,1.5%,1)`);
      b.fillStyle = gr;
      b.fillRect(0, 0, W, H);
      const r = mulberry(hue * 31 + 5);
      for (let i = 0; i < 6; i++) {
        const x = W * (0.1 + r() * 0.8), y = H * (0.1 + r() * 0.8);
        const rad = Math.max(W, H) * (0.25 + r() * 0.4);
        const h = P.pal[i % 3] + (r() - 0.5) * 24;
        gr = b.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `hsla(${h},${20 + sat}%,55%,${0.028 + r() * 0.02})`);
        gr.addColorStop(1, `hsla(${h},${20 + sat}%,55%,0)`);
        b.fillStyle = gr;
        b.fillRect(0, 0, W, H);
      }
      gr = b.createRadialGradient(CX, CY, Math.min(W, H) * 0.35, CX, CY, Math.max(W, H) * 0.85);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,0.55)");
      b.fillStyle = gr;
      b.fillRect(0, 0, W, H);
      bgHueBuilt = hue * 1000 + sat;
    }

    // ------------------------------------------------------------------- state
    const S = {
      mode: "ready", // ready | playing | paused | resuming | dying | end | retrace
      level: 1,
      unlocked: 1,
      best: {},
      runs: 0,
      clock: 0,
      readyAt: 0
    };
    let run = null;
    let last = null; // results of the last completed run
    const steer = { anchorX: 0, anchorY: 0, target: null, strength: 0, touchT: 0, moved: 0, startTouch: false };
    const particles = [];
    const rings = [];
    const sparks = [];
    let bloomDirty = false, bloomAt = 0;
    let hudAt = 0;
    let music = null, musicAt = 0;

    function levelParams(L) {
      const t = (L - 1) / (LEVELS - 1);
      return {
        speed: tn("base_speed", 62) * U * (1 + 0.28 * t),
        accel: (tn("acceleration", 1.2) / 100) * (1 + 0.7 * t),
        turn: tn("turn_rate", 3.0),
        shrink: clamp(tn("arena_shrink", 0.22) * (1 + 0.9 * t), 0, 0.6),
        breathe: L >= 3 ? 0.012 + 0.02 * t : 0,
        target: 15 + L * 3,
        pal: PALETTES[L - 1],
        hue: PALETTES[L - 1][0],
        sat: L === 12 ? 70 : 62,
        cycle: L === 12 ? 7 : 16,
        glow: tn("trail_glow", 1)
      };
    }

    function newRun() {
      const P = levelParams(S.level);
      const r = mulberry(1000 + S.level * 7919);
      const wells = [];
      for (let i = 0; i < WELLS[S.level - 1]; i++) {
        const a = (i / Math.max(1, WELLS[S.level - 1])) * TAU + r() * 1.4;
        wells.push({
          a,
          r: 0.34 + r() * 0.26,
          str: 0.75 + 0.5 * ((S.level - 4) / 8) + r() * 0.2,
          orbit: S.level >= 8 ? (r() < 0.5 ? -1 : 1) * (0.035 + r() * 0.03) : 0,
          phase: r() * TAU,
          x: 0,
          y: 0
        });
      }
      const cs = 18 * U;
      let total = 0;
      for (let y = -RY + cs / 2; y < RY; y += cs) {
        for (let x = -RX + cs / 2; x < RX; x += cs) {
          if ((x * x) / (RX * RX) + (y * y) / (RY * RY) < 1) total++;
        }
      }
      run = {
        P,
        wells,
        t: 0,
        x: 0,
        y: 0,
        heading: -Math.PI / 2 + (r() - 0.5) * 1.2,
        speed: P.speed,
        xs: [],
        ys: [],
        ts: [],
        lens: [],
        len: 0,
        drawn: 0,
        ticks: [],
        nextTick: 5,
        grid: new Map(),
        gcs: 16 * U,
        cells: new Set(),
        cs,
        cellTotal: Math.max(1, total),
        near: 0,
        scale: 1,
        milestone: 10,
        crossed: false,
        deathX: 0,
        deathY: 0
      };
      addPoint(0, 0);
      clearTrail();
      steer.target = null;
      if (bgHueBuilt !== P.hue * 1000 + P.sat) buildBackground(P);
    }

    function clearTrail() {
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.clearRect(0, 0, trailBuf.width, trailBuf.height);
      bg2.setTransform(1, 0, 0, 1, 0, 0);
      bg2.clearRect(0, 0, bloomBuf.width, bloomBuf.height);
      run.drawn = 1;
      bloomDirty = true;
    }

    // ------------------------------------------------------- trail + collision
    const gridKey = (ix, iy) => (ix + 4096) * 8192 + (iy + 4096);

    function addPoint(x, y) {
      const n = run.xs.length;
      if (n > 0) run.len += Math.hypot(x - run.xs[n - 1], y - run.ys[n - 1]);
      run.xs.push(x);
      run.ys.push(y);
      run.ts.push(run.t);
      run.lens.push(run.len);
      if (n > 0) {
        const gcs = run.gcs;
        const x0 = run.xs[n - 1], y0 = run.ys[n - 1];
        const ix0 = Math.floor(Math.min(x0, x) / gcs), ix1 = Math.floor(Math.max(x0, x) / gcs);
        const iy0 = Math.floor(Math.min(y0, y) / gcs), iy1 = Math.floor(Math.max(y0, y) / gcs);
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iy = iy0; iy <= iy1; iy++) {
            const k = gridKey(ix, iy);
            let cell = run.grid.get(k);
            if (!cell) run.grid.set(k, (cell = []));
            cell.push(n);
          }
        }
      }
      const cs = run.cs;
      const cx = Math.floor((x + RX) / cs), cy = Math.floor((y + RY) / cs);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) run.cells.add((cx + dx) * 1000 + cy + dy);
    }

    function traceNow() {
      return Math.min(100, Math.round((run.cells.size / run.cellTotal) * 100));
    }

    function segDist(px, py, i) {
      const ax = run.xs[i - 1], ay = run.ys[i - 1];
      const bx = run.xs[i], by = run.ys[i];
      const vx = bx - ax, vy = by - ay;
      const l2 = vx * vx + vy * vy || 1e-6;
      const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
      return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
    }

    // Returns the closest distance from the head to older trail (capped at `reach`).
    function trailProximity(px, py, reach) {
      const n = run.xs.length;
      const headLen = run.lens[n - 1] + Math.hypot(px - run.xs[n - 1], py - run.ys[n - 1]);
      const limit = headLen - 15 * U;
      const gcs = run.gcs;
      let best = reach;
      const ix0 = Math.floor((px - reach) / gcs), ix1 = Math.floor((px + reach) / gcs);
      const iy0 = Math.floor((py - reach) / gcs), iy1 = Math.floor((py + reach) / gcs);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const cell = run.grid.get(gridKey(ix, iy));
          if (!cell) continue;
          for (let j = 0; j < cell.length; j++) {
            const i = cell[j];
            if (run.lens[i] > limit) continue;
            const d = segDist(px, py, i);
            if (d < best) best = d;
          }
        }
      }
      return best;
    }

    function paletteHue(t, P) {
      const ph = ((t / P.cycle) % 3 + 3) % 3;
      const i = Math.floor(ph), f = ph - i;
      const e = f * f * (3 - 2 * f);
      const a = P.pal[i], b = P.pal[(i + 1) % 3];
      return (a + angDelta(a * Math.PI / 180, b * Math.PI / 180) * 180 / Math.PI * e + 360) % 360;
    }
    // The whole palette also drifts very slowly around the colour wheel as a run goes on.
    const DRIFT = 1.1; // degrees per second
    function sceneT() {
      return S.mode === "ready" || !run ? S.clock * 0.3 : run.t;
    }
    function trailColor(t, P, alpha) {
      const k = 1 - Math.exp(-t / 42);
      const h = (paletteHue(t, P) + t * DRIFT) % 360;
      const s = P.sat + 10 * k;
      const l = 82 - 12 * k;
      return `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${alpha})`;
    }

    function tracePath(c, from, n, off, hx, hy) {
      c.beginPath();
      for (let i = from - 1; i < n; i++) {
        let x = run.xs[i], y = run.ys[i];
        if (off) {
          const j = i > 0 ? i : 1;
          const dx = run.xs[j] - run.xs[j - 1], dy = run.ys[j] - run.ys[j - 1], l = Math.hypot(dx, dy) || 1;
          x += (-dy / l) * off;
          y += (dx / l) * off;
        }
        if (i === from - 1) c.moveTo(x, y); else c.lineTo(x, y);
      }
      if (hx !== undefined) c.lineTo(hx, hy);
    }
    function trailPasses(c, from, n, t, head) {
      const P = run.P, glow = P.glow;
      const pass = (width, color, off) => {
        c.lineWidth = width;
        c.strokeStyle = color;
        tracePath(c, from, n, off, head && !off ? head.x : undefined, head ? head.y : undefined);
        c.stroke();
      };
      pass(7 * U, trailColor(t, P, 0.028 * glow), 0);
      pass(2.4 * U, trailColor(t, P, 0.12 * glow), 0);
      pass(0.95 * U, trailColor(t, P, 0.8), 0);
      pass(0.5 * U, trailColor(t + 30, P, 0.11), 3.6 * U);
    }

    // Strokes are committed in batches with butt caps so joints never double up
    // into visible beads; the uncommitted tail is drawn live each frame.
    function drawPending(upTo, force) {
      const n = Math.min(upTo, run.xs.length);
      if (n <= run.drawn) return;
      if (!force && n - run.drawn < 8) return;
      const from = Math.max(1, run.drawn);
      const P = run.P;
      const t = run.ts[n - 1];
      tg.setTransform(pxr, 0, 0, pxr, pxr * CX, pxr * CY);
      tg.globalCompositeOperation = "lighter";
      tg.lineCap = "butt";
      trailPasses(tg, from, n, t, null);

      // chronograph marks: a tick every 5 s, a small ring every 30 s
      for (const tick of run.ticks) {
        if (tick.i < from || tick.i >= n) continue;
        const i = tick.i;
        const dx = run.xs[i] - run.xs[i - 1], dy = run.ys[i] - run.ys[i - 1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        tg.lineWidth = 0.7 * U;
        tg.strokeStyle = trailColor(tick.sec, P, 0.42);
        tg.beginPath();
        if (tick.sec % 30 === 0) {
          tg.arc(run.xs[i] + nx * 7 * U, run.ys[i] + ny * 7 * U, 2.6 * U, 0, TAU);
        } else {
          tg.moveTo(run.xs[i] + nx * 3.5 * U, run.ys[i] + ny * 3.5 * U);
          tg.lineTo(run.xs[i] + nx * 8 * U, run.ys[i] + ny * 8 * U);
        }
        tg.stroke();
      }
      tg.globalCompositeOperation = "source-over";
      run.drawn = n;
      bloomDirty = true;
    }

    function updateBloom(now) {
      if (!bloomDirty || now - bloomAt < 110) return;
      bloomAt = now;
      bloomDirty = false;
      bg2.setTransform(1, 0, 0, 1, 0, 0);
      bg2.clearRect(0, 0, bloomBuf.width, bloomBuf.height);
      bg2.globalAlpha = 1;
      try { bg2.filter = "blur(2px)"; } catch (e) { /* optional */ }
      bg2.drawImage(trailBuf, 0, 0, bloomBuf.width, bloomBuf.height);
      try { bg2.filter = "none"; } catch (e) { /* optional */ }
    }

    // ------------------------------------------------------------- simulation
    function arenaScale(t, P) {
      return 1 - P.shrink * (1 - Math.exp(-t / 50)) + P.breathe * Math.sin(t * 0.55);
    }

    function wellPos(w, t, s) {
      const a = w.a + w.orbit * t;
      w.x = Math.cos(a) * w.r * RX * s;
      w.y = Math.sin(a) * w.r * RY * s;
    }

    function step(dt) {
      const P = run.P;
      run.t += dt;
      run.speed = P.speed * Math.min(2.7, 1 + P.accel * run.t + P.accel * P.accel * run.t * run.t * 0.4);
      run.scale = arenaScale(run.t, P);

      if (steer.target !== null) {
        const d = angDelta(run.heading, steer.target);
        const maxTurn = P.turn * dt * steer.strength;
        run.heading += clamp(d, -maxTurn, maxTurn);
      }
      for (const w of run.wells) {
        wellPos(w, run.t, run.scale);
        const dx = w.x - run.x, dy = w.y - run.y;
        const d = Math.hypot(dx, dy);
        const reach = 120 * U;
        if (d < reach && d > 1) {
          const f = w.str * (1 - d / reach) * (1 - d / reach);
          run.heading += clamp(angDelta(run.heading, Math.atan2(dy, dx)), -1, 1) * f * dt * 1.4;
        }
      }
      run.x += Math.cos(run.heading) * run.speed * dt;
      run.y += Math.sin(run.heading) * run.speed * dt;

      const n = run.xs.length;
      if (Math.hypot(run.x - run.xs[n - 1], run.y - run.ys[n - 1]) >= 2.5 * U) {
        addPoint(run.x, run.y);
        if (run.t >= run.nextTick) {
          run.ticks.push({ i: run.xs.length - 1, sec: run.nextTick });
          run.nextTick += 5;
        }
      }

      // boundary: a soft ellipse of light that slowly closes in
      const s = run.scale;
      const ex = run.x / (RX * s - 3 * U), ey = run.y / (RY * s - 3 * U);
      if (ex * ex + ey * ey >= 1) return die();

      const prox = trailProximity(run.x, run.y, 16 * U);
      run.near = Math.max(0, 1 - prox / (16 * U));
      if (prox < 2.9 * U) return die();

      if (!run.crossed && run.t >= P.target) {
        run.crossed = true;
        rings.push({ t0: S.clock, x: run.x, y: run.y, bright: 0.26, speed: 34 });
        haptic("light");
        hud.classList.add("fl-glow");
        ctx.timeout(() => hud.classList.remove("fl-glow"), 1600);
        try { ctx.platform.milestone("threshold", { level: S.level, seconds: P.target }); } catch (e) { /* host optional */ }
      }
      if (run.t >= run.milestone) {
        rings.push({ t0: S.clock, x: 0, y: 0, bright: 0.1, speed: 22 });
        run.milestone += 10;
      }
    }

    function die() {
      if (S.mode !== "playing") return;
      S.mode = "dying";
      S.deathAt = S.clock;
      run.deathX = run.x;
      run.deathY = run.y;
      hud.classList.remove("fl-dim");
      haptic("heavy");
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * TAU, v = (8 + Math.random() * 38) * U;
        sparks.push({ x: run.x, y: run.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.6 + Math.random() * 1.8, age: 0 });
      }
      drawPending(run.xs.length, true);

      const secs = run.t;
      const ms = Math.round(secs * 1000);
      const meters = Math.round(run.len / U / 6);
      const trace = traceNow();
      const prevBest = S.best[S.level] || 0;
      const isBest = ms > prevBest;
      if (isBest) S.best[S.level] = ms;
      let opened = 0;
      if (run.crossed && S.level === S.unlocked && S.unlocked < LEVELS) {
        S.unlocked += 1;
        opened = S.unlocked;
      }
      S.runs += 1;
      last = { secs, ms, meters, trace, isBest, best: Math.max(ms, prevBest), opened, level: S.level };
      save();

      try { score.set(Math.round(secs * 10) / 10, { reason: "run_end" }); } catch (e) { /* optional */ }
      try { ctx.platform.fail({ seconds: secs, meters, trace, level: S.level }); } catch (e) { /* optional */ }
      submitRecord(ms, S.level, secs);
      if (music) {
        try { ctx.music.duck(0.75, 2600); ctx.music.setIntensity(0.08, { fadeMs: 3000 }); } catch (e) { /* optional */ }
      }
      ctx.timeout(() => revealEnd(true), 1500);
    }

    function submitRecord(ms, level, secs) {
      try {
        const rec = ctx.memory && ctx.memory.record ? ctx.memory.record("survival") : null;
        if (!rec) return;
        const p = rec.submit(ms, { label: secs.toFixed(1) + " sec", dimensions: { level: lvlLabel(level) } });
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* records are optional */ }
    }

    // ---------------------------------------------------------------- flow
    let sessionRuns = 0;
    function startRun() {
      S.mode = "resuming";
      S.resumeAt = S.clock;
      sessionRuns += 1;
      hud.classList.remove("fl-show", "fl-live", "fl-paused");
      el.hint.classList.remove("on");
      haptic("light");
      try { ctx.platform.interact({ type: "start", level: S.level }); } catch (e) { /* optional */ }
      try { score.set(0, { reason: "run_start" }); } catch (e) { /* optional */ }
      if (music) {
        try { ctx.music.setIntensity(0.2, { fadeMs: 2000 }); } catch (e) { /* optional */ }
      }
    }

    function toReady() {
      S.mode = "ready";
      S.readyAt = S.clock;
      hud.querySelectorAll(".fl-stats div").forEach(row => { row.style.transitionDelay = "0ms"; });
      hud.classList.remove("fl-show", "fl-live", "fl-paused", "fl-dim");
      newRun();
      refreshHud(true);
    }

    function pause() {
      if (S.mode !== "playing" && S.mode !== "resuming") return;
      S.mode = "paused";
      steer.target = null;
      hud.classList.add("fl-paused");
      hud.classList.remove("fl-dim");
    }

    function resume() {
      S.mode = "resuming";
      S.resumeAt = S.clock;
      hud.classList.remove("fl-paused");
    }

    let revealTimers = [];
    function revealEnd(animated) {
      if (S.mode !== "dying" && S.mode !== "retrace") return;
      S.mode = "end";
      S.endAt = S.clock;
      S.countUp = animated;
      const L = last;
      const notes = [];
      notes.push("BEST " + (L.best / 1000).toFixed(1) + " SEC");
      if (L.opened) notes.push(lvlLabel(L.opened) + " OPENS");
      el.vNote.textContent = notes.join("   \u00b7   ");
      setEndNumbers(animated ? 0 : 1);
      hud.classList.add("fl-show");
      revealTimers.forEach(clearTimeoutSafe);
      revealTimers = [];
      const stagger = animated ? [0, 380, 760, 1500] : [0, 0, 0, 0];
      const rows = hud.querySelectorAll(".fl-stats div");
      rows.forEach((row, i) => { row.style.transitionDelay = stagger[i] + "ms"; });
      revealTimers.push(ctx.timeout(() => {
        hud.classList.add("fl-live");
        if (animated && L.opened) {
          try {
            if (ctx.pulse && ctx.pulse.complete) {
              ctx.pulse.complete({ timeMs: L.ms, level: L.level, text: "Filament " + lvlLabel(L.opened) + " opened \u00b7 " + L.secs.toFixed(1) + " sec" });
            }
          } catch (e) { /* optional */ }
          haptic("success");
        }
      }, animated ? 2300 : 50));
    }
    function clearTimeoutSafe(id) {
      try { if (typeof id === "function") id(); } catch (e) { /* noop */ }
    }

    function setEndNumbers(k) {
      const L = last;
      const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3);
      el.vTime.textContent = (L.secs * e).toFixed(1);
      el.vDist.textContent = Math.round(L.meters * e) + " M";
      el.vTrace.textContent = "TRACE " + Math.round(L.trace * e) + "%";
    }

    function again() {
      if (S.mode !== "end" || lb.open) return;
      if (last && last.opened) S.level = last.opened;
      toReady();
    }

    function retrace() {
      if (S.mode !== "end" || !run || lb.open) return;
      S.mode = "retrace";
      S.retraceAt = S.clock;
      S.retraceDur = clamp(run.t / 3, 2.6, 7.5);
      hud.querySelectorAll(".fl-stats div").forEach(row => { row.style.transitionDelay = "0ms"; });
      hud.classList.remove("fl-show", "fl-live");
      clearTrail();
      try { ctx.platform.interact({ type: "retrace" }); } catch (e) { /* optional */ }
    }

    function cycleLevel() {
      if (S.mode !== "ready" || S.unlocked <= 1) return;
      S.level = (S.level % S.unlocked) + 1;
      save();
      newRun();
      refreshHud(true);
      haptic("light");
    }

    ctx.input.activate(el.again, () => again());
    ctx.input.activate(el.retrace, () => retrace());

    // ------------------------------------------------------------ leaderboard
    const lb = { open: false, scope: "global", level: 1, req: 0 };
    function openRanks() {
      if (S.mode !== "end" && S.mode !== "ready") return;
      lb.open = true;
      lb.level = S.mode === "end" && last ? last.level : S.level;
      el.lbLv.textContent = "LEVEL " + lvlLabel(lb.level);
      el.lb.classList.add("on");
      el.lb.setAttribute("aria-hidden", "false");
      loadRanks();
      try { ctx.platform.interact({ type: "ranks" }); } catch (e) { /* optional */ }
    }
    function closeRanks() {
      lb.open = false;
      lb.req++;
      el.lb.classList.remove("on");
      el.lb.setAttribute("aria-hidden", "true");
    }
    function lbRow(cls, cells) {
      const li = hud.ownerDocument.createElement("li");
      if (cls) li.className = cls;
      for (const [c, text] of cells) {
        const span = hud.ownerDocument.createElement("span");
        if (c) span.className = c;
        span.textContent = text;
        li.appendChild(span);
      }
      el.lbList.appendChild(li);
    }
    function entryOf(e, i) {
      if (!e || typeof e !== "object") return null;
      const u = e.user || e.profile || e.player || {};
      const value = Number(e.value ?? e.score ?? e.valueMs ?? e.best ?? 0);
      return {
        rank: Number(e.rank ?? e.position ?? e.place ?? i + 1),
        name: String(e.displayName || e.display_name || e.username || e.handle || e.name ||
          u.displayName || u.display_name || u.username || u.handle || u.name || "player"),
        text: e.label || e.formattedValue || (value / 1000).toFixed(1) + " sec",
        me: !!(e.isViewer || e.is_viewer || e.isMe || e.isCurrentUser || e.viewer === true || e.self)
      };
    }
    function parseBoard(res) {
      if (!res) return null;
      const d = !Array.isArray(res) && res.data && typeof res.data === "object" ? res.data : res;
      const arr = Array.isArray(d) ? d : (d.entries || d.rows || d.items || d.records || d.leaderboard || d.ranks || []);
      const rows = (Array.isArray(arr) ? arr : []).slice(0, 10).map(entryOf).filter(Boolean);
      const mine = !Array.isArray(d) ? (d.viewerEntry || d.viewer_entry || d.me || d.self || (typeof d.viewer === "object" ? d.viewer : null)) : null;
      let me = null;
      if (mine && !rows.some(r => r.me)) {
        me = entryOf(mine, rows.length);
        if (me) me.me = true;
      }
      return { rows, me };
    }
    async function loadRanks() {
      const id = ++lb.req;
      el.lbTabs.forEach(b => b.classList.toggle("on", b.getAttribute("data-scope") === lb.scope));
      el.lbList.textContent = "";
      lbRow("msg", [[null, "\u00b7  \u00b7  \u00b7"]]);
      let res = null;
      try {
        const rec = ctx.memory && ctx.memory.record ? ctx.memory.record("survival") : null;
        if (rec && rec.leaderboard) {
          res = await rec.leaderboard({ scope: lb.scope, period: "all_time", dimensions: { level: lvlLabel(lb.level) } });
        }
      } catch (e) {
        res = null;
      }
      if (id !== lb.req) return;
      const board = parseBoard(res);
      el.lbList.textContent = "";
      if (!board) {
        lbRow("msg", [[null, "ranks unavailable here"]]);
        return;
      }
      if (!board.rows.length) {
        lbRow("msg", [[null, "no drifts recorded yet"]]);
        return;
      }
      for (const r of board.rows) lbRow(r.me ? "me" : "", [["r", pad2(r.rank)], ["n", r.name], ["v", r.text]]);
      if (board.me) {
        lbRow("gap", [[null, "\u00b7"]]);
        lbRow("me", [["r", pad2(board.me.rank)], ["n", board.me.name], ["v", board.me.text]]);
      }
    }
    ctx.input.activate(el.ranks, () => openRanks());
    ctx.input.activate(el.ranks2, () => openRanks());
    ctx.input.activate(el.lbClose, () => closeRanks());
    el.lbTabs.forEach(b => ctx.input.activate(b, () => {
      const sc = b.getAttribute("data-scope");
      if (sc === lb.scope) return;
      lb.scope = sc;
      loadRanks();
    }));
    ctx.input.activate(el.lvBtn, () => cycleLevel());
    ctx.input.activate(el.start, () => {
      if (S.mode !== "ready" || lb.open) return;
      onGesture();
      startRun();
    });

    // --------------------------------------------------------------- services
    const score = ctx.game.score({ initial: 0, min: 0 });

    function haptic(kind) {
      try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) { /* optional */ }
    }

    let started = false;
    function onGesture() {
      if (!started) {
        started = true;
        try { ctx.platform.start({ level: S.level }); } catch (e) { /* optional */ }
      }
      if (!music && ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music) {
        try {
          const u = ctx.music.unlock();
          if (u && u.catch) u.catch(() => {});
          music = ctx.music.play({ preset: "ambient", volume: tn("music_volume", 0.3), fadeInMs: 5000, intensity: 0.15, density: 0.3 });
        } catch (e) {
          music = null;
        }
      }
    }
    ctx.listen(canvas, "pointerdown", onGesture);

    function save() {
      try {
        if (ctx.capabilities && ctx.capabilities.storage && ctx.storage) {
          const p = ctx.storage.set(STORE_KEY, { v: 1, level: S.level, unlocked: S.unlocked, best: S.best, runs: S.runs });
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* storage optional */ }
    }
    async function load() {
      try {
        if (!(ctx.capabilities && ctx.capabilities.storage && ctx.storage)) return;
        const d = await ctx.storage.get(STORE_KEY);
        if (!d || typeof d !== "object") return;
        S.unlocked = clamp(Math.floor(d.unlocked) || 1, 1, LEVELS);
        S.level = clamp(Math.floor(d.level) || 1, 1, S.unlocked);
        S.best = d.best && typeof d.best === "object" ? d.best : {};
        S.runs = Math.max(0, Math.floor(d.runs) || 0);
      } catch (e) { /* start fresh */ }
    }

    ctx.listen(document, "visibilitychange", () => {
      if (document.hidden) pause();
    });

    // --------------------------------------------------------------- particles
    function seedParticles() {
      particles.length = 0;
      const r = mulberry(42);
      for (let i = 0; i < 240; i++) {
        particles.push({ x: r() * W, y: r() * H, z: 0.15 + r() * r() * 0.85, ph: r() * TAU, sp: 0.4 + r() });
      }
    }

    // ------------------------------------------------------------------- HUD
    function refreshHud(force) {
      if (!force && S.clock - hudAt < 0.1) return;
      hudAt = S.clock;
      el.lv.textContent = lvlLabel(S.level) + " / " + LEVELS;
      el.lvSub.innerHTML = S.mode === "ready" && S.unlocked > 1 ? "TAP TO SHIFT" : "&nbsp;";
      const best = S.best[S.level];
      if (S.mode === "ready") {
        el.time.textContent = "00:00";
        el.pct.textContent = "0%";
        el.sub.innerHTML = best ? "BEST " + (best / 1000).toFixed(1) : "&nbsp;";
      } else if (run) {
        el.time.textContent = fmtClock(run.t);
        el.sub.textContent = Math.round(run.len / U / 6) + " M";
        el.pct.textContent = traceNow() + "%";
      }
    }

    // ---------------------------------------------------------------- render
    function drawArena(now) {
      const s = S.mode === "ready" ? 1 : run.scale;
      const rx = RX * s, ry = RY * s;
      const count = 150;
      const hx = run.x, hy = run.y;
      const live = S.mode === "playing" || S.mode === "resuming";
      g.fillStyle = trailColor(sceneT(), run.P, 1);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        const d = Math.hypot(x - hx, y - hy);
        let al = 0.13 + 0.05 * Math.sin(now * 0.7 + i * 0.35);
        if (live) al += 0.6 * Math.exp(-d / (45 * U));
        g.globalAlpha = al;
        g.fillRect(CX + x - 0.6 * U, CY + y - 0.6 * U, 1.2 * U, 1.2 * U);
      }
      g.globalAlpha = 0.035;
      g.strokeStyle = trailColor(sceneT(), run.P, 1);
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(CX, CY, rx, ry, 0, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }

    function drawWells(now) {
      if (!run.wells.length) return;
      g.strokeStyle = trailColor(sceneT() + 20, run.P, 1);
      g.lineWidth = 0.6;
      for (const w of run.wells) {
        if (S.mode === "ready") wellPos(w, 0, 1);
        for (let k = 0; k < 4; k++) {
          const ph = ((now * 0.12 + k / 4 + w.phase) % 1);
          g.globalAlpha = 0.1 * (1 - ph) * (0.6 + 0.4 * w.str);
          g.beginPath();
          g.arc(CX + w.x, CY + w.y, (6 + ph * 60) * U, 0, TAU);
          g.stroke();
        }
        g.globalAlpha = 0.35;
        g.fillStyle = trailColor(sceneT() + 20, run.P, 1);
        g.beginPath();
        g.arc(CX + w.x, CY + w.y, 1.1 * U, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawParticles(dt, now) {
      const density = tn("particle_density", 1);
      const growth = run && S.mode !== "ready" ? Math.min(1, run.t / 70) : 0;
      const n = Math.floor(clamp((50 + 170 * growth) * density, 0, particles.length));
      let flow = 1;
      if (S.mode === "dying") flow = 0;
      else if (S.mode === "end" || S.mode === "retrace") flow = Math.min(0.35, (S.clock - (S.endAt || S.clock)) * 0.2);
      else if (S.mode === "paused") flow = 0.15;
      const hx = run ? run.x : 0, hy = run ? run.y : 0;
      g.fillStyle = trailColor(sceneT() + 10, run.P, 1);
      for (let i = 0; i < n; i++) {
        const p = particles[i];
        const a = Math.sin(p.x * 0.006 + now * 0.05) + Math.cos(p.y * 0.005 - now * 0.04) + p.ph;
        const v = (3 + 6 * p.z) * p.sp * U * flow;
        p.x += Math.cos(a) * v * dt;
        p.y += (Math.sin(a) * v - 1.5 * U * p.z * flow) * dt;
        if (p.x < -10) p.x += W + 20; else if (p.x > W + 10) p.x -= W + 20;
        if (p.y < -10) p.y += H + 20; else if (p.y > H + 10) p.y -= H + 20;
        const px = p.x - hx * 0.03 * p.z, py = p.y - hy * 0.03 * p.z;
        const tw = 0.55 + 0.45 * Math.sin(now * (0.4 + p.sp) + p.ph * 3);
        g.globalAlpha = (0.05 + 0.3 * p.z) * tw;
        const r = (0.35 + p.z * 1.05) * U;
        g.fillRect(px - r, py - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
    }

    function drawRings(now) {
      g.lineWidth = 0.7;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const age = now - r.t0;
        const life = 9;
        if (age > life) { rings.splice(i, 1); continue; }
        g.globalAlpha = r.bright * Math.sin((age / life) * Math.PI) * (1 - age / life);
        g.strokeStyle = trailColor(age * 4, run.P, 1);
        g.beginPath();
        g.arc(CX + r.x, CY + r.y, (8 + age * r.speed) * U, 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function drawHead(now, hx, hy, intensity) {
      const P = run.P;
      const near = run.near || 0;
      const breath = 1 + 0.18 * Math.sin(now * (S.mode === "ready" ? 1.6 : 4.2));
      const R = (S.mode === "ready" ? 30 : 22) * U * breath * (1 + near * 0.5);
      const x = CX + hx, y = CY + hy;
      const gr = g.createRadialGradient(x, y, 0, x, y, R);
      const ht = sceneT();
      gr.addColorStop(0, trailColor(ht, P, 0.5 * intensity));
      gr.addColorStop(0.25, trailColor(ht, P, 0.16 * intensity));
      gr.addColorStop(1, trailColor(ht, P, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, R, 0, TAU);
      g.fill();
      g.globalAlpha = Math.min(1, intensity);
      g.fillStyle = "#fffdf6";
      g.beginPath();
      g.arc(x, y, 2.3 * U, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }

    function drawDeath(now, dt) {
      const age = now - S.deathAt;
      const x = CX + run.deathX, y = CY + run.deathY;
      if (age < 2.2) {
        const k = age / 2.2;
        g.globalAlpha = 0.55 * (1 - k) * (1 - k);
        g.strokeStyle = "#fffaf0";
        g.lineWidth = 0.8;
        g.beginPath();
        g.arc(x, y, (4 + 110 * (1 - Math.pow(1 - k, 3))) * U, 0, TAU);
        g.stroke();
        const fl = Math.exp(-age * 3);
        const gr = g.createRadialGradient(x, y, 0, x, y, 70 * U);
        gr.addColorStop(0, `rgba(255,250,240,${0.45 * fl})`);
        gr.addColorStop(1, "rgba(255,250,240,0)");
        g.globalAlpha = 1;
        g.fillStyle = gr;
        g.fillRect(x - 70 * U, y - 70 * U, 140 * U, 140 * U);
      }
      g.fillStyle = "#fffaf0";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.age += dt;
        if (s.age > s.life) { sparks.splice(i, 1); continue; }
        const damp = Math.exp(-s.age * 1.4);
        s.x += s.vx * dt * damp;
        s.y += s.vy * dt * damp;
        g.globalAlpha = 0.6 * (1 - s.age / s.life);
        g.fillRect(CX + s.x - 0.6 * U, CY + s.y - 0.6 * U, 1.2 * U, 1.2 * U);
      }
      g.globalAlpha = 1;
      // the dot itself: a dim ember left where it ended
      g.globalAlpha = 0.25 + 0.6 * Math.exp(-age * 1.5);
      g.beginPath();
      g.arc(x, y, 2 * U, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }

    let lastW = 0, lastH = 0;
    function render(dtMs) {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      S.clock += dt;
      const now = S.clock;

      if (ctx.width !== lastW || ctx.height !== lastH || Math.abs(canvas.width / Math.max(1, ctx.width) - pxr) > 0.01) {
        lastW = ctx.width;
        lastH = ctx.height;
        const wasRun = run;
        layout();
        buildBuffers();
        seedParticles();
        if (!wasRun || S.mode === "ready") {
          newRun();
        } else {
          pause();
          run.drawn = 1;
          buildBackground(run.P);
          drawPending(run.xs.length, true);
        }
      }
      if (bgHueBuilt !== run.P.hue * 1000 + run.P.sat) buildBackground(run.P);

      // retrace playback redraws the path at an accelerated pace
      let headX = run.x, headY = run.y, headI = 1;
      if (S.mode === "retrace") {
        const k = clamp((now - S.retraceAt) / S.retraceDur, 0, 1);
        const target = Math.max(2, Math.floor(k * run.xs.length));
        drawPending(target);
        headX = run.xs[target - 1];
        headY = run.ys[target - 1];
        headI = target;
        if (k >= 1) {
          drawPending(run.xs.length, true);
          revealEnd(false);
        }
      } else if (S.mode === "playing" || S.mode === "resuming" || S.mode === "paused") {
        drawPending(run.xs.length);
      }
      updateBloom(now * 1000);

      g.setTransform(pxr, 0, 0, pxr, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.drawImage(bgBuf, 0, 0, W, H);
      {
        // a faint colour wash that follows the drifting palette
        const T = sceneT(), P = run.P;
        const h = (paletteHue(T + 8, P) + T * DRIFT) % 360;
        const a = S.mode === "ready" ? 0.05 : 0.05 + 0.03 * Math.min(1, run.t / 20);
        const wash = g.createRadialGradient(CX, CY, 0, CX, CY, Math.max(W, H) * 0.8);
        wash.addColorStop(0, `hsla(${h.toFixed(1)},${P.sat}%,38%,${a})`);
        wash.addColorStop(1, `hsla(${h.toFixed(1)},${P.sat}%,38%,0)`);
        g.fillStyle = wash;
        g.fillRect(0, 0, W, H);
      }

      drawParticles(dt, now);
      drawRings(now);
      drawArena(now);
      drawWells(now);

      // trail + bloom, additively
      const flare = S.mode === "dying" ? 1 + 0.9 * Math.exp(-(now - S.deathAt) * 1.8) : 1;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, 0.55 * run.P.glow * flare);
      g.imageSmoothingEnabled = true;
      g.drawImage(bloomBuf, 0, 0, W, H);
      g.globalAlpha = Math.min(1, flare);
      g.drawImage(trailBuf, 0, 0, W, H);
      if (flare > 1.01) {
        g.globalAlpha = flare - 1;
        g.drawImage(trailBuf, 0, 0, W, H);
      }
      g.globalAlpha = 1;
      if (run.drawn < run.xs.length || S.mode === "playing" || S.mode === "resuming" || S.mode === "paused" || S.mode === "retrace") {
        const live = S.mode !== "dying" && S.mode !== "end";
        const upto = S.mode === "retrace" ? headI : run.xs.length;
        if (upto > run.drawn || live) {
          g.save();
          g.translate(CX, CY);
          g.lineCap = "butt";
          g.lineJoin = "round";
          trailPasses(g, run.drawn, Math.max(run.drawn, upto), run.t, live ? { x: headX, y: headY } : null);
          g.restore();
        }
      }

      if (S.mode === "ready") {
        drawHead(now, 0, 0, 0.9);
      } else if (S.mode === "playing" || S.mode === "resuming" || S.mode === "paused") {
        const flick = S.mode === "resuming" ? 0.6 + 0.4 * Math.sin((now - S.resumeAt) * 18) : 1;
        drawHead(now, headX, headY, flick);
      } else if (S.mode === "retrace") {
        drawHead(now, headX, headY, 0.8);
      }
      g.globalCompositeOperation = "source-over";

      if (S.mode === "dying" || S.mode === "end" || S.mode === "retrace") {
        if (S.deathAt !== undefined && S.mode !== "retrace") drawDeath(now, dt);
      }

      // veils: pause dims the world; the end state darkens the lower third for type
      if (S.mode === "paused") {
        g.globalAlpha = 0.45;
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      if (S.mode === "end") {
        const k = clamp((now - S.endAt) / 1.4, 0, 1);
        const gr = g.createLinearGradient(0, H * 0.55, 0, H);
        gr.addColorStop(0, "rgba(0,0,0,0)");
        gr.addColorStop(1, `rgba(0,0,0,${0.62 * k})`);
        g.fillStyle = gr;
        g.fillRect(0, H * 0.55, W, H * 0.45);
        if (S.countUp) setEndNumbers(clamp((now - S.endAt) / 1.6, 0, 1));
      }

      // film grain, re-positioned each frame so it breathes
      const grain = tn("grain", 0.07);
      if (grain > 0 && grainPat) {
        g.save();
        g.globalAlpha = grain;
        g.translate((Math.random() * 140) | 0, (Math.random() * 140) | 0);
        g.fillStyle = grainPat;
        g.fillRect(-140, -140, W + 140, H + 140);
        g.restore();
      }

      // instructions + START on the first screen; just START between runs
      if (S.mode === "ready" && now - S.readyAt > 0.4) {
        el.hint.classList.toggle("brief", sessionRuns > 0);
        el.hint.classList.add("on");
      }

      if (S.mode === "playing" && run.t > 1.6) hud.classList.add("fl-dim");
      refreshHud(false);

      if (music && now - musicAt > 2.5 && S.mode === "playing") {
        musicAt = now;
        try { ctx.music.setIntensity(clamp(0.18 + run.t / 120, 0.18, 0.75), { fadeMs: 2400 }); } catch (e) { /* optional */ }
      }
    }

    // ---------------------------------------------------------------- input
    function update(dtMs) {
      const t = S.clock;
      if (input.pressed) {
        steer.anchorX = input.x;
        steer.anchorY = input.y;
        steer.touchT = t;
        steer.moved = 0;
        steer.startTouch = false;
        if (S.mode === "paused") {
          resume();
          steer.startTouch = true;
        } else if (S.mode === "retrace") {
          S.retraceAt = -1e9;
          steer.startTouch = true;
        }
      }
      if (input.down && (S.mode === "playing" || S.mode === "resuming")) {
        let dx = input.x - steer.anchorX, dy = input.y - steer.anchorY;
        const len = Math.hypot(dx, dy);
        steer.moved = Math.max(steer.moved, len);
        if (len > 7) {
          steer.target = Math.atan2(dy, dx);
          steer.strength = clamp(len / 34, 0.35, 1);
          const maxR = 62;
          if (len > maxR) {
            steer.anchorX = input.x - (dx / len) * maxR;
            steer.anchorY = input.y - (dy / len) * maxR;
          }
        }
      }
      if (input.released) {
        const quick = t - steer.touchT < 0.26 && steer.moved < 9;
        steer.target = null;
        if (quick && !steer.startTouch && S.mode === "playing" && run.t > 0.5) pause();
        steer.startTouch = false;
      }
      if (S.mode === "resuming" && t - S.resumeAt > 0.75) S.mode = "playing";
    }

    function fixedUpdate(stepMs) {
      if (S.mode !== "playing" || !run) return;
      step(stepMs / 1000);
    }

    // ----------------------------------------------------------------- boot
    layout();
    buildBuffers();
    seedParticles();
    newRun();
    lastW = ctx.width;
    lastH = ctx.height;
    await load();
    newRun();
    refreshHud(true);
    render(16);

    ctx.game.loop({ input, fixedHz: 120, maxSubsteps: 8, maxDeltaMs: 100, update, fixedUpdate, render: (alpha, state) => render(state && state.dtMs) });

    ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400", style: "normal" }).catch(() => {});

    ctx.onDestroy(() => {
      try { if (music) ctx.music.stop({ fadeOutMs: 300 }); } catch (e) { /* noop */ }
    });

    ctx.platform.ready();
  }
};
