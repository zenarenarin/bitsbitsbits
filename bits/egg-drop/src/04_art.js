// The painted objects, each baked into its own canvas in its own physical
// frame (metres, y up) so the renderer only rotates and places them.

// A canvas holding a region of a physical frame. draw(g) paints in metres.
function frameSprite(S, x0, x1, y0, y1, draw) {
  const c = makeCanvas((x1 - x0) * S, (y1 - y0) * S);
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, -S, -x0 * S, y1 * S);
  draw(g);
  return { canvas: c, x0, y1, S };
}
// blit a frameSprite with its frame origin at screen (sx, sy), rotated by ang (radians, CCW)
function blitFrame(g, spr, sx, sy, ang, k) {
  g.save();
  g.translate(sx, sy);
  g.rotate(-ang);
  const sc = k / spr.S;
  g.drawImage(spr.canvas, spr.x0 * k, -spr.y1 * k, spr.canvas.width * sc, spr.canvas.height * sc);
  g.restore();
}

const WOOD = '#c4813a';

function paintBackground(L, seed) {
  const { W, H, dpr, k, px, py } = L;
  // painted beyond the screen on every side so the camera can pull back
  const PX = L.padX, PY = L.padY;
  const c = makeCanvas((W + PX * 2) * dpr, (H + PY * 2) * dpr);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.scale(dpr, dpr);
  g.translate(PX, PY);
  // wall: butter yellow, worked with broad strokes
  g.fillStyle = PAL.butter; g.fillRect(-PX, -PY, W + PX * 2, H + PY * 2);
  strokeFill(g, rnd, { x: -PX - 40, y: -PY - 40, w: W + PX * 2 + 80, h: H + PY * 2 + 80 }, PAL.butter, { angle: -0.25, width: 46, length: 160, count: 70, alpha: 0.35, spread: 0.1 });
  for (let i = 0; i < 7; i++) wash(g, rnd, rnd() * W, rnd() * H * 0.5, 80 + rnd() * 120, rnd() < 0.5 ? PAL.ivory : PAL.mustard, 0.18);
  // corners deepen to mustard (painted, not a gradient)
  for (const [cx, cy] of [[-PX * 0.5, 0], [W + PX * 0.5, 0], [-PX * 0.5, H * 0.6], [W + PX * 0.5, H * 0.6]]) wash(g, rnd, cx, cy, W * 0.42, PAL.mustard, 0.32, 8);

  const tableTop = py - GEOM.tableY * k;      // screen y of the table's front lip
  const tableBack = tableTop - 0.42 * k;      // back edge of the table top
  // the niche: a deep burgundy arch the egg reads against
  const nw = Math.min(W * 0.47, 2.9 * k), apex = Math.max(L.hudBottom + 26, py - 1.75 * k - nw * 0.2);
  const npts = [];
  npts.push({ x: px - nw, y: tableBack + 4 });
  for (let i = 0; i <= 24; i++) { const a = Math.PI + (i / 24) * Math.PI; npts.push({ x: px + Math.cos(a) * nw, y: apex + nw + Math.sin(a) * nw }); }
  npts.push({ x: px + nw, y: tableBack + 4 });
  // ivory border painted around the arch first
  const border = npts.map(p => ({ x: px + (p.x - px) * 1.045, y: p.y < apex + nw ? apex + nw + (p.y - apex - nw) * 1.045 - 2 : p.y }));
  paintShape(g, rnd, border, PAL.ivory2, { amp: 3, angle: 1.2, brushW: 10, brushL: 50, count: 60, alpha: 0.35 });
  paintShape(g, rnd, npts, PAL.burgundy, { amp: 3, angle: 0.35, brushW: 34, brushL: 90, count: 120, alpha: 0.32, spread: 0.12, edge: PAL.burgundy2, edgeW: 3, edgeA: 0.6,
    inner: (gg) => {
      // a little warm light falling into the niche from above
      for (let i = 0; i < 5; i++) wash(gg, rnd, px + (rnd() - 0.5) * nw, apex + nw * 0.9 + rnd() * nw * 0.6, nw * 0.55, PAL.orange, 0.12);
      for (let i = 0; i < 4; i++) wash(gg, rnd, px + (rnd() - 0.5) * nw * 1.6, tableBack - rnd() * nw * 0.3, nw * 0.5, PAL.burgundy2, 0.35);
    } });
  // small painted ornament at the arch's crown
  for (let i = -2; i <= 2; i++) {
    const a = -Math.PI / 2 + i * 0.16;
    const x = px + Math.cos(a) * nw * 1.02, y = apex + nw + Math.sin(a) * nw * 1.02;
    g.fillStyle = i === 0 ? PAL.vermilion : PAL.olive;
    g.beginPath(); g.ellipse(x, y, 3.2, 4.6, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
  }

  // table: olive top, burnt-orange front
  const X0 = -PX - 10, X1 = W + PX + 10;
  const topPts = densify([{ x: X0, y: tableBack }, { x: X1, y: tableBack }, { x: X1, y: tableTop + 2 }, { x: X0, y: tableTop + 2 }], 30);
  paintShape(g, rnd, topPts, PAL.olive, { amp: 2.5, angle: 0.02, brushW: 10, brushL: 140, count: 90, alpha: 0.35, spread: 0.12 });
  // a soft cast shadow of the stand on the table top
  wash(g, rnd, px + 0.25 * k, tableBack + 0.24 * k, 0.55 * k, PAL.olive2, 0.6, 6);
  const frontPts = [{ x: X0, y: tableTop }, { x: X1, y: tableTop }, { x: X1, y: H + PY + 10 }, { x: X0, y: H + PY + 10 }];
  paintShape(g, rnd, frontPts, PAL.orange, { amp: 2.5, angle: 0.03, brushW: 16, brushL: 160, count: 140, alpha: 0.33, spread: 0.12 });
  // painted lip and a decorative band on the table's apron
  brush(g, rnd, X0, tableTop + 1, X1, tableTop + 1, 5, PAL.ivory2, 0.8, 0);
  const bandY = tableTop + Math.min(0.13 * k, (H - tableTop) * 0.1);
  brush(g, rnd, X0, bandY, X1, bandY, 6, PAL.burgundy, 0.85, 2);
  for (let x = X0 + 12; x < X1; x += 22) { g.fillStyle = rgba(PAL.butter, 0.9); g.beginPath(); g.arc(x + (rnd() - 0.5) * 2, bandY + 9 + (rnd() - 0.5) * 1.5, 1.6, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 5; i++) wash(g, rnd, X0 + rnd() * (X1 - X0), H, W * 0.4, PAL.orange2, 0.3);

  // the stand: turned olive column on a plinth, brass collars, brass saddle
  g.save();
  g.translate(px, py); g.scale(k, -k);
  const colTop = -0.1, colBot = GEOM.tableY + 0.16;
  const sr = mulberry32(seed + 7);
  // plinth
  paintShape(g, sr, roundRectPts(-0.46, GEOM.tableY + 0.0, 0.92, 0.17, 0.04), PAL.burgundy, { amp: 0.008, angle: 0, brushW: 0.05, brushL: 0.4, count: 30, alpha: 0.4, edge: PAL.burgundy2, edgeW: 0.012 });
  brush(g, sr, -0.44, GEOM.tableY + 0.155, 0.44, GEOM.tableY + 0.155, 0.025, PAL.brassHi, 0.6, 0);
  // column profile with a swelling waist
  const prof = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) { const u = i / steps, y = colBot + (colTop - colBot) * u; prof.push({ x: 0.075 + 0.03 * Math.sin(u * Math.PI) + (u < 0.08 ? 0.05 * (1 - u / 0.08) : 0), y }); }
  const colPts = prof.concat(prof.slice().reverse().map(p => ({ x: -p.x, y: p.y })));
  paintShape(g, sr, colPts, PAL.olive, { amp: 0.006, angle: Math.PI / 2, brushW: 0.035, brushL: 0.5, count: 40, alpha: 0.45, edge: PAL.olive2, edgeW: 0.01,
    inner: (gg) => { brush(gg, sr, 0.04, colBot, 0.05, colTop, 0.03, PAL.butter, 0.25, 2); brush(gg, sr, -0.07, colBot, -0.06, colTop, 0.035, PAL.olive2, 0.4, 2); } });
  for (const y of [colBot + 0.12, colBot + 0.7, -1.05]) {
    paintShape(g, sr, roundRectPts(-0.11, y - 0.03, 0.22, 0.06, 0.02), PAL.brass, { amp: 0.004, angle: 0, brushW: 0.02, brushL: 0.12, count: 10, alpha: 0.5, edge: PAL.brass2, edgeW: 0.007 });
    brush(g, sr, -0.08, y + 0.012, 0.06, y + 0.012, 0.01, PAL.brassHi, 0.8, 0);
  }
  // the angle scale: an enamel fan under the axle, read by the platform's needle
  const R0 = 0.27, R1 = 0.43, span = 0.36;
  const fan = [];
  for (let i = 0; i <= 14; i++) { const a = -Math.PI / 2 - span + (i / 14) * span * 2; fan.push({ x: Math.cos(a) * R1, y: Math.sin(a) * R1 }); }
  for (let i = 14; i >= 0; i--) { const a = -Math.PI / 2 - span + (i / 14) * span * 2; fan.push({ x: Math.cos(a) * R0, y: Math.sin(a) * R0 }); }
  paintShape(g, sr, fan, PAL.ivory, { amp: 0.004, angle: 0, brushW: 0.03, brushL: 0.1, count: 20, alpha: 0.4, edge: PAL.brass2, edgeW: 0.012, edgeA: 0.9 });
  const lim = 0.31;
  // danger sectors past ~11 degrees
  for (const sgn of [-1, 1]) {
    g.fillStyle = rgba(PAL.vermilion, 0.8);
    g.beginPath();
    const a0 = -Math.PI / 2 + sgn * 0.2, a1 = -Math.PI / 2 + sgn * lim;
    g.arc(0, 0, R1 - 0.015, a0, a1, sgn < 0);
    g.arc(0, 0, R1 - 0.07, a1, a0, sgn > 0);
    g.closePath(); g.fill();
  }
  g.strokeStyle = PAL.umber; g.lineCap = 'round';
  for (let i = -6; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * lim;
    const r0 = i % 3 === 0 ? R0 + 0.02 : R0 + 0.06;
    g.lineWidth = i === 0 ? 0.014 : 0.008;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * (R1 - 0.02), Math.sin(a) * (R1 - 0.02)); g.stroke();
  }
  // saddle cradling the axle
  const sad = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; sad.push({ x: Math.cos(a) * 0.16, y: -0.02 + Math.sin(a) * 0.16 }); }
  sad.push({ x: 0.16, y: 0.0 }); sad.push({ x: 0.11, y: 0.0 });
  for (let i = 12; i >= 0; i--) { const a = Math.PI + (i / 12) * Math.PI; sad.push({ x: Math.cos(a) * 0.11, y: -0.02 + Math.sin(a) * 0.11 }); }
  sad.push({ x: -0.11, y: 0.0 }); sad.push({ x: -0.16, y: 0.0 });
  paintShape(g, sr, sad, PAL.brass, { amp: 0.004, angle: 0.4, brushW: 0.03, brushL: 0.12, count: 16, alpha: 0.5, edge: PAL.brass2, edgeW: 0.01 });
  g.restore();

  grain(c, 0.07, rnd, true);
  return c;
}

