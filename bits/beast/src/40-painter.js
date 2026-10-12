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
  const v = [0.8 * SUN_SIDE, 0.5, 0.36];
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

// Field sample buffers are pooled by size: tiles are painted continuously
// while climbing, and reallocating megabytes per tile causes GC pauses.
const FIELD_POOL = new Map();
function takeFieldBuffers(n) {
  const list = FIELD_POOL.get(n);
  if (list && list.length) return list.pop();
  return { sd: new Float32Array(n), h: new Float32Array(n), mat: new Uint8Array(n), prim: new Array(n), cav: new Float32Array(n), tmp: new Float32Array(n) };
}
function releaseFieldBuffers(n, b) {
  if (!FIELD_POOL.has(n)) FIELD_POOL.set(n, []);
  const list = FIELD_POOL.get(n);
  if (list.length < 4) list.push(b);
}

class FieldGrid {
  constructor(x0, yTop, step, n, mg) {
    const N = n + 2 * mg;
    this.N = N; this.n = n; this.mg = mg; this.step = step; this.x0 = x0; this.yTop = yTop;
    this.buf = takeFieldBuffers(N * N);
    this.sd = this.buf.sd;
    this.h = this.buf.h;
    this.mat = this.buf.mat;
    this.prim = this.buf.prim;
    this.mat.fill(0);
    this.any = false;
  }

  release() {
    releaseFieldBuffers(this.N * this.N, this.buf);
    this.buf = this.sd = this.h = this.mat = this.prim = this.cav = null;
  }

  // Samples both fields block by block; each block only evaluates the
  // primitives near it. Yields between blocks so painting can be time-sliced.
  *fill(anat, prims) {
    const N = this.N, mg = this.mg, step = this.step, B = 16, pad = 3;
    const o = {};
    for (let bj = 0; bj < N; bj += B) {
      for (let bi = 0; bi < N; bi += B) {
        const bx0 = this.x0 + (bi - mg) * step, bx1 = bx0 + B * step;
        const by1 = this.yTop - (bj - mg) * step, by0 = by1 - B * step;
        const sub = prims.filter((p) => {
          const m = p.k * 2 + pad;
          return p.maxX + m >= bx0 && p.minX - m <= bx1 && p.maxY + m >= by0 && p.minY - m <= by1;
        });
        for (let j = bj; j < Math.min(bj + B, N); j++) {
          const Y = this.yTop - (j - mg + 0.5) * step;
          for (let i = bi; i < Math.min(bi + B, N); i++) {
            const idx = j * N + i;
            if (!sub.length) { this.sd[idx] = 1e3; this.h[idx] = -1e3; continue; }
            anat.sample(this.x0 + (i - mg + 0.5) * step, Y, sub, o);
            this.sd[idx] = o.sd;
            this.h[idx] = o.h;
            this.mat[idx] = o.mat;
            this.prim[idx] = o.prim;
            if (o.sd < 2) this.any = true;
          }
        }
        yield;
      }
    }
    yield* this.cavity(Math.max(1, Math.round(1.3 / step)));
  }

  // Box-blurred relief minus relief: positive in creases and folds.
  *cavity(r) {
    const N = this.N, src = this.h, tmp = this.buf.tmp, out = this.buf.cav;
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
    yield;
    pass(tmp, out, false);
    for (let i = 0; i < N * N; i++) out[i] = out[i] - Math.max(src[i], 0);
    this.cav = out;
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
  let t = 0.22 + lam * 0.68;
  t -= clamp(cav * 0.2, 0, 0.55);
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
  c = mixRGB(c, PAL.furRim, rim * 0.7);
  nrm.t = t;
  return c;
}

function finishColor(c, Y, L) {
  if (L.valueShift) c = shade(c, L.valueShift);
  if (L.fog) c = mixRGB(c, L.fogCool ? mixRGB(PAL.mistCool, PAL.skyMid, 0.35) : fogColor(Y), L.fog);
  return c;
}

// Paints one anatomy tile. A generator: it yields often so the scheduler
// can spread the work across frames; returns whether anything was drawn.
function* paintAnatomyTile(tg, x0, yTop, k, L, world) {
  const anat = L.anatomy;
  const T = tg.canvas.width;
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
  const F = new FieldGrid(x0, yTop, step, n, mg);
  yield* F.fill(anat, prims);
  if (!F.any && !hasProps) { F.release(); return false; }
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
    if ((j & 15) === 15) yield;
  }
  ig.putImageData(data, 0, 0);
  tg.imageSmoothingEnabled = true;
  tg.imageSmoothingQuality = "low"; // bilinear: higher filters ring at alpha edges
  tg.drawImage(img, -gp, -gp, iw * gp, iw * gp);
  discardCanvas(img);
  yield;

