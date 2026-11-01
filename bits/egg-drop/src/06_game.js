// Game: state flow, input, rendering, HUD, scoring and results.

const H_STEP = 1 / 120;
const SAVE_KEY = 'eggdrop.v1';
const MESSAGES = [
  [8, 'A tender beginning.'],
  [18, 'The shell held, briefly.'],
  [30, 'You found the weight of it.'],
  [45, 'Steady hands.'],
  [65, 'A balanced mind.'],
  [90, 'The egg trusts you.'],
  [Infinity, 'Still life, perfectly kept.']
];

const UI_CSS = `
.ed-ui{position:absolute;inset:0;pointer-events:none;font-family:'Cormorant Garamond',Georgia,serif;color:#3b2417;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.ed-ui button{pointer-events:auto;font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer;touch-action:manipulation}
.ed-icons{position:absolute;display:flex;gap:8px}
.ed-ui .ed-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(245,234,210,.82);box-shadow:inset 0 0 0 1.5px rgba(140,106,38,.7)}
.ed-ui .ed-icon svg{width:22px;height:22px}
.ed-ui .ed-icon.on{background:#b88f3a;box-shadow:inset 0 0 0 1.5px #8c6a26}
.ed-chips{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:6px;transition:opacity .25s}
.ed-ui .ed-chip{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 7px 5px;border-radius:12px;min-width:62px;background:rgba(245,234,210,.78);box-shadow:inset 0 0 0 1px rgba(90,58,36,.25)}
.ed-ui .ed-chip i{display:block;width:40px;height:9px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(59,36,23,.35)}
.ed-ui .ed-chip span{font-family:'Inter',system-ui,sans-serif;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.ed-ui .ed-chip.sel{background:#f5ead2;box-shadow:inset 0 0 0 2px #6a1f2b}
.ed-card{position:absolute;left:50%;transform:translate(-50%,0);width:min(330px,calc(100% - 40px));padding:20px 20px 18px;box-sizing:border-box;text-align:center;border-radius:6px;background-color:#f5ead2;background-size:cover;box-shadow:0 10px 30px rgba(59,36,23,.35);pointer-events:auto;opacity:0;transition:opacity .35s,transform .35s;transform:translate(-50%,14px)}
.ed-card.show{opacity:1;transform:translate(-50%,0)}
.ed-kick{font-style:italic;font-size:19px;opacity:.85}
.ed-time{font-family:'DM Serif Display',Georgia,serif;font-size:62px;line-height:1;margin:6px 0 2px;color:#6a1f2b}
.ed-time small{font-size:26px;margin-left:3px}
.ed-best{font-family:'Inter',system-ui,sans-serif;font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.8}
.ed-best b{color:#d63e2a}
.ed-msg{font-style:italic;font-size:21px;margin:10px 0 8px}
.ed-pts{font-family:'Inter',system-ui,sans-serif;font-size:11.5px;line-height:1.5;opacity:.85}
.ed-pts strong{font-size:13px}
.ed-board{margin:12px auto 0;max-width:250px;font-family:'Inter',system-ui,sans-serif;font-size:12px;border-top:1px solid rgba(59,36,23,.2);padding-top:8px;min-height:20px}
.ed-row{display:flex;justify-content:space-between;padding:1px 0}
.ed-row.me{color:#6a1f2b;font-weight:600}
.ed-dim{opacity:.6;font-size:11px}
.ed-ui .ed-again{margin-top:14px;display:inline-block;padding:11px 34px;border-radius:28px;background:#6a1f2b!important;color:#f5ead2!important;font-family:'Inter',system-ui,sans-serif!important;font-weight:600;font-size:14px;letter-spacing:.14em;text-transform:uppercase;box-shadow:inset 0 0 0 2px #4d1520,0 3px 0 #4d1520}
.ed-ui .ed-again:active{transform:translateY(2px);box-shadow:inset 0 0 0 2px #4d1520,0 1px 0 #4d1520}
.ed-mode{position:absolute;left:50%;transform:translateX(-50%);display:flex;border-radius:20px;background:rgba(245,234,210,.82);box-shadow:inset 0 0 0 1.5px rgba(140,106,38,.7);padding:3px;gap:2px;transition:opacity .25s}
.ed-ui .ed-mode button{font-family:'Inter',system-ui,sans-serif;font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;padding:9px 11px;border-radius:16px;display:flex;align-items:center;gap:5px;white-space:nowrap}
.ed-ui .ed-mode button.sel{background:#6a1f2b;color:#f5ead2}
.ed-ui .ed-mode button svg{width:14px;height:14px}
.ed-ui .ed-mode button.sel svg *{stroke:#f5ead2}
.ed-mode.locked{opacity:.75}
.ed-mode.locked button{pointer-events:none}
.ed-tp{position:absolute;left:50%;transform:translateX(-50%);width:min(320px,calc(100% - 32px));box-sizing:border-box;padding:16px 18px 14px;border-radius:6px;background:#f5ead2;box-shadow:0 10px 30px rgba(59,36,23,.35);pointer-events:auto;text-align:center}
.ed-tp h3{margin:0 0 4px;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:24px;color:#6a1f2b}
.ed-tp p{margin:0 0 10px;font-style:italic;font-size:18px}
.ed-tp .g{position:relative;height:16px;margin:4px 8px 12px;border-radius:8px;background:#c9c48a;box-shadow:inset 0 0 0 1.5px #8c6a26}
.ed-tp .g i{position:absolute;top:2px;width:22px;height:12px;margin-left:-11px;border-radius:6px;background:#f5ead2;box-shadow:0 0 0 1px rgba(59,36,23,.4)}
.ed-tp .g b{position:absolute;left:50%;top:2px;bottom:2px;width:1px;background:rgba(59,36,23,.5)}
.ed-tp label{display:flex;align-items:center;gap:10px;font-family:'Inter',system-ui,sans-serif;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:10px 4px 2px}
.ed-tp input[type=range]{flex:1;accent-color:#6a1f2b;pointer-events:auto}
.ed-tp .st{font-family:'Inter',system-ui,sans-serif;font-size:11px;opacity:.75;margin-top:8px;min-height:14px}
.ed-tp .row{display:flex;gap:8px;justify-content:center;margin-top:12px}
.ed-ui .ed-tp .btn{padding:10px 18px;border-radius:22px;font-family:'Inter',system-ui,sans-serif;font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;background:#6a1f2b;color:#f5ead2;box-shadow:inset 0 0 0 2px #4d1520,0 3px 0 #4d1520}
.ed-ui .ed-tp .btn.alt{background:transparent;color:#3b2417;box-shadow:inset 0 0 0 1.5px rgba(59,36,23,.45)}
.ed-ui .ed-tp .btn[disabled]{opacity:.4;pointer-events:none}
.ed-err{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:80%;font-size:20px;pointer-events:auto}
`;

const ICON = {
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="#3b2417"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="#3b2417"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  touch: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V8.5a1.5 1.5 0 0 1 3 0V11M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L9 15"/></svg>',
  tilt: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b2417" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.5" width="8" height="17" rx="2" transform="rotate(18 12 12)"/><path d="M3 20c2-1 4-1 6 0M15 20c2-1 4-1 6 0"/></svg>'
};

