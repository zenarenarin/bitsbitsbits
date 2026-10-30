// =====================================================================
// THE REFLECTION — renderer, the two rooms, the mirror, flow and input.
// The mirror is a second scene: the room rebuilt inside a z-flipped group,
// holding its own cat. It renders to a target the glass samples in screen
// space, which is where distortion, ageing and cues are applied.
// =====================================================================

const SAVE_KEY = 'reflection_save';
const CAT_Z = 0.82, CAT_SCALE = 1.5;
const MIRROR_Z = 0.24, MIRROR_TILT = 0.2, CAT_YAW = Math.PI + 0.5;

const GLASS_VERT = `
varying vec2 vLocal;
void main(){ vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const GLASS_FRAG = `
uniform sampler2D tMirror; uniform vec2 uRes; uniform vec4 uRect; uniform float uTime;
uniform float uRipple, uRippleT, uDesync, uGlint, uGlintT, uDark, uCue, uCueOn;
uniform vec2 uRippleC;
varying vec2 vLocal;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 suv = gl_FragCoord.xy / uRes;
  vec2 luv = (vLocal - uRect.xy) / (uRect.zw - uRect.xy);
  vec2 asp = vec2((uRect.z - uRect.x) / (uRect.w - uRect.y), 1.0);
  vec2 dv = (luv - uRippleC) * asp; float d = length(dv);
  float wave = sin(d * 46.0 - uRippleT * 15.0) * exp(-d * 3.5) * uRipple * smoothstep(uRippleT * 0.45 + 0.05, uRippleT * 0.45 - 0.1, d);
  vec2 off = (dv / (d + 1e-4)) * wave * 0.012;
  off += vec2(sin(luv.y * 17.0 + uTime * 1.3), cos(luv.x * 13.0 + uTime * 1.1)) * 0.0022 * uDesync;
  off += vec2(n2(luv * 5.0 + uTime * 0.2) - 0.5, 0.0) * 0.004 * uDesync * uDesync;
  float ca = 0.0008 + 0.004 * uDesync + abs(wave) * 0.03;
  vec3 col;
  col.r = texture2D(tMirror, suv + off + vec2(ca, 0.0)).r;
  col.g = texture2D(tMirror, suv + off).g;
  col.b = texture2D(tMirror, suv + off - vec2(ca, 0.0)).b;
  // old silvering: a little dimmer, warm-grey, never clean
  col *= vec3(0.93, 0.91, 0.87);
  float edge = min(min(luv.x, 1.0 - luv.x), min(luv.y, 1.0 - luv.y) * 0.8);
  float nz = fbm(luv * vec2(5.0, 8.0) + 1.7);
  float desilver = smoothstep(0.1, 0.0, edge + (nz - 0.5) * 0.13);
  col = mix(col, vec3(0.018, 0.016, 0.014) + col * 0.18, desilver * 0.75);
  float fox = smoothstep(0.7, 0.76, fbm(luv * vec2(19.0, 27.0) + 3.1));
  col *= 1.0 - fox * 0.4;
  col += vec3(0.012, 0.011, 0.01) * fbm(luv * vec2(2.5, 3.5) + 7.0);
  // a warm glint sweeps the glass on perfect timing
  float gp = uGlintT * 1.8 - 0.4;
  col += vec3(1.0, 0.72, 0.4) * exp(-pow((luv.x * 0.8 + luv.y * 0.5 - gp) * 14.0, 2.0)) * uGlint * 0.09;
  // the response cue: a hairline of light along the base, shrinking to the centre
  float base = smoothstep(0.009, 0.0, abs(luv.y - 0.03)) * smoothstep(uCue * 0.42, uCue * 0.42 - 0.03, abs(luv.x - 0.5));
  col += vec3(0.9, 0.5, 0.18) * base * 0.32 * uCueOn;
  col += vec3(0.5, 0.3, 0.12) * smoothstep(0.12, 0.0, edge) * 0.05 * uCueOn;
  col *= 1.0 - uDark;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

