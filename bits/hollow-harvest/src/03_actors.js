// =====================================================================
// Actors and props: the traveller, the thing in the field, obstacles and
// farm debris. The traveller is a hand-drawn upper body over limbs posed
// from an 8-step cycle; the creature is built from pixel lines on a
// skeleton so it can be drawn at any size without leaving the grid.
// =====================================================================
const PL_MAP = compileMap([
  '....ooooo.....',
  '..oohhhhhoo...',
  '.ohhhhhhhhHo..',
  'ohhhhhhhhhhHo.',
  'ohhhhhhhhHHHHo',
  'ohhhhhhhHddddo',
  'ohhhhhhhHdedeo',
  'ohhhhhhhHddddo',
  '.ohhhhhhhHHHo.',
  '..oohhhhhhoo..',
  '.oobbboccccco.',
  'obbbbbocccCCo.',
  'obBbbbocccCCo.',
  'obBbbbocccCCo.',
  'obBBbbocccCo..',
  '.obbbbocccCo..',
  '..oooooccCCo..',
  '......occCo...'
]);
const PL_COL = { o: '#1a1410', h: '#3d2420', H: '#74403a', d: '#22140f', e: '#f6e2b6', b: FIX.green, B: FIX.greenDark, c: '#dcbb7c', C: '#a8834f' };
const PL_COL_BLINK = Object.assign({}, PL_COL, { e: '#22140f' });
const PL_TROUSER = '#5e3a30', PL_TROUSER_BK = '#3a2420', PL_BOOT = '#1a1410';

// s.mode: idle | run | walk | tired | crouch | duck | air | fall | lifted
function drawPlayer(x, yF, s) {
  const m = s.mode, q = Math.floor(((s.ph % TAU) + TAU) % TAU / (TAU / 8)), ph = q * TAU / 8;
  let lean = 0, stride = 0, bend = 0.15, armSwing = 0, armBend = 0.4, crouch = false, headX = 0;
  if (m === 'run') { lean = 0.16; stride = 0.85; bend = 1.2; armSwing = 0.95; armBend = 1.3; }
  else if (m === 'walk') { lean = 0.05; stride = 0.45; bend = 0.5; armSwing = 0.45; }
  else if (m === 'tired') { lean = 0.36; stride = 0.32; bend = 0.4; armSwing = 0.15; headX = 1; }
  else if (m === 'crouch' || m === 'duck') { crouch = true; lean = m === 'duck' ? 0.2 : 0.08; stride = m === 'duck' ? 0.3 : 0; }
  else if (m === 'air') { lean = 0.2; stride = 0.6; bend = 1.4; armSwing = 0.6; armBend = 1.0; }
  else if (m === 'lifted') { lean = -0.1; }
  const legs = [];
  for (let i = 0; i < 2; i++) {
    const p2 = ph + i * Math.PI;
    let kx, ky, fx, fy;
    if (crouch) {
      const sw = Math.sin(p2) * stride;
      kx = 3 + (i ? -3 : 0) + Math.round(sw * 2); ky = 2; fx = 1 + (i ? -3 : 0) + Math.round(sw * 3); fy = 5;
    } else if (m === 'lifted') {
      const sw = Math.sin(s.t * 9 + i * 2);
      kx = Math.round(sw); ky = 4; fx = Math.round(sw * 2); fy = 8;
    } else {
      const th = Math.sin(p2) * stride, kb = 0.15 + (Math.cos(p2) > 0 ? bend * Math.cos(p2) : 0);
      kx = Math.round(Math.sin(th) * 4.5); ky = Math.round(Math.cos(th) * 4.5);
      fx = kx + Math.round(Math.sin(th - kb) * 4.5); fy = ky + Math.round(Math.cos(th - kb) * 4.5);
      if (m === 'air') { fy -= i ? 1 : 2; }
    }
    legs.push({ kx, ky, fx, fy, back: i === 1 });
  }
  const footMax = Math.max(legs[0].fy, legs[1].fy);
  const hipY = Math.round(yF - (crouch ? 6 : footMax) - (s.lift || 0));
  const skip = crouch ? (r => r === 14 || r === 15) : null;
  const hipLocal = crouch ? 15 : 17, top = hipY - hipLocal;
  const shift = r => Math.round((17 - r) * lean) + (r <= 9 ? headX : 0);
  const hipX = x + 8 + shift(17);
  const shoulderY = top + 11, shX = x + 8 + shift(11);
  const arm = (sgn, col) => {
    let a = -Math.sin(ph) * armSwing * sgn, a2 = a + armBend;
    if (m === 'lifted') { a = 2.6; a2 = 2.9; }
    if (crouch) { a = 0.5; a2 = 1.6; }
    if (m === 'tired') { a = 0.55; a2 = 0.45; }
    const ex = shX + Math.sin(a) * 3.5, ey = shoulderY + Math.cos(a) * 3.5;
    const hx = ex + Math.sin(a2) * 3, hy = ey + Math.cos(a2) * 3;
    line(shX, shoulderY, ex, ey, col, 2); line(ex, ey, hx, hy, col, 2);
    R(Math.round(hx), Math.round(hy), 1, 1, PL_COL.o);
  };
  const leg = (L, col) => {
    const kx = hipX + L.kx, ky = hipY + L.ky, fx = hipX + L.fx, fy = hipY + L.fy;
    line(hipX, hipY, kx, ky, col, 2); line(kx, ky, fx, fy, col, 2);
    R(fx - 1, fy, 3, 2, PL_BOOT); R(fx + 2, fy + 1, 1, 1, PL_BOOT);
  };
  arm(-1, PL_COL.C);
  leg(legs[1], PL_TROUSER_BK);
  drawMap(PL_MAP, x, top, s.blink ? PL_COL_BLINK : PL_COL, shift, skip);
  leg(legs[0], PL_TROUSER);
  arm(1, PL_COL.c);
  return { top, hipY };
}

