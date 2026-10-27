// =====================================================================
// The view: everything on screen is derived from the simulation each
// frame. Nothing here changes the game; it only shows it.
// =====================================================================

function createView(THREE, renderer, opts) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.void);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -10, 10);
  camera.position.z = 5;
  const V = { scene, camera, zoom: 1, cx: 0, cy: 0, scale: 20, w: 1, h: 1, fade: 1, dread: 0, wobble: 1 };
  const canvasMaker = opts.canvas;
  const small = !!opts.small;
  const eyeMat = makeEyeMaterial(THREE);
  const figMat = makeFigureMaterial(THREE);
  const threadMat = makeThreadMaterial(THREE);
  const coneMat = makeConeMaterial(THREE);
  const MAX_EYES = 96;

  // ---------- eye instances ----------
  const quad = new THREE.PlaneGeometry(2, 2);
  const eyeGeo = new THREE.InstancedBufferGeometry();
  eyeGeo.index = quad.index; eyeGeo.setAttribute('position', quad.getAttribute('position'));
  const attr = {};
  for (const n of ['iA', 'iB', 'iC', 'iD', 'iE']) { attr[n] = new THREE.InstancedBufferAttribute(new Float32Array(MAX_EYES * 4), 4); attr[n].setUsage(THREE.DynamicDrawUsage); eyeGeo.setAttribute(n, attr[n]); }
  eyeGeo.instanceCount = 0;
  const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
  eyeMesh.frustumCulled = false; eyeMesh.renderOrder = 5;
  scene.add(eyeMesh);

  // ---------- the traveller ----------
  const figGeo = new THREE.PlaneGeometry(0.8, 1.2); figGeo.translate(0, 0.6, 0);
  const figure = new THREE.Mesh(figGeo, figMat);
  figure.renderOrder = 7; figure.frustumCulled = false;
  const FIG_SCALE = 1.25;
  figure.scale.setScalar(FIG_SCALE);
  scene.add(figure);

  // ---------- gaze thread ----------
  const TN = 24;
  const threadGeo = new THREE.BufferGeometry();
  const tPos = new Float32Array((TN + 1) * 2 * 3), tT = new Float32Array((TN + 1) * 2);
  const tIdx = [];
  for (let i = 0; i < TN; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  for (let i = 0; i <= TN; i++) { tT[i * 2] = tT[i * 2 + 1] = i / TN; }
  threadGeo.setIndex(tIdx); threadGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); threadGeo.setAttribute('t', new THREE.BufferAttribute(tT, 1));
  const thread = new THREE.Mesh(threadGeo, threadMat);
  thread.frustumCulled = false; thread.renderOrder = 6;
  scene.add(thread);

  // ---------- link threads and knot webs (fine ink lines) ----------
  const LMAX = 64;
  const linkGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(LMAX * 2 * 3), lCol = new Float32Array(LMAX * 2 * 4);
  linkGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3)); linkGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 4));
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  links.frustumCulled = false; links.renderOrder = 4;
  scene.add(links);

  // ---------- ripples (pin, chain, knot, absorb) ----------
  const rippleMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {},
    vertexShader: `attribute vec4 rA; attribute vec2 rB; varying vec2 vP; varying vec2 vB; void main(){ vP = position.xy; vB = rB; vec2 w = rA.xy + position.xy * rA.z; gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vP; varying vec2 vB; void main(){ float r = length(vP); float a = (1.0 - smoothstep(0.0, 0.06, abs(r - 0.9))) * vB.x; if (vB.y > 0.5) a = max(a, (1.0 - smoothstep(0.75, 0.9, r)) * vB.x * 0.85); if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.04), a); }`,
  });
  const RMAX = 24;
  const rGeo = new THREE.InstancedBufferGeometry();
  rGeo.index = quad.index; rGeo.setAttribute('position', quad.getAttribute('position'));
  const rA = new THREE.InstancedBufferAttribute(new Float32Array(RMAX * 4), 4), rB = new THREE.InstancedBufferAttribute(new Float32Array(RMAX * 2), 2);
  rA.setUsage(THREE.DynamicDrawUsage); rB.setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('rA', rA); rGeo.setAttribute('rB', rB);
  const ripples = new THREE.Mesh(rGeo, rippleMat);
  ripples.frustumCulled = false; ripples.renderOrder = 8;
  scene.add(ripples);
  const fx = [];
  V.ripple = (x, y, size, dur, fill) => { if (fx.length >= RMAX) fx.shift(); fx.push({ x, y, size, dur, t: 0, fill: !!fill }); };

  // ---------- ink overlay (capture, descent) ----------
  const overlayMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { amount: { value: 0 }, center: { value: new THREE.Vector2() }, time: { value: 0 }, mode: { value: 0 }, aspect: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float amount, time, mode, aspect; uniform vec2 center; varying vec2 vUv;
      void main(){
        vec2 p = vUv - center; p.x *= aspect;
        float n = vnoise(p * 7.0 + time * 0.2) * 0.12 + vnoise(p * 23.0) * 0.05 + vnoise(p * 61.0) * 0.02;
        float r = length(p) + n;
        float a = smoothstep(amount * 1.6 - 0.05, amount * 1.6, r);
        a = mode < 0.5 ? 1.0 - a : 1.0 - a;
        a = clamp(a * min(1.0, amount * 4.0), 0.0, 1.0);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.035, 0.03, 0.026), a);
      }`,
  });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMat);
  overlay.frustumCulled = false; overlay.renderOrder = 20;
  scene.add(overlay);
  V.ink = (amount, sx, sy) => { overlayMat.uniforms.amount.value = amount; if (sx !== undefined) overlayMat.uniforms.center.value.set(sx / V.w, 1 - sy / V.h); };

  // ---------- per spiral ----------
  let built = null;
  function disposeBuilt() {
    if (!built) return;
    for (const m of built.meshes) { scene.remove(m); m.geometry.dispose(); if (m.material.uniforms && m.material.uniforms.map) m.material.uniforms.map.value.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
    for (const c of built.cones) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    built = null;
  }
  V.dispose = disposeBuilt;

  V.build = function (S, def) {
    disposeBuilt();
    const G = S.G;
    const meshes = [], rings = [];
    // the dark field outside, with the closed rings of every spiral before this one
    const voidTex = new THREE.CanvasTexture(makeVoidCanvas(G, def, canvasMaker, small ? 1024 : 1536));
    voidTex.colorSpace = THREE.SRGBColorSpace;
    const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(27, 27), new THREE.MeshBasicMaterial({ map: voidTex, depthWrite: false }));
    voidMesh.renderOrder = 0; scene.add(voidMesh); meshes.push(voidMesh);
    for (let k = 0; k <= G.n; k++) {
      const { rIn, rOut } = bandRadii(G, k);
      const cnv = makeRingStrip(G, k, def, { canvas: canvasMaker, ppu: small ? 52 : 64, maxW: small ? 3072 : 4096 });
      const tex = new THREE.CanvasTexture(cnv);
      tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const mat = makeRingMaterial(THREE, tex, rIn, rOut, k === G.n);
      const geo = new THREE.RingGeometry(Math.max(0.001, rIn), rOut, 192, 1);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1;
      scene.add(m); meshes.push(m); rings.push(m);
    }
    // sentinel sight fans
    const cones = [];
    for (const e of S.eyes) if (e.type === 'sentinel') {
      const n = 28, geo = new THREE.BufferGeometry();
      const pos = new Float32Array((n + 2) * 3), at = new Float32Array(n + 2), as = new Float32Array(n + 2), idx = [];
      for (let i = 0; i < n; i++) idx.push(0, i + 1, i + 2);
      geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aT', new THREE.BufferAttribute(at, 1)); geo.setAttribute('aSeen', new THREE.BufferAttribute(as, 1));
      const mesh = new THREE.Mesh(geo, coneMat); mesh.frustumCulled = false; mesh.renderOrder = 3;
      scene.add(mesh);
      cones.push({ e, mesh, n, pos, at, as, seen: 0, open: 0 });
    }
    // decorative eyes in the dark field (never in the spiral, never on a groove)
    const decor = [];
    const rng = makeRng((def.seed || 1) * 7 + 99);
    const nDecor = Math.round(4 + 10 * (def.dread || (def.act || 1) * 0.15));
    for (let i = 0; i < nDecor; i++) decor.push({ r: G.Ro + 1.1 + rng() * 2.8, a: rng() * TAU, rad: 0.3 + rng() * 0.35, seed: rng() * 10, blink: rng() * 6, wake: rng() });
    // per-eye animation state
    const anim = S.eyes.map(e => ({ px: 0, py: 0, open: e.state === ST.DORMANT ? 0 : 1, pin: 0, stun: 0, smear: 0, tgt: 0, sway: 0, gone: 0 }));
    built = { S, def, meshes, rings, cones, decor, anim, links: [], G };
    V.dread = def.dread || 0;
    for (const m of rings) m.material.uniforms.dread.value = V.dread;
    return built;
  };

  // ---------- framing ----------
  // The spiral is centred in the portrait frame above the control band.
  V.layout = function (w, h, safe, bandFrac, R) {
    V.w = w; V.h = h;
    const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
    const avH = h * (1 - bandFrac) - top - 8;
    const fit = Math.min(w - 16, avH);
    V.scale = fit / (2 * R);
    V.cx = w / 2; V.cy = top + 8 + avH / 2;
    V.applyCamera();
    overlayMat.uniforms.aspect.value = w / h;
  };
  V.applyCamera = function () {
    const s = V.scale * V.zoom;
    camera.left = -V.cx / s; camera.right = (V.w - V.cx) / s;
    camera.top = V.cy / s; camera.bottom = -(V.h - V.cy) / s;
    camera.updateProjectionMatrix();
  };
  V.toWorld = (sx, sy) => { const s = V.scale * V.zoom; return [(sx - V.cx) / s, -(sy - V.cy) / s]; };
  V.toScreen = (x, y) => { const s = V.scale * V.zoom; return [V.cx + x * s, V.cy - y * s]; };

  // ---------- per frame ----------
  const _p = [0, 0], _q = [0, 0];
  let tmr = 0;
  function eyeOpenBase(e) { return e.type === 'drifter' ? 0.72 : e.type === 'liar' ? 0.9 : 1; }
  V.update = function (S, dt, o) {
    o = o || {};
    tmr += dt;
    const B = built; if (!B || B.S !== S) return;
    const T = S.t;
    for (const m of B.rings) { m.material.uniforms.time.value = tmr; m.material.uniforms.fade.value = V.fade; m.material.uniforms.wobble.value = o.calm ? 0.25 : 1; }
    for (let k = 0; k < B.rings.length; k++) B.rings[k].rotation.z = S.phi[k];
    eyeMat.uniforms.time.value = tmr; eyeMat.uniforms.fade.value = V.fade;
    figMat.uniforms.time.value = tmr; threadMat.uniforms.time.value = tmr; coneMat.uniforms.time.value = tmr;
    overlayMat.uniforms.time.value = tmr;

    // --- eyes ---
    const P = S.playerPos(_q);
    let n = 0;
    const A = attr.iA.array, Bv = attr.iB.array, C = attr.iC.array, D = attr.iD.array, E = attr.iE.array;
    const put = (x, y, rad, rot, type, open, px, py, psz, pin, stun, smear, tgt, feign, dead, dim, seed, wall, stare, knot) => {
      if (n >= MAX_EYES) return;
      const i = n * 4;
      A[i] = x; A[i + 1] = y; A[i + 2] = rad; A[i + 3] = rot;
      Bv[i] = type; Bv[i + 1] = open; Bv[i + 2] = px; Bv[i + 3] = py;
      C[i] = psz; C[i + 1] = pin; C[i + 2] = stun; C[i + 3] = smear;
      D[i] = tgt; D[i + 1] = feign; D[i + 2] = dead; D[i + 3] = dim;
      E[i] = seed; E[i + 1] = wall; E[i + 2] = stare; E[i + 3] = knot;
      n++;
    };
    for (let i = 0; i < S.eyes.length; i++) {
      const e = S.eyes[i];
      const an = B.anim[i] || (B.anim[i] = { px: 0, py: 0, open: 0, pin: 0, stun: 0, smear: 0, tgt: 0, sway: 0, gone: 0 });
      if (e.state === ST.DEAD && e.type !== 'crown') { an.gone = Math.min(1, an.gone + dt * 3); if (an.gone >= 1) continue; }
      S.eyePos(e, _p);
      const th = S.eyeTheta(e);
      const rot = th - Math.PI / 2 + (e.inWall ? 0 : Math.sin(tmr * (e.type === 'drifter' ? 0.9 : 1.7) + i) * 0.04 * (e.moved > 0 ? 3 : 1));
      // pupil toward what it attends to, in eye space
      const lx = e.look[0] - _p[0], ly = e.look[1] - _p[1];
      const c = Math.cos(-rot), s = Math.sin(-rot);
      let ex = lx * c - ly * s, ey = lx * s + ly * c;
      const ll = Math.hypot(ex, ey) || 1, mag = Math.min(1, ll / 3) * (e.type === 'unblinking' ? 0.2 : 0.34);
      ex = ex / ll * mag; ey = ey / ll * mag * 0.75;
      const held = HELD(e.state);
      const k = held ? 0 : e.type === 'drifter' ? 3 : e.type === 'liar' || e.type === 'mimic' ? 14 : 8;
      if (k) { an.px = damp(an.px, ex, k, dt); an.py = damp(an.py, ey, k, dt); }
      // lids
      let open = eyeOpenBase(e);
      if (e.state === ST.DORMANT) open = 0;
      else if (held) open = 0.8;
      else if (e.state === ST.FEIGN) open = 0.62;
      else if (e.state === ST.KNOT) open = 0.55;
      if (e.acquiring) open = Math.min(1.1, open * 1.08);
      if (T >= e.blinkAt && T < e.blinkAt + 0.16 && !held) open *= Math.abs((T - e.blinkAt) / 0.08 - 1);
      an.open = damp(an.open, open, held ? 22 : 14, dt);
      const pinT = held ? (e.state === ST.RELEASING ? e.rel / RULES.release : 1) : e.acquiring ? e.acq / RULES.acquire * 0.55 : 0;
      an.pin = damp(an.pin, pinT, 25, dt);
      an.stun = damp(an.stun, e.state === ST.STUNNED ? 1 : 0, 6, dt);
      an.smear = damp(an.smear, e.state === ST.REVEALED ? 1 : 0, 2.5, dt);
      an.tgt = damp(an.tgt, S.gaze.target === e.id ? 1 : 0, 12, dt);
      const dead = e.state === ST.DEAD ? 1 : 0;
      put(_p[0], _p[1], e.rad * (dead ? 1 : 1 - an.gone), rot, EYE_ID[e.type], an.open, an.px, an.py, e.type === 'unblinking' ? 0.2 : 1, an.pin, an.stun, an.smear, an.tgt, e.state === ST.FEIGN ? 1 : 0, dead, e.type === 'echo' ? 0.3 : 0, (i * 0.618) % 1 * 10, e.inWall ? 1 : 0, e.stare ? 1 : 0, e.state === ST.KNOT ? 1 : 0);
    }
    // closed lids over held-shut openings, stitched seals over sealed ones
    for (const w of S.walls) for (const d of w.doors) {
      if (d.lidId === undefined && !d.sealed) continue;
      const open = S.doorOpen(d);
      d._lid = damp(d._lid === undefined ? 0 : d._lid, open ? 1 : 0, 10, dt);
      if (d._lid > 0.97) continue;
      const th = S.doorTheta(w, d);
      put(w.r * Math.cos(th), w.r * Math.sin(th), RULES.doorHalf * d.wscale * 1.05 * (1 - d._lid), th - Math.PI / 2, 12, 0, 0, 0, 1, 0, 0, 0, 0, 0, d.sealed ? 1 : 0, 0, d.i * 3.1, 1, 0, 0);
    }
    // the dark field's eyes: dim, they follow the traveller and close when looked at
    const gz = S.gaze.point;
    for (const de of B.decor) {
      const x = de.r * Math.cos(de.a + tmr * 0.004), y = de.r * Math.sin(de.a + tmr * 0.004);
      const lx = P[0] - x, ly = P[1] - y, l = Math.hypot(lx, ly) || 1;
      const rot = Math.atan2(y, x) - Math.PI / 2;
      const c = Math.cos(-rot), s = Math.sin(-rot);
      const px = (lx * c - ly * s) / l * 0.3, py = (lx * s + ly * c) / l * 0.22;
      const looked = gz && Math.hypot(gz[0] - x, gz[1] - y) < 1.2;
      de.o = damp(de.o === undefined ? 0 : de.o, looked ? 0 : (V.dread + 0.25 > de.wake ? 1 : 0), 4, dt);
      const bl = (tmr + de.blink) % 5.5 < 0.15 ? 0.2 : 1;
      put(x, y, de.rad, rot, 12, de.o * bl, px, py, 1, 0, 0, 0, 0, 0, 0, 0.82, de.seed, 0, 0, 0);
    }
    for (const a of Object.values(attr)) a.needsUpdate = true;
    eyeGeo.instanceCount = n;

    // --- the traveller ---
    const Pl = S.P;
    let pr = S.playerR();
    if (Pl.crossT > 0) pr = lerp(Pl.crossFrom, pr, smooth(1 - Pl.crossT / RULES.crossTime));
    const pth = S.playerTheta();
    const fx0 = pr * Math.cos(pth), fy0 = pr * Math.sin(pth);
    figure.position.set(fx0, fy0 - 0.08, 0);
    figure.visible = !o.hidePlayer;
    const g = S.gaze.dir;
    const hasGaze = !!S.gaze.point;
    const lookX = hasGaze ? g[0] : (Pl.w ? sign(-Math.sin(pth) * Pl.w) : figMat.uniforms.face.value);
    figMat.uniforms.face.value = damp(figMat.uniforms.face.value, lookX >= 0 ? 1 : -1, 10, dt) >= 0 ? 1 : -1;
    figMat.uniforms.look.value.set(hasGaze ? g[0] : lookX, hasGaze ? g[1] : 0);
    figMat.uniforms.walk.value += Pl.moved * 7.5;
    figMat.uniforms.speed.value = damp(figMat.uniforms.speed.value, Math.min(1, Math.abs(Pl.v) / RULES.walk), 10, dt);
    figMat.uniforms.lean.value = damp(figMat.uniforms.lean.value, clamp(Pl.v / RULES.walk, -1, 1) * (-Math.sin(pth)) , 8, dt);
    figMat.uniforms.fear.value = damp(figMat.uniforms.fear.value, clamp((o.threat || 0), 0, 1), 4, dt);
    figMat.uniforms.exposure.value = Pl.exposure;
    figMat.uniforms.ink.value = o.capture || 0;

    // --- gaze thread from the traveller's eye ---
    const hx = fx0 + 0.05 * FIG_SCALE * (figMat.uniforms.face.value), hy = fy0 + 0.98 * FIG_SCALE - 0.08;
    let tx, ty, held = 0, show = 0;
    if (S.gaze.target !== null) {
      const te = S.eyes[S.gaze.target]; S.eyePos(te, _p); tx = _p[0]; ty = _p[1];
      held = HELD(te.state) || te.state === ST.FEIGN ? 1 : 0;   // a feigning liar looks held; that is the lie
      show = 1;
    } else if (hasGaze) {
      const dx = S.gaze.point[0] - hx, dy = S.gaze.point[1] - hy, l = Math.hypot(dx, dy) || 1, L = Math.min(l, 2.2);
      tx = hx + dx / l * L; ty = hy + dy / l * L; show = 0.6;
    }
    V.threadA = damp(V.threadA || 0, o.hideThread ? 0 : show, 10, dt);
    threadMat.uniforms.held.value = damp(threadMat.uniforms.held.value, held, 14, dt);
    threadMat.uniforms.alpha.value = V.threadA;
    thread.visible = V.threadA > 0.02 && tx !== undefined;
    if (thread.visible) {
      const dx = tx - hx, dy = ty - hy, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      threadMat.uniforms.len.value = l;
      const wdt = 0.035 + 0.02 * threadMat.uniforms.held.value;
      for (let i = 0; i <= TN; i++) {
        const t = i / TN;
        // a held thread is taut and trembles; a looking line sags slightly
        const sag = (1 - threadMat.uniforms.held.value) * Math.sin(t * Math.PI) * 0.15 + threadMat.uniforms.held.value * Math.sin(t * 40 + tmr * 30) * 0.008;
        const x = hx + dx * t + nx * sag, y = hy + dy * t + ny * sag, ww = wdt * (1 - t * 0.5);
        tPos[i * 6] = x + nx * ww; tPos[i * 6 + 1] = y + ny * ww; tPos[i * 6 + 2] = 1;
        tPos[i * 6 + 3] = x - nx * ww; tPos[i * 6 + 4] = y - ny * ww; tPos[i * 6 + 5] = -1;
      }
      threadGeo.attributes.position.needsUpdate = true;
    }

    // --- sentinel sight, cut short by whatever blocks it ---
    for (const c of B.cones) {
      const e = c.e;
      const want = e.state === ST.ACTIVE && !e.acquiring ? 1 : 0;
      c.open = damp(c.open, want, 6, dt);
      c.seen = damp(c.seen, e.seeing ? 1 : 0, 8, dt);
      c.mesh.visible = c.open > 0.02;
      if (!c.mesh.visible) continue;
      S.eyePos(e, _p);
      const half = e.half * c.open;
      c.pos[0] = _p[0]; c.pos[1] = _p[1]; c.at[0] = 0; c.as[0] = c.seen;
      for (let i = 0; i <= c.n; i++) {
        const a = e.aim - half + 2 * half * i / c.n;
        const dist = sightLength(S, e, _p[0], _p[1], a, e.range);
        c.pos[(i + 1) * 3] = _p[0] + Math.cos(a) * dist; c.pos[(i + 1) * 3 + 1] = _p[1] + Math.sin(a) * dist; c.pos[(i + 1) * 3 + 2] = 0;
        c.at[i + 1] = dist / e.range; c.as[i + 1] = c.seen;
      }
      c.mesh.geometry.attributes.position.needsUpdate = true; c.mesh.geometry.attributes.aT.needsUpdate = true; c.mesh.geometry.attributes.aSeen.needsUpdate = true;
    }

    // --- causal links and knot webs ---
    let ln = 0;
    const line = (x0, y0, x1, y1, a) => {
      if (ln >= LMAX) return;
      const i = ln * 6, j = ln * 8;
      lPos[i] = x0; lPos[i + 1] = y0; lPos[i + 2] = 0; lPos[i + 3] = x1; lPos[i + 4] = y1; lPos[i + 5] = 0;
      for (const q of [0, 4]) { lCol[j + q] = 0.03; lCol[j + q + 1] = 0.03; lCol[j + q + 2] = 0.025; lCol[j + q + 3] = a; }
      ln++;
    };
    for (const L of B.links) {
      L.t += dt;
      if (L.t > 1.6) continue;
      const a = S.eyes[L.a], b = S.eyes[L.b];
      if (!a || !b) continue;
      S.eyePos(a, _p); const x0 = _p[0], y0 = _p[1]; S.eyePos(b, _p);
      const grow = Math.min(1, L.t / 0.25);
      line(x0, y0, x0 + (_p[0] - x0) * grow, y0 + (_p[1] - y0) * grow, 0.75 * (1 - Math.max(0, L.t - 0.9) / 0.7));
    }
    B.links = B.links.filter(L => L.t <= 1.6);
    for (const kn of S.knots) {
      const m = kn.members.map(id => S.eyePos(S.eyes[id], [0, 0]));
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
        for (let q = 0; q < 3; q++) line(m[i][0], m[i][1] + (q - 1) * 0.12, m[j][0], m[j][1] - (q - 1) * 0.12, 0.6 + 0.3 * kn.unravel / 1.2 * Math.sin(tmr * 20 + q));
      }
    }
    linkGeo.setDrawRange(0, ln * 2);
    linkGeo.attributes.position.needsUpdate = true; linkGeo.attributes.color.needsUpdate = true;

    // --- ripples ---
    let rn = 0;
    for (const f of fx) {
      f.t += dt;
      if (f.t > f.dur) continue;
      const k = f.t / f.dur;
      rA.array[rn * 4] = f.x; rA.array[rn * 4 + 1] = f.y; rA.array[rn * 4 + 2] = f.size * (f.fill ? (0.4 + 0.6 * smooth(Math.min(1, k * 3))) : (0.4 + k)); rA.array[rn * 4 + 3] = 0;
      rB.array[rn * 2] = 1 - k; rB.array[rn * 2 + 1] = f.fill ? 1 : 0;
      rn++;
    }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].t > fx[i].dur) fx.splice(i, 1);
    rGeo.instanceCount = rn; rA.needsUpdate = true; rB.needsUpdate = true;
  };

  // react to simulation events with marks on the drawing
  V.onEvents = function (S, events) {
    const B = built; if (!B) return;
    for (const ev of events) {
      if (ev.type === 'link' && ev.from >= 0) B.links.push({ a: ev.from, b: ev.to, t: 0 });
      else if (ev.type === 'pin') { S.eyePos(S.eyes[ev.eye], _p); V.ripple(_p[0], _p[1], S.eyes[ev.eye].rad * 1.9, 0.45); }
      else if (ev.type === 'chain') { const e = S.eyes[ev.eye]; if (e) { S.eyePos(e, _p); V.ripple(_p[0], _p[1], 1.2 + ev.n * 0.35, 0.9); } }
      else if (ev.type === 'knot' || ev.type === 'absorb') { const e = S.eyes[ev.type === 'knot' ? ev.members[0] : ev.eye]; S.eyePos(e, _p); V.ripple(_p[0], _p[1], 0.9, 0.7, true); }
      else if (ev.type === 'crownBreak') { S.eyePos(S.eyes[ev.eye], _p); V.ripple(_p[0], _p[1], 2.4, 1.1); }
      else if (ev.type === 'unravel') for (const id of ev.members) { S.eyePos(S.eyes[id], _p); V.ripple(_p[0], _p[1], 1.1, 0.6); }
    }
  };

  V.render = () => renderer.render(scene, camera);
  return V;
}

// How far a sentinel sees along angle a before something stops it (an eye, a veil, the pupil).
function sightLength(S, self, x, y, a, range) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = range;
  // pupil
  const rp = S.G.Ri * RULES.pupilFrac;
  { const b = x * dx + y * dy, c = x * x + y * y - rp * rp, disc = b * b - c; if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0.02 && t < best) best = t; } }
  // eyes
  const p = [0, 0];
  for (const e of S.eyes) {
    if (e === self || e.state === ST.DEAD || e.decoy || e.state === ST.REVEALED) continue;
    S.eyePos(e, p);
    const ox = p[0] - x, oy = p[1] - y, t = ox * dx + oy * dy;
    if (t <= 0.05 || t > best) continue;
    const d2 = ox * ox + oy * oy - t * t, r = e.rad * 0.72;
    if (d2 < r * r) best = Math.min(best, t - Math.sqrt(r * r - d2) + 0.15);
  }
  // veils
  for (const w of S.walls) {
    if (!w.veils.length) continue;
    const b = x * dx + y * dy, c = x * x + y * y - w.r * w.r, disc = b * b - c;
    if (disc <= 0) continue;
    for (const t of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
      if (t <= 0.02 || t >= best) continue;
      const th = wrap0(Math.atan2(y + dy * t, x + dx * t) - S.phi[w.owner]);
      for (const v of w.veils) if (inArc(th, wrap0(v[0]), wrap0(v[1]))) { best = t; break; }
    }
  }
  return best;
}
