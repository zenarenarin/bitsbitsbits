// Game state, run and floor flow, player, camera, lighting, saving, records and boot.
const P = { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, vx: 0, vz: 0, kx: 0, kz: 0, shake: 0, hurtT: 0, dead: false, deadT: 0, swayX: 0, swayY: 0, recoilBack: 0, stepT: 0, bob: 0 };
const RUN = { active: false, floor: 1, score: 0, kills: 0, floorKills: 0, owned: [], ammo: {}, cur: 0, mk: 0, D: null, seed: 0, bossSpawned: false, interacted: false, doorT: 0, scavT: 0 };
RUN.D = difficulty(1);
let mode = 'boot';
let saved = null, lastSave = null, bestScore = null, threeReady = false;
let attempt = 0;
let flashlight = null, hemi = null;
const fade = { v: 0, target: 0 };
let transT = 0, titleT = 0, titleYaw = 0;
let scoreTrack = null;
try { scoreTrack = ctx.game.score(); } catch (e) { scoreTrack = null; }

function addScore(n) {
  RUN.score += Math.round(n);
  if (scoreTrack) { try { scoreTrack.set(RUN.score); } catch (e) { } }
  hud.dirty = true;
}

// ---------- progress (Continue Playing) ----------
const hasProgress = () => !!(ctx.game && ctx.game.progress);
function validSave(s) {
  if (!s || s.v !== 1) return false;
  if (!Number.isInteger(s.floor) || s.floor < 2 || s.floor > 9999) return false;
  if (!Array.isArray(s.owned) || !s.owned.length || !s.owned.every(id => WBY[id])) return false;
  if (!s.ammo || typeof s.ammo !== 'object') return false;
  for (const id of s.owned) { const a = s.ammo[id]; if (!a || !isFinite(a.mag) || !isFinite(a.res) || a.mag < 0 || a.res < 0) return false; }
  if (!isFinite(s.hp) || s.hp <= 0 || s.hp > 100) return false;
  if (!Number.isInteger(s.cur) || s.cur < 0 || s.cur >= s.owned.length) return false;
  if (!Number.isInteger(s.mk) || s.mk < 0) return false;
  if (!isFinite(s.score) || s.score < 0 || !isFinite(s.kills) || !isFinite(s.seed)) return false;
  return true;
}
function snapshot() {
  const ammo = {};
  for (const id of RUN.owned) { const a = ammoOf(id); ammo[id] = { mag: a.mag, res: a.res }; }
  return { v: 1, floor: RUN.floor, score: RUN.score, kills: RUN.kills, hp: Math.max(1, Math.ceil(P.hp)), owned: RUN.owned.slice(), ammo, cur: RUN.cur, mk: RUN.mk, seed: RUN.seed, bosses: RUN.bossesKilled || 0 };
}
function saveProgress() {
  lastSave = snapshot();
  if (!hasProgress()) return;
  const owner = attempt;
  try {
    ctx.game.progress.save('main', { state: lastSave, label: 'Floor ' + RUN.floor, percent: 0, stateSchemaVersion: 1, metadata: { floor: RUN.floor } })
      .catch((e) => { if (!disposed && owner === attempt && DEV) console.warn('progress save failed', e); });
  } catch (e) { }
}
function endProgress(kind) {
  if (!hasProgress()) return;
  try { const p = ctx.game.progress[kind]('main'); if (p && p.catch) p.catch(() => { }); } catch (e) { }
}
function loadProgress() {
  if (!hasProgress()) return;
  try {
    ctx.game.progress.load('main').then((p) => {
      if (disposed || RUN.active) return;
      const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 1 && (!p.expiresAt || Date.parse(p.expiresAt) > Date.now())));
      if (eligible && validSave(p.state)) { saved = p.state; lastSave = p.state; renderTitle(); }
    }).catch(() => { });
  } catch (e) { }
}

