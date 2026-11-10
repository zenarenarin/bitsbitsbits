// DOM interface: GameHeader, GameControls, tap-rotate controls, CompletionScreen
// and the Collection. Purely presentational; every action calls back into main.

const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v4h4"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6" class="f"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></svg>',
  ccw: '<svg viewBox="0 0 24 24"><path d="M7.5 6.2A8 8 0 1 1 4 12"/><path d="M3.6 6.8 7.6 6l.8 4"/></svg>',
  cw: '<svg viewBox="0 0 24 24"><path d="M16.5 6.2A8 8 0 1 0 20 12"/><path d="M20.4 6.8 16.4 6l-.8 4"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  coll: '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3.5"/><path d="M7.5 8 12 3.5 16.5 8"/><path d="M5 12v7.5h14V12"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h13.5"/><path d="m13.5 7 5 5-5 5"/></svg>'
};

const HUD_CSS = `
.orb{position:absolute;inset:0;font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;pointer-events:none}
.orb *{box-sizing:border-box}
.orb button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.orb button:focus-visible{outline:1px solid var(--dim);outline-offset:3px;border-radius:999px}
.orb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;display:block}
.orb svg .f{fill:currentColor;stroke:none}
.orb .hdr{position:absolute;left:0;right:0;text-align:center;transition:opacity .5s}
.orb .brand{font-size:9.5px;letter-spacing:.42em;color:var(--dim);font-weight:500;padding-left:.42em}
.orb .title{font-size:30px;font-weight:300;letter-spacing:.52em;padding-left:.52em;white-space:nowrap;line-height:1;margin-top:9px;color:var(--ink);transition:letter-spacing .9s}
.orb .label{font-family:'Space Mono',ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.2em;color:var(--dim);margin-top:11px;text-transform:uppercase;white-space:nowrap}
.orb .tabs{display:flex;justify-content:center;gap:18px;margin-top:12px}
.orb .tab{font-size:10px;letter-spacing:.24em;padding:6px 2px 5px;color:var(--faint);border-bottom:1px solid transparent;text-transform:uppercase;transition:color .3s,border-color .3s}
.orb .tab.on{color:var(--ink);border-color:var(--faint)}
.orb .corner{position:absolute;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dim);transition:color .3s,opacity .3s}
.orb .corner:active{color:var(--ink)}
.orb .bottom{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center}
.orb .cap{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:19px;line-height:1.25;text-align:center;color:var(--ink);min-height:24px;padding:0 24px;transition:opacity .35s}
.orb .cap.small{font-family:'Space Grotesk',sans-serif;font-style:normal;font-size:12px;letter-spacing:.06em;color:var(--dim)}
.orb .stats{display:flex;justify-content:center;gap:0;margin-top:16px}
.orb .stat{width:96px;text-align:center}
.orb .stat+.stat{border-left:1px solid var(--rule)}
.orb .stat b{display:block;font-family:'Space Mono',ui-monospace,monospace;font-weight:400;font-size:17px;letter-spacing:.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.orb .stat i{display:block;font-style:normal;font-size:8.5px;letter-spacing:.26em;color:var(--faint);margin-top:5px;text-transform:uppercase;padding-left:.26em}
.orb .ctrls{display:flex;justify-content:center;gap:34px;margin-top:18px}
.orb .ctl{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:52px;min-height:48px;justify-content:center;color:var(--dim);transition:color .2s,opacity .3s}
.orb .ctl:active{color:var(--ink)}
.orb .ctl span{font-size:8.5px;letter-spacing:.24em;text-transform:uppercase;padding-left:.24em}
.orb .ctl.warn{color:var(--ink)}
.orb .ctl[disabled]{opacity:.32;pointer-events:none}
.orb .rot{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink);border:1px solid var(--rule);background:var(--glass);opacity:0;transform:scale(.86);transition:opacity .25s,transform .25s;pointer-events:none}
.orb .rot.on{opacity:1;transform:scale(1);pointer-events:auto}
.orb .rot:active{background:var(--rule)}
.orb .play{transition:opacity .45s}
.orb .done{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:none}
.orb .done.on{transition:opacity .8s,transform .8s}
.orb .done.on{opacity:1;transform:none}
.orb .done.on button{pointer-events:auto}
.orb .kick{font-size:8.5px;letter-spacing:.34em;color:var(--faint);text-transform:uppercase;padding-left:.34em}
.orb .tname{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:31px;line-height:1.05;margin-top:6px;text-align:center;padding:0 20px}
.orb .tdesc{font-size:11.5px;line-height:1.5;color:var(--dim);text-align:center;max-width:300px;margin-top:7px;padding:0 16px}
.orb .dstats{display:flex;justify-content:center;margin-top:14px}
.orb .dstats .stat{width:76px}
.orb .dstats .stat b{font-size:15px}
.orb .board3{font-family:'Space Mono',monospace;font-size:9px;line-height:1.6;letter-spacing:.06em;color:var(--dim);margin-top:9px;min-height:14px;text-align:center;padding:0 16px;white-space:pre-line;max-width:100%;max-height:30px;overflow:hidden}
.orb .acts{display:flex;justify-content:center;gap:8px;margin-top:12px;padding:0 12px;flex-wrap:nowrap}
.orb .act{height:42px;padding:0 14px;border-radius:999px;border:1px solid var(--rule);display:flex;align-items:center;gap:7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);white-space:nowrap}
.orb .act svg{width:16px;height:16px}
.orb .act.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.orb .act:active{opacity:.75}
.orb.compact .tdesc,.orb.compact .board3{display:none}
.orb.compact .tname{font-size:26px}
.orb.compact .cap{font-size:15px}
.orb.compact .cap.small{font-size:11px;letter-spacing:.03em}
.orb.compact .dstats{margin-top:8px}
.orb.compact .ctl{min-height:44px}
.orb .toast{position:absolute;left:50%;transform:translate(-50%,6px);font-size:11px;letter-spacing:.06em;color:var(--ink);background:var(--glass);border:1px solid var(--rule);padding:8px 14px;border-radius:999px;opacity:0;transition:opacity .3s,transform .3s;white-space:nowrap}
.orb .toast.on{opacity:1;transform:translate(-50%,0)}
.orbm{position:absolute;inset:0;background:var(--scrim);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;color:var(--ink);opacity:0;transition:opacity .35s;pointer-events:none;overflow:hidden;-webkit-user-select:none;user-select:none}
.orbm.on{opacity:1;pointer-events:auto}
.orbm button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.orbm svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;display:block}
.orbm .mh{position:absolute;left:0;right:0;text-align:center}
.orbm .mh .kick{font-size:9px;letter-spacing:.36em;color:var(--dim);text-transform:uppercase;padding-left:.36em}
.orbm .mh h2{margin:8px 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:28px}
.orbm .mh p{margin:6px 0 0;font-size:11px;color:var(--dim);letter-spacing:.04em}
.orbm .x{position:absolute;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dim)}
.orbm .grid{position:absolute;left:0;right:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:18px 12px;padding:8px 20px 28px;touch-action:pan-y}
.orbm .card{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.orbm .card canvas,.orbm .card .ph{width:96px;height:96px;border-radius:50%;display:block}
.orbm .card .ph{border:1px dashed var(--rule);display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:26px;color:var(--faint)}
.orbm .card b{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:15px;line-height:1.1}
.orbm .card i{font-style:normal;font-family:'Space Mono',monospace;font-size:8.5px;letter-spacing:.14em;color:var(--faint);text-transform:uppercase}
.orbm .det{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 24px}
.orbm .det canvas{border-radius:50%}
.orbm .det h3{margin:16px 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:30px}
.orbm .det .meta{font-family:'Space Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--faint);margin-top:6px;text-transform:uppercase}
.orbm .det p{font-size:12px;line-height:1.55;color:var(--dim);max-width:320px;margin:10px 0 0}
.orbm .det .acts{display:flex;gap:10px;margin-top:18px}
.orbm .act{height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--rule);display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.2em;text-transform:uppercase}
.orbm .act.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.orbm .empty{position:absolute;left:0;right:0;text-align:center;font-size:12px;color:var(--dim);padding:0 32px;line-height:1.6}
`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function createHud(ctx, H) {
  const root = ctx.createRoot({ className: 'orb', layer: 'overlay', input: 'passthrough' });
  const style = el('style'); style.textContent = HUD_CSS; root.appendChild(style);

  // GameHeader
  const hdr = el('div', 'hdr');
  const brand = el('div', 'brand', 'PLETHORA');
  const title = el('div', 'title', 'ORBIT');
  const label = el('div', 'label', 'DAILY PUZZLE');
  const tabs = el('div', 'tabs');
  const tDaily = el('button', 'tab on', 'Daily'); const tStudy = el('button', 'tab', 'Studies');
  tDaily.type = tStudy.type = 'button';
  tabs.appendChild(tDaily); tabs.appendChild(tStudy);
  hdr.appendChild(brand); hdr.appendChild(title); hdr.appendChild(label); hdr.appendChild(tabs);
  root.appendChild(hdr);

  const bColl = el('button', 'corner', ICONS.coll); bColl.setAttribute('aria-label', 'Collection');
  const bMute = el('button', 'corner', ICONS.sound); bMute.setAttribute('aria-label', 'Sound');
  root.appendChild(bColl); root.appendChild(bMute);

  // Play-state bottom block: caption, stats, GameControls
  const play = el('div', 'bottom play');
  const cap = el('div', 'cap small', '');
  const stats = el('div', 'stats');
  const sMoves = el('div', 'stat', '<b>0</b><i>Moves</i>');
  const sTime = el('div', 'stat', '<b>0:00</b><i>Time</i>');
  const sAl = el('div', 'stat', '<b>0/4</b><i>Aligned</i>');
  stats.appendChild(sMoves); stats.appendChild(sTime); stats.appendChild(sAl);
  const ctrls = el('div', 'ctrls');
  const bUndo = el('button', 'ctl', ICONS.undo + '<span>Undo</span>');
  const bReset = el('button', 'ctl', ICONS.reset + '<span>Restart</span>');
  const bHint = el('button', 'ctl', ICONS.hint + '<span>Hint</span>');
  [bUndo, bReset, bHint].forEach(b => { b.type = 'button'; ctrls.appendChild(b); });
  play.appendChild(cap); play.appendChild(stats); play.appendChild(ctrls);
  root.appendChild(play);

  // Tap rotation controls (appear only while a ring is selected)
  const rotL = el('button', 'rot', ICONS.ccw); rotL.setAttribute('aria-label', 'Rotate anticlockwise');
  const rotR = el('button', 'rot', ICONS.cw); rotR.setAttribute('aria-label', 'Rotate clockwise');
  rotL.type = rotR.type = 'button';
  root.appendChild(rotL); root.appendChild(rotR);

  // CompletionScreen
  const done = el('div', 'done');
  const dKick = el('div', 'kick', 'Discovered');
  const dName = el('div', 'tname', '');
  const dDesc = el('div', 'tdesc', '');
  const dStats = el('div', 'stats dstats');
  const dB = el('div', 'board3', '');
  const acts = el('div', 'acts');
  const aShare = el('button', 'act', ICONS.share + '<span>Share</span>');
  const aColl = el('button', 'act', ICONS.coll + '<span>Collection</span>');
  const aNext = el('button', 'act pri', '<span>Next study</span>' + ICONS.next);
  [aShare, aColl, aNext].forEach(b => { b.type = 'button'; acts.appendChild(b); });
  done.appendChild(dKick); done.appendChild(dName); done.appendChild(dDesc); done.appendChild(dStats); done.appendChild(dB); done.appendChild(acts);
  root.appendChild(done);

  const toast = el('div', 'toast', ''); root.appendChild(toast);

  // Collection modal
  const modal = ctx.createRoot({ className: 'orbm', layer: 'modal', input: 'passthrough' });
  modal.setAttribute('aria-hidden', 'true');

  const act = (b, fn) => ctx.input.activate(b, e => { if (e && e.preventDefault) e.preventDefault(); fn(); });
  act(tDaily, () => H.onMode('daily'));
  act(tStudy, () => H.onMode('study'));
  act(bColl, () => H.onCollection());
  act(bMute, () => H.onMute());
  act(bUndo, () => H.onUndo());
  act(bReset, () => H.onReset());
  act(bHint, () => H.onHint());
  act(rotL, () => H.onRotate(-1));
  act(rotR, () => H.onRotate(1));
  act(aShare, () => H.onShare());
  act(aColl, () => H.onCollection());
  act(aNext, () => H.onNext());

  const U = { root, modal, layout: null };

  U.applyTheme = function (theme) {
    const ink = theme.ink, light = theme.bg.light;
    const s = root.style, m = modal.style;
    const vars = {
      '--ink': ink.css,
      '--dim': rgba(ink, light ? 0.72 : 0.66),
      '--faint': rgba(ink, light ? 0.55 : 0.46),
      '--rule': rgba(ink, light ? 0.2 : 0.16),
      '--glass': rgba(theme.bg.base, 0.55),
      '--bg': theme.bg.base.css,
      '--scrim': rgba(theme.bg.deep, light ? 0.78 : 0.72)
    };
    Object.keys(vars).forEach(k => { s.setProperty(k, vars[k]); m.setProperty(k, vars[k]); });
  };

  // Lay everything out from the content safe area and the board geometry.
  U.setLayout = function (L) {
    U.layout = L;
    hdr.style.top = L.headerTop + 'px';
    hdr.style.left = L.colX + 'px'; hdr.style.width = L.colW + 'px';
    bColl.style.left = (L.area.left + 8) + 'px'; bColl.style.top = (L.area.top + 4) + 'px';
    bMute.style.right = (L.area.right + 8) + 'px'; bMute.style.top = (L.area.top + 4) + 'px';
    play.style.top = L.bottomTop + 'px'; play.style.left = L.colX + 'px'; play.style.width = L.colW + 'px';
    done.style.top = (L.doneTop) + 'px'; done.style.left = L.colX + 'px'; done.style.width = L.colW + 'px';
    const off = L.R * 0.98;
    rotL.style.left = (L.cx - off) + 'px'; rotL.style.top = (L.cy + off) + 'px';
    rotR.style.left = (L.cx + off) + 'px'; rotR.style.top = (L.cy + off) + 'px';
    toast.style.top = (L.cy - L.R * 1.22 - 14) + 'px';
    toast.style.left = (L.cx) + 'px';
    const compact = L.compact;
    root.classList.toggle('compact', !!compact);
    title.style.fontSize = compact ? '24px' : '30px';
    tabs.style.marginTop = compact ? '8px' : '12px';
    stats.style.marginTop = compact ? '10px' : '16px';
    ctrls.style.marginTop = compact ? '8px' : '18px';
  };

  U.setHeader = function (mode, text, complete) {
    tDaily.classList.toggle('on', mode === 'daily');
    tStudy.classList.toggle('on', mode === 'study');
    label.textContent = text;
    title.textContent = complete ? 'COMPLETE' : 'ORBIT';
    title.style.letterSpacing = title.style.paddingLeft = complete ? '.3em' : '';
    brand.textContent = complete ? 'ORBIT' : 'PLETHORA';
    tabs.style.visibility = mode === 'gallery' ? 'hidden' : '';
  };
  U.setStats = function (moves, timeMs, aligned, total) {
    sMoves.firstChild.textContent = String(moves);
    sTime.firstChild.textContent = fmtTime(timeMs);
    sAl.firstChild.textContent = aligned + '/' + total;
  };
  U.setTime = function (ms) { sTime.firstChild.textContent = fmtTime(ms); };
  U.setCaption = function (text, serif) {
    cap.textContent = text;
    cap.classList.toggle('small', !serif);
  };
  U.setControls = function (canUndo, playing) {
    bUndo.disabled = !canUndo || !playing;
    bReset.disabled = !playing;
    bHint.disabled = !playing;
  };
  let resetArmed = 0;
  U.armReset = function (on) {
    resetArmed = on;
    bReset.classList.toggle('warn', !!on);
    bReset.querySelector('span').textContent = on ? 'Confirm' : 'Restart';
  };
  U.resetArmed = () => resetArmed;
  U.setMuted = function (m) { bMute.innerHTML = m ? ICONS.mute : ICONS.sound; bMute.setAttribute('aria-label', m ? 'Sound off' : 'Sound on'); };
  U.showRotate = function (on) { rotL.classList.toggle('on', !!on); rotR.classList.toggle('on', !!on); };
  U.showPlay = function (on) { play.style.opacity = on ? '1' : '0'; play.style.pointerEvents = 'none'; [bUndo, bReset, bHint].forEach(b => { b.style.visibility = on ? '' : 'hidden'; }); };
  U.showDone = function (d) {
    if (!d) { done.classList.remove('on'); done.setAttribute('aria-hidden', 'true'); return; }
    dKick.textContent = d.kicker;
    dName.textContent = d.name;
    dDesc.textContent = d.desc;
    dStats.innerHTML = '';
    d.stats.forEach(s => { const e = el('div', 'stat'); e.innerHTML = '<b></b><i></i>'; e.firstChild.textContent = s[1]; e.lastChild.textContent = s[0]; dStats.appendChild(e); });
    dB.textContent = d.board || '';
    aNext.querySelector('span').textContent = d.nextLabel;
    aShare.style.display = d.canShare ? '' : 'none';
    done.classList.add('on');
    done.removeAttribute('aria-hidden');
  };
  U.setBoardLine = function (t) { dB.textContent = t || ''; };
  let toastSeq = 0;
  U.toast = function (text, ms) {
    toast.textContent = text;
    toast.classList.add('on');
    const s = ++toastSeq;
    ctx.timeout(() => { if (s === toastSeq) toast.classList.remove('on'); }, ms || 2200);
  };

  // ---- Collection ------------------------------------------------------------
  let modalOpen = false, thumbQueue = [], mtoken = 0;
  U.isModalOpen = () => modalOpen;
  U.closeModal = function () {
    modalOpen = false; mtoken++;
    modal.classList.remove('on');
    modal.setAttribute('aria-hidden', 'true');
    ctx.timeout(() => { if (!modalOpen) modal.innerHTML = ''; }, 400);
  };
  function header(kick, h, p) {
    const L = U.layout;
    const mh = el('div', 'mh');
    mh.style.top = (L.area.top + 10) + 'px';
    const k = el('div', 'kick'); k.textContent = kick; mh.appendChild(k);
    const t = el('h2'); t.textContent = h; mh.appendChild(t);
    if (p) { const pp = el('p'); pp.textContent = p; mh.appendChild(pp); }
    modal.appendChild(mh);
    const x = el('button', 'x', ICONS.close); x.setAttribute('aria-label', 'Close');
    x.style.top = (L.area.top + 4) + 'px'; x.style.right = (L.area.right + 8) + 'px';
    ctx.input.activate(x, () => H.onCloseModal());
    ctx.surface.enableInput(x);
    modal.appendChild(x);
  }
  // items: [{ key, title, sub, ringCount, theme() }] newest first; next: { title, sub }
  U.openCollection = function (items, next) {
    const L = U.layout;
    modal.innerHTML = '';
    modalOpen = true; const tok = ++mtoken;
    header('Your collection', items.length + (items.length === 1 ? ' visual universe' : ' visual universes'), 'Every solved puzzle keeps its artwork.');
    const grid = el('div', 'grid');
    grid.style.top = (L.area.top + 110) + 'px';
    grid.style.bottom = (L.H - (L.H - L.area.bottom)) + 'px';
    grid.style.bottom = L.area.bottom + 'px';
    ctx.surface.enableInput(grid);
    if (next) {
      const c = el('div', 'card');
      c.innerHTML = '<div class="ph">?</div><b></b><i></i>';
      c.querySelector('b').textContent = next.title; c.querySelector('i').textContent = next.sub;
      grid.appendChild(c);
    }
    thumbQueue = [];
    items.forEach(it => {
      const c = el('button', 'card');
      c.type = 'button';
      const holder = el('div', 'ph', '');
      holder.style.borderStyle = 'solid';
      c.appendChild(holder);
      const b = el('b'); b.textContent = it.title; c.appendChild(b);
      const i = el('i'); i.textContent = it.sub; c.appendChild(i);
      ctx.input.activate(c, () => H.onCollectionItem(it));
      grid.appendChild(c);
      thumbQueue.push({ holder, it });
    });
    modal.appendChild(grid);
    if (!items.length) {
      const e = el('div', 'empty'); e.style.top = (L.area.top + 150) + 'px';
      e.textContent = 'Solve a puzzle to collect its visual universe. Each one is new.';
      modal.appendChild(e);
    }
    modal.classList.add('on'); modal.removeAttribute('aria-hidden');
    // Render thumbnails a few at a time so opening stays smooth.
    const pr = Math.min(2, ctx.nativeDpr || ctx.dpr || 1);
    const pump = () => {
      if (tok !== mtoken || !modalOpen) return;
      for (let n = 0; n < 3 && thumbQueue.length; n++) {
        const q = thumbQueue.shift();
        try {
          const cv = renderThumbnail(q.it.theme(), q.it.ringCount, 96, pr);
          cv.style.width = cv.style.height = '96px';
          q.holder.replaceWith(cv);
        } catch (e) { }
      }
      if (thumbQueue.length) ctx.timeout(pump, 16);
    };
    ctx.timeout(pump, 30);
  };
  U.openDetail = function (it) {
    const L = U.layout;
    modal.innerHTML = '';
    modalOpen = true; mtoken++;
    header('Collection', '', '');
    const det = el('div', 'det');
    const size = Math.min(L.W - 64, L.H - L.area.top - L.area.bottom - 300, 300);
    det.style.top = (L.area.top + 64) + 'px';
    const theme = it.theme();
    const pr = Math.min(3, ctx.nativeDpr || ctx.dpr || 1);
    const cv = renderThumbnail(theme, it.ringCount, size, pr);
    cv.style.width = cv.style.height = size + 'px';
    det.appendChild(cv);
    const h = el('h3'); h.textContent = theme.name; det.appendChild(h);
    const meta = el('div', 'meta'); meta.textContent = it.sub + ' · ' + theme.universeTitle; det.appendChild(meta);
    const p = el('p'); p.textContent = theme.description + (it.stat ? ' ' + it.stat : ''); det.appendChild(p);
    const acts2 = el('div', 'acts');
    const back = el('button', 'act', '<span>All</span>');
    const view = el('button', 'act pri', '<span>View on board</span>');
    ctx.input.activate(back, () => H.onCollection());
    ctx.input.activate(view, () => H.onGallery(it));
    ctx.surface.enableInput(back); ctx.surface.enableInput(view);
    acts2.appendChild(back); acts2.appendChild(view);
    det.appendChild(acts2);
    modal.appendChild(det);
    modal.classList.add('on');
  };
  return U;
}