  const toPx = (X, Y) => [(X - x0) * k, (yTop - Y) * k];

  // 3a. Fur: brush strokes along the flow, a fringe at the silhouette, drips.
  yield* paintFur(tg, F, L, x0, yTop, k, span, seed);
  paintDrips(tg, F, L, prims, x0, yTop, k, span, seed);
  yield;
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

  yield;
  // 3d. Props rooted on this layer (mushrooms, trees, the closed eye).
  if (hasProps) drawProps(tg, world, x0, yTop, k, L, seed);
  F.release();
  return true;
}

// Runs a painting generator to completion (loading, or must-show tiles).
function runSync(gen) {
  let r;
  while (!(r = gen.next()).done);
  return r.value;
}

// Spreads tile painting across frames: jobs are generators, the most urgent
// (visible, then nearest the camera) run first, within a per-frame budget.
class PaintScheduler {
  constructor() {
    this.jobs = new Set();
  }

  request(entry, priority) {
    if (entry.done) return;
    entry.priority = Math.max(entry.priority || 0, priority);
    this.jobs.add(entry);
  }

  finish(entry) {
    if (entry.done) return;
    const t0 = performance.now();
    while (!entry.done) entry.step();
    this.syncMs = (this.syncMs || 0) + performance.now() - t0;
    this.syncCount = (this.syncCount || 0) + 1;
    this.jobs.delete(entry);
  }

  // Loading: finish what the first frame shows plus the walkable body around
  // it (priority >= 6: visible tiles, and the play layer's ring); the rest
  // streams in.
  finishVisible() {
    for (const j of [...this.jobs]) if (j.priority >= 6) this.finish(j);
  }

  pump(budgetMs) {
    const end = performance.now() + budgetMs;
    while (this.jobs.size && performance.now() < end) {
      let best = null;
      for (const j of this.jobs) if (!best || j.priority > best.priority) best = j;
      while (!best.done && performance.now() < end) best.step();
      if (best.done) this.jobs.delete(best);
    }
    for (const j of this.jobs) j.priority = 0; // re-earned by the next frame's requests
  }

  get busy() {
    return this.jobs.size > 0;
  }
}

// Tile cache for one depth layer. Layer pixel space: lx = X * k, ly = -Y * k.
// Tiles are painted with a margin (so brushwork crosses tile borders
// identically on both sides), repainted, and drawn cropped. Distant layers
// paint at reduced resolution (L.res) and are scaled up when drawn.
class PaintedLayer {
  constructor(L, world, sched) {
    this.L = L;
    this.world = world;
    this.sched = sched;
    this.tiles = new Map();
    this.maxTiles = L.maxTiles || 24;
    this.res = L.res || 1;
    this.frame = 0;
  }

  entry(tx, ty, k, pr) {
    const key = `${k.toFixed(4)}|${pr}|${tx}|${ty}`;
    let e = this.tiles.get(key);
    if (!e) {
      e = { key, done: false, canvas: null, priority: 0, used: this.frame };
      const gen = this.job(e, tx, ty, k, pr);
      e.step = () => {
        const t0 = performance.now();
        if (gen.next().done) e.done = true;
        e.ms = (e.ms || 0) + performance.now() - t0;
        if (e.done && globalThis.__dwProfile) globalThis.__dwProfile.push({ layer: this.L.name, ms: e.ms, used: !!e.canvas });
      };
      this.tiles.set(key, e);
    }
    e.used = this.frame;
    return e;
  }

