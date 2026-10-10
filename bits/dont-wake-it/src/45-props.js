// ---- Props rooted in the anatomy: mushrooms, small trees, the closed eye ----
// Each prop is painted with the same light and fog as the body under it.
// Mushroom caps and stems also exist in the anatomy field (MAT_SHROOM), so
// what you see is what you can stand on.

function propsInRect(world, x0, y0, x1, y1) {
  const P = world.props;
  for (const m of P.mushrooms) if (m.top.x + m.capR > x0 && m.top.x - m.capR < x1 && m.top.y + m.capR > y0 && m.root.y < y1) return true;
  for (const t of P.trees) if (t.x + t.h > x0 && t.x - t.h < x1 && t.y + t.h > y0 && t.y - 0.5 < y1) return true;
  for (const e of P.eyes) if (e.x + e.w > x0 && e.x - e.w < x1 && e.y + e.w > y0 && e.y - e.w < y1) return true;
  return false;
}

function drawProps(g, world, x0, yTop, k, L, seed) {
  const P = (X, Y) => [(X - x0) * k, (yTop - Y) * k];
  const span = TILE / k;
  const inRect = (ax, ay, bx, by) => bx > x0 - 1 && ax < x0 + span + 1 && by > yTop - span - 1 && ay < yTop + 1;
  for (const t of world.props.trees) {
    if (inRect(t.x - t.h, t.y - 0.5, t.x + t.h, t.y + t.h)) drawTree(g, P, k, t, L);
  }
  for (const m of world.props.mushrooms) {
    if (inRect(m.top.x - m.capR - 1, m.root.y - 1, m.top.x + m.capR + 1, m.top.y + m.capR)) drawMushroom(g, P, k, m, L, seed);
  }
  for (const e of world.props.eyes) {
    if (inRect(e.x - e.w, e.y - e.w, e.x + e.w, e.y + e.w)) drawClosedEye(g, P, k, e, L, seed);
  }
}

function drawTree(g, P, k, t, L) {
  const r = rngFrom(t.seed);
  const [bx, by] = P(t.x, t.y);
  const hp = t.h * k;
  const fin = (c, y) => finishColor(c, y, L);
  // Grounding shadow where the plant meets the fur.
  dab(g, bx, by + 0.05 * k, 0.5 * hp * (t.kind === "shrub" ? 0.9 : 0.45), 0.08 * hp + 1, 0, fin(PAL.fur[1], t.y), 0.45);
  // Many small leaf dabs: dark core, sun-side highlights, muted toward the fur.
  const leaf = (lit, y) => fin(mixRGB(ramp(PAL.moss, lit), PAL.fur[1], 0.12), y);
  if (t.kind === "cypress") {
    streak(g, bx, by, 0, -1, hp * 0.2, Math.max(1, 0.05 * k), fin(hex("#4a3b3c"), t.y), 0.9);
    const n = 40 + Math.floor(t.h * 14);
    for (let i = 0; i < n; i++) {
      const yy = 0.1 + Math.pow(r(), 0.8) * 0.9;
      const half = (1 - yy) * 0.2 + 0.035;
      const ox = (r() - 0.5) * 2 * half * hp;
      const side = ox * SUN_SIDE / (half * hp + 1);
      const lit = clamp(0.12 + side * 0.35 + yy * 0.3 + (i > n * 0.75 ? 0.25 : 0) + (r() - 0.5) * 0.2, 0, 1);
      const rr = (0.022 + r() * 0.03) * hp + 0.6;
      dab(g, bx + ox, by - yy * hp, rr * 0.75, rr * 1.4, (r() - 0.5) * 0.4, leaf(lit, t.y + yy * t.h), 0.95);
    }
  } else {
    const n = 34 + Math.floor(t.h * 12);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI;
      const rad = Math.sqrt(r());
      const ox = Math.cos(a) * rad * 0.55 * hp, oy = Math.sin(a) * rad * 0.5 * hp;
      const lit = clamp(0.15 + (ox * SUN_SIDE / hp) * 0.5 + (oy / hp) * 0.6 + (i > n * 0.75 ? 0.2 : 0) + (r() - 0.5) * 0.2, 0, 1);
      const rr = (0.035 + r() * 0.04) * hp + 0.6;
      dab(g, bx + ox, by - oy, rr * 1.2, rr, (r() - 0.5) * 0.8, leaf(lit, t.y + oy / k), 0.95);
    }
  }
}

