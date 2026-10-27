// =====================================================================
// The game: states, input, hints, scoring, transitions and the Plethora
// lifecycle. States: title → card → play ⇄ paused; play → captured →
// capcard → play | results; play → descend → card/play; → ending → results.
// =====================================================================

const SAVE_KEY = 'watchesback_save';
const defaultSave = () => ({ best: 0, bestEndless: 0, deepest: 0, completed: false, runs: 0, settings: { volume: 0.85, dial: 1, swap: false, calm: false, hints: true } });

// why a capture happened, and what it teaches; keyed by what caught you
const CAUGHT = {
  watcher: ['It reached you', 'It moves only while you are not looking at it.'],
  drifter: ['Crushed in the groove', 'The drifter is blind. It only goes until something stops it.'],
  collector: ['Gathered', 'Hold the collector, or never let three of them meet.'],
  liar: ['It was never held', 'The shy one looks away when watched. It is waiting for you to look away too.'],
  liarFeign: ['It was never held', 'Watched, the shy one only pretends. It does not stop for you; walk into it and it takes you.'],
  mimic: ['It moved the way you moved', 'It copies your steps a moment late. Stop, and it keeps coming for that moment.'],
  sentinel: ['Seen', 'Held in your gaze, a sentinel sees nothing. Another eye between you hides you too.'],
  choir: ['The choir sang over you', 'One of them blinks first. Hold that one and the song breaks.'],
  crown: ['The crown closed', 'Only the eye that conducts it can break it, and only when it is whole.'],
  unblinking: ['It has no lids', 'Your gaze is nothing to it. Held eyes in its way are walls; turn its ring away from you.'],
  echo: ['You met yourself', 'These move the way you once moved.'],
};