  *job(e, tx, ty, k, pr) {
    const M = REPAINT_MARGIN, res = this.res, kp = k * res;
    const c = makeCanvas(Math.round((TILE + 2 * M) * res), Math.round((TILE + 2 * M) * res));
    const tg = c.getContext("2d", { willReadFrequently: true });
    const x0 = (tx * TILE - M) / k, yTop = (-ty * TILE + M) / k;
    const used = yield* this.L.paint(tg, x0, yTop, kp, this.L, this.world);
    if (used && this.L.repaint) {
      yield* repaintCanvas(tg, (tx * TILE - M) * res, (ty * TILE - M) * res,
        scaleRepaint(this.L.repaint, pr * res, this.L.flow), this.world.seed + this.L.seedOffset + 17);
    }
    if (used && this.L.props) drawPostProps(tg, this.world, x0, yTop, kp, this.L, this.world.seed + this.L.seedOffset);
    e.canvas = used ? toDrawable(c) : null;
  }

  evict() {
    if (this.tiles.size <= this.maxTiles) return;
    const old = [...this.tiles.values()].filter((e) => e.used < this.frame).sort((a, b) => a.used - b.used);
    for (const e of old) {
      if (this.tiles.size <= this.maxTiles) break;
      this.tiles.delete(e.key);
      this.sched.jobs.delete(e);
      if (e.canvas && e.canvas.close) e.canvas.close();
      else discardCanvas(e.canvas);
    }
  }

  // Requests (without drawing) every tile a view will need: used to paint a
  // view in the background before cutting to it.
  request(view, priority) {
    const k = view.ppm * view.pr * this.L.par;
    const ox = Math.round(view.W / 2 - view.camX * k);
    const oy = Math.round(view.horizon + view.camY * k);
    for (let ty = Math.floor(-oy / TILE); ty <= Math.floor((view.H - oy) / TILE); ty++) {
      for (let tx = Math.floor(-ox / TILE); tx <= Math.floor((view.W - ox) / TILE); tx++) {
        const e = this.entry(tx, ty, k, view.pr);
        e.used = this.frame + 1; // keep through the next draw's eviction
        if (!e.done) this.sched.request(e, priority);
      }
    }
  }

  // Draws ready tiles, requests missing ones (visible first, then a one-tile
  // ring ahead of the camera). Must-show layers finish visible tiles now.
  draw(g, view, mustShow) {
    this.frame++;
    const k = view.ppm * view.pr * this.L.par;
    const ox = Math.round(view.W / 2 - view.camX * k);
    const oy = Math.round(view.horizon + view.camY * k);
    const tx0 = Math.floor(-ox / TILE), tx1 = Math.floor((view.W - ox) / TILE);
    const ty0 = Math.floor(-oy / TILE), ty1 = Math.floor((view.H - oy) / TILE);
    const M = REPAINT_MARGIN * this.res, S = TILE * this.res;
    const cx = (view.W / 2 - ox) / TILE, cy = (view.H / 2 - oy) / TILE;
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        const visible = ty >= ty0 && ty <= ty1 && tx >= tx0 && tx <= tx1;
        const e = this.entry(tx, ty, k, view.pr);
        if (!e.done) {
          const near = 1 / (1 + Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy));
          this.sched.request(e, (visible ? 10 : 1) + near + (this.L.urgency || 0));
          if (visible && mustShow) this.sched.finish(e);
        }
        if (visible && e.done && e.canvas) g.drawImage(e.canvas, M, M, S, S, tx * TILE + ox, ty * TILE + oy, TILE, TILE);
      }
    }
    // Paint ahead: the tiles the camera will reach soon (its predicted view).
    if (view.aheadX || view.aheadY) {
      const ax = Math.round(view.aheadX * this.L.par), ay = Math.round(view.aheadY * this.L.par);
      const fx0 = Math.floor((ax - ox) / TILE), fx1 = Math.floor((view.W + ax - ox) / TILE);
      const fy0 = Math.floor((ay - oy) / TILE), fy1 = Math.floor((view.H + ay - oy) / TILE);
      for (let ty = fy0; ty <= fy1; ty++) {
        for (let tx = fx0; tx <= fx1; tx++) {
          const e = this.entry(tx, ty, k, view.pr);
          if (!e.done) this.sched.request(e, 3 + (this.L.urgency || 0));
        }
      }
    }
    this.evict();
  }
}
