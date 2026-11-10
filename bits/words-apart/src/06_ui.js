// Interface: restrained typography over the world. All sizes derive from the viewport in layout().
const UI_CSS = `
.wa{--bg:#101311;--deep:#080b09;--green:#a1c58e;--muted:#64866a;--white:#e9e2cf;--dim:rgba(233,226,207,.56);--faint:rgba(233,226,207,.22);--warn:#d8c98f;--hot:#e2a585;
  --serif:'DM Serif Display',Georgia,'Times New Roman',serif;--sans:'Nunito Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  position:absolute;inset:0;overflow:hidden;color:var(--white);font-family:var(--sans);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.wa *{box-sizing:border-box}
.wa-fx{position:absolute;inset:0;pointer-events:none}
.wa-vig{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 55%,rgba(0,0,0,0) 45%,rgba(4,6,5,.78) 100%)}
.wa-heat{position:absolute;inset:0;opacity:0;background:radial-gradient(130% 100% at 50% 50%,rgba(0,0,0,0) 55%,rgba(120,52,30,.34) 100%);transition:opacity .6s}
.wa-grain{position:absolute;left:-50%;top:-50%;width:200%;height:200%;opacity:.085;animation:wa-grain .9s steps(6) infinite;mix-blend-mode:screen}
@keyframes wa-grain{0%{transform:translate(0,0)}20%{transform:translate(-7%,4%)}40%{transform:translate(5%,-6%)}60%{transform:translate(-3%,7%)}80%{transform:translate(8%,2%)}100%{transform:translate(0,0)}}
.wa-scrim{position:absolute;left:50%;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(closest-side,rgba(6,8,7,.62),rgba(6,8,7,.38) 55%,rgba(6,8,7,0));transition:opacity .6s}
.wa-btn{pointer-events:auto;cursor:pointer;border:0;background:none;color:inherit;font:inherit;padding:0;margin:0;-webkit-appearance:none;appearance:none}
.wa-lab{font-family:var(--sans);font-weight:700;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
.wa-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:44px;transition:opacity .5s}
.wa-mark{font-family:var(--serif);font-size:17px;letter-spacing:.06em;color:var(--white);opacity:.92;white-space:nowrap}
.wa-mark i{font-style:normal;color:var(--green)}
.wa-icon{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:var(--dim);transition:color .2s,background .2s}
.wa-icon:hover{color:var(--white);background:rgba(233,226,207,.06)}
.wa-icon svg{width:20px;height:20px}
.wa-hud{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:6px;transition:opacity .5s,transform .5s}
.wa-time{font-family:var(--serif);font-variant-numeric:tabular-nums;line-height:1;color:var(--white);transition:color .6s;letter-spacing:.01em;text-shadow:0 2px 18px rgba(0,0,0,.6)}
.wa-time.warn{color:var(--warn)}.wa-time.urgent{color:var(--hot);animation:wa-pulse 1.25s ease-in-out infinite}.wa-time.critical{color:var(--hot);animation:wa-pulse .8s ease-in-out infinite}
@keyframes wa-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.045);opacity:.82}}
.wa-time .pen{position:absolute;margin-left:10px;font-family:var(--sans);font-weight:700;font-size:13px;color:var(--hot);opacity:0;transform:translateY(0)}
.wa-time .pen.on{animation:wa-pen 1.4s ease-out}
@keyframes wa-pen{0%{opacity:0;transform:translateY(4px)}15%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-12px)}}
.wa-drain{width:120px;height:1px;background:var(--faint);position:relative;overflow:hidden}
.wa-drain b{position:absolute;left:0;top:0;bottom:0;background:var(--white);transform-origin:left;opacity:.75}
.wa-level{display:flex;align-items:center;gap:10px;color:var(--dim);white-space:nowrap}
.wa-prog{display:flex;gap:4px}.wa-prog span{width:14px;height:2px;background:var(--faint);transition:background .5s}.wa-prog span.done{background:var(--green)}.wa-prog span.now{background:var(--white)}
.wa-stage{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;transition:opacity .45s}
.wa-kicker{color:var(--dim);margin-bottom:14px;transition:opacity .4s}
.wa-slots{display:flex;justify-content:center;pointer-events:auto;cursor:text;position:relative}
.wa-slot{position:relative;display:flex;align-items:flex-end;justify-content:center;font-family:var(--sans);font-weight:700;line-height:1;color:var(--white)}
.wa-slot>b{display:block;transform:translateY(0);transition:color .25s}
.wa-slot.give>b{color:var(--green)}
.wa-slot.give::before{content:'';position:absolute;left:8%;right:8%;bottom:-6px;height:2px;background:var(--muted);opacity:.55}
.wa-slot.mid::after{content:'';position:absolute;left:8%;right:8%;bottom:-6px;height:2px;background:var(--white);opacity:.34;transition:opacity .2s,background .2s}
.wa-slot.mid.cur::after{opacity:.95;animation:wa-caret 1.05s steps(1) infinite}
@keyframes wa-caret{50%{opacity:.3}}
.wa-slot.mid.fill::after{opacity:.55}
.wa-slot.in>b{animation:wa-in .16s cubic-bezier(.2,.9,.3,1.3)}
@keyframes wa-in{0%{transform:translateY(-22%) scale(.86);opacity:0}100%{transform:none;opacity:1}}
.wa-slots.shake{animation:wa-shake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes wa-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(5px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.wa-slots.wrong .wa-slot.mid::after{background:var(--hot);opacity:.9}
.wa-slots.wrong .wa-slot.mid>b{color:var(--hot)}
.wa-slots.nudge .wa-slot.mid:not(.fill)::after{animation:wa-blink .5s ease 2}
@keyframes wa-blink{50%{opacity:1;background:var(--warn)}}
.wa-slots.win .wa-slot>b{color:var(--green);text-shadow:0 0 18px rgba(161,197,142,.7),0 0 2px rgba(233,226,207,.9);animation:wa-lock .7s ease-out both}
.wa-slots.win .wa-slot::after,.wa-slots.win .wa-slot::before{opacity:0!important;transition:opacity .5s}
@keyframes wa-lock{0%{color:var(--white)}25%{color:#f3f8ec;transform:translateY(-4px)}100%{transform:none}}
.wa-slots.out{animation:wa-out .5s ease-in forwards}
@keyframes wa-out{to{opacity:0;transform:translateY(-14px);filter:blur(2px)}}
.wa-slots.enter .wa-slot{animation:wa-enter .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes wa-enter{from{opacity:0;transform:translateY(10px)}}
.wa-under{margin-top:22px;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:0 24px}
.wa-nudge{display:inline-flex;align-items:center;gap:10px;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--faint);color:var(--dim);background:rgba(8,11,9,.35);transition:color .2s,border-color .2s,opacity .3s}
.wa-nudge:hover:not(:disabled){color:var(--white);border-color:var(--dim)}
.wa-nudge em{font-style:normal;color:var(--hot);opacity:.9;letter-spacing:.08em}
.wa-nudge:disabled{opacity:.45;cursor:default}
.wa-clue{font-family:var(--serif);color:var(--white);opacity:0;transform:translateY(6px);transition:opacity .5s,transform .5s;max-width:520px;line-height:1.3;text-shadow:0 1px 12px rgba(0,0,0,.8)}
.wa-clue.on{opacity:.95;transform:none}
.wa-clue small{display:block;margin-bottom:6px;color:var(--muted)}
.wa-pop{position:absolute;pointer-events:none;text-align:center;opacity:0;white-space:nowrap}
.wa-pop.on{animation:wa-popa 1.9s ease-out}
.wa-pop b{display:block;font-family:var(--serif);font-size:26px;color:var(--green)}
.wa-pop span{color:var(--dim);font-size:10px}
@keyframes wa-popa{0%{opacity:0;transform:translateY(8px)}15%{opacity:1;transform:none}70%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}
.wa-foot{position:absolute;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;color:var(--dim);transition:opacity .5s}
.wa-foot .depth b{color:var(--white);font-variant-numeric:tabular-nums}
.wa-tap{color:var(--green);opacity:0;transition:opacity .3s}.wa-tap.on{opacity:.9}
.wa-input{position:absolute;opacity:0;width:1px;height:1px;font-size:16px;border:0;padding:0;margin:0;background:transparent;color:transparent;caret-color:transparent;pointer-events:none}
.wa-panel{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;opacity:0;visibility:hidden;transition:opacity .7s,visibility 0s .7s}
.wa-panel.on{opacity:1;visibility:visible;transition:opacity .7s}
.wa-panel .wa-btn{pointer-events:auto}
.wa-title .t-kick{color:var(--green);opacity:.85}
.wa-title .t-name{font-family:var(--serif);line-height:.92;letter-spacing:.02em;text-align:center;text-shadow:0 4px 30px rgba(0,0,0,.6)}
.wa-title .t-rule{width:36px;height:1px;background:var(--green);opacity:.7}
.wa-title .t-tag{font-family:var(--serif);color:var(--white);opacity:.86;text-align:center;line-height:1.35}
.wa-cta{height:52px;padding:0 30px;border-radius:26px;background:var(--white);color:#101311;font-weight:800;font-size:12px;letter-spacing:.24em;text-transform:uppercase;box-shadow:0 8px 40px rgba(0,0,0,.5);transition:transform .15s,background .2s}
.wa-cta:hover{background:#f6f0de}.wa-cta:active{transform:scale(.97)}
.wa-sec{height:40px;padding:0 18px;border-radius:20px;border:1px solid var(--faint);color:var(--white);font-weight:700;font-size:11px;letter-spacing:.2em;text-transform:uppercase;background:rgba(8,11,9,.4);transition:border-color .2s}
.wa-sec:hover{border-color:var(--dim)}
.wa-rules{display:grid;grid-template-columns:auto 1fr;gap:9px 14px;color:var(--dim);font-size:13px;line-height:1.35;max-width:320px}
.wa-rules b{color:var(--green);font-family:var(--serif);font-weight:400;font-size:15px;text-align:right}
.wa-title .t-low{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:16px}
.wa-title .t-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.wa-title .t-today{color:var(--dim);font-size:13px;text-align:center;line-height:1.5}
.wa-title .t-today b{color:var(--white)}
.wa-sheet{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;padding:0 16px;background:linear-gradient(rgba(8,11,9,0),rgba(8,11,9,.86) 22%,rgba(8,11,9,.96));}
.wa-sheet .s-in{width:100%;max-width:440px;display:flex;flex-direction:column;align-items:center;gap:14px}
.wa-sheet .s-kick{color:var(--green)}
.wa-sheet .s-head{font-family:var(--serif);text-align:center;line-height:1.08}
.wa-sheet .s-score{font-family:var(--serif);color:var(--green);line-height:1;font-variant-numeric:tabular-nums}
.wa-sheet .s-perf{color:var(--dim);font-size:13px;text-align:center;margin-top:-6px}
.wa-stats{display:flex;width:100%;border-top:1px solid var(--faint);border-bottom:1px solid var(--faint)}
.wa-stats div{flex:1;padding:10px 0;text-align:center;color:var(--dim)}
.wa-stats div+div{border-left:1px solid var(--faint)}
.wa-stats b{display:block;font-family:var(--serif);font-weight:400;font-size:20px;color:var(--white);letter-spacing:0;text-transform:none;margin-bottom:2px}
.wa-words{width:100%;display:flex;flex-direction:column;gap:2px}
.wa-words .w{display:flex;align-items:baseline;gap:12px;padding:5px 2px;font-size:14px}
.wa-words .w .n{color:var(--muted);font-size:10px;width:18px}
.wa-words .w .word{font-weight:700;letter-spacing:.14em;flex:1}
.wa-words .w .word small{font-weight:600;letter-spacing:.04em;color:var(--dim);margin-left:8px}
.wa-words .w .pts{color:var(--dim);font-variant-numeric:tabular-nums;font-size:12px}
.wa-words .w.miss .word{color:var(--dim)}
.wa-words .w.miss .pts{color:var(--hot);opacity:.8}
.wa-sheet .s-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.wa-note{color:var(--dim);font-size:11px;text-align:center;line-height:1.45;max-width:360px}
.wa-board .b-in{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px;align-items:center}
.wa-board .b-list{width:100%;display:flex;flex-direction:column}
.wa-board .b-list div{display:flex;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--faint);font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
.wa-board .b-list div b{color:var(--white);font-weight:700}
.wa-board .b-list div.me b{color:var(--green)}
.wa-board{background:rgba(8,11,9,.9);justify-content:center;padding:24px 16px}
.wa-toast{position:absolute;left:50%;transform:translate(-50%,10px);padding:10px 16px;border-radius:18px;background:rgba(233,226,207,.95);color:#101311;font-size:12px;font-weight:700;letter-spacing:.06em;opacity:0;transition:opacity .3s,transform .3s;pointer-events:none}
.wa-toast.on{opacity:1;transform:translate(-50%,0)}
.wa-boot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--dim);font-size:14px;line-height:1.5}
`;
const ICONS = {
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};
function grainURL() {
  const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'), im = g.createImageData(160, 160);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0); return c.toDataURL();
}
function buildUI(root) {
  const st = document.createElement('style'); st.textContent = UI_CSS; root.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || root).appendChild(e); return e; };
  const H = { el };
  H.fx = el('div', 'wa-fx'); H.vig = el('div', 'wa-vig', '', H.fx); H.heat = el('div', 'wa-heat', '', H.fx);
  H.grain = el('div', 'wa-grain', '', H.fx); H.grain.style.backgroundImage = `url(${grainURL()})`;
  H.scrim = el('div', 'wa-scrim'); H.scrim.style.opacity = 0;
  H.top = el('div', 'wa-top');
  H.mark = el('div', 'wa-mark', 'WORDS <i>APART</i>', H.top);
  H.mute = el('button', 'wa-btn wa-icon', ICONS.sound, H.top); H.mute.setAttribute('aria-label', 'Sound');
  H.hud = el('div', 'wa-hud');
  H.time = el('div', 'wa-time', '<span>1:15</span><span class="pen">−5s</span>', H.hud); H.timeT = H.time.firstChild; H.pen = H.time.lastChild;
  H.drain = el('div', 'wa-drain', '<b></b>', H.hud); H.drainB = H.drain.firstChild;
  H.level = el('div', 'wa-level wa-lab', '<span></span><div class="wa-prog"><span></span><span></span><span></span><span></span><span></span></div>', H.hud);
  H.levelT = H.level.firstChild; H.prog = [...H.level.querySelectorAll('.wa-prog span')];
  H.stage = el('div', 'wa-stage');
  H.kicker = el('div', 'wa-kicker wa-lab', 'Complete the word', H.stage);
  H.slots = el('div', 'wa-slots', '', H.stage);
  H.under = el('div', 'wa-under', '', H.stage);
  H.nudge = el('button', 'wa-btn wa-nudge wa-lab', 'Need a nudge? <em>−5s</em>', H.under);
  H.clue = el('div', 'wa-clue', '', H.under);
  H.pop = el('div', 'wa-pop', '<b></b><span class="wa-lab"></span>', H.stage);
  H.foot = el('div', 'wa-foot wa-lab', '<span class="depth">Depth <b>000</b> m</span><span class="wa-tap">Tap the letters to type</span><span class="guide">Type · Enter ↵ · ⌫</span>');
  H.depthB = H.foot.querySelector('b'); H.tap = H.foot.querySelector('.wa-tap'); H.guide = H.foot.querySelector('.guide');
  H.input = el('input', 'wa-input');
  for (const [k, v] of Object.entries({ type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'go', 'aria-label': 'Type the word' })) H.input.setAttribute(k, v);
  // title
  H.title = el('div', 'wa-panel wa-title');
  H.tHead = el('div', '', '', H.title); H.tHead.style.cssText = 'position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:14px';
  H.tKick = el('div', 't-kick wa-lab', '', H.tHead);
  H.tName = el('div', 't-name', 'WORDS<br>APART', H.tHead);
  el('div', 't-rule', '', H.tHead);
  H.tTag = el('div', 't-tag', 'Two letters. One word.<br>Five levels. One descent.', H.tHead);
  H.tLow = el('div', 't-low', '', H.title);
  H.rules = el('div', 'wa-rules', '<b>C·T</b><span>You get the first and last letter. Type the word.</span><b>75</b><span>Seconds for all five words, on one clock.</span><b>−5</b><span>Seconds for a nudge, if you need one.</span>', H.tLow);
  H.tToday = el('div', 't-today', '', H.tLow);
  H.begin = el('button', 'wa-btn wa-cta', 'Begin the descent', H.tLow);
  H.tRow = el('div', 't-row', '', H.tLow);
  H.tPractice = el('button', 'wa-btn wa-sec', 'Practice', H.tRow);
  H.tBoard = el('button', 'wa-btn wa-sec', 'Leaderboard', H.tRow);
  // results
  H.result = el('div', 'wa-panel');
  H.sheet = el('div', 'wa-sheet', '', H.result); const si = el('div', 's-in', '', H.sheet);
  H.sKick = el('div', 's-kick wa-lab', '', si); H.sHead = el('div', 's-head', '', si);
  H.sScore = el('div', 's-score', '', si); H.sPerf = el('div', 's-perf', '', si);
  H.sStats = el('div', 'wa-stats wa-lab', '', si); H.sWords = el('div', 'wa-words', '', si);
  const sr = el('div', 's-row', '', si);
  H.sShare = el('button', 'wa-btn wa-sec', 'Share', sr); H.sBoard = el('button', 'wa-btn wa-sec', 'Leaderboard', sr);
  H.sAgain = el('button', 'wa-btn wa-cta', 'Practice', si);
  H.sNote = el('div', 'wa-note', '', si); H.sMenu = el('button', 'wa-btn wa-lab', 'Back to the surface', si); H.sMenu.style.cssText = 'color:var(--dim);padding:8px';
  // leaderboard
  H.board = el('div', 'wa-panel wa-board');
  const bi = el('div', 'b-in', '', H.board);
  el('div', 'wa-lab', 'Leaderboard', bi).style.color = 'var(--green)';
  H.bHead = el('div', 's-head', '', bi); H.bHead.style.cssText = 'font-family:var(--serif);font-size:26px;text-align:center';
  H.bNote = el('div', 'wa-note', '', bi);
  H.bList = el('div', 'b-list', '', bi);
  H.bClose = el('button', 'wa-btn wa-sec', 'Close', bi);
  H.toast = el('div', 'wa-toast', '');
  return H;
}