// ---------- records ----------
function refreshBest() {
  if (!ctx.memory || !ctx.memory.record) return;
  try {
    ctx.memory.record('score').rank({ scope: 'global', period: 'all_time' }).then((r) => {
      if (disposed) return;
      bestScore = r && r.viewerRank ? r.viewerRank.value : bestScore;
      renderTitle();
    }).catch(() => { });
  } catch (e) { }
}
function submitResult() {
  const owner = attempt, score = RUN.score, floor = RUN.floor;
  const prevBest = bestScore;
  setT(els.deadPB, prevBest != null && score <= prevBest ? 'BEST ' + fmt(prevBest) : '');
  boardStatus('Saving score…');
  if (!scoreTrack) { boardStatus('Leaderboard unavailable'); return; }
  scoreTrack.submit('score', { label: fmt(score) + ' pts', metadata: { floor, kills: RUN.kills } }).then((res) => {
    if (disposed || owner !== attempt) return;
    if (res && res.isPersonalBest) {
      setT(els.deadPB, 'NEW PERSONAL BEST');
      bestScore = score;
      sting('win');
      try { ctx.pulse.complete({ score, level: floor, result: 'Reached floor ' + floor, text: `Reached floor ${floor} with ${fmt(score)} points in Dead Floors` }); } catch (e) { }
    } else if (prevBest != null) setT(els.deadPB, 'BEST ' + fmt(Math.max(prevBest, score)));
    else setT(els.deadPB, '');
    loadBoard(owner);
  }).catch(() => {
    if (disposed || owner !== attempt) return;
    setT(els.deadPB, '');
    boardStatus('Score not saved — check your connection');
  });
}
function boardStatus(text) { els.board.innerHTML = ''; el('div', 'st', els.board, text); }
function loadBoard(owner) {
  try {
    ctx.memory.record('score').leaderboard({ scope: 'global', period: 'all_time', limit: 3 }).then((lb) => {
      if (disposed || owner !== attempt) return;
      els.board.innerHTML = '';
      const rows = (lb && lb.rows) || [];
      const me = lb && lb.viewerRank;
      const name = (r) => (r.username || r.displayName || r.name || 'Player');
      rows.slice(0, 3).forEach((r, i) => {
        const row = el('div', 'row' + (me && r.rank === me.rank && r.userId === me.userId ? ' me' : ''), els.board);
        el('span', '', row, '#' + (r.rank || i + 1) + '  ' + escapeHtml(name(r)));
        el('b', '', row, r.displayLabel ? escapeHtml(String(r.displayLabel)) : fmt(r.value || 0));
      });
      if (me && !rows.slice(0, 3).some(r => r.rank === me.rank && r.userId === me.userId)) {
        const row = el('div', 'row me', els.board);
        el('span', '', row, '#' + me.rank + '  YOU');
        el('b', '', row, fmt(me.value || 0));
      }
      if (!rows.length) boardStatus('No scores yet');
      if (lb && lb.checkpointStatus && lb.checkpointStatus.failed > 0) el('div', 'st', els.board, 'Some floor checkpoints did not save');
      if (me) { bestScore = me.value; }
    }).catch(() => { if (!disposed && owner === attempt) boardStatus('Leaderboard unavailable'); });
  } catch (e) { boardStatus('Leaderboard unavailable'); }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function checkpointScore() {
  if (!scoreTrack || RUN.score <= 0) return;
  try { scoreTrack.checkpoint('score', { metadata: { floor: RUN.floor } }).catch(() => { }); } catch (e) { }
}

// ---------- run flow ----------
function startRun(fromSave) {
  if (!threeReady) return;
  attempt++;
  const s = fromSave && saved && validSave(saved) ? saved : null;
  try { ctx.platform.start({ floor: s ? s.floor : 1, resumed: !!s }); } catch (e) { }
  unlockAudio(); buildSounds();
  if (!s && saved) { endProgress('abandon'); }
  saved = null;
  RUN.active = true;
  RUN.floor = s ? s.floor : 1; RUN.score = s ? s.score : 0; RUN.kills = s ? s.kills : 0;
  RUN.owned = s ? s.owned.slice() : []; RUN.ammo = {}; RUN.cur = s ? s.cur : 0; RUN.mk = s ? s.mk : 0;
  RUN.seed = s ? s.seed : (Math.random() * 4294967295) >>> 0;
  RUN.bossesKilled = s ? (s.bosses || 0) : 0; RUN.interacted = false; RUN.shots = 0; RUN.scavT = 0;
  if (s) for (const id of RUN.owned) RUN.ammo[id] = { mag: s.ammo[id].mag, res: s.ammo[id].res };
  if (scoreTrack) { try { scoreTrack.reset(); scoreTrack.set(RUN.score); } catch (e) { } }
  P.hp = s ? s.hp : 100;
  for (const k in gunModels) gunModels[k].group.visible = false;
  VM.cur = null;
  showScreen(null);
  fade.v = 1; fade.target = 0;
  enterFloor(RUN.floor, !!s);
}

function clearProjectiles() { for (const p of projectiles) { scene.remove(p.m); p.m.material.dispose(); } projectiles.length = 0; }

function enterFloor(f, restoring) {
  RUN.floor = f; RUN.floorKills = 0; RUN.bossSpawned = false; RUN.D = difficulty(f); RUN.heat = 0; RUN.graceT = 0;
  clearZombies(); clearPickups(); clearProjectiles();
  const Ld = genLevel(f, (RUN.seed + f * 7919) >>> 0);
  buildLevel(Ld);
  for (const p of Ld.pickups) spawnPickup(p.kind, p.x, p.z, false);
  P.x = (Ld.start.ex + 0.5) * CELL; P.z = (Ld.start.ey + 0.5) * CELL;
  P.yaw = Math.atan2(Ld.start.dx, Ld.start.dy);
  P.pitch = 0; P.vx = P.vz = P.kx = P.kz = 0; P.dead = false; P.deadT = 0; P.recoilBack = 0; P.shake = 0;
  doors.start.open = 0; doors.start.target = 0;
  RUN.doorT = 1.0;
  W.reloading = false; W.cool = 0;
  populateFloor();
  let sub;
  if (!restoring) {
    if (f <= WEAPONS.length) {
      giveWeapon(WEAPONS[f - 1].id);
      sub = f === 1 ? 'KILL ' + RUN.D.quota + ' TO OPEN THE ELEVATOR' : 'NEW WEAPON · ' + WEAPONS[f - 1].name;
      if (f > 1) { play('weapon', 0.8, 0); sting('powerup'); }
    } else {
      RUN.mk++;
      for (const id of RUN.owned) { const a = ammoOf(id); a.mag = magSize(WBY[id]); a.res += Math.ceil(magSize(WBY[id]) * 0.5); }
      equip(clamp(RUN.cur, 0, RUN.owned.length - 1), true);
      sub = 'ALL WEAPONS UPGRADED · MK ' + (RUN.mk + 1);
      play('weapon', 0.8, 0); sting('powerup');
    }
  } else {
    equip(clamp(RUN.cur, 0, RUN.owned.length - 1), true);
    sub = 'WELCOME BACK';
  }
  if (Ld.boss) sub = (sub && sub.startsWith('NEW') ? sub + ' · ' : '') + 'SOMETHING BIG IS WAITING';
  showBanner('FLOOR ' + f, sub, Ld.boss ? '#ff6a50' : '#ece6d6');
  if (f > 1 || restoring) saveProgress();
  mode = 'play';
  musicSet('explore');
  play('ding', 0.7, 0);
  hud.dirty = true;
  try { renderer.compile(scene, camera); } catch (e) { }
}

function floorComplete() {
  mode = 'transition';
  transT = 0;
  addScore(100 * RUN.floor);
  doors.exit.target = 0;
  play('door', 0.9, 0);
  haptic('success');
  try { ctx.platform.milestone('floor_clear', { floor: RUN.floor }); } catch (e) { }
  checkpointScore();
  releaseAllInput();
  fade.target = 1;
}
function updateTransition(dt) {
  transT += dt;
  updateDoor(doors.exit, dt);
  if (transT > 1.3) enterFloor(RUN.floor + 1, false), fade.target = 0;
}

function playerDie() {
  P.dead = true; P.deadT = 0;
  mode = 'dying';
  releaseAllInput();
  W.reloading = false;
  play('hurt', 1, 0); play('heart', 0.8, 0);
  sting('lose');
  haptic('error');
  try { ctx.platform.fail({ floor: RUN.floor, score: RUN.score, kills: RUN.kills }); } catch (e) { }
  endProgress('complete');
  saved = null; lastSave = null;
  RUN.active = false;
  musicSet('title');
}
function updateDying(dt) {
  P.deadT += dt;
  if (P.deadT > 1.8 && !els.dead.classList.contains('show')) {
    setT(els.deadSub, 'FLOOR ' + RUN.floor + ' · ' + RUN.kills + (RUN.kills === 1 ? ' KILL' : ' KILLS'));
    setT(els.deadScore, fmt(RUN.score));
    showScreen('dead');
    mode = 'dead';
    submitResult();
  }
}

function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused';
  releaseAllInput();
  setT(els.pauseInfo, 'FLOOR ' + RUN.floor + ' · ' + fmt(RUN.score) + ' PTS');
  setT(els.sndBtn, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
  showScreen('pause');
}
function resumeGame() {
  if (mode !== 'paused') return;
  showScreen(null);
  mode = 'play';
}
function quitToMenu() {
  saved = lastSave && validSave(lastSave) ? lastSave : null;
  RUN.active = false;
  showScreen('title');
}

// ---------- player ----------
function updatePlayer(dt) {
  const k = input.keys;
  const sens = 0.0055 * settings.sens * tune('look_speed', 1);
  const ldx = input.lookDX, ldy = input.lookDY;
  input.lookDX = input.lookDY = 0;
  P.yaw -= ldx * sens;
  P.pitch -= ldy * sens * 0.85;
  if (k['arrowleft'] || k['j']) P.yaw += 2.4 * dt;
  if (k['arrowright'] || k['l']) P.yaw -= 2.4 * dt;
  if (k['i']) P.pitch += 1.6 * dt;
  if (k['k']) P.pitch -= 1.6 * dt;
  if (P.recoilBack > 0) { const r = Math.min(P.recoilBack, dt * 0.5); P.pitch -= r; P.recoilBack -= r; }
  P.pitch = clamp(P.pitch, -1.2, 1.2);
  P.swayX = lerp(P.swayX, clamp(ldx * 0.0007, -0.035, 0.035), 1 - Math.exp(-dt * 10));
  P.swayY = lerp(P.swayY, clamp(-ldy * 0.0007, -0.03, 0.03), 1 - Math.exp(-dt * 10));
  // Gentle aim magnetism while firing.
  if (fireHeld() && Math.abs(ldx) < 18) {
    const t = assistTarget(0.13, 22);
    if (t) {
      const des = Math.atan2(-(t.x - P.x), -(t.zz - P.z));
      P.yaw += clamp(angDelta(P.yaw, des), -0.2, 0.2) * Math.min(1, dt * 6) * tune('aim_assist', 1);
    }
  }
  let mx = input.mx, mz = input.mz;
  if (k['w'] || k['arrowup']) mz += 1;
  if (k['s'] || k['arrowdown']) mz -= 1;
  if (k['a']) mx -= 1;
  if (k['d']) mx += 1;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const speed = 4.4 * (W.reloading ? 0.85 : 1);
  const tvx = (fx * mz + rx * mx) * speed, tvz = (fz * mz + rz * mx) * speed;
  const a = 1 - Math.exp(-dt * 12);
  P.vx = lerp(P.vx, tvx, a); P.vz = lerp(P.vz, tvz, a);
  P.x += (P.vx + P.kx) * dt; P.z += (P.vz + P.kz) * dt;
  P.kx *= Math.exp(-dt * 6); P.kz *= Math.exp(-dt * 6);
  collide(P, P_RADIUS, true);
  const sp = Math.hypot(P.vx, P.vz);
  P.stepT += sp * dt;
  if (P.stepT > 2.1) { P.stepT = 0; play('step', 0.25, 0); }
  P.bob += dt * sp * 2.1;
  P.hurtT = Math.max(0, P.hurtT - dt);
  // Weapon.
  W.cool -= dt;
  const w = curW(), am = ammoOf(w.id);
  if (W.reloading) {
    W.reloadT -= dt;
    if (W.reloadT <= 0) {
      W.reloading = false;
      const take = Math.min(magSize(w) - am.mag, am.res);
      am.mag += take; am.res -= take;
      hud.dirty = true;
    }
  } else if (am.mag === 0 && am.res > 0 && W.cool <= 0) startReload();
  if (fireHeld() && W.cool <= 0 && !W.reloading && VM.swap > 0.85) fire();
  // Never strand the player with nothing: scavenge pistol rounds slowly.
  if (!RUN.owned.some(id => hasAmmo(id))) {
    RUN.scavT += dt;
    if (RUN.scavT > 1.6) { RUN.scavT = 0; ammoOf('pistol').res += 2; if (curW().id !== 'pistol') equip(RUN.owned.indexOf('pistol'), false); floatNote('SCAVENGED 2 ROUNDS', '#ffd25a'); hud.dirty = true; }
  } else RUN.scavT = 0;
  updateViewModel(dt, sp > 0.6);
  // Doors and exit.
  RUN.doorT -= dt;
  if (RUN.doorT <= 0 && doors.start.target === 0) { doors.start.target = 1; play('door', 0.6, 0); }
  if (exitOpen) {
    const cx = (L.exit.ex + 0.5) * CELL, cz = (L.exit.ey + 0.5) * CELL;
    if (Math.abs(P.x - cx) < CELL * 0.4 && Math.abs(P.z - cz) < CELL * 0.4) floorComplete();
  }
}

// ---------- camera, lights, rendering ----------
function updateCamera(dt) {
  P.shake = Math.max(0, P.shake - dt * 1.5);
  const sh = P.shake * P.shake * 0.1;
  const sp = Math.hypot(P.vx, P.vz);
  const by = Math.sin(P.bob * 2) * 0.03 * Math.min(1, sp / 4);
  let y = EYE + by, roll = 0;
  if (P.dead) {
    const t = Math.min(1, P.deadT / 0.9), e = t * t;
    y = lerp(EYE, 0.35, e); roll = e * 0.9;
  }
  camera.position.set(P.x + rnd(-sh, sh), y + rnd(-sh, sh), P.z + rnd(-sh, sh));
  camera.rotation.set(P.pitch + rnd(-sh, sh) * 0.4, P.yaw + rnd(-sh, sh) * 0.4, roll + Math.sin(P.bob) * 0.004);
}
let lightAssignT = 0, _lightCol = null;
const poolAssign = [null, null, null, null];
function updateLights(dt, t) {
  if (!fixtures) return;
  let changed = false;
  const col = _lightCol || (_lightCol = new THREE.Color());
  for (let k = 0; k < fixtureList.length; k++) {
    const f = fixtureList[k];
    if (f.state !== 'flicker') continue;
    const n = Math.sin(t * 23 + f.phase) + Math.sin(t * 5.7 + f.phase * 3);
    let lv = n > 0.55 ? 1 : n > 0.1 ? 0.3 : 0.04;
    if (Math.sin(t * 0.5 + f.phase) > 0.8) lv = 0.03;
    if (lv !== f.level) { f.level = lv; col.set(f.color).multiplyScalar(lv < 0.05 ? 0.04 : 2.6 * lv); fixtures.setColorAt(k, col); changed = true; }
  }
  if (changed) fixtures.instanceColor.needsUpdate = true;
  lightAssignT -= dt;
  if (lightAssignT <= 0) {
    lightAssignT = 0.15;
    const cands = [];
    for (const f of fixtureList) { if (f.state === 'off') continue; const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (d < 18) cands.push([d, f]); }
    cands.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < poolLights.length; i++) poolAssign[i] = cands[i] ? cands[i][1] : null;
  }
  let near = 0;
  for (let i = 0; i < poolLights.length; i++) {
    const L0 = poolLights[i], f = poolAssign[i];
    if (!f) { L0.intensity = Math.max(0, L0.intensity - dt * 40); continue; }
    if (L0.userData.f !== f) { L0.userData.f = f; L0.intensity = 0; L0.position.set(f.x, WALL_H - 0.3, f.z); L0.color.set(f.color); }
    const target = 9 * f.level;
    L0.intensity = lerp(L0.intensity, target, 1 - Math.exp(-dt * 18));
    const d = Math.hypot(f.x - P.x, f.z - P.z);
    near += f.level / (1 + d * d * 0.12);
  }
  if (gunHemi) gunHemi.intensity = 0.7 + Math.min(1, near) * 1.4;
  if (exitLight && L) exitLight.intensity = exitOpen ? 3 : 2 + Math.sin(t * 4) * 0.8;
}