// deck top finishes; all share the same painted wooden body
const FINISH = {
  rubber: { top: PAL.olive2, h: 0.05 },
  wood: { top: '#d9a25a', h: 0.035 },
  ceramic: { top: PAL.ivory, h: 0.045 },
  metal: { top: '#cdbb92', h: 0.045 }
};

function paintPlatform(S, surface, seed) {
  const rnd = mulberry32(seed);
  const hx = 1.76;
  return frameSprite(S, -2.08, 2.08, GEOM.railY - 0.09, GEOM.deckTop + 0.05, (g) => {
    // hangers
    for (const sx of [-1, 1]) {
      paintShape(g, rnd, rectPts(sx * hx - 0.022, GEOM.railY, 0.044, GEOM.deckBottom - GEOM.railY + 0.02), PAL.brass, { amp: 0.003, angle: Math.PI / 2, brushW: 0.015, brushL: 0.2, count: 6, alpha: 0.5, edge: PAL.brass2, edgeW: 0.008 });
      brush(g, rnd, sx * hx - 0.008, GEOM.railY + 0.02, sx * hx - 0.008, GEOM.deckBottom - 0.01, 0.01, PAL.brassHi, 0.7, 0);
      paintShape(g, rnd, ellipsePts(sx * hx, GEOM.deckBottom - 0.005, 0.05, 0.03, 12), PAL.brass2, { amp: 0.003, count: 4, alpha: 0.4 });
    }
    // rail rod
    paintShape(g, rnd, roundRectPts(-hx, GEOM.railY - 0.02, hx * 2, 0.04, 0.018), PAL.brass, { amp: 0.003, angle: 0, brushW: 0.012, brushL: 0.5, count: 18, alpha: 0.5, edge: PAL.brass2, edgeW: 0.008 });
    brush(g, rnd, -hx + 0.04, GEOM.railY + 0.008, hx - 0.04, GEOM.railY + 0.008, 0.009, PAL.brassHi, 0.75, 0);
    // ceramic end stops
    for (const sx of [-1, 1]) {
      const x = sx * (GEOM.travel + 0.25 + 0.05);
      paintShape(g, rnd, ellipsePts(x, GEOM.railY, 0.05, 0.062, 14), PAL.burgundy, { amp: 0.004, count: 6, alpha: 0.4, edge: PAL.burgundy2, edgeW: 0.008 });
      g.fillStyle = rgba(PAL.ivory, 0.7); g.beginPath(); g.ellipse(x - 0.015, GEOM.railY + 0.02, 0.012, 0.018, 0, 0, Math.PI * 2); g.fill();
    }
    // the needle, hanging from the axle to the scale
    g.strokeStyle = PAL.umber; g.lineWidth = 0.016; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -0.02); g.lineTo(0, -0.41); g.stroke();
    g.fillStyle = PAL.vermilion; g.beginPath(); g.moveTo(-0.018, -0.36); g.lineTo(0.018, -0.36); g.lineTo(0, -0.425); g.closePath(); g.fill();

    // deck body: painted wood with a hand-painted border band
    const deck = roundRectPts(-GEOM.half, GEOM.deckBottom, GEOM.half * 2, GEOM.deckTop - GEOM.deckBottom, 0.035, 4);
    paintShape(g, rnd, deck, WOOD, { amp: 0.006, angle: 0, brushW: 0.035, brushL: 0.9, count: 70, alpha: 0.4, spread: 0.16, edge: PAL.umber, edgeW: 0.012, edgeA: 0.7,
      inner: (gg) => {
        // grain
        for (let i = 0; i < 26; i++) {
          const y = GEOM.deckBottom + 0.01 + rnd() * (GEOM.deckTop - GEOM.deckBottom - 0.02), x = -GEOM.half + rnd() * GEOM.half * 2, L = 0.3 + rnd() * 0.9;
          brush(gg, rnd, x, y, x + L, y + (rnd() - 0.5) * 0.012, 0.006 + rnd() * 0.006, PAL.orange2, 0.45, 0);
        }
        // border band
        const b0 = GEOM.deckBottom + 0.035, b1 = GEOM.deckTop - FINISH[surface].h - 0.022;
        brush(gg, rnd, -GEOM.half + 0.05, (b0 + b1) / 2, GEOM.half - 0.05, (b0 + b1) / 2, (b1 - b0), PAL.burgundy, 0.92, 3);
        for (let x = -GEOM.half + 0.12; x < GEOM.half - 0.08; x += 0.16) {
          gg.fillStyle = rgba(PAL.ivory, 0.9);
          gg.beginPath(); gg.arc(x + (rnd() - 0.5) * 0.01, (b0 + b1) / 2 + (rnd() - 0.5) * 0.006, 0.013, 0, Math.PI * 2); gg.fill();
          gg.fillStyle = rgba(PAL.olive, 0.9);
          gg.beginPath(); gg.ellipse(x + 0.08, (b0 + b1) / 2, 0.028, 0.011, (rnd() - 0.5) * 0.6, 0, Math.PI * 2); gg.fill();
          gg.fillStyle = rgba(PAL.mustard, 0.9);
          gg.beginPath(); gg.arc(x + 0.08, (b0 + b1) / 2, 0.006, 0, Math.PI * 2); gg.fill();
        }
        // the finish on top of the deck
        const f = FINISH[surface], t0 = GEOM.deckTop - f.h;
        gg.save();
        raggedPath(gg, densify(rectPts(-GEOM.half - 0.01, t0, GEOM.half * 2 + 0.02, f.h + 0.02), 0.08), 0.004, rnd);
        gg.fillStyle = f.top; gg.fill(); gg.clip();
        if (surface === 'rubber') {
          for (let i = 0; i < 140; i++) { gg.fillStyle = rgba(rnd() < 0.5 ? PAL.olive : '#3f4425', 0.6); gg.beginPath(); gg.arc(-GEOM.half + rnd() * GEOM.half * 2, t0 + rnd() * f.h, 0.004 + rnd() * 0.004, 0, Math.PI * 2); gg.fill(); }
        } else if (surface === 'wood') {
          for (let i = 0; i < 14; i++) { const x = -GEOM.half + rnd() * GEOM.half * 2; brush(gg, rnd, x, t0 + f.h * 0.5, x + 0.4 + rnd() * 0.6, t0 + f.h * (0.3 + rnd() * 0.4), 0.006, PAL.orange, 0.5, 0); }
        } else if (surface === 'ceramic') {
          for (let x = -GEOM.half + 0.25; x < GEOM.half; x += 0.25) { gg.fillStyle = rgba(PAL.vermilion, 0.75); gg.fillRect(x - 0.004, t0, 0.008, f.h); }
          brush(gg, rnd, -GEOM.half + 0.1, GEOM.deckTop - 0.01, GEOM.half - 0.1, GEOM.deckTop - 0.01, 0.008, '#ffffff', 0.7, 0);
        } else {
          for (let i = 0; i < 40; i++) { const x = -GEOM.half + rnd() * GEOM.half * 2; brush(gg, rnd, x, t0 + rnd() * f.h, x + 0.3 + rnd() * 0.5, t0 + rnd() * f.h, 0.003, rnd() < 0.5 ? '#efe2bf' : '#8f7a52', 0.6, 0); }
          for (const x of [-GEOM.half + 0.06, GEOM.half - 0.06]) { gg.fillStyle = PAL.brass2; gg.beginPath(); gg.arc(x, t0 + f.h / 2, 0.009, 0, Math.PI * 2); gg.fill(); }
        }
        gg.restore();
        // light catching the top edge
        brush(gg, rnd, -GEOM.half + 0.03, GEOM.deckTop - 0.004, GEOM.half - 0.03, GEOM.deckTop - 0.004, 0.006, PAL.ivory, 0.5, 0);
      } });
  });
}

