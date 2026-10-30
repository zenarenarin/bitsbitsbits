// =====================================================================
// The cat: a procedural rig. Cat-local axes: +z forward, +y up, +x right.
// The spine runs hip -> shoulder; legs are two-bone IK chains solved in the
// cat's sagittal plane toward foot targets, so every pose stays grounded.
// Each cat owns its own controller: the reflection never reads the real
// cat's state, it is driven only by the director.
// =====================================================================

const SPINE = 0.2, FRONT = [0.105, 0.105], HIND = [0.1, 0.112], NECK = 0.1;

// Poses are targets, not keyframes: the controller springs toward them.
const POSES = {
  stand:  { hz: -0.1,  hy: 0.19,  pitch: 0.02, neck: 1.0,  hp: 0.05, ffl: [0.1, 0],   ffr: [0.1, 0],   hfl: [-0.11, 0], hfr: [-0.11, 0], tLift: 1.0,  tCurl: -1.5, tSide: 0.25, ears: 0,   haunch: 0 },
  sit:    { hz: -0.07, hy: 0.068, pitch: 0.8,  neck: 1.38, hp: 0.02, ffl: [0.075, 0], ffr: [0.075, 0], hfl: [0.0, 0],   hfr: [0.0, 0],   tLift: -0.35, tCurl: 0.5, tSide: 1.5, ears: 0,   haunch: 1 },
  crouch: { hz: -0.09, hy: 0.1,   pitch: -0.06, neck: 0.32, hp: -0.12, ffl: [0.15, 0], ffr: [0.15, 0],  hfl: [-0.05, 0], hfr: [-0.05, 0], tLift: -0.12, tCurl: 0.15, tSide: 0, ears: 0.65, haunch: 0.45 },
  paw:    { hz: -0.07, hy: 0.075, pitch: 0.86, neck: 1.36, hp: 0.32, ffl: [0.08, 0],  ffr: [0.15, 0.25], hfl: [0.0, 0], hfr: [0.0, 0], tLift: -0.25, tCurl: 0.4, tSide: 1.2, ears: 0.1, haunch: 1, roll: 0.25, pawX: 0.05 }
};
const KEYS = ['hz', 'hy', 'pitch', 'neck', 'hp', 'tLift', 'tCurl', 'tSide', 'ears', 'haunch', 'roll', 'pawX'];
const FEET = ['ffl', 'ffr', 'hfl', 'hfr'];
function blendPose(a, b, t) {
  const o = {};
  for (const k of KEYS) o[k] = lerp(a[k] || 0, b[k] || 0, t);
  for (const k of FEET) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  return o;
}
const clonePose = p => blendPose(p, p, 0);

// two-bone IK in the (z, y) plane. bend +1 puts the middle joint forward.
function ik2(az, ay, tz, ty, l1, l2, bend) {
  let dz = tz - az, dy = ty - ay, d = Math.hypot(dz, dy);
  const dmax = l1 + l2 - 1e-4, dmin = Math.abs(l1 - l2) + 1e-3;
  if (d > dmax) { dz *= dmax / d; dy *= dmax / d; d = dmax; }
  if (d < dmin) { d = dmin; }
  const a = Math.atan2(dy, dz);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ka = a + bend * A;
  const kz = az + Math.cos(ka) * l1, ky = ay + Math.sin(ka) * l1;
  return [kz, ky, az + dz, ay + dy];
}

