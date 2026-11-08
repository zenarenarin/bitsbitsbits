// =====================================================================
// The black cat from Blender (assets/cat.glb, built by blender/cat.py),
// driven by gameplay. Same interface as the procedural rig (08):
//   { root, update(dt, s), setShadows(on), dispose() }
//
// Clips: Idle, Run, Sprint, Balance, Crouch, Fall loop; Jump, Land,
// Recover are one-shots. Every loop plays continuously and its weight
// eases toward a target derived from the controller's state, so states
// blend instead of snapping:
//   grounded       speed blends Idle -> Run -> Sprint; speed sets the rate
//   thin pipe      Balance          low structure   Crouch (a crawl)
//   in the air     Jump plays once and holds its flight pose; after a
//                  while falling, Fall takes over
//   touchdown      Land (scaled by impact)   respawn   Recover
// On top, a few procedural overlays the clips cannot know: facing the
// velocity, leaning with steering, slopes and bridge sway, a landing
// squash, and the core's glow with the charge. The animation never feeds
// back into movement.
// =====================================================================

const CAT_ANIM = { runRef: 5.6, sprintRef: 7.2, balanceRef: 3.6, crawlRef: 3.0, fade: 9, fallAfter: 0.32 };

function createGlbCatRig(THREE, A, bytes) {
  // materials: rim-lit black fur, lit eyes, the shared glowing core
  const own = [];
  const make = (gm, o) => {
    const n = gm.name || '';
    if (n === 'Eye') return A.M.eye;
    if (n === 'Core') return A.M.core;
    const col = { Fur: '#0d0e12', EarInner: '#3b2730', Nose: '#2c2024', Collar: '#5e2a2a' }[n] || '#0d0e12';
    const m = n === 'Fur' || n === 'EarInner' ? A.rimmed(new THREE.MeshLambertMaterial({ color: col })) : new THREE.MeshLambertMaterial({ color: col });
    own.push(m); void o; return m;
  };
  const g = readGLB(THREE, bytes, make);
  const clips = {}; for (const c of g.animations) clips[c.name] = c;
  for (const need of ['Idle', 'Run', 'Sprint', 'Balance', 'Crouch', 'Fall', 'Jump', 'Land', 'Recover']) if (!clips[need]) throw new Error('cat.glb is missing clip ' + need);

  const root = new THREE.Group();         // at the paws, faces the velocity
  const body = new THREE.Group();         // lean, slope, squash
  root.add(body); body.add(g.scene);
  const meshes = g.meshes;
  for (const m of meshes) { m.castShadow = true; m.frustumCulled = false; }
  // the glow rides the neck bone, at the core's own rest position
  const coreGlow = new THREE.Sprite(A.M.coreGlow); coreGlow.scale.setScalar(0.08);
  const coreBone = g.scene.getObjectByName('neck'), coreMesh = meshes.find(m => m.material === A.M.core);
  if (coreBone && coreMesh) {
    g.scene.updateMatrixWorld(true);
    coreMesh.geometry.computeBoundingBox();
    const c = coreMesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(coreMesh.matrixWorld);
    coreBone.add(coreGlow); coreGlow.position.copy(coreBone.worldToLocal(c));
  }

  const mixer = new THREE.AnimationMixer(g.scene);
  const LOOPS = ['Idle', 'Run', 'Sprint', 'Balance', 'Crouch', 'Fall'];
  const act = {};
  for (const n of LOOPS) { const a = mixer.clipAction(clips[n]); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); act[n] = a; }
  for (const n of ['Jump', 'Land', 'Recover']) { const a = mixer.clipAction(clips[n]); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; act[n] = a; }
  const w = {}; for (const n in act) w[n] = act[n] === act.Idle ? 1 : 0;
  const one = { Jump: 0, Land: 0, Recover: 0 };   // one-shot envelopes

  const S = { yaw: mkSpring(0), lean: mkSpring(0), pitch: mkSpring(0), squash: mkSpring(0), air: 0, core: 0, flare: 0, time: 0 };
  function fire(name, weight) { const a = act[name]; a.reset(); a.play(); one[name] = weight; }

  function update(dt, s) {
    if (dt <= 0) return;
    S.time += dt;
    const grounded = s.grounded && s.scr === null;
    S.air = grounded ? 0 : S.air + dt;
    for (const e of s.events) {
      if (e.type === 'jump') fire('Jump', 1);
      else if (e.type === 'land') { if (e.impact > 3) fire('Land', clamp(e.impact / 9, 0.45, 1)); S.squash.v -= clamp(e.impact, 0, 14) * 0.05; }
      else if (e.type === 'respawn') fire('Recover', 1);
      else if (e.type === 'fragment') S.flare = 1;
      else if (e.type === 'scald') fire('Land', 0.8);
    }
    // target weights for the loops
    const speed = s.fwd, T = {};
    for (const n of LOOPS) T[n] = 0;
    if (!grounded) {
      if (S.air > CAT_ANIM.fallAfter && s.vy < -1.5) T.Fall = 1;
    } else if (s.crouch) T.Crouch = 1;
    else if (s.surf === 'balance') T.Balance = 1;
    else {
      const run = clamp(speed / 1.2, 0, 1), sprint = clamp((speed - CAT_ANIM.runRef) / (CAT_ANIM.sprintRef - CAT_ANIM.runRef), 0, 1);
      T.Idle = 1 - run; T.Run = run * (1 - sprint); T.Sprint = run * sprint;
    }
    // one-shots fade out as they finish; the jump holds while airborne
    one.Jump = !grounded && S.air < 1.2 && !(T.Fall > 0) ? Math.max(one.Jump, 0) : one.Jump * Math.exp(-dt * 10);
    if (act.Land.isRunning() === false) one.Land *= Math.exp(-dt * 8);
    if (act.Recover.isRunning() === false) one.Recover *= Math.exp(-dt * 6);
    const oneSum = Math.min(1, one.Jump + one.Land + one.Recover);
    for (const n of LOOPS) { w[n] = damp(w[n], T[n], CAT_ANIM.fade, dt); act[n].setEffectiveWeight(w[n] * (1 - oneSum)); }
    // an airborne cat with no jump in progress (ran off an edge) uses Fall's pose early
    if (!grounded && one.Jump < 0.05 && T.Fall === 0) act.Fall.setEffectiveWeight(clamp(S.air * 4, 0, 1) * (1 - oneSum));
    for (const n in one) act[n].setEffectiveWeight(one[n]);
    // playback rate follows the cat's real speed
    act.Run.timeScale = clamp(speed / CAT_ANIM.runRef, 0.4, 1.5);
    act.Sprint.timeScale = clamp(speed / CAT_ANIM.sprintRef, 0.6, 1.4);
    act.Balance.timeScale = clamp(speed / CAT_ANIM.balanceRef, 0.15, 1.3);
    act.Crouch.timeScale = clamp(speed / CAT_ANIM.crawlRef, 0.15, 1.3);
    mixer.update(dt);

    // procedural overlays
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    root.rotation.y = spring(S.yaw, Math.atan2(-s.vx, Math.max(0.5, speed)) * 0.85, 3.5, 0.9, dt);
    const slopeRoll = grounded ? Math.atan(s.slope[0]) * 0.7 : 0;
    spring(S.lean, clamp(-s.vx * 0.06, -0.28, 0.28) + slopeRoll + (s.surf === 'bridge' ? s.sway * 1.6 : 0) + s.teeter * Math.sin(S.time * 9) * 0.15, 3, 0.6, dt);
    spring(S.pitch, grounded ? -Math.atan(s.slope[1]) * 0.75 : clamp(s.vy * 0.03, -0.25, 0.2), 3.2, 0.55, dt);
    spring(S.squash, 0, 3.5, 0.45, dt);
    body.rotation.set(S.pitch.x, 0, S.lean.x);
    body.position.y = S.squash.x * 0.5;
    body.scale.set(1 - S.squash.x * 0.3, 1 + S.squash.x * 0.6, 1 - S.squash.x * 0.2);
    // the core: brighter with every fragment, flaring when one is taken
    S.core = damp(S.core, s.charge, 4, dt); S.flare = Math.max(0, S.flare - dt * 1.4);
    const glow = 0.35 + 0.12 * Math.min(S.core, 5) + 0.6 * S.flare + 0.05 * Math.sin(S.time * 4);
    A.M.core.color.setRGB(0.25 + 0.2 * glow, 0.7 + 0.3 * glow, 0.45 + 0.2 * glow);
    coreGlow.scale.setScalar(0.06 + 0.02 * Math.min(S.core, 5) + 0.16 * S.flare);
    A.M.coreGlow.opacity = clamp(0.45 + 0.08 * Math.min(S.core, 5) + 0.4 * S.flare, 0, 1);
  }
  function setShadows(on) { for (const m of meshes) m.castShadow = on; }
  function dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(g.scene);
    for (const m of meshes) m.geometry.dispose();
    for (const m of own) m.dispose();
    if (root.parent) root.parent.remove(root);
  }
  return { root, update, setShadows, dispose, mixer, clips: Object.keys(clips), tris: meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0), bones: meshes[0] && meshes[0].skeleton ? meshes[0].skeleton.bones.length : 0 };
}
