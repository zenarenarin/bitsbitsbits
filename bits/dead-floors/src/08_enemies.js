// Zombies, bosses, the spawn director, pickups and player damage.
const ZT = {
  walker: { hp: 70, speed: 1.3, dmg: 10, scale: 1, radius: 0.32, score: 10, reach: 1.05, turn: 3.5 },
  runner: { hp: 48, speed: 3.5, dmg: 7, scale: 0.96, radius: 0.3, score: 15, reach: 1.0, turn: 6 },
  brute: { hp: 330, speed: 1.15, dmg: 24, scale: 1.38, radius: 0.46, score: 40, reach: 1.35, turn: 2.5 },
  spitter: { hp: 110, speed: 1.6, dmg: 12, scale: 1.0, radius: 0.32, score: 25, reach: 1.05, turn: 3.5, ranged: true },
  butcher: { hp: 1900, speed: 1.75, dmg: 30, scale: 2.05, radius: 0.8, score: 600, reach: 2.3, turn: 2.2, boss: true, name: 'THE BUTCHER' },
  brood: { hp: 2300, speed: 0.95, dmg: 18, scale: 1.75, radius: 0.85, score: 700, reach: 2.0, turn: 1.8, boss: true, name: 'THE BROODMOTHER' },
};
const zombies = [];
const zpool = {};
let boss = null;

// Gradual difficulty. A smooth level per floor: the first floors ramp gently, the slope
// reaches full strength by floor 7, and the floors after each boss give a fading breather.
function difficultyLevel(f) {
  const d = Math.max(0, f - 1);
  let e = d * (0.55 + 0.45 * Math.min(1, d / 6));
  if (f > 5) { const k = (f - 1) % 5; e -= 0.8 * (1 - k / 4); }
  return Math.max(0, e) * tune('difficulty_ramp', 1);
}
function difficulty(f) {
  const d = difficultyLevel(f);
  return {
    level: d,
    hp: 1 + 0.14 * d, spd: 1 + Math.min(0.45, 0.03 * d), dmg: 1 + 0.07 * d,
    quota: Math.min(40, 8 + Math.round(2 * d)), cap: Math.min(18, 5 + Math.round(d)),
    interval: Math.max(1.0, 4.6 - 0.24 * d), init: Math.min(14, 4 + Math.round(d * 0.8)),
  };
}
function pickType(f) {
  const w = [['walker', 10], ['runner', f >= 2 ? Math.min(6, (f - 1) * 1.5) : 0], ['brute', f >= 4 ? Math.min(4, (f - 3) * 0.8) : 0], ['spitter', f >= 7 ? Math.min(4, (f - 6) * 0.8) : 0]];
  let tot = 0; for (const [, v] of w) tot += v;
  let r = Math.random() * tot;
  for (const [k, v] of w) { if ((r -= v) <= 0) return k; }
  return 'walker';
}

