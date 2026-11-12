// HUD, touch controls and menus (DOM over the WebGL canvas).
let hudRoot = null, touchRoot = null, modalRoot = null;
const hud = { dirty: true, hit: 0, hitT: 0, dmgT: 0, dmgAngle: 0, xhairKick: 0, bannerT: 0, compassT: 0, compassAng: 0, compassDist: 0 };
const els = {};
const UI = { W: 0, H: 0 };
const input = { mx: 0, mz: 0, lookDX: 0, lookDY: 0, fireIds: new Set(), keys: {}, stick: null, ptr: new Map() };

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
function setT(e, v) { if (e._v !== v) { e._v = v; e.textContent = v; } }
function setS(e, k, v) { if (e['_' + k] !== v) { e['_' + k] = v; e.style[k] = v; } }

const CSS = `
.df{position:absolute;inset:0;font-family:DFI,Inter,'Helvetica Neue',Arial,sans-serif;color:#ece6d6;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.df *{box-sizing:border-box}
.df-num{font-family:DFB,'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:.04em}
.df-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(0,0,0,.6) 100%);pointer-events:none}
.df-dmg{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0) 40%,rgba(160,0,0,.75) 100%);opacity:0;pointer-events:none}
.df-low{position:absolute;inset:0;box-shadow:inset 0 0 90px 30px rgba(150,0,0,.55);opacity:0;pointer-events:none}
.df-x{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.df-x i{position:absolute;background:rgba(240,240,230,.9);box-shadow:0 0 2px rgba(0,0,0,.9)}
.df-x .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:2px}
.df-hm{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;pointer-events:none}
.df-hm:before,.df-hm:after{content:'';position:absolute;left:12px;top:0;width:2px;height:26px;background:#fff;transform:rotate(45deg);clip-path:polygon(0 0,100% 0,100% 35%,0 35%,0 65%,100% 65%,100% 100%,0 100%)}
.df-hm:after{transform:rotate(-45deg)}
.df-hm.head:before,.df-hm.head:after{background:#ff4a3a}
.df-tl{position:absolute;pointer-events:none}
.df-hp{display:flex;align-items:center;gap:8px}
.df-hpbar{width:132px;height:10px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);border-radius:2px;overflow:hidden}
.df-hpbar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#c22,#f55);transform-origin:left center}
.df-hpn{font-size:22px;line-height:1;text-shadow:0 1px 2px #000}
.df-floor{font-size:15px;margin-top:6px;color:#d9c64a;text-shadow:0 1px 2px #000;letter-spacing:.12em}
.df-obj{font-size:12px;font-weight:700;margin-top:3px;text-shadow:0 1px 2px #000;letter-spacing:.06em;opacity:.92}
.df-obj.open{color:#6dff95}
.df-threat{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:9px;font-weight:700;letter-spacing:.14em;opacity:.85;text-shadow:0 1px 2px #000}
.df-threat div{width:84px;height:5px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);overflow:hidden}
.df-threat i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#d9c64a,#ff6a2a,#ff2a1a);transform-origin:left center;transform:scaleX(0)}
.df-tr{position:absolute;pointer-events:none;text-align:right}
.df-score{font-size:26px;line-height:1;text-shadow:0 1px 3px #000}
.df-kills{font-size:11px;font-weight:700;opacity:.75;letter-spacing:.08em}
.df-comp{position:absolute;width:64px;margin-left:-32px;text-align:center;pointer-events:none}
.df-comp svg{width:30px;height:30px;filter:drop-shadow(0 1px 2px #000)}
.df-comp b{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-shadow:0 1px 2px #000}
.df-boss{position:absolute;left:50%;width:min(70vw,320px);transform:translateX(-50%);text-align:center;pointer-events:none;display:none}
.df-boss b{font-size:16px;color:#ff5a48;letter-spacing:.14em;text-shadow:0 1px 3px #000}
.df-boss div{height:8px;background:rgba(0,0,0,.6);border:1px solid rgba(255,90,72,.6);margin-top:3px}
.df-boss i{display:block;height:100%;background:linear-gradient(90deg,#801010,#ff3a2a);transform-origin:left center}
.df-banner{position:absolute;left:0;right:0;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}
.df-banner b{display:block;font-size:44px;line-height:1;text-shadow:0 2px 10px #000,0 0 30px rgba(0,0,0,.8)}
.df-banner span{display:block;font-size:13px;font-weight:700;letter-spacing:.16em;margin-top:4px;text-shadow:0 1px 3px #000}
.df-note{position:absolute;left:50%;transform:translateX(-50%);font-size:14px;font-weight:700;letter-spacing:.1em;pointer-events:none;text-shadow:0 1px 3px #000;transition:transform 1.1s ease-out,opacity 1.1s ease-in}
.df-btn{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:none;border:2px solid rgba(255,255,255,.35);background:rgba(20,20,18,.38);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.df-btn svg{width:46%;height:46%}
.df-btn.fire{border-color:rgba(255,110,80,.85);background:radial-gradient(circle,rgba(200,40,20,.55),rgba(90,10,5,.45))}
.df-btn.fire.on{background:radial-gradient(circle,rgba(255,90,50,.85),rgba(150,20,10,.6));transform:scale(.94)}
.df-btn small{position:absolute;bottom:-17px;font-size:9px;font-weight:700;letter-spacing:.12em;opacity:.75;text-shadow:0 1px 2px #000}
.df-ammo{position:absolute;text-align:right;pointer-events:none}
.df-ammo b{font-size:34px;line-height:1;text-shadow:0 1px 3px #000}
.df-ammo span{font-size:18px;opacity:.7;margin-left:3px}
.df-ammo em{display:block;font-style:normal;font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.8;text-shadow:0 1px 2px #000}
.df-ammo.low b{color:#ff6b55}
.df-ammo .rl{color:#ffd25a}
.df-stick{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:2px solid rgba(255,255,255,.22);background:radial-gradient(circle,rgba(255,255,255,.05),rgba(255,255,255,.1));pointer-events:none;opacity:.55}
.df-stick.on{opacity:1}
.df-stick i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(235,230,215,.45);border:2px solid rgba(255,255,255,.6)}
.df-ddir{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0}
.df-ddir i{position:absolute;left:-36px;top:-120px;width:72px;height:26px;border-radius:50% 50% 0 0;border-top:5px solid rgba(255,40,30,.9);filter:blur(1px)}
.df-modal{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:auto;touch-action:manipulation}
.df-modal.show{display:flex}
.df-title{background:linear-gradient(180deg,rgba(5,6,5,.35) 0%,rgba(5,6,5,.1) 40%,rgba(5,6,5,.75) 100%)}
.df-logo{font-family:DFB,'Bebas Neue',Impact,sans-serif;line-height:.86;font-size:min(23vw,120px);color:#e8e0cc;text-shadow:0 4px 0 #3a0a06,0 0 40px rgba(0,0,0,.9)}
.df-logo span{display:block}
.df-logo span+span{color:#c8281c;text-shadow:0 4px 0 #1a0402,0 0 40px rgba(120,0,0,.6)}
.df-tag{font-size:13px;font-weight:700;letter-spacing:.2em;opacity:.8;margin:10px 0 22px;text-shadow:0 1px 3px #000}
.df-b{appearance:none;-webkit-appearance:none;border:2px solid rgba(255,255,255,.5);background:rgba(15,15,13,.6);color:#f2ecdc;font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:.12em;padding:10px 0 7px;width:min(74vw,290px);margin:6px 0;border-radius:4px;cursor:pointer;pointer-events:auto}
.df-b.primary{background:linear-gradient(180deg,#c8281c,#82140c);border-color:#ff6a50}
.df-b:disabled{opacity:.45}
.df-b.small{font-size:20px;width:min(36vw,140px);padding:8px 0 5px}
.df-best{font-size:12px;font-weight:700;letter-spacing:.14em;opacity:.8;margin-top:12px;min-height:16px}
.df-help{display:flex;gap:14px;justify-content:center;margin-top:18px;font-size:11px;font-weight:700;letter-spacing:.06em;opacity:.85}
.df-help div{display:flex;flex-direction:column;align-items:center;gap:4px;width:84px}
.df-help b{font-size:20px;line-height:1}
.df-snd{position:absolute;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(15,15,13,.6);color:#fff;font-size:18px;pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center}
.df-dim{background:rgba(6,4,4,.78)}
.df-died{font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:min(20vw,86px);color:#d42a1c;line-height:.9;text-shadow:0 0 30px rgba(150,0,0,.6)}
.df-sub{font-size:13px;font-weight:700;letter-spacing:.16em;opacity:.85;margin-top:6px}
.df-big{font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:58px;line-height:1;margin-top:10px}
.df-pb{font-size:12px;font-weight:700;letter-spacing:.2em;color:#ffd25a;min-height:16px}
.df-board{width:min(80vw,300px);margin:12px 0 10px;font-size:13px;text-align:left;min-height:84px}
.df-board .row{display:flex;justify-content:space-between;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08)}
.df-board .me{background:rgba(200,40,28,.25)}
.df-board .st{opacity:.6;text-align:center;font-size:12px;padding-top:8px}
.df-row{display:flex;gap:10px;justify-content:center}
.df-sens{display:flex;align-items:center;gap:12px;margin:8px 0;font-size:13px;font-weight:700;letter-spacing:.12em}
.df-sens button{width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.5);background:rgba(15,15,13,.6);color:#fff;font-size:22px;pointer-events:auto;cursor:pointer}
.df-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.df-load{font-size:12px;font-weight:700;letter-spacing:.14em;opacity:.7;margin-top:6px;min-height:15px}
`;

