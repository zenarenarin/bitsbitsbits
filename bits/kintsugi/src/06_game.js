// KINTSUGI: the game. States: intro -> breaking -> assembly -> gold -> reveal -> results.
window.plethoraBit = {
  meta: { title: 'KINTSUGI', runtime: 'plethora-bit@2', tags: ['puzzle', '3d', 'craft', 'relaxing'], permissions: ['audio', 'haptics', 'storage'] },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });
    const DEV = typeof window !== 'undefined' && window.__KG_DEV;

    // ---------- surfaces
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.background = '#080807';
    const ring = ctx.createCanvas2D({ layer: 'overlay', order: 1, input: 'passthrough', coordinateSpace: 'css', maxDpr: 2 });
    const g2 = ring.getContext('2d');
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
    const audio = makeAudio();
    ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) {} };

    // ---------- persistence (device convenience + account progress)
    const store = {
      get(k) { try { return ctx.capabilities && ctx.capabilities.storage === false ? null : ctx.storage.get(k); } catch (e) { return null; } },
      set(k, v) { try { ctx.storage.set(k, v); } catch (e) {} }
    };
    const seen = Object.assign({ intro: false, gold: false, rotate: false, turn: false }, store.get('kg.seen') || {});
    const markSeen = k => { if (!seen[k]) { seen[k] = true; store.set('kg.seen', seen); } };
    let save = { v: 1, unlocked: 1, best: {}, grade: {} };
    const cached = store.get('kg.save');
    if (cached && cached.v === 1 && typeof cached.unlocked === 'number') save = cached;
    let progressReady = false;
    const progressLoad = (async () => {
      try {
        if (!ctx.game || !ctx.game.progress) return;
        const p = await ctx.game.progress.load('atelier');
        if (disposed) return;
        const st = p && p.state;
        const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress'));
        if ((eligible || (p && p.status === 'completed')) && st && st.v === 1 && typeof st.unlocked === 'number') {
          save.unlocked = Math.max(save.unlocked, clamp(st.unlocked | 0, 1, LEVELS.length));
          for (const k in (st.best || {})) if (typeof st.best[k] === 'number') save.best[k] = Math.max(save.best[k] || 0, st.best[k]);
          for (const k in (st.grade || {})) if (typeof st.grade[k] === 'string' && (!save.grade[k] || (st.best[k] || 0) >= (save.best[k] || 0))) save.grade[k] = st.grade[k];
        }
        progressReady = true;
      } catch (e) { progressReady = false; }
    })();
    let saving = Promise.resolve();
    function persist() {
      store.set('kg.save', save);
      const snap = JSON.parse(JSON.stringify(save));
      const allDone = LEVELS.every(l => snap.best[l.obj] > 0);
      saving = saving.then(async () => {
        try {
          if (!ctx.game || !ctx.game.progress) return;
          const payload = { state: snap, label: allDone ? 'Collection repaired' : 'No. ' + Math.min(snap.unlocked, LEVELS.length), percent: Object.keys(snap.best).length / LEVELS.length, stateSchemaVersion: 1 };
          await ctx.game.progress.save('atelier', payload);
          if (allDone) await ctx.game.progress.complete('atelier', {});
        } catch (e) { /* the device copy remains; a later level retries */ }
      });
    }

    // ---------- UI
    let paused = false, loop = null, gameReady = false;
    const ui = makeUI(ctx, {
      pause() { if (!gameReady || state === 'loading') return; paused = true; if (paint.active) { paint.active = false; audio.flowStop(); } if (held) { held.state = 'loose'; held = null; } mode = 'none'; audio.ui(); ui.pauseMenu(true, !audio.muted); if (loop) loop.pause(); },
      resume() { if (!gameReady) return; paused = false; ui.pauseMenu(false); if (loop) loop.resume(); },
      restart() { paused = false; ui.pauseMenu(false); if (loop) loop.resume(); attemptStart(); goLevel(levelIndex); },
      collection() { ui.collection(true, collectionRows()); },
      closeCollection() { ui.collection(false); },
      pick(i) { ui.collection(false); paused = false; ui.pauseMenu(false); if (loop) loop.resume(); attemptStart(); goLevel(i); },
      sound() { audio.setMuted(!audio.muted); store.set('kg.muted', audio.muted); ui.sound(!audio.muted); },
      again() { if (!gameReady || state !== 'results') return; audio.ui(); attemptStart(); goLevel(levelIndex); },
      next() {
        if (!gameReady || state !== 'results') return;
        audio.ui();
        if (levelIndex >= LEVELS.length - 1) { ui.collection(true, collectionRows()); return; }
        attemptStart(); goLevel(levelIndex + 1);
      }
    });
    if (store.get('kg.muted') === true) audio.setMuted(true);
    function collectionRows() {
      return LEVELS.map((l, i) => ({ name: OBJECTS[l.obj].name, grade: save.grade[l.obj] || '', locked: i + 1 > save.unlocked }));
    }

    // fonts load in the background; the UI has serif/sans fallbacks
    const fontP = Promise.all([
      () => ctx.loadFont('KG Cormorant', 'cormorant-garamond', '1.0.0', { style: 'italic', weight: '300' }),
      () => ctx.loadFont('KG Inter', 'inter', '1.0.0', { style: 'normal', weight: '400' })
    ].map(f => { try { return Promise.resolve(f()).catch(() => null); } catch (e) { return null; } }));

    // ---------- three.js
    let THREEmod;
    try { THREEmod = await ctx.importModule('three', '0.164.1'); }
    catch (e) { ctx.platform.error({ stage: 'dependency', message: String((e && e.message) || e) }); ui.note('Could not load the studio. Please try again.'); ctx.markVisualReady('error'); ctx.platform.ready(); return; }
    if (disposed) return;
    THREE = THREEmod;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) { ctx.platform.error({ stage: 'renderer', message: String((e && e.message) || e) }); ui.note('3D is unavailable on this device.'); ctx.markVisualReady('error'); ctx.platform.ready(); return; }
    ctx.onDestroy(() => { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} });
    let pixelRatio = DEV && window.__KG_PR ? window.__KG_PR : Math.min(2, ctx.dpr || 1);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setClearColor(0x080807, 1);

    const scene = new THREE.Scene();
    scene.environment = buildEnvironment(renderer);
    const camera = new THREE.PerspectiveCamera(26, ctx.width / ctx.height, 0.05, 60);
    const backdrop = makeBackdrop();
    scene.add(backdrop);
    const key = new THREE.DirectionalLight(0xfff1e2, 1.7);
    key.position.set(-2.6, 4.6, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera; sc.left = -1.4; sc.right = 1.4; sc.top = 1.6; sc.bottom = -1.2; sc.near = 1; sc.far = 12;
    const rim = new THREE.DirectionalLight(0xe2e8ff, 1.1);
    rim.position.set(2.2, 2.4, -3.6);
    const fill = new THREE.HemisphereLight(0xfff5e8, 0x0a0806, 0.12);
    for (const l of [key, rim, fill]) { l.layers.enableAll(); scene.add(l); }
    scene.add(key.target);
    const soft = makeSoftTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.42, color: 0x000000, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0.7, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002; contact.renderOrder = 1;
    scene.add(contact);
    const turn = new THREE.Group();
    scene.add(turn);
    const shared = { uTime: { value: 0 }, uCure: { value: 1.1 }, uFinalRough: { value: 0.24 }, uSettle: { value: 0 } };
    const goldMat = makeGoldMaterial(shared);
    goldMat.side = THREE.DoubleSide;
    goldMat.polygonOffset = true; goldMat.polygonOffsetFactor = -3; goldMat.polygonOffsetUnits = -3;
    const spillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.98, 0.72, 0.31), metalness: 1, roughness: 0.16, envMapIntensity: 2.4 });
    const hairMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.13, 0.11, 0.09, THREE.SRGBColorSpace), transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const shadowMatProto = new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false });
    const raycaster = new THREE.Raycaster();
    const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);

    // ---------- spill drops (instanced, they fade away)
    const SPILLS = 56;
    const spillGeo = new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2);
    const spillMesh = new THREE.InstancedMesh(spillGeo, spillMat, SPILLS);
    spillMesh.count = 0; spillMesh.frustumCulled = false;
    turn.add(spillMesh);
    const spills = [];

    // ---------- state
    let state = 'loading', stateT = 0, levelIndex = 0;
    let lv = null, def = null, surf = null, fr = null;
    let shards = [], seams = [], proxy = null, levelObjs = [], tex = null, mats = null;
    let Rb = 1, centerY = 0.5;
    let yaw = 0, yawVel = 0, yawTarget = null;
    let selected = null, held = null;
    let gold = 0, goldMax = 1, goldUsed = 0;
    let stats = null;
    let started = false, attempt = 0, hintT = 0, lastInteract = 0;
    let revealT = 0, finalQuality = 0, resultInfo = null;
    let waitingTouch = false, loadedAt = 0;
    const score = ctx.game.score({ initial: 0, min: 0 });
    let seamIndex = null;

    function attemptStart() { attempt++; started = true; try { ctx.platform.start({ level: levelIndex + 1 }); } catch (e) {} score.reset(); }

    // ---------- camera framing
    const cam = { D: 4, ox: 0, oy: 0, elev: 0.3, tD: 4, tox: 0, toy: 0, telev: 0.3, ty: 0.5, tty: 0.5 };
    function boxFor(phase) {
      const A = area(), W = ctx.width, H = ctx.height;
      const top = A.top + 70, bottom = H - A.bottom - 12;
      const portrait = H >= W * 1.05;
      if (phase === 'assembly') {
        if (portrait) { const h = (bottom - top) * 0.5; return { cx: W / 2, cy: top + h / 2, w: W - 64, h, s: Math.min(h, W - 48) }; }
        const w = W * 0.46; return { cx: W / 2, cy: (top + bottom) / 2, w, h: bottom - top, s: Math.min(w, bottom - top) * 0.92 };
      }
      if (phase === 'results') {
        const h = (bottom - top) * (portrait ? 0.68 : 0.76); return { cx: W / 2, cy: top + h / 2, w: W - 48, h, s: Math.min(h, W - 40) };
      }
      // intro, gold
      const h = (bottom - top); return { cx: W / 2, cy: top + h * 0.47, w: W - 40, h: h * 0.9, s: Math.min(h * 0.86, W - 28) };
    }
    function frame(phase, instant) {
      const b = boxFor(phase);
      const f = (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const e = def.elev;
      const maxR = surf.radius / 1.15;
      const halfH = 0.5 * surf.height * Math.cos(e) + maxR * 1.05 * Math.sin(e);
      const halfW = maxR * 1.1;
      // solve for distance, then add the perspective swell of the near side
      let D = Math.max(halfH * f / (b.h / 2), halfW * f / (b.w / 2));
      D += maxR * Math.cos(e) * 0.9;
      cam.tD = D;
      cam.tox = -(b.cx - ctx.width / 2); cam.toy = -(b.cy - ctx.height / 2);
      cam.telev = def.elev + (phase === 'results' ? -0.04 : 0);
      if (instant) { cam.D = cam.tD; cam.ox = cam.tox; cam.oy = cam.toy; cam.elev = cam.telev; }
    }
    function updateCamera(dt) {
      const k = 1 - Math.exp(-dt * 2.6);
      cam.D += (cam.tD - cam.D) * k; cam.ox += (cam.tox - cam.ox) * k; cam.oy += (cam.toy - cam.oy) * k; cam.elev += (cam.telev - cam.elev) * k;
      camera.aspect = ctx.width / ctx.height;
      camera.position.set(0, centerY + Math.sin(cam.elev) * cam.D, Math.cos(cam.elev) * cam.D);
      camera.lookAt(0, centerY, 0);
      camera.setViewOffset(ctx.width, ctx.height, cam.ox, cam.oy, ctx.width, ctx.height);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }
    const camFwd = () => tmpV2.set(0, centerY, 0).sub(camera.position).normalize();
    function toScreen(v, out) {
      tmpV.copy(v).project(camera);
      out[0] = (tmpV.x * 0.5 + 0.5) * ctx.width; out[1] = (-tmpV.y * 0.5 + 0.5) * ctx.height; out[2] = tmpV.z;
      return out;
    }
    function fromScreen(x, y, dist, out) {
      tmpV.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      // dist is measured along the view axis
      const fwd = camFwd();
      const t = dist / Math.max(0.2, tmpV.dot(fwd));
      return out.copy(camera.position).addScaledVector(tmpV, t);
    }
    const pxPerUnit = dist => (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / dist;
    const objPx = () => Rb * 2 * pxPerUnit(cam.D);

    // ---------- build a level
    function disposeLevel() {
      for (const o of levelObjs) { if (o.parent) o.parent.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material.isShaderMaterial) o.material.dispose(); }
      levelObjs = [];
      if (tex) { for (const k in tex) tex[k].dispose(); tex = null; }
      if (mats) { for (const m of new Set(mats)) m.dispose(); mats = null; }
      shards = []; seams = []; proxy = null; selected = null; held = null;
      spills.length = 0; spillMesh.count = 0;
    }
    function loadLevel(i) {
      const tL0 = performance.now();
      disposeLevel();
      levelIndex = i; lv = LEVELS[i]; def = OBJECTS[lv.obj];
      surf = makeSurface(def);
      fr = buildFracture(surf, lv);
      tex = makeGlazeTextures(surf, lv.seed);
      mats = makeCeramicMaterials(tex);
      Rb = Math.max(surf.height * 0.56, surf.radius * 0.98);
      centerY = surf.height * 0.46;
      // shards
      for (const f of fr.frags) {
        const geo = new THREE.BufferGeometry();
        const p = f.positions.slice();
        for (let k = 0; k < p.length; k += 3) { p[k] -= f.centroid[0]; p[k + 1] -= f.centroid[1]; p[k + 2] -= f.centroid[2]; }
        geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(f.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(f.indices, 1));
        for (const gr of f.groups) geo.addGroup(gr.start, gr.count, gr.mat);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.set(f.centroid[0], f.centroid[1], f.centroid[2]);
        turn.add(mesh);
        levelObjs.push(mesh);
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMatProto.clone());
        sh.layers.set(1); sh.renderOrder = 0; sh.visible = false;
        scene.add(sh); levelObjs.push(sh);
        const outline = makeOutline(f);
        const mass = Math.sqrt(f.area);
        // mean outward normal of the glazed face, for presenting the shard
        const nrm = new THREE.Vector3();
        { const P = [0, 0, 0], N = [0, 0, 0]; const bd = f.boundary; for (let k = 0; k < bd.length; k += Math.max(1, bd.length >> 5)) { surf.normal(bd[k][0].u, bd[k][0].v, N); nrm.x += N[0]; nrm.y += N[1]; nrm.z += N[2]; } if (f.seedUV) { surf.normal(f.seedUV.u, f.seedUV.v, N); nrm.x += N[0] * 4; nrm.y += N[1] * 4; nrm.z += N[2] * 4; } nrm.normalize(); }
        shards.push({
          f, mesh, sh, outline, mass, nrm, present: 0, anchor: f.anchor, state: 'placed', phi: f.phi,
          roll: 0, sx: 0, sy: 0, tx: 0, ty: 0, dist: 0, scale: 1, tscale: 1, lift: 0,
          vel: new THREE.Vector3(), w: new THREE.Vector3(), tq: new THREE.Quaternion(), quality: 1, misses: 0, hint: 0, flyT: 0, landed: false
        });
      }
      // seams
      seams = fr.seams.map(makeSeam);
      seamIndex = buildSeamIndex();
      // proxy for touches
      const pr = buildProxy(surf);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pr.positions, 3));
      pg.setIndex(new THREE.BufferAttribute(pr.indices, 1));
      pg.computeBoundingSphere();
      proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      proxy.layers.set(2);
      proxy.userData.outerTris = pr.indices.length / 6 | 0;
      turn.add(proxy); levelObjs.push(proxy);
      // stage
      const cr = surf.radius * 2.2;
      contact.scale.set(cr, cr, 1);
      key.target.position.set(0, centerY * 0.5, 0);
      floor.material.opacity = 0.42;
      yaw = 0; yawVel = 0; yawTarget = null; turn.rotation.y = 0;
      goldMax = fr.totalSeam * lv.gold; gold = goldMax; goldUsed = 0;
      shared.uSettle.value = 0; shared.uFinalRough.value = 0.24;
      scene.environmentRotation.set(0, 0, 0);
      stats = { strokes: 0, stops: 0, travel: 0, offTravel: 0, devSum: 0, devN: 0, rejects: 0, placeQ: [], samples: seams.reduce((a, s) => a + s.n, 0), seamsDone: 0 };
      paint.active = false;
      ui.level(i, LEVELS.length);
      ui.gold(1, false);
      ui.hideResults();
      ui.title(i + 1, def.name, true);
      ui.chrome(true);
      frame('intro', true);
      state = 'intro'; stateT = 0; loadedAt = performance.now();
      waitingTouch = !started;
      lastInteract = 0; hintT = 0; revealT = 0; resultInfo = null;
      audio.bed(0.1);
      if (DEV) window.__kgLoadMs = (window.__kgLoadMs || []).concat([[i, Math.round(performance.now() - tL0)]]);
    }

    function makeOutline(f) {
      const T = def.thick, pos = [], aS = [], aX = [], idx = [];
      // centre of the fragment in uv for the travelling light
      let u0 = f.boundary.length ? f.boundary[0][0].u : 0, su = 0, sv = 0, n = 0;
      for (const [p] of f.boundary) { su += u0 + wrapU(p.u - u0); sv += p.v; n++; }
      const uc = su / Math.max(1, n), vc = sv / Math.max(1, n), cs = surf.cscale(vc);
      const P = [0, 0, 0], N = [0, 0, 0], Q = [0, 0, 0], N2 = [0, 0, 0];
      const hw = 0.0042;
      for (const [p, q] of f.boundary) {
        surf.pos(p.u, p.v, P); surf.normal(p.u, p.v, N); surf.pos(q.u, q.v, Q); surf.normal(q.u, q.v, N2);
        const dx = Q[0] - P[0], dy = Q[1] - P[1], dz = Q[2] - P[2];
        const sP = Math.atan2(p.v - vc, wrapU(p.u - uc) * cs) / TAU + 0.5, sQ = Math.atan2(q.v - vc, wrapU(q.u - uc) * cs) / TAU + 0.5;
        for (let side = 0; side < 2; side++) {
          const sg = side ? -1 : 1, off = side ? -T : 0;
          const mk = (X, Nn, s) => {
            let bx = Nn[1] * dz - Nn[2] * dy, by = Nn[2] * dx - Nn[0] * dz, bz = Nn[0] * dy - Nn[1] * dx;
            const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
            const lift = 0.0016 * sg;
            const base = [X[0] + Nn[0] * (off + lift), X[1] + Nn[1] * (off + lift), X[2] + Nn[2] * (off + lift)];
            pos.push(base[0] - bx * hw, base[1] - by * hw, base[2] - bz * hw, base[0] + bx * hw, base[1] + by * hw, base[2] + bz * hw);
            aS.push(s, s); aX.push(-1, 1);
          };
          const b = pos.length / 3;
          mk(P, N, sP); mk(Q, N2, Math.abs(sQ - sP) > 0.5 ? sP : sQ);
          idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
      geo.setAttribute('aX', new THREE.Float32BufferAttribute(aX, 1));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, makeOutlineMaterial());
      m.material.side = THREE.DoubleSide;
      m.renderOrder = 4; m.visible = false; m.frustumCulled = false;
      turn.add(m); levelObjs.push(m);
      return { mesh: m, mat: m.material, opacity: 0, pulse: -1 };
    }

    function makeSeam(s, si) {
      const n = s.count, T = def.thick;
      const po = new Float32Array(n * 3), no = new Float32Array(n * 3), bi = new Float32Array(n * 3);
      const P = [0, 0, 0], N = [0, 0, 0];
      for (let m = 0; m < n; m++) { surf.pos(s.u[m], s.v[m], P); surf.normal(s.u[m], s.v[m], N); po.set(P, m * 3); no.set(N, m * 3); }
      for (let m = 0; m < n; m++) {
        const a = Math.max(0, m - 1), b = Math.min(n - 1, m + 1);
        const tx = po[b * 3] - po[a * 3], ty = po[b * 3 + 1] - po[a * 3 + 1], tz = po[b * 3 + 2] - po[a * 3 + 2];
        const nx = no[m * 3], ny = no[m * 3 + 1], nz = no[m * 3 + 2];
        let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        const l = Math.hypot(bx, by, bz) || 1;
        bi[m * 3] = bx / l; bi[m * 3 + 1] = by / l; bi[m * 3 + 2] = bz / l;
      }
      // pooling near junctions, a subtle swell where the crack opens
      const pool = new Float32Array(n), seed = new Float32Array(n);
      const rr = makeRng(fr.seed + si * 131);
      const nz = makeNoise(fr.seed + si);
      const step = s.length / Math.max(1, n - 1);
      for (let m = 0; m < n; m++) {
        const d0 = m * step, d1 = (n - 1 - m) * step;
        pool[m] = 1 + (s.j0 ? 0.75 * Math.exp(-d0 / 0.02) : 0) + (s.j1 ? 0.75 * Math.exp(-d1 / 0.02) : 0) + 0.18 * nz.n3(m * step * 9, 0.5, 0.5);
        seed[m] = rr();
      }
      // gold ribbon: 5 vertices across, both skins
      const K = 5, LR = 7;
      const lipEnds = [];
      if (s.rim0) lipEnds.push(0);
      if (s.rim1 && n > 1) lipEnds.push(n - 1);
      const VN = n * K * 2 + lipEnds.length * LR * K;
      const gpos = new Float32Array(VN * 3), gnor = new Float32Array(VN * 3), gfill = new Float32Array(VN).fill(-1);
      const galong = new Float32Array(VN), gacross = new Float32Array(VN), gseed = new Float32Array(VN), gbin = new Float32Array(VN * 3);
      const gidx = [];
      for (let side = 0; side < 2; side++) for (let m = 0; m < n; m++) for (let c = 0; c < K; c++) {
        const v = (side * n + m) * K + c;
        galong[v] = m * step; gacross[v] = -1 + c * 0.5; gseed[v] = seed[m];
        gbin[v * 3] = bi[m * 3]; gbin[v * 3 + 1] = bi[m * 3 + 1]; gbin[v * 3 + 2] = bi[m * 3 + 2];
        gpos[v * 3] = po[m * 3] - (side ? no[m * 3] * T : 0); gpos[v * 3 + 1] = po[m * 3 + 1] - (side ? no[m * 3 + 1] * T : 0); gpos[v * 3 + 2] = po[m * 3 + 2] - (side ? no[m * 3 + 2] * T : 0);
      }
      for (let side = 0; side < 2; side++) for (let m = 0; m < n - 1; m++) for (let c = 0; c < K - 1; c++) {
        const a = (side * n + m) * K + c, b = a + K;
        gidx.push(a, b, b + 1, a, b + 1, a + 1);
      }
      // the gold wraps over the lip where a crack reaches it
      const lips = lipEnds.map((m, li) => {
        const base = n * K * 2 + li * LR * K;
        for (let r = 0; r < LR; r++) for (let c = 0; c < K; c++) {
          const v = base + r * K + c;
          galong[v] = m * step + r * 0.004; gacross[v] = -1 + c * 0.5; gseed[v] = seed[m];
          gbin[v * 3] = bi[m * 3]; gbin[v * 3 + 1] = bi[m * 3 + 1]; gbin[v * 3 + 2] = bi[m * 3 + 2];
          gpos[v * 3] = po[m * 3]; gpos[v * 3 + 1] = po[m * 3 + 1]; gpos[v * 3 + 2] = po[m * 3 + 2];
        }
        for (let r = 0; r < LR - 1; r++) for (let c = 0; c < K - 1; c++) { const a = base + r * K + c, b = a + K; gidx.push(a, b, b + 1, a, b + 1, a + 1); }
        // arc over the rounded lip: outer edge -> crown -> inner edge
        const P = [0, 0, 0], Q = [0, 0, 0];
        surf.pos(s.u[m], s.v[m], P); surf.pos(s.u[m], s.v[m] - 0.004, Q);
        const tv = [P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]], tl = Math.hypot(tv[0], tv[1], tv[2]) || 1;
        for (let d = 0; d < 3; d++) tv[d] /= tl;
        const N3 = [no[m * 3], no[m * 3 + 1], no[m * 3 + 2]];
        const rows = [];
        for (let r = 0; r < LR; r++) {
          const t = r / (LR - 1), ang = t * Math.PI;
          // half-ellipse round the lip section
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const px = [], nx = [];
          for (let d = 0; d < 3; d++) {
            const mid = po[m * 3 + d] - N3[d] * T * 0.5;
            px.push(mid + N3[d] * T * 0.5 * ca + tv[d] * T * 0.42 * sa);
            nx.push(N3[d] * ca + tv[d] * sa);
          }
          rows.push({ p: px, n: nx });
        }
        return { m, base, rows };
      });
      const gg = new THREE.BufferGeometry();
      const att = {
        position: new THREE.BufferAttribute(gpos, 3), normal: new THREE.BufferAttribute(gnor, 3), aFill: new THREE.BufferAttribute(gfill, 1),
        aAlong: new THREE.BufferAttribute(galong, 1), aAcross: new THREE.BufferAttribute(gacross, 1), aSeed: new THREE.BufferAttribute(gseed, 1), aBin: new THREE.BufferAttribute(gbin, 3)
      };
      for (const k in att) gg.setAttribute(k, att[k]);
      gg.setIndex(gidx);
      gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, centerY, 0), Rb * 2);
      const gm = new THREE.Mesh(gg, goldMat);
      gm.renderOrder = 3; gm.castShadow = false; gm.receiveShadow = true;
      turn.add(gm); levelObjs.push(gm);
      // dark hairline
      const hpos = new Float32Array(n * 2 * 2 * 3), hidx = [];
      const hw = 0.0021;
      for (let side = 0; side < 2; side++) for (let m = 0; m < n; m++) {
        const off = side ? -T : 0, lift = side ? -0.0007 : 0.0007;
        for (let c = 0; c < 2; c++) {
          const v = (side * n + m) * 2 + c, sg = c ? 1 : -1;
          for (let d = 0; d < 3; d++) hpos[v * 3 + d] = po[m * 3 + d] + no[m * 3 + d] * (off + lift) + bi[m * 3 + d] * hw * sg;
        }
      }
      for (let side = 0; side < 2; side++) for (let m = 0; m < n - 1; m++) { const a = (side * n + m) * 2; hidx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(hpos, 3));
      hg.setIndex(hidx);
      const hm = new THREE.Mesh(hg, hairMat);
      hm.renderOrder = 2; hm.visible = false; hm.frustumCulled = false;
      turn.add(hm); levelObjs.push(hm);
      return {
        a: s.a, b: s.b, n, len: s.length, step, po, no, bi, pool, seed, rim0: s.rim0, rim1: s.rim1,
        fill: new Float32Array(n).fill(-1), dev: new Float32Array(n), width: new Float32Array(n), filled: 0, done: false,
        gold: gm, att, hair: hm, dirty: false, idx: si, lips
      };
    }

    function buildSeamIndex() {
      const C = 0.05, map = new Map();
      const keyOf = (x, y, z) => ((Math.floor(x / C) + 512) * 1048576) + ((Math.floor(y / C) + 512) * 1024) + (Math.floor(z / C) + 512);
      const T = def.thick;
      seams.forEach((s, si) => {
        for (let m = 0; m < s.n; m++) for (let side = 0; side < 2; side++) {
          const x = s.po[m * 3] - (side ? s.no[m * 3] * T : 0), y = s.po[m * 3 + 1] - (side ? s.no[m * 3 + 1] * T : 0), z = s.po[m * 3 + 2] - (side ? s.no[m * 3 + 2] * T : 0);
          const k = keyOf(x, y, z);
          let arr = map.get(k); if (!arr) map.set(k, arr = []);
          arr.push(si, m, side);
        }
      });
      return {
        nearest(p, r) {
          let best = null, bd = r * r;
          const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), cz = Math.floor(p.z / C);
          const rc = Math.ceil(r / C);
          for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) for (let k = -rc; k <= rc; k++) {
            const arr = map.get(((cx + i + 512) * 1048576) + ((cy + j + 512) * 1024) + (cz + k + 512));
            if (!arr) continue;
            for (let q = 0; q < arr.length; q += 3) {
              const s = seams[arr[q]], m = arr[q + 1], side = arr[q + 2];
              const x = s.po[m * 3] - (side ? s.no[m * 3] * T : 0) - p.x, y = s.po[m * 3 + 1] - (side ? s.no[m * 3 + 1] * T : 0) - p.y, z = s.po[m * 3 + 2] - (side ? s.no[m * 3 + 2] * T : 0) - p.z;
              const d = x * x + y * y + z * z;
              if (d < bd) { bd = d; best = { s: arr[q], m, side, d: Math.sqrt(d) }; }
            }
          }
          return best;
        }
      };
    }

    // write one gold sample into the ribbon (both skins)
    function writeGold(s, m) {
      const K = 5, T = def.thick, w = s.width[m], h = w * 0.3;
      const P = s.att.position.array, Nn = s.att.normal.array, F = s.att.aFill.array;
      for (let side = 0; side < 2; side++) {
        const sg = side ? -1 : 1;
        for (let c = 0; c < K; c++) {
          const v = (side * s.n + m) * K + c, a = -1 + c * 0.5;
          const prof = Math.pow(Math.max(0, 1 - a * a), 0.55);
          const lift = 0.0011 + h * prof;
          for (let d = 0; d < 3; d++) {
            const nrm = s.no[m * 3 + d] * sg;
            P[v * 3 + d] = s.po[m * 3 + d] - (side ? s.no[m * 3 + d] * T : 0) + s.bi[m * 3 + d] * a * w * 0.5 + nrm * lift;
            Nn[v * 3 + d] = nrm + s.bi[m * 3 + d] * a * 0.85;
          }
          const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
          Nn[v * 3] /= l; Nn[v * 3 + 1] /= l; Nn[v * 3 + 2] /= l;
          F[v] = s.fill[m];
        }
      }
      for (const L of s.lips) {
        if (L.m !== m) continue;
        for (let r = 0; r < L.rows.length; r++) {
          const R = L.rows[r];
          for (let c = 0; c < K; c++) {
            const v = L.base + r * K + c, a = -1 + c * 0.5;
            const prof = Math.pow(Math.max(0, 1 - a * a), 0.55), lift = 0.0011 + h * prof;
            for (let d = 0; d < 3; d++) {
              P[v * 3 + d] = R.p[d] + s.bi[m * 3 + d] * a * w * 0.5 + R.n[d] * lift;
              Nn[v * 3 + d] = R.n[d] + s.bi[m * 3 + d] * a * 0.85;
            }
            const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
            Nn[v * 3] /= l; Nn[v * 3 + 1] /= l; Nn[v * 3 + 2] /= l;
            F[v] = s.fill[m] + 0.02 * r;
          }
        }
      }
      s.dirty = true;
    }
    const W0 = 0.0165;
    function fillSample(s, m, devNorm, delay) {
      if (s.fill[m] >= 0) return 0;
      s.fill[m] = shared.uTime.value + delay;
      s.dev[m] = devNorm;
      const jitter = 0.9 + s.seed[m] * 0.2;
      s.width[m] = W0 * (0.82 + 0.9 * devNorm) * jitter * s.pool[m];
      writeGold(s, m);
      s.filled++;
      stats.devSum += devNorm; stats.devN++;
      return s.step;
    }

    // ---------- shards: tray layout and transforms
    function trayLayout() {
      const loose = shards.filter(s => !s.anchor && s.state !== 'placed');
      if (!loose.length) return;
      const A = area(), W = ctx.width, H = ctx.height;
      const b = boxFor('assembly');
      const portrait = H >= W * 1.05;
      const rects = portrait
        ? [{ x0: A.left + 12, y0: b.cy + b.h * 0.5 + 4, x1: W - A.right - 12, y1: H - A.bottom - 6 }]
        : [{ x0: A.left + 14, y0: A.top + 60, x1: b.cx - b.s * 0.5 - 4, y1: H - A.bottom - 8 }, { x0: b.cx + b.s * 0.5 + 4, y0: A.top + 60, x1: W - A.right - 14, y1: H - A.bottom - 8 }];
      const trayDist = cam.tD - Rb * 0.25;
      const ppu = (ctx.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / trayDist;
      let areaAvail = 0;
      for (const r of rects) areaAvail += Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
      let need = 0;
      for (const s of loose) need += Math.PI * Math.pow(s.f.radius * ppu * 0.78, 2);
      const tscale = clamp(Math.sqrt(areaAvail * 0.5 / Math.max(1, need)), 0.36, 1);
      const items = loose.map(s => ({ s, r: s.f.radius * ppu * 0.78 * tscale })).sort((a, c) => c.r - a.r);
      const placed = [];
      for (const it of items) {
        let best = null, bs = -1e9;
        for (const r of rects) {
          for (let y = r.y0 + 6; y <= r.y1 - 6; y += 7) for (let x = r.x0 + 6; x <= r.x1 - 6; x += 7) {
            let sc = Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y) - it.r;
            for (const p of placed) sc = Math.min(sc, Math.hypot(x - p.x, y - p.y) - (it.r + p.r) * 0.92);
            sc = Math.min(sc, 60) - Math.hypot(x - b.cx, y - b.cy) * 0.02;
            if (sc > bs) { bs = sc; best = { x, y }; }
          }
        }
        if (!best) best = { x: W / 2, y: H * 0.8 };
        placed.push({ x: best.x, y: best.y, r: it.r, s: it.s });
      }
      // relax: push overlapping pieces apart, keep them inside their region
      const bound = (p) => { let r = rects[0], bd = 1e9; for (const q of rects) { const d = Math.hypot(clamp(p.x, q.x0, q.x1) - p.x, clamp(p.y, q.y0, q.y1) - p.y); if (d < bd) { bd = d; r = q; } } p.x = clamp(p.x, r.x0 + p.r * 0.8, r.x1 - p.r * 0.8); p.y = clamp(p.y, r.y0 + p.r * 0.7, r.y1 - p.r * 0.7); };
      for (let it = 0; it < 40; it++) {
        for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i], c = placed[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 1, need = (a.r + c.r) * 0.86;
          if (d < need) { const push = (need - d) * 0.5; a.x -= dx / d * push; a.y -= dy / d * push; c.x += dx / d * push; c.y += dy / d * push; }
        }
        for (const q of placed) bound(q);
      }
      for (const p of placed) { p.s.tx = p.x; p.s.ty = p.y; p.s.tscale = tscale; p.s.restScale = tscale; }
    }
    function rollQuat(roll, out) { return out.setFromAxisAngle(camFwd(), roll); }
    const qFace = new THREE.Quaternion(), vN = new THREE.Vector3(), vC = new THREE.Vector3(), qI = new THREE.Quaternion();
    // resting shards turn their glazed face toward the viewer; near their place
    // (present -> 0) they take their true orientation
    function displayQuat(s, out) {
      tmpQ2.setFromAxisAngle(Y, -s.phi);
      if (s.present > 0.001 && s.nrm) {
        vN.copy(s.nrm).applyQuaternion(tmpQ2);
        vC.copy(camFwd()).negate();
        if (vN.dot(vC) < 0) vN.negate();
        qFace.setFromUnitVectors(vN, vC);
        qI.identity().slerp(qFace, s.present * 0.72);
        tmpQ2.premultiply(qI);
      }
      rollQuat(s.roll, out);
      return out.multiply(tmpQ2);
    }
    function targetWorld(s, out) { return turn.localToWorld(out.set(s.f.centroid[0], s.f.centroid[1], s.f.centroid[2])); }
    const scr = [0, 0, 0], scr2 = [0, 0, 0];

    function placeShard(s) {
      s.state = 'placed';
      s.mesh.layers.set(0);
      turn.attach(s.mesh);
      s.mesh.position.set(s.f.centroid[0], s.f.centroid[1], s.f.centroid[2]);
      s.mesh.quaternion.identity(); s.mesh.scale.setScalar(1);
      s.sh.visible = false;
      s.mesh.castShadow = true;
    }
    function looseShard(s) {
      s.mesh.layers.set(1);
      scene.attach(s.mesh);
      s.mesh.castShadow = false;
      s.sh.visible = true;
    }

    // ---------- break
    function startBreak() {
      if (state !== 'intro') return;
      state = 'breaking'; stateT = 0;
      ui.title(null, null, false);
      audio.crack(); haptic('heavy');
      frame('assembly');
      const rr = makeRng(fr.seed + 5);
      // rolls for this level
      for (const s of shards) {
        if (s.anchor) continue;
        s.roll = lv.roll > 0 ? rr.sign() * lerp(lv.roll * 0.35, lv.roll, rr()) * Math.PI / 180 : 0;
        // at least a clear misalignment when rotation is part of the level
        if (lv.roll > 30 && Math.abs(s.roll) < lv.rollTol * 1.8 * Math.PI / 180) s.roll = Math.sign(s.roll || 1) * lv.rollTol * 2.2 * Math.PI / 180;
      }
      // hairlines flash across every crack for a moment
      for (const se of seams) se.hair.visible = true;
      // pieces leave in a staggered burst after the crack
      updateCamera(0);
      const C = new THREE.Vector3();
      for (const s of shards) {
        if (s.anchor) continue;
        looseShard(s);
        s.state = 'flying'; s.flyT = -0.18 - rr() * 0.12; s.landed = false; s.present = 1;
        s.scale = 1;
        const out = new THREE.Vector3(s.f.centroid[0], 0, s.f.centroid[2]).normalize();
        out.applyAxisAngle(Y, yaw);
        const imp = 1.0 / Math.pow(s.mass, 0.45);
        s.vel.copy(out).multiplyScalar(lerp(0.9, 1.5, rr()) * imp).add(C.set(rr.range(-0.3, 0.3), lerp(0.8, 1.4, rr()) * imp, lerp(0.4, 0.9, rr())));
        s.w.set(rr.range(-1, 1), rr.range(-1, 1), rr.range(-1, 1)).normalize().multiplyScalar(lerp(3, 7, rr()) / Math.pow(s.mass, 0.5));
      }
      trayLayout();
    }

    function stepFlight(s, dt) {
      s.flyT += dt;
      if (s.flyT < 0) return;
      const fwdDist = cam.tD - Rb * 0.25;
      const target = fromScreen(s.tx, s.ty, fwdDist, tmpV.clone());
      const k = 30 / Math.pow(s.mass, 0.35), c = 2 * Math.sqrt(k) * 0.78;
      const x = s.mesh.position;
      const ax = (target.x - x.x) * k - s.vel.x * c, ay = (target.y - x.y) * k - s.vel.y * c, az = (target.z - x.z) * k - s.vel.z * c;
      const grav = s.flyT < 0.22 ? -4.5 : 0;
      s.vel.x += ax * dt; s.vel.y += (ay + grav) * dt; s.vel.z += az * dt;
      x.addScaledVector(s.vel, dt);
      // rotation: spin decays into the display pose
      displayQuat(s, s.tq);
      tmpQ.copy(s.tq).multiply(tmpQ2.copy(s.mesh.quaternion).invert());
      if (tmpQ.w < 0) { tmpQ.x = -tmpQ.x; tmpQ.y = -tmpQ.y; tmpQ.z = -tmpQ.z; tmpQ.w = -tmpQ.w; }
      const ang = 2 * Math.acos(clamp(tmpQ.w, -1, 1)), sn = Math.sqrt(Math.max(1e-9, 1 - tmpQ.w * tmpQ.w));
      const kr = 26 / Math.pow(s.mass, 0.3), cr = 2 * Math.sqrt(kr) * 0.85;
      s.w.x += (tmpQ.x / sn * ang * kr - s.w.x * cr) * dt; s.w.y += (tmpQ.y / sn * ang * kr - s.w.y * cr) * dt; s.w.z += (tmpQ.z / sn * ang * kr - s.w.z * cr) * dt;
      const wl = s.w.length();
      if (wl > 1e-6) { tmpQ.setFromAxisAngle(tmpV2.copy(s.w).divideScalar(wl), wl * dt); s.mesh.quaternion.premultiply(tmpQ).normalize(); }
      s.mesh.scale.setScalar(lerp(1, s.tscale, smooth(s.flyT / 0.9)));
      const dist = x.distanceTo(target);
      if (!s.landed && s.flyT > 0.35 && s.vel.length() < 0.9) { s.landed = true; audio.land(clamp(s.mass * 1.5, 0, 1)); }
      if (s.flyT > 0.6 && dist < 0.004 && s.vel.length() < 0.05 && wl < 0.08) {
        s.state = 'loose'; s.sx = s.tx; s.sy = s.ty; s.scale = s.tscale; s.dist = fwdDist;
      }
      if (s.flyT > 2.4) { s.state = 'loose'; s.sx = s.tx; s.sy = s.ty; s.scale = s.tscale; s.dist = fwdDist; }
    }

    // ---------- assembly: held / loose shard placement
    function shardScreen(s, out) { return toScreen(s.mesh.position, out); }
    function errors(s) {
      const tw = targetWorld(s, new THREE.Vector3());
      toScreen(tw, scr2);
      shardScreen(s, scr);
      const dpx = Math.hypot(scr[0] - scr2[0], scr[1] - scr2[1]);
      return { pos: dpx / objPx(), yaw: wrapAngle(yaw + s.phi), roll: wrapAngle(s.roll), tx: scr2[0], ty: scr2[1], dpx, tw };
    }
    const deg = x => x * Math.PI / 180;
    function updateLooseShard(s, dt) {
      const k = 1 - Math.exp(-dt * 14);
      if (s.state === 'held') {
        const e = errors(s);
        // magnetic help once close, position, orientation and the turn of the object
        const near = 1 - clamp01(e.dpx / (objPx() * lv.pos * 2.4));
        const yawOk = Math.abs(e.yaw) < deg(lv.yawTol) * 2.2, rollOk = Math.abs(e.roll) < deg(lv.rollTol) * 2.2;
        let gx = s.gx, gy = s.gy;
        if (yawOk && rollOk && near > 0) {
          const pull = near * near * 0.55;
          gx = lerp(gx, e.tx, pull); gy = lerp(gy, e.ty, pull);
          s.roll -= e.roll * near * near * dt * 5;
          yawVel -= e.yaw * near * near * dt * 30;
        }
        s.sx += (gx - s.sx) * (1 - Math.exp(-dt * 26)); s.sy += (gy - s.sy) * (1 - Math.exp(-dt * 26));
        // depth eases toward the target's depth as the piece approaches
        const tdist = e.tw.clone().sub(camera.position).dot(camFwd());
        const close = 1 - clamp01(e.dpx / (objPx() * 0.7));
        s.present += (1 - smooth(1 - clamp01(e.dpx / (objPx() * 0.95))) - s.present) * (1 - Math.exp(-dt * 10));
        const want = lerp(cam.D - Rb * 0.25, Math.min(cam.D - Rb * 0.25, tdist) - 0.02, close * (yawOk ? 1 : 0.2));
        s.dist += (want - s.dist) * k;
        s.tscale = 1;
        s.lift += (1 - s.lift) * (1 - Math.exp(-dt * 12));
      } else if (s.state === 'loose') {
        s.present += (1 - s.present) * (1 - Math.exp(-dt * 6));
        s.sx += (s.tx - s.sx) * k * 0.6; s.sy += (s.ty - s.sy) * k * 0.6;
        s.dist += (cam.D - Rb * 0.25 - s.dist) * k;
        s.lift += (0 - s.lift) * (1 - Math.exp(-dt * 8));
        s.tscale = s.restScale || s.tscale;
      }
      s.scale += (s.tscale * (1 + s.lift * 0.03) - s.scale) * (1 - Math.exp(-dt * 12));
      // gentle breath when hinted
      const bob = s.hint > 0 ? Math.sin(stateT * 3.2) * 5 * s.hint : 0;
      fromScreen(s.sx, s.sy - s.lift * 4 - bob, s.dist, s.mesh.position);
      displayQuat(s, s.mesh.quaternion);
      s.mesh.scale.setScalar(s.scale);
      // soft shadow behind and below
      const sh = s.sh;
      sh.visible = true;
      const r = s.f.radius * s.scale * 1.5;
      sh.quaternion.copy(camera.quaternion);
      sh.position.copy(s.mesh.position).addScaledVector(camFwd(), 0.12 + s.lift * 0.05);
      tmpV.set(0.02 + s.lift * 0.03, -0.035 - s.lift * 0.05, 0).applyQuaternion(camera.quaternion);
      sh.position.add(tmpV);
      sh.scale.set(r * 2.1, r * 1.8, 1);
      sh.material.opacity = 0.32 + s.lift * 0.22;
    }

    function trySnap(s) {
      const e = errors(s);
      const ok = e.pos < lv.pos && Math.abs(e.yaw) < deg(lv.yawTol) && Math.abs(e.roll) < deg(lv.rollTol);
      if (ok) {
        const q = 1 - clamp01(e.pos / lv.pos * 0.4 + Math.abs(e.yaw) / deg(lv.yawTol) * 0.3 + Math.abs(e.roll) / deg(lv.rollTol) * 0.3) * 0.5;
        s.quality = clamp01(q - s.misses * 0.04);
        stats.placeQ.push(s.quality);
        s.state = 'snapping'; s.snapT = 0;
        s.snapFrom = s.mesh.position.clone(); s.snapQ = s.mesh.quaternion.clone(); s.snapS = s.mesh.scale.x;
        yawTarget = -s.phi;
        s.sh.visible = false;
        try { ctx.platform.interact({ kind: 'place' }); } catch (er) {}
        return true;
      }
      // close but not right: a small, honest refusal
      if (e.pos < lv.pos * 2.6) {
        s.misses++; stats.rejects++;
        audio.reject(); haptic('light');
        const dx = s.sx - e.tx, dy = s.sy - e.ty, l = Math.hypot(dx, dy) || 1;
        s.tx = s.sx + dx / l * 22; s.ty = s.sy + dy / l * 22;
      } else {
        audio.drop();
        s.tx = s.sx; s.ty = s.sy;
      }
      // keep inside the screen
      const A = area();
      s.tx = clamp(s.tx, A.left + 24, ctx.width - A.right - 24); s.ty = clamp(s.ty, A.top + 60, ctx.height - A.bottom - 16);
      s.restScale = Math.max(s.restScale || 0.6, 0.86);
      return false;
    }
    function stepSnap(s, dt) {
      s.snapT += dt / 0.34;
      const t = clamp01(s.snapT);
      const tw = targetWorld(s, new THREE.Vector3());
      // a breath of anticipation, then it seats
      const a = t < 0.22 ? -0.05 * Math.sin(Math.PI * t / 0.22) : easeOutCubic((t - 0.22) / 0.78);
      s.mesh.position.lerpVectors(s.snapFrom, tw, a);
      tmpQ.setFromAxisAngle(Y, yaw);
      s.mesh.quaternion.slerpQuaternions(s.snapQ, tmpQ, clamp01(a));
      s.mesh.scale.setScalar(lerp(s.snapS, 1, clamp01(a)));
      if (t >= 1) {
        placeShard(s);
        audio.snap(clamp(s.mass, 0, 1)); haptic('medium');
        s.outline.pulse = 0;
        for (const se of seams) se.hair.visible = shards[se.a].state === 'placed' && shards[se.b].state === 'placed';
        if (shards.every(x => x.state === 'placed')) { state = 'assembled'; stateT = 0; }
      }
    }

    // ---------- gold painting
    const paint = { active: false, x: 0, y: 0, lastH: null, lastS: -1, lastM: -1, still: 0, stopped: false, dripAcc: 0, spillAcc: 0, speed: 0, onCrack: false };
    const hitTmp = new THREE.Vector3();
    function rayObject(x, y) {
      raycaster.setFromCamera(new THREE.Vector2((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1), camera);
      raycaster.layers.set(2);
      const hit = raycaster.intersectObject(proxy, false)[0];
      return hit || null;
    }
    function magnetR() {
      // never below a comfortable touch size on screen
      const px = 13 / pxPerUnit(cam.D);
      return Math.max(lv.magnet, px);
    }
    function paintStep(dt) {
      const hit = rayObject(paint.x, paint.y);
      if (!hit) { paint.lastH = null; paint.onCrack = false; audio.flow(0, false); return; }
      const H = turn.worldToLocal(hitTmp.copy(hit.point)).clone();
      const travel = paint.lastH ? H.distanceTo(paint.lastH) : 0;
      paint.lastH = H;
      stats.travel += travel;
      const sp = travel / Math.max(1e-3, dt);
      paint.speed += (sp - paint.speed) * 0.3;
      if (gold <= 0) { audio.flow(0, false); return; }
      const R = magnetR();
      const nb = seamIndex.nearest(H, R);
      let used = 0;
      if (nb) {
        const s = seams[nb.s];
        const devNorm = clamp01(nb.d / lv.magnet);
        paint.onCrack = true;
        // fill continuously between the last contact and this one
        let from = nb.m, to = nb.m;
        if (paint.lastS === nb.s && paint.lastM >= 0) {
          const maxStep = Math.ceil((travel * 1.8 + 0.03) / s.step);
          if (Math.abs(nb.m - paint.lastM) <= maxStep) { from = Math.min(paint.lastM, nb.m); to = Math.max(paint.lastM, nb.m); }
        }
        let newLen = 0;
        for (let m = from; m <= to; m++) newLen += fillSample(s, m, devNorm, 0);
        // capillary: liquid gold runs a little ahead along the crack
        const dir = paint.lastS === nb.s ? Math.sign(nb.m - paint.lastM) : 0;
        if (dir !== 0) for (let w = 1; w <= 3; w++) { const m = nb.m + dir * w; if (m >= 0 && m < s.n) newLen += fillSample(s, m, devNorm, 0.035 * w); }
        used = newLen * (1 + devNorm * 0.6) + travel * 0.05;
        paint.lastS = nb.s; paint.lastM = nb.m;
        // pooling when the finger rests: a wider bead, and gold spent
        if (travel < 0.0012) {
          paint.still += dt;
          if (paint.still > 0.3 && !paint.stopped) { paint.stopped = true; stats.stops++; }
          if (paint.still > 0.3 && s.fill[nb.m] >= 0 && s.width[nb.m] < W0 * 2.2) {
            s.width[nb.m] *= 1 + dt * 0.8; writeGold(s, nb.m); used += dt * 0.015;
          }
        } else { paint.still = 0; paint.stopped = false; }
        if (newLen > 0) { paint.dripAcc += newLen; if (paint.dripAcc > 0.09) { paint.dripAcc = 0; haptic('light'); } }
        if (s.filled >= s.n && !s.done) completeSeam(s);
      } else {
        paint.onCrack = false;
        paint.lastS = -1; paint.lastM = -1;
        used = travel * 1.05;
        stats.offTravel += travel;
        paint.spillAcc += travel;
        if (paint.spillAcc > 0.03 || (travel > 0 && spills.length === 0)) { paint.spillAcc = 0; spawnSpill(H, hit.face ? hit.face.normal : null, clamp(travel / 0.02, 0.4, 1.3)); audio.drip(); }
      }
      used = Math.min(used, gold);
      gold -= used; goldUsed += used;
      audio.flow(clamp(paint.speed / 1.2, 0, 1), paint.onCrack);
    }
    function spawnSpill(H, faceN, size) {
      let n;
      if (faceN) n = faceN.clone(); else n = new THREE.Vector3(H.x, 0, H.z).normalize();
      if (spills.length >= SPILLS) spills.shift();
      spills.push({ p: H.clone(), n, r: 0.006 * size + 0.003, t: 0 });
    }
    function updateSpills(dt) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      let c = 0;
      for (let i = spills.length - 1; i >= 0; i--) { spills[i].t += dt; if (spills[i].t > 2.8) spills.splice(i, 1); }
      for (const s of spills) {
        const grow = smooth(s.t / 0.12), fade = 1 - smooth((s.t - 0.7) / 2.1);
        const r = s.r * grow * fade;
        q.setFromUnitVectors(Y, s.n);
        sc.set(r, r * 0.32, r);
        m4.compose(s.p, q, sc);
        spillMesh.setMatrixAt(c++, m4);
      }
      spillMesh.count = c;
      spillMesh.instanceMatrix.needsUpdate = true;
    }
    let settleCount = 0;
    function completeSeam(s) {
      s.done = true; stats.seamsDone++;
      audio.settle(settleCount++);
      haptic('light');
    }
    // after a stroke, tiny unfilled gaps on a nearly finished seam fill themselves
    function bridgeGaps() {
      for (const s of seams) {
        if (s.done || s.filled < s.n * 0.88) continue;
        let run = 0, maxRun = 0;
        for (let m = 0; m < s.n; m++) { if (s.fill[m] < 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
        if (maxRun <= 7) {
          let k = 0, need = 0;
          for (let m = 0; m < s.n; m++) if (s.fill[m] < 0) need += s.step;
          if (need > gold) continue;
          for (let m = 0; m < s.n; m++) if (s.fill[m] < 0) { gold -= s.step; goldUsed += s.step; fillSample(s, m, 0.5, 0.05 + 0.02 * (k++)); }
          completeSeam(s);
        }
      }
    }

    // ---------- reveal and results
    function computeScore() {
      const placement = stats.placeQ.length ? stats.placeQ.reduce((a, b) => a + b, 0) / stats.placeQ.length : 1;
      const goldPrec = stats.devN ? clamp01(1 - (stats.devSum / stats.devN) * 0.85) : 0;
      const precision = placement * 0.4 + goldPrec * 0.6;
      const completion = seams.reduce((a, s) => a + s.filled, 0) / Math.max(1, stats.samples);
      const offRatio = stats.offTravel / Math.max(1e-3, stats.travel);
      const extra = Math.max(0, stats.strokes - Math.ceil(seams.length * 1.2));
      const flow = clamp01(1 - extra * 0.03 - stats.stops * 0.04 - offRatio * 0.8);
      const efficiency = clamp01((fr.totalSeam * completion) / Math.max(1e-3, goldUsed) / 0.86);
      const total = Math.round(1000 * (0.35 * precision + 0.2 * flow + 0.2 * efficiency + 0.25 * completion) * (0.6 + 0.4 * completion));
      const grade = total >= 900 ? 'Perfect' : total >= 780 ? 'Excellent' : total >= 600 ? 'Beautiful' : 'Repaired';
      return { total, grade, precision, flow, efficiency, completion };
    }
    function beginReveal() {
      state = 'reveal'; stateT = 0; revealT = 0;
      paint.active = false; audio.flowStop();
      resultInfo = computeScore();
      finalQuality = resultInfo.total / 1000;
      shared.uFinalRough.value = lerp(0.32, 0.16, smooth((finalQuality - 0.45) / 0.5));
      for (const s of shards) s.outline.opacity = 0;
      ui.gold(gold / goldMax, false);
      ui.chrome(false);
      audio.final(finalQuality); haptic('success');
      audio.bed(0.55);
      frame('results');
      revealYaw0 = yaw;
      try { ctx.platform.milestone('repaired', { level: levelIndex + 1 }); } catch (e) {}
    }
    let revealYaw0 = 0;
    function showResults() {
      state = 'results'; stateT = 0;
      const r = resultInfo;
      const obj = lv.obj;
      const prevBest = save.best[obj] || 0;
      if (r.total > prevBest) { save.best[obj] = r.total; save.grade[obj] = r.grade; }
      else if (!save.grade[obj]) save.grade[obj] = r.grade;
      save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
      persist();
      const last = levelIndex >= LEVELS.length - 1;
      ui.results({ grade: r.grade, score: r.total, meta: prevBest > 0 ? (r.total > prevBest ? 'New best' : 'Best ' + prevBest) : '', nextLabel: last ? 'Collection' : 'Next' });
      audio.reveal();
      score.set(r.total);
      try { ctx.platform.complete({ level: levelIndex + 1, score: r.total, grade: r.grade }); } catch (e) {}
      const mine = attempt;
      // leaderboard: per object, never blocking replay
      try {
        const dims = { object: obj };
        score.submit('repair', { dimensions: dims, label: r.grade }).then(() => score.rank('repair', { scope: 'global', period: 'all_time', dimensions: dims })).then(st => {
          if (disposed || mine !== attempt || state !== 'results') return;
          const vr = st && st.viewerRank;
          if (vr && typeof vr.rank === 'number') ui.meta(`Best ${vr.value} · ${ordinal(vr.rank)} of ${st.totalRanked}`);
        }).catch(() => { if (!disposed && mine === attempt && state === 'results' && prevBest === 0) ui.meta(''); });
      } catch (e) {}
      ctx.timeout(() => { if (disposed || mine !== attempt || state !== 'results') return; try { ctx.pulse.complete({ level: levelIndex + 1, score: r.total, result: r.grade, text: def.name + ' — ' + r.grade }); } catch (e) {} }, 1400);
    }
    const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

    // ---------- level transitions
    let transitioning = false;
    async function goLevel(i) {
      if (transitioning) return;
      transitioning = true;
      ui.hideResults();
      try {
        const tr = ctx.fx.transition({ kind: 'fade', color: '#070706', outMs: 420, inMs: 520 });
        await tr.cover();
        if (disposed) return;
        state = 'loading';
        loadLevel(i);
        updateCamera(1); render();
        await tr.reveal();
      } catch (e) {
        state = 'loading'; loadLevel(i);
      }
      transitioning = false;
    }

    // ---------- input
    const pointers = new Map();
    let mode = 'none', modePtr = -1, twist = null, turnLast = null, ringGrab = 0;
    const cssXY = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function pickShard(x, y) {
      raycaster.setFromCamera(new THREE.Vector2((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1), camera);
      raycaster.layers.set(1);
      const cands = shards.filter(s => !s.anchor && (s.state === 'loose' || s.state === 'held')).map(s => s.mesh);
      const hit = raycaster.intersectObjects(cands, false)[0];
      if (hit) return shards.find(s => s.mesh === hit.object);
      // generous touch: nearest shard centre within its radius
      let best = null, bd = 1e9;
      for (const s of shards) {
        if (s.anchor || s.state !== 'loose') continue;
        shardScreen(s, scr);
        const r = s.f.radius * s.scale * pxPerUnit(s.dist) * 0.75 + 10;
        const d = Math.hypot(scr[0] - x, scr[1] - y);
        if (d < r && d < bd) { bd = d; best = s; }
      }
      return best;
    }
    const ringRadius = s => s.f.radius * s.scale * pxPerUnit(s.dist) * 0.95 + 18;
    function ringKnob(s) {
      shardScreen(s, scr);
      const R = ringRadius(s), a = s.roll - Math.PI / 2;
      return [scr[0] + Math.cos(a) * R, scr[1] + Math.sin(a) * R, scr[0], scr[1]];
    }
    const rotationOn = () => lv && lv.roll > 0;
    function firstGesture() {
      audio.unlock();
      if (!started) {
        attemptStart();
        ctx.timeout(() => audio.bedStart(), 60);
      } else if (!audio.ready) audio.unlock();
    }
    function onDown(e) {
      if (paused || transitioning) return;
      firstGesture();
      const [x, y] = cssXY(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
      pointers.set(e.pointerId, { x, y, sx: x, sy: y, px: x, py: y, type: e.pointerType });
      lastInteract = stateT;
      if (pointers.size === 2 && mode === 'shard' && held) {
        const ps = [...pointers.values()];
        twist = { a: Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) };
        return;
      }
      if (pointers.size > 1) return;
      modePtr = e.pointerId;
      if (state === 'intro') { if (performance.now() - loadedAt > 250) startBreak(); mode = 'none'; return; }
      if (state === 'assembly') {
        if (selected && rotationOn() && selected.state === 'loose') {
          const k = ringKnob(selected);
          if (Math.hypot(k[0] - x, k[1] - y) < 26) { mode = 'ring'; ringGrab = Math.atan2(y - k[3], x - k[2]) - selected.roll; return; }
        }
        const s = pickShard(x, y);
        if (s) {
          mode = 'shard'; held = s; selected = s; s.state = 'held';
          shardScreen(s, scr);
          s.ox = scr[0] - x; s.oy = scr[1] - y;
          s.touch = e.pointerType === 'touch';
          s.gx = s.sx; s.gy = s.sy;
          audio.select(clamp(s.mass, 0, 1)); haptic('light');
          markSeen('intro');
          for (const o of shards) o.hint = 0;
          if (rotationOn() && !seen.rotate && Math.abs(wrapAngle(s.roll)) > deg(lv.rollTol)) s.rotDemo = 0;
          return;
        }
        if (selected) selected = null;
        mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null;
        return;
      }
      if (state === 'gold') {
        if (rayObject(x, y)) {
          mode = 'paint'; paint.active = true; paint.x = x; paint.y = y; paint.lastH = null; paint.lastS = -1; paint.lastM = -1; paint.still = 0; paint.stopped = false;
          stats.strokes++;
          audio.flowStart();
          markSeen('gold');
          try { ctx.platform.interact({ kind: 'gold' }); } catch (er) {}
          return;
        }
        mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null;
        return;
      }
      if (state === 'results' || state === 'reveal') { mode = 'turn'; turnLast = { x, t: performance.now() }; yawTarget = null; }
    }
    function onMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const [x, y] = cssXY(e);
      p.px = p.x; p.py = p.y; p.x = x; p.y = y;
      if (twist && held && pointers.size >= 2) {
        const ps = [...pointers.values()];
        const a = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x);
        held.roll += wrapAngle(a - twist.a); twist.a = a;
        return;
      }
      if (e.pointerId !== modePtr) return;
      if (mode === 'shard' && held) {
        const lift = held.touch ? 34 : 0;
        held.gx = x + held.ox; held.gy = y + held.oy - lift * Math.min(1, held.lift * 2);
      } else if (mode === 'ring' && selected) {
        const k = ringKnob(selected);
        selected.roll = Math.atan2(y - k[3], x - k[2]) - ringGrab;
      } else if (mode === 'turn' && turnLast) {
        const now = performance.now(), dx = x - turnLast.x;
        yaw += dx * 0.0085;
        yawVel = yawVel * 0.5 + (dx * 0.0085) / Math.max(0.008, (now - turnLast.t) / 1000) * 0.5;
        turnLast = { x, t: now };
      } else if (mode === 'paint') { paint.x = x; paint.y = y; }
    }
    function onUp(e) {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (twist && pointers.size < 2) twist = null;
      if (e.pointerId !== modePtr) return;
      const cancelled = e.type === 'pointercancel';
      if (mode === 'shard' && held) {
        const s = held; held = null;
        if (cancelled || !trySnap(s)) { if (s.state === 'held') s.state = 'loose'; }
        else selected = null;
      } else if (mode === 'paint') {
        paint.active = false; audio.flowStop();
        bridgeGaps();
      } else if (mode === 'turn') {
        if (turnLast && performance.now() - turnLast.t > 80) yawVel = 0;
        if (p && Math.hypot(p.x - p.sx, p.y - p.sy) < 6 && state === 'assembly') selected = null;
      }
      mode = 'none'; modePtr = -1; turnLast = null;
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    ctx.listen(canvas, 'wheel', e => {
      if (state !== 'assembly') return;
      const s = held || selected;
      if (s && rotationOn()) { e.preventDefault(); s.roll += Math.sign(e.deltaY) * deg(6); }
    }, { passive: false });
    ctx.listen(window, 'keydown', e => {
      const s = held || selected;
      if (state === 'assembly' && s && rotationOn() && (e.key === 'q' || e.key === 'e' || e.key === 'Q' || e.key === 'E')) s.roll += (e.key.toLowerCase() === 'e' ? 1 : -1) * deg(5);
    });

    // ---------- the overlay: rotation ring and quiet cues
    let ringAlpha = 0;
    function drawOverlay(dt) {
      g2.clearRect(0, 0, ctx.width, ctx.height);
      const s = state === 'assembly' && rotationOn() ? (held || selected) : null;
      const target = s && s.state !== 'snapping' ? (held ? 0.35 : 1) : 0;
      ringAlpha += (target - ringAlpha) * (1 - Math.exp(-dt * 10));
      if (ringAlpha > 0.01 && (s || ringLast)) {
        const t = s || ringLast;
        if (s) ringLast = s;
        if (t.state === 'placed') { ringLast = null; return; }
        const k = ringKnob(t), R = ringRadius(t);
        g2.save();
        g2.globalAlpha = ringAlpha;
        g2.strokeStyle = 'rgba(236,228,214,0.32)'; g2.lineWidth = 1;
        g2.beginPath(); g2.arc(k[2], k[3], R, 0, TAU); g2.stroke();
        // a short arc either side of the knob says "turn"
        const a = t.roll - Math.PI / 2;
        g2.strokeStyle = 'rgba(236,228,214,0.75)'; g2.lineWidth = 1.5;
        g2.beginPath(); g2.arc(k[2], k[3], R, a - 0.32, a + 0.32); g2.stroke();
        g2.fillStyle = 'rgba(242,236,224,0.95)';
        g2.beginPath(); g2.arc(k[0], k[1], 4.5, 0, TAU); g2.fill();
        g2.strokeStyle = 'rgba(242,236,224,0.25)'; g2.lineWidth = 1;
        g2.beginPath(); g2.arc(k[0], k[1], 11, 0, TAU); g2.stroke();
        g2.restore();
      }
    }
    let ringLast = null;

    // ---------- resize
    ctx.onResize(() => {
      if (!renderer) return;
      renderer.setSize(ctx.width, ctx.height, false);
      backdrop.material.uniforms.uAspect.value = ctx.width / ctx.height;
      if (!lv) return;
      const ph = state === 'assembly' || state === 'breaking' ? 'assembly' : state === 'results' || state === 'reveal' ? 'results' : 'intro';
      frame(ph);
      if (state === 'assembly' || state === 'breaking') { updateCamera(1); trayLayout(); }
    }, { immediate: false, debounceMs: 60 });

    // ---------- main loop
    let perfAcc = 0, perfN = 0;
    function update(dtMs) {
      if (paused || !lv) return;
      const dt = Math.min(0.05, dtMs / 1000);
      stateT += dt;
      shared.uTime.value += dt;
      // adaptive resolution
      perfAcc += dtMs; perfN++;
      if (perfN >= 90) { const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; if (avg > 26 && pixelRatio > 1.25) { pixelRatio = Math.max(1.25, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); renderer.setSize(ctx.width, ctx.height, false); } }
      // turntable
      if (mode !== 'turn') {
        if (yawTarget !== null) { const d = wrapAngle(yawTarget - yaw); yaw += d * (1 - Math.exp(-dt * 7)); if (Math.abs(d) < 0.0005) yawTarget = null; yawVel = 0; }
        else { yaw += yawVel * dt; yawVel *= Math.exp(-dt * 3.2); if (Math.abs(yawVel) < 0.002) yawVel = 0; }
      }
      // gentle invitation before the first touch
      let tremble = 0;
      if (state === 'intro') {
        if (waitingTouch) { const ph = stateT % 2.4; tremble = ph < 0.22 ? Math.sin(ph * 90) * 0.006 * (1 - ph / 0.22) : 0; if (stateT > 6) startBreak(); }
        else if (stateT > 1.7) startBreak();
      }
      turn.rotation.y = yaw + tremble;
      turn.updateMatrixWorld();
      updateCamera(dt);

      if (state === 'breaking') {
        let all = true;
        for (const s of shards) if (s.state === 'flying') { stepFlight(s, dt); all = false; }
        // hairlines vanish once the pieces part
        if (stateT > 0.35) for (const se of seams) se.hair.visible = shards[se.a].state === 'placed' && shards[se.b].state === 'placed';
        if (all) { state = 'assembly'; stateT = 0; lastInteract = 0; }
      }
      if (state === 'assembly' || state === 'assembled') {
        for (const s of shards) {
          if (s.state === 'held' || s.state === 'loose') updateLooseShard(s, dt);
          else if (s.state === 'snapping') stepSnap(s, dt);
          // ghost of the place, only for the piece in hand or selected
          const want = (s === held || s === selected) && s.state !== 'placed' ? lerp(0.42, 0.2, levelIndex / (LEVELS.length - 1)) : (s.hint > 0 ? 0.18 * s.hint : 0);
          s.outline.opacity += (want - s.outline.opacity) * (1 - Math.exp(-dt * 8));
        }
        // rotation demo, once: the piece turns a little by itself, then back
        if (held && held.rotDemo !== undefined && held.rotDemo < 1) {
          held.rotDemo += dt / 1.1;
          held.roll += Math.cos(held.rotDemo * TAU) * dt * 0.9;
          if (held.rotDemo >= 1) { held.rotDemo = 1; markSeen('rotate'); }
        }
        // if a piece belongs round the back, the object shows that it turns
        if (held && levelIndex >= 3 && !seen.turn) {
          const e = Math.abs(wrapAngle(yaw + held.phi));
          held.backT = (held.backT || 0) + (e > deg(55) ? dt : -dt);
          if (held.backT > 1.2) { yawVel = -Math.sign(wrapAngle(yaw + held.phi)) * 0.9; held.backT = -2; markSeen('turn'); }
        }
        // a quiet hint after a long pause
        if (state === 'assembly' && !held && stateT - lastInteract > (seen.intro ? 9 : 3.5)) {
          const cand = shards.find(s => s.state === 'loose');
          if (cand) cand.hint = Math.min(1, cand.hint + dt);
        }
        if (state === 'assembled' && stateT > 0.5) beginGold();
      }
      for (const s of shards) if (s.outline.pulse >= 0) { s.outline.pulse += dt / 0.65; if (s.outline.pulse > 1) s.outline.pulse = -1; }
      if (state === 'gold') {
        if (paint.active) paintStep(dt);
        ui.gold(gold / goldMax, true);
        const allDone = seams.every(s => s.done);
        if (allDone) { goldEndT += dt; if (goldEndT > 0.9) beginReveal(); }
        else if (gold <= 1e-4) { goldEndT += dt; if (goldEndT > 1.6 && !paint.active) beginReveal(); }
        else goldEndT = 0;
        // teach once: a bead of gold runs along a crack until the first stroke
        demoT = !seen.gold && stats.strokes === 0 ? demoT + dt : -1;
      }
      if (state === 'reveal') {
        revealT += dt;
        shared.uSettle.value = smooth(revealT / 1.2);
        const t = clamp01((revealT - 0.6) / 9.0);
        yaw = revealYaw0 + easeInOutCubic(t) * TAU; yawVel = 0; yawTarget = null;
        scene.environmentRotation.y = Math.sin(clamp01(revealT / 7) * Math.PI) * 0.9;
        backdrop.material.uniforms.uLight.value = 1 + smooth(revealT / 2) * 0.25;
        if (revealT > 3.4) showResults();
      }
      if (state === 'results') {
        if (revealT < 9.6) { revealT += dt; const t = clamp01((revealT - 0.6) / 9.0); if (mode !== 'turn' && yawVel === 0) yaw = revealYaw0 + easeInOutCubic(t) * TAU; }
        scene.environmentRotation.y = Math.sin(clamp01(revealT / 7) * Math.PI) * 0.9;
      }
      updateSpills(dt);
      // upload changed gold
      for (const s of seams) if (s.dirty) { s.dirty = false; s.att.position.needsUpdate = true; s.att.normal.needsUpdate = true; s.att.aFill.needsUpdate = true; }
      for (const s of shards) {
        const o = s.outline;
        o.mat.uniforms.uOpacity.value = o.opacity; o.mat.uniforms.uTime.value = shared.uTime.value; o.mat.uniforms.uPulse.value = o.pulse;
        o.mesh.visible = o.opacity > 0.004 || o.pulse >= 0;
      }
      backdrop.material.uniforms.uTime.value = shared.uTime.value;
      drawOverlay(dt);
      drawDemo();
    }
    let goldEndT = 0, demoT = -1;
    const demoBead = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), spillMat);
    demoBead.visible = false; turn.add(demoBead);
    function drawDemo() {
      if (state !== 'gold' || demoT < 1.0) { demoBead.visible = false; return; }
      // the longest seam facing the viewer
      if (!demoSeam || demoSeam.done) {
        let best = null, bs = -1;
        for (const s of seams) {
          const m = s.n >> 1;
          const nx = s.no[m * 3], nz = s.no[m * 3 + 2];
          const face = Math.cos(yaw) * nz - Math.sin(yaw) * nx;
          const sc = s.len * (face > 0.3 ? 1 : 0);
          if (sc > bs) { bs = sc; best = s; }
        }
        demoSeam = best;
      }
      if (!demoSeam) return;
      const ph = ((demoT - 1.0) % 2.6) / 1.6;
      if (ph > 1) { demoBead.visible = false; return; }
      const span = Math.min(demoSeam.n - 1, Math.round(0.16 / demoSeam.step));
      const m0 = Math.max(0, (demoSeam.n >> 1) - (span >> 1));
      const m = Math.min(demoSeam.n - 1, m0 + Math.round(easeInOutCubic(ph) * span));
      demoBead.visible = true;
      const r = 0.0075 * Math.sin(Math.PI * clamp01(ph * 1.2)) + 0.002;
      demoBead.position.set(demoSeam.po[m * 3] + demoSeam.no[m * 3] * 0.004, demoSeam.po[m * 3 + 1] + demoSeam.no[m * 3 + 1] * 0.004, demoSeam.po[m * 3 + 2] + demoSeam.no[m * 3 + 2] * 0.004);
      demoBead.scale.set(r, r, r);
    }
    let demoSeam = null;
    function beginGold() {
      state = 'gold'; stateT = 0; goldEndT = 0; demoSeam = null;
      for (const se of seams) se.hair.visible = true;
      for (const s of shards) s.outline.opacity = 0;
      selected = null; held = null;
      frame('intro');
      yawTarget = 0;
      audio.bed(0.35);
      ui.gold(1, true);
    }

    let shadowSig = '';
    function render() {
      renderer.clear();
      camera.layers.set(0);
      // shadows only re-render when something that casts them moved
      const sig = turn.rotation.y.toFixed(5) + ':' + shards.reduce((a, x) => a + (x.state === 'placed' ? 1 : 0), 0) + ':' + levelIndex;
      if (sig !== shadowSig) { shadowSig = sig; renderer.shadowMap.needsUpdate = true; }
      renderer.render(scene, camera);
      if (shards.some(s => s.state !== 'placed')) {
        renderer.clearDepth();
        camera.layers.set(1);
        renderer.render(scene, camera);
        camera.layers.set(0);
      }
    }

    // ---------- start
    await Promise.race([progressLoad, new Promise(r => ctx.timeout(r, 1200))]);
    if (disposed) return;
    levelIndex = clamp(save.unlocked - 1, 0, LEVELS.length - 1);
    if (save.best[LEVELS[levelIndex].obj] > 0 && levelIndex < LEVELS.length - 1) levelIndex = Math.min(LEVELS.length - 1, levelIndex);
    backdrop.material.uniforms.uAspect.value = ctx.width / ctx.height;
    loadLevel(levelIndex);
    updateCamera(1);
    render();
    gameReady = true;
    ctx.markVisualReady('first-frame');
    ctx.platform.ready();
    loop = ctx.game.loop({ update, render: () => { if (!paused) render(); } });
    function visibleAt(x, y, local) { const h = rayObject(x, y); if (!h) return false; return turn.worldToLocal(h.point.clone()).distanceTo(local) < 0.03; }
    function seamPts(si) {
      const s = seams[si], outp = [], T = def.thick;
      const camL = turn.worldToLocal(camera.position.clone());
      for (let m = 0; m < s.n; m++) {
        const p = new THREE.Vector3(s.po[m * 3], s.po[m * 3 + 1], s.po[m * 3 + 2]);
        const n = new THREE.Vector3(s.no[m * 3], s.no[m * 3 + 1], s.no[m * 3 + 2]);
        const toC = camL.clone().sub(p).normalize();
        let side = 0, f = n.dot(toC);
        if (f < 0.15) { side = 1; p.addScaledVector(n, -T); f = -f; }
        const w = turn.localToWorld(p.clone());
        const sc = toScreen(w, [0, 0, 0]);
        const vis = f > 0.2 && visibleAt(sc[0], sc[1], p) ? f : 0;
        outp.push([sc[0], sc[1], vis, side, s.fill[m] >= 0 ? 1 : 0]);
      }
      return outp;
    }
    function autoAssemble() {
      if (state === 'intro') startBreak();
      for (const sh of shards) if (!sh.anchor && sh.state !== 'placed') { placeShard(sh); stats.placeQ.push(1); }
      for (const se of seams) se.hair.visible = true;
      state = 'assembled'; stateT = 0;
    }
    function autoGold(dev, frac) {
      let k = 0;
      for (const se of seams) { const lim = Math.floor(se.n * (frac == null ? 1 : frac)); for (let m = 0; m < lim; m++) { const used = fillSample(se, m, dev, 0.002 * (k++)); gold -= used; goldUsed += used * (1 + dev * 0.6); } if (se.filled >= se.n) completeSeam(se); }
    }
    if (DEV) window.__kg = { autoAssemble, autoGold, seamPts, area: () => area(), get state() { return state; }, shards: () => shards, seams: () => seams, lv: () => lv, startBreak, goLevel, errors, toScreen: v => toScreen(v, [0, 0, 0]), targetWorld: s => targetWorld(s, new THREE.Vector3()), camera, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, gold: () => [gold, goldMax], score: () => resultInfo, stats: () => stats, rayObject, turn, THREE, seen, objPx };
    await fontP;
  }
};