function spawnZombie(type, x, z, aware) {
  const def = ZT[type];
  const pool = zpool[type] || (zpool[type] = []);
  const model = pool.pop() || buildZombie(type);
  model.root.rotation.order = 'YXZ';
  model.root.rotation.set(0, Math.random() * TAU, 0);
  model.root.position.set(x, 0, z);
  model.root.scale.setScalar(def.scale);
  model.head.visible = true;
  scene.add(model.root);
  const D = RUN.D;
  const hpMul = def.boss ? (1 + 0.55 * Math.max(0, Math.floor(RUN.floor / 5) - 1)) * (1 + 0.06 * (RUN.floor - 5)) : D.hp;
  const zb = {
    type, def, model, x, z, yaw: model.root.rotation.y, hp: def.hp * hpMul, maxHp: def.hp * hpMul,
    speed: def.speed * (def.boss ? 1 : D.spd * (1 + 0.1 * (RUN.heat || 0))) * rnd(0.88, 1.12), aware: false, atkT: 0, atkCd: 0.5, phase: Math.random() * 10,
    flinch: 0, dead: false, deadT: 0, radius: def.radius, scale: def.scale, seed: Math.random() * 10,
    headR: 0.15 * def.scale, bodyR: (type === 'brood' ? 0.5 : 0.27) * def.scale, chestY: 1.2 * def.scale, bodyTop: 1.48 * def.scale,
    hx: x, hy: 1.6 * def.scale, hz: z, los: false, losT: 0, groanT: rnd(1, 6), wanderT: 0, wanderYaw: 0, wanderGo: false,
    state: 'chase', stateT: 0, chargeCd: 4, spitCd: rnd(1.5, 3), summonCd: 7, cdx: 0, cdz: 0, fall: 1, spawnT: 0, kx: 0, kz: 0,
  };
  zombies.push(zb);
  if (aware) wake(zb, true);
  return zb;
}
function wake(z, silent) {
  if (z.aware) return;
  z.aware = true;
  if (!silent && Math.random() < 0.6) play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, 0.9, 200);
}
function alertZombies(x, z, r) {
  for (const zb of zombies) if (!zb.dead && !zb.aware && Math.hypot(zb.x - x, zb.z - z) < r) wake(zb, true);
}
function removeZombie(zb) {
  scene.remove(zb.model.root);
  zb.model.root.rotation.set(0, 0, 0);
  (zpool[zb.type] || (zpool[zb.type] = [])).push(zb.model);
}
function clearZombies() {
  for (const zb of zombies) removeZombie(zb);
  zombies.length = 0;
  boss = null;
}

function spawnFar(type) {
  if (!L.spawnCells.length) return null;
  let best = null, bestScore = -1;
  for (let k = 0; k < 14; k++) {
    const c = L.spawnCells[Math.floor(Math.random() * L.spawnCells.length)];
    const x = ((c % L.N) + 0.5) * CELL, z = (((c / L.N) | 0) + 0.5) * CELL;
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < 9) continue;
    const seen = d < 24 && losClear(P.x, P.z, x, z);
    const score = (seen ? 0 : 30) + Math.min(d, 26);
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  if (!best) return null;
  return spawnZombie(type || pickType(RUN.floor), best[0] + rnd(-0.6, 0.6), best[1] + rnd(-0.6, 0.6), true);
}

const DIRECTOR = { t: 3, addT: 6 };
function populateFloor() {
  DIRECTOR.t = 4; DIRECTOR.addT = 6;
  const n = L.boss ? 3 : RUN.D.init;
  const cells = L.spawnCells.slice();
  for (let i = 0; i < n && cells.length; i++) {
    const k = cells.splice(Math.floor(Math.random() * cells.length), 1)[0];
    spawnZombie(pickType(RUN.floor), ((k % L.N) + 0.5 + rnd(-0.25, 0.25)) * CELL, (((k / L.N) | 0) + 0.5 + rnd(-0.25, 0.25)) * CELL, false);
  }
}
function updateDirector(dt) {
  const alive = zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
  if (L.boss) {
    if (!RUN.bossSpawned) {
      const k = cellOf(P.z) * L.N + cellOf(P.x);
      if (L.arena && L.roomOf[k] === L.arena.id) spawnBoss();
    } else if (boss && !boss.dead) {
      DIRECTOR.addT -= dt;
      if (DIRECTOR.addT <= 0) { DIRECTOR.addT = rnd(6, 9); if (alive < 5) spawnFar(Math.random() < 0.6 ? 'runner' : 'walker'); }
    }
    return;
  }
  // Threat builds the longer you stay on a floor: faster spawns, more zombies at once.
  RUN.heat = Math.min(1, (RUN.heat || 0) + dt * tune('threat_build', 1) / 100);
  if (RUN.graceT > 0) { RUN.graceT -= dt; return; }
  DIRECTOR.t -= dt;
  if (DIRECTOR.t <= 0) {
    DIRECTOR.t = RUN.D.interval * (1 - 0.4 * RUN.heat) * (exitOpen ? 1.15 : 1) * rnd(0.7, 1.3);
    if (alive < RUN.D.cap + Math.round(3 * RUN.heat)) spawnFar();
  }
}
function spawnBoss() {
  RUN.bossSpawned = true;
  const kind = (Math.floor(RUN.floor / 5) % 2 === 1) ? 'butcher' : 'brood';
  const a = L.arena;
  // Opposite side of the arena from where the player entered.
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const vx = cx - P.x, vz = cz - P.z, vl = Math.hypot(vx, vz) || 1;
  const bx = clamp(cx + vx / vl * CELL * 2.6, (a.x + 0.7) * CELL, (a.x + a.w - 0.7) * CELL);
  const bz = clamp(cz + vz / vl * CELL * 2.6, (a.y + 0.7) * CELL, (a.y + a.h - 0.7) * CELL);
  boss = spawnZombie(kind, bx, bz, true);
  boss.chargeCd = 3;
  play('roar', 1, 0);
  P.shake = Math.max(P.shake, 0.5);
  haptic('heavy');
  sting('danger');
  musicSet('boss');
  showBanner(ZT[kind].name, 'BOSS · FLOOR ' + RUN.floor, '#ff4a3a');
  hud.dirty = true;
}

