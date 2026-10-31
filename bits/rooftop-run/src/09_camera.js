// =====================================================================
// The follow camera. Behind and above the cat, never orbiting.
//
// What it does, in order of importance:
//  1. Rides a smoothed ground reference, not the cat: a jump arc doesn't
//     bob the frame, but a new roof height is followed promptly.
//  2. Reads the terrain ahead (probes at fixed distances): pitches toward
//     drops and rises before the cat gets there, and when a gap is coming
//     it lifts and eases back so the landing surface is in frame.
//  3. Keeps the route in frame: sits partly toward the middle of the
//     surface the cat is on, so the next choice is visible.
//  4. Stays out of walls: pulls in along the cat-to-camera line when
//     something solid is in the way; thin things it can see past are faded.
//  5. Frames portrait and landscape differently (presets in TUNING).
// =====================================================================

function createFollowCamera(THREE, camera, world) {
  const T = TUNING.camera;
  const st = {
    pos: new THREE.Vector3(), look: new THREE.Vector3(), refY: 0, aheadY: 0, gap: 0, laneX: 0, pull: 1, dip: mkSpring(0),
    fov: 54, init: false, fade: new Set(), preset: 'auto', portraitK: 0
  };
  const want = new THREE.Vector3(), lookWant = new THREE.Vector3();

  function frame(portrait) {
    const k = st.portraitK = st.preset === 'auto' ? (portrait ? 1 : 0) : st.preset === 'portrait' ? 1 : 0;
    const a = T.landscape, b = T.portrait, o = {};
    for (const key in a) o[key] = lerp(a[key], b[key], k);
    return o;
  }

  // ground heights ahead of the cat; a missing or much lower probe is a gap
  function probe(cat) {
    let sum = 0, wsum = 0, gap = 0;
    for (let i = 0; i < T.terrainProbe.length; i++) {
      const d = T.terrainProbe[i], z = cat.pos[2] - d;
      const g = world.groundAt(cat.pos[0], z, cat.pos[1] + 1.5, 0.3, 0.3);
      const w = 1 / (1 + i);
      if (g.box && !g.box.far && g.y > cat.pos[1] - 3) { sum += g.y * w; wsum += w; if (g.y < st.refY - 0.6 && d < 10) gap = Math.max(gap, 0.5); }
      else if (d <= 10) gap = Math.max(gap, 1 - (d - T.terrainProbe[0]) / 10);
    }
    return { y: wsum ? sum / wsum : st.refY, gap };
  }

  function update(dt, cat, portrait, events) {
    const F = frame(portrait);
    const grounded = cat.grounded;
    // 1. ground reference
    if (!st.init) { st.refY = cat.pos[1]; st.aheadY = cat.pos[1]; st.laneX = cat.pos[0]; }
    const refTarget = grounded ? cat.pos[1] : Math.min(st.refY, cat.pos[1]);
    st.refY = damp(st.refY, refTarget, grounded ? T.heightK : T.airHeightK, dt);
    // 2. terrain ahead
    const p = probe(cat);
    st.aheadY = damp(st.aheadY, p.y, 2.5, dt);
    st.gap = damp(st.gap, p.gap, p.gap > st.gap ? 4 : 1.5, dt);
    // 3. lane: the middle of whatever is underfoot (or the cat, in the air)
    const g = grounded && cat.ground && !cat.ground.far ? cat.ground : null;
    const lane = g ? clamp((g.x0 + g.x1) / 2, cat.pos[0] - 1.6, cat.pos[0] + 1.6) : cat.pos[0];
    st.laneX = damp(st.laneX, lane, 1.5, dt);
    for (const e of events) if (e.type === 'land') st.dip.v -= clamp(e.impact, 0, 14) * T.landDip;
    spring(st.dip, 0, 2.2, 0.6, dt);

    const speed = cat.fwd;
    // the finale: rise and pull back so the beam to the tower fills the frame
    const fin = smooth(cat.finale || 0);
    const back = F.back + speed * T.speedBack + st.gap * T.gapBack + fin * 2.2;
    const up = F.up + st.gap * T.gapLift + fin * 1.4;
    const x = lerp(st.laneX, cat.pos[0], F.follow);
    // in the air, rise with a third of the arc: enough to keep looking down onto the landing
    const arc = grounded ? 0 : Math.max(0, cat.pos[1] - st.refY) * T.arcFollow;
    want.set(x, Math.max(st.refY, st.aheadY - 0.5) + up + arc + st.dip.x, cat.pos[2] + back);
    lookWant.set(lerp(x, cat.pos[0] + cat.vel[0] * 0.25, 0.6) + fin * 1.4, lerp(st.refY, st.aheadY, 0.55) + F.lookUp + 0.35 + fin * 7, cat.pos[2] - F.lookAhead - fin * 10);
    if (!st.init) { st.pos.copy(want); st.look.copy(lookWant); st.init = true; }
    st.pos.x = damp(st.pos.x, want.x, T.posK * 0.7, dt);
    st.pos.y = damp(st.pos.y, want.y, T.posK * 0.8, dt);
    st.pos.z = damp(st.pos.z, want.z, T.posK * 1.6, dt);
    st.look.x = damp(st.look.x, lookWant.x, T.lookK, dt);
    st.look.y = damp(st.look.y, lookWant.y, T.lookK * 0.6, dt);
    st.look.z = damp(st.look.z, lookWant.z, T.lookK * 2, dt);

    // 4. obstruction: pull in toward the cat; fade the thin things instead
    const o = [cat.pos[0], cat.pos[1] + 0.3, cat.pos[2]];
    const d = [st.pos.x - o[0], st.pos.y - o[1], st.pos.z - o[2]], dl = Math.hypot(d[0], d[1], d[2]);
    for (let i = 0; i < 3; i++) d[i] /= dl;
    const hit = world.ray(o, d, dl, b => b.cam === 'block' && !b.far);
    const pullT = hit < Infinity ? clamp((hit - T.nearClip) / dl, 0.25, 1) : 1;
    st.pull = pullT < st.pull ? pullT : damp(st.pull, pullT, 2.5, dt);
    st.fade.clear();
    // anticipate: anything thin between the camera and the next 1.5 m of the cat's path fades
    // before the cat goes under it, not once it is already hidden
    const ahead = o[2] - 1.5 - cat.fwd * 0.15;
    for (const b of world.overlaps(Math.min(o[0], st.pos.x) - 0.3, Math.max(o[0], st.pos.x) + 0.3, Math.min(o[1] - 0.3, st.pos.y), Math.max(o[1], st.pos.y) + 0.2, Math.min(ahead, st.pos.z), Math.max(o[2], st.pos.z))) if (b.cam === 'fade') st.fade.add(b.id);

    camera.position.set(o[0] + d[0] * dl * st.pull, o[1] + d[1] * dl * st.pull, o[2] + d[2] * dl * st.pull);
    camera.lookAt(st.look);
    const fov = F.fov + speed * T.speedFov * 0.5 + st.gap * 2;
    st.fov = damp(st.fov, fov, 3, dt);
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
  }
  function reset() { st.init = false; st.pull = 1; st.dip.x = st.dip.v = 0; }
  return { update, reset, st };
}
