window.plethoraBit = {
  meta: {
    title: "Daily Collective Canvas",
    runtime: "plethora-bit@2",
    tags: ["art", "shared", "multiplayer", "drawing"],
    permissions: ["haptics", "storage"]
  },

  async init(ctx) {
    // =====================================================================
    // Constants
    // =====================================================================
    const TZ = "Asia/Kolkata";          // product timezone for the daily canvas
    const W = 1000, H = 1250;           // canonical canvas units (4:5); all geometry is stored in these
    const SCHEMA = 1;
    const WORLD = "canvas";             // manifest.memory.worlds channel
    const MAX_MUTATION_BYTES = 1000;    // schema limit is 1024 for the whole mutation
    const POLL_MS = 4000;
    const POLL_MAX_MS = 30000;
    const COOLDOWN_MS = 4000;
    const DAILY_LIMIT = 40;             // mirrors the manifest rate_limit rule
    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const ID_RE = /^(\d{4}-\d{2}-\d{2})_([a-z0-9]{6,12})_([a-z0-9]{1,8})$/;

    const PAPER = "#f6f1e6";
    const PALETTE = [
      { hex: "#2b3ff5", name: "ultramarine" },
      { hex: "#ffcc1a", name: "cadmium yellow" },
      { hex: "#f2421b", name: "vermilion" },
      { hex: "#ff5fa2", name: "hot pink" },
      { hex: "#0f8a6a", name: "viridian" },
      { hex: "#8fe3c4", name: "mint" },
      { hex: "#6a3cc9", name: "violet" },
      { hex: "#c98a1b", name: "ochre" },
      { hex: "#16130f", name: "ink" },
      { hex: "#fbf8f1", name: "paper white" }
    ];
    const PALETTE_SET = new Set(PALETTE.map(p => p.hex));

    const KINDS = {
      add: ["brush", "ellipse", "rect", "poly", "blob", "line", "arc", "dots", "stamp"],
      con: ["echo", "connect", "react"],
      tf: ["tint", "mask", "shift", "texture"]
    };
    const VARIANTS = {
      brush: ["ink", "chalk", "dotted"],
      shape: ["fill", "outline"],
      line: ["line", "arc"],
      dots: ["scatter", "ring", "row"],
      stamp: ["eye", "sun", "spiral", "leaf", "moon", "star", "zigzag", "flower"],
      echo: ["x2", "x3", "x5"],
      connect: ["thread", "vine", "dotted"],
      react: ["halo", "rays", "orbit", "frame"],
      tint: ["multiply", "screen", "color"],
      mask: ["cut", "window"],
      shift: ["ghost"],
      texture: ["hatch", "halftone", "stripes"]
    };
    const PROMPTS = [
      "something that orbits", "a door left open", "weather", "two things touching",
      "a map of nowhere", "what grows at night", "a loud colour", "an echo",
      "a quiet corner", "a creature made of parts", "the shape of a sound", "tangles",
      "a window", "migration", "a small celebration", "something sinking",
      "borders", "a garden", "noise and calm", "a face you didn't plan"
    ];

    const reduceMotion = (() => {
      try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
    })();

    // =====================================================================
    // Small pure helpers: hashing, seeded random, canonical JSON, dates
    // =====================================================================
    function fnv(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
      return h >>> 0;
    }
    function rng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function canon(v) {
      if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
      if (v && typeof v === "object") {
        return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined)
          .map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
      }
      return JSON.stringify(v);
    }
    // Fields that make up a contribution; the id's checksum covers exactly these.
    const REC_FIELDS = ["v", "d", "k", "s", "vr", "g", "c", "o", "w", "r", "f", "ro", "tg", "p", "t"];
    function checksum(obj) {
      const picked = {};
      for (const k of REC_FIELDS) if (obj[k] !== undefined) picked[k] = obj[k];
      return fnv(canon(picked)).toString(36);
    }
    function nonce() {
      const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
      let s = "";
      const buf = new Uint8Array(10);
      try { crypto.getRandomValues(buf); } catch (e) { for (let i = 0; i < 10; i++) buf[i] = Math.floor(Math.random() * 256); }
      for (let i = 0; i < 10; i++) s += abc[buf[i] % abc.length];
      return s;
    }
    const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    function dateKeyAt(ms) {
      const parts = {};
      for (const p of dateParts.formatToParts(new Date(ms))) parts[p.type] = p.value;
      return parts.year + "-" + parts.month + "-" + parts.day;
    }
    function keyToUTC(key) {
      const [y, m, d] = key.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    }
    function addDays(key, n) {
      const t = new Date(keyToUTC(key) + n * 86400000);
      return t.toISOString().slice(0, 10);
    }
    const prettyFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
    const longFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    function prettyDay(key) { return prettyFmt.format(new Date(keyToUTC(key))); }
    function longDay(key) { return longFmt.format(new Date(keyToUTC(key))); }
    function promptFor(key) { return PROMPTS[fnv("prompt:" + key) % PROMPTS.length]; }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const isNum = v => typeof v === "number" && Number.isFinite(v);
    const inRange = (v, a, b) => isNum(v) && v >= a && v <= b;

    // ---------------------------------------------------------------------
    // Clock: device time corrected by any server time the platform reports.
    // ---------------------------------------------------------------------
    let serverOffset = 0;
    let serverClockSeen = false;
    function now() { return Date.now() + serverOffset; }
    function readServerTime(src) {
      if (!src || typeof src !== "object") return;
      const raw = src.serverTime ?? src.server_time ?? src.now;
      const ms = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
      if (!Number.isFinite(ms)) return;
      const off = ms - Date.now();
      if (Math.abs(off) > 400 * 86400000) return;
      serverOffset = off;
      serverClockSeen = true;
    }

    // =====================================================================
    // Record validation (runs on every record read from the shared world)
    // =====================================================================
    const U_MIN = -250, U_MAX_X = W + 250, U_MAX_Y = H + 250;
    const ux = v => isNum(v) && v >= U_MIN && v <= U_MAX_X;
    const uy = v => isNum(v) && v >= U_MIN && v <= U_MAX_Y;

    function validGeometry(o) {
      const g = o.g, p = o.p;
      switch (o.s) {
        case "brush":
          return g && Array.isArray(g.p) && g.p.length >= 2 && g.p.length <= 400 && g.p.length % 2 === 0 &&
            g.p.every((v, i) => (i % 2 ? uy(v) : ux(v)));
        case "ellipse": case "rect": case "poly": case "blob": case "line":
          return g && ux(g.x0) && uy(g.y0) && ux(g.x1) && uy(g.y1) && (o.s !== "poly" || inRange(g.n, 3, 9));
        case "arc":
          return g && ux(g.x0) && uy(g.y0) && ux(g.x1) && uy(g.y1) && inRange(g.b, -1, 1);
        case "dots":
          return g && ux(g.x) && uy(g.y) && inRange(g.R, 4, 600);
        case "stamp":
          return g && ux(g.x) && uy(g.y) && inRange(g.S, 20, 900) && VARIANTS.stamp.includes(o.vr);
        case "echo":
          return p && inRange(p.dx, -800, 800) && inRange(p.dy, -800, 800) && inRange(p.n, 2, 5) &&
            inRange(p.sc, 0.4, 1.6) && inRange(p.rot, -180, 180);
        case "connect":
          return g && ux(g.x0) && uy(g.y0) && ux(g.x1) && uy(g.y1) && inRange(g.b, -1, 1);
        case "react":
          return g && ux(g.x0) && uy(g.y0) && ux(g.x1) && uy(g.y1);
        case "tint": return true;
        case "mask": return g && ux(g.x) && uy(g.y) && inRange(g.R, 6, 900);
        case "shift":
          return p && inRange(p.dx, -800, 800) && inRange(p.dy, -800, 800) && inRange(p.sc, 0.4, 1.6) && inRange(p.rot, -180, 180);
        case "texture": return true;
      }
      return false;
    }

    // Structural checks on a single record. Relationship checks happen later
    // once every record of the day is known.
    function sanitize(id, o) {
      if (typeof id !== "string" || !o || typeof o !== "object") return null;
      const m = ID_RE.exec(id);
      if (!m) return null;
      if (o.v !== SCHEMA || o.d !== m[1] || !DAY_RE.test(o.d)) return null;
      if (checksum(o) !== m[3]) return null;               // tampered or overwritten record
      if (!KINDS[o.k] || !KINDS[o.k].includes(o.s)) return null;
      if (!PALETTE_SET.has(o.c)) return null;
      if (!inRange(o.o, 0.05, 1) || !inRange(o.w, 1, 100) || !inRange(o.r ?? 0, -180, 180)) return null;
      if (!isNum(o.t)) return null;
      const tg = o.tg == null ? [] : o.tg;
      if (!Array.isArray(tg) || tg.length > 2 || !tg.every(t => typeof t === "string" && ID_RE.test(t))) return null;
      if (o.k === "add" && tg.length) return null;
      if (o.k !== "add" && tg.length < 1) return null;
      if (o.k === "tf" && tg.length !== 1) return null;
      if (o.s !== "connect" && tg.length > 1) return null;
      if (o.vr != null) {
        const fam = familyOf(o.s);
        if (!VARIANTS[fam] || !VARIANTS[fam].includes(o.vr)) return null;
      }
      if (!validGeometry(o)) return null;
      return {
        id, v: o.v, d: o.d, k: o.k, s: o.s, vr: o.vr ?? null, g: o.g ?? null, c: o.c, o: o.o, w: o.w,
        r: o.r ?? 0, f: o.f ? 1 : 0, ro: o.ro ? 1 : 0, tg, p: o.p ?? null, t: o.t, seed: fnv(id)
      };
    }
    function familyOf(s) {
      if (s === "ellipse" || s === "rect" || s === "poly" || s === "blob") return "shape";
      if (s === "arc") return "line";
      return s;
    }

    // Relationship checks: targets exist, live on the same day, are not
    // transformations, and no reference chain loops back on itself.
    function resolveRelations(map) {
      const ok = new Map();
      const state = new Map(); // id -> 1 visiting, 2 good, 3 bad
      function visit(id, depth) {
        const st = state.get(id);
        if (st === 2) return true;
        if (st === 3 || st === 1 || depth > 24) return false;
        const rec = map.get(id);
        if (!rec) return false;
        state.set(id, 1);
        let good = true;
        for (const t of rec.tg) {
          const tr = map.get(t);
          if (!tr || tr.d !== rec.d || tr.k === "tf" || t === id || !visit(t, depth + 1)) { good = false; break; }
        }
        state.set(id, good ? 2 : 3);
        return good;
      }
      for (const id of map.keys()) if (visit(id, 0)) ok.set(id, map.get(id));
      return ok;
    }

    const LAYER = { add: 0, con: 1, tf: 2 };
    function compareRecs(a, b) {
      return (LAYER[a.k] - LAYER[b.k]) || (a.seq - b.seq) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    // =====================================================================
    // Geometry: every mark resolves to primitives in canvas units
    //   { t:"poly", pts:[x,y,...], closed, fill, stroke, lw, smooth, dash, rough }
    //   { t:"circ", x, y, r, fill, stroke, lw }
    // =====================================================================
    function rotPts(pts, cx, cy, deg) {
      if (!deg) return pts;
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const out = new Array(pts.length);
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - cx, dy = pts[i + 1] - cy;
        out[i] = cx + dx * ca - dy * sa;
        out[i + 1] = cy + dx * sa + dy * ca;
      }
      return out;
    }
    function ellipsePts(cx, cy, rx, ry, n) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      }
      return pts;
    }
    function quadPts(x0, y0, cx, cy, x1, y1, n) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
      }
      return pts;
    }
    function bendControl(x0, y0, x1, y1, b) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      return [mx - (dy / len) * b * len * 0.6, my + (dx / len) * b * len * 0.6];
    }
    const strokeW = w => 2 + w * 0.6;   // size slider -> stroke width in units

    const MOTIFS = {
      eye(lw) {
        const top = quadPts(-0.5, 0, 0, -0.42, 0.5, 0, 16), bot = quadPts(0.5, 0, 0, 0.42, -0.5, 0, 16);
        return [
          { t: "poly", pts: top.concat(bot.slice(2)), closed: true, stroke: true, lw },
          { t: "circ", x: 0, y: 0, r: 0.16, stroke: true, lw },
          { t: "circ", x: 0, y: 0, r: 0.07, fill: true }
        ];
      },
      sun(lw) {
        const prims = [{ t: "circ", x: 0, y: 0, r: 0.2, fill: true }];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2, r0 = 0.27, r1 = i % 2 ? 0.4 : 0.5;
          prims.push({ t: "poly", pts: [Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1], stroke: true, lw });
        }
        return prims;
      },
      spiral(lw) {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const a = i * 0.32, r = 0.48 * (i / 64);
          pts.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        return [{ t: "poly", pts, stroke: true, lw, smooth: true }];
      },
      leaf(lw) {
        const a = quadPts(0, -0.5, 0.42, 0, 0, 0.5, 14), b = quadPts(0, 0.5, -0.42, 0, 0, -0.5, 14);
        return [
          { t: "poly", pts: a.concat(b.slice(2)), closed: true, stroke: true, lw },
          { t: "poly", pts: [0, -0.42, 0, 0.5], stroke: true, lw },
          { t: "poly", pts: [0, -0.1, 0.17, -0.25, 0, 0.1, -0.17, -0.05, 0, 0.28, 0.16, 0.14], stroke: true, lw: lw * 0.7 }
        ];
      },
      moon() {
        const outer = [], inner = [];
        for (let i = 0; i <= 24; i++) {
          const a = -Math.PI / 2 + (i / 24) * Math.PI;
          outer.push(Math.cos(a) * 0.45, Math.sin(a) * 0.45);
        }
        for (let i = 24; i >= 0; i--) {
          const a = -Math.PI / 2 + (i / 24) * Math.PI;
          inner.push(Math.cos(a) * 0.2, Math.sin(a) * 0.45);
        }
        return [{ t: "poly", pts: outer.concat(inner), closed: true, fill: true }];
      },
      star() {
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.2 : 0.5;
          pts.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        return [{ t: "poly", pts, closed: true, fill: true }];
      },
      zigzag(lw) {
        const pts = [];
        for (let i = 0; i <= 8; i++) pts.push(-0.5 + i / 8, i % 2 ? -0.22 : 0.22);
        const pts2 = pts.map((v, i) => (i % 2 ? v + 0.18 : v));
        return [{ t: "poly", pts, stroke: true, lw }, { t: "poly", pts: pts2, stroke: true, lw: lw * 0.6 }];
      },
      flower(lw) {
        const prims = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          prims.push({ t: "circ", x: Math.cos(a) * 0.29, y: Math.sin(a) * 0.29, r: 0.17, stroke: true, lw });
        }
        prims.push({ t: "circ", x: 0, y: 0, r: 0.12, fill: true });
        return prims;
      }
    };

    function bboxPts(x0, y0, x1, y1) {
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.abs(x1 - x0) / 2, hh: Math.abs(y1 - y0) / 2 };
    }

    // Primitive cache keyed by record id (records are immutable).
    const primCache = new Map();
    function primsOf(rec, lookup, depth) {
      if (rec.id && primCache.has(rec.id)) return primCache.get(rec.id);
      const prims = buildPrims(rec, lookup, depth || 0);
      if (rec.id && !rec.draft) primCache.set(rec.id, prims);
      return prims;
    }

    function buildPrims(rec, lookup, depth) {
      if (depth > 6) return [];
      const g = rec.g, rnd = rng(rec.seed || 1), lw = strokeW(rec.w), rough = !!rec.ro;
      switch (rec.s) {
        case "brush": {
          const pts = g.p.slice();
          if (pts.length === 2) pts.push(pts[0] + 0.5, pts[1] + 0.5);
          if (rec.vr === "chalk") {
            const out = [];
            for (let k = 0; k < 3; k++) {
              const ox = (rnd() - 0.5) * lw * 0.7, oy = (rnd() - 0.5) * lw * 0.7;
              out.push({ t: "poly", pts: pts.map((v, i) => v + (i % 2 ? oy : ox)), stroke: true, lw: Math.max(1.5, lw * 0.32), smooth: true, rough: true, alpha: 0.75 });
            }
            return out;
          }
          if (rec.vr === "dotted") return [{ t: "poly", pts, stroke: true, lw, smooth: true, dash: [0.01, lw * 1.7] }];
          return [{ t: "poly", pts, stroke: true, lw, smooth: true, rough }];
        }
        case "ellipse": case "rect": case "poly": case "blob": {
          const b = bboxPts(g.x0, g.y0, g.x1, g.y1);
          let pts;
          if (rec.s === "ellipse") pts = ellipsePts(b.cx, b.cy, Math.max(b.hw, 2), Math.max(b.hh, 2), 56);
          else if (rec.s === "rect") pts = [b.cx - b.hw, b.cy - b.hh, b.cx + b.hw, b.cy - b.hh, b.cx + b.hw, b.cy + b.hh, b.cx - b.hw, b.cy + b.hh];
          else if (rec.s === "poly") {
            pts = [];
            for (let i = 0; i < g.n; i++) {
              const a = -Math.PI / 2 + (i / g.n) * Math.PI * 2;
              pts.push(b.cx + Math.cos(a) * b.hw, b.cy + Math.sin(a) * b.hh);
            }
          } else {
            pts = [];
            const n = 9 + Math.floor(rnd() * 5);
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2, f = 0.62 + rnd() * 0.5;
              pts.push(b.cx + Math.cos(a) * b.hw * f, b.cy + Math.sin(a) * b.hh * f);
            }
          }
          pts = rotPts(pts, b.cx, b.cy, rec.r);
          const fill = rec.f === 1;
          return [{ t: "poly", pts, closed: true, fill, stroke: !fill, lw, smooth: rec.s === "blob", rough }];
        }
        case "line":
          return [{ t: "poly", pts: [g.x0, g.y0, g.x1, g.y1], stroke: true, lw, rough }];
        case "arc": {
          const [cx, cy] = bendControl(g.x0, g.y0, g.x1, g.y1, g.b);
          return [{ t: "poly", pts: quadPts(g.x0, g.y0, cx, cy, g.x1, g.y1, 28), stroke: true, lw, rough }];
        }
        case "dots": {
          const n = clamp(Math.round(g.R / 11), 4, 36), dr = 2 + rec.w * 0.3, prims = [];
          for (let i = 0; i < n; i++) {
            let x, y;
            if (rec.vr === "ring") {
              const a = (i / n) * Math.PI * 2;
              x = g.x + Math.cos(a) * g.R; y = g.y + Math.sin(a) * g.R;
            } else if (rec.vr === "row") {
              x = g.x - g.R + (2 * g.R * (i + 0.5)) / n; y = g.y;
            } else {
              const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * g.R;
              x = g.x + Math.cos(a) * d; y = g.y + Math.sin(a) * d;
            }
            const p = rotPts([x, y], g.x, g.y, rec.r);
            prims.push({ t: "circ", x: p[0], y: p[1], r: dr * (rec.vr === "scatter" || !rec.vr ? 0.55 + rnd() * 0.8 : 1), fill: true });
          }
          return prims;
        }
        case "stamp": {
          const make = MOTIFS[rec.vr] || MOTIFS.star;
          const lwU = (0.012 + rec.w * 0.0009); // stroke relative to stamp size
          return transformPrims(make(lwU), 0, 0, g.S, rec.r, g.x, g.y, rough);
        }
        case "echo": {
          const target = lookup(rec.tg[0]);
          if (!target) return [];
          const base = primsOf(target, lookup, depth + 1);
          const bb = boundsOfPrims(base);
          const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, p = rec.p, out = [];
          for (let i = 1; i <= p.n; i++) {
            const sc = Math.pow(p.sc, i);
            out.push(...transformPrims(base, cx, cy, sc, p.rot * i, cx + p.dx * i, cy + p.dy * i, false, true));
          }
          return out;
        }
        case "connect": {
          const [cx, cy] = bendControl(g.x0, g.y0, g.x1, g.y1, g.b);
          let pts = quadPts(g.x0, g.y0, cx, cy, g.x1, g.y1, 40);
          const prims = [];
          if (rec.vr === "vine") {
            const amp = 4 + lw * 1.2, waves = Math.max(2, Math.round(Math.hypot(g.x1 - g.x0, g.y1 - g.y0) / 70));
            const out = [];
            for (let i = 0; i < pts.length; i += 2) {
              const j = Math.min(i + 2, pts.length - 2), k = Math.max(i - 2, 0);
              const tx = pts[j] - pts[k], ty = pts[j + 1] - pts[k + 1], tl = Math.hypot(tx, ty) || 1;
              const s = Math.sin((i / 2 / 40) * waves * Math.PI * 2) * amp;
              out.push(pts[i] - (ty / tl) * s, pts[i + 1] + (tx / tl) * s);
            }
            pts = out;
            for (let i = 8; i < pts.length - 4; i += 16) prims.push({ t: "circ", x: pts[i], y: pts[i + 1], r: lw * 0.9, fill: true });
          }
          prims.unshift({ t: "poly", pts, stroke: true, lw: rec.vr === "thread" ? Math.max(1.5, lw * 0.5) : lw, smooth: true, dash: rec.vr === "dotted" ? [0.01, lw * 2] : null });
          prims.push({ t: "circ", x: g.x0, y: g.y0, r: lw * 1.1 + 3, fill: true }, { t: "circ", x: g.x1, y: g.y1, r: lw * 1.1 + 3, fill: true });
          return prims;
        }
        case "react": {
          const b = bboxPts(g.x0, g.y0, g.x1, g.y1), m = 10 + rec.w * 0.9, thin = Math.max(2, lw * 0.35);
          const prims = [];
          if (rec.vr === "rays") {
            const n = 18;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
              const r0x = b.hw + m * 0.35, r0y = b.hh + m * 0.35, len = m * (0.6 + rnd() * 1.2);
              const x0 = b.cx + Math.cos(a) * r0x, y0 = b.cy + Math.sin(a) * r0y;
              prims.push({ t: "poly", pts: [x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len], stroke: true, lw: thin });
            }
          } else if (rec.vr === "orbit") {
            const n = 7;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
              prims.push({ t: "circ", x: b.cx + Math.cos(a) * (b.hw + m), y: b.cy + Math.sin(a) * (b.hh + m), r: 3 + rec.w * (0.12 + rnd() * 0.18), fill: true });
            }
            prims.push({ t: "poly", pts: ellipsePts(b.cx, b.cy, b.hw + m, b.hh + m, 60), closed: true, stroke: true, lw: 1.5, dash: [6, 9] });
          } else if (rec.vr === "frame") {
            const x0 = b.cx - b.hw - m, x1 = b.cx + b.hw + m, y0 = b.cy - b.hh - m, y1 = b.cy + b.hh + m;
            prims.push({ t: "poly", pts: [x0, y0, x1, y0, x1, y1, x0, y1], closed: true, stroke: true, lw: thin * 1.6, rough: true });
          } else {
            for (let i = 1; i <= 3; i++) {
              prims.push({ t: "poly", pts: ellipsePts(b.cx, b.cy, b.hw + m * i * 0.55, b.hh + m * i * 0.55, 64), closed: true, stroke: true, lw: thin * (1.4 - i * 0.3) });
            }
          }
          return prims;
        }
        case "shift": {
          const target = lookup(rec.tg[0]);
          if (!target) return [];
          const base = primsOf(target, lookup, depth + 1), bb = boundsOfPrims(base);
          const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
          return transformPrims(base, cx, cy, rec.p.sc, rec.p.rot, cx + rec.p.dx, cy + rec.p.dy, false, true);
        }
        case "mask":
          return [{ t: "circ", x: rec.g.x, y: rec.g.y, r: rec.g.R, stroke: true, lw: 2 }];
        case "tint": case "texture": {
          const target = lookup(rec.tg[0]);
          return target ? primsOf(target, lookup, depth + 1) : [];
        }
      }
      return [];
    }

    // Scale/rotate primitives around (ox, oy) then move that origin to (tx, ty).
    function transformPrims(prims, ox, oy, sc, deg, tx, ty, rough, keepRough) {
      const a = (deg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const tp = (x, y) => {
        const dx = (x - ox) * sc, dy = (y - oy) * sc;
        return [tx + dx * ca - dy * sa, ty + dx * sa + dy * ca];
      };
      return prims.map(p => {
        if (p.t === "circ") {
          const [x, y] = tp(p.x, p.y);
          return Object.assign({}, p, { x, y, r: p.r * sc, lw: p.lw != null ? p.lw * sc : p.lw });
        }
        const pts = new Array(p.pts.length);
        for (let i = 0; i < p.pts.length; i += 2) {
          const q = tp(p.pts[i], p.pts[i + 1]);
          pts[i] = q[0]; pts[i + 1] = q[1];
        }
        return Object.assign({}, p, { pts, lw: p.lw != null ? p.lw * sc : p.lw, rough: keepRough ? p.rough : (rough || p.rough), dash: p.dash ? p.dash.map(d => d * sc) : p.dash });
      });
    }

    function boundsOfPrims(prims) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of prims) {
        const pad = (p.lw || 0) / 2 + 2;
        if (p.t === "circ") {
          x0 = Math.min(x0, p.x - p.r - pad); x1 = Math.max(x1, p.x + p.r + pad);
          y0 = Math.min(y0, p.y - p.r - pad); y1 = Math.max(y1, p.y + p.r + pad);
        } else {
          for (let i = 0; i < p.pts.length; i += 2) {
            x0 = Math.min(x0, p.pts[i] - pad); x1 = Math.max(x1, p.pts[i] + pad);
            y0 = Math.min(y0, p.pts[i + 1] - pad); y1 = Math.max(y1, p.pts[i + 1] + pad);
          }
        }
      }
      if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
      return { x0, y0, x1, y1 };
    }
    const boundsCache = new Map();
    function boundsOf(rec, lookup) {
      if (!rec.draft && boundsCache.has(rec.id)) return boundsCache.get(rec.id);
      const b = boundsOfPrims(primsOf(rec, lookup));
      if (!rec.draft) boundsCache.set(rec.id, b);
      return b;
    }

    // =====================================================================
    // Canvas drawing
    // =====================================================================
    function tracePoly(g, pts, closed, smooth) {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      if (smooth && pts.length > 4) {
        const n = pts.length / 2;
        for (let i = 1; i < n - 1; i++) {
          const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2, my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
          g.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my);
        }
        if (closed) {
          const mx = (pts[pts.length - 2] + pts[0]) / 2, my = (pts[pts.length - 1] + pts[1]) / 2;
          g.quadraticCurveTo(pts[pts.length - 2], pts[pts.length - 1], mx, my);
          g.quadraticCurveTo(pts[0], pts[1], (pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
        } else {
          g.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
        }
      } else {
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      }
      if (closed) g.closePath();
    }
    // Deterministic wobble so "rough" marks look hand-made but identical everywhere.
    function roughen(pts, closed, amp, rnd) {
      const out = [];
      const n = pts.length / 2, segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const x0 = pts[i * 2], y0 = pts[i * 2 + 1], j = ((i + 1) % n) * 2, x1 = pts[j], y1 = pts[j + 1];
        const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.min(12, Math.round(len / 28)));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          out.push(x0 + (x1 - x0) * t + (rnd() - 0.5) * amp, y0 + (y1 - y0) * t + (rnd() - 0.5) * amp);
        }
      }
      if (!closed) out.push(pts[pts.length - 2] + (rnd() - 0.5) * amp, pts[pts.length - 1] + (rnd() - 0.5) * amp);
      return out;
    }

    function drawPrims(g, prims, color, alpha, seed, solid) {
      const rnd = rng(seed || 7);
      g.fillStyle = color; g.strokeStyle = color;
      g.lineCap = "round"; g.lineJoin = "round";
      for (const p of prims) {
        g.globalAlpha = alpha * (solid ? 1 : (p.alpha ?? 1));
        if (p.t === "circ") {
          g.beginPath();
          g.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2);
          if (p.fill) g.fill();
          if (p.stroke) { g.lineWidth = p.lw || 2; g.stroke(); }
          continue;
        }
        if (p.pts.length < 4) continue;
        g.setLineDash(p.dash || []);
        const passes = p.rough && !solid ? 2 : 1;
        for (let k = 0; k < passes; k++) {
          const pts = p.rough ? roughen(p.pts, !!p.closed, Math.min(9, (p.lw || 4) * 0.5 + 3), rnd) : p.pts;
          tracePoly(g, pts, !!p.closed, p.smooth || p.rough);
          if (p.fill) g.fill();
          if (p.stroke || (p.rough && p.fill && k === 1)) { g.lineWidth = k ? Math.max(1, (p.lw || 3) * 0.45) : (p.lw || 3); g.stroke(); }
          if (k === 0 && passes === 2) g.globalAlpha = alpha * 0.55;
        }
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
    }

    // ---- Offscreen layers for transformations ----
    // Helper bitmaps are OffscreenCanvas. Older WebViews without it get one hidden,
    // runtime-owned Canvas2D surface per purpose, reused and resized.
    const fallbackSurfaces = new Map();
    function makeLayer(w, h, purpose) {
      if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
      const key = purpose || "scratch";
      let c = fallbackSurfaces.get(key);
      if (!c) {
        c = ctx.createCanvas2D({ layer: "background", order: -10, input: "passthrough" });
        c.style.visibility = "hidden";
        fallbackSurfaces.set(key, c);
      }
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      return c;
    }
    let layerPool = null;
    function getLayer(w, h) {
      if (!layerPool || layerPool.width < w || layerPool.height < h) {
        layerPool = makeLayer(Math.max(w, layerPool ? layerPool.width : 0), Math.max(h, layerPool ? layerPool.height : 0), "layer");
      }
      const lg = layerPool.getContext("2d");
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = "source-over";
      lg.globalAlpha = 1;
      lg.clearRect(0, 0, w, h);
      return { canvas: layerPool, g: lg };
    }
    function hatchInto(g, b, spacing, angle, kind, lw) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 4;
      g.save();
      g.translate(cx, cy);
      g.rotate(angle * Math.PI / 180);
      if (kind === "halftone") {
        // One path, one fill: this runs under "source-in" compositing.
        g.beginPath();
        const dr = spacing * 0.28;
        for (let y = -R; y <= R; y += spacing) {
          for (let x = -R + ((Math.round(y / spacing) % 2) ? spacing / 2 : 0); x <= R; x += spacing) {
            g.moveTo(x + dr, y); g.arc(x, y, dr, 0, Math.PI * 2);
          }
        }
        g.fill();
      } else {
        g.lineWidth = kind === "stripes" ? spacing * 0.45 : lw;
        g.beginPath();
        for (let x = -R; x <= R; x += spacing) { g.moveTo(x, -R); g.lineTo(x, R); }
        if (kind === "hatch") for (let y = -R; y <= R; y += spacing * 1.6) { g.moveTo(-R, y); g.lineTo(R, y); }
        g.stroke();
      }
      g.restore();
    }

    // Draw a transformation record onto g (g already maps canvas units -> pixels at scale k).
    function drawTransform(g, k, rec, lookup) {
      const target = lookup(rec.tg[0]);
      if (!target) return;
      if (rec.s === "shift") {
        g.globalCompositeOperation = rec.c === "#fbf8f1" ? "source-over" : "multiply";
        drawPrims(g, primsOf(rec, lookup), rec.c, rec.o, rec.seed);
        g.globalCompositeOperation = "source-over";
        return;
      }
      const tprims = primsOf(target, lookup);
      let b = boundsOfPrims(tprims);
      if (rec.s === "mask" && rec.vr !== "window") {
        b = { x0: Math.max(b.x0, rec.g.x - rec.g.R), y0: Math.max(b.y0, rec.g.y - rec.g.R), x1: Math.min(b.x1, rec.g.x + rec.g.R), y1: Math.min(b.y1, rec.g.y + rec.g.R) };
        if (b.x1 <= b.x0 || b.y1 <= b.y0) return;
      }
      b = { x0: b.x0 - 6, y0: b.y0 - 6, x1: b.x1 + 6, y1: b.y1 + 6 };
      const pw = Math.max(1, Math.ceil((b.x1 - b.x0) * k)), ph = Math.max(1, Math.ceil((b.y1 - b.y0) * k));
      if (pw * ph > 4200000) return;
      const L = getLayer(pw, ph), lg = L.g;
      lg.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
      drawPrims(lg, tprims, "#000", 1, target.seed, true);  // target silhouette
      lg.globalCompositeOperation = "source-in";
      if (rec.s === "tint") {
        lg.fillStyle = rec.c;
        lg.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        g.globalCompositeOperation = rec.vr === "screen" ? "screen" : rec.vr === "color" ? "color" : "multiply";
        g.globalAlpha = rec.o;
      } else if (rec.s === "texture") {
        lg.fillStyle = rec.c; lg.strokeStyle = rec.c;
        hatchInto(lg, b, 6 + rec.w * 0.3, rec.r || 0, rec.vr || "hatch", 1.6 + rec.w * 0.04);
        g.globalCompositeOperation = rec.c === "#fbf8f1" ? "source-over" : "multiply";
        g.globalAlpha = rec.o;
      } else if (rec.s === "mask") {
        lg.fillStyle = PAPER;
        if (rec.vr === "window") {
          lg.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
          lg.globalCompositeOperation = "destination-out";
          lg.beginPath(); lg.arc(rec.g.x, rec.g.y, rec.g.R, 0, Math.PI * 2); lg.fill();
          g.globalAlpha = 0.86 * rec.o + 0.1;
        } else {
          lg.beginPath(); lg.arc(rec.g.x, rec.g.y, rec.g.R, 0, Math.PI * 2); lg.fill();
          g.globalAlpha = rec.o;
        }
        g.globalCompositeOperation = "source-over";
      }
      g.drawImage(L.canvas, 0, 0, pw, ph, b.x0, b.y0, pw / k, ph / k);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    function drawRecord(g, k, rec, lookup) {
      if (rec.k === "tf") return drawTransform(g, k, rec, lookup);
      g.globalCompositeOperation = rec.c === "#fbf8f1" ? "source-over" : "multiply";
      drawPrims(g, primsOf(rec, lookup), rec.c, rec.o, rec.seed);
      g.globalCompositeOperation = "source-over";
    }

    // Paper texture: deterministic speckle tile, drawn under every composition.
    let grainTile = null;
    function grain() {
      if (grainTile) return grainTile;
      grainTile = makeLayer(160, 160, "grain");
      const g = grainTile.getContext("2d"), r = rng(424242);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(60,40,20,0.07)" : "rgba(255,255,255,0.35)";
        g.fillRect(Math.floor(r() * 160), Math.floor(r() * 160), 1 + (r() < 0.15 ? 1 : 0), 1);
      }
      return grainTile;
    }
    function drawPaper(g) {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);
      try {
        const pat = g.createPattern(grain(), "repeat");
        if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, H); }
      } catch (e) { /* texture is cosmetic */ }
    }

    // Render a full composition (used for the live art cache and archive thumbnails).
    function renderComposition(g, pxW, pxH, list, lookup) {
      const k = pxW / W;
      // Start from a fully known bitmap so repeated renders can never accumulate.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, pxW, pxH);
      g.fillStyle = PAPER;
      g.fillRect(0, 0, pxW, pxH);
      g.setTransform(k, 0, 0, k, 0, 0);
      drawPaper(g);
      for (const rec of list) {
        try { drawRecord(g, k, rec, lookup); } catch (e) { /* a single unrenderable mark never blocks the rest */ }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    // =====================================================================
    // Shared state
    // =====================================================================
    const world = ctx.memory.world(WORLD);
    const S = {
      all: new Map(),           // id -> record (validated, every day)
      byDay: new Map(),         // dateKey -> sorted records
      confirmed: new Map(),     // records this client saw the server accept
      rejected: 0,
      loaded: false,
      loadError: false,
      syncing: false,
      lastAttempt: 0,
      lastOk: 0,
      fails: 0,
      newCount: 0,
      newUntil: 0,
      today: dateKeyAt(now()),
      view: "today",            // today | archive | day
      viewDay: null,
      mode: "add",
      tool: { add: "brush", con: "echo", tf: "tint" },
      variant: {},
      color: PALETTE[0].hex,
      opacity: 85,
      size: 30,
      rot: 0,
      rough: true,
      draft: null,              // { rec, stage: draft|pending|failed, id?, obj?, error? }
      sel: null,
      selCycle: null,           // { ux, uy, ids, i }
      lastCommitAt: 0,
      lastSnapshotSig: ""
    };
    for (const fam of Object.keys(VARIANTS)) S.variant[fam] = VARIANTS[fam][0];

    function lookupFor(day) {
      return id => {
        if (S.draft && S.draft.rec.id === id) return S.draft.rec;
        const r = S.all.get(id);
        return r && r.d === day ? r : null;
      };
    }
    function recordsFor(day) { return S.byDay.get(day) || []; }
    function currentDay() { return S.view === "day" ? S.viewDay : S.today; }
    function isLive() { return S.view === "today"; }

    function entriesOf(snap) {
      const out = [];
      if (!snap || typeof snap !== "object") return out;
      let src = snap.objects ?? snap.state?.objects ?? snap.data?.objects ?? snap.world?.objects ?? null;
      if (src == null) src = snap.state ?? snap.data ?? null;
      if (src == null && Object.keys(snap).some(k => ID_RE.test(k))) src = snap;
      if (src == null) return out;
      if (Array.isArray(src)) {
        for (const it of src) {
          if (!it || typeof it !== "object") continue;
          const id = it.id ?? it.key;
          const obj = it.object ?? it.value ?? it.data ?? it;
          out.push({ id, obj, meta: it });
        }
      } else if (typeof src === "object") {
        for (const id of Object.keys(src)) {
          const val = src[id];
          if (val && typeof val === "object" && val.object && typeof val.object === "object") out.push({ id, obj: val.object, meta: val });
          else out.push({ id, obj: val, meta: null });
        }
      }
      return out;
    }
    function serverSeq(meta) {
      if (!meta) return null;
      const raw = meta.seq ?? meta.sequence ?? meta.createdAt ?? meta.created_at ?? meta.insertedAt ?? null;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string") { const t = Date.parse(raw); if (Number.isFinite(t)) return t; }
      return null;
    }
    function authorOf(meta) {
      if (!meta) return null;
      const a = meta.authorId ?? meta.author_id ?? meta.userId ?? meta.user_id ?? meta.createdBy ?? meta.by ?? (meta.author && (meta.author.id ?? meta.author));
      return typeof a === "string" || typeof a === "number" ? String(a) : null;
    }

    function applySnapshot(snap) {
      readServerTime(snap);
      const raw = new Map();
      let rejected = 0;
      let seqKnown = true;
      for (const e of entriesOf(snap)) {
        const rec = sanitize(e.id, e.obj);
        if (!rec) { rejected++; continue; }
        const sq = serverSeq(e.meta);
        if (sq == null) seqKnown = false;
        rec.seqServer = sq;
        rec.author = authorOf(e.meta);
        raw.set(rec.id, rec);
      }
      // Keep records the server already acknowledged to this client, even if a
      // read replica is a moment behind.
      for (const [id, rec] of S.confirmed) if (!raw.has(id)) raw.set(id, rec);
      for (const rec of raw.values()) rec.seq = seqKnown && rec.seqServer != null ? rec.seqServer : rec.t;
      const ok = resolveRelations(raw);
      rejected += raw.size - ok.size;

      const idsJoined = Array.from(ok.keys()).sort().join(",");
      const sig = ok.size + ":" + idsJoined.length + ":" + fnv(idsJoined);
      const changed = sig !== S.lastSnapshotSig;
      if (changed) {
        let fresh = 0;
        if (S.loaded) for (const id of ok.keys()) if (!S.all.has(id) && !S.confirmed.has(id)) fresh++;
        S.all = ok;
        S.byDay = new Map();
        for (const rec of ok.values()) {
          if (!S.byDay.has(rec.d)) S.byDay.set(rec.d, []);
          S.byDay.get(rec.d).push(rec);
        }
        for (const list of S.byDay.values()) list.sort(compareRecs);
        S.lastSnapshotSig = sig;
        if (fresh) { S.newCount = fresh; S.newUntil = Date.now() + 4000; }
        if (S.sel && !S.all.has(S.sel)) S.sel = null;
        artDirty = true;
        clearThumbs();
      }
      S.rejected = rejected;
      S.loaded = true;
      S.loadError = false;
      return changed;
    }

    async function refresh() {
      if (S.syncing) return;
      S.syncing = true;
      S.lastAttempt = Date.now();
      updateSync();
      try {
        const snap = await world.get();
        if (destroyed) return;
        const first = !S.loaded;
        applySnapshot(snap);
        S.lastOk = Date.now();
        S.fails = 0;
        checkRollover(first);
      } catch (e) {
        if (destroyed) return;
        S.fails++;
        if (!S.loaded) S.loadError = true;
        if (S.fails === 1) ctx.platform.error({ stage: "world_get", message: String(e && e.message || e) });
      } finally {
        S.syncing = false;
        refreshHud();
        requestDraw();
      }
    }
    function pollDelay() { return Math.min(POLL_MAX_MS, POLL_MS * Math.pow(2, Math.max(0, S.fails - 1))); }

    // =====================================================================
    // Daily rollover
    // =====================================================================
    function checkRollover(silent) {
      const key = dateKeyAt(now());
      if (key === S.today) return;
      const prev = S.today;
      S.today = key;
      if (silent) {
        // First contact with the server clock corrected a wrong device date.
        if (S.draft && S.draft.rec.d !== key && S.draft.stage !== "pending") S.draft.stale = true;
        artDirty = true;
        return;
      }
      S.sel = null;
      S.selCycle = null;
      if (S.draft && S.draft.rec.d !== key && S.draft.stage !== "pending") {
        S.draft.stale = true;
      }
      artDirty = true;
      clearThumbs();
      toast("Midnight (IST): " + prettyDay(prev) + " is now in the archive. A fresh canvas is open.", 6000);
      refreshHud();
      requestDraw();
    }

    // =====================================================================
    // Surfaces & layout
    // =====================================================================
    const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 2, touchAction: "none" });
    const g = canvas.getContext("2d");
    const root = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "dcc" });

    let rect = { x: 0, y: 0, w: 100, h: 125 };
    let layout = { top: 56, bottom: 220 };
    let artCanvas = null, artDirty = true, needsDraw = true, destroyed = false;
    const thumbCache = new Map();

    function backingScale() {
      const s = canvas.width / Math.max(1, ctx.width);
      return Number.isFinite(s) && s > 0 ? s : 1;
    }

    function computeLayout() {
      const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      const topEl = root.querySelector(".dcc-top");
      const botEl = root.querySelector(".dcc-bottom");
      const top = (topEl ? topEl.offsetHeight : 56) + (sa.top || 0) + 6;
      const bottom = S.view === "archive" ? 0 : (botEl ? botEl.offsetHeight : 220) + 6;
      const availW = Math.max(60, ctx.width - 16 - (sa.left || 0) - (sa.right || 0));
      const availH = Math.max(80, ctx.height - top - bottom);
      let w = availW, h = w * (H / W);
      if (h > availH) { h = availH; w = h * (W / H); }
      const next = { x: Math.round((ctx.width - w) / 2), y: Math.round(top + (availH - h) / 2), w: Math.round(w), h: Math.round(h) };
      if (next.x !== rect.x || next.y !== rect.y || next.w !== rect.w || next.h !== rect.h) { rect = next; artDirty = true; }
      layout = { top, bottom };
      root.dataset.rect = [rect.x, rect.y, rect.w, rect.h].join(",");
      el.top.style.top = (sa.top || 0) + "px";
      el.toast.style.top = (top + 10) + "px";
      el.bottom.style.paddingBottom = ((sa.bottom || 0) + 8) + "px";
      requestDraw();
    }

    function toUnits(px, py) {
      return { x: ((px - rect.x) / rect.w) * W, y: ((py - rect.y) / rect.h) * H };
    }
    function unitsToCss(x, y) { return { x: rect.x + (x / W) * rect.w, y: rect.y + (y / H) * rect.h }; }

    function ensureArt() {
      const bs = backingScale();
      const pw = Math.max(1, Math.round(rect.w * bs)), ph = Math.max(1, Math.round(rect.h * bs));
      if (!artCanvas || artCanvas.width !== pw || artCanvas.height !== ph) {
        artCanvas = makeLayer(pw, ph, "art");
        artDirty = true;
      }
      if (!artDirty) return;
      const day = currentDay();
      renderComposition(artCanvas.getContext("2d"), pw, ph, recordsFor(day), lookupFor(day));
      artDirty = false;
    }

    function requestDraw() { needsDraw = true; }

    // =====================================================================
    // Frame rendering (art cache + interaction overlays)
    // =====================================================================
    function draw() {
      const bs = backingScale();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.lineCap = "butt"; g.lineJoin = "miter"; g.setLineDash([]);
      g.fillStyle = "#1a1714";
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (S.view === "archive") return;

      ensureArt();
      g.drawImage(artCanvas, Math.round(rect.x * bs), Math.round(rect.y * bs));

      const k = (rect.w * bs) / W;
      g.setTransform(k, 0, 0, k, rect.x * bs, rect.y * bs);
      g.save();
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      const day = currentDay(), lookup = lookupFor(day);

      if (!S.loaded) {
        overlayText("Gathering today's marks…", H / 2, 34, "rgba(22,19,15,0.55)");
      } else if (S.loadError && !recordsFor(day).length) {
        overlayText("Couldn't reach the shared canvas.", H / 2 - 20, 30, "rgba(22,19,15,0.7)");
        overlayText("Retrying quietly. Nothing you draw is lost.", H / 2 + 24, 24, "rgba(22,19,15,0.5)");
      } else if (!recordsFor(day).length && !S.draft) {
        if (isLive()) {
          overlayText("A blank day.", H / 2 - 40, 54, "rgba(22,19,15,0.42)", true);
          overlayText("Leave the first mark. Nothing gets erased.", H / 2 + 14, 26, "rgba(22,19,15,0.45)");
          overlayText("Today's loose prompt: " + promptFor(day), H / 2 + 56, 22, "rgba(22,19,15,0.36)");
        } else {
          overlayText("A quiet day: no marks were left.", H / 2, 28, "rgba(22,19,15,0.45)");
        }
      }

      // Suggestions in CONTRIBUTE: recent marks nobody has answered yet.
      if (isLive() && S.mode === "con" && !S.sel && S.loaded) {
        for (const rec of suggestions()) {
          const b = boundsOf(rec, lookup);
          g.setLineDash([5, 7]); g.lineWidth = 2; g.strokeStyle = "rgba(22,19,15,0.55)";
          g.beginPath(); g.arc((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 14, 0, Math.PI * 2); g.stroke();
          g.setLineDash([]);
        }
      }

      // Selected target
      if (S.sel) {
        const t = lookup(S.sel);
        if (t) {
          const b = boundsOf(t, lookup);
          bracket(b, "#16130f", "#fbf8f1", isLive() ? "TARGET" : "MARK");
        }
      }

      // Draft preview
      if (S.draft && S.draft.rec.d === day && isLive()) {
        const rec = S.draft.rec;
        try { drawRecord(g, k, rec, lookup); } catch (e) { /* preview only */ }
        const b = boundsOf(rec, lookup);
        const label = S.draft.stage === "pending" ? "SAVING…" : S.draft.stage === "failed" ? "NOT SAVED" : "DRAFT";
        draftFrame(b, label, S.draft.stage);
      }
      g.restore();

      // Canvas edge
      g.lineWidth = 1.5;
      g.strokeStyle = isLive() ? "rgba(246,241,230,0.5)" : "rgba(246,241,230,0.25)";
      g.setLineDash(isLive() ? [] : [8, 8]);
      g.strokeRect(0, 0, W, H);
      g.setLineDash([]);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    function overlayText(text, y, size, color, serif) {
      g.fillStyle = color;
      g.font = (serif ? "400 " + size + "px 'DM Serif Display', Georgia, serif" : size + "px 'Space Mono', ui-monospace, monospace");
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, W / 2, y, W - 80);
      g.textAlign = "left";
    }
    function bracket(b, c1, c2, label) {
      const pad = 10, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
      g.lineWidth = 6; g.strokeStyle = c2; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.lineWidth = 2.5; g.strokeStyle = c1; g.setLineDash([12, 8]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
      tag(x0, y0, label, c1, c2);
    }
    function draftFrame(b, label, stage) {
      const pad = 14, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
      const col = stage === "failed" ? "#d1200f" : "#2b3ff5";
      g.lineWidth = 2.5; g.strokeStyle = col; g.setLineDash([4, 6]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
      const c = 9;
      g.fillStyle = col;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) g.fillRect(x - c / 2, y - c / 2, c, c);
      tag(x0, y1 + 6, label, "#fbf8f1", col, true);
    }
    function tag(x, y, text, fg, bg, below) {
      g.font = "700 22px 'Space Mono', ui-monospace, monospace";
      const tw = g.measureText(text).width + 16;
      const ty = below ? y : y - 32;
      const tx = clamp(x, 0, W - tw);
      g.fillStyle = bg; g.fillRect(tx, clamp(ty, 0, H - 30), tw, 30);
      g.fillStyle = fg; g.textBaseline = "middle"; g.fillText(text, tx + 8, clamp(ty, 0, H - 30) + 15);
    }

    function suggestions() {
      const list = recordsFor(S.today);
      const answered = new Set();
      for (const r of list) for (const t of r.tg) answered.add(t);
      const out = [];
      for (let i = list.length - 1; i >= 0 && out.length < 3; i--) {
        const r = list[i];
        if (r.k === "add" && !answered.has(r.id)) out.push(r);
      }
      return out;
    }

    // =====================================================================
    // Hit testing (pixel-accurate, top-most first, supports cycling)
    // =====================================================================
    let hitLayer = null;
    function hitsAt(u, day) {
      const lookup = lookupFor(day), list = recordsFor(day), tol = 14, out = [];
      if (!hitLayer) hitLayer = makeLayer(2 * tol + 1, 2 * tol + 1, "hit");
      const hg = hitLayer.getContext("2d");
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i];
        if (rec.k === "tf") continue;
        const b = boundsOf(rec, lookup);
        if (u.x < b.x0 - tol || u.x > b.x1 + tol || u.y < b.y0 - tol || u.y > b.y1 + tol) continue;
        hg.setTransform(1, 0, 0, 1, 0, 0);
        hg.clearRect(0, 0, 2 * tol + 1, 2 * tol + 1);
        hg.setTransform(1, 0, 0, 1, tol - u.x, tol - u.y);
        const prims = primsOf(rec, lookup).map(p => (p.lw ? Object.assign({}, p, { lw: Math.max(p.lw, 8) }) : p));
        drawPrims(hg, prims, "#000", 1, rec.seed, true);
        const data = hg.getImageData(0, 0, 2 * tol + 1, 2 * tol + 1).data;
        let hit = false;
        for (let y = 0; y <= 2 * tol && !hit; y++) {
          for (let x = 0; x <= 2 * tol; x++) {
            if ((x - tol) * (x - tol) + (y - tol) * (y - tol) > tol * tol) continue;
            if (data[(y * (2 * tol + 1) + x) * 4 + 3] > 20) { hit = true; break; }
          }
        }
        if (hit) out.push(rec.id);
      }
      return out;
    }
    function selectAt(u) {
      const day = currentDay();
      const ids = hitsAt(u, day);
      if (!ids.length) { S.sel = null; S.selCycle = null; return null; }
      const c = S.selCycle;
      if (c && Math.hypot(c.ux - u.x, c.uy - u.y) < 22 && c.ids.join() === ids.join()) {
        c.i = (c.i + 1) % ids.length;
      } else {
        S.selCycle = { ux: u.x, uy: u.y, ids, i: 0 };
      }
      S.sel = S.selCycle.ids[S.selCycle.i];
      return S.sel;
    }

    // =====================================================================
    // Drafts
    // =====================================================================
    const SIZE_FOR = { brush: "Width", shape: "Width", line: "Width", dots: "Dot size", stamp: "Line", echo: "Scale", connect: "Width", react: "Space", tint: null, mask: null, shift: "Scale", texture: "Density" };
    const ROT_FOR = { brush: null, shape: "Rotate", line: "Bend", dots: "Rotate", stamp: "Rotate", echo: "Turn", connect: "Bend", react: null, tint: null, mask: null, shift: "Turn", texture: "Angle" };
    function family() {
      const tool = S.tool[S.mode];
      return tool === "shape" ? "shape" : tool;
    }
    function baseRec(k, s) {
      return {
        draft: true, id: "draft", v: SCHEMA, d: S.today, k, s, vr: null, g: null,
        c: S.color, o: Math.round(S.opacity) / 100, w: Math.round(S.size), r: 0, f: 0, ro: S.rough ? 1 : 0,
        tg: [], p: null, t: 0, seed: 99991
      };
    }
    function startDraft(rec) {
      S.draft = { rec, stage: "draft" };
      saveDraftLocal();
      refreshHud();
      requestDraw();
    }
    function touchDraft() {
      if (!S.draft) return;
      if (S.draft.stage === "failed") { S.draft.stage = "draft"; S.draft.id = null; S.draft.obj = null; }
      applyStyleToDraft();
      saveDraftLocal();
      refreshHud();
      requestDraw();
    }
    function applyStyleToDraft() {
      const d = S.draft && S.draft.rec;
      if (!d || S.draft.stage === "pending") return;
      d.c = S.color; d.o = Math.round(S.opacity) / 100; d.ro = S.rough ? 1 : 0;
      const fam = familyOf(d.s);
      if (d.k === "add") {
        d.w = Math.round(S.size);
        if (fam === "shape") { d.f = S.variant.shape === "fill" ? 1 : 0; d.r = Math.round(S.rot); }
        if (d.s === "dots" || d.s === "stamp") d.r = Math.round(S.rot);
        if (d.s === "dots") d.vr = S.variant.dots;
        if (d.s === "stamp") d.vr = S.variant.stamp;
        if (d.s === "brush") d.vr = S.variant.brush;
        if (fam === "line") {
          const want = S.variant.line === "arc" ? "arc" : "line";
          d.s = want; d.vr = want;
          if (want === "arc") d.g.b = Math.round(S.rot / 180 * 100) / 100 || 0.35;
          else delete d.g.b;
        }
      } else if (d.s === "echo") {
        d.w = Math.round(S.size); d.vr = S.variant.echo;
        d.p.n = Number(S.variant.echo.slice(1)); d.p.sc = Math.round((0.5 + S.size / 100) * 100) / 100; d.p.rot = Math.round(S.rot);
      } else if (d.s === "connect") {
        d.w = Math.round(S.size); d.vr = S.variant.connect; d.g.b = Math.round(S.rot / 180 * 100) / 100;
      } else if (d.s === "react") {
        d.w = Math.round(S.size); d.vr = S.variant.react;
        const t = lookupFor(d.d)(d.tg[0]);
        if (t) { const b = boundsOf(t, lookupFor(d.d)); d.g = { x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) }; }
      } else if (d.s === "tint") {
        d.vr = S.variant.tint;
      } else if (d.s === "mask") {
        d.vr = S.variant.mask;
      } else if (d.s === "shift") {
        d.vr = "ghost"; d.w = Math.round(S.size);
        d.p.sc = Math.round((0.5 + S.size / 100) * 100) / 100; d.p.rot = Math.round(S.rot);
      } else if (d.s === "texture") {
        d.vr = S.variant.texture; d.w = Math.round(S.size); d.r = Math.round(S.rot);
      }
      primCache.delete("draft");
      boundsCache.delete("draft");
    }

    // Build a draft for a CONTRIBUTE / TRANSFORM tool around the selected target.
    function draftForTarget(dragFrom, dragTo) {
      const day = S.today, lookup = lookupFor(day), target = lookup(S.sel);
      if (!target) return;
      const tool = S.tool[S.mode];
      const tb = boundsOf(target, lookup), tcx = (tb.x0 + tb.x1) / 2, tcy = (tb.y0 + tb.y1) / 2;
      let rec;
      if (S.mode === "con") {
        rec = baseRec("con", tool);
        rec.tg = [target.id];
        if (tool === "echo") {
          const dx = dragTo ? dragTo.x - dragFrom.x : 70, dy = dragTo ? dragTo.y - dragFrom.y : 40;
          rec.p = { dx: Math.round(clamp(dx, -800, 800)), dy: Math.round(clamp(dy, -800, 800)), n: 3, sc: 1, rot: 0 };
        } else if (tool === "connect") {
          if (!dragTo) return;
          let x1 = dragTo.x, y1 = dragTo.y;
          const other = hitsAt(dragTo, day).find(id => id !== target.id);
          if (other) {
            rec.tg = [target.id, other];
            const ob = boundsOf(lookup(other), lookup);
            x1 = (ob.x0 + ob.x1) / 2; y1 = (ob.y0 + ob.y1) / 2;
          }
          rec.g = { x0: Math.round(tcx), y0: Math.round(tcy), x1: Math.round(clamp(x1, 0, W)), y1: Math.round(clamp(y1, 0, H)), b: 0 };
        } else {
          rec.g = { x0: 0, y0: 0, x1: 0, y1: 0 };
        }
      } else {
        rec = baseRec("tf", tool);
        rec.tg = [target.id];
        if (tool === "mask") {
          const c = dragFrom || { x: tcx, y: tcy };
          const R = dragTo ? Math.hypot(dragTo.x - c.x, dragTo.y - c.y) : Math.max(24, Math.min(tb.x1 - tb.x0, tb.y1 - tb.y0) / 3);
          rec.g = { x: Math.round(c.x), y: Math.round(c.y), R: Math.round(clamp(R, 8, 900)) };
        } else if (tool === "shift") {
          const dx = dragTo ? dragTo.x - dragFrom.x : 28, dy = dragTo ? dragTo.y - dragFrom.y : 22;
          rec.p = { dx: Math.round(clamp(dx, -800, 800)), dy: Math.round(clamp(dy, -800, 800)), sc: 1, rot: 0 };
        }
      }
      S.draft = { rec, stage: "draft" };
      applyStyleToDraft();
      saveDraftLocal();
      refreshHud();
      requestDraw();
    }

    // Finalise a draft into the exact object that gets stored.
    function finalObject(rec) {
      const o = { v: SCHEMA, d: rec.d, k: rec.k, s: rec.s, c: rec.c, o: Math.round(rec.o * 100) / 100, w: Math.round(rec.w), t: Math.round(now()) };
      if (rec.vr) o.vr = rec.vr;
      if (rec.r) o.r = Math.round(rec.r);
      if (rec.f) o.f = 1;
      if (rec.ro) o.ro = 1;
      if (rec.tg && rec.tg.length) o.tg = rec.tg.slice();
      if (rec.g) {
        const gg = {};
        for (const key of Object.keys(rec.g)) {
          const v = rec.g[key];
          gg[key] = Array.isArray(v) ? v.map(n => Math.round(n)) : key === "b" ? Math.round(v * 100) / 100 : Math.round(v);
        }
        o.g = gg;
      }
      if (rec.p) {
        const pp = {};
        for (const key of Object.keys(rec.p)) pp[key] = key === "sc" ? Math.round(rec.p[key] * 100) / 100 : Math.round(rec.p[key]);
        o.p = pp;
      }
      return o;
    }
    function simplify(pts, eps) {
      if (pts.length <= 4) return pts;
      const n = pts.length / 2, keep = new Uint8Array(n);
      keep[0] = keep[n - 1] = 1;
      const stack = [[0, n - 1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        let maxD = 0, idx = -1;
        const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        for (let i = a + 1; i < b; i++) {
          const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len;
          if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
      }
      const out = [];
      for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
      return out;
    }
    function fitPayload(rec) {
      let obj = finalObject(rec);
      if (rec.s === "brush") {
        let eps = 1.2;
        while (JSON.stringify({ id: "x".repeat(32), object: obj }).length > MAX_MUTATION_BYTES && eps < 60) {
          rec.g.p = simplify(rec.g.p, eps);
          eps *= 1.6;
          obj = finalObject(rec);
        }
      }
      return obj;
    }

    // =====================================================================
    // Commit: Draft -> Submit -> server persists -> refetch -> render
    // =====================================================================
    async function commit() {
      const dr = S.draft;
      if (!dr || dr.stage === "pending" || !isLive()) return;
      const key = dateKeyAt(now());
      if (key !== S.today) checkRollover();
      if (dr.rec.d !== S.today || dr.stale) {
        dr.stale = true;
        refreshHud();
        return;
      }
      for (const t of dr.rec.tg) {
        if (!lookupFor(S.today)(t)) {
          dr.error = "The mark you were responding to isn't on today's canvas any more.";
          dr.stage = "failed";
          refreshHud();
          return;
        }
      }
      const wait = S.lastCommitAt + COOLDOWN_MS - Date.now();
      if (wait > 0) { toast("Give it " + Math.ceil(wait / 1000) + "s. Let the canvas breathe.", 1800); return; }
      if (localCount() >= DAILY_LIMIT) { toast("You've left " + DAILY_LIMIT + " marks today, which is the daily limit. Tomorrow starts fresh.", 4000); return; }

      if (!dr.id || !dr.obj) {
        const obj = fitPayload(dr.rec);
        const id = obj.d + "_" + nonce() + "_" + checksum(obj);
        if (JSON.stringify({ id, object: obj }).length > MAX_MUTATION_BYTES) {
          dr.stage = "failed";
          dr.error = "That mark is too detailed to save. Try a shorter stroke.";
          refreshHud();
          return;
        }
        dr.id = id; dr.obj = obj;        // stable idempotency key for retries
      }
      dr.stage = "pending";
      dr.error = null;
      saveDraftLocal();
      refreshHud();
      requestDraw();
      ctx.platform.start();
      try {
        const res = await world.mutate({ id: dr.id, object: dr.obj });
        if (destroyed) return;
        readServerTime(res);
        const rec = sanitize(dr.id, dr.obj);
        if (rec) { rec.seq = rec.t; S.confirmed.set(rec.id, rec); }
        const center = boundsOf(dr.rec, lookupFor(S.today));
        S.draft = null;
        S.lastCommitAt = Date.now();
        bumpLocalCount();
        clearDraftLocal();
        S.lastSnapshotSig = "";
        if (rec) applySnapshotMerge(rec);
        ack(center);
        ctx.platform.interact({ type: "contribution", kind: rec ? rec.k : "unknown" });
        refresh();
      } catch (e) {
        if (destroyed) return;
        dr.stage = "failed";
        const msg = String((e && (e.code || e.message)) || e).toLowerCase();
        dr.error = /rate|limit|429/.test(msg)
          ? "Daily limit reached for now. Your draft is kept."
          : /size|payload|large/.test(msg)
            ? "That mark is too large to save. Try something simpler."
            : /auth|sign|session|401|403|permission/.test(msg)
              ? "Your session needs a refresh. Your draft is kept."
              : "Not saved yet: connection trouble. Your draft is kept.";
        dr.retryable = !/size|payload|large/.test(msg);
        saveDraftLocal();
      } finally {
        refreshHud();
        requestDraw();
      }
    }
    // Show an acknowledged record immediately without waiting for the next poll.
    function applySnapshotMerge(rec) {
      if (S.all.has(rec.id)) return;
      const map = new Map(S.all);
      map.set(rec.id, rec);
      const ok = resolveRelations(map);
      S.all = ok;
      S.byDay = new Map();
      for (const r of ok.values()) {
        if (!S.byDay.has(r.d)) S.byDay.set(r.d, []);
        S.byDay.get(r.d).push(r);
      }
      for (const list of S.byDay.values()) list.sort(compareRecs);
      artDirty = true;
      clearThumbs();
    }
    function ack(b) {
      const c = unitsToCss((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      if (!reduceMotion) {
        try { ctx.fx.ripple({ x: c.x, y: c.y, color: "rgba(22,19,15,0.55)", radius: 60, durationMs: 700 }); } catch (e) { /* cosmetic */ }
      }
      if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic("light"); } catch (e) { /* optional */ } }
      toast("Saved. It's part of today's canvas now.", 2200);
    }
    function cancelDraft() {
      if (!S.draft || S.draft.stage === "pending") return;
      S.draft = null;
      clearDraftLocal();
      refreshHud();
      requestDraw();
    }

    // ---- Local convenience storage (never authoritative) ----
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    function store(k, v) { if (canStore) { try { const r = v === null ? ctx.storage.remove(k) : ctx.storage.set(k, v); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } }
    async function load(k) { if (!canStore) return null; try { return await ctx.storage.get(k); } catch (e) { return null; } }
    let draftSaveTimer = null;
    function saveDraftLocal() {
      if (draftSaveTimer) return;
      draftSaveTimer = ctx.timeout(() => {
        draftSaveTimer = null;
        if (!S.draft) return;
        const r = Object.assign({}, S.draft.rec);
        store("dcc:draft", { rec: r, id: S.draft.id || null, obj: S.draft.obj || null });
      }, 400);
    }
    function clearDraftLocal() { store("dcc:draft", null); }
    let localCounts = {};
    function localCount() { return localCounts[S.today] || 0; }
    function bumpLocalCount() {
      localCounts = { [S.today]: localCount() + 1 };
      store("dcc:count", localCounts);
    }

    // =====================================================================
    // HUD (DOM)
    // =====================================================================
    const style = document.createElement("style");
    style.textContent = `
      .dcc { font-family: 'Space Mono', ui-monospace, Menlo, monospace; color: #efe9dc; }
      .dcc * { box-sizing: border-box; }
      .dcc button, .dcc input { font-family: inherit; pointer-events: auto; }
      .dcc button { -webkit-tap-highlight-color: transparent; }
      .dcc :focus-visible { outline: 2px solid #ffcc1a; outline-offset: 2px; }
      .dcc-top { position: absolute; z-index: 3; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 8px 12px 6px; }
      .dcc-date { display: flex; flex-direction: column; line-height: 1.05; min-width: 0; }
      .dcc-day { font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; white-space: nowrap; }
      .dcc-meta { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dcc-sp { flex: 1; }
      .dcc-sync { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; opacity: .85; white-space: nowrap; }
      .dcc-dot { width: 8px; height: 8px; border-radius: 50%; background: #8fe3c4; display: inline-block; }
      .dcc-sync[data-s="syncing"] .dcc-dot { background: #ffcc1a; }
      .dcc-sync[data-s="offline"] .dcc-dot { background: transparent; border: 2px solid #f2421b; }
      .dcc-btn { background: transparent; color: #efe9dc; border: 1.5px solid rgba(239,233,220,.55); border-radius: 999px; padding: 6px 12px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; min-height: 34px; }
      .dcc-btn:disabled { opacity: .35; cursor: default; }
      .dcc-btn.solid { background: #efe9dc; color: #16130f; border-color: #efe9dc; font-weight: 700; }
      .dcc-ctx { height: 38px; display: flex; align-items: center; justify-content: center; }
      .dcc-hint[hidden] { display: none; }
      .dcc-hint { font-size: 11px; line-height: 1.35; opacity: .8; text-align: center; pointer-events: none; min-height: 15px; }
      .dcc-bottom { position: absolute; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 560px; padding: 6px 10px 8px; display: flex; flex-direction: column; gap: 6px; }
      .dcc-vars { min-height: 32px; }
      .dcc-row { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; align-items: center; }
      .dcc-row::-webkit-scrollbar { display: none; }
      .dcc-chip { flex: 0 0 auto; background: transparent; color: #efe9dc; border: 1.5px solid rgba(239,233,220,.3); border-radius: 8px; padding: 6px 10px; font-size: 11px; letter-spacing: .04em; cursor: pointer; min-height: 32px; text-transform: lowercase; }
      .dcc-chip[aria-pressed="true"] { border-color: #efe9dc; background: rgba(239,233,220,.14); }
      .dcc-sw { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; border: 2px solid rgba(239,233,220,.25); cursor: pointer; padding: 0; }
      .dcc-sw[aria-pressed="true"] { border-color: #efe9dc; box-shadow: 0 0 0 2px #1a1714 inset; }
      .dcc-sliders { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .dcc-sl { display: flex; flex-direction: column; gap: 2px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; opacity: .85; }
      .dcc-sl[hidden] { display: none; }
      .dcc-sl input { width: 100%; accent-color: #efe9dc; height: 22px; }
      .dcc-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .dcc-mode { background: transparent; color: #efe9dc; border: 1.5px solid rgba(239,233,220,.35); border-radius: 10px; padding: 8px 4px; font-size: 12px; font-weight: 700; letter-spacing: .1em; cursor: pointer; min-height: 42px; }
      .dcc-mode[aria-pressed="true"] { background: #efe9dc; color: #16130f; border-color: #efe9dc; }
      .dcc-mode:disabled { opacity: .3; cursor: default; }
      .dcc-draft { display: flex; gap: 8px; align-items: center; min-height: 38px; }
      .dcc-draft[hidden], .dcc-row[hidden], .dcc-sliders[hidden], .dcc-modes[hidden] { display: none; }
      .dcc-dmsg { flex: 1; font-size: 11px; line-height: 1.3; }
      .dcc-dmsg.err { color: #ff9a85; }
      .dcc-toast { position: absolute; z-index: 4; left: 50%; transform: translateX(-50%); max-width: min(92%, 420px); background: #efe9dc; color: #16130f; font-size: 12px; line-height: 1.35; padding: 8px 12px; border-radius: 8px; pointer-events: none; opacity: 0; transition: opacity .25s; text-align: center; }
      .dcc-toast.on { opacity: 1; }
      .dcc-chipsel { align-self: center; background: #16130f; color: #efe9dc; border: 1px solid rgba(239,233,220,.4); font-size: 11px; padding: 5px 8px; border-radius: 6px; display: flex; gap: 8px; align-items: center; white-space: nowrap; }
      .dcc-chipsel[hidden] { display: none; }
      .dcc-chipsel button { background: none; border: 1px solid rgba(239,233,220,.5); color: inherit; border-radius: 5px; font-size: 11px; padding: 3px 7px; cursor: pointer; min-height: 26px; }
      .dcc-arch { position: absolute; z-index: 1; inset: 0; overflow-y: auto; padding: 0 14px 24px; background: #1a1714; pointer-events: auto; }
      .dcc-arch[hidden] { display: none; }
      .dcc-arch h2 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 30px; margin: 4px 0 2px; }
      .dcc-arch p.lede { font-size: 11px; opacity: .7; margin: 0 0 14px; line-height: 1.4; }
      .dcc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px 12px; }
      .dcc-card { background: none; border: 0; padding: 0; color: inherit; text-align: left; cursor: pointer; }
      .dcc-card img, .dcc-card .ph { width: 100%; aspect-ratio: 4 / 5; display: block; border-radius: 2px; background: ${PAPER}; }
      .dcc-card .cd { font-family: 'DM Serif Display', Georgia, serif; font-size: 17px; margin-top: 6px; }
      .dcc-card .cm { font-size: 10px; opacity: .65; letter-spacing: .05em; text-transform: uppercase; }
      .dcc-live { display: inline-block; font-size: 9px; letter-spacing: .1em; background: #8fe3c4; color: #16130f; padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
      .dcc-ro { display: inline-block; font-size: 9px; letter-spacing: .1em; border: 1px solid rgba(239,233,220,.6); padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
      .dcc-hist { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
      .dcc-hist[hidden] { display: none; }
      .dcc-hist p { width: 100%; text-align: center; margin: 0; font-size: 11px; opacity: .8; }
      .dcc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    `;
    root.appendChild(style);

    const PALETTE_HTML = PALETTE.map(p => `<button class="dcc-sw" data-color="${p.hex}" style="background:${p.hex}" aria-label="${p.name}" aria-pressed="false"></button>`).join("");
    root.insertAdjacentHTML("beforeend", `
      <div class="dcc-top">
        <div class="dcc-date"><span class="dcc-day"></span><span class="dcc-meta"></span></div>
        <div class="dcc-sp"></div>
        <div class="dcc-sync" data-s="syncing" role="status" aria-live="polite"><span class="dcc-dot"></span><span class="dcc-synct">connecting</span></div>
        <button class="dcc-btn dcc-nav" type="button">Archive</button>
      </div>
      <div class="dcc-bottom">
        <div class="dcc-ctx">
          <div class="dcc-hint" aria-live="polite"></div>
          <div class="dcc-chipsel" hidden><span class="dcc-chipselt"></span><button type="button" class="dcc-cycle">next ↺</button><button type="button" class="dcc-unsel">clear</button></div>
        </div>
        <div class="dcc-draft" hidden>
          <button class="dcc-btn dcc-cancel" type="button">Cancel</button>
          <div class="dcc-dmsg" aria-live="polite"></div>
          <button class="dcc-btn solid dcc-commit" type="button">Commit</button>
        </div>
        <div class="dcc-hist" hidden>
          <p class="dcc-histt"></p>
          <button class="dcc-btn dcc-back" type="button">← Archive</button>
          <button class="dcc-btn solid dcc-totoday" type="button">Go to today</button>
        </div>
        <div class="dcc-row dcc-tools" role="toolbar" aria-label="Tools"></div>
        <div class="dcc-row dcc-vars" role="toolbar" aria-label="Variations"></div>
        <div class="dcc-row dcc-colors" role="toolbar" aria-label="Colours">${PALETTE_HTML}</div>
        <div class="dcc-sliders">
          <label class="dcc-sl dcc-sl-o"><span>Opacity</span><input type="range" min="10" max="100" step="1" class="dcc-o"></label>
          <label class="dcc-sl dcc-sl-s"><span class="dcc-sl-sl">Width</span><input type="range" min="1" max="100" step="1" class="dcc-s"></label>
          <label class="dcc-sl dcc-sl-r"><span class="dcc-sl-rl">Rotate</span><input type="range" min="-180" max="180" step="1" class="dcc-r"></label>
        </div>
        <div class="dcc-modes" role="toolbar" aria-label="Actions">
          <button class="dcc-mode" type="button" data-mode="add" aria-pressed="true">ADD</button>
          <button class="dcc-mode" type="button" data-mode="con" aria-pressed="false">CONTRIBUTE</button>
          <button class="dcc-mode" type="button" data-mode="tf" aria-pressed="false">TRANSFORM</button>
        </div>
      </div>
      <div class="dcc-toast" role="status" aria-live="polite"></div>
      <section class="dcc-arch" hidden aria-label="Archive"></section>
    `);
    const $ = sel => root.querySelector(sel);
    const el = {
      top: $(".dcc-top"), day: $(".dcc-day"), meta: $(".dcc-meta"), sync: $(".dcc-sync"), synct: $(".dcc-synct"), nav: $(".dcc-nav"),
      hint: $(".dcc-hint"), chipsel: $(".dcc-chipsel"), chipselt: $(".dcc-chipselt"), cycle: $(".dcc-cycle"), unsel: $(".dcc-unsel"),
      bottom: $(".dcc-bottom"), draft: $(".dcc-draft"), cancel: $(".dcc-cancel"), dmsg: $(".dcc-dmsg"), commit: $(".dcc-commit"),
      hist: $(".dcc-hist"), histt: $(".dcc-histt"), back: $(".dcc-back"), totoday: $(".dcc-totoday"),
      tools: $(".dcc-tools"), vars: $(".dcc-vars"), colors: $(".dcc-colors"),
      sliders: $(".dcc-sliders"), so: $(".dcc-o"), ss: $(".dcc-s"), sr: $(".dcc-r"), slS: $(".dcc-sl-s"), slR: $(".dcc-sl-r"), slO: $(".dcc-sl-o"),
      slSl: $(".dcc-sl-sl"), slRl: $(".dcc-sl-rl"), modes: $(".dcc-modes"), toast: $(".dcc-toast"), arch: $(".dcc-arch")
    };
    el.so.value = S.opacity; el.ss.value = S.size; el.sr.value = S.rot;

    const TOOLS = {
      add: [["brush", "draw"], ["shape", "shape"], ["line", "line"], ["dots", "dots"], ["stamp", "stamp"]],
      con: [["echo", "echo"], ["connect", "connect"], ["react", "react"]],
      tf: [["tint", "tint"], ["mask", "mask"], ["shift", "shift"], ["texture", "texture"]]
    };
    const SHAPE_KINDS = ["ellipse", "rect", "poly", "blob"];
    S.shapeKind = "ellipse";
    const HINTS = {
      brush: "ADD: draw freely. Lift your finger to preview, then commit.",
      shape: "ADD: drag to size a shape, or tap to drop one.",
      line: "ADD: drag a line. Arc bends it; tune the bend with the slider.",
      dots: "ADD: drag out a cluster of dots, or tap to drop one.",
      stamp: "ADD: tap to place a motif, drag to scale it.",
      echo: "CONTRIBUTE: tap a mark, then drag to repeat it with rhythm.",
      connect: "CONTRIBUTE: tap a mark, then drag to another place or mark to link them.",
      react: "CONTRIBUTE: tap a mark to surround or answer it.",
      tint: "TRANSFORM: tap a mark to wash it in a new colour. The original stays.",
      mask: "TRANSFORM: tap a mark, then drag a circle to cut or reveal part of it.",
      shift: "TRANSFORM: tap a mark, then drag to cast a displaced impression.",
      texture: "TRANSFORM: tap a mark to lay a texture over it."
    };

    for (const mode of Object.keys(TOOLS)) {
      for (const [id, label] of TOOLS[mode]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "dcc-chip"; b.dataset.mode = mode; b.dataset.tool = id; b.textContent = label;
        b.setAttribute("aria-pressed", "false");
        el.tools.appendChild(b);
        ctx.input.activate(b, () => { selectTool(mode, id); });
      }
    }
    const roughBtn = document.createElement("button");
    function buildVariants() {
      el.vars.innerHTML = "";
      const tool = S.tool[S.mode];
      const items = [];
      if (tool === "shape") for (const s of SHAPE_KINDS) items.push(["shapeKind", s, s === "poly" ? "polygon" : s === "rect" ? "rectangle" : s]);
      const fam = tool;
      for (const v of VARIANTS[fam] || []) if (fam !== "shift") items.push(["variant", v, v]);
      for (const [kind, val, label] of items) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "dcc-chip"; b.textContent = label;
        const pressed = kind === "shapeKind" ? S.shapeKind === val : S.variant[fam] === val;
        b.setAttribute("aria-pressed", pressed ? "true" : "false");
        ctx.input.activate(b, () => {
          if (kind === "shapeKind") S.shapeKind = val; else S.variant[fam] = val;
          if (S.draft && S.draft.rec.k === "add" && kind === "shapeKind" && familyOf(S.draft.rec.s) === "shape") S.draft.rec.s = val;
          buildVariants();
          touchDraft();
        });
        el.vars.appendChild(b);
      }
      if (S.mode === "add" && ["brush", "shape", "line", "stamp"].includes(tool)) {
        roughBtn.type = "button"; roughBtn.className = "dcc-chip";
        roughBtn.textContent = S.rough ? "rough ✓" : "rough";
        roughBtn.setAttribute("aria-pressed", S.rough ? "true" : "false");
        el.vars.appendChild(roughBtn);
      }
      el.vars.hidden = !isLive();
      el.vars.style.visibility = el.vars.children.length ? "visible" : "hidden";
    }
    ctx.input.activate(roughBtn, () => { S.rough = !S.rough; buildVariants(); touchDraft(); });

    for (const b of el.colors.querySelectorAll(".dcc-sw")) {
      ctx.input.activate(b, () => { S.color = b.dataset.color; refreshColors(); touchDraft(); });
    }
    function refreshColors() {
      for (const b of el.colors.querySelectorAll(".dcc-sw")) b.setAttribute("aria-pressed", b.dataset.color === S.color ? "true" : "false");
    }
    ctx.listen(el.so, "input", () => { S.opacity = Number(el.so.value); touchDraft(); });
    ctx.listen(el.ss, "input", () => { S.size = Number(el.ss.value); touchDraft(); });
    ctx.listen(el.sr, "input", () => { S.rot = Number(el.sr.value); touchDraft(); });

    for (const b of el.modes.querySelectorAll(".dcc-mode")) {
      ctx.input.activate(b, () => setMode(b.dataset.mode));
    }
    ctx.input.activate(el.commit, () => {
      if (S.draft && S.draft.stale) { moveDraftToToday(); return; }
      commit();
    });
    ctx.input.activate(el.cancel, () => cancelDraft());
    ctx.input.activate(el.nav, () => { if (S.view === "archive") openToday(); else openArchive(); });
    ctx.input.activate(el.back, () => openArchive());
    ctx.listen(el.arch, "click", e => {
      const card = e.target && e.target.closest ? e.target.closest(".dcc-card") : null;
      if (card && card.dataset.day) openDay(card.dataset.day);
    });
    ctx.input.activate(el.totoday, () => openToday());
    ctx.input.activate(el.cycle, () => {
      if (!S.selCycle) return;
      S.selCycle.i = (S.selCycle.i + 1) % S.selCycle.ids.length;
      S.sel = S.selCycle.ids[S.selCycle.i];
      onTargetChanged();
    });
    ctx.input.activate(el.unsel, () => {
      S.sel = null; S.selCycle = null;
      if (S.draft && S.draft.rec.k !== "add" && S.draft.stage !== "pending") S.draft = null;
      refreshHud(); requestDraw();
    });

    function setMode(mode) {
      if (!isLive()) return;
      if (S.mode === mode) return;
      if (S.draft && S.draft.stage === "pending") return;
      S.mode = mode;
      if (S.draft) { S.draft = null; clearDraftLocal(); }
      if (mode === "add") { S.sel = null; S.selCycle = null; }
      else if (S.sel) onTargetChanged();
      buildVariants();
      refreshHud();
      requestDraw();
    }
    function selectTool(mode, id) {
      if (S.mode !== mode) setMode(mode);
      S.tool[mode] = id;
      if (S.draft && S.draft.stage !== "pending" && (mode !== "add" || S.draft.rec.k !== "add" || toolOf(S.draft.rec) !== id)) S.draft = null;
      if (mode !== "add" && S.sel) onTargetChanged();
      buildVariants();
      refreshHud();
      requestDraw();
    }
    function toolOf(rec) {
      const fam = familyOf(rec.s);
      return fam;
    }
    function onTargetChanged() {
      const tool = S.tool[S.mode];
      if (!isLive() || S.mode === "add") { refreshHud(); requestDraw(); return; }
      if (S.draft && S.draft.stage === "pending") return;
      if (!S.sel) { S.draft = null; clearDraftLocal(); refreshHud(); requestDraw(); return; }
      if (["react", "tint", "texture", "mask", "shift", "echo"].includes(tool)) draftForTarget(null, null);
      else { S.draft = null; refreshHud(); requestDraw(); }
    }
    function moveDraftToToday() {
      const dr = S.draft;
      if (!dr) return;
      if (dr.rec.k !== "add") { cancelDraft(); toast("That response belonged to a closed canvas, so it was set aside.", 3000); return; }
      dr.rec.d = S.today; dr.stale = false; dr.stage = "draft"; dr.id = null; dr.obj = null; dr.error = null;
      saveDraftLocal(); refreshHud(); requestDraw();
      toast("Moved your draft onto today's canvas. Commit when ready.", 2600);
    }

    let toastToken = 0;
    function toast(msg, ms) {
      const token = ++toastToken;
      el.toast.textContent = msg;
      el.toast.classList.add("on");
      ctx.timeout(() => { if (token === toastToken) el.toast.classList.remove("on"); }, ms || 2500);
    }

    function updateSync() {
      let s = "live", t = "live";
      if (S.syncing && !S.loaded) { s = "syncing"; t = "loading"; }
      else if (S.fails > 0) { s = "offline"; t = S.loaded ? "offline · retrying" : "can't connect"; }
      else if (S.syncing) { s = "syncing"; t = "syncing"; }
      if (s === "live" && Date.now() < S.newUntil && S.newCount) t = "+" + S.newCount + " new";
      el.sync.dataset.s = s;
      el.synct.textContent = t;
    }

    function refreshHud() {
      updateSync();
      const day = currentDay();
      const list = recordsFor(day);
      const authors = new Set();
      let attributed = 0;
      for (const r of list) if (r.author) { authors.add(r.author); attributed++; }
      const counts = list.length + (list.length === 1 ? " mark" : " marks") + (attributed === list.length && list.length ? " · " + authors.size + (authors.size === 1 ? " person" : " people") : "");
      el.day.textContent = prettyDay(day);
      if (S.view === "archive") {
        el.day.textContent = "Archive";
        el.meta.textContent = "every day's canvas, kept";
      } else if (isLive()) {
        el.meta.textContent = "today · " + counts;
      } else {
        el.meta.textContent = "archived · read-only · " + counts;
      }
      el.nav.textContent = S.view === "archive" ? "Today" : "Archive";

      const live = isLive();
      el.modes.hidden = !live;
      el.tools.hidden = !live; el.colors.hidden = !live; el.sliders.hidden = !live;
      el.hist.hidden = S.view !== "day";
      if (S.view === "day") el.histt.textContent = "Archived canvas from " + longDay(S.viewDay) + ". It's read-only; new marks go on today's canvas.";
      for (const b of el.modes.querySelectorAll(".dcc-mode")) b.setAttribute("aria-pressed", b.dataset.mode === S.mode ? "true" : "false");
      for (const b of el.tools.querySelectorAll(".dcc-chip")) {
        b.hidden = b.dataset.mode !== S.mode;
        b.setAttribute("aria-pressed", b.dataset.tool === S.tool[S.mode] ? "true" : "false");
      }
      el.vars.hidden = !live;
      el.vars.style.visibility = el.vars.children.length ? "visible" : "hidden";
      refreshColors();

      const fam = S.tool[S.mode];
      const sl = SIZE_FOR[fam], rl = ROT_FOR[fam];
      el.slS.hidden = !sl; el.slR.hidden = !rl;
      if (sl) el.slSl.textContent = sl;
      if (rl) el.slRl.textContent = rl;

      // Hint line
      let hint = "";
      if (S.view === "day") hint = "Tap a mark to inspect it.";
      else if (live) {
        hint = HINTS[fam] || "";
        if (S.mode !== "add" && !recordsFor(S.today).length) hint = "Nothing to respond to yet. Start with ADD.";
      }
      el.hint.textContent = S.view === "archive" ? "" : hint;

      // Selection chip
      const lookup = lookupFor(day);
      const selRec = S.sel ? lookup(S.sel) : null;
      el.chipsel.hidden = !selRec;
      el.hint.hidden = !!selRec;
      if (selRec) {
        const n = S.selCycle ? S.selCycle.ids.length : 1, i = S.selCycle ? S.selCycle.i + 1 : 1;
        el.chipselt.textContent = describe(selRec) + (n > 1 ? " · " + i + " of " + n + " here" : "");
        el.cycle.hidden = n < 2;
      }

      // Draft bar
      const dr = S.draft;
      const showDraft = live && !!dr;
      el.draft.hidden = !live;
      el.draft.style.visibility = showDraft ? "visible" : "hidden";
      if (showDraft) {
        el.dmsg.classList.toggle("err", dr.stage === "failed" || !!dr.stale);
        el.cancel.disabled = dr.stage === "pending";
        if (dr.stale) {
          el.dmsg.textContent = "This draft was started on " + prettyDay(dr.rec.d) + "'s canvas, which has closed.";
          el.commit.textContent = dr.rec.k === "add" ? "Continue today" : "Set aside";
          el.commit.disabled = false;
        } else if (dr.stage === "pending") {
          el.dmsg.textContent = "Saving to the shared canvas…";
          el.commit.textContent = "Saving…"; el.commit.disabled = true;
        } else if (dr.stage === "failed") {
          el.dmsg.textContent = dr.error || "Not saved.";
          el.commit.textContent = dr.retryable === false ? "Commit" : "Retry"; el.commit.disabled = false;
        } else {
          el.dmsg.textContent = "Draft: only you can see this until you commit.";
          el.commit.textContent = "Commit"; el.commit.disabled = false;
        }
      }
      ctx.timeout(computeLayout, 0);
    }

    function describe(rec) {
      const names = { brush: "stroke", ellipse: "ellipse", rect: "rectangle", poly: "polygon", blob: "blob", line: "line", arc: "arc", dots: "dots", stamp: (rec.vr || "") + " stamp", echo: "echo", connect: "connection", react: (rec.vr || "") + " reaction", tint: "tint", mask: "mask", shift: "shift", texture: "texture" };
      let when = "";
      try { when = " · " + timeFmt.format(new Date(rec.seqServer != null && rec.seqServer > 1e12 ? rec.seqServer : rec.t)); } catch (e) { /* ignore */ }
      return names[rec.s] + when;
    }

    // =====================================================================
    // Archive gallery
    // =====================================================================
    function archiveDays() {
      const days = Array.from(S.byDay.keys()).filter(d => d < S.today).sort();
      if (!days.length) return [];
      const out = [];
      // Every calendar day from the first canvas to yesterday is an entry, quiet days included.
      let d = addDays(S.today, -1);
      const first = days[0];
      let guard = 0;
      while (d >= first && guard++ < 3660) { out.push(d); d = addDays(d, -1); }
      return out;
    }
    function openArchive() {
      if (S.draft && S.draft.stage === "pending") return;
      S.view = "archive";
      S.sel = null; S.selCycle = null;
      renderArchive();
      el.arch.hidden = false;
      refreshHud();
      requestDraw();
    }
    function openToday() {
      S.view = "today"; S.viewDay = null; S.sel = null; S.selCycle = null;
      el.arch.hidden = true;
      artDirty = true;
      refreshHud();
      requestDraw();
    }
    function openDay(d) {
      if (d === S.today) return openToday();
      S.view = "day"; S.viewDay = d; S.sel = null; S.selCycle = null;
      el.arch.hidden = true;
      artDirty = true;
      refreshHud();
      requestDraw();
    }
    function renderArchive() {
      const sa = ctx.safeArea || {};
      el.arch.style.paddingTop = ((el.top.offsetHeight || 56) + (sa.top || 0) + 6) + "px";
      el.arch.style.paddingBottom = ((sa.bottom || 0) + 24) + "px";
      const days = archiveDays();
      el.arch.innerHTML = `<h2>The archive</h2><p class="lede">Every day the community makes one composition. At midnight (IST) it closes and joins this collection, unchanged and permanent.</p><div class="dcc-grid"></div>`;
      const grid = el.arch.querySelector(".dcc-grid");
      const entries = [S.today].concat(days);
      for (const d of entries) {
        const list = recordsFor(d);
        const card = document.createElement("button");
        card.type = "button"; card.className = "dcc-card";
        const isToday = d === S.today;
        card.setAttribute("aria-label", (isToday ? "Today, " : "Archived canvas, ") + longDay(d) + ", " + list.length + " marks");
        const authors = new Set(list.filter(r => r.author).map(r => r.author));
        const ppl = list.length && authors.size && list.every(r => r.author) ? " · " + authors.size + (authors.size === 1 ? " person" : " people") : "";
        card.innerHTML = `<div class="ph"></div><div class="cd">${prettyDay(d)}${isToday ? '<span class="dcc-live">LIVE</span>' : '<span class="dcc-ro">KEPT</span>'}</div><div class="cm">${list.length ? list.length + (list.length === 1 ? " mark" : " marks") + ppl : "a quiet day"}</div>`;
        card.dataset.day = d;
        grid.appendChild(card);
        // Thumbnails are derived from the stored records, never stored themselves.
        const ph = card.querySelector(".ph");
        thumbFor(d, 280).then(url => {
          if (!url || !ph.isConnected) return;
          const img = document.createElement("img");
          img.alt = ""; img.className = "th";
          img.onload = () => { if (ph.isConnected) ph.replaceWith(img); };
          img.src = url;
        }, () => { /* the card still opens the day */ });
      }
    }
    let thumbQueue = Promise.resolve();
    function thumbFor(d, pw) {
      const list = recordsFor(d);
      const key = d + ":" + pw + ":" + list.length + ":" + S.lastSnapshotSig;
      if (thumbCache.has(key)) return thumbCache.get(key);
      // Rendered one at a time through a shared bitmap.
      const job = thumbQueue.then(async () => {
        const ph = Math.round(pw * H / W);
        const L = makeLayer(pw, ph, "thumb");
        renderComposition(L.getContext("2d"), pw, ph, list, lookupFor(d));
        const blob = L.convertToBlob ? await L.convertToBlob({ type: "image/png" }) : await new Promise(r => L.toBlob(r, "image/png"));
        return blob ? URL.createObjectURL(blob) : null;
      });
      thumbQueue = job.catch(() => null);
      thumbCache.set(key, job);
      return job;
    }
    function clearThumbs() {
      for (const job of thumbCache.values()) job.then(url => { if (url) URL.revokeObjectURL(url); }, () => {});
      thumbCache.clear();
    }

    // =====================================================================
    // Pointer interaction on the canvas
    // =====================================================================
    let ptr = null;
    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function inCanvas(p) { return p.x >= rect.x - 4 && p.x <= rect.x + rect.w + 4 && p.y >= rect.y - 4 && p.y <= rect.y + rect.h + 4; }

    ctx.listen(canvas, "pointerdown", e => {
      if (S.view === "archive" || ptr) return;
      const p = localPoint(e);
      if (!inCanvas(p)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      ctx.platform.start();
      const u = toUnits(p.x, p.y);
      ptr = { id: e.pointerId, start: p, su: u, last: u, moved: false, t0: Date.now() };
      if (isLive() && S.mode === "add" && (!S.draft || S.draft.stage !== "pending")) {
        if (S.tool.add === "brush") ptr.pts = [u.x, u.y];
      }
      e.preventDefault && e.preventDefault();
    });
    ctx.listen(canvas, "pointermove", e => {
      if (!ptr || e.pointerId !== ptr.id) return;
      const p = localPoint(e), u = toUnits(p.x, p.y);
      if (!ptr.moved && Math.hypot(p.x - ptr.start.x, p.y - ptr.start.y) < 7) return;
      if (!ptr.moved) {
        ptr.moved = true;
        if (isLive() && S.mode !== "add" && !S.sel) {
          // Pressing on a mark and dragging selects it in one gesture.
          if (selectAt(ptr.su)) onTargetChanged();
        }
      }
      ptr.last = u;
      onDrag(u, false);
    });
    function endPointer(e, cancelled) {
      if (!ptr || e.pointerId !== ptr.id) return;
      const p = localPoint(e), u = toUnits(p.x, p.y);
      const wasTap = !ptr.moved && Date.now() - ptr.t0 < 600;
      if (!cancelled) {
        if (wasTap) onTap(ptr.su);
        else onDrag(u, true);
      }
      ptr = null;
    }
    ctx.listen(canvas, "pointerup", e => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", e => endPointer(e, true));

    function onTap(u) {
      if (!isLive()) {
        selectAt(u);
        refreshHud(); requestDraw();
        return;
      }
      if (S.draft && S.draft.stage === "pending") return;
      if (S.mode === "add") {
        const rec = addFromGesture(u, null);
        if (rec) startDraft(rec);
        return;
      }
      const prev = S.sel;
      selectAt(u);
      if (S.sel !== prev || S.tool[S.mode] !== "connect") onTargetChanged();
      refreshHud(); requestDraw();
    }

    function onDrag(u, done) {
      if (!isLive() || (S.draft && S.draft.stage === "pending")) return;
      if (S.mode === "add") {
        if (S.tool.add === "brush") {
          const pts = ptr.pts;
          const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
          if (Math.hypot(u.x - lx, u.y - ly) >= 5 && pts.length < 2000) pts.push(Math.round(clamp(u.x, -50, W + 50)), Math.round(clamp(u.y, -50, H + 50)));
          const rec = addFromGesture(ptr.su, u);
          if (rec) { S.draft = { rec, stage: "draft" }; if (done) startDraft(rec); else requestDraw(); }
        } else {
          const rec = addFromGesture(ptr.su, u);
          if (rec) { S.draft = { rec, stage: "draft" }; if (done) startDraft(rec); else requestDraw(); }
        }
        return;
      }
      if (!S.sel) return;
      const tool = S.tool[S.mode];
      if (["echo", "connect", "mask", "shift"].includes(tool)) {
        draftForTarget(ptr.su, u);
      }
    }

    function addFromGesture(a, b) {
      const tool = S.tool.add;
      const cl = (v, max) => Math.round(clamp(v, -40, max + 40));
      let rec;
      if (tool === "brush") {
        rec = baseRec("add", "brush");
        const pts = ptr && ptr.pts ? ptr.pts.slice() : [Math.round(a.x), Math.round(a.y)];
        rec.g = { p: pts.map((v, i) => Math.round(i % 2 ? clamp(v, -50, H + 50) : clamp(v, -50, W + 50))) };
      } else if (tool === "shape") {
        rec = baseRec("add", S.shapeKind);
        let x0, y0, x1, y1;
        if (!b) { const s = 70 + S.size * 1.2; x0 = a.x - s; y0 = a.y - s; x1 = a.x + s; y1 = a.y + s; }
        else { x0 = a.x; y0 = a.y; x1 = b.x; y1 = b.y; }
        rec.g = { x0: cl(x0, W), y0: cl(y0, H), x1: cl(x1, W), y1: cl(y1, H) };
        if (S.shapeKind === "poly") rec.g.n = 3 + (Math.abs(fnv(S.today + ":" + Math.round(a.x) + ":" + Math.round(a.y))) % 5);
      } else if (tool === "line") {
        const arc = S.variant.line === "arc";
        rec = baseRec("add", arc ? "arc" : "line");
        const e = b || { x: a.x + 180, y: a.y };
        rec.g = { x0: cl(a.x, W), y0: cl(a.y, H), x1: cl(e.x, W), y1: cl(e.y, H) };
        if (arc) rec.g.b = 0.35;
      } else if (tool === "dots") {
        rec = baseRec("add", "dots");
        const R = b ? Math.hypot(b.x - a.x, b.y - a.y) : 80;
        rec.g = { x: cl(a.x, W), y: cl(a.y, H), R: Math.round(clamp(R, 8, 600)) };
      } else if (tool === "stamp") {
        rec = baseRec("add", "stamp");
        const Sz = b ? Math.hypot(b.x - a.x, b.y - a.y) * 2 : 200;
        rec.g = { x: cl(a.x, W), y: cl(a.y, H), S: Math.round(clamp(Sz, 40, 900)) };
      }
      if (!rec) return null;
      S.draft = { rec, stage: "draft" };
      applyStyleToDraft();
      return rec;
    }

    // Keyboard support
    ctx.listen(window, "keydown", e => {
      const tag = e.target && e.target.tagName;
      if (e.key === "Escape") { if (S.sel) { S.sel = null; S.selCycle = null; } cancelDraft(); refreshHud(); requestDraw(); }
      else if (e.key === "Enter" && S.draft && tag !== "BUTTON" && tag !== "INPUT") { commit(); }
      else if (tag !== "INPUT" && isLive() && (e.key === "1" || e.key === "2" || e.key === "3")) setMode(["add", "con", "tf"][Number(e.key) - 1]);
    });

    // =====================================================================
    // Lifecycle
    // =====================================================================
    ctx.onResize(() => {
      computeLayout();
      if (S.view === "archive") renderArchive();
    }, { immediate: true });

    ctx.onFrame(() => {
      if (needsDraw) { needsDraw = false; draw(); }
    });

    ctx.interval(() => {
      if (destroyed) return;
      checkRollover();
      if (!S.syncing && Date.now() - S.lastAttempt >= pollDelay()) refresh();
      updateSync();
    }, 1000);

    ctx.listen(document, "visibilitychange", () => { if (!document.hidden) refresh(); });
    ctx.listen(window, "online", () => { S.fails = Math.min(S.fails, 1); refresh(); });
    ctx.onDestroy(() => { destroyed = true; clearThumbs(); });

    // Optional typography from the approved font registry (never blocks play).
    (async () => {
      try {
        await Promise.all([
          ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "400" }),
          ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "700" }),
          ctx.loadFont("DM Serif Display", "dm-serif-display", "1.0.0", { weight: "400", style: "normal" })
        ]);
        if (!destroyed) { computeLayout(); requestDraw(); }
      } catch (e) { /* system fonts are fine */ }
    })();

    buildVariants();
    refreshHud();
    computeLayout();
    draw();
    needsDraw = false;
    ctx.platform.ready();

    // Recover local convenience state, then load the shared canvas.
    const [savedDraft, savedCounts] = await Promise.all([load("dcc:draft"), load("dcc:count")]);
    if (savedCounts && typeof savedCounts === "object") localCounts = savedCounts;
    await refresh();
    if (savedDraft && savedDraft.rec && !S.draft && !destroyed) {
      const r = savedDraft.rec;
      if (r.d && KINDS[r.k] && KINDS[r.k].includes(r.s)) {
        const mode = r.k;
        S.mode = mode;
        S.tool[mode] = familyOf(r.s);
        if (r.k !== "add") S.sel = r.tg && r.tg[0];
        r.draft = true; r.id = "draft"; r.seed = 99991;
        S.draft = { rec: r, stage: savedDraft.id ? "failed" : "draft", id: savedDraft.id, obj: savedDraft.obj, error: savedDraft.id ? "Recovered an unsaved draft. Retry to save it." : null, retryable: true };
        if (r.d !== S.today) S.draft.stale = true;
        if (r.k !== "add" && !lookupFor(r.d)(S.sel)) { S.draft = null; S.sel = null; S.mode = "add"; }
        buildVariants();
        refreshHud();
        requestDraw();
        if (S.draft) toast("Recovered your unsaved draft.", 2600);
      }
    }
  }
};