// ---------- the creature ----------
// o: facing, phase, t, reach (0..1) toward rx/ry, scan (head turn), eyes (0..1), mottle
const _crumble = [];
function drawCreature(cx, gy, k, o, p) {
  const f = o.facing || 1, th = k >= 1.6 ? 4 : k >= 0.62 ? 2 : 1;
  const C = p.crea, Cd = p.creaDark, Cl = p.creaLit;
  const X = u => cx + u * k * f, Y = v => gy - v * k;
  const ph = o.phase, t = o.t;
  _crumble.length = 0;
  const pt = (u, v) => { _crumble.push(X(u), Y(v)); };
  // legs: different lengths, out of step with each other
  const sA = Math.sin(ph), sB = Math.sin(ph + Math.PI + 0.6 * Math.sin(ph * 0.5));
  const hipU = sA * 1.5, hipV = 72 + Math.abs(Math.cos(ph)) * 2;
  const leg = (hu, s, kneeV, kneeOff, col) => {
    const ku = hipU + hu + s * 9 + kneeOff, fu = hipU + hu + s * 17, fv = Math.max(0, Math.cos(ph) * s * 5);
    line(X(hipU + hu), Y(hipV), X(ku), Y(kneeV), col, th);
    line(X(ku), Y(kneeV), X(fu), Y(fv), col, th);
    line(X(fu), Y(fv), X(fu + 5), Y(fv - 1), col, th);
    pt(ku, kneeV); pt(fu, fv + 8);
  };
  leg(3, sB, 35, -4, Cd);
  // arms swing at a slower, uneven rate than the stride
  const pa = ph * 0.73 + 1;
  const sx = hipU + 7 + (o.lean || 0), sv = 106;
  const arm = (su, a, a2, L1, L2, col, reach) => {
    const shU = sx + su, shV = sv - 3;
    let eu = shU + Math.sin(a) * L1, ev = shV - Math.cos(a) * L1;
    let hu = eu + Math.sin(a2) * L2, hv = ev - Math.cos(a2) * L2;
    if (reach) {
      const tu = (o.rx - cx) / (k * f), tv = (gy - o.ry) / k;
      eu = lerp(eu, (shU + tu) / 2 + 4, reach); ev = lerp(ev, Math.max(shV, tv) + 14, reach);
      hu = lerp(hu, tu, reach); hv = lerp(hv, tv, reach);
    }
    line(X(shU), Y(shV), X(eu), Y(ev), col, th);
    line(X(eu), Y(ev), X(hu), Y(hv), col, th);
    const fa = Math.atan2(hu - eu, ev - hv);
    for (let i = -1; i <= 1; i++) {
      const aa = fa + i * 0.35, ln = 10 - Math.abs(i) * 2 + (i === 1 ? 2 : 0);
      line(X(hu), Y(hv), X(hu + Math.sin(aa) * ln), Y(hv - Math.cos(aa) * ln), col, Math.max(1, th - 1));
    }
    if (k >= 0.5) { R(Math.round(X(hu)) - 1, Math.round(Y(hv)), 2, 1, p.tassel); }
    pt(eu, ev); pt(hu, hv); pt(hu + Math.sin(fa) * 9, hv - Math.cos(fa) * 9);
  };
  arm(-5, -0.2 + 0.28 * Math.sin(pa + 2.2), 0.15 + 0.3 * Math.sin(pa + 2.2), 27, 33, Cd, 0);
  // coat: narrow body, torn hem in strips
  const tat = [];
  tat.push(sx - 7, sv, sx + 6, sv - 1, hipU + 9, 74, hipU + 11, 58);
  for (let i = 1; i <= 6; i++) {
    const u = hipU + 11 - i * 3.6, long = i % 2 === 1;
    tat.push(u + 1, long ? 46 - 4 * Math.sin(t * 2.3 + i) : 57, u - 1, long ? 48 - 4 * Math.sin(t * 2.3 + i) : 57);
  }
  tat.push(hipU - 11, 60, hipU - 8, 76);
  const pts = []; for (let i = 0; i < tat.length; i += 2) pts.push(X(tat[i]), Y(tat[i + 1]));
  poly(pts, C);
  for (let i = 0; i < tat.length; i += 4) pt(tat[i], tat[i + 1]);
  leg(-3, sA, 41, 3, C);
  // mottled light on the sun side of the coat, in fixed clusters
  if (k >= 0.45) {
    for (let i = 0; i < 9; i++) {
      const u = sx - 6 + hash(i * 3 + 1) * 8 - (sx - hipU) * hash(i + 40), v = 62 + hash(i * 5 + 2) * 40;
      const xx = Math.round(X(u)), yy = Math.round(Y(v));
      R(xx, yy, Math.max(1, Math.round(k * 1.5)), Math.max(1, Math.round(k)), Cl);
    }
  }
  // neck, head (sack), hat
  const scan = o.scan || 0, hu = sx + 3 + scan * 3, hv = 121;
  line(X(sx), Y(sv), X(hu - 1), Y(hv - 6), C, th);
  ellipse(X(hu), Y(hv), Math.max(1.5, 6.5 * k), Math.max(2, 8 * k), C, k >= 0.5 ? Cl : null);
  const tilt = (o.tilt || 0) + scan * 0.15;
  const bL = Y(hv + 6 - 13 * tilt * f), bR = Y(hv + 7 + 12 * tilt * f);
  line(X(hu - 13), bL, X(hu + 12), bR, Cd, th);
  // a slouched farmer's hat, crown dented and pushed to one side
  poly([X(hu - 7), Y(hv + 7), X(hu + 6), Y(hv + 7.5), X(hu + 5), Y(hv + 12), X(hu + 1), Y(hv + 11), X(hu - 2), Y(hv + 14), X(hu - 7), Y(hv + 12)], Cd);
  line(X(hu + 12), bR, X(hu + 14), Y(hv + 4 + 12 * tilt * f), Cd, th);
  pt(hu - 13, hv + 6); pt(hu + 14, hv + 4); pt(hu - 2, hv + 14);
  if (k >= 0.7) for (let i = -3; i <= 2; i += 2) R(Math.round(X(hu + i)), Math.round(Y(hv - 4.5)), 1, 1, p.tassel);
  // straw at the collar
  if (k >= 0.5) { R(Math.round(X(sx - 2)), Math.round(Y(sv + 2)), 1, 2, p.tassel); R(Math.round(X(sx + 2)), Math.round(Y(sv + 3)), 1, 1, p.tassel); }
  // eyes: two small lights, uneven
  const ev = o.eyes === undefined ? 1 : o.eyes;
  if (ev > 0) {
    const es = k >= 1.6 ? 3 : k >= 0.8 ? 2 : 1;
    const e1x = Math.round(X(hu + 2.5 + scan * 1.5)), e1y = Math.round(Y(hv + 1));
    const e2x = Math.round(X(hu - 1.5 + scan * 1.5)), e2y = Math.round(Y(hv - 0.2));
    if (k >= 0.5) { R(e1x - 1, e1y, es + 2, es, FIX.ember); R(e2x - 1, e2y, es + 2, es, FIX.ember); }
    R(e1x, e1y, es, es, FIX.glowHot); R(e2x, e2y, es, es, FIX.glowHot);
  }
  // front arm last; it is the one that reaches
  arm(5, 0.22 + 0.36 * Math.sin(pa), 0.5 + 0.22 * Math.sin(pa * 1.3 + 1), 30, 37, C, o.reach || 0);
  // crumbling edges: loose pixels drifting off the silhouette, reseeded 8 times a second
  const tq = Math.floor(t * 8), rad = Math.max(2, 3.5 * k), ps = k >= 1.6 ? 2 : 1;
  for (let i = 0; i < _crumble.length; i += 2) {
    for (let j = 0; j < 3; j++) {
      const hh = hash2(tq * 31 + i, j), a = hh * TAU, d = 1.5 + hash2(i, tq + j * 7) * rad;
      R(Math.round(_crumble[i] + Math.cos(a) * d - (j === 2 ? d * 0.6 : 0)), Math.round(_crumble[i + 1] + Math.sin(a) * d - d * 0.4), ps, ps, j ? C : Cd);
    }
  }
}

