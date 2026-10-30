// The endless forest: streamed chunks, pooled instances, cover, obstacles, lanterns.
function createWorld(THREE, A, scene, small) {
  const L = 24, AHEAD = small ? 6 : 7, BEHIND = 2;
  const _p = { x: 0, z: 0 }, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---------- instance pools ----------
  function Pool(geo, mat, cap, shadow, receive) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.castShadow = !!shadow; mesh.receiveShadow = receive !== false; mesh.frustumCulled = false;
    const free = [];
    for (let i = cap - 1; i >= 0; i--) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, _c.set('#ffffff')); free.push(i); }
    scene.add(mesh);
    const pool = { mesh, free, dirty: true, cap };
    pool.add = (x, y, z, yaw, sx, sy, sz, tx, tz, color) => {
      const i = free.pop(); if (i === undefined) return -1;
      _e.set(tx || 0, yaw || 0, tz || 0); _q.setFromEuler(_e);
      _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz));
      mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.set(color || '#ffffff')); pool.dirty = true; return i;
    };
    pool.set = (i, x, y, z, yaw, sx, sy, sz, tx, tz) => { _e.set(tx || 0, yaw || 0, tz || 0); _q.setFromEuler(_e); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz)); mesh.setMatrixAt(i, _m); pool.dirty = true; };
    pool.remove = i => { if (i < 0) return; mesh.setMatrixAt(i, ZERO); free.push(i); pool.dirty = true; };
    pool.flush = () => { if (pool.dirty) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; pool.dirty = false; } };
    return pool;
  }
  const N = AHEAD + BEHIND + 2;
  const P = {
    tree0: Pool(A.G.tree[0], A.M.bark, N * 18, true), tree1: Pool(A.G.tree[1], A.M.bark, N * 14, true), tree2: Pool(A.G.tree[2], A.M.bark, N * 14, true),
    bigTree: Pool(A.G.bigTree, A.M.bark, 14, true), bush: Pool(A.G.bush, A.M.flat, N * 14, false), denseBush: Pool(A.G.denseBush, A.M.flat, 24, true),
    rock: Pool(A.G.rock, A.M.flat, N * 8, false), rocks: Pool(A.G.rocks, A.M.flat, 16, true), log: Pool(A.G.log, A.M.obst, 18, true), hollowLog: Pool(A.G.hollowLog, A.M.bark, 12, true),
    roots: Pool(A.G.roots, A.M.obst, 14, true), thorns: Pool(A.G.thorns, A.M.obst, 30, true), branches: Pool(A.G.branches, A.M.obst, 22, true), gapTrunk: Pool(A.G.gapTrunk, A.M.obst, 18, true),
    plank: Pool(A.G.plank, A.M.obst, 160, true), rail: Pool(A.G.bridgeRail, A.M.obst, 10, true), fence: Pool(A.G.fence, A.M.wood, N * 4, true), post: Pool(A.G.lanternPost, A.M.flat, 24, true),
    shrine: Pool(A.G.shrine, A.M.flat, 12, true), shed: Pool(A.G.shed, A.M.wood, 12, true)
  };
  // crossed moonbeam planes
  const beamGeo = (() => { const a = new THREE.PlaneGeometry(2.6, 16); a.translate(0, 8, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const g = new THREE.BufferGeometry(); const pa = a.toNonIndexed(), pb = b.toNonIndexed(); const pos = new Float32Array([...pa.attributes.position.array, ...pb.attributes.position.array]); const uv = new Float32Array([...pa.attributes.uv.array, ...pb.attributes.uv.array]); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; })();
  const beamMat = new THREE.MeshBasicMaterial({ map: A.T.beam, color: '#7f90cc', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  P.beam = Pool(beamGeo, beamMat, N * 2, false, false);
  // drifting mist cards (camera-facing, faded near the lens and into the distance)
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: A.T.mist }, color: { value: new THREE.Color('#8590c0') }, opacity: { value: 0.5 }, time: { value: 0 }, far: { value: 90 } },
    vertexShader: `varying vec2 vUv; varying float vA; uniform float time; uniform float far;
      void main(){ vUv = uv; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float sc = length(instanceMatrix[0].xyz);
      c.xy += position.xy * sc * vec2(1.6, 0.55); c.x += sin(time * 0.13 + instanceMatrix[3].x * 0.3) * 0.8; gl_Position = projectionMatrix * c;
      float d = -c.z; vA = smoothstep(1.5, 7.0, d) * (1.0 - smoothstep(far * 0.55, far, d)); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv; varying float vA;
      void main(){ float a = texture2D(map, vUv).a * opacity * vA; if (a < 0.003) discard; gl_FragColor = vec4(color, a); }`,
    transparent: true, depthWrite: false
  });
  P.mist = Pool(new THREE.PlaneGeometry(1, 1), mistMat, N * 7, false, false);
  P.mist.mesh.renderOrder = 5;
  // ground decal marking cover within reach
  const ringMat = new THREE.MeshBasicMaterial({ map: A.T.glow, color: '#ffb766', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24).rotateX(-Math.PI / 2), ringMat); ring.renderOrder = 4; scene.add(ring);

  // ---------- lanterns (the warm lights) ----------
  const lampPool = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const head = new THREE.Mesh(A.G.lampHead, new THREE.MeshBasicMaterial({ color: '#ffc477' })); g.add(head);
    const glow = new THREE.Sprite(A.M.glowWarm.clone()); glow.scale.setScalar(2.2); g.add(glow);
    g.visible = false; scene.add(g); lampPool.push({ g, head, glow, used: false });
  }
  const lights = [];
  for (let i = 0; i < (small ? 2 : 3); i++) { const l = new THREE.PointLight('#ffad55', 0, 13, 1.6); scene.add(l); lights.push(l); }

  // ---------- ground chunks ----------
  const GW = 84, GX = 28, GZ = 10;
  const groundPool = [];
  function makeGround() {
    const g = new THREE.PlaneGeometry(GW, L, GX, GZ); g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, A.M.ground); m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m;
  }
  const cDirt = new THREE.Color('#8e88a6'), cEdge = new THREE.Color('#3e485c'), cMoss = new THREE.Color('#2a3444'), cDeep = new THREE.Color('#191e2c'), cLeaf = new THREE.Color('#71667c');
  function shapeGround(m, s0, halfW) {
    const g = m.geometry, Pp = g.attributes.position, C = g.attributes.color, U = g.attributes.uv;
    for (let j = 0; j <= GZ; j++) for (let i = 0; i <= GX; i++) {
      const k = j * (GX + 1) + i;
      const s = s0 + L - (j / GZ) * L; // row 0 is the far edge (more negative z)
      const cx = TRAIL.x(s), x = cx + (i / GX - 0.5) * GW, z = -s;
      const y = groundY(x, z);
      Pp.setXYZ(k, x, y, z);
      const off = Math.abs(x - cx), n = fbm(x * 0.3, z * 0.3);
      _c.copy(cDirt).lerp(cLeaf, n * 0.6);
      _c.lerp(cEdge, smooth((off - halfW * 0.75) / 1.6));
      _c.lerp(cMoss, smooth((off - halfW - 1.5) / 4) * (0.6 + n * 0.4));
      _c.lerp(cDeep, smooth((off - 12) / 20));
      if (y < -0.6) _c.lerp(cDeep, clamp(-y / 2.4, 0, 1));
      C.setXYZ(k, _c.r, _c.g, _c.b);
      U.setXY(k, x * 0.22, z * 0.22);
    }
    Pp.needsUpdate = true; C.needsUpdate = true; U.needsUpdate = true;
    g.computeVertexNormals();
  }

  // ---------- planner and chunk streaming ----------
  let rng, plan, chunks, spots, obstacles, lanterns, fallers, first, lastIdx = -999;
  const place = (s, u, out) => { trailPoint(s, u, out || _p); const o = out || _p; o.y = groundY(o.x, o.z); return o; };
  function addInst(ch, pool, s, u, yawOff, sx, sy, sz, tx, tz, color, ySink) {
    const p = place(s, u);
    const i = pool.add(p.x, p.y - (ySink || 0), p.z, TRAIL.yaw(s) + (yawOff || 0), sx, sy, sz, tx, tz, color);
    if (i >= 0) ch.insts.push([pool, i]);
    return i;
  }
  const tint = (r, base) => { const v = 0.82 + r() * 0.3; return _c.set(base || '#ffffff').multiplyScalar(v).getStyle(); };

  const SPOT = {
    bigTree: { obj: 2.0, hide: 4.05, label: 'tree' },
    hollowLog: { obj: 1.45, hide: 1.45, label: 'log', inside: true },
    rocks: { obj: 1.5, hide: 3.0, label: 'rocks' },
    denseBush: { obj: 1.7, hide: 1.8, label: 'bush', inside: true },
    shed: { obj: 2.6, hide: 2.6, label: 'shed', inside: true }
  };
  function makeSpot(ch, s) {
    const st = stageIndex(s), halfW = stageParam(s, 'halfW');
    const kinds = st === 0 ? ['bigTree', 'bigTree', 'rocks', 'denseBush', 'hollowLog'] : st === 1 ? ['bigTree', 'denseBush', 'hollowLog', 'rocks', 'denseBush'] : st === 2 ? ['shed', 'bigTree', 'hollowLog', 'rocks', 'shed'] : ['bigTree', 'shed', 'rocks', 'hollowLog', 'denseBush'];
    const kind = first.spot ? (first.spot = false, 'bigTree') : rpick(rng, kinds);
    const side = rng() < 0.5 ? -1 : 1, def = SPOT[kind];
    const spot = { s, side, kind, objU: side * (halfW + def.obj), hideU: side * (halfW + def.hide), inside: !!def.inside, halfW };
    const yaw = rng() * 6.28;
    if (kind === 'bigTree') addInst(ch, P.bigTree, s, spot.objU, yaw, 1, 1.05, 1, 0, 0, tint(rng));
    else if (kind === 'hollowLog') addInst(ch, P.hollowLog, s, spot.objU, 0, 1, 1, 1, 0, 0, tint(rng));
    else if (kind === 'rocks') addInst(ch, P.rocks, s, spot.objU, yaw, 1.15, 1.1, 1.15, 0, 0, tint(rng));
    else if (kind === 'denseBush') addInst(ch, P.denseBush, s, spot.objU, side > 0 ? 0 : Math.PI, 1.05, 1.05, 1.05, 0, 0, tint(rng));
    else if (kind === 'shed') addInst(ch, P.shed, s, spot.objU, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1, 0, 0, tint(rng));
    spots.push(spot); ch.spots.push(spot);
    return spot;
  }
  // obstacle blocks are lateral ranges [a, b] relative to the trail centre
  function makeObstacle(ch, s, kind) {
    const halfW = stageParam(s, 'halfW'), INF = 99, o = { s, kind, low: false, blocks: [], len: 0.9, hit: false, halfW };
    const yawJ = (rng() - 0.5) * 0.12;
    if (kind === 'log') { o.low = true; o.blocks = [[-INF, INF]]; addInst(ch, P.log, s, (rng() - 0.5) * 0.6, yawJ, 1, 1, 1, 0, 0, tint(rng)); }
    else if (kind === 'roots') { o.low = true; o.blocks = [[-INF, INF]]; o.len = 0.7; addInst(ch, P.roots, s, 0, yawJ, 1, 1, 1, 0, 0, tint(rng)); }
    else if (kind === 'thorns' || kind === 'branches') {
      const w = kind === 'thorns' ? 2.2 : 2.6, mode = rng();
      const c = mode < 0.42 ? -(halfW - w / 2 + 0.25) : mode < 0.84 ? (halfW - w / 2 + 0.25) : 0;
      o.blocks = [[c - w / 2 - 0.05, c + w / 2 + 0.05]];
      if (c === 0) o.blocks[0] = [-1.15, 1.15];
      addInst(ch, kind === 'thorns' ? P.thorns : P.branches, s, c, (rng() < 0.5 ? 0 : Math.PI) + yawJ, 1, 1, 1, 0, 0, tint(rng));
      // keep the blocked side reading as blocked right to the trail edge
      if (c !== 0) addInst(ch, P.bush, s + 0.2, Math.sign(c) * (halfW + 0.7), rng() * 6, 0.9, 0.9, 0.9, 0, 0, tint(rng));
      else for (const sd of [-1, 1]) addInst(ch, P.bush, s, sd * (halfW + 0.6), rng() * 6, 0.8, 0.8, 0.8, 0, 0, tint(rng));
    } else if (kind === 'gap') {
      const g = (rng() - 0.5) * (halfW - 1.0) * 2;
      o.blocks = [[-INF, g - 0.72], [g + 0.72, INF]]; o.len = 1.2;
      for (const sd of [-1, 1]) addInst(ch, P.gapTrunk, s, g + sd * 1.35, rng() * 6, 1, 1, 1, 0, 0, tint(rng));
      for (const sd of [-1, 1]) { const from = g + sd * 2, to = sd * (halfW + 0.6); if ((to - from) * sd > 0.4) addInst(ch, P.thorns, s, (from + to) / 2, rng() * 6, Math.abs(to - from) / 2.2 + 0.2, 1, 1, 0, 0, tint(rng)); }
    } else if (kind === 'bridge') {
      const half = 3.4; o.len = half * 2; o.blocks = [];
      RAVINES.push({ s, half });
      const holes = [], nh = rng() < 0.5 ? 1 : 2, w = halfW * 2 + 0.6;
      if (nh === 1) { const c = (rng() < 0.5 ? -1 : 1) * rrange(rng, 0.4, halfW - 0.9); holes.push([c - 0.75, c + 0.75]); }
      else { holes.push([-halfW - 0.3, -halfW + 1.1]); holes.push([halfW - 1.1, halfW + 0.3]); if (rng() < 0.5) { holes.length = 1; holes.push([0.2, 1.5]); } }
      o.blocks = holes;
      for (let z = -half + 0.2; z <= half; z += 0.42) {
        for (let u = -w / 2 + 0.5; u <= w / 2 - 0.4; u += 1) {
          if (holes.some(h => u + 0.45 > h[0] && u - 0.45 < h[1])) { if (rng() < 0.15) addInst(ch, P.plank, s + z, u, (rng() - 0.5) * 0.6, 0.7, 1, 1, 0.4, 0.6, '#cccccc', 0.9 + rng() * 0.6); continue; }
          const pt = place(s + z, u); const i = P.plank.add(pt.x, 0.02 + (rng() - 0.5) * 0.03, pt.z, TRAIL.yaw(s + z) + (rng() - 0.5) * 0.05, 1.02, 1, 1, 0, (rng() - 0.5) * 0.04, tint(rng)); if (i >= 0) ch.insts.push([P.plank, i]);
        }
      }
      for (const sd of [-1, 1]) { const pt = place(s, sd * (w / 2 + 0.1)); const i = P.rail.add(pt.x, 0, pt.z, TRAIL.yaw(s), 1, 1, 1, 0, sd * 0.06, tint(rng)); if (i >= 0) ch.insts.push([P.rail, i]); }
    }
    obstacles.push(o); ch.obstacles.push(o);
    return o;
  }
  function addLantern(ch, s, u, small) {
    const lp = lampPool.find(l => !l.used); if (!lp) return;
    const pt = place(s, u), yaw = TRAIL.yaw(s) + (u > 0 ? Math.PI : 0);
    if (!small) { const i = P.post.add(pt.x, pt.y, pt.z, yaw, 1, 1, 1, 0, 0); if (i >= 0) ch.insts.push([P.post, i]); }
    lp.used = true; lp.g.visible = true;
    // the lamp hangs 0.42 m out from the post toward the trail
    const ox = Math.cos(yaw) * 0.42, oz = -Math.sin(yaw) * 0.42;
    if (small) lp.g.position.set(pt.x, pt.y + 0.98, pt.z); else lp.g.position.set(pt.x + ox, pt.y + 1.86, pt.z + oz);
    lp.head.visible = !small; lp.glow.scale.setScalar(small ? 0.9 : 2.4);
    const L = { lp, s, u, lit: 1, flicker: 0, dying: 0, small, phase: rng() * 10 };
    lanterns.push(L); ch.lanterns.push(L);
  }
  function genChunk(idx) {
    const s0 = idx * L, s1 = s0 + L;
    const ch = { idx, s0, insts: [], spots: [], obstacles: [], lanterns: [], ground: groundPool.pop() || makeGround() };
    const halfW = stageParam(s0 + L / 2, 'halfW'), st = stageIndex(s0);
    // cover first, then obstacles kept clear of it
    while (plan.hide < s1) { if (plan.hide >= s0) makeSpot(ch, plan.hide); const g = STAGES[st].hideGap; plan.hide += rrange(rng, g[0], g[1]) * (plan.hide < 120 ? 0.85 : 1); }
    while (plan.obs < s1) {
      let s = plan.obs;
      if (s >= s0) {
        const near = spots.find(sp => s - sp.s > -7 && s - sp.s < 12);
        if (near) s = near.s + 12.5;
        const kinds = st === 0 ? ['log', 'roots', 'thorns', 'log'] : st === 1 ? ['log', 'thorns', 'branches', 'gap', 'roots'] : st === 2 ? ['gap', 'bridge', 'thorns', 'branches', 'log', 'roots'] : ['gap', 'bridge', 'thorns', 'branches', 'log', 'gap'];
        let kind = first.obs ? (first.obs = false, 'log') : rpick(rng, kinds);
        if (kind === 'bridge' && (s < s0 + 6 || s > s1 - 6 || spots.some(sp => Math.abs(sp.s - s) < 10))) kind = 'thorns';
        if (s < s1) {
          makeObstacle(ch, s, kind);
          // later stages pair obstacles into short sequences
          const s2 = s + 8.5 + rng() * 2;
          if (st >= 2 && rng() < 0.4 + st * 0.1 && s2 < s1 && kind !== 'bridge' && !spots.some(sp => s2 - sp.s > -7 && s2 - sp.s < 12)) makeObstacle(ch, s2, rpick(rng, ['thorns', 'branches', 'log', 'roots']));
        }
      }
      const g = STAGES[st].obsGap; plan.obs = Math.max(plan.obs, s) + rrange(rng, g[0], g[1]);
    }
    shapeGround(ch.ground, s0, halfW);
    // trees: dense walls with a few sentinels close to the trail
    const nt = Math.round(stageParam(s0, 'trees')), twist = stageParam(s0, 'twist'), dead = stageParam(s0, 'dead');
    for (let i = 0; i < nt; i++) {
      const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 1.5 + Math.pow(rng(), 1.5) * 26;
      // keep cover readable, and the hiding view clear
      if (spots.some(sp => s - sp.s > -4 && s - sp.s < 14.5 && Math.sign(sp.objU) === side && off < halfW + 8.5)) continue;
      if (RAVINES.some(r => Math.abs(r.s - s) < r.half + 1.5)) continue;
      const v = rng(), pool = v < dead ? P.tree1 : v < dead + twist ? P.tree2 : P.tree0;
      const sc = 0.75 + rng() * 0.6;
      addInst(ch, pool, s, side * off, rng() * 6.28, sc, sc * (0.9 + rng() * 0.3), sc, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1, tint(rng), 0.1);
    }
    const clearView = (s, side, off) => spots.some(sp => s - sp.s > -3 && s - sp.s < 14.5 && Math.sign(sp.objU) === side && off < halfW + 8.5);
    for (let i = 0; i < 10; i++) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 0.9 + Math.pow(rng(), 2) * 14; if (clearView(s, side, off)) continue; const sc = 0.6 + rng() * 0.8; addInst(ch, P.bush, s, side * off, rng() * 6, sc, sc * (0.7 + rng() * 0.5), sc, 0, 0, tint(rng)); }
    for (let i = 0; i < 4; i++) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 0.6 + rng() * 10; if (clearView(s, side, off)) continue; const sc = 0.4 + rng() * 0.9; addInst(ch, P.rock, s, side * off, rng() * 6, sc, sc, sc, 0, 0, tint(rng), 0.05); }
    if (st < 3 && rng() < 0.4) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1; addInst(ch, P.fence, s, side * (halfW + 0.4 + rng() * 0.4), Math.PI / 2 + (rng() - 0.5) * 0.3, 1, 1, 1, 0, (rng() - 0.5) * 0.2, tint(rng)); }
    // lanterns, shrines and abandoned structures
    if (rng() < stageParam(s0, 'lantern')) { const s = s0 + 4 + rng() * (L - 8); if (!obstacles.some(o => Math.abs(o.s - s) < 3)) addLantern(ch, s, (rng() < 0.5 ? -1 : 1) * (halfW + 0.45)); }
    if (rng() < stageParam(s0, 'struct')) {
      const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1;
      if (!spots.some(sp => Math.abs(sp.s - s) < 6)) {
        if (st >= 2 && rng() < 0.5) addInst(ch, P.shed, s, side * (halfW + 6 + rng() * 6), rng() * 6, 1, 1, 1, 0.05, 0.08, tint(rng));
        else { const u = side * (halfW + 1.2 + rng() * 2); addInst(ch, P.shrine, s, u, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1, 0, 0, tint(rng)); if (rng() < 0.8) { const i = lampPool.find(l => !l.used); if (i) addLantern(ch, s, u, true); } }
      }
    }
    for (let i = 0; i < (st >= 3 ? 1 : 2); i++) if (rng() < 0.6) { const s = s0 + rng() * L, u = (rng() - 0.5) * 2 * (halfW + 6); addInst(ch, P.beam, s, u, 0, 1 + rng() * 0.6, 1, 1, 0.42, 0.12); }
    for (let i = 0; i < 6; i++) { const s = s0 + rng() * L, u = (rng() < 0.5 ? -1 : 1) * (halfW + 1.5 + rng() * 10); const p = place(s, u); const sc = 5 + rng() * 7; const k = P.mist.add(p.x, p.y + 0.6 + rng() * 0.9, p.z, 0, sc, sc, sc); if (k >= 0) ch.insts.push([P.mist, k]); }
    chunks.push(ch);
  }
  function dropChunk(ch) {
    for (const [pool, i] of ch.insts) pool.remove(i);
    for (const sp of ch.spots) spots.splice(spots.indexOf(sp), 1);
    for (const o of ch.obstacles) obstacles.splice(obstacles.indexOf(o), 1);
    for (const l of ch.lanterns) { l.lp.used = false; l.lp.g.visible = false; lanterns.splice(lanterns.indexOf(l), 1); }
    groundPool.push(ch.ground);
  }

  // ---------- a tree that falls across the trail ----------
  const fallMesh = new THREE.Mesh(A.G.tree[1], A.M.obst); fallMesh.castShadow = true; fallMesh.visible = false; scene.add(fallMesh);
  function spawnFaller(s) {
    if (fallers.length || obstacles.some(o => Math.abs(o.s - s) < 8) || spots.some(sp => Math.abs(sp.s - s) < 8) || RAVINES.some(r => Math.abs(r.s - s) < 8)) return null;
    const halfW = stageParam(s, 'halfW'), side = rng() < 0.5 ? -1 : 1, base = place(s, side * (halfW + 1.2), {});
    const f = { s, side, base, t: -1, done: false, o: null, halfW };
    fallers.push(f);
    fallMesh.visible = true; fallMesh.position.set(base.x, base.y, base.z); fallMesh.rotation.set(0, TRAIL.yaw(s), 0); fallMesh.scale.setScalar(0.85);
    return f;
  }
  function updateFallers(dt, ps) {
    for (const f of fallers) {
      if (f.t < 0) { if (f.s - ps < 30) { f.t = 0; f.started = true; } continue; }
      f.t += dt;
      const a = Math.min(1, Math.pow(f.t / 1.1, 2.2)) * (Math.PI / 2 - 0.08);
      // topple toward the far side of the trail
      fallMesh.rotation.set(0, TRAIL.yaw(f.s), -f.side * a, 'YXZ');
      if (f.t >= 1.1 && !f.done) {
        f.done = true; f.landed = true;
        f.o = { s: f.s, kind: 'fallen', low: true, blocks: [[-99, 99]], len: 0.9, hit: false };
        obstacles.push(f.o);
      }
    }
    for (let i = fallers.length - 1; i >= 0; i--) if (fallers[i].s < ps - 30) { const f = fallers[i]; if (f.o && obstacles.includes(f.o)) obstacles.splice(obstacles.indexOf(f.o), 1); fallers.splice(i, 1); fallMesh.visible = false; }
  }

  // ---------- distant treeline layers following the camera ----------
  const lineMats = [], lines = [];
  for (const [rad, h, t, op] of [[150, 64, A.T.treeline1, 0.5], [105, 46, A.T.treeline2, 0.75]]) {
    const m = new THREE.MeshBasicMaterial({ map: t, color: '#0c0f20', transparent: true, opacity: op, side: THREE.BackSide, depthWrite: false, fog: false });
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 48, 1, true), m); c.position.y = h / 2 - 4; c.renderOrder = -5; c.frustumCulled = false; scene.add(c); lineMats.push(m); lines.push(c);
  }

  // ---------- public ----------
  function reset(seed, from) {
    if (chunks) for (const ch of chunks) dropChunk(ch);
    RAVINES.length = 0;
    rng = makeRng(seed); chunks = []; spots = []; obstacles = []; lanterns = []; fallers = []; fallMesh.visible = false;
    from = from || 0; lastIdx = -999;
    plan = { hide: from + 34, obs: from + (from ? 26 : 112) }; first = { spot: true, obs: !from };
    for (const l of lampPool) { l.used = false; l.g.visible = false; }
  }
  function stream(ps) {
    const ci = Math.floor(ps / L);
    if (ci === lastIdx && chunks.length) return;
    lastIdx = ci;
    while (chunks.length && chunks[0].idx < ci - BEHIND) dropChunk(chunks.shift());
    let next = chunks.length ? chunks[chunks.length - 1].idx + 1 : ci - BEHIND;
    while (next <= ci + AHEAD) genChunk(next++);
    for (let i = RAVINES.length - 1; i >= 0; i--) if (RAVINES[i].s < ps - 80) RAVINES.splice(i, 1);
  }
  function update(ps, dt, time, cam) {
    stream(ps);
    updateFallers(dt, ps);
    mistMat.uniforms.time.value = time;
    for (const c of lines) { c.position.x = cam.position.x; c.position.z = cam.position.z; }
    // lanterns: flicker, die, and borrow the few real lights
    for (const l of lanterns) {
      if (l.dying > 0) { l.dying -= dt; l.lit = l.dying > 0 ? (Math.random() < 0.5 ? 0.1 : 1) * (l.dying / 0.9) : 0; }
      const f = l.lit * (0.86 + Math.sin(time * 9 + l.phase) * 0.05 + Math.sin(time * 23 + l.phase * 3) * 0.04);
      l.lp.glow.material.opacity = f * (l.small ? 0.8 : 0.95); l.lp.head.material.color.setRGB(1 * f + 0.05, 0.75 * f + 0.04, 0.45 * f + 0.04); l.flick = f;
    }
    const cand = lanterns.filter(l => l.lit > 0 && l.s > ps - 14 && l.s < ps + 60).sort((a, b) => Math.abs(a.s - ps - 8) - Math.abs(b.s - ps - 8));
    lights.forEach((li, i) => { const l = cand[i]; if (l) { li.position.copy(l.lp.g.position); li.intensity = (l.small ? 4 : 9) * l.flick; li.distance = l.small ? 6 : 13; } else li.intensity = 0; });
    for (const k in P) P[k].flush();
  }
  // cover within reach: ahead up to 5 m, behind up to 2.5 m, and not across the trail
  function coverNear(ps, u) {
    let best = null, bd = 1e9;
    for (const sp of spots) {
      const ds = sp.s - ps; if (ds > 5.2 || ds < -2.6) continue;
      const du = Math.abs(sp.objU - u); if (du > sp.halfW + 1.9 + (SPOT[sp.kind].obj - 1.4)) continue;
      const d = Math.abs(ds) + du * 0.5; if (d < bd) { bd = d; best = sp; }
    }
    return best;
  }
  function showRing(sp, a, time) {
    ringMat.opacity = a * (0.32 + Math.sin(time * 3) * 0.08);
    if (sp) { const p = place(sp.s, sp.hideU - Math.sign(sp.hideU) * (sp.inside ? 0 : 0.2)); ring.position.set(p.x, p.y + 0.04, p.z); }
  }
  function extinguishAhead(ps) { const l = lanterns.find(l => l.lit === 1 && !l.small && l.s > ps + 12 && l.s < ps + 40); if (l) { l.dying = 0.9; return l; } return null; }
  function setPalette(fog) { for (const m of lineMats) m.color.copy(fog).multiplyScalar(0.55); mistMat.uniforms.color.value.copy(fog).lerp(_c.set('#a7b0de'), 0.55); }
  const warm = on => { fallMesh.visible = on; for (const l of lampPool) l.g.visible = on || l.used; };
  return {
    reset, update, warm, coverNear, showRing, extinguishAhead, spawnFaller, setPalette, place, mistMat, beamMat,
    get spots() { return spots; }, get obstacles() { return obstacles; }, get lanterns() { return lanterns; }, get fallers() { return fallers; }, L
  };
}