const ICON = {
  fire: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 2l7 14-7-4-7 4z" fill="#6dff95" stroke="#0a2a12" stroke-width="1"/></svg>',
};

function buildHUD() {
  hudRoot = ctx.createRoot({ layer: 'overlay', order: 1, input: 'passthrough' });
  hudRoot.classList.add('df');
  el('style', null, hudRoot, CSS);
  els.vig = el('div', 'df-vig', hudRoot);
  els.dmg = el('div', 'df-dmg', hudRoot);
  els.low = el('div', 'df-low', hudRoot);
  els.game = el('div', null, hudRoot); els.game.style.cssText = 'position:absolute;inset:0;display:none';
  const G = els.game;
  els.x = el('div', 'df-x', G);
  els.xl = [0, 1, 2, 3].map(() => el('i', null, els.x));
  el('i', 'dot', els.x);
  els.hm = el('div', 'df-hm', G);
  els.ddir = el('div', 'df-ddir', G, '<i></i>');
  els.tl = el('div', 'df-tl', G);
  const hp = el('div', 'df-hp', els.tl);
  els.hpBar = el('i', null, el('div', 'df-hpbar', hp));
  els.hpN = el('div', 'df-hpn df-num', hp);
  els.floor = el('div', 'df-floor df-num', els.tl);
  els.obj = el('div', 'df-obj', els.tl);
  els.threat = el('div', 'df-threat', els.tl, '<span>THREAT</span><div><i></i></div>');
  els.threatBar = els.threat.querySelector('i');
  els.tr = el('div', 'df-tr', G);
  els.score = el('div', 'df-score df-num', els.tr);
  els.kills = el('div', 'df-kills', els.tr);
  els.comp = el('div', 'df-comp', G, ICON.arrow + '<b></b>');
  els.compArrow = els.comp.querySelector('svg');
  els.compTxt = els.comp.querySelector('b');
  els.boss = el('div', 'df-boss', G, '<b></b><div><i></i></div>');
  els.bossName = els.boss.querySelector('b'); els.bossBar = els.boss.querySelector('i');
  els.banner = el('div', 'df-banner', G, '<b class="df-num"></b><span></span>');
  els.bannerT = els.banner.querySelector('b'); els.bannerS = els.banner.querySelector('span');
  els.notes = el('div', null, G);
  els.stick = el('div', 'df-stick', G, '<i></i>');
  els.knob = els.stick.querySelector('i');
  els.fire = el('div', 'df-btn fire', G, ICON.fire);
  els.reload = el('div', 'df-btn', G, ICON.reload + '<small>RELOAD</small>');
  els.swap = el('div', 'df-btn', G, ICON.swap + '<small>SWAP</small>');
  els.pause = el('div', 'df-btn', G, ICON.pause);
  els.ammo = el('div', 'df-ammo', G, '<b class="df-num"></b><span class="df-num"></span><em></em>');
  els.ammoMag = els.ammo.querySelector('b'); els.ammoRes = els.ammo.querySelector('span'); els.ammoName = els.ammo.querySelector('em');

  touchRoot = ctx.createRoot({ layer: 'content', order: 5, input: 'auto', touchAction: 'none' });
  touchRoot.style.touchAction = 'none';
  modalRoot = ctx.createRoot({ layer: 'modal', order: 1, input: 'passthrough' });
  modalRoot.classList.add('df');
  buildScreens();
  wireInput();
  ctx.onResize(layoutHUD, { immediate: true });
}

