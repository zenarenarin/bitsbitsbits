// =====================================================================
// Interface: quiet, sans-serif, out of the drawing's way.
// Inter throughout. Scale (px): 13 small · 15 body · 24 heading · 34 title.
// 16px gutter inside the content-safe area, 8px rhythm.
// =====================================================================
const UI_CSS = `
.wb{position:absolute;inset:0;font-family:Inter,system-ui,-apple-system,sans-serif;font-weight:400;color:#ece4d2;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--bone:#ece4d2;--ink:#0f0d0b;--muted:rgba(236,228,210,.62)}
.wb *{box-sizing:border-box}
.wb-top{position:absolute;left:16px;right:16px;top:0;display:flex;justify-content:space-between;align-items:center;transition:opacity .4s}
.wb-num{font-size:13px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;letter-spacing:.01em}
.wb-name{position:absolute;left:16px;right:16px;font-size:15px;font-weight:600;opacity:0;transition:opacity .8s;text-shadow:0 1px 12px rgba(0,0,0,.9)}
.wb-btn{pointer-events:auto;width:44px;height:44px;border-radius:50%;border:1px solid rgba(236,228,210,.35);background:rgba(15,13,11,.45);color:var(--bone);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer}
.wb-btn svg{width:38%;height:38%;overflow:visible}
.wb-btn:active{background:rgba(236,228,210,.18)}
.wb-band{position:absolute;left:0;right:0;bottom:0;pointer-events:none}
.wb-hint{position:absolute;left:24px;right:24px;text-align:center;font-size:15px;font-weight:500;line-height:1.4;opacity:0;transition:opacity .5s;text-shadow:0 1px 14px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.9)}
.wb-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:1.5px solid rgba(236,228,210,.22);transition:border-color .2s}
.wb-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(236,228,210,.16);transition:background .2s}
.wb-stick.live{border-color:rgba(236,228,210,.45)}
.wb-stick.live b{background:rgba(236,228,210,.38)}
.wb-stick.teach b{animation:wbk 1.3s ease-in-out infinite alternate}
@keyframes wbk{from{transform:translateX(-24px)}to{transform:translateX(24px)}}
.wb-dial{position:absolute;height:56px;display:none;overflow:hidden;border-radius:28px;border:1.5px solid rgba(236,228,210,.22);-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)}
.wb-dial i{position:absolute;top:16px;bottom:16px;width:1.5px;background:rgba(236,228,210,.38)}
.wb-dial i.l{top:10px;bottom:10px;background:rgba(236,228,210,.7)}
.wb-dial em{position:absolute;top:50%;left:50%;width:12px;height:12px;margin:-6px;border-radius:50%;background:var(--bone)}
.wb-dial.teach em{animation:wbk 1.3s ease-in-out infinite alternate}
.wb-edge{position:absolute;width:28px;height:28px;margin:-14px;display:none}
.wb-edge svg{width:100%;height:100%;overflow:visible}
.wb-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 50%,rgba(8,7,6,.92) 100%);opacity:0;transition:opacity .25s}
.wb-mark{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 55%,rgba(30,28,12,.55) 100%);opacity:0;transition:opacity .3s}
.wb-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 16px}
.wb-panel.on{display:flex}
.wb-panel.mid{justify-content:center}
.wb-card{width:100%;max-width:380px;border-radius:16px;padding:20px;background:rgba(15,13,11,.88);border:1px solid rgba(236,228,210,.12);pointer-events:auto}
.wb-title{position:absolute;left:24px;right:24px;font-size:34px;font-weight:700;line-height:1.08;letter-spacing:-.02em;text-shadow:0 2px 24px rgba(0,0,0,.95)}
.wb-tag{font-size:15px;font-weight:400;line-height:1.45;color:var(--muted);margin-top:12px;letter-spacing:0;max-width:300px}
.wb-b{display:block;width:100%;border:0;border-radius:12px;padding:0 16px;height:50px;margin-top:8px;font:600 15px Inter,system-ui,sans-serif;color:var(--ink);background:var(--bone);pointer-events:auto;cursor:pointer}
.wb-b:active{opacity:.85}
.wb-b.sec{background:transparent;color:var(--bone);border:1px solid rgba(236,228,210,.28)}
.wb-b[hidden]{display:none}
.wb-row{display:flex;gap:8px}.wb-row .wb-b{flex:1}
.wb-h{font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-.01em;margin-bottom:8px}
.wb-sub{font-size:15px;line-height:1.45;color:var(--muted);margin-bottom:16px}
.wb-stats{display:flex;gap:8px;margin-bottom:12px}
.wb-stats>div{flex:1;font-size:13px;color:var(--muted)}
.wb-stats b{display:block;font-size:22px;font-weight:600;color:var(--bone);font-variant-numeric:tabular-nums;margin-bottom:2px}
.wb-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-top:1px solid rgba(236,228,210,.08);font-size:15px;color:var(--muted)}
.wb-li b{font-weight:600;color:var(--bone);font-variant-numeric:tabular-nums}
.wb-new{color:#c9c38a}
.wb-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:15px;min-height:48px}
.wb-set input[type=range]{width:46%;pointer-events:auto;accent-color:#ece4d2}
.wb-tog{pointer-events:auto;border:1px solid rgba(236,228,210,.3);background:transparent;color:var(--bone);border-radius:10px;padding:8px 14px;font:600 13px Inter,sans-serif;min-width:64px;min-height:38px}
.wb-tog.on{background:var(--bone);color:var(--ink)}
.wb-act{position:absolute;inset:0;display:none;flex-direction:column;align-items:flex-start;justify-content:center;padding:0 32px;transition:background .6s;pointer-events:auto}
.wb-act.on{display:flex;background:rgba(10,9,8,.6)}
.wb-act .s{font-size:13px;font-weight:600;color:var(--muted);opacity:0;transition:opacity .8s;margin-bottom:8px}
.wb-act .t{font-size:30px;font-weight:600;line-height:1.15;letter-spacing:-.015em;opacity:0;transition:opacity .8s;text-shadow:0 2px 20px rgba(0,0,0,.9)}
.wb-act.show .t,.wb-act.show .s{opacity:1}
.wb-end{position:absolute;left:32px;right:32px;font-size:18px;font-weight:500;line-height:1.45;opacity:0;transition:opacity 1.6s;text-shadow:0 1px 16px rgba(0,0,0,.95)}
.wb-skip{position:absolute;right:16px;font-size:13px;font-weight:600;color:var(--muted);pointer-events:auto;padding:14px}
`;