let dynScale = 1, perfAcc = 0, perfN = 0, perfT = 0;
function pixelRatio() { return Math.min(ctx.dpr || 1, 1.6) * dynScale; }
function resizeRenderer() {
  const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  gunCam.aspect = w / h; gunCam.updateProjectionMatrix();
  const scale = (h * pixelRatio()) / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const s of FX.sys) s.mat.uniforms.uScale.value = scale;
}
function perfTick(dtMs) {
  perfAcc += dtMs; perfN++; perfT += dtMs;
  if (perfT < 2500) return;
  const avg = perfAcc / perfN;
  perfAcc = perfN = perfT = 0;
  const before = dynScale;
  if (avg > 24 && dynScale > 0.55) dynScale = Math.max(0.55, dynScale - 0.12);
  else if (avg < 15 && dynScale < 1) dynScale = Math.min(1, dynScale + 0.08);
  if (dynScale !== before) resizeRenderer();
}

function render() {
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (VM.cur && (mode === 'play' || mode === 'paused' || mode === 'transition' || (mode === 'dying' && P.deadT < 0.4))) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}

// ---------- title backdrop ----------
function setupTitleScene() {
  if (!threeReady) return;
  clearZombies(); clearPickups(); clearProjectiles();
  RUN.D = difficulty(1);
  RUN.floor = 1;
  const Ld = genLevel(1, 90210);
  buildLevel(Ld);
  for (const p of Ld.pickups) spawnPickup(p.kind, p.x, p.z, false);
  doors.start.open = doors.start.target = 1;
  updateDoor(doors.start, 0);
  P.x = (Ld.start.ex + 0.5) * CELL - Ld.start.dx * 0.6; P.z = (Ld.start.ey + 0.5) * CELL - Ld.start.dy * 0.6;
  titleYaw = Math.atan2(Ld.start.dx, Ld.start.dy);
  P.yaw = titleYaw; P.pitch = 0; P.dead = false; P.vx = P.vz = 0; P.hp = 100;
  const fx = -Math.sin(titleYaw), fz = -Math.cos(titleYaw);
  for (const [d, s] of [[5.2, -0.9], [7.5, 1.1]]) {
    const z = spawnZombie('walker', P.x + fx * d + Math.cos(titleYaw) * s, P.z + fz * d - Math.sin(titleYaw) * s, false);
    collide(z, z.radius, false);
    z.yaw = Math.atan2(P.x - z.x, P.z - z.z);
    z.wanderYaw = z.yaw; z.wanderGo = false; z.wanderT = 3;
  }
  titleT = 0;
  mode = 'title';
}
function updateTitle(dt) {
  titleT += dt;
  P.yaw = titleYaw + Math.sin(titleT * 0.22) * 0.35;
  P.pitch = -0.04 + Math.sin(titleT * 0.15) * 0.04;
  // Keep the demo zombies near the camera.
  for (const z of zombies) {
    const d = Math.hypot(z.x - P.x, z.z - P.z);
    if (d > 9 || d < 3.5) { z.wanderYaw = Math.atan2(P.x - z.x, P.z - z.z) + (d < 3.5 ? Math.PI : 0); z.wanderGo = true; z.wanderT = 2; }
  }
}

