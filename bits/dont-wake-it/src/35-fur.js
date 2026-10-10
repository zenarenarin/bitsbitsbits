// ---- Fur: soft clumps, dripping tips, and a broken silhouette fringe ---------
// The reference fur is not hair noise: it is large, soft, rounded clumps lit
// on top and lavender underneath, ending in pointed tips that hang over the
// clump below. Fine detail lives at clump tips and at the silhouette only.

function clumpCell(L, k) { return Math.max(L.clumpCell, L.minClumpPx / k); }
function fringeCell(L, k) { return Math.max(L.fringeCell, L.minLockPx / k); }
function furReach(L, k) { return Math.max(clumpCell(L, k) * 3.2, fringeCell(L, k) * 4); }

// Flow: toward the tail, falling with gravity, combed outward at the
// silhouette and around relief forms.
function furDir(F, idx, nrm, L, X, Y, seed, edge, jitter) {
  F.normals(idx, nrm);
  const fl = L.flow || [0, -1];
  let dx = fl[0] * 0.75 + nrm.ox * edge * 0.95 - nrm.nx * 0.2;
  let dy = fl[1] * 0.75 - 0.45 + nrm.oy * edge * 0.95 - nrm.ny * 0.2;
  const ang = (vnoise(X * 0.28, Y * 0.28, seed + 3) - 0.5) * 0.8 + jitter;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
  const l = Math.hypot(rx, ry) || 1;
  return [rx / l, ry / l];
}

// Lit colour at a world point, falling back toward the body interior when the
// point is off the fur (so fringe locks never sample empty sky).
function furColorAt(F, X, Y, seed, nrm, fallbackIdx) {
  let idx = F.index(X, Y);
  if (idx < 0 || F.sd[idx] > -0.05 || F.mat[idx] !== MAT_FUR) idx = fallbackIdx;
  const c = surfaceColor(F, idx, X, Y, seed, nrm);
  return { c, t: nrm.t };
}

// A tapered curved brush stroke (wide at the root, thin at the tip).
function g2Stroke(g, x, y, dx, dy, len, w, bend, col, alpha) {
  const px = -dy, py = dx;
  const tx = x + dx * len + px * bend * len, ty = y + dy * len + py * bend * len;
  const mx = x + dx * len * 0.5 + px * bend * len * 0.6, my = y + dy * len * 0.5 + py * bend * len * 0.6;
  g.beginPath();
  g.moveTo(x - px * w * 0.5, y - py * w * 0.5);
  g.quadraticCurveTo(mx - px * w * 0.35, my - py * w * 0.35, tx, ty);
  g.quadraticCurveTo(mx + px * w * 0.35, my + py * w * 0.35, x + px * w * 0.5, y + py * w * 0.5);
  g.arc(x, y, w * 0.5, Math.atan2(py, px), Math.atan2(py, px) + Math.PI);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function paintFur(tg, F, L, x0, yTop, k, span, seed) {
  const nrm = {};
  const toPx = (X, Y) => [(X - x0) * k, (yTop - Y) * k];
  const reach = furReach(L, k);

  // Pass A: brush strokes. Short opaque streaks along the fur flow, a
  // little lighter on lit forms and a little darker in shade, so the fur
  // reads as gouache texture over the big lit forms beneath.
  const C = clumpCell(L, k);
  for (let cy = Math.floor((yTop - span - reach) / C); cy <= Math.ceil((yTop + reach) / C); cy++) {
    for (let cx = Math.floor((x0 - reach) / C); cx <= Math.ceil((x0 + span + reach) / C); cx++) {
      const r = rngFrom(hash2(cx, cy, seed));
      const X = (cx + r()) * C, Y = (cy + r()) * C;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_FUR || F.sd[idx] > -0.05) continue;
      const edge = 1 - smoothstep(0, 2.2, -F.sd[idx]);
      const [dx, dy] = furDir(F, idx, nrm, L, X, Y, seed, edge, (r() - 0.5) * 0.35);
      const base = surfaceColor(F, idx, X, Y, seed, nrm);
      const lit = nrm.t;
      const dv = (lit > 0.55 ? 0.1 : -0.08) + (r() - 0.5) * 0.16;
      const col = finishColor(shade(lit > 0.6 && r() < 0.3 ? mixRGB(base, PAL.furRim, 0.35) : base, dv), Y, L);
      const len = C * (2.2 + r() * 2.2) * k;
      const w = Math.max(1, C * (0.32 + r() * 0.3) * k);
      const [px, py] = toPx(X, Y);
      const bend = (r() - 0.5) * 0.25;
      g2Stroke(tg, px, py, dx, -dy, len, w, bend, col, 0.62 + r() * 0.3);
    }
  }

  // Pass B: silhouette fringe - small locks combed outward so the edge of the
  // body breaks up into fur instead of a hard outline.
  const f = fringeCell(L, k);
  for (let cy = Math.floor((yTop - span - reach) / f); cy <= Math.ceil((yTop + reach) / f); cy++) {
    for (let cx = Math.floor((x0 - reach) / f); cx <= Math.ceil((x0 + span + reach) / f); cx++) {
      const r = rngFrom(hash2(cx, cy, seed + 5));
      const X = (cx + r()) * f, Y = (cy + r()) * f;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_FUR) continue;
      const sd = F.sd[idx];
      if (sd > 0.05 || sd < -0.9) continue;
      const [dx, dy] = furDir(F, idx, nrm, L, X, Y, seed, 1, (r() - 0.5) * 0.5);
      const inner = F.index(X - nrm.ox * 0.6, Y - nrm.oy * 0.6);
      const col = furColorAt(F, X - nrm.ox * 0.6, Y - nrm.oy * 0.6, seed, nrm, inner < 0 ? idx : inner);
      const c = finishColor(shade(col.c, (r() - 0.5) * 0.12), Y, L);
      const [px, py] = toPx(X, Y);
      drawLock(tg, px, py, dx, -dy, f * (2.2 + r() * 1.6) * k, f * (0.2 + r() * 0.16) * k, (r() - 0.5) * 0.5, c, 0.92);
    }
  }
}

