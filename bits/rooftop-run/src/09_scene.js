// =====================================================================
// The visible city: architecture built from the collision boxes (what
// you see is exactly what you stand on), small lived-in details, a
// backdrop of neighbouring roofs, the sky, the haze and the light.
// Static geometry is merged per material: a handful of draw calls.
// =====================================================================

function createScene(THREE, A, scene, world, lab, opts) {
  const { M } = A;
  const root = new THREE.Group(); scene.add(root);
  const ownGeo = [];
  const keep = g => { ownGeo.push(g); return g; };
  const B = new Batch();          // casts and receives shadows
  const BF = new Batch();         // far: receives nothing, casts nothing
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const xf = (x, y, z, sx, sy, sz, rx, ry, rz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx, sy, sz));
  const G = {
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 12, 1)), cyl6: keep(new THREE.CylinderGeometry(1, 1, 1, 6, 1)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)), dish: keep(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, 0.9))
  };
  const roofC = hex3(PAL.roof), edgeC = hex3(PAL.roofEdge), low = hex3('#2b2422');

  // ---- architecture from boxes ----
  const fades = new Map();
  for (const b of world.boxes) {
    const plaster = hex3(PAL.plaster[(b.id * 7 + 3) % PAL.plaster.length]);
    const T = b.far ? BF : B;
    if (b.kind === 'building') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: b.far ? mul3(roofC, 0.9) : roofC, sideCol: plaster, sideColLow: low, fadeDepth: 10 });
      if (!b.far) coping(b, plaster);
    } else if (b.kind === 'parapet') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'plain', side: 'wall', topCol: edgeC, sideCol: mul3(plaster, 1.05), sideColLow: mul3(plaster, 0.8), fadeDepth: 0.5, uvSide: 1.5 });
    } else if (b.kind === 'room') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.9), sideCol: mul3(plaster, 1.08), sideColLow: mul3(plaster, 0.8), fadeDepth: 3 });
      // a door on the face toward the run, and a slab overhang
      const dw = Math.min(0.9, (b.x1 - b.x0) * 0.4), cx = (b.x0 + b.x1) / 2;
      T.quad('plain', [cx - dw / 2, b.y0, b.z1 + 0.01], [cx + dw / 2, b.y0, b.z1 + 0.01], [cx + dw / 2, b.y0 + 1.9, b.z1 + 0.01], [cx - dw / 2, b.y0 + 1.9, b.z1 + 0.01], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], Array(4).fill(hex3('#3d4a52')));
      T.box(b.x0 - 0.12, b.x1 + 0.12, b.y1 - 0.1, b.y1 + 0.02, b.z0 - 0.12, b.z1 + 0.12, { top: 'roof', side: 'plain', topCol: mul3(roofC, 0.92), sideCol: mul3(edgeC, 0.85) });
    } else if (b.kind === 'tankStand') {
      // a brick plinth (solid: you cannot pass under it) carrying a black tank
      T.box(b.x0, b.x1, b.y0, b.y0 + 0.55, b.z0, b.z1, { top: 'plain', side: 'wall', topCol: mul3(edgeC, 0.9), sideCol: hex3('#a5674e'), sideColLow: hex3('#7d4c3b'), fadeDepth: 0.6, uvSide: 1 });
      tank((b.x0 + b.x1) / 2, b.y0 + 0.55, (b.z0 + b.z1) / 2, Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.45, b.y1 - b.y0 - 0.55);
    } else if (b.kind === 'platform') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.95), sideCol: hex3('#a5674e'), sideColLow: hex3('#7d4c3b'), fadeDepth: 0.8, uvSide: 1 });
      T.box(b.x0 - 0.02, b.x1 + 0.02, b.y1 - 0.06, b.y1 + 0.01, b.z0 - 0.02, b.z1 + 0.02, { top: 'plain', side: 'plain', topCol: edgeC, sideCol: edgeC, faces: { pz: true, nx: true, px: true, nz: true } });
    } else if (b.kind === 'ledge') {
      T.box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, { top: 'roof', side: 'plain', topCol: edgeC, sideCol: hex3('#8e8579'), sideColLow: hex3('#5a524b'), fadeDepth: 0.3 });
      // the old pipe the ledge was built around, underneath
      B.geo('rust', G.cyl, xf((b.x0 + b.x1) / 2, b.y0 - 0.09, (b.z0 + b.z1) / 2, 0.07, b.z1 - b.z0, 0.07, Math.PI / 2), [1, 1, 1], THREE);
    } else if (b.kind === 'pipes') {
      fades.set(b.id, pipeBundle(b));
    }
  }
  // a lighter coping band around every roof edge: edges read at a glance
  function coping(b, plaster) {
    const y = b.y1, w = 0.09, c = edgeC, cs = mul3(plaster, 1.15);
    const strip = (x0, x1, z0, z1) => B.quad('roof', [x0, y + 0.004, z1], [x1, y + 0.004, z1], [x1, y + 0.004, z0], [x0, y + 0.004, z0], [0, 1, 0], [[x0 / 4, z1 / 4], [x1 / 4, z1 / 4], [x1 / 4, z0 / 4], [x0 / 4, z0 / 4]], [c, c, c, c]);
    strip(b.x0, b.x1, b.z1 - w, b.z1); strip(b.x0, b.x1, b.z0, b.z0 + w);
    strip(b.x0, b.x0 + w, b.z0, b.z1); strip(b.x1 - w, b.x1, b.z0, b.z1);
    B.box(b.x0 - 0.03, b.x1 + 0.03, y - 0.16, y + 0.003, b.z0 - 0.03, b.z1 + 0.03, { top: 'plain', side: 'plain', topCol: c, sideCol: cs, faces: { pz: true, nz: true, px: true, nx: true } });
  }
  function tank(x, y, z, r, h) {
    B.geo('tank', G.cyl, xf(x, y + h / 2, z, r, h, r), [1, 1, 1], THREE);
    for (let i = 1; i < 4; i++) B.geo('tank', G.cyl, xf(x, y + h * i / 4, z, r * 1.03, 0.04, r * 1.03), [1, 1, 1], THREE);
    B.geo('tank', G.cyl, xf(x, y + h + 0.04, z, r * 0.35, 0.08, r * 0.35), [1, 1, 1], THREE);
  }
  function pipeBundle(b) {
    const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: '#7b6c5f', transparent: true, opacity: 1 });
    mat.userData.own = true;
    const len = b.x1 - b.x0 + 0.6, cx = (b.x0 + b.x1) / 2, h = b.y1 - b.y0;
    const rows = [[b.y0 + 0.07, -0.25, 0.07], [b.y0 + 0.07, 0.0, 0.07], [b.y0 + 0.07, 0.25, 0.07], [b.y0 + h - 0.09, -0.12, 0.09], [b.y0 + h - 0.09, 0.15, 0.09]];
    const cz = (b.z0 + b.z1) / 2;
    for (const [y, dz, r] of rows) { const m = new THREE.Mesh(G.cyl, mat); m.scale.set(r, len, r); m.rotation.z = Math.PI / 2; m.position.set(cx, y, cz + dz); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    // a strap, so it reads as built, not floating
    for (const sx of [b.x0 + 0.2, b.x1 - 0.2]) { const s = new THREE.Mesh(G.box, mat); s.scale.set(0.04, h + 0.04, (b.z1 - b.z0) * 0.9); s.position.set(sx, b.y0 + h / 2, cz); g.add(s); }
    root.add(g);
    return { g, mat, k: 1 };
  }

  // ---- lived-in details ----
  const cloths = [];
  const CLOTH = ['#b5562f', '#2f4a7a', '#7a2b35', '#e8e2d4', '#c99a2e', '#55704f', '#a8473f', '#d9cfc0'].map(hex3);
  const rngD = makeRng(11);
  for (const d of lab.decor) {
    if (d.kind === 'dish') {
      B.geo('plain', G.cyl6, xf(d.x, d.y + 0.35, d.z, 0.025, 0.7, 0.025), hex3('#59534e'), THREE);
      B.geo('plain', G.dish, xf(d.x, d.y + 0.75, d.z, 0.32, 0.32, 0.12, Math.PI / 2 - 0.4, d.face, 0), hex3('#d8d3cb'), THREE);
    } else if (d.kind === 'pipeRun') {
      B.geo('rust', G.cyl, xf(d.x, d.y, (d.z0 + d.z1) / 2, 0.05, d.z1 - d.z0, 0.05, Math.PI / 2), [1, 1, 1], THREE);
    } else if (d.kind === 'tank') {
      tank(d.x, d.y, d.z, d.r, d.h);
    } else if (d.kind === 'crates') {
      B.box(d.x - 0.3, d.x + 0.3, d.y, d.y + 0.45, d.z - 0.25, d.z + 0.25, { top: 'plain', side: 'plain', topCol: hex3('#8a6a48'), sideCol: hex3('#76593d') });
      B.box(d.x - 0.22, d.x + 0.2, d.y + 0.45, d.y + 0.8, d.z - 0.2, d.z + 0.18, { top: 'plain', side: 'plain', topCol: hex3('#9a7a55'), sideCol: hex3('#806246') });
    } else if (d.kind === 'cable') {
      const a = new THREE.Vector3(...d.a), c = new THREE.Vector3(...d.b), mid = a.clone().lerp(c, 0.5); mid.y -= 0.6;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      const g = keep(new THREE.TubeGeometry(curve, 16, 0.012, 4, false));
      B.geo('cable', g, _m.identity(), [1, 1, 1], THREE);
    } else if (d.kind === 'laundry') {
      if (d.poles) for (const x of [d.x0 + 0.05, d.x1 - 0.05]) B.geo('rust', G.cyl6, xf(x, d.y - 1.0, d.z, 0.025, 2.1, 0.025), [1, 1, 1], THREE);
      const line = new THREE.Group(); line.position.set(0, d.y, d.z); root.add(line);
      const bl = new Batch();
      bl.geo('cable', G.cyl6, xf((d.x0 + d.x1) / 2, 0, 0, 0.008, d.x1 - d.x0, 0.008, 0, 0, Math.PI / 2), [1, 1, 1], THREE);
      for (let x = d.x0 + 0.3; x < d.x1 - 0.4;) {
        const w = 0.35 + rngD() * 0.6, h = 0.45 + rngD() * 0.55, c = CLOTH[(rngD() * CLOTH.length) | 0];
        bl.quad('cloth', [x, -h, 0], [x + w, -h, 0], [x + w, 0, 0], [x, 0, 0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [mul3(c, 0.75), mul3(c, 0.75), c, c]);
        x += w + 0.08 + rngD() * 0.25;
      }
      const clothMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true }); clothMat.userData.own = true;
      const built = bl.build(THREE, { cable: M.cable, cloth: clothMat }, { cast: true });
      line.add(built); cloths.push({ g: line, ph: rngD() * TAU, mat: clothMat, z: d.z });
    }
  }

  // ---- the neighbourhood beyond the route ----
  const rngB = makeRng(23);
  for (let z = 30; z > -200; z -= 9) {
    for (const side of [-1, 1]) {
      let x = 14 + rngB() * 3;
      while (x < 70) {
        const w = 5 + rngB() * 7, d = 6 + rngB() * 3, top = -9 + rngB() * 14 + (x > 35 ? 3 : 0);
        const cx = side * (x + w / 2), cz = z - d / 2;
        const col = mul3(hex3(PAL.plaster[(rngB() * PAL.plaster.length) | 0]), 0.9);
        BF.box(cx - w / 2, cx + w / 2, STREET_Y, top, cz - d / 2, cz + d / 2, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.85), sideCol: col, sideColLow: low, fadeDepth: 12, faces: { top: true, pz: true, nz: true, px: true, nx: true } });
        if (rngB() < 0.5) BF.geo('tank', G.cyl, xf(cx + (rngB() - 0.5) * w * 0.5, top + 0.5, cz + (rngB() - 0.5) * d * 0.5, 0.6, 1, 0.6), [1, 1, 1], THREE);
        if (rngB() < 0.4) BF.box(cx - w * 0.3, cx + w * 0.05, top, top + 2.4, cz - 1.2, cz + 1.2, { top: 'roof', side: 'wall', topCol: mul3(roofC, 0.8), sideCol: col, sideColLow: col });
        x += w + 1 + rngB() * 4;
      }
    }
  }
  const near = B.build(THREE, { roof: M.roof, wall: M.wall, plain: M.plain, tank: M.tank, rust: M.rust, cable: M.cable }, { cast: true, receive: true });
  const far = BF.build(THREE, { roof: M.roof, wall: M.wall, plain: M.plain, tank: M.tank }, { cast: false, receive: false });
  root.add(near); root.add(far);

  // ---- the street, far below ----
  const street = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 600)), M.street);
  street.rotation.x = -Math.PI / 2; street.position.set(0, STREET_Y, -80); root.add(street);

  // ---- sky: afternoon haze ----
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, hor: { value: new THREE.Color(PAL.skyHorizon) }, bot: { value: new THREE.Color(PAL.skyLow) }, sunDir: { value: new THREE.Vector3(-0.45, 0.32, -0.83).normalize() }, sunCol: { value: new THREE.Color(PAL.sun) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 top,hor,bot,sunDir,sunCol; varying vec3 vD; void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h*1.6,0.0,1.0), 0.7)) : mix(hor, bot, clamp(-h*5.0,0.0,1.0)); float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 900.0) * 0.55 + pow(s, 10.0) * 0.16); gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  skyMat.userData.own = true;
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(300, 24, 12)), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  scene.fog = new THREE.Fog(PAL.skyHorizon, 28, 150);
  scene.background = new THREE.Color(PAL.skyHorizon);

  // ---- light: one warm sun from ahead-left, a cool sky fill ----
  const hemi = new THREE.HemisphereLight('#d9dde0', '#6a5548', 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9ad', 2.1);
  const SUN = new THREE.Vector3(-0.45, 0.75, -0.48).normalize().multiplyScalar(30);
  sun.shadow.mapSize.set(opts.small ? 1024 : 2048, opts.small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 70 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);

  function setShadows(on) { sun.castShadow = on; }
  setShadows(opts.shadows);

  let time = 0;
  function update(dt, focus, camera) {
    time += dt;
    sun.position.set(focus[0] + SUN.x, focus[1] + SUN.y, focus[2] - 5 + SUN.z);
    sun.target.position.set(focus[0], focus[1], focus[2] - 5); sun.target.updateMatrixWorld();
    sky.position.copy(camera.position);
    for (const c of cloths) {
      c.g.rotation.x = Math.sin(time * 1.3 + c.ph) * 0.07 + 0.04;
      // laundry the camera is passing through thins out, so it never blinds the run
      const k = clamp((Math.abs(camera.position.z - c.z) - 0.6) / 2.4, 0.15, 1);
      c.mat.opacity = k; c.mat.depthWrite = k > 0.99;
    }
  }
  function setFaded(ids, dt) {
    for (const [id, f] of fades) {
      const want = ids.has(id) ? 0.28 : 1;
      f.k = damp(f.k, want, 10, dt);
      f.mat.opacity = f.k; f.mat.transparent = f.k < 0.99; f.mat.depthWrite = f.k > 0.99;
    }
  }
  function dispose() {
    disposeTree(root); disposeTree(sky);
    for (const g of ownGeo) g.dispose();
    scene.remove(hemi); scene.remove(sun); scene.remove(sun.target);
  }
  return { update, setFaded, setShadows, dispose, root, sun };
}
