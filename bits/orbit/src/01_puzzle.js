// ORBIT — intersection logic puzzle. Pure logic: no rendering, no theme, no SDK.
//
// Board: five concentric rings of twelve segments. Ring 0 (the centre ring) is
// fixed and carries the spectrum in order, families 0..11 clockwise, so it is
// also the legend for every "steps apart" and "next colour" rule. Rings 1..4
// turn independently in 30-degree steps.
//
// An intersection is one of the twelve radial columns. A condition says what the
// pinned rings must show at one column. Conditions are revealed in stages; a
// stage opens only when every revealed condition holds at the same time.
//
// The state space is the four movable offsets: 12^4 = 20,736 states, small
// enough to search exhaustively, so every puzzle is verified by a BFS solver.

const SEGMENTS = 12;
const STEP = TAU / SEGMENTS; // 30 degrees
const RINGS = 5;
const MOVABLE = RINGS - 1;
const NSTATES = Math.pow(SEGMENTS, MOVABLE); // 20,736
const POW = [0, 1, 12, 144, 1728];
const RING_NAMES = ['centre ring', 'second ring', 'third ring', 'fourth ring', 'outer ring'];
const HOURS = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

function circDist(a, b) { const d = mod(a - b, SEGMENTS); return Math.min(d, SEGMENTS - d); }
// Shortest signed rotation (in segments) for an offset difference, in (-6, 6].
function shortestSteps(o) {
  const m = mod(o, SEGMENTS);
  return m > SEGMENTS / 2 ? m - SEGMENTS : m;
}

// ---- State encoding -------------------------------------------------------------
// state = o1 + 12*o2 + 144*o3 + 1728*o4 (each offset taken mod 12).
function stateIndex(rot) {
  let s = 0;
  for (let k = MOVABLE; k >= 1; k--) s = s * SEGMENTS + mod(rot[k], SEGMENTS);
  return s;
}
function stateOffsets(s) {
  const o = [0];
  for (let k = 1; k <= MOVABLE; k++) { o.push(s % SEGMENTS); s = Math.floor(s / SEGMENTS); }
  return o;
}
function stateDistance(a, b) {
  let d = 0;
  for (let k = 1; k <= MOVABLE; k++) { d += circDist(a % SEGMENTS, b % SEGMENTS); a = Math.floor(a / SEGMENTS); b = Math.floor(b / SEGMENTS); }
  return d;
}

// The family ring k shows at board position p (0 = 12 o'clock, clockwise) when
// the ring is turned by `off` steps clockwise.
function famAt(seqs, k, off, p) { return seqs[k][mod(p - off, SEGMENTS)]; }

// ---- Condition library ---------------------------------------------------------------
// Every condition is a predicate on the family IDs `f` shown by its pinned rings
// (listed inner to outer) at its position. Appearance never enters into it.
// Exactly one family appears exactly twice and every other family once, which is
// the same as: exactly one equal pair among the pins (a triple makes three).
function pairTest(f) {
  let eq = 0;
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (f[i] === f[j]) eq++;
  return eq === 1;
}
function distinctCount(f) {
  let n = 0;
  for (let i = 0; i < f.length; i++) { let dup = false; for (let j = 0; j < i; j++) if (f[j] === f[i]) { dup = true; break; } if (!dup) n++; }
  return n;
}

