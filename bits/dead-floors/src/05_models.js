// Models: articulated zombies and bosses, first-person weapons, pickups.
const ZGEO = {};
const ZMAT = {};
function zombieAssets() {
  if (ZGEO.torso) return;
  ZGEO.torso = new THREE.CapsuleGeometry(0.17, 0.36, 5, 12);
  ZGEO.belly = new THREE.SphereGeometry(0.2, 14, 12);
  ZGEO.head = new THREE.SphereGeometry(0.12, 16, 12);
  ZGEO.jaw = new THREE.BoxGeometry(0.15, 0.05, 0.12);
  ZGEO.upperArm = new THREE.CapsuleGeometry(0.056, 0.24, 4, 8);
  ZGEO.foreArm = new THREE.CapsuleGeometry(0.048, 0.24, 4, 8);
  ZGEO.hand = new THREE.SphereGeometry(0.055, 8, 6);
  ZGEO.thigh = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
  ZGEO.shin = new THREE.CapsuleGeometry(0.064, 0.34, 4, 8);
  ZGEO.foot = new THREE.BoxGeometry(0.11, 0.07, 0.24);
  ZGEO.eye = new THREE.SphereGeometry(0.02, 6, 5);
  ZGEO.blade = new THREE.BoxGeometry(0.04, 0.3, 0.55);
  ZGEO.pustule = new THREE.SphereGeometry(0.08, 10, 8);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  ZMAT.skin = [std({ map: TEX.skin, color: 0xb6bea0, roughness: 0.75 }), std({ map: TEX.skin, color: 0xc8b8a4, roughness: 0.7 }), std({ map: TEX.skin, color: 0x9aa48a, roughness: 0.8 })];
  ZMAT.shirt = [0x56677a, 0x7a6a52, 0x8a8a80, 0x6a3a38, 0x3c4a34, 0x9a9488, 0x2f3540].map(c => std({ map: TEX.cloth, color: c, roughness: 0.95 }));
  ZMAT.pants = [0x2c3240, 0x3e3a32, 0x22242a, 0x4a4436].map(c => std({ map: TEX.cloth, color: c, roughness: 0.95 }));
  ZMAT.eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 0.8) });
  ZMAT.eyeRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) });
  ZMAT.eyeGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3, 0.3) });
  ZMAT.mouth = std({ color: 0x2a0806, roughness: 0.6 });
  ZMAT.butcherSkin = std({ map: TEX.skin, color: 0x8a7a70, roughness: 0.7 });
  ZMAT.apron = std({ map: TEX.cloth, color: 0x6a5c4e, roughness: 0.9 });
  ZMAT.broodSkin = std({ map: TEX.skin, color: 0x9ab07a, roughness: 0.5 });
  ZMAT.pustule = std({ color: 0x8ac040, emissive: 0x4a9a10, emissiveIntensity: 1.2, roughness: 0.3 });
  ZMAT.blade = std({ map: TEX.steel, color: 0xb8bcc0, roughness: 0.25, metalness: 0.9, envMap: envTex });
  ZMAT.spitSkin = std({ map: TEX.skin, color: 0xa8c070, roughness: 0.6 });
}

// type: walker | runner | brute | spitter | butcher | brood
function buildZombie(type) {
  zombieAssets();
  const m = (geo, mat, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent.add(o); return o; };
  const skin = type === 'butcher' ? ZMAT.butcherSkin : type === 'brood' ? ZMAT.broodSkin : type === 'spitter' ? ZMAT.spitSkin : pick(ZMAT.skin);
  const shirt = type === 'butcher' ? ZMAT.apron : pick(ZMAT.shirt);
  const pants = pick(ZMAT.pants);
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = m(ZGEO.torso, shirt, torso, 0, 0.3, 0); chest.scale.set(1.28, 1, 0.78);
  if (type === 'brood') { const b = m(ZGEO.belly, skin, torso, 0, 0.26, 0.06); b.scale.set(1.9, 1.7, 1.8); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; m(ZGEO.pustule, ZMAT.pustule, torso, Math.cos(a) * 0.32, 0.18 + (k % 3) * 0.12, 0.2 + Math.sin(a) * 0.22).scale.setScalar(0.6 + Math.random() * 0.6); } }
  const neck = new THREE.Group(); neck.position.y = 0.6; torso.add(neck);
  const head = m(ZGEO.head, skin, neck, 0, 0.11, 0.02); head.scale.set(0.95, 1.12, 1);
  const jaw = m(ZGEO.jaw, ZMAT.mouth, head, 0, -0.09, 0.05); jaw.rotation.x = 0.35;
  const eyeMat = type === 'butcher' ? ZMAT.eyeRed : type === 'brood' || type === 'spitter' ? ZMAT.eyeGreen : ZMAT.eye;
  m(ZGEO.eye, eyeMat, head, -0.045, 0.02, 0.105); m(ZGEO.eye, eyeMat, head, 0.045, 0.02, 0.105);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.25 * s, 0.53, 0); torso.add(sh);
    m(ZGEO.upperArm, Math.random() < 0.5 ? shirt : skin, sh, 0, -0.16, 0);
    const el = new THREE.Group(); el.position.y = -0.33; sh.add(el);
    m(ZGEO.foreArm, skin, el, 0, -0.15, 0);
    m(ZGEO.hand, skin, el, 0, -0.31, 0);
    if (type === 'butcher' && s === 1) { const bl = m(ZGEO.blade, ZMAT.blade, el, 0, -0.42, 0.18); bl.rotation.x = 0.2; }
    arms.push({ sh, el });
    const hp = new THREE.Group(); hp.position.set(0.11 * s, 0, 0); hips.add(hp);
    m(ZGEO.thigh, pants, hp, 0, -0.22, 0);
    const kn = new THREE.Group(); kn.position.y = -0.45; hp.add(kn);
    m(ZGEO.shin, pants, kn, 0, -0.22, 0);
    m(ZGEO.foot, ZMAT.mouth, kn, 0, -0.45, 0.05);
    legs.push({ hp, kn });
  }
  root.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
  return { root, hips, torso, neck, head, jaw, arms, legs, type };
}

