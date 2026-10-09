// THE UNFINISHED CANVAS
// A persistent, shared, never-finished artwork. Every accepted contribution is an
// immutable record in the "canvas" objects world; the image is always re-rendered
// from that append-only history, so covered marks stay recoverable.
//
// Three separate layers, always drawn in this order:
//   1. background   2. committed contributions (authoritative order)   3. the draft
// The draft is never written into the committed layer until the world accepts it.
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
      maxMarks: Math.round(clampN(tune("marks_per_contribution", 10), 1, 16)),
      drawMs: clampN(tune("drawing_seconds", 15), 4, 30) * 1000,
      perVisit: Math.round(clampN(tune("contributions_per_visit", 5), 1, 10)),
      milestones: [tune("milestone_1", 25), tune("milestone_2", 100), tune("milestone_3", 250)]
        .map((n) => Math.max(1, Math.round(n))).sort((a, b) => a - b),
      glow: clampN(tune("glow_strength", 0.7), 0, 1),
      grain: clampN(tune("grain_amount", 0.06), 0, 0.2),
      stampCostMs: 400,
      sprayEveryMs: 45,
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
    // 1. Palette, tools, shapes
    // =====================================================================
    const BG = "#050607";
    const OUTSIDE = "#020303";
    // Legacy (schema v1) colour indices. New contributions store exact hex colours.
    const LEGACY_COLORS = ["#FF426D", "#FF7048", "#FFC45B", "#43E4E0", "#00BDAA", "#A78BFA", "#B8F5C8", "#EDEFF2", "#15191D"];
    const WIDTHS = [5, 12, 26];
    const STAMP_SIZES = [26, 54, 96];
    const TOOL = { INK: 0, NEON: 1, LIQUID: 2, SPRAY: 3, RIBBON: 4 };
    const TOOL_NAMES = ["Ink", "Neon", "Liquid", "Spray", "Ribbon"];
    // stamp fill styles; a stamp borrows the feel of the last stroke tool
    const STAMP_STYLE = { SOLID: 0, GLOW: 1, SOFT: 2 };
    const STYLE_FOR_TOOL = [STAMP_STYLE.SOLID, STAMP_STYLE.GLOW, STAMP_STYLE.SOFT, STAMP_STYLE.SOFT, STAMP_STYLE.SOLID];
    const SHAPES = ["circle", "ring", "rect", "triangle", "burst", "blob", "star"];
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
    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    // ---- colour ----
    function hsvToHex(h, s, v) {
      h = ((h % 360) + 360) % 360; s = clampN(s, 0, 1); v = clampN(v, 0, 1);
      const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
      const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      const hx = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
      return "#" + hx(r) + hx(g) + hx(b);
    }
    function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function hexToHsv(hex) {
      const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return { h: (h + 360) % 360, s: mx ? d / mx : 0, v: mx };
    }
    function luminance(hex) { const [r, g, b] = hexToRgb(hex).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
    function mixHex(a, b, t) {
      const A = hexToRgb(a), B = hexToRgb(b);
      return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
    }
    function visibleOnDark(hex) { return luminance(hex) < 0.12 ? "#EDEFF2" : hex; }

    // ---- storage (viewer-local convenience; works whether the host API is sync or async) ----
    let storageOk = false;
    async function sgetA(key, fallback) {
      try {
        if (!ctx.storage || typeof ctx.storage.get !== "function") return fallback;
        const v = await Promise.race([Promise.resolve(ctx.storage.get(key)), new Promise((r) => ctx.timeout(() => r(undefined), 800))]);
        return v === null || v === undefined ? fallback : v;
      } catch (e) { return fallback; }
    }
    function sset(key, value) {
      try {
        if (!ctx.storage || typeof ctx.storage.set !== "function") return;
        const r = ctx.storage.set(key, value);
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (e) { /* convenience only */ }
    }

    // =====================================================================
    // 3. Codec: compact geometry for the 1 KB mutation cap
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
    // Spray density lives in point spacing (time-sampled), so it is thinned, never RDP'd.
    function decimate(pts) { return pts.length < 3 ? pts.slice() : pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1); }

    // =====================================================================
    // 4. Contribution model + validator (shared by seeds, server data, drafts)
    //    Wire object (schema v2):
    //      { v:2, i:clientId, m:"a"|"c"|"t", p?:parentId, t:unixSeconds,
    //        k:[ [0,tool,"rrggbb",width,points] | [1,style,"rrggbb",shape,x,y,r,deg] ] }
    //    v1 objects (palette indices, 3 brushes) still decode.
    // =====================================================================
    const SCHEMA_VERSION = 2;
    function isId(s) { return typeof s === "string" && s.length > 0 && s.length <= 128 && /^[A-Za-z0-9_:.-]+$/.test(s); }
    function isInt(v, a, b) { return Number.isInteger(v) && v >= a && v <= b; }
    function decodeColor(c, v) {
      if (v === 1) return isInt(c, 0, LEGACY_COLORS.length - 1) ? LEGACY_COLORS[c] : null;
      return typeof c === "string" && /^[0-9a-fA-F]{6}$/.test(c) ? "#" + c.toLowerCase() : null;
    }

    function decodeContribution(id, wire, meta) {
      if (!wire || typeof wire !== "object") return null;
      if (wire.v !== 1 && wire.v !== 2) return null;
      // v2 carries its client id so server-side key formats can't split one mark in two
      if (wire.v === 2 && isId(wire.i)) id = wire.i;
      if (!isId(id)) return null;
      const mode = wire.m;
      if (mode !== "a" && mode !== "c" && mode !== "t") return null;
      if (!Array.isArray(wire.k) || wire.k.length < 1 || wire.k.length > 16) return null;
      const parent = wire.p === undefined || wire.p === null ? null : wire.p;
      if (parent !== null && !isId(parent)) return null;
      const maxTool = wire.v === 1 ? 2 : 4;
      let totalPoints = 0;
      const marks = [];
      for (const raw of wire.k) {
        if (!Array.isArray(raw)) return null;
        if (raw[0] === 0 && raw.length === 5) {
          const [, tool, color, width, enc] = raw;
          const col = decodeColor(color, wire.v);
          if (!isInt(tool, 0, maxTool) || !col || !isInt(width, 0, WIDTHS.length - 1)) return null;
          const pts = decodePoints(enc);
          if (!pts) return null;
          totalPoints += pts.length;
          marks.push(prepareMark({ kind: "stroke", tool, col, width, pts }, id, marks.length));
        } else if (raw[0] === 1 && raw.length === 8) {
          const [, style, color, shape, x, y, r, deg] = raw;
          const col = decodeColor(color, wire.v);
          const maxShape = wire.v === 1 ? 5 : SHAPES.length - 1;
          if (!isInt(style, 0, 2) || !col || !isInt(shape, 0, maxShape)) return null;
          if (!isInt(x, 0, 4095) || !isInt(y, 0, 4095) || !isInt(r, 4, 400) || !isInt(deg, 0, 359)) return null;
          marks.push(prepareMark({ kind: "stamp", style, col, shape, x, y, r, a: deg }, id, marks.length));
        } else {
          return null;
        }
      }
      if (totalPoints > 800) return null;
      const t = Number.isFinite(wire.t) && wire.t > 0 ? wire.t * 1000 : 0;
      let bbox = null;
      for (const m of marks) bbox = bboxUnion(bbox, m.bbox);
      return {
        id, mode, parent, marks, bbox,
        clientTime: t,
        serverSeq: meta && Number.isFinite(meta.seq) ? meta.seq : null,
        serverTime: meta && Number.isFinite(meta.time) ? meta.time : null,
        loadIndex: meta && Number.isFinite(meta.index) ? meta.index : 0,
        seed: !!(meta && meta.seed),
        wire
      };
    }

    function prepareMark(m, ownerId, index) {
      m.owner = ownerId;
      m.index = index;
      m.dark = luminance(m.col) < 0.1;
      if (m.kind === "stroke") {
        const w = WIDTHS[m.width];
        const pad = m.tool === TOOL.NEON ? w * 1.8 : m.tool === TOOL.SPRAY ? w * 1.7 : m.tool === TOOL.RIBBON ? w * 0.9 : m.tool === TOOL.LIQUID ? w * 0.9 : w * 0.5;
        m.bbox = bboxOf(m.pts, pad + 2);
        if (m.tool === TOOL.SPRAY) m.path = sprayPath(m.pts, w, ownerId + ":" + index);
        else if (m.tool === TOOL.RIBBON) { const rb = ribbonPaths(m.pts, w); m.path = rb.fill; m.edge = rb.edge; }
        else m.path = strokePath(m.pts);
      } else {
        m.path = stampPath(m, ownerId, index);
        const rr = m.r * (m.shape === 2 ? 1.25 : 1.15);
        m.bbox = { x0: m.x - rr, y0: m.y - rr, x1: m.x + rr, y1: m.y + rr };
      }
      return m;
    }

    function encodeMarks(marks) {
      return marks.map((m) => m.kind === "stroke"
        ? [0, m.tool, m.col.slice(1).toLowerCase(), m.width, encodePoints(m.pts)]
        : [1, m.style, m.col.slice(1).toLowerCase(), m.shape, Math.round(m.x), Math.round(m.y), Math.round(clampN(m.r, 4, 400)), ((Math.round(m.a) % 360) + 360) % 360]);
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
    // SPRAY: scattered droplets around each time-sampled point. Slow hands leave
    // dense points (dense paint); fast flicks leave a sparse trail. Deterministic.
    function sprayPath(pts, w, seedKey) {
      const p = new Path2D();
      const rand = rng(hashStr(seedKey));
      const R = w * 1.5;
      for (const pt of pts) {
        for (let j = 0; j < 7; j++) {
          const a = rand() * Math.PI * 2;
          const rr = R * Math.sqrt(rand()) * (rand() < 0.75 ? 0.62 : 1);
          const dr = w * (0.05 + rand() * 0.13);
          const x = pt.x + Math.cos(a) * rr, y = pt.y + Math.sin(a) * rr;
          p.moveTo(x + dr, y);
          p.arc(x, y, dr, 0, Math.PI * 2);
        }
      }
      return p;
    }
    // RIBBON: a flat calligraphic nib. Width follows the stroke's direction against a
    // fixed nib angle and tapers at both ends, so the same gesture draws a rich contour.
    function ribbonPaths(pts, w) {
      let P = pts;
      if (P.length > 2) { // one round of Chaikin smoothing for a silky edge
        const s = [P[0]];
        for (let i = 0; i < P.length - 1; i++) {
          const a = P[i], b = P[i + 1];
          s.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        s.push(P[P.length - 1]);
        P = s;
      }
      const fill = new Path2D(), edge = new Path2D();
      if (P.length < 2) { fill.arc(P[0].x, P[0].y, w * 0.45, 0, Math.PI * 2); return { fill, edge }; }
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
      const total = cum[cum.length - 1] || 1;
      const nib = -0.62, maxW = w * 1.7;
      const L = [], R = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        const dir = Math.atan2(b.y - a.y, b.x - a.x);
        const t = cum[i] / total;
        const taper = Math.min(1, Math.min(t, 1 - t) / 0.14);
        const half = (maxW * (0.16 + 0.84 * Math.abs(Math.sin(dir - nib))) * (0.2 + 0.8 * taper)) / 2;
        const nx = -Math.sin(dir), ny = Math.cos(dir);
        L.push({ x: P[i].x + nx * half, y: P[i].y + ny * half });
        R.push({ x: P[i].x - nx * half, y: P[i].y - ny * half });
      }
      fill.moveTo(L[0].x, L[0].y);
      for (let i = 1; i < L.length; i++) fill.lineTo(L[i].x, L[i].y);
      for (let i = R.length - 1; i >= 0; i--) fill.lineTo(R[i].x, R[i].y);
      fill.closePath();
      edge.moveTo(L[0].x, L[0].y);
      for (let i = 1; i < L.length; i++) edge.lineTo(L[i].x, L[i].y);
      return { fill, edge };
    }
    function stampPath(m, ownerId, index) {
      const p = new Path2D();
      const { x, y, r } = m;
      const a = (m.a * Math.PI) / 180;
      const rot = (px, py) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)];
      const poly = (pts) => { pts.forEach(([px, py], i) => { const [X, Y] = rot(px, py); i ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath(); };
      const spikes = (n, inner) => {
        const pts = [];
        for (let i = 0; i < n * 2; i++) { const rr = i % 2 ? r * inner : r; const t = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2; pts.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
        poly(pts);
      };
      switch (SHAPES[m.shape]) {
        case "circle": p.arc(x, y, r, 0, Math.PI * 2); break;
        case "ring": p.arc(x, y, r, 0, Math.PI * 2); break;
        case "rect": poly([[-r, -r * 0.62], [r, -r * 0.62], [r, r * 0.62], [-r, r * 0.62]]); break;
        case "triangle": poly([[0, -r], [r * 0.92, r * 0.62], [-r * 0.92, r * 0.62]]); break;
        case "burst": spikes(12, 0.42); break;
        case "star": spikes(5, 0.45); break;
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
    // 6. Mark rendering: six genuinely different behaviours.
    //    INK crisp+opaque · NEON sharp core with restrained additive bloom ·
    //    LIQUID translucent, accumulates through screen blending · SPRAY droplets ·
    //    RIBBON calligraphic contour with a lit edge · STAMP shapes.
    // =====================================================================
    function drawMark(g, m, alpha) {
      alpha = alpha === undefined ? 1 : alpha;
      const col = m.col;
      const dark = m.dark;
      g.lineCap = "round";
      g.lineJoin = "round";
      const G = 0.35 + CFG.glow * 0.65;
      if (m.kind === "stroke") {
        const w = WIDTHS[m.width];
        switch (m.tool) {
          case TOOL.INK:
            g.globalCompositeOperation = "source-over";
            g.globalAlpha = alpha;
            g.strokeStyle = col; g.lineWidth = w; g.stroke(m.path);
            break;
          case TOOL.NEON:
            g.globalCompositeOperation = dark ? "source-over" : "lighter";
            g.strokeStyle = col;
            g.globalAlpha = alpha * (dark ? 0.16 : 0.06) * G; g.lineWidth = w * 3.2; g.stroke(m.path);
            g.globalAlpha = alpha * (dark ? 0.28 : 0.14) * G; g.lineWidth = w * 1.9; g.stroke(m.path);
            g.globalCompositeOperation = "source-over";
            g.globalAlpha = alpha; g.lineWidth = w * 0.85; g.stroke(m.path);
            if (!dark) { g.strokeStyle = mixHex(col, "#ffffff", 0.7); g.globalAlpha = alpha * 0.9; g.lineWidth = Math.max(1, w * 0.3); g.stroke(m.path); }
            break;
          case TOOL.LIQUID:
            g.globalCompositeOperation = dark ? "source-over" : "screen";
            g.strokeStyle = col;
            g.globalAlpha = alpha * 0.13; g.lineWidth = w * 1.7; g.stroke(m.path);
            g.globalAlpha = alpha * 0.42; g.lineWidth = w * 1.05; g.stroke(m.path);
            break;
          case TOOL.SPRAY:
            g.globalCompositeOperation = "source-over";
            g.fillStyle = col;
            g.globalAlpha = alpha * 0.92; g.fill(m.path);
            break;
          case TOOL.RIBBON:
            g.globalCompositeOperation = "source-over";
            g.fillStyle = col;
            g.globalAlpha = alpha; g.fill(m.path);
            g.strokeStyle = dark ? "#3a4148" : mixHex(col, "#ffffff", 0.55);
            g.globalAlpha = alpha * 0.8; g.lineWidth = Math.max(1.2, w * 0.12); g.stroke(m.edge);
            break;
        }
      } else {
        const ring = SHAPES[m.shape] === "ring";
        const r = m.r;
        if (m.style === STAMP_STYLE.SOLID) {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = alpha;
          if (ring) { g.strokeStyle = col; g.lineWidth = Math.max(3, r * 0.2); g.stroke(m.path); }
          else { g.fillStyle = col; g.fill(m.path); }
        } else if (m.style === STAMP_STYLE.GLOW) {
          g.globalCompositeOperation = dark ? "source-over" : "lighter";
          g.strokeStyle = col; g.fillStyle = col;
          if (!ring) { g.globalAlpha = alpha * (dark ? 0.35 : 0.13); g.fill(m.path); }
          g.globalAlpha = alpha * 0.1 * G; g.lineWidth = Math.max(6, r * 0.34); g.stroke(m.path);
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = alpha; g.lineWidth = Math.max(2, r * (ring ? 0.12 : 0.06)); g.stroke(m.path);
          if (!dark) { g.strokeStyle = mixHex(col, "#ffffff", 0.7); g.globalAlpha = alpha * 0.8; g.lineWidth = Math.max(1, r * 0.025); g.stroke(m.path); }
        } else {
          g.globalCompositeOperation = dark ? "source-over" : "screen";
          g.fillStyle = col; g.strokeStyle = col;
          if (ring) {
            g.globalAlpha = alpha * 0.12; g.lineWidth = r * 0.5; g.stroke(m.path);
            g.globalAlpha = alpha * 0.3; g.lineWidth = r * 0.22; g.stroke(m.path);
          } else {
            g.globalAlpha = alpha * 0.1; g.lineWidth = r * 0.3; g.stroke(m.path);
            g.globalAlpha = alpha * (dark ? 0.5 : 0.36); g.fill(m.path);
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
      [{ kind: "stroke", tool: TOOL.NEON, col: "#ff426d", width: 1, pts: wave(700, 1150, 1330, 900, 90, 1.2, 22, 0.4) }],
      [{ kind: "stroke", tool: TOOL.RIBBON, col: "#ff7048", width: 2, pts: wave(740, 830, 1080, 760, 46, 0.8, 14, 1.2) }],
      [{ kind: "stamp", style: STAMP_STYLE.SOLID, col: "#43e4e0", shape: 1, x: 1180, y: 1000, r: 70, a: 0 }],
      [{ kind: "stamp", style: STAMP_STYLE.SOFT, col: "#a78bfa", shape: 5, x: 880, y: 1250, r: 110, a: 20 }],
      [
        { kind: "stamp", style: STAMP_STYLE.GLOW, col: "#ffc45b", shape: 4, x: 1260, y: 760, r: 26, a: 10 },
        { kind: "stamp", style: STAMP_STYLE.GLOW, col: "#ffc45b", shape: 6, x: 1305, y: 800, r: 16, a: 40 }
      ],
      [{ kind: "stamp", style: STAMP_STYLE.SOLID, col: "#00bdaa", shape: 3, x: 760, y: 980, r: 44, a: 200 }],
      [{ kind: "stroke", tool: TOOL.INK, col: "#15191d", width: 2, pts: wave(1000, 1300, 1120, 820, 14, 2.5, 14, 0) }],
      [{ kind: "stroke", tool: TOOL.SPRAY, col: "#b8f5c8", width: 1, pts: wave(1200, 1170, 1390, 1300, 26, 1.5, 26, 0.7) }],
      [{ kind: "stroke", tool: TOOL.LIQUID, col: "#43e4e0", width: 2, pts: wave(640, 1340, 900, 1080, 30, 0.6, 12, 0.2) }]
    ];
    const SEEDS = SEED_DEFS.map((marks, i) => decodeContribution("seed-" + (i + 1), { v: 2, m: "a", t: 0, k: encodeMarks(marks.map((m) => ({ ...m }))) }, { seed: true }))
      .filter(Boolean);

    // =====================================================================
    // 8. Repositories. The drawing engine only talks to this interface:
    //      load() -> [{ id, object, meta }]   append(id, object) -> result
    //    "shared" uses the Plethora objects world; "local" is a clearly
    //    labelled fallback when the world API is unavailable.
    // =====================================================================
    const DIAG = { repo: "", load: "not yet", topKeys: "", rejected: 0, lastMutate: "", verify: "" };

    // The world snapshot format isn't documented, so find contributions wherever
    // they sit: raw objects keyed by id, {id, object|value|data} wrappers, arrays.
    function looksLikeContribution(o) { return !!o && typeof o === "object" && (o.v === 1 || o.v === 2) && Array.isArray(o.k); }
    function metaOf(e, index) {
      const seq = [e.seq, e.sequence, e.revision, e.version, e.order, e.position].find((v) => Number.isFinite(v));
      const tRaw = [e.createdAt, e.created_at, e.insertedAt, e.inserted_at, e.updatedAt, e.updated_at, e.at].find((v) => v !== undefined && v !== null);
      const time = typeof tRaw === "number" ? tRaw : tRaw ? Date.parse(tRaw) : NaN;
      return { seq: Number.isFinite(seq) ? seq : null, time: Number.isFinite(time) ? time : null, index };
    }
    function normalizeSnapshot(snap) {
      const out = [];
      let index = 0;
      const visit = (node, keyHint, depth) => {
        if (!node || typeof node !== "object" || depth > 6) return;
        if (looksLikeContribution(node)) { out.push({ id: String(node.i || node.id || keyHint || ""), object: node, meta: metaOf(node, index++) }); return; }
        for (const k of ["object", "value", "data", "payload", "doc"]) {
          if (looksLikeContribution(node[k])) {
            const id = node.id || node.key || node.objectId || node.object_id || keyHint;
            out.push({ id: String(id || ""), object: node[k], meta: metaOf(node, index++) });
            return;
          }
        }
        if (Array.isArray(node)) node.forEach((c) => visit(c, null, depth + 1));
        else for (const k of Object.keys(node)) visit(node[k], k, depth + 1);
      };
      visit(snap, null, 0);
      DIAG.topKeys = snap && typeof snap === "object" ? Object.keys(snap).slice(0, 6).join(",") : typeof snap;
      return out;
    }
    function mutationRejected(result) {
      if (!result || typeof result !== "object") return false;
      if (result.ok === false || result.accepted === false || result.rejected === true || result.error) return true;
      return /reject|denied|error|limit|invalid/i.test(String(result.status || ""));
    }

    function createSharedRepo() {
      const world = ctx.memory.world("canvas");
      return {
        kind: "shared",
        async load() { return normalizeSnapshot(await world.get()); },
        async append(id, object) { return world.mutate({ id, object }); }
      };
    }
    // Local fallback keeps an in-memory mirror so a session never loses marks, and
    // persists to ctx.storage only when that actually works.
    function createLocalRepo(initial) {
      const KEY = "uc_local_world_v2";
      const list = Array.isArray(initial) ? initial.filter((e) => e && e.id && e.object) : [];
      return {
        kind: "local",
        async load() { return list.map((e, i) => ({ id: e.id, object: e.object, meta: { seq: i, time: e.at || null, index: i } })); },
        async append(id, object) {
          if (!list.some((e) => e.id === id)) list.push({ id, object, at: Date.now() });
          sset(KEY, list.slice(-200));
          return { ok: true, seq: list.findIndex((e) => e.id === id) };
        }
      };
    }
    const hasWorld = !!(ctx.memory && typeof ctx.memory.world === "function");
    let repo = hasWorld ? createSharedRepo() : null;

    // =====================================================================
    // 9. Canvas model: ordered, immutable contributions + spatial index
    // =====================================================================
    const model = {
      byId: new Map(),
      ordered: [],     // player contributions in authoritative order
      all: [],         // seeds + ordered
      grid: new Map(), // cell -> [{ c, m }]
      cell: 128
    };
    let mine = new Set();

    // One ordering key for everyone: server sequence if every entry has one,
    // else server time if every entry has one, else client time. Mixing keys is
    // how a new mark used to slip *under* older ones.
    function sortOrdered() {
      const list = model.ordered;
      const allSeq = list.every((c) => c.serverSeq !== null);
      const allTime = list.every((c) => c.serverTime !== null);
      const key = allSeq ? (c) => c.serverSeq : allTime ? (c) => c.serverTime : (c) => c.clientTime;
      list.sort((a, b) => (key(a) - key(b)) || (a.clientTime - b.clientTime) || (a.loadIndex - b.loadIndex) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    // Append-only merge: a known id is never replaced or removed by later data.
    function mergeEntries(entries) {
      const fresh = [];
      let reorder = false;
      for (const e of entries) {
        const c = model.byId.get(e.object && e.object.v === 2 && isId(e.object.i) ? e.object.i : e.id);
        if (c) {
          // Ordering metadata may arrive later from the server; content never changes.
          if (e.meta && e.meta.seq !== null && c.serverSeq !== e.meta.seq) { c.serverSeq = e.meta.seq; reorder = true; }
          if (e.meta && e.meta.time !== null && c.serverTime !== e.meta.time) { c.serverTime = e.meta.time; reorder = true; }
          continue;
        }
        const d = decodeContribution(e.id, e.object, e.meta);
        if (!d) { DIAG.rejected++; continue; }
        model.byId.set(d.id, d);
        fresh.push(d);
      }
      if (fresh.length || reorder) {
        model.ordered = model.ordered.concat(fresh);
        sortOrdered();
        rebuildIndex();
        invalidateArt();
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
      looseCache = null;
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
        const w = WIDTHS[m.width];
        const r = (m.tool === TOOL.SPRAY ? w * 1.5 : m.tool === TOOL.RIBBON ? w * 0.85 : m.tool === TOOL.INK ? w * 0.5 : w * 0.9) + tol;
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

    // Offscreen cache for the committed artwork. Without OffscreenCanvas the art is
    // simply drawn straight to the screen every frame.
    function makeBuffer(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      try { return new OffscreenCanvas(w, h); } catch (e) { return null; }
    }
    let art = makeBuffer(4, 4), artG = art ? art.getContext("2d") : null;
    let artView = null;  // camera + backing size the art buffer was rendered with
    let artDirty = true;
    let artLimit = Infinity;
    let dirty = true;
    let looseCache = null;

    function backingScale() { return canvas.width / Math.max(1, W); }
    function trayReserve() { return S.phase === "draw" ? (picker.open ? 400 : 250) : 120; }
    function computeFit() {
      const b = sectionBounds();
      const availH = Math.max(160, H - (64 + SAFE.top) - (trayReserve() + SAFE.bottom));
      fitScale = Math.min(W / ((b.x1 - b.x0) * 1.06), availH / ((b.y1 - b.y0) * 1.06));
    }
    function fitTarget() {
      computeFit();
      const b = sectionBounds();
      return { s: fitScale, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + ((trayReserve() + SAFE.bottom) - (64 + SAFE.top)) / 2 / fitScale };
    }
    function fitView() {
      const t = fitTarget();
      cam.s = t.s; cam.x = t.x; cam.y = t.y;
      clampCam();
      invalidateArt();
    }
    function clampCam() {
      cam.s = clampN(cam.s, fitScale * 0.6, 7);
      const b = sectionBounds();
      const m = 160;
      cam.x = clampN(cam.x, b.x0 - m, b.x1 + m);
      cam.y = clampN(cam.y, b.y0 - m, b.y1 + m + 300);
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
      if (!c) { grainPattern = "none"; return; }
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

    // Committed layer: background, then every accepted contribution in order.
    function renderArt(direct) {
      const s = backingScale();
      const bw = canvas.width, bh = canvas.height;
      if (!direct && (art.width !== bw || art.height !== bh)) { art = makeBuffer(bw, bh); artG = art.getContext("2d"); }
      const a = direct ? g : artG;
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalAlpha = 1;
      a.globalCompositeOperation = "source-over";
      a.fillStyle = OUTSIDE;
      a.fillRect(0, 0, bw, bh);
      applyWorld(a, s);
      const b = sectionBounds();
      a.fillStyle = BG;
      a.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      a.strokeStyle = "rgba(237,239,242,0.16)";
      a.lineWidth = 1.2 / cam.s;
      const t = 26 / cam.s;
      a.beginPath();
      for (const [x, y, dx, dy] of [[b.x0, b.y0, 1, 1], [b.x1, b.y0, -1, 1], [b.x0, b.y1, 1, -1], [b.x1, b.y1, -1, -1]]) {
        a.moveTo(x + dx * t, y); a.lineTo(x, y); a.lineTo(x, y + dy * t);
      }
      a.stroke();
      const v0 = toWorld(0, 0), v1 = toWorld(W, H);
      const view = { x0: v0.x, y0: v0.y, x1: v1.x, y1: v1.y };
      for (const c of model.all) {
        if (c.z > artLimit) break;
        if (!bboxHit(c.bbox, view, 40)) continue;
        drawContribution(a, c, 1);
      }
      if (!direct) artView = { x: cam.x, y: cam.y, s: cam.s, W, H, bw, bh };
      artDirty = false;
    }

    // =====================================================================
    // 11. Game state
    // =====================================================================
    const today = Math.floor(Date.now() / 86400000);
    const prompt = PROMPTS[today % PROMPTS.length];
    let visits = 1;
    const tut = { contributed: 0, sawHistory: false };

    // Interaction state machine:
    //   explore    look around (drag pans, tap inspects)
    //   draw       DRAW sub-state draws, MOVE sub-state pans; two fingers always navigate
    //   select     tap a mark to link the draft to it (optional, never required)
    //   preview    the draft composited over the committed art, exactly as it will land
    //   submitting waiting for the world to accept
    //   history    scrub through the past (view-only)
    const S = {
      phase: "loading",
      inspect: null,
      link: null,           // { c, m } optional parent for CONTINUE / TRANSFORM
      relation: "c",        // "c" continue | "t" transform
      pickStack: null, pickIndex: 0, pickTap: null,
      submittedThisVisit: 0,
      connection: "connecting", // connecting | shared | local
      lastError: null,
      previewNote: null,
      confirmDiscard: false,
      history: { limit: 0, playing: false, inspect: null }
    };
    const draft = {
      id: null, marks: [], active: null, usedMs: 0,
      tool: TOOL.NEON, stamp: false, width: 1, shape: 0, nav: false,
      h: 345, s: 0.74, v: 1, col: hsvToHex(345, 0.74, 1)
    };
    const picker = { open: false, drag: null };

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
.uc .mark button{display:block;font-family:"Space Mono",ui-monospace,monospace;font-weight:400;letter-spacing:.02em;text-transform:none;font-size:11px;color:var(--mute);margin-top:2px;text-align:left}
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
.uc .bottom{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 10px}
.uc .cta{pointer-events:auto;height:52px;padding:0 28px;border-radius:26px;background:var(--fg);color:#050607;font-weight:700;letter-spacing:.16em;font-size:14px;display:flex;align-items:center;gap:10px}
.uc .cta i{width:8px;height:8px;border-radius:50%;background:var(--coral)}
.uc .cta small{font-weight:500;letter-spacing:.04em;font-size:12px;opacity:.6}
.uc .cta.spent{background:rgba(237,239,242,.08);color:var(--mute);border:1px solid var(--line);letter-spacing:.06em;font-weight:500;font-size:13px}
.uc .cta.spent i{background:var(--cyan)}
.uc .coach{font-size:12.5px;color:var(--mute);text-align:center;max-width:320px;line-height:1.35;pointer-events:none}
.uc .coach em{font-style:normal;color:var(--fg)}
.uc .x{font-size:20px;line-height:1;color:var(--mute);width:32px;height:32px;display:grid;place-items:center}
.uc .tray{pointer-events:auto;width:100%;max-width:470px;background:rgba(8,10,12,.94);border:1px solid var(--line);border-radius:22px;padding:10px;display:flex;flex-direction:column;gap:8px}
.uc .row{display:flex;align-items:center;gap:6px;justify-content:space-between}
.uc .seg{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;min-width:0}
.uc .seg::-webkit-scrollbar{display:none}
.uc .chip{height:36px;min-width:36px;padding:0 9px;border-radius:18px;border:1px solid transparent;font-size:12px;letter-spacing:.04em;color:var(--mute);display:flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto}
.uc .chip.on{border-color:rgba(237,239,242,.6);color:var(--fg);background:rgba(237,239,242,.06)}
.uc .chip svg{width:18px;height:18px;overflow:visible}
.uc .tool{flex-direction:column;gap:1px;height:50px;min-width:48px;padding:0 4px;border-radius:14px}
.uc .tool svg{width:38px;height:20px}
.uc .tool span{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase}
.uc .modeseg{display:flex;border:1px solid var(--line);border-radius:18px;padding:2px}
.uc .modeseg button{height:30px;padding:0 12px;border-radius:15px;font-size:11.5px;letter-spacing:.12em;font-weight:600;color:var(--mute);display:flex;align-items:center;gap:6px}
.uc .modeseg button.on{background:var(--fg);color:#050607}
.uc .modeseg svg{width:14px;height:14px}
.uc .acts{display:flex;align-items:center;gap:8px}
.uc .btn{height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--line);font-size:12.5px;font-weight:600;letter-spacing:.06em;display:flex;align-items:center;gap:8px;white-space:nowrap}
.uc .btn.primary{background:var(--fg);color:#050607;border-color:var(--fg)}
.uc .btn.warn{border-color:#FF426D;color:#FF426D}
.uc .btn[disabled]{opacity:.35}
.uc .colbtn{height:40px;padding:0 10px 0 6px;border-radius:20px;border:1px solid var(--line);display:flex;align-items:center;gap:8px;font-family:"Space Mono",ui-monospace,monospace;font-size:11px;color:var(--mute);flex:0 0 auto}
.uc .colbtn.on{border-color:var(--fg);color:var(--fg)}
.uc .dot{width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(237,239,242,.35)}
.uc .linkchip{height:40px;padding:0 12px;border-radius:20px;border:1px dashed var(--line);font-size:12px;color:var(--mute);display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.uc .linkchip.on{border-style:solid;border-color:var(--cyan);color:var(--fg)}
.uc .meter{position:relative;width:36px;height:36px;flex:0 0 auto}
.uc .meter svg{width:36px;height:36px;transform:rotate(-90deg)}
.uc .meter span{position:absolute;inset:0;display:grid;place-items:center;font-family:"Space Mono",ui-monospace,monospace;font-size:10px}
.uc .status{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;color:var(--mute)}
.uc .picker{display:flex;flex-direction:column;gap:10px;padding:2px 2px 4px}
.uc .sv{position:relative;height:132px;border-radius:14px;touch-action:none;cursor:crosshair;pointer-events:auto;box-shadow:inset 0 0 0 1px rgba(237,239,242,.12)}
.uc .hue{position:relative;height:26px;border-radius:13px;touch-action:none;cursor:pointer;pointer-events:auto;background:linear-gradient(to right,#f00 0%,#ff8000 8.3%,#ff0 16.7%,#80ff00 25%,#0f0 33.3%,#00ff80 41.7%,#0ff 50%,#0080ff 58.3%,#00f 66.7%,#8000ff 75%,#f0f 83.3%,#ff0080 91.7%,#f00 100%);box-shadow:inset 0 0 0 1px rgba(237,239,242,.12)}
.uc .thumb{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.6);pointer-events:none}
.uc .hue .thumb{top:50%;width:18px;height:30px;margin:-15px 0 0 -9px;border-radius:9px}
.uc .pvrow{display:flex;align-items:center;gap:10px}
.uc .pvrow .big{width:40px;height:40px;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(237,239,242,.3);flex:0 0 auto}
.uc .pvrow svg{flex:1;height:34px;min-width:0}
.uc .pvrow .hex{font-family:"Space Mono",ui-monospace,monospace;font-size:12px;color:var(--fg);min-width:62px}
.uc .modechip{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:min(420px,calc(100% - 28px));display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.14em;font-weight:600;pointer-events:auto;background:rgba(5,6,7,.78);border:1px solid var(--line);border-radius:999px;padding:6px 6px 6px 14px}
.uc .modechip .q{flex:1 1 auto;min-width:0;line-height:1.25;letter-spacing:0;font-weight:400;color:var(--mute);font-size:12px;text-transform:none}
.uc .toast{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 40px);padding:16px 22px;border-radius:18px;background:rgba(5,6,7,.72);font-weight:700;letter-spacing:.22em;font-size:20px;text-align:center;pointer-events:none;transition:opacity .5s, transform .5s;text-shadow:0 0 24px rgba(5,6,7,.9)}
.uc .toast small{display:block;margin-top:8px;letter-spacing:.04em;font-weight:400;font-size:13px;color:var(--mute)}
.uc .card{pointer-events:auto;width:100%;max-width:470px;background:rgba(8,10,12,.94);border:1px solid var(--line);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.uc .card .meta{font-family:"Space Mono",ui-monospace,monospace;font-size:11.5px;color:var(--mute);line-height:1.45;word-break:break-word}
.uc .card .meta b{color:var(--fg);font-weight:400}
.uc .card .title{font-size:13px;font-weight:600;letter-spacing:.06em;display:flex;justify-content:space-between;align-items:center}
.uc input[type=range]{pointer-events:auto;width:100%;accent-color:#EDEFF2;height:28px}
.uc .daychips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.uc .daychips .chip{border-color:var(--line);flex:0 0 auto;height:28px}
.uc .err{font-size:12px;color:#FFC45B}
@media (prefers-reduced-motion:reduce){.uc .pill,.uc .toast{transition:none}}
@media (max-width:360px){.uc .tool{min-width:42px;padding:0 2px}.uc .tool svg{width:32px}.uc .tool span{font-size:8.5px;letter-spacing:.06em}.uc .seg{gap:2px}.uc .colbtn span:last-child{display:none}.uc .colbtn{padding:0 6px}}
</style>
<div class="top" data-r="top">
  <div class="mark">The Unfinished Canvas<button data-a="diag" data-r="count"><span class="live off"></span>connecting…</button></div>
  <div class="icons">
    <button class="ib" data-r="history" aria-label="History"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg></button>
    <button class="ib" data-r="fit" aria-label="Whole canvas"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
  </div>
</div>
<div class="pill hide" data-r="prompt"></div>
<div class="modechip gone" data-r="modechip"></div>
<div class="toast hide" data-r="toast"></div>
<div data-r="diagbox" class="gone" style="position:absolute;left:10px;right:10px;display:flex;justify-content:center"></div>
<div class="bottom" data-r="bottom"></div>`;
    const $ = (r) => ui.querySelector(`[data-r="${r}"]`);
    const el = { top: $("top"), count: $("count"), history: $("history"), fit: $("fit"), prompt: $("prompt"), modechip: $("modechip"), toast: $("toast"), bottom: $("bottom"), diag: $("diagbox") };

    function layoutUI() {
      el.top.style.paddingTop = 12 + SAFE.top + "px";
      el.top.style.paddingLeft = 14 + SAFE.left + "px";
      el.top.style.paddingRight = 14 + SAFE.right + "px";
      el.prompt.style.top = 64 + SAFE.top + "px";
      el.modechip.style.top = 64 + SAFE.top + "px";
      el.diag.style.top = 110 + SAFE.top + "px";
      el.bottom.style.bottom = Math.max(14, SAFE.bottom + 12) + "px";
    }

    function updateCount() {
      const n = model.ordered.length;
      const next = CFG.milestones.find((m) => m > n);
      const dot = S.connection === "shared" ? "live" : S.connection === "local" ? "live local" : "live off";
      let label;
      if (S.connection === "connecting") label = "connecting…";
      else {
        label = n === 0 ? "no marks yet — be the first" : `${n} mark${n === 1 ? "" : "s"}` + (next ? ` · next edge at ${next}` : "");
        if (S.connection === "local") label += storageOk ? " · this device only" : " · this visit only";
      }
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
    function hint(text, ms) { toast(`<small style="font-size:14px;color:#EDEFF2;margin:0">${esc(text)}</small>`, ms || 1800); }
    function hideToast() { toastTok++; el.toast.classList.add("hide"); }

    // ---- tool glyphs: each previews its own behaviour, in the current colour ----
    const WAVE = "M3 14 C 10 2, 18 20, 26 8 S 34 6, 36 10";
    function toolGlyph(tool, col) {
      const c = visibleOnDark(col);
      switch (tool) {
        case TOOL.INK: return `<svg viewBox="0 0 39 20"><path d="${WAVE}" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>`;
        case TOOL.NEON: return `<svg viewBox="0 0 39 20"><path d="${WAVE}" stroke="${c}" stroke-opacity=".28" stroke-width="8" fill="none" stroke-linecap="round"/><path d="${WAVE}" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="${WAVE}" stroke="#fff" stroke-opacity=".85" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
        case TOOL.LIQUID: return `<svg viewBox="0 0 39 20"><path d="${WAVE}" stroke="${c}" stroke-opacity=".22" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M3 10 C 12 18, 22 2, 36 12" stroke="${c}" stroke-opacity=".5" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
        case TOOL.SPRAY: {
          const r = rng(3); let d = "";
          for (let i = 0; i < 46; i++) { const t = i / 46; const x = 3 + t * 33 + (r() - 0.5) * 6; const y = 10 + Math.sin(t * 6) * 5 + (r() - 0.5) * 8; d += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + r() * 0.9).toFixed(2)}"/>`; }
          return `<svg viewBox="0 0 39 20"><g fill="${c}">${d}</g></svg>`;
        }
        case TOOL.RIBBON: return `<svg viewBox="0 0 39 20"><path d="M2 15 C 9 13, 12 2, 19 4 C 25 6, 22 16, 30 15 L 37 6 L 36 9 C 31 19, 22 18, 20 9 C 18 5, 13 9, 2 15Z" fill="${c}"/><path d="M2 15 C 9 13, 12 2, 19 4 C 25 6, 22 16, 30 15 L 37 6" stroke="#fff" stroke-opacity=".6" stroke-width=".8" fill="none"/></svg>`;
      }
      return "";
    }
    function stampGlyph(col) {
      const c = visibleOnDark(col);
      return `<svg viewBox="0 0 39 20"><circle cx="11" cy="10" r="6.5" fill="none" stroke="${c}" stroke-width="2"/><path d="M27 2 L29.3 7.6 L35.3 7.9 L30.6 11.7 L32.2 17.5 L27 14.2 L21.8 17.5 L23.4 11.7 L18.7 7.9 L24.7 7.6Z" fill="${c}"/></svg>`;
    }
    const SHAPE_GLYPH = [
      `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
      `<svg viewBox="0 0 18 18"><rect x="2.5" y="5" width="13" height="8" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M9 2.5 L15.5 14 L2.5 14Z" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M9 1 L10.6 6.4 L16 5 L12 9 L16 13 L10.6 11.6 L9 17 L7.4 11.6 L2 13 L6 9 L2 5 L7.4 6.4Z" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M4 7 C 4 2, 12 2, 14 6 C 17 10, 13 16, 8 15 C 3 14, 4 11, 4 7Z" fill="currentColor"/></svg>`,
      `<svg viewBox="0 0 18 18"><path d="M9 1.5 L11 6.8 L16.6 7 L12.2 10.5 L13.7 16 L9 12.8 L4.3 16 L5.8 10.5 L1.4 7 L7 6.8Z" fill="currentColor"/></svg>`
    ];
    const PEN = `<svg viewBox="0 0 14 14"><path d="M2 12 L3 9 L10 2 L12 4 L5 11Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const MOVE = `<svg viewBox="0 0 14 14"><path d="M7 1v12M1 7h12M7 1 5.5 2.5M7 1l1.5 1.5M7 13l-1.5-1.5M7 13l1.5-1.5M1 7l1.5-1.5M1 7l1.5 1.5M13 7l-1.5-1.5M13 7l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

    // ---- bottom area renderers per phase ----
    function remaining() { return Math.max(0, CFG.perVisit - S.submittedThisVisit); }
    function renderBottom() {
      const b = el.bottom;
      el.modechip.classList.add("gone");
      el.history.classList.toggle("on", S.phase === "history");
      if (S.phase === "loading") { b.innerHTML = `<div class="coach">Loading the canvas…</div>`; return; }
      if (S.phase === "explore") {
        const left = remaining();
        let coach;
        if (!left) coach = `<div class="coach">That's this visit's marks. Come back to see what grows around them.</div>`;
        else if (tut.contributed === 0) coach = `<div class="coach">Draw anything, anywhere. Build on someone else's mark if you like. <em>Nothing gets erased.</em></div>`;
        else if (!tut.sawHistory) coach = `<div class="coach">There's more underneath. Tap <em>History</em> to dig.</div>`;
        else coach = `<div class="coach">Glowing dots are loose ends. Tap one to <em>continue</em> it.</div>`;
        b.innerHTML = (S.inspect ? inspectCardHTML(S.inspect, false) : "") + coach +
          (left
            ? `<button class="cta" data-a="contribute"><i></i>${S.submittedThisVisit ? "DRAW AGAIN" : "CONTRIBUTE"}${S.submittedThisVisit ? `<small>${left} left</small>` : ""}</button>`
            : `<button class="cta spent" data-a="spent"><i></i>Your marks are in</button>`);
        return;
      }
      if (S.phase === "select") {
        showModeChip("LINK A MARK", "Tap a mark to build on it");
        const t = S.pickStack && S.pickStack[S.pickIndex];
        const layers = S.pickStack && S.pickStack.length > 1 ? `<div class="status">layer ${S.pickIndex + 1} of ${S.pickStack.length} · tap again to go deeper</div>` : "";
        b.innerHTML = `<div class="card">
  <div class="title"><span>${t ? (t.c.seed ? "Seed mark" : "Mark #" + t.c.number) : "Tap any mark on the canvas"}</span></div>
  <div class="meta">${t ? describe(t.c) : "Optional — you can always just draw."}</div>${layers}
  <div class="acts" style="justify-content:space-between"><button class="btn" data-a="selectback">Back to drawing</button><button class="btn primary" data-a="uselink" ${t ? "" : "disabled"}>Build on this</button></div>
</div>`;
        return;
      }
      if (S.phase === "draw") {
        showModeChip(draft.nav ? "MOVING" : "DRAWING", draft.nav ? "Drag to move · switch back to Draw to paint" : prompt, true);
        b.innerHTML = trayHTML();
        updateMeter();
        syncPicker();
        return;
      }
      if (S.phase === "preview" || S.phase === "submitting") {
        const busy = S.phase === "submitting";
        showModeChip("PREVIEW", busy ? "Placing your mark…" : "This is exactly how it will land");
        b.innerHTML = `<div class="card">
  <div class="title"><span>${busy ? "Adding to the canvas…" : `Your draft · ${draft.marks.length} mark${draft.marks.length === 1 ? "" : "s"}`}</span></div>
  <div class="meta">${busy ? "Waiting for the canvas to accept it." : "Once it's in, it stays — no undo, no erasing. Others can build on it."}${S.previewNote ? `<br><b>${esc(S.previewNote)}</b>` : ""}</div>
  ${S.lastError ? `<div class="err">${esc(S.lastError)}</div>` : ""}
  <div class="acts" style="justify-content:space-between;flex-wrap:wrap">
    <button class="btn ${S.confirmDiscard ? "warn" : ""}" data-a="discard" ${busy ? "disabled" : ""}>${S.confirmDiscard ? "Discard draft?" : "Cancel draft"}</button>
    <div class="acts"><button class="btn" data-a="edit" ${busy ? "disabled" : ""}>Edit again</button>
    <button class="btn primary" data-a="submit" ${busy ? "disabled" : ""}>${S.lastError ? "Try again" : "Add to canvas"}</button></div>
  </div></div>`;
        return;
      }
      if (S.phase === "history") { b.innerHTML = historyHTML(); return; }
    }

    function showModeChip(label, q, cancellable) {
      el.modechip.innerHTML = `<span>${label}</span>${q ? `<span class="q">${esc(q)}</span>` : ""}${cancellable ? `<button class="btn ${S.confirmDiscard ? "warn" : ""}" style="height:30px;padding:0 10px;font-size:11px" data-a="discard">${S.confirmDiscard ? "Discard?" : "Cancel"}</button>` : ""}`;
      el.modechip.classList.remove("gone");
    }

    function trayHTML() {
      const toolChips = TOOL_NAMES.map((n, i) => `<button class="chip tool ${!draft.stamp && draft.tool === i ? "on" : ""}" data-a="tool" data-v="${i}" aria-label="${n}">${toolGlyph(i, draft.col)}<span>${n}</span></button>`).join("") +
        `<button class="chip tool ${draft.stamp ? "on" : ""}" data-a="stamp" aria-label="Stamp">${stampGlyph(draft.col)}<span>Stamp</span></button>`;
      const second = draft.stamp
        ? SHAPES.map((n, i) => `<button class="chip ${draft.shape === i ? "on" : ""}" data-a="shape" data-v="${i}" aria-label="${n}" style="color:${draft.shape === i ? visibleOnDark(draft.col) : ""}">${SHAPE_GLYPH[i]}</button>`).join("")
        : WIDTHS.map((w, i) => `<button class="chip ${draft.width === i ? "on" : ""}" data-a="width" data-v="${i}" aria-label="Width ${i + 1}"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="${[2, 4.2, 7.5][i]}" fill="currentColor"/></svg></button>`).join("");
      const link = S.link
        ? `<button class="linkchip on" data-a="relation" aria-label="Change relation">↪ ${S.link.c.seed ? "seed" : "#" + S.link.c.number} · ${S.relation === "c" ? "Continue" : "Transform"}</button><button class="x" data-a="unlink" aria-label="Unlink" style="width:24px">×</button>`
        : `<button class="linkchip" data-a="select">↪ Build on a mark</button>`;
      return `<div class="tray">
  <div class="row">
    <div class="modeseg"><button class="${draft.nav ? "" : "on"}" data-a="modeDraw">${PEN}DRAW</button><button class="${draft.nav ? "on" : ""}" data-a="modeMove">${MOVE}MOVE</button></div>
    <span class="status" data-r="markcount"></span>
    <div class="meter"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" stroke="rgba(237,239,242,.12)" stroke-width="3" fill="none"/><circle data-r="ring" cx="18" cy="18" r="15" stroke="#EDEFF2" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="94.25" stroke-dashoffset="0"/></svg><span data-r="secs"></span></div>
  </div>
  ${picker.open ? pickerHTML() : ""}
  <div class="row"><div class="seg">${toolChips}</div></div>
  ${picker.open ? "" : `<div class="row"><div class="seg">${second}</div></div>`}
  <div class="row">
    <button class="colbtn ${picker.open ? "on" : ""}" data-a="colour" aria-label="Colour"><span class="dot" data-r="coldot" style="background:${draft.col}"></span><span data-r="colhex">${draft.col.toUpperCase()}</span></button>
    <div class="acts" style="min-width:0;flex:1 1 auto;justify-content:center">${link}</div>
    <button class="btn primary" data-a="preview" data-r="previewbtn">Preview</button>
  </div>
</div>`;
    }
    function pickerHTML() {
      return `<div class="picker">
  <div class="sv" data-r="sv"><i class="thumb" data-r="svthumb"></i></div>
  <div class="hue" data-r="hue"><i class="thumb" data-r="huethumb"></i></div>
  <div class="pvrow"><span class="big" data-r="pvbig"></span><span class="hex" data-r="pvhex"></span><svg viewBox="0 0 120 34" preserveAspectRatio="none" data-r="pvstroke"></svg><button class="btn" data-a="colourdone">Done</button></div>
</div>`;
    }
    function strokePreviewSVG() {
      const c = draft.col, vc = visibleOnDark(c);
      const P = "M6 24 C 26 4, 46 32, 66 14 S 100 6, 114 18";
      if (draft.stamp) return `<g transform="translate(47 4) scale(1.45)" fill="${vc}" color="${vc}">${SHAPE_GLYPH[draft.shape].replace(/<\/?svg[^>]*>/g, "")}</g>`;
      switch (draft.tool) {
        case TOOL.NEON: return `<path d="${P}" stroke="${c}" stroke-opacity=".3" stroke-width="12" fill="none" stroke-linecap="round"/><path d="${P}" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="${P}" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
        case TOOL.LIQUID: return `<path d="${P}" stroke="${c}" stroke-opacity=".2" stroke-width="14" fill="none" stroke-linecap="round"/><path d="${P}" stroke="${c}" stroke-opacity=".5" stroke-width="8" fill="none" stroke-linecap="round"/>`;
        case TOOL.SPRAY: { const r = rng(9); let d = ""; for (let i = 0; i < 90; i++) { const t = i / 90; d += `<circle cx="${(6 + t * 108 + (r() - 0.5) * 8).toFixed(1)}" cy="${(17 + Math.sin(t * 7) * 8 + (r() - 0.5) * 12).toFixed(1)}" r="${(0.6 + r() * 1.3).toFixed(2)}"/>`; } return `<g fill="${vc}">${d}</g>`; }
        case TOOL.RIBBON: return `<path d="M4 26 C 20 22, 28 4, 46 6 C 62 8, 56 28, 76 26 C 92 24, 100 8, 116 6 L 114 12 C 100 16, 94 32, 74 31 C 52 30, 58 14, 46 12 C 32 10, 24 26, 4 26Z" fill="${c}"/>`;
        default: return `<path d="${P}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
      }
    }
    // Updates the picker and every colour-dependent control in place (no re-render,
    // so dragging a thumb never loses its pointer).
    function syncPicker() {
      const sv = ui.querySelector('[data-r="sv"]');
      if (sv) {
        sv.style.background = `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,${hsvToHex(draft.h, 1, 1)})`;
        const t = ui.querySelector('[data-r="svthumb"]');
        t.style.left = draft.s * 100 + "%";
        t.style.top = (1 - draft.v) * 100 + "%";
        t.style.background = draft.col;
        const ht = ui.querySelector('[data-r="huethumb"]');
        ht.style.left = (draft.h / 360) * 100 + "%";
        ht.style.background = hsvToHex(draft.h, 1, 1);
        ui.querySelector('[data-r="pvbig"]').style.background = draft.col;
        ui.querySelector('[data-r="pvhex"]').textContent = draft.col.toUpperCase();
        ui.querySelector('[data-r="pvstroke"]').innerHTML = strokePreviewSVG();
      }
      const dot = ui.querySelector('[data-r="coldot"]');
      if (dot) dot.style.background = draft.col;
      const hx = ui.querySelector('[data-r="colhex"]');
      if (hx) hx.textContent = draft.col.toUpperCase();
      ui.querySelectorAll('[data-a="tool"]').forEach((b) => { b.firstElementChild.outerHTML = toolGlyph(Number(b.getAttribute("data-v")), draft.col); });
      const st = ui.querySelector('[data-a="stamp"]');
      if (st) st.firstElementChild.outerHTML = stampGlyph(draft.col);
    }
    function setColourHSV(h, s, v) {
      draft.h = ((h % 360) + 360) % 360; draft.s = clampN(s, 0, 1); draft.v = clampN(v, 0, 1);
      draft.col = hsvToHex(draft.h, draft.s, draft.v);
      syncPicker();
      dirty = true;
    }
    function setColourHex(hex) { const hsv = hexToHsv(hex); draft.col = hex.toLowerCase(); if (hsv.s) draft.h = hsv.h; draft.s = hsv.s; draft.v = hsv.v; syncPicker(); }

    function updateMeter() {
      const ring = ui.querySelector('[data-r="ring"]');
      if (!ring) return;
      const left = Math.max(0, CFG.drawMs - draft.usedMs);
      ring.setAttribute("stroke-dashoffset", String(94.25 * (1 - left / CFG.drawMs)));
      ring.setAttribute("stroke", left < 2500 ? "#FF426D" : "#EDEFF2");
      const secs = ui.querySelector('[data-r="secs"]');
      if (secs) secs.textContent = (left / 1000).toFixed(left < 9500 ? 1 : 0);
      const mc = ui.querySelector('[data-r="markcount"]');
      const n = draft.marks.length + (draft.active ? 1 : 0);
      if (mc) mc.textContent = `${n}/${CFG.maxMarks}`;
      const pb = ui.querySelector('[data-r="previewbtn"]');
      if (pb) pb.disabled = draft.marks.length === 0;
    }

    function describe(c) {
      if (c.seed) return `<b>Seed mark</b> · part of the starting composition · under ${coveredBy(c)} later mark${coveredBy(c) === 1 ? "" : "s"}`;
      const parent = c.parent ? model.byId.get(c.parent) : null;
      const rel = c.mode === "a" ? "ADD" : `${MODE_NAMES[c.mode]}${parent ? ` of #${parent.number}` : c.parent && c.parent.indexOf("seed-") === 0 ? " of a seed" : ""}`;
      const kids = childrenOf(c).length;
      const time = c.serverTime || c.clientTime;
      return `<b>#${c.number}</b>${mine.has(c.id) ? " · <b>yours</b>" : ""} · ${rel}${time ? " · " + ago(time) : ""}<br>under ${coveredBy(c)} later mark${coveredBy(c) === 1 ? "" : "s"}${kids ? ` · continued ${kids}×` : ""}`;
    }
    function inspectCardHTML(ref, inHistory) {
      const can = remaining() > 0;
      const layers = ref.stack && ref.stack.length > 1 ? `<div class="status">layer ${ref.idx + 1} of ${ref.stack.length} here · tap again to go deeper</div>` : "";
      return `<div class="card">
  <div class="title"><span>${ref.c.seed ? "Seed mark" : "Mark #" + ref.c.number}</span><button class="x" data-a="closeinspect" aria-label="Close">×</button></div>
  <div class="meta">${describe(ref.c)}</div>${layers}
  ${!inHistory && can ? `<div class="acts"><button class="btn" data-a="quick" data-m="c">Continue this</button><button class="btn" data-a="quick" data-m="t">Transform this</button></div>` : ""}
</div>`;
    }
    function renderDiag() {
      el.diag.classList.toggle("gone", !diagOpen);
      if (!diagOpen) return;
      el.diag.innerHTML = `<div class="card" style="max-width:420px"><div class="title"><span>Canvas status</span><button class="x" data-a="closediag" aria-label="Close">×</button></div>
  <div class="meta">store: <b>${esc(DIAG.repo || "—")}</b> · storage: <b>${storageOk ? "ok" : "unavailable"}</b><br>last load: <b>${esc(DIAG.load)}</b><br>snapshot keys: <b>${esc(DIAG.topKeys || "—")}</b><br>contributions: <b>${model.ordered.length}</b> · unreadable: <b>${DIAG.rejected}</b><br>last write: <b>${esc(DIAG.lastMutate || "—")}</b>${DIAG.verify ? `<br>verify: <b>${esc(DIAG.verify)}</b>` : ""}</div></div>`;
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
    function historyLabel() {
      const N = model.ordered.length, h = S.history, atC = h.limit > 0 ? model.ordered[h.limit - 1] : null;
      return h.limit === 0 ? "Before anyone arrived: the seed marks" : `After mark #${h.limit} of ${N}${atC && (atC.serverTime || atC.clientTime) ? " · " + ago(atC.serverTime || atC.clientTime) : ""}`;
    }
    function historyHTML() {
      const N = model.ordered.length;
      const h = S.history;
      const myCount = model.ordered.filter((c) => mine.has(c.id)).length;
      const days = dayGroups().map((d) => {
        const diff = today - d.day;
        const name = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff + "d ago";
        return `<button class="chip ${h.limit === d.end ? "on" : ""}" data-a="day" data-v="${d.end}">${name}</button>`;
      }).join("");
      return (h.inspect ? inspectCardHTML(h.inspect, true) : "") + `<div class="card">
  <div class="title"><span>History</span><button class="x" data-a="closehistory" aria-label="Close history">×</button></div>
  <div class="meta" data-r="hlabel">${esc(historyLabel())}</div>
  <input type="range" min="0" max="${N}" step="1" value="${h.limit}" data-r="scrub" aria-label="Scrub through history">
  <div class="row"><div class="daychips">${days}</div></div>
  <div class="row">
    <button class="btn" data-a="play">${h.playing ? "Pause" : "▶ Replay"}</button>
    ${myCount ? `<button class="btn" data-a="mine">Yours · ${myCount}</button>` : `<span class="status">tap any spot to see what's underneath</span>`}
  </div>
</div>`;
    }

    // ---- UI events (delegated) ----
    let diagOpen = false;
    ctx.listen(ui, "click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-a]") : null;
      if (!t || t.disabled) return;
      firstGesture();
      const a = t.getAttribute("data-a");
      const v = Number(t.getAttribute("data-v"));
      if (a !== "discard" && S.confirmDiscard) S.confirmDiscard = false;
      switch (a) {
        case "contribute": openDraw(null); break;
        case "spent": hint("Come back later to see what grows around your marks.", 2200); break;
        case "quick": if (S.inspect) { const ref = S.inspect; S.inspect = null; S.relation = t.getAttribute("data-m"); openDraw(ref); } break;
        case "closeinspect": S.inspect = null; S.history.inspect = null; dirty = true; renderBottom(); break;
        case "modeDraw": draft.nav = false; renderBottom(); break;
        case "modeMove": draft.nav = true; renderBottom(); break;
        case "tool": draft.tool = v; draft.stamp = false; renderBottom(); break;
        case "stamp": draft.stamp = true; renderBottom(); break;
        case "shape": draft.shape = v; renderBottom(); break;
        case "width": draft.width = v; renderBottom(); break;
        case "colour": picker.open = !picker.open; renderBottom(); break;
        case "colourdone": picker.open = false; renderBottom(); break;
        case "select": startSelect(); break;
        case "selectback": S.pickStack = null; setPhase("draw"); break;
        case "uselink": useLink(); break;
        case "relation": S.relation = S.relation === "c" ? "t" : "c"; applyRelationDefaults(); renderBottom(); break;
        case "unlink": S.link = null; dirty = true; renderBottom(); break;
        case "preview": goPreview(); break;
        case "edit": S.lastError = null; S.previewNote = null; setPhase("draw"); break;
        case "discard":
          if (!draft.marks.length && !draft.active) { closeDraw(); break; }
          if (S.confirmDiscard) { S.confirmDiscard = false; closeDraw(); }
          else { S.confirmDiscard = true; renderBottom(); ctx.timeout(() => { if (S.confirmDiscard) { S.confirmDiscard = false; renderBottom(); } }, 2600); }
          break;
        case "submit": submitDraft(); break;
        case "closehistory": closeHistory(); break;
        case "play": toggleReplay(); break;
        case "mine": cycleMine(); break;
        case "day": setHistoryLimit(v); renderBottom(); break;
        case "diag": diagOpen = !diagOpen; renderDiag(); break;
        case "closediag": diagOpen = false; renderDiag(); break;
      }
    });
    ctx.listen(ui, "input", (e) => {
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-r") === "scrub") {
        S.history.playing = false;
        setHistoryLimit(Number(e.target.value));
        const lab = ui.querySelector('[data-r="hlabel"]');
        if (lab) lab.textContent = historyLabel();
      }
    });
    // Colour picker drags: continuous, captured, touch + mouse.
    function pickAt(kind, target, e) {
      const r = target.getBoundingClientRect();
      const fx = clampN((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      const fy = clampN((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
      if (kind === "sv") setColourHSV(draft.h, fx, 1 - fy);
      else setColourHSV(fx * 359.9, draft.s, draft.v);
    }
    ctx.listen(ui, "pointerdown", (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-r="sv"],[data-r="hue"]') : null;
      if (!t) return;
      e.preventDefault();
      firstGesture();
      const kind = t.getAttribute("data-r");
      picker.drag = { kind, target: t, id: e.pointerId };
      try { t.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      // picking a hue from grey/black should actually show that hue
      if (kind === "hue") { if (draft.s < 0.15) draft.s = 0.85; if (draft.v < 0.25) draft.v = 1; }
      pickAt(kind, t, e);
    });
    ctx.listen(ui, "pointermove", (e) => { if (picker.drag && e.pointerId === picker.drag.id) pickAt(picker.drag.kind, picker.drag.target, e); });
    const endPick = (e) => { if (picker.drag && e.pointerId === picker.drag.id) { picker.drag = null; ctx.platform.interact({ type: "colour", colour: draft.col }); } };
    ctx.listen(ui, "pointerup", endPick);
    ctx.listen(ui, "pointercancel", endPick);
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
      computeFit();
    }
    // Free draw is the default: CONTRIBUTE opens a draft that is ready to paint.
    function openDraw(linkRef) {
      if (!remaining()) return;
      hidePrompt();
      if (!draft.id) newDraft();
      S.link = linkRef ? { c: linkRef.c, m: linkRef.m } : null;
      if (S.link) applyRelationDefaults();
      draft.nav = false;
      setPhase("draw");
      if (S.link) focusOn(S.link.m.bbox);
      ctx.platform.interact({ type: "open_draw" });
    }
    function newDraft() {
      draft.id = uid();
      draft.marks = [];
      draft.active = null;
      draft.usedMs = 0;
      submitWire = null;
      S.lastError = null;
      S.previewNote = null;
    }
    function closeDraw() {
      // Cancelling only drops the draft; the committed layer is untouched.
      draft.marks = [];
      draft.active = null;
      draft.id = null;
      submitWire = null;
      S.link = null;
      S.lastError = null;
      S.previewNote = null;
      picker.open = false;
      setPhase("explore");
    }
    function applyRelationDefaults() {
      if (!S.link || draft.marks.length) return;
      const m = S.link.m;
      if (S.relation === "c") {
        // CONTINUE inherits the mark's colour and tool so the gesture reads as one line.
        setColourHex(m.col);
        if (m.kind === "stroke") { draft.tool = m.tool; draft.width = m.width; draft.stamp = false; }
      } else {
        // TRANSFORM starts from the complementary colour.
        const hsv = hexToHsv(m.col);
        if (m.dark) setColourHSV(draft.h, 0.06, 0.95);
        else setColourHSV(hsv.h + 180, Math.max(0.6, hsv.s), 1);
      }
    }
    function startSelect() {
      S.pickStack = null; S.pickIndex = 0; S.pickTap = null;
      setPhase("select");
    }
    function useLink() {
      const t = S.pickStack && S.pickStack[S.pickIndex];
      if (!t) return;
      S.link = { c: t.c, m: t.m };
      S.pickStack = null;
      applyRelationDefaults();
      setPhase("draw");
    }
    function goPreview() {
      if (draft.active) return;
      if (!draft.marks.length) { hint("Draw something first."); return; }
      S.previewNote = null;
      if (S.link && !draft.marks.some((m) => bboxHit(m.bbox, S.link.m.bbox, 18))) {
        S.previewNote = "It doesn't touch the linked mark, so it will land as a new mark.";
      }
      S.lastError = null;
      picker.open = false;
      hideToast();
      setPhase("preview");
      ctx.platform.interact({ type: "preview", marks: draft.marks.length });
    }

    // ---- camera animation ----
    let camAnim = null;
    function animateTo(box) {
      computeFit();
      let tx, ty, ts;
      if (!box) { const t = fitTarget(); ts = t.s; tx = t.x; ty = t.y; }
      else {
        const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
        ts = clampN(Math.min(W / (bw * 2.4), (H * 0.4) / (bh * 2.4)), fitScale, Math.max(fitScale, 2.2));
        tx = (box.x0 + box.x1) / 2;
        ty = (box.y0 + box.y1) / 2 + (H * 0.15) / ts;
      }
      camAnim = { from: { x: cam.x, y: cam.y, s: cam.s }, to: { x: tx, y: ty, s: ts }, t: 0, dur: 420 };
    }
    function focusOn(box) { if (cam.s < fitScale * 1.6) animateTo(box); }

    // =====================================================================
    // 15. Input. DRAW: one finger paints immediately. MOVE (or explore/select):
    //     one finger pans. Two fingers always navigate, and a second finger
    //     arriving drops a just-started stroke so pinches never leave marks.
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
      pointers.set(e.pointerId, { x: p.x, y: p.y });
      camAnim = null;
      if (pointers.size >= 2) {
        if (gesture && gesture.type === "draw") dropActiveStroke(true);
        if (gesture && gesture.type === "stamp") draft.active = null;
        startPinch();
        return;
      }
      if (S.phase === "draw" && !draft.nav && e.button !== 1 && e.button !== 2) {
        if (draft.stamp) startStamp(p);
        else startStroke(p);
      } else {
        gesture = { type: "tap", x: p.x, y: p.y, cx: cam.x, cy: cam.y };
      }
    }, { passive: false });
    ctx.listen(canvas, "pointermove", (e) => {
      const ptr = pointers.get(e.pointerId);
      if (!ptr) return;
      const p = localXY(e);
      ptr.x = p.x; ptr.y = p.y;
      if (!gesture) return;
      if (gesture.type === "pinch") { updatePinch(); return; }
      if (gesture.type === "draw") {
        // coalesced events keep fast strokes smooth on high-rate touchscreens
        const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
        if (list && list.length > 1) for (const ce of list) extendStroke(localXY(ce)); else extendStroke(p);
        return;
      }
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
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.type === "pinch") {
        if (pointers.size < 2) {
          gesture = null;
          // a remaining finger only pans; it never starts a stroke mid-gesture
          if (pointers.size === 1) { const [rest] = pointers.values(); gesture = { type: "pan", x: rest.x, y: rest.y, cx: cam.x, cy: cam.y }; }
        }
        return;
      }
      // A cancelled pointer (system gesture, palm) keeps what was drawn: losing ink is worse.
      if (gesture.type === "draw") { finishStroke(); gesture = null; return; }
      if (gesture.type === "stamp") { if (cancelled) draft.active = null; else finishStamp(); gesture = null; dirty = true; return; }
      if (gesture.type === "tap" && !cancelled) handleTap(gesture.x, gesture.y);
      gesture = null;
    }
    ctx.listen(canvas, "pointerup", (e) => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", (e) => endPointer(e, true));
    ctx.listen(canvas, "lostpointercapture", (e) => endPointer(e, true));
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
      cam.s = clampN(g0.s * (d / gesture.d0), fitScale * 0.6, 7);
      cam.x = wx - (mx - W / 2) / cam.s;
      cam.y = wy - (my - H / 2) / cam.s;
      clampCam();
      invalidateArt(140);
    }
    function zoomAt(sx, sy, k) {
      const w = toWorld(sx, sy);
      cam.s = clampN(cam.s * k, fitScale * 0.6, 7);
      cam.x = w.x - (sx - W / 2) / cam.s;
      cam.y = w.y - (sy - H / 2) / cam.s;
      clampCam();
      invalidateArt(160);
    }

    // ---- taps: select / inspect / dig through layers ----
    function handleTap(sx, sy) {
      const w = toWorld(sx, sy);
      const tol = 10 / cam.s;
      if (S.phase === "select") {
        const sameSpot = S.pickTap && Math.hypot(S.pickTap.x - sx, S.pickTap.y - sy) < 14;
        if (sameSpot && S.pickStack && S.pickStack.length > 1) S.pickIndex = (S.pickIndex + 1) % S.pickStack.length;
        else { S.pickStack = marksAt(w.x, w.y, tol); S.pickIndex = 0; }
        S.pickTap = { x: sx, y: sy };
        if (S.pickStack.length) haptic("light");
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

    // ---- drawing (the draft layer only) ----
    function clampToSection(w) {
      const b = sectionBounds();
      return { x: clampN(w.x, b.x0, b.x1), y: clampN(w.y, b.y0, b.y1) };
    }
    function canStartMark() {
      if (draft.marks.length >= CFG.maxMarks) { hint(`That's all ${CFG.maxMarks} marks. Preview it.`, 1600); haptic("warning"); return false; }
      if (draft.usedMs >= CFG.drawMs) { hint("Out of ink. Preview it.", 1600); haptic("warning"); return false; }
      return true;
    }
    function startStroke(p) {
      if (!canStartMark()) { gesture = null; return; }
      const w = clampToSection(toWorld(p.x, p.y));
      const pts = [];
      // CONTINUE (only when linked): a stroke that starts close to the mark grows out of it.
      if (S.link && S.relation === "c" && !draft.marks.some((m) => bboxHit(m.bbox, S.link.m.bbox, 18))) {
        const anchor = nearestOnMark(S.link.m, w.x, w.y);
        if (anchor && Math.hypot(anchor.x - w.x, anchor.y - w.y) * cam.s < 70) pts.push(anchor);
      }
      pts.push(w);
      draft.active = { kind: "stroke", tool: draft.tool, col: draft.col, width: draft.width, pts };
      gesture = { type: "draw", last: p, cur: w, sprayAcc: 0 };
      hidePrompt();
      dirty = true;
      updateMeter();
    }
    function extendStroke(p) {
      if (!draft.active || !gesture) return;
      const w = clampToSection(toWorld(p.x, p.y));
      gesture.cur = w;
      if (draft.active.tool === TOOL.SPRAY) { dirty = true; return; } // spray samples on time
      const last = gesture.last;
      if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      gesture.last = p;
      draft.active.pts.push(w);
      if (draft.active.pts.length > 900) finishStroke();
      dirty = true;
    }
    function dropActiveStroke(byPinch) {
      // A second finger arrived: keep a deliberate stroke, drop an accidental touch.
      const a = draft.active;
      draft.active = null;
      if (a && (!byPinch || a.pts.length > 12)) commitMark(a);
      dirty = true;
      updateMeter();
    }
    function finishStroke() {
      const a = draft.active;
      draft.active = null;
      if (gesture && gesture.type === "draw") gesture = null;
      if (!a) return;
      if (a.tool !== TOOL.SPRAY) a.pts = simplify(a.pts, 0.8 / cam.s);
      commitMark(a);
    }
    // Adds a finished mark to the DRAFT (never to the committed canvas).
    function commitMark(raw) {
      const m = prepareMark({ ...raw }, draft.id, draft.marks.length);
      draft.marks.push(m);
      fitBudget();
      ctx.platform.interact({ type: "mark", kind: raw.kind });
      dirty = true;
      updateMeter();
    }
    // Re-simplify progressively until the contribution fits one world mutation.
    function draftBytes() { return JSON.stringify({ id: draft.id, object: wireFromDraft() }).length; }
    function fitBudget() {
      let tol = 1.2, guard = 0;
      while (draftBytes() > CFG.mutationBudget && guard++ < 10) {
        tol *= 1.6;
        draft.marks = draft.marks.map((m, i) => m.kind !== "stroke" ? m
          : prepareMark({ ...m, pts: m.tool === TOOL.SPRAY ? decimate(m.pts) : simplify(m.pts, tol) }, draft.id, i));
      }
      let trimmed = false;
      while (draftBytes() > CFG.mutationBudget && draft.marks.length) {
        const i = draft.marks.length - 1, last = draft.marks[i];
        trimmed = true;
        if (last.kind === "stroke" && last.pts.length > 2) draft.marks[i] = prepareMark({ ...last, pts: last.pts.slice(0, Math.floor(last.pts.length * 0.8)) }, draft.id, i);
        else draft.marks.pop();
      }
      if (trimmed) hint("Out of room — this contribution is full.", 1600);
    }
    function startStamp(p) {
      if (!canStartMark()) { gesture = null; return; }
      const w = clampToSection(toWorld(p.x, p.y));
      draft.active = { kind: "stamp", style: STYLE_FOR_TOOL[draft.tool], col: draft.col, shape: draft.shape, x: w.x, y: w.y, r: STAMP_SIZES[draft.width] / Math.max(0.6, Math.min(1.6, cam.s / fitScale)), a: Math.floor(Math.random() * 360) };
      draft.active.path = stampPath(draft.active, draft.id, draft.marks.length);
      draft.active.dark = luminance(draft.col) < 0.1;
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
      a.x = Math.round(a.x); a.y = Math.round(a.y); a.r = Math.round(clampN(a.r, 4, 400)); a.a = Math.round(a.a) % 360;
      draft.usedMs = Math.min(CFG.drawMs, draft.usedMs + CFG.stampCostMs);
      commitMark(a);
      haptic("light");
      sting("tap");
    }

    // =====================================================================
    // 16. Submission: draft -> validate -> world mutation -> committed layer.
    //     The draft is cleared only after the world accepts it.
    // =====================================================================
    function wireFromDraft() {
      const linked = S.link && draft.marks.some((m) => bboxHit(m.bbox, S.link.m.bbox, 18));
      const w = { v: SCHEMA_VERSION, i: draft.id, m: linked ? S.relation : "a", t: Math.floor(Date.now() / 1000), k: encodeMarks(draft.marks) };
      if (linked) w.p = S.link.c.id;
      return w;
    }
    let submitWire = null;
    const pendingVerify = new Set();
    async function submitDraft() {
      if (S.phase === "submitting") return; // double-tap guard
      if (!remaining() || !draft.marks.length) return;
      const id = draft.id;
      // Reuse the exact same object on retry so a lost response can't create a second contribution.
      if (!submitWire || submitWire.id !== id) submitWire = { id, object: wireFromDraft() };
      const check = decodeContribution(id, submitWire.object, null);
      if (!check || JSON.stringify(submitWire).length > 1024) { S.lastError = "That mark couldn't be packed. Edit it and try fewer strokes."; renderBottom(); return; }
      S.phase = "submitting";
      S.lastError = null;
      renderBottom();
      let result;
      try {
        result = await repo.append(id, submitWire.object);
      } catch (err) {
        if (destroyed) return;
        DIAG.lastMutate = "threw " + String((err && (err.code || err.message)) || err).slice(0, 60);
        failSubmit(err);
        try { ctx.platform.error({ stage: "submit", code: err && err.code, message: String(err && err.message || err) }); } catch (e) { /* ignore */ }
        return;
      }
      if (destroyed) return;
      DIAG.lastMutate = result && typeof result === "object" ? "ok {" + Object.keys(result).slice(0, 5).join(",") + "}" : "ok " + typeof result;
      if (mutationRejected(result)) { DIAG.lastMutate = "rejected " + JSON.stringify(result).slice(0, 80); failSubmit(result); return; }
      accepted(id, submitWire.object, result);
    }
    function failSubmit(err) {
      // The draft stays exactly as it was; nothing is shown as committed.
      S.phase = "preview";
      S.lastError = errorCopy(err);
      haptic("error");
      renderBottom();
      renderDiag();
    }
    function errorCopy(err) {
      const code = String((err && (err.code || err.reason || err.status)) || "").toLowerCase();
      const msg = String((err && (err.message || err.error)) || "").toLowerCase();
      if (code.includes("rate") || code === "429" || msg.includes("rate")) return "You've reached today's limit. Your draft is kept — the canvas will be here tomorrow.";
      if (code.includes("size") || code.includes("payload") || msg.includes("too large")) return "That mark is too big to store. Edit it and try fewer strokes.";
      if (code.includes("full") || msg.includes("snapshot")) return "The canvas is full for now. Your draft is kept.";
      return "It didn't land — nothing was saved. Your draft is kept; try again.";
    }
    function accepted(id, object, result) {
      const meta = { seq: null, time: null, index: model.ordered.length };
      if (result && typeof result === "object") {
        const seq = [result.seq, result.sequence, result.revision, result.version].find((v) => Number.isFinite(v));
        if (Number.isFinite(seq)) meta.seq = seq;
      }
      const levelBefore = unlockedLevel(model.ordered.length);
      mergeEntries([{ id, object, meta }]);
      const c = model.byId.get(id);
      if (repo.kind === "shared") pendingVerify.add(id);
      mine.add(id);
      sset("uc_mine", [...mine].slice(-60));
      tut.contributed += 1;
      sset("uc_contrib_count", tut.contributed);
      S.submittedThisVisit += 1;
      // The draft's contents now live in the committed layer, so the draft can go.
      submitWire = null;
      draft.marks = [];
      draft.active = null;
      draft.id = null;
      const mode = object.m;
      S.link = null;
      S.previewNote = null;
      picker.open = false;
      setPhase("explore");
      updateCount();
      if (c) {
        const ctr = toScreen((c.bbox.x0 + c.bbox.x1) / 2, (c.bbox.y0 + c.bbox.y1) / 2);
        try { ctx.fx.ripple({ x: ctr.x, y: ctr.y, color: visibleOnDark(c.marks[0].col), radius: 90, durationMs: 700 }); } catch (e) { /* fx optional */ }
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
      // pick up anything others placed meanwhile, the authoritative order, and verify
      ctx.timeout(() => refresh(), 600);
    }

    // =====================================================================
    // 17. History: reversible, never touches the canonical list
    // =====================================================================
    function openHistory() {
      if (S.phase !== "explore") return;
      hidePrompt();
      tut.sawHistory = true;
      sset("uc_saw_history", true);
      S.history.limit = model.ordered.length;
      S.history.inspect = null;
      S.history.playing = false;
      setPhase("history");
      ctx.platform.interact({ type: "history_open" });
    }
    function closeHistory() {
      S.history.playing = false;
      S.history.inspect = null;
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
    // 18. Main render: background + committed art (cached), then the draft.
    // =====================================================================
    function drawFrame(timeMs) {
      const s = backingScale();
      const moving = camAnim || (gesture && (gesture.type === "pan" || gesture.type === "pinch"));
      if (art && artDirty && !moving) renderArt(false);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      const fresh = artView && artView.x === cam.x && artView.y === cam.y && artView.s === cam.s && artView.W === W && artView.H === H && artView.bw === canvas.width && artView.bh === canvas.height;
      if (!art) {
        renderArt(true);
      } else if (fresh) {
        g.drawImage(art, 0, 0);
      } else if (artView && moving) {
        // While moving, reuse the last render under a transform; re-render when the view settles.
        g.fillStyle = OUTSIDE;
        g.fillRect(0, 0, canvas.width, canvas.height);
        const k = cam.s / artView.s;
        const ox = W / 2 + (artView.x - cam.x) * cam.s - (artView.W / 2) * k;
        const oy = H / 2 + (artView.y - cam.y) * cam.s - (artView.H / 2) * k;
        g.setTransform(s * k, 0, 0, s * k, s * ox, s * oy);
        g.drawImage(art, 0, 0, artView.bw / s, artView.bh / s);
      } else {
        // view or backing size changed without a gesture: rebuild the committed layer now
        renderArt(false);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(art, 0, 0);
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

      if (S.phase === "select" && S.pickStack && S.pickStack[S.pickIndex]) outlineMark(g, S.pickStack[S.pickIndex].m, pulse);
      if (S.phase === "draw" && S.link) {
        if (S.relation === "t") spotlight(S.link.m.bbox);
        outlineMark(g, S.link.m, pulse);
        if (S.relation === "c") drawHandles(S.link.m, pulse);
      }

      // --- the draft, always above the committed artwork ---
      if (draft.marks.length || draft.active) {
        for (const m of draft.marks) drawMark(g, m, 1);
        const a = draft.active;
        if (a) {
          if (a.kind === "stroke") {
            const w = WIDTHS[a.width];
            a.dark = luminance(a.col) < 0.1;
            if (a.tool === TOOL.SPRAY) a.path = sprayPath(a.pts, w, draft.id + ":" + draft.marks.length);
            else if (a.tool === TOOL.RIBBON) { const rb = ribbonPaths(a.pts, w); a.path = rb.fill; a.edge = rb.edge; }
            else a.path = strokePath(a.pts);
          }
          drawMark(g, a, 1);
        }
        if (S.phase === "draw" && draft.marks.length) {
          // a faint dashed frame marks the work as an unsubmitted draft (hidden in preview)
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
      if (CFG.grain > 0 && !grainPattern) buildGrain();
      if (CFG.grain > 0 && grainPattern && grainPattern !== "none") {
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
        gg.lineWidth = WIDTHS[m.width] * 1.4 + 10 / cam.s;
        gg.globalAlpha = 0.18;
        gg.setLineDash([]);
        gg.stroke(m.tool === TOOL.SPRAY || m.tool === TOOL.RIBBON ? strokePath(m.pts) : m.path);
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
      for (const p of [m.pts[0], m.pts[m.pts.length - 1]]) {
        g.beginPath();
        g.arc(p.x, p.y, (7 + pulse * 4) / cam.s, 0, Math.PI * 2);
        g.strokeStyle = visibleOnDark(m.col);
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
      grad.addColorStop(1, "rgba(3,4,5,0.5)");
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
    function drawLooseEnds(pulse) {
      if (!looseCache) looseCache = looseEnds();
      for (const e of looseCache) {
        g.beginPath();
        g.arc(e.p.x, e.p.y, (4 + pulse * 5) / cam.s, 0, Math.PI * 2);
        g.strokeStyle = visibleOnDark(e.m.col);
        g.globalAlpha = 0.35 + pulse * 0.4;
        g.lineWidth = 1.5 / cam.s;
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // =====================================================================
    // 19. Loop. Repaints whenever anything changed, while anything animates, and
    //     on a slow heartbeat so a host-side canvas clear can never stick.
    // =====================================================================
    let lastMeter = 0, lastPaint = 0, lastBacking = "";
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
        if (S.phase === "draw" && draft.active && draft.active.kind === "stroke" && gesture && gesture.type === "draw") {
          draft.usedMs += dtMs;
          if (draft.active.tool === TOOL.SPRAY) {
            gesture.sprayAcc += dtMs;
            while (gesture.sprayAcc >= CFG.sprayEveryMs) { gesture.sprayAcc -= CFG.sprayEveryMs; draft.active.pts.push({ x: gesture.cur.x, y: gesture.cur.y }); }
            dirty = true;
          }
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
          const lab = ui.querySelector('[data-r="hlabel"]');
          if (lab) lab.textContent = historyLabel();
        }
      },
      render(alpha, st) {
        const backing = canvas.width + "x" + canvas.height;
        if (backing !== lastBacking) { lastBacking = backing; artDirty = true; dirty = true; }
        const animated = (S.phase === "explore" && !S.inspect && looseCache && looseCache.length) || S.link || S.inspect || S.history.inspect || (S.phase === "select" && S.pickStack);
        if (!dirty && !animated && st.timeMs - lastPaint < 500) return;
        dirty = false;
        lastPaint = st.timeMs;
        drawFrame(st.timeMs);
      }
    });

    // =====================================================================
    // 20. Resize, lifecycle, sync
    // =====================================================================
    let firstLayout = true;
    ctx.onResize((info) => {
      W = info.width; H = info.height; SAFE = info.safeArea || SAFE;
      layoutUI();
      computeFit();
      if (firstLayout) { firstLayout = false; fitView(); } else clampCam();
      vignette = null;
      invalidateArt();
    }, { immediate: true });

    let refreshing = false;
    async function refresh() {
      if (refreshing || destroyed || !repo || repo.kind !== "shared") return;
      refreshing = true;
      try {
        const entries = await repo.load();
        if (destroyed) return;
        DIAG.load = `ok · ${entries.length} entries · ${new Date().toLocaleTimeString()}`;
        // verify our own accepted writes actually appear in the authoritative snapshot
        if (pendingVerify.size) {
          const ids = new Set(entries.map((e) => (e.object && e.object.i) || e.id));
          for (const id of [...pendingVerify]) {
            if (ids.has(id)) { pendingVerify.delete(id); DIAG.verify = "last mark confirmed in snapshot"; }
            else { DIAG.verify = "last mark NOT found in snapshot"; try { ctx.platform.error({ stage: "verify", message: "accepted contribution missing from world snapshot" }); } catch (e) { /* ignore */ } }
          }
        }
        const levelBefore = unlockedLevel(model.ordered.length);
        const fresh = mergeEntries(entries);
        if (fresh.length) {
          if (S.phase === "history") {
            if (S.history.limit === model.ordered.length - fresh.length) setHistoryLimit(model.ordered.length);
            renderBottom();
          }
          // other people's marks arriving: a quiet ripple where each one landed
          for (const c of fresh.slice(-4)) {
            if (mine.has(c.id)) continue;
            const ctr = toScreen((c.bbox.x0 + c.bbox.x1) / 2, (c.bbox.y0 + c.bbox.y1) / 2);
            try { ctx.fx.ripple({ x: ctr.x, y: ctr.y, color: "rgba(237,239,242,0.5)", radius: 50, durationMs: 900 }); } catch (e) { /* optional */ }
          }
          if (unlockedLevel(model.ordered.length) > levelBefore && S.phase === "explore") animateTo(null);
        }
        updateCount();
        renderDiag();
      } catch (err) {
        DIAG.load = "refresh failed: " + String((err && (err.code || err.message)) || err).slice(0, 60);
        renderDiag();
      } finally {
        refreshing = false;
      }
    }

    async function loadCanvas() {
      if (repo) {
        try {
          const entries = await repo.load();
          if (destroyed) return;
          mergeEntries(entries);
          S.connection = "shared";
          DIAG.repo = "shared world";
          DIAG.load = `ok · ${entries.length} entries`;
        } catch (err) {
          if (destroyed) return;
          try { ctx.platform.error({ stage: "load", code: err && err.code, message: String(err && err.message || err) }); } catch (e) { /* ignore */ }
          DIAG.load = "failed: " + String((err && (err.code || err.message)) || err).slice(0, 60);
          repo = null;
        }
      }
      if (!repo) {
        // Shared world unreachable: fall back, clearly labelled, to marks that stay
        // on this device (or only for this visit if storage isn't available either).
        const saved = await sgetA("uc_local_world_v2", []);
        repo = createLocalRepo(saved);
        S.connection = "local";
        DIAG.repo = "local fallback";
        mergeEntries(await repo.load());
        hint(storageOk ? "Shared canvas unavailable — marks stay on this device." : "Shared canvas unavailable — marks last for this visit only.", 2800);
      }
      if (S.phase === "loading") S.phase = "explore";
      updateCount();
      fitView();
      renderBottom();
    }

    ctx.interval(() => { if (S.phase !== "submitting") refresh(); }, CFG.refreshMs);
    ctx.listen(document, "visibilitychange", () => { if (!document.hidden) { dirty = true; artDirty = true; refresh(); } });

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

    // viewer-local conveniences (sync or async storage, never blocking the frame)
    visits = (Number(await sgetA("uc_visits", 0)) || 0) + 1;
    sset("uc_visits", visits);
    storageOk = Number(await sgetA("uc_visits", 0)) === visits;
    mine = new Set([].concat(await sgetA("uc_mine", [])).filter((x) => typeof x === "string"));
    tut.contributed = Number(await sgetA("uc_contrib_count", 0)) || 0;
    tut.sawHistory = !!(await sgetA("uc_saw_history", false));
    if (destroyed) return;

    await loadCanvas();
    if (destroyed) return;
    showPrompt(visits === 1
      ? `<b>Everyone leaves a mark</b>Nobody gets the last word.`
      : `<b>Today</b>${esc(prompt)}`, 9000);
  }
};