const CONDITION_TYPES = {
  // A. TRIPLE: the three pinned rings show one family.
  triple: {
    label: 'Triple',
    test: f => f[0] === f[1] && f[1] === f[2],
    progress: f => (f[0] === f[1] && f[1] === f[2]) ? 1 : (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) ? 0.5 : 0,
    text: () => 'All three pins show one colour'
  },
  // B. PAIR: exactly two pinned rings share a family; the rest all differ.
  pair: {
    label: 'Pair',
    test: f => pairTest(f),
    progress: f => pairTest(f) ? 1 : (distinctCount(f) < f.length ? 0.5 : 0),
    text: c => c.rings.length === 3 ? 'Exactly two of the three pins match' : 'Exactly one pair of pins match; the rest differ'
  },
  // C. CONTRAST: the two pinned families are at least d steps apart on the spectrum.
  contrast: {
    label: 'Contrast',
    test: (f, c) => circDist(f[0], f[1]) >= c.d,
    progress: (f, c) => Math.min(1, circDist(f[0], f[1]) / c.d),
    text: c => c.d >= 6 ? 'The two pins sit opposite on the centre ring' : 'The two pins are at least ' + c.d + ' steps apart on the centre ring'
  },
  // D. ODD ONE: every round pin shows one family; the diamond pin shows another.
  odd: {
    label: 'Odd one',
    test: (f, c) => {
      let F = -1;
      for (let i = 0; i < f.length; i++) {
        if (i === c.odd) continue;
        if (F < 0) F = f[i]; else if (f[i] !== F) return false;
      }
      return f[c.odd] !== F;
    },
    progress: (f, c) => {
      let F = -1, same = true;
      for (let i = 0; i < f.length; i++) { if (i === c.odd) continue; if (F < 0) F = f[i]; else if (f[i] !== F) same = false; }
      return same ? (f[c.odd] !== F ? 1 : 0.5) : 0;
    },
    text: c => c.rings.length === 3 ? 'The round pins match; the diamond differs' : 'The round pins all match; the diamond differs'
  },
  // E. SEQUENCE: inner to outer, each pin is the next family (step +1 = clockwise
  // on the centre ring, -1 = anticlockwise).
  sequence: {
    label: 'Sequence',
    test: (f, c) => {
      for (let i = 0; i + 1 < f.length; i++) if (f[i + 1] !== mod(f[i] + c.step, SEGMENTS)) return false;
      return true;
    },
    progress: (f, c) => {
      let n = 0;
      for (let i = 0; i + 1 < f.length; i++) if (f[i + 1] === mod(f[i] + c.step, SEGMENTS)) n++;
      return n / (f.length - 1);
    },
    text: c => 'Inside out, each pin is the next colour ' + (c.step > 0 ? 'clockwise' : 'anticlockwise') + ' on the centre ring'
  },
  // F. MISSING: family `fam` appears on none of the pinned rings.
  missing: {
    label: 'Missing',
    test: (f, c) => f.indexOf(c.fam) < 0,
    progress: (f, c) => f.indexOf(c.fam) < 0 ? 1 : 0,
    text: () => 'This colour appears on none of the pins'
  },
  // G. ALL DIFFERENT: every pinned ring shows a different family.
  alldiff: {
    label: 'All different',
    test: f => distinctCount(f) === f.length,
    progress: f => (distinctCount(f) - 1) / (f.length - 1),
    text: () => 'Every pin shows a different colour'
  }
};

function condFams(seqs, cond, rot) {
  const f = new Array(cond.rings.length);
  for (let i = 0; i < cond.rings.length; i++) { const k = cond.rings[i]; f[i] = famAt(seqs, k, k === 0 ? 0 : rot[k], cond.pos); }
  return f;
}
function condHolds(seqs, cond, rot) { return CONDITION_TYPES[cond.type].test(condFams(seqs, cond, rot), cond); }

// Satisfying mask over the whole state space. A condition depends only on the
// movable rings it pins, so it is evaluated over those rings' offsets (at most
// 12^3 combinations) and the answer is spread across all 20,736 states.
function satMask(seqs, cond) {
  const T = CONDITION_TYPES[cond.type];
  const n = cond.rings.length;
  const cols = cond.rings.map(k => { const c = []; for (let o = 0; o < SEGMENTS; o++) c.push(famAt(seqs, k, k === 0 ? 0 : o, cond.pos)); return c; });
  const mov = cond.rings.filter(k => k > 0);
  const combos = Math.pow(SEGMENTS, mov.length);
  const table = new Uint8Array(combos);
  const f = new Array(n), o = [0, 0, 0, 0, 0];
  for (let c = 0; c < combos; c++) {
    let x = c;
    for (let j = 0; j < mov.length; j++) { o[mov[j]] = x % SEGMENTS; x = Math.floor(x / SEGMENTS); }
    for (let i = 0; i < n; i++) f[i] = cols[i][o[cond.rings[i]]];
    table[c] = T.test(f, cond) ? 1 : 0;
  }
  const m = new Uint8Array(NSTATES);
  const mul = mov.map((_, j) => Math.pow(SEGMENTS, j));
  for (let s = 0; s < NSTATES; s++) {
    let c = 0;
    for (let j = 0; j < mov.length; j++) c += (Math.floor(s / POW[mov[j]]) % SEGMENTS) * mul[j];
    m[s] = table[c];
  }
  return m;
}