// ---------- Weapons (first-person view models) ----------
const GMAT = {};
function gunAssets() {
  if (GMAT.metal) return;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  GMAT.metal = std({ color: 0x4a4f55, roughness: 0.34, metalness: 0.85, envMap: envTex, envMapIntensity: 1.6 });
  GMAT.steel = std({ map: TEX.steel, color: 0x9da2a8, roughness: 0.28, metalness: 0.95, envMap: envTex, envMapIntensity: 1.2 });
  GMAT.poly = std({ color: 0x2a2b2e, roughness: 0.6, metalness: 0.15, envMap: envTex, envMapIntensity: 0.8 });
  GMAT.wood = std({ map: TEX.crate, color: 0x8a5a32, roughness: 0.55, metalness: 0.05, envMap: envTex, envMapIntensity: 0.4 });
  GMAT.olive = std({ color: 0x4a5236, roughness: 0.6, metalness: 0.3, envMap: envTex, envMapIntensity: 0.5 });
  GMAT.glove = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
  GMAT.sleeve = new THREE.MeshLambertMaterial({ map: TEX.cloth, color: 0x3a4030 });
  GMAT.glowBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 3) });
  GMAT.glowGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 3, 0.8) });
  GMAT.glowPurple = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.6, 3) });
  GMAT.brass = std({ color: 0xb08a40, roughness: 0.3, metalness: 1, envMap: envTex });
  GMAT.red = std({ color: 0x7a1a12, roughness: 0.5, metalness: 0.3 });
}
// Build a gun from a compact description. Gun points down -Z; origin at the grip.
function buildGun(spec) {
  gunAssets();
  const g = new THREE.Group();
  const B = (w, h, l, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  const C = (r, l, mat, x, y, z, seg = 14, r2) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, l, seg), mat); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
  const S = spec;
  const body = S.bodyMat || GMAT.metal, furn = S.furn || GMAT.poly;
  const [rw, rh, rl] = S.rec;
  const ry = S.recY ?? 0.07;
  B(rw, rh, rl, body, 0, ry, -rl * 0.35);                         // receiver
  if (S.slide) B(rw * 1.05, rh * 0.45, rl * 0.98, GMAT.steel, 0, ry + rh * 0.5, -rl * 0.36);
  const front = -rl * 0.35 - rl / 2;
  const by = ry + (S.barrelY ?? 0);
  if (S.hand) B(S.hand[0], S.hand[1], S.hand[2], S.handMat || furn, 0, by - 0.005, front - S.hand[2] / 2);
  C(S.barrel[1], S.barrel[0], GMAT.steel, 0, by, front - S.barrel[0] / 2, 12);
  if (S.brake) C(S.barrel[1] * 1.7, 0.05, GMAT.metal, 0, by, front - S.barrel[0] - 0.02, 8);
  if (S.tube) C(S.tube, S.barrel[0] * 0.8, body, 0, by - S.barrel[1] - S.tube - 0.004, front - S.barrel[0] * 0.4, 12);
  B(0.035, 0.11, 0.05, furn, 0, ry - rh / 2 - 0.045, 0.02, 0.25);  // grip
  if (S.guard !== false) B(0.012, 0.012, 0.07, body, 0, ry - rh / 2 - 0.01, -0.04);
  if (S.mag === 'box') B(0.03, S.magLen || 0.12, 0.05, GMAT.metal, 0, ry - rh / 2 - (S.magLen || 0.12) / 2, -rl * 0.28, 0.08);
  if (S.mag === 'curve') { const a = B(0.032, 0.14, 0.055, GMAT.metal, 0, ry - rh / 2 - 0.06, -rl * 0.3, 0.25); a.material = S.magMat || GMAT.metal; }
  if (S.mag === 'drum') C(0.075, 0.06, GMAT.metal, 0, ry - rh / 2 - 0.07, -rl * 0.3, 18).rotation.set(0, 0, Math.PI / 2);
  if (S.mag === 'cyl') C(0.042, 0.06, GMAT.steel, 0, ry, -0.04, 10);
  if (S.stock) B(0.04, 0.07, S.stock, furn, 0, ry - 0.01, rl * 0.15 + S.stock / 2);
  if (S.scope) { C(0.024, 0.2, GMAT.metal, 0, ry + rh / 2 + 0.045, -rl * 0.3, 14); C(0.03, 0.03, GMAT.metal, 0, ry + rh / 2 + 0.045, -rl * 0.3 - 0.1, 14); B(0.02, 0.03, 0.02, GMAT.metal, 0, ry + rh / 2 + 0.015, -rl * 0.3); }
  else if (S.sight !== false) { B(0.008, 0.018, 0.008, GMAT.metal, 0, ry + rh / 2 + 0.009, front + 0.01); }
  if (S.coils) for (let k = 0; k < S.coils; k++) C(S.barrel[1] * 1.8, 0.014, S.glow, 0, by, front - 0.05 - k * (S.barrel[0] - 0.1) / Math.max(1, S.coils - 1), 12);
  if (S.glowStrip) B(rw + 0.004, 0.012, rl * 0.7, S.glow, 0, ry + 0.01, -rl * 0.35);
  if (S.cylinder) { const c = C(0.04, 0.06, GMAT.steel, 0, ry + 0.005, -0.06, 8); c.rotation.set(Math.PI / 2, 0, 0); }
  if (S.rocket) { C(S.barrel[1] * 0.85, 0.12, GMAT.olive, 0, by, front - S.barrel[0] + 0.02, 10, 0.001); }
  // Hands and sleeves, built between explicit joint points.
  const limb = (a, b, r0, r1, mat) => {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), len = d.length();
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), mat);
    o.position.copy(A).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(o); return o;
  };
  const gy = ry - rh / 2 - 0.04;
  B(0.052, 0.08, 0.09, GMAT.glove, 0.0, gy, 0.035, 0.25);
  limb([0.01, gy - 0.03, 0.07], [0.14, gy - 0.5, 0.95], 0.034, 0.06, GMAT.sleeve);
  if (S.twoHand) {
    const hz = front - S.twoHand;
    B(0.062, 0.05, 0.085, GMAT.glove, -0.012, by - 0.045, hz, 0);
    limb([-0.02, by - 0.06, hz + 0.02], [-0.3, by - 0.62, hz + 0.95], 0.033, 0.06, GMAT.sleeve);
  }
  const muzzle = new THREE.Vector3(0, by, front - S.barrel[0] - (S.brake ? 0.04 : 0.01));
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: g, muzzle };
}

