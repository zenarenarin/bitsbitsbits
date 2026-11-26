/*
 * scene.js — one view of the Godavari at Panchavati, Nashik, on a soft
 * morning.
 *
 * We stand inside an old stone pavilion on the ghat: one of its pillars and
 * the spring of its arch frame the left edge, a flowering palash branch hangs
 * over them. Below, on the steps, a married couple sits looking out at the
 * river, a brass thali of marigolds and a lota beside them.
 *
 * The river runs away from us diagonally: our bank of ghats climbs up the left
 * with a round domed pavilion and the temples behind it; across the water on
 * the right, the tall arcaded tower stands in the river on its platform, the
 * town and the hills beyond. Light comes from the left.
 *
 * Coordinates are design pixels in a 1080 × 1920 frame.
 */
(function () {
  const P = window.P;
  const SC = (P.SC = {});
  const W = 1080, H = 1920;
  const WL = 1452;                 // the far (right) bank's waterline
  SC.WL = WL;
  // our bank's water edge, receding from the bottom toward the distance
  const EDGE = [[505, 1960], [520, 1830], [548, 1720], [585, 1630], [630, 1560], [680, 1505], [730, 1470], [790, 1452]];
  SC.EDGE = EDGE;

  const C = (SC.C = {
    paper: '#f4ede0',
    ink: '#2f2a2c',
    shade: '#8b93a8',        // cool shadow glaze
    shadeDeep: '#5d6178',
    lime: '#efe3c8',
    limeWarm: '#ead2a6',
    ochre: '#d9ad6f',
    sand: '#d8bd96',
    terracotta: '#b7694c',
    roof: '#a95f45',
    basalt: '#6e6566',
    basaltLit: '#9d8d82',
    stone: '#b4a28d',
    stoneLit: '#d6c4a7',
    opening: '#3e3236',
    saffron: '#df8a2c',
    leaf: '#7f8a4c',
    leafDark: '#4f5a37',
    palash: '#e5732c',
    haze: '#c7cdd2',
  });

  const rng = P.rng(2027);
  const r = () => rng();
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // closed Catmull-Rom spline through points → polygon (organic shapes)
  const spline = (pts, n = 8, closed = true) => {
    const out = [], N = pts.length;
    const at = (i) => pts[closed ? (i + N) % N : Math.max(0, Math.min(N - 1, i))];
    for (let i = 0; i < (closed ? N : N - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    if (!closed) out.push(pts[N - 1]);
    return out;
  };
  const body = (x, pts, col, o = {}) => {
    P.ground(x, pts, C.paper, o.gr == null ? 0.5 : o.gr);
    P.wash(x, pts, Object.assign({ color: col, alpha: 0.85, rough: 0.7, gran: 0.25, blotch: 0.5, edge: 0.3 }, o));
  };
  const glaze = (x, pts, col, a, o = {}) => P.wash(x, pts, Object.assign({ color: col, alpha: a, rough: 0.6, soft: 0.6 }, o));
  const lit = (x, a, b, al = 0.5, w = 1.2) => P.ink(x, [a, b], { w, alpha: al, wobble: 0.3, gaps: 0.15, color: '#fbf1dc', mode: 'source-over' });
  const cusped = (x0, x1, yb, ys, rise, n = 14) => {
    const pts = [[x0, yb], [x1, yb], [x1, ys]];
    for (let i = 1; i < n; i++) {
      const a = Math.PI * (i / n), c = 1 + 0.11 * Math.abs(Math.sin(a * 4));
      pts.push([(x0 + x1) / 2 + (Math.cos(a) * (x1 - x0) * c) / 2, ys - Math.sin(a) * rise * c]);
    }
    pts.push([x0, ys]);
    return pts;
  };
  const bulb = (cx, by, rw, h, n = 28) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = Math.PI * t, s = Math.sin(a);
      const k = 1 + 0.14 * s * s - 0.08 * Math.pow(Math.sin(a * 2), 2);
      pts.push([cx - Math.cos(a) * rw * k, by - s * h * 0.72]);
    }
    const left = pts.slice(0, Math.floor(n * 0.42)), right = pts.slice(Math.ceil(n * 0.58));
    return [[cx - rw, by], ...left, [cx - rw * 0.18, by - h * 0.88], [cx, by - h], [cx + rw * 0.18, by - h * 0.88], ...right, [cx + rw, by]];
  };
  const finial = (x, cx, ty, s, col) => {
    P.wash(x, P.ellipse(cx, ty - s * 0.25, s * 0.5, s * 0.22, 10), { color: col, alpha: 0.85, rough: 0.05, slip: 0 });
    P.wash(x, [[cx - s * 0.12, ty - s * 0.3], [cx + s * 0.12, ty - s * 0.3], [cx + s * 0.03, ty - s * 1.6], [cx - s * 0.03, ty - s * 1.6]], { color: col, alpha: 0.85, rough: 0.05, slip: 0 });
  };
  const flag = (x, cx, ty, s) => {
    P.ink(x, [[cx, ty], [cx + 0.5, ty - s * 3.4]], { w: 0.9, alpha: 0.65, wobble: 0.1, gaps: 0, color: C.ink });
    P.wash(x, [[cx + 0.6, ty - s * 3.4], [cx + s * 2.3, ty - s * 2.9], [cx + 0.6, ty - s * 2.4]], { color: C.saffron, alpha: 0.85, rough: 0.2, slip: 0 });
  };
  // basalt shikhara, lit from the left
  const shikhara = (x, cx, by, w, h, o = {}) => {
    const base = o.col || C.basalt, litc = o.lit || C.basaltLit;
    const hw = (t) => (w / 2) * (1 - 0.6 * Math.pow(t, 1.55)) * (1 + 0.1 * Math.sin(Math.PI * t * 0.9));
    const prof = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push([cx - hw(t), by - t * h]); }
    for (let i = 20; i >= 0; i--) { const t = i / 20; prof.push([cx + hw(t), by - t * h]); }
    if (o.minis !== false) for (const sd of [-1, 1]) {
      const mc = cx + sd * w * 0.38, mw = w * 0.36, mh = h * 0.46, mp = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; mp.push([mc - (mw / 2) * (1 - 0.6 * t ** 1.5), by - t * mh]); }
      for (let i = 10; i >= 0; i--) { const t = i / 10; mp.push([mc + (mw / 2) * (1 - 0.6 * t ** 1.5), by - t * mh]); }
      body(x, mp, sd < 0 ? litc : base, { alpha: 0.85 });
    }
    body(x, prof, base, { alpha: 0.85, grad: [cx - w / 2, 0, cx + w / 2, 0, [[0, litc], [0.45, P.mix(litc, base, 0.5)], [0.6, base], [1, P.mix(base, C.shadeDeep, 0.4)]]] });
    for (let i = 1; i < 12; i++) {
      const t = i / 12, y = by - t * h, ww = hw(t);
      P.ink(x, [[cx - ww * 0.96, y], [cx, y + 1.2], [cx + ww * 0.96, y]], { w: 0.5, alpha: i % 3 ? 0.18 : 0.32, wobble: 0.2, gaps: 0.1, color: C.shadeDeep });
    }
    const tw = hw(1);
    P.wash(x, P.ellipse(cx, by - h - tw * 0.25, tw * 1.35, tw * 0.42, 18), { color: P.mix(base, litc, 0.3), alpha: 0.85, rough: 0.1, slip: 0 });
    const fs = Math.max(3, w * 0.06);
    finial(x, cx, by - h - tw * 0.6, fs, '#8c6a3e');
    if (o.flag) flag(x, cx, by - h - tw * 0.6 - fs * 1.5, Math.max(3, w * 0.075));
  };
  const domeOn = (x, cx, by, rw, h, col, o = {}) => {
    const d = bulb(cx, by, rw, h);
    body(x, d, col, { alpha: 0.86, grad: [cx - rw, 0, cx + rw, 0, [[0, P.mix(col, '#fff6e4', 0.35)], [0.5, col], [1, P.mix(col, C.shadeDeep, 0.35)]]] });
    finial(x, cx, by - h, Math.max(2.5, rw * 0.14), '#8c6a3e');
    if (o.flag) flag(x, cx, by - h - rw * 0.25, Math.max(2.5, rw * 0.12));
  };
  // a house: lit front, narrow shaded side, windows, sometimes a balcony
  const house = (x, x0, x1, top, base, local, o = {}) => {
    const side = o.side || 0; // width of the visible shaded side (on the right)
    const tile = o.roof === 'tile', pitch = o.pitch || 10;
    if (side) body(x, [[x1, base], [x1 + side, base - side * 0.15], [x1 + side, top - side * 0.1], [x1, top]], P.mix(local, C.shade, 0.5), { alpha: 0.86 });
    body(x, rect(x0, top, x1, base), local, { alpha: 0.84 });
    glaze(x, rect(x0, top + (base - top) * 0.5, x1, base), C.shade, 0.16, { soft: 2 });
    if (tile) {
      const roof = [[x0 - 4, top + 3], [x1 + 4 + side, top + 3], [x1 - (x1 - x0) * 0.08 + side * 0.5, top - pitch], [x0 + (x1 - x0) * 0.08, top - pitch]];
      body(x, roof, C.roof, { alpha: 0.8 });
      for (let k = 1; k < 3; k++) P.ink(x, [[x0, top + 3 - (pitch * k) / 3], [x1 + side * 0.5, top + 3 - (pitch * k) / 3]], { w: 0.5, alpha: 0.3, wobble: 0.3, color: '#7a3e2c' });
      glaze(x, rect(x0, top + 3, x1, top + 10), C.shadeDeep, 0.35, { soft: 1 });
    } else {
      body(x, rect(x0 - 2, top - 5, x1 + 2, top + 2), P.mix(local, C.stone, 0.4), { alpha: 0.8 });
      glaze(x, rect(x0, top + 2, x1, top + 8), C.shadeDeep, 0.25, { soft: 1 });
    }
    const lr = P.rng(o.seed || 3);
    const rows = o.rows || Math.max(1, Math.floor((base - top) / 30));
    for (let j = 0; j < rows; j++) {
      const yy = top + 14 + j * ((base - top - 14) / rows);
      const n = Math.max(1, Math.floor((x1 - x0) / 18));
      for (let i = 0; i < n; i++) {
        if (lr() < 0.3) continue;
        const wx = x0 + ((i + 0.5) * (x1 - x0)) / n, ww = Math.max(2.5, ((x1 - x0) / n) * 0.34), wh = Math.min(12, ((base - top) / rows) * 0.45);
        P.wash(x, o.arch && lr() < 0.6 ? cusped(wx - ww / 2, wx + ww / 2, yy + wh, yy + ww * 0.5, ww * 0.5, 8) : rect(wx - ww / 2, yy, wx + ww / 2, yy + wh), { color: C.opening, alpha: 0.6, rough: 0.2, slip: 0.4 });
        if (lr() < 0.3) P.wash(x, rect(wx - ww / 2 - ww * 0.6, yy, wx - ww / 2, yy + wh), { color: lr() < 0.5 ? '#6f8e8b' : '#8a5a3f', alpha: 0.5, rough: 0.2, slip: 0 });
      }
    }
    if (o.balcony) {
      const by = top + (base - top) * o.balcony;
      P.wash(x, rect(x0 + 2, by - 9, x1 - 2, by + 3), { color: '#7a5038', alpha: 0.55, rough: 0.3 });
      for (let bx = x0 + 4; bx < x1 - 3; bx += 3.4) P.ink(x, [[bx, by - 8], [bx, by + 2]], { w: 0.5, alpha: 0.4, wobble: 0.05, gaps: 0, color: '#4a3025' });
      glaze(x, rect(x0 + 2, by + 3, x1 - 2, by + 10), C.shadeDeep, 0.3, { soft: 1 });
    }
    lit(x, [x0, top + 2], [x0, base - 3], 0.45, 1.1);
  };
  const tree = (x, cx, cy, R, seed, o = {}) => {
    const tr = P.rng(seed);
    const leaf = o.leaf || C.leaf, dark = o.dark || C.leafDark;
    P.wash(x, [[cx - 3, cy + R * 0.2], [cx + 4, cy + R * 0.2], [cx + 3, cy + R * 1.2], [cx - 4, cy + R * 1.2]], { color: '#5a4636', alpha: 0.7, rough: 0.6 });
    for (let i = 0; i < 10; i++) {
      const a = tr() * Math.PI * 2, d = tr() * R * 0.55, rr = R * (0.28 + tr() * 0.3);
      P.wash(x, P.ellipse(cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * 0.6, rr, rr * 0.75, 22), { color: leaf, alpha: 0.45, rough: rr * 0.3, soft: 0.5, freq: 0.12, layers: 2, gran: 0.2, edge: 0.3 });
    }
    for (let i = 0; i < 5; i++) {
      const rr = R * (0.18 + tr() * 0.2);
      P.wash(x, P.ellipse(cx + (tr() - 0.3) * R, cy + R * (0.1 + tr() * 0.3), rr, rr * 0.55, 16), { color: dark, alpha: 0.4, rough: rr * 0.3, soft: 0.6, freq: 0.12 });
    }
    for (let i = 0; i < 4; i++) {
      const rr = R * (0.12 + tr() * 0.12);
      P.wash(x, P.ellipse(cx - R * 0.35 + (tr() - 0.5) * R * 0.6, cy - R * (0.2 + tr() * 0.3), rr, rr * 0.7, 14), { color: '#c3c38a', alpha: 0.35, rough: rr * 0.3, soft: 0.6, mode: 'source-over' });
    }
  };
  const person = (x, cx, by, h, cloth, o = {}) => {
    const w = h * 0.3;
    P.wash(x, [[cx - w / 2, by - h * 0.8], [cx + w / 2, by - h * 0.8], [cx + w * 0.62, by], [cx - w * 0.62, by]], { color: cloth, alpha: 0.9, rough: 0.15, slip: 0 });
    P.wash(x, [[cx, by - h * 0.8], [cx + w / 2, by - h * 0.8], [cx + w * 0.62, by], [cx, by]], { color: C.shade, alpha: 0.35, rough: 0.1, slip: 0 });
    P.wash(x, P.ellipse(cx, by - h * 0.9, h * 0.1, h * 0.11, 8), { color: '#3a2c2c', alpha: 0.9, rough: 0.05, slip: 0 });
  };
  const boat = (x, cx, wl, L, man) => {
    const h = L * 0.12;
    const hull = [[cx - L / 2, wl - h * 1.6], [cx - L * 0.36, wl - h * 0.1], [cx + L * 0.38, wl], [cx + L / 2 + 3, wl - h * 1.8], [cx + L * 0.35, wl - h * 1.1], [cx - L * 0.35, wl - h * 1.0]];
    body(x, hull, '#6a4a36', { alpha: 0.92, edge: 0.25 });
    P.ink(x, [[cx - L * 0.36, wl - h * 1.05], [cx + L * 0.37, wl - h * 1.15]], { w: 1, alpha: 0.55, wobble: 0.1, color: '#d1a066', mode: 'source-over' });
    if (man) {
      person(x, cx + L * 0.12, wl - h * 1.1, L * 0.42, '#ece4d4');
      P.ink(x, [[cx + L * 0.22, wl - h * 1.1 - L * 0.32], [cx + L * 0.55, wl + L * 0.1]], { w: 0.9, alpha: 0.6, wobble: 0.1, gaps: 0, color: '#3c302c' });
    }
  };
  SC.boatSprite = function () {
    const c = P.card('boat', 0, 0, 110, 50);
    boat(c.ctx, 55, 38, 78, true);
    return c;
  };

  // ----------------------------------------------------------- sky
  function paintSky(x) {
    x.fillStyle = C.paper;
    x.fillRect(0, 0, W, H);
    // a soft morning sky that comes out of the paper
    P.wash(x, rect(-40, -40, W + 40, 1500), { grad: [0, 0, 0, 1480, [[0, '#b4cad8'], [0.3, '#d3dfe2'], [0.58, '#ede8dc'], [0.8, '#f2dfc1'], [1, '#efd1a3']]], alpha: 0.85, rough: 0, blotch: 0.18, slip: 0 });
    // clouds: wet-in-wet, cool undersides, warm tops — kept faint where type sits
    const cl = [[880, 150, 300, 70, 0.22], [180, 260, 260, 55, 0.12], [940, 560, 240, 50, 0.16], [760, 1080, 320, 60, 0.2], [300, 1120, 300, 50, 0.16], [980, 1250, 260, 45, 0.18], [560, 1320, 380, 40, 0.14]];
    for (const [cx, cy, rx, ry, a] of cl) {
      P.wash(x, P.ellipse(cx, cy + ry * 0.4, rx, ry * 0.7, 30), { color: '#aab3c2', alpha: a, rough: 24, soft: 24, freq: 0.02, layers: 2, bloom: 0.1 });
      P.wash(x, P.ellipse(cx - rx * 0.1, cy - ry * 0.2, rx * 0.8, ry * 0.55, 30), { color: '#fbf3e2', alpha: a * 1.6, rough: 20, soft: 18, freq: 0.03, mode: 'source-over' });
    }
    // the low sky warms toward the sun on the left
    P.wash(x, P.ellipse(120, 1300, 520, 260, 30), { color: '#f2cf98', alpha: 0.3, rough: 30, soft: 60, freq: 0.01 });
  }

  // ----------------------------------------------------------- across the river (right)
  function paintFarBank(x) {
    // hills of Nashik, faint
    const ridge = (y0, amp, seed, col, a) => {
      const pts = [[480, 1480]];
      for (let X = 480; X <= W + 20; X += 14) pts.push([X, y0 - amp * P.fbm(X / 180, 0.5, 3, seed) - 50 * Math.exp(-((X - 900) ** 2) / 50000)]);
      pts.push([W + 20, 1480]);
      P.wash(x, pts, { color: col, alpha: a, rough: 2, soft: 2, blotch: 0.3, slip: 0 });
    };
    ridge(1370, 70, 3, '#b8c0c6', 0.5);
    ridge(1400, 50, 9, '#9fac9f', 0.45);
    // the town on the far bank, small and hazy, packed
    const tr = P.rng(41);
    let X = 560;
    while (X < 1090) {
      const w = 18 + tr() * 30, top = 1392 + tr() * 30;
      const lc = [C.lime, C.limeWarm, C.ochre, '#d8c6c0'][Math.floor(tr() * 4)];
      house(x, X, X + w, top, 1446, P.mix(lc, C.haze, 0.45), { roof: tr() < 0.4 ? 'tile' : null, pitch: 6, rows: 1, seed: X | 0 });
      X += w - 3;
    }
    tree(x, 700, 1420, 22, 3, { leaf: '#8f9a74', dark: '#6b7660' });
    tree(x, 1060, 1400, 30, 4, { leaf: '#8a9570', dark: '#66725a' });
    shikhara(x, 1024, 1446, 34, 70, { col: P.mix(C.basalt, C.haze, 0.35), lit: P.mix(C.basaltLit, C.haze, 0.3), flag: true });
    shikhara(x, 640, 1444, 22, 40, { col: P.mix(C.basalt, C.haze, 0.5), lit: P.mix(C.basaltLit, C.haze, 0.45), minis: false });
    // ghat steps along the far waterline
    const gh = [[560, 1444], [W + 20, 1442], [W + 20, WL + 1], [560, WL + 1]];
    body(x, gh, '#d7c4a6', { alpha: 0.85 });
    for (let k = 1; k < 3; k++) P.ink(x, [[560, 1444 + k * 2.8], [W + 20, 1442 + k * 2.8]], { w: 0.6, alpha: 0.35, wobble: 0.3, color: '#6c6066' });
    for (const [px, h, c] of [[612, 10, '#efe6d6'], [760, 10, '#a3453a'], [770, 9, '#efe6d6'], [1048, 10, C.saffron]]) person(x, px, 1448, h, c);

    // the tower in the river: a tiered, arcaded sandstone pavilion-tower
    {
      const cx = 906, base = WL + 22;
      const stone = '#c89a72', shade = '#93695a', deep = '#4b3436';
      // platform in the water
      body(x, [[cx - 92, base - 18], [cx + 96, base - 18], [cx + 104, base + 2], [cx - 100, base + 2]], '#cdb594', { alpha: 0.9 });
      glaze(x, rect(cx - 100, base - 6, cx + 104, base + 2), C.shadeDeep, 0.35);
      P.ink(x, [[cx - 100, base + 2], [cx + 104, base + 2]], { w: 0.9, alpha: 0.45, wobble: 0.3, color: '#5a4f5e' });
      let yb = base - 18, ww = 112;
      const tiers = [124, 106, 92, 80, 68];
      for (let i = 0; i < tiers.length; i++) {
        const th = tiers[i], x0 = cx - ww / 2, x1 = cx + ww / 2, yt = yb - th;
        body(x, rect(x0, yt, x1, yb), stone, { alpha: 0.86, grad: [x0, 0, x1, 0, [[0, '#e1bb92'], [0.5, stone], [1, shade]]] });
        // arcade: openings, cusped, the far sky showing through the upper ones
        const n = i === 0 ? 3 : 2, ow = (ww / n) * 0.56;
        for (let k = 0; k < n; k++) {
          const ox = x0 + ((k + 0.5) * ww) / n;
          P.wash(x, cusped(ox - ow / 2, ox + ow / 2, yb - 10, yt + th * 0.36, ow * 0.42, 14), { color: deep, alpha: 0.82, rough: 0.15, slip: 0 });
          if (i > 0) P.wash(x, rect(ox - ow / 2 + 2, yt + th * 0.46, ox + ow / 2 - 2, yb - 12), { color: '#dfe2dc', alpha: 0.35, rough: 0.2, soft: 0.6, mode: 'source-over' });
          P.ink(x, cusped(ox - ow / 2 - 2, ox + ow / 2 + 2, yb - 10, yt + th * 0.36, ow * 0.46, 14).slice(2), { w: 0.6, alpha: 0.3, wobble: 0.1, color: shade });
        }
        // balcony on brackets
        P.wash(x, rect(x0 - 6, yb - 12, x1 + 6, yb - 8), { color: shade, alpha: 0.85, rough: 0.15 });
        for (let bx = x0 - 4; bx <= x1 + 4; bx += 5.5) P.ink(x, [[bx, yb - 8], [bx + 1, yb - 3]], { w: 0.8, alpha: 0.45, wobble: 0.05, gaps: 0, color: deep });
        // cornice
        P.wash(x, rect(x0 - 5, yt - 3, x1 + 5, yt + 4), { color: P.mix(shade, deep, 0.3), alpha: 0.85, rough: 0.2 });
        lit(x, [x0 - 5, yt - 3], [x1 + 5, yt - 3], 0.5, 1);
        lit(x, [x0 + 1, yt + 5], [x0 + 1, yb - 3], 0.5, 1.2);
        // corner turrets on the lower tiers
        if (i < 2) for (const tx of [x0 - 2, x1 + 2]) { domeOn(x, tx, yt - 3, 9, 14, stone); }
        yb = yt - 3; ww *= 0.84;
      }
      domeOn(x, cx, yb, ww * 0.6, ww * 1.15, stone, { flag: true });
      P.pencil(x, [cx - 66, base - 18], [cx - 66, base - 140], { alpha: 0.2, over: 8 });
    }
    // boats moored by the tower
    boat(x, 1040, WL + 30, 58, false);
  }

  // ----------------------------------------------------------- water (static base)
  function paintWater(x) {
    const poly = [[EDGE[EDGE.length - 1][0] - 20, WL - 1], [W + 20, WL - 1], [W + 20, H + 20], [EDGE[0][0] - 40, H + 20]];
    P.ground(x, poly, C.paper, 0);
    P.wash(x, poly, { grad: [0, WL, 0, H, [[0, '#e6dccb'], [0.12, '#c9d2cf'], [0.4, '#9fb8b8'], [0.75, '#6f9796'], [1, '#4d7b7a']]], alpha: 0.88, rough: 0, blotch: 0.25, slip: 0 });
    const wr = P.rng(15);
    for (let i = 0; i < 10; i++) {
      const cx = 520 + wr() * 600, cy = 1500 + wr() * 400, rx = 120 + wr() * 220;
      P.wash(x, P.ellipse(cx, cy, rx, rx * 0.12, 30), { color: wr() < 0.6 ? '#3f6f6c' : '#b9c9cb', alpha: 0.16, rough: 14, soft: 12, freq: 0.02 });
    }
  }
  SC.streakSprite = function () {
    const c = P.card('streaks', 0, WL, W * 2, H - WL);
    const x = c.ctx;
    const sr = P.rng(88);
    for (let i = 0; i < 300; i++) {
      const y = WL + 6 + Math.pow(sr(), 1.2) * (H - WL - 6);
      const k = (y - WL) / (H - WL);
      const len = 12 + sr() * (40 + 200 * k);
      const x0 = sr() * W;
      const th = 0.8 + k * 4;
      const light = sr() < 0.55;
      for (const off of [0, W]) {
        P.wash(x, [[x0 + off, y], [x0 + off + len, y - 0.4], [x0 + off + len * 0.88, y + th], [x0 + off + len * 0.1, y + th * 1.05]], {
          color: light ? '#f6efdf' : '#2d5654', alpha: light ? 0.34 - k * 0.12 : 0.12 + k * 0.14, rough: 0.6 + k * 1.6, soft: 0.5 + k * 1.4, slip: 0, mode: 'source-over', seed: i * 7 + 1,
        });
      }
    }
    return c;
  };

  // ----------------------------------------------------------- our bank (left)
  function paintOurBank(x) {
    // the ghat: wide steps descending to the water edge, receding up the frame
    const land = [[-20, 1180], [480, 1330], [790, 1452], ...EDGE.slice().reverse().slice(1), [-20, H + 20]];
    // (EDGE reversed goes from the distance down to the bottom)
    const ghat = [[-20, 1300], [430, 1352], [790, 1450], ...EDGE.slice(0, -1).reverse(), [-20, H + 20]];
    body(x, ghat, '#cdb898', { alpha: 0.85, grad: [0, 1300, 0, H, [[0, '#d9c6a5'], [0.5, '#c9b293'], [1, '#b49b80']]] });
    // step lines, parallel to the water edge, crowding together in the distance
    for (let k = 1; k < 26; k++) {
      const t = k / 26;
      const off = Math.pow(t, 1.6) * 520; // how far from the water edge, inland
      const line = [];
      for (const [ex, ey] of EDGE) {
        const depth = (ey - 1452) / 470; // 0 far .. 1 near
        line.push([ex - off * (0.2 + depth * 0.95), ey - off * 0.05 * (1 - depth)]);
      }
      P.ink(x, line, { w: 0.6 + t * 0.9, alpha: 0.3 + 0.15 * (1 - t), wobble: 0.4, gaps: 0.1, color: '#5f5357', step: 6 });
      if (k % 2 === 0) {
        const off2 = Math.pow((k + 0.6) / 26, 1.6) * 520;
        const line2 = EDGE.map(([ex, ey]) => { const depth = (ey - 1452) / 470; return [ex - off2 * (0.2 + depth * 0.95), ey - off2 * 0.05 * (1 - depth)]; });
        glaze(x, [...line, ...line2.slice().reverse()], C.shade, 0.22, { soft: 0.6, slip: 0 });
      }
    }
    // wet lower steps and the line of the water
    glaze(x, [...EDGE.map(([a, b]) => [a - 4, b]), ...EDGE.slice().reverse().map(([a, b]) => [a - 26 - (b - 1452) * 0.06, b])], '#6f7f74', 0.5, { soft: 1 });
    P.ink(x, EDGE, { w: 1.2, alpha: 0.5, wobble: 0.3, color: '#3d4744' });

    // --- behind it, the precinct: temples close to the pillar, low houses toward the centre
    domeOn(x, 330, 1300, 30, 38, C.sand);
    shikhara(x, 236, 1300, 100, 176, { flag: true });
    house(x, 124, 176, 1222, 1302, C.limeWarm, { roof: 'tile', pitch: 10, rows: 3, seed: 7, side: 6, balcony: 0.5 });
    house(x, 372, 430, 1290, 1348, C.lime, { rows: 2, seed: 9, side: 6, arch: true });
    house(x, 440, 500, 1312, 1362, C.ochre, { roof: 'tile', pitch: 7, rows: 1, seed: 11, side: 5, balcony: 0.55 });
    house(x, 504, 556, 1330, 1378, C.lime, { rows: 1, seed: 13, side: 5 });
    tree(x, 588, 1336, 34, 21);
    house(x, 610, 660, 1356, 1398, C.limeWarm, { roof: 'tile', pitch: 6, rows: 1, seed: 15, side: 4 });
    shikhara(x, 690, 1420, 26, 46, { col: P.mix(C.basalt, C.haze, 0.3), minis: false, flag: true });
    // the precinct wall along the top of the ghat, with a bell-house
    body(x, [[100, 1318], [440, 1352], [440, 1330], [100, 1292]], P.mix(C.basaltLit, C.stone, 0.5), { alpha: 0.88 });
    for (let ax = 110; ax < 420; ax += 34) {
      const yy = 1290 + ax * 0.104;
      P.wash(x, cusped(ax, ax + 14, yy + 10, yy, 6, 8), { color: C.opening, alpha: 0.35, rough: 0.15, slip: 0.5 });
    }
    {
      const k0 = 118, k1 = 164, kb = 1300, kt = 1252;
      body(x, rect(k0, kt, k1, kb), P.mix(C.basaltLit, C.stone, 0.4));
      P.wash(x, cusped(k0 + 8, k1 - 8, kb - 4, kt + 16, 9, 12), { color: C.opening, alpha: 0.85, rough: 0.15, slip: 0 });
      const bc = (k0 + k1) / 2;
      P.ink(x, [[bc, kt + 8], [bc, kt + 18]], { w: 0.8, alpha: 0.8, wobble: 0, gaps: 0, color: '#2a2224' });
      P.wash(x, [[bc - 2, kt + 18], [bc + 2, kt + 18], [bc + 6, kt + 28], [bc - 6, kt + 28]], { color: '#8a6a3a', alpha: 0.95, rough: 0.05, slip: 0 });
      domeOn(x, bc, kt, 27, 34, C.sand);
    }
    // --- on the ghat, the round open pavilion (the one by Ramkund's steps)
    {
      const cx = 300, base = 1440, r0 = 110, top = 1352;
      // plinth and steps
      body(x, [[cx - r0 - 26, base], [cx + r0 + 26, base], [cx + r0 + 14, base - 14], [cx - r0 - 14, base - 14]], C.stoneLit, { alpha: 0.88 });
      glaze(x, rect(cx - r0 - 26, base - 5, cx + r0 + 26, base), C.shadeDeep, 0.3);
      // interior shade, through which the far ghat shows
      body(x, rect(cx - r0, top, cx + r0, base - 14), '#8f8a8c', { alpha: 0.7 });
      glaze(x, rect(cx - r0, base - 40, cx + r0, base - 14), C.stoneLit, 0.55, { mode: 'source-over' });
      // columns around the ring: lit on their left
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * ((i + 0.5) / 10);
        const px = cx - Math.cos(a) * r0 * 0.95, wv = 4 + Math.sin(a) * 5;
        body(x, rect(px - wv / 2, top, px + wv / 2, base - 14), C.stoneLit, { alpha: 0.92, gr: 0.2, slip: 0 });
        glaze(x, rect(px, top, px + wv / 2, base - 14), C.shade, 0.4, { slip: 0 });
      }
      // eave ring and dome
      body(x, [[cx - r0 - 12, top + 2], [cx + r0 + 12, top + 2], [cx + r0 + 6, top - 8], [cx - r0 - 6, top - 8]], C.stone, { alpha: 0.88 });
      glaze(x, rect(cx - r0, top + 2, cx + r0, top + 12), C.shadeDeep, 0.4, { soft: 1 });
      const d = [];
      for (let i = 0; i <= 28; i++) { const a = Math.PI * (i / 28); d.push([cx - Math.cos(a) * (r0 + 4), top - 8 - Math.sin(a) * 56]); }
      body(x, d, C.stoneLit, { alpha: 0.88, grad: [cx - r0, 0, cx + r0, 0, [[0, '#efe2c8'], [0.55, C.stoneLit], [1, P.mix(C.stone, C.shade, 0.4)]]] });
      for (let k = -4; k <= 4; k++) P.ink(x, [[cx + k * 23, top - 8], [cx + k * 7, top - 60]], { w: 0.6, alpha: 0.25, wobble: 0.2, color: C.shadeDeep });
      finial(x, cx, top - 64, 6, '#8c6a3e');
      P.pencil(x, [cx - r0 - 26, base], [cx + r0 + 26, base], { alpha: 0.25, over: 10 });
    }
    // steps down from the pavilion's platform toward the river, receding right
    for (let k = 0; k < 9; k++) {
      const y = 1452 + k * 11 + k * k * 0.9;
      const xr = 640 - k * 10;
      P.ink(x, [[110, y], [xr, y - (xr - 110) * 0.09]], { w: 0.8 + k * 0.08, alpha: 0.34, wobble: 0.4, gaps: 0.1, color: '#5f5357', step: 6 });
      if (k % 2) glaze(x, [[110, y], [xr, y - (xr - 110) * 0.09], [xr, y - (xr - 110) * 0.09 + 6 + k], [110, y + 6 + k]], C.shade, 0.18, { slip: 0 });
    }
    // people on the steps
    const ppl = [[190, 1500, 30, '#efe6d6'], [204, 1502, 28, '#9c3f37'], [300, 1478, 26, '#5d6b80'], [366, 1530, 30, C.saffron], [560, 1470, 26, '#efe6d6'], [578, 1472, 24, '#b04a3a'], [470, 1452, 24, '#e9e1d2'], [650, 1500, 26, C.saffron], [690, 1478, 22, '#5d6b80'], [430, 1500, 28, '#e9e1d2'], [445, 1502, 26, '#7c3a50']];
    for (const [px, py, h, c] of ppl) person(x, px, py, h, c);
  }

  // ----------------------------------------------------------- the foreground
  function paintForeground(x) {
    // big near steps, under the pavilion we stand in
    const steps = [[1640, 520], [1700, 512], [1770, 504], [1850, 498]];
    for (let i = 0; i < steps.length; i++) {
      const [y, xr] = steps[i], y1 = i + 1 < steps.length ? steps[i + 1][0] : H + 20;
      const tread = [[-20, y], [xr, y + 4], [xr - 6, y1], [-20, y1]];
      body(x, tread, '#c6b294', { alpha: 0.88, grad: [0, y, 0, y1, [[0, '#ddcbab'], [0.35, '#c7b293'], [1, '#a08c78']]] });
      // the riser face in shade
      glaze(x, [[-20, y1 - (y1 - y) * 0.45], [xr - 4, y1 - (y1 - y) * 0.45 + 3], [xr - 6, y1], [-20, y1]], C.shade, 0.42, { soft: 1 });
      P.ink(x, [[-20, y], [xr, y + 4]], { w: 1.4, alpha: 0.45, wobble: 0.5, gaps: 0.06, color: '#3e3438' });
      lit(x, [-20, y + 2], [xr, y + 6], 0.4, 1);
      // weathering and a few joints
      for (let k = 0; k < 4; k++) {
        const jx = 40 + r() * (xr - 80);
        P.ink(x, [[jx, y + 3], [jx + 2, y1 - 2]], { w: 0.8, alpha: 0.3, wobble: 0.3, color: '#4b4044' });
      }
      for (let k = 0; k < 6; k++) P.dry(x, 20 + r() * (xr - 60), y + 8 + r() * (y1 - y - 16), 30 + r() * 80, 0.02, { n: 3, w: 6, color: r() < 0.5 ? '#f3e6cc' : '#6b5d5c', alpha: 0.25, mode: r() < 0.5 ? 'source-over' : 'multiply' });
    }
    // the side of the step flight, at the water
    for (let i = 0; i < steps.length; i++) {
      const [y, xr] = steps[i], y1 = i + 1 < steps.length ? steps[i + 1][0] : H + 20;
      body(x, [[xr, y + 4], [xr + 14, y + 8], [xr + 8, y1 + 4], [xr - 6, y1]], '#9a8775', { alpha: 0.85 });
    }
    paintCouple(x);
    paintThali(x, 118, 1694);
    paintPillar(x);
    paintBranch(x);
  }

  // the pillar and the spring of the arch of the pavilion we are standing in
  function paintPillar(x) {
    const x0 = -24, x1 = 104, base = 1650, capT = 318, capB = 392;
    const stoneA = '#8c776a', stoneB = '#b09679', stoneD = '#64544f';
    // the spandrel wall and the arch: solid stone above and left of the opening
    const AC = [330, 392], R = 210, T = 42, KY = 1.75;
    const inner = [], outer = [];
    for (let i = 0; i <= 28; i++) {
      const a = Math.PI - (i / 28) * 0.42 * Math.PI;
      inner.push([AC[0] + Math.cos(a) * R, AC[1] - Math.sin(a) * R * KY]);
      outer.push([AC[0] + Math.cos(a) * (R + T), AC[1] - Math.sin(a) * (R + T) * KY]);
    }
    const wall = [[-30, -30], [outer[outer.length - 1][0], -30], ...inner.slice().reverse(), [x1, capB], [-30, capB]];
    body(x, wall, stoneA, { alpha: 0.94, blotch: 0.5, gran: 0.35, grad: [0, 0, 300, 380, [[0, '#7e6a5f'], [1, '#a18a73']]] });
    // the arch ring (voussoirs), its soffit in shade
    const ring = [...outer, ...inner.slice().reverse()];
    body(x, ring, stoneB, { alpha: 0.9, blotch: 0.5, gran: 0.3 });
    for (let i = 2; i < 28; i += 3) P.ink(x, [inner[i], outer[i]], { w: 0.8, alpha: 0.35, wobble: 0.3, color: '#5c4c48' });
    P.ink(x, inner, { w: 1.4, alpha: 0.5, wobble: 0.4, color: '#4a3d3c' });
    P.ink(x, outer, { w: 1, alpha: 0.35, wobble: 0.4, color: '#4a3d3c' });
    glaze(x, [...inner, ...inner.slice().reverse().map(([a, b]) => [a + 14, b + 10])], C.shadeDeep, 0.4, { soft: 2 });
    // carved cusps along the intrados
    for (let i = 3; i < 27; i += 4) {
      const [a, b] = inner[i];
      P.wash(x, P.ellipse(a + 6, b + 6, 9, 7, 10), { color: stoneD, alpha: 0.35, rough: 0.4 });
    }
    // shaft
    body(x, rect(x0, capB, x1, base), stoneB, { alpha: 0.94, grad: [x0, 0, x1, 0, [[0, stoneD], [0.45, '#a68d73'], [0.75, '#987f6a'], [1, stoneD]]], blotch: 0.4, gran: 0.35 });
    lit(x, [x1 - 20, capB + 10], [x1 - 20, base - 120], 0.4, 1.4);
    glaze(x, rect(x1 - 18, capB, x1, base), C.shadeDeep, 0.35);
    // capital: two stepped brackets
    body(x, rect(x0, capT, x1 + 30, capT + 34), stoneB, { alpha: 0.92 });
    body(x, [[x0, capT + 34], [x1 + 22, capT + 34], [x1 + 6, capB], [x0, capB]], stoneA, { alpha: 0.92 });
    glaze(x, rect(x0, capT + 34, x1 + 22, capT + 46), C.shadeDeep, 0.45, { soft: 1 });
    glaze(x, rect(x0, capB, x1, capB + 14), C.shadeDeep, 0.4, { soft: 1.5 });
    for (let k = 0; k < 3; k++) P.ink(x, [[x0 + 8, capT + 8 + k * 9], [x1 + 26, capT + 8 + k * 9]], { w: 0.8, alpha: 0.3, wobble: 0.4, color: '#4e4246' });
    // carved band of lotus petals
    const bY = 1010;
    body(x, rect(x0, bY, x1 + 4, bY + 46), '#a89078', { alpha: 0.94 });
    for (let px = x0 + 2; px < x1; px += 18) {
      const pet = [];
      for (let i = 0; i <= 10; i++) { const k = i / 10; pet.push([px + 16 * k, bY + 42 - 32 * Math.sin(Math.PI * k) ** 0.7]); }
      P.wash(x, pet, { color: stoneD, alpha: 0.45, rough: 0.4, gran: 0.3 });
    }
    glaze(x, rect(x0, bY + 46, x1 + 4, bY + 56), C.shadeDeep, 0.35, { soft: 1 });
    // base mouldings, on the top step
    body(x, rect(x0, base - 120, x1 + 8, base - 84), '#ad957b', { alpha: 0.94 });
    body(x, rect(x0, base - 84, x1 + 18, base), stoneA, { alpha: 0.92 });
    glaze(x, rect(x0, base - 88, x1 + 18, base - 78), C.shadeDeep, 0.4, { soft: 1 });
    // weathering
    for (let k = 0; k < 16; k++) {
      const sx = x0 + 10 + r() * (x1 - x0 - 20), sy = capB + 20 + r() * 1100;
      P.wash(x, [[sx, sy], [sx + 5, sy], [sx + 3, sy + 60 + r() * 120], [sx + 1, sy + 50]], { color: '#4e4446', alpha: 0.14, rough: 0.8, soft: 1.5 });
    }
    for (let k = 0; k < 22; k++) P.dab(x, -20 + r() * 260, r() < 0.5 ? r() * 300 : capB + r() * 1200, 3 + r() * 6, r() < 0.5 ? '#9a9564' : '#c2b07a', 0.22, 0.4);
  }

  // a flowering palash branch hanging into the frame from above the arch
  function paintBranch(x) {
    const br = P.rng(77);
    const twig = (pts, w) => P.ink(x, spline(pts, 6, false), { w, alpha: 0.75, wobble: 0.6, gaps: 0.02, color: '#4d3a2e' });
    const main = [[-10, 40], [80, 70], [150, 140], [200, 240], [232, 330]];
    twig(main, 4);
    twig([[150, 140], [210, 150], [258, 196]], 2.2);
    twig([[200, 240], [170, 330], [150, 420]], 2);
    twig([[80, 70], [140, 40], [200, 30]], 2);
    const leafAt = (cx, cy, a, L) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([cx + Math.cos(a) * L * t - Math.sin(a) * L * 0.32 * Math.sin(Math.PI * t), cy + Math.sin(a) * L * t + Math.cos(a) * L * 0.32 * Math.sin(Math.PI * t)]); }
      for (let i = 12; i >= 0; i--) { const t = i / 12; pts.push([cx + Math.cos(a) * L * t + Math.sin(a) * L * 0.3 * Math.sin(Math.PI * t), cy + Math.sin(a) * L * t - Math.cos(a) * L * 0.3 * Math.sin(Math.PI * t)]); }
      P.wash(x, pts, { color: br() < 0.5 ? C.leaf : '#97a058', alpha: 0.75, rough: 0.6, gran: 0.2, edge: 0.35 });
      P.ink(x, [[cx, cy], [cx + Math.cos(a) * L * 0.9, cy + Math.sin(a) * L * 0.9]], { w: 0.5, alpha: 0.35, wobble: 0.1, color: C.leafDark });
    };
    const flower = (cx, cy, s) => {
      // palash: curved flame-orange petals in a small cluster, a dark calyx
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.55 + (br() - 0.5) * 0.3;
        const tip = [cx + Math.cos(a) * s, cy + Math.sin(a) * s];
        const pet = spline([[cx, cy], [cx + Math.cos(a - 0.35) * s * 0.6, cy + Math.sin(a - 0.35) * s * 0.6], tip, [cx + Math.cos(a + 0.35) * s * 0.55, cy + Math.sin(a + 0.35) * s * 0.55]], 5);
        P.wash(x, pet, { color: br() < 0.6 ? C.palash : '#f09a43', alpha: 0.85, rough: 0.4, gran: 0.15, edge: 0.35, slip: 0 });
      }
      P.wash(x, P.ellipse(cx, cy + 2, s * 0.22, s * 0.3, 10), { color: '#4b3a33', alpha: 0.8, rough: 0.1, slip: 0 });
    };
    const leaves = [[40, 26, 0.2, 40], [100, 44, 0.9, 38], [176, 120, 0.1, 40], [250, 236, 1.7, 34], [120, 150, 2.4, 36], [60, 60, 0.4, 40], [110, 110, 1.9, 42], [160, 170, 0.2, 44], [190, 200, 1.4, 38], [228, 210, 0.6, 36], [212, 288, 2.3, 40], [168, 350, 2.0, 36], [140, 30, -0.3, 34], [236, 330, 1.2, 30], [20, 52, 1.6, 36]];
    for (const [a, b, c, d] of leaves) leafAt(a, b, c, d);
    const flowers = [[60, 34, 17], [150, 112, 18], [268, 230, 16], [190, 300, 17], [96, 92, 18], [176, 156, 20], [248, 200, 17], [222, 256, 18], [150, 400, 16], [200, 52, 15], [236, 336, 16], [128, 214, 15]];
    for (const [a, b, s] of flowers) flower(a, b, s);
  }

  // the couple: seen from behind, three-quarters, looking out over the river
  function paintCouple(x) {
    const seat = 1708;
    // shadow on the step
    glaze(x, P.ellipse(340, seat + 14, 170, 16, 30), '#5d5a6e', 0.3, { soft: 6, rough: 4 });

    // ----- him (left, a little further back)
    const m = 262;
    const kurta = spline([[m - 76, seat + 6], [m - 72, seat - 60], [m - 70, seat - 124], [m - 52, seat - 152], [m - 14, seat - 166], [m + 24, seat - 166], [m + 54, seat - 150], [m + 66, seat - 120], [m + 66, seat - 60], [m + 74, seat + 6]], 8);
    body(x, kurta, '#eee6d4', { alpha: 0.9, rough: 0.8, gran: 0.2, blotch: 0.35, edge: 0.35 });
    glaze(x, spline([[m + 4, seat - 164], [m + 34, seat - 160], [m + 56, seat - 128], [m + 64, seat - 60], [m + 72, seat + 6], [m + 12, seat + 6], [m + 18, seat - 80]], 8), C.shade, 0.42, { soft: 1.5 });
    // collar and the line of the shoulder seam
    P.ink(x, spline([[m - 16, seat - 166], [m + 4, seat - 160], [m + 24, seat - 166]], 5, false), { w: 1.2, alpha: 0.4, wobble: 0.2, color: '#7c7890' });
    // his right arm, resting, in shade
    glaze(x, spline([[m + 54, seat - 146], [m + 70, seat - 110], [m + 72, seat - 40], [m + 60, seat - 30], [m + 56, seat - 110]], 6), C.shadeDeep, 0.3, { soft: 1 });
    // folds
    for (const f of [[[m - 30, seat - 150], [m - 26, seat - 90], [m - 34, seat - 10]], [[m + 10, seat - 140], [m + 18, seat - 70], [m + 14, seat]]]) P.ink(x, spline(f, 6, false), { w: 1, alpha: 0.3, wobble: 0.5, color: '#7c7890' });
    // the uparna over his left shoulder, falling down his back, a thin maroon border
    const up = spline([[m - 60, seat - 136], [m - 36, seat - 164], [m - 10, seat - 162], [m - 4, seat - 120], [m - 12, seat - 60], [m - 26, seat + 2], [m - 58, seat + 2], [m - 52, seat - 70]], 8);
    body(x, up, '#f3ead6', { alpha: 0.85, rough: 0.7, gran: 0.15 });
    P.ink(x, spline([[m - 6, seat - 160], [m - 2, seat - 118], [m - 10, seat - 58], [m - 24, seat + 2]], 6, false), { w: 2, alpha: 0.7, wobble: 0.3, color: '#8e2f25' });
    P.ink(x, spline([[m - 6, seat - 160], [m - 2, seat - 118], [m - 10, seat - 58], [m - 24, seat + 2]], 6, false).map(([a, b]) => [a + 3, b]), { w: 1, alpha: 0.6, wobble: 0.3, color: '#c99a49', mode: 'source-over' });
    // neck, head turned slightly toward the river (right): ear and cheek show
    body(x, [[m - 12, seat - 186], [m + 14, seat - 186], [m + 16, seat - 164], [m - 14, seat - 164]], '#b98463', { alpha: 0.9, slip: 0 });
    const head = spline([[m - 22, seat - 196], [m - 20, seat - 226], [m, seat - 240], [m + 22, seat - 232], [m + 28, seat - 206], [m + 18, seat - 186], [m - 12, seat - 184]], 8);
    body(x, head, '#2a2122', { alpha: 0.96, rough: 0.6, blotch: 0.08, gran: 0.1 });
    body(x, spline([[m + 21, seat - 212], [m + 29, seat - 205], [m + 25, seat - 190], [m + 18, seat - 188]], 6), '#b98463', { alpha: 0.85, slip: 0 }); // a sliver of cheek
    body(x, P.ellipse(m + 15, seat - 204, 4.5, 7, 12), '#a8714f', { alpha: 0.92, slip: 0 }); // ear
    lit(x, [m - 22, seat - 220], [m - 10, seat - 236], 0.4, 1.4);
    P.ink(x, spline([[m - 62, seat - 128], [m - 70, seat - 60], [m - 74, seat]], 6, false), { w: 1.6, alpha: 0.5, wobble: 0.3, color: '#fbf1dc', mode: 'source-over' });

    // ----- her (right, nearer to us)
    const f = 392;
    // sari pooled on the step, its border along the hem
    const hem = spline([[f - 70, seat + 14], [f - 40, seat - 10], [f + 30, seat - 14], [f + 104, seat - 2], [f + 128, seat + 18], [f + 40, seat + 26]], 8);
    body(x, hem, '#a6382d', { alpha: 0.9, rough: 0.7, gran: 0.25, blotch: 0.4, edge: 0.35 });
    P.ink(x, spline([[f - 66, seat + 16], [f + 40, seat + 24], [f + 126, seat + 16]], 6, false), { w: 3.2, alpha: 0.85, wobble: 0.3, color: '#d1a04a', mode: 'source-over' });
    // torso: green blouse, sari wrapped at the waist
    const torso = spline([[f - 60, seat - 4], [f - 56, seat - 58], [f - 48, seat - 112], [f - 30, seat - 140], [f + 4, seat - 146], [f + 34, seat - 138], [f + 50, seat - 110], [f + 58, seat - 56], [f + 66, seat - 4]], 8);
    body(x, torso, '#a6382d', { alpha: 0.9, rough: 0.7, gran: 0.25, blotch: 0.4, edge: 0.35 });
    const blouse = spline([[f - 40, seat - 128], [f - 22, seat - 142], [f + 10, seat - 146], [f + 36, seat - 136], [f + 48, seat - 108], [f + 44, seat - 84], [f + 4, seat - 80], [f - 34, seat - 88]], 8);
    body(x, blouse, '#3f6c46', { alpha: 0.9, rough: 0.6, gran: 0.2 });
    // a strip of skin at the waist and the arm
    body(x, spline([[f - 30, seat - 84], [f + 40, seat - 82], [f + 44, seat - 74], [f - 28, seat - 74]], 4), '#c08b69', { alpha: 0.85, slip: 0 });
    body(x, spline([[f + 46, seat - 108], [f + 58, seat - 96], [f + 62, seat - 54], [f + 52, seat - 50], [f + 46, seat - 86]], 6), '#bf8a67', { alpha: 0.9, slip: 0 });
    for (let k = 0; k < 3; k++) P.ink(x, [[f + 50, seat - 58 + k * 3], [f + 62, seat - 58 + k * 3]], { w: 1.4, alpha: 0.8, wobble: 0.1, gaps: 0, color: k === 1 ? '#3f6c46' : '#d1a04a', mode: 'source-over' }); // bangles
    // the pallu over her left shoulder, falling diagonally across her back
    const pallu = spline([[f - 50, seat - 118], [f - 28, seat - 144], [f - 4, seat - 140], [f + 6, seat - 104], [f + 30, seat - 52], [f + 58, seat - 6], [f + 20, seat + 4], [f - 20, seat - 30], [f - 48, seat - 76]], 8);
    body(x, pallu, '#b2412f', { alpha: 0.88, rough: 0.7, gran: 0.3, blotch: 0.4, edge: 0.35 });
    // zari: a broad gold border along the pallu's edge and a row of small motifs
    const edgeL = spline([[f - 4, seat - 140], [f + 6, seat - 104], [f + 30, seat - 52], [f + 58, seat - 6]], 8, false);
    P.ink(x, edgeL, { w: 5, alpha: 0.85, wobble: 0.3, gaps: 0, color: '#d1a04a', mode: 'source-over' });
    P.ink(x, edgeL.map(([a, b]) => [a - 7, b + 2]), { w: 1.2, alpha: 0.6, wobble: 0.3, color: '#d1a04a', mode: 'source-over' });
    for (let k = 0; k < 9; k++) {
      const p = edgeL[Math.floor((k + 0.5) * edgeL.length / 9)];
      P.wash(x, P.ellipse(p[0] - 16, p[1] + 2, 2.2, 3, 6), { color: '#d9ac55', alpha: 0.75, rough: 0.05, slip: 0, mode: 'source-over' });
    }
    glaze(x, spline([[f + 12, seat - 120], [f + 36, seat - 136], [f + 50, seat - 110], [f + 58, seat - 56], [f + 66, seat - 4], [f + 40, seat - 4], [f + 30, seat - 60]], 8), '#6d4a6a', 0.28, { soft: 1.5 });
    // neck, head turned toward the river, a low bun with gajra
    body(x, [[f - 8, seat - 166], [f + 14, seat - 166], [f + 16, seat - 142], [f - 10, seat - 142]], '#c08b69', { alpha: 0.9, slip: 0 });
    const hh = spline([[f - 18, seat - 176], [f - 16, seat - 204], [f + 4, seat - 218], [f + 24, seat - 210], [f + 28, seat - 186], [f + 18, seat - 168], [f - 10, seat - 166]], 8);
    body(x, hh, '#271f21', { alpha: 0.96, rough: 0.6, blotch: 0.08, gran: 0.1 });
    body(x, spline([[f + 18, seat - 196], [f + 29, seat - 188], [f + 25, seat - 170], [f + 15, seat - 170]], 6), '#c08b69', { alpha: 0.9, slip: 0 });
    body(x, P.ellipse(f + 14, seat - 186, 4, 6, 12), '#ad7856', { alpha: 0.9, slip: 0 });
    P.wash(x, P.ellipse(f + 15, seat - 178, 2.4, 2.4, 8), { color: '#d9ac55', alpha: 0.95, rough: 0.05, slip: 0, mode: 'source-over' }); // earring
    body(x, P.ellipse(f - 2, seat - 168, 17, 13, 18), '#221b1d', { alpha: 0.96, blotch: 0.08, gran: 0.1 }); // bun
    for (let k = 0; k < 11; k++) {
      const a = Math.PI * (0.85 + k * 0.13);
      P.wash(x, P.ellipse(f - 2 + Math.cos(a) * 17, seat - 168 + Math.sin(a) * 13, 3.2, 3, 8), { color: '#f7f2e6', alpha: 0.95, rough: 0.1, slip: 0, mode: 'source-over' });
    }
    lit(x, [f - 18, seat - 196], [f - 6, seat - 214], 0.4, 1.4);
    P.ink(x, spline([[f - 48, seat - 112], [f - 56, seat - 58], [f - 60, seat - 4]], 6, false), { w: 1.6, alpha: 0.45, wobble: 0.3, color: '#fbe7cf', mode: 'source-over' });
  }

  // a brass thali with marigolds and kumkum, a brass lota beside it
  function paintThali(x, cx, cy) {
    body(x, P.ellipse(cx + 40, cy + 6, 62, 15, 30), '#c99a4a', { alpha: 0.92, grad: [cx - 20, 0, cx + 100, 0, [[0, '#f0cd7e'], [0.5, '#c99a4a'], [1, '#8f6a33']]] });
    P.ink(x, P.ellipse(cx + 40, cy + 6, 62, 15, 30), { w: 1, alpha: 0.5, wobble: 0.2, color: '#6e4f24' });
    const fr = P.rng(31);
    P.wash(x, P.ellipse(cx + 40, cy + 4, 52, 10, 30), { color: '#e7c06d', alpha: 0.6, rough: 0.3, slip: 0, mode: 'source-over' });
    for (let k = 0; k < 9; k++) {
      const mx = cx + 6 + k * 7.5 + (fr() - 0.5) * 4, my = cy - 2 + (fr() - 0.5) * 6;
      for (let q = 0; q < 7; q++) { const a = (q / 7) * Math.PI * 2; P.wash(x, P.ellipse(mx + Math.cos(a) * 3.2, my + Math.sin(a) * 2, 3, 2.4, 6), { color: k % 3 ? '#e98320' : '#f1b330', alpha: 0.9, rough: 0.1, slip: 0, mode: 'source-over' }); }
      P.wash(x, P.ellipse(mx, my, 2, 1.6, 6), { color: '#a24e14', alpha: 0.8, rough: 0.05, slip: 0 });
    }
    P.wash(x, P.ellipse(cx + 58, cy + 2, 8, 4, 12), { color: '#b2271c', alpha: 0.9, rough: 0.1, slip: 0 }); // kumkum
    // lota
    const lx = cx - 30, ly = cy + 12;
    const lota = spline([[lx - 26, ly], [lx - 30, ly - 26], [lx - 14, ly - 46], [lx - 10, ly - 58], [lx - 16, ly - 64], [lx + 16, ly - 64], [lx + 10, ly - 58], [lx + 14, ly - 46], [lx + 30, ly - 26], [lx + 26, ly]], 6);
    body(x, lota, '#c99a4a', { alpha: 0.93, grad: [lx - 30, 0, lx + 30, 0, [[0, '#f2d38a'], [0.4, '#d2a352'], [1, '#7f5d2c']]] });
    lit(x, [lx - 20, ly - 30], [lx - 14, ly - 12], 0.7, 2);
  }

  // ----------------------------------------------------------- build
  SC.build = function () {
    const bg = P.card('bg', 0, 0, W, H);
    paintSky(bg.ctx);
    paintWater(bg.ctx);
    const far = P.card('far', 460, 900, 640, 590);
    paintFarBank(far.ctx);
    P.drawCard(bg.ctx, far, 0);
    const near = P.card('near', 0, 0, W, H);
    paintOurBank(near.ctx);
    paintForeground(near.ctx);
    return { bg, far, near, streaks: SC.streakSprite(), boat: SC.boatSprite() };
  };
})();
