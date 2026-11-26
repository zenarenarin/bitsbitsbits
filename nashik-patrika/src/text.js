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

  window.buildPatrika = function (root) {
    const page = el('section', 'patrika');
    page.lang = 'mr';

    const main = el('div', 'main');
    const inv = el('div', 'inv');
    C.invocations.forEach((s) => inv.append(el('span', '', s)));
    main.append(inv);
    main.append(el('div', 'opening', C.opening));
    const couple = el('div', 'couple');
    for (const [p, cls] of [[C.groom, 'groom'], [null, 'and'], [C.bride, 'bride']]) {
      if (!p) { couple.append(el('div', 'and', C.conjunction)); continue; }
      const d = el('div', 'person ' + cls);
      d.append(nameLine(p.name), lines('parents', p.parents));
      couple.append(d);
    }
    main.append(couple);
    const occ = el('div', 'occasion');
    occ.append(el('div', 'closing', C.closing), el('div', 'title', C.occasion));
    main.append(occ);
    main.append(lines('muhurta', C.muhurta));
    main.append(lines('request', C.request));

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
    foot.append(so, ve);

    page.append(main, foot);
    root.append(page);
    return page;
  };
})();