function paintCounterweight(S, seed) {
  const rnd = mulberry32(seed);
  const K = 1.45;
  return frameSprite(S, -0.24 * K, 0.24 * K, -0.4 * K, 0.09 * K, (g) => {
    g.scale(K, K);
    // collar riding on the rail
    paintShape(g, rnd, roundRectPts(-0.14, -0.055, 0.28, 0.11, 0.03), PAL.brass, { amp: 0.004, angle: 0, brushW: 0.02, brushL: 0.12, count: 12, alpha: 0.5, edge: PAL.brass2, edgeW: 0.01 });
    g.fillStyle = rgba(PAL.umber, 0.85); g.fillRect(-0.15, -0.012, 0.3, 0.024); // rail slot shadow
    brush(g, rnd, -0.12, 0.035, 0.12, 0.035, 0.012, PAL.brassHi, 0.8, 0);
    // bell
    const bell = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10, y = -0.05 - u * 0.24; bell.push({ x: 0.1 + 0.07 * Math.pow(u, 1.6), y }); }
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; bell.push({ x: Math.cos(a) * 0.17, y: -0.29 - Math.sin(a) * 0.035 }); }
    for (let i = 10; i >= 0; i--) { const u = i / 10, y = -0.05 - u * 0.24; bell.push({ x: -(0.1 + 0.07 * Math.pow(u, 1.6)), y }); }
    paintShape(g, rnd, bell, PAL.brass, { amp: 0.004, angle: Math.PI / 2, brushW: 0.025, brushL: 0.2, count: 30, alpha: 0.5, spread: 0.18, edge: PAL.brass2, edgeW: 0.01,
      inner: (gg) => {
        brush(gg, rnd, -0.07, -0.07, -0.11, -0.28, 0.035, PAL.brassHi, 0.65, 2);
        brush(gg, rnd, 0.09, -0.07, 0.13, -0.28, 0.04, PAL.brass2, 0.6, 2);
        // ceramic band with dots
        brush(gg, rnd, -0.2, -0.17, 0.2, -0.17, 0.065, PAL.ivory, 0.97, 2);
        for (let x = -0.12; x <= 0.13; x += 0.06) { gg.fillStyle = rgba(PAL.vermilion, 0.95); gg.beginPath(); gg.arc(x, -0.17, 0.011, 0, Math.PI * 2); gg.fill(); }
        gg.strokeStyle = rgba(PAL.umber, 0.5); gg.lineWidth = 0.006;
        for (const y of [-0.08, -0.255]) { gg.beginPath(); gg.moveTo(-0.2, y); gg.lineTo(0.2, y); gg.stroke(); }
      } });
    // knurled grip knob
    paintShape(g, rnd, roundRectPts(-0.065, -0.385, 0.13, 0.07, 0.025), PAL.vermilion, { amp: 0.003, angle: 0, brushW: 0.02, brushL: 0.08, count: 8, alpha: 0.5, edge: PAL.burgundy, edgeW: 0.008,
      inner: (gg) => { gg.strokeStyle = rgba(PAL.ivory, 0.45); gg.lineWidth = 0.005; for (let x = -0.055; x <= 0.06; x += 0.018) { gg.beginPath(); gg.moveTo(x, -0.38); gg.lineTo(x + 0.01, -0.32); gg.stroke(); } } });
  });
}

