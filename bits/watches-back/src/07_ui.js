// =====================================================================
// Interface: ink and bone, editorial type, as little as possible.
// DM Serif Display for numerals and titles, Nunito Sans for labels.
// Scale (px): 11 label · 14 body · 16 whisper · 28 numeral · 40 title.
// 16px gutter (plus safe areas), 8px rhythm.
// =====================================================================
const UI_CSS = `
.wb{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#ece4d2;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px;--bone:#ece4d2;--ink:#0f0d0b;--olive:#8a8650}
.wb *{box-sizing:border-box}
.wb-lab{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}
.wb-top{position:absolute;left:var(--g);right:var(--g);top:0;display:flex;justify-content:space-between;align-items:flex-start;transition:opacity .4s}
.wb-num{font-family:'DM Serif Display',Georgia,serif;font-size:28px;line-height:1;letter-spacing:.04em}
.wb-num small{font-family:'Nunito Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:.2em;margin-left:8px;opacity:.55}
.wb-name{margin-top:8px;opacity:0;transition:opacity 1.2s}
.wb-whisper{margin-top:8px;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:16px;line-height:1.35;max-width:260px;opacity:0;transition:opacity 1.6s;color:#d9d0bd}
.wb-score{margin-top:8px;opacity:.6;font-variant-numeric:tabular-nums}
.wb-btn{pointer-events:auto;width:44px;height:44px;border-radius:50%;border:1.5px solid rgba(236,228,210,.55);background:rgba(15,13,11,.35);color:var(--bone);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer}
.wb-btn svg{width:40%;height:40%;overflow:visible}
.wb-btn:active{background:rgba(236,228,210,.2)}
.wb-band{position:absolute;left:0;right:0;bottom:0;pointer-events:none}
.wb-hint{position:absolute;left:var(--g);right:var(--g);text-align:center;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:16px;line-height:1.35;opacity:0;transition:opacity .6s;text-shadow:0 1px 10px rgba(0,0,0,.8)}
.wb-stick{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:1.5px solid rgba(236,228,210,.35);display:none}
.wb-stick b{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px;border-radius:50%;background:rgba(236,228,210,.28)}
.wb-stick.ghost{display:block;animation:wbg 2.4s ease-in-out infinite}
.wb-stick.ghost b{animation:wbk 1.2s ease-in-out infinite alternate}
@keyframes wbg{0%,100%{opacity:.25}50%{opacity:.8}}
@keyframes wbk{from{transform:translate(-22px,-10px)}to{transform:translate(22px,10px)}}
.wb-dial{position:absolute;height:56px;display:none;overflow:hidden;border-top:1px solid rgba(236,228,210,.25);border-bottom:1px solid rgba(236,228,210,.25);-webkit-mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent);mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}
.wb-dial i{position:absolute;top:12px;bottom:12px;width:1.5px;background:rgba(236,228,210,.5)}
.wb-dial i.l{top:6px;bottom:6px;background:rgba(236,228,210,.85)}
.wb-dial em{position:absolute;top:50%;left:50%;width:10px;height:10px;margin:-5px;border-radius:50%;background:var(--bone);transition:opacity .2s}
.wb-dial.ghost{animation:wbg 2.4s ease-in-out infinite}
.wb-dial-lab{position:absolute;opacity:.45;text-align:center}
.wb-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(0,0,0,0) 45%,rgba(8,7,6,.95) 100%);opacity:0;transition:opacity .2s}
.wb-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 var(--g)}
.wb-panel.on{display:flex}
.wb-panel.mid{justify-content:center}
.wb-card{width:100%;max-width:400px;border-radius:12px;padding:16px;background:rgba(15,13,11,.86);border:1px solid rgba(236,228,210,.18);pointer-events:auto}
.wb-title{position:absolute;left:var(--g);right:var(--g);text-align:center;font-family:'DM Serif Display',Georgia,serif;font-size:40px;line-height:1.02;letter-spacing:.02em;text-shadow:0 2px 24px rgba(0,0,0,.9)}
.wb-title small{display:block;font-family:'Nunito Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:.24em;margin-bottom:12px;opacity:.7}
.wb-tag{font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:16px;line-height:1.4;text-align:center;opacity:.85;margin-top:16px;letter-spacing:0}
.wb-rule{width:48px;height:1px;background:rgba(236,228,210,.6);margin:16px auto 0}
.wb-b{display:block;width:100%;border:0;border-radius:10px;padding:14px 16px;margin-top:8px;font:700 13px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.2em;color:var(--ink);background:var(--bone);pointer-events:auto;cursor:pointer;min-height:48px}
.wb-b:active{opacity:.85}
.wb-b.sec{background:transparent;color:var(--bone);border:1px solid rgba(236,228,210,.4)}
.wb-b[hidden]{display:none}
.wb-row{display:flex;gap:8px}.wb-row .wb-b{flex:1}
.wb-h{font-family:'DM Serif Display',Georgia,serif;font-size:28px;line-height:1.15;text-align:center;margin-bottom:8px}
.wb-sub{font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:16px;line-height:1.45;text-align:center;opacity:.85;margin-bottom:16px}
.wb-stats{display:flex;justify-content:space-between;padding:0 4px 8px;border-bottom:1px solid rgba(236,228,210,.14);margin-bottom:8px}
.wb-stats>div{font-size:11px;font-weight:700;letter-spacing:.18em;opacity:.85;text-align:center;flex:1}
.wb-stats b{display:block;font-family:'DM Serif Display',Georgia,serif;font-size:24px;letter-spacing:0;font-weight:400;margin-bottom:2px}
.wb-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(236,228,210,.1);font-size:14px}
.wb-li b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:16px;font-variant-numeric:tabular-nums}
.wb-new{color:#c9c38a}
.wb-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:14px;min-height:44px}
.wb-set input[type=range]{width:46%;pointer-events:auto;accent-color:#ece4d2}
.wb-tog{pointer-events:auto;border:1px solid rgba(236,228,210,.4);background:transparent;color:var(--bone);border-radius:8px;padding:8px 12px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.14em;min-width:56px;min-height:36px}
.wb-tog.on{background:var(--bone);color:var(--ink)}
.wb-act{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,9,8,.0);transition:background .6s;pointer-events:auto}
.wb-act.on{display:flex;background:rgba(10,9,8,.72)}
.wb-act .t{font-family:'DM Serif Display',Georgia,serif;font-size:36px;line-height:1.1;text-align:center;padding:0 var(--g);opacity:0;transition:opacity 1s}
.wb-act .s{opacity:0;transition:opacity 1s;margin-bottom:16px}
.wb-act.show .t,.wb-act.show .s{opacity:1}
.wb-end{position:absolute;left:var(--g);right:var(--g);text-align:center;font-family:'DM Serif Display',Georgia,serif;font-size:20px;line-height:1.5;font-style:italic;opacity:0;transition:opacity 2s;text-shadow:0 1px 16px rgba(0,0,0,.9)}
.wb-skip{position:absolute;right:var(--g);opacity:.5;pointer-events:auto;padding:12px}
`;