// ---------- frame ----------
function frame(dtMs) {
  if (disposed || !renderer) return;
  perfTick(dtMs);
  const dt = Math.min(dtMs, 50) / 1000;
  const t = performance.now() / 1000;
  if (mode === 'title') { updateTitle(dt); updateZombies(dt); updatePickups(dt); }
  else if (mode === 'play') {
    updatePlayer(dt);
    updateFlow();
    updateDirector(dt);
    updateZombies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateDoor(doors.start, dt); updateDoor(doors.exit, dt);
    // Music follows the fight.
    if (!(boss && !boss.dead)) {
      const close = zombies.some(z => !z.dead && z.aware && Math.hypot(z.x - P.x, z.z - P.z) < 12);
      RUN.combatT = close ? 4 : Math.max(0, (RUN.combatT || 0) - dt);
      musicSet(RUN.combatT > 0 ? 'combat' : 'explore');
    }
  } else if (mode === 'transition') { updateTransition(dt); updateViewModel(dt, false); }
  else if (mode === 'dying' || mode === 'dead') { updateDying(dt); updateZombies(dt); updateProjectiles(dt); }
  if (mode !== 'paused') { updateParticles(dt); updateLineFX(dt); }
  fade.v = fade.target > fade.v ? Math.min(fade.target, fade.v + dt * 1.6) : Math.max(fade.target, fade.v - dt * 1.4);
  setS(els.fade, 'opacity', fade.v.toFixed(3));
  updateCamera(dt);
  updateLights(dt, t);
  render();
  updateHUD(dt);
}