function hurtPlayer(dmg, fx, fz) {
  if (P.dead || mode !== 'play') return;
  const d = Math.round(dmg * RUN.D.dmg);
  P.hp -= d;
  P.hurtT = 1;
  // A short breather after a heavy hit or when nearly dead.
  if (d >= 15 || P.hp < 30) RUN.graceT = Math.max(RUN.graceT || 0, 2.5);
  hud.dmgAngle = Math.atan2(fx - P.x, fz - P.z);
  hud.dmgT = 1;
  P.shake = Math.max(P.shake, 0.3 + d / 60);
  play('hurt', 0.9, 120);
  haptic('heavy');
  hud.dirty = true;
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
}

function damageZombie(z, dmg, dx, dz, head, hx, hy, hz, splash) {
  if (z.dead) return;
  if (z.state === 'stunned') dmg *= 1.5;
  z.hp -= dmg;
  wake(z, true);
  const dl = Math.hypot(dx, dz) || 1;
  if (!z.def.boss) {
    z.flinch = Math.max(z.flinch, 0.22);
    const kb = Math.min(0.5, dmg / 140) * (splash ? 2.5 : 1);
    z.kx += dx / dl * kb * 4; z.kz += dz / dl * kb * 4;
  } else z.flinch = Math.max(z.flinch, 0.06);
  bloodBurst(hx, hy, hz, dx / dl, 0, dz / dl, head ? 16 : 9, z.def.boss ? 1.6 : 1);
  play3(head ? 'splat' : 'zhit', z.x, z.z, 0.7, 40);
  hud.hit = head ? 2 : 1; hud.hitT = 0.18;
  RUN.shotsHit = (RUN.shotsHit || 0) + 1;
  if (z.hp <= 0) killZombie(z, head, dx / dl, dz / dl);
  if (z === boss) hud.dirty = true;
}
function killZombie(z, head, dx, dz) {
  z.dead = true; z.deadT = 0;
  // Fall away from the shot.
  const fwd = Math.sin(z.yaw) * dx + Math.cos(z.yaw) * dz;
  z.fallDir = fwd > 0 ? 1 : -1;
  if (head) bloodBurst(z.hx, z.hy, z.hz, dx, 0.5, dz, 14, 1.1);
  addDecal('blood', z.x + dx * 0.5, 0, z.z + dz * 0.5, 0, 1, 0, 1.2 * z.scale, Math.random() * TAU, rint(0, 2));
  play3('zdie', z.x, z.z, 0.85, 60);
  RUN.kills++;
  addScore(z.def.score * (1 + 0.1 * (RUN.floor - 1)) + (head ? 5 : 0));
  if (!z.def.boss) RUN.floorKills++;
  const dropMul = tune('ammo_drops', 1);
  if (z.def.boss) {
    for (let i = 0; i < 4; i++) spawnPickup('ammo', z.x + rnd(-1.2, 1.2), z.z + rnd(-1.2, 1.2), true);
    for (let i = 0; i < 2; i++) spawnPickup('med', z.x + rnd(-1.2, 1.2), z.z + rnd(-1.2, 1.2), true);
    bossDefeated(z);
  } else {
    // Drops lean toward what the player is short of.
    const cw = curW(), ca = ammoOf(cw.id);
    const ammoP = (ca.mag + ca.res < magSize(cw) ? 0.5 : 0.3) * dropMul;
    const medP = P.hp < 35 ? 0.18 : 0.06;
    const r = Math.random();
    if (r < ammoP) spawnPickup('ammo', z.x, z.z, true);
    else if (r < ammoP + medP) spawnPickup('med', z.x, z.z, true);
  }
  if (!L.boss && !exitOpen && RUN.floorKills >= RUN.D.quota) openExit();
  hud.dirty = true;
}
function openExit() {
  setExitOpen();
  play('ding', 0.9, 0);
  play3('door', (L.exit.ex + 0.5) * CELL, (L.exit.ey + 0.5) * CELL, 1, 0);
  sting('success');
  showBanner('ELEVATOR OPEN', 'Follow the arrow', '#5dff8a');
  haptic('success');
}
function bossDefeated(z) {
  RUN.bossesKilled = (RUN.bossesKilled || 0) + 1;
  P.shake = Math.max(P.shake, 0.6);
  play('roar', 0.7, 0);
  musicSet('explore');
  // Kill the adds with the boss.
  for (const o of zombies) if (!o.dead && o !== z) { o.hp = 0; killZombie(o, false, 0, 1); }
  openExit();
  showBanner(z.def.name + ' DOWN', '+' + fmt(z.def.score) + ' · elevator open', '#ffd25a');
  ctx.platform.milestone && ctx.platform.milestone('boss_defeated', { floor: RUN.floor });
}

