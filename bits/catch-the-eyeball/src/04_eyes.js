// =====================================================================
// Eyeballs: a fixed pool, arcade physics and the special behaviours.
// Sprites are unit quads scaled to their texel size and snapped to whole
// texels every frame, so the pixel grid never drifts.
// =====================================================================

function createMats(THREE) {
  const texCache = new Map(), matCache = new Map();
  const plane = new THREE.PlaneGeometry(1, 1);
  function tex(canvas) {
    let t = texCache.get(canvas);
    if (!t) {
      t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      texCache.set(canvas, t);
    }
    return t;
  }
  function mat(canvas, opts) {
    const key = canvas;
    let m = opts ? null : matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial(Object.assign({ map: tex(canvas), transparent: true, depthTest: false, depthWrite: false }, opts || {}));
      if (!opts) matCache.set(key, m);
    }
    return m;
  }
  function sprite(canvas, order, opts) {
    const m = new THREE.Mesh(plane, mat(canvas, opts));
    m.scale.set(canvas.width, canvas.height, 1);
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }
  function setSprite(mesh, canvas) {
    const m = mat(canvas);
    if (mesh.material !== m) { mesh.material = m; mesh.scale.set(canvas.width, canvas.height, 1); }
  }
  return { tex, mat, sprite, setSprite, plane, dispose() { texCache.forEach(t => t.dispose()); matCache.forEach(m => m.dispose()); plane.dispose(); } };
}

// Score values and per-behaviour tuning.
const EYE_RULES = {
  teal:  { points: 10, g: 1, maxHits: 3 },
  brown: { points: 10, g: 1, maxHits: 3 },
  blood: { points: 15, g: 1.08, maxHits: 3, ts: 1.12, twitch: 0.7 },
  gold:  { points: 50, g: 0.55, maxHits: 2 },
  demon: { points: 0, g: 0.95, maxHits: 4 },
  warp:  { points: 20, g: 0.92, maxHits: 3 },
  split: { points: 20, g: 1, maxHits: 3 },
  child: { points: 8, g: 1.1, maxHits: 2 }
};

