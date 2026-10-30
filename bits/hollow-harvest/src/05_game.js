// =====================================================================
// The game: run and hide, stamina, the pursuit, screens, the Plethora
// lifecycle and the pixel-perfect blit.
// =====================================================================
const SAVE_KEY = 'hollow-harvest-v1';
// Every gameplay number lives here. Speeds are metres per second, stamina
// is 0..100, pursuit distance is metres internally and 0..100 for reading
// (100 = gapScale metres away, 0 = caught).
const TUNE = {
  // movement
  runBase: 6.2, runGain: 2.2, walk: 2.0, accel: 18, decel: 16, tiredRun: 0.6, tiredWalk: 0.85,
  // stamina (0..100)
  drain: 8.8, drainGain: 3.0, recoverHide: 26, recoverHideLoss: 6, recoverWalk: 0.8, low: 30, rested: 25,
  // pursuit
  gapScale: 40, startGap: 34, maxGap: 44, huntBase: 6.75, huntGain: 2.3, tiredHunt: 0.3,
  followAt: 65, dangerAt: 35, immediateAt: 15,
  seenGap: 3.0, catchGap: 1.2, sweepAt: 6.0, passBy: 1.6, sweepSpeed: 3.0, checkGap: 2.5,
  withdrawSpeed: 6.5, withdrawTime: 2.6, safeShrink: 0.75,
  // collisions: [stumble seconds, stamina lost, metres the creature gains]
  hitLow: [0.55, 8, 1.5], hitSnag: [0.85, 12, 2.5], hitPit: [1.1, 12, 3.0],
  vaultCost: 3, leapCost: 5, minClearStamina: 8,
  // difficulty ramps from 0 to 1 over this window of run time
  easyFor: 15, rampOver: 70
};
const MODES = { MENU: 'MENU', STARTING: 'STARTING', PLAYING: 'PLAYING', PAUSED: 'PAUSED', CAUGHT: 'CAUGHT', GAME_OVER: 'GAME_OVER' };
const TRANSITIONS = {
  MENU: ['STARTING'],
  STARTING: ['PLAYING', 'PAUSED', 'CAUGHT'],
  PLAYING: ['PAUSED', 'CAUGHT'],
  PAUSED: ['PLAYING', 'STARTING', 'MENU'],
  CAUGHT: ['GAME_OVER'],
  GAME_OVER: ['STARTING', 'MENU']
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
    const canvas = ctx.createCanvas2D({ touchAction: 'none', alpha: false, layer: 'content' });
    canvas.style.imageRendering = 'pixelated';
    const g = canvas.getContext('2d', { alpha: false });
    // Off-screen drawing goes onto hidden SDK surfaces, never raw canvases. The host may
    // resize a surface, so every user checks its size and redraws when it changed.
    function surface(w, h) {
      const c = ctx.createCanvas2D({ input: 'passthrough', layer: 'background' });
      c.style.display = 'none'; c.width = w; c.height = h;
      return c;
    }
    const buf = surface(128, 280);
    const b = buf.getContext('2d');
    let devW = 1, devH = 1;
    let W = 128, H = 280, SC = 1, offX = 0, offY = 0, dpr = 1, L = computeLayout(W, H), safeT = 0, safeB = 0;
    const vign = [], vignCv = [];
    function buildVignettes() {
      vign.length = 0;
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const ink = hexRgb(FIX.ink);
      for (let l = 1; l <= 3; l++) {
        const cv = vignCv[l - 1] || (vignCv[l - 1] = surface(W, H)); cv.width = W; cv.height = H;
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
      devW = dw; devH = dh;
      canvas.width = dw; canvas.height = dh; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      SC = Math.max(1, Math.min(Math.floor(dw / 128), Math.floor(dh / 228)));
      W = Math.min(Math.ceil(dw / SC), 180); H = Math.min(Math.ceil(dh / SC), 330);
      offX = Math.floor((dw - W * SC) / 2); offY = Math.floor((dh - H * SC) / 2);
      buf.width = W; buf.height = H;
      L = computeLayout(W, H);
      // text and controls stay clear of the island, the home indicator and Plethora's logo button
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      safeT = Math.max(0, Math.ceil(((sa.top || 0) * dpr - Math.max(0, offY)) / SC));
      safeB = Math.max(0, Math.ceil(((sa.bottom || 0) * dpr - Math.max(0, offY)) / SC));
      scene.skyKey = '';
      buildVignettes();
    }

    const scene = createScene(surface);
    const world = createWorld(1);
    const audio = createAudio(caps.audio !== false);
    ctx.onDestroy && ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- pools: particles and flyers never allocate during play ----------
    const PARTS = [], FLY = [];
    for (let i = 0; i < 96; i++) PARTS.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '', kind: '' });
    for (let i = 0; i < 40; i++) FLY.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, ph: 0, kind: '' });
    function spark(x, y, vx, vy, life, c, kind) {
      for (const q of PARTS) if (!q.on) { q.on = true; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = q.max = life; q.c = c; q.kind = kind || 'dot'; return; }
    }
    function flyer(x, y, vx, vy, kind) {
      for (const q of FLY) if (!q.on) { q.on = true; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.ph = Math.random() * 6; q.kind = kind; return; }
    }

    // ---------- state ----------
    let mode = MODES.MENU, modeT = 0, clock = 0, pausedFrom = MODES.PLAYING;
    const input = { pointers: new Set(), key: false, get held() { return this.pointers.size > 0 || this.key; } };
    let run = null;
    function newRun() {
      const seed = (Date.now() & 0xffffff) ^ (save.runs * 7919);
      world.reset(seed);
      for (const q of PARTS) q.on = false;
      for (const q of FLY) q.on = false;
      return {
        t: 0, dist: 0, score: 0, speed: 0, stamina: 100, tired: false, idleT: 0,
        act: 'stand', actT: 0, actDur: 0, airH: 0, airMax: 0, ph: 0, stepPh: 0, after: null,
        hideT: 0, spot: null, exposed: false, settle: null, inZone: null,
        c: { gap: TUNE.startGap, mode: 'wake', timer: 0, phase: 0, facing: 1, reach: 0, scan: 0, eyes: 1, sink: 0, alerted: false },
        stageShown: 0, stageToast: 0, hint: '', hintT: 0, ev: { next: 6, cd: {} }, caw: 4, creak: 8, stir: { x: 0, t: 0 }, shade: 0,
        heartT: 0, record: false, cause: '', jitter: [], jitterT: 0, threat: 0, hits: 0, escapes: 0, log: []
      };
    }
    run = newRun();

    // a guarded state machine: an illegal transition is refused, never half-applied
    function setMode(next) {
      if (next === mode) return true;
      if (TRANSITIONS[mode].indexOf(next) < 0) { if (window.__HH_DEV) console.warn('refused', mode, '->', next); return false; }
      mode = next; modeT = 0;
      return true;
    }
    const sim = () => mode === MODES.STARTING || mode === MODES.PLAYING;

    function diff() { return clamp((run.t - TUNE.easyFor) / TUNE.rampOver, 0, 1); }
    function pursuit() { return clamp(run.c.gap / TUNE.gapScale * 100, 0, 100); }
    function huntSpeed() { return TUNE.huntBase + TUNE.huntGain * diff() + (run.tired ? TUNE.tiredHunt : 0); }
    function runSpeed() {
      let s = TUNE.runBase + TUNE.runGain * diff();
      if (run.tired) s *= TUNE.tiredRun;
      else if (run.stamina < TUNE.low) s *= lerp(0.65, 1, run.stamina / TUNE.low);
      return s;
    }
    function safeTime(spot) { return spot.safe * lerp(1, TUNE.safeShrink, diff()); }
    // hints are remembered in memory here and written with the next save (pause or the end of a run), never from the step loop
    function showHint(key, msg, dur) { if (save.hints[key]) return; save.hints[key] = 1; run.hint = msg; run.hintT = dur || 3.2; }
    function note(ev) { if (run.log.length < 400) run.log.push([+run.t.toFixed(2), ev]); }

    // The states the brief names, derived from the simulation so they can never disagree with it.
    function playerState() {
      if (mode === MODES.MENU || mode === MODES.GAME_OVER || mode === MODES.CAUGHT || mode === MODES.PAUSED) return mode;
      if (mode === MODES.STARTING) return 'STARTING';
      if (run.act === 'hide') return 'HIDING';
      if (run.tired) return 'EXHAUSTED';
      if (run.act === 'walk' || run.act === 'duck' || run.act === 'climb') return 'WALKING';
      return 'RUNNING';
    }
    function creatureState() {
      const m = run.c.mode;
      if (m === 'approach' || m === 'sweep' || m === 'check') return 'SEARCHING';
      if (m === 'withdraw' || m === 'linger' || m === 'wake' || pursuit() >= TUNE.followAt) return 'FOLLOWING';
      return 'HUNTING';
    }

    // ---------- run lifecycle ----------
    function begin() {
      if (!setMode(MODES.STARTING)) return;
      run = newRun();
      input.pointers.clear(); input.key = false; // the tap that started the run is not a hold
      save.runs++; persist();
      try { ctx.platform.start({ run: save.runs }); } catch (e) { }
    }
    function caught(cause) {
      if (!sim() || !setMode(MODES.CAUGHT)) return;
      run.cause = cause || 'caught';
      run.act = 'caught'; run.speed = 0; note('caught:' + run.cause);
      audio.sting(); haptic('heavy');
      const dist = Math.floor(run.score);
      if (dist > save.best) { save.best = dist; run.record = true; }
      persist();
      try { ctx.platform.fail({ score: dist, distance: dist, reason: run.cause }); } catch (e) { }
      try { ctx.platform.setScore && ctx.platform.setScore(dist); } catch (e) { }
      try { if (ctx.memory && ctx.memory.record) ctx.memory.record('score').submit(dist, { label: dist + ' m' }).catch(() => { }); } catch (e) { }
    }
    function pause() {
      if (!sim()) return;
      const from = mode;
      if (!setMode(MODES.PAUSED)) return;
      pausedFrom = from; input.pointers.clear(); input.key = false; audio.suspend();
      if (Math.floor(run.score) > save.best) { save.best = Math.floor(run.score); run.record = true; }
      persist();
    }
    function resume() { if (mode === MODES.PAUSED && setMode(pausedFrom)) audio.resume(); }
    function toTitle() { if (setMode(MODES.MENU)) { run = newRun(); audio.resume(); } }

    // ---------- the creature ----------
    // wake    : asleep in the far corn until the run starts
    // hunt    : it has you; it closes at its speed minus yours
    // reacquire: a beat while it picks your trail back up
    // approach: you hid; it walks to where it lost you
    // sweep   : it walks through the spot and past you, looking
    // check   : your safe time ran out; it reaches into your hiding place
    // withdraw: it gave up and walks away (its back is to you)
    // linger  : it waits out in the corn, then comes back to look again
    function updateCreature(dt) {
      const c = run.c, d = diff(), hidden = run.act === 'hide', hunt = huntSpeed();
      c.timer -= dt;
      if (c.mode === 'wake') {
        if (mode === MODES.PLAYING && run.t > 1.5) { c.mode = hidden ? 'approach' : 'hunt'; note('wake'); }
      } else if (!hidden) {
        if (c.mode === 'approach') c.mode = 'hunt';
        else if (c.mode === 'sweep' || c.mode === 'check') {
          if (Math.abs(c.gap) <= TUNE.catchGap + 0.3) { caught('seen'); return; }
          c.mode = 'reacquire'; c.timer = 0.8; c.gap = Math.max(c.gap, TUNE.catchGap + 1.3); note('bolt');
        } else if (c.mode === 'withdraw') {
          // its back is to you: it walks on, and only picks up your trail when it stops
          c.gap = Math.min(TUNE.maxGap, c.gap + (TUNE.withdrawSpeed - run.speed * 0.5) * dt);
          if (c.timer <= 0) { c.mode = 'reacquire'; c.timer = 0.7; }
        } else if (c.mode === 'linger') { c.mode = 'reacquire'; c.timer = 0.7; }
        if (c.mode === 'reacquire') { c.gap += (run.speed - hunt * 0.6) * dt; if (c.timer <= 0) c.mode = 'hunt'; }
        if (c.mode === 'hunt') c.gap -= (hunt - run.speed) * dt;
      } else {
        if (c.mode === 'hunt' || c.mode === 'reacquire') { c.mode = 'approach'; note('lost-you'); }
        if (run.exposed && !c.alerted) {
          c.alerted = true;
          if (c.mode === 'withdraw' || c.mode === 'linger') { c.mode = 'approach'; note('comes-back'); }
        }
        if (c.mode === 'approach') {
          c.gap -= (2.4 + Math.max(0, c.gap) * 0.15) * (c.alerted ? 1.4 : 1) * dt;
          if (c.gap <= TUNE.sweepAt) { c.mode = c.alerted ? 'check' : 'sweep'; c.timer = lerp(1.1, 0.8, d); audio.rustle(1.2); note(c.mode); }
        } else if (c.mode === 'sweep') {
          c.gap -= (TUNE.sweepSpeed + d * 0.4) * dt;
          if (run.exposed) { c.mode = 'check'; c.timer = lerp(1.1, 0.8, d); note('check'); }
          else if (c.gap <= TUNE.passBy) {
            c.mode = 'withdraw'; c.timer = TUNE.withdrawTime; run.escapes++; note('passed');
            audio.safe(); haptic('light'); showHint('escape', 'IT PASSED YOU BY', 2.4);
          }
        } else if (c.mode === 'check') {
          c.gap = lerp(c.gap, TUNE.checkGap, Math.min(1, dt * 3));
          if (c.timer <= 0) { c.reach = 1; caught('found'); return; }
        } else if (c.mode === 'withdraw') {
          c.gap = Math.min(TUNE.maxGap, c.gap + TUNE.withdrawSpeed * dt);
          if (c.timer <= 0) { c.mode = 'linger'; c.timer = 1.5 + Math.random() * 1.5; }
        } else if (c.mode === 'linger') {
          if (c.timer <= 0) { c.mode = 'approach'; note('returns'); }
        }
      }
      if (!hidden) c.alerted = false;
      c.gap = Math.min(TUNE.maxGap, c.gap);
      // presentation: it slows to look when searching, turns away when it leaves
      c.facing = c.mode === 'withdraw' || c.mode === 'linger' ? -1 : 1;
      const moving = c.mode === 'hunt' || c.mode === 'approach' || c.mode === 'withdraw' || c.mode === 'reacquire';
      const prevPh = c.phase;
      c.phase += dt * (moving ? 2.3 : c.mode === 'sweep' ? 1.2 : c.mode === 'check' ? 0.6 : 0.35);
      if (Math.floor(prevPh / Math.PI) !== Math.floor(c.phase / Math.PI) && (moving || c.mode === 'sweep')) audio.creatureStep(clamp(1 - Math.abs(c.gap) / 32, 0, 1));
      const reachTo = c.mode === 'check' ? 1 : c.mode === 'sweep' ? 0.5 + 0.5 * Math.sin(run.t * 1.9) : 0;
      c.reach = lerp(c.reach, reachTo, Math.min(1, dt * 4));
      c.scan = c.mode === 'sweep' ? Math.round(Math.sin(run.t * 1.3) * 2) / 2 : c.mode === 'check' ? 0 : c.mode === 'linger' ? -1 : 0;
      if (c.gap <= TUNE.catchGap && !hidden) caught('caught');
    }
    // the creature never closes the last stretch because of a stumble alone
    function pushCreature(m) { run.c.gap = Math.max(Math.min(run.c.gap, TUNE.catchGap + 1.5), run.c.gap - m); }

    // ---------- obstacles: hitboxes along the path plus a height band ----------
    function setAct(a, dur) { run.act = a; run.actT = 0; run.actDur = dur || 0; }
    function dust() { for (let i = 0; i < 6; i++) spark(L.PX + (Math.random() - 0.5) * 8, L.yFeet - 1, (Math.random() - 0.5) * 20, -10 - Math.random() * 14, 0.5, 'groundLit'); }
    // approaching an obstacle the traveller commits to what they will do, from how they are moving
    function commit(ob) {
      ob.done = true;
      const w = ob.x1 - ob.x0, fast = run.act === 'run' && !run.tired && run.speed > 3.5 && run.stamina >= TUNE.minClearStamina;
      if (ob.k === 'low') {
        if (fast) { setAct('vault', (w + 1.2) / run.speed); run.stamina = Math.max(0, run.stamina - TUNE.vaultCost); run.airMax = 7; audio.leap(); }
        else if (run.act === 'walk') setAct('climb', (w + 0.6) / 1.3);
      } else if (ob.k === 'hole') {
        if (fast) { setAct('leap', (w + 1.4) / run.speed); run.stamina = Math.max(0, run.stamina - TUNE.leapCost); run.airMax = 10; audio.leap(); haptic('light'); }
      } else if (ob.k === 'snag') {
        if (run.act === 'walk') setAct('duck', (w + 0.9) / Math.max(1.4, run.speed));
      }
    }
    // the traveller's body, in pixels above the path: [feet, head]
    function body() {
      const top = run.act === 'duck' ? 11 : run.act === 'climb' ? 22 : 22;
      return [run.airH + (run.act === 'climb' ? 6 : 0), run.airH + top];
    }
    function collide(ob) {
      if (ob.hit) return;
      const [f0, f1] = body(), bnd = ob.band;
      let hit;
      if (ob.k === 'hole') hit = f0 <= 0 && run.dist > ob.x0 + 0.25 && run.dist < ob.x1 - 0.25;
      else hit = f0 < bnd[1] && f1 > bnd[0];
      if (!hit) return;
      ob.hit = true; run.hits++; note('hit:' + ob.v);
      const pen = ob.k === 'low' ? TUNE.hitLow : ob.k === 'snag' ? TUNE.hitSnag : TUNE.hitPit;
      run.stamina = Math.max(0, run.stamina - pen[1]);
      pushCreature(pen[2]);
      audio.thud(); haptic(ob.major ? 'heavy' : 'warning'); dust();
      if (ob.k === 'hole') { setAct('fall', pen[0]); run.after = { x: ob.x1 + 0.3 }; run.dist = (ob.x0 + ob.x1) / 2; }
      else if (ob.k === 'snag') { setAct('stumble', pen[0]); run.after = { duck: ob }; run.dist = ob.x0 - 0.15; }
      else { setAct('stumble', pen[0]); run.after = { x: ob.x1 + 0.15 }; }
    }

    // ---------- the traveller ----------
    function enterHide(zone) {
      if (run.c.mode !== 'wake' && (run.c.mode === 'hunt' || run.c.mode === 'reacquire') && run.c.gap < TUNE.seenGap) { caught('seen'); return; }
      run.act = 'hide'; run.spot = zone; run.exposed = run.hideT >= safeTime(zone);
      zone.rustle = 1; audio.rustle(1); haptic('light'); note('hide:' + zone.type);
      save.hints.hide = 1;
      if (run.hint === 'LET GO TO HIDE') { run.hint = ''; run.hintT = 0; }
      // slip into the object: settle on its hiding point if it is a thing, not corn
      run.settle = zone.type === 'corn' ? null : zone.x0 + (zone.x1 - zone.x0) * zone.at;
    }
    function leaveHide() {
      audio.rustle(0.8); note('unhide');
      for (let i = 0; i < 5; i++) spark(L.PX + (Math.random() - 0.3) * 10, L.yFeet - 10 - Math.random() * 8, 10 + Math.random() * 20, -14, 0.6, 'tassel');
      run.spot = null; run.settle = null; run.exposed = false;
    }

    function stepSim(dt) {
      const d = diff(), hold = input.held;
      run.t += dt;
      if (mode === MODES.STARTING) {
        // the field waits for the first hold; after a while it starts without you
        run.idleT += dt;
        if (hold || run.idleT > 6) { setMode(MODES.PLAYING); run.t = 0; note('start'); }
        else { run.hintT = 99; run.hint = run.idleT > 0.5 ? 'HOLD TO RUN' : ''; }
        if (mode === MODES.STARTING) { stepWorld(dt, d); return; }
        run.hint = ''; run.hintT = 0;
      }
      const zone = world.zoneAt(run.dist);
      run.inZone = zone;
      const locked = run.act === 'vault' || run.act === 'leap' || run.act === 'stumble' || run.act === 'fall' || run.act === 'climb' || run.act === 'duck';
      if (locked) {
        run.actT += dt;
        if (run.act === 'stumble' || run.act === 'fall') run.speed = 0;
        else if (run.act === 'climb') run.speed = 1.3;
        else if (run.act === 'duck') run.speed = Math.max(1.4, Math.min(run.speed, TUNE.walk));
        const u = clamp(run.actT / Math.max(0.01, run.actDur), 0, 1);
        run.airH = run.act === 'vault' || run.act === 'leap' ? Math.min(1, Math.sin(u * Math.PI) * 2.2) * run.airMax : run.act === 'climb' ? Math.sin(u * Math.PI) * 2 : 0;
        if (run.actT >= run.actDur) {
          const after = run.after; run.after = null; run.airH = 0;
          if (after && after.x !== undefined) run.dist = Math.max(run.dist, after.x);
          if (after && after.duck) { setAct('duck', (after.duck.x1 - run.dist + 0.6) / 1.6); run.speed = 1.6; }
          else { run.act = hold ? 'run' : 'walk'; if (run.act === 'run' && run.speed < 2) run.speed = 2; }
        }
      } else if (hold) {
        if (run.act === 'hide') leaveHide();
        run.act = 'run';
        const target = runSpeed();
        run.speed = run.speed < target ? Math.min(target, run.speed + TUNE.accel * dt) : Math.max(target, run.speed - TUNE.decel * dt);
      } else {
        if (zone && run.act !== 'hide') { enterHide(zone); if (!sim()) return; }
        if (run.act === 'hide') {
          // a short glide into the object, then still
          if (run.settle !== null) {
            const dx = run.settle - run.dist, step = 5 * dt;
            run.dist += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
            if (Math.abs(dx) <= step) run.settle = null;
          }
          run.speed = 0;
        } else {
          run.act = 'walk';
          const target = TUNE.walk * (run.tired ? TUNE.tiredWalk : 1);
          run.speed = run.speed > target ? Math.max(target, run.speed - TUNE.decel * dt) : Math.min(target, run.speed + TUNE.accel * dt);
        }
      }
      // stamina: only cover gives it back
      if (run.act === 'run') run.stamina -= (TUNE.drain + TUNE.drainGain * d) * dt;
      else if (run.act === 'hide') run.stamina += (TUNE.recoverHide - TUNE.recoverHideLoss * d) * dt;
      else if (run.act === 'walk' || run.act === 'duck' || run.act === 'climb') run.stamina += TUNE.recoverWalk * dt;
      run.stamina = clamp(run.stamina, 0, 100);
      if (run.stamina <= 0.01 && !run.tired) { run.tired = true; haptic('warning'); note('exhausted'); showHint('tired', 'WINDED. GET TO COVER', 2.6); }
      if (run.tired && run.stamina >= TUNE.rested) { run.tired = false; note('rested'); }
      // the hiding clock winds down slowly once you leave cover, so ducking out and back in buys nothing
      if (run.act === 'hide') {
        run.hideT += dt;
        const was = run.exposed; run.exposed = run.hideT >= safeTime(run.spot);
        if (run.exposed && !was) { audio.alarm(); haptic('warning'); run.spot.rustle = 1; note('exposed'); showHint('exposed', 'IT IS COMING TO LOOK. GO.', 2.4); }
      } else run.hideT = Math.max(0, run.hideT - dt * 0.8);
      // move; the score only counts ground actually covered
      if (run.act !== 'hide') run.dist += run.speed * dt;
      if (run.act !== 'hide') run.score = Math.max(run.score, run.dist);
      const prevStep = run.stepPh;
      run.ph += dt * (run.act === 'run' ? 2.4 + run.speed * 1.05 : 3.4 + run.speed * 1.4);
      run.stepPh = Math.floor(run.ph / Math.PI);
      if (run.stepPh !== prevStep && run.speed > 0.5 && run.airH === 0) audio.step(run.act !== 'run');
      // obstacles: commit on approach, then test the hitbox while overlapping
      if (run.act !== 'hide') {
        for (const ob of world.feats) {
          if (!ob.obs || ob.x0 > run.dist + 12 || ob.x1 < run.dist - 1) continue;
          const lead = ob.k === 'snag' ? 0.35 : 0.6;
          if (!ob.done && !locked && run.dist >= ob.x0 - lead) commit(ob);
          else if (!ob.done && ob.x0 - run.dist < 11) {
            if (ob.k === 'hole') showHint('hole', 'KEEP HOLDING TO LEAP');
            else if (ob.k === 'snag') showHint('snag', 'LET GO TO DUCK UNDER');
          }
          if (run.dist + 0.15 > ob.x0 && run.dist - 0.15 < ob.x1) collide(ob);
        }
        // crows: run at them and they give you away; walk and they only hop aside
        for (const f of world.feats) {
          if (f.k !== 'crows' || f.done) continue;
          if (f.x0 - run.dist < 12 && f.x0 > run.dist) showHint('crows', 'WALK PAST THE CROWS', 2.6);
          if (run.dist >= f.x0 - 0.5) {
            f.done = true;
            const loud = run.act === 'run' && run.speed > 3.5;
            const sx = (f.x0 - run.dist) * PPM + L.PX;
            for (let i = 0; i < f.n; i++) flyer(sx + i * 4, L.yFeet - 3, (loud ? -30 : 10) - Math.random() * 30, loud ? -60 - Math.random() * 30 : -25, 'crow');
            audio.scatter(loud); note(loud ? 'crows-loud' : 'crows-quiet');
            if (loud) { pushCreature(3); const c = run.c; if (c.mode === 'withdraw' || c.mode === 'linger') { c.mode = 'reacquire'; c.timer = 0.4; } }
          }
        }
      }
      if (run.hintT > 0) { run.hintT -= dt; if (run.hintT <= 0) run.hint = ''; }
      if (zone && run.act !== 'hide' && !save.hints.hide && run.hint !== 'LET GO TO HIDE') { run.hint = 'LET GO TO HIDE'; run.hintT = 2.5; }
      updateCreature(dt);
      if (!sim()) return;
      // heart while it is near your hiding place
      if (run.act === 'hide' && run.c.gap < 12) { run.heartT -= dt; if (run.heartT <= 0) { audio.heart(clamp(1 - Math.abs(run.c.gap) / 12, 0.3, 1)); run.heartT = run.exposed ? 0.4 : run.c.mode === 'sweep' ? 0.55 : 0.8; } }
      if (run.spot && run.act === 'hide' && (run.c.mode === 'sweep' || run.c.mode === 'check' || run.exposed) && Math.random() < dt * (run.exposed ? 4 : 1.5)) run.spot.rustle = 1;
      if (run.tired && run.act !== 'hide' && Math.random() < dt * 3) spark(L.PX + 12, L.yFeet - 20, 6 + Math.random() * 6, -6, 0.7, 'cream', 'puff');
      stepWorld(dt, d);
    }
    function stepWorld(dt, d) {
      world.update(run.dist, d, Math.floor(stageAt(run.dist)));
      const st = Math.floor(stageAt(run.dist) + 0.5);
      if (st > run.stageShown) { run.stageShown = st; run.stageToast = 3; try { ctx.platform.milestone && ctx.platform.milestone('stage_' + st); } catch (e) { } }
      if (run.stageToast > 0) run.stageToast -= dt;
      events(dt);
      if (run.stir.t > 0) run.stir.t -= dt;
      if (run.shade > 0) run.shade -= dt;
      for (const f of world.feats) { if (f.rustle) f.rustle = Math.max(0, f.rustle - dt * 1.5); if (f.lit > 0) f.lit -= dt; }
      for (const f of world.props) { if (f.lit > 0) f.lit -= dt; if (f.watch) f.look = lerp(f.look || 0, clamp((L.PX - propX(f)) / 10, -2, 2), dt * 3); }
    }
    function propX(f) { return Math.round((f.x - run.dist) * PPM * 0.85 + L.PX); }

    // ---------- events: scheduled, spaced, and quiet when the chase is on ----------
    const EVENTS = [
      { id: 'bats', w: 3, cd: 14 },
      { id: 'scarecrow', w: 2, cd: 12 },
      { id: 'pumpkin', w: 2, cd: 10 },
      { id: 'stir', w: 2, cd: 12 },
      { id: 'windmill', w: 1, cd: 20 },
      { id: 'figure', w: 1, cd: 25 },
      { id: 'shade', w: 1, cd: 22 }
    ];
    function fire(id) {
      run.ev.cd[id] = run.t; note('event:' + id);
      if (id === 'bats') spawnBats();
      else if (id === 'scarecrow') { const pr = world.props.find(p => p.k === 'scarecrow' && propX(p) > L.PX + 10 && propX(p) < L.W); if (pr) pr.watch = true; else return false; }
      else if (id === 'pumpkin') {
        const pk = world.props.find(p => p.k === 'pumpkin' && Math.abs(propX(p) - L.W * 0.6) < L.W * 0.4) || world.feats.find(f => f.v === 'pumpkin' && f.x0 > run.dist);
        if (pk) pk.lit = 1.3; else return false;
      }
      else if (id === 'stir') { run.stir.x = run.dist + 2 + Math.random() * 6; run.stir.t = 2.2; audio.rustle(0.7); }
      else if (id === 'windmill') { scene.windmillStop = 6; audio.creak(); }
      else if (id === 'figure') { if (run.c.gap >= 26) return false; scene.figure = 1.1; scene.figureX = L.W * (0.55 + Math.random() * 0.35); }
      else if (id === 'shade') run.shade = 5;
      return true;
    }
    function events(dt) {
      run.caw -= dt; run.creak -= dt;
      if (run.caw <= 0) { audio.caw(); run.caw = 7 + Math.random() * 9; }
      if (run.creak <= 0) { audio.creak(); run.creak = 9 + Math.random() * 8; }
      if (scene.windmillStop > 0) { scene.windmillStop -= dt; scene.windmillSpin = lerp(scene.windmillSpin, 0, dt * 2); } else scene.windmillSpin = lerp(scene.windmillSpin, 1, dt);
      if (scene.figure > 0) scene.figure -= dt;
      run.ev.next -= dt;
      if (run.ev.next > 0) return;
      run.ev.next = 5 + Math.random() * 4;
      // nothing decorative while it is right on top of you
      if (mode !== MODES.PLAYING || run.c.gap < 12 || run.c.mode === 'sweep' || run.c.mode === 'check') return;
      const ok = EVENTS.filter(e => run.t - (run.ev.cd[e.id] === undefined ? -99 : run.ev.cd[e.id]) > e.cd);
      let tot = 0; for (const e of ok) tot += e.w;
      let r = Math.random() * tot;
      for (const e of ok) { r -= e.w; if (r <= 0) { fire(e.id); break; } }
    }
    function spawnBats() {
      const dir = Math.random() < 0.5 ? 1 : -1, y0 = L.H * (0.1 + Math.random() * 0.2);
      for (let i = 0; i < 9; i++) flyer(dir > 0 ? -10 - i * 7 - Math.random() * 10 : L.W + 10 + i * 7, y0 + (Math.random() - 0.5) * 22, dir * (45 + Math.random() * 25), 0, 'bat');
      audio.bats();
    }

    // ---------- input ----------
    // Buttons act on release over the same button, so a held finger never
    // triggers two screens in a row.
    let buttons = [], armed = null;
    const pauseRect = () => ({ x: W - 15, y: safeT + 2, w: 13, h: 13 });
    function toLogical(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) * dpr - offX) / SC, y: ((e.clientY - rect.top) * dpr - offY) / SC };
    }
    const inRect = (p, r) => p.x >= r.x - 3 && p.x <= r.x + r.w + 3 && p.y >= r.y - 3 && p.y <= r.y + r.h + 3;
    const hitButton = p => { for (const bt of buttons) if (inRect(p, bt)) return bt; return null; };
    ctx.listen(canvas, 'pointerdown', e => {
      audio.unlock();
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (er) { }
      e.preventDefault && e.preventDefault();
      const p = toLogical(e);
      if (sim()) {
        if (inRect(p, pauseRect())) { pause(); return; }
        input.pointers.add(e.pointerId);
        return;
      }
      if (modeT < 0.35) return;
      armed = { id: e.pointerId, bt: hitButton(p) || (mode === MODES.MENU ? { fn: begin } : null) };
    });
    const up = e => {
      input.pointers.delete(e.pointerId);
      if (armed && armed.id === e.pointerId && e.type === 'pointerup') {
        const bt = armed.bt, again = hitButton(toLogical(e));
        armed = null;
        if (bt && (!bt.label || (again && again.label === bt.label)) && !sim()) { audio.ui(); bt.fn(); }
      } else if (armed && armed.id === e.pointerId) armed = null;
    };
    ctx.listen(canvas, 'pointerup', up);
    ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(canvas, 'lostpointercapture', e => { input.pointers.delete(e.pointerId); });
    const HOLD_KEYS = { Space: 1, ArrowRight: 1, ArrowUp: 1, KeyD: 1, KeyW: 1 };
    ctx.listen(window, 'keydown', e => {
      audio.unlock();
      if (HOLD_KEYS[e.code]) {
        e.preventDefault && e.preventDefault();
        if (sim()) input.key = true;
        else if (!e.repeat && (mode === MODES.MENU || mode === MODES.GAME_OVER) && modeT > 0.35) { audio.ui(); begin(); }
      } else if (e.code === 'Enter' && !e.repeat) {
        if ((mode === MODES.MENU || mode === MODES.GAME_OVER) && modeT > 0.35) { audio.ui(); begin(); }
        else if (mode === MODES.PAUSED) resume();
      } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (sim()) pause(); else if (mode === MODES.PAUSED) resume();
      }
    });
    ctx.listen(window, 'keyup', e => { if (HOLD_KEYS[e.code]) input.key = false; });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) { pause(); audio.suspend(); } });
    ctx.listen(window, 'blur', () => { input.key = false; input.pointers.clear(); armed = null; });

    // ---------- drawing ----------
    const VIEW = { layer: 'far', k: 0.3, x: 0, gy: 0 };
    function creatureView(c, t) {
      const gap = c.gap, v = VIEW;
      if (gap >= 26) {
        const u = clamp((gap - 26) / 18, 0, 1);
        // it sinks into the corn and rises again; nearer, it shows more often
        const show = Math.sin(t * 0.55 + 1) > lerp(-0.4, 0.45, u) ? 1 : 0;
        c.sink = lerp(c.sink || 0, show ? 0 : 14, 0.06);
        v.layer = 'far'; v.k = 0.3; v.x = Math.round(lerp(W * 0.22, W * 0.07, u) + Math.sin(t * 0.3) * 3); v.gy = Math.round(L.yDist + 30 + c.sink);
      } else if (gap >= 11) {
        const u = (26 - gap) / 15;
        v.layer = 'mid'; v.k = Math.round(lerp(0.45, 0.72, u) * 20) / 20; v.x = Math.round(lerp(W * 0.08, L.PX - 46, u) + Math.sin(t * 0.4) * 3); v.gy = Math.round(lerp(L.yMid + 40, L.yBack + 30, u));
      } else {
        const u = clamp((11 - gap) / 11, 0, 1);
        v.layer = 'near'; v.k = Math.round(lerp(0.78, 1.0, u) * 20) / 20; v.x = Math.round(L.PX - 12 - gap * 3.6); v.gy = L.yFeet - 4;
      }
      return v;
    }
    const COPT = { facing: 1, phase: 0, t: 0, reach: 0, rx: 0, ry: 0, scan: 0, eyes: 1, tilt: 0 };
    function drawCreatureAt(v, c, p, t, extra) {
      COPT.facing = c.facing; COPT.phase = Math.floor(c.phase * 8 / TAU * 2) / (8 / TAU * 2); COPT.t = t; COPT.reach = c.reach;
      // when it checks your hiding place, it reaches for exactly where you are
      COPT.rx = c.mode === 'check' ? L.PX + 2 : L.PX + 6 + Math.sin(t * 0.9) * 12; COPT.ry = L.yFeet - 12;
      COPT.scan = c.scan; COPT.eyes = c.eyes === undefined ? 1 : c.eyes; COPT.tilt = Math.round(Math.sin(t * 0.37) * 2) / 10;
      if (extra) { COPT.reach = extra.reach; COPT.rx = extra.rx; COPT.ry = extra.ry; }
      drawCreature(v.x, v.gy, v.k, COPT, p);
    }
    function drawShadow(v, p, strength) {
      // its shadow reaches along the path before it does (the sun is behind it)
      const len = Math.round(lerp(10, 70, strength)), x0 = v.x - 2, y0 = L.yFeet - 4;
      poly([x0, y0, x0 + 5, y0, x0 + len + 8, y0 + 7, x0 + len, y0 + 8], FIX.ink, true);
      poly([x0 + len * 0.55, y0 + 3, x0 + len * 0.55 + 3, y0 + 3, x0 + len + 14, y0 - 2, x0 + len + 12, y0 - 1], FIX.ink, true);
    }

    function drawWorld(p, stageF, dist, t, dt, cr, pose) {
      const camPx = dist * PPM - L.PX;
      const hidden = !!(run && run.act === 'hide' && sim()), spot = hidden ? run.spot : null, zone = run && sim() ? run.inZone : null;
      scene.drawSky(L, p, stageF, camPx, t);
      // birds drift high and slow
      for (let i = 0; i < 3; i++) {
        const x = Math.round(((i * 61 + t * (4 + i)) % (W + 40)) - 20), y = Math.round(L.H * (0.12 + i * 0.05) + Math.sin(t * 0.8 + i) * 2);
        const up = Math.floor(t * 3 + i) & 1;
        R(x - 2, y - up, 2, 1, p.sil); R(x + 1, y - up, 2, 1, p.sil); R(x, y, 1, 1, p.sil);
      }
      for (const bt of FLY) {
        if (!bt.on) continue;
        const x = Math.round(bt.x), y = Math.round(bt.y + (bt.kind === 'bat' ? Math.sin(bt.ph) * 3 : 0)), f = Math.floor(bt.ph * 2) % 3;
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
      const hopt = { near: false, hidden: false };
      for (const f of world.feats) {
        if (f.k === 'hide') {
          if (f.type === 'corn' || f === spot) continue;
          const sx = Math.round((f.x0 - dist) * PPM + L.PX), ex = Math.round((f.x1 - dist) * PPM + L.PX);
          if (ex > -30 && sx < W + 30) { hopt.near = f === zone; hopt.hidden = false; drawHideSpot(f, sx, ex, L, p, t, hopt); }
          continue;
        }
        const sx = (f.x0 - dist) * PPM + L.PX, ex = (f.x1 - dist) * PPM + L.PX;
        if (ex < -20 || sx > W + 20) continue;
        if (f.k === 'crows') { if (!f.done) drawCrows(f, Math.round(sx), L, t); }
        else drawObstacle(f, Math.round(sx), Math.round(ex), L, p, t);
      }
      // in a tree or a shed only your eyes show; everywhere else you crouch behind your cover
      const inside = spot && (spot.type === 'tree' || spot.type === 'shed');
      if (pose && !inside) {
        const info = drawPlayer(L.PX - 8, L.yFeet - Math.round(pose.air || 0), pose);
        pose.top = info.top;
      } else if (pose) pose.top = L.yFeet - 30;
      if (spot && spot.type !== 'corn') {
        const sx = Math.round((spot.x0 - dist) * PPM + L.PX), ex = Math.round((spot.x1 - dist) * PPM + L.PX);
        hopt.near = false; hopt.hidden = true;
        const sh = spot.rustle > 0.5 ? Math.round(Math.sin(t * 40)) : 0;
        drawHideSpot(spot, sx + sh, ex + sh, L, p, t, hopt);
      }
      scene.drawFront(L, p, camPx, t);
      for (const f of world.feats) if (f.k === 'hide' && f.type === 'corn') scene.drawClump(L, p, camPx, f, t, f.rustle || 0, f === zone && !hidden);
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'front') { const x = Math.round((pr.x - dist) * PPM + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFront + 8, pr.size, p, pr.lit || 0); }
      // foreground blades at the bottom edge frame the picture
      const fo = camPx * 1.3;
      for (let i = Math.floor(fo / 34) - 1; i <= Math.floor((fo + W) / 34) + 1; i++) {
        const hh = hash(i + 4242); if (hh > 0.45) continue;
        const x = Math.round(i * 34 - fo + hh * 20), top = L.H - 14 - Math.round(hh * 22);
        poly([x, L.H, x + 3, L.H, x + 6 + hh * 8, top, x + 2 + hh * 6, top + 2], FIX.ink);
        R(x + 1, top + 10, 1, 4, p.frontLeaf);
      }
      // a cloud shadow passing over the field
      if (run && run.shade > 0) {
        const u = 1 - run.shade / 5, x0 = Math.round(lerp(W + 40, -W - 40, u));
        G.globalAlpha = 0.28; R(x0, L.yHor, W + 30, H - L.yHor, FIX.ink); G.globalAlpha = 1;
      }
    }

    function drawButton(label, cx, y, fn, primary) {
      const w = textW(label, F5) + 12, x = Math.round(cx - w / 2), h = 13;
      const pressed = armed && armed.bt && armed.bt.label === label;
      R(x, y, w, h, pressed ? '#3a2a22' : FIX.ink);
      R(x, y, w, 1, primary ? FIX.cream : '#8a6a5a'); R(x, y + h - 1, w, 1, primary ? FIX.cream : '#8a6a5a');
      R(x, y, 1, h, primary ? FIX.cream : '#8a6a5a'); R(x + w - 1, y, 1, h, primary ? FIX.cream : '#8a6a5a');
      R(x + 1, y + h, w, 1, '#000000');
      text(label, x + 6, y + 3, primary ? FIX.cream : '#d9c09a', F5);
      if (primary && Math.floor(clock * 2) % 2 === 0) { R(x - 5, y + 4, 1, 5, FIX.cream); R(x - 4, y + 5, 1, 3, FIX.cream); R(x - 3, y + 6, 1, 1, FIX.cream); }
      buttons.push({ x, y, w, h, fn, label });
    }
    function tag(label, cx, y, c) {
      const w = textW(label, F3) + 6, x = Math.round(cx - w / 2);
      R(x, y, w, 9, FIX.ink); text(label, x + 3, y + 2, c || FIX.cream, F3);
      return { x, w };
    }
    // a row of pips: one per second of safety
    function pips(cx, y, total, left, warn) {
      const n = Math.max(1, Math.round(total)), w = n * 3 + 3, x0 = Math.round(cx - w / 2);
      R(x0, y - 2, w, 6, FIX.ink);
      for (let i = 0; i < n; i++) {
        const on = i < left, c = warn ? (Math.floor(clock * 6) % 2 ? FIX.ember : '#7a2a2a') : on ? FIX.cream : '#4a3a32';
        R(x0 + 2 + i * 3, y, 2, 2, c);
      }
    }

    function drawHUD(p) {
      const y0 = safeT + 4;
      text('DISTANCE', 4, y0, FIX.cream, F3, 1, FIX.ink);
      text(Math.floor(run.score) + ' M', 4, y0 + 7, FIX.cream, F5, 1, FIX.ink);
      text('BEST ' + Math.max(save.best, Math.floor(run.score)) + ' M', 4, y0 + 17, FIX.cream, F3, 1, FIX.ink);
      const pr = pauseRect();
      R(pr.x, pr.y, pr.w, pr.h, FIX.ink); R(pr.x + 4, pr.y + 3, 2, 7, FIX.cream); R(pr.x + 8, pr.y + 3, 2, 7, FIX.cream);
      // danger: it is close and still has you
      const c = run.c, P = pursuit(), chasing = c.mode === 'hunt' || c.mode === 'reacquire';
      if (chasing && P < TUNE.dangerAt && run.act !== 'hide') {
        const hot = P < TUNE.immediateAt + 3;
        if (Math.floor(clock * (hot ? 6 : 3)) % 2 === 0 || !hot) {
          const tg = tag('DANGER', W / 2, y0 + 1, hot ? FIX.ember : FIX.cream);
          R(tg.x - 4, y0 + 4, 2, 2, FIX.glowHot); R(tg.x + tg.w + 2, y0 + 4, 2, 2, FIX.glowHot);
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
      // contextual: what this cover is worth, then how long it has left
      const top = (run.pose && run.pose.top) || L.yFeet - 26;
      if (run.inZone && run.act !== 'hide' && mode === MODES.PLAYING) {
        if (Math.floor(clock * 4) % 2 === 0 || pursuit() > TUNE.dangerAt) {
          const ty = Math.min(top - 17, L.yFeet - HIDE_TOP[run.inZone.type] - 19);
          tag('HIDE', L.PX, ty, FIX.glow);
          const s = safeTime(run.inZone);
          pips(L.PX, ty + 11, s, Math.round(s), false);
        }
      }
      if (run.act === 'hide' && run.spot) {
        const s = safeTime(run.spot), left = Math.max(0, Math.ceil(s - run.hideT));
        pips(L.PX, top - 7, s, left, run.exposed);
      }
      // breath: the only meter
      const bw = 40, bx = Math.round(W / 2 - bw / 2 + 12), by = H - 9 - safeB;
      text('BREATH', bx - 27, by - 1, run.tired ? FIX.ember : FIX.cream, F3, 1, FIX.ink);
      R(bx - 1, by - 1, bw + 2, 5, FIX.ink);
      const low = run.stamina < TUNE.low, fc = run.tired ? (Math.floor(clock * 4) % 2 ? FIX.ember : '#7a2a2a') : low ? (Math.floor(clock * 3) % 2 ? FIX.ember : FIX.glow) : FIX.cream;
      R(bx, by, Math.round(bw * run.stamina / 100), 3, fc);
      R(bx + Math.round(bw * TUNE.rested / 100), by + 3, 1, 1, '#8a6a5a');
    }

    const POSE = { mode: 'idle', ph: 0, t: 0, air: 0, blink: false, lift: 0, top: 0 };
    function playerPose() {
      const a = run.act;
      let m = 'idle';
      if (mode === MODES.STARTING) m = 'idle';
      else if (a === 'run') m = run.tired ? 'tired' : 'run';
      else if (a === 'walk') m = run.tired ? 'tired' : 'walk';
      else if (a === 'hide') m = 'crouch';
      else if (a === 'duck') m = 'duck';
      else if (a === 'vault' || a === 'leap') m = 'air';
      else if (a === 'climb') m = 'walk';
      else if (a === 'stumble') m = 'tired';
      else if (a === 'fall') m = 'crouch';
      let air = run.airH || 0;
      if (a === 'fall') { const u = run.actT / run.actDur; air = u < 0.3 ? -u / 0.3 * 9 : -9 + (u - 0.3) / 0.7 * 9; }
      POSE.mode = m; POSE.ph = run.ph; POSE.t = clock; POSE.air = air; POSE.blink = (clock % 3.1) < 0.12; POSE.lift = 0;
      return POSE;
    }

    const CR = { v: null, c: null, extra: null }, CEXTRA = { reach: 0, rx: 0, ry: 0 }, CWAKE = {};
    function render(dt) {
      if (buf.width !== W || buf.height !== H) { buf.width = W; buf.height = H; }
      if (!vign[0] || vign[0].width !== W || vign[0].height !== H) buildVignettes();
      setTarget(b);
      buttons = [];
      const t = clock;
      if (mode === MODES.MENU) {
        const p = paletteAt(0);
        const c = { facing: 1, phase: 0.6, reach: 0, scan: Math.round(Math.sin(t * 0.4) * 2) / 2, eyes: (t % 4.3) < 0.15 ? 0 : 1 };
        const v = { layer: 'far', k: 0.62, x: Math.round(W * 0.76), gy: Math.round(L.yDist + 16) };
        drawWorld(p, 0, 0, t, dt, { v, c }, { mode: 'idle', ph: 0, t, blink: (t % 3.3) < 0.12 });
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
      if (mode === MODES.GAME_OVER) { renderOver(); return; }
      const stageF = stageAt(run.dist), p = paletteAt(stageF);
      const pose = playerPose(); run.pose = pose;
      CR.v = creatureView(run.c, t); CR.c = run.c; CR.extra = null;
      if (run.c.mode === 'wake') { Object.assign(CWAKE, run.c); CWAKE.phase = 0.4; CR.c = CWAKE; }
      if (mode === MODES.CAUGHT) {
        const ct = modeT;
        if (ct >= 0.6) { renderCaughtClose(p, ct); return; }
        const u = clamp(ct / 0.45, 0, 1);
        CR.v.layer = 'near'; CR.v.k = 1.05; CR.v.x = Math.round(lerp(CR.v.x, L.PX - 16, u)); CR.v.gy = L.yFeet - 4;
        const top = pose.top || L.yFeet - 26;
        CEXTRA.reach = Math.min(1, u * 1.3); CEXTRA.rx = L.PX - 1; CEXTRA.ry = top + 6 - Math.max(0, ct - 0.3) * 40; CR.extra = CEXTRA;
        run.c.facing = 1;
        pose.mode = ct > 0.3 ? 'lifted' : 'crouch'; pose.lift = Math.max(0, ct - 0.3) * 40; pose.air = 0;
        run.spot = null;
      }
      drawWorld(p, stageF, run.dist, t, dt, CR, pose);
      // particles
      for (const q of PARTS) {
        if (!q.on) continue;
        const c = FIX[q.c] || p[q.c] || q.c;
        if (q.kind === 'puff') { if (q.life / q.max > 0.3) R(Math.round(q.x), Math.round(q.y), 2, 1, c); }
        else if (q.kind === 'leaf') { const f = Math.floor(q.life * 6) & 1; R(Math.round(q.x), Math.round(q.y), f ? 2 : 1, f ? 1 : 2, c); }
        else R(Math.round(q.x), Math.round(q.y), 1, 1, c);
      }
      // threat: the field darkens and the edges close in
      const c = run.c, P = pursuit();
      let threat = 0;
      if (run.act !== 'hide') threat = clamp((TUNE.dangerAt - P) / (TUNE.dangerAt - 5), 0, 1) * (c.mode === 'hunt' || c.mode === 'reacquire' ? 1 : 0.4);
      else threat = run.exposed ? 0.8 : c.mode === 'sweep' ? 0.55 : c.gap < 12 ? 0.3 : 0;
      run.threat = threat;
      if (threat > 0.05) { G.globalAlpha = 0.24 * threat; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      const vl = Math.max(stageF > 2.5 ? 1 : 0, threat > 0.75 ? 3 : threat > 0.45 ? 2 : threat > 0.12 ? 1 : 0);
      if (vl > 0) G.drawImage(vign[vl - 1], 0, 0);
      if (run.act === 'hide') { G.globalAlpha = 0.16; R(0, 0, W, H, FIX.ink); G.globalAlpha = 1; }
      if (mode !== MODES.CAUGHT) drawHUD(p);
      if (mode === MODES.PAUSED) {
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
      const cause = run.cause === 'found' ? 'IT FOUND YOUR HIDING PLACE.' : run.cause === 'seen' ? 'IT SAW YOU MOVE.' : 'IT CAUGHT UP.';
      textC(cause, W / 2, y1 + 16, '#c98a7c', F3);
      const d = Math.floor(run.score);
      textC('DISTANCE: ' + d + ' M', W / 2, Math.round(H * 0.43), FIX.cream, F5, 1, '#000000');
      textC('PERSONAL BEST: ' + save.best + ' M', W / 2, Math.round(H * 0.43) + 12, '#d9c09a', F3);
      if (run.record && Math.floor(clock * 3) % 2 === 0) textC('NEW BEST', W / 2, Math.round(H * 0.43) + 21, FIX.glow, F3);
      const by = Math.round(H * 0.62);
      drawButton('TRY AGAIN', W / 2, by, begin, true);
      drawButton('MAIN MENU', W / 2, by + 20, toTitle, false);
    }

    // ---------- blit: whole pixels only ----------
    function blit() {
      if (canvas.width !== devW || canvas.height !== devH) { canvas.width = devW; canvas.height = devH; }
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#0b0807'; g.fillRect(0, 0, canvas.width, canvas.height);
      const unstable = mode === MODES.PLAYING && run.threat > 0.65 && run.act !== 'hide';
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
    const perf = { frames: 0, simMs: 0, drawMs: 0 };
    function updateFx(dt) {
      if (!run) return;
      const scroll = mode === MODES.PLAYING ? run.speed * PPM * dt : 0;
      for (const q of PARTS) {
        if (!q.on) continue;
        q.x += q.vx * dt - scroll; q.y += q.vy * dt; q.vy += (q.kind === 'leaf' ? 4 : q.kind === 'puff' ? -4 : 30) * dt; q.life -= dt;
        if (q.kind === 'leaf') q.vx += Math.sin(clock * 3 + q.y) * 6 * dt;
        if (q.life <= 0 || q.x < -10 || q.x > W + 10) q.on = false;
      }
      for (const q of FLY) {
        if (!q.on) continue;
        q.x += q.vx * dt - (q.kind === 'crow' ? scroll : 0); q.y += q.vy * dt; q.ph += dt * 14;
        if (q.kind === 'bat') q.y += Math.sin(q.ph * 0.3) * 0.3; else q.vy += 20 * dt;
        if (q.x < -90 || q.x > W + 90 || q.y < -20) q.on = false;
      }
      if (Math.random() < dt * 1.4) spark(W * (0.3 + Math.random() * 0.8), L.yBack - 6 - Math.random() * 20, -8 - Math.random() * 8, 4, 4, Math.random() < 0.5 ? 'pumpkin' : 'backLeafLit', 'leaf');
    }
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      clock += dt; modeT += dt;
      const t0 = performance.now();
      if (sim()) {
        acc += dt; let n = 0;
        while (acc >= DT && n < 6 && sim()) { stepSim(DT); acc -= DT; n++; }
        if (n === 6) acc = 0;
      } else acc = 0;
      if (mode === MODES.CAUGHT && modeT > 1.75) setMode(MODES.GAME_OVER);
      if (mode !== MODES.PAUSED) updateFx(dt);
      const playing = mode === MODES.PLAYING;
      audio.update({
        dt, playing, hidden: playing && run.act === 'hide',
        run: playing ? clamp(run.speed / 8, 0, 1) : 0,
        prox: playing ? clamp(1 - Math.abs(run.c.gap) / 26, 0, 1) : mode === MODES.CAUGHT ? 1 : 0,
        tired: playing && run.tired ? 1 : playing ? clamp((TUNE.low - run.stamina) / TUNE.low, 0, 1) * 0.5 : 0,
        exert: playing && run.act === 'run' ? 1 - run.stamina / 100 : 0,
        rustle: playing && run.inZone ? run.inZone.rustle || 0 : 0
      });
      const t1 = performance.now();
      render(dt);
      blit();
      perf.frames++; perf.simMs += t1 - t0; perf.drawMs += performance.now() - t1;
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
        get run() { return run; }, get mode() { return mode; }, save: () => save, world, TUNE, MODES, begin, pause, resume, toTitle, setMode,
        playerState, creatureState, pursuit, safeTime, perf,
        // tests only: drop whatever is happening and stand at the menu
        reset() { mode = MODES.MENU; modeT = 1; run = newRun(); input.pointers.clear(); input.key = false; },
        hold(v) { input.key = !!v; },
        advance(sec, hold) { if (hold !== undefined) input.key = !!hold; const n = Math.round(sec / DT); for (let i = 0; i < n && sim(); i++) stepSim(DT); },
        size: () => ({ W, H, SC, offX, offY })
      };
    }
  }
};
