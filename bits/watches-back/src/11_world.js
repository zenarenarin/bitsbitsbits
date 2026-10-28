// =====================================================================
// World view: turns the encounter's visual descriptors into geometry.
// Static pieces are merged per material; rotor pieces ride a group that
// follows the simulation's angle; bridges and gates animate from sim e.
// =====================================================================

function buildWorldView(W, look, quality) {
  const root = new THREE.Group();
  const statics = new Map();      // material -> [geometry in world space]
  const rotorBuckets = {};        // rotor id -> Map(material -> geos)
  const rotors = {}, bridges = {}, gates = {}, tendons = [], portals = [], zones = {}, lamps = [], dyn = [];
  const castOK = quality > 0;
  const rng = makeRng(17 + (W.def.id ? W.def.id.charCodeAt(2) * 31 : 0));

  const bucketFor = mover => {
    if (!mover) return statics;
    if (!rotorBuckets[mover]) rotorBuckets[mover] = new Map();
    return rotorBuckets[mover];
  };
  // geometry is given in world space; rotor pieces are re-expressed around the pivot
  const put = (geo, mat, mover) => {
    if (mover) { const m = W.moverById[mover]; geo.translate(-m.pivot[0], 0, -m.pivot[1]); }
    ensureColor(geo);
    const b = bucketFor(mover); if (!b.has(mat)) b.set(mat, []); b.get(mat).push(geo);
  };

  for (const v of W.visuals) {
    const t = v.type;
    if (t === 'slab') buildSlab(v);
    else if (t === 'pillar') buildPillar(v);
    else if (t === 'wall') buildWall(v);
    else if (t === 'block') buildBlock(v);
    else if (t === 'gate') buildGate(v);
    else if (t === 'bridge') buildBridge(v);
    else if (t === 'rotor') buildRotor(v);
    else if (t === 'ribs') buildRibs(v);
    else if (t === 'shaft') buildShaft(v);
    else if (t === 'mass') buildMass(v);
    else if (t === 'roots') buildRoots(v);
    else if (t === 'lamp') buildLamp(v);
    else if (t === 'portal') buildPortal(v);
    else if (t === 'entry') buildEntry(v);
    else if (t === 'zone') buildZone(v);
    else if (t === 'rail') buildRail(v);
  }
  // tendons last: they need eye and mover positions
  for (const v of W.visuals) if (v.type === 'tendon') buildTendon(v);

  // flush buckets into meshes
  const flush = (bucket, parent, cast) => {
    for (const [mat, geos] of bucket) {
      const g = mergeGeos(geos);
      for (const q of geos) q.dispose();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast && castOK; mesh.receiveShadow = castOK;
      parent.add(mesh);
    }
  };
  flush(statics, root, true);
  for (const id in rotorBuckets) { const r = rotors[id]; flush(rotorBuckets[id], r ? r.group : root, true); }

  // ---------------------------------------------------------------------
  function walkMat(v) {
    if (v.mat !== 'bone' && v.mat !== 'walk') return hatchMat(v.mat, { vc: true, occ: false });
    const etch = v.etch === 'spiral' ? 1 : v.etch === 'rungs' ? 2 : v.etch === 'radial' ? 3 : 0;
    return hatchMat('walk', { vc: true, etch, etchC: [v.x, 0, v.z], etchDir: v.yaw || 0 });
  }
  function buildSlab(v) {
    if (v.shape === 'rect') {
      const rise = v.y2 !== undefined && v.y2 !== null ? v.y2 - v.y : 0;
      const g = slabGeo(v.w, v.l, v.thick, rise);
      bakeXf(g, v.x, v.y, v.z, Math.PI / 2 - v.yaw);
      put(g, walkMat(v), v.mover);
      if (v.keel) {
        const depth = Math.min(9, 2 + v.l * 0.35);
        const k = keelGeo(v.w, v.l, depth, rng() * 10);
        bakeXf(k, v.x, v.y - v.thick + 0.05 + rise / 2, v.z, Math.PI / 2 - v.yaw);
        put(k, hatchMat('ink', { vc: true }), v.mover);
        // transverse vertebral ribs hanging under longer spans
        const n = Math.floor(v.l / 2.2);
        const parts = [];
        for (let i = 0; i < n; i++) {
          const u = -v.l / 2 + (i + 0.5) * v.l / n;
          const pts = [];
          for (let k2 = 0; k2 <= 10; k2++) { const a = Math.PI * k2 / 10; pts.push(new THREE.Vector3(Math.cos(a) * v.w * 0.55, -v.thick - Math.sin(a) * (0.6 + v.w * 0.35), u)); }
          parts.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - 0.5 * Math.abs(t - 0.5)));
        }
        if (parts.length) { const g2 = mergeGeos(parts); bakeXf(g2, v.x, v.y + rise / 2, v.z, Math.PI / 2 - v.yaw); put(g2, hatchMat('olive', { vc: true }), v.mover); }
      }
    } else {
      const g = arcSlabGeo(v.r0, v.r1, v.a0, v.a1, 0, v.thick);
      g.translate(v.x, v.y, v.z);
      put(g, walkMat(v), v.mover);
      if (v.keel) {
        if (v.r0 < 0.01 && v.a1 - v.a0 > TAU - 0.01) {
          const d = v.r1 * 1.1 + 2;
          const prof = [];
          for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.max(0.15, v.r1 * 0.97 * Math.pow(1 - t, 0.75)), -v.thick - t * d)); }
          const lg = new THREE.LatheGeometry(prof, 36);
          lg.translate(v.x, v.y, v.z); put(lg, hatchMat('ink', { vc: false }), v.mover);
          // radial fins
          const fins = [];
          const nf = Math.max(6, Math.round(v.r1 * 1.4));
          for (let i = 0; i < nf; i++) {
            const a = i / nf * TAU, pts = [];
            for (let k = 0; k <= 8; k++) { const t = k / 8; const rr = v.r1 * 1.0 * Math.pow(1 - t, 0.8); pts.push(new THREE.Vector3(Math.cos(a) * rr, -v.thick - t * d * 0.98 + 0.2, Math.sin(a) * rr)); }
            fins.push(sweepGeo(pts, [[0, 0.35], [0.12, 0], [0, -0.35], [-0.12, 0]], t => 1 - t * 0.7));
          }
          const fg = mergeGeos(fins); fg.translate(v.x, v.y, v.z); put(fg, hatchMat('olive', { vc: true }), v.mover);
        } else {
          const rm = (v.r1 - v.r0);
          const g2 = arcSlabGeo(v.r0 + rm * 0.18, v.r1 - rm * 0.18, v.a0 + 0.02, v.a1 - 0.02, 0, Math.min(6, rm * 1.2 + 1));
          g2.translate(v.x, v.y - v.thick + 0.02, v.z); put(g2, hatchMat('ink', { vc: true }), v.mover);
        }
      }
      if (v.lip) {
        const g3 = arcSlabGeo(v.r1 - 0.35, v.r1, v.a0, v.a1, 0, 0.6);
        g3.translate(v.x, v.y + 0.45, v.z); put(g3, hatchMat('bone', { vc: true }), v.mover);
      }
    }
  }
  function pillarProfile(style) {
    if (style === 'core') return t => 1 + 0.12 * Math.exp(-Math.pow((t - 0.62) * 9, 2)) + 0.25 * Math.pow(Math.max(0, t - 0.92) / 0.08, 2);
    if (style === 'knotted') return t => 1 + 0.18 * Math.sin(t * 23) * Math.sin(t * 7 + 1);
    if (style === 'tendon') return t => 0.9 + 0.1 * Math.sin(t * 40);
    return t => 1 + 0.35 * Math.pow(Math.max(0, t - 0.9) / 0.1, 2) - 0.05 * Math.sin(t * Math.PI);
  }
  function buildPillar(v) {
    const style = v.style;
    const g = columnGeo(v.r, v.bottom, v.top, { flutes: style === 'core' ? 22 : style === 'tendon' ? 7 : 14, fluteDepth: style === 'core' ? 0.14 : style === 'tendon' ? 0.22 : 0.09, profile: pillarProfile(style), seed: v.seed, bands: style === 'core' ? 7 : 4, twist: style === 'tendon' ? 0.06 : 0 });
    g.translate(v.x, 0, v.z);
    put(g, hatchMat(v.mat || 'bone', { vc: true, occ: true }), v.mover);
    // a cap that frays into ribs: reads as continuing upward into the dark
    if (v.cap !== false) {
      const parts = [];
      const n = style === 'core' ? 8 : 5;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + v.seed, pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8; const rr = v.r * (1.2 + t * 1.6); pts.push(new THREE.Vector3(Math.cos(a + t * 0.4) * rr, v.top - 0.5 + t * 4.5, Math.sin(a + t * 0.4) * rr)); }
        parts.push(sweepGeo(pts, circleProfile(v.r * 0.18, 6), t => 1 - t * 0.85));
      }
      const cg = mergeGeos(parts); cg.translate(v.x, 0, v.z);
      put(cg, hatchMat(v.mat || 'bone', { vc: true, occ: true }), v.mover);
    }
  }
  function buildWall(v) {
    const h = v.y1 - v.y0;
    const g = arcSlabGeo(v.r0, v.r1, v.a0, v.a1, v.y1, h);
    g.translate(v.x, 0, v.z);
    const mat = hatchMat(v.mat, { vc: true, occ: true });
    put(g, mat, v.mover);
    const span = v.a1 - v.a0;
    if (v.style === 'parapet') {
      // a coping of bone along the low near wall
      const c = arcSlabGeo(v.r0 - 0.15, v.r1 + 0.1, v.a0, v.a1, v.y1 + 0.35, 0.45); c.translate(v.x, 0, v.z);
      put(c, hatchMat('bone', { vc: true }), v.mover);
      return;
    }
    // pilasters: half columns on the inner face
    const n = Math.max(2, Math.round(Math.abs(span) * v.r0 / 3.2));
    const parts = [];
    for (let i = 0; i <= n; i++) {
      const a = v.a0 + span * i / n;
      const pr = 0.55 + (i % 3 === 0 ? 0.25 : 0);
      const col = columnGeo(pr, v.y0, v.y1 + (i % 3 === 0 ? 6 : 1), { flutes: 6, fluteDepth: 0.2, radial: 10, rows: 24, seed: i + v.seed, bands: 3 });
      col.translate(Math.cos(a) * (v.r0 + 0.1), 0, Math.sin(a) * (v.r0 + 0.1));
      parts.push(col);
    }
    // a ledge band at walking height and a high cornice
    const ledge = arcSlabGeo(v.r0 - 0.45, v.r0 + 0.05, v.a0, v.a1, 2.6, 0.5);
    const cor = arcSlabGeo(v.r0 - 0.9, v.r0 + 0.05, v.a0, v.a1, Math.min(v.y1 - 2, 14), 1.1);
    parts.push(ledge, cor);
    const g2 = mergeGeos(parts); g2.translate(v.x, 0, v.z);
    put(g2, hatchMat('bone', { vc: true, occ: true }), v.mover);
  }
  function buildBlock(v) {
    const h = v.y1 - v.y0;
    const g = new THREE.BoxGeometry(v.t, h, v.w, 1, Math.max(1, Math.round(h / 2)), Math.max(1, Math.round(v.w / 2)));
    // BoxGeometry depth runs along local z; we want length along yaw
    bakeXf(g, v.x, v.y0 + h / 2, v.z, Math.PI / 2 - v.yaw);
    const mat = hatchMat(v.mat, { vc: true, occ: true });
    put(ensureColor(g, 0.9), mat, v.mover);
    const parts = [];
    if (v.style === 'colonnade' || v.style === 'jamb') {
      const n = Math.max(1, Math.round(v.w / (v.style === 'jamb' ? 3.5 : 3)));
      for (let i = 0; i <= n; i++) {
        const u = -v.w / 2 + v.w * i / n;
        for (const side of [-1, 1]) {
          const c = columnGeo(0.45, v.y0, v.y1 + 1.2, { flutes: 8, fluteDepth: 0.15, radial: 12, rows: 20, seed: i * 3 + side, bands: 3 });
          c.translate(side * (v.t / 2 + 0.05), 0, u);
          parts.push(c);
        }
      }
      const cap = new THREE.BoxGeometry(v.t + 1.2, 0.8, v.w + 0.6); cap.translate(0, v.y1 + 0.4, 0); parts.push(ensureColor(cap, 1));
    } else if (v.style === 'screen') {
      const n = Math.max(2, Math.round(v.w / 0.9));
      for (let i = 0; i < n; i++) { const u = -v.w / 2 + (i + 0.5) * v.w / n; const s = new THREE.BoxGeometry(v.t + 0.3, h + 2, 0.35); s.translate(0, v.y0 + h / 2 + 1, u); parts.push(ensureColor(s, 0.8)); }
    } else {
      const ridge = new THREE.BoxGeometry(v.t + 0.5, 0.6, v.w + 0.4); ridge.translate(0, v.y1 + 0.3, 0); parts.push(ensureColor(ridge, 1));
    }
    if (parts.length) { const g2 = mergeGeos(parts); bakeXf(g2, v.x, 0, v.z, Math.PI / 2 - v.yaw); put(g2, hatchMat('bone', { vc: true, occ: true }), v.mover); }
  }

  // --- iris: petals that swing open about the rim (used by gates and portals) ---
  function makeIris(R, n, mat, thick) {
    const grp = new THREE.Group(), petals = [];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 1.35) / n * TAU;
      const sh = new THREE.Shape();
      const p0 = [Math.cos(a0) * R, Math.sin(a0) * R];
      sh.moveTo(0, 0);
      const steps = 6;
      for (let k = 0; k <= steps; k++) { const a = lerp(a0, a1, k / steps); sh.lineTo(Math.cos(a) * R * 1.02 - p0[0], Math.sin(a) * R * 1.02 - p0[1]); }
      sh.quadraticCurveTo(-p0[0] * 0.4, -p0[1] * 0.4 + 0.2, -p0[0], -p0[1]);
      sh.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: thick || 0.18, bevelEnabled: false, curveSegments: 4 });
      g.translate(0, 0, -((thick || 0.18) / 2) + (i % 2) * 0.02);
      const piv = new THREE.Group(); piv.position.set(p0[0], p0[1], 0);
      const m = new THREE.Mesh(g, mat); m.castShadow = castOK; m.receiveShadow = castOK;
      piv.add(m); grp.add(piv); petals.push(piv);
    }
    grp.userData.set = e => { const a = easeInOut(e) * 1.18; for (const p of petals) p.rotation.z = a; };
    return grp;
  }
  function frameRing(R, w, depth, mat) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0)); }
    const g = sweepGeo(pts, [[-w * 0.3, -depth], [w, -depth * 0.8], [w * 1.1, 0], [w, depth * 0.8], [-w * 0.3, depth]], null, { up: new THREE.Vector3(0, 0, 1) });
    return new THREE.Mesh(g, mat);
  }
  function buildGate(v) {
    const R = Math.max(v.w / 2, v.h / 2) * 1.02;
    const grp = new THREE.Group();
    grp.position.set(v.x, v.y + R * 0.92, v.z);
    // the iris plane holds the gate's length axis (yaw) and up
    grp.rotation.y = Math.PI / 2 - v.yaw + Math.PI / 2;
    const iris = makeIris(R, 9, hatchMat(v.mat || 'ochre', { vc: false }), 0.22);
    grp.add(iris);
    const fr = frameRing(R, 1.1, 0.7, hatchMat('bone', { vc: true }));
    fr.castShadow = castOK; grp.add(fr);
    const ring2 = frameRing(R + 1.3, 0.5, 0.45, hatchMat('ink', { vc: true }));
    grp.add(ring2);
    // footing so the frame meets the floor
    const foot = new THREE.Mesh(ensureColor(new THREE.BoxGeometry(2 * R + 1.5, 1.2, 1.4)), hatchMat('bone', { vc: true }));
    foot.position.set(0, -R * 0.92 - 0.2, 0); grp.add(foot);
    root.add(grp);
    gates[v.id] = { grp, iris, R, v };
  }
  function buildBridge(v) {
    const s = 1.15, n = Math.ceil(v.len / s) + 1;
    const parts = [];
    // a vertebra: centrum slab, transverse processes, a keel spine
    const cen = new THREE.BoxGeometry(v.w * 0.92, 0.5, s * 0.82, 2, 1, 2); cen.translate(0, -0.25, 0); parts.push(ensureColor(cen, 1));
    for (const side of [-1, 1]) {
      const pts = [new THREE.Vector3(side * v.w * 0.42, -0.3, 0), new THREE.Vector3(side * v.w * 0.75, -0.55, 0.1), new THREE.Vector3(side * v.w * 0.95, -1.1, 0.25)];
      parts.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - t * 0.6));
    }
    const spine = [new THREE.Vector3(0, -0.4, -s * 0.2), new THREE.Vector3(0, -1.3, 0), new THREE.Vector3(0, -2.2, s * 0.25)];
    parts.push(sweepGeo(spine, [[0, 0.35], [0.12, 0], [0, -0.35], [-0.12, 0]], t => 1 - t * 0.8));
    const vg = mergeGeos(parts);
    const inst = new THREE.InstancedMesh(vg, hatchMat(v.mat || 'bone', { vc: true }), n);
    inst.castShadow = castOK; inst.receiveShadow = castOK;
    inst.frustumCulled = false;
    root.add(inst);
    // the anchor knuckle
    const kn = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(v.w * 0.75, 16, 10)), hatchMat('bone', { vc: true }));
    kn.scale.set(1, 0.55, 1); kn.position.set(v.ax, v.y - 0.6, v.az); kn.castShadow = castOK; root.add(kn);
    bridges[v.id] = { inst, n, s, v, m: new THREE.Matrix4(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - v.yaw, 0)), lastE: -1 };
  }
  function buildRotor(v) {
    const grp = new THREE.Group(); grp.position.set(v.x, 0, v.z);
    root.add(grp);
    rotors[v.id] = { grp, group: grp, v };
    if (v.hub !== false) {
      // a toothed collar under the turning ring: shows that it turns
      const parts = [];
      const n = 28;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; const b = new THREE.BoxGeometry(0.5, 1.2, 0.9); b.translate(0, -2.2, v.r * 0.62); b.rotateY(a); parts.push(ensureColor(b, 0.7)); }
      const g = mergeGeos(parts);
      const m = new THREE.Mesh(g, hatchMat('ink', { vc: true })); grp.add(m);
    }
  }
  function buildRibs(v) {
    const parts = [];
    const prof = circleProfile(1, 12, 4, 0.35, 0.6);
    const th = v.thick || 1;
    const n = v.count || 6;
    for (let i = 0; i < n; i++) {
      const pts = [];
      if (v.span === 'vault') {
        const z = lerp(v.z0, v.z1, n > 1 ? i / (n - 1) : 0.5);
        for (let k = 0; k <= 24; k++) { const a = Math.PI * k / 24; pts.push(new THREE.Vector3(v.x + Math.cos(a) * v.r * 1.05, -12 + Math.sin(a) * (v.h + 12), z + Math.sin(a * 2) * 0.4)); }
      } else if (v.span === 'crown') {
        const a = lerp(v.a0 === undefined ? Math.PI * 1.05 : v.a0, v.a1 === undefined ? Math.PI * 1.95 : v.a1, n > 1 ? i / (n - 1) : 0.5);
        for (let k = 0; k <= 20; k++) { const t = k / 20; const rr = v.r * (1 - 0.55 * Math.sin(t * Math.PI * 0.5)); pts.push(new THREE.Vector3(v.x + Math.cos(a + t * 0.25) * rr, -18 + t * (v.h + 18), v.z + Math.sin(a + t * 0.25) * rr)); }
      } else { // 'over': half arches rising from the far rim and leaning over the chamber
        const a = lerp(v.a0 === undefined ? Math.PI * 1.1 : v.a0, v.a1 === undefined ? Math.PI * 1.9 : v.a1, n > 1 ? i / (n - 1) : 0.5);
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let k = 0; k <= 24; k++) { const t = k / 24; const rr = v.r * (1 - 0.62 * Math.sin(t * Math.PI * 0.5)); const y = -16 + (v.h + 16) * Math.sin(t * Math.PI * 0.5); pts.push(new THREE.Vector3(v.x + ca * rr, y, v.z + sa * rr)); }
      }
      parts.push(sweepGeo(pts, prof, t => th * (1.25 - 0.35 * Math.sin(t * Math.PI)), { ao: (t) => 0.6 + 0.4 * Math.sin(t * Math.PI) }));
    }
    put(mergeGeos(parts), hatchMat(v.mat || 'bone', { vc: true, occ: true }), null);
  }
  function buildShaft(v) {
    const parts = [];
    const rings = v.rings || 7;
    for (let k = 1; k <= rings; k++) {
      const y = -5 - k * (v.depth / rings) * 0.75, r = v.r * (1 - k * 0.035);
      const g = arcSlabGeo(r, r + 1.6 + k * 0.2, 0, TAU, y, 1.2); parts.push(g);
    }
    const nr = Math.round(v.r * 1.3);
    for (let i = 0; i < nr; i++) {
      const a = i / nr * TAU, pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12; const rr = v.r + 1.3 + Math.sin(t * 9 + i) * 0.3; pts.push(new THREE.Vector3(Math.cos(a) * rr, -3 - t * v.depth, Math.sin(a) * rr)); }
      parts.push(sweepGeo(pts, circleProfile(0.45, 6, 3, 0.4), null));
    }
    const g = mergeGeos(parts); g.translate(v.x, 0, v.z);
    put(g, hatchMat('ink', { vc: true }), null);
  }
  function buildMass(v) {
    // Distant architecture in the haze: towers, arches, spiral ramps, impossible stairs.
    const r = makeRng(v.seed || 5);
    const parts = [], far = [];
    const style = v.style || 'towers';
    const nT = style === 'towers' ? 14 : 9;
    for (let i = 0; i < nT; i++) {
      const a = r.range(0, TAU), d = r.range(55, 140);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 20;
      const rr = r.range(4, 13), top = r.range(40, 140);
      const g = columnGeo(rr, -120, top, { flutes: r.int(6, 16), fluteDepth: 0.12, radial: 16, rows: 26, seed: r.int(1, 99), bands: 5, profile: t => 1 + 0.3 * Math.pow(Math.max(0, t - 0.85) / 0.15, 2) });
      g.translate(x, 0, z); (d > 100 ? far : parts).push(g);
    }
    // great arches spanning the void
    const nA = style === 'arches' ? 6 : 3;
    for (let i = 0; i < nA; i++) {
      const a = r.range(0, TAU), d = r.range(60, 120), span = r.range(30, 70), h = r.range(30, 80);
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, dir = r.range(0, TAU);
      const pts = [];
      for (let k = 0; k <= 24; k++) { const u = k / 24 * 2 - 1; pts.push(new THREE.Vector3(cx + Math.cos(dir) * u * span, -60 + (h + 60) * Math.sqrt(1 - u * u), cz + Math.sin(dir) * u * span)); }
      far.push(sweepGeo(pts, circleProfile(1, 10, 4, 0.4, 0.7), () => r.range(2.2, 3.5)));
    }
    // a spiral ramp coiling around a void
    {
      const a = r.range(0, TAU), d = r.range(70, 110), cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, R = r.range(14, 24);
      const pts = [];
      for (let k = 0; k <= 90; k++) { const t = k / 90; const ang = t * TAU * 3.2; pts.push(new THREE.Vector3(cx + Math.cos(ang) * R * (1 - t * 0.35), -70 + t * 130, cz + Math.sin(ang) * R * (1 - t * 0.35))); }
      far.push(sweepGeo(pts, [[-3, 0.6], [3, 0.6], [3, -0.6], [-3, -0.6]], null));
    }
    // floating impossible stairs
    for (let i = 0; i < 4; i++) {
      const a = r.range(0, TAU), d = r.range(45, 90), cx = Math.cos(a) * d, cz = Math.sin(a) * d - 20, y0 = r.range(-10, 40), dir = r.int(0, 3) * Math.PI / 2;
      for (let k = 0; k < 14; k++) {
        const b = new THREE.BoxGeometry(5, 1, 1.8); b.translate(0, k * 0.9, k * 1.6); b.rotateY(dir); b.translate(cx, y0, cz); parts.push(b);
      }
      const side = new THREE.BoxGeometry(0.8, 2, 24); side.rotateX(-Math.atan2(0.9, 1.6)); side.translate(2.8, y0 + 5.5, 10.5); side.rotateY(dir); side.translate(cx, 0, cz); parts.push(side);
    }
    const L = LOOKS[W.def.look] || LOOKS.act1;
    if (parts.length) { const g = mergeGeos(parts); root.add(new THREE.Mesh(g, hazeMat(L.haze))); }
    if (far.length) { const g = mergeGeos(far); root.add(new THREE.Mesh(g, hazeMat(new THREE.Color(L.haze).lerp(new THREE.Color(L.fog), 0.35).getStyle()))); }
  }
  function buildRoots(v) {
    const parts = [];
    const n = v.n || 8, r = makeRng((v.x * 13 + v.z * 7 + 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = r.range(Math.PI * 1.05, Math.PI * 1.95), rr = v.r * r.range(0.85, 1.1);
      const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
      const pts = [], len = r.range(25, 55), sw = r.range(-2, 2);
      for (let k = 0; k <= 14; k++) { const t = k / 14; pts.push(new THREE.Vector3(x + Math.sin(t * 5 + i) * 0.6 + sw * t, (v.top || 30) - t * len, z + Math.cos(t * 4 + i) * 0.6)); }
      parts.push(sweepGeo(pts, circleProfile(0.32, 6, 2, 0.3), t => 1 - t * 0.85));
    }
    put(mergeGeos(parts), hatchMat('moss', { vc: true, occ: true }), null);
  }
  function buildLamp(v) {
    const l = new THREE.PointLight(new THREE.Color(v.color || '#d9b26a'), (v.intensity || 0.6) * 30, v.dist || 18, 1.6);
    l.position.set(v.x, v.y, v.z); root.add(l); lamps.push(l);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), glowMat(v.color || '#d9b26a', { opacity: 0.9 }));
    s.position.copy(l.position); root.add(s);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), glowMat(v.color || '#d9b26a', { opacity: 0.08 }));
    halo.position.copy(l.position); root.add(halo);
  }
  function buildPortal(v) {
    const R = v.size || 3.2;
    const grp = new THREE.Group();
    const d = dirYP(v.yaw, 0);
    grp.position.set(v.x + d[0] * 1.6, v.y + R * 0.95, v.z + d[2] * 1.6);
    grp.rotation.y = Math.PI / 2 - v.yaw; // ring plane faces along yaw (the way through)
    const fr = frameRing(R, 1.3, 1.0, hatchMat('bone', { vc: true })); fr.castShadow = castOK; grp.add(fr);
    // receding rings: a tunnel of irises
    for (let k = 1; k <= 5; k++) { const rr = frameRing(R * (1 - k * 0.1), 0.5, 0.3, hatchMat('ink', { vc: true })); rr.position.z = k * 1.6; grp.add(rr); }
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#efe6cf'), transparent: true, opacity: 0.0, fog: false }));
    glow.position.z = 0.5; grp.add(glow);
    const deep = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 32), glowMat('#fff3d6', { opacity: 0.0 }));
    deep.position.z = 6; grp.add(deep);
    const iris = makeIris(R * 0.98, 11, hatchMat('ochre', {}), 0.2); iris.position.z = 0.15; grp.add(iris);
    // massive surround: the portal is set in a wall of ribs
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.1 + 0.8 * i / 8), pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; const rr = R + 1.4 + t * 6; pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr - R * 0.2 - t * 2, -0.5 - t * 1.5)); }
      parts.push(sweepGeo(pts, circleProfile(0.55, 7, 3, 0.3), t => 1 - t * 0.6));
    }
    const sg = mergeGeos(parts); const sm = new THREE.Mesh(sg, hatchMat('bone', { vc: true, occ: true })); sm.castShadow = castOK; grp.add(sm);
    const light = new THREE.PointLight(new THREE.Color('#f3e2b8'), 0, 14, 1.5); light.position.set(0, 0, -2); grp.add(light);
    root.add(grp);
    portals.push({ grp, glow, deep, iris, light, v, open: 0 });
  }
  function buildEntry(v) {
    // a short landing under the entry so the traveller never appears from nowhere
    const d = dirYP(v.yaw, 0);
    const g = slabGeo(3.2, 3.4, 1.0, 0); bakeXf(g, v.x - d[0] * 1.7, v.y, v.z - d[2] * 1.7, Math.PI / 2 - v.yaw);
    put(g, hatchMat('walk', { vc: true }), null);
  }
  function buildZone(v) {
    const r = v.r || Math.max(v.hw || 2, v.hl || 2);
    const g = new THREE.RingGeometry(r * 0.15, r, 48, 3);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uWarm: { value: 0 }, uT: GU.uTime, uC: { value: new THREE.Color('#e3a94f') } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uA; uniform float uWarm; uniform float uT; uniform vec3 uC; varying vec2 vP;
        void main(){ float r = length(vP); float a = atan(vP.y, vP.x);
          float sp = abs(fract(r * 0.9 - a / 6.2831 * 2.0 - uT * 0.15) - 0.5);
          float line = smoothstep(0.08, 0.0, sp);
          float edge = smoothstep(${r.toFixed(2)} * 0.9, ${r.toFixed(2)}, r) * (1.0 - smoothstep(${r.toFixed(2)}, ${r.toFixed(2)} * 1.02, r));
          float k = (line * 0.55 + edge * 0.9) * max(uA, uWarm * 0.35);
          gl_FragColor = vec4(uC * k, k);\n#include <colorspace_fragment>\n}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const m = new THREE.Mesh(g, mat); m.position.set(v.x, (v.y || 0) + 0.05, v.z);
    if (v.hw) { m.scale.set(1, 1, (v.hl || v.hw) / (v.hw)); }
    root.add(m); zones[v.id] = { m, mat, v };
  }
  function buildRail(v) {
    const pts = v.pts.map(p => new THREE.Vector3(p[0], p[1] + 1.6, p[2]));
    if (v.loop) pts.push(pts[0].clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const sp = curve.getPoints(Math.max(20, Math.round(curve.getLength() * 1.5)));
    put(sweepGeo(sp, circleProfile(0.22, 8, 2, 0.5), null), hatchMat('ink', { vc: true }), null);
    const parts = [];
    for (let i = 0; i < sp.length; i += 6) {
      const p = sp[i];
      const pts2 = [p.clone(), p.clone().add(new THREE.Vector3(0, 6, 0))];
      parts.push(sweepGeo(pts2, circleProfile(0.12, 5), null));
    }
    if (parts.length) put(mergeGeos(parts), hatchMat('ink', { vc: true }), null);
  }
  function anchorOf(ref) {
    if (ref.p) return new THREE.Vector3(ref.p[0], ref.p[1], ref.p[2]);
    if (ref.eye) { const e = W.eyeById[ref.eye]; return new THREE.Vector3(e.pos[0] - e.facing[0] * e.size * 0.6, e.pos[1] - e.size * 0.6, e.pos[2] - e.facing[2] * e.size * 0.6); }
    if (ref.mover) {
      const m = W.moverById[ref.mover];
      if (m.kind === 'bridge') return new THREE.Vector3(m.ax, (m.y || 0) - 1.2, m.az);
      if (m.kind === 'gate') return new THREE.Vector3(m.x, (m.y || 0) - 0.5, m.z);
      if (m.kind === 'rotor') return new THREE.Vector3(m.pivot[0], -3, m.pivot[1]);
    }
    return new THREE.Vector3();
  }
  function buildTendon(v) {
    const a = anchorOf(v.from), b = anchorOf(v.to);
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - v.sag;
    const ctrl = [a, a.clone().lerp(mid, 0.5).setY(lerp(a.y, mid.y, 0.8)), mid, b.clone().lerp(mid, 0.5).setY(lerp(b.y, mid.y, 0.8)), b];
    const curve = new THREE.CatmullRomCurve3(ctrl);
    const pts = curve.getPoints(40);
    const g = sweepGeo(pts, circleProfile(v.w, 7, 3, 0.35), t => 0.6 + 0.6 * Math.sin(t * Math.PI));
    const mat = hatchMat('moss', { vc: true, unique: true, emissive: '#000000' });
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = castOK; root.add(mesh);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(v.w * 2.2, 10, 8), glowMat('#e9c27c', { opacity: 0 }));
    root.add(bead);
    tendons.push({ mesh, mat, curve, bead, v, pulse: -1 });
  }

  return { root, rotors, bridges, gates, tendons, portals, zones, lamps,
    dispose() {
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData && o.material.userData.unique !== false && !Object.values(_matCache).includes(o.material)) { if (o.material.dispose) o.material.dispose(); } });
    }
  };
}

