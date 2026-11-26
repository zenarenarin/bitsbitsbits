/*
 * text.js — builds the two typographic pages from content/copy.js.
 * Words are inserted exactly as supplied; only line structure and size
 * carry hierarchy. Devanagari is never letter-spaced (it would break the
 * shirorekha).
 */
(function () {
  const C = window.PATRIKA_COPY;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  // "चि. सौ. कां. वदन्या" → honorific set smaller, name set large
  const nameLine = (full) => {
    const d = el('div', 'name');
    const i = full.lastIndexOf(' ');
    if (i > 0) {
      d.append(el('span', 'hon', full.slice(0, i)), document.createTextNode(' '), el('span', 'nm', full.slice(i + 1)));
    } else d.append(el('span', 'nm', full));
    return d;
  };

  window.buildPages = function (root) {
    const p1 = C.page1, p2 = C.page2;

    // ---------------------------------------------------------- page 1
    const a = el('section', 'page page1');
    a.lang = 'mr';
    const inv = el('div', 'inv');
    p1.invocations.forEach((s, i) => inv.append(el('span', i === 1 ? 'inv-c' : '', s)));
    a.append(inv);
    a.append(el('div', 'opening', p1.opening));
    const couple = el('div', 'couple');
    const person = (o, cls) => {
      const d = el('div', 'person ' + cls);
      d.append(nameLine(o.name));
      const pr = el('div', 'parents');
      o.parents.forEach((l) => pr.append(el('div', '', l)));
      d.append(pr);
      return d;
    };
    couple.append(person(p1.groom, 'groom'), el('div', 'and', p1.conjunction), person(p1.bride, 'bride'));
    a.append(couple);
    a.append(el('div', 'closing', p1.closing));
    a.append(el('div', 'occasion', p1.occasion));

    // ---------------------------------------------------------- page 2
    const b = el('section', 'page page2');
    b.lang = 'mr';
    const mu = el('div', 'muhurta');
    p2.muhurta.forEach((l) => mu.append(el('div', l.em ? 'em' : '', l.text)));
    b.append(mu);
    b.append(el('p', 'request', p2.request));
    const so = el('div', 'signoff');
    so.append(el('div', 'h', p2.signoff.heading));
    const names = el('div', 'names');
    const rows = p2.signoff.names;
    if (rows && rows.length) {
      for (const row of rows) {
        if (Array.isArray(row)) {
          const r = el('div', 'pair');
          row.forEach((n) => r.append(el('span', '', n)));
          names.append(r);
        } else names.append(el('div', 'single', row));
      }
    } else {
      // placeholders: neutral bars the size of the redacted lines
      names.classList.add('placeholder');
      for (const kind of p2.signoff.placeholderShape) {
        if (kind === 'pair') {
          const r = el('div', 'pair');
          r.append(el('span', 'bar'), el('span', 'bar'));
          names.append(r);
        } else {
          const r = el('div', 'single');
          r.append(el('span', 'bar wide'));
          names.append(r);
        }
      }
    }
    so.append(names);
    b.append(so);
    const ve = el('div', 'venue');
    ve.append(el('div', 'h', p2.venue.heading));
    p2.venue.lines.forEach((l) => ve.append(el('div', 'line', l)));
    b.append(ve);

    root.append(a, b);
    return [a, b];
  };
})();
