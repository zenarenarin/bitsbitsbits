// =====================================================================
// UNMAKE — the game: input, targeting, interventions, camera, run loop,
// HUD, sanctuary and the Plethora lifecycle.
// =====================================================================

const MEMORIES = [
  'The first houses were built in the shade of the roots. No one owned the shade.',
  'Channels followed the slope of the basin, and the roots drank in summer.',
  'The first brace was raised when a terrace slipped. We thanked its builders.',
  'Every brace needed a brace. Every machine needed a keeper. Every keeper, a rule.',
  'The rule said: nothing may fall. So nothing was allowed to grow.',
  'They lifted the water into tanks so it could not wander. The courtyards dried.',
  'Old streets were sealed beneath new ones, kept still like pressed leaves.',
  'The roots pushed. The city clamped them. It called this maintenance.',
  'Some of us learned to unmake. Not to ruin. To loosen.',
  'A wall that holds nothing up is only a wall that holds you in.',
  'The Stillness is not a monster. It is the city, remembering only how to stay.',
  'Let the water find its old line. Let the tree be untidy. Let it change.'
];
const SAVE_KEY = 'unmake2_save';
const defaultSave = () => ({ best: 0, bestDist: 0, bank: 0, restored: 0, relics: [], runs: 0, seenIntro: false, settings: { view: 'third', look: 1, steer: 1, calmCamera: false, volume: 0.8, music: true, highVis: false, freeUnmaking: false } });

// Typography: DM Serif Display for numerals and titles, Nunito Sans for labels.
// Scale (px): 11 label · 14 body · 24 heading · 32 numeral · 60 title.
// Grid: 16px outer gutter (plus safe area), 8px rhythm. Colours: chalk on ink.
const UI_CSS = `
.um{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#f4ecdd;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px;--chalk:#f4ecdd;--ink:#221c1f;--ochre:#e3b06a}
.um *{box-sizing:border-box}
.um-lab{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
.um-top{position:absolute;left:var(--g);right:var(--g);top:0;display:flex;justify-content:space-between;align-items:flex-start;transition:opacity .3s}
.um-dist{font-family:'DM Serif Display',Georgia,serif;font-size:32px;line-height:1;letter-spacing:.01em;text-shadow:0 1px 12px rgba(20,14,16,.45);font-variant-numeric:tabular-nums}
.um-dist small{font-family:'Nunito Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;margin-left:6px;opacity:.8}
.um-still{position:relative;width:104px;height:1px;margin-top:10px;background:rgba(244,236,221,.35)}
.um-still b{position:absolute;right:0;top:-1px;height:3px;width:0;background:var(--chalk);transition:background .3s}
.um-still.near b{background:var(--ochre)}
.um-score{margin-top:8px;opacity:.75;text-shadow:0 1px 6px rgba(20,14,16,.6);font-variant-numeric:tabular-nums}
.um-icons{display:flex;gap:8px}
.um-btn{pointer-events:auto;border-radius:50%;border:1.5px solid rgba(244,236,221,.6);background:rgba(34,28,31,.22);color:var(--chalk);display:flex;align-items:center;justify-content:center;touch-action:none}
.um-btn svg{width:46%;height:46%;overflow:visible}
.um-btn.small{width:40px;height:40px}
.um-jump{position:absolute}
.um-jump:active,.um-btn.small:active{background:rgba(244,236,221,.25)}
.um-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(80,86,96,.8) 100%);opacity:0;transition:opacity .4s}
.um-fade{position:absolute;inset:0;background:#e9dcc6;opacity:0;transition:opacity .25s}
.um-cross{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px;display:none}
.um-cross svg{width:100%;height:100%;overflow:visible}
.um-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:1.5px solid rgba(244,236,221,.35);display:none}
.um-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(244,236,221,.3)}
.um-stick.hint{display:block;opacity:.0;animation:umh 3s ease-in-out 2}
.um-stick.hint b{animation:umk 1.5s ease-in-out infinite alternate}
@keyframes umh{15%,85%{opacity:.9}}
@keyframes umk{from{transform:translateX(-26px)}to{transform:translateX(26px)}}
.um-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 var(--g)}
.um-panel.on{display:flex}
.um-card{width:100%;max-width:400px;border-radius:12px;padding:16px;background:rgba(34,28,31,.78);border:1px solid rgba(244,236,221,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto}
.um-logo{font-family:'DM Serif Display',Georgia,serif;font-size:60px;line-height:1;letter-spacing:.14em;text-indent:.14em;text-align:center;text-shadow:0 2px 30px rgba(40,20,20,.45)}
.um-tag{text-align:center;font-size:14px;line-height:1.5;margin-top:8px;opacity:.9;text-shadow:0 1px 10px rgba(40,20,20,.6)}
.um-rule{width:48px;height:1px;background:rgba(244,236,221,.6);margin:16px auto 0}
.um-head{position:absolute;left:var(--g);right:var(--g);display:flex;flex-direction:column;align-items:center}
.um-b{display:block;width:100%;border:0;border-radius:10px;padding:14px 16px;margin-top:8px;font:700 13px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.18em;color:var(--ink);background:var(--chalk);pointer-events:auto;cursor:pointer}
.um-b:active{opacity:.85}
.um-b.sec{background:transparent;color:var(--chalk);border:1px solid rgba(244,236,221,.4)}
.um-row{display:flex;gap:8px}.um-row .um-b{flex:1}
.um-stats{display:flex;justify-content:space-between;padding:0 8px 8px;border-bottom:1px solid rgba(244,236,221,.14);margin-bottom:8px}
.um-stats>div{font-size:11px;font-weight:700;letter-spacing:.18em;opacity:.85;text-align:center;flex:1}
.um-stats b{display:block;font-family:'DM Serif Display',Georgia,serif;font-size:24px;letter-spacing:0;font-weight:400;margin-bottom:2px;opacity:1}
.um-h{font-family:'DM Serif Display',Georgia,serif;font-size:24px;line-height:1.2;text-align:center;margin-bottom:8px}
.um-sub{font-size:14px;line-height:1.5;text-align:center;opacity:.8;margin-bottom:8px}
.um-list{font-size:14px;line-height:1.5;margin:0 0 8px;max-height:30vh;overflow:auto;pointer-events:auto}
.um-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(244,236,221,.1)}
.um-li b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:16px}
.um-li.done{opacity:.5}
.um-mini{border:0;border-radius:8px;padding:8px 12px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.14em;color:var(--ink);background:var(--chalk);pointer-events:auto}
.um-mini[disabled]{background:rgba(244,236,221,.14);color:rgba(244,236,221,.5)}
.um-mem{padding:8px 0;border-bottom:1px solid rgba(244,236,221,.1);font-family:'DM Serif Display',Georgia,serif;font-size:16px;line-height:1.45}
.um-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:14px}
.um-set input[type=range]{width:46%;pointer-events:auto;accent-color:#f4ecdd}
.um-tog{pointer-events:auto;border:1px solid rgba(244,236,221,.4);background:transparent;color:var(--chalk);border-radius:8px;padding:6px 10px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.14em}
.um-tog.on{background:var(--chalk);color:var(--ink)}
.um-new{color:var(--ochre);font-weight:700}
`;

