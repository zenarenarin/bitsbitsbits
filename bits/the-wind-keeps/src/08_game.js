// The game: boot, timing, Flow, chains, score, camera, notebook, records.
const SAVE_V = 1;
const LATE = 0.4, EARLY = 0.55, INPUT_BIAS = 0.03;
const CHAIN_WORDS = { 4: 'The chain continues', 8: 'Beautifully connected', 12: 'Everything moves', 18: 'In flow', 26: 'The world is running' };
const FLOW_WORDS = ['stillness', 'stirring', 'turning', 'in flow', 'everything moves'];

window.plethoraBit = {
  meta: { title: 'The Wind Keeps', runtime: 'plethora-bit@2', tags: ['casual', 'timing', '3d'], permissions: ['audio', 'haptics'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // ---------- first frame: a painted sky and the title, before anything loads ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(180deg,#86bcd8 0%,#bcdce6 38%,#eef1e3 62%,#a9bb78 63%,#93aa66 100%)';
    const ui = ctx.createRoot({ className: 'twk', layer: 'overlay', input: 'passthrough' });
    const css = document.createElement('style'); css.textContent = UI_CSS; ui.appendChild(css);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'twk-vig');
    H.veil = el('div', 'twk-veil');
    // HUD
    H.hud = el('div', 'twk-hud fade hide');
    H.label = el('div', 'twk-label', '', H.hud);
    H.tag = el('div', 'twk-tag mono', '', H.label);
    el('div', 'twk-rule', '', H.label);
    H.obj = el('div', 'twk-obj disp', '', H.label);
    H.ticks = el('div', 'twk-ticks', '', H.label);
    H.note = el('div', 'twk-note serif fade hide', '', H.label);
    H.pause = el('div', 'twk-pause', MARKS.pause, H.hud);
    H.flow = el('div', 'twk-flow', TURBINE_SVG, H.hud);
    H.ctr = el('div', 'twk-ctr', '', H.flow);
    H.num = el('div', 'twk-num mono', '', H.ctr);
    H.sub = el('div', 'twk-sub mono', '', H.ctr);
    H.digits = [];
    for (let i = 0; i < 6; i++) { const s = el('span', '', '', H.num); const b = el('b', '', '0\n1\n2\n3\n4\n5\n6\n7\n8\n9', s); H.digits.push(b); }
    H.rot = H.flow.querySelector('.rot'); H.blades = [...H.flow.querySelectorAll('.bl')]; H.lamp = H.flow.querySelector('.lamp'); H.halo = H.flow.querySelector('.halo');
    H.say = el('div', 'twk-say serif');
    H.hint = el('div', 'twk-hint fade hide');
    H.hintSvg = el('div', '', '<svg><path fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-dasharray="4 5" stroke-linecap="round" opacity=".7"/><path class="hd" fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-linecap="round" opacity=".7"/></svg>', H.hint);
    H.hintPath = H.hint.querySelector('path'); H.hintHead = H.hint.querySelector('.hd');
    H.hintLbl = el('div', 'lbl serif', 'the wind is coming', H.hint);
    H.finger = el('div', 'twk-finger serif', '<i></i><span>touch</span>');
    // title
    H.title = el('div', 'twk-title fade');
    H.title.innerHTML = `<div class="head"><div class="over mono">A FIELD NOTEBOOK</div><h1 class="serif">The Wind<br>Keeps</h1><div class="rule"></div><div class="tag serif">Everything is moving.<br>You just need to catch it.</div></div>
      <div class="foot"><div class="twk-begin serif">begin</div><div class="twk-links"><button class="twk-link mono" data-a="notes">FIELD NOTES</button><button class="twk-link mono" data-a="sound">SOUND · ON</button></div></div>`;
    H.begin = H.title.querySelector('.twk-begin'); H.notesBtn = H.title.querySelector('[data-a=notes]'); H.soundBtn = H.title.querySelector('[data-a=sound]');
    H.begin.textContent = '…';
    // sheets
    H.sheet = el('div', 'twk-sheet');
    H.paper = el('div', 'twk-paper', '', H.sheet);
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    const fontLoads = [
      ['TWK Serif', 'cormorant-garamond', { weight: '300', style: 'italic' }],
      ['TWK Serif', 'cormorant-garamond', { weight: '300', style: 'normal' }],
      ['TWK Display', 'dm-serif-display', { weight: '400', style: 'italic' }],
      ['TWK Mono', 'space-mono', { weight: '400', style: 'normal' }],
      ['TWK Sans', 'inter', { weight: '400', style: 'normal' }]
    ];
    for (const [fam, name, o] of fontLoads) { try { const p = ctx.loadFont(fam, name, '1.0.0', o); if (p && p.catch) p.catch(() => { }); } catch (e) { } }

    // ---------- the field notebook (private memory) ----------
    const defaultSave = () => ({ v: SAVE_V, done: {}, muted: false, seenCatch: false, daily: {} });
    let save = defaultSave(), saveReady = false, saveFailed = false, saveChain = Promise.resolve();
    const mem = ctx.memory && ctx.memory.local ? (() => { try { return ctx.memory.local('notebook'); } catch (e) { return null; } })() : null;
    const validSave = v => v && typeof v === 'object' && v.v === SAVE_V && v.done && typeof v.done === 'object';
    const hydrate = mem ? mem.get().then(r => {
      if (destroyed) return;
      const v = r && r.value;
      if (v && validSave(v)) save = Object.assign(defaultSave(), v);
      saveReady = true;
    }).catch(e => { saveFailed = true; try { ctx.platform.error({ stage: 'memory', message: String(e && e.message || e) }); } catch (_) { } }) : Promise.resolve().then(() => { saveReady = false; });
    // writes are serialised, and only ever made after a successful read
    const persist = () => {
      if (!mem || !saveReady || destroyed) return;
      const snap = JSON.parse(JSON.stringify(save));
      saveChain = saveChain.then(() => mem.set(snap)).catch(() => { });
    };

    // ---------- boot ----------
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics.', frame: 'The first frame failed to draw. Please reopen.' }[stage] || 'Something went wrong.';
      el('div', 'twk-fail serif', msg);
      H.title.querySelector('.foot').style.display = 'none';
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.6));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (e) { } });

    let scratchCanvas = null;
    const scratch = () => { if (!scratchCanvas) { scratchCanvas = ctx.createCanvas2D({ layer: 'background', input: 'passthrough', willReadFrequently: true }); scratchCanvas.style.display = 'none'; } return scratchCanvas; };
    const P = createPaint(THREE, scratch);
    const E = createEnv(THREE, P);
    const X = createParts(THREE, P);
    const audio = createAudio(!!caps.audio);
    ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    // creator knobs (draft-time), with safe defaults when tuning is unavailable
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.get ? ctx.tune.get(id) : undefined; return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    try { if (ctx.tune && ctx.tune.onChange) ctx.tune.onChange(['sound_level'], v => { audio.volume = typeof v === 'number' ? v : 0.9; audio.setMuted(audio.muted); }); } catch (e) { }
    audio.volume = tune('sound_level', 0.9);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, ctx.width / ctx.height, 0.3, 600);
    scene.add(camera);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xbcd3e6, 0.35); fill.position.set(12, 6, 14); scene.add(fill);
    let sky = null;

    const worlds = { windmill: createWindmillWorld(THREE, P, E, X, audio), clock: createClockWorld(THREE, P, E, X, audio) };
    const ORDER = ['windmill', 'clock'].filter(w => worlds[w]);
    let world = null;
    function useWorld(id) {
      if (world && world.id === id) return;
      if (world) scene.remove(world.root);
      world = worlds[id];
      const lk = world.look;
      if (sky) { scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); }
      sky = E.sky(lk.sky); scene.add(sky);
      scene.fog = new THREE.Fog(new THREE.Color(lk.fog), lk.fogNear, lk.fogFar);
      hemi.color.set(lk.hemiSky); hemi.groundColor.set(lk.hemiGround); hemi.intensity = lk.hemi;
      sun.color.set(lk.sunColor); sun.intensity = lk.sun; sun.position.set(...lk.sunPos); sun.target.position.set(0, 4, 0);
      world.build(scene);
      audio.bpm = world.bpm;
      layout();
    }

    // ---------- game state ----------
    let mode = 'boot';
    const G = {
      t: 0, t0: 0, beat: 60 / 76, flow: 0, rng: makeRng(1), playing: false, ops: [], opId: 0,
      addOp(kind, t, data, harmful = false) { const op = { id: ++G.opId, kind, t, data, harmful: !!harmful, done: false }; G.ops.push(op); return op; },
      beatTime(k) { return G.t0 + k * G.beat; },
      event(name, p) { onWorldEvent(name, p); },
      focus(point, amt) { cam.focus.copy(point); cam.focusAmt = Math.max(cam.focusAmt, Math.abs(amt)); cam.push = Math.max(cam.push, amt); }
    };
    let run = null; // the current attempt
    let attempt = 0;
    let levelRef = null; // { world, index } or { daily: true }
    let autopilot = 0; // 0 off, 1 casual (title), 2 perfect (finale)

    function levelDef(ref) {
      if (ref.daily) return dailyLevel();
      return worlds[ref.world].levels[ref.index];
    }
    // The Daily Machine: everyone gets the same world, wind and quirks today.
    function dailyLevel() {
      const key = todayKey(), seed = hashStr('twk-' + key), r = makeRng(seed);
      const wid = ORDER[seed % ORDER.length];
      const base = Object.assign({}, worlds[wid].levels[worlds[wid].levels.length - 1]);
      base.daily = true; base.world = wid; base.seed = seed;
      base.goal = { type: 'timed', secs: Math.round(tune('daily_seconds', 90)) };
      base.cross = r.range(0.08, 0.3); base.jitter = r.range(0.02, 0.07); base.startW = r.range(0.15, 0.7);
      if (base.N) base.N = r.int(4, 6);
      base.title = r.pick(worlds[wid].dailyTitles || ['Keep it all moving']);
      base.note = 'Today\'s machine. Everyone has the same wind.';
      return base;
    }

    // ---------- camera ----------
    const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), basePos: new THREE.Vector3(), baseLook: new THREE.Vector3(), focus: new THREE.Vector3(), focusAmt: 0, push: 0, pushV: 0, orbit: 0, intro: 0 };
    function frameCamera() {
      const f = world.frame, a = ctx.width / Math.max(1, ctx.height);
      const D = f.dist;
      const hv = Math.max((f.y1 - f.y0) / 2, ((f.x1 - f.x0) / 2) / a);
      let fov = 2 * Math.atan(hv / D) * 180 / Math.PI;
      fov = Math.min(fov, 62);
      camera.fov = fov; camera.aspect = a; camera.updateProjectionMatrix();
      const cx = (f.x0 + f.x1) / 2;
      // portrait: centre the machine; leave a little more sky above the HUD
      const cy = a < 1 ? f.cy : (f.y0 + f.y1) / 2;
      cam.basePos.set(cx, cy + 1.6, f.z + D);
      cam.baseLook.set(cx, cy, f.z);
    }
    function updateCamera(dt, time) {
      cam.focusAmt = damp(cam.focusAmt, 0, 0.9, dt);
      cam.pushV += (cam.push - 0) * 0; cam.push = damp(cam.push, 0, 0.7, dt);
      const breathe = Math.sin(time * 0.21) * 0.12;
      const orbit = cam.orbit;
      const p = cam.basePos, l = cam.baseLook;
      cam.title = damp(cam.title || 0, mode === 'title' ? 1 : 0, 1.6, dt);
      cam.res = damp(cam.res || 0, mode === 'complete' ? 1 : 0, 1.2, dt);
      const port = ctx.width < ctx.height;
      const dz = -cam.push * 2.2 + cam.title * (port ? 9 : 3) + cam.res * (port ? 7 : 2);
      const ty = cam.title * (port ? 4.2 : 0.5) - cam.res * (port ? 5.5 : 0);
      const tx = port ? 0 : -cam.title * 6.5 - cam.res * 5;
      cam.pos.set(p.x + tx + Math.sin(orbit) * 4 + breathe, p.y + ty + Math.cos(time * 0.17) * 0.08, p.z + dz);
      cam.look.copy(l).lerp(cam.focus, cam.focusAmt * 0.18); cam.look.y += ty; cam.look.x += tx;
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
    }

    // ---------- HUD helpers ----------
    let sayTimer = 0;
    function say(text, secs = 2.4) { H.say.textContent = text; H.say.classList.add('on'); sayTimer = secs; }
    let lastTicks = '';
    function renderObjective() {
      if (!run) return;
      const o = world.objective(G);
      let html = '';
      if (o.timed) {
        const left = Math.max(0, run.L.goal.secs - (G.t - run.tStart));
        for (let i = 0; i < Math.min(12, o.ticks); i++) html += '<i class="on"></i>' + ((i + 1) % 5 === 0 ? '<i class="cross"></i>' : '');
        html += `<span class="t mono">${fmtTime(left)}</span>`;
      } else {
        for (let i = 0; i < o.need; i++) html += `<i class="${i < o.ticks ? 'on' : ''}"></i>` + ((i + 1) % 5 === 0 && i < o.need - 1 ? '<i class="cross" style="opacity:' + (i < o.ticks ? 1 : 0.2) + '"></i>' : '');
      }
      if (html !== lastTicks) { H.ticks.innerHTML = html; lastTicks = html; }
    }
    let shownScore = -1;
    function renderScore(v) {
      v = Math.max(0, Math.min(999999, Math.floor(v)));
      if (v === shownScore) return; shownScore = v;
      const s = String(v).padStart(6, '0');
      for (let i = 0; i < 6; i++) { H.digits[i].style.transform = `translateY(${-(+s[i]) * 14}px)`; H.digits[i].parentNode.style.opacity = i < 6 - String(v).length ? 0.3 : 1; }
    }
    let turbA = 0, flowTier = 0;
    function renderFlow(dt) {
      const f = G.flow;
      turbA += dt * (0.2 + Math.pow(f, 1.4) * 9) * 57.3;
      H.rot.setAttribute('transform', `rotate(${turbA % 360}) scale(${0.72 + f * 0.3})`);
      const lit = Math.ceil(f * 6 - 0.15);
      H.blades.forEach((b, i) => b.setAttribute('fill', i < lit ? (f > 0.85 ? '#e8b354' : '#ecd08a') : '#f5efe2'));
      H.lamp.setAttribute('opacity', clamp((f - 0.6) * 3).toFixed(2));
      H.halo.setAttribute('opacity', clamp((f - 0.85) * 6).toFixed(2));
      const tier = f < 0.12 ? 0 : f < 0.35 ? 1 : f < 0.6 ? 2 : f < 0.85 ? 3 : 4;
      if (tier !== flowTier && mode === 'play') { if (tier > flowTier && tier >= 3) H.sub.textContent = FLOW_WORDS[tier].toUpperCase(); flowTier = tier; }
    }

    // ---------- a run ----------
    function startLevel(ref) {
      levelRef = ref;
      const L = levelDef(ref);
      useWorld(ref.daily ? L.world : ref.world);
      attempt++;
      G.rng = makeRng(ref.daily ? L.seed : ((Date.now() ^ (Math.random() * 1e9)) >>> 0));
      G.beat = 60 / world.bpm; G.ops = []; G.flow = 0.08; G.lead = tune('anticipation_beats', 3);
      G.t0 = G.t + 1.0;
      run = { L, ref, attempt, tStart: G.t, lastFlowT: G.t, score: 0, chain: 0, bestChain: 0, q: [], catches: 0, snags: 0, done: false, finaleT: 0, events: [], idleTaps: [] };
      world.begin(L, G);
      autopilot = 0; mode = 'play'; G.playing = true;
      if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { } }
      try { ctx.platform.start({ level: ref.daily ? 'daily' : ref.world + '-' + (ref.index + 1) }); } catch (e) { }
      // HUD
      const tagName = ref.daily ? 'TODAY' : world.label;
      const num = ref.daily ? `${new Date().getUTCDate()} ${MONTHS[new Date().getUTCMonth()].slice(0, 3).toUpperCase()}` : String(ref.index + 1).padStart(2, '0');
      H.tag.innerHTML = (ref.daily ? MARKS.daily : MARKS[world.id === 'clock' ? 'clock' : 'windmill']) + `<span>${tagName}</span><span class="sl">/</span><span>${num}</span>`;
      H.obj.textContent = L.title;
      H.note.textContent = L.note || ''; H.note.classList.remove('hide');
      run.noteT = 5.5;
      lastTicks = ''; renderObjective(); shownScore = -1; renderScore(0); H.sub.textContent = '';
      H.hud.classList.remove('hide'); H.title.classList.add('hide'); hideSheet();
      H.veil.classList.remove('on');
      cam.orbit = 0;
    }
    function attract() {
      // the title: the world runs itself, a little imperfectly
      useWorld(world ? world.id : 'windmill');
      const L = Object.assign({}, world.levels[Math.min(3, world.levels.length - 1)], { startW: 0.6 });
      G.rng = makeRng(7); G.beat = 60 / world.bpm; G.ops = []; G.flow = 0.45; G.t0 = G.t + 0.5;
      world.begin(L, G);
      run = null; autopilot = 1; mode = 'title'; G.playing = false;
      H.hud.classList.add('hide'); H.title.classList.remove('hide');
      H.veil.classList.add('on');
    }

    // tap ---------------------------------------------------------------
    let frameWall = performance.now();
    function tapTime() { return G.t + Math.min(0.05, (performance.now() - frameWall) / 1000) - INPUT_BIAS; }
    function classify(d, L) {
      const k = tune('timing_forgiveness', 1), [wf, wg] = (L.win || [0.1, 0.22]).map(w => w * k);
      const ad = Math.abs(d);
      if (ad <= wf) return 'flow';
      if (ad <= wg) return 'good';
      return d < 0 ? 'early' : 'late';
    }
    function tap(x, y) {
      if (mode !== 'play' || !run || run.done) return;
      const t = tapTime();
      try { ctx.platform.interact({ kind: 'catch' }); } catch (e) { }
      const L = run.L;
      const cands = G.ops.filter(o => !o.done && t - o.t > -EARLY && t - o.t < LATE);
      let res = null;
      if (!cands.length) {
        world.idle(G);
        run.idleTaps = run.idleTaps.filter(q => t - q < 2.5); run.idleTaps.push(t);
        if (run.idleTaps.length > 2) { G.flow = Math.max(0, G.flow - 0.02); run.chain = 0; }
      } else {
        cands.sort((a, b) => Math.abs(t - a.t) - Math.abs(t - b.t));
        const best = cands[0];
        const wg = (L.win || [0.1, 0.22])[1] * tune('timing_forgiveness', 1);
        // everything that aligns with this moment is caught together
        const hit = cands.filter(o => o === best || Math.abs(t - o.t) <= wg);
        let good = 0;
        for (const op of hit) {
          op.done = true;
          const d = t - op.t;
          const r = op.harmful ? 'snag' : classify(d, L);
          world.resolve(op, r, d, G);
          result(r, op);
          if (r === 'flow' || r === 'good') good++;
          res = res || r;
        }
        if (good >= 2) { addScore(180 * good); say('When things align', 2.2); audio.swell(G.t, 2); }
        if (!save.seenCatch) { save.seenCatch = true; persist(); }
      }
      // a small pencil ring where the finger landed
      if (x !== undefined) { const r = el('div', 'twk-touch', '', ui); r.style.left = x + 'px'; r.style.top = y + 'px'; ctx.timeout(() => r.remove(), 520); }
      audio.unlock();
    }
    function addScore(v) { if (!run) return; run.score += v; if (scoreTrack) { try { scoreTrack.set(Math.floor(run.score)); } catch (e) { } } }
    function result(r, op) {
      if (!run) return;
      const q = { flow: 1, good: 0.6, early: 0.2, late: 0, miss: 0, snag: 0 }[r];
      if (q !== undefined) run.q.push(q);
      if (r === 'flow' || r === 'good') {
        run.chain++; run.bestChain = Math.max(run.bestChain, run.chain); run.catches++; run.lastFlowT = G.t;
        G.flow = clamp(G.flow + (r === 'flow' ? 0.1 : 0.05) * tune('flow_recovery', 1));
        addScore((r === 'flow' ? 120 : 70) * (1 + Math.min(run.chain, 20) * 0.08 + G.flow * 0.5));
        if (r === 'flow') haptic('light');
        const w = CHAIN_WORDS[run.chain];
        if (w) { say(w); audio.swell(G.t, run.chain / 4); try { ctx.platform.milestone('chain', { length: run.chain }); } catch (e) { } }
      } else if (r === 'early' || r === 'late') {
        if (run.chain >= 6) say(r === 'early' ? 'A little early' : 'Almost', 1.6);
        run.chain = 0; G.flow = clamp(G.flow - (r === 'early' ? 0.05 : 0.06));
        addScore(r === 'early' ? 10 : 0);
      } else if (r === 'snag') {
        run.chain = 0; run.snags++; G.flow = clamp(G.flow - 0.14); haptic('warning');
        if (run.snags === 1) say('Out of step', 1.8);
      } else if (r === 'miss') {
        if (run.chain >= 6) say('The chain rests', 1.6);
        run.chain = 0; G.flow = clamp(G.flow - 0.04);
      } else if (r === 'weathered') {
        G.flow = clamp(G.flow + 0.03); addScore(40);
      }
    }
    function onWorldEvent(name, p) {
      if (!run || mode !== 'play') return;
      if (name === 'delivery' || name === 'hour') {
        addScore(600 * (1 + G.flow)); G.flow = clamp(G.flow + 0.06); haptic('success');
        if (!run.events.includes(name)) say(name === 'hour' ? 'The hour is kept' : 'The world responds', 2.6);
        run.events.push(name);
        try { ctx.platform.milestone(name); } catch (e) { }
      } else if (name === 'lift-top') { addScore(150); }
      else if (name === 'overswing') { run.chain = 0; G.flow = clamp(G.flow - 0.08); haptic('warning'); if (!run.events.includes(name)) say('Too much', 1.8); run.events.push(name); }
      else if (name === 'stall') { if (!run.events.includes('stall')) say('Stillness', 2.4); run.events.push('stall'); }
    }

    // finale & results -------------------------------------------------------
    function beginFinale() {
      run.done = true; run.tEnd = G.t; mode = 'finale'; autopilot = 2; run.finaleT = 0;
      for (const op of G.ops) if (!op.done && op.t < G.t) op.done = true;
      world.finale(G);
      H.note.classList.add('hide');
      haptic('success');
      try { ctx.platform.setProgress(1); } catch (e) { }
    }
    function computeResult() {
      const L = run.L, time = run.tEnd - run.tStart, avg = run.q.length ? run.q.reduce((a, b) => a + b, 0) / run.q.length : 0;
      const timed = L.goal.type === 'timed';
      const stats = world.stats();
      if (!timed) addScore(Math.max(0, (L.par || 60) - time) * 15);
      const kept = timed ? (stats.deliveries || stats.hours || 0) >= 3 : true;
      const inflow = avg >= 0.72 && run.q.length >= 4;
      const unbroken = run.bestChain >= (timed ? 16 : Math.min(10, Math.max(5, (L.goal.need || 4) * 2 + 2)));
      return { time, avg, kept, inflow, unbroken, score: Math.floor(run.score), chain: run.bestChain, stats, timed };
    }
    function finishLevel() {
      const R = computeResult();
      mode = 'complete';
      const key = levelRef.daily ? null : levelRef.world + '-' + (levelRef.index + 1);
      let best = null, isBest = false;
      if (key) {
        const prev = save.done[key];
        isBest = !prev || R.score > prev.best;
        best = Math.max(R.score, prev ? prev.best : 0);
        const stamps = [R.kept ? 1 : 0, R.inflow ? 1 : 0, R.unbroken ? 1 : 0];
        if (R.kept) save.done[key] = { best, s: prev ? prev.s.map((v, i) => v | stamps[i]) : stamps };
        persist();
      } else {
        const k = todayKey(); const prev = save.daily[k];
        isBest = !prev || R.score > prev; save.daily = { [k]: Math.max(R.score, prev || 0) }; best = save.daily[k]; persist();
      }
      try { ctx.platform.complete({ level: key || 'daily', score: R.score }); } catch (e) { }
      showResult(R, best, isBest);
    }
    function headline(R) {
      if (R.timed && !R.kept) return 'The day is done.';
      if (R.inflow && R.unbroken) return 'Everything moved.';
      if (R.inflow) return 'You found the flow.';
      if (R.unbroken) return 'A good day for the machine.';
      return world.id === 'clock' ? 'The tower remembers.' : 'The windmill remembers.';
    }
    function nextRef() {
      if (!levelRef || levelRef.daily) return null;
      const w = worlds[levelRef.world];
      if (levelRef.index + 1 < w.levels.length) return { world: levelRef.world, index: levelRef.index + 1 };
      const wi = ORDER.indexOf(levelRef.world); if (wi + 1 < ORDER.length) return { world: ORDER[wi + 1], index: 0 };
      return null;
    }
    function unlocked(ref) {
      if (ref.daily) return !!save.done['windmill-1'];
      if (ref.index === 0) return ref.world === 'windmill' || !!save.done['windmill-4'];
      return !!save.done[ref.world + '-' + ref.index];
    }
    let resultAttempt = 0;
    function showResult(R, best, isBest) {
      const L = run.L, ref = levelRef;
      const disc = !ref.daily && world.discovery ? world.discovery(L) : null;
      const nx = nextRef();
      const rows = [
        [R.timed ? (world.id === 'clock' ? 'HOURS KEPT' : 'SEEDS CARRIED') : 'TIME', R.timed ? String(R.stats.deliveries ?? R.stats.hours ?? 0) : fmtTime(R.time)],
        ['LONGEST CHAIN', String(R.chain)],
        ['FLOW', R.avg >= 0.8 ? 'held' : R.avg >= 0.6 ? 'found' : R.avg >= 0.4 ? 'stirring' : 'finding it'],
        [isBest && best > 0 ? 'SCORE · BEST' : 'SCORE', R.score.toLocaleString('en-US')]
      ];
      H.paper.innerHTML = `<div class="k mono">${ref.daily ? 'TODAY\'S MACHINE · ' + new Date().getUTCDate() + ' ' + MONTHS[new Date().getUTCMonth()].toUpperCase() : world.label + ' · ENTRY ' + String(ref.index + 1).padStart(2, '0')}</div>
        <h2 class="serif">${headline(R)}</h2><h3 class="disp">${L.title}</h3>
        <div class="twk-rows">${rows.map(r => `<div><span class="v ${r[0] === 'FLOW' ? 'serif' : 'mono'}">${r[1]}</span><span class="l mono">${r[0]}</span></div>`).join('')}</div>
        <div class="twk-stamps mono"><span class="twk-stamp ${R.kept ? 'on' : ''}">KEPT</span><span class="twk-stamp ${R.inflow ? 'on' : ''}">IN FLOW</span><span class="twk-stamp ${R.unbroken ? 'on' : ''}">UNBROKEN</span></div>
        ${disc ? `<div class="twk-disc serif">New in the notebook: ${disc}.</div>` : ''}
        ${ref.daily ? '<div class="twk-board mono"><div class="st">TODAY · LOADING…</div></div>' : ''}
        <div class="twk-acts"><button class="twk-btn serif" data-a="again">again</button>${nx && unlocked(nx) || (nx && R.kept) ? '<button class="twk-btn serif" data-a="next">next entry →</button>' : '<button class="twk-btn small mono" data-a="notes">FIELD NOTES</button>'}</div>`;
      showSheet();
      if (isBest && best > 0) { audio.bloom(G.t + 0.4); audio.bell(G.t + 0.9, 9, 0.7); }
      if (ref.daily) submitDaily(R.score);
      try { if (ctx.pulse && ctx.pulse.complete) ctx.timeout(() => { if (mode === 'complete') ctx.pulse.complete({ score: R.score, timeMs: Math.round(R.time * 1000), level: ref.daily ? 'daily' : ref.index + 1, mode: world.id, result: headline(R) }); }, 900); } catch (e) { }
    }
    function submitDaily(score) {
      const my = ++resultAttempt;
      const board = () => H.paper.querySelector('.twk-board');
      const rec = ctx.memory && ctx.memory.record ? ctx.memory.record('daily_machine') : null;
      const go = scoreTrack && scoreTrack.submit ? scoreTrack.submit('daily_machine', { label: score.toLocaleString('en-US') + ' pts' }) : (rec ? rec.submit(score, { label: score + ' pts' }) : Promise.reject(new Error('records unavailable')));
      go.then(() => rec ? rec.leaderboard({ scope: 'global', period: 'daily', limit: 3 }) : null).then(lb => {
        if (destroyed || my !== resultAttempt || !board()) return;
        if (!lb) { board().innerHTML = '<div class="st">TODAY · SAVED</div>'; return; }
        const rows = (lb.rows || []).slice(0, 3).map(r => `<div class="row"><span>${r.rank}. ${String(r.username || r.displayName || '—').slice(0, 18)}</span><span>${r.displayLabel || r.value}</span></div>`).join('');
        const me = lb.viewerRank ? `<div class="row me"><span>you · ${lb.viewerRank.rank} of ${lb.totalRanked || '—'}</span><span>${lb.viewerRank.displayLabel || lb.viewerRank.value}</span></div>` : '';
        board().innerHTML = '<div class="st">TODAY</div>' + rows + me;
      }).catch(() => { if (!destroyed && my === resultAttempt && board()) board().innerHTML = '<div class="st">TODAY · THE BOARD COULD NOT BE REACHED</div>'; });
    }
    function showSheet() { H.sheet.classList.add('on'); }
    function hideSheet() { H.sheet.classList.remove('on'); }

    // notebook index -------------------------------------------------------
    function showNotes(fromPause) {
      const prevMode = mode;
      if (mode === 'play') pauseGame(true);
      let html = `<button class="twk-close" data-a="close">×</button><div class="k mono">FIELD NOTES${saveFailed ? ' · NOTES COULD NOT BE READ' : ''}</div><div class="twk-index">`;
      ORDER.forEach((wid, wi) => {
        const w = worlds[wid];
        html += `<div class="twk-sec"><span class="n mono">${w.numeral}.</span><span class="t serif">${w.name}</span></div>`;
        w.levels.forEach((L, i) => {
          const ref = { world: wid, index: i }, d = save.done[wid + '-' + (i + 1)], ok = unlocked(ref) || !!d;
          const isNext = ok && !d;
          html += `<div class="twk-ent ${ok ? '' : 'lock'} ${isNext ? 'next' : ''}" ${ok ? `data-w="${wid}" data-i="${i}"` : ''}><span class="n mono">${String(i + 1).padStart(2, '0')}</span><span class="t disp">${ok ? L.title : '· · ·'}</span><span class="m">${d ? d.s.map(v => `<i class="${v ? 'on' : ''}"></i>`).join('') : ''}</span></div>`;
        });
      });
      const dOk = unlocked({ daily: true }), db = save.daily[todayKey()];
      html += `<div class="twk-sec"><span class="n mono">—</span><span class="t serif">Today's machine</span></div>
        <div class="twk-ent ${dOk ? '' : 'lock'}" ${dOk ? 'data-d="1"' : ''}><span class="n mono">${new Date().getUTCDate()}</span><span class="t disp">${dOk ? 'Same wind for everyone, today' : 'After the first entry'}</span><span class="m mono" style="font-size:11px">${db ? db.toLocaleString('en-US') : ''}</span></div></div>`;
      H.paper.innerHTML = html;
      H.paper.dataset.from = fromPause ? 'pause' : prevMode;
      showSheet();
    }
    function showPause() {
      H.paper.innerHTML = `<div class="k mono">PAUSED · ${levelRef && levelRef.daily ? 'TODAY' : world.label}</div><h2 class="serif">The machine waits.</h2>
        <div class="twk-acts" style="flex-wrap:wrap;gap:4px 18px;justify-content:flex-start"><button class="twk-btn serif" data-a="resume">resume</button><button class="twk-btn serif" data-a="again">begin again</button><button class="twk-btn serif" data-a="notes">field notes</button></div>
        <div class="twk-acts"><button class="twk-btn small mono" data-a="sound">SOUND · ${audio.muted ? 'OFF' : 'ON'}</button><button class="twk-btn small mono" data-a="leave">LEAVE</button></div>`;
      showSheet();
    }
    let pausedFrom = null;
    function pauseGame(silent) {
      if (mode !== 'play' && mode !== 'finale') return;
      pausedFrom = mode; mode = 'paused'; audio.suspend();
      if (!silent) showPause();
    }
    function resumeGame() {
      if (mode !== 'paused') return;
      mode = pausedFrom || 'play'; hideSheet(); audio.resume(); audio.unlock();
    }
    function toggleSound() { save.muted = !save.muted; audio.setMuted(save.muted); persist(); H.soundBtn.textContent = 'SOUND · ' + (save.muted ? 'OFF' : 'ON'); }
    function firstRef() {
      for (const wid of ORDER) for (let i = 0; i < worlds[wid].levels.length; i++) { const r = { world: wid, index: i }; if (unlocked(r) && !save.done[wid + '-' + (i + 1)]) return r; }
      return { world: 'windmill', index: worlds.windmill.levels.length - 1 };
    }

    // ---------- input ----------
    let downId = null;
    ctx.listen(canvas, 'pointerdown', e => {
      if (e.cancelable) e.preventDefault();
      audio.unlock();
      if (mode === 'play') { const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top); }
      else if (mode === 'title') beginFromTitle();
      else if (mode === 'complete' || mode === 'paused') { /* sheets own their buttons */ }
    });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    function beginFromTitle() { if (mode !== 'title' || !booted) return; audio.unlock(); audio.ui(G.t); startLevel(firstRef()); }
    const click = (node, fn) => ctx.listen(node, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    H.begin.style.pointerEvents = 'auto';
    click(H.begin, beginFromTitle);
    click(H.notesBtn, () => { if (booted) showNotes(false); });
    click(H.soundBtn, toggleSound);
    click(H.pause, () => { if (mode === 'play' || mode === 'finale') pauseGame(); else if (mode === 'paused') resumeGame(); });
    click(H.paper, ev => {
      const a = ev.target.closest('[data-a]'), ent = ev.target.closest('[data-w],[data-d]');
      if (ent) { audio.ui(G.t); hideSheet(); if (ent.dataset.d) startLevel({ daily: true }); else startLevel({ world: ent.dataset.w, index: +ent.dataset.i }); return; }
      if (!a) return;
      const k = a.dataset.a; audio.ui(G.t, k !== 'leave');
      if (k === 'resume') resumeGame();
      else if (k === 'again') { hideSheet(); startLevel(levelRef); }
      else if (k === 'next') { hideSheet(); const n = nextRef(); startLevel(n || levelRef); }
      else if (k === 'notes') showNotes(mode === 'paused');
      else if (k === 'sound') { toggleSound(); showPause(); }
      else if (k === 'leave') { hideSheet(); audio.resume(); attract(); }
      else if (k === 'close') { hideSheet(); if (mode === 'paused') { if (H.paper.dataset.from === 'pause') showPause(); else resumeGame(); } else if (mode === 'complete') { attract(); } }
    });
    ctx.listen(window, 'keydown', e => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); audio.unlock(); if (mode === 'play') tap(); else if (mode === 'title') beginFromTitle(); else if (mode === 'paused') resumeGame(); }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play' || mode === 'finale') pauseGame(); else if (mode === 'paused') resumeGame(); }
    });
    ctx.listen(window, 'blur', () => { if (mode === 'play') pauseGame(); });

    // ---------- layout ----------
    function layout() {
      const w = ctx.width, h = ctx.height, a = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 120, left: 0, right: 0 };
      ui.style.setProperty('--st', (a.top || 0) + 'px'); ui.style.setProperty('--sb', (a.bottom || 0) + 'px');
      ui.style.setProperty('--sl', (a.left || 0) + 'px'); ui.style.setProperty('--sr', (a.right || 0) + 'px');
      renderer.setSize(w, h, false);
      H.title.classList.toggle('land', w > h);
      if (world) frameCamera();
    }
    ctx.onResize(() => layout(), { immediate: true });

    // ---------- loop ----------
    let booted = false, skipRender = false;
    function step(dt) {
      if (destroyed) return;
      dt = Math.min(0.05, Math.max(0, dt));
      const live = mode !== 'paused';
      if (live) {
        G.t += dt;
        // ops that slipped by
        for (const op of G.ops) {
          if (op.done) continue;
          if (autopilot && !op.harmful && (!world.botWants || world.botWants(op))) {
            const err = autopilot === 2 ? 0 : (op.err ?? (op.err = (G.rng() - 0.5) * 0.12 + (G.rng() < 0.08 ? 0.6 : 0)));
            if (G.t >= op.t + err) { op.done = true; const r = classify(err, run ? run.L : { win: [0.1, 0.22] }); world.resolve(op, r, err, G); if (run && mode === 'play') result(r, op); else if (!run) G.flow = clamp(G.flow + (r === 'flow' ? 0.02 : -0.01), 0.3, 0.75); continue; }
          }
          if (G.t - op.t > LATE) {
            op.done = true; world.passed(op, G);
            if (run && mode === 'play' && !op.optional) result(op.harmful ? 'weathered' : 'miss', op);
          }
        }
        if (G.ops.length > 40) G.ops = G.ops.filter(o => !o.done);
        if (mode === 'play' || mode === 'finale') { if (!run.done && G.t - run.lastFlowT > 6) G.flow = Math.max(0, G.flow - dt * 0.01); }
        world.update(dt, G);
        audio.flow = G.flow; audio.simNow = G.t;
        audio.update(dt, world.audioState(G));
        if (mode === 'play' && run) {
          const o = world.objective(G);
          if (o.done || (o.timed && G.t - run.tStart >= run.L.goal.secs)) beginFinale();
          try { if (!o.timed && o.need) ctx.platform.setProgress(clamp(o.ticks / o.need)); } catch (e) { }
          if (run.noteT > 0) { run.noteT -= dt; if (run.noteT <= 0) H.note.classList.add('hide'); }
        }
        if (mode === 'finale') {
          run.finaleT += dt; G.flow = damp(G.flow, 1, 0.8, dt);
          cam.orbit = damp(cam.orbit, -0.06, 0.6, dt); cam.push = Math.max(cam.push, 0.35);
          if (run.finaleT > 4.6) finishLevel();
        }
        if (mode === 'complete') { cam.orbit = damp(cam.orbit, -0.08, 0.3, dt); G.flow = damp(G.flow, 0.9, 0.5, dt); }
        if (mode === 'title') cam.orbit = Math.sin(G.t * 0.05) * 0.05;
      }
      if (run) { renderObjective(); renderScore(run.score); }
      renderFlow(live ? dt : 0);
      updateHint();
      if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) H.say.classList.remove('on'); }
      updateCamera(dt, G.t);
      if (sky) sky.position.copy(camera.position);
      if (!skipRender) renderer.render(scene, camera);
      frameWall = performance.now();
    }
    // the first-ever gust gets a pencilled note; nothing after that
    const _hp = new THREE.Vector3();
    let fingerShown = 0;
    function project(v) { _hp.copy(v).project(camera); return [(_hp.x * 0.5 + 0.5) * ctx.width, (-_hp.y * 0.5 + 0.5) * ctx.height]; }
    function updateHint() {
      const show = mode === 'play' && !save.seenCatch && world.id === 'windmill' && run && run.L.n === 1;
      const h = show ? world.hint() : null;
      if (!h) { H.hint.classList.add('hide'); H.finger.classList.remove('on'); return; }
      const g = h.gust, s = clamp((G.t - g.t0) / (g.tA - g.t0));
      const pts = []; for (let i = 0; i <= 20; i++) { const u = lerp(Math.max(0, s - 0.05), 1, i / 20); pts.push(project(g.curve.getPointAt(u))); }
      H.hintPath.setAttribute('d', 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L'));
      const e = pts[pts.length - 1], q = pts[pts.length - 2], ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
      H.hintHead.setAttribute('d', `M${e[0] - Math.cos(ang - 0.5) * 10},${e[1] - Math.sin(ang - 0.5) * 10} L${e[0]},${e[1]} L${e[0] - Math.cos(ang + 0.5) * 10},${e[1] - Math.sin(ang + 0.5) * 10}`);
      const head = pts[0]; H.hintLbl.style.left = clamp(head[0], 90, ctx.width - 90) + 'px'; H.hintLbl.style.top = (head[1] - 14) + 'px';
      H.hint.classList.toggle('hide', s < 0.08 || s > 0.995);
      H.finger.classList.toggle('on', s > 0.72);
    }

    let frozen = false;
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => { if (!frozen) step(dtMs / 1000); } });
    else ctx.onFrame(dtMs => { if (!frozen) step(dtMs / 1000); });

    // first frame
    try {
      useWorld('windmill');
      attract();
      step(0.016);
    } catch (e) { bootFail('frame', e); return; }
    booted = true;
    H.begin.textContent = 'begin';
    try { ctx.platform.ready(); } catch (e) { }
    hydrate.then(() => { if (!destroyed) { audio.setMuted(!!save.muted); H.soundBtn.textContent = 'SOUND · ' + (save.muted ? 'OFF' : 'ON'); if (Object.keys(save.done).length) H.begin.textContent = 'continue'; } });

    if (window.__TWK_DEV) {
      window.__twk = {
        G, get mode() { return mode; }, get run() { return run; }, get world() { return world; }, save: () => save, camera, scene, renderer, audio,
        start: (w, i) => startLevel(w === 'daily' ? { daily: true } : { world: w, index: i }), attract, tap, pauseGame, resumeGame, showNotes,
        // advance simulation deterministically, optionally tapping perfectly (skill 0..1)
        sim(secs, skill = -1, offset = 0, noise = 0) {
          const n = Math.round(secs * 60);
          for (let i = 0; i < n; i++) {
            if (skill >= 0 && mode === 'play') {
              for (const o of G.ops) { if (o.done || o.harmful) continue; if (o.bot === undefined) o.bot = Math.random() < skill ? offset + (Math.random() - 0.5) * 2 * noise : null; if (o.bot !== null && world.botWants && G.t > o.t - 0.3 && !o.botChecked) { o.botChecked = true; if (!world.botWants(o)) o.bot = null; } }
              const due = G.ops.find(o => !o.done && !o.harmful && o.bot !== null && G.t + 1 / 60 >= o.t + o.bot + INPUT_BIAS);
              if (due) { frameWall = performance.now(); tap(); }
            }
            skipRender = i < n - 1; step(1 / 60);
          }
          skipRender = false;
        },
        freeze(on) { frozen = on; },
        unlockAll() { for (const wid of ORDER) worlds[wid].levels.forEach((_, i) => { save.done[wid + '-' + (i + 1)] = { best: 1, s: [1, 0, 0] }; }); }
      };
    }
  }
};
