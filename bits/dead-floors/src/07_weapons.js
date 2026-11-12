// Weapons: one new gun per floor for the first twelve floors, then Mk upgrades.
const WEAPONS = [
  { id: 'pistol', name: 'COMBAT PISTOL', auto: false, rate: 0.16, dmg: 34, mag: 12, start: 48, reload: 1.15, spread: 0.012, sfx: 'pistol', recoil: 0.03, kick: 0.05, pos: [0.17, -0.17, -0.38],
    model: { rec: [0.04, 0.05, 0.19], slide: true, barrel: [0.03, 0.009], mag: 'none', sight: true } },
  { id: 'magnum', name: '.44 MAGNUM', auto: false, rate: 0.42, dmg: 105, pierce: 1, mag: 6, start: 18, reload: 1.9, spread: 0.006, sfx: 'magnum', recoil: 0.085, kick: 0.09, pos: [0.17, -0.17, -0.4],
    model: { rec: [0.045, 0.06, 0.13], barrel: [0.17, 0.016], mag: 'none', cylinder: true, bodyMat: 'steel', furn: 'wood' } },
  { id: 'smg', name: 'COMPACT SMG', auto: true, rate: 0.068, dmg: 20, mag: 32, start: 96, reload: 1.5, spread: 0.032, sfx: 'smg', recoil: 0.011, kick: 0.025, pos: [0.17, -0.19, -0.42],
    model: { rec: [0.05, 0.07, 0.26], barrel: [0.07, 0.012], mag: 'box', magLen: 0.16, stock: 0.12, brake: true, twoHand: 0.06 } },
  { id: 'shotgun', name: 'PUMP SHOTGUN', auto: false, rate: 0.78, dmg: 17, pellets: 9, mag: 6, start: 18, reload: 2.1, spread: 0.085, sfx: 'shotgun', recoil: 0.1, kick: 0.12, pos: [0.17, -0.2, -0.46],
    model: { rec: [0.05, 0.07, 0.22], barrel: [0.42, 0.016], hand: [0.055, 0.05, 0.16], handMat: 'wood', tube: 0.013, stock: 0.22, furn: 'wood', twoHand: 0.12, mag: 'none' } },
  { id: 'rifle', name: 'ASSAULT RIFLE', auto: true, rate: 0.1, dmg: 36, mag: 30, start: 90, reload: 1.9, spread: 0.02, sfx: 'rifle', recoil: 0.016, kick: 0.035, pos: [0.17, -0.2, -0.46],
    model: { rec: [0.05, 0.075, 0.3], barrel: [0.3, 0.012], hand: [0.055, 0.055, 0.2], handMat: 'wood', mag: 'curve', stock: 0.22, furn: 'wood', brake: true, twoHand: 0.12 } },
  { id: 'autoshot', name: 'AUTO SHOTGUN', auto: true, rate: 0.27, dmg: 18, pellets: 8, mag: 10, start: 30, reload: 2.4, spread: 0.08, sfx: 'shotgun', recoil: 0.07, kick: 0.09, pos: [0.17, -0.21, -0.46],
    model: { rec: [0.07, 0.09, 0.3], barrel: [0.3, 0.02], hand: [0.065, 0.06, 0.16], mag: 'drum', stock: 0.2, brake: true, twoHand: 0.12, bodyMat: 'olive' } },
  { id: 'dmr', name: 'MARKSMAN RIFLE', auto: false, rate: 0.3, dmg: 140, pierce: 2, mag: 10, start: 30, reload: 2.0, spread: 0.003, sfx: 'dmr', recoil: 0.05, kick: 0.07, pos: [0.17, -0.2, -0.48],
    model: { rec: [0.05, 0.075, 0.32], barrel: [0.42, 0.012], hand: [0.055, 0.05, 0.22], mag: 'box', scope: true, stock: 0.25, brake: true, twoHand: 0.14, bodyMat: 'olive' } },
  { id: 'hmg', name: 'HEAVY MACHINE GUN', auto: true, rate: 0.065, dmg: 32, mag: 100, start: 200, reload: 3.0, spread: 0.045, sfx: 'hmg', recoil: 0.013, kick: 0.03, pos: [0.18, -0.23, -0.5],
    model: { rec: [0.08, 0.1, 0.36], barrel: [0.4, 0.018], hand: [0.075, 0.065, 0.18], mag: 'drum', stock: 0.2, brake: true, twoHand: 0.12 } },
  { id: 'rail', name: 'RAILGUN', auto: false, rate: 1.0, dmg: 420, pierce: 99, beam: true, mag: 4, start: 12, reload: 2.4, spread: 0, sfx: 'rail', recoil: 0.07, kick: 0.1, pos: [0.17, -0.21, -0.5],
    model: { rec: [0.07, 0.09, 0.34], barrel: [0.38, 0.02], mag: 'box', coils: 4, glow: 'blue', glowStrip: true, stock: 0.18, twoHand: 0.14 } },
  { id: 'plasma', name: 'PLASMA RIFLE', auto: true, rate: 0.1, dmg: 55, splash: 1.5, splashDmg: 28, proj: 'plasma', speed: 34, mag: 40, start: 120, reload: 2.0, spread: 0.012, sfx: 'plasma', recoil: 0.012, kick: 0.03, pos: [0.17, -0.21, -0.48],
    model: { rec: [0.075, 0.09, 0.3], barrel: [0.22, 0.025], mag: 'box', coils: 3, glow: 'green', glowStrip: true, twoHand: 0.1 } },
  { id: 'rocket', name: 'ROCKET LAUNCHER', auto: false, rate: 0.95, dmg: 320, splash: 4.2, splashDmg: 260, proj: 'rocket', speed: 22, mag: 4, start: 12, reload: 2.6, spread: 0, sfx: 'rocket', recoil: 0.09, kick: 0.12, pos: [0.2, -0.17, -0.42],
    model: { rec: [0.13, 0.13, 0.3], recY: 0.1, barrel: [0.5, 0.06], mag: 'none', rocket: true, bodyMat: 'olive', twoHand: 0.2, sight: false } },
  { id: 'tesla', name: 'TESLA CANNON', auto: true, rate: 0.15, dmg: 72, chain: 3, mag: 30, start: 90, reload: 2.2, spread: 0, sfx: 'tesla', recoil: 0.01, kick: 0.025, pos: [0.18, -0.22, -0.48],
    model: { rec: [0.09, 0.1, 0.3], barrel: [0.26, 0.03], mag: 'none', coils: 5, glow: 'purple', glowStrip: true, twoHand: 0.12 } },
];
const WBY = {}; WEAPONS.forEach((w, i) => { WBY[w.id] = w; w.index = i; });
const gunModels = {};
function gunModel(w) {
  if (gunModels[w.id]) return gunModels[w.id];
  gunAssets();
  const s = { ...w.model };
  const matOf = (k) => k === 'wood' ? GMAT.wood : k === 'steel' ? GMAT.steel : k === 'olive' ? GMAT.olive : undefined;
  if (s.bodyMat) s.bodyMat = matOf(s.bodyMat);
  if (s.furn) s.furn = matOf(s.furn);
  if (s.handMat) s.handMat = matOf(s.handMat);
  if (s.glow) s.glow = s.glow === 'blue' ? GMAT.glowBlue : s.glow === 'green' ? GMAT.glowGreen : GMAT.glowPurple;
  const m = buildGun(s);
  m.group.visible = false;
  gunRoot.add(m.group);
  gunModels[w.id] = m;
  return m;
}

