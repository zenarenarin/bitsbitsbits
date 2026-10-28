// =====================================================================
// HUD: a restrained DOM layer. Inter, sentence case, very few words.
// Gameplay shows only: a pause control, a brief encounter label, one
// contextual hint line, the movement stick, the gaze reticle, and amber
// edge marks for eyes off screen that are acquiring you.
// =====================================================================

const HUD_CSS = `
.tw{position:absolute;inset:0;pointer-events:none;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#efe6d2;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;
  --st:var(--plethora-content-safe-top,0px);--sb:var(--plethora-content-safe-bottom,120px);--sl:var(--plethora-content-safe-left,0px);--sr:var(--plethora-content-safe-right,0px);--ochre:#e3a94f;--bone:#efe6d2;--ink:#0f0e0b}
.tw *{box-sizing:border-box}
.tw-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 52%,rgba(8,7,5,.55) 100%);}
.tw-ink{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(10,8,5,0) 0%,rgba(10,8,5,0) 35%,rgba(10,8,5,.92) 75%);transition:none}
.tw-fade{position:absolute;inset:0;background:#0d0c09;opacity:1;transition:opacity .5s ease}
.tw-top{position:absolute;left:calc(var(--sl) + 16px);right:calc(var(--sr) + 16px);top:calc(var(--st) + 14px);display:flex;justify-content:space-between;align-items:flex-start}
.tw-label{font-size:13px;font-weight:600;letter-spacing:.01em;opacity:0;transition:opacity .8s ease;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.tw-label small{display:block;font-weight:400;opacity:.62;font-size:12px;margin-top:2px}
.tw-label.on{opacity:1}
.tw-btn{pointer-events:auto;width:44px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:rgba(15,14,11,.38);border:1px solid rgba(239,230,210,.22);color:#efe6d2;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tw-btn:active{background:rgba(15,14,11,.6)}
.tw-btn svg{width:18px;height:18px}
.tw-prog{display:flex;gap:3px;margin-top:10px;opacity:.0;transition:opacity .8s}
.tw-prog.on{opacity:.75}
.tw-prog i{width:6px;height:2px;background:rgba(239,230,210,.25);display:block}
.tw-prog i.d{background:rgba(239,230,210,.75)}
.tw-prog i.c{background:var(--ochre)}
.tw-hint{position:absolute;left:calc(var(--sl) + 16px);right:calc(var(--sr) + 72px);top:calc(var(--st) + 14px);transform:translate(0,-6px);text-align:left;font-size:14px;font-weight:600;line-height:1.35;padding:8px 12px;border-radius:10px;background:rgba(15,14,11,.62);opacity:0;transition:opacity .45s ease,transform .45s ease;text-shadow:0 1px 4px rgba(0,0,0,.4)}
.tw-hint.on{opacity:1;transform:translate(0,0)}
.tw.hinting .tw-label,.tw.hinting .tw-prog{opacity:0 !important}
.tw-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:56px;border:1.5px solid rgba(239,230,210,.35);background:rgba(15,14,11,.18);opacity:0;transition:opacity .2s}
.tw-stick b{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:23px;background:rgba(239,230,210,.82);box-shadow:0 2px 10px rgba(0,0,0,.4)}
.tw-stick.on{opacity:1}
.tw-stick.ghost{opacity:.85;animation:twghost 2.4s ease-in-out infinite}
.tw-stick.ghost b{animation:twknob 2.4s ease-in-out infinite}
@keyframes twknob{0%,15%{transform:translate(0,0)}45%,60%{transform:translate(0,-30px)}90%,100%{transform:translate(0,0)}}
@keyframes twghost{0%,100%{opacity:.35}50%{opacity:.9}}
.tw-ret{position:absolute;width:0;height:0;opacity:0;transition:opacity .15s}
.tw-ret svg{position:absolute;left:-40px;top:-40px;width:80px;height:80px;overflow:visible}
.tw-ret.on{opacity:1}
.tw-focus{position:absolute;width:0;height:0;opacity:0;transition:opacity .3s}
.tw-focus.on{opacity:1}
.tw-focus svg{position:absolute;left:-46px;top:-46px;width:92px;height:92px;overflow:visible;animation:twpulse 1.4s ease-in-out infinite}
@keyframes twpulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:.45}}
.tw-edge{position:absolute;width:0;height:0}
.tw-edge svg{position:absolute;left:-14px;top:-14px;width:28px;height:28px;overflow:visible}
.tw-panel{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;padding:calc(var(--st) + 24px) calc(var(--sr) + 24px) calc(var(--sb) + 18px) calc(var(--sl) + 24px);opacity:0;pointer-events:none;transition:opacity .5s ease}
.tw-panel.on{opacity:1;pointer-events:auto}
.tw-panel:not(.on), .tw-panel:not(.on) *{pointer-events:none !important}
.tw-panel.dim{background:linear-gradient(rgba(12,11,8,.25),rgba(12,11,8,.82) 62%)}
.tw-title{font-size:34px;line-height:1.02;font-weight:700;letter-spacing:-.02em;margin:0 0 10px;max-width:320px}
.tw-sub{font-size:14px;line-height:1.45;opacity:.72;max-width:300px;margin:0 0 26px}
.tw-actions{display:flex;flex-direction:column;gap:10px;max-width:340px}
.tw-b{pointer-events:auto;font:inherit;font-size:16px;font-weight:600;height:52px;border-radius:12px;border:0;background:#efe6d2;color:#15130e;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:left;padding:0 18px;display:flex;align-items:center;justify-content:space-between}
.tw-b.sec{background:rgba(239,230,210,.1);color:#efe6d2;border:1px solid rgba(239,230,210,.2)}
.tw-b small{font-weight:400;opacity:.6;font-size:13px}
.tw-b:active{transform:scale(.99)}
.tw-row{display:flex;gap:10px}
.tw-row .tw-b{flex:1;justify-content:center}
.tw-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;max-height:52vh;margin:0 0 14px;pointer-events:auto;-webkit-overflow-scrolling:touch}
.tw-li{pointer-events:auto;display:flex;align-items:baseline;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(239,230,210,.08);font-size:15px;cursor:pointer;background:none;border-left:0;border-right:0;border-top:0;color:inherit;font-family:inherit;text-align:left}
.tw-li span{font-variant-numeric:tabular-nums;opacity:.5;width:22px;font-size:13px}
.tw-li em{font-style:normal;margin-left:auto;font-size:12px;opacity:.5}
.tw-li.lock{opacity:.32;cursor:default}
.tw-li.cur{color:var(--ochre)}
.tw-act{font-size:12px;font-weight:600;opacity:.45;margin:14px 0 4px;letter-spacing:.02em}
.tw-seen{position:absolute;left:0;right:0;top:44%;text-align:center;font-size:15px;font-weight:600;opacity:0;transition:opacity .3s;letter-spacing:.02em}
.tw-seen.on{opacity:.9}
.tw-seen small{display:block;font-weight:400;font-size:14px;opacity:.75;margin-top:10px;padding:0 32px}
.tw-card{position:absolute;left:calc(var(--sl) + 24px);right:calc(var(--sr) + 24px);top:40%;opacity:0;transition:opacity .7s ease}
.tw-card.on{opacity:1}
.tw-card b{display:block;font-size:13px;font-weight:600;opacity:.55;margin-bottom:6px;font-variant-numeric:tabular-nums}
.tw-card div{font-size:28px;font-weight:700;letter-spacing:-.015em}
.tw-board{font-size:13px;opacity:.85;margin:0 0 18px;max-width:320px}
.tw-board div{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(239,230,210,.08)}
.tw-board .me{color:var(--ochre)}
.tw-stats{display:flex;gap:28px;margin:0 0 22px}
.tw-stats div{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.tw-stats small{display:block;font-size:12px;font-weight:400;opacity:.55;margin-top:2px}
`;

