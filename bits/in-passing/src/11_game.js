// ---------------------------------------------------------------------------
// The game: menu (the ledger), the run, the fall, the delivery, the receipt.
// ---------------------------------------------------------------------------

const BIT = {
  meta: {
    title: 'In Passing',
    runtime: 'plethora-bit@2',
    tags: ['arcade', 'platformer', 'timing', 'atmospheric'],
    permissions: ['audio', 'haptics', 'storage']
  },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });
    const areaNow = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
    const todayKey = () => new Date().toISOString().slice(0, 10);
    const haptic = k => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) { /* haptics are best-effort */ } };
    const storeGet = k => { try { return ctx.storage ? ctx.storage.get(k) : null; } catch (e) { return null; } };
    const storeSet = (k, v) => { try { if (ctx.storage) ctx.storage.set(k, v); } catch (e) { /* device cache only */ } };

    const audio = createAudio();
    ctx.onDestroy(() => audio.dispose());

    // ---- state -----------------------------------------------------------------
    const S = {
      mode: 'loading', index: 0, daily: false, W: null, view: null, spec: null, p: null, t: 0, runT: 0,
      held: false, pressed: false, pointers: new Set(), flow: 0, passage: 0, bestPassage: 0, waited: 0, falls: 0,
      letters: [], fallT: 0, deliverT: 0, region: 0, pending: null, attempt: 0, cam: { x: 0, y: 0, vx: 0, vy: 0, init: false },
      hint: null, hintsSeen: Object.assign({}, storeGet('hints') || {}), everJumped: false, everGrabbed: false, lastFrame: 0, prevMode: 'play'
    };
    const ledgerDefault = () => ({ v: 1, unlocked: 0, r: {}, daily: null });
    let ledger = ledgerDefault();
    let cloudOk = false;      // only write cloud memory after a successful read
    let saveChain = Promise.resolve();

    // ---- UI ---------------------------------------------------------------------
    const ui = createUI(ctx, {
      start: () => tryStart(),
      prev: () => { if (S.mode === 'menu' && S.index > 0) selectRoute(S.index - 1); },
      next: () => { if (S.mode === 'menu' && S.index < 11) selectRoute(S.index + 1); },
      journey: () => { if (S.mode === 'menu' && S.daily) { S.daily = false; selectRoute(S.index); } },
      daily: () => { if (S.mode === 'menu' && !S.daily) { S.daily = true; selectDaily(); } },
      sound: () => { audio.unlock(); const m = !audio.isMuted(); audio.setMuted(m); ui.setMuted(m); storeSet('muted', m); },
      pause: () => pause(true),
      resume: () => pause(false),
      restart: () => { ui.showPause(false); S.mode = 'menu'; tryStart(); },
      ledger: () => toMenu(),
      again: () => { ui.hideResults(); S.mode = 'menu'; tryStart(); },
      nextRoute: () => { ui.hideResults(); S.mode = 'menu'; selectRoute(S.index + 1); tryStart(); }
    });
    ui.layout(areaNow());
    const muted0 = !!storeGet('muted');
    audio.setMuted(muted0); ui.setMuted(muted0);

    // fonts: helpful, never blocking
    const fontLoads = [
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }],
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'normal' }],
      ['Inter', 'inter', { weight: '400', style: 'normal' }],
      ['Inter', 'inter', { weight: '600', style: 'normal' }]
    ].map(([fam, name, o]) => { try { return ctx.loadFont(fam, name, '1.0.0', o).catch(() => null); } catch (e) { return Promise.resolve(null); } });
    void fontLoads;

    // ---- three -----------------------------------------------------------------
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); }
    catch (e) {
      ctx.platform.error({ stage: 'dependency', message: String(e && e.message || e) });
      ui.loadError('the world could not be loaded — please try again');
      ctx.platform.ready();
      return;
    }
    if (disposed) return;
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
    let stage;
    let dpr = Math.min(ctx.dpr || 1, 2);
    try { stage = createStage(THREE, canvas, 1); }
    catch (e) {
      ctx.platform.error({ stage: 'renderer', message: String(e && e.message || e) });
      ui.loadError('this device could not start the renderer');
      ctx.platform.ready();
      return;
    }
    ctx.onDestroy(() => { try { stage.renderer.dispose(); } catch (e) { /* already gone */ } });
    fitStage(stage, ctx.width, ctx.height, dpr);
    ctx.onResize(() => { fitStage(stage, ctx.width, ctx.height, dpr); ui.layout(areaNow()); S.cam.init = false; }, { immediate: false });

    let courier = null;
    const particles = buildParticles(stage, 90);
    stage.scene.add(particles.group);

    // ---- persistence -------------------------------------------------------------
    const validLedger = v => v && v.v === 1 && typeof v.unlocked === 'number' && v.r && typeof v.r === 'object';
    const cached = storeGet('ledger');
    if (validLedger(cached)) ledger = cached;
    if (window.__IP_UNLOCK) ledger.unlocked = 11;
    const mem = (() => { try { return ctx.memory && ctx.memory.local ? ctx.memory.local('ledger') : null; } catch (e) { return null; } })();
    if (mem) {
      mem.get().then(res => {
        if (disposed) return;
        if (res && validLedger(res.value)) { ledger = mergeLedger(ledger, res.value); }
        cloudOk = true;
        if (S.mode === 'menu') refreshMenu();
      }).catch(() => { cloudOk = false; });
    }
    function mergeLedger(a, b) {
      const out = { v: 1, unlocked: Math.max(a.unlocked, b.unlocked), r: {}, daily: null };
      for (const k of new Set([...Object.keys(a.r), ...Object.keys(b.r)])) {
        const x = a.r[k] || {}, y = b.r[k] || {};
        const best = x.best == null ? y.best : y.best == null ? x.best : Math.min(x.best, y.best);
        const L = []; for (let i = 0; i < 3; i++) L.push((x.letters && x.letters[i]) || (y.letters && y.letters[i]) ? 1 : 0);
        out.r[k] = { best, brisk: !!(x.brisk || y.brisk), letters: L };
      }
      const da = a.daily, db = b.daily;
      if (da && db && da.date === db.date) out.daily = { date: da.date, best: Math.min(da.best, db.best) };
      else out.daily = (da && da.date === todayKey()) ? da : (db && db.date === todayKey()) ? db : null;
      return out;
    }
    function saveLedger() {
      storeSet('ledger', ledger);
      if (!mem || !cloudOk) return;
      const snapshot = JSON.parse(JSON.stringify(ledger));
      saveChain = saveChain.then(() => mem.set(snapshot)).catch(e => { ctx.platform.emit && ctx.platform.emit('ledger_save_failed', { code: String(e && e.code || '') }); });
    }

    // ---- routes ------------------------------------------------------------------
    function regionForSpec(spec) {
      if (!spec.daily) return spec.region;
      const d = new Date(spec.dateKey + 'T00:00:00Z');
      return Math.floor(d.getTime() / 86400000) % 4;
    }
    function installRoute(W, spec) {
      if (S.view) { S.view.dispose(); S.view = null; }
      if (courier) { stage.scene.remove(courier.root); stage.scene.remove(courier.scarf); courier.dispose(); }
      S.W = W; S.spec = spec;
      S.region = regionForSpec(spec);
      S.view = buildWorldView(stage, W, S.region);
      courier = buildCourier(stage, PALETTES[S.region]);
      stage.scene.add(courier.root); stage.scene.add(courier.scarf);
      audio.setRegion(S.region);
      S.t = 3.1;
      S.p = makePlayer(W.start, 2.0, S.t);
      S.cam.init = false;
      particles.clear();
    }
    function selectRoute(i) {
      S.index = clamp(i, 0, 11); S.daily = false; S.pending = null;
      const spec = ROUTES[S.index];
      const W = buildRoute(spec, { plan: ROUTE_PLANS[S.index] });
      installRoute(W, spec);
      refreshMenu();
    }
    function selectDaily() {
      const spec = dailyRouteSpec(todayKey());
      if (S.dailyW && S.dailyW.spec.dateKey === spec.dateKey) { installRoute(S.dailyW, spec); refreshMenu(); return; }
      S.pending = { it: buildRouteSteps(spec, {}), spec };
      refreshMenu();
    }
    function stepPending(budgetMs) {
      const t0 = performance.now();
      while (S.pending && performance.now() - t0 < budgetMs) {
        const r = S.pending.it.next();
        if (r.done) {
          const spec = S.pending.spec; S.pending = null;
          S.dailyW = r.value;
          if (S.daily && S.mode === 'menu') { installRoute(r.value, spec); refreshMenu(); }
        }
      }
    }
    function refreshMenu() {
      const rec = ledger.r[S.index] || null;
      const d = ledger.daily && ledger.daily.date === todayKey() ? ledger.daily.best : null;
      const dt = new Date();
      ui.menuState({
        daily: S.daily, index: S.index, route: S.W, rec, letterCount: S.W ? S.W.letters.length : 0,
        locked: !S.daily && S.index > ledger.unlocked, preparing: !!S.pending,
        dailyBest: d, dateLabel: dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      });
    }

    // ---- run lifecycle ------------------------------------------------------------
    let transitioning = false;
    async function tryStart() {
      if (transitioning || !S.W) return;
      if (S.mode !== 'menu') return;
      if (S.pending || (!S.daily && S.index > ledger.unlocked)) { haptic('warning'); return; }
      audio.unlock();
      transitioning = true;
      S.attempt++;
      try { ctx.platform.start({ route: S.daily ? 'daily' : S.index + 1 }); } catch (e) { /* analytics only */ }
      let tr = null;
      try { tr = ctx.fx && ctx.fx.transition ? ctx.fx.transition({ kind: 'fade', color: PALETTES[S.region].haze, outMs: 220, inMs: 380 }) : null; } catch (e) { tr = null; }
      if (tr) await tr.cover();
      if (disposed) return;
      ui.hideMenu(); ui.hideResults(); ui.showPause(false);
      S.t = 0; S.runT = 0;
      S.p = makePlayer(S.W.start, S.W.start.len - 2.2, 0);
      S.flow = 0; S.passage = 0; S.bestPassage = 0; S.waited = 0; S.falls = 0;
      S.letters = S.W.letters.map(() => false);
      S.view.letters.forEach(l => { l.taken = false; l.fade = 0; l.m.visible = true; l.m.material.opacity = 1; l.m.scale.setScalar(1); });
      S.held = false; S.pressed = false; S.pointers.clear();
      S.cam.init = false; courier.resetScarf(); particles.clear();
      ui.showHUD(S.spec, S.W.letters.length);
      S.mode = 'play';
      if (tr) await tr.reveal();
      transitioning = false;
    }
    function toMenu() {
      ui.showPause(false); ui.hideResults(); ui.hideHUD(); ui.hint(null);
      S.mode = 'menu';
      if (S.daily) selectDaily(); else selectRoute(Math.min(S.index, 11));
      ui.showMenu({});
      refreshMenu();
    }
    function pause(on) {
      if (on && S.mode === 'play') { S.prevMode = 'play'; S.mode = 'paused'; ui.showPause(true); ui.hint(null); audio.suspend(); }
      else if (!on && S.mode === 'paused') { S.mode = S.prevMode; ui.showPause(false); audio.resume(); S.held = false; S.pointers.clear(); }
    }

    function deliver() {
      S.mode = 'delivered';
      S.deliverT = S.t;
      const ms = Math.round(S.runT * 1000);
      audio.play('deliver'); haptic('success');
      particles.emit(S.p.x, S.p.y + 0.8, { count: 26, color: PALETTES[S.region].yellow, speed: 3, life: 1.2, size: 0.12, grow: 0.05, gravity: 2, alpha: 0.9 });
      const letterCount = S.W.letters.length, found = S.letters.filter(Boolean).length;
      const brisk = !S.daily && ms <= S.W.brisk * 1000;
      let best = null, newBest = false;
      if (S.daily) {
        const prev = ledger.daily && ledger.daily.date === S.spec.dateKey ? ledger.daily.best : null;
        newBest = prev == null || ms < prev;
        best = newBest ? ms : prev;
        ledger.daily = { date: S.spec.dateKey, best };
      } else {
        const rec = ledger.r[S.index] || { best: null, brisk: false, letters: [0, 0, 0] };
        newBest = rec.best == null || ms < rec.best;
        rec.best = newBest ? ms : rec.best; best = rec.best;
        rec.brisk = rec.brisk || brisk;
        rec.letters = [0, 1, 2].map(i => (rec.letters && rec.letters[i]) || S.letters[i] ? 1 : 0);
        ledger.r[S.index] = rec;
        const firstTime = ledger.unlocked <= S.index;
        ledger.unlocked = Math.max(ledger.unlocked, Math.min(11, S.index + 1));
        S.firstDelivery = firstTime;
      }
      saveLedger();
      try { ctx.platform.complete({ route: S.daily ? 'daily' : S.index + 1, ms, letters: found, falls: S.falls }); } catch (e) { /* analytics only */ }
      const label = S.daily ? 'Today’s errand' : 'Route ' + NUMERALS[S.index] + ' · ' + REGIONS[S.spec.region].name;
      const attempt = S.attempt;
      ctx.timeout(() => {
        if (disposed || S.attempt !== attempt || S.mode !== 'delivered') return;
        ui.hint(null);
        ui.showResults({
          label, to: S.spec.to, ms, best, newBest, brisk, briskMs: S.daily ? 0 : S.W.brisk * 1000,
          letters: found, letterCount, passage: S.bestPassage, waited: Math.round(S.waited * 1000), falls: S.falls,
          nextOk: !S.daily && S.index < 11 && ledger.unlocked >= S.index + 1
        });
        if (S.daily) postDaily(ms, attempt);
        if (S.daily || S.firstDelivery) { try { ctx.pulse && ctx.pulse.complete({ timeMs: ms, timeLabel: fmtTime(ms), level: S.daily ? undefined : S.index + 1, mode: S.daily ? 'daily' : 'journey', text: 'Delivered ' + label.toLowerCase() + ' in ' + fmtTime(ms) }); } catch (e) { /* optional */ } }
      }, 1700);
    }

    function postDaily(ms, attempt) {
      let rec;
      try { rec = ctx.memory && ctx.memory.record ? ctx.memory.record('daily_errand') : null; } catch (e) { rec = null; }
      if (!rec) return;
      ui.board({ loading: true });
      rec.submit(ms, { label: fmtTime(ms), metadata: { edition: S.spec.dateKey } })
        .then(() => rec.leaderboard({ scope: 'global', period: 'daily', limit: 3 }))
        .then(lb => {
          if (disposed || attempt !== S.attempt) return;
          const rows = (lb.rows || []).map((r, i) => ({ rank: r.rank || i + 1, name: r.username || r.displayName || r.name || (r.user && r.user.username) || '', value: r.value }));
          const vr = lb.viewerRank;
          ui.board({ rows, rank: vr ? vr.rank : null, total: lb.totalRanked });
        })
        .catch(() => { if (!disposed && attempt === S.attempt) ui.board({ error: true }); });
    }

    // ---- input ------------------------------------------------------------------
    function press() {
      audio.unlock();
      if (S.mode === 'menu') { tryStart(); return; }
      if (S.mode === 'play') { S.pressed = true; try { ctx.platform.interact({ kind: 'press' }); } catch (e) { /* analytics */ } }
    }
    ctx.listen(canvas, 'pointerdown', e => {
      e.preventDefault();
      S.pointers.add(e.pointerId);
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* not all pointers capture */ }
      S.held = true;
      press();
    });
    const up = e => { S.pointers.delete(e.pointerId); S.held = S.pointers.size > 0; };
    ctx.listen(canvas, 'pointerup', up);
    ctx.listen(canvas, 'pointercancel', up);
    ctx.listen(canvas, 'lostpointercapture', up);
    ctx.listen(window, 'keydown', e => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { e.preventDefault(); S.keyHeld = true; S.held = true; press(); }
      if (e.code === 'Escape' || e.code === 'KeyP') pause(S.mode === 'play');
    });
    ctx.listen(window, 'keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { S.keyHeld = false; S.held = S.pointers.size > 0; } });

    // ---- simulation step ----------------------------------------------------------
    const PROBE = { x: 0, y: 0, a: 0 };
    function fixedStep(stepMs) {
      if (S.pending) stepPending(4);
      if (!S.W || S.mode === 'paused' || S.mode === 'loading') return;
      const dt = stepMs / 1000;
      S.t += dt;
      const p = S.p;
      const live = S.mode === 'play';
      if (S.auto && live) S.auto(S, dt);
      const pressed = live && S.pressed; S.pressed = false;
      if (p.mode === 'fall') {
        S.fallT += dt;
        p.vx *= 0.97; p.vy += (-1.6 - p.vy) * Math.min(1, dt * 4);
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (S.fallT > 1.5) {
          respawnPlayer(p, S.t);
          courier.resetScarf();
          particles.emit(p.x, p.y + 0.4, { count: 10, color: '#ffffff', speed: 1.2, life: 0.6, size: 0.25, grow: 0.7, alpha: 0.6 });
          audio.play('umbrella');
        }
      } else {
        playerStep(p, S.W, S.t, dt, live && S.held, pressed);
      }
      if (live) S.runT += dt;
      // events
      for (const ev of p.ev) handleEvent(ev, p);
      p.ev.length = 0;
      // waiting breaks the passage; flow ebbs
      if (p.mode === 'ground' && p.atLip) {
        if (p.waitT > 0.9) S.flow = Math.max(0, S.flow - dt * 0.45);
        if (p.waitT > 1.4) S.passage = 0;
        if (live) S.waited += dt;
      } else S.flow = Math.max(0, S.flow - dt * 0.03);
      // lost letters
      if (live) {
        for (let i = 0; i < S.W.letters.length; i++) {
          if (S.letters[i]) continue;
          const L = S.W.letters[i];
          if (Math.hypot(L.x - p.x, L.y - (p.y + 0.55)) < 0.95) {
            S.letters[i] = true;
            const lv = S.view.letters[i]; lv.taken = true;
            audio.play('letter'); haptic('light'); ui.letter(i);
            particles.emit(L.x, L.y, { count: 14, color: PALETTES[S.region].yellow, speed: 2.2, life: 0.9, size: 0.1, grow: 0.04, alpha: 0.95 });
            try { ctx.platform.milestone('lost_letter', { route: S.daily ? 'daily' : S.index + 1 }); } catch (e) { /* analytics */ }
          }
        }
      }
    }

    function sfxPan(x) { return clamp((x - S.cam.x) / 9, -1, 1); }
    function handleEvent(ev, p) {
      const P = PALETTES[S.region];
      const live = S.mode === 'play';
      switch (ev.type) {
        case 'jump':
          if (live) { audio.play('jump', { pan: sfxPan(p.x) }); S.everJumped = true; }
          courier.squash = -0.1; courier.squashV = -2;
          if (ev.waited > 1.4) S.passage = 0;
          break;
        case 'land': {
          const mat = ev.surf.mat;
          const imp = ev.impact;
          audio.play('land', { mat, impact: imp, pan: sfxPan(p.x), deg: (S.passage % 5) });
          courier.squash = clamp(imp * 0.025, 0.05, 0.25); courier.squashV = 0;
          particles.emit(p.x, p.y + 0.05, { count: Math.round(clamp(imp, 2, 9)), color: mat === 'wood' ? P.woodLight : P.stoneLight, speed: 1.4, angle: Math.PI / 2, spread: 2.6, life: 0.5, size: 0.14, grow: 0.42, alpha: 0.6, jx: 0.3 });
          if (imp > 7) haptic('light');
          if (ev.from && ev.surf.sys !== ev.from.sys && live) { S.passage++; S.bestPassage = Math.max(S.bestPassage, S.passage); S.flow = Math.min(1, S.flow + 0.2); }
          if (ev.surf.sys.kind === 'skiff') particles.emit(p.x, p.y - 0.5, { count: 8, color: P.waterLight, speed: 2, angle: Math.PI / 2, spread: 1.6, gravity: 8, life: 0.6, size: 0.1, grow: 0.12, alpha: 0.8 });
          if (live && !S.hintsSeen.leap && ev.surf.sys.kind !== 'pier') markHint('leap');
          break;
        }
        case 'grab':
          audio.play('grab', { pan: sfxPan(p.x) }); haptic('light');
          if (live) { S.passage++; S.bestPassage = Math.max(S.bestPassage, S.passage); S.flow = Math.min(1, S.flow + 0.2); S.everGrabbed = true; markHint('hold'); }
          particles.emit(p.x, p.y + 1.0, { count: 6, color: P.coral, speed: 1, life: 0.35, size: 0.08, grow: 0.25, alpha: 0.8 });
          break;
        case 'release':
          audio.play('release', { pan: sfxPan(p.x) });
          if (live) markHint('release');
          break;
        case 'launch':
          if (live && ev.surf.sys.kind === 'bellows') markHint('puff');
          break;
        case 'fall':
          S.fallT = 0; S.flow = 0; S.passage = 0;
          if (live) { S.falls++; audio.play('fall', { pan: sfxPan(p.x) }); haptic('warning'); }
          p.vy = Math.max(p.vy, -6);
          ctx.timeout(() => { if (!disposed && S.p === p && p.mode === 'fall') audio.play('umbrella'); }, 150);
          if (live && !S.hintsSeen.fall) { showHintOnce('fall', 'the city always catches you', 2600); }
          break;
        case 'goal':
          if (live) deliver();
          break;
        default: break;
      }
    }

    // ---- hints: a few words, once, only where the world can't say it alone ----------
    function markHint(k) { if (!S.hintsSeen[k]) { S.hintsSeen[k] = 1; storeSet('hints', S.hintsSeen); } if (S.hint && S.hint.key === k) S.hint = null; }
    function showHintOnce(key, text, ms) { S.hint = { key, text, until: S.t + ms / 1000 }; S.hintsSeen[key] = 1; storeSet('hints', S.hintsSeen); }
    function updateHints() {
      if (S.mode !== 'play') { ui.hint(null); return; }
      const p = S.p, seen = S.hintsSeen;
      let want = null;
      if (S.hint && S.hint.until && S.t > S.hint.until) S.hint = null;
      if (S.hint && S.hint.key === 'fall') want = S.hint.text;
      else if (!seen.leap && p.mode === 'ground' && p.atLip && p.waitT > 1.2) want = 'touch anywhere to leap';
      else if (!seen.hold && p.mode !== 'hang') {
        for (const h of S.W.handlesNear(p.x + 4)) { if (h.pos(S.t, PROBE) && PROBE.x > p.x - 1 && PROBE.x - p.x < 6) { want = 'press and keep holding to catch the ring'; break; } }
      } else if (!seen.release && p.mode === 'hang') want = 'let go to fly';
      else if (!seen.puff && p.mode === 'ground' && p.surf.sys.kind === 'bellows') want = 'it breathes in… leap as it breathes out';
      if (want) {
        const v = new THREE.Vector3(p.x, p.y + 1.9, 0.4).project(stage.camera);
        ui.hint(want, (v.x + 1) / 2 * ctx.width, (1 - v.y) / 2 * ctx.height);
      } else ui.hint(null);
    }

    // ---- world voices -----------------------------------------------------------------
    function worldSounds() {
      const t = S.t;
      for (const v of S.view.sysViews) {
        const sys = v.sys, dx = v.cx - S.cam.x;
        if (Math.abs(dx) > v.reach + 14 || sys.kind === 'pier') continue;
        const vol = clamp(1 - (Math.abs(dx) - v.reach * 0.5) / 18, 0, 1) * 0.85;
        const pan = clamp(dx / 12, -1, 1);
        const st = v.snd || (v.snd = { init: false });
        switch (sys.kind) {
          case 'skiff': { const u = sys.state(t).u; if (st.init && ((st.u > 0.002 && u <= 0.002) || (st.u < 0.998 && u >= 0.998))) audio.play('dock', { vol, pan }); st.u = u; break; }
          case 'lift': {
            const s2 = sys.state(t); const u = s2.u;
            if (st.init && ((st.u > 0.001 && u <= 0.001) || (st.u < 0.999 && u >= 0.999))) audio.play('liftBell', { vol, pan, deg: u > 0.5 ? 4 : 2 });
            if (st.init && Math.abs(u - st.u) > 0.0004) { st.r = (st.r || 0) + Math.abs(u - st.u) * 30; if (st.r > 1) { st.r = 0; audio.play('ratchet', { vol: vol * 0.7, pan }); } }
            st.u = u; break;
          }
          case 'bellows': {
            const ph = sys.state(t).phase;
            if (st.init && ph !== st.ph) {
              const pp = sys.params;
              if (ph === 'breathe') audio.play('inhale', { vol, pan, dur: pp.period - pp.puffT - pp.holdTop - pp.holdLow });
              if (ph === 'top') {
                audio.play('puff', { vol, pan });
                const P = PALETTES[S.region];
                particles.emit(pp.x + pp.len / 2, pp.top - 0.2, { count: 12, color: P.cloth, speed: 2.6, angle: Math.PI / 2, spread: 2.2, life: 0.8, size: 0.2, grow: 0.6, alpha: 0.5, jx: 1.6 });
                particles.emit(pp.x + pp.len / 2, pp.top, { count: 3, color: P.coral, speed: 3.5, angle: Math.PI / 2, spread: 1.2, gravity: 3, life: 1.4, size: 0.06, grow: 0.06, alpha: 0.9 });
              }
            }
            st.ph = ph; break;
          }
          case 'wheel': {
            const a = sys.angleAt(t), n = sys.params.n;
            const k = Math.floor(-a * n / TAU + 0.25);
            if (st.init && k !== st.k) audio.play('tok', { vol: vol * 0.8, pan, deg: ((k % 5) + 5) % 5 });
            st.k = k; break;
          }
          case 'swing': {
            const th = sys.angleAt(t);
            if (st.init && Math.sign(th) !== Math.sign(st.th)) audio.play('swoosh', { vol, pan });
            st.th = th; break;
          }
          case 'trolley': {
            const c = sys.paramAt(t, 0) / sys.loop, n = sys.params.n;
            const k = Math.floor(c * n);
            if (st.init && k !== st.k) audio.play('trolley', { vol, pan });
            st.k = k; break;
          }
          case 'strider': case 'walker': {
            const s2 = sys.state(t);
            const k = Math.floor(s2.stepPh);
            if (st.init && k !== st.k && s2.moving) audio.play('stride', { vol: vol * (sys.kind === 'walker' ? 1 : 0.7), pan });
            if (st.init && Math.random() < 0.0015) audio.play('call', { vol: vol * 0.6, pan });
            st.k = k; break;
          }
          default: break;
        }
        st.init = true;
      }
    }

    // ---- camera -----------------------------------------------------------------------
    const smoothDampV = (cur, target, vel, smoothTime, dt) => {
      const omega = 2 / smoothTime, x = omega * dt;
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = cur - target;
      const temp = (vel + omega * change) * dt;
      const nv = (vel - omega * temp) * exp;
      return [target + (change + temp) * exp, nv];
    };
    function cameraUpdate(dt) {
      const p = S.p, cam = S.cam;
      const vx = p.mode === 'ground' ? p.gvx : p.mode === 'hang' ? p.hvx : p.vx;
      if (p.mode === 'ground') cam.ref = p.y;
      if (cam.ref == null) cam.ref = p.y;
      const refY = p.mode === 'ground' ? p.y : clamp(p.y, cam.ref - 1.2, cam.ref + 2.5) + (p.y < cam.ref - 1.2 ? (p.y - cam.ref + 1.2) * 0.8 : 0) + (p.y > cam.ref + 2.5 ? (p.y - cam.ref - 2.5) * 0.6 : 0);
      // look a little ahead, and towards the height of what's coming
      let aheadY = refY;
      for (const m of S.W.modules) if (m.x0 > p.x + 1) { aheadY = m.pierB ? m.pierB.params.y : m.y; break; }
      const tx = p.x + stage.viewW * 0.17 + clamp(vx * 0.3, -1.5, 2.2);
      const ty = lerp(refY, aheadY, 0.25) + stage.viewH * 0.06;
      if (!cam.init) { cam.x = tx; cam.y = ty; cam.vx = cam.vy = 0; cam.init = true; }
      [cam.x, cam.vx] = smoothDampV(cam.x, tx, cam.vx, p.mode === 'fall' ? 0.9 : 0.42, dt);
      [cam.y, cam.vy] = smoothDampV(cam.y, ty, cam.vy, 0.6, dt);
      stage.camera.position.set(cam.x, cam.y, stage.dist);
      stage.camera.rotation.z = Math.sin(S.t * 0.13) * 0.002;
    }

    // ---- rendering --------------------------------------------------------------------------
    let readySent = false, slowFrames = 0, hudTick = 0;
    function renderFrame() {
      const now = performance.now();
      const dt = S.lastFrame ? Math.min(0.1, (now - S.lastFrame) / 1000) : 1 / 60;
      S.lastFrame = now;
      if (!S.W || !S.view) return;
      cameraUpdate(dt);
      S.view.update(S.t, S.cam.x, S.cam.y, stage.viewH);
      // the courier watches what is coming
      let lookY = 0;
      const p = S.p;
      if (p.mode === 'ground' && p.atLip) {
        let best = 1e9;
        for (const sf of S.W.surfacesNear(p.x + 3)) { if (sf === p.surf || sf.isStatic) continue; sf.pose(S.t, PROBE); const d = Math.abs(PROBE.x - p.x); if (PROBE.x > p.x - 1 && d < best && d < 8) { best = d; lookY = (PROBE.y - p.y) / 4; } }
      }
      courier.update(p, dt, S.t, { flow: S.flow, lookY });
      particles.update(dt);
      // the sun slides lower as a delivery takes longer
      const sp = stage.skyMat.uniforms.sunPos.value;
      sp.y = 0.66 - Math.min(0.28, (S.mode === 'menu' ? 0 : S.runT) / 420);
      audio.setFlow(S.flow);
      audio.tick(dt, { high: p.y > 8 });
      if (S.mode !== 'paused') worldSounds();
      if ((hudTick += dt) > 0.1 && (S.mode === 'play' || S.mode === 'delivered')) { hudTick = 0; ui.progress(clamp((p.x - S.W.start.xmin) / (S.W.finalX - S.W.start.xmin), 0, 1)); updateHints(); }
      stage.renderer.render(stage.scene, stage.camera);
      if (window.__IP_INFO) window.__IP_INFO = { calls: stage.renderer.info.render.calls, tris: stage.renderer.info.render.triangles, tex: stage.renderer.info.memory.textures };
      if (!readySent) { readySent = true; ui.loaded(); ctx.platform.ready(); }
      // keep the frame rate smooth on slower phones
      if (dt > 0.026) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 90 && dpr > 1) { dpr = Math.max(1, dpr - 0.35); fitStage(stage, ctx.width, ctx.height, dpr); slowFrames = 0; }
    }

    // ---- go -------------------------------------------------------------------------------
    S.mode = 'menu';
    selectRoute(Math.min(ledger.unlocked, 11));
    ui.showMenu({});
    refreshMenu();
    ctx.game.loop({
      fixedHz: 120, maxDeltaMs: 100, maxSubsteps: 12,
      fixedUpdate: stepMs => fixedStep(stepMs),
      render: () => renderFrame(),
      onPause: () => { pause(true); audio.suspend(); },
      onResume: () => { if (S.mode !== 'paused') audio.resume(); }
    });
    window.__IP = S; // handy for tests; harmless in production
  }
};