const _ws = { x: 0, z: 0 };
function updateZombies(dt) {
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.dead) {
      z.deadT += dt;
      const m = z.model;
      const t = Math.min(1, z.deadT / 0.55);
      const e = t < 1 ? t * t * (3 - 2 * t) : 1;
      m.root.rotation.x = z.fallDir * e * Math.PI / 2 * (z.type === 'brood' ? 0.8 : 1);
      m.root.position.y = e * 0.14 * z.scale;
      m.legs[0].kn.rotation.x = e * 0.6; m.legs[1].kn.rotation.x = e * 0.2;
      for (const a of m.arms) { a.sh.rotation.x = lerp(a.sh.rotation.x, -2.6, dt * 3); }
      if (z.deadT > 5) m.root.position.y -= (z.deadT - 5) * 0.35;
      if (z.deadT > 6.2) { removeZombie(z); zombies.splice(i, 1); }
      continue;
    }
    updateZombie(z, dt);
  }
  // Separation.
  for (let a = 0; a < zombies.length; a++) {
    const A = zombies[a]; if (A.dead) continue;
    for (let b = a + 1; b < zombies.length; b++) {
      const B = zombies[b]; if (B.dead) continue;
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), r = A.radius + B.radius;
      if (d < r && d > 1e-4) {
        const push = (r - d) / d * 0.5, wa = A.def.boss ? 0.1 : 1, wb = B.def.boss ? 0.1 : 1;
        A.x -= dx * push * wa; A.z -= dz * push * wa; B.x += dx * push * wb; B.z += dz * push * wb;
      }
    }
  }
}

