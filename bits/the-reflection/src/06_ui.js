// =====================================================================
// HUD and screens. Restrained: aged-bronze hairlines, a serif for numbers,
// small tracked labels, no panels during play.
// Type scale (px): 10 label · 13 body · 22 numeral · 44 title. 16px gutter.
// =====================================================================

const UI_CSS = `
.rf{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#d9cdb8;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px;--bronze:#a8834e;--amber:#e8a85a;--dim:rgba(217,205,184,.55)}
.rf *{box-sizing:border-box}
.rf-lab{font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.rf-num{font-family:'DM Serif Display',Georgia,serif;font-variant-numeric:tabular-nums;line-height:1}
.rf-top{position:absolute;left:var(--g);right:var(--g);top:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:start;transition:opacity .6s}
.rf-title{opacity:.42;padding-top:3px}
.rf-time{text-align:center;font-size:22px;text-shadow:0 1px 10px #000}
.rf-time.mark{color:var(--amber);transition:color .3s}
.rf-time small{display:block;margin-top:5px;opacity:0;transition:opacity .6s;color:var(--amber)}
.rf-time.mark small{opacity:.9}
.rf-right{display:flex;justify-content:flex-end;align-items:flex-start;gap:12px}
.rf-score{text-align:right}
.rf-score .rf-num{font-size:22px;text-shadow:0 1px 10px #000}
.rf-score .rf-lab{margin-top:5px;opacity:.5}
.rf-mute{pointer-events:auto;width:32px;height:32px;margin-top:-4px;border:0;background:transparent;color:var(--dim);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.rf-mute svg{width:18px;height:18px}
.rf-sync{position:absolute;left:var(--g);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-start;gap:8px;transition:opacity .6s}
.rf-sync .rf-num{font-size:22px;text-shadow:0 1px 10px #000}
.rf-bar{position:relative;width:3px;height:120px;background:rgba(217,205,184,.14);margin-left:1px}
.rf-bar b{position:absolute;left:0;right:0;bottom:0;background:var(--bronze);transition:height .25s ease-out,background .4s}
.rf-bar i{position:absolute;left:-3px;width:9px;height:1px;background:rgba(217,205,184,.35)}
.rf-state{opacity:.7;transition:color .4s}
.rf-sync.unstable .rf-bar b{background:#b57a45}.rf-sync.unstable .rf-state{color:#c99a68}
.rf-sync.critical .rf-bar b{background:#9a3e2c}.rf-sync.critical .rf-state{color:#c4634c;opacity:1}
.rf-sync.critical .rf-num{animation:rfp 1s ease-in-out infinite}
@keyframes rfp{50%{opacity:.45}}
.rf-streak{opacity:0;transition:opacity .3s}
.rf-streak.on{opacity:.65}
.rf-word{position:absolute;left:0;right:0;text-align:center;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:20px;letter-spacing:.04em;opacity:0;text-shadow:0 1px 14px #000}
.rf-word.go{animation:rfw .9s ease-out forwards}
@keyframes rfw{0%{opacity:0;transform:translateY(6px)}15%{opacity:.95;transform:none}100%{opacity:0;transform:translateY(-10px)}}
.rf-line{position:absolute;left:var(--g);right:var(--g);text-align:center;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:19px;line-height:1.5;opacity:0;transition:opacity 1.4s ease;text-shadow:0 2px 18px #000}
.rf-line.on{opacity:.92}
.rf-pad{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:var(--gap,10px);padding:0 var(--g);transition:opacity .6s}
.rf-act{pointer-events:auto;touch-action:none;flex:0 0 auto;width:var(--bs,60px);height:var(--bs,60px);border-radius:50%;border:1px solid rgba(168,131,78,.5);background:rgba(12,10,9,.42);color:#d9cdb8;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;cursor:pointer;transition:transform .12s ease-out,background .15s,border-color .3s,box-shadow .4s;-webkit-tap-highlight-color:transparent;padding:0}
.rf-act svg{width:58%;height:58%;overflow:visible}
.rf-act .k{position:absolute;bottom:-17px;font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.38}
.rf-act.down{transform:scale(.9);background:rgba(168,131,78,.32);border-color:rgba(232,168,90,.9)}
.rf-act.hint{box-shadow:0 0 0 1px rgba(232,168,90,.7),0 0 22px rgba(232,168,90,.28);border-color:rgba(232,168,90,.85)}
.rf-act.ok{animation:rfo .45s ease-out}
.rf-act.bad{animation:rfb .35s ease-out}
@keyframes rfo{40%{box-shadow:0 0 0 1px rgba(232,168,90,.9),0 0 26px rgba(232,168,90,.45)}}
@keyframes rfb{25%{transform:translateX(-3px)}50%{transform:translateX(3px)}75%{transform:translateX(-2px)}}
@media (pointer:coarse){.rf-act .k{display:none}}
.rf-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;padding:0 var(--g);opacity:0;transition:opacity 1s ease}
.rf-panel.on{display:flex}.rf-panel.vis{opacity:1}
.rf-logo{font-family:'DM Serif Display',Georgia,serif;font-size:44px;line-height:1.05;letter-spacing:.2em;text-indent:.2em;text-align:center;text-shadow:0 2px 30px #000}
.rf-rule{width:40px;height:1px;background:var(--bronze);margin:18px auto}
.rf-b{pointer-events:auto;border:1px solid rgba(168,131,78,.7);background:rgba(12,10,9,.5);color:#e6dccb;border-radius:999px;padding:13px 34px;font:700 11px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.3em;text-indent:.3em;cursor:pointer;transition:background .2s,border-color .2s}
.rf-b:hover,.rf-b:active{background:rgba(168,131,78,.25);border-color:var(--amber)}
.rf-sub{margin-top:14px;opacity:.5}
.rf-res{display:flex;gap:28px;justify-content:center;margin:6px 0 26px}
.rf-res>div{text-align:center}
.rf-res .rf-num{font-size:24px;margin-bottom:6px}
.rf-res .rf-lab{opacity:.55}
.rf-res .big .rf-num{font-size:44px}
.rf-new{color:var(--amber);opacity:.9;margin-bottom:10px;min-height:12px}
.rf-head{opacity:.6;margin-bottom:18px}
.rf-shade{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 30%,rgba(0,0,0,.55) 100%);opacity:0;transition:opacity 1.2s}
.rf-shade.on{opacity:1}
`;

