// =====================================================================
// Collision world: axis-aligned boxes. Rooftops are boxes; that is all
// this game needs, and it keeps every query cheap on a phone.
// A box: { x0, x1, y0, y1, z0, z1 } with x0 < x1, y0 < y1, z0 < z1,
// plus tags: surface ('concrete' | 'tin' | 'ledge' | ...), cam ('block' | 'fade').
// =====================================================================

class World {
  constructor() { this.boxes = []; this.cell = 8; this.grid = new Map(); }
  add(b) {
    b.id = this.boxes.length;
    this.boxes.push(b);
    for (let cz = Math.floor(b.z0 / this.cell); cz <= Math.floor(b.z1 / this.cell); cz++) {
      let list = this.grid.get(cz); if (!list) this.grid.set(cz, list = []);
      list.push(b);
    }
    return b;
  }
  // boxes whose z range touches [z0, z1]
  near(z0, z1) {
    const out = [], seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
      const list = this.grid.get(cz); if (!list) continue;
      for (const b of list) if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    }
    return out;
  }
  // highest top surface under (x, z) at or below `fromY`, within a footprint
  // half-size (hx, hz). Returns { y, box } or { y: -Infinity, box: null }.
  groundAt(x, z, fromY, hx, hz) {
    hx = hx || 0; hz = hz || 0;
    let y = -Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      if (x + hx <= b.x0 || x - hx >= b.x1 || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.y1 <= fromY + 1e-4 && b.y1 > y) { y = b.y1; box = b; }
    }
    return { y, box };
  }
  // lowest underside above `fromY` over (x, z) footprint: what the cat must fit under
  ceilingAt(x, z, fromY, hx, hz) {
    let y = Infinity, box = null;
    for (const b of this.near(z - hz, z + hz)) {
      if (x + hx <= b.x0 || x - hx >= b.x1 || z + hz <= b.z0 || z - hz >= b.z1) continue;
      if (b.y0 >= fromY - 1e-4 && b.y0 < y) { y = b.y0; box = b; }
    }
    return { y, box };
  }
  overlaps(x0, x1, y0, y1, z0, z1) {
    const out = [];
    for (const b of this.near(z0, z1)) if (x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) out.push(b);
    return out;
  }
  // ray against boxes (slab test); returns distance or Infinity
  ray(o, d, maxT, filter) {
    let best = maxT;
    const zs = [o[2], o[2] + d[2] * maxT];
    for (const b of this.near(Math.min(zs[0], zs[1]), Math.max(zs[0], zs[1]))) {
      if (filter && !filter(b)) continue;
      let t0 = 0, t1 = best, ok = true;
      const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) ok = false; continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best < maxT ? best : Infinity;
  }
}

// helper used by course builders: a box from centre/size in the usual units
function boxAt(cx, y0, cz, w, h, len, tags) {
  return Object.assign({ x0: cx - w / 2, x1: cx + w / 2, y0, y1: y0 + h, z0: cz - len / 2, z1: cz + len / 2, surface: 'concrete', cam: 'block' }, tags || {});
}
// a box spanning explicit z (z0 is the far end, more negative)
function boxSpan(x0, x1, y0, y1, zFar, zNear, tags) {
  return Object.assign({ x0, x1, y0, y1, z0: zFar, z1: zNear, surface: 'concrete', cam: 'block' }, tags || {});
}
