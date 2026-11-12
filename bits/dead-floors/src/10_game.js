// Game state, the survival run, player, camera, lighting, records and boot.
const P = { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, vx: 0, vz: 0, kx: 0, kz: 0, shake: 0, hurtT: 0, dead: false, deadT: 0, swayX: 0, swayY: 0, recoilBack: 0, stepT: 0, bob: 0 };
const RUN = { active: false, time: 0, kills: 0, headshots: 0, owned: [], ammo: {}, cur: 0, mk: 0, D: null, seed: 0, interacted: false, doorT: 0, scavT: 0, nextBoss: 180, bossIndex: 0, crate: null, crateT: 0, ammoT: 0, medT: 0, lastSec: -1 };
RUN.D = difficultyAt(0);
let mode = 'boot';
let bestScore = null, threeReady = false;
let attempt = 0;
let flashlight = null, hemi = null;
const fade = { v: 0, target: 0 };
let titleT = 0, titleYaw = 0;
let scoreTrack = null, clock = null;
try { scoreTrack = ctx.game.score(); } catch (e) { scoreTrack = null; }
const RECORD = 'survival';
const fmtTime = (sec) => { const s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ---------- survival clock (score = whole seconds survived) ----------
// ctx.game.stopwatch counts active play only; if a host lacks it, fall back to summed frame time.
function initClock() {
  try { if (ctx.game.stopwatch) clock = ctx.game.stopwatch(); } catch (e) { clock = null; }
}
function updateTime(dt) {
  RUN.fallback += dt;
  RUN.time = clock ? clock.elapsedMs / 1000 : RUN.fallback;
  const sec = Math.floor(RUN.time);
  if (sec !== RUN.lastSec) {
    RUN.lastSec = sec;
    if (scoreTrack) { try { scoreTrack.set(sec); } catch (e) { } }
    // A valid survival time so far: checkpoint once a minute.
    if (sec > 0 && sec % 60 === 0) checkpointScore();
    hud.dirty = true;
  }
}

// ---------- records ----------
function refreshBest() {
  if (!ctx.memory || !ctx.memory.record) return;
  try {
    ctx.memory.record(RECORD).rank({ scope: 'global', period: 'all_time' }).then((r) => {
      if (disposed) return;
      bestScore = r && r.viewerRank ? r.viewerRank.value : bestScore;
      renderTitle();
      hud.dirty = true;
    }).catch(() => { });
  } catch (e) { }
}
function submitResult(showOnScreen) {
  const owner = attempt, secs = Math.floor(RUN.time);
  const prevBest = bestScore;
  if (showOnScreen) { setT(els.deadPB, prevBest != null && secs <= prevBest ? 'BEST ' + fmtTime(prevBest) : ''); boardStatus('Saving time…'); }
  if (!scoreTrack) { if (showOnScreen) boardStatus('Leaderboard unavailable'); return; }
  try { scoreTrack.set(secs); } catch (e) { }
  scoreTrack.submit(RECORD, { label: fmtTime(secs), metadata: { kills: RUN.kills, headshots: RUN.headshots } }).then((res) => {
    if (disposed) return;
    if (res && res.isPersonalBest) bestScore = Math.max(bestScore || 0, secs);
    if (!showOnScreen || owner !== attempt) return;
    if (res && res.isPersonalBest) {
      setT(els.deadPB, 'NEW PERSONAL BEST');
      sting('win');
      try { ctx.pulse.complete({ timeMs: secs * 1000, timeLabel: fmtTime(secs), score: secs, result: 'Survived ' + fmtTime(secs), text: `Survived ${fmtTime(secs)} in Dead Floors with ${RUN.kills} kills` }); } catch (e) { }
    } else if (prevBest != null) setT(els.deadPB, 'BEST ' + fmtTime(Math.max(prevBest, secs)));
    else setT(els.deadPB, '');
    loadBoard(owner);
  }).catch(() => {
    if (disposed || !showOnScreen || owner !== attempt) return;
    setT(els.deadPB, '');
    boardStatus('Time not saved — check your connection');
  });
}
function boardStatus(text) { els.board.innerHTML = ''; el('div', 'st', els.board, text); }
function loadBoard(owner) {
  try {
    ctx.memory.record(RECORD).leaderboard({ scope: 'global', period: 'all_time', limit: 3 }).then((lb) => {
      if (disposed || owner !== attempt) return;
      els.board.innerHTML = '';
      const rows = (lb && lb.rows) || [];
      const me = lb && lb.viewerRank;
      const name = (r) => (r.username || r.displayName || r.name || 'Player');
      const label = (r) => r.displayLabel ? escapeHtml(String(r.displayLabel)) : fmtTime(r.value || 0);
      rows.slice(0, 3).forEach((r, i) => {
        const row = el('div', 'row' + (me && r.rank === me.rank && r.userId === me.userId ? ' me' : ''), els.board);
        el('span', '', row, '#' + (r.rank || i + 1) + '  ' + escapeHtml(name(r)));
        el('b', '', row, label(r));
      });
      if (me && !rows.slice(0, 3).some(r => r.rank === me.rank && r.userId === me.userId)) {
        const row = el('div', 'row me', els.board);
        el('span', '', row, '#' + me.rank + '  YOU');
        el('b', '', row, label(me));
      }
      if (!rows.length) boardStatus('No times yet');
      if (lb && lb.checkpointStatus && lb.checkpointStatus.failed > 0) el('div', 'st', els.board, 'Some checkpoints did not save');
      if (me) bestScore = me.value;
    }).catch(() => { if (!disposed && owner === attempt) boardStatus('Leaderboard unavailable'); });
  } catch (e) { boardStatus('Leaderboard unavailable'); }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function checkpointScore() {
  if (!scoreTrack) return;
  try { scoreTrack.checkpoint(RECORD, { metadata: { kills: RUN.kills } }).catch(() => { }); } catch (e) { }
}

// ---------- the run ----------
function clearProjectiles() { for (const p of projectiles) { scene.remove(p.m); p.m.material.dispose(); } projectiles.length = 0; }

function startRun() {
  if (!threeReady) return;
  attempt++;
  try { ctx.platform.start({ mode: 'survival' }); } catch (e) { }
  unlockAudio(); buildSounds();
  RUN.active = true;
  RUN.time = 0; RUN.fallback = 0; RUN.lastSec = -1; RUN.kills = 0; RUN.headshots = 0;
  RUN.owned = []; RUN.ammo = {}; RUN.cur = 0; RUN.mk = 0;
  RUN.seed = (Math.random() * 4294967295) >>> 0;
  RUN.interacted = false; RUN.shots = 0; RUN.scavT = 0; RUN.graceT = 0; RUN.dT = 0;
  RUN.nextBoss = 180; RUN.bossIndex = 0; RUN.bossesKilled = 0;
  RUN.crate = null; RUN.crateT = 40; RUN.ammoT = 20; RUN.medT = 60;
  RUN.D = difficultyAt(0);
  if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { } }
  if (clock) { clock.reset(0); }
  P.hp = 100;
  for (const k in gunModels) gunModels[k].group.visible = false;
  VM.cur = null;
  showScreen(null);
  fade.v = 1; fade.target = 0;
  clearZombies(); clearPickups(); clearProjectiles();
  const Ld = genLevel(RUN.seed);
  buildLevel(Ld);
  for (const p of Ld.pickups) spawnPickup(p.kind, p.x, p.z, false);
  P.x = (Ld.start.ex + 0.5) * CELL; P.z = (Ld.start.ey + 0.5) * CELL;
  P.yaw = Math.atan2(Ld.start.dx, Ld.start.dy);
  P.pitch = 0; P.vx = P.vz = P.kx = P.kz = 0; P.dead = false; P.deadT = 0; P.recoilBack = 0; P.shake = 0;
  doors.start.open = 0; doors.start.target = 0;
  RUN.doorT = 1.0;
  W.reloading = false; W.cool = 0;
  giveWeapon('pistol');
  ammoOf('pistol').res = 12;
  updateFlow();
  populateFloor();
  showBanner('SURVIVE', 'AMMO IS SCARCE · AIM FOR THE HEAD', '#ece6d6');
  mode = 'play';
  if (clock) clock.start();
  musicSet('explore');
  play('ding', 0.7, 0);
  hud.dirty = true;
  try { renderer.compile(scene, camera); } catch (e) { }
}

function playerDie() {
  P.dead = true; P.deadT = 0;
  mode = 'dying';
  if (clock) clock.pause();
  releaseAllInput();
  W.reloading = false;
  play('hurt', 1, 0); play('heart', 0.8, 0);
  sting('lose');
  haptic('error');
  try { ctx.platform.fail({ seconds: Math.floor(RUN.time), kills: RUN.kills }); } catch (e) { }
  RUN.active = false;
  musicSet('title');
}
function updateDying(dt) {
  P.deadT += dt;
  if (P.deadT > 1.8 && !els.dead.classList.contains('show')) {
    const hs = RUN.headshots || 0;
    setT(els.deadSub, RUN.kills + (RUN.kills === 1 ? ' KILL' : ' KILLS') + ' · ' + hs + (hs === 1 ? ' HEADSHOT' : ' HEADSHOTS'));
    setT(els.deadScore, fmtTime(RUN.time));
    showScreen('dead');
    mode = 'dead';
    submitResult(true);
  }
}

function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused';
  if (clock) clock.pause();
  releaseAllInput();
  setT(els.pauseInfo, 'SURVIVED ' + fmtTime(RUN.time) + ' · ' + RUN.kills + ' KILLS');
  setT(els.sndBtn, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
  showScreen('pause');
}
function resumeGame() {
  if (mode !== 'paused') return;
  showScreen(null);
  mode = 'play';
  if (clock) clock.start();
}
function quitToMenu() {
  // Leaving ends the run; the time survived still counts.
  if (RUN.active && RUN.time >= 1) submitResult(false);
  RUN.active = false;
  showScreen('title');
}

// What the HUD arrow points at: a weapon crate, or the nearest ammo when you're running low.
let navT = 0;
function updateNav(dt) {
  navT -= dt;
  if (navT > 0) return;
  navT = 0.2;
  let tgt = null, label = '';
  if (RUN.crate) { tgt = RUN.crate; label = 'CRATE'; }
  else {
    const w = curW(), a = ammoOf(w.id);
    if (a.mag + a.res <= magSize(w)) {
      let bd = 1e9;
      for (const p of pickups) if (p.kind === 'ammo') { const d = Math.hypot(p.x - P.x, p.z - P.z); if (d < bd) { bd = d; tgt = p; } }
      label = 'AMMO';
    }
  }
  if (!tgt) { hud.nav = null; return; }
  const field = navTo(tgt.x, tgt.z);
  const k = cellOf(P.z) * L.N + cellOf(P.x);
  let tx = tgt.x, tz = tgt.z;
  if (!(L.g[k] === 1 && field[k] >= 0 && field[k] <= 1)) {
    let x = P.x, z = P.z;
    for (let s = 0; s < 2; s++) { flowStep(field, x, z, _ws); x = _ws.x; z = _ws.z; }
    tx = x; tz = z;
  }
  const steps = field[k] >= 0 ? field[k] : Math.hypot(tgt.x - P.x, tgt.z - P.z) / CELL;
  hud.nav = { ang: Math.atan2(tx - P.x, tz - P.z), dist: Math.round(steps * CELL), label };
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
  // Light aim magnetism while firing; aiming is mostly up to you.
  if (fireHeld() && Math.abs(ldx) < 18) {
    const t = assistTarget(0.07, 22);
    if (t) {
      const des = Math.atan2(-(t.x - P.x), -(t.zz - P.z));
      P.yaw += clamp(angDelta(P.yaw, des), -0.1, 0.1) * Math.min(1, dt * 4) * tune('aim_assist', 1);
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
  // Completely dry: a pistol round turns up now and then, so a run never hard-locks.
  if (!RUN.owned.some(id => hasAmmo(id))) {
    RUN.scavT += dt;
    if (RUN.scavT > 4) { RUN.scavT = 0; ammoOf('pistol').res += 1; if (curW().id !== 'pistol') equip(RUN.owned.indexOf('pistol'), false); floatNote('SCAVENGED 1 ROUND', '#ffd25a'); hud.dirty = true; }
  } else RUN.scavT = 0;
  updateViewModel(dt, sp > 0.6);
  RUN.doorT -= dt;
  if (RUN.doorT <= 0 && doors.start.target === 0) { doors.start.target = 1; play('door', 0.6, 0); }
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
  if (exitLight && L && L.exit) exitLight.intensity = exitOpen ? 3 : 2 + Math.sin(t * 4) * 0.8;
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
  if (VM.cur && (mode === 'play' || mode === 'paused' || (mode === 'dying' && P.deadT < 0.4))) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}

// ---------- title backdrop ----------
function setupTitleScene() {
  if (!threeReady) return;
  clearZombies(); clearPickups(); clearProjectiles();
  RUN.D = difficultyAt(0);
  const Ld = genLevel(90210);
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
    updateTime(dt);
    updatePlayer(dt);
    updateNav(dt);
    updateFlow();
    updateDirector(dt);
    updateZombies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateDoor(doors.start, dt);
    // Music follows the fight.
    if (!(boss && !boss.dead)) {
      const close = zombies.some(z => !z.dead && z.aware && Math.hypot(z.x - P.x, z.z - P.z) < 12);
      RUN.combatT = close ? 4 : Math.max(0, (RUN.combatT || 0) - dt);
      musicSet(RUN.combatT > 0 ? 'combat' : 'explore');
    }
  } else if (mode === 'dying' || mode === 'dead') { updateDying(dt); updateZombies(dt); updateProjectiles(dt); }
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
  initWorldTemps(); initWeaponTemps(); initClock();
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
refreshBest();
await boot();
if (DEV) window.__DF = { gunGroup: () => VM.cur && VM.cur.group, losClear, flowStep, ammoOf, curW, cycleWeapon, P, RUN, zombies, pickups, get mode() { return mode; }, set mode(v) { mode = v; }, startRun, hurtPlayer, L: () => L, input, WEAPONS, giveWeapon, renderer: () => renderer, killAll: () => { for (const z of zombies) if (!z.dead) { z.hp = 0; killZombie(z, false, 0, 1); } }, spawnFar, spawnBoss, spawnCrate, doors, pauseGame, resumeGame, quitToMenu, fireHeld, showScreen, get boss() { return boss; }, get nav() { return hud.nav; }, markHud: () => { hud.dirty = true; } };