function updateZombie(z, dt) {
  const def = z.def, m = z.model;
  const dx = P.x - z.x, dz = P.z - z.z, dist = Math.hypot(dx, dz);
  z.losT -= dt;
  if (z.losT <= 0) { z.los = !P.dead && losClear(z.x, z.z, P.x, P.z); z.losT = rnd(0.15, 0.3); }
  if (!z.aware && !P.dead && mode === 'play' && (dist < 4.5 || (dist < 15 && z.los))) wake(z);
  z.flinch = Math.max(0, z.flinch - dt);
  z.atkCd -= dt;
  let speed = 0, desYaw = z.yaw, moveYaw = null;
  const chasing = z.aware && !P.dead && mode === 'play';
  if (chasing) {
    let tx = P.x, tz = P.z;
    if (!(z.los && dist < 18) && flow) { flowStep(flow, z.x, z.z, _ws); tx = _ws.x; tz = _ws.z; }
    desYaw = Math.atan2(tx - z.x, tz - z.z);
    moveYaw = desYaw;
    speed = z.speed;
    if (def.boss) speed = bossThink(z, dt, dist, dx, dz) ?? speed;
    else if (def.ranged && z.los && dist > 4 && dist < 13) {
      speed = dist > 9 ? z.speed * 0.6 : 0;
      z.spitCd -= dt;
      if (z.spitCd <= 0 && z.atkT <= 0) { z.atkT = 0.55; z.atkKind = 'spit'; z.spitCd = rnd(2.2, 3.2); }
    }
    // Melee.
    if (z.atkT > 0) {
      z.atkT -= dt;
      speed *= 0.25;
      if (z.atkT <= 0) {
        if (z.atkKind === 'spit') {
          const sx = z.hx, sy = z.hy, sz = z.hz;
          const tdx = P.x + P.vx * 0.4 - sx, tdz = P.z + P.vz * 0.4 - sz, hd = Math.hypot(tdx, tdz), v = 11, tt = hd / v;
          spawnProjectile('acid', sx, sy, sz, tdx / hd * v, ((EYE - 0.3) - sy) / tt + 0.5 * 4 * tt, tdz / hd * v, def.dmg, 0, 0, 'zombie');
        } else if (z.atkKind === 'slam') {
          P.shake = Math.max(P.shake, 0.45);
          for (let k = 0; k < 20; k++) emit(PS_NORM, z.x + Math.sin(z.yaw) * 1.5 + rnd(-1, 1), 0.1, z.z + Math.cos(z.yaw) * 1.5 + rnd(-1, 1), rnd(-1.5, 1.5), rnd(0.5, 2), rnd(-1.5, 1.5), rnd(0.6, 1.2), rnd(0.2, 0.4), 0.35, 0.32, 0.28, 3, 1.5, 0.5, 0.6);
          if (dist < def.reach + 0.9) hurtPlayer(def.dmg, z.x, z.z);
        } else if (dist < def.reach + 0.45) hurtPlayer(def.dmg, z.x, z.z);
        z.atkCd = def.boss ? 1.6 : rnd(0.9, 1.3);
        z.atkKind = null;
      }
    } else if (dist < def.reach && z.atkCd <= 0 && (z.state === 'chase')) {
      z.atkT = def.boss ? 0.8 : 0.5;
      z.atkKind = def.boss && z.type === 'butcher' ? 'slam' : 'melee';
      if (Math.random() < 0.5) play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, 0.8, 300);
    }
    if (dist < def.reach * 0.75 && z.state === 'chase') speed = 0;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = rnd(3, 8); play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, def.boss ? 1 : 0.7, 150); }
  } else {
    z.wanderT -= dt;
    if (z.wanderT <= 0) { z.wanderT = rnd(2, 5); z.wanderYaw = Math.random() * TAU; z.wanderGo = Math.random() < 0.5; }
    desYaw = z.wanderYaw; moveYaw = z.wanderYaw;
    speed = z.wanderGo ? 0.35 : 0;
  }
  if (z.flinch > 0) speed *= 0.3;
  if (z.state === 'charge') { desYaw = Math.atan2(z.cdx, z.cdz); moveYaw = desYaw; }
  z.yaw += clamp(angDelta(z.yaw, desYaw), -def.turn * dt, def.turn * dt);
  const ox = z.x, oz = z.z;
  if (moveYaw !== null && speed > 0) {
    const fy = z.state === 'charge' ? moveYaw : lerp(z.yaw, z.yaw + angDelta(z.yaw, moveYaw), 0.7);
    z.x += Math.sin(fy) * speed * dt; z.z += Math.cos(fy) * speed * dt;
  }
  z.x += z.kx * dt; z.z += z.kz * dt;
  z.kx *= Math.exp(-dt * 8); z.kz *= Math.exp(-dt * 8);
  const hit = collide(z, z.radius, false);
  if (hit && !z.aware) z.wanderT = 0;
  if (z.state === 'charge' && hit && Math.hypot(z.x - ox, z.z - oz) < speed * dt * 0.4) {
    z.state = 'stunned'; z.stateT = 1.6; P.shake = Math.max(P.shake, clamp(0.6 - dist / 30, 0.1, 0.6)); play3('boom', z.x, z.z, 0.6, 0);
  }
  // Keep a body-length from the player.
  if (!P.dead) {
    const ddx = z.x - P.x, ddz = z.z - P.z, dd = Math.hypot(ddx, ddz), mr = z.radius + P_RADIUS - 0.05;
    if (dd < mr && dd > 1e-4) { z.x = P.x + ddx / dd * mr; z.z = P.z + ddz / dd * mr; }
  }
  const actual = Math.hypot(z.x - ox, z.z - oz) / Math.max(dt, 1e-4);
  animZombie(z, dt, actual);
}