// ---- Solver: multi-source BFS over the 20,736 states ------------------------------------
// One move turns one ring one step either way. Returns the distance from every
// state to the nearest state in `goal` (a mask), or to a single state index.
function bfs(goal) {
  const dist = new Uint8Array(NSTATES).fill(255);
  const q = new Int32Array(NSTATES);
  let head = 0, tail = 0;
  if (typeof goal === 'number') { dist[goal] = 0; q[tail++] = goal; }
  else for (let s = 0; s < NSTATES; s++) if (goal[s]) { dist[s] = 0; q[tail++] = s; }
  while (head < tail) {
    const s = q[head++], d = dist[s] + 1;
    for (let k = 1; k <= MOVABLE; k++) {
      const p = POW[k], digit = Math.floor(s / p) % SEGMENTS;
      const up = digit === SEGMENTS - 1 ? s - (SEGMENTS - 1) * p : s + p;
      const dn = digit === 0 ? s + (SEGMENTS - 1) * p : s - p;
      if (dist[up] > d) { dist[up] = d; q[tail++] = up; }
      if (dist[dn] > d) { dist[dn] = d; q[tail++] = dn; }
    }
  }
  return dist;
}
function andMasks(masks) {
  const m = new Uint8Array(NSTATES).fill(1);
  masks.forEach(x => { for (let s = 0; s < NSTATES; s++) m[s] &= x[s]; });
  return m;
}
function countMask(m) { let n = 0; for (let s = 0; s < NSTATES; s++) n += m[s]; return n; }

// ---- Difficulty presets -----------------------------------------------------------------
// Difficulty comes from how the conditions interact, measured by the solver:
// how many arrangements satisfy each stage, how far the start is, and how much of
// a stage's arrangement the next reveal forces you to undo. Not from counts.
const PUZZLE_PRESETS = {
  gentle: {
    id: 'gentle', label: 'Gentle', stages: [3, 2, 2],
    s1: [40, 1200], s2: [3, 160], s3: [1, 3], ratio2: 0.4, ratio3: 0.75,
    s1Dist: [3, 8], par: [8, 18], route: [12, 30]
  },
  standard: {
    id: 'standard', label: 'Standard', stages: [3, 2, 2],
    s1: [16, 700], s2: [2, 90], s3: [1, 2], ratio2: 0.3, ratio3: 0.6,
    s1Dist: [4, 10], par: [11, 22], route: [18, 40]
  },
  deep: {
    id: 'deep', label: 'Deep', stages: [3, 2, 2],
    s1: [8, 400], s2: [2, 50], s3: [1, 1], ratio2: 0.25, ratio3: 0.5,
    s1Dist: [5, 11], par: [13, 24], route: [22, 48]
  }
};

// Condition types the planner draws from, weighted. Which clue lands in which
// stage is decided afterwards by the solver, not by type.
const PLAN_POOL = { triple: 3, contrast: 3, odd: 3, pair: 2, sequence: 2, alldiff: 2, missing: 2 };
const STRONG = { triple: 1, sequence: 1 };

function weightedPick(r, weights, exclude) {
  const keys = Object.keys(weights).filter(k => !exclude || !exclude(k));
  let sum = 0; keys.forEach(k => { sum += weights[k]; });
  let x = r() * sum;
  for (let i = 0; i < keys.length; i++) { x -= weights[keys[i]]; if (x <= 0) return keys[i]; }
  return keys[keys.length - 1];
}
// Rings for a condition, favouring rings that so far take part in fewest
// conditions, so every ring ends up shared between clues.
function sampleRings(r, n, allowCentre, usage) {
  const pool = allowCentre ? [0, 1, 2, 3, 4] : [1, 2, 3, 4];
  const keyed = pool.map(k => ({ k, w: r() + (usage ? usage[k] * 0.45 : 0) }));
  keyed.sort((x, y) => x.w - y.w);
  return keyed.slice(0, n).map(x => x.k).sort((a, b) => a - b);
}

// Propose families for a condition's pinned cells that make it true, respecting
// the fixed centre ring and each ring's unused families. null if none found.
function proposeCells(r, cond, used) {
  const n = cond.rings.length, T = CONDITION_TYPES[cond.type];
  for (let attempt = 0; attempt < 400; attempt++) {
    const v = new Array(n);
    const F = r.int(0, SEGMENTS - 1), G = r.int(0, SEGMENTS - 1);
    for (let i = 0; i < n; i++) {
      switch (cond.type) {
        case 'triple': v[i] = F; break;
        case 'odd': v[i] = i === cond.odd ? G : F; break;
        case 'sequence': v[i] = mod(F + i * cond.step, SEGMENTS); break;
        case 'pair': v[i] = (i === cond.pa || i === cond.pb) ? F : r.int(0, SEGMENTS - 1); break;
        default: v[i] = r.int(0, SEGMENTS - 1);
      }
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const k = cond.rings[i];
      if (k === 0) { if (v[i] !== cond.pos) ok = false; }
      else if (used[k][v[i]]) ok = false;
    }
    if (ok && cond.type === 'missing') {
      // The missing family is one the pins do not show, chosen so it matters:
      // prefer a family the outer pins could easily turn to.
      const avail = []; for (let x = 0; x < SEGMENTS; x++) if (v.indexOf(x) < 0) avail.push(x);
      cond.fam = r.pick(avail);
    }
    if (ok && T.test(v, cond)) return v;
  }
  return null;
}