window.plethoraBit = {
  meta: { title: 'UNMAKE 2.0', runtime: 'plethora-bit@2', tags: ['arcade', 'physics', '3d', 'endless'], permissions: ['haptics', 'audio', 'backgroundMusic', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s, { settings: Object.assign(defaultSave().settings, s.settings || {}) }); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(#857f8a,#e5c79c 55%,#3b3136)';
    const ui = ctx.createRoot({ className: 'um', layer: 'overlay', input: 'passthrough' });
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'um-vig'); H.fade = el('div', 'um-fade');
    // HUD: distance, the Stillness as a hairline beneath it, score; two icons; jump.
    const ICON = {
      pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
      view: '<svg viewBox="-10 -10 20 20"><path d="M-8,0C-5,-5.5 5,-5.5 8,0C5,5.5 -5,5.5 -8,0Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle r="2.4" fill="currentColor"/></svg>',
      jump: '<svg viewBox="-10 -10 20 20"><path d="M-7,4L0,-4L7,4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    H.top = el('div', 'um-top');
    const tl = el('div', '', '', H.top); H.dist = el('div', 'um-dist', '0<small>M</small>', tl);
    H.still = el('div', 'um-still', '<b></b>', tl); H.stillB = H.still.firstChild;
    H.score = el('div', 'um-score um-lab', '0', tl);
    const icons = el('div', 'um-icons', '', H.top);
    H.view = el('div', 'um-btn small', ICON.view, icons); H.pause = el('div', 'um-btn small', ICON.pause, icons);
    H.cross = el('div', 'um-cross', '<svg viewBox="-14 -14 28 28"><circle r="1.6" fill="#f4ecdd"/><path class="t" d="M-11,-6V-11H-6M6,-11H11V-6M11,6V11H6M-6,11H-11V6" fill="none" stroke="#f4ecdd" stroke-width="1.6" opacity="0"/></svg>');
    H.stick = el('div', 'um-stick', '<b></b>'); H.knob = H.stick.firstChild;
    H.jump = el('div', 'um-btn um-jump', ICON.jump);
    H.title = el('div', 'um-panel');
    const hd = el('div', 'um-head', '', H.title); el('div', 'um-logo', 'UNMAKE', hd); el('div', 'um-rule', '', hd); el('div', 'um-tag', 'The city that forgot how to grow.<br>Unmake what holds it still.', hd); H.head = hd;
    const tc = el('div', 'um-card', '', H.title); H.tstats = el('div', 'um-stats', '', tc);
    H.begin = el('button', 'um-b', 'BEGIN', tc);
    const trow = el('div', 'um-row', '', tc); H.toSanct = el('button', 'um-b sec', 'SANCTUARY', trow); H.toSet = el('button', 'um-b sec', 'SETTINGS', trow);
    H.over = el('div', 'um-panel'); const oc = el('div', 'um-card', '', H.over);
    H.oh = el('div', 'um-h', '', oc); H.osub = el('div', 'um-sub', '', oc); H.ostats = el('div', 'um-stats', '', oc); H.olist = el('div', 'um-list', '', oc);
    const orow = el('div', 'um-row', '', oc); H.again = el('button', 'um-b', 'AGAIN', orow); H.oSanct = el('button', 'um-b sec', 'SANCTUARY', orow);
    H.sanct = el('div', 'um-panel'); const sc = el('div', 'um-card', '', H.sanct);
    el('div', 'um-h', 'The Sanctuary', sc); H.sbank = el('div', 'um-sub', '', sc); H.slist = el('div', 'um-list', '', sc);
    const srow = el('div', 'um-row', '', sc); H.smem = el('button', 'um-b sec', 'MEMORIES', srow); H.sback = el('button', 'um-b', 'BACK', srow);
    H.mems = el('div', 'um-panel'); const mc = el('div', 'um-card', '', H.mems); el('div', 'um-h', 'Memories', mc); H.mlist = el('div', 'um-list', '', mc); H.mback = el('button', 'um-b', 'BACK', mc);
    H.set = el('div', 'um-panel'); const setc = el('div', 'um-card', '', H.set); el('div', 'um-h', 'Settings', setc); H.slist2 = el('div', 'um-list', '', setc);
    const setrow = el('div', 'um-row', '', setc); H.resume = el('button', 'um-b', 'RESUME', setrow); H.quit = el('button', 'um-b sec', 'END RUN', setrow); H.setBack = el('button', 'um-b', 'BACK', setc);
    H.title.classList.add('on');
    H.tstats.innerHTML = '<div><b>…</b>LOADING</div>';
    for (const e of [H.top, H.jump]) e.style.display = 'none';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }

    // ---------- boot with distinct diagnostics ----------
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen UNMAKE.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen UNMAKE.' }[stage];
      H.tstats.innerHTML = `<div style="text-align:center;line-height:1.4"><b style="font-size:16px">${msg}</b></div>`;
      H.begin.style.display = 'none'; trow.style.display = 'none';
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    const scratch = ctx.createCanvas2D({ layer: 'background', input: 'passthrough', willReadFrequently: true });
    scratch.style.display = 'none';
    const A = createAssets(THREE, renderer, scratch);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, ctx.width / ctx.height, 0.08, 900);
    scene.add(camera);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), A.skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    try {
      const pm = new THREE.PMREMGenerator(renderer); const es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), A.skyMat));
      scene.environment = pm.fromScene(es, 0.03).texture; scene.environmentIntensity = 0.45; pm.dispose();
    } catch (e) { }
    scene.fog = new THREE.Fog(new THREE.Color(PALETTE.skyHorizon), 34, 230);
    const hemi = new THREE.HemisphereLight('#d7cfc2', '#4a3c39', 0.9); scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffd09a', 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    const SUN = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    const fill = new THREE.DirectionalLight('#8fa7b0', 0.35); fill.position.set(8, 3, 10); scene.add(fill);

    const V = createViews(THREE, A, scene);
    const W = createWorld(THREE, A, scene);
    const S = createSanctuary(THREE, A, scene);
    S.apply(save.restored);
    const hand = V.makeHand(camera);
    const rig = V.makeTraveller();
    const audio = createAudio(!!caps.audio);
    audio.setVolume(save.settings.volume);
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    ctx.onDestroy(() => audio.close());

    // motes drifting in the low sun
    const motes = (() => {
      const n = small ? 260 : 420, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
      const r = makeRng(3); for (let i = 0; i < n * 3; i += 3) { p[i] = (r() - 0.5) * 40; p[i + 1] = (r() - 0.5) * 16; p[i + 2] = (r() - 0.5) * 60; }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffe2b8', size: 0.07, map: A.T.glow, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; scene.add(m); return m;
    })();

    // ---------- state ----------
    let mode = 'title', run = null, time = 0;
    const cam = { pos: new THREE.Vector3(0, 4, 8), look: new THREE.Vector3(), fp: save.settings.view === 'first' ? 1 : 0, yaw: 0, pitch: -0.1, pull: 0, shake: 0, init: false };
    const input = { steer: 0, pace: 0, jumpPressed: false, jumpHeld: false, keys: new Set(), stick: null, interact: null, lookDrag: null, virtual: null };
    const difficulty = z => clamp(-z / 900, 0, 1);

    function haptic(k) { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } }

    // ---------- runs ----------
    function disposeRun() {
      if (!run) return;
      for (const g of run.views.values()) V.dispose(g);
      for (const g of run.connViews.values()) V.dispose(g);
      for (const p of run.pickups) if (p.view) V.dispose(p.view);
      for (const s of run.segs) { if (s.decor) V.dispose(s.decor); if (s.batch) V.dispose(s.batch); for (const w of s.waterViews || []) V.dispose(w); }
      V.clearGhosts();
      run = null;
    }
    function newRun() {
      disposeRun();
      const P = new Phys();
      const player = new Player(P);
      P.player = player;
      const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      run = {
        P, player, seed, rng: makeRng(seed), seq: new Sequencer(seed, save.runs < 2), segs: [], end: [0, 0, 0],
        views: new Map(), connViews: new Map(), pickups: [],
        score: 0, frontier: 0, salvage: 0, relicsNew: [], interventions: 0, chains: 0, catches: 0, encounters: 0, skillful: 0,
        stillZ: 26, t: 0, dying: 0, over: false, focus: null, beam: 0, beamTo: null, lastStepMat: 'stone', intro: !save.seenIntro ? 7 : 0
      };
      const lead = new Builder(P, [0, 0, 14], -1, makeRng(1), 0);
      lead.deck(0, -14, { w: 4 });
      lead.dec('dwellings', { at: [0, 0, -7], len: 14 });
      register(lead, { idx: -1, name: 'lead', meta: { len: 14 }, z0: 14, z1: 0 });
      player.reset([0, 0.02, 10]);
      while (run.end[2] > -140) addSegment();
      cam.init = false;
      W.reset();
    }
    function register(b, seg) {
      const still = b.bodies.filter(V.canBatch);
      if (still.length) seg.batch = V.batchStatic(still);
      for (const body of b.bodies) if (!V.canBatch(body)) run.views.set(body.id, V.makeBody(body));
      for (const c of b.conns) run.connViews.set(c.id, V.makeConn(c));
      for (const p of b.pickups) { p.view = V.makePickup(p); run.pickups.push(p); }
      seg.decor = W.buildDecor(b.decor, (seg.seed || 1) + seg.idx);
      seg.waterViews = [];
      run.segs.push(seg);
    }
    function addSegment() {
      const idx = run.segs.length;
      const d = difficulty(run.end[2]);
      let name = run.seq.next(d, run.end[1]), seed = 0, ok = false;
      for (let i = 0; i < 5 && !ok; i++) { seed = (run.rng() * 1e9) >>> 0; ok = validateSegment(name, seed, d).ok; }
      if (!ok) { name = 'approach'; seed = 11; }
      const P = run.P;
      const nb0 = P.bodies.length, nc0 = P.conns.length, nw0 = P.waters.length;
      const meta = buildSegment(P, name, seed, d, run.end, idx);
      const b = { bodies: P.bodies.slice(nb0), conns: P.conns.slice(nc0), pickups: meta.pickups, decor: meta.decor };
      const seg = { idx, name, seed, meta, z0: run.end[2], z1: meta.exitPos[2], used: 0, entered: false, cleared: false, chained: false };
      register(b, seg);
      for (const w of P.waters.slice(nw0)) {
        const m = new THREE.Mesh(A.G.plane, A.M.water);
        m.rotation.x = -Math.PI / 2; m.scale.set(w.x1 - w.x0, w.z0 - w.z1, 1);
        m.position.set((w.x0 + w.x1) / 2, w.level, (w.z0 + w.z1) / 2);
        m.userData.water = w; V.root.add(m); seg.waterViews.push(m);
      }
      run.end = meta.exitPos;
    }
    function dropBehind() {
      const pz = run.player.pos[2];
      for (const s of run.segs) {
        if (s.dropped || s.z1 < pz + 40 || s.idx === undefined) continue;
        s.dropped = true;
        const P = run.P;
        P.bodies = P.bodies.filter(b => { if (b.seg === s.idx || (s.idx === -1 && b.seg === -1)) { P.byId.delete(b.id); const v = run.views.get(b.id); if (v) { V.dispose(v); run.views.delete(b.id); } return false; } return true; });
        P.conns = P.conns.filter(c => { if (c.seg === s.idx) { P.byId.delete(c.id); const v = run.connViews.get(c.id); if (v) { V.dispose(v); run.connViews.delete(c.id); } return false; } return true; });
        P.waters = P.waters.filter(w => w.seg !== s.idx);
        run.pickups = run.pickups.filter(p => { if (p.seg === s.idx) { if (p.view) V.dispose(p.view); return false; } return true; });
        if (s.decor) { V.dispose(s.decor); s.decor = null; }
        if (s.batch) { V.dispose(s.batch); s.batch = null; }
        for (const w of s.waterViews || []) V.dispose(w);
      }
    }

    // ---------- targeting ----------
    // Eligibility is the limit: only what the preservers added (glazed bodies,
    // copper restraints) can be unmade. There is no meter and no cooldown.
    function targets() {
      const out = [];
      for (const c of run.P.conns) if (c.alive && c.role) out.push({ o: c, role: 'unmake' });
      for (const b of run.P.bodies) if (b.alive && b.erase) out.push({ o: b, role: 'unmake' });
      return out;
    }
    function targetPoint(t) { return t.o.isConn ? run.P.connMid(t.o) : t.o.pos; }
    function pickRay(o, d, maxT) {
      // a true hit on an element always beats a near miss; near misses (thin
      // props, cables, a fingertip's slop) rank only among themselves
      let best = null, bt = Infinity, bpt = Infinity;
      for (const t of targets()) {
        let hit = Infinity, rank = Infinity;
        if (t.o.isConn) {
          const [a, b] = run.P.connEnds(t.o);
          const r = raySegDist(o, d, maxT, a, b);
          if (r.dist < 0.45 + r.t * 0.018) { hit = r.t; rank = r.t; }
        } else {
          hit = run.P.rayBody(t.o, o, d, maxT);
          if (hit < Infinity) rank = hit;
          else {
            const t0 = clamp(vDot(vSub(t.o.pos, o), d), 0, maxT), p = vAddS(o, d, t0), cp = run.P.closestPoint(t.o, p);
            if (vLen(vSub(p, cp)) < 0.5 + t0 * 0.015) { hit = t0; rank = 1000 + t0; }
          }
        }
        if (rank < bt) { bt = rank; bpt = hit; best = t; }
      }
      if (best) best = { o: best.o, role: best.role, point: vAddS(o, d, bpt) };
      return best;
    }
    const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), _v = new THREE.Vector3();
    function rayFromScreen(x, y) {
      ndc.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return [[ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]];
    }
    function inRange(t) { return vLen(vSub(targetPoint(t), run.player.pos)) < 28; }
    // the focused target: under the crosshair in first person, else the best one ahead
    function updateFocus() {
      const pl = run.player;
      if (cam.fp > 0.5) {
        const [o, d] = rayFromScreen(ctx.width / 2, ctx.height / 2);
        const t = pickRay(o, d, 40);
        run.focus = t && inRange(t) ? t : null;
        if (run.focus) run.focus.deps = run.P.dependents(run.focus.o);
        return;
      }
      let best = null, bs = Infinity;
      for (const t of targets()) {
        if (t.o === pl.ground) continue;
        // only what the traveller can see from where they stand: not overhead, not far below
        const chest = [pl.pos[0], pl.pos[1] + 1.2, pl.pos[2]];
        const cp = t.o.isConn ? (() => { const [a, b] = run.P.connEnds(t.o); return closestOnSeg(a, b, chest); })() : run.P.closestPoint(t.o, chest);
        if (!t.o.isConn && cp[1] - pl.pos[1] > 3.2 || cp[1] - pl.pos[1] < -6) continue;
        const p = targetPoint(t);
        const dz = pl.pos[2] - p[2];
        if (dz < -3 || dz > 26) continue;
        _v.set(p[0], p[1], p[2]).project(camera);
        if (_v.z > 1 || Math.abs(_v.x) > 0.95 || Math.abs(_v.y) > 0.95) continue;
        const score = dz * 0.6 + Math.hypot(_v.x, _v.y) * 6;
        if (score < bs) { bs = score; best = t; }
      }
      if (best && run.focus && run.focus.o === best.o) return;
      run.focus = best;
      if (best) best.deps = run.P.dependents(best.o);
    }
    // what each dependent will do: its pose now, and where it will come to rest
    function consequences(t) {
      if (!t.deps) t.deps = run.P.dependents(t.o);
      const gone = t.o.isConn ? [t.o.id] : run.P.eraseGroup(t.o).map(b => b.id);
      return t.deps.filter(b => b.alive).map(b => ({ b, rest: run.P.predictRest(b, gone) }));
    }

    // ---------- unmaking ----------
    function canAct() { return run && !run.dying && !run.over && run.player.alive; }
    function segOf(o) { return run.segs.find(s => s.idx === o.seg); }
    // each stretch allows as many unmakings as its biggest solution needs; then the rest seals
    function sealed(o) { if (save.settings.freeUnmaking) return false; const s = segOf(o); return !!(s && s.meta && s.used >= s.meta.budget); }
    function deny(t) { audio.deny(); haptic('warning'); run.denied = { o: t.o, t: 0.5 }; }
    function intervene(t, point) {
      if (!canAct() || !t || !inRange(t)) return false;
      const o = t.o;
      if (!(o.isConn ? o.alive && o.role : o.alive && o.erase)) { deny(t); return false; }
      if (sealed(o)) { deny(t); return false; }
      const seg = segOf(o);
      run.interventions++; if (seg) seg.used++;
      const at = point || t.point || (o.isConn ? run.P.connMid(o) : run.P.closestPoint(o, [run.player.pos[0], run.player.pos[1] + 1.2, run.player.pos[2]]));
      run.beam = 0.22; run.beamTo = at;
      if (o.isConn) run.P.sever(o, 'unmake'); else run.P.erase(o, at);
      run.focus = null;
      haptic('light');
      try { ctx.platform.interact({ type: 'unmake', style: o.style }); } catch (e) { }
      return true;
    }

    // ---------- events → feel ----------
    function where(p) { const pl = run.player.pos; const d = vLen(vSub(p, pl)); const pan = clamp((p[0] - pl[0]) / 12, -1, 1); return [d, pan]; }
    function processEvents() {
      const P = run.P;
      for (const ev of P.events) {
        const p = ev.pos || run.player.pos;
        const [d, pan] = where(p);
        switch (ev.type) {
          case 'sever': { audio.unmake(d, pan, 0.6); audio.sever(ev.style, d * 1.6, pan); const v = run.connViews.get(ev.conn.id); if (v) { run.connViews.delete(ev.conn.id); V.unmakeConn(v); } break; }
          case 'erase': {
            audio.unmake(d, pan, 1);
            for (const b of ev.bodies) { const v = run.views.get(b.id); if (v) { run.views.delete(b.id); V.unmake(v, b, ev.origin); } }
            break;
          }
          case 'snap': audio.sever('cable', d, pan); V.spawn(p, 12, { color: '#d9c9b0', speed: 2, size: 0.2, life: 0.6 }); break;
          case 'strain': audio.strain(d, pan); V.spawn(p, 10, { color: '#d8cab4', speed: 0.6, size: 0.35, life: 1.2, g: -3 }); camKick(0.08, p); break;
          case 'release': audio.creak(d, pan); if (d < 30) cam.pull = Math.max(cam.pull, 1); break;
          case 'crack': audio.crack(ev.stage, d, pan); V.spawn(p, 14, { color: '#e0d3bd', speed: 2.5, size: 0.35, life: 0.8, g: -6, sx: 1.4, sy: 1.6 }); V.debris(p, 3, A.M.stone, 0.14, 1.2); break;
          case 'crumble': case 'break': case 'strike': {
            const b = ev.body;
            if (ev.type !== 'strike') {
              const v = b && run.views.get(b.id);
              if (v) { V.dispose(v); run.views.delete(b.id); }
            }
            if (ev.type === 'break' && ev.why === 'erased') break;
            if (ev.type === 'break' || ev.type === 'crumble') { audio.crumble(d, pan); V.spawn(p, 40, { color: '#e3d6c0', speed: 3, size: 0.9, life: 1.5, grow: 0.8, g: -1, sx: 2, sy: 2, alpha: 0.55 }); V.debris(p, 12, b && b.style === 'sluice' ? A.M.rust : A.M.stone, 0.24, 1.6); camKick(0.3, p); }
            else { audio.impact(10, d, pan); camKick(0.25, p); }
            break;
          }
          case 'impact': if ((ev.power || 0) > 3) { audio.impact(ev.power, d, pan); V.spawn(p, 16, { color: '#ddd0bb', speed: 2.2, size: 0.7, life: 1.1, grow: 0.7, g: 0.2, sx: 2.2, sy: 0.3, alpha: 0.45 }); camKick(Math.min(0.35, ev.power * 0.025), p); } break;
          case 'land': if ((ev.power || 0) > 3) { audio.impact(ev.power * 0.8, d, pan); camKick(0.2, p); } break;
          case 'tilt': audio.mech(d, pan); break;
          case 'lift': audio.mech(d, pan); break;
          case 'flood': audio.flood(d); if (ev.water) livingReturns(ev.water); break;
          case 'chain': {
            run.chains++;
            const src = ev.tag && ev.tag.src ? run.P.get(ev.tag.src.conn || ev.tag.src.body) : null;
            const seg = run.segs.find(s => s.idx === (src ? src.seg : -9));
            if (seg) seg.chained = true;
            run.score += 300;
            audio.chain(); haptic('success');
            try { ctx.platform.milestone('chain'); } catch (e) { }
            break;
          }
        }
        if (ev.type === 'release' && ev.body && ev.body.type === 'free' && ev.body.style === 'counterweight') audio.sever('chain', d, pan);
        if (ev.type === 'release' && ev.water === undefined && ev.body && ev.body.style === 'sluice') audio.flood(d);
      }
      P.events.length = 0;
      for (const ev of run.player.events) {
        if (ev.type === 'jump') { audio.jump(); rig.takeoff(); }
        if (ev.type === 'land') { const mat = matOf(ev.body); audio.land(ev.power, mat); rig.land(ev.power); if (ev.power > 9) { camKick(Math.min(0.25, (ev.power - 9) * 0.03)); haptic('light'); } if (ev.power > 6) V.spawn(run.player.pos, 8, { color: '#ddd0bb', speed: 1.2, size: 0.4, life: 0.6, sy: 0.1, g: 0.5, alpha: 0.4 }); }
        if (ev.type === 'knock') { audio.knock(); camKick(0.35); haptic('heavy'); }
        if (ev.type === 'death') { run.dying = 1.4; run.deathReason = ev.reason; audio.death(); haptic('error'); }
      }
      run.player.events.length = 0;
    }
    function matOf(b) {
      if (!b) return 'stone';
      const s = b.style;
      if (s === 'leaf' || s === 'balance' || s === 'barge' || s === 'beam') return 'wood';
      if (s === 'cradle' || s === 'liftDeck' || s === 'net') return 'metal';
      if (s === 'root' || s === 'rootBridge' || s === 'knuckle') return 'root';
      return 'stone';
    }
    function camKick(k, p) { if (save.settings.calmCamera) return; if (p) { const d = vLen(vSub(p, run.player.pos)); k *= clamp(1 - d / 30, 0, 1); } cam.shake = Math.max(cam.shake, k); }
    // when water returns, so does green: moss and leaves along the wet edges
    function livingReturns(w) {
      const seg = run.segs.find(s => s.idx === w.seg);
      if (!seg) return;
      const g = new THREE.Group(); const r = makeRng(w.id);
      for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(A.G.ico, r() < 0.5 ? A.M.leaf : A.M.moss); const x = r() < 0.5 ? w.x0 + r() * 0.8 : w.x1 - r() * 0.8; m.position.set(x, w.target + 0.2 + r() * 0.4, lerp(w.z1, w.z0, r())); m.scale.set(0.3 + r() * 0.4, 0.2 + r() * 0.3, 0.3 + r() * 0.4); g.add(m); }
      V.root.add(g); seg.waterViews.push(g);
      g.scale.setScalar(0.01); g.userData.grow = 0;
      run.growing = (run.growing || []).concat([g]);
    }

    // ---------- run step ----------
    function step(dt) {
      if (mode !== 'play' || !run) return;
      const P = run.P, pl = run.player;
      if (run.dying > 0) {
        run.dying -= dt;
        P.step(dt * 0.4); processEvents();
        if (run.dying <= 0) endRun(run.deathReason);
        return;
      }
      run.t += dt;
      // input → player
      const ki = keyInput();
      const inp = { steer: clamp(ki.steer * save.settings.steer, -1, 1), pace: ki.pace, jumpPressed: input.jumpPressed, jumpHeld: input.jumpHeld };
      input.jumpPressed = false;
      const heading = cam.fp > 0.5 ? cam.yaw : 0;
      pl.step(dt, inp, heading);
      P.step(dt);
      processEvents();
      // the Stillness follows
      const d = difficulty(pl.pos[2]);
      const sp = MOVE.cruise * lerp(0.62, 0.82, d) * (run.t < 3 ? 0 : 1) * (save.runs < 1 ? 0.85 : 1);
      run.stillZ -= sp * dt;
      if (run.stillZ - pl.pos[2] > 24) run.stillZ = pl.pos[2] + 24;
      if (pl.alive && run.stillZ <= pl.pos[2]) { pl.die('stilled'); }
      // falling into the basin: the city catches you and sets you back on the
      // last sound footing — and the Stillness gains 3 m on you (never leaving
      // you more than 14 m ahead). Run well and the margin comes back; fall
      // when it is already at your heels and nothing catches you.
      if (pl.alive && pl.pos[1] < pl.lastSafe[1] - 13) {
        let safe = null;
        for (let i = pl.safeHist.length - 1; i >= 0 && !safe; i--) { const h = pl.safeHist[i]; if (h.body && h.body.alive) { const g = P.groundAt(h.pos[0], h.pos[2], h.pos[1] + 0.5); if (g.body && Math.abs(g.y - h.pos[1]) < 0.3) safe = h.pos; } }
        if (!safe && pl.safeBody && pl.safeBody.alive) safe = pl.lastSafe;
        const margin = safe ? Math.min(run.stillZ - safe[2] - 3, 14) : -1;
        if (margin >= 2.5) {
          run.catches++;
          pl.pos = vAdd(safe, [0, 0.05, 0]); pl.vel = [0, 0, 0]; pl.grounded = false;
          run.stillZ = pl.pos[2] + margin;
          H.fade.style.opacity = 0.9; ctx.timeout(() => { H.fade.style.opacity = 0; }, 160);
          audio.catch(); haptic('medium');
        } else pl.die('fell');
      }
      // pickups
      for (const p of run.pickups) {
        if (!p.alive) continue;
        if (p.ride) { const b = P.get(p.ride); if (b && b.alive) p.pos = [b.pos[0], b.pos[1] + 0.9, b.pos[2]]; }
        if (p.sealed) continue;
        const dd = vLen(vSub(p.pos, [pl.pos[0], pl.pos[1] + 0.8, pl.pos[2]]));
        if (dd < 1.0) {
          p.alive = false;
          if (p.view) { V.dispose(p.view); p.view = null; }
          if (p.kind === 'relic') {
            run.score += 400; run.salvage += 8;
            const missing = []; for (let i = 0; i < MEMORIES.length; i++) if (!save.relics.includes(i)) missing.push(i);
            if (missing.length) { save.relics.push(missing[0]); run.relicsNew.push(missing[0]); persist(); }
            audio.relic(); haptic('success');
            V.spawn(p.pos, 50, { color: '#ffd59a', speed: 2.6, size: 0.35, life: 1.4, g: 1 });
          } else { run.salvage++; run.score += 20; audio.salvage(); V.spawn(p.pos, 8, { color: '#e6b46c', speed: 1.6, size: 0.22, life: 0.5, g: 1 }); }
        }
      }
      // encounter bookkeeping
      for (const s of run.segs) {
        if (s.idx < 0) continue;
        if (!s.entered && pl.pos[2] < s.z0) { s.entered = true; }
        if (!s.cleared && s.entered && pl.pos[2] < s.z1 && pl.alive) {
          s.cleared = true;
          if (!FAMILIES[s.name].rest) {
            run.encounters++;
            run.score += 120;
            if (s.used <= (s.meta.need || 0) && s.meta.solutions.length > 1) { run.score += 150; run.skillful++; }
            try { ctx.platform.milestone('encounter', { name: s.name }); } catch (e) { }
          }
        }
      }
      // distance
      if (-pl.pos[2] > run.frontier + 1) { const n = Math.floor(-pl.pos[2] - run.frontier); run.frontier += n; run.score += n * 10; }
      while (run.end[2] > pl.pos[2] - 150) addSegment();
      dropBehind();
      if (scoreTrack) try { scoreTrack.set(Math.floor(run.score)); } catch (e) { }
    }

    function keyInput() {
      if (input.virtual) return input.virtual;
      let steer = 0, pace = 0;
      const k = input.keys;
      if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
      if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
      if (k.has('ArrowUp') || k.has('KeyW')) pace += 1;
      if (k.has('ArrowDown') || k.has('KeyS')) pace -= 1;
      if (input.stick) {
        const s = input.stick; let dx = (s.x - s.ox) / 50, dy = -(s.y - s.oy) / 50;
        const m = Math.hypot(dx, dy);
        if (m > 0.12) { const c = Math.min(1, (m - 0.12) / 0.88); steer = dx / m * c; pace = dy / m * c; }
      }
      return { steer, pace };
    }

    // ---------- camera ----------
    const camTarget = new THREE.Vector3(), camWant = new THREE.Vector3(), fpPos = new THREE.Vector3(), q3 = new THREE.Quaternion(), qf = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
    function updateCamera(dt) {
      const pl = run.player, portrait = ctx.height > ctx.width;
      const speed = Math.hypot(pl.vel[0], pl.vel[2]);
      const air = pl.grounded ? 0 : 1;
      cam.pull = Math.max(0, cam.pull - dt * 0.55);
      const pull = save.settings.calmCamera ? 0 : smooth(Math.min(1, cam.pull));
      const back = (portrait ? 7.2 : 6.0) + speed * 0.12 + pull * 2.4;
      const up = (portrait ? 3.7 : 3.1) + air * 0.6 + pull * 1.6;
      const lookAhead = portrait ? 7.5 : 6.5;
      const groundRef = pl.grounded ? pl.pos[1] : Math.max(pl.pos[1], pl.lastSafe[1] - 2.5);
      if (!cam.init) { cam.pos.set(pl.pos[0] * 0.6, groundRef + up, pl.pos[2] + back); cam.ly = groundRef; cam.init = true; }
      cam.ly = damp(cam.ly, groundRef, pl.grounded ? 5 : 2, dt);
      camWant.set(pl.pos[0] * 0.65 + 0.6, cam.ly + up, pl.pos[2] + back);
      cam.pos.x = damp(cam.pos.x, camWant.x, 5, dt); cam.pos.y = damp(cam.pos.y, camWant.y, 4.5, dt); cam.pos.z = damp(cam.pos.z, camWant.z, 9, dt);
      camTarget.set(pl.pos[0] * 0.8, cam.ly + 1.1 - air * 0.5, pl.pos[2] - lookAhead);
      // keep the camera out of solid structure behind it
      const P = run.P;
      const o = [pl.pos[0], pl.pos[1] + 1.4, pl.pos[2]];
      const dvec = [cam.pos.x - o[0], cam.pos.y - o[1], cam.pos.z - o[2]];
      const dl = vLen(dvec), dn = vScale(dvec, 1 / dl);
      let hit = dl;
      for (const b of P.near([Math.min(o[0], cam.pos.x), Math.min(o[1], cam.pos.y), Math.min(o[2], cam.pos.z), Math.max(o[0], cam.pos.x), Math.max(o[1], cam.pos.y), Math.max(o[2], cam.pos.z)], 0.3)) {
        if (b.passable) continue;
        const t = P.rayBody(b, o, dn, dl); if (t < hit) hit = t;
      }
      const c3 = hit < dl ? new THREE.Vector3(o[0] + dn[0] * (hit - 0.3), o[1] + dn[1] * (hit - 0.3), o[2] + dn[2] * (hit - 0.3)) : cam.pos.clone();
      // third-person orientation
      const m4 = new THREE.Matrix4().lookAt(c3, camTarget, new THREE.Vector3(0, 1, 0));
      q3.setFromRotationMatrix(m4);
      // first person: eye height, look yaw/pitch, gentle bob
      const bob = save.settings.calmCamera || !pl.grounded ? 0 : Math.sin(time * 11 * clamp(speed / 5, 0, 1.4)) * 0.035 * clamp(speed / 5, 0, 1);
      fpPos.set(pl.pos[0], pl.pos[1] + 1.42 + bob - (pl.justLanded > 0 ? pl.justLanded * 0.4 : 0), pl.pos[2]);
      eul.set(cam.pitch, cam.yaw, 0); qf.setFromEuler(eul);
      // blend between the two
      const want = save.settings.view === 'first' ? 1 : 0;
      cam.fp = damp(cam.fp, want, 9, dt); if (Math.abs(cam.fp - want) < 0.002) cam.fp = want;
      const k = smooth(cam.fp);
      camera.position.lerpVectors(c3, fpPos, k);
      camera.quaternion.slerpQuaternions(q3, qf, k);
      if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt * 1.8); camera.position.x += (Math.random() - 0.5) * cam.shake * 0.4; camera.position.y += (Math.random() - 0.5) * cam.shake * 0.4; }
      camera.fov = lerp(portrait ? 64 : 55, portrait ? 78 : 72, k);
      camera.updateProjectionMatrix();
      rig.root.visible = k < 0.6;
      hand.g.visible = k > 0.85;
      A.U.uOccl.value = k < 0.5 ? 1 : 0;
      A.U.uPlayer.value.set(pl.pos[0], pl.pos[1] + 0.9, pl.pos[2]);
      A.U.uCam.value.copy(camera.position);
      // in third person the traveller always faces the course
      if (k < 0.5) { cam.yaw = damp(cam.yaw, 0, 6, dt); cam.pitch = damp(cam.pitch, -0.08, 6, dt); }
    }

    // ---------- render ----------
    function frame(dt) {
      time += dt;
      if ((mode === 'play' || mode === 'over' || mode === 'paused') && run) {
        const pl = run.player;
        updateCamera(dt);
        W.setVisible(true);
        W.update(pl.pos[2], pl.pos[1], time);
        sky.position.copy(camera.position);
        sun.position.set(pl.pos[0] + SUN.x * -40, pl.pos[1] + 40 * SUN.y, pl.pos[2] + SUN.z * -40 + 0);
        sun.position.set(pl.pos[0] - 26, pl.pos[1] + 30, pl.pos[2] - 16);
        sun.target.position.set(pl.pos[0], pl.pos[1], pl.pos[2] - 6); sun.target.updateMatrixWorld();
        updateFocus();
        if (run.press && (!run.press.o.alive || !inRange(run.press))) run.press = null;
        const F = run.press || (run.focus && inRange(run.focus) ? run.focus : null);
        const strong = !!run.press || cam.fp > 0.5;
        for (const [id, g] of run.views) {
          const b = run.P.get(id); if (!b || !b.alive) { V.dispose(g); run.views.delete(id); continue; }
          V.syncBody(b, g);
          const gm = g.userData.glaze;
          if (gm) gm.userData.u.uSealed.value = damp(gm.userData.u.uSealed.value, sealed(b) ? 1 : 0, 4, dt);
          if (gm) { const on = F && !F.o.isConn && !sealed(b) && (F.o === b || (b.eraseGroup && b.eraseGroup === F.o.eraseGroup)); gm.userData.u.uFocus.value = damp(gm.userData.u.uFocus.value, on ? (strong ? 1 : 0.4) : (save.settings.highVis ? 0.35 : 0), 12, dt); }
        }
        for (const [id, g] of run.connViews) { const c = run.P.get(id); if (!c || !c.alive) { V.dispose(g); run.connViews.delete(id); continue; } V.syncConn(run.P, c, g, time); const f = F && F.o === c && !sealed(c); g.userData.mat.color.set(sealed(c) ? '#6e6a68' : '#ffffff'); g.userData.mat.emissiveIntensity = damp(g.userData.mat.emissiveIntensity, f ? 1.2 : (save.settings.highVis ? 0.45 : 0), 10, dt); }
        // the exact region: chalk outline on what will go, ochre on what will move because of it
        V.beginOutlines();
        if (run.denied) { run.denied.t -= dt; const o = run.denied.o; if (run.denied.t <= 0 || !o.alive) run.denied = null; else if (!o.isConn) for (const b of run.P.eraseGroup(o)) V.outline(b.pos, b.rot, b.size, PALETTE.ink, run.denied.t * 1.6, 0.003, camera.position); }
        if (F && sealed(F.o)) { if (!F.o.isConn) for (const b of run.P.eraseGroup(F.o)) V.outline(b.pos, b.rot, b.size, PALETTE.ink, strong ? 0.5 : 0.25, 0.0022, camera.position); }
        else if (F) {
          const k = strong ? 1 : 0.6, pulse = 0.8 + 0.2 * Math.sin(time * 5);
          if (!F.o.isConn) for (const b of run.P.eraseGroup(F.o)) V.outline(b.pos, b.rot, b.size, PALETTE.unmake, 0.95 * pulse * k, 0.0032, camera.position);
          for (const c of consequences(F)) {
            const sz = c.b.shape === 'sphere' ? [c.b.r, c.b.r, c.b.r] : c.b.size;
            // ink, like a drawing: what moves, and (seen through anything) where it will settle
            V.outline(c.b.pos, c.b.rot, sz, PALETTE.ink, 0.85 * k, 0.003, camera.position);
            if (c.rest) V.outline(c.rest.pos, c.rest.rot, sz, PALETTE.ink, (0.45 + 0.35 * pulse) * k, 0.0026, camera.position, true);
          }
        }
        V.updateGhosts(dt, camera.position);
        V.endOutlines();
        for (const s of run.segs) for (const w of s.waterViews || []) if (w.userData.water) { w.position.y = w.userData.water.level; w.visible = w.userData.water.level > w.userData.water.target - 50 && w.userData.water.level > (w.userData.water.minShow || -1e9); }
        if (run.growing) for (const g of run.growing) if (g.userData.grow < 1) { g.userData.grow = Math.min(1, g.userData.grow + dt * 0.5); g.scale.setScalar(smooth(g.userData.grow)); }
        for (const p of run.pickups) if (p.view) { p.view.position.set(p.pos[0], p.pos[1] + Math.sin(time * 2.2 + p.pos[2]) * 0.08, p.pos[2]); p.view.visible = !p.sealed || p.ride; if (p.view.userData.spin) p.view.userData.spin.rotation.y += dt * 2; }
        const g = run.P.groundAt(pl.pos[0], pl.pos[2], pl.pos[1] + 0.3);
        const narrow = pl.grounded && pl.ground && Math.min(pl.ground.size[0], pl.ground.size[2]) < 0.6;
        rig.update(dt, pl, { onStep: k => audio.step(matOf(pl.ground), k), narrow, reach: run.beam > 0, accel: 0, groundY: isFinite(g.y) ? g.y : undefined });
        // the thread of unmaking: from the key to the target
        if (run.beam > 0 && run.beamTo) {
          run.beam -= dt; beam.visible = true;
          const from = cam.fp > 0.5 ? (hand.tip.getWorldPosition(_v), [_v.x, _v.y, _v.z]) : (rig.keyTip.getWorldPosition(_v), [_v.x, _v.y, _v.z]);
          V.setLine(beamLine, from, run.beamTo);
          beamMat.opacity = clamp(run.beam / 0.2, 0, 1) * 0.85;
        } else beam.visible = false;
        hand.g.position.copy(hand.rest).add(new THREE.Vector3(0, run.beam > 0 ? 0.05 : 0, run.beam > 0 ? -0.08 : 0));
        hand.g.position.y += Math.sin(time * 10) * 0.004 * clamp(Math.hypot(pl.vel[0], pl.vel[2]) / 5, 0, 1);
        // motes follow the eye
        motes.position.set(camera.position.x, camera.position.y, camera.position.z - 20);
        hud(dt);
        A.U.uBasin.value.set(PALETTE.basin);
        scene.fog.color.set(PALETTE.skyHorizon);
        audio.ambient(pl.pos[1] + 30);
      } else {
        // sanctuary / title: a slow orbit
        const c = S.center, a = time * 0.06, portrait = ctx.height > ctx.width;
        const dist = portrait ? 34 : 25;
        camera.position.set(c.x + Math.sin(a) * dist, c.y + dist * 0.46, c.z + Math.cos(a) * dist);
        camera.lookAt(c.x, c.y + 0.6, c.z);
        camera.fov = portrait ? 56 : 48; camera.updateProjectionMatrix();
        camera.setViewOffset(ctx.width, ctx.height, 0, ctx.height * (portrait ? 0.17 : 0.1), ctx.width, ctx.height);
        W.setVisible(true); W.update(c.z + 40, 0, time);
        sky.position.copy(camera.position);
        sun.position.set(c.x - 26, c.y + 30, c.z - 16); sun.target.position.copy(c); sun.target.updateMatrixWorld();
        rig.root.visible = true; hand.g.visible = false;
        rig.update(dt, { pos: [c.x - 2.6, 0, c.z + 2.4], vel: [0, 0, 0], grounded: true, stagger: 0 }, { accel: 0, groundY: 0 });
        A.U.uOccl.value = 0;
        A.U.uPlayer.value.set(c.x, -100, c.z);
        H.cross.style.display = 'none';
      }
      if (camera.view && camera.view.enabled && (mode === 'play' || mode === 'over' || mode === 'paused')) camera.clearViewOffset();
      V.updateFx(dt);
      A.U.uTime.value = time;
      renderer.render(scene, camera);
    }
    const beamMat = new THREE.MeshBasicMaterial({ color: PALETTE.unmake, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Group(); const beamLine = new THREE.Mesh(A.G.cyl6, beamMat); beamLine.scale.set(0.02, 1, 0.02); beam.add(beamLine); beam.visible = false; scene.add(beam);

    // ---------- HUD ----------
    let hc = {};
    function hud(dt) {
      const pl = run.player;
      const dist = Math.max(0, Math.floor(run.frontier));
      if (hc.d !== dist) { hc.d = dist; H.dist.innerHTML = dist + '<small>M</small>'; }
      const sc = Math.floor(run.score); if (hc.s !== sc) { hc.s = sc; H.score.textContent = sc.toLocaleString(); }
      // the Stillness: a hairline that fills from the right as it closes in
      const buf = run.stillZ - pl.pos[2];
      const near = clamp(1 - buf / 24, 0, 1);
      const w = Math.round(near * 104);
      if (hc.w !== w) { hc.w = w; H.stillB.style.width = w + 'px'; H.still.classList.toggle('near', buf < 9); }
      H.vig.style.opacity = clamp((7 - buf) / 6, 0, 1).toFixed(2);
      // first person: a dot, and corner ticks when something unmakeable is under it
      const fpMode = cam.fp > 0.5;
      H.cross.style.display = fpMode ? 'block' : 'none';
      if (fpMode) { const on = !!(run.focus && inRange(run.focus)); if (hc.x !== on) { hc.x = on; H.cross.querySelector('.t').setAttribute('opacity', on ? '1' : '0'); } }
      // first run: a ghost of the stick shows where steering lives, once
      if (run.intro > 0 && !hc.hint) { hc.hint = true; H.stick.classList.add('hint'); H.stick.style.left = (ctx.width * 0.22) + 'px'; H.stick.style.top = (ctx.height * 0.78) + 'px'; }
      if (run.intro > 0) { run.intro -= dt; if (run.intro <= 0 || input.stick) { H.stick.classList.remove('hint'); if (!input.stick) H.stick.style.display = 'none'; run.intro = 0; if (!save.seenIntro) { save.seenIntro = true; persist(); } } }
    }

    // ---------- flow ----------
    function showOnly(p) { for (const x of [H.title, H.over, H.sanct, H.mems, H.set]) x.classList.toggle('on', x === p); }
    function setPlayHud(on) { for (const e of [H.top, H.jump]) e.style.display = on ? '' : 'none'; if (!on) { H.cross.style.display = 'none'; H.stick.style.display = 'none'; H.stick.classList.remove('hint'); } }
    function begin() {
      audio.unlock();
      try { if (caps.backgroundMusic && ctx.music && save.settings.music) { ctx.music.unlock(); ctx.music.play({ preset: 'drift', volume: 0.22, intensity: 0.25, fadeInMs: 2500 }); } } catch (e) { }
      newRun();
      mode = 'play'; hc = {};
      showOnly(null); setPlayHud(true);
      camera.clearViewOffset();
      try { ctx.platform.start({ run: save.runs + 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function endRun(reason) {
      if (!run || run.over) return;
      run.over = true; mode = 'over';
      const dist = Math.floor(run.frontier);
      const best = run.score > save.best;
      save.best = Math.max(save.best, Math.floor(run.score)); save.bestDist = Math.max(save.bestDist, dist);
      save.bank += run.salvage; save.runs++;
      persist();
      try { ctx.platform.fail({ score: Math.floor(run.score), distance: dist, reason }); } catch (e) { }
      if (scoreTrack) { try { scoreTrack.set(Math.floor(run.score)); scoreTrack.submit('score', { label: Math.floor(run.score) + ' pts' }).catch(() => { }); } catch (e) { } }
      const titles = { stilled: 'The Stillness reached you', crushed: 'Caught beneath the falling city', fell: 'The basin took you' };
      const lessons = { stilled: 'Waiting costs ground. Read the structure while you move.', crushed: 'The outline shows what will fall. Stand clear of it.', fell: 'With the Stillness this close, nothing could catch you.' };
      H.oh.textContent = titles[reason] || 'The journey ends';
      H.osub.innerHTML = (best ? '<span class="um-new">New best</span> · ' : '') + (lessons[reason] || '');
      H.ostats.innerHTML = `<div><b>${Math.floor(run.score).toLocaleString()}</b>SCORE</div><div><b>${dist} m</b>DISTANCE</div><div><b>${run.salvage}</b>SALVAGE</div>`;
      const lines = [];
      lines.push(`<div class="um-li"><span>Encounters crossed</span><b>${run.encounters}</b></div>`);
      if (run.skillful) lines.push(`<div class="um-li"><span>Crossed on movement alone</span><b>${run.skillful}</b></div>`);
      if (run.chains) lines.push(`<div class="um-li"><span>Chain reactions</span><b>${run.chains}</b></div>`);
      lines.push(`<div class="um-li"><span>Unmade</span><b>${run.interventions}</b></div>`);
      for (const r of run.relicsNew) lines.push(`<div class="um-mem"><span class="um-new">Recovered</span> — “${MEMORIES[r]}”</div>`);
      const next = RESTORATIONS[save.restored];
      if (next) lines.push(`<div class="um-li"><span>Sanctuary: ${next.name}</span><b>${save.bank}/${next.cost}</b></div>`);
      H.olist.innerHTML = lines.join('');
      showOnly(H.over); setPlayHud(false);
    }
    function showTitle() {
      mode = 'title'; disposeRun();
      showOnly(H.title); setPlayHud(false);
      H.tstats.innerHTML = `<div><b>${save.best.toLocaleString()}</b>BEST</div><div><b>${save.bank}</b>SALVAGE</div><div><b>${save.relics.length}/${MEMORIES.length}</b>MEMORIES</div>`;
      S.apply(save.restored);
    }
    function showSanct() {
      mode = 'sanct'; disposeRun(); showOnly(H.sanct); setPlayHud(false); renderSanct();
    }
    function renderSanct() {
      H.sbank.textContent = `Salvage ${save.bank} · ${save.restored}/${RESTORATIONS.length} restored`;
      H.slist.innerHTML = RESTORATIONS.map((m, i) => i < save.restored ? `<div class="um-li done"><span>${m.name}</span><b>✓</b></div>` : i === save.restored ? `<div class="um-li"><span>${m.name}<br><small>${m.cost} salvage</small></span><button class="um-mini" data-r="${i}" ${save.bank < m.cost ? 'disabled' : ''}>RESTORE</button></div>` : `<div class="um-li" style="opacity:.4"><span>${m.name}</span><b>${m.cost}</b></div>`).join('');
      S.apply(save.restored);
    }
    function renderSettings(inRun) {
      const s = save.settings;
      H.slist2.innerHTML =
        `<div class="um-set"><span>View</span><span><button class="um-tog ${s.view === 'third' ? 'on' : ''}" data-v="third">THIRD</button> <button class="um-tog ${s.view === 'first' ? 'on' : ''}" data-v="first">FIRST</button></span></div>` +
        `<div class="um-set"><span>Look sensitivity</span><input type="range" min="0.4" max="2" step="0.1" value="${s.look}" data-k="look"></div>` +
        `<div class="um-set"><span>Steering sensitivity</span><input type="range" min="0.5" max="1.5" step="0.05" value="${s.steer}" data-k="steer"></div>` +
        `<div class="um-set"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></div>` +
        `<div class="um-set"><span>Music</span><button class="um-tog ${s.music ? 'on' : ''}" data-t="music">${s.music ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>Calm camera</span><button class="um-tog ${s.calmCamera ? 'on' : ''}" data-t="calmCamera">${s.calmCamera ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>Free unmaking (no limit per stretch)</span><button class="um-tog ${s.freeUnmaking ? 'on' : ''}" data-t="freeUnmaking">${s.freeUnmaking ? 'ON' : 'OFF'}</button></div>` +
        `<div class="um-set"><span>High-visibility targets</span><button class="um-tog ${s.highVis ? 'on' : ''}" data-t="highVis">${s.highVis ? 'ON' : 'OFF'}</button></div>`;
      H.resume.parentNode.style.display = inRun ? '' : 'none';
      H.setBack.style.display = inRun ? 'none' : '';
    }
    function pauseGame() { if (mode !== 'play') return; mode = 'paused'; renderSettings(true); showOnly(H.set); }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; showOnly(null); }
    const click = (e, fn) => ctx.listen(e, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    click(H.begin, begin); click(H.again, begin);
    click(H.toSanct, showSanct); click(H.oSanct, showSanct); click(H.sback, showTitle);
    click(H.smem, () => { showOnly(H.mems); const got = save.relics.slice().sort((a, b) => a - b); H.mlist.innerHTML = got.length ? got.map(i => `<div class="um-mem">“${MEMORIES[i]}”</div>`).join('') + `<div class="um-sub" style="margin-top:8px">${MEMORIES.length - got.length} still sealed somewhere in the city.</div>` : '<div class="um-sub">Relics wait behind repairs, beneath the routes, inside the mechanisms.</div>'; });
    click(H.mback, () => showOnly(H.sanct));
    click(H.toSet, () => { mode = 'settings'; renderSettings(false); showOnly(H.set); });
    click(H.setBack, showTitle); click(H.resume, resumeGame);
    click(H.quit, () => { mode = 'play'; showOnly(null); endRun('stilled'); });
    ctx.listen(H.slist, 'click', e => {
      const b = e.target.closest && e.target.closest('[data-r]'); if (!b) return;
      const i = +b.getAttribute('data-r'), m = RESTORATIONS[i];
      if (i !== save.restored || save.bank < m.cost) return;
      save.bank -= m.cost; save.restored++; persist(); audio.restore(); haptic('success');
      try { ctx.platform.milestone('restore_' + m.id); } catch (e) { }
      renderSanct();
    });
    ctx.listen(H.slist2, 'click', e => {
      const t = e.target;
      if (t.dataset.v) { save.settings.view = t.dataset.v; persist(); renderSettings(mode === 'paused'); }
      if (t.dataset.t) { save.settings[t.dataset.t] = !save.settings[t.dataset.t]; persist(); renderSettings(mode === 'paused'); if (t.dataset.t === 'music') { try { if (!save.settings.music) ctx.music.stop({ fadeOutMs: 600 }); } catch (er) { } } }
    });
    ctx.listen(H.slist2, 'input', e => { const t = e.target; if (t.dataset.k) { save.settings[t.dataset.k] = +t.value; if (t.dataset.k === 'volume') audio.setVolume(+t.value); persist(); } });

    // ---------- input ----------
    const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyE', 'KeyV', 'KeyP', 'Escape']);
    ctx.listen(window, 'keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (mode === 'title' && (e.code === 'Space' || e.code === 'Enter')) { begin(); return; }
      if (mode === 'over' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR')) { begin(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); return; }
      if (mode !== 'play') return;
      audio.unlock();
      if (e.repeat) return;
      input.keys.add(e.code);
      if (e.code === 'Space') { input.jumpPressed = true; input.jumpHeld = true; }
      if (e.code === 'KeyV') toggleView();
      if (e.code === 'KeyE') { if (run.focus) intervene(run.focus); }
    });
    ctx.listen(window, 'keyup', e => {
      input.keys.delete(e.code);
      if (e.code === 'Space') input.jumpHeld = false;
    });
    ctx.listen(window, 'blur', () => { input.keys.clear(); input.jumpHeld = false; if (mode === 'play') pauseGame(); });
    function toggleView() { save.settings.view = save.settings.view === 'first' ? 'third' : 'first'; persist(); if (save.settings.view === 'first') { cam.yaw = 0; cam.pitch = -0.1; } }
    // pointers: each finger owns one role (stick, jump, look, intervene)
    const roles = new Map();
    const rect = () => canvas.getBoundingClientRect();
    function onDown(e) {
      if (mode !== 'play') return;
      audio.unlock();
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.cancelable) e.preventDefault();
      const fp = cam.fp > 0.5;
      const touch = e.pointerType === 'touch';
      if (touch && x < ctx.width * 0.45 && y > ctx.height * 0.38) {
        roles.set(e.pointerId, { role: 'stick' });
        input.stick = { ox: x, oy: y, x, y, id: e.pointerId };
        H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = '';
        return;
      }
      // intervene: tap a target (third person), or the crosshair (first person)
      let t = null;
      if (!fp) { const [o, d] = rayFromScreen(x, y); t = pickRay(o, d, 60); if (t && !inRange(t)) t = null; }
      roles.set(e.pointerId, { role: fp ? 'look' : 'act', x0: x, y0: y, x, y, t0: performance.now(), target: t, acted: false });
      if (!fp && t) { const R = roles.get(e.pointerId); R.acted = true; R.press = t; t.deps = run.P.dependents(t.o); run.press = t; if (e.pointerType !== 'touch') { intervene(t, t.point); run.press = null; R.press = null; } else haptic('light'); }
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    }
    function onMove(e) {
      const R = roles.get(e.pointerId);
      if (!R) {
        // desktop: hovering an element previews exactly what it will do
        if (e.pointerType === 'mouse' && mode === 'play' && run && cam.fp < 0.5) {
          const r = rect(); const [o, d] = rayFromScreen(e.clientX - r.left, e.clientY - r.top); const t = pickRay(o, d, 60);
          if (t && inRange(t)) { if (!run.press || run.press.o !== t.o) { t.deps = run.P.dependents(t.o); run.press = t; } else run.press.point = t.point; } else run.press = null;
        }
        return;
      }
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (R.role === 'stick' && input.stick) {
        input.stick.x = x; input.stick.y = y;
        const dx = clamp(x - input.stick.ox, -50, 50), dy = clamp(y - input.stick.oy, -50, 50);
        H.knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (R.role === 'look') {
        const s = save.settings.look * 0.0055;
        cam.yaw = clamp(cam.yaw - (x - R.x) * s, -1.3, 1.3);
        cam.pitch = clamp(cam.pitch - (y - R.y) * s, -1.2, 0.9);
        R.x = x; R.y = y;
      } else if (R.press && run) {
        // sliding off the element cancels; sliding onto another retargets
        R.x = x; R.y = y;
        const [o, d] = rayFromScreen(x, y); const t = pickRay(o, d, 60);
        if (!t || !inRange(t)) { R.press = null; run.press = null; }
        else if (t.o !== R.press.o) { t.deps = run.P.dependents(t.o); R.press = t; run.press = t; }
        else R.press.point = t.point;
      }
    }
    function onUp(e) {
      const R = roles.get(e.pointerId); if (!R) return;
      roles.delete(e.pointerId);
      if (R.role === 'stick') { input.stick = null; H.stick.style.display = 'none'; }
      if (R.press && run) { const t = R.press; run.press = null; if (e.type === 'pointerup' && t.o.alive) intervene(t, t.point); }
      if (R.role === 'look') {
        const moved = Math.hypot(R.x - R.x0, R.y - R.y0);
        if (moved < 10 && performance.now() - R.t0 < 350 && run && run.focus) intervene(run.focus, run.focus.point);
      }
    }
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(H.jump, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); input.jumpPressed = true; input.jumpHeld = true; audio.unlock(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ctx.listen(H.jump, ev, () => { input.jumpHeld = false; });
    ctx.listen(H.view, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); toggleView(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    // desktop first person: mouse movement looks while a button is held
    ctx.listen(canvas, 'wheel', e => e.preventDefault(), { passive: false });

    // ---------- layout ----------
    function layout(w, h, safe) {
      const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
      H.top.style.paddingTop = (16 + top) + 'px';
      const js = Math.round(clamp(Math.min(w, h) * 0.2, 72, 88));
      Object.assign(H.jump.style, { width: js + 'px', height: js + 'px', right: '24px', bottom: (bot + 32) + 'px' });
      H.head.style.top = (top + h * 0.08) + 'px';
      for (const p of [H.title, H.over, H.sanct, H.mems, H.set]) p.style.paddingBottom = (bot + 16) + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      V.pmat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.5;
    }
    ctx.onResize(({ width, height, safeArea }) => layout(width, height, safeArea || ctx.safeArea), { immediate: true });

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function tick(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (mode === 'play') { acc += dt; let n = 0; while (acc >= DT && n < 5) { step(DT); acc -= DT; n++; } if (n === 5) acc = 0; }
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    showTitle();
    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__UNMAKE_DEV) {
      window.__unmake = {
        begin, showSanct, showTitle, toggleView, pauseGame, resumeGame,
        get run() { return run; }, get mode() { return mode; }, save: () => save, cam, input, camera, scene, renderer,
        advance(sec, inp) { if (inp) input.virtual = inp; const n = Math.round(sec / DT); for (let i = 0; i < n && mode === 'play'; i++) { if (inp && inp.jump) { input.jumpPressed = true; input.jumpHeld = true; } step(DT); } frame(DT); },
        act(key, segName) { const s = run.segs.find(q => q.name === segName && !q.cleared); const o = s && s.meta.keys[key]; if (!o) return 'missing'; if (!o.alive) return 'gone'; if (sealed(o)) return 'sealed'; return intervene({ o, role: 'unmake' }) ? 'ok' : 'fail'; },
        targetScreen() { if (!run.focus) return null; const p = targetPoint(run.focus); _v.set(p[0], p[1], p[2]).project(camera); return { x: (_v.x * 0.5 + 0.5) * ctx.width, y: (-_v.y * 0.5 + 0.5) * ctx.height, role: run.focus.role, key: run.focus.o.key, deps: (run.focus.deps || []).length }; },
        screenOf(key, segName) { const s = run.segs.find(q => q.name === segName); const o = s && s.meta.keys[key]; if (!o) return null; const p = o.isConn ? run.P.connMid(o) : o.pos; _v.set(p[0], p[1], p[2]).project(camera); return { x: (_v.x * 0.5 + 0.5) * ctx.width, y: (-_v.y * 0.5 + 0.5) * ctx.height, alive: o.alive }; },
        get press() { return run && run.press ? (run.press.o.key || run.press.o.id) : null; },
        preview(key, segName) { const s = run.segs.find(q => q.name === segName && !q.cleared); const o = s && s.meta.keys[key]; if (!o) return false; run.press = { o, role: 'unmake', deps: run.P.dependents(o) }; return true; },
        warp(segName, dz) { for (let i = 0; i < 30 && !run.segs.some(q => q.name === segName); i++) addSegment(); const s = run.segs.find(q => q.name === segName); if (!s) return false; const p = [s.meta.origin[0], s.meta.origin[1] + 0.02, s.z0 + (dz || 0)]; run.player.reset(p); run.stillZ = p[2] + 24; cam.init = false; return true; },
        frame: () => frame(DT), step
      };
    }
  }
};
