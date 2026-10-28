// =====================================================================
// The view: scene, lights, atmosphere, camera, eyes, beams and picking.
// Reads the simulation; never changes it.
// =====================================================================

function createView(renderer, opts) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04;
  scene.add(hemi, key, key.target);
  const V = { scene, camera, renderer, hemi, key, world: null, eyes: {}, eyeList: [], player: null, beams: new Map(), beamPool: [], W: null,
    camPos: new THREE.Vector3(), camTarget: new THREE.Vector3(), camInit: false, look: LOOKS.act1, quality: opts.quality, shake: 0, focus: null, focusK: 0,
    width: 1, height: 1, dpr: 1, keyDir: new THREE.Vector3(), extraZoom: 0, still: 0 };

  // sky dome: a vertical gradient from ink above, haze at the horizon, void below
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uVoid: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHaze; uniform vec3 uVoid; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(uHaze, uTop, smoothstep(0.0, 0.55, y)) : mix(uHaze, uVoid, smoothstep(0.0, 0.25, -y));
        c += uHaze * 0.35 * smoothstep(0.55, 1.0, -y); // a faint glow far below
        gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    side: THREE.BackSide, depthWrite: false
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), domeMat); dome.renderOrder = -10; scene.add(dome);
  // high light shafts: a restrained volumetric suggestion
  const shafts = new THREE.Group(); scene.add(shafts);
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color('#e8dcb8') }, uA: { value: 0.05 }, uT: GU.uTime },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; uniform float uT; varying vec2 vU; void main(){ float e = sin(vU.x * 3.14159); float n = 0.75 + 0.25 * sin(vU.x * 40.0 + uT * 0.3) * sin(vU.y * 7.0 - uT * 0.2); float a = e * e * smoothstep(0.0, 0.45, vU.y) * (1.0 - smoothstep(0.75, 1.0, vU.y)) * uA * n; gl_FragColor = vec4(uC * a, a);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(3 + i * 1.5, 9 + i * 3, 120, 24, 1, true);
    const m = new THREE.Mesh(g, shaftMat); m.renderOrder = 4; shafts.add(m); m.userData.i = i;
  }
  // dust motes drifting through the air
  const NM = 260, mp = new Float32Array(NM * 3), mrng = makeRng(99);
  for (let i = 0; i < NM; i++) { mp[i * 3] = mrng.range(-30, 30); mp[i * 3 + 1] = mrng.range(-8, 26); mp[i * 3 + 2] = mrng.range(-40, 30); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: new THREE.Color('#e9dcb6'), size: 0.12, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  motes.frustumCulled = false; scene.add(motes);

  V.setLook = L => {
    V.look = L; applyLookUniforms(L);
    scene.background = new THREE.Color(L.bg);
    hemi.color.set(L.sky); hemi.groundColor.set(L.gnd); hemi.intensity = L.hemiI;
    key.color.set(L.key); key.intensity = L.keyI;
    V.keyDir.set(L.keyDir[0], L.keyDir[1], L.keyDir[2]).normalize();
    domeMat.uniforms.uTop.value.set(L.bg).multiplyScalar(0.55); domeMat.uniforms.uHaze.value.set(L.fog); domeMat.uniforms.uVoid.value.set(L.void);
    shaftMat.uniforms.uC.value.set(L.key);
    motes.material.color.set(L.rim);
  };

  V.setEncounter = W => {
    V.clear();
    V.W = W;
    const L = LOOKS[W.def.look] || LOOKS.act1;
    V.setLook(L);
    V.world = buildWorldView(W, L, V.quality);
    scene.add(V.world.root);
    V.eyes = {}; V.eyeList = [];
    for (const e of W.eyes) { const ev = buildEyeView(e, L); V.eyes[e.id] = ev; V.eyeList.push(ev); scene.add(ev.root); }
    if (!V.player) { V.player = buildPlayerView(); }
    scene.add(V.player.root);
    // shadow frustum covers the walkable bounds
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const r of W.regions) { const cx = r.wx === undefined ? r.cx : r.wx, cz = r.wz === undefined ? r.cz : r.wz, ext = r.kind === 'arc' ? r.r1 : Math.max(r.hl, r.hw) + 4; x0 = Math.min(x0, cx - ext); x1 = Math.max(x1, cx + ext); z0 = Math.min(z0, cz - ext); z1 = Math.max(z1, cz + ext); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, half = Math.max(x1 - x0, z1 - z0) / 2 + 14;
    V.bounds = { cx, cz, half };
    key.target.position.set(cx, 0, cz);
    key.position.set(cx + V.keyDir.x * 80, V.keyDir.y * 80, cz + V.keyDir.z * 80);
    const sc = key.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 220; sc.updateProjectionMatrix();
    key.castShadow = V.quality > 0;
    key.shadow.mapSize.set(V.quality > 1 ? 2048 : 1024, V.quality > 1 ? 2048 : 1024);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    // shafts fall into the chamber from the key light's side
    shafts.children.forEach((m, i) => {
      const r = makeRng(i * 7 + 3);
      m.position.set(cx + r.range(-14, 14), 30, cz + r.range(-18, 12));
      m.rotation.set(-V.keyDir.z * 0.4, 0, V.keyDir.x * 0.4);
    });
    V.camInit = false; V.still = 0;
    for (const b of V.beams.values()) { b.m.visible = false; V.beamPool.push(b); }
    V.beams.clear();
  };
  V.clear = () => {
    if (V.world) { scene.remove(V.world.root); V.world.dispose(); V.world = null; }
    for (const ev of V.eyeList) { scene.remove(ev.root); ev.irisMat.dispose(); ev.halo.geometry.dispose(); ev.halo.material.dispose(); }
    V.eyes = {}; V.eyeList = [];
    if (V.player) scene.remove(V.player.root);
  };

  V.resize = (w, h, dpr) => {
    V.width = w; V.height = h; V.dpr = dpr;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    GU.uOccR.value = 70 * dpr;
  };

  // ------------------------------------------------------------------
  function camConfig(W) {
    const c = W.def.cam || {};
    const fov = c.fov || 40, pitch = (V.pitchOverride || 50) * DEG;
    const wNeed = Math.min(c.w || 17, 18.5);
    const tanH = Math.tan(fov * DEG / 2);
    const distW = wNeed / (2 * tanH * Math.max(0.3, camera.aspect));
    const dist = Math.max(c.dist || 34, Math.min(distW, (c.dist || 34) * 1.45)) + V.extraZoom;
    return { fov, pitch, dist, c };
  }
  V.updateCamera = (W, dt, snap) => {
    if (V.debugCam) { camera.position.fromArray(V.debugCam.pos); camera.lookAt(new THREE.Vector3().fromArray(V.debugCam.target)); V.camPos.copy(camera.position); return; }
    const cc = camConfig(W), c = cc.c, P = W.player.pos;
    if (camera.fov !== cc.fov) { camera.fov = cc.fov; camera.updateProjectionMatrix(); }
    // look ahead along the route (up the screen) and a little along velocity
    let tx = P[0] + W.player.vel[0] * 0.35, tz = P[2] + W.player.vel[1] * 0.35 - (c.ahead === undefined ? 5 : c.ahead), ty = P[1];
    // when a focus point is set (a significant event), lean toward it
    if (V.focus) { tx = lerp(tx, V.focus[0], V.focusK * 0.45); tz = lerp(tz, V.focus[2], V.focusK * 0.45); }
    tx = clamp(tx, c.x0 === undefined ? -1e9 : c.x0, c.x1 === undefined ? 1e9 : c.x1);
    tz = clamp(tz, c.z1 === undefined ? -1e9 : c.z1, c.z0 === undefined ? 1e9 : c.z0);
    const tgt = new THREE.Vector3(tx, ty, tz);
    const yaw = c.yaw || 0;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(cc.pitch), Math.sin(cc.pitch), Math.cos(yaw) * Math.cos(cc.pitch)).multiplyScalar(cc.dist);
    const pos = tgt.clone().add(off);
    if (!V.camInit || snap) { V.camPos.copy(pos); V.camTarget.copy(tgt); V.camInit = true; }
    else {
      const k = 1 - Math.exp(-dt * 3.2);
      V.camPos.lerp(pos, k); V.camTarget.lerp(tgt, k);
    }
    camera.position.copy(V.camPos);
    if (V.shake > 0) { camera.position.x += Math.sin(W.t * 47) * V.shake * 0.3; camera.position.y += Math.sin(W.t * 39) * V.shake * 0.2; V.shake = Math.max(0, V.shake - dt * 2); }
    camera.lookAt(V.camTarget);
    dome.position.copy(camera.position);
    motes.position.set(Math.round(V.camTarget.x / 60) * 60, 0, Math.round(V.camTarget.z / 70) * 70);
  };

  const _v = new THREE.Vector3();
  V.toScreen = (p, out) => {
    _v.set(p[0], p[1], p[2]).project(camera);
    out = out || {};
    out.x = (_v.x * 0.5 + 0.5) * V.width; out.y = (-_v.y * 0.5 + 0.5) * V.height; out.z = _v.z; out.behind = _v.z > 1;
    return out;
  };
  // pick the eye nearest a tap, generous on small screens
  V.pickEye = (x, y, radius) => {
    let best = null, bd = 1e9;
    const W = V.W; if (!W) return null;
    for (const e of W.eyes) {
      if (e.hidden) continue;
      const s = V.toScreen(e.pos);
      if (s.behind) continue;
      const s2 = V.toScreen(vAdd(e.pos, [0, e.size, 0]));
      const pr = Math.abs(s2.y - s.y);
      const d = Math.hypot(s.x - x, s.y - y), lim = Math.max(radius || 46, pr * 1.6);
      if (d < lim && d - pr < bd) { bd = d - pr; best = e.id; }
    }
    return best;
  };

  // ------------------------------------------------------------------
  function beam(key, color, width) {
    let b = V.beams.get(key);
    if (!b) {
      b = V.beamPool.pop() || makeBeam(color, width);
      if (!b.m.parent) scene.add(b.m);
      b.U.uC.value.set(color); b.U.uW.value = width; b.U.uDash.value = 0; b.U.uSag.value = 0; b.U.uSpeed.value = 1;
      b.a = 0; b.grow = 0; b.key = key; b.dead = false; b.flash = 0;
      V.beams.set(key, b);
    }
    b.seen = true; b.dead = false;
    return b;
  }
  const eyeFrontP = (e, out) => { out = out || [0, 0, 0]; out[0] = e.pos[0] + e.look[0] * e.size * 0.95; out[1] = e.pos[1] + e.look[1] * e.size * 0.95; out[2] = e.pos[2] + e.look[2] * e.size * 0.95; return out; };
  V.snapBeam = (a, b) => { const bm = V.beams.get('L:' + a + '>' + b); if (bm) { bm.flash = 1; } };
  function updateBeams(W, dt) {
    for (const b of V.beams.values()) b.seen = false;
    const pc = playerChest(W), ph = playerHead(W);
    for (const l of W.links) {
      const a = W.eyeById[l.a], t = W.eyeById[l.b];
      const b = beam('L:' + l.a + '>' + l.b, '#efe3c2', 0.2 + a.size * 0.05);
      const pa = eyeFrontP(a), pb = eyeFrontP(t);
      b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pb[0], pb[1], pb[2]);
      b.U.uLen.value = vDist(pa, pb); b.target = 0.62;
    }
    for (const e of W.eyes) {
      if (e.seesPlayer && !e.isFalse) {
        const b = beam('A:' + e.id, '#efa848', 0.1);
        const pa = eyeFrontP(e); b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pc[0], pc[1], pc[2]);
        b.U.uW.value = 0.08 + 0.3 * e.acq; b.target = 0.25 + 0.95 * e.acq; b.U.uLen.value = vDist(pa, pc); b.U.uSpeed.value = 1 + e.acq * 3;
      }
      if (e.type === 'mimic' && e.echo && e.echo !== e.id && !e.linkTo) {
        const t = W.eyeById[e.echo]; if (t) {
          const b = beam('M:' + e.id, '#b9c39a', 0.08);
          const pa = eyeFrontP(e), pb = eyeFrontP(t); b.U.uA.value.set(pa[0], pa[1], pa[2]); b.U.uB.value.set(pb[0], pb[1], pb[2]); b.U.uDash.value = 1; b.target = 0.45; b.U.uLen.value = vDist(pa, pb);
        }
      }
    }
    const G = W.gaze;
    if (G.target && W.eyeById[G.target]) {
      const e = W.eyeById[G.target];
      const b = beam('G', '#fff6dc', 0.07);
      b.U.uA.value.set(ph[0], ph[1], ph[2]);
      const pb = vAddS(e.pos, vNorm(vSub(ph, e.pos)), e.size * 1.02);
      b.U.uB.value.set(pb[0], pb[1], pb[2]);
      b.U.uLen.value = vDist(ph, pb);
      b.U.uDash.value = G.refused || e.isFalse ? 1 : 0;
      b.U.uW.value = e.state === 'pinned' ? 0.11 : 0.06;
      b.target = G.lostT > 0 ? 0.25 : (e.state === 'pinned' ? 1.0 : 0.6);
      b.growTarget = Math.max(0.05, G.focus);
    }
    for (const [k, b] of V.beams) {
      if (b.seen) {
        b.a = damp(b.a, b.target, 10, dt);
        b.grow = k === 'G' ? damp(b.grow, b.growTarget, 20, dt) : Math.min(1, b.grow + dt * 3.5);
      } else {
        b.a = Math.max(0, b.a - dt * (b.flash > 0 ? 5 : 3));
        if (b.a <= 0.01) { b.m.visible = false; V.beams.delete(k); V.beamPool.push(b); continue; }
      }
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 3);
      b.U.uAlpha.value = b.a + b.flash * 1.4;
      b.U.uGrow.value = b.grow;
      b.m.visible = true;
    }
  }

  // ------------------------------------------------------------------
  V.update = (W, dt) => {
    GU.uTime.value = W.t;
    if (V.world) updateWorldView(V.world, W, dt);
    const gazeEye = W.gaze.target && W.gaze.focus > 0.2 ? W.eyeById[W.gaze.target] : null;
    updatePlayerView(V.player, W, dt, gazeEye);
    for (const ev of V.eyeList) updateEyeView(ev, W, dt, V);
    updateBeams(W, dt);
    V.updateCamera(W, dt);
    if (V.focus) { V.focusK = damp(V.focusK, V.focusHold > 0 ? 1 : 0, 3, dt); V.focusHold -= dt; if (V.focusHold < -2) V.focus = null; }
    // traveller's screen position for the occlusion fade
    const s = V.toScreen([W.player.pos[0], W.player.pos[1] + 0.8, W.player.pos[2]]);
    GU.uPlayerScr.value.set(s.x * V.dpr, (V.height - s.y) * V.dpr);
    GU.uPlayerDepth.value = camera.position.distanceTo(_v.set(W.player.pos[0], W.player.pos[1] + 0.8, W.player.pos[2]));
    for (const m of shafts.children) m.material.uniforms.uA.value = 0.045;
  };
  V.setFocus = (p, hold) => { V.focus = p; V.focusHold = hold || 1.5; };
  V.render = () => { renderer.render(scene, camera); };
  return V;
}
