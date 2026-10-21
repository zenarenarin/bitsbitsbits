// =====================================================================
// Views: authored geometry for every structural style, connections,
// pickups, the traveller rig, the first-person hand and particles.
// A view is a THREE.Group in the body's local frame; sync() copies the
// simulated transform every frame.
// =====================================================================

function createViews(THREE, A, scene) {
  const V = {};
  const { M, G, box } = A;
  const root = new THREE.Group();
  scene.add(root);
  V.root = root;

  const mesh = (geo, mat, parent, x, y, z, sx, sy, sz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const faces = (side, top, bottom) => [side, side, top, bottom || side, side, side];

  // an I-beam girder along local z
  function girder(g, x, y, len, h, w, mat) {
    mesh(box(w, 0.06, len, 2), mat, g, x, y + h / 2 - 0.03, 0);
    mesh(box(w, 0.06, len, 2), mat, g, x, y - h / 2 + 0.03, 0);
    mesh(box(0.05, h, len, 2), mat, g, x, y, 0);
  }
  // a lattice column dropping into the basin
  function lattice(g, x, z, top, depth, w) {
    const parts = [];
    const h = depth;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ geo: G.box, m: A.mat(x + sx * w / 2, top - h / 2, z + sz * w / 2, 0, 0, 0, 0.12, h, 0.12) });
    for (let y = top - 1.2; y > top - h; y -= 2.2) {
      parts.push({ geo: G.box, m: A.mat(x, y, z - w / 2, 0, 0, 0, w, 0.08, 0.08) });
      parts.push({ geo: G.box, m: A.mat(x, y, z + w / 2, 0, 0, 0, w, 0.08, 0.08) });
      parts.push({ geo: G.box, m: A.mat(x - w / 2, y, z, 0, 0, 0, 0.08, 0.08, w) });
      parts.push({ geo: G.box, m: A.mat(x + w / 2, y, z, 0, 0, 0, 0.08, 0.08, w) });
      parts.push({ geo: G.box, m: A.mat(x, y - 1.1, z - w / 2, 0, 0, Math.atan2(2.2, w), Math.hypot(w, 2.2), 0.06, 0.06) });
    }
    const m = new THREE.Mesh(A.merge(parts), M.vcRust);
    m.castShadow = true; g.add(m);
  }

  const builders = {
    deck(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, 0.24, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g, 0, hy - 0.12, 0);
      girder(g, -hx + 0.3, hy - 0.5, hz * 2 - 0.1, 0.52, 0.3, M.rust);
      girder(g, hx - 0.3, hy - 0.5, hz * 2 - 0.1, 0.52, 0.3, M.rust);
      for (let z = -hz + 0.6; z <= hz - 0.5; z += 2.4) mesh(box(hx * 2 - 0.5, 0.18, 0.16, 1), M.rustDark, g, 0, hy - 0.62, z);
      if (hz > 3.2 && hx > 0.8) lattice(g, hx - 0.35, -hz + 0.8, hy - 0.8, 18 + (s[2] * 13) % 7, 0.7);
    },
    terrace(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.plaster, M.flag, M.stone), g, 0, 0, 0);
      mesh(box(hx * 2 + 0.16, 0.12, hz * 2 + 0.16, 2), M.ceramic, g, 0, hy - 0.06, 0);
      // the old footing, wider and darker, sinking into the basin
      mesh(box(hx * 2 + 0.3, 8, hz * 2 + 0.3, 3), M.stoneDark, g, 0, -hy - 4, 0);
      if (hz > 1.5) mesh(box(hx * 2 + 0.34, 0.2, 0.5, 1), M.pigment, g, 0, -hy - 0.9, hz * 0.4);
    },
    channel(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.stone, M.stoneDark), g, 0, 0, 0);
      mesh(box(0.7, 0.04, hz * 2 - 0.2, 2), M.cavity, g, 0, hy + 0.01, 0);
      for (const sx of [-1, 1]) mesh(box(0.3, 0.5, hz * 2, 2), M.stone, g, sx * (hx - 0.15), hy + 0.0, 0);
      mesh(box(hx * 2 + 0.3, 10, hz * 2 + 0.3, 3), M.stoneDark, g, 0, -hy - 5, 0);
    },
    causeway(g, s) { builders.deck(g, s); },
    beam(g, s) {
      const [hx, hy, hz] = s;
      girder(g, 0, 0, hz * 2, hy * 2, hx * 2, M.rust);
      mesh(box(hx * 2 - 0.1, 0.05, hz * 2, 2), M.timber, g, 0, hy - 0.02, 0);
    },
    leaf(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2 - 0.2, 0.14, hz * 2, 1.6), faces(M.timber, M.timber, M.timber), g, 0, hy - 0.07, 0);
      for (const sx of [-1, 1]) {
        girder(g, sx * (hx - 0.12), -0.05, hz * 2, 0.42, 0.24, M.rust);
        mesh(box(0.06, 0.06, hz * 2, 2), M.verdigris, g, sx * (hx - 0.08), hy + 0.65, 0);
        for (let z = -hz + 0.4; z <= hz; z += 1.4) mesh(box(0.06, 0.65, 0.06, 1), M.verdigris, g, sx * (hx - 0.08), hy + 0.33, z);
      }
    },
    balance(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 1.6), faces(M.timber, M.timber, M.rust), g, 0, 0, 0);
      for (const sx of [-1, 1]) girder(g, sx * (hx + 0.08), -0.15, hz * 2, 0.5, 0.18, M.rust);
      mesh(G.cyl, M.verdigris, g, 0, -hy - 0.15, 0, 0.32, hx * 2 + 0.7, 0.32, 0, 0, Math.PI / 2);
      mesh(box(hx * 2 + 0.2, 0.3, 1.0, 1), M.rust, g, 0, -0.05, -hz + 0.5);
    },
    counterweight(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.2), M.rust, g);
      mesh(box(s[0] * 2 + 0.08, 0.2, s[2] * 2 + 0.08, 1), M.verdigris, g, 0, s[1] * 0.4, 0);
      mesh(G.torus, M.iron, g, 0, s[1] + 0.12, 0, 0.22, 0.22, 0.22, Math.PI / 2, 0, 0);
    },
    cradle(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, 0.14, hz * 2, 2), faces(M.rust, M.ceramic, M.rust), g, 0, hy - 0.07, 0);
      girder(g, -hx + 0.1, -0.1, hz * 2, 0.36, 0.2, M.rust);
      girder(g, hx - 0.1, -0.1, hz * 2, 0.36, 0.2, M.rust);
      for (const z of [-hz + 0.3, hz - 0.3]) mesh(box(hx * 2, 0.12, 0.2, 1), M.verdigris, g, 0, hy + 0.06, z);
    },
    root(g, s) {
      const [hx, hy, hz] = s;
      const r = Math.max(hx, hy) * 1.2;
      const pts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([Math.sin(t * 5 + hz) * 0.08, hy - r + Math.sin(t * Math.PI) * 0.12, lerp(hz + 0.2, -hz - 0.2, t)]); }
      const m = mesh(A.rootGeo(pts, r, r * 0.92, 24), M.bark, g);
      m.position.y = 0;
      for (let i = 0; i < 3; i++) mesh(A.rootGeo([[0, -r * 0.6, lerp(hz, -hz, 0.2 + i * 0.3)], [0.3, -r - 0.7, lerp(hz, -hz, 0.2 + i * 0.3) - 0.2], [0.1, -r - 1.6, lerp(hz, -hz, 0.2 + i * 0.3)]], 0.09, 0.02, 8), M.bark, g);
    },
    rootBridge(g, s) { builders.root(g, s); },
    knuckle(g, s) {
      const m = mesh(G.ico1, M.bark, g, 0, 0, 0, s[0] * 1.15, s[1] * 1.25, s[2] * 1.15);
      m.rotation.set(0.3, 0.6, 0.2);
      mesh(A.rootGeo([[0, -s[1], 0], [0.3, -s[1] - 2, 0.4], [-0.2, -s[1] - 5, 0.1]], s[0] * 0.55, s[0] * 0.3, 10), M.bark, g);
    },
    lever(g, s) { mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1), M.brass, g); mesh(G.cyl, M.iron, g, 0, -0.3, 0, 0.12, 0.6, 0.12); },
    casket(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1), M.ceramic, g);
      mesh(box(s[0] * 2 + 0.06, 0.1, s[2] * 2 + 0.06, 1), M.pigment, g, 0, s[1] * 0.5, 0);
      mesh(G.dome, M.ceramic, g, 0, s[1], 0, s[0] * 0.9, 0.3, s[2] * 0.9);
    },
    weight(g) {
      const b = mesh(G.sphere, M.rust, g, 0, 0, 0, 0.75, 0.75, 0.75);
      for (const r of [0, Math.PI / 2]) mesh(G.torus, M.verdigris, b, 0, 0, 0, 1.01, 1.01, 1.01, r, 0, 0);
    },
    repairWall(g, s, b) {
      const [hx, hy, hz] = s;
      // generations of patches: the original stone, then plaster, then iron plates
      mesh(box(hx * 2, hy * 2, hz * 2, 1.6), M.stone, g);
      const r = makeRng(b.id * 31);
      for (let i = 0; i < 7; i++) {
        const w = 0.5 + r() * 1.0, h = 0.4 + r() * 0.9;
        const mat = r() < 0.4 ? M.rust : r() < 0.6 ? M.plaster : M.ceramic;
        const big = hx > hz;
        mesh(box(big ? w : hx * 2 + 0.08 + r() * 0.06, h, big ? hz * 2 + 0.08 + r() * 0.06 : w, 1.2), mat, g, big ? (r() - 0.5) * (hx * 2 - w) : 0, (r() - 0.5) * (hy * 2 - h), big ? 0 : (r() - 0.5) * (hz * 2 - w));
      }
      for (const yy of [-hy * 0.5, hy * 0.4]) mesh(box(hx * 2 + 0.12, 0.12, hz * 2 + 0.12, 1), M.iron, g, 0, yy, 0);
      const ov = mesh(box(hx * 2 + 0.14, hy * 2 + 0.02, hz * 2 + 0.14, 1.6), M.crackOverlay.clone(), g); ov.material.userData.own = true;
      ov.castShadow = false; ov.receiveShadow = false;
      g.userData.cracks = ov;
    },
    terraceSlab(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.plaster, M.flag, M.stoneDark), g);
      mesh(box(hx * 2 + 0.12, 0.1, hz * 2 + 0.12, 2), M.ceramic, g, 0, hy - 0.05, 0);
      for (let i = 0; i < 3; i++) mesh(A.rootGeo([[(i - 1) * 0.9, -hy, 0], [(i - 1) * 1.1, -hy - 1.2, 0.3], [(i - 1) * 0.8, -hy - 2.6, -0.2]], 0.07, 0.02, 8), M.bark, g);
    },
    basin(g, s) { mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 2.4), faces(M.stone, M.stoneDark, M.stoneDark), g); },
    barge(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2 - 0.6, 1.5), faces(M.timber, M.timber, M.timber), g);
      for (const sz of [-1, 1]) mesh(box(hx * 1.6, hy * 1.6, 0.6, 1), M.timber, g, 0, hy * 0.2, sz * (hz - 0.3), sz * 0.35, 0, 0);
      for (const sx of [-1, 1]) mesh(box(0.08, 0.3, hz * 2 - 0.4, 1), M.rust, g, sx * (hx - 0.04), hy + 0.12, 0);
    },
    sluice(g, s, b) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.2), M.rust, g);
      for (let y = -s[1] + 0.4; y < s[1]; y += 0.6) mesh(box(s[0] * 2 + 0.1, 0.08, s[2] * 2 + 0.06, 1), M.verdigris, g, 0, y, 0);
      const wheel = mesh(G.torus, M.verdigris, g, s[0] + 0.25, s[1] * 0.6, 0, 0.5, 0.5, 0.5, 0, Math.PI / 2, 0);
      void wheel; void b;
      const ov = mesh(box(s[0] * 2 + 0.14, s[1] * 2 + 0.02, s[2] * 2 + 0.14, 1.2), M.crackOverlay.clone(), g); ov.material.userData.own = true;
      ov.castShadow = false; g.userData.cracks = ov;
    },
    post(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.6), faces(M.stone, M.flag, M.stone), g);
      mesh(G.torus, M.rust, g, 0, s[1] - 0.6, 0, s[0] * 1.05, s[0] * 1.05, 0.5, Math.PI / 2, 0, 0);
    },
    liftDeck(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 1.6), faces(M.rust, M.timber, M.rust), g);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(G.cyl6, M.rope, g, sx * (s[0] - 0.1), 3.5, sz * (s[2] - 0.1), 0.03, 7, 0.03);
    },
    net(g, s) {
      for (let x = -s[0]; x <= s[0] + 1e-3; x += 0.5) mesh(G.cyl6, M.rope, g, x, s[1], 0, 0.025, s[2] * 2, 0.025, Math.PI / 2, 0, 0);
      for (let z = -s[2]; z <= s[2] + 1e-3; z += 0.5) mesh(G.cyl6, M.rope, g, 0, s[1], z, 0.025, s[0] * 2, 0.025, 0, 0, Math.PI / 2);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(box(0.25, 6, 0.25, 1), M.rust, g, sx * s[0], s[1] - 3, sz * s[2]);
    },
    // ---- the glaze: preservation additions, every one of them unmakeable ----
    preserved(g, s, b) {
      const [hx, hy, hz] = s;
      const m = A.glaze(b);
      g.userData.glaze = m;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), m, g);
      // walls get a plinth and a cap; long floors a pair of keel ribs: all glaze, so they go together
      if (hy > 0.8 && Math.max(hx, hz) > 0.6) {
        mesh(box(hx * 2 + 0.12, 0.16, hz * 2 + 0.12, 2.4), m, g, 0, hy - 0.08, 0);
        mesh(box(hx * 2 + 0.16, 0.22, hz * 2 + 0.16, 2.4), m, g, 0, -hy + 0.11, 0);
      } else if (hy < 0.5 && hz > 1.2) {
        for (const sx of [-1, 1]) mesh(box(0.22, 0.34, hz * 2, 2.4), m, g, sx * (hx - 0.3), -hy - 0.17, 0);
      }
    },
    // an old settlement wall: carved stone, pigment band, a blind niche. Not glazed, so it stays.
    oldWall(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stone), g);
      mesh(box(hx * 2 + 0.06, 0.16, hz * 2 + 0.06, 1), M.pigment, g, 0, hy * 0.55, 0);
      mesh(box(0.7, 1.0, 0.1, 1), M.cavity, g, 0, -0.2, hz + 0.01);
      mesh(G.dome, M.stone, g, 0, 0.3, hz + 0.01, 0.35, 0.35, 0.12, Math.PI / 2, 0, 0);
    },
    // settlement stone spans: no deep footing, so the old street below stays open
    span(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      mesh(box(hx * 2 + 0.16, 0.12, hz * 2 + 0.16, 2), M.ceramic, g, 0, hy - 0.06, 0);
      for (const sx of [-1, 1]) mesh(box(0.34, 0.5, hz * 2, 2.4), M.stoneDark, g, sx * (hx - 0.17), -hy - 0.25, 0);
    },
    lintel(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      for (const sz of [-1, 1]) mesh(box(hx * 2 + 0.1, hy * 2 + 0.08, 0.3, 1), M.pigment, g, 0, 0, sz * (hz - 0.5));
    },
    ramp(g, s) {
      const [hx, hy, hz] = s;
      mesh(box(hx * 2, hy * 2, hz * 2, 2.4), faces(M.stone, M.flag, M.stoneDark), g);
      for (let z = -hz + 0.65; z < hz; z += 0.65) mesh(box(hx * 2 - 0.2, 0.02, 0.06, 1), M.stoneDark, g, 0, hy + 0.005, z);
      mesh(box(hx * 2 + 0.3, 3, hz * 2, 2.4), M.stoneDark, g, 0, -hy - 1.5, 0);
    },
    pier(g, s) {
      mesh(box(s[0] * 2, s[1] * 2, s[2] * 2, 2.4), M.stoneDark, g);
      mesh(box(s[0] * 2 + 0.3, 0.5, s[2] * 2 + 0.3, 1), M.rust, g, 0, s[1] - 0.25, 0);
    }
  };

  // fewer draw calls: a body's parts that share one material become one mesh
  // (multi-material parts and specially referenced parts are left alone)
  function compact(g) {
    const keep = new Set(Object.values(g.userData).filter(v => v && v.isObject3D));
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || Array.isArray(c.material) || keep.has(c) || c.children.length) continue;
      c.updateMatrix();
      const k = c.material.uuid;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geo = A.merge(list.map(c => ({ geo: c.geometry, m: c.matrix })));
      const m = new THREE.Mesh(geo, list[0].material);
      m.castShadow = true; m.receiveShadow = true;
      for (const c of list) { g.remove(c); if (!c.geometry.userData.shared) c.geometry.dispose(); }
      g.add(m);
    }
  }
  // A segment's settlement stone never moves and never goes: bake all of it
  // into one mesh per material (multi-material boxes are split by face group).
  V.canBatch = b => b.type === 'static' && !b.erase && !b.hp && !b.fragile && !b.fallable && !b.holds && b.shape !== 'sphere' && b.style !== 'lever';
  V.batchStatic = function (bodies) {
    const buckets = new Map(), temp = [];
    const push = (mat, geo, m) => { if (!buckets.has(mat.uuid)) buckets.set(mat.uuid, { mat, parts: [] }); buckets.get(mat.uuid).parts.push({ geo, m }); };
    for (const b of bodies) {
      const g = new THREE.Group();
      (builders[b.style] || builders.deck)(g, b.size, b);
      g.position.set(b.pos[0], b.pos[1], b.pos[2]); g.quaternion.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
      g.updateMatrixWorld(true);
      g.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.userData.shared) temp.push(o.geometry);
        if (!Array.isArray(o.material)) { push(o.material, o.geometry, o.matrixWorld.clone()); return; }
        const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        if (src !== o.geometry) temp.push(src);
        for (const gr of o.geometry.groups) {
          const sub = new THREE.BufferGeometry();
          for (const name of ['position', 'normal', 'uv']) { const a = src.attributes[name]; if (a) sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); }
          temp.push(sub);
          push(o.material[gr.materialIndex], sub, o.matrixWorld.clone());
        }
      });
    }
    const out = new THREE.Group();
    for (const { mat, parts } of buckets.values()) { const m = new THREE.Mesh(A.merge(parts), mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; out.add(m); }
    for (const geo of temp) geo.dispose();
    out.matrixAutoUpdate = false;
    root.add(out);
    return out;
  };
  V.makeBody = function (b) {
    const g = new THREE.Group();
    const f = builders[b.style] || builders.deck;
    if (b.shape === 'sphere') builders.weight(g, b.size, b);
    else f(g, b.size, b);
    g.userData.body = b;
    compact(g);
    root.add(g);
    V.syncBody(b, g);
    if (b.style === 'deck' || b.style === 'terrace' || b.style === 'channel' || b.style === 'pier' || b.style === 'basin' || b.style === 'post' || b.style === 'span' || b.style === 'ramp') g.matrixAutoUpdate = b.type !== 'static';
    return g;
  };
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  V.syncBody = function (b, g) {
    g.position.set(b.pos[0], b.pos[1], b.pos[2]);
    g.quaternion.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
    if (g.userData.glaze) { _m4.compose(g.position, g.quaternion, _one).invert(); g.userData.glaze.userData.u.uInv.value.copy(_m4); }
    if (b.type === 'ball' && g.children[0]) g.children[0].rotation.x = -(b.spin || 0);
    if (g.userData.cracks && b.hp) g.userData.cracks.material.opacity = Math.min(0.85, (b.dmg || 0) / b.hp * 0.9);
    if (!g.matrixAutoUpdate) g.updateMatrix();
  };

  // ---------------- connections ----------------
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function setLine(m, a, b) {
    _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
    _d.subVectors(_b, _a);
    const L = Math.max(0.01, _d.length());
    m.position.copy(_a).addScaledVector(_d, 0.5);
    m.quaternion.setFromUnitVectors(_up, _d.normalize());
    m.scale.y = L;
    return L;
  }
  V.setLine = setLine;
  V.makeConn = function (c) {
    const g = new THREE.Group();
    // every restraint the preservers added is copper: the same family as the glaze trim
    const mat = M.verdigris.clone();
    mat.emissive = new THREE.Color(PALETTE.unmake);
    mat.emissiveIntensity = 0;
    mat.userData.own = true;
    g.userData.mat = mat;
    const r = c.style === 'brace' ? 0.11 : c.style === 'chain' ? 0.07 : c.style === 'pin' ? 0.09 : 0.045;
    const line = new THREE.Mesh(c.style === 'brace' ? G.box : G.cyl6, mat);
    line.scale.set(r * (c.style === 'brace' ? 2 : 1), 1, r * (c.style === 'brace' ? 2 : 1));
    line.castShadow = true;
    g.add(line); g.userData.line = line;
    if (c.style === 'chain') {
      g.userData.links = [];
      for (let i = 0; i < 10; i++) { const l = new THREE.Mesh(G.torus, M.iron); l.scale.setScalar(0.11); l.castShadow = true; g.add(l); g.userData.links.push(l); }
    }
    if (c.style === 'cable') {
      // a tension marker: a small weight on a thread; it trembles when the cable strains
      const tag = new THREE.Group();
      const thread = new THREE.Mesh(G.cyl6, M.rope); thread.scale.set(0.01, 0.4, 0.01); thread.position.y = -0.2; tag.add(thread);
      const bob = new THREE.Mesh(G.cone, M.brass); bob.scale.set(0.07, 0.16, 0.07); bob.position.y = -0.46; bob.rotation.x = Math.PI; tag.add(bob);
      g.add(tag); g.userData.tag = tag;
    }
    if (c.style === 'pin') {
      const head = new THREE.Mesh(G.cyl, M.brass); head.scale.set(0.22, 0.12, 0.22); g.add(head); g.userData.head = head;
      const plate = new THREE.Mesh(box(0.6, 0.6, 0.1, 1), M.rust); g.add(plate); g.userData.plate = plate;
    }
    root.add(g);
    return g;
  };
  V.syncConn = function (P, c, g, t) {
    const [a, b] = P.connEnds(c);
    let jitter = 0;
    if (c.fray && c.fray.started) jitter = 0.06;
    const bb = jitter ? [b[0] + (Math.random() - 0.5) * jitter, b[1], b[2] + (Math.random() - 0.5) * jitter] : b;
    const L = setLine(g.userData.line, a, bb);
    if (g.userData.links) g.userData.links.forEach((l, i) => { const k = (i + 0.5) / g.userData.links.length; l.position.set(lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)); l.quaternion.copy(g.userData.line.quaternion); l.rotateY(i % 2 ? Math.PI / 2 : 0); });
    if (g.userData.tag) { const k = 0.38; g.userData.tag.position.set(lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)); g.userData.tag.rotation.z = Math.sin(t * (c.fray && c.fray.started ? 40 : 2) + c.id) * (c.fray && c.fray.started ? 0.3 : 0.05); }
    if (g.userData.head) { g.userData.head.position.set(b[0], b[1], b[2]); g.userData.head.quaternion.copy(g.userData.line.quaternion); g.userData.plate.position.set(a[0], a[1], a[2]); }
    void L;
  };

  // ---------------- pickups ----------------
  V.makePickup = function (p) {
    const g = new THREE.Group();
    if (p.kind === 'relic') {
      const seed = new THREE.Mesh(G.ico1, M.relic); seed.scale.set(0.2, 0.3, 0.2); g.add(seed);
      const ring = new THREE.Mesh(G.torus, M.brass); ring.scale.setScalar(0.32); ring.rotation.x = Math.PI / 2; g.add(ring);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.T.glow, color: '#ffc27a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(1.5); g.add(halo);
      g.userData.spin = seed; g.userData.ring = ring;
    } else {
      const cog = new THREE.Mesh(G.torus, M.salvage); cog.scale.setScalar(0.17); g.add(cog);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const t = new THREE.Mesh(G.box, M.salvage); t.scale.set(0.07, 0.07, 0.05); t.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); g.add(t); }
      g.userData.spin = g;
    }
    root.add(g);
    return g;
  };

  // ---------------- the traveller ----------------
  // A lantern-keeper's silhouette: broad pale hat, long slate mantle, ochre sash,
  // and the unmaking key slung across the back.
  V.makeTraveller = function () {
    const rootG = new THREE.Group();
    const body = new THREE.Group(); rootG.add(body);
    const limb = (len, r, m) => { const j = new THREE.Group(); const mm = new THREE.Mesh(G.cyl, m); mm.scale.set(r, len, r); mm.position.y = -len / 2; mm.castShadow = true; j.add(mm); return j; };
    const hips = new THREE.Group(); hips.position.y = 0.66; body.add(hips);
    const legs = [];
    for (const sx of [-1, 1]) {
      const thigh = limb(0.34, 0.062, M.legs); thigh.position.x = sx * 0.09; hips.add(thigh);
      const shin = limb(0.32, 0.052, M.legs); shin.position.y = -0.34; thigh.add(shin);
      const foot = new THREE.Mesh(G.box, M.mantleDark); foot.scale.set(0.1, 0.07, 0.22); foot.position.set(0, -0.33, -0.05); foot.castShadow = true; shin.add(foot);
      legs.push({ thigh, shin });
    }
    const torso = new THREE.Group(); torso.position.y = 0.66; body.add(torso);
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.34, 0.72, 14, 1, true), M.mantle);
    mantle.material = M.mantle; mantle.position.y = 0.28; mantle.castShadow = true; torso.add(mantle);
    const mantleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.32, 0.7, 14), M.mantleDark); mantleIn.position.y = 0.28; torso.add(mantleIn);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 16), M.sash); sash.rotation.x = Math.PI / 2; sash.position.y = 0.35; torso.add(sash);
    const tail = new THREE.Group(); tail.position.set(0.12, 0.35, 0.16); torso.add(tail);
    const tailM = new THREE.Mesh(G.box, M.sash); tailM.scale.set(0.08, 0.36, 0.02); tailM.position.y = -0.18; tail.add(tailM);
    const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
    const face = new THREE.Mesh(G.sphere, M.mask); face.scale.setScalar(0.125); face.castShadow = true; head.add(face);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.03, 20), M.hat); brim.position.y = 0.08; brim.castShadow = true; head.add(brim);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 16), M.hat); crown.position.y = 0.19; crown.castShadow = true; head.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.04, 16), M.sash); band.position.y = 0.11; head.add(band);
    const eye = new THREE.Mesh(G.box, M.legs); eye.scale.set(0.11, 0.016, 0.01); eye.position.set(0, 0.0, -0.122); head.add(eye);
    const arms = [];
    for (const sx of [-1, 1]) {
      const arm = limb(0.38, 0.042, M.mantle); arm.position.set(sx * 0.16, 0.56, 0); torso.add(arm);
      const hand = new THREE.Mesh(G.sphereLo, M.mask); hand.scale.setScalar(0.045); hand.position.y = -0.39; arm.add(hand);
      arms.push(arm);
    }
    // the key, slung diagonally across the back
    const key = new THREE.Group(); key.position.set(0, 0.42, 0.2); key.rotation.z = 0.7; torso.add(key);
    const keyRod = new THREE.Mesh(G.cyl6, M.brass); keyRod.scale.set(0.02, 0.8, 0.02); key.add(keyRod);
    const keyTip = new THREE.Mesh(G.ico, M.key); keyTip.scale.set(0.05, 0.09, 0.05); keyTip.position.y = 0.42; key.add(keyTip);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ map: A.T.glow, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; rootG.add(blob);
    scene.add(rootG);
    const st = { phase: 0, squash: 0, lean: 0, roll: 0, yaw: 0, air: 0, fall: 0, balance: 0, idle: 0, prevSin: 0, reach: 0 };
    return {
      root: rootG, blob, key, keyTip, head,
      update(dt, p, info) {
        const speed = Math.hypot(p.vel[0], p.vel[2]);
        const grounded = p.grounded;
        const r = clamp(speed / MOVE.cruise, 0, 1.4);
        if (grounded) st.phase += speed * dt / 1.35;
        const ph = st.phase * TAU, sn = Math.sin(ph);
        if (grounded && speed > 0.8 && Math.sign(sn) !== Math.sign(st.prevSin) && info.onStep) info.onStep(r);
        st.prevSin = sn;
        st.air = damp(st.air, grounded ? 0 : 1, 12, dt);
        st.fall = damp(st.fall, !grounded && p.vel[1] < -6 ? 1 : 0, 6, dt);
        st.squash = damp(st.squash, 0, 10, dt);
        st.balance = damp(st.balance, info.narrow ? 1 : 0, 6, dt);
        st.reach = damp(st.reach, info.reach ? 1 : 0, 14, dt);
        st.lean = damp(st.lean, clamp(0.08 * r + info.accel * 0.03, -0.3, 0.32), 8, dt);
        let turn = 0;
        if (speed > 0.4) { turn = wrapAngle(Math.atan2(-p.vel[0], -p.vel[2]) - st.yaw); st.yaw = wrapAngle(st.yaw + turn * (1 - Math.exp(-10 * dt))); }
        st.roll = damp(st.roll, clamp(-turn * speed * 0.08, -0.3, 0.3), 9, dt);
        st.idle += dt;
        const run = grounded ? r : 0;
        for (let i = 0; i < 2; i++) {
          const sw = Math.sin(ph + (i ? Math.PI : 0));
          const knee = (0.15 + 0.95 * Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 1.3))) * run;
          legs[i].thigh.rotation.x = lerp(sw * 0.85 * run, -0.75 - 0.2 * (i ? 1 : -1), st.air);
          legs[i].shin.rotation.x = lerp(knee, 1.1, st.air * (1 - st.fall * 0.6));
          const armSwing = -sw * 0.7 * run;
          arms[i].rotation.x = lerp(lerp(armSwing, -0.5, st.air), -1.4, i === 1 ? st.reach : 0);
          arms[i].rotation.z = (i ? -1 : 1) * (0.12 + st.balance * 1.1 + st.fall * 1.2 + Math.sin(st.idle * 7 + i) * 0.1 * st.balance);
        }
        const bob = grounded ? Math.abs(Math.sin(ph)) * 0.05 * r + Math.sin(st.idle * 2) * 0.008 * (1 - r) : 0;
        body.position.y = bob - st.squash * 0.14;
        body.scale.set(1 + st.squash * 0.12, 1 - st.squash * 0.2, 1 + st.squash * 0.12);
        body.rotation.set(-st.lean + st.fall * 0.25, st.yaw, st.roll + Math.sin(st.idle * 6) * 0.05 * st.balance + (p.stagger > 0 ? Math.sin(st.idle * 30) * 0.15 : 0));
        tail.rotation.x = 0.2 + clamp(speed * 0.1, 0, 0.9) + st.air * 0.5 + Math.sin(st.idle * 9) * 0.08 * r;
        mantle.scale.set(1 + st.air * 0.1, 1, 1 + st.air * 0.1 + clamp(speed * 0.02, 0, 0.15));
        head.rotation.x = st.lean * 0.4 - st.fall * 0.3;
        rootG.position.set(p.pos[0], p.pos[1], p.pos[2]);
        // contact shadow sits on whatever is under us
        blob.position.y = (info.groundY !== undefined ? info.groundY - p.pos[1] : 0) + 0.02;
        blob.material.opacity = 0.35 * clamp(1 - (p.pos[1] - (info.groundY !== undefined ? info.groundY : p.pos[1])) / 6, 0, 1);
      },
      land(impact) { st.squash = clamp(impact / 16, 0.12, 1); },
      takeoff() { st.squash = 0.35; }
    };
  };

  // ---------------- first-person hand ----------------
  V.makeHand = function (camera) {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(G.cyl, M.mantle); arm.scale.set(0.045, 0.42, 0.045); arm.rotation.x = -1.2; arm.position.set(0, -0.05, 0.1); g.add(arm);
    const hand = new THREE.Mesh(G.sphereLo, M.mask); hand.scale.set(0.05, 0.045, 0.06); hand.position.set(0, 0.06, -0.12); g.add(hand);
    const rod = new THREE.Mesh(G.cyl6, M.brass); rod.scale.set(0.012, 0.32, 0.012); rod.rotation.x = -1.35; rod.position.set(0, 0.09, -0.26); g.add(rod);
    const tip = new THREE.Mesh(G.ico, M.key); tip.scale.set(0.03, 0.05, 0.03); tip.position.set(0, 0.13, -0.42); g.add(tip);
    g.position.set(0.2, -0.24, -0.5);
    g.scale.setScalar(0.62);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
    camera.add(g);
    g.visible = false;
    return { g, tip, rest: g.position.clone() };
  };

  // ---------------- particles ----------------
  const NP = 700;
  const pg = new THREE.BufferGeometry();
  const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pSize = new Float32Array(NP), pA = new Float32Array(NP);
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pg.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pg.setAttribute('alpha', new THREE.BufferAttribute(pA, 1));
  const pm = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 300 }, map: { value: A.T.glow } },
    vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }',
    transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; scene.add(pts);
  V.pmat = pm;
  const parts = []; for (let i = 0; i < NP; i++) parts.push({ life: 0 });
  let cur = 0; const tc = new THREE.Color();
  V.spawn = function (p, n, o) {
    for (let k = 0; k < n; k++) {
      const q = parts[cur]; cur = (cur + 1) % NP;
      q.life = q.max = (o.life || 1) * (0.6 + Math.random() * 0.6);
      q.x = p[0] + (Math.random() - 0.5) * (o.sx || 0.6); q.y = p[1] + (Math.random() - 0.5) * (o.sy || 0.6); q.z = p[2] + (Math.random() - 0.5) * (o.sz || 0.6);
      const sp = o.speed || 1;
      q.vx = (Math.random() - 0.5) * sp + (o.vx || 0); q.vy = (Math.random() - 0.2) * sp + (o.vy || 0); q.vz = (Math.random() - 0.5) * sp + (o.vz || 0);
      q.g = o.g === undefined ? -2 : o.g; q.drag = o.drag || 1.5; q.size = (o.size || 0.3) * (0.6 + Math.random() * 0.8); q.grow = o.grow || 0;
      tc.set(o.color || '#e2d6c0'); q.r = tc.r; q.gg = tc.g; q.b = tc.b; q.a = o.alpha || 0.8;
    }
  };
  // cosmetic debris (never collides)
  const chunks = [];
  for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(G.ico, M.stone); m.visible = false; m.castShadow = true; scene.add(m); chunks.push({ m, life: 0 }); }
  let cc = 0;
  V.debris = function (p, n, mat, size, spread) {
    for (let k = 0; k < n; k++) {
      const c = chunks[cc]; cc = (cc + 1) % chunks.length;
      c.m.material = mat || M.stone; c.m.visible = true; c.life = 1.0 + Math.random() * 0.6;
      c.m.position.set(p[0] + (Math.random() - 0.5) * spread, p[1] + (Math.random() - 0.5) * spread, p[2] + (Math.random() - 0.5) * spread);
      c.s = (size || 0.2) * (0.5 + Math.random()); c.m.scale.setScalar(c.s);
      c.vx = (Math.random() - 0.5) * 5; c.vy = 1 + Math.random() * 4; c.vz = (Math.random() - 0.5) * 5;
    }
  };
  V.updateFx = function (dt) {
    for (let i = 0; i < NP; i++) {
      const q = parts[i];
      if (q.life > 0) {
        q.life -= dt; q.vy += q.g * dt; const dr = Math.exp(-q.drag * dt);
        q.vx *= dr; q.vy *= dr; q.vz *= dr; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.size += q.grow * dt;
        const k = Math.max(0, q.life / q.max);
        pPos[i * 3] = q.x; pPos[i * 3 + 1] = q.y; pPos[i * 3 + 2] = q.z;
        pCol[i * 3] = q.r; pCol[i * 3 + 1] = q.gg; pCol[i * 3 + 2] = q.b;
        pSize[i] = q.size; pA[i] = q.a * Math.min(1, k * 2.5);
      } else { pA[i] = 0; pSize[i] = 0; }
    }
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true; pg.attributes.size.needsUpdate = true; pg.attributes.alpha.needsUpdate = true;
    for (const c of chunks) {
      if (c.life <= 0) continue;
      c.life -= dt; c.vy -= 20 * dt;
      c.m.position.x += c.vx * dt; c.m.position.y += c.vy * dt; c.m.position.z += c.vz * dt;
      c.m.rotation.x += dt * 5; c.m.rotation.z += dt * 4;
      if (c.life < 0.4) c.m.scale.setScalar(c.s * Math.max(0.01, c.life / 0.4));
      if (c.life <= 0) c.m.visible = false;
    }
  };

  // ---------------- the exact region: chalk outlines ----------------
  // A pool of 12-edge box outlines drawn as thin boxes (lines stay legible at
  // any pixel ratio). Thickness follows camera distance so they read evenly.
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.unmake, transparent: true, depthWrite: false, fog: false });
  const EDGES = [];
  for (const a of [0, 1, 2]) { const o = [(a + 1) % 3, (a + 2) % 3]; for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) EDGES.push({ a, o, s1, s2 }); }
  const pool = [];
  function makeOutline() {
    const g = new THREE.Group(); const mat = lineMat.clone(); g.userData.mat = mat;
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(G.box, mat); m.renderOrder = 5; g.add(m); }
    g.visible = false; scene.add(g); return g;
  }
  let used = 0;
  V.beginOutlines = function () { used = 0; };
  V.outline = function (pos, rot, size, col, alpha, px, camPos, xray) {
    if (used >= pool.length) pool.push(makeOutline());
    const g = pool[used++];
    g.visible = true; g.position.set(pos[0], pos[1], pos[2]); g.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
    g.userData.mat.color.set(col); g.userData.mat.opacity = alpha; g.userData.mat.depthTest = !xray;
    const d = camPos ? camPos.distanceTo(g.position) : 10;
    const t = Math.max(0.012, d * (px || 0.0035));
    const h = [size[0] + t * 0.5, size[1] + t * 0.5, size[2] + t * 0.5];
    EDGES.forEach((e, i) => {
      const m = g.children[i]; const sc = [t, t, t]; sc[e.a] = h[e.a] * 2 + t; m.scale.set(sc[0], sc[1], sc[2]);
      const p = [0, 0, 0]; p[e.o[0]] = e.s1 * h[e.o[0]]; p[e.o[1]] = e.s2 * h[e.o[1]]; m.position.set(p[0], p[1], p[2]);
    });
  };
  V.endOutlines = function () { for (let i = used; i < pool.length; i++) pool[i].visible = false; };

  // ---------------- unmaking: the body's view becomes a ghost ----------------
  const ghosts = [];
  V.unmake = function (g, b, origin) {
    const m = g.userData.glaze;
    if (m) {
      const lp = new THREE.Vector3(origin[0], origin[1], origin[2]).applyMatrix4(m.userData.u.uInv.value);
      m.userData.u.uOrigin.value.copy(lp);
      const far = Math.max(...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => Math.hypot(x * b.size[0] - lp.x, y * b.size[1] - lp.y, z * b.size[2] - lp.z)))));
      m.userData.u.uRad.value = far;
      m.userData.u.uFocus.value = 0;
    }
    ghosts.push({ g, b: { pos: b.pos.slice(), rot: b.rot.slice(), size: b.size.slice() }, t: 0 });
  };
  V.unmakeConn = function (g) { ghosts.push({ g, conn: true, t: 0 }); };
  const WIPE = 0.34, LINGER = 1.0;
  V.updateGhosts = function (dt, camPos) {
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const q = ghosts[i]; q.t += dt;
      if (q.conn) {
        const k = Math.min(1, q.t / WIPE), mat = q.g.userData.mat, line = q.g.userData.line;
        mat.emissiveIntensity = 2.0 * (1 - k); line.scale.x = line.scale.z = Math.max(0.001, line.scale.x * (1 - k * 0.5));
        q.g.traverse(o => { if (o.isMesh && o !== line) o.visible = k < 0.5; });
        if (q.t > WIPE) { V.dispose(q.g); ghosts.splice(i, 1); }
        continue;
      }
      const m = q.g.userData.glaze;
      if (m) m.userData.u.uWipe.value = Math.min(1.01, smooth(Math.min(1, q.t / WIPE)) * 1.01);
      if (q.t > WIPE && q.g.parent) { V.dispose(q.g); }
      // the plan of what was there lingers, then is gone
      let a = q.t < WIPE ? 0.9 : 0.9 * (1 - (q.t - WIPE) / LINGER);
      if (camPos) a *= clamp((camPos.distanceTo(_p4.set(q.b.pos[0], q.b.pos[1], q.b.pos[2])) - 3) / 4, 0, 1);
      if (a > 0) V.outline(q.b.pos, q.b.rot, q.b.size, PALETTE.unmake, a, 0.0026, camPos);
      if (q.t > WIPE + LINGER) ghosts.splice(i, 1);
    }
  };
  V.clearGhosts = function () { for (const q of ghosts) V.dispose(q.g); ghosts.length = 0; };

  V.dispose = function (g) {
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.traverse(o => {
      if (o.isMesh || o.isSprite) {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m && m !== M.crackOverlay && ((m.userData && m.userData.own) || o.isSprite)) m.dispose();
      }
    });
  };
  return V;
}