const ICON = {
  pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  ret: '<svg viewBox="-40 -40 80 80"><circle r="30" fill="none" stroke="rgba(255,246,220,.28)" stroke-width="2"/><circle class="p" r="30" fill="none" stroke="#fff6dc" stroke-width="2.6" stroke-dasharray="188.5" stroke-dashoffset="188.5" transform="rotate(-90)" stroke-linecap="round"/><path class="tk" d="M0,-36V-30M36,0H30M0,36V30M-36,0H-30" stroke="#fff6dc" stroke-width="2.2" stroke-linecap="round"/></svg>',
  focus: '<svg viewBox="-46 -46 92 92"><circle r="38" fill="none" stroke="#e3a94f" stroke-width="2.5" stroke-dasharray="6 7"/></svg>',
  edge: '<svg viewBox="-14 -14 28 28"><path d="M-6,-8L8,0L-6,8Z" fill="#e3a94f"/></svg>'
};

function createHud(ctx) {
  const ui = ctx.createRoot({ className: 'tw', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = HUD_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = { ui, el };
  H.vig = el('div', 'tw-vig');
  H.ink = el('div', 'tw-ink');
  H.edges = el('div', ''); H.edgePool = [];
  H.focus = el('div', 'tw-focus', ICON.focus);
  H.ret = el('div', 'tw-ret', ICON.ret); H.retP = H.ret.querySelector('.p'); H.retTk = H.ret.querySelector('.tk');
  H.stick = el('div', 'tw-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.top = el('div', 'tw-top');
  const tl = el('div', '', '', H.top);
  H.label = el('div', 'tw-label', '', tl);
  H.prog = el('div', 'tw-prog', '', tl);
  H.pause = el('div', 'tw-btn', ICON.pause, H.top); H.pause.setAttribute('role', 'button'); H.pause.setAttribute('aria-label', 'Pause');
  H.hint = el('div', 'tw-hint');
  H.seen = el('div', 'tw-seen');
  H.card = el('div', 'tw-card');
  H.fade = el('div', 'tw-fade');
  H.panels = {};
  H.panel = (id, dim) => { const p = el('div', 'tw-panel' + (dim ? ' dim' : '')); H.panels[id] = p; return p; };
  H.show = id => { for (const k in H.panels) H.panels[k].classList.toggle('on', k === id); };
  H.inGame = on => { H.top.style.display = on ? '' : 'none'; };
  // hint line
  let hintTimer = 0, hintId = null;
  H.setHint = (text, id, ms) => {
    if (!text) { H.hint.classList.remove('on'); ui.classList.remove('hinting'); hintId = null; return; }
    if (hintId === id && H.hint.classList.contains('on')) return;
    hintId = id; H.hint.textContent = text; H.hint.classList.add('on'); ui.classList.add('hinting'); hintTimer = ms || 0;
  };
  H.hintId = () => hintId;
  H.tickHint = dt => { if (hintTimer > 0) { hintTimer -= dt * 1000; if (hintTimer <= 0) { H.hint.classList.remove('on'); ui.classList.remove('hinting'); } } };
  H.setLabel = (n, name, ms) => {
    H.label.innerHTML = `${String(n).padStart(2, '0')}<small>${name}</small>`;
    H.label.classList.add('on');
    clearTimeout(H._lt); H._lt = setTimeout(() => H.label.classList.remove('on'), ms || 4200);
  };
  H.setProgress = (cur, cleared, total) => {
    let s = '';
    for (let i = 0; i < total; i++) s += `<i class="${i === cur ? 'c' : i < cleared ? 'd' : ''}"></i>`;
    H.prog.innerHTML = s; H.prog.classList.add('on');
    clearTimeout(H._pt); H._pt = setTimeout(() => H.prog.classList.remove('on'), 4200);
  };
  H.edgeMark = (i, x, y, ang, a) => {
    let m = H.edgePool[i];
    if (!m) { m = el('div', 'tw-edge', ICON.edge, H.edges); H.edgePool[i] = m; }
    m.style.display = '';
    m.style.transform = `translate(${x}px,${y}px) rotate(${ang}rad) scale(${0.8 + a * 0.6})`;
    m.style.opacity = String(0.35 + a * 0.65);
  };
  H.edgeHide = from => { for (let i = from; i < H.edgePool.length; i++) H.edgePool[i].style.display = 'none'; };
  return H;
}
