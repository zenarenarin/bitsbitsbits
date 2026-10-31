// =====================================================================
// The game: movement and stamina, the creature's awareness and pursuit,
// concealment, screens, the Plethora lifecycle and the pixel-perfect blit.
// =====================================================================
const SAVE_KEY = 'hollow-harvest-v1';
// Every gameplay number lives here. Speeds are metres per second, stamina
// and awareness are 0..100. The creature's distance is metres along the
// path (gap = how far behind you it is); pursuit() reads it as 0..100.
const TUNE = {
  // movement
  runBase: 6.2, runGain: 1.6, walk: 2.0, accel: 18, decel: 16, tiredRun: 0.6, tiredWalk: 0.85,
  // stamina
  drain: 8.5, drainGain: 2.5, recoverHide: 22, recoverHideLoss: 5, recoverWalk: 1.0, low: 30, rested: 25,
  // noise and awareness (per second unless noted)
  noiseRun: 14, noiseTired: 20, noiseWalk: 3, presence: 0.6, presenceGain: 2.6, decayOpen: 4,
  exposedNear: 6, nearGap: 10, decayHide: 6, decayHideConceal: 10, searchingDecayFactor: 0.35,
  hitMinor: 15, hitMajor: 25, crowsAware: 20, bolt: 30,
  suspicious: 26, hunting: 51, detected: 76,
  // the creature
  startGap: 38, maxGap: 44, followGapStart: 32, followGapEnd: 14, sightGap: 26,
  followSpeed: 3.5, investigateSpeed: 4.8, huntSpeed: 6.6, chaseSpeed: 8.0, speedGain: 0.18, retreatSpeed: 3.2,
  seenGap: 3.0, catchGap: 1.2, searchBase: 2.0, searchPerAware: 3.0, checkReach: 0.9, checkHit: 1.6, checkWalk: 1.8,
  gapScale: 40,
  // collisions: [stumble seconds, stamina lost, awareness gained]
  hitLow: [0.55, 8, 15], hitSnag: [0.85, 12, 25], hitPit: [1.1, 12, 25],
  vaultCost: 3, leapCost: 5, minClearStamina: 8,
  // difficulty follows ground covered, not the clock
  diffStart: 80, diffSpan: 420, closeInOver: 150, overstay: 3
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
const CREATURE_STATES = { wake: 'FOLLOWING', follow: 'FOLLOWING', investigate: 'INVESTIGATING', search: 'SEARCHING', chase: 'CHASING', lose: 'LOSING_INTEREST', ret: 'RETURNING' };
const CHECK_OFFSETS = [0, 2, -2, 3.5, -3.5, 5, -5, 1, -1];

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
    // The picture is drawn at a low logical resolution (about 130 px wide on a phone) and blitted at
    // the largest whole-number scale that covers the screen; any extra width or height shows more field.
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
    function layout() {
      const cw = Math.max(1, ctx.width || window.innerWidth), ch = Math.max(1, ctx.height || window.innerHeight);
      dpr = Math.min(3, ctx.nativeDpr || window.devicePixelRatio || 1);
      const dw = Math.max(1, Math.round(cw * dpr)), dh = Math.max(1, Math.round(ch * dpr));
      devW = dw; devH = dh;
      canvas.width = dw; canvas.height = dh; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      SC = Math.max(1, Math.min(Math.floor(dw / 128), Math.floor(dh / 228)));
      // fill the whole screen at any shape: the field simply shows more width or height
      W = Math.ceil(dw / SC); H = Math.ceil(dh / SC);
      offX = Math.floor((dw - W * SC) / 2); offY = Math.floor((dh - H * SC) / 2);
      buf.width = W; buf.height = H;
      L = computeLayout(W, H);
      // text and controls stay clear of the island, the home indicator and Plethora's logo button
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      safeT = Math.max(0, Math.ceil(((sa.top || 0) * dpr - Math.max(0, offY)) / SC));
      safeB = Math.max(0, Math.ceil(((sa.bottom || 0) * dpr - Math.max(0, offY)) / SC));
      scene.skyKey = '';
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
        hideT: 0, hiddenFor: 0, spot: null, settle: null, inZone: null, overtime: false, kneel: 0, targeted: false,
        a: 0, lkp: 0, hearAcc: 0,
        c: { x: -TUNE.startGap, gap: TUNE.startGap, mode: 'wake', timer: 0, phase: 0, facing: 1, reach: 0, scan: 0, eyes: 1, sink: 0,
          startle: 0, checkX: 0, checkIdx: 0, reachT: 0, jointT: 3, spotted: false },
        stageShown: 0, stageToast: 0, hint: '', hintT: 0, ev: { next: 6, cd: {} }, caw: 4, creak: 8, stir: { x: 0, t: 0 }, shade: 0,
        heartT: 0, record: false, cause: '', threat: 0, hits: 0, escapes: 0, finds: 0, checksOnYou: 0, peakA: 0, log: []
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

    function diff() { return clamp((run.score - TUNE.diffStart) / TUNE.diffSpan, 0, 1); }
    // the field slowly closes in even if you creep: pressure follows ground covered or time spent, whichever is further on
    function pressure() { return Math.max(diff(), clamp(run.t / TUNE.closeInOver, 0, 1)); }
    function gapNow() { return run.dist - run.c.x; }
    function pursuit() { return clamp(gapNow() / TUNE.gapScale * 100, 0, 100); }
    function runSpeed() {
      let s = TUNE.runBase + TUNE.runGain * diff();
      if (run.tired) s *= TUNE.tiredRun;
      else if (run.stamina < TUNE.low) s *= lerp(0.65, 1, run.stamina / TUNE.low);
      return s;
    }
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
    function creatureState() { return CREATURE_STATES[run.c.mode] || 'FOLLOWING'; }
    function awarenessLevel(a) {
      a = a === undefined ? run.a : a;
      return a >= TUNE.detected ? 'DETECTED' : a >= TUNE.hunting ? 'HUNTING' : a >= TUNE.suspicious ? 'SUSPICIOUS' : 'UNAWARE';
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

    // ---------- noise and awareness ----------
    // Awareness is what the creature knows, not where it is. Noise raises it, more so the nearer it
    // is; cover lets it fall. It also keeps a last known position, refreshed each time it hears you,
    // and less precise the less aware it is.
    function noise() {
      const a = run.act;
      if (a === 'hide' || a === 'stand') return 0;
      if (a === 'walk' || a === 'duck' || a === 'climb') return TUNE.noiseWalk;
      return run.tired ? TUNE.noiseTired : TUNE.noiseRun;
    }
    function hearing(gap) { return lerp(0.5, 1.8, clamp((40 - gap) / 36, 0, 1)); }
    function spike(amount, why) {
      run.a = clamp(run.a + amount, 0, 100); run.lkp = run.dist; run.hearAcc = 0; note('heard:' + why);
    }
    function updateAwareness(dt) {
      const c = run.c, gap = gapNow(), hidden = run.act === 'hide', d = diff();
      if (c.mode === 'wake') return;
      let da = 0;
      if (!hidden) {
        da += noise() * hearing(gap) + TUNE.presence + TUNE.presenceGain * pressure() - TUNE.decayOpen;
        // standing out in the open close to it is noticed whatever the noise
        if (gap < TUNE.nearGap) da += TUNE.exposedNear * (1 - gap / TUNE.nearGap) * 2;
      } else {
        const near = (c.mode === 'search' || c.mode === 'investigate') && Math.abs(gap) < 10;
        da -= (TUNE.decayHide + TUNE.decayHideConceal * run.spot.conceal) * (near ? TUNE.searchingDecayFactor : 1);
        // stay too long and it starts to sense something in that patch of field
        if (run.overtime) da = Math.max(da, 0) + TUNE.overstay * (1.5 - run.spot.conceal);
      }
      if (c.mode === 'lose') da -= 6;
      run.a = clamp(run.a + da * dt, 0, 100);
      // in plain sight while it chases you, it does not lose track
      if (!hidden && c.mode === 'chase' && gap < TUNE.sightGap) run.a = Math.max(run.a, 80);
      run.peakA = Math.max(run.peakA, run.a);
      if (!hidden) {
        if (run.a >= TUNE.detected && gap < TUNE.sightGap) { run.lkp = run.dist; run.hearAcc = 0; }
        else {
          run.hearAcc += noise() * hearing(gap) * dt * 0.25;
          if (run.hearAcc >= 1) { run.hearAcc = 0; run.lkp = run.dist - (1 - run.a / 100) * 5 * Math.random(); }
        }
      }
    }

    // ---------- the creature ----------
    // A real position on the path (c.x, metres). It moves toward a target at a speed set by what it is doing:
    // follow    : keeps its distance in the field behind you, barely moving
    // investigate: walks to where it last heard you
    // search    : slows and checks the cover around that spot, one reach at a time
    // chase     : it has seen you and comes straight on
    // lose      : gives up and walks away
    // ret       : drifts back into the field behind you
    function followGap() { return lerp(TUNE.followGapStart, TUNE.followGapEnd, pressure()); }
    function moveCreature(target, speed, dt) {
      const c = run.c, dx = target - c.x, step = speed * dt;
      c.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
      return Math.abs(target - c.x) < 0.05;
    }
    function startSearch() {
      const c = run.c;
      c.mode = 'search'; c.timer = TUNE.searchBase + TUNE.searchPerAware * run.a / 100 + diff(); c.checkIdx = 0; c.reachT = 0;
      nextCheck(); audio.rustle(1.1); note('search');
    }
    function nextCheck() {
      const c = run.c, off = CHECK_OFFSETS[c.checkIdx % CHECK_OFFSETS.length];
      let x = run.lkp + off;
      if (run.act === 'hide') x = Math.min(x, run.dist - 0.6);
      c.checkX = x; c.checkIdx++; c.reachT = 0; run.targeted = false;
    }
    function discoveryChance() {
      const s = run.spot, over = Math.max(0, run.hideT - s.comfort * (1 - 0.25 * diff()));
      return clamp((1 - s.conceal) * (0.3 + 0.7 * run.a / 100) * (1 + over * 0.6), 0, 0.95);
    }
    function updateCreature(dt) {
      const c = run.c, d = diff(), hidden = run.act === 'hide', speedUp = 1 + TUNE.speedGain * d;
      c.timer -= dt;
      if (c.startle > 0) { c.startle -= dt; }
      else if (c.mode === 'wake') {
        if (mode === MODES.PLAYING && run.t > 1.5) { c.mode = 'follow'; note('wake'); }
      } else if (c.mode === 'follow' || c.mode === 'ret') {
        const target = run.dist - followGap(), gap = gapNow();
        const v = gap > followGap() ? TUNE.followSpeed * speedUp : Math.min(TUNE.followSpeed, run.speed * 0.9);
        moveCreature(target, v, dt);
        if (c.mode === 'ret' && gapNow() <= followGap() + 1) c.mode = 'follow';
        if (run.a >= TUNE.suspicious) { c.mode = 'investigate'; note('investigate'); }
      } else if (c.mode === 'investigate') {
        const v = (run.a >= TUNE.hunting ? TUNE.huntSpeed : TUNE.investigateSpeed) * speedUp;
        const arrived = moveCreature(Math.min(run.lkp, run.dist - (hidden ? 0.6 : 0)), v, dt);
        if (!hidden && run.a >= TUNE.detected && gapNow() < TUNE.sightGap) {
          c.mode = 'chase'; note('chase');
          if (!c.spotted) { c.spotted = true; audio.spotted(); haptic('warning'); }
        } else if (arrived || Math.abs(c.x - run.lkp) < 1.2) startSearch();
        else if (run.a < 20) { c.mode = 'lose'; c.timer = 3; note('lose'); }
      } else if (c.mode === 'chase') {
        moveCreature(run.dist, TUNE.chaseSpeed * speedUp, dt);
        if (hidden) { c.mode = 'investigate'; note('lost-sight'); }
        else if (gapNow() > TUNE.sightGap + 4) { c.mode = 'investigate'; run.a = Math.min(run.a, 70); note('outran'); }
      } else if (c.mode === 'search') {
        if (!hidden && run.a >= TUNE.detected && gapNow() < TUNE.sightGap) { c.mode = 'chase'; note('chase'); if (!c.spotted) { c.spotted = true; audio.spotted(); } }
        else if (c.reachT > 0) {
          // reaching into a hiding place: the warning comes before the result
          c.reachT += dt;
          if (c.reachT >= TUNE.checkReach) {
            if (run.targeted && hidden) {
              run.checksOnYou++;
              if (Math.random() < discoveryChance()) { run.finds++; c.reach = 1; caught('found'); return; }
              note('check-missed');
            }
            if (c.timer <= 0) {
              c.mode = 'lose'; c.timer = 3; run.a = Math.max(0, run.a - 10); note('lose');
              if (hidden) { run.escapes++; audio.safe(); haptic('light'); showHint('escape', 'IT IS LEAVING', 2.4); }
            } else nextCheck();
          }
        } else if (moveCreature(c.checkX, TUNE.checkWalk, dt)) {
          c.reachT = 0.0001;
          run.targeted = hidden && Math.abs(c.checkX - run.dist) < TUNE.checkHit;
          if (run.targeted) { audio.alarm(); haptic('warning'); if (run.spot) run.spot.rustle = 1; note('check-you'); }
          else audio.rustle(0.5);
        }
      } else if (c.mode === 'lose') {
        moveCreature(c.x - 30, TUNE.retreatSpeed, dt);
        if (c.timer <= 0) { c.mode = 'ret'; note('return'); }
        if (run.a >= TUNE.suspicious) { c.mode = 'investigate'; note('investigate'); }
      }
      // it never falls further behind than the edge of the field you can see
      c.x = Math.max(c.x, run.dist - TUNE.maxGap);
      if (hidden) c.x = Math.min(c.x, run.dist - 0.6);
      c.gap = gapNow();
      // presentation: weight in the stride, slower when it searches, faster when it has you
      c.facing = c.mode === 'lose' ? -1 : 1;
      const rate = c.startle > 0 ? 0.2 : c.mode === 'chase' ? 3.2 : c.mode === 'investigate' ? (run.a >= TUNE.hunting ? 2.6 : 2.0) : c.mode === 'search' ? (c.reachT > 0 ? 0.4 : 1.1) : c.mode === 'wake' ? 0.3 : 1.5;
      const prevPh = c.phase; c.phase += dt * rate;
      const z = clamp((c.gap - 1) / 39, 0, 1);
      if (Math.floor(prevPh / Math.PI) !== Math.floor(c.phase / Math.PI) && rate > 0.5) audio.creatureStep(clamp((1 - z) * (c.mode === 'chase' ? 1.2 : 0.9), 0, 1));
      c.jointT -= dt;
      if (c.jointT <= 0) { c.jointT = 3 + Math.random() * 3; if (rate > 0.5) audio.joint(1 - z); }
      const reachTo = c.reachT > 0 ? 1 : c.mode === 'chase' ? 0.35 : c.mode === 'search' ? 0.25 : 0;
      c.reach = lerp(c.reach, reachTo, Math.min(1, dt * 5));
      c.scan = c.mode === 'search' ? Math.round(Math.sin(run.t * 1.3) * 2) / 2 : c.mode === 'lose' ? -1 : 0;
      if (!hidden && c.gap <= TUNE.catchGap) caught('caught');
    }

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
      const top = run.act === 'duck' ? 11 : 22;
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
      spike(pen[2], ob.v); // the crash is heard: awareness, not a jump in its position
      audio.thud(); haptic(ob.major ? 'heavy' : 'warning'); dust();
      if (ob.k === 'hole') { setAct('fall', pen[0]); run.after = { x: ob.x1 + 0.3 }; run.dist = (ob.x0 + ob.x1) / 2; }
      else if (ob.k === 'snag') { setAct('stumble', pen[0]); run.after = { duck: ob }; run.dist = ob.x0 - 0.15; }
      else { setAct('stumble', pen[0]); run.after = { x: ob.x1 + 0.15 }; }
    }

    // ---------- the traveller ----------
    function enterHide(zone) {
      const c = run.c;
      if (c.mode === 'chase' && gapNow() < TUNE.seenGap) { caught('seen'); return; }
      run.act = 'hide'; run.spot = zone; run.hiddenFor = 0; run.kneel = 0.14; run.overtime = run.hideT >= zone.comfort;
      zone.rustle = 1; audio.rustle(1); haptic('light'); note('hide:' + zone.type);
      save.hints.hide = 1;
      if (run.hint === 'LET GO TO HIDE') { run.hint = ''; run.hintT = 0; }
      // slow into the cover: a short glide onto the hiding point
      const inZone = clamp(run.dist + run.speed * 0.12, zone.x0 + 0.3, zone.x1 - 0.3);
      run.settle = zone.type === 'corn' ? inZone : zone.x0 + (zone.x1 - zone.x0) * zone.at;
      for (let i = 0; i < 4; i++) spark(L.PX + (Math.random() - 0.5) * 10, L.yFeet - 8 - Math.random() * 10, (Math.random() - 0.5) * 16, -10, 0.5, 'tassel');
    }
    function leaveHide() {
      const c = run.c, gap = gapNow();
      audio.rustle(0.8); note('unhide'); run.kneel = 0.12;
      for (let i = 0; i < 5; i++) spark(L.PX + (Math.random() - 0.3) * 10, L.yFeet - 10 - Math.random() * 8, 10 + Math.random() * 20, -14, 0.6, 'tassel');
      // breaking cover right under it is being seen; nearby, it hears the corn and turns
      if ((c.mode === 'search' || c.mode === 'investigate') && gap < 2) { caught('seen'); return; }
      if ((c.mode === 'search' || c.mode === 'investigate') && gap < 8) { spike(TUNE.bolt, 'bolt'); c.startle = 0.6; }
      run.spot = null; run.settle = null; run.overtime = false; run.targeted = false;
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
      if (run.kneel > 0) run.kneel -= dt;
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
        if (run.act === 'hide') { leaveHide(); if (!sim()) return; }
        run.act = 'run';
        const target = runSpeed();
        run.speed = run.speed < target ? Math.min(target, run.speed + TUNE.accel * dt) : Math.max(target, run.speed - TUNE.decel * dt);
      } else {
        if (zone && run.act !== 'hide') { enterHide(zone); if (!sim()) return; }
        if (run.act === 'hide') {
          if (run.settle !== null) {
            const dx = run.settle - run.dist, step = Math.max(1.5, run.speed) * dt;
            run.dist += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
            run.speed = Math.max(0, run.speed - 30 * dt);
            if (Math.abs(dx) <= step) { run.settle = null; run.speed = 0; }
          } else run.speed = 0;
        } else {
          run.act = 'walk';
          const target = TUNE.walk * (run.tired ? TUNE.tiredWalk : 1);
          run.speed = run.speed > target ? Math.max(target, run.speed - TUNE.decel * dt) : Math.min(target, run.speed + TUNE.accel * dt);
        }
      }
      // stamina: running spends it, walking barely holds it, cover restores it
      if (run.act === 'run') run.stamina -= (TUNE.drain + TUNE.drainGain * d) * dt;
      else if (run.act === 'hide') run.stamina += (TUNE.recoverHide - TUNE.recoverHideLoss * d) * dt;
      else if (run.act === 'walk' || run.act === 'duck' || run.act === 'climb') run.stamina += TUNE.recoverWalk * dt;
      run.stamina = clamp(run.stamina, 0, 100);
      if (run.stamina <= 0.01 && !run.tired) { run.tired = true; haptic('warning'); note('exhausted'); }
      if (run.tired && run.stamina >= TUNE.rested) { run.tired = false; note('rested'); }
      // the hiding clock winds down slowly once you leave cover, so ducking out and back in buys nothing
      if (run.act === 'hide') {
        run.hideT += dt; run.hiddenFor += dt;
        const was = run.overtime; run.overtime = run.hideT >= run.spot.comfort * (1 - 0.25 * d);
        if (run.overtime && !was) { note('overtime'); showHint('overtime', 'STAYING TOO LONG', 2.4); }
      } else run.hideT = Math.max(0, run.hideT - dt * 0.8);
      // move; the score only counts ground actually covered
      if (run.act !== 'hide') { run.dist += run.speed * dt; run.score = Math.max(run.score, run.dist); }
      const prevStep = run.stepPh;
      run.ph += dt * (run.act === 'run' ? 2.4 + run.speed * 1.05 : run.tired ? 2.4 + run.speed * 1.2 : 3.4 + run.speed * 1.4);
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
            if (loud) spike(TUNE.crowsAware, 'crows');
          }
        }
      }
      if (run.hintT > 0) { run.hintT -= dt; if (run.hintT <= 0) run.hint = ''; }
      if (zone && run.act !== 'hide' && !save.hints.hide && run.hint !== 'LET GO TO HIDE') { run.hint = 'LET GO TO HIDE'; run.hintT = 2.5; }
      updateAwareness(dt);
      updateCreature(dt);
      if (!sim()) return;
      // heart while it is near your hiding place
      if (run.act === 'hide' && gapNow() < 12) { run.heartT -= dt; if (run.heartT <= 0) { audio.heart(clamp(1 - Math.abs(gapNow()) / 12, 0.3, 1)); run.heartT = run.targeted ? 0.38 : run.c.mode === 'search' ? 0.55 : 0.8; } }
      if (run.spot && run.act === 'hide' && run.c.mode === 'search' && Math.random() < dt * (run.targeted ? 5 : 1.2)) run.spot.rustle = 1;
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
      else if (id === 'figure') { if (gapNow() < 26) return false; scene.figure = 1.1; scene.figureX = L.W * (0.55 + Math.random() * 0.35); }
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
      // nothing decorative while it is close, searching or chasing
      if (mode !== MODES.PLAYING || gapNow() < 12 || run.c.mode === 'search' || run.c.mode === 'chase') return;
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
    const pauseRect = () => ({ x: W - 17, y: safeT + 3, w: 13, h: 13 });
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
    // One continuous mapping from the creature's distance to where and how big it is drawn: as it
    // closes it comes up out of the far field toward the path behind you, growing smoothly. The crop
    // line at its depth hides everything below it, so it wades through the corn at every distance.
    const VIEW = { k: 0.3, x: 0, gy: 0, crop: 0, z: 1 };
    function creatureView(c, t, gapOverride) {
      const gap = gapOverride !== undefined ? gapOverride : c.gap, v = VIEW;
      const z = clamp((gap - 1) / 39, 0, 1);
      // far away and unaware it sinks into the crop now and then; only its hat and eyes show
      const lurk = (c.mode === 'follow' || c.mode === 'wake') && z > 0.55 && Math.sin(t * 0.55 + 1) < -0.2;
      c.sink = lerp(c.sink || 0, lurk ? 10 : 0, 0.05);
      v.z = z;
      v.k = Math.round(lerp(0.85, 0.28, Math.pow(z, 0.7)) * 40) / 40;
      v.gy = Math.round(lerp(L.yFeet - 5, L.yDist + 26, Math.pow(z, 0.8)) + c.sink);
      v.x = Math.round(lerp(L.PX - 20, W * 0.12, Math.pow(z, 0.6)) + Math.sin(t * 0.3) * 2 * z);
      v.crop = Math.round(z < 0.15 ? lerp(L.yFeet - 6, L.yBack - 2, z / 0.15) : lerp(L.yBack - 2, L.yDist + 1, (z - 0.15) / 0.85));
      return v;
    }
    const COPT = { facing: 1, phase: 0, t: 0, reach: 0, rx: 0, ry: 0, scan: 0, eyes: 1, tilt: 0 };
    function drawCreatureAt(v, c, p, t, extra) {
      COPT.facing = c.facing; COPT.phase = Math.floor(c.phase * 8 / TAU * 2) / (8 / TAU * 2); COPT.t = t; COPT.reach = c.reach;
      // when it checks a hiding place it reaches for exactly that place
      const tx = c.mode === 'search' && run ? (c.checkX - run.dist) * PPM + L.PX : L.PX + 4;
      COPT.rx = tx; COPT.ry = L.yFeet - 10;
      COPT.scan = c.scan; COPT.eyes = (t % 3.7) < 0.12 ? 0 : 1; COPT.tilt = Math.round(Math.sin(t * 0.37) * 2) / 10;
      if (extra) { COPT.reach = extra.reach; COPT.rx = extra.rx; COPT.ry = extra.ry; }
      // clip to the crop line at its depth, stepped so the edge reads as stalk tops
      const off = run && sim() ? run.dist * PPM * 0.85 : 0;
      G.save(); G.beginPath(); G.moveTo(0, 0); G.lineTo(W, 0);
      for (let x = W; x >= 0; x -= 3) { const y = v.crop + ((hash(Math.floor((x + off) / 3)) * 3) | 0); G.lineTo(x, y); G.lineTo(x - 3, y); }
      G.closePath(); G.clip();
      curFill = '';
      drawCreature(v.x, v.gy, v.k, COPT, p);
      G.restore(); curFill = '';
    }
    function drawShadow(v, p, strength) {
      // its shadow reaches along the path before it does (the sun is behind it)
      const len = Math.round(lerp(10, 70, strength)), x0 = v.x - 2, y0 = L.yFeet - 4;
      poly([x0, y0, x0 + 5, y0, x0 + len + 8, y0 + 7, x0 + len, y0 + 8], FIX.ink, true);
      poly([x0 + len * 0.55, y0 + 3, x0 + len * 0.55 + 3, y0 + 3, x0 + len + 14, y0 - 2, x0 + len + 12, y0 - 1], FIX.ink, true);
    }

    const PUSH = { x: 0, amt: 0 }, BRUSH = { x: 0, amt: 0 };
    function drawWorld(p, stageF, dist, t, dt, cr, pose) {
      const camPx = dist * PPM - L.PX;
      const playing = !!(run && sim()), hidden = playing && run.act === 'hide', spot = hidden ? run.spot : null, zone = playing ? run.inZone : null;
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
      scene.drawDistCorn(L, p, camPx, t);
      scene.drawMidCorn(L, p, camPx, t);
      // back-row pumpkins sit low in the stalks
      for (const pr of world.props) if (pr.k === 'pumpkin' && pr.layer === 'back') { const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX); if (x > -10 && x < W + 10) drawPumpkin(x, L.yFeet - 5, 0, p, pr.lit || 0); }
      // the corn moves around it as it wades through
      PUSH.amt = 0;
      if (cr) { PUSH.x = cr.v.x; PUSH.amt = cr.v.z < 0.45 && cr.c.mode !== 'wake' ? 1 - cr.v.z / 0.45 : 0; }
      scene.drawBackRow(L, p, camPx, t, run && run.stir, PUSH);
      for (const pr of world.props) {
        if (pr.k === 'pumpkin') continue;
        const x = Math.round((pr.x - dist) * PPM * 0.85 + L.PX);
        if (x > -30 && x < W + 30) drawProp(pr, x, L, p, t);
      }
      if (cr) drawCreatureAt(cr.v, cr.c, p, t, cr.extra);
      scene.drawPath(L, p, camPx);
      if (cr && cr.v.z < 0.3) drawShadow(cr.v, p, 1 - cr.v.z / 0.3);
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
      // In cover the traveller is drawn in shade and a step back into the crop; the cover is drawn over them.
      // In a hollow tree or a shed only their eyes show in the dark opening.
      const inside = spot && (spot.type === 'tree' || spot.type === 'shed');
      if (pose && !inside) {
        const back = hidden ? 2 : 0;
        pose.shade = hidden;
        const info = drawPlayer(L.PX - 8, L.yFeet - back - Math.round(pose.air || 0), pose);
        pose.top = info.top;
      } else if (pose) pose.top = L.yFeet - 30;
      if (spot && spot.type !== 'corn') {
        const sx = Math.round((spot.x0 - dist) * PPM + L.PX), ex = Math.round((spot.x1 - dist) * PPM + L.PX);
        hopt.near = false; hopt.hidden = true;
        const sh = spot.rustle > 0.5 ? Math.round(Math.sin(t * 40)) : 0;
        drawHideSpot(spot, sx + sh, ex + sh, L, p, t, hopt);
      }
      BRUSH.x = L.PX; BRUSH.amt = playing && run.act === 'run' && run.speed > 3 && Math.floor(run.ph / Math.PI) % 2 === 0 ? 1 : 0;
      scene.drawFront(L, p, camPx, t, BRUSH);
      for (const f of world.feats) if (f.k === 'hide' && f.type === 'corn') scene.drawClump(L, p, camPx, f, t, f.rustle || 0, f === zone && !hidden);
      // a few stalks close in front of a traveller hiding in the corn
      if (spot && spot.type === 'corn') {
        for (let k = -2; k <= 2; k++) {
          const x = L.PX + k * 3 - 1, top = L.yFeet - 16 + Math.abs(k) * 2, sw = Math.round(Math.sin(t * 1.6 + k) * 0.6 + (spot.rustle || 0) * Math.sin(t * 22 + k));
          R(x, top + 3, 2, L.yFront - top, p.frontLeaf); R(x + sw, top, 1, 4, p.frontLeaf); R(x + sw, top - 1, 1, 1, p.tassel);
          R(x + (k & 1 ? 2 : -3) + sw, top + 6, 3, 1, p.frontLeafLit);
        }
      }
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
        // stepped like a cloud's edge, lighter at its ends, sliding across the crop
        const u = 1 - run.shade / 5, w = Math.round(W * 0.8), x0 = Math.round(lerp(W + 40, -w - 40, u)), y0 = L.yDist;
        G.globalAlpha = 0.2;
        R(x0 + 12, y0, w - 24, L.yFront - y0, FIX.ink);
        for (let k = 0; k < 3; k++) {
          const inset = Math.round((L.yFront - y0) * (0.2 + k * 0.2));
          R(x0 + k * 4, y0 + inset, 4, L.yFront - y0 - inset, FIX.ink); R(x0 + w - 4 - k * 4, y0 + inset, 4, L.yFront - y0 - inset, FIX.ink);
        }
        G.globalAlpha = 1;
      }
    }

    // Danger: hard-edged bands of deep burgundy at the frame edges and a faint shift of the whole
    // picture toward it. Never dithered, never over the centre where the traveller is.
    function drawDanger(level) {
      if (level <= 0.02) return;
      const t = Math.max(2, Math.round(Math.min(W, H) * 0.035)), alphas = [0.34, 0.2, 0.1];
      G.globalAlpha = 0.07 * level; R(0, 0, W, H, FIX.blood);
      for (let i = 0; i < 3; i++) {
        const o = i * t;
        G.globalAlpha = alphas[i] * level;
        R(o, o, W - 2 * o, t, FIX.blood); R(o, H - o - t, W - 2 * o, t, FIX.blood);
        R(o, o + t, t, H - 2 * o - 2 * t, FIX.blood); R(W - o - t, o + t, t, H - 2 * o - 2 * t, FIX.blood);
      }
      G.globalAlpha = 1;
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
    // outlined pixel text: readable over sky or field with no box behind it
    function outlined(s, x, y, c, f, sc) {
      f = f || F3; sc = sc || 1;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) text(s, x + dx, y + dy, FIX.ink, f, sc);
      return text(s, x, y, c, f, sc);
    }
    function outlinedC(s, cx, y, c, f, sc) { return outlined(s, Math.round(cx - textW(s, f || F3, sc || 1) / 2), y, c, f, sc); }
    // a row of small pips: seconds of comfort left in this cover
    function pips(cx, y, total, left, warn) {
      const n = Math.max(1, Math.round(total)), w = n * 3 - 1, x0 = Math.round(cx - w / 2);
      for (let i = 0; i < n; i++) {
        const on = i < left, c = warn ? (Math.floor(clock * 6) % 2 ? FIX.ember : '#7a2a2a') : on ? FIX.cream : '#5a4a42';
        R(x0 + i * 3 - 1, y - 1, 4, 4, FIX.ink); R(x0 + i * 3, y, 2, 2, c);
      }
    }

    // The one short message worth reading right now, if any, in a lane under the HUD.
    function contextLabel() {
      const c = run.c, gap = gapNow(), hidden = run.act === 'hide';
      if (mode === MODES.STARTING) return run.hint ? [run.hint, FIX.cream] : null;
      if (hidden && run.targeted && c.reachT > 0) return ['MOVE NOW', FIX.ember, true];
      if (run.hint) return [run.hint, FIX.cream];
      if (run.tired && !hidden) return ['EXHAUSTED', FIX.ember];
      if (!hidden && c.mode === 'chase' && gap < 16) return ["THEY'RE CLOSE", FIX.ember, gap < 7];
      if (hidden && run.hiddenFor < 1.0) return ['HIDDEN', '#d9c09a'];
      if (hidden && (c.mode === 'search' || c.mode === 'investigate') && gap < 10) return ['STAY STILL', FIX.cream];
      if (hidden && (c.mode === 'lose' || c.mode === 'ret') && run.stamina > 60) return ['KEEP MOVING', FIX.glow];
      if (!hidden && (run.a >= TUNE.hunting || run.stamina < 35) && !run.inZone) {
        const nh = world.nextHide(run.dist);
        if (nh && nh.x0 - run.dist < 14) return ['HIDE NEARBY', FIX.glow];
      }
      return null;
    }

    function drawHUD(p) {
      const y0 = safeT + 4, muted = '#e0c69a';
      // distance leads; best sits under it, smaller
      outlined('DISTANCE', 5, y0, muted, F3);
      outlined(Math.floor(run.score) + ' M', 5, y0 + 8, FIX.cream, F5, 2);
      outlined('BEST', 5, y0 + 26, muted, F3);
      outlined(Math.max(save.best, Math.floor(run.score)) + ' M', 5 + textW('BEST', F3) + 4, y0 + 25, FIX.cream, F5);
      const pr = pauseRect();
      R(pr.x, pr.y, pr.w, pr.h, FIX.ink); R(pr.x + 1, pr.y + 1, pr.w - 2, 1, '#3a2a22');
      R(pr.x + 4, pr.y + 3, 2, 7, FIX.cream); R(pr.x + 8, pr.y + 3, 2, 7, FIX.cream);
      // the context lane, under the HUD block and in the sky: never over the path
      const lab = contextLabel(), ly = y0 + 40;
      if (lab && (!lab[2] || Math.floor(clock * 5) % 2 === 0)) outlinedC(lab[0], W / 2, ly, lab[1], F5);
      if (run.stageToast > 0 && run.stageShown > 0 && !lab) {
        const nm = STAGE_NAMES[Math.min(3, run.stageShown)];
        if (run.stageToast > 0.4 || Math.floor(clock * 8) % 2) outlinedC(nm, W / 2, ly + 2, muted, F3);
      }
      // HIDE, beside the cover itself; its pips say how long it is comfortable
      const top = (run.pose && run.pose.top) || L.yFeet - 26;
      if (run.inZone && run.act !== 'hide' && mode === MODES.PLAYING) {
        const ty = Math.min(top - 12, L.yFeet - HIDE_TOP[run.inZone.type] - 13);
        if (Math.floor(clock * 4) % 3 !== 0) outlinedC('HIDE', L.PX, ty, FIX.glow, F3);
        pips(L.PX, ty + 8, run.inZone.comfort, Math.round(run.inZone.comfort), false);
      }
      if (run.act === 'hide' && run.spot) {
        const comfort = run.spot.comfort * (1 - 0.25 * diff()), left = Math.max(0, Math.ceil(comfort - run.hideT));
        pips(L.PX, Math.min(top - 6, L.yFeet - HIDE_TOP[run.spot.type] - 7), comfort, left, run.overtime || run.targeted);
      }
      // stamina: full, spending, critical, recovering
      const bw = 44, bh = 4, bx = Math.round(W / 2 - bw / 2 + 14), by = H - 11 - safeB;
      const hidden = run.act === 'hide', rec = hidden && run.stamina < 99.5, crit = run.stamina < TUNE.low;
      outlined('STAMINA', bx - textW('STAMINA', F3) - 4, by - 1, run.tired ? FIX.ember : muted, F3);
      R(bx - 1, by - 1, bw + 2, bh + 2, FIX.ink);
      R(bx, by, bw, bh, '#3a2a22');
      const fc = run.tired ? (Math.floor(clock * 4) % 2 ? FIX.ember : '#7a2a2a') : rec ? FIX.glow : crit ? (Math.floor(clock * 2.5) % 2 ? FIX.ember : FIX.cream) : FIX.cream;
      const fw = Math.round(bw * run.stamina / 100);
      R(bx, by, fw, bh, fc); if (fw > 1) R(bx, by, fw, 1, rec ? FIX.glowHot : '#fff3d6');
      if (rec) { const sx = bx + ((Math.floor(clock * 30) % Math.max(1, fw))); R(sx, by + 1, 1, bh - 1, FIX.glowHot); R(bx + fw + 1, by + 1, 1, 2, FIX.glow); }
      R(bx + Math.round(bw * TUNE.rested / 100), by + bh, 1, 1, '#8a6a5a');
    }

    const POSE = { mode: 'idle', ph: 0, t: 0, air: 0, blink: false, lift: 0, top: 0, shade: false };
    function playerPose() {
      const a = run.act;
      let m = 'idle';
      if (mode === MODES.STARTING) m = 'idle';
      else if (run.kneel > 0 && (a === 'hide' || a === 'run')) m = 'kneel';
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
      POSE.mode = m; POSE.ph = run.ph; POSE.t = clock; POSE.air = air; POSE.blink = (clock % 3.1) < 0.12; POSE.lift = 0; POSE.shade = false;
      return POSE;
    }

    const CR = { v: null, c: null, extra: null }, CEXTRA = { reach: 0, rx: 0, ry: 0 };
    const TITLE_C = { facing: 1, phase: 0.6, reach: 0, scan: 0, mode: 'follow', sink: 0, gap: 30 };
    function render(dt) {
      if (buf.width !== W || buf.height !== H) { buf.width = W; buf.height = H; }
      setTarget(b);
      buttons = [];
      const t = clock;
      if (mode === MODES.MENU) {
        const p = paletteAt(0);
        TITLE_C.scan = Math.round(Math.sin(t * 0.4) * 2) / 2;
        // on the title it stands still, tall, far out in the field
        const v = { k: 0.62, x: Math.round(W * 0.76), gy: Math.round(L.yDist + 16), crop: L.yDist + 1, z: 1 };
        drawWorld(p, 0, 0, t, dt, { v, c: TITLE_C }, { mode: 'idle', ph: 0, t, blink: (t % 3.3) < 0.12 });
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
      if (mode === MODES.CAUGHT) {
        const ct = modeT;
        if (ct >= 0.6) { renderCaughtClose(p, ct); return; }
        // it closes the last step and lifts you; it was already right behind you
        const u = clamp(ct / 0.45, 0, 1);
        creatureView(run.c, t, lerp(run.c.gap, 0.5, u));
        const top = pose.top || L.yFeet - 26;
        CEXTRA.reach = Math.min(1, u * 1.3); CEXTRA.rx = L.PX - 1; CEXTRA.ry = top + 6 - Math.max(0, ct - 0.3) * 40; CR.extra = CEXTRA;
        run.c.facing = 1; VIEW.crop = L.yFeet;
        pose.mode = ct > 0.3 ? 'lifted' : 'crouch'; pose.lift = Math.max(0, ct - 0.3) * 40; pose.air = 0;
        run.spot = null;
      }
      // a one-pixel bob on the stride while sprinting; still when hidden
      const bob = mode === MODES.PLAYING && run.act === 'run' && run.speed > 5 && !run.tired ? Math.floor(run.ph / Math.PI) & 1 : 0;
      if (bob) { G.save(); G.translate(0, bob); curFill = ''; }
      drawWorld(p, stageF, run.dist, t, dt, CR, pose);
      for (const q of PARTS) {
        if (!q.on) continue;
        const c = FIX[q.c] || p[q.c] || q.c;
        if (q.kind === 'puff') { if (q.life / q.max > 0.3) R(Math.round(q.x), Math.round(q.y), 2, 1, c); }
        else if (q.kind === 'leaf') { const f = Math.floor(q.life * 6) & 1; R(Math.round(q.x), Math.round(q.y), f ? 2 : 1, f ? 1 : 2, c); }
        else R(Math.round(q.x), Math.round(q.y), 1, 1, c);
      }
      if (bob) { G.restore(); curFill = ''; }
      // danger rises with how near it is and how much it knows; cover softens it
      const c = run.c, gap = gapNow();
      let threat = clamp((24 - gap) / 18, 0, 1) * clamp((run.a - 20) / 60, 0, 1);
      if (run.act === 'hide') threat = run.targeted ? 0.8 : c.mode === 'search' && gap < 10 ? 0.45 : threat * 0.5;
      run.threat = threat;
      drawDanger(Math.max(threat, stageF > 2.5 ? 0.25 : 0));
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
        drawDanger(1);
        return;
      }
      R(0, 0, W, H, FIX.blood);
      if (ct < 1.6) { const ex = Math.round(W * 0.5), ey = Math.round(H * 0.3); R(ex - 9, ey, 3, 3, FIX.glowHot); R(ex + 5, ey + 1, 3, 3, FIX.glowHot); }
    }
    function renderOver() {
      R(0, 0, W, H, FIX.blood);
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
      g.drawImage(buf, 0, 0, W, H, offX, offY, W * SC, H * SC);
    }

    // ---------- loop ----------
    let acc = 0, frozen = false;
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
      // leaves shake loose more often as it closes in
      const near = mode === MODES.PLAYING ? clamp((20 - gapNow()) / 16, 0, 1) : 0;
      if (Math.random() < dt * (1.4 + near * 4)) spark(W * (0.1 + Math.random() * 0.9), L.yBack - 6 - Math.random() * 20, -8 - Math.random() * 8, 4, 4, Math.random() < 0.5 ? 'pumpkin' : 'backLeafLit', 'leaf');
    }
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      clock += dt; modeT += dt;
      const t0 = performance.now();
      if (sim() && !frozen) {
        acc += dt; let n = 0;
        while (acc >= DT && n < 6 && sim()) { stepSim(DT); acc -= DT; n++; }
        if (n === 6) acc = 0;
      } else acc = 0;
      if (mode === MODES.CAUGHT && modeT > 1.75) setMode(MODES.GAME_OVER);
      if (mode !== MODES.PAUSED) updateFx(dt);
      const playing = mode === MODES.PLAYING;
      const prox = playing ? clamp(1 - gapNow() / 26, 0, 1) * (0.4 + 0.6 * clamp(run.a / 76, 0, 1)) : mode === MODES.CAUGHT ? 1 : 0;
      audio.update({
        dt, playing, hidden: playing && run.act === 'hide',
        run: playing ? clamp(run.speed / 8, 0, 1) : 0,
        prox,
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
        playerState, creatureState, awarenessLevel, pursuit, gapNow, discoveryChance, creatureView: (gap) => Object.assign({}, creatureView(run.c, 0, gap)), perf,
        // tests only: drop whatever is happening and stand at the menu
        reset() { mode = MODES.MENU; modeT = 1; run = newRun(); input.pointers.clear(); input.key = false; },
        // tests only: hold the simulation still while frames keep drawing
        freeze(v) { frozen = !!v; },
        hold(v) { input.key = !!v; },
        advance(sec, hold) { if (hold !== undefined) input.key = !!hold; const n = Math.round(sec / DT); for (let i = 0; i < n && sim(); i++) stepSim(DT); },
        size: () => ({ W, H, SC, offX, offY })
      };
    }
  }
};
