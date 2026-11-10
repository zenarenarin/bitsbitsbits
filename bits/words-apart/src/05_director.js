// The camera, treated as a cinematographer: a composed pose at each puzzle, and a different
// move for each descent. Poses are cylindrical around the shaft axis, relative to the slab:
//   th: angle, r: distance from the axis, h: height above the slab, lk: look height, lf: look lead
//   toward the monolith, fov.
function createDirector(THREE, W, camera) {
  const P = (th, r, h, lk, fov, lf) => ({ th, r, h, lk, fov, lf: lf || 0 });
  const MONO = W.MONO.th;
  const TITLE = P(0.95, 13, 19, -1.5, 52);
  const POSE = [
    P(0.65, 12.6, 6.5, 0.4, 50),
    P(2.3, 12.8, 6, 0.6, 52),
    P(1.25, 24, 9, -1, 52),
    P(3.0, 10.2, 3.6, 0.8, 58),
    P(MONO + Math.PI - 0.7 + Math.PI * 2, 22, 7, -4, 54, 3)
  ];
  const FINAL = P(MONO + Math.PI + 0.16 + Math.PI * 2, 60, 21, 9, 50, 18);
  // transition i goes from POSE[i] to POSE[i+1] (or FINAL); mids are the cinematic beats
  const MOVES = [
    { dur: 3.6, mids: [P(0.45, 11, 13, -6, 56)] },                                   // 1: down the lit shaft, looking along the column
    { dur: 4.0, mids: [P(1.95, 11.2, 5, 0, 54), P(1.62, 11.6, 1.5, 2, 52)] },         // 2: past the colossal bracket
    { dur: 4.8, mids: [P(1.7, 24, 9, -7, 58), P(2.5, 20, 7, -5, 58), P(2.9, 10, 4, 0, 58)] }, // 3: swing out over the cavern
    { dur: 4.2, mids: [P(3.5, 8.5, -6, 2.5, 62), P(4.4, 9.5, -3, 1, 60)] },             // 4: through the passage, looking up
    { dur: 7.2, mids: [P(MONO + Math.PI - 0.4 + Math.PI * 2, 22, 6, 0, 54, 6), P(MONO + Math.PI + Math.PI * 2, 42, 14, 5, 50, 12)] } // 5: pull back: the chamber
  ];
  // radius the camera may use at a given height (keeps it inside the architecture)
  function rMax(y) {
    if (y > 42) return 6; if (y > -44) return 13.2; if (y > -117) return 13.6;
    if (y > -200) return 40; if (y > -226) return lerp(10.6, 40, (y + 226) / 26); if (y > -312) return 10.6; return 112;
  }
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  function samplePath(keys, s) {
    const n = keys.length - 1, f = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n, i + 2)], o = {};
    for (const p of ['th', 'r', 'h', 'lk', 'fov', 'lf']) o[p] = cr(k0[p], k1[p], k2[p], k3[p], t);
    return o;
  }
  const D = {
    mode: 'title', from: null, move: null, t: 0, level: 0, pose: TITLE, slabY: W.STOPS[0], shift: 0.18, shiftTarget: 0.18,
    pos: new THREE.Vector3(), look: new THREE.Vector3(), idle: 0, introT: 0, introFrom: null
  };
  D.title = () => { D.mode = 'title'; D.level = 0; D.pose = TITLE; D.slabY = W.STOPS[0]; };
  D.intro = () => { D.mode = 'intro'; D.introT = 0; D.introFrom = Object.assign({}, D.cur || TITLE); };
  D.descend = level => { // level = index of the puzzle just solved
    D.mode = 'move'; D.t = 0; D.level = level;
    const from = Object.assign({}, D.cur || POSE[level]), to = level < 4 ? POSE[level + 1] : FINAL;
    D.move = { dur: MOVES[level].dur, keys: [from, ...MOVES[level].mids, to], y0: D.slabY, y1: level < 4 ? W.STOPS[level + 1] : W.FINAL_Y };
    return D.move.dur;
  };
  D.at = level => { D.mode = 'stop'; D.level = level; D.pose = POSE[level]; D.slabY = W.STOPS[level]; D.cur = POSE[level]; };
  D.reset = () => { D.mode = 'title'; D.pose = TITLE; D.slabY = W.STOPS[0]; D.cur = null; };
  let lastY = null, lastV = 0;
  D.update = (dt, aspect) => {
    D.idle += dt;
    let pose, y = D.slabY;
    if (D.mode === 'title') { pose = Object.assign({}, TITLE); pose.th += Math.sin(D.idle * 0.07) * 0.12; pose.h += Math.sin(D.idle * 0.11) * 0.8; }
    else if (D.mode === 'intro') {
      D.introT += dt; const s = easeInOutSine(D.introT / 2.6);
      pose = samplePath([D.introFrom, P(0.8, 12.8, 11, 0, 50), POSE[0]], s);
      if (D.introT >= 2.6) { D.mode = 'stop'; D.pose = POSE[0]; }
    } else if (D.mode === 'move') {
      const m = D.move; D.t += dt; const u = clamp(D.t / m.dur, 0, 1);
      // the slab: a slow release, a long glide, a soft landing
      y = lerp(m.y0, m.y1, smoother(u));
      pose = samplePath(m.keys, easeInOutSine(u));
      if (u >= 1) { D.mode = D.level < 4 ? 'stop' : 'final'; D.pose = D.level < 4 ? POSE[D.level + 1] : FINAL; W.S.land = 1; }
    } else {
      pose = Object.assign({}, D.pose);
      const a = D.mode === 'final' ? 0.6 : 1;
      pose.th += Math.sin(D.idle * 0.13) * 0.03 * a; pose.h += Math.sin(D.idle * 0.21) * 0.18 * a;
    }
    D.slabY = y; D.cur = pose;
    // slab velocity / acceleration for the lantern and the motes
    if (lastY !== null && dt > 0) { const v = (y - lastY) / dt; W.S.slabAcc = (v - lastV) / dt; W.S.slabVel = v; W.S.lean = clamp(-v / 30, -1, 1); lastV = v; }
    lastY = y; W.S.slabY = y; W.S.land = Math.max(0, W.S.land - dt * 2.5);
    // place the camera
    let r = Math.min(pose.r, rMax(y + pose.h));
    const cx = Math.cos(pose.th) * r, cz = Math.sin(pose.th) * r;
    D.pos.set(cx, y + pose.h, cz);
    const mdx = Math.cos(MONO), mdz = Math.sin(MONO);
    D.look.set(mdx * pose.lf, y + pose.lk, mdz * pose.lf);
    camera.position.copy(D.pos); camera.lookAt(D.look);
    // portrait screens get a narrower horizontal view, so widen the lens a little
    const fov = pose.fov * (aspect < 0.8 ? 1.12 : 1);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    D.shift = lerp(D.shift, D.shiftTarget, 1 - Math.exp(-dt * 2.5));
  };
  return D;
}