const ICON = {
  pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

function createUI(ctx) {
  const ui = ctx.createRoot({ className: 'wb', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = { root: ui, el };
  H.vig = el('div', 'wb-vig');
  H.top = el('div', 'wb-top');
  const tl = el('div', '', '', H.top);
  H.num = el('div', 'wb-num', '', tl);
  H.name = el('div', 'wb-name wb-lab', '', tl);
  H.whisper = el('div', 'wb-whisper', '', tl);
  H.score = el('div', 'wb-score wb-lab', '', tl);
  H.pause = el('div', 'wb-btn', ICON.pause, H.top);
  H.pause.setAttribute('aria-label', 'Pause');
  H.band = el('div', 'wb-band');
  H.hint = el('div', 'wb-hint', '');
  H.stick = el('div', 'wb-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.dial = el('div', 'wb-dial', '<em></em>'); H.dialKnob = H.dial.firstChild;
  H.ticks = [];
  for (let i = 0; i < 24; i++) { const t = el('i', i % 4 === 0 ? 'l' : '', undefined, H.dial); H.ticks.push(t); }
  H.dialLab = el('div', 'wb-dial-lab wb-lab', 'Turn');
  H.stickLab = el('div', 'wb-dial-lab wb-lab', 'Walk');
  // act card
  H.act = el('div', 'wb-act');
  H.actS = el('div', 's wb-lab', '', H.act); H.actT = el('div', 't', '', H.act);
  // ending text
  H.end = el('div', 'wb-end', '');
  H.skip = el('div', 'wb-skip wb-lab', 'Skip'); H.skip.style.display = 'none';
  // title
  H.title = el('div', 'wb-panel');
  H.titleText = el('div', 'wb-title', '<small>A spiral of eyes</small>The Thing<br>That Watches<br>Back<div class="wb-tag">Looking at an eye holds it still.<br>Looking away lets it go.</div>', H.title);
  const tc = el('div', 'wb-card', '', H.title);
  H.tstats = el('div', 'wb-stats', '', tc);
  H.begin = el('button', 'wb-b', 'BEGIN', tc);
  H.cont = el('button', 'wb-b sec', 'CONTINUE', tc);
  const trow = el('div', 'wb-row', '', tc);
  H.endless = el('button', 'wb-b sec', 'ENDLESS', trow);
  H.toSet = el('button', 'wb-b sec', 'SETTINGS', trow);
  // pause
  H.pausePanel = el('div', 'wb-panel mid');
  const pc = el('div', 'wb-card', '', H.pausePanel);
  el('div', 'wb-h', 'Paused', pc);
  H.pauseSub = el('div', 'wb-sub', '', pc);
  H.resume = el('button', 'wb-b', 'RESUME', pc);
  H.restart = el('button', 'wb-b sec', 'BEGIN THIS SPIRAL AGAIN', pc);
  const prow = el('div', 'wb-row', '', pc);
  H.pSet = el('button', 'wb-b sec', 'SETTINGS', prow);
  H.quit = el('button', 'wb-b sec', 'END RUN', prow);
  // capture
  H.cap = el('div', 'wb-panel');
  const cc = el('div', 'wb-card', '', H.cap);
  H.capH = el('div', 'wb-h', '', cc);
  H.capSub = el('div', 'wb-sub', '', cc);
  H.again = el('button', 'wb-b', 'TRY AGAIN', cc);
  H.capEnd = el('button', 'wb-b sec', 'END RUN', cc);
  // results
  H.res = el('div', 'wb-panel');
  const rc = el('div', 'wb-card', '', H.res);
  H.resH = el('div', 'wb-h', '', rc);
  H.resSub = el('div', 'wb-sub', '', rc);
  H.resStats = el('div', 'wb-stats', '', rc);
  H.resList = el('div', '', '', rc);
  H.resAgain = el('button', 'wb-b', 'AGAIN', rc);
  const rrow = el('div', 'wb-row', '', rc);
  H.resEndless = el('button', 'wb-b sec', 'ENDLESS', rrow);
  H.resTitle = el('button', 'wb-b sec', 'TITLE', rrow);
  // settings
  H.set = el('div', 'wb-panel mid');
  const sc = el('div', 'wb-card', '', H.set);
  el('div', 'wb-h', 'Settings', sc);
  H.setList = el('div', '', '', sc);
  H.setBack = el('button', 'wb-b', 'BACK', sc);
  H.panels = [H.title, H.pausePanel, H.cap, H.res, H.set];
  H.showOnly = p => { for (const x of H.panels) x.classList.toggle('on', x === p); };
  return H;
}