// Scalloped drips under every fur form (shelves, belly lobes, interior
// masses): pointed locks hang from each form's lower edge over the shadow
// beneath it - the signature edge of the reference fur.
function paintDrips(tg, F, L, prims, x0, yTop, k, span, seed) {
  const nrm = {};
  const spacing = Math.max(L.fringeCell * 0.75, 6 / k);
  const flow = L.flow || [0, -1];
  for (const p of prims) {
    if (p.kind !== ELL || p.mat !== MAT_FUR || (p.tag !== "shelf" && p.tag !== "lobe")) continue;
    if (p.maxX < x0 - 2 || p.minX > x0 + span + 2 || p.maxY < yTop - span - 3 || p.minY > yTop + 3) continue;
    const arc = Math.PI * (p.a + p.b) * 0.42;
    const n = Math.max(3, Math.round(arc / spacing));
    for (let i = 0; i <= n; i++) {
      const r = rngFrom(hash2(p.id * 977 + i, p.id, seed + 9));
      const th = Math.PI * (1.08 + 0.84 * (i + (r() - 0.5) * 0.6) / n);
      const lx = Math.cos(th) * p.a * 0.97, ly = Math.sin(th) * p.b * 0.97;
      const X = p.cx + lx * p.cos - ly * p.sin, Y = p.cy + lx * p.sin + ly * p.cos;
      const idx = F.index(X, Y);
      if (idx < 0) continue;
      // Only where this form is the visible surface (not buried in the body).
      const own = p.hz * 0.24 + p.base;
      if (F.h[idx] > own + 0.35 || F.sd[idx] < -1.4) continue;
      const inner = F.index(X - (lx * p.cos - ly * p.sin) * 0.25, Y - (lx * p.sin + ly * p.cos) * 0.25);
      const col = furColorAt(F, X, Y + p.b * 0.25, seed, nrm, inner < 0 ? idx : inner);
      let dx = flow[0] * 0.35 + Math.cos(th) * 0.2 + (r() - 0.5) * 0.3, dy = -1;
      const dl = Math.hypot(dx, dy);
      dx /= dl; dy /= dl;
      const len = Math.max(p.b * (0.45 + r() * 0.55), 12 / k);
      const w = spacing * (0.4 + r() * 0.25);
      const c0 = finishColor(shade(col.c, (r() - 0.5) * 0.08), Y, L);
      const c1 = finishColor(shade(mixRGB(col.c, PAL.fur[1], 0.15), -0.06), Y - len, L);
      const px = (X - x0) * k, py = (yTop - Y) * k;
      const sx = px - dx * len * k * 0.35, sy = py + dy * len * k * 0.35;
      const grad = tg.createLinearGradient(sx, sy, px + dx * len * k, py - dy * len * k);
      grad.addColorStop(0, css(c0, 0.95));
      grad.addColorStop(1, css(c1, 0.95));
      lockPath(tg, sx, sy, dx, -dy, len * k * 1.35, w * k, (r() - 0.5) * 0.35);
      tg.fillStyle = grad;
      tg.fill();
    }
  }
}

