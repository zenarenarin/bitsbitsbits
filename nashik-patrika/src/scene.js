/*
 * scene.js — one view of the Godavari at Panchavati, Nashik.
 *
 * Seen from a raised ghat on our bank, frontally across a broad river.
 * The light is a soft golden glow low behind the far bank, so the riverfront
 * reads as layered, backlit planes — haze, a far temple line, the near
 * precinct — each a little warmer and darker as it comes forward, with warm
 * rims on the edges that face the glow.
 *
 *   far bank, left   : a Naroshankar-type precinct — high river wall, corner
 *                      bell-house, an ornate shikhara behind, domes, wadas
 *   far bank, centre : low; a round open domed pavilion on the ghat, a tree,
 *                      the town climbing into haze
 *   far bank, right  : a tall tiered, arcaded tower standing in the river on
 *                      its own platform — the landmark — and houses stepping up
 *   river            : broad, carrying reflections; two small boats
 *   our bank         : steps to the water; a married couple sitting on them
 *
 * All coordinates are design pixels in a 1080 × 1920 frame.
 */
(function () {
  const P = window.P;
  const SC = (P.SC = {});
  const W = 1080, H = 1920;
  const WL = 1352;          // far waterline
  const NEAR = (x) => 1606 - x * 0.012; // our water edge
  const G = [470, 1190];    // the glow behind the far bank
  SC.WL = WL; SC.NEAR = NEAR; SC.G = G;

  const C = (SC.C = {
    paper: '#f3ecdf',
    haze: '#c2b8c6',
    far: '#a9a3bb',
    mid: '#8a86a1',
    near: '#716d8b',
    deep: '#4f4b66',
    rim: '#f0c588',
    warmStone: '#d9c4a3',
    tower: '#b98b6c',
    towerShade: '#8a6458',
    opening: '#3f3140',
    saffron: '#d9862f',
    jade: '#3f6b64',
    jadeDeep: '#2c4f4b',
    ink: '#2d2830',
  });

  // local colours of the riverfront, as they read turned away from the glow
  const SHADE = '#8a86a1';
  const L = (SC.L = {
    lime: P.mix('#e2d4b6', SHADE, 0.42),
    ochre: P.mix('#d4a86e', SHADE, 0.42),
    blue: P.mix('#b7c2c4', SHADE, 0.38),
    pink: P.mix('#d6a994', SHADE, 0.42),
    basalt: P.mix('#6b6470', SHADE, 0.2),
    sand: P.mix('#c9a47e', SHADE, 0.3),
  });
  const rng = P.rng(2027);
  const r = () => rng();

  // ----------------------------------------------------------- helpers
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const sil = (x, pts, col, o = {}) => {
    P.ground(x, pts, C.paper, o.groundRough == null ? 0.5 : o.groundRough);
    P.wash(x, pts, Object.assign({ color: col, alpha: 0.82, rough: 0.7, gran: 0.2, blotch: 0.45, edge: 0.3 }, o));
  };
  // a warm rim on the edge facing the glow
  const rimLine = (x, a, b, alpha = 0.5, w = 1.4) => P.ink(x, [a, b], { w, alpha, wobble: 0.3, gaps: 0.15, color: C.rim, mode: 'source-over' });
  const sideToGlow = (cx) => (cx < G[0] ? 1 : -1); // +1: rim on the right edge
  // cusped arch polygon, opening at (x0..x1), springing at ys, crown rise h
  const cusped = (x0, x1, yb, ys, rise, n = 14) => {
    const pts = [[x0, yb], [x1, yb], [x1, ys]];
    for (let i = 1; i < n; i++) {
      const a = Math.PI * (i / n);
      const c = 1 + 0.11 * Math.abs(Math.sin(a * 4));
      pts.push([(x0 + x1) / 2 + (Math.cos(a) * (x1 - x0) * c) / 2, ys - Math.sin(a) * rise * c]);
    }
    pts.push([x0, ys]);
    return pts;
  };
  const bulb = (cx, by, rw, h, n = 28) => {
    // a Maratha bulbous dome with a slight waist and a pointed crown
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = Math.PI * t;
      const s = Math.sin(a);
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
    P.ink(x, [[cx, ty], [cx + 0.5, ty - s * 3.2]], { w: 0.8, alpha: 0.6, wobble: 0.1, gaps: 0, color: C.deep });
    P.wash(x, [[cx + 0.6, ty - s * 3.2], [cx + s * 2.1, ty - s * 2.75], [cx + 0.6, ty - s * 2.35]], { color: C.saffron, alpha: 0.8, rough: 0.2, slip: 0 });
  };
  const shikhara = (x, cx, by, w, h, col, o = {}) => {
    const hw = (t) => (w / 2) * (1 - 0.6 * Math.pow(t, 1.55)) * (1 + 0.1 * Math.sin(Math.PI * t * 0.9));
    const prof = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push([cx - hw(t), by - t * h]); }
    for (let i = 20; i >= 0; i--) { const t = i / 20; prof.push([cx + hw(t), by - t * h]); }
    // miniature spires on the flanks
    if (o.minis !== false) for (const sd of [-1, 1]) {
      const mc = cx + sd * w * 0.36, mw = w * 0.36, mh = h * 0.48, mp = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; mp.push([mc - (mw / 2) * (1 - 0.6 * t ** 1.5), by - t * mh]); }
      for (let i = 10; i >= 0; i--) { const t = i / 10; mp.push([mc + (mw / 2) * (1 - 0.6 * t ** 1.5), by - t * mh]); }
      sil(x, mp, col, { alpha: 0.85 });
    }
    sil(x, prof, col, { alpha: 0.88 });
    // shade on the side away from the glow
    const sd = sideToGlow(cx);
    const half = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; half.push([cx + sd * -hw(t) * 0.05, by - t * h]); }
    for (let i = 20; i >= 0; i--) { const t = i / 20; half.push([cx - sd * hw(t), by - t * h]); }
    P.wash(x, half, { color: C.deep, alpha: 0.32, rough: 0.5, soft: 1 });
    // courses
    if (o.detail !== false) for (let i = 1; i < 12; i++) {
      const t = i / 12, y = by - t * h, ww = hw(t);
      P.ink(x, [[cx - ww * 0.96, y], [cx, y + 1.2], [cx + ww * 0.96, y]], { w: 0.5, alpha: i % 3 ? 0.16 : 0.3, wobble: 0.2, gaps: 0.1, color: C.deep });
    }
    // amalaka + kalash
    const tw = hw(1);
    P.wash(x, P.ellipse(cx, by - h - tw * 0.25, tw * 1.35, tw * 0.42, 18), { color: C.deep, alpha: 0.8, rough: 0.1, slip: 0 });
    finial(x, cx, by - h - tw * 0.6, Math.max(3, w * 0.06), C.deep);
    // rim toward the glow
    const rimSide = prof.filter((_, i) => (sd > 0 ? i > 20 : i <= 20));
    P.ink(x, rimSide, { w: 1.2, alpha: o.rim == null ? 0.45 : o.rim, wobble: 0.2, gaps: 0.2, color: C.rim, mode: 'source-over' });
    if (o.flag) flag(x, cx, by - h - tw * 0.6 - Math.max(3, w * 0.06) * 1.5, Math.max(3, w * 0.07));
  };
  const domeOn = (x, cx, by, rw, h, col, o = {}) => {
    const d = bulb(cx, by, rw, h);
    sil(x, d, col, { alpha: 0.86 });
    const sd = sideToGlow(cx);
    P.wash(x, d.filter(([px]) => (sd > 0 ? px <= cx + 1 : px >= cx - 1)), { color: C.deep, alpha: 0.3, rough: 0.4 });
    P.ink(x, d.filter(([px]) => (sd > 0 ? px >= cx : px <= cx)), { w: 1, alpha: 0.4, wobble: 0.2, gaps: 0.2, color: C.rim, mode: 'source-over' });
    finial(x, cx, by - h, Math.max(2.5, rw * 0.14), C.deep);
    if (o.flag) flag(x, cx, by - h - rw * 0.25, Math.max(2.5, rw * 0.12));
  };
  // a wada as a simple block with a few dark windows and a balcony band
  const block = (x, x0, x1, top, base, col, o = {}) => {
    const roof = o.roof;
    const pts = roof === 'tile'
      ? [[x0, base], [x1, base], [x1, top + 8], [x1 + 4, top + 8], [x1 - (x1 - x0) * 0.1, top - (o.pitch || 10)], [x0 + (x1 - x0) * 0.1, top - (o.pitch || 10)], [x0 - 4, top + 8], [x0, top + 8]]
      : [[x0, base], [x1, base], [x1, top], [x0, top]];
    sil(x, pts, col, { alpha: 0.86, blotch: 0.55, gran: 0.25 });
    // a little life on the roofline: a parapet step, a tank, a pole
    const lr0 = P.rng((o.seed || 3) + 99);
    if (roof !== 'tile' && x1 - x0 > 30 && lr0() < 0.7) {
      const a = x0 + (x1 - x0) * (0.15 + lr0() * 0.5), w = 8 + lr0() * 14;
      sil(x, rect(a, top - 6 - lr0() * 8, a + w, top + 1), P.mix(col, C.deep, 0.15), { alpha: 0.8 });
    }
    if (lr0() < 0.25) P.ink(x, [[x0 + (x1 - x0) * 0.8, top], [x0 + (x1 - x0) * 0.8, top - 16]], { w: 0.7, alpha: 0.5, wobble: 0.1, gaps: 0, color: C.deep });
    // light falling down the face from the top edge: shade deepens below
    P.wash(x, rect(x0, top + (base - top) * 0.45, x1, base), { color: C.deep, alpha: 0.14, rough: 0.6, soft: 2 });
    if (roof === 'tile') P.wash(x, [[x0 - 4, top + 8], [x1 + 4, top + 8], [x1 - (x1 - x0) * 0.1, top - (o.pitch || 10)], [x0 + (x1 - x0) * 0.1, top - (o.pitch || 10)]], { color: P.mix(col, '#a7604a', 0.45), alpha: 0.7, rough: 0.5 });
    else P.wash(x, rect(x0 - 2, top - 3, x1 + 2, top + 3), { color: C.deep, alpha: 0.35, rough: 0.3 });
    const rows = o.rows == null ? Math.max(1, Math.floor((base - top) / 26)) : o.rows;
    const lr = P.rng(o.seed || 3);
    for (let j = 0; j < rows; j++) {
      const yy = top + 12 + j * ((base - top - 10) / rows);
      const n = Math.max(1, Math.floor((x1 - x0) / 16));
      for (let i = 0; i < n; i++) {
        if (lr() < 0.35) continue;
        const wx = x0 + ((i + 0.5) * (x1 - x0)) / n;
        const ww = Math.max(2, (x1 - x0) / n * 0.32), wh = Math.min(10, (base - top) / rows * 0.45);
        P.wash(x, o.arch && lr() < 0.6 ? cusped(wx - ww / 2, wx + ww / 2, yy + wh, yy + ww * 0.5, ww * 0.5, 8) : rect(wx - ww / 2, yy, wx + ww / 2, yy + wh), { color: C.deep, alpha: 0.55, rough: 0.2, slip: 0.5 });
      }
    }
    if (o.balcony) {
      const by = top + (base - top) * o.balcony;
      P.wash(x, rect(x0 + 2, by, x1 - 2, by + 5), { color: P.mix(C.deep, '#6a4a3a', 0.5), alpha: 0.6, rough: 0.3 });
      for (let bx = x0 + 4; bx < x1 - 3; bx += 3.2) P.ink(x, [[bx, by - 6], [bx, by]], { w: 0.5, alpha: 0.35, wobble: 0.05, gaps: 0, color: C.deep });
      P.wash(x, rect(x0 + 2, by - 8, x1 - 2, by - 6), { color: C.deep, alpha: 0.4, rough: 0.2 });
    }
    const sd = sideToGlow((x0 + x1) / 2);
    if (o.rim !== false) rimLine(x, [sd > 0 ? x1 : x0, top + 2], [sd > 0 ? x1 : x0, base - 4], 0.35, 1.1);
    if (o.rimTop) rimLine(x, [x0, top], [x1, top], 0.35, 1);
  };
  const tree = (x, cx, cy, R, col, seed) => {
    const tr = P.rng(seed);
    for (let i = 0; i < 9; i++) {
      const a = tr() * Math.PI * 2, d = tr() * R * 0.5;
      const rr = R * (0.32 + tr() * 0.3);
      P.wash(x, P.ellipse(cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * 0.6, rr, rr * 0.78, 22), { color: col, alpha: 0.32, rough: rr * 0.28, soft: 0.8, freq: 0.1, layers: 2, gran: 0.2, edge: 0.25 });
    }
    for (let i = 0; i < 3; i++) {
      const rr = R * (0.2 + tr() * 0.2);
      P.wash(x, P.ellipse(cx + (tr() - 0.5) * R, cy + R * 0.25, rr, rr * 0.5, 16), { color: '#6d7268', alpha: 0.22, rough: rr * 0.3, soft: 0.8, freq: 0.1 });
    }
    P.wash(x, rect(cx - 2, cy + R * 0.3, cx + 3, cy + R * 1.1), { color: C.deep, alpha: 0.6, rough: 0.6 });
  };
  // tiny figures on the far ghat
  const tiny = (x, cx, by, h, cloth) => {
    const w = h * 0.3;
    P.wash(x, [[cx - w / 2, by - h * 0.8], [cx + w / 2, by - h * 0.8], [cx + w * 0.6, by], [cx - w * 0.6, by]], { color: cloth, alpha: 0.85, rough: 0.15, slip: 0 });
    P.wash(x, P.ellipse(cx, by - h * 0.9, h * 0.1, h * 0.11, 8), { color: '#3a2c2c', alpha: 0.9, rough: 0.05, slip: 0 });
  };

  // ----------------------------------------------------------- sky
  function paintSky(x) {
    x.fillStyle = C.paper;
    x.fillRect(0, 0, W, H);
    const R = rect(-40, 60, W + 40, 1420);
    // a sky that rises out of the paper: almost nothing at the top
    P.wash(x, R, { grad: [0, 60, 0, 1400, [[0, 'rgba(243,236,223,0)'], [0.3, '#efe5d2'], [0.62, '#efd9b8'], [0.84, '#eec691'], [1, '#e9b578']]], alpha: 0.85, rough: 0, blotch: 0.15, slip: 0 });
    // the glow, low, behind the far bank
    P.wash(x, P.ellipse(G[0], G[1] - 40, 520, 230, 40), { color: '#f2c27e', alpha: 0.45, rough: 30, soft: 70, freq: 0.01 });
    P.wash(x, P.ellipse(G[0], G[1] - 10, 260, 90, 40), { color: '#f6d9a0', alpha: 0.5, rough: 20, soft: 40, freq: 0.01, mode: 'source-over' });
    // cool, wet-in-wet cloud banks at the sides of the low sky
    for (const [cx, cy, rx, ry, a] of [[60, 1080, 360, 70, 0.22], [1020, 1020, 380, 80, 0.2], [900, 1130, 300, 40, 0.18], [150, 1160, 260, 34, 0.18], [820, 880, 260, 50, 0.08], [220, 900, 240, 40, 0.07]]) {
      P.wash(x, P.ellipse(cx, cy, rx, ry, 30), { color: '#b9b3c6', alpha: a, rough: 26, soft: 26, freq: 0.02, layers: 2, bloom: 0.1 });
    }
    // warm wisps catching light
    for (const [cx, cy, rx] of [[640, 1090, 220], [300, 1040, 160], [760, 1010, 140]]) {
      P.wash(x, P.ellipse(cx, cy, rx, 9, 24), { color: '#f4cf95', alpha: 0.35, rough: 8, soft: 6, freq: 0.03, mode: 'source-over' });
    }
  }

  // ----------------------------------------------------------- the riverfront
  function paintFarBank(x) {
    // --- distance: hills, then the town climbing behind the river
    const ridge = (y0, amp, seed) => {
      const pts = [[-20, 1320]];
      for (let X = -20; X <= W + 20; X += 16) pts.push([X, y0 - amp * P.fbm(X / 220, 0.5, 3, seed) - 30 * Math.exp(-((X - 760) ** 2) / 30000)]);
      pts.push([W + 20, 1320]);
      return pts;
    };
    P.wash(x, ridge(1205, 70, 3), { color: '#c3b9c8', alpha: 0.4, rough: 2, soft: 2, blotch: 0.3, slip: 0 });
    for (let X = -10; X < W; X += 14 + r() * 26) {
      const w = 14 + r() * 30, h = 18 + r() * 40, yb = 1290;
      P.wash(x, rect(X, yb - h, X + w, yb), { color: r() < 0.5 ? '#c4b8c4' : '#bdb4c3', alpha: 0.42, rough: 0.5, soft: 0.6, blotch: 0.3, slip: 0 });
    }
    // distant temple line (Kapaleshwar, Kalaram beyond) — just shapes in haze
    shikhara(x, 560, 1262, 30, 70, C.far, { minis: false, detail: false, rim: 0.3, flag: true });
    shikhara(x, 640, 1268, 22, 50, C.far, { minis: false, detail: false, rim: 0.25 });
    domeOn(x, 700, 1262, 18, 26, C.far);
    shikhara(x, 800, 1255, 26, 58, C.far, { minis: false, detail: false, rim: 0.3, flag: true });
    shikhara(x, 70, 1240, 34, 70, C.far, { minis: false, detail: false, rim: 0.25 });

    // --- the old town packed behind the riverfront: roofs, spires, domes
    {
      const br = P.rng(404);
      let X = 300;
      while (X < 1000) {
        const w = 26 + br() * 44, top = 1168 + br() * 46;
        const lc = [L.lime, L.ochre, L.blue, L.pink][Math.floor(br() * 4)];
        block(x, X, X + w, top, 1300, P.mix(lc, C.far, 0.5), { roof: br() < 0.45 ? 'tile' : null, pitch: 7, rows: 2, seed: X | 0, rim: false });
        X += w - 4 - br() * 8;
      }
      shikhara(x, 598, 1206, 40, 92, P.mix(L.basalt, C.far, 0.4), { minis: true, detail: false, rim: 0.35, flag: true });
      domeOn(x, 668, 1196, 24, 30, P.mix(L.sand, C.far, 0.45));
      shikhara(x, 905, 1196, 44, 100, P.mix(L.basalt, C.far, 0.35), { minis: true, detail: false, rim: 0.35, flag: true });
      domeOn(x, 520, 1206, 20, 26, P.mix(L.sand, C.far, 0.45));
    }
    // --- second plane: houses behind the ghat, mid haze
    const houses2 = [[-10, 70, 1196, L.lime], [62, 120, 1212, L.blue], [470, 540, 1228, L.pink], [532, 600, 1236, L.lime], [600, 680, 1226, L.ochre], [680, 735, 1240, L.blue], [960, 1090, 1150, L.lime]];
    for (const [x0, x1, top, lc] of houses2) block(x, x0, x1, top, 1310, P.mix(lc, C.far, 0.45), { roof: r() < 0.4 ? 'tile' : null, rows: 2, seed: x0 | 0, rim: false });
    tree(x, 772, 1222, 44, '#8d9478', 7);

    // --- the precinct on the left: enclosure wall on the river, temple behind
    // shikhara with its mandapa (ornate, the darkest form on the far bank)
    sil(x, rect(170, 1214, 282, 1312), L.basalt); // mandapa block
    for (let ax = 180; ax < 270; ax += 22) P.wash(x, cusped(ax, ax + 12, 1250, 1232, 6, 8), { color: C.deep, alpha: 0.5, rough: 0.15, slip: 0 });
    domeOn(x, 226, 1216, 42, 46, L.basalt);
    shikhara(x, 118, 1232, 104, 160, P.mix(L.basalt, C.deep, 0.15), { flag: true });
    block(x, 292, 372, 1182, 1312, L.ochre, { roof: 'tile', pitch: 12, rows: 3, seed: 21, balcony: 0.45, arch: true });
    block(x, 370, 420, 1214, 1312, L.lime, { rows: 3, seed: 23 });
    domeOn(x, 448, 1236, 26, 30, L.basalt);
    // the high river wall of the precinct, with a cornice
    const wallTop = 1262;
    sil(x, [[-20, 1336], [440, 1336], [440, wallTop], [-20, wallTop]], P.mix(L.basalt, '#9a8a86', 0.35), { blotch: 0.6, gran: 0.35 });
    P.wash(x, rect(-20, wallTop - 4, 446, wallTop + 4), { color: C.deep, alpha: 0.5, rough: 0.3 });
    rimLine(x, [-20, wallTop - 4], [446, wallTop - 4], 0.45, 1.2);
    for (let yy = wallTop + 12; yy < 1334; yy += 10) P.ink(x, [[-20, yy], [440, yy]], { w: 0.5, alpha: 0.14, wobble: 0.3, gaps: 0.2, color: C.deep });
    // a gateway: steps climb from the ghat through the wall into the precinct
    {
      const g0 = 196, g1 = 252;
      const st = [[g0 - 8, 1336], [g1 + 8, 1336], [g1, wallTop + 6], [g0, wallTop + 6]];
      P.ground(x, st, C.paper, 0.3);
      P.wash(x, st, { grad: [0, wallTop, 0, 1336, [[0, '#a99a93'], [1, '#d8c4a4']]], alpha: 0.85, rough: 0.4, gran: 0.25 });
      for (let yy = wallTop + 12; yy < 1336; yy += 6) P.ink(x, [[g0 - (yy - wallTop) * 0.1, yy], [g1 + (yy - wallTop) * 0.1, yy]], { w: 0.6, alpha: 0.35, wobble: 0.2, color: '#6d6170' });
      P.wash(x, cusped(g0 + 6, g1 - 6, wallTop + 8, wallTop - 14, 12, 12), { color: C.opening, alpha: 0.85, rough: 0.15, slip: 0 });
      sil(x, rect(g0 - 10, wallTop - 40, g1 + 10, wallTop - 26), P.mix(L.basalt, '#9a8a86', 0.3));
      domeOn(x, (g0 + g1) / 2, wallTop - 40, 18, 22, L.basalt);
      rimLine(x, [g0 - 10, wallTop - 40], [g0 - 10, wallTop + 6], 0.4, 1);
    }
    // blind arcade along the wall
    for (let ax = 14; ax < 420; ax += 30) { if (ax > 170 && ax < 262) continue; P.wash(x, cusped(ax, ax + 16, 1300, 1284, 7, 8), { color: C.deep, alpha: 0.3, rough: 0.15, slip: 0.5 }); }
    // the corner bell-house over the water: a square kiosk, a cusped arch,
    // the bell hanging in it, a dome
    {
      const k0 = 384, k1 = 446, kb = wallTop, kt = 1210;
      sil(x, rect(k0, kt, k1, kb), P.mix(L.basalt, '#9a8a86', 0.25));
      P.wash(x, cusped(k0 + 9, k1 - 9, kb - 4, kt + 18, 10, 12), { color: C.opening, alpha: 0.85, rough: 0.15, slip: 0 });
      // glow through the far arch
      P.wash(x, rect(k0 + 22, kt + 22, k1 - 22, kb - 8), { color: '#e9b578', alpha: 0.5, rough: 0.3, soft: 1, mode: 'source-over' });
      const bc = (k0 + k1) / 2;
      P.ink(x, [[bc, kt + 9], [bc, kt + 20]], { w: 0.8, alpha: 0.8, wobble: 0, gaps: 0, color: C.opening });
      P.wash(x, [[bc - 2, kt + 20], [bc + 2, kt + 20], [bc + 6, kt + 31], [bc - 6, kt + 31]], { color: '#3a2c26', alpha: 0.95, rough: 0.05, slip: 0 });
      P.wash(x, rect(k0 - 5, kt - 5, k1 + 5, kt + 1), { color: C.deep, alpha: 0.75, rough: 0.2 });
      domeOn(x, bc, kt - 5, 26, 36, L.basalt);
      rimLine(x, [k1, kt], [k1, kb], 0.55, 1.3);
    }
    // a second, smaller corner kiosk at the far left end, cropped
    sil(x, rect(-12, 1218, 30, wallTop), P.mix(L.basalt, '#9a8a86', 0.25));
    P.wash(x, cusped(-4, 22, wallTop - 4, 1236, 7, 10), { color: C.opening, alpha: 0.8, rough: 0.15, slip: 0 });
    domeOn(x, 9, 1214, 22, 28, L.basalt);

    // --- centre: low wadas right on the ghat, and the round pavilion
    block(x, 452, 520, 1250, 1318, L.lime, { rows: 2, seed: 31, arch: true });
    block(x, 518, 586, 1262, 1318, L.ochre, { roof: 'tile', pitch: 9, rows: 2, seed: 33, balcony: 0.5 });
    block(x, 690, 758, 1258, 1318, L.blue, { rows: 2, seed: 35 });
    block(x, 756, 812, 1272, 1318, L.pink, { roof: 'tile', pitch: 8, rows: 1, seed: 37 });

    // --- right: houses stepping up behind the tower
    block(x, 822, 900, 1220, 1318, L.lime, { rows: 3, seed: 41, balcony: 0.55 });
    block(x, 1010, 1095, 1196, 1318, L.ochre, { roof: 'tile', pitch: 12, rows: 4, seed: 43, balcony: 0.4, arch: true });

    // --- the far ghat: long steps and platforms running into the water
    const ghat = [[-20, 1310], [W + 20, 1306], [W + 20, WL], [-20, WL + 2]];
    P.ground(x, ghat, C.paper, 0.4);
    P.wash(x, ghat, { grad: [0, 1306, 0, WL, [[0, '#d7c3a2'], [1, '#bcab97']]], alpha: 0.85, rough: 0.5, gran: 0.25, blotch: 0.4 });
    // under the precinct wall, the ghat is narrower
    for (let k = 0; k < 7; k++) {
      const yy = 1312 + k * 6.2 + k * k * 0.12;
      P.ink(x, [[-20, yy], [W + 20, yy - 3]], { w: 0.7, alpha: 0.32, wobble: 0.4, gaps: 0.1, color: '#6d6170', step: 8 });
    }
    // light catching the treads near the glow
    P.wash(x, P.ellipse(G[0], 1326, 300, 16, 30), { color: '#f3d6a0', alpha: 0.4, rough: 6, soft: 6, mode: 'source-over' });
    // the precinct wall comes down to the water on its own plinth
    sil(x, [[-20, WL + 2], [440, WL + 1], [440, 1330], [-20, 1330]], P.mix(C.near, '#8c7c82', 0.45), { alpha: 0.75 });
    // a platform jutting into the river at the centre, with small shrines
    sil(x, [[520, WL - 2], [700, WL - 3], [712, WL + 10], [508, WL + 11]], '#c9b79c', { alpha: 0.85 });
    P.ink(x, [[508, WL + 11], [712, WL + 10]], { w: 0.8, alpha: 0.4, wobble: 0.3, color: '#5a4f5e' });
    // the round open pavilion on its platform
    {
      const cx = 612, base = WL - 2, r0 = 46, top = 1290;
      // the interior is open: the glowing sky and far ghat show through
      P.wash(x, rect(cx - r0, top, cx + r0, base), { color: '#e8c08a', alpha: 0.55, rough: 0.2, slip: 0, mode: 'source-over' });
      P.wash(x, rect(cx - r0, top, cx + r0, top + 9), { color: C.deep, alpha: 0.45, rough: 0.3, soft: 1 });
      P.wash(x, rect(cx - r0, base - 14, cx + r0, base), { color: '#bcab97', alpha: 0.6, rough: 0.3 });
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * ((i + 0.5) / 6);
        const px = cx - Math.cos(a) * r0 * 0.92, wv = 3 + Math.sin(a) * 3;
        P.wash(x, rect(px - wv / 2, top, px + wv / 2, base), { color: L.sand, alpha: 0.92, rough: 0.2, slip: 0 });
        P.wash(x, rect(px + wv * 0.1, top, px + wv / 2, base), { color: C.deep, alpha: 0.3, rough: 0.1, slip: 0 });
      }
      // plinth step
      sil(x, rect(cx - r0 - 4, base - 5, cx + r0 + 4, base + 1), L.sand);
      sil(x, [[cx - r0 - 6, top + 1], [cx + r0 + 6, top + 1], [cx + r0 + 3, top - 5], [cx - r0 - 3, top - 5]], C.mid);
      // shallow ribbed dome
      const d = [];
      for (let i = 0; i <= 24; i++) { const a = Math.PI * (i / 24); d.push([cx - Math.cos(a) * (r0 + 2), top - 5 - Math.sin(a) * 26]); }
      sil(x, d, P.mix(C.mid, '#b8a594', 0.35));
      for (let k = -3; k <= 3; k++) P.ink(x, [[cx + k * 12, top - 5], [cx + k * 4, top - 30]], { w: 0.6, alpha: 0.3, wobble: 0.2, color: C.deep });
      P.ink(x, d.slice(0, 13), { w: 1.2, alpha: 0.5, wobble: 0.2, gaps: 0.2, color: C.rim, mode: 'source-over' });
      finial(x, cx, top - 31, 4, C.deep);
    }
    // the landmark: a tiered arcaded tower standing in the river
    {
      const cx = 984, base = WL + 2, w0 = 78;
      // platform
      sil(x, [[cx - 78, base - 16], [cx + 110, base - 18], [cx + 116, base + 4], [cx - 82, base + 6]], '#c8b398', { alpha: 0.88 });
      P.ink(x, [[cx - 82, base + 6], [cx + 116, base + 4]], { w: 0.8, alpha: 0.45, wobble: 0.3, color: '#5a4f5e' });
      let yb = base - 16, ww = w0;
      const tiers = [138, 120, 104, 88];
      for (let i = 0; i < tiers.length; i++) {
        const th = tiers[i];
        const x0 = cx - ww / 2, x1 = cx + ww / 2, yt = yb - th;
        sil(x, rect(x0, yt, x1, yb), C.tower, { alpha: 0.82, gran: 0.35, blotch: 0.6 });
        // shade side (away from glow = right)
        P.wash(x, rect(cx + ww * 0.12, yt, x1, yb), { color: C.towerShade, alpha: 0.45, rough: 0.4 });
        // arcade: two openings on the front, cusped
        // pilasters and a single cusped opening per tier, the glow showing through
        const ow = ww * 0.3;
        for (const ox of [cx - ww * 0.21, cx + ww * 0.21]) {
          P.wash(x, cusped(ox - ow / 2, ox + ow / 2, yb - 12, yt + th * 0.4, ow * 0.42, 14), { color: C.opening, alpha: 0.82, rough: 0.15, slip: 0 });
          P.wash(x, rect(ox - ow / 2 + 2, yt + th * 0.5, ox + ow / 2 - 2, yb - 14), { color: '#e6b277', alpha: ox < cx ? 0.32 : 0.18, rough: 0.3, soft: 1, mode: 'source-over' });
        }
        // a balcony ledge on brackets across the foot of each tier
        P.wash(x, rect(x0 - 6, yb - 13, x1 + 6, yb - 9), { color: P.mix(C.towerShade, C.deep, 0.3), alpha: 0.8, rough: 0.15 });
        for (let bx = x0 - 3; bx <= x1 + 3; bx += 6) P.ink(x, [[bx, yb - 9], [bx, yb - 5]], { w: 0.8, alpha: 0.45, wobble: 0.05, gaps: 0, color: C.deep });
        for (let bx = x0 - 4; bx <= x1 + 4; bx += 3.2) P.ink(x, [[bx, yb - 19], [bx, yb - 13]], { w: 0.5, alpha: 0.35, wobble: 0.05, gaps: 0, color: C.deep });
        for (const px of [x0 + 5, x1 - 5]) P.ink(x, [[px, yt + 6], [px, yb - 3]], { w: 0.7, alpha: 0.3, wobble: 0.2, color: C.towerShade });
        P.wash(x, rect(x0 - 3, yb - 6, x1 + 3, yb), { color: C.towerShade, alpha: 0.5, rough: 0.2 });
        // cornice
        P.wash(x, rect(x0 - 5, yt - 2, x1 + 5, yt + 5), { color: P.mix(C.towerShade, C.deep, 0.4), alpha: 0.85, rough: 0.2 });
        P.ink(x, [[x0 - 5, yt - 2], [x1 + 5, yt - 2]], { w: 1, alpha: 0.45, wobble: 0.2, color: C.rim, mode: 'source-over' });
        rimLine(x, [x0, yt + 4], [x0, yb - 2], 0.5, 1.2);
        P.pencil(x, [x0, yb], [x0, yt], { alpha: 0.2, over: 6 });
        yb = yt - 2; ww *= 0.86;
      }
      // little chhatri and dome on top
      domeOn(x, cx, yb, ww * 0.52, ww * 0.7, P.mix(C.tower, C.towerShade, 0.4), { flag: true });
    }

    // boats moored by the pavilion platform
    boat(x, 470, WL + 22, 44, false);

    // people on the far ghat, for scale: a few, not a crowd
    const people = [[96, 1338, 16, '#e9e1d2'], [104, 1339, 15, '#8b3b30'], [238, 1342, 15, '#efe6d6'], [492, 1344, 16, C.saffron], [560, 1347, 15, '#efe6d6'], [748, 1340, 16, '#5f6a7c'], [824, 1338, 15, '#9d4636'], [836, 1339, 16, '#e9e1d2']];
    for (const [px, py, h, c] of people) tiny(x, px, py, h, c);
  }

  // a small wooden boat (screen space), optionally with a boatman
  function boat(x, cx, wl, L, man) {
    const h = L * 0.13;
    const hull = [[cx - L / 2, wl - h * 1.5], [cx - L * 0.38, wl - h * 0.2], [cx + L * 0.4, wl - h * 0.1], [cx + L / 2 + 3, wl - h * 1.7], [cx + L * 0.35, wl - h * 1.1], [cx - L * 0.35, wl - h * 1.0]];
    sil(x, hull, '#5b4238', { alpha: 0.9, edge: 0.2 });
    P.ink(x, [[cx - L * 0.35, wl - h * 1.05], [cx + L * 0.36, wl - h * 1.15]], { w: 0.8, alpha: 0.5, wobble: 0.1, color: '#c99a5d', mode: 'source-over' });
    if (man) {
      tiny(x, cx + L * 0.12, wl - h * 1.1, L * 0.42, '#e4dccd');
      P.ink(x, [[cx + L * 0.22, wl - h * 1.1 - L * 0.32], [cx + L * 0.5, wl + L * 0.08]], { w: 0.8, alpha: 0.6, wobble: 0.1, gaps: 0, color: '#3c302c' });
    }
  }
  SC.boatSprite = function () {
    const c = P.card('boat', 0, 0, 80, 40);
    boat(c.ctx, 40, 30, 54, true);
    return c;
  };

  // ----------------------------------------------------------- water (static base)
  function paintWater(x) {
    const poly = [[-20, WL - 1], [W + 20, WL - 1], [W + 20, 1640], [-20, 1640]];
    P.ground(x, poly, C.paper, 0);
    P.wash(x, poly, { grad: [0, WL, 0, 1640, [[0, '#b7b3b8'], [0.12, '#cfc0a6'], [0.32, '#cdb58e'], [0.55, '#86978a'], [0.8, '#4f7570'], [1, '#365b56']]], alpha: 0.88, rough: 0, blotch: 0.25, slip: 0 });
    // the glow's reflection: a soft warm column under the light
    P.wash(x, P.ellipse(G[0], 1440, 210, 110, 30), { color: '#f0cf98', alpha: 0.42, rough: 20, soft: 30, freq: 0.02, mode: 'source-over' });
    // wet-in-wet jade and slate patches
    const wr = P.rng(15);
    for (let i = 0; i < 8; i++) {
      const cx = wr() * W, cy = 1470 + wr() * 160, rx = 160 + wr() * 260;
      P.wash(x, P.ellipse(cx, cy, rx, rx * 0.12, 30), { color: wr() < 0.6 ? '#2f5a54' : '#7c8f9a', alpha: 0.16, rough: 16, soft: 14, freq: 0.02 });
    }
  }
  // water texture that drifts: short horizontal touches, light and dark.
  // Tileable across 1080 px so it can slide with the current.
  SC.streakSprite = function () {
    const c = P.card('streaks', 0, WL, W * 2, 290);
    const x = c.ctx;
    const sr = P.rng(88);
    for (let i = 0; i < 260; i++) {
      const y = WL + 6 + Math.pow(sr(), 1.25) * 280;
      const k = (y - WL) / 280;
      const len = 14 + sr() * (40 + 160 * k);
      const x0 = sr() * W;
      const th = 0.8 + k * 3.2;
      const light = sr() < 0.55;
      for (const off of [0, W]) {
        P.wash(x, [[x0 + off, y], [x0 + off + len, y - 0.4], [x0 + off + len * 0.88, y + th], [x0 + off + len * 0.1, y + th * 1.05]], {
          color: light ? '#f3e4c4' : '#26453f', alpha: light ? 0.32 - k * 0.12 : 0.14 + k * 0.14, rough: 0.6 + k * 1.5, soft: 0.5 + k * 1.2, slip: 0,
          mode: 'source-over', seed: i * 7 + 1,
        });
      }
    }
    return c;
  };

  // ----------------------------------------------------------- our bank
  function paintNear(x) {
    // steps descending to the water, seen from above: treads catch the sky,
    // noses are dark lines; then the paved landing, fading into the paper
    const edge = (y0) => (xx) => y0 - xx * 0.012;
    const noses = [1606, 1628, 1654, 1686, 1724];
    // the drowned lowest step under the surface
    P.wash(x, [[-20, 1606 + 0.24], [W + 20, 1606 - 13], [W + 20, 1606 - 1], [-20, 1606 + 12]], { color: '#2c4c47', alpha: 0.35, rough: 1, soft: 1.5, slip: 0 });
    for (let k = 0; k < noses.length; k++) {
      const y0 = noses[k], y1 = k + 1 < noses.length ? noses[k + 1] : 1960;
      const e0 = edge(y0), e1 = edge(y1);
      const poly = [[-20, e0(-20)], [W + 20, e0(W + 20)], [W + 20, e1(W + 20)], [-20, e1(-20)]];
      P.ground(x, poly, C.paper, 0.3, k);
      if (k < noses.length - 1) {
        const wet = k === 0;
        P.wash(x, poly, { grad: [0, y0, 0, y1, [[0, wet ? '#7b8378' : '#cdbb9c'], [1, wet ? '#8e8a7c' : '#b3a38d']]], alpha: 0.82, rough: 0.6, gran: 0.25, blotch: 0.5, edge: 0.2 });
        // shade at the back of each tread, under the step above (we are above it)
        P.wash(x, [[-20, e1(-20) - (y1 - y0) * 0.35], [W + 20, e1(W + 20) - (y1 - y0) * 0.35], [W + 20, e1(W + 20)], [-20, e1(-20)]], { color: '#7a7590', alpha: 0.28, rough: 1, soft: 2, slip: 0 });
        P.ink(x, [[-20, e0(-20)], [W + 20, e0(W + 20)]], { w: 1 + k * 0.25, alpha: 0.55, wobble: 0.5, gaps: 0.06, color: '#3d3540', step: 7 });
        P.ink(x, [[-20, e0(-20) + 1.5], [W + 20, e0(W + 20) + 1.5]], { w: 0.8, alpha: 0.35, wobble: 0.5, gaps: 0.25, color: '#f1dfbf', step: 7, mode: 'source-over' });
        // joints between blocks
        let jx = r() * 80;
        while (jx < W) {
          P.ink(x, [[jx, e0(jx) + 2], [jx + 3, e1(jx) - 1]], { w: 0.7, alpha: 0.28, wobble: 0.2, color: '#4a4248' });
          jx += 70 + r() * 90;
        }
      } else {
        // the landing: large slabs in perspective, washed lighter toward us
        // so the paving gives way to the paper
        P.wash(x, poly, { grad: [0, y0, 0, 1900, [[0, '#c2b196'], [0.25, '#d3c4aa'], [0.65, 'rgba(232,222,204,0.6)'], [1, 'rgba(243,236,223,0)']]], alpha: 0.75, rough: 0.6, gran: 0.15, blotch: 0.5, slip: 0 });
        for (let yy = y0 + 34; yy < 1830; yy += 34 + (yy - y0) * 0.35) {
          const a = 0.22 * (1 - (yy - y0) / 140);
          if (a > 0.02) P.ink(x, [[-20, edge(yy)(-20)], [W + 20, edge(yy)(W + 20)]], { w: 0.7, alpha: a, wobble: 0.4, gaps: 0.2, color: '#5a5058' });
        }
        for (let jx = -40; jx < W + 60; jx += 120) {
          const vx = 540; // vanishing point far above: joints splay slightly
          const xb = jx + (jx - vx) * 0.18;
          P.ink(x, [[jx, e0(jx) + 2], [jx + (xb - jx) * 0.6, 1800]], { w: 0.6, alpha: 0.12, wobble: 0.4, gaps: 0.3, color: '#5a5058' });
        }
      }
    }
    // a deep shadow line where the water meets the steps
    P.wash(x, [[-20, 1606 + 0.24 - 2], [W + 20, 1606 - 13 - 2], [W + 20, 1606 - 13 + 3], [-20, 1606 + 0.24 + 3]], { color: '#2a3c38', alpha: 0.5, rough: 0.8, soft: 0.8, slip: 0 });
    paintCouple(x, 286, 1650);
  }

  // ----------------------------------------------------------- the couple
  /*
   * Seen from behind, small, sitting side by side on a step and looking at
   * the river. She is in a sari of muted kumkum red with a narrow ochre
   * border, the pallu over her left shoulder, hair in a low bun with a few
   * white flowers. He is in an off-white kurta. Backlit: warm rims, cool
   * shadow sides, a soft shadow falling toward us on the step.
   */
  function paintCouple(x, cx, base) {
    const s = 1; // px per unit (1 unit ≈ 1 cm at this depth)
    // shadow on the step, falling toward us
    P.wash(x, P.ellipse(cx + 6, base + 10, 64, 9, 24), { color: '#5d576c', alpha: 0.3, rough: 2, soft: 4, slip: 0 });

    // --- him (right)
    const m = cx + 30;
    const kurta = [[m - 22, base + 2], [m - 20, base - 30], [m - 18, base - 58], [m - 16, base - 72], [m - 8, base - 78], [m + 8, base - 78], [m + 17, base - 72], [m + 20, base - 58], [m + 22, base - 30], [m + 25, base + 2]];
    sil(x, kurta, '#d2c8b7', { alpha: 0.88, rough: 0.7, gran: 0.25, blotch: 0.4, edge: 0.4 });
    // shadow side (away from the glow: his right, our right) and folds
    P.wash(x, [[m + 2, base - 78], [m + 17, base - 72], [m + 20, base - 58], [m + 22, base - 30], [m + 25, base + 2], [m + 4, base + 2], [m + 6, base - 40]], { color: '#8a87a2', alpha: 0.45, rough: 0.6, soft: 0.6 });
    P.ink(x, [[m - 4, base - 70], [m - 2, base - 40], [m - 5, base - 4]], { w: 0.7, alpha: 0.25, wobble: 0.3, color: '#6c6880' });
    // arm resting
    P.ink(x, [[m - 19, base - 66], [m - 21, base - 40], [m - 20, base - 18]], { w: 0.9, alpha: 0.35, wobble: 0.3, color: '#6c6880' });
    // dhoti on the step
    sil(x, [[m - 26, base + 3], [m + 28, base + 3], [m + 24, base - 6], [m - 23, base - 6]], '#d8cdb9', { alpha: 0.8, rough: 0.4 });
    // neck and head
    P.wash(x, [[m - 4, base - 86], [m + 4, base - 86], [m + 5, base - 76], [m - 5, base - 76]], { color: '#8b5f48', alpha: 0.85, rough: 0.2, slip: 0 });
    P.wash(x, P.ellipse(m, base - 94, 9.5, 11, 18), { color: '#2c2425', alpha: 0.92, rough: 0.3, slip: 0 });
    P.wash(x, P.ellipse(m - 9, base - 92, 1.8, 3.2, 8), { color: '#8b5f48', alpha: 0.8, rough: 0.1, slip: 0 }); // ear
    // rims
    P.ink(x, [[m - 16, base - 72], [m - 20, base - 58], [m - 21, base - 30]], { w: 1.3, alpha: 0.55, wobble: 0.3, gaps: 0.1, color: C.rim, mode: 'source-over' });
    P.ink(x, [[m - 8, base - 101], [m - 2, base - 105]], { w: 1.1, alpha: 0.55, wobble: 0.2, color: C.rim, mode: 'source-over' });

    // --- her (left), a little smaller, leaning very slightly toward him
    const f = cx - 14;
    const sariBase = [[f - 30, base + 4], [f + 30, base + 4], [f + 23, base - 22], [f + 18, base - 50], [f + 15, base - 62], [f + 8, base - 68], [f - 8, base - 68], [f - 15, base - 61], [f - 19, base - 48], [f - 24, base - 20]];
    sil(x, sariBase, '#8e4639', { alpha: 0.88, rough: 0.7, gran: 0.3, blotch: 0.4, edge: 0.4 });
    // blouse glimpsed at the right shoulder blade
    P.wash(x, [[f + 3, base - 66], [f + 14, base - 61], [f + 16, base - 50], [f + 6, base - 47]], { color: '#4e5e4c', alpha: 0.75, rough: 0.2, slip: 0 });
    // the pallu: over her left shoulder, falling diagonally across the back
    const pallu = [[f - 9, base - 68], [f + 3, base - 67], [f + 8, base - 46], [f + 22, base - 18], [f + 26, base - 4], [f + 8, base - 2], [f - 6, base - 22], [f - 17, base - 50], [f - 15, base - 61]];
    P.wash(x, pallu, { color: '#a24c3e', alpha: 0.7, rough: 0.4, gran: 0.2, edge: 0.3 });
    P.ink(x, [[f + 3, base - 67], [f + 8, base - 46], [f + 22, base - 18], [f + 26, base - 4]], { w: 1.6, alpha: 0.7, wobble: 0.2, gaps: 0.05, color: '#c99a49', mode: 'source-over' });
    P.wash(x, [[f + 4, base - 40], [f + 18, base - 30], [f + 22, base - 2], [f + 10, base - 2]], { color: '#5e4664', alpha: 0.28, rough: 0.5, soft: 0.6 });
    // pleats spread on the step
    sil(x, [[f - 33, base + 5], [f + 30, base + 5], [f + 26, base - 6], [f - 28, base - 6]], '#8a4136', { alpha: 0.85, rough: 0.4 });
    P.ink(x, [[f - 33, base + 4], [f + 30, base + 4]], { w: 1.2, alpha: 0.55, wobble: 0.3, color: '#c99a49', mode: 'source-over' });
    // neck, head, bun with a few white flowers
    P.wash(x, [[f - 3.5, base - 77], [f + 3.5, base - 77], [f + 4, base - 67], [f - 4, base - 67]], { color: '#8d5e47', alpha: 0.85, rough: 0.2, slip: 0 });
    P.wash(x, P.ellipse(f + 1, base - 85, 8.5, 10, 18), { color: '#272022', alpha: 0.93, rough: 0.3, slip: 0 });
    P.wash(x, P.ellipse(f + 2, base - 76, 6.5, 5.5, 14), { color: '#221c1e', alpha: 0.95, rough: 0.2, slip: 0 });
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.95 + i * 0.22);
      P.wash(x, P.ellipse(f + 2 + Math.cos(a) * 7, base - 76 + Math.sin(a) * 6, 1.5, 1.4, 6), { color: '#f4efe2', alpha: 0.9, rough: 0.05, slip: 0, mode: 'source-over' });
    }
    // her rims (toward the glow: her left, our left)
    P.ink(x, [[f - 15, base - 61], [f - 19, base - 48], [f - 24, base - 20]], { w: 1.3, alpha: 0.55, wobble: 0.3, gaps: 0.1, color: C.rim, mode: 'source-over' });
    P.ink(x, [[f - 7, base - 93], [f - 1, base - 95]], { w: 1.1, alpha: 0.5, wobble: 0.2, color: C.rim, mode: 'source-over' });
    // her hand just touching his arm — the only gesture
    P.wash(x, P.ellipse(f + 21, base - 30, 3.2, 2.4, 10), { color: '#8d5e47', alpha: 0.8, rough: 0.1, slip: 0 });
    P.ink(x, [[f + 18, base - 30], [f + 23, base - 31]], { w: 1, alpha: 0.7, wobble: 0.1, gaps: 0, color: '#c99a49', mode: 'source-over' }); // a glint of bangles
  }

  // ----------------------------------------------------------- build
  SC.build = function () {
    const bg = P.card('bg', 0, 0, W, H);
    paintSky(bg.ctx);
    paintWater(bg.ctx);
    // the far bank is painted on its own sheet so it can be mirrored in the river
    const far = P.card('far', 0, 900, W, 470);
    paintFarBank(far.ctx);
    P.drawCard(bg.ctx, far, 0);
    const near = P.card('near', 0, 1440, W, 480);
    paintNear(near.ctx);
    return { bg, far, near, streaks: SC.streakSprite(), boat: SC.boatSprite() };
  };
})();
