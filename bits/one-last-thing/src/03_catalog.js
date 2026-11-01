// The cabinet of curiosities. Each object is a list of geometric features in object
// space (cm, y up, resting on y = 0). The same features build the visible mesh and the
// convex collision parts, so collision follows the silhouette: lathe profiles become
// frustum stacks, handles become capsule chains, a bowl becomes a hollow ring of wedges.

const Catalog = (() => {
  const { qAxis, qMul, qRot, v3 } = U;
  const D2R = Math.PI / 180;
  const rz = a => qAxis(0, 0, 1, a * D2R), rx = a => qAxis(1, 0, 0, a * D2R), ry = a => qAxis(0, 1, 0, a * D2R);

  // ---- Catmull-Rom sampling shared by collision and visuals ----
  function catmull(pts, n) {
    const out = [];
    const P = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(t)), u = t - k;
      const p0 = P[k], p1 = P[k + 1], p2 = P[k + 2], p3 = P[k + 3];
      const f = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u * u * u);
      out.push([f(0), f(1), f(2)]);
    }
    return out;
  }
  function segDist(p, a, b) {
    const ab = v3.sub(b, a), L = v3.dot(ab, ab), t = L > 0 ? Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ab) / L)) : 0;
    return v3.len(v3.sub(p, v3.add(a, v3.scale(ab, t))));
  }
  function tubeParts(path, r, nCaps, xf) {
    const fine = path, out = [];
    const step = (fine.length - 1) / nCaps;
    for (let i = 0; i < nCaps; i++) {
      const i0 = Math.round(i * step), i1 = Math.round((i + 1) * step);
      const a = fine[i0], b = fine[i1];
      let dev = 0; for (let k = i0; k <= i1; k++) dev = Math.max(dev, segDist(fine[k], a, b));
      out.push(xf({ t: 'cap', a, b, r: r + dev }));
    }
    return out;
  }
  function ringPath(R, n) { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([Math.cos(a) * R, Math.sin(a) * R, 0]); } return o; }

  // Feature -> convex parts (object space).
  function featParts(f) {
    const P = f.p || [0, 0, 0], Q = f.q || [0, 0, 0, 1];
    // compose a part's own local transform into the feature transform
    const xf = part => {
      const lp = part.p || [0, 0, 0], lq = part.q || [0, 0, 0, 1];
      const o = Object.assign({}, part);
      o.p = v3.add(P, qRot(Q, lp)); o.q = qMul(Q, lq);
      return o;
    };
    const parts = [];
    switch (f.k) {
      case 'lathe': {
        const pr = f.prof, w = 1 + (f.wob || 0);
        for (let i = 0; i < pr.length - 1; i++) {
          const a = pr[i], b = pr[i + 1];
          if (b[1] - a[1] < 1e-4) continue;
          parts.push(xf({ t: 'fr', r0: a[0] * w, r1: b[0] * w, h: b[1] - a[1], p: [0, (a[1] + b[1]) / 2, 0], s: [f.sx || 1, 1, f.sz || 1] }));
        }
        break;
      }
      case 'cyl': parts.push(xf({ t: 'fr', r0: f.r0, r1: f.r1 == null ? f.r0 : f.r1, h: f.h, s: [f.sx || 1, 1, f.sz || 1] })); break;
      case 'box': {
        const [w, h, d] = f.size;
        if (!f.taper && !f.skew) parts.push(xf({ t: 'box', h: [w / 2, h / 2, d / 2] }));
        else parts.push(xf({ t: 'hull', pts: boxCorners(f) }));
        break;
      }
      case 'prism': {
        const pts = [];
        for (const [x, y] of f.poly) { pts.push([x, y, -f.depth / 2]); pts.push([x, y, f.depth / 2]); }
        parts.push(xf({ t: 'hull', pts }));
        break;
      }
      case 'sph': parts.push(xf({ t: 'sph', r: 1, s: f.r })); break;
      case 'cap': parts.push(xf({ t: 'cap', a: f.a, b: f.b, r: f.r })); break;
      case 'tube': parts.push(...tubeParts(catmull(f.pts, 40), f.r, f.caps || 4, xf)); break;
      case 'ring': parts.push(...tubeParts(ringPath(f.R, 48), f.r, f.caps || 8, xf)); break;
      case 'dome': { // half ellipsoid, flat side down
        const pts = [];
        for (let i = 0; i <= 6; i++) for (let j = 0; j < 16; j++) {
          const el = i / 6 * Math.PI / 2, az = j / 16 * Math.PI * 2;
          pts.push([Math.cos(el) * Math.cos(az) * f.r[0] * 1.02, Math.sin(el) * f.r[1] * 1.01, Math.cos(el) * Math.sin(az) * f.r[2] * 1.02]);
        }
        parts.push(xf({ t: 'hull', pts }));
        break;
      }
      case 'bowl': {
        const N = f.n || 12, rows = bowlRows(f);
        parts.push(xf({ t: 'fr', r0: f.rb, r1: rows[0].ro, h: f.floor, p: [0, f.floor / 2, 0] }));
        for (let r = 0; r < rows.length - 1; r++) {
          const A = rows[r], B = rows[r + 1];
          for (let i = 0; i < N; i++) {
            const pts = [];
            for (const t of [0, 0.5, 1]) {
              const a = (i + t) / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
              const k = 1 / Math.cos(Math.PI / N / 2);
              pts.push([c * A.ro * k, A.y, s * A.ro * k], [c * B.ro * k, B.y, s * B.ro * k]);
              if (t !== 0.5) pts.push([c * A.ri, A.y, s * A.ri], [c * B.ri, B.y, s * B.ri]);
            }
            parts.push(xf({ t: 'hull', pts }));
          }
        }
        break;
      }
    }
    if (f.density) for (const p of parts) p.density = f.density;
    return parts;
  }
  function boxCorners(f) {
    const [w, h, d] = f.size, t = f.taper || [1, 1], sk = f.skew || [0, 0];
    const pts = [];
    for (const y of [-h / 2, h / 2]) for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const top = y > 0;
      pts.push([x * w / 2 * (top ? t[0] : 1) + (top ? sk[0] : 0), y, z * d / 2 * (top ? t[1] : 1) + (top ? sk[1] : 0)]);
    }
    return pts;
  }
  function bowlRows(f) {
    const rows = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3, y = f.floor * 0.6 + (f.h - f.floor * 0.6) * t;
      const ro = f.rb + (f.rt - f.rb) * Math.pow(t, 0.7);
      rows.push({ y, ro, ri: Math.max(0.2, ro - f.wall) });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------------
  // Palette (gouache pigments)
  const C = {
    sienna: '#9a4a2a', siennaD: '#6e3320', ochre: '#c98e2f', mustard: '#d9a933', olive: '#7b7a3c', oliveD: '#56562a',
    dusty: '#7f9db4', dustyL: '#a9c1cf', teal: '#2f6b66', tealD: '#21504d', cream: '#efe2c4', creamD: '#dccaa0',
    terra: '#bf6a3f', burgundy: '#7c2f35', brass: '#c4993f', brassD: '#8a6a2a', ink: '#2c1d16', umber: '#4a3020',
    green: '#6f9a6a', greenD: '#4b7350', rose: '#c98a7a', paper: '#eadcbc', walnut: '#7a4a2c', walnutL: '#a8693c'
  };

  // Material shorthands. `paint` names a painter in Paint with parameters.
  const M = {
    glaze: (base, top, o = {}) => ({ kind: 'ceramic', paint: Object.assign({ fn: 'ceramic', base, glaze: top }, o) }),
    wood: (base, o = {}) => ({ kind: 'wood', paint: Object.assign({ fn: 'wood', base }, o) }),
    brass: (o = {}) => ({ kind: 'brass', paint: Object.assign({ fn: 'brass', base: C.brass }, o) }),
    paper: (o = {}) => ({ kind: 'paper', paint: Object.assign({ fn: 'paper', base: C.paper }, o) }),
    flat: (base, kind = 'ceramic', o = {}) => ({ kind, paint: Object.assign({ fn: 'flat', base }, o) }),
  };

  const D = [];
  const def = o => { D.push(o); return o; };

  // ---------------- A. Ceramics ----------------
  def({
    id: 'vase', no: 1, name: 'Tall vase', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.sienna, C.dusty, { glazeAt: 0.42, drips: 7, motif: 'diamond', motifAt: 0.3, motifColor: C.tealD, motifN: 3, speck: C.cream, band: { at: 0.86, w: 0.035, color: C.cream } }) },
    feats: [{ k: 'lathe', mat: 'body', open: 1, wob: 0.03, prof: [[1.9, 0], [2.5, 0.4], [3.05, 2.4], [3.0, 4.8], [2.25, 7.8], [1.3, 10.3], [1.15, 11.7], [1.75, 13]] }],
  });
  def({
    id: 'teapot', no: 2, name: 'Round teapot', cat: 'Ceramics', snd: 'ceramic',
    mats: {
      body: M.glaze(C.walnut, C.siennaD, { glazeAt: 0.95, drips: 0, bands: [{ at: 0.5, w: 0.2, color: C.dusty, motif: 'circles', motifColor: C.cream }, { at: 0.24, w: 0.03, color: C.cream }], speck: C.creamD }),
      lid: M.glaze(C.walnut, C.dusty, { glazeAt: 0.35, drips: 0, bands: [{ at: 0.2, w: 0.12, color: C.cream }, { at: 0.55, w: 0.08, color: C.dusty }] }),
      spout: M.glaze(C.walnut, C.walnut, { drips: 0 }),
    },
    feats: [
      { k: 'lathe', mat: 'body', wob: 0.02, prof: [[2.1, 0], [3.3, 0.7], [3.85, 2.5], [3.6, 4.3], [2.5, 5.5], [1.75, 5.75]] },
      { k: 'lathe', mat: 'lid', prof: [[1.85, 5.7], [1.7, 6.3], [1.0, 6.85], [0.4, 7.0]] },
      { k: 'sph', mat: 'lid', r: [0.55, 0.6, 0.55], p: [0, 7.4, 0] },
      { k: 'tube', mat: 'spout', r: 0.42, taper: 0.55, caps: 3, pts: [[3.2, 1.7, 0], [4.5, 2.5, 0], [5.3, 3.9, 0], [6.0, 5.0, 0]] },
      { k: 'tube', mat: 'spout', r: 0.36, caps: 4, pts: [[-3.3, 4.3, 0], [-4.7, 4.6, 0], [-5.15, 3.2, 0], [-4.5, 1.8, 0], [-3.5, 1.5, 0]] },
    ],
  });
  def({
    id: 'bowl', no: 3, name: 'Shallow bowl', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.walnut, C.green, { glazeAt: 0.62, drips: 9, bands: [{ at: 0.2, w: 0.03, color: C.cream }, { at: 0.12, w: 0.02, color: C.cream }], speck: C.cream, inner: C.green }) },
    feats: [{ k: 'bowl', mat: 'body', rb: 2.6, rt: 5.6, h: 3.1, wall: 0.38, floor: 0.45 }],
  });
  def({
    id: 'bottle', no: 4, name: 'Narrow-necked bottle', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.cream, C.cream, { drips: 0, bands: [{ at: 0.3, w: 0.16, color: C.olive, motif: 'dots', motifColor: C.cream }, { at: 0.12, w: 0.025, color: C.siennaD }, { at: 0.5, w: 0.025, color: C.siennaD }], speck: C.siennaD, mottle: C.creamD }) },
    feats: [{ k: 'lathe', mat: 'body', open: 1, wob: 0.025, prof: [[1.55, 0], [2.4, 0.55], [2.75, 2.4], [2.45, 4.5], [1.2, 6.1], [0.65, 7.1], [0.58, 9.5], [0.92, 10.1]] }],
  });
  def({
    id: 'cup', no: 5, name: 'Tiny cup', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.terra, C.cream, { glazeAt: 0.25, drips: 4, glazeFrom: 'bottom', motif: 'sun', motifAt: 0.62, motifN: 1, motifColor: C.ink, speck: C.creamD }), handle: M.glaze(C.terra, C.terra, { drips: 0 }) },
    feats: [
      { k: 'lathe', mat: 'body', open: 1, prof: [[0.95, 0], [1.05, 0.3], [1.55, 0.65], [1.95, 2.7]] },
      { k: 'tube', mat: 'handle', r: 0.22, caps: 3, pts: [[1.75, 2.15, 0], [2.65, 2.05, 0], [2.7, 1.15, 0], [1.6, 0.95, 0]] },
    ],
  });
  def({
    id: 'lidpot', no: 6, name: 'Ornate lidded pot', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.teal, C.tealD, { glazeAt: 0.9, drips: 0, bands: [{ at: 0.52, w: 0.22, color: C.mustard, motif: 'zigzag', motifColor: C.burgundy }, { at: 0.2, w: 0.03, color: C.cream }, { at: 0.82, w: 0.03, color: C.cream }], speck: C.cream }), lid: M.glaze(C.mustard, C.teal, { glazeAt: 0.5, drips: 5, glazeFrom: 'top' }) },
    feats: [
      { k: 'lathe', mat: 'body', wob: 0.02, prof: [[1.8, 0], [2.0, 0.3], [3.0, 1.2], [3.3, 2.8], [2.8, 4.2], [2.45, 4.6]] },
      { k: 'lathe', mat: 'lid', prof: [[2.65, 4.55], [2.6, 4.95], [1.8, 5.6], [0.5, 6.1]] },
      { k: 'sph', mat: 'lid', r: [0.55, 0.65, 0.55], p: [0, 6.55, 0] },
    ],
  });
  def({
    id: 'flask', no: 7, name: 'Double-handled vessel', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.walnut, C.cream, { glazeAt: 0.48, drips: 8, glazeFrom: 'top', motif: 'diamond', motifAt: 0.26, motifN: 3, motifColor: C.cream, speck: C.creamD }), handle: M.glaze(C.cream, C.cream, { drips: 0, mottle: C.creamD }) },
    feats: [
      { k: 'lathe', mat: 'body', sz: 0.66, wob: 0.02, prof: [[1.25, 0], [2.6, 0.5], [3.35, 2.7], [3.25, 4.5], [2.2, 6.3], [0.8, 7.4], [0.7, 9.6], [1.45, 10.3]] },
      { k: 'ring', mat: 'handle', R: 1.0, r: 0.3, caps: 6, p: [3.65, 5.4, 0] },
      { k: 'ring', mat: 'handle', R: 1.0, r: 0.3, caps: 6, p: [-3.65, 5.4, 0] },
    ],
  });
  def({
    id: 'incense', no: 8, name: 'Incense holder', cat: 'Ceramics', snd: 'ceramic',
    mats: { body: M.glaze(C.burgundy, C.mustard, { glazeAt: 0.7, drips: 6, glazeFrom: 'top', speck: C.cream, motif: 'dots', motifAt: 0.3, motifN: 6, motifColor: C.cream }), stick: M.flat(C.umber, 'wood', { tip: C.terra }) },
    feats: [
      { k: 'lathe', mat: 'body', prof: [[2.2, 0], [2.35, 0.35], [1.6, 1.15], [0.55, 1.5]] },
      { k: 'cap', mat: 'stick', a: [0.15, 1.35, 0], b: [3.1, 7.2, 0], r: 0.11 },
    ],
  });

  // ---------------- B. Vintage household ----------------
  def({
    id: 'radio', no: 9, name: 'Wooden radio', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnut, { face: 'radio' }), knob: M.flat(C.creamD, 'wood', { ring: C.umber }), handle: M.brass() },
    feats: [
      { k: 'box', mat: 'body', size: [8.6, 5.6, 4.0], taper: [0.92, 0.95], p: [0, 2.8, 0] },
      { k: 'cyl', mat: 'knob', r0: 0.55, h: 0.6, p: [2.75, 1.5, 2.25], q: rx(90) },
      { k: 'cyl', mat: 'knob', r0: 0.45, h: 0.55, p: [-2.75, 1.5, 2.22], q: rx(90) },
      { k: 'tube', mat: 'handle', r: 0.17, caps: 3, pts: [[-2.4, 5.5, 0], [-2.05, 6.55, 0], [2.05, 6.55, 0], [2.4, 5.5, 0]] },
    ],
  });
  def({
    id: 'tv', no: 10, name: 'Little television', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.terra, { face: 'tv' }), leg: M.wood(C.siennaD, { plain: 1 }) },
    feats: [
      { k: 'prism', mat: 'body', poly: [[-3.7, 0], [3.7, 0], [4.15, 5.4], [-4.15, 5.4]], depth: 5.2, p: [0, 2.6, 0] },
      { k: 'cap', mat: 'leg', a: [-2.9, 2.8, 1.7], b: [-3.6, 0.25, 2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [2.9, 2.8, 1.7], b: [3.6, 0.25, 2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [-2.9, 2.8, -1.7], b: [-3.6, 0.25, -2.3], r: 0.24 },
      { k: 'cap', mat: 'leg', a: [2.9, 2.8, -1.7], b: [3.6, 0.25, -2.3], r: 0.24 },
    ],
  });
  def({
    id: 'candle', no: 11, name: 'Brass candlestick', cat: 'Household', snd: 'metal',
    mats: { body: M.brass(), wax: M.flat(C.cream, 'wax', { drip: 1 }) },
    feats: [
      { k: 'lathe', mat: 'body', prof: [[2.5, 0], [2.55, 0.35], [1.7, 0.7], [0.6, 1.1], [0.45, 3.4], [0.85, 4.0], [0.48, 4.7], [0.42, 7.3], [1.35, 7.85], [1.45, 8.2]] },
      { k: 'cyl', mat: 'wax', r0: 0.72, r1: 0.66, h: 3.6, p: [0, 10.0, 0] },
    ],
  });
  def({
    id: 'gramophone', no: 12, name: 'Miniature gramophone', cat: 'Household', snd: 'wood',
    mats: { base: M.wood(C.walnutL, { face: 'gramo' }), horn: M.glaze(C.mustard, C.ochre, { glazeAt: 0.25, drips: 0, glazeFrom: 'bottom', petals: 1, inner: '#8a5a1a' }), plate: M.flat('#2a2422', 'metal', { record: 1 }), arm: M.brass() },
    feats: [
      { k: 'box', mat: 'base', size: [6.4, 3.0, 6.4], taper: [0.9, 0.9], p: [0, 1.5, 0] },
      { k: 'cyl', mat: 'plate', r0: 2.5, h: 0.3, p: [-0.3, 3.15, 0.3] },
      { k: 'cap', mat: 'arm', a: [2.3, 3.0, -2.3], b: [2.3, 5.0, -2.3], r: 0.28 },
      { k: 'lathe', mat: 'horn', open: 1, wob: 0.05, prof: [[0.32, 0], [0.45, 1.8], [1.0, 4.0], [2.2, 5.7], [3.4, 6.4]], p: [2.3, 4.6, -2.3], q: qMul(ry(-45), rz(38)) },
    ],
  });
  def({
    id: 'frame', no: 13, name: 'Framed portrait', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnut, { face: 'portrait' }) },
    feats: [{ k: 'prism', mat: 'body', depth: 1.0, poly: [[-3.4, 0], [3.4, 0], [4.1, 0.9], [4.1, 8.3], [3.4, 9.2], [-3.4, 9.2], [-4.1, 8.3], [-4.1, 0.9]], p: [0, 0, 0] }],
  });
  def({
    id: 'mirror', no: 14, name: 'Brass hand mirror', cat: 'Household', snd: 'metal',
    mats: { body: M.brass({ face: 'mirror' }), handle: M.brass() },
    feats: [
      { k: 'cyl', mat: 'body', r0: 2.75, r1: 2.6, h: 0.65, p: [0, 0.325, 0] },
      { k: 'cap', mat: 'handle', a: [0, 0.34, 2.7], b: [0, 0.34, 7.2], r: 0.36 },
    ],
  });
  def({
    id: 'clock', no: 15, name: 'Desk clock', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.burgundy, { face: 'clock' }), dial: M.flat(C.cream, 'ceramic', { dial: 1 }), bell: M.brass() },
    feats: [
      { k: 'prism', mat: 'body', depth: 3.0, poly: [[-2.9, 0], [2.9, 0], [3.0, 5.0], [2.2, 6.4], [0, 7.0], [-2.2, 6.4], [-3.0, 5.0]] },
      { k: 'cyl', mat: 'dial', r0: 2.05, h: 0.28, p: [0, 4.2, 1.64], q: rx(90) },
      { k: 'sph', mat: 'bell', r: [0.75, 0.6, 0.75], p: [0, 7.45, 0] },
    ],
  });
  def({
    id: 'woodbox', no: 16, name: 'Decorative box', cat: 'Household', snd: 'wood',
    mats: { body: M.wood(C.walnutL, { face: 'chest' }), lid: M.wood(C.walnutL, { face: 'chestlid' }), clasp: M.brass() },
    feats: [
      { k: 'box', mat: 'body', size: [8.4, 3.4, 5.4], p: [0, 1.7, 0] },
      { k: 'box', mat: 'lid', size: [8.8, 1.3, 5.8], taper: [0.97, 0.88], p: [0, 4.05, 0] },
      { k: 'box', mat: 'clasp', size: [1.0, 1.2, 0.3], p: [0, 3.4, 2.85] },
    ],
  });

  // ---------------- C. Paper and stationery ----------------
  def({
    id: 'journal', no: 17, name: 'Thick old journal', cat: 'Paper', snd: 'book',
    mats: { body: M.paper({ face: 'journal' }) },
    feats: [{ k: 'box', mat: 'body', size: [9.4, 3.4, 12.6], taper: [0.985, 0.99], skew: [0.12, -0.08], p: [0, 1.7, 0] }],
  });
  def({
    id: 'letter', no: 18, name: 'Folded letter', cat: 'Paper', snd: 'paper',
    mats: { body: M.paper({ script: 1 }) },
    feats: [
      { k: 'box', mat: 'body', size: [9.6, 0.1, 3.7], p: [0, 0.42, -1.8], q: rx(-13) },
      { k: 'box', mat: 'body', size: [9.6, 0.1, 3.7], p: [0, 0.42, 1.8], q: rx(13) },
    ],
  });
  def({
    id: 'envelopes', no: 19, name: 'Bundle of envelopes', cat: 'Paper', snd: 'paper',
    mats: { a: M.paper({ envelope: 1, base: '#e6d2a8' }), b: M.paper({ envelope: 1, base: '#d9c7a2' }), c: M.paper({ envelope: 1, base: '#e9ddc3' }), d: M.paper({ envelope: 1, base: '#cfb88f', stamp: 1 }) },
    feats: [
      { k: 'box', mat: 'a', size: [9.0, 0.36, 5.6], p: [0, 0.18, 0], q: ry(-4) },
      { k: 'box', mat: 'b', size: [9.0, 0.36, 5.6], p: [0.25, 0.55, 0.15], q: ry(5) },
      { k: 'box', mat: 'c', size: [9.0, 0.36, 5.6], p: [-0.2, 0.92, -0.1], q: ry(-2) },
      { k: 'box', mat: 'd', size: [9.0, 0.36, 5.6], p: [0.15, 1.29, 0.1], q: ry(7) },
    ],
  });
  def({
    id: 'scroll', no: 20, name: 'Rolled parchment', cat: 'Paper', snd: 'paper',
    mats: { body: M.paper({ base: '#e3cf9f', roll: 1 }), end: M.paper({ base: '#d8bf88', rollEnd: 1 }) },
    feats: [
      { k: 'cyl', mat: 'body', r0: 1.05, h: 10.2, p: [0, 1.36, 0], q: rz(90) },
      { k: 'cyl', mat: 'end', r0: 1.36, r1: 1.3, h: 0.55, p: [-5.35, 1.36, 0], q: rz(90) },
      { k: 'cyl', mat: 'end', r0: 1.3, r1: 1.36, h: 0.55, p: [5.35, 1.36, 0], q: rz(90) },
    ],
  });
  def({
    id: 'notebook', no: 21, name: 'Miniature notebook', cat: 'Paper', snd: 'book',
    mats: { body: M.paper({ face: 'notebook' }) },
    feats: [{ k: 'box', mat: 'body', size: [6.0, 1.0, 8.6], p: [0, 0.5, 0] }],
  });
  def({
    id: 'postcards', no: 22, name: 'Stack of postcards', cat: 'Paper', snd: 'paper',
    mats: { a: M.paper({ card: 'sea', base: '#ece0c4' }), b: M.paper({ card: 'hill', base: '#e5d6b6' }), c: M.paper({ card: 'script', base: '#efe5cf' }) },
    feats: [
      { k: 'box', mat: 'b', size: [8.8, 0.16, 5.8], p: [0, 0.08, 0], q: ry(3) },
      { k: 'box', mat: 'c', size: [8.8, 0.16, 5.8], p: [-0.2, 0.25, 0.1], q: ry(-5) },
      { k: 'box', mat: 'a', size: [8.8, 0.16, 5.8], p: [0.3, 0.42, -0.1], q: ry(8) },
      { k: 'box', mat: 'b', size: [8.8, 0.16, 5.8], p: [0.0, 0.59, 0.2], q: ry(-2) },
      { k: 'box', mat: 'a', size: [8.8, 0.16, 5.8], p: [-0.25, 0.76, -0.1], q: ry(-9) },
    ],
  });

  // ---------------- D. Curious objects ----------------
  def({
    id: 'bird', no: 23, name: 'Sculptural bird', cat: 'Curious', snd: 'ceramic',
    mats: { body: M.glaze(C.teal, C.dusty, { glazeAt: 0.55, drips: 5, glazeFrom: 'top', speck: C.cream, feathers: 1 }), beak: M.flat(C.mustard, 'ceramic'), stand: M.wood(C.umber, { plain: 1 }) },
    feats: [
      { k: 'lathe', mat: 'stand', prof: [[1.7, 0], [1.75, 0.45], [0.35, 0.75]] },
      { k: 'cap', mat: 'stand', a: [0, 0.6, 0], b: [0, 1.7, 0], r: 0.17 },
      { k: 'sph', mat: 'body', r: [2.35, 1.55, 1.55], p: [-0.1, 3.0, 0], q: rz(14) },
      { k: 'sph', mat: 'body', r: [1.0, 1.0, 0.95], p: [1.95, 4.35, 0] },
      { k: 'cyl', mat: 'beak', r0: 0.36, r1: 0.02, h: 1.25, p: [3.4, 4.2, 0], q: rz(-98) },
      { k: 'prism', mat: 'body', depth: 0.5, poly: [[-2.0, 2.2], [-4.3, 3.4], [-4.0, 4.0], [-1.6, 3.4]] },
    ],
  });
  def({
    id: 'horse', no: 24, name: 'Wooden horse', cat: 'Curious', snd: 'wood',
    mats: { body: M.wood(C.walnutL, { horse: 1 }), base: M.wood(C.mustard, { plain: 1, painted: 1 }), mane: M.flat(C.ink, 'wood') },
    feats: [
      { k: 'box', mat: 'base', size: [8.6, 0.6, 2.8], p: [0, 0.3, 0] },
      { k: 'cap', mat: 'body', a: [-2.5, 0.65, 0.75], b: [-2.6, 3.2, 0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [-2.5, 0.65, -0.75], b: [-2.6, 3.2, -0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [2.4, 0.65, 0.75], b: [2.5, 3.2, 0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [2.4, 0.65, -0.75], b: [2.5, 3.2, -0.75], r: 0.33 },
      { k: 'cap', mat: 'body', a: [-2.6, 3.75, 0], b: [2.5, 3.75, 0], r: 1.2 },
      { k: 'cap', mat: 'body', a: [2.6, 4.3, 0], b: [3.6, 6.3, 0], r: 0.72 },
      { k: 'cap', mat: 'body', a: [3.5, 6.6, 0], b: [5.0, 5.95, 0], r: 0.56 },
      { k: 'cap', mat: 'mane', a: [-3.7, 4.0, 0], b: [-4.5, 2.3, 0], r: 0.28 },
      { k: 'cap', mat: 'mane', a: [3.25, 7.05, 0.25], b: [3.45, 7.65, 0.3], r: 0.17 },
    ],
  });
  def({
    id: 'mask', no: 25, name: 'Ornamental mask', cat: 'Curious', snd: 'wood',
    mats: { body: M.wood(C.burgundy, { mask: 1 }), horn: M.flat(C.cream, 'ceramic', { mottle: C.creamD }) },
    feats: [
      { k: 'dome', mat: 'body', r: [3.3, 2.0, 4.3] },
      { k: 'cyl', mat: 'horn', r0: 0.55, r1: 0.08, h: 2.4, p: [-2.0, 1.15, -4.5], q: qMul(ry(25), rx(-62)) },
      { k: 'cyl', mat: 'horn', r0: 0.55, r1: 0.08, h: 2.4, p: [2.0, 1.15, -4.5], q: qMul(ry(-25), rx(-62)) },
    ],
  });
  def({
    id: 'key', no: 26, name: 'Little brass key', cat: 'Curious', snd: 'metal',
    mats: { body: M.brass() },
    feats: [
      { k: 'ring', mat: 'body', R: 0.9, r: 0.26, caps: 8, p: [0, 0.26, 0], q: rx(90) },
      { k: 'cap', mat: 'body', a: [0, 0.26, 1.1], b: [0, 0.26, 5.0], r: 0.23 },
      { k: 'box', mat: 'body', size: [1.0, 0.44, 0.9], p: [0.6, 0.22, 4.5] },
    ],
  });
  def({
    id: 'flower', no: 27, name: 'Decorative flower', cat: 'Curious', snd: 'paper',
    mats: { bloom: M.glaze(C.mustard, C.ochre, { glazeAt: 0.3, drips: 0, glazeFrom: 'bottom', petals: 1, inner: C.siennaD }), stem: M.flat(C.greenD, 'wood'), leaf: M.flat(C.green, 'paper', { leaf: 1 }) },
    feats: [
      { k: 'tube', mat: 'stem', r: 0.15, caps: 3, pts: [[0, 0, 0], [0.4, 3.0, 0], [0.1, 6.0, 0], [0.5, 8.2, 0]] },
      { k: 'lathe', mat: 'bloom', open: 1, wob: 0.06, prof: [[0.35, 0], [0.6, 0.6], [1.6, 1.4], [2.7, 1.95]], p: [0.5, 8.0, 0], q: rz(-12) },
      { k: 'prism', mat: 'leaf', depth: 0.1, poly: [[0.3, 3.2], [2.4, 4.4], [2.9, 5.2], [1.9, 5.0], [0.3, 3.7]] },
    ],
  });
  def({
    id: 'sculpture', no: 28, name: 'Wooden sculpture', cat: 'Curious', snd: 'wood',
    mats: { a: M.wood(C.olive, { plain: 1 }), b: M.wood(C.walnutL, { plain: 1 }), c: M.wood(C.siennaD, { plain: 1 }) },
    feats: [
      { k: 'sph', mat: 'a', r: [2.5, 1.25, 1.9], p: [0, 1.25, 0] },
      { k: 'sph', mat: 'b', r: [1.5, 1.75, 1.3], p: [0.7, 3.55, 0], q: rz(-18) },
      { k: 'sph', mat: 'c', r: [0.95, 0.95, 0.95], p: [-0.25, 5.7, 0.15] },
      { k: 'cap', mat: 'c', a: [1.3, 3.9, 0], b: [3.1, 5.3, 0.2], r: 0.24 },
    ],
  });

  // Derive parts once.
  const byId = {};
  for (const d of D) {
    d.parts = [];
    d.feats.forEach((f, i) => { const ps = featParts(f); for (const p of ps) p.feat = i; d.parts.push(...ps); });
    byId[d.id] = d;
  }

  return { list: D, byId, catmull, ringPath, bowlRows, boxCorners, C };
})();