// A ring sequence reads as its own colour composition, not a rainbow fragment:
// no three spectrum-neighbours in a row, either direction.
function hasRun(row) {
  for (let i = 0; i < SEGMENTS; i++) {
    const a = row[i], b = row[(i + 1) % SEGMENTS], c = row[(i + 2) % SEGMENTS];
    const d1 = mod(b - a, SEGMENTS), d2 = mod(c - b, SEGMENTS);
    if ((d1 === 1 && d2 === 1) || (d1 === SEGMENTS - 1 && d2 === SEGMENTS - 1)) return true;
  }
  return false;
}
// No two rings may be near-copies at any relative turn (too many coincidences
// would let one move satisfy everything at once).
function maxCoincidence(a, b) {
  let best = 0;
  for (let d = 0; d < SEGMENTS; d++) {
    let n = 0;
    for (let i = 0; i < SEGMENTS; i++) if (a[i] === b[(i + d) % SEGMENTS]) n++;
    if (n > best) best = n;
  }
  return best;
}

// One candidate: a solved board and seven conditions true on it. Returns null
// when the plan cannot be realised.
function planBoard(r, preset) {
  const total = preset.stages.reduce((a, b) => a + b, 0);
  // Positions: distinct columns, so every pin belongs to exactly one condition.
  const cols = []; for (let p = 0; p < SEGMENTS; p++) cols.push(p);
  for (let i = cols.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = cols[i]; cols[i] = cols[j]; cols[j] = t; }

  const B = [];
  for (let k = 0; k < RINGS; k++) B.push(new Array(SEGMENTS).fill(-1));
  for (let p = 0; p < SEGMENTS; p++) B[0][p] = p;
  const used = []; for (let k = 0; k < RINGS; k++) used.push(new Array(SEGMENTS).fill(false));

  const conds = [];
  const typeCount = {};
  let idx = 0;
  const usage = [0, 0, 0, 0, 0];
  let strong = 0;
  {
    for (let j = 0; j < total; j++, idx++) {
      const st = 0;
      const type = weightedPick(r, PLAN_POOL, k => (typeCount[k] || 0) >= 2 || (STRONG[k] && strong >= 2));
      if (STRONG[type]) strong++;
      typeCount[type] = (typeCount[type] || 0) + 1;
      const pos = cols[idx];
      let n = 3;
      if (type === 'contrast') n = 2;
      else if (type === 'pair' || type === 'odd') n = r.chance(0.3) ? 4 : 3;
      else if (type === 'missing') n = r.chance(0.5) ? 5 : 4;
      else if (type === 'alldiff') n = r.chance(0.5) ? 5 : 4;
      const cond = { id: idx, type, pos, stage: st, rings: sampleRings(r, n, n === 5 || r.chance(0.3), usage) };
      cond.rings.forEach(k => { usage[k]++; });
      if (type === 'contrast') cond.d = r.pick([4, 5, 5, 5, 6]);
      if (type === 'sequence') cond.step = r.chance(0.5) ? 1 : -1;
      if (type === 'odd') cond.odd = r.int(0, n - 1);
      if (type === 'pair') { cond.pa = r.int(0, n - 1); do { cond.pb = r.int(0, n - 1); } while (cond.pb === cond.pa); }
      const v = proposeCells(r, cond, used);
      if (!v) return null;
      cond.rings.forEach((k, i) => { if (k > 0) { B[k][pos] = v[i]; used[k][v[i]] = true; } });
      delete cond.pa; delete cond.pb;
      conds.push(cond);
    }
  }
  if (Object.keys(typeCount).length < 4) return null;

  // Every movable ring takes part in at least two conditions, so moves conflict.
  for (let k = 1; k <= MOVABLE; k++) {
    if (conds.filter(c => c.rings.indexOf(k) >= 0).length < 2) return null;
  }
  if (conds.filter(c => c.rings.indexOf(0) >= 0).length > 3) return null;

  // Fill the remaining cells; keep the sequences composed.
  for (let k = 1; k <= MOVABLE; k++) {
    let ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      const free = []; for (let x = 0; x < SEGMENTS; x++) if (!used[k][x]) free.push(x);
      for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const tt = free[i]; free[i] = free[j]; free[j] = tt; }
      const row = B[k].slice();
      let fi = 0;
      for (let p = 0; p < SEGMENTS; p++) if (row[p] < 0) row[p] = free[fi++];
      if (hasRun(row)) continue;
      let coincide = false;
      for (let j = 0; j < k && !coincide; j++) if (maxCoincidence(B[j], row) > 3) coincide = true;
      if (coincide) continue;
      B[k] = row; ok = true;
    }
    if (!ok) return null;
  }
  return { B, conds, total };
}

