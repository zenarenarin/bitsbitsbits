// Procedural gouache. Every surface is painted on a 2D canvas with layered washes,
// tapered brush strokes, dry-brush streaks, speckle and hand-wobbled motifs, then mapped
// onto real 3D geometry. Painters respect material: glaze pools and drips on ceramics,
// grain on wood, patina and painted glints on brass, fibres and ink on paper.
//
// UV layouts the painters know about:
//   lathe/cyl: u around (u = 0.25 faces the viewer), v bottom -> top.
//   box atlas: 3 x 2 cells. Top row: front, back, top. Bottom row: right, left, bottom.
//   prism atlas: front face u 0..0.5, back u 0.5..1 (both v 0.3..1); sides strip v 0..0.3.

const Paint = (() => {
  const { rng, clamp, noise2, fbm2 } = U;

  // ---- colour helpers ----
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hslCss(h, s, l, a = 1) { return `hsla(${((h % 1) + 1) % 1 * 360},${clamp(s, 0, 1) * 100}%,${clamp(l, 0, 1) * 100}%,${a})`; }
  function jit(hex, r, dl = 0.06, ds = 0.06, dh = 0.015, a = 1) {
    const [h, s, l] = rgbHsl(hexRgb(hex));
    return hslCss(h + (r() - 0.5) * 2 * dh, s + (r() - 0.5) * 2 * ds, l + (r() - 0.5) * 2 * dl, a);
  }
  function shade(hex, dl, ds = 0, a = 1) { const [h, s, l] = rgbHsl(hexRgb(hex)); return hslCss(h, s + ds, l + dl, a); }
  function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

  function canvas(w, h) {
    const c = document.createElement('canvas'); // detached; never mounted
    c.width = w; c.height = h; return c;
  }

  // ---- brush primitives ----
  // A tapered stroke: a curved ribbon built from a centreline with width falling off at both ends.
  function stroke(g, x, y, len, w, ang, color, r, bend = 0.15) {
    const n = 8, ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca;
    const bnd = (r() - 0.5) * bend * len;
    const L = [], R = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x + ca * (t - 0.5) * len + nx * bnd * Math.sin(t * Math.PI), py = y + sa * (t - 0.5) * len + ny * bnd * Math.sin(t * Math.PI);
      const ww = w * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15) * Math.PI)) * (0.85 + r() * 0.3) / 2;
      L.push([px + nx * ww, py + ny * ww]); R.push([px - nx * ww, py - ny * ww]);
    }
    g.fillStyle = color; g.beginPath(); g.moveTo(L[0][0], L[0][1]);
    for (const p of L) g.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
    g.closePath(); g.fill();
  }
  // wrap-aware drawing for cylindrical maps
  function wrap(W, x, fn) { fn(x); if (x < W * 0.25) fn(x + W); if (x > W * 0.75) fn(x - W); }

  // Wobbly line through points (hand-drawn ink).
  function wobble(g, pts, r, amp = 1.2, close = false) {
    g.beginPath();
    pts.forEach((p, i) => { const x = p[0] + (r() - 0.5) * amp, y = p[1] + (r() - 0.5) * amp; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    if (close) g.closePath();
  }

  // Layered gouache wash over a rect.
  function wash(g, x0, y0, w, h, base, r, o = {}) {
    g.fillStyle = base; g.fillRect(x0, y0, w, h);
    const n = Math.round((o.n || 1) * w * h / 900);
    const horiz = o.angle == null ? 0 : o.angle;
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * w, y = y0 + r() * h, len = (o.len || 60) * (0.5 + r()), ww = (o.w || 14) * (0.5 + r());
      stroke(g, x, y, len, ww, horiz + (r() - 0.5) * (o.spread || 0.5), jit(base, r, o.dl || 0.07, 0.07, 0.012, (o.a || 0.22) * (0.6 + r() * 0.6)), r);
    }
    // dry brush streaks
    const m = Math.round((o.dry == null ? 1 : o.dry) * w * h / 260);
    for (let i = 0; i < m; i++) {
      const x = x0 + r() * w, y = y0 + r() * h;
      g.fillStyle = r() < 0.5 ? shade(base, 0.08, 0, 0.12) : shade(base, -0.08, 0, 0.12);
      g.fillRect(x, y, (o.len || 60) * 0.25 * (0.3 + r()), 0.8 + r() * 0.8);
    }
  }
  function speckle(g, x0, y0, w, h, color, r, density = 1, size = 1.4) {
    const n = Math.round(density * w * h / 500);
    for (let i = 0; i < n; i++) {
      g.fillStyle = color; g.globalAlpha = 0.25 + r() * 0.55;
      g.beginPath(); g.arc(x0 + r() * w, y0 + r() * h, size * (0.3 + r() * r()), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  function paperGrain(g, w, h, r, a = 0.06) {
    for (let i = 0; i < w * h / 40; i++) { g.fillStyle = r() < 0.5 ? `rgba(255,250,235,${a})` : `rgba(60,35,20,${a})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
  }

  // ---- motifs, drawn in ink with a slightly unsteady hand ----
  function motif(g, type, cx, cy, s, color, r) {
    g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1.6, s * 0.12); g.lineCap = 'round'; g.lineJoin = 'round';
    switch (type) {
      case 'diamond': {
        wobble(g, [[cx, cy - s], [cx + s * 0.75, cy], [cx, cy + s], [cx - s * 0.75, cy]], r, s * 0.08, true); g.stroke();
        wobble(g, [[cx, cy - s * 0.5], [cx + s * 0.38, cy], [cx, cy + s * 0.5], [cx - s * 0.38, cy]], r, s * 0.06, true); g.stroke();
        g.beginPath(); g.arc(cx, cy, s * 0.1, 0, 7); g.fill();
        for (const [dx, dy] of [[0, -1.35], [0, 1.35], [1.05, 0], [-1.05, 0]]) { g.beginPath(); g.arc(cx + dx * s, cy + dy * s * 0.9, s * 0.07, 0, 7); g.fill(); }
        break;
      }
      case 'sun': {
        g.beginPath(); g.arc(cx, cy, s * 0.45, 0, 7); g.stroke();
        g.beginPath(); g.arc(cx, cy, s * 0.14, 0, 7); g.fill();
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; wobble(g, [[cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62], [cx + Math.cos(a) * s * 0.95, cy + Math.sin(a) * s * 0.95]], r, 1); g.stroke(); }
        break;
      }
      case 'cross': {
        wobble(g, [[cx - s * 0.6, cy], [cx + s * 0.6, cy]], r, 1); g.stroke();
        wobble(g, [[cx, cy - s * 0.6], [cx, cy + s * 0.6]], r, 1); g.stroke();
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.beginPath(); g.arc(cx + dx * s * 0.4, cy + dy * s * 0.4, s * 0.08, 0, 7); g.fill(); }
        break;
      }
      case 'circles': g.beginPath(); g.arc(cx, cy, s * 0.55, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, s * 0.16, 0, 7); g.fill(); break;
      case 'dots': g.beginPath(); g.arc(cx, cy, s * 0.22, 0, 7); g.fill(); break;
    }
    g.restore();
  }
  // a horizontal band with irregular edges, optionally filled with a repeated motif
  function band(g, W, H, b, r, around = true) {
    const yc = (1 - b.at) * H, hh = b.w * H / 2;
    g.fillStyle = b.color; g.beginPath();
    const n = 40;
    for (let i = 0; i <= n; i++) { const x = i / n * W; g.lineTo(x, yc - hh + (noise2(i * 0.7, b.at * 9) - 0.5) * hh * 0.5 + (r() - 0.5)); }
    for (let i = n; i >= 0; i--) { const x = i / n * W; g.lineTo(x, yc + hh + (noise2(i * 0.7 + 9, b.at * 9) - 0.5) * hh * 0.5 + (r() - 0.5)); }
    g.closePath(); g.fill();
    // texture inside the band
    g.save(); g.clip();
    for (let i = 0; i < W / 6; i++) stroke(g, r() * W, yc + (r() - 0.5) * hh * 2, 30, hh * 0.8, (r() - 0.5) * 0.3, jit(b.color, r, 0.06, 0.05, 0.01, 0.25), r);
    g.restore();
    if (b.motif) {
      const s = hh * 0.8, count = Math.max(3, Math.round(W / (s * 3.2)));
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) / count * W;
        if (b.motif === 'zigzag') continue;
        wrap(W, x, xx => motif(g, b.motif, xx, yc, s, b.motifColor || '#2c1d16', r));
      }
      if (b.motif === 'zigzag') {
        g.save(); g.strokeStyle = b.motifColor; g.lineWidth = Math.max(2, hh * 0.22); g.lineJoin = 'round';
        const pts = [], zc = Math.round(W / (hh * 1.6));
        for (let i = 0; i <= zc; i++) pts.push([i / zc * W, yc + (i % 2 ? -1 : 1) * hh * 0.55]);
        wobble(g, pts, r, 1.4); g.stroke();
        g.restore();
      }
    }
  }

  // ---- painters ----
  function ceramic(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 70, w: 16, n: 1.4 });
    if (sp.mottle) for (let i = 0; i < 26; i++) { g.globalAlpha = 0.35; stroke(g, r() * W, r() * H, 60 + r() * 60, 18 + r() * 20, r() * 3, jit(sp.mottle, r, 0.06), r, 0.5); g.globalAlpha = 1; }
    if (sp.glaze && sp.glazeAt != null && sp.glazeAt < 1) {
      // glaze pooled over the body with a wavy boundary and drips
      const fromBottom = sp.glazeFrom === 'bottom';
      const yb = (1 - sp.glazeAt) * H, amp = H * 0.045;
      const edge = x => yb + (fbm2(x / W * 6, sp.glazeAt * 7) - 0.5) * amp * 2.2;
      g.save(); g.beginPath();
      if (!fromBottom) { g.moveTo(0, -2); for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.lineTo(W, -2); }
      else { g.moveTo(0, H + 2); for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.lineTo(W, H + 2); }
      g.closePath(); g.clip();
      wash(g, 0, 0, W, H, sp.glaze, r, { len: 80, w: 18, n: 1.2, a: 0.25 });
      g.restore();
      // drips
      for (let i = 0; i < (sp.drips || 0); i++) {
        const x = (i + r() * 0.7) / (sp.drips) * W, y0 = edge(x), len = H * (0.06 + r() * 0.16) * (fromBottom ? -1 : 1), w = 6 + r() * 8;
        wrap(W, x, xx => {
          g.fillStyle = jit(sp.glaze, r, 0.03); g.beginPath();
          g.moveTo(xx - w / 2, y0 - (fromBottom ? -2 : 2)); g.quadraticCurveTo(xx - w * 0.45, y0 + len * 0.7, xx, y0 + len); g.quadraticCurveTo(xx + w * 0.45, y0 + len * 0.7, xx + w / 2, y0 - (fromBottom ? -2 : 2)); g.fill();
        });
      }
      // a darker pooled line along the glaze edge
      g.strokeStyle = shade(sp.glaze, -0.12, 0, 0.35); g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= W; x += 4) g.lineTo(x, edge(x)); g.stroke();
    }
    for (const b of sp.bands || []) band(g, W, H, b, r);
    if (sp.band) band(g, W, H, sp.band, r);
    if (sp.motif) {
      const n = sp.motifN || 2, s = H * 0.085;
      for (let i = 0; i < n; i++) { const x = (0.25 + i / n) % 1 * W; wrap(W, x, xx => motif(g, sp.motif, xx, (1 - sp.motifAt) * H, s * (sp.motif === 'dots' ? 0.6 : 1), sp.motifColor || '#2c1d16', r)); }
    }
    if (sp.petals) {
      for (let i = 0; i < 9; i++) {
        const x = i / 9 * W;
        g.strokeStyle = shade(sp.glaze || sp.base, -0.2, 0, 0.6); g.lineWidth = 3;
        wrap(W, x, xx => { wobble(g, [[xx, H], [xx + 2, H * 0.6], [xx - 1, H * 0.3]], r, 2); g.stroke(); });
        g.fillStyle = shade(sp.base, 0.1, 0, 0.25); stroke(g, x + W / 18, H * 0.35, H * 0.5, W / 30, Math.PI / 2, shade(sp.base, 0.12, 0, 0.3), r);
      }
    }
    if (sp.feathers) {
      g.strokeStyle = shade(sp.base, -0.15, 0, 0.55); g.lineWidth = 2;
      for (let row = 0; row < 6; row++) for (let i = 0; i < 12; i++) {
        const x = (i + (row % 2) * 0.5) / 12 * W, y = H * (0.25 + row * 0.07);
        g.beginPath(); g.arc(x, y, W / 30, 0.2, Math.PI - 0.2); g.stroke();
      }
    }
    if (sp.speck) speckle(g, 0, 0, W, H, sp.speck, r, 1.1, 1.8);
    // faint thrown rings
    for (let i = 0; i < 9; i++) { g.fillStyle = shade(sp.base, r() < 0.5 ? 0.06 : -0.06, 0, 0.12); g.fillRect(0, r() * H, W, 1 + r() * 1.5); }
  }

  function grain(g, x0, y0, w, h, base, r, o = {}) {
    const ang = o.vertical ? Math.PI / 2 : 0;
    wash(g, x0, y0, w, h, base, r, { len: 150, w: 22, n: 1.1, spread: 0.06, dry: 0.8, angle: ang, a: 0.28, dl: 0.09 });
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    // broad painted figure in the grain
    for (let i = 0; i < (o.vertical ? w : h) / 22; i++) {
      const off = r() * (o.vertical ? w : h), L = o.vertical ? h : w;
      g.globalAlpha = 0.22 + r() * 0.2;
      const col = r() < 0.6 ? shade(base, -0.12, 0.04) : shade(base, 0.09, -0.02);
      for (let t = -20; t < L + 20; t += 70) {
        const x = o.vertical ? x0 + off + Math.sin(t / 50 + i) * 4 : x0 + t, y = o.vertical ? y0 + t : y0 + off + Math.sin(t / 50 + i) * 4;
        stroke(g, x, y, 90 + r() * 40, 4 + r() * 6, ang + (r() - 0.5) * 0.08, col, r, 0.08);
      }
    }
    g.globalAlpha = 1;
    const lines = Math.round((o.vertical ? w : h) / 9);
    const dark = shade(base, -0.17, 0.03, 0.45), light = shade(base, 0.1, 0, 0.3);
    for (let i = 0; i < lines; i++) {
      const off = r() * (o.vertical ? w : h), ph = r() * 10, amp = 1 + r() * 3;
      g.strokeStyle = r() < 0.75 ? dark : light; g.lineWidth = 1 + r() * 1.6; g.beginPath();
      const L = o.vertical ? h : w;
      for (let t = 0; t <= L; t += 8) {
        const d = Math.sin(t / 41 + ph) * amp + (noise2(t / 70, i) - 0.5) * 5;
        if (o.vertical) g.lineTo(x0 + off + d, y0 + t); else g.lineTo(x0 + t, y0 + off + d);
      }
      g.stroke();
    }
    if (!o.noKnots && w * h > 9000) for (let k = 0; k < 2; k++) {
      const kx = x0 + r() * w, ky = y0 + r() * h;
      g.strokeStyle = shade(base, -0.2, 0, 0.55); g.lineWidth = 1.6;
      for (let j = 1; j < 4; j++) { g.beginPath(); g.ellipse(kx, ky, j * 6, j * 2.6, o.vertical ? Math.PI / 2 : 0, 0, 7); g.stroke(); }
    }
    speckle(g, x0, y0, w, h, shade(base, -0.25), r, 0.25, 1.2);
    g.restore();
  }
  function cells(W, H) {
    const cw = W / 3, ch = H / 2;
    const c = (col, row) => ({ x: col * cw, y: row * ch, w: cw, h: ch });
    return { front: c(0, 0), back: c(1, 0), top: c(2, 0), right: c(0, 1), left: c(1, 1), bottom: c(2, 1) };
  }
  function prismCells(W, H) { return { front: { x: 0, y: 0, w: W / 2, h: H * 0.7 }, back: { x: W / 2, y: 0, w: W / 2, h: H * 0.7 }, sides: { x: 0, y: H * 0.7, w: W, h: H * 0.3 } }; }
  function rrect(g, x, y, w, h, rad) { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath(); }
  function inkRect(g, x, y, w, h, color, r, lw = 2) { g.strokeStyle = color; g.lineWidth = lw; wobble(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, 1.6, true); g.stroke(); }

  function wood(g, W, H, sp, r) {
    const face = sp.face;
    if (!face) { grain(g, 0, 0, W, H, sp.base, r, { noKnots: sp.plain }); }
    if (sp.painted) { // painted wood with worn edges
      g.globalAlpha = 0.85; wash(g, 0, 0, W, H, sp.base, r, { len: 60, n: 1 }); g.globalAlpha = 1;
      for (let i = 0; i < 40; i++) { g.fillStyle = shade('#8a5a34', 0, 0, 0.5); g.beginPath(); g.ellipse(r() * W, r() < 0.5 ? r() * 8 : H - r() * 8, 4 + r() * 10, 1 + r() * 2, 0, 0, 7); g.fill(); }
    }
    if (sp.horse) {
      // saddle and dapples
      g.fillStyle = '#7f9db4'; rrect(g, W * 0.3, H * 0.35, W * 0.25, H * 0.3, 8); g.fill();
      for (const t of [0.42, 0.48]) { g.fillStyle = '#efe2c4'; g.fillRect(W * 0.3, H * t, W * 0.25, 2); }
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,240,215,0.35)'; g.beginPath(); g.arc(r() * W, r() * H, 3 + r() * 5, 0, 7); g.fill(); }
    }
    if (sp.mask) maskFace(g, W, H, sp, r);
    if (!face) return;
    if (face === 'radio' || face === 'gramo' || face === 'chest' || face === 'chestlid') {
      const C = cells(W, H);
      for (const k of Object.keys(C)) { const c = C[k]; grain(g, c.x, c.y, c.w, c.h, sp.base, r, { vertical: k === 'right' || k === 'left' }); }
      const f = C.front;
      if (face === 'radio') {
        // fabric grille, dial window and trim
        const gx = f.x + f.w * 0.1, gy = f.y + f.h * 0.14, gw = f.w * 0.52, gh = f.h * 0.66;
        g.fillStyle = '#d8c49a'; rrect(g, gx, gy, gw, gh, 10); g.fill();
        g.save(); rrect(g, gx, gy, gw, gh, 10); g.clip();
        for (let i = 0; i < gw; i += 3) { g.fillStyle = 'rgba(90,60,30,0.25)'; g.fillRect(gx + i, gy, 1, gh); }
        for (let i = 0; i < gh; i += 3) { g.fillStyle = 'rgba(90,60,30,0.18)'; g.fillRect(gx, gy + i, gw, 1); }
        g.strokeStyle = 'rgba(74,48,32,0.8)'; g.lineWidth = 3;
        for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(gx + gw * i / 5, gy); g.lineTo(gx + gw * i / 5 + (r() - 0.5) * 3, gy + gh); g.stroke(); }
        g.restore();
        inkRect(g, gx, gy, gw, gh, '#3a2418', r, 2.5);
        const dx = f.x + f.w * 0.68, dy = f.y + f.h * 0.16, dw = f.w * 0.26, dh = f.h * 0.3;
        g.fillStyle = '#efe2c4'; rrect(g, dx, dy, dw, dh, 6); g.fill();
        g.fillStyle = '#9a4a2a'; g.fillRect(dx + dw * 0.5, dy + 4, 2, dh - 8);
        g.fillStyle = '#3a2418'; for (let i = 0; i < 7; i++) g.fillRect(dx + 6 + i * (dw - 12) / 6, dy + dh - 9, 1.5, 6);
        inkRect(g, dx, dy, dw, dh, '#3a2418', r, 2);
        g.fillStyle = '#c4993f'; g.fillRect(f.x + 4, f.y + f.h - 10, f.w - 8, 3);
      } else if (face === 'gramo') {
        g.fillStyle = '#c4993f'; rrect(g, f.x + f.w * 0.35, f.y + f.h * 0.4, f.w * 0.3, f.h * 0.18, 4); g.fill();
        inkRect(g, f.x + f.w * 0.35, f.y + f.h * 0.4, f.w * 0.3, f.h * 0.18, '#4a3020', r, 1.5);
        g.strokeStyle = 'rgba(58,36,24,0.7)'; g.lineWidth = 2; inkRect(g, f.x + 6, f.y + 6, f.w - 12, f.h - 12, 'rgba(58,36,24,0.6)', r, 2);
        const rt = C.right; g.fillStyle = '#3a2418'; g.beginPath(); g.arc(rt.x + rt.w * 0.5, rt.y + rt.h * 0.45, 5, 0, 7); g.fill();
      } else {
        // brass straps and keyhole (chest), straps on the lid
        for (const k of ['front', 'back', 'top', 'right', 'left']) {
          const c = C[k];
          for (const t of [0.18, 0.82]) {
            const vertical = k !== 'right' && k !== 'left';
            g.fillStyle = '#c99d43';
            if (vertical) g.fillRect(c.x + c.w * t - 5, c.y, 10, c.h); else g.fillRect(c.x, c.y + c.h * t - 5, c.w, 10);
            g.fillStyle = 'rgba(80,55,20,0.6)';
            for (let i = 0; i < 4; i++) { const p = (i + 0.5) / 4; g.beginPath(); if (vertical) g.arc(c.x + c.w * t, c.y + c.h * p, 1.8, 0, 7); else g.arc(c.x + c.w * p, c.y + c.h * t, 1.8, 0, 7); g.fill(); }
          }
          inkRect(g, c.x + 3, c.y + 3, c.w - 6, c.h - 6, 'rgba(58,36,24,0.55)', r, 1.6);
        }
        if (face === 'chest') { g.fillStyle = '#c99d43'; g.beginPath(); g.arc(f.x + f.w / 2, f.y + f.h * 0.35, 8, 0, 7); g.fill(); g.fillStyle = '#2c1d16'; g.beginPath(); g.arc(f.x + f.w / 2, f.y + f.h * 0.33, 2.4, 0, 7); g.fill(); g.fillRect(f.x + f.w / 2 - 1, f.y + f.h * 0.33, 2, 6); }
      }
      return;
    }
    if (face === 'tv' || face === 'portrait' || face === 'clock') {
      const P = prismCells(W, H);
      grain(g, 0, 0, W, H, sp.base, r);
      const f = P.front;
      if (face === 'tv') {
        const sx = f.x + f.w * 0.1, sy = f.y + f.h * 0.12, sw = f.w * 0.6, sh = f.h * 0.68;
        g.fillStyle = '#e0b48a'; rrect(g, sx - 6, sy - 6, sw + 12, sh + 12, 18); g.fill();
        const grd = g.createLinearGradient(sx, sy, sx + sw, sy + sh); grd.addColorStop(0, '#5f7d80'); grd.addColorStop(1, '#2c3f42');
        g.fillStyle = grd; rrect(g, sx, sy, sw, sh, 16); g.fill();
        g.globalAlpha = 0.5; stroke(g, sx + sw * 0.3, sy + sh * 0.25, sw * 0.4, 7, -0.5, '#cfe0dc', r); stroke(g, sx + sw * 0.25, sy + sh * 0.4, sw * 0.18, 4, -0.5, '#cfe0dc', r); g.globalAlpha = 1;
        inkRect(g, sx, sy, sw, sh, '#2c1d16', r, 2.5);
        for (const t of [0.3, 0.55]) { g.fillStyle = '#f0d8a8'; g.beginPath(); g.arc(f.x + f.w * 0.85, f.y + f.h * t, 9, 0, 7); g.fill(); g.strokeStyle = '#3a2418'; g.lineWidth = 2; g.stroke(); }
        g.fillStyle = 'rgba(58,36,24,0.7)'; for (let i = 0; i < 5; i++) g.fillRect(f.x + f.w * 0.78, f.y + f.h * (0.72 + i * 0.035), f.w * 0.14, 2);
      } else if (face === 'portrait') {
        const ix = f.x + f.w * 0.14, iy = f.y + f.h * 0.12, iw = f.w * 0.72, ih = f.h * 0.76;
        g.fillStyle = '#c99d43'; g.fillRect(ix - 5, iy - 5, iw + 10, ih + 10);
        wash(g, ix, iy, iw, ih, '#d6b06a', r, { len: 40, w: 12, n: 1.2 });
        // sitter: shoulders, neck, face, hair
        g.fillStyle = '#7f9db4'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 1.02, iw * 0.42, ih * 0.32, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#efd9bf'; g.fillRect(ix + iw * 0.45, iy + ih * 0.52, iw * 0.1, ih * 0.18);
        g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.42, iw * 0.15, ih * 0.15, 0, 0, 7); g.fill();
        g.fillStyle = '#d9c6b0'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.33, iw * 0.21, ih * 0.13, 0, Math.PI, 0); g.fill();
        for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(ix + iw * (0.32 + k * 0.05), iy + ih * (0.3 + Math.sin(k) * 0.03), iw * 0.05, 0, 7); g.fill(); }
        g.strokeStyle = '#2c1d16'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(ix + iw * 0.45, iy + ih * 0.42, 3, 0.2, Math.PI - 0.2); g.stroke(); g.beginPath(); g.arc(ix + iw * 0.55, iy + ih * 0.42, 3, 0.2, Math.PI - 0.2); g.stroke();
        g.fillStyle = '#9a4a2a'; g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.5, 3, 1.5, 0, 0, 7); g.fill();
        g.strokeStyle = '#2c1d16'; g.lineWidth = 2; wobble(g, [[ix + iw * 0.3, iy + ih], [ix + iw * 0.38, iy + ih * 0.75], [ix + iw * 0.5, iy + ih * 0.72], [ix + iw * 0.62, iy + ih * 0.75], [ix + iw * 0.7, iy + ih]], r, 1.5); g.stroke();
        inkRect(g, ix, iy, iw, ih, '#2c1d16', r, 2);
        const b = P.back; wash(g, b.x, b.y, b.w, b.h, '#8a6a4a', r, { len: 30, n: 1 }); g.strokeStyle = '#3a2418'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x + b.w * 0.35, b.y + b.h * 0.25); g.lineTo(b.x + b.w / 2, b.y + b.h * 0.15); g.lineTo(b.x + b.w * 0.65, b.y + b.h * 0.25); g.stroke();
      } else {
        inkRect(g, f.x + 8, f.y + 8, f.w - 16, f.h - 16, 'rgba(239,226,196,0.7)', r, 2);
        for (let i = 0; i < 6; i++) motif(g, 'dots', f.x + f.w * (0.2 + i * 0.12), f.y + f.h * 0.88, 10, '#c99d43', r);
      }
      return;
    }
  }

  function maskFace(g, W, H, sp, r) {
    // planar UV seen from above: v = 1 at the mask's top (-z)
    wash(g, 0, 0, W, H, sp.base, r, { len: 50, w: 14, n: 1.4 });
    const cx = W / 2;
    g.fillStyle = '#efe2c4';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * W * 0.18, H * 0.38, W * 0.13, H * 0.07, s * 0.25, 0, 7); g.fill(); }
    g.fillStyle = '#2c1d16';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * W * 0.18, H * 0.38, W * 0.07, H * 0.035, s * 0.25, 0, 7); g.fill(); }
    g.fillStyle = '#d9a933'; g.beginPath(); g.moveTo(cx, H * 0.4); g.lineTo(cx + W * 0.06, H * 0.6); g.lineTo(cx - W * 0.06, H * 0.6); g.closePath(); g.fill();
    g.fillStyle = '#2c1d16'; g.beginPath(); g.ellipse(cx, H * 0.74, W * 0.12, H * 0.035, 0, 0, 7); g.fill();
    g.strokeStyle = '#efe2c4'; g.lineWidth = 3;
    wobble(g, [[cx - W * 0.3, H * 0.2], [cx - W * 0.15, H * 0.15], [cx, H * 0.2], [cx + W * 0.15, H * 0.15], [cx + W * 0.3, H * 0.2]], r, 2); g.stroke();
    for (const s of [-1, 1]) { for (let i = 0; i < 4; i++) { g.fillStyle = '#d9a933'; g.beginPath(); g.arc(cx + s * W * (0.32 + i * 0.03), H * (0.5 + i * 0.07), 3, 0, 7); g.fill(); } }
    g.strokeStyle = '#2f6b66'; g.lineWidth = 3;
    for (const s of [-1, 1]) { wobble(g, [[cx + s * W * 0.08, H * 0.86], [cx + s * W * 0.22, H * 0.8], [cx + s * W * 0.3, H * 0.66]], r, 2); g.stroke(); }
  }

  function brass(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 40, w: 10, n: 1.6, dl: 0.09 });
    for (let i = 0; i < W * H / 1800; i++) { g.globalAlpha = 0.35; stroke(g, r() * W, r() * H, 20 + r() * 40, 8 + r() * 14, r() * 3, jit('#6b5a2a', r, 0.05), r, 0.6); }
    g.globalAlpha = 1;
    // painted glints: crisp light strokes, not a metallic gradient
    for (let i = 0; i < W / 22; i++) { stroke(g, r() * W, r() * H, 10 + r() * 30, 2 + r() * 4, Math.PI / 2 + (r() - 0.5) * 0.3, `rgba(255,236,170,${0.35 + r() * 0.4})`, r); }
    speckle(g, 0, 0, W, H, '#5a4520', r, 0.6, 1.4);
    if (sp.face === 'mirror') { /* the glass is a separate disc */ }
  }

  function paper(g, W, H, sp, r) {
    const base = sp.base || '#eadcbc';
    wash(g, 0, 0, W, H, base, r, { len: 50, w: 16, n: 0.8, a: 0.15, dl: 0.04 });
    paperGrain(g, W, H, r, 0.05);
    for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(150,100,50,${0.05 + r() * 0.08})`; g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 9, 0, 7); g.fill(); }
    const ink = '#3d2a1e';
    const script = (x0, y0, w, h, rows, color = ink, lw = 1.3) => {
      g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
      for (let row = 0; row < rows; row++) {
        const y = y0 + (row + 0.7) * h / rows; let x = x0 + r() * 8; const end = x0 + w * (0.7 + r() * 0.3);
        g.beginPath(); g.moveTo(x, y);
        while (x < end) {
          const wd = 3 + r() * 5, ht = h / rows * (0.25 + r() * 0.35);
          g.bezierCurveTo(x + wd * 0.3, y - ht, x + wd * 0.9, y - ht, x + wd, y + (r() - 0.5) * 2);
          x += wd; if (r() < 0.12) { x += 5; g.moveTo(x, y); }
        }
        g.stroke();
      }
    };
    if (sp.script) { script(10, 10, W - 20, H - 20, 14); g.strokeStyle = 'rgba(120,80,40,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); }
    if (sp.envelope) {
      const C = cells(W, H), t = C.top;
      g.strokeStyle = 'rgba(80,55,30,0.45)'; g.lineWidth = 2;
      wobble(g, [[t.x + 4, t.y + 4], [t.x + t.w / 2, t.y + t.h * 0.55], [t.x + t.w - 4, t.y + 4]], r, 1.5); g.stroke();
      script(t.x + t.w * 0.3, t.y + t.h * 0.6, t.w * 0.55, t.h * 0.3, 3, ink, 1);
      if (sp.stamp) { g.fillStyle = '#9a4a2a'; g.fillRect(t.x + t.w * 0.78, t.y + t.h * 0.12, t.w * 0.14, t.h * 0.22); g.strokeStyle = '#efe2c4'; g.setLineDash([2, 2]); g.strokeRect(t.x + t.w * 0.78, t.y + t.h * 0.12, t.w * 0.14, t.h * 0.22); g.setLineDash([]); }
      g.fillStyle = '#9a4a2a'; g.fillRect(t.x, t.y + t.h * 0.47, t.w, 3);
    }
    if (sp.roll) { for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(120,80,40,0.25)'; g.fillRect(r() * W, 0, 2, H); } script(10, H * 0.15, W - 20, H * 0.7, 6, 'rgba(61,42,30,0.6)', 1); g.fillStyle = '#7c2f35'; g.fillRect(W * 0.47, 0, W * 0.06, H); }
    if (sp.rollEnd) { g.strokeStyle = 'rgba(110,70,35,0.6)'; g.lineWidth = 1.5; g.beginPath(); for (let a = 0; a < 30; a += 0.1) { const rr = a * W / 70; g.lineTo(W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr); } g.stroke(); }
    if (sp.face === 'journal' || sp.face === 'notebook') {
      const C = cells(W, H), journal = sp.face === 'journal';
      const cover = journal ? '#5a4a2c' : '#2f6b66';
      for (const k of ['top', 'bottom']) {
        const c = C[k]; wash(g, c.x, c.y, c.w, c.h, cover, r, { len: 30, w: 12, n: 1.6 });
        inkRect(g, c.x + 8, c.y + 8, c.w - 16, c.h - 16, journal ? 'rgba(201,157,67,0.8)' : 'rgba(239,226,196,0.6)', r, 2);
        if (journal) { motif(g, 'sun', c.x + c.w / 2, c.y + c.h / 2, c.w * 0.18, 'rgba(201,157,67,0.85)', r); for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { g.fillStyle = 'rgba(30,20,10,0.45)'; g.beginPath(); g.arc(c.x + cx * c.w, c.y + cy * c.h, 12, 0, 7); g.fill(); } }
        else { g.fillStyle = '#efe2c4'; g.fillRect(c.x + c.w * 0.25, c.y + c.h * 0.3, c.w * 0.5, c.h * 0.18); g.fillStyle = '#21504d'; g.fillRect(c.x + c.w * 0.82, c.y, 5, c.h); }
      }
      for (const k of ['front', 'back', 'right']) { // page block
        const c = C[k]; g.fillStyle = '#eadcbc'; g.fillRect(c.x, c.y, c.w, c.h);
        const vertical = false;
        for (let i = 0; i < c.h; i += 2) { g.fillStyle = `rgba(${120 + r() * 40},${90 + r() * 30},${50},${0.15 + r() * 0.25})`; g.fillRect(c.x, c.y + i, c.w, 1); }
        g.fillStyle = cover; g.fillRect(c.x, c.y, c.w, c.h * 0.1); g.fillRect(c.x, c.y + c.h * 0.9, c.w, c.h * 0.1);
        if (journal && k === 'front') { g.fillStyle = '#c4553a'; g.fillRect(c.x + c.w * 0.6, c.y + c.h * 0.1, 6, c.h * 0.8); }
        if (vertical) break;
      }
      const s = C.left; wash(g, s.x, s.y, s.w, s.h, cover, r, { len: 20, n: 1.5 });
      for (const t of [0.2, 0.4, 0.6, 0.8]) { g.fillStyle = 'rgba(201,157,67,0.7)'; g.fillRect(s.x + s.w * t, s.y, 3, s.h); }
    }
    if (sp.card) {
      const C = cells(W, H), t = C.top;
      if (sp.card === 'sea') {
        g.fillStyle = '#a9c1cf'; g.fillRect(t.x + 6, t.y + 6, t.w - 12, t.h * 0.5);
        g.fillStyle = '#2f6b66'; g.fillRect(t.x + 6, t.y + t.h * 0.5, t.w - 12, t.h * 0.5 - 6);
        g.strokeStyle = '#efe2c4'; g.lineWidth = 1.5; for (let i = 0; i < 5; i++) { g.beginPath(); for (let x = 0; x < t.w - 12; x += 6) g.lineTo(t.x + 6 + x, t.y + t.h * (0.6 + i * 0.07) + Math.sin(x / 6) * 1.5); g.stroke(); }
        g.fillStyle = '#d9a933'; g.beginPath(); g.arc(t.x + t.w * 0.7, t.y + t.h * 0.3, 8, 0, 7); g.fill();
      } else if (sp.card === 'hill') {
        g.fillStyle = '#efd9a8'; g.fillRect(t.x + 6, t.y + 6, t.w - 12, t.h - 12);
        g.fillStyle = '#c98e2f'; g.beginPath(); g.moveTo(t.x + 6, t.y + t.h - 6); g.lineTo(t.x + t.w * 0.45, t.y + t.h * 0.25); g.lineTo(t.x + t.w - 6, t.y + t.h - 6); g.fill();
        g.fillStyle = '#7b7a3c'; g.fillRect(t.x + 6, t.y + t.h * 0.8, t.w - 12, t.h * 0.2 - 6);
      } else { script(t.x + 10, t.y + 10, t.w * 0.55, t.h - 20, 5, ink, 1); g.strokeStyle = 'rgba(61,42,30,0.5)'; g.beginPath(); g.moveTo(t.x + t.w * 0.66, t.y + 10); g.lineTo(t.x + t.w * 0.66, t.y + t.h - 10); g.stroke(); g.fillStyle = '#7c2f35'; g.fillRect(t.x + t.w * 0.8, t.y + 10, 16, 20); }
      inkRect(g, t.x + 6, t.y + 6, t.w - 12, t.h - 12, 'rgba(58,36,24,0.6)', r, 1.4);
    }
    if (sp.leaf) { g.strokeStyle = '#4b7350'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke(); }
  }

  function flat(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 40, w: 12, n: 1.3 });
    if (sp.mottle) for (let i = 0; i < 12; i++) { g.globalAlpha = 0.4; stroke(g, r() * W, r() * H, 40, 16, r() * 3, jit(sp.mottle, r), r, 0.5); g.globalAlpha = 1; }
    if (sp.ring) { g.strokeStyle = sp.ring; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, 7); g.stroke(); g.fillStyle = sp.ring; g.fillRect(W / 2 - 1.5, H * 0.2, 3, H * 0.3); }
    if (sp.drip) for (let i = 0; i < 4; i++) { const x = r() * W; g.fillStyle = '#f7eedb'; g.beginPath(); g.moveTo(x - 6, H * 0.0); g.quadraticCurveTo(x - 5, H * 0.3, x, H * (0.25 + r() * 0.3)); g.quadraticCurveTo(x + 5, H * 0.3, x + 6, 0); g.fill(); }
    if (sp.record) { g.strokeStyle = 'rgba(200,190,170,0.18)'; for (let rr = 6; rr < W / 2; rr += 3) { g.beginPath(); g.arc(W / 2, H / 2, rr, 0, 7); g.stroke(); } g.fillStyle = '#9a4a2a'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.12, 0, 7); g.fill(); }
    if (sp.dial) {
      g.fillStyle = '#f3ead2'; g.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
      g.strokeStyle = '#2c1d16'; g.lineWidth = 2;
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82); g.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95); g.stroke(); }
      g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * 0.45, cy - R * 0.2); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - R * 0.1, cy - R * 0.7); g.stroke();
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    }
    if (sp.tip) { g.fillStyle = sp.tip; g.fillRect(0, 0, W, H * 0.08); }
    if (sp.leaf) { g.strokeStyle = '#3f6545'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(W * 0.1, H * (0.2 + i * 0.15)); g.lineTo(W * 0.9, H * (0.1 + i * 0.15)); g.stroke(); } }
  }

  // Drawer surfaces.
  function drawerWood(g, W, H, sp, r) { grain(g, 0, 0, W, H, sp.base, r, { noKnots: false }); }
  function felt(g, W, H, sp, r) {
    wash(g, 0, 0, W, H, sp.base, r, { len: 30, w: 20, n: 2.2, a: 0.18, dl: 0.04, dry: 0.4 });
    for (let i = 0; i < W * H / 6; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
    // stitched border
    g.strokeStyle = shade(sp.base, 0.22, -0.1, 0.65); g.lineWidth = 2; g.setLineDash([7, 6]);
    g.strokeRect(14, 14, W - 28, H - 28); g.setLineDash([]);
  }
  function paperBg(W, H, seed) {
    const c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
    wash(g, 0, 0, W, H, '#efe4cc', r, { len: 140, w: 40, n: 0.5, a: 0.1, dl: 0.03 });
    paperGrain(g, W, H, r, 0.045);
    return c;
  }

  const FNS = { ceramic, wood, brass, paper, flat, drawerWood, felt };
  // Paint a texture for a material spec. Size depends on how the surface is mapped.
  function texture(spec, layout, seed) {
    const big = layout === 'box' || layout === 'prism' || layout === 'dome';
    const W = big ? 512 : layout === 'lathe' ? 512 : 256, H = big ? 384 : layout === 'lathe' ? 384 : 128;
    const c = canvas(W, H), g = c.getContext('2d');
    const r = rng(seed);
    (FNS[spec.fn] || flat)(g, W, H, spec, r);
    return c;
  }

  return { texture, paperBg, canvas, mixHex, shade, hexRgb, FNS };
})();
