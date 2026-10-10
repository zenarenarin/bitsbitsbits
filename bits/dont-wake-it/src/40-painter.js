// ---- Painter: turns an anatomy layer into painted, cached tiles -------------
// Per tile:
//   1. Sample sd / relief / material on a grid (with margin for brush reach).
//   2. Light the relief (low sun from the upper left), darken creases,
//      warm the rims and push fog in by depth: a soft painted under-layer.
//   3. Lay fur locks along the anatomy's flow (down the body, outward at the
//      silhouette so edges break up into fur), then moss, spire streaks and
//      rooted props.
// Marks are seeded by world cell, so tile borders are invisible.

const LIGHT = (() => {
  const v = [0.52 * SUN_SIDE, 0.52, 0.68];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const LIGHT2 = (() => {
  const l = Math.hypot(LIGHT[0], LIGHT[1]);
  return [LIGHT[0] / l, LIGHT[1] / l];
})();

function fogColor(y) {
  return mixRGB(PAL.mistWarm, PAL.mistCool, smoothstep(40, 420, y));
}

const TILE = 512;

class FieldGrid {
  constructor(anat, prims, x0, yTop, step, n, mg) {
    const N = n + 2 * mg;
    this.N = N; this.n = n; this.mg = mg; this.step = step; this.x0 = x0; this.yTop = yTop;
    this.sd = new Float32Array(N * N);
    this.h = new Float32Array(N * N);
    this.mat = new Uint8Array(N * N);
    this.prim = new Array(N * N);
    const o = {};
    let any = false;
    for (let j = 0; j < N; j++) {
      const Y = yTop - (j - mg + 0.5) * step;
      for (let i = 0; i < N; i++) {
        const X = x0 + (i - mg + 0.5) * step;
        anat.eval(X, Y, prims, o);
        const idx = j * N + i;
        this.sd[idx] = o.sd;
        this.h[idx] = o.h;
        this.mat[idx] = o.mat;
        this.prim[idx] = o.prim;
        if (o.sd < 2) any = true;
      }
    }
    this.any = any;
    this.cav = this.cavity(Math.max(1, Math.round(1.3 / step)));
  }

  // Box-blurred relief minus relief: positive in creases and folds.
  cavity(r) {
    const N = this.N, src = this.h, tmp = new Float32Array(N * N), out = new Float32Array(N * N);
    const pass = (from, to, horizontal) => {
      for (let a = 0; a < N; a++) {
        let sum = 0, cnt = 0;
        const at = (b) => (horizontal ? a * N + b : b * N + a);
        for (let b = 0; b < Math.min(r, N); b++) { sum += Math.max(from[at(b)], 0); cnt++; }
        for (let b = 0; b < N; b++) {
          if (b + r < N) { sum += Math.max(from[at(b + r)], 0); cnt++; }
          if (b - r - 1 >= 0) { sum -= Math.max(from[at(b - r - 1)], 0); cnt--; }
          to[at(b)] = sum / cnt;
        }
      }
    };
    pass(src, tmp, true);
    pass(tmp, out, false);
    for (let i = 0; i < N * N; i++) out[i] = out[i] - Math.max(src[i], 0);
    return out;
  }

  index(X, Y) {
    const i = Math.floor((X - this.x0) / this.step + this.mg);
    const j = Math.floor((this.yTop - Y) / this.step + this.mg);
    if (i < 1 || j < 1 || i >= this.N - 1 || j >= this.N - 1) return -1;
    return j * this.N + i;
  }

  // Relief normal (camera-facing 3D) and silhouette normal (in-plane, outward).
  normals(idx, out) {
    const N = this.N, s2 = this.step * 2, h = this.h, hc = h[idx];
    const p = this.prim[idx];
    if (p && p.fall > 3) {
      // Stacked forms are lit from their own shape so their edges never alias.
      const X = this.x0 + ((idx % N) - this.mg + 0.5) * this.step;
      const Y = this.yTop - (Math.floor(idx / N) - this.mg + 0.5) * this.step;
      const e = this.step;
      const gx = (primRelief(p, X + e, Y) - primRelief(p, X - e, Y)) / s2;
      const gy = (primRelief(p, X, Y + e) - primRelief(p, X, Y - e)) / s2;
      const l = Math.min(Math.hypot(gx, gy, 1), 6);
      const g = Math.hypot(gx, gy) || 1;
      const nz = 1 / l, inPlane = Math.sqrt(Math.max(0, 1 - nz * nz));
      out.nx = (-gx / g) * inPlane; out.ny = (-gy / g) * inPlane; out.nz = nz;
      const sx = (this.sd[idx + 1] - this.sd[idx - 1]) / s2;
      const sy = (this.sd[idx - N] - this.sd[idx + N]) / s2;
      const sl = Math.hypot(sx, sy) || 1;
      out.ox = sx / sl; out.oy = sy / sl;
      return out;
    }
    // A jump bigger than J is the edge of a form stacked in front (ear, spire,
    // mushroom); treat it as a cliff, not a slope, so edges do not alias.
    const J = 1.5;
    const side = (v) => (Math.abs(v - hc) > J ? hc : v);
    const hx = (side(h[idx + 1]) - side(h[idx - 1])) / s2;
    const hy = (side(h[idx - N]) - side(h[idx + N])) / s2;
    let l = Math.hypot(hx, hy, 1);
    out.nx = -hx / l; out.ny = -hy / l; out.nz = 1 / l;
    const sx = (this.sd[idx + 1] - this.sd[idx - 1]) / s2;
    const sy = (this.sd[idx - N] - this.sd[idx + N]) / s2;
    l = Math.hypot(sx, sy) || 1;
    out.ox = sx / l; out.oy = sy / l;
    return out;
  }
}

// Lit surface colour for one grid sample (before fog).
function surfaceColor(F, idx, X, Y, seed, nrm) {
  F.normals(idx, nrm);
  const mat = F.mat[idx];
  const lam = nrm.nx * LIGHT[0] + nrm.ny * LIGHT[1] + nrm.nz * LIGHT[2];
  const cav = F.cav[idx];
  let t = 0.14 + lam * 0.98;
  t -= clamp(cav * 0.13, 0, 0.5);
  t += clamp(-cav * 0.05, 0, 0.08);
  t += (fbm(X * 0.11, Y * 0.11, seed, 3) - 0.5) * 0.26;
  const edge = 1 - nrm.nz;
  let c;
  if (mat === MAT_SPIRE) {
    const p = F.prim[idx];
    const ax = p.bx - p.ax, ay = p.by - p.ay, al = Math.hypot(ax, ay);
    const along = ((X - p.ax) * ax + (Y - p.ay) * ay) / al;
    const across = ((X - p.ax) * ay - (Y - p.ay) * ax) / al;
    t += (vnoise(across * 1.6, along * 0.08, seed + 7) - 0.5) * 0.22;
    c = ramp(PAL.spire, t + 0.08);
  } else if (mat === MAT_EAR || mat === MAT_SKIN) {
    c = ramp(PAL.skin, t + 0.05);
    if (mat === MAT_EAR) {
      const p = F.prim[idx];
      const vx = p.bx - p.ax, vy = p.by - p.ay;
      const u = clamp(((X - p.ax) * vx + (Y - p.ay) * vy) / (vx * vx + vy * vy), 0, 1);
      const dx = X - (p.ax + vx * u), dy = Y - (p.ay + vy * u);
      const r = p.ra + (p.rb - p.ra) * u;
      const inner = 1 - Math.hypot(dx, dy) / r;
      c = mixRGB(c, shade(PAL.earInner, (t - 0.55) * 0.5), smoothstep(0.32, 0.75, inner) * 0.75 * smoothstep(0.02, 0.15, u));
    }
  } else {
    c = ramp(PAL.fur, t);
    c = mixRGB(c, PAL.furBounce, clamp(-nrm.ny, 0, 1) * edge * 0.35);
  }
  const rim = edge * clamp(nrm.nx * LIGHT2[0] + nrm.ny * LIGHT2[1], 0, 1) * smoothstep(-2.5, 0, F.sd[idx]);
  c = mixRGB(c, PAL.furRim, rim * 0.55);
  nrm.t = t;
  return c;
}

function finishColor(c, Y, L) {
  if (L.valueShift) c = shade(c, L.valueShift);
  if (L.fog) c = mixRGB(c, fogColor(Y), L.fog);
  return c;
}

function paintAnatomyTile(tg, x0, yTop, k, L, world) {
  const anat = L.anatomy;
  const T = TILE;
  const span = T / k;
  const reach = furReach(L, k);
  const margin = reach + 1.6;
  const prims = anat.cull(x0 - margin, yTop - span - margin, x0 + span + margin, yTop + margin);
  const hasProps = L.props && propsInRect(world, x0 - 6, yTop - span - 6, x0 + span + 6, yTop + 6);
  if (!prims.length && !hasProps) return false;

  const gp = L.gridPx;
  const step = gp / k;
  const n = Math.ceil(T / gp);
  const mg = Math.ceil(margin / step);
  const F = new FieldGrid(anat, prims, x0, yTop, step, n, mg);
  if (!F.any && !hasProps) return false;
  const nrm = {};
  const seed = world.seed + L.seedOffset;

  // 1-2. Painted under-layer at grid resolution, upscaled smoothly.
  const iw = n + 2;
  const img = makeCanvas(iw, iw);
  const ig = img.getContext("2d");
  const data = ig.createImageData(iw, iw);
  for (let j = 0; j < iw; j++) {
    const gj = mg - 1 + j;
    const Y = yTop - (gj - mg + 0.5) * step;
    for (let i = 0; i < iw; i++) {
      const gi = mg - 1 + i;
      const idx = gj * F.N + gi;
      const sd = F.sd[idx];
      const a = clamp(0.5 - (sd + 0.08) / step, 0, 1);
      if (a <= 0 || F.mat[idx] === MAT_SHROOM) continue;
      const X = x0 + (gi - mg + 0.5) * step;
      const c = finishColor(surfaceColor(F, idx, X, Y, seed, nrm), Y, L);
      const o = (j * iw + i) * 4;
      data.data[o] = c[0]; data.data[o + 1] = c[1]; data.data[o + 2] = c[2]; data.data[o + 3] = a * 255;
    }
  }
  ig.putImageData(data, 0, 0);
  tg.imageSmoothingEnabled = true;
  tg.imageSmoothingQuality = "low"; // bilinear: higher filters ring at alpha edges
  tg.drawImage(img, -gp, -gp, iw * gp, iw * gp);

  const toPx = (X, Y) => [(X - x0) * k, (yTop - Y) * k];

  // 3a. Fur: soft clumps with dripping tips, then a fringe at the silhouette.
  paintFur(tg, F, L, x0, yTop, k, span, seed);
  paintDrips(tg, F, L, prims, x0, yTop, k, span, seed);

  // 3b. Spire streaks: long strokes along each monolith's axis.
  const sc = Math.max(0.5, 5 / k);
  for (let cy = Math.floor((yTop - span) / sc); cy <= Math.ceil(yTop / sc); cy++) {
    for (let cx = Math.floor(x0 / sc); cx <= Math.ceil((x0 + span) / sc); cx++) {
      const r = rngFrom(hash2(cx, cy, seed + 11));
      const X = (cx + r()) * sc, Y = (cy + r()) * sc;
      const idx = F.index(X, Y);
      if (idx < 0 || F.mat[idx] !== MAT_SPIRE || F.sd[idx] > -0.2 || r() < 0.55) continue;
      const p = F.prim[idx];
      const ax = p.bx - p.ax, ay = p.by - p.ay, al = Math.hypot(ax, ay);
      const col = finishColor(shade(surfaceColor(F, idx, X, Y, seed, nrm), (r() - 0.45) * 0.25), Y, L);
      const [px, py] = toPx(X, Y);
      streak(tg, px, py, ax / al, -ay / al, (1.5 + r() * 3) * k, Math.max(0.8, 0.12 * k), col, 0.45);
    }
  }

  // 3c. Moss on upward faces and in creases (patchy, denser on the back).
  if (L.moss) {
    const mc = Math.max(0.3, 6 / k);
    for (let cy = Math.floor((yTop - span - 1) / mc); cy <= Math.ceil((yTop + 1) / mc); cy++) {
      for (let cx = Math.floor((x0 - 1) / mc); cx <= Math.ceil((x0 + span + 1) / mc); cx++) {
        const r = rngFrom(hash2(cx, cy, seed + 23));
        const X = (cx + r()) * mc, Y = (cy + r()) * mc;
        const idx = F.index(X, Y);
        if (idx < 0 || F.mat[idx] !== MAT_FUR) continue;
        const sd = F.sd[idx];
        F.normals(idx, nrm);
        const mask = fbm(X * 0.09, Y * 0.09, seed + 29, 3);
        const top = sd > -0.9 && sd < 0.05 && nrm.oy > 0.45 && mask > 0.6;
        const crease = F.cav[idx] > 0.55 && mask > 0.56 && sd < -0.6;
        if (!top && !crease) continue;
        const [px, py] = toPx(X, Y);
        const tint = (lit) => finishColor(mixRGB(ramp(PAL.moss, lit), PAL.fur[1], 0.22), Y, L);
        const count = top ? 9 + Math.floor(r() * 8) : 4;
        for (let d = 0; d < count; d++) {
          const ox = (r() - 0.5) * 0.45, h = (0.07 + r() * 0.14) * (top ? 1 : 0.6);
          const lit = clamp(0.3 + ox * 0.5 * SUN_SIDE + h * 1.5 + (r() - 0.5) * 0.3 + (crease ? -0.15 : 0), 0, 1);
          streak(tg, px + ox * k, py + 0.05 * k, (r() - 0.5) * 0.5, -1, h * k, Math.max(1, 0.035 * k), tint(lit), 0.85);
        }
      }
    }
  }

  // 3d. Props rooted on this layer (mushrooms, trees, the closed eye).
  if (hasProps) drawProps(tg, world, x0, yTop, k, L, seed);
  return true;
}

// Tile cache for one depth layer. Layer pixel space: lx = X * k, ly = -Y * k.
class PaintedLayer {
  constructor(L, world) {
    this.L = L;
    this.world = world;
    this.tiles = new Map();
    this.maxTiles = L.maxTiles || 24;
  }

  tile(tx, ty, k) {
    const key = `${k.toFixed(4)}|${tx}|${ty}`;
    if (this.tiles.has(key)) {
      const t = this.tiles.get(key);
      this.tiles.delete(key);
      this.tiles.set(key, t);
      return t;
    }
    const c = makeCanvas(TILE, TILE);
    const used = this.L.paint(c.getContext("2d"), (tx * TILE) / k, (-ty * TILE) / k, k, this.L, this.world);
    const t = used ? c : null;
    this.tiles.set(key, t);
    while (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value);
    return t;
  }

  draw(g, view) {
    const k = view.ppm * view.pr * this.L.par;
    const ox = Math.round(view.W / 2 - view.camX * k);
    const oy = Math.round(view.horizon + view.camY * k);
    const tx0 = Math.floor(-ox / TILE), tx1 = Math.floor((view.W - ox) / TILE);
    const ty0 = Math.floor(-oy / TILE), ty1 = Math.floor((view.H - oy) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tile(tx, ty, k);
        if (t) g.drawImage(t, tx * TILE + ox, ty * TILE + oy);
      }
    }
  }
}