// Rejection reasons are kept for the dev report.
const PuzzleGenerator = {
  presets: PUZZLE_PRESETS,

  // Deterministic: same key and preset -> same puzzle on every device.
  generate(seedKey, presetId) {
    const preset = PUZZLE_PRESETS[presetId] || PUZZLE_PRESETS.standard;
    const rng = makeRng('orbit2-puzzle:' + seedKey + ':' + preset.id);
    const reasons = {};
    const reject = why => { reasons[why] = (reasons[why] || 0) + 1; return null; };
    for (let attempt = 1; attempt <= 300; attempt++) {
      const p = PuzzleGenerator.tryBuild(rng, preset, reject);
      if (p) { p.key = seedKey; p.attempts = attempt; p.reasons = reasons; return p; }
    }
    // Every preset is exercised across thousands of keys in dev/test_puzzle.js;
    // this is a last resort with a fixed, verified seed.
    if (seedKey === 'orbit-fallback') throw new Error('ORBIT generator exhausted');
    const p = PuzzleGenerator.generate('orbit-fallback', 'gentle');
    p.key = seedKey; p.fallback = true;
    return p;
  },

  tryBuild(r, preset, reject) {
    const plan = planBoard(r, preset);
    if (!plan) return reject('plan');
    const { B } = plan;

    // Steps 1-3: choose the solution turn of each ring; the sequences are the
    // solved board turned back by it, so every planned condition holds there.
    const sol = [0];
    for (let k = 1; k <= MOVABLE; k++) sol.push(r.int(0, SEGMENTS - 1));
    const seqs = B.map((row, k) => { const q = []; for (let i = 0; i < SEGMENTS; i++) q.push(row[mod(i + sol[k], SEGMENTS)]); return q; });
    for (let i = 0; i < plan.conds.length; i++) if (!condHolds(seqs, plan.conds[i], sol)) return reject('construction');

    const masks = plan.conds.map(c => satMask(seqs, c));
    for (let i = 0; i < masks.length; i++) if (countMask(masks[i]) > NSTATES * 0.75) return reject('weak clue');
    const bits = masks.map(toBits);

    // Steps 4-5 and 10: distribute the clues across the stages. Every split of the
    // planned clues is measured; the solver's numbers decide, not the clue types.
    const cum = []; let acc = 0;
    preset.stages.forEach(n => { acc += n; cum.push(acc); });
    const total = acc;
    const splits = [];
    // Intersections are shared between splits (stage one has only 35 choices),
    // so each distinct set of clues is intersected and counted once.
    const memo = {};
    const sizeOf = idx => {
      const key = idx.slice().sort((x, y) => x - y).join(',');
      if (memo[key] === undefined) memo[key] = popBits(andBits(idx.map(i => bits[i])));
      return memo[key];
    };
    const bounds = [preset.s1, preset.s2, preset.s3];
    stageSplits(total, preset.stages).forEach(order => {
      const sizes = [];
      for (let st = 0; st < cum.length; st++) {
        const n = sizeOf(order.slice(0, cum[st]));
        if (n < bounds[st][0] || n > bounds[st][1]) return;
        sizes.push(n);
      }
      if (sizes[1] / sizes[0] > preset.ratio2 || sizes[2] / sizes[1] > preset.ratio3) return;
      // Every clue earns its place in its stage: without it, more arrangements pass.
      for (let st = 0; st < cum.length; st++) {
        const set = order.slice(0, cum[st]);
        for (let i = st ? cum[st - 1] : 0; i < cum[st]; i++) {
          if (sizeOf(set.filter((_, j) => j !== i)) === sizes[st]) return;
        }
      }
      splits.push({ order, sizes });
    });
    if (!splits.length) return reject('no stage split');

    // Steps 6-9: scramble, then verify with the solver.
    for (let tries = 0; tries < 3 && splits.length; tries++) {
      const pick = splits.splice(r.int(0, splits.length - 1), 1)[0];
      const conds = pick.order.map((i, j) => {
        const c = Object.assign({}, plan.conds[i]);
        c.id = j; c.stage = cum.findIndex(n => j < n);
        return c;
      });
      const stageMask = cum.map(n => fromBits(andBits(pick.order.slice(0, n).map(i => bits[i]))));
      const res = PuzzleGenerator.chooseStart(r, preset, conds, pick.order.map(i => masks[i]), stageMask, cum);
      if (!res) { reject('no fair start'); continue; }
      const solutions = []; for (let s = 0; s < NSTATES; s++) if (stageMask[2][s]) solutions.push(s);
      return {
        preset: preset.id,
        ringCount: RINGS,
        seqs,
        sequences: seqs,
        conds,
        stages: preset.stages.slice(),
        cum,
        start: res.start,
        startState: res.s0,
        solution: sol,
        solutions,
        sizes: pick.sizes,
        par: res.par,
        route: res.route,
        budget: res.route + Math.max(8, Math.ceil(res.route * 0.6)),
        dist: res.dist,
        sig: hashString(JSON.stringify([seqs, conds, res.start])).toString(36)
      };
    }
    return null;
  },

  // A fair scramble: not solved, not nearly solved, every ring involved, and the
  // natural route through the stages forces the player to rethink at each reveal.
  chooseStart(r, preset, conds, masks, stageMask, cum) {
    const dist = stageMask.map(m => bfs(m));
    const solutions = []; for (let s = 0; s < NSTATES; s++) if (stageMask[2][s]) solutions.push(stateOffsets(s));
    for (let t = 0; t < 80; t++) {
      const s0 = r.int(0, NSTATES - 1);
      if (stageMask[0][s0]) continue;
      let holds1 = 0; for (let i = 0; i < cum[0]; i++) if (masks[i][s0]) holds1++;
      if (holds1 > 1) continue;
      const par = dist[2][s0];
      if (par < preset.par[0] || par > preset.par[1]) continue;
      if (dist[0][s0] < preset.s1Dist[0] || dist[0][s0] > preset.s1Dist[1]) continue;
      const st0 = stateOffsets(s0);
      // At least three of the four rings must turn to reach any solution.
      if (!solutions.every(so => { let n = 0; for (let k = 1; k <= MOVABLE; k++) if (so[k] !== st0[k]) n++; return n >= 3; })) continue;
      // The route: nearest stage-one arrangement, nearest stage-two arrangement from
      // there, then the solution. Those nearest arrangements must each break a
      // newly revealed clue.
      const from0 = bfs(s0);
      const d1 = dist[0][s0];
      const near1 = []; for (let s = 0; s < NSTATES && near1.length < 8; s++) if (stageMask[0][s] && from0[s] === d1) near1.push(s);
      if (near1.some(s => stageMask[1][s])) continue;
      let route = Infinity, rethink = true;
      near1.forEach(s1 => {
        const d2 = dist[1][s1];
        const from1 = bfs(s1);
        for (let s = 0; s < NSTATES; s++) {
          if (!stageMask[1][s] || from1[s] !== d2) continue;
          if (stageMask[2][s]) rethink = false;
          route = Math.min(route, d1 + d2 + dist[2][s]);
        }
      });
      if (!rethink) continue;
      if (route < preset.route[0] || route > preset.route[1]) continue;
      return { s0, start: st0, par, route, dist };
    }
    return null;
  }
};

