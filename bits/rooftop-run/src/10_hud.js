// =====================================================================
// HUD and the lab panel. DOM only; the game wires callbacks in.
// Type: system UI stack. 11 px tracked labels, 14 px body, 28 px numerals.
// Grid: 16 px gutter (plus safe area), 8 px rhythm. Chalk on soot.
// =====================================================================

const HUD_CSS = `
.rr{position:absolute;inset:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#f3ece2;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px}
.rr *{box-sizing:border-box}
.rr-lab{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.rr-top{position:absolute;left:var(--g);right:var(--g);top:0;display:flex;justify-content:space-between;align-items:flex-start}
.rr-num{font-size:28px;font-weight:300;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 1px 10px rgba(20,14,12,.5)}
.rr-num small{font-size:11px;font-weight:700;letter-spacing:.16em;margin-left:4px;opacity:.8}
.rr-sub{margin-top:6px;opacity:.8;text-shadow:0 1px 6px rgba(20,14,12,.6)}
.rr-icons{display:flex;gap:8px}
.rr-ib{pointer-events:auto;height:40px;min-width:40px;padding:0 12px;border-radius:20px;border:1.5px solid rgba(243,236,226,.55);background:rgba(30,24,22,.28);color:#f3ece2;display:flex;align-items:center;justify-content:center;font:700 11px system-ui,sans-serif;letter-spacing:.14em;touch-action:none;cursor:pointer}
.rr-ib.on{background:#f3ece2;color:#231c19}
.rr-stick{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:1.5px solid rgba(243,236,226,.4);background:rgba(30,24,22,.12);display:none}
.rr-stick b{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(243,236,226,.38)}
.rr-jump{position:absolute;border-radius:50%;border:1.5px solid rgba(243,236,226,.6);background:rgba(30,24,22,.25);display:flex;align-items:center;justify-content:center;transition:transform .06s,background .06s}
.rr-jump.down{transform:scale(.92);background:rgba(243,236,226,.3)}
.rr-jump svg{width:42%;height:42%}
.rr-zone{position:absolute;top:0;bottom:0;right:0;border-left:1px dashed rgba(243,236,226,.0);transition:border-color .4s}
.rr-zone.hint{border-left-color:rgba(243,236,226,.28)}
.rr-hint{position:absolute;bottom:0;font-size:11px;font-weight:700;letter-spacing:.16em;opacity:0;transition:opacity .5s;text-shadow:0 1px 8px rgba(20,14,12,.7)}
.rr-hint.on{opacity:.85}
.rr-fade{position:absolute;inset:0;background:#e4d4bd;opacity:0;transition:opacity .18s}
.rr-card{position:absolute;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:380px;border-radius:12px;padding:16px;background:rgba(32,26,24,.8);border:1px solid rgba(243,236,226,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto;display:none;text-align:center}
.rr-card.on{display:block}
.rr-title{font-size:36px;font-weight:800;letter-spacing:.12em;line-height:1}
.rr-p{font-size:14px;line-height:1.5;opacity:.85;margin:8px 0}
.rr-b{display:block;width:100%;border:0;border-radius:10px;padding:14px;margin-top:8px;font:800 13px system-ui,sans-serif;letter-spacing:.18em;color:#231c19;background:#f3ece2;cursor:pointer}
.rr-b.sec{background:transparent;color:#f3ece2;border:1px solid rgba(243,236,226,.4)}
.rr-panel{position:absolute;top:0;right:0;bottom:0;width:min(320px,86vw);background:rgba(26,21,19,.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-left:1px solid rgba(243,236,226,.14);pointer-events:auto;overflow-y:auto;padding:16px;transform:translateX(105%);transition:transform .2s;touch-action:pan-y}
.rr-panel.on{transform:none}
.rr-panel h3{margin:16px 0 8px;font-size:11px;letter-spacing:.16em;opacity:.6}
.rr-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;font-size:13px}
.rr-row input{width:52%;accent-color:#f3ece2}
.rr-row output{width:44px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;font-size:12px}
.rr-seg{display:flex;gap:4px}
.rr-seg button{border:1px solid rgba(243,236,226,.35);background:transparent;color:#f3ece2;border-radius:8px;padding:6px 8px;font:700 10px system-ui,sans-serif;letter-spacing:.12em;cursor:pointer}
.rr-seg button.on{background:#f3ece2;color:#231c19}
.rr-dbg{position:absolute;left:var(--g);font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre;background:rgba(20,16,14,.55);padding:8px;border-radius:8px;display:none}
.rr-dbg.on{display:block}
`;