// Per-frame sync of world mechanisms from the simulation.
function updateWorldView(V, W, dt) {
  for (const id in V.rotors) { const m = W.moverById[id]; if (m) V.rotors[id].grp.rotation.y = -m.angle; }
  for (const id in V.bridges) {
    const b = V.bridges[id], m = W.moverById[id];
    if (!m || b.lastE === m.e) continue; b.lastE = m.e;
    const L = m.len * easeInOut(m.e), dir = dirYP(m.yaw, 0);
    // a bridge shudders while it primes
    for (let k = 0; k < b.n; k++) {
      let d = k * b.s + b.s / 2;
      let sc = 1;
      if (d + b.s / 2 > L) { d = Math.max(b.s / 2, L - b.s / 2); sc = L < b.s ? Math.max(0.001, L / b.s) : 1; if (k * b.s > L + b.s) sc = 0.001; }
      b.m.compose(new THREE.Vector3(m.ax + dir[0] * d, m.y || 0, m.az + dir[2] * d), b.q, new THREE.Vector3(sc, sc, sc));
      b.inst.setMatrixAt(k, b.m);
    }
    b.inst.instanceMatrix.needsUpdate = true;
  }
  for (const id in V.gates) {
    const g = V.gates[id], m = W.moverById[id]; if (!m) continue;
    const shake = m.primeT > 0 ? Math.sin(W.t * 60) * 0.04 : 0;
    g.iris.userData.set(clamp01(m.e + shake));
  }
  const S = signalApi(W);
  for (const p of V.portals) {
    const want = W.exitOpen === false ? 0 : 1;
    p.open = damp(p.open, want, 3, dt);
    p.iris.userData.set(p.open);
    p.glow.material.opacity = 0.2 + 0.55 * p.open;
    p.deep.material.opacity = 0.25 + 0.6 * p.open * (0.85 + 0.15 * Math.sin(W.t * 2));
    p.light.intensity = 18 * p.open;
  }
  for (const id in V.zones) {
    const z = V.zones[id];
    let a = 0, warm = 0;
    for (const e of W.eyes) if (e.sentinel) {
      const cur = e.sentinel.zones[e.sentinel.idx];
      const held = (W.observedBy[e.id] || []).length > 0 || e.state === ST.PINNED || e.state === ST.RELEASING;
      if (cur === id && !held) a = Math.max(a, 1);
      const next = e.sentinel.zones[(e.sentinel.idx + 1) % e.sentinel.zones.length];
      if (next === id && e.sentinel.period - e.sentinel.t < 1.4 && !held) warm = Math.max(warm, 1 - (e.sentinel.period - e.sentinel.t) / 1.4);
      if (cur === id && e.state === ST.ACQUIRING) a = 1.6;
    }
    z.mat.uniforms.uA.value = damp(z.mat.uniforms.uA.value, a, 6, dt);
    z.mat.uniforms.uWarm.value = warm;
  }
  // tendon pulses ride from eye to mechanism when the mechanism primes
  for (const t of V.tendons) {
    if (t.pulse >= 0) {
      t.pulse += dt * 1.6;
      const p = t.curve.getPoint(clamp01(t.pulse));
      t.bead.position.copy(p); t.bead.material.opacity = t.pulse < 1 ? 0.95 : Math.max(0, 1 - (t.pulse - 1) * 4);
      t.mat.emissive.setRGB(0.25 * Math.max(0, 1 - Math.abs(t.pulse - 0.5) * 2), 0.18 * Math.max(0, 1 - Math.abs(t.pulse - 0.5) * 2), 0.05);
      if (t.pulse > 1.3) { t.pulse = -1; t.mat.emissive.setRGB(0, 0, 0); t.bead.material.opacity = 0; }
    }
  }
}
function pulseTendons(V, moverId) {
  for (const t of V.tendons) if (t.v.to && t.v.to.mover === moverId) t.pulse = 0;
}
