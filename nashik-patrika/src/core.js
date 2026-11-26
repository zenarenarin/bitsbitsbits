/*
 * core.js — randomness, noise, camera, cards, and watercolour primitives.
 *
 * Everything is painted once, at load, into "cards". A card is a flat painted
 * piece of the world that lies in one physical plane. Because the camera only
 * ever translates sideways, every plane's image moves by an exact affine
 * shear/scale (1/Z is affine in screen space for any plane), so a card can be
 * re-projected each frame with a single canvas transform and nothing has to
 * be repainted. This is what keeps the camera move physically correct while
 * the painting stays hand-made.
 */
(function () {
  const P = (window.P = window.P || {});

  // ---------------------------------------------------------------- random
  P.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // value noise; optional period for tileable textures
  P.vnoise = function (x, y, s = 0, px = 0, py = 0) {
    let xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    let x1 = xi + 1, y1 = yi + 1;
    if (px) { xi = ((xi % px) + px) % px; x1 = ((x1 % px) + px) % px; }
    if (py) { yi = ((yi % py) + py) % py; y1 = ((y1 % py) + py) % py; }
    const a = hash(xi, yi, s), b = hash(x1, yi, s), c = hash(xi, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  P.fbm = function (x, y, oct = 4, s = 0, px = 0, py = 0) {
    let sum = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * P.vnoise(x * f, y * f, s + i * 17, px * f, py * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };
  P.lerp = (a, b, t) => a + (b - a) * t;
  P.clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  P.smooth = (a, b, x) => { const t = P.clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- colour
  P.hex = function (h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  P.mix = function (a, b, t) {
    const A = P.hex(a), B = P.hex(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  P.shade = (c, t) => P.mix(c, t > 0 ? '#ffffff' : '#1d1a1c', Math.abs(t));

  // ---------------------------------------------------------------- canvas
  P.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  // Tileable textures, generated once at device resolution.
  P.makeTextures = function (seed) {
    const T = {};
    const gen = (size, fn) => {
      const c = P.canvas(size, size), x = c.getContext('2d');
      const img = x.createImageData(size, size), d = img.data;
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const a = P.clamp(fn(i, j));
          const k = (j * size + i) * 4;
          d[k] = d[k + 1] = d[k + 2] = 0;
          d[k + 3] = Math.round(a * 255);
        }
      x.putImageData(img, 0, 0);
      return c;
    };
    const N = 512;
    // broad pigment unevenness (blooms, uneven drying)
    T.blotch = gen(N, (i, j) => {
      const n = P.fbm(i / 128, j / 128, 4, seed + 1, 4, 4);
      const d = P.fbm(i / 32, j / 32, 2, seed + 9, 16, 16);
      return P.smooth(0.3, 0.85, n * 0.8 + d * 0.2);
    });
    // granulation: pigment settling into paper tooth
    T.gran = gen(N, (i, j) => {
      // pigment settling in the paper's tooth: soft clusters, not salt
      const n = P.fbm(i / 2.4, j / 2.4, 2, seed + 2, N / 2.4 | 0, N / 2.4 | 0);
      const c = P.fbm(i / 9, j / 9, 2, seed + 8, N / 9 | 0, N / 9 | 0);
      const m = P.fbm(i / 48, j / 48, 2, seed + 3, N / 48 | 0, N / 48 | 0);
      return (0.55 * P.smooth(0.42, 0.95, n) + 0.45 * P.smooth(0.4, 0.8, c)) * (0.35 + 0.65 * m);
    });
    // paper tooth, used in multiply over the finished frame
    T.paper = gen(N, (i, j) => {
      const fine = P.vnoise(i / 1.3, j / 1.3, seed + 4, N / 1.3 | 0, N / 1.3 | 0);
      const fib = P.fbm(i / 9, j / 2.2, 2, seed + 5, N / 9 | 0, N / 2.2 | 0);
      const big = P.fbm(i / 90, j / 90, 3, seed + 6, N / 90 | 0, N / 90 | 0);
      return 0.10 * fine + 0.10 * fib + 0.10 * big;
    });
    // fine wet-edge noise for backruns
    T.bloom = gen(N, (i, j) => {
      const n = P.fbm(i / 18, j / 18, 3, seed + 7, N / 18 | 0, N / 18 | 0);
      return P.smooth(0.52, 0.58, n) * 0.9;
    });
    return T;
  };

  // ---------------------------------------------------------------- camera
  // Pinhole camera with vertical lens shift (verticals stay vertical, as an
  // architectural illustrator draws them). World: X right, Y up, Z forward,
  // metres. Water surface is Y = 0.
  P.CAM = { f: 1158, cx: 540, yh: 1390, eye: 2.6, T: 1.3 };
  P.project = function (p, u = 0) {
    const C = P.CAM, X = p[0] - u * C.T;
    return [C.cx + (C.f * X) / p[2], C.yh - (C.f * (p[1] - C.eye)) / p[2]];
  };
  // Clip a world polygon to Z >= zn, then project (things under the
  // viewer's feet must not explode across the frame).
  P.projPoly = function (poly3, u = 0, zn = 1.2) {
    const out = [];
    for (let i = 0; i < poly3.length; i++) {
      const a = poly3[i], b = poly3[(i + 1) % poly3.length];
      const ina = a[2] >= zn, inb = b[2] >= zn;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (zn - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zn]);
      }
    }
    return out.map((p) => P.project(p, u));
  };
  // Fit 1/Z as an affine function of anchor-screen coordinates.
  P.fitInvZ = function (pts3, u = 0) {
    // least squares a*x + b*y + c = 1/Z
    let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
    for (const p of pts3) {
      const [x, y] = P.project(p, u), z = 1 / p[2];
      const v = [x, y, 1];
      for (let i = 0; i < 3; i++) {
        r[i] += v[i] * z;
        for (let j = 0; j < 3; j++) S[i][j] += v[i] * v[j];
      }
    }
    return solve3(S, r);
  };
  function solve3(A, b) {
    const m = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
      [m[i], m[p]] = [m[p], m[i]];
      if (Math.abs(m[i][i]) < 1e-12) m[i][i] = 1e-12;
      for (let k = 0; k < 3; k++) {
        if (k === i) continue;
        const f = m[k][i] / m[i][i];
        for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
      }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }
  // A planar frame: local (a, b) in metres → anchor screen point.
  P.frame = function (origin, ax, ay, u = 0) {
    const f = (a, b) =>
      P.project([origin[0] + ax[0] * a + ay[0] * b, origin[1] + ax[1] * a + ay[1] * b, origin[2] + ax[2] * a + ay[2] * b], u);
    f.w = (a, b) => [origin[0] + ax[0] * a + ay[0] * b, origin[1] + ax[1] * a + ay[1] * b, origin[2] + ax[2] * a + ay[2] * b];
    f.poly = (pts) => pts.map(([a, b]) => f(a, b));
    f.rect = (a0, b0, a1, b1) => f.poly([[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
    // scale in px per metre at a local point (horizontal)
    f.scale = (a, b) => { const p = f(a, b), q = f(a + 0.01, b); return Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.01; };
    return f;
  };

  // ---------------------------------------------------------------- cards
  P.SCALE = 1; // device px per design px (2 for print stills)
  P.card = function (name, bx, by, bw, bh, opts = {}) {
    const S = P.SCALE;
    const c = P.canvas(bw * S, bh * S);
    const ctx = c.getContext('2d');
    ctx.setTransform(S, 0, 0, S, -bx * S, -by * S);
    ctx.S = S; ctx.bx = bx; ctx.by = by; ctx.bw = bw; ctx.bh = bh;
    return { name, canvas: c, ctx, bx, by, bw, bh, uA: opts.uA || 0, inv: opts.inv || [0, 0, 0], z: opts.z || 0 };
  };
  // Horizontal displacement field at progress u for a card point.
  P.cardTransform = function (card, u) {
    const k = (card.uA - u) * P.CAM.f * P.CAM.T;
    const [a, b, c] = card.inv;
    return [1 + k * a, 0, k * b, 1, k * c, 0];
  };
  P.drawCard = function (ctx, card, u, opts = {}) {
    const S = P.SCALE, m = P.cardTransform(card, u);
    ctx.save();
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.transform(m[0], m[1], m[2], m[3], m[4] + (opts.dx || 0), m[5]);
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.op) ctx.globalCompositeOperation = opts.op;
    if (opts.filter) ctx.filter = opts.filter;
    ctx.drawImage(card.canvas, card.bx, card.by, card.bw, card.bh);
    ctx.restore();
  };

  // ---------------------------------------------------------------- shapes
  // Subdivide a polygon and push points along the normal by smooth noise:
  // the slight tremor of a hand-drawn edge.
  P.wobble = function (poly, amp, step = 5, seed = 1, closed = true, freq = 0.08) {
    if (!amp) return poly;
    const out = [];
    const n = poly.length, segs = closed ? n : n - 1;
    let dist = 0;
    for (let i = 0; i < segs; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const k = Math.max(1, Math.ceil(L / step));
      for (let j = 0; j < k; j++) {
        const t = j / k, d = dist + t * L;
        const w = (P.fbm(d * freq, i * 3.1 + seed, 2, seed) - 0.5) * 2 * amp;
        out.push([a[0] + dx * t + nx * w, a[1] + dy * t + ny * w]);
      }
      dist += L;
    }
    if (!closed) out.push(poly[n - 1]);
    return out;
  };
  P.path = function (ctx, poly, closed = true) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    if (closed) ctx.closePath();
  };
  P.ellipse = function (cx, cy, rx, ry, n = 40, a0 = 0, a1 = Math.PI * 2) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return out;
  };
  P.bbox = function (poly) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  };

  // ---------------------------------------------------------------- paint
  let scratch = null;
  function getScratch(w, h) {
    if (!scratch || scratch.width < w || scratch.height < h) {
      scratch = P.canvas(Math.max(w, scratch ? scratch.width : 0), Math.max(h, scratch ? scratch.height : 0));
    }
    const x = scratch.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.filter = 'none';
    x.clearRect(0, 0, w, h);
    return [scratch, x];
  }
  let texOff = 0;
  function texFill(x, tex, alpha, S, offx, offy) {
    const pat = x.createPattern(tex, 'repeat');
    pat.setTransform(new DOMMatrix().translate(offx, offy));
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = alpha;
    x.fillStyle = pat;
    x.fillRect(0, 0, x.canvas.width, x.canvas.height);
    x.restore();
  }

  /*
   * wash — a single watercolour glaze.
   *  color   pigment colour
   *  alpha   overall strength
   *  rough   edge tremor in px (architecture ~0.6–1.5, foliage/sky 4–30)
   *  layers  number of slightly different passes (soft, irregular edges)
   *  soft    blur radius in px (wet-in-wet)
   *  blotch  0..1 uneven pigment
   *  gran    0..1 granulation
   *  edge    0..1 darkened drying edge
   *  mode    composite op onto the card (default multiply)
   *  grad    optional [x0,y0,x1,y1, stops] linear gradient instead of flat
   */
  P.wash = function (ctx, poly, o = {}) {
    const S = ctx.S || 1;
    const color = o.color || '#888888';
    const rough = o.rough == null ? 1 : o.rough;
    const soft = o.soft || 0;
    const layers = o.layers || 1;
    const seed = o.seed == null ? (texOff = (texOff + 7919) % 100003) : o.seed;
    if (poly.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) return;
    let [x0, y0, x1, y1] = P.bbox(poly);
    const pad = rough * 2.5 + soft * 3 + 6;
    // only the part that can land on this card is worth painting
    const m = 24 + soft * 3;
    x0 = Math.max(x0 - pad, ctx.bx - m); y0 = Math.max(y0 - pad, ctx.by - m);
    x1 = Math.min(x1 + pad, ctx.bx + (ctx.bw || 1e5) + m); y1 = Math.min(y1 + pad, ctx.by + (ctx.bh || 1e5) + m);
    if (x1 <= x0 || y1 <= y0) return;
    const dx = Math.floor((x0 - ctx.bx) * S), dy = Math.floor((y0 - ctx.by) * S);
    const w = Math.ceil((x1 - x0) * S) + 2, h = Math.ceil((y1 - y0) * S) + 2;
    if (w <= 2 || h <= 2) return;
    const [sc, x] = getScratch(w, h);
    x.setTransform(S, 0, 0, S, -ctx.bx * S - dx, -ctx.by * S - dy);
    let fill = color;
    if (o.grad) {
      const [gx0, gy0, gx1, gy1, stops] = o.grad;
      const g = x.createLinearGradient(gx0, gy0, gx1, gy1);
      for (const [t, c] of stops) g.addColorStop(t, c);
      fill = g;
    } else if (o.radial) {
      const [cx, cy, r, stops] = o.radial;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (const [t, c] of stops) g.addColorStop(t, c);
      fill = g;
    }
    x.fillStyle = fill;
    if (soft) x.filter = `blur(${soft * S}px)`;
    const a1 = layers > 1 ? 1 - Math.pow(0.08, 1 / layers) : 1;
    // a glaze laid by hand never sits exactly in its outline: it slips a
    // little past one edge and falls short of another
    let src = poly;
    if (rough < 2 && o.slip !== 0) {
      const rr = P.rng(seed + 5), k = o.slip == null ? 1 : o.slip;
      const sx = (rr() - 0.5) * 2.2 * k, sy = (rr() - 0.5) * 1.6 * k;
      const [cx0, cy0, cx1, cy1] = P.bbox(poly);
      const cx = (cx0 + cx1) / 2, cy = (cy0 + cy1) / 2, size = Math.max(20, Math.max(cx1 - cx0, cy1 - cy0)), sc = 1 + ((rr() - 0.5) * 2.4 * k) / size;
      src = poly.map(([px, py]) => [cx + (px - cx) * sc + sx, cy + (py - cy) * sc + sy]);
    }
    for (let i = 0; i < layers; i++) {
      const pts = P.wobble(src, rough * (layers > 1 ? 1 + i * 0.25 : 1), Math.max(2.5, rough * 2), seed + i * 31, true, o.freq || 0.08);
      x.globalAlpha = a1;
      P.path(x, pts);
      x.fill();
    }
    x.filter = 'none';
    const ox = -dx - ((seed * 37) % 512), oy = -dy - ((seed * 91) % 512);
    x.globalCompositeOperation = 'destination-out';
    if (o.blotch) texFill(x, P.TEX.blotch, o.blotch, S, ox - ctx.bx * S, oy - ctx.by * S);
    if (o.gran) texFill(x, P.TEX.gran, o.gran, S, ox, oy);
    if (o.bloom) texFill(x, P.TEX.bloom, o.bloom, S, ox * 0.7, oy * 1.3);
    if (o.edge) {
      x.globalCompositeOperation = 'source-atop';
      x.setTransform(S, 0, 0, S, -ctx.bx * S - dx, -ctx.by * S - dy);
      x.strokeStyle = o.edgeColor || P.shade(color, -0.35);
      x.lineWidth = o.edgeW || 1.6;
      x.globalAlpha = o.edge;
      x.filter = `blur(${0.8 * S}px)`;
      P.path(x, P.wobble(poly, rough, Math.max(2.5, rough * 2), seed, true, o.freq || 0.08));
      x.stroke();
      x.filter = 'none';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.globalCompositeOperation = o.mode || 'multiply';
    ctx.drawImage(sc, 0, 0, w, h, dx, dy, w, h);
    ctx.restore();
  };

  // An opaque, paper-coloured silhouette: lets a card occlude what is behind
  // it before glazes are laid over it (watercolourists paint around shapes).
  P.ground = function (ctx, poly, color = '#f1eadc', rough = 0.6, seed = 3) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    P.path(ctx, P.wobble(poly, rough, 3, seed));
    ctx.fill();
    ctx.restore();
  };

  /*
   * ink — a restrained drawn line, slightly tremulous, thinning and breaking.
   */
  P.ink = function (ctx, pts, o = {}) {
    const w = o.w || 1, color = o.color || '#2d2826';
    const seed = o.seed == null ? (texOff = (texOff + 4243) % 100003) : o.seed;
    const r = P.rng(seed);
    const line = P.wobble(pts, o.wobble == null ? 0.5 : o.wobble, o.step || 4, seed, false, 0.12);
    ctx.save();
    ctx.globalCompositeOperation = o.mode || 'multiply';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const gap = o.gaps == null ? 0.04 : o.gaps;
    let i = 0;
    while (i < line.length - 1) {
      const run = 3 + Math.floor(r() * 9);
      ctx.beginPath();
      ctx.moveTo(line[i][0], line[i][1]);
      let j = i + 1;
      for (; j < Math.min(line.length, i + run + 1); j++) ctx.lineTo(line[j][0], line[j][1]);
      ctx.globalAlpha = (o.alpha == null ? 0.7 : o.alpha) * (0.65 + 0.35 * r());
      ctx.lineWidth = w * (0.7 + 0.5 * r());
      ctx.stroke();
      i = j - 1;
      if (r() < gap) i += 1 + Math.floor(r() * 2);
    }
    ctx.restore();
  };

  // Pencil underdrawing: a thin line that overshoots its corners, as an
  // architectural draughtsman's construction lines do.
  P.pencil = function (ctx, a, b, o = {}) {
    const seed = o.seed == null ? (texOff = (texOff + 211) % 100003) : o.seed;
    const r = P.rng(seed);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const o0 = (o.over == null ? 6 : o.over) * (0.4 + r()), o1 = (o.over == null ? 6 : o.over) * (0.4 + r());
    P.ink(ctx, [[a[0] - ux * o0, a[1] - uy * o0], [b[0] + ux * o1, b[1] + uy * o1]], {
      w: o.w || 0.6, alpha: o.alpha || 0.3, wobble: o.wobble == null ? 0.35 : o.wobble, gaps: 0.1, color: o.color || '#4b4446', seed, step: 5,
    });
  };

  // Dry-brush: broken parallel drags, for weathered stone and worn treads.
  P.dry = function (ctx, x, y, len, ang, o = {}) {
    const seed = o.seed == null ? (texOff = (texOff + 1543) % 100003) : o.seed;
    const r = P.rng(seed);
    const n = o.n || 5, w = o.w || 6, color = o.color || '#555';
    const c = Math.cos(ang), s = Math.sin(ang);
    ctx.save();
    ctx.globalCompositeOperation = o.mode || 'multiply';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const off = (i / Math.max(1, n - 1) - 0.5) * w;
      let t = r() * 0.15;
      while (t < 1) {
        const l = 0.05 + r() * 0.3;
        const t1 = Math.min(1, t + l);
        const ax = x + c * len * t - s * off, ay = y + s * len * t + c * off;
        const bx = x + c * len * t1 - s * off, by = y + s * len * t1 + c * off;
        ctx.globalAlpha = (o.alpha || 0.2) * (0.4 + r() * 0.6);
        ctx.lineWidth = (o.lw || 0.9) * (0.5 + r());
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        t = t1 + r() * 0.2;
      }
    }
    ctx.restore();
  };

  // Soft spots of colour, wet-in-wet.
  P.dab = function (ctx, x, y, r, color, alpha, soft = 0.5) {
    P.wash(ctx, P.ellipse(x, y, r, r * (0.7 + 0.3 * Math.sin(x)), 18), { color, alpha, rough: r * 0.25, soft: r * soft, freq: 0.2 });
  };
})();
