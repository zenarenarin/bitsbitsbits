// =====================================================================
// The endless field: sections assembled from reusable templates.
// World units are metres along the path; PPM pixels per metre on the
// gameplay plane.
// =====================================================================
const PPM = 8;
// what each obstacle asks of the player
//   low  : run to vault it, walk to step over, winded = trip
//   hole : run to leap it, anything slower falls in
//   snag : wire or tines at chest height, walk to duck under, running snags
// Obstacle hitboxes: x0..x1 along the path, and a height band in pixels
// above the path that the traveller's body has to clear.
const OBSTACLES = {
  pumpkin: { k: 'low', w: 0.9, band: [0, 5], major: false },
  root: { k: 'low', w: 1.1, band: [0, 5], major: false },
  board: { k: 'low', w: 1.3, band: [0, 5], major: false },
  log: { k: 'low', w: 1.6, band: [0, 6], major: false },
  pit: { k: 'hole', w: 1.8, band: [-12, 0], major: true },
  wire: { k: 'snag', w: 1.3, band: [13, 19], major: true },
  harrow: { k: 'snag', w: 1.6, band: [12, 18], major: true }
};
// Hiding places. conceal: how well it hides you when the creature checks it (0..1).
// comfort: seconds before staying put starts to make a check more likely to find you.
// radius: how far either side of the object you can let go and still slip in.
// at: where the traveller settles, as a fraction of the width.
const HIDE_SPOTS = {
  corn: { conceal: 0.75, comfort: 5, radius: -0.2, at: -1, label: 'CORN' },
  hay: { conceal: 0.5, comfort: 4, radius: 0.8, w: 3.0, at: 0.55, label: 'HAYSTACK' },
  cart: { conceal: 0.55, comfort: 4.5, radius: 0.8, w: 3.4, at: 0.45, label: 'CART' },
  tree: { conceal: 0.8, comfort: 6, radius: 0.9, w: 2.4, at: 0.5, label: 'HOLLOW TREE' },
  shed: { conceal: 0.85, comfort: 7, radius: 1.0, w: 4.2, at: 0.36, label: 'SHED' }
};
const SECTION_TEMPLATES = [
  { id: 'harvest', min: 0, w: 3, L: 46, items: [['low', 12, 'pumpkin'], ['hide', 27, 1]], props: [['scarecrow', 18], ['pumpkins', 6]] },
  { id: 'rows', min: 0, w: 2, L: 48, items: [['hide', 8, 0.8], ['low', 22, 'root'], ['low', 34, 'board']], props: [['fence', 14], ['fence', 26]] },
  { id: 'patch', min: 0, w: 2, L: 46, items: [['low', 9, 'pumpkin'], ['low', 18, 'log'], ['hide', 30, 1]], props: [['pumpkins', 4], ['pumpkins', 16], ['lantern', 24]] },
  { id: 'refuge', min: 0, w: 1, L: 46, items: [['hide', 10, 1.2], ['low', 24, 'root'], ['hide', 34, 0.7]], props: [['scarecrow', 28]] },
  { id: 'hollows', min: 0.06, w: 3, L: 46, items: [['hole', 11, 1.8], ['low', 23, 'board'], ['hide', 33, 1]], props: [['cart', 18]] },
  { id: 'wire', min: 0.16, w: 3, L: 48, items: [['snag', 12, 'wire'], ['hide', 26, 1], ['low', 39, 'pumpkin']], props: [['fence', 8], ['post', 30]] },
  { id: 'woodpile', min: 0.12, w: 2, L: 46, items: [['low', 9, 'log'], ['hide', 20, 0.9], ['low', 33, 'log']], props: [['fence', 26]] },
  { id: 'machinery', min: 0.3, w: 2, L: 50, items: [['snag', 10, 'harrow'], ['hole', 22, 2.0], ['hide', 35, 0.9]], props: [['cart', 4], ['lantern', 30]] },
  { id: 'scarecrows', min: 0.2, w: 2, L: 48, items: [['low', 10, 'root'], ['hole', 20, 1.7], ['hide', 32, 0.9]], props: [['scarecrow', 6], ['scarecrow', 16], ['scarecrow', 26]] },
  { id: 'open', min: 0.1, w: 2, L: 44, items: [['low', 12, 'log'], ['low', 26, 'pumpkin'], ['hide', 38, 0.9]], props: [['scarecrow', 20]] },
  { id: 'shelter', min: 0, w: 1, L: 44, items: [['hide', 8, 0.8], ['hide', 22, 0.8], ['low', 34, 'root']], props: [['lantern', 16]] },
  { id: 'gauntlet', min: 0.55, w: 2, L: 56, items: [['hole', 8, 1.9], ['low', 16, 'log'], ['snag', 25, 'wire'], ['hole', 34, 2.2], ['hide', 45, 0.8]], props: [['post', 20]] }
];