// ---------- obstacles ----------
function drawPumpkin(x, y, size, p, lit) {
  const rx = 4 + size, ry = 3 + size;
  ellipse(x, y - ry, rx, ry, p.pumpkin, p.pumpkinLit);
  R(x - 2, y - ry * 2 + 1, 1, ry * 2 - 1, p.pumpkinDark);
  R(x + 2, y - ry * 2 + 1, 1, ry * 2 - 1, p.pumpkinDark);
  R(x - rx, y - 1, rx * 2 + 1, 1, p.pumpkinDark);
  R(x, y - ry * 2 - 1, 1, 2, p.woodDark); R(x + 1, y - ry * 2 - 2, 1, 1, p.woodDark);
  if (lit > 0) {
    R(x - 3, y - ry - 1, 2, 1, FIX.glowHot); R(x + 1, y - ry - 1, 2, 1, FIX.glowHot);
    R(x - 2, y - ry + 2, 5, 1, FIX.glow); R(x - 1, y - ry + 1, 1, 1, FIX.glow); R(x + 1, y - ry + 1, 1, 1, FIX.glow);
  }
}
const WIRE = '#b49a82';
function drawObstacle(f, sx, ex, L, p, t) {
  const y = L.yFeet;
  if (f.v === 'pumpkin') drawPumpkin(Math.round((sx + ex) / 2), y + 1, 0, p, f.lit || 0);
  else if (f.v === 'root') {
    const w = ex - sx;
    line(sx, y, sx + w * 0.25, y - 4, p.woodDark, 2); line(sx + w * 0.25, y - 4, sx + w * 0.55, y - 2, p.woodDark, 2);
    line(sx + w * 0.55, y - 2, sx + w * 0.8, y - 5, p.woodDark, 2); line(sx + w * 0.8, y - 5, ex, y, p.woodDark, 2);
    line(sx + w * 0.25, y - 5, sx + w * 0.5, y - 3, p.wood, 1); line(sx + w * 0.75, y - 6, sx + w * 0.85, y - 6, p.wood, 1);
  } else if (f.v === 'board') {
    line(sx - 1, y, ex, y - 5, p.woodDark, 3); line(sx, y - 1, ex - 1, y - 5, p.wood, 1);
    line(sx + 2, y - 4, ex + 1, y + 1, p.woodDark, 2); R(Math.round(sx + 5), y - 3, 1, 1, WIRE);
  } else if (f.v === 'pit') {
    const cx = (sx + ex) / 2, rx = (ex - sx) / 2;
    ellipse(cx, y - 1, rx, 3, p.groundDark);
    ellipse(cx, y, rx - 1, 2, FIX.ink);
    R(Math.round(sx + 1), y - 4, Math.round(ex - sx) - 1, 1, p.groundLit);
    R(Math.round(cx - rx * 0.4), y + 3, Math.round(rx * 0.9), 1, p.groundLit);
  } else if (f.v === 'wire') {
    for (const px of [sx, ex]) { R(Math.round(px), y - 22, 2, 23, p.woodDark); R(Math.round(px), y - 22, 1, 23, p.wood); R(Math.round(px) - 1, y - 23, 4, 1, p.woodDark); }
    const mid = (sx + ex) / 2;
    line(sx + 1, y - 18, mid, y - 15, WIRE, 1); line(mid, y - 15, ex + 1, y - 17, WIRE, 1);
    line(sx + 1, y - 9, mid, y - 5, p.woodDark, 1); line(mid, y - 5, ex + 1, y - 8, p.woodDark, 1);
    for (let i = 3; i < ex - sx - 1; i += 4) { const yy = Math.round(lerp(y - 18, y - 15, Math.min(1, i / (mid - sx)))); R(Math.round(sx + i), yy - 1, 1, 3, WIRE); R(Math.round(sx + i) - 1, yy, 3, 1, WIRE); }
  } else if (f.v === 'harrow') {
    const RUST = p.pumpkinDark;
    for (let a = 0; a < 8; a++) R(Math.round(sx + 3 + Math.cos(a * 0.785) * 5), Math.round(y - 5 + Math.sin(a * 0.785) * 5), 1, 1, p.woodDark);
    line(sx + 3, y - 5, sx + 3, y - 5, p.woodDark, 2);
    line(sx + 2, y - 14, ex + 2, y - 17, RUST, 2);
    line(sx + 3, y - 10, sx + 3, y - 14, p.woodDark, 1);
    for (let i = 0; i < ex - sx; i += 3) {
      const yy = Math.round(lerp(y - 14, y - 17, i / (ex - sx)));
      line(sx + 2 + i, yy, sx + 5 + i, yy + 4, RUST, 1); R(Math.round(sx + 5 + i), yy + 4, 1, 1, WIRE);
    }
  }
}

