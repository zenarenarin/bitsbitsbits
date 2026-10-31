// =====================================================================
// The visible city. Architecture is built from the collision shapes
// (what you see is exactly what you stand on): tiled roofs with ridge
// caps and gable ends, plaster blocks with lit windows, oxidised pipes
// with flanges and supports, grated catwalks on hangers. Around them,
// lived-in detail, moving machinery, steam, and the relay tower on the
// horizon. Static geometry is merged per material: a handful of draw calls.
// =====================================================================

function createScene(THREE, A, scene, world, slice, hazards, opts) {
  const { M } = A;
  const root = new THREE.Group(); scene.add(root);
  const ownGeo = [], ownMat = [];
  const keep = g => { ownGeo.push(g); return g; };
  const own = m => { ownMat.push(m); return m; };
  const B = new Batch();          // near: casts and receives shadows
  const BF = new Batch();         // scenery and far layers: no shadows
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const xf = (x, y, z, sx, sy, sz, rx, ry, rz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx, sy, sz));
  const G = {
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 20, 1)), cyl8: keep(new THREE.CylinderGeometry(1, 1, 1, 8, 1)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)), dish: keep(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, 0.9)),
    torus: keep(new THREE.TorusGeometry(1, 0.12, 6, 16)), cone: keep(new THREE.ConeGeometry(1, 1, 7))
  };
  const PL = PAL.plaster.map(hex3), WHITE = [1, 1, 1];
  const plasterOf = b => PL[((b.plaster !== undefined ? b.plaster : b.id) % PL.length + PL.length) % PL.length];
  const lowCol = hex3('#14161b');
  const T = b => (b.far ? BF : B);

  // ---------------- architecture from shapes ----------------
  const fades = new Map(), unstableViews = [], bridges = [];
  for (const b of world.boxes) {
    const pc = plasterOf(b), Bt = T(b), dark = b.far ? 0.72 : 1;
    switch (b.kind) {
      case 'terrace':
        Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: mul3(hex3('#a39c90'), dark), sideCol: mul3(pc, dark), sideColLow: lowCol, fadeDepth: 9, uvSide: 3, uvShift: b.id * 1.7 });
        cornice(Bt, b, pc);
        break;
      case 'building':
        Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: mul3(hex3('#6f6a63'), dark), sideCol: mul3(pc, dark * 0.95), sideColLow: lowCol, fadeDepth: b.far ? 7 : 9, uvSide: 3, uvShift: b.id * 1.7 });
        cornice(Bt, b, pc);
        break;
      case 'parapet':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'concrete', side: 'wall', topCol: hex3('#b8b0a2'), sideCol: mul3(pc, 1.05), sideColLow: mul3(pc, 0.8), fadeDepth: 0.5, uvSide: 1.5 });
        break;
      case 'roof': roof(Bt, b, dark); break;
      case 'chimney':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'dark', side: 'brick', sideCol: WHITE, sideColLow: mul3(WHITE, 0.7), fadeDepth: 1.5, uvSide: 1 });
        B.box(b.x0 - 0.06, b.x1 + 0.06, b.y1 - 0.08, b.y1 + 0.02, b.z0 - 0.06, b.z1 + 0.06, { top: 'concrete', side: 'concrete', topCol: hex3('#7f7a72'), sideCol: hex3('#8d877e') });
        break;
      case 'pipe': pipe(b); break;
      case 'valve':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#b9a28a'), sideCol: hex3('#4e5a5c'), sideColLow: hex3('#2e3436'), fadeDepth: 0.6, uvTop: 1, uvSide: 1 });
        B.geo('metal', G.torus, xf(b.x0 + 0.35, b.y1 + 0.32, (b.z0 + b.z1) / 2, 0.24, 0.24, 0.24, 0, Math.PI / 2, 0), hex3('#8c3b2c'), THREE);
        B.geo('metal', G.cyl8, xf(b.x0 + 0.35, b.y1 + 0.16, (b.z0 + b.z1) / 2, 0.04, 0.32, 0.04), hex3('#4e5a5c'), THREE);
        break;
      case 'grate':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#c0a891'), sideCol: hex3('#4a5355'), sideColLow: hex3('#2a2f31'), fadeDepth: 0.5, uvTop: 1, uvSide: 1 });
        for (const x of [b.x0 + 0.1, b.x1 - 0.1]) for (const z of [b.z0 + 0.1, b.z1 - 0.1]) B.geo('metal', G.box, xf(x, (b.y0 + STREET_Y) / 2, z, 0.1, b.y0 - STREET_Y, 0.1), hex3('#3c4446'), THREE);
        break;
      case 'catwalk': {
        const target = b.unstable ? new Batch() : B;
        catwalk(target, b);
        if (b.unstable) {
          const g = target.build(THREE, { grate: M.grate, metal: M.metal, cable: M.cable }, { cast: true, receive: true });
          const spark = new THREE.Sprite(M.glowWarm); spark.scale.setScalar(0.25); spark.position.set(b.x1, b.y1 + 0.02, b.z1); g.add(spark);
          root.add(g); unstableViews.push({ b, g, spark });
        }
        break;
      }
      case 'rail':
        for (let z = b.z1 - 0.2; z > b.z0; z -= 0.9) B.geo('metal', G.box, xf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z, 0.035, b.y1 - b.y0, 0.035), hex3('#5a5048'), THREE);
        B.box(b.x0, b.x1, b.y1 - 0.04, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#7a6a5c'), sideCol: hex3('#5a4c40'), uvSide: 1 });
        break;
      case 'lowPipe': fades.set(b.id, lowPipe(b)); break;
      case 'tinRoof': shedRoof(b, 'tin'); break;
      case 'ramp': shedRoof(b, 'grate'); break;
      case 'tank':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#7d8a86'), sideCol: hex3('#45524f'), sideColLow: hex3('#1c2224'), fadeDepth: 3, uvTop: 1.5, uvSide: 1.5 });
        for (const y of [b.y1 - 0.15, b.y1 - 1.1, b.y1 - 2.1]) B.box(b.x0 - 0.04, b.x1 + 0.04, y - 0.06, y, b.z0 - 0.04, b.z1 + 0.04, { top: 'metal', side: 'metal', topCol: hex3('#3a4442'), sideCol: hex3('#2c3432'), faces: { pz: true, nz: true, px: true, nx: true } });
        break;
      case 'scaffold': scaffold(b); break;
      case 'bridge': bridges.push({ b, g: ropeBridge(b) }); break;
      case 'duct': fades.set(b.id, fadeBox(b, '#55605f')); break;
      case 'hopPipe':
        B.geo('metal', G.cyl, xf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, (b.y1 - b.y0) / 2, b.x1 - b.x0 + 0.8, (b.z1 - b.z0) / 2, 0, 0, Math.PI / 2), hex3('#7a5a46'), THREE);
        break;
      case 'machine':
        B.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'metal', side: 'metal', topCol: hex3('#4c5654'), sideCol: hex3('#3a4341'), uvSide: 1 });
        for (let i = 0; i < 4; i++) B.box(b.x1 - 0.02, b.x1 + 0.01, b.y0 + 0.25 + i * 0.16, b.y0 + 0.3 + i * 0.16, b.z0 + 0.3, b.z1 - 0.3, { top: 'dark', side: 'dark', faces: { px: true } });
        { const sp = new THREE.Sprite(M.glowRed); sp.position.set(b.x1 + 0.05, b.y1 - 0.15, b.z1 - 0.2); sp.scale.setScalar(0.25); root.add(sp); }
        break;
    }
  }
  function cornice(Bt, b, pc) {
    if (b.y1 - b.y0 < 2) return;
    Bt.box(b.x0 - 0.06, b.x1 + 0.06, b.y1 - 0.22, b.y1 - 0.05, b.z0 - 0.06, b.z1 + 0.06, { top: 'plain', side: 'plain', topCol: mul3(pc, 0.8), sideCol: mul3(pc, 0.62), faces: { pz: true, nz: true, px: true, nx: true, top: true } });
  }
  // pitched roofs: two tiled slopes, a ridge cap, plaster gable ends, dark eaves
  function roof(Bt, b, dark) {
    const tc = mul3(WHITE, dark * (0.85 + ((b.id * 37) % 10) / 40)), eaveC = mul3(tc, 0.72), pc = mul3(plasterOf(b), dark * 0.9);
    const slope = (a, bb, c, d, n, len, w) => Bt.quad('tile', a, bb, c, d, n, [[0, 0], [w, 0], [w, len], [0, len]], [eaveC, eaveC, tc, tc]);
    if (b.shape === 'gableX') {
      const zc = (b.z0 + b.z1) / 2, hl = (b.z1 - b.z0) / 2, rise = b.yr - b.ye, len = Math.hypot(hl, rise), w = b.x1 - b.x0;
      const nN = [0, hl / len, rise / len], nF = [0, hl / len, -rise / len];
      slope([b.x0, b.ye, b.z1], [b.x1, b.ye, b.z1], [b.x1, b.yr, zc], [b.x0, b.yr, zc], nN, len, w);
      slope([b.x1, b.ye, b.z0], [b.x0, b.ye, b.z0], [b.x0, b.yr, zc], [b.x1, b.yr, zc], nF, len, w);
      Bt.geo('tile', G.cyl8, xf((b.x0 + b.x1) / 2, b.yr, zc, 0.075, w + 0.04, 0.075, 0, 0, Math.PI / 2), mul3(tc, 0.75), THREE);
      for (const [x, s] of [[b.x0 + 0.18, -1], [b.x1 - 0.18, 1]]) {
        Bt.tri('wall', [x, b.ye, s < 0 ? b.z1 - 0.15 : b.z0 + 0.15], [x, b.ye, s < 0 ? b.z0 + 0.15 : b.z1 - 0.15], [x, b.yr - 0.08, zc], [s, 0, 0], [[0, 0], [1, 0], [0.5, 0.4]], [pc, pc, pc]);
        Bt.quad('wall', [x, b.y0, b.z1 - 0.15], [x, b.y0, b.z0 + 0.15], [x, b.ye, b.z0 + 0.15], [x, b.ye, b.z1 - 0.15], [s, 0, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], [pc, pc, pc, pc]);
      }
      for (const z of [b.z0, b.z1]) Bt.box(b.x0, b.x1, b.ye - 0.1, b.ye + 0.01, z - 0.04, z + 0.04, { top: 'dark', side: 'dark' });
    } else {
      const xc = (b.x0 + b.x1) / 2, hw = (b.x1 - b.x0) / 2, rise = b.yr - b.ye, len = Math.hypot(hw, rise), w = b.z1 - b.z0;
      const nL = [-rise / len, hw / len, 0], nR = [rise / len, hw / len, 0];
      slope([b.x0, b.ye, b.z0], [b.x0, b.ye, b.z1], [xc, b.yr, b.z1], [xc, b.yr, b.z0], nL, len, w);
      slope([b.x1, b.ye, b.z1], [b.x1, b.ye, b.z0], [xc, b.yr, b.z0], [xc, b.yr, b.z1], nR, len, w);
      Bt.geo('tile', G.cyl8, xf(xc, b.yr, (b.z0 + b.z1) / 2, 0.075, w + 0.04, 0.075, Math.PI / 2, 0, 0), mul3(tc, 0.75), THREE);
      for (const [z, s] of [[b.z1 - 0.12, 1], [b.z0 + 0.12, -1]]) {
        Bt.tri('wall', [s > 0 ? b.x0 + 0.15 : b.x1 - 0.15, b.ye, z], [s > 0 ? b.x1 - 0.15 : b.x0 + 0.15, b.ye, z], [xc, b.yr - 0.08, z], [0, 0, s], [[0, 0], [1, 0], [0.5, 0.4]], [pc, pc, pc]);
        Bt.quad('wall', [b.x0 + 0.15, b.y0, z], [b.x1 - 0.15, b.y0, z], [b.x1 - 0.15, b.ye, z], [b.x0 + 0.15, b.ye, z], [0, 0, s], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], [pc, pc, pc, pc]);
      }
      for (const x of [b.x0, b.x1]) Bt.box(x - 0.04, x + 0.04, b.ye - 0.1, b.ye + 0.01, b.z0, b.z1, { top: 'dark', side: 'dark' });
    }
  }
  function shedRoof(b, mat) {
    const tc = hex3('#c9bca8'), lc = mul3(tc, 0.75), w = b.x1 - b.x0, len = Math.hypot(b.z1 - b.z0, b.yNear - b.yFar);
    const n = [0, (b.z1 - b.z0) / len, (b.yNear - b.yFar) / len];
    B.quad(mat, [b.x0, b.yFar, b.z0], [b.x0, b.yNear, b.z1], [b.x1, b.yNear, b.z1], [b.x1, b.yFar, b.z0], n, [[0, 0], [len, 0], [len, w], [0, w]], [lc, tc, tc, lc]);
    const pc = plasterOf(b);
    for (const [x, s] of [[b.x0 + 0.05, -1], [b.x1 - 0.05, 1]]) B.quad('wall', [x, b.y0, b.z1], [x, b.y0, b.z0], [x, b.yFar, b.z0], [x, b.yNear, b.z1], [s, 0, 0], [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [pc, pc, pc, pc]);
    B.box(b.x0, b.x1, b.yFar - 0.12, b.yFar, b.z0 - 0.05, b.z0 + 0.03, { top: 'dark', side: 'dark' });
  }
  // pipes: oxidised steel with flanges, and supports down into the alley
  function pipe(b) {
    const len = b.z1 - b.z0, zc = (b.z0 + b.z1) / 2, c = b.narrow ? hex3('#6f4f3e') : hex3('#4f6366');
    // inclined pipes run from cy at the near end to cyFar at the far end
    const yAt = z => world.pipeY(b, z), dir = new THREE.Vector3(0, yAt(b.z0) - yAt(b.z1), -len), L = dir.length(); dir.normalize();
    const along = (z, sx, sy, sz) => { _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); return _m.compose(_p.set(b.cx, yAt(z), z), _q, _s.set(sx, sy, sz)); };
    const g = keep(new THREE.CylinderGeometry(b.r, b.r, L, b.narrow ? 14 : 22, 1, true));
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b.r * TAU), uv.getY(i) * L / 1.5);
    B.geo('metal', g, along(zc, 1, 1, 1), c, THREE);
    for (let z = b.z1 - 1.2; z > b.z0 + 0.4; z -= 2.4) B.geo('metal', G.cyl, along(z, b.r * 1.13, 0.09, b.r * 1.13), mul3(c, 0.7), THREE);
    for (let z = b.z1 - 3; z > b.z0 + 1; z -= 6) {
      const y = yAt(z);
      B.geo('metal', G.box, xf(b.cx, (y - b.r + STREET_Y) / 2, z, 0.12, y - b.r - STREET_Y, 0.12), hex3('#3a4244'), THREE);
      B.geo('metal', G.box, xf(b.cx, y - b.r - 0.05, z, b.r * 2.2, 0.1, 0.14), hex3('#3a4244'), THREE);
    }
  }
  function catwalk(Bt, b) {
    Bt.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'grate', side: 'metal', topCol: hex3('#c2a993'), sideCol: hex3('#52504a'), uvTop: 1, uvSide: 1 });
    for (let z = b.z1 - 0.3; z > b.z0; z -= 2) {
      Bt.geo('metal', G.box, xf((b.x0 + b.x1) / 2, b.y0 - 0.04, z, b.x1 - b.x0 + 0.1, 0.06, 0.08), hex3('#3a3a36'), THREE);
      for (const x of [b.x0 - 0.03, b.x1 + 0.03]) Bt.geo('cable', G.cyl8, xf(x, b.y1 + 2.2, z, 0.012, 4.4, 0.012), WHITE, THREE);
    }
  }
  // scaffolding: plank deck on a pole frame that runs down into the alley
  function scaffold(b) {
    for (let x = b.x0 + 0.08; x < b.x1; x += 0.24) B.box(x, Math.min(b.x1, x + 0.21), b.y0, b.y1, b.z0, b.z1, { top: 'plain', side: 'plain', topCol: mul3(hex3('#8a6a48'), 0.85 + ((x * 31) % 1) * 0.3), sideCol: hex3('#5a4430') });
    for (const x of [b.x0 + 0.05, b.x1 - 0.05]) for (const z of [b.z0 + 0.05, b.z1 - 0.05]) B.geo('metal', G.cyl8, xf(x, (b.y1 + 0.9 + STREET_Y) / 2, z, 0.03, b.y1 + 0.9 - STREET_Y, 0.03), hex3('#6b6a62'), THREE);
    for (let y = b.y0 - 1.5; y > STREET_Y; y -= 2) for (const z of [b.z0 + 0.05, b.z1 - 0.05]) B.geo('metal', G.cyl8, xf((b.x0 + b.x1) / 2, y, z, 0.025, b.x1 - b.x0, 0.025, 0, 0, Math.PI / 2), hex3('#6b6a62'), THREE);
    B.geo('metal', G.cyl8, xf((b.x0 + b.x1) / 2, b.y1 + 0.85, b.z0 + 0.05, 0.025, b.x1 - b.x0, 0.025, 0, 0, Math.PI / 2), hex3('#6b6a62'), THREE);
  }
  // rope bridge: slatted planks on two ropes, hung from anchors; moves with the sway
  function ropeBridge(b) {
    const T2 = new Batch(), w = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2;
    for (let z = b.z1 - 0.1; z > b.z0; z -= 0.27) T2.box(b.x0 - 0.04, b.x1 + 0.04, b.y0, b.y1, z - 0.2, z, { top: 'plain', side: 'plain', topCol: mul3(hex3('#7d5f40'), 0.8 + ((z * 7.3) % 1 + 1) % 1 * 0.35), sideCol: hex3('#4a3828') });
    const len = b.z1 - b.z0;
    for (const x of [b.x0 - 0.05, b.x1 + 0.05]) {
      for (const y of [b.y1 - 0.03, b.y1 + 0.45]) T2.geo('cable', G.cyl8, xf(x, y, (b.z0 + b.z1) / 2, 0.012, len, 0.012, Math.PI / 2, 0, 0), WHITE, THREE);
      for (let z = b.z1 - 0.5; z > b.z0; z -= 1) T2.geo('cable', G.cyl8, xf(x, b.y1 + 0.22, z, 0.008, 0.45, 0.008), WHITE, THREE);
    }
    void w; void cx;
    const g = T2.build(THREE, { plain: M.plain, cable: M.cable }, { cast: true, receive: true });
    root.add(g);
    // anchors on each end stay put
    for (const z of [b.z0, b.z1]) for (const x of [b.x0 - 0.12, b.x1 + 0.12]) B.geo('metal', G.box, xf(x, b.y1 + 0.3, z, 0.06, 0.7, 0.06), hex3('#4a4a44'), THREE);
    return g;
  }
  // a fading obstruction the camera must see past (ducts, low pipes)
  function fadeBox(b, col) {
    const g = new THREE.Group(), mat = own(new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 1 }));
    const m = new THREE.Mesh(G.box, mat); m.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0); m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2); m.castShadow = true; g.add(m);
    for (const x of [b.x0 + 0.15, b.x1 - 0.15]) { const s2 = new THREE.Mesh(G.box, mat); s2.scale.set(0.06, 0.6, (b.z1 - b.z0) + 0.06); s2.position.set(x, b.y1 + 0.2, (b.z0 + b.z1) / 2); g.add(s2); }
    root.add(g);
    return { g, mat, k: 1 };
  }
  function lowPipe(b) {
    const g = new THREE.Group(), mat = own(new THREE.MeshLambertMaterial({ color: '#6c7e80', transparent: true, opacity: 1 }));
    const len = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, h = b.y1 - b.y0;
    for (const [dz, r] of [[-0.18, h * 0.45], [0.2, h * 0.38]]) { const m = new THREE.Mesh(G.cyl, mat); m.scale.set(r, len, r); m.rotation.z = Math.PI / 2; m.position.set(cx, b.y0 + r, cz + dz); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    for (const sx of [b.x0 + 0.2, b.x1 - 0.2]) { const s = new THREE.Mesh(G.box, mat); s.scale.set(0.05, h + 0.06, (b.z1 - b.z0) * 0.95); s.position.set(sx, b.y0 + h / 2, cz); g.add(s); }
    root.add(g);
    return { g, mat, k: 1 };
  }

  // ---------------- steam and smoke: pooled particles ----------------
  const PART_VS = 'attribute float aLife; attribute float aSize; varying float vLife; uniform float uScale; void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (0.6 + aLife * 1.6) * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }';
  const PART_FS = 'uniform sampler2D map; uniform vec3 color; uniform float opacity; varying float vLife; void main(){ if (vLife <= 0.0 || vLife >= 1.0) discard; vec4 t = texture2D(map, gl_PointCoord); float a = t.a * opacity * smoothstep(0.0, 0.12, vLife) * (1.0 - vLife); gl_FragColor = vec4(color, a); }';
  const partMats = {};
  function partMat(kind) {
    if (partMats[kind]) return partMats[kind];
    const steam = kind === 'steam';
    return partMats[kind] = own(new THREE.ShaderMaterial({
      uniforms: { map: { value: A.T.puff }, color: { value: new THREE.Color(steam ? '#d4dde2' : '#2f353d') }, opacity: { value: steam ? 0.65 : 0.5 }, uScale: { value: 300 } },
      vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false
    }));
  }
  function emitter(_unused, n, at, kind) {
    const g = keep(new THREE.BufferGeometry());
    const pos = new Float32Array(n * 3), life = new Float32Array(n), size = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(life, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(g, partMat(kind)); pts.frustumCulled = false; root.add(pts);
    return { g, pos, life, size, vel: new Float32Array(n * 3), dur: new Float32Array(n), n, at, kind, acc: 0, next: 0 };
  }
  function emit(e, rate, dt, spawn) {
    e.acc += rate * dt;
    while (e.acc >= 1) { e.acc -= 1; const i = e.next; e.next = (e.next + 1) % e.n; spawn(i); }
  }
  function stepEmitter(e, dt, buoy) {
    for (let i = 0; i < e.n; i++) {
      if (e.life[i] <= 0 || e.life[i] >= 1) { e.life[i] = 0; continue; }
      e.life[i] += dt / e.dur[i];
      e.vel[i * 3 + 1] += buoy * dt; e.vel[i * 3] *= 1 - dt * 0.8; e.vel[i * 3 + 2] *= 1 - dt * 0.8;
      for (let k = 0; k < 3; k++) e.pos[i * 3 + k] += e.vel[i * 3 + k] * dt;
    }
    e.g.attributes.position.needsUpdate = true; e.g.attributes.aLife.needsUpdate = true; e.g.attributes.aSize.needsUpdate = true;
  }
  // ---------------- lived-in detail and machinery ----------------
  const lamps = [], fans = [], smokes = [], signal = [], sparks = [];
  const glowMat = c => (c === 'green' ? M.glowGreen : c === 'violet' ? M.glowViolet : M.glowWarm);
  for (const d of slice.decor) {
    switch (d.kind) {
      case 'pots':
        for (let i = 0; i < 3; i++) {
          const x = d.x + (i - 1) * 0.2, s = 0.07 + i * 0.012;
          B.geo('brick', G.cyl8, xf(x, d.y + s * 0.9, d.z, s, s * 1.8, s), WHITE, THREE);
          for (let k = 0; k < 3; k++) B.geo('plain', G.cone, xf(x + (k - 1) * 0.03, d.y + s * 1.8 + 0.08, d.z + (k % 2) * 0.02, s * 0.45, 0.18 + k * 0.03, s * 0.45, 0, 0, (k - 1) * 0.35), hex3('#2c3d27'), THREE);
        }
        break;
      case 'lamp': {
        B.geo('metal', G.box, xf(d.x, d.y, d.z, 0.12, 0.08, 0.16), hex3('#2a2d30'), THREE);
        const sp = new THREE.Sprite(glowMat(d.color)); sp.scale.setScalar(d.color === 'warm' ? 1.4 : 1.8); sp.position.set(d.x, d.y - 0.06, d.z); root.add(sp);
        lamps.push({ sp, base: sp.scale.x, ph: lamps.length * 1.7, flicker: d.color !== 'warm' });
        break;
      }
      case 'antenna':
        B.geo('metal', G.cyl8, xf(d.x, d.y + 0.9, d.z, 0.02, 1.8, 0.02), hex3('#3a3c40'), THREE);
        for (let i = 0; i < 3; i++) B.geo('metal', G.box, xf(d.x, d.y + 1.2 + i * 0.22, d.z, 0.7 - i * 0.15, 0.02, 0.02), hex3('#3a3c40'), THREE);
        B.geo('plain', G.dish, xf(d.x - 0.2, d.y + 0.7, d.z + 0.2, 0.28, 0.28, 0.1, Math.PI / 2 - 0.3, 0.6, 0), hex3('#9a9890'), THREE);
        break;
      case 'brokenRoof': {
        // the hole: dark rafters across it, splintered tiles at its edges
        for (let x = d.x0 + 0.3; x < d.x1; x += 0.55) B.geo('plain', G.box, xf(x, d.eave + (d.y - d.eave) * (1 - Math.abs(x - (d.x0 + d.x1) / 2) / ((d.x1 - d.x0) / 2)) - 0.08, (d.z0 + d.z1) / 2, 0.07, 0.07, d.z1 - d.z0 + 0.2), hex3('#2a211b'), THREE);
        B.geo('plain', G.box, xf((d.x0 + d.x1) / 2, d.y - 0.12, (d.z0 + d.z1) / 2, 0.1, 0.1, d.z1 - d.z0 + 0.3), hex3('#2a211b'), THREE);
        break;
      }
      case 'tank':
        BF.geo('dark', G.cyl, xf(d.x, d.y + 0.35 + d.h / 2, d.z, d.r, d.h, d.r), WHITE, THREE);
        for (const s of [-1, 1]) BF.geo('metal', G.box, xf(d.x + s * d.r * 0.6, d.y + 0.17, d.z, 0.08, 0.35, d.r * 1.6), hex3('#4a4f52'), THREE);
        break;
      case 'stack': {
        BF.geo('metal', G.cyl, xf(d.x, d.y + d.h / 2, d.z, 0.28, d.h, 0.28), hex3('#5a5650'), THREE);
        BF.geo('metal', G.cyl, xf(d.x, d.y + d.h - 0.1, d.z, 0.33, 0.12, 0.33), hex3('#2c2b2a'), THREE);
        if (smokes.length < 6) smokes.push(emitter(M.smoke, 26, [d.x, d.y + d.h + 0.1, d.z], 'smoke'));
        break;
      }
      case 'crossPipe': {
        const len = d.x1 - d.x0, c = hex3('#57686a');
        BF.geo('metal', G.cyl, xf((d.x0 + d.x1) / 2, d.y, d.z, d.r, len, d.r, 0, 0, Math.PI / 2), c, THREE);
        for (let x = d.x0 + 1.5; x < d.x1; x += 3) BF.geo('metal', G.cyl, xf(x, d.y, d.z, d.r * 1.12, 0.1, d.r * 1.12, 0, 0, Math.PI / 2), mul3(c, 0.7), THREE);
        for (const x of [d.x0 + 2, d.x1 - 2]) BF.geo('cable', G.cyl8, xf(x, d.y + 3, d.z, 0.02, 6, 0.02), WHITE, THREE);
        break;
      }
      case 'bowl':
        B.geo('plain', G.cyl8, xf(d.x, d.y + 0.03, d.z, 0.09, 0.06, 0.09), hex3('#8a3a2c'), THREE);
        B.geo('plain', G.cyl8, xf(d.x + 0.2, d.y + 0.02, d.z + 0.1, 0.07, 0.04, 0.07), hex3('#7a7f86'), THREE);
        break;
      case 'gauge':
        B.geo('metal', G.cyl8, xf(d.x + 1.5, d.y + 0.25, d.z, 0.16, 0.06, 0.16, Math.PI / 2, 0, 0), hex3('#c9c1a8'), THREE);
        B.geo('metal', G.cyl8, xf(d.x + 1.5, d.y + 0.1, d.z, 0.03, 0.2, 0.03), hex3('#3a3a36'), THREE);
        break;
      case 'brokenCatwalk':
        for (const [z, s2] of [[d.z1, 1], [d.z0, -1]]) B.geo('grate', G.box, xf((d.x0 + d.x1) / 2, d.y - 0.35, z - s2 * 0.12, d.x1 - d.x0, 0.05, 0.75, s2 * 1.1, 0, 0.1 * s2), hex3('#9a846e'), THREE);
        B.geo('cable', G.cyl8, xf(d.x1 + 0.05, d.y - 0.9, (d.z0 + d.z1) / 2, 0.01, 1.8, 0.01, 0.2, 0, 0), WHITE, THREE);
        break;
      case 'signalLine':
        for (let i = 0; i + 1 < d.points.length; i++) {
          const a = new THREE.Vector3(...d.points[i]), c = new THREE.Vector3(...d.points[i + 1]), mid = a.clone().lerp(c, 0.5); mid.y -= 0.6 + a.distanceTo(c) * 0.03;
          const mat = own(new THREE.MeshBasicMaterial({ color: '#16191d' }));
          const m = new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 24, 0.025, 5, false)), mat);
          root.add(m); signal.push({ m, mat, lit: 0 });
        }
        break;
      case 'snapped': {
        B.geo('cable', G.cyl8, xf(d.x, d.y - 0.35, d.z, 0.014, 0.7, 0.014, 0.25, 0, 0.15), WHITE, THREE);
        const sp = new THREE.Sprite(M.glowGreen); sp.position.set(d.x + 0.05, d.y - 0.72, d.z + 0.08); sp.scale.setScalar(0.3); root.add(sp); sparks.push(sp);
        break;
      }
      case 'struts':
        for (let z = d.z1 - 0.4; z > d.z0; z -= 1.6) BF.geo('metal', G.box, xf(d.x + d.side * 0.35, d.y - 0.5, z, 0.06, 1.25, 0.06, 0, 0, d.side * 0.7), hex3('#4a4642'), THREE);
        break;
      case 'scaffoldFace':
        for (let z = d.z1; z >= d.z0; z -= 1.6) BF.geo('metal', G.cyl8, xf(d.x, (d.y0 + d.y1) / 2, z, 0.03, d.y1 - d.y0, 0.03), hex3('#5f5e57'), THREE);
        for (let y = d.y1 - 0.2; y > d.y0; y -= 2) {
          BF.geo('metal', G.cyl8, xf(d.x, y, (d.z0 + d.z1) / 2, 0.025, d.z1 - d.z0, 0.025, Math.PI / 2, 0, 0), hex3('#5f5e57'), THREE);
          BF.box(d.x - 0.25, d.x + 0.25, y - 0.05, y, d.z0, d.z1, { top: 'plain', side: 'plain', topCol: hex3('#6e553a'), sideCol: hex3('#4a3a2a') });
        }
        break;
      case 'balcony': {
        const s2 = d.side, x0 = Math.min(d.x, d.x + s2 * 0.9), x1 = Math.max(d.x, d.x + s2 * 0.9);
        BF.box(x0, x1, d.y - 0.1, d.y, d.z - 0.9, d.z + 0.9, { top: 'concrete', side: 'plain', topCol: hex3('#6f6a62'), sideCol: hex3('#5a5650') });
        BF.box(s2 > 0 ? x1 - 0.04 : x0, s2 > 0 ? x1 : x0 + 0.04, d.y, d.y + 0.8, d.z - 0.9, d.z + 0.9, { top: 'metal', side: 'metal', sideCol: hex3('#2c2e30'), topCol: hex3('#2c2e30') });
        BF.box(x0 + 0.1, x1 - 0.1, d.y, d.y + 0.45, d.z - 0.7, d.z - 0.1, { top: 'metal', side: 'metal', sideCol: hex3('#a9aca6'), topCol: hex3('#b9bcb6') });
        break;
      }
      case 'cable': {
        const a = new THREE.Vector3(...d.a), c = new THREE.Vector3(...d.b), mid = a.clone().lerp(c, 0.5); mid.y -= d.sag || 0.6;
        const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 12, 0.014, 4, false);
        BF.geo('cable', g, _m.identity(), WHITE, THREE); g.dispose();
        break;
      }
      case 'skyBridge':
        BF.box(d.x0, d.x1, d.y, d.y + 1.6, d.z - 0.8, d.z + 0.8, { top: 'metal', side: 'wall', topCol: hex3('#3a4241'), sideCol: hex3('#7f8478'), sideColLow: hex3('#5a5e56'), fadeDepth: 2, uvSide: 3, uvShift: d.z });
        BF.box(d.x0, d.x1, d.y - 0.2, d.y, d.z - 0.9, d.z + 0.9, { top: 'metal', side: 'metal', topCol: hex3('#3a4241'), sideCol: hex3('#2a302f') });
        break;
      case 'farBlock': {
        const k = clamp(1 - Math.abs(d.x) / 70, 0.45, 0.85), pc = mul3(PL[(Math.abs(d.x * 7 + d.z) | 0) % PL.length], k);
        BF.box(d.x - d.w / 2, d.x + d.w / 2, STREET_Y, d.top, d.z - d.d / 2, d.z + d.d / 2, { top: 'concrete', side: 'wall', topCol: mul3(pc, 0.6), sideCol: pc, sideColLow: lowCol, fadeDepth: 10, uvSide: 3, uvShift: d.z * 0.37 });
        if (d.roof) {
          const rb = d.roof === 'z' ? { shape: 'gableZ', x0: d.x - d.w / 2 - 0.2, x1: d.x + d.w / 2 + 0.2, z0: d.z - d.d / 2 - 0.2, z1: d.z + d.d / 2 + 0.2, y0: d.top, ye: d.top + 0.3, yr: d.top + 0.3 + d.w * 0.3, id: (d.z * 3) | 0 }
                                    : { shape: 'gableX', x0: d.x - d.w / 2 - 0.2, x1: d.x + d.w / 2 + 0.2, z0: d.z - d.d / 2 - 0.2, z1: d.z + d.d / 2 + 0.2, y0: d.top, ye: d.top + 0.3, yr: d.top + 0.3 + d.d * 0.3, id: (d.z * 3) | 0 };
          roof(BF, rb, k * 0.9);
        }
        if (d.stack) { BF.geo('metal', G.cyl, xf(d.x, d.top + 3, d.z, 0.5, 6, 0.5), hex3('#3c3a38'), THREE); if (smokes.length < 6) smokes.push(emitter(M.smoke, 26, [d.x, d.top + 6.2, d.z], 'smoke')); }
        break;
      }
    }
  }
  // two industrial fans in the alleys, turning
  for (const [x, y, z, ry] of [[3.6, 0.9, -39, -Math.PI / 2], [-2.6, 1.1, -57.5, Math.PI / 2]]) {
    B.box(x - 0.15, x + 0.15, y - 0.75, y + 0.75, z - 0.75, z + 0.75, { top: 'metal', side: 'metal', sideCol: hex3('#3e4648'), topCol: hex3('#4a5355'), uvSide: 1 });
    const hub = new THREE.Group(); hub.position.set(x - Math.sign(x) * 0.17, y, z); hub.rotation.y = ry;
    const mat = M.dark;
    for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(G.box, mat); bl.scale.set(0.16, 0.62, 0.03); bl.position.y = 0.3; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
    B.geo('metal', G.torus, xf(x - Math.sign(x) * 0.16, y, z, 0.7, 0.7, 1.4, 0, ry, 0), hex3('#59605e'), THREE);
    for (let i = -2; i <= 2; i++) B.geo('metal', G.box, xf(x - Math.sign(x) * 0.2, y + i * 0.22, z, 0.02, 0.02, 1.3), hex3('#2a2e30'), THREE);   // a grille over it
    root.add(hub); fans.push(hub);
  }

  const rp = makeRng(5);
  // vents on the great pipe: a stub, a warning lamp, and a column of steam
  const vents = hazards.vents.map(v => {
    B.geo('metal', G.cyl8, xf(v.x, v.y + 0.04, v.z, 0.16, 0.12, 0.16), hex3('#3a3f42'), THREE);
    B.geo('metal', G.cyl8, xf(v.x, v.y + 0.11, v.z, 0.2, 0.03, 0.2), hex3('#8c3b2c'), THREE);
    const lamp = new THREE.Sprite(M.glowRed); lamp.position.set(v.x, v.y + 0.16, v.z); lamp.scale.setScalar(0.4); root.add(lamp);
    return { v, lamp, e: emitter(null, 70, [v.x, v.y + 0.12, v.z], 'steam') };
  });

  // ---------------- the objective: fragments, relay, tower ----------------
  const frags = hazards.fragments.map(f => {
    const g = new THREE.Group(); g.position.set(f.x, f.y, f.z);
    const m = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.085, 0)), M.fragment); m.scale.set(0.8, 1.3, 0.8); g.add(m);
    const sp = new THREE.Sprite(M.glowGreen); sp.scale.setScalar(0.9); g.add(sp);
    root.add(g); return { f, g, m, sp, pop: 0 };
  });
  const wps = hazards.waypoints.map(w => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.geo('metal', G.box, xf(w.x + sx * 0.12, w.y + 1.4, w.z + sz * 0.12, 0.03, 2.8, 0.03, sz * 0.04, 0, -sx * 0.04), hex3('#3c4244'), THREE);
    for (let i = 1; i < 6; i++) B.geo('metal', G.box, xf(w.x, w.y + i * 0.5, w.z, 0.26, 0.025, 0.26), hex3('#3c4244'), THREE);
    B.geo('plain', G.dish, xf(w.x - 0.1, w.y + 2.3, w.z, 0.28, 0.28, 0.1, -0.3, -0.8, Math.PI / 2), hex3('#8a887e'), THREE);
    const lamp = new THREE.Sprite(M.glowRed); lamp.position.set(w.x, w.y + 2.9, w.z); lamp.scale.setScalar(0.35); root.add(lamp);
    return { w, lamp };
  });
  const R = hazards.relay;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.geo('metal', G.box, xf(R.x + sx * 0.22, R.y + 1.5, R.z + sz * 0.22, 0.04, 3, 0.04, sz * 0.06, 0, -sx * 0.06), hex3('#3c4244'), THREE);
  for (let i = 1; i < 6; i++) B.geo('metal', G.box, xf(R.x, R.y + i * 0.5, R.z, 0.46 - i * 0.03, 0.03, 0.46 - i * 0.03), hex3('#3c4244'), THREE);
  B.geo('plain', G.dish, xf(R.x + 0.25, R.y + 2.4, R.z, 0.45, 0.45, 0.16, -0.3, -0.9, Math.PI / 2), hex3('#a8a69c'), THREE);
  const relayLamp = new THREE.Sprite(M.glowRed); relayLamp.position.set(R.x, R.y + 3.15, R.z); relayLamp.scale.setScalar(0.9); root.add(relayLamp);
  const TW = slice.tower, beamMat = own(new THREE.MeshBasicMaterial({ color: PAL.green, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const beam = new THREE.Mesh(G.cyl8, beamMat); root.add(beam);
  { const a = new THREE.Vector3(R.x, R.y + 3.15, R.z), b = new THREE.Vector3(TW.x, TW.base + TW.height + 2, TW.z), d = b.clone().sub(a);
    beam.position.copy(a).addScaledVector(d, 0.5); beam.scale.set(0.05, d.length(), 0.05); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }
  // the relay tower: a tapering lattice, silhouetted, with its beacon
  const towerMat = own(new THREE.MeshBasicMaterial({ color: '#121822', fog: false }));
  const TB = new Batch();
  const legAt = (t, sx, sz) => { const w = lerp(7, 1.2, t); return new THREE.Vector3(TW.x + sx * w, TW.base + t * TW.height, TW.z + sz * w); };
  const strut = (a, b2, r) => { const d = b2.clone().sub(a), mid = a.clone().addScaledVector(d, 0.5); _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); _m.compose(mid, _q, _s.set(r, d.length(), r)); TB.geo('t', G.box, _m, WHITE, THREE); };
  const C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C4) strut(legAt(0, sx, sz), legAt(1, sx, sz), 0.5);
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9, t1 = (i + 1) / 9;
    for (let k = 0; k < 4; k++) { const [ax, az] = C4[k], [bx, bz] = C4[(k + 1) % 4]; strut(legAt(t0, ax, az), legAt(t1, bx, bz), 0.2); strut(legAt(t0, bx, bz), legAt(t1, ax, az), 0.2); strut(legAt(t1, ax, az), legAt(t1, bx, bz), 0.25); }
  }
  strut(new THREE.Vector3(TW.x, TW.base + TW.height, TW.z), new THREE.Vector3(TW.x, TW.base + TW.height + 10, TW.z), 0.3);
  _m.compose(_p.set(TW.x, TW.base + TW.height * 0.62, TW.z), _q.identity(), _s.set(8, 1.2, 8)); TB.geo('t', G.box, _m, WHITE, THREE);
  const tower = TB.build(THREE, { t: towerMat }); root.add(tower);
  const beaconMat = own(new THREE.SpriteMaterial({ map: A.T.glow, color: PAL.green, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const beacon = new THREE.Sprite(beaconMat); beacon.position.set(TW.x, TW.base + TW.height + 10, TW.z); beacon.scale.setScalar(16); root.add(beacon);
  const towerLights = [];
  for (let i = 1; i < 5; i++) { const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: A.T.glow, color: i % 2 ? PAL.violet : PAL.green, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))); sp.position.copy(legAt(i / 5, 1, 1)); sp.scale.setScalar(5); root.add(sp); towerLights.push(sp); }

  // ---------------- build the static batches ----------------
  const MATS = { tile: M.tile, wall: M.wall, metal: M.metal, grate: M.grate, brick: M.brick, tin: M.tin, concrete: M.concrete, plain: M.plain, dark: M.dark, cable: M.cable };
  const near = B.build(THREE, MATS, { cast: true, receive: true });
  const far = BF.build(THREE, MATS, { cast: false, receive: false });
  root.add(near); root.add(far);
  // the street, far below, with a few warm lights deep in the alleys
  const street = new THREE.Mesh(keep(new THREE.PlaneGeometry(500, 700)), M.street);
  street.rotation.x = -Math.PI / 2; street.position.set(0, STREET_Y, -120); root.add(street);
  for (let z = 0; z > -95; z -= 13) { const sp = new THREE.Sprite(M.glowWarm); sp.position.set((z % 2 ? -1 : 1) * (2 + rp() * 1.5), STREET_Y + 2.5, z - rp() * 4); sp.scale.setScalar(5); root.add(sp); }

  // ---------------- sky, haze and light ----------------
  const skyMat = own(new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, hor: { value: new THREE.Color(PAL.skyHorizon) }, band: { value: new THREE.Color(PAL.skyBand) }, tdir: { value: new THREE.Vector3(TW.x, 30, TW.z).normalize() }, tcol: { value: new THREE.Color('#2f6b58') } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 top,hor,band,tdir,tcol; varying vec3 vD; void main(){ float h = vD.y; vec3 c = mix(hor, top, pow(clamp(h * 1.8, 0.0, 1.0), 0.6)); c = mix(c, band, exp(-abs(h - 0.03) * 22.0) * 0.55); if (h < 0.0) c = mix(hor, vec3(0.08,0.09,0.11), clamp(-h * 6.0, 0.0, 1.0)); float t = max(dot(normalize(vD), tdir), 0.0); c += tcol * pow(t, 30.0) * 0.5; gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(350, 24, 12)), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0105);
  scene.background = new THREE.Color(PAL.skyHorizon);
  const hemi = new THREE.HemisphereLight('#8a9ab2', '#2a221e', 1.15); scene.add(hemi);
  const key = new THREE.DirectionalLight('#d8cbb6', 1.7);
  const KEY = new THREE.Vector3(-0.5, 0.78, -0.42).normalize().multiplyScalar(30);
  key.shadow.mapSize.set(opts.small ? 1024 : 2048, opts.small ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
  scene.add(key); scene.add(key.target);
  function setShadows(on) { key.castShadow = on; }
  setShadows(opts.shadows);

  // ---------------- per frame ----------------
  let time = 0;
  const H = TUNING.hazards;
  function update(dt, focus, camera) {
    time += dt;
    key.position.set(focus[0] + KEY.x, focus[1] + KEY.y, focus[2] - 5 + KEY.z);
    key.target.position.set(focus[0], focus[1], focus[2] - 5); key.target.updateMatrixWorld();
    sky.position.copy(camera.position);
    // steam: wisps at rest, a hiss and a red lamp as warning, then the column
    for (const V of vents) {
      const st = V.v.state, e = V.e;
      const rate = st === 'burst' ? 110 : st === 'warn' ? 22 : 3;
      emit(e, rate, dt, i => {
        const burst = st === 'burst';
        e.pos[i * 3] = e.at[0] + (rp() - 0.5) * 0.1; e.pos[i * 3 + 1] = e.at[1]; e.pos[i * 3 + 2] = e.at[2] + (rp() - 0.5) * 0.1;
        e.vel[i * 3] = (rp() - 0.5) * (burst ? 0.9 : 0.3); e.vel[i * 3 + 1] = burst ? 4 + rp() * 3 : 0.6 + rp() * 0.6; e.vel[i * 3 + 2] = (rp() - 0.5) * (burst ? 0.9 : 0.3);
        e.dur[i] = burst ? 0.55 + rp() * 0.3 : 0.9 + rp() * 0.6; e.size[i] = burst ? 0.55 + rp() * 0.35 : 0.25 + rp() * 0.15; e.life[i] = 1e-3;
      });
      stepEmitter(e, dt, 0.8);
      const warn = st === 'warn' ? 0.6 + 0.4 * Math.sin(time * 30) : st === 'burst' ? 1 : 0.15;
      V.lamp.material.opacity = 1; V.lamp.scale.setScalar(0.25 + 0.55 * warn);
    }
    for (const s of smokes) {
      emit(s, 5, dt, i => { s.pos[i * 3] = s.at[0]; s.pos[i * 3 + 1] = s.at[1]; s.pos[i * 3 + 2] = s.at[2]; s.vel[i * 3] = 0.3 + rp() * 0.3; s.vel[i * 3 + 1] = 0.8 + rp() * 0.4; s.vel[i * 3 + 2] = (rp() - 0.5) * 0.3; s.dur[i] = 4 + rp() * 2; s.size[i] = 2.2 + rp() * 1.5; s.life[i] = 1e-3; });
      stepEmitter(s, dt, 0.05);
    }
    // the unstable walkway: shakes as it creaks, then drops
    for (const u of unstableViews) {
      const st = hazards.unstable.find(x => x.b === u.b);
      const shake = st.state === 'creak' ? st.shake : 0;
      u.g.position.set((Math.random() - 0.5) * 0.02 * shake, u.b.dy, 0);
      u.g.rotation.z = st.state === 'falling' ? Math.min(0.5, st.t * 0.8) : (Math.random() - 0.5) * 0.03 * shake;
      u.g.visible = st.state !== 'gone';
      u.spark.visible = st.state === 'creak' && Math.random() < 0.6;
    }
    // fragments bob and turn; taken ones burst and fade
    for (const F of frags) {
      if (F.f.taken) { F.pop = Math.min(1, F.pop + dt * 3); F.g.scale.setScalar(1 + F.pop * 1.5); F.sp.material.opacity = 1; F.g.visible = F.pop < 1; F.m.visible = false; continue; }
      F.pop = 0; F.g.visible = true; F.m.visible = true; F.g.scale.setScalar(1);
      F.g.position.y = F.f.y + Math.sin(time * 2.4 + F.f.z) * 0.05; F.m.rotation.y += dt * 1.8;
    }
    // the relay: red until reached; then green, and the signal climbs to the tower
    const on = hazards.relay.active, rt = hazards.relay.t;
    relayLamp.material = on ? M.glowGreen : M.glowRed;
    relayLamp.scale.setScalar(on ? 1.4 + 0.3 * Math.sin(time * 6) : 0.7 + 0.2 * Math.sin(time * 2));
    beamMat.opacity = on ? clamp(rt * 1.5, 0, 0.75) * (0.75 + 0.25 * Math.sin(time * 9)) : 0;
    beacon.scale.setScalar(on ? 22 + 10 * clamp(rt - 0.4, 0, 1) + 3 * Math.sin(time * 5) : 12 + 2 * Math.sin(time * 1.5));
    beaconMat.opacity = on ? 1 : 0.55;
    for (const [i, l] of towerLights.entries()) l.material.opacity = on ? 0.9 : 0.25 + 0.2 * Math.sin(time * 1.3 + i);
    for (const f of fans) f.rotation.z += dt * 5;
    for (const br of bridges) br.g.position.x = br.b.dx || 0;
    // the signal line: each segment lights as the relay at its end wakes
    const woke = hazards.waypoints.map(w => w.active).concat([hazards.relay.active]);
    signal.forEach((sg, i) => {
      sg.lit = damp(sg.lit, woke[i] ? 1 : 0, 3, dt);
      sg.mat.color.setRGB(lerp(0.086, 0.35, sg.lit), lerp(0.098, 0.95, sg.lit) * (0.85 + 0.15 * Math.sin(time * 6 - i)), lerp(0.114, 0.6, sg.lit));
    });
    for (const W of wps) {
      W.lamp.material = W.w.active ? M.glowGreen : M.glowRed;
      W.lamp.scale.setScalar(W.w.active ? 0.9 + 0.4 * Math.exp(-W.w.t * 2) * 3 + 0.1 * Math.sin(time * 5) : 0.3 + 0.08 * Math.sin(time * 1.7));
    }
    for (const [i, sp] of sparks.entries()) { const on = Math.sin(time * 23 + i * 7) > 0.55 || Math.sin(time * 3.1 + i) > 0.97; sp.visible = on; sp.scale.setScalar(0.18 + Math.random() * 0.25); }
    for (const l of lamps) if (l.flicker) l.sp.scale.setScalar(l.base * (0.9 + 0.1 * Math.sin(time * 13 + l.ph) * (Math.sin(time * 0.7 + l.ph) > 0.85 ? 3 : 1)));
    void H;
  }
  function setFaded(ids, dt) {
    for (const [id, f] of fades) {
      const want = ids.has(id) ? 0.35 : 1;
      f.k = damp(f.k, want, want < f.k ? 22 : 6, dt);
      // stays transparent: three.js compiles opaque materials to ignore opacity
      f.mat.opacity = f.k; f.mat.depthWrite = f.k > 0.99;
    }
  }
  function dispose() {
    disposeTree(root); disposeTree(sky);
    for (const g of ownGeo) g.dispose();
    for (const m of ownMat) m.dispose();
    scene.remove(hemi); scene.remove(key); scene.remove(key.target);
  }
  function setPointScale(v) { for (const k in partMats) partMats[k].uniforms.uScale.value = v; }
  return { update, setFaded, setShadows, setPointScale, dispose, root, key };
}
