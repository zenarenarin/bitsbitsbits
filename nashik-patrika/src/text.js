/*
 * text.js — builds the patrika's typography from content/copy.js.
 * Words go in exactly as supplied; hierarchy comes from size, space and line
 * structure only. Devanagari is never letter-spaced.
 */
(function () {
  const C = window.PATRIKA_COPY;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  // "चि. सौ. कां. वदन्या" → honorific set smaller, the name itself larger
  const nameLine = (full) => {
    const d = el('div', 'name');
    const i = full.lastIndexOf(' ');
    if (i > 0) d.append(el('span', 'hon', full.slice(0, i)), document.createTextNode(' '), el('span', 'nm', full.slice(i + 1)));
    else d.append(el('span', 'nm', full));
    return d;
  };
  const lines = (cls, arr) => {
    const d = el('div', cls);
    arr.forEach((l) => d.append(typeof l === 'string' ? el('div', '', l) : el('div', l.em ? 'em' : '', l.text)));
    return d;
  };

  // fine gold flourishes: a hairline that thickens toward a small lozenge
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (w, h, inner, cls) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', w); s.setAttribute('height', h);
    s.setAttribute('class', cls);
    s.innerHTML = inner;
    return s;
  };
  const flourish = (side) => svg(118, 20, `<g ${side === 'r' ? 'transform="translate(118,0) scale(-1,1)"' : ''} fill="none" stroke="currentColor">
      <path d="M2 10 C 30 10, 60 10, 92 10" stroke-width="0.9"/>
      <path d="M62 10 C 70 6, 78 6, 84 10 C 78 14, 70 14, 62 10 Z" stroke-width="0.8"/>
      <path d="M100 10 l5 -5 l5 5 l-5 5 z" fill="currentColor" stroke="none"/>
      <circle cx="94" cy="10" r="1.4" fill="currentColor" stroke="none"/></g>`, 'fl');
  const rule = () => svg(300, 16, `<g fill="none" stroke="currentColor">
      <path d="M10 8 H 136 M164 8 H 290" stroke-width="0.8"/>
      <path d="M150 2 l6 6 l-6 6 l-6 -6 z" fill="currentColor" stroke="none"/>
      <circle cx="138" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="162" cy="8" r="1.4" fill="currentColor" stroke="none"/></g>`, 'rule');

  window.buildPatrika = function (root) {
    const page = el('section', 'patrika');
    page.lang = 'mr';

    const main = el('div', 'main');
    const inv = el('div', 'inv');
    C.invocations.forEach((s) => inv.append(el('span', '', s)));
    main.append(inv);
    main.append(lines('opening', [].concat(C.opening)));
    const couple = el('div', 'couple');
    for (const [p, cls] of [[C.groom, 'groom'], [null, 'and'], [C.bride, 'bride']]) {
      if (!p) { couple.append(el('div', 'and', C.conjunction)); continue; }
      const d = el('div', 'person ' + cls);
      d.append(nameLine(p.name), lines('parents', p.parents));
      couple.append(d);
    }
    main.append(couple);
    main.append(el('div', 'closing', C.closing));
    const title = el('div', 'title');
    title.append(flourish('l'), el('span', '', C.occasion), flourish('r'));
    main.append(title);
    main.append(lines('invitation', C.invitation));
    main.append(rule());

    const foot = el('div', 'foot');
    const so = el('div', 'signoff');
    so.append(el('div', 'h', C.signoff.heading));
    const names = el('div', 'names');
    if (C.signoff.names && C.signoff.names.length) {
      for (const row of C.signoff.names) {
        if (Array.isArray(row)) { const r = el('div', 'pair'); row.forEach((n) => r.append(el('span', '', n))); names.append(r); }
        else names.append(el('div', 'single', row));
      }
    } else {
      names.classList.add('reserved');
      for (const k of C.signoff.placeholderShape) {
        const r = el('div', k === 'pair' ? 'pair' : 'single');
        if (k === 'pair') r.append(el('span', 'bar'), el('span', 'bar'));
        else r.append(el('span', 'bar wide'));
        names.append(r);
      }
    }
    so.append(names);
    const ve = el('div', 'venue');
    ve.append(el('div', 'h', C.venue.heading), lines('addr', C.venue.lines));
    foot.append(so, rule(), ve);
    main.append(foot);
    page.append(main);
    root.append(page);
    return page;
  };
})();
