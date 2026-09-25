// A PERFECT IMPERFECTION
// Fifteen rooms in one dark gallery. Each begins perfect. Disturb it, and know when to stop.

window.plethoraBit = {
  meta: {
    title: "A Perfect Imperfection",
    runtime: "plethora-bit@2",
    tags: ["art", "puzzle", "generative", "light", "minimal"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    // ------------------------------------------------------------------ utils
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const sstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const bell = (x, m, w) => Math.exp(-((x - m) / w) * ((x - m) / w));
    // gauge: -1 too perfect .. 0 sweet spot .. +1 too much
    const gz = (x, m, hi) => (x < m ? -clamp((m - x) / m, 0, 1) : clamp((x - m) / (hi - m), 0, 1));
    const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const angDiff = (a, b) => {
      let d = (a - b) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    };
    let seed = (Date.now() ^ 0x9e3779b9) >>> 0;
    function rand() {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const rr = (a, b) => a + (b - a) * rand();
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }
    function hash(i) {
      i = Math.imul(i ^ 61 ^ (i >>> 16), 9);
      i ^= i >>> 4;
      i = Math.imul(i, 0x27d4eb2d);
      i ^= i >>> 15;
      return (i >>> 0) / 4294967296;
    }
    function noise1(x) {
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      return lerp(hash(i), hash(i + 1), u) * 2 - 1;
    }
    function noise2(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const h = (a, b) => hash((Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0);
      return lerp(lerp(h(ix, iy), h(ix + 1, iy), ux), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), ux), uy) * 2 - 1;
    }

    // ---------------------------------------------------------------- colours
    const COL = {
      warm: [255, 236, 214],
      cool: [196, 214, 255],
      ice: [140, 180, 255],
      amber: [255, 150, 70],
      rose: [255, 120, 140],
      pale: [238, 238, 244]
    };
    const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)) + ")";

    function makeBuffer(w, h) {
      if (typeof OffscreenCanvas !== "undefined") {
        try {
          const c = new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
          if (c.getContext("2d")) return c;
        } catch (e) {
          /* fall through */
        }
      }
      return null;
    }

    const SPR = {};
    for (const key of Object.keys(COL)) {
      const c = makeBuffer(64, 64);
      if (!c) continue;
      const x = c.getContext("2d");
      const [r, gg, b] = COL[key];
      const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.07, "rgba(" + r + "," + gg + "," + b + ",0.95)");
      grd.addColorStop(0.2, "rgba(" + r + "," + gg + "," + b + ",0.32)");
      grd.addColorStop(0.5, "rgba(" + r + "," + gg + "," + b + ",0.07)");
      grd.addColorStop(1, "rgba(" + r + "," + gg + "," + b + ",0)");
      x.fillStyle = grd;
      x.fillRect(0, 0, 64, 64);
      SPR[key] = c;
    }
    let grainPattern = null;

    // ---------------------------------------------------------------- surfaces
    const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 1.5, alpha: false, touchAction: "none" });
    const mg = canvas.getContext("2d");
    let g = mg; // scene context (an offscreen trail buffer when available)
    let sceneBuf = null;
    const hud = ctx.createRoot({
      layer: "overlay",
      input: "passthrough",
      style:
        "font-family:'Space Mono',ui-monospace,Menlo,monospace;color:rgba(236,232,224,0.62);" +
        "font-size:10px;letter-spacing:0.22em;text-transform:uppercase;user-select:none;-webkit-user-select:none;"
    });
    const input = ctx.input.track(canvas, { pointerCapture: true });

    let W = 0, H = 0, K = 1, S = 1, cx = 0, cy = 0;
    let bloomA = null, bloomB = null;
    function measure() {
      const w = Math.max(1, ctx.width);
      const h = Math.max(1, ctx.height);
      const k = canvas.width / w || 1;
      if (w === W && h === H && Math.abs(k - K) < 0.001) return false;
      W = w;
      H = h;
      K = k;
      S = Math.min(W, H * 0.62);
      cx = W / 2;
      cy = H * 0.5;
      sceneBuf = makeBuffer(canvas.width, canvas.height);
      g = sceneBuf ? sceneBuf.getContext("2d") : mg;
      bloomA = sceneBuf ? makeBuffer(Math.ceil(W / 5), Math.ceil(H / 5)) : null;
      bloomB = sceneBuf ? makeBuffer(Math.ceil(W / 14), Math.ceil(H / 14)) : null;
      for (const c of [g, mg]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.fillStyle = "#000";
        c.fillRect(0, 0, canvas.width, canvas.height);
      }
      return true;
    }
    measure();

    const grainBuf = makeBuffer(96, 96);
    if (grainBuf) {
      const x = grainBuf.getContext("2d");
      const img = x.createImageData(96, 96);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(rand() * 255);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      try {
        grainPattern = mg.createPattern(grainBuf, "repeat");
      } catch (e) {
        grainPattern = null;
      }
    }

    // ------------------------------------------------------------ environment
    const E = { t: 0, alpha: 1, res: 0, chaos: 0, sync: 0, flash: 0, q: 1 };
    function dot(x, y, r, a, ck) {
      a *= E.alpha;
      if (a < 0.004 || r <= 0) return;
      g.globalAlpha = a > 1 ? 1 : a;
      const s = SPR[ck || "warm"];
      if (s) {
        g.drawImage(s, x - r, y - r, r * 2, r * 2);
      } else {
        const c = COL[ck || "warm"];
        g.fillStyle = rgba(c, 0.12);
        g.beginPath();
        g.arc(x, y, r * 0.45, 0, TAU);
        g.fill();
        g.fillStyle = rgba(c, 1);
        g.beginPath();
        g.arc(x, y, Math.max(0.8, r * 0.09), 0, TAU);
        g.fill();
      }
    }
    function tracePoly(pts, closed) {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      if (closed) g.closePath();
    }
    function glowStroke(c, w, a) {
      a *= E.alpha;
      if (a < 0.004) return;
      g.globalAlpha = 1;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.strokeStyle = rgba(c, a * 0.06);
      g.lineWidth = w * 8;
      g.stroke();
      g.strokeStyle = rgba(c, a * 0.2);
      g.lineWidth = w * 2.8;
      g.stroke();
      g.strokeStyle = rgba(c, a);
      g.lineWidth = w;
      g.stroke();
    }
    function glowPoly(pts, closed, c, w, a) {
      if (pts.length < 4) return;
      tracePoly(pts, closed);
      glowStroke(c, w, a);
    }
    function thinPoly(pts, closed, c, w, a) {
      a *= E.alpha;
      if (pts.length < 4 || a < 0.004) return;
      tracePoly(pts, closed);
      g.globalAlpha = 1;
      g.strokeStyle = rgba(c, a);
      g.lineWidth = w;
      g.stroke();
    }
    function aberrate(pts, closed, amount, a) {
      if (amount <= 0.05) return;
      const off = amount;
      g.save();
      g.translate(off, 0);
      thinPoly(pts, closed, COL.rose, 1, a * 0.5);
      g.translate(-2 * off, 0);
      thinPoly(pts, closed, COL.ice, 1, a * 0.5);
      g.restore();
    }

    // ------------------------------------------------------------------ audio
    const AU = { ac: null, bus: null, verb: null, drone: null, noiseG: null, lp: null, o2: null, lastGrain: 0 };
    const RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
    const noteHz = i => 196 * RATIOS[((i % 5) + 5) % 5] * Math.pow(2, Math.floor(i / 5));
    function audioInit() {
      if (AU.ac || !ctx.capabilities || ctx.capabilities.audio === false) return;
      let ac;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
      } catch (e) {
        return;
      }
      AU.ac = ac;
      const master = ac.createGain();
      master.gain.value = 0.75;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      master.connect(comp);
      comp.connect(ac.destination);
      const bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      // generated reverb
      const len = Math.floor(ac.sampleRate * 3.2);
      const ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const verb = ac.createConvolver();
      verb.buffer = ir;
      const wet = ac.createGain();
      wet.gain.value = 0.55;
      verb.connect(wet);
      wet.connect(master);
      AU.bus = bus;
      AU.verb = verb;
      // drone
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
      lp.Q.value = 0.7;
      const drone = ac.createGain();
      drone.gain.value = 0;
      lp.connect(drone);
      drone.connect(bus);
      drone.connect(verb);
      const o1 = ac.createOscillator();
      o1.frequency.value = 49;
      const o2 = ac.createOscillator();
      o2.frequency.value = 73.5;
      const o3 = ac.createOscillator();
      o3.type = "triangle";
      o3.frequency.value = 98.2;
      const g3 = ac.createGain();
      g3.gain.value = 0.25;
      o1.connect(lp);
      o2.connect(lp);
      o3.connect(g3);
      g3.connect(lp);
      o1.start();
      o2.start();
      o3.start();
      // noise bed for chaos
      const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;
      const ns = ac.createBufferSource();
      ns.buffer = nb;
      ns.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      const noiseG = ac.createGain();
      noiseG.gain.value = 0;
      ns.connect(bp);
      bp.connect(noiseG);
      noiseG.connect(bus);
      noiseG.connect(verb);
      ns.start();
      AU.noiseBuf = nb;
      AU.drone = drone;
      AU.lp = lp;
      AU.o2 = o2;
      AU.noiseG = noiseG;
      ctx.onDestroy(() => {
        try {
          ac.close();
        } catch (e) {
          /* already closed */
        }
      });
    }
    function audioResume() {
      if (AU.ac && AU.ac.state === "suspended") AU.ac.resume().catch(() => {});
    }
    function audioUpdate(active) {
      const ac = AU.ac;
      if (!ac) return;
      const now = ac.currentTime;
      const target = inTitle ? 0.02 : 0.025 + 0.085 * E.res + (active ? 0.02 : 0) + E.flash * 0.05;
      AU.drone.gain.setTargetAtTime(target, now, 0.4);
      AU.lp.frequency.setTargetAtTime(150 + 1100 * E.res + 500 * E.flash, now, 0.5);
      AU.o2.detune.setTargetAtTime(E.chaos * 45, now, 0.3);
      AU.noiseG.gain.setTargetAtTime(E.chaos * 0.06, now, 0.25);
    }
    function tone(f, amp, dur, bright, when) {
      const ac = AU.ac;
      if (!ac) return;
      const t0 = ac.currentTime + (when || 0);
      const parts = [1, 2.76, 5.4, 8.93];
      const amps = [1, 0.34 * bright, 0.14 * bright, 0.05 * bright];
      const out = ac.createGain();
      out.gain.value = amp;
      out.connect(AU.bus);
      out.connect(AU.verb);
      for (let i = 0; i < parts.length; i++) {
        if (amps[i] < 0.002) continue;
        const o = ac.createOscillator();
        o.frequency.value = f * parts[i];
        const e = ac.createGain();
        const d = dur / (1 + i * 0.9);
        e.gain.setValueAtTime(0.0001, t0);
        e.gain.exponentialRampToValueAtTime(amps[i], t0 + 0.006 + i * 0.002);
        e.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        o.connect(e);
        e.connect(out);
        o.start(t0);
        o.stop(t0 + d + 0.05);
      }
    }
    function grain(freq, amp) {
      const ac = AU.ac;
      if (!ac) return;
      if (ac.currentTime - AU.lastGrain < 0.06) return;
      AU.lastGrain = ac.currentTime;
      const t0 = ac.currentTime;
      const s = ac.createBufferSource();
      s.buffer = AU.noiseBuf;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq || rr(2200, 5200);
      bp.Q.value = 9;
      const e = ac.createGain();
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.exponentialRampToValueAtTime(amp || 0.05, t0 + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      s.connect(bp);
      bp.connect(e);
      e.connect(AU.bus);
      e.connect(AU.verb);
      s.start(t0, rand() * 1.5);
      s.stop(t0 + 0.09);
    }
    function soundResolve() {
      const seq = [0, 3, 5, 7, 9, 12];
      seq.forEach((n, i) => tone(noteHz(n + 2), 0.05, 5.5 - i * 0.4, 0.8, i * 0.11));
      tone(noteHz(-5), 0.09, 7, 0.3, 0);
    }
    function soundDissipate() {
      const ac = AU.ac;
      if (!ac) return;
      const t0 = ac.currentTime;
      const s = ac.createBufferSource();
      s.buffer = AU.noiseBuf;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(4200, t0);
      lp.frequency.exponentialRampToValueAtTime(70, t0 + 1.6);
      const e = ac.createGain();
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      s.connect(lp);
      lp.connect(e);
      e.connect(AU.bus);
      e.connect(AU.verb);
      s.start(t0);
      s.stop(t0 + 1.9);
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(330, t0);
      o.frequency.exponentialRampToValueAtTime(40, t0 + 1.4);
      const oe = ac.createGain();
      oe.gain.setValueAtTime(0.05, t0);
      oe.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      o.connect(oe);
      oe.connect(AU.verb);
      o.start(t0);
      o.stop(t0 + 1.6);
    }
    function haptic(kind) {
      try {
        ctx.platform.haptic(kind);
      } catch (e) {
        /* haptics optional */
      }
    }

    // ------------------------------------------------------------------ input
    const P = { x: 0, y: 0, down: false, sx: 0, sy: 0, t0: 0, px: 0, py: 0, dist: 0, vx: 0, vy: 0 };

    // ------------------------------------------------------------------ rooms
    // Each room: init, update(dt), draw(), down/move/up(P), evaluate() -> { r, c, verdict? }, points()
    // r: resonance 0..1 (how close to the hidden sweet spot). c: chaos 0..1 (1 = collapse).

    function R_symmetry() {
      const o = { name: "break the symmetry", chapter: "disturb", how: "Drag one light out of the circle.", goal: "Break the symmetry, only slightly. Let go when it starts to breathe.", ideal: 1, need: 0.8, sustain: 1.2, metrics: ["imperfection", "restraint", "intuition"] };
      let nodes = [], grab = -1, R = 0, a = 0;
      o.init = () => {
        const N = 30;
        R = 0.3 * S;
        nodes = [];
        for (let i = 0; i < N; i++) {
          const th = (i / N) * TAU - TAU / 4;
          const bx = cx + R * Math.cos(th);
          const by = cy + R * Math.sin(th);
          nodes.push({ th, bx, by, ox: 0, oy: 0, x: bx, y: by, vx: 0, vy: 0 });
        }
      };
      o.down = p => {
        let best = -1, bd = 1e9;
        nodes.forEach((n, i) => {
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (bd < Math.max(40, 0.12 * S)) {
          grab = best;
          tone(noteHz(best % 10), 0.05, 1.6, 0.5);
        }
      };
      o.move = p => {
        if (grab < 0) return;
        const n = nodes[grab];
        let dx = p.x - n.bx, dy = p.y - n.by;
        const L = Math.hypot(dx, dy), mx = 0.5 * S;
        if (L > mx) {
          dx *= mx / L;
          dy *= mx / L;
        }
        n.ox = dx;
        n.oy = dy;
      };
      o.up = () => {
        grab = -1;
      };
      o.update = dt => {
        const N = nodes.length;
        let sum = 0;
        for (const n of nodes) sum += n.ox * n.ox + n.oy * n.oy;
        a = Math.sqrt(sum) / S;
        const breathe = 1 + 0.02 * E.res * Math.sin(E.t * 1.5) + 0.01 * E.sync * Math.sin(E.t * 0.7);
        for (let i = 0; i < N; i++) {
          const n = nodes[i];
          let tx = n.ox, ty = n.oy;
          for (let j = 0; j < N; j++) {
            if (j === i) continue;
            const ring = Math.min(Math.abs(i - j), N - Math.abs(i - j));
            const k = Math.exp(-(ring * ring) / 5) * 0.34;
            tx += nodes[j].ox * k;
            ty += nodes[j].oy * k;
          }
          const jit = E.chaos * 16;
          tx += cx + (n.bx - cx) * breathe + noise2(i * 3.1, E.t * 3) * jit;
          ty += cy + (n.by - cy) * breathe + noise2(i * 3.1 + 40, E.t * 3) * jit;
          if (i === grab) {
            n.x = n.bx + n.ox;
            n.y = n.by + n.oy;
            n.vx = n.vy = 0;
            continue;
          }
          n.vx += ((tx - n.x) * 70 - n.vx * 9) * dt;
          n.vy += ((ty - n.y) * 70 - n.vy * 9) * dt;
          n.x += n.vx * dt;
          n.y += n.vy * dt;
        }
      };
      o.evaluate = () => ({ r: bell(a, 0.085, 0.034), c: sstep(0.19, 0.33, a) });
      o.gauge = () => gz(a, 0.085, 0.3);
      o.draw = () => {
        const pts = [];
        for (const n of nodes) pts.push(n.x, n.y);
        const warmth = sstep(0.1, 0.8, E.res);
        glowPoly(pts, true, warmth > 0.5 ? COL.warm : COL.cool, 0.7, 0.05 + 0.2 * E.res);
        aberrate(pts, true, E.chaos * 3, 0.3);
        // tension threads between displaced neighbours
        if (a > 0.005) {
          g.globalAlpha = 1;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const st = Math.hypot(n.x - n.bx, n.y - n.by) / (0.1 * S);
            if (st < 0.05) continue;
            g.beginPath();
            g.moveTo(n.x, n.y);
            g.lineTo(cx + (n.x - cx) * 0.2, cy + (n.y - cy) * 0.2);
            g.strokeStyle = rgba(COL.cool, Math.min(0.12, st * 0.05) * E.alpha);
            g.lineWidth = 0.6;
            g.stroke();
          }
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const pulse = 1 + 0.25 * E.res * Math.sin(E.t * 3 - i * 0.2 * (1 - E.sync));
          dot(n.x, n.y, (8 + 3 * E.res) * pulse, (0.45 + 0.25 * E.res) * (1 - warmth), "cool");
          dot(n.x, n.y, (8 + 3 * E.res) * pulse, (0.45 + 0.3 * E.res) * warmth, "warm");
        }
        dot(cx, cy, 40 + 50 * E.res, 0.03 + 0.07 * E.res, "warm");
      };
      o.points = () => nodes.map(n => ({ x: n.x, y: n.y, b: 1, ck: "warm" }));
      return o;
    }

    function R_drops() {
      const o = { name: "one drop too many", chapter: "disturb", how: "Tap the surface to drop light into it.", goal: "A few spread-out ripples make it alive. Too many drown it.", ideal: 4, need: 0.8, sustain: 1.4, metrics: ["imperfection", "restraint", "balance"] };
      let drops = [], cols = 0, rows = 0, sx = 0, sy = 0, energy = 0, spread = 0;
      const TAUD = 11;
      o.init = () => {
        cols = W < 500 ? 22 : 30;
        sx = W / cols;
        rows = Math.round(H / sx);
        sy = H / rows;
        drops = [];
      };
      o.down = p => {
        const last = drops[drops.length - 1];
        const agit = last && E.t - last.t0 < 0.45 ? 1.6 : 1;
        drops.push({ x: p.x, y: p.y, t0: E.t, A: agit });
        tone(noteHz(Math.floor((1 - p.y / H) * 9)), 0.06, 2.8, 0.7);
        haptic("light");
      };
      o.move = () => {};
      o.up = () => {};
      function height(x, y) {
        let h = 0;
        const v = 0.24 * S, lam = 0.085 * S, L = 0.32 * S;
        for (const d of drops) {
          const age = E.t - d.t0;
          const front = v * age;
          const dist = Math.hypot(x - d.x, y - d.y);
          if (dist > front + 10) continue;
          const behind = front - dist;
          const env = Math.exp(-behind / L) * sstep(front + 10, front - 10, dist) * Math.exp(-age / TAUD);
          h += d.A * env * Math.sin(((dist - front) / lam) * TAU) / Math.sqrt(1 + dist / (0.12 * S));
        }
        return h;
      }
      o.height = height;
      o.update = () => {
        drops = drops.filter(d => Math.exp(-(E.t - d.t0) / TAUD) * d.A > 0.03);
        energy = 0;
        let mx = 0, my = 0, w = 0;
        for (const d of drops) {
          const a = d.A * Math.exp(-(E.t - d.t0) / TAUD);
          energy += a;
          mx += d.x * a;
          my += d.y * a;
          w += a;
        }
        spread = 0;
        if (drops.length > 1 && w > 0) {
          mx /= w;
          my /= w;
          let v = 0;
          for (const d of drops) {
            const a = d.A * Math.exp(-(E.t - d.t0) / TAUD);
            v += a * ((d.x - mx) ** 2 + (d.y - my) ** 2);
          }
          spread = Math.sqrt(v / w) / S;
        }
      };
      o.evaluate = () => ({ r: bell(energy, 3.4, 1.3) * sstep(0.08, 0.2, spread), c: sstep(6.8, 9.6, energy) });
      o.gauge = () => (drops.length > 1 && spread < 0.08 ? -0.5 : gz(energy, 3.4, 9.6));
      o.draw = () => {
        for (let j = 0; j <= rows; j++) {
          for (let i = 0; i <= cols; i++) {
            const x = i * sx, y = j * sy;
            const h = drops.length ? height(x, y) : 0;
            const ah = Math.min(1.2, Math.abs(h));
            const jx = E.chaos * noise2(i * 0.7, j * 0.7 + E.t * 4) * 10;
            dot(x + jx, y + h * 6, 4 + ah * 7, 0.035 + ah * 0.7, h > 0 ? "warm" : "ice");
          }
        }
        for (const d of drops) {
          const age = E.t - d.t0;
          if (age < 0.8) dot(d.x, d.y, 60 * (1 - age / 0.8) + 10, 0.8 * (1 - age / 0.8), "warm");
        }
      };
      o.points = () => {
        const pts = [];
        for (let j = 0; j <= rows; j += 2) for (let i = 0; i <= cols; i += 2) {
          const h = drops.length ? height(i * sx, j * sy) : 0;
          pts.push({ x: i * sx, y: j * sy + h * 6, b: 0.25 + Math.min(1, Math.abs(h)), ck: h > 0 ? "warm" : "ice" });
        }
        return pts;
      };
      return o;
    }

    function R_circle() {
      const o = { name: "break the circle", chapter: "restrain", how: "Drag the edge of the circle outward or inward.", goal: "Make it feel hand-drawn, not broken. Let go when it warms.", ideal: 2, need: 0.8, sustain: 1.3, metrics: ["imperfection", "restraint", "balance"] };
      const M = 120;
      let off, vel, rest, R = 0, grabbing = false, D = 0;
      o.init = () => {
        R = 0.3 * S;
        off = new Float32Array(M);
        vel = new Float32Array(M);
        rest = new Float32Array(M);
      };
      o.down = p => {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (Math.abs(d - R) < Math.max(60, 0.18 * S)) {
          grabbing = true;
          tone(noteHz(3), 0.04, 1.4, 0.4);
        }
      };
      o.move = () => {};
      o.up = () => {
        grabbing = false;
      };
      o.update = dt => {
        if (grabbing) {
          const phi = Math.atan2(P.y - cy, P.x - cx);
          const desired = clamp(Math.hypot(P.x - cx, P.y - cy) - R, -0.55 * R, 0.7 * R);
          for (let i = 0; i < M; i++) {
            const th = (i / M) * TAU;
            const w = Math.exp(-Math.pow(angDiff(th, phi) / 0.34, 2));
            off[i] += (desired - off[i]) * w * Math.min(1, dt * 14);
            rest[i] += (off[i] * 0.72 - rest[i]) * w * Math.min(1, dt * 14);
          }
        }
        const sub = 3, h = dt / sub;
        for (let s = 0; s < sub; s++) {
          for (let i = 0; i < M; i++) {
            const l = off[(i + M - 1) % M] + off[(i + 1) % M] - 2 * off[i];
            vel[i] += (-38 * (off[i] - rest[i]) + 900 * l - 4.5 * vel[i]) * h;
          }
          for (let i = 0; i < M; i++) off[i] += vel[i] * h;
          // smooth the memory too, like clay settling
          for (let i = 0; i < M; i++) {
            const l = rest[(i + M - 1) % M] + rest[(i + 1) % M] - 2 * rest[i];
            rest[i] += l * 2.2 * h;
          }
        }
        let sum = 0;
        for (let i = 0; i < M; i++) sum += rest[i] * rest[i];
        D = Math.sqrt(sum / M) / R;
      };
      o.evaluate = () => ({ r: bell(D, 0.055, 0.024), c: sstep(0.15, 0.26, D) });
      o.gauge = () => gz(D, 0.055, 0.26);
      function ringPts(extra, k) {
        const pts = [];
        for (let i = 0; i < M; i++) {
          const th = (i / M) * TAU;
          const wob = extra * noise2(i * 0.12 + k * 13, E.t * 0.25 + k);
          const jit = E.chaos * noise2(i * 0.5, E.t * 5 + k) * 10;
          const rad = R + off[i] + wob + jit;
          pts.push(cx + rad * Math.cos(th), cy + rad * Math.sin(th));
        }
        return pts;
      }
      o.draw = () => {
        const pts = ringPts(0, 0);
        const life = sstep(0.05, 0.9, E.res);
        glowPoly(pts, true, life > 0.5 ? COL.warm : COL.pale, 0.7 + life * 0.5, 0.26 + 0.4 * E.res);
        for (let k = 1; k <= 2; k++) thinPoly(ringPts(2.2 + 2 * E.res, k), true, COL.warm, 0.7, 0.18 * life);
        aberrate(pts, true, 0.8 + E.chaos * 4, 0.25 + E.chaos * 0.4);
        const ha = E.t * 0.55;
        const hi = Math.floor(((ha % TAU) / TAU) * M);
        dot(pts[hi * 2], pts[hi * 2 + 1], 22 + 20 * E.res, 0.25 + 0.4 * E.res, "warm");
        dot(cx, cy, 0.9 * R, 0.02 + 0.07 * E.res, "warm");
      };
      o.points = () => {
        const p = ringPts(0, 0), out = [];
        for (let i = 0; i < p.length; i += 2) out.push({ x: p[i], y: p[i + 1], b: 0.8, ck: "warm" });
        return out;
      };
      return o;
    }

    function R_center() {
      const o = { name: "miss the center", chapter: "restrain", how: "Press and hold near the point. Do not touch it.", goal: "Get as close as you dare. Touching it collapses everything.", ideal: 1, need: 0.78, sustain: 1.4, holdOk: true, metrics: ["precision", "restraint", "risk"] };
      let motes = [], pt = { x: 0, y: 0 }, touched = false, dLive = 1e9, rLive = 0, prox = 0;
      o.init = () => {
        motes = [];
        for (let i = 0; i < 90; i++) motes.push({ a: rand() * TAU, r: rr(0.06, 0.55) * S, s: rr(0.05, 0.25) * (rand() < 0.5 ? -1 : 1), z: rand() });
        touched = false;
        pt.x = cx;
        pt.y = cy;
      };
      o.down = () => {};
      o.move = () => {};
      o.up = () => {};
      o.update = dt => {
        pt.x = cx + 5 * Math.sin(E.t * 0.63) + 3 * noise1(E.t * 0.4);
        pt.y = cy + 5 * Math.cos(E.t * 0.47) + 3 * noise1(E.t * 0.4 + 9);
        if (P.down && E.live) {
          dLive = Math.hypot(P.x - pt.x, P.y - pt.y);
          if (dLive < 9) touched = true;
          rLive = dLive < 9 ? 0 : bell(dLive, 19, 9);
          prox = clamp(1 - dLive / (0.4 * S), 0, 1);
        } else {
          dLive = 1e9;
          rLive = 0;
          prox = Math.max(0, prox - dt * 1.5);
        }
        for (const m of motes) {
          m.a += m.s * dt * (1 + prox * 3);
          const target = m.z * 0.55 * S * (1 - prox * 0.6) + 0.04 * S;
          m.r += (target - m.r) * dt * 0.8;
        }
      };
      o.evaluate = () => ({ r: rLive, c: touched ? 1 : 0 });
      o.gauge = () => (!P.down ? -1 : dLive > 19 ? -clamp((dLive - 19) / (0.4 * S), 0, 1) : clamp((19 - dLive) / 10, 0, 1));
      o.draw = () => {
        const fx = P.down ? P.x : pt.x, fy = P.down ? P.y : pt.y;
        for (const m of motes) {
          let x = pt.x + Math.cos(m.a) * m.r, y = pt.y + Math.sin(m.a) * m.r;
          if (prox > 0) {
            // lensing toward the axis between finger and point
            const k = prox * prox * 0.35;
            x = lerp(x, (x + fx) / 2, k);
            y = lerp(y, (y + fy) / 2, k);
          }
          dot(x, y, 5 + 5 * prox, 0.12 + 0.5 * prox * (1 - m.z * 0.5) + 0.2 * E.res, m.z > 0.6 ? "cool" : "warm");
        }
        for (let k = 0; k < 3; k++) {
          const rad = (0.05 + k * 0.045) * S * (1 - 0.3 * prox);
          const pts = [];
          for (let i = 0; i <= 64; i++) {
            const th = (i / 64) * TAU;
            let x = pt.x + Math.cos(th) * rad, y = pt.y + Math.sin(th) * rad;
            if (P.down) {
              const dx = fx - x, dy = fy - y, dd = Math.hypot(dx, dy) + 1;
              const pull = prox * 18 * Math.exp(-dd / (0.12 * S));
              x += (dx / dd) * pull;
              y += (dy / dd) * pull;
            }
            pts.push(x, y);
          }
          thinPoly(pts, false, COL.cool, 0.6, (0.04 + 0.2 * prox) * (1 - k * 0.25));
        }
        const inten = P.down ? Math.min(1, 26 / Math.max(10, dLive)) : 0;
        dot(pt.x, pt.y, 10 + 90 * inten * inten + 40 * E.res, 0.9, "warm");
        dot(pt.x, pt.y, 4, 1, "pale");
        if (P.down) dot(P.x, P.y, 50, 0.06 + 0.1 * prox, "cool");
      };
      o.points = () => motes.map(m => ({ x: pt.x + Math.cos(m.a) * m.r, y: pt.y + Math.sin(m.a) * m.r, b: 0.6, ck: "warm" })).concat([{ x: pt.x, y: pt.y, b: 1, ck: "warm" }]);
      return o;
    }

    function R_colour() {
      const o = { name: "the wrong colour", chapter: "balance", how: "Drag the orange light somewhere new.", goal: "Find the spot where the odd colour balances the picture.", ideal: 1, need: 0.8, sustain: 1.2, metrics: ["composition", "restraint", "intuition"] };
      let mass = [], dust = [], M = { x: 0, y: 0 }, Pi = { x: 0, y: 0 }, orb = null, grab = false, r = 0, c = 0;
      o.init = () => {
        const qx = rand() < 0.5 ? 1 : 2, qy = rand() < 0.5 ? 1 : 2;
        const gx = t => cx + (t === 1 ? -1 : 1) * Math.min(W * 0.17, S * 0.36);
        const gy = t => cy + (t === 1 ? -1 : 1) * S * 0.32;
        M = { x: gx(qx), y: gy(qy) };
        const opp = { x: gx(3 - qx), y: gy(3 - qy) };
        Pi = { x: lerp(opp.x, cx, 0.12), y: lerp(opp.y, cy, 0.12) };
        mass = [];
        const rot = rr(-0.6, 0.6);
        for (let i = 0; i < 150; i++) {
          const u = (rand() + rand() + rand() - 1.5) * 0.9, v = (rand() + rand() + rand() - 1.5) * 0.9;
          const x = u * 0.2 * S, y = v * 0.12 * S;
          mass.push({ hx: M.x + x * Math.cos(rot) - y * Math.sin(rot), hy: M.y + x * Math.sin(rot) + y * Math.cos(rot), s: rand(), x: 0, y: 0 });
        }
        dust = [];
        for (let i = 0; i < 36; i++) dust.push({ x: rand() * W, y: rr(0.12, 0.88) * H, s: rand() });
        orb = { x: lerp(M.x, cx, 0.25) + rr(-10, 10), y: lerp(M.y, cy, 0.25), vx: 0, vy: 0 };
      };
      o.down = p => {
        if (Math.hypot(p.x - orb.x, p.y - orb.y) < Math.max(60, 0.16 * S)) {
          grab = true;
          tone(noteHz(7), 0.05, 1.8, 0.6);
          haptic("light");
        }
      };
      o.move = () => {};
      o.up = () => {
        grab = false;
      };
      o.update = dt => {
        if (grab) {
          orb.vx += ((P.x - orb.x) * 90 - orb.vx * 12) * dt;
          orb.vy += ((P.y - orb.y) * 90 - orb.vy * 12) * dt;
        } else {
          orb.vx *= Math.exp(-dt * 6);
          orb.vy *= Math.exp(-dt * 6);
        }
        orb.x = clamp(orb.x + orb.vx * dt, 10, W - 10);
        orb.y = clamp(orb.y + orb.vy * dt, 10, H - 10);
        for (const m of mass) {
          const a = noise2(m.hx * 0.01, E.t * 0.1 + m.s) * TAU;
          m.x = m.hx + Math.cos(a) * 7 + E.chaos * noise2(m.s * 50, E.t * 6) * 8;
          m.y = m.hy + Math.sin(a) * 7;
        }
        const dP = Math.hypot(orb.x - Pi.x, orb.y - Pi.y) / S;
        r = bell(dP, 0, 0.07);
        const dM = Math.hypot(orb.x - M.x, orb.y - M.y) / S;
        const edge = Math.min(orb.x, W - orb.x, orb.y, H - orb.y);
        c = Math.min(0.8, Math.max(bell(dM, 0, 0.16), sstep(60, 12, edge)) * 0.85);
      };
      o.evaluate = () => ({ r, c });
      o.dbg = () => ({ x: Pi.x, y: Pi.y, ox: orb.x, oy: orb.y });
      o.draw = () => {
        for (const d of dust) dot(d.x, d.y + Math.sin(E.t * 0.2 + d.s * 9) * 6, 5, 0.1 + 0.1 * E.res, "cool");
        for (const m of mass) {
          const d = Math.hypot(m.x - orb.x, m.y - orb.y);
          const w = Math.exp(-Math.pow(d / (0.34 * S), 2)) * (0.25 + 0.75 * E.res);
          const flick = 1 - E.chaos * 0.6 * (0.5 + 0.5 * Math.sin(E.t * 23 + m.s * 40));
          dot(m.x, m.y, 6 + m.s * 4, (0.16 + 0.16 * m.s) * flick * (1 - w * 0.7), "cool");
          if (w > 0.03) dot(m.x, m.y, 6 + m.s * 4, 0.3 * w * flick, "amber");
        }
        dot(M.x, M.y, 0.4 * S, 0.05, "cool");
        const breathe = 1 + 0.12 * E.res * Math.sin(E.t * 1.6);
        dot(orb.x, orb.y, 110 * breathe, 0.1 + 0.18 * E.res, "amber");
        dot(orb.x, orb.y, 30 * breathe, 0.75, "amber");
        dot(orb.x, orb.y, 9, 0.8, "warm");
      };
      o.points = () => mass.filter((m, i) => i % 2 === 0).map(m => ({ x: m.x, y: m.y, b: 0.6, ck: "cool" })).concat([{ x: orb.x, y: orb.y, b: 1, ck: "amber" }]);
      return o;
    }

    function R_balance() {
      const o = { name: "balance", chapter: "balance", how: "Tap left or right to drop weight on the beam.", goal: "Tilt it until it looks about to fall, but does not.", ideal: 3, need: 0.78, sustain: 1.8, metrics: ["tension", "restraint", "risk"] };
      let th = 0, w = 0, L = 0, by = 0, top = 0, masses = [], falling = [], slideOff = false;
      o.init = () => {
        L = 0.68 * S;
        by = cy + 0.06 * S;
        top = cy - 0.42 * S;
        th = 0;
        w = 0;
        masses = [];
        falling = [];
        slideOff = false;
      };
      o.down = p => {
        if (masses.length + falling.length >= 24) return;
        falling.push({ x: p.x, y: Math.min(p.y, by - 50), vy: 0 });
        tone(noteHz(p.x < cx ? 2 : 4), 0.04, 1.4, 0.7);
      };
      o.move = () => {};
      o.up = () => {};
      o.update = dt => {
        const c = Math.cos(th), s = Math.sin(th);
        for (let i = falling.length - 1; i >= 0; i--) {
          const f = falling[i];
          f.vy += 1600 * dt;
          f.y += f.vy * dt;
          const u = clamp(((f.x - cx) * c) / L, -0.5, 0.5);
          const beamY = by + u * L * s;
          if (f.y >= beamY) {
            falling.splice(i, 1);
            masses.push({ u, m: 1 });
            grain(1800, 0.06);
            haptic("light");
          }
        }
        let tau = 0;
        for (const m of masses) tau += m.u * m.m;
        const tremble = noise1(E.t * 2.7) * 0.28 * sstep(0.18, 0.34, Math.abs(th));
        const acc = 7 * (-Math.sin(th) + 0.25 * tau * Math.cos(th)) - 2.4 * w + tremble;
        w += acc * dt;
        th += w * dt;
        if (Math.abs(th) > 0.43) {
          for (const m of masses) m.u += Math.sign(th) * (Math.sin(Math.abs(th)) - 0.41) * 1.2 * dt;
        }
        for (const m of masses) if (Math.abs(m.u) > 0.52) slideOff = true;
      };
      o.evaluate = () => {
        const a = Math.abs(th);
        return { r: bell(a, 0.33, 0.08) * sstep(0.5, 0.15, Math.abs(w)), c: slideOff || a > 0.85 ? 1 : sstep(0.46, 0.85, a) * 0.95 };
      };
      o.gauge = () => gz(Math.abs(th), 0.33, 0.85);
      o.draw = () => {
        const c = Math.cos(th), s = Math.sin(th);
        const ax = cx - (L / 2) * c, ay = by - (L / 2) * s, bx2 = cx + (L / 2) * c, byy = by + (L / 2) * s;
        const tension = sstep(0.1, 0.35, Math.abs(th));
        // thread
        const vib = w * 6 + tension * Math.sin(E.t * 40) * 0.8;
        thinPoly([cx, top, cx + vib, (top + by) / 2, cx, by], false, COL.pale, 0.6, 0.18 + 0.2 * tension);
        dot(cx, top, 8, 0.5, "pale");
        glowPoly([ax, ay, bx2, byy], false, tension > 0.5 ? COL.warm : COL.cool, 0.8, 0.32 + 0.35 * E.res);
        for (let i = 0; i <= 24; i++) {
          const u = i / 24 - 0.5;
          dot(cx + u * L * c, by + u * L * s, 5, 0.08 + 0.14 * E.res, "cool");
        }
        dot(cx, by, 12, 0.8, "warm");
        for (const m of masses) {
          const x = cx + m.u * L * c - s * 7, y = by + m.u * L * s + c * -7;
          dot(x, y, 14 + 6 * E.res, 0.85, "warm");
        }
        for (const f of falling) dot(f.x, f.y, 14, 0.8, "warm");
        if (tension > 0) dot(cx, by, 0.6 * S, 0.04 * tension + 0.08 * E.res, "amber");
      };
      o.points = () => {
        const c = Math.cos(th), s = Math.sin(th), pts = [];
        for (let i = 0; i <= 30; i++) {
          const u = i / 30 - 0.5;
          pts.push({ x: cx + u * L * c, y: by + u * L * s, b: 0.6, ck: "cool" });
        }
        for (const m of masses) pts.push({ x: cx + m.u * L * c, y: by + m.u * L * s - 7, b: 1, ck: "warm" });
        return pts;
      };
      return o;
    }

    function R_flow() {
      const o = { name: "interrupt the flow", chapter: "interrupt", how: "Press into the stream, then let go.", goal: "A short press makes a graceful wave. Too long turns to chaos.", ideal: 1, need: 0.72, sustain: 0.2, metrics: ["imperfection", "restraint", "intuition"], tapOnly: true };
      let parts = [], waves = [], I = 0, judging = false, judgeT = 0, lanes = 11, hb = 0, touching = false, verdict = null, r = 0, fx = 0, fy = 0;
      o.init = () => {
        hb = 0.2 * S;
        parts = [];
        const per = W < 500 ? 22 : 34;
        for (let l = 0; l < lanes; l++) for (let i = 0; i < per; i++) parts.push({ l, x: (i / per) * (W + 40) - 20 + rr(-8, 8), sp: rr(0.9, 1.1), oy: 0, vy: 0, s: rand() });
        waves = [];
        I = 0;
        judging = false;
        verdict = null;
      };
      const laneY = l => cy - hb + (l / (lanes - 1)) * 2 * hb;
      o.down = p => {
        if (judging) return;
        touching = true;
        I = 0;
        fx = p.x;
        fy = p.y;
        tone(noteHz(1), 0.04, 1.2, 0.5);
      };
      o.move = () => {};
      o.up = () => {
        if (!touching) return;
        touching = false;
        if (I > 0.04) {
          const A = 0.1 * S * (I / 0.55);
          waves.push({ x0: fx, t0: E.t, A, turb: sstep(0.95, 1.6, I) });
          judging = true;
          judgeT = 0;
          r = bell(I, 0.55, 0.3);
          tone(noteHz(r > 0.7 ? 5 : 0), 0.06, 3, 0.8);
        }
      };
      function waveOff(x, l) {
        let y = 0;
        for (const w of waves) {
          const age = E.t - w.t0;
          const s = x - (w.x0 + 0.42 * W * age);
          const env = Math.exp(-(s * s) / Math.pow(0.24 * W, 2)) * Math.exp(-age / 4);
          if (env < 0.002) continue;
          const lf = 0.55 + 0.45 * Math.cos(((l - (lanes - 1) / 2) / lanes) * 2.4);
          y += w.A * env * lf * Math.sin((s / (0.2 * W)) * TAU + l * 0.22);
          if (w.turb > 0) y += w.turb * env * noise2(x * 0.02, l + E.t * 3) * 0.14 * S;
        }
        return y;
      }
      o.update = dt => {
        const v = 0.15 * W + 40;
        if (touching) {
          fx = P.x;
          fy = P.y;
          const depth = 1 - clamp(Math.abs(fy - cy) / (hb + 30), 0, 1);
          const sp = Math.min(3000, Math.hypot(P.vx, P.vy));
          I += dt * depth * (1 + sp * 0.0012);
        }
        for (const p of parts) {
          p.x += v * p.sp * dt;
          if (p.x > W + 20) p.x -= W + 40;
          let target = 0;
          if (touching) {
            const y = laneY(p.l);
            const dx = p.x - fx, dy = y - fy, d = Math.hypot(dx, dy), Rf = 0.17 * S;
            if (d < Rf) target = (dy >= 0 ? 1 : -1) * (Rf - d) * 0.95;
          }
          p.vy += ((target - p.oy) * 60 - p.vy * 9) * dt;
          p.oy += p.vy * dt;
        }
        waves = waves.filter(w => E.t - w.t0 < 5);
        if (judging) {
          judgeT += dt;
          if (judgeT > 1.7 && !verdict) {
            if (r >= o.need) verdict = "resolve";
            else if (I > 1.2) verdict = "collapse";
            else {
              judging = false;
              I = 0;
              r = 0;
              grain(600, 0.05);
            }
          }
        }
      };
      o.gauge = () => (touching || judging ? gz(I, 0.55, 2.1) : -1);
      o.cue = () => {
        if (judging) return r >= o.need ? "yes. watch the wave" : I > 0.9 ? "too long. try a shorter press" : "too short. press a little longer";
        if (!touching) return null;
        if (I > 0.9) return "too long";
        return bell(I, 0.55, 0.3) >= o.need ? "now. let go" : "keep pressing...";
      };
      o.evaluate = () => {
        if (judging) return { r: r * sstep(0, 0.6, judgeT), c: 0, verdict };
        return { r: touching ? bell(I, 0.55, 0.3) * 0.55 : 0, c: sstep(1.4, 2.1, I) };
      };
      o.draw = () => {
        for (const p of parts) {
          const y = laneY(p.l) + p.oy + waveOff(p.x, p.l);
          const wv = Math.min(1, Math.abs(waveOff(p.x, p.l)) / (0.06 * S));
          dot(p.x, y, 5 + wv * 4, 0.16 + 0.5 * wv + 0.12 * E.res, wv > 0.3 ? "warm" : "cool");
        }
        if (touching) dot(fx, fy, 0.17 * S, 0.06, "cool");
      };
      o.points = () => parts.filter((p, i) => i % 2 === 0).map(p => ({ x: p.x, y: laneY(p.l) + p.oy + waveOff(p.x, p.l), b: 0.6, ck: "cool" }));
      return o;
    }

    function R_rhythm() {
      const o = { name: "break the rhythm", chapter: "interrupt", how: "Drag dots sideways to change the beat. Drag up to accent one.", goal: "Break the even beat into a pattern that repeats.", ideal: 4, need: 0.74, sustain: 2.6, metrics: ["cadence", "restraint", "intuition"] };
      const N = 8, STEPS = 16, BAR = 2.4;
      let dots = [], x0 = 0, x1 = 0, step = 0, grab = -1, lastPh = 0, r = 0, c = 0, flashes = [];
      o.init = () => {
        x0 = Math.max(28, cx - 0.46 * S);
        x1 = Math.min(W - 28, cx + 0.46 * S);
        step = (x1 - x0) / STEPS;
        dots = [];
        for (let i = 0; i < N; i++) dots.push({ st: i * 2, home: i * 2, x: x0 + (i * 2 + 0.5) * step, y: cy, size: 1, fl: 0 });
      };
      const sx = st => x0 + (st + 0.5) * step;
      o.down = p => {
        let best = -1, bd = 1e9;
        dots.forEach((d, i) => {
          const dd = Math.hypot(d.x - p.x, d.y - p.y);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        });
        if (bd < Math.max(34, step * 1.2)) {
          grab = best;
          dots[best].gy = p.y;
          dots[best].gs = dots[best].size;
        }
      };
      o.move = () => {};
      o.up = () => {
        if (grab >= 0) {
          const d = dots[grab];
          d.st = clamp(Math.round((d.x - x0) / step - 0.5), 0, STEPS - 1);
          haptic("light");
        }
        grab = -1;
      };
      function score() {
        const st = dots.map(d => d.st).sort((a, b) => a - b);
        const iv = [];
        for (let i = 0; i < N; i++) iv.push(i < N - 1 ? st[i + 1] - st[i] : st[0] + STEPS - st[N - 1]);
        const collisions = iv.filter(v => v === 0).length;
        const distinct = new Set(iv).size;
        const v = [0, 0, 0.85, 1, 0.72, 0.4, 0.3, 0.25, 0.2][distinct] || 0.2;
        let rep = 0;
        for (const per of [2, 3, 4]) {
          let m = 0;
          for (let i = 0; i < N; i++) if (iv[i] === iv[(i + per) % N]) m++;
          rep = Math.max(rep, m / N);
        }
        const moved = dots.filter(d => d.st !== d.home).length;
        let dn = 0, dc = 0, on = 0, oc = 0;
        for (const d of dots) {
          if (d.st % 4 === 0) {
            dn += d.size;
            dc++;
          } else {
            on += d.size;
            oc++;
          }
        }
        const acc = dc && oc ? sstep(1.0, 1.35, dn / dc / (on / oc)) : 0;
        r = v * (0.45 + 0.55 * rep) * (0.8 + 0.2 * acc) * sstep(0, 2, moved) * (collisions ? 0.25 : 1);
        c = Math.min(0.8, collisions * 0.3);
      }
      o.update = dt => {
        if (grab >= 0) {
          const d = dots[grab];
          let tx = clamp(P.x, x0 + step * 0.5, x1 - step * 0.5);
          const f = (tx - x0) / step - 0.5, nearest = Math.round(f);
          if (Math.abs(f - nearest) < 0.3) tx = lerp(tx, sx(nearest), 0.6);
          d.x += (tx - d.x) * Math.min(1, dt * 25);
          d.y = cy + clamp(P.y - d.gy, -120, 120) * 0.5;
          d.size = clamp(d.gs - (P.y - d.gy) / 90, 0.6, 2.2);
          const st = clamp(Math.round((d.x - x0) / step - 0.5), 0, STEPS - 1);
          if (st !== d.lastSt) {
            d.lastSt = st;
            grain(2600, 0.03);
          }
        }
        for (let i = 0; i < N; i++) {
          if (i === grab) continue;
          const d = dots[i];
          d.x += (sx(d.st) - d.x) * Math.min(1, dt * 12);
          d.y += (cy - d.y) * Math.min(1, dt * 10);
        }
        score();
        const ph = ((E.t % BAR) / BAR) * STEPS;
        const sorted = dots.map((d, i) => i).sort((a, b) => dots[a].st - dots[b].st);
        for (const i of sorted) {
          const d = dots[i];
          const hit = lastPh <= ph ? d.st >= lastPh && d.st < ph : d.st >= lastPh || d.st < ph;
          if (hit && i !== grab) {
            d.fl = 1;
            const rank = sorted.indexOf(i);
            const contour = [0, 2, 4, 3, 5, 7, 6, 9][rank];
            tone(noteHz(contour + (d.size > 1.3 ? -5 : 0)), 0.018 + 0.03 * d.size, 1.4 + d.size * 0.6, 0.4 + 0.3 * E.res);
            flashes.push({ x: d.x, y: d.y, t: 0, s: d.size });
          }
        }
        lastPh = ph;
        for (const d of dots) d.fl = Math.max(0, d.fl - dt * 3);
        for (const f of flashes) f.t += dt;
        flashes = flashes.filter(f => f.t < 1.2);
      };
      o.evaluate = () => ({ r: grab >= 0 ? r * 0.6 : r, c });
      o.draw = () => {
        const ph = ((E.t % BAR) / BAR) * STEPS;
        const px = x0 + ph * step;
        thinPoly([px, cy - 0.16 * S, px, cy + 0.16 * S], false, COL.cool, 1, 0.08 + 0.08 * E.res);
        for (let s = 0; s <= STEPS; s += 4) dot(x0 + s * step, cy + 0.12 * S, 4, 0.12, "cool");
        thinPoly([x0, cy, x1, cy], false, COL.cool, 0.5, 0.06 + 0.06 * E.res);
        for (const f of flashes) {
          const pts = [];
          const rad = 8 + f.t * 60 * f.s;
          for (let i = 0; i <= 40; i++) pts.push(f.x + Math.cos((i / 40) * TAU) * rad, f.y + Math.sin((i / 40) * TAU) * rad);
          thinPoly(pts, false, COL.warm, 0.7, 0.3 * (1 - f.t / 1.2));
        }
        for (const d of dots) {
          const jit = E.chaos * noise2(d.x, E.t * 8) * 6;
          dot(d.x + jit, d.y, (10 + 10 * d.fl) * d.size, 0.35 + 0.5 * d.fl, d.size > 1.3 ? "warm" : "cool");
          dot(d.x + jit, d.y, 4 * d.size, 0.7, "pale");
        }
      };
      o.points = () => dots.map(d => ({ x: d.x, y: d.y, b: 1, ck: "warm" }));
      return o;
    }

    function R_remove() {
      const o = { name: "remove one", chapter: "observe", how: "One light is slightly different. Tap it.", goal: "Watch its colour, pulse and spacing. Wrong taps unsettle the field.", ideal: 1, need: 0.9, sustain: 0.1, tapOnly: true, metrics: ["observation", "restraint", "intuition"] };
      let pts = [], odd = -1, traits = [], sp = 0, wrongs = 0, found = false, gone = [];
      o.init = () => {
        sp = S * 0.105;
        const rowH = sp * 0.866;
        const cols = Math.max(5, Math.floor((W * 0.84) / sp));
        const rows = Math.max(6, Math.floor((H * 0.56) / rowH));
        const ox = cx - ((cols - 1) * sp) / 2 - sp / 4, oy = cy - ((rows - 1) * rowH) / 2;
        pts = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push({ hx: ox + i * sp + (j % 2) * sp * 0.5, hy: oy + j * rowH, x: 0, y: 0, alive: true, ph: 0, dx: 0, dy: 0 });
        const inner = pts.map((p, i) => i).filter(i => {
          const p = pts[i];
          return Math.abs(p.hx - cx) < W * 0.34 && Math.abs(p.hy - cy) < H * 0.22;
        });
        odd = pick(inner);
        traits = shuffle(["phase", "warm", "offset", "decay", "drift"]).slice(0, 2);
        const a = rand() * TAU;
        pts[odd].dx = Math.cos(a) * sp * 0.13;
        pts[odd].dy = Math.sin(a) * sp * 0.13;
        wrongs = 0;
        found = false;
        gone = [];
      };
      o.down = () => {};
      o.move = () => {};
      o.up = p => {
        if (found || p.dist > 18) return;
        let best = -1, bd = 1e9;
        pts.forEach((q, i) => {
          if (!q.alive) return;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best < 0 || bd > sp * 0.7) return;
        pts[best].alive = false;
        gone.push({ x: pts[best].x, y: pts[best].y, t: 0 });
        if (best === odd) {
          found = true;
        } else {
          wrongs++;
          pts.forEach(q => (q.ph += rr(-1, 1) * 0.5));
          soundDissipateSoft();
        }
      };
      o.update = dt => {
        const t = E.t;
        const br = 1 + 0.012 * Math.sin(t * 0.8);
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          let x = cx + (q.hx - cx) * br, y = cy + (q.hy - cy) * br;
          if (i === odd) {
            if (traits.includes("offset")) {
              x += q.dx;
              y += q.dy;
            }
            if (traits.includes("drift")) {
              x += Math.sin(t * 5.3) * sp * 0.05;
              y += Math.cos(t * 4.1) * sp * 0.04;
            }
          }
          const j = E.chaos * 7;
          q.x = x + noise2(i, t * 3) * j;
          q.y = y + noise2(i + 99, t * 3) * j;
        }
        for (const gq of gone) gq.t += dt;
      };
      o.evaluate = () => ({ r: found ? 1 : 0, c: wrongs >= 3 ? 1 : wrongs * 0.28, verdict: found ? "resolve" : null });
      o.dbg = () => ({ x: pts[odd].x, y: pts[odd].y });
      o.draw = () => {
        const t = E.t;
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          if (!q.alive) continue;
          let ph = q.ph * (1 - E.sync), amp = 0.28, sp2 = 1.7;
          let warm = 0;
          if (i === odd) {
            if (traits.includes("phase")) ph += 1.0;
            if (traits.includes("decay")) {
              amp = 0.46;
              sp2 = 1.45;
            }
            if (traits.includes("warm")) warm = 0.33;
          }
          const b = 0.55 + amp * Math.sin(t * sp2 + ph);
          dot(q.x, q.y, 9, b * 0.8 * (1 - warm), "cool");
          if (warm) dot(q.x, q.y, 9, b * 0.8 * warm * 1.2, "amber");
        }
        for (const gq of gone) if (gq.t < 1.2) dot(gq.x, gq.y - gq.t * 20, 11 + gq.t * 30, 0.6 * (1 - gq.t / 1.2), "pale");
      };
      o.points = () => pts.filter(q => q.alive).map(q => ({ x: q.x, y: q.y, b: 0.8, ck: "cool" }));
      return o;
    }
    function soundDissipateSoft() {
      tone(noteHz(-3), 0.03, 1.2, 0.1);
      grain(500, 0.05);
      haptic("light");
    }

    function R_perfect() {
      const o = { name: "find the imperfection", chapter: "observe", how: "Every shape is flawed except one. Tap the perfect one.", goal: "Compare the petals closely. Wrong taps dissolve that shape.", ideal: 1, need: 0.9, sustain: 0.1, tapOnly: true, metrics: ["observation", "restraint", "intuition"] };
      let shapes = [], wrongs = 0, found = -1, fade = 0, foundT = 0;
      o.init = () => {
        shapes = [];
        const cols = 3, rows = 4;
        const cw = Math.min(W * 0.28, S * 0.3), ch = Math.min((H * 0.62) / rows, S * 0.36);
        const Rs = Math.min(cw, ch) * 0.35;
        const kinds = shuffle(["perfect", "lobe", "stretch", "skew", "dent", "lobe", "stretch", "skew", "dent", "lobe", "skew", "dent"]);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const k = kinds[j * cols + i];
          shapes.push({ x: cx + (i - 1) * cw, y: cy + (j - 1.5) * ch, R: Rs, kind: k, a: rand() * TAU, w: rr(0.12, 0.3) * (rand() < 0.5 ? -1 : 1), at: rand() * TAU, amt: rr(0.8, 1.15), alive: 1, gone: false });
        }
        wrongs = 0;
        found = -1;
        fade = 0;
      };
      function radius(sh, th) {
        let t = th, r = 1 + 0.17 * Math.cos(6 * t);
        if (sh.kind === "skew") {
          t = th + 0.1 * sh.amt * Math.sin(th - sh.at);
          r = 1 + 0.17 * Math.cos(6 * t);
        }
        if (sh.kind === "lobe") r += 0.14 * sh.amt * Math.exp(-Math.pow(angDiff(th, sh.at) / 0.35, 2));
        if (sh.kind === "dent") r -= 0.12 * sh.amt * Math.exp(-Math.pow(angDiff(th, sh.at) / 0.45, 2));
        return r;
      }
      function shapePts(sh) {
        const pts = [];
        const n = 84;
        for (let i = 0; i < n; i++) {
          const th = (i / n) * TAU;
          const rad = sh.R * radius(sh, th);
          let x = Math.cos(th) * rad, y = Math.sin(th) * rad;
          if (sh.kind === "stretch") x *= 1 + 0.1 * sh.amt;
          const ca = Math.cos(sh.a), sa = Math.sin(sh.a);
          pts.push(sh.x + x * ca - y * sa, sh.y + x * sa + y * ca);
        }
        return pts;
      }
      o.down = () => {};
      o.move = () => {};
      o.up = p => {
        if (found >= 0 || p.dist > 18) return;
        let best = -1, bd = 1e9;
        shapes.forEach((sh, i) => {
          if (sh.gone) return;
          const d = Math.hypot(sh.x - p.x, sh.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best < 0 || bd > shapes[best].R * 1.7) return;
        if (shapes[best].kind === "perfect") {
          found = best;
          foundT = E.t;
        } else {
          shapes[best].gone = true;
          wrongs++;
          soundDissipateSoft();
        }
      };
      o.update = dt => {
        for (const sh of shapes) {
          sh.a += sh.w * dt * (1 - E.sync * 0.9);
          if (sh.gone) sh.alive = Math.max(0, sh.alive - dt * 1.2);
        }
        if (found >= 0) fade = sstep(0.2, 2.6, E.t - foundT);
      };
      o.evaluate = () => ({ r: found >= 0 ? 1 : 0, c: wrongs >= 3 ? 1 : wrongs * 0.26, verdict: found >= 0 ? "resolve" : null });
      o.dbg = () => shapes.filter(sh => sh.kind === "perfect").map(sh => ({ x: sh.x, y: sh.y }))[0];
      o.draw = () => {
        shapes.forEach((sh, i) => {
          let a = sh.alive;
          if (found >= 0 && i !== found) a *= 1 - fade;
          if (a < 0.01) return;
          const pts = shapePts(sh);
          const jx = E.chaos * 3;
          if (jx) {
            for (let k = 0; k < pts.length; k++) pts[k] += noise2(k * 0.3, E.t * 6 + i) * jx;
          }
          const hi = i === found ? 1 : 0;
          glowPoly(pts, true, hi ? COL.warm : COL.pale, 0.9 + hi, (0.4 + 0.3 * hi) * a);
          dot(sh.x, sh.y, sh.R * (0.5 + hi), (0.12 + 0.4 * hi) * a, "warm");
        });
      };
      o.points = () => {
        const out = [];
        shapes.forEach(sh => {
          if (sh.gone) return;
          const p = shapePts(sh);
          for (let i = 0; i < p.length; i += 14) out.push({ x: p[i], y: p[i + 1], b: 0.7, ck: "pale" });
        });
        return out;
      };
      return o;
    }

    function R_piece() {
      const o = { name: "the missing piece", chapter: "trust", how: "Drag the fragment that fits into the gap in the ring.", goal: "Only one matches the curve and the length exactly.", ideal: 1, need: 0.9, sustain: 0.1, tapOnly: true, metrics: ["observation", "restraint", "intuition"] };
      let rings = [], gap = null, frags = [], grab = -1, wrongs = 0, found = false, R2 = 0;
      o.init = () => {
        const R1 = 0.15 * S;
        R2 = 0.23 * S;
        const R3 = 0.31 * S;
        rings = [];
        const gapA = (6 * Math.PI) / 180;
        const mk = (R, spans, rot) => {
          const total = spans.reduce((a, b) => a + b, 0);
          const scale = (TAU - gapA * spans.length) / total;
          let a = rot;
          const arcs = [];
          for (const s of spans) {
            const sp = s * scale;
            arcs.push({ R, a0: a, a1: a + sp });
            a += sp + gapA;
          }
          return arcs;
        };
        rings.push(mk(R1, [3, 2, 4, 2], rand() * TAU));
        rings.push(mk(R3, [2, 3, 1, 2, 3, 2, 1], rand() * TAU));
        const mid = mk(R2, [3, 2, 3, 2.5, 2.5], 0);
        const miss = Math.floor(rand() * mid.length);
        const mc = (mid[miss].a0 + mid[miss].a1) / 2;
        const rot = -Math.PI / 2 + rr(-0.6, 0.6) - mc;
        for (const a of mid) {
          a.a0 += rot;
          a.a1 += rot;
        }
        const ms = mid.splice(miss, 1)[0];
        rings.push(mid);
        gap = { ang: (ms.a0 + ms.a1) / 2, span: ms.a1 - ms.a0 };
        gap.x = cx + Math.cos(gap.ang) * R2;
        gap.y = cy + Math.sin(gap.ang) * R2;
        const specs = shuffle([
          { rho: R2, sig: gap.span, ok: true },
          { rho: R2 * 0.8, sig: gap.span, ok: false },
          { rho: R2, sig: gap.span * 0.76, ok: false },
          { rho: R2 * 1.24, sig: gap.span * 1.12, ok: false }
        ]);
        const fy1 = Math.min(H - 110, cy + 0.44 * S), fy2 = Math.min(H - 50, cy + 0.62 * S);
        const homes = [
          { x: cx - 0.26 * S, y: fy1 }, { x: cx + 0.26 * S, y: fy1 },
          { x: cx - 0.26 * S, y: fy2 }, { x: cx + 0.26 * S, y: fy2 }
        ];
        frags = specs.map((s, i) => ({ ...s, hx: homes[i].x, hy: homes[i].y, x: homes[i].x, y: homes[i].y, vx: 0, vy: 0, ang: -Math.PI / 2, seat: null, seatT: 0, ph: rand() * TAU }));
        wrongs = 0;
        found = false;
        grab = -1;
      };
      o.down = p => {
        let best = -1, bd = 1e9;
        frags.forEach((f, i) => {
          if (f.seat === "good") return;
          const d = Math.hypot(f.x - p.x, f.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0 && bd < Math.max(60, 0.17 * S)) {
          grab = best;
          frags[best].seat = null;
          tone(noteHz(4), 0.04, 1.3, 0.6);
          haptic("light");
        }
      };
      o.move = () => {};
      o.up = () => {
        if (grab < 0) return;
        const f = frags[grab];
        grab = -1;
        if (Math.hypot(f.x - gap.x, f.y - gap.y) < Math.max(40, 0.12 * S)) {
          f.seat = f.ok ? "good" : "bad";
          f.seatT = 0;
          if (f.ok) found = true;
          else {
            wrongs++;
            tone(noteHz(0) * 1.06, 0.05, 1.6, 0.9);
            tone(noteHz(0), 0.05, 1.6, 0.9);
          }
        }
      };
      o.update = dt => {
        frags.forEach((f, i) => {
          let tx = f.hx + Math.sin(E.t * 0.6 + f.ph) * 6, ty = f.hy + Math.cos(E.t * 0.5 + f.ph) * 5, ta = -Math.PI / 2 + Math.sin(E.t * 0.4 + f.ph) * 0.12;
          if (i === grab) {
            tx = P.x;
            ty = P.y - 30;
            const near = Math.hypot(f.x - gap.x, f.y - gap.y) < 0.22 * S;
            ta = near ? gap.ang : -Math.PI / 2 + clamp(f.vx * 0.0015, -0.6, 0.6);
          } else if (f.seat) {
            f.seatT += dt;
            tx = gap.x;
            ty = gap.y;
            ta = gap.ang;
            if (f.seat === "bad") {
              tx += noise1(E.t * 9) * 5;
              ty += noise1(E.t * 9 + 7) * 5;
              ta += noise1(E.t * 7 + 3) * 0.08;
              if (f.seatT > 1.3) {
                f.seat = null;
                f.vx = (f.hx - f.x) * 3;
                f.vy = -200;
              }
            }
          }
          const k = i === grab ? 140 : 40, dmp = i === grab ? 16 : 7;
          f.vx += ((tx - f.x) * k - f.vx * dmp) * dt;
          f.vy += ((ty - f.y) * k - f.vy * dmp) * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.ang += angDiff(ta, f.ang) * Math.min(1, dt * 8);
        });
      };
      o.evaluate = () => {
        const bad = frags.some(f => f.seat === "bad");
        const good = frags.some(f => f.seat === "good" && f.seatT > 0.35);
        return { r: good ? 1 : 0, c: bad ? 0.55 : 0, verdict: good ? "resolve" : null };
      };
      o.dbg = () => {
        const f = frags.find(q => q.ok);
        return { x: f.x, y: f.y, gx: gap.x, gy: gap.y };
      };
      function arcStroke(x, y, R, a0, a1, c, w, a) {
        g.beginPath();
        g.arc(x, y, R, a0, a1);
        glowStroke(c, w, a);
      }
      o.draw = () => {
        const breath = 1 + 0.01 * Math.sin(E.t * 1.2) * (1 + E.res * 2);
        rings.forEach((ring, k) => {
          for (const a of ring) {
            const jx = E.chaos * noise1(E.t * 8 + a.a0 * 3) * 4;
            arcStroke(cx + jx, cy, a.R * breath, a.a0, a.a1, k === 2 ? COL.warm : COL.pale, 1.4, 0.45 + 0.3 * E.res);
          }
        });
        g.beginPath();
        g.arc(cx, cy, R2, gap.ang - gap.span / 2, gap.ang + gap.span / 2);
        g.globalAlpha = 1;
        g.strokeStyle = rgba(COL.cool, 0.05 * E.alpha);
        g.lineWidth = 1;
        g.stroke();
        for (const f of frags) {
          const ccx = f.x - Math.cos(f.ang) * f.rho, ccy = f.y - Math.sin(f.ang) * f.rho;
          arcStroke(ccx, ccy, f.rho, f.ang - f.sig / 2, f.ang + f.sig / 2, f.seat === "good" ? COL.warm : COL.cool, 1.4, 0.7);
        }
        dot(cx, cy, 0.5 * S, 0.03 + 0.12 * E.res, "warm");
      };
      o.points = () => {
        const out = [];
        rings.forEach(ring => ring.forEach(a => {
          for (let t = 0; t <= 1; t += 0.25) {
            const th = lerp(a.a0, a.a1, t);
            out.push({ x: cx + Math.cos(th) * a.R, y: cy + Math.sin(th) * a.R, b: 0.7, ck: "pale" });
          }
        }));
        for (const f of frags) out.push({ x: f.x, y: f.y, b: 1, ck: "cool" });
        return out;
      };
      return o;
    }

    function R_moment() {
      const o = { name: "stop at the right moment", chapter: "trust", how: "Press and hold. The form grows while you hold.", goal: "Let go at its most beautiful moment, when the spirals are sharpest.", ideal: 1, need: 0.62, sustain: 0.1, tapOnly: true, metrics: ["timing", "restraint", "intuition"] };
      let tau = 0, tauStar = 3, holding = false, state = "grow", verdict = null, frozenR = 0, retreat = 0;
      const GA = Math.PI * (3 - Math.sqrt(5));
      o.init = () => {
        tau = 0;
        tauStar = rr(2.5, 3.6);
        holding = false;
        state = "grow";
        verdict = null;
      };
      o.down = () => {
        if (state !== "grow") return;
        holding = true;
        tone(noteHz(0), 0.04, 2, 0.4);
      };
      o.move = () => {};
      o.up = () => {
        if (!holding) return;
        holding = false;
        if (tau < 0.2) return;
        frozenR = bell(tau, tauStar, 0.42);
        if (frozenR >= o.need) {
          state = "frozen";
          verdict = "resolve";
        } else if (tau > tauStar) {
          verdict = "collapse";
        } else {
          state = "retreat";
          retreat = tau;
          grain(700, 0.05);
        }
      };
      o.dbg = () => ({ tauStar, tau });
      o.gauge = () => null;
      const count = t => Math.floor(Math.min(1, t / tauStar) * 420 + Math.max(0, t - tauStar) * 260);
      o.update = dt => {
        if (holding) {
          tau += dt;
          if (Math.floor((tau - dt) * 4) !== Math.floor(tau * 4)) grain(1200 + tau * 500, 0.025);
          if (tau > tauStar + 1.8) {
            holding = false;
            verdict = "collapse";
          }
        }
        if (state === "retreat") {
          tau = Math.max(0, tau - dt * retreat * 0.9);
          if (tau <= 0) state = "grow";
        }
      };
      o.evaluate = () => {
        if (verdict) return { r: verdict === "resolve" ? frozenR : 0, c: verdict === "collapse" ? 1 : 0, verdict };
        return { r: holding ? bell(tau, tauStar, 0.42) * 0.8 : 0, c: holding ? sstep(tauStar + 0.6, tauStar + 1.8, tau) * 0.9 : 0 };
      };
      function form() {
        const n = count(tau);
        const dev = tau - tauStar;
        const ang = GA + dev * Math.abs(dev) * 0.012;
        const sc = (0.36 * S) / Math.sqrt(420);
        const pts = [];
        for (let k = 1; k <= n; k++) {
          const rad = sc * Math.sqrt(k) * (1 + Math.max(0, dev) * 0.08);
          const th = k * ang + E.t * 0.03;
          const jit = Math.max(0, dev) * 3 * noise1(k * 1.7 + E.t * 2);
          pts.push(cx + Math.cos(th) * (rad + jit), cy + Math.sin(th) * (rad + jit), k / Math.max(1, n));
        }
        return pts;
      }
      o.draw = () => {
        const pts = form();
        const q = bell(tau, tauStar, 0.5);
        for (let i = 0; i < pts.length; i += 3) {
          const f = pts[i + 2];
          const size = 3.5 + (1 - f) * 4 + q * 2;
          dot(pts[i], pts[i + 1], size * 2.2, 0.35 + 0.45 * (1 - f) + 0.2 * q, f < 0.45 ? "warm" : f < 0.8 ? "pale" : "ice");
        }
        dot(cx, cy, 30 + tau * 20, 0.2 + 0.3 * q, "warm");
        if (!holding && tau < 0.05) dot(cx, cy, 10, 0.4 + 0.3 * Math.sin(E.t * 2), "warm");
      };
      o.points = () => {
        const p = form(), out = [];
        const step = Math.max(3, Math.floor(p.length / 3 / 150) * 3);
        for (let i = 0; i < p.length; i += step) out.push({ x: p[i], y: p[i + 1], b: 0.8, ck: "warm" });
        if (!out.length) out.push({ x: cx, y: cy, b: 1, ck: "warm" });
        return out;
      };
      return o;
    }

    function R_grid() {
      const o = { name: "ruin the grid", chapter: "imperfect", how: "Drag across the grid to bend it.", goal: "Several strokes make it organic. Too many tear it apart.", ideal: 3, need: 0.78, sustain: 1.5, metrics: ["imperfection", "restraint", "balance"] };
      let cols = 0, rows = 0, sp = 0, ox = 0, oy = 0, dx, dy, a = 0, cover = 0, lastX = 0, lastY = 0;
      o.init = () => {
        cols = 12;
        sp = (W * 0.84) / (cols - 1);
        rows = Math.max(8, Math.floor((H * 0.7) / sp) + 1);
        ox = cx - ((cols - 1) * sp) / 2;
        oy = cy - ((rows - 1) * sp) / 2;
        dx = new Float32Array(cols * rows);
        dy = new Float32Array(cols * rows);
      };
      o.down = p => {
        lastX = p.x;
        lastY = p.y;
      };
      o.move = p => {
        const mx = p.x - lastX, my = p.y - lastY;
        lastX = p.x;
        lastY = p.y;
        const Rb = 0.2 * S;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const x = ox + i * sp + dx[k] * 0.3, y = oy + j * sp + dy[k] * 0.3;
          const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
          const w = Math.exp(-d2 / (Rb * Rb));
          if (w < 0.01) continue;
          dx[k] += mx * w * 0.16 - my * w * 0.05;
          dy[k] += my * w * 0.16 + mx * w * 0.05;
        }
        grain(900 + Math.hypot(mx, my) * 40, 0.02);
      };
      o.up = () => {};
      o.update = dt => {
        let s = 0, cv = 0;
        const n = cols * rows;
        for (let k = 0; k < n; k++) {
          dx[k] *= Math.exp(-dt * 0.03);
          dy[k] *= Math.exp(-dt * 0.03);
          const m = Math.hypot(dx[k], dy[k]) / sp;
          s += m * m;
          if (m > 0.25) cv++;
        }
        a = Math.sqrt(s / n);
        cover = cv / n;
      };
      o.evaluate = () => ({ r: bell(a, 0.72, 0.28) * sstep(0.22, 0.45, cover), c: sstep(1.55, 2.3, a) });
      o.dbg = () => ({ a, cover });
      o.gauge = () => (a > 0.4 && cover < 0.3 ? -0.4 : gz(a, 0.72, 2.3));
      function pos(i, j) {
        const k = j * cols + i;
        const m = Math.hypot(dx[k], dy[k]) / sp;
        const live = Math.min(1, m) * 0.18 * sp;
        const nx = noise2(i * 0.35 + E.t * 0.25, j * 0.35) * live;
        const ny = noise2(i * 0.35 + 50, j * 0.35 + E.t * 0.25) * live;
        const ch = E.chaos * 12;
        return [ox + i * sp + dx[k] + nx + noise2(i, j + E.t * 5) * ch, oy + j * sp + dy[k] + ny + noise2(i + 9, j + E.t * 5) * ch, m];
      }
      o.draw = () => {
        const P2 = [];
        for (let j = 0; j < rows; j++) {
          const row = [];
          for (let i = 0; i < cols; i++) row.push(pos(i, j));
          P2.push(row);
        }
        g.globalAlpha = 1;
        g.lineWidth = 1;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const p = P2[j][i], q = P2[j][i + 1];
            const m = Math.min(1.5, (p[2] + q[2]) / 2);
            g.beginPath();
            g.moveTo(p[0], p[1]);
            g.lineTo(q[0], q[1]);
            g.strokeStyle = rgba(m > 0.4 ? COL.warm : COL.cool, (0.1 + m * 0.35) * E.alpha);
            g.stroke();
          }
        }
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows - 1; j++) {
            const p = P2[j][i], q = P2[j + 1][i];
            const m = Math.min(1.5, (p[2] + q[2]) / 2);
            g.beginPath();
            g.moveTo(p[0], p[1]);
            g.lineTo(q[0], q[1]);
            g.strokeStyle = rgba(COL.cool, (0.05 + m * 0.12) * E.alpha);
            g.stroke();
          }
        }
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = P2[j][i];
          dot(p[0], p[1], 5 + Math.min(1, p[2]) * 5, 0.3 + Math.min(1, p[2]) * 0.4, p[2] > 0.4 ? "warm" : "cool");
        }
      };
      o.points = () => {
        const out = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = pos(i, j);
          out.push({ x: p[0], y: p[1], b: 0.6, ck: "cool" });
        }
        return out;
      };
      return o;
    }

    function R_worse() {
      const o = { name: "make it worse", chapter: "imperfect", how: "Drag across the curve to damage it.", goal: "Damage it until it becomes expressive, then stop.", ideal: 3, need: 0.8, sustain: 1.5, metrics: ["damage", "restraint", "risk"] };
      let bruises = [], D = 0, cur = null, travel = 0, lx = 0, ly = 0;
      const NP = 360;
      o.init = () => {
        bruises = [];
        D = 0;
      };
      o.down = p => {
        lx = p.x;
        ly = p.y;
        cur = { x: p.x, y: p.y, s: 0.02 };
        bruises.push(cur);
        travel = 0;
        grain(3000, 0.04);
      };
      o.move = p => {
        if (!cur) return;
        const d = Math.hypot(p.x - lx, p.y - ly);
        lx = p.x;
        ly = p.y;
        cur.s += (d / S) * 0.5;
        travel += d;
        if (travel > 0.12 * S) {
          cur = { x: p.x, y: p.y, s: 0.01 };
          bruises.push(cur);
          travel = 0;
        }
        grain(1500 + d * 60, 0.025);
      };
      o.up = () => {
        cur = null;
      };
      o.update = dt => {
        if (!cur) for (const b of bruises) b.s *= Math.exp(-dt * 0.016);
        bruises = bruises.filter(b => b.s > 0.001 || b === cur);
        D = 0;
        for (const b of bruises) D += b.s;
      };
      o.evaluate = () => ({ r: bell(D, 0.56, 0.13), c: sstep(0.95, 1.4, D) });
      o.dbg = () => ({ D });
      o.gauge = () => gz(D, 0.56, 1.4);
      function curve(phase, shift) {
        const pts = [];
        const Rr = 0.34 * S;
        const worse = bell(D, 0.2, 0.14);
        const chaos = sstep(0.8, 1.35, D);
        const detune = D * 0.05;
        for (let i = 0; i <= NP; i++) {
          const s = (i / NP) * TAU;
          let x = cx + Rr * Math.sin((3 + detune) * s + E.t * 0.15 + phase);
          let y = cy + Rr * 1.15 * Math.sin((2 - detune * 0.5) * s + shift);
          for (const b of bruises) {
            const ddx = b.x - x, ddy = b.y - y, dd = Math.hypot(ddx, ddy) + 1;
            const f = b.s * 0.9 * S * Math.exp(-dd / (0.14 * S)) / dd;
            x += ddx * f * 0.5;
            y += ddy * f * 0.5;
          }
          const tw = worse * 5 + chaos * 0.09 * S;
          x += noise2(i * 0.08, E.t * (0.5 + chaos * 4)) * tw;
          y += noise2(i * 0.08 + 30, E.t * (0.5 + chaos * 4)) * tw;
          pts.push(x, y);
        }
        return pts;
      }
      o.draw = () => {
        const worse = bell(D, 0.2, 0.14), expr = bell(D, 0.56, 0.16), chaos = sstep(0.8, 1.35, D);
        const base = curve(0, 0);
        const bright = 0.5 - 0.28 * worse + 0.3 * expr;
        if (chaos > 0.2) {
          for (let i = 0; i < base.length; i += 8) dot(base[i], base[i + 1], 6, 0.35 * chaos, "pale");
        }
        glowPoly(base, false, worse > expr ? COL.pale : COL.warm, 0.7 + expr * 1.3, bright * (1 - chaos * 0.6));
        if (expr > 0.05) {
          thinPoly(curve(0.05 * expr, 0.04), false, COL.rose, 1.2, 0.35 * expr);
          thinPoly(curve(-0.06 * expr, -0.03), false, COL.ice, 1.2, 0.35 * expr);
          thinPoly(curve(0.12 * expr, 0.1), false, COL.amber, 0.8, 0.2 * expr);
        }
        for (const b of bruises) dot(b.x, b.y, 20 + b.s * 200, 0.08 + 0.2 * Math.min(1, b.s * 4), "amber");
      };
      o.points = () => {
        const p = curve(0, 0), out = [];
        for (let i = 0; i < p.length; i += 6) out.push({ x: p[i], y: p[i + 1], b: 0.7, ck: "warm" });
        return out;
      };
      return o;
    }

    function R_taste() {
      const o = { name: "taste", chapter: "taste", how: "Use everything you have learned.", goal: "Nudge a light, move the orange orb, remove the flickering light, touch the stream. When it all feels right, let go.", ideal: 4, need: 0.72, sustain: 2.2, metrics: ["imperfection", "restraint", "taste"] };
      let ring = [], R = 0, odd = -1, oddGone = false, orb = null, grabRing = -1, grabOrb = false, parts = [], waves = [], flowI = 0, flowTouch = false, flowScore = 0, bandY = 0;
      let sRing = 0, sOrb = 0, sFlow = 0, sOdd = 0, coh = 0, spots = [];
      o.init = () => {
        R = 0.2 * S;
        const ringY = cy - 0.1 * S;
        ring = [];
        const N = 20;
        for (let i = 0; i < N; i++) {
          const th = (i / N) * TAU - Math.PI / 2;
          const bx = cx + Math.cos(th) * R, by = ringY + Math.sin(th) * R;
          ring.push({ bx, by, ox: 0, oy: 0, x: bx, y: by, vx: 0, vy: 0, alive: true });
        }
        odd = 3 + Math.floor(rand() * 14);
        oddGone = false;
        orb = { x: cx + 0.05 * S, y: ringY + 0.03 * S, vx: 0, vy: 0 };
        spots = [
          { x: cx - Math.min(W * 0.2, 0.34 * S), y: ringY - 0.3 * S }, { x: cx + Math.min(W * 0.2, 0.34 * S), y: ringY - 0.3 * S },
          { x: cx - Math.min(W * 0.2, 0.34 * S), y: ringY + 0.3 * S }, { x: cx + Math.min(W * 0.2, 0.34 * S), y: ringY + 0.3 * S }
        ];
        bandY = Math.min(H - 90, cy + 0.42 * S);
        parts = [];
        for (let l = 0; l < 5; l++) for (let i = 0; i < 20; i++) parts.push({ l, x: rand() * W, sp: rr(0.9, 1.1), oy: 0, vy: 0 });
        waves = [];
      };
      const laneY = l => bandY - 0.05 * S + l * 0.025 * S;
      o.down = p => {
        if (Math.hypot(p.x - orb.x, p.y - orb.y) < Math.max(44, 0.12 * S)) {
          grabOrb = true;
          tone(noteHz(7), 0.04, 1.6, 0.6);
          return;
        }
        let best = -1, bd = 1e9;
        ring.forEach((n, i) => {
          if (!n.alive) return;
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (bd < Math.max(30, 0.08 * S)) {
          grabRing = best;
          tone(noteHz(best % 10), 0.04, 1.4, 0.5);
          return;
        }
        if (Math.abs(p.y - bandY) < 0.12 * S) {
          flowTouch = true;
          flowI = 0;
        }
      };
      o.move = p => {
        if (grabRing >= 0) {
          const n = ring[grabRing];
          n.ox = clamp(p.x - n.bx, -0.4 * S, 0.4 * S);
          n.oy = clamp(p.y - n.by, -0.4 * S, 0.4 * S);
        }
      };
      o.up = p => {
        if (grabRing >= 0) {
          const n = ring[grabRing];
          if (grabRing === odd && p.dist < 14) {
            n.alive = false;
            oddGone = true;
            n.ox = n.oy = 0;
            tone(noteHz(9), 0.05, 3, 0.8);
          } else if (p.dist < 14) {
            n.ox = n.oy = 0;
          }
        }
        if (flowTouch) {
          flowTouch = false;
          if (flowI > 0.04) {
            waves.push({ x0: P.x, t0: E.t, A: 0.06 * S * (flowI / 0.5), turb: sstep(0.9, 1.5, flowI) });
            flowScore = bell(flowI, 0.5, 0.25);
          }
        }
        grabRing = -1;
        grabOrb = false;
      };
      o.update = dt => {
        const ringY = cy - 0.1 * S;
        if (grabOrb) {
          orb.vx += ((P.x - orb.x) * 90 - orb.vx * 12) * dt;
          orb.vy += ((P.y - orb.y) * 90 - orb.vy * 12) * dt;
        } else {
          orb.vx *= Math.exp(-dt * 6);
          orb.vy *= Math.exp(-dt * 6);
        }
        orb.x = clamp(orb.x + orb.vx * dt, 10, W - 10);
        orb.y = clamp(orb.y + orb.vy * dt, 10, H - 10);
        let sum = 0;
        for (const n of ring) sum += n.ox * n.ox + n.oy * n.oy;
        const a = Math.sqrt(sum) / S;
        sRing = bell(a, 0.07, 0.035);
        let dmin = 1e9;
        for (const s of spots) dmin = Math.min(dmin, Math.hypot(orb.x - s.x, orb.y - s.y));
        sOrb = bell(dmin / S, 0, 0.09);
        sOdd = oddGone ? 1 : 0;
        sFlow = flowScore;
        const scores = [sRing, sOrb, sFlow, sOdd].sort((x, y) => y - x);
        coh = (scores[0] + scores[1] + scores[2]) / 3 * 0.85 + scores[3] * 0.15;
        const still = 1 - E.sync;
        const N = ring.length;
        for (let i = 0; i < N; i++) {
          const n = ring[i];
          let tx = n.ox, ty = n.oy;
          for (let j = 0; j < N; j++) {
            if (j === i) continue;
            const rd = Math.min(Math.abs(i - j), N - Math.abs(i - j));
            const k = Math.exp(-(rd * rd) / 4) * 0.3;
            tx += ring[j].ox * k;
            ty += ring[j].oy * k;
          }
          const breathe = 1 + 0.02 * coh * Math.sin(E.t * 1.4) * still;
          tx += cx + (n.bx - cx) * breathe + noise2(i, E.t * 3) * E.chaos * 12;
          ty += ringY + (n.by - ringY) * breathe;
          if (i === grabRing) {
            n.x = n.bx + n.ox;
            n.y = n.by + n.oy;
            continue;
          }
          n.vx += ((tx - n.x) * 60 - n.vx * 9) * dt;
          n.vy += ((ty - n.y) * 60 - n.vy * 9) * dt;
          n.x += n.vx * dt;
          n.y += n.vy * dt;
        }
        const v = (0.12 * W + 30) * still;
        if (flowTouch) {
          const sp = Math.min(3000, Math.hypot(P.vx, P.vy));
          flowI += dt * (1 - clamp(Math.abs(P.y - bandY) / (0.12 * S), 0, 1)) * (1 + sp * 0.001);
        }
        for (const p of parts) {
          p.x += v * p.sp * dt;
          if (p.x > W + 10) p.x -= W + 20;
          let target = 0;
          if (flowTouch) {
            const d = Math.hypot(p.x - P.x, laneY(p.l) - P.y);
            if (d < 0.12 * S) target = (laneY(p.l) >= P.y ? 1 : -1) * (0.12 * S - d);
          }
          p.vy += ((target - p.oy) * 60 - p.vy * 9) * dt;
          p.oy += p.vy * dt;
        }
        waves = waves.filter(w => E.t - w.t0 < 5);
      };
      function waveOff(x, l) {
        let y = 0;
        for (const w of waves) {
          const age = E.t - w.t0;
          const s = x - (w.x0 + 0.4 * W * age);
          const env = Math.exp(-(s * s) / Math.pow(0.22 * W, 2)) * Math.exp(-age / 3.5);
          y += w.A * env * Math.sin((s / (0.2 * W)) * TAU + l * 0.3) + w.turb * env * noise2(x * 0.02, l + E.t * 3) * 0.1 * S;
        }
        return y;
      }
      o.evaluate = () => ({ r: coh, c: 0, verdict: null });
      o.dbg = () => ({ odd: { x: ring[odd].x, y: ring[odd].y }, n0: { x: ring[0].x, y: ring[0].y }, orb: { x: orb.x, y: orb.y }, spot: spots[0], bandY, parts: [sRing, sOrb, sFlow, sOdd] });
      o.draw = () => {
        const pts = [];
        for (const n of ring) if (n.alive) pts.push(n.x, n.y);
        glowPoly(pts, true, COL.pale, 0.6, 0.05 + 0.15 * E.res);
        ring.forEach((n, i) => {
          if (!n.alive) return;
          let b = 0.55 + 0.15 * E.res;
          if (i === odd) b *= 0.65 + 0.35 * Math.sin(E.t * 7.3) * (1 - E.sync);
          dot(n.x, n.y, 8 + 2 * E.res, b * 0.8, "warm");
        });
        for (const p of parts) {
          const wo = waveOff(p.x, p.l);
          dot(p.x, laneY(p.l) + p.oy + wo, 4.5, 0.12 + Math.min(0.4, Math.abs(wo) / (0.07 * S)) + 0.06 * E.res, "cool");
        }
        const br = 1 + 0.1 * E.res * Math.sin(E.t * 1.5) * (1 - E.sync);
        dot(orb.x, orb.y, 90 * br, 0.08 + 0.15 * sOrb, "amber");
        dot(orb.x, orb.y, 28 * br, 0.85, "amber");
        dot(orb.x, orb.y, 8, 0.9, "warm");
        dot(cx, cy - 0.1 * S, 0.7 * S, 0.02 + 0.05 * E.res, "warm");
      };
      o.points = () => {
        const out = [];
        for (const n of ring) if (n.alive) out.push({ x: n.x, y: n.y, b: 1, ck: "warm" });
        parts.forEach((p, i) => {
          if (i % 2 === 0) out.push({ x: p.x, y: laneY(p.l) + p.oy + waveOff(p.x, p.l), b: 0.5, ck: "cool" });
        });
        out.push({ x: orb.x, y: orb.y, b: 1, ck: "amber" });
        return out;
      };
      o.final = true;
      return o;
    }

    const ROOMS = [R_symmetry, R_drops, R_circle, R_center, R_colour, R_balance, R_flow, R_rhythm, R_remove, R_perfect, R_piece, R_moment, R_grid, R_worse, R_taste];
    const COUNT = ROOMS.length;

    // -------------------------------------------------------------------- HUD
    const css = document.createElement("style");
    css.textContent =
      ".pi-hud{position:absolute;inset:0;pointer-events:none}" +
      ".pi-res,.pi-big,.pi-word,.pi-title{text-shadow:0 0 14px #000,0 0 4px #000}" +
      ".pi-tl,.pi-tr{position:absolute;top:0;opacity:0.55;transition:opacity 1.2s}" +
      ".pi-word{position:absolute;left:0;right:0;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;" +
      "text-transform:none;letter-spacing:0.02em;font-size:19px;line-height:1.3;color:rgba(244,238,228,0.92);transition:opacity 1.2s ease;opacity:0;padding:0 26px}" +
      ".pi-goal{display:block;margin:10px auto 0;max-width:300px;font-family:'Space Mono',ui-monospace,monospace;font-style:normal;font-size:10.5px;line-height:1.55;" +
      "letter-spacing:0.04em;text-transform:none;color:rgba(236,232,224,0.66)}" +
      ".pi-gauge{position:absolute;left:50%;width:210px;margin-left:-105px;height:34px;opacity:0;transition:opacity 0.8s ease}" +
      ".pi-gauge .ln{position:absolute;left:0;right:0;top:8px;height:1px;background:rgba(236,232,224,0.22)}" +
      ".pi-gauge .zn{position:absolute;left:42%;width:16%;top:5px;height:7px;border-left:1px solid rgba(255,214,170,0.55);border-right:1px solid rgba(255,214,170,0.55)}" +
      ".pi-gauge .mk{position:absolute;top:4px;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:#dfe6ff;box-shadow:0 0 10px rgba(200,215,255,0.9)}" +
      ".pi-gauge .lb{position:absolute;top:18px;font-size:8.5px;letter-spacing:0.18em;opacity:0.6}" +
      ".pi-status{position:absolute;left:0;right:0;text-align:center;font-size:10px;letter-spacing:0.2em;opacity:0;transition:opacity 0.6s ease;color:rgba(255,228,196,0.85)}" +
      ".pi-skip{position:absolute;left:12px;opacity:0;transition:opacity 1.5s ease}" +
      ".pi-name{display:block;font-family:'Space Mono',ui-monospace,monospace;font-style:normal;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;opacity:0.5;margin-bottom:10px}" +
      ".pi-res{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;opacity:0;transition:opacity 1.4s ease;pointer-events:none}" +
      ".pi-row{display:flex;justify-content:space-between;width:190px;line-height:2.1;opacity:0;transition:opacity 1s ease}" +
      ".pi-row b{font-weight:400;color:rgba(255,238,214,0.9)}" +
      ".pi-row.t{margin-top:12px;border-top:1px solid rgba(236,232,224,0.12);padding-top:8px}" +
      ".pi-btns{display:flex;gap:44px;margin-top:26px;opacity:0;transition:opacity 1s ease}" +
      ".pi-btn{appearance:none;-webkit-appearance:none;background:none;border:0;color:rgba(236,232,224,0.72);font:inherit;letter-spacing:inherit;" +
      "text-transform:inherit;padding:14px 6px;cursor:pointer;pointer-events:auto}" +
      ".pi-btn:active{color:#fff}" +
      ".pi-big{position:absolute;left:0;right:0;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;" +
      "font-size:40px;letter-spacing:0.08em;text-transform:none;color:rgba(255,244,230,0.92);opacity:0;transition:opacity 2s ease}" +
      ".pi-title{position:absolute;left:0;right:0;text-align:center;opacity:0;transition:opacity 2s ease}" +
      ".pi-title .h{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:26px;letter-spacing:0.05em;text-transform:none;color:rgba(248,240,228,0.9)}" +
      ".pi-title .s{margin-top:14px}" +
      ".pi-title .p{margin:16px auto 0;max-width:290px;font-size:10.5px;line-height:1.7;letter-spacing:0.05em;text-transform:none;opacity:0.72}";
    hud.appendChild(css);
    const el = (cls, parent) => {
      const d = document.createElement("div");
      d.className = cls;
      (parent || hud).appendChild(d);
      return d;
    };
    const hudTL = el("pi-tl");
    const hudTR = el("pi-tr");
    const hudWord = el("pi-word");
    const hudRes = el("pi-res");
    const hudBig = el("pi-big");
    const hudTitle = el("pi-title");
    const hudGauge = el("pi-gauge");
    hudGauge.innerHTML = '<div class="ln"></div><div class="zn"></div><div class="mk"></div>' +
      '<span class="lb" style="left:0">too perfect</span><span class="lb" style="right:0">too much</span>';
    const gaugeMk = hudGauge.querySelector(".mk");
    const hudStatus = el("pi-status");
    const hudSkip = el("pi-skip");
    const skipBtn = document.createElement("button");
    skipBtn.className = "pi-btn";
    skipBtn.textContent = "skip room";
    hudSkip.appendChild(skipBtn);
    function layoutHud() {
      const top = (ctx.safeArea && ctx.safeArea.top) || 0;
      const bot = (ctx.safeArea && ctx.safeArea.bottom) || 0;
      hudTL.style.cssText = "top:" + (top + 18) + "px;left:20px";
      hudTR.style.cssText = "top:" + (top + 18) + "px;right:20px;text-align:right";
      hudWord.style.top = Math.max(top + 64, H * 0.12) + "px";
      hudRes.style.bottom = Math.max(bot + 40, H * 0.08) + "px";
      hudBig.style.top = cy + 0.14 * S + "px";
      hudTitle.style.top = H * 0.6 + "px";
      hudSkip.style.bottom = Math.max(bot + 10, 14) + "px";
    }
    layoutHud();

    // ------------------------------------------------------------------ state
    let state = "title";
    let inTitle = true;
    let roomIdx = 0;
    let room = null;
    let stats = null;
    let sustain = 0;
    let st = 0; // time in current state
    let motes = [];
    let debris = [];
    let trans = null;
    let tastes = [];
    let resumeFrom = 0;
    let finalePts = [];
    let finaleStep = 0;
    let wordTimer = 0;
    let wordShown = false;
    let lastR = 0;
    let lastRTone = 0;

    const newStats = () => ({ actions: 0, collapses: 0, maxC: 0, peakR: 0, t: 0, finalR: 0 });

    function samplePts(pts, n) {
      const out = [];
      if (!pts.length) pts = [{ x: cx, y: cy, b: 1, ck: "warm" }];
      if (pts.length >= n) {
        const step = pts.length / n;
        for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * step)]);
      } else {
        for (let i = 0; i < n; i++) {
          const p = pts[i % pts.length];
          out.push({ x: p.x + (i >= pts.length ? rr(-3, 3) : 0), y: p.y + (i >= pts.length ? rr(-3, 3) : 0), b: p.b, ck: p.ck });
        }
      }
      return out;
    }
    function sortByAngle(arr) {
      return arr.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    }

    function showWord(r) {
      hudWord.innerHTML = "";
      const n = document.createElement("span");
      n.className = "pi-name";
      n.textContent = r.name;
      hudWord.appendChild(n);
      hudWord.appendChild(document.createTextNode(r.how));
      const gl = document.createElement("span");
      gl.className = "pi-goal";
      gl.textContent = r.goal;
      hudWord.appendChild(gl);
      hudWord.style.opacity = "1";
      // gauge and status sit under the instructions
      ctx.timeout(() => {
        const bottom = hudWord.offsetTop + hudWord.offsetHeight;
        hudGauge.style.top = bottom + 14 + "px";
        hudStatus.style.top = bottom + 50 + "px";
      }, 30);
      wordShown = true;
      wordTimer = 0;
    }
    function setHudRoom(i) {
      const pad = n => (n < 10 ? "0" + n : "" + n);
      hudTL.textContent = pad(i + 1) + " / " + COUNT;
      hudTR.textContent = ROOMS_META[i].chapter;
      hudTL.style.opacity = "0.55";
      hudTR.style.opacity = "0.45";
    }
    const ROOMS_META = ROOMS.map(f => {
      const r = f();
      return { name: r.name, chapter: chapterLabel(r.chapter) };
    });
    function chapterLabel(c) {
      const order = ["disturb", "restrain", "balance", "interrupt", "observe", "trust", "imperfect", "taste"];
      const i = order.indexOf(c);
      return (i >= 0 ? "0" + (i + 1) + " \u2014 " : "") + c;
    }

    let guideShown = false, lastStatus = "", gaugeVal = -1;
    function statusText(ev) {
      if (room.cue) {
        const c = room.cue();
        if (c !== null) return c;
      }
      if (room.tapOnly) {
        if (ev.c > 0.2) return "not that one";
        return "";
      }
      if (sustain > 0.05) return room.holdOk ? "hold it there... it is settling" : "yes. let it settle";
      if (ev.r >= room.need && P.down && !room.holdOk) return "that's it. let go";
      if (ev.c > 0.35) return "too much. it is falling apart";
      if (room.gauge && room.gauge() === null) return P.down ? "keep holding..." : "";
      if (ev.r > 0.45) return "closer";
      if (!stats.actions) return "";
      return gaugeVal > 0.35 ? "too much" : gaugeVal < -0.35 ? "still too perfect" : "getting there";
    }
    function updateGuide(ev) {
      let gv = room.gauge ? room.gauge() : room.tapOnly ? null : -(1 - ev.r) + ev.c;
      const showG = gv !== null && gv !== undefined;
      if (showG) {
        gaugeVal += (clamp(gv, -1, 1) - gaugeVal) * 0.25;
        gaugeMk.style.left = (50 + gaugeVal * 48).toFixed(1) + "%";
        const near = Math.abs(gaugeVal) < 0.12;
        gaugeMk.style.background = near ? "#ffd9a8" : gaugeVal > 0.4 ? "#ff9d8a" : "#dfe6ff";
      }
      hudGauge.style.opacity = showG ? "0.9" : "0";
      const tx = statusText(ev);
      if (tx !== lastStatus) {
        lastStatus = tx;
        hudStatus.textContent = tx;
      }
      hudStatus.style.opacity = tx ? "1" : "0";
      hudSkip.style.opacity = stats.t > 45 ? "0.8" : "0";
      hudSkip.style.pointerEvents = stats.t > 45 ? "auto" : "none";
      guideShown = true;
    }
    function hideGuide() {
      if (!guideShown) return;
      guideShown = false;
      hudGauge.style.opacity = "0";
      hudStatus.style.opacity = "0";
      hudSkip.style.opacity = "0";
      hudSkip.style.pointerEvents = "none";
    }
    ctx.input.activate(skipBtn, () => {
      if (state !== "play" || stats.t <= 45) return;
      ctx.platform.interact({ type: "skip", room: roomIdx + 1 });
      hideGuide();
      if (roomIdx >= COUNT - 1) {
        startFinale();
        return;
      }
      const next = roomIdx + 1;
      saveProgress(next);
      beginTransition(room.points(), next, false);
    });

    function beginTransition(fromPts, idx, keepStats) {
      measure();
      const nr = ROOMS[idx]();
      nr.init();
      nr.update(1 / 60);
      const N = Math.round(150 * E.q);
      const from = sortByAngle(samplePts(fromPts, N));
      const to = sortByAngle(samplePts(nr.points(), N));
      const shift = Math.floor(rand() * N * 0.15);
      motes = from.map((p, i) => {
        const q = to[(i + shift) % N];
        return { x0: p.x, y0: p.y, x1: q.x, y1: q.y, b0: p.b == null ? 1 : p.b, b1: q.b == null ? 1 : q.b, ck0: p.ck || "warm", ck1: q.ck || "warm", d: rand() * 0.3, sw: rr(-1, 1), x: p.x, y: p.y };
      });
      trans = { room: nr, idx, keepStats };
      state = "trans";
      st = 0;
      hudWord.style.opacity = "0";
      hideResult();
      tone(noteHz(idx % 7), 0.03, 4, 0.3);
    }
    function enterRoom(nr, idx, keepStats) {
      room = nr;
      roomIdx = idx;
      if (!keepStats) stats = newStats();
      sustain = 0;
      state = "play";
      st = 0;
      setHudRoom(idx);
      if (!keepStats) showWord(nr);
      ctx.platform.setProgress(idx / COUNT);
    }
    function collapse() {
      state = "collapse";
      st = 0;
      stats.collapses++;
      hideGuide();
      hudGauge.style.opacity = "0";
      hudStatus.textContent = roomIdx === 3 ? "you touched it. try again, closer but not on it" : "too much. it fell apart. try again, gentler";
      lastStatus = hudStatus.textContent;
      hudStatus.style.opacity = "1";
      guideShown = true;
      soundDissipate();
      haptic("warning");
      const pts = samplePts(room.points(), Math.round(170 * E.q));
      debris = pts.map(p => {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) + 1;
        const sp = rr(60, 260);
        return { x: p.x, y: p.y, vx: (dx / d) * sp + rr(-80, 80), vy: (dy / d) * sp + rr(-80, 80), b: p.b == null ? 1 : p.b, ck: p.ck || "warm" };
      });
      ctx.platform.emit && ctx.platform.emit("collapse", { room: roomIdx + 1 });
    }
    function resolve(r) {
      state = "resolve";
      st = 0;
      stats.finalR = Math.max(r, room.need);
      E.flash = 1;
      soundResolve();
      haptic("success");
      hudWord.style.opacity = "0";
      ctx.platform.milestone && ctx.platform.milestone("room_clear", { room: roomIdx + 1 });
    }

    function computeMetrics() {
      const s = stats;
      const q = clamp((s.finalR - room.need) / (1 - room.need + 1e-6), 0, 1);
      const imperf = 0.8 + 0.19 * q;
      const excess = Math.max(0, s.actions - room.ideal);
      const restraint = clamp(1 - excess / (room.ideal * 5 + 4) - s.collapses * 0.08, 0.35, 0.99);
      const tFast = 6 + room.ideal * 3;
      const intuition = clamp(1 - sstep(tFast, tFast * 6, s.t) * 0.45 - s.collapses * 0.06, 0.4, 0.99);
      const risk = clamp(0.45 + 0.55 * s.maxC - s.collapses * 0.1, 0.3, 0.99);
      const balance = clamp((imperf + restraint) / 2 + 0.02, 0.3, 0.99);
      const vals = { imperfection: imperf, restraint, intuition, risk, balance, precision: imperf, composition: imperf, tension: imperf, cadence: imperf, observation: imperf, timing: imperf, damage: imperf, taste: 0 };
      const taste = clamp(imperf * 0.45 + restraint * 0.25 + intuition * 0.2 + risk * 0.1, 0.3, 0.99);
      vals.taste = taste;
      return { vals, taste };
    }
    const pct = v => Math.round(v * 100) + "%";
    let resultTimers = [];
    function showResult() {
      state = "result";
      st = 0;
      const { vals, taste } = computeMetrics();
      tastes[roomIdx] = taste;
      hudRes.innerHTML = "";
      const head = el("pi-row", hudRes);
      head.style.cssText = "justify-content:center;width:auto;opacity:1;margin-bottom:10px;color:rgba(255,228,196,0.9)";
      head.textContent = "room complete. you found the sweet spot";
      const rows = [];
      for (const m of room.metrics) {
        if (m === "taste") continue;
        const r = el("pi-row", hudRes);
        r.innerHTML = "<span>" + m + "</span><b>" + pct(vals[m]) + "</b>";
        rows.push(r);
      }
      const tr = el("pi-row t", hudRes);
      tr.innerHTML = "<span>taste</span><b>" + pct(taste) + "</b>";
      rows.push(tr);
      const btns = el("pi-btns", hudRes);
      const again = document.createElement("button");
      again.className = "pi-btn";
      again.textContent = "again";
      const cont = document.createElement("button");
      cont.className = "pi-btn";
      cont.textContent = "continue";
      btns.appendChild(again);
      btns.appendChild(cont);
      ctx.input.activate(again, () => {
        if (state !== "result") return;
        ctx.platform.interact({ type: "again", room: roomIdx + 1 });
        beginTransition(room.points(), roomIdx, false);
      });
      ctx.input.activate(cont, () => {
        if (state !== "result") return;
        ctx.platform.interact({ type: "continue", room: roomIdx + 1 });
        const next = roomIdx + 1;
        saveProgress(next);
        beginTransition(room.points(), next, false);
      });
      hudRes.style.opacity = "1";
      resultTimers.forEach(t => clearTimeout(t));
      resultTimers = [];
      rows.forEach((r, i) => resultTimers.push(ctx.timeout(() => (r.style.opacity = "1"), 300 + i * 450)));
      resultTimers.push(ctx.timeout(() => (btns.style.opacity = "1"), 500 + rows.length * 450));
    }
    function hideResult() {
      hudRes.style.opacity = "0";
      ctx.timeout(() => {
        if (state !== "result") hudRes.innerHTML = "";
      }, 1400);
    }

    async function saveProgress(next) {
      try {
        if (!ctx.game || !ctx.game.progress) return;
        await ctx.game.progress.save("main", {
          state: { room: next, tastes: tastes.map(t => (t ? Math.round(t * 100) : 0)) },
          label: "Room " + (next + 1 < 10 ? "0" : "") + (next + 1) + " / " + COUNT,
          percent: Math.round((next / COUNT) * 100),
          stateSchemaVersion: 1
        });
      } catch (e) {
        /* progress is a convenience */
      }
    }

    function startFinale() {
      state = "finale";
      st = 0;
      stats.finalR = Math.max(stats.finalR, lastR);
      const { taste } = computeMetrics();
      tastes[roomIdx] = taste;
      soundResolve();
      haptic("success");
      hudTL.style.opacity = "0";
      hudTR.style.opacity = "0";
      hudWord.style.opacity = "0";
      finaleStep = 0;
      finalePts = samplePts(room.points(), 170).map(p => ({ hx: p.x, hy: p.y, ck: p.ck, b: p.b == null ? 1 : p.b, x: p.x, y: p.y }));
    }

    // ------------------------------------------------------------------ title
    function showTitle() {
      hudTitle.innerHTML = "";
      const h = el("h", hudTitle);
      h.textContent = "a perfect imperfection";
      const pr = el("p", hudTitle);
      pr.innerHTML = "Every room starts perfect.<br>Your job: disturb it, just enough to make it feel alive.<br>Too little stays lifeless. Too much falls apart.<br>When it is right, the room glows, settles, and opens the next.";
      const s = el("s", hudTitle);
      const btnWrap = el("pi-btns", s);
      btnWrap.style.cssText = "justify-content:center;opacity:1;margin-top:10px";
      if (resumeFrom > 0) {
        const c = document.createElement("button");
        c.className = "pi-btn";
        c.textContent = "continue " + (resumeFrom + 1 < 10 ? "0" : "") + (resumeFrom + 1);
        const b = document.createElement("button");
        b.className = "pi-btn";
        b.textContent = "begin again";
        btnWrap.appendChild(b);
        btnWrap.appendChild(c);
        ctx.input.activate(c, () => begin(resumeFrom));
        ctx.input.activate(b, () => {
          try {
            ctx.game.progress.abandon("main").catch(() => {});
          } catch (e) {
            /* ignore */
          }
          begin(0);
        });
      } else {
        const b = document.createElement("button");
        b.className = "pi-btn";
        b.textContent = "enter";
        btnWrap.appendChild(b);
        ctx.input.activate(b, () => begin(0));
      }
      hudTitle.style.opacity = "1";
    }
    function begin(idx) {
      if (state !== "title" && state !== "end") return;
      audioInit();
      audioResume();
      try {
        ctx.platform.start();
      } catch (e) {
        /* ignore */
      }
      ctx.platform.interact({ type: "begin", room: idx + 1 });
      inTitle = false;
      hudTitle.style.opacity = "0";
      hudBig.style.opacity = "0";
      if (idx === 0) tastes = [];
      const pts = [];
      for (let i = 0; i < 40; i++) pts.push({ x: cx + rr(-2, 2), y: cy + rr(-2, 2), b: 1, ck: "warm" });
      beginTransition(pts, idx, false);
    }
    function showEnd() {
      state = "end";
      st = 0;
      const vals = tastes.filter(Boolean);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.8;
      hudRes.innerHTML = "";
      const r1 = el("pi-row", hudRes);
      r1.innerHTML = "<span>rooms</span><b>" + vals.length + " / " + COUNT + "</b>";
      const r2 = el("pi-row t", hudRes);
      r2.innerHTML = "<span>taste</span><b>" + pct(avg) + "</b>";
      const btns = el("pi-btns", hudRes);
      const again = document.createElement("button");
      again.className = "pi-btn";
      again.textContent = "again";
      btns.appendChild(again);
      ctx.input.activate(again, () => {
        if (state !== "end") return;
        hudBig.style.opacity = "0";
        state = "title";
        begin(0);
      });
      hudRes.style.opacity = "1";
      ctx.timeout(() => (r1.style.opacity = "1"), 400);
      ctx.timeout(() => (r2.style.opacity = "1"), 900);
      ctx.timeout(() => (btns.style.opacity = "1"), 1500);
      try {
        ctx.game.progress.complete("main", { state: { room: COUNT, finished: true }, label: "Imperfect", percent: 100, stateSchemaVersion: 1 }).catch(() => {});
      } catch (e) {
        /* ignore */
      }
      ctx.platform.setProgress(1);
      ctx.platform.complete({ taste: Math.round(avg * 100) });
      ctx.timeout(() => {
        try {
          ctx.pulse.complete({ text: "Imperfect. Taste " + Math.round(avg * 100) + "%", score: Math.round(avg * 100), result: "imperfect" });
        } catch (e) {
          /* optional */
        }
      }, 2200);
    }

    // ---------------------------------------------------------------- ambient
    const dust = [];
    for (let i = 0; i < 44; i++) dust.push({ x: rand(), y: rand(), z: rand(), s: rand() * 100 });

    // ------------------------------------------------------------------- loop
    let lowFpsT = 0;
    function update(dtMs, ls) {
      if (measure()) {
        layoutHud();
        if (room && (state === "play" || state === "result" || state === "resolve")) room.init();
      }
      let dt = Math.min(0.05, dtMs / 1000);
      E.t += dt;
      st += dt;

      // adaptive quality
      if (ls && ls.averageFps && ls.averageFps < 40) lowFpsT += dt;
      else lowFpsT = Math.max(0, lowFpsT - dt);
      if (lowFpsT > 3 && E.q > 0.6) {
        E.q = 0.6;
        lowFpsT = 0;
      }

      E.live = state === "play";
      // pointer
      if (input.pressed) {
        P.down = true;
        P.x = P.sx = P.px = input.x;
        P.y = P.sy = P.py = input.y;
        P.t0 = E.t;
        P.dist = 0;
        P.vx = P.vy = 0;
        audioResume();
        if (state === "title" && resumeFrom === 0 && st > 0.6) begin(0);
        else if (state === "play") {
          stats.actions++;
          room.down(P);
          ctx.platform.interact({ type: "touch", room: roomIdx + 1 });
          if (wordShown) wordTimer = Math.max(wordTimer, 2.5);
        }
      }
      if (P.down && input.down) {
        const nx = input.x, ny = input.y;
        if (nx !== P.x || ny !== P.y) {
          P.vx = lerp(P.vx, (nx - P.x) / Math.max(dt, 0.001), 0.4);
          P.vy = lerp(P.vy, (ny - P.y) / Math.max(dt, 0.001), 0.4);
          P.px = P.x;
          P.py = P.y;
          P.x = nx;
          P.y = ny;
          P.dist = Math.max(P.dist, Math.hypot(nx - P.sx, ny - P.sy));
          if (state === "play") room.move(P);
        } else {
          P.vx *= 0.8;
          P.vy *= 0.8;
        }
      }
      if (P.down && (input.released || !input.down)) {
        P.down = false;
        if (state === "play") room.up(P);
      }

      // word fade
      if (wordShown) {
        wordTimer += dt;
        if (wordTimer > 9) {
          hudWord.style.opacity = "0.72";
          wordShown = false;
        }
      }

      let active = P.down && state === "play";
      if (state === "play") {
        room.update(dt);
        stats.t += dt;
        const ev = room.evaluate();
        lastR = ev.r;
        updateGuide(ev);
        stats.peakR = Math.max(stats.peakR, ev.r);
        stats.maxC = Math.max(stats.maxC, ev.c < 1 ? ev.c : 0);
        E.res += (ev.r - E.res) * Math.min(1, dt * 2.5);
        E.chaos += (ev.c - E.chaos) * Math.min(1, dt * 3);
        if (ev.r > 0.55 && lastRTone < 0.55) tone(noteHz(5 + Math.floor(ev.r * 4)), 0.02, 2.5, 0.3);
        lastRTone = ev.r;
        if (ev.verdict === "collapse" || ev.c >= 1) collapse();
        else if (ev.verdict === "resolve") resolve(ev.r);
        else if (room.final) {
          if (ev.r >= room.need && !P.down) sustain += dt;
          else sustain = Math.max(0, sustain - dt * 2);
          if (sustain >= room.sustain) startFinale();
        } else {
          const ok = ev.r >= room.need && (room.holdOk ? P.down : !P.down);
          if (ok) sustain += dt;
          else sustain = Math.max(0, sustain - dt * 2);
          if (sustain >= room.sustain && !room.tapOnly) resolve(ev.r);
        }
      } else if (state === "resolve") {
        hideGuide();
        E.sync = Math.min(1, E.sync + dt * 1.2);
        room.update(dt * lerp(1, 0.12, E.sync));
        E.res += (1 - E.res) * Math.min(1, dt * 2);
        E.chaos *= Math.exp(-dt * 4);
        if (st > 2.4) showResult();
      } else if (state === "result") {
        room.update(dt * 0.12);
        E.res += (0.75 - E.res) * Math.min(1, dt);
      } else if (state === "trans") {
        hideGuide();
        gaugeVal = -1;
        const dur = 2.6;
        const u = st / dur;
        E.sync = Math.max(0, E.sync - dt * 1.5);
        E.res += (0 - E.res) * Math.min(1, dt * 1.2);
        E.chaos *= Math.exp(-dt * 3);
        for (const m of motes) {
          const v = easeIO(clamp((u - m.d) / 0.7, 0, 1));
          const dx = m.x1 - m.x0, dy = m.y1 - m.y0, L = Math.hypot(dx, dy) + 1;
          const sw = Math.sin(Math.PI * v) * m.sw * (0.12 * S + L * 0.25);
          m.x = lerp(m.x0, m.x1, v) + (-dy / L) * sw + noise2(m.sw * 10, E.t) * 6 * Math.sin(Math.PI * v);
          m.y = lerp(m.y0, m.y1, v) + (dx / L) * sw;
          m.v = v;
        }
        trans.room.update(dt);
        if (u >= 1) enterRoom(trans.room, trans.idx, trans.keepStats);
      } else if (state === "collapse") {
        E.chaos += (1 - E.chaos) * Math.min(1, dt * 4);
        E.res *= Math.exp(-dt * 3);
        for (const d of debris) {
          const a = noise2(d.x * 0.01, d.y * 0.01 + E.t * 0.3) * TAU;
          d.vx += Math.cos(a) * 120 * dt;
          d.vy += Math.sin(a) * 120 * dt;
          d.vx *= Math.exp(-dt * 1.2);
          d.vy *= Math.exp(-dt * 1.2);
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
        if (st > 1.8) {
          E.chaos = 0;
          beginTransition(debris.map(d => ({ x: d.x, y: d.y, b: d.b * 0.6, ck: d.ck })), roomIdx, true);
        }
      } else if (state === "finale") {
        hideGuide();
        E.sync = Math.min(1, E.sync + dt * 0.6);
        E.res += (1 - E.res) * Math.min(1, dt);
        room.update(dt * (1 - E.sync) + 0.0001);
        if (st > 4.6 && finaleStep === 0) {
          finaleStep = 1;
          hudBig.textContent = "perfect.";
          hudBig.style.opacity = "1";
        }
        if (st > 7.2 && finaleStep === 1) {
          finaleStep = 2;
          hudBig.style.opacity = "0";
        }
        if (st > 11 && finaleStep === 2) {
          finaleStep = 3;
          hudBig.textContent = "imperfect.";
          hudBig.style.opacity = "1";
          tone(noteHz(-5), 0.1, 8, 0.6);
          soundResolve();
        }
        if (st > 15.5) showEnd();
      } else if (state === "end") {
        room.update(dt * 0.05);
        E.res += (0.5 - E.res) * Math.min(1, dt * 0.5);
      } else if (state === "title") {
        E.res += (0.1 - E.res) * Math.min(1, dt);
      }
      E.flash = Math.max(0, E.flash - dt * 0.8);
      audioUpdate(active);
    }
    function render() {
      g.setTransform(K, 0, 0, K, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      let trail = 0.34;
      if (state === "trans") trail = 0.16;
      else if (state === "collapse") trail = 0.12;
      else if (state === "resolve" || state === "finale") trail = 0.22;
      else if (room && roomIdx === 6) trail = 0.26;
      g.fillStyle = "rgba(0,0,0," + trail + ")";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";

      // atmosphere
      const fx = cx, fy = cy;
      const hz = g.createRadialGradient(fx, fy, 0, fx, fy, 0.9 * S);
      hz.addColorStop(0, rgba(COL.warm, 0.012 + 0.05 * E.res + 0.08 * E.flash));
      hz.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 1;
      g.fillStyle = hz;
      g.fillRect(0, 0, W, H);
      for (const d of dust) {
        const x = ((d.x * W + E.t * (4 + d.z * 8) + noise1(d.s + E.t * 0.1) * 20) % (W + 20)) - 10;
        const y = d.y * H + noise1(d.s * 3 + E.t * 0.08) * 30;
        dot(x, y, 3 + d.z * 5, (0.04 + 0.22 * E.res) * (0.4 + d.z) * (inTitle ? 0.5 : 1), d.z > 0.5 ? "warm" : "cool");
      }

      if (state === "end" && room) {
        E.alpha = 1;
        room.draw();
      } else if (state === "title" || state === "end") {
        const b = 0.55 + 0.35 * Math.sin(E.t * 1.2);
        E.alpha = 1;
        dot(cx, cy, 14 + 6 * b, 0.6 + 0.3 * b, "warm");
        dot(cx, cy, 90, 0.05 + 0.04 * b, "warm");
      } else if (state === "trans") {
        const u = st / 2.6;
        E.alpha = sstep(0.62, 1, u);
        trans.room.draw();
        E.alpha = 1;
        for (const m of motes) {
          const v = m.v || 0;
          const b = lerp(m.b0, m.b1, v) * (0.55 + 0.45 * Math.sin(Math.PI * v)) * (1 - sstep(0.85, 1, u) * 0.8);
          dot(m.x, m.y, 7 + 5 * Math.sin(Math.PI * v), b * 0.55, v < 0.5 ? m.ck0 : m.ck1);
        }
      } else if (state === "collapse") {
        const f = 1 - sstep(0.2, 1.8, st);
        E.alpha = 1;
        for (const d of debris) dot(d.x, d.y, 8 + st * 6, d.b * f * 0.9, d.ck);
      } else if (state === "finale") {
        drawFinale();
      } else if (room) {
        E.alpha = 1;
        room.draw();
      }
      if (E.flash > 0 && room && state !== "finale") {
        const rad = (1 - E.flash) * 0.9 * S + 20;
        const pts = [];
        for (let i = 0; i <= 72; i++) pts.push(cx + Math.cos((i / 72) * TAU) * rad, cy + Math.sin((i / 72) * TAU) * rad);
        E.alpha = 1;
        thinPoly(pts, false, COL.warm, 1.2, E.flash * 0.35);
      }

      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";

      // composite: scene, then bloom from the scene only (never fed back into the trails)
      if (sceneBuf) {
        mg.setTransform(1, 0, 0, 1, 0, 0);
        mg.globalCompositeOperation = "copy";
        mg.globalAlpha = 1;
        mg.drawImage(sceneBuf, 0, 0);
        mg.setTransform(K, 0, 0, K, 0, 0);
        mg.globalCompositeOperation = "lighter";
        if (bloomA) {
          const a = bloomA.getContext("2d");
          a.globalCompositeOperation = "copy";
          a.drawImage(sceneBuf, 0, 0, bloomA.width, bloomA.height);
          mg.globalAlpha = clamp(0.3 + 0.25 * E.res + 0.45 * E.flash, 0, 1);
          mg.drawImage(bloomA, 0, 0, W, H);
          if (bloomB && E.q > 0.7) {
            const b = bloomB.getContext("2d");
            b.globalCompositeOperation = "copy";
            b.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
            mg.globalAlpha = clamp(0.26 + 0.25 * E.res + 0.45 * E.flash, 0, 1);
            // a hair of lateral spread reads like lens aberration
            mg.drawImage(bloomB, -3, 0, W + 6, H);
          }
        }
      }
      // photographic grain
      if (grainPattern && E.q > 0.7) {
        mg.setTransform(K, 0, 0, K, 0, 0);
        mg.globalCompositeOperation = "lighter";
        mg.globalAlpha = 0.028;
        mg.translate(Math.floor(rand() * 96), Math.floor(rand() * 96));
        mg.fillStyle = grainPattern;
        mg.fillRect(-96, -96, W + 96, H + 96);
      }
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.globalAlpha = 1;
      mg.globalCompositeOperation = "source-over";
    }

    function drawFinale() {
      const t = st;
      // 0-2.4 synchronise (room drawn, stilling). 2.4-4.2 contract. 4.2-7.8 one point. 7.8-10.8 expand.
      const contract = easeIO(sstep(2.4, 4.2, t));
      const expand = easeIO(sstep(7.8, 10.8, t));
      const k = contract * (1 - expand);
      E.alpha = 1 - sstep(1.6, 3.0, t) + sstep(10.2, 12, t);
      if (E.alpha > 0.01) room.draw();
      E.alpha = 1;
      const visible = sstep(1.8, 2.6, t) * (1 - sstep(10.6, 12.2, t));
      for (let i = 0; i < finalePts.length; i++) {
        const p = finalePts[i];
        const x = lerp(p.hx, cx, k), y = lerp(p.hy, cy, k);
        dot(x, y, 8 + 4 * (1 - k), p.b * visible * (1 - k * 0.85), p.ck);
      }
      const single = sstep(3.6, 4.4, t) * (1 - sstep(7.8, 8.8, t));
      if (single > 0) {
        const br = 0.8 + 0.2 * Math.sin(t * 1.6);
        dot(cx, cy, 16 * br, single, "warm");
        dot(cx, cy, 120, 0.1 * single, "warm");
      }
      if (t > 7.8 && t < 8.0) E.flash = Math.max(E.flash, 0.7);
    }

    // --------------------------------------------------------------- lifecycle
    ctx.game.loop({ input, update, render });

    // first frame: quiet darkness and one point
    render();
    ctx.platform.ready();

    // fonts & saved progress load after the first visible frame
    try {
      ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400", style: "normal" }).catch(() => {});
      ctx.loadFont("Cormorant Garamond", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }).catch(() => {});
    } catch (e) {
      /* system fallbacks are fine */
    }
    try {
      if (ctx.game && ctx.game.progress) {
        const saved = await ctx.game.progress.load("main");
        if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.room) && saved.state.room > 0 && saved.state.room < COUNT) {
          resumeFrom = saved.state.room;
          if (Array.isArray(saved.state.tastes)) tastes = saved.state.tastes.map(v => (typeof v === "number" && v > 0 ? v / 100 : 0));
        }
      }
    } catch (e) {
      resumeFrom = 0;
    }
    showTitle();

    // test hook: only active when a local harness passes ctx.__piDebug
    if (ctx.__piDebug) {
      ctx.__piDebug.api = {
        goto: i => {
          inTitle = false;
          hudTitle.style.opacity = "0";
          beginTransition(room ? room.points() : [{ x: cx, y: cy }], i, false);
        },
        info: () => ({ state, roomIdx, res: E.res, chaos: E.chaos, r: lastR, sustain, collapses: stats && stats.collapses }),
        dbg: () => (room && room.dbg ? room.dbg() : null)
      };
    }
  }
};