function fmtTime(sec) {
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

async function eggDropInit(ctx) {
  let disposed = false;
  ctx.onDestroy(() => { disposed = true; });
  const area = () => ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
  const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number(id); return v == null || !isFinite(v) ? d : v; } catch (e) { return d; } };
  const caps = ctx.capabilities || {};

  // ---- persistence (this device) ----
  let save = { surface: 'wood', muted: false, best: {}, bestPts: {}, runs: 0 };
  if (caps.storage && ctx.storage) { try { const v = ctx.storage.get(SAVE_KEY); if (v && typeof v === 'object') save = Object.assign(save, v); } catch (e) { } }
  if (!SURFACES[save.surface]) save.surface = 'wood';
  const persist = () => { if (caps.storage && ctx.storage) { try { ctx.storage.set(SAVE_KEY, save); } catch (e) { } } };

  // ---- surfaces ----
  canvasFallback = () => { const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' }); c.style.display = 'none'; return c; };
  const canvas = ctx.createCanvas2D({ coordinateSpace: 'css', maxDpr: 2, alpha: false, touchAction: 'none', layer: 'content' });
  const g = canvas.getContext('2d');
  const ui = ctx.createRoot({ className: 'ed-ui', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || ui).appendChild(e); return e; };

  try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
  try { ctx.loadFont('Cormorant Garamond', 'cormorant-garamond', '1.0.0', { weight: '300', style: 'italic' }).catch(() => { }); } catch (e) { }
  try { ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }); } catch (e) { }

  // ---- layout ----
  const L = { W: 1, H: 1, dpr: 1, k: 80, px: 0, py: 0 };
  let bg = null, sprites = {}, artKey = '';
  function layout() {
    const W = Math.max(1, ctx.width), Hh = Math.max(1, ctx.height), a = area();
    L.W = W; L.H = Hh; L.dpr = Math.min(2, ctx.dpr || 1);
    const usableH = Hh - a.top - a.bottom;
    // the platform spans most of the width; keep room above for the HUD
    // the deck nearly spans the width; the camera pulls back for a fall
    L.k = Math.min((W - 16) / 4.3, (usableH - 200) / (1.6 - GEOM.tableY));
    L.px = W / 2;
    L.py = a.top + 112 + 1.6 * L.k;
    // spread spare height between the HUD gap and the table
    const spare = (Hh - a.bottom - 52) - (L.py - GEOM.tableY * L.k);
    if (spare > 0) L.py += spare * 0.8;
    L.hudBottom = a.top + 112;
    L.padX = Math.round(W * 0.56); L.padY = Math.round(Hh * 0.3);
    placeUI();
  }
  function buildArt() {
    const key = [L.W, L.H, L.dpr, L.k.toFixed(2), save.surface].join('|');
    if (key === artKey) return;
    const sizeChanged = !artKey || artKey.split('|').slice(0, 4).join('|') !== key.split('|').slice(0, 4).join('|');
    artKey = key;
    const S = L.k * L.dpr;
    if (sizeChanged || !bg) {
      bg = paintBackground(L, 11);
      sprites = { platforms: {} };
      sprites.cw = paintCounterweight(S, 23); grain(sprites.cw.canvas, 0.05, mulberry32(3), false);
      sprites.danger = paintDanger(S, 31);
      sprites.broken = paintBroken(S, 41); grain(sprites.broken.canvas, 0.04, mulberry32(5), false);
      sprites.egg = null;
    }
    if (!sprites.platforms[save.surface]) { const p = paintPlatform(S, save.surface, 17); grain(p.canvas, 0.05, mulberry32(9), false); sprites.platforms[save.surface] = p; }
  }
  function eggSprite() {
    if (!sprites.egg && sim) { sprites.egg = paintEggShell(L.k * L.dpr, sim.outline, 29); grain(sprites.egg.canvas, 0.035, mulberry32(7), false); }
    return sprites.egg;
  }

  // ---- DOM controls ----
  const icons = el('div', 'ed-icons');
  const muteBtn = el('button', 'ed-icon', save.muted ? ICON.mute : ICON.sound, icons);
  muteBtn.setAttribute('aria-label', 'Sound');
  // control mode: TOUCH (drag the weight) or PHONE TILT
  const modeEl = el('div', 'ed-mode');
  const modeBtn = {
    touch: el('button', 'sel', ICON.touch + '<span>Touch</span>', modeEl),
    tilt: el('button', '', ICON.tilt + '<span>Phone tilt</span>', modeEl)
  };
  modeBtn.touch.setAttribute('aria-label', 'Touch control');
  modeBtn.tilt.setAttribute('aria-label', 'Phone tilt control');
  const tp = el('div', 'ed-tp');
  tp.style.display = 'none';
  tp.innerHTML = `<h3>Phone tilt</h3>
    <p class="msg">Hold your phone comfortably upright.</p>
    <div class="g"><b></b><i></i></div>
    <div class="row"><button class="btn cal">Calibrate</button></div>
    <label>Sensitivity <input class="sens" type="range" min="0.5" max="2" step="0.05" value="1"></label>
    <div class="st"></div>
    <div class="row"><button class="btn alt use-touch">Use touch</button><button class="btn done" disabled>Done</button></div>`;
  const tpEl = { msg: tp.querySelector('.msg'), knob: tp.querySelector('.g i'), cal: tp.querySelector('.cal'), sens: tp.querySelector('.sens'), st: tp.querySelector('.st'), done: tp.querySelector('.done'), touch: tp.querySelector('.use-touch') };
  const chips = el('div', 'ed-chips');
  const chipEls = {};
  const SW = { rubber: PAL.olive2, wood: '#d9a25a', ceramic: PAL.ivory, metal: '#c9b48a' };
  for (const id of SURFACE_ORDER) {
    const b = el('button', 'ed-chip', `<i style="background:${SW[id]}"></i><span>${SURFACES[id].label}</span>`, chips);
    chipEls[id] = b;
    ctx.input.activate(b, () => { if (state === 'play' || state === 'falling') return; audio.unlock(); selectSurface(id); });
  }
  const card = el('div', 'ed-card');
  card.style.display = 'none';
  function placeUI() {
    const a = area();
    icons.style.top = (a.top + 10) + 'px'; icons.style.right = (a.right + 12) + 'px';
    // control switch sits above the surface chips; during play it stays as the mode indicator
    modeEl.style.bottom = (a.bottom + 12 + 58) + 'px';
    L.modeTop = L.H - (a.bottom + 12 + 58) - 40;
    tp.style.top = Math.max(a.top + 120, L.H * 0.2) + 'px';
    chips.style.bottom = (a.bottom + 12) + 'px';
    card.style.top = Math.max(a.top + 70, L.H * 0.16) + 'px';
  }
  function refreshChips() { for (const id of SURFACE_ORDER) chipEls[id].classList.toggle('sel', id === save.surface); }
  refreshChips();

  // a painted paper texture for the result card
  (function () {
    const c = makeCanvas(330, 420), cg = c.getContext('2d'), r = mulberry32(77);
    cg.fillStyle = PAL.ivory; cg.fillRect(0, 0, 330, 420);
    strokeFill(cg, r, { x: -20, y: -20, w: 370, h: 460 }, PAL.ivory, { angle: -0.4, width: 30, length: 110, count: 60, alpha: 0.35, spread: 0.06 });
    for (let i = 0; i < 4; i++) wash(cg, r, r() * 330, r() * 420, 90, PAL.butter, 0.12);
    grain(c, 0.06, r, true);
    try {
      if (c.convertToBlob) c.convertToBlob({ type: 'image/jpeg', quality: 0.82 }).then(b => { if (!disposed) { const u = URL.createObjectURL(b); card.style.backgroundImage = `url(${u})`; ctx.onDestroy(() => URL.revokeObjectURL(u)); } }).catch(() => { });
      else card.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.82)})`;
    } catch (e) { }
  })();

  // ---- audio ----
  const audio = createAudio(ctx);
  audio.muted = !!save.muted;
  audio.musicVol = tune('music_volume', 0.32);
  ctx.onDestroy(() => audio.dispose());
  ctx.input.activate(muteBtn, () => {
    audio.unlock();
    save.muted = !save.muted; persist();
    audio.setMuted(save.muted);
    muteBtn.innerHTML = save.muted ? ICON.mute : ICON.sound;
  });

  // ---- control mode ----
  // Both modes steer the carriage through the same servo target (sim.target).
  const tilt = createTilt(ctx);
  tilt.sensitivity = save.tiltSens || 1;
  tpEl.sens.value = String(tilt.sensitivity);
  let mode = 'touch';            // 'touch' | 'tilt'
  let tpOpen = false;
  function setMode(m) {
    mode = m;
    modeBtn.touch.classList.toggle('sel', m === 'touch');
    modeBtn.tilt.classList.toggle('sel', m === 'tilt');
    tilt.reset();
    ctx.platform.interact({ type: 'control', mode: m });
  }
  function openTiltPanel(open) {
    tpOpen = open;
    tp.style.display = open ? 'block' : 'none';
    if (open) hideCard();
    else if (state === 'results') { card.style.display = 'block'; card.classList.add('show'); }
  }
  function refreshTiltPanel() {
    if (!tpOpen) return;
    const live = tilt.receiving();
    tpEl.cal.disabled = !live;
    tpEl.done.disabled = !(live && tilt.neutral != null);
    tpEl.st.textContent = tilt.statusText();
    const v = tilt.neutral == null ? 0 : Math.max(-1, Math.min(1, tilt.calibratedDeg() / (TILT_DEFAULTS.fullDeg / tilt.sensitivity)));
    tpEl.knob.style.left = (50 + v * 46) + '%';
    if (tilt.permission === 'denied') tpEl.msg.textContent = 'Motion access was refused. Touch control still works.';
    else if (tilt.permission === 'insecure') tpEl.msg.textContent = 'Phone tilt needs a secure (https) page. Touch control still works.';
    else if (tilt.permission === 'unavailable') tpEl.msg.textContent = 'This device or browser gives no motion data. Touch control still works.';
    else if (tilt.neutral != null) tpEl.msg.textContent = 'Calibrated. Tilt it like a steering wheel to test.';
    else tpEl.msg.textContent = 'Hold your phone comfortably upright, then tap Calibrate.';
  }
  ctx.input.activate(modeBtn.touch, () => { if (state === 'play' || state === 'falling') return; openTiltPanel(false); setMode('touch'); });
  ctx.input.activate(modeBtn.tilt, () => {
    if (state === 'play' || state === 'falling') return;
    audio.unlock();
    openTiltPanel(true);
    if (!tilt.available()) { tilt.permission = 'unavailable'; refreshTiltPanel(); return; }
    // enable() is called straight from the tap: iOS only prompts inside a gesture
    tilt.enable().then(() => { if (!disposed) refreshTiltPanel(); });
    refreshTiltPanel();
  });
  ctx.input.activate(tpEl.cal, () => {
    if (tilt.calibrate()) { if (caps.haptics) ctx.platform.haptic('light'); audio.chime(false); }
    refreshTiltPanel();
  });
  ctx.listen(tpEl.sens, 'input', () => {
    tilt.sensitivity = Math.max(0.5, Math.min(2, parseFloat(tpEl.sens.value) || 1));
    save.tiltSens = tilt.sensitivity; persist();
  });
  ctx.input.activate(tpEl.done, () => {
    if (tilt.neutral == null) return;
    setMode('tilt'); openTiltPanel(false);
    toast('Phone tilt on: tilt to move the weight');
  });
  ctx.input.activate(tpEl.touch, () => { setMode('touch'); openTiltPanel(false); });

  // ---- simulation and run state ----
  let pl = null, sim = null, dist = null;
  let state = 'loading';
  let run = null, attempt = 0, runSeed = (Date.now() & 0xffff) ^ 0x5eed;
  const prev = { ang: 0, cw: 0, ex: 0, ey: 0, ea: 0 }, cur = { ang: 0, cw: 0, ex: 0, ey: 0, ea: 0 };
  const fx = { zoom: 1, pan: 0, slide: 0, roll: 0, danger: 0, air: 0, creak: 0, grabGlow: 0, phaseFlash: 0, lastPhase: 0, floaters: [], toast: null, broken: null, fallT: 0 };
  const timeTrack = ctx.game.score('time', { primary: true, min: 0 });
  const pointsTrack = ctx.game.score('points', { min: 0 });

  function snapshot(o) {
    o.ang = sim.platform.getAngle(); o.cw = sim.cwPos();
    const p = sim.egg.getPosition(); o.ex = p.x; o.ey = p.y; o.ea = sim.egg.getAngle();
  }
  function newSim() {
    sim = createSim(pl, {
      surface: save.surface,
      gravityScale: tune('gravity_scale', 1),
      angularDamping: tune('platform_damping', 0.9),
      cwMass: tune('counterweight_mass', 1.4)
    });
    sprites.egg = null;
    snapshot(prev); snapshot(cur);
  }
  function selectSurface(id) {
    if (save.surface === id) return;
    save.surface = id; persist(); refreshChips();
    buildArt();
    hideCard();
    newSim(); state = 'ready'; run = null; fx.broken = null;
    ctx.platform.interact({ type: 'surface', surface: id });
  }
  function toast(text) { fx.toast = { text, t: 0 }; }

  function beginRun() {
    attempt++;
    runSeed = (runSeed * 1103515245 + 12345 + attempt * 7919) >>> 0;
    dist = createDisturbance(runSeed, tune('disturbance_strength', 1));
    run = { t: 0, bonus: 0, counts: { steady: 0, rescue: 0, weathered: 0, light: 0 }, steadyT: 0, fallSteps: 0, warned: false, critical: false, gustWatch: -1, winStart: 0, winClean: true, fellAt: 0, maxPhase: 0 };
    state = 'play';
    timeTrack.reset(); pointsTrack.reset();
    fx.lastPhase = 0; fx.floaters.length = 0;
    chips.style.opacity = '0'; chips.style.pointerEvents = 'none';
    modeEl.classList.add('locked'); openTiltPanel(false);
    ctx.platform.start({ surface: save.surface });
    audio.music(0.2);
  }
  function addBonus(kind, pts, label) {
    run.bonus += pts; run.counts[kind]++;
    const l = sim.eggLocal();
    fx.floaters.push({ text: label + '  +' + pts, x: l.x, t: 0 });
    audio.chime(kind === 'rescue');
    if (caps.haptics) ctx.platform.haptic(kind === 'rescue' ? 'success' : 'light');
    ctx.platform.milestone(kind, { t: Math.round(run.t * 1000) });
  }

  // ---- input: grab the carriage anywhere, drag horizontally ----
  // The carriage moves DRAG_GAIN metres per metre of finger travel: about
  // 0.4 m of carriage takes the platform to its stop, so 1:1 made a few
  // pixels of finger tip the platform hard.
  const DRAG_GAIN = 0.55;
  const drag = { id: null, startX: 0, startTarget: 0, lastX: 0 };
  ctx.listen(canvas, 'pointerdown', (e) => {
    if (drag.id !== null || !sim || tpOpen) return;
    if (state !== 'ready' && state !== 'play') return;
    audio.unlock();
    if (mode === 'tilt') {
      // in tilt mode a tap only starts the run; the phone steers
      if (state === 'ready') { beginRun(); ctx.platform.interact({ type: 'start' }); }
      return;
    }
    drag.id = e.pointerId; drag.startX = e.clientX; drag.lastX = e.clientX;
    drag.startTarget = sim.cwPos();
    sim.target = drag.startTarget;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    audio.grab(); fx.grabGlow = 1;
    if (caps.haptics) ctx.platform.haptic('light');
    if (state === 'ready') beginRun();
    ctx.platform.interact({ type: 'grab' });
    e.preventDefault();
  });
  ctx.listen(canvas, 'pointermove', (e) => {
    if (e.pointerId !== drag.id || !sim) return;
    drag.lastX = e.clientX;
    sim.target = Math.max(-GEOM.travel - 0.08, Math.min(GEOM.travel + 0.08, drag.startTarget + DRAG_GAIN * (e.clientX - drag.startX) / L.k));
  });
  const endDrag = (e) => {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    audio.release();
    if (caps.haptics) ctx.platform.haptic('light');
  };
  ctx.listen(canvas, 'pointerup', endDrag);
  ctx.listen(canvas, 'pointercancel', endDrag);
  const keys = { l: false, r: false };
  ctx.listen(window, 'keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = true;
    else if (e.key === 'ArrowRight' || e.key === 'd') keys.r = true;
    else if ((e.key === ' ' || e.key === 'Enter') && state === 'results') { again(); return; }
    else return;
    audio.unlock();
    if (state === 'ready' && sim) { sim.target = sim.cwPos(); beginRun(); }
  });
  ctx.listen(window, 'keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = false; });

  // ---- fixed-step simulation ----
  function fixedUpdate() {
    if (!sim) return;
    snapshot(prev);
    const live = state === 'ready' || state === 'play';
    // who is steering the carriage
    if (live && drag.id !== null) sim.dragging = true;
    else if (live && (keys.l || keys.r)) { sim.dragging = true; sim.target = Math.max(-GEOM.travel - 0.05, Math.min(GEOM.travel + 0.05, sim.target + ((keys.r ? 1 : 0) - (keys.l ? 1 : 0)) * 1.6 * H_STEP)); }
    else if (live && mode === 'tilt') {
      const u = tilt.update(H_STEP);
      // tilting the phone in the ready state starts the run
      if (state === 'ready' && Math.abs(u) > 0.06) beginRun();
      if (state === 'play') { sim.dragging = true; sim.target = u * GEOM.travel; }
      else sim.dragging = false;
    }
    else sim.dragging = false;

    if (state === 'play') {
      run.t += H_STEP;
      const l = sim.eggLocal();
      const side = Math.abs(l.x) > 1.25 ? Math.sign(l.x) : 0;
      sim.disturb = dist.update(run.t, H_STEP, side);
      for (const ev of dist.events) {
        if (ev === 'gustWarn') audio.gustWarn();
        else if (ev === 'gust') { audio.gust(); if (caps.haptics) ctx.platform.haptic('medium'); }
      }
      scoreStep(l);
    } else if (state === 'ready') sim.disturb = 0;
    else sim.disturb = 0;

    sim.step(H_STEP);
    snapshot(cur);

    // physical events to sound and touch
    if (sim.limitHit) { audio.clunk(sim.limitHit); if (caps.haptics && sim.limitHit > 0.6) ctx.platform.haptic('medium'); if (run && state === 'play') run.winClean = false; sim.limitHit = 0; }
    if (sim.stopHit) { audio.thud(sim.stopHit); sim.stopHit = 0; }
    if (sim.deckImpact > 0.06) audio.tick(sim.deckImpact, save.surface);
    sim.deckImpact = 0;
    const w = sim.platform.getAngularVelocity(), a = sim.platform.getAngle();
    if (Math.abs(a) > 0.16 && Math.abs(w) > 0.03) {
      fx.creak += Math.abs(w) * H_STEP * 22;
      if (fx.creak > 1) { fx.creak = 0; audio.creak(Math.min(1, (Math.abs(a) - 0.12) / 0.19)); }
    }

    // a single odd contact frame can't end a run: the egg must stay off
    // the deck and past its end for several consecutive steps
    if (state === 'play') run.fallSteps = sim.eggFallen() ? run.fallSteps + 1 : 0;
    if (state === 'play' && run.fallSteps >= 6) {
      state = 'falling'; fx.fallT = 0;
      run.fellAt = run.t;
      audio.fall(); audio.duck(0.6, 1200);
      if (caps.haptics) ctx.platform.haptic('heavy');
      drag.id = null;
    }
    if (state === 'falling') {
      fx.fallT += H_STEP;
      const p = sim.egg.getWorldCenter();
      if (sim.tableImpact > 0.12 || p.y < GEOM.tableY + 0.45 || fx.fallT > 2.6) crack();
    }
    sim.tableImpact = 0;
    if (state === 'broken') {
      fx.fallT += H_STEP;
      if (fx.fallT > 1.0) showResults();
    }
  }

  function scoreStep(l) {
    const a = Math.abs(sim.platform.getAngle());
    // steady: platform held within 1.5 degrees of level for five seconds
    if (run.t > 3 && a < 0.026) { run.steadyT += H_STEP; if (run.steadyT >= 5) { run.steadyT = 0; addBonus('steady', 25, 'Steady'); } }
    else run.steadyT = 0;
    // rescue: back to the middle from the brink
    if (Math.abs(l.x) > 1.5) run.critical = true;
    else if (run.critical && Math.abs(l.x) < 0.6) { run.critical = false; addBonus('rescue', 100, 'Rescued'); }
    // weathered a gust
    if (dist.gustJustEnded) run.gustWatch = run.t;
    if (run.gustWatch >= 0 && run.t - run.gustWatch > 2.5) { run.gustWatch = -1; addBonus('weathered', 60, 'Weathered'); }
    // light touch: ten seconds without slamming or over-reaching the carriage
    if (Math.abs(sim.cwPos()) > 0.9) run.winClean = false;
    if (run.t - run.winStart >= 10) { if (run.winClean && run.t > 9) addBonus('light', 20, 'Light touch'); run.winStart = run.t; run.winClean = true; }
    // difficulty phase: fixed survival-time thresholds, announced once each
    const ph = dist.phase;
    if (ph > fx.lastPhase) {
      fx.lastPhase = ph; fx.phaseFlash = 1;
      audio.music([0.2, 0.34, 0.5, 0.66][ph]);
      ctx.platform.milestone('phase_' + PHASES[ph].name.toLowerCase());
    }
    const secs = Math.floor(run.t * 10);
    timeTrack.set(Math.round(run.t * 1000));
    pointsTrack.set(secs + run.bonus);
  }

  function crack() {
    state = 'broken'; fx.fallT = 0;
    const p = sim.egg.getWorldCenter();
    fx.broken = { x: Math.max(-4.2, Math.min(4.2, p.x)), t: 0 };
    sim.egg.setActive(false);
    audio.crack();
    if (caps.haptics) ctx.platform.haptic('error');
  }

  // ---- results ----
  let boardCache = {};
  function showResults() {
    state = 'results';
    const tSec = run.fellAt, ms = Math.round(tSec * 1000);
    const pts = Math.floor(tSec * 10) + run.bonus;
    timeTrack.set(ms); pointsTrack.set(pts);
    const surf = save.surface;
    const prevBest = save.best[surf] || 0;
    const isBest = ms > prevBest;
    if (isBest) save.best[surf] = ms;
    if (pts > (save.bestPts[surf] || 0)) save.bestPts[surf] = pts;
    save.runs = (save.runs || 0) + 1;
    persist();
    const msg = MESSAGES.find(m => tSec < m[0])[1];
    const c = run.counts;
    const parts = [];
    if (c.steady) parts.push('Steady ×' + c.steady);
    if (c.rescue) parts.push('Rescued ×' + c.rescue);
    if (c.weathered) parts.push('Weathered ×' + c.weathered);
    if (c.light) parts.push('Light touch ×' + c.light);
    card.innerHTML = `
      <div class="ed-kick">The egg fell from ${SURFACES[surf].label.toLowerCase()}</div>
      <div class="ed-time">${fmtTime(tSec)}<small>s</small></div>
      <div class="ed-best">${isBest && prevBest ? '<b>New best</b> · was ' + fmtTime(prevBest / 1000) + ' s' : isBest ? '<b>First balance</b>' : 'Best ' + fmtTime(save.best[surf] / 1000) + ' s'}</div>
      <div class="ed-msg">${msg}</div>
      <div class="ed-pts"><strong>${pts}</strong> points${parts.length ? ' · ' + parts.join(' · ') : ''}</div>
      <div class="ed-board"><span class="ed-dim">Updating board…</span></div>
      <button class="ed-again">Again</button>`;
    card.style.display = 'block';
    requestFrameClass();
    ctx.input.activate(card.querySelector('.ed-again'), again);
    chips.style.opacity = '1'; chips.style.pointerEvents = '';
    modeEl.classList.remove('locked');
    audio.music(0.14);
    if (isBest && prevBest) audio.sting('success');
    ctx.platform.fail({ reason: 'egg_fell', timeMs: ms, points: pts, surface: surf });
    if (isBest && tSec >= 10) { try { ctx.pulse.complete({ timeMs: ms, timeLabel: fmtTime(tSec) + ' s', text: 'Kept the egg on ' + SURFACES[surf].label.toLowerCase() + ' for ' + fmtTime(tSec) + ' s' }); } catch (e) { } }
    submitAndBoard(attempt, ms, pts, surf);
  }
  function requestFrameClass() { ctx.timeout(() => { if (state === 'results') card.classList.add('show'); }, 30); }
  function hideCard() { card.classList.remove('show'); card.style.display = 'none'; }
  async function submitAndBoard(att, ms, pts, surf) {
    const dims = { surface: surf };
    const boardEl = () => card.querySelector('.ed-board');
    const cached = boardCache[surf];
    if (cached && boardEl()) boardEl().innerHTML = renderBoard(cached, true);
    try { timeTrack.submit('time', { label: fmtTime(ms / 1000) + ' s', dimensions: dims }).catch(() => { }); } catch (e) { }
    try { pointsTrack.submit('score', { label: pts + ' pts', dimensions: dims }).catch(() => { }); } catch (e) { }
    try {
      const board = await timeTrack.leaderboard('time', { scope: 'global', period: 'all_time', dimensions: dims, limit: 3 });
      if (disposed || att !== attempt || state !== 'results') return;
      boardCache[surf] = board;
      if (boardEl()) boardEl().innerHTML = renderBoard(board, false);
    } catch (e) {
      if (disposed || att !== attempt || state !== 'results') return;
      if (boardEl()) boardEl().innerHTML = cached ? renderBoard(cached, true) : '<span class="ed-dim">Board unavailable right now</span>';
    }
  }
  const ESC = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };
  function esc(s) { let o = ''; for (const ch of String(s)) { const e = ESC[ch.charCodeAt(0)]; o += e || ch; } return o; }
  function renderBoard(b, stale) {
    const rows = (b && b.rows || []).slice(0, 3);
    if (!rows.length) return '<span class="ed-dim">No balances on this surface yet</span>';
    const me = b.viewerRank;
    let h = rows.map(r => {
      const name = r.username || r.displayName || r.name || 'player';
      const val = r.displayLabel || fmtTime((r.value || 0) / 1000) + ' s';
      const mine = me && me.rank === r.rank && (me.userId == null || me.userId === r.userId);
      return `<div class="ed-row${mine ? ' me' : ''}"><span>${r.rank}. ${esc(name)}</span><span>${esc(val)}</span></div>`;
    }).join('');
    if (me && me.rank != null) h += `<div class="ed-row me"><span>Your rank</span><span>#${me.rank}${b.totalRanked ? ' of ' + b.totalRanked : ''}</span></div>`;
    if (stale) h += '<div class="ed-dim">Updating…</div>';
    return h;
  }
  function again() {
    if (state !== 'results') return;
    hideCard();
    // a fresh world, and no input carried over from the last run
    newSim(); fx.broken = null; run = null;
    drag.id = null; keys.l = keys.r = false; tilt.reset();
    fx.danger = 0; fx.slide = 0; fx.roll = 0; fx.air = 0;
    modeEl.classList.remove('locked');
    state = 'ready';
    audio.silenceLayers();
    ctx.platform.interact({ type: 'replay' });
  }

  // ---- rendering ----
  const lerp = (a, b, t) => a + (b - a) * t;
  function W2S(x, y) { return [L.px + x * L.k, L.py - y * L.k]; }
  function drawEgg(ex, ey, ea) {
    const spr = eggSprite();
    if (!spr) return;
    const [sx, sy] = W2S(ex, ey);
    blitFrame(g, spr, sx, sy, ea, L.k);
    // light: from the upper left, fixed in the room while the shell turns
    const c = Math.cos(ea), s = Math.sin(ea);
    g.save();
    g.beginPath();
    sim.outline.forEach((p, i) => {
      const x = sx + (p.x * c - p.y * s) * L.k, y = sy - (p.x * s + p.y * c) * L.k;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.clip();
    const R = GEOM.eggA * L.k;
    const sh = g.createRadialGradient(sx - R * 0.4, sy - R * 0.45, R * 0.2, sx - R * 0.1, sy - R * 0.1, R * 1.35);
    sh.addColorStop(0, 'rgba(120,70,30,0)'); sh.addColorStop(0.62, 'rgba(120,70,30,0.05)'); sh.addColorStop(1, 'rgba(110,55,25,0.42)');
    g.fillStyle = sh; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    const hi = g.createRadialGradient(sx - R * 0.38, sy - R * 0.42, 0, sx - R * 0.38, sy - R * 0.42, R * 0.6);
    hi.addColorStop(0, 'rgba(255,253,244,0.75)'); hi.addColorStop(0.5, 'rgba(255,250,236,0.22)'); hi.addColorStop(1, 'rgba(255,250,236,0)');
    g.fillStyle = hi; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    // warm light bounced up from the deck
    const bo = g.createRadialGradient(sx, sy + R * 1.1, 0, sx, sy + R * 1.1, R * 0.9);
    bo.addColorStop(0, 'rgba(214,120,50,0.22)'); bo.addColorStop(1, 'rgba(214,120,50,0)');
    g.fillStyle = bo; g.fillRect(sx - R * 1.5, sy - R * 1.5, R * 3, R * 3);
    g.restore();
  }

  function drawStreaks(dir, amt, time) {
    // air pressing down on the end that the gust will push
    if (amt <= 0.01) return;
    const endX = dir > 0 ? -1.4 : 1.4;
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const ph = (time * 0.9 + i / 6) % 1;
      const x = endX + (i - 2.5) * 0.22 + Math.sin(i * 7.1) * 0.08;
      const y = 2.0 - ph * 1.5;
      const [sx, sy] = W2S(x, y);
      const a = amt * Math.sin(ph * Math.PI) * 0.75;
      g.strokeStyle = `rgba(250,243,226,${a})`;
      for (let j = 0; j < 3; j++) {
        g.lineWidth = (3 - j) * 1.3;
        g.beginPath();
        g.moveTo(sx + j * 2, sy - j * 10);
        g.quadraticCurveTo(sx + 9 * -dir + j * 2, sy + 14 - j * 10, sx + j * 2, sy + 30 - j * 10);
        g.stroke();
      }
    }
    g.restore();
  }

  function drawHUD(time) {
    const a = area(), cx = L.W / 2;
    const top = a.top + 8;
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (state === 'ready' || state === 'loading') {
      g.fillStyle = PAL.burgundy;
      g.font = `${Math.round(Math.min(46, L.W * 0.12))}px 'DM Serif Display', Georgia, serif`;
      g.fillText('Egg Drop', cx, top + 44);
      g.fillStyle = PAL.umber;
      g.font = `italic 300 ${Math.round(Math.min(21, L.W * 0.055))}px 'Cormorant Garamond', Georgia, serif`;
      g.fillText(mode === 'tilt' ? 'Tilt your phone. Keep the egg alive.' : 'Move the weight. Keep the egg alive.', cx, top + 70);
    } else if (state !== 'results') {
      const t = run ? (state === 'play' ? run.t : run.fellAt) : 0;
      g.fillStyle = PAL.burgundy;
      g.font = `${Math.round(Math.min(52, L.W * 0.135))}px 'DM Serif Display', Georgia, serif`;
      g.fillText(fmtTime(t), cx, top + 48);
      g.font = `600 10.5px 'Inter', system-ui, sans-serif`;
      g.fillStyle = rgba(PAL.umber, 0.75);
      const best = save.best[save.surface];
      const pts = run ? Math.floor(t * 10) + run.bonus : 0;
      g.fillText(((best ? 'BEST ' + fmtTime(best / 1000) + '   ·   ' : '') + pts + ' PTS'), cx, top + 66);
    }
    // spirit level: the bubble rises to the high end
    const lw = Math.min(150, L.W * 0.38), lh = 18, ly = top + 82;
    const ang = lerp(prev.ang, cur.ang, renderAlpha);
    g.fillStyle = PAL.brass; roundedRect(g, cx - lw / 2 - 4, ly - 4, lw + 8, lh + 8, (lh + 8) / 2); g.fill();
    g.strokeStyle = PAL.brass2; g.lineWidth = 1.5; g.stroke();
    const tiltFrac = Math.abs(ang) / 0.31;
    g.fillStyle = tiltFrac > 0.62 ? mixHex('#c9c48a', PAL.vermilion, Math.min(1, (tiltFrac - 0.62) / 0.38) * 0.75) : '#c9c48a';
    roundedRect(g, cx - lw / 2, ly, lw, lh, lh / 2); g.fill();
    g.strokeStyle = rgba(PAL.umber, 0.6); g.lineWidth = 1;
    for (const dx of [-11, 11]) { g.beginPath(); g.moveTo(cx + dx, ly + 2); g.lineTo(cx + dx, ly + lh - 2); g.stroke(); }
    const bx = cx + Math.max(-1, Math.min(1, ang / 0.31)) * (lw / 2 - 12);
    g.fillStyle = 'rgba(250,246,226,0.95)';
    g.beginPath(); g.ellipse(bx, ly + lh / 2, 9, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(bx - 3, ly + lh / 2 - 2, 3, 1.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(cx - lw / 2 + 8, ly + 3, lw - 16, 2);

    // phone tilt: a small live gauge under the control switch
    if (mode === 'tilt' && (state === 'ready' || state === 'play')) {
      const gw = 120, gx = cx - gw / 2, gy = L.modeTop - 20;
      g.fillStyle = rgba(PAL.ivory, 0.82); roundedRect(g, gx, gy, gw, 12, 6); g.fill();
      g.strokeStyle = rgba(PAL.brass2, 0.8); g.lineWidth = 1.2; g.stroke();
      g.fillStyle = rgba(PAL.umber, 0.5); g.fillRect(gx + gw / 2 - 0.5, gy + 2, 1, 8);
      g.fillStyle = tilt.receiving() ? PAL.burgundy : rgba(PAL.umber, 0.35);
      g.beginPath(); g.arc(gx + gw / 2 + tilt.value * (gw / 2 - 7), gy + 6, 4.5, 0, Math.PI * 2); g.fill();
    }
    // phase word, briefly
    if (fx.phaseFlash > 0 && state === 'play') {
      g.globalAlpha = Math.min(1, fx.phaseFlash * 1.6);
      g.fillStyle = PAL.burgundy;
      g.font = `italic 300 19px 'Cormorant Garamond', Georgia, serif`;
      g.fillText('Phase ' + (fx.lastPhase + 1) + ' · ' + PHASES[fx.lastPhase].name, cx, ly + lh + 28);
      g.globalAlpha = 1;
    }
    // instruction, then the personal best, under the level
    if (state === 'ready') {
      const best = save.best[save.surface];
      if (best) {
        g.font = `600 10.5px 'Inter', system-ui, sans-serif`; g.fillStyle = rgba(PAL.umber, 0.75);
        g.fillText('BEST ON ' + SURFACES[save.surface].label.toUpperCase() + '  ' + fmtTime(best / 1000) + ' S', cx, ly + lh + 24);
      }
    } else if (state === 'play' && run && run.t < 9 && fx.phaseFlash <= 0) {
      g.globalAlpha = Math.max(0, Math.min(1, (9 - run.t) / 2));
      g.fillStyle = PAL.umber;
      g.font = `italic 300 ${Math.round(Math.min(21, L.W * 0.055))}px 'Cormorant Garamond', Georgia, serif`;
      g.fillText(mode === 'tilt' ? 'Tilt your phone. Keep the egg alive.' : 'Move the weight. Keep the egg alive.', cx, ly + lh + 28);
      g.globalAlpha = 1;
    }
    if (fx.toast) {
      const tt = fx.toast.t, al = tt < 0.2 ? tt / 0.2 : tt > 2.2 ? Math.max(0, 1 - (tt - 2.2) / 0.4) : 1;
      g.globalAlpha = al;
      g.font = `600 12px 'Inter', system-ui, sans-serif`;
      const w = g.measureText(fx.toast.text).width + 28, y = ly + lh + 56;
      g.fillStyle = rgba(PAL.umber, 0.82); roundedRect(g, cx - w / 2, y - 18, w, 28, 14); g.fill();
      g.fillStyle = PAL.ivory; g.fillText(fx.toast.text, cx, y + 1);
      g.globalAlpha = 1;
    }
    g.restore();
  }
  function roundedRect(gg, x, y, w, h, r) { gg.beginPath(); gg.moveTo(x + r, y); gg.arcTo(x + w, y, x + w, y + h, r); gg.arcTo(x + w, y + h, x, y + h, r); gg.arcTo(x, y + h, x, y, r); gg.arcTo(x, y, x + w, y, r); gg.closePath(); }

  // a ghost finger shows the drag on the first visits
  function drawGhost(time) {
    if (state !== 'ready' || mode === 'tilt' || (save.runs || 0) >= 3) return;
    const [cx, cy] = W2S(0, GEOM.railY - 0.75);
    const u = (time * 0.45) % 1, x = cx + Math.sin(u * Math.PI * 2) * L.k * 0.7;
    g.save();
    g.globalAlpha = 0.55 + 0.25 * Math.sin(time * 3);
    g.fillStyle = PAL.ivory; g.strokeStyle = PAL.umber; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, cy, 13, 0, Math.PI * 2); g.fill(); g.stroke();
    g.globalAlpha = 0.35; g.lineWidth = 2; g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(cx - L.k * 0.7, cy); g.lineTo(cx + L.k * 0.7, cy); g.stroke();
    g.restore();
  }

  let renderAlpha = 0, clock = 0;
  function render(alpha) {
    renderAlpha = alpha;
    if (!bg) return;
    // camera: pulls back a little to keep a falling egg in view
    const zx = L.px, zy = L.py;
    g.fillStyle = PAL.butter; g.fillRect(0, 0, L.W, L.H);
    g.save();
    g.translate(zx, zy); g.scale(fx.zoom, fx.zoom); g.translate(-zx - fx.pan, -zy);
    g.drawImage(bg, -L.padX, -L.padY, L.W + L.padX * 2, L.H + L.padY * 2);
    if (sim) drawWorld(alpha);
    g.restore();
    if (!sim) { drawHUD(clock); return; }
    drawGhost(clock);
    drawHUD(clock);
  }
  function drawWorld(alpha) {
    const ang = lerp(prev.ang, cur.ang, alpha), cwx = lerp(prev.cw, cur.cw, alpha);
    const ex = lerp(prev.ex, cur.ex, alpha), ey = lerp(prev.ey, cur.ey, alpha), ea = lerp(prev.ea, cur.ea, alpha);
    const c = Math.cos(ang), s = Math.sin(ang);
    const toWorld = (lx, ly) => [lx * c - ly * s, lx * s + ly * c];

    // broken egg lies on the table, behind the stand's plinth line
    if (fx.broken) {
      const [bx, by] = W2S(fx.broken.x, GEOM.tableY);
      blitFrame(g, sprites.broken, bx, by, 0, L.k);
    }
    // egg falling past the table front reads behind the platform
    const plat = sprites.platforms[save.surface];
    blitFrame(g, plat, L.px, L.py, ang, L.k);

    // danger: pigment blooms on the end the egg is near
    const el2 = (() => { const dx = ex - 0, dy = ey; return { x: dx * c + dy * s, y: -dx * s + dy * c }; })();
    if (state === 'play' && fx.danger > 0.02) {
      const sx = Math.sign(el2.x) * (GEOM.half - 0.35);
      const [wx, wy] = toWorld(sx, GEOM.deckBottom);
      const [dx, dy] = W2S(wx, wy);
      // past the halfway mark of danger the pigment breathes, so it reads as a warning
      const pulse = fx.danger > 0.5 ? 0.8 + 0.2 * Math.sin(clock * 9) : 1;
      g.save(); g.globalAlpha = Math.min(0.9, fx.danger * 0.95) * pulse;
      blitFrame(g, sprites.danger, dx, dy, ang, L.k);
      g.restore();
    }

    // axle cap, with a slot that turns with the platform
    {
      const R = 0.075 * L.k;
      g.save(); g.translate(L.px, L.py);
      g.fillStyle = PAL.brass2; g.beginPath(); g.arc(0, 0, R * 1.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = PAL.brass; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgba(PAL.brassHi, 0.8); g.beginPath(); g.arc(-R * 0.3, -R * 0.3, R * 0.45, 0, Math.PI * 2); g.fill();
      g.rotate(-ang);
      g.strokeStyle = PAL.umber; g.lineWidth = Math.max(1.2, R * 0.22); g.lineCap = 'round';
      g.beginPath(); g.moveTo(-R * 0.6, 0); g.lineTo(R * 0.6, 0); g.stroke();
      g.restore();
    }

    // counterweight carriage
    {
      const [wx, wy] = toWorld(cwx, GEOM.railY);
      const [sx, sy] = W2S(wx, wy);
      const grabbing = drag.id !== null || (mode === 'tilt' && state === 'play');
      // balance notch: where the carriage would exactly cancel the egg's
      // weight about the pivot (m_cw * x = -m_egg * x_egg)
      if (state === 'play' || state === 'ready') {
        const xb = Math.max(-GEOM.travel, Math.min(GEOM.travel, -sim.egg.getMass() * el2.x / sim.cw.getMass()));
        const [bx, by] = W2S(...toWorld(xb, GEOM.railY + 0.05));
        g.save(); g.translate(bx, by); g.rotate(-ang);
        g.fillStyle = rgba(PAL.ivory, 0.75); g.strokeStyle = rgba(PAL.umber, 0.55); g.lineWidth = 1;
        g.beginPath(); g.moveTo(-5, -7); g.lineTo(5, -7); g.lineTo(0, 0); g.closePath(); g.fill(); g.stroke();
        g.restore();
      }
      fx.grabGlow += ((grabbing ? 1 : 0) - fx.grabGlow) * 0.2;
      if (fx.grabGlow > 0.02) {
        g.save(); g.globalAlpha = 0.28 * fx.grabGlow; g.fillStyle = PAL.brassHi;
        g.beginPath(); g.ellipse(sx, sy + 0.16 * L.k, 0.3 * L.k, 0.3 * L.k, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.save(); g.globalAlpha = 0.16; g.fillStyle = PAL.burgundy2;
      g.beginPath(); g.ellipse(sx + 0.05 * L.k, sy + 0.24 * L.k, 0.3 * L.k, 0.36 * L.k, 0, 0, Math.PI * 2); g.fill(); g.restore();
      // lifted a hair while held
      g.save(); g.translate(0, -1.5 * fx.grabGlow);
      blitFrame(g, sprites.cw, sx, sy, ang, L.k);
      g.restore();
    }

    // egg contact shadow on the deck
    if (state !== 'broken' && state !== 'results') {
      const hgt = el2.y - GEOM.deckTop - GEOM.eggB * 0.9;
      if (Math.abs(el2.x) < GEOM.half + 0.2 && hgt < 0.5) {
        const al = Math.max(0, 0.38 * (1 - hgt / 0.5));
        const [wx, wy] = toWorld(Math.max(-GEOM.half, Math.min(GEOM.half, el2.x)), GEOM.deckTop);
        const [sx, sy] = W2S(wx, wy);
        g.save(); g.translate(sx, sy); g.rotate(-ang);
        g.fillStyle = `rgba(59,36,23,${al})`;
        g.beginPath(); g.ellipse(0, 0, GEOM.eggA * L.k * 0.85, 0.035 * L.k, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      drawEgg(ex, ey, ea);
    }

    // gust warning and gust
    if (state === 'play' && dist) drawStreaks(dist.warningDir, Math.max(dist.warning * 0.7, dist.gustActive ? dist.gustAmp : 0), clock);

    // bonus words rising from the deck
    for (let i = fx.floaters.length - 1; i >= 0; i--) {
      const f = fx.floaters[i];
      if (f.t > 1.8) { fx.floaters.splice(i, 1); continue; }
      const [wx, wy] = toWorld(Math.max(-1.5, Math.min(1.5, f.x)), GEOM.deckTop + 0.78 + f.t * 0.3);
      const [sx, sy] = W2S(wx, wy);
      g.save(); g.globalAlpha = f.t < 0.2 ? f.t / 0.2 : Math.max(0, 1 - (f.t - 1.2) / 0.6);
      g.textAlign = 'center'; g.font = `italic 300 21px 'Cormorant Garamond', Georgia, serif`;
      g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = rgba(PAL.burgundy2, 0.85); g.strokeText(f.text, sx, sy);
      g.fillStyle = PAL.ivory; g.fillText(f.text, sx, sy);
      g.restore();
    }
  }

  function frameUpdate(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000);
    clock += dt;
    if (fx.toast) { fx.toast.t += dt; if (fx.toast.t > 2.6) fx.toast = null; }
    if (fx.phaseFlash > 0) fx.phaseFlash = Math.max(0, fx.phaseFlash - dt / 2.4);
    for (const f of fx.floaters) f.t += dt;
    if (!sim) return;
    // camera pull-back while the egg is off the deck
    let zt = 1, pt = 0;
    if (state === 'falling' || state === 'broken' || state === 'results') {
      const ex = fx.broken ? fx.broken.x : sim.egg.getWorldCenter().x;
      if (Math.abs(ex) > L.W / 2 / L.k - 0.5) {
        zt = 0.72;
        const room = L.padX - (L.W / 2) * (1 / zt - 1) - 6;
        pt = Math.max(-room, Math.min(room, ex * L.k * 0.55));
      }
    }
    const kz = Math.min(1, dt * (state === 'falling' ? 6 : 3));
    fx.zoom += (zt - fx.zoom) * kz;
    fx.pan += (pt - fx.pan) * kz;
    // smoothed audio and danger parameters
    const l = sim.eggLocal(), v = sim.eggLocalVel();
    let danger = 0;
    if (state === 'play') {
      const reach = Math.abs(l.x) + Math.max(0, Math.sign(l.x) * v.x) * 0.5;
      danger = Math.max(0, Math.min(1, (reach - 1.15) / (GEOM.half - 1.15)));
    }
    fx.danger += (danger - fx.danger) * Math.min(1, dt * 6);
    // one clear warning per approach to an edge
    if (state === 'play' && run) {
      if (!run.warned && danger > 0.6) { run.warned = true; if (caps.haptics) ctx.platform.haptic('warning'); }
      else if (run.warned && danger < 0.25) run.warned = false;
    }
    // tilt: live panel, and a lost sensor during a run hands control back to touch
    if (tpOpen && (fx.tpTick = (fx.tpTick || 0) + 1) % 3 === 0) refreshTiltPanel();
    if (mode === 'tilt' && state === 'play' && !tilt.receiving()) {
      setMode('touch'); toast('Tilt signal lost: drag the weight');
    }
    const live = state === 'play' || state === 'ready';
    fx.slide += ((live ? Math.abs(sim.rail.getJointSpeed()) : 0) - fx.slide) * Math.min(1, dt * 14);
    const rollV = sim.eggOnDeck && live ? Math.abs(sim.egg.getAngularVelocity() - sim.platform.getAngularVelocity()) * GEOM.eggB : 0;
    fx.roll += (rollV - fx.roll) * Math.min(1, dt * 10);
    fx.air += (((state === 'play' && dist) ? Math.max(dist.warning * 0.5, dist.gustActive ? dist.gustAmp : 0) : 0) - fx.air) * Math.min(1, dt * 5);
    audio.update({ slide: fx.slide, roll: fx.roll, danger: fx.danger, air: fx.air, surface: save.surface });
  }

  // ---- boot ----
  layout();
  try { buildArt(); } catch (e) { ctx.platform.error({ stage: 'art', message: String(e && e.message || e) }); }
  render(0);
  ctx.markVisualReady('backdrop');

  async function loadPhysics() {
    try {
      await ctx.loadScript('planck', '1.5.0');
      if (disposed) return false;
      pl = window.planck;
      if (!pl || !pl.World) throw new Error('planck global missing after load');
      return true;
    } catch (e) {
      ctx.platform.error({ stage: 'dependency', library: 'planck@1.5.0', message: String(e && e.message || e) });
      return false;
    }
  }
  let errBox = null;
  async function boot() {
    const ok = await loadPhysics();
    if (disposed) return;
    if (!ok) {
      if (!errBox) {
        errBox = el('div', 'ed-err', '<div style="margin-bottom:12px">The physics engine could not be fetched.</div><button class="ed-again">Try again</button>');
        let busy = false;
        ctx.input.activate(errBox.querySelector('button'), async () => { if (busy) return; busy = true; errBox.style.opacity = '0.5'; await boot(); busy = false; if (errBox) errBox.style.opacity = '1'; });
      }
      return;
    }
    if (errBox) { errBox.remove(); errBox = null; }
    newSim();
    state = 'ready';
    render(0);
    ctx.platform.ready();
  }

  ctx.onResize(() => { layout(); try { buildArt(); } catch (e) { } if (state !== 'loading') render(renderAlpha); }, { debounceMs: 80 });

  ctx.game.loop({
    fixedHz: 120, maxSubsteps: 12, maxDeltaMs: 100,
    fixedUpdate: () => { if (!disposed) fixedUpdate(); },
    update: (dtMs) => { if (!disposed) frameUpdate(dtMs); },
    render: (alpha) => { if (!disposed) render(alpha); }
  });

  if (typeof window !== 'undefined' && window.__EGG_DEV) {
    window.__egg = { tilt, tiltCurve, lateralFromOrientation, get mode() { return mode; }, get sim() { return sim; }, get state() { return state; }, get run() { return run; }, get dist() { return dist; }, L, again, beginRun, selectSurface, fx, save, get drag() { return drag; } };
  }
  await boot();
}

window.plethoraBit = {
  meta: {
    title: 'Egg Drop',
    runtime: 'plethora-bit@2',
    tags: ['arcade', 'physics', 'balance'],
    permissions: ['haptics', 'audio', 'backgroundMusic', 'storage', 'motion']
  },
  async init(ctx) {
    return eggDropInit(ctx);
  }
};
