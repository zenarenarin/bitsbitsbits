// =====================================================================
// The traveller: a small dark figure in a long coat with a pale face and
// a lamp. Built from a few jointed parts and animated procedurally from
// the simulation's velocity, so movement reads: lean into acceleration,
// stride with speed, settle when stopping, head turned toward the gaze.
// =====================================================================

function buildPlayerView() {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(1.3); root.add(body);
  const coatM = hatchMat('coat', { vc: true, rim: 0.9 });
  const skin = hatchMat('flesh', { vc: true, color: '#e8dcc0', rim: 0.6 });
  const ink = new THREE.MeshLambertMaterial({ color: new THREE.Color('#1a1814') });
  // coat: a flared lathe that sways
  const prof = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.06 + 0.29 * Math.pow(1 - t, 0.9) + 0.03 * Math.sin(t * 9), 0.18 + t * 1.0)); }
  prof.push(new THREE.Vector2(0.001, 1.2));
  const coatG = ensureColor(new THREE.LatheGeometry(prof, 14));
  const coat = new THREE.Mesh(coatG, coatM); coat.castShadow = true; body.add(coat);
  // a hood/collar shadow and the head
  const head = new THREE.Group(); head.position.set(0, 1.25, 0); body.add(head);
  const skull = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(0.15, 14, 10)), skin); skull.scale.set(0.95, 1.12, 1); skull.castShadow = true; head.add(skull);
  const hood = new THREE.Mesh(ensureColor(new THREE.SphereGeometry(0.19, 14, 10, 0, TAU, 0, 1.9)), coatM); hood.rotation.x = -0.5; hood.position.set(0, 0.04, -0.04); head.add(hood);
  // two dark eye-marks on the face (it watches too)
  for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), ink); d.position.set(s * 0.055, 0.02, 0.135); head.add(d); }
  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.42, 0); body.add(hip);
    const leg = new THREE.Mesh(ensureColor(new THREE.CapsuleGeometry(0.05, 0.36, 3, 6)), ink); leg.position.y = -0.22; leg.castShadow = true; hip.add(leg);
    legs.push(hip);
  }
  // arms
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 1.02, 0); body.add(sh);
    const arm = new THREE.Mesh(ensureColor(new THREE.CapsuleGeometry(0.045, 0.42, 3, 6)), coatM); arm.position.y = -0.24; arm.castShadow = true; sh.add(arm);
    arms.push(sh);
  }
  // the lamp hangs from the right hand
  const lampG = new THREE.Group(); lampG.position.set(0, -0.5, 0.02); arms[1].add(lampG);
  const lampCore = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd48a') }));
  lampG.add(lampCore);
  const lampHalo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat('#f2b45a', { opacity: 0.22 }));
  lampG.add(lampHalo);
  const light = new THREE.PointLight(new THREE.Color('#ffc477'), 9, 9, 1.6);
  light.position.set(0, 1.1, 0.25); root.add(light);
  // a pool of warm light on the ground keeps the traveller readable from far away
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0.5 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uA; varying vec2 vP; void main(){ float r = length(vP) / 1.6; float a = (1.0 - smoothstep(0.0, 1.0, r)) * uA; gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a, a);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; root.add(pool);
  // a thin ink ring under the feet: where you stand, precisely
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#14110c'), transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; root.add(ring);
  return { root, body, head, legs, arms, coat, lampG, light, pool, ring, phase: 0, lean: 0, bob: 0, lastVel: [0, 0], headYaw: 0, flinch: 0, yaw: 0, settle: 0 };
}

function updatePlayerView(P, W, dt, gazeEye) {
  const S = W.player;
  P.root.position.set(S.pos[0], S.pos[1], S.pos[2]);
  const sp = Math.hypot(S.vel[0], S.vel[1]);
  const k = sp / PLAYER.speed;
  // facing: three yaw from simulation yaw (atan2(z, x)); figure's front is +z
  const fy = Math.PI / 2 - S.yaw;
  P.yaw = fy;
  P.body.rotation.y = fy;
  // stride
  P.phase += dt * (4 + 9 * k) * (k > 0.02 ? 1 : 0);
  const sw = Math.sin(P.phase) * 0.75 * Math.min(1, k * 1.3);
  P.legs[0].rotation.x = sw; P.legs[1].rotation.x = -sw;
  P.arms[0].rotation.x = -sw * 0.7; P.arms[1].rotation.x = sw * 0.35 - 0.1;
  // lean into acceleration, settle after stopping
  const ax = (S.vel[0] - P.lastVel[0]) / Math.max(dt, 1e-3), az = (S.vel[1] - P.lastVel[1]) / Math.max(dt, 1e-3);
  P.lastVel[0] = S.vel[0]; P.lastVel[1] = S.vel[1];
  const fwd = [Math.cos(S.yaw), Math.sin(S.yaw)];
  const accF = clamp((ax * fwd[0] + az * fwd[1]) / 40, -1, 1);
  P.lean = damp(P.lean, k * 0.22 + accF * 0.18, 10, dt);
  P.body.rotation.x = P.lean;
  P.bob = Math.abs(Math.sin(P.phase)) * 0.05 * k;
  P.body.position.y = P.bob;
  P.coat.rotation.z = Math.sin(P.phase * 0.5) * 0.04 * k;
  P.coat.scale.set(1 + 0.08 * k, 1, 1 + 0.1 * k);
  // head turns toward the eye you hold, within the neck's reach
  let hy = 0, hp = 0;
  if (gazeEye) {
    const dx = gazeEye.pos[0] - S.pos[0], dz = gazeEye.pos[2] - S.pos[2], dy = gazeEye.pos[1] - (S.pos[1] + 1.25);
    const world = Math.PI / 2 - Math.atan2(dz, dx);
    hy = clamp(wrapAngle(world - fy), -1.4, 1.4);
    hp = -clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.8);
  }
  P.headYaw = damp(P.headYaw, hy, 9, dt);
  P.head.rotation.set(damp(P.head.rotation.x, hp + P.flinch * 0.3, 9, dt), P.headYaw, 0);
  P.flinch = Math.max(0, P.flinch - dt * 3);
  // lamp sways
  P.lampG.rotation.z = Math.sin(W.t * 2.1) * 0.15 + sw * 0.2;
  // falling: arms up
  if (S.falling) { P.arms[0].rotation.x = -2.6; P.arms[1].rotation.x = -2.4; P.body.rotation.x = -0.3; }
  P.pool.material.uniforms.uA.value = 0.42 + 0.06 * Math.sin(W.t * 3.3);
}
