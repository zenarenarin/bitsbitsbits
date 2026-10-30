// =====================================================================
// The game: run and hide, stamina, the pursuit, screens, the Plethora
// lifecycle and the pixel-perfect blit.
// =====================================================================
const SAVE_KEY = 'hollow-harvest-v1';
const TUNE = {
  runBase: 6.2, runGain: 2.2, walk: 2.0, accel: 16, decel: 14,
  drain: 0.088, drainGain: 0.03, recoverHide: 0.33, recoverWalk: 0.07, tiredAt: 0.3, rested: 0.3,
  huntBase: 6.75, huntGain: 2.3, startGap: 34, seenGap: 2.8, searchGap: 5.5, catchGap: 1.2,
  windowBase: 6.0, windowMin: 3.4, leaveSpeed: 6.5, maxGap: 44
};

window.plethoraBit = {
  meta: { title: 'Hollow Harvest', runtime: 'plethora-bit@2', tags: ['arcade', 'halloween', 'pixel-art', 'endless', 'survival'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy && ctx.onDestroy(() => { destroyed = true; });

    // ---------- save ----------
    let save = { best: 0, runs: 0, hints: {} };
    try {
      let s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null;
      if (s && typeof s.then === 'function') s = await s.catch(() => null);
      if (!s) { try { const raw = window.localStorage.getItem(SAVE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { } }
      if (s && typeof s === 'object') save = Object.assign(save, s, { hints: Object.assign({}, s.hints || {}) });
    } catch (e) { }
    const persist = () => {
      try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { }
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { }
    };

    // ---------- canvas ----------
    const canvas = ctx.createCanvas({ touchAction: 'none' });
    canvas.style.imageRendering = 'pixelated';
    const g = canvas.getContext('2d', { alpha: false });
    const buf = document.createElement('canvas');
    const b = buf.getContext('2d');
    let W = 128, H = 280, SC = 1, offX = 0, offY = 0, dpr = 1, L = computeLayout(W, H), safeT = 0, safeB = 0;
    const vign = [];
    function buildVignettes() {
      vign.length = 0;
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const ink = hexRgb(FIX.ink);
      for (let l = 1; l <= 3; l++) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const c2 = cv.getContext('2d'), id = c2.createImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), d = Math.sqrt(dx * dx * 1.1 + dy * dy * 0.9);
          const v = clamp((d - (1.12 - l * 0.17)) * 2.2, 0, 1);
          if (bayer[(y & 3) * 4 + (x & 3)] / 16 < v) { const i = (y * W + x) * 4; id.data[i] = ink[0]; id.data[i + 1] = ink[1]; id.data[i + 2] = ink[2]; id.data[i + 3] = 255; }
        }
        c2.putImageData(id, 0, 0); vign.push(cv);
      }
    }
    function layout() {
      const cw = Math.max(1, ctx.width || window.innerWidth), ch = Math.max(1, ctx.height || window.innerHeight);
      dpr = Math.min(3, ctx.nativeDpr || window.devicePixelRatio || 1);
      const dw = Math.max(1, Math.round(cw * dpr)), dh = Math.max(1, Math.round(ch * dpr));
      canvas.width = dw; canvas.height = dh; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      SC = Math.max(1, Math.min(Math.floor(dw / 128), Math.floor(dh / 228)));
      W = Math.min(Math.ceil(dw / SC), 180); H = Math.min(Math.ceil(dh / SC), 330);
      offX = Math.floor((dw - W * SC) / 2); offY = Math.floor((dh - H * SC) / 2);
      buf.width = W; buf.height = H;
      L = computeLayout(W, H);
      const sa = ctx.safeArea || {};
      safeT = Math.max(0, Math.ceil(((sa.top || 0) * dpr - Math.max(0, offY)) / SC));
      safeB = Math.max(0, Math.ceil(((sa.bottom || 0) * dpr - Math.max(0, offY)) / SC));
      scene.skyKey = '';
      buildVignettes();
    }

    const scene = createScene();
    const world = createWorld(1);
    const audio = createAudio(caps.audio !== false);
    ctx.onDestroy && ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- state ----------
    let mode = 'title', modeT = 0, clock = 0;
    const input = { pointers: new Set(), key: false, get held() { return this.pointers.size > 0 || this.key; } };
    let run = null;
    function newRun() {
      const seed = (Date.now() & 0xffffff) ^ (save.runs * 7919);
      world.reset(seed);
      return {
        t: 0, dist: 0, speed: 0, stamina: 1, tired: false, started: false, idleT: 0,
        act: 'stand', actT: 0, actDur: 0, airH: 0, ob: null, ph: 0, stepPh: 0,
        hideT: 0, inZone: null, zoneSeen: false,
        c: { gap: TUNE.startGap, mode: 'wake', timer: 0, phase: 0, facing: 1, reach: 0, scan: 0, searchDur: 0, eyes: 1, lastStep: 0, viewX: 0 },
        stageShown: 0, stageToast: 0, hint: '', hintT: 0, events: 5, caw: 4, creak: 8, stir: { x: 0, t: 0 },
        particles: [], bats: [], heartT: 0, record: false, cause: '', jitter: [], jitterT: 0, lastBlink: 0
      };
    }
    run = newRun();

    function diff() { return clamp((run.t - 15) / 70, 0, 1); }
    function runSpeed() {
      let s = TUNE.runBase + TUNE.runGain * diff();
      if (run.tired) s *= 0.55;
      else if (run.stamina < TUNE.tiredAt) s *= lerp(0.6, 1, run.stamina / TUNE.tiredAt);
      return s;
    }
    function hideWindow() { return lerp(TUNE.windowBase, TUNE.windowMin, diff()); }
    function showHint(key, msg) { if (save.hints[key]) return; save.hints[key] = 1; persist(); run.hint = msg; run.hintT = 3.2; }

    // ---------- particles ----------
    function spark(x, y, vx, vy, life, c, kind) {
      if (run.particles.length > 80) return;
      run.particles.push({ x, y, vx, vy, life, max: life, c, kind: kind || 'dot' });
    }

    // ---------- run lifecycle ----------
    function begin() {
      run = newRun(); mode = 'play'; modeT = 0;
      input.pointers.clear();
      save.runs++; persist();
      try { ctx.platform.start({ run: save.runs }); } catch (e) { }
    }
    function caught(cause) {
      if (mode !== 'play') return;
      mode = 'caught'; modeT = 0; run.cause = cause || 'caught';
      run.act = 'caught'; run.speed = 0;
      audio.sting(); haptic('heavy');
      const dist = Math.floor(run.dist);
      if (dist > save.best) { save.best = dist; run.record = true; }
      persist();
      try { ctx.platform.fail({ score: dist, distance: dist, reason: run.cause }); } catch (e) { }
      try { ctx.platform.setScore && ctx.platform.setScore(dist); } catch (e) { }
      try { if (ctx.memory && ctx.memory.record) ctx.memory.record('score').submit(dist, { label: dist + ' m' }).catch(() => { }); } catch (e) { }
    }
    function pause() { if (mode === 'play') { mode = 'paused'; modeT = 0; input.pointers.clear(); input.key = false; audio.suspend(); } }
    function resume() { if (mode === 'paused') { mode = 'play'; modeT = 0; audio.resume(); } }
    function toTitle() { mode = 'title'; modeT = 0; run = newRun(); audio.resume(); }

    // ---------- the creature ----------
    function updateCreature(dt) {
      const c = run.c, d = diff(), hidden = run.act === 'hide';
      const hunt = TUNE.huntBase + TUNE.huntGain * d;
      c.timer -= dt;
      if (c.mode === 'wake') {
        if (run.started ? c.timer < -2 : run.idleT > 6) c.mode = hidden ? 'seek' : 'hunt';
      } else if (!hidden) {
        // bolting from cover startles it for a moment while it pulls its arm out of the corn
        if (c.mode === 'search') { c.mode = 'reacquire'; c.timer = 0.8; }
        else if (c.mode === 'leave') {
          // it has its back to you: it walks on, and only picks up your trail when it stops
          c.gap = Math.min(TUNE.maxGap, c.gap + (TUNE.leaveSpeed - run.speed * 0.5) * dt);
          if (c.timer <= 0) { c.mode = 'reacquire'; c.timer = 0.7; }
        }
        else if (c.mode === 'seek' || c.mode === 'lost') { c.mode = 'reacquire'; c.timer = 0.7; }
        if (c.mode === 'reacquire') { c.gap += (run.speed - hunt * 0.6) * dt; if (c.timer <= 0) c.mode = 'hunt'; }
        if (c.mode === 'hunt') c.gap -= (hunt - run.speed) * dt;
      } else {
        if (c.mode === 'hunt' || c.mode === 'reacquire') c.mode = 'seek';
        if (c.mode === 'seek') {
          c.gap -= (2.6 + c.gap * 0.16) * dt;
          if (c.gap <= TUNE.searchGap) { c.gap = TUNE.searchGap; c.mode = 'search'; c.timer = c.searchDur = 1.5 + Math.random() * 1.1 + d * 0.6; audio.rustle(1.2); }
        } else if (c.mode === 'search') {
          c.gap = TUNE.searchGap + Math.sin(run.t * 0.9) * 0.6;
          if (run.hideT >= hideWindow()) { c.reach = 1; caught('found'); return; }
          if (c.timer <= 0) { c.mode = 'leave'; c.timer = 2.4 + Math.random(); }
        } else if (c.mode === 'leave') {
          c.gap = Math.min(TUNE.maxGap, c.gap + TUNE.leaveSpeed * dt);
          if (c.timer <= 0) { c.mode = 'lost'; c.timer = 1.4 + Math.random() * 2; }
        } else if (c.mode === 'lost') {
          if (c.timer <= 0) c.mode = 'seek';
        }
      }
      c.gap = Math.min(TUNE.maxGap, c.gap);
      // presentation
      c.facing = c.mode === 'leave' || c.mode === 'lost' ? -1 : 1;
      const moving = c.mode === 'hunt' || c.mode === 'seek' || c.mode === 'leave' || c.mode === 'reacquire';
      const prevPh = c.phase;
      c.phase += dt * (moving ? 2.3 : c.mode === 'search' ? 1.0 : 0.35);
      if (Math.floor(prevPh / Math.PI) !== Math.floor(c.phase / Math.PI) && moving) audio.creatureStep(clamp(1 - c.gap / 32, 0, 1));
      c.reach = lerp(c.reach, c.mode === 'search' ? 0.55 + 0.45 * Math.sin(run.t * 1.9) : 0, Math.min(1, dt * 4));
      c.scan = c.mode === 'search' ? Math.round(Math.sin(run.t * 1.3) * 2) / 2 : c.mode === 'lost' ? -1 : 0;
      if (c.gap <= TUNE.catchGap && !hidden) caught('caught');
    }

    // ---------- the traveller ----------
    function resolveObstacle(ob) {
      ob.done = true;
      const w = ob.x1 - ob.x0, fast = run.act === 'run' && !run.tired && run.speed > 3.5;
      if (ob.k === 'low') {
        if (fast) { setAct('vault', (w + 1.0) / run.speed); run.stamina = Math.max(0, run.stamina - 0.03); run.airMax = 6; audio.leap(); }
        else if (run.speed <= 3.5) { setAct('climb', (w + 0.6) / 1.3); }
        else { setAct('stumble', 0.7); audio.thud(); haptic('warning'); dust(); run.dist = Math.max(run.dist, ob.x1 + 0.1); }
      } else if (ob.k === 'hole') {
        if (fast) { setAct('leap', (w + 1.4) / run.speed); run.stamina = Math.max(0, run.stamina - 0.05); run.airMax = 10; audio.leap(); haptic('light'); }
        else { setAct('fall', 1.35); run.fallTo = ob.x1 + 0.3; run.dist = (ob.x0 + ob.x1) / 2; audio.thud(); haptic('warning'); dust(); }
      } else if (ob.k === 'snag') {
        if (run.speed > 3.2) { setAct('stumble', 0.9); run.stamina = Math.max(0, run.stamina - 0.06); audio.thud(); haptic('warning'); run.dist = ob.x0 - 0.1; run.snagOb = ob; }
        else { setAct('duck', (w + 0.9) / Math.max(1.4, run.speed)); }
      }
    }
    function setAct(a, dur) { run.act = a; run.actT = 0; run.actDur = dur || 0; }
    function dust() { for (let i = 0; i < 6; i++) spark(L.PX + (Math.random() - 0.5) * 8, L.yFeet - 1, (Math.random() - 0.5) * 20, -10 - Math.random() * 14, 0.5, 'groundLit'); }

    function stepPlay(dt) {
      const d = diff(), hold = input.held;
      run.t += dt;
      if (hold && !run.started) { run.started = true; run.c.timer = 0; }
      if (!run.started) run.idleT += dt;
      const zone = world.zoneAt(run.dist);
      run.inZone = zone;
      const locked = run.act === 'vault' || run.act === 'leap' || run.act === 'stumble' || run.act === 'fall' || run.act === 'climb' || run.act === 'duck';
      if (locked) {
        run.actT += dt;
        if (run.act === 'stumble' || run.act === 'fall') run.speed = 0;
        else if (run.act === 'climb') run.speed = 1.3;
        else if (run.act === 'duck') run.speed = Math.max(1.4, Math.min(run.speed, TUNE.walk));
        const u = clamp(run.actT / Math.max(0.01, run.actDur), 0, 1);
        run.airH = run.act === 'vault' || run.act === 'leap' ? Math.sin(u * Math.PI) * run.airMax : run.act === 'climb' ? Math.sin(u * Math.PI) * 2 : 0;
        if (run.actT >= run.actDur) {
          if (run.act === 'fall') run.dist = run.fallTo;
          if (run.snagOb) { run.dist = run.snagOb.x1 + 0.2; run.snagOb = null; }
          run.airH = 0; run.act = hold ? 'run' : 'walk';
          if (run.act === 'run' && run.speed < 2) run.speed = 2;
        }
      } else if (hold) {
        if (run.act === 'hide') { audio.rustle(0.8); for (let i = 0; i < 5; i++) spark(L.PX + (Math.random() - 0.3) * 10, L.yFeet - 10 - Math.random() * 8, 10 + Math.random() * 20, -14, 0.6, 'tassel'); }
        run.act = 'run';
        const target = runSpeed();
        run.speed = run.speed < target ? Math.min(target, run.speed + TUNE.accel * dt) : Math.max(target, run.speed - TUNE.decel * dt);
      } else {
        if (zone && run.act !== 'hide' && run.started) {
          if (run.c.gap < TUNE.seenGap && run.c.mode !== 'wake') { caught('seen'); return; }
          run.act = 'hide'; run.speed = 0; zone.rustle = 1; audio.rustle(1); haptic('light');
          save.hints.hide = 1;
        }
        if (run.act !== 'hide') {
          run.act = run.started ? 'walk' : 'stand';
          const target = run.started ? TUNE.walk * (run.tired ? 0.8 : 1) : 0;
          run.speed = run.speed > target ? Math.max(target, run.speed - TUNE.decel * dt) : Math.min(target, run.speed + TUNE.accel * dt);
        }
      }
      // stamina
      if (run.act === 'run') run.stamina -= (TUNE.drain + TUNE.drainGain * d) * dt;
      else if (run.act === 'hide') run.stamina += (TUNE.recoverHide - 0.08 * d) * dt;
      else if (run.act === 'walk' || run.act === 'stand' || run.act === 'duck' || run.act === 'climb') run.stamina += TUNE.recoverWalk * dt;
      run.stamina = clamp(run.stamina, 0, 1);
      if (run.stamina <= 0.001 && !run.tired) { run.tired = true; haptic('warning'); }
      if (run.tired && run.stamina >= TUNE.rested) run.tired = false;
      // the hiding clock winds down slowly once you leave cover, so ducking out and back in buys nothing
      run.hideT = run.act === 'hide' ? run.hideT + dt : Math.max(0, run.hideT - dt * 0.8);
      // move
      run.dist += run.speed * dt;
      const prevStep = run.stepPh;
      run.ph += dt * (run.act === 'run' ? 2.4 + run.speed * 1.05 : 3.4 + run.speed * 1.4);
      run.stepPh = Math.floor(run.ph / Math.PI);
      if (run.stepPh !== prevStep && run.speed > 0.5 && run.airH === 0) audio.step(run.act !== 'run');
      // obstacles ahead
      if (!locked && run.act !== 'hide') {
        const ob = world.nextObstacle(run.dist);
        if (ob) {
          const lead = ob.k === 'hole' ? 0.6 : ob.k === 'snag' ? 0.35 : 0.45;
          if (run.dist >= ob.x0 - lead) resolveObstacle(ob);
          else if (ob.x0 - run.dist < 11) {
            if (ob.k === 'hole') showHint('hole', 'KEEP HOLDING TO LEAP');
            else if (ob.k === 'snag') showHint('snag', 'LET GO TO DUCK UNDER');
          }
        }
      }
      // hints
      if (!run.started && run.t > 0.6 && !run.hint) { run.hint = 'HOLD TO RUN'; run.hintT = 99; }
      if (run.started && run.hint === 'HOLD TO RUN') run.hintT = Math.min(run.hintT, 0.4);
      if (zone && run.act !== 'hide' && !save.hints.hide && run.hint !== 'LET GO TO HIDE') { run.hint = 'LET GO TO HIDE'; run.hintT = 2.5; }
      if (run.hintT > 0) { run.hintT -= dt; if (run.hintT <= 0) run.hint = ''; }
      updateCreature(dt);
      if (mode !== 'play') return;
      // heart while it searches beside you
      if (run.act === 'hide' && run.c.gap < 12) { run.heartT -= dt; if (run.heartT <= 0) { audio.heart(clamp(1 - run.c.gap / 12, 0.3, 1)); run.heartT = run.c.mode === 'search' ? 0.55 : 0.8; } }
      // world, stages, events
      world.update(run.dist, d, Math.floor(stageAt(run.dist)));
      const st = Math.floor(stageAt(run.dist) + 0.5);
      if (st > run.stageShown) { run.stageShown = st; run.stageToast = 3; try { ctx.platform.milestone && ctx.platform.milestone('stage_' + st); } catch (e) { } }
      if (run.stageToast > 0) run.stageToast -= dt;
      events(dt);
      if (run.act === 'tired' || (run.tired && run.act === 'run')) { if (Math.random() < dt * 3) spark(L.PX + 12, L.yFeet - 20, 6 + Math.random() * 6, -6, 0.7, 'cream', 'puff'); }
      if (run.stir.t > 0) run.stir.t -= dt;
      for (const f of world.feats) if (f.rustle) f.rustle = Math.max(0, f.rustle - dt * (run.act === 'hide' && f === zone && run.c.mode === 'search' ? 0.2 : 1.5));
      if (run.act === 'hide' && zone && run.c.mode === 'search' && Math.random() < dt * 1.5) zone.rustle = 1;
      for (const f of world.props) { if (f.lit > 0) f.lit -= dt; if (f.watch) f.look = lerp(f.look || 0, clamp((L.PX - propX(f)) / 10, -2, 2), dt * 3); }
      for (const f of world.feats) if (f.lit > 0) f.lit -= dt;
    }
    function propX(f) { return Math.round((f.x - run.dist) * PPM * 0.85 + L.PX); }

    function events(dt) {
      run.events -= dt; run.caw -= dt; run.creak -= dt;
      if (run.caw <= 0) { audio.caw(); run.caw = 7 + Math.random() * 9; }
      if (run.creak <= 0) { audio.creak(); run.creak = 9 + Math.random() * 8; }
      if (scene.windmillStop > 0) { scene.windmillStop -= dt; scene.windmillSpin = lerp(scene.windmillSpin, 0, dt * 2); } else scene.windmillSpin = lerp(scene.windmillSpin, 1, dt);
      if (scene.figure > 0) scene.figure -= dt;
      if (run.events > 0) return;
      run.events = 4 + Math.random() * 5;
      const r = Math.random();
      if (r < 0.22) spawnBats();
      else if (r < 0.40) { const pr = world.props.find(p => p.k === 'scarecrow' && propX(p) > L.PX + 10 && propX(p) < L.W); if (pr) pr.watch = true; else spawnBats(); }
      else if (r < 0.58) {
        const pk = world.props.find(p => p.k === 'pumpkin' && Math.abs(propX(p) - L.W * 0.6) < L.W * 0.4) || world.feats.find(f => f.v === 'pumpkin' && f.x0 > run.dist);
        if (pk) pk.lit = 1.3;
      }
      else if (r < 0.76) { run.stir.x = run.dist + 2 + Math.random() * 6; run.stir.t = 2.2; audio.rustle(0.7); }
      else if (r < 0.88) scene.windmillStop = 6;
      else if (run.c.gap < 26) { scene.figure = 1.1; scene.figureX = L.W * (0.55 + Math.random() * 0.35); }
    }
    function spawnBats() {
      const dir = Math.random() < 0.5 ? 1 : -1, y0 = L.H * (0.1 + Math.random() * 0.2);
      for (let i = 0; i < 9; i++) run.bats.push({ x: dir > 0 ? -10 - i * 7 - Math.random() * 10 : L.W + 10 + i * 7, y: y0 + (Math.random() - 0.5) * 22, vx: dir * (45 + Math.random() * 25), ph: Math.random() * 6 });
      audio.bats();
    }

    // ---------- input ----------
    let buttons = [];
    const pauseRect = () => ({ x: W - 15, y: safeT + 2, w: 13, h: 13 });
    function toLogical(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) * dpr - offX) / SC, y: ((e.clientY - rect.top) * dpr - offY) / SC };
    }
    const inRect = (p, r) => p.x >= r.x - 3 && p.x <= r.x + r.w + 3 && p.y >= r.y - 3 && p.y <= r.y + r.h + 3;
    function press(p) {
      if (mode === 'play') {
        if (inRect(p, pauseRect())) { pause(); return false; }
        return true;
      }
      if (modeT < 0.35) return false;
      for (const bt of buttons) if (inRect(p, bt)) { audio.ui(); bt.fn(); return false; }
      if (mode === 'title') { audio.ui(); begin(); }
      return false;
    }
    ctx.listen(canvas, 'pointerdown', e => {
      audio.unlock();
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (er) { }
      if (press(toLogical(e))) input.pointers.add(e.pointerId);
      e.preventDefault && e.preventDefault();
    });
    const up = e => { input.pointers.delete(e.pointerId); };
    ctx.listen(canvas, 'pointerup', up);
    ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(canvas, 'lostpointercapture', up);
    const HOLD_KEYS = { Space: 1, ArrowRight: 1, ArrowUp: 1, KeyD: 1, KeyW: 1 };
    ctx.listen(window, 'keydown', e => {
      audio.unlock();
      if (HOLD_KEYS[e.code]) {
        e.preventDefault && e.preventDefault();
        if (mode === 'play') input.key = true;
        else if (!e.repeat && (mode === 'title' || mode === 'over') && modeT > 0.35) { audio.ui(); begin(); }
      } else if (e.code === 'Enter' && !e.repeat) {
        if (mode === 'title' || mode === 'over') { if (modeT > 0.35) { audio.ui(); begin(); } }
        else if (mode === 'paused') resume();
      } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (mode === 'play') pause(); else if (mode === 'paused') resume();
      }
    });
    ctx.listen(window, 'keyup', e => { if (HOLD_KEYS[e.code]) input.key = false; });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) { pause(); audio.suspend(); } });
    ctx.listen(window, 'blur', () => { input.key = false; input.pointers.clear(); });

    // ---------- drawing ----------
    function creatureView(c, t) {
      const gap = c.gap;
      if (gap >= 26) {
        const u = clamp((gap - 26) / 18, 0, 1);
        // it sinks into the corn and rises again; nearer, it shows more often
        const show = Math.sin(t * 0.55 + 1) > lerp(-0.4, 0.45, u) ? 1 : 0;
        c.sink = lerp(c.sink || 0, show ? 0 : 14, 0.06);
        return { layer: 'far', k: 0.3, x: Math.round(lerp(W * 0.22, W * 0.07, u) + Math.sin(t * 0.3) * 3), gy: Math.round(L.yDist + 30 + c.sink) };
      }
      if (gap >= 11) {
        const u = (26 - gap) / 15;
        return { layer: 'mid', k: Math.round(lerp(0.45, 0.72, u) * 20) / 20, x: Math.round(lerp(W * 0.08, L.PX - 46, u) + Math.sin(t * 0.4) * 3), gy: Math.round(lerp(L.yMid + 40, L.yBack + 30, u)) };
      }
      const u = (11 - gap) / 11;
      return { layer: 'near', k: Math.round(lerp(0.78, 1.0, u) * 20) / 20, x: Math.round(L.PX - 12 - gap * 3.6), gy: L.yFeet - 4 };
    }
    function drawCreatureAt(v, c, p, t, extra) {
      drawCreature(v.x, v.gy, v.k, Object.assign({ facing: c.facing, phase: Math.floor(c.phase * 8 / TAU * 2) / (8 / TAU * 2), t, reach: c.reach, rx: L.PX + 6 + Math.sin(t * 0.9) * 12, ry: L.yFeet - 12, scan: c.scan, eyes: c.eyes, tilt: Math.round(Math.sin(t * 0.37) * 2) / 10 }, extra || {}), p);
    }
    function drawShadow(v, p, strength) {
      // its shadow reaches along the path before it does (the sun is behind it)
      const len = Math.round(lerp(10, 70, strength)), x0 = v.x - 2, y0 = L.yFeet - 4;
      poly([x0, y0, x0 + 5, y0, x0 + len + 8, y0 + 7, x0 + len, y0 + 8], FIX.ink, true);
      poly([x0 + len * 0.55, y0 + 3, x0 + len * 0.55 + 3, y0 + 3, x0 + len + 14, y0 - 2, x0 + len + 12, y0 - 1], FIX.ink, true);
    }

    function drawWorld(p, stageF, dist, t, dt, cr, playerPose, hidden, zoneNow) {
      const camPx = dist * PPM - L.PX;
      scene.drawSky(L, p, stageF, camPx, t);
      // birds drift high and slow
      for (let i = 0; i < 3; i++) {
        const x = Math.round(((i * 61 + t * (4 + i)) % (W + 40)) - 20), y = Math.round(L.H * (0.12 + i * 0.05) + Math.sin(t * 0.8 + i) * 2);
        const up = Math.floor(t * 3 + i) & 1;
        R(x - 2, y - up, 2, 1, p.sil); R(x + 1, y - up, 2, 1, p.sil); R(x, y, 1, 1, p.sil);
      }
      if (run) for (const bt of run.bats) {
        const x = Math.round(bt.x), y = Math.round(bt.y + Math.sin(bt.ph) * 3), f = Math.floor(bt.ph * 2) % 3;
        R(x - 1, y, 3, 1, FIX.ink);
        if (f === 0) { R(x - 3, y - 1, 2, 1, FIX.ink); R(x + 2, y - 1, 2, 1, FIX.ink); }
        else if (f === 1) { R(x - 3, y, 2, 1, FIX.ink); R(x + 2, y, 2, 1, FIX.ink); }
        else { R(x - 3, y + 1, 2, 1, FIX.ink); R(x + 2, y + 1, 2, 1, FIX.ink); }
      }
      scene.drawDistance(L, p, camPx, t, dt);
      if (cr && cr.v.layer === 'far') drawCreatureAt(cr.v, cr.c, p, t);
      scene.drawDistCorn(L, p, camPx, t);
      if (cr && cr.v.layer === 'mid') drawCreatureAt(cr.v, cr.c, p, t);
      scene.drawMidCorn(L, p, camPx, t);
      // back-row pumpkins sit low in the stalks
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'back') { const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFeet - 5, 0, p, pr.lit || 0); }
      scene.drawBackRow(L, p, camPx, t, run && run.stir);
      for (const pr of world.props) {
        if (pr.k === 'pumpkin') continue;
        const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX);
        if (x > -30 && x < W + 30) drawProp(pr, x, L, p, t);
      }
      if (cr && cr.v.layer === 'near') drawCreatureAt(cr.v, cr.c, p, t, cr.extra);
      scene.drawPath(L, p, camPx);
      if (cr && cr.v.layer !== 'far') drawShadow(cr.v, p, cr.v.layer === 'near' ? 1 : 0.35);
      for (const f of world.feats) {
        if (f.k === 'hide') continue;
        const sx = (f.x0 - dist) * PPM + L.PX, ex = (f.x1 - dist) * PPM + L.PX;
        if (ex > -20 && sx < W + 20) drawObstacle(f, Math.round(sx), Math.round(ex), L, p, t);
      }
      if (playerPose) {
        const info = drawPlayer(L.PX - 8, L.yFeet - Math.round(playerPose.air || 0), playerPose);
        playerPose.top = info.top;
      }
      scene.drawFront(L, p, camPx, t);
      for (const f of world.feats) if (f.k === 'hide') scene.drawClump(L, p, camPx, f, t, f.rustle || 0);
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'front') { const x = Math.round((pr.x - dist) * PPM + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFront + 8, pr.size, p, pr.lit || 0); }
      // foreground blades at the bottom edge frame the picture
      const fo = camPx * 1.3;
      for (let i = Math.floor(fo / 34) - 1; i <= Math.floor((fo + W) / 34) + 1; i++) {
        const hh = hash(i + 4242); if (hh > 0.45) continue;
        const x = Math.round(i * 34 - fo + hh * 20), top = L.H - 14 - Math.round(hh * 22);
        poly([x, L.H, x + 3, L.H, x + 6 + hh * 8, top, x + 2 + hh * 6, top + 2], FIX.ink);
        R(x + 1, top + 10, 1, 4, p.frontLeaf);
      }
    }

    function drawButton(label, cx, y, fn, primary) {
      const w = textW(label, F5) + 12, x = Math.round(cx - w / 2), h = 13;
      R(x, y, w, h, FIX.ink);
      R(x, y, w, 1, primary ? FIX.cream : '#8a6a5a'); R(x, y + h - 1, w, 1, primary ? FIX.cream : '#8a6a5a');
      R(x, y, 1, h, primary ? FIX.cream : '#8a6a5a'); R(x + w - 1, y, 1, h, primary ? FIX.cream : '#8a6a5a');
      R(x + 1, y + h, w, 1, '#000000');
      text(label, x + 6, y + 3, primary ? FIX.cream : '#d9c09a', F5);
      if (primary && Math.floor(clock * 2) % 2 === 0) { R(x - 5, y + 4, 1, 5, FIX.cream); R(x - 4, y + 5, 1, 3, FIX.cream); R(x - 3, y + 6, 1, 1, FIX.cream); }
      buttons.push({ x, y, w, h, fn });
    }
    function tag(label, cx, y, c) {
      const w = textW(label, F3) + 6, x = Math.round(cx - w / 2);
      R(x, y, w, 9, FIX.ink); text(label, x + 3, y + 2, c || FIX.cream, F3);
      return { x, w };
    }

    function drawHUD(p) {
      const y0 = safeT + 4;
      text('DISTANCE', 4, y0, FIX.cream, F3, 1, FIX.ink);
      text(Math.floor(run.dist) + ' M', 4, y0 + 7, FIX.cream, F5, 1, FIX.ink);
      text('BEST ' + Math.max(save.best, Math.floor(run.dist)) + ' M', 4, y0 + 17, FIX.cream, F3, 1, FIX.ink);
      const pr = pauseRect();
      R(pr.x, pr.y, pr.w, pr.h, FIX.ink); R(pr.x + 4, pr.y + 3, 2, 7, FIX.cream); R(pr.x + 8, pr.y + 3, 2, 7, FIX.cream);
      // danger: it is close and still has you
      const c = run.c, hunting = c.mode === 'hunt' || c.mode === 'reacquire';
      if (hunting && c.gap < 14 && run.act !== 'hide') {
        const hot = c.gap < 7;
        if (Math.floor(clock * (hot ? 6 : 3)) % 2 === 0 || !hot) {
          const t = tag('DANGER', W / 2, y0 + 1, hot ? FIX.ember : FIX.cream);
          R(t.x - 4, y0 + 4, 2, 2, FIX.glowHot); R(t.x + t.w + 2, y0 + 4, 2, 2, FIX.glowHot);
        }
      }
      if (run.stageToast > 0 && run.stageShown > 0) {
        const nm = STAGE_NAMES[Math.min(3, run.stageShown)], y = Math.round(H * 0.36);
        if (run.stageToast > 0.4 || Math.floor(clock * 8) % 2) {
          const w = textW(nm, F3);
          text(nm, W / 2 - w / 2, y, FIX.cream, F3, 1, FIX.ink);
          R(Math.round(W / 2 - w / 2 - 10), y + 2, 6, 1, FIX.cream); R(Math.round(W / 2 + w / 2 + 4), y + 2, 6, 1, FIX.cream);
        }
      }
      if (run.hint) tag(run.hint, W / 2, Math.round(H * 0.42), FIX.cream);
      // contextual tags above the traveller
      const top = (run.pose && run.pose.top) || L.yFeet - 26;
      if (run.inZone && run.act !== 'hide' && run.started) {
        if (Math.floor(clock * 4) % 2 === 0 || run.c.gap > 14) {
          tag('HIDE', L.PX, top - 13, FIX.glow);
          R(L.PX - 1, top - 4, 3, 1, FIX.ink); R(L.PX, top - 3, 1, 1, FIX.ink);
        }
      }
      if (run.act === 'hide') {
        const win = hideWindow(), left = clamp(1 - run.hideT / win, 0, 1), n = Math.ceil(left * 5);
        const x0 = L.PX - 7, y = top - 7;
        R(x0 - 2, y - 2, 18, 6, FIX.ink);
        for (let i = 0; i < 5; i++) {
          const on = i < n, warn = n <= 1 && Math.floor(clock * 6) % 2 === 0;
          R(x0 + i * 3, y, 2, 2, on ? (warn ? FIX.ember : FIX.cream) : '#4a3a32');
        }
      }
      // breath: the only meter
      const bw = 40, bx = Math.round(W / 2 - bw / 2 + 12), by = H - 9 - safeB;
      text('BREATH', bx - 27, by - 1, run.tired ? FIX.ember : FIX.cream, F3, 1, FIX.ink);
      R(bx - 1, by - 1, bw + 2, 5, FIX.ink);
      const low = run.stamina < TUNE.tiredAt, fc = run.tired ? (Math.floor(clock * 4) % 2 ? FIX.ember : '#7a2a2a') : low ? (Math.floor(clock * 3) % 2 ? FIX.ember : FIX.glow) : FIX.cream;
      R(bx, by, Math.round(bw * run.stamina), 3, fc);
      R(bx + Math.round(bw * TUNE.rested), by + 3, 1, 1, '#8a6a5a');
    }

    function playerPose() {
      const a = run.act;
      let m = 'idle';
      if (a === 'run') m = run.tired ? 'tired' : 'run';
      else if (a === 'walk') m = run.tired ? 'tired' : 'walk';
      else if (a === 'hide') m = 'crouch';
      else if (a === 'duck') m = 'duck';
      else if (a === 'vault' || a === 'leap') m = 'air';
      else if (a === 'climb') m = 'walk';
      else if (a === 'stumble') m = 'tired';
      else if (a === 'fall') m = 'crouch';
      let air = run.airH || 0;
      if (a === 'fall') { const u = run.actT / run.actDur; air = u < 0.3 ? -u / 0.3 * 9 : -9 + (u - 0.3) / 0.7 * 9; }
      const blink = (clock % 3.1) < 0.12;
      return { mode: m, ph: run.ph, t: clock, air, blink, lift: 0 };
    }

    function render(dt) {
      setTarget(b);
      buttons = [];
      const t = clock;
      if (mode === 'title') {
        const p = paletteAt(0);
        const c = { facing: 1, phase: 0.6, reach: 0, scan: Math.round(Math.sin(t * 0.4) * 2) / 2, eyes: (t % 4.3) < 0.15 ? 0 : 1 };
        const v = { layer: 'far', k: 0.62, x: Math.round(W * 0.76), gy: Math.round(L.yDist + 16) };
        drawWorld(p, 0, 0, t, dt, { v, c }, { mode: 'idle', ph: 0, t, blink: (t % 3.3) < 0.12 }, false, null);
        // title, set like a book cover
        const ty = safeT + Math.round(H * 0.07);
        textC('HOLLOW', W / 2, ty, FIX.cream, F5, 2, '#5a1a2a');
        textC('HARVEST', W / 2, ty + 18, FIX.cream, F5, 2, '#5a1a2a');
        R(Math.round(W / 2 - 30), ty + 36, 60, 1, '#5a1a2a');
        textC('SOMETHING IS IN THE FIELD.', W / 2, ty + 40, '#5a1a2a', F3);
        const by = H - safeB - Math.round(H * 0.15);
        drawButton('ENTER THE FIELD', W / 2, by, begin, true);
        textC('HOLD TO RUN. LET GO TO HIDE.', W / 2, by + 18, FIX.cream, F3, 1, FIX.ink);
        if (save.best > 0) textC('BEST ' + save.best + ' M', W / 2, by + 26, '#d9c09a', F3, 1, FIX.ink);
        return;
      }
      if (mode === 'over') { renderOver(); return; }
      const stageF = stageAt(run.dist), p = paletteAt(stageF);
      const pose = playerPose(); run.pose = pose;
      let cr = { v: creatureView(run.c, t), c: run.c };
      if (run.c.mode === 'wake') cr.c = Object.assign({}, run.c, { phase: 0.4 });
      if (mode === 'caught') {
        const ct = modeT;
        if (ct >= 0.6) { renderCaughtClose(p, ct); return; }
        const u = clamp(ct / 0.45, 0, 1);
        cr.v = { layer: 'near', k: 1.05, x: Math.round(lerp(cr.v.x, L.PX - 16, u)), gy: L.yFeet - 4 };
        const top = pose.top || L.yFeet - 26;
        cr.extra = { reach: Math.min(1, u * 1.3), rx: L.PX - 1, ry: top + 6 - Math.max(0, ct - 0.3) * 40 };
        cr.c = Object.assign({}, run.c, { facing: 1 });
        pose.mode = ct > 0.3 ? 'lifted' : 'crouch'; pose.lift = Math.max(0, ct - 0.3) * 40; pose.air = 0;
      }
      drawWorld(p, stageF, run.dist, t, dt, cr, pose, run.act === 'hide', run.inZone);
      // particles
      for (const q of run.particles) {
        const c = FIX[q.c] || p[q.c] || q.c;
        if (q.kind === 'puff') { if (q.life / q.max > 0.3) R(Math.round(q.x), Math.round(q.y), 2, 1, c); }
        else if (q.kind === 'leaf') { const f = Math.floor(q.life * 6) & 1; R(Math.round(q.x), Math.round(q.y), f ? 2 : 1, f ? 1 : 2, c); }
        else R(Math.round(q.x), Math.round(q.y), 1, 1, c);
      }
      // threat: the field darkens and the edges close in
      const c = run.c;
      let threat = 0;
      if (run.act !== 'hide') threat = clamp((14 - c.gap) / 12, 0, 1) * (c.mode === 'hunt' || c.mode === 'reacquire' ? 1 : 0.4);
      else threat = c.mode === 'search' ? 0.55 : c.gap < 12 ? 0.3 : 0;
      run.threat = threat;
      if (threat > 0.05) { G.globalAlpha = 0.24 * threat; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      const vl = Math.max(stageF > 2.5 ? 1 : 0, threat > 0.75 ? 3 : threat > 0.45 ? 2 : threat > 0.12 ? 1 : 0);
      if (vl > 0) G.drawImage(vign[vl - 1], 0, 0);
      if (run.act === 'hide') { G.globalAlpha = 0.16; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      if (mode === 'play' || mode === 'paused') drawHUD(p);
      if (mode === 'paused') {
        G.globalAlpha = 0.7; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1;
        textC('PAUSED', W / 2, Math.round(H * 0.34), FIX.cream, F5, 2, '#5a1a2a');
        drawButton('RESUME', W / 2, Math.round(H * 0.50), resume, true);
        drawButton('MAIN MENU', W / 2, Math.round(H * 0.50) + 20, toTitle, false);
      }
    }
    function renderCaughtClose(p, ct) {
      if (ct < 1.15) {
        // the silhouette fills the frame, in two hard steps
        R(0, 0, W, H, p.sky1);
        R(0, Math.round(H * 0.62), W, H, FIX.blood);
        const k = ct < 0.85 ? 1.8 : 2.5;
        drawCreature(Math.round(W * 0.42), Math.round(H * (ct < 0.85 ? 1.05 : 1.22)), k, { facing: 1, phase: 0.3, t: clock, reach: 0, scan: 0, eyes: 1, tilt: 0.1 }, p);
        G.drawImage(vign[2], 0, 0);
        return;
      }
      R(0, 0, W, H, FIX.blood);
      if (ct < 1.6) { const ex = Math.round(W * 0.5), ey = Math.round(H * 0.3); R(ex - 9, ey, 3, 3, FIX.glowHot); R(ex + 5, ey + 1, 3, 3, FIX.glowHot); }
    }
    function renderOver() {
      R(0, 0, W, H, FIX.blood);
      // faint dither band and a pair of eyes that do not leave
      for (let y = Math.round(H * 0.7); y < H; y++) for (let x = (y & 1); x < W; x += 2) if (((x >> 1) + y) % 3 === 0) R(x, y, 1, 1, FIX.bloodHi);
      if ((clock % 5) > 0.2) { const ex = Math.round(W * 0.5), ey = safeT + Math.round(H * 0.1); R(ex - 7, ey, 2, 2, FIX.ember); R(ex + 4, ey + 1, 2, 2, FIX.ember); }
      const msg = 'THE HARVEST IS OVER.', y1 = Math.round(H * 0.27);
      if (textW(msg, F5) <= W - 8) textC(msg, W / 2, y1, FIX.cream, F5, 1, '#000000');
      else { textC('THE HARVEST', W / 2, y1 - 5, FIX.cream, F5, 1, '#000000'); textC('IS OVER.', W / 2, y1 + 5, FIX.cream, F5, 1, '#000000'); }
      const cause = run.cause === 'found' ? 'IT FOUND YOUR HIDING PLACE.' : run.cause === 'seen' ? 'IT SAW YOU GO INTO THE CORN.' : 'IT CAUGHT UP.';
      textC(cause, W / 2, y1 + 16, '#c98a7c', F3);
      const d = Math.floor(run.dist);
      textC('DISTANCE: ' + d + ' M', W / 2, Math.round(H * 0.43), FIX.cream, F5, 1, '#000000');
      textC('PERSONAL BEST: ' + save.best + ' M', W / 2, Math.round(H * 0.43) + 12, '#d9c09a', F3);
      if (run.record && Math.floor(clock * 3) % 2 === 0) textC('NEW BEST', W / 2, Math.round(H * 0.43) + 21, FIX.glow, F3);
      const by = Math.round(H * 0.62);
      drawButton('TRY AGAIN', W / 2, by, begin, true);
      drawButton('MAIN MENU', W / 2, by + 20, toTitle, false);
    }

    // ---------- blit: whole pixels only ----------
    function blit() {
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#0b0807'; g.fillRect(0, 0, canvas.width, canvas.height);
      const unstable = mode === 'play' && run.threat > 0.65 && run.act !== 'hide';
      if (!unstable) { g.drawImage(buf, 0, 0, W, H, offX, offY, W * SC, H * SC); return; }
      run.jitterT -= 1 / 60;
      if (run.jitterT <= 0) {
        run.jitterT = 0.07; run.jitter.length = 0;
        for (let y = 0; y < H; y += 4) run.jitter.push(Math.random() < (run.threat - 0.6) * 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      }
      for (let i = 0, y = 0; y < H; y += 4, i++) {
        const h = Math.min(4, H - y), dx = run.jitter[i] || 0;
        g.drawImage(buf, 0, y, W, h, offX + dx * SC, offY + y * SC, W * SC, h * SC);
      }
    }

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function updateFx(dt) {
      if (!run) return;
      for (const q of run.particles) { q.x += q.vx * dt - (mode === 'play' ? run.speed * PPM * dt : 0); q.y += q.vy * dt; q.vy += (q.kind === 'leaf' ? 4 : q.kind === 'puff' ? -4 : 30) * dt; q.life -= dt; if (q.kind === 'leaf') q.vx += Math.sin(clock * 3 + q.y) * 6 * dt; }
      run.particles = run.particles.filter(q => q.life > 0 && q.x > -10 && q.x < W + 10);
      for (const bt of run.bats) { bt.x += bt.vx * dt; bt.ph += dt * 14; bt.y += Math.sin(bt.ph * 0.3) * 0.3; }
      run.bats = run.bats.filter(bt => bt.x > -90 && bt.x < W + 90);
      if (Math.random() < dt * 1.4) spark(W * (0.3 + Math.random() * 0.8), L.yBack - 6 - Math.random() * 20, -8 - Math.random() * 8, 4, 4, Math.random() < 0.5 ? 'pumpkin' : 'backLeafLit', 'leaf');
    }
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      clock += dt; modeT += dt;
      if (mode === 'play') {
        acc += dt; let n = 0;
        while (acc >= DT && n < 6 && mode === 'play') { stepPlay(DT); acc -= DT; n++; }
        if (n === 6) acc = 0;
      } else acc = 0;
      if (mode === 'caught' && modeT > 1.75) { mode = 'over'; modeT = 0; }
      if (mode !== 'paused') updateFx(dt);
      const playing = mode === 'play';
      audio.update({
        dt, playing, hidden: playing && run.act === 'hide',
        run: playing ? clamp(run.speed / 8, 0, 1) : 0,
        prox: playing ? clamp(1 - run.c.gap / 26, 0, 1) : mode === 'caught' ? 1 : 0,
        tired: playing && run.tired ? 1 : playing ? clamp((TUNE.tiredAt - run.stamina) / TUNE.tiredAt, 0, 1) * 0.5 : 0,
        exert: playing && run.act === 'run' ? 1 - run.stamina : 0,
        rustle: playing && run.inZone ? run.inZone.rustle || 0 : 0
      });
      render(dt);
      blit();
    }

    ctx.onResize(() => layout(), { immediate: true });
    if (!buf.width || buf.width === 300) layout();
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));
    tick(16);
    try { ctx.markVisualReady && ctx.markVisualReady('title'); } catch (e) { }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__HH_DEV) {
      window.__hh = {
        get run() { return run; }, get mode() { return mode; }, save: () => save, world, TUNE, begin, pause, resume, toTitle,
        hold(v) { input.key = !!v; },
        advance(sec, hold) { if (hold !== undefined) input.key = !!hold; const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) stepPlay(DT); },
        size: () => ({ W, H, SC, offX, offY })
      };
    }
  }
};