// ---- Bitsets over the state space (fast stage measurement) --------------------------------
const WORDS = Math.ceil(NSTATES / 32);
function toBits(m) { const b = new Uint32Array(WORDS); for (let s = 0; s < NSTATES; s++) if (m[s]) b[s >>> 5] |= 1 << (s & 31); return b; }
function fromBits(b) { const m = new Uint8Array(NSTATES); for (let s = 0; s < NSTATES; s++) m[s] = (b[s >>> 5] >>> (s & 31)) & 1; return m; }
function andBits(list) { const o = new Uint32Array(WORDS).fill(0xffffffff); list.forEach(b => { for (let w = 0; w < WORDS; w++) o[w] &= b[w]; }); return o; }
function popBits(b) { let n = 0; for (let w = 0; w < WORDS; w++) { let v = b[w]; v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; } return n; }
// Every way to order `total` clue indices into stages of the given sizes
// (order within a stage does not matter). 7 clues as 3/2/2: 210 splits.
function stageSplits(total, stages) {
  const out = [];
  const rec = (left, st, acc) => {
    if (st === stages.length) { out.push(acc); return; }
    combos(left, stages[st]).forEach(pick => rec(left.filter(x => pick.indexOf(x) < 0), st + 1, acc.concat(pick)));
  };
  rec(Array.from({ length: total }, (_, i) => i), 0, []);
  return out;
}
function combos(arr, k) {
  if (k === 0) return [[]];
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) combos(arr.slice(i + 1), k - 1).forEach(c => out.push([arr[i]].concat(c)));
  return out;
}

// ---- Plain-language help --------------------------------------------------------------
function condTitle(c) { return HOURS[c.pos] + ' · ' + CONDITION_TYPES[c.type].label; }
function condText(c) { return CONDITION_TYPES[c.type].text(c); }

