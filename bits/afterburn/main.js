window.plethoraBit = {
  meta: {
    title: "AFTERBURN",
    runtime: "plethora-bit@2",
    tags: ["arcade", "flight", "3d", "endless-runner", "motion"],
    permissions: ["motion", "haptics", "storage", "audio", "backgroundMusic"]
  },

  async init(ctx) {
    // =====================================================================
    // Utilities
    // =====================================================================
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const smoothstep = (a, b, v) => smooth((v - a) / (b - a));
    const DEG = Math.PI / 180;
    const damp = (k, dt) => 1 - Math.exp(-k * dt);
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
    let rand = mulberry32(7);
    const rr = (a, b) => a + (b - a) * rand();
    const rsign = () => (rand() < 0.5 ? -1 : 1);

    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });
    const TEST = typeof window !== "undefined" && window.__AFTERBURN_TEST__ ? window.__AFTERBURN_TEST__ : null;

    // =====================================================================
    // Creator tuning (manifest.tuning) with safe fallbacks
    // =====================================================================
    function tnum(id, fallback) {
      try {
        const v = ctx.tune && typeof ctx.tune.number === "function" ? ctx.tune.number(id) : undefined;
        return Number.isFinite(v) ? v : fallback;
      } catch (e) { return fallback; }
    }
    function difficultyAt(km) {
      try {
        const c = ctx.tune && typeof ctx.tune.curve === "function" ? ctx.tune.curve("difficulty_ramp") : null;
        if (c && typeof c.at === "function") {
          const v = c.at(km);
          if (Number.isFinite(v)) return clamp(v, 0, 1);
        }
      } catch (e) { /* fall through */ }
      if (km < 3) return lerp(0, 0.4, km / 3);
      if (km < 8) return lerp(0.4, 0.85, (km - 3) / 5);
      return clamp(lerp(0.85, 1, (km - 8) / 4), 0, 1);
    }
    const CFG = {};
    function readTuning() {
      CFG.baseSpeed = tnum("base_speed", 54);
      CFG.maxSpeed = Math.max(CFG.baseSpeed, tnum("max_speed", 66));
      CFG.speedRampM = 9000;
      CFG.maxBank = tnum("max_bank_deg", 60) * DEG;
      CFG.liftAccel = 30;
      CFG.latDamp = tnum("lateral_damping", 1.7);
      CFG.rollResponse = 5.5;
      CFG.maxRollRate = 2.8;
      CFG.climbMax = tnum("climb_rate", 17);
      CFG.steerGain = tnum("steer_sensitivity", 1);
      CFG.gateMargin = tnum("gate_margin", 1);
      CFG.bankTolDeg = tnum("bank_tolerance_deg", 13);
      CFG.gateSpacing = tnum("gate_spacing", 150);
      CFG.minTurnRadius = tnum("min_turn_radius", 240);
      CFG.enemyWave = Math.round(tnum("enemy_wave_size", 3));
      CFG.cannonDamage = tnum("cannon_damage", 1);
      CFG.unlock1 = tnum("missile1_unlock_m", 1500);
      CFG.unlock2 = tnum("missile2_unlock_m", 4000);
      CFG.unlock3 = tnum("missile3_unlock_m", 8000);
      CFG.combatFirst = tnum("first_combat_m", 4400);
      CFG.combatEvery = tnum("combat_every_m", 5200);
      CFG.assist = clamp(tnum("alignment_assist", 0.6), 0, 1);
    }
    readTuning();

    // =====================================================================
    // Persistent viewer-local settings
    // =====================================================================
    const hasStorage = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    async function loadKey(key, fallback) {
      if (!hasStorage) return fallback;
      try {
        const v = await Promise.resolve(ctx.storage.get(key));
        return v === null || v === undefined ? fallback : v;
      } catch (e) { return fallback; }
    }
    function saveKey(key, value) {
      if (!hasStorage) return;
      try { Promise.resolve(ctx.storage.set(key, value)).catch(() => {}); } catch (e) { /* ignore */ }
    }
    const motionCapable = !!(ctx.capabilities && ctx.capabilities.motion && ctx.motion);
    const settings = Object.assign(
      { control: motionCapable ? "tilt" : "touch", sens: 1, invert: false, sound: true, axes: 0 },
      await loadKey("afterburn.settings", {})
    );
    if (!motionCapable) settings.control = "touch";
    let bestScore = Number(await loadKey("afterburn.best", 0)) || 0;
    let tutorialDone = !!(await loadKey("afterburn.tutorial", false));
    function saveSettings() { saveKey("afterburn.settings", { control: settings.control, sens: settings.sens, invert: settings.invert, sound: settings.sound, axes: settings.axes }); }
    const AXES_NAMES = ["Normal", "Rotated left", "Rotated right"];
    // Tilt in the player's frame. "Rotated" covers holding the phone sideways when the
    // host keeps the view in portrait (the sensor axes then turn with the device).
    function tiltAxes(tx, ty) {
      if (settings.axes === 1) return [-ty, tx];
      if (settings.axes === 2) return [ty, -tx];
      return [tx, ty];
    }
    const SENS_NAMES = ["Low", "Normal", "High"];
    const SENS_ANGLES = [34, 24, 17];

    // =====================================================================
    // Aircraft frontal silhouette (shared by the 3D model, the openings and collision)
    // Plane-local frontal coordinates: x = right, y = up (metres).
    // =====================================================================
    const WING = { rootX: 0.42, rootY: -0.12, tipX: 3.6, tipY: -0.38, rootT: 0.12, tipT: 0.05 };
    const FIN = { rootX: 0.42, rootY: 0.38, tipX: 0.9, tipY: 1.75, t: 0.07 };
    const PLANE_NOSE = 5.2;
    const PLANE_TAIL = 4.6;

    function ellipseDist(x, y, cx, cy, rx, ry) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
    }
    function taperedSegDist(px, py, ax, ay, bx, by, ra, rb) {
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - lerp(ra, rb, t);
    }
    // Approximate signed distance to the aircraft's frontal silhouette (<= 0 inside).
    function coreDist(x, y) {
      let d = ellipseDist(x, y, 0, 0, 0.56, 0.5);
      d = Math.min(d, ellipseDist(x, y, 0, 0.5, 0.3, 0.36));
      d = Math.min(d, ellipseDist(x, y, 0.34, -0.26, 0.3, 0.28));
      d = Math.min(d, ellipseDist(x, y, -0.34, -0.26, 0.3, 0.28));
      const ax = Math.abs(x);
      d = Math.min(d, taperedSegDist(ax, y, WING.rootX, WING.rootY, WING.tipX, WING.tipY, WING.rootT, WING.tipT));
      d = Math.min(d, taperedSegDist(ax, y, FIN.rootX, FIN.rootY, FIN.tipX, FIN.tipY, FIN.t, FIN.t * 0.7));
      return d;
    }

    // Collision sample points on the aircraft outline, labelled by part.
    const PLANE_POINTS = (function buildPlanePoints() {
      const pts = [];
      const add = (x, y, part) => pts.push({ x, y, part });
      for (const side of [1, -1]) {
        const nm = side > 0 ? "right" : "left";
        const wdx = WING.tipX - WING.rootX, wdy = WING.tipY - WING.rootY, wl = Math.hypot(wdx, wdy);
        const wnx = -wdy / wl, wny = wdx / wl;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const cx = WING.rootX + wdx * t, cy = WING.rootY + wdy * t, h = lerp(WING.rootT, WING.tipT, t) * 0.92;
          add(side * (cx + wnx * h), cy + wny * h, nm + " wing");
          add(side * (cx - wnx * h), cy - wny * h, nm + " wing");
        }
        add(side * (WING.tipX + (wdx / wl) * WING.tipT * 0.9), WING.tipY + (wdy / wl) * WING.tipT * 0.9, nm + " wingtip");
        const fdx = FIN.tipX - FIN.rootX, fdy = FIN.tipY - FIN.rootY, fl = Math.hypot(fdx, fdy);
        const fnx = -fdy / fl, fny = fdx / fl;
        for (let i = 1; i <= 4; i++) {
          const t = i / 4;
          const cx = FIN.rootX + fdx * t, cy = FIN.rootY + fdy * t, h = lerp(FIN.t, FIN.t * 0.7, t) * 0.9;
          add(side * (cx + fnx * h), cy + fny * h, nm + " tail fin");
          add(side * (cx - fnx * h), cy - fny * h, nm + " tail fin");
        }
        add(side * (FIN.tipX + (fdx / fl) * FIN.t * 0.6), FIN.tipY + (fdy / fl) * FIN.t * 0.6, nm + " tail fin");
        add(side * 0.34, -0.53, "engine");
        add(side * 0.62, -0.26, "engine");
        add(side * 0.21, 0.79, "canopy");
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        add(0.555 * Math.cos(a), 0.495 * Math.sin(a), Math.sin(a) < -0.3 ? "belly" : "fuselage");
      }
      add(0, 0.855, "canopy");
      return pts;
    })();

    // ---------------------------------------------------------------------
    // Fighter-shaped aperture: a rasterised field F (<= 0 = open) built from the
    // silhouette inflated by a margin that grows with distance from the axis
    // (so it encodes a bank tolerance). Rendering and collision both use it.
    // ---------------------------------------------------------------------
    const AP_RES = 0.04;
    const apCache = new Map();
    // m: clearance around the silhouette (m); kr: extra clearance per metre from the
    // fuselage axis, which sets the bank tolerance at the wingtips.
    function getAperture(m, kr) {
      const key = m.toFixed(3) + "_" + kr.toFixed(4);
      let ap = apCache.get(key);
      if (!ap) { ap = buildAperture(m, kr); apCache.set(key, ap); }
      return ap;
    }
    function buildAperture(m, kr) {
      const tb = kr;
      const xMax = WING.tipX + m + 3.75 * tb + 0.5;
      const yMin = WING.tipY - 0.1 - m - 3.75 * tb - 0.5;
      const yMax = FIN.tipY + 0.1 + m + 2.0 * tb + 0.5;
      const x0 = -xMax, y0 = yMin;
      const nx = Math.ceil((2 * xMax) / AP_RES) + 1;
      const ny = Math.ceil((yMax - yMin) / AP_RES) + 1;
      const F = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * AP_RES;
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * AP_RES;
          F[j * nx + i] = coreDist(x, y) - (m + Math.hypot(x, y) * tb);
        }
      }
      // Fill enclosed solid islands so the opening is one simple hole.
      const outside = new Uint8Array(nx * ny);
      const stack = [];
      const push = (i, j) => { const id = j * nx + i; if (!outside[id] && F[id] > 0) { outside[id] = 1; stack.push(id); } };
      for (let i = 0; i < nx; i++) { push(i, 0); push(i, ny - 1); }
      for (let j = 0; j < ny; j++) { push(0, j); push(nx - 1, j); }
      while (stack.length) {
        const id = stack.pop();
        const i = id % nx, j = (id / nx) | 0;
        if (i > 0) push(i - 1, j);
        if (i < nx - 1) push(i + 1, j);
        if (j > 0) push(i, j - 1);
        if (j < ny - 1) push(i, j + 1);
      }
      for (let id = 0; id < F.length; id++) if (F[id] > 0 && !outside[id]) F[id] = -0.001;
      const tipClear = m + WING.tipX * kr;
      const bt = Math.asin(clamp(tipClear / WING.tipX, 0, 1)) * 0.9;
      const ap = { m, kr, bt, nx, ny, x0, y0, F, contour: null, minX: 0, maxX: 0, minY: 0, maxY: 0 };
      ap.contour = extractContour(ap);
      for (const p of ap.contour) {
        ap.minX = Math.min(ap.minX, p[0]); ap.maxX = Math.max(ap.maxX, p[0]);
        ap.minY = Math.min(ap.minY, p[1]); ap.maxY = Math.max(ap.maxY, p[1]);
      }
      ap.radius = 0;
      for (const p of ap.contour) ap.radius = Math.max(ap.radius, Math.hypot(p[0], p[1]));
      return ap;
    }
    // Bilinear field lookup; > 0 means solid wall.
    function apField(ap, x, y) {
      const fx = (x - ap.x0) / AP_RES, fy = (y - ap.y0) / AP_RES;
      if (fx < 0 || fy < 0 || fx >= ap.nx - 1 || fy >= ap.ny - 1) return 1;
      const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
      const F = ap.F, nx = ap.nx, id = j * nx + i;
      const a = F[id], b = F[id + 1], c = F[id + nx], d = F[id + nx + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    function extractContour(ap) {
      const { nx, ny, F, x0, y0 } = ap;
      const pts = new Map();
      const next = new Map();
      const inside = (i, j) => F[j * nx + i] <= 0;
      function edgePoint(key) {
        let p = pts.get(key);
        if (p) return p;
        const base = key >> 1, horiz = (key & 1) === 0;
        const i = base % nx, j = (base / nx) | 0;
        const a = F[j * nx + i];
        const b = horiz ? F[j * nx + i + 1] : F[(j + 1) * nx + i];
        const t = clamp(a / (a - b), 0.001, 0.999);
        p = horiz ? [x0 + (i + t) * AP_RES, y0 + j * AP_RES] : [x0 + i * AP_RES, y0 + (j + t) * AP_RES];
        pts.set(key, p);
        return p;
      }
      // bilinear field inside cell (i,j) at local (u,v) in [0,1]
      function cellF(i, j, u, v) {
        const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i], d = F[(j + 1) * nx + i + 1];
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      }
      function seg(i, j, k1, k2) {
        // orient so the open (inside) region is on the left of k1 -> k2
        const p1 = edgePoint(k1), p2 = edgePoint(k2);
        const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const l = Math.hypot(dx, dy) || 1e-9;
        const lx = mx - (dy / l) * AP_RES * 0.2, ly = my + (dx / l) * AP_RES * 0.2;
        const u = clamp((lx - (x0 + i * AP_RES)) / AP_RES, 0, 1), v = clamp((ly - (y0 + j * AP_RES)) / AP_RES, 0, 1);
        if (cellF(i, j, u, v) <= 0) next.set(k1, k2); else next.set(k2, k1);
      }
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const c = (inside(i, j) ? 1 : 0) | (inside(i + 1, j) ? 2 : 0) | (inside(i + 1, j + 1) ? 4 : 0) | (inside(i, j + 1) ? 8 : 0);
          if (c === 0 || c === 15) continue;
          const e0 = (j * nx + i) * 2, e1 = (j * nx + i + 1) * 2 + 1, e2 = ((j + 1) * nx + i) * 2, e3 = (j * nx + i) * 2 + 1;
          const centerIn = cellF(i, j, 0.5, 0.5) <= 0;
          switch (c) {
            case 1: case 14: seg(i, j, e3, e0); break;
            case 2: case 13: seg(i, j, e0, e1); break;
            case 3: case 12: seg(i, j, e3, e1); break;
            case 4: case 11: seg(i, j, e1, e2); break;
            case 6: case 9: seg(i, j, e0, e2); break;
            case 7: case 8: seg(i, j, e3, e2); break;
            case 5: if (centerIn) { seg(i, j, e0, e1); seg(i, j, e2, e3); } else { seg(i, j, e3, e0); seg(i, j, e1, e2); } break;
            case 10: if (centerIn) { seg(i, j, e3, e0); seg(i, j, e1, e2); } else { seg(i, j, e0, e1); seg(i, j, e2, e3); } break;
          }
        }
      }
      const visited = new Set();
      let best = null, bestArea = 0;
      for (const startKey of next.keys()) {
        if (visited.has(startKey)) continue;
        const loop = [];
        let cur = startKey;
        for (let guard = 0; guard < 400000; guard++) {
          if (visited.has(cur)) break;
          visited.add(cur);
          loop.push(pts.get(cur));
          const n = next.get(cur);
          if (n === undefined) break;
          cur = n;
        }
        let area = 0;
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k], b = loop[(k + 1) % loop.length];
          area += a[0] * b[1] - b[0] * a[1];
        }
        if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop; }
      }
      return simplifyLoop(best || [], 0.012);
    }
    function simplifyLoop(loop, eps) {
      const n = loop.length;
      if (n < 12) return loop;
      // split the closed loop at two far-apart vertices, then Ramer–Douglas–Peucker each half
      let far = 0, farD = -1;
      for (let k = 0; k < n; k++) { const d = Math.hypot(loop[k][0] - loop[0][0], loop[k][1] - loop[0][1]); if (d > farD) { farD = d; far = k; } }
      const keep = new Uint8Array(n);
      keep[0] = 1; keep[far] = 1;
      function rdp(a, b) { // indices along the loop from a forward to b (b may wrap)
        const len = (b - a + n) % n;
        if (len < 2) return;
        const pa = loop[a], pb = loop[b];
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l = Math.hypot(dx, dy) || 1e-9;
        let maxD = -1, idx = -1;
        for (let s2 = 1; s2 < len; s2++) {
          const k = (a + s2) % n;
          const d = Math.abs((loop[k][0] - pa[0]) * dy - (loop[k][1] - pa[1]) * dx) / l;
          if (d > maxD) { maxD = d; idx = k; }
        }
        if (maxD > eps) { keep[idx] = 1; rdp(a, idx); rdp(idx, b); }
      }
      rdp(0, far);
      rdp(far, 0);
      const out = [];
      for (let k = 0; k < n; k++) if (keep[k]) out.push(loop[k]);
      return out;
    }

    // =====================================================================
    // Track: a continuous centreline sampled every DS metres
    // heading th: forward = (sin th, 0, -cos th), right = (cos th, 0, sin th)
    // =====================================================================
    const DS = 2;
    const CHUNK_N = 60;
    const GATE_T = 1.6;
    const GROUND_Y = 0;
    const track = { base: 0, x: [], z: [], th: [], k: [], cy: [], hw: [], hh: [], op: [] };
    const gen = {};
    let gates = [];
    let zones = [];
    let sections = [];
    let prompts = [];
    let gateId = 0;

    function sampleAt(arr, s) {
      let f = s / DS - track.base;
      const n = arr.length - 1;
      if (f <= 0) return arr[0];
      if (f >= n) return arr[n];
      const i = f | 0, t = f - i;
      return arr[i] + (arr[i + 1] - arr[i]) * t;
    }
    function trackPos(s, u, y, out) {
      const x = sampleAt(track.x, s), z = sampleAt(track.z, s), th = sampleAt(track.th, s);
      out.x = x + u * Math.cos(th);
      out.y = y;
      out.z = z + u * Math.sin(th);
      return out;
    }
    function speedAt(s) {
      let v = lerp(CFG.baseSpeed, CFG.maxSpeed, smoothstep(0, CFG.speedRampM, s));
      if (gen.tutorial && s < gen.tutorialEnd) v *= 0.9;
      return v;
    }
    function bankFor(k, V) { return Math.asin(clamp((k * V * V) / CFG.liftAccel, -0.85, 0.85)); }
    function floorAt(s) { const op = sampleAt(track.op, s); return Math.max(lerp(sampleAt(track.cy, s) - sampleAt(track.hh, s), -6, op), GROUND_Y); }
    function wallTopAt(s) {
      const op = sampleAt(track.op, s);
      const bottom = lerp(sampleAt(track.cy, s) - sampleAt(track.hh, s), -6, op);
      return lerp(sampleAt(track.cy, s) + sampleAt(track.hh, s), bottom, op);
    }

    function pushSample() {
      track.x.push(gen.x); track.z.push(gen.z); track.th.push(gen.th); track.k.push(gen.k);
      track.cy.push(gen.cy); track.hw.push(gen.hw); track.hh.push(gen.hh); track.op.push(gen.op);
    }
    function resetTrack(mode, seed) {
      for (const g of gates) disposeGate(g);
      gates = []; zones = []; sections = []; prompts = [];
      for (const key in track) if (Array.isArray(track[key])) track[key].length = 0;
      track.base = 0;
      rand = mulberry32(seed);
      Object.assign(gen, {
        mode, s: 0, x: 0, z: 0, th: 0, k: 0, cy: 32, hw: 15.5, hh: 9.5, op: 0,
        queue: [], lastKind: "start", lastGate: null,
        nextCombat: CFG.combatFirst, tutorial: false, tutorialEnd: 0
      });
      pushSample();
      if (mode === "play") {
        gen.queue.push({ kind: "recovery", len: tutorialDone ? 240 : 140 });
        if (!tutorialDone) queueTutorial();
      }
    }
    function trimTrack(sBehind) {
      const drop = Math.floor(sBehind / DS) - track.base - 4;
      if (drop > 600) {
        for (const key in track) if (Array.isArray(track[key])) track[key].splice(0, drop);
        track.base += drop;
      }
    }
    function ensureTrack(sTarget) {
      let guard = 0;
      while (gen.s < sTarget && guard++ < 50) appendSpec(nextSpec());
    }

    function appendSpec(spec) {
      const s0 = gen.s;
      const n = Math.max(1, Math.round(spec.len / DS));
      const cy0 = gen.cy, hw0 = gen.hw, hh0 = gen.hh, op0 = gen.op;
      const cyT = spec.dh ? clamp(cy0 + spec.dh, 20, 64) : cy0;
      const hwT = spec.hw !== undefined ? spec.hw : hw0;
      const hhT = spec.hh !== undefined ? spec.hh : hh0;
      const opT = spec.op !== undefined ? spec.op : op0;
      const kPeak = spec.k || 0;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const ramp = smoothstep(0, 0.22, t) * smoothstep(1, 0.78, t);
        gen.k = kPeak * ramp;
        gen.th += gen.k * DS;
        gen.x += Math.sin(gen.th) * DS;
        gen.z -= Math.cos(gen.th) * DS;
        gen.cy = lerp(cy0, cyT, smooth(t));
        gen.hw = lerp(hw0, hwT, smooth(t * (spec.widthRate || 2.5)));
        gen.hh = lerp(hh0, hhT, smooth(t * 2.5));
        gen.op = lerp(op0, opT, smooth(t));
        gen.s += DS;
        pushSample();
      }
      gen.lastKind = spec.kind;
      if (spec.gates) for (const gs of spec.gates) placeGate(gs, s0);
      if (spec.prompt) prompts.push({ s: s0 + spec.prompt.from, e: s0 + spec.prompt.to, text: spec.prompt.text, touchText: spec.prompt.touchText, id: spec.prompt.id });
      if (spec.zone) zones.push({ start: s0 + spec.zone.from, end: s0 + spec.zone.to, nextSpawn: s0 + spec.zone.from, spawned: 0 });
      if (spec.bonus) sections.push({ s: gen.s, bonus: spec.bonus, label: spec.bonusLabel || "SECTION CLEAR", resupply: !!spec.resupply, done: false });
      if (spec.tutorialEnd) { gen.tutorialEnd = gen.s; sections.push({ s: gen.s, bonus: 0, label: "", tutorialDone: true, done: false }); }
    }

    const GATE_SIZES = {
      tutorial: { m: 0.85, kr: 0.17, pts: 100, name: "WIDE" },
      wide: { m: 0.66, kr: 0.13, pts: 100, name: "WIDE" },
      normal: { m: 0.52, kr: 0.11, pts: 150, name: "STANDARD" },
      narrow: { m: 0.4, kr: 0.085, pts: 220, name: "NARROW" }
    };
    function placeGate(gs, s0) {
      const sg = s0 + gs.at;
      const size = GATE_SIZES[gs.size] || GATE_SIZES.normal;
      const m = size.m * CFG.gateMargin;
      const kr = size.kr * clamp(CFG.bankTolDeg / 13, 0.3, 2.5);
      const ap = getAperture(m, kr);
      const rim = getAperture(m + 0.34, kr);
      const cy = sampleAt(track.cy, sg), hw = sampleAt(track.hw, sg), hh = sampleAt(track.hh, sg);
      const rho = gs.bank ? bankFor(sampleAt(track.k, sg), speedAt(sg)) : 0;
      // Extents of the rotated rim so the opening always sits inside the corridor.
      let ex = 0, eyTop = 0, eyBot = 0;
      const c = Math.cos(rho), s = Math.sin(rho);
      for (const p of rim.contour) {
        const X = p[0] * c + p[1] * s, Y = -p[0] * s + p[1] * c;
        ex = Math.max(ex, Math.abs(X)); eyTop = Math.max(eyTop, Y); eyBot = Math.min(eyBot, Y);
      }
      const uRoom = Math.max(0, hw - ex - 1.2);
      const vUp = Math.max(0, hh - eyTop - 1.0), vDown = Math.max(0, hh + eyBot - 1.0);
      let ou = clamp((gs.fu || 0) * uRoom, -uRoom, uRoom);
      let ov = gs.fv > 0 ? gs.fv * vUp : (gs.fv || 0) * vDown;
      // Fairness: never require more lateral/vertical change than the spacing allows.
      const prev = gen.lastGate;
      if (prev) {
        const gap = sg - prev.s;
        // tighter openings get gentler lateral/vertical transitions
        const rate = gs.size === "narrow" ? 0.025 : gs.size === "normal" ? 0.035 : 0.05;
        const du = Math.max(1.5, gap * rate), dv = Math.max(1.2, gap * rate * 0.7);
        ou = clamp(ou, prev.ou - du, prev.ou + du);
        ov = clamp(ov, prev.ov - dv, prev.ov + dv);
      }
      ou = clamp(ou, -uRoom, uRoom);
      ov = clamp(ov, -vDown, vUp);
      const g = {
        id: ++gateId, s: sg, front: sg - GATE_T - 0.3, ou, ov, gy: cy + ov, cy, hw, hh, rho,
        ap, rim, size: gs.size, pts: size.pts, reinforced: !!gs.reinforced,
        intact: true, passed: false, minClear: Infinity, mesh: null, th: sampleAt(track.th, sg)
      };
      gates.push(g);
      gen.lastGate = { s: sg, ou, ov };
      if (gfxReady) buildGateMesh(g);
    }

    // ---------------- segment templates ----------------
    function corridorDims(D) { return { hw: lerp(15.5, 11.8, D), hh: lerp(9.5, 8.2, D) }; }
    function pickSize(D) {
      const r = rand();
      if (D < 0.18) return "wide";
      if (D < 0.45) return r < 0.55 ? "wide" : "normal";
      if (D < 0.72) return r < 0.2 ? "wide" : r < 0.78 ? "normal" : "narrow";
      return r < 0.45 ? "normal" : "narrow";
    }
    function offsetFrac(D) { return { u: Math.min(1, D * 1.7), v: clamp((D - 0.15) * 1.6, 0, 1) }; }
    function randGate(D, at, extra) {
      const of = offsetFrac(D);
      return Object.assign({ at, size: pickSize(D), fu: rr(-1, 1) * of.u, fv: rand() < 0.5 ? rr(-1, 1) * of.v : 0 }, extra || {});
    }
    function nextSpec() {
      if (gen.queue.length) return gen.queue.shift();
      const D = difficultyAt(gen.s / 1000);
      const dims = corridorDims(D);
      if (gen.mode === "menu") {
        if (gen.lastKind === "turn") return { kind: "straight", len: rr(220, 340), ...dims };
        return { kind: "turn", len: 380, k: rsign() / rr(650, 900), ...dims };
      }
      if (gen.lastKind === "turn" || gen.lastKind === "turn_gate") return { kind: "straight", len: rr(110, 150), ...dims };
      if (gen.s >= gen.nextCombat) { queueCombat(D); gen.nextCombat = gen.s + 2600 + CFG.combatEvery; return gen.queue.shift(); }
      const sp = CFG.gateSpacing;
      const options = [
        ["straight", 3],
        ["turn", D >= 0.04 ? 2.6 : 0.6],
        ["double", D >= 0.25 ? 2 : 0],
        ["vertical", D >= 0.3 ? 1.5 : 0],
        ["reinforced", D >= 0.45 ? 1 : 0],
        ["triple", D >= 0.7 ? 1.1 : 0],
        ["recovery", 0.5]
      ];
      let total = 0;
      for (const o of options) total += o[1];
      let r = rand() * total, kind = "straight";
      for (const o of options) { if ((r -= o[1]) <= 0) { kind = o[0]; break; } }
      if (kind === gen.lastKind && kind !== "straight") kind = "straight";
      switch (kind) {
        case "straight": {
          if (D >= 0.3 && rand() < 0.45) {
            const len = sp * 2.3;
            return { kind, len, ...dims, gates: [randGate(D, sp * 0.8), randGate(D, sp * 1.85)] };
          }
          const len = sp * rr(1.25, 1.6);
          return { kind, len, ...dims, gates: [randGate(D, len * 0.62)] };
        }
        case "double": {
          const gap = sp * 0.85, a = rr(0.5, 1) * Math.min(1, D * 1.5) * rsign();
          return { kind, len: 100 + gap + 140, ...dims, bonus: 150, gates: [randGate(D, 100, { fu: a }), randGate(D, 100 + gap, { fu: -a })] };
        }
        case "triple": {
          const gap = sp * 0.72;
          const a = rr(0.3, 0.7) * rsign();
          const soften = (g) => { if (g.size === "narrow") g.size = "normal"; return g; };
          return { kind, len: 90 + gap * 2 + 130, ...dims, bonus: 250, gates: [randGate(D, 90, { fu: a }), soften(randGate(D, 90 + gap, { fu: -a, fv: 0 })), soften(randGate(D, 90 + gap * 2, { fu: a * 0.5 }))] };
        }
        case "turn": {
          const R = Math.max(CFG.minTurnRadius, lerp(620, CFG.minTurnRadius, D) * rr(0.9, 1.15));
          const ang = rr(50, 105) * DEG * (1 + D * 0.35);
          const k = rsign() / R;
          const len = ang / (Math.abs(k) * 0.78);
          const gl = [];
          if (D >= 0.03) {
            // banked openings spaced through the constant-curvature middle of the turn
            const n = clamp(Math.floor(len / 260), 1, 3);
            for (let i = 0; i < n; i++) {
              const t = n === 1 ? 0.5 : 0.3 + (0.4 * i) / (n - 1);
              gl.push(randGate(D, len * t, { bank: true, fu: rr(-0.25, 0.25), fv: 0 }));
            }
          }
          return { kind: gl.length ? "turn_gate" : "turn", len, k, ...dims, gates: gl, bonus: gl.length ? 150 : 0, bonusLabel: "TURN CLEAR" };
        }
        case "vertical": {
          const dh = rsign() * rr(12, 22) * (0.6 + D * 0.6);
          return { kind, len: 330, dh, ...dims, bonus: 120, gates: [randGate(D, 318, { fv: 0, fu: rr(-0.4, 0.4) })] };
        }
        case "reinforced": {
          return { kind, len: 300, ...dims, gates: [randGate(D, 200, { reinforced: true, size: rand() < 0.5 ? "normal" : "narrow" })] };
        }
        default:
          return { kind: "recovery", len: 220, hw: dims.hw + 2, hh: dims.hh };
      }
    }
    function queueCombat(D) {
      const dims = corridorDims(D);
      gen.queue.push({ kind: "open_in", len: 360, op: 1, hw: 150, hh: dims.hh, widthRate: 1, prompt: { from: 0, to: 360, text: "AIRSPACE OPENING · HOSTILES AHEAD", id: "open" } });
      gen.queue.push({ kind: "open_zone", len: 760, k: rsign() / 1400, op: 1, hw: 150, zone: { from: 40, to: 760 } });
      gen.queue.push({ kind: "open_zone", len: 760, k: rsign() / 1400, op: 1, hw: 150, dh: rr(-8, 8), zone: { from: 0, to: 640 } });
      gen.queue.push({ kind: "open_out", len: 600, op: 0, hw: dims.hw + 1, hh: dims.hh, widthRate: 1, bonus: 500, bonusLabel: "AIRSPACE CLEARED", resupply: true, prompt: { from: 0, to: 520, text: "RETURN TO THE CORRIDOR", id: "funnel" } });
      gen.queue.push({ kind: "recovery", len: 220, ...dims });
    }
    function queueTutorial() {
      gen.tutorial = true;
      const hw = 16, hh = 9.5;
      const turnR = 600, turnLen = (45 * DEG) / (0.78 / turnR);
      gen.queue.push({ kind: "tut", len: 260, hw, hh, prompt: { from: -60, to: 260, text: "TILT LEFT / RIGHT TO STEER", touchText: "DRAG LEFT / RIGHT TO STEER", id: "steer" } });
      gen.queue.push({ kind: "tut", len: 250, hw, hh, dh: 8, prompt: { from: 0, to: 250, text: "TILT BACK TO CLIMB · FORWARD TO DIVE", touchText: "DRAG UP TO CLIMB · DOWN TO DIVE", id: "climb" } });
      gen.queue.push({ kind: "tut", len: 300, hw, hh, prompt: { from: 30, to: 272, text: "MATCH THE OPENING · KEEP WINGS LEVEL", id: "gate" }, gates: [{ at: 270, size: "tutorial", fu: 0, fv: 0 }] });
      gen.queue.push({ kind: "tut", len: 120, hw, hh });
      gen.queue.push({ kind: "turn_gate", len: turnLen, k: 1 / turnR, hw, hh, prompt: { from: -60, to: turnLen * 0.8, text: "BANK INTO THE TURN · HOLD IT", id: "turn" }, gates: [{ at: turnLen * 0.55, size: "tutorial", bank: true, fu: 0, fv: 0 }] });
      gen.queue.push({ kind: "tut", len: 160, hw, hh, prompt: { from: 0, to: 160, text: "NICE FLYING. NOW SURVIVE.", id: "done" }, tutorialEnd: true });
      let total = gen.s;
      for (const q of gen.queue) total += Math.max(1, Math.round(q.len / DS)) * DS;
      gen.tutorialEnd = total;
    }

    // =====================================================================
    // Surfaces, HUD and menus (DOM first, so the first frame is never blank)
    // =====================================================================
    const bgRoot = ctx.createRoot({ layer: "background", style: "background:linear-gradient(180deg,#0b1430 0%,#2a3463 45%,#a4605a 78%,#2a1d2c 100%);" });
    void bgRoot;
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    const ui = ctx.createRoot({ layer: "overlay", input: "passthrough" });
    ui.innerHTML = `
<style>
.ab{position:absolute;inset:0;font-family:"Space Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef3ff;user-select:none;-webkit-user-select:none;--st:0px;--sb:0px;--sl:0px;--sr:0px}
.ab [hidden]{display:none!important}
.ab button{font:inherit;color:inherit;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.ab .disp{font-family:"Bebas Neue","Space Grotesk",Impact,sans-serif;letter-spacing:.04em}
.ab-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:calc(var(--st) + 16px) calc(var(--sr) + 16px) calc(var(--sb) + 16px) calc(var(--sl) + 16px);text-align:center;box-sizing:border-box}
.ab-title{font-size:clamp(46px,13vmin,96px);line-height:.9;font-style:italic;background:linear-gradient(180deg,#fff 0%,#ffd7a1 55%,#ff7a3d 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 18px rgba(255,110,40,.45))}
.ab-tag{font-size:clamp(13px,3.4vmin,17px);opacity:.92;letter-spacing:.06em}
.ab-btn{background:rgba(10,16,34,.72);border:1px solid rgba(140,220,255,.55);border-radius:14px;padding:12px 22px;font-size:16px;font-weight:700;letter-spacing:.08em;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.ab-btn.primary{background:linear-gradient(180deg,#ff8a3d,#e2481f);border-color:#ffc49a;font-size:20px;padding:14px 34px;box-shadow:0 6px 24px rgba(255,90,30,.45)}
.ab-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:560px}
.ab-chip{background:rgba(8,14,30,.66);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:600}
.ab-small{font-size:12px;opacity:.8;max-width:420px;line-height:1.4}
.ab-best{font-size:22px;color:#ffd7a1}
.ab-panel{position:absolute;inset:0;background:rgba(4,8,20,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:auto}
.ab-hud{position:absolute;inset:0;pointer-events:none}
.ab-hud .tl{position:absolute;left:calc(var(--sl) + 14px);top:calc(var(--st) + 10px);text-shadow:0 2px 8px rgba(0,0,0,.6)}
.ab-hud .score{font-size:34px;line-height:1}
.ab-hud .dist{font-size:14px;font-weight:600;opacity:.95}
.ab-hud .best{font-size:11px;opacity:.7;letter-spacing:.1em}
.ab-hud .tr{position:absolute;right:calc(var(--sr) + 12px);top:calc(var(--st) + 10px);text-align:right;background:rgba(8,14,30,.5);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:6px 10px;min-width:96px}
.ab-hud .wname{font-size:18px;line-height:1.05}
.ab-hud .wammo{font-size:13px;color:#ffd27a;letter-spacing:.12em;min-height:15px}
.ab-hud .wnext{font-size:10px;opacity:.75;letter-spacing:.06em}
.ab-hud .att{position:absolute;right:calc(var(--sr) + 18px);top:calc(var(--st) + 92px);width:70px;height:70px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(8,14,30,.35);transition:opacity .25s;opacity:0}
.ab-hud .att.on{opacity:1}
.ab-hud .att i{position:absolute;left:8px;right:8px;top:50%;height:0;border-top:3px solid;margin-top:-1px;border-radius:2px}
.ab-hud .att .t{border-color:rgba(255,255,255,.55);border-top-style:dashed}
.ab-hud .att .p{border-color:#ffb347;left:14px;right:14px}
.ab-hud .att.ok .p{border-color:#6dff9e}
.ab-hud .att b{position:absolute;left:50%;top:50%;width:6px;height:16px;margin:-14px 0 0 -3px;background:currentColor;border-radius:2px}
.ab-hud .prompt{position:absolute;left:8%;right:8%;top:max(calc(var(--st) + 92px),24%);text-align:center;font-size:clamp(20px,6vmin,34px);text-shadow:0 2px 14px rgba(0,0,0,.8);transition:opacity .3s}
.ab-hud .banner{position:absolute;left:18%;right:18%;top:calc(var(--st) + 10px);text-align:center;font-size:clamp(22px,6.5vmin,40px);color:#ffd27a;text-shadow:0 2px 18px rgba(255,120,30,.8);opacity:0;transition:opacity .35s}
.ab-hud .banner.on{opacity:1}
.ab-hud .warn{position:absolute;left:5%;right:5%;top:56%;text-align:center;font-size:clamp(18px,5vmin,28px);color:#ffb347;text-shadow:0 2px 12px rgba(0,0,0,.8);opacity:0}
.ab-hud .warn.on{opacity:1;animation:abBlink .5s steps(2) infinite}
.ab-hud .toast{position:absolute;left:5%;right:5%;top:calc(var(--st) + 136px);text-align:center;font-size:13px;opacity:0;transition:opacity .4s}
.ab-hud .toast.on{opacity:.95}
.ab-hud .pop{position:absolute;left:50%;top:44%;transform:translateX(-50%);font-size:24px;color:#9ff;text-shadow:0 0 12px rgba(80,220,255,.9);white-space:nowrap;animation:abPop .9s ease-out forwards}
.ab-hud .rbtn{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(10,16,34,.55);display:flex;align-items:center;justify-content:center;flex-direction:column;line-height:1}
.ab-hud .missile{width:84px;height:84px;right:calc(var(--sr) + 18px);bottom:calc(var(--sb) + max(84px,12vh));font-size:28px;border-color:#ffb347;color:#ffd27a}
.ab-hud .missile span{font-size:13px;margin-top:2px}
.ab-hud .missile.off{opacity:.35;border-color:rgba(255,255,255,.4);color:#ccc}
.ab-hud .missile.pulse{animation:abPulse 1s ease-in-out infinite}
.ab-hud .cannon{width:72px;height:72px;right:calc(var(--sr) + 112px);bottom:calc(var(--sb) + max(62px,9vh));font-size:16px;border-color:#7ff3ff;color:#bff9ff}
.ab-hud .cannon.hot{background:rgba(120,240,255,.28)}
.ab-hud .lbtn{position:absolute;width:48px;height:48px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(10,16,34,.5);font-size:16px;font-weight:700;left:calc(var(--sl) + 14px)}
.ab-hud .pause{bottom:calc(var(--sb) + max(132px,18vh))}
.ab-hud .recal{bottom:calc(var(--sb) + max(74px,10vh));font-size:20px}
.ab-hud .skip{position:absolute;left:calc(var(--sl) + 12px);top:calc(var(--st) + 84px);padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.4);background:rgba(8,14,30,.55);font-size:12px}
.ab-hud .stick{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid rgba(255,255,255,.3);opacity:0;pointer-events:none}
.ab-hud .stick.on{opacity:1}
.ab-hud .knob{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.35)}
.ab-stats{display:grid;grid-template-columns:auto auto;gap:4px 18px;font-size:15px;text-align:left}
.ab-stats b{font-family:"Bebas Neue","Space Grotesk",sans-serif;font-size:22px;letter-spacing:.04em;font-weight:400}
.ab-reason{font-size:14px;color:#ffc2a1;max-width:440px}
.ab-new{color:#6dff9e;font-size:22px}
.cal-pad{position:relative;flex:0 0 auto;width:min(130px,28vh);height:min(130px,28vh);border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(8,14,30,.5)}
.cal-pad:before,.cal-pad:after{content:"";position:absolute;background:rgba(255,255,255,.2)}
.cal-pad:before{left:50%;top:6px;bottom:6px;width:1px}
.cal-pad:after{top:50%;left:6px;right:6px;height:1px}
.cal-dot{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#ffb347;box-shadow:0 0 12px #ff8a3d}
@keyframes abBlink{50%{opacity:.35}}
@keyframes abPop{0%{opacity:0;transform:translate(-50%,10px) scale(.8)}20%{opacity:1;transform:translate(-50%,0) scale(1.08)}100%{opacity:0;transform:translate(-50%,-34px) scale(1)}}
@keyframes abPulse{50%{box-shadow:0 0 0 10px rgba(255,180,70,.25);transform:scale(1.06)}}
</style>
<div class="ab" id="ab">
  <div class="ab-center" id="load"><div class="ab-title disp">AFTERBURN</div><div class="ab-tag" id="loadTxt">Loading flight systems…</div><button class="ab-btn" id="retry" hidden>RETRY</button></div>
  <div class="ab-center" id="menu" hidden>
    <div class="ab-title disp">AFTERBURN</div>
    <div class="ab-tag">Tilt to fly. Match the opening. Survive.</div>
    <button class="ab-btn primary disp" id="start">START FLIGHT</button>
    <div class="ab-row">
      <button class="ab-chip" id="optCtl"></button>
      <button class="ab-chip" id="optSens"></button>
      <button class="ab-chip" id="optInv"></button>
      <button class="ab-chip" id="optSnd"></button>
      <button class="ab-chip" id="optCal">Calibrate tilt</button>
    </div>
    <div class="ab-best disp" id="menuBest"></div>
    <div class="ab-small" id="menuNote"></div>
  </div>
  <div class="ab-hud" id="hud" hidden>
    <div class="tl"><div class="score disp" id="hScore">0</div><div class="dist" id="hDist">0.00 km</div><div class="best" id="hBest"></div></div>
    <button class="tr" id="hWeapon"><div class="wname disp" id="hWName">NO MISSILES</div><div class="wammo" id="hWAmmo"></div><div class="wnext" id="hNext"></div></button>
    <div class="att" id="att"><i class="t" id="attT"></i><i class="p" id="attP"></i></div>
    <div class="prompt disp" id="prompt"></div>
    <div class="banner disp" id="banner"></div>
    <div class="warn disp" id="warn"></div>
    <div class="toast" id="toast"></div>
    <div id="pops"></div>
    <div class="stick" id="stick"><div class="knob" id="knob"></div></div>
    <button class="lbtn pause" id="bPause" aria-label="Pause">II</button>
    <button class="lbtn recal" id="bRecal" aria-label="Recalibrate">⟲</button>
    <button class="rbtn cannon disp" id="bCannon" aria-label="Cannon">GUN</button>
    <button class="rbtn missile off" id="bMissile" aria-label="Fire missile">◆<span id="bMAmmo">LOCKED</span></button>
    <button class="skip" id="bSkip" hidden>Skip tutorial</button>
  </div>
  <div class="ab-panel" id="pause" hidden><div class="ab-center">
    <div class="ab-title disp" style="font-size:54px">PAUSED</div>
    <button class="ab-btn primary disp" id="pResume">RESUME</button>
    <div class="ab-row">
      <button class="ab-btn" id="pRestart">Restart</button>
      <button class="ab-btn" id="pRecal">Recalibrate</button>
    </div>
    <div class="ab-row">
      <button class="ab-chip" id="pSens"></button>
      <button class="ab-chip" id="pInv"></button>
      <button class="ab-chip" id="pSnd"></button>
    </div>
    <button class="ab-btn" id="pMenu">Main menu</button>
  </div></div>
  <div class="ab-panel" id="over" hidden><div class="ab-center">
    <div class="ab-title disp" style="font-size:56px">CRASHED</div>
    <div class="ab-reason" id="oReason"></div>
    <div class="ab-new disp" id="oNew" hidden>NEW RECORD</div>
    <div class="ab-stats">
      <span>Score</span><b id="oScore">0</b>
      <span>Distance</span><b id="oDist">0</b>
      <span>Best</span><b id="oBest">0</b>
      <span>Arsenal</span><b id="oUnlock">—</b>
    </div>
    <button class="ab-btn primary disp" id="oRestart">FLY AGAIN</button>
    <button class="ab-btn" id="oMenu">Main menu</button>
  </div></div>
  <div class="ab-panel" id="calib" hidden><div class="ab-center">
    <div class="ab-title disp" style="font-size:40px">CALIBRATE</div>
    <div class="ab-small">Hold your phone the way you want to fly, then tap <b>Set neutral</b>. Tilt to check: the dot should follow your wrist.</div>
    <div class="cal-pad"><div class="cal-dot" id="calDot"></div></div>
    <div class="ab-small" id="calRead"></div>
    <div class="ab-row"><button class="ab-btn primary disp" id="calSet">SET NEUTRAL</button><button class="ab-chip" id="calAxes"></button><button class="ab-btn" id="calDone">Done</button></div>
  </div></div>
</div>`;
    const $ = (id) => ui.querySelector("#" + id);
    const el = {};
    ["ab", "load", "loadTxt", "retry", "menu", "start", "optCtl", "optSens", "optInv", "optSnd", "optCal", "menuBest", "menuNote",
      "hud", "hScore", "hDist", "hBest", "hWeapon", "hWName", "hWAmmo", "hNext", "att", "attT", "attP", "prompt", "banner", "warn", "toast", "pops",
      "stick", "knob", "bPause", "bRecal", "bCannon", "bMissile", "bMAmmo", "bSkip",
      "pause", "pResume", "pRestart", "pRecal", "pSens", "pInv", "pSnd", "pMenu",
      "over", "oReason", "oNew", "oScore", "oDist", "oBest", "oUnlock", "oRestart", "oMenu",
      "calib", "calDot", "calRead", "calSet", "calDone", "calAxes"].forEach((id) => { el[id] = $(id); });

    function applySafeArea(sa) {
      sa = sa || ctx.safeArea || {};
      el.ab.style.setProperty("--st", (sa.top || 0) + "px");
      el.ab.style.setProperty("--sb", (sa.bottom || 0) + "px");
      el.ab.style.setProperty("--sl", (sa.left || 0) + "px");
      el.ab.style.setProperty("--sr", (sa.right || 0) + "px");
    }
    applySafeArea();
    try { ctx.markVisualReady("loading-screen"); } catch (e) { /* optional */ }
    ctx.platform.ready();

    // Fonts are optional polish; system fonts are the fallback.
    const addFont = (f) => { try { if (f && document.fonts && document.fonts.add && !(document.fonts.has && document.fonts.has(f))) document.fonts.add(f); } catch (e) { /* ignore */ } };
    try { Promise.resolve(ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0")).then(addFont).catch(() => {}); } catch (e) { /* ignore */ }
    try { Promise.resolve(ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0")).then(addFont).catch(() => {}); } catch (e) { /* ignore */ }

    // =====================================================================
    // Audio: ctx.music bed + small synthesized SFX (audio permission)
    // =====================================================================
    const sfx = { ac: null, master: null, engine: null, noise: null, music: null, ok: false };
    function audioInit() {
      if (sfx.ac || !settings.sound) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        sfx.ac = ac;
        sfx.master = ac.createGain();
        sfx.master.gain.value = 0.55;
        sfx.master.connect(ac.destination);
        const len = ac.sampleRate * 2;
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        sfx.noise = buf;
        // engine: rumble oscillators + filtered noise roar
        const eg = ac.createGain(); eg.gain.value = 0; eg.connect(sfx.master);
        const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.connect(eg);
        const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 52; o1.connect(lp); o1.start();
        const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 78.5; o2.connect(lp); o2.start();
        const ns = ac.createBufferSource(); ns.buffer = buf; ns.loop = true;
        const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.6;
        const ng = ac.createGain(); ng.gain.value = 0.55;
        ns.connect(bp); bp.connect(ng); ng.connect(eg); ns.start();
        sfx.engine = { gain: eg, lp, o1, o2, bp, ng };
        sfx.ok = true;
        ctx.onDestroy(() => { try { ac.close(); } catch (e) { /* ignore */ } });
      } catch (e) { sfx.ac = null; sfx.ok = false; }
    }
    function sfxOn() { return sfx.ok && settings.sound && sfx.ac && sfx.ac.state !== "closed"; }
    function noiseBurst(dur, f0, f1, gain, type) {
      if (!sfxOn()) return;
      const ac = sfx.ac, t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = sfx.noise;
      const f = ac.createBiquadFilter(); f.type = type || "lowpass";
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(sfx.master);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    function tone(freq0, freq1, dur, gain, type) {
      if (!sfxOn()) return;
      const ac = sfx.ac, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = type || "sine";
      o.frequency.setValueAtTime(freq0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(sfx.master); o.start(t); o.stop(t + dur + 0.05);
    }
    const SND = {
      cannon() { noiseBurst(0.07, 3000, 900, 0.22, "highpass"); tone(170, 90, 0.06, 0.12, "square"); },
      missile() { noiseBurst(0.7, 500, 2600, 0.35, "bandpass"); },
      boom(big) { noiseBurst(big ? 1.4 : 0.8, 1600, 90, big ? 0.9 : 0.6, "lowpass"); tone(70, 32, big ? 0.9 : 0.5, 0.5, "sine"); },
      gate(close) { tone(close ? 880 : 660, close ? 1320 : 990, 0.18, 0.12, "triangle"); },
      warn() { tone(880, 880, 0.09, 0.12, "square"); setTimeout(() => { if (!disposed) tone(880, 880, 0.09, 0.12, "square"); }, 140); },
      hit() { tone(520, 300, 0.05, 0.1, "square"); },
      unlock() { tone(440, 880, 0.25, 0.14, "triangle"); setTimeout(() => { if (!disposed) tone(660, 1320, 0.3, 0.14, "triangle"); }, 160); },
      crash() { noiseBurst(1.8, 2200, 60, 1.0, "lowpass"); tone(380, 60, 1.2, 0.25, "sawtooth"); },
      burner() { noiseBurst(1.6, 300, 2400, 0.45, "bandpass"); }
    };
    function engineUpdate(throttle, active) {
      if (!sfx.engine || !sfx.ac) return;
      const t = sfx.ac.currentTime, e = sfx.engine;
      const target = active && settings.sound ? 0.12 + 0.12 * throttle : 0;
      e.gain.gain.setTargetAtTime(target, t, 0.15);
      e.o1.frequency.setTargetAtTime(48 + 18 * throttle, t, 0.2);
      e.o2.frequency.setTargetAtTime(72 + 26 * throttle, t, 0.2);
      e.bp.frequency.setTargetAtTime(700 + 900 * throttle, t, 0.2);
      e.lp.frequency.setTargetAtTime(380 + 500 * throttle, t, 0.2);
    }
    async function musicStart() {
      if (!settings.sound || !ctx.music) return;
      try {
        await ctx.music.unlock();
        if (disposed) return;
        if (!sfx.music) sfx.music = ctx.music.play({ preset: "synthwave", volume: 0.26, intensity: 0.55, fadeInMs: 1200 });
        else ctx.music.resume();
      } catch (e) { /* music is optional */ }
    }
    function musicSting(name) { if (!settings.sound || !ctx.music) return; try { Promise.resolve(ctx.music.sting(name)).catch(() => {}); } catch (e) { /* ignore */ } }
    function setSound(on) {
      settings.sound = on;
      saveSettings();
      if (on) { audioInit(); if (sfx.ac && sfx.ac.state === "suspended") sfx.ac.resume().catch(() => {}); musicStart(); }
      else { try { if (ctx.music) ctx.music.pause(); } catch (e) { /* ignore */ } engineUpdate(0, false); }
      refreshOptionLabels();
    }
    function haptic(kind) { if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ } } }

    // =====================================================================
    // Input: tilt (ctx.motion), touch stick, keyboard
    // =====================================================================
    const inp = { x: 0, y: 0, fire: false, keyX: 0, keyY: 0, keyFire: false };
    let tilt = null;
    let motionActive = false;
    let motionLastAt = -1, motionStale = 0;
    function createTilt() {
      if (!motionActive) return;
      try { if (tilt && tilt.destroy) tilt.destroy(); } catch (e) { /* ignore */ }
      try {
        tilt = ctx.motion.tiltControl({ maxAngle: SENS_ANGLES[settings.sens], deadzone: 0.05, smoothing: 0.2, calibrate: true });
      } catch (e) { tilt = null; }
      motionStale = 0;
    }
    async function enableMotion() {
      if (!motionCapable) return false;
      if (motionActive && tilt) return true;
      try {
        await ctx.motion.start();
        if (disposed) return false;
        if (ctx.motion.permission === "denied") return false;
        motionActive = true;
        createTilt();
        return !!tilt;
      } catch (e) {
        return false;
      }
    }
    function toast(text, ms) {
      el.toast.textContent = text;
      el.toast.classList.add("on");
      toastT = (ms || 2600) / 1000;
    }
    let toastT = 0;
    function fallbackToTouch(reason) {
      settings.control = "touch";
      refreshOptionLabels();
      toast(reason || "Tilt unavailable — drag anywhere to steer", 3600);
    }

    const tracker = ctx.input.track(canvas);
    const stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
    // anchor the virtual stick exactly where the finger lands
    let pendingAnchor = null;
    ctx.listen(canvas, "pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      pendingAnchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    function updateTouchStick() {
      const down = tracker.down;
      if (down && !stick.active) {
        stick.active = true;
        const a = pendingAnchor || { x: tracker.x, y: tracker.y };
        stick.ox = a.x; stick.oy = a.y;
      }
      if (!down) pendingAnchor = null;
      if (!down && stick.active) { stick.active = false; }
      if (stick.active) {
        const R = 64;
        let dx = (tracker.x - stick.ox) / R, dy = (tracker.y - stick.oy) / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        stick.x = dx; stick.y = dy;
      } else { stick.x = 0; stick.y = 0; }
    }
    const keys = new Set();
    ctx.listen(window, "keydown", (e) => {
      keys.add(e.code);
      if (e.code === "KeyF" || e.code === "Enter") { if (state === "play") fireMissile(); }
      if (e.code === "KeyQ" || e.code === "Tab") { if (state === "play") cycleWeapon(); if (e.code === "Tab") e.preventDefault(); }
      if (e.code === "Escape" || e.code === "KeyP") { if (state === "play") pauseGame(); else if (state === "paused") resumeGame(); }
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    ctx.listen(window, "keyup", (e) => { keys.delete(e.code); });
    ctx.listen(window, "blur", () => { keys.clear(); inp.fire = false; });
    function readKeyboard() {
      inp.keyX = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
      inp.keyY = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0);
      inp.keyFire = keys.has("Space");
    }
    function shapeAxis(v) { v = clamp(v, -1, 1); return 0.45 * v + 0.55 * v * v * v; }
    function readInput() {
      readKeyboard();
      updateTouchStick();
      let x = 0, y = 0;
      const inv = settings.invert ? -1 : 1;
      if (settings.control === "tilt" && tilt) {
        const a = tiltAxes(Number(tilt.x) || 0, Number(tilt.y) || 0);
        x = a[0];
        y = a[1] * inv;
      }
      if (stick.active) { x = stick.x; y = -stick.y * inv; }
      if (inp.keyX || inp.keyY) { x = inp.keyX; y = inp.keyY * inv; }
      if (TEST && TEST.input) { x = TEST.input.x; y = TEST.input.y; inp.fire = !!TEST.input.fire; }
      inp.x = clamp(x * CFG.steerGain, -1, 1);
      inp.y = clamp(y, -1, 1);
    }

    // =====================================================================
    // Game state
    // =====================================================================
    let state = "loading"; // loading | menu | play | paused | crashing | over | error
    const P = { s: 0, u: 0, y: 32, vu: 0, vy: 0, bank: 0, speed: 54, alive: true };
    const run = { attempt: 0, scoreDist: 0, crashT: 0, reason: "", gatesPassed: 0, newBest: false, burnerT: 0, nearT: 0, shake: 0, timeScale: 1 };
    const weapons = [
      { id: "strike", name: "STRIKE", ammo: 0, unlocked: false, max: 5 },
      { id: "lance", name: "LANCE", ammo: 0, unlocked: false, max: 3 },
      { id: "hammer", name: "HAMMER", ammo: 0, unlocked: false, max: 2 }
    ];
    let selWeapon = 0;
    let enemies = [];
    let bullets = [];
    let missiles = [];
    let fireCooldown = 0;
    let missileTutorialShown = false;
    let lastWarnTurn = -1;
    const score = ctx.game.score({ initial: 0, min: 0 });

    function resetPlayer() {
      P.s = 0; P.u = 0; P.y = 32; P.vu = 0; P.vy = 0; P.bank = 0; P.speed = CFG.baseSpeed; P.alive = true;
    }
    function resetRun(mode) {
      readTuning();
      resetTrack(mode, mode === "play" ? (Date.now() & 0x7fffffff) : 99);
      resetPlayer();
      for (const e of enemies) releaseEnemy(e);
      for (const m of missiles) releaseMissile(m);
      enemies = []; bullets = []; missiles = [];
      for (const w of weapons) { w.ammo = 0; w.unlocked = false; }
      selWeapon = 0; fireCooldown = 0;
      run.scoreDist = 0; run.crashT = 0; run.reason = ""; run.gatesPassed = 0; run.newBest = false; run.burnerT = 0; run.shake = 0; run.timeScale = 1;
      lastWarnTurn = -1;
      ensureTrack(1000);
      if (gfxReady) { resetChunks(); clearFx(); if (plane) plane.visible = true; }
      cam.u = 0; cam.y = P.y; cam.init = false;
    }

    // ---------------------------------------------------------------------
    // Collision
    // ---------------------------------------------------------------------
    const tmpPt = { u: 0, y: 0 };
    function planePointToSection(p, out) {
      const c = Math.cos(P.bank), s = Math.sin(P.bank);
      out.u = P.u + p.x * c + p.y * s;
      out.y = P.y - p.x * s + p.y * c;
      return out;
    }
    function checkWorld() {
      const hw = sampleAt(track.hw, P.s);
      const op = sampleAt(track.op, P.s);
      const floor = floorAt(P.s);
      const wallTop = wallTopAt(P.s);
      const ceil = op < 0.08 ? sampleAt(track.cy, P.s) + sampleAt(track.hh, P.s) : Infinity;
      for (const p of PLANE_POINTS) {
        planePointToSection(p, tmpPt);
        if (tmpPt.y < floor) return crash(op > 0.5 ? "Flew into the ground." : "Your " + p.part + " scraped the floor — climb earlier.", p);
        if (tmpPt.y > ceil) return crash("Your " + p.part + " hit the ceiling — stay lower.", p);
        if (Math.abs(tmpPt.u) > hw && tmpPt.y < wallTop) {
          const side = tmpPt.u > 0 ? "right" : "left";
          const k = sampleAt(track.k, P.s);
          let hint = "";
          if (Math.abs(k) > 0.0012) hint = (k > 0) === (side === "left") ? " — bank harder into the turn." : " — you over-banked the turn.";
          return crash("Your " + p.part + " hit the " + side + " wall" + hint, p);
        }
      }
      return false;
    }
    function gateLocal(g, p, out) {
      planePointToSection(p, tmpPt);
      const dU = tmpPt.u - g.ou, dY = tmpPt.y - g.gy;
      const c = Math.cos(g.rho), s = Math.sin(g.rho);
      out.x = dU * c - dY * s;
      out.y = dU * s + dY * c;
      return out;
    }
    const tmpL = { x: 0, y: 0 };
    function checkGates() {
      for (const g of gates) {
        if (g.passed || !g.intact) continue;
        if (P.s + PLANE_NOSE < g.front) break;
        if (P.s - PLANE_TAIL > g.s) { onGatePassed(g); continue; }
        let worst = -Infinity, worstP = null;
        for (const p of PLANE_POINTS) {
          gateLocal(g, p, tmpL);
          const f = apField(g.ap, tmpL.x, tmpL.y);
          if (f > worst) { worst = f; worstP = p; }
        }
        g.minClear = Math.min(g.minClear, -worst);
        if (worst > 0) return crash(gateCrashReason(g, worstP), worstP);
      }
      return false;
    }
    function gateCrashReason(g, p) {
      const dRoll = (P.bank - g.rho) / DEG;
      const du = P.u - g.ou, dv = P.y - g.gy;
      let why;
      if (Math.abs(dRoll) > (g.ap.bt / DEG) * 0.6) {
        const need = Math.round(Math.abs(g.rho / DEG)), had = Math.round(Math.abs(P.bank / DEG));
        const needTxt = need < 2 ? "wings level" : need + "° " + (g.rho > 0 ? "right" : "left");
        why = "bank mismatch: needed " + needTxt + ", you had " + had + "° " + (P.bank > 0 ? "right" : "left");
      } else if (Math.abs(du) >= Math.abs(dv) * 1.3) why = "too far " + (du > 0 ? "right" : "left") + " by " + Math.abs(du).toFixed(1) + " m";
      else why = "too " + (dv > 0 ? "high" : "low") + " by " + Math.abs(dv).toFixed(1) + " m";
      return "Your " + p.part + " clipped the frame — " + why + ".";
    }
    function onGatePassed(g) {
      g.passed = true;
      run.gatesPassed++;
      const close = g.minClear < 0.35;
      const pts = g.pts + (close ? 60 : 0);
      score.add(pts, { reason: "gate" });
      popText((close ? "CLOSE! +" : "CLEAN +") + pts, close ? "#ffd27a" : "#9ff");
      SND.gate(close);
      haptic(close ? "medium" : "light");
      if (close) run.shake = Math.max(run.shake, 0.25);
      try { ctx.platform.interact({ type: "gate", size: g.size, close }); } catch (e) { /* ignore */ }
    }

    function crash(reason, p) {
      if (state !== "play" || !P.alive) return true;
      P.alive = false;
      state = "crashing";
      run.reason = reason;
      run.crashT = 0;
      run.timeScale = 0.35;
      run.shake = 1;
      haptic("error");
      SND.crash();
      musicSting("lose");
      try { if (sfx.music) ctx.music.duck(0.7, 1400); } catch (e) { /* ignore */ }
      if (gfxReady) {
        trackPos(P.s, P.u, P.y, v3a);
        spawnExplosion(v3a.x, v3a.y, v3a.z, 1.6, 0xffa040, 26);
        if (plane) plane.visible = false;
      }
      engineUpdate(0, false);
      return true;
    }

    // ---------------------------------------------------------------------
    // Weapons
    // ---------------------------------------------------------------------
    const MISSILE_DEF = [
      { speed: 150, range: 460, cone: 0.5, coneBase: 20, canReinforced: false, pierce: 0, blast: 0, color: 0xffb347 },
      { speed: 280, range: 600, cone: 0.22, coneBase: 8, canReinforced: true, pierce: 1, blast: 0, color: 0x7ff3ff },
      { speed: 120, range: 520, cone: 0.6, coneBase: 26, canReinforced: true, pierce: 0, blast: 45, color: 0xff5a5a }
    ];
    function currentWeapon() { return weapons[selWeapon]; }
    function cycleWeapon() {
      for (let i = 1; i <= weapons.length; i++) {
        const k = (selWeapon + i) % weapons.length;
        if (weapons[k].unlocked) { selWeapon = k; break; }
      }
      hudDirty = true;
    }
    let blockedByReinforced = false;
    function findTarget(type) {
      const def = MISSILE_DEF[type];
      let best = null, bestD = Infinity;
      blockedByReinforced = false;
      for (const g of gates) {
        if (!g.intact || g.passed) continue;
        const d = g.front - P.s;
        if (d < 28) continue;
        if (d > def.range) break;
        if (g.targeted) continue;            // already being handled by another missile
        if (g.reinforced && !def.canReinforced) { blockedByReinforced = true; break; }
        return { kind: "gate", g };
      }
      for (const e of enemies) {
        if (!e.alive || e.targeted) continue;
        const d = e.s - P.s;
        if (d < 25 || d > def.range) continue;
        const lim = def.coneBase + def.cone * d;
        if (Math.abs(e.u - P.u) > lim || Math.abs(e.y - P.y) > lim * 0.8) continue;
        if (d < bestD) { bestD = d; best = { kind: "enemy", e }; }
      }
      return best;
    }
    function fireMissile() {
      if (state !== "play") return;
      const w = currentWeapon();
      if (!w.unlocked) { toast("Missiles unlock at " + (CFG.unlock1 / 1000).toFixed(1) + " km"); return; }
      if (w.ammo <= 0) {
        const other = weapons.findIndex((x) => x.unlocked && x.ammo > 0);
        if (other >= 0) { selWeapon = other; hudDirty = true; toast(w.name + " empty — switched to " + weapons[other].name); }
        else toast("No missiles left");
        return;
      }
      const target = findTarget(selWeapon);
      if (!target) { toast(blockedByReinforced ? "STRIKE can't break reinforced gates — needs LANCE or HAMMER" : "NO TARGET IN RANGE", 1800); return; }
      w.ammo--;
      if (target.kind === "gate") target.g.targeted = true; else target.e.targeted = true;
      missiles.push({ type: selWeapon, s: P.s + 3, u: P.u, y: P.y - 0.6, target, pierce: MISSILE_DEF[selWeapon].pierce, life: 6, puff: 0, mesh: null });
      SND.missile();
      haptic("medium");
      el.bMissile.classList.remove("pulse");
      hudDirty = true;
      try { ctx.platform.interact({ type: "missile", weapon: w.id }); } catch (e) { /* ignore */ }
    }
    function targetPos(t) {
      if (t.kind === "gate") return { s: t.g.front, u: t.g.ou, y: t.g.gy, alive: t.g.intact };
      return { s: t.e.s, u: t.e.u, y: t.e.y, alive: t.e.alive };
    }
    function updateMissiles(dt) {
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        const def = MISSILE_DEF[m.type];
        m.life -= dt;
        let tp = m.target ? targetPos(m.target) : null;
        if (tp && !tp.alive) {
          m.target = findTarget(m.type);
          if (m.target) { if (m.target.kind === "gate") m.target.g.targeted = true; else m.target.e.targeted = true; }
          tp = m.target ? targetPos(m.target) : null;
        }
        const vs = P.speed + def.speed;
        m.s += vs * dt;
        if (tp) {
          const lat = 70 * dt;
          m.u += clamp(tp.u - m.u, -lat, lat);
          m.y += clamp(tp.y - m.y, -lat, lat);
          if (m.s >= tp.s) {
            impactMissile(m, tp);
            if (m.pierce > 0 && m.target && m.target.kind === "gate") {
              m.pierce--;
              const next = gates.find((g) => g.intact && !g.passed && g.front > m.s + 5 && g.front < m.s + 170);
              if (next) { m.target = { kind: "gate", g: next }; next.targeted = true; continue; }
            }
            releaseMissile(m); missiles.splice(i, 1); continue;
          }
        }
        if (m.life <= 0) {
          if (gfxReady) { trackPos(m.s, m.u, m.y, v3a); spawnExplosion(v3a.x, v3a.y, v3a.z, 0.6, 0xffc070, 6); }
          releaseMissile(m); missiles.splice(i, 1);
        }
      }
    }
    function impactMissile(m, tp) {
      const def = MISSILE_DEF[m.type];
      if (gfxReady) { trackPos(tp.s, tp.u, tp.y, v3a); spawnExplosion(v3a.x, v3a.y, v3a.z, def.blast ? 2.6 : 1.3, def.color, def.blast ? 28 : 14); }
      if (def.blast) {
        // HAMMER: clears a small cluster of obstacles and damages nearby enemies.
        let n = 0;
        for (const g of gates) {
          if (!g.intact || g.passed) continue;
          if (g.front >= tp.s - 2 && g.front <= tp.s + 150 && n < 3) { destroyGate(g); n++; }
        }
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.s - tp.s, e.u - tp.u, e.y - tp.y);
          if (d < def.blast) killEnemy(e, "missile");
        }
        if (gfxReady) spawnShockwave(v3a.x, v3a.y, v3a.z);
        run.shake = Math.max(run.shake, 0.5);
        SND.boom(true);
      } else {
        if (m.target.kind === "gate") destroyGate(m.target.g);
        else killEnemy(m.target.e, "missile");
        SND.boom(false);
      }
      haptic("heavy");
    }
    function destroyGate(g) {
      if (!g.intact) return;
      g.intact = false;
      score.add(25, { reason: "gate_destroyed" });
      popText("GATE DOWN +25", "#ffd27a");
      if (gfxReady) {
        trackPos(g.s - GATE_T * 0.5, g.ou, g.gy, v3a);
        spawnGateDebris(g);
        if (g.mesh) { scene.remove(g.mesh); disposeGateMesh(g); }
      }
    }

    function fireCannon(dt) {
      fireCooldown -= dt;
      if (!(inp.fire || inp.keyFire) || fireCooldown > 0) return;
      fireCooldown = 1 / 11;
      const su = Math.tan(Math.atan2(P.vu, P.speed));
      const sy = Math.tan(Math.atan2(P.vy, P.speed));
      for (const side of [-1, 1]) {
        if (bullets.length >= 60) break;
        const c = Math.cos(P.bank), s = Math.sin(P.bank);
        const gx = side * 0.9, gy = -0.05;
        bullets.push({ s: P.s + 4, u: P.u + gx * c + gy * s, y: P.y - gx * s + gy * c, su, sy, life: 1.4 });
      }
      muzzleT = 0.05;
      SND.cannon();
    }
    function updateBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const ds = (P.speed + 520) * dt;
        const s0 = b.s;
        b.s += ds; b.u += b.su * ds; b.y += b.sy * ds;
        b.life -= dt;
        let dead = b.life <= 0;
        if (!dead) {
          for (const e of enemies) {
            if (!e.alive) continue;
            if (s0 <= e.s + 4 && b.s >= e.s - 4 && Math.abs(b.u - e.u) < 3.4 && Math.abs(b.y - e.y) < 1.4) {
              e.hp -= CFG.cannonDamage;
              e.flash = 0.08;
              SND.hit();
              if (gfxReady) { trackPos(e.s, b.u, b.y, v3a); spawnSpark(v3a.x, v3a.y, v3a.z, 0xffe0a0); }
              if (e.hp <= 0) killEnemy(e, "cannon");
              dead = true; break;
            }
          }
        }
        if (!dead) {
          for (const g of gates) {
            if (!g.intact) continue;
            if (g.front > b.s) break;
            if (s0 <= g.s && b.s >= g.front) {
              const dU = b.u - g.ou, dY = b.y - g.gy, c = Math.cos(g.rho), s = Math.sin(g.rho);
              if (apField(g.ap, dU * c - dY * s, dU * s + dY * c) > 0) {
                if (gfxReady) { trackPos(g.front, b.u, b.y, v3a); spawnSpark(v3a.x, v3a.y, v3a.z, 0xa0e8ff); }
                dead = true; break;
              }
            }
          }
        }
        if (!dead && Math.abs(b.u) > sampleAt(track.hw, b.s) && b.y < wallTopAt(b.s)) dead = true;
        if (dead) bullets.splice(i, 1);
      }
    }

    // ---------------------------------------------------------------------
    // Enemies (open-air sections only)
    // ---------------------------------------------------------------------
    function updateZones(dt) {
      for (const z of zones) {
        if (P.s < z.start - 420 || P.s > z.end) continue;
        if (P.s + 440 < z.nextSpawn) continue;
        if (z.nextSpawn > z.end - 120) continue;
        const D = difficultyAt(P.s / 1000);
        const alive = enemies.filter((e) => e.alive).length;
        const size = clamp(1 + Math.floor(rand() * (1 + D * 2.2)), 1, Math.max(1, CFG.enemyWave));
        if (alive + size <= 6) spawnFormation(size, z.nextSpawn);
        z.nextSpawn += rr(260, 360);
      }
    }
    function spawnFormation(size, sSpawn) {
      const behaviours = ["cross", "weave", "climb"];
      const beh = behaviours[(rand() * behaviours.length) | 0];
      const baseU = clamp(P.u + rr(-45, 45), -80, 80);
      const baseY = clamp(P.y + rr(-10, 12), 22, 70);
      const dir = baseU > P.u ? -1 : 1;
      for (let i = 0; i < size; i++) {
        const off = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
        enemies.push(acquireEnemy({
          s: Math.max(sSpawn, P.s + 420) + Math.abs(off) * 9,
          u: baseU + off * 8, y: baseY - Math.abs(off) * 1.2,
          vs: P.speed - rr(26, 36), vu: beh === "cross" ? dir * rr(5, 9) : 0, vy: 0,
          beh, phase: rand() * 6.28, t: 0, hp: 3, alive: true, flash: 0, bank: 0, targeted: false, mesh: null
        }));
      }
    }
    function updateEnemies(dt) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!e.alive) { enemies.splice(i, 1); releaseEnemy(e); continue; } // killed, passed or departed
        e.t += dt;
        e.vs = Math.min(e.vs, P.speed - 18);
        let tvu = e.vu, tvy = 0;
        if (e.beh === "weave") tvu = Math.sin(e.t * 0.9 + e.phase) * 9;
        if (e.beh === "climb") tvy = Math.sin(e.t * 0.7 + e.phase) * 5;
        // Fairness: enemies sidestep the player when they are close and not being chased.
        const ahead = e.s - P.s;
        if (ahead > 0 && ahead < 140 && Math.abs(e.u - P.u) < 9 && Math.abs(e.y - P.y) < 5) tvu += (e.u >= P.u ? 1 : -1) * 7;
        e.cvu = lerp(e.cvu || 0, tvu, damp(1.2, dt));
        e.cvy = lerp(e.cvy || 0, tvy, damp(1.2, dt));
        e.s += e.vs * dt; e.u += e.cvu * dt; e.y += e.cvy * dt;
        e.u = clamp(e.u, -110, 110); e.y = clamp(e.y, 16, 90);
        const eop = sampleAt(track.op, e.s + 60);
        if (eop < 0.6) { e.y += 26 * dt; e.u += Math.sign(e.u || 1) * 14 * dt; if (eop < 0.15 || e.y > 120) { e.alive = false; e.left = true; continue; } }
        e.bank = lerp(e.bank, clamp(e.cvu * 0.06, -0.9, 0.9), damp(3, dt));
        e.flash = Math.max(0, e.flash - dt);
        if (e.s < P.s - 60) { e.alive = false; continue; }
        // collision with the player
        if (state === "play" && Math.abs(e.s - P.s) < 6) {
          for (const p of PLANE_POINTS) {
            planePointToSection(p, tmpPt);
            if (Math.abs(tmpPt.u - e.u) < 3.3 && Math.abs(tmpPt.y - e.y) < 0.9) { crash("Mid-air collision with an enemy fighter.", p); return; }
          }
        }
      }
    }
    function killEnemy(e, how) {
      if (!e.alive) return;
      e.alive = false;
      score.add(250, { reason: "enemy" });
      popText("SPLASH +250", "#ff9a7a");
      SND.boom(false);
      haptic("medium");
      if (gfxReady) { trackPos(e.s, e.u, e.y, v3a); spawnExplosion(v3a.x, v3a.y, v3a.z, 1.4, 0xff7040, 16); }
      try { ctx.platform.interact({ type: "enemy_down", how }); } catch (err) { /* ignore */ }
    }

    // ---------------------------------------------------------------------
    // Progression, prompts, sections
    // ---------------------------------------------------------------------
    function checkProgress() {
      const unlocks = [CFG.unlock1, CFG.unlock2, CFG.unlock3];
      const startAmmo = [3, 2, 1];
      const blocked = gen.tutorial && P.s < gen.tutorialEnd;
      for (let i = 0; i < 3; i++) {
        if (!weapons[i].unlocked && P.s >= unlocks[i] && !blocked) {
          weapons[i].unlocked = true;
          weapons[i].ammo = startAmmo[i];
          selWeapon = i;
          banner(weapons[i].name + " MISSILE ONLINE");
          SND.unlock(); musicSting("powerup"); haptic("success");
          try { ctx.platform.milestone("unlock_" + weapons[i].id, { distance: Math.round(P.s) }); } catch (e) { /* ignore */ }
          if (i === 0 && !missileTutorialShown) {
            missileTutorialShown = true;
            el.bMissile.classList.add("pulse");
            showPrompt("TAP ◆ TO BLAST THE NEXT GATE", 4.5);
          }
          hudDirty = true;
        }
      }
      for (const sec of sections) {
        if (sec.done || P.s < sec.s) continue;
        sec.done = true;
        if (sec.tutorialDone) { finishTutorial(); continue; }
        if (sec.bonus) { score.add(sec.bonus, { reason: "section" }); popText(sec.label + " +" + sec.bonus, "#6dff9e"); }
        if (sec.resupply) {
          let msg = "";
          if (weapons[0].unlocked && weapons[0].ammo < weapons[0].max) { weapons[0].ammo++; msg += "+1 STRIKE "; }
          if (weapons[1].unlocked && weapons[1].ammo < weapons[1].max) { weapons[1].ammo++; msg += "+1 LANCE"; }
          if (msg) toast("Resupply: " + msg.trim());
          hudDirty = true;
        }
      }
      // distance points
      const meters = Math.floor(P.s);
      if (meters > run.scoreDist) { score.add(meters - run.scoreDist, { reason: "distance" }); run.scoreDist = meters; }
    }
    let promptOverride = null, promptOverrideT = 0;
    function showPrompt(text, secs) { promptOverride = text; promptOverrideT = secs; }
    function currentPrompt() {
      if (promptOverride && promptOverrideT > 0) return promptOverride;
      for (const p of prompts) {
        if (P.s >= p.s && P.s <= p.e) {
          if (p.id && gen.tutorial === false && ["steer", "climb", "gate", "turn", "done"].includes(p.id)) continue;
          return settings.control === "touch" && p.touchText ? p.touchText : p.text;
        }
      }
      return "";
    }
    function finishTutorial() {
      if (!gen.tutorial) return;
      gen.tutorial = false;
      tutorialDone = true;
      saveKey("afterburn.tutorial", true);
      el.bSkip.hidden = true;
      try { ctx.platform.milestone("tutorial_complete"); } catch (e) { /* ignore */ }
    }

    // =====================================================================
    // Simulation step (fixed 120 Hz)
    // =====================================================================
    function simStep(dt) {
      if (state === "menu") { autopilot(dt); return; }
      if (state === "crashing") {
        run.crashT += dt;
        updateEnemies(dt * run.timeScale);
        updateMissiles(dt * run.timeScale);
        if (run.crashT > 1.25) showGameOver();
        return;
      }
      if (state !== "play") return;
      readInput();
      const V = speedAt(P.s);
      P.speed = V;
      const bankT = shapeAxis(inp.x) * CFG.maxBank;
      const mr = CFG.maxRollRate * dt;
      P.bank += clamp((bankT - P.bank) * CFG.rollResponse * dt, -mr, mr);
      const k = sampleAt(track.k, P.s);
      const op = sampleAt(track.op, P.s);
      const hw = sampleAt(track.hw, P.s);
      let au = CFG.liftAccel * Math.sin(P.bank) - k * V * V - CFG.latDamp * P.vu;
      if (op > 0.05) {
        // open-air sections: a soft boundary herds the jet back towards the course
        const lim = Math.max(4, Math.min(hw - 8, 95));
        if (Math.abs(P.u) > lim) au -= Math.sign(P.u) * (Math.abs(P.u) - lim) * 1.5;
      }
      P.vu += au * dt;
      if (op > 0.05) {
        const lim = Math.max(4, Math.min(hw - 8, 95));
        const over = Math.abs(P.u) - lim;
        if (over > 0) P.vu = Math.sign(P.u) > 0 ? Math.min(P.vu, -over * 2.2) : Math.max(P.vu, over * 2.2);
      }
      P.u += P.vu * dt;
      const vyT = shapeAxis(inp.y) * CFG.climbMax;
      P.vy += (vyT - P.vy) * 3.2 * dt;
      if (op > 0.05) {
        const cy = sampleAt(track.cy, P.s), hh = sampleAt(track.hh, P.s);
        const yMin = Math.max(18, floorAt(P.s) + 3);
        const yMax = cy + hh - 2.5 + Math.max(0, op - 0.1) * 42;
        if (P.y < yMin) P.vy = Math.max(P.vy, (yMin - P.y) * 2.5);
        if (P.y > yMax) P.vy = Math.min(P.vy, -(P.y - yMax) * 2.5);
      }
      P.y += P.vy * dt;
      applyAlignmentAssist(dt);
      P.s += V * dt;
      ensureTrack(P.s + 1000);
      if (checkWorld()) return;
      if (checkGates()) return;
      fireCannon(dt);
      updateBullets(dt);
      updateMissiles(dt);
      updateZones(dt);
      updateEnemies(dt);
      if (state !== "play") return;
      checkProgress();
      if (P.s > 1200) trimTrack(P.s - 500);
      for (let i = gates.length - 1; i >= 0; i--) {
        if (gates[i].s < P.s - 120) { disposeGate(gates[i]); gates.splice(i, 1); }
      }
      // tilt sensor liveness
      if (settings.control === "tilt" && motionActive) {
        const snap = ctx.motion.snapshot;
        const at = (snap ? snap.atMs : 0) + (tilt ? (Number(tilt.x) || 0) * 1e3 + (Number(tilt.y) || 0) * 7e3 : 0);
        if (at !== motionLastAt) { motionLastAt = at; motionStale = 0; } else motionStale += dt;
        if (motionStale > 3) { motionStale = 0; fallbackToTouch("Motion sensor not responding — drag to steer"); }
      }
    }
    // Gentle capture toward the next opening when the player is already close to
    // the right line and bank. Collision stays exact; this only smooths tilt noise.
    function applyAlignmentAssist(dt) {
      if (CFG.assist <= 0) return;
      let g = null;
      for (const q of gates) { if (q.intact && !q.passed) { g = q; break; } }
      if (!g) return;
      const dist = g.front - P.s;
      if (dist > 80 || dist < -PLANE_NOSE) return;
      const capU = 1.2 + g.ap.m * 2.2, capV = 1.0 + g.ap.m * 2.0, capB = g.ap.bt * 1.9;
      const du = g.ou - P.u, dv = g.gy - P.y, db = g.rho - P.bank;
      if (Math.abs(du) > capU || Math.abs(dv) > capV || Math.abs(db) > capB) return;
      const prox = smoothstep(80, 18, dist);
      const w = CFG.assist * prox * (1 - 0.6 * Math.max(Math.abs(du) / capU, Math.abs(dv) / capV, Math.abs(db) / capB));
      if (w <= 0) return;
      const k = (3.2 + 2.2 * smoothstep(40, 10, dist)) * w * dt;
      P.u += du * k; P.vu *= 1 - Math.min(1, 2.4 * w * dt);
      P.y += dv * k; P.vy *= 1 - Math.min(1, 2.4 * w * dt);
      P.bank += db * k;
    }
    function autopilot(dt) {
      const V = CFG.baseSpeed * 0.85;
      P.speed = V;
      const k = sampleAt(track.k, P.s);
      const want = -1.2 * P.u - 2.2 * P.vu + k * V * V + CFG.latDamp * P.vu;
      const bankT = Math.asin(clamp(want / CFG.liftAccel, -0.8, 0.8));
      P.bank += clamp((bankT - P.bank) * 3 * dt, -1.5 * dt, 1.5 * dt);
      const au = CFG.liftAccel * Math.sin(P.bank) - k * V * V - CFG.latDamp * P.vu;
      P.vu += au * dt; P.u += P.vu * dt;
      const cy = sampleAt(track.cy, P.s);
      P.vy += ((cy - P.y) * 0.8 - P.vy) * 2 * dt;
      P.y += P.vy * dt;
      P.s += V * dt;
      ensureTrack(P.s + 1000);
      if (P.s > 1200) trimTrack(P.s - 500);
    }

    // =====================================================================
    // Three.js scene
    // =====================================================================
    let THREE = null, renderer = null, scene = null, camera = null;
    let gfxReady = false;
    let plane = null, planeParts = null;
    let v3a = null, v3b = null, UP = null;
    const cam = { u: 0, y: 32, init: false, orbit: 0, fov: 70 };
    let muzzleT = 0;
    const mats = {};
    const tex = {};
    let skyMesh = null, groundMesh = null, mountains = null, speedLines = null, clouds = [];
    let chunkPool = [], activeChunks = new Map();
    let fragMesh = null, frags = [], tracerMesh = null, flashes = [], puffs = [], shockwaves = [];
    const enemyPool = [], missilePool = [];

    function makeCanvasTex(w, h, draw, repeat) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      draw(g, w, h);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      t.anisotropy = 4;
      return t;
    }
    function buildTextures() {
      tex.panel = makeCanvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#59606c"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) { g.fillStyle = "rgba(255,255,255," + (Math.random() * 0.05) + ")"; g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 60, Math.random() * 30); }
        g.strokeStyle = "rgba(10,12,18,.75)"; g.lineWidth = 3;
        g.strokeRect(2, 2, w - 4, h - 4);
        g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.5); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.5, h * 0.5); g.stroke();
        g.fillStyle = "rgba(10,12,18,.6)";
        for (const [x, y] of [[12, 12], [w - 16, 12], [12, h - 16], [w - 16, h - 16]]) g.fillRect(x, y, 4, 4);
      }, true);
      tex.gate = makeCanvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#c9d0da"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { g.fillStyle = "rgba(40,50,70," + (Math.random() * 0.06) + ")"; g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 70, Math.random() * 30); }
        g.strokeStyle = "rgba(40,48,64,.55)"; g.lineWidth = 3;
        g.strokeRect(2, 2, w - 4, h - 4);
        g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.5); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.5, h); g.stroke();
        g.fillStyle = "rgba(255,120,40,.85)"; g.fillRect(10, 10, 22, 6); g.fillRect(w - 32, h - 16, 22, 6);
      }, true);
      tex.floor = makeCanvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#2b303b"; g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(120,200,255,.18)"; g.lineWidth = 2;
        g.strokeRect(1, 1, w - 2, h - 2);
        g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
        g.fillStyle = "rgba(255,190,90,.55)"; g.fillRect(w / 2 - 3, 20, 6, 60);
      }, true);
      tex.chev = makeCanvasTex(128, 64, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#fff";
        g.beginPath(); g.moveTo(20, 6); g.lineTo(64, 32); g.lineTo(20, 58); g.lineTo(42, 58); g.lineTo(86, 32); g.lineTo(42, 6); g.closePath(); g.fill();
      }, true);
      tex.hazard = makeCanvasTex(128, 128, (g, w, h) => {
        g.fillStyle = "#2a2d33"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#d89a2a";
        for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + h, h); g.lineTo(i * 32 + h, h); g.closePath(); g.fill(); }
        g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 0, w, 6);
      }, true);
      tex.glow = makeCanvasTex(128, 128, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, false);
      tex.smoke = makeCanvasTex(128, 128, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, "rgba(220,220,230,.8)"); gr.addColorStop(0.6, "rgba(160,160,175,.35)"); gr.addColorStop(1, "rgba(120,120,140,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, false);
      tex.ground = makeCanvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#3a2f3a"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 400; i++) { g.fillStyle = "rgba(" + (Math.random() < 0.5 ? "255,220,200" : "20,10,30") + "," + Math.random() * 0.08 + ")"; g.fillRect(Math.random() * w, Math.random() * h, 8, 8); }
        g.strokeStyle = "rgba(255,170,120,.12)"; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
      }, true);
    }
    function buildMaterials() {
      mats.wall = new THREE.MeshStandardMaterial({ map: tex.panel, color: 0xb4bfcf, emissive: 0x1a2436, emissiveIntensity: 1, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide });
      tex.panel.repeat.set(1, 1);
      mats.floor = new THREE.MeshStandardMaterial({ map: tex.floor, color: 0xc4cad8, emissive: 0x141a28, emissiveIntensity: 1, roughness: 0.85, metalness: 0.1 });
      mats.glow = new THREE.MeshBasicMaterial({ color: 0x46e6ff, toneMapped: false, side: THREE.DoubleSide });
      mats.glowSoft = new THREE.MeshBasicMaterial({ color: 0x2a8fb8, toneMapped: false, side: THREE.DoubleSide });
      mats.chev = new THREE.MeshBasicMaterial({ map: tex.chev, color: 0xffb347, vertexColors: true, toneMapped: false, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      mats.beam = new THREE.MeshStandardMaterial({ color: 0x3b414c, roughness: 0.5, metalness: 0.7 });
      mats.beamLight = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false });
      // Gate faces are bright and matte so the dark fighter-shaped hole reads from far away.
      mats.gateFace = new THREE.MeshStandardMaterial({ map: tex.gate, color: 0xffffff, emissive: 0x6d7a8e, emissiveIntensity: 0.55, roughness: 0.75, metalness: 0.05 });
      mats.gateSide = new THREE.MeshStandardMaterial({ color: 0x163040, emissive: 0x1fa8c8, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.1 });
      mats.gateRim = new THREE.MeshBasicMaterial({ color: 0x7cf6ff, toneMapped: false });
      mats.reinfFace = new THREE.MeshStandardMaterial({ map: tex.hazard, color: 0xffffff, emissive: 0x6a4a1a, emissiveIntensity: 0.6, roughness: 0.7, metalness: 0.1 });
      mats.reinfSide = new THREE.MeshStandardMaterial({ color: 0x2d2416, emissive: 0xc07a1a, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.1 });
      mats.reinfRim = new THREE.MeshBasicMaterial({ color: 0xffb02e, toneMapped: false });
      mats.body = new THREE.MeshStandardMaterial({ color: 0x8f9aab, roughness: 0.42, metalness: 0.55 });
      mats.bodyDark = new THREE.MeshStandardMaterial({ color: 0x2c323d, roughness: 0.55, metalness: 0.5 });
      mats.canopy = new THREE.MeshStandardMaterial({ color: 0x0b1d2b, emissive: 0x0a3a50, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.9 });
      mats.nozzle = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
      mats.exhaust = new THREE.MeshBasicMaterial({ color: 0xff7a2d, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      mats.exhaustCore = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      mats.stripe = new THREE.MeshBasicMaterial({ color: 0x46e6ff, toneMapped: false });
      mats.navR = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
      mats.navG = new THREE.MeshBasicMaterial({ color: 0x30ff70, toneMapped: false });
      mats.enemyBody = new THREE.MeshStandardMaterial({ color: 0x3a2328, roughness: 0.45, metalness: 0.6, emissive: 0x000000 });
      mats.enemyGlow = new THREE.MeshBasicMaterial({ color: 0xff4040, toneMapped: false });
      mats.tracer = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      mats.frag = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4 });
      mats.missile = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.35, metalness: 0.5 });
      mats.ground = new THREE.MeshStandardMaterial({ map: tex.ground, color: 0x8a7a88, roughness: 0.95, metalness: 0 });
      tex.ground.repeat.set(160, 160);
      mats.shock = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    }

    // ----- aircraft model (dimensions match PLANE_POINTS) -----
    function buildPlaneModel(enemy) {
      const grp = new THREE.Group();
      const body = enemy ? mats.enemyBody : mats.body;
      const dark = enemy ? mats.enemyBody : mats.bodyDark;
      // fuselage (lathe along z, nose at -z)
      const prof = [[0, -5.2], [0.22, -4.5], [0.4, -3.3], [0.5, -1.6], [0.53, 0.5], [0.5, 2.6], [0.42, 4.3], [0.36, 4.6]].map((p) => new THREE.Vector2(p[0], p[1]));
      const fus = new THREE.LatheGeometry(prof, 18);
      fus.rotateX(Math.PI / 2);
      fus.scale(1.05, 0.95, 1);
      const fusM = new THREE.Mesh(fus, body);
      grp.add(fusM);
      // canopy
      const can = new THREE.SphereGeometry(1, 16, 10);
      can.scale(0.27, 0.32, 1.35);
      const canM = new THREE.Mesh(can, enemy ? mats.enemyGlow : mats.canopy);
      canM.position.set(0, 0.5, -2.3);
      grp.add(canM);
      // engines / intakes
      for (const sx of [-1, 1]) {
        const eng = new THREE.CylinderGeometry(0.28, 0.3, 4.6, 12);
        eng.rotateX(Math.PI / 2);
        const em = new THREE.Mesh(eng, dark);
        em.position.set(sx * 0.34, -0.26, 2.1);
        grp.add(em);
        const intake = new THREE.BoxGeometry(0.42, 0.42, 1.6);
        const im = new THREE.Mesh(intake, dark);
        im.position.set(sx * 0.4, -0.28, -0.9);
        grp.add(im);
        const noz = new THREE.TorusGeometry(0.24, 0.06, 6, 14);
        const nm = new THREE.Mesh(noz, enemy ? mats.enemyGlow : mats.nozzle);
        nm.position.set(sx * 0.34, -0.26, 4.42);
        grp.add(nm);
      }
      // wings: swept planform in x/z, thin, with anhedral matching WING
      const wingShape = new THREE.Shape();
      // player: swept delta; enemy: forward-swept wings for a distinct silhouette
      const wpts = enemy
        ? [[0.4, 0.9], [3.6, -0.5], [3.6, 0.4], [0.4, 3.0]]
        : [[0.4, -1.7], [3.6, 1.5], [3.6, 2.35], [0.4, 3.1]];
      wingShape.moveTo(-wpts[0][0], wpts[0][1]);
      wingShape.lineTo(-wpts[1][0], wpts[1][1]);
      wingShape.lineTo(-wpts[2][0], wpts[2][1]);
      wingShape.lineTo(-wpts[3][0], wpts[3][1]);
      wingShape.lineTo(wpts[3][0], wpts[3][1]);
      wingShape.lineTo(wpts[2][0], wpts[2][1]);
      wingShape.lineTo(wpts[1][0], wpts[1][1]);
      wingShape.lineTo(wpts[0][0], wpts[0][1]);
      const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: false });
      wing.rotateX(Math.PI / 2); // shape y -> z
      const wp = wing.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        const x = wp.getX(i);
        const ax = Math.max(0, Math.abs(x) - WING.rootX);
        const t = ax / (WING.tipX - WING.rootX);
        const yc = lerp(WING.rootY, WING.tipY, t);
        const half = lerp(WING.rootT, WING.tipT, t);
        wp.setY(i, yc + (wp.getY(i) > -0.08 ? half : -half) * 0.8);
      }
      wing.computeVertexNormals();
      grp.add(new THREE.Mesh(wing, body));
      // twin canted fins (enemy: single fin)
      const finShape = new THREE.Shape();
      const fh = Math.hypot(FIN.tipX - FIN.rootX, FIN.tipY - FIN.rootY);
      finShape.moveTo(1.9, 0); finShape.lineTo(4.3, 0); finShape.lineTo(4.45, fh); finShape.lineTo(3.55, fh); finShape.closePath();
      const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: FIN.t * 1.6, bevelEnabled: false });
      finGeo.translate(0, 0, -FIN.t * 0.8);
      finGeo.rotateY(-Math.PI / 2); // shape x -> z (along fuselage), extrude along x
      const cant = Math.atan2(FIN.tipX - FIN.rootX, FIN.tipY - FIN.rootY);
      const finSides = enemy ? [0] : [-1, 1];
      for (const sx of finSides) {
        const fm = new THREE.Mesh(finGeo, body);
        fm.position.set(sx * FIN.rootX, FIN.rootY, 0);
        fm.rotation.z = -sx * cant;
        grp.add(fm);
      }
      // horizontal stabilisers in the wing plane
      const stab = new THREE.BoxGeometry(3.2, 0.08, 1.1);
      const sm = new THREE.Mesh(stab, dark);
      sm.position.set(0, -0.2, 4.0);
      grp.add(sm);
      // spine stripe + nav lights
      if (!enemy) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 3.2), mats.stripe);
        stripe.position.set(0, 0.49, 1.6);
        grp.add(stripe);
      }
      const navL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), enemy ? mats.enemyGlow : mats.navR);
      navL.position.set(-WING.tipX, WING.tipY, 1.9);
      const navR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), enemy ? mats.enemyGlow : mats.navG);
      navR.position.set(WING.tipX, WING.tipY, 1.9);
      grp.add(navL, navR);
      // exhaust plumes
      const plumes = [];
      for (const sx of [-1, 1]) {
        const cone = new THREE.ConeGeometry(0.24, 1.9, 12, 1, true);
        cone.rotateX(Math.PI / 2);
        cone.translate(0, 0, 0.95);
        const pm = new THREE.Mesh(cone, enemy ? mats.enemyGlow : mats.exhaust);
        pm.position.set(sx * 0.34, -0.26, 4.45);
        grp.add(pm);
        const core = new THREE.ConeGeometry(0.12, 1.3, 10, 1, true);
        core.rotateX(Math.PI / 2);
        core.translate(0, 0, 0.65);
        const cm = new THREE.Mesh(core, enemy ? mats.enemyGlow : mats.exhaustCore);
        cm.position.copy(pm.position);
        grp.add(cm);
        plumes.push(pm, cm);
        if (!enemy) {
          const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xff9a50, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
          gl.scale.set(1.3, 1.3, 1);
          gl.position.set(sx * 0.34, -0.26, 4.6);
          grp.add(gl);
        }
      }
      if (enemy) grp.scale.set(0.95, 0.95, 0.95);
      return { grp, plumes, navL, navR };
    }

    // ----- generic strip geometry for corridor chunks -----
    function makeStripGeom(strips, withColor) {
      const rows = CHUNK_N + 1;
      const vcount = strips * rows * 2;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(vcount * 2), 2));
      if (withColor) geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      const idx = [];
      for (let s = 0; s < strips; s++) {
        for (let r = 0; r < CHUNK_N; r++) {
          const a = (s * rows + r) * 2, b = a + 1, c = a + 2, d = a + 3;
          idx.push(a, b, c, b, d, c);
        }
      }
      geo.setIndex(idx);
      geo.userData.rows = rows;
      return geo;
    }
    function setV(geo, strip, row, side, x, y, z, nx, ny, nz, u, v, col) {
      const i = (strip * geo.userData.rows + row) * 2 + side;
      const P3 = geo.attributes.position.array, N3 = geo.attributes.normal.array, U2 = geo.attributes.uv.array;
      P3[i * 3] = x; P3[i * 3 + 1] = y; P3[i * 3 + 2] = z;
      N3[i * 3] = nx; N3[i * 3 + 1] = ny; N3[i * 3 + 2] = nz;
      U2[i * 2] = u; U2[i * 2 + 1] = v;
      if (col !== undefined) { const C3 = geo.attributes.color.array; C3[i * 3] = col; C3[i * 3 + 1] = col; C3[i * 3 + 2] = col; }
    }
    function finishGeom(geo) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
      geo.attributes.uv.needsUpdate = true;
      if (geo.attributes.color) geo.attributes.color.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    function createChunk() {
      const ch = { c: -1 };
      ch.floor = new THREE.Mesh(makeStripGeom(1, false), mats.floor);
      ch.walls = new THREE.Mesh(makeStripGeom(2, false), mats.wall);
      ch.glow = new THREE.Mesh(makeStripGeom(4, false), mats.glow);
      ch.chev = new THREE.Mesh(makeStripGeom(2, true), mats.chev);
      ch.beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.beam, 5);
      ch.lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.beamLight, 5);
      ch.group = new THREE.Group();
      ch.group.add(ch.floor, ch.walls, ch.glow, ch.chev, ch.beams, ch.lights);
      ch.beams.frustumCulled = false; ch.lights.frustumCulled = false;
      scene.add(ch.group);
      return ch;
    }
    const mtx = { m: null, q: null, p: null, s: null };
    function buildChunk(ch, c) {
      ch.c = c;
      const base = c * CHUNK_N - track.base;
      for (let r = 0; r <= CHUNK_N; r++) {
        const i = clamp(base + r, 0, track.x.length - 1);
        const s = (c * CHUNK_N + r) * DS;
        const x = track.x[i], z = track.z[i], th = track.th[i], cy = track.cy[i], hw = track.hw[i], hh = track.hh[i], op = track.op[i];
        const rx = Math.cos(th), rz = Math.sin(th);
        const fy = lerp(cy - hh, -6, op);
        const top = lerp(cy + hh, fy, op);
        const lx = x - rx * hw, lz = z - rz * hw, Rx = x + rx * hw, Rz = z + rz * hw;
        const fw = hw + 0.6;
        // floor
        setV(ch.floor.geometry, 0, r, 0, x - rx * fw, fy, z - rz * fw, 0, 1, 0, 0, s / 10);
        setV(ch.floor.geometry, 0, r, 1, x + rx * fw, fy, z + rz * fw, 0, 1, 0, (fw * 2) / 10, s / 10);
        // walls (normals face the corridor)
        setV(ch.walls.geometry, 0, r, 0, lx, fy, lz, rx, 0, rz, s / 12, 0);
        setV(ch.walls.geometry, 0, r, 1, lx, top, lz, rx, 0, rz, s / 12, (top - fy) / 12);
        setV(ch.walls.geometry, 1, r, 0, Rx, top, Rz, -rx, 0, -rz, s / 12, (top - fy) / 12);
        setV(ch.walls.geometry, 1, r, 1, Rx, fy, Rz, -rx, 0, -rz, s / 12, 0);
        // glow strips: floor edges + wall tops
        const e = 0.04, gw = 0.55;
        setV(ch.glow.geometry, 0, r, 0, lx + rx * e, fy + 0.03, lz + rz * e, 0, 1, 0, 0, 0);
        setV(ch.glow.geometry, 0, r, 1, lx + rx * gw, fy + 0.03, lz + rz * gw, 0, 1, 0, 0, 0);
        setV(ch.glow.geometry, 1, r, 0, Rx - rx * gw, fy + 0.03, Rz - rz * gw, 0, 1, 0, 0, 0);
        setV(ch.glow.geometry, 1, r, 1, Rx - rx * e, fy + 0.03, Rz - rz * e, 0, 1, 0, 0, 0);
        const tb = Math.max(fy, top - 0.35 * (1 - op));
        setV(ch.glow.geometry, 2, r, 0, lx + rx * e, tb, lz + rz * e, rx, 0, rz, 0, 0);
        setV(ch.glow.geometry, 2, r, 1, lx + rx * e, top, lz + rz * e, rx, 0, rz, 0, 0);
        setV(ch.glow.geometry, 3, r, 0, Rx - rx * e, top, Rz - rz * e, -rx, 0, -rz, 0, 0);
        setV(ch.glow.geometry, 3, r, 1, Rx - rx * e, tb, Rz - rz * e, -rx, 0, -rz, 0, 0);
        // turn-warning chevrons on the outside wall
        const ia = clamp(i + 30, 0, track.k.length - 1);
        const kA = Math.abs(track.k[ia]) > Math.abs(track.k[i]) ? track.k[ia] : track.k[i];
        const leftI = smoothstep(0.0005, 0.0022, kA) * (1 - op);
        const rightI = smoothstep(0.0005, 0.0022, -kA) * (1 - op);
        const b0 = Math.min(fy + hh * 0.55, top), b1 = Math.min(fy + hh * 0.55 + 2.6, top);
        const ce = 0.07;
        setV(ch.chev.geometry, 0, r, 0, lx + rx * ce, b0, lz + rz * ce, rx, 0, rz, s / 6, 0, leftI);
        setV(ch.chev.geometry, 0, r, 1, lx + rx * ce, b1, lz + rz * ce, rx, 0, rz, s / 6, 1, leftI);
        setV(ch.chev.geometry, 1, r, 0, Rx - rx * ce, b1, Rz - rz * ce, -rx, 0, -rz, s / 6, 1, rightI);
        setV(ch.chev.geometry, 1, r, 1, Rx - rx * ce, b0, Rz - rz * ce, -rx, 0, -rz, s / 6, 0, rightI);
      }
      finishGeom(ch.floor.geometry); finishGeom(ch.walls.geometry); finishGeom(ch.glow.geometry); finishGeom(ch.chev.geometry);
      // ceiling beams
      for (let b = 0; b < 5; b++) {
        const i = clamp(base + b * 12, 0, track.x.length - 1);
        const op = track.op[i];
        const th = track.th[i], cy = track.cy[i], hh = track.hh[i], hw = track.hw[i];
        mtx.q.setFromAxisAngle(UP, -th);
        if (op < 0.08) {
          mtx.p.set(track.x[i], cy + hh + 0.3, track.z[i]);
          mtx.s.set(hw * 2 + 1.2, 0.7, 1.2);
          mtx.m.compose(mtx.p, mtx.q, mtx.s);
          ch.beams.setMatrixAt(b, mtx.m);
          mtx.p.y = cy + hh - 0.08;
          mtx.s.set(hw * 1.7, 0.1, 0.3);
          mtx.m.compose(mtx.p, mtx.q, mtx.s);
          ch.lights.setMatrixAt(b, mtx.m);
        } else {
          mtx.s.set(0, 0, 0); mtx.p.set(0, -999, 0);
          mtx.m.compose(mtx.p, mtx.q, mtx.s);
          ch.beams.setMatrixAt(b, mtx.m); ch.lights.setMatrixAt(b, mtx.m);
        }
      }
      ch.beams.instanceMatrix.needsUpdate = true;
      ch.lights.instanceMatrix.needsUpdate = true;
      ch.group.visible = true;
    }
    function resetChunks() {
      for (const ch of activeChunks.values()) { ch.group.visible = false; ch.c = -1; chunkPool.push(ch); }
      activeChunks.clear();
    }
    function updateChunks() {
      const cMin = Math.max(0, Math.floor((P.s - 140) / (CHUNK_N * DS)));
      const cMax = Math.floor((P.s + 820) / (CHUNK_N * DS));
      for (const [c, ch] of activeChunks) {
        if (c < cMin || c > cMax) { ch.group.visible = false; ch.c = -1; chunkPool.push(ch); activeChunks.delete(c); }
      }
      for (let c = cMin; c <= cMax; c++) {
        if (activeChunks.has(c)) continue;
        if ((c + 1) * CHUNK_N - track.base >= track.x.length) continue;
        const ch = chunkPool.pop() || createChunk();
        buildChunk(ch, c);
        activeChunks.set(c, ch);
      }
    }

    // ----- gates -----
    function buildGateMesh(g) {
      const shape = new THREE.Shape();
      const ext = g.hw + 1.4;
      const fy = g.cy - g.hh - 0.4 - g.cy, ty = g.cy + g.hh + 0.4 - g.cy;
      shape.moveTo(-ext, fy); shape.lineTo(ext, fy); shape.lineTo(ext, ty); shape.lineTo(-ext, ty); shape.lineTo(-ext, fy);
      const c = Math.cos(g.rho), s = Math.sin(g.rho);
      const tr = (p) => [g.ou + p[0] * c + p[1] * s, g.ov - p[0] * s + p[1] * c];
      const hole = new THREE.Path();
      g.ap.contour.forEach((p, i) => { const q = tr(p); if (i === 0) hole.moveTo(q[0], q[1]); else hole.lineTo(q[0], q[1]); });
      hole.closePath();
      shape.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: GATE_T, bevelEnabled: false, curveSegments: 1 });
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 9, uv.getY(i) / 9);
      const slab = new THREE.Mesh(geo, g.reinforced ? [mats.reinfFace, mats.reinfSide] : [mats.gateFace, mats.gateSide]);
      // glowing rim around the opening
      const rimShape = new THREE.Shape();
      g.rim.contour.forEach((p, i) => { const q = tr(p); if (i === 0) rimShape.moveTo(q[0], q[1]); else rimShape.lineTo(q[0], q[1]); });
      rimShape.closePath();
      const rimHole = new THREE.Path();
      g.ap.contour.forEach((p, i) => { const q = tr(p); if (i === 0) rimHole.moveTo(q[0], q[1]); else rimHole.lineTo(q[0], q[1]); });
      rimHole.closePath();
      rimShape.holes.push(rimHole);
      const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.22, bevelEnabled: false, curveSegments: 1 });
      const rim = new THREE.Mesh(rimGeo, g.reinforced ? mats.reinfRim : mats.gateRim);
      rim.position.z = GATE_T;
      const grp = new THREE.Group();
      grp.add(slab, rim);
      trackPos(g.s, 0, g.cy, v3a);
      grp.position.set(v3a.x, v3a.y, v3a.z);
      grp.rotation.set(0, -g.th, 0);
      scene.add(grp);
      g.mesh = grp;
    }
    function disposeGateMesh(g) {
      if (!g.mesh) return;
      g.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      g.mesh = null;
    }
    function disposeGate(g) {
      if (g.mesh && scene) scene.remove(g.mesh);
      disposeGateMesh(g);
    }

    // ----- enemies & missiles meshes (pooled) -----
    function acquireEnemy(e) {
      if (gfxReady) {
        let m = enemyPool.pop();
        if (!m) m = buildPlaneModel(true);
        scene.add(m.grp);
        m.grp.visible = true;
        e.mesh = m;
      }
      return e;
    }
    function releaseEnemy(e) {
      if (e.mesh) { scene.remove(e.mesh.grp); enemyPool.push(e.mesh); e.mesh = null; }
    }
    function makeMissileMesh() {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8), mats.missile);
      body.rotation.x = Math.PI / 2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffb347, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.set(2.2, 2.2, 1);
      glow.position.z = 1.3;
      grp.add(body, glow);
      grp.userData.glow = glow;
      return grp;
    }
    function releaseMissile(m) {
      if (m.mesh) { m.mesh.visible = false; scene.remove(m.mesh); missilePool.push(m.mesh); m.mesh = null; }
    }

    // ----- FX -----
    function initFx() {
      fragMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.frag, 160);
      fragMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fragMesh.frustumCulled = false;
      const col = new THREE.Color(0xffffff);
      for (let i = 0; i < 160; i++) { fragMesh.setColorAt(i, col); }
      scene.add(fragMesh);
      tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 5), mats.tracer, 60);
      tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      tracerMesh.frustumCulled = false;
      scene.add(tracerMesh);
      for (let i = 0; i < 10; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
        sp.visible = false; scene.add(sp); flashes.push({ sp, t: 0, life: 0, size: 1 });
      }
      for (let i = 0; i < 70; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.smoke, color: 0xcfd3dc, depthWrite: false, transparent: true }));
        sp.visible = false; scene.add(sp); puffs.push({ sp, t: 0, life: 0, size: 1, vx: 0, vy: 0, vz: 0 });
      }
      for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 40), mats.shock.clone());
        m.visible = false; scene.add(m); shockwaves.push({ m, t: 0 });
      }
      // speed lines live in camera space
      const sl = new THREE.BufferGeometry();
      sl.setAttribute("position", new THREE.BufferAttribute(new Float32Array(36 * 2 * 3), 3));
      speedLines = new THREE.LineSegments(sl, new THREE.LineBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      speedLines.frustumCulled = false;
      speedLines.userData.pts = [];
      for (let i = 0; i < 36; i++) speedLines.userData.pts.push({ a: Math.random() * 6.28, r: 3 + Math.random() * 7, z: -Math.random() * 90 });
      camera.add(speedLines);
      // muzzle flashes
      muzzle = [];
      for (const sx of [-1, 1]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        sp.scale.set(1.2, 1.2, 1); sp.position.set(sx * 0.9, -0.05, -3.2); sp.visible = false;
        plane.add(sp); muzzle.push(sp);
      }
    }
    let muzzle = [];
    // Ghost: the jet's frontal silhouette projected onto the next wall at the
    // current line and bank — green if it would fit, red if it would clip.
    let ghost = null;
    function initGhost() {
      const sil = getAperture(0.03, 0).contour;
      const shape = new THREE.Shape();
      sil.forEach((p, i) => { if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]); });
      shape.closePath();
      const mat = new THREE.MeshBasicMaterial({ color: 0x6dff9e, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sil.map((p) => new THREE.Vector3(p[0], p[1], 0.01))), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, toneMapped: false }));
      const inner = new THREE.Group(); inner.add(mesh, outline);
      const grp = new THREE.Group(); grp.add(inner);
      grp.visible = false; grp.renderOrder = 5;
      scene.add(grp);
      ghost = { grp, inner, mat };
    }
    const ghostPt = { x: 0, y: 0 };
    function updateGhost() {
      if (!ghost) return;
      let g = null;
      for (const q of gates) { if (q.intact && !q.passed) { g = q; break; } }
      const d = g ? g.front - P.s : Infinity;
      if (!g || d > 230 || d < 1 || state !== "play") { ghost.grp.visible = false; return; }
      let fits = true;
      for (const p of PLANE_POINTS) { gateLocal(g, p, ghostPt); if (apField(g.ap, ghostPt.x, ghostPt.y) > 0) { fits = false; break; } }
      trackPos(g.s, 0, g.cy, v3b);
      ghost.grp.position.copy(v3b);
      ghost.grp.rotation.set(0, -g.th, 0);
      ghost.inner.position.set(P.u, P.y - g.cy, GATE_T + 0.26);
      ghost.inner.rotation.set(0, 0, -P.bank);
      ghost.mat.color.setHex(fits ? 0x6dff9e : 0xff5050);
      ghost.mat.opacity = 0.3 + 0.35 * smoothstep(230, 90, d);
      ghost.grp.visible = true;
    }
    function clearFx() {
      for (const f of frags) f.life = 0;
      for (const f of flashes) { f.life = 0; f.sp.visible = false; }
      for (const p of puffs) { p.life = 0; p.sp.visible = false; }
      for (const s of shockwaves) s.m.visible = false;
      for (const m of missiles) releaseMissile(m);
    }
    function spawnFlash(x, y, z, size, color, life) {
      const f = flashes.find((q) => q.life <= 0) || flashes[0];
      f.sp.position.set(x, y, z); f.sp.material.color.setHex(color); f.size = size; f.t = 0; f.life = life || 0.5; f.sp.visible = true;
    }
    function spawnPuff(x, y, z, size, life, vx, vy, vz, color) {
      const p = puffs.find((q) => q.life <= 0);
      if (!p) return;
      p.sp.position.set(x, y, z); p.size = size; p.t = 0; p.life = life; p.vx = vx || 0; p.vy = vy || 0; p.vz = vz || 0;
      p.sp.material.color.setHex(color || 0xcfd3dc); p.sp.visible = true;
    }
    function spawnFrag(x, y, z, vx, vy, vz, sx, sy, sz, color, life) {
      if (frags.length >= 160) frags.shift();
      frags.push({ x, y, z, vx, vy, vz, sx, sy, sz, rx: Math.random() * 6, ry: Math.random() * 6, wr: (Math.random() - 0.5) * 10, color, life, t: 0 });
    }
    function spawnExplosion(x, y, z, scale, color, nFrag) {
      spawnFlash(x, y, z, 9 * scale, color, 0.45);
      spawnFlash(x, y, z, 4 * scale, 0xffffff, 0.2);
      for (let i = 0; i < 6 * scale; i++) spawnPuff(x + rr(-1, 1) * scale, y + rr(-1, 1) * scale, z + rr(-1, 1) * scale, rr(3, 6) * scale, rr(0.8, 1.4), rr(-4, 4), rr(0, 4), rr(-4, 4), 0x6a6670);
      for (let i = 0; i < nFrag; i++) {
        const a = Math.random() * 6.28, b = rr(-0.6, 1);
        const sp = rr(8, 26) * scale;
        spawnFrag(x, y, z, Math.cos(a) * sp, b * sp, Math.sin(a) * sp, rr(0.2, 0.6), rr(0.1, 0.3), rr(0.3, 0.8), Math.random() < 0.5 ? 0x3a3f48 : 0xff9040, rr(0.8, 1.4));
      }
      run.shake = Math.max(run.shake, 0.15 * scale);
    }
    function spawnSpark(x, y, z, color) {
      spawnFlash(x, y, z, 1.2, color, 0.12);
    }
    function spawnShockwave(x, y, z) {
      const s = shockwaves.find((q) => !q.m.visible) || shockwaves[0];
      s.m.position.set(x, y, z); s.t = 0; s.m.visible = true;
      s.m.lookAt(camera.position);
    }
    function spawnGateDebris(g) {
      const fx = Math.sin(g.th), fz = -Math.cos(g.th), rx = Math.cos(g.th), rz = Math.sin(g.th);
      const n = 26;
      for (let i = 0; i < n; i++) {
        const u = rr(-g.hw, g.hw), y = g.cy + rr(-g.hh, g.hh);
        trackPos(g.s - GATE_T * 0.5, u, y, v3a);
        const out = (u - g.ou) * 0.6;
        const fwd = rr(18, 40);
        spawnFrag(v3a.x, v3a.y, v3a.z, fx * fwd + rx * out, rr(2, 10) + (y - g.gy) * 0.8, fz * fwd + rz * out, rr(1, 3), rr(0.8, 2.4), rr(0.4, 1.4), g.reinforced ? 0xb07a2a : 0x6c7686, rr(1.2, 1.8));
      }
      trackPos(g.s - GATE_T, g.ou, g.gy, v3a);
      spawnFlash(v3a.x, v3a.y, v3a.z, 22, g.reinforced ? 0xffb02e : 0x7cf6ff, 0.5);
    }
    function updateFx(dt) {
      // fragments
      for (let i = frags.length - 1; i >= 0; i--) {
        const f = frags[i];
        f.t += dt;
        if (f.t >= f.life) { frags.splice(i, 1); continue; }
        f.vy -= 18 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.rx += f.wr * dt; f.ry += f.wr * 0.7 * dt;
      }
      const col = fxColor;
      for (let i = 0; i < 160; i++) {
        const f = frags[i];
        if (f) {
          const k = 1 - smoothstep(0.7, 1, f.t / f.life);
          mtx.p.set(f.x, f.y, f.z);
          mtx.q.setFromEuler(fxEuler.set(f.rx, f.ry, 0));
          mtx.s.set(f.sx * k, f.sy * k, f.sz * k);
          col.setHex(f.color);
          fragMesh.setColorAt(i, col);
        } else {
          mtx.p.set(0, -999, 0); mtx.s.set(0, 0, 0);
        }
        mtx.m.compose(mtx.p, mtx.q, mtx.s);
        fragMesh.setMatrixAt(i, mtx.m);
      }
      fragMesh.instanceMatrix.needsUpdate = true;
      if (fragMesh.instanceColor) fragMesh.instanceColor.needsUpdate = true;
      for (const f of flashes) {
        if (f.life <= 0) continue;
        f.t += dt;
        const k = f.t / f.life;
        if (k >= 1) { f.life = 0; f.sp.visible = false; continue; }
        const sc = f.size * (0.6 + 0.8 * Math.sqrt(k));
        f.sp.scale.set(sc, sc, 1);
        f.sp.material.opacity = 1 - k;
      }
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) { p.life = 0; p.sp.visible = false; continue; }
        p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt;
        const sc = p.size * (0.5 + k);
        p.sp.scale.set(sc, sc, 1);
        p.sp.material.opacity = 0.55 * (1 - k);
      }
      for (const s of shockwaves) {
        if (!s.m.visible) continue;
        s.t += dt;
        const k = s.t / 0.7;
        if (k >= 1) { s.m.visible = false; continue; }
        const sc = 4 + 46 * Math.sqrt(k);
        s.m.scale.set(sc, sc, sc);
        s.m.material.opacity = 0.8 * (1 - k);
      }
    }
    let fxColor = null, fxEuler = null;
    function isBehind(pos) {
      const th = sampleAt(track.th, P.s);
      return (pos.x - camera.position.x) * Math.sin(th) - (pos.z - camera.position.z) * Math.cos(th) < -40;
    }

    function buildScene() {
      scene = new THREE.Scene();
      const fogCol = new THREE.Color(0x6e5068);
      scene.fog = new THREE.Fog(fogCol, 160, 760);
      camera = new THREE.PerspectiveCamera(70, Math.max(0.3, ctx.width / Math.max(1, ctx.height)), 0.3, 6000);
      scene.add(camera);
      // sky
      const skyGeo = new THREE.SphereGeometry(4000, 32, 16);
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x0a1230) }, mid: { value: new THREE.Color(0x2e3a73) },
          horizon: { value: fogCol.clone() }, glow: { value: new THREE.Color(0xff8a4a) },
          sunDir: { value: new THREE.Vector3(0.35, 0.12, -0.93).normalize() }
        },
        vertexShader: "varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }",
        fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir; void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h)); col = mix(col, top, smoothstep(0.28, 0.95, h)); if (h < 0.0) col = horizon * 0.85; float sd = max(dot(d, sunDir), 0.0); col += glow * (pow(sd, 8.0) * 0.55 * (1.0 - smoothstep(0.0, 0.5, h))); col += vec3(1.0, 0.85, 0.6) * pow(sd, 900.0) * 3.0; gl_FragColor = vec4(col, 1.0); }"
      });
      skyMesh = new THREE.Mesh(skyGeo, skyMat);
      skyMesh.frustumCulled = false;
      skyMesh.renderOrder = -10;
      scene.add(skyMesh);
      // lights
      scene.add(new THREE.HemisphereLight(0xa9bbff, 0x4a3438, 1.6));
      const sun = new THREE.DirectionalLight(0xffcf9e, 2.4);
      sun.position.set(0.35, 0.5, -0.8);
      scene.add(sun);
      const rimL = new THREE.DirectionalLight(0x6fb8ff, 0.7);
      rimL.position.set(-0.4, 0.3, 0.8);
      scene.add(rimL);
      // ground far below the corridor
      groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), mats.ground);
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.y = GROUND_Y;
      scene.add(groundMesh);
      // distant mountains (camera-anchored)
      const mg = new THREE.BufferGeometry();
      const mpos = [], mcol = [];
      const low = new THREE.Color(0x5a4060), high = new THREE.Color(0x231a35);
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 + Math.random() * 0.1;
        const r = 2600 + Math.random() * 600, w = 160 + Math.random() * 260, h = 160 + Math.random() * 420;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, tx = -Math.sin(a), tz = Math.cos(a);
        mpos.push(cx - tx * w, 0, cz - tz * w, cx + tx * w, 0, cz + tz * w, cx + tx * w * 0.1, h, cz + tz * w * 0.1);
        mcol.push(low.r, low.g, low.b, low.r, low.g, low.b, high.r, high.g, high.b);
      }
      mg.setAttribute("position", new THREE.Float32BufferAttribute(mpos, 3));
      mg.setAttribute("color", new THREE.Float32BufferAttribute(mcol, 3));
      mountains = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
      mountains.frustumCulled = false;
      scene.add(mountains);
      // open-air clouds
      for (let i = 0; i < 18; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.smoke, color: 0xffe2d0, transparent: true, opacity: 0, depthWrite: false }));
        sp.scale.set(rr(60, 120), rr(25, 45), 1);
        sp.userData = { placed: false };
        scene.add(sp); clouds.push(sp);
      }
      // player aircraft
      planeParts = buildPlaneModel(false);
      plane = planeParts.grp;
      scene.add(plane);
      mtx.m = new THREE.Matrix4(); mtx.q = new THREE.Quaternion(); mtx.p = new THREE.Vector3(); mtx.s = new THREE.Vector3();
      fxColor = new THREE.Color(); fxEuler = new THREE.Euler();
      initFx();
      initGhost();
    }

    // ----- per-frame visual update -----
    function frameUpdate(dtMs) {
      if (!gfxReady) return;
      const dt = Math.min(0.05, dtMs / 1000);
      const t = performance.now() / 1000;
      const V = P.speed;
      const th = sampleAt(track.th, P.s);
      // aircraft pose
      trackPos(P.s, P.u, P.y, v3a);
      const yawRel = Math.atan2(P.vu, V), pitch = Math.atan2(P.vy, V);
      const vib = state === "play" ? 0.012 : 0.006;
      plane.position.set(v3a.x + (Math.random() - 0.5) * vib, v3a.y + (Math.random() - 0.5) * vib, v3a.z);
      plane.rotation.set(pitch, -(th + yawRel), -P.bank, "YXZ");
      const throttle = state === "play" ? clamp((V - CFG.baseSpeed) / Math.max(1, CFG.maxSpeed - CFG.baseSpeed), 0, 1) : 0.3;
      run.burnerT = Math.max(0, run.burnerT - dt);
      const burn = 0.75 + 0.35 * throttle + run.burnerT * 0.9;
      for (const pm of planeParts.plumes) { pm.scale.set(1, 1, burn * (0.85 + Math.random() * 0.3)); }
      const blink = (t * 1.3) % 1 < 0.08;
      planeParts.navL.visible = planeParts.navR.visible = blink || state === "menu";
      muzzleT -= dt;
      for (const m of muzzle) { m.visible = muzzleT > 0; m.material.rotation = Math.random() * 6; }
      // camera
      if (state === "menu") {
        cam.orbit += dt * 0.18;
        const a = cam.orbit;
        trackPos(P.s + 7 * Math.cos(a) - 2, P.u + 11 * Math.sin(a), P.y + 2.2 + Math.sin(a * 0.7), v3b);
        camera.position.copy(v3b);
        trackPos(P.s - 1.5, P.u, P.y + 0.2, v3b);
        camera.up.set(0, 1, 0);
        camera.lookAt(v3b);
        cam.init = false;
      } else {
        const follow = state === "crashing" || state === "over";
        if (!cam.init) { cam.u = P.u; cam.y = P.y; cam.init = true; }
        if (!follow) {
          cam.u = lerp(cam.u, P.u, damp(5, dt));
          cam.y = lerp(cam.y, P.y, damp(4, dt));
        }
        const back = 16 + (V - CFG.baseSpeed) * 0.06;
        trackPos(P.s - back, cam.u, cam.y + 3.3, v3b);
        if (!follow || !cam.frozen) { camera.position.copy(v3b); }
        if (follow) cam.frozen = true; else cam.frozen = false;
        trackPos(P.s + 34, lerp(cam.u, P.u, 0.7), lerp(cam.y, P.y, 0.6) + 1.6, v3b);
        camera.up.set(0, 1, 0);
        camera.lookAt(v3b);
        camera.rotateZ(-P.bank * 0.14);
        if (run.shake > 0) {
          const k = run.shake * run.shake;
          camera.position.x += (Math.random() - 0.5) * k * 0.9;
          camera.position.y += (Math.random() - 0.5) * k * 0.9;
          run.shake = Math.max(0, run.shake - dt * 1.6);
        }
      }
      // FOV keeps a usable horizontal view in portrait
      const aspect = Math.max(0.3, ctx.width / Math.max(1, ctx.height));
      const hfov = 92 + (state === "play" ? clamp((V - CFG.baseSpeed) * 0.5, 0, 6) : 0);
      const vfov = clamp((2 * Math.atan(Math.tan((hfov * DEG) / 2) / aspect)) / DEG, 52, 96);
      if (Math.abs(camera.fov - vfov) > 0.05) { camera.fov = lerp(camera.fov, vfov, damp(3, dt)); camera.updateProjectionMatrix(); }
      // world anchors
      skyMesh.position.copy(camera.position);
      mountains.position.set(camera.position.x, -40, camera.position.z);
      groundMesh.position.x = Math.round(camera.position.x / 200) * 200;
      groundMesh.position.z = Math.round(camera.position.z / 200) * 200;
      const op = sampleAt(track.op, P.s + 60);
      for (const c of clouds) {
        c.material.opacity = 0.5 * op;
        c.visible = op > 0.02;
        if (!c.visible) { c.userData.placed = false; continue; }
        if (!c.userData.placed || c.position.distanceTo(camera.position) > 900 || isBehind(c.position)) {
          trackPos(P.s + rr(250, 850), rr(-320, 320), rr(55, 150), v3b);
          c.position.copy(v3b);
          c.userData.placed = true;
        }
      }
      // enemies
      for (const e of enemies) {
        if (!e.mesh) continue;
        trackPos(e.s, e.u, e.y, v3b);
        e.mesh.grp.position.copy(v3b);
        const eth = sampleAt(track.th, e.s);
        e.mesh.grp.rotation.set(Math.atan2(e.cvy || 0, e.vs), -(eth + Math.atan2(e.cvu || 0, e.vs)), -e.bank, "YXZ");
        const fl = e.flash > 0 ? 1.15 : 1;
        e.mesh.grp.scale.set(0.95 * fl, 0.95 * fl, 0.95 * fl);
        e.mesh.grp.visible = e.alive;
      }
      // missiles
      for (const m of missiles) {
        if (!m.mesh) {
          m.mesh = missilePool.pop() || makeMissileMesh();
          m.mesh.userData.glow.material.color.setHex(MISSILE_DEF[m.type].color);
          m.mesh.visible = true;
          scene.add(m.mesh);
        }
        trackPos(m.s, m.u, m.y, v3b);
        m.mesh.position.copy(v3b);
        m.mesh.rotation.set(0, -sampleAt(track.th, m.s), 0, "YXZ");
        m.puff -= dt;
        if (m.puff <= 0) { m.puff = 0.025; spawnPuff(v3b.x, v3b.y, v3b.z, 1.2, 0.7, 0, 0.5, 0, 0xd8d8e0); }
      }
      // tracers
      for (let i = 0; i < 60; i++) {
        const b = bullets[i];
        if (b) {
          trackPos(b.s, b.u, b.y, v3b);
          mtx.p.copy(v3b);
          mtx.q.setFromAxisAngle(UP, -sampleAt(track.th, b.s));
          mtx.s.set(1, 1, 1);
        } else { mtx.p.set(0, -999, 0); mtx.s.set(0, 0, 0); }
        mtx.m.compose(mtx.p, mtx.q, mtx.s);
        tracerMesh.setMatrixAt(i, mtx.m);
      }
      tracerMesh.instanceMatrix.needsUpdate = true;
      // speed lines
      const pts = speedLines.userData.pts, arr = speedLines.geometry.attributes.position.array;
      const sl = state === "play" ? 1 : 0.4;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.z += V * 1.6 * dt;
        if (p.z > -1) { p.z = -90 - Math.random() * 20; p.a = Math.random() * 6.28; p.r = 3 + Math.random() * 8; }
        const x = Math.cos(p.a) * p.r, y = Math.sin(p.a) * p.r * 0.7;
        const len = 2 + V * 0.12 * sl;
        arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = p.z;
        arr[i * 6 + 3] = x; arr[i * 6 + 4] = y; arr[i * 6 + 5] = p.z - len;
      }
      speedLines.geometry.attributes.position.needsUpdate = true;
      speedLines.material.opacity = 0.1 + 0.2 * sl * (0.5 + op * 0.5);
      updateChunks();
      updateGhost();
      updateFx(dt * (state === "crashing" ? 0.6 : 1));
    }

    // =====================================================================
    // HUD
    // =====================================================================
    let hudDirty = true, hudT = 0, bannerT = 0, lastPrompt = "";
    function banner(text) { el.banner.textContent = text; el.banner.classList.add("on"); bannerT = 2.4; }
    let popSlot = 0;
    function popText(text, color) {
      const d = document.createElement("div");
      d.className = "pop disp";
      d.textContent = text;
      d.style.color = color || "#9ff";
      d.style.top = "calc(44% + " + ((popSlot++ % 3) * 30) + "px)";
      el.pops.appendChild(d);
      ctx.timeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 950);
      while (el.pops.childNodes.length > 3) el.pops.removeChild(el.pops.firstChild);
    }
    function fmtKm(m) { return (m / 1000).toFixed(2) + " km"; }
    function hudUpdate(dt) {
      if (state !== "play" && state !== "crashing") return;
      hudT -= dt;
      bannerT -= dt;
      if (bannerT <= 0) el.banner.classList.remove("on");
      toastT -= dt;
      if (toastT <= 0) el.toast.classList.remove("on");
      promptOverrideT -= dt;
      const pr = state === "play" ? currentPrompt() : "";
      if (pr !== lastPrompt) { el.prompt.textContent = pr; lastPrompt = pr; }
      el.bSkip.hidden = !(gen.tutorial && state === "play" && P.s < gen.tutorialEnd);
      // attitude indicator for the next opening
      let g = null;
      for (const q of gates) { if (q.intact && !q.passed && q.front > P.s - 2) { g = q; break; } }
      if (g && g.front - P.s < 240 && state === "play") {
        el.att.classList.add("on");
        el.attT.style.transform = "rotate(" + (g.rho / DEG).toFixed(1) + "deg)";
        el.attP.style.transform = "rotate(" + (P.bank / DEG).toFixed(1) + "deg)";
        el.att.classList.toggle("ok", Math.abs(P.bank - g.rho) < g.ap.bt * 0.75);
      } else el.att.classList.remove("on");
      // turn warning
      let warnTxt = "";
      if (state === "play") {
        const kA = sampleAt(track.k, P.s + 140), kN = sampleAt(track.k, P.s);
        if (Math.abs(kA) > 0.0016 && Math.abs(kN) < 0.0012 && sampleAt(track.op, P.s) < 0.3) {
          warnTxt = kA > 0 ? "BANK RIGHT ▶▶" : "◀◀ BANK LEFT";
          const id = Math.round((P.s + 140) / 200);
          if (id !== lastWarnTurn) { lastWarnTurn = id; SND.warn(); }
        }
        const op = sampleAt(track.op, P.s), opA = sampleAt(track.op, P.s + 200);
        if (op > 0.5 && opA < op - 0.05 && Math.abs(P.u) > 20) warnTxt = P.u > 0 ? "◀◀ CORRIDOR" : "CORRIDOR ▶▶";
      }
      el.warn.textContent = warnTxt;
      el.warn.classList.toggle("on", !!warnTxt);
      el.bCannon.classList.toggle("hot", inp.fire || inp.keyFire);
      if (hudT > 0 && !hudDirty) return;
      hudT = 0.1; hudDirty = false;
      el.hScore.textContent = String(Math.floor(score.value));
      el.hDist.textContent = fmtKm(P.s);
      el.hBest.textContent = "BEST " + bestScore;
      const w = currentWeapon();
      if (!w.unlocked) {
        el.hWName.textContent = "NO MISSILES";
        el.hWAmmo.textContent = "";
      } else {
        el.hWName.textContent = w.name;
        el.hWAmmo.textContent = w.ammo > 0 ? "◆".repeat(w.ammo) : "EMPTY";
      }
      const nextIdx = weapons.findIndex((x) => !x.unlocked);
      const unlocks = [CFG.unlock1, CFG.unlock2, CFG.unlock3];
      el.hNext.textContent = nextIdx >= 0 ? "NEXT: " + weapons[nextIdx].name + " @ " + (unlocks[nextIdx] / 1000).toFixed(1) + " km" : (weapons.filter((x) => x.unlocked).length > 1 ? "TAP TO SWITCH" : "");
      el.bMissile.classList.toggle("off", !w.unlocked || w.ammo <= 0);
      el.bMAmmo.textContent = !w.unlocked ? "LOCKED" : w.name + " " + w.ammo;
    }
    function updateStickVisual() {
      if (stick.active && state === "play") {
        el.stick.classList.add("on");
        el.stick.style.left = stick.ox + "px";
        el.stick.style.top = stick.oy + "px";
        el.knob.style.transform = "translate(" + (stick.x * 38).toFixed(0) + "px," + (stick.y * 38).toFixed(0) + "px)";
      } else el.stick.classList.remove("on");
    }
    function refreshOptionLabels() {
      const ctl = settings.control === "tilt" ? "Tilt" : "Touch";
      el.optCtl.textContent = "Controls: " + ctl;
      el.optSens.textContent = el.pSens.textContent = "Sensitivity: " + SENS_NAMES[settings.sens];
      el.optInv.textContent = el.pInv.textContent = "Pitch: " + (settings.invert ? "Inverted" : "Normal");
      el.optSnd.textContent = el.pSnd.textContent = "Sound: " + (settings.sound ? "On" : "Off");
      el.optCal.hidden = settings.control !== "tilt";
      el.calAxes.textContent = "Axes: " + AXES_NAMES[settings.axes || 0];
      el.bRecal.hidden = settings.control !== "tilt";
      el.menuBest.textContent = bestScore > 0 ? "BEST " + bestScore : "";
      el.menuNote.textContent = !motionCapable
        ? "Tilt steering needs the Plethora app on a phone. Drag anywhere to steer · arrow keys / WASD, Space = gun, F = missile."
        : settings.control === "tilt"
          ? "Hold the phone comfortably — your starting position becomes neutral. Tilt left/right to bank, back/forward to climb/dive."
          : "Drag anywhere to steer. Hold GUN to fire, tap ◆ for missiles.";
    }
    function showOnly(name) {
      el.load.hidden = name !== "load";
      el.menu.hidden = name !== "menu";
      el.hud.hidden = !(name === "hud" || name === "pause" || name === "over");
      el.pause.hidden = name !== "pause";
      el.over.hidden = name !== "over";
      el.calib.hidden = name !== "calib";
    }

    // =====================================================================
    // Flow: menu / start / pause / game over
    // =====================================================================
    function enterMenu() {
      state = "menu";
      resetRun("menu");
      refreshOptionLabels();
      showOnly("menu");
      engineUpdate(0, false);
    }
    let starting = false;
    async function startFlight() {
      if (starting) return;
      starting = true;
      try {
        audioInit();
        if (sfx.ac && sfx.ac.state === "suspended") sfx.ac.resume().catch(() => {});
        musicStart();
        if (settings.control === "tilt") {
          const ok = await enableMotion();
          if (disposed) return;
          if (!ok) fallbackToTouch(ctx.motion && ctx.motion.permission === "denied" ? "Motion permission denied — drag to steer" : "Tilt unavailable — drag anywhere to steer");
          else createTilt();
        }
        beginRun();
      } finally { starting = false; }
    }
    function beginRun() {
      resetRun("play");
      if (settings.control === "tilt" && motionActive) createTilt(); // current grip becomes neutral
      run.attempt++;
      state = "play";
      showOnly("hud");
      score.reset({ reason: "new_run" });
      hudDirty = true;
      lastPrompt = "";
      el.prompt.textContent = "";
      el.bMissile.classList.remove("pulse");
      missileTutorialShown = false;
      run.burnerT = 1.6;
      SND.burner();
      engineUpdate(0.5, true);
      if (sfx.music) { try { ctx.music.resume(); } catch (e) { /* ignore */ } }
      try { ctx.platform.start({ attempt: run.attempt }); } catch (e) { /* ignore */ }
    }
    function pauseGame() {
      if (state !== "play") return;
      state = "paused";
      inp.fire = false;
      showOnly("pause");
      engineUpdate(0, false);
      try { if (ctx.music) ctx.music.pause(); } catch (e) { /* ignore */ }
    }
    function resumeGame() {
      if (state !== "paused") return;
      state = "play";
      showOnly("hud");
      engineUpdate(0.5, true);
      if (settings.sound) { try { if (ctx.music) ctx.music.resume(); } catch (e) { /* ignore */ } }
    }
    function showGameOver() {
      if (state !== "crashing") return;
      state = "over";
      const final = Math.floor(score.value);
      const isBest = final > bestScore;
      if (isBest) { bestScore = final; saveKey("afterburn.best", bestScore); }
      run.newBest = isBest;
      el.oReason.textContent = run.reason;
      el.oNew.hidden = !isBest;
      el.oScore.textContent = String(final);
      el.oDist.textContent = fmtKm(P.s);
      el.oBest.textContent = String(bestScore);
      const unlocked = weapons.filter((w) => w.unlocked).map((w) => w.name);
      el.oUnlock.textContent = unlocked.length ? unlocked[unlocked.length - 1] : "—";
      showOnly("over");
      const attempt = run.attempt;
      try { ctx.platform.fail({ score: final, distance: Math.round(P.s), reason: run.reason }); } catch (e) { /* ignore */ }
      score.submit("score", { label: final + " pts" }).catch(() => {});
      if (isBest && final > 0) {
        ctx.timeout(() => {
          if (disposed || attempt !== run.attempt) return;
          try { ctx.pulse.complete({ score: final, result: "new_record", text: "New AFTERBURN record: " + final + " pts over " + fmtKm(P.s) }); } catch (e) { /* optional */ }
        }, 400);
      }
    }

    // ---- wiring ----
    ctx.input.activate(el.start, () => { startFlight(); });
    ctx.input.activate(el.optCtl, () => {
      if (!motionCapable) { toast("Tilt needs the Plethora app on a phone"); refreshOptionLabels(); el.menuNote.textContent = "Tilt steering needs the Plethora app on a phone with motion sensors."; return; }
      settings.control = settings.control === "tilt" ? "touch" : "tilt";
      saveSettings(); refreshOptionLabels();
    });
    const cycleSens = () => { settings.sens = (settings.sens + 1) % 3; saveSettings(); refreshOptionLabels(); if (motionActive) createTilt(); };
    ctx.input.activate(el.optSens, cycleSens);
    ctx.input.activate(el.pSens, cycleSens);
    const toggleInv = () => { settings.invert = !settings.invert; saveSettings(); refreshOptionLabels(); };
    ctx.input.activate(el.optInv, toggleInv);
    ctx.input.activate(el.pInv, toggleInv);
    const toggleSnd = () => setSound(!settings.sound);
    ctx.input.activate(el.optSnd, toggleSnd);
    ctx.input.activate(el.pSnd, toggleSnd);
    let calibFrom = "menu";
    async function openCalib(from) {
      calibFrom = from;
      const ok = await enableMotion();
      if (disposed) return;
      if (!ok) { fallbackToTouch(); if (from === "pause") showOnly("pause"); return; }
      showOnly("calib");
    }
    ctx.input.activate(el.optCal, () => openCalib("menu"));
    ctx.input.activate(el.pRecal, () => openCalib("pause"));
    ctx.input.activate(el.calSet, () => { createTilt(); haptic("light"); el.calRead.textContent = "Neutral set."; });
    ctx.input.activate(el.calAxes, () => { settings.axes = ((settings.axes || 0) + 1) % 3; saveSettings(); refreshOptionLabels(); });
    ctx.input.activate(el.calDone, () => { showOnly(calibFrom === "pause" ? "pause" : "menu"); });
    ctx.input.activate(el.bRecal, () => { if (motionActive) { createTilt(); toast("Neutral position reset"); haptic("light"); } });
    ctx.input.activate(el.bPause, pauseGame);
    ctx.input.activate(el.pResume, resumeGame);
    ctx.input.activate(el.pRestart, () => { if (state === "paused") beginRun(); });
    ctx.input.activate(el.pMenu, () => { enterMenu(); });
    ctx.input.activate(el.oRestart, () => { if (state === "over") beginRun(); });
    ctx.input.activate(el.oMenu, () => { if (state === "over") enterMenu(); });
    ctx.input.activate(el.hWeapon, () => { if (state === "play") cycleWeapon(); });
    ctx.input.activate(el.bSkip, () => {
      if (!gen.tutorial) return;
      finishTutorial();
      el.prompt.textContent = ""; lastPrompt = "";
      toast("Tutorial skipped");
    });
    ctx.listen(el.bMissile, "pointerdown", (e) => { e.preventDefault(); fireMissile(); });
    ctx.listen(el.bMissile, "keydown", (e) => { if (e.key === "Enter" || e.key === " ") fireMissile(); });
    ctx.listen(el.bCannon, "pointerdown", (e) => { e.preventDefault(); inp.fire = true; try { el.bCannon.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) ctx.listen(el.bCannon, ev, () => { inp.fire = false; });
    ctx.listen(document, "visibilitychange", () => { if (document.hidden) { pauseGame(); engineUpdate(0, false); } });
    ctx.onDestroy(() => {
      try { if (tilt && tilt.destroy) tilt.destroy(); } catch (e) { /* ignore */ }
      try { if (motionActive && ctx.motion) ctx.motion.stop(); } catch (e) { /* ignore */ }
      try { if (ctx.music) ctx.music.stop({ fadeOutMs: 200 }); } catch (e) { /* ignore */ }
    });

    // =====================================================================
    // Boot: dependency download → renderer → first frame
    // =====================================================================
    let booting = false;
    async function boot() {
      if (booting || gfxReady || disposed) return;
      booting = true;
      el.retry.hidden = true;
      el.loadTxt.textContent = "Loading flight systems…";
      let stage = "dependency_download";
      try {
        THREE = await ctx.importModule("three", "0.164.1");
        if (disposed) return;
        stage = "renderer_init";
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(ctx.dpr || 1, 2));
        renderer.setSize(ctx.width, ctx.height, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        v3a = new THREE.Vector3(); v3b = new THREE.Vector3(); UP = new THREE.Vector3(0, 1, 0);
        buildTextures();
        buildMaterials();
        buildScene();
        stage = "world_init";
        gfxReady = true;
        enterMenu();
        for (const g of gates) if (!g.mesh) buildGateMesh(g);
        stage = "first_frame";
        frameUpdate(16);
        renderer.render(scene, camera);
        ctx.onDestroy(() => {
          try {
            scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            for (const k in mats) mats[k].dispose();
            for (const k in tex) tex[k].dispose();
            renderer.dispose();
          } catch (e) { /* ignore */ }
        });
      } catch (err) {
        gfxReady = false;
        const msg = err && err.message ? err.message : String(err);
        try { ctx.platform.error({ stage, message: msg }); } catch (e) { /* ignore */ }
        state = "error";
        if (stage === "dependency_download") {
          el.loadTxt.textContent = "Couldn't download the 3D engine. Check your connection and retry.";
          el.retry.hidden = false;
        } else {
          el.loadTxt.textContent = "3D startup failed (" + stage.replace("_", " ") + "): " + msg;
        }
        showOnly("load");
      } finally { booting = false; }
    }
    ctx.input.activate(el.retry, () => { boot(); });

    ctx.onResize((L) => {
      applySafeArea(L.safeArea);
      if (renderer) {
        renderer.setPixelRatio(Math.min(L.dpr || ctx.dpr || 1, 2));
        renderer.setSize(L.width, L.height, false);
      }
      if (camera) { camera.aspect = Math.max(0.3, L.width / Math.max(1, L.height)); camera.updateProjectionMatrix(); }
    }, { immediate: true });

    // Track exists before graphics so menu autopilot can start immediately.
    resetRun("menu");

    ctx.game.loop({
      fixedHz: 120,
      maxSubsteps: 12,
      maxDeltaMs: 100,
      input: tracker,
      fixedUpdate(stepMs) { simStep(stepMs / 1000); },
      update(dtMs) {
        const dt = Math.min(0.1, dtMs / 1000);
        hudUpdate(dt);
        updateStickVisual();
        if (el.calib && !el.calib.hidden && tilt) {
          const a = tiltAxes(Number(tilt.x) || 0, Number(tilt.y) || 0);
          const x = clamp(a[0], -1, 1), y = clamp(a[1], -1, 1);
          el.calDot.style.transform = "translate(" + (x * 60).toFixed(0) + "px," + (-y * (settings.invert ? -1 : 1) * 60).toFixed(0) + "px)";
          el.calRead.textContent = "bank " + (x >= 0 ? "right " : "left ") + Math.round(Math.abs(x) * 100) + "% · " + (y * (settings.invert ? -1 : 1) >= 0 ? "climb " : "dive ") + Math.round(Math.abs(y) * 100) + "%";
        }
        if (state === "play") engineUpdate(clamp((P.speed - CFG.baseSpeed) / 12, 0, 1) + run.burnerT * 0.4, true);
        frameUpdate(dtMs);
      },
      render() {
        if (gfxReady && renderer) renderer.render(scene, camera);
      }
    });

    if (TEST) {
      TEST.api = {
        get state() { return state; }, P, CFG, gates: () => gates, track, weapons, enemies: () => enemies, zones: () => zones,
        score, PLANE_POINTS, getAperture, apField, coreDist, sampleAt, startFlight, beginRun, enterMenu, fireMissile,
        pauseGame, resumeGame, gateLocal, bankFor, speedAt, get run() { return run; }, settings, el,
        renderInfo: () => renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures } : null
      };
    }

    await boot();
  }
};