function bossThink(z, dt, dist, dx, dz) {
  z.stateT -= dt;
  if (z.type === 'butcher') {
    z.chargeCd -= dt;
    if (z.state === 'chase' && dist > 5 && z.chargeCd <= 0 && z.los && z.atkT <= 0) { z.state = 'windup'; z.stateT = 0.9; play('roar', 0.9, 0); P.shake = Math.max(P.shake, 0.25); }
    if (z.state === 'windup') { if (z.stateT <= 0) { z.state = 'charge'; z.stateT = 1.5; const d = dist || 1; z.cdx = dx / d; z.cdz = dz / d; } return 0; }
    if (z.state === 'charge') {
      if (dist < z.radius + P_RADIUS + 0.35) { hurtPlayer(z.def.dmg + 5, z.x, z.z); P.kx += z.cdx * 9; P.kz += z.cdz * 9; z.state = 'recover'; z.stateT = 0.9; }
      if (z.stateT <= 0) { z.state = 'recover'; z.stateT = 0.6; }
      return 8.5;
    }
    if (z.state === 'stunned' || z.state === 'recover') { if (z.stateT <= 0) { z.state = 'chase'; z.chargeCd = rnd(4.5, 7); } return 0; }
    return z.speed;
  }
  // Broodmother: keeps her distance, lobs acid, calls runners.
  z.spitCd -= dt; z.summonCd -= dt;
  if (z.spitCd <= 0 && z.los && z.atkT <= 0) {
    z.spitCd = rnd(2.4, 3.2);
    const v = 10;
    for (const off of [-0.22, 0, 0.22]) {
      const a = Math.atan2(dx, dz) + off, tt = dist / v;
      spawnProjectile('acid', z.hx, z.hy, z.hz, Math.sin(a) * v, ((EYE - 0.3) - z.hy) / tt + 0.5 * 4 * tt, Math.cos(a) * v, 11, 0, 0, 'zombie');
    }
  }
  if (z.summonCd <= 0) {
    z.summonCd = rnd(8, 11);
    const alive = zombies.reduce((n, o) => n + (o.dead ? 0 : 1), 0);
    if (alive < 7) {
      play('roar', 0.6, 0);
      for (let k = 0; k < 2; k++) { const a = Math.random() * TAU; const s = spawnZombie('runner', z.x + Math.sin(a) * 1.6, z.z + Math.cos(a) * 1.6, true); collide(s, s.radius, false); }
    }
  }
  return dist < 6 ? -z.speed * 0.6 : dist > 9 ? z.speed : 0;
}