function drawMushroom(g, P, k, m, L, seed) {
  const r = rngFrom(hash2(m.root.x * 100, m.root.y * 100, seed + 41));
  const fin = (c) => finishColor(c, m.top.y, L);
  const [rx, ry] = P(m.root.x, m.root.y);
  const [tx, ty] = P(m.top.x, m.top.y);
  const cr = m.capR * k;
  const sw0 = (0.32 + m.capR * 0.05) * k, sw1 = (0.24 + m.capR * 0.04) * k;
  // Stem: lit on the sun side, lavender on the far side.
  const stem = (w0, w1, col, a, shift) => {
    g.beginPath();
    g.moveTo(rx - w0 + shift, ry);
    g.quadraticCurveTo((rx + tx) / 2 - w0 * 0.8 + shift, (ry + ty) / 2, tx - w1 + shift, ty);
    g.lineTo(tx + w1 + shift, ty);
    g.quadraticCurveTo((rx + tx) / 2 + w0 * 0.8 + shift, (ry + ty) / 2, rx + w0 + shift, ry);
    g.closePath();
    g.fillStyle = css(col, a);
    g.fill();
  };
  stem(sw0, sw1, fin(PAL.shroomStem[0]), 1, 0);
  stem(sw0 * 0.7, sw1 * 0.7, fin(PAL.shroomStem[1]), 0.95, sw1 * 0.25 * SUN_SIDE);
  stem(sw0 * 0.25, sw1 * 0.25, fin(PAL.shroomStem[2]), 0.8, sw1 * 0.55 * SUN_SIDE);
  // Moss collar where the stem roots into fur.
  for (let i = 0; i < 6; i++) {
    dab(g, rx + (r() - 0.5) * sw0 * 3, ry - r() * sw0 * 0.6, sw0 * (0.3 + r() * 0.3), sw0 * 0.22, 0, fin(mixRGB(ramp(PAL.moss, 0.2 + r() * 0.5), PAL.fur[1], 0.2)), 0.9);
  }
  const cy = ty - m.capR * 0.12 * k;
  // Gills: pale underside band with radial lines.
  dab(g, tx, cy + cr * 0.06, cr * 0.96, cr * 0.2, 0, fin(PAL.shroomGill[1]), 1);
  for (let i = 0; i < 14; i++) {
    const u = (i / 13 - 0.5) * 1.8;
    streak(g, tx + u * cr * 0.12, cy + cr * 0.14, u * 0.98, -0.12, cr * 0.4, Math.max(0.6, cr * 0.02), fin(PAL.shroomGill[0]), 0.4);
  }
  // Cap dome.
  const dome = (sx, sy, col, a) => {
    g.beginPath();
    g.moveTo(tx - cr * sx, cy);
    g.bezierCurveTo(tx - cr * sx * 0.95, cy - cr * 0.5 * sy, tx + cr * sx * 0.95, cy - cr * 0.5 * sy, tx + cr * sx, cy);
    g.quadraticCurveTo(tx, cy + cr * 0.12, tx - cr * sx, cy);
    g.closePath();
    g.fillStyle = css(col, a);
    g.fill();
  };
  dome(1, 1, fin(PAL.shroomCap[1]), 1);
  g.save();
  g.beginPath();
  g.moveTo(tx - cr, cy);
  g.bezierCurveTo(tx - cr * 0.95, cy - cr * 0.5, tx + cr * 0.95, cy - cr * 0.5, tx + cr, cy);
  g.quadraticCurveTo(tx, cy + cr * 0.12, tx - cr, cy);
  g.clip();
  // Light from the upper left: lit crown, shadowed right flank, pale rim band.
  const sun = SUN_SIDE;
  dab(g, tx + cr * 0.3 * sun, cy - cr * 0.3, cr * 0.75, cr * 0.28, 0.1 * sun, fin(PAL.shroomCap[2]), 0.85);
  dab(g, tx + cr * 0.42 * sun, cy - cr * 0.34, cr * 0.38, cr * 0.12, 0.15 * sun, fin(PAL.shroomCap[3]), 0.7);
  dab(g, tx - cr * 0.75 * sun, cy - cr * 0.05, cr * 0.5, cr * 0.3, -0.2 * sun, fin(PAL.shroomCap[0]), 0.55);
  dab(g, tx, cy + cr * 0.02, cr * 1.05, cr * 0.07, 0, fin(PAL.shroomGill[2]), 0.6);
  for (let i = 0; i < 9; i++) {
    const a = r() * 2 - 1;
    dab(g, tx + a * cr * 0.8, cy - cr * (0.08 + r() * 0.3) * (1 - a * a), cr * 0.035 + 0.5, cr * 0.025 + 0.5, 0, fin(PAL.shroomCap[3]), 0.7);
  }
  g.restore();
}