function paintEggShell(S, outline, seed) {
  const rnd = mulberry32(seed);
  let maxY = 0, maxX = 0;
  for (const p of outline) { maxY = Math.max(maxY, Math.abs(p.y)); maxX = Math.max(maxX, Math.abs(p.x)); }
  const m = 0.03;
  return frameSprite(S, -maxX - m, maxX + m, -maxY - m, maxY + m, (g) => {
    paintShape(g, rnd, outline, '#f4e8cc', { amp: 0.002, step: 0.03, angle: 0.15, brushW: 0.06, brushL: 0.22, count: 60, alpha: 0.4, spread: 0.07, edge: PAL.umber2, edgeW: 0.007, edgeA: 0.55,
      inner: (gg) => {
        // a faint warm flush toward the pointed end
        wash(gg, rnd, -maxX * 0.7, 0, maxX * 0.6, PAL.butter2, 0.22, 5);
        wash(gg, rnd, maxX * 0.3, maxY * 0.3, maxX * 0.5, '#fff7e6', 0.25, 4);
        // speckles, denser at the blunt end
        for (let i = 0; i < 120; i++) {
          const u = Math.pow(rnd(), 0.7);
          const x = (u * 2 - 1) * maxX * 0.95, y = (rnd() * 2 - 1) * maxY * 0.95;
          if (rnd() > 0.35 + 0.5 * (x / maxX + 1) / 2) continue;
          const r = 0.0025 + rnd() * rnd() * 0.009;
          gg.fillStyle = rgba(rnd() < 0.6 ? '#8a5a34' : '#6a4a3a', 0.25 + rnd() * 0.45);
          gg.beginPath(); gg.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); gg.fill();
        }
        // fine pores
        for (let i = 0; i < 260; i++) { gg.fillStyle = rgba(rnd() < 0.5 ? '#d9c39b' : '#fffaf0', 0.35); gg.fillRect((rnd() * 2 - 1) * maxX, (rnd() * 2 - 1) * maxY, 0.003, 0.003); }
      } });
  });
}

