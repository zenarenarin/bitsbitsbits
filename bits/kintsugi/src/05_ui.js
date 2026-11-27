// The interface: as little as possible, set in Cormorant and Inter, laid out
// inside the content safe area. Everything else is the object.
function makeUI(ctx, handlers) {
  const root = ctx.createRoot({ className: 'kg-root', layer: 'overlay', order: 5, input: 'passthrough' });
  const css = `
  .kg-root{font-family:'KG Inter',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#ebe4d6;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
  .kg-safe{position:absolute;inset:0;padding:var(--plethora-content-safe-top,0px) var(--plethora-content-safe-right,0px) var(--plethora-content-safe-bottom,120px) var(--plethora-content-safe-left,0px);pointer-events:none}
  .kg-in{position:relative;width:100%;height:100%}
  .kg-top{position:absolute;left:20px;right:12px;top:14px;display:flex;align-items:flex-start;justify-content:space-between}
  .kg-lv{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:rgba(235,228,214,.46);line-height:44px;transition:opacity .8s}
  .kg-lv b{font-weight:400;color:rgba(235,228,214,.78)}
  .kg-right{display:flex;align-items:center;gap:6px}
  .kg-drop{width:44px;height:44px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .9s}
  .kg-drop.on{opacity:1}
  .kg-drop.low svg{animation:kgpulse 1.6s ease-in-out infinite}
  @keyframes kgpulse{0%,100%{opacity:1}50%{opacity:.45}}
  .kg-btn{pointer-events:none;appearance:none;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;margin:0;outline:none}
  .kg-top .kg-btn,.kg-veil.on .kg-btn,.kg-res.on .kg-btn{pointer-events:auto}
  .kg-btn:focus-visible{outline:1px solid rgba(235,228,214,.5);outline-offset:3px}
  .kg-icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;opacity:.62;transition:opacity .3s}
  .kg-icon:active{opacity:1}
  .kg-title{position:absolute;left:0;right:0;bottom:22px;text-align:center;opacity:0;transition:opacity 1.1s ease;pointer-events:none}
  .kg-title.on{opacity:1}
  .kg-title .n{font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:rgba(235,228,214,.42);margin-bottom:8px}
  .kg-title .t{font-family:'KG Cormorant',Georgia,serif;font-style:italic;font-weight:300;font-size:30px;letter-spacing:.01em;color:rgba(240,233,220,.9)}
  .kg-res{position:absolute;left:0;right:0;bottom:10px;display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(8px);transition:opacity 1.2s ease,transform 1.4s cubic-bezier(.2,.7,.2,1);pointer-events:none}
  .kg-res.on{opacity:1;transform:none}
  .kg-res.on .kg-row{pointer-events:auto}
  .kg-grade{font-family:'KG Cormorant',Georgia,serif;font-style:italic;font-weight:300;font-size:40px;line-height:1;color:#f2ead9}
  .kg-score{margin-top:12px;font-size:11px;letter-spacing:.28em;color:rgba(235,228,214,.62);font-variant-numeric:tabular-nums}
  .kg-meta{margin-top:7px;font-size:10px;letter-spacing:.16em;color:rgba(235,228,214,.38);min-height:14px;font-variant-numeric:tabular-nums;text-transform:uppercase}
  .kg-row{display:flex;gap:12px;margin-top:22px}
  .kg-act{min-width:112px;height:44px;padding:0 18px;border:1px solid rgba(235,228,214,.22);border-radius:2px;font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:rgba(240,233,220,.9);transition:border-color .3s,background .3s}
  .kg-act:active{background:rgba(235,228,214,.06)}
  .kg-act.pri{border-color:rgba(214,170,92,.55)}
  .kg-veil{position:absolute;inset:0;background:rgba(6,6,6,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .4s;pointer-events:none}
  .kg-veil.on{opacity:1;pointer-events:auto}
  .kg-menu{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
  .kg-mi{height:48px;min-width:200px;font-family:'KG Cormorant',Georgia,serif;font-style:italic;font-weight:300;font-size:24px;color:rgba(240,233,220,.88)}
  .kg-mi.small{font-family:'KG Inter',sans-serif;font-style:normal;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(235,228,214,.5);height:44px}
  .kg-col{display:flex;flex-direction:column;gap:2px;width:min(320px,82%)}
  .kg-ci{display:flex;align-items:baseline;justify-content:space-between;height:46px;border-bottom:1px solid rgba(235,228,214,.08);padding:0 4px;text-align:left}
  .kg-ci .a{font-size:10px;letter-spacing:.2em;color:rgba(235,228,214,.4);width:30px;font-variant-numeric:tabular-nums}
  .kg-ci .b{flex:1;font-family:'KG Cormorant',Georgia,serif;font-style:italic;font-size:21px;font-weight:300;color:rgba(240,233,220,.9)}
  .kg-ci .c{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(214,170,92,.85)}
  .kg-ci[disabled]{opacity:.28;pointer-events:none}
  .kg-note{position:absolute;left:0;right:0;top:50%;text-align:center;font-size:11px;letter-spacing:.2em;color:rgba(235,228,214,.5);text-transform:uppercase}
  `;
  root.innerHTML = `<style>${css}</style>
  <div class="kg-safe"><div class="kg-in">
    <div class="kg-top">
      <div class="kg-lv"><b class="kg-lvn">01</b>&nbsp;&nbsp;/&nbsp;&nbsp;08</div>
      <div class="kg-right">
        <div class="kg-drop" aria-hidden="true"><svg width="14" height="20" viewBox="0 0 14 20">
          <defs><linearGradient id="kgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d58e"/><stop offset=".5" stop-color="#c8963f"/><stop offset="1" stop-color="#7d5520"/></linearGradient>
          <clipPath id="kgc"><rect class="kg-lvl" x="0" y="0" width="14" height="20"/></clipPath></defs>
          <path d="M7 1.2 C7 1.2 1.6 8.4 1.6 12.6 A5.4 5.4 0 0 0 12.4 12.6 C12.4 8.4 7 1.2 7 1.2 Z" fill="none" stroke="rgba(214,170,92,.55)" stroke-width=".8"/>
          <path clip-path="url(#kgc)" d="M7 1.2 C7 1.2 1.6 8.4 1.6 12.6 A5.4 5.4 0 0 0 12.4 12.6 C12.4 8.4 7 1.2 7 1.2 Z" fill="url(#kgg)"/>
        </svg></div>
        <button class="kg-btn kg-icon kg-pause" aria-label="Pause"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="1.2" height="10" fill="#ebe4d6"/><rect x="9.8" y="2" width="1.2" height="10" fill="#ebe4d6"/></svg></button>
      </div>
    </div>
    <div class="kg-title"><div class="n"></div><div class="t"></div></div>
    <div class="kg-res">
      <div class="kg-grade"></div>
      <div class="kg-score"></div>
      <div class="kg-meta"></div>
      <div class="kg-row"><button class="kg-btn kg-act kg-again">Again</button><button class="kg-btn kg-act pri kg-next">Next</button></div>
    </div>
  </div></div>
  <div class="kg-veil kg-pausev"><div class="kg-menu">
    <button class="kg-btn kg-mi kg-resume">Resume</button>
    <button class="kg-btn kg-mi kg-restart">Begin again</button>
    <button class="kg-btn kg-mi kg-colbtn">Collection</button>
    <button class="kg-btn kg-mi small kg-sound">Sound on</button>
  </div></div>
  <div class="kg-veil kg-colv"><div class="kg-menu"><div class="kg-col"></div><button class="kg-btn kg-mi small kg-colback">Close</button></div></div>
  <div class="kg-note" style="display:none"></div>`;
  const q = s => root.querySelector(s);
  const el = {
    lv: q('.kg-lv'), lvn: q('.kg-lvn'), drop: q('.kg-drop'), lvl: q('.kg-lvl'), pause: q('.kg-pause'),
    title: q('.kg-title'), tn: q('.kg-title .n'), tt: q('.kg-title .t'),
    res: q('.kg-res'), grade: q('.kg-grade'), score: q('.kg-score'), meta: q('.kg-meta'), again: q('.kg-again'), next: q('.kg-next'),
    pv: q('.kg-pausev'), resume: q('.kg-resume'), restart: q('.kg-restart'), colbtn: q('.kg-colbtn'), sound: q('.kg-sound'),
    cv: q('.kg-colv'), col: q('.kg-col'), colback: q('.kg-colback'), note: q('.kg-note')
  };
  const act = (node, fn) => ctx.input.activate(node, e => { if (e && e.preventDefault) e.preventDefault(); fn(); });
  act(el.pause, () => handlers.pause());
  act(el.resume, () => handlers.resume());
  act(el.restart, () => handlers.restart());
  act(el.colbtn, () => handlers.collection());
  act(el.sound, () => handlers.sound());
  act(el.again, () => handlers.again());
  act(el.next, () => handlers.next());
  act(el.colback, () => handlers.closeCollection());
  ctx.input.delegate(el.col, '.kg-ci', 'click', (e) => { const t = e.delegateTarget || (e.event && e.event.target && e.event.target.closest('.kg-ci')); if (t && !t.disabled) handlers.pick(+t.dataset.i); });
  const roman = n => String(n).padStart(2, '0');
  let goldShown = false, lastGold = -1;
  return {
    root,
    level(i, total) { el.lvn.textContent = roman(i + 1); el.lv.lastChild.textContent = '  /  ' + roman(total); },
    title(no, name, on) { if (no != null) { el.tn.textContent = 'No. ' + no; el.tt.textContent = name; } el.title.classList.toggle('on', !!on); },
    gold(frac, on) {
      if (on !== goldShown) { goldShown = on; el.drop.classList.toggle('on', on); }
      const f = Math.round(clamp01(frac) * 200) / 200;
      if (f !== lastGold) {
        lastGold = f;
        // the drop body spans y 1.2..18; fill from the bottom
        const top = 18 - 16.8 * f;
        el.lvl.setAttribute('y', top.toFixed(2)); el.lvl.setAttribute('height', (20 - top).toFixed(2));
        el.drop.classList.toggle('low', on && f < 0.18);
      }
    },
    chrome(on) { el.lv.style.opacity = on ? '1' : '0'; },
    results(r) {
      el.grade.textContent = r.grade;
      el.score.textContent = String(r.score);
      el.meta.textContent = r.meta || '';
      el.next.textContent = r.nextLabel || 'Next';
      el.res.classList.add('on');
    },
    meta(text) { el.meta.textContent = text || ''; },
    hideResults() { el.res.classList.remove('on'); },
    pauseMenu(on, soundOn) { el.sound.textContent = soundOn ? 'Sound on' : 'Sound off'; el.pv.classList.toggle('on', on); },
    sound(soundOn) { el.sound.textContent = soundOn ? 'Sound on' : 'Sound off'; },
    collection(on, rows) {
      if (rows) el.col.innerHTML = rows.map((r, i) => `<button class="kg-btn kg-ci" data-i="${i}" ${r.locked ? 'disabled' : ''}><span class="a">${roman(i + 1)}</span><span class="b">${r.name}</span><span class="c">${r.grade || ''}</span></button>`).join('');
      el.cv.classList.toggle('on', on);
    },
    note(text) { el.note.style.display = text ? 'block' : 'none'; el.note.textContent = text || ''; }
  };
}
