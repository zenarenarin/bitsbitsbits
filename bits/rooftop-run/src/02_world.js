// =====================================================================
// Collision world. Every solid is a shape with an axis-aligned bound
// (x0..x1, y0..y1, z0..z1) and a height function for its top:
//   box     flat top at y1
//   gableZ  pitched roof, ridge running along z (slopes fall away in x)
//   gableX  pitched roof, ridge running across (slopes fall away in z)
//   shed    lean-to roof, height runs linearly from yNear (z1) to yFar (z0)
//   pipeZ   a cylinder along z: centre (cx, cy), radius r; with cyFar it inclines
//           (cy at the near end z1, cyFar at the far end z0)
// Moving surfaces carry offsets: dy (a walkway giving way), dx (a bridge swaying).
// Slopes and pipe curvature are real collision, not decoration: the cat
// stands on the height function and feels its gradient.
// Tags: kind (what the renderer builds), surface, walk, cam ('block' |
// 'fade' | 'none'), far (scenery: landing there is a fall).
// =====================================================================

class World {
  constructor() { this.boxes = []; this.cell = 8; this.grid = new Map(); }
  add(b) {
    b.shape = b.shape || 'box';
    b.id = this.boxes.length;
    this.boxes.push(b);
    for (let cz = Math.floor(b.z0 / this.cell); cz <= Math.floor(b.z1 / this.cell); cz++) {
      let list = this.grid.get(cz); if (!list) this.grid.set(cz, list = []);
      list.push(b);
    }
    return b;
  }
  near(z0, z1) {
    const out = [], seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
      const list = this.grid.get(cz); if (!list) continue;
      for (const b of list) if (!seen.has(b.id) && !b.gone) { seen.add(b.id); out.push(b); }
    }
    return out;
  }

  // ---- shape functions ----
  pipeY(b, z) { return b.cyFar === undefined ? b.cy : lerp(b.cy, b.cyFar, (b.z1 - z) / (b.z1 - b.z0)); }
  topAt(b, x, z) {
    x -= b.dx || 0;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return -Infinity;
    const dy = b.dy || 0;
    switch (b.shape) {
      case 'gableZ': { const hw = (b.x1 - b.x0) / 2; return dy + b.yr - (b.yr - b.ye) * Math.abs(x - (b.x0 + hw)) / hw; }
      case 'gableX': { const hl = (b.z1 - b.z0) / 2; return dy + b.yr - (b.yr - b.ye) * Math.abs(z - (b.z0 + hl)) / hl; }
      case 'shed': return dy + lerp(b.yNear, b.yFar, (b.z1 - z) / (b.z1 - b.z0));
      case 'pipeZ': { const d = x - b.cx; return Math.abs(d) >= b.r ? -Infinity : dy + this.pipeY(b, z) + Math.sqrt(b.r * b.r - d * d); }
      default: return b.y1 + dy;
    }
  }
  bottomAt(b, x, z) {
    x -= b.dx || 0;
    if (b.shape === 'pipeZ') { const d = x - b.cx; return Math.abs(d) >= b.r ? Infinity : (b.dy || 0) + this.pipeY(b, z) - Math.sqrt(b.r * b.r - d * d); }
    return b.y0 + (b.dy || 0);
  }
  // slope of the top surface: [d top / dx, d top / dz]
  grad(b, x, z) {
    x -= b.dx || 0;
    switch (b.shape) {
      case 'gableZ': { const hw = (b.x1 - b.x0) / 2; return [-(b.yr - b.ye) / hw * sign(x - (b.x0 + hw)), 0]; }
      case 'gableX': { const hl = (b.z1 - b.z0) / 2; return [0, -(b.yr - b.ye) / hl * sign(z - (b.z0 + hl))]; }
      case 'shed': return [0, (b.yNear - b.yFar) / (b.z1 - b.z0)];
      case 'pipeZ': { const d = clamp(x - b.cx, -b.r * 0.97, b.r * 0.97); return [-d / Math.sqrt(b.r * b.r - d * d), b.cyFar === undefined ? 0 : (b.cy - b.cyFar) / (b.z1 - b.z0)]; }
      default: return [0, 0];
    }
  }
  // how wide the cat can comfortably stand across this shape
  walkWidth(b) { return b.shape === 'pipeZ' ? b.r * 1.3 : b.x1 - b.x0; }
  centreX(b) { return (b.dx || 0) + (b.shape === 'pipeZ' ? b.cx : (b.x0 + b.x1) / 2); }

  // points sampled across a footprint for shaped tops
  samples(x, z, hx, hz) {
    const s = this._s || (this._s = []); s.length = 0;
    s.push([x, z], [x - hx, z], [x + hx, z], [x, z - hz], [x, z + hz]);
    return s;
  }
  // highest top at or below fromY under a footprint. -> { y, box }
  groundAt(x, z, fromY, hx, hz) {
    hx = hx || 0; hz = hz || 0;
    let y = -Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      const ox = b.dx || 0;
      if (x + hx <= b.x0 + ox || x - hx >= b.x1 + ox || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.shape === 'box') { if (b.y1 + (b.dy || 0) <= fromY + 1e-4 && b.y1 + (b.dy || 0) > y) { y = b.y1 + (b.dy || 0); box = b; } continue; }
      for (const [sx, sz] of this.samples(x, z, hx * 0.5, hz * 0.5)) {
        const t = this.topAt(b, sx, sz);
        if (t <= fromY + 1e-4 && t > y) { y = t; box = b; }
      }
    }
    return { y, box };
  }
  // lowest underside at or above fromY over a footprint
  ceilingAt(x, z, fromY, hx, hz) {
    let y = Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      const ox = b.dx || 0;
      if (x + hx <= b.x0 + ox || x - hx >= b.x1 + ox || z + hz <= b.z0 || z - hz >= b.z1) continue;
      const u = b.shape === 'pipeZ' ? this.bottomAt(b, x, z) : b.y0 + (b.dy || 0);
      if (u >= fromY - 1e-4 && u < y) { y = u; box = b; }
    }
    return { y, box };
  }
  // solids intruding into a volume; top is the highest intruding surface
  solids(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) {
      const dy = b.dy || 0, ox = b.dx || 0, bx0 = b.x0 + ox, bx1 = b.x1 + ox;
      if (x1 <= bx0 || x0 >= bx1 || z1 <= b.z0 || z0 >= b.z1 || y1 <= b.y0 + dy || y0 >= b.y1 + dy) continue;
      if (b.shape === 'box') { out.push({ b, top: b.y1 + dy }); continue; }
      const cx = clamp((x0 + x1) / 2, bx0, bx1), cz = clamp((z0 + z1) / 2, b.z0, b.z1);
      let top = -Infinity;
      for (const [sx, sz] of [[cx, cz], [clamp(x0, bx0, bx1), cz], [clamp(x1, bx0, bx1), cz], [cx, clamp(z0, b.z0, b.z1)], [cx, clamp(z1, b.z0, b.z1)]]) {
        const t = this.topAt(b, sx, sz);
        if (t > y0 + 1e-3 && this.bottomAt(b, sx, sz) < y1 && t > top) top = t;
      }
      if (top > -Infinity) out.push({ b, top });
    }
    return out;
  }
  overlaps(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) { const ox = b.dx || 0; if (x1 > b.x0 + ox && x0 < b.x1 + ox && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) out.push(b); }
    return out;
  }
  // ray against shapes; returns distance or Infinity
  ray(o, d, maxT, filter) {
    let best = maxT;
    const zs = [o[2], o[2] + d[2] * maxT];
    for (const b of this.near(Math.min(zs[0], zs[1]), Math.max(zs[0], zs[1]))) {
      if (filter && !filter(b)) continue;
      let t0 = 0, t1 = best, ok = true;
      const ox = b.dx || 0, lo = [b.x0 + ox, b.y0, b.z0], hi = [b.x1 + ox, b.y1, b.z1];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) ok = false; continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) ok = false;
      }
      if (!ok || t0 >= best) continue;
      if (b.shape === 'box') { best = t0; continue; }
      // shaped: march through the bound and test the height function
      for (let t = t0; t <= t1; t += 0.12) {
        const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
        if (py < this.topAt(b, px, pz) && py > this.bottomAt(b, px, pz)) { best = t; break; }
      }
    }
    return best < maxT ? best : Infinity;
  }
}