// silhouettes, side view, facing right; 48x48
const ICONS = (() => {
  const head = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - r * 0.95} ${y - r * 0.35}L${x - r * 0.75} ${y - r * 1.85}L${x - r * 0.05} ${y - r * 0.85}ZM${x + r * 0.15} ${y - r * 0.9}L${x + r * 0.95} ${y - r * 1.85}L${x + r * 1.0} ${y - r * 0.3}Z"/>`;
  const S = 'stroke="currentColor" stroke-linecap="round" fill="none"';
  return {
    sit: `<svg viewBox="0 0 48 48" fill="currentColor">${head(28, 13, 5)}<path d="M23 17C17 20 14 28 15 35C15.5 39 18 41 22 41L31 41C32 36 32 26 30 19Z"/><path d="M27 26L28.5 41" ${S} stroke-width="3.2"/><path d="M16 39C9 40 7 35 11 32" ${S} stroke-width="2.6"/></svg>`,
    stand: `<svg viewBox="0 0 48 48" fill="currentColor">${head(37, 18, 4.6)}<ellipse cx="23" cy="25" rx="12.5" ry="6"/><path d="M14 28L13 41M18 29L18.5 41M29 29L29 41M33 27L34 41" ${S} stroke-width="2.8"/><path d="M11 23C6 20 5 13 8 9" ${S} stroke-width="2.6"/></svg>`,
    crouch: `<svg viewBox="0 0 48 48" fill="currentColor">${head(38, 31, 4.3)}<ellipse cx="23" cy="34" rx="13.5" ry="4.8"/><path d="M14 37L12 41M32 37L35 41" ${S} stroke-width="2.8"/><path d="M10 35C6 36 3 37 1.5 37.5" ${S} stroke-width="2.4"/></svg>`,
    paw: `<svg viewBox="0 0 48 48" fill="currentColor">${head(27, 13, 5)}<path d="M22 17C16 20 13 28 14 35C14.5 39 17 41 21 41L29 41C30 36 30 26 29 19Z"/><path d="M28 24L38 15" ${S} stroke-width="3.2"/><path d="M15 39C8 40 6 35 10 32" ${S} stroke-width="2.6"/></svg>`,
    jump: `<svg viewBox="0 0 48 48" fill="currentColor">${head(36, 11, 4.4)}<ellipse cx="23" cy="21" rx="12" ry="5" transform="rotate(-28 23 21)"/><path d="M31 17L39 21M29 20L37 25M15 26L8 34M18 27L12 36" ${S} stroke-width="2.6"/><path d="M13 27C8 30 4 29 3 25" ${S} stroke-width="2.4"/><path d="M14 44L34 44" ${S} stroke-width="1.4" opacity=".45"/></svg>`
  };
})();
const MUTE_ICON = { on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9H8L13 5V19L8 15H4Z"/><path d="M16.5 9.5C17.5 10.8 17.5 13.2 16.5 14.5M19 7C21.3 9.7 21.3 14.3 19 17"/></svg>', off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9H8L13 5V19L8 15H4Z"/><path d="M17 10L21 14M21 10L17 14"/></svg>' };

function createUI(ctx) {
  const ui = ctx.createRoot({ className: 'rf', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const U = { root: ui };
  U.shade = el('div', 'rf-shade');
  U.top = el('div', 'rf-top');
  U.title = el('div', 'rf-title rf-lab', 'The Reflection', U.top);
  U.time = el('div', 'rf-time rf-num', '0:00<small class="rf-lab">survived</small>', U.top);
  const right = el('div', 'rf-right', '', U.top);
  const sc = el('div', 'rf-score', '', right);
  U.score = el('div', 'rf-num', '0', sc); U.best = el('div', 'rf-lab', 'best 0', sc);
  U.mute = el('button', 'rf-mute', MUTE_ICON.on, right); U.mute.setAttribute('aria-label', 'Sound');
  U.sync = el('div', 'rf-sync');
  U.syncNum = el('div', 'rf-num', '100', U.sync);
  U.bar = el('div', 'rf-bar', '<b style="height:100%"></b><i style="bottom:75%"></i><i style="bottom:45%"></i><i style="bottom:20%"></i>', U.sync); U.barFill = U.bar.firstChild;
  U.state = el('div', 'rf-state rf-lab', 'STABLE', U.sync);
  U.streak = el('div', 'rf-streak rf-lab', '', U.sync);
  U.word = el('div', 'rf-word', '');
  U.line = el('div', 'rf-line', '');
  U.pad = el('div', 'rf-pad');
  U.btn = {};
  ACTIONS.forEach((a, i) => { const b = el('button', 'rf-act', ICONS[a] + `<span class="k">${a === 'jump' ? '5 · ␣' : i + 1}</span>`, U.pad); b.setAttribute('aria-label', ACTION_LABEL[a]); b.dataset.a = a; U.btn[a] = b; });
  // screens
  U.start = el('div', 'rf-panel');
  el('div', 'rf-logo', 'THE<br>REFLECTION', U.start); el('div', 'rf-rule', '', U.start);
  U.startBtn = el('button', 'rf-b', 'START', U.start);
  U.startBest = el('div', 'rf-sub rf-lab', '', U.start);
  U.results = el('div', 'rf-panel');
  U.resHead = el('div', 'rf-head rf-lab', 'The reflection escaped', U.results);
  U.resNew = el('div', 'rf-new rf-lab', '', U.results);
  U.resStats = el('div', 'rf-res', '', U.results);
  U.again = el('button', 'rf-b', 'AGAIN', U.results);
  U.paused = el('div', 'rf-panel'); el('div', 'rf-lab', 'paused', U.paused); el('div', 'rf-rule', '', U.paused); U.resume = el('button', 'rf-b', 'RESUME', U.paused);

  let wordTimer = 0;
  U.say = (txt, yFrac) => { U.word.textContent = txt; U.word.style.top = (yFrac * 100) + '%'; U.word.classList.remove('go'); void U.word.offsetWidth; U.word.classList.add('go'); clearTimeout(wordTimer); };
  U.showLine = (html, yFrac) => { U.line.innerHTML = html; U.line.style.top = (yFrac * 100) + '%'; U.line.classList.add('on'); };
  U.hideLine = () => U.line.classList.remove('on');
  U.panel = p => {
    for (const x of [U.start, U.results, U.paused]) {
      if (x === p) { x.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => x.classList.add('vis'))); }
      else { x.classList.remove('on', 'vis'); }
    }
  };
  U.hud = on => { for (const e of [U.top, U.sync, U.pad]) { e.style.opacity = on ? '1' : '0'; } U.pad.style.pointerEvents = on ? '' : 'none'; for (const b of Object.values(U.btn)) b.style.pointerEvents = on ? '' : 'none'; };
  U.setMuted = m => { U.mute.innerHTML = m ? MUTE_ICON.off : MUTE_ICON.on; };
  const fmt = s => { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  U.fmt = fmt;
  const cache = {};
  U.update = (D, best) => {
    const t = fmt(D.t); if (cache.t !== t) { cache.t = t; U.time.firstChild.textContent = t; }
    const s = Math.floor(D.score).toLocaleString(); if (cache.s !== s) { cache.s = s; U.score.textContent = s; }
    const b = 'best ' + Math.floor(best).toLocaleString(); if (cache.b !== b) { cache.b = b; U.best.textContent = b; }
    const y = Math.round(D.sync); if (cache.y !== y) { cache.y = y; U.syncNum.textContent = y; U.barFill.style.height = y + '%'; }
    const stt = D.state(); if (cache.st !== stt) { cache.st = stt; U.state.textContent = stt; U.sync.classList.toggle('unstable', stt === 'UNSTABLE'); U.sync.classList.toggle('critical', stt === 'CRITICAL' || stt === 'ESCAPED'); }
    const k = D.streak >= 2 ? `streak ${D.streak}${D.perfectStreak >= 2 ? ' · ×' + D.comboMult().toFixed(1) : ''}` : '';
    if (cache.k !== k) { cache.k = k; U.streak.textContent = k; U.streak.classList.toggle('on', !!k); }
  };
  U.flashBtn = (a, cls) => { const b = U.btn[a]; if (!b) return; b.classList.remove('ok', 'bad'); void b.offsetWidth; b.classList.add(cls); };
  U.layout = (w, h, safe) => {
    const top = (safe && safe.top) || 0, bot = (safe && safe.bottom) || 0;
    U.top.style.paddingTop = (14 + top) + 'px';
    const narrow = w < 520;
    const bs = Math.round(clamp((w - 32 - 4 * 10) / 5, 50, narrow ? 64 : 62));
    const gap = Math.round(clamp((w - 32 - bs * 5) / 4, 8, 18));
    U.pad.style.setProperty('--bs', bs + 'px'); U.pad.style.setProperty('--gap', gap + 'px');
    U.pad.style.paddingBottom = (bot + (narrow ? 18 : 30)) + 'px';
    U.padH = bs + bot + (narrow ? 18 : 30) + 10;
  };
  return U;
}