// View-model state.
let gunRoot = null, muzzleSprite = null, gunLight = null, gunHemi = null;
const VM = { cur: null, kickZ: 0, kickR: 0, swap: 0, swapTarget: 0, bobT: 0, flashT: 0, reloadAnim: 0 };
const W = { cool: 0, reloading: false, reloadT: 0, switching: 0, pendingSwitch: null };

function initGunScene() {
  gunScene = new THREE.Scene();
  gunCam = new THREE.PerspectiveCamera(74, 1, 0.01, 10);
  gunHemi = new THREE.HemisphereLight(0xc8d4e8, 0x3a3028, 1.0);
  gunScene.add(gunHemi);
  const key = new THREE.DirectionalLight(0xfff0dd, 2.6); key.position.set(-0.5, 1, 0.6); gunScene.add(key);
  const rim = new THREE.DirectionalLight(0x9aa8ff, 1.2); rim.position.set(1, 0.4, -1); gunScene.add(rim);
  gunLight = new THREE.PointLight(0xffb060, 0, 3, 2); gunScene.add(gunLight);
  gunRoot = new THREE.Group(); gunScene.add(gunRoot);
  const sm = new THREE.SpriteMaterial({ map: TEX.flash, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  muzzleSprite = new THREE.Sprite(sm); muzzleSprite.visible = false; muzzleSprite.renderOrder = 5;
  gunScene.add(muzzleSprite);
}

function weaponDmgMul() { return RUN.mk > 0 ? 1 + 0.15 * RUN.mk : 1; }
function curW() { return WBY[RUN.owned[RUN.cur]]; }
function ammoOf(id) { return RUN.ammo[id] || (RUN.ammo[id] = { mag: 0, res: 0 }); }
function hasAmmo(id) { const a = ammoOf(id); return a.mag + a.res > 0; }
function magSize(w) { return Math.round(w.mag * (RUN.mk > 0 ? 1 + 0.1 * RUN.mk : 1)); }

function giveWeapon(id) {
  const w = WBY[id];
  if (!RUN.owned.includes(id)) RUN.owned.push(id);
  const a = ammoOf(id);
  // Found guns come with one magazine and half a spare: ammo stays scarce.
  a.mag = Math.max(a.mag, magSize(w));
  a.res = Math.max(a.res, Math.ceil(magSize(w) * 0.5));
  equip(RUN.owned.indexOf(id), true);
}
function equip(index, instant) {
  RUN.cur = index;
  W.reloading = false; W.cool = 0.25;
  const w = curW();
  for (const k in gunModels) gunModels[k].group.visible = false;
  const m = gunModel(w);
  m.group.visible = true;
  VM.cur = m;
  VM.swap = instant ? 1 : 0;
  hud.dirty = true;
}
function cycleWeapon() {
  if (RUN.owned.length < 2 || mode !== 'play') return;
  for (let k = 1; k <= RUN.owned.length; k++) {
    const idx = (RUN.cur + k) % RUN.owned.length;
    if (hasAmmo(RUN.owned[idx]) || k === RUN.owned.length) { equip(idx, false); play('click', 0.6); return; }
  }
}
function startReload() {
  const w = curW(), a = ammoOf(w.id);
  if (W.reloading || a.res <= 0 || a.mag >= magSize(w)) return;
  W.reloading = true; W.reloadT = w.reload;
  play('reload', 0.8);
}

// Pick the best target near the crosshair for aim assist.
let _fw, _tmp, _dir, _up, _right;
function initWeaponTemps() { _fw = new THREE.Vector3(); _tmp = new THREE.Vector3(); _dir = new THREE.Vector3(); _up = new THREE.Vector3(); _right = new THREE.Vector3(); }
function assistTarget(maxAngle, maxDist) {
  camera.getWorldDirection(_fw);
  let best = null, bestA = maxAngle;
  for (const z of zombies) {
    if (z.dead || z.spawnT > 0) continue;
    const hd = Math.hypot(z.x - P.x, z.z - P.z);
    if (hd > maxDist) continue;
    for (const part of [0, 1]) {
      const y = part === 0 ? z.hy : z.chestY;
      const tx = part === 0 ? z.hx : z.x, tz = part === 0 ? z.hz : z.z;
      _tmp.set(tx - camera.position.x, y - camera.position.y, tz - camera.position.z);
      const d = _tmp.length();
      const a = Math.acos(clamp(_tmp.dot(_fw) / d, -1, 1));
      // Allow a wider cone for big targets close by.
      const lim = bestA + (part === 1 ? Math.atan2(z.radius * 0.6, d) : 0);
      if (a < lim && losClear(P.x, P.z, z.x, z.z)) { best = { z, x: tx, y, zz: tz, a }; bestA = a; }
    }
  }
  return best;
}

function fire() {
  const w = curW(), a = ammoOf(w.id);
  if (a.mag <= 0) {
    if (a.res > 0) startReload();
    else {
      play('click', 0.7, 150);
      W.cool = 0.3;
      const next = RUN.owned.findIndex(id => hasAmmo(id));
      if (next >= 0) equip(next, false);
    }
    return;
  }
  a.mag--;
  W.cool = w.rate;
  hud.dirty = true;
  const mul = weaponDmgMul();
  camera.updateMatrixWorld();
  camera.getWorldDirection(_fw);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const assist = assistTarget(0.04 * tune('aim_assist', 1), 30);
  const base = new THREE.Vector3().copy(_fw);
  if (assist && !w.pellets) {
    base.set(assist.x - camera.position.x, assist.y - camera.position.y, assist.zz - camera.position.z).normalize();
  }
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  // World-space muzzle for tracers.
  const mz = new THREE.Vector3(0.16 * clamp(camera.aspect * 1.15, 0.5, 1), -0.14, -0.7).applyQuaternion(camera.quaternion).add(camera.position);
  const moving = Math.hypot(P.vx, P.vz) > 0.5 ? 1.4 : 1;
  if (w.proj) {
    const spr = w.spread * moving;
    _dir.copy(base).addScaledVector(_right, rnd(-spr, spr)).addScaledVector(_up, rnd(-spr, spr)).normalize();
    spawnProjectile(w.proj, mz.x, mz.y, mz.z, _dir.x * w.speed, _dir.y * w.speed, _dir.z * w.speed, w.dmg * mul, w.splash, w.splashDmg * mul, 'player');
  } else if (w.chain) {
    const t = assistTarget(0.16, 22);
    if (t) {
      let cur = t.z, cy = t.y, from = [mz.x, mz.y, mz.z];
      const hitSet = new Set();
      for (let c = 0; c <= w.chain && cur; c++) {
        hitSet.add(cur);
        addArc(from[0], from[1], from[2], cur.x, cy, cur.z);
        damageZombie(cur, w.dmg * mul * (c === 0 ? 1 : 0.7), _fw.x, _fw.z, false, cur.x, cy, cur.z);
        from = [cur.x, cy, cur.z];
        let nxt = null, nd = 6;
        for (const z of zombies) { if (z.dead || hitSet.has(z)) continue; const d = Math.hypot(z.x - cur.x, z.z - cur.z); if (d < nd && losClear(cur.x, cur.z, z.x, z.z)) { nd = d; nxt = z; } }
        cur = nxt; cy = nxt ? nxt.chestY : 0;
      }
    } else {
      const h = rayWorld(ox, oy, oz, _fw.x, _fw.y, _fw.z, 14);
      addArc(mz.x, mz.y, mz.z, ox + _fw.x * h.t, oy + _fw.y * h.t, oz + _fw.z * h.t);
      if (h.t < 14) wallImpact(ox + _fw.x * h.t, oy + _fw.y * h.t, oz + _fw.z * h.t, h.nx, h.ny, h.nz, h.prop);
    }
  } else {
    const n = w.pellets || 1;
    for (let p = 0; p < n; p++) {
      const spr = w.spread * (n > 1 ? 1 : moving);
      const ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * spr;
      _dir.copy(base).addScaledVector(_right, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();
      hitscan(ox, oy, oz, _dir.x, _dir.y, _dir.z, w, mul, mz, p === 0 || n < 4 || p % 2 === 0);
    }
  }
  // Feedback.
  play(w.sfx, w.id === 'smg' || w.id === 'hmg' ? 0.55 : 0.8, 20);
  alertZombies(P.x, P.z, w.id === 'tesla' || w.id === 'plasma' ? 12 : 20);
  VM.kickZ += w.kick; VM.kickR += w.kick * 2.2;
  P.pitch = clamp(P.pitch + w.recoil * rnd(0.7, 1), -1.35, 1.35);
  P.yaw += w.recoil * rnd(-0.3, 0.3);
  P.recoilBack += w.recoil * 0.8;
  VM.flashT = w.beam || w.chain ? 0.02 : 0.05;
  if (!w.chain && !w.beam) {
    FX.flashLight.position.copy(mz);
    FX.flashLight.color.set(w.proj === 'plasma' ? 0x60ff90 : 0xffb060);
    FX.flashLight.intensity = w.proj === 'plasma' ? 14 : 36;
  }
  if (w.auto) { if ((RUN.shots = (RUN.shots || 0) + 1) % 3 === 0) haptic('light'); } else haptic(w.kick > 0.08 ? 'medium' : 'light');
  hud.xhairKick = Math.min(1, hud.xhairKick + 0.35 + w.recoil * 4);
}

function hitscan(ox, oy, oz, dx, dy, dz, w, mul, mz, tracer) {
  const wall = rayWorld(ox, oy, oz, dx, dy, dz, 60);
  const wallT = wall.t, wnx = wall.nx, wny = wall.ny, wnz = wall.nz, wprop = wall.prop;
  const hits = [];
  for (const z of zombies) {
    if (z.dead || z.spawnT > 0) continue;
    const t = rayZombie(z, ox, oy, oz, dx, dy, dz, wallT);
    if (t) hits.push(t);
  }
  hits.sort((a, b) => a.t - b.t);
  let pierce = w.pierce || 0, endT = wallT, stopped = false;
  for (const h of hits) {
    const hx = ox + dx * h.t, hy = oy + dy * h.t, hz = oz + dz * h.t;
    let dmg = w.dmg * mul * (h.head ? 2.5 : 1);
    if (w.pellets && h.t > 10) dmg *= 0.6;
    damageZombie(h.z, dmg, dx, dz, h.head, hx, hy, hz);
    // Blood sprays onto the surface behind.
    const back = rayWorld(hx, hy, hz, dx, dy * 0.5 - 0.3, dz, 2.6);
    if (back.t < 2.6 && Math.random() < 0.7) addDecal('blood', hx + dx * back.t, hy + (dy * 0.5 - 0.3) * back.t, hz + dz * back.t, back.nx, back.ny, back.nz, rnd(0.4, 1.0), Math.random() * TAU, rint(0, 2));
    if (pierce-- <= 0) { endT = h.t; stopped = true; break; }
  }
  const ex = ox + dx * endT, ey = oy + dy * endT, ez = oz + dz * endT;
  if (!stopped && wallT < 60) wallImpact(ex, ey, ez, wnx, wny, wnz, wprop);
  if (w.beam) addBeam(mz.x, mz.y, mz.z, ox + dx * wallT, oy + dy * wallT, oz + dz * wallT);
  else if (tracer && Math.random() < 0.75) addTracer(mz.x, mz.y, mz.z, ex, ey, ez);
}
// Ray against a zombie's head sphere and body capsule (vertical).
function rayZombie(z, ox, oy, oz, dx, dy, dz, maxT) {
  let best = null;
  // head
  {
    const cx = z.hx - ox, cy = z.hy - oy, cz = z.hz - oz, r = z.headR;
    const b = cx * dx + cy * dy + cz * dz, c = cx * cx + cy * cy + cz * cz - r * r;
    const disc = b * b - c;
    if (disc >= 0) { const t = b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { z, t, head: true }; }
  }
  // body
  {
    const h2 = dx * dx + dz * dz;
    if (h2 > 1e-8) {
      const cx = z.x - ox, cz = z.z - oz;
      const s = (cx * dx + cz * dz) / h2;
      const px = ox + dx * s - z.x, pz = oz + dz * s - z.z;
      const d2 = px * px + pz * pz, r = z.bodyR;
      if (d2 < r * r) {
        const t = s - Math.sqrt((r * r - d2) / h2);
        const y = oy + dy * t;
        if (t > 0 && t < maxT && y > 0.05 && y < z.bodyTop && (!best || t < best.t)) best = { z, t, head: false };
      }
    }
  }
  return best;
}

// ---------- projectiles ----------
const projectiles = [];
let projGeo = null;
function spawnProjectile(kind, x, y, z, vx, vy, vz, dmg, splash, splashDmg, owner) {
  if (!projGeo) projGeo = new THREE.SphereGeometry(1, 10, 8);
  const color = kind === 'plasma' ? new THREE.Color(0.5, 3, 0.9) : kind === 'acid' ? new THREE.Color(0.9, 2.4, 0.2) : new THREE.Color(3, 1.6, 0.6);
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color }));
  m.scale.setScalar(kind === 'rocket' ? 0.08 : kind === 'acid' ? 0.12 : 0.07);
  if (kind === 'rocket') m.scale.set(0.06, 0.06, 0.06);
  m.position.set(x, y, z);
  scene.add(m);
  projectiles.push({ kind, x, y, z, vx, vy, vz, dmg, splash: splash || 0, splashDmg: splashDmg || 0, owner, m, life: 4, trail: 0 });
  if (kind === 'acid') play3('spit', x, z, 0.7);
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    if (p.kind === 'acid') p.vy -= 4 * dt;
    const sp = Math.hypot(p.vx, p.vy, p.vz), step = sp * dt;
    const dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
    const h = rayWorld(p.x, p.y, p.z, dx, dy, dz, step);
    let hitT = h.t < step ? h.t : Infinity, hitZ = null;
    if (p.owner === 'player') {
      for (const z of zombies) { if (z.dead || z.spawnT > 0) continue; const r = rayZombie(z, p.x, p.y, p.z, dx, dy, dz, Math.min(hitT, step)); if (r && r.t < hitT) { hitT = r.t; hitZ = r; } }
    } else {
      const ddx = P.x - p.x, ddz = P.z - p.z, ddy = (EYE - 0.4) - p.y;
      const s = clamp(ddx * dx + ddy * dy + ddz * dz, 0, step);
      const cx = p.x + dx * s - P.x, cy = p.y + dy * s - (EYE - 0.4), cz = p.z + dz * s - P.z;
      if (cx * cx + cy * cy * 0.3 + cz * cz < 0.5 * 0.5 && s < hitT && !P.dead) { hitT = s; hitZ = 'player'; }
    }
    if (hitT < Infinity || p.life <= 0) {
      const t = hitT < Infinity ? hitT : 0;
      const x = p.x + dx * t, y = p.y + dy * t, z = p.z + dz * t;
      if (hitZ === 'player') { hurtPlayer(p.dmg, p.x - dx, p.z - dz); acidFX(x, y, z); }
      else if (p.owner === 'player') {
        if (hitZ && hitZ.z) damageZombie(hitZ.z, p.dmg, dx, dz, hitZ.head, x, y, z);
        if (p.splash) splashDamage(x, y, z, p.splash, p.splashDmg, hitZ && hitZ.z);
        if (p.kind === 'rocket') { explosionFX(x, y, z, p.splash); play3('boom', x, z, 1, 0); P.shake = Math.max(P.shake, clamp(1.2 - Math.hypot(x - P.x, z - P.z) / 12, 0.15, 1)); haptic('heavy'); }
        else plasmaFX(x, y, z);
      } else acidFX(x, y, z);
      scene.remove(p.m); p.m.material.dispose();
      projectiles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.m.position.set(p.x, p.y, p.z);
    p.trail -= dt;
    if (p.trail <= 0) {
      p.trail = 0.016;
      if (p.kind === 'rocket') { emit(PS_NORM, p.x, p.y, p.z, rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2), rnd(0.6, 1.1), 0.18, 0.5, 0.48, 0.45, -0.2, 1, 0.6, 0.5); emit(PS_ADD, p.x, p.y, p.z, 0, 0, 0, 0.1, 0.16, 2.4, 1.2, 0.3); }
      else if (p.kind === 'plasma') emit(PS_ADD, p.x, p.y, p.z, rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1), 0.18, 0.12, 0.3, 1.6, 0.5);
      else emit(PS_NORM, p.x, p.y, p.z, 0, -0.3, 0, 0.3, 0.09, 0.4, 0.7, 0.1, 2, 0, 0, 0.7);
    }
  }
}
function splashDamage(x, y, z, radius, dmg, direct) {
  for (const zb of zombies) {
    if (zb.dead || zb === direct) continue;
    const d = Math.hypot(zb.x - x, zb.z - z);
    if (d < radius + zb.radius && losClear(x, z, zb.x, zb.z)) damageZombie(zb, dmg * (1 - 0.6 * d / (radius + zb.radius)), zb.x - x, zb.z - z, false, zb.x, zb.chestY, zb.z, true);
  }
  const pd = Math.hypot(P.x - x, P.z - z);
  if (radius > 2 && pd < radius * 0.8 && losClear(x, z, P.x, P.z)) hurtPlayer(Math.round(20 * (1 - pd / (radius * 0.8))), x, z);
}
function plasmaFX(x, y, z) { for (let i = 0; i < 14; i++) emit(PS_ADD, x, y, z, rnd(-3, 3), rnd(-1, 3), rnd(-3, 3), rnd(0.15, 0.35), rnd(0.05, 0.12), 0.4, 2, 0.6, 3, 2); }
function acidFX(x, y, z) { for (let i = 0; i < 12; i++) emit(PS_NORM, x, y, z, rnd(-2, 2), rnd(0, 2.5), rnd(-2, 2), rnd(0.3, 0.6), rnd(0.04, 0.1), 0.45, 0.8, 0.12, 9, 0.5, 0, 0.9); }

