// =====================================================================
// Materials, procedural textures and the static box batcher.
// Palette: weathered concrete in warm afternoon haze. Walkable tops are
// the lightest values in the frame; walls are lime-washed plaster that
// darkens into the street; the street itself is near-black. Readability
// comes from value, not hue.
// =====================================================================

const PAL = {
  skyTop: '#7f8d9b', skyHorizon: '#e3c39b', skyLow: '#a98f7c', sun: '#ffd8a6',
  roof: '#cbbfae', roofEdge: '#e6dccb', plaster: ['#c9a58f', '#b9b89e', '#a9b8b6', '#cfb57f', '#bfa3a6', '#b8ad9f'],
  street: '#1d1a19', tin: '#8b7c6c', tank: '#26292b', cat: '#7a5f4a'
};

function createAssets(THREE, renderer) {
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
  function paint(size, draw, repeat) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  const rng = makeRng(7);
  function speckle(g, s, n, cols, rmin, rmax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + rng() * 0.6); g.fillStyle = cols[i % cols.length];
      const r = rmin + rng() * (rmax - rmin), x = rng() * s, y = rng() * s;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      // wrap so the tile has no seams
      if (x < r) { g.beginPath(); g.arc(x + s, y, r, 0, TAU); g.fill(); }
      if (y < r) { g.beginPath(); g.arc(x, y + s, r, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  // concrete roof: speckle, water stains, hairline cracks. 1 tile = 4 m.
  const concrete = paint(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2400, ['#8f8a85', '#b5ada4', '#ffffff', '#6f6a66'], 0.4, 1.6, 0.25);
    speckle(g, s, 26, ['#7c7068', '#9a8f84'], 10, 34, 0.08);
    g.strokeStyle = 'rgba(60,52,48,.35)'; g.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) { let x = rng() * s, y = rng() * s; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 30; y += (rng() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    // expansion joints every 2 m, as on real terraces
    g.fillStyle = 'rgba(70,62,56,.35)'; g.fillRect(0, s / 2 - 1, s, 2); g.fillRect(s / 2 - 1, 0, 2, s);
  });
  // plaster wall: 1 tile = 3 m (a storey), with a slab band and rain streaks
  const plaster = paint(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1400, ['#cfc8c0', '#ffffff', '#b8b0a8'], 0.5, 2, 0.3);
    for (let i = 0; i < 40; i++) { const x = rng() * s, w = 2 + rng() * 6, h = 30 + rng() * 120; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(70,60,55,.22)'); gr.addColorStop(1, 'rgba(70,60,55,0)'); g.fillStyle = gr; g.fillRect(x, 10, w, h); }
    g.fillStyle = 'rgba(80,70,64,.4)'; g.fillRect(0, 0, s, 7);           // slab edge
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 7, s, 2);
    // a window per storey, dark
    for (const wx of [0.18, 0.62]) { g.fillStyle = 'rgba(30,26,26,.85)'; g.fillRect(wx * s, s * 0.35, s * 0.18, s * 0.36); g.fillStyle = 'rgba(120,110,100,.6)'; g.fillRect(wx * s - 3, s * 0.71, s * 0.18 + 6, 4); }
  });
  const tin = paint(128, (g, s) => {
    for (let x = 0; x < s; x++) { const v = 0.75 + 0.25 * Math.sin(x / s * TAU * 8); g.fillStyle = `rgb(${200 * v | 0},${190 * v | 0},${178 * v | 0})`; g.fillRect(x, 0, 1, s); }
    speckle(g, s, 90, ['#8a4e2c', '#6b3a22', '#a8683c'], 2, 9, 0.35);
  });
  const fur = paint(128, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(40,28,20,.26)';
    for (let i = 0; i < 11; i++) { const y = (i + 0.3) * s / 11; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.11 + i) * 3 + (rng() - 0.5) * 2); g.lineTo(s, y + 3); g.lineTo(0, y + 3.5); g.fill(); }
    speckle(g, s, 500, ['#ffffff', '#d8cfc6'], 0.3, 1.2, 0.3);
  });

  const lam = o => new THREE.MeshLambertMaterial(o);
  const M = {
    roof: lam({ map: concrete, vertexColors: true }),
    wall: lam({ map: plaster, vertexColors: true }),
    tin: lam({ map: tin, vertexColors: true }),
    plain: lam({ vertexColors: true }),
    tank: lam({ color: PAL.tank }),
    rust: lam({ color: '#6e4a36' }),
    cable: new THREE.MeshBasicMaterial({ color: '#211d1c' }),
    street: new THREE.MeshBasicMaterial({ color: PAL.street }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false }),
    fur: lam({ map: fur, vertexColors: true }),
    furPlain: lam({ vertexColors: true }),
    eye: new THREE.MeshBasicMaterial({ color: '#d9c25a' }),
    nose: lam({ color: '#5a3934' })
  };
  M.roof.userData.shared = M.wall.userData.shared = true;

  const T = { concrete, plaster, tin, fur };
  const blob = paint(64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }, false);
  M.shadow.alphaMap = blob; M.shadow.color.set('#000');
  T.blob = blob;

  return { M, T, THREE };
}

