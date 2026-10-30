// =====================================================================
// The landscape: sky, clouds, the distant farm, and the layered field.
// Each layer scrolls at its own rate; all positions are rounded to whole
// pixels before drawing.
// =====================================================================
function computeLayout(W, H) {
  return {
    W, H,
    PX: Math.round(W * 0.42),
    yHor: Math.round(H * 0.50),
    yDist: Math.round(H * 0.505),
    yMid: Math.round(H * 0.585),
    yBack: Math.round(H * 0.645),
    yFeet: Math.round(H * 0.80),
    yFront: Math.round(H * 0.825)
  };
}

function createScene() {
  const S = { skyKey: '', sky: null, clouds: [], cloudKey: '', windmill: 0, windmillSpin: 1, figure: 0, figureX: 0, sway: [] };
  const skyCv = document.createElement('canvas');
  const sky = skyCv.getContext('2d');

  // ---- sky: flat bands joined by ordered-dither seams, a striped sun ----
  function bandColor(L, p, y) {
    const b = [0, 0.17, 0.29, 0.40].map(f => Math.round(L.H * f));
    if (y < b[1]) return p.sky0; if (y < b[2]) return p.sky1; if (y < b[3]) return p.sky2; return p.sky3;
  }
  function buildSky(L, p, stageF) {
    skyCv.width = L.W; skyCv.height = L.yHor + 2;
    const prevG = G; setTarget(sky);
    const bounds = [Math.round(L.H * 0.17), Math.round(L.H * 0.29), Math.round(L.H * 0.40)];
    const cols = [p.sky0, p.sky1, p.sky2, p.sky3];
    for (let y = 0; y < skyCv.height; y++) R(0, y, L.W, 1, bandColor(L, p, y));
    // three-row seam: 25%, 50%, 75% of the lower colour mixed into the upper band
    bounds.forEach((by, i) => {
      for (let r = 1; r <= 3; r++) {
        const y = by - r, step = r === 1 ? 1 : r === 2 ? 2 : 4;
        for (let x = (y * (r === 2 ? 1 : 3)) % step; x < L.W; x += step) R(x, y, 1, 1, cols[i + 1]);
        if (r === 1) for (let x = 1; x < L.W; x += 4) R(x, y, 1, 1, cols[i]);
      }
    });
    // the sun sits low on the left and sinks over the run
    const sr = Math.round(L.W * 0.15), sx = Math.round(L.W * 0.27);
    const sy = Math.round(lerp(L.H * 0.33, L.H * 0.50, stageF / 3));
    // halo: a checker ring of the rim colour
    for (let y = -sr - 4; y <= sr + 4; y++) for (let x = -sr - 4; x <= sr + 4; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > sr + 0.5 && d < sr + 4 && ((x + y) & 1) === 0 && sy + y < L.yHor) R(sx + x, sy + y, 1, 1, p.sunRim);
    }
    ellipse(sx, sy, sr, sr, p.sun);
    ellipse(sx - 1, sy - 1, sr - 3, sr - 3, p.sunRim);
    ellipse(sx, sy, sr - 3, sr - 3, p.sun);
    // retro slits across the lower half, cut with the sky colour behind
    [[0.25, 1], [0.48, 1], [0.68, 2], [0.86, 2]].forEach(([f, t]) => {
      const y = sy + Math.round(sr * f);
      const half = Math.round(Math.sqrt(Math.max(0, sr * sr - (y - sy) * (y - sy))));
      R(sx - half - 1, y, half * 2 + 3, t, bandColor(L, p, y));
    });
    // a long cloud streak crossing the sun
    R(sx - sr - 10, sy - Math.round(sr * 0.2), sr + 6, 1, p.cloudLit);
    R(sx - sr + 4, sy - Math.round(sr * 0.2) + 2, sr + 18, 1, p.cloud);
    setTarget(prevG);
  }

  // ---- clouds: stepped shapes like the reference, flat light and shade bands ----
  const shapes = [];
  (function makeShapes() {
    const r = makeRng(77);
    for (let s = 0; s < 6; s++) {
      const w = 34 + ((r() * 40) | 0), h = 9 + ((r() * 9) | 0);
      const m = new Uint8Array(w * h);
      // stacked blocky tiers: wide base, narrower tiers on top, stepped edges in 2-3px runs
      let tierW = w, tierX = 0, y = h - 1;
      while (y >= 0 && tierW > 6) {
        const th = 2 + ((r() * 3) | 0);
        for (let yy = y; yy > y - th && yy >= 0; yy--) for (let x = tierX; x < tierX + tierW; x++) m[yy * w + x] = 1;
        y -= th;
        const shrink = 4 + ((r() * 8) | 0);
        tierX += (r() * shrink) | 0; tierW -= shrink;
        tierW = Math.min(tierW, w - tierX);
      }
      shapes.push({ w, h, m, cv: document.createElement('canvas') });
    }
  })();
  function paintClouds(p) {
    for (const s of shapes) {
      s.cv.width = s.w; s.cv.height = s.h;
      const g = s.cv.getContext('2d'); const pg = G; setTarget(g);
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (!s.m[y * s.w + x]) continue;
        const up = y > 0 && s.m[(y - 1) * s.w + x], up2 = y > 1 && s.m[(y - 2) * s.w + x];
        const dn = y < s.h - 1 && s.m[(y + 1) * s.w + x];
        R(x, y, 1, 1, !up ? p.cloudLit : !up2 && x % 3 !== 0 ? p.cloudLit : !dn ? p.cloudDark : p.cloud);
      }
      setTarget(pg);
    }
  }
  const cloudSlots = [];
  for (let i = 0; i < 9; i++) cloudSlots.push({ s: i % shapes.length, x: i * 47 + hash(i) * 30, y: 0.05 + hash(i + 9) * 0.27, par: 0.02 + hash(i + 3) * 0.03 });

  S.drawSky = function (L, p, stageF, camPx, t) {
    if (S.skyKey !== p.key + L.W + 'x' + L.H) { buildSky(L, p, stageF); S.skyKey = p.key + L.W + 'x' + L.H; }
    G.drawImage(skyCv, 0, 0);
    if (S.cloudKey !== p.key) { paintClouds(p); S.cloudKey = p.key; }
    const wrap = L.W + 160;
    for (const c of cloudSlots) {
      const sh = shapes[c.s];
      let x = (c.x - camPx * c.par - t * 0.8) % wrap; if (x < 0) x += wrap;
      G.drawImage(sh.cv, Math.round(x - 80), Math.round(c.y * L.H));
    }
  };

  // ---- distant farm: low hills, crooked trees, a windmill, a farmhouse ----
  function hillNear(wx) { return 3 + 2.5 * Math.sin(wx * 0.021 + 1) + 1.5 * Math.sin(wx * 0.057); }
  function hillFar(wx) { return 6 + 4 * Math.sin(wx * 0.011 + 2) + 2 * Math.sin(wx * 0.033 + 0.5); }
  function tree(x, y, sd, c) {
    const r = makeRng(sd); const h = 9 + ((r() * 8) | 0), lean = (r() - 0.5) * 6;
    line(x, y, x + lean, y - h, c, 1); line(x + 1, y, x + 1 + lean * 0.6, y - h * 0.6, c, 1);
    for (let i = 0; i < 4; i++) {
      const f = 0.45 + r() * 0.5, bx = x + lean * f, by = y - h * f, dir = r() < 0.5 ? -1 : 1, len = 3 + r() * 6;
      const ex = bx + dir * len, ey = by - len * (0.3 + r() * 0.6);
      line(bx, by, ex, ey, c, 1);
      line(ex, ey, ex + dir * 2, ey - 2 - r() * 2, c, 1);
    }
  }
  function windmill(x, y, c, ang, lit) {
    poly([x - 3, y, x + 4, y, x + 2, y - 17, x - 1, y - 17], c);
    R(x - 2, y - 19, 5, 2, c);
    const hx = x + 0.5, hy = y - 18;
    for (let i = 0; i < 4; i++) {
      const a = ang + i * Math.PI / 2, ex = hx + Math.cos(a) * 10, ey = hy + Math.sin(a) * 10;
      line(hx, hy, ex, ey, c, 1);
      line(hx + Math.cos(a) * 4 + Math.cos(a + 1.57) * 1.5, hy + Math.sin(a) * 4 + Math.sin(a + 1.57) * 1.5, ex + Math.cos(a + 1.57) * 1.5, ey + Math.sin(a + 1.57) * 1.5, c, 1);
    }
    if (lit) R(x, y - 8, 1, 2, FIX.glow);
  }
  function farmhouse(x, y, c, sd) {
    R(x, y - 7, 12, 7, c);
    poly([x - 1, y - 7, x + 13, y - 7, x + 6, y - 13], c);
    R(x + 9, y - 13, 2, 4, c);
    R(x + 15, y - 12, 4, 12, c); ellipse(x + 17, y - 12, 2, 1, c);
    if (hash(sd) < 0.8) R(x + 3, y - 5, 2, 2, FIX.glow);
  }
  function tinyScarecrow(x, y, c) { R(x, y - 9, 1, 9, c); R(x - 3, y - 7, 7, 1, c); R(x - 1, y - 11, 3, 2, c); R(x - 2, y - 11, 5, 1, c); }

  S.drawDistance = function (L, p, camPx, t, dt) {
    const pf = camPx * 0.05, pn = camPx * 0.1;
    for (let x = 0; x < L.W; x++) {
      const h = Math.round(hillFar(x + pf));
      R(x, L.yHor - h, 1, h + 2, p.hillFar);
    }
    for (let x = 0; x < L.W; x++) {
      const h = Math.round(hillNear(x + pn));
      R(x, L.yHor - h, 1, h + 2, p.hillNear);
    }
    // props on the near hills, one decision per 52px slot
    S.windmill += dt * 0.9 * S.windmillSpin;
    const slotW = 52, i0 = Math.floor((pn - 30) / slotW), i1 = Math.floor((pn + L.W + 30) / slotW);
    for (let i = i0; i <= i1; i++) {
      const r = hash(i * 7 + 3), x = Math.round(i * slotW + hash(i + 11) * 20 - pn), y = L.yHor - Math.round(hillNear(x + pn)) + 1;
      if (r < 0.14) windmill(x, y, p.sil, S.windmill, i % 2 === 0);
      else if (r < 0.30) farmhouse(x, y, p.sil, i);
      else if (r < 0.62) { tree(x, y, i * 13, p.sil); if (r > 0.5) tree(x + 9, y, i * 17, p.sil); }
      else if (r < 0.74) tinyScarecrow(x, y, p.sil);
    }
    if (S.figure > 0) {
      // someone else standing on the ridge, gone a moment later
      const x = Math.round(S.figureX), y = L.yHor - Math.round(hillNear(x + pn));
      R(x, y - 14, 1, 14, p.sil); R(x + 1, y - 12, 1, 10, p.sil); R(x - 1, y - 16, 3, 3, p.sil);
      R(x - 1, y - 11, 1, 6, p.sil); R(x + 2, y - 11, 1, 7, p.sil);
    }
  };

  // ---- the field ----
  // Corn rows: stalk positions come from the world column index so they
  // scroll as one surface and never shimmer.
  S.swayAt = function (wx, t, extra) {
    const base = Math.sin(t * 1.3 + wx * 0.05) + Math.sin(t * 0.7 + wx * 0.013);
    return Math.round(base * 0.55 + (extra || 0));
  };
  S.drawDistCorn = function (L, p, camPx, t) {
    const off = camPx * 0.3, top = L.yDist;
    R(0, top + 2, L.W, L.yMid - top + 8, p.distCorn);
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + off), hh = hash(wx);
      if (wx % 2 === 0) { const h = 1 + ((hh * 3) | 0); R(x, top + 2 - h, 1, h, p.distCorn); R(x, top + 2 - h, 1, 1, p.distCornLit); }
    }
    // horizontal drifts of lit tassels, grouped into short dashes
    const rows = [5, 9, 14, 20];
    for (let ri = 0; ri < rows.length; ri++) {
      const y = top + rows[ri]; if (y > L.yMid + 4) break;
      const cell = 6 + ri * 2, shift = Math.floor(off * (1 + ri * 0.15));
      for (let c = Math.floor(shift / cell) - 1; c <= Math.floor((shift + L.W) / cell) + 1; c++) {
        const hh = hash2(c, ri * 31 + 5);
        if (hh < 0.45) R(c * cell - shift + ((hh * 4) | 0), y, 2 + (hh < 0.15 ? 1 : 0), 1, p.distCornLit);
        else if (hh > 0.88) R(c * cell - shift, y + 1, 1, 1, p.tassel);
      }
    }
  };
  S.drawMidCorn = function (L, p, camPx, t) {
    const off = camPx * 0.55, sp = 4;
    R(0, L.yMid + 5, L.W, L.yBack - L.yMid + 12, p.midCorn);
    const i0 = Math.floor(off / sp) - 1, i1 = Math.floor((off + L.W) / sp) + 1;
    for (let i = i0; i <= i1; i++) {
      const hh = hash(i + 1000), x = Math.round(i * sp - off + ((hh * 2) | 0));
      const top = L.yMid - 2 + ((hh * 5) | 0), sw = S.swayAt(i * 4, t);
      R(x, top + 3, 1, L.yMid + 8 - top, p.midCorn);
      R(x + sw, top, 1, 3, p.midCorn);
      R(x + sw, top, 1, 1, hh > 0.7 ? p.tassel : p.midCornLit);
      R(x - 2, top + 4 + (i & 1), 2, 1, p.midCornLit); R(x - 3, top + 5 + (i & 1), 1, 1, p.midCorn);
      R(x + 1, top + 6, 2, 1, p.midCorn); R(x + 3, top + 7, 1, 1, p.midCorn);
    }
  };
  S.drawBackRow = function (L, p, camPx, t, stir) {
    const off = camPx * 0.85, sp = 6;
    const base = L.yFeet - 5;
    R(0, L.yBack + 14, L.W, base - L.yBack - 12, p.backLeaf);
    // a band of olive stems at the base, where the red gives way to the dark
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + off);
      if (hash(wx + 7) < 0.5) R(x, base - 5 - ((hash(wx) * 4) | 0), 1, 6, p.backStalk);
    }
    const i0 = Math.floor(off / sp) - 2, i1 = Math.floor((off + L.W) / sp) + 2;
    for (let i = i0; i <= i1; i++) {
      const hh = hash(i + 5000);
      if (hh < 0.12) continue; // a gap between the stalks
      const x = Math.round(i * sp - off + ((hh * 3) | 0));
      const top = L.yBack - 4 + ((hash(i + 77) * 8) | 0);
      let ex = 0;
      if (stir && stir.t > 0 && Math.abs(i * sp - stir.x * PPM * 0.85) < 40) ex = Math.sin(t * 9 + i) * 2.2 * Math.min(1, stir.t);
      const sw = S.swayAt(i * 6, t, ex);
      R(x, top + 4, 1, base - top - 4, p.backStalk);
      R(x + sw, top, 1, 4, p.backStalk);
      // tassel
      R(x + sw - 1, top - 1, 1, 1, p.tassel); R(x + sw, top - 2, 1, 2, p.tassel); R(x + sw + 1, top - 1, 1, 1, p.tassel);
      // drooping leaves, lit on the sun side (left)
      const ly = [top + 6, top + 11, top + 17, top + 23];
      for (let k = 0; k < ly.length; k++) {
        const y = ly[k]; if (y > base - 4) break;
        const dir = (k + i) & 1 ? 1 : -1, s2 = k < 2 ? sw : 0;
        R(x + (dir < 0 ? -3 : 1) + s2, y, 3, 1, dir < 0 ? p.backLeafLit : p.backLeaf);
        R(x + (dir < 0 ? -5 : 4) + s2, y + 1, 2, 1, dir < 0 ? p.backLeafLit : p.backLeaf);
        R(x + (dir < 0 ? -6 : 6) + s2, y + 2, 1, 1, p.backLeaf);
      }
      if (hh > 0.8) { R(x + 1, top + 13, 2, 4, p.tassel); R(x + 1, top + 13, 1, 4, p.pumpkinDark); }
    }
  };
  S.drawPath = function (L, p, camPx) {
    const y0 = L.yFeet - 5;
    R(0, y0, L.W, L.yFront - y0 + 3, p.ground);
    R(0, y0, L.W, 1, p.groundDark);
    const i0 = Math.floor(camPx / 9) - 1, i1 = Math.floor((camPx + L.W) / 9) + 1;
    for (let i = i0; i <= i1; i++) {
      const x = Math.round(i * 9 - camPx), hh = hash(i + 9000);
      R(x, L.yFeet - 2, 4 + ((hh * 3) | 0), 1, p.groundDark);       // rut
      if (hh > 0.45) R(x + 3, L.yFeet + 1, 2, 1, p.groundLit);       // dry clods
      if (hh > 0.8) { R(x + 5, L.yFeet - 3, 2, 1, p.pumpkinDark); R(x + 6, L.yFeet - 4, 1, 1, p.pumpkin); } // fallen leaf
      if (hh < 0.12) { R(x + 1, L.yFeet, 2, 1, p.backLeafLit); }
    }
  };
  S.drawFront = function (L, p, camPx, t) {
    const y0 = L.yFront;
    R(0, y0 + 2, L.W, L.H - y0, p.frontDark);
    // vertical grass strands like the reference foreground: olive, a few with red tips
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + camPx * 1.0), hh = hash(wx + 300);
      const h = 2 + ((hh * 6) | 0);
      R(x, y0 + 2 - h, 1, h + 2, hh > 0.5 ? p.frontLeaf : p.frontDark);
      if (hh > 0.86) R(x, y0 + 2 - h, 1, 1, p.frontLeafLit);
      else if (hh < 0.08) R(x, y0 + 2 - h, 1, 1, p.backLeaf);
    }
    for (let x = 0; x < L.W; x++) {
      const wx = Math.floor(x + camPx * 1.15), hh = hash(wx + 900);
      if (hh < 0.35) R(x, y0 + 10 + ((hh * 10) | 0), 1, L.H, hh < 0.12 ? p.frontLeafLit : p.frontLeaf);
    }
  };
  // a hiding place: a tall, dense clump of stalks in front of the path
  S.drawClump = function (L, p, camPx, f, t, rustle) {
    const xa = Math.round(f.x0 * PPM - camPx), xb = Math.round(f.x1 * PPM - camPx);
    if (xb < -12 || xa > L.W + 12) return;
    const n = Math.max(3, Math.floor((xb - xa) / 3));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(lerp(xa, xb, k / n)), hh = hash(f.seed + k);
      const edge = Math.min(k, n - k);
      const top = L.yFeet - 15 - ((hh * 6) | 0) - Math.min(edge, 3) * 2;
      const sw = Math.round(Math.sin(t * 1.4 + k) * 0.6 + rustle * Math.sin(t * 22 + k * 1.7) * 1.5);
      R(x, top + 4, 2, L.yFront - top, p.frontLeaf);
      R(x + sw, top, 1, 5, p.frontLeaf); R(x + 1 + sw, top + 1, 1, 4, p.frontDark);
      R(x + sw, top - 2, 1, 2, p.tassel); R(x - 1 + sw, top - 1, 1, 1, p.tassel);
      const leaves = [top + 5, top + 10, top + 16];
      for (let j = 0; j < leaves.length; j++) {
        const y = leaves[j], dir = (k + j) & 1 ? 1 : -1, s2 = j === 0 ? sw : 0;
        if (dir < 0) { R(x - 3 + s2, y, 3, 1, p.frontLeafLit); R(x - 5 + s2, y + 1, 2, 1, p.frontLeaf); R(x - 6 + s2, y + 2, 1, 2, p.frontLeaf); }
        else { R(x + 2 + s2, y, 3, 1, p.frontLeaf); R(x + 5 + s2, y + 1, 2, 1, p.frontLeaf); R(x + 7 + s2, y + 2, 1, 2, p.frontDark); }
      }
      if (hh > 0.75) { R(x + 2, top + 8, 1, 3, p.backLeafLit); }
    }
  };
  return S;
}