window.plethoraBit = {
  meta: { title: 'The Thing That Watches Back', runtime: 'plethora-bit@2', tags: ['arcade', 'horror', 'puzzle', 'strategy'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s, { settings: Object.assign(defaultSave().settings, s.settings || {}) }); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:#100e0c';
    const H = createUI(ctx);
    H.showOnly(H.title);
    H.tstats.innerHTML = '<div><b>…</b>OPENING</div>';
    for (const b of [H.begin, H.cont, H.endless, H.toSet]) b.style.visibility = 'hidden';
    H.top.style.display = 'none';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'italic' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }

    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start WebGL graphics.', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      H.tstats.innerHTML = `<div style="text-align:center;line-height:1.4"><b style="font-size:16px">${msg}</b></div>`;
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    ctx.onDestroy(() => { destroyed = true; try { V.dispose(); renderer.dispose(); } catch (e) { } });

    const scratch = ctx.createCanvas2D ? null : null;
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const V = createView(THREE, renderer, { canvas: mkCanvas, small });
    const audio = createAudio(!!caps.audio);
    audio.setVolume(save.settings.volume);
    ctx.onDestroy(() => audio.kill());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    const touchFirst = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
    let usedTouch = touchFirst;

    // ---------- state ----------
    let mode = 'title', S = null, def = null, run = null, wall = 0;
    let mt = 0;             // time in the current mode
    const input = { stick: null, dial: null, keys: new Set(), mouseGaze: null, gazeSet: undefined };
    let layoutBand = 0.22;

    // ---------- title spiral: a drawing that watches you ----------
    const TITLE_DEF = { id: 0, n: 4, rotation: true, seed: 11, doors: [[-90, 60], [150], [-30], [90]], barriers: [[], [40], [], [-120]], veils: [[], [[100, 130]], [], []], player: { k: 0, a: -90 },
      eyes: [{ type: 'watcher', k: 0, a: 20 }, { type: 'drifter', k: 1, a: -100 }, { type: 'liar', k: 1, a: 80 }, { type: 'sentinel', wall: 1, a: 200, face: 'in' }, { type: 'choir', k: 2, a: 10 }, { type: 'choir', k: 2, a: 26 }, { type: 'choir', k: 2, a: 42 }, { type: 'mimic', k: 3, a: 160 }, { type: 'collector', k: 0, a: 150 }, { type: 'unblinking', k: 2, a: -140 }].map(e => Object.assign(e, { beh: 'still' })) };
    let pointerWorld = null;
    function showTitle() {
      mode = 'title'; mt = 0; run = null;
      def = TITLE_DEF; S = createSim(def); S.forcedRot = 0.05;
      V.build(S, def); V.dread = 0.2; V.fade = 0.6;
      layout(ctx.width, ctx.height, ctx.safeArea);
      H.showOnly(H.title); setPlayHud(false);
      H.tstats.innerHTML = `<div><b>${save.best.toLocaleString()}</b>BEST</div><div><b>${save.deepest ? roman(save.deepest) : '—'}</b>DEEPEST</div><div><b>${save.bestEndless ? save.bestEndless.toLocaleString() : '—'}</b>ENDLESS</div>`;
      for (const b of [H.begin, H.cont, H.endless, H.toSet]) b.style.visibility = '';
      const act = continueAct();
      H.cont.hidden = act <= 1; H.cont.textContent = act > 1 ? `CONTINUE FROM ACT ${roman(act)}` : 'CONTINUE';
      H.endless.disabled = !save.completed; H.endless.style.opacity = save.completed ? '' : '0.35';
      H.endless.textContent = save.completed ? 'ENDLESS' : 'ENDLESS · LOCKED';
      V.ink(0); V.zoom = 1; V.applyCamera();
    }
    // frame the spiral itself, with a margin of the dark field around it
    function frameR() { return S ? S.G.Ro + 0.7 : 10; }
    function continueAct() { const e = ENCOUNTERS.find(q => q.id === save.deepest); return e ? e.act : 1; }

    // ---------- HUD ----------
    function setPlayHud(on) {
      H.top.style.display = on ? '' : 'none';
      H.band.style.display = on ? '' : 'none';
      H.dial.style.display = on && S && !S.rotLocked ? 'block' : 'none';
      H.dialLab.style.display = H.dial.style.display;
      H.stickLab.style.display = on && usedTouch ? '' : 'none';
      if (!on) { H.stick.style.display = 'none'; H.stick.classList.remove('ghost'); H.hint.style.opacity = 0; H.vig.style.opacity = 0; }
    }
    let hint = { key: null, until: 0 };
    function showHint(key, text, dur) {
      if (!save.settings.hints && !['look'].includes(key)) return;
      hint = { key, until: dur ? mt + dur : 1e9 };
      H.hint.textContent = text; H.hint.style.opacity = 1;
    }
    function clearHint(key) { if (!key || hint.key === key) { hint.key = null; H.hint.style.opacity = 0; H.stick.classList.remove('ghost'); H.dial.classList.remove('ghost'); } }

    // ---------- runs and encounters ----------
    function newRun(kind, startId) {
      run = { kind, startId: startId || 1, full: kind === 'campaign' && (startId || 1) === 1, score: 0, captures: 0, chains: 0, bestChain: 0, pins: 0, reveals: 0, cleared: 0, time: 0, habit: { dir: 1 }, walkSigned: 0, recordings: [], depth: kind === 'endless' ? 1 : 0, encCaptures: 0, log: [], learned: {} };
    }
    function begin(kind, startId) {
      audio.unlock();
      newRun(kind, startId);
      save.runs++; persist();
      try { ctx.platform.start({ mode: kind, from: startId || 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
      if (kind === 'endless') startEncounter(makeEndless(1, run), true);
      else startEncounter(encounterById(startId || 1), true);
    }
    function startEncounter(E, showCard) {
      run.E = E; run.encT = 0; run.encCaptures = run.encCaptures || 0;
      def = buildEncounter(E, { habit: run.habit, recordings: run.recordings });
      S = createSim(def, {});
      V.build(S, def); V.ink(0);
      layout(ctx.width, ctx.height, ctx.safeArea);
      input.gazeSet = null; input.stick = null; input.dial = null;
      H.stick.style.display = 'none';
      H.num.innerHTML = run.kind === 'endless' ? `${roman(Math.min(20, run.depth))}${run.depth > 20 ? '+' + (run.depth - 20) : ''}<small>DEPTH</small>` : `${roman(E.id)}<small>OF XX</small>`;
      H.name.textContent = E.name; H.whisper.textContent = E.whisper || '';
      H.name.style.opacity = 0; H.whisper.style.opacity = 0;
      updateScore();
      const firstOfAct = run.kind === 'campaign' && (E.id === run.startId || ENCOUNTERS.find(q => q.act === E.act).id === E.id);
      if (showCard && firstOfAct && ACTS[E.act]) { mode = 'card'; mt = 0; H.actS.textContent = ACTS[E.act].sub; H.actT.textContent = ACTS[E.act].title; H.act.classList.add('on'); setTimeout(() => H.act.classList.add('show'), 30); setPlayHud(false); }
      else enterPlay();
    }
    function enterPlay() {
      mode = 'play'; mt = 0; V.fade = 1;
      H.act.classList.remove('on', 'show');
      H.showOnly(null); setPlayHud(true);
      setTimeout(() => { if (mode === 'play') { H.name.style.opacity = 0.8; H.whisper.style.opacity = 0.9; } }, 250);
      setTimeout(() => { H.name.style.opacity = 0; H.whisper.style.opacity = 0; }, 5200);
      if (run.E.id === 1 && run.kind === 'campaign') showHint('walk', usedTouch ? 'Drag in the lower left to walk.' : 'Walk with W A S D or the arrow keys.');
      if (!S.rotLocked && !run.learned.turn) { H.dial.classList.add('ghost'); }
      if (!run.learned.walk && usedTouch) { H.stick.classList.add('ghost'); H.stick.style.left = (ctx.width * 0.22) + 'px'; H.stick.style.top = (ctx.height - bandPx() * 0.5) + 'px'; }
      audio.arrive();
    }
    function restartEncounter() { if (!run) return; startEncounter(run.E, false); }
    function updateScore() { H.score.textContent = run ? Math.floor(run.score).toLocaleString() : ''; }

    // ---------- the frame ----------
    let acc = 0;
    const DT = SIM_DT;
    const _pp = [0, 0];
    function readInput() {
      if (input.override) return input.override;
      const inp = {};
      // walking: the stick or keys, as a direction on the screen (= the world plane)
      let mx = 0, my = 0;
      if (input.stick) { mx = clamp((input.stick.x - input.stick.ox) / 46, -1, 1); my = -clamp((input.stick.y - input.stick.oy) / 46, -1, 1); const l = Math.hypot(mx, my); if (l < 0.15) { mx = my = 0; } else if (l > 1) { mx /= l; my /= l; } }
      const K = input.keys;
      if (K.has('KeyA') || K.has('ArrowLeft')) mx -= 1; if (K.has('KeyD') || K.has('ArrowRight')) mx += 1;
      if (K.has('KeyW') || K.has('ArrowUp')) my += 1; if (K.has('KeyS') || K.has('ArrowDown')) my -= 1;
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      inp.move = [mx, my];
      // turning: the dial (a jog: how far you hold it is how fast it turns) or Q / E
      let rot = 0;
      if (input.dial) rot = clamp((input.dial.x - input.dial.ox) / (64 / save.settings.dial), -1, 1) * (Math.abs(input.dial.x - input.dial.ox) < 5 ? 0 : 1);
      if (K.has('KeyQ')) rot -= K.has('ShiftLeft') || K.has('ShiftRight') ? 0.35 : 1;
      if (K.has('KeyE')) rot += K.has('ShiftLeft') || K.has('ShiftRight') ? 0.35 : 1;
      inp.rot = -rot;   // dial right turns the even rings clockwise
      if (input.gazeSet !== undefined) { inp.gaze = input.gazeSet; input.gazeSet = undefined; }
      return inp;
    }
    function threatLevel() {
      if (!S) return 0;
      let t = S.P.exposure;
      const p = S.P;
      for (const e of S.eyes) if (e.k === p.k && !e.inWall && e.lethal && e.state === ST.ACTIVE) { const d = Math.abs(wrap(e.a - p.a)) * S.rings[p.k].r - e.rad; t = Math.max(t, clamp(1 - d / 3, 0, 1)); }
      return t;
    }
    function step() {
      const inp = readInput();
      if (!inp.move) inp.move = [0, 0];
      if (Math.hypot(inp.move[0], inp.move[1]) > 0.1) { run.learned.walk = true; if (hint.key === 'walk') clearHint('walk'); H.stick.classList.remove('ghost'); }
      if (inp.rot) { if (!run.learned.turn && Math.abs(S.stats.rotated) > 0.6) { run.learned.turn = true; H.dial.classList.remove('ghost'); if (hint.key === 'turn') clearHint('turn'); } }
      const ring0 = S.P.k;
      S.step(inp);
      run.encT += DT; run.time += DT;
      handleEvents(S.events);
      // footsteps, and the mimic's echo of them a moment late
      if (S.P.moved > 0) { V._stepAcc = (V._stepAcc || 0) + S.P.moved; if (V._stepAcc > 0.85) { V._stepAcc = 0; audio.step(panOf(S.playerPos(_pp))); } }
      for (const e of S.eyes) if (e.type === 'mimic' && e.moved > 0 && e.state === ST.ACTIVE) { e._st = (e._st || 0) + e.moved; if (e._st > 0.85) { e._st = 0; audio.step(panOf(S.eyePos(e, _pp)), true); } }
      hints();
      if (S.over) return capture();
      if (S.reached) return clearEncounter();
    }
    const panOf = p => clamp(p[0] / 9, -1, 1);
    function handleEvents(evs) {
      V.onEvents(S, evs);
      for (const ev of evs) {
        const e = ev.eye !== undefined && ev.eye >= 0 ? S.eyes[ev.eye] : null;
        const pan = e ? panOf(S.eyePos(e, _pp)) : 0;
        switch (ev.type) {
          case 'pin': audio.pin(pan, e && e.type === 'drifter'); haptic('light'); run.pins++; if (!run.learned.pin) { run.learned.pin = true; if (hint.key === 'look') clearHint('look'); if (run.E.id <= 2) showHint('held', 'Held in your gaze, it cannot move.', 2.6); } break;
          case 'release': audio.release(pan); if (!run.learned.release && run.learned.pin && run.E.id <= 2) { run.learned.release = true; showHint('released', 'Look away, and it moves again.', 2.6); } break;
          case 'target': if (e && e.state === ST.ACTIVE && e.pinnable) audio.acquire(pan); break;
          case 'feign': audio.feign(pan); break;
          case 'lunge': audio.lunge(pan); break;
          case 'immune': audio.immune(pan); break;
          case 'reveal': audio.reveal(pan); run.reveals++; break;
          case 'wake': audio.wake(pan); break;
          case 'turn': if (e) audio.turnEye(pan); break;
          case 'ripple': { const c = S.eyes[ev.conductor]; audio.ripple(c ? panOf(S.eyePos(c, _pp)) : 0); break; }
          case 'choirBreak': audio.choirBreak(0); haptic('medium'); break;
          case 'knot': audio.knot(0); haptic('medium'); break;
          case 'unravel': audio.unravel(0); break;
          case 'chain': audio.chain(ev.n); haptic('success'); if (ev.n === 2) run.chains++; run.bestChain = Math.max(run.bestChain, ev.n); break;
          case 'absorb': audio.absorb(pan); break;
          case 'jam': audio.jam(); haptic('light'); break;
          case 'fixate': audio.fixate(pan); break;
          case 'crownBreak': audio.crownBreak(pan); haptic('heavy'); break;
          case 'unseal': audio.unseal(); break;
          case 'cross': audio.cross(); if (hint.key === 'door') clearHint('door'); run.learned.cross = true; break;
          case 'bump': audio.bump(); break;
          case 'close': audio.close(); break;
          case 'eyeCross': audio.wake(pan); break;
          case 'pressure': audio.wake(0); haptic('light'); break;
        }
      }
    }
    // contextual teaching, one line at a time, gone once shown understood
    function hints() {
      if (run.kind !== 'campaign') return;
      const id = run.E.id;
      if (hint.key && mt > hint.until) clearHint();
      if (hint.key) return;
      if (id === 1 && !run.learned.pin && S.eyes[0].state !== ST.DORMANT) showHint('look', usedTouch ? 'Touch the eye to look at it.' : 'Look at the eye: point at it.');
      else if (id <= 2 && run.learned.pin && !run.learned.cross) { const nd = S.nearestDoor(S.P.k, S.playerTheta(), true); if (nd && nd.arc < 2.2) showHint('door', usedTouch ? 'At an opening, push toward the centre.' : 'At an opening, walk toward the centre.'); }
      else if (id === 4 && !run.learned.turn) showHint('turn', usedTouch ? 'Hold in the lower right and drag to turn the spiral.' : 'Q and E turn the spiral.');
      else if (id === 4 && run.learned.turn && !run.learned.holdturn && S.P.k >= 1) { run.learned.holdturn = true; showHint('holdturn', 'The ring under you keeps still. What you hold stays where you hold it.', 6); }
    }
    function capture() {
      mode = 'captured'; mt = 0;
      run.captures++; run.encCaptures++;
      audio.capture(); haptic('heavy');
      const e = S.over.eye >= 0 ? S.eyes[S.over.eye] : null;
      const sp = e ? V.toScreen(...S.eyePos(e)) : V.toScreen(...S.playerPos());
      V.ink(0, sp[0], sp[1]);
      run.capturedBy = e ? (e.type === 'liar' && e.state === ST.FEIGN ? 'liarFeign' : e.type) : 'watcher';
      clearHint();
    }
    function showCaptureCard() {
      mode = 'capcard'; mt = 0;
      const c = CAUGHT[run.capturedBy] || CAUGHT.watcher;
      H.capH.textContent = c[0]; H.capSub.textContent = c[1];
      H.again.textContent = run.kind === 'endless' ? 'SEE THE RESULTS' : 'TRY AGAIN';
      H.capEnd.hidden = run.kind === 'endless';
      H.showOnly(H.cap); setPlayHud(false);
    }
    function clearEncounter() {
      // score: arriving, quickly, cleverly and unseen
      const E = run.E, st = S.stats;
      const time = run.encT;
      const parts = { base: 400 + (run.kind === 'endless' ? run.depth * 40 : E.id * 25), time: Math.max(0, Math.round(((E.par || 60) - time) * 8)), chains: st.chains * 150 + Math.max(0, st.bestChain - 1) * 60, unseen: run.encCaptures === 0 ? 250 : 0 };
      const gained = parts.base + parts.time + parts.chains + parts.unseen;
      run.score += gained; run.cleared++;
      run.log.push({ id: E.id, name: E.name, time, gained, captures: run.encCaptures, chains: st.chains });
      run.encCaptures = 0;
      run.walkSigned += st.walkSigned; run.habit = { dir: run.walkSigned >= 0 ? 1 : -1 };
      if (S.rec.length > 60) run.recordings.push(S.rec.slice(0, 1500));
      if (run.kind === 'campaign') { save.deepest = Math.max(save.deepest, E.id); persist(); }
      try { ctx.platform.milestone('spiral', { id: E.id, name: E.name, score: Math.floor(run.score) }); } catch (e) { }
      updateScore();
      audio.descend(); haptic('success');
      clearHint();
      if (run.kind === 'campaign' && E.id === 20) return startEnding();
      mode = 'descend'; mt = 0;
    }
    function afterDescend() {
      if (run.kind === 'endless') { run.depth++; startEncounter(makeEndless(run.depth, run), false); }
      else startEncounter(encounterById(run.E.id + 1), true);
      V.zoom = 0.3; V.applyCamera(); mode = mode === 'card' ? 'card' : mode; emerge = 0.8;
    }
    let emerge = 0;
    function endRun(reason) {
      if (!run) return;
      const completed = reason === 'complete';
      if (completed) { run.score += 3000 + (run.captures === 0 ? 1500 : 0); save.completed = true; }
      const final = Math.floor(run.score);
      let best = false;
      if (run.kind === 'endless') { best = final > save.bestEndless; save.bestEndless = Math.max(save.bestEndless, final); }
      else if (run.full) { best = final > save.best; save.best = Math.max(save.best, final); }
      persist();
      try { (completed ? ctx.platform.complete : ctx.platform.fail)({ score: final, reached: run.E ? run.E.id : 0, captures: run.captures, mode: run.kind }); } catch (e) { }
      if (scoreTrack && (run.kind === 'endless' || run.full)) { try { scoreTrack.set(final); scoreTrack.submit(run.kind === 'endless' ? 'endless' : 'score', { label: final + ' pts' }).catch(() => { }); } catch (e) { } }
      mode = 'results'; mt = 0;
      const mins = Math.floor(run.time / 60), secs = Math.floor(run.time % 60);
      H.resH.textContent = completed ? 'You reached the centre' : run.kind === 'endless' ? `Depth ${run.depth}` : 'The spiral kept you';
      H.resSub.innerHTML = (best ? '<span class="wb-new">A new best.</span> ' : '') + (completed ? (run.captures === 0 ? 'Never once caught.' : 'It let you go. This time.') : run.kind === 'endless' ? 'It has learned more than you have.' : `You reached ${roman(run.E.id)}: ${run.E.name}.`) + (!run.full && run.kind === 'campaign' ? ' <span style="opacity:.6">(Continued runs are not ranked.)</span>' : '');
      H.resStats.innerHTML = `<div><b>${final.toLocaleString()}</b>SCORE</div><div><b>${mins}:${String(secs).padStart(2, '0')}</b>TIME</div><div><b>${run.cleared}</b>${run.kind === 'endless' ? 'SPIRALS' : 'REACHED'}</div>`;
      const rows = [['Caught', run.captures], ['Chain reactions', run.chains], ['Longest chain', run.bestChain ? run.bestChain + ' eyes' : '—'], ['Eyes held', run.pins]];
      H.resList.innerHTML = rows.map(r => `<div class="wb-li"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
      H.resEndless.disabled = !save.completed; H.resEndless.style.opacity = save.completed ? '' : '0.35';
      H.showOnly(H.res); setPlayHud(false);
    }

    // ---------- the ending ----------
    let ending = null;
    const END_LINES = ['It was never looking at you.', 'It was waiting to be looked at.', 'Someone new has come in from the edge.', 'Watch them.'];
    function startEnding() {
      mode = 'ending'; mt = 0;
      setPlayHud(false); H.skip.style.display = ''; H.skip.style.bottom = (bandPx() * 0.4) + 'px';
      // the traveller is gone; in their place on the outer ring an eye opens, and a newcomer walks in
      const E = { id: 21, n: 4, rotation: true, seed: 2121, doors: [[-90], [150], [-30], [90]], barriers: [[], [], [], []], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', name: 'you', k: 0, a: -60, beh: 'still', wake: 3.2, wakeNear: 0 }] };
      def = E; S = createSim(E); S.forcedRot = 0.04;
      V.build(S, def); V.dread = 1; V.fade = 1; V.ink(0);
      layout(ctx.width, ctx.height, ctx.safeArea);
      ending = { line: -1 };
      audio.ending();
      V.zoom = 0.55; V.applyCamera();
    }
    function tickEnding(dt) {
      // the newcomer walks in along the outer groove; the new eye watches them
      if (mt > 2.5) S.P.a = wrap(-90 * DEG - (mt - 2.5) * 0.08);
      S.step({ gaze: null });
      const you = S.eye('you'); if (you.state !== ST.DORMANT) { you.look = S.playerPos(); }
      V.zoom = damp(V.zoom, mt < 3 ? 0.55 : 1.15, 0.35, dt); V.applyCamera();
      const li = Math.floor((mt - 3.5) / 3.2);
      if (li !== ending.line && li >= 0 && li < END_LINES.length) { ending.line = li; H.end.textContent = END_LINES[li]; H.end.style.opacity = 1; setTimeout(() => { if (mode === 'ending') H.end.style.opacity = 0; }, 2400); }
      if (mt > 3.5 + END_LINES.length * 3.2 + 1) finishEnding();
    }
    function finishEnding() { H.skip.style.display = 'none'; H.end.style.opacity = 0; V.zoom = 1; V.applyCamera(); endRun('complete'); }

    // ---------- main loop ----------
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      wall += dt; mt += dt;
      if (mode === 'play') {
        if (run && run.kind === 'endless') { if (!run.next || run.next.depth !== run.depth + 1) prepareNextEndless(run); else if (!run.next.prep.done) run.next.prep.step(3); }
        acc += dt; let n = 0;
        while (acc >= DT && n < 5 && mode === 'play') { step(); acc -= DT; n++; }
        if (n === 5) acc = 0;
        if (emerge > 0) { emerge = Math.max(0, emerge - dt); V.zoom = lerp(1, 0.3, smooth(emerge / 0.8)); V.applyCamera(); }
      } else acc = 0;
      if (mode === 'title' && S) { S.step({}); for (const e of S.eyes) if (pointerWorld) e.look = pointerWorld.slice(); }
      if (mode === 'card' && mt > 2.6) enterPlay();
      if (mode === 'captured') {
        V.ink(clamp((mt - 0.25) / 0.9, 0, 1) * 0.2);
        if (mt > 1.35) { if (run.kind === 'endless') { V.ink(0); endRun('captured'); } else showCaptureCard(); }
      }
      if (mode === 'descend') {
        const k = clamp(mt / 1.5, 0, 1);
        V.zoom = 1 + smooth(k) * 3.6; V.applyCamera();
        V.ink(clamp((k - 0.55) / 0.45, 0, 1), V.cx, V.cy);
        if (k >= 1) { V.ink(0); afterDescend(); }
      }
      if (mode === 'ending') tickEnding(dt);
      // HUD and atmosphere
      if (S) {
        const threat = mode === 'play' ? threatLevel() : 0;
        H.vig.style.opacity = mode === 'play' ? clamp(S.P.exposure * 1.1 + threat * 0.25, 0, 1).toFixed(2) : 0;
        let unb = 0; for (const e of S.eyes) if (e.type === 'unblinking' && e.state === ST.ACTIVE) { const d = Math.hypot(...S.eyePos(e).map((v, i) => v - S.playerPos()[i])); unb = Math.max(unb, clamp(1 - d / 10, 0.15, 1)); }
        audio.ambient({ quiet: def && def.quiet, dread: V.dread, rot: mode === 'play' ? S.rotDone : 0, exposure: mode === 'play' ? S.P.exposure : 0, unblinking: mode === 'play' ? unb : 0 }, dt);
        V.update(S, dt, { threat, capture: mode === 'captured' ? clamp(mt / 1.1, 0, 1) : mode === 'capcard' ? 1 : 0, hidePlayer: mode === 'title' || mode === 'ending' && false, hideThread: mode !== 'play', calm: save.settings.calm });
        if (mode === 'ending' || mode === 'title') V.update.hide = true;
        updateDial(dt);
      }
      V.render();
    }
    function updateDial() {
      if (H.dial.style.display === 'none' || !S) return;
      // the ticks show the ring just inside you turning
      const k = Math.min(S.N, S.P.k + 1);
      const sp = 14, span = H.ticks.length * sp;
      const off = (S.phi[k] * S.gear(k)) * 60;
      for (let i = 0; i < H.ticks.length; i++) { const x = (((i * sp + off) % span) + span) % span - sp; H.ticks[i].style.transform = `translateX(${x}px)`; H.ticks[i].style.left = '0'; }
      const kx = input.dial ? clamp(input.dial.x - input.dial.ox, -60, 60) : 0;
      H.dialKnob.style.transform = `translateX(${kx}px)`;
      H.dialKnob.style.opacity = input.dial ? 1 : 0.5;
    }

    // ---------- input ----------
    const bandPx = () => Math.max(132, ctx.height * layoutBand);
    const rect = () => canvas.getBoundingClientRect();
    const roles = new Map();
    function gazeAt(sx, sy) {
      const w = V.toWorld(sx, sy);
      // a touch near an eye means that eye: snap to the nearest within reach
      let best = null, bd = 1e9;
      for (const e of S.eyes) {
        if (e.state === ST.DEAD || e.state === ST.REVEALED) continue;
        const p = S.eyePos(e), d = Math.hypot(p[0] - w[0], p[1] - w[1]);
        if (d < e.rad + 0.75 && d < bd) { bd = d; best = p; }
      }
      input.gazeSet = best || w;
    }
    function onDown(e) {
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      audio.unlock();
      if (mode === 'title') { pointerWorld = V.toWorld(x, y); return; }
      if (mode === 'card') { enterPlay(); return; }
      if (mode === 'ending' && mt > 1.5) { return; }
      if (mode !== 'play') return;
      if (e.cancelable) e.preventDefault();
      if (e.pointerType === 'touch') usedTouch = true;
      const inBand = y > ctx.height - bandPx() - ((ctx.safeArea && ctx.safeArea.bottom) || 0);
      const leftSide = save.settings.swap ? x > ctx.width / 2 : x < ctx.width / 2;
      if (inBand && (leftSide || S.rotLocked)) {
        roles.set(e.pointerId, 'stick');
        input.stick = { ox: x, oy: y, x, y };
        H.stick.classList.remove('ghost'); H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = '';
      } else if (inBand) {
        roles.set(e.pointerId, 'dial');
        input.dial = { ox: x, x };
      } else {
        roles.set(e.pointerId, 'gaze');
        gazeAt(x, y);
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    }
    function onMove(e) {
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (mode === 'title') { pointerWorld = V.toWorld(x, y); return; }
      if (mode !== 'play') return;
      const role = roles.get(e.pointerId);
      if (role === 'stick' && input.stick) { input.stick.x = x; input.stick.y = y; const dx = clamp(x - input.stick.ox, -46, 46), dy = clamp(y - input.stick.oy, -46, 46); H.knob.style.transform = `translate(${dx}px,${dy}px)`; }
      else if (role === 'dial' && input.dial) input.dial.x = x;
      else if (role === 'gaze') gazeAt(x, y);
      else if (!role && e.pointerType === 'mouse') {
        // with a mouse, the gaze follows the pointer over the spiral
        if (y < ctx.height - bandPx()) gazeAt(x, y);
      }
    }
    function onUp(e) {
      const role = roles.get(e.pointerId); roles.delete(e.pointerId);
      if (role === 'stick') { input.stick = null; H.stick.style.display = 'none'; }
      if (role === 'dial') input.dial = null;
      // the gaze stays where it was left
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'lostpointercapture', onUp);
    ctx.listen(canvas, 'wheel', e => { e.preventDefault(); }, { passive: false });
    const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyP', 'KeyR', 'Escape', 'Space', 'Enter']);
    ctx.listen(window, 'keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      audio.unlock();
      if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) { usedTouch = false; begin('campaign', 1); return; }
      if (mode === 'card' && (e.code === 'Enter' || e.code === 'Space')) { enterPlay(); return; }
      if (mode === 'capcard' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR')) { H.again.click(); return; }
      if (mode === 'results' && (e.code === 'Enter' || e.code === 'Space')) { begin(run ? run.kind : 'campaign', 1); return; }
      if (mode === 'ending' && e.code === 'Escape') { finishEnding(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); return; }
      if (mode === 'play' && e.code === 'KeyR' && !e.repeat) { restartEncounter(); return; }
      if (e.repeat) return;
      input.keys.add(e.code);
      if (/^(Key[WASD]|Arrow)/.test(e.code)) usedTouch = false;
    });
    ctx.listen(window, 'keyup', e => input.keys.delete(e.code));
    const dropInputs = () => { input.keys.clear(); input.stick = null; input.dial = null; roles.clear(); H.stick.style.display = 'none'; };
    ctx.listen(window, 'blur', () => { dropInputs(); if (mode === 'play') pauseGame(); });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) { dropInputs(); if (mode === 'play') pauseGame(); audio.suspend(); } else audio.resume(); });

    // ---------- panels ----------
    function pauseGame() { if (mode !== 'play') return; mode = 'paused'; dropInputs(); H.pauseSub.textContent = run.E ? `${roman(run.E.id)} · ${run.E.name}` : ''; H.showOnly(H.pausePanel); }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; H.showOnly(null); }
    const click = (b, fn) => ctx.listen(b, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    click(H.begin, () => begin('campaign', 1));
    click(H.cont, () => begin('campaign', ENCOUNTERS.find(q => q.act === continueAct()).id));
    click(H.endless, () => { if (save.completed) begin('endless', 1); });
    click(H.toSet, () => { settingsFrom = 'title'; renderSettings(); H.showOnly(H.set); });
    click(H.resume, resumeGame);
    click(H.restart, () => { H.showOnly(null); restartEncounter(); });
    click(H.pSet, () => { settingsFrom = 'pause'; renderSettings(); H.showOnly(H.set); });
    click(H.quit, () => { mode = 'play'; endRun('quit'); });
    click(H.again, () => { if (run.kind === 'endless') endRun('captured'); else { V.ink(0); H.showOnly(null); restartEncounter(); } });
    click(H.capEnd, () => { V.ink(0); endRun('captured'); });
    click(H.resAgain, () => begin(run && run.kind === 'endless' ? 'endless' : 'campaign', 1));
    click(H.resEndless, () => { if (save.completed) begin('endless', 1); });
    click(H.resTitle, showTitle);
    click(H.skip, () => { if (mode === 'ending') finishEnding(); });
    ctx.listen(H.act, 'pointerdown', e => { e.stopPropagation(); audio.unlock(); if (mode === 'card' && mt > 0.4) enterPlay(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    let settingsFrom = 'title';
    function renderSettings() {
      const s = save.settings;
      const tog = (k, label) => `<div class="wb-set"><span>${label}</span><button class="wb-tog ${s[k] ? 'on' : ''}" data-t="${k}">${s[k] ? 'ON' : 'OFF'}</button></div>`;
      H.setList.innerHTML =
        `<div class="wb-set"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></div>` +
        `<div class="wb-set"><span>Dial sensitivity</span><input type="range" min="0.5" max="2" step="0.1" value="${s.dial}" data-k="dial"></div>` +
        tog('swap', 'Walk on the right, turn on the left') + tog('calm', 'Steadier linework') + tog('hints', 'Hints');
    }
    click(H.setBack, () => { if (settingsFrom === 'pause') H.showOnly(H.pausePanel); else showTitle(); });
    ctx.listen(H.setList, 'click', e => { const t = e.target; if (t.dataset && t.dataset.t) { save.settings[t.dataset.t] = !save.settings[t.dataset.t]; persist(); renderSettings(); } });
    ctx.listen(H.setList, 'input', e => { const t = e.target; if (t.dataset && t.dataset.k) { save.settings[t.dataset.k] = +t.value; if (t.dataset.k === 'volume') audio.setVolume(+t.value); persist(); } });

    // ---------- layout ----------
    function layout(w, h, safe) {
      const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
      layoutBand = clamp(150 / h, 0.17, 0.26);
      const band = bandPx();
      H.top.style.paddingTop = (16 + top) + 'px';
      H.hint.style.bottom = (band + bot + 8) + 'px';
      const dw = Math.min(200, w * 0.42);
      Object.assign(H.dial.style, save.settings.swap ? { left: '16px', right: 'auto' } : { right: '16px', left: 'auto' });
      Object.assign(H.dial.style, { width: dw + 'px', bottom: (bot + band * 0.5 - 28) + 'px' });
      Object.assign(H.dialLab.style, save.settings.swap ? { left: '16px', right: 'auto' } : { right: '16px', left: 'auto' });
      Object.assign(H.dialLab.style, { width: dw + 'px', bottom: (bot + band * 0.5 - 52) + 'px' });
      Object.assign(H.stickLab.style, save.settings.swap ? { right: '16px', left: 'auto' } : { left: '16px', right: 'auto' });
      Object.assign(H.stickLab.style, { width: dw + 'px', bottom: (bot + band * 0.5 - 52) + 'px' });
      H.titleText.style.top = (top + h * 0.06) + 'px';
      H.end.style.top = (top + h * 0.12) + 'px';
      for (const p of H.panels) p.style.paddingBottom = (bot + 16) + 'px';
      renderer.setSize(w, h, false);
      V.layout(w, h, safe, mode === 'title' ? 0.32 : layoutBand + bot / h, frameR());
    }
    ctx.onResize(({ width, height, safeArea }) => layout(width, height, safeArea || ctx.safeArea), { immediate: true });

    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));
    showTitle();
    try { V.update(S, 0.016, {}); V.render(); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__WTB_DEV) {
      window.botPolicy = botPolicy;
      window.__wtb = {
        begin, showTitle, startEncounter, restartEncounter, pauseGame, resumeGame, endRun,
        get S() { return S; }, get mode() { return mode; }, get run() { return run; }, save: () => save, V, input, H,
        goto(id) { if (!run) newRun('campaign', id); startEncounter(encounterById(id), false); },
        advance(sec, inp) { const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) { if (inp) { S.step(Object.assign({}, inp)); run.encT += DT; handleEvents(S.events); if (S.over) { capture(); break; } if (S.reached) { clearEncounter(); break; } } else step(); } V.update(S, DT, {}); V.render(); },
        frame(dt) { tick((dt || DT) * 1000); },
        screenOf(name) { const e = S.eye(name); return e ? V.toScreen(...S.eyePos(e)) : null; },
        playerScreen() { return V.toScreen(...S.playerPos()); },
        relayout: () => layout(ctx.width, ctx.height, ctx.safeArea),
        // one game step with a given input, through the full game path (events, scoring, transitions)
        glInfo: () => ({ textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, calls: renderer.info.render.calls }),
        stepGame(inp) { if (mode !== 'play') return false; input.override = inp; step(); input.override = null; return true; },
      };
    }
  }
};