function layoutHUD() {
  UI.W = ctx.width; UI.H = ctx.height;
  const a = area();
  UI.a = a;
  const W = UI.W, H = UI.H;
  const bottom = H - a.bottom;
  const big = Math.min(46, Math.max(38, W * 0.105));
  UI.fire = { x: W - a.right - 22 - big, y: bottom - 26 - big, r: big };
  UI.reload = { x: UI.fire.x - big - 46, y: UI.fire.y + big * 0.35, r: 25 };
  UI.swap = { x: UI.fire.x - big * 0.25, y: UI.fire.y - big - 52, r: 25 };
  UI.pause = { x: W - a.right - 30, y: a.top + 28, r: 21 };
  UI.stickHome = { x: a.left + 30 + 59, y: bottom - 30 - 59 };
  UI.stickR = 52;
  const place = (e, c) => { e.style.left = (c.x - c.r) + 'px'; e.style.top = (c.y - c.r) + 'px'; e.style.width = e.style.height = (c.r * 2) + 'px'; };
  place(els.fire, UI.fire); place(els.reload, UI.reload); place(els.swap, UI.swap); place(els.pause, UI.pause);
  els.tl.style.left = (a.left + 14) + 'px'; els.tl.style.top = (a.top + 10) + 'px';
  els.tr.style.right = (a.right + 62) + 'px'; els.tr.style.top = (a.top + 12) + 'px';
  els.comp.style.left = (W / 2) + 'px'; els.comp.style.top = (a.top + 8) + 'px';
  els.boss.style.top = (a.top + 104) + 'px';
  els.banner.style.top = (H * 0.27) + 'px';
  els.ammo.style.right = (a.right + 16) + 'px';
  els.ammo.style.top = (UI.swap.y - UI.swap.r - 58) + 'px';
  if (!input.stick) { els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px'; }
  for (const s of [els.title, els.pauseS, els.dead]) if (s) s.style.padding = `${a.top + 10}px ${a.right + 16}px ${a.bottom + 10}px ${a.left + 16}px`;
  if (els.snd) { els.snd.style.right = (a.right + 14) + 'px'; els.snd.style.top = (a.top + 10) + 'px'; }
  if (renderer) resizeRenderer();
}

function showBanner(title, sub, color) {
  setT(els.bannerT, title); setT(els.bannerS, sub || '');
  els.bannerT.style.color = color || '#ece6d6';
  els.banner.style.opacity = 1;
  hud.bannerT = 2.6;
}
function floatNote(text, color) {
  const n = el('div', 'df-note', els.notes, text);
  n.style.color = color; n.style.top = (UI.H * 0.6) + 'px';
  ctx.timeout(() => { n.style.transform = 'translate(-50%,-40px)'; n.style.opacity = 0; }, 30);
  ctx.timeout(() => n.remove(), 1200);
}

// ---------- input ----------
function localXY(e) { const r = touchRoot.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
const near = (x, y, c, pad) => Math.hypot(x - c.x, y - c.y) < c.r + pad;
function roleAt(x, y) {
  if (near(x, y, UI.pause, 12)) return 'pause';
  if (near(x, y, UI.fire, 16)) return 'fire';
  if (near(x, y, UI.reload, 12)) return 'reload';
  if (near(x, y, UI.swap, 12)) return 'swap';
  if (x < UI.W * 0.45 && y > UI.a.top + 70) return 'move';
  return 'look';
}
function wireInput() {
  ctx.listen(touchRoot, 'pointerdown', (e) => {
    if (mode !== 'play') return;
    e.preventDefault();
    try { touchRoot.setPointerCapture(e.pointerId); } catch (err) { }
    const [x, y] = localXY(e);
    const role = roleAt(x, y);
    input.ptr.set(e.pointerId, { role, x, y });
    if (!RUN.interacted) { RUN.interacted = true; try { ctx.platform.interact({ kind: 'first_touch' }); } catch (err) { } }
    if (role === 'move') {
      const a = UI.a;
      const ox = clamp(x, a.left + 62, UI.W * 0.45), oy = clamp(y, a.top + 120, UI.H - a.bottom - 30);
      input.stick = { id: e.pointerId, ox, oy };
      els.stick.style.left = ox + 'px'; els.stick.style.top = oy + 'px';
      els.stick.classList.add('on');
      stickMove(x, y);
    } else if (role === 'fire') { input.fireIds.add(e.pointerId); }
    else if (role === 'reload') startReload();
    else if (role === 'swap') cycleWeapon();
    else if (role === 'pause') pauseGame();
  });
  ctx.listen(touchRoot, 'pointermove', (e) => {
    const p = input.ptr.get(e.pointerId); if (!p) return;
    const [x, y] = localXY(e);
    if (p.role === 'move' && input.stick && input.stick.id === e.pointerId) stickMove(x, y);
    else if (p.role === 'look' || p.role === 'fire') { input.lookDX += x - p.x; input.lookDY += y - p.y; }
    p.x = x; p.y = y;
  });
  const up = (e) => {
    const p = input.ptr.get(e.pointerId); if (!p) return;
    input.ptr.delete(e.pointerId);
    input.fireIds.delete(e.pointerId);
    if (input.stick && input.stick.id === e.pointerId) {
      input.stick = null; input.mx = input.mz = 0;
      els.stick.classList.remove('on');
      els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px';
      els.knob.style.transform = '';
    }
  };
  ctx.listen(touchRoot, 'pointerup', up);
  ctx.listen(touchRoot, 'pointercancel', up);
  ctx.listen(touchRoot, 'lostpointercapture', up);
  ctx.listen(touchRoot, 'contextmenu', (e) => e.preventDefault());
  // Keyboard for desktop play.
  ctx.listen(window, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    input.keys[k] = true;
    if (mode === 'play') {
      if (k === 'r') startReload();
      if (k === 'q' || k === 'e' || k === 'tab') { cycleWeapon(); e.preventDefault(); }
      if (k === 'escape' || k === 'p') pauseGame();
      if (k === ' ') e.preventDefault();
    } else if (mode === 'paused' && (k === 'escape' || k === 'p')) resumeGame();
  });
  ctx.listen(window, 'keyup', (e) => { input.keys[e.key.toLowerCase()] = false; });
  ctx.listen(window, 'blur', () => { input.keys = {}; input.fireIds.clear(); });
}
function stickMove(x, y) {
  const s = input.stick; if (!s) return;
  let dx = x - s.ox, dy = y - s.oy;
  const d = Math.hypot(dx, dy), R = UI.stickR;
  if (d > R) { dx *= R / d; dy *= R / d; }
  input.mx = dx / R; input.mz = -dy / R;
  els.knob.style.transform = `translate(${dx}px,${dy}px)`;
}
function fireHeld() { return input.fireIds.size > 0 || !!input.keys[' '] || !!input.keys['f']; }
function releaseAllInput() {
  input.ptr.clear(); input.fireIds.clear(); input.stick = null; input.mx = input.mz = 0; input.lookDX = input.lookDY = 0;
  if (els.stick) { els.stick.classList.remove('on'); els.knob.style.transform = ''; els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px'; }
}

// ---------- per-frame HUD ----------
function updateHUD(dt) {
  const playing = mode === 'play' || mode === 'paused';
  setS(els.game, 'display', playing || mode === 'transition' ? 'block' : 'none');
  const hpf = P.hp / P.maxHp;
  setS(els.low, 'opacity', playing && hpf < 0.3 ? String(((0.3 - hpf) / 0.3 * 0.6 + 0.35 * Math.abs(Math.sin(performance.now() / 300))).toFixed(2)) : '0');
  hud.dmgT = Math.max(0, hud.dmgT - dt * 1.6);
  setS(els.dmg, 'opacity', (hud.dmgT * 0.8).toFixed(2));
  if (!playing && mode !== 'transition') return;
  // Crosshair spread.
  hud.xhairKick = Math.max(0, hud.xhairKick - dt * 4);
  const w = curW();
  if (w) {
    const gap = 6 + (w.spread || 0.01) * 160 + hud.xhairKick * 10 + (Math.hypot(P.vx, P.vz) > 0.5 ? 4 : 0);
    const L4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const key = gap.toFixed(0);
    if (els.x._g !== key) {
      els.x._g = key;
      els.xl.forEach((l, i) => {
        const [sx, sy] = L4[i], len = 8;
        l.style.width = (sx ? len : 2) + 'px'; l.style.height = (sy ? len : 2) + 'px';
        l.style.left = (sx ? (sx > 0 ? gap : -gap - len) : -1) + 'px';
        l.style.top = (sy ? (sy > 0 ? gap : -gap - len) : -1) + 'px';
      });
    }
  }
  hud.hitT = Math.max(0, hud.hitT - dt);
  setS(els.hm, 'opacity', hud.hitT > 0 ? '1' : '0');
  if (hud.hitT > 0) els.hm.classList.toggle('head', hud.hit === 2);
  setS(els.ddir, 'opacity', (hud.dmgT).toFixed(2));
  if (hud.dmgT > 0) setS(els.ddir, 'transform', `rotate(${relAngle(hud.dmgAngle).toFixed(3)}rad)`);
  setS(els.threat, 'display', L && !L.boss ? 'flex' : 'none');
  setS(els.threatBar, 'transform', `scaleX(${clamp(RUN.heat || 0, 0, 1).toFixed(2)})`);
  setS(els.fire, 'transform', fireHeld() ? 'scale(0.94)' : '');
  els.fire.classList.toggle('on', fireHeld());
  hud.bannerT -= dt;
  if (hud.bannerT <= 0) setS(els.banner, 'opacity', '0');
  // Compass toward the exit.
  hud.compassT -= dt;
  if (hud.compassT <= 0 && L && exitFlow) {
    hud.compassT = 0.15;
    const i = cellOf(P.x), j = cellOf(P.z);
    let tx = (L.exit.ex + 0.5) * CELL, tz = (L.exit.ey + 0.5) * CELL;
    const k = j * L.N + i;
    if (L.g[k] !== 3 && !(L.g[k] === 1 && exitFlow[k] <= 1)) {
      let x = P.x, z = P.z;
      for (let s = 0; s < 2; s++) { flowStep(exitFlow, x, z, _ws); x = _ws.x; z = _ws.z; }
      tx = x; tz = z;
    }
    hud.compassAng = Math.atan2(tx - P.x, tz - P.z);
    hud.compassDist = Math.round(Math.max(0, (exitFlow[k] >= 0 ? exitFlow[k] : (L.g[k] === 2 ? L.dStart[L.exit.ry * L.N + L.exit.rx] : 0)) * CELL));
  }
  const showComp = mode === 'play' && (exitOpen || (L && L.boss && RUN.bossSpawned === false));
  setS(els.comp, 'display', showComp ? 'block' : 'none');
  if (showComp) {
    setS(els.compArrow, 'transform', `rotate(${relAngle(hud.compassAng).toFixed(2)}rad)`);
    setT(els.compTxt, exitOpen ? (hud.compassDist > 0 ? hud.compassDist + 'm' : 'EXIT') : 'ARENA');
  }
  if (!hud.dirty) return;
  hud.dirty = false;
  els.hpBar.style.transform = `scaleX(${clamp(hpf, 0, 1)})`;
  setT(els.hpN, String(Math.ceil(P.hp)));
  setT(els.floor, 'FLOOR ' + RUN.floor + (RUN.mk > 0 ? ' · MK ' + (RUN.mk + 1) : ''));
  if (L && L.boss) setT(els.obj, exitOpen ? 'ELEVATOR OPEN' : (RUN.bossSpawned ? 'KILL ' + (boss ? boss.def.name : 'THE BOSS') : 'FIND THE ARENA'));
  else setT(els.obj, exitOpen ? 'ELEVATOR OPEN' : `KILLS ${Math.min(RUN.floorKills, RUN.D.quota)} / ${RUN.D.quota} TO OPEN ELEVATOR`);
  els.obj.classList.toggle('open', exitOpen);
  setT(els.score, fmt(RUN.score));
  setT(els.kills, RUN.kills + (RUN.kills === 1 ? ' KILL' : ' KILLS'));
  if (boss && !boss.dead) { setS(els.boss, 'display', 'block'); setT(els.bossName, boss.def.name); els.bossBar.style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`; }
  else setS(els.boss, 'display', 'none');
  if (w) {
    const a = ammoOf(w.id);
    setT(els.ammoMag, W.reloading ? '··' : String(a.mag));
    setT(els.ammoRes, '/ ' + a.res);
    setT(els.ammoName, W.reloading ? 'RELOADING' : w.name);
    els.ammo.classList.toggle('low', a.mag <= Math.ceil(magSize(w) * 0.25));
    setS(els.swap, 'display', RUN.owned.length > 1 ? 'flex' : 'none');
  }
}
// Angle of a world direction relative to the view (0 = ahead, + = right).
function relAngle(worldAng) {
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const dx = Math.sin(worldAng), dz = Math.cos(worldAng);
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

// ---------- screens ----------
function btn(parent, label, cls, fn) {
  const b = el('button', 'df-b ' + (cls || ''), parent, label);
  b.type = 'button';
  ctx.listen(b, 'click', (e) => { e.stopPropagation(); fn(); });
  return b;
}
function buildScreens() {
  els.fade = el('div', 'df-fade', modalRoot);
  // Title
  const T = els.title = el('div', 'df-modal df-title', modalRoot);
  el('div', 'df-logo', T, '<span>DEAD</span><span>FLOORS</span>');
  el('div', 'df-tag', T, 'HOW DEEP CAN YOU GO?');
  els.startBtn = btn(T, 'LOADING…', 'primary', () => startRun(false));
  els.startBtn.disabled = true;
  els.contBtn = btn(T, 'CONTINUE', '', () => startRun(true));
  els.contBtn.style.display = 'none';
  els.load = el('div', 'df-load', T);
  els.best = el('div', 'df-best', T);
  el('div', 'df-help', T, '<div><b>◎</b>LEFT THUMB<br>MOVES</div><div><b>↔</b>DRAG RIGHT<br>TO AIM</div><div><b>●</b>HOLD FIRE<br>TO SHOOT</div>');
  els.snd = el('button', 'df-snd', T, settings.sound ? '🔊' : '🔇');
  ctx.listen(els.snd, 'click', () => toggleSound());
  // Pause
  const Pz = els.pauseS = el('div', 'df-modal df-dim', modalRoot);
  el('div', 'df-died', Pz, 'PAUSED').style.color = '#ece6d6';
  els.pauseInfo = el('div', 'df-sub', Pz, '');
  el('div', '', Pz).style.height = '18px';
  btn(Pz, 'RESUME', 'primary', () => resumeGame());
  els.sndBtn = btn(Pz, 'SOUND: ON', '', () => toggleSound());
  const sens = el('div', 'df-sens', Pz);
  const minus = el('button', '', sens, '−'); minus.type = 'button';
  els.sensTxt = el('span', '', sens, '');
  const plus = el('button', '', sens, '+'); plus.type = 'button';
  ctx.listen(minus, 'click', () => setSens(-0.1));
  ctx.listen(plus, 'click', () => setSens(0.1));
  btn(Pz, 'QUIT TO MENU', '', () => quitToMenu());
  // Death
  const D = els.dead = el('div', 'df-modal df-dim', modalRoot);
  el('div', 'df-died', D, 'YOU DIED');
  els.deadSub = el('div', 'df-sub', D, '');
  els.deadScore = el('div', 'df-big', D, '0');
  els.deadPB = el('div', 'df-pb', D, '');
  els.board = el('div', 'df-board', D, '');
  const row = el('div', 'df-row', D);
  btn(row, 'AGAIN', 'primary small', () => startRun(false));
  btn(row, 'MENU', 'small', () => showScreen('title'));
  refreshSensText();
}
function showScreen(name) {
  for (const [k, e] of [['title', els.title], ['pause', els.pauseS], ['dead', els.dead]]) e.classList.toggle('show', k === name);
  modalRoot.style.pointerEvents = name ? 'auto' : 'none';
  if (name === 'title') { mode = 'title'; RUN.active = false; setupTitleScene(); renderTitle(); musicSet('title'); }
}
function renderTitle() {
  if (!els.title) return;
  if (threeReady) { els.startBtn.disabled = false; setT(els.startBtn, saved ? 'NEW RUN' : 'START'); }
  if (saved) { els.contBtn.style.display = ''; setT(els.contBtn, 'CONTINUE · FLOOR ' + saved.floor); }
  else els.contBtn.style.display = 'none';
  setT(els.best, bestScore != null ? 'BEST ' + fmt(bestScore) : '');
}
function toggleSound() {
  settings.sound = !settings.sound;
  sset('df_sound', settings.sound);
  els.snd.textContent = settings.sound ? '🔊' : '🔇';
  setT(els.sndBtn, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
  if (settings.sound) { unlockAudio(); buildSounds(); musicSet(mode === 'title' ? 'title' : (boss && !boss.dead ? 'boss' : 'explore')); }
  else musicSet(null);
}
function setSens(d) { settings.sens = clamp(Math.round((settings.sens + d) * 10) / 10, 0.4, 2.5); sset('df_sens', settings.sens); refreshSensText(); }
function refreshSensText() { if (els.sensTxt) setT(els.sensTxt, 'AIM SPEED ' + settings.sens.toFixed(1)); }