function createEyes(THREE, scene, M, art, fx, audio, hooks) {
  const POOL = 26;
  const eyes = [];
  for (let i = 0; i < POOL; i++) {
    const s = art.big.teal;
    const group = new THREE.Group(); group.visible = false;
    const base = 20 + i * 6;
    const sclera = M.sprite(s.sclera, base), iris = M.sprite(s.iris, base + 1), gloss = M.sprite(s.gloss, base + 2), lid = M.sprite(s.lidClosed, base + 3);
    group.add(sclera, iris, gloss, lid);
    scene.add(group);
    eyes.push({ i, on: false, group, sclera, iris, gloss, lid });
  }
  let world = null;
  const rand = Math.random;

  function spriteSet(e) { return (e.D >= 20 ? art.big : art.small)[e.kind]; }

  function spawn(kind, x, y, o) {
    const e = eyes.find(q => !q.on);
    if (!e) return null;
    o = o || {};
    const behaviour = o.child ? 'child' : kind;
    const R = EYE_RULES[behaviour];
    const U = world.U;
    e.on = true; e.kind = kind; e.behaviour = behaviour; e.rule = R;
    e.D = o.child ? 14 : 22; e.r = e.D / 2 - 1.5;
    e.x = x; e.y = y; e.prevY = y;
    e.vx = o.vx !== undefined ? o.vx : rand() < 0.5 ? -1 : 1;
    if (o.vx === undefined) e.vx *= (40 + rand() * 70) * U;
    e.vy = o.vy !== undefined ? o.vy : (-20 + rand() * 70) * U;
    e.ts = (o.speed || 1) * (R.ts || 1) * (0.92 + rand() * 0.16);
    e.age = 0; e.hits = 0;
    e.state = o.instant ? 'live' : 'opening'; e.st = 0;
    e.lx = 0; e.ly = 0;
    e.blink = 1.5 + rand() * 3; e.twitch = 0.8 + rand() * 1.6; e.twitchDir = rand() < 0.5 ? -1 : 1;
    e.sx = 1; e.sy = 1; e.vsx = 0; e.vsy = 0;
    e.fuse = 4.6 + rand() * 1.8; e.fuseMax = e.fuse; e.hot = false;
    e.warp = 1.5 + rand() * 0.6; e.warps = 0; e.dest = null;
    e.splitReady = false; e.trail = 0; e.jitter = 0;
    e.demo = !!o.demo;
    const s = spriteSet(e);
    M.setSprite(e.sclera, s.sclera); M.setSprite(e.iris, s.iris); M.setSprite(e.gloss, s.gloss); M.setSprite(e.lid, s.lidClosed);
    e.lid.visible = true; e.iris.visible = true; e.gloss.visible = true;
    e.group.visible = true;
    if (!o.instant) audio.open();
    return e;
  }

  function kill(e) { e.on = false; e.group.visible = false; e.state = 'gone'; }

  function burstEye(e, n, speed, extra) {
    const s = spriteSet(e);
    const iris = PAL[EYE_KINDS[e.kind].iris];
    fx.burst(e.x, e.y, n, Object.assign({ speed, life: 0.7, g: -220, jitter: e.r, sizes: [1, 1, 2, 2, 3], colors: [PAL.sclera[3], PAL.sclera[2], PAL.rimPink, PAL.vein, PAL.veinDeep, iris[1], iris[2], PAL.outline], floor: world.FLOOR + 1 }, extra || {}));
    return s;
  }

  // ---------------- behaviours ----------------
  function explode(e, inJar) {
    e.state = 'exploding'; e.st = 0; e.inJar = !!inJar;
    M.setSprite(e.sclera, spriteSet(e).flash); e.iris.visible = false; e.gloss.visible = false; e.lid.visible = false;
  }
  function finishExplosion(e) {
    burstEye(e, 40, 150);
    fx.burst(e.x, e.y, 10, { speed: 60, life: 0.4, g: 0, sizes: [2, 3], colors: ['#f4ebda', '#d9878a'] });
    const U = world.U;
    for (const o of eyes) {
      if (!o.on || o === e || o.state !== 'live') continue;
      const dx = o.x - e.x, dy = o.y - e.y, d = Math.hypot(dx, dy);
      if (d < 56 && d > 0.01) { const k = (1 - d / 56) * 220 * U; o.vx += dx / d * k; o.vy += dy / d * k + 40 * U; }
    }
    audio.explode(e.inJar);
    hooks.onExplode(e, e.inJar);
    kill(e);
  }

  function startSplit(e) { if (e.state !== 'live') return; e.state = 'splitting'; e.st = 0; audio.split(); }
  function finishSplit(e) {
    const U = world.U;
    const alive = eyes.reduce((n, q) => n + (q.on ? 1 : 0), 0);
    const n = alive + 3 <= world.cap + 2 ? 3 : 2;
    const kinds = ['teal', 'brown', 'blood'];
    fx.burst(e.x, e.y, 16, { speed: 70, life: 0.5, g: -120, sizes: [1, 2], colors: [PAL.veinPink, PAL.rimPink, PAL.sclera[3]] });
    const x = e.x, y = Math.max(e.y, world.FLOOR + 10), sp = e.ts;
    kill(e);
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.75;
      const c = spawn(kinds[k % 3], x + Math.cos(a) * 5, y + 3, { child: true, instant: true, speed: sp, vx: Math.cos(a) * 150 * U, vy: (110 + Math.sin(a) * 120) * U });
      if (c) { c.sy = 0.6; c.sx = 1.4; }
    }
    hooks.onSplit(x, y);
  }

  function pickWarpDest(e) {
    const { PW, H, FLOOR } = world;
    for (let t = 0; t < 12; t++) {
      const x = (rand() * 2 - 1) * (PW - e.r - 6), y = FLOOR + (H - FLOOR) * (0.45 + rand() * 0.4);
      if (Math.hypot(x - e.x, y - e.y) < 50) continue;
      if (eyes.some(o => o.on && o !== e && Math.hypot(o.x - x, o.y - y) < o.r + e.r + 4)) continue;
      return { x, y };
    }
    return { x: -e.x * 0.7, y: Math.min(H - 30, e.y + 40) };
  }

  // ---------------- physics ----------------
  function bounceFloor(e) {
    const { FLOOR, H, U } = world;
    e.y = FLOOR + e.r; e.hits++;
    const impact = Math.abs(e.vy);
    e.sx = 1 + Math.min(0.35, impact / (900 * U)); e.sy = 2 - e.sx;
    if (e.behaviour === 'split' && e.age > 0.4) { e.vy = 0; startSplit(e); return; }
    if (e.hits >= e.rule.maxHits && !e.demo) { e.vy = 0; e.vx *= 0.3; e.state = 'missing'; e.st = 0; hooks.onMiss(e); return; }
    // eyes are alive: each bounce is a deliberate leap back up, to an unpredictable height
    const g = 230 * U * e.rule.g;
    const hTarget = (H - FLOOR) * (0.42 + rand() * 0.38);
    e.vy = Math.max(impact * 0.72, Math.sqrt(2 * g * hTarget));
    e.vx += (rand() * 2 - 1) * 45 * U;
    audio.bounce(e.D, impact / (300 * U));
    fx.burst(e.x, FLOOR + 1, 3, { speed: 30, angle: Math.PI / 2, spread: 2.2, life: 0.3, g: -200, size: 1, color: PAL.dust });
  }

  function collidePairs() {
    for (let a = 0; a < POOL; a++) {
      const A = eyes[a]; if (!A.on || A.state !== 'live') continue;
      for (let b = a + 1; b < POOL; b++) {
        const B = eyes[b]; if (!B.on || B.state !== 'live') continue;
        const dx = B.x - A.x, dy = B.y - A.y, rr = A.r + B.r, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = rr - d;
        const ma = A.r * A.r, mb = B.r * B.r, tot = ma + mb;
        A.x -= nx * ov * (mb / tot); A.y -= ny * ov * (mb / tot); B.x += nx * ov * (ma / tot); B.y += ny * ov * (ma / tot);
        const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          const j = -(1 + 0.9) * rv / (1 / ma + 1 / mb);
          A.vx -= j * nx / ma; A.vy -= j * ny / ma; B.vx += j * nx / mb; B.vy += j * ny / mb;
          A.sx = 1.12; A.sy = 0.9; B.sx = 1.12; B.sy = 0.9;
          audio.bounce(Math.min(A.D, B.D), -rv / (420 * world.U));
        }
      }
    }
  }

  function stepLive(e, dt, jar) {
    const { PW, H, FLOOR, U } = world;
    const R = e.rule;
    let g = 230 * U * R.g;
    // golden eyes drift and shy away from the jar
    if (e.behaviour === 'gold') {
      e.vx += Math.sin(e.age * 2.6) * 40 * U * dt;
      if (Math.abs(e.x - jar.x) < 44 && e.y < FLOOR + (H - FLOOR) * 0.55) e.vx += Math.sign(e.x - jar.x || 1) * 70 * U * dt;
    }
    // twitch: the iris glances first, then the eye darts that way
    e.twitch -= dt / (R.twitch || 1);
    if (e.twitch <= 0) {
      e.vx += e.twitchDir * (45 + rand() * 50) * U; e.vy += rand() * 40 * U;
      e.twitch = 1 + rand() * 1.6; e.twitchDir = rand() < 0.5 ? -1 : 1;
      if (Math.abs(e.x) > PW * 0.6) e.twitchDir = -Math.sign(e.x);
    }
    e.vy -= g * dt;
    e.vx *= Math.exp(-0.08 * dt);
    const sp = Math.hypot(e.vx, e.vy), max = 430 * U;
    if (sp > max) { e.vx *= max / sp; e.vy *= max / sp; }
    e.prevY = e.y;
    e.x += e.vx * dt; e.y += e.vy * dt;
    // walls and ceiling
    let wall = false;
    if (e.x - e.r < -PW) { e.x = -PW + e.r; e.vx = Math.abs(e.vx) * 0.92; wall = true; }
    if (e.x + e.r > PW) { e.x = PW - e.r; e.vx = -Math.abs(e.vx) * 0.92; wall = true; }
    if (e.y + e.r > H - 2) { e.y = H - 2 - e.r; e.vy = -Math.abs(e.vy) * 0.8; wall = true; }
    if (wall) { e.sx = 0.88; e.sy = 1.1; audio.bounce(e.D, sp / (500 * U)); if (e.behaviour === 'split' && e.age > 3.2) startSplit(e); }
    if (e.y - e.r < FLOOR) bounceFloor(e);
    if (e.state !== 'live') return;
    // the jar
    const hit = jar.collide(e);
    if (hit === 'catch') {
      if (e.behaviour === 'demon') { explode(e, true); return; }
      e.state = 'caught'; e.st = 0; e.relX = e.x - jar.x;
      hooks.onCatch(e);
      return;
    }
    if (hit === 'rim' && e.behaviour === 'split' && e.age > 0.4) startSplit(e);
    // a stray that ends up beyond the walls is brought back in
    if (!(e.x > -PW - 2 && e.x < PW + 2 && e.y > FLOOR - 4 && e.y < H + 40)) { e.x = clamp(e.x, -PW + e.r, PW - e.r); e.y = clamp(e.y, FLOOR + e.r, H - e.r - 2); }
  }

  function updateLook(e, dt, jar) {
    let tx = jar.x - e.x, ty = jar.mouthY - e.y;
    if (e.twitch < 0.3) { tx = e.twitchDir * 100; ty = 0; }
    if (e.behaviour === 'warp') { tx = Math.cos(e.age * 5); ty = Math.sin(e.age * 5); }
    const m = Math.hypot(tx, ty) || 1, L = spriteSet(e).look;
    e.lx = damp(e.lx, tx / m * L, e.behaviour === 'demon' ? 30 : 12, dt);
    e.ly = damp(e.ly, ty / m * L, e.behaviour === 'demon' ? 30 : 12, dt);
  }

  function update(dt, jar) {
    const U = world.U;
    const SUB = 3, h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (const e of eyes) {
        if (!e.on) continue;
        const edt = h * e.ts;
        if (e.state === 'live') stepLive(e, edt, jar);
        else if (e.state === 'caught') {
          // fall into the jar, drift to the middle and hand over to the jar's contents
          e.vy = Math.max(e.vy - 400 * U * edt, -260 * U);
          e.relX = damp(e.relX, clamp(e.relX, -8, 8), 16, edt);
          e.x = jar.x + e.relX; e.y += e.vy * edt;
          if (e.y - e.r * 0.4 < jar.liquidTop()) { jar.receive(e); kill(e); }
        }
      }
      collidePairs();
    }
    for (const e of eyes) {
      if (!e.on) continue;
      e.age += dt * e.ts; e.st += dt;
      const s = spriteSet(e);
      // squash and stretch spring
      e.vsx += ((1 - e.sx) * 260 - e.vsx * 12) * dt; e.sx += e.vsx * dt;
      e.vsy += ((1 - e.sy) * 260 - e.vsy * 12) * dt; e.sy += e.vsy * dt;
      let scale = 1, lid = null, jx = 0, jy = 0;
      if (e.state === 'opening') {
        const t = e.st / 0.34;
        lid = t < 0.4 ? s.lidClosed : t < 0.75 ? s.lidHalf : null;
        scale = 0.7 + 0.3 * easeOut(Math.min(1, t * 1.5));
        if (t >= 1) e.state = 'live';
      } else if (e.state === 'live') {
        updateLook(e, dt, jar);
        e.blink -= dt;
        if (e.blink < 0.14) lid = e.blink < 0.07 && e.blink > 0 ? s.lidClosed : s.lidHalf;
        if (e.blink <= 0) e.blink = 2 + rand() * 4;
        if (e.behaviour === 'demon') {
          e.fuse -= dt * e.ts;
          const k = 1 - e.fuse / e.fuseMax;
          const freq = 1.6 + 9 * k * k;
          e.phase = (e.phase || 0) + dt * freq;
          const hot = (e.phase % 1) < 0.45;
          if (hot && !e.hot) audio.fuse();
          e.hot = hot;
          M.setSprite(e.sclera, hot ? s.hot : s.sclera);
          scale = 1 + (hot ? 0.05 + 0.08 * k : 0);
          if (rand() < 0.08 + k * 0.3) { jx = rand() < 0.5 ? -1 : 1; }
          if (e.fuse <= 0) explode(e, false);
        }
        if (e.behaviour === 'warp' && e.warps < 3) {
          e.warp -= dt * e.ts;
          if (e.warp < 0.38 && !e.dest) e.dest = pickWarpDest(e);
          if (e.dest && rand() < 0.6) fx.burst(e.dest.x + (rand() - 0.5) * 16, e.dest.y + (rand() - 0.5) * 16, 1, { speed: 6, life: 0.25, g: 0, size: 1, color: PAL.irisWarp[3] });
          if (e.warp <= 0) { e.state = 'warpOut'; e.st = 0; audio.teleport(true); }
        }
        e.trail -= dt;
        if (e.trail <= 0) {
          if (e.behaviour === 'warp') { e.trail = 0.05; fx.burst(e.x + (rand() - 0.5) * 18, e.y + (rand() - 0.5) * 18, 1, { speed: 4, life: 0.35, g: 0, size: 1, color: rand() < 0.5 ? PAL.irisWarp[3] : PAL.irisWarp[2] }); }
          else if (e.behaviour === 'gold') { e.trail = 0.11; fx.burst(e.x + (rand() - 0.5) * 20, e.y + (rand() - 0.5) * 20, 1, { speed: 6, life: 0.45, g: 10, size: rand() < 0.3 ? 2 : 1, color: rand() < 0.5 ? PAL.irisGold[3] : '#f6dc9a' }); }
          else if (e.behaviour === 'demon') { e.trail = 0.07; fx.burst(e.x + (rand() - 0.5) * 16, e.y + e.r * 0.3 + (rand() - 0.5) * 10, 1, { speed: 8, angle: Math.PI / 2, spread: 0.8, life: 0.5, g: 30, size: rand() < 0.3 ? 2 : 1, color: rand() < 0.6 ? PAL.veinDeep : '#c03642' }); }
          else e.trail = 1;
        }
      } else if (e.state === 'warpOut') {
        const t = e.st / 0.13;
        lid = t < 0.5 ? s.lidHalf : s.lidClosed;
        e.sx = 1 - 0.8 * Math.min(1, t); e.sy = 1 + 0.4 * Math.min(1, t);
        if (t >= 1) {
          fx.burst(e.x, e.y, 12, { speed: 50, life: 0.35, g: 0, sizes: [1, 2], colors: PAL.irisWarp.slice(1) });
          const d = e.dest || pickWarpDest(e);
          e.x = d.x; e.y = d.y; e.prevY = d.y; e.dest = null;
          e.vy = clamp(e.vy, -50 * U, 90 * U);
          e.warps++; e.warp = 1.5 + rand() * 0.7;
          e.state = 'warpIn'; e.st = 0; audio.teleport(false);
          fx.burst(e.x, e.y, 10, { speed: 40, life: 0.3, g: 0, sizes: [1, 2], colors: PAL.irisWarp.slice(1) });
        }
      } else if (e.state === 'warpIn') {
        const t = e.st / 0.16;
        lid = t < 0.5 ? s.lidClosed : t < 1 ? s.lidHalf : null;
        e.sx = 0.3 + 0.7 * Math.min(1, t); e.sy = 1.3 - 0.3 * Math.min(1, t);
        if (t >= 1) { e.state = 'live'; e.sx = 1; e.sy = 1; }
      } else if (e.state === 'splitting') {
        const t = e.st / 0.24;
        scale = 1 + 0.32 * t; jx = Math.round((rand() - 0.5) * 2);
        e.lx = (rand() - 0.5) * 2 * s.look; e.ly = (rand() - 0.5) * 2 * s.look;
        if (t >= 1) { finishSplit(e); continue; }
      } else if (e.state === 'exploding') {
        scale = 1 + 0.6 * (e.st / 0.1);
        if (e.st >= 0.1) { finishExplosion(e); continue; }
      } else if (e.state === 'missing' || e.state === 'closing') {
        // the eye shuts and melts into the floor
        const dur = e.state === 'missing' ? 0.45 : 0.3, t = e.st / dur;
        lid = t < 0.35 ? s.lidHalf : s.lidClosed;
        if (e.state === 'missing') { e.sy = 1 - 0.55 * Math.min(1, t); e.sx = 1 + 0.4 * Math.min(1, t); e.y = world.FLOOR + e.r * e.sy; }
        else scale = 1 - 0.3 * t;
        if (t >= 1) { burstEye(e, e.state === 'missing' ? 10 : 14, 40, { g: -200 }); kill(e); continue; }
      }
      const lidOn = !!lid;
      e.lid.visible = lidOn;
      if (lidOn) M.setSprite(e.lid, lid);
      const sx = e.sx * scale, sy = e.sy * scale;
      e.group.position.set(Math.round(e.x) + jx, Math.round(e.y) + jy, 0);
      e.group.scale.set(sx, sy, 1);
      e.iris.position.set(Math.round(e.lx), Math.round(e.ly), 0);
    }
  }

  return {
    eyes,
    setWorld(w) { world = w; },
    spawn, update,
    count() { let n = 0; for (const e of eyes) if (e.on) n++; return n; },
    countOf(b) { let n = 0; for (const e of eyes) if (e.on && e.behaviour === b) n++; return n; },
    live() { return eyes.filter(e => e.on && e.state === 'live'); },
    closeAll() { for (const e of eyes) if (e.on && e.state !== 'caught' && e.state !== 'exploding') { e.state = 'closing'; e.st = 0; } },
    clear() { for (const e of eyes) kill(e); },
    // keeps every eye inside a resized playfield
    clampAll() { if (!world) return; for (const e of eyes) if (e.on) { e.x = clamp(e.x, -world.PW + e.r, world.PW - e.r); e.y = clamp(e.y, world.FLOOR + e.r, world.H - e.r - 2); } }
  };
}