function createHud(ctx) {
  const ui = ctx.createRoot({ className: 'rr', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = HUD_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const H = {};
  H.zone = el('div', 'rr-zone');
  H.fade = el('div', 'rr-fade');
  H.top = el('div', 'rr-top');
  const tl = el('div', '', '', H.top);
  H.dist = el('div', 'rr-num', '0<small>M</small>', tl);
  H.sub = el('div', 'rr-sub rr-lab', 'Movement lab', tl);
  const icons = el('div', 'rr-icons', '', H.top);
  H.labBtn = el('div', 'rr-ib', 'LAB', icons);
  H.pauseBtn = el('div', 'rr-ib', '<svg viewBox="-10 -10 20 20" width="14" height="14"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>', icons);
  H.dbg = el('div', 'rr-dbg');
  H.stick = el('div', 'rr-stick', '<b></b>'); H.knob = H.stick.firstChild;
  H.jump = el('div', 'rr-jump', '<svg viewBox="-10 -10 20 20"><path d="M-7,4L0,-4L7,4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  H.hintL = el('div', 'rr-hint', 'DRAG TO STEER'); H.hintR = el('div', 'rr-hint', 'TAP · HOLD TO JUMP HIGHER');
  // cards
  H.start = el('div', 'rr-card on');
  el('div', 'rr-title', 'ROOFTOP<br>RUN', H.start);
  H.startText = el('div', 'rr-p', '', H.start);
  H.go = el('button', 'rr-b', 'RUN', H.start);
  H.retry = el('button', 'rr-b sec', 'RETRY', H.start); H.retry.style.display = 'none';
  H.pause = el('div', 'rr-card');
  el('div', 'rr-p', 'Paused', H.pause);
  H.resume = el('button', 'rr-b', 'RESUME', H.pause);
  H.restart = el('button', 'rr-b sec', 'RESTART LAB', H.pause);
  H.panel = el('div', 'rr-panel');

  const touchy = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  H.startText.innerHTML = touchy
    ? 'The cat runs by itself.<br><b>Left thumb</b>: drag to steer. <b>Right thumb</b>: tap to jump, hold to jump higher.'
    : 'The cat runs by itself.<br><b>A / D</b> or <b>← →</b> steer. <b>Space</b> jumps; hold it to jump higher.';

  const api = {
    root: ui, H, touchy,
    stickShow(x, y) { H.stick.style.display = 'block'; H.stick.style.left = x + 'px'; H.stick.style.top = y + 'px'; H.knob.style.transform = ''; },
    stickMove(ox, oy, dx, dy) { H.stick.style.left = ox + 'px'; H.stick.style.top = oy + 'px'; H.knob.style.transform = `translate(${dx}px,${dy}px)`; },
    stickHide() { H.stick.style.display = 'none'; },
    jumpDown(on) { H.jump.classList.toggle('down', on); },
    setPlay(on) { for (const e of [H.top, H.jump]) e.style.display = on ? '' : 'none'; if (!on) H.stick.style.display = 'none'; },
    hints(on) { H.hintL.classList.toggle('on', on); H.hintR.classList.toggle('on', on); H.zone.classList.toggle('hint', on); },
    card(which) { for (const [k, e] of [['start', H.start], ['pause', H.pause]]) e.classList.toggle('on', k === which); },
    fade(v) { H.fade.style.opacity = v; },
    distance(m, lap) { const s = m + '<small>M</small>'; if (api._d !== s) { api._d = s; H.dist.innerHTML = s; } const t = lap > 1 ? 'Movement lab · lap ' + lap : 'Movement lab'; if (api._l !== t) { api._l = t; H.sub.textContent = t; } },
    debug(text) { if (api._dbg !== text) { api._dbg = text; H.dbg.textContent = text; } },
    // area: ctx.contentSafeArea ?? ctx.safeArea (clears the island, home bar and Plethora's logo)
    layout(w, h, area) {
      const top = area.top || 0, bot = area.bottom || 0, right = area.right || 0, left = area.left || 0;
      const portrait = h > w;
      H.top.style.paddingTop = (12 + top) + 'px';
      H.top.style.left = (16 + left) + 'px'; H.top.style.right = (16 + right) + 'px';
      H.dbg.style.top = (top + 80) + 'px'; H.dbg.style.left = (16 + left) + 'px';
      const js = Math.round(clamp(Math.min(w, h) * 0.22, 72, 96));
      Object.assign(H.jump.style, { width: js + 'px', height: js + 'px', right: (24 + right) + 'px', bottom: (bot + (portrait ? 16 : 12)) + 'px' });
      H.zone.style.width = (w * TUNING.input.jumpZone) + 'px';
      H.hintL.style.left = (24 + left) + 'px'; H.hintL.style.bottom = (bot + 16) + 'px';
      H.hintR.style.right = (24 + right) + 'px'; H.hintR.style.bottom = (bot + (portrait ? 16 : 12) + js + 12) + 'px';
      H.panel.style.paddingTop = (16 + top) + 'px'; H.panel.style.paddingBottom = (16 + bot) + 'px'; H.panel.style.paddingRight = (16 + right) + 'px';
      for (const c of [H.start, H.pause]) { c.style.bottom = 'auto'; c.style.top = (top + (h - top - bot) * (portrait ? 0.42 : 0.5)) + 'px'; c.style.transform = 'translate(-50%,-50%)'; c.style.maxHeight = (h - top - bot - 16) + 'px'; c.style.overflowY = 'auto'; }
    }
  };

  // ---- lab panel: live tuning ----
  const SLIDERS = [
    ['Movement'],
    ['cat.cruise', 'Run speed', 3, 10, 0.1], ['cat.accel', 'Acceleration', 2, 20, 0.5], ['cat.lateral', 'Steer speed', 2, 8, 0.1], ['cat.lateralAccel', 'Steer response', 6, 50, 1],
    ['Jump'],
    ['cat.jumpVel', 'Jump strength', 5, 10, 0.1], ['cat.gravity', 'Gravity', 12, 40, 0.5], ['cat.fallMul', 'Fall speed-up', 1, 2.5, 0.05], ['cat.jumpMinHold', 'Tap rise (s)', 0, 0.3, 0.01],
    ['cat.coyote', 'Coyote (s)', 0, 0.3, 0.01], ['cat.buffer', 'Buffer (s)', 0, 0.3, 0.01], ['cat.jumpForward', 'Pounce boost', 0, 3, 0.1],
    ['Assistance'],
    ['assist.lateralReach', 'Air nudge reach', 0, 1, 0.05], ['assist.alignReach', 'Ledge line-up reach', 0, 1, 0.05], ['cat.edgeGrip', 'Edge grip (s)', 0, 0.6, 0.02], ['assist.scrambleDrop', 'Scramble reach', 0, 0.7, 0.02],
    ['Camera (landscape)'],
    ['camera.landscape.back', 'Distance', 2.5, 9, 0.1], ['camera.landscape.up', 'Height', 0.8, 5, 0.05], ['camera.landscape.fov', 'Field of view', 40, 80, 1], ['camera.landscape.lookAhead', 'Look ahead', 2, 12, 0.5],
    ['Camera (portrait)'],
    ['camera.portrait.back', 'Distance', 2.5, 10, 0.1], ['camera.portrait.up', 'Height', 0.8, 6, 0.05], ['camera.portrait.fov', 'Field of view', 40, 90, 1], ['camera.portrait.lookAhead', 'Look ahead', 2, 12, 0.5],
    ['Touch'],
    ['input.stickRadius', 'Stick radius (px)', 30, 90, 1], ['input.stickCurve', 'Stick curve', 1, 2.5, 0.05]
  ];
  const get = p => p.split('.').reduce((o, k) => o[k], TUNING);
  const set = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], TUNING)[last] = v; };
  const seg = (label, opts, cur, fn) => {
    const r = el('div', 'rr-row', `<span>${label}</span>`, H.panel), box = el('div', 'rr-seg', '', r);
    const bs = opts.map(([v, t]) => { const b = el('button', v === cur() ? 'on' : '', t, box); ctx.listen(b, 'click', e => { e.stopPropagation(); fn(v); bs.forEach(x => x.classList.toggle('on', x === b)); }); return b; });
  };
  api.buildPanel = (handlers) => {
    H.panel.innerHTML = '';
    el('h3', 'rr-lab', 'Lab', H.panel).style.marginTop = '0';
    seg('Jump input', [['hold', 'HOLD'], ['tap', 'TAP']], () => TUNING.input.jumpMode, v => { TUNING.input.jumpMode = v; });
    seg('Assistance', [[true, 'ON'], [false, 'OFF']], () => TUNING.assist.enabled, v => { TUNING.assist.enabled = v; });
    seg('Scramble', [[true, 'ON'], [false, 'OFF']], () => TUNING.assist.scramble, v => { TUNING.assist.scramble = v; });
    seg('Camera', [['auto', 'AUTO'], ['landscape', 'LAND'], ['portrait', 'PORT']], handlers.camPreset, handlers.setCamPreset);
    seg('Shadows', [[true, 'ON'], [false, 'OFF']], handlers.shadows, handlers.setShadows);
    seg('Readout', [[true, 'ON'], [false, 'OFF']], () => H.dbg.classList.contains('on'), v => H.dbg.classList.toggle('on', v));
    for (const s of SLIDERS) {
      if (s.length === 1) { el('h3', 'rr-lab', s[0], H.panel); continue; }
      const [path, label, lo, hi, step] = s;
      const r = el('div', 'rr-row', `<span>${label}</span>`, H.panel);
      const inp = el('input', '', undefined, r); Object.assign(inp, { type: 'range', min: lo, max: hi, step, value: get(path) });
      const out = el('output', '', String(get(path)), r);
      ctx.listen(inp, 'input', () => { set(path, +inp.value); out.textContent = inp.value; if (path === 'input.stickRadius') handlers.relayout(); });
    }
    const reset = el('button', 'rr-b sec', 'RESTART LAB', H.panel);
    ctx.listen(reset, 'click', e => { e.stopPropagation(); handlers.restart(); });
    const dump = el('button', 'rr-b sec', 'COPY TUNING', H.panel);
    ctx.listen(dump, 'click', e => { e.stopPropagation(); const t = JSON.stringify(TUNING, null, 1); try { navigator.clipboard.writeText(t); dump.textContent = 'COPIED'; } catch (er) { console.log(t); dump.textContent = 'LOGGED TO CONSOLE'; } });
  };
  api.panel = on => { H.panel.classList.toggle('on', on); H.labBtn.classList.toggle('on', on); };
  api.panelOpen = () => H.panel.classList.contains('on');
  return api;
}
