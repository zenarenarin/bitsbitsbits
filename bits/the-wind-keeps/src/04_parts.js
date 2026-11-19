// Shared little people, creatures and props.
function createParts(THREE, P) {
  const X = {};
  const mat = P.mat({ brush: 0.06, scale: 6 });
  X.mat = mat;
  const mk = (geo, color, pos, parent, rot) => {
    const b = new P.Builder(color * 7 + 1); b.add(geo, color, { p: [0, 0, 0] }, { vary: 0, shade: 0.12 });
    const m = new THREE.Mesh(b.build(), mat); m.castShadow = true; if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); if (parent) parent.add(m); return m;
  };
  X.mk = mk;

  // The caretaker: a tiny figure in a slate coat and a straw hat.
  X.caretaker = (cols = {}) => {
    const g = new THREE.Group();
    const coat = cols.coat || 0x4f6478, skin = 0xe9c4a2, hatC = cols.hat || 0xe2c06e, trouser = 0x6b5546;
    const hips = new THREE.Group(); hips.position.y = 0.24; g.add(hips);
    const legL = mk(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6), trouser, [-0.045, -0.11, 0], hips);
    const legR = mk(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6), trouser, [0.045, -0.11, 0], hips);
    const torso = new THREE.Group(); hips.add(torso);
    mk(new THREE.CylinderGeometry(0.075, 0.1, 0.22, 8), coat, [0, 0.1, 0], torso);
    mk(new THREE.CylinderGeometry(0.11, 0.115, 0.07, 8), coat, [0, -0.02, 0], torso); // coat skirt
    const head = new THREE.Group(); head.position.y = 0.27; torso.add(head);
    mk(new THREE.SphereGeometry(0.065, 10, 8), skin, [0, 0, 0], head);
    mk(new THREE.SphereGeometry(0.02, 6, 4), 0xd9a98a, [0, -0.005, 0.064], head); // nose
    const hat = new THREE.Group(); hat.position.y = 0.045; head.add(hat);
    mk(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14), hatC, [0, 0, 0], hat);
    mk(new THREE.CylinderGeometry(0.05, 0.065, 0.06, 10), hatC, [0, 0.035, 0], hat);
    mk(new THREE.CylinderGeometry(0.066, 0.066, 0.015, 10), 0xd96f5c, [0, 0.012, 0], hat); // coral band
    const arm = (s) => { const a = new THREE.Group(); a.position.set(s * 0.09, 0.19, 0); torso.add(a); mk(new THREE.CapsuleGeometry(0.028, 0.15, 2, 6), coat, [0, -0.09, 0], a); mk(new THREE.SphereGeometry(0.026, 6, 4), skin, [0, -0.19, 0], a); return a; };
    const armL = arm(-1), armR = arm(1);
    const C = { group: g, hips, torso, head, hat, armL, armR, legL, legR, t: 0, pull: 0, look: 0, sit: 0, cheer: 0, hatOff: 0, walk: 0 };
    // pose blends; called every frame
    C.update = (dt) => {
      C.t += dt;
      const br = Math.sin(C.t * 2.1) * 0.012;
      torso.position.y = br - C.sit * 0.08;
      hips.position.y = 0.24 - C.sit * 0.12;
      legL.rotation.x = -C.sit * 1.3 + Math.sin(C.walk) * 0.6; legR.rotation.x = -C.sit * 1.3 - Math.sin(C.walk) * 0.6;
      // pulling the lever: lean back, both arms forward and down
      torso.rotation.x = -C.pull * 0.25 + C.sit * 0.15;
      armL.rotation.x = -1.1 * C.pull - C.cheer * 2.6 + Math.sin(C.walk) * 0.4; armR.rotation.x = -1.1 * C.pull - C.cheer * 2.4 - Math.sin(C.walk) * 0.4;
      armL.rotation.z = -0.15 - C.cheer * 0.3; armR.rotation.z = 0.15 + C.cheer * 0.3;
      head.rotation.y = C.look; head.rotation.x = -C.cheer * 0.3 - C.sit * 0.1;
      hat.visible = C.hatOff < 0.5;
    };
    return C;
  };

  // The lantern-bearer: a round, mossy creature that carries seeds of light.
  X.creature = () => {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    mk(new THREE.SphereGeometry(0.15, 14, 10), 0xf3ead6, [0, 0.17, 0], body).scale.set(1, 0.92, 0.95);
    const moss = mk(P.blob(0.1, 4, 1, 0.2), 0x7f9a52, [0, 0.27, -0.04], body); moss.scale.set(1.2, 0.6, 1.1);
    mk(new THREE.SphereGeometry(0.018, 6, 4), 0x2f2a2a, [-0.05, 0.2, 0.135], body);
    mk(new THREE.SphereGeometry(0.018, 6, 4), 0x2f2a2a, [0.05, 0.2, 0.135], body);
    mk(new THREE.SphereGeometry(0.022, 6, 4), 0xeaa38f, [0, 0.165, 0.15], body); // snout
    const earL = mk(new THREE.ConeGeometry(0.035, 0.12, 6), 0xf3ead6, [-0.08, 0.3, 0.02], body, [0, 0, 0.5]);
    const earR = mk(new THREE.ConeGeometry(0.035, 0.12, 6), 0xf3ead6, [0.08, 0.3, 0.02], body, [0, 0, -0.5]);
    const footL = mk(new THREE.SphereGeometry(0.04, 6, 4), 0xc9b79a, [-0.06, 0.03, 0.03], g);
    const footR = mk(new THREE.SphereGeometry(0.04, 6, 4), 0xc9b79a, [0.06, 0.03, 0.03], g);
    // the seed: a little golden lantern on a stalk
    const stalk = new THREE.Group(); stalk.position.set(0.11, 0.24, 0.05); body.add(stalk);
    mk(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 4), 0x6d5a3e, [0, 0.1, 0], stalk);
    const seedU = { value: 0.9 };
    const seedMat = P.mat({ brush: 0.02, scale: 4, emissiveU: seedU });
    const sb = new P.Builder(5); sb.add(new THREE.SphereGeometry(0.045, 10, 8), 0xf2c25a, {}, { vary: 0, shade: 0 });
    const seed = new THREE.Mesh(sb.build(), seedMat); seed.position.y = 0.22; stalk.add(seed);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd98a, transparent: true, depthWrite: false, opacity: 0.55 }));
    glow.scale.set(0.35, 0.35, 1); seed.add(glow);
    const C = { group: g, body, seed, stalk, glow, footL, footR, earL, earR, t: 0, walk: 0, hop: 0, hasSeed: true, look: 0 };
    C.update = (dt, moving) => {
      C.t += dt;
      if (moving) C.walk += dt * 11;
      const step = moving ? Math.abs(Math.sin(C.walk)) * 0.05 : 0;
      body.position.y = step + Math.sin(C.t * 2.6) * 0.008 + C.hop;
      footL.position.z = 0.03 + (moving ? Math.sin(C.walk) * 0.05 : 0); footR.position.z = 0.03 - (moving ? Math.sin(C.walk) * 0.05 : 0);
      body.rotation.z = moving ? Math.sin(C.walk) * 0.08 : Math.sin(C.t * 0.9) * 0.03;
      body.rotation.x = C.look;
      earL.rotation.z = 0.5 + Math.sin(C.t * 3.1) * 0.08; earR.rotation.z = -0.5 - Math.sin(C.t * 2.7) * 0.08;
      stalk.visible = C.hasSeed;
      seedU.value = 0.8 + Math.sin(C.t * 3) * 0.15;
    };
    return C;
  };

  // A flower that blooms when asked. Returns { group, set(t) }.
  X.flower = (petal = 0xe58a72, center = 0xf2c25a, s = 1) => {
    const g = new THREE.Group();
    const stem = mk(new THREE.CylinderGeometry(0.012 * s, 0.015 * s, 0.32 * s, 4), 0x6f8a55, [0, 0.16 * s, 0], g);
    const head = new THREE.Group(); head.position.y = 0.32 * s; g.add(head);
    const petals = [];
    for (let i = 0; i < 6; i++) { const p = new THREE.Group(); p.rotation.y = (i / 6) * TAU; head.add(p); const m = mk(new THREE.SphereGeometry(0.05 * s, 6, 4), petal, [0, 0, 0.06 * s], p); m.scale.set(0.7, 0.3, 1.2); petals.push(p); }
    mk(new THREE.SphereGeometry(0.035 * s, 8, 6), center, [0, 0.01, 0], head);
    const leaf = mk(new THREE.SphereGeometry(0.04 * s, 6, 4), 0x7d9152, [0.04 * s, 0.1 * s, 0], g); leaf.scale.set(1.4, 0.3, 0.7);
    const F = { group: g, v: 0 };
    F.set = (v) => {
      F.v = v;
      const grow = smooth(v * 2), open = easeOutBack(clamp(v * 2 - 1));
      stem.scale.y = 0.2 + grow * 0.8; head.position.y = 0.32 * s * (0.2 + grow * 0.8);
      head.scale.setScalar(0.4 + grow * 0.6);
      for (const p of petals) p.rotation.x = -1.3 + open * 1.15;
    };
    F.set(0);
    return F;
  };

  // A brass bell that swings when rung.
  X.bell = (s = 1) => {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2((0.05 + Math.pow(t, 1.8) * 0.13 + (t > 0.85 ? (t - 0.85) * 0.3 : 0)) * s, (0.28 - t * 0.28) * s)); }
    const swing = new THREE.Group(); g.add(swing);
    mk(new THREE.LatheGeometry(pts, 14), 0xc4a05a, [0, -0.3 * s, 0], swing);
    mk(new THREE.SphereGeometry(0.035 * s, 6, 4), 0x8a6a3a, [0, -0.32 * s, 0], swing);
    const B = { group: g, swing, a: 0, v: 0 };
    B.ring = (k = 1) => { B.v += 5 * k; };
    B.update = dt => { B.v += -B.a * 30 * dt - B.v * 1.2 * dt; B.a += B.v * dt; swing.rotation.z = B.a * 0.5; };
    return B;
  };
  return X;
}