function animZombie(z, dt, speed) {
  const m = z.model, def = z.def;
  const sw = clamp(Math.abs(speed) / (def.boss ? 1.6 : 1.1), 0, 1.2);
  z.phase += dt * (1.2 + Math.abs(speed) * 2.4 / def.scale);
  const ph = z.phase;
  const run = (z.type === 'runner' && speed > 1.8) || z.state === 'charge';
  m.root.position.set(z.x, 0, z.z);
  m.root.rotation.y = z.yaw;
  const amp = run ? 0.85 : 0.5;
  m.legs[0].hp.rotation.x = Math.sin(ph) * amp * sw; m.legs[1].hp.rotation.x = -Math.sin(ph) * amp * sw;
  m.legs[0].kn.rotation.x = Math.max(0, -Math.cos(ph)) * (run ? 1.3 : 0.8) * sw + 0.05;
  m.legs[1].kn.rotation.x = Math.max(0, Math.cos(ph)) * (run ? 1.3 : 0.8) * sw + 0.05;
  m.hips.position.y = 0.92 - Math.abs(Math.cos(ph)) * 0.035 * sw;
  const fl = z.flinch > 0 ? -z.flinch * 2.2 : 0;
  m.torso.rotation.x = (run ? 0.5 : 0.24) + fl + (z.state === 'windup' ? -0.35 : 0) + (z.state === 'stunned' ? 0.5 : 0);
  m.torso.rotation.z = Math.sin(ph) * 0.07 * (1 + sw) + Math.sin(z.seed) * 0.1;
  m.neck.rotation.z = Math.sin(ph * 0.5 + z.seed) * 0.22;
  m.neck.rotation.x = -0.2 + Math.sin(ph * 0.7) * 0.06;
  m.jaw.rotation.x = 0.28 + Math.abs(Math.sin(ph * 1.3 + z.seed)) * 0.25 + (z.state === 'windup' ? 0.5 : 0);
  let k = 0;
  for (const a of m.arms) {
    const s = k++ === 0 ? -1 : 1;
    if (z.atkT > 0) {
      const tot = def.boss ? 0.8 : 0.55, t = 1 - z.atkT / tot;
      const raise = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
      a.sh.rotation.x = lerp(-1.3, -2.9, raise) + (t > 0.6 ? (t - 0.6) * 4 : 0);
      a.el.rotation.x = -0.4 * raise;
      a.sh.rotation.z = s * 0.15;
    } else if (run) {
      a.sh.rotation.x = s * Math.sin(ph) * 0.9 - 0.4; a.el.rotation.x = -1.1; a.sh.rotation.z = s * 0.12;
    } else if (z.type === 'brood') {
      a.sh.rotation.x = -0.4 + Math.sin(ph * 0.5 + s) * 0.2; a.el.rotation.x = -0.5; a.sh.rotation.z = s * 0.5;
    } else {
      a.sh.rotation.x = -1.32 + Math.sin(ph * 0.5 + s + z.seed) * 0.13; a.el.rotation.x = -0.18 + Math.sin(ph * 0.4 + s) * 0.1; a.sh.rotation.z = s * 0.08;
    }
  }
  m.root.position.y = 0;
  m.root.rotation.x = 0;
  m.head.updateWorldMatrix(true, false);
  const e = m.head.matrixWorld.elements;
  z.hx = e[12]; z.hy = e[13]; z.hz = e[14];
}

// ---------- pickups ----------
const pickups = [];
function spawnPickup(kind, x, z, dropped) {
  const p = buildPickup(kind);
  p.grp.traverse(o => { o.userData.sharedGeo = true; });
  p.grp.position.set(x, 0, z);
  levelGroup.add(p.grp);
  const e = { kind, x, z, grp: p.grp, mesh: p.mesh, t: Math.random() * 10, y: dropped ? 0.9 : 0, vy: dropped ? 2.4 : 0 };
  collide(e, 0.25, false);
  e.grp.position.x = e.x; e.grp.position.z = e.z;
  pickups.push(e);
}
function clearPickups() { for (const p of pickups) if (p.grp.parent) p.grp.parent.remove(p.grp); pickups.length = 0; }
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    if (p.y > 0 || p.vy > 0) { p.vy -= 12 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0; }
    p.grp.position.y = p.y + Math.sin(p.t * 2.5) * 0.04;
    p.mesh.rotation.y = p.t * 1.2;
    if (mode !== 'play' || P.dead) continue;
    if (Math.hypot(p.x - P.x, p.z - P.z) < 1.0) {
      if (p.kind === 'med') {
        if (P.hp >= P.maxHp) continue;
        P.hp = Math.min(P.maxHp, P.hp + 35);
        play('med', 0.8, 0);
        floatNote('+35 HEALTH', '#ff6b6b');
      } else {
        for (const id of RUN.owned) { const w = WBY[id], a = ammoOf(id); a.res += Math.ceil(magSize(w) * (id === curW().id ? 1 : 0.45)); }
        play('pickup', 0.8, 0);
        floatNote('+AMMO', '#ffd25a');
      }
      haptic('light');
      hud.dirty = true;
      levelGroup.remove(p.grp);
      pickups.splice(i, 1);
    }
  }
}
