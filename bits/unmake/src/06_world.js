// =====================================================================
// The basin: route decor that explains each mechanism, the streamed
// backdrop of the city, and the sanctuary.
// =====================================================================

function createWorld(THREE, A, scene) {
  const W = {};
  const { M, G, box, mat, merge } = A;

  // ---------------- route decor (explains what holds what) ----------------
  function partsMesh(list, m) { const me = new THREE.Mesh(merge(list), m); me.castShadow = true; me.receiveShadow = true; return me; }
  function frameTower(P, x, y0, z, h, w) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.rust.push({ geo: G.box, m: mat(x + sx * w / 2, y0 + h / 2, z + sz * w / 2, 0, 0, 0, 0.16, h, 0.16) });
    for (let y = y0 + 1.5; y < y0 + h; y += 2.0) {
      P.rust.push({ geo: G.box, m: mat(x, y, z - w / 2, 0, 0, 0, w, 0.1, 0.1) }); P.rust.push({ geo: G.box, m: mat(x, y, z + w / 2, 0, 0, 0, w, 0.1, 0.1) });
      P.rust.push({ geo: G.box, m: mat(x - w / 2, y, z, 0, 0, 0, 0.1, 0.1, w) }); P.rust.push({ geo: G.box, m: mat(x + w / 2, y, z, 0, 0, 0, 0.1, 0.1, w) });
      P.rust.push({ geo: G.box, m: mat(x, y - 1, z + w / 2, 0, 0, Math.atan2(2, w), Math.hypot(w, 2), 0.07, 0.07) });
    }
    P.rust.push({ geo: G.box, m: mat(x, y0 - 9, z, 0, 0, 0, w + 0.3, 18, w + 0.3) });
  }
  const DECOR = {
    tensionTower(d, P) {
      const [x, y, z] = d.at;
      frameTower(P, x, y - 0.2, z - 0.8, d.h + 1, 1.3);
      P.rust.push({ geo: G.box, m: mat(x, y + d.h, z - 0.2, 0, 0, 0, 1.8, 0.3, 1.8) });
      P.verd.push({ geo: G.cyl, m: mat(x, y + d.h, z, 0, 0, Math.PI / 2, 0.38, 0.4, 0.38) });
      // the counterweight that keeps the bridge cable taut
      P.rust.push({ geo: G.box, m: mat(x + 0.9, y + d.h - 3.2, z - 0.8, 0, 0, 0, 0.8, 1.2, 0.8) });
      P.rope.push({ geo: G.cyl6, m: mat(x + 0.9, y + d.h - 1.3, z - 0.8, 0, 0, 0, 0.04, 2.6, 0.04) });
    },
    rootClamp(d, P) {
      const [x, y, z] = d.at;
      P.rust.push({ geo: G.torus, m: mat(x, y - 0.2, z, 0, 0, 0, 0.62, 0.62, 1.6) });
      P.rust.push({ geo: G.box, m: mat(x + 0.75, y - 1.4, z, 0, 0, 0, 0.18, 2.6, 0.18) });
      P.verd.push({ geo: G.cyl, m: mat(x + 0.6, y - 0.2, z, 0, 0, Math.PI / 2, 0.1, 0.4, 0.1) });
    },
    pivotFrame(d, P) {
      const [x, y, z] = d.at;
      for (const sx of [-1, 1]) {
        P.rust.push({ geo: G.box, m: mat(x + sx * 2.0, y - 2.6, z + 0.9, 0.35, 0, 0, 0.22, 5.4, 0.22) });
        P.rust.push({ geo: G.box, m: mat(x + sx * 2.0, y - 2.6, z - 0.9, -0.35, 0, 0, 0.22, 5.4, 0.22) });
      }
      P.verd.push({ geo: G.cyl, m: mat(x, y - 0.35, z, 0, 0, Math.PI / 2, 0.22, 4.4, 0.22) });
    },
    gantry(d, P) {
      const [x, y, z] = d.at;
      if (d.across) {
        for (const sx of [-1, 1]) frameTower(P, x + sx * 7.6, y - 8, z, d.h + 8.2, 1.0);
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 15.6, 0.55, 0.7) });
        P.verd.push({ geo: G.cyl, m: mat(x, y + d.h, z, Math.PI / 2, 0, 0, 0.3, 0.8, 0.3) });
      } else {
        for (const sx of [-1, 1]) frameTower(P, x + sx * 3.4, y - 8, z, d.h + 8.2, 1.0);
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 7.6, 0.5, 0.6) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z + d.span / 2, 0, 0, 0, 1.0, 0.4, 0.4) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z - d.span / 2, 0, 0, 0, 1.0, 0.4, 0.4) });
        P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.15, z, 0, 0, 0, 0.5, 0.35, d.span + 1.0) });
      }
    },
    restraintFrame(d, P) {
      const [x, y, z] = d.at;
      // the clamp that holds a living root up out of the way
      for (const sx of [-1, 1]) {
        P.rust.push({ geo: G.box, m: mat(x + sx * 1.6, y + d.h / 2 - 2, z, 0, 0, 0, 0.35, d.h + 4, 0.5) });
        P.rust.push({ geo: G.box, m: mat(x + sx * 1.6, y - 4.5, z, 0, 0, 0, 0.7, 5, 0.9) });
      }
      P.rust.push({ geo: G.box, m: mat(x, y + d.h, z, 0, 0, 0, 3.7, 0.45, 0.7) });
      P.verd.push({ geo: G.torus, m: mat(x, y + d.h - 0.4, z - 0.3, Math.PI / 2, 0, 0, 0.55, 0.55, 0.55) });
    },
    casketWell(d, P) {
      const [x, y, z] = d.at;
      P.stone.push({ geo: G.cyl, m: mat(x, y - 1.1, z, 0, 0, 0, 0.85, 2.2, 0.85) });
      P.pig.push({ geo: G.cyl, m: mat(x, y + 0.02, z, 0, 0, 0, 0.9, 0.06, 0.9) });
    },
    reservoir(d, P) {
      const [x, y, z] = d.at;
      frameTower(P, x, y - 10, z, 16, 3.4);
      P.rust.push({ geo: G.cyl, m: mat(x, y + 3, z, 0, 0, 0, 2.6, 4.2, 2.6) });
      P.verd.push({ geo: G.torus, m: mat(x, y + 1.2, z, Math.PI / 2, 0, 0, 2.62, 2.62, 1) });
      P.verd.push({ geo: G.torus, m: mat(x, y + 4.8, z, Math.PI / 2, 0, 0, 2.62, 2.62, 1) });
      P.rust.push({ geo: G.box, m: mat(x + 2.2, y - 1.5, z, 0, 0, 0.4, 2.4, 0.5, 0.6) });
    },
    liftFrame(d, P) {
      const [x, y, z] = d.at;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.rust.push({ geo: G.box, m: mat(x + sx * 1.5, y + d.h / 2 - 3, z + sz * 1.6, 0, 0, 0, 0.16, d.h + 6, 0.16) });
      P.rust.push({ geo: G.box, m: mat(x, y + d.h + 0.2, z, 0, 0, 0, 3.4, 0.4, 3.6) });
      P.verd.push({ geo: G.cyl, m: mat(x - 1.7, y + d.h + 0.3, z, Math.PI / 2, 0, 0, 0.5, 0.5, 0.5) });
      // the counterweight it trades height with
      P.rust.push({ geo: G.box, m: mat(x - 2.6, y + d.h - 1.6, z, 0, 0, 0, 0.9, 1.6, 0.9) });
      P.rope.push({ geo: G.cyl6, m: mat(x - 2.6, y + d.h - 0.3, z, 0, 0, 0, 0.04, 1.2, 0.04) });
    },
    dwellings(d, P, rng) {
      const [x, y, z] = d.at;
      // the first settlement grows down the basin wall beside the route
      const n = Math.max(2, Math.floor(d.len / 5));
      for (let i = 0; i < n; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        const xx = x + side * (5.5 + rng() * 4), zz = z + (i - n / 2) * (d.len / n) + rng() * 2;
        const top = y - 1 - rng() * 4, w = 2 + rng() * 2, h = 2.4 + rng() * 2, dd = 2 + rng() * 2;
        P.plaster.push({ geo: box(w, h + 8, dd, 2.4), m: mat(xx, top - h / 2 - 4 + h / 2 - 0.0, zz, 0, rng() * 0.3, 0), c: rng() < 0.5 ? '#e0cdb0' : '#cdb699' });
        P.cav.push({ geo: G.box, m: mat(xx - side * w / 2, top - h + 1.0, zz, 0, 0, 0, 0.08, 1.4, 0.7), c: '#2a2629' });
        P.ceram.push({ geo: G.dome, m: mat(xx, top + 4 - 0.0, zz, 0, 0, 0, w * 0.45, 0.45, dd * 0.45), c: '#ded2bd' });
        P.pig.push({ geo: G.box, m: mat(xx, top + 3.2, zz, 0, 0, 0, w + 0.06, 0.18, dd + 0.06) });
        if (rng() < 0.6) P.leaf.push({ geo: G.ico, m: mat(xx + side * 0.4, top + 4.2, zz + 0.3, 0, rng() * 3, 0, 0.6, 0.5, 0.6), c: rng() < 0.5 ? '#6f7b57' : '#5a6f58' });
      }
    }
  };
  W.buildDecor = function (list, seed) {
    const P = { rust: [], verd: [], rope: [], stone: [], plaster: [], cav: [], ceram: [], pig: [], leaf: [] };
    const rng = makeRng(seed);
    for (const d of list) if (DECOR[d.type]) DECOR[d.type](d, P, rng);
    const g = new THREE.Group();
    const add = (l, m) => { if (l.length) g.add(partsMesh(l, m)); };
    add(P.rust, M.vcRust); add(P.verd, M.verdigris); add(P.rope, M.rope); add(P.stone, M.vcStone); add(P.plaster, M.vcPlaster); add(P.cav, M.cavity); add(P.ceram, M.ceramic); add(P.pig, M.pigment); add(P.leaf, M.vcFlat);
    scene.add(g);
    return g;
  };

  // ---------------- the backdrop: the basin ----------------
  const back = new THREE.Group(); scene.add(back);
  const CH = 60, chunks = new Map();
  const cliffCols = ['#b9ad9a', '#a89c88', '#c4b7a2', '#9d9081'];
  function cliff(P, rng, side, z0) {
    // stepped mineral walls with the first settlement clinging to the contours
    const base = side * (46 + rng() * 10);
    for (let i = 0; i < 4; i++) {
      const z = z0 - i * CH / 4 - rng() * 6;
      const top = 8 + rng() * 26, w = 18 + rng() * 14;
      P.stone.push({ geo: box(w, top + 70, CH / 4 + 4, 8), m: mat(base + side * w / 2, top / 2 - 35, z, 0, 0, 0), c: cliffCols[Math.floor(rng() * 4)] });
      // terraces of dwellings stepping down the face
      for (let k = 0; k < 6; k++) {
        const ty = top - 4 - k * 5.5 - rng() * 2;
        const tx = base - side * (1.5 + k * 1.2 + rng() * 1.5);
        const n = 2 + Math.floor(rng() * 3);
        for (let j = 0; j < n; j++) {
          const zz = z + (j - n / 2) * 4 + rng() * 2;
          const hw = 1.2 + rng() * 1.2, hh = 1.8 + rng() * 1.6;
          P.plaster.push({ geo: box(hw * 2, hh * 2, 3, 2.4), m: mat(tx, ty + hh, zz, 0, (rng() - 0.5) * 0.4, 0), c: rng() < 0.5 ? '#ddc9ab' : '#cfb89a' });
          P.cav.push({ geo: G.box, m: mat(tx - side * hw, ty + 1.2, zz, 0, 0, 0, 0.1, 1.6, 0.9), c: '#29252a' });
          if (rng() < 0.5) P.ceram.push({ geo: G.dome, m: mat(tx, ty + hh * 2, zz, 0, 0, 0, hw * 0.9, 0.7, 1.4), c: '#e2d6c2' });
          if (rng() < 0.35) P.leaf.push({ geo: G.ico, m: mat(tx - side * hw, ty + hh * 2 + 0.3, zz + 1, 0, rng() * 3, 0, 1, 0.8, 1), c: rng() < 0.5 ? '#68765a' : '#596c5a' });
        }
        P.pig.push({ geo: G.box, m: mat(tx + side * 1.5, ty - 0.2, z, 0, 0, 0, 3, 0.3, CH / 4), c: '#7c3526' });
      }
      // waterline scars across the cliff: where the basin once held water
      for (const wl of [-6, -14]) P.scar.push({ geo: G.box, m: mat(base - side * 0.2, wl, z, 0, 0, 0, 0.3, 0.6, CH / 4 + 4), c: '#efe8d8' });
    }
  }
  function bigFrame(P, rng, x, z) {
    const h = 70 + rng() * 30, w = 6 + rng() * 3;
    frameTower({ rust: P.rust }, x, -70, z, h, w);
    // hanging counterweights and the cables that tie the city together
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const cy = -70 + h - 12 - rng() * 20;
      P.rust.push({ geo: G.box, m: mat(x + (rng() - 0.5) * w, cy, z + w * 0.9, 0, 0, 0, 3, 4.5, 3) });
      P.rope.push({ geo: G.cyl6, m: mat(x + (rng() - 0.5) * w, cy + (h - 70 - cy) / 2 + 2, z + w * 0.9, 0, 0, 0, 0.12, (-70 + h - cy), 0.12) });
    }
    return [x, -70 + h, z];
  }
  function giantRoot(P, rng, z, y) {
    // a root as thick as a building, arching across the basin, clamped
    const side = rng() < 0.5 ? -1 : 1;
    const x0 = side * (60 + rng() * 10), x1 = -side * (55 + rng() * 15);
    const pts = [[x0, y - 20, z + 10], [x0 * 0.5, y + 2 + rng() * 6, z + rng() * 10], [x1 * 0.4, y + rng() * 5, z - 8], [x1, y - 25, z - 18]];
    const r = 2.6 + rng() * 2;
    P.roots.push({ geo: A.rootGeo(pts, r, r * 0.7, 36) });
    // restraint collars and their tethers
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    for (const t of [0.3, 0.55, 0.78]) {
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(r * 1.25, r * 1.25, 4));
      P.rust.push({ geo: G.torus, m });
      P.rope.push({ geo: G.cyl6, m: mat(p.x, p.y + 16, p.z, 0, 0, 0, 0.14, 32, 0.14) });
    }
  }
  function reservoir(P, rng, x, z, y) {
    P.rust.push({ geo: G.cyl, m: mat(x, y, z, 0, 0, 0, 5, 7, 5) });
    P.verd.push({ geo: G.torus, m: mat(x, y - 2.5, z, Math.PI / 2, 0, 0, 5.05, 5.05, 2) });
    P.verd.push({ geo: G.torus, m: mat(x, y + 2.5, z, Math.PI / 2, 0, 0, 5.05, 5.05, 2) });
    for (const sx of [-1, 1]) P.rope.push({ geo: G.cyl6, m: mat(x + sx * 4, y + 18, z, 0, 0, sx * 0.15, 0.15, 30, 0.15) });
    P.water.push({ geo: G.cyl6, m: mat(x + 5.2, y - 22, z, 0, 0, 0, 0.35, 40, 0.35) });
  }
  function buildChunk(k, baseY) {
    const rng = makeRng(424242 + k * 977);
    const P = { stone: [], plaster: [], cav: [], ceram: [], pig: [], leaf: [], rust: [], verd: [], rope: [], roots: [], scar: [], water: [] };
    const z0 = -k * CH;
    cliff(P, rng, -1, z0);
    cliff(P, rng, 1, z0);
    // one preservation frame per stretch, kept back from the route so the stone reads first
    if (rng() < 0.7) bigFrame(P, rng, (rng() < 0.5 ? -1 : 1) * (26 + rng() * 18), z0 - rng() * CH);
    if (rng() < 0.75) giantRoot(P, rng, z0 - rng() * CH, 20 + rng() * 16);
    if (rng() < 0.5) reservoir(P, rng, (rng() < 0.5 ? -1 : 1) * (22 + rng() * 14), z0 - rng() * CH, 6 + rng() * 12);
    // the lower city deep in the basin
    for (let i = 0; i < 10; i++) {
      const x = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 34), z = z0 - rng() * CH, y = -26 - rng() * 14;
      P.plaster.push({ geo: box(3 + rng() * 5, 24, 3 + rng() * 5, 3), m: mat(x, y - 12, z, 0, rng(), 0), c: rng() < 0.5 ? '#c7b39a' : '#b9a68c' });
      if (rng() < 0.5) P.leaf.push({ geo: G.ico, m: mat(x, y + 0.6, z, 0, 0, 0, 2, 1.4, 2), c: '#5f6e55' });
    }
    const g = new THREE.Group();
    const add = (l, m) => { if (l.length) { const me = new THREE.Mesh(merge(l), m); me.receiveShadow = false; g.add(me); } };
    add(P.stone, M.vcStone); add(P.plaster, M.vcPlaster); add(P.cav, M.cavity); add(P.ceram, M.ceramic); add(P.pig, M.pigment); add(P.leaf, M.vcFlat);
    add(P.rust, M.vcRust); add(P.verd, M.verdigris); add(P.rope, M.rope); add(P.roots, M.bark); add(P.scar, M.vcPlaster); add(P.water, M.water);
    g.position.y = baseY;
    back.add(g);
    return g;
  }
  // the mother trunk: the oldest living thing, girdled by generations of restraints
  const trunk = new THREE.Group();
  {
    const P = { rust: [], roots: [] };
    P.roots.push({ geo: A.rootGeo([[0, -120, 0], [6, -40, 10], [-4, 40, -6], [3, 120, 4]], 30, 22, 30) });
    for (let i = 0; i < 9; i++) P.rust.push({ geo: G.torus, m: mat(Math.sin(i) * 3, -60 + i * 18, 0, Math.PI / 2, 0, 0, 33 - i * 0.6, 33 - i * 0.6, 14) });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; P.roots.push({ geo: A.rootGeo([[Math.cos(a) * 28, 60, Math.sin(a) * 28], [Math.cos(a) * 70, 95, Math.sin(a) * 70], [Math.cos(a) * 120, 80, Math.sin(a) * 120]], 8, 3, 16) }); }
    trunk.add(new THREE.Mesh(merge(P.roots), M.bark));
    trunk.add(new THREE.Mesh(merge(P.rust), M.vcRust));
    scene.add(trunk);
  }
  // mist layers in the basin
  const mists = [];
  for (const [y, s, op] of [[-14, 4, 0.5], [-30, 6, 0.7]]) {
    const t = A.T.mist.clone(); t.needsUpdate = true; t.repeat.set(s, s);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: t, color: '#d9c7b4', transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 2;
    scene.add(m); mists.push({ m, t, s, y });
  }
  W.update = function (pz, py, t) {
    const k0 = Math.floor(-(pz + 60) / CH) - 0, k1 = Math.floor(-(pz - 260) / CH);
    for (let k = k0; k <= k1; k++) if (!chunks.has(k)) chunks.set(k, buildChunk(k, Math.round(py)));
    for (const [k, g] of chunks) if (k < k0 - 1 || k > k1 + 1) { back.remove(g); g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); chunks.delete(k); }
    trunk.position.set(-30, py - 10, pz - 420);
    for (const mi of mists) { mi.m.position.set(0, py + mi.y, pz - 60); mi.t.offset.set(t * 0.004, (-pz + 60) / 420 * mi.s); }
  };
  W.setVisible = v => { back.visible = v; trunk.visible = v; for (const mi of mists) mi.m.visible = v; };
  W.reset = function () { for (const [, g] of chunks) { back.remove(g); g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); } chunks.clear(); };
  return W;
}

