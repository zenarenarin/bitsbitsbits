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
const SECTION_TEMPLATES = [
  { id: 'harvest', min: 0, w: 3, L: 46, items: [['low', 12, 'pumpkin'], ['hide', 27, 1]], props: [['scarecrow', 18], ['pumpkins', 6]] },
  { id: 'rows', min: 0, w: 2, L: 48, items: [['hide', 8, 0.8], ['low', 22, 'root'], ['low', 34, 'board']], props: [['fence', 14], ['fence', 26]] },
  { id: 'patch', min: 0, w: 2, L: 46, items: [['low', 9, 'pumpkin'], ['low', 18, 'pumpkin'], ['hide', 30, 1]], props: [['pumpkins', 4], ['pumpkins', 16], ['lantern', 24]] },
  { id: 'refuge', min: 0, w: 1, L: 46, items: [['hide', 10, 1.2], ['low', 24, 'root'], ['hide', 34, 0.7]], props: [['scarecrow', 28]] },
  { id: 'hollows', min: 0.06, w: 3, L: 46, items: [['hole', 11, 1.8], ['low', 23, 'board'], ['hide', 33, 1]], props: [['cart', 18]] },
  { id: 'wire', min: 0.16, w: 3, L: 48, items: [['snag', 12, 'wire'], ['hide', 26, 1], ['low', 39, 'pumpkin']], props: [['fence', 8], ['post', 30]] },
  { id: 'machinery', min: 0.3, w: 2, L: 50, items: [['snag', 10, 'harrow'], ['hole', 22, 2.0], ['hide', 35, 0.9]], props: [['cart', 4], ['lantern', 30]] },
  { id: 'scarecrows', min: 0.2, w: 2, L: 48, items: [['low', 10, 'root'], ['hole', 20, 1.7], ['hide', 32, 0.9]], props: [['scarecrow', 6], ['scarecrow', 16], ['scarecrow', 26]] },
  { id: 'gauntlet', min: 0.55, w: 2, L: 56, items: [['hole', 8, 1.9], ['low', 16, 'board'], ['snag', 25, 'wire'], ['hole', 34, 2.2], ['hide', 45, 0.8]], props: [['post', 20]] }
];

function createWorld(seed) {
  const W = { feats: [], props: [], genX: 0, rng: makeRng(seed), last: '', sections: 0, pool: [] };
  const take = () => W.pool.pop() || {};
  function add(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.feats.push(f); return f; }
  function prop(o) { const f = take(); for (const k in f) delete f[k]; Object.assign(f, o); f.seed = (W.rng() * 1e9) | 0; W.props.push(f); return f; }
  let lastObs = -99;
  // never let the field run longer than a breath without somewhere to hide
  const hideLimit = d => lerp(40, 50, d);
  function obstacle(kind, x, v, d) {
    if (x < lastObs + 6) x = lastObs + 6;
    if (x - W.lastHide > hideLimit(d)) { hide(Math.max(lastObs + 3, W.lastHide + hideLimit(d) * 0.55), 0.8, d); x = Math.max(x, lastObs + 6); }
    let w;
    if (kind === 'hole') w = clamp(v * lerp(0.9, 1.15, d) * (0.92 + W.rng() * 0.16), 1.4, 2.6);
    else if (kind === 'snag') w = v === 'harrow' ? 1.6 : 1.3;
    else w = v === 'pumpkin' ? 0.9 : v === 'root' ? 1.1 : 1.3;
    add({ k: kind, v: kind === 'hole' ? 'pit' : v, x0: x, x1: x + w, done: false });
    lastObs = x + w;
    return x + w;
  }
  function hide(x, scale, d) {
    const len = lerp(6.2, 3.4, d) * scale * (0.88 + W.rng() * 0.24);
    if (x - W.lastHide > hideLimit(d)) x = W.lastHide + hideLimit(d) * 0.8;
    if (x < lastObs + 2.5) x = lastObs + 2.5;
    add({ k: 'hide', x0: x, x1: x + Math.max(2.4, len), rustle: 0 });
    W.lastHide = x + Math.max(2.4, len);
    lastObs = x + len - 3.5; // obstacles may follow a hiding place closely, but never inside it
  }
  function decor(kind, x) {
    if (kind === 'pumpkins') {
      const n = 2 + ((W.rng() * 3) | 0);
      for (let i = 0; i < n; i++) prop({ k: 'pumpkin', x: x + W.rng() * 8, layer: W.rng() < 0.55 ? 'back' : 'front', lit: 0, size: W.rng() < 0.3 ? 1 : 0 });
    } else prop({ k: kind, x: x + (W.rng() - 0.5) * 3, look: 0, lit: 0 });
  }
  function intro() {
    hide(13, 1.05, 0);
    obstacle('low', 25, 'pumpkin', 0);
    hide(36, 1, 0);
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
    W.feats.length = 0; W.props.length = 0; W.rng = makeRng(sd); W.last = ''; W.sections = 0; lastObs = -99; W.lastHide = 0;
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
  W.zoneAt = function (x) {
    for (const f of W.feats) if (f.k === 'hide' && x >= f.x0 + 0.2 && x <= f.x1 - 0.2) return f;
    return null;
  };
  W.nextObstacle = function (x) {
    let best = null;
    for (const f of W.feats) if (f.k !== 'hide' && !f.done && f.x1 > x && (!best || f.x0 < best.x0)) best = f;
    return best;
  };
  W.reset(seed);
  return W;
}