// builders: z0 is always the far end (more negative)
function boxSpan(x0, x1, y0, y1, zFar, zNear, tags) {
  return Object.assign({ shape: 'box', x0, x1, y0, y1, z0: zFar, z1: zNear, surface: 'concrete', cam: 'block' }, tags || {});
}
function gableZ(x0, x1, base, eave, ridge, zFar, zNear, tags) {
  return Object.assign({ shape: 'gableZ', x0, x1, y0: base, y1: ridge, ye: eave, yr: ridge, z0: zFar, z1: zNear, surface: 'tile', cam: 'block', walk: true }, tags || {});
}
function gableX(x0, x1, base, eave, ridge, zFar, zNear, tags) {
  return Object.assign({ shape: 'gableX', x0, x1, y0: base, y1: ridge, ye: eave, yr: ridge, z0: zFar, z1: zNear, surface: 'tile', cam: 'block', walk: true }, tags || {});
}
function shed(x0, x1, base, yNear, yFar, zFar, zNear, tags) {
  return Object.assign({ shape: 'shed', x0, x1, y0: base, y1: Math.max(yNear, yFar), yNear, yFar, z0: zFar, z1: zNear, surface: 'tin', cam: 'block', walk: true }, tags || {});
}
function pipeZ(cx, cy, r, zFar, zNear, tags) {
  const cyFar = tags && tags.cyFar, lo = Math.min(cy, cyFar === undefined ? cy : cyFar), hi = Math.max(cy, cyFar === undefined ? cy : cyFar);
  return Object.assign({ shape: 'pipeZ', cx, cy, r, x0: cx - r, x1: cx + r, y0: lo - r, y1: hi + r, z0: zFar, z1: zNear, surface: 'metal', cam: 'none', walk: true }, tags || {});
}