// ---------- view model animation ----------
function updateViewModel(dt, moving) {
  if (!VM.cur) return;
  const w = curW();
  VM.kickZ = lerp(VM.kickZ, 0, 1 - Math.exp(-dt * 14));
  VM.kickR = lerp(VM.kickR, 0, 1 - Math.exp(-dt * 12));
  VM.swap = Math.min(1, VM.swap + dt / 0.35);
  VM.bobT += dt * (moving ? 9 : 2);
  const bobA = moving ? 0.012 : 0.003;
  let reloadDip = 0;
  if (W.reloading) { const t = 1 - W.reloadT / w.reload; reloadDip = Math.sin(Math.min(1, t) * Math.PI); }
  const g = VM.cur.group;
  const swapDrop = Math.pow(1 - VM.swap, 3) * 0.35;
  // Place the gun as a fraction of the visible view so it reads the same in portrait and landscape,
  // angled in toward the crosshair so its side shows.
  const gz = w.pos[2] * (gunCam.aspect < 0.8 ? 1.75 : 1.2);
  const halfH = -gz * Math.tan(gunCam.fov * Math.PI / 360), halfW = halfH * gunCam.aspect;
  const gx = Math.min(w.pos[0] * 1.2, halfW * 0.5), gyv = -halfH * 0.46;
  g.position.set(gx + Math.sin(VM.bobT * 0.5) * bobA + P.swayX, gyv + Math.abs(Math.cos(VM.bobT * 0.5)) * bobA - swapDrop - reloadDip * 0.12 + P.swayY, gz + VM.kickZ);
  g.rotation.set(VM.kickR + reloadDip * 0.7 + 0.05, 0.2 + P.swayX * 2 + reloadDip * 0.3, reloadDip * 0.5 - 0.04);
  // Muzzle flash.
  if (VM.flashT > 0) {
    VM.flashT -= dt;
    g.updateMatrixWorld();
    muzzleSprite.position.copy(VM.cur.muzzle).applyMatrix4(g.matrixWorld);
    muzzleSprite.visible = true;
    const sc = w.proj === 'rocket' ? 0.3 : w.pellets ? 0.26 : 0.18;
    muzzleSprite.scale.set(sc * rnd(0.8, 1.2), sc * rnd(0.8, 1.2), 1);
    muzzleSprite.material.rotation = Math.random() * TAU;
    muzzleSprite.material.color.set(w.proj === 'plasma' ? 0x80ffa0 : 0xffffff);
    gunLight.position.copy(muzzleSprite.position);
    gunLight.intensity = 4;
  } else { muzzleSprite.visible = false; gunLight.intensity = 0; }
}