window.plethoraBit = {
  meta: { title: 'The Reflection', runtime: 'plethora-bit@2', tags: ['arcade', 'horror', '3d', 'rhythm', 'endless'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = { best: 0, muted: false, runs: 0 };
    const applySave = s => { if (s && typeof s === 'object') save = Object.assign(save, s); };
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s.then === 'function') s.then(v => { applySave(v); refreshBest(); }).catch(() => { }); else applySave(s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) { const r = ctx.storage.set(SAVE_KEY, save); if (r && r.catch) r.catch(() => { }); } } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 40%,#2a211a,#070606 70%)';
    const U = createUI(ctx);
    U.hud(false);
    U.panel(U.start);
    const refreshBest = () => { U.startBest.textContent = save.best > 0 ? 'best ' + Math.floor(save.best).toLocaleString() : ''; };
    refreshBest();
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      U.startBtn.style.display = 'none';
      U.startBest.textContent = stage === 'library' ? 'Could not load the 3D engine. Check your connection.' : 'This device could not start 3D graphics.';
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 1.6 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#050404');
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- the two rooms ----------
    const T = createTextures(THREE, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    const RM = createRoomMaterials(THREE, T);
    const CM = createCatMaterials(THREE);
    const real = new THREE.Scene(), mirror = new THREE.Scene();
    const FOG = '#080706';
    real.fog = new THREE.FogExp2(FOG, 0.07); mirror.fog = new THREE.FogExp2(FOG, 0.045);
    const camera = new THREE.PerspectiveCamera(48, ctx.width / ctx.height, 0.05, 40);
    const mirrorWorld = new THREE.Group(); mirrorWorld.scale.z = -1; mirror.add(mirrorWorld);
    const R = buildRoom(THREE, T, RM, 'real', small); real.add(R.group);
    const RMr = buildRoom(THREE, T, RM, 'mirror', small); mirrorWorld.add(RMr.group);
    const MR = buildMirror(THREE, RM);
    // the glass tilts forward on its pivot, so it looks down at the floor and the cats
    const tilt = new THREE.Group(); tilt.position.set(0, MR.pivotY, MIRROR_Z); tilt.rotation.x = MIRROR_TILT; real.add(tilt);
    MR.group.position.y = -MR.pivotY; tilt.add(MR.group);
    MR.stand.position.z = MIRROR_Z; real.add(MR.stand);
    // the mirror world is the room reflected across the glass plane
    const mN = new THREE.Vector3(0, -Math.sin(MIRROR_TILT), Math.cos(MIRROR_TILT));
    const mP = new THREE.Vector3(0, MR.pivotY, MIRROR_Z);
    const mD = mN.dot(mP);
    mirrorWorld.scale.z = 1; mirrorWorld.matrixAutoUpdate = false;
    {
      const [x, y, z] = [mN.x, mN.y, mN.z];
      mirrorWorld.matrix.set(
        1 - 2 * x * x, -2 * x * y, -2 * x * z, 2 * mD * x,
        -2 * x * y, 1 - 2 * y * y, -2 * y * z, 2 * mD * y,
        -2 * x * z, -2 * y * z, 1 - 2 * z * z, 2 * mD * z,
        0, 0, 0, 1);
      mirrorWorld.matrixWorldNeedsUpdate = true;
    }
    // only what lies behind the glass may appear in it
    const mirrorClip = [new THREE.Plane(mN.clone().negate(), mD)];
    function lights(parent, candle) {
      const L = {};
      L.hemi = new THREE.HemisphereLight('#2a3446', '#1c130d', 0.8); parent.add(L.hemi);
      L.candle = new THREE.PointLight(PAL.amber, 3.2, 0, 2); L.candle.position.set(candle.pos[0], candle.pos[1] + 0.06, candle.pos[2]); parent.add(L.candle);
      L.moon = new THREE.DirectionalLight(PAL.moon, 1.5);
      L.moon.position.set(-ROOM.W - 3.0, 4.4, 2.9); L.moon.target.position.set(0.2, 0, 0.9);
      L.moon.castShadow = true; L.moon.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
      Object.assign(L.moon.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 });
      L.moon.shadow.bias = -0.0004; L.moon.shadow.normalBias = 0.02; L.moon.shadow.radius = 3;
      parent.add(L.moon); parent.add(L.moon.target);
      // faint warm bounce from the floor near the candle so the frame reads
      L.bounce = new THREE.PointLight('#8a5a30', 0.35, 0, 2); L.bounce.position.set(-0.35, 0.3, 0.3); parent.add(L.bounce);
      return L;
    }
    const LR = lights(real, R.candle), LM = lights(mirrorWorld, RMr.candle);
    // a moonbeam: an additive sheet from the window, very faint
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 3.4), new THREE.MeshBasicMaterial({ map: T.beam, color: '#7f95b6', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    const beamG = new THREE.Group(); beamG.add(beam); beam.position.y = -1.7;
    beamG.position.set(-ROOM.W, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2); beamG.rotation.set(0, Math.PI / 2, 0); beamG.rotateX(-0.95);
    real.add(beamG); const beamM = beamG.clone(); mirrorWorld.add(beamM);
    const dust = createDust(THREE, T, small ? 180 : 320);
    real.add(new THREE.Points(dust.geo, dust.mat)); mirrorWorld.add(new THREE.Points(dust.geo, dust.mat));

    // ---------- cats ----------
    const cat = createCat(THREE, CM, { shadowTex: T.shadow, k: 16, eyeIntensity: 0.25 });
    cat.root.position.set(0, 0, CAT_Z); cat.root.rotation.y = CAT_YAW; cat.root.scale.setScalar(CAT_SCALE); real.add(cat.root);
    const refl = createCat(THREE, CM, { shadowTex: T.shadow, k: 13, eyeIntensity: 0.55, eyeGlow: '#8a5a12' });
    refl.root.position.set(0, 0, CAT_Z); refl.root.rotation.y = CAT_YAW; refl.root.scale.setScalar(CAT_SCALE); mirrorWorld.add(refl.root);

    // ---------- the glass ----------
    const rtScale = small ? 0.8 : 1;
    const rtType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: rtType, samples: renderer.capabilities.isWebGL2 ? (small ? 2 : 4) : 0 });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const G = {
      tMirror: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4(MR.rect.x0, MR.rect.y0, MR.rect.x1, MR.rect.y1) },
      uTime: { value: 0 }, uRipple: { value: 0 }, uRippleT: { value: 9 }, uRippleC: { value: new THREE.Vector2(0.5, 0.2) }, uDesync: { value: 0 },
      uGlint: { value: 0 }, uGlintT: { value: 9 }, uDark: { value: 0 }, uCue: { value: 0 }, uCueOn: { value: 0 }
    };
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(MR.glassShape, 32), new THREE.ShaderMaterial({ uniforms: G, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG }));
    MR.group.add(glass);
    ctx.onDestroy(() => { try { rt.dispose(); } catch (e) { } });

    const audio = createAudio(!!caps.audio);
    audio.setMuted(!!save.muted); U.setMuted(!!save.muted);
    ctx.onDestroy(() => audio.close());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    cat.onStep = a => audio.catMove(a);

    // ---------- run state ----------
    let mode = 'title';       // title | play | paused | over | results
    let D = null, run = null;
    const fx = { shake: 0, unease: 0, flame: 1, mirrorFlame: 1 };
    function ripple(x, y, amt) { G.uRipple.value = Math.max(G.uRipple.value * 0.5, amt); G.uRippleT.value = 0; G.uRippleC.value.set(x, y); }
    // where the reflection sits on the glass, for ripples
    const RC = [0.5, 0.3];
    const _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _glassPlane = new THREE.Plane(mN, -mD);
    function locateReflection() {
      // where the reflection's head sits on the glass, in glass uv
      refl.head.getWorldPosition(_hit);
      _ray.origin.copy(camera.position); _ray.direction.copy(_hit).sub(camera.position).normalize();
      if (!_ray.intersectPlane(_glassPlane, _hit)) return;
      glass.worldToLocal(_hit);
      RC[0] = clamp((_hit.x - MR.rect.x0) / (MR.rect.x1 - MR.rect.x0), 0, 1); RC[1] = clamp((_hit.y - MR.rect.y0) / (MR.rect.y1 - MR.rect.y0), 0, 1);
    }
    function hooks() {
      return {
        reflect(a, kind) {
          if (kind === 'feint') { refl.feintTo(a, CONFIG.feint.dur); audio.deviate(); ripple(RC[0], RC[1] + 0.05, 0.22); return; }
          if (kind === 'tell') { refl.tellOf(); return; }
          refl.perform(a);
          audio.reflectMove(a === 'jump' ? 'jump' : a);
          if (kind !== 'follow' && !run.firstLead) { run.firstLead = true; ripple(RC[0], RC[1], 0.5); fx.shake = 0.25; audio.deviate(); }
        },
        cue(p) { run.cue = p; if (D.promptCount <= CONFIG.hintPrompts) U.btn[p.action].classList.add('hint'); },
        result(g, info) {
          const p = info.prompt;
          if (p) U.btn[p.action].classList.remove('hint');
          if (p && run.cue === p) run.cue = null;
          const y = 1 - (U.padH + 70) / ctx.height;
          if (g === 'perfect') { G.uGlint.value = 1; G.uGlintT.value = 0; audio.perfect(D.perfectStreak); U.say('perfect', y); haptic('light'); U.flashBtn(p.action, 'ok'); }
          else if (g === 'good') { audio.good(); U.say('good', y); U.flashBtn(p.action, 'ok'); }
          else if (g === 'late') { audio.good(); U.say('late', y); }
          else if (g === 'wrong') { audio.wrong(); U.say('wrong', y); ripple(RC[0], RC[1], 0.6); fx.shake = 0.35; refl.lookAt(0, 0.1, 0.9); refl.cur.roll = 0.35; haptic('medium'); }
          else if (g === 'miss') { audio.miss(); U.say('missed', y); ripple(RC[0], RC[1] + 0.1, 0.45); refl.stare = 1.2; refl.lookAt(0, 0.22, 1.2); haptic('medium'); }
          else if (g === 'stray') { audio.deviate(); U.say('alone', y); ripple(RC[0], RC[1], 0.25); }
          else if (g === 'fooled') { audio.wrong(); U.say('fooled', y); ripple(RC[0], RC[1], 0.5); refl.shiver = 1; fx.shake = 0.2; haptic('light'); }
        },
        phase(n) {
          audio.phase();
          if (n === 2) { U.showLine('Then it doesn’t.', 0.36); run.lineOff = D.t + 2.6; }
          try { ctx.platform.milestone('phase_' + n); } catch (e) { }
        },
        level(n) { if (n > 8) try { ctx.platform.milestone('level_' + n); } catch (e) { } },
        warn(s) { audio.warn(s); fx.shake = Math.max(fx.shake, 0.2); haptic('warning'); },
        milestone(id) { audio.milestone(); U.time.classList.add('mark'); run.markOff = D.t + 3; try { ctx.platform.milestone('survived_80'); } catch (e) { } },
        over() { gameOver(); }
      };
    }

    // ---------- flow ----------
    function resetWorld() {
      cat.reset(); refl.reset();
      refl.root.position.set(0, 0, CAT_Z); refl.root.rotation.y = CAT_YAW; refl.root.visible = true;
      fx.mirrorFlame = 1; fx.flame = 1; fx.shake = 0;
      G.uRipple.value = 0; G.uGlint.value = 0; G.uDark.value = 0; G.uCueOn.value = 0;
      for (const b of Object.values(U.btn)) b.classList.remove('hint', 'down', 'ok', 'bad');
      U.time.classList.remove('mark');
    }
    function begin() {
      if (mode === 'play') return;
      audio.unlock(); audio.click();
      resetWorld();
      D = createDirector(hooks(), (Date.now() & 0xffff) + 1);
      run = { cue: null, firstLead: false, lineOff: 3.6, markOff: 0, over: 0, idle: 0, glance: 3 + Math.random() * 3, creak: 6 };
      mode = 'play';
      U.panel(null); U.hud(true); U.shade.classList.remove('on');
      U.showLine('At first, it follows you.', 0.36);
      save.runs++; persist();
      try { ctx.platform.start({ run: save.runs }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function gameOver() {
      if (mode !== 'play') return;
      mode = 'over';
      run.over = 0; run.cue = null;
      U.update(D, Math.max(save.best, D.score));
      U.hideLine();
      for (const b of Object.values(U.btn)) b.classList.remove('hint');
      audio.gameOver(); haptic('error');
      fx.shake = 0.8; ripple(RC[0], RC[1], 1);
      // the real cat flinches; the reflection stops pretending
      cat.perform('crouch'); cat.cur.ears = 1;
      refl.perform('stand'); refl.stare = 2; refl.lookAt(0, 0.25, 1.6);
      const score = Math.floor(D.score);
      run.newBest = score > save.best;
      save.best = Math.max(save.best, score); persist();
      try { ctx.platform.fail({ score, survived: Math.floor(D.t), reason: 'escaped' }); } catch (e) { }
      if (scoreTrack) { try { scoreTrack.set(score); scoreTrack.submit('score', { label: score.toLocaleString() + ' pts' }).catch(() => { }); } catch (e) { } }
      else if (ctx.memory && ctx.memory.record) { try { ctx.memory.record('score').submit(score, { label: score + ' pts' }).catch(() => { }); } catch (e) { } }
    }
    function showResults() {
      mode = 'results';
      U.hud(false); U.shade.classList.add('on');
      U.resNew.textContent = run.newBest ? 'new best' : '';
      U.resStats.innerHTML = `<div><div class="rf-num">${U.fmt(D.t)}</div><div class="rf-lab">survived</div></div><div class="big"><div class="rf-num">${Math.floor(D.score).toLocaleString()}</div><div class="rf-lab">score</div></div><div><div class="rf-num">${Math.floor(save.best).toLocaleString()}</div><div class="rf-lab">best</div></div>`;
      U.panel(U.results);
      refreshBest();
    }
    function pause() { if (mode !== 'play') return; mode = 'paused'; U.panel(U.paused); }
    function resume() { if (mode !== 'paused') return; mode = 'play'; U.panel(null); audio.unlock(); }

    // ---------- input: the player's cat only ----------
    function act(a) {
      if (mode !== 'play') return;
      audio.unlock();
      cat.perform(a);
      const b = U.btn[a]; b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140);
      const r = D.input(a);
      if (r === 'wrong' || r === 'stray' || r === 'fooled') U.flashBtn(a, 'bad');
      try { ctx.platform.interact({ type: 'action', action: a }); } catch (e) { }
    }
    const KEYMAP = { Digit1: 'sit', Digit2: 'stand', Digit3: 'crouch', Digit4: 'paw', Digit5: 'jump', Space: 'jump', Numpad1: 'sit', Numpad2: 'stand', Numpad3: 'crouch', Numpad4: 'paw', Numpad5: 'jump' };
    ctx.listen(window, 'keydown', e => {
      const a = KEYMAP[e.code];
      if (a || e.code === 'Enter' || e.code === 'Escape') e.preventDefault();
      if (e.repeat) return;
      if ((mode === 'title' || mode === 'results') && (e.code === 'Enter' || e.code === 'Space')) { if (mode === 'title' || run.over > 5.2) begin(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); return; }
      if (mode === 'paused' && a) { resume(); return; }
      if (a) act(a);
      if (e.code === 'KeyM') toggleMute();
    });
    for (const a of ACTIONS) ctx.listen(U.btn[a], 'pointerdown', e => { e.preventDefault(); e.stopPropagation(); act(a); });
    function toggleMute() { save.muted = !save.muted; audio.unlock(); audio.setMuted(save.muted); U.setMuted(save.muted); persist(); }
    ctx.listen(U.mute, 'pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleMute(); });
    ctx.listen(U.startBtn, 'click', e => { e.stopPropagation(); begin(); });
    ctx.listen(U.again, 'click', e => { e.stopPropagation(); begin(); });
    ctx.listen(U.resume, 'click', e => { e.stopPropagation(); resume(); });
    ctx.listen(window, 'blur', () => pause());
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

    // ---------- layout & camera ----------
    const camBase = new THREE.Vector3(), camLook = new THREE.Vector3();
    function layout(w, h, safe) {
      U.layout(w, h, safe);
      renderer.setSize(w, h, false);
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(Math.max(4, Math.floor(db.x * rtScale)), Math.max(4, Math.floor(db.y * rtScale)));
      G.uRes.value.set(db.x, db.y);
      const aspect = w / h;
      camera.aspect = aspect;
      // Fixed composition: the cat's feet sit just above the buttons, the
      // mirror's crest just below the top HUD. Solve fov and pitch for that.
      const portrait = aspect < 0.85;
      const dist = portrait ? 3.5 : 3.3, camY = portrait ? 1.62 : 1.55;
      camBase.set(portrait ? 0.14 : 0.24, camY, dist);
      const feetY = 1 - 2 * (1 - (U.padH + 14) / h), topY = 1 - 2 * ((portrait ? 92 : 58) / h);
      const aFeet = Math.atan2(-camY, dist - CAT_Z - 0.18 * CAT_SCALE), aTop = Math.atan2(2.3 - camY, dist);
      const halfW = portrait ? 0.98 : 1.25;
      let fov = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect), pitch = 0;
      for (let f = Math.max(0.6, fov); f < 1.6; f += 0.005) {
        const tf = Math.tan(f / 2);
        pitch = aFeet - Math.atan(feetY * tf);
        if (Math.tan(aTop - pitch) / tf <= topY) { fov = f; break; }
        fov = f;
      }
      camLook.set(0, camY + Math.tan(pitch) * dist, 0);
      camera.fov = fov * 180 / Math.PI;
      camera.updateProjectionMatrix();
    }
    ctx.onResize(({ width, height, safeArea }) => layout(width, height, safeArea || ctx.safeArea), { immediate: true });

    // ---------- loop ----------
    let clock = 0;
    const _p = new THREE.Vector3();
    function frame(dt, skipRender) {
      clock += dt;
      if (mode === 'play') {
        D.update(dt);
        if (mode === 'play') {
          if (run.lineOff && D.t > run.lineOff) { U.hideLine(); run.lineOff = 0; }
          if (run.markOff && D.t > run.markOff) { U.time.classList.remove('mark'); run.markOff = 0; }
          // cosmetic independence: glances and stares that never score
          run.glance -= dt;
          if (run.glance <= 0) {
            const ph = D.phase;
            if (ph === 1) refl.lookAt((Math.random() - 0.5) * 1.1, (Math.random() - 0.3) * 0.3, 0.7 + Math.random() * 0.6);
            else refl.lookAt((Math.random() - 0.5) * 0.4, 0.22, 1 + Math.random());
            run.glance = ph === 1 ? 3 + Math.random() * 4 : 2 + Math.random() * 3;
          }
          // the response timer drawn on the glass
          const p = D.pending();
          if (p && !p.resolved && D.t >= p.cueAt) { const left = clamp(1 - (D.t - p.cueAt) / (p.deadline - p.cueAt), 0, 1); G.uCue.value = left; G.uCueOn.value = Math.min(1, G.uCueOn.value + dt * 12); }
          else G.uCueOn.value = Math.max(0, G.uCueOn.value - dt * 6);
          const target = 1 - D.sync / 100;
          fx.unease = damp(fx.unease, clamp(target + (D.phase - 1) * 0.12, 0, 1), 1.5, dt);
          U.update(D, Math.max(save.best, D.score));
        }
      } else if (mode === 'over') {
        run.over += dt;
        const o = run.over;
        G.uCueOn.value = Math.max(0, G.uCueOn.value - dt * 6);
        fx.unease = damp(fx.unease, 1, 2, dt);
        // it turns from the glass and walks out of the mirror
        if (o > 1.5) {
          const u = clamp((o - 1.5) / 0.8, 0, 1);
          refl.root.rotation.y = lerp(CAT_YAW, 2 * Math.PI - 0.6, smooth(u));
          refl.walk = Math.min(1, (o - 1.5) * 2); refl.stare = 0;
          const sp = 0.42 * refl.walk * CAT_SCALE;
          refl.root.position.x += Math.sin(refl.root.rotation.y) * sp * dt;
          refl.root.position.z += Math.cos(refl.root.rotation.y) * sp * dt;
        }
        if (o > 4.3 && fx.mirrorFlame > 0) { if (fx.mirrorFlame === 1) audio.snuff(); fx.mirrorFlame = Math.max(0, fx.mirrorFlame - dt * 3); }
        if (o > 5.2 && mode === 'over') showResults();
      } else if (mode === 'results') {
        run.over += dt;
        refl.walk = 0; refl.root.visible = refl.root.position.z < 4.5;
        if (refl.root.visible) { refl.walk = 1; const sp = 0.42 * CAT_SCALE; refl.root.position.x += Math.sin(refl.root.rotation.y) * sp * dt; refl.root.position.z += Math.cos(refl.root.rotation.y) * sp * dt; }
      } else if (mode === 'title') {
        fx.unease = damp(fx.unease, 0.15, 1, dt);
        // on the title the reflection is a little too still, and looks at you
        if (Math.random() < dt * 0.25) refl.lookAt((Math.random() - 0.5) * 0.3, 0.2, 2.5);
      }
      if (mode !== 'paused') {
        cat.update(dt); refl.update(dt);
        refl.stare = Math.max(0, refl.stare - dt);
        dust.update(clock, dt);
      }
      // candles breathe together; the mirror's may go out on its own
      const fl = 0.86 + Math.sin(clock * 9.1) * 0.05 + Math.sin(clock * 23.7) * 0.035 + (Math.random() - 0.5) * 0.05;
      const gutter = 1 - fx.unease * 0.28;
      LR.candle.intensity = 3.2 * fl * gutter;
      LM.candle.intensity = 3.2 * fl * gutter * fx.mirrorFlame;
      for (const [c, k] of [[R.candle, 1], [RMr.candle, fx.mirrorFlame]]) { c.flame.scale.set(0.035 * (0.9 + fl * 0.1) * k + 0.0001, 0.072 * fl * k + 0.0001, 1); c.halo.material.opacity = 0.3 * fl * k * gutter; }
      LR.moon.intensity = LM.moon.intensity = 1.5 + fx.unease * 0.35;
      // the glass
      G.uTime.value = clock;
      G.uRippleT.value += dt; G.uRipple.value = Math.max(0, G.uRipple.value - dt * 0.55);
      G.uGlintT.value += dt; G.uGlint.value = Math.max(0, G.uGlint.value - dt * 1.2);
      G.uDesync.value = damp(G.uDesync.value, fx.unease * fx.unease * 1.1, 2, dt);
      G.uDark.value = damp(G.uDark.value, mode === 'results' || (mode === 'over' && run.over > 4.3) ? 0.35 : fx.unease * 0.12, 2, dt);
      if (mode === 'play' || mode === 'over' || mode === 'paused') audio.ambience(fx.unease);
      if (mode === 'play') { run.creak -= dt; if (run.creak < 0) { audio.creak(); run.creak = 7 + Math.random() * 10; } }
      // camera: still, with a breath of drift; a short shake on deviations
      fx.shake = Math.max(0, fx.shake - dt * 1.6);
      const s = fx.shake * fx.shake * 0.03;
      camera.position.set(camBase.x + Math.sin(clock * 0.31) * 0.012 + (Math.random() - 0.5) * s, camBase.y + Math.sin(clock * 0.23) * 0.008 + (Math.random() - 0.5) * s, camBase.z);
      camera.lookAt(camLook);
      if (window.__rfCam) { camera.position.fromArray(window.__rfCam.pos); camera.lookAt(new THREE.Vector3().fromArray(window.__rfCam.look)); }
      // render: the mirror room into the glass, then the room
      if (skipRender) return;
      locateReflection();
      renderer.clippingPlanes = mirrorClip;
      renderer.setRenderTarget(rt); renderer.render(mirror, camera);
      renderer.clippingPlanes = [];
      renderer.setRenderTarget(null); renderer.render(real, camera);
    }
    function tick(dtMs) {
      if (destroyed) return;
      frame(Math.min(0.05, Math.max(0, dtMs / 1000)));
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: tick });
    else ctx.onFrame(tick);

    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__REFLECTION_DEV) {
      window.__rf = {
        begin, act, pause, resume, frame, cat, refl, camera, G, renderer,
        get D() { return D; }, get mode() { return mode; }, get run() { return run; },
        advance(sec, bot) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { frame(1 / 60, i < n - 1); if (bot) bot(D); } },
        renderMs() { const t0 = performance.now(); frame(1 / 60); renderer.getContext().finish(); return performance.now() - t0; },
        project(x, y, z) { _p.set(x, y, z).project(camera); return { x: (_p.x * 0.5 + 0.5) * ctx.width, y: (-_p.y * 0.5 + 0.5) * ctx.height }; }
      };
    }
  }
};
