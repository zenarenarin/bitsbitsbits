// =====================================================================
// The game shell: Plethora lifecycle, boot diagnostics, the fixed-step
// loop, respawning, and wiring between simulation, rig, camera and HUD.
//
// Plethora APIs used here are the ones both existing bits use the same
// way (createCanvas, createRoot, listen, onResize, onDestroy, onFrame /
// game.loop, importModule, platform.ready/start/error/haptic).
// Score submission is deliberately absent: the two existing bits submit
// scores through different APIs, and neither can be verified here.
// =====================================================================

const SIM_DT = 1 / 60;

window.plethoraBit = {
  meta: { title: 'The Last Signal', runtime: 'plethora-bit@2', tags: ['3d', 'platformer', 'adventure'], permissions: ['haptics'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(#7f8d9b,#e3c39b 60%,#1d1a19)';
    const hud = createHud(ctx);
    hud.setPlay(false);
    hud.card('start');
    hud.H.go.disabled = true; hud.H.go.textContent = 'LOADING…';
    try { if (ctx.markVisualReady) ctx.markVisualReady('title'); } catch (e) { }

    let readySent = false;
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      hud.H.startText.textContent = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      hud.H.go.style.display = 'none';
      if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } }
    }
    ctx.onDestroy(() => { destroyed = true; });
    // the 3D library: a failed download offers one user-triggered retry at a time
    let THREE = null, loading = null;
    const loadThree = () => loading || (loading = ctx.importModule('three', '0.164.1').finally(() => { loading = null; }));
    try { THREE = await loadThree(); } catch (e) {
      bootFail('library', e);
      hud.H.retry.style.display = '';
      THREE = await new Promise(res => {
        ctx.listen(hud.H.retry, 'click', async ev => {
          ev.stopPropagation(); if (loading || destroyed) return;
          hud.H.retry.textContent = 'LOADING…';
          try { const T = await loadThree(); hud.H.retry.style.display = 'none'; hud.H.go.style.display = ''; res(T); }
          catch (er) { hud.H.retry.textContent = 'RETRY'; try { ctx.platform.error({ stage: 'library', message: String(er && er.message || er) }); } catch (x) { } }
        });
      });
    }
    if (destroyed || !THREE) return;

    const small = Math.min(ctx.width, ctx.height) < 600;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const A = createAssets(THREE, renderer, ctx);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, ctx.width / ctx.height, 0.05, 400);
    const world = new World();
    const hazards = new Hazards(world);
    let shadows = true;
    const view = createScene(THREE, A, scene, { small, shadows });
    // the endless run: sections stream in ahead and out behind; the scene follows
    const run = new Run(world, hazards, { add: (sec, hz) => view.addSection(sec, hz), remove: id => view.removeSection(id) });
    const cat = new Cat(world);
    // the cat: the animated Blender model; the procedural rig only if it cannot load
    let rig, rigKind = 'glb';
    try { rig = createGlbCatRig(THREE, A, b64ToBytes(ASSET_CAT)); }
    catch (e) {
      rigKind = 'procedural'; rig = createCatRig(THREE, A);
      try { ctx.platform.error({ stage: 'character', message: String((e && e.message) || e) }); } catch (er) { }
    }
    scene.add(rig.root);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), A.M.shadow);
    blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2; scene.add(blob);
    const cam = createFollowCamera(THREE, camera, world);
    const input = createInput(ctx, canvas, hud);

    // ---------- state ----------
    let mode = 'title', frozen = false, acc = 0, respawn = null, contextLost = false, hintT = 0, time = 0;
    let attempt = 0, bestScore = 0, destT = -1;
    const frameEvents = [];
    const fps = { t: 0, n: 0, v: 0 };
    function haptic(kind) { try { if (caps.haptics) ctx.platform.haptic(kind); } catch (e) { } }

    function place(p, speed) {
      cat.reset(p, speed);
      const g = world.groundAt(p[0], p[2], p[1] + 0.5, 0.05, 0.05);
      if (g.box) { cat.pos[1] = g.y; cat.prev = cat.pos.slice(); cat.grounded = true; cat.ground = g.box; cat.lastGroundY = g.y; }
    }
    // the destination: a tower beyond the next relay, standing alternately left and right
    function setDestination(instant) {
      const r = run.nextRelay(); if (!r) return;
      const x = (r.section % 2 ? -1 : 1) * 26, z = r.z - 160;
      if (instant) view.tower.place(x, z); else view.tower.set(x, z);
    }
    function resetLab() {
      respawn = null; destT = -1;
      run.reset();
      place(run.spawn, 0);
      setDestination(true);
      cam.reset();
      input.clear();
    }
    resetLab();

    // ---------- flow ----------
    function begin() {
      if (mode === 'play') return;
      if (mode === 'title') resetLab();
      mode = 'play'; acc = 0;
      input.state.enabled = true;
      hud.card(null); hud.setPlay(true);
      if (hud.touchy) { hintT = 5; hud.hints(true); }
      attempt++;
      try { ctx.platform.start({ phase: 'endless' }); } catch (e) { }
    }
    function pause() {
      if (mode !== 'play') return;
      mode = 'paused'; input.clear(); input.state.enabled = false;
      hud.card('pause'); hud.hints(false);
    }
    function resume() { if (mode !== 'paused' || contextLost) return; mode = 'play'; input.state.enabled = true; hud.card(null); }
    function restart() {
      hud.panel(false); resetLab(); mode = 'paused'; resume(); if (mode !== 'play') return;
      hud.setPlay(true); attempt++;
      try { ctx.platform.start({ phase: 'endless', replay: true }); } catch (e) { }
    }
    const tap = (e, fn) => ctx.listen(e, 'click', ev => { ev.stopPropagation(); fn(ev); });
    tap(hud.H.go, begin); tap(hud.H.resume, resume); tap(hud.H.restart, restart);
    tap(hud.H.again, () => { if (mode === 'over') { mode = 'paused'; restart(); } });
    ctx.listen(hud.H.pauseBtn, 'pointerdown', e => { e.stopPropagation(); if (mode === 'play') pause(); else resume(); });
    ctx.listen(hud.H.labBtn, 'pointerdown', e => { e.stopPropagation(); hud.panel(!hud.panelOpen()); });
    ctx.listen(window, 'keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
      else if ((e.code === 'Enter' || e.code === 'Space') && mode === 'title' && !hud.H.go.disabled) begin();
      else if ((e.code === 'Enter' || e.code === 'KeyR') && mode === 'over') { mode = 'paused'; restart(); }
      else if (e.code === 'Backquote' || e.code === 'KeyL') hud.panel(!hud.panelOpen());
      else if (e.code === 'KeyR' && mode === 'play') restart();
    });
    hud.buildPanel({
      camPreset: () => cam.st.preset, setCamPreset: v => { cam.st.preset = v; },
      shadows: () => shadows, setShadows: v => { shadows = v; view.setShadows(v); rig.setShadows(v); },
      restart, relayout: () => layout(ctx.width, ctx.height, area())
    });

    // lifecycle: background, blur, context loss
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    ctx.listen(window, 'blur', () => pause());
    ctx.listen(canvas, 'webglcontextlost', e => { e.preventDefault(); contextLost = true; pause(); hud.H.resume.textContent = 'RESTORING…'; });
    ctx.listen(canvas, 'webglcontextrestored', () => {
      contextLost = false; hud.H.resume.textContent = 'RESUME';
      scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { if (m.map) m.map.needsUpdate = true; if (m.alphaMap) m.alphaMap.needsUpdate = true; m.needsUpdate = true; } });
    });

    // ---------- simulation ----------
    function step(dt) {
      time += dt;
      // a respawn in progress: fade out, place the cat on safe footing, fade back in
      if (respawn) {
        respawn.t += dt;
        hud.fade(clamp(respawn.t / 0.18, 0, 1));
        if (respawn.t >= 0.24 && !respawn.done) {
          respawn.done = true;
          place(respawn.at, TUNING.cat.cruise * 0.55);
          hazards.resetUnstable(); run.respawned();
          frameEvents.push({ type: 'respawn' });
          cam.reset();
        }
        if (respawn.done) { hud.fade(clamp(1 - (respawn.t - 0.24) / 0.3, 0, 1)); if (respawn.t > 0.54) { respawn = null; hud.fade(0); } }
        if (respawn && !respawn.done) { cat.step(dt, { steer: 0 }); cat.events.length = 0; hazards.step(dt, cat); return; }
      }
      const inp = input.sample(dt);
      cat.step(dt, inp);
      for (const e of hazards.step(dt, cat)) cat.events.push(e);
      const evs = cat.events.slice(); cat.events.length = 0;
      run.step(dt, cat, evs);
      for (const e of evs.concat(run.events)) {
        frameEvents.push(e);
        if (e.type === 'jump') { try { ctx.platform.interact({ type: 'jump' }); } catch (er) { } }
        else if (e.type === 'land') { if (e.impact > 7) haptic('light'); }
        else if (e.type === 'bump' || e.type === 'scramble') haptic('medium');
        else if (e.type === 'give') haptic('heavy');
        else if (e.type === 'waypoint') { haptic('light'); try { ctx.platform.milestone('waypoint', { z: Math.round(-e.w.z) }); } catch (er) { } }
        else if (e.type === 'fragment') { haptic('success'); try { ctx.platform.interact({ type: 'fragment', count: run.fragments }); } catch (er) { } }
        else if (e.type === 'lifeLost') {
          haptic('warning'); hud.hurt(); hud.toast(e.lives === 1 ? 'LAST LIFE' : `${e.lives} LIVES LEFT`, 'bad');
          try { ctx.platform.interact({ type: 'life_lost', reason: e.reason, lives: e.lives }); } catch (er) { }
        }
        else if (e.type === 'milestone') {
          haptic('success'); hud.toast(e.lifeGained ? 'SIGNAL RELAYED · +1 LIFE' : 'SIGNAL RELAYED', 'good');
          view.tower.lit = 1; destT = 3.5;       // the beam reaches the tower; then the next destination appears
          try { ctx.platform.milestone('relay', { count: run.relays, distance: Math.round(run.distance) }); } catch (er) { }
        }
        else if (e.type === 'gameOver') gameOver();
      }
      run.events.length = 0;
      if (run.respawnAt && !respawn && !run.over) respawn = { t: 0, at: run.respawnAt };
      if (destT > 0) { destT -= dt; if (destT <= 0) { setDestination(false); hud.toast('A NEW SIGNAL, DEEPER IN', 'good'); } }
    }
    function gameOver() {
      mode = 'over'; input.clear(); input.state.enabled = false;
      const best = run.score > bestScore; if (best) bestScore = run.score;
      hud.result({ distance: Math.floor(run.distance), relays: run.relays, fragments: run.fragments, score: run.score, best, bestScore });
      hud.card('result'); hud.setPlay(false); hud.hints(false);
      try { ctx.platform.fail({ score: run.score, distance: Math.floor(run.distance), relays: run.relays }); } catch (er) { }
    }

    // ---------- render ----------
    const rs = { pos: [0, 0, 0], fwd: 0, vx: 0, vy: 0, grounded: true, crouch: 0, teeter: 0, edgeAhead: 0, narrow: 0, scr: null, stumble: 0, assistX: 0, sinceJump: 9, slope: [0, 0], charge: 0, surf: 'flat', sway: 0, events: frameEvents };
    const camCat = { pos: rs.pos, vel: [0, 0, 0], fwd: 0, grounded: true, ground: null, finale: 0 };
    function frame(dt) {
      const a = mode === 'play' ? clamp(acc / SIM_DT, 0, 1) : 1;
      for (let i = 0; i < 3; i++) rs.pos[i] = lerp(cat.prev[i], cat.pos[i], a);
      Object.assign(rs, { fwd: mode === 'title' ? 0 : cat.fwd, vx: cat.vel[0], vy: cat.vel[1], grounded: cat.grounded, crouch: cat.crouch, teeter: cat.teeter, edgeAhead: cat.edgeAhead, narrow: cat.narrow, scr: cat.scr ? clamp(cat.scr.t, 0, 1) : null, stumble: cat.stumble, assistX: cat.assistX, sinceJump: cat.sinceJump, slope: cat.slope, charge: run.fragments, surf: cat.surf, sway: cat.grounded && cat.ground && cat.ground.dx !== undefined ? cat.ground.dx : 0 });
      rig.update(dt, rs);
      // invulnerable: the cat flickers
      rig.root.visible = !(run.invuln > 0 && mode === 'play' && Math.floor(time * 14) % 2 === 0);
      Object.assign(camCat, { vel: cat.vel, fwd: rs.fwd, grounded: cat.grounded, ground: cat.ground, finale: 0 });
      cam.update(dt, camCat, ctx.height > ctx.width, frameEvents);
      frameEvents.length = 0;
      view.update(dt, rs.pos, camera);
      view.setFaded(cam.st.fade, dt);
      // the contact shadow: always straight down, so every landing can be judged
      const g = world.groundAt(rs.pos[0], rs.pos[2], rs.pos[1] + 0.05, 0.05, 0.1);
      if (g.box && !g.box.far) {
        const h = rs.pos[1] - g.y, k = clamp(1 - h / 5, 0.25, 1);
        blob.visible = true; blob.position.set(rs.pos[0], g.y + 0.012, rs.pos[2]);
        blob.scale.set(0.42 * (0.7 + 0.3 * k), 0.75 * (0.7 + 0.3 * k), 1);
        A.M.shadow.opacity = 0.42 * k;
      } else blob.visible = false;
      hud.status(run.lives, run.fragments, Math.floor(run.distance), run.score);
      if (hintT > 0) { hintT -= dt; if (hintT <= 0 || input.state.stick) { hintT = 0; hud.hints(false); } }
      fps.t += dt; fps.n++; if (fps.t > 0.5) { fps.v = fps.n / fps.t; fps.t = 0; fps.n = 0; }
      if (hud.H.dbg.classList.contains('on')) {
        const j = cat.stats.lastJump, inf = renderer.info.render;
        hud.debug(`fps ${fps.v.toFixed(0)}  calls ${inf.calls}  tris ${(inf.triangles / 1000).toFixed(1)}k\n` +
          `speed ${cat.fwd.toFixed(2)}  vx ${cat.vel[0].toFixed(2)}  vy ${cat.vel[1].toFixed(2)}\n` +
          `${cat.grounded ? 'ground' : 'air'}${cat.crouch ? ' crouch' : ''}${cat.narrow > 0.5 ? ' narrow' : ''}${cat.scr ? ' scramble' : ''}  coyote ${cat.coyote.toFixed(2)}  buffer ${cat.buffer.toFixed(2)}\n` +
          `steer ${input.state.steer.toFixed(2)}  pace ${input.state.pace.toFixed(2)}  jump ${TUNING.input.jumpMode}${input.state.jumpHeld ? ' (held)' : ''}  grip ${cat.gripT.toFixed(2)}\n` +
          (j ? `last jump ${j.dist.toFixed(2)} m  rise ${j.rise.toFixed(2)} m  ${(j.air * 1000).toFixed(0)} ms` : 'last jump —'));
      }
      if (!contextLost) renderer.render(scene, camera);
    }

    // ---------- layout ----------
    function layout(w, h, a) {
      hud.layout(w, h, a);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      view.setPointScale(h * renderer.getPixelRatio() * 0.5 / Math.tan(camera.fov * Math.PI / 360));
      // centre the picture in the content safe area, so Plethora's logo button
      // (bottom centre) never sits on the cat
      const shift = Math.round(Math.max(0, (a.bottom || 0) * 0.8 - (a.top || 0) * 0.5));
      if (shift > 0) camera.setViewOffset(w, h, 0, shift, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
    ctx.onResize(({ width, height }) => layout(width, height, area()), { immediate: true });

    // ---------- loop: fixed 60 Hz simulation, rendered with interpolation ----------
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (frozen) return;
      if (mode === 'play') {
        acc += dt; let n = 0;
        while (acc >= SIM_DT && n < 5) { step(SIM_DT); acc -= SIM_DT; n++; }
        if (n === 5) acc = 0;
      }
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    ctx.onDestroy(() => {
      destroyed = true;
      input.clear();
      try { view.dispose(); rig.dispose(); blob.geometry.dispose(); } catch (e) { }
      for (const k in A.M) try { A.M[k].dispose(); } catch (e) { }
      for (const k in A.T) try { A.T[k].dispose(); } catch (e) { }
      try { renderer.dispose(); } catch (e) { }
    });

    try { frame(SIM_DT); } catch (e) { bootFail('frame', e); return; }
    hud.H.go.disabled = false; hud.H.go.textContent = 'RUN';
    if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } }

    if (window.__RR_DEV) {
      window.__rr = {
        glb: { readGLB, b64ToBytes }, THREE, get rig() { return rig; }, rigKind,
        begin, pause, resume, restart, cat, world, run, hazards, input, camera, renderer, cam, scene, TUNING,
        get mode() { return mode; },
        // drive the real loop deterministically: input = { steer, jump }
        advance(sec, inp) { if (inp !== undefined) input.state.virtual = inp; const n = Math.round(sec / SIM_DT); for (let i = 0; i < n && mode === 'play'; i++) step(SIM_DT); acc = 0; frame(SIM_DT); },
        frame: () => frame(SIM_DT),
        freeze(on) { frozen = on; },
        sim(inp) { input.state.virtual = inp; if (mode === 'play') step(SIM_DT); },
        warp(i) { const s = run.sections[0]; place(s.checkpoints[i], TUNING.cat.cruise); cam.reset(); frame(SIM_DT); }
      };
    }
  }
};