function createCatMaterials(THREE) {
  const fur = new THREE.MeshPhysicalMaterial({ color: '#0c0a0a', roughness: 0.8, metalness: 0, sheen: 0.7, sheenColor: new THREE.Color('#54483f'), sheenRoughness: 0.5 });
  const furDark = new THREE.MeshPhysicalMaterial({ color: '#080707', roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color('#3c332d'), sheenRoughness: 0.6 });
  const nose = new THREE.MeshStandardMaterial({ color: '#2a1a1b', roughness: 0.5 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#030303', roughness: 0.2 });
  const whisker = new THREE.LineBasicMaterial({ color: '#8f877d', transparent: true, opacity: 0.55 });
  const earIn = new THREE.MeshStandardMaterial({ color: '#2b1f20', roughness: 0.9, side: THREE.DoubleSide });
  return { fur, furDark, nose, pupil, whisker, earIn };
}

function createCat(THREE, M, opts) {
  opts = opts || {};
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#b98a2e', emissive: new THREE.Color(opts.eyeGlow || '#6b4a10'), emissiveIntensity: opts.eyeIntensity || 0.35, roughness: 0.15 });
  const meshes = [];
  const add = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; (parent || rig).add(m); meshes.push(m); return m; };
  const sph = new THREE.SphereGeometry(1, 20, 14);
  const torso = add(sph, M.fur), chest = add(sph, M.fur), haunchL = add(sph, M.fur), haunchR = add(sph, M.fur);
  const neck = add(new THREE.CapsuleGeometry(0.036, 0.06, 4, 10), M.fur);
  // legs
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 8);
  const leg = (r1, l1, r2, l2) => ({ a: add(cap(r1, l1), M.fur), b: add(cap(r2, l2), M.furDark), paw: add(sph, M.furDark) });
  const legs = { ffl: leg(0.017, FRONT[0], 0.014, FRONT[1]), ffr: leg(0.017, FRONT[0], 0.014, FRONT[1]), hfl: leg(0.026, HIND[0], 0.015, HIND[1]), hfr: leg(0.026, HIND[0], 0.015, HIND[1]) };
  // head
  const head = new THREE.Group(); rig.add(head);
  const skull = add(sph, M.fur, head); skull.scale.set(0.052, 0.046, 0.05);
  const cheeks = add(sph, M.fur, head); cheeks.scale.set(0.05, 0.032, 0.036); cheeks.position.set(0, -0.016, 0.014);
  const muzzle = add(sph, M.fur, head); muzzle.scale.set(0.026, 0.018, 0.02); muzzle.position.set(0, -0.022, 0.04);
  const noseM = add(sph, M.nose, head); noseM.scale.set(0.008, 0.005, 0.005); noseM.position.set(0, -0.012, 0.058);
  const earGeo = new THREE.ConeGeometry(0.022, 0.05, 4, 1); earGeo.translate(0, 0.025, 0);
  const earInGeo = new THREE.ConeGeometry(0.014, 0.036, 3, 1, true); earInGeo.translate(0, 0.02, 0.004);
  const ears = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.028 * s, 0.034, -0.006); head.add(g);
    const e = add(earGeo, M.fur, g); e.scale.set(1, 1, 0.55);
    const ei = add(earInGeo, M.earIn, g); ei.scale.set(1, 1, 0.5);
    return { g, s, twitch: 0 };
  });
  const eyes = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.021 * s, 0.004, 0.04); g.rotation.y = 0.32 * s; head.add(g);
    const ball = add(sph, eyeMat, g); ball.scale.set(0.0125, 0.011, 0.007); ball.castShadow = false;
    const pu = add(sph, M.pupil, g); pu.scale.set(0.0028, 0.0095, 0.002); pu.position.z = 0.0058; pu.castShadow = false;
    return { g, pu };
  });
  {
    const pts = [];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const y = -0.02 - i * 0.004; pts.push(0.014 * s, y, 0.05, (0.075 + i * 0.004) * s, y + 0.008 - i * 0.008, 0.035 - i * 0.01); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    head.add(new THREE.LineSegments(g, M.whisker));
  }
  // tail: a chain of overlapping spheres
  const TN = 22, TSEG = 0.0142;
  const tail = [];
  for (let i = 0; i < TN; i++) { const m = add(sph, i > TN - 4 ? M.furDark : M.fur); const r = lerp(0.017, 0.0095, i / (TN - 1)); m.scale.set(r, r, r); tail.push(m); }
  // soft contact shadow, kept off the rig so jumps lift away from it
  const shadowTex = opts.shadowTex;
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.003; root.add(blob);

  // ---------- controller state ----------
  const C = {
    root, rig, head, meshes, eyeMat,
    base: 'stand', cur: clonePose(POSES.stand), target: clonePose(POSES.stand),
    k: opts.k || 15, jump: -1, jumpLen: 0.82, after: null, feint: 0, feintPose: null, dip: 0, tell: 0, shiver: 0,
    look: { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, hold: 0 },
    blink: 0, nextBlink: 1 + Math.random() * 3, stare: 0, walk: 0, walkPhase: 0, t: Math.random() * 10,
    rootY: 0, flinch: 0, intent: 0, busyUntil: 0, onStep: null
  };
  const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  function placeSeg(m, x1, y1, z1, x2, y2, z2) {
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    _d.set(x2 - x1, y2 - y1, z2 - z1).normalize();
    m.quaternion.setFromUnitVectors(_up, _d);
  }

  // ---------- actions ----------
  C.perform = function (a) {
    C.feint = 0;
    if (a === 'jump') {
      if (C.jump >= 0 && C.jump < 0.25) return; // already leaving the ground
      C.jump = 0; C.after = 'stand'; C.onStep && C.onStep('jump');
      return;
    }
    if (C.jump >= 0) { C.after = a; return; }
    if (a === C.base) C.dip = 1; // the same pose again still reads as a move
    C.base = a; C.onStep && C.onStep(a);
  };
  C.feintTo = function (a, dur) { if (C.jump >= 0) return; C.feintPose = a === 'jump' ? 'crouch' : a; C.feint = dur; C.feintDur = dur; };
  C.tellOf = function () { C.tell = 0.5; for (const e of ears) e.twitch = 1; };
  C.lookAt = function (yaw, pitch, hold) { C.look.tyaw = yaw; C.look.tpitch = pitch; C.look.hold = hold; };

  // the pose the controller wants right now
  function desired(dt) {
    let p = POSES[C.base] || POSES.stand;
    if (C.feint > 0) {
      // a feint commits a third of the way and recoils: no cue, a shudder
      const u = 1 - C.feint / C.feintDur;
      const amt = u < 0.45 ? smooth(u / 0.45) * 0.38 : 0.38 * (1 - smooth((u - 0.45) / 0.55));
      p = blendPose(p, POSES[C.feintPose] || p, amt);
      C.shiver = Math.max(C.shiver, u > 0.4 ? 1 : 0);
      C.feint -= dt;
    } else p = clonePose(p);
    if (C.dip > 0) { const d = Math.sin((1 - C.dip) * Math.PI); p.hy += 0.03 * d; p.pitch -= 0.18 * d; p.neck -= 0.15 * d; C.dip = Math.max(0, C.dip - dt / 0.32); }
    if (C.tell > 0) { const d = Math.sin((1 - C.tell / 0.5) * Math.PI); p.pitch += 0.06 * d; p.hp += 0.12 * d; C.tell -= dt; }
    if (C.jump >= 0) {
      const j = C.jump, L = C.jumpLen;
      const prep = 0.14, air = 0.46;
      const from = POSES[C.base] || POSES.stand;
      if (j < prep) {
        const u = smooth(j / prep);
        p = blendPose(from, POSES.crouch, u * 0.85); p.hy = lerp(from.hy, 0.11, u); C.rootY = 0;
      } else if (j < prep + air) {
        const u = (j - prep) / air;
        C.rootY = 0.3 * Math.sin(Math.PI * u);
        p = clonePose(POSES.stand);
        p.hy = 0.17; p.pitch = lerp(0.42, -0.3, u); p.neck = 0.9;
        p.ffl = [lerp(0.16, 0.13, u), lerp(0.1, -0.02, u)]; p.ffr = [lerp(0.15, 0.13, u), lerp(0.08, -0.02, u)];
        p.hfl = [lerp(-0.22, -0.13, u), lerp(0.06, 0.05, u)]; p.hfr = [lerp(-0.21, -0.12, u), lerp(0.05, 0.04, u)];
        p.tLift = lerp(0.2, 0.9, u); p.tCurl = -0.4; p.ears = 0.3;
      } else {
        const u = (j - prep - air) / (L - prep - air);
        C.rootY = 0; p = clonePose(POSES.stand); p.hy = lerp(0.14, 0.19, smooth(u)); p.pitch = lerp(-0.08, 0.02, u);
      }
      C.jump += dt;
      if (j < prep + air && C.jump >= prep + air) C.onStep && C.onStep('land');
      if (C.jump >= L) { C.jump = -1; C.rootY = 0; C.base = C.after || 'stand'; if (C.after && C.after !== 'stand') C.onStep && C.onStep(C.after); C.after = null; }
      C.k2 = 34;
    } else C.k2 = 0;
    if (C.walk > 0) {
      // escape gait: diagonal pairs, feet lifted on the forward swing
      const s = 0.07, lift = 0.035, ph = C.walkPhase;
      const f = (o, base) => { const a = ph + o * Math.PI; return [base + Math.sin(a) * s, Math.max(0, Math.cos(a)) * lift]; };
      p.ffl = f(0, 0.1); p.ffr = f(1, 0.1); p.hfl = f(1.5, -0.11); p.hfr = f(0.5, -0.11);
      p.hy += Math.sin(ph * 2) * 0.006; p.tLift = 0.7; p.tCurl = -0.6;
    }
    return p;
  }

  C.update = function (dt) {
    C.t += dt;
    const T = desired(dt);
    const k = C.k2 || C.k;
    const P = C.cur;
    for (const key of KEYS) P[key] = damp(P[key] || 0, T[key] || 0, k, dt);
    for (const key of FEET) { P[key][0] = damp(P[key][0], T[key][0], k, dt); P[key][1] = damp(P[key][1], T[key][1], k * 1.2, dt); }
    if (C.walk > 0) for (const key of FEET) { P[key][0] = T[key][0]; P[key][1] = T[key][1]; }
    rig.position.y = C.rootY;
    // breathing and life
    const br = Math.sin(C.t * 2.1) * 0.5 + 0.5;
    const hz = P.hz, hy = P.hy + br * 0.002;
    const sz = hz + Math.cos(P.pitch) * SPINE, sy = hy + Math.sin(P.pitch) * SPINE;
    // torso
    torso.position.set(0, (hy + sy) / 2 - 0.004, (hz + sz) / 2);
    torso.rotation.set(-P.pitch, 0, 0);
    torso.scale.set(0.058 + br * 0.002, 0.064 + br * 0.002 - P.haunch * 0.006, 0.15);
    chest.position.set(0, sy - 0.01, sz + 0.005); chest.scale.set(0.054, 0.066, 0.058);
    const hr = 0.06 + P.haunch * 0.016;
    haunchL.position.set(-0.03, hy - 0.006 + P.haunch * 0.004, hz + 0.004 + P.haunch * 0.01); haunchL.scale.set(0.04 + P.haunch * 0.006, hr, hr * 1.05);
    haunchR.position.set(0.03, haunchL.position.y, haunchL.position.z); haunchR.scale.copy(haunchL.scale);
    // legs
    const shz = sz - 0.005, shy = sy - 0.03, hpz = hz + 0.01, hpy = hy - 0.02;
    const solve = (key, x, az, ay, L, bend) => {
      const f = P[key], s = ik2(az, ay, f[0], f[1] + 0.012, L[0], L[1], bend), lg = legs[key];
      const x0 = key === 'ffr' ? 0.032 : x, xm = (x0 + x) / 2;
      placeSeg(lg.a, x0, ay, az, xm, s[1], s[0]);
      placeSeg(lg.b, xm, s[1], s[0], x, s[3], s[2]);
      lg.paw.position.set(x, s[3] - 0.004, s[2] + 0.008); lg.paw.scale.set(0.018, 0.012, 0.024);
    };
    solve('ffl', -0.032, shz, shy, FRONT, -1); solve('ffr', 0.032 + (P.pawX || 0), shz, shy, FRONT, -1);
    solve('hfl', -0.04, hpz, hpy, HIND, 1); solve('hfr', 0.04, hpz, hpy, HIND, 1);
    // head: blinks, glances, stares
    const L = C.look;
    if (L.hold > 0) L.hold -= dt; else { L.tyaw = 0; L.tpitch = 0; }
    L.yaw = damp(L.yaw, L.tyaw, 6, dt); L.pitch = damp(L.pitch, L.tpitch, 6, dt);
    const nx = sz + Math.cos(P.neck) * NECK * 0.25, ny = sy + 0.03 + Math.sin(P.neck) * NECK * 0.25;
    const hx = sz + Math.cos(P.neck) * NECK, hyy = sy + 0.02 + Math.sin(P.neck) * NECK;
    placeSeg(neck, 0, sy + 0.01, sz, 0, hyy - 0.02, hx - 0.01);
    head.position.set(0, hyy, hx);
    C.shiver = Math.max(0, C.shiver - dt * 3);
    const shv = C.shiver * Math.sin(C.t * 70) * 0.05;
    head.rotation.set(-(P.hp + L.pitch), L.yaw, (P.roll || 0) + shv, 'YXZ');
    for (const e of ears) {
      e.twitch = Math.max(0, e.twitch - dt * 4);
      const tw = Math.sin(e.twitch * 12) * 0.4 * e.twitch;
      e.g.rotation.set(-0.15 - P.ears * 0.9 + tw, 0.25 * e.s * (1 + P.ears), 0.32 * e.s + P.ears * 0.5 * e.s);
    }
    if (Math.random() < dt * 0.15) ears[Math.random() < 0.5 ? 0 : 1].twitch = 1;
    C.nextBlink -= dt;
    if (C.nextBlink <= 0) { C.blink = 1; C.nextBlink = 1.5 + Math.random() * 4; }
    C.blink = Math.max(0, C.blink - dt * 7);
    const lid = C.stare > 0 ? 1 : 1 - Math.sin(C.blink * Math.PI) * 0.92;
    for (const e of eyes) e.g.scale.set(1, lid, 1);
    // tail: base angle back-and-up, curling and swaying along its length
    let ang = Math.PI - P.tLift, side = 0, x = 0, z = hz - 0.07, y = hy + 0.01;
    const sway = Math.sin(C.t * 1.3) * 0.35, sway2 = Math.sin(C.t * 0.7 + 1) * 0.2;
    for (let i = 0; i < TN; i++) {
      const u = i / (TN - 1);
      tail[i].position.set(x, Math.max(0.009, y), z);
      ang += (P.tCurl / TN) * (0.4 + u * 1.4) * -1;
      side += (P.tSide / TN) * (0.6 + u) + (sway + sway2) * 0.06 * u * (1 - P.haunch * 0.7);
      const c = Math.cos(ang);
      z += c * Math.cos(side) * TSEG; x += c * Math.sin(side) * TSEG * (z < hz ? 1 : 1); y += Math.sin(ang) * TSEG;
      if (y < 0.01) { y = 0.01; }
    }
    blob.position.z = (hz + sz) / 2; const bs = 1 - C.rootY * 1.5; blob.scale.set(bs, bs, bs * 1.1); blob.material.opacity = 0.75 * bs;
    // escape gait advances with distance walked
    if (C.walk > 0) C.walkPhase += dt * 9 * C.walk;
  };
  C.reset = function () {
    C.base = 'stand'; C.cur = clonePose(POSES.stand); C.jump = -1; C.after = null; C.feint = 0; C.dip = 0; C.tell = 0; C.shiver = 0;
    C.rootY = 0; C.walk = 0; C.stare = 0; C.look.hold = 0; C.look.tyaw = 0; C.look.tpitch = 0;
  };
  return C;
}