// ---------- boot ----------
function initRenderer() {
  const canvas = ctx.createCanvas({ layer: 'background', order: 0, input: 'passthrough' });
  canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x050605, 1);
  ctx.listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); try { ctx.platform.error({ stage: 'webgl_context_lost' }); } catch (err) { } });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050605);
  scene.fog = new THREE.FogExp2(0x070807, 0.072);
  camera = new THREE.PerspectiveCamera(72, Math.max(1, ctx.width) / Math.max(1, ctx.height), 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  flashlight = new THREE.SpotLight(0xfff0d8, 20, 26, 0.52, 0.65, 2);
  flashlight.position.set(0.18, -0.12, 0.1);
  camera.add(flashlight);
  flashlight.target.position.set(0.08, -0.12, -6);
  camera.add(flashlight.target);
  hemi = new THREE.HemisphereLight(0x7a8898, 0x1e1812, 0.32);
  scene.add(hemi);
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 11, 2); scene.add(l); poolLights.push(l); }
}
function bootFail(stage, e) {
  try { ctx.platform.error({ stage, message: String((e && e.message) || e).slice(0, 300) }); } catch (err) { }
  if (DEV) console.error(stage, e);
  setT(els.startBtn, stage === 'library' ? 'RETRY' : 'UNAVAILABLE');
  els.startBtn.disabled = stage !== 'library';
  setT(els.load, stage === 'library' ? "COULDN'T LOAD THE 3D ENGINE" : '3D GRAPHICS ARE NOT AVAILABLE ON THIS DEVICE');
}

