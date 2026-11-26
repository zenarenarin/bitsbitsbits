/*
 * architecture.js — painters for the architectural vocabulary of the
 * Godavari riverfront at Panchavati: lime-plastered wadas with timber
 * balconies and clay-tile roofs, black basalt (Deccan trap) temples with
 * curvilinear shikharas, small domed chhatris on the ghat, and the high
 * basalt enclosure walls of the Maratha-period precincts with their corner
 * pavilions (the Naroshankar bell-house among them).
 *
 * Every painter draws through a P.frame, i.e. in metres on a real plane, so
 * perspective, scale and the later camera move all stay consistent.
 */
(function () {
  const P = window.P;
  const A = (P.A = {});

  const PAL = (A.PAL = {
    paper: '#f2ebdd',
    lime: '#eadfc6',
    limeWarm: '#e4cfa6',
    ochre: '#d6ae78',
    ochreDeep: '#b98a55',
    sand: '#cdb08a',
    basalt: '#857b78',
    basaltDark: '#4d4547',
    basaltDeep: '#36303a',
    stoneWarm: '#a89784',
    terracotta: '#b06a4b',
    tileDark: '#8a4f3a',
    wood: '#6e4c37',
    woodDark: '#45342c',
    shadow: '#7d7f9c',
    shadowDeep: '#55577a',
    window: '#3b3236',
    water: '#46736a',
    waterDeep: '#2d504c',
    jade: '#83a898',
    waterPale: '#c2d2c3',
    leaf: '#717b4b',
    leafDark: '#44503a',
    leafLight: '#a3a868',
    moss: '#6f7643',
    lichen: '#b9a35e',
    saffron: '#d68a33',
    ink: '#2e2a28',
    skyLow: '#f0dcc0',
  });

  // -------------------------------------------------------------- utilities
  A.haze = function (col, t) { return P.mix(col, '#e9e1d2', t); };

  // A small window: dark opening, a lighter frame, sometimes shutters or an
  // arched head. (a, b) is the lower-left corner in the facade frame.
  A.window = function (ctx, F, a, b, w, h, o = {}) {
    const r = P.rng(o.seed || 1);
    const arch = o.arch;
    const pts = [];
    if (arch) {
      pts.push([a, b], [a + w, b], [a + w, b + h - w / 2]);
      for (let i = 1; i < 10; i++) {
        const t = Math.PI * (i / 10);
        pts.push([a + w / 2 + (Math.cos(t) * w) / 2, b + h - w / 2 + (Math.sin(t) * w) / 2]);
      }
      pts.push([a, b + h - w / 2]);
    } else pts.push([a, b], [a + w, b], [a + w, b + h], [a, b + h]);
    const poly = F.poly(pts);
    P.wash(ctx, poly, { color: o.dark || PAL.window, alpha: o.alpha || 0.8, rough: 0.35, gran: 0.25, edge: 0.3 });
    if (o.shutter) {
      // one leaf half open, painted in a faded blue-green or timber
      const col = o.shutter;
      P.wash(ctx, F.rect(a - w * 0.42, b, a - 0.02, b + h * (arch ? 0.85 : 1)), { color: col, alpha: 0.55, rough: 0.3, gran: 0.3 });
    }
    // sill and a slight lintel shadow
    P.wash(ctx, F.rect(a - 0.08, b - 0.1, a + w + 0.08, b), { color: PAL.limeWarm, alpha: 0.5, rough: 0.2 });
    P.wash(ctx, F.rect(a - 0.05, b + h, a + w + 0.15, b + h + 0.12), { color: PAL.shadow, alpha: 0.35, rough: 0.2, soft: 0.6 });
    if (o.bars && w * F.scale(a, b) > 5) {
      for (let i = 1; i < 4; i++) {
        const x = a + (w * i) / 4;
        P.ink(ctx, [F(x, b + 0.05), F(x, b + h * 0.9)], { w: 0.5, alpha: 0.25, wobble: 0.15, color: PAL.limeWarm, mode: 'source-over' });
      }
    }
    if (r() < 0.5) P.ink(ctx, [F(a, b), F(a, b + h)], { w: 0.6, alpha: 0.35, wobble: 0.2 });
  };

  // Plaster stains: rain streaks from parapets and sills.
  A.stains = function (ctx, F, a0, a1, b0, b1, n, seed, col = PAL.ochreDeep) {
    const r = P.rng(seed);
    for (let i = 0; i < n; i++) {
      const a = a0 + r() * (a1 - a0), w = 0.2 + r() * 0.8, L = (b1 - b0) * (0.2 + r() * 0.6);
      P.wash(ctx, F.poly([[a, b1], [a + w, b1], [a + w * 0.7, b1 - L], [a + w * 0.2, b1 - L * 0.9]]), {
        grad: [...F(a, b1), ...F(a, b1 - L), [[0, col], [1, 'rgba(255,255,255,0)']]],
        alpha: 0.18 + r() * 0.15, rough: 0.8, soft: 1.2,
      });
    }
  };

  // -------------------------------------------------------------- wada
  /*
   * A riverside wada / house as a box: lit left side, front facade facing the
   * river, optional tiled roof, timber balcony, windows.
   *  front, side: frames at the front-left-bottom corner (along river, and
   *  going away from the river)
   */
  A.house = function (ctx, front, side, o) {
    const r = P.rng(o.seed || 7);
    const w = o.w, h = o.h, d = o.d || 8;
    const hz = o.haze || 0;
    const wall = A.haze(o.wall || PAL.lime, hz);
    const fq = front.rect(0, 0, w, h);
    const sq = side.poly([[0, 0], [d, 0], [d, h], [0, h]]);
    const paper = A.haze(PAL.paper, hz * 0.5);
    P.ground(ctx, sq, paper, 0.3, o.seed);
    P.ground(ctx, fq, paper, 0.3, o.seed + 1);
    // sunlit side: pale, warm
    P.wash(ctx, sq, { color: A.haze(P.mix(wall, '#f3d9a8', 0.25), hz), alpha: 0.62, rough: 0.6, gran: 0.2, blotch: 0.5, edge: 0.3 });
    // a small window on the side wall, and the shadow of the neighbour
    if (hz < 0.5 && d > 4) {
      const wa = d * (0.3 + r() * 0.3);
      P.wash(ctx, side.rect(wa, h * 0.55, wa + 0.7, h * 0.55 + 1.0), { color: A.haze(PAL.window, hz), alpha: 0.6 * (1 - hz), rough: 0.3 });
    }
    P.wash(ctx, side.poly([[d * 0.55, 0], [d, 0], [d, h * 0.9], [d * 0.8, h * 0.6]]), { color: A.haze(PAL.shadow, hz), alpha: 0.28 * (1 - hz), rough: 0.8, soft: 1 });
    // front: in raking light, a touch deeper, deepening towards the ground
    P.wash(ctx, fq, {
      grad: [...front(0, h), ...front(0, 0), [[0, wall], [1, P.mix(wall, PAL.ochreDeep, 0.35)]]],
      alpha: 0.72, rough: 0.6, gran: 0.25, blotch: 0.55, edge: 0.35, edgeColor: P.shade(wall, -0.45),
    });
    // a cool glaze over the whole front: it turns a little away from the sun
    P.wash(ctx, fq, { color: A.haze(PAL.shadow, hz * 0.7), alpha: (o.shade ? 0.42 : 0.16) * (1 - hz * 0.5), rough: 0.6, blotch: 0.5, soft: 0.4 });
    if (!hz || hz < 0.6) A.stains(ctx, front, 0.2, w - 0.6, 0.5, h - 0.3, Math.round(w / 2.2), o.seed + 3, P.mix(PAL.ochreDeep, wall, hz));
    // plaster fallen away: a patch of old brick
    if (hz < 0.3 && r() < 0.45) {
      const a = 0.4 + r() * (w - 1.6), b = 0.8 + r() * (h - 2.5), pw = 0.6 + r() * 0.8, ph = 0.4 + r() * 0.6;
      P.wash(ctx, front.poly([[a, b], [a + pw, b + 0.1], [a + pw * 0.9, b + ph], [a + 0.1, b + ph * 0.8]]), { color: PAL.terracotta, alpha: 0.45, rough: 0.6, gran: 0.4 });
      for (let k = 1; k < 4; k++) P.ink(ctx, [front(a + 0.05, b + (ph * k) / 4), front(a + pw * 0.85, b + (ph * k) / 4)], { w: 0.4, alpha: 0.3, wobble: 0.1, color: PAL.tileDark });
    }
    // base: plinth darker, damp
    P.wash(ctx, front.rect(0, 0, w, 0.7), { color: A.haze(PAL.stoneWarm, hz), alpha: 0.5, rough: 0.4, gran: 0.4 });
    // floors
    const floors = o.floors || Math.max(1, Math.round(h / 3.1));
    const fh = h / floors;
    for (let f = 0; f < floors; f++) {
      const b = f * fh;
      if (f > 0) P.wash(ctx, front.rect(0, b - 0.08, w, b + 0.05), { color: P.shade(wall, -0.3), alpha: 0.35, rough: 0.3 });
      if (o.balcony === f) continue;
      const nwin = Math.max(1, Math.floor(w / (o.bay || 2.4)));
      for (let i = 0; i < nwin; i++) {
        if (r() < (o.skip || 0.15)) continue;
        const ww = 0.8 + r() * 0.3, wh = Math.min(fh * 0.5, 1.3);
        const a = ((i + 0.5) * w) / nwin - ww / 2;
        const bb = b + (f === 0 ? 0.9 : 0.8);
        if (f === 0 && i === Math.floor(nwin / 2) && o.door !== false) {
          // a door
          A.window(ctx, front, a - 0.1, b + 0.05, ww + 0.3, Math.min(2.2, fh * 0.75), { seed: o.seed + i, arch: o.arches, alpha: 0.75 * (1 - hz * 0.6), dark: A.haze(PAL.woodDark, hz) });
          continue;
        }
        A.window(ctx, front, a, bb, ww, wh, {
          seed: o.seed + i * 13 + f, arch: o.arches && r() < 0.7, alpha: 0.75 * (1 - hz * 0.65),
          shutter: r() < 0.35 && !hz ? (r() < 0.5 ? '#7c948f' : PAL.wood) : null, bars: !hz,
          dark: A.haze(PAL.window, hz),
        });
      }
    }
    // timber balcony
    if (o.balcony != null) {
      const b = o.balcony * fh + 0.2;
      const bh = fh * 0.62;
      const proj = 0.9;
      const top = b + bh, x0 = 0.1, x1 = w - 0.1;
      // recess behind balcony (deep shade)
      P.wash(ctx, front.rect(x0, b, x1, top + 0.4), { color: A.haze(PAL.woodDark, hz), alpha: 0.55, rough: 0.3, gran: 0.3 });
      // timber posts and lattice
      const n = Math.round((x1 - x0) / 0.9);
      for (let i = 0; i <= n; i++) {
        const a = x0 + ((x1 - x0) * i) / n;
        P.wash(ctx, front.rect(a - 0.07, b, a + 0.07, top), { color: A.haze(PAL.wood, hz), alpha: 0.7, rough: 0.15 });
      }
      // railing panel, lit
      P.wash(ctx, front.rect(x0, b - 0.15, x1, b + 0.75), { color: A.haze(P.mix(PAL.wood, PAL.ochre, 0.45), hz), alpha: 0.7, rough: 0.3, gran: 0.4, edge: 0.3 });
      for (let i = 0; i < n * 3; i++) {
        const a = x0 + ((x1 - x0) * (i + 0.5)) / (n * 3);
        P.ink(ctx, [front(a, b - 0.05), front(a, b + 0.65)], { w: 0.5, alpha: 0.35 * (1 - hz), wobble: 0.1, gaps: 0 });
      }
      // floor beam and its shadow
      P.wash(ctx, front.rect(x0 - 0.2, b - 0.35, x1 + 0.2, b - 0.12), { color: A.haze(PAL.woodDark, hz), alpha: 0.7, rough: 0.2 });
      P.wash(ctx, front.rect(x0 - 0.1, b - 0.9, x1 + 0.1, b - 0.35), { color: PAL.shadow, alpha: 0.35, rough: 0.6, soft: 1.5 });
      // small sloping awning above
      P.wash(ctx, front.poly([[x0 - 0.3, top + 0.35], [x1 + 0.3, top + 0.35], [x1 + 0.2, top + 0.7], [x0 - 0.2, top + 0.7]]), { color: A.haze(PAL.terracotta, hz), alpha: 0.6, rough: 0.3, gran: 0.4 });
      P.wash(ctx, front.rect(x0 - 0.1, top - 0.1, x1 + 0.1, top + 0.35), { color: PAL.shadowDeep, alpha: 0.3, rough: 0.4, soft: 1 });
    }
    // roof
    if (o.roof === 'tile') {
      const pitch = 0.45, ov = 0.5, rh = o.roofH || 2.2;
      // seen from below: front slope foreshortened, a band above the eave
      const eave = front.poly([[-ov, h - 0.1], [w + ov, h - 0.1], [w + ov * 0.6, h + rh * pitch], [-ov * 0.6, h + rh * pitch]]);
      P.ground(ctx, eave, paper, 0.3);
      P.wash(ctx, eave, { color: A.haze(PAL.terracotta, hz), alpha: 0.75, rough: 0.5, gran: 0.55, blotch: 0.4, edge: 0.3 });
      const rows = 4;
      for (let i = 1; i <= rows; i++) {
        const b = h - 0.1 + (rh * pitch * i) / (rows + 0.5);
        P.ink(ctx, [front(-ov * 0.9, b), front(w + ov * 0.9, b)], { w: 0.6, alpha: 0.3 * (1 - hz), wobble: 0.5, gaps: 0.15, color: PAL.tileDark });
      }
      // eave shadow on the wall
      P.wash(ctx, front.rect(0, h - 0.9, w, h - 0.05), { color: PAL.shadow, alpha: 0.45, rough: 0.8, soft: 1.2 });
      // side gable end
      const g = side.poly([[0, h], [d, h], [d / 2, h + rh]]);
      P.ground(ctx, g, paper, 0.3);
      P.wash(ctx, g, { color: A.haze(P.mix(wall, '#f7e7c4', 0.3), hz), alpha: 0.5, rough: 0.3, gran: 0.2 });
    } else {
      // flat roof; sometimes a small room built on the terrace
      if (o.roofRoom || (o.roofRoom == null && hz < 0.5 && r() < 0.4)) {
        const ra = w * (0.15 + r() * 0.3), rw = w * (0.35 + r() * 0.2), rh = 2.1;
        const sb = 1.5; // set back from the parapet: seen from below it sits a little lower
        const rf = front.rect(ra, h + 0.5, ra + rw, h + rh - 0.2);
        P.ground(ctx, rf, paper, 0.3);
        P.wash(ctx, rf, { color: P.mix(wall, PAL.limeWarm, 0.4), alpha: 0.6, rough: 0.4, gran: 0.25 });
        P.wash(ctx, front.rect(ra + rw * 0.3, h + 0.5, ra + rw * 0.55, h + 1.6), { color: A.haze(PAL.window, hz), alpha: 0.6, rough: 0.2 });
        P.wash(ctx, front.rect(ra - 0.15, h + rh - 0.3, ra + rw + 0.15, h + rh - 0.1), { color: A.haze(PAL.stoneWarm, hz), alpha: 0.6, rough: 0.2 });
      }
      // a parapet with a darker coping
      P.wash(ctx, front.rect(-0.05, h - 0.15, w + 0.05, h + 0.55), { color: P.shade(wall, -0.08), alpha: 0.55, rough: 0.3, gran: 0.3 });
      P.wash(ctx, front.rect(-0.1, h + 0.45, w + 0.1, h + 0.62), { color: A.haze(PAL.stoneWarm, hz), alpha: 0.6, rough: 0.2 });
      P.wash(ctx, front.rect(0, h - 0.7, w, h - 0.15), { color: PAL.shadow, alpha: 0.28, rough: 0.6, soft: 1.2 });
    }
    // pencil underdrawing on nearer houses: corners and eaves, overshooting
    if (hz < 0.35) {
      const pa = 0.32 * (1 - hz * 2);
      P.pencil(ctx, front(0, 0), front(0, h), { alpha: pa, over: 7 });
      P.pencil(ctx, front(w, 0), front(w, h), { alpha: pa * 0.8, over: 7 });
      P.pencil(ctx, front(0, h), front(w, h), { alpha: pa, over: 9 });
      P.pencil(ctx, side(d * 0.5, h), front(0, h), { alpha: pa * 0.6, over: 5 });
      if (r() < 0.6) P.pencil(ctx, front(0, 0.7), front(w, 0.7), { alpha: pa * 0.7, over: 6 });
    }
    // the drawn line: only a few edges, and not every building
    if (!hz || hz < 0.4) {
      const L = 0.45 * (1 - hz);
      P.ink(ctx, [front(0, 0), front(0, h)], { w: 0.7, alpha: L, wobble: 0.3 });
      if (r() < 0.6) P.ink(ctx, [front(-0.1, h + (o.roof === 'tile' ? 0 : 0.6)), front(w * (0.4 + r() * 0.6), h + (o.roof === 'tile' ? 0 : 0.6))], { w: 0.6, alpha: L * 0.8, wobble: 0.4, gaps: 0.1 });
    }
  };

  // -------------------------------------------------------------- shikhara
  /*
   * A Nashik basalt temple, Maratha period: a raised plinth, a mandapa with a
   * stepped roof, and a curvilinear shikhara with miniature spires, an
   * amalaka and a kalash. F is a frame in the temple's front plane; a is
   * centred on the sanctum.
   */
  A.temple = function (ctx, F, o = {}) {
    const hz = o.haze || 0;
    const stone = A.haze(P.mix(P.mix(PAL.basalt, PAL.basaltDark, 0.2), '#9a7d68', 0.25), hz), dark = A.haze(PAL.basaltDark, hz), deep = A.haze(PAL.basaltDeep, hz * 0.8);
    const paper = A.haze(PAL.paper, hz * 0.5);
    const S = o.scale || 1;
    const q = (a, b) => F(a * S, b * S);
    const poly = (pts) => pts.map(([a, b]) => q(a, b));
    // plinth
    const plinth = poly([[-6.2, 0], [4.4, 0], [4.4, 1.3], [-6.2, 1.3]]);
    P.ground(ctx, plinth, paper);
    P.wash(ctx, plinth, { color: stone, alpha: 0.75, rough: 0.4, gran: 0.6, blotch: 0.3, edge: 0.3 });
    P.wash(ctx, poly([[-6.3, 1.05], [4.5, 1.05], [4.5, 1.32], [-6.3, 1.32]]), { color: deep, alpha: 0.5, rough: 0.3 });
    P.ink(ctx, [q(-6.2, 0.55), q(4.4, 0.55)], { w: 0.5, alpha: 0.35 * (1 - hz), wobble: 0.3 });
    // mandapa (left), stepped pyramidal roof
    const mw0 = -6.0, mw1 = -1.9;
    const mand = poly([[mw0, 1.3], [mw1, 1.3], [mw1, 4.2], [mw0, 4.2]]);
    P.ground(ctx, mand, paper);
    P.wash(ctx, mand, { color: stone, alpha: 0.7, rough: 0.4, gran: 0.55, blotch: 0.35, edge: 0.3 });
    // pillared openings
    for (let i = 0; i < 3; i++) {
      const a = mw0 + 0.45 + i * 1.25;
      const op = poly([[a, 1.35], [a + 0.8, 1.35], [a + 0.8, 3.0], [a + 0.6, 3.35], [a + 0.4, 3.45], [a + 0.2, 3.35], [a, 3.0]]);
      P.wash(ctx, op, { color: deep, alpha: 0.85, rough: 0.2, gran: 0.3 });
    }
    // eave (chhajja) and its shadow
    P.wash(ctx, poly([[mw0 - 0.4, 4.1], [mw1 + 0.3, 4.1], [mw1 + 0.2, 4.45], [mw0 - 0.3, 4.45]]), { color: dark, alpha: 0.8, rough: 0.3 });
    // stepped roof
    let y = 4.45;
    for (let i = 0; i < 4; i++) {
      const inset = 0.35 + i * 0.45, th = 0.55;
      const tier = poly([[mw0 + inset, y], [mw1 - inset, y], [mw1 - inset - 0.15, y + th], [mw0 + inset + 0.15, y + th]]);
      P.ground(ctx, tier, paper);
      P.wash(ctx, tier, { color: i % 2 ? stone : P.mix(stone, '#c9b8a0', 0.25), alpha: 0.75, rough: 0.3, gran: 0.6 });
      P.wash(ctx, poly([[(mw0 + mw1) / 2 + 0.2, y], [mw1 - inset, y], [mw1 - inset - 0.15, y + th], [(mw0 + mw1) / 2 + 0.2, y + th]]), { color: PAL.shadow, alpha: 0.35, rough: 0.2 });
      y += th;
    }
    const mc = (mw0 + mw1) / 2;
    P.wash(ctx, poly(P.ellipse(mc, y + 0.25, 0.5, 0.3, 16)), { color: dark, alpha: 0.8, rough: 0.2 });
    P.wash(ctx, poly([[mc - 0.12, y + 0.4], [mc + 0.12, y + 0.4], [mc, y + 1.0]]), { color: dark, alpha: 0.8, rough: 0.1 });

    // sanctum walls
    const g0 = -1.9, g1 = 2.6, gc = (g0 + g1) / 2, gt = 4.6;
    const gw = poly([[g0, 1.3], [g1, 1.3], [g1, gt], [g0, gt]]);
    P.ground(ctx, gw, paper);
    P.wash(ctx, gw, { color: stone, alpha: 0.72, rough: 0.4, gran: 0.6, blotch: 0.3, edge: 0.3 });
    // offsets (pilasters) — light/shade pairs
    for (const a of [g0 + 0.55, gc - 0.45, gc + 0.45, g1 - 0.55]) {
      P.wash(ctx, poly([[a, 1.35], [a + 0.18, 1.35], [a + 0.18, gt - 0.2], [a, gt - 0.2]]), { color: PAL.shadow, alpha: 0.35, rough: 0.2 });
    }
    // niche with a deity (only a dark recess)
    P.wash(ctx, poly([[gc - 0.45, 2.0], [gc + 0.45, 2.0], [gc + 0.45, 3.4], [gc, 3.8], [gc - 0.45, 3.4]]), { color: deep, alpha: 0.7, rough: 0.2 });
    // right half in shade
    P.wash(ctx, poly([[gc + 0.6, 1.3], [g1, 1.3], [g1, gt], [gc + 0.6, gt]]), { color: PAL.shadowDeep, alpha: 0.35, rough: 0.3, soft: 0.6 });
    // cornice
    P.wash(ctx, poly([[g0 - 0.3, gt - 0.1], [g1 + 0.3, gt - 0.1], [g1 + 0.2, gt + 0.25], [g0 - 0.2, gt + 0.25]]), { color: dark, alpha: 0.8, rough: 0.3 });

    // shikhara
    const H = 8.2, b0 = gt + 0.25, hw0 = 2.15;
    const hw = (t) => hw0 * (1 - 0.56 * Math.pow(t, 1.7)) * (1 + 0.1 * Math.sin(Math.PI * t * 0.9));
    const prof = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push([gc - hw(t), b0 + t * H]); }
    for (let i = 24; i >= 0; i--) { const t = i / 24; prof.push([gc + hw(t), b0 + t * H]); }
    const sh = poly(prof);
    // miniature spires (urushringa) clinging to the lower flanks
    for (const side of [-1, 1]) {
      const pr = [];
      const c = gc + side * 1.45, h2 = 4.2, w2 = 0.85;
      for (let i = 0; i <= 12; i++) { const t = i / 12; pr.push([c - w2 * (1 - 0.6 * t), b0 + t * h2]); }
      for (let i = 12; i >= 0; i--) { const t = i / 12; pr.push([c + w2 * (1 - 0.6 * t), b0 + t * h2]); }
      const ps = poly(pr);
      P.ground(ctx, ps, paper);
      P.wash(ctx, ps, { color: side < 0 ? stone : dark, alpha: 0.75, rough: 0.35, gran: 0.6, edge: 0.3 });
      P.wash(ctx, poly(P.ellipse(c, b0 + h2 + 0.15, 0.4, 0.17, 12)), { color: dark, alpha: 0.7, rough: 0.15 });
    }
    P.ground(ctx, sh, paper);
    P.wash(ctx, sh, {
      grad: [...q(gc - hw0, b0), ...q(gc + hw0, b0), [[0, P.mix(stone, '#d9bf9c', 0.45)], [0.4, P.mix(stone, '#b59a80', 0.2)], [0.58, dark], [1, deep]]],
      alpha: 0.85, rough: 0.4, gran: 0.7, blotch: 0.3, edge: 0.35,
    });
    // horizontal courses (bhumi), following the curvature
    for (let i = 1; i < 15; i++) {
      const t = i / 15, b = b0 + t * H, w = hw(t);
      const pts = [];
      for (let k = 0; k <= 8; k++) { const s = -1 + (2 * k) / 8; pts.push(q(gc + s * w * 0.98, b - 0.06 * (1 - s * s))); }
      P.ink(ctx, pts, { w: 0.55, alpha: (i % 3 ? 0.22 : 0.4) * (1 - hz), wobble: 0.2, gaps: 0.08, color: deep });
    }
    // central spine (lata) and its shade edge
    const spine = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; spine.push([gc - 0.42 * (1 - 0.5 * t), b0 + t * H]); }
    for (let i = 12; i >= 0; i--) { const t = i / 12; spine.push([gc + 0.42 * (1 - 0.5 * t), b0 + t * H]); }
    P.wash(ctx, poly(spine), { color: P.mix(stone, '#d8c5a8', 0.2), alpha: 0.4, rough: 0.2, gran: 0.5 });
    P.ink(ctx, spine.slice(13).map(([a, b]) => q(a, b)), { w: 0.6, alpha: 0.4 * (1 - hz), wobble: 0.2, color: deep });
    // amalaka and kalash
    const top = b0 + H;
    const am = poly(P.ellipse(gc, top + 0.35, hw(1) * 1.35, 0.42, 24));
    P.ground(ctx, am, paper);
    P.wash(ctx, am, { color: dark, alpha: 0.85, rough: 0.2, gran: 0.5 });
    for (let k = -3; k <= 3; k++) P.ink(ctx, [q(gc + k * 0.17, top), q(gc + k * 0.19, top + 0.7)], { w: 0.4, alpha: 0.3 * (1 - hz), wobble: 0.1, color: deep });
    const kal = poly([[gc - 0.12, top + 0.75], [gc + 0.12, top + 0.75], [gc + 0.32, top + 1.1], [gc + 0.12, top + 1.45], [gc + 0.05, top + 2.0], [gc - 0.05, top + 2.0], [gc - 0.12, top + 1.45], [gc - 0.32, top + 1.1]]);
    P.ground(ctx, kal, paper);
    P.wash(ctx, kal, { color: P.mix(dark, PAL.ochreDeep, 0.35), alpha: 0.85, rough: 0.1 });
    if (o.flag) {
      // the one saffron note in the far scene
      P.ink(ctx, [q(gc + 0.02, top + 1.8), q(gc + 0.05, top + 4.2)], { w: 0.7, alpha: 0.6, wobble: 0.1, gaps: 0 });
      P.wash(ctx, poly([[gc + 0.06, top + 4.15], [gc + 1.25, top + 3.75], [gc + 0.07, top + 3.4]]), { color: PAL.saffron, alpha: 0.85, rough: 0.15, gran: 0.2 });
    }
    // outline only where it matters: the lit edge of the spire against sky
    P.ink(ctx, prof.slice(0, 25).map(([a, b]) => q(a, b)), { w: 0.6, alpha: 0.35 * (1 - hz), wobble: 0.2, gaps: 0.12, color: deep });
  };

  // -------------------------------------------------------------- chhatri
  // A small domed pavilion on the ghat (frame at its base centre).
  A.chhatri = function (ctx, F, o = {}) {
    const hz = o.haze || 0;
    const stone = A.haze(o.stone || PAL.stoneWarm, hz), dark = A.haze(PAL.basaltDark, hz);
    const paper = A.haze(PAL.paper, hz * 0.5);
    const w = o.w || 2.4, h = o.h || 2.4;
    // platform
    const pl = F.rect(-w * 0.7, 0, w * 0.7, 0.5);
    P.ground(ctx, pl, paper);
    P.wash(ctx, pl, { color: stone, alpha: 0.7, rough: 0.3, gran: 0.5 });
    // interior darkness behind the pillars
    P.wash(ctx, F.rect(-w / 2, 0.5, w / 2, 0.5 + h), { color: dark, alpha: 0.7, rough: 0.2, gran: 0.3 });
    // cusped arch openings — leave the stone between them
    const pillars = [-w / 2, -w / 6, w / 6, w / 2];
    for (let i = 0; i < pillars.length; i++) {
      const a = pillars[i];
      const pp = F.rect(a - 0.13, 0.5, a + 0.13, 0.5 + h);
      P.ground(ctx, pp, paper);
      P.wash(ctx, pp, { color: i === 0 ? P.mix(stone, '#f0dfc0', 0.3) : stone, alpha: 0.75, rough: 0.15, gran: 0.4 });
    }
    // arch spandrels
    for (let i = 0; i < 3; i++) {
      const a0 = pillars[i] + 0.13, a1 = pillars[i + 1] - 0.13, ac = (a0 + a1) / 2;
      const sp = F.poly([[a0, 0.5 + h * 0.62], [ac - 0.15, 0.5 + h * 0.86], [ac, 0.5 + h * 0.92], [ac + 0.15, 0.5 + h * 0.86], [a1, 0.5 + h * 0.62], [a1, 0.5 + h], [a0, 0.5 + h]]);
      P.ground(ctx, sp, paper);
      P.wash(ctx, sp, { color: stone, alpha: 0.75, rough: 0.15, gran: 0.4 });
    }
    // chhajja
    const ch = F.poly([[-w / 2 - 0.35, 0.5 + h], [w / 2 + 0.35, 0.5 + h], [w / 2 + 0.25, 0.5 + h + 0.28], [-w / 2 - 0.25, 0.5 + h + 0.28]]);
    P.ground(ctx, ch, paper);
    P.wash(ctx, ch, { color: dark, alpha: 0.8, rough: 0.2 });
    // dome
    const db = 0.5 + h + 0.28, dr = w * 0.48;
    const dome = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, ang = Math.PI * t;
      const bulge = 1 + 0.12 * Math.sin(ang);
      dome.push([-Math.cos(ang) * dr * bulge * (1 - 0.12 * t * t), db + Math.sin(ang) * dr * 1.05 + (t > 0.5 ? 0 : 0)]);
    }
    const dpts = [[-dr, db]];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, ang = Math.PI * (1 - t);
      const rr = dr * (1 + 0.1 * Math.sin(Math.PI * t * 2) * (t < 0.5 ? 1 : 0)) ;
      dpts.push([Math.cos(ang) * dr * (0.95 + 0.1 * Math.sin(Math.PI * t)), db + Math.sin(ang) * dr * 1.1]);
    }
    const dpoly = F.poly(dpts);
    P.ground(ctx, dpoly, paper);
    P.wash(ctx, dpoly, { grad: [...F(-dr, db), ...F(dr, db), [[0, P.mix(stone, '#f0dfc0', 0.25)], [0.5, stone], [1, dark]]], alpha: 0.8, rough: 0.25, gran: 0.5, edge: 0.3 });
    // finial
    P.wash(ctx, F.poly([[-0.08, db + dr * 1.08], [0.08, db + dr * 1.08], [0.02, db + dr * 1.08 + 0.7], [-0.02, db + dr * 1.08 + 0.7]]), { color: dark, alpha: 0.8, rough: 0.05 });
    P.wash(ctx, F.poly(P.ellipse(0, db + dr * 1.1 + 0.1, 0.18, 0.12, 10)), { color: dark, alpha: 0.8, rough: 0.05 });
  };

  // -------------------------------------------------------------- tree
  // Wet-in-wet foliage mass in screen space (cx, cy, radius in px).
  A.tree = function (ctx, cx, cy, R, o = {}) {
    const r = P.rng(o.seed || 11);
    const hz = o.haze || 0;
    const leaf = A.haze(PAL.leaf, hz), dark = A.haze(PAL.leafDark, hz), light = A.haze(PAL.leafLight, hz);
    // trunk and a couple of limbs
    const tr = [[cx - R * 0.05, cy + R * 1.2], [cx + R * 0.06, cy + R * 1.2], [cx + R * 0.04, cy + R * 0.3], [cx - R * 0.03, cy + R * 0.3]];
    P.wash(ctx, tr, { color: A.haze(PAL.woodDark, hz), alpha: 0.6, rough: 0.6 });
    // masses: light on top-left, dark underneath
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = r() * R * 0.55;
      const x = cx + Math.cos(a) * d * 1.3, y = cy + Math.sin(a) * d * 0.7 - R * 0.1;
      const rr = R * (0.35 + r() * 0.3);
      P.wash(ctx, P.ellipse(x, y, rr, rr * 0.8, 24), { color: leaf, alpha: 0.5, rough: rr * 0.26, soft: 0.6, freq: 0.09, layers: 2, blotch: 0.35, gran: 0.25, edge: 0.3 });
    }
    for (let i = 0; i < 5; i++) {
      const x = cx + (r() - 0.4) * R * 1.2, y = cy + R * (0.15 + r() * 0.3);
      const rr = R * (0.22 + r() * 0.2);
      P.wash(ctx, P.ellipse(x, y, rr, rr * 0.55, 20), { color: dark, alpha: 0.55, rough: rr * 0.3, soft: 0.8, freq: 0.1, layers: 2, gran: 0.3, edge: 0.3 });
    }
    for (let i = 0; i < 4; i++) {
      const x = cx - R * 0.3 + (r() - 0.5) * R * 0.8, y = cy - R * (0.25 + r() * 0.25);
      const rr = R * (0.15 + r() * 0.15);
      P.wash(ctx, P.ellipse(x, y, rr, rr * 0.7, 16), { color: light, alpha: 0.25, rough: rr * 0.3, soft: rr * 0.15, freq: 0.1, mode: 'source-over' });
    }
    // a few drawn branches showing through
    for (let i = 0; i < 4; i++) {
      const x = cx + (r() - 0.5) * R * 0.9;
      P.ink(ctx, [[cx, cy + R * 0.5], [(cx + x) / 2, cy + R * 0.2], [x, cy - R * 0.1 * r()]], { w: 0.8, alpha: 0.35 * (1 - hz), wobble: 1, color: PAL.woodDark });
    }
  };

  // A tiny human figure for scale (screen space; h in px).
  A.figure = function (ctx, x, y, h, cloth, o = {}) {
    const r = P.rng(o.seed || 5);
    const w = h * 0.26;
    P.wash(ctx, [[x - w / 2, y - h * 0.82], [x + w / 2, y - h * 0.82], [x + w * 0.62, y - h * 0.05], [x - w * 0.6, y - h * 0.05]], { color: cloth, alpha: 0.85, rough: 0.2 });
    P.wash(ctx, P.ellipse(x + (r() - 0.5) * 0.6, y - h * 0.9, h * 0.085, h * 0.1, 10), { color: '#3a2c28', alpha: 0.85, rough: 0.05 });
    P.wash(ctx, [[x - w / 2, y - h * 0.55], [x + w * 0.05, y - h * 0.55], [x - w * 0.1, y - h * 0.08], [x - w * 0.6, y - h * 0.08]], { color: PAL.shadowDeep, alpha: 0.3, rough: 0.1 });
  };
})();
