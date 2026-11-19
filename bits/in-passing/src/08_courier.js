// ---------------------------------------------------------------------------
// The courier: a small jointed puppet in a deep-teal coat and a dusty coral
// hood, a parcel strapped to their back and a long yellow scarf that streams
// with speed. Momentum is shown by the scarf and the body, never by a meter.
// ---------------------------------------------------------------------------

function buildCourier(stage, P) {
  const { THREE } = stage;
  const mats = [];
  const mat = (c, o) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, opacity: (o && o.opacity) || 1 }); mats.push(m); return m; };
  const shapeMesh = (pts, color, z) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i];
      if (q.length === 4) s.quadraticCurveTo(q[0], q[1], q[2], q[3]); else s.lineTo(q[0], q[1]);
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 8), mat(color));
    m.position.z = z || 0;
    return m;
  };
  const capsule = (w, h, color, z) => {
    const r = w / 2;
    const s = new THREE.Shape();
    s.moveTo(-r, 0); s.lineTo(-r, -h + r); s.quadraticCurveTo(-r, -h, 0, -h); s.quadraticCurveTo(r, -h, r, -h + r); s.lineTo(r, 0); s.quadraticCurveTo(r, r, 0, r); s.quadraticCurveTo(-r, r, -r, 0);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 6), mat(color));
    m.position.z = z || 0;
    return m;
  };
  const coat = '#2f5a5e', coatDark = '#23474b', trouser = '#3a3f4a', skin = '#e9c4a2', hood = P.coral, scarfC = P.yellow;

  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.44; root.add(body);
  // legs (pivot at hip)
  const legB = new THREE.Group(), legF = new THREE.Group();
  legB.add(capsule(0.085, 0.44, shadeC(trouser, -0.2), -0.03)); legF.add(capsule(0.09, 0.44, trouser, 0.02));
  const bootB = shapeMesh([[-0.05, -0.44], [0.1, -0.44], [0.1, -0.39], [-0.05, -0.37]], '#2a2a30', -0.02); legB.add(bootB);
  const bootF = shapeMesh([[-0.05, -0.44], [0.11, -0.44], [0.11, -0.39], [-0.05, -0.37]], '#2a2a30', 0.03); legF.add(bootF);
  body.add(legB); body.add(legF);
  // torso group (lean)
  const torso = new THREE.Group(); body.add(torso);
  const armB = new THREE.Group(); armB.position.set(0.0, 0.36, -0.02);
  armB.add(capsule(0.075, 0.32, coatDark, 0)); torso.add(armB);
  // parcel on the back
  const parcel = new THREE.Group(); parcel.position.set(-0.17, 0.22, -0.01);
  parcel.add(shapeMesh([[-0.12, -0.13], [0.1, -0.13], [0.1, 0.13], [-0.12, 0.13]], '#e8d7b2', 0));
  parcel.add(shapeMesh([[-0.12, -0.01], [0.1, -0.01], [0.1, 0.012], [-0.12, 0.012]], '#9a5a44', 0.001));
  parcel.add(shapeMesh([[-0.015, -0.13], [0.012, -0.13], [0.012, 0.13], [-0.015, 0.13]], '#9a5a44', 0.001));
  parcel.add(shapeMesh([[-0.04, 0.12], [0.03, 0.12], [0.0, 0.18]], P.coral, 0.002));
  torso.add(parcel);
  const coatM = shapeMesh([[-0.17, 0.0], [0.17, 0.0], [0.13, 0.4, 0.04, 0.44], [-0.04, 0.44, -0.13, 0.4], [-0.17, 0.0]], coat, 0.01);
  torso.add(coatM);
  const belt = shapeMesh([[-0.16, 0.12], [0.16, 0.12], [0.16, 0.16], [-0.16, 0.16]], '#8a5b3c', 0.012); torso.add(belt);
  // head
  const head = new THREE.Group(); head.position.set(0.02, 0.53, 0.015); torso.add(head);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), mat(skin)); head.add(face);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), mat('#1f2a30')); eye.position.set(0.065, 0.015, 0.003); head.add(eye);
  const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), mat('#e39b84', { opacity: 0.7 })); cheek.position.set(0.055, -0.04, 0.002); head.add(cheek);
  // the hood: a soft cone that flops back, its tip lagging behind motion
  const hoodG = new THREE.Group(); head.add(hoodG);
  const hoodM = shapeMesh([[0.11, 0.0], [0.12, 0.13, 0.0, 0.15], [-0.12, 0.14, -0.15, 0.02], [-0.14, -0.1], [-0.05, -0.05], [-0.02, 0.06, 0.11, 0.0]], hood, 0.004);
  hoodG.add(hoodM);
  const tip = new THREE.Group(); tip.position.set(-0.1, 0.12, 0); hoodG.add(tip);
  const tipM = shapeMesh([[0, -0.06], [0.02, 0.06], [-0.16, 0.12, -0.3, 0.02], [-0.12, 0.0, 0, -0.06]], shadeC(hood, -0.08), 0.003);
  tip.add(tipM);
  const pom = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), mat(P.cloth)); pom.position.set(-0.3, 0.02, 0.004); tip.add(pom);
  const armF = new THREE.Group(); armF.position.set(0.02, 0.36, 0.03);
  armF.add(capsule(0.08, 0.32, coat, 0)); const hand = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), mat(skin)); hand.position.set(0, -0.33, 0.001); armF.add(hand);
  torso.add(armF);
  // umbrella for falls (a coral parasol)
  const umb = new THREE.Group(); umb.position.set(0.02, 0.98, 0.05); umb.visible = false; torso.add(umb);
  umb.add(shapeMesh([[-0.5, 0], [-0.48, 0.25, 0, 0.32], [0.48, 0.25, 0.5, 0], [0.33, 0.05], [0.17, 0], [0, 0.05], [-0.17, 0], [-0.33, 0.05], [-0.5, 0]], P.coral, 0));
  umb.add(shapeMesh([[-0.012, 0.3], [0.012, 0.3], [0.012, -0.45], [-0.012, -0.45]], '#3a3a40', -0.001));

  // scarf: a ribbon simulated as a short chain in world space
  const N = 11;
  const scarfPos = new Float32Array(N * 2 * 3);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(scarfPos, 3));
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  sgeo.setIndex(idx);
  const scarf = new THREE.Mesh(sgeo, mat(scarfC)); scarf.frustumCulled = false;
  const scarfPts = Array.from({ length: N }, () => ({ x: 0, y: 0, px: 0, py: 0 }));

  const c = {
    root, scarf, body, torso, head, hoodG, tip, armF, armB, legF, legB, umb, mats,
    walk: 0, squash: 0, squashV: 0, lean: 0, hangAng: 0, hangAngV: 0, look: 0, scarfLen: 0.09, init: false, flow: 0, fade: 1
  };
  c.dispose = () => { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); sgeo.dispose(); mats.forEach(m => m.dispose()); };

  c.setOpacity = a => { mats.forEach(m => { m.opacity = a * (m.userData.base || 1); }); };
  mats.forEach(m => { m.userData.base = m.opacity; });

  // Pose the puppet from the player state. dt in seconds.
  c.update = (p, dt, t, extra) => {
    const sp = Math.hypot(p.mode === 'ground' ? p.gvx : p.vx, p.mode === 'ground' ? p.gvy : p.vy);
    root.position.set(p.x, p.y, 0.4);
    // squash spring
    c.squashV += (-c.squash * 260 - c.squashV * 18) * dt; c.squash += c.squashV * dt;
    const sq = clamp(c.squash, -0.3, 0.3);
    body.scale.set(1 + sq * 0.5, 1 - sq, 1);
    umb.visible = p.mode === 'fall';
    let armFr = 0.2, armBr = -0.2, legFr = 0, legBr = 0, torsoR = 0, headR = 0;
    if (p.mode === 'ground') {
      if (!p.atLip) {
        c.walk += dt * 11;
        legFr = Math.sin(c.walk) * 0.55; legBr = -legFr;
        armFr = -Math.sin(c.walk) * 0.5; armBr = -armFr;
        body.position.y = 0.44 + Math.abs(Math.cos(c.walk)) * 0.03;
        torsoR = -0.08;
      } else {
        // waiting at the lip: breathe, watch what's coming, tap a foot if it takes a while
        body.position.y = 0.44 + Math.sin(t * 2.4) * 0.006;
        headR = clamp(extra.lookY || 0, -0.5, 0.5) * 0.6;
        if (p.waitT > 2.5) legFr = Math.max(0, Math.sin(t * 9)) * -0.18;
        armFr = 0.12 + Math.sin(t * 2.4) * 0.03; armBr = -0.1;
        torsoR = 0.02 + (extra.ready ? -0.12 : 0);
      }
      c.hangAng *= 0.8;
    } else if (p.mode === 'air') {
      body.position.y = 0.44;
      const rise = clamp(p.vy / 9, -1, 1);
      legFr = -0.7 + rise * 0.3; legBr = 0.45;
      if (p.held) { armFr = Math.PI * 0.92; armBr = Math.PI * 0.8; } else { armFr = 1.4 - rise * 0.5; armBr = -1.0; }
      torsoR = clamp(-p.vx * 0.025, -0.25, 0.25) + rise * 0.05;
      headR = rise * 0.2;
      c.hangAng *= 0.9;
    } else if (p.mode === 'hang') {
      // the body trails the ring like a pendulum
      const target = clamp(-p.hvx * 0.09, -0.8, 0.8);
      c.hangAngV += ((target - c.hangAng) * 60 - c.hangAngV * 7) * dt; c.hangAng += c.hangAngV * dt;
      armFr = Math.PI - c.hangAng * 0.2; armBr = Math.PI - 0.1 - c.hangAng * 0.2;
      legFr = 0.25 + c.hangAng * 0.4 + Math.sin(t * 4) * 0.05; legBr = -0.1 + c.hangAng * 0.3;
      body.position.y = 0.44;
    } else if (p.mode === 'fall') {
      armFr = Math.PI * 0.95; armBr = Math.PI * 0.85; legFr = 0.15 + Math.sin(t * 3) * 0.2; legBr = -0.15;
      torsoR = Math.sin(t * 2.2) * 0.12;
    } else if (p.mode === 'deliver') {
      armFr = 1.3 + Math.sin(t * 6) * 0.2; torsoR = 0.15; headR = -0.1;
    }
    const k = 1 - Math.exp(-dt * 18);
    c.legF.rotation.z += (legFr - c.legF.rotation.z) * k;
    c.legB.rotation.z += (legBr - c.legB.rotation.z) * k;
    c.armF.rotation.z += (armFr - c.armF.rotation.z) * k;
    c.armB.rotation.z += (armBr - c.armB.rotation.z) * k;
    c.torso.rotation.z += (torsoR - c.torso.rotation.z) * k;
    c.head.rotation.z += (headR - c.head.rotation.z) * k;
    // whole body tilt while hanging (pivot at the hands)
    if (p.mode === 'hang') { root.rotation.z = c.hangAng; root.position.x = p.x + Math.sin(c.hangAng) * 1.0; root.position.y = p.y + 1.0 - Math.cos(c.hangAng) * 1.0; }
    else root.rotation.z = 0;
    // hood tip lags behind speed
    const hv = p.mode === 'ground' ? p.gvx + (p.atLip ? 0 : PHYS.WALK) : p.mode === 'hang' ? p.hvx : p.vx;
    c.tip.rotation.z += (clamp(-0.15 + hv * 0.05 + (p.mode === 'air' ? -p.vy * 0.03 : 0), -0.6, 0.7) - c.tip.rotation.z) * k;

    // scarf
    root.updateMatrixWorld(true);
    const nk = new THREE.Vector3(-0.04, 0.45, 0); c.torso.localToWorld(nk);
    const flow = extra.flow || 0;
    const seg = 0.075 + 0.06 * flow;
    const pts = scarfPts;
    if (!c.init) { pts.forEach((q, i) => { q.x = q.px = nk.x - i * seg; q.y = q.py = nk.y; }); c.init = true; }
    pts[0].x = nk.x; pts[0].y = nk.y;
    const wind = Math.sin(t * 3.1) * 0.6 + Math.sin(t * 7.3) * 0.3;
    for (let i = 1; i < N; i++) {
      const q = pts[i];
      const vx = (q.x - q.px) * 0.94, vy = (q.y - q.py) * 0.94;
      q.px = q.x; q.py = q.y;
      q.x += vx; q.y += vy - 1.4 * dt * dt * (1 - Math.min(0.9, sp * 0.08)) + wind * dt * dt * 2 * (i / N);
    }
    for (let it = 0; it < 3; it++) for (let i = 1; i < N; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
      const f = (d - seg) / d;
      if (i === 1) { b.x -= dx * f; b.y -= dy * f; } else { a.x += dx * f * 0.5; a.y += dy * f * 0.5; b.x -= dx * f * 0.5; b.y -= dy * f * 0.5; }
    }
    const pos = scarfPos;
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const w = lerp(0.055, 0.025, i / (N - 1));
      pos[i * 6] = pts[i].x - ty * w; pos[i * 6 + 1] = pts[i].y + tx * w; pos[i * 6 + 2] = 0.39;
      pos[i * 6 + 3] = pts[i].x + ty * w; pos[i * 6 + 4] = pts[i].y - tx * w; pos[i * 6 + 5] = 0.39;
    }
    sgeo.attributes.position.needsUpdate = true;
  };
  c.resetScarf = () => { c.init = false; };
  return c;
}

