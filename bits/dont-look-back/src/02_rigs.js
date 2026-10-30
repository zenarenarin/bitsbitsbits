// The hooded wanderer and the thing that follows it. Both face -z.
function createRigs(THREE, A) {
  const V3 = A.V3;
  const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const mesh = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; parent.add(m); return m; };

  // ---------- the wanderer ----------
  function makeWanderer() {
    const rr = makeRng(4);
    const cloth = new THREE.MeshStandardMaterial({ color: '#5f6c82', roughness: 0.95, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#465066', roughness: 0.95, flatShading: true });
    const leg = new THREE.MeshStandardMaterial({ color: '#2c2f3c', roughness: 0.9, flatShading: true });
    const voidM = new THREE.MeshBasicMaterial({ color: '#020205' });
    const root = new THREE.Group();
    const body = pivot(root, 0, 0.36, 0); // hips
    // legs below the hem
    const legs = [-1, 1].map(s => { const p = pivot(body, s * 0.09, 0, 0); const g = new THREE.CapsuleGeometry(0.055, 0.22, 3, 6); g.translate(0, -0.17, 0); mesh(g, leg, p); const foot = new THREE.BoxGeometry(0.09, 0.06, 0.16); foot.translate(0, -0.33, -0.03); mesh(foot, leg, p); return p; });
    const torso = pivot(body, 0, 0, 0);
    // cloak: jagged cone
    const cg = new THREE.ConeGeometry(0.36, 0.78, 9, 3, true); cg.translate(0, 0.27, 0);
    const P = cg.attributes.position;
    for (let i = 0; i < P.count; i++) if (P.getY(i) < -0.05) P.setY(i, P.getY(i) + (rr() - 0.5) * 0.09);
    const cloak = mesh(cg, cloth, torso); cloak.material.side = THREE.DoubleSide;
    // trailing cape panel that flutters
    const capeP = pivot(torso, 0, 0.58, 0.12);
    const capeG = new THREE.ConeGeometry(0.26, 0.62, 5, 2, true, Math.PI * 0.15, Math.PI * 0.7); capeG.rotateY(Math.PI); capeG.translate(0, -0.3, 0.06);
    const cape = mesh(capeG, dark, capeP); cape.material.side = THREE.DoubleSide;
    // arms
    const arms = [-1, 1].map(s => { const p = pivot(torso, s * 0.22, 0.52, 0); p.rotation.z = s * 0.18; const g = new THREE.CapsuleGeometry(0.06, 0.26, 3, 6); g.translate(0, -0.18, 0); mesh(g, dark, p); return p; });
    // oversized hood with a face lost in darkness
    const head = pivot(torso, 0, 0.66, 0);
    const hood = new THREE.SphereGeometry(0.3, 10, 8); hood.scale(1, 1.06, 1.12); hood.translate(0, 0.22, 0.02);
    mesh(hood, cloth, head);
    const tip = new THREE.ConeGeometry(0.17, 0.42, 6); tip.rotateX(Math.PI * 0.62); tip.translate(0, 0.32, 0.3);
    mesh(tip, cloth, head);
    const rim = new THREE.TorusGeometry(0.19, 0.045, 5, 12); rim.scale(1, 1.18, 1); rim.translate(0, 0.19, -0.27);
    mesh(rim, dark, head);
    const face = new THREE.SphereGeometry(0.2, 10, 8); face.scale(1, 1.15, 0.55); face.translate(0, 0.19, -0.24);
    head.add(new THREE.Mesh(face, voidM));
    const pose = { lean: 0, crouch: 0, legA: 0, legB: 0, arm: 0, armIn: 0, headP: 0, headY: 0, cape: 0, bob: 0, tuck: 0 };
    return { root, body, torso, legs, arms, head, capeP, pose, phase: 0, breath: 0 };
  }

  // state: 'idle' | 'run' | 'hide' | 'recover' | 'caught' | 'trip' | 'vault'
  function animateWanderer(w, state, speed, dt, k) {
    const p = w.pose, t = (w.breath += dt);
    let lean = 0.04, crouch = 0, legA = 0, arm = 0, armIn = 0, headP = 0, headY = Math.sin(t * 0.7) * 0.12, cape = 0.1 + Math.sin(t * 2) * 0.05, bob = Math.sin(t * 2.2) * 0.008, tuck = 0;
    if (state === 'run' || state === 'vault') {
      w.phase += dt * (4 + speed * 0.95);
      const s = Math.sin(w.phase);
      lean = 0.32 + speed * 0.012; legA = s * 0.95; arm = -s * 0.85; armIn = 0.1;
      bob = Math.abs(Math.cos(w.phase)) * 0.07; headP = -0.12 + (k.exhausted ? 0.25 : 0); headY = Math.sin(w.phase * 0.5) * 0.05;
      cape = 0.55 + speed * 0.05 + Math.sin(w.phase * 2.1) * 0.18;
      if (k.exhausted) { lean += 0.12; bob *= 0.6; headY += Math.sin(t * 9) * 0.06; }
      if (state === 'vault') { tuck = 1; legA = 0.9; arm = -1.2; }
    } else if (state === 'hide') {
      lean = 0.78; crouch = 0.24; tuck = 1.2; arm = -1.15; armIn = 0.75; headP = 0.5 + Math.sin(t * 2.4) * 0.03; headY = Math.sin(t * 0.4) * 0.05 + (k.peek || 0); cape = 0.05; bob = Math.sin(t * 3.2) * 0.012;
    } else if (state === 'recover') {
      lean = 0.62; crouch = 0.08; tuck = 0.45; arm = -0.7; armIn = 0.3; headP = 0.25 + Math.sin(t * 5) * 0.07; bob = Math.sin(t * 5) * 0.02; cape = 0.15;
    } else if (state === 'trip') {
      lean = 1.05; crouch = 0.12; legA = -0.6; arm = -1.4; armIn = -0.2; headP = 0.4; cape = 0.9;
    } else if (state === 'caught') {
      lean = -0.08; crouch = 0.03; arm = 0.25; armIn = -0.25; headP = -0.25; headY = k.look || 0; cape = 0.05; bob = 0;
    }
    const kk = state === 'caught' ? 6 : 12;
    p.lean = damp(p.lean, lean, kk, dt); p.crouch = damp(p.crouch, crouch, kk, dt); p.legA = damp(p.legA, legA, 18, dt); p.arm = damp(p.arm, arm, 16, dt);
    p.armIn = damp(p.armIn, armIn, 10, dt); p.headP = damp(p.headP, headP, 8, dt); p.headY = damp(p.headY, headY, state === 'caught' ? 3 : 8, dt); p.cape = damp(p.cape, cape, 10, dt); p.bob = damp(p.bob, bob, 20, dt); p.tuck = damp(p.tuck, tuck, 12, dt);
    w.body.position.y = 0.36 - p.crouch + p.bob;
    w.torso.rotation.x = -p.lean;
    w.legs[0].rotation.x = p.legA - p.tuck * 0.9; w.legs[1].rotation.x = -p.legA - p.tuck * 0.9;
    w.arms[0].rotation.x = p.arm; w.arms[1].rotation.x = -p.arm * (state === 'run' ? 1 : -1);
    w.arms[0].rotation.z = -0.18 + p.armIn * 0.5; w.arms[1].rotation.z = 0.18 - p.armIn * 0.5;
    w.head.rotation.x = p.headP + p.lean * -0.4; w.head.rotation.y = p.headY;
    w.capeP.rotation.x = p.cape;
  }

  // ---------- the follower ----------
  function makeFollower(opts) {
    const rr = makeRng(opts && opts.seed || 9);
    const skin = new THREE.MeshStandardMaterial({ color: '#09080d', roughness: 0.82, metalness: 0.05, flatShading: true });
    const root = new THREE.Group();
    const hips = pivot(root, 0, 2.35, 0);
    const legs = [-1, 1].map(s => {
      const thigh = pivot(hips, s * 0.16, 0, 0);
      const tg = new THREE.CylinderGeometry(0.07, 0.11, 1.2, 5); tg.translate(0, -0.6, 0); A.jitter(tg, 0.03, rr); mesh(tg, skin, thigh);
      const knee = pivot(thigh, 0, -1.2, 0);
      const sg = new THREE.CylinderGeometry(0.035, 0.07, 1.22, 5); sg.translate(0, -0.61, 0); A.jitter(sg, 0.02, rr); mesh(sg, skin, knee);
      const fg = new THREE.ConeGeometry(0.06, 0.4, 4); fg.rotateX(-Math.PI / 2); fg.translate(0, -1.2, -0.15); mesh(fg, skin, knee);
      return { thigh, knee };
    });
    const spine = pivot(hips, 0, 0, 0);
    const tg = new THREE.CylinderGeometry(0.2, 0.11, 1.55, 6, 4); tg.translate(0, 0.78, 0);
    const TP = tg.attributes.position; for (let i = 0; i < TP.count; i++) { const y = TP.getY(i); TP.setZ(i, TP.getZ(i) + Math.sin(y * 1.8) * 0.12); TP.setX(i, TP.getX(i) * (1 + Math.sin(y * 7) * 0.12)); }
    A.jitter(tg, 0.05, rr); mesh(tg, skin, spine);
    // vertebrae ridge
    for (let i = 0; i < 6; i++) { const k = new THREE.ConeGeometry(0.04, 0.12, 4); k.rotateX(Math.PI * 0.6); mesh(k, skin, spine, 0, 0.3 + i * 0.22, 0.18 + Math.sin((0.3 + i * 0.22) * 1.8) * 0.12); }
    const arms = [-1, 1].map(s => {
      const sh = pivot(spine, s * 0.27, 1.5 + (s > 0 ? 0.07 : -0.04), 0);
      const ug = new THREE.CylinderGeometry(0.045, 0.075, 1.25, 5); ug.translate(0, -0.62, 0); A.jitter(ug, 0.02, rr); mesh(ug, skin, sh);
      const el = pivot(sh, 0, -1.25, 0);
      const fg = new THREE.CylinderGeometry(0.03, 0.05, 1.35, 5); fg.translate(0, -0.67, 0); A.jitter(fg, 0.02, rr); mesh(fg, skin, el);
      const hand = pivot(el, 0, -1.35, 0);
      for (let f = 0; f < 4; f++) { const fgeo = new THREE.CylinderGeometry(0.008, 0.02, 0.5, 3); fgeo.translate(0, -0.25, 0); const fm = mesh(fgeo, skin, hand); fm.rotation.z = (f - 1.5) * 0.18; fm.rotation.x = -0.15 - (f % 2) * 0.12; }
      return { sh, el, hand, s };
    });
    const neck = pivot(spine, 0, 1.55, 0.05);
    const ng = new THREE.CylinderGeometry(0.04, 0.06, 0.5, 5); ng.translate(0, 0.25, 0); mesh(ng, skin, neck);
    const head = pivot(neck, 0, 0.48, 0);
    const hg = new THREE.SphereGeometry(0.2, 8, 7); hg.scale(0.85, 1.6, 1); hg.translate(0, 0.2, -0.04); A.jitter(hg, 0.03, rr); mesh(hg, skin, head);
    const eyes = [];
    const eyeMat = new THREE.MeshBasicMaterial({ color: opts && opts.eye || '#ffcf8a', fog: false, transparent: true });
    const glowMat = new THREE.SpriteMaterial({ map: A.T.glow, color: opts && opts.eye || '#ffb860', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), eyeMat); e.position.set(s * 0.075, 0.27 + (s > 0 ? 0.015 : 0), -0.2); head.add(e);
      const g = new THREE.Sprite(glowMat); g.scale.setScalar(0.42); g.position.copy(e.position); g.position.z -= 0.02; head.add(g);
      eyes.push(e, g);
    }
    root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { root, hips, spine, legs, arms, neck, head, eyes, skin, eyeMat, glowMat, phase: 0, t: 0, twitch: { y: 0, p: 0, r: 0, ty: 0, tp: 0, tr: 0, next: 0 }, pose: { lean: 0.25, crouch: 0, reach: 0, spread: 0 } };
  }
  // state: 'walk' | 'stand' | 'search' | 'lunge' | 'loom'
  function animateFollower(m, state, speed, dt, k) {
    m.t += dt;
    const P = m.pose, tw = m.twitch;
    let lean = 0.28, crouch = 0, reach = 0, spread = 0, stride = 0;
    if (state === 'walk') { m.phase += dt * (1.2 + speed * 0.42); stride = clamp(speed / 6, 0.25, 1); lean = 0.3 + speed * 0.025; }
    else if (state === 'search') { m.phase += dt * 0.8; stride = 0.12; lean = 0.95; crouch = 0.75; reach = 0.6; }
    else if (state === 'lunge') { lean = 0.55 + (k.close || 0) * 0.3; crouch = 0.2; reach = 1; spread = 1 - (k.close || 0); }
    else if (state === 'loom') { lean = 0.62; crouch = 0.1; reach = 0.35; m.phase += dt * 0.5; }
    else { m.phase += dt * 0.4; }
    P.lean = damp(P.lean, lean, 4, dt); P.crouch = damp(P.crouch, crouch, 3, dt); P.reach = damp(P.reach, reach, state === 'lunge' ? 9 : 3, dt); P.spread = damp(P.spread, spread, 6, dt);
    const s = Math.sin(m.phase), c = Math.cos(m.phase);
    m.hips.position.y = 2.35 - P.crouch + Math.abs(c) * 0.12 * stride;
    m.hips.rotation.z = s * 0.06 * stride; m.hips.rotation.y = s * 0.08 * stride;
    m.legs[0].thigh.rotation.x = s * 0.55 * stride - P.crouch * 0.9; m.legs[1].thigh.rotation.x = -s * 0.55 * stride - P.crouch * 0.9;
    m.legs[0].knee.rotation.x = Math.max(0, -c) * 0.9 * stride + P.crouch * 1.6; m.legs[1].knee.rotation.x = Math.max(0, c) * 0.9 * stride + P.crouch * 1.6;
    m.spine.rotation.x = -P.lean + Math.sin(m.t * 0.9) * 0.03; m.spine.rotation.z = Math.sin(m.t * 0.53) * 0.05;
    for (const a of m.arms) {
      const sw = (a.s > 0 ? s : -s) * 0.35 * stride;
      a.sh.rotation.x = sw - P.reach * 1.25 + Math.sin(m.t * 1.3 + a.s) * 0.05;
      a.sh.rotation.z = a.s * (0.1 + P.spread * 1.1 + Math.sin(m.t * 0.7 + a.s * 2) * 0.04);
      a.el.rotation.x = -0.25 - P.reach * 0.5 - Math.max(0, sw) * 0.3 + (state === 'search' ? Math.sin(m.t * 2.3 + a.s) * 0.4 : 0);
      a.el.rotation.z = -a.s * P.spread * 0.6;
      a.hand.rotation.x = -0.3 - P.reach * 0.4;
    }
    // the head moves on its own: slow drift punctuated by sudden snaps
    if (m.t > tw.next) { tw.ty = (Math.random() - 0.5) * (state === 'search' ? 2.2 : 0.9); tw.tp = (Math.random() - 0.3) * 0.6; tw.tr = (Math.random() - 0.5) * 0.9; tw.next = m.t + 0.4 + Math.random() * (state === 'search' ? 0.8 : 2.2); }
    tw.y = damp(tw.y, tw.ty, 14, dt); tw.p = damp(tw.p, tw.tp, 12, dt); tw.r = damp(tw.r, tw.tr, 10, dt);
    m.neck.rotation.x = P.lean * 0.7 - 0.2;
    m.head.rotation.set(tw.p + (k.headP || 0), tw.y + (k.headY || 0), tw.r);
    const eo = k.eyes == null ? 1 : k.eyes;
    m.glowMat.opacity = eo; m.eyeMat.opacity = eo;
  }
  return { makeWanderer, animateWanderer, makeFollower, animateFollower };
}