// =====================================================================
// The sanctuary: a hollow among roots around a young tree. Each
// restoration removes a constraint and lets something return.
// =====================================================================
const RESTORATIONS = [
  { id: 'clamp', name: 'Unclamp the sapling', cost: 25 },
  { id: 'water', name: 'Open the water channel', cost: 70 },
  { id: 'roots', name: 'Let the roots spread', cost: 140 },
  { id: 'green', name: 'Let the green return', cost: 230 },
  { id: 'shelter', name: 'Raise a shelter for travellers', cost: 350 },
  { id: 'aqueduct', name: 'Reconnect the old aqueduct', cost: 520 }
];

function createSanctuary(THREE, A, scene) {
  const S = {};
  const { M, G, box } = A;
  const g = new THREE.Group(); g.position.set(0, 0, 600); scene.add(g);
  S.center = new THREE.Vector3(0, 0, 600);
  const add = (geo, m, x, y, z, sx, sy, sz, rx, ry, rz, parent) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.scale.set(sx, sy, sz); me.rotation.set(rx || 0, ry || 0, rz || 0); me.castShadow = true; me.receiveShadow = true; (parent || g).add(me); return me; };
  const rng = makeRng(8);
  // the hollow: a ring of roots around a flagstone floor, on a mineral outcrop
  add(new THREE.CylinderGeometry(9.5, 7, 26, 9), M.stoneDark, 0, -13.2, 0, 1, 1, 1);
  add(new THREE.CylinderGeometry(9.2, 9.2, 0.4, 9), M.flag, 0, -0.2, 0, 1, 1, 1);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + 0.3; add(A.rootGeo([[Math.cos(a) * 12, -6, Math.sin(a) * 12], [Math.cos(a) * 9.5, 1.6, Math.sin(a) * 9.5], [Math.cos(a + 0.5) * 9, 0.4, Math.sin(a + 0.5) * 9], [Math.cos(a + 0.9) * 11, -4, Math.sin(a + 0.9) * 11]], 0.9, 0.5, 20), M.bark, 0, 0, 0, 1, 1, 1); }
  const broken = [];
  for (let i = 0; i < 10; i++) broken.push(add(G.ico, M.stone, (rng() - 0.5) * 12, 0.2, (rng() - 0.5) * 12, 0.4, 0.3, 0.4));
  // the dry channel crossing the floor
  add(box(1.2, 0.1, 16, 2), M.cavity, 0, 0.02, 0, 1, 1, 1, 0, 0.5, 0);
  const water = add(box(1.0, 0.06, 15.6, 2), M.water, 0, 0.08, 0, 1, 1, 1, 0, 0.5, 0);
  // the sapling and its clamp
  const tree = new THREE.Group(); tree.position.set(2.4, 0, -1.2); g.add(tree);
  const trunk = add(A.rootGeo([[0, -0.3, 0], [0.1, 1.2, 0.05], [-0.1, 2.6, 0.1], [0.05, 3.8, 0]], 0.18, 0.08, 16), M.bark, 0, 0, 0, 1, 1, 1, 0, 0, 0, tree);
  const clamp = add(G.torus, M.rust, 0, 1.4, 0, 0.32, 0.32, 0.5, Math.PI / 2, 0, 0, tree);
  const stakes = [add(G.box, M.rust, 0.6, 1.0, 0, 0.08, 2.0, 0.08, 0, 0, 0.3, tree), add(G.box, M.rust, -0.6, 1.0, 0, 0.08, 2.0, 0.08, 0, 0, -0.3, tree)];
  const crown = add(G.ico1, M.leaf, 0, 4.3, 0, 1.6, 1.1, 1.6, 0, 0, 0, tree);
  const crownTop = add(G.ico1, M.leaf, 0.3, 5.0, -0.2, 1.0, 0.8, 1.0, 0, 0, 0, tree);
  const spreading = [];
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; spreading.push(add(A.rootGeo([[2.4, 0.1, -1.2], [2.4 + Math.cos(a) * 2.5, 0.25, -1.2 + Math.sin(a) * 2.5], [2.4 + Math.cos(a + 0.3) * 5, 0.15, -1.2 + Math.sin(a + 0.3) * 5]], 0.22, 0.06, 14), M.bark, 0, 0, 0, 1, 1, 1)); }
  const green = [];
  for (let i = 0; i < 18; i++) { const a = rng() * TAU, r = 3 + rng() * 5.5; green.push(add(G.ico, rng() < 0.5 ? M.leaf : M.moss, Math.cos(a) * r, 0.25, Math.sin(a) * r, 0.5 + rng() * 0.5, 0.35 + rng() * 0.3, 0.5 + rng() * 0.5)); }
  const shelter = new THREE.Group(); shelter.position.set(-4.4, 0, 2.2); g.add(shelter);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(box(0.24, 2.4, 0.24, 1), M.timber, sx * 1.2, 1.2, sz * 1.0, 1, 1, 1, 0, 0, 0, shelter);
  add(G.dome, M.ceramic, 0, 2.4, 0, 1.7, 0.7, 1.5, 0, 0, 0, shelter);
  add(box(3.5, 0.15, 0.2, 1), M.pigment, 0, 2.38, 1.05, 1, 1, 1, 0, 0, 0, shelter);
  add(box(1.8, 0.4, 0.6, 1), M.stone, 0, 0.2, 0.5, 1, 1, 1, 0, 0, 0, shelter);
  const aq = new THREE.Group(); g.add(aq);
  for (let i = 0; i < 6; i++) add(box(1.2, 18, 1.2, 3), M.stone, 9 + i * 5, -8, -9 - i * 3, 1, 1, 1, 0, 0, 0, aq);
  add(box(1.4, 0.8, 34, 3), M.stone, 21, 1.1, -16, 1, 1, 1, 0, -1.03, 0, aq);
  const aqWater = add(box(0.8, 0.1, 34, 3), M.water, 21, 1.55, -16, 1, 1, 1, 0, -1.03, 0, aq);
  S.apply = function (n) {
    const has = i => n > i;
    clamp.visible = !has(0); for (const s of stakes) s.visible = !has(0);
    trunk.scale.set(has(0) ? 1.15 : 1, 1, has(0) ? 1.15 : 1);
    water.visible = has(1);
    for (const r of spreading) r.visible = has(2);
    tree.scale.setScalar(has(2) ? 1.35 : 1);
    crown.visible = has(1); crownTop.visible = has(2);
    for (const b of broken) b.visible = !has(2);
    for (const v of green) v.visible = has(3);
    shelter.visible = has(4);
    aq.visible = has(5); aqWater.visible = has(5);
  };
  S.apply(0);
  S.group = g;
  return S;
}