function createWorld(seed) {
  const W = { feats: [], props: [], genX: 0, rng: makeRng(seed), last: '', sections: 0, pool: [], lastHide: 0, lastType: '' };
  const take = () => W.pool.pop() || {};
  function add(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.feats.push(f); return f; }
  function prop(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.props.push(f); return f; }
  let lastObs = -99;
  // never let the field run longer than a breath without somewhere to hide
  const hideLimit = d => lerp(40, 50, d);
  function obstacle(kind, x, v, d) {
    if (x < lastObs + 6) x = lastObs + 6;
    if (x - W.lastHide > hideLimit(d)) { hide(Math.max(lastObs + 3, W.lastHide + hideLimit(d) * 0.55), 0.8, d); x = Math.max(x, lastObs + 6); }
    const name = kind === 'hole' ? 'pit' : v, spec = OBSTACLES[name];
    let w = spec.w;
    if (kind === 'hole') w = clamp(v * lerp(0.9, 1.15, d) * (0.92 + W.rng() * 0.16), 1.4, 2.6);
    add({ k: kind, v: name, obs: true, band: spec.band, major: spec.major, x0: x, x1: x + w, done: false, hit: false });
    lastObs = x + w;
    return x + w;
  }
  // which kind of hiding place: the long, safe ones get rarer as the run goes on
  function pickSpot(d) {
    const wts = { corn: lerp(0.4, 0.6, d), hay: 0.22, cart: lerp(0.16, 0.12, d), tree: lerp(0.12, 0.07, d), shed: lerp(0.1, 0.04, d) };
    if (W.lastType && W.lastType !== 'corn') wts[W.lastType] *= 0.3;
    let tot = 0; for (const k in wts) tot += wts[k];
    let r = W.rng() * tot;
    for (const k in wts) { r -= wts[k]; if (r <= 0) return k; }
    return 'corn';
  }
  function hide(x, scale, d, forceType) {
    const type = forceType || pickSpot(d), spec = HIDE_SPOTS[type];
    const len = type === 'corn' ? Math.max(2.4, lerp(6.2, 3.4, d) * scale * (0.88 + W.rng() * 0.24)) : spec.w;
    if (x - W.lastHide > hideLimit(d)) x = W.lastHide + hideLimit(d) * 0.8;
    const pad = Math.max(0, spec.radius) + 0.5;
    if (x < lastObs + 2.5 + pad) x = lastObs + 2.5 + pad;
    add({ k: 'hide', type, conceal: spec.conceal, comfort: spec.comfort, radius: spec.radius, at: spec.at, x0: x, x1: x + len, rustle: 0, glint: 0 });
    W.lastHide = x + len; W.lastType = type;
    // obstacles may follow a hiding place closely, but never inside it or its reach
    lastObs = type === 'corn' ? x + len - 3.5 : x + len + pad - 5.5;
  }
  function crows(x) {
    for (const f of W.feats) if (f.k === 'hide' && x + 2 > f.x0 - 1 && x < f.x1 + 1) return;
    add({ k: 'crows', x0: x, x1: x + 2, done: false, n: 3 + ((W.rng() * 3) | 0) });
  }
  function decor(kind, x) {
    if (kind === 'pumpkins') {
      const n = 2 + ((W.rng() * 3) | 0);
      for (let i = 0; i < n; i++) prop({ k: 'pumpkin', x: x + W.rng() * 8, layer: W.rng() < 0.55 ? 'back' : 'front', lit: 0, size: W.rng() < 0.3 ? 1 : 0 });
    } else {
      let px = x + (W.rng() - 0.5) * 3;
      for (const f of W.feats) if (f.k === 'hide' && f.type !== 'corn' && px > f.x0 - 4 && px < f.x1 + 4) px = f.x1 + 5;
      prop({ k: kind, x: px, look: 0, lit: 0 });
    }
  }
  function intro() {
    // the first two hiding places teach the two kinds of cover: the corn, then a real object
    hide(13, 1.05, 0, 'corn');
    obstacle('low', 25, 'pumpkin', 0);
    hide(36, 1, 0, 'hay');
    decor('scarecrow', 8); decor('pumpkins', 18); decor('fence', 30);
    W.genX = 50;
  }
  function section(d, stage) {
    const pool = SECTION_TEMPLATES.filter(t => t.min <= d && t.id !== W.last);
    let tot = 0; for (const t of pool) tot += t.w;
    let r = W.rng() * tot, t = pool[0];
    for (const c of pool) { r -= c.w; if (r <= 0) { t = c; break; } }
    W.last = t.id;
    const sl = lerp(1, 1.32, d), x0 = W.genX;
    for (const it of t.items) {
      const at = x0 + it[1] * sl + (W.rng() - 0.5) * 3;
      if (it[0] === 'hide') hide(at, it[2], d);
      else obstacle(it[0], at, it[2], d);
    }
    for (const p of t.props) decor(p[0], x0 + p[1] * sl);
    // crows on the path: run through them and they give you away
    if (d > 0.08 && W.rng() < lerp(0.2, 0.45, d)) crows(x0 + W.rng() * t.L * sl);
    // later stages: more pumpkins and abandoned structures, more scarecrows
    if (stage >= 1 && W.rng() < 0.6) decor('pumpkins', x0 + W.rng() * t.L);
    if (stage >= 1 && W.rng() < 0.35) decor(W.rng() < 0.5 ? 'cart' : 'post', x0 + W.rng() * t.L);
    if (stage >= 2 && W.rng() < 0.5) decor('scarecrow', x0 + W.rng() * t.L);
    W.genX = Math.max(x0 + t.L * sl, lastObs + 6);
    if (W.genX - W.lastHide > hideLimit(d) - 6) { hide(Math.max(lastObs + 3, W.lastHide + hideLimit(d) * 0.6), 0.8, d); W.genX = Math.max(W.genX, lastObs + 6); }
    W.sections++;
  }
  W.reset = function (sd) {
    for (const f of W.feats) W.pool.push(f);
    for (const f of W.props) W.pool.push(f);
    W.feats.length = 0; W.props.length = 0; W.rng = makeRng(sd); W.last = ''; W.sections = 0; lastObs = -99; W.lastHide = 0; W.lastType = '';
    intro();
  };
  W.update = function (dist, d, stage) {
    while (W.genX < dist + 90) section(d, stage);
    // recycle everything well behind the player
    for (const arr of [W.feats, W.props]) {
      let j = 0;
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i], end = f.x1 !== undefined ? f.x1 : f.x;
        if (end < dist - 30) W.pool.push(f); else arr[j++] = f;
      }
      arr.length = j;
    }
  };
  // the hiding place whose reach covers x, if any
  W.zoneAt = function (x) {
    for (const f of W.feats) if (f.k === 'hide' && x >= f.x0 - f.radius && x <= f.x1 + f.radius) return f;
    return null;
  };
  W.nextHide = function (x) {
    let best = null;
    for (const f of W.feats) if (f.k === 'hide' && f.x1 + f.radius > x && (!best || f.x0 < best.x0)) best = f;
    return best;
  };
  W.nextObstacle = function (x) {
    let best = null;
    for (const f of W.feats) if (f.obs && !f.done && f.x1 > x && (!best || f.x0 < best.x0)) best = f;
    return best;
  };
  W.reset(seed);
  return W;
}
