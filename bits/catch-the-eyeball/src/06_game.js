// =====================================================================
// The game: low-res pixel pipeline, room, input, the 30-second round,
// difficulty, scoring, HUD, title and result screens, and the Plethora
// lifecycle.
// =====================================================================

const ROUND = 30;
const FLOOR_H = 16;
const SAVE_KEY = 'cte-save';

const UI_CSS = `
.cte{position:absolute;inset:0;font-family:Inter,"Helvetica Neue",Arial,system-ui,sans-serif;color:#eadfc8;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.cte-hud{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:calc(var(--sat) + 10px) calc(var(--sar) + 18px) 0 calc(var(--sal) + 18px);font-weight:600;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .3s}
.cte-hud.on{opacity:1}
.cte-time,.cte-score{font-size:var(--hud);line-height:1;letter-spacing:.01em;text-shadow:0 1px 0 #0a0407}
.cte-time.low{color:#d9878a}
.cte-score{text-align:right;display:inline-block;transition:transform .12s ease-out}
.cte-score.bump{transform:scale(1.14)}
.cte-mult{font-size:calc(var(--hud) * .55);font-weight:600;color:#d9878a;text-align:right;margin-top:5px;opacity:0;transition:opacity .2s;letter-spacing:.04em}
.cte-mult.on{opacity:1}
.cte-pop{position:absolute;left:0;top:0;font-size:13px;font-weight:600;white-space:nowrap;opacity:0;will-change:transform,opacity;text-shadow:0 1px 0 #0a0407}
.cte-scrim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,rgba(10,4,8,.62),rgba(10,4,8,.2) 70%);opacity:0;transition:opacity .4s}
.cte-scrim.on{opacity:1}
.cte-screen{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;opacity:0;visibility:hidden;transition:opacity .35s,visibility 0s .35s}
.cte-screen.on{opacity:1;visibility:visible;transition:opacity .35s}
.cte-title{margin-top:calc(var(--sat) + 15vh);font-weight:700;font-size:clamp(30px,9.4vw,60px);letter-spacing:.05em;line-height:1;text-align:center}
.cte-title i{display:block;font-style:normal;color:#d9878a}
.cte-btn{pointer-events:auto;font:inherit;font-weight:700;font-size:14px;letter-spacing:.2em;padding:15px 44px 15px 47px;border-radius:999px;border:0;background:#eadfc8;color:#2a0c15;cursor:pointer;box-shadow:0 2px 0 #7d6a66;transition:transform .08s}
.cte-btn:active{transform:translateY(2px);box-shadow:none}
.cte-play{margin-top:9vh}
.cte-best{font-size:11px;font-weight:600;letter-spacing:.18em;color:#a08d93;margin-top:16px;min-height:14px}
.cte-res{margin-top:calc(var(--sat) + 8vh);display:flex;flex-direction:column;align-items:center}
.cte-lab{font-size:11px;font-weight:600;letter-spacing:.22em;color:#a08d93}
.cte-big{font-size:clamp(56px,17vw,96px);font-weight:700;line-height:1;margin:6px 0 4px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.cte-new{font-size:11px;font-weight:700;letter-spacing:.2em;color:#2a0c15;background:#d9878a;border-radius:999px;padding:4px 10px 4px 12px;opacity:0;transform:scale(.6);transition:opacity .25s,transform .25s cubic-bezier(.3,1.6,.5,1)}
.cte-new.on{opacity:1;transform:scale(1)}
.cte-stats{display:flex;gap:28px;margin:18px 0 18px;font-variant-numeric:tabular-nums}
.cte-stats div{display:flex;flex-direction:column;align-items:center;gap:5px}
.cte-stats b{font-size:20px;font-weight:700}
.cte-mute{position:absolute;right:calc(var(--sar) + 14px);top:calc(var(--sat) + 10px);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;color:#a08d93;opacity:0;visibility:hidden;transition:opacity .3s}
.cte-mute.on{opacity:1;visibility:visible}
.cte-mute svg{width:20px;height:20px}
.cte-board{min-height:68px;margin-bottom:20px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;font-weight:600;letter-spacing:.06em;color:#a08d93;font-variant-numeric:tabular-nums}
.cte-board div{display:flex;gap:14px;min-width:120px;justify-content:space-between}
.cte-board .me{color:#eadfc8}
.cte-board .lab{letter-spacing:.22em;font-size:10px;margin-bottom:2px}
.cte-retry{margin-top:18px}
.cte-msg{margin-top:32vh;padding:0 32px;text-align:center;font-size:14px;line-height:1.5;color:#a08d93}
`;