// ---------- Pickups ----------
let pickupGeo = null;
function buildPickup(kind) {
  if (!pickupGeo) {
    pickupGeo = { ammo: new THREE.BoxGeometry(0.46, 0.24, 0.26), med: new THREE.BoxGeometry(0.38, 0.17, 0.27), weapon: new THREE.BoxGeometry(1.0, 0.34, 0.42), strip: new THREE.BoxGeometry(1.02, 0.04, 0.44) };
    const side = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.2 });
    MAT.ammoBox = [side(TEX.ammo), side(TEX.ammo), new THREE.MeshStandardMaterial({ color: 0x3a4226, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x3a4226, roughness: 0.6 }), side(TEX.ammo), side(TEX.ammo)];
    MAT.medBox = [side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med)];
    MAT.pickGlowA = new THREE.SpriteMaterial({ map: TEX.soft, color: 0xffd060, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    MAT.weaponBox = new THREE.MeshStandardMaterial({ map: TEX.crate, color: 0x6a7a6a, roughness: 0.7, metalness: 0.2 });
    MAT.weaponStrip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3) });
    MAT.pickGlowW = new THREE.SpriteMaterial({ map: TEX.soft, color: 0x60d0ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    MAT.pickGlowM = new THREE.SpriteMaterial({ map: TEX.soft, color: 0xff5050, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  const grp = new THREE.Group();
  const mesh = new THREE.Mesh(pickupGeo[kind], kind === 'med' ? MAT.medBox : kind === 'weapon' ? MAT.weaponBox : MAT.ammoBox);
  mesh.position.y = kind === 'weapon' ? 0.3 : 0.2;
  grp.add(mesh);
  if (kind === 'weapon') { const st = new THREE.Mesh(pickupGeo.strip, MAT.weaponStrip); mesh.add(st); }
  const glow = new THREE.Sprite(kind === 'med' ? MAT.pickGlowM : kind === 'weapon' ? MAT.pickGlowW : MAT.pickGlowA);
  const gs = kind === 'weapon' ? 2.4 : 1.2;
  glow.scale.set(gs, gs, 1); glow.position.y = 0.3;
  grp.add(glow);
  return { grp, mesh };
}