let bootTries = 0;
async function boot() {
  bootTries++;
  setT(els.load, 'LOADING THE BUILDING…');
  try { THREE = await ctx.importModule('three', '0.164.1'); }
  catch (e) {
    if (disposed) return;
    bootFail('library', e);
    if (bootTries < 4) RETRY = true;
    else setT(els.startBtn, 'UNAVAILABLE');
    return;
  }
  if (disposed) return;
  initWorldTemps(); initWeaponTemps();
  try { initRenderer(); buildEnvironment(); }
  catch (e) { bootFail('renderer', e); return; }
  try {
    buildTextures(); buildMaterials(); initFX(); initGunScene();
    resizeRenderer();
    threeReady = true;
    setupTitleScene();
    for (const w of WEAPONS) gunModel(w);
    frame(16);
  } catch (e) { bootFail('first_frame', e); return; }
  setT(els.load, '');
  renderTitle();
  ctx.game.loop({ update: frame, onError: (err) => { if (DEV) console.error(err); try { ctx.platform.error({ stage: 'loop', message: String(err && err.message || err).slice(0, 300) }); } catch (x) { } } });
  ctx.timeout(() => { if (!disposed) buildSounds(); }, 60);
}
let RETRY = false;

// Paint the title immediately, then load the engine behind it.
buildHUD();
els.title.classList.add('show');
modalRoot.style.pointerEvents = 'auto';
mode = 'title';
// The start button retries a failed engine load (bounded by bootTries).
ctx.listen(els.startBtn, 'click', (e) => { if (RETRY && !threeReady) { e.stopImmediatePropagation(); RETRY = false; els.startBtn.disabled = true; boot(); } }, { capture: true });
try { ctx.markVisualReady('title'); } catch (e) { }
try { ctx.platform.ready(); } catch (e) { }
try { ctx.loadFont('DFB', 'bebas-neue', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
try { ctx.loadFont('DFI', 'inter', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
musicSet('title');
loadProgress();
refreshBest();
await boot();
if (DEV) window.__DF = { gunGroup: () => VM.cur && VM.cur.group, losClear, flowStep, get exitFlow() { return exitFlow; }, get exitOpen() { return exitOpen; }, ammoOf, curW, cycleWeapon, P, RUN, zombies, get mode() { return mode; }, set mode(v) { mode = v; }, startRun, enterFloor, floorComplete, hurtPlayer, setExitOpen, openExit, L: () => L, input, WEAPONS, giveWeapon, renderer: () => renderer, killAll: () => { for (const z of zombies) if (!z.dead) { z.hp = 0; killZombie(z, false, 0, 1); } }, spawnFar, spawnBoss, doors, pauseGame, resumeGame, fireHeld, showScreen, get boss() { return boss; } };
