// THE UNFINISHED CANVAS
// A persistent, shared, never-finished artwork. Every accepted contribution is an
// immutable record in the "canvas" objects world; the image is always re-rendered
// from that append-only history, so covered marks stay recoverable.
window.plethoraBit = {
  meta: {
    title: "The Unfinished Canvas",
    runtime: "plethora-bit@2",
    tags: ["art", "shared", "drawing", "co-creation"],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // =====================================================================
    // 0. Game-design parameters (creator tunable)
    // =====================================================================
    function tune(id, fallback) {
      try {
        const v = ctx.tune && ctx.tune.get(id);
        return v === undefined || v === null ? fallback : v;
      } catch (e) { return fallback; }
    }
    const CFG = {
      maxMarks: Math.round(clampN(tune("marks_per_contribution", 8), 1, 12)),
      drawMs: clampN(tune("drawing_seconds", 10), 4, 30) * 1000,
      perVisit: Math.round(clampN(tune("contributions_per_visit", 1), 1, 3)),
      milestones: [tune("milestone_1", 25), tune("milestone_2", 100), tune("milestone_3", 250)]
        .map((n) => Math.max(1, Math.round(n))).sort((a, b) => a - b),
      glow: clampN(tune("glow_strength", 0.7), 0, 1),
      grain: clampN(tune("grain_amount", 0.06), 0, 0.2),
      stampCostMs: 400,
      refreshMs: 30000,
      mutationBudget: 960 // world mutations are capped at 1024 bytes
    };
    if (ctx.tune && ctx.tune.onChange) {
      ctx.tune.onChange(["glow_strength", "grain_amount"], () => {
        CFG.glow = clampN(tune("glow_strength", 0.7), 0, 1);
        CFG.grain = clampN(tune("grain_amount", 0.06), 0, 0.2);
        grainPattern = null;
        invalidateArt();
      });
    }

    // =====================================================================
    // 1. Palette, brushes, shapes
    // =====================================================================
    const BG = "#050607";
    const OUTSIDE = "#020303";
    const COLORS = [
      "#FF426D", // coral
      "#FF7048", // hot orange
      "#FFC45B", // warm yellow
      "#43E4E0", // cyan
      "#00BDAA", // electric teal
      "#A78BFA", // violet
      "#B8F5C8", // pale green
      "#EDEFF2", // soft white
      "#15191D"  // ink: the dark mark that divides and cuts
    ];
    const INK = 8;
    const COLOR_NAMES = ["Coral", "Orange", "Yellow", "Cyan", "Teal", "Violet", "Mint", "White", "Ink"];
    const WIDTHS = [5, 12, 26];
    const STAMP_SIZES = [26, 54, 96];
    const BRUSH = { SOLID: 0, GLOW: 1, SOFT: 2 };
    const BRUSH_NAMES = ["Solid", "Glow", "Soft"];
    const SHAPES = ["circle", "ring", "rect", "triangle", "burst", "blob"];
    const MODE_NAMES = { a: "ADD", c: "CONTINUE", t: "TRANSFORM" };

    // World space: a 2048-unit square. The drawable area is a centred square that
    // grows as the community reaches milestones.
    const WORLD = 2048;
    const CENTER = WORLD / 2;
    const SECTION_HALF = [430, 560, 720, 900];

    const PROMPTS = [
      "Continue a line without lifting your finger.",
      "Add something that looks alive.",
      "Connect two unrelated marks.",
      "Add a shape that changes how another shape reads.",
      "Find an overlooked mark and give it new context.",
      "Make a contribution using only curves.",
      "Create an intersection between two colours.",
      "Add something tiny to the busiest part of the canvas."
    ];

    // =====================================================================
    // 2. Small utilities
    // =====================================================================
    function clampN(v, a, b) { v = Number(v); if (!Number.isFinite(v)) return a; return v < a ? a : v > b ? b : v; }
    function uid() {
      const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
      let s = "";
      const bytes = new Uint8Array(16);
      try { crypto.getRandomValues(bytes); } catch (e) { for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); }
      for (let i = 0; i < 16; i++) s += abc[bytes[i] % 36];
      return s;
    }
    function hashStr(s) {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function distSegSq(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const l = dx * dx + dy * dy;
      let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      return qx * qx + qy * qy;
    }
    function ago(ms) {
      if (!ms) return "";
      const s = Math.max(0, (Date.now() - ms) / 1000);
      if (s < 60) return "just now";
      if (s < 3600) return Math.floor(s / 60) + "m ago";
      if (s < 86400) return Math.floor(s / 3600) + "h ago";
      const d = Math.floor(s / 86400);
      return d === 1 ? "yesterday" : d + " days ago";
    }
    function bboxOf(points, pad) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of points) {
        if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
      }
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    function bboxUnion(a, b) {
      if (!a) return b; if (!b) return a;
      return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
    }
    function bboxHit(a, b, pad) {
      pad = pad || 0;
      return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
    }

    // ---- storage (viewer-local convenience only) ----
    function sget(key, fallback) {
      try { const v = ctx.storage && ctx.storage.get(key); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
    }
    function sset(key, value) { try { ctx.storage && ctx.storage.set(key, value); } catch (e) { /* convenience only */ } }

    // =====================================================================
    // 3. Codec: compact, lossless-enough geometry for the 1 KB mutation cap
    //    Points are 12-bit absolute for the first point, then 12-bit deltas.
    // =====================================================================
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const B64I = {};
    for (let i = 0; i < 64; i++) B64I[B64[i]] = i;
    function enc12(n) { n = Math.max(0, Math.min(4095, Math.round(n))); return B64[n >> 6] + B64[n & 63]; }
    function dec12(s, i) { const a = B64I[s[i]], b = B64I[s[i + 1]]; return a === undefined || b === undefined ? NaN : a * 64 + b; }
    function encodePoints(pts) {
      let px = Math.round(pts[0].x), py = Math.round(pts[0].y);
      let s = enc12(px) + enc12(py);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.max(-2047, Math.min(2047, Math.round(pts[i].x) - px));
        const dy = Math.max(-2047, Math.min(2047, Math.round(pts[i].y) - py));
        px += dx; py += dy;
        s += enc12(dx + 2048) + enc12(dy + 2048);
      }
      return s;
    }
    function decodePoints(s) {
      if (typeof s !== "string" || s.length < 4 || s.length % 4 !== 0 || s.length > 2400) return null;
      let x = dec12(s, 0), y = dec12(s, 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const out = [{ x, y }];
      for (let i = 4; i < s.length; i += 4) {
        const dx = dec12(s, i) - 2048, dy = dec12(s, i + 2) - 2048;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
        x += dx; y += dy;
        if (x < 0 || y < 0 || x > 4095 || y > 4095) return null;
        out.push({ x, y });
      }
      return out;
    }
    // Ramer-Douglas-Peucker keeps the gesture's character while shedding bytes.
    function simplify(pts, tol) {
      if (pts.length < 3 || tol <= 0) return pts.slice();
      const keep = new Uint8Array(pts.length);
      keep[0] = keep[pts.length - 1] = 1;
      const stack = [[0, pts.length - 1]];
      const t2 = tol * tol;
      while (stack.length) {
        const [a, b] = stack.pop();
        let best = -1, bi = -1;
        for (let i = a + 1; i < b; i++) {
          const d = distSegSq(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y);
          if (d > best) { best = d; bi = i; }
        }
        if (best > t2 && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
      }
      return pts.filter((_, i) => keep[i]);
    }

    // =====================================================================
    // 4. Contribution model + validator (shared by seeds, server data, drafts)
    //    Wire object: { v:1, m:"a"|"c"|"t", p?:parentId, t:unixSeconds,
    //                   k:[ [0,brush,color,width,points] | [1,brush,color,shape,x,y,r,deg] ] }
    // =====================================================================
    const SCHEMA_VERSION = 1;
    function isId(s) { return typeof s === "string" && s.length > 0 && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s); }
    function isInt(v, a, b) { return Number.isInteger(v) && v >= a && v <= b; }

    function decodeContribution(id, wire, meta) {
      if (!isId(id) || !wire || typeof wire !== "object") return null;
      if (wire.v !== SCHEMA_VERSION) return null;
      const mode = wire.m;
      if (mode !== "a" && mode !== "c" && mode !== "t") return null;
      if (!Array.isArray(wire.k) || wire.k.length < 1 || wire.k.length > 12) return null;
      const parent = wire.p === undefined || wire.p === null ? null : wire.p;
      if (parent !== null && !isId(parent)) return null;
      let totalPoints = 0;
      const marks = [];
      for (const raw of wire.k) {
        if (!Array.isArray(raw)) return null;
        if (raw[0] === 0 && raw.length === 5) {
          const [, brush, color, width, enc] = raw;
          if (!isInt(brush, 0, 2) || !isInt(color, 0, COLORS.length - 1) || !isInt(width, 0, WIDTHS.length - 1)) return null;
          const pts = decodePoints(enc);
          if (!pts) return null;
          totalPoints += pts.length;
          marks.push(prepareMark({ kind: "stroke", brush, color, width, pts }, id, marks.length));
        } else if (raw[0] === 1 && raw.length === 8) {
          const [, brush, color, shape, x, y, r, deg] = raw;
          if (!isInt(brush, 0, 2) || !isInt(color, 0, COLORS.length - 1) || !isInt(shape, 0, SHAPES.length - 1)) return null;
          if (!isInt(x, 0, 4095) || !isInt(y, 0, 4095) || !isInt(r, 4, 400) || !isInt(deg, 0, 359)) return null;
          marks.push(prepareMark({ kind: "stamp", brush, color, shape, x, y, r, a: deg }, id, marks.length));
        } else {
          return null;
        }
      }
      if (totalPoints > 600) return null;
      const t = Number.isFinite(wire.t) && wire.t > 0 ? wire.t * 1000 : 0;
      let bbox = null;
      for (const m of marks) bbox = bboxUnion(bbox, m.bbox);
      return {
        id, mode, parent, marks, bbox,
        clientTime: t,
        serverSeq: meta && Number.isFinite(meta.seq) ? meta.seq : null,
        serverTime: meta && Number.isFinite(meta.time) ? meta.time : null,
        seed: !!(meta && meta.seed),
        wire
      };
    }

    function prepareMark(m, ownerId, index) {
      m.owner = ownerId;
      m.index = index;
      if (m.kind === "stroke") {
        const half = WIDTHS[m.width] * (m.brush === BRUSH.GLOW ? 1.6 : m.brush === BRUSH.SOFT ? 1.2 : 0.5);
        m.bbox = bboxOf(m.pts, half + 2);
        m.path = strokePath(m.pts);
      } else {
        m.path = stampPath(m, ownerId, index);
        const rr = m.r * (m.shape === 2 ? 1.25 : 1.15);
        m.bbox = { x0: m.x - rr, y0: m.y - rr, x1: m.x + rr, y1: m.y + rr };
      }
      return m;
    }

    function encodeDraftMarks(marks) {
      return marks.map((m) => m.kind === "stroke"
        ? [0, m.brush, m.color, m.width, encodePoints(m.pts)]
        : [1, m.brush, m.color, m.shape, Math.round(m.x), Math.round(m.y), Math.round(clampN(m.r, 4, 400)), ((Math.round(m.a) % 360) + 360) % 360]);
    }

    // =====================================================================
    // 5. Paths (cached per mark as Path2D in world coordinates)
    // =====================================================================
    function strokePath(pts) {
      const p = new Path2D();
      p.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) { p.lineTo(pts[0].x + 0.01, pts[0].y); return p; }
      if (pts.length === 2) { p.lineTo(pts[1].x, pts[1].y); return p; }
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        p.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      p.lineTo(last.x, last.y);
      return p;
    }
    function stampPath(m, ownerId, index) {
      const p = new Path2D();
      const { x, y, r } = m;
      const a = (m.a * Math.PI) / 180;
      const rot = (px, py) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)];
      const poly = (pts) => { pts.forEach(([px, py], i) => { const [X, Y] = rot(px, py); i ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath(); };
      switch (SHAPES[m.shape]) {
        case "circle": p.arc(x, y, r, 0, Math.PI * 2); break;
        case "ring": p.arc(x, y, r, 0, Math.PI * 2); break;
        case "rect": poly([[-r, -r * 0.62], [r, -r * 0.62], [r, r * 0.62], [-r, r * 0.62]]); break;
        case "triangle": poly([[0, -r], [r * 0.92, r * 0.62], [-r * 0.92, r * 0.62]]); break;
        case "burst": {
          const pts = [];
          for (let i = 0; i < 24; i++) { const rr = i % 2 ? r * 0.42 : r; const t = (i / 24) * Math.PI * 2; pts.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
          poly(pts);
          break;
        }
        default: { // blob: irregular, deterministic per contribution
          const rand = rng(hashStr(ownerId + ":" + index));
          const n = 9, pts = [];
          for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; const rr = r * (0.68 + rand() * 0.45); pts.push(rot(Math.cos(t) * rr, Math.sin(t) * rr)); }
          const mid = (i) => { const A = pts[i % n], B = pts[(i + 1) % n]; return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; };
          const m0 = mid(n - 1);
          p.moveTo(m0[0], m0[1]);
          for (let i = 0; i < n; i++) { const m1 = mid(i); p.quadraticCurveTo(pts[i][0], pts[i][1], m1[0], m1[1]); }
          p.closePath();
        }
      }
      return p;
    }

    // =====================================================================
    // 6. Mark rendering. Three deliberately different edge qualities:
    //    SOLID stays crisp (source-over), GLOW is additive and restrained
    //    (layered strokes, no shadowBlur), SOFT is translucent and feathered.
    // =====================================================================
    function drawMark(g, m, alpha) {
      alpha = alpha === undefined ? 1 : alpha;
      const col = COLORS[m.color];
      const dark = m.color === INK;
      g.lineCap = "round";
      g.lineJoin = "round";
      if (m.kind === "stroke") {
        const w = WIDTHS[m.width];
        if (m.brush === BRUSH.SOLID) {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = alpha;
          g.strokeStyle = col; g.lineWidth = w; g.stroke(m.path);
        } else if (m.brush === BRUSH.GLOW) {
          const G = 0.35 + CFG.glow * 0.65;
          g.globalCompositeOperation = dark ? "source-over" : "lighter";
          g.strokeStyle = col;
          g.globalAlpha = alpha * (dark ? 0.18 : 0.07) * G; g.lineWidth = w * 3.4; g.stroke(m.path);
          g.globalAlpha = alpha * (dark ? 0.3 : 0.16) * G; g.lineWidth = w * 2.0; g.stroke(m.path);
          g.globalAlpha = alpha * 0.9; g.lineWidth = w * 0.9; g.stroke(m.path);
          if (!dark) {
            g.strokeStyle = "#ffffff";
            g.globalAlpha = alpha * 0.55 * G; g.lineWidth = Math.max(1, w * 0.3); g.stroke(m.path);
          }
        } else {
          g.globalCompositeOperation = "source-over";
          g.strokeStyle = col;
          g.globalAlpha = alpha * 0.06; g.lineWidth = w * 2.6; g.stroke(m.path);
          g.globalAlpha = alpha * 0.09; g.lineWidth = w * 1.7; g.stroke(m.path);
          g.globalAlpha = alpha * 0.14; g.lineWidth = w * 1.0; g.stroke(m.path);
        }
      } else {
        const ring = SHAPES[m.shape] === "ring";
        const r = m.r;
        if (m.brush === BRUSH.SOLID) {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = alpha;
          if (ring) { g.strokeStyle = col; g.lineWidth = Math.max(3, r * 0.2); g.stroke(m.path); }
          else { g.fillStyle = col; g.fill(m.path); }
        } else if (m.brush === BRUSH.GLOW) {
          const G = 0.35 + CFG.glow * 0.65;
          g.globalCompositeOperation = dark ? "source-over" : "lighter";
          g.strokeStyle = col; g.fillStyle = col;
          if (!ring) { g.globalAlpha = alpha * (dark ? 0.35 : 0.13); g.fill(m.path); }
          g.globalAlpha = alpha * 0.1 * G; g.lineWidth = Math.max(6, r * 0.34); g.stroke(m.path);
          g.globalAlpha = alpha * 0.9; g.lineWidth = Math.max(2, r * (ring ? 0.12 : 0.06)); g.stroke(m.path);
          if (!dark) { g.strokeStyle = "#ffffff"; g.globalAlpha = alpha * 0.5 * G; g.lineWidth = Math.max(1, r * 0.025); g.stroke(m.path); }
        } else {
          g.globalCompositeOperation = dark ? "source-over" : "screen";
          g.fillStyle = col; g.strokeStyle = col;
          if (ring) {
            g.globalAlpha = alpha * 0.12; g.lineWidth = r * 0.5; g.stroke(m.path);
            g.globalAlpha = alpha * 0.22; g.lineWidth = r * 0.22; g.stroke(m.path);
          } else {
            g.globalAlpha = alpha * 0.1; g.lineWidth = r * 0.3; g.stroke(m.path);
            g.globalAlpha = alpha * (dark ? 0.45 : 0.3); g.fill(m.path);
          }
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    function drawContribution(g, c, alpha) { for (const m of c.marks) drawMark(g, m, alpha); }

    // =====================================================================
    // 7. Seed contributions: a small, labelled starting composition that runs
    //    through the same codec + validator as player marks. They are built in
    //    and sit beneath everything; they are not written to the shared world.
    // =====================================================================
    function seedWire(marks) { return { v: 1, m: "a", t: 0, k: encodeDraftMarks(marks) }; }
    function wave(x0, y0, x1, y1, amp, cycles, n, phase) {
      const pts = [];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const off = Math.sin(t * Math.PI * 2 * cycles + phase) * amp * Math.sin(t * Math.PI);
        pts.push({ x: x0 + dx * t + nx * off, y: y0 + dy * t + ny * off });
      }
      return pts;
    }
    const SEED_DEFS = [
      [{ kind: "stroke", brush: BRUSH.GLOW, color: 0, width: 1, pts: wave(700, 1150, 1330, 900, 90, 1.2, 22, 0.4) }],
      [{ kind: "stroke", brush: BRUSH.SOLID, color: 1, width: 2, pts: wave(760, 820, 1060, 760, 40, 0.8, 12, 1.2) }],
      [{ kind: "stamp", brush: BRUSH.SOLID, color: 3, shape: 1, x: 1180, y: 1000, r: 70, a: 0 }],
      [{ kind: "stamp", brush: BRUSH.SOFT, color: 5, shape: 5, x: 880, y: 1250, r: 110, a: 20 }],
      [
        { kind: "stamp", brush: BRUSH.GLOW, color: 2, shape: 4, x: 1260, y: 760, r: 26, a: 10 },
        { kind: "stamp", brush: BRUSH.GLOW, color: 2, shape: 4, x: 1305, y: 800, r: 14, a: 40 },
        { kind: "stamp", brush: BRUSH.SOLID, color: 7, shape: 0, x: 1230, y: 815, r: 6, a: 0 }
      ],
      [{ kind: "stamp", brush: BRUSH.SOLID, color: 4, shape: 3, x: 760, y: 980, r: 44, a: 200 }],
      [{ kind: "stroke", brush: BRUSH.SOLID, color: INK, width: 2, pts: wave(1000, 1300, 1120, 820, 14, 2.5, 14, 0) }],
      [{ kind: "stroke", brush: BRUSH.SOLID, color: 7, width: 0, pts: wave(1210, 1180, 1390, 1290, 22, 3, 24, 0.7) }]
    ];
    const SEEDS = SEED_DEFS.map((marks, i) => decodeContribution("seed-" + (i + 1), seedWire(marks), { seed: true, seq: -1000 + i })).filter(Boolean);

    // =====================================================================
    // 8. Repositories. The drawing engine only talks to this interface:
    //      load() -> [{ id, object, meta }]   append(id, object) -> result
    //    "shared" uses the Plethora objects world; "local" is a clearly
    //    labelled single-device fallback when the world API is unavailable.
    // =====================================================================
    function normalizeSnapshot(snap) {
      const out = [];
      if (!snap || typeof snap !== "object") return out;
      const candidates = [snap.objects, snap.state && snap.state.objects, snap.data && snap.data.objects, snap.items, snap.entries];
      let src = candidates.find((v) => v && typeof v === "object");
      if (!src) src = snap;
      const metaOf = (e, i) => {
        const seq = [e.seq, e.sequence, e.revision, e.version, e.order].find((v) => Number.isFinite(v));
        const tRaw = [e.createdAt, e.created_at, e.insertedAt, e.updatedAt, e.updated_at, e.at].find((v) => v !== undefined && v !== null);
        const time = typeof tRaw === "number" ? tRaw : tRaw ? Date.parse(tRaw) : NaN;
        return { seq: Number.isFinite(seq) ? seq : null, time: Number.isFinite(time) ? time : null, index: i };
      };
      if (Array.isArray(src)) {
        src.forEach((e, i) => {
          if (!e || typeof e !== "object") return;
          const id = e.id || e.key;
          const object = e.object || e.value || e.data || (e.v ? e : null);
          if (id && object) out.push({ id, object, meta: metaOf(e, i) });
        });
      } else {
        Object.keys(src).forEach((id, i) => {
          const e = src[id];
          if (!e || typeof e !== "object") return;
          if (e.object && typeof e.object === "object") out.push({ id, object: e.object, meta: metaOf(e, i) });
          else out.push({ id, object: e, meta: { seq: null, time: null, index: i } });
        });
      }
      return out;
    }

    function createSharedRepo() {
      const world = ctx.memory.world("canvas");
      return {
        kind: "shared",
        async load() { return normalizeSnapshot(await world.get()); },
        async append(id, object) { return world.mutate({ id, object }); }
      };
    }
    function createLocalRepo() {
      const KEY = "uc_local_world_v1";
      return {
        kind: "local",
        async load() {
          const list = sget(KEY, []);
          return (Array.isArray(list) ? list : []).map((e, i) => ({ id: e.id, object: e.object, meta: { seq: i, time: e.at || null, index: i } }));
        },
        async append(id, object) {
          const list = sget(KEY, []);
          const arr = Array.isArray(list) ? list : [];
          if (!arr.some((e) => e.id === id)) arr.push({ id, object, at: Date.now() });
          sset(KEY, arr.slice(-200));
          return { ok: true };
        }
      };
    }
    const hasWorld = !!(ctx.memory && typeof ctx.memory.world === "function");
    let repo = hasWorld ? createSharedRepo() : createLocalRepo();

    // =====================================================================
    // 9. Canvas model: ordered, immutable contributions + spatial index
    // =====================================================================
    const model = {
      byId: new Map(),
      ordered: [],     // player contributions in authoritative order
      all: [],         // seeds + ordered
      grid: new Map(), // cell -> [{ c, m, z }]
      cell: 128
    };
    const mine = new Set(sget("uc_mine", []));

    function orderKey(c) {
      if (c.serverSeq !== null) return [0, c.serverSeq, 0];
      if (c.serverTime !== null) return [1, c.serverTime, 0];
      return [2, c.clientTime, c.loadIndex || 0];
    }
    function compareContribs(a, b) {
      const ka = orderKey(a), kb = orderKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      if (ka[2] !== kb[2]) return ka[2] - kb[2];
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    // Append-only merge: a known id is never replaced or removed by later data.
    function mergeEntries(entries) {
      const fresh = [];
      let reorder = false;
      for (const e of entries) {
        const known = model.byId.get(e.id);
        if (known) {
          // Ordering metadata may arrive later from the server; content never changes.
          if (e.meta && e.meta.seq !== null && known.serverSeq !== e.meta.seq) { known.serverSeq = e.meta.seq; reorder = true; }
          else if (e.meta && e.meta.seq === null && e.meta.time !== null && known.serverSeq === null && known.serverTime !== e.meta.time) { known.serverTime = e.meta.time; reorder = true; }
          continue;
        }
        const c = decodeContribution(e.id, e.object, e.meta);
        if (!c) continue;
        c.loadIndex = e.meta ? e.meta.index : 0;
        model.byId.set(c.id, c);
        fresh.push(c);
      }
      if (fresh.length || reorder) {
        model.ordered = model.ordered.concat(fresh).sort(compareContribs);
        rebuildIndex();
        if (reorder && !fresh.length) invalidateArt();
      }
      return fresh;
    }
    function rebuildIndex() {
      model.all = SEEDS.concat(model.ordered);
      model.all.forEach((c, i) => { c.z = i; c.number = c.seed ? 0 : i - SEEDS.length + 1; });
      model.grid = new Map();
      const S = model.cell;
      for (const c of model.all) {
        for (const m of c.marks) {
          const b = m.bbox;
          for (let gx = Math.floor(b.x0 / S); gx <= Math.floor(b.x1 / S); gx++) {
            for (let gy = Math.floor(b.y0 / S); gy <= Math.floor(b.y1 / S); gy++) {
              const k = gx + "," + gy;
              let list = model.grid.get(k);
              if (!list) model.grid.set(k, (list = []));
              list.push({ c, m });
            }
          }
        }
      }
    }
    // Every mark under a world point, topmost first, including covered ones.
    function marksAt(wx, wy, tolWorld, maxZ) {
      const list = model.grid.get(Math.floor(wx / model.cell) + "," + Math.floor(wy / model.cell)) || [];
      const hits = [];
      for (const ref of list) {
        if (maxZ !== undefined && ref.c.z > maxZ) continue;
        if (markHit(ref.m, wx, wy, tolWorld)) hits.push(ref);
      }
      hits.sort((a, b) => b.c.z - a.c.z || b.m.index - a.m.index);
      return hits;
    }
    function markHit(m, wx, wy, tol) {
      const b = m.bbox;
      if (wx < b.x0 - tol || wx > b.x1 + tol || wy < b.y0 - tol || wy > b.y1 + tol) return false;
      if (m.kind === "stroke") {
        const r = WIDTHS[m.width] * (m.brush === BRUSH.SOLID ? 0.5 : 0.9) + tol;
        const r2 = r * r;
        const p = m.pts;
        if (p.length === 1) return (p[0].x - wx) ** 2 + (p[0].y - wy) ** 2 <= r2;
        for (let i = 1; i < p.length; i++) if (distSegSq(wx, wy, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y) <= r2) return true;
        return false;
      }
      const d = Math.hypot(wx - m.x, wy - m.y);
      if (SHAPES[m.shape] === "ring") return Math.abs(d - m.r) <= m.r * 0.25 + tol;
      return d <= m.r * 1.05 + tol;
    }
    function coveredBy(c) {
      let n = 0;
      for (const o of model.all) if (o.z > c.z && bboxHit(o.bbox, c.bbox)) n++;
      return n;
    }
    function childrenOf(c) { return model.ordered.filter((o) => o.parent === c.id); }
    function nearestOnMark(m, wx, wy) {
      if (m.kind === "stamp") {
        const a = Math.atan2(wy - m.y, wx - m.x);
        const rr = SHAPES[m.shape] === "rect" ? m.r * 0.8 : m.r;
        return { x: m.x + Math.cos(a) * rr, y: m.y + Math.sin(a) * rr };
      }
      let best = null, bd = Infinity;
      const p = m.pts;
      for (let i = 0; i < p.length; i++) {
        const A = p[i], B = p[Math.min(i + 1, p.length - 1)];
        const dx = B.x - A.x, dy = B.y - A.y, l = dx * dx + dy * dy;
        let t = l ? ((wx - A.x) * dx + (wy - A.y) * dy) / l : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const q = { x: A.x + dx * t, y: A.y + dy * t };
        const d = (q.x - wx) ** 2 + (q.y - wy) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    }

    function unlockedLevel(count) { let l = 0; for (const m of CFG.milestones) if (count >= m) l++; return l; }
    function sectionBounds() {
      const h = SECTION_HALF[unlockedLevel(model.ordered.length)];
      return { x0: CENTER - h, y0: CENTER - h, x1: CENTER + h, y1: CENTER + h };
    }

    // =====================================================================
    // 10. Surfaces, camera
    // =====================================================================
    const canvas = ctx.createCanvas2D({ maxDpr: 2, touchAction: "none", layer: "content", alpha: false });
    const g = canvas.getContext("2d");
    let W = ctx.width, H = ctx.height, SAFE = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    const cam = { x: CENTER, y: CENTER, s: 0.4 };
    let fitScale = 0.4;

    function makeBuffer(w, h) {
      if (typeof OffscreenCanvas !== "undefined") { try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ } }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    }
    let art = makeBuffer(4, 4), artG = art.getContext("2d");
    let artView = null;  // camera the art buffer was rendered with
    let artDirty = true;
    let artLimit = Infinity;
    let dirty = true;

    function backingScale() { return canvas.width / Math.max(1, W); }
    function computeFit() {
      const b = sectionBounds();
      const topUI = 64 + SAFE.top, bottomUI = 120 + SAFE.bottom;
      const availH = Math.max(160, H - topUI - bottomUI);
      fitScale = Math.min(W / ((b.x1 - b.x0) * 1.06), availH / ((b.y1 - b.y0) * 1.06));
    }
    function fitView() {
      computeFit();
      const b = sectionBounds();
      cam.s = fitScale;
      cam.x = (b.x0 + b.x1) / 2;
      // shift so the art sits between header and tool tray
      cam.y = (b.y0 + b.y1) / 2 + ((120 + SAFE.bottom) - (64 + SAFE.top)) / 2 / cam.s;
      clampCam();
      invalidateArt();
    }
    function clampCam() {
      cam.s = clampN(cam.s, fitScale * 0.7, 7);
      const b = sectionBounds();
      const m = 120;
      cam.x = clampN(cam.x, b.x0 - m, b.x1 + m);
      cam.y = clampN(cam.y, b.y0 - m, b.y1 + m);
    }
    function toWorld(sx, sy) { return { x: (sx - W / 2) / cam.s + cam.x, y: (sy - H / 2) / cam.s + cam.y }; }
    function toScreen(wx, wy) { return { x: (wx - cam.x) * cam.s + W / 2, y: (wy - cam.y) * cam.s + H / 2 }; }
    function applyWorld(gg, scale) { gg.setTransform(scale * cam.s, 0, 0, scale * cam.s, scale * (W / 2 - cam.x * cam.s), scale * (H / 2 - cam.y * cam.s)); }

    // Re-render the vector artwork once the view settles; during a gesture the
    // last render is reused under a transform. Tokens make stale timers no-ops.
    let artToken = 0;
    function invalidateArt(delayMs) {
      dirty = true;
      const tok = ++artToken;
      if (delayMs) ctx.timeout(() => { if (tok === artToken) { artDirty = true; dirty = true; } }, delayMs);
      else artDirty = true;
    }

    let grainPattern = null;
    let vignette = null;
    function buildGrain() {
      const n = 96;
      const c = makeBuffer(n, n);
      const cg = c.getContext("2d");
      const img = cg.createImageData(n, n);
      const rand = rng(7);
      for (let i = 0; i < n * n; i++) {
        const v = Math.floor(rand() * 255);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      cg.putImageData(img, 0, 0);
      grainPattern = g.createPattern(c, "repeat");
    }

    function renderArt() {
      const s = backingScale();
      const bw = canvas.width, bh = canvas.height;
      if (art.width !== bw || art.height !== bh) { art = makeBuffer(bw, bh); artG = art.getContext("2d"); }
      const a = artG;
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalAlpha = 1;
      a.globalCompositeOperation = "source-over";
      a.fillStyle = OUTSIDE;
      a.fillRect(0, 0, bw, bh);
      applyWorld(a, s);
      const b = sectionBounds();
      a.fillStyle = BG;
      a.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      // frame ticks at the canvas edge: quiet, not a whiteboard border
      a.strokeStyle = "rgba(237,239,242,0.16)";
      a.lineWidth = 1.2 / cam.s;
      const t = 26 / cam.s;
      a.beginPath();
      for (const [x, y, dx, dy] of [[b.x0, b.y0, 1, 1], [b.x1, b.y0, -1, 1], [b.x0, b.y1, 1, -1], [b.x1, b.y1, -1, -1]]) {
        a.moveTo(x + dx * t, y); a.lineTo(x, y); a.lineTo(x, y + dy * t);
      }
      a.stroke();
      // visible world rect for culling
      const v0 = toWorld(0, 0), v1 = toWorld(W, H);
      const view = { x0: v0.x, y0: v0.y, x1: v1.x, y1: v1.y };
      for (const c of model.all) {
        if (c.z > artLimit) break;
        if (!bboxHit(c.bbox, view, 40)) continue;
        drawContribution(a, c, 1);
      }
      artView = { x: cam.x, y: cam.y, s: cam.s, W, H };
      artDirty = false;
    }

    // =====================================================================
    // 11. Game state
    // =====================================================================
    const today = Math.floor(Date.now() / 86400000);
    const prompt = PROMPTS[today % PROMPTS.length];
    const visits = (sget("uc_visits", 0) || 0) + 1;
    sset("uc_visits", visits);
    const tut = { contributed: sget("uc_contrib_count", 0) || 0, sawHistory: !!sget("uc_saw_history", false) };

    const S = {
      phase: "loading",   // loading | explore | pick | draw | preview | submitting | history
      mode: null,         // a | c | t
      target: null,       // { c, m } selected for CONTINUE / TRANSFORM
      pickStack: null,    // marks under the last pick tap, for cycling into deeper layers
      pickIndex: 0,
      submittedThisVisit: 0,
      connection: "connecting", // connecting | shared | local | offline
      lastError: null,
      history: { limit: 0, playing: false, inspect: null, stack: null, idx: 0, lastTap: null }
    };
    const draft = {
      id: null, marks: [], active: null, usedMs: 0,
      brush: BRUSH.GLOW, color: 0, width: 1, shape: 0, stampMode: false, navLock: false
    };

    // =====================================================================
    // 12. DOM UI (quiet, thumb-friendly, frames the canvas)
    // =====================================================================
    const ui = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "uc" });
    ui.innerHTML = `
<style>
.uc{--bg:#050607;--fg:#EDEFF2;--mute:rgba(237,239,242,.55);--line:rgba(237,239,242,.14);--coral:#FF426D;--cyan:#43E4E0;
  font-family:"Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.uc *{box-sizing:border-box}
.uc button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;pointer-events:auto;touch-action:manipulation}
.uc .top{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;justify-content:space-between;padding:12px 14px 0}
.uc .mark{font-weight:700;letter-spacing:.14em;font-size:11px;line-height:1.3;text-transform:uppercase}
.uc .mark small{display:block;font-family:"Space Mono",ui-monospace,monospace;font-weight:400;letter-spacing:.02em;text-transform:none;font-size:11px;color:var(--mute);margin-top:2px}
.uc .live{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);margin-right:6px;vertical-align:1px;box-shadow:0 0 8px var(--cyan)}
.uc .live.local{background:#FFC45B;box-shadow:none}.uc .live.off{background:#666;box-shadow:none}
.uc .icons{display:flex;gap:8px}
.uc .ib{width:40px;height:40px;border-radius:20px;border:1px solid var(--line);background:rgba(5,6,7,.55);display:grid;place-items:center}
.uc .ib svg{width:18px;height:18px;stroke:var(--fg);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.uc .ib.on{border-color:var(--fg)}
.uc .pill{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:min(360px,calc(100% - 28px));padding:8px 14px;border-radius:999px;background:rgba(5,6,7,.78);border:1px solid var(--line);font-size:13px;line-height:1.3;text-align:center;pointer-events:auto;transition:opacity .4s}
.uc .pill b{display:block;font-weight:600;color:var(--coral);margin-bottom:3px;font-size:10px;letter-spacing:.14em;text-transform:uppercase}
.uc .hide{opacity:0!important;pointer-events:none!important}
.uc .gone{display:none!important}
.uc .bottom{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 12px}
.uc .cta{pointer-events:auto;height:52px;padding:0 30px;border-radius:26px;background:var(--fg);color:#050607;font-weight:700;letter-spacing:.16em;font-size:14px;display:flex;align-items:center;gap:10px}
.uc .cta i{width:8px;height:8px;border-radius:50%;background:var(--coral)}
.uc .cta.spent{background:rgba(237,239,242,.08);color:var(--mute);border:1px solid var(--line);letter-spacing:.06em;font-weight:500;font-size:13px}
.uc .cta.spent i{background:var(--cyan)}
.uc .coach{font-size:12.5px;color:var(--mute);text-align:center;max-width:300px;line-height:1.35;pointer-events:none}
.uc .coach em{font-style:normal;color:var(--fg)}
.uc .sheet{pointer-events:auto;width:100%;max-width:440px;background:rgba(8,10,12,.94);border:1px solid var(--line);border-radius:22px;padding:14px}
.uc .sheet h3{margin:0 0 10px;font-size:11px;letter-spacing:.16em;font-weight:600;color:var(--mute);display:flex;justify-content:space-between;align-items:center}
.uc .modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.uc .mode{border:1px solid var(--line);border-radius:16px;padding:12px 10px;text-align:left;min-height:104px;position:relative;display:flex;flex-direction:column;gap:6px}
.uc .mode .g{height:28px}
.uc .mode .g svg{height:28px;width:100%;overflow:visible}
.uc .mode b{font-size:12px;letter-spacing:.12em}
.uc .mode span{font-size:12px;color:var(--mute);line-height:1.25}
.uc .mode .tag{position:absolute;top:8px;right:8px;font-size:9px;letter-spacing:.12em;color:#050607;background:var(--cyan);border-radius:6px;padding:2px 5px}
.uc .x{font-size:20px;line-height:1;color:var(--mute);width:32px;height:32px;display:grid;place-items:center}
.uc .tray{pointer-events:auto;width:100%;max-width:460px;background:rgba(8,10,12,.92);border:1px solid var(--line);border-radius:22px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.uc .row{display:flex;align-items:center;gap:6px;justify-content:space-between}
.uc .seg{display:flex;gap:4px;flex-wrap:nowrap}
.uc .chip{height:34px;min-width:34px;padding:0 10px;border-radius:17px;border:1px solid transparent;font-size:12px;letter-spacing:.04em;color:var(--mute);display:flex;align-items:center;justify-content:center;gap:6px}
.uc .chip.on{border-color:rgba(237,239,242,.6);color:var(--fg)}
.uc .chip svg{width:18px;height:18px;overflow:visible}
.uc .sw{width:26px;height:26px;border-radius:50%;border:2px solid transparent;padding:0;flex:0 0 auto}
.uc .sw.on{border-color:var(--fg);transform:scale(1.08)}
.uc .swatches{display:flex;gap:5px;justify-content:space-between;width:100%}
.uc .acts{display:flex;align-items:center;gap:8px}
.uc .btn{height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line);font-size:13px;font-weight:600;letter-spacing:.06em;display:flex;align-items:center;gap:8px}
.uc .btn.primary{background:var(--fg);color:#050607;border-color:var(--fg)}
.uc .btn[disabled]{opacity:.35}
.uc .meter{position:relative;width:40px;height:40px;flex:0 0 auto}
.uc .meter svg{width:40px;height:40px;transform:rotate(-90deg)}
.uc .meter span{position:absolute;inset:0;display:grid;place-items:center;font-family:"Space Mono",ui-monospace,monospace;font-size:11px}
.uc .status{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;color:var(--mute)}
.uc .modechip{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:min(400px,calc(100% - 28px));display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.14em;font-weight:600;pointer-events:auto;background:rgba(5,6,7,.78);border:1px solid var(--line);border-radius:999px;padding:6px 6px 6px 14px}
 .uc .modechip .q{flex:1 1 auto;min-width:0;line-height:1.25;letter-spacing:0;font-weight:400;color:var(--mute);font-size:12px;text-transform:none}
.uc .toast{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 40px);padding:16px 22px;border-radius:18px;background:rgba(5,6,7,.72);font-weight:700;letter-spacing:.22em;font-size:20px;text-align:center;pointer-events:none;transition:opacity .5s, transform .5s;text-shadow:0 0 24px rgba(5,6,7,.9)}
.uc .toast small{display:block;margin-top:8px;letter-spacing:.04em;font-weight:400;font-size:13px;color:var(--mute)}
.uc .card{pointer-events:auto;width:100%;max-width:440px;background:rgba(8,10,12,.94);border:1px solid var(--line);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.uc .card .meta{font-family:"Space Mono",ui-monospace,monospace;font-size:11.5px;color:var(--mute);line-height:1.45}
.uc .card .meta b{color:var(--fg);font-weight:400}
.uc .card .title{font-size:13px;font-weight:600;letter-spacing:.06em;display:flex;justify-content:space-between;align-items:center}
.uc input[type=range]{pointer-events:auto;width:100%;accent-color:#EDEFF2;height:28px}
.uc .daychips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.uc .daychips .chip{border-color:var(--line);flex:0 0 auto;height:28px}
.uc .err{font-size:12px;color:#FFC45B;text-align:center}
@media (prefers-reduced-motion:reduce){.uc .pill,.uc .toast{transition:none}}
</style>
<div class="top" data-r="top">
  <div class="mark">The Unfinished Canvas<small data-r="count"><span class="live off"></span>connecting…</small></div>
  <div class="icons">
    <button class="ib" data-r="history" aria-label="History"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg></button>
    <button class="ib" data-r="fit" aria-label="Whole canvas"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
  </div>
</div>
<div class="pill hide" data-r="prompt"></div>
<div class="modechip gone" data-r="modechip"></div>
<div class="toast hide" data-r="toast"></div>
<div class="bottom" data-r="bottom"></div>`;
    const $ = (r) => ui.querySelector(`[data-r="${r}"]`);
    const el = { top: $("top"), count: $("count"), history: $("history"), fit: $("fit"), prompt: $("prompt"), modechip: $("modechip"), toast: $("toast"), bottom: $("bottom") };

    function layoutUI() {
      el.top.style.paddingTop = 12 + SAFE.top + "px";
      el.top.style.paddingLeft = 14 + SAFE.left + "px";
      el.top.style.paddingRight = 14 + SAFE.right + "px";
      el.prompt.style.top = 64 + SAFE.top + "px";
      el.modechip.style.top = 64 + SAFE.top + "px";
      el.bottom.style.bottom = Math.max(18, SAFE.bottom + 14) + "px";
    }

    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    function updateCount() {
      const n = model.ordered.length;
      const next = CFG.milestones.find((m) => m > n);
      const dot = S.connection === "shared" ? "live" : S.connection === "local" ? "live local" : "live off";
      let label;
      if (S.connection === "connecting") label = "connecting…";
      else if (S.connection === "offline") label = "can't reach the shared canvas";
      else label = (n === 0 ? "no marks yet — be the first" : `${n} mark${n === 1 ? "" : "s"}` + (next ? ` · next edge at ${next}` : "")) + (S.connection === "local" ? " · this device only" : "");
      el.count.innerHTML = `<span class="${dot}"></span>${esc(label)}`;
    }

    let promptTok = 0;
    function showPrompt(html, ms) {
      el.prompt.innerHTML = html;
      el.prompt.classList.remove("hide");
      const tok = ++promptTok;
      if (ms) ctx.timeout(() => { if (tok === promptTok) el.prompt.classList.add("hide"); }, ms);
    }
    function hidePrompt() { promptTok++; el.prompt.classList.add("hide"); }

    let toastTok = 0;
    function toast(html, ms) {
      el.toast.innerHTML = html;
      el.toast.classList.remove("hide");
      const tok = ++toastTok;
      ctx.timeout(() => { if (tok === toastTok) el.toast.classList.add("hide"); }, ms || 1800);
    }

    // ---- tiny inline glyphs for the mode cards (drawn, not icon-font) ----
    const GLYPH = {
      a: `<svg viewBox="0 0 90 28"><path d="M6 20 C 24 4, 40 26, 58 10" stroke="#FF7048" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="74" cy="14" r="7" fill="#43E4E0"/></svg>`,
      c: `<svg viewBox="0 0 90 28"><path d="M6 20 C 18 8, 30 8, 40 14" stroke="#EDEFF2" stroke-opacity=".45" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M40 14 C 52 22, 66 24, 84 6" stroke="#FF426D" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="40" cy="14" r="3.5" fill="#EDEFF2"/></svg>`,
      t: `<svg viewBox="0 0 90 28"><path d="M8 18 C 30 2, 58 30, 82 12" stroke="#FF7048" stroke-opacity=".55" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="45" cy="15" r="10" fill="none" stroke="#43E4E0" stroke-width="3"/></svg>`
    };
    const BRUSH_GLYPH = [
      `<svg viewBox="0 0 18 18"><path d="M3 13 C 7 3, 11 15, 15 5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M3 13 C 7 3, 11 15, 15 5" stroke="currentColor" stroke-opacity=".3" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M3 13 C 7 3, 11 15, 15 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M3 13 C 7 3, 11 15, 15 5" stroke="currentColor" stroke-opacity=".22" stroke-width="7" fill="none" stroke-linecap="round"/></svg>`
    ];
    const SHAPE_GLYPH = [
      `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
      `<svg viewBox="0 0 18 18"><rect x="2.5" y="5" width="13" height="8" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M9 2.5 L15.5 14 L2.5 14Z" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M9 1 L10.6 6.4 L16 5 L12 9 L16 13 L10.6 11.6 L9 17 L7.4 11.6 L2 13 L6 9 L2 5 L7.4 6.4Z" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M4 7 C 4 2, 12 2, 14 6 C 17 10, 13 16, 8 15 C 3 14, 4 11, 4 7Z" fill="currentColor"/></svg>`
    ];
    const STAMP_GLYPH = `<svg viewBox="0 0 18 18"><circle cx="6.5" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 15 L13.5 8.5 L17 15Z" fill="currentColor"/></svg>`;
    const HAND_GLYPH = `<svg viewBox="0 0 18 18"><path d="M9 2v14M2 9h14M9 2l-2 2M9 2l2 2M9 16l-2-2M9 16l2-2M2 9l2-2M2 9l2 2M16 9l-2-2M16 9l-2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;

    // ---- bottom area renderers per phase ----
    function renderBottom() {
      const b = el.bottom;
      el.modechip.classList.add("gone");
      el.history.classList.toggle("on", S.phase === "history");
      if (S.phase === "loading") {
        b.innerHTML = `<div class="coach">Loading the canvas…</div>`;
        return;
      }
      if (S.phase === "explore") {
        const spent = S.submittedThisVisit >= CFG.perVisit;
        const offline = S.connection === "offline";
        let coach = "";
        if (offline) coach = `<div class="err">The shared canvas is out of reach right now. <button data-a="retry" style="text-decoration:underline">Try again</button></div>`;
        else if (spent) coach = `<div class="coach">Come back later to see what grows around it.</div>`;
        else if (tut.contributed === 0) coach = `<div class="coach">Add something. Continue someone else's idea. Change how a mark is seen. <em>Nothing gets erased.</em></div>`;
        else if (tut.contributed === 1) coach = `<div class="coach">Tap a mark to <em>pick up where someone left off</em>.</div>`;
        else if (!tut.sawHistory) coach = `<div class="coach">There's more underneath. Tap <em>History</em> to dig.</div>`;
        else coach = `<div class="coach">Glowing dots are loose ends. Tap one to <em>continue</em> it.</div>`;
        b.innerHTML = (S.inspect ? inspectCardHTML(S.inspect, false) : "") + coach +
          (spent
            ? `<button class="cta spent" data-a="spent"><i></i>Your mark is in</button>`
            : `<button class="cta" data-a="contribute" ${offline ? "disabled style='opacity:.4'" : ""}><i></i>CONTRIBUTE</button>`);
        return;
      }
      if (S.phase === "choose") {
        const tags = { a: tut.contributed === 0 ? "START" : "", c: tut.contributed === 1 ? "TRY" : "", t: "" };
        b.innerHTML = `<div class="sheet">
  <h3><span>ONE MARK · ${CFG.maxMarks} STROKES · ${Math.round(CFG.drawMs / 1000)}s OF INK</span><button class="x" data-a="close" aria-label="Close">×</button></h3>
  <div class="modes">
    <button class="mode" data-a="mode" data-m="a">${tags.a ? `<span class="tag">${tags.a}</span>` : ""}<div class="g">${GLYPH.a}</div><b>ADD</b><span>Something new</span></button>
    <button class="mode" data-a="mode" data-m="c">${tags.c ? `<span class="tag">${tags.c}</span>` : ""}<div class="g">${GLYPH.c}</div><b>CONTINUE</b><span>Pick up someone's mark</span></button>
    <button class="mode" data-a="mode" data-m="t"><div class="g">${GLYPH.t}</div><b>TRANSFORM</b><span>Change how it reads</span></button>
  </div></div>`;
        return;
      }
      if (S.phase === "pick") {
        showModeChip();
        const t = S.target;
        const layers = S.pickStack && S.pickStack.length > 1 ? `<span class="status">layer ${S.pickIndex + 1} of ${S.pickStack.length} · tap again to go deeper</span>` : "";
        b.innerHTML = `<div class="card">
  <div class="title"><span>${S.mode === "c" ? "Tap a mark to continue" : "Tap what you want to change"}</span><button class="x" data-a="cancel" aria-label="Cancel">×</button></div>
  ${t ? `<div class="meta">${describe(t.c)}</div>` : `<div class="meta">${S.mode === "c" ? "Unfinished lines and loose ends glow." : "Your mark will sit on top. The original stays underneath."}</div>`}
  ${layers}
  <div class="acts" style="justify-content:flex-end"><button class="btn primary" data-a="usetarget" ${t ? "" : "disabled"}>${S.mode === "c" ? "Continue this" : "Transform this"}</button></div>
</div>`;
        return;
      }
      if (S.phase === "draw") {
        showModeChip();
        b.innerHTML = trayHTML();
        updateMeter();
        return;
      }
      if (S.phase === "preview" || S.phase === "submitting") {
        showModeChip();
        const busy = S.phase === "submitting";
        b.innerHTML = `<div class="card">
  <div class="title"><span>${busy ? "Placing your mark…" : "This is how it will land."}</span></div>
  <div class="meta">${busy ? "Waiting for the canvas to accept it." : "Once it's in, it stays — no undo, no erasing. Others can build on it."}</div>
  ${S.lastError ? `<div class="err">${esc(S.lastError)}</div>` : ""}
  <div class="acts" style="justify-content:space-between">
    <button class="btn" data-a="back" ${busy ? "disabled" : ""}>Keep drawing</button>
    <button class="btn primary" data-a="submit" ${busy ? "disabled" : ""}>${S.lastError ? "Try again" : "Submit"}</button>
  </div></div>`;
        return;
      }
      if (S.phase === "history") {
        b.innerHTML = historyHTML();
        return;
      }
    }

    function showModeChip() {
      const q = S.phase === "draw" && S.mode === "t" ? `<span class="q">What could this become?</span>` : S.phase === "draw" ? `<span class="q">${esc(prompt)}</span>` : "";
      el.modechip.innerHTML = `<span>${MODE_NAMES[S.mode]}</span>${q}<button class="x" data-a="cancel" aria-label="Cancel draft">×</button>`;
      el.modechip.classList.remove("gone");
    }

    function trayHTML() {
      const brushes = BRUSH_NAMES.map((n, i) => `<button class="chip ${draft.brush === i ? "on" : ""}" data-a="brush" data-v="${i}" aria-label="${n}" style="color:${draft.brush === i ? COLORS[draft.color === INK ? 7 : draft.color] : ""}">${BRUSH_GLYPH[i]}</button>`).join("") +
        `<button class="chip ${draft.stampMode ? "on" : ""}" data-a="stamps" aria-label="Shapes">${STAMP_GLYPH}</button>`;
      const second = draft.stampMode
        ? SHAPES.map((n, i) => `<button class="chip ${draft.shape === i ? "on" : ""}" data-a="shape" data-v="${i}" aria-label="${n}">${SHAPE_GLYPH[i]}</button>`).join("")
        : WIDTHS.map((w, i) => `<button class="chip ${draft.width === i ? "on" : ""}" data-a="width" data-v="${i}" aria-label="Width ${i + 1}"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="${[2, 4, 7][i]}" fill="currentColor"/></svg></button>`).join("");
      const navChip = `<button class="chip ${draft.navLock ? "on" : ""}" data-a="nav" aria-label="Move canvas">${HAND_GLYPH}</button>`;
      const swatches = COLORS.map((c, i) => `<button class="sw ${draft.color === i ? "on" : ""}" data-a="color" data-v="${i}" aria-label="${COLOR_NAMES[i]}" style="background:${c};${i === INK ? "box-shadow:inset 0 0 0 1px rgba(237,239,242,.35)" : ""}"></button>`).join("");
      return `<div class="tray">
  <div class="row"><div class="seg">${brushes}</div><div class="meter" data-r="meter"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" stroke="rgba(237,239,242,.12)" stroke-width="3" fill="none"/><circle data-r="ring" cx="20" cy="20" r="17" stroke="#EDEFF2" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg><span data-r="secs">10</span></div></div>
  <div class="row"><div class="seg">${second}</div>${navChip}</div>
  <div class="swatches">${swatches}</div>
  <div class="row"><span class="status" data-r="markcount"></span><div class="acts"><button class="btn primary" data-a="preview" data-r="previewbtn">Preview</button></div></div>
</div>`;
    }
    function updateMeter() {
      const ring = ui.querySelector('[data-r="ring"]');
      if (!ring) return;
      const left = Math.max(0, CFG.drawMs - draft.usedMs);
      ring.setAttribute("stroke-dashoffset", String(106.8 * (1 - left / CFG.drawMs)));
      ring.setAttribute("stroke", left < 2500 ? "#FF426D" : "#EDEFF2");
      const secs = ui.querySelector('[data-r="secs"]');
      if (secs) secs.textContent = (left / 1000).toFixed(left < 9500 ? 1 : 0);
      const mc = ui.querySelector('[data-r="markcount"]');
      const n = draft.marks.length + (draft.active ? 1 : 0);
      if (mc) mc.textContent = n === 0 ? (draft.stampMode ? "tap to stamp · drag to size & turn" : "drag to draw · two fingers to move") : `${n}/${CFG.maxMarks} marks`;
      const pb = ui.querySelector('[data-r="previewbtn"]');
      if (pb) pb.disabled = draft.marks.length === 0;
    }

    function describe(c) {
      if (c.seed) return `<b>Seed mark</b> · part of the starting composition · under ${coveredBy(c)} later mark${coveredBy(c) === 1 ? "" : "s"}`;
      const parent = c.parent ? model.byId.get(c.parent) : null;
      const rel = c.mode === "a" ? "ADD" : `${MODE_NAMES[c.mode]}${parent ? ` of #${parent.number || "seed"}` : c.parent && c.parent.indexOf("seed-") === 0 ? " of a seed" : ""}`;
      const kids = childrenOf(c).length;
      const time = c.serverTime || c.clientTime;
      return `<b>#${c.number}</b>${mine.has(c.id) ? " · <b>yours</b>" : ""} · ${rel}${time ? " · " + ago(time) : ""}<br>under ${coveredBy(c)} later mark${coveredBy(c) === 1 ? "" : "s"}${kids ? ` · continued ${kids}×` : ""}`;
    }
    function inspectCardHTML(ref, inHistory) {
      const spent = S.submittedThisVisit >= CFG.perVisit || S.connection === "offline";
      const layers = ref.stack && ref.stack.length > 1 ? `<div class="status">layer ${ref.idx + 1} of ${ref.stack.length} here · tap again to go deeper</div>` : "";
      return `<div class="card">
  <div class="title"><span>${ref.c.seed ? "Seed mark" : "Mark #" + ref.c.number}</span><button class="x" data-a="closeinspect" aria-label="Close">×</button></div>
  <div class="meta">${describe(ref.c)}</div>${layers}
  ${!inHistory && !spent ? `<div class="acts"><button class="btn" data-a="quick" data-m="c">Continue this</button><button class="btn" data-a="quick" data-m="t">Transform this</button></div>` : ""}
</div>`;
    }

    function dayGroups() {
      const out = [];
      let lastDay = null;
      model.ordered.forEach((c, i) => {
        const t = c.serverTime || c.clientTime;
        if (!t) return;
        const d = Math.floor(t / 86400000);
        if (d !== lastDay) { out.push({ day: d, end: i + 1 }); lastDay = d; }
        else out[out.length - 1].end = i + 1;
      });
      return out.slice(-6);
    }
    function historyHTML() {
      const N = model.ordered.length;
      const h = S.history;
      const myCount = model.ordered.filter((c) => mine.has(c.id)).length;
      const atC = h.limit > 0 ? model.ordered[h.limit - 1] : null;
      const label = h.limit === 0 ? "Before anyone arrived: the seed marks" : `After mark #${h.limit} of ${N}${atC && (atC.serverTime || atC.clientTime) ? " · " + ago(atC.serverTime || atC.clientTime) : ""}`;
      const days = dayGroups().map((d) => {
        const diff = today - d.day;
        const name = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff + "d ago";
        return `<button class="chip ${h.limit === d.end ? "on" : ""}" data-a="day" data-v="${d.end}">${name}</button>`;
      }).join("");
      return (h.inspect ? inspectCardHTML(h.inspect, true) : "") + `<div class="card">
  <div class="title"><span>History</span><button class="x" data-a="closehistory" aria-label="Close history">×</button></div>
  <div class="meta" data-r="hlabel">${esc(label)}</div>
  <input type="range" min="0" max="${N}" step="1" value="${h.limit}" data-r="scrub" aria-label="Scrub through history">
  <div class="row"><div class="daychips">${days}</div></div>
  <div class="row">
    <button class="btn" data-a="play">${h.playing ? "Pause" : "▶ Replay"}</button>
    ${myCount ? `<button class="btn" data-a="mine">Yours · ${myCount}</button>` : `<span class="status">tap any spot to see what's underneath</span>`}
  </div>
</div>`;
    }

    // ---- UI events (delegated) ----
    ctx.listen(ui, "click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-a]") : null;
      if (!t || t.disabled) return;
      firstGesture();
      const a = t.getAttribute("data-a");
      const v = Number(t.getAttribute("data-v"));
      switch (a) {
        case "contribute": openChooser(); break;
        case "spent": toast(`ONE MARK PER VISIT<small>Come back to see what grows around yours.</small>`, 2200); break;
        case "retry": loadCanvas(true); break;
        case "close": setPhase("explore"); break;
        case "mode": startMode(t.getAttribute("data-m")); break;
        case "quick": if (S.inspect) { const ref = S.inspect; S.inspect = null; startMode(t.getAttribute("data-m"), ref); } break;
        case "closeinspect": S.inspect = null; S.history.inspect = null; dirty = true; renderBottom(); break;
        case "usetarget": if (S.target) beginDrawing(); break;
        case "cancel": cancelDraft(); break;
        case "brush": draft.brush = v; renderBottom(); break;
        case "stamps": draft.stampMode = !draft.stampMode; renderBottom(); break;
        case "shape": draft.shape = v; renderBottom(); break;
        case "width": draft.width = v; renderBottom(); break;
        case "color": draft.color = v; renderBottom(); break;
        case "nav": draft.navLock = !draft.navLock; renderBottom(); break;
        case "preview": goPreview(); break;
        case "back": S.lastError = null; setPhase("draw"); break;
        case "submit": submitDraft(); break;
        case "closehistory": closeHistory(); break;
        case "play": toggleReplay(); break;
        case "mine": cycleMine(); break;
        case "day": setHistoryLimit(v); renderBottom(); break;
      }
    });
    ctx.listen(ui, "input", (e) => {
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-r") === "scrub") {
        S.history.playing = false;
        setHistoryLimit(Number(e.target.value));
        const lab = ui.querySelector('[data-r="hlabel"]');
        if (lab) {
          const N = model.ordered.length, h = S.history, atC = h.limit > 0 ? model.ordered[h.limit - 1] : null;
          lab.textContent = h.limit === 0 ? "Before anyone arrived: the seed marks" : `After mark #${h.limit} of ${N}${atC && (atC.serverTime || atC.clientTime) ? " · " + ago(atC.serverTime || atC.clientTime) : ""}`;
        }
      }
    });
    ctx.listen(el.history, "click", () => { firstGesture(); S.phase === "history" ? closeHistory() : openHistory(); });
    ctx.listen(el.fit, "click", () => { firstGesture(); animateTo(null); });
    ctx.listen(el.prompt, "click", () => hidePrompt());

    // =====================================================================
    // 13. Feedback: haptics + sparse sound (no ambient bed)
    // =====================================================================
    let started = false, audioOk = false;
    function firstGesture() {
      if (started) return;
      started = true;
      try { ctx.platform.start({ visits }); } catch (e) { /* host may be absent in preview */ }
      try { if (ctx.music && ctx.music.unlock) ctx.music.unlock().then(() => { audioOk = true; }).catch(() => {}); } catch (e) { /* audio is optional */ }
    }
    function haptic(kind) { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) { /* optional */ } }
    function sting(name) { try { if (audioOk && ctx.music && ctx.music.sting) ctx.music.sting(name).catch(() => {}); } catch (e) { /* optional */ } }

    // =====================================================================
    // 14. Phase transitions
    // =====================================================================
    function setPhase(p) {
      S.phase = p;
      if (p !== "explore") S.inspect = null;
      dirty = true;
      renderBottom();
    }
    function openChooser() {
      if (S.submittedThisVisit >= CFG.perVisit) return;
      hidePrompt();
      setPhase("choose");
    }
    function startMode(mode, ref) {
      S.mode = mode;
      draft.id = uid();
      draft.marks = [];
      draft.active = null;
      draft.usedMs = 0;
      draft.navLock = false;
      S.lastError = null;
      S.pickStack = null;
      S.pickIndex = 0;
      if (mode === "a") { S.target = null; beginDrawing(); return; }
      S.target = ref ? { c: ref.c, m: ref.m } : null;
      if (ref) { beginDrawing(); return; }
      setPhase("pick");
      ctx.platform.interact({ type: "mode", mode: MODE_NAMES[mode] });
    }
    function beginDrawing() {
      if (S.target && S.mode === "c") {
        // CONTINUE inherits the mark's colour and brush so the gesture reads as one line.
        const m = S.target.m;
        draft.color = m.color;
        draft.brush = m.brush;
        draft.stampMode = false;
        if (m.kind === "stroke") draft.width = m.width;
      } else if (S.target && S.mode === "t") {
        // TRANSFORM starts with a contrasting colour: a cyan ring over orange, ink over light.
        const m = S.target.m;
        const contrast = { 0: 3, 1: 3, 2: 5, 3: 1, 4: 0, 5: 2, 6: 0, 7: INK, 8: 7 };
        draft.color = contrast[m.color];
      }
      setPhase("draw");
      if (S.target) focusOn(S.target.m.bbox);
    }
    function cancelDraft() {
      draft.marks = [];
      draft.active = null;
      S.target = null;
      S.mode = null;
      S.lastError = null;
      setPhase("explore");
    }
    function goPreview() {
      if (!draft.marks.length) return;
      const problem = draftProblem();
      if (problem) { toast(`<small style="font-size:14px;color:#EDEFF2">${esc(problem)}</small>`, 2200); haptic("warning"); return; }
      S.lastError = null;
      toastTok++;
      el.toast.classList.add("hide");
      setPhase("preview");
    }
    function draftProblem() {
      if (!S.target) return null;
      const box = S.target.m.bbox;
      const touches = draft.marks.some((m) => bboxHit(m.bbox, box, S.mode === "c" ? 18 : 0));
      if (!touches) return S.mode === "c" ? "Connect to the highlighted mark." : "Place at least one mark over the highlighted area.";
      return null;
    }

    // ---- camera animation ----
    let camAnim = null;
    function animateTo(box) {
      computeFit();
      let tx, ty, ts;
      if (!box) {
        const b = sectionBounds();
        ts = fitScale; tx = (b.x0 + b.x1) / 2; ty = (b.y0 + b.y1) / 2 + ((120 + SAFE.bottom) - (64 + SAFE.top)) / 2 / ts;
      } else {
        const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
        ts = clampN(Math.min(W / (bw * 2.4), (H * 0.45) / (bh * 2.4)), fitScale, Math.max(fitScale, 2.2));
        tx = (box.x0 + box.x1) / 2;
        ty = (box.y0 + box.y1) / 2 + (H * 0.12) / ts;
      }
      camAnim = { from: { x: cam.x, y: cam.y, s: cam.s }, to: { x: tx, y: ty, s: ts }, t: 0, dur: 420 };
    }
    function focusOn(box) { if (cam.s < fitScale * 1.6) animateTo(box); }

    // =====================================================================
    // 15. Input: one finger draws (in draw phase) or pans; two fingers always
    //     navigate. A second finger cancels an in-progress stroke so a pinch
    //     never leaves a stray mark.
    // =====================================================================
    const pointers = new Map();
    let gesture = null; // { type: "pan"|"pinch"|"draw"|"stamp"|"tap", ... }

    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / Math.max(1, r.width)), y: (e.clientY - r.top) * (H / Math.max(1, r.height)) };
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      firstGesture();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const p = localXY(e);
      pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
      camAnim = null;
      if (pointers.size >= 2) {
        if (gesture && gesture.type === "draw") abortActiveStroke();
        if (gesture && gesture.type === "stamp") draft.active = null;
        startPinch();
        return;
      }
      const wantsDraw = S.phase === "draw" && !draft.navLock && e.button !== 1 && e.button !== 2;
      if (wantsDraw) {
        if (draft.stampMode) startStamp(p);
        else startStroke(p);
      } else {
        gesture = { type: "tap", x: p.x, y: p.y, t: performance.now(), cx: cam.x, cy: cam.y };
      }
    }, { passive: false });
    ctx.listen(canvas, "pointermove", (e) => {
      const ptr = pointers.get(e.pointerId);
      if (!ptr) return;
      const p = localXY(e);
      ptr.x = p.x; ptr.y = p.y;
      if (!gesture) return;
      if (gesture.type === "pinch") { updatePinch(); return; }
      if (gesture.type === "draw") { extendStroke(p); return; }
      if (gesture.type === "stamp") { sizeStamp(p); return; }
      if (gesture.type === "tap" || gesture.type === "pan") {
        const dx = p.x - gesture.x, dy = p.y - gesture.y;
        if (gesture.type === "tap" && Math.hypot(dx, dy) > 8) gesture.type = "pan";
        if (gesture.type === "pan") {
          cam.x = gesture.cx - dx / cam.s;
          cam.y = gesture.cy - dy / cam.s;
          clampCam();
          invalidateArt(140);
        }
      }
    }, { passive: false });
    function endPointer(e, cancelled) {
      const ptr = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!ptr || !gesture) return;
      if (gesture.type === "pinch") {
        if (pointers.size < 2) {
          gesture = null;
          // a remaining finger only pans; it never starts a stroke mid-gesture
          if (pointers.size === 1) { const [rest] = pointers.values(); gesture = { type: "pan", x: rest.x, y: rest.y, cx: cam.x, cy: cam.y }; }
        }
        return;
      }
      if (gesture.type === "draw") { cancelled ? abortActiveStroke() : finishStroke(); gesture = null; return; }
      if (gesture.type === "stamp") { cancelled ? (draft.active = null) : finishStamp(); gesture = null; return; }
      if (gesture.type === "tap" && !cancelled) handleTap(gesture.x, gesture.y);
      gesture = null;
    }
    ctx.listen(canvas, "pointerup", (e) => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", (e) => endPointer(e, true));
    ctx.listen(canvas, "contextmenu", (e) => e.preventDefault());
    ctx.listen(canvas, "wheel", (e) => {
      e.preventDefault();
      const p = localXY(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    function startPinch() {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { x: cam.x, y: cam.y, s: cam.s } };
    }
    function updatePinch() {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const g0 = gesture.cam;
      const wx = (gesture.mx - W / 2) / g0.s + g0.x, wy = (gesture.my - H / 2) / g0.s + g0.y;
      cam.s = clampN(g0.s * (d / gesture.d0), fitScale * 0.7, 7);
      cam.x = wx - (mx - W / 2) / cam.s;
      cam.y = wy - (my - H / 2) / cam.s;
      clampCam();
      invalidateArt(140);
    }
    function zoomAt(sx, sy, k) {
      const w = toWorld(sx, sy);
      cam.s = clampN(cam.s * k, fitScale * 0.7, 7);
      cam.x = w.x - (sx - W / 2) / cam.s;
      cam.y = w.y - (sy - H / 2) / cam.s;
      clampCam();
      invalidateArt(160);
    }

    // ---- taps: select / inspect / dig through layers ----
    function handleTap(sx, sy) {
      const w = toWorld(sx, sy);
      const tol = 10 / cam.s;
      if (S.phase === "pick") {
        const sameSpot = S.pickTap && Math.hypot(S.pickTap.x - sx, S.pickTap.y - sy) < 14;
        if (sameSpot && S.pickStack && S.pickStack.length > 1) {
          S.pickIndex = (S.pickIndex + 1) % S.pickStack.length;
        } else {
          S.pickStack = marksAt(w.x, w.y, tol);
          S.pickIndex = 0;
        }
        S.pickTap = { x: sx, y: sy };
        S.target = S.pickStack.length ? S.pickStack[S.pickIndex] : null;
        if (S.target) haptic("light");
        dirty = true;
        renderBottom();
        return;
      }
      if (S.phase === "explore" || S.phase === "history") {
        const inHistory = S.phase === "history";
        const maxZ = inHistory ? SEEDS.length + S.history.limit - 1 : undefined;
        const prev = inHistory ? S.history.inspect : S.inspect;
        const sameSpot = prev && prev.tap && Math.hypot(prev.tap.x - sx, prev.tap.y - sy) < 14;
        let ref = null;
        if (sameSpot && prev.stack.length > 1) {
          const idx = (prev.idx + 1) % prev.stack.length;
          ref = { ...prev.stack[idx], stack: prev.stack, idx, tap: prev.tap };
        } else {
          const stack = marksAt(w.x, w.y, tol, maxZ);
          if (stack.length) ref = { ...stack[0], stack, idx: 0, tap: { x: sx, y: sy } };
        }
        if (inHistory) S.history.inspect = ref; else S.inspect = ref;
        if (ref) { haptic("light"); ctx.platform.interact({ type: "inspect", layer: ref.idx }); }
        dirty = true;
        renderBottom();
      }
    }

    // ---- drawing ----
    function clampToSection(w) {
      const b = sectionBounds();
      return { x: clampN(w.x, b.x0, b.x1), y: clampN(w.y, b.y0, b.y1) };
    }
    function canStartMark() {
      if (draft.marks.length >= CFG.maxMarks) { toast(`<small style="font-size:14px;color:#EDEFF2">That's all ${CFG.maxMarks} marks. Preview it.</small>`, 1600); haptic("warning"); return false; }
      if (draft.usedMs >= CFG.drawMs) { toast(`<small style="font-size:14px;color:#EDEFF2">Out of ink. Preview it.</small>`, 1600); haptic("warning"); return false; }
      return true;
    }
    function startStroke(p) {
      if (!canStartMark()) { gesture = null; return; }
      const w = clampToSection(toWorld(p.x, p.y));
      const pts = [];
      // CONTINUE: the first stroke always grows out of the chosen mark — no precision needed.
      if (S.mode === "c" && S.target && !draft.marks.some((m) => bboxHit(m.bbox, S.target.m.bbox, 18))) {
        const anchor = nearestOnMark(S.target.m, w.x, w.y);
        if (anchor && Math.hypot(anchor.x - w.x, anchor.y - w.y) * cam.s < 160) pts.push(anchor);
      }
      pts.push(w);
      draft.active = { kind: "stroke", brush: draft.brush, color: draft.color, width: draft.width, pts };
      gesture = { type: "draw", last: p };
      hidePrompt();
      dirty = true;
      updateMeter();
    }
    function extendStroke(p) {
      if (!draft.active) return;
      const last = gesture.last;
      if (Math.hypot(p.x - last.x, p.y - last.y) < 2.5) return;
      gesture.last = p;
      draft.active.pts.push(clampToSection(toWorld(p.x, p.y)));
      if (draft.active.pts.length > 900) finishStroke();
      dirty = true;
    }
    function abortActiveStroke() {
      // A second finger arrived: treat the stroke as an accidental touch only if it was tiny.
      const a = draft.active;
      draft.active = null;
      if (a && a.pts.length > 12) commitMark(a);
      dirty = true;
      updateMeter();
    }
    function finishStroke() {
      const a = draft.active;
      draft.active = null;
      if (gesture && gesture.type === "draw") gesture = null;
      if (!a) return;
      a.pts = simplify(a.pts, 0.9 / cam.s);
      commitMark(a);
    }
    function commitMark(raw) {
      const m = prepareMark(raw, draft.id || "draft", draft.marks.length);
      draft.marks.push(m);
      fitBudget();
      ctx.platform.interact({ type: "mark", kind: raw.kind });
      dirty = true;
      updateMeter();
    }
    // Re-simplify progressively until the contribution fits one world mutation.
    function draftBytes() { return JSON.stringify({ id: draft.id, object: wireFromDraft() }).length; }
    function fitBudget() {
      let tol = 1.2;
      let guard = 0;
      while (draftBytes() > CFG.mutationBudget && guard++ < 10) {
        tol *= 1.6;
        draft.marks = draft.marks.map((m, i) => m.kind === "stroke" ? prepareMark({ ...m, pts: simplify(m.pts, tol) }, draft.id, i) : m);
      }
      while (draftBytes() > CFG.mutationBudget) {
        const last = draft.marks[draft.marks.length - 1];
        if (last.kind === "stroke" && last.pts.length > 2) {
          draft.marks[draft.marks.length - 1] = prepareMark({ ...last, pts: last.pts.slice(0, Math.floor(last.pts.length * 0.8)) }, draft.id, draft.marks.length - 1);
        } else {
          draft.marks.pop();
        }
        if (!draft.marks.length) break;
      }
    }
    function startStamp(p) {
      if (!canStartMark()) { gesture = null; return; }
      const w = clampToSection(toWorld(p.x, p.y));
      draft.active = { kind: "stamp", brush: draft.brush, color: draft.color, shape: draft.shape, x: w.x, y: w.y, r: STAMP_SIZES[1], a: Math.floor(Math.random() * 360) };
      draft.active.path = stampPath(draft.active, draft.id, draft.marks.length);
      gesture = { type: "stamp", sx: p.x, sy: p.y, sized: false };
      hidePrompt();
      dirty = true;
    }
    function sizeStamp(p) {
      const a = draft.active;
      if (!a) return;
      const d = Math.hypot(p.x - gesture.sx, p.y - gesture.sy);
      if (d < 10 && !gesture.sized) return;
      gesture.sized = true;
      a.r = clampN(d / cam.s, 8, 300);
      a.a = ((Math.atan2(p.y - gesture.sy, p.x - gesture.sx) * 180) / Math.PI + 450) % 360;
      a.path = stampPath(a, draft.id, draft.marks.length);
      dirty = true;
    }
    function finishStamp() {
      const a = draft.active;
      draft.active = null;
      if (!a) return;
      a.x = Math.round(a.x); a.y = Math.round(a.y); a.r = Math.round(a.r); a.a = Math.round(a.a) % 360;
      draft.usedMs = Math.min(CFG.drawMs, draft.usedMs + CFG.stampCostMs);
      commitMark(a);
      haptic("light");
      sting("tap");
    }

    // =====================================================================
    // 16. Submission: draft -> validate -> world mutation -> canonical list
    // =====================================================================
    function wireFromDraft() {
      const w = { v: SCHEMA_VERSION, m: S.mode || "a", t: Math.floor(Date.now() / 1000), k: encodeDraftMarks(draft.marks) };
      if (S.target && S.mode !== "a") w.p = S.target.c.id;
      return w;
    }
    let submitWire = null;
    async function submitDraft() {
      if (S.phase === "submitting") return; // double-tap guard
      if (S.submittedThisVisit >= CFG.perVisit) return;
      const id = draft.id;
      // Reuse the exact same object on retry so a lost response can't create a second contribution.
      if (!submitWire || submitWire.id !== id) submitWire = { id, object: wireFromDraft() };
      const check = decodeContribution(id, submitWire.object, null);
      if (!check || JSON.stringify(submitWire).length > 1024) { S.lastError = "That mark couldn't be packed. Try fewer strokes."; renderBottom(); return; }
      S.phase = "submitting";
      S.lastError = null;
      renderBottom();
      let result;
      try {
        result = await repo.append(id, submitWire.object);
      } catch (err) {
        if (destroyed) return;
        S.phase = "preview";
        S.lastError = errorCopy(err);
        haptic("error");
        try { ctx.platform.error({ stage: "submit", code: err && err.code, message: String(err && err.message || err) }); } catch (e) { /* ignore */ }
        renderBottom();
        return;
      }
      if (destroyed) return;
      if (result && (result.ok === false || result.accepted === false || result.rejected)) {
        S.phase = "preview";
        S.lastError = errorCopy(result);
        haptic("error");
        renderBottom();
        return;
      }
      accepted(id, submitWire.object, result);
    }
    function errorCopy(err) {
      const code = String((err && (err.code || err.reason || err.status)) || "").toLowerCase();
      const msg = String((err && err.message) || "").toLowerCase();
      if (code.includes("rate") || code === "429" || msg.includes("rate")) return "You've left today's marks. The canvas will be here tomorrow.";
      if (code.includes("size") || code.includes("payload") || msg.includes("too large")) return "That mark is too big to store. Try fewer strokes.";
      if (code.includes("full") || msg.includes("snapshot")) return "The canvas is full for now. It needs a new section before it can take more.";
      return "It didn't land. Nothing was saved — try again.";
    }
    function accepted(id, object, result) {
      const meta = { seq: null, time: Date.now(), index: model.ordered.length };
      if (result && typeof result === "object") {
        const seq = [result.seq, result.sequence, result.revision, result.version].find((v) => Number.isFinite(v));
        if (Number.isFinite(seq)) meta.seq = seq;
      }
      const before = model.ordered.length;
      const levelBefore = unlockedLevel(before);
      mergeEntries([{ id, object, meta }]);
      const c = model.byId.get(id);
      mine.add(id);
      sset("uc_mine", [...mine].slice(-60));
      tut.contributed += 1;
      sset("uc_contrib_count", tut.contributed);
      S.submittedThisVisit += 1;
      submitWire = null;
      draft.marks = [];
      draft.active = null;
      S.target = null;
      const mode = S.mode;
      S.mode = null;
      invalidateArt();
      setPhase("explore");
      updateCount();
      // a mark landing on a shared surface: a ripple where it landed, a soft tone
      if (c) {
        const ctr = toScreen((c.bbox.x0 + c.bbox.x1) / 2, (c.bbox.y0 + c.bbox.y1) / 2);
        try { ctx.fx.ripple({ x: ctr.x, y: ctr.y, color: COLORS[c.marks[0].color === INK ? 7 : c.marks[0].color], radius: 90, durationMs: 700 }); } catch (e) { /* fx optional */ }
      }
      haptic("success");
      sting("success");
      const levelAfter = unlockedLevel(model.ordered.length);
      toast(`YOUR MARK IS IN.<small>#${c ? c.number : model.ordered.length} · it stays, whatever lands on top</small>`, 2000);
      ctx.platform.interact({ type: "contribution", mode: MODE_NAMES[mode] });
      try { ctx.platform.milestone("contribution", { mode: MODE_NAMES[mode], total: model.ordered.length }); } catch (e) { /* ignore */ }
      if (levelAfter > levelBefore) {
        ctx.timeout(() => {
          toast(`THE CANVAS GREW<small>${CFG.milestones[levelAfter - 1]} marks — a new edge is open</small>`, 2600);
          sting("powerup");
          ctx.platform.milestone("canvas_grew", { level: levelAfter });
          animateTo(null);
        }, 2100);
      }
      // pick up anything others placed meanwhile, and the authoritative order
      ctx.timeout(() => refresh(), 600);
    }

    // =====================================================================
    // 17. History: reversible, never touches the canonical list
    // =====================================================================
    let savedView = null;
    function openHistory() {
      if (!["explore"].includes(S.phase)) return;
      hidePrompt();
      tut.sawHistory = true;
      sset("uc_saw_history", true);
      S.history.limit = model.ordered.length;
      S.history.inspect = null;
      S.history.playing = false;
      savedView = { x: cam.x, y: cam.y, s: cam.s };
      setPhase("history");
      ctx.platform.interact({ type: "history_open" });
    }
    function closeHistory() {
      S.history.playing = false;
      S.history.inspect = null;
      setHistoryLimit(model.ordered.length);
      artLimit = Infinity;
      setPhase("explore");
      invalidateArt();
    }
    function setHistoryLimit(n) {
      S.history.limit = Math.round(clampN(n, 0, model.ordered.length));
      artLimit = SEEDS.length + S.history.limit - 1;
      if (S.history.inspect && S.history.inspect.c.z > artLimit) S.history.inspect = null;
      invalidateArt();
    }
    let replay = null;
    function toggleReplay() {
      const h = S.history;
      h.playing = !h.playing;
      if (h.playing) {
        if (h.limit >= model.ordered.length) setHistoryLimit(0);
        replay = { acc: 0, per: clampN(6000 / Math.max(1, model.ordered.length), 30, 450) };
        h.inspect = null;
      }
      renderBottom();
    }
    function cycleMine() {
      const list = model.ordered.filter((c) => mine.has(c.id));
      if (!list.length) return;
      const cur = S.history.inspect ? list.findIndex((c) => c.id === S.history.inspect.c.id) : -1;
      const c = list[(cur + 1) % list.length];
      setHistoryLimit(model.ordered.length);
      S.history.inspect = { c, m: c.marks[0], stack: [{ c, m: c.marks[0] }], idx: 0, tap: null };
      animateTo(c.bbox);
      renderBottom();
    }

    // =====================================================================
    // 18. Main render
    // =====================================================================
    function drawFrame(timeMs) {
      const s = backingScale();
      if (artDirty && !camAnim && !(gesture && (gesture.type === "pan" || gesture.type === "pinch"))) renderArt();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      if (artView && artView.x === cam.x && artView.y === cam.y && artView.s === cam.s && artView.W === W && artView.H === H) {
        g.drawImage(art, 0, 0);
      } else {
        // While moving, reuse the last render under a transform; re-render when the view settles.
        g.fillStyle = OUTSIDE;
        g.fillRect(0, 0, canvas.width, canvas.height);
        if (artView) {
          const k = cam.s / artView.s;
          const ox = W / 2 + (artView.x - cam.x) * cam.s - (artView.W / 2) * k;
          const oy = H / 2 + (artView.y - cam.y) * cam.s - (artView.H / 2) * k;
          g.setTransform(s * k, 0, 0, s * k, s * ox, s * oy);
          g.drawImage(art, 0, 0, art.width / s, art.height / s);
        }
      }

      // --- overlays in world space ---
      applyWorld(g, s);
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 380);

      if (S.phase === "explore" && !S.inspect) drawLooseEnds(pulse);

      const focus = S.phase === "history" ? S.history.inspect : S.phase === "explore" ? S.inspect : null;
      if (focus) {
        // isolate: dim everything, re-draw the chosen contribution on top (view-only)
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = "rgba(3,4,5,0.72)";
        g.fillRect(0, 0, canvas.width, canvas.height);
        applyWorld(g, s);
        const parent = focus.c.parent ? model.byId.get(focus.c.parent) || SEEDS.find((x) => x.id === focus.c.parent) : null;
        if (parent) drawContribution(g, parent, 0.35);
        drawContribution(g, focus.c, 1);
        outlineMark(g, focus.m, pulse);
      }

      if ((S.phase === "pick" || S.phase === "draw" || S.phase === "preview" || S.phase === "submitting") && S.target) {
        if (S.mode === "t" && S.phase !== "preview" && S.phase !== "submitting") spotlight(S.target.m.bbox);
        if (S.phase === "pick" || S.phase === "draw") {
          outlineMark(g, S.target.m, pulse);
          if (S.mode === "c") drawHandles(S.target.m, pulse);
        }
      }

      // --- draft above the committed artwork ---
      if (draft.marks.length || draft.active) {
        for (const m of draft.marks) drawMark(g, m, 1);
        if (draft.active) {
          const a = draft.active;
          if (a.kind === "stroke") { a.path = strokePath(a.pts); drawMark(g, a, 1); }
          else drawMark(g, a, 1);
        }
        if (S.phase === "draw" && draft.marks.length) {
          // a faint dashed outline marks this as an unsubmitted draft
          let bb = null;
          for (const m of draft.marks) bb = bboxUnion(bb, m.bbox);
          g.setLineDash([6 / cam.s, 6 / cam.s]);
          g.strokeStyle = "rgba(237,239,242,0.22)";
          g.lineWidth = 1 / cam.s;
          g.strokeRect(bb.x0 - 8 / cam.s, bb.y0 - 8 / cam.s, bb.x1 - bb.x0 + 16 / cam.s, bb.y1 - bb.y0 + 16 / cam.s);
          g.setLineDash([]);
        }
      }

      // --- surface: grain + vignette (screen space, cheap) ---
      g.setTransform(s, 0, 0, s, 0, 0);
      if (CFG.grain > 0) {
        if (!grainPattern) buildGrain();
        g.globalAlpha = CFG.grain;
        g.globalCompositeOperation = "overlay";
        g.fillStyle = grainPattern;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
      if (!vignette || vignette.W !== W || vignette.H !== H) {
        const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.55)");
        vignette = { W, H, vg };
      }
      g.fillStyle = vignette.vg;
      g.fillRect(0, 0, W, H);
    }

    function outlineMark(gg, m, pulse) {
      gg.save();
      gg.setLineDash([10 / cam.s, 8 / cam.s]);
      gg.lineDashOffset = -pulse * 18 / cam.s;
      gg.strokeStyle = `rgba(237,239,242,${0.45 + pulse * 0.35})`;
      gg.lineWidth = 1.5 / cam.s;
      if (m.kind === "stroke") {
        gg.lineCap = "round";
        gg.lineWidth = WIDTHS[m.width] + 10 / cam.s;
        gg.globalAlpha = 0.18;
        gg.setLineDash([]);
        gg.stroke(m.path);
        gg.globalAlpha = 1;
      } else {
        gg.beginPath();
        gg.arc(m.x, m.y, m.r * 1.18 + 6 / cam.s, 0, Math.PI * 2);
        gg.stroke();
      }
      gg.restore();
    }
    function drawHandles(m, pulse) {
      if (m.kind !== "stroke") return;
      const ends = [m.pts[0], m.pts[m.pts.length - 1]];
      for (const p of ends) {
        g.beginPath();
        g.arc(p.x, p.y, (7 + pulse * 4) / cam.s, 0, Math.PI * 2);
        g.strokeStyle = COLORS[m.color === INK ? 7 : m.color];
        g.lineWidth = 2 / cam.s;
        g.stroke();
        g.beginPath();
        g.arc(p.x, p.y, 3 / cam.s, 0, Math.PI * 2);
        g.fillStyle = "#EDEFF2";
        g.fill();
      }
    }
    function spotlight(box) {
      const s = backingScale();
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const r = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.75 + 30 / cam.s;
      const c = toScreen(cx, cy);
      g.setTransform(s, 0, 0, s, 0, 0);
      const grad = g.createRadialGradient(c.x, c.y, r * cam.s * 0.85, c.x, c.y, r * cam.s * 1.6);
      grad.addColorStop(0, "rgba(3,4,5,0)");
      grad.addColorStop(1, "rgba(3,4,5,0.6)");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      applyWorld(g, s);
    }
    // Loose ends: endpoints of recent strokes nobody has continued yet.
    function looseEnds() {
      const out = [];
      for (let i = model.all.length - 1; i >= 0 && out.length < 6; i--) {
        const c = model.all[i];
        if (childrenOf(c).length) continue;
        const m = c.marks[c.marks.length - 1];
        if (m.kind !== "stroke" || m.pts.length < 3) continue;
        out.push({ c, m, p: m.pts[m.pts.length - 1] });
      }
      return out;
    }
    let looseCache = null;
    function drawLooseEnds(pulse) {
      if (!looseCache) looseCache = looseEnds();
      for (const e of looseCache) {
        g.beginPath();
        g.arc(e.p.x, e.p.y, (4 + pulse * 5) / cam.s, 0, Math.PI * 2);
        g.strokeStyle = COLORS[e.m.color === INK ? 7 : e.m.color];
        g.globalAlpha = 0.35 + pulse * 0.4;
        g.lineWidth = 1.5 / cam.s;
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // =====================================================================
    // 19. Loop: animate only what moves; idle frames cost almost nothing
    // =====================================================================
    let lastMeter = 0;
    ctx.game.loop({
      update(dtMs, st) {
        if (camAnim) {
          camAnim.t += dtMs;
          const k = Math.min(1, camAnim.t / camAnim.dur);
          const e = 1 - Math.pow(1 - k, 3);
          cam.x = camAnim.from.x + (camAnim.to.x - camAnim.from.x) * e;
          cam.y = camAnim.from.y + (camAnim.to.y - camAnim.from.y) * e;
          cam.s = camAnim.from.s + (camAnim.to.s - camAnim.from.s) * e;
          if (k >= 1) { camAnim = null; clampCam(); artDirty = true; }
          dirty = true;
        }
        if (S.phase === "draw" && draft.active && draft.active.kind === "stroke") {
          draft.usedMs += dtMs;
          if (draft.usedMs >= CFG.drawMs) { draft.usedMs = CFG.drawMs; finishStroke(); haptic("warning"); }
          if (st.timeMs - lastMeter > 90) { lastMeter = st.timeMs; updateMeter(); }
        }
        if (S.phase === "history" && S.history.playing && replay) {
          replay.acc += dtMs;
          while (replay.acc >= replay.per) {
            replay.acc -= replay.per;
            if (S.history.limit >= model.ordered.length) { S.history.playing = false; renderBottom(); break; }
            setHistoryLimit(S.history.limit + 1);
          }
          const sl = ui.querySelector('[data-r="scrub"]');
          if (sl) sl.value = String(S.history.limit);
        }
      },
      render(alpha, st) {
        const animated = (S.phase === "explore" && !S.inspect && looseCache && looseCache.length) || S.target || S.inspect || S.history.inspect;
        if (!dirty && !animated) return;
        dirty = false;
        drawFrame(st.timeMs);
      }
    });

    // =====================================================================
    // 20. Resize, lifecycle, sync
    // =====================================================================
    let firstLayout = true;
    ctx.onResize((info) => {
      const oldW = W, oldH = H;
      W = info.width; H = info.height; SAFE = info.safeArea || SAFE;
      layoutUI();
      computeFit();
      if (firstLayout) { firstLayout = false; fitView(); }
      else if (oldW !== W || oldH !== H) { clampCam(); }
      vignette = null;
      invalidateArt();
    }, { immediate: true });

    let refreshing = false;
    async function refresh() {
      if (refreshing || destroyed || S.connection === "local") return;
      refreshing = true;
      try {
        const entries = await repo.load();
        if (destroyed) return;
        const levelBefore = unlockedLevel(model.ordered.length);
        const fresh = mergeEntries(entries);
        if (S.connection !== "shared") { S.connection = "shared"; renderBottom(); }
        if (fresh.length) {
          looseCache = null;
          if (S.phase === "history") {
            if (S.history.limit === model.ordered.length - fresh.length) setHistoryLimit(model.ordered.length);
            renderBottom();
          } else invalidateArt();
          // other people's marks arriving: a quiet ripple where each one landed
          for (const c of fresh.slice(-4)) {
            if (mine.has(c.id)) continue;
            const ctr = toScreen((c.bbox.x0 + c.bbox.x1) / 2, (c.bbox.y0 + c.bbox.y1) / 2);
            try { ctx.fx.ripple({ x: ctr.x, y: ctr.y, color: "rgba(237,239,242,0.5)", radius: 50, durationMs: 900 }); } catch (e) { /* optional */ }
          }
          if (unlockedLevel(model.ordered.length) > levelBefore && S.phase === "explore") animateTo(null);
        }
        updateCount();
      } catch (err) {
        if (!destroyed && S.connection === "connecting") { S.connection = "offline"; updateCount(); renderBottom(); }
      } finally {
        refreshing = false;
      }
    }

    async function loadCanvas(isRetry) {
      if (repo.kind === "local") {
        S.connection = "local";
        mergeEntries(await repo.load());
      } else {
        S.connection = "connecting";
        updateCount();
        try {
          const entries = await repo.load();
          if (destroyed) return;
          mergeEntries(entries);
          S.connection = "shared";
        } catch (err) {
          if (destroyed) return;
          // The shared world is unreachable: fall back, clearly labelled, to marks
          // that stay on this device for this visit. Next visit tries shared again.
          try { ctx.platform.error({ stage: "load", code: err && err.code, message: String(err && err.message || err) }); } catch (e) { /* ignore */ }
          repo = createLocalRepo();
          S.connection = "local";
          mergeEntries(await repo.load());
          toast(`<small style="font-size:14px;color:#EDEFF2">Shared canvas unavailable — your marks stay on this device.</small>`, 2600);
        }
      }
      looseCache = null;
      if (S.phase === "loading") S.phase = "explore";
      updateCount();
      fitView();
      renderBottom();
      if (isRetry && S.connection === "shared") toast(`<small style="font-size:14px;color:#EDEFF2">Connected.</small>`, 1200);
    }

    ctx.interval(() => { if (S.phase !== "submitting") refresh(); }, CFG.refreshMs);
    ctx.listen(document, "visibilitychange", () => { if (!document.hidden) refresh(); });

    // ---- first frame: seeds render immediately, shared data streams in ----
    rebuildIndex();
    updateCount();
    renderBottom();
    drawFrame(0);
    try { ctx.markVisualReady("seed canvas"); } catch (e) { /* older hosts */ }
    ctx.platform.ready();

    // fonts are polish; never block the first frame on them
    Promise.all([
      ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0", { weight: "300 700" }),
      ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400" })
    ]).catch(() => {});

    await loadCanvas(false);
    if (destroyed) return;
    showPrompt(visits === 1
      ? `<b>Everyone leaves a mark</b>Nobody gets the last word.`
      : `<b>Today</b>${esc(prompt)}`, 9000);
  }
};