// A closed, lashed eye painted into the cranium fur.
function drawClosedEye(g, P, k, e, L, seed) {
  const fin = (c) => finishColor(c, e.y, L);
  const [cx, cy] = P(e.x, e.y);
  const w = e.w * k;
  g.save();
  g.translate(cx, cy);
  g.rotate(-e.tilt);
  g.scale(-(e.outer || -1), 1); // drawn with the outer corner on local -x
  // Socket: a lavender hollow above the lid, warm swell of the lid itself.
  for (let i = 0; i < 6; i++) {
    const s = 1 - i * 0.12;
    dab(g, 0, -w * 0.1, w * 0.66 * s, w * 0.26 * s, 0, fin(PAL.fur[1]), 0.06);
  }
  dab(g, -w * 0.04, -w * 0.07, w * 0.42, w * 0.09, 0, fin(PAL.fur[3]), 0.3);
  dab(g, -w * 0.1, -w * 0.09, w * 0.22, w * 0.035, 0, fin(PAL.fur[4]), 0.35);
  for (let i = 0; i < 4; i++) dab(g, 0, w * 0.1, w * (0.5 - i * 0.08), w * (0.09 - i * 0.015), 0, fin(PAL.fur[1]), 0.07);
  // Lid crease: a tapered crescent sagging downward.
  const lw = w * 0.03;
  g.beginPath();
  g.moveTo(-w * 0.5, -w * 0.02);
  g.quadraticCurveTo(0, w * 0.13, w * 0.48, w * 0.0);
  g.quadraticCurveTo(0, w * 0.13 + lw * 2.2, -w * 0.5, -w * 0.02 + lw * 0.6);
  g.closePath();
  g.fillStyle = css(fin(PAL.lash), 0.95);
  g.fill();
  // Lashes: heavier toward the outer (left) corner.
  const r = rngFrom(seed + 77);
  for (let i = 0; i < 15; i++) {
    const u = i / 14;
    const x = lerp(-w * 0.47, w * 0.4, u);
    const yb = (1 - Math.pow((x / (w * 0.49)), 2)) * w * 0.065 - w * 0.01;
    const len = w * (0.07 + (1 - u) * 0.08 + r() * 0.02);
    const dx = -0.35 - (1 - u) * 0.35, dy = 1;
    const l = Math.hypot(dx, dy);
    g.beginPath();
    g.moveTo(x, yb);
    g.quadraticCurveTo(x + (dx / l) * len * 0.4, yb + (dy / l) * len * 0.7, x + (dx / l) * len - len * 0.15, yb + (dy / l) * len * 0.8);
    g.lineWidth = Math.max(0.8, w * 0.012 * (1.2 - u * 0.5));
    g.lineCap = "round";
    g.strokeStyle = css(fin(PAL.lash), 0.85);
    g.stroke();
  }
  g.restore();
}
