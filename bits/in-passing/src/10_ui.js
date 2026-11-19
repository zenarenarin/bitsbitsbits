// ---------------------------------------------------------------------------
// Interface: field notes, a postal ledger, a receipt. Small serif titles,
// tracked small-caps labels, paper and ink. The world stays the main thing.
// ---------------------------------------------------------------------------

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function fmtTime(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const UI_CSS = `
.ip{position:absolute;inset:0;pointer-events:none;font-family:'Inter',system-ui,sans-serif;color:#22403f;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.ip *{box-sizing:border-box}
.ip .serif{font-family:'Cormorant Garamond',Georgia,serif}
.ip .lbl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.72}
.ip button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}
.ip .safe{position:absolute;left:0;right:0;top:0;bottom:0;padding:0 18px}
.ip .fade{transition:opacity .45s ease, transform .45s ease}
.ip .hidden{opacity:0;pointer-events:none!important}
.ip .hidden *{pointer-events:none!important}
.ip .shadowtxt{text-shadow:0 1px 0 rgba(255,250,238,.65),0 0 14px rgba(255,248,232,.7)}
.ip .icon{width:40px;height:40px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:rgba(250,244,230,.55);box-shadow:0 1px 0 rgba(34,64,63,.12)}
.ip .icon svg{width:20px;height:20px;stroke:#22403f;fill:none;stroke-width:1.6;stroke-linecap:round}
/* menu */
.ip .title{position:absolute;left:18px;right:70px}
.ip .title h1{margin:0;font-weight:300;font-style:italic;font-size:46px;line-height:.95;letter-spacing:-.01em}
.ip .title p{margin:8px 0 0;font-size:12px;line-height:1.45;max-width:260px;opacity:.8}
.ip .ledger{position:absolute;left:14px;right:14px;background:#f5eddb;border-radius:3px;padding:14px 16px 14px;box-shadow:0 10px 30px rgba(40,50,48,.18),0 1px 0 rgba(34,64,63,.15);pointer-events:auto}
.ip .ledger:before{content:'';position:absolute;inset:5px;border:1px solid rgba(34,64,63,.14);border-radius:2px;pointer-events:none}
.ip .tabs{display:flex;gap:18px;margin-bottom:10px}
.ip .tab{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.45;padding:6px 0}
.ip .tab.on{opacity:1;border-bottom:1.5px solid #d9785f}
.ip .sel{display:flex;align-items:center;gap:8px}
.ip .arrow{width:40px;height:52px;display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.7}
.ip .arrow[disabled]{opacity:.15}
.ip .routeinfo{flex:1;min-width:0;text-align:center}
.ip .num{font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:300;line-height:1}
.ip .region{margin-top:4px}
.ip .to{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ip .stamps{display:flex;justify-content:center;gap:10px;margin:12px 0 4px}
.ip .stamp{width:54px;height:40px;border:1.5px dashed rgba(34,64,63,.3);border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;opacity:.5}
.ip .stamp b{font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;letter-spacing:0;font-weight:400;text-transform:none}
.ip .stamp.got{opacity:1;border-color:#d9785f;color:#b55a44;background:rgba(217,120,95,.08);transform:rotate(-3deg)}
.ip .best{text-align:center;font-size:11px;opacity:.7;margin-top:6px;min-height:14px}
.ip .go{display:block;text-align:center;margin-top:10px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;animation:ipbreath 2.6s ease-in-out infinite}
@keyframes ipbreath{0%,100%{opacity:.55}50%{opacity:1}}
.ip .sealed{color:#b55a44}
/* hud */
.ip .hud{position:absolute;left:18px;right:70px}
.ip .hud .rt{font-size:10px}
.ip .hud .rto{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ip .journey{margin-top:8px;display:flex;align-items:center;gap:10px}
.ip .journey svg{overflow:visible}
.ip .env{display:flex;gap:4px}
.ip .env i{display:block;width:13px;height:9px;border:1.3px solid rgba(34,64,63,.55);border-radius:1px;position:relative}
.ip .env i:after{content:'';position:absolute;left:1px;right:1px;top:0;height:5px;border-bottom:1.2px solid rgba(34,64,63,.5);transform:skewY(0);clip-path:polygon(0 0,50% 100%,100% 0)}
.ip .env i.got{background:#e4b84e;border-color:#9a7a2a}
.ip .topright{position:absolute;right:14px;display:flex;gap:8px}
/* hint */
.ip .hint{position:absolute;transform:translate(-50%,-100%);font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;white-space:nowrap;padding:3px 10px;background:rgba(245,237,219,.78);border-radius:2px;box-shadow:0 1px 0 rgba(34,64,63,.15)}
/* cards */
.ip .veil{position:absolute;inset:0;background:rgba(238,228,207,.35);pointer-events:auto}
.ip .card{position:absolute;left:50%;width:min(330px,calc(100% - 32px));transform:translate(-50%,0);background:#f5eddb;border-radius:3px;padding:20px 20px 16px;box-shadow:0 14px 40px rgba(40,50,48,.25);pointer-events:auto}
.ip .card:before{content:'';position:absolute;inset:6px;border:1px solid rgba(34,64,63,.14);pointer-events:none}
.ip .card h2{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-style:italic;font-size:36px;line-height:1}
.ip .btns{display:flex;flex-direction:column;gap:2px;margin-top:14px}
.ip .btn{display:flex;align-items:center;justify-content:space-between;min-height:46px;padding:0 4px;border-top:1px solid rgba(34,64,63,.12);font-size:15px}
.ip .btn:after{content:'→';opacity:.4}
.ip .btn.primary{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-style:italic}
.ip .btn.primary:after{color:#d9785f;opacity:1}
.ip .rows{margin-top:14px}
.ip .row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px dotted rgba(34,64,63,.18);font-size:13px}
.ip .row span:last-child{font-variant-numeric:tabular-nums}
.ip .bigtime{font-family:'Cormorant Garamond',Georgia,serif;font-size:54px;font-weight:300;line-height:1;margin-top:10px}
.ip .delivered{position:absolute;right:18px;top:14px;transform:rotate(9deg);border:2px solid #c9634c;color:#c9634c;border-radius:50%;width:84px;height:84px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;line-height:1.3;opacity:.85}
.ip .delivered.brisk{border-style:double;border-width:4px}
.ip .board{margin-top:10px;font-size:12px}
.ip .board .row{font-size:12px}
.ip .note{font-size:11px;opacity:.6;margin-top:6px}
.ip .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#eee4cf}
.ip .loading h1{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-style:italic;font-size:44px}
.ip .loading p{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;margin-top:12px}
`;

const ICONS = {
  pause: '<svg viewBox="0 0 20 20"><path d="M7 5v10M13 5v10"/></svg>',
  sound: '<svg viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="M14 7.5c1 1.4 1 3.6 0 5"/></svg>',
  mute: '<svg viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="M14 8l3 4M17 8l-3 4"/></svg>'
};

function createUI(ctx, h) {
  const root = ctx.createRoot({ className: 'ip', layer: 'overlay', input: 'passthrough' });
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  root.appendChild(style);
  const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; root.appendChild(d); return d; };

  const loading = el('loading', '<h1>In Passing</h1><p>painting the world</p>');
  const menu = el('safe fade hidden');
  menu.innerHTML = `
    <div class="title shadowtxt"><h1>In Passing</h1><p>A courier's errands through a world that never stops moving. You don't make anything move. You know when to get on.</p></div>
    <div class="ledger">
      <div class="tabs"><button class="tab on" data-a="journey">Journey</button><button class="tab" data-a="daily">Today's errand</button></div>
      <div class="sel">
        <button class="arrow" data-a="prev" aria-label="Previous route">‹</button>
        <div class="routeinfo"><div class="num"></div><div class="lbl region"></div><div class="to"></div></div>
        <button class="arrow" data-a="next" aria-label="Next route">›</button>
      </div>
      <div class="stamps"></div>
      <div class="best"></div>
      <button class="go" data-a="start">touch the world to set off</button>
    </div>`;
  const hud = el('safe fade hidden');
  hud.innerHTML = `<div class="hud shadowtxt"><div class="lbl rt"></div><div class="rto"></div>
    <div class="journey"><svg width="132" height="14" viewBox="0 0 132 14"><path class="jl" d="M2 7 Q 33 3 66 7 T 124 7" stroke="#22403f" stroke-opacity=".35" stroke-width="1.2" fill="none" stroke-dasharray="2 3"/><path class="jd" d="M2 7 Q 33 3 66 7 T 124 7" stroke="#22403f" stroke-width="1.6" fill="none"/><g class="house"><path d="M121 3 l4 -3 l4 3 v5 h-8z" fill="#f5eddb" stroke="#22403f" stroke-width="1"/><path d="M122 8 l-1.5 5 M128 8 l1.5 5" stroke="#22403f" stroke-width="1"/></g><circle class="me" cx="2" cy="7" r="3.2" fill="#d9785f" stroke="#f5eddb" stroke-width="1"/></svg><div class="env"></div></div></div>`;
  const topright = el('topright');
  topright.innerHTML = `<button class="icon" data-a="sound" aria-label="Sound">${ICONS.sound}</button><button class="icon" data-a="pause" aria-label="Pause">${ICONS.pause}</button>`;
  const hint = el('hint hidden fade');
  const pauseVeil = el('veil hidden fade');
  const pauseCard = el('card hidden fade');
  pauseCard.innerHTML = `<h2>A pause.</h2><div class="note">The world waits for you, just this once.</div><div class="btns"><button class="btn primary" data-a="resume">Carry on</button><button class="btn" data-a="restart">Start the route again</button><button class="btn" data-a="ledger">Back to the ledger</button></div>`;
  const resVeil = el('veil hidden fade');
  const resCard = el('card hidden fade');

  const jd = hud.querySelector('.jd'), me = hud.querySelector('.me'), jl = hud.querySelector('.jl');
  let jlLen = 0;

  // all buttons by delegation
  ctx.listen(root, 'click', e => {
    const b = e.target.closest && e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    const a = b.getAttribute('data-a');
    if (h[a]) h[a](b);
  });

  const show = (n, on) => { n.classList.toggle('hidden', !on); };
  const ui = {};
  ui.layout = area => {
    const top = area.top + 12, bottom = area.bottom + 10;
    menu.querySelector('.title').style.top = (top + 4) + 'px';
    menu.querySelector('.ledger').style.bottom = bottom + 'px';
    hud.querySelector('.hud').style.top = (top + 4) + 'px';
    topright.style.top = (top) + 'px';
    pauseCard.style.top = Math.max(top + 40, 0.28 * ctx.height) + 'px';
    resCard.style.top = Math.max(top + 30, 0.16 * ctx.height) + 'px';
  };
  ui.loaded = () => { loading.style.transition = 'opacity .6s'; loading.style.opacity = '0'; ctx.timeout(() => { loading.style.display = 'none'; }, 650); };
  ui.loadError = msg => { loading.querySelector('p').textContent = msg; };
  ui.setMuted = m => { topright.querySelector('[data-a=sound]').innerHTML = m ? ICONS.mute : ICONS.sound; };

  ui.showMenu = s => {
    show(menu, true); show(hud, false);
    topright.querySelector('[data-a=pause]').style.display = 'none';
    if (s && s.index != null) ui.menuState(s);
  };
  ui.menuState = s => {
    const tabs = menu.querySelectorAll('.tab');
    tabs[0].classList.toggle('on', !s.daily); tabs[1].classList.toggle('on', s.daily);
    const prev = menu.querySelector('[data-a=prev]'), next = menu.querySelector('[data-a=next]');
    prev.style.visibility = next.style.visibility = s.daily ? 'hidden' : 'visible';
    prev.disabled = s.index <= 0; next.disabled = s.index >= 11;
    const num = menu.querySelector('.num'), region = menu.querySelector('.region'), to = menu.querySelector('.to');
    const stamps = menu.querySelector('.stamps'), best = menu.querySelector('.best'), go = menu.querySelector('.go');
    if (s.daily) {
      num.textContent = s.dateLabel; region.textContent = 'Today’s errand';
      to.textContent = 'one route for everyone, today';
      stamps.innerHTML = '';
      best.textContent = s.dailyBest != null ? 'your best today ' + fmtTime(s.dailyBest) : (s.preparing ? 'the errand is being written…' : 'no delivery yet today');
      go.textContent = s.preparing ? 'one moment…' : 'touch the world to set off';
      go.classList.remove('sealed');
    } else {
      const r = s.route;
      num.textContent = NUMERALS[s.index];
      region.textContent = REGIONS[ROUTES[s.index].region].name;
      to.textContent = 'to ' + ROUTES[s.index].to;
      const rec = s.rec || {};
      const letters = s.letterCount || 0;
      const lc = rec.letters ? rec.letters.filter(Boolean).length : 0;
      stamps.innerHTML = `<div class="stamp ${rec.best != null ? 'got' : ''}"><b>✓</b>delivered</div><div class="stamp ${rec.brisk ? 'got' : ''}"><b>↗</b>brisk</div>` +
        (letters ? `<div class="stamp ${lc >= letters ? 'got' : ''}"><b>${lc}/${letters}</b>letters</div>` : '');
      if (s.locked) { best.textContent = 'sealed — deliver route ' + NUMERALS[s.index - 1] + ' first'; go.textContent = 'not yet'; go.classList.add('sealed'); }
      else { best.textContent = rec.best != null ? 'best ' + fmtTime(rec.best) + '  ·  brisk under ' + fmtTime(r.brisk * 1000) : 'brisk under ' + fmtTime(r.brisk * 1000); go.textContent = 'touch the world to set off'; go.classList.remove('sealed'); }
    }
  };
  ui.hideMenu = () => { show(menu, false); };

  ui.showHUD = (spec, letterCount) => {
    show(hud, true);
    topright.querySelector('[data-a=pause]').style.display = '';
    hud.querySelector('.rt').textContent = spec.daily ? 'Today’s errand' : NUMERALS[spec.index] + '  ·  ' + REGIONS[spec.region].name;
    hud.querySelector('.rto').textContent = 'to ' + spec.to;
    const env = hud.querySelector('.env');
    env.innerHTML = '';
    for (let i = 0; i < letterCount; i++) env.appendChild(document.createElement('i'));
    jlLen = jl.getTotalLength ? jl.getTotalLength() : 124;
    jd.style.strokeDasharray = jlLen + ' ' + jlLen;
    ui.progress(0);
  };
  ui.progress = f => {
    f = clamp(f, 0, 1);
    jd.style.strokeDashoffset = String(jlLen * (1 - f));
    if (jl.getPointAtLength) { const pt = jl.getPointAtLength(jlLen * f); me.setAttribute('cx', pt.x); me.setAttribute('cy', pt.y); }
  };
  ui.letter = i => { const e = hud.querySelectorAll('.env i')[i]; if (e) e.classList.add('got'); };
  ui.hideHUD = () => show(hud, false);

  ui.hint = (text, x, y) => {
    if (!text) { show(hint, false); return; }
    hint.textContent = text; hint.style.left = clamp(x, 90, ctx.width - 90) + 'px'; hint.style.top = Math.max(80, y) + 'px';
    show(hint, true);
  };

  ui.showPause = on => { show(pauseVeil, on); show(pauseCard, on); };

  ui.showResults = d => {
    const lettersHtml = d.letterCount ? `<div class="row"><span>Lost letters found</span><span>${d.letters} of ${d.letterCount}</span></div>` : '';
    resCard.innerHTML = `
      <div class="delivered ${d.brisk ? 'brisk' : ''}">${d.brisk ? 'Brisk<br>post' : 'De&shy;livered'}</div>
      <div class="lbl">${esc(d.label)}</div>
      <h2 style="margin-top:6px">Delivered.</h2>
      <div class="note serif" style="font-size:15px;font-style:italic;opacity:.8">to ${esc(d.to)}</div>
      <div class="bigtime">${fmtTime(d.ms)}</div>
      <div class="rows">
        ${d.best != null ? `<div class="row"><span>${d.newBest ? 'A new best' : 'Your best'}</span><span>${fmtTime(d.best)}</span></div>` : ''}
        ${d.briskMs ? `<div class="row"><span>Brisk post</span><span>under ${fmtTime(d.briskMs)}</span></div>` : ''}
        ${lettersHtml}
        <div class="row"><span>Longest passage without waiting</span><span>${d.passage} ${d.passage === 1 ? 'ride' : 'rides'}</span></div>
        <div class="row"><span>Spent waiting</span><span>${(d.waited / 1000).toFixed(1)}s</span></div>
        ${d.falls ? `<div class="row"><span>Umbrella landings</span><span>${d.falls}</span></div>` : ''}
      </div>
      <div class="board"></div>
      <div class="btns">
        <button class="btn primary" data-a="again">Run it again</button>
        ${d.nextOk ? '<button class="btn" data-a="nextRoute">The next route</button>' : ''}
        <button class="btn" data-a="ledger">Back to the ledger</button>
      </div>`;
    show(resVeil, true); show(resCard, true);
    show(hud, false);
  };
  ui.board = (state) => {
    const b = resCard.querySelector('.board');
    if (!b) return;
    if (!state) { b.innerHTML = ''; return; }
    if (state.loading) { b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div><div class="note">posting your time…</div>'; return; }
    if (state.error) { b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div><div class="note">The board couldn’t be reached just now. Your run still counts here.</div>'; return; }
    const rows = (state.rows || []).slice(0, 3).map(r => `<div class="row"><span>${r.rank}. ${esc(r.name || 'a courier')}</span><span>${fmtTime(r.value)}</span></div>`).join('');
    const mine = state.rank ? `<div class="note">You are ${state.rank}${state.total ? ' of ' + state.total : ''} today.</div>` : '';
    b.innerHTML = '<div class="lbl" style="margin-top:4px">Today’s board</div>' + (rows || '<div class="note">No times yet today.</div>') + mine;
  };
  ui.hideResults = () => { show(resVeil, false); show(resCard, false); };
  return ui;
}