// What a second-level hint says: the relationship, read against the board now.
function condExplain(seqs, c, rot) {
  const f = condFams(seqs, c, rot);
  const nm = i => RING_NAMES[c.rings[i]];
  const same = (i, j) => f[i] === f[j];
  switch (c.type) {
    case 'triple': {
      const n = f.length;
      for (let i = 0; i < n; i++) {
        const others = []; for (let j = 0; j < n; j++) if (j !== i) others.push(j);
        if (same(others[0], others[1]) && !same(i, others[0])) return 'Two pins already agree. The ' + nm(i) + ' needs their colour.';
      }
      return 'No two pins agree yet. Choose one colour and bring all three rings to it.';
    }
    case 'pair': {
      const k = distinctCount(f);
      if (k === f.length) return 'Every pin differs. Turn one ring so its pin copies another.';
      return 'Too many pins agree. Exactly two may share a colour.';
    }
    case 'contrast': {
      const d = circDist(f[0], f[1]);
      return 'These colours are ' + d + (d === 1 ? ' step' : ' steps') + ' apart on the centre ring; they need ' + (c.d >= 6 ? 'to be opposite (6)' : 'at least ' + c.d) + '.';
    }
    case 'odd': {
      const round = []; for (let i = 0; i < f.length; i++) if (i !== c.odd) round.push(i);
      const roundSame = round.every(i => f[i] === f[round[0]]);
      if (!roundSame) return 'The round pins (' + round.map(nm).join(', ') + ') must all match.';
      return 'The round pins match. The diamond on the ' + nm(c.odd) + ' must show a different colour.';
    }
    case 'sequence': {
      for (let i = 0; i + 1 < f.length; i++) if (f[i + 1] !== mod(f[i] + c.step, SEGMENTS)) {
        return 'The ' + nm(i + 1) + ' pin should be the colour ' + (c.step > 0 ? 'clockwise' : 'anticlockwise') + ' of the ' + nm(i) + ' pin, read on the centre ring.';
      }
      return 'The sequence holds.';
    }
    case 'missing': {
      const i = f.indexOf(c.fam);
      return i >= 0 ? 'The forbidden colour is on the ' + nm(i) + ' right now.' : 'The forbidden colour is absent.';
    }
    case 'alldiff': {
      for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (f[i] === f[j]) return 'The ' + nm(i) + ' and ' + nm(j) + ' pins repeat a colour.';
      return 'Every pin differs.';
    }
  }
  return '';
}

