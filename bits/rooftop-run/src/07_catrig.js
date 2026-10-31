// =====================================================================
// The cat's visible body: a procedural, articulated rig.
//
//   root (at the paws, faces the velocity)
//   └ body (spine height; compresses, pitches, leans)
//      ├ pelvis ── hind legs (thigh, shin, hock; IK) ── tail (8 springs)
//      └ chest ── fore legs (upper, lower; IK) ── neck ── head (ears, eyes)
//
// The rig only reads the cat's state; it never moves the cat. Feet are
// placed by two-bone IK against the ground, so compression, crouching
// and landing bend the legs by themselves.
//
// Replacing it: any rig (e.g. a skinned glTF cat) that provides
// { root, update(dt, s), dispose() } drops in. `s` is built in 11_game.
// =====================================================================

function createCatRig(THREE, A) {
  const COL = { back: hex3('#5e4535'), side: hex3('#8a6a52'), belly: hex3('#d6c4ad'), sock: hex3('#e9e0d3'), dark: hex3('#3a2a22') };
  const root = new THREE.Group();
  const meshes = [];
  const owned = [];
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // geometry helpers: dorsal-dark to belly-light gradient baked into vertex colours
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
    g.rotateX(Math.PI / 2);          // poles along the spine: tabby stripes wrap across the back
    g.scale(rx, ry, rz);
    return shade(g, top, bottom, mid);
  }
  function bone(r0, len, top, bottom) {
    // a tapered limb from the joint (origin) down -y
    const g = new THREE.CylinderGeometry(r0, r0 * 0.78, len, 8, 1);
    g.translate(0, -len / 2, 0);
    return shade(g, top, bottom);
  }
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat || A.M.furPlain);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m); meshes.push(m); owned.push(geo);
    return m;
  }
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };

  // ---- body ----
  const SPINE_Y = 0.22;
  const body = grp(root, 0, SPINE_Y, 0);
  const pelvis = grp(body), chest = grp(body);
  add(pelvis, ellipsoid(0.072, 0.082, 0.16, COL.back, COL.belly, COL.side), A.M.fur, 0, -0.005, 0.075);
  add(chest, ellipsoid(0.078, 0.09, 0.15, COL.back, COL.belly, COL.side), A.M.fur, 0, 0.002, -0.07);
  // neck and head
  add(chest, ellipsoid(0.048, 0.056, 0.07, COL.back, COL.belly, COL.side), null, 0, 0.04, -0.19).rotation.x = 0.7;
  const head = grp(chest, 0, 0.075, -0.225);
  add(head, ellipsoid(0.066, 0.058, 0.066, COL.back, COL.belly, COL.side, 14), A.M.fur, 0, 0.012, -0.03);
  add(head, ellipsoid(0.03, 0.024, 0.032, COL.belly, COL.belly, null, 10), null, 0, -0.012, -0.078);
  add(head, new THREE.SphereGeometry(0.008, 6, 4), A.M.nose, 0, 0.004, -0.106);
  const eyes = [];
  for (const sx of [-1, 1]) { const e = add(head, new THREE.SphereGeometry(0.0095, 8, 6), A.M.eye, sx * 0.024, 0.022, -0.078); e.castShadow = false; eyes.push(e); }
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = grp(head, sx * 0.032, 0.048, -0.02);
    const g = new THREE.ConeGeometry(0.024, 0.055, 4, 1); g.translate(0, 0.0275, 0); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.55);
    add(pivot, shade(g, COL.dark, COL.side), null);
    pivot.rotation.z = -sx * 0.28;
    ears.push({ g: pivot, sx });
  }

  // ---- legs: shoulder/hip pivot -> upper -> lower (-> hock) -> paw ----
  function leg(parent, x, y, z, hind) {
    const L1 = hind ? 0.1 : 0.115, L2 = hind ? 0.098 : 0.112, L3 = hind ? 0.078 : 0;
    const pivot = grp(parent, x, y, z);
    const up = grp(pivot); add(up, bone(hind ? 0.034 : 0.026, L1 + 0.01, COL.side, COL.side), A.M.fur);
    if (hind) add(up, ellipsoid(0.04, 0.06, 0.055, COL.back, COL.side, null, 10), A.M.fur, 0, -0.025, 0.004);
    const lo = grp(up, 0, -L1, 0); add(lo, bone(hind ? 0.02 : 0.018, L2 + 0.006, COL.side, COL.side));
    let hock = null, paw;
    if (hind) { hock = grp(lo, 0, -L2, 0); add(hock, bone(0.016, L3, COL.side, COL.side)); paw = grp(hock, 0, -L3, 0); }
    else paw = grp(lo, 0, -L2, 0);
    add(paw, ellipsoid(0.02, 0.012, 0.028, COL.sock, COL.sock, null, 8), null, 0, 0.004, -0.008);
    return { pivot, up, lo, hock, paw, L1, L2, L3, hind, x, phase: 0, side: sign(x) };
  }
  const legs = {
    fl: leg(chest, -0.042, -0.035, -0.145, false), fr: leg(chest, 0.042, -0.035, -0.145, false),
    hl: leg(pelvis, -0.045, -0.025, 0.16, true), hr: leg(pelvis, 0.045, -0.025, 0.16, true)
  };
  // rotary gallop: hinds paired, then fores
  const OFFSET = { hl: 0, hr: 0.09, fl: 0.5, fr: 0.6 };

  // ---- tail: a chain of springs ----
  const TAIL_N = 8, TAIL_L = 0.038;
  const tail = [];
  let tp = grp(pelvis, 0, 0.025, 0.225);
  for (let i = 0; i < TAIL_N; i++) {
    const r = lerp(0.019, 0.011, i / TAIL_N);
    const g = new THREE.CylinderGeometry(r * 0.9, r, TAIL_L + 0.006, 7, 1); g.rotateX(Math.PI / 2); g.translate(0, 0, TAIL_L / 2);
    const c = i % 2 ? COL.side : COL.back;
    add(tp, shade(g, i === TAIL_N - 1 ? COL.dark : c, c), A.M.furPlain);
    tail.push({ g: tp, p: mkSpring(0), y: mkSpring(0), f: lerp(6, 2.6, i / (TAIL_N - 1)) });
    tp = grp(tp, 0, 0, TAIL_L);
  }

  // ---- state ----
  const S = {
    phase: 0, yaw: mkSpring(0), lift: mkSpring(0), pitch: mkSpring(0), lean: mkSpring(0), flex: mkSpring(0),
    air: 0, crouch: 0, gather: 0, prevVy: 0, prevVx: 0, ay: 0, ax: 0, time: 0, blink: 2, twitch: 3, twitchEar: 0, run: 0
  };

  // two-bone IK in the pivot's y-z plane. bend: +1 joint behind (elbow), -1 joint ahead (knee)
  function ik(Lg, ty, tz, bend) {
    const a = Lg.L1, b = Lg.L2;
    let d = Math.hypot(ty, tz);
    d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const phi = Math.atan2(-tz, -ty);
    const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const beta = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    Lg.up.rotation.x = phi - bend * alpha;
    Lg.lo.rotation.x = bend * (Math.PI - beta);
    return Lg.up.rotation.x + Lg.lo.rotation.x;
  }
  // a root-space target (relative to the leg pivot's root-space position) into pivot space
  function placeLeg(Lg, rel) {
    Lg.pivot.getWorldPosition(_v); root.worldToLocal(_v);
    _w.set(_v.x, _v.y + rel[1], _v.z + rel[0]);
    root.localToWorld(_w); Lg.pivot.worldToLocal(_w);
    if (Lg.hind) {
      // hock stays near-vertical, leaning back: solve thigh+shin to the ankle
      const ankle = [_w.y + Lg.L3 * 0.92, _w.z + Lg.L3 * 0.4];
      const sum = ik(Lg, ankle[0], ankle[1], -1);
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
    // accelerations drive secondary motion (tail, ears)
    S.ay = damp(S.ay, clamp((s.vy - S.prevVy) / dt, -60, 60), 18, dt); S.prevVy = s.vy;
    S.ax = damp(S.ax, clamp((s.vx - S.prevVx) / dt, -40, 40), 12, dt); S.prevVx = s.vx;
    for (const e of s.events) {
      if (e.type === 'land') { S.lift.v -= clamp(e.impact, 0, 14) * 0.075; S.pitch.v -= clamp(e.impact, 0, 14) * 0.18; S.flex.v += clamp(e.impact, 0, 14) * 0.08; }
      if (e.type === 'jump') { S.lift.v += 0.5; S.flex.v -= 1.4; }
      if (e.type === 'bump') { S.pitch.v -= 3; S.lift.v -= 0.4; }
    }
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    // face the direction of travel
    const yawT = Math.atan2(-s.vx, Math.max(0.5, speed)) * 0.85;
    root.rotation.y = spring(S.yaw, yawT, 3.5, 0.9, dt);

    const grounded = s.grounded && !s.scr;
    S.air = damp(S.air, grounded ? 0 : 1, grounded ? 22 : 12, dt);
    S.crouch = damp(S.crouch, s.crouch ? 1 : 0, 16, dt);
    S.gather = damp(S.gather, grounded ? s.edgeAhead : 0, 8, dt);

    // gait phase: stride grows with speed
    const stride = 0.5 + speed * 0.16;
    if (grounded) S.phase = (S.phase + dt * speed / stride) % 1;
    else if (s.scr !== null) S.phase = (S.phase + dt * 6) % 1;
    const ph = S.phase * TAU;
    const duty = lerp(0.62, 0.38, S.run);

    // body: height, pitch, lean, spine flex
    const bob = grounded ? Math.abs(Math.sin(ph)) * 0.014 * S.run : 0;
    const liftT = -0.095 * S.crouch - 0.03 * S.gather + bob - 0.012 * s.narrow;
    spring(S.lift, liftT, 3.4, 0.45, dt);
    let pitchT = grounded ? Math.sin(ph) * 0.05 * S.run - 0.05 * S.crouch : clamp(s.vy * 0.045, -0.35, 0.3);
    if (s.scr !== null) pitchT = 0.7 * (1 - s.scr);
    if (s.stumble > 0) pitchT -= 0.25 * clamp(s.stumble / 0.4, 0, 1);
    spring(S.pitch, pitchT, 3.2, 0.5, dt);
    const teeter = s.teeter * Math.sin(S.time * 9) * 0.18;
    spring(S.lean, clamp(-s.vx * 0.07, -0.3, 0.3) + teeter, 3, 0.6, dt);
    const flexT = grounded ? Math.sin(ph + Math.PI / 2) * 0.13 * S.run + 0.06 * S.gather : lerp(-0.12, 0.08, clamp(-s.vy / 6 + 0.5, 0, 1));
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
      const h = _v.y;                                    // pivot height above the paws' ground
      // ground pose: gait or stance
      let gz, gy;
      const lp = (S.phase + OFFSET[key]) % 1;
      const reach = clamp(stride * duty * 0.5, 0.03, 0.15) * S.run;
      if (lp < duty) { gz = lerp(-reach, reach, lp / duty); gy = -h; }
      else { const u = (lp - duty) / (1 - duty); gz = lerp(reach, -reach, smooth(u)); gy = -h + Math.sin(Math.PI * u) * lerp(0.03, 0.085, S.run); }
      gz += Lg.hind ? 0.012 : -0.01;
      if (S.run < 0.05) gz += (Lg.side > 0 ? 0.01 : -0.01) * (Lg.hind ? 1 : -1);
      // air pose: fore reach, hind stretch; then reach down to land
      let az, ay;
      if (s.sinceJump < 0.12 && !grounded) { az = Lg.hind ? 0.13 : 0.02; ay = Lg.hind ? -0.19 : -0.1; }
      else if (Lg.hind) { az = lerp(0.15, -0.02, falling); ay = lerp(-0.1, -0.15, falling); }
      else { az = lerp(-0.17, -0.09, falling); ay = lerp(-0.1, -0.2, falling); }
      // scramble: front paws hook the lip, hinds scrabble
      if (s.scr !== null) { if (Lg.hind) { az = Math.sin(ph * 2 + (Lg.side > 0 ? 1.5 : 0)) * 0.06; ay = -0.15 + Math.cos(ph * 2) * 0.03; } else { az = -0.12; ay = 0.02 + 0.12 * s.scr; } }
      placeLeg(Lg, [lerp(gz, az, S.air), lerp(gy, ay, S.air)]);
    }

    // head: held level against the body's pitch, looking where the cat is going
    let look = -0.08 - 0.22 * S.gather - 0.12 * s.narrow;
    if (!grounded) look = lerp(0.12, -0.38, falling);
    head.rotation.x = -(S.pitch.x - S.flex.x) * 0.85 + look - 0.15 * S.crouch;
    head.position.y = 0.075 - 0.05 * S.crouch;
    head.rotation.y = clamp(-s.vx * 0.12 - s.assistX * 0.15, -0.5, 0.5);
    head.rotation.z = -S.lean.x * 0.6;
    // ears: flatten with speed and when ducking; an occasional twitch
    S.twitch -= dt; if (S.twitch < 0) { S.twitch = 2 + Math.random() * 3; S.twitchEar = 0.18; S.twitchSide = Math.random() < 0.5 ? 0 : 1; }
    S.twitchEar = Math.max(0, S.twitchEar - dt);
    ears.forEach((e, i) => { e.g.rotation.x = -(0.15 * S.run + 0.9 * S.crouch + 0.3 * S.air * (1 - falling)) + (S.twitchEar > 0 && i === S.twitchSide ? 0.35 : 0); });
    // blink
    S.blink -= dt; if (S.blink < 0) S.blink = 2.5 + Math.random() * 3;
    const ey = S.blink < 0.1 ? 0.15 : 1; for (const e of eyes) e.scale.y = ey;

    // tail: streams back at speed, rises for balance; lags vertical and lateral acceleration
    const upBase = lerp(-0.85, -0.08, S.run) - 0.4 * s.teeter - 0.3 * s.narrow;
    for (let i = 0; i < TAIL_N; i++) {
      const t = tail[i], k = i / (TAIL_N - 1);
      const pT = (i === 0 ? upBase : lerp(0.07, -0.16, k) * lerp(1.6, 1, S.run)) + clamp(S.ay * 0.004, -0.25, 0.25) * (0.4 + k) - S.crouch * (i === 0 ? -0.5 : 0.05);
      const yT = (i === 0 ? 0 : clamp(S.ax * 0.01, -0.2, 0.2)) + Math.sin(S.time * 7 - i * 0.6) * (0.04 + 0.16 * s.teeter) * (0.3 + k) - S.lean.x * 0.6 * (i < 3 ? 1 : 0);
      t.g.rotation.x = spring(t.p, pT, t.f, 0.4, dt);
      t.g.rotation.y = spring(t.y, yT, t.f, 0.35, dt);
    }
  }

  function setShadows(on) { for (const m of meshes) m.castShadow = on; }
  function dispose() { for (const g of owned) g.dispose(); if (root.parent) root.parent.remove(root); }
  return { root, update, dispose, setShadows };
}
