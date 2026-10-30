// The game: run or hide, the pursuit, the camera, events and screens.
window.plethoraBit = {
  meta: { title: "DON'T LOOK BACK", runtime: 'plethora-bit@2', tags: ['arcade', 'horror', '3d', 'endless', 'runner'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- DOM shell, drawn before the engine loads ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 70%,#1b2342,#05060e 80%)';
    const ui = ctx.createRoot({ className: 'dl', layer: 'overlay', input: 'passthrough' });
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'dl-vig'); H.danger = el('div', 'dl-danger'); el('div', 'dl-grain');
    H.top = el('div', 'dl-top');
    const tl = el('div', '', '', H.top); H.dist = el('div', 'dl-dist', '0<small>m</small>', tl); H.best = el('div', 'dl-best', '', tl);
    H.pause = el('div', 'dl-pause', ICON_PAUSE, H.top);
    H.bottom = el('div', 'dl-bottom'); H.ctx = el('div', 'dl-ctx', '', H.bottom); H.bar = el('div', 'dl-bar', '<b></b>', H.bottom); H.barFill = H.bar.firstChild; el('div', 'dl-barl', 'BREATH', H.bottom);
    H.stage = el('div', 'dl-stage');
    H.hint = el('div', 'dl-hint', '<i></i><span></span>'); H.hintT = H.hint.lastChild;
    H.title = el('div', 'dl-title');
    const lg = el('div', '', '', H.title); el('div', 'dl-logo', "<span>DON'T</span>LOOK BACK", lg); el('div', 'dl-sub', 'Something is following you.', lg);
    const ft = el('div', 'dl-foot', '', H.title); H.tap = el('div', 'dl-tap', 'LOADING', ft); H.tbest = el('div', 'dl-tb', '', ft);
    H.fade = el('div', 'dl-fade'); H.eyes = el('div', 'dl-eyes', '<b></b><b></b>');
    H.over = el('div', 'dl-panel dl-over');
    el('div', 'dl-h', "YOU DIDN'T MAKE IT.", H.over); H.ostats = el('div', 'dl-stats', '', H.over); H.onew = el('div', 'dl-new', '', H.over);
    const ob = el('div', 'dl-btns', '', H.over); H.again = el('button', 'dl-b pri', 'TRY AGAIN', ob); H.menu = el('button', 'dl-b', 'MAIN MENU', ob);
    H.paused = el('div', 'dl-panel pz'); el('div', 'dl-h', 'Paused', H.paused); H.pstats = el('div', 'dl-stats', '', H.paused);
    const pb = el('div', 'dl-btns', '', H.paused); H.resume = el('button', 'dl-b pri', 'RESUME', pb); H.pmenu = el('button', 'dl-b', 'MAIN MENU', pb);
    const setHud = on => { H.top.style.opacity = on ? 1 : 0; H.bottom.style.opacity = on ? 1 : 0; H.pause.style.pointerEvents = on ? 'auto' : 'none'; };
    setHud(false);
    if (save.best > 0) H.tbest.textContent = 'PERSONAL BEST  ' + save.best + ' M';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }

    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The forest could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      H.tap.style.display = 'none'; el('div', 'dl-err', msg);
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 1.6 : 1.5));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- scene ----------
    // hidden scratch canvases for the procedural textures
    const A = createAssets(THREE, () => { const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' }); c.style.display = 'none'; return c; });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, ctx.width / ctx.height, 0.1, 320);
    scene.add(camera);
    const MOON = new THREE.Vector3(0.32, 0.36, 1).normalize();
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { horizon: { value: new THREE.Color('#1b2342') }, zenith: { value: new THREE.Color('#070a1a') }, glow: { value: new THREE.Color('#2c3766') }, moon: { value: MOON.clone() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 horizon, zenith, glow, moon; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){ vec3 d = normalize(vDir); float y = clamp(d.y, 0., 1.);
          vec3 c = mix(horizon, zenith, pow(y, .55));
          float m = max(dot(d, moon), 0.);
          c += glow * (pow(m, 4.) * .9 + pow(m, 30.) * .9);
          c = mix(c, vec3(.86,.89,1.), smoothstep(.99935, .99965, m));
          vec3 q = floor(d * 220.); float st = step(.9965, h(q)) * smoothstep(.05, .35, y) * .55;
          c += vec3(st) * (.6 + .4 * sin(h(q + 1.) * 40.));
          gl_FragColor = vec4(c, 1.); }`,
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    scene.fog = new THREE.Fog('#1b2342', 16, 98);
    const hemi = new THREE.HemisphereLight('#5d6cb0', '#1a1830', 0.8); scene.add(hemi);
    const moon = new THREE.DirectionalLight('#b9c6ff', 1.7);
    moon.castShadow = true; moon.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(moon.shadow.camera, { left: -26, right: 26, top: 30, bottom: -24, near: 1, far: 140 });
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.05;
    scene.add(moon); scene.add(moon.target);
    const rim = new THREE.PointLight('#93a6ff', 1.6, 7, 1.4); scene.add(rim);

    const W = createWorld(THREE, A, scene, small);
    const R = createRigs(THREE, A);
    const hero = R.makeWanderer(); scene.add(hero.root);
    hero.root.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
    const beast = R.makeFollower({ seed: 9 }); scene.add(beast.root);
    const eyeLight = new THREE.PointLight('#ffad5c', 0, 8, 1.5); eyeLight.position.set(0, 0.2, -1.4); beast.head.add(eyeLight);
    // eye glows keep a minimum size on screen so a pair of eyes reads even far down the trail
    const eyeScale = (rig, k) => { const d = camera.position.distanceTo(rig.root.position); for (let i = 1; i < rig.eyes.length; i += 2) rig.eyes[i].scale.setScalar(Math.max(0.42, d * k)); };
    const phantom = R.makeFollower({ seed: 23, eye: '#e7e4ff' }); scene.add(phantom.root); phantom.root.visible = false;
    phantom.skin.transparent = true;
    // a pair of eyes alone between the trees
    const eyePair = new THREE.Group(); scene.add(eyePair); eyePair.visible = false;
    const eyeGlow = new THREE.SpriteMaterial({ map: A.T.glow, color: '#ffbf70', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (const s of [-1, 1]) { const g = new THREE.Sprite(eyeGlow); g.scale.set(0.5, 0.36, 1); g.position.set(s * 0.16, s > 0 ? 0.03 : 0, 0); eyePair.add(g); }
    // bats
    const batGeo = A.merge([{ geo: new THREE.SphereGeometry(0.07, 5, 4), color: '#0a090f' }, { geo: new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.05, 0.42, 0.08, 0.05, 0.06, 0, 0.08, 0, 0, -0.05, -0.06, 0, 0.08, -0.42, 0.08, 0.05]), 3)), color: '#0d0b14' }]);
    const bats = new THREE.InstancedMesh(batGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 16); bats.frustumCulled = false; bats.visible = false; scene.add(bats);
    const batState = { t: -1, list: [] };
    // drifting motes near the lens
    const motes = (() => {
      const n = small ? 220 : 340, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), r = makeRng(3);
      for (let i = 0; i < n * 3; i += 3) { p[i] = (r() - 0.5) * 30; p[i + 1] = r() * 9; p[i + 2] = (r() - 0.5) * 40; }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#aab6ee', size: 0.06, map: A.T.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; scene.add(m); return { m, base: p.slice(), n };
    })();

    const audio = createAudio(!!caps.audio);
    ctx.onDestroy(() => audio.close());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;

    // ---------- state ----------
    let mode = 'title', run = null, time = 0, hintStep = 0, title = true, safeBot = 0;
    const HP = new THREE.Vector3(), FP = new THREE.Vector3(), HEAD = new THREE.Vector3();
    const input = { hold: false, ptr: null, keys: new Set() };
    const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dpos: new THREE.Vector3(), dlook: new THREE.Vector3(), init: false, swing: 0, shake: 0, roll: 0, fov: 62 };
    const _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 }, _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
    const fogCols = STAGES.map(s => new THREE.Color(s.fog)), skyCols = STAGES.map(s => new THREE.Color(s.sky)), zenCols = STAGES.map(s => new THREE.Color(s.zen));
    const at = (s, u, y, out) => { trailPoint(s, u, _a); (out || _v).set(_a.x, groundY(_a.x, _a.z) + (y || 0), _a.z); return out || _v; };

    function newRun() {
      const seed = (Math.random() * 1e9) | 0;
      W.reset(seed);
      run = {
        s: 0, u: 0, uT: 0, v: 0, y: 0, stamina: 100, exhausted: false, state: 'stop', spot: null, hideT: 0, tripT: 0, vaultT: 0, time: 0, heat: 0,
        from: null, moveT: 0, stage: 0, best: save.best, fogSurge: 0, ev: { next: 9, owl: 4, creak: 7, whisper: 20 }, apparition: null, catchT: 0, over: false,
        stepSign: 1, mStepSign: 1, breathT: 0, heartT: 0, inhale: false, ctxMsg: '', danger: 0, warnedSearch: false,
        M: { mode: 'stalk', gap: 36, lat: 0, speed: 0, timer: 0, spotted: false, lostT: 0, exit: 1, vs: -36, vu: 0, seen: 0 }
      };
      W.update(0, 0, time, camera);
      cam.init = false;
    }

    // ---------- the pursuit ----------
    const runSpeed = d => 7.4 + 3.2 * d;
    const hideWindow = d => lerp(7.8, 5.0, d);
    const breathNeed = d => 30 + 25 * d;
    function startHide(sp) {
      const r = run;
      r.state = 'toHide'; r.spot = sp; r.hideT = 0; r.moveT = 0; r.y = 0; r.from = { s: r.s, u: r.u };
      // seen going into cover: it will come straight to it
      r.M.spotted = r.M.mode === 'stalk' && r.M.gap < 5.5;
      audio.hideRustle(); haptic('light');
      if (hintStep === 3) { hintStep = 4; showHint('WAIT FOR IT TO PASS', 3.5, true); }
    }
    function leaveHide() {
      const r = run, M = r.M, sp = r.spot;
      r.state = 'leave'; r.moveT = 0; r.from = { s: r.s, u: r.u }; r.uT = sp.side * (sp.halfW - 0.7);
      audio.hideRustle();
      if (M.mode === 'pass') {
        const d = Math.abs(M.gap);
        if (d < 4.5) { catchPlayer('seen'); return; }
        if (d < 12) { M.mode = 'stalk'; M.gap = 7; r.heat = 1; haptic('warning'); }
        else loseTrail();
      } else if (M.mode === 'search') { M.mode = 'stalk'; M.gap = 6.5; r.heat = 1; haptic('warning'); }
      M.spotted = false;
    }
    // it has gone past and wanders off the trail for a while
    function loseTrail() {
      const r = run, M = r.M;
      M.mode = 'lost'; M.timer = lerp(7, 3, difficultyAt(r.s)) + Math.random() * 2; M.lostT = 0;
      M.exit = r.spot ? -r.spot.side : (Math.random() < 0.5 ? -1 : 1);
    }
    function catchPlayer(reason) {
      const r = run; if (r.over) return;
      r.state = 'caught'; r.M.mode = 'catch'; r.catchT = 0; r.reason = reason;
      audio.sting(); haptic('heavy');
      mode = 'caught';
      endRun();
    }
    function trip(o) {
      const r = run;
      r.state = 'trip'; r.tripT = o.kind === 'bridge' ? 1.0 : 0.72; r.v *= 0.18; r.stamina = Math.max(0, r.stamina - 8); r.heat = Math.min(1, r.heat + 0.25);
      if (o.kind === 'bridge') r.dip = 1;
      audio.stumble(); haptic('medium');
      for (const b of o.blocks) if (r.u > b[0] - 0.3 && r.u < b[1] + 0.3 && b[0] > -50 && b[1] < 50) { const left = b[0] - 0.35, right = b[1] + 0.35; r.uT = Math.abs(r.u - left) < Math.abs(r.u - right) ? left : right; }
    }

    function step(dt) {
      const r = run, M = r.M;
      if (r.over && r.state !== 'caught') return;
      r.time += dt;
      const d = difficultyAt(r.s), halfW = stageParam(r.s, 'halfW'), lim = halfW - 0.3;
      const intro = clamp(r.time / 15, 0.35, 1);
      const prevS = r.s;
      // ---- the wanderer ----
      switch (r.state) {
        case 'stop': case 'run': case 'vault': {
          if (input.hold) { if (r.state === 'stop') r.state = 'run'; }
          else { const sp = W.coverNear(r.s, r.u); if (sp) { startHide(sp); break; } r.state = 'stop'; }
          const target = r.state === 'stop' ? 0 : runSpeed(d) * (r.exhausted ? 0.6 : 1);
          r.v = target > r.v ? Math.min(target, r.v + 15 * dt) : Math.max(target, r.v - 20 * dt);
          r.s += r.v * dt;
          if (r.v > 0.3) r.u = damp(r.u, r.uT, 9, dt);
          if (r.state === 'vault') { r.vaultT -= dt; r.y = Math.sin(Math.PI * clamp(1 - r.vaultT / 0.44, 0, 1)) * 0.6; if (r.vaultT <= 0) { r.y = 0; r.state = input.hold ? 'run' : 'stop'; } }
          if (r.state === 'stop') r.stamina += (r.v < 1 ? 11 : 0) * dt;
          else r.stamina -= (9.2 + 3.2 * d) * dt * (r.exhausted ? 0.25 : 1);
          break;
        }
        case 'trip':
          r.tripT -= dt; r.v = damp(r.v, 0, 6, dt); r.s += r.v * dt; r.u = damp(r.u, r.uT, 6, dt);
          if (r.tripT <= 0) { r.state = input.hold ? 'run' : 'stop'; r.dip = 0; }
          break;
        case 'toHide': {
          r.moveT += dt / 0.4; const t = smooth(r.moveT);
          r.s = lerp(r.from.s, r.spot.s, t); r.u = lerp(r.from.u, r.spot.hideU, t); r.v = 0; r.uT = r.u;
          r.stamina += 12 * dt;
          if (r.moveT >= 1) r.state = 'hide';
          break;
        }
        case 'hide':
          // breath comes back slowly while it is close: you are holding it
          r.hideT += dt; r.stamina += (M.mode === 'pass' || (M.mode === 'stalk' && M.gap < 8) ? 4 : 17) * dt;
          if (input.hold) leaveHide();
          break;
        case 'leave': {
          r.moveT += dt / 0.3; const t = smooth(r.moveT);
          r.u = lerp(r.from.u, r.uT, t); r.v = Math.min(runSpeed(d), r.v + 12 * dt); r.s += r.v * dt * t;
          if (r.moveT >= 1) r.state = input.hold ? 'run' : 'stop';
          break;
        }
        case 'caught': r.catchT += dt; r.v = 0; break;
      }
      if (r.state === 'caught') { stepCatch(dt); return; }
      r.u = clamp(r.u, r.state === 'hide' || r.state === 'toHide' || r.state === 'leave' ? -halfW - 5 : -lim, r.state === 'hide' || r.state === 'toHide' || r.state === 'leave' ? halfW + 5 : lim);
      r.stamina = clamp(r.stamina, 0, 100);
      if (!r.exhausted && r.stamina <= 0 && (r.state === 'run' || r.state === 'vault')) { r.exhausted = true; haptic('warning'); audio.breath(1, true); }
      if (r.exhausted && r.stamina >= 35) r.exhausted = false;
      // ---- obstacles: low ones are vaulted at speed, the rest must be steered around ----
      if (r.state === 'run' || r.state === 'vault' || r.state === 'stop' || r.state === 'leave') {
        for (const o of W.obstacles) {
          if (o.hit) continue;
          const a = o.s - o.len / 2, b = o.s + o.len / 2;
          if (r.s < a || prevS > b) continue;
          if (o.low) {
            if (prevS <= o.s && r.s > o.s) {
              o.hit = true;
              if (r.state === 'run' && r.v > 4.6 && !r.exhausted) { r.state = 'vault'; r.vaultT = 0.44; r.stamina -= 3; audio.cloth(); haptic('light'); }
              else if (r.state !== 'vault') trip(o);
            }
          } else if (o.blocks.some(bk => r.u + 0.26 > bk[0] && r.u - 0.26 < bk[1])) { o.hit = true; trip(o); }
        }
      }
      // ---- heat: how much noise has been made ----
      const moving = r.state === 'run' || r.state === 'vault' || r.state === 'leave';
      const hidden = r.state === 'hide' || r.state === 'toHide';
      r.heat = clamp(r.heat + (moving ? (0.045 + 0.05 * d + (r.exhausted ? 0.1 : 0)) : hidden ? -0.16 : -0.04) * dt, 0, 1);
      // ---- the follower ----
      const pv = moving ? r.v : r.state === 'trip' ? r.v : 0;
      const win = hideWindow(d);
      switch (M.mode) {
        case 'stalk': {
          let ms;
          if (hidden) ms = (M.spotted || r.hideT > win) ? 9 + 2 * d : M.gap > 18 ? 7.6 + 2.4 * d : 3.8 + 2.4 * d;
          else if (pv > 0.5) ms = pv + (0.3 + 1.5 * d + 0.9 * r.heat + (r.exhausted ? 1.2 : 0)) * intro;
          else ms = (6 + 2 * d) * (0.6 + 0.4 * intro);
          if (M.gap > 52 && ms < pv) ms = pv;
          M.speed = ms; M.gap -= (ms - pv) * dt;
          if (!hidden && M.gap <= 1.0) catchPlayer('caught');
          else if (hidden && M.gap <= 1.7) {
            // seen going in, hidden too long, or still gasping for breath: it stops at your cover
            if (M.spotted || r.hideT > win || r.stamina < breathNeed(d)) { M.mode = 'search'; M.timer = lerp(2.4, 1.6, d); haptic('warning'); }
            else { M.mode = 'pass'; }
          }
          break;
        }
        case 'pass':
          M.speed = 2.5; M.gap -= (2.5 - pv) * dt;
          if (M.gap < -13 || !hidden) loseTrail();
          break;
        case 'search':
          M.speed = 0.5; M.timer -= dt;
          if (M.timer <= 0) catchPlayer('found');
          break;
        case 'lost':
          M.lostT += dt; M.gap -= (2.2 - pv) * dt;
          M.timer -= dt * (hidden && r.hideT > win ? 2.5 : 1);
          if (M.timer <= 0) { M.mode = 'stalk'; M.gap = lerp(46, 28, d); M.lat = 0; M.vs = r.s - M.gap; M.vu = 0; }
          break;
      }
      r.s = Math.max(r.s, prevS - 3);
      // ---- events ----
      events(dt, d);
      // ---- tutorial ----
      if (save.tut < 2) {
        if (hintStep === 0 && r.v > 2) { hintStep = 1; showHint('SLIDE TO STEER', 2.8, true); }
        if (hintStep <= 2 && hintStep >= 1 && W.coverNear(r.s, r.u) && r.state === 'run') { hintStep = 3; showHint('LET GO TO HIDE', 2.5, true); }
      }
      const si = stageIndex(r.s);
      if (si !== r.stage) { r.stage = si; showStage(si); }
    }
    function stepCatch(dt) {
      const r = run, M = r.M;
      // the follower closes the last of the distance
      M.gap = damp(M.gap, 0.9, 5, dt);
    }

    // ---------- events: apparitions, bats, lanterns, falling trees, fog ----------
    function events(dt, d) {
      const r = run, ev = r.ev, M = r.M, hidden = r.state === 'hide' || r.state === 'toHide';
      ev.owl -= dt; if (ev.owl <= 0) { audio.owl(); ev.owl = 9 + Math.random() * 14; }
      ev.creak -= dt; if (ev.creak <= 0) { audio.creak(hidden ? 1.6 : 1); ev.creak = 5 + Math.random() * 9; }
      if (r.stage >= 2) { ev.whisper -= dt; if (ev.whisper <= 0) { audio.whisper(); ev.whisper = 14 + Math.random() * 20; } }
      r.fogSurge = Math.max(0, r.fogSurge - dt / 7);
      ev.next -= dt;
      if (ev.next > 0 || r.time < 8) return;
      ev.next = lerp(14, 7, d) * (0.7 + Math.random() * 0.6);
      const st = r.stage, quiet = !hidden && (M.mode === 'lost' || M.gap > 18);
      const opts = [];
      if (quiet && !r.apparition) { opts.push(['eyes', 1 + st]); opts.push(['cross', M.mode === 'lost' ? 3 : 0.8 + st * 0.4]); if (st >= 1) opts.push(['stand', 0.8 + st * 0.5]); }
      opts.push(['bats', 1]);
      if (W.lanterns.some(l => l.lit === 1 && !l.small && l.s > r.s + 12 && l.s < r.s + 40)) opts.push(['lantern', 1.6]);
      if (st >= 1) opts.push(['fog', 0.8]);
      if (st >= 1 && !hidden && r.v > 3) opts.push(['tree', 0.9 + st * 0.2]);
      let tot = 0; for (const o of opts) tot += o[1] * stageParam(r.s, 'apparition') * (o[0] === 'bats' || o[0] === 'lantern' || o[0] === 'fog' || o[0] === 'tree' ? 1.6 : 1);
      let x = Math.random() * tot, pick = null;
      for (const o of opts) { x -= o[1] * stageParam(r.s, 'apparition') * (o[0] === 'bats' || o[0] === 'lantern' || o[0] === 'fog' || o[0] === 'tree' ? 1.6 : 1); if (x <= 0) { pick = o[0]; break; } }
      if (!pick) return;
      if (pick === 'eyes' || pick === 'cross' || pick === 'stand') {
        const side = Math.random() < 0.5 ? -1 : 1;
        r.apparition = { kind: pick, t: 0, side, s: r.s + (pick === 'cross' ? 38 : 30) + Math.random() * 12, u: side * (stageParam(r.s, 'halfW') + 7 + Math.random() * 7), dur: pick === 'cross' ? 6 : pick === 'stand' ? 4.5 : 3.2 };
        if (pick !== 'eyes') audio.creak(0.8);
      } else if (pick === 'bats') { startBats(); audio.bats(); haptic('light'); }
      else if (pick === 'lantern') { if (W.extinguishAhead(r.s)) ctx.timeout(() => audio.hiss(), 500); }
      else if (pick === 'fog') r.fogSurge = 1;
      else if (pick === 'tree') { const f = W.spawnFaller(r.s + 46 + r.v * 0.6); if (f) f.sound = false; }
    }
    function startBats() {
      const r = run, side = Math.random() < 0.5 ? -1 : 1;
      batState.t = 0; batState.list = []; bats.visible = true;
      for (let i = 0; i < 14; i++) batState.list.push({ s: r.s + 9 + Math.random() * 14, u0: side * (12 + Math.random() * 5), u1: -side * (14 + Math.random() * 6), y: 3.5 + Math.random() * 4, delay: Math.random() * 0.7, ph: Math.random() * 6, wob: Math.random() * 6 });
    }

    // ---------- presentation ----------
    let stageTimer = 0, hintTimer = 0;
    function showStage(i) {
      H.stage.innerHTML = `<small>${['I', 'II', 'III', 'IV'][i]}</small>${STAGES[i].name}`; H.stage.style.opacity = 1; stageTimer = 3.8;
      if (i > 0) { audio.stage(); try { ctx.platform.milestone('stage', { stage: i + 1, name: STAGES[i].name }); } catch (e) { } }
    }
    function showHint(text, dur, centred) { H.hint.style.bottom = ((centred ? 132 : 96) + safeBot) + 'px'; H.hintT.innerHTML = text; H.hint.classList.toggle('c', !!centred); H.hint.style.opacity = 1; hintTimer = dur; }
    function setCtx(msg, cls) { if (run.ctxMsg === msg + cls) return; run.ctxMsg = msg + cls; H.ctx.textContent = msg; H.ctx.className = 'dl-ctx ' + (cls || ''); H.ctx.style.opacity = msg ? 1 : 0; }

    const mixA = { danger: 0, hide: 0 };
    let gust = 0, gustT = 0;
    function frame(dt, skipRender) {
      time += dt;
      const r = run, M = r.M, d = difficultyAt(r.s);
      W.update(r.s, dt, time, camera);
      // ---- palette by stage, plus fog surges ----
      const sm = stageMix(r.s), j = Math.min(sm.i + 1, STAGES.length - 1);
      _c.copy(fogCols[sm.i]).lerp(fogCols[j], sm.t);
      scene.fog.color.copy(_c); skyMat.uniforms.horizon.value.copy(_c);
      skyMat.uniforms.glow.value.copy(skyCols[sm.i]).lerp(skyCols[j], sm.t);
      skyMat.uniforms.zenith.value.copy(zenCols[sm.i]).lerp(zenCols[j], sm.t);
      W.setPalette(_c);
      const surge = smooth(r.fogSurge > 0.85 ? (1 - r.fogSurge) / 0.15 : r.fogSurge);
      scene.fog.near = stageParam(r.s, 'fogNear') * (1 - surge * 0.6);
      scene.fog.far = stageParam(r.s, 'fogFar') * (1 - surge * 0.38);
      W.mistMat.uniforms.far.value = scene.fog.far; W.mistMat.uniforms.opacity.value = 0.34 + surge * 0.4 + r.stage * 0.05;
      hemi.intensity = stageParam(r.s, 'hemi'); moon.intensity = stageParam(r.s, 'moon');
      // ---- the wanderer ----
      const hp = at(r.s, r.u, 0, HP);
      let hy = hp.y + r.y;
      if (r.dip) hy -= Math.sin(clamp(1 - r.tripT / 1.0, 0, 1) * Math.PI) * 0.7;
      if (r.state === 'hide' || r.state === 'toHide') { if (r.spot.inside && r.spot.kind === 'hollowLog') hy = hp.y + 0.38 * smooth(r.state === 'hide' ? 1 : r.moveT); }
      hero.root.position.set(hp.x, hy, hp.z);
      let yaw = TRAIL.yaw(r.s) - (r.u - r.uT) * 0.15;
      if (r.state === 'toHide' || r.state === 'hide') yaw = TRAIL.yaw(r.s) + (r.spot.side > 0 ? Math.PI * 0.75 : -Math.PI * 0.75) * smooth(r.state === 'hide' ? 1 : r.moveT) * 0.55;
      if (r.state === 'caught') yaw = TRAIL.yaw(r.s);
      hero.root.rotation.y = damp(hero.root.rotation.y, yaw, 10, dt);
      const hs = r.state === 'run' || r.state === 'leave' ? 'run' : r.state === 'vault' ? 'vault' : r.state === 'trip' ? 'trip' : r.state === 'hide' || r.state === 'toHide' ? 'hide' : r.state === 'caught' ? 'caught' : (r.stamina < 70 && mode === 'play' ? 'recover' : 'idle');
      R.animateWanderer(hero, hs, r.v, dt, { exhausted: r.exhausted, look: r.state === 'caught' ? clamp(r.catchT * 2, 0, 1) * 0.9 : 0, peek: M.mode === 'pass' ? clamp(-M.gap / 10, -0.4, 0.4) : 0 });
      // ---- the follower ----
      let fs = r.s - M.gap, fu = 0;
      const halfW = stageParam(r.s, 'halfW');
      if (M.mode === 'pass') fu = r.spot ? -r.spot.side * halfW * 0.35 : 0;
      else if (M.mode === 'search') { fs = r.spot.s - 1.0; fu = r.spot.objU * 0.55 + Math.sin(time * 0.9) * 0.6; }
      else if (M.mode === 'lost') fu = M.exit * smooth(M.lostT / 2.4) * (halfW + 16);
      else if (M.mode === 'catch') { fs = r.s - Math.max(0.9, M.gap); fu = r.u; }
      else if (M.mode === 'stalk') fu = Math.sin(time * 0.37) * halfW * 0.4;
      if (title) { fs = r.s - 50; fu = 0.4; }
      const snap = Math.abs(M.vs - fs) > 30;
      M.vs = snap ? fs : damp(M.vs, fs, M.mode === 'catch' ? 9 : 3.5, dt); M.vu = snap ? fu : damp(M.vu, fu, 1.6, dt);
      const fp = at(M.vs, M.vu, 0, FP);
      beast.root.position.set(fp.x, fp.y, fp.z);
      let fyaw = TRAIL.yaw(M.vs);
      if (M.mode === 'lost') fyaw -= M.exit * 0.9 * smooth(M.lostT / 2);
      if (M.mode === 'search' || M.mode === 'catch') fyaw = Math.atan2(-(hp.x - fp.x), -(hp.z - fp.z));
      beast.root.rotation.y = damp(beast.root.rotation.y, fyaw, 4, dt);
      const visible = title || (M.mode !== 'lost' || M.lostT < 3.2) && M.gap < 75;
      beast.root.visible = visible;
      let eyes = 1;
      if (M.mode === 'stalk' && M.gap > 18) eyes = 0.35 + 0.65 * (Math.sin(time * 0.7) > -0.2 ? 1 : 0);
      if (M.mode === 'lost') eyes = 1 - smooth(M.lostT / 4);
      if (title) eyes = 0.75 + Math.sin(time * 1.3) * 0.25 * (Math.sin(time * 0.31) > 0.9 ? 0 : 1);
      const fstate = title ? 'stand' : M.mode === 'search' ? 'search' : M.mode === 'catch' ? 'lunge' : M.mode === 'stalk' && M.gap < 4 ? 'loom' : 'walk';
      R.animateFollower(beast, fstate, M.mode === 'pass' ? 2.5 : M.mode === 'lost' ? 2.6 : clamp(M.speed, 0, 12), dt, { eyes, close: M.mode === 'catch' ? clamp((r.catchT - 0.45) / 0.5, 0, 1) : 0, headP: M.mode === 'search' ? 0.5 : 0 });
      // ---- apparitions ----
      updateApparition(dt);
      eyeScale(beast, 0.026); if (phantom.root.visible) eyeScale(phantom, 0.022);
      updateBats(dt);
      // ---- danger ----
      let danger = 0;
      if (M.mode === 'stalk') danger = clamp(1 - (M.gap - 2) / 26, 0, 1);
      else if (M.mode === 'pass') danger = clamp(1 - Math.abs(M.gap) / 16, 0, 1) * 0.85;
      else if (M.mode === 'search' || M.mode === 'catch') danger = 1;
      if (title) danger = 0.1;
      r.danger = danger;
      eyeLight.intensity = title ? 0 : M.mode === 'catch' ? 2.2 : M.mode === 'stalk' ? danger * danger * 1.8 : 0;
      mixA.danger = damp(mixA.danger, danger, 3, dt);
      mixA.hide = damp(mixA.hide, (r.state === 'hide' || r.state === 'toHide') ? 1 : 0, 3, dt);
      // ---- lights follow ----
      moon.target.position.set(hp.x, 0, hp.z - 6); moon.position.copy(moon.target.position).addScaledVector(MOON, 60);
      rim.position.set(hp.x, hp.y + 1.9, hp.z + 1.4);
      rim.intensity = 1.5 + (r.stage >= 3 ? 1.2 : 0) + mixA.hide * 2.5;
      rim.distance = 7 + mixA.hide * 6;
      // ---- camera ----
      updateCamera(dt, hp, fp);
      // ---- motes ----
      const mp = motes.m.geometry.attributes.position, b = motes.base;
      for (let i = 0; i < motes.n; i++) {
        const k = i * 3, ox = b[k] + Math.sin(time * 0.3 + i) * 0.6, oy = b[k + 1] + Math.sin(time * 0.21 + i * 1.7) * 0.4, oz = b[k + 2];
        mp.setXYZ(i, camera.position.x + (((ox - camera.position.x) % 30) + 45) % 30 - 15, oy, camera.position.z + (((oz - camera.position.z) % 40) + 60) % 40 - 20);
      }
      mp.needsUpdate = true;
      // ---- sound ----
      sound(dt, hp, fp);
      // ---- HUD ----
      hud(dt);
      if (!skipRender) renderer.render(scene, camera);
    }
    function updateCamera(dt, hp, fp) {
      const r = run, M = r.M;
      const dpos = cam.dpos, dlook = cam.dlook;
      let k = 4.5;
      if (title || cam.swing > 0) {
        // stand before the wanderer, looking back down the trail; on start, swing around behind
        const sw = title ? 0 : smooth(1 - cam.swing / 1.4);
        const ang = sw * Math.PI, rad = lerp(5.2, 5.0, sw);
        const along = Math.cos(ang) * rad, side = lerp(1.1, 0, sw) + Math.sin(ang) * 2.2;
        at(r.s + along, r.u + side, lerp(1.05, 3.0, sw), dpos);
        at(lerp(r.s - 30, r.s + 10, sw), lerp(-0.2, r.u * 0.3, sw), lerp(2.2, 0.1, sw), dlook);
        if (title) { dpos.x += Math.sin(time * 0.17) * 0.25; dpos.y += Math.sin(time * 0.23) * 0.08; }
        k = 40;
      } else if (r.state === 'hide' || r.state === 'toHide') {
        // from up the trail, looking back: the cover, the wanderer curled behind it, and the way it will come
        const sp = r.spot, hw = sp.halfW;
        at(sp.s + 12, sp.hideU + sp.side * 1.6, 1.3, dpos);
        at(sp.s - 6, sp.side * hw * 0.5, 1.9, dlook);
        k = 2.2;
      } else if (r.state === 'caught') {
        // finally, it turns you around
        const t = smooth(r.catchT / 0.55);
        at(r.s + lerp(-4.0, 2.4, t), r.u + Math.sin(t * Math.PI) * 2.2, lerp(2.2, 1.35, t), dpos);
        beast.head.getWorldPosition(HEAD);
        dlook.copy(at(r.s + 8, r.u * 0.3, 0.8)).lerp(HEAD, t);
        k = 7;
      } else {
        const dg = mixA.danger, back = 5.0 - dg * 1.0;
        at(r.s - back, r.u * 0.55, 3.0 - dg * 0.45, dpos);
        at(r.s + 10, r.u * 0.3, 0.1, dlook);
        k = 4.5;
      }
      if (!cam.init) { cam.pos.copy(dpos); cam.look.copy(dlook); cam.init = true; }
      cam.pos.x = damp(cam.pos.x, dpos.x, k, dt); cam.pos.y = damp(cam.pos.y, dpos.y, k, dt); cam.pos.z = damp(cam.pos.z, dpos.z, k, dt);
      cam.look.x = damp(cam.look.x, dlook.x, k * 1.3, dt); cam.look.y = damp(cam.look.y, dlook.y, k * 1.3, dt); cam.look.z = damp(cam.look.z, dlook.z, k * 1.3, dt);
      if (cam.swing > 0) cam.swing = Math.max(0, cam.swing - dt);
      // shake: footfalls, exhaustion and dread; near-stillness in hiding
      const hidden = r.state === 'hide' || r.state === 'toHide';
      let amp = 0;
      if (!title) amp = hidden ? 0.004 + mixA.danger * 0.012 : (r.state === 'run' || r.state === 'vault' ? 0.03 + r.v * 0.002 : 0.008) + (r.exhausted ? 0.06 : 0) + mixA.danger * mixA.danger * 0.07 + (r.state === 'trip' ? 0.09 : 0);
      if (r.state === 'caught') amp = 0.05 * (1 - clamp(r.catchT / 1.5, 0, 1));
      cam.shake = damp(cam.shake, amp, 6, dt);
      const a = cam.shake;
      camera.position.set(cam.pos.x + Math.sin(time * 13.1) * a + Math.sin(time * 29) * a * 0.4, cam.pos.y + Math.sin(time * 17.3) * a * 0.8 + Math.abs(Math.sin(time * 6.5)) * a * 0.5, cam.pos.z + Math.sin(time * 11.7) * a * 0.5);
      camera.lookAt(cam.look);
      cam.roll = damp(cam.roll, r.exhausted && !hidden ? Math.sin(time * 1.6) * 0.03 : 0, 3, dt);
      camera.rotateZ(cam.roll);
      const fov = (hidden && !title ? 78 : 62) - mixA.danger * 5 + (r.state === 'run' ? r.v * 0.25 : 0);
      cam.fov = damp(cam.fov, fov, 3, dt);
      if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    }
    function updateApparition(dt) {
      const r = run, ap = r.apparition;
      phantom.root.visible = false; eyePair.visible = false;
      if (!ap) return;
      ap.t += dt;
      const fade = smooth(ap.t / 0.8) * (1 - smooth((ap.t - ap.dur + 0.9) / 0.9));
      // it never lets itself be reached
      const near = clamp((ap.s - r.s - 12) / 10, 0, 1);
      const vis = fade * near;
      if (ap.kind === 'eyes') {
        eyePair.visible = true; const p = at(ap.s, ap.u, 2.6 + Math.sin(ap.t) * 0.05); eyePair.position.copy(p);
        const blink = (ap.t % 1.7) < 0.12 ? 0.05 : 1;
        eyeGlow.opacity = vis * 0.95; const es = Math.max(1, camera.position.distanceTo(p) * 0.045); eyePair.scale.set(es, es * blink, es); eyePair.quaternion.copy(camera.quaternion);
      } else {
        phantom.root.visible = vis > 0.02;
        let u = ap.u;
        if (ap.kind === 'cross') u = lerp(-ap.side * 24, ap.side * 24, ap.t / ap.dur);
        const p = at(ap.s, u, 0); phantom.root.position.copy(p);
        phantom.root.rotation.y = TRAIL.yaw(ap.s) + (ap.kind === 'cross' ? (ap.side > 0 ? -Math.PI / 2 : Math.PI / 2) : Math.PI);
        phantom.skin.opacity = vis;
        R.animateFollower(phantom, ap.kind === 'cross' ? 'walk' : 'stand', 3.2, dt, { eyes: vis });
      }
      if (ap.t > ap.dur) r.apparition = null;
    }
    const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _be = new THREE.Euler();
    function updateBats(dt) {
      if (batState.t < 0) return;
      batState.t += dt;
      let alive = false;
      batState.list.forEach((b, i) => {
        const t = clamp((batState.t - b.delay) / 2.4, 0, 1);
        if (t < 1) alive = true;
        const u = lerp(b.u0, b.u1, t), p = at(b.s + Math.sin(t * 3 + b.wob) * 2, u, 0);
        p.y = b.y + Math.sin(t * 9 + b.ph) * 0.5 + groundY(p.x, p.z) * 0;
        const flap = 0.25 + Math.abs(Math.sin(batState.t * 26 + b.ph)) * 1.1;
        _be.set(0, TRAIL.yaw(b.s) + (b.u1 > b.u0 ? -Math.PI / 2 : Math.PI / 2), Math.sin(batState.t * 4 + b.ph) * 0.3); _bq.setFromEuler(_be);
        _bm.compose(p, _bq, _bs.set(t > 0 && t < 1 ? 1.4 : 0, flap, 1.4)); bats.setMatrixAt(i, _bm);
      });
      bats.instanceMatrix.needsUpdate = true;
      if (!alive) { batState.t = -1; bats.visible = false; }
    }

    // ---------- sound ----------
    function sound(dt, hp, fp) {
      const r = run, M = r.M;
      gustT -= dt; if (gustT <= 0) { gust = Math.random(); gustT = 2 + Math.random() * 5; }
      const fwd = _v.subVectors(cam.look, camera.position).normalize();
      audio.listener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.z);
      audio.follower(fp.x, fp.y + 3.2, fp.z);
      const near = beast.root.visible && M.mode !== 'lost' ? clamp(1 - Math.abs(M.vs - r.s) / 40, 0, 1) : 0;
      audio.mix({ danger: mixA.danger, hide: mixA.hide, stage: r.stage, gust, amb: title ? 0.8 : 1, over: mode === 'over' || mode === 'caught', mVol: (title ? 0 : near * near) * (M.mode === 'catch' ? 1.5 : 1) });
      if (mode !== 'play' && mode !== 'caught') return;
      // footfalls on the half-cycle of the gait
      if (r.state === 'run' || r.state === 'leave') { const sg = Math.sign(Math.sin(hero.phase)); if (sg !== r.stepSign) { r.stepSign = sg; audio.step(r.exhausted); } }
      if (beast.root.visible && M.mode !== 'search' && M.mode !== 'catch' && M.mode !== 'lost') {
        const sg = Math.sign(Math.sin(beast.phase)); if (sg !== r.mStepSign) { r.mStepSign = sg; const dist = Math.abs(M.vs - r.s); if (dist < 55) audio.mStep(clamp(1.3 - dist / 45, 0.15, 1.3)); }
      }
      // breath: ragged when spent, held when it is close
      r.breathT -= dt;
      const holding = (r.state === 'hide') && Math.abs(M.gap) < 5 && (M.mode === 'pass' || M.mode === 'search');
      const need = 1 - r.stamina / 100;
      if (!holding && r.breathT <= 0 && (need > 0.35 || r.exhausted || r.state === 'hide')) {
        r.inhale = !r.inhale; audio.breath(clamp(need + (r.exhausted ? 0.4 : 0), 0, 1) * (r.state === 'hide' ? 0.6 : 1), r.inhale);
        r.breathT = (r.state === 'hide' ? 0.9 : lerp(0.7, 0.32, need)) + Math.random() * 0.08;
      }
      r.heartT -= dt;
      if (mixA.danger > 0.3 && r.heartT <= 0) { audio.heart(mixA.danger); r.heartT = lerp(1.0, 0.42, mixA.danger); }
      for (const f of W.fallers) { if (f.started && !f.sound) { f.sound = true; audio.creak(2.5); audio.snap(); haptic('light'); } if (f.landed && !f.crashed) { f.crashed = true; audio.crash(); haptic('medium'); } }
    }

    // ---------- HUD ----------
    let distShown = -1;
    function hud(dt) {
      const r = run, M = r.M;
      if (stageTimer > 0) { stageTimer -= dt; if (stageTimer <= 0) H.stage.style.opacity = 0; }
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) H.hint.style.opacity = 0; }
      H.vig.style.opacity = 0.75 + mixA.hide * 0.2;
      const pulse = 0.5 + 0.5 * Math.sin(time * (3 + mixA.danger * 5));
      H.danger.style.opacity = clamp((mixA.danger - 0.3) * 1.3, 0, 1) * (0.75 + pulse * 0.25);
      if (mode !== 'play') { if (mode !== 'paused') setCtx('', ''); return; }
      const dist = Math.floor(r.s);
      if (dist !== distShown) { distShown = dist; H.dist.innerHTML = dist + '<small>m</small>'; H.best.textContent = 'BEST ' + Math.max(save.best, dist) + ' M'; }
      H.barFill.style.transform = `scaleX(${(r.stamina / 100).toFixed(3)})`;
      H.bar.className = 'dl-bar' + (r.exhausted ? ' ex' : r.stamina < 30 ? ' low' : '');
      // contextual word
      const hidden = r.state === 'hide' || r.state === 'toHide';
      let cover = null;
      if (r.state === 'run' || r.state === 'stop' || r.state === 'vault') cover = W.coverNear(r.s, r.u);
      W.showRing(hidden ? null : cover, cover && !hidden ? 1 : 0, time);
      if (hidden) {
        const close = (M.mode === 'pass' && Math.abs(M.gap) < 12) || (M.mode === 'stalk' && M.gap < 12 && !M.spotted);
        const win = hideWindow(difficultyAt(r.s));
        if (M.mode === 'search') { setCtx('RUN', 'run'); H.ctx.style.opacity = 0.6 + pulse * 0.4; }
        else if (close || r.state === 'toHide') setCtx('', '');
        else { setCtx('RUN', 'run'); H.ctx.style.opacity = r.hideT > win * 0.7 ? 0.55 + pulse * 0.45 : 0.38; }
      } else if (r.exhausted) setCtx('EXHAUSTED', 'ex');
      else if (cover) setCtx('HIDE', 'hide');
      else setCtx('', '');
    }

    // ---------- flow ----------
    function begin(fromTitle) {
      audio.unlock();
      if (!fromTitle) newRun();
      title = false; mode = 'play'; hintStep = 0;
      cam.swing = fromTitle ? 1.4 : 0; if (!fromTitle) cam.init = false;
      H.title.classList.add('off'); H.over.classList.remove('on', 'show'); H.paused.classList.remove('on');
      H.fade.style.opacity = 0; H.eyes.style.opacity = 0;
      setHud(true); distShown = -1;
      showStage(0);
      if (save.tut < 2) showHint('HOLD TO RUN', 4, false);
      try { ctx.platform.start({ run: save.runs + 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function endRun() {
      const r = run; if (r.over) return; r.over = true;
      const dist = Math.floor(r.s), isBest = dist > save.best;
      save.best = Math.max(save.best, dist); save.runs++; if (dist > 40) save.tut = Math.max(save.tut, save.runs >= 2 ? 2 : 1);
      persist();
      try { ctx.platform.fail({ score: dist, distance: dist, reason: r.reason }); } catch (e) { }
      if (scoreTrack) { try { scoreTrack.set(dist); scoreTrack.submit('score', { label: dist + ' m' }).catch(() => { }); } catch (e) { } }
      H.ostats.innerHTML = `DISTANCE: <b>${dist} M</b><br>PERSONAL BEST: <b>${save.best} M</b>`;
      H.onew.textContent = isBest && dist > 0 ? 'A NEW PERSONAL BEST' : '';
      setHud(false); H.hint.style.opacity = 0; H.stage.style.opacity = 0;
      // capture, fade to black, its eyes, then the result
      ctx.timeout(() => { if (mode === 'caught') H.fade.style.opacity = 1; }, 1400);
      ctx.timeout(() => { if (mode === 'caught') { H.eyes.style.opacity = 1; haptic('error'); } }, 2000);
      ctx.timeout(() => { if (mode === 'caught') { mode = 'over'; H.over.classList.add('on'); ctx.timeout(() => H.over.classList.add('show'), 30); reportResult(); } }, 2900);
      ctx.timeout(() => { if (mode === 'over') H.eyes.style.opacity = 0.25; }, 3600);
    }
    // once per finished run, at the result screen
    function reportResult() {
      const dist = Math.floor(run.s);
      try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ score: dist, timeMs: Math.round(run.time * 1000), text: `I ran ${dist} m before it caught me.` }); } catch (e) { }
    }
    function showTitle() {
      newRun(); title = true; mode = 'title';
      H.title.classList.remove('off'); H.over.classList.remove('on', 'show'); H.paused.classList.remove('on');
      H.fade.style.opacity = 0; H.eyes.style.opacity = 0; setHud(false);
      H.tap.textContent = 'TAP TO BEGIN';
      H.tbest.textContent = save.best > 0 ? 'PERSONAL BEST  ' + save.best + ' M' : '';
      cam.init = false;
    }
    function pauseGame() {
      if (mode !== 'play') return;
      mode = 'paused'; input.hold = false; input.ptr = null; audio.suspend();
      H.pstats.innerHTML = `DISTANCE: <b>${Math.floor(run.s)} M</b>`;
      H.paused.classList.add('on');
    }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; H.paused.classList.remove('on'); audio.resume(); }

    // ---------- input: one finger. Hold to run, slide to steer, let go to hide ----------
    const onDown = e => {
      audio.unlock();
      if (mode === 'title') { if (!H.tap.textContent.startsWith('TAP')) return; begin(true); }
      if (mode !== 'play') return;
      if (e.cancelable) e.preventDefault();
      input.ptr = { id: e.pointerId, x0: e.clientX, u0: run.uT }; input.hold = true;
      if (hintStep === 0 && save.tut < 2) H.hint.style.opacity = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    };
    const onMove = e => {
      if (!input.ptr || e.pointerId !== input.ptr.id || mode !== 'play') return;
      const hw = stageParam(run.s, 'halfW') - 0.3;
      if (run.state === 'run' || run.state === 'stop' || run.state === 'vault' || run.state === 'trip') run.uT = clamp(input.ptr.u0 + (e.clientX - input.ptr.x0) / (ctx.width * 0.34) * hw, -hw, hw);
    };
    const onUp = e => { if (!input.ptr || e.pointerId !== input.ptr.id) return; input.ptr = null; input.hold = input.keys.has('run'); };
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    const click = (b, fn) => ctx.listen(b, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(); });
    click(H.again, () => begin(false));
    click(H.menu, showTitle);
    click(H.resume, resumeGame);
    click(H.pmenu, () => { H.paused.classList.remove('on'); audio.resume(); if (run && !run.over) endRunQuiet(); showTitle(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    function endRunQuiet() { const dist = Math.floor(run.s); run.over = true; save.best = Math.max(save.best, dist); save.runs++; persist(); try { ctx.platform.fail({ score: dist, distance: dist, reason: 'quit' }); } catch (e) { } }
    const RUNKEYS = ['Space', 'ArrowUp', 'KeyW'];
    ctx.listen(window, 'keydown', e => {
      if (RUNKEYS.includes(e.code)) {
        e.preventDefault(); audio.unlock();
        if (mode === 'title') { if (H.tap.textContent.startsWith('TAP')) begin(true); }
        else if (mode === 'over' && !e.repeat) { begin(false); return; }
        input.keys.add('run'); input.hold = true;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.keys.add('left');
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.keys.add('right');
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); }
    });
    ctx.listen(window, 'keyup', e => {
      if (RUNKEYS.includes(e.code)) { input.keys.delete('run'); input.hold = !!input.ptr; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.keys.delete('left');
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.keys.delete('right');
    });
    ctx.listen(window, 'blur', () => { input.keys.clear(); input.hold = false; input.ptr = null; if (mode === 'play') pauseGame(); });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden && mode === 'play') pauseGame(); });

    function layout(w, h) {
      // clear of the camera cutout, the home indicator and Plethora's logo button
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      const top = sa.top || 0, bot = sa.bottom || 0;
      H.top.style.paddingTop = (16 + top) + 'px';
      H.bottom.style.paddingBottom = (28 + bot) + 'px';
      safeBot = bot;
      H.title.style.paddingBottom = (16 + bot) + 'px'; H.title.style.paddingTop = (16 + top) + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep a portrait-like framing on wide screens
      camera.updateProjectionMatrix();
    }
    ctx.onResize(({ width, height }) => layout(width, height), { immediate: true });

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function tick(dtMs) {
      if (destroyed || window.__dlbManual) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (mode === 'play' || mode === 'caught' || mode === 'over') {
        if (mode === 'play') {
          const steer = (input.keys.has('right') ? 1 : 0) - (input.keys.has('left') ? 1 : 0);
          if (steer) { const hw = stageParam(run.s, 'halfW') - 0.3; run.uT = clamp(run.uT + steer * 4 * dt, -hw, hw); if (input.ptr) input.ptr.u0 += steer * 4 * dt; }
        }
        acc += dt; let n = 0;
        while (acc >= DT && n < 5) { if (mode === 'play' || mode === 'caught') step(DT); acc -= DT; n++; }
        if (n === 5) acc = 0;
      }
      if (mode === 'paused') return;
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    showTitle();
    // compile every program up front so nothing hitches when it first appears
    try {
      const hiddenOnes = [phantom.root, eyePair, bats];
      for (const o of hiddenOnes) o.visible = true;
      W.warm(true);
      renderer.compile(scene, camera);
      for (const o of hiddenOnes) o.visible = false;
      W.warm(false);
    } catch (e) { }
    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__DLB_DEV) {
      window.__dlb = {
        begin, showTitle, pauseGame, resumeGame, input, camera, scene, renderer, W,
        jump(s) { W.reset((Math.random() * 1e9) | 0, s); run.s = s; run.stage = stageIndex(s); run.M.vs = s - run.M.gap; cam.init = false; frame(DT, true); },
        get run() { return run; }, get mode() { return mode; }, save: () => save,
        advance(sec, hold, settle) { if (hold != null) input.hold = hold; const n = Math.round(sec / DT); for (let i = 0; i < n && (mode === 'play' || mode === 'caught'); i++) { step(DT); if (settle === true) frame(DT, true); } if (!settle) frame(DT); },
        frame: n => { for (let i = 0; i < (n || 1); i++) frame(DT, i < (n || 1) - 1); }
      };
    }
  }
};