const ICON = {
  pause: '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edge: '<svg viewBox="-10 -10 20 20"><path d="M-5,4L0,-3L5,4" fill="none" stroke="#ece4d2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function createUI(ctx) {
  const ui = ctx.createRoot({ className: 'wb', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = { root: ui, el };
  H.vig = el('div', 'wb-vig');
  H.mark = el('div', 'wb-mark');
  H.top = el('div', 'wb-top');
  H.num = el('div', 'wb-num', '', H.top);
  H.pause = el('div', 'wb-btn', ICON.pause, H.top);
  H.pause.setAttribute('aria-label', 'Pause');
  H.name = el('div', 'wb-name', '');
  H.band = el('div', 'wb-band');
  H.hint = el('div', 'wb-hint', '');
  H.edge = el('div', 'wb-edge', ICON.edge);
  H.stick = el('div', 'wb-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.dial = el('div', 'wb-dial', '<em></em>'); H.dialKnob = H.dial.firstChild;
  H.ticks = [];
  for (let i = 0; i < 24; i++) { const t = el('i', i % 4 === 0 ? 'l' : '', undefined, H.dial); H.ticks.push(t); }
  // act card
  H.act = el('div', 'wb-act');
  H.actS = el('div', 's', '', H.act); H.actT = el('div', 't', '', H.act);
  // ending text
  H.end = el('div', 'wb-end', '');
  H.skip = el('div', 'wb-skip', 'Skip'); H.skip.style.display = 'none';
  // title
  H.title = el('div', 'wb-panel');
  H.titleText = el('div', 'wb-title', 'The Thing That Watches Back<div class="wb-tag">Watch an eye and it cannot move. Look away and it is free.</div>', H.title);
  const tc = el('div', 'wb-card', '', H.title);
  H.tstats = el('div', 'wb-stats', '', tc);
  H.begin = el('button', 'wb-b', 'Begin', tc);
  H.cont = el('button', 'wb-b sec', 'Continue', tc);
  const trow = el('div', 'wb-row', '', tc);
  H.endless = el('button', 'wb-b sec', 'Endless', trow);
  H.toSet = el('button', 'wb-b sec', 'Settings', trow);
  // pause
  H.pausePanel = el('div', 'wb-panel mid');
  const pc = el('div', 'wb-card', '', H.pausePanel);
  el('div', 'wb-h', 'Paused', pc);
  H.pauseSub = el('div', 'wb-sub', '', pc);
  H.resume = el('button', 'wb-b', 'Resume', pc);
  H.restart = el('button', 'wb-b sec', 'Restart encounter', pc);
  const prow = el('div', 'wb-row', '', pc);
  H.pSet = el('button', 'wb-b sec', 'Settings', prow);
  H.quit = el('button', 'wb-b sec', 'End run', prow);
  // capture
  H.cap = el('div', 'wb-panel');
  const cc = el('div', 'wb-card', '', H.cap);
  H.capH = el('div', 'wb-h', '', cc);
  H.capSub = el('div', 'wb-sub', '', cc);
  H.again = el('button', 'wb-b', 'Try again', cc);
  H.capEnd = el('button', 'wb-b sec', 'End run', cc);
  // results
  H.res = el('div', 'wb-panel');
  const rc = el('div', 'wb-card', '', H.res);
  H.resH = el('div', 'wb-h', '', rc);
  H.resSub = el('div', 'wb-sub', '', rc);
  H.resStats = el('div', 'wb-stats', '', rc);
  H.resList = el('div', '', '', rc);
  H.resAgain = el('button', 'wb-b', 'Play again', rc);
  const rrow = el('div', 'wb-row', '', rc);
  H.resEndless = el('button', 'wb-b sec', 'Endless', rrow);
  H.resTitle = el('button', 'wb-b sec', 'Title', rrow);
  // settings
  H.set = el('div', 'wb-panel mid');
  const sc = el('div', 'wb-card', '', H.set);
  el('div', 'wb-h', 'Settings', sc);
  H.setList = el('div', '', '', sc);
  H.setBack = el('button', 'wb-b', 'Back', sc);
  H.panels = [H.title, H.pausePanel, H.cap, H.res, H.set];
  H.showOnly = p => { for (const x of H.panels) x.classList.toggle('on', x === p); };
  return H;
}