// ---- particles: dust, splashes, puffs, sparkles --------------------------------
function buildParticles(stage, n) {
  const { THREE } = stage;
  const tex = new THREE.CanvasTexture(paintSoftDot('#ffffff'));
  const geo = new THREE.PlaneGeometry(1, 1);
  const pool = [];
  const group = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    m.visible = false; m.position.z = 0.5; group.add(m);
    pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, g: 0, s0: 0.2, s1: 0.5, a: 1 });
  }
  let next = 0;
  const api = {
    group,
    emit(x, y, o) {
      const k = o.count || 1;
      for (let i = 0; i < k; i++) {
        const q = pool[next]; next = (next + 1) % n;
        const ang = (o.angle == null ? Math.PI / 2 : o.angle) + (Math.random() - 0.5) * (o.spread == null ? Math.PI : o.spread);
        const spd = (o.speed || 1) * (0.5 + Math.random() * 0.8);
        q.vx = Math.cos(ang) * spd + (o.vx || 0); q.vy = Math.sin(ang) * spd + (o.vy || 0);
        q.life = 0; q.max = (o.life || 0.6) * (0.7 + Math.random() * 0.6);
        q.g = o.gravity || 0; q.s0 = o.size || 0.2; q.s1 = o.grow || q.s0 * 2.5; q.a = o.alpha || 0.7;
        q.m.material.color.set(o.color || '#ffffff');
        q.m.position.set(x + (Math.random() - 0.5) * (o.jx || 0), y + (Math.random() - 0.5) * (o.jy || 0), o.z || 0.5);
        q.m.visible = true;
      }
    },
    update(dt) {
      for (const q of pool) {
        if (!q.m.visible) continue;
        q.life += dt;
        if (q.life >= q.max) { q.m.visible = false; continue; }
        const f = q.life / q.max;
        q.vy -= q.g * dt; q.vx *= 0.96; q.vy *= 0.96;
        q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt;
        q.m.scale.setScalar(lerp(q.s0, q.s1, f));
        q.m.material.opacity = q.a * (1 - f) * Math.min(1, f * 8);
      }
    },
    clear() { pool.forEach(q => { q.m.visible = false; }); },
    dispose() { tex.dispose(); geo.dispose(); pool.forEach(q => q.m.material.dispose()); }
  };
  return api;
}
