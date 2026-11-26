/*
 * world.js — the place.
 *
 * A viewer stands on the gentle stone steps of a ghat on the Godavari,
 * inside the edge of a riverside pavilion, looking diagonally across the
 * river at the far bank (old wadas, a basalt temple, a chhatri on the steps,
 * the town rising behind). The camera then walks ~1.3 m along the ghat: the
 * pavilion's pier passes close in front of the eye, and the high basalt
 * enclosure wall of a temple precinct, with its corner bell-house, comes into
 * view on the right.
 *
 * Units are metres. Water surface is Y = 0. Scene 1 is u = 0, scene 2 u = 1.
 */
(function () {
  const P = window.P, A = P.A, PAL = A.PAL;
  const W = {};
  P.W_ = W;

  // ------------------------------------------------------------ geometry
  const th = (35 * Math.PI) / 180;
  const DR = [Math.cos(th), 0, Math.sin(th)];   // along the river, upstream
  const DP = [-Math.sin(th), 0, Math.cos(th)];  // across the river, away
  const NDP = DP.map((v) => -v);
  const UP = [0, 1, 0];
  const A0 = [0, 0, 6.6];                        // our water edge, ahead
  const RIVER = 30;
  const F0 = [A0[0] + RIVER * DP[0], 0, A0[2] + RIVER * DP[2]];
  const add = (...v) => [v.reduce((s, p) => s + p[0], 0), v.reduce((s, p) => s + p[1], 0), v.reduce((s, p) => s + p[2], 0)];
  const mul = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
  const bank = (s, sb, Y) => add(F0, mul(DR, s), mul(DP, sb), [0, Y, 0]);
  const ours = (s, back, Y) => add(A0, mul(DR, s), mul(NDP, back), [0, Y, 0]);
  const STEP_RISE = 0.12, STEP_RUN = 0.55, SLOPE = STEP_RISE / STEP_RUN;
  W.geom = { DR, DP, A0, F0, bank, ours };

  // Pier of the pavilion we stand in (frontal, 0.9 m from the eye).
  const PIER = { Z: 0.9, X0: 0.308, w: 0.5 };
  W.pierCenterX = function (u) {
    const C = P.CAM;
    return C.cx + (C.f * (PIER.X0 + PIER.w / 2 - u * C.T)) / PIER.Z;
  };

  // Precinct wall, composed for scene 2: its river end sits at s = SW.
  const SW = 5.3;
  const E = ours(SW, -0.7, 0);

  // ------------------------------------------------------------ sky
  function paintSky() {
    const c = P.card('sky', 0, 0, 1080, 1500);
    const x = c.ctx;
    x.fillStyle = PAL.paper;
    x.fillRect(0, 0, 1080, 1500);
    const R = [[-40, -40], [1120, -40], [1120, 1540], [-40, 1540]];
    P.wash(x, R, {
      grad: [0, 0, 0, 1460, [[0, '#c3d3cf'], [0.3, '#d8ded3'], [0.55, '#e9e3d1'], [0.8, '#f1d8b5'], [1, '#f2cc9c']]],
      alpha: 0.75, rough: 0, blotch: 0.12, gran: 0.05,
    });
    // a warmer glow low on the left, where the morning sun is
    P.wash(x, P.ellipse(120, 1300, 700, 380, 40), { color: '#f2c792', alpha: 0.28, rough: 40, soft: 90, freq: 0.01 });
    // cool, wet-in-wet patches high on the right — kept faint behind type
    P.wash(x, P.ellipse(900, 120, 520, 260, 40), { color: '#a7bec4', alpha: 0.14, rough: 50, soft: 80, freq: 0.01, bloom: 0.15 });
    P.wash(x, P.ellipse(140, 260, 420, 200, 40), { color: '#bcccc6', alpha: 0.12, rough: 50, soft: 90, freq: 0.01 });
    // low band of morning haze/cloud behind the town, grey-violet
    for (let i = 0; i < 5; i++) {
      const cx = 100 + i * 230, cy = 1215 + (i % 2) * 30;
      P.wash(x, P.ellipse(cx, cy, 300, 60, 30), { color: '#b9b4bd', alpha: 0.2, rough: 25, soft: 30, freq: 0.02, layers: 2 });
    }
    P.wash(x, P.ellipse(760, 1150, 380, 46, 30), { color: '#c9bfc0', alpha: 0.16, rough: 20, soft: 28, freq: 0.02 });
    // the lightest zone, where the type sits, lifted gently
    P.wash(x, P.ellipse(500, 640, 560, 560, 40), { color: '#f7f1e6', alpha: 0.22, rough: 30, soft: 120, freq: 0.01, mode: 'source-over' });
    return c;
  }

  // ------------------------------------------------------------ distance
  function paintHills() {
    const c = P.card('hills', -120, 1050, 1320, 400, { inv: [0, 0, 1 / 400] });
    const x = c.ctx;
    const r = P.rng(41);
    // far hills (Nashik's ridges), barely there
    const ridge = (y0, amp, seed) => {
      const pts = [[-120, 1450]];
      for (let X = -120; X <= 1200; X += 20) pts.push([X, y0 - amp * P.fbm(X / 260, 0.5, 3, seed) - 40 * Math.exp(-((X - 860) ** 2) / 40000)]);
      pts.push([1200, 1450]);
      return pts;
    };
    P.wash(x, ridge(1290, 110, 3), { color: '#b4b4c2', alpha: 0.35, rough: 3, soft: 3, blotch: 0.3 });
    P.wash(x, ridge(1330, 70, 7), { color: '#aeb3bb', alpha: 0.3, rough: 2, soft: 2, blotch: 0.3 });
    // the town climbing behind the river: pale blocks, a dome, a spire
    for (let X = -100; X < 1180; X += 26 + r() * 40) {
      const w = 24 + r() * 50, h = 30 + r() * 60;
      const y = 1395;
      P.wash(x, [[X, y], [X + w, y], [X + w, y - h], [X, y - h]], { color: r() < 0.5 ? '#c6bdb7' : '#bfbcc0', alpha: 0.35, rough: 0.6, soft: 0.8, blotch: 0.3 });
    }
    const dome = (cx, by, rr) => {
      P.wash(x, [...P.ellipse(cx, by, rr, rr * 1.1, 20, Math.PI, Math.PI * 2), [cx + rr, by + 30], [cx - rr, by + 30]], { color: '#b3adb4', alpha: 0.4, rough: 0.5, soft: 0.6 });
      P.wash(x, [[cx - 1.5, by - rr * 1.1], [cx + 1.5, by - rr * 1.1], [cx, by - rr * 1.1 - 12]], { color: '#a9a3ad', alpha: 0.5, rough: 0.2 });
    };
    dome(612, 1300, 20);
    // a distant shikhara on the rise
    P.wash(x, [[505, 1330], [535, 1330], [527, 1270], [520, 1258], [513, 1270]], { color: '#a8a1aa', alpha: 0.45, rough: 0.4, soft: 0.5 });
    return c;
  }

  // ------------------------------------------------------------ far bank
  function paintFarBank() {
    // fit 1/Z through representative points of the bank
    const pts = [];
    for (const s of [-4, 10, 25, 40, 55]) for (const sb of [0, 6, 12]) for (const Y of [0, 3, 12]) pts.push(bank(s, sb, Y));
    const inv = P.fitInvZ(pts, 0);
    const c = P.card('far', -260, 940, 1600, 560, { inv });
    const x = c.ctx;
    const r = P.rng(97);

    const frontF = (s, sb, Y = 3) => P.frame(bank(s, sb, Y), DR, UP);
    const sideF = (s, sb, Y = 3) => P.frame(bank(s, sb, Y), DP, UP);
    const house = (s, sb, o) => A.house(x, frontF(s, sb, o.Y0 == null ? 3 : o.Y0), sideF(s, sb, o.Y0 == null ? 3 : o.Y0), o);

    // --- third row: the town behind, hazy (furthest first)
    for (let s = -6; s < 60; s += 4 + r() * 4) {
      const w = 3.5 + r() * 4, h = 6 + r() * 7;
      house(s, 24 + r() * 6, { w, h, d: 6, seed: 300 + s * 7 | 0, haze: 0.72, roof: r() < 0.4 ? 'tile' : 'flat', wall: r() < 0.5 ? PAL.lime : PAL.ochre, skip: 0.4, balcony: null, door: false });
    }
    // a domed Maratha temple a little behind the first row
    {
      const F = frontF(19.5, 15, 3);
      const hz = 0.5;
      const base = F.rect(-2.6, 0, 2.6, 6.2);
      P.ground(x, base, A.haze(PAL.paper, 0.3));
      P.wash(x, base, { color: A.haze(PAL.stoneWarm, hz), alpha: 0.7, rough: 0.4, gran: 0.5 });
      const dpts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, a = Math.PI * (1 - t);
        dpts.push([Math.cos(a) * 2.5 * (1 + 0.1 * Math.sin(Math.PI * t)), 6.2 + Math.sin(a) * 3.1]);
      }
      const dome = F.poly(dpts);
      P.ground(x, dome, A.haze(PAL.paper, 0.3));
      P.wash(x, dome, { grad: [...F(-2.5, 6), ...F(2.5, 6), [[0, A.haze('#c9b49a', hz)], [1, A.haze(PAL.basalt, hz)]]], alpha: 0.75, rough: 0.4, gran: 0.5 });
      P.wash(x, F.poly([[-0.12, 9.2], [0.12, 9.2], [0.03, 10.6], [-0.03, 10.6]]), { color: A.haze(PAL.basaltDark, hz), alpha: 0.8, rough: 0.05 });
    }
    // peepal tree behind the chhatri
    {
      const p = P.project(bank(22, 11, 9));
      A.tree(x, p[0], p[1], 92, { seed: 5, haze: 0.1 });
    }
    // trees between the rows
    {
      let p = P.project(bank(3.5, 12, 9));
      A.tree(x, p[0], p[1], 70, { seed: 19, haze: 0.22 });
      p = P.project(bank(45.5, 13, 8));
      A.tree(x, p[0], p[1], 52, { seed: 23, haze: 0.35 });
    }
    house(15.5, 13, { w: 4, h: 12.5, d: 7, seed: 39, haze: 0.42, wall: PAL.limeWarm, roofRoom: true });
    // haze veil between rows
    P.wash(x, [[-260, 940], [1340, 940], [1340, 1360], [-260, 1360]], { color: '#ebe2d3', alpha: 0.18, rough: 0, mode: 'source-over' });

    // --- second row (setback 12), mid-haze
    house(26.5, 12, { w: 5, h: 8.5, d: 7, seed: 41, haze: 0.38, roof: 'tile', wall: PAL.ochre, balcony: null });
    house(31.5, 12, { w: 4.5, h: 10, d: 7, seed: 43, haze: 0.4, wall: PAL.lime, balcony: null, arches: true });
    house(47, 12, { w: 6, h: 7.5, d: 7, seed: 45, haze: 0.45, roof: 'tile', wall: PAL.limeWarm });
    house(53, 12, { w: 5, h: 9, d: 7, seed: 47, haze: 0.5, wall: PAL.lime });

    // --- first row (setback 6.5, base on the ghat top at Y = 3), far to near
    house(52, 6.5, { w: 5.5, h: 6.5, d: 7, seed: 51, haze: 0.42, wall: PAL.limeWarm, roof: 'tile' });
    house(47.5, 6.5, { w: 4.5, h: 7.5, d: 7, seed: 53, haze: 0.38, wall: PAL.lime });
    // the temple
    {
      const F = frontF(41.8, 7.6, 3);
      A.temple(x, F, { flag: true, haze: 0.04, scale: 1.05 });
    }
    house(30.2, 6.5, { w: 4.6, h: 9.2, d: 8, seed: 61, wall: PAL.ochre, balcony: 1, roof: 'tile', haze: 0.12, bay: 2.3 });
    house(26.2, 6.5, { w: 4.0, h: 7, d: 8, seed: 63, wall: PAL.lime, haze: 0.14, arches: true, shade: true });
    house(22.0, 6.5, { w: 4.2, h: 5.6, d: 8, seed: 65, wall: PAL.limeWarm, haze: 0.12, roof: 'tile', floors: 2 });
    // gap at 17–24: the ghat opens up, tree behind
    house(13.6, 6.5, { w: 3.4, h: 7.2, d: 8, seed: 71, wall: PAL.lime, haze: 0.05, shade: true, roofRoom: true });
    house(9.6, 6.5, { w: 4.0, h: 9.6, d: 8, seed: 73, wall: P.mix(PAL.ochre, PAL.terracotta, 0.2), roof: 'tile', haze: 0.04, arches: true });
    house(6.0, 6.5, { w: 3.6, h: 7.6, d: 8, seed: 75, wall: P.mix(PAL.lime, '#9fb1aa', 0.35), haze: 0.03, shade: true });
    house(-1.5, 6.5, { w: 7.5, h: 11.2, d: 9, seed: 77, wall: PAL.ochre, balcony: 2, roof: 'tile', haze: 0.0, bay: 2.5, floors: 3 });

    // --- the far ghat: steps from water up to Y = 3 over 5.2 m; we see the
    // risers (they face us) as a rhythm of thin bands
    const nSteps = 16;
    const ghatPoly = [];
    for (let s = -8; s <= 62; s += 1) ghatPoly.push(P.project(bank(s, 6.5, 3)));
    for (let s = 62; s >= -8; s -= 1) ghatPoly.push(P.project(bank(s, -0.05, 0)));
    P.ground(x, ghatPoly, PAL.paper, 0.4);
    P.wash(x, ghatPoly, { color: '#a69a8e', alpha: 0.7, rough: 0.5, gran: 0.6, blotch: 0.4 });
    for (let k = 0; k < nSteps; k++) {
      const sb0 = (k / nSteps) * 5.2, Y0 = (k / nSteps) * 3, Y1 = ((k + 1) / nSteps) * 3;
      const riser = [];
      for (let s = -8; s <= 62; s += 2) riser.push(P.project(bank(s, sb0, Y1)));
      for (let s = 62; s >= -8; s -= 2) riser.push(P.project(bank(s, sb0, Y0)));
      // risers in light, the thin tread lines in shadow
      P.wash(x, riser, { color: ['#d2c1a7', '#c2b19c', '#b5a594', '#c9b8a0'][k % 4], alpha: 0.5, rough: 0.3, gran: 0.3, blotch: 0.4 });
      const line = [];
      for (let s = -8; s <= 62; s += 2) line.push(P.project(bank(s, sb0, Y0)));
      P.ink(x, line, { w: 0.8, alpha: 0.42, wobble: 0.3, gaps: 0.12, color: '#4d4447', step: 8 });
    }
    // wet, darker lowest steps and the waterline
    {
      const wet = [];
      for (let s = -8; s <= 62; s += 2) wet.push(P.project(bank(s, 0.8, 0.45)));
      for (let s = 62; s >= -8; s -= 2) wet.push(P.project(bank(s, -0.05, 0)));
      P.wash(x, wet, { color: '#5d665c', alpha: 0.45, rough: 0.6, gran: 0.4 });
    }
    // a landing in the middle of the flight
    {
      const land = [];
      for (let s = 15; s <= 31; s += 1) land.push(P.project(bank(s, 3.2, 1.85)));
      for (let s = 31; s >= 15; s -= 1) land.push(P.project(bank(s, 2.0, 1.85)));
      P.wash(x, land, { color: '#d7c8b0', alpha: 0.45, rough: 0.3 });
    }
    // a sari spread to dry on the steps, faded by the sun
    {
      const cl = [];
      for (let s = 7.0; s <= 9.4; s += 0.4) cl.push(P.project(bank(s, 2.35, 1.42)));
      for (let s = 9.4; s >= 7.0; s -= 0.4) cl.push(P.project(bank(s, 1.75, 1.0)));
      P.wash(x, cl, { color: '#b45a3c', alpha: 0.42, rough: 0.6, gran: 0.2 });
      const b = []; for (let s = 7.0; s <= 9.4; s += 0.4) b.push(P.project(bank(s, 1.8, 1.04)));
      P.ink(x, b, { w: 1.2, alpha: 0.5, wobble: 0.2, color: '#d9a441', mode: 'source-over' });
    }
    // chhatri on the ghat
    A.chhatri(x, frontF(20.5, 2.6, 1.85), { w: 2.3, h: 2.1, haze: 0.04 });
    // shade cast under the wadas onto the ghat top
    {
      const sh = [];
      for (let s = -4; s <= 17; s += 1) sh.push(P.project(bank(s, 6.4, 3)));
      for (let s = 17; s >= -4; s -= 1) sh.push(P.project(bank(s, 5.6, 2.6)));
      P.wash(x, sh, { color: PAL.shadow, alpha: 0.35, rough: 0.8, soft: 1 });
    }
    // people, for scale — very few
    const fig = (s, sb, Y, h, col, seed) => { const p = P.project(bank(s, sb, Y)); A.figure(x, p[0], p[1], h * P.CAM.f / p[2] * 0.9, col, { seed }); };
    fig(11.2, 1.2, 0.7, 1.6, '#efe7d8', 3);
    fig(12.0, 1.0, 0.58, 1.5, '#8e4a3c', 4);
    fig(27.5, 0.5, 0.29, 1.55, '#e8dfcf', 6);
    fig(33.2, 3.0, 1.73, 1.6, PAL.saffron, 7);
    fig(36.5, 4.4, 2.54, 1.6, '#5c6f7c', 8);
    // a handful of small offerings/umbrellas would be the cliché; leave the steps empty
    return c;
  }

  // ------------------------------------------------------------ water
  const WATER_INV = [0, 1 / (P.CAM.f * P.CAM.eye), -P.CAM.yh / (P.CAM.f * P.CAM.eye)];
  function waterPoly() {
    const top = [];
    for (let s = -14; s <= 80; s += 1) {
      const p = P.project(bank(s, -0.05, 0));
      top.push([p[0], p[1] + Math.sin(s * 1.7) * 0.6]);
    }
    return [...top, [top[top.length - 1][0] + 400, 1990], [top[0][0] - 400, 1990]];
  }
  function paintWater() {
    const c = P.card('water', -420, 1400, 1950, 560, { inv: WATER_INV });
    const x = c.ctx;
    const poly = waterPoly();
    P.ground(x, poly, PAL.paper, 0);
    const r0 = P.rng(15);
    P.wash(x, poly, {
      grad: [0, 1430, 0, 1930, [[0, '#c4d0c1'], [0.12, '#a9c0b2'], [0.35, '#7ea294'], [0.7, '#4f7b70'], [1, '#33584f']]],
      alpha: 0.85, rough: 0, blotch: 0.25, gran: 0.08,
    });
    // wet-in-wet: the river is never one colour
    for (let i = 0; i < 9; i++) {
      const cx = -100 + r0() * 1400, cy = 1520 + r0() * 380, rx = 180 + r0() * 360;
      P.wash(x, P.ellipse(cx, cy, rx, rx * 0.16, 30), { color: r0() < 0.5 ? '#2f5d55' : '#88a594', alpha: 0.18, rough: 20, soft: 18, freq: 0.02 });
    }
    // long horizontal glints of sky, and darker swells, painted with the
    // side of the brush. Perspective: thinner and closer together far away.
    const r = P.rng(5);
    for (let i = 0; i < 55; i++) {
      const y = 1460 + Math.pow(r(), 1.4) * 470;
      const k = (y - 1390) / 530;
      const len = 40 + r() * 260 * (0.5 + k);
      const x0 = -300 + r() * 1700;
      const th2 = 1.5 + k * 5;
      const light = r() < 0.5;
      P.wash(x, [[x0, y], [x0 + len, y - len * 0.01], [x0 + len * 0.9, y + th2], [x0 + len * 0.08, y + th2 * 1.1]], {
        color: light ? '#e3e6d8' : '#2f5249', alpha: light ? 0.16 + 0.14 * (1 - k) : 0.1 + 0.1 * k, rough: 1.5 + k * 3, soft: 1.5 + k * 3, freq: 0.05,
        mode: light ? 'source-over' : 'multiply', slip: 0,
      });
    }
    // a moored boat near the far bank
    {
      const p0 = P.project(bank(28.6, -2.2, 0)), p1 = P.project(bank(33.8, -1.7, 0));
      const L = p1[0] - p0[0], hgt = L * 0.11;
      const hull = [[p0[0], p0[1] - hgt * 1.3], [p1[0] + L * 0.05, p1[1] - hgt * 1.6], [p1[0] - L * 0.08, p1[1] + hgt * 0.1], [p0[0] + L * 0.1, p0[1] + hgt * 0.2]];
      P.ground(x, hull, PAL.paper, 0.2);
      P.wash(x, hull, { color: '#6b4a37', alpha: 0.8, rough: 0.4, gran: 0.4, edge: 0.3 });
      P.wash(x, [[p0[0] + 3, p0[1] - hgt * 1.25], [p1[0], p1[1] - hgt * 1.55], [p1[0] - 2, p1[1] - hgt * 1.15], [p0[0] + 4, p0[1] - hgt * 0.9]], { color: '#c79a62', alpha: 0.6, rough: 0.2 });
      P.wash(x, [[p0[0] + L * 0.05, p0[1] + hgt * 0.3], [p1[0] - L * 0.05, p1[1] + hgt * 0.2], [p1[0] - L * 0.1, p1[1] + hgt * 1.6], [p0[0] + L * 0.1, p0[1] + hgt * 1.7]], { color: '#2e3f3a', alpha: 0.35, rough: 1, soft: 1.5 });
      P.ink(x, [[p0[0] + L * 0.3, p0[1] - hgt * 1.4], [p0[0] + L * 0.1, p0[1] - hgt * 6]], { w: 0.7, alpha: 0.45, wobble: 0.2 });
    }
    // the shadowed strip where the water meets our steps
    return c;
  }

  // reflection of the far bank: flipped about its waterline, softened and
  // tinted by the water. The ripple displacement is applied per frame.
  function paintReflection(far) {
    const c = P.card('refl', far.bx, 1380, far.bw, 420, { inv: far.inv });
    const x = c.ctx;
    const pa = P.project(bank(0, 0, 0)), pb = P.project(bank(50, 0, 0));
    const m = (pb[1] - pa[1]) / (pb[0] - pa[0]);
    const y0 = pa[1] - m * pa[0] - 6;
    x.save();
    x.transform(1, 2 * m, 0, -1, 0, 2 * y0);
    x.filter = `blur(${1.0 * P.SCALE}px)`;
    // smeared downward a little, as reflections in moving water are
    for (let i = 0; i < 6; i++) {
      x.globalAlpha = i ? 0.22 : 1;
      x.drawImage(far.canvas, far.bx, far.by - i * 2.2, far.bw, far.bh);
    }
    x.restore();
    // tint and fade with distance from the bank
    x.save();
    x.globalCompositeOperation = 'source-atop';
    const g = x.createLinearGradient(0, 1440, 0, 1760);
    g.addColorStop(0, 'rgba(62,98,88,0.25)');
    g.addColorStop(1, 'rgba(48,84,74,0.6)');
    x.fillStyle = g;
    x.fillRect(far.bx, 1380, far.bw, 420);
    x.globalCompositeOperation = 'destination-in';
    const f = x.createLinearGradient(0, 1440, 0, 1780);
    f.addColorStop(0, 'rgba(0,0,0,0.95)');
    f.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    f.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = f;
    x.fillRect(far.bx, 1380, far.bw, 420);
    x.restore();
    return c;
  }

  // ------------------------------------------------------------ our steps
  function paintSteps() {
    const pts = [];
    for (const s of [-6, 2, 10]) for (const b of [0, 2, 4]) pts.push(ours(s, b, b * SLOPE));
    const inv = P.fitInvZ(pts, 0);
    const c = P.card('steps', -300, 1560, 2300, 400, { inv });
    const x = c.ctx;
    const r = P.rng(23);
    const S0 = -7, S1 = 16, ZN = 2.4;
    const strip = (b0, Y0, b1, Y1, ds = 0.5) => {
      const p3 = [];
      for (let s = S0; s <= S1; s += ds) p3.push(ours(s, b0, Y0));
      for (let s = S1; s >= S0; s -= ds) p3.push(ours(s, b1, Y1));
      return P.projPoly(p3, 0, ZN);
    };
    const line = (b, Y, ds = 0.5) => {
      const out = [];
      for (let s = S0; s <= S1; s += ds) { const w = ours(s, b, Y); if (w[2] >= ZN) out.push(P.project(w)); }
      return out;
    };
    const NS = 8;
    for (let k = NS - 1; k >= 0; k--) {
      const Y = (k + 1) * STEP_RISE, b0 = k * STEP_RUN, b1 = (k + 1) * STEP_RUN;
      const poly = strip(b0, Y, b1, Y);
      if (poly.length < 3) continue;
      P.ground(x, poly, PAL.paper, 0.3, k);
      const wet = k < 2;
      const col = wet ? (k === 0 ? '#5d6559' : '#7d7d70') : ['#b9ab96', '#b0a28f', '#bdae98'][k % 3];
      P.wash(x, poly, { color: col, alpha: 0.78, rough: 0.6, gran: 0.35, blotch: 0.5, edge: 0.2 });
      // ambient shade at the back of each tread, under the next step up
      P.wash(x, strip(b0 + STEP_RUN * 0.62, Y, b1, Y), { color: PAL.shadow, alpha: wet ? 0.18 : 0.3, rough: 0.8, soft: 1.5 });
      // the nose: a dark, broken line where the step drops away
      P.ink(x, line(b0 + 0.02, Y), { w: 1.0 + k * 0.12, alpha: 0.5, wobble: 0.6, gaps: 0.08, color: '#3a3335', step: 6 });
      // a thin lit lip on the nose
      P.ink(x, line(b0 + 0.05, Y), { w: 0.8 + k * 0.08, alpha: 0.35, wobble: 0.5, gaps: 0.2, color: '#efe2c9', step: 7, mode: 'source-over' });
      // stone joints, staggered, running toward the river
      let s = S0 + r() * 1.2;
      while (s < S1) {
        const a3 = ours(s, b0 + 0.03, Y), b3 = ours(s + 0.05, b1, Y);
        if (a3[2] > ZN && b3[2] > ZN) P.ink(x, [P.project(a3), P.project(b3)], { w: 0.8, alpha: 0.32, wobble: 0.3, gaps: 0.1, color: '#463d3e' });
        s += 0.9 + r() * 1.1;
      }
      // worn, sun-polished patches and small chips
      for (let i = 0; i < 9; i++) {
        const ss = S0 + 4 + r() * (S1 - S0 - 4), bb = b0 + 0.08 + r() * 0.4;
        const w3 = ours(ss, bb, Y);
        if (w3[2] < ZN + 0.3) continue;
        const p = P.project(w3), sc = P.CAM.f / w3[2];
        P.dry(x, p[0] - sc * 0.3, p[1], sc * (0.3 + r() * 0.5), -0.27, { n: 3, w: sc * 0.05, color: r() < 0.5 ? '#efe3cc' : '#5b5254', alpha: 0.3, lw: 0.8, mode: r() < 0.5 ? 'source-over' : 'multiply' });
      }
    }
    // algae and moss where stone meets water; the water darkens the lowest edge
    P.wash(x, strip(-0.05, 0.0, 0.4, 0.1), { color: '#46523f', alpha: 0.6, rough: 1.4, gran: 0.4, soft: 0.8 });
    // the shadow of the pavilion we stand in falls across the nearest steps
    const sh = [];
    for (const [s, b] of [[1.2, 0.0], [3.6, 0.0], [9, 3.2], [9, 6], [1.2, 6]]) sh.push(ours(s, b, b * SLOPE + 0.12));
    P.wash(x, P.projPoly(sh, 0, ZN), { color: '#6b6c86', alpha: 0.32, rough: 2, soft: 5 });
    return c;
  }

  // ------------------------------------------------------------ precinct wall (scene 2)
  /*
   * The river face of a temple precinct: a high wall of dressed basalt in
   * courses, a string course, a cornice, and — at the corner over the water
   * — a small domed bell-house (Naroshankar's precinct is the reference: its
   * enclosure has corner pavilions and the famous bell hangs in one). We
   * look along the wall: it recedes from the right edge toward the river.
   */
  function paintWall() {
    const F = P.frame(E, NDP, UP, 1); // (t, h): t metres back from the river end
    const K = (t, q, h) => add(E, mul(NDP, t), mul(DR, q), [0, h, 0]);
    const pts = [F.w(0, 0), F.w(0, 11), F.w(6, 0), F.w(6, 11), F.w(3, 5)];
    const inv = P.fitInvZ(pts, 1);
    const c = P.card('wall', 640, 120, 1100, 1840, { uA: 1, inv });
    const x = c.ctx;
    const r = P.rng(131);
    const T1 = 9;
    const baseH = (t) => (t < 0.7 ? 0 : (t - 0.7) * SLOPE);
    const stone = '#9d8c7f', stoneLit = '#c4b19b', dark = PAL.basaltDark, deep = PAL.basaltDeep;
    const proj = (p3) => P.project(p3, 1);
    const HW = 7.0; // wall top

    // silhouette and body
    const sil = [];
    for (let t = 0; t <= T1; t += 0.25) sil.push(F(t, baseH(t)));
    sil.push(F(T1, HW), F(0, HW));
    P.ground(x, sil, PAL.paper, 0.3);
    P.wash(x, sil, { grad: [...F(2, HW), ...F(2, 0), [[0, stoneLit], [0.5, stone], [1, '#6f695f']]], alpha: 0.82, rough: 0.4, gran: 0.3, blotch: 0.55, edge: 0.25 });
    // the face turns slightly from the sun as it comes toward us
    P.wash(x, F.poly([[2.5, 0], [T1, 0], [T1, HW], [2.5, HW]]), { grad: [...F(2.5, 3), ...F(T1, 3), [[0, 'rgba(110,108,140,0)'], [1, '#6e6c8c']]], alpha: 0.35, rough: 0.5 });
    // courses and joints
    for (let h = 0.42; h < HW - 0.1; h += 0.42) {
      if (h > 3.45 && h < 4.0) continue;
      const ln = [];
      for (let t = 0; t <= T1; t += 0.3) if (h > baseH(t) + 0.05) ln.push(F(t, h));
      if (ln.length > 1) P.ink(x, ln, { w: 0.85, alpha: 0.26, wobble: 0.45, gaps: 0.14, color: '#4a4044', step: 6 });
      let t = r() * 1.2;
      while (t < T1) {
        if (h - 0.42 > baseH(t) - 0.1) P.ink(x, [F(t, h - 0.42), F(t, h)], { w: 0.75, alpha: 0.24, wobble: 0.2, color: '#4a4044' });
        t += 0.8 + r() * 0.9;
      }
    }
    // individual stones: value shifts, a few lighter replacements
    for (let i = 0; i < 80; i++) {
      const t = r() * T1, hh = Math.floor(r() * 16) * 0.42 + 0.02;
      if (hh < baseH(t) || (hh > 3.4 && hh < 4.0) || hh > HW - 0.5) continue;
      const L = 0.7 + r() * 0.9;
      const light = r() < 0.3;
      P.wash(x, F.rect(t, hh, t + L, hh + 0.38), { color: light ? '#dccab2' : '#85776f', alpha: light ? 0.25 : 0.18, rough: 0.4, gran: 0.3, blotch: 0.4, mode: light ? 'source-over' : 'multiply' });
    }
    // plinth mouldings at the foot
    for (const [h0, h1, col, a] of [[0.9, 1.15, dark, 0.45], [1.35, 1.5, '#d5c3aa', 0.5]]) {
      const band = [];
      for (let t = 0; t <= T1; t += 0.5) band.push(F(t, Math.max(h0, baseH(t))));
      for (let t = T1; t >= 0; t -= 0.5) band.push(F(t, Math.max(h1, baseH(t))));
      P.wash(x, band, { color: col, alpha: a, rough: 0.3, gran: 0.3 });
    }
    // string course and its shadow
    P.wash(x, F.poly([[0, 3.62], [T1, 3.62], [T1, 3.92], [0, 3.92]]), { color: stoneLit, alpha: 0.65, rough: 0.3, gran: 0.25, mode: 'source-over' });
    P.wash(x, F.poly([[0, 3.2], [T1, 3.2], [T1, 3.62], [0, 3.62]]), { color: PAL.shadowDeep, alpha: 0.42, rough: 0.6, soft: 2 });
    P.ink(x, [F(0, 3.62), F(T1, 3.62)], { w: 1, alpha: 0.5, wobble: 0.3, gaps: 0.05 });
    // three shallow cusped niches
    for (const t0 of [1.35, 3.6, 5.85]) {
      const w = 1.0, b = 4.35, hN = 1.6;
      const arch = [[t0, b], [t0 + w, b], [t0 + w, b + hN * 0.6]];
      for (let i = 1; i < 14; i++) {
        const a = Math.PI * (i / 14);
        const cusp = 1 + 0.1 * Math.abs(Math.sin(a * 3));
        arch.push([t0 + w / 2 + (Math.cos(a) * w * cusp) / 2, b + hN * 0.6 + Math.sin(a) * w * 0.6 * cusp]);
      }
      arch.push([t0, b + hN * 0.6]);
      P.wash(x, F.poly(arch), { color: '#6d6266', alpha: 0.42, rough: 0.3, gran: 0.25, edge: 0.3 });
      P.wash(x, F.poly([[t0, b], [t0 + w * 0.2, b], [t0 + w * 0.2, b + hN * 0.62], [t0, b + hN * 0.6]]), { color: deep, alpha: 0.35, rough: 0.2 });
      P.wash(x, F.rect(t0 - 0.12, b - 0.14, t0 + w + 0.12, b), { color: '#dccab2', alpha: 0.55, rough: 0.2, mode: 'source-over' });
      P.ink(x, arch.slice(2).map(([a, bb]) => F(a, bb)), { w: 0.8, alpha: 0.35, wobble: 0.2, gaps: 0.06 });
    }
    // cornice with a row of dentils, then a low parapet
    P.wash(x, F.poly([[-0.2, 6.35], [T1, 6.35], [T1, 6.7], [-0.2, 6.7]]), { color: stoneLit, alpha: 0.7, rough: 0.3, gran: 0.25, mode: 'source-over' });
    P.wash(x, F.poly([[0, 5.85], [T1, 5.85], [T1, 6.35], [0, 6.35]]), { color: PAL.shadowDeep, alpha: 0.38, rough: 0.5, soft: 2 });
    for (let t = 0.1; t < T1; t += 0.24) P.wash(x, F.rect(t, 6.16, t + 0.1, 6.35), { color: dark, alpha: 0.45, rough: 0.05 });
    P.ink(x, [F(-0.2, 6.7), F(T1, 6.7)], { w: 1, alpha: 0.45, wobble: 0.3 });
    // weathering: rain streaks under the cornice and string course
    for (let i = 0; i < 14; i++) {
      const t = 0.3 + r() * (T1 - 0.3), L = 0.8 + r() * 2.0, from = r() < 0.6 ? 5.85 : 3.2;
      P.wash(x, F.poly([[t, from], [t + 0.25 + r() * 0.3, from], [t + 0.2, from - L], [t + 0.05, from - L * 0.9]]), {
        grad: [...F(t, from), ...F(t, from - L), [[0, '#3d3537'], [1, 'rgba(255,255,255,0)']]], alpha: 0.3, rough: 0.6, soft: 1.5,
      });
    }
    // lichen and moss near the foot; water stain at the river end
    for (let i = 0; i < 22; i++) {
      const t = r() * 6, h = baseH(t) + r() * 2.0;
      const p = F(t, h), sc = F.scale(t, h);
      P.dab(x, p[0], p[1], sc * (0.05 + r() * 0.1), r() < 0.5 ? PAL.lichen : PAL.moss, 0.3, 0.4);
    }
    const stain = [];
    for (let t = 0; t <= 2.2; t += 0.25) stain.push(F(t, baseH(t)));
    for (let t = 2.2; t >= 0; t -= 0.25) stain.push(F(t, 0.6 + baseH(t) * 0.4));
    P.wash(x, stain, { color: '#3e4a3c', alpha: 0.4, rough: 0.8, soft: 1.5, gran: 0.3 });
    P.ink(x, [F(0, 0.1), F(0, HW)], { w: 1.1, alpha: 0.4, wobble: 0.3, gaps: 0.06 });

    // ---- the corner bell-house: two visible faces and a dome
    const K0 = 0, K1 = 2.3, Q1 = 2.3, hb = HW, hp = hb + 0.4, he = hp + 1.95;
    const FA = F; // face along the wall (t, h)
    const FB = P.frame(K(K1, 0, 0), DR, UP, 1); // face toward us (q, h)
    const faceA = FA.poly([[K0, hb], [K1, hb], [K1, he], [K0, he]]);
    const faceB = FB.poly([[0, hb], [Q1, hb], [Q1, he], [0, he]]);
    P.ground(x, faceB, PAL.paper); P.ground(x, faceA, PAL.paper);
    // face B is turned away from the sun: cooler, darker
    P.wash(x, faceB, { color: '#7b7076', alpha: 0.8, rough: 0.3, gran: 0.3, blotch: 0.4, edge: 0.3 });
    P.wash(x, faceA, { color: stone, alpha: 0.78, rough: 0.3, gran: 0.3, blotch: 0.4, edge: 0.3 });
    // plinth band
    P.wash(x, FA.poly([[K0 - 0.08, hb], [K1, hb], [K1, hp], [K0 - 0.08, hp]]), { color: stoneLit, alpha: 0.6, rough: 0.2, mode: 'source-over' });
    P.wash(x, FB.poly([[0, hb], [Q1, hb], [Q1, hp], [0, hp]]), { color: '#968a86', alpha: 0.5, rough: 0.2 });
    const cuspArch = (Fr, a0, a1, b0, hs, rise) => {
      const pts = [[a0, b0], [a1, b0], [a1, b0 + hs]];
      for (let i = 1; i < 16; i++) {
        const a = Math.PI * (i / 16);
        const cusp = 1 + 0.1 * Math.abs(Math.sin(a * 4));
        pts.push([(a0 + a1) / 2 + (Math.cos(a) * (a1 - a0) * cusp) / 2, b0 + hs + Math.sin(a) * rise * cusp]);
      }
      pts.push([a0, b0 + hs]);
      return pts;
    };
    // face A opening, the bell within
    const oa = cuspArch(FA, K0 + 0.36, K1 - 0.36, hp, 1.05, 0.55);
    P.wash(x, FA.poly(oa), { grad: [...FA(0, hp), ...FA(0, hp + 1.6), [[0, '#4a4246'], [1, '#2c272d']]], alpha: 0.9, rough: 0.15, gran: 0.25 });
    // light through the far opening behind
    P.wash(x, FA.poly([[K0 + 0.95, hp + 0.05], [K1 - 0.7, hp + 0.05], [K1 - 0.7, hp + 1.05], [K0 + 0.95, hp + 1.05]]), { color: '#d9c7a8', alpha: 0.32, rough: 0.2, soft: 1, mode: 'source-over' });
    P.wash(x, FA.poly([[K0 + 0.36, hp], [K0 + 0.52, hp], [K0 + 0.52, hp + 1.15], [K0 + 0.36, hp + 1.1]]), { color: deep, alpha: 0.4, rough: 0.1 });
    P.ink(x, oa.slice(2).map(([a, b]) => FA(a, b)), { w: 0.9, alpha: 0.4, wobble: 0.15 });
    {
      const bc = (K0 + K1) / 2, bt = hp + 1.45;
      P.ink(x, [FA(bc, hp + 1.62), FA(bc, bt)], { w: 1.1, alpha: 0.7, wobble: 0.05, gaps: 0 });
      const bell = [[bc - 0.07, bt]];
      for (let i = 0; i <= 10; i++) { const k = i / 10; bell.push([bc + 0.07 + 0.22 * Math.pow(k, 0.8), bt - 0.5 * k]); }
      bell.push([bc + 0.31, bt - 0.56], [bc - 0.31, bt - 0.56]);
      for (let i = 10; i >= 0; i--) { const k = i / 10; bell.push([bc - 0.07 - 0.22 * Math.pow(k, 0.8), bt - 0.5 * k]); }
      P.wash(x, FA.poly(bell), { color: '#5b4a33', alpha: 0.92, rough: 0.1, gran: 0.2 });
      P.wash(x, FA.poly([[bc - 0.16, bt - 0.1], [bc - 0.1, bt - 0.1], [bc - 0.19, bt - 0.5], [bc - 0.26, bt - 0.5]]), { color: '#c59f5f', alpha: 0.55, rough: 0.05, mode: 'source-over' });
    }
    // face B opening (foreshortened)
    const ob = cuspArch(FB, 0.4, Q1 - 0.4, hp, 1.05, 0.55);
    P.wash(x, FB.poly(ob), { color: '#2f2a30', alpha: 0.85, rough: 0.15, gran: 0.2 });
    // the corner where the faces meet: a lit arris
    P.ink(x, [FA(K1, hb), FA(K1, he)], { w: 1, alpha: 0.35, wobble: 0.15, color: '#efe0c6', mode: 'source-over' });
    P.ink(x, [FA(K0, hb), FA(K0, he)], { w: 1, alpha: 0.4, wobble: 0.15 });
    // chhajja on both faces, deep shadow beneath
    const ov = 0.22;
    const chA = [proj(K(K0 - ov, -ov, he)), proj(K(K1 + ov, -ov, he)), proj(K(K1 + ov, -ov, he + 0.22)), proj(K(K0 - ov, -ov, he + 0.22))];
    const chB = [proj(K(K1 + ov, -ov, he)), proj(K(K1 + ov, Q1 + ov, he)), proj(K(K1 + ov, Q1 + ov, he + 0.22)), proj(K(K1 + ov, -ov, he + 0.22))];
    const under = [proj(K(K0 - ov, -ov, he)), proj(K(K1 + ov, -ov, he)), proj(K(K1 + ov, Q1 + ov, he)), proj(K(K1, Q1, he)), proj(K(K1, 0, he)), proj(K(K0, 0, he))];
    P.ground(x, under, PAL.paper);
    P.wash(x, under, { color: '#3a3338', alpha: 0.85, rough: 0.2 });
    for (const ch of [chB, chA]) { P.ground(x, ch, PAL.paper); P.wash(x, ch, { color: ch === chA ? '#9a8c84' : '#7c7177', alpha: 0.85, rough: 0.3, gran: 0.25, edge: 0.3 }); }
    P.wash(x, FA.poly([[K0, he - 0.4], [K1, he - 0.4], [K1, he], [K0, he]]), { color: PAL.shadowDeep, alpha: 0.35, rough: 0.3, soft: 1.5 });
    // dome on an octagonal drum, seen from below
    {
      const ctr = K((K0 + K1) / 2, Q1 / 2, he + 0.22);
      const c0 = proj(ctr), sc = P.CAM.f / ctr[2];
      const R = 1.05 * sc, Hd = 1.25 * sc, drum = 0.28 * sc;
      // drum
      const dr = [[c0[0] - R * 1.02, c0[1]], [c0[0] + R * 1.02, c0[1]], [c0[0] + R, c0[1] - drum], [c0[0] - R, c0[1] - drum]];
      P.ground(x, dr, PAL.paper);
      P.wash(x, dr, { grad: [c0[0] - R, 0, c0[0] + R, 0, [[0, stoneLit], [0.55, stone], [1, '#5e5458']]], alpha: 0.8, rough: 0.2, gran: 0.3 });
      // bulb
      const db = c0[1] - drum, bulb = [];
      for (let i = 0; i <= 32; i++) {
        const k = i / 32, a = Math.PI * k;
        const prof = Math.sin(a) * (1 + 0.16 * Math.sin(a) ** 2) - 0.12 * Math.sin(a * 2) ** 2;
        bulb.push([c0[0] - Math.cos(a) * R * (1 + 0.08 * Math.sin(a)), db - prof * Hd * 0.62 - (k > 0.35 && k < 0.65 ? 0 : 0)]);
      }
      // taper to a point
      const top = [c0[0], db - Hd];
      const left = bulb.slice(0, 13), right = bulb.slice(20);
      const dome = [...left, [c0[0] - R * 0.22, db - Hd * 0.86], top, [c0[0] + R * 0.22, db - Hd * 0.86], ...right];
      P.ground(x, dome, PAL.paper);
      P.wash(x, dome, { grad: [c0[0] - R, 0, c0[0] + R, 0, [[0, '#cbb8a0'], [0.45, stone], [0.8, '#5f5559'], [1, '#4a4248']]], alpha: 0.85, rough: 0.25, gran: 0.35, edge: 0.3 });
      for (let k = -2; k <= 2; k++) {
        const xx = c0[0] + k * R * 0.36;
        P.ink(x, [[xx, db - 2], [c0[0] + k * R * 0.12, db - Hd * 0.8]], { w: 0.6, alpha: 0.25, wobble: 0.3 });
      }
      // finial: lotus and kalash
      P.wash(x, P.ellipse(top[0], top[1] - 0.08 * sc, 0.16 * sc, 0.08 * sc, 14), { color: dark, alpha: 0.85, rough: 0.05 });
      P.wash(x, [[top[0] - 0.05 * sc, top[1] - 0.12 * sc], [top[0] + 0.05 * sc, top[1] - 0.12 * sc], [top[0] + 0.015 * sc, top[1] - 0.6 * sc], [top[0] - 0.015 * sc, top[1] - 0.6 * sc]], { color: dark, alpha: 0.85, rough: 0.05 });
      P.wash(x, P.ellipse(top[0], top[1] - 0.36 * sc, 0.09 * sc, 0.09 * sc, 12), { color: P.mix(dark, PAL.ochreDeep, 0.4), alpha: 0.85, rough: 0.05 });
      P.ink(x, dome.slice(0, 14), { w: 0.9, alpha: 0.4, wobble: 0.3, gaps: 0.1 });
    }
    return c;
  }

  // ------------------------------------------------------------ pier (foreground)
  function paintPier() {
    const inv = [0, 0, 1 / PIER.Z];
    const c = P.card('pier', 880, -20, 760, 1960, { inv });
    const x = c.ctx;
    const r = P.rng(211);
    const F = P.frame([PIER.X0, 0, PIER.Z], [1, 0, 0], UP);
    const w = PIER.w, ch = 0.035;
    const Y0 = 2.0, Y1 = 3.95;
    const body = F.rect(0, Y0, w, Y1);
    P.ground(x, body, '#cbbca6', 0.6);
    // the chamfer on the left catches a little light; the face is in shade
    P.wash(x, F.rect(0, Y0, ch, Y1), { grad: [...F(0, Y1), ...F(0, Y0), [[0, '#8d7f76'], [1, '#a8927c']]], alpha: 0.8, rough: 0.8, gran: 0.3, blotch: 0.5 });
    P.wash(x, F.rect(ch, Y0, w, Y1), { grad: [...F(ch, 0), ...F(w, 0), [[0, '#5a5156'], [0.25, '#4a4248'], [1, '#3b353c']]], alpha: 0.92, rough: 0.8, gran: 0.25, blotch: 0.18 });
    // warm light bounced up from the sunlit steps
    P.wash(x, F.rect(ch, Y0, w * 0.8, 2.75), { grad: [...F(0, Y0), ...F(0, 2.75), [[0, 'rgba(160,128,96,0.9)'], [1, 'rgba(160,128,96,0)']]], alpha: 0.4, rough: 2, soft: 10, mode: 'source-over' });
    // carved band: a course of lotus petals between two fillets
    // a moulded band: a lit fillet, a rounded torus in half-light, a shadowed fillet
    const b0 = 3.12, b1 = 3.2;
    P.wash(x, F.rect(0, b0 - 0.03, w, b0), { color: '#221e24', alpha: 0.45, rough: 0.8, soft: 2 });
    P.wash(x, F.rect(0, b0, w, b1), { grad: [...F(0, b0), ...F(0, b1), [[0, '#3e373d'], [0.6, '#5d5357'], [1, '#6f6460']]], alpha: 0.7, rough: 0.8, gran: 0.3 });
    P.wash(x, F.rect(0, b0, ch, b1), { color: '#a08d7b', alpha: 0.6, rough: 0.6, mode: 'source-over' });
    P.wash(x, F.rect(0, b1, w, b1 + 0.02), { color: '#857668', alpha: 0.45, rough: 0.6 });
    P.ink(x, [F(0, b1), F(w, b1)], { w: 1.2, alpha: 0.3, wobble: 0.8, color: '#1e1a1f' });
    // capital: the shaft steps out near the top, its underside in deep shade
    P.wash(x, F.rect(-0.03, 3.6, w + 0.03, 3.95), { color: '#4b4349', alpha: 0.85, rough: 0.8, gran: 0.25, blotch: 0.15 });
    P.wash(x, F.rect(-0.03, 3.6, ch, 3.95), { color: '#9f8f82', alpha: 0.55, rough: 0.8, mode: 'source-over' });
    P.wash(x, F.rect(-0.03, 3.555, w + 0.03, 3.605), { color: '#1f1b20', alpha: 0.55, rough: 0.8, soft: 2 });
    // tooled surface: long faint chisel drags, a few pits, one hairline crack
    for (let i = 0; i < 70; i++) {
      const a = ch + r() * (w - ch), yy = Y0 + r() * (Y1 - Y0);
      const p = F(a, yy);
      P.dry(x, p[0], p[1], 40 + r() * 120, Math.PI / 2 + (r() - 0.5) * 0.15, { n: 3, w: 8, color: '#231f24', alpha: 0.12, lw: 1.4 });
    }
    for (let i = 0; i < 40; i++) {
      const p = F(r() * w, Y0 + r() * (Y1 - Y0));
      P.dab(x, p[0], p[1], 2 + r() * 4, r() < 0.7 ? '#2b262b' : '#8c7a6a', 0.15, 0.4);
    }
    P.ink(x, [F(0.24, 2.0), F(0.25, 2.3), F(0.23, 2.5), F(0.26, 2.66)], { w: 1.3, alpha: 0.4, wobble: 2, color: '#1c181d' });
    P.ink(x, [F(ch, Y0), F(ch, Y1)], { w: 1.4, alpha: 0.3, wobble: 1, gaps: 0.04, color: '#2a252a' });
    return c;
  }

  // ------------------------------------------------------------ grass at a step joint
  W.tuft = function (ctx, u, t) {
    // a small tuft growing from a crack in our steps; anchored to the step
    // plane, it sways by a pixel or two
    const root = ours(2.6, 1.05 * STEP_RUN * 3 + 0.05, 4 * STEP_RISE);
    const p0 = P.project(root, u);
    const sc = P.CAM.f / root[2];
    const blades = W._tuftBlades || (W._tuftBlades = (() => {
      const r = P.rng(9), out = [];
      for (let i = 0; i < 9; i++) out.push({ ang: -Math.PI / 2 + (r() - 0.5) * 1.1, len: 0.06 + r() * 0.08, ph: r() * 6, c: r() < 0.5 ? '#6d7a45' : '#8a9354' });
      return out;
    })());
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'round';
    for (const b of blades) {
      const sway = 0.04 * Math.sin(t * 0.9 + b.ph) + 0.03 * Math.sin(t * 0.37 + b.ph * 2);
      const a = b.ang + sway;
      const L = b.len * sc;
      const ex = p0[0] + Math.cos(a) * L, ey = p0[1] + Math.sin(a) * L;
      const mx = p0[0] + Math.cos(b.ang) * L * 0.5, my = p0[1] + Math.sin(b.ang) * L * 0.5;
      ctx.strokeStyle = b.c;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
    }
    ctx.restore();
  };

  // ------------------------------------------------------------ build
  W.build = function () {
    const cards = {};
    cards.sky = paintSky();
    cards.hills = paintHills();
    cards.water = paintWater();
    cards.far = paintFarBank();
    cards.refl = paintReflection(cards.far);
    cards.steps = paintSteps();
    cards.wall = paintWall();
    cards.pier = paintPier();
    W.cards = cards;
    return cards;
  };
})();
