// ORBIT: wiring. Owns layout, input, animation and the game flow
// (play -> stage reveals -> solving -> done -> next), and talks to the Plethora SDK.

window.plethoraBit = {
  meta: {
    title: 'ORBIT',
    runtime: 'plethora-bit@2',
    tags: ['puzzle', 'daily', 'logic', 'colour'],
    permissions: ['audio', 'backgroundMusic', 'haptics', 'storage']
  },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // ---- Fonts (non-blocking: system fallbacks render the first frame) --------
    const fonts = [
      ['Space Grotesk', 'space-grotesk', { weight: '300 700' }],
      ['Space Mono', 'space-mono', { weight: '400' }],
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }]
    ];
    fonts.forEach(f => {
      try {
        const p = ctx.loadFont(f[0], f[1], '1.0.0', f[2]);
        if (p && p.catch) p.catch(err => { try { ctx.platform.error({ stage: 'font', font: f[1], message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    });

    // ---- Surfaces ---------------------------------------------------------------
    const canvas = ctx.createCanvas2D({ coordinateSpace: 'backing-store', maxDpr: 3, touchAction: 'none', layer: 'content', input: 'auto' });
    canvas.style.touchAction = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.userSelect = 'none';
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.setAttribute('aria-label', 'ORBIT puzzle board');
    const bgCanvas = ctx.createCanvas2D({ coordinateSpace: 'backing-store', maxDpr: 2, layer: 'background', input: 'passthrough' });
    const board = createGameBoard(canvas, bgCanvas);
    const scores = createScoreManager(ctx);
    const sound = createSound(ctx);
    sound.setMuted(!!scores.profile.muted);

    // ---- Edition --------------------------------------------------------------------
    const todayKey = dateKey(new Date());
    const today = dayNumberFromKey(todayKey);

    // Puzzles are deterministic; keep the few we have built this session.
    const puzzleCache = {};
    function presetFor(mode, n) {
      if (mode === 'daily') return 'standard';
      if (n <= 2) return 'gentle';
      return n % 4 === 0 ? 'deep' : 'standard';
    }
    function puzzleFor(mode, n) {
      const key = mode === 'daily' ? keyFromDayNumber(n) : 'practice:' + n;
      const preset = presetFor(mode, n);
      const ck = key + '|' + preset;
      if (!puzzleCache[ck]) {
        const ks = Object.keys(puzzleCache);
        if (ks.length > 6) delete puzzleCache[ks[0]];
        puzzleCache[ck] = PuzzleGenerator.generate(key, preset);
      }
      return puzzleCache[ck];
    }

    // ---- Game state (single source of truth for the puzzle lives in `eng`) ----------
    const G = {
      mode: 'daily',        // daily | study | gallery
      phase: 'play',        // intro | play | solving | done | transition
      level: 1, day: today,
      puzzle: null, eng: null, theme: null,
      vis: [], tween: [],   // visual angle per ring, active snap tweens
      selected: -1, selectT: 0, selectAt: 0,
      focus: -1, focusT: 0, focusDimUntil: 0,
      famFocus: null,
      clue: [],             // per condition: { appear, glow, revealAt, status, isNew }
      reveal: null,
      completeT: 0, completeGlow: 0, completeAt: 0,
      orbitA: 0,
      hint: null,
      started: false, attempt: 0, interacted: false,
      clock: null, elapsedFallback: 0,
      restoredSolved: false,
      transition: null,
      prev: null,
      dirty: true,
      result: null
    };

    // ---- HUD ---------------------------------------------------------------------------
    const hud = createHud(ctx, {
      onMode: m => switchMode(m),
      onCollection: () => openCollection(),
      onCloseModal: () => closeModal(),
      onCollectionItem: it => hud.openDetail(it),
      onGallery: it => openGallery(it),
      onMute: () => toggleMute(),
      onUndo: () => doUndo(),
      onReset: () => doReset(),
      onHint: () => doHint(),
      onRotate: d => tapRotate(d),
      onClue: i => focusClue(i, true),
      onShare: () => doShare(),
      onNext: () => doNext()
    });
    hud.setMuted(!!scores.profile.muted);
    ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });

    // ---- Layout ----------------------------------------------------------------------------
    // The board is the centre of the piece; clue markers sit just outside its rim.
    const RIM = 1.22;
    let L = null;
    function computeLayout() {
      const W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
      const a0 = ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 120, left: 0 };
      const area = { top: a0.top || 0, right: a0.right || 0, bottom: a0.bottom || 0, left: a0.left || 0 };
      const top = area.top, bot = H - area.bottom;
      const wide = W > H * 1.15 && W >= 620;
      const lay = { W, H, area, wide };
      if (!wide) {
        const compact = (bot - top) < 680;
        const headerH = compact ? 112 : 118;
        const bottomH = compact ? 208 : 268;
        const availTop = top + headerH, availBot = bot - bottomH;
        let R = Math.min((W - 20) / 2 / RIM, (availBot - availTop) / 2 / RIM, 250);
        R = Math.max(60, R);
        lay.compact = compact;
        lay.R = R; lay.cx = W / 2;
        lay.cy = (availTop + availBot) / 2;
        lay.headerTop = top + (compact ? 4 : 10);
        lay.colX = 0; lay.colW = W;
        lay.bottomTop = Math.min(lay.cy + R * RIM + 2, availBot + 6);
        lay.doneTop = lay.bottomTop - 2;
      } else {
        const R = Math.max(60, Math.min((bot - top - 24) / 2 / RIM, (W * 0.56 - 32) / 2 / RIM, 290));
        lay.compact = (bot - top) < 600;
        lay.R = R; lay.cx = area.left + W * 0.29; lay.cy = (top + bot) / 2;
        lay.colX = W * 0.56; lay.colW = W * 0.44 - area.right;
        const colH = 118 + 268;
        lay.headerTop = Math.max(top + 10, (top + bot) / 2 - colH / 2);
        lay.bottomTop = lay.headerTop + 124;
        lay.doneTop = lay.bottomTop;
      }
      return lay;
    }
    function relayout() {
      L = computeLayout();
      const pr = Math.min(2, Math.max(1, ctx.nativeDpr || ctx.dpr || window.devicePixelRatio || 1));
      board.resize(L.W, L.H, pr, L.cx, L.cy, L.R);
      hud.setLayout(L);
      G.dirty = true;
    }

    // ---- Puzzle setup --------------------------------------------------------------------
    function loadPuzzle(mode, n, saved) {
      G.mode = mode;
      if (mode === 'daily') { G.day = n; G.theme = ThemeEngine.forDaily(n); }
      else { G.level = n; G.theme = ThemeEngine.forLevel(n); }
      G.puzzle = puzzleFor(mode, n);
      G.eng = createGame(G.puzzle, saved && saved.eng);
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP);
      G.tween = new Array(nr).fill(null);
      G.clue = G.puzzle.conds.map((c, i) => ({ appear: i < G.eng.revealed() ? 1 : 0, glow: 0, revealAt: 0, status: '', isNew: false }));
      G.reveal = null;
      G.selected = -1; G.selectT = 0; G.hint = null; G.famFocus = null;
      G.focus = G.eng.hintTarget(-1); G.focusT = 0; G.focusDimUntil = 0;
      G.completeT = 0; G.completeGlow = 0; G.result = null;
      G.started = false; G.interacted = false;
      G.orbitA = orbitTarget();
      if (G.clock) { try { G.clock.destroy(); } catch (e) { } }
      G.clock = null;
      G.elapsedFallback = saved && saved.elapsedMs > 0 ? saved.elapsedMs : 0;
      if (ctx.game && ctx.game.stopwatch) {
        try { G.clock = ctx.game.stopwatch({ elapsedMs: G.elapsedFallback }); } catch (e) { G.clock = null; }
      }
      hud.applyTheme(G.theme);
      hud.showRotate(false);
      G.phase = 'play';
      G.dirty = true;
      syncHud();
    }
    function elapsed() { return G.clock ? G.clock.elapsedMs : G.elapsedFallback; }
    function clockStart() { if (G.clock) G.clock.start(); G.running = true; }
    function clockPause() { if (G.clock) G.clock.pause(); G.running = false; }
    function stages() { return G.puzzle.cum.length; }
    function orbitTarget() { return G.eng ? (G.eng.solved ? TAU : (G.eng.stage / stages()) * TAU) : 0; }

    function editionLabel() {
      if (G.mode === 'daily') return 'DAILY PUZZLE · NO. ' + pad3(G.day) + ' · ' + prettyDate(keyFromDayNumber(G.day));
      if (G.mode === 'study') return 'PRACTICE NO. ' + pad3(G.level) + ' · ' + PUZZLE_PRESETS[G.puzzle.preset].label.toUpperCase();
      return 'COLLECTION · ' + (G.galleryItem ? G.galleryItem.sub : '');
    }

    // ---- Caption: the focused clue, or a short message held for a moment ------------------
    let captionHoldUntil = 0;
    function flashCaption(label, text, ms) {
      captionHoldUntil = now() + (ms || 2800);
      hud.setClueText(label, text);
      ctx.timeout(() => { if (now() >= captionHoldUntil - 5) syncHud(); }, (ms || 2800) + 50);
    }
    function clueLabel(i) {
      const c = G.puzzle.conds[i];
      const st = G.eng.status(i);
      const word = st === 'solved' ? 'HOLDS' : st === 'revealed' ? 'NEW' : 'BROKEN';
      return HOURS[c.pos] + ' · ' + CONDITION_TYPES[c.type].label.toUpperCase() + ' · ' + word;
    }
    function syncHud() {
      if (!G.eng) return;
      const playing = G.phase === 'play' || G.phase === 'intro';
      hud.setHeader(G.mode, editionLabel(), G.phase === 'done' && G.mode !== 'gallery');
      hud.setStats(G.eng.moves, G.mode === 'gallery' ? 0 : G.eng.budget, elapsed(), Math.min(G.eng.stage + 1, stages()), stages());
      hud.setControls(G.eng.history.length > 0, playing);
      hud.setClues(G.puzzle.conds.map((c, i) => ({
        type: c.type, label: CONDITION_TYPES[c.type].label, hour: HOURS[c.pos],
        status: G.eng.status(i), locked: i >= G.eng.revealed(), focus: i === G.focus,
        swatch: c.type === 'missing' ? G.theme.paletteFor(G.puzzle.ringCount)[G.puzzle.ringCount - 1][c.fam].css : '',
        isNew: G.clue[i] && G.clue[i].isNew
      })), G.puzzle.stages);
      if (playing && now() >= captionHoldUntil) {
        if (!scores.profile.seenIntro && !G.interacted) {
          hud.setClueText('STAGE 1 OF ' + stages(), 'Turn the rings until every marked intersection holds at once');
        } else if (G.focus >= 0) {
          hud.setClueText(clueLabel(G.focus), condText(G.puzzle.conds[G.focus]));
        } else {
          hud.setClueText('STAGE ' + (G.eng.stage + 1) + ' OF ' + stages(), G.eng.satisfiedCount() + ' of ' + G.eng.revealed() + ' intersections hold');
        }
      }
    }
    function focusClue(i, byUser) {
      if (!G.eng || i < 0 || i >= G.eng.revealed()) return;
      if (byUser) { sound.unlock(); G.interacted = true; }
      G.focus = i;
      G.focusDimUntil = now() + (byUser ? 2600 : 0);
      captionHoldUntil = 0;
      G.dirty = true;
      syncHud();
    }

    // ---- Persistence of the current puzzle --------------------------------------------
    // Device copy on every committed move (cheap, synchronous); Continue Playing
    // progress at bounded checkpoints only.
    const DAY_KEY = 'orbit.day.v2', STUDY_KEY = 'orbit.study.v2';
    function snapshot() { return { v: 2, edition: G.mode === 'daily' ? G.day : G.level, eng: G.eng.serialize(), elapsedMs: Math.round(elapsed()) }; }
    function saveLocal() {
      if (G.mode === 'gallery' || !caps.storage || !ctx.storage) return;
      try { ctx.storage.set(G.mode === 'daily' ? DAY_KEY : STUDY_KEY, snapshot()); } catch (e) { }
    }
    let lastProgressSave = 0, progressDirty = false;
    function saveProgress(force) {
      if (G.mode !== 'daily' || !ctx.game || !ctx.game.progress) return;
      const t = performance.now();
      if (!force && t - lastProgressSave < 12000) { progressDirty = true; return; }
      lastProgressSave = t; progressDirty = false;
      const s = snapshot();
      try {
        ctx.game.progress.save('daily', {
          state: s,
          label: 'No. ' + pad3(G.day) + ' · stage ' + (G.eng.stage + 1) + ' of ' + stages(),
          percent: Math.min(0.99, (G.eng.stage + G.eng.satisfiedCount() / G.eng.revealed()) / stages()),
          stateSchemaVersion: 2
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_save', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
    function readLocal(key, edition) {
      try {
        if (!caps.storage || !ctx.storage) return null;
        const s = ctx.storage.get(key);
        if (s && s.v === 2 && s.edition === edition && s.eng) return s;
      } catch (e) { }
      return null;
    }

    // ---- Animation helpers --------------------------------------------------------------
    function now() { return performance.now(); }
    // Ease a ring to an angle; onDone runs when it is seated (at once if already there).
    function tweenRing(k, toAngle, dur, onDone) {
      const from = G.vis[k];
      G.dirty = true;
      if (Math.abs(from - toAngle) < 1e-4) { G.vis[k] = toAngle; G.tween[k] = null; if (onDone) onDone(); return; }
      G.tween[k] = { from, to: toAngle, t0: now(), dur: dur || clamp(110 + Math.abs(toAngle - from) / STEP * 55, 120, 320), ease: easeOutCubic, onDone };
    }
    function select(k) {
      if (k === G.selected) return;
      G.selected = k;
      G.selectAt = now();
      hud.showRotate(k > 0 && (G.phase === 'play' || G.phase === 'intro'));
      G.dirty = true;
    }

    // ---- Committed moves ----------------------------------------------------------------
    function commit(k, steps, viaDrag) {
      const before = statuses();
      const res = G.eng.rotate(k, steps);
      if (!res) return null;
      lastAction = now();
      if (G.hint && G.hint.ring === k) G.hint.until = Math.min(G.hint.until, now() + 400);
      tweenRing(k, res.to * STEP, 0, () => afterSeat(before, res.event));
      ctx.platform.interact({ action: viaDrag ? 'drag' : 'tap', ring: k, steps });
      onFirstMove();
      saveLocal();
      syncHud();
      return res;
    }
    function statuses() { const a = []; for (let i = 0; i < G.eng.revealed(); i++) a.push(G.eng.holds(i)); return a; }
    // After a ring seats: chime for clues that now hold, then any stage event.
    function afterSeat(before, event) {
      sound.snap();
      let gained = 0;
      before.forEach((was, i) => {
        if (!was && G.eng.holds(i)) { gained++; G.clue[i].glow = 1; sound.align(i); }
      });
      if (gained) haptic('light');
      sound.setProgress((G.eng.stage + G.eng.satisfiedCount() / G.eng.revealed()) / stages());
      saveProgress(false);
      // Keep the caption on something worth solving.
      if (G.focus >= 0 && G.eng.holds(G.focus) && now() > G.focusDimUntil) {
        const next = G.eng.hintTarget(-1);
        if (next >= 0) G.focus = next;
      }
      if (event === 'stage') startReveal();
      else if (event === 'solved' && G.phase === 'play') beginSolved();
      syncHud();
    }
    function onFirstMove() {
      if (!scores.profile.seenIntro) scores.setFlag('seenIntro', true);
    }
    let lastHaptic = 0;
    function haptic(kind) {
      if (!caps.haptics) return;
      const t = now();
      if (kind === 'light' && t - lastHaptic < 55) return;
      lastHaptic = t;
      try { ctx.platform.haptic(kind); } catch (e) { }
    }
    // The first real gesture of an attempt starts it (and the clock).
    function beginAttempt() {
      sound.unlock();
      if (G.started || (G.phase !== 'play' && G.phase !== 'intro') || G.mode === 'gallery') return;
      G.started = true;
      G.attempt = scores.newAttempt();
      try { ctx.platform.start({ mode: G.mode, edition: G.mode === 'daily' ? G.day : G.level }); } catch (e) { }
      clockStart();
    }

    // ---- Progressive reveal ---------------------------------------------------------------
    // 1. the intersections that hold light up, 2. a breath, 3. the new markers
    // grow in around the rim, one after another, 4. play carries on throughout.
    function startReveal() {
      const to = G.eng.revealed();
      const from = G.puzzle.cum[G.eng.stage - 1];
      const t = now();
      G.reveal = { t0: t, from, to, shown: false };
      for (let i = 0; i < from; i++) if (G.eng.holds(i)) G.clue[i].glow = 1;
      haptic('success');
      try { ctx.platform.milestone('stage_reached', { stage: G.eng.stage + 1, moves: G.eng.moves }); } catch (e) { }
      saveProgress(true);
      flashCaption('STAGE ' + G.eng.stage + ' COMPLETE', 'All ' + from + ' intersections hold at once…', 1000);
    }
    function revealStep(t) {
      const R = G.reveal;
      if (!R) return false;
      const u = t - R.t0;
      if (!R.shown && u >= 850) {
        R.shown = true;
        for (let i = R.from; i < R.to; i++) { G.clue[i].revealAt = t + (i - R.from) * 220; G.clue[i].isNew = true; }
        sound.stage(G.eng.stage);
        G.focus = R.from;
        const n = R.to - R.from;
        flashCaption('STAGE ' + (G.eng.stage + 1) + ' OF ' + stages(), (n === 2 ? 'Two' : String(n)) + ' new intersections. Everything revealed must hold together.', 3200);
      }
      if (R.shown) {
        for (let i = R.from; i < R.to; i++) {
          const a = clamp((t - G.clue[i].revealAt) / 650, 0, 1);
          G.clue[i].appear = a;
        }
      }
      if (u > 850 + (R.to - R.from) * 220 + 900) {
        for (let i = R.from; i < R.to; i++) { G.clue[i].appear = 1; G.clue[i].isNew = false; }
        G.reveal = null;
        // Lucky: the new clues may already hold. Then the next stage opens too.
        const ev = G.eng.advance();
        if (ev === 'stage') startReveal();
        else if (ev === 'solved') beginSolved();
        syncHud();
      }
      return true;
    }

    // ---- Pointer input: direct manipulation --------------------------------------------
    let drag = null;
    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      const sx = r.width ? ctx.width / r.width : 1, sy = r.height ? ctx.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }
    // Which ring is under a point: by radius only, with the gap split between
    // neighbours, so a touch can never land on two rings.
    function ringAt(px, py) {
      const geom = board.painter.geom;
      if (!geom) return { k: -2 };
      const dx = px - L.cx, dy = py - L.cy, r = Math.hypot(dx, dy);
      if (r < geom.hubR + geom.g * 0.5) return { k: -1, r };
      if (r > L.R * 1.08) return { k: -2, r };
      if (r >= geom.rings[geom.n - 1].rOut) return { k: geom.n - 1, r };
      for (let k = 0; k < geom.n; k++) {
        const ring = geom.rings[k];
        const hi = k < geom.n - 1 ? (ring.rOut + geom.rings[k + 1].rIn) / 2 : Infinity;
        if (r < hi) return { k, r };
      }
      return { k: geom.n - 1, r };
    }
    // A marker under the point, if any.
    function clueAt(px, py) {
      const geom = board.painter.geom;
      if (!geom || !G.eng) return -1;
      const cg = clueGeom(geom);
      let best = -1, bd = cg.mr * 1.9;
      for (let i = 0; i < G.eng.revealed(); i++) {
        const a = colAngle(G.puzzle.conds[i].pos);
        const d = Math.hypot(px - (L.cx + Math.cos(a) * cg.Rm), py - (L.cy + Math.sin(a) * cg.Rm));
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    function angleAt(px, py) { return Math.atan2(py - L.cy, px - L.cx); }
    function columnAt(px, py) { return mod(Math.round((angleAt(px, py) + Math.PI / 2) / STEP), SEGMENTS); }
    function highlightFamily(k, px, py) {
      const fam = G.eng.familyAt(k, columnAt(px, py));
      G.famFocus = { fam, a: G.famFocus && G.famFocus.fam === fam ? G.famFocus.a : 0, until: now() + 1800 };
      G.dirty = true;
    }

    ctx.listen(canvas, 'pointerdown', e => {
      if (hud.isModalOpen()) return;
      if (drag) return; // one ring at a time; extra fingers are ignored
      const p = localPoint(e);
      if (G.phase === 'done' || G.phase === 'transition' || G.phase === 'solving') { sound.unlock(); return; }
      if (e.cancelable) e.preventDefault();
      try { canvas.focus({ preventScroll: true }); } catch (err) { }
      const ci = Math.hypot(p.x - L.cx, p.y - L.cy) > L.R * 1.04 ? clueAt(p.x, p.y) : -1;
      if (ci >= 0) { if (G.phase === 'intro') finishIntro(); focusClue(ci, true); return; }
      const hit = ringAt(p.x, p.y);
      if (hit.k === -2) { select(-1); return; }
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      if (hit.k === -1) return;
      if (hit.k === 0) {
        // The centre ring is the fixed reference and the spectrum's legend.
        sound.refuse(); haptic('light');
        highlightFamily(0, p.x, p.y);
        flashCaption('CENTRE RING · FIXED', 'The spectrum, read clockwise. Steps and “next colour” are counted on it.', 3200);
        return;
      }
      const k = hit.k;
      // Grab from wherever the ring visually is, even mid-snap.
      if (G.tween[k]) { G.tween[k] = null; }
      drag = { k, id: e.pointerId, lastA: angleAt(p.x, p.y), base: G.vis[k], accum: 0, moved: false, detent: Math.round(G.vis[k] / STEP), t0: now(), px: p.x, py: p.y };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      select(k);
      G.dirty = true;
    }, { passive: false });

    ctx.listen(canvas, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.cancelable) e.preventDefault();
      const p = localPoint(e);
      const r = Math.hypot(p.x - L.cx, p.y - L.cy);
      const a = angleAt(p.x, p.y);
      // Near the axis the angle is unstable; hold the ring still there.
      if (r > board.painter.geom.hubR * 0.55) {
        drag.accum += wrapAngle(a - drag.lastA); // unwrapped: no jump across 0/360
        drag.lastA = a;
      }
      if (!drag.moved && Math.abs(drag.accum) > 0.035) drag.moved = true;
      G.vis[drag.k] = drag.base + drag.accum;
      const det = Math.round(G.vis[drag.k] / STEP);
      if (det !== drag.detent) { drag.detent = det; sound.tick(drag.k); haptic('light'); }
      G.dirty = true;
    }, { passive: false });

    function endDrag(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      const k = drag.k;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
      const current = G.eng.rot[k];
      if (cancelled || !drag.moved) {
        tweenRing(k, current * STEP);
        // A tap selects the ring (turn buttons) and outlines that colour everywhere.
        if (!cancelled && !drag.moved) { hud.showRotate(true); highlightFamily(k, drag.px, drag.py); }
      } else {
        const target = Math.round(G.vis[k] / STEP);
        const steps = target - current;
        if (steps) commit(k, steps, true);
        else tweenRing(k, current * STEP, 0, () => sound.snap());
      }
      drag = null;
      G.dirty = true;
    }
    ctx.listen(canvas, 'pointerup', e => endDrag(e, false));
    ctx.listen(canvas, 'pointercancel', e => endDrag(e, true));
    ctx.listen(canvas, 'lostpointercapture', e => { if (drag && e.pointerId === drag.id) endDrag(e, false); });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

    // Keyboard: arrows turn the selected ring, up/down choose a ring, Z undoes,
    // Tab-free clue cycling with C, H for a hint.
    ctx.listen(canvas, 'keydown', e => {
      if ((G.phase !== 'play' && G.phase !== 'intro') || hud.isModalOpen()) return;
      const n = G.puzzle.ringCount;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        beginAttempt();
        let k = G.selected < 1 ? (e.key === 'ArrowUp' ? 1 : n - 1) : G.selected + (e.key === 'ArrowUp' ? 1 : -1);
        k = clamp(k, 1, n - 1); select(k);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        beginAttempt();
        if (G.selected < 1) select(n - 1);
        tapRotate(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); doUndo(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); focusClue(mod(G.focus + 1, G.eng.revealed()), true); }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); doHint(); }
    });

    function tapRotate(dir) {
      if ((G.phase !== 'play' && G.phase !== 'intro') || G.selected < 1) return;
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      haptic('light');
      commit(G.selected, dir, false);
      hud.showRotate(true);
    }

    // ---- Controls ----------------------------------------------------------------------
    function doUndo() {
      if (G.phase !== 'play') return;
      const before = statuses();
      const h = G.eng.undo();
      if (!h) { sound.refuse(); return; }
      sound.undo(); haptic('light');
      tweenRing(h.ring, h.from * STEP, 0, () => afterSeat(before, h.event));
      ctx.platform.interact({ action: 'undo' });
      saveLocal();
      syncHud();
    }
    let resetSeq = 0;
    function doReset() {
      if (G.phase !== 'play') return;
      if (!hud.resetArmed()) {
        hud.armReset(true);
        const s = ++resetSeq;
        ctx.timeout(() => { if (s === resetSeq) hud.armReset(false); }, 2600);
        return;
      }
      resetSeq++;
      hud.armReset(false);
      G.eng.reset();
      for (let k = 1; k < G.puzzle.ringCount; k++) tweenRing(k, G.eng.rot[k] * STEP, 420);
      G.hint = null;
      sound.undo();
      ctx.platform.interact({ action: 'restart' });
      flashCaption('RESTARTED', 'The rings are back where they began. What you have revealed stays revealed.', 2600);
      saveLocal();
      syncHud();
    }
    // Hints escalate on the focused clue: which rings, then the relationship read
    // against the board, then a direction worth trying. Never a move for you.
    function doHint() {
      if (G.phase !== 'play') return;
      beginAttempt();
      const h = G.eng.hint(G.focus);
      if (!h) return;
      G.focus = h.cond;
      const c = G.puzzle.conds[h.cond];
      const label = 'HINT ' + h.level + ' · ' + HOURS[c.pos];
      if (h.level === 1) {
        G.focusDimUntil = now() + 4200;
        const names = c.rings.map(k => RING_NAMES[k]);
        flashCaption(label, 'This rule reads the ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.', 4200);
      } else if (h.level === 2) {
        G.focusDimUntil = now() + 2400;
        flashCaption(label, h.text, 5200);
      } else if (h.dir) {
        G.hint = { ring: h.dir.ring, dir: h.dir.dir, alpha: 0, until: now() + 4200, a: colAngle(c.pos) };
        select(h.dir.ring);
        flashCaption(label, 'Worth exploring: the ' + RING_NAMES[h.dir.ring] + ', ' + (h.dir.dir > 0 ? 'clockwise' : 'anticlockwise') + '.', 4200);
      } else {
        flashCaption(label, h.text || condText(c), 4200);
      }
      ctx.platform.interact({ action: 'hint', level: h.level });
      G.dirty = true;
      saveLocal();
      syncHud();
    }
    function toggleMute() {
      const m = !scores.profile.muted;
      scores.setFlag('muted', m);
      sound.setMuted(m);
      if (!m) sound.unlock();
      hud.setMuted(m);
    }

    // ---- Completion ----------------------------------------------------------------------
    // Stars: one for solving, one for an efficient route, one for no hints within
    // a relaxed time. Efficiency is judged against the progressive route, since
    // nobody can aim at clues they have not seen yet.
    function starsFor(moves, timeMs, hints) {
      const route = G.puzzle.route;
      const efficient = moves <= Math.ceil(route * 1.25) + 2;
      const clean = hints === 0 && timeMs <= Math.max(300000, route * 15000);
      return 1 + (efficient ? 1 : 0) + (clean ? 1 : 0);
    }
    function beginSolved() {
      G.phase = 'solving';
      clockPause();
      select(-1);
      hud.showRotate(false);
      G.hint = null; G.focus = -1; G.reveal = null;
      G.completeAt = now() + 120;
      G.completeT = 0;
      sound.complete(G.puzzle.ringCount);
      haptic('success');
      const timeMs = Math.round(elapsed());
      const moves = G.eng.moves, hints = G.eng.hints;
      const stars = starsFor(moves, timeMs, hints);
      let info;
      if (G.mode === 'daily') {
        const isToday = G.day === dayNumberFromKey(dateKey(new Date()));
        info = scores.completeDaily(G.day, moves, timeMs, hints, G.theme.key, stars);
        G.result = { timeMs, moves, par: G.puzzle.route, hints, stars, streak: scores.currentStreak(G.day), info, board: '' };
        // Only a live solve of today's edition goes on the leaderboard.
        if (isToday && info.first && !G.restoredSolved) {
          G.result.board = 'Saving to today’s board…';
          scores.submitDaily(timeMs, moves, G.day, info.streak, r => onBoardResult(r));
        }
        try { ctx.game.progress && ctx.game.progress.complete('daily', { state: snapshot() }).catch(() => { }); } catch (e) { }
        try { ctx.platform.complete({ mode: 'daily', edition: G.day, timeMs, moves, hints, stars }); } catch (e) { }
      } else {
        info = scores.completeLevel(G.level, moves, timeMs, G.theme.key, stars);
        G.result = { timeMs, moves, par: G.puzzle.route, hints, stars, info, board: '' };
        try { ctx.platform.complete({ mode: 'practice', level: G.level, timeMs, moves, hints, stars }); } catch (e) { }
      }
      saveLocal();
      syncHud();
      ctx.timeout(() => showResult(true), 2200);
    }
    function onBoardResult(r) {
      if (!G.result) return;
      if (r.error) G.result.board = r.error === 'unavailable' ? '' : 'Leaderboard unavailable right now';
      else if (r.board) {
        const rows = (r.board.rows || []).slice(0, 3).map(row => {
          const nm = row.displayName || row.username || row.name || 'player';
          return (row.rank || '') + '. ' + nm + ' ' + (row.displayLabel || fmtTime(row.value));
        });
        const me = r.board.viewerRank;
        G.result.board = (rows.length ? 'TODAY  ' + rows.join('  ·  ') : 'TODAY') + (me && me.rank ? '\nYOU ARE #' + me.rank + (r.board.totalRanked ? ' OF ' + r.board.totalRanked : '') : '');
      } else if (r.submitted) G.result.board = 'Saved to today’s board';
      if (G.phase === 'done') hud.setBoardLine(G.result.board);
    }
    function showResult(fresh) {
      if (disposed || !G.result) return;
      if (G.phase === 'solving') G.phase = 'done';
      if (G.phase !== 'done') return;
      const R = G.result, t = G.theme;
      const stats = [['Time', fmtTime(R.timeMs)], ['Moves', String(R.moves)], ['Par', String(R.par)]];
      if (G.mode === 'daily') stats.push(['Streak', String(scores.currentStreak(today))]);
      else stats.push(['Hints', String(R.hints)]);
      const isNew = R.info && R.info.newTheme;
      hud.showPlay(false);
      hud.setHeader(G.mode, editionLabel(), true);
      hud.showDone({
        kicker: (isNew ? 'New universe · ' : '') + 'All seven intersections hold',
        name: t.name,
        stars: R.stars || 0,
        desc: t.description,
        stats,
        board: R.board,
        nextLabel: G.mode === 'daily' ? 'Practice' : 'Next puzzle',
        canShare: true
      });
      if (fresh) {
        ctx.timeout(() => {
          if (disposed || G.phase !== 'done') return;
          try {
            ctx.pulse && ctx.pulse.complete({
              timeMs: R.timeMs, timeLabel: fmtTime(R.timeMs), score: R.moves,
              level: G.mode === 'daily' ? G.day : G.level, mode: G.mode,
              result: 'solved', text: shareText()
            });
          } catch (e) { }
        }, 1100);
        if (G.mode === 'daily') scores.readBest(v => { if (v !== null && G.phase === 'done' && G.result) { G.result.bestRecord = v; } });
      }
    }
    function shareText() {
      const R = G.result, t = G.theme;
      const head = (G.mode === 'daily' ? 'ORBIT  No. ' + pad3(G.day) : 'ORBIT  Practice ' + pad3(G.level)) + '  ' + '★'.repeat(R.stars || 1) + '☆'.repeat(3 - (R.stars || 1));
      const dots = G.puzzle.stages.map(n => '◉'.repeat(n)).join(' ');
      const lines = [head, '“' + t.name + '”', dots, fmtTime(R.timeMs) + '  ·  ' + R.moves + ' moves (par ' + R.par + ')' + (R.hints ? '  ·  ' + R.hints + (R.hints === 1 ? ' hint' : ' hints') : '')];
      if (G.mode === 'daily' && scores.currentStreak(today) > 1) lines.push('streak ' + scores.currentStreak(today));
      return lines.join('\n');
    }
    function doShare() {
      if (G.phase !== 'done' || !G.result) return;
      try {
        ctx.share({ sceneId: G.mode + '-' + (G.mode === 'daily' ? G.day : G.level), title: 'ORBIT — ' + G.theme.name, text: shareText(), implicitText: 'Solved ORBIT in ' + fmtTime(G.result.timeMs) });
      } catch (e) { hud.toast('Sharing is not available here'); }
    }
    function doNext() {
      if (G.phase !== 'done') return;
      if (G.mode === 'gallery') {
        const back = G.prev || { mode: 'daily', n: today };
        G.prev = null; G.galleryItem = null;
        goTo(back.mode, back.n);
        return;
      }
      const lvl = scores.profile.levels.reached;
      goTo('study', G.mode === 'study' ? G.level + 1 : lvl);
    }

    // ---- Mode switching and theme reveal --------------------------------------------------
    function switchMode(m) {
      if (G.phase === 'transition' || hud.isModalOpen()) return;
      if (m === G.mode) return;
      sound.unlock();
      if (m === 'daily') goTo('daily', today);
      else goTo('study', scores.profile.levels.reached);
    }
    // Leave the current scene and open the next one from the axis outward.
    function goTo(mode, n) {
      if (G.phase === 'play' && G.started) { saveLocal(); saveProgress(true); }
      clockPause();
      const from = { theme: G.theme, scene: buildScene(), mode: G.mode };
      hud.showDone(null);
      hud.showRotate(false);
      const saved = mode === 'daily' ? readLocal(DAY_KEY, n) : readLocal(STUDY_KEY, n);
      loadPuzzle(mode, n, saved);
      const done = mode === 'daily' ? scores.dailyResult(n) : null;
      G.restoredSolved = G.eng.solved;
      const target = G.vis.slice();
      // The rings spin in to their scramble (never through the solution).
      if (!done && !G.eng.solved) for (let k = 1; k < G.vis.length; k++) G.vis[k] = target[k] + (k % 2 ? -1 : 1) * Math.PI * 0.75;
      G.transition = { from, t0: now(), dur: 950, then: () => {
        if (done || G.eng.solved) { enterSolvedView(done); return; }
        for (let k = 1; k < G.vis.length; k++) G.tween[k] = { from: G.vis[k], to: target[k], t0: now() + k * 70, dur: 760, ease: easeOutQuint };
        G.phase = 'intro';
        G.introEnd = now() + 760 + G.vis.length * 70;
      } };
      G.phase = 'transition';
      hud.showPlay(true);
      sound.reveal();
      syncHud();
    }
    function finishIntro() {
      for (let k = 1; k < G.vis.length; k++) { if (G.tween[k] && G.tween[k].ease === easeOutQuint) { G.vis[k] = G.tween[k].to; G.tween[k] = null; } }
      G.phase = 'play';
      syncHud();
    }
    // Re-opening an edition already solved shows the finished composition.
    function enterSolvedView(done) {
      if (!G.eng.solved) G.eng.forceSolved();
      for (let k = 0; k < G.vis.length; k++) { G.vis[k] = G.eng.rot[k] * STEP; G.tween[k] = null; }
      G.clue.forEach(c => { c.appear = 1; c.glow = 0; c.isNew = false; });
      hud.showRotate(false);
      select(-1);
      clockPause();
      G.phase = 'done';
      G.focus = -1;
      G.completeT = 1; G.completeGlow = 1; G.orbitA = TAU;
      const d = done || [G.eng.moves, elapsed(), G.eng.hints, 0];
      G.result = { timeMs: d[1], moves: d[0], par: G.puzzle.route, hints: d[2] || 0, stars: d[3] || 0, info: { newTheme: false }, board: '' };
      showResult(false);
    }

    // ---- Collection and gallery ---------------------------------------------------------------
    // Each collected universe keeps the composition its puzzle resolved into.
    function solvedFamilies(puz) {
      const o = stateOffsets(puz.solutions[0]);
      return (k, i) => puz.seqs[k][mod(i - (k ? o[k] : 0), SEGMENTS)];
    }
    function collectionItems() {
      const items = [];
      scores.profile.coll.slice().reverse().forEach(key => {
        const m = /^(daily|level):(\d+)$/.exec(key);
        if (!m) return;
        const n = +m[2];
        const daily = m[1] === 'daily';
        let cached = null, fams = null;
        const d = daily ? scores.profile.daily[n] : scores.profile.levels.best[n];
        items.push({
          key, n, daily,
          title: '', sub: daily ? 'No. ' + pad3(n) + ' · ' + prettyDate(keyFromDayNumber(n)) : 'Practice ' + pad3(n),
          ringCount: RINGS,
          stat: d ? 'Solved in ' + fmtTime(d[1]) + ', ' + d[0] + ' moves.' : '',
          d,
          theme() { return cached || (cached = ThemeEngine.forKey(key)); },
          families() { return fams || (fams = solvedFamilies(puzzleFor(daily ? 'daily' : 'study', n))); }
        });
      });
      items.forEach(it => { it.title = it.theme().name; });
      return items;
    }
    function openCollection() {
      if (G.phase === 'transition') return;
      sound.unlock();
      ctx.surface.place(hud.modal, { layer: 'modal', input: 'auto' });
      const items = collectionItems();
      const nextLevel = scores.profile.levels.reached;
      hud.openCollection(items, { title: 'Undiscovered', sub: 'Practice ' + pad3(nextLevel) });
      if (G.phase === 'play' && G.started) clockPause();
    }
    function closeModal() {
      hud.closeModal();
      ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });
      if (G.phase === 'play' && G.started) clockStart();
    }
    function openGallery(it) {
      closeModal();
      if (G.phase === 'play' && G.started) { saveLocal(); saveProgress(true); clockPause(); }
      const from = { theme: G.theme, scene: buildScene(), mode: G.mode };
      G.prev = G.prev || { mode: G.mode, n: G.mode === 'daily' ? G.day : G.level };
      G.galleryItem = it;
      const theme = it.theme();
      G.puzzle = puzzleFor(it.daily ? 'daily' : 'study', it.n);
      G.eng = createGame(G.puzzle);
      G.eng.forceSolved();
      G.theme = theme;
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP); G.tween = new Array(nr).fill(null);
      G.clue = G.puzzle.conds.map(() => ({ appear: 1, glow: 0, revealAt: 0, status: '', isNew: false }));
      G.mode = 'gallery'; G.focus = -1; G.hint = null; G.famFocus = null;
      G.completeT = 0; G.completeGlow = 1; G.orbitA = TAU;
      hud.applyTheme(theme);
      hud.showDone(null); hud.showPlay(false);
      G.transition = { from, t0: now(), dur: 950, then: () => {
        G.phase = 'done';
        G.completeAt = now(); G.completeT = 0.0001;
        G.result = { timeMs: 0, moves: 0, par: 0, info: {}, board: '' };
        hud.setHeader('gallery', editionLabel(), false);
        hud.showDone({ kicker: 'From your collection', name: theme.name, desc: theme.description, stars: it.d && it.d[3] || 0, stats: it.d ? [['Time', fmtTime(it.d[1])], ['Moves', String(it.d[0])]] : [], board: theme.universeTitle.toUpperCase() + ' · ' + theme.material.label.toUpperCase(), nextLabel: 'Back', canShare: false });
      } };
      G.phase = 'transition';
      sound.reveal();
    }

    // ---- Scene + loop ------------------------------------------------------------------------
    function buildScene() {
      const seqs = G.puzzle.seqs;
      const E = G.eng;
      const doneView = G.phase === 'done' || G.phase === 'solving' || G.mode === 'gallery';
      return {
        ringCount: G.puzzle.ringCount,
        angles: G.vis.slice(),
        families: (k, i) => seqs[k][i],
        selected: G.selected, selectT: G.selectT, dimOthers: G.selectT * (G.phase === 'play' ? 1 : 0),
        completeT: G.completeT, completeGlow: G.completeGlow,
        orbitA: G.orbitA,
        famFocus: G.famFocus && G.famFocus.a > 0.01 ? G.famFocus : null,
        focus: G.focus, focusT: G.focusT,
        clues: G.puzzle.conds.map((c, i) => {
          if (i >= E.revealed() && !doneView) return null;
          const v = G.clue[i] || { appear: 1 };
          const status = doneView ? 'solved' : E.status(i);
          return { pos: c.pos, type: c.type, rings: c.rings, odd: c.odd, fam: c.fam, appear: v.appear, glow: v.glow, revealAt: v.revealAt, status, progress: status === 'solved' ? 1 : E.progress(i) };
        }),
        hint: G.hint && G.hint.alpha > 0.01 ? { ring: G.hint.ring, dir: G.hint.dir, alpha: G.hint.alpha, a: G.hint.a } : null
      };
    }

    let hudTick = 0;
    function update(dt) {
      if (disposed) return;
      const t = now();
      let animating = false;

      // Ring tweens (snap and intro). Ease-out only: no overshoot, no bounce.
      for (let k = 0; k < G.tween.length; k++) {
        const tw = G.tween[k];
        if (!tw) continue;
        animating = true;
        const u = clamp((t - tw.t0) / tw.dur, 0, 1);
        G.vis[k] = lerp(tw.from, tw.to, tw.ease(u));
        if (u >= 1) { G.vis[k] = tw.to; G.tween[k] = null; if (tw.onDone) tw.onDone(); }
      }
      if (G.phase === 'intro' && t >= G.introEnd && !G.tween.some(Boolean)) { G.phase = 'play'; syncHud(); }

      // Selection fade and auto-deselect after a quiet spell.
      const selTarget = G.selected > 0 && (G.phase === 'play') ? 1 : 0;
      if (Math.abs(G.selectT - selTarget) > 0.001) { G.selectT = lerp(G.selectT, selTarget, 1 - Math.exp(-dt / 70)); animating = true; }
      if (G.selected > 0 && !drag && G.phase === 'play' && t - Math.max(G.selectAt, lastAction) > 6000) { select(-1); }

      // Column focus: the board recedes briefly around the chosen intersection.
      const fTarget = G.focus >= 0 && t < G.focusDimUntil && G.phase === 'play' ? 1 : 0;
      if (Math.abs(G.focusT - fTarget) > 0.002) { G.focusT = lerp(G.focusT, fTarget, 1 - Math.exp(-dt / 140)); animating = true; }

      // Family highlight.
      if (G.famFocus) {
        const target = t < G.famFocus.until ? 1 : 0;
        G.famFocus.a = lerp(G.famFocus.a, target, 1 - Math.exp(-dt / 110));
        if (!target && G.famFocus.a < 0.01) G.famFocus = null;
        animating = true;
      }

      // Clue glows decay; new clues breathe.
      for (let i = 0; i < G.clue.length; i++) {
        const c = G.clue[i];
        if (c.glow > 0) { c.glow = Math.max(0, c.glow - dt / 1100); animating = true; }
      }
      if (G.eng && G.phase === 'play') for (let i = 0; i < G.eng.revealed(); i++) if (G.eng.status(i) === 'revealed') { animating = true; break; }
      if (revealStep(t)) animating = true;

      const ot = (G.phase === 'done' || G.phase === 'solving') ? TAU : orbitTarget();
      if (Math.abs(G.orbitA - ot) > 0.0005) { G.orbitA = lerp(G.orbitA, ot, 1 - Math.exp(-dt / 260)); animating = true; }

      // Completion light; the markers kindle one after another round the rim.
      if ((G.phase === 'solving' || G.phase === 'done') && G.completeT > 0 && G.completeT < 1 || G.phase === 'solving') {
        G.completeT = clamp((t - G.completeAt) / 2400, 0, 1);
        G.completeGlow = Math.min(1, G.completeGlow + dt / 900);
        if (G.phase === 'solving') {
          const order = G.puzzle.conds.map((c, i) => i).sort((a, b) => G.puzzle.conds[a].pos - G.puzzle.conds[b].pos);
          order.forEach((i, j) => { const u = G.completeT * 1.4 - j * 0.12; if (u > 0 && u < 0.08) G.clue[i].glow = 1; });
        }
        animating = true;
      }

      // Hint chevrons.
      if (G.hint) {
        const target = t < G.hint.until ? 1 : 0;
        G.hint.alpha = lerp(G.hint.alpha, target, 1 - Math.exp(-dt / 140));
        if (!target && G.hint.alpha < 0.01) G.hint = null;
        animating = true;
      }

      // Theme transition.
      if (G.transition) {
        animating = true;
        const u = clamp((t - G.transition.t0) / G.transition.dur, 0, 1);
        if (u >= 1) { const th = G.transition.then; G.transition = null; if (th) th(); syncHud(); }
      }

      // HUD clock, a few times a second.
      hudTick += dt;
      if (hudTick > 250) {
        hudTick = 0;
        if (G.phase === 'play') hud.setTime(elapsed());
        if (progressDirty && G.phase === 'play') saveProgress(false);
      }

      if (animating || G.dirty || drag) render(t);
    }
    let lastAction = 0;
    function render(t) {
      G.dirty = false;
      if (G.transition) {
        const u = clamp((t - G.transition.t0) / G.transition.dur, 0, 1);
        board.drawTransition(G.transition.from.theme, G.transition.from.scene, G.theme, buildScene(), u, t);
      } else {
        board.drawScene(G.theme, buildScene(), t);
      }
    }

    // ---- Lifecycle wiring -------------------------------------------------------------------------
    ctx.listen(canvas, 'pointerdown', () => { lastAction = now(); }, { passive: true });
    ctx.listen(hud.root, 'pointerdown', () => { lastAction = now(); }, { passive: true });

    // Start: restore today's daily from this device first (instant), then Continue Playing.
    const savedDay = readLocal(DAY_KEY, today);
    loadPuzzle('daily', today, savedDay);
    G.restoredSolved = G.eng.solved;
    relayout();
    ctx.onResize(() => { relayout(); }, { immediate: false });
    render(now());
    if (scores.dailyResult(today) || G.eng.solved) enterSolvedView(scores.dailyResult(today));
    try { ctx.markVisualReady && ctx.markVisualReady('board'); } catch (e) { }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__ORBIT_DEV) {
      // Dev harness only: `step()` makes the next nearest-first move through the real
      // commit path (used by layout screenshots; e2e tests drive real pointer input).
      const step = () => {
        const E = G.eng, D = G.puzzle.dist[E.stage], here = D[E.state()];
        for (let k = 1; k <= 4; k++) for (const d of [1, -1]) { const o = E.rot.slice(); o[k] += d; if (D[stateIndex(o)] < here) { commit(k, d, false); return true; } }
        return false;
      };
      window.__orbit = { G, layout: () => L, board, scores, goTo, ThemeEngine, renderThumbnail, ThemeRegistry, stateIndex, stateOffsets, NSTATES, step, scene: buildScene };
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => update(dtMs) });
    else ctx.onFrame(dt => update(dt));

    // Cloud profile hydrate (collection, streak) and resumable progress.
    scores.hydrate().then(() => {
      if (disposed) return;
      if (G.mode === 'daily' && G.phase === 'play' && !G.interacted && scores.dailyResult(today)) enterSolvedView(scores.dailyResult(today));
      syncHud();
    });
    if (ctx.game && ctx.game.progress && !savedDay) {
      try {
        ctx.game.progress.load('daily').then(p => {
          if (disposed || G.interacted || G.mode !== 'daily' || G.phase !== 'play') return;
          const s = p && p.state;
          const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 2));
          if (!eligible || !s || s.v !== 2 || s.edition !== today) return;
          loadPuzzle('daily', today, s);
          G.dirty = true;
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_load', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
  }
};
