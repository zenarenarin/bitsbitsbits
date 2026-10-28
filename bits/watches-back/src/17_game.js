// =====================================================================
// The game: Plethora entry, loading, input, the campaign, the loop.
// =====================================================================
const SAVE_KEY = 'ttwb_save_v1';
const defaultSave = () => ({ v: 1, cleared: 0, current: 0, sound: true, quality: -1, totalMs: 0, seen: 0, bestMs: 0, finished: false, encMs: {} });

window.plethoraBit = {
  meta: { title: 'The Thing That Watches Back', runtime: 'plethora-bit@2', tags: ['horror', '3d', 'puzzle', 'stealth'], permissions: ['audio', 'haptics', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object' && s.v === 1) save = Object.assign(defaultSave(), s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number ? ctx.tune.number(id) : undefined; return v === undefined || v === null ? d : v; } catch (e) { return d; } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---- first frame: a DOM shell painted before anything loads ----------------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 38%,#4a4a36 0%,#24261d 55%,#0d0c09 100%)';
    const H = createHud(ctx);
    H.inGame(false);
    // title panel
    const tp = H.panel('title', true);
    H.el('div', 'tw-title', 'The thing that watches back', tp);
    H.tsub = H.el('div', 'tw-sub', 'A place built to notice you. Hold its eyes, one at a time.', tp);
    const ta = H.el('div', 'tw-actions', '', tp);
    H.bBegin = H.el('button', 'tw-b', 'Loading…', ta); H.bBegin.disabled = true;
    H.bEnc = H.el('button', 'tw-b sec', 'Encounters', ta);
    H.show('title');
    H.fade.style.opacity = '0';
    try { if (ctx.markVisualReady) ctx.markVisualReady('title'); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
    let readySent = false;
    const sendReady = () => { if (readySent) return; readySent = true; try { ctx.platform.ready(); } catch (e) { } };
    const bootFail = (stage, err) => {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      H.tsub.textContent = stage === 'library' ? 'The 3D library could not be downloaded. Check the connection and try again.' : 'This device could not start the 3D renderer.';
      H.bBegin.disabled = false; H.bBegin.textContent = 'Try again';
      H.bBegin.onclick = () => { H.bBegin.onclick = null; H.bBegin.disabled = true; H.bBegin.textContent = 'Loading…'; H.tsub.textContent = ''; boot(); };
      sendReady();
    };

    // ---- load three -------------------------------------------------------------
    let renderer = null, view = null, audio = createAudio();
    audio.setOn(save.sound);
    ctx.onDestroy(() => { try { audio.close(); } catch (e) { } try { if (view) view.clear(); if (renderer) renderer.dispose(); } catch (e) { } });
    async function boot() {
      try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
      if (destroyed) return;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
      } catch (e) { bootFail('renderer', e); return; }
      try { initGfx(); } catch (e) { bootFail('renderer', e); return; }
      let q = save.quality >= 0 ? save.quality : ((ctx.nativeDpr || 1) >= 3 ? 1 : 2);
      view = createView(renderer, { quality: q });
      ctx.onResize(layout, { immediate: true });
      try {
        loadEncounter(save.finished ? 0 : clamp(save.current, 0, ENCOUNTERS.length - 1), 0, true);
        view.update(G.W, 0.016); view.render();
      } catch (e) { bootFail('first-frame', e); console.error(e); return; }
      H.bBegin.disabled = false;
      H.bBegin.innerHTML = save.cleared > 0 && !save.finished ? `Continue <small>${String(save.current + 1).padStart(2, '0')} · ${ENCOUNTERS[save.current].name}</small>` : 'Begin';
      mode = 'title';
      sendReady();
      startLoop();
    }
    function layout() {
      if (!view) return;
      const w = ctx.width, h = ctx.height;
      const dprCap = view.quality > 1 ? 2 : view.quality > 0 ? 1.5 : 1;
      view.resize(w, h, Math.min(ctx.dpr || 1, dprCap));
    }

    // ---- campaign state -------------------------------------------------------------
    const G = { W: null, idx: 0, cp: 0, fails: 0, encT: 0, runMs: save.totalMs || 0, hintsDone: {}, lastHint: null, statusT: 0, stillT: 0, attempt: 0 };
    let mode = 'boot', acc = 0, transT = 0, transKind = null, ended = false;
    function mods() { return { acquire: tune('acquire_scale', 1), speed: tune('walk_speed', 1), mech: tune('mechanism_speed', 1) }; }
    function loadEncounter(idx, cp, quiet) {
      G.idx = idx; G.cp = cp || 0;
      G.W = createWorld(ENCOUNTERS[idx], { checkpoint: G.cp, mods: mods() });
      view.setEncounter(G.W);
      view.updateCamera(G.W, 0.016, true);
      G.encT = 0; G.hintsDone = {}; G.lastHint = null; G.statusT = 0; G.stillT = 0;
      setGazeInput(null);
      audio.setAct(ENCOUNTERS[idx].look);
      if (!quiet) {
        H.setLabel(idx + 1, ENCOUNTERS[idx].name);
        H.setProgress(idx, save.cleared, ENCOUNTERS.length);
      }
    }
    function beginPlay() {
      audio.unlock();
      try { ctx.platform.start({ encounter: G.idx + 1 }); } catch (e) { }
      G.attempt++;
      H.show(null); H.inGame(true);
      mode = 'play';
      H.setLabel(G.idx + 1, ENCOUNTERS[G.idx].name);
      H.setProgress(G.idx, save.cleared, ENCOUNTERS.length);
    }
    function restartEncounter() {
      loadEncounter(G.idx, G.cp, true);
      mode = 'play';
    }

    // ---- input -------------------------------------------------------------------------
    const input = { stick: null, keys: {}, gazeTouches: new Map() };
    function setGazeInput(id) { if (G.W) { if (id && G.W.gaze.target !== id) audio.gaze(panOf(G.W.eyeById[id])); setGaze(G.W, id); } }
    function panOf(e) { if (!e || !view) return 0; const s = view.toScreen(e.pos); return clamp((s.x / view.width) * 2 - 1, -1, 1) * 0.7; }
    const rectOf = () => canvas.getBoundingClientRect();
    ctx.listen(canvas, 'pointerdown', ev => {
      if (mode !== 'play') return;
      audio.unlock();
      const r = rectOf(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { }
      const inStickZone = x < view.width * 0.55 && y > view.height * 0.4;
      if (inStickZone && !input.stick) {
        input.stick = { id: ev.pointerId, x0: x, y0: y, x, y, t0: performance.now(), active: false };
        H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px';
      } else {
        const id = view.pickEye(x, y, 48);
        input.gazeTouches.set(ev.pointerId, { x0: x, y0: y, t0: performance.now(), picked: id, moved: false });
        if (id) { setGazeInput(id); try { ctx.platform.interact({ type: 'gaze' }); } catch (e) { } }
      }
      ev.preventDefault();
    }, { passive: false });
    ctx.listen(canvas, 'pointermove', ev => {
      if (mode !== 'play') return;
      const r = rectOf(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (input.stick && input.stick.id === ev.pointerId) {
        const s = input.stick; s.x = x; s.y = y;
        if (!s.active && (Math.hypot(x - s.x0, y - s.y0) > 7 || performance.now() - s.t0 > 160)) { s.active = true; H.stick.classList.add('on'); H.stick.classList.remove('ghost'); }
        // the base follows a thumb that wanders too far
        const dx = x - s.x0, dy = y - s.y0, d = Math.hypot(dx, dy), max = 52;
        if (d > max * 1.5) { s.x0 = x - dx / d * max * 1.5; s.y0 = y - dy / d * max * 1.5; H.stick.style.left = s.x0 + 'px'; H.stick.style.top = s.y0 + 'px'; }
        return;
      }
      const gt = input.gazeTouches.get(ev.pointerId);
      if (gt) {
        if (Math.hypot(x - gt.x0, y - gt.y0) > 12) gt.moved = true;
        if (gt.moved) { const id = view.pickEye(x, y, 40); if (id && id !== G.W.gaze.target) { gt.picked = id; setGazeInput(id); } }
      }
    });
    const up = ev => {
      if (input.stick && input.stick.id === ev.pointerId) {
        const s = input.stick;
        if (!s.active && performance.now() - s.t0 < 260) {
          // a quick tap in the stick zone is still a look
          const id = view.pickEye(s.x0, s.y0, 48);
          if (id) setGazeInput(id); else if (G.W && G.W.gaze.target) { setGazeInput(null); }
        }
        input.stick = null; H.stick.classList.remove('on');
        return;
      }
      const gt = input.gazeTouches.get(ev.pointerId);
      if (gt) {
        input.gazeTouches.delete(ev.pointerId);
        if (!gt.picked && !gt.moved && performance.now() - gt.t0 < 400 && mode === 'play') setGazeInput(null); // tap on nothing: look away
      }
    };
    ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(window, 'keydown', ev => {
      input.keys[ev.code] = true;
      if (ev.code === 'Escape' || ev.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'pause') resumeGame(); }
      if (mode === 'play' && (ev.code === 'Space' || ev.code === 'KeyQ')) { setGazeInput(null); ev.preventDefault(); }
      if (mode === 'play' && ev.code === 'KeyE') cycleGaze();
    });
    ctx.listen(window, 'keyup', ev => { input.keys[ev.code] = false; });
    ctx.listen(window, 'blur', () => { input.keys = {}; });
    function cycleGaze() {
      const W = G.W; if (!W) return;
      const vis = W.eyes.filter(e => { const s = view.toScreen(e.pos); return !s.behind && s.x > 0 && s.x < view.width && s.y > 0 && s.y < view.height; });
      vis.sort((a, b) => view.toScreen(a.pos).x - view.toScreen(b.pos).x);
      if (!vis.length) return;
      const i = vis.findIndex(e => e.id === W.gaze.target);
      setGazeInput(vis[(i + 1) % vis.length].id);
    }
    function readMove() {
      let mx = 0, mz = 0;
      const k = input.keys;
      if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1;
      if (k.KeyW || k.ArrowUp) mz -= 1; if (k.KeyS || k.ArrowDown) mz += 1;
      if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
      const s = input.stick;
      if (s && s.active) {
        const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot(dx, dy), max = 46;
        const m = Math.min(1, d / max);
        const kx = d > 0 ? dx / d : 0, ky = d > 0 ? dy / d : 0;
        H.knob.style.transform = `translate(${kx * Math.min(d, max)}px,${ky * Math.min(d, max)}px)`;
        if (m > 0.12) { const mm = Math.min(1, (m - 0.12) / 0.7); mx = kx * mm; mz = ky * mm; }
      }
      return [mx, mz];
    }

    // ---- buttons --------------------------------------------------------------------------
    ctx.input.activate(H.bBegin, () => {
      if (mode !== 'title' || H.bBegin.disabled) return;
      audio.unlock(); audio.ui();
      if (save.finished) { save.finished = false; save.totalMs = 0; save.seen = 0; G.runMs = 0; persist(); loadEncounter(0, 0, true); }
      beginPlay();
    });
    // encounters list
    const ep = H.panel('enc', true);
    const eList = H.el('div', 'tw-list', '', ep);
    const eBack = H.el('button', 'tw-b sec', 'Back', ep);
    let encFrom = 'title';
    function renderEncList() {
      let s = '', act = 0;
      const names = ['Attention', 'Relationships', 'Deception', 'Convergence'];
      ENCOUNTERS.forEach((d, i) => {
        if (d.act !== act) { act = d.act; s += `<div class="tw-act">Act ${act} — ${names[act - 1]}</div>`; }
        const lock = i > save.cleared;
        s += `<button class="tw-li${lock ? ' lock' : ''}${i === G.idx ? ' cur' : ''}" data-i="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${lock ? '—' : d.name}<em>${save.encMs[d.id] ? fmtTime(save.encMs[d.id]) : ''}</em></button>`;
      });
      eList.innerHTML = s;
    }
    ctx.listen(eList, 'click', ev => {
      const b = ev.target.closest('[data-i]'); if (!b) return;
      const i = +b.dataset.i; if (i > save.cleared) return;
      audio.unlock(); audio.ui();
      loadEncounter(i, 0, true);
      save.current = i; persist();
      beginPlay();
    });
    ctx.input.activate(H.bEnc, () => { encFrom = 'title'; renderEncList(); H.show('enc'); audio.ui(); });
    ctx.input.activate(eBack, () => { H.show(encFrom); audio.ui(); });
    // pause
    const pp = H.panel('pause', true);
    H.el('div', 'tw-title', 'Paused', pp);
    H.pauseSub = H.el('div', 'tw-sub', '', pp);
    const pa = H.el('div', 'tw-actions', '', pp);
    const bResume = H.el('button', 'tw-b', 'Resume', pa);
    const bRestart = H.el('button', 'tw-b sec', 'Restart encounter', pa);
    const bEncs = H.el('button', 'tw-b sec', 'Encounters', pa);
    const bSound = H.el('button', 'tw-b sec', '', pa);
    const renderSound = () => { bSound.innerHTML = `Sound <small>${save.sound ? 'On' : 'Off'}</small>`; };
    renderSound();
    function pauseGame() { if (mode !== 'play') return; mode = 'pause'; H.pauseSub.textContent = `${String(G.idx + 1).padStart(2, '0')} · ${ENCOUNTERS[G.idx].name}`; H.show('pause'); H.setHint(null); input.stick = null; H.stick.classList.remove('on'); }
    function resumeGame() { if (mode !== 'pause') return; mode = 'play'; H.show(null); }
    ctx.input.activate(H.pause, () => { if (mode === 'play') { pauseGame(); audio.ui(); } else if (mode === 'pause') resumeGame(); });
    ctx.input.activate(bResume, () => { resumeGame(); audio.ui(); });
    ctx.input.activate(bRestart, () => { audio.ui(); H.show(null); G.cp = 0; restartEncounter(); });
    ctx.input.activate(bEncs, () => { encFrom = 'pause'; renderEncList(); H.show('enc'); audio.ui(); });
    ctx.input.activate(bSound, () => { save.sound = !save.sound; persist(); audio.setOn(save.sound); renderSound(); audio.ui(); });
    // ending
    const np = H.panel('end', true);
    H.el('div', 'tw-title', 'It watches back', np);
    H.endSub = H.el('div', 'tw-sub', '', np);
    H.endStats = H.el('div', 'tw-stats', '', np);
    H.board = H.el('div', 'tw-board', '', np);
    const na = H.el('div', 'tw-actions', '', np);
    const bAgain = H.el('button', 'tw-b', 'Play again', na);
    const bEnc2 = H.el('button', 'tw-b sec', 'Encounters', na);
    ctx.input.activate(bAgain, () => { audio.ui(); save.finished = false; save.totalMs = 0; save.seen = 0; G.runMs = 0; persist(); loadEncounter(0, 0, true); beginPlay(); });
    ctx.input.activate(bEnc2, () => { encFrom = 'end'; renderEncList(); H.show('enc'); audio.ui(); });

    // ---- outcomes -----------------------------------------------------------------------------
    function onEvents(W) {
      for (const ev of W.events) {
        const e = ev.id ? W.eyeById[ev.id] : null, pan = e ? panOf(e) : 0;
        switch (ev.type) {
          case 'notice': audio.notice(pan); if (view.player) view.player.flinch = 1; haptic('light'); break;
          case 'alert': audio.alert(pan); break;
          case 'pin': audio.pin(pan); haptic('medium'); try { ctx.platform.interact({ type: 'pin' }); } catch (er) { } break;
          case 'release': audio.release(pan); break;
          case 'freed': audio.freed(pan); break;
          case 'link': audio.link(panOf(W.eyeById[ev.a])); break;
          case 'unlink': audio.unlink(panOf(W.eyeById[ev.a])); view.snapBeam(ev.a, ev.b); break;
          case 'mech_prime': audio.prime(0); pulseTendons(view.world, ev.id); break;
          case 'gaze_refused': audio.refuse(pan); haptic('warning'); break;
          case 'false_reveal': audio.falseReveal(pan); break;
          case 'liar_open': audio.liar(pan); haptic('warning'); break;
          case 'alarm': audio.alarm(pan); haptic('warning'); break;
          case 'awaken': audio.awaken(pan); break;
          case 'caught': audio.caught(); haptic('error'); break;
          case 'fall_start': audio.fall(); break;
          case 'won': audio.won(); haptic('success'); break;
        }
      }
      W.events.length = 0;
    }
    function encounterCleared() {
      const W = G.W, d = ENCOUNTERS[G.idx];
      const ms = Math.round(G.encT * 1000);
      if (!save.encMs[d.id] || ms < save.encMs[d.id]) save.encMs[d.id] = ms;
      save.cleared = Math.max(save.cleared, G.idx + 1);
      try { ctx.platform.milestone('encounter_clear', { encounter: G.idx + 1 }); ctx.platform.setProgress((G.idx + 1) / ENCOUNTERS.length); } catch (e) { }
      if (G.idx + 1 >= ENCOUNTERS.length) { save.current = 0; persist(); startEnding(); return; }
      save.current = G.idx + 1; persist();
      try { if (ctx.game && ctx.game.progress && ctx.manifest && ctx.manifest.game) ctx.game.progress.save('campaign', { state: { enc: G.idx + 1 }, label: `${String(G.idx + 2).padStart(2, '0')} · ${ENCOUNTERS[G.idx + 1].name}`, percent: (G.idx + 1) / ENCOUNTERS.length }).catch(() => { }); } catch (e) { }
      // transition: the iris closes, then opens on the next place
      mode = 'trans'; transT = 0; transKind = 'next';
    }
    function startEnding() {
      mode = 'ending'; transT = 0; ended = true;
      save.finished = true;
      const total = G.runMs;
      if (!save.bestMs || total < save.bestMs) save.bestMs = total;
      persist();
      audio.ending();
      try { ctx.platform.complete({ timeMs: total, seen: save.seen }); } catch (e) { }
      try { if (ctx.game && ctx.game.progress && ctx.manifest && ctx.manifest.game) ctx.game.progress.complete('campaign').catch(() => { }); } catch (e) { }
      const att = G.attempt;
      H.endSub.textContent = 'You held every eye that mattered, and walked into the one that never closes.';
      H.endStats.innerHTML = `<div>${fmtTime(total)}<small>Campaign time</small></div><div>${save.seen}<small>Times seen</small></div>`;
      H.board.innerHTML = '';
      try {
        if (ctx.memory && ctx.manifest && ctx.manifest.memory && ctx.manifest.memory.records && ctx.manifest.memory.records.campaign_time) {
          H.board.innerHTML = '<div><span>Leaderboard</span><span>Updating…</span></div>';
          const rec = ctx.memory.record('campaign_time');
          rec.submit(total, { label: fmtTime(total) }).then(() => rec.leaderboard({ scope: 'global', period: 'all_time', limit: 3 })).then(lb => {
            if (destroyed || att !== G.attempt) return;
            let s = '';
            for (const r of (lb.rows || []).slice(0, 3)) s += `<div><span>${r.rank}. ${escapeHtml(r.username || r.displayName || 'Player')}</span><span>${r.displayLabel || fmtTime(r.value)}</span></div>`;
            if (lb.viewerRank && lb.viewerRank.rank) s += `<div class="me"><span>You: ${lb.viewerRank.rank} of ${lb.totalRanked || '—'}</span><span>${fmtTime(total)}</span></div>`;
            H.board.innerHTML = s || '<div><span>Leaderboard</span><span>No times yet</span></div>';
          }).catch(() => { if (!destroyed && att === G.attempt) H.board.innerHTML = '<div><span>Leaderboard</span><span>Unavailable right now</span></div>'; });
        }
      } catch (e) { }
    }
    function fmtTime(ms) { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

    // ---- hints: one short line, only when it is useful -------------------------------------------
    function updateHints(W, dt) {
      const d = ENCOUNTERS[G.idx];
      let shown = null;
      for (const h of d.hints || []) {
        if (G.hintsDone[h.id]) continue;
        if (h.when && !h.when(W)) continue;
        if (h.until && h.until(W)) { G.hintsDone[h.id] = true; if (H.hintId() === h.id) H.setHint(null); continue; }
        shown = h; break;
      }
      if (G.fails >= 2 && d.failHint && G.encT < 6) shown = { id: 'fail', text: d.failHint, ms: 6000 };
      if (shown) {
        if (H.hintId() !== shown.id) { H.setHint(shown.text, shown.id, shown.ms || 0); if (shown.ms) G.hintsDone[shown.id] = true; }
        if (shown.stick && !input.stick && G.encT > 0.8) {
          H.stick.classList.add('ghost'); H.stick.style.left = Math.round(view.width * 0.24) + 'px'; H.stick.style.top = Math.round(view.height * 0.74) + 'px';
        }
        G.focusEye = shown.focus || null;
      } else {
        if (H.hintId() && H.hintId() !== 'fail' && !G.hintsDone[H.hintId()]) H.setHint(null);
        G.focusEye = null;
      }
      if (!shown || !shown.stick || input.stick) H.stick.classList.remove('ghost');
      H.tickHint(dt);
    }

    // ---- per-frame HUD: reticle, focus ring, edge marks, ink -----------------------------------------
    const _s = {};
    function updateHudFrame(W, dt) {
      // gaze reticle
      const g = W.gaze;
      if (g.target && W.eyeById[g.target] && mode === 'play') {
        const e = W.eyeById[g.target], s = view.toScreen(e.pos, _s);
        const s2 = view.toScreen(vAdd(e.pos, [0, e.size, 0]));
        const sc = clamp(Math.abs(s2.y - s.y) / 22, 0.7, 2.2);
        H.ret.style.transform = `translate(${s.x}px,${s.y}px) scale(${sc})`;
        H.ret.classList.add('on');
        const pinned = e.state === 'pinned';
        H.retP.setAttribute('stroke-dashoffset', String(188.5 * (1 - (g.refused ? 0.25 : g.focus))));
        H.retP.setAttribute('stroke', g.refused ? '#8a7f68' : e.isFalse && e.revealed ? '#8a7f68' : '#fff6dc');
        H.retP.setAttribute('stroke-dasharray', g.refused ? '6 8' : '188.5');
        H.retTk.style.opacity = pinned ? '1' : '0.3';
      } else H.ret.classList.remove('on');
      // onboarding focus ring
      if (G.focusEye && W.eyeById[G.focusEye] && W.eyeById[G.focusEye].state !== 'pinned' && mode === 'play') {
        const e = W.eyeById[G.focusEye], s = view.toScreen(e.pos, _s);
        const s2 = view.toScreen(vAdd(e.pos, [0, e.size, 0]));
        const sc = clamp(Math.abs(s2.y - s.y) / 22, 0.7, 2.2);
        H.focus.style.transform = `translate(${s.x}px,${s.y}px) scale(${sc})`; H.focus.classList.add('on');
      } else H.focus.classList.remove('on');
      // amber marks at the edge for eyes acquiring you from off screen
      let n = 0, maxAcq = 0;
      const area = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      for (const e of W.eyes) {
        if (e.isFalse) continue;
        maxAcq = Math.max(maxAcq, e.acq);
        if (!(e.seesPlayer || e.acq > 0.08)) continue;
        const s = view.toScreen(e.pos, _s);
        const m = 18;
        const inside = !s.behind && s.x > m && s.x < view.width - m && s.y > area.top + m && s.y < view.height - area.bottom - m;
        if (inside) continue;
        let x = s.x, y = s.y;
        if (s.behind) { x = view.width - x; y = view.height - y; }
        const cx = view.width / 2, cy = view.height / 2;
        const ang = Math.atan2(y - cy, x - cx);
        const bx = clamp(x, 24 + area.left, view.width - 24 - area.right), by = clamp(y, area.top + 60, view.height - area.bottom - 24);
        H.edgeMark(n++, bx, by, ang, e.acq);
      }
      H.edgeHide(n);
      const inkA = mode === 'caught' ? 1 : clamp(maxAcq * 1.15 - 0.15, 0, 1) * 0.85;
      H.ink.style.opacity = String(inkA);
      return maxAcq;
    }

    // ---- the loop ------------------------------------------------------------------------------------
    let stepAcc = 0, stepPhase = 0;
    function tick(dtMs) {
      if (destroyed || !view || !G.W) return;
      const dt = Math.min(0.1, dtMs / 1000);
      const W = G.W;
      if (mode === 'play') {
        const mv = readMove();
        W.input.mx = mv[0]; W.input.mz = mv[1];
        acc += dt;
        let n = 0;
        while (acc >= SIM_DT && n < 6) { stepWorld(W, SIM_DT); acc -= SIM_DT; n++; }
        if (n >= 6) acc = 0;
        G.encT += dt; G.runMs += dt * 1000;
        onEvents(W);
        if (W.status !== 'play') { G.statusT = 0; mode = W.status === 'won' ? 'winning' : 'caught'; if (mode === 'caught') { G.fails++; save.seen++; persist(); setGazeInput(null); } else { G.fails = 0; } }
        updateHints(W, dt);
        // footsteps
        stepPhase += dt * (W.player.speedNow || 0) * 0.42;
        if (stepPhase > 1) { stepPhase -= 1; audio.step(Math.min(1, (W.player.speedNow || 0) / PLAYER.speed)); }
      } else if (mode === 'caught') {
        G.statusT += dt;
        // the world goes still; every free eye turns to you
        stepWorld(W, SIM_DT); onEvents(W);
        for (const e of W.eyes) if (e.state !== 'dormant' && !e.isFalse) { e.look = rotateToward(e.look, vNorm(vSub(playerChest(W), e.pos)), dt * 2.5); e.seesPlayer = true; e.acq = Math.min(1, e.acq + dt); }
        if (G.statusT > 0.25 && !H.seen.classList.contains('on')) {
          const d = ENCOUNTERS[G.idx];
          H.seen.innerHTML = W.status === 'fell' ? 'Fallen' : 'Seen' + (G.fails >= 2 && d.failHint ? `<small>${d.failHint}</small>` : '');
          H.seen.classList.add('on');
        }
        if (G.statusT > (G.fails >= 2 ? 2.4 : 1.5)) { H.fade.style.transition = 'opacity .35s ease'; H.fade.style.opacity = '1'; }
        if (G.statusT > (G.fails >= 2 ? 2.8 : 1.9)) {
          H.seen.classList.remove('on');
          restartEncounter();
          H.fade.style.opacity = '0';
          try { ctx.platform.fail({ encounter: G.idx + 1, reason: W.status }); ctx.platform.start({ encounter: G.idx + 1, retry: true }); } catch (e) { }
        }
      } else if (mode === 'winning') {
        G.statusT += dt;
        // walk on into the light
        const ex = W.zones.exit, dirx = ex ? 0 : 0;
        W.input.mx = 0; W.input.mz = -0.6;
        stepWorld(W, SIM_DT); onEvents(W);
        if (G.statusT > 0.9) encounterCleared();
      } else if (mode === 'trans') {
        transT += dt;
        H.fade.style.transition = 'opacity .6s ease';
        if (transT < 0.05) { H.fade.style.opacity = '1'; }
        if (transT > 0.7 && transKind === 'next') {
          transKind = 'shown';
          loadEncounter(G.idx + 1, 0, true);
          H.card.innerHTML = `<b>${String(G.idx + 1).padStart(2, '0')}</b><div>${ENCOUNTERS[G.idx].name}</div>`;
          H.card.classList.add('on');
          try { ctx.platform.start({ encounter: G.idx + 1 }); } catch (e) { }
        }
        if (transT > 2.0) { H.card.classList.remove('on'); H.fade.style.opacity = '0'; }
        if (transT > 2.3) { mode = 'play'; H.setLabel(G.idx + 1, ENCOUNTERS[G.idx].name); H.setProgress(G.idx, save.cleared, ENCOUNTERS.length); }
      } else if (mode === 'ending') {
        transT += dt;
        stepWorld(W, SIM_DT); W.events.length = 0;
        view.extraZoom = Math.min(120, transT * transT * 6);
        if (transT > 4.5 && !H.panels.end.classList.contains('on')) { H.show('end'); H.inGame(false); try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ timeMs: G.runMs, text: 'Reached the Centre in ' + fmtTime(G.runMs) }); } catch (e) { } }
      } else if (mode === 'title') {
        // the place breathes behind the title
        stepWorld(W, SIM_DT); W.events.length = 0;
        if (W.status !== 'play') loadEncounter(G.idx, 0, true);
      }
      if (mode !== 'ending') view.extraZoom = damp(view.extraZoom, mode === 'title' ? 6 : 0, 2, dt);
      view.update(W, dt);
      const maxAcq = updateHudFrame(W, dt);
      let moving = 0;
      for (const m of W.movers) if (m.moving) moving = 1;
      let acqP = 0; for (const e of W.eyes) if (e.seesPlayer && !e.isFalse) acqP = Math.max(acqP, e.acq);
      audio.frame(mode === 'play' ? maxAcq : 0, acqP, moving, mode === 'caught' && G.statusT < 0.6);
      view.render();
    }
    function startLoop() {
      if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs), resetOnResume: true, onPause: () => { audio.suspend(); if (mode === 'play') pauseGame(); }, onResume: () => audio.resume() });
      else ctx.onFrame(dtMs => tick(dtMs));
    }
    // dev hook
    if (window.__TTWB_DEV) window.__ttwb = { G, get mode() { return mode; }, begin: () => beginPlay(), load: (i, cp) => { loadEncounter(i, cp || 0, false); mode = 'play'; H.show(null); H.inGame(true); }, setGaze: id => setGazeInput(id), view: () => view, input, save: () => save, pause: pauseGame, resume: resumeGame };
    boot();
  }
};