// a soft vermilion wash that blooms on the deck end the egg is nearing
function paintDanger(S, seed) {
  const rnd = mulberry32(seed);
  return frameSprite(S, -0.7, 0.7, -0.2, 0.42, (g) => {
    for (let i = 0; i < 4; i++) wash(g, rnd, (rnd() - 0.5) * 0.2, 0.12, 0.42, PAL.vermilion, 0.28, 6);
  });
}

// the broken egg on the table, painted once where it landed
function paintBroken(S, seed) {
  const rnd = mulberry32(seed);
  return frameSprite(S, -0.8, 0.8, -0.05, 0.42, (g) => {
    // albumen
    const al = [];
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; const r = 0.5 * (0.75 + rnd() * 0.35); al.push({ x: Math.cos(a) * r, y: 0.03 + Math.max(-0.02, Math.sin(a)) * r * 0.16 }); }
    g.globalAlpha = 0.85;
    paintShape(g, rnd, al, '#f1ecdc', { amp: 0.02, angle: 0, brushW: 0.05, brushL: 0.2, count: 20, alpha: 0.3, spread: 0.05 });
    g.globalAlpha = 1;
    // yolk
    paintShape(g, rnd, ellipsePts(0.06, 0.07, 0.15, 0.075, 20), '#e8922a', { amp: 0.006, angle: 0.2, brushW: 0.04, brushL: 0.12, count: 16, alpha: 0.5, edge: PAL.orange2, edgeW: 0.01, edgeA: 0.5 });
    g.fillStyle = 'rgba(255,240,200,0.7)'; g.beginPath(); g.ellipse(0.02, 0.1, 0.04, 0.016, -0.2, 0, Math.PI * 2); g.fill();
    // two shell halves with jagged rims
    const half = (cx, dir, tilt) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; pts.push({ x: cx + Math.cos(a) * 0.2 * dir, y: 0.2 + Math.sin(a) * 0.17 }); }
      for (let i = 0; i <= 7; i++) { const u = i / 7; pts.push({ x: cx + (0.2 - u * 0.4) * dir, y: 0.2 + (i % 2 ? 0.05 : -0.01) + (rnd() - 0.5) * 0.03 }); }
      g.save(); g.translate(cx, 0.03); g.rotate(tilt); g.translate(-cx, -0.03);
      paintShape(g, rnd, pts, '#f4e8cc', { amp: 0.003, angle: 0.1, brushW: 0.04, brushL: 0.12, count: 14, alpha: 0.4, edge: PAL.umber2, edgeW: 0.007, edgeA: 0.6 });
      g.restore();
    };
    half(-0.36, 1, 0.5);
    half(0.42, -1, -0.8);
    for (let i = 0; i < 9; i++) { const x = (rnd() - 0.5) * 1.2; g.fillStyle = '#efe2c4'; g.beginPath(); g.moveTo(x, 0.0); g.lineTo(x + 0.025, 0.02); g.lineTo(x + 0.05, 0.0); g.closePath(); g.fill(); }
  });
}