// ---------------------------------------------------------------------
// Batcher: accumulates boxes and other quads into one geometry per
// material, with world-space UVs so textures tile seamlessly across
// merged pieces. One draw call per material for all static architecture.
// ---------------------------------------------------------------------
class Batch {
  constructor() { this.b = new Map(); }
  bucket(key) { let k = this.b.get(key); if (!k) this.b.set(key, k = { p: [], n: [], u: [], c: [], i: [] }); return k; }
  // quad from 4 corners (counter-clockwise seen from outside), colours per corner
  quad(key, a, b, c, d, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c, d]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Box with per-face materials and colours.
  //   o.top / o.side: material keys; o.topCol / o.sideCol / o.sideColLow: [r,g,b]
  //   o.uvTop, o.uvSide: metres per texture tile. o.faces: which faces to emit.
  box(x0, x1, y0, y1, z0, z1, o) {
    const f = o.faces || { top: true, bottom: false, px: true, nx: true, pz: true, nz: true };
    const tt = o.uvTop || 4, ts = o.uvSide || 3;
    const tc = o.topCol || [1, 1, 1], sc = o.sideCol || [1, 1, 1], sl = o.sideColLow || sc;
    // side colour fades toward the street, so depth reads at a glance
    const lowAt = y => { const k = clamp((y1 - y) / (o.fadeDepth || 9), 0, 1); return [lerp(sc[0], sl[0], k), lerp(sc[1], sl[1], k), lerp(sc[2], sl[2], k)]; };
    const cH = lowAt(y1), cL = lowAt(y0);
    if (f.top) this.quad(o.top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / tt, z1 / tt], [x1 / tt, z1 / tt], [x1 / tt, z0 / tt], [x0 / tt, z0 / tt]], [tc, tc, tc, tc]);
    if (f.bottom) this.quad(o.side, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [cL, cL, cL, cL]);
    const side = (a, b, c, d, n, u0, u1) => this.quad(o.side, a, b, c, d, n, [[u0 / ts, y0 / ts], [u1 / ts, y0 / ts], [u1 / ts, y1 / ts], [u0 / ts, y1 / ts]], [cL, cL, cH, cH]);
    if (f.pz) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], x0, x1);
    if (f.nz) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], -x1, -x0);
    if (f.px) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], -z1, -z0);
    if (f.nx) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], z0, z1);
  }
  // Append an existing BufferGeometry (any shape) with a transform matrix and flat colour.
  geo(key, g, m, col, THREE) {
    const k = this.bucket(key), base = k.p.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); k.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); k.n.push(v.x, v.y, v.z);
      k.u.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      k.c.push(col[0], col[1], col[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) k.i.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) k.i.push(base + i);
  }
  build(THREE, mats, opts) {
    const group = new THREE.Group();
    for (const [key, k] of this.b) {
      if (!k.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(k.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
      g.setIndex(k.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(k.i, 1) : new THREE.Uint16BufferAttribute(k.i, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[key]);
      m.castShadow = !!(opts && opts.cast); m.receiveShadow = !!(opts && opts.receive);
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    }
    return group;
  }
}

const hex3 = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
    const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of ms) if (m.userData && m.userData.own) m.dispose();
  });
  if (o.parent) o.parent.remove(o);
}