const ICON_SOUND = '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13 7c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M15.2 4.8C16.9 6.2 17.8 8 17.8 10s-.9 3.8-2.6 5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13.5 7.5l5 5M18.5 7.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

window.plethoraBit = {
  meta: { title: 'Catch the Eyeball', runtime: 'plethora-bit@2', tags: ['arcade', 'halloween', 'pixel-art', 'casual'], permissions: ['haptics', 'audio', 'backgroundMusic', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = { best: 0, muted: false, plays: 0 };
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- DOM shell first, so the first frame is never blank ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';position:absolute;display:block;image-rendering:pixelated;image-rendering:crisp-edges;background:#140c13;touch-action:none';
    const ui = ctx.createRoot({ className: 'cte', layer: 'overlay', input: 'passthrough' });
    ui.classList.add('cte');
    ui.style.pointerEvents = 'none';
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.scrim = el('div', 'cte-scrim on');
    H.hud = el('div', 'cte-hud');
    H.time = el('div', 'cte-time', '30', H.hud);
    const sw = el('div', '', '', H.hud); sw.style.textAlign = 'right';
    H.score = el('div', 'cte-score', '0', sw); H.mult = el('div', 'cte-mult', '', sw);
    H.pops = [0, 1, 2].map(() => el('div', 'cte-pop'));
    H.title = el('div', 'cte-screen on');
    el('div', 'cte-title', 'CATCH THE<i>EYEBALL</i>', H.title);
    H.play = el('button', 'cte-btn cte-play', 'PLAY', H.title);
    H.best = el('div', 'cte-best', '', H.title);
    H.result = el('div', 'cte-screen');
    const rc = el('div', 'cte-res', '', H.result);
    el('div', 'cte-lab', 'SCORE', rc);
    H.final = el('div', 'cte-big', '0', rc);
    H.newBest = el('div', 'cte-new', 'NEW BEST', rc);
    const stats = el('div', 'cte-stats', '', rc);
    const s1 = el('div', '', '', stats); H.rBest = el('b', '', '0', s1); el('span', 'cte-lab', 'BEST', s1);
    const s2 = el('div', '', '', stats); H.rCaught = el('b', '', '0', s2); el('span', 'cte-lab', 'CAUGHT', s2);
    H.board = el('div', 'cte-board', '', rc);
    H.again = el('button', 'cte-btn', 'PLAY AGAIN', rc);
    H.mute = el('div', 'cte-mute on', save.muted ? ICON_MUTED : ICON_SOUND);
    H.play.style.visibility = 'hidden';
    if (save.best > 0) H.best.textContent = 'BEST ' + save.best;
    if (ctx.markVisualReady) try { ctx.markVisualReady('title'); } catch (e) { }
    for (const w of ['400', '600', '700']) { try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: w, style: 'normal' }).catch(() => { }); } catch (e) { } }

    const stageMsg = {
      library: 'The game engine could not be downloaded. Check your connection, then try again.',
      renderer: 'This device could not start WebGL graphics.',
      frame: 'The first frame could not be drawn. Please reopen the game.'
    };
    let readySent = false;
    const sendReady = () => { if (!readySent) { readySent = true; try { ctx.platform.ready(); } catch (e) { } } };
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      H.play.style.display = 'none';
      const m = el('div', 'cte-msg', stageMsg[stage], H.title);
      sendReady();
      return m;
    }

    let THREE = null;
    while (!THREE) {
      try { THREE = await ctx.importModule('three', '0.164.1'); }
      catch (e) {
        if (destroyed) return;
        const m = bootFail('library', e);
        const retry = el('button', 'cte-btn cte-retry', 'TRY AGAIN', m);
        await new Promise(res => { if (ctx.input) ctx.input.activate(retry, res); else ctx.listen(retry, 'click', res); });
        m.remove(); H.play.style.display = '';
      }
      if (destroyed) return;
    }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color(PAL.wall[1]), 1);
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- art ----------
    const art = { big: {}, small: {} };
    for (const k of Object.keys(EYE_KINDS)) { art.big[k] = paintEye(22, k); art.small[k] = paintEye(14, k); }
    art.jarBack = paintJarBack(); art.jarFront = paintJarFront();
    art.shadow = paintShadow(44, 6); art.arrowL = paintArrow(-1); art.arrowR = paintArrow(1);
    art.flames = paintFlames(); art.glow = paintGlow(12, '#5a3020');

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-100, 100, 100, 0, -100, 100);
    camera.position.z = 10;
    const M = createMats(THREE);
    ctx.onDestroy(() => M.dispose());
    const audio = createAudio(caps.audio !== false);
    audio.setMuted(!!save.muted);
    ctx.onDestroy(() => audio.close());
    const fx = createFx(THREE, scene);
    const hooks = {};
    const eyes = createEyes(THREE, scene, M, art, fx, audio, hooks);
    const jar = createJar(THREE, scene, M, art, fx, audio);

    // room backdrop and its few living lights
    const bg = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
    bg.renderOrder = 0; bg.frustumCulled = false; scene.add(bg);
    const candleViews = [];

    // ---------- layout: an integer number of device pixels per art pixel ----------
    let laidOut = false;
    const world = { W: 200, H: 300, PW: 90, FLOOR: FLOOR_H, U: 1, cap: 3, k: 1, left: 0, top: 0 };
    function layout(cssW, cssH) {
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      laidOut = true;
      cssW = Math.max(1, cssW); cssH = Math.max(1, cssH);
      const dpr = Math.min(3, ctx.nativeDpr || ctx.dpr || window.devicePixelRatio || 1);
      const devW = cssW * dpr, devH = cssH * dpr;
      const scale = Math.max(1, Math.floor(Math.min(devW / 200, devH / 300)));
      let W = Math.ceil(devW / scale); if (W % 2) W++;
      const Hh = Math.ceil(devH / scale);
      const k = scale / dpr;
      world.W = W; world.H = Hh; world.k = k;
      world.left = (cssW - W * k) / 2; world.top = cssH - Hh * k;
      world.PW = Math.min(W / 2 - 2, 160);
      // the jar is the one control, so its floor sits above the content-safe bottom edge;
      // the stone below it is passive scenery that runs to the screen edge
      world.FLOOR = FLOOR_H + Math.round((sa.bottom || 0) / k);
      world.U = (Hh - world.FLOOR) / 344;
      renderer.setSize(W, Hh, false);
      canvas.style.width = (W * k) + 'px'; canvas.style.height = (Hh * k) + 'px';
      canvas.style.left = world.left + 'px'; canvas.style.top = world.top + 'px';
      camera.left = -W / 2; camera.right = W / 2; camera.top = Hh; camera.bottom = 0; camera.updateProjectionMatrix();
      ui.style.setProperty('--hud', Math.round(clamp(13 * k, 21, 32)) + 'px');
      for (const [v, n] of [['--sat', sa.top], ['--sab', sa.bottom], ['--sal', sa.left], ['--sar', sa.right]]) ui.style.setProperty(v, (n || 0) + 'px');
      // repaint the room at the new size
      const room = paintRoom(W, Hh, world.PW, world.FLOOR);
      if (bg.material.map) bg.material.map.dispose();
      const t = new THREE.CanvasTexture(room.canvas);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
      bg.material.map = t; bg.material.needsUpdate = true;
      bg.scale.set(W, Hh, 1); bg.position.set(0, Hh / 2, 0);
      for (const c of candleViews) { scene.remove(c.flame, c.glow); c.glow.material.dispose(); }
      candleViews.length = 0;
      for (const c of room.candles) {
        const flame = M.sprite(art.flames[0], 2), glow = M.sprite(art.glow, 1, { blending: THREE.AdditiveBlending, opacity: 0.5 });
        const sy = c.y + 1;
        flame.position.set(c.x + 1 - W / 2, Hh - (sy - 12), 0);
        glow.position.set(c.x + 1 - W / 2, Hh - (sy - 12), 0);
        scene.add(glow, flame);
        candleViews.push({ flame, glow, phase: Math.random() * 10 });
      }
      eyes.setWorld(world); jar.setWorld(world); eyes.clampAll();
    }

    // ---------- game state ----------
    const G = {
      mode: 'title', t: 0, score: 0, shown: 0, caught: 0, combo: 0, comboT: 0, mult: 1,
      next: 0, gold: [], endT: 0, closed: false, shake: 0, demoNext: 0, resultT: 0, newBest: false,
      kb: 0, pointerX: null, now: 0, lastTick: -1, stats: { miss: 0, split: 0, boom: 0, boomJar: 0 }
    };
    let popI = 0;
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    let attempt = 0;

    function worldToCss(x, y) { return [world.left + (x + world.W / 2) * world.k, world.top + (world.H - y) * world.k]; }
    function popup(text, color, x, y) {
      const p = H.pops[popI++ % H.pops.length];
      const [cx, cy] = worldToCss(x, y);
      p.textContent = text; p.style.color = color; p.style.fontSize = Math.round(clamp(7.5 * world.k, 12, 24)) + 'px';
      p.animate([
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-100%)`, opacity: 0 },
        { transform: `translate(${cx}px,${cy - 10}px) translate(-50%,-100%)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${cx}px,${cy - 26}px) translate(-50%,-100%)`, opacity: 0 }
      ], { duration: 650, easing: 'ease-out', fill: 'forwards' });
    }
    function setScore(v) {
      G.score = v;
      H.score.textContent = String(v);
      H.score.classList.remove('bump'); void H.score.offsetWidth; H.score.classList.add('bump');
      setTimeout(() => H.score.classList.remove('bump'), 120);
      if (scoreTrack) try { scoreTrack.set(v); } catch (e) { } else try { ctx.platform.setScore(v); } catch (e) { }
    }

    hooks.onCatch = e => {
      jar.bump(e.behaviour === 'gold' ? 1.4 : 1);
      fx.burst(e.x, jar.mouthY + 2, 6, { speed: 45, angle: Math.PI / 2, spread: 2.4, life: 0.35, g: -150, sizes: [1, 1, 2], colors: e.behaviour === 'gold' ? [PAL.irisGold[3], '#f6dc9a'] : [PAL.sclera[4], PAL.veinPink] });
      if (e.demo || G.mode !== 'play' && G.mode !== 'ending') { audio.catch(0, false); return; }
      G.combo = G.comboT > 0 ? G.combo + 1 : 1; G.comboT = 2.6;
      G.mult = G.combo >= 10 ? 4 : G.combo >= 6 ? 3 : G.combo >= 3 ? 2 : 1;
      const pts = e.rule.points * G.mult;
      G.caught++;
      setScore(G.score + pts);
      H.mult.textContent = '×' + G.mult; H.mult.classList.toggle('on', G.mult > 1);
      popup('+' + pts, e.behaviour === 'gold' ? '#efc66a' : '#eadfc8', jar.x, jar.mouthY + 8);
      audio.catch(G.combo, e.behaviour === 'gold');
      haptic(e.behaviour === 'gold' ? 'success' : 'light');
      try { ctx.platform.interact({ type: 'catch', kind: e.behaviour }); } catch (er) { }
    };
    hooks.onExplode = (e, inJar) => {
      G.stats[inJar ? 'boomJar' : 'boom']++;
      G.shake = Math.max(G.shake, inJar ? 5 : 2.5);
      if (!inJar) return;
      jar.injure();
      haptic('heavy');
      if (G.mode === 'play' || G.mode === 'ending') {
        audio.penalty();
        G.combo = 0; G.comboT = 0; G.mult = 1; H.mult.classList.remove('on');
        setScore(Math.max(0, G.score - 25));
        popup('−25', '#d9545e', jar.x, jar.mouthY + 8);
      }
    };
    hooks.onMiss = () => { G.stats.miss++; };
    hooks.onSplit = () => { G.stats.split++; G.shake = Math.max(G.shake, 1.2); };

    // ---------- spawning and difficulty ----------
    function difficulty(t) {
      const d = clamp(t / ROUND, 0, 1);
      return { interval: lerp(1.2, 0.4, Math.pow(d, 0.85)), cap: Math.round(lerp(3, 10, d)), speed: lerp(0.82, 1.45, d) };
    }
    function chooseKind(t) {
      const w = [['teal', 1], ['brown', 0.8]];
      if (t > 4) w.push(['blood', lerp(0.3, 0.55, (t - 4) / 26)]);
      if (t > 9 && eyes.countOf('warp') < 2) w.push(['warp', 0.3]);
      if (t > 13 && eyes.countOf('split') < 1) w.push(['split', 0.24]);
      if (t > 17 && eyes.countOf('demon') < 2) w.push(['demon', lerp(0.22, 0.42, (t - 17) / 13)]);
      let sum = 0; for (const [, v] of w) sum += v;
      let r = Math.random() * sum;
      for (const [k, v] of w) { r -= v; if (r <= 0) return k; }
      return 'teal';
    }
    function spawnPos(r) {
      const { PW, H: Hh, FLOOR } = world;
      let best = null;
      for (let i = 0; i < 10; i++) {
        const x = (Math.random() * 2 - 1) * (PW - r - 8);
        const y = lerp(FLOOR + (Hh - FLOOR) * 0.55, Hh - r - 30, Math.random());
        let clear = Infinity;
        for (const o of eyes.eyes) if (o.on) clear = Math.min(clear, Math.hypot(o.x - x, o.y - y) - o.r - r);
        if (!best || clear > best.clear) best = { x, y, clear };
        if (clear > 8) break;
      }
      return best;
    }
    function spawnEye(kind, speed, o) {
      const p = spawnPos(9.5);
      G.stats[kind] = (G.stats[kind] || 0) + 1;
      return eyes.spawn(kind, o && o.x !== undefined ? o.x : p.x, o && o.y !== undefined ? o.y : p.y, Object.assign({ speed }, o || {}));
    }
    function updateSpawns(dt) {
      const t = G.t, D = difficulty(t);
      world.cap = D.cap;
      // teach first: two calm eyes drift down either side of the jar
      if (G.teach < 2 && t >= (G.teach === 0 ? 0.25 : 1.3)) {
        const side = G.teach === 0 ? -1 : 1;
        spawnEye(G.teach === 0 ? 'teal' : 'brown', 0.75, { x: clamp(jar.x + side * 34, -world.PW + 20, world.PW - 20), y: world.FLOOR + (world.H - world.FLOOR) * 0.72, vx: -side * 25 * world.U, vy: 0 });
        G.teach++; G.next = t + 1.4;
        return;
      }
      if (G.gold.length && t >= G.gold[0]) { G.gold.shift(); spawnEye('gold', D.speed * 0.9); }
      if (t >= G.next && G.teach >= 2) {
        if (eyes.count() < D.cap) spawnEye(chooseKind(t), D.speed);
        G.next = t + D.interval * (0.8 + Math.random() * 0.4);
      }
    }

    // ---------- autopilot (title screen demonstration, and the test bot) ----------
    function autopilotTarget(avoidDemons) {
      let best = null;
      for (const e of eyes.eyes) {
        if (!e.on || e.state !== 'live' || e.behaviour === 'demon') continue;
        const g = 230 * world.U * e.rule.g * e.ts * e.ts;
        const h = e.y - jar.mouthY;
        if (h < 2) continue;
        const vy = e.vy * e.ts;
        const tHit = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
        let x = e.x + e.vx * e.ts * tHit;
        const L = world.PW - e.r;
        for (let i = 0; i < 4; i++) { if (x > L) x = 2 * L - x; if (x < -L) x = -2 * L - x; }
        const score = tHit - (e.behaviour === 'gold' ? 0.6 : 0);
        if (!best || score < best.score) best = { x, score };
      }
      let tx = best ? best.x : jar.target;
      if (avoidDemons) {
        for (const e of eyes.eyes) {
          if (!e.on || e.behaviour !== 'demon' || e.state !== 'live') continue;
          if (Math.abs(e.x - tx) < 30 && e.y < jar.mouthY + 90) tx = e.x + (tx >= e.x ? 34 : -34);
        }
      }
      return tx;
    }

    // ---------- flow ----------
    function show(screen) {
      H.title.classList.toggle('on', screen === 'title');
      H.result.classList.toggle('on', screen === 'result');
      H.scrim.classList.toggle('on', screen !== null);
      H.mute.classList.toggle('on', screen !== null);
      H.hud.classList.toggle('on', screen === null);
    }
    function begin() {
      if (G.mode === 'play' || G.mode === 'ending') return;
      audio.unlock(); audio.button();
      eyes.clear(); fx.clear(); jar.clear();
      Object.assign(G, { stats: { miss: 0, split: 0, boom: 0, boomJar: 0 }, mode: 'play', t: 0, score: 0, caught: 0, combo: 0, comboT: 0, mult: 1, next: 0, teach: 0, endT: 0, closed: false, shake: 0, lastTick: -1 });
      G.gold = [8 + Math.random() * 4, 18 + Math.random() * 5];
      if (Math.random() < 0.5) G.gold.push(25 + Math.random() * 3);
      H.score.textContent = '0'; H.mult.classList.remove('on'); H.time.textContent = String(ROUND); H.time.classList.remove('low');
      jar.target = 0; jar.showHint(3);
      G.pointerX = null; G.pulsed = false; G.tension = 0;
      attempt++;
      show(null);
      try { ctx.platform.start({ attempt }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { } else try { ctx.platform.setScore(0); } catch (e) { }
      startMusic();
    }

    // ---------- music: a quiet spooky bed that tightens toward the end ----------
    let music = null;
    function startMusic() {
      if (!caps.backgroundMusic || !ctx.music) return;
      try {
        ctx.music.unlock().catch(() => { });
        if (!music) music = ctx.music.play({ preset: 'spooky', volume: save.muted ? 0 : 0.2, intensity: 0.25, tempo: 84, fadeInMs: 1800 });
        else { music.setIntensity(0.25, { fadeMs: 600 }); music.setVolume(save.muted ? 0 : 0.2, { fadeMs: 300 }); }
      } catch (e) { music = null; }
    }
    function musicIntensity(v) { if (music) try { music.setIntensity(v, { fadeMs: 1200 }); } catch (e) { } }
    function musicSting(name) { if (music && !save.muted) try { ctx.music.sting(name).catch(() => { }); } catch (e) { } }

    // ---------- result-screen leaderboard: top three and the viewer's place ----------
    const BOARD = { scope: 'global', period: 'all_time' };
    let boardRows = null;
    function renderBoard(board, status) {
      const rows = board && Array.isArray(board.rows) ? board.rows.slice(0, 3) : (boardRows || []);
      if (board) boardRows = rows;
      let html = '<div class="lab">' + (status || 'TOP SCORES') + '</div>';
      for (const r of rows) html += '<div><span>#' + (r.rank | 0) + '</span><span>' + Math.round(+r.value || 0) + '</span></div>';
      if (board && board.viewerRank && board.viewerRank.rank) html += '<div class="me"><span>YOU #' + (board.viewerRank.rank | 0) + '</span><span>' + Math.round(+board.viewerRank.value || G.score) + '</span></div>';
      if (!rows.length && !status) html = '';
      H.board.innerHTML = html;
    }
    function submitScore() {
      const mine = attempt, final = G.score;
      renderBoard(null, boardRows && boardRows.length ? 'UPDATING' : 'LOADING');
      let p = null;
      try {
        if (scoreTrack && scoreTrack.submit) p = scoreTrack.submit('score', { label: final + ' pts' });
        else if (ctx.memory && ctx.memory.record) p = ctx.memory.record('score').submit(final, { label: final + ' pts' });
      } catch (e) { p = null; }
      if (!p) { H.board.innerHTML = ''; return; }
      const read = () => scoreTrack && scoreTrack.leaderboard ? scoreTrack.leaderboard('score', Object.assign({ limit: 3 }, BOARD)) : ctx.memory.record('score').leaderboard(Object.assign({ limit: 3 }, BOARD));
      Promise.resolve(p).catch(() => null).then(() => read()).then(board => {
        if (destroyed || mine !== attempt) return;
        renderBoard(board, null);
      }).catch(() => { if (!destroyed && mine === attempt) renderBoard(null, 'LEADERBOARD UNAVAILABLE'); });
    }
    function finish() {
      G.mode = 'result'; G.resultT = 0;
      save.plays = (save.plays || 0) + 1;
      G.newBest = G.score > (save.best || 0);
      if (G.newBest) save.best = G.score;
      persist();
      H.final.textContent = '0'; H.rBest.textContent = String(save.best); H.rCaught.textContent = String(G.caught);
      H.newBest.classList.remove('on');
      H.best.textContent = save.best > 0 ? 'BEST ' + save.best : '';
      show('result');
      audio.over();
      haptic('success');
      musicIntensity(0.15); musicSting(G.newBest ? 'win' : 'success');
      try { ctx.platform.complete({ score: G.score, caught: G.caught }); } catch (e) { }
      submitScore();
    }

    function step(dt) {
      G.now += dt;
      if (G.mode === 'play') {
        G.t += dt;
        const left = Math.max(0, ROUND - G.t);
        const sec = Math.ceil(left);
        H.time.textContent = left <= 5 ? left.toFixed(1) : String(sec);
        H.time.classList.toggle('low', left <= 5);
        if (G.tension === 0 && left <= 12) { G.tension = 1; musicIntensity(0.55); }
        if (G.tension === 1 && left <= 5) { G.tension = 2; musicIntensity(0.8); }
        if (left <= 5 && sec !== G.lastTick) { G.lastTick = sec; if (sec > 0) audio.tick(sec <= 3); }
        if (G.t >= ROUND) { G.mode = 'ending'; G.endT = 0; H.time.textContent = '0.0'; }
        else updateSpawns(dt);
        G.comboT = Math.max(0, G.comboT - dt);
        if (G.comboT <= 0 && G.mult > 1) { G.mult = 1; G.combo = 0; H.mult.classList.remove('on'); }
      } else if (G.mode === 'ending') {
        // let anything already dropping into the jar land, then close every eye
        G.endT += dt;
        if (G.endT >= 0.9 && !G.closed) { G.closed = true; eyes.closeAll(); }
        if (G.endT >= 1.6) finish();
      } else if (G.mode === 'title') {
        G.demoNext -= dt;
        if (G.demoNext <= 0 && eyes.count() < 2) {
          G.demoNext = 1.4 + Math.random();
          spawnEye(Math.random() < 0.12 ? 'gold' : Math.random() < 0.5 ? 'teal' : 'brown', 0.8, { demo: true });
        }
      } else if (G.mode === 'result') {
        G.resultT += dt;
        const k = Math.min(1, G.resultT / 0.9);
        H.final.textContent = String(Math.round(G.score * easeOut(k)));
        if (k >= 1 && G.newBest && !H.newBest.classList.contains('on')) { H.newBest.classList.add('on'); haptic('light'); }
        if (k >= 1 && !G.pulsed && G.resultT > 1.3) {
          G.pulsed = true;
          try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ score: G.score, durationMs: ROUND * 1000, text: 'Caught ' + G.caught + (G.caught === 1 ? ' eyeball' : ' eyeballs') + ' · ' + G.score + ' pts' }); } catch (e) { }
        }
      }

      // jar control: autopilot on the title, else keyboard or pointer
      if (G.mode === 'title' || G.bot) jar.target = autopilotTarget(!!G.bot);
      else if (G.kb) jar.target += G.kb * 300 * world.U * dt;
      else if (G.pointerX !== null) jar.target = G.pointerX;
      jar.update(dt, G.now);
      eyes.update(dt, jar);
      fx.update(dt);

      // the room breathes: candles, drifting dust
      for (const c of candleViews) {
        c.phase += dt * (7 + Math.random() * 5);
        M.setSprite(c.flame, art.flames[Math.floor(c.phase) % 3]);
        c.glow.material.opacity = 0.42 + Math.sin(c.phase * 0.7) * 0.08 + Math.random() * 0.06;
      }
      if (Math.random() < dt * 1.2) fx.burst((Math.random() * 2 - 1) * world.W / 2, world.FLOOR + Math.random() * (world.H - world.FLOOR), 1, { speed: 3, life: 3, g: -2, size: 1, color: PAL.dust });
      audio.ambience(G.mode === 'title' ? 0.6 : 1, dt);

      G.shake = Math.max(0, G.shake - dt * 18);
      const sh = Math.round(G.shake);
      camera.position.x = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0;
      camera.position.y = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0;
    }

    // ---------- input ----------
    const toWorldX = clientX => { const r = canvas.getBoundingClientRect(); return ((clientX - r.left) / r.width) * world.W - world.W / 2; };
    const playing = () => G.mode === 'play' || G.mode === 'ending';
    // touch, pen and mouse drags anywhere on the playfield move the jar
    const input = ctx.input ? ctx.input.track(canvas, { multitouch: false }) : null;
    function readInput() {
      if (!input || !playing()) return;
      const p = input.primary || input;
      if (p.down) { G.pointerX = (p.x / Math.max(1, canvas.clientWidth)) * world.W - world.W / 2; G.kb = 0; }
    }
    if (!input) {
      let dragging = false;
      ctx.listen(canvas, 'pointerdown', e => { dragging = true; G.kb = 0; if (playing()) G.pointerX = toWorldX(e.clientX); });
      ctx.listen(canvas, 'pointermove', e => { if (dragging && playing()) G.pointerX = toWorldX(e.clientX); });
      const up = () => { dragging = false; };
      ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up);
    }
    // a desktop mouse also steers by hovering, without holding a button
    ctx.listen(canvas, 'pointermove', e => { if (e.pointerType === 'mouse' && playing()) { G.pointerX = toWorldX(e.clientX); G.kb = 0; } });
    const keys = new Set();
    const kbDir = () => (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const keyName = k => (k === 'ArrowLeft' || k === 'a' || k === 'A') ? 'left' : (k === 'ArrowRight' || k === 'd' || k === 'D') ? 'right' : null;
    ctx.listen(window, 'keydown', e => {
      const n = keyName(e.key);
      if (n) { keys.add(n); if (G.mode === 'play' || G.mode === 'ending') { G.kb = kbDir(); G.pointerX = null; } e.preventDefault(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && (G.mode === 'title' || (G.mode === 'result' && G.resultT > 0.5))) { e.preventDefault(); begin(); }
      if (e.key === 'm' || e.key === 'M') toggleMute();
    });
    ctx.listen(window, 'keyup', e => { const n = keyName(e.key); if (n) { keys.delete(n); G.kb = kbDir(); } });
    ctx.listen(window, 'blur', () => { keys.clear(); G.kb = 0; });
    const activate = (node, fn) => { if (ctx.input) ctx.input.activate(node, fn); else ctx.listen(node, 'click', fn); };
    activate(H.play, begin);
    activate(H.again, () => { if (G.resultT > 0.4) begin(); });
    function toggleMute() {
      save.muted = !save.muted; persist();
      audio.setMuted(save.muted);
      H.mute.innerHTML = save.muted ? ICON_MUTED : ICON_SOUND;
      if (music) try { music.setVolume(save.muted ? 0 : 0.2, { fadeMs: 200 }); } catch (e) { }
    }
    H.mute.setAttribute('role', 'button'); H.mute.setAttribute('tabindex', '0'); H.mute.setAttribute('aria-label', 'Sound');
    activate(H.mute, () => { audio.unlock(); toggleMute(); });

    // ---------- run ----------
    ctx.onResize(({ width, height }) => layout(width, height), { immediate: true });
    if (!laidOut) layout(ctx.width, ctx.height);
    jar.x = 0; jar.target = 0;
    try { renderer.render(scene, camera); } catch (e) { bootFail('frame', e); return; }
    H.play.style.visibility = '';
    sendReady();

    const frame = dtMs => {
      if (destroyed || G.manual) return;
      readInput();
      step(Math.min(0.05, Math.max(0, dtMs / 1000)));
    };
    const draw = () => { if (!destroyed) renderer.render(scene, camera); };
    if (ctx.game && ctx.game.loop) ctx.game.loop({ input: input || undefined, maxDeltaMs: 50, update: frame, render: draw });
    else {
      let last = performance.now();
      ctx.onFrame(() => { const now = performance.now(); frame(now - last); last = now; draw(); });
    }

    if (window.__CTE_DEV) {
      window.__cte = {
        G, world, eyes, jar, begin, art,
        // run the simulation deterministically in 60 Hz steps, without the frame loop
        advance(sec, o) {
          G.manual = true; G.bot = !!(o && o.bot);
          const n = Math.round(sec * 60);
          for (let i = 0; i < n; i++) step(1 / 60);
          renderer.render(scene, camera);
          G.manual = !!(o && o.hold);
        },
        spawn: (kind, x, y, o) => eyes.spawn(kind, x, y, Object.assign({ instant: true }, o || {})),
        render() { renderer.render(scene, camera); }
      };
    }
  }
};
