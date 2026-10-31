// =====================================================================
// The black cat: a procedural, articulated rig.
//
//   root (at the paws, faces the velocity)
//   └ body (spine height; compresses, pitches, leans with the slope)
//      ├ pelvis ── hind legs (thigh, shin, hock; IK) ── tail (10 springs)
//      └ chest ── fore legs (upper, lower; IK) ── neck ── head (ears, eyes)
//                └ collar with the power core (brightens with each fragment)
//
// Readability on dark roofs: a cool rim light in the fur material (07),
// lit eyes, and the core's glow. The rig only reads the cat's state; it
// never moves the cat. Feet are placed by two-bone IK, so compression,
// crouching and landing bend the legs by themselves.
//
// Replacing it (Phase 2): any rig providing { root, update(dt, s),
// setShadows(on), dispose() } drops in. `s` is built in 12_game.
// =====================================================================

function createCatRig(THREE, A) {
  const COL = { back: hex3('#0a0b0e'), side: hex3('#14151a'), belly: hex3('#1e1f26'), paw: hex3('#18191e'), ear: hex3('#3b2730'), nose: hex3('#2c2024') };
  const root = new THREE.Group();
  const meshes = [], owned = [];
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // dorsal-dark to belly-light gradient baked into vertex colours
  function shade(g, top, bottom, mid) {
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const k = clamp(n.getY(i) * 0.5 + 0.5, 0, 1);
      const a = mid ? (k > 0.5 ? [mid, top, (k - 0.5) * 2] : [bottom, mid, k * 2]) : [bottom, top, k];
      for (let j = 0; j < 3; j++) c[i * 3 + j] = lerp(a[0][j], a[1][j], a[2]);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  function ellipsoid(rx, ry, rz, top, bottom, mid, seg) {
    const g = new THREE.SphereGeometry(1, seg || 16, Math.round((seg || 16) * 0.75));
    g.rotateX(Math.PI / 2);
    g.scale(rx, ry, rz);
    return shade(g, top, bottom, mid);
  }
  function bone(r0, len, top, bottom) {
    const g = new THREE.CylinderGeometry(r0, r0 * 0.75, len, 8, 1);
    g.translate(0, -len / 2, 0);
    return shade(g, top, bottom);
  }
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat || A.M.fur);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m); meshes.push(m); owned.push(geo);
    return m;
  }
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };

  // ---- body: long and lean ----
  const SPINE_Y = 0.215;
  const body = grp(root, 0, SPINE_Y, 0);
  const pelvis = grp(body), chest = grp(body);
  add(pelvis, ellipsoid(0.062, 0.072, 0.165, COL.back, COL.belly, COL.side), A.M.fur, 0, -0.004, 0.08);
  add(chest, ellipsoid(0.068, 0.082, 0.155, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.004, -0.075);
  add(chest, ellipsoid(0.042, 0.05, 0.075, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.042, -0.195).rotation.x = 0.75;
  // collar and the power core
  const collar = new THREE.TorusGeometry(0.044, 0.0065, 6, 18); collar.rotateX(Math.PI / 2 - 0.75);
  add(chest, collar, A.M.collar, 0, 0.045, -0.2);
  const core = add(chest, new THREE.OctahedronGeometry(0.014, 0), A.M.core, 0, 0.0, -0.245); core.castShadow = false;
  const coreGlow = new THREE.Sprite(A.M.coreGlow); coreGlow.scale.setScalar(0.1); coreGlow.position.copy(core.position); chest.add(coreGlow);
  // head
  const head = grp(chest, 0, 0.078, -0.235);
  add(head, ellipsoid(0.058, 0.052, 0.06, COL.back, COL.belly, COL.side, 14), A.M.fur, 0, 0.01, -0.028);
  add(head, ellipsoid(0.027, 0.021, 0.03, COL.side, COL.belly, null, 10), A.M.fur, 0, -0.012, -0.072);
  add(head, new THREE.SphereGeometry(0.007, 6, 4), A.M.nose, 0, 0.002, -0.1);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.011, 10, 6); g.scale(1, 0.8, 0.6);
    const e = add(head, g, A.M.eye, sx * 0.023, 0.02, -0.074); e.castShadow = false; e.rotation.y = sx * 0.35; eyes.push(e);
  }
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = grp(head, sx * 0.03, 0.046, -0.016);
    const g = new THREE.ConeGeometry(0.028, 0.07, 4, 1); g.translate(0, 0.035, 0); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.45);
    add(pivot, shade(g, COL.back, COL.side), A.M.fur);
    const inner = new THREE.ConeGeometry(0.017, 0.045, 3, 1); inner.translate(0, 0.024, 0); inner.scale(1, 1, 0.25);
    add(pivot, shade(inner, COL.ear, COL.ear), A.M.furPlain, 0, 0.004, -0.008);
    pivot.rotation.z = -sx * 0.24;
    ears.push({ g: pivot, sx });
  }

  // ---- legs: shoulder/hip pivot -> upper -> lower (-> hock) -> paw ----
  function leg(parent, x, y, z, hind) {
    const L1 = hind ? 0.1 : 0.112, L2 = hind ? 0.097 : 0.11, L3 = hind ? 0.078 : 0;
    const pivot = grp(parent, x, y, z);
    const up = grp(pivot); add(up, bone(hind ? 0.03 : 0.023, L1 + 0.01, COL.side, COL.side), A.M.fur);
    if (hind) add(up, ellipsoid(0.036, 0.058, 0.052, COL.back, COL.side, null, 10), A.M.fur, 0, -0.022, 0.004);
    const lo = grp(up, 0, -L1, 0); add(lo, bone(hind ? 0.018 : 0.016, L2 + 0.006, COL.side, COL.side), A.M.fur);
    let hock = null, paw;
    if (hind) { hock = grp(lo, 0, -L2, 0); add(hock, bone(0.014, L3, COL.side, COL.side), A.M.fur); paw = grp(hock, 0, -L3, 0); }
    else paw = grp(lo, 0, -L2, 0);
    add(paw, ellipsoid(0.017, 0.011, 0.025, COL.paw, COL.paw, null, 8), A.M.fur, 0, 0.004, -0.008);
    return { pivot, up, lo, hock, paw, L1, L2, L3, hind, x, side: sign(x) };
  }
  const legs = {
    fl: leg(chest, -0.038, -0.035, -0.15, false), fr: leg(chest, 0.038, -0.035, -0.15, false),
    hl: leg(pelvis, -0.041, -0.025, 0.165, true), hr: leg(pelvis, 0.041, -0.025, 0.165, true)
  };
  const OFFSET = { hl: 0, hr: 0.09, fl: 0.5, fr: 0.6 };   // rotary gallop

  // ---- tail: a long chain of springs ----
  const TAIL_N = 10, TAIL_L = 0.036;
  const tail = [];
  let tp = grp(pelvis, 0, 0.025, 0.235);
  for (let i = 0; i < TAIL_N; i++) {
    const r = lerp(0.016, 0.009, i / TAIL_N);
    const g = new THREE.CylinderGeometry(r * 0.9, r, TAIL_L + 0.006, 7, 1); g.rotateX(Math.PI / 2); g.translate(0, 0, TAIL_L / 2);
    add(tp, shade(g, COL.back, COL.side), A.M.fur);
    tail.push({ g: tp, p: mkSpring(0), y: mkSpring(0), f: lerp(6, 2.4, i / (TAIL_N - 1)) });
    tp = grp(tp, 0, 0, TAIL_L);
  }

  const S = {
    phase: 0, yaw: mkSpring(0), lift: mkSpring(0), pitch: mkSpring(0), lean: mkSpring(0), flex: mkSpring(0),
    air: 0, crouch: 0, gather: 0, wait: 0, flinch: 0, narrow: 0, prevVy: 0, prevVx: 0, ay: 0, ax: 0, time: 0,
    blink: 2, twitch: 3, twitchEar: 0, twitchSide: 0, run: 0, core: 0, flare: 0, look: 0
  };

  // two-bone IK in the pivot's y-z plane. bend: +1 joint behind (elbow), -1 joint ahead (knee)
  function ik(Lg, ty, tz, bend) {
    const a = Lg.L1, b = Lg.L2;
    const d = clamp(Math.hypot(ty, tz), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const phi = Math.atan2(-tz, -ty);
    const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const beta = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    Lg.up.rotation.x = phi - bend * alpha;
    Lg.lo.rotation.x = bend * (Math.PI - beta);
    return Lg.up.rotation.x + Lg.lo.rotation.x;
  }
  function placeLeg(Lg, rel) {
    Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
    _w.set(_v.x, _v.y + rel[1], _v.z + rel[0]);
    root.localToWorld(_w); Lg.pivot.worldToLocal(_w);
    if (Lg.hind) {
      const sum = ik(Lg, _w.y + Lg.L3 * 0.92, _w.z + Lg.L3 * 0.4, -1);
      Lg.hock.rotation.x = Math.atan2(Lg.L3 * 0.4, Lg.L3 * 0.92) - sum;
      Lg.paw.rotation.x = -(Lg.hock.rotation.x + sum) * 0.9;
    } else {
      const sum = ik(Lg, _w.y, _w.z, 1);
      Lg.paw.rotation.x = -sum * 0.9;
    }
  }

  function update(dt, s) {
    if (dt <= 0) return;
    S.time += dt;
    const speed = s.fwd, run = clamp(speed / 4.5, 0, 1);
    S.run = damp(S.run, run, 6, dt);
    S.ay = damp(S.ay, clamp((s.vy - S.prevVy) / dt, -60, 60), 18, dt); S.prevVy = s.vy;
    S.ax = damp(S.ax, clamp((s.vx - S.prevVx) / dt, -40, 40), 12, dt); S.prevVx = s.vx;
    for (const e of s.events) {
      if (e.type === 'land') { S.lift.v -= clamp(e.impact, 0, 14) * 0.075; S.pitch.v -= clamp(e.impact, 0, 14) * 0.18; S.flex.v += clamp(e.impact, 0, 14) * 0.08; }
      if (e.type === 'jump') { S.lift.v += 0.5; S.flex.v -= 1.4; }
      if (e.type === 'bump') { S.pitch.v -= 3; S.lift.v -= 0.4; }
      if (e.type === 'scald') { S.flinch = 1; S.pitch.v += 4; }
      if (e.type === 'fragment') S.flare = 1;
    }
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const yawT = Math.atan2(-s.vx, Math.max(0.5, speed)) * 0.85;
    root.rotation.y = spring(S.yaw, yawT, 3.5, 0.9, dt);

    const grounded = s.grounded && s.scr === null;
    S.air = damp(S.air, grounded ? 0 : 1, grounded ? 22 : 12, dt);
    S.crouch = damp(S.crouch, s.crouch ? 1 : 0, 16, dt);
    S.gather = damp(S.gather, grounded ? s.edgeAhead : 0, 8, dt);
    S.narrow = damp(S.narrow, s.narrow, 6, dt);
    S.wait = damp(S.wait, grounded && speed < 0.4 ? 1 : 0, 5, dt);       // held back: crouched, watching
    S.flinch = Math.max(0, S.flinch - dt * 1.6);

    const stride = 0.5 + speed * 0.16;
    if (grounded) S.phase = (S.phase + dt * speed / stride) % 1;
    else if (s.scr !== null) S.phase = (S.phase + dt * 6) % 1;
    const ph = S.phase * TAU;
    const duty = lerp(0.62, 0.38, S.run);

    // body: height, pitch, lean, spine flex. On a pipe the cat goes low; on a slope it leans into it.
    const bob = grounded ? Math.abs(Math.sin(ph)) * 0.013 * S.run : 0;
    spring(S.lift, -0.095 * S.crouch - 0.03 * S.gather - 0.04 * S.narrow - 0.05 * S.wait + bob, 3.4, 0.45, dt);
    let pitchT = grounded ? Math.sin(ph) * 0.05 * S.run - 0.05 * S.crouch - Math.atan(s.slope[1]) * 0.7 : clamp(s.vy * 0.045, -0.35, 0.3);
    if (s.scr !== null) pitchT = 0.7 * (1 - s.scr);
    if (s.stumble > 0) pitchT -= 0.25 * clamp(s.stumble / 0.4, 0, 1);
    pitchT += 0.25 * S.flinch;
    spring(S.pitch, pitchT, 3.2, 0.5, dt);
    const teeter = s.teeter * Math.sin(S.time * 9) * 0.18;
    const slopeRoll = grounded ? Math.atan(s.slope[0]) * 0.75 : 0;
    spring(S.lean, clamp(-s.vx * 0.07, -0.3, 0.3) + teeter + slopeRoll, 3, 0.6, dt);
    const flexT = grounded ? Math.sin(ph + Math.PI / 2) * 0.13 * S.run + 0.06 * S.gather + 0.05 * S.wait : lerp(-0.14, 0.08, clamp(-s.vy / 6 + 0.5, 0, 1));
    spring(S.flex, flexT, 4.5, 0.55, dt);
    body.position.y = SPINE_Y + S.lift.x;
    body.rotation.set(S.pitch.x, 0, S.lean.x);
    pelvis.rotation.x = S.flex.x; chest.rotation.x = -S.flex.x;
    root.updateMatrixWorld(true);

    // legs
    const falling = clamp(-s.vy / 5 + 0.5, 0, 1);
    for (const key in legs) {
      const Lg = legs[key];
      Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
      const h = _v.y;
      let gz, gy;
      const lp = (S.phase + OFFSET[key]) % 1;
      const reach = clamp(stride * duty * 0.5, 0.03, 0.15) * S.run * (1 - 0.35 * S.narrow);
      if (lp < duty) { gz = lerp(-reach, reach, lp / duty); gy = -h; }
      else { const u = (lp - duty) / (1 - duty); gz = lerp(reach, -reach, smooth(u)); gy = -h + Math.sin(Math.PI * u) * lerp(0.03, 0.08, S.run) * (1 - 0.4 * S.narrow); }
      gz += Lg.hind ? 0.012 : -0.01;
      if (S.run < 0.05) gz += (Lg.hind ? 0.02 : -0.02) * S.wait;
      let az, ay;
      if (s.sinceJump < 0.12 && !grounded) { az = Lg.hind ? 0.13 : 0.02; ay = Lg.hind ? -0.19 : -0.1; }
      else if (Lg.hind) { az = lerp(0.15, -0.02, falling); ay = lerp(-0.1, -0.15, falling); }
      else { az = lerp(-0.17, -0.09, falling); ay = lerp(-0.1, -0.2, falling); }
      if (s.scr !== null) { if (Lg.hind) { az = Math.sin(ph * 2 + (Lg.side > 0 ? 1.5 : 0)) * 0.06; ay = -0.15 + Math.cos(ph * 2) * 0.03; } else { az = -0.12; ay = 0.02 + 0.12 * s.scr; } }
      placeLeg(Lg, [lerp(gz, az, S.air), lerp(gy, ay, S.air)]);
    }

    // head: level against the body, looking where the cat is going; up at the hazard while waiting
    let look = -0.08 - 0.22 * S.gather - 0.18 * S.narrow + 0.3 * S.wait;
    if (!grounded) look = lerp(0.12, -0.38, falling);
    head.rotation.x = -(S.pitch.x - S.flex.x) * 0.85 + look - 0.15 * S.crouch;
    head.position.y = 0.078 - 0.05 * S.crouch - 0.012 * S.narrow;
    head.rotation.y = clamp(-s.vx * 0.12 - s.assistX * 0.15 + Math.sin(S.time * 0.9) * 0.25 * S.wait, -0.5, 0.5);
    head.rotation.z = -S.lean.x * 0.6;
    // ears: flatten with speed, when ducking and from steam; forward when watching
    S.twitch -= dt; if (S.twitch < 0) { S.twitch = 2 + Math.random() * 3; S.twitchEar = 0.18; S.twitchSide = Math.random() < 0.5 ? 0 : 1; }
    S.twitchEar = Math.max(0, S.twitchEar - dt);
    ears.forEach((e, i) => { e.g.rotation.x = -(0.15 * S.run + 0.9 * S.crouch + 0.3 * S.air * (1 - falling) + 1.1 * S.flinch) + 0.15 * S.wait + (S.twitchEar > 0 && i === S.twitchSide ? 0.35 : 0); });
    S.blink -= dt; if (S.blink < 0) S.blink = 2.5 + Math.random() * 3;
    const ey = S.blink < 0.1 || S.flinch > 0.5 ? 0.15 : 1; for (const e of eyes) e.scale.y = ey;

    // the core: brighter with every fragment, flaring when one is taken
    S.core = damp(S.core, s.charge, 4, dt); S.flare = Math.max(0, S.flare - dt * 1.4);
    const glow = 0.35 + 0.22 * S.core + 0.6 * S.flare + 0.05 * Math.sin(S.time * 4);
    A.M.core.color.setRGB(0.25 + 0.2 * glow, 0.7 + 0.3 * glow, 0.45 + 0.2 * glow);
    coreGlow.scale.setScalar(0.07 + 0.05 * S.core + 0.18 * S.flare);
    A.M.coreGlow.opacity = clamp(0.45 + 0.15 * S.core + 0.4 * S.flare, 0, 1);

    // tail: streams back at speed, out straight and level on pipes for balance, low and
    // twitching while waiting, bristling up from steam
    const upBase = lerp(-0.85, -0.1, S.run) - 0.35 * s.teeter + 0.05 * S.narrow + 0.5 * S.wait - 0.9 * S.flinch;
    for (let i = 0; i < TAIL_N; i++) {
      const t = tail[i], k = i / (TAIL_N - 1);
      const curl = lerp(0.07, -0.16, k) * lerp(1.6, 1, S.run) * (1 - 0.8 * S.narrow) + (S.wait * (k > 0.6 ? -0.25 : 0.1));
      const pT = (i === 0 ? upBase : curl) + clamp(S.ay * 0.004, -0.25, 0.25) * (0.4 + k) - S.crouch * (i === 0 ? -0.5 : 0.05);
      const swish = Math.sin(S.time * (7 - 3 * S.wait) - i * 0.6) * (0.04 + 0.16 * s.teeter + 0.12 * S.narrow + 0.1 * S.wait) * (0.3 + k);
      const yT = (i === 0 ? 0 : clamp(S.ax * 0.01, -0.2, 0.2)) + swish - S.lean.x * 0.7 * (i < 4 ? 1 : 0);
      t.g.rotation.x = spring(t.p, pT, t.f, 0.4, dt);
      t.g.rotation.y = spring(t.y, yT, t.f, 0.35, dt);
    }
  }

  function setShadows(on) { for (const m of meshes) if (m.material !== A.M.eye && m.material !== A.M.core) m.castShadow = on; }
  function dispose() { for (const g of owned) g.dispose(); if (root.parent) root.parent.remove(root); }
  return { root, update, dispose, setShadows };
}
