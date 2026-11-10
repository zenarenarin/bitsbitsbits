// ORBIT: wiring. Owns layout, input, animation and the game flow
// (play -> solving -> done -> next), and talks to the Plethora SDK.

window.plethoraBit = {
  meta: {
    title: 'ORBIT',
    runtime: 'plethora-bit@2',
    tags: ['puzzle', 'daily', 'colour'],
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

    // ---- Game state (single source of truth lives in `eng`) -------------------------
    const G = {
      mode: 'daily',        // daily | study | gallery
      phase: 'play',        // intro | play | solving | done | transition | gallery
      level: 1, day: today,
      puzzle: null, eng: null, theme: null,
      vis: [], tween: [],   // visual angle per ring, active snap tweens
      selected: -1, selectT: 0, selectAt: 0,
      alignedVis: [], flash: [], wasAligned: [],
      completeT: 0, completeGlow: 0, completeAt: 0,
      orbitA: 0,
      hint: null,
      started: false, attempt: 0, interacted: false,
      clock: null, elapsedFallback: 0,
      restoredSolved: false,
      transition: null,
      prev: null,           // previous mode state when visiting the gallery
      nudge: null,
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
      onShare: () => doShare(),
      onNext: () => doNext()
    });
    hud.setMuted(!!scores.profile.muted);
    ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });

    // ---- Layout ----------------------------------------------------------------------------
    let L = null;
    function computeLayout() {
      const W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
      const a0 = ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 120, left: 0 };
      const area = { top: a0.top || 0, right: a0.right || 0, bottom: a0.bottom || 0, left: a0.left || 0 };
      const top = area.top, bot = H - area.bottom;
      const wide = W > H * 1.15 && W >= 620;
      const lay = { W, H, area, wide };
      if (!wide) {
        const compact = (bot - top) < 640;
        const headerH = compact ? 92 : 122;
        const bottomH = compact ? 176 : 252;
        const availTop = top + headerH, availBot = bot - bottomH;
        let R = Math.min((W - 28) / 2 / 1.15, (availBot - availTop) / 2 / 1.15, 260);
        R = Math.max(60, R);
        lay.compact = compact;
        lay.R = R; lay.cx = W / 2;
        lay.cy = (availTop + availBot) / 2;
        lay.headerTop = top + (compact ? 4 : 10);
        lay.colX = 0; lay.colW = W;
        lay.bottomTop = Math.min(lay.cy + R * 1.17 + 4, availBot + 8);
        lay.doneTop = lay.bottomTop - 2;
      } else {
        const R = Math.max(60, Math.min((bot - top - 24) / 2 / 1.15, (W * 0.56 - 32) / 2 / 1.15, 300));
        lay.compact = (bot - top) < 560;
        lay.R = R; lay.cx = area.left + W * 0.29; lay.cy = (top + bot) / 2;
        lay.colX = W * 0.56; lay.colW = W * 0.44 - area.right;
        const colH = 122 + 236;
        lay.headerTop = Math.max(top + 10, (top + bot) / 2 - colH / 2);
        lay.bottomTop = lay.headerTop + 128;
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
    function diffForLevel(l) {
      if (l <= 2) return 'easy';
      if (l <= 6) return 'medium';
      return l % 3 === 0 ? 'hard' : 'medium';
    }
    function loadPuzzle(mode, n, saved) {
      G.mode = mode;
      if (mode === 'daily') { G.day = n; G.puzzle = PuzzleGenerator.generate(keyFromDayNumber(n), 'medium'); G.theme = ThemeEngine.forDaily(n); }
      else { G.level = n; G.puzzle = PuzzleGenerator.generate('level:' + n, diffForLevel(n)); G.theme = ThemeEngine.forLevel(n); }
      G.eng = createEngine(G.puzzle, saved && saved.eng);
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP);
      G.tween = new Array(nr).fill(null);
      G.flash = new Array(nr).fill(0);
      G.wasAligned = []; G.alignedVis = [];
      for (let k = 0; k < nr; k++) { const a = G.eng.isAligned(k); G.wasAligned.push(a); G.alignedVis.push(k > 0 && a ? 1 : 0); }
      G.selected = -1; G.selectT = 0; G.hint = null;
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
      G.phase = 'play';
      G.dirty = true;
      syncHud();
    }
    function elapsed() { return G.clock ? G.clock.elapsedMs : G.elapsedFallback; }
    function clockStart() { if (G.clock) G.clock.start(); G.running = true; }
    function clockPause() { if (G.clock) G.clock.pause(); G.running = false; }

    function movable() { return G.puzzle.ringCount - 1; }
    function orbitTarget() { return G.eng ? (G.eng.alignedCount() / movable()) * TAU : 0; }

    function editionLabel() {
      if (G.mode === 'daily') return 'DAILY PUZZLE · NO. ' + pad3(G.day) + ' · ' + prettyDate(keyFromDayNumber(G.day));
      if (G.mode === 'study') return 'STUDY NO. ' + pad3(G.level) + ' · ' + DIFFICULTY[G.puzzle.difficulty].label.toUpperCase() + ' · ' + movable() + ' RINGS';
      return 'COLLECTION · ' + (G.galleryItem ? G.galleryItem.sub : '');
    }
    let captionHoldUntil = 0;
    function flashCaption(text) {
      captionHoldUntil = now() + 2600;
      hud.setCaption(text, false);
      ctx.timeout(() => { if (now() >= captionHoldUntil - 5) syncHud(); }, 2650);
    }
    function syncHud() {
      const playing = G.phase === 'play';
      hud.setHeader(G.mode, editionLabel(), G.phase === 'done' && G.mode !== 'gallery');
      hud.setStats(G.eng.moves, elapsed(), G.eng.alignedCount(), movable());
      hud.setControls(G.eng.history.length > 0, playing);
      if (playing && now() >= captionHoldUntil) {
        const a = G.eng.alignedCount(), m = movable();
        if (!scores.profile.seenIntro && !G.interacted) hud.setCaption('Turn each ring until its colours meet the centre ring', false);
        else if (a === 0) hud.setCaption('Untitled No. ' + pad3(G.mode === 'daily' ? G.day : G.level) + ' — match each ring to the centre', false);
        else hud.setCaption(a + ' of ' + m + ' rings aligned', false);
      }
    }

    // ---- Persistence of the current puzzle --------------------------------------------
    // Device copy on every committed move (cheap, synchronous); Continue Playing
    // progress at bounded checkpoints only.
    const DAY_KEY = 'orbit.day.v1', STUDY_KEY = 'orbit.study.v1';
    function snapshot() { return { v: 1, edition: G.mode === 'daily' ? G.day : G.level, eng: G.eng.serialize(), elapsedMs: Math.round(elapsed()) }; }
    function saveLocal() {
      if (G.mode === 'gallery' || !caps.storage || !ctx.storage) return;
      try { ctx.storage.set(G.mode === 'daily' ? DAY_KEY : STUDY_KEY, snapshot()); } catch (e) { }
    }
    let lastProgressSave = 0, progressDirty = false, progressBlocked = false;
    function saveProgress(force) {
      if (G.mode !== 'daily' || progressBlocked || !ctx.game || !ctx.game.progress) return;
      const now = performance.now();
      if (!force && now - lastProgressSave < 12000) { progressDirty = true; return; }
      lastProgressSave = now; progressDirty = false;
      const s = snapshot();
      try {
        ctx.game.progress.save('daily', {
          state: s,
          label: 'No. ' + pad3(G.day) + ' · ' + G.eng.alignedCount() + ' of ' + movable() + ' aligned',
          percent: G.eng.alignedCount() / movable(),
          stateSchemaVersion: 1
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_save', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
    function readLocal(key, edition) {
      try {
        if (!caps.storage || !ctx.storage) return null;
        const s = ctx.storage.get(key);
        if (s && s.v === 1 && s.edition === edition && s.eng) return s;
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
      hud.showRotate(k > 0 && G.phase === 'play');
      G.dirty = true;
    }

    // ---- Committed moves ----------------------------------------------------------------
    function commit(k, steps, viaDrag) {
      const res = G.eng.rotate(k, steps);
      if (!res) return null;
      lastAction = now();
      if (G.hint && G.hint.ring === k) G.hint.until = Math.min(G.hint.until, now() + 400);
      tweenRing(k, res.to * STEP, 0, () => afterSeat(k, res));
      ctx.platform.interact({ action: viaDrag ? 'drag' : 'tap', ring: k, steps });
      onFirstMove();
      saveLocal();
      syncHud();
      return res;
    }
    function afterSeat(k, res) {
      sound.snap();
      const nowAligned = G.eng.isAligned(k);
      if (nowAligned && !G.wasAligned[k]) {
        G.flash[k] = 0.0001;
        sound.align(k);
        haptic('success');
        ctx.platform.milestone('ring_aligned', { ring: k, aligned: G.eng.alignedCount() });
        saveProgress(true);
      } else {
        saveProgress(false);
      }
      G.wasAligned[k] = nowAligned;
      sound.setProgress(G.eng.alignedCount() / movable());
      if (G.eng.solved && G.phase === 'play') beginSolved();
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
      if (G.started || G.phase !== 'play' || G.mode === 'gallery') return;
      G.started = true;
      G.attempt = scores.newAttempt();
      try { ctx.platform.start({ mode: G.mode, edition: G.mode === 'daily' ? G.day : G.level }); } catch (e) { }
      clockStart();
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
      if (r > L.R * 1.2) return { k: -2, r };
      if (r >= geom.rings[geom.n - 1].rOut) return { k: geom.n - 1, r };
      for (let k = 0; k < geom.n; k++) {
        const ring = geom.rings[k];
        const hi = k < geom.n - 1 ? (ring.rOut + geom.rings[k + 1].rIn) / 2 : Infinity;
        if (r < hi) return { k, r };
      }
      return { k: geom.n - 1, r };
    }
    function angleAt(px, py) { return Math.atan2(py - L.cy, px - L.cx); }

    ctx.listen(canvas, 'pointerdown', e => {
      if (hud.isModalOpen()) return;
      if (drag) return; // one ring at a time; extra fingers are ignored
      const p = localPoint(e);
      if (G.phase === 'done' || G.phase === 'gallery' || G.phase === 'transition' || G.phase === 'solving') { sound.unlock(); return; }
      if (e.cancelable) e.preventDefault();
      try { canvas.focus({ preventScroll: true }); } catch (err) { }
      const hit = ringAt(p.x, p.y);
      if (hit.k === -2) { select(-1); return; }
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      if (G.nudge) { G.nudge = null; }
      if (hit.k === -1) return;
      if (hit.k === 0) {
        // The centre ring is the fixed reference.
        sound.refuse(); haptic('light');
        flashCaption('The centre ring is fixed — match the others to it');
        return;
      }
      const k = hit.k;
      // Grab from wherever the ring visually is, even mid-snap.
      if (G.tween[k]) { G.tween[k] = null; }
      drag = { k, id: e.pointerId, lastA: angleAt(p.x, p.y), base: G.vis[k], accum: 0, moved: false, detent: Math.round(G.vis[k] / STEP), t0: now() };
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
      if (!drag.moved && (Math.abs(drag.accum) > 0.035 || Math.hypot(p.x - L.cx, p.y - L.cy) === 0)) drag.moved = true;
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
        if (!cancelled && !drag.moved) {
          // A tap selects the ring and reveals the step controls.
          hud.showRotate(true);
        }
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

    // Keyboard: arrows turn the selected ring, up/down choose a ring, Z undoes.
    ctx.listen(canvas, 'keydown', e => {
      if (G.phase !== 'play' || hud.isModalOpen()) return;
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
    });

    function tapRotate(dir) {
      if (G.phase !== 'play' || G.selected < 1) return;
      beginAttempt();
      G.interacted = true;
      haptic('light');
      commit(G.selected, dir, false);
      hud.showRotate(true);
    }

    // ---- Controls ----------------------------------------------------------------------
    function doUndo() {
      if (G.phase !== 'play') return;
      const h = G.eng.undo();
      if (!h) { sound.refuse(); return; }
      sound.undo(); haptic('light');
      tweenRing(h.ring, h.from * STEP, 0, () => { G.wasAligned[h.ring] = G.eng.isAligned(h.ring); });
      ctx.platform.interact({ action: 'undo' });
      saveLocal();
      syncHud();
    }
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
      for (let k = 1; k < G.puzzle.ringCount; k++) { tweenRing(k, G.eng.rot[k] * STEP, 420); G.wasAligned[k] = G.eng.isAligned(k); }
      G.hint = null;
      sound.undo();
      ctx.platform.interact({ action: 'restart' });
      saveLocal();
      syncHud();
    }
    let resetSeq = 0;
    function doHint() {
      if (G.phase !== 'play') return;
      beginAttempt();
      const h = G.eng.hint();
      if (!h) return;
      G.hint = { ring: h.ring, dir: h.dir, alpha: 0, until: now() + 3800 };
      select(h.ring);
      flashCaption(h.dir > 0 ? 'Try turning the highlighted ring clockwise' : 'Try turning the highlighted ring anticlockwise');
      ctx.platform.interact({ action: 'hint' });
      saveLocal();
    }
    function toggleMute() {
      const m = !scores.profile.muted;
      scores.setFlag('muted', m);
      sound.setMuted(m);
      if (!m) sound.unlock();
      hud.setMuted(m);
    }

    // ---- Completion ----------------------------------------------------------------------
    function beginSolved() {
      G.phase = 'solving';
      clockPause();
      select(-1);
      hud.showRotate(false);
      G.hint = null;
      G.completeAt = now() + 120;
      G.completeT = 0;
      sound.complete(G.puzzle.ringCount);
      haptic('success');
      const timeMs = Math.round(elapsed());
      const moves = G.eng.moves;
      let info;
      if (G.mode === 'daily') {
        const isToday = G.day === dayNumberFromKey(dateKey(new Date()));
        info = scores.completeDaily(G.day, moves, timeMs, G.eng.hints, G.theme.key);
        G.result = { timeMs, moves, par: G.eng.par, hints: G.eng.hints, streak: scores.currentStreak(G.day), info, board: '' };
        // Only a live solve of today's edition goes on the leaderboard.
        if (isToday && info.first && !G.restoredSolved) {
          G.result.board = 'Saving to today’s board…';
          scores.submitDaily(timeMs, moves, G.day, info.streak, r => onBoardResult(r));
        }
        try { ctx.game.progress && ctx.game.progress.complete('daily', { state: snapshot() }).catch(() => { }); } catch (e) { }
        try { ctx.platform.complete({ mode: 'daily', edition: G.day, timeMs, moves }); } catch (e) { }
      } else {
        info = scores.completeLevel(G.level, moves, timeMs, G.theme.key);
        G.result = { timeMs, moves, par: G.eng.par, hints: G.eng.hints, info, board: '' };
        try { ctx.platform.complete({ mode: 'study', level: G.level, timeMs, moves }); } catch (e) { }
      }
      saveLocal();
      ctx.timeout(() => showResult(true), 1500);
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
      const best = G.mode === 'daily' ? scores.bestDailyTime() : null;
      if (best !== null && G.mode === 'daily') stats.push(['Best', fmtTime(best)]);
      const isNew = R.info && R.info.newTheme;
      hud.showPlay(false);
      hud.setHeader(G.mode, editionLabel(), true);
      hud.showDone({
        kicker: isNew ? 'New universe discovered' : 'Universe',
        name: t.name,
        desc: t.description,
        stats,
        board: R.board,
        nextLabel: G.mode === 'daily' ? 'Studies' : 'Next study',
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
      const m = movable();
      const rings = Array.from({ length: m }, () => '●').join(' ');
      const head = G.mode === 'daily' ? 'ORBIT  No. ' + pad3(G.day) : 'ORBIT  Study ' + pad3(G.level);
      const perfect = R.moves === R.par ? '  ·  perfect' : '';
      const lines = [head, '“' + t.name + '”', '◎  ' + rings, fmtTime(R.timeMs) + '  ·  ' + R.moves + ' moves (par ' + R.par + ')' + perfect];
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
      // New puzzles start solved, then wind out into their scramble.
      const scrambled = G.vis.slice();
      const solvedDailyView = done && G.eng.solved;
      if (!G.eng.solved) for (let k = 0; k < G.vis.length; k++) G.vis[k] = 0;
      G.transition = { from, t0: now(), dur: 950, then: () => {
        if (solvedDailyView || G.eng.solved) { enterSolvedView(done); return; }
        for (let k = 1; k < G.vis.length; k++) {
          const extra = (k % 2 ? -1 : 1) * TAU * 0;
          G.tween[k] = { from: 0, to: scrambled[k] + extra, t0: now() + k * 70, dur: 700, ease: easeOutQuint };
        }
        G.phase = 'intro';
        G.introEnd = now() + 700 + G.vis.length * 70;
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
    // Re-opening an edition already solved shows the finished artwork.
    function enterSolvedView(done) {
      if (!G.eng.solved) {
        // Solved elsewhere (another device): show the finished arrangement.
        for (let k = 1; k < G.puzzle.ringCount; k++) G.eng.rot[k] += G.eng.stepsToAlign(k) || 0;
        G.eng.solved = G.eng.checkSolved();
      }
      for (let k = 0; k < G.vis.length; k++) { G.vis[k] = G.eng.rot[k] * STEP; G.tween[k] = null; G.wasAligned[k] = true; }
      hud.showRotate(false);
      select(-1);
      clockPause();
      G.phase = 'done';
      G.completeT = 1; G.completeGlow = 1; G.orbitA = TAU;
      for (let k = 1; k < G.vis.length; k++) G.alignedVis[k] = 1;
      const d = done || [G.eng.moves, elapsed(), G.eng.hints];
      G.result = { timeMs: d[1], moves: d[0], par: G.eng.par, hints: d[2] || 0, info: { newTheme: false }, board: '' };
      showResult(false);
    }

    // ---- Collection and gallery ---------------------------------------------------------------
    function collectionItems() {
      const items = [];
      scores.profile.coll.slice().reverse().forEach(key => {
        const m = /^(daily|level):(\d+)$/.exec(key);
        if (!m) return;
        const n = +m[2];
        const daily = m[1] === 'daily';
        let cached = null;
        const d = daily ? scores.profile.daily[n] : scores.profile.levels.best[n];
        items.push({
          key, n, daily,
          title: '', sub: daily ? 'No. ' + pad3(n) + ' · ' + prettyDate(keyFromDayNumber(n)) : 'Study ' + pad3(n),
          ringCount: daily ? DIFFICULTY.medium.rings : DIFFICULTY[diffForLevel(n)].rings,
          stat: d ? 'Solved in ' + fmtTime(d[1]) + ', ' + d[0] + ' moves.' : '',
          d,
          theme() { return cached || (cached = ThemeEngine.forKey(key)); }
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
      hud.openCollection(items, { title: 'Undiscovered', sub: 'Study ' + pad3(nextLevel) });
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
      const nr = it.ringCount;
      G.puzzle = { ringCount: nr, sequences: PuzzleGenerator.solvedSequences(nr), scramble: new Array(nr).fill(0) };
      G.eng = createEngine(G.puzzle);
      G.theme = theme;
      G.vis = new Array(nr).fill(0); G.tween = new Array(nr).fill(null); G.flash = new Array(nr).fill(0);
      G.alignedVis = new Array(nr).fill(1); G.wasAligned = new Array(nr).fill(true);
      G.mode = 'gallery';
      G.completeT = 0; G.completeGlow = 1; G.orbitA = TAU;
      hud.applyTheme(theme);
      hud.showDone(null); hud.showPlay(false);
      G.transition = { from, t0: now(), dur: 950, then: () => {
        G.phase = 'done';
        G.completeAt = now(); G.completeT = 0.0001;
        G.result = { timeMs: 0, moves: 0, par: 0, info: {}, board: '' };
        hud.setHeader('gallery', editionLabel(), false);
        hud.showDone({ kicker: 'From your collection', name: theme.name, desc: theme.description, stats: it.d ? [['Time', fmtTime(it.d[1])], ['Moves', String(it.d[0])]] : [], board: theme.universeTitle.toUpperCase() + ' · ' + theme.material.label.toUpperCase(), nextLabel: 'Back', canShare: false });
      } };
      G.phase = 'transition';
      sound.reveal();
    }

    // ---- Scene + loop ------------------------------------------------------------------------
    function buildScene() {
      const seqs = G.puzzle.sequences;
      return {
        ringCount: G.puzzle.ringCount,
        angles: G.vis.slice(),
        families: (k, i) => seqs[k][i],
        selected: G.selected, selectT: G.selectT, dimOthers: G.selectT * (G.phase === 'play' ? 1 : 0),
        alignedVis: G.alignedVis.slice(), flash: G.flash.slice(),
        completeT: G.completeT, completeGlow: G.completeGlow,
        orbitA: G.orbitA,
        hint: G.hint && G.hint.alpha > 0.01 ? { ring: G.hint.ring, dir: G.hint.dir, alpha: G.hint.alpha } : null
      };
    }

    let hudTick = 0, idleSince = now();
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
      if (G.selected > 0 && !drag && G.phase === 'play' && t - Math.max(G.selectAt, lastAction) > 5000) { select(-1); }

      // Alignment marks and flashes.
      for (let k = 1; k < G.alignedVis.length; k++) {
        const target = G.eng.isAligned(k) && !G.tween[k] && !(drag && drag.k === k) ? 1 : 0;
        if (Math.abs(G.alignedVis[k] - target) > 0.002) { G.alignedVis[k] = lerp(G.alignedVis[k], target, 1 - Math.exp(-dt / 160)); animating = true; }
        if (G.flash[k] > 0) { G.flash[k] += dt / 900; animating = true; if (G.flash[k] >= 1) G.flash[k] = 0; }
      }
      const ot = (G.phase === 'done' || G.phase === 'solving') ? TAU : orbitTarget();
      if (Math.abs(G.orbitA - ot) > 0.0005) { G.orbitA = lerp(G.orbitA, ot, 1 - Math.exp(-dt / 220)); animating = true; }

      // Completion light.
      if ((G.phase === 'solving' || G.phase === 'done') && G.completeT > 0 && G.completeT < 1 || G.phase === 'solving') {
        G.completeT = clamp((t - G.completeAt) / 2400, 0, 1);
        G.completeGlow = Math.min(1, G.completeGlow + dt / 900);
        animating = true;
      }

      // Hint chevrons.
      if (G.hint) {
        const target = t < G.hint.until ? 1 : 0;
        G.hint.alpha = lerp(G.hint.alpha, target, 1 - Math.exp(-dt / 140));
        if (!target && G.hint.alpha < 0.01) G.hint = null;
        animating = true;
      }

      // First-time nudge: the outer ring sways, once, to show it turns.
      if (G.phase === 'play' && !scores.profile.seenIntro && !G.interacted && !drag) {
        if (!G.nudge && t - idleSince > 1600) G.nudge = { t0: t };
        if (G.nudge) {
          const k = G.puzzle.ringCount - 1;
          const u = (t - G.nudge.t0) / 1600;
          const base = G.eng.rot[k] * STEP;
          G.vis[k] = base + Math.sin(Math.min(1, u) * TAU) * 0.2 * (1 - Math.min(1, u));
          if (u >= 1) { G.vis[k] = base; G.nudge = null; idleSince = t + 2600; }
          animating = true;
        }
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

    if (window.__ORBIT_DEV) window.__orbit = { G, layout: () => L, board, scores, goTo, ThemeEngine, renderThumbnail, ThemeRegistry };
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
          const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 1));
          if (!eligible || !s || s.v !== 1 || s.edition !== today) return;
          loadPuzzle('daily', today, s);
          G.dirty = true;
        }).catch(err => { progressBlocked = false; try { ctx.platform.error({ stage: 'progress_load', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
  }
};