// ---- Engine -------------------------------------------------------------------------------
// The single source of truth for ring positions, moves, stage and hints.
// A move is one 30-degree step of one ring. moves always equals the total steps
// in the history, so undo reverses exactly the last action and its moves.
function createGame(puzzle, saved) {
  const P = puzzle, nC = P.conds.length;
  const E = {
    puzzle: P,
    rot: P.start.slice(),
    moves: 0,
    history: [],
    hints: 0,
    hintLevel: new Array(nC).fill(0),
    stage: 0,
    everSat: new Array(nC).fill(false),
    solved: false,
    par: P.par,
    route: P.route,
    budget: P.budget
  };
  E.lastStage = P.cum.length - 1;
  E.revealed = () => P.cum[E.stage];
  E.state = () => stateIndex(E.rot);
  E.fams = i => condFams(P.seqs, P.conds[i], E.rot);
  E.holds = i => CONDITION_TYPES[P.conds[i].type].test(E.fams(i), P.conds[i]);
  E.progress = i => CONDITION_TYPES[P.conds[i].type].progress(E.fams(i), P.conds[i]);
  // 'solved' | 'unsolved' (has held before) | 'revealed' (new, never held yet)
  E.status = i => E.holds(i) ? 'solved' : E.everSat[i] ? 'unsolved' : 'revealed';
  E.satisfiedCount = () => { let n = 0; for (let i = 0; i < E.revealed(); i++) if (E.holds(i)) n++; return n; };
  E.allRevealedHold = () => E.satisfiedCount() === E.revealed();
  E.familyAt = (k, p) => famAt(P.seqs, k, k === 0 ? 0 : E.rot[k], p);
  E.isSolutionState = () => P.dist[E.lastStage][E.state()] === 0;

  function refreshSeen() { for (let i = 0; i < E.revealed(); i++) if (E.holds(i)) E.everSat[i] = true; }

  // Open the next stage when every revealed condition holds. One stage at a time:
  // the caller animates the reveal and calls again afterwards.
  E.advance = function () {
    if (E.solved || !E.allRevealedHold()) return null;
    if (E.stage < E.lastStage) { E.stage++; refreshSeen(); return 'stage'; }
    E.solved = true;
    return 'solved';
  };

  E.rotate = function (k, steps) {
    if (E.solved || k < 1 || k >= RINGS || !steps) return null;
    const from = E.rot[k];
    E.rot[k] = from + steps;
    E.moves += Math.abs(steps);
    E.history.push({ ring: k, from, to: E.rot[k], steps });
    if (E.history.length > 400) E.history.shift();
    refreshSeen();
    return { ring: k, from, to: E.rot[k], steps, event: E.advance() };
  };
  E.undo = function () {
    if (E.solved || !E.history.length) return null;
    const h = E.history.pop();
    E.rot[h.ring] = h.from;
    E.moves = Math.max(0, E.moves - Math.abs(h.steps));
    refreshSeen();
    return Object.assign({ event: E.advance() }, h);
  };
  // Back to the scramble. What has been revealed stays revealed.
  E.reset = function () {
    if (E.solved) return;
    E.rot = P.start.slice();
    E.history = [];
    E.moves = 0;
  };

  // Which condition a hint is about: the requested one if it is unsolved, else
  // the revealed condition furthest from holding.
  E.hintTarget = function (pref) {
    if (pref >= 0 && pref < E.revealed() && !E.holds(pref)) return pref;
    let best = -1, bp = 2;
    for (let i = 0; i < E.revealed(); i++) { if (E.holds(i)) continue; const p = E.progress(i); if (p < bp) { bp = p; best = i; } }
    return best;
  };
  // A direction worth investigating: a single step that brings the board closer
  // to an arrangement satisfying the current stage. Prefers the condition's rings.
  E.direction = function (ci) {
    const D = P.dist[E.stage], s = E.state(), here = D[s];
    const rings = ci >= 0 ? P.conds[ci].rings.filter(k => k > 0) : [];
    const order = rings.concat([1, 2, 3, 4].filter(k => rings.indexOf(k) < 0));
    for (let j = 0; j < order.length; j++) {
      const k = order[j];
      for (const dir of [1, -1]) {
        const o = E.rot.slice(); o[k] += dir;
        if (D[stateIndex(o)] < here) return { ring: k, dir };
      }
    }
    return null;
  };
  // Hints escalate per condition: 1 = which rings, 2 = the relationship, 3 = a direction.
  E.hint = function (pref) {
    if (E.solved) return null;
    const ci = E.hintTarget(pref);
    if (ci < 0) return null;
    E.hints++;
    E.hintLevel[ci] = Math.min(3, E.hintLevel[ci] + 1);
    const level = E.hintLevel[ci];
    const c = P.conds[ci];
    const h = { cond: ci, level, rings: c.rings.slice() };
    if (level >= 2) h.text = condExplain(P.seqs, c, E.rot);
    if (level >= 3) h.dir = E.direction(ci);
    return h;
  };

  // Show the finished arrangement (solved on another device, or a gallery view):
  // the solution nearest the current rings, every clue revealed.
  E.forceSolved = function () {
    let best = P.solutions[0], bd = 99;
    const here = E.state();
    P.solutions.forEach(s => { const d = stateDistance(s, here); if (d < bd) { bd = d; best = s; } });
    const o = stateOffsets(best);
    for (let k = 1; k < RINGS; k++) E.rot[k] += shortestSteps(o[k] - E.rot[k]);
    E.stage = E.lastStage;
    E.everSat = E.everSat.map(() => true);
    E.solved = true;
  };

  E.serialize = function () {
    return { sig: P.sig, rot: E.rot.slice(), moves: E.moves, history: E.history.slice(-120), hints: E.hints, hintLevel: E.hintLevel.slice(), stage: E.stage, everSat: E.everSat.slice(), solved: E.solved };
  };
  function restore(s) {
    if (!s || s.sig !== P.sig || !Array.isArray(s.rot) || s.rot.length !== RINGS) return false;
    if (!s.rot.every(v => Number.isInteger(v) && Math.abs(v) < 1e6) || s.rot[0] !== 0) return false;
    if (!Number.isInteger(s.stage) || s.stage < 0 || s.stage > E.lastStage) return false;
    if (!Number.isInteger(s.moves) || s.moves < 0 || !Array.isArray(s.history)) return false;
    E.rot = s.rot.slice();
    E.moves = s.moves;
    E.history = s.history.filter(h => h && h.ring >= 1 && h.ring < RINGS && Number.isInteger(h.from) && Number.isInteger(h.to) && Number.isInteger(h.steps));
    E.hints = Math.max(0, s.hints | 0);
    if (Array.isArray(s.hintLevel) && s.hintLevel.length === nC) E.hintLevel = s.hintLevel.map(v => clamp(v | 0, 0, 3));
    E.stage = s.stage;
    if (Array.isArray(s.everSat) && s.everSat.length === nC) E.everSat = s.everSat.map(Boolean);
    // Solved is re-derived from the arrangement, never trusted on its own.
    E.solved = !!s.solved && E.stage === E.lastStage && E.allRevealedHold();
    refreshSeen();
    return true;
  }
  if (saved) restore(saved);
  return E;
}
