/*
 * INFLATE — an endless arcade game about size, greed and barely fitting through.
 *
 * One control: hold anywhere to inflate, release to shrink.
 * Size drives everything: collision radius, buoyancy, and how hard air currents push.
 *
 * Layout of this file:
 *   1. Tuning config
 *   2. Core simulation (shared by the live game and the generation validator)
 *   3. Pattern library + segment builder
 *   4. Validator (beam search over hold/release using the real physics)
 *   5. World generator / director
 *   6. The Bit: rendering, audio, UI, progression
 */
(function () {
  "use strict";

  // ===========================================================================
  // 1. TUNING
  // ===========================================================================
  const CFG = {
    H: 1000, // corridor height in world units; y grows downward, 0 = thin-air limit, H = cloud sea
    minViewW: 680, // narrowest visible world width (portrait phones)
    balloon: {
      minI: 0.3,
      maxI: 1.0,
      startI: 0.5,
      rMin: 28,
      rMax: 88,
      inflateRate: 1.05, // inflation/sec while held (eases off near max — the rubber resists)
      deflateRate: 1.35, // inflation/sec after release (faster when big — more pressure)
      neutralI: 0.56, // inflation where lift equals weight
      buoyancy: 2000, // vertical accel per unit of inflation away from neutral
      drag: 2.6, // vertical damping per second
      maxVy: 430,
      hitScale: 0.94, // collision radius / drawn radius (drawn shape never shrinks below this)
      windRefR: 50, // radius at which wind acts at nominal strength
      windExp: 2.0, // wind force ~ cross-section area
      bounce: 0.22, // soft bounce off the thin-air limit and cloud sea
    },
    speed: { base: 240, max: 350 },
    difficulty: { scale: 1.35, dist: 20000 }, // d = scale * (1 - e^(-x/dist))
    sim: { hz: 120 },
    gen: {
      decisionSteps: 15, // validator decision interval (15 / 120 Hz = 0.125 s)
      beam: 100, // states kept per entry origin
      margin: 8, // validator collides this much earlier than the game does
      ringReach: 0.3,
      budgetMs: 4, // per-frame generation budget
      ahead: 900, // keep this much validated world beyond the right edge of the view
    },
    ring: { r: 24, bigR: 34, reach: 0.6 },
    score: { ring: 10, bigRing: 40, close: 25, thread: 60, perfect: 120 },
    near: { close: 22, thread: 12, perfect: 5 }, // clearance (world units) thresholds
    streak: { pts: [0, 2, 5, 9, 14, 20], mult: [1, 1.5, 2, 3, 4, 5], decayAfter: 7, decayStep: 4.5 },
  };
  const B = CFG.balloon;
  const IRANGE = B.maxI - B.minI;

  // ===========================================================================
  // 2. CORE SIMULATION
  // ===========================================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function radiusOf(I) { return B.rMin + ((I - B.minI) / IRANGE) * (B.rMax - B.rMin); }
  function inflOfRadius(r) { return B.minI + ((r - B.rMin) / (B.rMax - B.rMin)) * IRANGE; }
  function diffAt(x) { return CFG.difficulty.scale * (1 - Math.exp(-Math.max(0, x) / CFG.difficulty.dist)); }
  function speedAt(x) {
    return CFG.speed.base + (CFG.speed.max - CFG.speed.base) * Math.min(1, diffAt(x) / 1.2);
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Field types
  const F_THERMAL = 1, F_FAN = 2, F_SUCTION = 3;

  function fieldEdge(x, f) {
    return clamp01((x - f.x0 + 30) / 70) * clamp01((f.x1 + 30 - x) / 70);
  }

  // Vertical acceleration from air currents. Area-scaled: big balloons catch more.
  function fieldAccel(fields, n, x, y, r) {
    let ay = 0;
    const k = r / B.windRefR;
    const wf = k * k;
    for (let i = 0; i < n; i++) {
      const f = fields[i];
      if (x < f.x0 - 30 || x > f.x1 + 30) continue;
      const e = fieldEdge(x, f);
      if (e <= 0) continue;
      if (f.type === F_THERMAL) {
        ay -= f.s * wf * e * (0.55 + 0.45 * clamp01(y / CFG.H));
      } else if (f.type === F_FAN) {
        const dist = f.dir > 0 ? y - f.yFan : f.yFan - y;
        if (dist < -r) continue;
        ay += f.dir * f.s * wf * e * (1 - 0.45 * clamp01(dist / 700));
      } else {
        let p = (f.cy - y) / 150;
        p = p > 1 ? 1 : p < -1 ? -1 : p;
        ay += f.s * wf * e * p;
      }
    }
    return ay;
  }

  // One fixed physics step. Mutates st {x, y, vy, I}. Returns drawn radius.
  function physStep(st, hold, dt, fields, nf) {
    const t = (st.I - B.minI) / IRANGE;
    if (hold) {
      st.I += B.inflateRate * dt * (1 - 0.45 * t);
      if (st.I > B.maxI) st.I = B.maxI;
    } else {
      st.I -= B.deflateRate * dt * (0.65 + 0.5 * t);
      if (st.I < B.minI) st.I = B.minI;
    }
    const r = radiusOf(st.I);
    let ay = -B.buoyancy * (st.I - B.neutralI);
    if (nf) ay += fieldAccel(fields, nf, st.x, st.y, r);
    st.vy += ay * dt;
    st.vy -= st.vy * B.drag * dt;
    if (st.vy > B.maxVy) st.vy = B.maxVy;
    else if (st.vy < -B.maxVy) st.vy = -B.maxVy;
    st.y += st.vy * dt;
    if (st.y - r < 0) {
      st.y = r;
      if (st.vy < 0) st.vy = -st.vy * B.bounce;
    } else if (st.y + r > CFG.H) {
      st.y = CFG.H - r;
      if (st.vy > 0) st.vy = -st.vy * B.bounce;
    }
    st.x += speedAt(st.x) * dt;
    return r;
  }

  // Signed distance from a point to a polygon (flat [x,y,...]); negative inside.
  // Closest point is left in polyCX/polyCY.
  let polyCX = 0, polyCY = 0;
  function polyDist(pts, px, py) {
    let inside = false, best = Infinity;
    const n = pts.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      const ex = xi - xj, ey = yi - yj, wx = px - xj, wy = py - yj;
      let t = (wx * ex + wy * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - t * ex, dy = wy - t * ey;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; polyCX = xj + t * ex; polyCY = yj + t * ey; }
    }
    const d = Math.sqrt(best);
    return inside ? -d : d;
  }

  function solidOffset(s, bx) {
    const m = s.motion;
    return m ? m.amp * Math.sin((2 * Math.PI * (bx - m.x)) / m.lam + m.ph) : 0;
  }

  // Clearance between a circle and a solid (edge to edge). bx drives moving parts.
  function solidClearance(s, x, y, r, bx) {
    const oy = s.motion ? solidOffset(s, bx) : 0;
    const d = polyDist(s.pts, x, y - oy);
    polyCY += oy;
    return d - r;
  }

  // ===========================================================================
  // 3. PATTERN LIBRARY
  // ===========================================================================
  const S_PILLAR = 1, S_HANG = 2, S_SPIKE = 3, S_SLAB = 4, S_NEEDLE = 5, S_FAN = 6, S_VENT = 7;
  const TOP = -700, BOTTOM = CFG.H + 700;

  class Builder {
    constructor(x0, rng, d) {
      this.x0 = x0; this.rng = rng; this.d = d; this.off = 0;
      this.solids = []; this.fields = []; this.rings = []; this.groups = [];
    }
    X(lx) { return this.x0 + this.off + lx; }
    r(a, b) { return a + (b - a) * this.rng(); }
    chance(p) { return this.rng() < p; }
    group(kind, lx0, lx1) {
      const g = { kind, x0: this.X(lx0), x1: this.X(lx1), minClear: 1e9, done: false, cx: 0, cy: 0 };
      this.groups.push(g);
      return g;
    }
    poly(style, local, g, motion) {
      const pts = new Float64Array(local.length);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < local.length; i += 2) {
        const x = this.X(local[i]), y = local[i + 1];
        pts[i] = x; pts[i + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      let mo = null, amp = 0;
      if (motion) { mo = { amp: motion.amp, lam: motion.lam, ph: motion.ph, x: this.X(motion.lx || 0) }; amp = Math.abs(motion.amp); }
      const s = { style, pts, x0, x1, y0: y0 - amp, y1: y1 + amp, g, motion: mo, deco: null, seed: (this.rng() * 1e9) | 0 };
      this.solids.push(s);
      return s;
    }
    spikes(lx0, lx1, baseY, dir, h, g, motion) {
      // dir -1: tips point up (sitting on a surface); +1: tips point down (hanging)
      const w = lx1 - lx0;
      const n = Math.max(2, Math.round(w / 28));
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const a = lx0 + i * sw;
        const hh = h * (0.85 + 0.3 * this.rng());
        this.poly(S_SPIKE, [a, baseY - dir * 3, a + sw, baseY - dir * 3, a + sw / 2, baseY + dir * hh], g, motion);
      }
    }
    // Pillar rising from the clouds. Returns its effective top (spike tips included).
    pillar(lx, w, top, g, o) {
      o = o || {};
      const sh = o.spikes ? 26 : 0;
      const t = top + sh;
      const ov = 8, cap = 20;
      this.poly(S_PILLAR, [lx - ov, t, lx + w + ov, t, lx + w + ov, t + cap, lx + w, t + cap, lx + w, BOTTOM, lx, BOTTOM, lx, t + cap, lx - ov, t + cap], g, o.motion);
      if (sh) this.spikes(lx - ov + 2, lx + w + ov - 2, t, -1, sh, g, o.motion);
      return top;
    }
    // Masonry hanging from above. bot = lowest point of the opening edge.
    hang(lx, w, bot, g, o) {
      o = o || {};
      const sh = o.spikes ? 26 : 0;
      const b = bot - sh;
      let pts;
      if (o.arch && !sh && w >= 90) {
        const foot = Math.max(18, w * 0.2), ra = (w - 2 * foot) / 2, cx = lx + w / 2;
        const rise = Math.min(ra, 70);
        pts = [lx, TOP, lx + w, TOP, lx + w, b, lx + w - foot, b];
        for (let k = 1; k < 12; k++) {
          const a = (k / 12) * Math.PI;
          pts.push(cx + ra * Math.cos(a), b - rise * Math.sin(a));
        }
        pts.push(lx + foot, b, lx, b);
      } else {
        pts = [lx, TOP, lx + w, TOP, lx + w, b, lx, b];
      }
      const s = this.poly(S_HANG, pts, g, o.motion);
      s.arch = !!(o.arch && !sh && w >= 90);
      s.banner = !!o.banner;
      if (sh) this.spikes(lx + 2, lx + w - 2, b, 1, sh, g, o.motion);
      return s;
    }
    slab(lx, w, y0, y1, g, o) {
      o = o || {};
      const c = 10;
      const t = o.spikesTop ? 26 : 0, bt = o.spikesBot ? 26 : 0;
      const a = y0 + t, b = y1 - bt;
      this.poly(S_SLAB, [lx + c, a, lx + w - c, a, lx + w, a + c, lx + w, b - c, lx + w - c, b, lx + c, b, lx, b - c, lx, a + c], g, o.motion);
      if (t) this.spikes(lx + 4, lx + w - 4, a, -1, t, g, o.motion);
      if (bt) this.spikes(lx + 4, lx + w - 4, b, 1, bt, g, o.motion);
    }
    needleUp(lx, bw, tip, g) { this.poly(S_NEEDLE, [lx, CFG.H + 160, lx + bw / 2, tip, lx + bw, CFG.H + 160], g); }
    needleDown(lx, bw, tip, g) { this.poly(S_NEEDLE, [lx, -260, lx + bw, -260, lx + bw / 2, tip], g); }
    ring(lx, y, big) { this.rings.push({ x: this.X(lx), y, big: !!big, taken: false, bit: 0, ph: this.rng() * 6.28 }); }
    thermal(lx0, lx1, s) { this.fields.push({ type: F_THERMAL, x0: this.X(lx0), x1: this.X(lx1), s }); }
    fan(lx0, lx1, s, dir, yFan) { this.fields.push({ type: F_FAN, x0: this.X(lx0), x1: this.X(lx1), s, dir, yFan }); }
    suction(lx0, lx1, s, cy) { this.fields.push({ type: F_SUCTION, x0: this.X(lx0), x1: this.X(lx1), s, cy }); }
  }

  // Gap sizing: gap = 2 * required radius + slack. Lower d = roomier.
  function gapFor(b, d, tight) {
    const dd = clamp01(d);
    let rq = lerp(82, 52, dd) + b.r(-5, 5);
    if (tight) rq = lerp(64, 44, dd) + b.r(-3, 3);
    const slack = lerp(70, 24, dd);
    return 2 * rq + slack;
  }
  function centerNear(b, ey, d, gap, spread) {
    const lim = gap / 2 + 70;
    const s = (spread || 1) * (70 + 130 * clamp01(d));
    return clamp(ey + b.r(-s, s), lim, CFG.H - lim);
  }

  // A gate: hanging masonry above, pillar below, an opening between.
  function gate(b, lx, w, gc, gap, g, o) {
    o = o || {};
    const top = gc - gap / 2, bot = gc + gap / 2;
    b.hang(lx, w, top, g, { arch: o.arch !== false && !o.spikesTop, spikes: o.spikesTop, banner: o.banner, motion: o.motionTop });
    b.pillar(lx + (o.pillarInset || 0), w - 2 * (o.pillarInset || 0), bot, g, { spikes: o.spikesBot, motion: o.motionBot });
  }

  const LEAD = 340; // open run-up at the start of every pattern
  const PAT = {};

  PAT.intro = function (b) {
    const L = 1150;
    for (let i = 0; i < 5; i++) b.ring(380 + i * 140, 500 - Math.sin((i / 4) * Math.PI) * 120, false);
    return { len: L, exitY: 500 };
  };

  PAT.open = function (b, d, ey) {
    const L = b.r(620, 860) - Math.min(200, d * 160);
    const c = clamp(ey, 320, 680), A = b.r(80, 170), n = 5;
    const ph = b.r(0, 6.28);
    for (let i = 0; i < n; i++) {
      const lx = 170 + (i * (L - 340)) / (n - 1);
      const big = d > 0.2 && i === 2 && b.chance(0.5);
      b.ring(lx, c + A * Math.sin(ph + i * 0.9) * (big ? 1.5 : 1), big);
    }
    return { len: L, exitY: c };
  };

  PAT.gate = function (b, d, ey) {
    const tight = d > 0.3 && b.chance(0.35);
    const gap = gapFor(b, d, tight);
    const w = tight ? b.r(60, 90) : b.r(100, 170);
    const gc = centerNear(b, ey, d, gap);
    const lx = LEAD;
    const g = b.group("gate", lx, lx + w);
    gate(b, lx, w, gc, gap, g, { banner: b.chance(0.6), spikesBot: d > 0.25 && b.chance(0.4), spikesTop: d > 0.45 && b.chance(0.3) });
    b.ring(lx - 140, lerp(ey, gc, 0.6), false);
    b.ring(lx + w / 2, gc, gap > 2 * B.rMax);
    let L = lx + w + 280;
    if (d > 0.22 && b.chance(0.6)) {
      const hy = clamp(gc + (b.chance(0.5) ? -1 : 1) * b.r(170, 260), 110, CFG.H - 110);
      b.ring(lx + w + 170, hy, true);
      L += 60;
    }
    return { len: L, exitY: gc };
  };
  PAT.gate.easy = true;

  PAT.gateRun = function (b, d, ey) {
    const n = 2 + (d > 0.35 ? 1 : 0) + (d > 0.7 && b.chance(0.5) ? 1 : 0);
    const spacing = lerp(520, 400, clamp01(d)) + b.r(-30, 30);
    let lx = LEAD, c = ey;
    for (let i = 0; i < n; i++) {
      const tight = i % 2 === 1 && d > 0.25 && b.chance(0.6);
      const gap = gapFor(b, d, tight);
      const w = tight ? b.r(60, 85) : b.r(90, 140);
      c = centerNear(b, c, d * 0.8, gap, 0.75);
      const g = b.group("gate", lx, lx + w);
      gate(b, lx, w, c, gap, g, { banner: b.chance(0.5), spikesBot: d > 0.3 && b.chance(0.35) });
      b.ring(lx + w / 2, c, false);
      if (i < n - 1 && b.chance(0.5)) b.ring(lx + w + spacing * 0.45, c + b.r(-120, 120), false);
      lx += w + spacing;
    }
    return { len: lx - spacing + 260, exitY: c };
  };

  PAT.needles = function (b, d, ey) {
    const L = b.r(1000, 1250);
    const cw = lerp(360, 215, clamp01(d)) + b.r(-15, 15);
    const c0 = clamp(ey, cw / 2 + 80, CFG.H - cw / 2 - 80);
    const A = Math.min(b.r(70, 110 + 60 * clamp01(d)), Math.min(c0 - cw / 2 - 60, CFG.H - c0 - cw / 2 - 60));
    const lam = b.r(700, 1000), ph = b.r(0, 6.28);
    const cAt = (x) => c0 + A * Math.sin(ph + (2 * Math.PI * x) / lam);
    let x = LEAD - 40, up = b.chance(0.5), k = 0, g = null;
    while (x < L - 220) {
      if (k % 2 === 0) g = b.group("needles", x, x + 140);
      const bw = b.r(38, 52);
      const c = cAt(x + bw / 2);
      if (up) b.needleUp(x, bw, c + cw / 2, g);
      else b.needleDown(x, bw, c - cw / 2, g);
      if (k % 2 === 1) { g.x1 = b.X(x + bw); b.ring(x - b.r(35, 55), cAt(x - 45), false); }
      up = !up; k++;
      x += b.r(85, 125) - d * 10;
    }
    return { len: L, exitY: cAt(L) };
  };

  PAT.split = function (b, d, ey) {
    const lx = LEAD + 20, sw = b.r(280, 420);
    const thick = b.r(110, 170);
    const sc = clamp(ey + b.r(-120, 120), 380, 620);
    const y0 = sc - thick / 2, y1 = sc + thick / 2;
    const upperNarrow = b.chance(0.65);
    const wide = gapFor(b, d * 0.5, false) + 30;
    const narrow = gapFor(b, Math.max(d, 0.35), true);
    const g = b.group("split", lx, lx + sw);
    const upGap = upperNarrow ? narrow : wide, dnGap = upperNarrow ? wide : narrow;
    b.slab(lx, sw, y0, y1, g, { spikesTop: upperNarrow && d > 0.4, spikesBot: !upperNarrow && d > 0.4 });
    const hb = Math.max(60, y0 - upGap);
    b.hang(lx + 20, sw - 40, hb, g, { banner: true, arch: false });
    const pt = Math.min(CFG.H - 60, y1 + dnGap);
    b.pillar(lx + 20, sw - 40, pt, g);
    const ry = upperNarrow ? (hb + y0) / 2 : (y1 + pt) / 2;
    for (let i = 0; i < 3; i++) b.ring(lx + 50 + (i * (sw - 100)) / 2, ry, i === 1);
    const oy = upperNarrow ? (y1 + pt) / 2 : (hb + y0) / 2;
    b.ring(lx + sw / 2, oy, false);
    return { len: lx + sw + 260, exitY: sc };
  };
  PAT.split.easy = true;

  PAT.thermal = function (b, d, ey) {
    const cx0 = LEAD - 40, tw = b.r(270, 340);
    const s = lerp(300, 380, clamp01(d));
    b.pillar(cx0 + 40, tw - 80, CFG.H - 70, null);
    b.poly(S_VENT, [cx0 + 60, CFG.H - 70, cx0 + tw - 60, CFG.H - 70, cx0 + tw - 70, CFG.H - 96, cx0 + 70, CFG.H - 96], null);
    b.thermal(cx0, cx0 + tw, s);
    b.ring(cx0 + tw * 0.3, 540, false);
    b.ring(cx0 + tw * 0.6, 420, false);
    b.ring(cx0 + tw * 0.9, 290, d > 0.15);
    let L = cx0 + tw + 260, exitY = 300;
    if (d > 0.3) {
      // Overhead hazard right after the lift: ride high for the rings, then get back down.
      const hx = cx0 + tw + b.r(130, 190), hw = b.r(150, 230);
      const hy = b.r(300, 400) + d * 30;
      const gap = gapFor(b, d * 0.8, false) + 40;
      const g = b.group("gate", hx, hx + hw);
      b.hang(hx, hw, hy, g, { spikes: true });
      b.pillar(hx + 10, hw - 20, Math.min(CFG.H - 50, hy + gap), g);
      L = hx + hw + 260;
      exitY = hy + gap / 2;
    }
    return { len: L, exitY };
  };

  PAT.crosswind = function (b, d, ey) {
    const down = b.chance(0.6);
    const fx = LEAD - 60, fw = b.r(300, 420);
    const s = lerp(260, 380, clamp01(d));
    let exitY;
    if (down) {
      const fy = b.r(120, 200);
      b.hang(fx + fw / 2 - 90, 180, fy - 34, null, { arch: false });
      b.poly(S_FAN, [fx + fw / 2 - 60, fy - 40, fx + fw / 2 + 60, fy - 40, fx + fw / 2 + 60, fy, fx + fw / 2 - 60, fy], null);
      b.fan(fx, fx + fw, s, 1, fy);
      const gap = gapFor(b, d * 0.8, false) + 20;
      const gc = clamp(b.r(320, 470), fy + gap / 2 + 60, CFG.H - gap / 2 - 70);
      const gx = fx + fw - b.r(60, 140);
      const g = b.group("gate", gx, gx + 110);
      gate(b, gx, 110, gc, gap, g, { spikesBot: d > 0.35, arch: true });
      b.ring(fx + fw * 0.3, gc - 40, false);
      b.ring(gx + 55, gc, false);
      exitY = gc;
    } else {
      const fy = CFG.H - b.r(90, 160);
      b.pillar(fx + fw / 2 - 90, 180, fy + 34, null);
      b.poly(S_FAN, [fx + fw / 2 - 60, fy, fx + fw / 2 + 60, fy, fx + fw / 2 + 60, fy + 40, fx + fw / 2 - 60, fy + 40], null);
      b.fan(fx, fx + fw, s, -1, fy);
      const gap = gapFor(b, d * 0.8, false) + 20;
      const gc = clamp(b.r(520, 700), gap / 2 + 70, fy - gap / 2 - 60);
      const gx = fx + fw - b.r(60, 140);
      const g = b.group("gate", gx, gx + 110);
      gate(b, gx, 110, gc, gap, g, { spikesTop: d > 0.35, arch: false });
      b.ring(fx + fw * 0.35, b.r(180, 260), true);
      b.ring(gx + 55, gc, false);
      exitY = gc;
    }
    return { len: fx + fw + 300, exitY };
  };

  PAT.slider = function (b, d, ey) {
    const n = d > 0.75 && b.chance(0.5) ? 2 : 1;
    let lx = LEAD, c = ey;
    for (let i = 0; i < n; i++) {
      const w = b.r(110, 150);
      const gap = gapFor(b, d * 0.85, false) + 20;
      const amp = b.r(70, 120 + 60 * clamp01(d));
      const lam = b.r(1100, 1500);
      const shift = b.chance(0.5); // whole opening slides vs. upper door opens/closes
      c = clamp(c + b.r(-120, 120), gap / 2 + amp + 70, CFG.H - gap / 2 - amp - 70);
      const g = b.group("gate", lx, lx + w);
      const motion = { amp, lam, ph: b.r(0, 6.28), lx };
      if (shift) {
        gate(b, lx, w, c, gap, g, { motionTop: motion, motionBot: motion, arch: false, banner: true });
      } else {
        const gap2 = gap + amp; // upper door swings between gap+amp*2 and gap
        b.hang(lx, w, c - gap2 / 2, g, { motion, banner: true });
        b.pillar(lx, w, c + gap2 / 2 + amp, g, {});
      }
      b.ring(lx - 120, c, false);
      lx += w + b.r(380, 480);
    }
    return { len: lx - 180 + 200, exitY: c };
  };

  PAT.suction = function (b, d, ey) {
    const tx = LEAD - 80, tw = b.r(320, 420);
    const cy = clamp(ey + b.r(-130, 130), 260, 740);
    const s = lerp(380, 480, clamp01(d));
    b.suction(tx, tx + tw, s, cy);
    const gap = lerp(190, 120, clamp01(d)) + b.r(-8, 8);
    const gx = tx + tw - 40, w = b.r(70, 100);
    const g = b.group("gate", gx, gx + w);
    gate(b, gx, w, cy, gap, g, { arch: false, spikesTop: d > 0.55, spikesBot: d > 0.55 });
    b.ring(tx + tw * 0.2, cy, false);
    b.ring(tx + tw * 0.5, cy, false);
    b.ring(tx + tw * 0.45, cy + (cy > 500 ? -1 : 1) * b.r(160, 200), true);
    b.ring(gx + w / 2, cy, false);
    return { len: gx + w + 260, exitY: cy };
  };

  PAT.compress = function (b, d, ey) {
    const k = 6 + Math.floor(b.r(0, 3)), bw = b.r(70, 85);
    const gWide = b.r(330, 380), gMin = gapFor(b, d, true) + 10;
    const c0 = clamp(ey, gWide / 2 + 60, CFG.H - gWide / 2 - 60);
    const drift = b.r(-28, 28);
    const lx0 = LEAD;
    const g = b.group("tunnel", lx0, lx0 + k * bw);
    let c = c0;
    for (let i = 0; i < k; i++) {
      const p = Math.sin((Math.PI * i) / (k - 1));
      const gap = gWide - (gWide - gMin) * p;
      c = clamp(c0 + drift * i, gap / 2 + 60, CFG.H - gap / 2 - 60);
      const lx = lx0 + i * bw;
      b.hang(lx, bw + 1, c - gap / 2, g, { arch: false, banner: i % 3 === 1 });
      b.pillar(lx, bw + 1, c + gap / 2, g, {});
      if (i === Math.floor(k / 2)) b.ring(lx + bw / 2, c, false);
    }
    b.ring(lx0 - 120, c0 - gWide / 2 + 40, true);
    b.ring(lx0 + k * bw + 130, c, false);
    return { len: lx0 + k * bw + 260, exitY: c };
  };

  PAT.arcRun = function (b, d, ey) {
    const c = clamp(ey, 420, 720);
    const h = lerp(170, 300, clamp01(d));
    const n = 7, x0 = 180, span = 560;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      b.ring(x0 + span * t, c - h * Math.sin(Math.PI * t), i === 3 && d > 0.1);
    }
    let L = x0 + span + 240, exitY = c;
    if (d > 0.15) {
      const gap = gapFor(b, d * 0.85, d > 0.7);
      const gx = x0 + span + b.r(180, 260), w = b.r(80, 120);
      const gc = clamp(c + b.r(20, 120), gap / 2 + 70, CFG.H - gap / 2 - 70);
      const g = b.group("gate", gx, gx + w);
      gate(b, gx, w, gc, gap, g, { banner: true });
      L = gx + w + 260;
      exitY = gc;
    }
    return { len: L, exitY };
  };
  PAT.arcRun.easy = true;

  const COMBOS = [
    ["thermal", "gate"],
    ["crosswind", "slider"],
    ["suction", "split"],
    ["compress", "arcRun"],
    ["needles", "gate"],
    ["arcRun", "slider"],
  ];
  PAT.combo = function (b, d, ey) {
    const pair = COMBOS[Math.floor(b.rng() * COMBOS.length)];
    const a = PAT[pair[0]](b, d, ey);
    b.off += a.len - 150;
    const c = PAT[pair[1]](b, d, a.exitY);
    return { len: a.len - 150 + c.len, exitY: c.exitY, parts: pair };
  };

  // Director table: unlock difficulty, weight, category, intensity.
  const KINDS = {
    gate: { min: 0, w: 3.0, cat: "precision", heat: 0.5 },
    arcRun: { min: 0.04, w: 1.2, cat: "greed", heat: 0.4 },
    gateRun: { min: 0.08, w: 2.2, cat: "precision", heat: 0.8 },
    split: { min: 0.1, w: 1.4, cat: "greed", heat: 0.6 },
    needles: { min: 0.14, w: 1.6, cat: "precision", heat: 0.9 },
    thermal: { min: 0.16, w: 1.4, cat: "flow", heat: 0.6 },
    crosswind: { min: 0.24, w: 1.4, cat: "flow", heat: 0.8 },
    compress: { min: 0.3, w: 1.3, cat: "precision", heat: 0.9 },
    slider: { min: 0.34, w: 1.5, cat: "timing", heat: 0.8 },
    suction: { min: 0.42, w: 1.2, cat: "flow", heat: 0.8 },
    combo: { min: 0.55, w: 1.6, cat: "combo", heat: 1.3 },
  };

  function buildSegment(kind, x0, rng, d, entryY) {
    const b = new Builder(x0, rng, d);
    const res = PAT[kind](b, d, entryY);
    const seg = {
      kind, d, x0, x1: x0 + res.len, len: res.len, exitY: res.exitY,
      solids: b.solids, fields: b.fields, rings: b.rings, groups: b.groups, decorated: false,
    };
    seg.solids.sort((a, c) => a.x0 - c.x0);
    // Rings must never overlap architecture.
    seg.rings = seg.rings.filter((rg) => {
      const R = rg.big ? CFG.ring.bigR : CFG.ring.r;
      if (rg.y < R + 10 || rg.y > CFG.H - R - 10) return false;
      for (const s of seg.solids) {
        if (rg.x < s.x0 - 80 || rg.x > s.x1 + 80) continue;
        const amp = s.motion ? Math.abs(s.motion.amp) : 0;
        if (solidClearance(s, rg.x, rg.y, R + 8, rg.x) < amp) return false;
      }
      return true;
    });
    seg.rings.forEach((rg, i) => (rg.bit = i < 30 ? 1 << i : 0));
    return seg;
  }

  // ===========================================================================
  // 4. VALIDATOR — beam search over hold/release using the real physics step.
  // ===========================================================================
  function popcount(m) { let c = 0; while (m) { m &= m - 1; c++; } return c; }

  // slice: {x0, x1, solids, fields, rings}. entries: [{y, vy, I}]. Generator: yields per decision.
  function* validateSlice(slice, entries, opts) {
    const W = opts.beam, steps = opts.steps, dt = 1 / CFG.sim.hz, margin = opts.margin;
    const reach = opts.ringReach;
    const nO = entries.length;
    let states = entries.map((e, k) => ({ y: e.y, vy: e.vy, I: e.I, o: k, m: 0, pc: 0, a0: -1, c: 1e9 }));
    let x = slice.x0;
    const xs = new Float64Array(steps + 1);
    const act = [], fl = [], rg = [];
    const tmp = { x: 0, y: 0, vy: 0, I: 0 };
    while (x < slice.x1) {
      xs[0] = x;
      for (let k = 1; k <= steps; k++) xs[k] = xs[k - 1] + speedAt(xs[k - 1]) * dt;
      const wx0 = x - B.rMax - 20, wx1 = xs[steps] + B.rMax + 20;
      act.length = 0; fl.length = 0; rg.length = 0;
      for (const s of slice.solids) if (s.x1 >= wx0 && s.x0 <= wx1) act.push(s);
      for (const f of slice.fields) if (f.x1 + 40 >= x && f.x0 - 40 <= xs[steps]) fl.push(f);
      if (slice.rings) for (const r of slice.rings) if (r.bit && r.x >= wx0 && r.x <= wx1) rg.push(r);
      const next = new Map();
      for (const st of states) {
        for (let a = 0; a < 2; a++) {
          tmp.x = x; tmp.y = st.y; tmp.vy = st.vy; tmp.I = st.I;
          let m = st.m, alive = true, cmin = st.c;
          for (let k = 0; k < steps; k++) {
            const r = physStep(tmp, a === 1, dt, fl, fl.length);
            const rh = r * B.hitScale + margin;
            for (let i = 0; i < act.length; i++) {
              const s = act[i];
              if (tmp.x + rh < s.x0 || tmp.x - rh > s.x1 || tmp.y + rh < s.y0 || tmp.y - rh > s.y1) continue;
              const cl = solidClearance(s, tmp.x, tmp.y, rh, tmp.x);
              if (cl < 0) { alive = false; break; }
              if (cl < cmin) cmin = cl;
            }
            if (!alive) break;
            for (let i = 0; i < rg.length; i++) {
              const R = rg[i];
              if (m & R.bit) continue;
              const dx = tmp.x - R.x, dy = tmp.y - R.y, rr = r + (R.big ? CFG.ring.bigR : CFG.ring.r) * reach;
              if (dx * dx + dy * dy < rr * rr) m |= R.bit;
            }
          }
          if (!alive) continue;
          const key = st.o * 1e7 + Math.floor(tmp.y / 10) * 1e4 + Math.floor((tmp.vy + 500) / 40) * 20 + Math.floor((tmp.I - B.minI) / 0.05);
          const prev = next.get(key);
          const pc = popcount(m);
          if (!prev || pc > prev.pc || (pc === prev.pc && cmin > prev.c)) {
            next.set(key, { y: tmp.y, vy: tmp.vy, I: tmp.I, o: st.o, m, pc, a0: st.a0 < 0 ? a : st.a0, c: cmin });
          }
        }
      }
      x = xs[steps];
      // Prune per origin, keeping an even spread over altitude.
      const per = [];
      for (let o = 0; o < nO; o++) per.push([]);
      for (const s of next.values()) per[s.o].push(s);
      states = [];
      for (let o = 0; o < nO; o++) {
        const arr = per[o];
        if (arr.length > W) {
          // Keep an even spread over altitude (feasibility) plus the best ring collectors (greed).
          // Sort by altitude band, then size, so the even pick covers both.
          arr.sort((p, q) => Math.floor(p.y / 40) - Math.floor(q.y / 40) || p.I - q.I || p.vy - q.vy);
          const keep = new Set();
          for (let i = 0; i < W; i++) keep.add(Math.floor((i * (arr.length - 1)) / (W - 1)));
          const byPc = arr.map((s, i) => i).sort((p, q) => arr[q].pc - arr[p].pc || arr[q].c - arr[p].c);
          for (let i = 0, added = 0; i < byPc.length && added < 10; i++) if (!keep.has(byPc[i])) { keep.add(byPc[i]); added++; }
          for (const i of keep) states.push(arr[i]);
        } else for (const s of arr) states.push(s);
      }
      if (!states.length) return { ok: false, x };
      if (opts.yieldEach) yield x;
    }
    const alive = new Set(states.map((s) => s.o));
    let mask = 0;
    for (const s of states) mask |= s.m;
    const ok = opts.require ? opts.require(alive, nO) : alive.size === nO;
    return { ok, origins: alive.size, alive, survivors: states, mask, x };
  }

  function runToEnd(it) {
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // Entry states every new segment must be solvable from: a fixed band across the
  // corridor. Players pick their own routes, so a segment may not assume where the
  // previous one left them.
  const BAND = [300, 500, 700].map((y) => ({ y, vy: 0, I: B.neutralI }));
  const RUNWAY = 240;
  function pickEntries() { return BAND.slice(); }

  // ===========================================================================
  // 5. GENERATOR / DIRECTOR
  // ===========================================================================
  class WorldGen {
    constructor(seed) {
      this.rng = mulberry32(seed);
      this.frontier = 0;
      this.entries = BAND.slice();
      this.exitMid = 500;
      this.plan = ["intro", "gate", "arcRun", "open", "gate", "split"];
      this.job = null;
      this.tension = 0;
      this.recent = [];
      this.seen = new Set();
      this.out = [];
      this.stats = { segments: 0, attempts: 0, fails: 0, fallbacks: 0, validateMs: 0 };
    }
    choose(d) {
      if (this.plan.length) return this.plan.shift();
      if (this.tension > 2.5) { this.tension *= 0.25; return "open"; }
      let total = 0;
      const opts = [];
      for (const k in KINDS) {
        const K = KINDS[k];
        if (d < K.min) continue;
        if (this.recent.indexOf(k) >= 0) continue;
        let w = K.w;
        if (!this.seen.has(k) && K.min > 0) w *= 1.8; // introduce new things when unlocked
        if (k === "combo") w *= Math.min(1.5, d);
        opts.push([k, w]); total += w;
      }
      let r = this.rng() * total;
      for (const [k, w] of opts) { if ((r -= w) <= 0) return k; }
      return "gate";
    }
    startJob() {
      const d0 = diffAt(this.frontier);
      const kind = this.choose(d0);
      this.job = { kind, attempt: 0, d0 };
      this.buildCandidate();
    }
    buildCandidate() {
      const j = this.job;
      let d = j.d0;
      // First sight of a mechanic is gentle; failed validation backs difficulty off.
      if (!this.seen.has(j.kind) && KINDS[j.kind]) d = Math.min(d, KINDS[j.kind].min + 0.12);
      // Geometry tops out here; beyond it, pressure comes from speed and denser combinations.
      d = Math.min(d, 0.95) * Math.pow(0.78, j.attempt);
      const kind = j.attempt >= 4 ? "open" : j.kind;
      // Patterns open near the middle of where players can be; later obstacles roam freely.
      const ey = 0.5 * this.exitMid + 250;
      j.seg = buildSegment(kind, this.frontier, this.rng, d, ey);
      j.seg.entries = this.entries;
      // Validation starts inside the previous segment's open tail: that is where a player
      // first sees this segment's opening and begins to line up for it.
      const prev = this.prev;
      let x0 = j.seg.x0;
      if (prev) {
        let solidEnd = prev.x0;
        for (const o of prev.solids) if (o.x1 > solidEnd) solidEnd = o.x1;
        x0 = Math.min(j.seg.x0, Math.max(solidEnd + B.rMax + 20, j.seg.x0 - RUNWAY));
      }
      const slice = {
        x0, x1: j.seg.x1, rings: j.seg.rings,
        solids: prev ? prev.solids.filter((o) => o.x1 > x0 - B.rMax).concat(j.seg.solids) : j.seg.solids,
        fields: prev ? prev.fields.filter((f) => f.x1 > x0 - 40).concat(j.seg.fields) : j.seg.fields,
      };
      j.it = validateSlice(slice, this.entries, {
        beam: CFG.gen.beam, steps: CFG.gen.decisionSteps, margin: CFG.gen.margin, ringReach: CFG.gen.ringReach, yieldEach: true,
      });
      this.stats.attempts++;
    }
    // Advance generation for up to budgetMs. Returns a finished segment or null.
    pump(budgetMs) {
      const t0 = now();
      if (!this.job) this.startJob();
      for (;;) {
        const r = this.job.it.next();
        if (r.done) {
          const res = r.value, j = this.job;
          if (res.ok) {
            const seg = j.seg;
            seg.rings = seg.rings.filter((rg) => rg.bit && res.mask & rg.bit);
            this.entries = pickEntries(res.survivors);
            this.exitMid = res.survivors.reduce((a, s2) => a + s2.y, 0) / res.survivors.length;
            this.frontier = seg.x1;
            this.prev = seg;
            this.stats.segments++;
            if (seg.kind === "open" && j.kind !== "open") this.stats.fallbacks++;
            this.seen.add(j.kind);
            if (seg.kind === "combo") this.seen.add("combo");
            this.recent.push(j.kind);
            if (this.recent.length > 2) this.recent.shift();
            const K = KINDS[seg.kind];
            this.tension = seg.kind === "open" ? this.tension * 0.3 : this.tension + (K ? K.heat : 0.4) * (0.6 + 0.6 * Math.min(1, seg.d));
            this.job = null;
            this.stats.validateMs += now() - t0;
            return seg;
          }
          this.stats.fails++;
          j.attempt++;
          if (j.attempt > 6) {
            // Never stall: an empty stretch is always flyable from the band.
            j.seg = buildSegment("open", this.frontier, this.rng, 0, 500);
            j.seg.entries = this.entries;
            this.entries = BAND.slice();
            j.it = validateSlice(j.seg, this.entries, { beam: CFG.gen.beam, steps: CFG.gen.decisionSteps, margin: CFG.gen.margin, ringReach: CFG.gen.ringReach, yieldEach: true, require: () => true });
            continue;
          }
          this.buildCandidate();
        }
        if (now() - t0 > budgetMs) { this.stats.validateMs += now() - t0; return null; }
      }
    }
    // Generate synchronously until frontier >= x.
    fillTo(x, sink) {
      while (this.frontier < x) {
        const seg = this.pump(1e9);
        if (seg) sink(seg);
      }
    }
  }

  function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  // Look-ahead autopilot (used by tests and as a self-check; never by the player).
  function planAction(st, segs, horizonSec, greed) {
    if (greed === undefined) greed = 1;
    const solids = [], fields = [], rings = [];
    const x1 = st.x + speedAt(st.x) * horizonSec;
    for (const s of segs) {
      if (s.x1 < st.x - 200 || s.x0 > x1 + 200) continue;
      for (const o of s.solids) solids.push(o);
      for (const f of s.fields) fields.push(f);
      for (const r of s.rings) if (!r.taken && r.x > st.x && r.x < x1) rings.push(r);
    }
    rings.forEach((r, i) => (r._b = i < 30 ? 1 << i : 0));
    const ringsB = rings.map((r) => ({ x: r.x, y: r.y, big: r.big, bit: r._b }));
    const it = validateSlice({ x0: st.x, x1, solids, fields, rings: ringsB }, [{ y: st.y, vy: st.vy, I: st.I }], {
      beam: 60, steps: 15, margin: 3, ringReach: 0.5, yieldEach: false,
    });
    const res = runToEnd(it);
    if (!res.survivors || !res.survivors.length) return st.vy > 0 ? 1 : 0;
    let best = null, bs = -1e9;
    for (const s of res.survivors) {
      const sc = popcount(s.m) * 40 * greed + Math.min(s.c, 40) - Math.abs(s.y - 500) * 0.02;
      if (sc > bs) { bs = sc; best = s; }
    }
    return best.a0;
  }

  const CORE = { CFG, radiusOf, inflOfRadius, diffAt, speedAt, physStep, polyDist, solidClearance, buildSegment, validateSlice, runToEnd, WorldGen, mulberry32, planAction, PAT, KINDS };
  if (typeof globalThis !== "undefined" && globalThis.__INFLATE_TEST__) globalThis.__INFLATE_CORE__ = CORE;

  // ===========================================================================
  // 6. THE BIT
  // ===========================================================================
  const SKINS = [
    { id: "terracotta", name: "Terracotta", cost: 0, base: "#dd5a40", light: "#ffb196", dark: "#8f2b1c" },
    { id: "sky", name: "Sky", cost: 60, base: "#78acd2", light: "#e2f1fa", dark: "#2f5f86" },
    { id: "butter", name: "Butter", cost: 120, base: "#ecc152", light: "#fff3c2", dark: "#a27a14" },
    { id: "sage", name: "Sage", cost: 200, base: "#8ea97c", light: "#e1ecd5", dark: "#4d6844" },
    { id: "plum", name: "Plum", cost: 300, base: "#7c3c61", light: "#d29ab9", dark: "#3e1830" },
    { id: "pearl", name: "Pearl", cost: 450, base: "#e9dfe9", light: "#ffffff", dark: "#9c8aab", pearl: true },
    { id: "vintage", name: "Vintage", cost: 650, base: "#efe3c8", light: "#fffaf0", dark: "#a8916a", stripes: "#c8483a" },
  ];
  const TRAILS = [
    { id: "none", name: "No trail", cost: 0 },
    { id: "spark", name: "Gold dust", cost: 150 },
    { id: "petal", name: "Petals", cost: 350 },
  ];
  const MISSIONS = [
    { id: "rings15", text: "Collect 15 rings in one run", stat: "rings", goal: 15, reward: 30 },
    { id: "near3", text: "Earn 3 close calls in one run", stat: "near", goal: 3, reward: 30 },
    { id: "dist500", text: "Fly 500 m in one run", stat: "dist", goal: 500, reward: 35 },
    { id: "arches6", text: "Pass 6 arches in one run", stat: "gates", goal: 6, reward: 35 },
    { id: "full1", text: "Take a gold ring while nearly full", stat: "fullRing", goal: 1, reward: 40 },
    { id: "perfect1", text: "Pull off a Perfect clearance", stat: "perfect", goal: 1, reward: 45 },
    { id: "mult3", text: "Reach a ×3 streak", stat: "mult", goal: 3, reward: 50 },
    { id: "rings30", text: "Collect 30 rings in one run", stat: "rings", goal: 30, reward: 60 },
    { id: "near8", text: "Earn 8 close calls in one run", stat: "near", goal: 8, reward: 70 },
    { id: "dist1200", text: "Fly 1,200 m in one run", stat: "dist", goal: 1200, reward: 80 },
    { id: "big5", text: "Collect 5 gold rings in one run", stat: "bigRings", goal: 5, reward: 60 },
    { id: "mult5", text: "Reach a ×5 streak", stat: "mult", goal: 5, reward: 120 },
  ];

  const PAL = {
    stone: "#ece2cc", stoneLit: "#f6eedd", stoneShade: "#d3c5a6", stoneDeep: "#b6a585",
    joint: "rgba(122,98,64,0.17)", haze: "rgba(178,204,206,", sky0: "#3f7c82", sky1: "#8dbab4", sky2: "#e9dcbf", sky3: "#f3e9d3",
    terracotta: "#c6553c", terracottaDark: "#8a3324", sage: "#8ea27f", green: "#5b7a4f", greenDark: "#3f5a3a",
    gold: "#e9b949", goldLight: "#fbe7a6", goldDark: "#a8771b", ink: "#3b3730", ivory: "#fbf6ea",
  };

  function svgCoin(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 18.5 10 10 18.5 1.5 10Z" fill="none" stroke="#e9b949" stroke-width="2.2"/><path d="M10 6 14 10 10 14 6 10Z" fill="#e9b949"/></svg>';
  }
  const SVG_FINGER = '<svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true"><path d="M13 21V6.5a2.5 2.5 0 0 1 5 0V18l1-.2V15a2.4 2.4 0 0 1 4.8 0v3.6l.8-.1v-1.8a2.4 2.4 0 0 1 4.8 0V27c0 6.5-4.4 11-10.6 11-4.3 0-7-1.9-9.2-5.4L5 25.6a2.3 2.3 0 0 1 3.7-2.7L13 27" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_PAUSE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.4" height="12" rx="1" fill="currentColor"/><rect x="9.6" y="2" width="3.4" height="12" rx="1" fill="currentColor"/></svg>';
  const SVG_SOUND = '<svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M2 5.5h3L9 2v12l-4-3.5H2z" fill="currentColor"/><path class="w" d="M12 5c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M14.3 2.8C16 4.2 16.8 6 16.8 8s-.8 3.8-2.5 5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="x" d="M12 5.5l5 5M17 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  // Shop preview: the same balloon, as inline SVG.
  function balloonSVG(skin) {
    const id = "infb-" + skin.id;
    let extra = "";
    if (skin.stripes) {
      let paths = "";
      for (let k = -3; k <= 3; k += 2) {
        const a1 = (Math.sin((k / 7) * Math.PI) * 2.1).toFixed(3), a2 = (Math.sin(((k + 1) / 7) * Math.PI) * 2.1).toFixed(3);
        paths += `<path d="M0 -1.1Q${a1} 0 0 1.1Q${a2} 0 0 -1.1Z"/>`;
      }
      extra += `<g clip-path="url(#${id}c)" fill="${skin.stripes}" opacity=".85">${paths}</g>`;
    }
    if (skin.pearl) extra += `<circle r="1" fill="url(#${id}p)"/>`;
    return `<svg class="bal" viewBox="-1.3 -1.3 2.6 3.1" aria-hidden="true"><defs>` +
      `<radialGradient id="${id}g" cx="0.31" cy="0.27" r="0.72"><stop offset="0" stop-color="${skin.light}"/><stop offset="0.42" stop-color="${skin.base}"/><stop offset="1" stop-color="${skin.dark}"/></radialGradient>` +
      `<linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,190,220,.35)"/><stop offset=".5" stop-color="rgba(190,230,255,.35)"/><stop offset="1" stop-color="rgba(220,255,210,.3)"/></linearGradient>` +
      `<clipPath id="${id}c"><circle r="1"/></clipPath></defs>` +
      `<path d="M0 1.13C.12 1.38-.12 1.52.03 1.76" stroke="rgba(80,70,60,.6)" stroke-width=".035" fill="none"/>` +
      `<circle r="1" fill="url(#${id}g)"/>${extra}` +
      `<circle r="1" fill="none" stroke="rgba(60,25,15,.25)" stroke-width=".035"/>` +
      `<ellipse cx="-.42" cy="-.5" rx=".19" ry=".33" transform="rotate(-36 -.42 -.5)" fill="rgba(255,255,255,.62)"/>` +
      `<path d="M-.09 1.01H.09L.13 1.13H-.13Z" fill="${skin.dark}"/></svg>`;
  }

  const CSS = `
.inf{position:absolute;inset:0;font-family:Inter,"Helvetica Neue",Helvetica,Arial,sans-serif;color:${PAL.ivory};-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;pointer-events:none;--st:0px;--sb:0px}
.inf *{box-sizing:border-box}
:where(.inf) button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;pointer-events:auto;touch-action:manipulation;white-space:nowrap}
.inf-hud{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:calc(var(--st) + 14px) 18px 0;transition:opacity .3s}
.inf-hud.off{opacity:0}
.inf-hud::before{content:"";position:absolute;left:0;right:0;top:0;height:calc(var(--st) + 120px);background:linear-gradient(to bottom,rgba(34,64,66,.34),rgba(34,64,66,0));z-index:-1;pointer-events:none}
.inf-score{font-weight:600;font-size:30px;line-height:1;letter-spacing:.02em;text-shadow:0 1px 2px rgba(40,46,44,.45),0 1px 12px rgba(30,50,50,.3);font-variant-numeric:tabular-nums}
.inf-score.best{color:#ffe7a8}
.inf-label{font-size:9.5px;letter-spacing:.32em;opacity:.9;margin-top:6px;text-shadow:0 1px 2px rgba(40,46,44,.5)}
.inf-mult{margin-top:10px;text-shadow:0 1px 2px rgba(40,46,44,.5);display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.14em;opacity:0;transform:translateY(-4px);transition:opacity .25s,transform .25s}
.inf-mult.on{opacity:1;transform:none}
.inf-mult i{display:block;width:44px;height:2px;background:rgba(251,246,234,.3);border-radius:2px;overflow:hidden}
.inf-mult i b{display:block;height:100%;background:${PAL.goldLight};width:100%}
.inf-newbest{margin-top:8px;font-size:10px;letter-spacing:.3em;color:#ffe7a8;opacity:0;transition:opacity .3s}
.inf-newbest.on{opacity:1}
.inf-right{display:flex;align-items:center;gap:6px}
.inf-coins{display:flex;align-items:center;gap:7px;font-weight:600;font-size:17px;margin-right:4px;height:38px;padding:0 13px;border-radius:999px;background:rgba(40,70,72,.22);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(40,46,44,.45),0 1px 10px rgba(30,50,50,.25)}
.inf-icon{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(40,70,72,.22);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.inf-icon .x{display:none}.inf-icon.muted .x{display:inline}.inf-icon.muted .w{display:none}
.inf-cue{position:absolute;left:50%;top:var(--cue);transform:translateX(-50%);text-align:center;font-size:12px;font-weight:600;letter-spacing:.34em;margin-right:-.34em;line-height:1.9;opacity:0;transition:opacity .35s;color:${PAL.ink};white-space:nowrap}
.inf-cue.on{opacity:1}
.inf-cue svg{display:block;margin:8px auto 0;color:${PAL.ink};opacity:.8;animation:infPress 1.4s ease-in-out infinite}
@keyframes infPress{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(3px) scale(.94)}}
.inf-toast{position:absolute;left:50%;top:calc(var(--st) + 84px);transform:translate(-50%,-6px);padding:9px 16px;border-radius:999px;background:rgba(251,246,234,.92);color:${PAL.ink};font-size:11px;letter-spacing:.2em;font-weight:600;opacity:0;transition:opacity .3s,transform .3s;white-space:nowrap}
.inf-toast.on{opacity:1;transform:translate(-50%,0)}
.inf-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .35s,visibility 0s .35s}
.inf-screen.on{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .35s}
.inf-menu{justify-content:space-between;padding:calc(var(--st) + 9vh) 24px calc(var(--sb) + 28px);background:linear-gradient(to bottom,rgba(40,80,84,.25),rgba(0,0,0,0) 30%,rgba(0,0,0,0) 52%,rgba(243,234,214,.9) 80%)}
.inf-title{font-weight:400;font-size:clamp(46px,15vw,86px);letter-spacing:.34em;margin-right:-.34em;line-height:1;text-shadow:0 2px 24px rgba(40,70,70,.18)}
.inf-tag{margin-top:18px;font-size:11px;letter-spacing:.42em;margin-right:-.42em;text-align:center;line-height:2;opacity:.95}
.inf-rule{width:34px;height:1px;background:currentColor;margin:18px auto 0;opacity:.7}
.inf-bottom{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;color:${PAL.ink}}
.inf-best{font-size:10px;letter-spacing:.32em;opacity:.7;margin-bottom:14px}
.inf-best b{font-weight:600;letter-spacing:.08em;font-size:13px;opacity:1}
.inf-play{background:${PAL.terracotta};color:${PAL.ivory};padding:19px 0;width:min(100%,300px);border-radius:999px;font-weight:600;font-size:14px;letter-spacing:.42em;text-indent:.42em;box-shadow:0 10px 30px rgba(140,50,30,.28),inset 0 1px 0 rgba(255,255,255,.18);transition:transform .15s}
.inf-play:active{transform:scale(.97)}
.inf-row{display:flex;gap:10px;margin-top:14px;justify-content:center}
.inf-ghost{padding:11px 18px;border-radius:999px;border:1px solid rgba(59,55,48,.22)!important;font-size:10.5px;letter-spacing:.26em;font-weight:600;color:${PAL.ink};display:flex;align-items:center;gap:8px}
.inf-missions{width:100%;margin-bottom:18px;display:flex;flex-direction:column;gap:7px}
.inf-mission{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.02em}
.inf-mission .bar{flex:0 0 46px;height:3px;border-radius:3px;background:rgba(59,55,48,.14);overflow:hidden}
.inf-mission .bar b{display:block;height:100%;background:${PAL.terracotta}}
.inf-mission .t{flex:1;opacity:.85}
.inf-mission .r{font-weight:600;font-size:11px;display:flex;align-items:center;gap:4px;opacity:.8}
.inf-mission.done .t{text-decoration:line-through;opacity:.5}
.inf-over{justify-content:flex-end;padding:calc(var(--st) + 20px) 24px calc(var(--sb) + 26px);background:linear-gradient(to bottom,rgba(243,234,214,0) 0%,rgba(243,234,214,.55) 28%,rgba(243,234,214,.96) 50%);color:${PAL.ink}}
.inf-big{font-size:clamp(62px,20vw,96px);font-weight:400;letter-spacing:.02em;line-height:1;font-variant-numeric:tabular-nums}
.inf-sub{font-size:10px;letter-spacing:.36em;margin-top:8px;opacity:.6}
.inf-flag{margin-top:12px;padding:6px 12px;border-radius:999px;background:${PAL.terracotta};color:${PAL.ivory};font-size:10px;letter-spacing:.3em;font-weight:600;display:none}
.inf-flag.on{display:inline-block}
.inf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;width:100%;max-width:400px;margin:24px 0 18px;text-align:center}
.inf-stats b{display:block;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.inf-stats span{font-size:8.5px;letter-spacing:.24em;opacity:.55}
.inf-earn{display:flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.06em;margin-bottom:6px}
.inf-next{font-size:11px;letter-spacing:.06em;opacity:.6;margin-bottom:18px;min-height:14px;text-align:center}
.inf-pause{justify-content:center;background:rgba(243,234,214,.82);color:${PAL.ink};gap:14px}
.inf-pause h2{font-weight:400;font-size:13px;letter-spacing:.5em;margin:0 0 10px}
.inf-shop{background:rgba(243,234,214,.97);color:${PAL.ink};padding:calc(var(--st) + 18px) 18px calc(var(--sb) + 18px);overflow-y:auto;-webkit-overflow-scrolling:touch}
.inf-shop header{width:100%;max-width:440px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.inf-shop h2{font-weight:400;font-size:14px;letter-spacing:.46em;margin:0}
.inf-shop h3{width:100%;max-width:440px;font-weight:600;font-size:9.5px;letter-spacing:.32em;opacity:.55;margin:18px 0 10px}
.inf-grid{width:100%;max-width:440px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.inf-card{border-radius:16px;padding:10px 6px 12px;display:flex!important;flex-direction:column;align-items:center;gap:4px;background:rgba(255,255,255,.45)!important;border:1px solid rgba(59,55,48,.08)!important;color:${PAL.ink}!important;transition:transform .15s}
.inf-card:active{transform:scale(.97)}
.inf-card svg.bal{width:72px;height:86px}
.inf-card .n{font-size:11px;letter-spacing:.08em;font-weight:600}
.inf-card .s{font-size:9.5px;letter-spacing:.18em;opacity:.65;display:flex;align-items:center;gap:4px}
.inf-card.eq{border-color:${PAL.terracotta}!important;background:rgba(255,255,255,.75)!important}
.inf-card.eq .s{color:${PAL.terracotta};opacity:1}
.inf-card.locked.poor svg.bal{opacity:.45;filter:saturate(.35)}
.inf-card.poor .s{opacity:.4}
.inf-card.buy .s{color:${PAL.terracotta};opacity:1;font-weight:600}
.inf-card.pop{animation:infPop .6s ease}
@keyframes infPop{0%{transform:scale(1)}35%{transform:scale(1.08)}100%{transform:scale(1)}}
.inf-trail{height:84px;display:flex;align-items:center;justify-content:center;font-size:22px}
@media (max-height:640px){.inf-missions{display:none}.inf-menu{padding-top:calc(var(--st) + 5vh)}.inf-stats{margin:14px 0 10px}}
`;

  window.plethoraBit = {
    meta: {
      title: "Inflate",
      runtime: "plethora-bit@2",
      tags: ["arcade", "endless", "one-touch"],
      permissions: ["audio", "haptics", "storage"],
    },

    async init(ctx) {
      const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, alpha: false, touchAction: "none", layer: "content" });
      const g = canvas.getContext("2d");
      const input = ctx.input.track(canvas, { preventDefault: true, pointerCapture: true });
      const cap = ctx.capabilities || {};

      // ---------------------------------------------------------------- persistence
      const SAVE_KEY = "inflate.v1";
      const defaults = { best: 0, bestDist: 0, coins: 0, owned: ["terracotta", "none"], skin: "terracotta", trail: "none", missions: [0, 1, 2], nextMission: 3, done: [], runs: 0, taught: 0, muted: false };
      let save = Object.assign({}, defaults);
      try {
        const raw = cap.storage !== false && ctx.storage ? ctx.storage.get(SAVE_KEY) : null;
        if (raw && typeof raw === "object") save = Object.assign({}, defaults, raw);
      } catch (e) { /* storage unavailable — play on with defaults */ }
      function persist() {
        try { if (ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { /* ignore */ }
      }
      function skinById(id) { return SKINS.find((s) => s.id === id) || SKINS[0]; }

      // ---------------------------------------------------------------- audio
      const audio = createAudio();
      audio.setMuted(!!save.muted);
      function haptic(kind) {
        if (!cap.haptics) return;
        try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ }
      }

      // ---------------------------------------------------------------- view
      const view = { w: 1, h: 1, s: 1, oy: 0, frameX: 0, frameW: 1, playOff: 0, menuOff: 0, off: 0, safeTop: 0, safeBottom: 0 };
      let skyGrad = null, sunGrad = null, airGrad = null;
      const tiles = { far: null, mid: null, cloudBack: null, cloudFront: null, w: 1 };

      function layout() {
        const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
        const sa = ctx.safeArea || { top: 0, bottom: 0 };
        view.w = w; view.h = h; view.safeTop = sa.top || 0; view.safeBottom = sa.bottom || 0;
        const avail = h - view.safeTop - view.safeBottom;
        view.s = Math.min((avail - 110) / CFG.H, w / CFG.minViewW);
        view.s = Math.max(0.2, view.s);
        const extra = avail - CFG.H * view.s;
        view.oy = view.safeTop + Math.max(80, extra * 0.42);
        if (view.oy + CFG.H * view.s > h - view.safeBottom - 20) view.oy = Math.max(view.safeTop + 60, h - view.safeBottom - 20 - CFG.H * view.s);
        view.frameW = Math.min(w, h * 1.05);
        view.frameX = (w - view.frameW) / 2;
        view.playOff = (view.frameX + view.frameW * 0.27) / view.s;
        view.menuOff = (w * 0.5) / view.s;
        if (!view.off) view.off = view.menuOff;
        skyGrad = g.createLinearGradient(0, 0, 0, h);
        const floorY = view.oy + CFG.H * view.s;
        skyGrad.addColorStop(0, PAL.sky0);
        skyGrad.addColorStop(clamp01((view.oy + 120 * view.s) / h), PAL.sky1);
        skyGrad.addColorStop(clamp01((floorY - 260 * view.s) / h), PAL.sky2);
        skyGrad.addColorStop(1, PAL.sky3);
        const sunX = view.frameX + view.frameW * 0.3, sunY = view.oy + 150 * view.s, sunR = 120 * view.s;
        sunGrad = g.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 3.2);
        sunGrad.addColorStop(0, "rgba(255,246,222,0.85)"); sunGrad.addColorStop(0.3, "rgba(253,238,204,0.35)"); sunGrad.addColorStop(1, "rgba(253,238,204,0)");
        airGrad = g.createLinearGradient(0, -40 * view.s, 0, 30 * view.s);
        airGrad.addColorStop(0, "rgba(240,246,244,0)"); airGrad.addColorStop(0.6, "rgba(240,246,244,0.18)"); airGrad.addColorStop(1, "rgba(240,246,244,0)");
        buildTiles();
        rootEl.style.setProperty("--st", view.safeTop + "px");
        rootEl.style.setProperty("--sb", view.safeBottom + "px");
        // Cue sits on the cloud sea, below the playfield, where it never covers gameplay.
        rootEl.style.setProperty("--cue", Math.min(h - view.safeBottom - 86, view.oy + CFG.H * view.s + 30) + "px");
      }

      // Procedural parallax layers. Each is a hidden SDK canvas used as a paint-once buffer,
      // created once and repainted whenever the viewport changes.
      const layerBufs = {};
      function layerBuf(name, maxDpr) {
        if (!layerBufs[name]) {
          const c = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr, layer: "background", input: "passthrough" });
          c.style.visibility = "hidden";
          c.setAttribute("aria-hidden", "true");
          layerBufs[name] = { c, t: c.getContext("2d") };
        }
        return layerBufs[name];
      }
      function buildTiles() {
        const dpr = Math.min(2, ctx.dpr || 1);
        const W = Math.ceil(view.w), H = Math.ceil(view.h);
        tiles.w = W;
        const s = view.s, floorY = view.oy + CFG.H * s;
        const rng = mulberry32(1234);
        const far = layerBuf("far", 1);
        paintFar(far.t, W, H, floorY, s, rng);
        tiles.far = far.c;
        const mid = layerBuf("mid", Math.min(1.5, dpr));
        paintMid(mid.t, W, H, floorY, s, rng);
        tiles.mid = mid.c;
        const cb = layerBuf("cloudBack", 1);
        paintClouds(cb.t, W, H, floorY - 200 * s, s, rng, 0.85);
        tiles.cloudBack = cb.c;
        const cf = layerBuf("cloudFront", Math.min(1.5, dpr));
        paintClouds(cf.t, W, H, floorY + 22 * s, s, rng, 1);
        tiles.cloudFront = cf.c;
        tiles.painted = far.c.width + "x" + far.c.height;
      }

      function paintFar(t, W, H, floorY, s, rng) {
        t.clearRect(0, 0, W, H);
        t.fillStyle = "rgba(160,186,190,0.55)";
        const n = Math.ceil(W / (70 * Math.max(0.5, s)));
        for (let i = 0; i < n; i++) {
          const w = (24 + rng() * 60) * s, x = 10 + rng() * (W - w - 20);
          const top = floorY - (220 + rng() * 620) * s;
          t.fillRect(x, top, w, floorY - top + 40);
          if (rng() < 0.4) { t.beginPath(); t.moveTo(x - 3, top); t.lineTo(x + w / 2, top - (20 + rng() * 50) * s); t.lineTo(x + w + 3, top); t.fill(); }
          else if (rng() < 0.4) { t.beginPath(); t.arc(x + w / 2, top, w / 2, Math.PI, 0); t.fill(); }
        }
        // Aqueduct
        const ay = floorY - (280 + rng() * 120) * s, ax0 = W * 0.1, ax1 = W * 0.75, span = 64 * s;
        t.fillStyle = "rgba(170,195,198,0.7)";
        t.beginPath();
        t.rect(ax0, ay - 26 * s, ax1 - ax0, 26 * s);
        for (let x = ax0; x < ax1 - span * 0.5; x += span) t.rect(x, ay, 12 * s, floorY - ay + 40);
        t.fill();
        t.fillStyle = "rgba(170,195,198,0.7)";
        for (let x = ax0; x < ax1 - span; x += span) { t.beginPath(); t.moveTo(x, ay); t.arc(x + span / 2 + 6 * s, ay, span / 2 - 6 * s, Math.PI, 0, false); t.lineTo(x + span + 12 * s, ay); t.lineTo(x + span + 12 * s, ay - 2); t.lineTo(x, ay - 2); t.closePath(); }
        // Atmospheric wash
        const hz = t.createLinearGradient(0, 0, 0, H);
        hz.addColorStop(0, "rgba(233,224,200,0)"); hz.addColorStop(0.75, "rgba(236,226,204,0.35)"); hz.addColorStop(1, "rgba(240,232,214,0.6)");
        t.fillStyle = hz; t.fillRect(0, 0, W, H);
      }

      function paintMid(t, W, H, floorY, s, rng) {
        t.clearRect(0, 0, W, H);
        const n = Math.max(3, Math.ceil(W / (230 * Math.max(0.5, s))));
        for (let i = 0; i < n; i++) {
          const w = (60 + rng() * 90) * s;
          const x = (i + 0.15 + rng() * 0.5) * (W / n) - w / 2;
          if (x < 8 || x + w > W - 8) continue;
          const top = floorY - (330 + rng() * 520) * s;
          const lit = "rgba(222,220,206,0.8)", shade = "rgba(200,204,194,0.8)";
          t.fillStyle = lit; t.fillRect(x, top, w * 0.72, floorY - top + 60);
          t.fillStyle = shade; t.fillRect(x + w * 0.72, top, w * 0.28, floorY - top + 60);
          t.fillStyle = "rgba(214,202,176,0.95)"; t.fillRect(x - 5 * s, top - 10 * s, w + 10 * s, 12 * s);
          // windows
          t.fillStyle = "rgba(120,120,110,0.28)";
          const rows = Math.floor((floorY - top) / (70 * s));
          for (let r = 1; r < rows; r++) {
            if (rng() < 0.45) continue;
            const wy = top + r * 70 * s, ww = 9 * s;
            t.beginPath(); t.rect(x + w * 0.3, wy, ww, 18 * s); t.arc(x + w * 0.3 + ww / 2, wy, ww / 2, Math.PI, 0); t.fill();
          }
          // banner
          if (rng() < 0.55) {
            const bx = x + w * 0.18, bw = w * 0.32, bh = (90 + rng() * 120) * s, by = top + 20 * s;
            t.fillStyle = "rgba(196,120,104,0.5)";
            t.beginPath(); t.moveTo(bx, by); t.lineTo(bx + bw, by); t.lineTo(bx + bw, by + bh); t.lineTo(bx + bw / 2, by + bh - 14 * s); t.lineTo(bx, by + bh); t.closePath(); t.fill();
          }
          // greenery on top
          if (rng() < 0.7) {
            t.fillStyle = "rgba(92,122,82,0.85)";
            for (let k = 0; k < 4; k++) { t.beginPath(); t.arc(x + rng() * w, top - 8 * s, (8 + rng() * 10) * s, 0, Math.PI * 2); t.fill(); }
          }
          if (rng() < 0.6) {
            const cx = x + w * (0.2 + rng() * 0.6), ch = (50 + rng() * 50) * s;
            t.fillStyle = "rgba(64,92,62,0.9)";
            t.beginPath(); t.ellipse(cx, top - 10 * s - ch / 2, 8 * s, ch / 2, 0, 0, Math.PI * 2); t.fill();
          }
        }
        const hz = t.createLinearGradient(0, 0, 0, H);
        hz.addColorStop(0, "rgba(172,204,206,0.42)"); hz.addColorStop(0.8, "rgba(226,228,214,0.4)"); hz.addColorStop(1, "rgba(240,232,214,0.6)");
        t.globalCompositeOperation = "source-atop"; t.fillStyle = hz; t.fillRect(0, 0, W, H); t.globalCompositeOperation = "source-over";
      }

      // Seamless cloud bank: puffs that cross an edge are also drawn wrapped onto the other side.
      function paintClouds(t, W, H, top, s, rng, alpha) {
        t.clearRect(0, 0, W, H);
        const n = Math.ceil(W / (26 * Math.max(0.4, s)));
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < n; i++) {
            const r = (40 + rng() * 70) * s * (pass ? 0.8 : 1.15);
            const x = rng() * W;
            const y = top + (pass ? 40 : 10) * s + rng() * 50 * s + r * 0.6;
            for (const ox of [0, -W, W]) {
              const cx = x + ox;
              if (cx + r < 0 || cx - r > W) continue;
              const gr = t.createRadialGradient(cx - r * 0.25, y - r * 0.35, r * 0.1, cx, y, r);
              gr.addColorStop(0, `rgba(255,252,244,${alpha})`);
              gr.addColorStop(0.55, `rgba(246,240,228,${alpha * 0.92})`);
              gr.addColorStop(1, "rgba(238,232,220,0)");
              t.fillStyle = gr; t.beginPath(); t.arc(cx, y, r, 0, Math.PI * 2); t.fill();
            }
          }
        }
        const base = t.createLinearGradient(0, top + 40 * s, 0, top + 170 * s);
        base.addColorStop(0, "rgba(245,240,229,0)");
        base.addColorStop(1, `rgba(245,240,229,${alpha})`);
        t.fillStyle = base;
        t.fillRect(0, top + 40 * s, W, H);
      }

      // ---------------------------------------------------------------- UI
      const rootEl = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "inf-wrap" });
      rootEl.innerHTML = `<style>${CSS}</style>
<div class="inf">
  <div class="inf-hud off" data-r="hud">
    <div><div class="inf-score" data-r="score">0</div><div class="inf-label">SCORE</div>
      <div class="inf-mult" data-r="mult"><span data-r="multTxt">×1.5</span><i><b data-r="multBar"></b></i></div>
      <div class="inf-newbest" data-r="newbest">NEW BEST</div></div>
    <div class="inf-right"><div class="inf-coins">${svgCoin(16)}<span data-r="coins">0</span></div>
      <button class="inf-icon" data-r="mute" aria-label="Sound">${SVG_SOUND}</button>
      <button class="inf-icon" data-r="pause" aria-label="Pause">${SVG_PAUSE}</button></div>
  </div>
  <div class="inf-cue" data-r="cue"><span data-r="cueTxt">HOLD TO INFLATE</span>${SVG_FINGER}</div>
  <div class="inf-toast" data-r="toast"></div>
  <div class="inf-screen inf-menu on" data-r="menu">
    <div style="text-align:center"><div class="inf-title">INFLATE</div><div class="inf-tag">HOLD TO GROW<br>LET GO TO SLIP THROUGH</div><div class="inf-rule"></div></div>
    <div class="inf-bottom">
      <div class="inf-missions" data-r="missions"></div>
      <div class="inf-best" data-r="menuBest"></div>
      <button class="inf-play" data-r="play">PLAY</button>
      <div class="inf-row"><button class="inf-ghost" data-r="shopBtn">${svgCoin(13)}<span>BALLOONS</span></button><button class="inf-ghost" data-r="menuMute">SOUND ON</button></div>
    </div>
  </div>
  <div class="inf-screen inf-over" data-r="over">
    <div class="inf-big" data-r="oScore">0</div><div class="inf-sub">SCORE</div><div class="inf-flag" data-r="oFlag">NEW BEST</div>
    <div class="inf-stats"><div><b data-r="oDist">0</b><span>METRES</span></div><div><b data-r="oRings">0</b><span>RINGS</span></div><div><b data-r="oNear">0</b><span>CLOSE</span></div><div><b data-r="oMult">×1</b><span>STREAK</span></div></div>
    <div class="inf-earn">${svgCoin(15)}<span data-r="oEarn">+0</span></div>
    <div class="inf-next" data-r="oNext"></div>
    <button class="inf-play" data-r="again">PLAY AGAIN</button>
    <div class="inf-row"><button class="inf-ghost" data-r="oShop">${svgCoin(13)}<span>BALLOONS</span></button><button class="inf-ghost" data-r="oMenu">MENU</button></div>
  </div>
  <div class="inf-screen inf-pause" data-r="pauseScr"><h2>PAUSED</h2><button class="inf-play" data-r="resume">RESUME</button><button class="inf-ghost" data-r="pMenu">END RUN</button></div>
  <div class="inf-screen inf-shop" data-r="shop">
    <header><h2>BALLOONS</h2><div class="inf-coins" style="color:${PAL.ink};text-shadow:none">${svgCoin(16)}<span data-r="shopCoins">0</span></div></header>
    <div class="inf-grid" data-r="skinGrid"></div>
    <h3>TRAILS</h3>
    <div class="inf-grid" data-r="trailGrid"></div>
    <div style="height:18px"></div>
    <button class="inf-play" data-r="shopClose">DONE</button>
  </div>
</div>`;
      const $ = (k) => rootEl.querySelector(`[data-r="${k}"]`);
      const el = {};
      ["hud", "score", "mult", "multTxt", "multBar", "newbest", "coins", "mute", "pause", "cue", "cueTxt", "toast", "menu", "missions", "menuBest", "play", "shopBtn", "menuMute", "over", "oScore", "oFlag", "oDist", "oRings", "oNear", "oMult", "oEarn", "oNext", "again", "oShop", "oMenu", "pauseScr", "resume", "pMenu", "shop", "shopCoins", "skinGrid", "trailGrid", "shopClose"].forEach((k) => (el[k] = $(k)));

      function on(btn, fn) {
        const h = (e) => { if (e && e.stopPropagation) e.stopPropagation(); audio.unlock(); fn(); };
        if (ctx.input.activate) ctx.input.activate(btn, h);
        else ctx.listen(btn, "click", h);
        // Make sure presses on buttons never reach the inflate surface.
        ctx.listen(btn, "pointerdown", (e) => e.stopPropagation());
      }

      // Fonts: draw immediately with fallbacks; Inter swaps in when ready.
      if (ctx.loadFont) {
        Promise.all([
          ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }),
          ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }),
        ]).catch(() => {});
      }

      // ---------------------------------------------------------------- game state
      let state = "menu"; // menu | ready | playing | dying | over | paused
      let readyReason = "start";
      let worldGen = null;
      let segs = [];
      const bal = { x: 0, y: 500, vy: 0, I: B.startI, r: radiusOf(B.startI), prevI: B.startI };
      const look = { sq: 0, sqv: 0, wob: 0, wobv: 0, tilt: 0, hold: 0, danger: 0, flash: 0, fx: 0, fy: 0 };
      const rope = [];
      for (let i = 0; i < 8; i++) rope.push({ x: 0, y: 0, px: 0, py: 0 });
      let run = null;
      let camYOff = 0, shake = 0, simTime = 0, menuX = 0, slowmo = 1, dieTimer = 0;
      let heldPrev = false, keyHeld = false, lastReleaseSfx = 0;
      let scoreTrack = null;
      try { scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null; } catch (e) { scoreTrack = null; }
      let attempt = 0;
      const activeFields = [];

      function newRun() {
        const seed = (Math.random() * 2 ** 31) | 0;
        worldGen = new WorldGen(seed);
        segs = [];
        worldGen.fillTo(2600, (s) => segs.push(s));
        bal.x = 0; bal.y = 500; bal.vy = 0; bal.I = B.startI; bal.prevI = B.startI; bal.r = radiusOf(bal.I);
        look.sq = look.sqv = look.wob = look.wobv = 0; look.danger = 0;
        resetRope();
        run = {
          score: 0, distPts: 0, ringPts: 0, rings: 0, bigRings: 0, near: 0, perfect: 0, gates: 0, fullRing: 0,
          streak: 0, level: 0, maxMult: 1, sinceRisk: 0, coins: 0, newBest: false, bestFlagged: false,
          holdTime: 0, released: 0, taught: save.taught >= 2, stage: 0, missionsHit: [],
        };
        particles.clear(); texts.clear();
        if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { /* ignore */ } }
        updateHud(true);
      }

      function resetRope() {
        for (let i = 0; i < rope.length; i++) {
          const p = rope[i];
          p.x = p.px = bal.x - i * 2; p.y = p.py = bal.y + bal.r + i * 9;
        }
      }

      const testAuto = globalThis.__INFLATE_TEST__ ? { on: false, a: 0, k: 0 } : null;
      function heldNow() {
        if (testAuto && testAuto.on) return testAuto.a === 1;
        if (testAuto && testAuto.sched) return testAuto.sched(simTime);
        return !!(input.down || keyHeld);
      }

      // ---------------------------------------------------------------- particles (pooled)
      const particles = (function () {
        const N = 420, pool = [];
        for (let i = 0; i < N; i++) pool.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, kind: 0, rot: 0, vr: 0, col: "" });
        let cursor = 0;
        return {
          pool,
          spawn(kind, x, y, vx, vy, life, size, col) {
            for (let k = 0; k < N; k++) {
              const p = pool[(cursor + k) % N];
              if (!p.on) {
                cursor = (cursor + k + 1) % N;
                p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.size = size; p.col = col || ""; p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 8;
                return p;
              }
            }
            return null;
          },
          clear() { for (const p of pool) p.on = false; },
        };
      })();
      const P_SPARK = 1, P_SHARD = 2, P_WIND = 3, P_HEAT = 4, P_SUCK = 5, P_PETAL = 6, P_PUFF = 8, P_RINGFLASH = 9;

      const texts = (function () {
        const N = 10, pool = [];
        for (let i = 0; i < N; i++) pool.push({ on: false, x: 0, y: 0, t: "", life: 0, max: 1, big: false, col: "" });
        return {
          pool,
          add(x, y, t, big, col) {
            let best = pool[0];
            for (const p of pool) { if (!p.on) { best = p; break; } if (p.life < best.life) best = p; }
            best.on = true; best.x = x; best.y = y; best.t = t; best.life = best.max = big ? 1.3 : 0.9; best.big = !!big; best.col = col || PAL.ivory;
          },
          clear() { for (const p of pool) p.on = false; },
        };
      })();

      // ---------------------------------------------------------------- scoring
      function multNow() { return CFG.streak.mult[run.level]; }
      function addRisk(pts) {
        run.streak += pts;
        run.sinceRisk = 0;
        const L = CFG.streak.pts;
        let lv = 0;
        for (let i = 0; i < L.length; i++) if (run.streak >= L[i]) lv = i;
        if (lv > run.level) {
          run.level = lv;
          if (multNow() > run.maxMult) run.maxMult = multNow();
          audio.streak(lv);
        }
      }

      function collectRing(rg) {
        rg.taken = true;
        const big = rg.big;
        run.rings++;
        run.coins += big ? 3 : 1;
        if (big) { run.bigRings++; addRisk(1); if (bal.I >= 0.85) run.fullRing++; }
        const pts = Math.round((big ? CFG.score.bigRing : CFG.score.ring) * multNow());
        run.ringPts += pts;
        texts.add(bal.x + bal.r * 0.6, bal.y - bal.r - 22, "+" + pts, false, big ? PAL.goldLight : PAL.ivory);
        const n = big ? 16 : 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const sp = 120 + Math.random() * 140;
          particles.spawn(P_SPARK, rg.x, rg.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.45 + Math.random() * 0.3, big ? 3.2 : 2.4, PAL.goldLight);
        }
        particles.spawn(P_RINGFLASH, rg.x, rg.y, 0, 0, 0.35, big ? CFG.ring.bigR : CFG.ring.r);
        audio.ring(big);
        if (big) haptic("light");
        try { ctx.platform.interact({ type: "ring", big }); } catch (e) { /* ignore */ }
      }

      function resolveGroup(gp) {
        gp.done = true;
        if (gp.kind === "gate") run.gates++;
        const c = gp.minClear;
        let label = null, pts = 0, risk = 0;
        if (c < CFG.near.perfect) { label = "PERFECT"; pts = CFG.score.perfect; risk = 2; run.perfect++; }
        else if (c < CFG.near.thread) { label = "THREADED"; pts = CFG.score.thread; risk = 1; }
        else if (c < CFG.near.close) { label = "CLOSE CALL"; pts = CFG.score.close; risk = 1; }
        if (!label) return;
        run.near++;
        addRisk(risk);
        const total = Math.round(pts * multNow());
        run.ringPts += total;
        texts.add(bal.x + 10, bal.y - bal.r - 34, label + "  +" + total, true, label === "PERFECT" ? PAL.goldLight : PAL.ivory);
        look.sqv += label === "PERFECT" ? 2.2 : 1.4;
        look.flash = 1;
        look.fx = gp.cx - bal.x; look.fy = gp.cy - bal.y;
        audio.near(label === "PERFECT" ? 2 : label === "THREADED" ? 1 : 0);
        if (label === "PERFECT") haptic("medium");
        try { ctx.platform.milestone(label === "PERFECT" ? "perfect" : "close_call"); } catch (e) { /* ignore */ }
      }

      // ---------------------------------------------------------------- missions
      function missionStat(stat) {
        if (!run) return 0;
        switch (stat) {
          case "rings": return run.rings;
          case "near": return run.near;
          case "dist": return Math.floor(bal.x / 10);
          case "gates": return run.gates;
          case "fullRing": return run.fullRing;
          case "perfect": return run.perfect;
          case "mult": return run.maxMult;
          case "bigRings": return run.bigRings;
        }
        return 0;
      }
      function checkMissions() {
        for (let i = 0; i < save.missions.length; i++) {
          const m = MISSIONS[save.missions[i]];
          if (!m || run.missionsHit.indexOf(m.id) >= 0) continue;
          if (missionStat(m.stat) >= m.goal) {
            run.missionsHit.push(m.id);
            run.coins += m.reward;
            toast("MISSION COMPLETE  +" + m.reward);
            audio.chime();
          }
        }
      }
      function rotateMissions() {
        if (!run) return;
        for (let i = 0; i < save.missions.length; i++) {
          const m = MISSIONS[save.missions[i]];
          if (m && run.missionsHit.indexOf(m.id) >= 0) {
            save.done.push(m.id);
            let next = save.nextMission % MISSIONS.length, guard = 0;
            while ((save.missions.indexOf(next) >= 0) && guard++ < MISSIONS.length) next = (next + 1) % MISSIONS.length;
            save.missions[i] = next;
            save.nextMission = next + 1;
          }
        }
      }
      function renderMissions() {
        let h = "";
        for (const idx of save.missions) {
          const m = MISSIONS[idx];
          if (!m) continue;
          h += `<div class="inf-mission"><div class="bar"><b style="width:0%"></b></div><div class="t">${m.text}</div><div class="r">${svgCoin(11)}${m.reward}</div></div>`;
        }
        el.missions.innerHTML = h;
      }

      let toastTimer = 0;
      function toast(t) {
        el.toast.textContent = t;
        el.toast.classList.add("on");
        toastTimer = 2.2;
      }

      // ---------------------------------------------------------------- HUD
      const hudCache = { score: -1, coins: -1, mult: -1, bar: -1, best: false };
      function updateHud(force) {
        if (!run) return;
        const sc = run.score;
        if (force || sc !== hudCache.score) { el.score.textContent = String(sc); hudCache.score = sc; }
        const coins = save.coins + run.coins;
        if (force || coins !== hudCache.coins) { el.coins.textContent = String(coins); hudCache.coins = coins; }
        const m = multNow();
        if (force || m !== hudCache.mult) {
          hudCache.mult = m;
          el.multTxt.textContent = "×" + (m % 1 ? m.toFixed(1) : m) + " STREAK";
          el.mult.classList.toggle("on", m > 1);
        }
        const bar = m > 1 ? Math.round(clamp01(1 - run.sinceRisk / CFG.streak.decayAfter) * 100) : 0;
        if (bar !== hudCache.bar) { el.multBar.style.width = bar + "%"; hudCache.bar = bar; }
        if (run.newBest !== hudCache.best) {
          hudCache.best = run.newBest;
          el.score.classList.toggle("best", run.newBest);
        }
      }

      function showScreen(name) {
        for (const k of ["menu", "over", "pauseScr", "shop"]) el[k].classList.toggle("on", k === name);
        el.hud.classList.toggle("off", !(name === null || name === "pauseScr") || state === "menu");
      }

      function setCue(txt) {
        if (txt) { el.cueTxt.textContent = txt; el.cue.classList.add("on"); }
        else el.cue.classList.remove("on");
      }

      function refreshMenu() {
        el.menuBest.innerHTML = save.best > 0 ? `BEST &nbsp;<b>${save.best}</b>` : "&nbsp;";
        el.menuMute.textContent = save.muted ? "SOUND OFF" : "SOUND ON";
        el.mute.classList.toggle("muted", !!save.muted);
        renderMissions();
      }

      // ---------------------------------------------------------------- flow
      function goMenu() {
        state = "menu";
        run = null; segs = [];
        showScreen("menu");
        setCue(null);
        refreshMenu();
        bal.y = 500; bal.vy = 0; bal.I = 0.62;
      }

      function startRun() {
        newRun();
        state = "ready";
        readyReason = "start";
        showScreen(null);
        el.hud.classList.remove("off");
        setCue(run.taught ? "HOLD TO FLY" : "HOLD TO INFLATE");
      }

      function beginPlaying() {
        state = "playing";
        if (readyReason === "start") {
          attempt++;
          try { ctx.platform.start({ attempt }); } catch (e) { /* ignore */ }
        }
        if (run.taught || readyReason === "resume") setCue(null);
      }

      function die(solid) {
        if (state !== "playing") return;
        state = "dying";
        dieTimer = 1.05;
        slowmo = 0.25;
        shake = 1;
        audio.pop();
        audio.setHold(false, bal.I);
        haptic("heavy");
        const skin = skinById(save.skin);
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 320;
          particles.spawn(P_SHARD, bal.x + Math.cos(a) * bal.r * 0.6, bal.y + Math.sin(a) * bal.r * 0.6, Math.cos(a) * sp, Math.sin(a) * sp - 120, 0.9 + Math.random() * 0.5, bal.r * (0.16 + Math.random() * 0.14), skin.base);
        }
        particles.spawn(P_RINGFLASH, bal.x, bal.y, 0, 0, 0.4, bal.r * 1.1);
      }

      function finishRun() {
        state = "over";
        finalizeScore();
        const earned = run.coins;
        save.coins += earned;
        save.runs++;
        if (run.taught || run.released > 2) save.taught = Math.max(save.taught, 2);
        const isBest = run.score > save.best;
        if (isBest) { save.best = run.score; }
        save.bestDist = Math.max(save.bestDist, Math.floor(bal.x / 10));
        rotateMissions();
        persist();
        el.oScore.textContent = String(run.score);
        el.oFlag.classList.toggle("on", isBest && run.score > 0);
        el.oDist.textContent = String(Math.floor(bal.x / 10));
        el.oRings.textContent = String(run.rings);
        el.oNear.textContent = String(run.near);
        el.oMult.textContent = "×" + run.maxMult;
        el.oEarn.textContent = "+" + earned + "  ·  " + save.coins + " total";
        const next = nextUnlock();
        el.oNext.textContent = next ? (save.coins >= next.cost ? `${next.name} is ready to unlock` : `${next.name} in ${next.cost - save.coins} more`) : "Every balloon unlocked";
        showScreen("over");
        el.hud.classList.add("off");
        setCue(null);
        try { ctx.platform.fail({ score: run.score, distance: Math.floor(bal.x / 10) }); } catch (e) { /* ignore */ }
        // Leaderboard submit is detached: replay never waits on it.
        if (scoreTrack && scoreTrack.submit) {
          try { scoreTrack.submit("score", { label: run.score + " pts" }).catch(() => {}); } catch (e) { /* ignore */ }
        }
      }

      function finalizeScore() {
        run.score = run.distPts + run.ringPts;
        if (scoreTrack) { try { scoreTrack.set(run.score); } catch (e) { /* ignore */ } }
      }

      function nextUnlock() {
        const all = SKINS.concat(TRAILS).filter((s) => save.owned.indexOf(s.id) < 0).sort((a, b) => a.cost - b.cost);
        return all[0] || null;
      }

      function pauseGame() {
        if (state !== "playing" && state !== "ready") return;
        state = "paused";
        audio.setHold(false, bal.I);
        showScreen("pauseScr");
        setCue(null);
      }
      function resumeGame() {
        if (state !== "paused") return;
        state = "ready";
        readyReason = "resume";
        showScreen(null);
        el.hud.classList.remove("off");
        setCue("HOLD TO CONTINUE");
      }

      on(el.play, () => { audio.unlock(); startRun(); });
      on(el.again, () => startRun());
      on(el.oMenu, () => goMenu());
      on(el.oShop, () => openShop("over"));
      on(el.shopBtn, () => openShop("menu"));
      on(el.shopClose, () => closeShop());
      on(el.pause, () => pauseGame());
      on(el.resume, () => resumeGame());
      on(el.pMenu, () => { if (run) { state = "playing"; die(null); dieTimer = 0.01; } });
      const toggleMute = () => { save.muted = !save.muted; audio.setMuted(save.muted); persist(); refreshMenu(); };
      on(el.mute, toggleMute);
      on(el.menuMute, toggleMute);

      // Keyboard (desktop convenience): space / up arrow inflates.
      ctx.listen(window, "keydown", (e) => {
        if (e.code === "Space" || e.code === "ArrowUp") {
          if (e.preventDefault) e.preventDefault();
          if (state === "menu" && !e.repeat) { audio.unlock(); startRun(); return; }
          if (state === "over" && !e.repeat) { startRun(); return; }
          keyHeld = true;
        } else if (e.code === "Escape" || e.code === "KeyP") {
          if (state === "paused") resumeGame(); else pauseGame();
        }
      });
      ctx.listen(window, "keyup", (e) => { if (e.code === "Space" || e.code === "ArrowUp") keyHeld = false; });
      ctx.listen(window, "blur", () => { keyHeld = false; if (state === "playing") pauseGame(); });
      ctx.listen(document, "visibilitychange", () => { if (document.hidden) { keyHeld = false; pauseGame(); } });

      // ---------------------------------------------------------------- shop
      let shopFrom = "menu";
      function openShop(from) {
        shopFrom = from;
        renderShop();
        showScreen("shop");
      }
      function closeShop() {
        if (shopFrom === "over") { showScreen("over"); el.oNext.textContent = ""; }
        else { refreshMenu(); showScreen("menu"); }
      }
      function renderShop(popId) {
        el.shopCoins.textContent = String(save.coins);
        const card = (it, kind) => {
          const owned = save.owned.indexOf(it.id) >= 0;
          const eq = kind === "skin" ? save.skin === it.id : save.trail === it.id;
          const afford = !owned && save.coins >= it.cost;
          const cls = ["inf-card", eq ? "eq" : "", owned ? "" : "locked", !owned && !afford ? "poor" : "", afford ? "buy" : "", popId === it.id ? "pop" : ""].join(" ");
          const st = eq ? "EQUIPPED" : owned ? "EQUIP" : afford ? `UNLOCK ${svgCoin(10)}${it.cost}` : `${svgCoin(10)}${it.cost}`;
          const vis = kind === "skin" ? balloonSVG(it) : `<div class="inf-trail" data-trail="${it.id}">${it.id === "none" ? "—" : it.id === "spark" ? "✦" : "❀"}</div>`;
          return `<button class="${cls}" data-kind="${kind}" data-id="${it.id}">${vis}<div class="n">${it.name}</div><div class="s">${st}</div></button>`;
        };
        el.skinGrid.innerHTML = SKINS.map((s) => card(s, "skin")).join("");
        el.trailGrid.innerHTML = TRAILS.map((s) => card(s, "trail")).join("");
        rootEl.querySelectorAll(".inf-shop .inf-card").forEach((btn) => on(btn, () => shopPick(btn.getAttribute("data-kind"), btn.getAttribute("data-id"))));
      }
      function shopPick(kind, id) {
        const list = kind === "skin" ? SKINS : TRAILS;
        const it = list.find((s) => s.id === id);
        if (!it) return;
        if (save.owned.indexOf(id) < 0) {
          if (save.coins < it.cost) { toast(`NEED ${it.cost - save.coins} MORE`); return; }
          save.coins -= it.cost;
          save.owned.push(id);
          toast("UNLOCKED · " + it.name.toUpperCase());
          audio.chime();
          haptic("success");
        }
        if (kind === "skin") save.skin = id; else save.trail = id;
        persist();
        renderShop(id);
      }

      // ---------------------------------------------------------------- simulation tick (fixed 120 Hz)
      function gatherFields(x) {
        activeFields.length = 0;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (s.x1 < x - 100 || s.x0 > x + 100) continue;
          for (let k = 0; k < s.fields.length; k++) {
            const f = s.fields[k];
            if (x > f.x0 - 40 && x < f.x1 + 40) activeFields.push(f);
          }
        }
        return activeFields.length;
      }

      function tick(dt) {
        simTime += dt;
        if (testAuto && testAuto.onStep) testAuto.onStep(simTime, bal, state);
        const vdt = dt * slowmo;
        if (state === "playing") {
          if (testAuto && testAuto.on && testAuto.k++ % CFG.gen.decisionSteps === 0) testAuto.a = planAction(bal, segs, 2.2);
          const hold = heldNow();
          const nf = gatherFields(bal.x);
          bal.prevI = bal.I;
          const r = physStep(bal, hold, dt, activeFields, nf);
          bal.r = r;
          // tutorial bookkeeping
          if (hold) run.holdTime += dt;
          if (heldPrev && !hold) {
            run.released++;
            if (bal.I > 0.5 && simTime - lastReleaseSfx > 0.18) { audio.release(bal.I); lastReleaseSfx = simTime; }
            for (let i = 0; i < 4; i++) particles.spawn(P_PUFF, bal.x - r * 0.2, bal.y + r * 0.9, -60 - Math.random() * 60, 30 + Math.random() * 40, 0.5, r * 0.18);
          }
          if (!run.taught) {
            if (run.holdTime > 0.35 && run.released === 0) setCue("RELEASE TO SHRINK");
            if (run.released >= 1 && run.holdTime > 0.35) { run.taught = true; setCue(null); }
          }
          heldPrev = hold;
          audio.setHold(hold, bal.I);
          collide(r);
          if (state !== "playing") return;
          // rings
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (s.x1 < bal.x - 120 || s.x0 > bal.x + 120) continue;
            for (const rg of s.rings) {
              if (rg.taken || Math.abs(rg.x - bal.x) > r + 40) continue;
              const R = (rg.big ? CFG.ring.bigR : CFG.ring.r) * CFG.ring.reach + r;
              const dx = rg.x - bal.x, dy = rg.y - bal.y;
              if (dx * dx + dy * dy < R * R) collectRing(rg);
            }
          }
          // streak decay
          run.sinceRisk += dt;
          if (run.level > 0 && run.sinceRisk > CFG.streak.decayAfter) {
            run.level--;
            run.streak = CFG.streak.pts[run.level];
            run.sinceRisk = CFG.streak.decayAfter - CFG.streak.decayStep;
          }
          run.distPts = Math.floor(bal.x / 10);
          finalizeScore();
          if (!run.newBest && save.best > 0 && run.score > save.best) {
            run.newBest = true;
            el.newbest.classList.add("on");
            audio.chime();
            setTimeout(() => el.newbest.classList.remove("on"), 1800);
          }
          const stage = Math.min(6, Math.floor(diffAt(bal.x) / 0.22) + 1);
          if (stage > run.stage) {
            run.stage = stage;
            if (stage > 1) { try { ctx.platform.milestone("stage_" + stage); } catch (e) { /* ignore */ } }
          }
          spawnAmbient(dt);
        } else if (state === "ready" || state === "menu") {
          // Gentle idle hover — the world waits for the first press.
          const target = state === "menu" ? 0.62 : bal.I;
          bal.I += (target - bal.I) * Math.min(1, dt * 3);
          bal.r = radiusOf(bal.I);
          bal.y = 500 + Math.sin(simTime * 1.6) * 10;
          bal.vy = Math.cos(simTime * 1.6) * 16;
          if (state === "ready" && (heldNow() || (testAuto && testAuto.on))) beginPlaying();
          if (state === "menu") menuX += 40 * dt;
        }
        // deformation spring (visual only, bounded so the drawn body never shrinks inside the hitbox)
        const dI = (bal.I - bal.prevI) / dt;
        let target = clamp(-bal.vy / 420, -1, 1) * 0.028;
        if (dI > 0.05) target -= 0.016;
        look.sqv += (-(look.sq - target) * 260 - look.sqv * 14) * dt;
        look.sq += look.sqv * dt;
        look.sq = clamp(look.sq, -0.04, 0.04);
        look.danger += ((bal.I > 0.88 ? 1 : 0) - look.danger) * Math.min(1, dt * 4);
        look.flash = Math.max(0, look.flash - dt * 3);
        look.tilt += (clamp(bal.vy / 900, -0.12, 0.12) - look.tilt) * Math.min(1, dt * 6);
        updateRope(dt);
        updateParticles(vdt);
      }

      function collide(r) {
        const rh = r * B.hitScale;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (s.x1 < bal.x - 200 || s.x0 > bal.x + 200) continue;
          for (const so of s.solids) {
            if (bal.x + rh + 60 < so.x0 || bal.x - rh - 60 > so.x1) continue;
            if (bal.y + rh + 60 < so.y0 || bal.y - rh - 60 > so.y1) continue;
            const cl = solidClearance(so, bal.x, bal.y, rh, bal.x);
            if (cl < 0) { die(so); return; }
            const gp = so.g;
            if (gp && !gp.done && cl < gp.minClear) { gp.minClear = cl; gp.cx = polyCX; gp.cy = polyCY; }
          }
          for (const gp of s.groups) {
            if (!gp.done && bal.x - r > gp.x1) resolveGroup(gp);
          }
        }
      }

      function updateRope(dt) {
        const ax = bal.x + Math.sin(look.tilt) * bal.r, ay = bal.y + bal.r * (1 + look.sq) + 4;
        const segLen = 7 + bal.r * 0.04;
        rope[0].x = ax; rope[0].y = ay; rope[0].px = ax; rope[0].py = ay;
        for (let i = 1; i < rope.length; i++) {
          const p = rope[i];
          // Verlet with air drag: the string keeps the balloon's momentum but lags behind it.
          const drag = 1 - 3.2 * dt;
          const vx = (p.x - p.px) * drag, vy = (p.y - p.py) * drag;
          p.px = p.x; p.py = p.y;
          p.x += vx;
          p.y += vy + 520 * dt * dt;
        }
        for (let it = 0; it < 3; it++) {
          for (let i = 1; i < rope.length; i++) {
            const a = rope[i - 1], b = rope[i];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
            const diff = (d - segLen) / d;
            if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
            else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
          }
          rope[0].x = ax; rope[0].y = ay;
        }
      }

      function updateParticles(dt) {
        for (const p of particles.pool) {
          if (!p.on) continue;
          p.life -= dt;
          if (p.life <= 0) { p.on = false; continue; }
          if (p.kind === P_SHARD) { p.vy += 900 * dt; p.vx *= 1 - 1.5 * dt; p.rot += p.vr * dt; }
          else if (p.kind === P_SPARK) { p.vx *= 1 - 4 * dt; p.vy *= 1 - 4 * dt; }
          else if (p.kind === P_PETAL) { p.vy += 40 * dt; p.vx = -30 + Math.sin(p.life * 6 + p.rot) * 30; p.rot += p.vr * dt * 0.4; }
          else if (p.kind === P_PUFF) { p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt; }
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        for (const t of texts.pool) { if (t.on) { t.life -= dt; t.y -= 26 * dt; if (t.life <= 0) t.on = false; } }
      }

      // Visual air: particles that show where and which way each current blows.
      function spawnAmbient(dt) {
        const camX = bal.x - view.off, x1 = camX + view.w / view.s + 100;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (s.x1 < camX || s.x0 > x1) continue;
          for (const f of s.fields) {
            if (f.x1 < camX || f.x0 > x1) continue;
            const w = f.x1 - f.x0;
            const rate = (w / 100) * (f.type === F_SUCTION ? 5 : 6);
            let n = rate * dt;
            while (n > 0) {
              if (Math.random() > n) break;
              n -= 1;
              const px = f.x0 + Math.random() * w;
              if (f.type === F_THERMAL) particles.spawn(P_HEAT, px, CFG.H - 90 - Math.random() * 60, (Math.random() - 0.5) * 10, -160 - Math.random() * 120, 2.2 + Math.random(), 3 + Math.random() * 3);
              else if (f.type === F_FAN) {
                const y0 = f.yFan + f.dir * (10 + Math.random() * 40);
                particles.spawn(P_WIND, px, y0, 0, f.dir * (380 + Math.random() * 200), 1.5, 18 + Math.random() * 26);
              } else {
                const side = Math.random() < 0.5 ? -1 : 1;
                particles.spawn(P_SUCK, f.x0 - 40 + Math.random() * 60, f.cy + side * (120 + Math.random() * 120), 180 + Math.random() * 60, 0, 2.6, 2.5 + Math.random() * 2);
              }
            }
          }
        }
        // trails
        if (save.trail === "spark" && Math.random() < dt * 40) particles.spawn(P_SPARK, bal.x - bal.r * 0.8, bal.y + (Math.random() - 0.5) * bal.r, -40, (Math.random() - 0.5) * 30, 0.7, 1.8, PAL.goldLight);
        if (save.trail === "petal" && Math.random() < dt * 9) particles.spawn(P_PETAL, bal.x - bal.r * 0.6, bal.y + (Math.random() - 0.5) * bal.r, -30, 0, 1.6, 6, "#e7a4a0");
        // pull suction particles toward centerline
        for (const p of particles.pool) {
          if (!p.on || p.kind !== P_SUCK) continue;
          for (let i = 0; i < segs.length; i++) for (const f of segs[i].fields) {
            if (f.type !== F_SUCTION || p.x < f.x0 - 60 || p.x > f.x1 + 60) continue;
            p.vy += (f.cy - p.y) * 3.2 * dt;
            p.vy *= 1 - 1.5 * dt;
          }
        }
      }

      // ---------------------------------------------------------------- per-frame (generation, UI timers)
      function frame(dtMs) {
        const dt = Math.min(0.1, dtMs / 1000);
        if (state === "dying") {
          slowmo = Math.min(1, slowmo + dt * 1.6);
          dieTimer -= dt;
          if (dieTimer <= 0) finishRun();
        } else slowmo = 1;
        shake = Math.max(0, shake - dt * 2.8);
        if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) el.toast.classList.remove("on"); }
        // camera framing glides between the centered menu pose and the play pose
        const wantOff = state === "menu" ? view.menuOff : view.playOff;
        view.off += (wantOff - view.off) * Math.min(1, dt * 3.2);
        const wantY = (bal.y - 500) * 0.06;
        camYOff += (wantY - camYOff) * Math.min(1, dt * 2);
        if (run && worldGen && (state === "playing" || state === "ready")) {
          const need = bal.x - view.off + view.w / view.s + CFG.gen.ahead;
          if (worldGen.frontier < bal.x + 1400) worldGen.fillTo(bal.x + 1400, (s) => segs.push(s)); // emergency, should never trigger
          else if (worldGen.frontier < need) { const s = worldGen.pump(CFG.gen.budgetMs); if (s) segs.push(s); }
          while (segs.length && segs[0].x1 < bal.x - view.off - 400) segs.shift();
          if (state === "playing") { updateHud(false); checkMissions(); }
        }
        audio.frame(dt, state === "playing" ? windLevel() : 0.15, state);
      }

      function windLevel() {
        let w = 0.25;
        for (let i = 0; i < activeFields.length; i++) w += activeFields[i].type === F_FAN ? 0.6 : 0.35;
        return Math.min(1, w + (speedAt(bal.x) - CFG.speed.base) / 400);
      }

      // ---------------------------------------------------------------- rendering
      function draw() {
        const W = view.w, Hh = view.h, s = view.s;
        // the runtime may resize (and so clear) the buffers after our resize callback
        if (tiles.far && tiles.far.width + "x" + tiles.far.height !== tiles.painted) buildTiles();
        const camX = (state === "menu" ? menuX : bal.x) - view.off;
        const shx = shake > 0 ? (Math.random() - 0.5) * shake * 8 : 0, shy = shake > 0 ? (Math.random() - 0.5) * shake * 8 : 0;
        const oy = view.oy - camYOff * s;
        g.fillStyle = skyGrad || PAL.sky1;
        g.fillRect(0, 0, W, Hh);
        // sun
        const sunX = view.frameX + view.frameW * 0.3, sunY = view.oy + 150 * s, sunR = 120 * s;
        g.fillStyle = sunGrad; g.fillRect(sunX - sunR * 3.2, sunY - sunR * 3.2, sunR * 6.4, sunR * 6.4);
        g.fillStyle = "rgba(255,247,226,0.9)"; g.beginPath(); g.arc(sunX, sunY, sunR, 0, Math.PI * 2); g.fill();
        // thin-air limit shimmer
        g.save(); g.translate(0, oy); g.fillStyle = airGrad; g.fillRect(0, -40 * s, W, 70 * s); g.restore();
        // parallax
        drawTile(tiles.far, camX * s * 0.08, 0, 1);
        drawTile(tiles.mid, camX * s * 0.24, 0, 1);
        drawTile(tiles.cloudBack, camX * s * 0.45, -camYOff * s * 0.5, 0.95);

        g.save();
        g.translate(-camX * s + shx, oy + shy);
        g.scale(s, s);
        const vx0 = camX - 60, vx1 = camX + W / s + 60;
        if (run && save.bestDist > 20 && state !== "menu") drawBestMarker(save.bestDist * 10, vx0, vx1);
        for (const sg2 of segs) if (sg2.x1 >= vx0 && sg2.x0 <= vx1) drawFieldsBack(sg2, vx0, vx1);
        for (const sg2 of segs) if (sg2.x1 >= vx0 && sg2.x0 <= vx1) drawSolids(sg2, vx0, vx1, true);
        for (const sg2 of segs) if (sg2.x1 >= vx0 && sg2.x0 <= vx1) drawSolids(sg2, vx0, vx1, false);
        for (const sg2 of segs) if (sg2.x1 >= vx0 && sg2.x0 <= vx1) drawRings(sg2, vx0, vx1);
        drawParticles(false);
        if (state !== "dying" && state !== "over") drawBalloon(state === "menu" ? menuX : bal.x);
        drawParticles(true);
        g.restore();

        drawTile(tiles.cloudFront, camX * s * 1.15, -camYOff * s, 1);
        if (camYOff > 0) { g.fillStyle = "rgb(245,240,229)"; g.fillRect(0, Hh - camYOff * s - 1, W, camYOff * s + 2); }
        drawTexts(camX, oy);
        // gentle frame on very wide screens
        if (view.frameX > 4) {
          const fg = g.createLinearGradient(0, 0, view.frameX, 0);
          fg.addColorStop(0, "rgba(243,234,214,0.55)"); fg.addColorStop(1, "rgba(243,234,214,0)");
          g.fillStyle = fg; g.fillRect(0, 0, view.frameX, Hh);
          const fg2 = g.createLinearGradient(W, 0, W - view.frameX, 0);
          fg2.addColorStop(0, "rgba(243,234,214,0.35)"); fg2.addColorStop(1, "rgba(243,234,214,0)");
          g.fillStyle = fg2; g.fillRect(W - view.frameX, 0, view.frameX, Hh);
        }
      }

      function drawTile(img, scroll, y, alpha) {
        if (!img) return;
        const tw = tiles.w;
        let x = -(((scroll % tw) + tw) % tw);
        g.globalAlpha = alpha;
        for (; x < view.w; x += tw) g.drawImage(img, x, y, tw, view.h);
        g.globalAlpha = 1;
      }

      function tracePoly(pts) {
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.closePath();
      }

      function decorate(seg) {
        for (const so of seg.solids) {
          const r = mulberry32(so.seed);
          const gr = g.createLinearGradient(so.x0, 0, so.x1, 0);
          if (so.style === S_SPIKE || so.style === S_NEEDLE) {
            gr.addColorStop(0, "#d86a4c"); gr.addColorStop(0.5, PAL.terracotta); gr.addColorStop(0.51, "#a9402d"); gr.addColorStop(1, PAL.terracottaDark);
          } else if (so.style === S_FAN || so.style === S_VENT) {
            gr.addColorStop(0, "#7d8b86"); gr.addColorStop(1, "#56625f");
          } else {
            gr.addColorStop(0, PAL.stoneLit); gr.addColorStop(0.55, PAL.stone); gr.addColorStop(1, PAL.stoneShade);
          }
          so.fill = gr;
          so.deco = { ivy: r() < 0.5, windows: r() < 0.6, wx: r(), jitter: r(), banner: so.banner && r() < 0.85, bw: 0.28 + r() * 0.16 };
        }
        seg.decorated = true;
      }

      function drawSolids(seg, vx0, vx1, shadows) {
        if (!seg.decorated) decorate(seg);
        const bx = state === "menu" ? 0 : bal.x;
        for (const so of seg.solids) {
          if (so.x1 < vx0 || so.x0 > vx1) continue;
          const oy = so.motion ? solidOffset(so, bx) : 0;
          g.save();
          if (oy) g.translate(0, oy);
          if (shadows) {
            if (so.style !== S_SPIKE) {
              g.translate(16, 12);
              tracePoly(so.pts);
              g.fillStyle = "rgba(48,70,74,0.17)";
              g.fill();
            }
            g.restore();
            continue;
          }
          tracePoly(so.pts);
          g.fillStyle = so.fill;
          g.fill();
          if (so.style === S_PILLAR || so.style === S_HANG || so.style === S_SLAB) {
            drawMasonry(so);
            tracePoly(so.pts);
            g.strokeStyle = "rgba(112,88,58,0.5)";
            g.lineWidth = 2.2;
            g.stroke();
          }
          else if (so.style === S_SPIKE || so.style === S_NEEDLE) {
            g.strokeStyle = "rgba(255,214,190,0.45)"; g.lineWidth = 1.4;
            g.beginPath();
            const p = so.pts, n = p.length;
            // highlight the lit (left) edge leading to the tip
            let tip = 0;
            for (let i = 2; i < n; i += 2) if (Math.abs(p[i + 1] - (p[1] + p[3]) / 2) > Math.abs(p[tip + 1] - (p[1] + p[3]) / 2)) tip = i;
            g.moveTo(so.x0 + 1, so.style === S_NEEDLE ? p[tip + 1] + (p[1] > p[tip + 1] ? 300 : -300) : p[1]);
            g.lineTo(p[tip], p[tip + 1]);
            g.stroke();
          } else if (so.style === S_FAN) drawFan(so);
          else if (so.style === S_VENT) drawVent(so);
          g.restore();
        }
      }

      function drawMasonry(so) {
        g.save();
        tracePoly(so.pts);
        g.clip();
        const x0 = so.x0, x1 = so.x1, w = x1 - x0, d = so.deco;
        const yTop = Math.max(so.y0, -260), yBot = Math.min(so.y1, CFG.H + 260);
        // courses
        g.strokeStyle = PAL.joint; g.lineWidth = 1.6;
        g.beginPath();
        const step = 44;
        const start = Math.floor(yTop / step) * step;
        for (let y = start, row = 0; y < yBot; y += step, row++) {
          g.moveTo(x0, y); g.lineTo(x1, y);
          const off = (row % 2) * 0.5 + d.jitter * 0.3;
          for (let k = off; k < 1; k += 0.5) { const jx = x0 + w * k; g.moveTo(jx, y); g.lineTo(jx, y + step); }
        }
        g.stroke();
        // right-side shade band suggests depth
        g.fillStyle = "rgba(120,100,70,0.16)";
        g.fillRect(x1 - w * 0.2, yTop, w * 0.2, yBot - yTop);
        if (so.style === S_PILLAR) {
          // cap highlight + ambient occlusion under cap
          const top = so.pts[1];
          g.fillStyle = "rgba(255,252,240,0.55)"; g.fillRect(x0, top, w, 4);
          g.fillStyle = "rgba(90,74,52,0.16)"; g.fillRect(x0, top + 20, w, 8);
          if (d.windows && w > 60) {
            g.fillStyle = "rgba(70,74,70,0.35)";
            const wx = x0 + w * (0.3 + d.wx * 0.3), wy = top + 140;
            for (let k = 0; k < 3; k++) {
              const yy = wy + k * 150;
              if (yy > CFG.H + 200) break;
              g.beginPath(); g.rect(wx, yy, 16, 34); g.arc(wx + 8, yy, 8, Math.PI, 0); g.fill();
            }
          }
          if (d.ivy) {
            g.fillStyle = "rgba(91,122,79,0.85)";
            for (let k = 0; k < 7; k++) {
              const ix = x0 + ((k * 37 + d.jitter * 50) % w), ih = 18 + ((k * 23) % 40);
              g.beginPath(); g.ellipse(ix, top + 26 + ih / 2, 7, ih / 2 + 6, 0, 0, Math.PI * 2); g.fill();
            }
            g.fillStyle = "rgba(122,150,98,0.9)";
            for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(x0 + ((k * 29 + d.jitter * 40) % w), top + 4 + (k % 3) * 3, 7 + (k % 3), 0, Math.PI * 2); g.fill(); }
          }
        } else if (so.style === S_HANG) {
          const bot = so.pts[5] !== undefined ? Math.max(so.pts[5], so.pts[so.pts.length - 1]) : so.y1;
          g.fillStyle = "rgba(90,74,52,0.18)"; g.fillRect(x0, bot - 14, w, 14);
          if (so.arch) {
            // voussoirs around the arch
            const foot = Math.max(18, w * 0.2), ra = (w - 2 * foot) / 2, cx = x0 + w / 2, rise = Math.min(ra, 70);
            g.strokeStyle = "rgba(110,90,60,0.28)"; g.lineWidth = 2;
            g.beginPath(); g.ellipse(cx, bot, ra + 16, rise + 16, 0, Math.PI, 0); g.stroke();
            g.beginPath();
            for (let k = 1; k < 9; k++) { const a = Math.PI + (k / 9) * Math.PI; g.moveTo(cx + Math.cos(a) * ra, bot + Math.sin(a) * rise); g.lineTo(cx + Math.cos(a) * (ra + 16), bot + Math.sin(a) * (rise + 16)); }
            g.stroke();
            g.fillStyle = "rgba(90,74,52,0.2)"; g.beginPath(); g.ellipse(cx, bot, ra, rise, 0, Math.PI, 0); g.lineTo(cx - ra, bot); g.fill();
            g.fillStyle = PAL.stoneLit; g.fillRect(cx - 9, bot - rise - 18, 18, 20);
          }
          if (d.banner && w > 50) {
            const bw = Math.min(46, w * d.bw), bx = x0 + w * 0.5 - bw / 2 + (so.arch ? 0 : (d.wx - 0.5) * w * 0.3);
            const by0 = Math.max(yTop, bot - 520), by1 = bot - (so.arch ? Math.min((w - 2 * Math.max(18, w * 0.2)) / 2, 70) + 30 : 34);
            if (by1 - by0 > 60) {
              g.fillStyle = PAL.terracotta;
              g.beginPath(); g.moveTo(bx, by0); g.lineTo(bx + bw, by0); g.lineTo(bx + bw, by1); g.lineTo(bx + bw / 2, by1 - 16); g.lineTo(bx, by1); g.closePath(); g.fill();
              g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(bx + bw * 0.62, by0, bw * 0.38, by1 - by0 - 8);
              g.fillStyle = "rgba(255,220,180,0.35)"; g.fillRect(bx + 4, by0, 2, by1 - by0 - 6);
            }
          }
        }
        if (so.motion) {
          // carved ↕ marks a wall that slides
          const ax = x0 + w * 0.78, edge = so.style === S_HANG ? Math.max(so.pts[5], so.pts[7]) - 70 : so.pts[1] + 70;
          g.strokeStyle = PAL.terracotta; g.lineWidth = 5; g.lineCap = "round"; g.lineJoin = "round";
          g.beginPath();
          g.moveTo(ax, edge - 26); g.lineTo(ax, edge + 26);
          g.moveTo(ax - 10, edge - 14); g.lineTo(ax, edge - 26); g.lineTo(ax + 10, edge - 14);
          g.moveTo(ax - 10, edge + 14); g.lineTo(ax, edge + 26); g.lineTo(ax + 10, edge + 14);
          g.stroke();
        }
        if (so.style === S_SLAB) {
          g.fillStyle = "rgba(255,252,240,0.5)"; g.fillRect(x0, so.pts[1], w, 4);
          g.fillStyle = "rgba(90,74,52,0.18)"; g.fillRect(x0, so.pts[9] - 12, w, 12);
        }
        g.restore();
      }

      function drawFan(so) {
        const cx = (so.x0 + so.x1) / 2, cy = (Math.min(so.pts[1], so.pts[5]) + Math.max(so.pts[1], so.pts[5])) / 2;
        g.fillStyle = "rgba(30,36,36,0.55)";
        g.beginPath(); g.ellipse(cx, cy, 46, 14, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(220,232,230,0.6)"; g.lineWidth = 3;
        const a0 = simTime * 14;
        g.beginPath();
        for (let k = 0; k < 4; k++) { const a = a0 + (k * Math.PI) / 2; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 12); }
        g.stroke();
      }
      function drawVent(so) {
        const cx = (so.x0 + so.x1) / 2, top = Math.min(so.pts[1], so.pts[5]);
        const fl = 0.6 + 0.4 * Math.sin(simTime * 9);
        const gr = g.createRadialGradient(cx, top, 4, cx, top, 70);
        gr.addColorStop(0, `rgba(255,190,110,${0.7 * fl})`); gr.addColorStop(1, "rgba(255,160,90,0)");
        g.fillStyle = gr; g.fillRect(cx - 80, top - 70, 160, 80);
      }

      function drawFieldsBack(seg, vx0, vx1) {
        for (const f of seg.fields) {
          if (f.x1 < vx0 || f.x0 > vx1) continue;
          const w = f.x1 - f.x0;
          if (f.type === F_THERMAL) {
            if (!f.grad) {
              f.grad = g.createLinearGradient(0, CFG.H, 0, 0);
              f.grad.addColorStop(0, "rgba(246,160,90,0.22)"); f.grad.addColorStop(0.7, "rgba(246,180,110,0.08)"); f.grad.addColorStop(1, "rgba(246,190,120,0)");
            }
            g.fillStyle = f.grad; g.fillRect(f.x0, 0, w, CFG.H);
            // rising chevrons
            g.strokeStyle = "rgba(232,128,72,0.4)"; g.lineWidth = 5; g.lineCap = "round";
            g.beginPath();
            const sp = 140, ph = (simTime * 120) % sp;
            for (let y = CFG.H - 120 - ph; y > 60; y -= sp) {
              for (let k = 0; k < 3; k++) {
                const cx = f.x0 + (w * (k + 0.5)) / 3, a = clamp01((CFG.H - y) / 300) * clamp01(y / 200);
                if (a < 0.1) continue;
                g.moveTo(cx - 14, y + 12); g.lineTo(cx, y); g.lineTo(cx + 14, y + 12);
              }
            }
            g.stroke();
          } else if (f.type === F_FAN) {
            const y0 = f.dir > 0 ? f.yFan : 0, y1 = f.dir > 0 ? CFG.H : f.yFan;
            if (!f.grad) {
              f.grad = g.createLinearGradient(0, f.yFan, 0, f.dir > 0 ? CFG.H : 0);
              f.grad.addColorStop(0, "rgba(200,232,240,0.30)"); f.grad.addColorStop(1, "rgba(200,232,240,0.02)");
            }
            g.fillStyle = f.grad; g.fillRect(f.x0, y0, w, y1 - y0);
            g.strokeStyle = "rgba(232,246,248,0.55)"; g.lineWidth = 4; g.lineCap = "round";
            g.beginPath();
            const sp = 160, ph = (simTime * 260) % sp;
            for (let k = 0; k < 4; k++) {
              const cx = f.x0 + (w * (k + 0.5)) / 4;
              for (let y = f.yFan + f.dir * (40 + ph); f.dir > 0 ? y < CFG.H - 40 : y > 40; y += f.dir * sp) {
                g.moveTo(cx - 12, y - f.dir * 12); g.lineTo(cx, y); g.lineTo(cx + 12, y - f.dir * 12);
              }
            }
            g.stroke();
          } else {
            // suction portal rings converging on the centerline
            const n = 4;
            for (let k = 0; k < n; k++) {
              const t = ((simTime * 0.6 + k / n) % 1);
              const x = f.x0 + w * t, a = Math.sin(t * Math.PI) * 0.55;
              g.strokeStyle = `rgba(120,200,226,${a})`; g.lineWidth = 4;
              g.beginPath(); g.ellipse(x, f.cy, 22, 150 * (1 - t * 0.55), 0, 0, Math.PI * 2); g.stroke();
            }
            g.strokeStyle = "rgba(150,214,232,0.35)"; g.lineWidth = 2; g.setLineDash([10, 14]);
            g.beginPath(); g.moveTo(f.x0, f.cy); g.lineTo(f.x1 + 40, f.cy); g.stroke(); g.setLineDash([]);
          }
        }
      }

      function drawRings(seg, vx0, vx1) {
        for (const rg of seg.rings) {
          if (rg.taken || rg.x < vx0 || rg.x > vx1) continue;
          const R = rg.big ? CFG.ring.bigR : CFG.ring.r;
          const spin = 0.5 + 0.18 * Math.sin(simTime * 2 + rg.ph);
          if (rg.big) {
            if (!rg.glow) {
              rg.glow = g.createRadialGradient(rg.x, rg.y, R * 0.3, rg.x, rg.y, R * 2.2);
              rg.glow.addColorStop(0, "rgba(255,226,140,0.35)"); rg.glow.addColorStop(1, "rgba(255,226,140,0)");
            }
            g.fillStyle = rg.glow; g.beginPath(); g.arc(rg.x, rg.y, R * 2.2, 0, Math.PI * 2); g.fill();
          }
          g.lineWidth = rg.big ? 9 : 6;
          g.strokeStyle = PAL.goldDark;
          g.beginPath(); g.ellipse(rg.x + 1.5, rg.y + 2, R * spin, R, 0, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = PAL.gold;
          g.beginPath(); g.ellipse(rg.x, rg.y, R * spin, R, 0, 0, Math.PI * 2); g.stroke();
          g.lineWidth = rg.big ? 2.5 : 1.8;
          g.strokeStyle = PAL.goldLight;
          g.beginPath(); g.ellipse(rg.x - 1, rg.y - 1, R * spin, R, 0, Math.PI * 0.95, Math.PI * 1.7); g.stroke();
          if (rg.big) {
            const tw = 0.5 + 0.5 * Math.sin(simTime * 5 + rg.ph);
            g.fillStyle = `rgba(255,250,230,${0.6 * tw})`;
            g.beginPath(); g.moveTo(rg.x + R * 0.7, rg.y - R - 6); g.lineTo(rg.x + R * 0.7 + 3, rg.y - R); g.lineTo(rg.x + R * 0.7, rg.y - R + 6); g.lineTo(rg.x + R * 0.7 - 3, rg.y - R); g.fill();
          }
        }
      }

      function drawBestMarker(x, vx0, vx1) {
        if (x < vx0 || x > vx1) return;
        g.strokeStyle = "rgba(251,246,234,0.55)"; g.lineWidth = 3; g.setLineDash([14, 12]);
        g.beginPath(); g.moveTo(x, 20); g.lineTo(x, CFG.H); g.stroke(); g.setLineDash([]);
        g.fillStyle = PAL.terracotta;
        g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 46, 34); g.lineTo(x, 48); g.fill();
      }

      // Balloon body in unit space: radius 1 circle with a gently pointed base.
      function bodyPath(t) {
        t.beginPath();
        for (let k = 0; k <= 40; k++) {
          const a = (k / 40) * Math.PI * 2;
          const b = Math.max(0, Math.sin(a));
          const rho = 1 + 0.05 * Math.pow(b, 6) - 0.025 * b * b;
          const x = Math.cos(a) * rho * (1 - 0.04 * b), y = Math.sin(a) * rho;
          if (k === 0) t.moveTo(x, y); else t.lineTo(x, y);
        }
        t.closePath();
      }
      const skinGrad = new Map();
      function gradsFor(t, skin) {
        let c = skinGrad.get(t);
        if (!c) { c = {}; skinGrad.set(t, c); }
        if (c[skin.id]) return c[skin.id];
        const body = t.createRadialGradient(-0.38, -0.45, 0.05, -0.1, -0.05, 1.35);
        body.addColorStop(0, skin.light); body.addColorStop(0.42, skin.base); body.addColorStop(1, skin.dark);
        const rim = t.createRadialGradient(0, 0, 0.75, 0, 0, 1.05);
        rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(30,10,5,0.22)");
        let pearl = null;
        if (skin.pearl) {
          pearl = t.createLinearGradient(-1, -1, 1, 1);
          pearl.addColorStop(0, "rgba(255,190,220,0.35)"); pearl.addColorStop(0.5, "rgba(190,230,255,0.35)"); pearl.addColorStop(1, "rgba(220,255,210,0.3)");
        }
        c[skin.id] = { body, rim, pearl };
        return c[skin.id];
      }
      function drawBalloonShape(t, skin, tension, danger, time) {
        const gr = gradsFor(t, skin);
        bodyPath(t);
        t.fillStyle = gr.body; t.fill();
        if (skin.stripes) {
          t.save(); bodyPath(t); t.clip();
          t.fillStyle = skin.stripes;
          for (let k = -3; k <= 3; k += 2) {
            const a1 = Math.sin((k / 7) * Math.PI) * 2.1, a2 = Math.sin(((k + 1) / 7) * Math.PI) * 2.1;
            t.beginPath(); t.moveTo(0, -1.1); t.quadraticCurveTo(a1, 0, 0, 1.1); t.quadraticCurveTo(a2, 0, 0, -1.1); t.fill();
          }
          t.fillStyle = "rgba(0,0,0,0.0)";
          t.restore();
          bodyPath(t); t.fillStyle = gr.rim; t.fill();
        }
        if (gr.pearl) { bodyPath(t); t.fillStyle = gr.pearl; t.fill(); }
        bodyPath(t); t.fillStyle = gr.rim; t.fill();
        // stretched rubber reads glossier and slightly translucent
        t.fillStyle = `rgba(255,255,255,${0.10 + 0.14 * tension})`;
        bodyPath(t); t.fill();
        t.fillStyle = `rgba(255,255,255,${0.42 + 0.3 * tension})`;
        t.beginPath(); t.ellipse(-0.42, -0.5, 0.17 + 0.05 * tension, 0.3 + 0.06 * tension, -0.62, 0, Math.PI * 2); t.fill();
        t.fillStyle = "rgba(255,255,255,0.35)";
        t.beginPath(); t.ellipse(-0.18, -0.78, 0.06, 0.04, -0.3, 0, Math.PI * 2); t.fill();
        // tied neck
        t.fillStyle = skin.dark;
        t.beginPath(); t.moveTo(-0.09, 1.02); t.lineTo(0.09, 1.02); t.lineTo(0.13, 1.13); t.lineTo(-0.13, 1.13); t.closePath(); t.fill();
        // edge definition keeps the silhouette readable on any background
        bodyPath(t);
        t.lineWidth = 0.035;
        t.strokeStyle = danger > 0.05 ? `rgba(80,20,10,${0.25 + 0.25 * danger * (0.6 + 0.4 * Math.sin(time * 18))})` : "rgba(60,25,15,0.25)";
        t.stroke();
      }

      function drawBalloon(x) {
        const skin = skinById(save.skin);
        const r = bal.r, y = bal.y;
        const tension = (bal.I - B.minI) / IRANGE;
        // string first (behind)
        g.strokeStyle = "rgba(70,55,45,0.7)"; g.lineWidth = 1.6;
        g.beginPath();
        const ox = x - bal.x;
        g.moveTo(rope[0].x + ox, rope[0].y);
        for (let i = 1; i < rope.length - 1; i++) {
          const mx = (rope[i].x + rope[i + 1].x) / 2 + ox, my = (rope[i].y + rope[i + 1].y) / 2;
          g.quadraticCurveTo(rope[i].x + ox, rope[i].y, mx, my);
        }
        g.stroke();
        // soft shadow cast forward-down
        const shg = g.createRadialGradient(x + r * 0.45, y + r * 0.4, r * 0.2, x + r * 0.45, y + r * 0.4, r * 1.25);
        shg.addColorStop(0, "rgba(40,60,60,0.12)"); shg.addColorStop(1, "rgba(40,60,60,0)");
        g.fillStyle = shg;
        g.beginPath(); g.arc(x + r * 0.45, y + r * 0.4, r * 1.25, 0, Math.PI * 2); g.fill();
        const jitter = look.danger * 0.006 * Math.sin(simTime * 47);
        const sy = 1 + look.sq + jitter, sx = 1 - look.sq - jitter;
        g.save();
        g.translate(x, y);
        g.rotate(look.tilt);
        g.scale(r * sx, r * sy);
        drawBalloonShape(g, skin, tension, look.danger, simTime);
        if (look.flash > 0) {
          const a = Math.atan2(look.fy, look.fx);
          g.strokeStyle = `rgba(255,255,255,${look.flash * 0.9})`;
          g.lineWidth = 0.09;
          g.beginPath(); g.arc(0, 0, 1.12, a - 0.6, a + 0.6); g.stroke();
        }
        g.restore();
      }

      function drawParticles(front) {
        for (const p of particles.pool) {
          if (!p.on) continue;
          const k = p.kind;
          const isFront = k === P_SPARK || k === P_SHARD || k === P_RINGFLASH || k === P_PETAL || k === P_PUFF;
          if (isFront !== front) continue;
          const a = p.life / p.max;
          if (k === P_SPARK) {
            g.fillStyle = p.col; g.globalAlpha = a; g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); g.fill();
          } else if (k === P_SHARD) {
            g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, a * 2);
            g.fillStyle = p.col; g.beginPath(); g.moveTo(-p.size, -p.size * 0.4); g.quadraticCurveTo(0, -p.size, p.size, -p.size * 0.2); g.lineTo(p.size * 0.6, p.size * 0.5); g.quadraticCurveTo(0, 0, -p.size, -p.size * 0.4); g.fill();
            g.restore();
          } else if (k === P_RINGFLASH) {
            g.strokeStyle = `rgba(255,244,210,${a})`; g.lineWidth = 4 * a + 1;
            g.beginPath(); g.arc(p.x, p.y, p.size * (1 + (1 - a) * 1.2), 0, Math.PI * 2); g.stroke();
          } else if (k === P_WIND) {
            g.strokeStyle = `rgba(238,250,252,${0.55 * Math.min(1, a * 3)})`; g.lineWidth = 2.5;
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - Math.sign(p.vy) * p.size); g.stroke();
          } else if (k === P_HEAT) {
            g.fillStyle = `rgba(250,170,96,${0.6 * Math.min(1, a * 2)})`;
            g.beginPath(); g.arc(p.x + Math.sin(p.life * 5 + p.rot) * 6, p.y, p.size, 0, Math.PI * 2); g.fill();
          } else if (k === P_SUCK) {
            g.fillStyle = `rgba(170,226,240,${0.75 * Math.min(1, a * 2)})`;
            g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
          } else if (k === P_PETAL) {
            g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, a * 1.5);
            g.fillStyle = p.col; g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2); g.fill(); g.restore();
          } else if (k === P_PUFF) {
            g.fillStyle = `rgba(255,255,255,${0.35 * a})`; g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - a), 0, Math.PI * 2); g.fill();
          }
          g.globalAlpha = 1;
        }
      }

      function drawTexts(camX, oy) {
        for (const t of texts.pool) {
          if (!t.on) continue;
          const a = clamp01(t.life / t.max * 2.2);
          const sx = clamp((t.x - camX) * view.s, 90, view.w - 90), sy = oy + t.y * view.s;
          g.globalAlpha = a;
          g.font = (t.big ? "600 13px " : "600 12px ") + 'Inter,"Helvetica Neue",Arial,sans-serif';
          g.textAlign = "center";
          if ("letterSpacing" in g) g.letterSpacing = t.big ? "2.5px" : "1px";
          g.fillStyle = "rgba(40,50,48,0.35)"; g.fillText(t.t, sx + 1, sy + 1.5);
          g.fillStyle = t.col; g.fillText(t.t, sx, sy);
          if ("letterSpacing" in g) g.letterSpacing = "0px";
          g.globalAlpha = 1;
        }
      }

      // ---------------------------------------------------------------- boot
      layout();
      refreshMenu();
      for (let i = 0; i < 6; i++) tick(1 / CFG.sim.hz);
      draw();
      ctx.onResize(() => { layout(); draw(); });

      const loop = ctx.game.loop({
        fixedHz: CFG.sim.hz,
        maxSubsteps: 12,
        maxDeltaMs: 100,
        input,
        fixedUpdate: (stepMs) => tick(stepMs / 1000),
        update: (dtMs) => frame(dtMs),
        render: () => draw(),
      });
      void loop;

      if (typeof globalThis !== "undefined" && globalThis.__INFLATE_TEST__ && globalThis.__INFLATE_TEST__.attach) {
        globalThis.__INFLATE_TEST__.attach({
          get state() { return state; }, bal, get run() { return run; }, get segs() { return segs; }, get gen() { return worldGen; }, save, view,
          startRun, setKey: (v) => { keyHeld = v; }, setAuto: (v) => { testAuto.on = v; testAuto.k = 0; }, setSchedule: (fn) => { testAuto.sched = fn; }, onStep: (fn) => { testAuto.onStep = fn; }, planAction: (h) => planAction(bal, segs, h || 2.2), CORE,
        });
      }

      ctx.platform.ready();
    },
  };

  // ===========================================================================
  // AUDIO — small procedural palette (WebAudio), silent if unavailable.
  // ===========================================================================
  function createAudio() {
    let ac = null, master = null, noise = null, muted = false;
    let wind = null, hiss = null, squeak = null, pad = null;
    let padTimer = 0, padIdx = 0;
    const CHORDS = [[130.8, 196, 329.6], [110, 164.8, 261.6], [87.3, 130.8, 220], [98, 146.8, 246.9]];

    function unlock() {
      if (ac) { if (ac.state === "suspended" && ac.resume) ac.resume().catch(() => {}); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
        const len = ac.sampleRate * 2;
        noise = ac.createBuffer(1, len, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        wind = loopNoise("bandpass", 380, 0.6);
        hiss = loopNoise("bandpass", 1500, 1.4);
        const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = 150;
        const og = ac.createGain(); og.gain.value = 0;
        o.connect(og); og.connect(master); o.start();
        squeak = { o, g: og };
        const pg = ac.createGain(); pg.gain.value = 0;
        const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
        pg.connect(lp); lp.connect(master);
        const oscs = CHORDS[0].map((f) => { const x = ac.createOscillator(); x.type = "sine"; x.frequency.value = f; x.connect(pg); x.start(); return x; });
        pad = { g: pg, oscs };
      } catch (e) { ac = null; }
    }
    function loopNoise(type, freq, q) {
      const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const gn = ac.createGain(); gn.gain.value = 0;
      src.connect(f); f.connect(gn); gn.connect(master); src.start();
      return { src, f, g: gn };
    }
    function ok() { return ac && ac.state !== "closed"; }
    function tone(type, f0, f1, t0, dur, vol) {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function burst(type, f0, f1, dur, vol, q) {
      const t0 = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q || 0.8;
      f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const gn = ac.createGain(); gn.gain.setValueAtTime(vol, t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(gn); gn.connect(master); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
    }
    return {
      unlock,
      setMuted(m) { muted = m; if (ok()) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
      setHold(h, I) {
        if (!ok()) return;
        const t = (I - B.minI) / IRANGE, now = ac.currentTime;
        const active = h && I < B.maxI - 0.005;
        hiss.g.gain.setTargetAtTime(active ? 0.05 + 0.03 * t : 0, now, active ? 0.03 : 0.06);
        hiss.f.frequency.setTargetAtTime(900 + 1700 * t, now, 0.05);
        squeak.g.gain.setTargetAtTime(active ? 0.012 + 0.01 * t : 0, now, 0.04);
        squeak.o.frequency.setTargetAtTime(120 + 200 * t + (h && I >= B.maxI - 0.005 ? 0 : 0), now, 0.05);
      },
      release(I) { if (!ok()) return; const t = (I - B.minI) / IRANGE; burst("bandpass", 1600, 260, 0.32 + 0.2 * t, 0.07 + 0.08 * t, 1.1); },
      ring(big) {
        if (!ok()) return;
        const t0 = ac.currentTime;
        if (big) { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone("sine", f, f, t0 + i * 0.05, 0.5, 0.07)); }
        else { tone("sine", 1568, 1568, t0, 0.32, 0.08); tone("sine", 2349, 2349, t0 + 0.03, 0.25, 0.04); }
      },
      near(level) {
        if (!ok()) return;
        const t0 = ac.currentTime;
        tone("triangle", 520, 880 + level * 220, t0, 0.22, 0.07);
        if (level >= 1) tone("sine", 1318, 1318, t0 + 0.08, 0.35, 0.05);
        if (level >= 2) tone("sine", 1975, 1975, t0 + 0.14, 0.5, 0.05);
      },
      streak(lv) { if (!ok()) return; const t0 = ac.currentTime; tone("sine", 660 * Math.pow(1.122, lv), 660 * Math.pow(1.122, lv), t0, 0.25, 0.05); },
      chime() { if (!ok()) return; const t0 = ac.currentTime; [784, 988, 1175, 1568].forEach((f, i) => tone("sine", f, f, t0 + i * 0.07, 0.6, 0.05)); },
      pop() {
        if (!ok()) return;
        burst("highpass", 2400, 900, 0.14, 0.4, 0.7);
        tone("sine", 140, 45, ac.currentTime, 0.22, 0.32);
      },
      frame(dt, windLv, st) {
        if (!ok()) return;
        const now = ac.currentTime;
        wind.g.gain.setTargetAtTime(st === "playing" ? 0.02 + 0.06 * windLv : 0.012, now, 0.3);
        wind.f.frequency.setTargetAtTime(260 + 500 * windLv, now, 0.4);
        pad.g.gain.setTargetAtTime(st === "over" ? 0.012 : 0.024, now, 0.6);
        padTimer -= dt;
        if (padTimer <= 0) {
          padTimer = 7.5;
          padIdx = (padIdx + 1) % CHORDS.length;
          pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[padIdx][i], now, 1.2));
        }
        if (st !== "playing") { hiss.g.gain.setTargetAtTime(0, now, 0.05); squeak.g.gain.setTargetAtTime(0, now, 0.05); }
      },
    };
  }
})();