// ---------- farm debris in the back row ----------
function drawProp(pr, x, L, p, t) {
  const base = L.yFeet - 6;
  if (pr.k === 'scarecrow') {
    const top = base - 32;
    R(x, top, 2, base - top, p.woodDark);
    R(x - 9, top + 9, 20, 2, p.woodDark);
    poly([x - 7, top + 8, x + 9, top + 8, x + 7, top + 22, x + 4, top + 19, x + 1, top + 24, x - 2, top + 19, x - 6, top + 22], p.sil);
    R(x - 10, top + 10, 2, 3, p.tassel); R(x + 10, top + 10, 2, 3, p.tassel);
    const lk = Math.round(pr.look || 0);
    ellipse(x + 1 + lk, top + 2, 3, 4, p.wood, p.tassel);
    R(x - 4 + lk, top - 2, 11, 1, p.woodDark); R(x - 1 + lk, top - 5, 5, 3, p.woodDark);
    if (Math.abs(pr.look || 0) > 0.5) { R(x + lk * 2, top + 1, 1, 1, FIX.ink); R(x + 2 + lk * 2, top + 1, 1, 1, FIX.ink); }
  } else if (pr.k === 'cart') {
    poly([x - 12, base - 13, x + 10, base - 10, x + 10, base - 5, x - 12, base - 8], p.wood);
    line(x - 12, base - 13, x + 10, base - 10, p.woodDark, 1);
    line(x + 10, base - 9, x + 22, base - 2, p.woodDark, 1);
    for (let a = 0; a < 12; a++) R(Math.round(x - 2 + Math.cos(a * 0.52) * 6), Math.round(base - 6 + Math.sin(a * 0.52) * 6), 1, 1, p.woodDark);
    line(x - 2, base - 12, x - 2, base, p.woodDark, 1); line(x - 8, base - 6, x + 4, base - 6, p.woodDark, 1);
  } else if (pr.k === 'fence') {
    for (let i = 0; i < 3; i++) { const px = x + i * 8, h = 12 + (hash(pr.seed + i) * 5 | 0); R(px, base - h, 2, h, p.woodDark); R(px, base - h, 1, 1, p.wood); }
    line(x, base - 9, x + 9, base - 10, p.wood, 1); line(x + 9, base - 6, x + 17, base - 2, p.wood, 1); line(x, base - 5, x + 8, base - 5, p.woodDark, 1);
  } else if (pr.k === 'post' || pr.k === 'lantern') {
    R(x, base - 30, 1, 30, p.woodDark); R(x - 4, base - 30, 9, 1, p.woodDark);
    if (pr.k === 'lantern') {
      R(x + 3, base - 29, 1, 3, p.woodDark);
      const fl = Math.sin(t * 13 + pr.seed) > -0.7 ? FIX.glow : FIX.ember;
      for (let yy = -4; yy <= 4; yy++) for (let xx = -4; xx <= 4; xx++) if (((xx + yy) & 1) === 0 && xx * xx + yy * yy < 18 && xx * xx + yy * yy > 3) R(x + 3 + xx, base - 24 + yy, 1, 1, p.pumpkinLit);
      R(x + 2, base - 26, 3, 4, p.woodDark); R(x + 3, base - 25, 1, 2, fl);
    } else { line(x - 4, base - 30, x - 6, base - 22, WIRE, 1); }
  }
}
