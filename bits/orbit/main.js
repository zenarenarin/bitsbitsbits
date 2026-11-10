// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// ORBIT — a daily colour-alignment puzzle for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Shared maths: seeded randomness, easing, angles and the OKLCH colour space.
// Everything here is pure, so the puzzle and theme engines can run in Node tests.

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mod(n, m) { return ((n % m) + m) % m; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
// Snapping uses a pure ease-out: decelerates into place, never passes the target.
function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
function easeOutQuint(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 5); }
function easeInOutSine(t) { t = clamp(t, 0, 1); return -(Math.cos(Math.PI * t) - 1) / 2; }

// Wrap an angle difference into (-PI, PI] so dragging across 0/360 never jumps.
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// FNV-1a string hash -> uint32, used to turn a date or level key into a seed.
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small, fast, deterministic across JS engines.
function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  const next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.chance = p => next() < p;
  return next;
}

// ---- OKLCH colour ----------------------------------------------------------
// Palettes are authored in OKLCH so lightness and chroma stay perceptually even
// around the wheel (an RGB rainbow has a glaring yellow and a muddy blue).

function oklchToOklab(L, C, hDeg) {
  const h = hDeg * Math.PI / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}

function inGamut(rgb) { return rgb[0] >= -0.0005 && rgb[0] <= 1.0005 && rgb[1] >= -0.0005 && rgb[1] <= 1.0005 && rgb[2] >= -0.0005 && rgb[2] <= 1.0005; }

function gammaEncode(x) {
  x = clamp(x, 0, 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// Bring an OKLCH colour into sRGB by reducing chroma only (hue and lightness hold).
function gamutMap(L, C, h) {
  L = clamp(L, 0, 1);
  let lab = oklchToOklab(L, C, h);
  if (inGamut(oklabToLinear(lab[0], lab[1], lab[2]))) return [L, C, h];
  let lo = 0, hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    lab = oklchToOklab(L, mid, h);
    if (inGamut(oklabToLinear(lab[0], lab[1], lab[2]))) lo = mid; else hi = mid;
  }
  return [L, lo, h];
}

// A colour record carries its OKLab coordinates (for maths) and sRGB (for drawing).
function colour(L, C, h) {
  const m = gamutMap(L, Math.max(0, C), mod(h, 360));
  const lab = oklchToOklab(m[0], m[1], m[2]);
  const lin = oklabToLinear(lab[0], lab[1], lab[2]);
  const r = Math.round(gammaEncode(lin[0]) * 255);
  const g = Math.round(gammaEncode(lin[1]) * 255);
  const b = Math.round(gammaEncode(lin[2]) * 255);
  return { L: m[0], C: m[1], h: m[2], lab, r, g, b, css: 'rgb(' + r + ',' + g + ',' + b + ')' };
}

function rgba(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (+a).toFixed(3) + ')'; }

function deltaE(c1, c2) {
  const dl = c1.lab[0] - c2.lab[0], da = c1.lab[1] - c2.lab[1], db = c1.lab[2] - c2.lab[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

// Mix two colour records in OKLab (used by theme transitions).
function mixColour(c1, c2, t) {
  const L = lerp(c1.lab[0], c2.lab[0], t), a = lerp(c1.lab[1], c2.lab[1], t), b = lerp(c1.lab[2], c2.lab[2], t);
  const C = Math.sqrt(a * a + b * b);
  const h = Math.atan2(b, a) * 180 / Math.PI;
  return colour(L, C, h);
}

// WCAG relative luminance and contrast, for interface text checks.
function relLum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrastRatio(c1, c2) {
  const a = relLum(c1), b = relLum(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---- Calendar --------------------------------------------------------------
// The daily edition follows the player's local calendar date, like a newspaper puzzle.
const ORBIT_EPOCH = Date.UTC(2026, 10, 1); // No. 1 = 1 Nov 2026

function dateKey(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function dayNumberFromKey(key) {
  const p = key.split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - ORBIT_EPOCH) / 86400000) + 1;
}
function keyFromDayNumber(n) {
  const d = new Date(ORBIT_EPOCH + (n - 1) * 86400000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function prettyDate(key) {
  const p = key.split('-').map(Number);
  return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
}
function pad3(n) { n = Math.max(0, n | 0); return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
function fmtTime(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// ---- 01_puzzle.js ----
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

// ---- 02_themes.js ----
// Visual theme engine. Completely independent of the puzzle: a theme only says
// how hue family i of ring k looks, never where it is.
//
// A theme is assembled from curated registries:
//   colour universes (palette laws in OKLCH + names + compatible looks),
//   materials, grounds (backgrounds), separations, lights and completion styles.
// Every assembled theme passes visual QC or is re-drawn deterministically.

const ThemeRegistry = {
  universes: [],
  materials: {},
  grounds: {},
  authored: {},   // key -> theme spec override (hand art-directed editions)
  registerUniverse(u) { this.universes.push(u); return u; },
  registerMaterial(id, m) { this.materials[id] = Object.assign({ id }, m); },
  registerGround(id, g) { this.grounds[id] = Object.assign({ id }, g); },
  registerAuthored(key, spec) { this.authored[key] = spec; }
};

// ---- Materials --------------------------------------------------------------
// Rendering recipes the board renderer understands. Values are 0..1 strengths.
[
  ['matte',      { label: 'matte pigment',       alpha: 1,    bevel: 0.16, gloss: 0.04, spec: 0.0,  sheen: null,      texture: 'grain',    texAlpha: 0.05, rim: 0.10 }],
  ['satin',      { label: 'satin lacquer',       alpha: 1,    bevel: 0.24, gloss: 0.14, spec: 0.10, sheen: null,      texture: 'grain',    texAlpha: 0.035, rim: 0.16 }],
  ['ceramic',    { label: 'glazed ceramic',      alpha: 1,    bevel: 0.30, gloss: 0.22, spec: 0.30, sheen: null,      texture: 'crackle',  texAlpha: 0.05, rim: 0.22 }],
  ['glass',      { label: 'cast glass',          alpha: 0.64, bevel: 0.18, gloss: 0.20, spec: 0.38, sheen: null,      texture: null,       texAlpha: 0,    rim: 0.42 }],
  ['metal',      { label: 'anodised metal',      alpha: 1,    bevel: 0.30, gloss: 0.10, spec: 0.22, sheen: 'brushed', texture: 'brushed',  texAlpha: 0.10, rim: 0.30 }],
  ['opal',       { label: 'opalescent resin',    alpha: 0.94, bevel: 0.20, gloss: 0.18, spec: 0.20, sheen: 'opal',    texture: null,       texAlpha: 0,    rim: 0.24 }],
  ['holo',       { label: 'holographic film',    alpha: 1,    bevel: 0.14, gloss: 0.10, spec: 0.16, sheen: 'holo',    texture: 'lines',    texAlpha: 0.07, rim: 0.20 }],
  ['print',      { label: 'risograph ink',       alpha: 1,    bevel: 0.0,  gloss: 0.0,  spec: 0.0,  sheen: null,      texture: 'halftone', texAlpha: 0.13, rim: 0.0, misregister: 1 }],
  ['watercolour',{ label: 'watercolour wash',    alpha: 0.86, bevel: 0.0,  gloss: 0.0,  spec: 0.0,  sheen: null,      texture: 'paper',    texAlpha: 0.16, rim: 0.0, pool: 1 }],
  ['enamel',     { label: 'cloisonné enamel',    alpha: 1,    bevel: 0.26, gloss: 0.20, spec: 0.26, sheen: null,      texture: 'grain',    texAlpha: 0.03, rim: 0.30 }],
  ['velvet',     { label: 'flocked velvet',      alpha: 1,    bevel: -0.22, gloss: 0.0, spec: 0.0,  sheen: 'velvet',  texture: 'grain',    texAlpha: 0.10, rim: 0.06 }],
  ['stone',      { label: 'honed stone',         alpha: 1,    bevel: 0.18, gloss: 0.06, spec: 0.04, sheen: null,      texture: 'speckle',  texAlpha: 0.12, rim: 0.12 }]
].forEach(m => ThemeRegistry.registerMaterial(m[0], m[1]));

// ---- Grounds (backgrounds) ---------------------------------------------------
// L/C/h is the base tone; `light` grounds flip the interface ink.
[
  ['graphite',  { L: 0.175, C: 0.006, h: 70,  label: 'graphite' }],
  ['ink',       { L: 0.165, C: 0.022, h: 262, label: 'midnight ink' }],
  ['aubergine', { L: 0.175, C: 0.030, h: 330, label: 'aubergine' }],
  ['forest',    { L: 0.180, C: 0.022, h: 165, label: 'forest dark' }],
  ['oxblood',   { L: 0.185, C: 0.040, h: 22,  label: 'oxblood' }],
  ['slate',     { L: 0.225, C: 0.014, h: 240, label: 'slate' }],
  ['umber',     { L: 0.190, C: 0.020, h: 55,  label: 'raw umber' }],
  ['bone',      { L: 0.925, C: 0.014, h: 85,  label: 'bone', light: true }],
  ['paper',     { L: 0.950, C: 0.012, h: 92,  label: 'cotton paper', light: true }],
  ['putty',     { L: 0.860, C: 0.012, h: 70,  label: 'putty', light: true }]
].forEach(g => ThemeRegistry.registerGround(g[0], g[1]));

const GROUND_PATTERNS = ['orbits', 'ticks', 'grid', 'rays', 'none'];
const COMPLETIONS = ['radiance', 'sweep', 'bloom', 'chime'];
const SEPARATIONS = {
  gap:      { style: 'gap',      width: 2.2 },
  fine:     { style: 'gap',      width: 1.2 },
  hairline: { style: 'hairline', width: 1.4 },
  engraved: { style: 'engraved', width: 2.0 },
  cloison:  { style: 'metal',    width: 2.4 },
  flush:    { style: 'gap',      width: 0.7 }
};

// ---- Palette laws --------------------------------------------------------------
// Each law maps family index i (0..11) to OKLCH. `p` holds the drawn parameters.
const PaletteLaws = {
  // Full hue circle; lightness follows a gentle wave so warm hues sit brighter,
  // and alternates light/dark between neighbours so all twelve families stay
  // unmistakable when a puzzle asks you to match one exactly.
  wheel(i, p) {
    const t = i / SEGMENTS;
    const h = p.h0 + 360 * t * p.dir;
    const z = (i % 2 ? -1 : 1) * (p.Lz === undefined ? 0.07 : p.Lz);
    return [p.L0 + z + p.Lamp * Math.cos(TAU * (t - p.Lph)), p.C0 + p.Camp * Math.cos(TAU * (t - p.Cph)), h];
  },
  // Hue swings across an arc while lightness travels the other axis of an ellipse,
  // so every family is unique even though hues repeat.
  arc(i, p) {
    const x = TAU * i / SEGMENTS + p.ph;
    return [p.L0 + p.Lamp * Math.cos(x), p.C0 + p.Camp * Math.sin(x + 0.6), p.h0 + p.span * Math.sin(x)];
  },
  // Monochrome study: one hue, a closed loop through lightness and chroma.
  mono(i, p) {
    const x = TAU * i / SEGMENTS + p.ph;
    return [p.L0 + p.Lamp * Math.cos(x), p.C0 + p.Camp * Math.sin(x), p.h0 + p.span * Math.sin(x)];
  },
  // A graded ramp with one deliberate seam (brutalist / gradient studies).
  ramp(i, p) {
    const t = i / (SEGMENTS - 1);
    const L = p.Lmin + (p.Lmax - p.Lmin) * t;
    if (p.accent && i === 0) return [p.accentL, p.accentC, p.accentH];
    return [L, p.C0 + p.Camp * Math.sin(Math.PI * t), p.h0 + p.span * t];
  },
  // Optical: alternating light and dark around the circle, hue turning slowly.
  optical(i, p) {
    const t = i / SEGMENTS;
    const hi = i % 2 === 0;
    return [hi ? p.Lhi : p.Llo, hi ? p.Chi : p.Clo, p.h0 + 360 * t];
  }
};

// ---- Colour universes ----------------------------------------------------------
// Curated: each defines a palette law with bounded parameters, the looks that
// suit it and its own vocabulary. Add a universe here; nothing else changes.
function U(def) { return ThemeRegistry.registerUniverse(def); }

U({ id: 'prism', title: 'Prism', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.70, 0.74), Lamp: r.range(0.06, 0.09), Lph: r.range(0.17, 0.25), C0: r.range(0.125, 0.15), Camp: 0.02, Cph: 0.2 }),
  materials: ['satin', 'matte', 'ceramic'], grounds: ['graphite', 'ink'], seps: ['gap', 'fine'],
  names: ['Prime Meridian', 'Spectral Index', 'Chromatic Survey', 'Twelve Lights', 'Colour Field', 'Refraction Study'],
  blurb: 'A full turn of the spectrum, tuned so no hue shouts over its neighbours.' });

U({ id: 'pastel', title: 'Pastel', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.74, 0.76), Lamp: 0.04, Lph: 0.2, Lz: 0.065, C0: r.range(0.118, 0.128), Camp: 0.015, Cph: r.range(0, 1) }),
  materials: ['matte', 'ceramic', 'satin', 'velvet'], grounds: ['ink', 'aubergine', 'slate'], seps: ['gap', 'fine', 'engraved'],
  names: ['Sugared Almond', 'Morning Chalk', 'Powder Room', 'Macaron Theory', 'Soft Machine', 'Pale Fire'],
  blurb: 'Chalky pastels, all at one lightness, so colour does the talking.' });

U({ id: 'earth', title: 'Earth Pigment', law: 'arc',
  params: r => ({ h0: r.range(50, 62), span: r.range(54, 62), ph: r.range(0, TAU), L0: r.range(0.60, 0.63), Lamp: r.range(0.18, 0.2), C0: r.range(0.1, 0.11), Camp: 0.035 }),
  materials: ['matte', 'stone', 'print', 'velvet'], grounds: ['umber', 'graphite', 'paper'], seps: ['gap', 'engraved'],
  names: ['Ochre & Umber', 'Terra di Siena', 'Kiln Dust', 'Iron Oxide', 'Field Notes', 'Red Earth'],
  blurb: 'Iron oxides, ochres and umbers: the oldest paints there are.' });

U({ id: 'alloy', title: 'Alloy', law: 'arc',
  params: r => ({ h0: r.range(55, 75), span: r.range(74, 84), ph: r.range(0, TAU), L0: r.range(0.66, 0.68), Lamp: r.range(0.18, 0.2), C0: r.range(0.088, 0.096), Camp: 0.04 }),
  materials: ['metal'], grounds: ['ink', 'graphite', 'slate'], seps: ['engraved', 'fine'],
  names: ['Brass & Steel', 'Anodised', 'Foundry Light', 'Rose Gold Engine', 'Titanium Bloom', 'Bronze Age'],
  blurb: 'Brass, copper, steel and bronze, turned and brushed like a watch movement.' });

U({ id: 'glass', title: 'Glasswork', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: r.chance(0.5) ? 1 : -1, L0: r.range(0.70, 0.74), Lamp: 0.05, Lph: 0.2, C0: r.range(0.13, 0.15), Camp: 0.02, Cph: 0.6 }),
  materials: ['glass'], grounds: ['slate', 'ink', 'graphite'], seps: ['fine', 'gap'],
  names: ['Murano', 'Leaded Light', 'Cathedral', 'Dichroic', 'Blown Glass', 'Lantern'],
  blurb: 'Coloured glass held in light; the ground shows through every segment.' });

U({ id: 'opal', title: 'Opaline', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.73, 0.75), Lamp: 0.04, Lph: 0.2, C0: r.range(0.12, 0.13), Camp: 0.015, Cph: 0.3 }),
  materials: ['opal', 'holo'], grounds: ['ink', 'aubergine', 'graphite'], seps: ['fine', 'gap'],
  names: ['Mother of Pearl', 'Moonstone', 'Opaline', 'Nacre', 'Fire Opal', 'Abalone'],
  blurb: 'Milky colour with a shifting sheen that moves as the rings turn.' });

U({ id: 'fluoro', title: 'Fluorescent', law: 'arc',
  params: r => ({ h0: r.range(30, 50), span: r.range(95, 110), ph: r.range(0, TAU), L0: r.range(0.70, 0.72), Lamp: r.range(0.12, 0.14), C0: r.range(0.17, 0.2), Camp: 0.03 }),
  materials: ['print', 'matte'], grounds: ['paper', 'graphite', 'bone'], seps: ['gap', 'fine'],
  names: ['Fluorescent Pink', 'Day-Glo Press', 'Hi-Vis Garden', 'Signal Ink', 'Laser Lemon', 'Riso Bloom'],
  blurb: 'Fluorescent print inks: pink, orange and yellow pressed onto paper.' });

U({ id: 'mono', title: 'Monochrome', law: 'ramp',
  params: r => ({ h0: r.range(0, 360), span: r.range(-16, 16), Lmin: r.range(0.36, 0.38), Lmax: r.range(0.9, 0.92), C0: r.range(0.04, 0.06), Camp: r.range(0.06, 0.08) }),
  materials: ['satin', 'matte', 'ceramic', 'stone'], grounds: ['graphite', 'ink', 'slate'], seps: ['gap', 'engraved', 'hairline'],
  names: ['Monochrome Study', 'Single Note', 'Tonal Scale', 'One Colour Only', 'Value Study', 'Grisaille'],
  blurb: 'One hue only. Read the rings by value, from shadow to highlight.' });

U({ id: 'vintage', title: 'Vintage Print', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.58, 0.62), Lamp: r.range(0.08, 0.1), Lph: 0.2, C0: r.range(0.1, 0.11), Camp: 0.02, Cph: 0.5 }),
  materials: ['print', 'matte'], grounds: ['paper', 'bone', 'putty'], seps: ['gap', 'fine'],
  names: ['Letterpress', 'Travel Poster', 'Atlas Plate', 'Seed Catalogue', 'Matchbox', 'Off-Register'],
  blurb: 'Muted offset inks, halftone dots and a little misregistration.' });

U({ id: 'porcelain', title: 'Porcelain', law: 'ramp',
  params: r => ({ h0: r.range(258, 266), span: r.range(-14, -8), Lmin: r.range(0.3, 0.32), Lmax: r.range(0.84, 0.86), C0: r.range(0.03, 0.04), Camp: r.range(0.1, 0.12) }),
  materials: ['ceramic'], grounds: ['bone', 'putty', 'paper'], seps: ['gap', 'fine'],
  names: ['Kiln Blue', 'Delft', 'Blue & White', 'Cobalt Glaze', 'Jingdezhen', 'Willow'],
  blurb: 'Cobalt underglaze on white porcelain, from deep wash to pale blush.' });

U({ id: 'watercolour', title: 'Watercolour', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.70, 0.73), Lamp: 0.05, Lph: 0.2, C0: r.range(0.1, 0.12), Camp: 0.02, Cph: 0.4 }),
  materials: ['watercolour'], grounds: ['paper', 'bone'], seps: ['gap', 'fine'],
  names: ['Wet on Wet', 'Field Sketch', 'Pigment Bloom', 'Plein Air', 'Wash Study', 'Rainy Studio'],
  blurb: 'Transparent washes pooling at their edges on cold-pressed paper.' });

U({ id: 'mineral', title: 'Mineral', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.56, 0.6), Lamp: r.range(0.07, 0.09), Lph: 0.2, C0: r.range(0.13, 0.155), Camp: 0.02, Cph: 0.2 }),
  materials: ['ceramic', 'satin', 'glass', 'stone'], grounds: ['ink', 'graphite', 'aubergine'], seps: ['engraved', 'gap'],
  names: ['Mineral Cabinet', 'Lapis & Garnet', 'Gem Index', 'Cut Stone', 'Malachite Hour', 'Crystal Habit'],
  blurb: 'Deep gemstone colour: garnet, citrine, peridot, lapis, amethyst.' });

U({ id: 'botanical', title: 'Botanical', law: 'arc',
  params: r => ({ h0: r.range(70, 90), span: r.range(66, 80), ph: r.range(0, TAU), L0: r.range(0.63, 0.67), Lamp: r.range(0.16, 0.19), C0: r.range(0.095, 0.115), Camp: 0.03 }),
  materials: ['matte', 'watercolour', 'velvet'], grounds: ['forest', 'paper', 'graphite'], seps: ['gap', 'fine'],
  names: ['Herbarium', 'Glasshouse', 'Pressed Flowers', 'Moss & Rose', 'Seed Head', 'Kitchen Garden'],
  blurb: 'Leaf, stem and petal: a botanist’s study in greens and pinks.' });

U({ id: 'duotone', title: 'Duotone', law: 'arc',
  params: r => { const pair = r.pick([[200, 34], [265, 75], [320, 160], [180, 350], [240, 50], [150, 20]]); return { h0: (pair[0] + pair[1]) / 2 + (Math.abs(pair[0] - pair[1]) > 180 ? 180 : 0), span: Math.min(85, Math.abs(((pair[0] - pair[1] + 540) % 360) - 180) / 2), ph: r.range(0, TAU), L0: r.range(0.64, 0.68), Lamp: r.range(0.17, 0.2), C0: r.range(0.1, 0.12), Camp: 0.035 }; },
  materials: ['print', 'matte', 'satin'], grounds: ['graphite', 'paper', 'ink'], seps: ['gap', 'fine'],
  names: ['Two Inks', 'Split Tone', 'Duotone No.', 'Positive Negative', 'Twin Pigment', 'Counterpoint'],
  blurb: 'Two inks, and every blend between them, run through light and shade.' });

U({ id: 'holo', title: 'Holographic', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: -1, L0: r.range(0.72, 0.74), Lamp: 0.04, Lph: 0.2, C0: r.range(0.125, 0.135), Camp: 0.015, Cph: 0.4 }),
  materials: ['holo', 'opal'], grounds: ['ink', 'graphite', 'aubergine'], seps: ['fine', 'gap'],
  names: ['Hologram', 'Diffraction', 'Foil Proof', 'Iridescence', 'Interference', 'Light Grating'],
  blurb: 'Diffraction foil: a rainbow that slides across the surface as you turn.' });

U({ id: 'concrete', title: 'Brutalist', law: 'ramp',
  params: r => ({ Lmin: 0.36, Lmax: r.range(0.9, 0.93), h0: r.range(40, 90), span: r.range(-20, 20), C0: 0.008, Camp: r.range(0.008, 0.016), accent: true, accentL: r.range(0.6, 0.65), accentC: r.range(0.17, 0.2), accentH: r.pick([28, 35, 255, 140]) }),
  materials: ['stone', 'matte'], grounds: ['graphite', 'slate'], seps: ['engraved', 'gap'],
  names: ['Béton Brut', 'Concrete Scale', 'Grey Matter', 'Formwork', 'Raw Grade', 'Civic Grey'],
  blurb: 'Eleven greys cast in concrete, and a single painted mark.' });

U({ id: 'retro', title: 'Retro-Futurist', law: 'arc',
  params: r => ({ h0: r.range(110, 125), span: r.range(80, 92), ph: r.range(0, TAU), L0: r.range(0.68, 0.72), Lamp: r.range(0.15, 0.18), C0: r.range(0.1, 0.12), Camp: 0.03 }),
  materials: ['satin', 'enamel', 'matte'], grounds: ['ink', 'graphite', 'oxblood'], seps: ['gap', 'engraved'],
  names: ['Space Age', 'Atomic Kitchen', 'Moonbase', 'Formica Future', 'Tomorrowland', 'Jet Set'],
  blurb: 'Tangerine, avocado and teal, as the 1960s imagined the future.' });

U({ id: 'optical', title: 'Op Art', law: 'optical',
  params: r => ({ h0: r.range(0, 360), Lhi: r.range(0.83, 0.86), Llo: r.range(0.48, 0.52), Chi: r.range(0.10, 0.115), Clo: r.range(0.145, 0.16) }),
  materials: ['matte', 'satin'], grounds: ['graphite', 'ink'], seps: ['flush', 'fine'],
  names: ['Op Art', 'Current', 'Retinal', 'Moiré Hour', 'Flicker', 'Afterimage'],
  blurb: 'High and low tones alternate so the wheel seems to vibrate.' });

U({ id: 'aurora', title: 'Aurora', law: 'arc',
  params: r => ({ h0: r.range(205, 225), span: r.range(70, 84), ph: r.range(0, TAU), L0: r.range(0.68, 0.72), Lamp: r.range(0.14, 0.17), C0: r.range(0.12, 0.14), Camp: 0.03 }),
  materials: ['glass', 'opal', 'satin'], grounds: ['ink', 'forest', 'slate'], seps: ['fine', 'gap'],
  names: ['Aurora', 'Polar Night', 'Magnetosphere', 'Solar Wind', 'Northern Field', 'Borealis'],
  blurb: 'Green into violet, like charged light over a polar sky.' });

U({ id: 'celadon', title: 'Celadon', law: 'ramp',
  params: r => ({ h0: r.range(150, 170), span: r.range(10, 22), Lmin: r.range(0.38, 0.4), Lmax: r.range(0.9, 0.92), C0: r.range(0.03, 0.04), Camp: r.range(0.06, 0.075) }),
  materials: ['ceramic', 'stone'], grounds: ['bone', 'graphite', 'umber'], seps: ['gap', 'engraved'],
  names: ['Celadon', 'Jade Glaze', 'Longquan', 'Sea Glass', 'Crackle Green', 'Tea Bowl'],
  blurb: 'Jade-green glazes, from shallow pools to deep, crazed celadon.' });

U({ id: 'cloisonne', title: 'Cloisonné', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.60, 0.64), Lamp: 0.07, Lph: 0.2, C0: r.range(0.13, 0.15), Camp: 0.02, Cph: 0.2 }),
  materials: ['enamel'], grounds: ['ink', 'oxblood', 'graphite'], seps: ['cloison'],
  names: ['Cloisonné', 'Enamel Cell', 'Gold Wire', 'Champlevé', 'Byzantine', 'Jewel Box'],
  blurb: 'Vitreous enamel fired between fine gold wires.' });

U({ id: 'nocturne', title: 'Nocturne', law: 'arc',
  params: r => ({ h0: r.range(268, 290), span: r.range(60, 75), ph: r.range(0, TAU), L0: r.range(0.58, 0.62), Lamp: r.range(0.17, 0.2), C0: r.range(0.1, 0.12), Camp: 0.03 }),
  materials: ['velvet', 'satin', 'glass'], grounds: ['ink', 'aubergine'], seps: ['gap', 'fine'],
  names: ['Nocturne', 'Blue Hour', 'Velvet Night', 'Indigo Hours', 'Dusk Index', 'After Dark'],
  blurb: 'Indigo, plum and midnight blue, the colours of a late evening.' });

// Hand art-directed editions (keyed by theme key) take precedence over generation.
ThemeRegistry.registerAuthored('level:1', { universe: 'prism', material: 'satin', ground: 'graphite', sep: 'gap', pattern: 'ticks', completion: 'radiance', name: 'First Light', params: { h0: 20, dir: 1, L0: 0.72, Lamp: 0.07, Lph: 0.2, C0: 0.14, Camp: 0.02, Cph: 0.2 } });
ThemeRegistry.registerAuthored('daily:1', { universe: 'prism', material: 'satin', ground: 'graphite', sep: 'gap', pattern: 'orbits', completion: 'radiance', name: 'Prime Meridian', params: { h0: 28, dir: 1, L0: 0.72, Lamp: 0.08, Lph: 0.2, C0: 0.14, Camp: 0.02, Cph: 0.2 } });

// ---- Assembly and quality control ---------------------------------------------

function buildBase(universe, params) {
  const law = PaletteLaws[universe.law];
  const base = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const lch = law(i, params);
    base.push(colour(lch[0], lch[1], lch[2]));
  }
  return base;
}

// Ring variants: the same family must read as the same colour on every ring
// (matching across rings is the puzzle), so rings differ only by a whisper.
function ringVariant(c, t, depth) {
  return colour(c.L + (t - 0.5) * depth.L, c.C * (1 + (t - 0.5) * depth.C), c.h + (t - 0.5) * depth.h);
}

const QC = {
  minAdjacent: 0.042,   // OKLab distance between neighbouring segments in a ring
  minPair: 0.03,      // any two families in a ring
  minFamily: 0.085,   // any two families anywhere on the board (puzzle legibility)
  maxDrift: 0.03,     // one family across rings must stay one colour
  minBoardContrast: 0.17,
  minInkContrast: 4.5
};

function qcTheme(t) {
  const issues = [];
  const pal5 = t.paletteFor(5);
  let minF = 9, maxD = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    for (let a = 0; a < 5; a++) for (let b = a; b < 5; b++) {
      maxD = Math.max(maxD, deltaE(pal5[a][i], pal5[b][i]));
      for (let j = i + 1; j < SEGMENTS; j++) minF = Math.min(minF, deltaE(pal5[a][i], pal5[b][j]), deltaE(pal5[b][i], pal5[a][j]));
    }
  }
  if (minF < QC.minFamily) issues.push('families too close ' + minF.toFixed(3));
  if (maxD > QC.maxDrift) issues.push('family drifts across rings ' + maxD.toFixed(3));
  for (let n = 5; n <= 5; n++) {
    const pal = t.paletteFor(n);
    for (let k = 0; k < n; k++) {
      const row = pal[k];
      for (let i = 0; i < SEGMENTS; i++) {
        if (deltaE(row[i], row[(i + 1) % SEGMENTS]) < QC.minAdjacent) { issues.push('adjacent ' + n + '/' + k + '/' + i); break; }
        for (let j = i + 2; j < SEGMENTS; j++) {
          if (deltaE(row[i], row[j]) < QC.minPair) { issues.push('pair ' + n + '/' + k + '/' + i + '-' + j); j = SEGMENTS; i = SEGMENTS; }
        }
      }
    }
  }
  let sum = 0;
  t.base.forEach(c => { sum += Math.abs(c.L - t.bg.base.L); });
  const boardContrast = sum / SEGMENTS;
  if (boardContrast < QC.minBoardContrast) issues.push('board contrast ' + boardContrast.toFixed(3));
  if (contrastRatio(t.ink, t.bg.base) < QC.minInkContrast) issues.push('ink contrast');
  if (contrastRatio(t.inkDim, t.bg.base) < 3) issues.push('dim ink contrast');
  return issues;
}

// Deterministic, non-repeating universe order. Adjacent editions never share a
// universe because the order is a fixed shuffle and we step through it.
const _universeOrder = (function () {
  const r = makeRng('orbit-universe-order-v1');
  const idx = ThemeRegistry.universes.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return idx;
})();

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// Universes whose twelve families form a true colour circle: the puzzle's
// "steps apart" and "next colour" rules read off the spectrum, so only these
// are dealt to puzzles for now. The others stay in the registry.
function puzzleUniverse(u) { return u.law === 'wheel' || u.law === 'optical'; }
function universeFor(edition, stride) {
  const order = _universeOrder.filter(i => puzzleUniverse(ThemeRegistry.universes[i]));
  const n = order.length;
  // The stride must be coprime with the universe count so the walk visits every
  // universe before repeating, and consecutive editions always differ.
  while (gcd(stride, n) !== 1) stride++;
  return ThemeRegistry.universes[order[mod(edition * stride, n)]];
}

// Build a complete theme. `key` identifies it (e.g. "daily:10", "level:7").
function createTheme(key, edition, stride) {
  const authored = ThemeRegistry.authored[key];
  let universe = authored ? ThemeRegistry.universes.find(u => u.id === authored.universe) : universeFor(edition, stride || 1);
  const rng = makeRng('orbit-theme:' + key);
  let theme = null;
  for (let attempt = 0; attempt < 24 && !theme; attempt++) {
    const r = attempt === 0 ? rng : makeRng('orbit-theme:' + key + ':' + attempt);
    const t = assemble(key, edition, universe, r, attempt === 0 ? authored : null);
    if (!qcTheme(t).length) theme = t;
  }
  if (!theme) {
    // Every universe is tested across thousands of keys (dev/test_themes.js); this
    // is a last resort that is known to pass.
    theme = assemble(key, edition, ThemeRegistry.universes[0], makeRng('orbit-safe'), ThemeRegistry.authored['level:1']);
    theme.fallback = true;
  }
  return theme;
}

function assemble(key, edition, universe, r, authored) {
  const params = authored && authored.params ? authored.params : universe.params(r);
  const base = buildBase(universe, params);
  const materialId = authored ? authored.material : r.pick(universe.materials);
  const material = ThemeRegistry.materials[materialId];
  const groundId = authored ? authored.ground : r.pick(universe.grounds);
  const g = ThemeRegistry.grounds[groundId];
  const light = !!g.light;

  // Ground colour; a whisper of the palette's mean hue in the glow behind the board.
  let ma = 0, mb = 0;
  base.forEach(c => { ma += c.lab[1]; mb += c.lab[2]; });
  const meanHue = Math.atan2(mb, ma) * 180 / Math.PI;
  const bgBase = colour(g.L, g.C, g.h);
  const bg = {
    id: groundId,
    label: g.label,
    light,
    base: bgBase,
    deep: colour(g.L + (light ? -0.06 : -0.06), g.C, g.h),
    lift: colour(g.L + (light ? 0.035 : 0.05), g.C + 0.004, g.h),
    glow: colour(light ? 0.98 : 0.62, light ? 0.02 : 0.06, meanHue),
    glowAlpha: light ? r.range(0.35, 0.5) : r.range(0.07, 0.12),
    pattern: authored ? authored.pattern : r.pick(GROUND_PATTERNS),
    grain: r.range(0.025, 0.05)
  };

  const depthL = r.range(0.008, 0.016) * (r.chance(0.5) ? 1 : -1);
  const depth = { L: depthL, C: r.range(-0.05, 0.05), h: r.range(-1.5, 1.5) };
  const sepId = authored ? authored.sep : r.pick(universe.seps);

  const ink = light ? colour(0.24, 0.015, g.h) : colour(0.94, 0.008, g.h);
  const inkDim = light ? colour(0.45, 0.012, g.h) : colour(0.70, 0.01, g.h);

  // Accent: the palette colour that reads best on the ground, for small marks.
  let accent = base[0], bestC = 0;
  base.forEach(c => { const cr = contrastRatio(c, bgBase) * (0.6 + c.C * 4); if (cr > bestC) { bestC = cr; accent = c; } });

  const lightAngle = r.range(-150, -100) * Math.PI / 180; // light from upper left

  const theme = {
    key, edition,
    universe: universe.id,
    universeTitle: universe.title,
    name: authored && authored.name ? authored.name : r.pick(universe.names),
    blurb: universe.blurb,
    base,
    material,
    bg,
    sep: Object.assign({ id: sepId }, SEPARATIONS[sepId], {
      colour: sepId === 'cloison' ? colour(0.82, 0.11, 85) : sepId === 'hairline' ? (light ? colour(0.3, 0.01, g.h) : colour(0.12, 0.01, g.h)) : bgBase
    }),
    light: { angle: lightAngle, intensity: r.range(0.75, 1) },
    completion: authored ? authored.completion : r.pick(COMPLETIONS),
    ink, inkDim, accent,
    hubTone: light ? colour(0.86, 0.01, g.h) : colour(0.26, 0.008, g.h),
    depth,
    _cache: {}
  };
  theme.description = universe.blurb + ' ' + capital(material.label) + ' on ' + g.label + '.';
  theme.paletteFor = function (n) {
    if (theme._cache[n]) return theme._cache[n];
    const rows = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      rows.push(base.map(c => ringVariant(c, t, depth)));
    }
    theme._cache[n] = rows;
    return rows;
  };
  return theme;
}

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Public entry points. Daily and study editions use different strides through the
// universe order so the two sequences rarely coincide on the same day.
const ThemeEngine = {
  forDaily(dayNumber) { return createTheme('daily:' + dayNumber, dayNumber, 1); },
  forLevel(level) { return createTheme('level:' + level, level + 3, 5); },
  forKey(key) {
    const m = /^(daily|level):(\d+)$/.exec(key);
    if (!m) return null;
    return m[1] === 'daily' ? this.forDaily(+m[2]) : this.forLevel(+m[2]);
  },
  qc: qcTheme,
  registry: ThemeRegistry
};

// ---- 03_render.js ----
// Board rendering (Canvas2D vector paths): GameBoard, OrbitRing, RingSegment,
// the ground, the hub and every material/lighting pass. Reads state, never writes it.

// Offscreen scratch surfaces (textures, layers, thumbnails). Plethora mounts
// visible canvases only through ctx.createCanvas2D, so these never touch the DOM.
function makeCanvas(w, h) {
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

// Show an offscreen surface in the DOM as an <img> (filled once encoded).
function surfaceToImage(surface, sizeCss) {
  const img = document.createElement('img');
  img.alt = '';
  img.width = img.height = sizeCss;
  img.style.width = img.style.height = sizeCss + 'px';
  surface.convertToBlob({ type: 'image/png' }).then(blob => {
    const url = URL.createObjectURL(blob);
    img.onload = img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }).catch(() => { });
  return img;
}

// ---- Geometry -----------------------------------------------------------------
// Rings sit between a small hub and the board radius R with a constant gap.
function boardGeometry(R, ringCount) {
  const hubR = R * (ringCount >= 6 ? 0.16 : 0.18);
  const start = hubR + R * 0.04;
  const gapRatio = 0.17;
  const w = (R - start) / (ringCount + gapRatio * (ringCount - 1));
  const g = w * gapRatio;
  const rings = [];
  for (let k = 0; k < ringCount; k++) {
    const rIn = start + k * (w + g);
    rings.push({ rIn, rOut: rIn + w, mid: rIn + w / 2 });
  }
  return { R, hubR, w, g, rings, n: ringCount };
}

// RingSegment: one annular sector, centred on angle 0 = 12 o'clock in the ring's
// own frame, with a parallel gap of constant pixel width on both sides.
function segmentPath(rIn, rOut, index, gapPx) {
  const p = new Path2D();
  const c = index * STEP - Math.PI / 2;
  const half = STEP / 2;
  const go = gapPx > 0 ? (gapPx / 2) / rOut : 0;
  const gi = gapPx > 0 ? (gapPx / 2) / rIn : 0;
  p.arc(0, 0, rOut, c - half + go, c + half - go, false);
  p.arc(0, 0, rIn, c + half - gi, c - half + gi, true);
  p.closePath();
  return p;
}
function annulusPath(rIn, rOut) {
  const p = new Path2D();
  p.arc(0, 0, rOut, 0, TAU, false);
  p.moveTo(rIn, 0);
  p.arc(0, 0, rIn, 0, TAU, true);
  p.closePath();
  return p;
}

// ---- Procedural textures (deterministic, generated once per kind) ----------------
const Textures = {
  _cache: {},
  get(kind, g) {
    if (!kind) return null;
    if (this._cache[kind]) return this._cache[kind];
    const size = 192;
    const c = makeCanvas(size, size), x = c.getContext('2d');
    const r = makeRng('orbit-tex:' + kind);
    if (kind === 'grain' || kind === 'speckle') {
      const img = x.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const v = r();
        const dark = v < 0.5;
        const a = kind === 'speckle' ? (v < 0.04 || v > 0.985 ? 220 : 0) : Math.floor(Math.abs(v - 0.5) * 2 * 255);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = dark ? 0 : 255;
        img.data[i * 4 + 3] = a;
      }
      x.putImageData(img, 0, 0);
    } else if (kind === 'paper') {
      for (let i = 0; i < 900; i++) {
        x.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.5)';
        x.lineWidth = r.range(0.3, 0.9);
        const px = r() * size, py = r() * size, a = r() * TAU, l = r.range(2, 9);
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
    } else if (kind === 'halftone') {
      x.fillStyle = 'rgba(0,0,0,1)';
      const s = 5;
      for (let yy = 0; yy < size; yy += s) for (let xx = 0; xx < size; xx += s) {
        const off = ((yy / s) % 2) * s / 2;
        x.beginPath(); x.arc(xx + off, yy, 1.05, 0, TAU); x.fill();
      }
    } else if (kind === 'lines') {
      x.strokeStyle = 'rgba(255,255,255,1)';
      x.lineWidth = 0.6;
      for (let i = -size; i < size * 2; i += 3) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + size, size); x.stroke(); }
    } else if (kind === 'crackle') {
      x.strokeStyle = 'rgba(0,0,0,0.9)';
      x.lineWidth = 0.5;
      for (let i = 0; i < 26; i++) {
        let px = r() * size, py = r() * size;
        x.beginPath(); x.moveTo(px, py);
        for (let j = 0; j < 5; j++) { px += r.range(-22, 22); py += r.range(-22, 22); x.lineTo(px, py); }
        x.stroke();
      }
    } else if (kind === 'brushed') {
      return null; // drawn as concentric hairlines instead (see brushedDisc)
    }
    const pat = g.createPattern(c, 'repeat');
    this._cache[kind] = pat;
    return pat;
  },
  // Concentric brushing for metal: rotation invariant, so it never needs re-drawing.
  brushedDisc(R, pr) {
    const key = 'brushed:' + Math.round(R * pr);
    if (this._cache[key]) return this._cache[key];
    const S = Math.ceil(R * 2 * pr);
    const c = makeCanvas(S, S), x = c.getContext('2d');
    x.setTransform(pr, 0, 0, pr, S / 2, S / 2);
    const r = makeRng('orbit-brush');
    for (let rr = R * 0.15; rr < R; rr += 0.55) {
      const v = r();
      x.strokeStyle = v < 0.5 ? 'rgba(0,0,0,' + (0.25 * r()).toFixed(3) + ')' : 'rgba(255,255,255,' + (0.3 * r()).toFixed(3) + ')';
      x.lineWidth = 0.45;
      x.beginPath(); x.arc(0, 0, rr, 0, TAU); x.stroke();
    }
    this._cache[key] = c;
    return c;
  }
};

// ---- Ground (background) ---------------------------------------------------------
// Cached per theme and viewport: base tone, light behind the board, ambient
// shadow, vignette, a quiet engineering pattern and grain.
function paintGround(x, theme, W, H, cx, cy, R) {
  const bg = theme.bg;
  x.fillStyle = bg.base.css;
  x.fillRect(0, 0, W, H);

  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  let gr = x.createRadialGradient(cx, cy, R * 0.2, cx, cy, far);
  gr.addColorStop(0, bg.lift.css);
  gr.addColorStop(0.55, bg.base.css);
  gr.addColorStop(1, bg.deep.css);
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  // Faint coloured light behind the sculpture.
  gr = x.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.65);
  gr.addColorStop(0, rgba(bg.glow, bg.glowAlpha));
  gr.addColorStop(1, rgba(bg.glow, 0));
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  // Ambient shadow, cast away from the light.
  const la = theme.light.angle;
  const sx = cx - Math.cos(la) * R * 0.035, sy = cy - Math.sin(la) * R * 0.035 + R * 0.02;
  gr = x.createRadialGradient(sx, sy, R * 0.9, sx, sy, R * 1.16);
  const sh = bg.light ? 0.13 : 0.42;
  gr.addColorStop(0, 'rgba(0,0,0,' + sh + ')');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.beginPath(); x.arc(sx, sy, R * 1.16, 0, TAU); x.fill();

  // Engineering pattern.
  const ink = theme.ink;
  const pa = bg.light ? 0.10 : 0.075;
  x.save();
  x.translate(cx, cy);
  x.lineWidth = 0.8;
  x.strokeStyle = rgba(ink, pa);
  x.fillStyle = rgba(ink, pa * 1.6);
  if (bg.pattern === 'orbits') {
    [1.13, 1.34, 1.72].forEach((m, i) => {
      x.beginPath(); x.arc(0, 0, R * m, 0, TAU); x.stroke();
      const a = -0.6 + i * 2.1;
      x.beginPath(); x.arc(Math.cos(a) * R * m, Math.sin(a) * R * m, 1.6 + i * 0.4, 0, TAU); x.fill();
    });
  } else if (bg.pattern === 'ticks') {
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * TAU - Math.PI / 2;
      const major = i % 10 === 5; // segment boundaries sit half a step from slot centres
      const r0 = R * 1.085, r1 = R * (major ? 1.13 : 1.1);
      x.globalAlpha = major ? 1.4 : 0.7;
      x.beginPath(); x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); x.stroke();
    }
    x.globalAlpha = 1;
  } else if (bg.pattern === 'grid') {
    const s = Math.max(14, R * 0.09);
    for (let gx = -cx + (cx % s); gx < W - cx; gx += s) for (let gy = -cy + (cy % s); gy < H - cy; gy += s) {
      const d = Math.hypot(gx, gy);
      if (d < R * 1.1) continue;
      x.globalAlpha = Math.min(1, (d - R * 1.1) / (R * 0.6));
      x.fillRect(gx - 0.6, gy - 0.6, 1.2, 1.2);
    }
    x.globalAlpha = 1;
  } else if (bg.pattern === 'rays') {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i + 0.5) * STEP - Math.PI / 2;
      const g2 = x.createLinearGradient(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08, Math.cos(a) * R * 2.2, Math.sin(a) * R * 2.2);
      g2.addColorStop(0, rgba(ink, pa * 1.3)); g2.addColorStop(1, rgba(ink, 0));
      x.strokeStyle = g2;
      x.beginPath(); x.moveTo(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08); x.lineTo(Math.cos(a) * R * 2.2, Math.sin(a) * R * 2.2); x.stroke();
    }
  }
  // Every ground carries the index: a fine mark at 12 o'clock and twelve dots at
  // slot centres, so the 30-degree grid is always readable.
  x.fillStyle = rgba(ink, bg.light ? 0.32 : 0.26);
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * STEP - Math.PI / 2;
    x.beginPath(); x.arc(Math.cos(a) * R * 1.045, Math.sin(a) * R * 1.045, i === 0 ? 0 : 1, 0, TAU); x.fill();
  }
  x.fillStyle = rgba(ink, bg.light ? 0.7 : 0.6);
  x.beginPath();
  x.moveTo(0, -R * 1.032); x.lineTo(-R * 0.018, -R * 1.068); x.lineTo(R * 0.018, -R * 1.068);
  x.closePath(); x.fill();
  x.restore();

  // Vignette.
  gr = x.createRadialGradient(cx, cy, Math.min(W, H) * 0.45, cx, cy, far * 1.05);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, bg.light ? 'rgba(60,40,20,0.10)' : 'rgba(0,0,0,0.38)');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  const grain = Textures.get('grain', x);
  if (grain) { x.globalAlpha = bg.grain; x.fillStyle = grain; x.fillRect(0, 0, W, H); x.globalAlpha = 1; }
}

// ---- The board -----------------------------------------------------------------------
// scene = { ringCount, angles[], families(k,i), selected, aligned[], flash[], complete, completeT,
//           dimOthers, hint }
function createBoardPainter() {
  const P = { geom: null, paths: null, annuli: null, key: '' };

  P.prepare = function (R, ringCount, theme) {
    const sepScale = clamp(R / 170, 0.7, 1.6);
    const sep = theme.sep;
    const gapPx = (sep.style === 'hairline' || sep.style === 'metal') ? 0.5 : sep.width * sepScale;
    const key = R.toFixed(2) + '|' + ringCount + '|' + gapPx.toFixed(2);
    if (key === P.key) return P.geom;
    P.key = key;
    P.geom = boardGeometry(R, ringCount);
    P.paths = P.geom.rings.map(ring => { const a = []; for (let i = 0; i < SEGMENTS; i++) a.push(segmentPath(ring.rIn, ring.rOut, i, gapPx)); return a; });
    P.annuli = P.geom.rings.map(ring => annulusPath(ring.rIn - 1, ring.rOut + 1));
    P.disc = annulusPath(P.geom.rings[0].rIn - 1, R + 1);
    P.sepScale = sepScale;
    return P.geom;
  };

  // Paint the rings into `x`, whose origin is the board centre (CSS px units).
  P.paint = function (x, theme, scene, pr) {
    const geom = P.geom, n = geom.n, R = geom.R;
    const m = theme.material;
    const pal = theme.paletteFor(n);
    const la = theme.light.angle, li = theme.light.intensity;

    // 1. OrbitRing base colour, segment by segment.
    for (let k = 0; k < n; k++) {
      x.save();
      x.rotate(scene.angles[k]);
      x.globalAlpha = m.alpha;
      for (let i = 0; i < SEGMENTS; i++) {
        x.fillStyle = pal[k][scene.families(k, i)].css;
        x.fill(P.paths[k][i]);
      }
      if (m.misregister) {
        // Print: a second, slightly shifted impression darkens one edge.
        x.globalAlpha = 0.28;
        x.translate(0.9, 0.7);
        for (let i = 0; i < SEGMENTS; i++) { x.fillStyle = pal[k][scene.families(k, i)].css; x.fill(P.paths[k][i]); }
      }
      if (m.pool) {
        // Watercolour: pigment pools at the edge of each wash.
        x.globalAlpha = 0.42;
        x.lineWidth = 1.3;
        for (let i = 0; i < SEGMENTS; i++) {
          const c = pal[k][scene.families(k, i)];
          x.strokeStyle = colour(c.L - 0.14, c.C * 1.1, c.h).css;
          x.stroke(P.paths[k][i]);
        }
      }
      x.restore();
    }

    // Everything below only touches pixels already painted.
    x.globalCompositeOperation = 'source-atop';

    // 2. Bevel: each ring reads as a turned, rounded band. One radial gradient
    // covers every ring (stops per ring), so it costs a single fill.
    {
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, R + 1);
      const b = m.bevel, f = r => clamp(r / (R + 1), 0, 1);
      const W = (a) => 'rgba(255,255,255,' + a.toFixed(3) + ')', K = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';
      for (let k = 0; k < n; k++) {
        const ring = geom.rings[k], w = ring.rOut - ring.rIn;
        const at = u => f(ring.rIn + w * u);
        if (b >= 0) {
          gr.addColorStop(at(0), K(b * 0.75)); gr.addColorStop(at(0.22), K(0));
          gr.addColorStop(at(0.62), W(m.gloss * 0.55)); gr.addColorStop(at(0.9), W(0));
          gr.addColorStop(at(1), K(b * 0.35));
        } else {
          gr.addColorStop(at(0), W(-b * 0.35)); gr.addColorStop(at(0.5), K(-b * 0.6)); gr.addColorStop(at(1), W(-b * 0.25));
        }
      }
      x.fillStyle = gr;
      x.fill(P.disc);
    }

    // 3. Directional light across the whole sculpture (fixed in world space).
    const lx = Math.cos(la) * R, ly = Math.sin(la) * R;
    let lg = x.createLinearGradient(lx, ly, -lx, -ly);
    lg.addColorStop(0, 'rgba(255,255,255,' + (0.13 * li).toFixed(3) + ')');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,' + (0.2 * li).toFixed(3) + ')');
    x.fillStyle = lg;
    x.fill(P.disc);

    // 4. Sheen.
    if (m.sheen && typeof x.createConicGradient === 'function') {
      if (m.sheen === 'brushed') {
        const cg = x.createConicGradient(la, 0, 0);
        for (let i = 0; i <= 8; i++) cg.addColorStop(i / 8, i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.22)');
        x.fillStyle = cg; x.fill(P.disc);
        const disc = Textures.brushedDisc(R, pr);
        x.globalAlpha = 0.9;
        x.drawImage(disc, -R, -R, R * 2, R * 2);
        x.globalAlpha = 1;
      } else if (m.sheen === 'opal' || m.sheen === 'holo') {
        const reps = m.sheen === 'holo' ? 3 : 1;
        const a = m.sheen === 'holo' ? 0.17 : 0.13;
        for (let k = 0; k < n; k++) {
          // The sheen turns faster than the ring, so colour slides as you rotate.
          const cg = x.createConicGradient(scene.angles[k] * 1.7 + k * 0.9, 0, 0);
          const stops = 6 * reps;
          for (let i = 0; i <= stops; i++) cg.addColorStop(i / stops, 'hsla(' + Math.round(i / stops * 360 * reps) + ',90%,70%,' + a + ')');
          x.fillStyle = cg;
          x.fill(P.annuli[k]);
        }
      } else if (m.sheen === 'velvet') {
        const cg = x.createConicGradient(la + Math.PI / 2, 0, 0);
        cg.addColorStop(0, 'rgba(255,255,255,0.08)'); cg.addColorStop(0.5, 'rgba(0,0,0,0.12)'); cg.addColorStop(1, 'rgba(255,255,255,0.08)');
        x.fillStyle = cg; x.fill(P.disc);
      }
    }

    // 5. Texture.
    if (m.texture && m.texture !== 'brushed' && m.texAlpha > 0) {
      const pat = Textures.get(m.texture, x);
      if (pat) { x.globalAlpha = m.texAlpha; x.fillStyle = pat; x.fill(P.disc); x.globalAlpha = 1; }
    }

    // 6. Specular highlight: a soft reflection of the light source.
    if (m.spec > 0) {
      const hx = Math.cos(la) * R * 0.58, hy = Math.sin(la) * R * 0.58;
      const sg = x.createRadialGradient(hx, hy, 0, hx, hy, R * 0.62);
      sg.addColorStop(0, 'rgba(255,255,255,' + (m.spec * 0.42 * li).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sg; x.fill(P.disc);
    }

    // 7. Selection depth: other rings recede, but only slightly. Colours are
    // compared across rings, so a selection must never change how they read.
    if (scene.selected > 0 && scene.dimOthers > 0 && !(scene.focusT > 0.05)) {
      x.fillStyle = rgba(theme.bg.base, 0.12 * scene.dimOthers);
      const sel = geom.rings[scene.selected];
      const p = new Path2D();
      p.arc(0, 0, R + 1, 0, TAU);
      p.moveTo(sel.rOut + 1, 0); p.arc(0, 0, sel.rOut + 1, 0, TAU, true);
      p.moveTo(sel.rIn - 1, 0); p.arc(0, 0, sel.rIn - 1, 0, TAU);
      x.fill(p, 'evenodd');
    }

    // 8. Completion light.
    if (scene.completeT > 0 && scene.completeT < 1) paintCompletion(x, theme, geom, scene);

    x.globalCompositeOperation = 'source-over';

    // 9. Separators that are drawn, not cut.
    const sep = theme.sep;
    if (sep.style === 'hairline' || sep.style === 'metal' || sep.style === 'engraved') {
      for (let k = 0; k < n; k++) {
        const ring = geom.rings[k];
        x.save(); x.rotate(scene.angles[k]);
        x.beginPath();
        for (let i = 0; i < SEGMENTS; i++) {
          const a = i * STEP - STEP / 2 - Math.PI / 2;
          x.moveTo(Math.cos(a) * ring.rIn, Math.sin(a) * ring.rIn);
          x.lineTo(Math.cos(a) * ring.rOut, Math.sin(a) * ring.rOut);
        }
        if (sep.style === 'engraved') {
          // A light catch on one lip of every cut.
          x.strokeStyle = 'rgba(255,255,255,0.10)';
          x.lineWidth = 0.6;
          x.translate(Math.cos(la) * 0.9, Math.sin(la) * 0.9);
        } else {
          x.strokeStyle = sep.colour.css;
          x.lineWidth = sep.width * P.sepScale * (sep.style === 'metal' ? 0.75 : 0.6);
        }
        x.stroke();
        x.restore();
      }
    }

    // 10. Rims: a fine lit edge outside, a shadowed edge inside.
    for (let k = 0; k < n; k++) {
      const ring = geom.rings[k];
      if (sep.style === 'metal') {
        x.strokeStyle = sep.colour.css; x.lineWidth = sep.width * P.sepScale * 0.6;
        x.beginPath(); x.arc(0, 0, ring.rOut, 0, TAU); x.stroke();
        x.beginPath(); x.arc(0, 0, ring.rIn, 0, TAU); x.stroke();
      }
      if (m.rim > 0) {
        const rg = x.createLinearGradient(lx, ly, -lx, -ly);
        rg.addColorStop(0, 'rgba(255,255,255,' + (m.rim * 0.9).toFixed(3) + ')');
        rg.addColorStop(0.5, 'rgba(255,255,255,' + (m.rim * 0.2).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.strokeStyle = rg; x.lineWidth = 0.8;
        x.beginPath(); x.arc(0, 0, ring.rOut - 0.4, 0, TAU); x.stroke();
        if (m.alpha < 1) { x.beginPath(); x.arc(0, 0, ring.rIn + 0.4, 0, TAU); x.stroke(); }
      }
    }

    // 11. Family highlight: every segment of one colour family, outlined, so a
    // match can be checked by eye rather than by memory.
    const ink = theme.ink;
    if (scene.famFocus && scene.famFocus.a > 0.01) {
      const ff = scene.famFocus;
      x.lineJoin = 'round';
      for (let k = 0; k < n; k++) {
        x.save(); x.rotate(scene.angles[k]);
        for (let i = 0; i < SEGMENTS; i++) {
          if (scene.families(k, i) !== ff.fam) continue;
          x.strokeStyle = 'rgba(0,0,0,' + (0.45 * ff.a).toFixed(3) + ')'; x.lineWidth = 4; x.stroke(P.paths[k][i]);
          x.strokeStyle = rgba(theme.bg.light ? colour(0.15, 0, 0) : colour(1, 0, 0), 0.95 * ff.a); x.lineWidth = 1.8; x.stroke(P.paths[k][i]);
        }
        x.restore();
      }
    }
    // 12. Selection rim, in the interface ink.
    if (scene.selected > 0) {
      const ring = geom.rings[scene.selected];
      const s = scene.selectT;
      x.strokeStyle = rgba(ink, 0.85 * s);
      x.lineWidth = 1.4;
      x.beginPath(); x.arc(0, 0, ring.rOut + 1.2, 0, TAU); x.stroke();
      x.strokeStyle = rgba(ink, 0.3 * s);
      x.lineWidth = 0.8;
      x.beginPath(); x.arc(0, 0, ring.rIn - 1.2, 0, TAU); x.stroke();
    }
  };
  return P;
}

function paintCompletion(x, theme, geom, scene) {
  const t = scene.completeT, R = geom.R, n = geom.n;
  const style = theme.completion;
  if (style === 'radiance') {
    const r = lerp(geom.hubR * 0.6, R * 1.25, easeInOutSine(t));
    const w = R * 0.32;
    const gr = x.createRadialGradient(0, 0, Math.max(0, r - w), 0, 0, r + w * 0.25);
    const a = 0.55 * (1 - t * 0.55);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.8, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  } else if (style === 'sweep' && typeof x.createConicGradient === 'function') {
    const head = -Math.PI / 2 + easeInOutSine(t) * TAU;
    const cg = x.createConicGradient(head - 1.2, 0, 0);
    const a = 0.5 * Math.sin(Math.PI * t) + 0.1;
    cg.addColorStop(0, 'rgba(255,255,255,0)');
    cg.addColorStop(0.19, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    cg.addColorStop(0.2, 'rgba(255,255,255,0)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = cg;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  } else if (style === 'chime') {
    for (let k = 0; k < n; k++) {
      const c = k / n * 0.7, d = Math.abs(t - c - 0.12);
      const a = Math.max(0, 1 - d / 0.14) * 0.5;
      if (a <= 0) continue;
      const ring = geom.rings[k];
      x.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      x.beginPath(); x.arc(0, 0, ring.rOut, 0, TAU); x.arc(0, 0, ring.rIn, 0, TAU, true); x.fill();
    }
  } else {
    // bloom
    const a = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.3));
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, R);
    gr.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,255,255,' + (a * 0.3).toFixed(3) + ')');
    x.fillStyle = gr;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  }
}

// The hub: the mechanical axis. A small machined disc with an orbit mark whose
// planet travels a third of the way round with each stage; three ticks mark them.
function paintHub(x, theme, geom, orbitA, completeGlow) {
  const h = geom.hubR;
  const t = theme.hubTone, light = theme.bg.light;
  const la = theme.light.angle;
  x.save();
  // seat shadow
  x.fillStyle = light ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.45)';
  x.beginPath(); x.arc(0, h * 0.04, h * 1.04, 0, TAU); x.fill();
  const g = x.createRadialGradient(Math.cos(la) * h * 0.5, Math.sin(la) * h * 0.5, h * 0.05, 0, 0, h);
  g.addColorStop(0, colour(t.L + (light ? 0.05 : 0.09), t.C, t.h).css);
  g.addColorStop(1, colour(t.L - (light ? 0.05 : 0.06), t.C, t.h).css);
  x.fillStyle = g;
  x.beginPath(); x.arc(0, 0, h, 0, TAU); x.fill();
  // turned rings
  x.lineWidth = 0.6;
  for (let i = 1; i <= 3; i++) {
    x.strokeStyle = i % 2 ? 'rgba(255,255,255,' + (light ? 0.5 : 0.06) + ')' : 'rgba(0,0,0,' + (light ? 0.08 : 0.25) + ')';
    x.beginPath(); x.arc(0, 0, h * (0.62 + i * 0.1), 0, TAU); x.stroke();
  }
  // lit rim
  const rg = x.createLinearGradient(Math.cos(la) * h, Math.sin(la) * h, -Math.cos(la) * h, -Math.sin(la) * h);
  rg.addColorStop(0, 'rgba(255,255,255,' + (light ? 0.9 : 0.35) + ')');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  x.strokeStyle = rg; x.lineWidth = 1;
  x.beginPath(); x.arc(0, 0, h - 0.5, 0, TAU); x.stroke();
  // orbit mark
  const ink = theme.ink;
  const or = h * 0.36;
  x.strokeStyle = rgba(ink, 0.55 + completeGlow * 0.4);
  x.lineWidth = 1;
  x.beginPath(); x.arc(0, 0, or, 0, TAU); x.stroke();
  for (let j = 0; j < 3; j++) {
    const ta = -Math.PI / 2 + j * TAU / 3;
    x.beginPath(); x.moveTo(Math.cos(ta) * or * 0.78, Math.sin(ta) * or * 0.78); x.lineTo(Math.cos(ta) * or * 1.22, Math.sin(ta) * or * 1.22); x.stroke();
  }
  x.fillStyle = rgba(ink, 0.9);
  x.beginPath(); x.arc(0, 0, h * 0.06, 0, TAU); x.fill();
  const pa = orbitA - Math.PI / 2;
  x.fillStyle = completeGlow > 0 ? theme.accent.css : rgba(ink, 0.95);
  x.beginPath(); x.arc(Math.cos(pa) * or, Math.sin(pa) * or, h * 0.085 + completeGlow * h * 0.025, 0, TAU); x.fill();
  x.restore();
}

// Hint: three chevrons on the ring near 12 o'clock, travelling the way to turn.
function paintHint(x, theme, geom, hint, now) {
  if (!hint) return;
  const ring = geom.rings[hint.ring];
  const ph = (now / 900) % 1;
  const col = theme.bg.light ? colour(0.18, 0, 0) : colour(1, 0, 0);
  const s = Math.max(3.5, Math.min(7, geom.w * 0.26));
  x.save();
  x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const u = (i + ph) / 3;                         // 0..1 along the run
    const a = (hint.a === undefined ? -Math.PI / 2 : hint.a) + hint.dir * (-0.3 + u * 0.6);
    const alpha = Math.sin(Math.PI * u) * hint.alpha;
    const px = Math.cos(a) * ring.mid, py = Math.sin(a) * ring.mid;
    const tx = -Math.sin(a) * hint.dir, ty = Math.cos(a) * hint.dir; // direction of travel
    const nx = Math.cos(a), ny = Math.sin(a);
    x.strokeStyle = rgba(col, Math.max(0, alpha) * 0.9);
    x.beginPath();
    x.moveTo(px - tx * s * 0.5 + nx * s * 0.8, py - ty * s * 0.5 + ny * s * 0.8);
    x.lineTo(px + tx * s * 0.5, py + ty * s * 0.5);
    x.lineTo(px - tx * s * 0.5 - nx * s * 0.8, py - ty * s * 0.5 - ny * s * 0.8);
    x.stroke();
  }
  x.restore();
}

// ---- Intersection clues ----------------------------------------------------------------
// Each revealed condition has a marker on the rim at its column and a pin on
// every ring it reads. Pins are fixed in the world: they frame whatever segment
// is passing beneath. Markers carry the rule's glyph and its state:
//   revealed  new, never yet satisfied: a slow halo breathes around it
//   unsolved  held before, broken now: outline with a partial-progress arc
//   solved    filled with the interface ink
function clueGeom(geom) {
  const R = geom.R;
  return { Rm: R * 1.135, mr: clamp(R * 0.064, 8.5, 15) };
}
function colAngle(pos) { return pos * STEP - Math.PI / 2; }

function paintGlyph(x, type, cx, cy, s, fill, swatch) {
  x.save();
  x.translate(cx, cy);
  x.fillStyle = fill; x.strokeStyle = fill; x.lineWidth = Math.max(1, s * 0.16); x.lineCap = 'round'; x.lineJoin = 'round';
  const dot = (px, py, r, hollow) => { x.beginPath(); x.arc(px, py, r, 0, TAU); hollow ? x.stroke() : x.fill(); };
  const d = s * 0.22;
  switch (type) {
    case 'triple': dot(0, -s * 0.36, d); dot(-s * 0.36, s * 0.26, d); dot(s * 0.36, s * 0.26, d); break;
    case 'pair': dot(-s * 0.44, 0, d); dot(0, 0, d); dot(s * 0.44, 0, d * 0.9, true); break;
    case 'contrast':
      x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.stroke();
      x.beginPath(); x.arc(0, 0, s * 0.5, -Math.PI / 2, Math.PI / 2); x.closePath(); x.fill(); break;
    case 'odd':
      dot(-s * 0.46, s * 0.12, d); dot(-s * 0.08, s * 0.12, d);
      x.beginPath(); x.moveTo(s * 0.4, -s * 0.24); x.lineTo(s * 0.62, s * 0.0); x.lineTo(s * 0.4, s * 0.24); x.lineTo(s * 0.18, 0); x.closePath(); x.fill(); break;
    case 'sequence':
      [-1, 0, 1].forEach(j => { const h = s * (0.32 + (j + 1) * 0.22); x.fillRect(j * s * 0.36 - s * 0.1, s * 0.45 - h, s * 0.2, h); }); break;
    case 'missing':
      if (swatch) { x.fillStyle = swatch; x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.fill(); }
      x.strokeStyle = fill; x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(-s * 0.46, s * 0.46); x.lineTo(s * 0.46, -s * 0.46); x.stroke(); break;
    case 'alldiff':
      x.beginPath(); x.moveTo(-s * 0.5, -s * 0.18); x.lineTo(s * 0.5, -s * 0.18); x.moveTo(-s * 0.5, s * 0.18); x.lineTo(s * 0.5, s * 0.18);
      x.moveTo(s * 0.22, -s * 0.52); x.lineTo(-s * 0.22, s * 0.52); x.stroke(); break;
  }
  x.restore();
}

function paintClues(x, theme, geom, scene, now) {
  const ink = theme.ink, light = theme.bg.light;
  const cg = clueGeom(geom), Rm = cg.Rm, mr = cg.mr;
  const pal = theme.paletteFor(geom.n);
  const shadow = light ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';

  // Focus: the rest of the board recedes behind the chosen column.
  if (scene.focusT > 0.01 && scene.focus >= 0 && scene.clues[scene.focus]) {
    const c = scene.clues[scene.focus], a = colAngle(c.pos), h = STEP / 2;
    const p = new Path2D();
    p.arc(0, 0, geom.R + 2, 0, TAU);
    p.moveTo(Math.cos(a - h) * geom.rings[0].rIn, Math.sin(a - h) * geom.rings[0].rIn);
    p.arc(0, 0, geom.R + 2, a - h, a + h);
    p.arc(0, 0, geom.rings[0].rIn, a + h, a - h, true);
    p.closePath();
    x.fillStyle = rgba(theme.bg.base, 0.42 * scene.focusT);
    x.fill(p, 'evenodd');
    x.strokeStyle = rgba(ink, 0.55 * scene.focusT); x.lineWidth = 1;
    x.beginPath(); x.arc(0, 0, geom.R + 2.5, a - h, a + h); x.arc(0, 0, geom.rings[0].rIn - 1.5, a + h, a - h, true); x.closePath(); x.stroke();
  }

  scene.clues.forEach((c, i) => {
    if (!c || c.appear <= 0.001) return;
    const a = colAngle(c.pos), ca = Math.cos(a), sa = Math.sin(a);
    const ap = easeOutCubic(clamp(c.appear, 0, 1));
    const focused = scene.focus === i;
    const solved = c.status === 'solved';
    const lit = Math.max(c.glow || 0, solved ? 1 : 0);

    // Pins.
    const pinR = clamp(geom.w * 0.2, 2.6, 5.5) * (0.4 + 0.6 * ap);
    c.rings.forEach((k, j) => {
      const ring = geom.rings[k], px = ca * ring.mid, py = sa * ring.mid;
      const diamond = c.type === 'odd' && j === c.odd;
      const shape = () => {
        x.beginPath();
        if (diamond) { const q = pinR * 1.35; x.moveTo(px, py - q); x.lineTo(px + q, py); x.lineTo(px, py + q); x.lineTo(px - q, py); x.closePath(); }
        else x.arc(px, py, pinR, 0, TAU);
      };
      x.globalAlpha = ap;
      shape(); x.strokeStyle = shadow; x.lineWidth = 3.2; x.stroke();
      shape(); x.strokeStyle = rgba(ink, solved ? 1 : 0.92); x.lineWidth = 1.5; x.stroke();
      if (solved) { x.fillStyle = rgba(ink, 0.95); x.beginPath(); x.arc(px, py, pinR * 0.32, 0, TAU); x.fill(); }
      x.globalAlpha = 1;
    });

    // A fine tick from the board edge to the marker.
    x.strokeStyle = rgba(ink, 0.35 * ap); x.lineWidth = 1;
    x.beginPath(); x.moveTo(ca * (geom.R + 2), sa * (geom.R + 2)); x.lineTo(ca * (Rm - mr - 1), sa * (Rm - mr - 1)); x.stroke();

    // Marker.
    const mx = ca * Rm, my = sa * Rm, r = mr * (0.6 + 0.4 * ap) * (focused ? 1.12 : 1);
    x.globalAlpha = ap;
    if (c.status === 'revealed' && !solved) {
      const ph = ((now - (c.revealAt || 0)) / 1800) % 1;
      x.strokeStyle = rgba(ink, 0.35 * (1 - ph)); x.lineWidth = 1;
      x.beginPath(); x.arc(mx, my, r * (1 + ph * 0.7), 0, TAU); x.stroke();
    }
    if (lit > 0.01) {
      const gr = x.createRadialGradient(mx, my, r * 0.6, mx, my, r * 2.4);
      gr.addColorStop(0, rgba(ink, 0.22 * lit)); gr.addColorStop(1, rgba(ink, 0));
      x.fillStyle = gr; x.beginPath(); x.arc(mx, my, r * 2.4, 0, TAU); x.fill();
    }
    x.fillStyle = solved ? rgba(ink, 0.96) : rgba(theme.bg.base, 0.9);
    x.beginPath(); x.arc(mx, my, r, 0, TAU); x.fill();
    if (!solved) {
      x.strokeStyle = rgba(ink, focused ? 0.9 : 0.5); x.lineWidth = 1;
      x.beginPath(); x.arc(mx, my, r, 0, TAU); x.stroke();
      if (c.progress > 0) {
        x.strokeStyle = rgba(ink, 0.95); x.lineWidth = 2;
        x.beginPath(); x.arc(mx, my, r, -Math.PI / 2, -Math.PI / 2 + TAU * c.progress); x.stroke();
      }
    }
    const swatch = c.type === 'missing' ? pal[geom.n - 1][c.fam].css : null;
    paintGlyph(x, c.type, mx, my, r * 1.05, solved ? theme.bg.base.css : rgba(ink, 0.95), swatch);
    if (focused) { x.strokeStyle = rgba(ink, 0.9); x.lineWidth = 1; x.beginPath(); x.arc(mx, my, r + 3.5, 0, TAU); x.stroke(); }
    x.globalAlpha = 1;
  });
}

// GameBoard: owns the main canvas, the ground cache and the offscreen board layer.
function createGameBoard(canvas, bgCanvas) {
  const g = canvas.getContext('2d');
  const bgx = bgCanvas ? bgCanvas.getContext('2d') : null;
  const B = {
    canvas, g, W: 1, H: 1, pr: 1, cx: 0, cy: 0, R: 100, bgKey: '', mainFull: true,
    painter: createBoardPainter(),
    groundCache: {},
    layer: null, lx: null
  };
  B.resize = function (W, H, pr, cx, cy, R) {
    B.W = W; B.H = H; B.pr = pr; B.cx = cx; B.cy = cy; B.R = R;
    const bw = Math.round(W * pr), bh = Math.round(H * pr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    if (bgCanvas) { if (bgCanvas.width !== bw) bgCanvas.width = bw; if (bgCanvas.height !== bh) bgCanvas.height = bh; }
    B.bgKey = ''; B.mainFull = true;
    B.groundCache = {};
    const S = Math.ceil((R * 2 + 16) * pr);
    if (!B.layer || B.layer.width !== S) { B.layer = makeCanvas(S, S); B.lx = B.layer.getContext('2d'); }
  };
  B.ground = function (theme) {
    const k = theme.key;
    if (B.groundCache[k]) return B.groundCache[k];
    const keys = Object.keys(B.groundCache);
    if (keys.length > 3) delete B.groundCache[keys[0]];
    const c = makeCanvas(B.W * B.pr, B.H * B.pr), x = c.getContext('2d');
    x.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    paintGround(x, theme, B.W, B.H, B.cx, B.cy, B.R);
    B.groundCache[k] = c;
    return c;
  };
  // Draw one complete frame of `theme` (ground + board + hub) into the main canvas.
  // The ground lives on its own background canvas, so a normal frame only
  // repaints the square around the board. Transitions paint everything (full).
  B.drawScene = function (theme, scene, now, full) {
    const geom = B.painter.prepare(B.R, scene.ringCount, theme);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (full || !bgx) {
      g.drawImage(B.ground(theme), 0, 0);
      B.mainFull = true;
    } else {
      if (B.bgKey !== theme.key) {
        bgx.setTransform(1, 0, 0, 1, 0, 0);
        bgx.drawImage(B.ground(theme), 0, 0);
        B.bgKey = theme.key;
      }
      if (B.mainFull) { g.clearRect(0, 0, canvas.width, canvas.height); B.mainFull = false; }
      else {
        const e = B.R * 1.62 * B.pr;
        g.clearRect(Math.floor(B.cx * B.pr - e), Math.floor(B.cy * B.pr - e), Math.ceil(e * 2), Math.ceil(e * 2));
      }
    }
    // completion halo
    if (scene.completeGlow > 0) {
      g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
      const gr = g.createRadialGradient(B.cx, B.cy, B.R * 0.9, B.cx, B.cy, B.R * 1.5);
      gr.addColorStop(0, rgba(theme.bg.glow, (theme.bg.light ? 0.35 : 0.14) * scene.completeGlow));
      gr.addColorStop(1, rgba(theme.bg.glow, 0));
      g.fillStyle = gr; g.fillRect(B.cx - B.R * 1.55, B.cy - B.R * 1.55, B.R * 3.1, B.R * 3.1);
    }
    const S = B.layer.width, x = B.lx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.clearRect(0, 0, S, S);
    x.setTransform(B.pr, 0, 0, B.pr, S / 2, S / 2);
    B.painter.paint(x, theme, scene, B.pr);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(B.layer, Math.round(B.cx * B.pr - S / 2), Math.round(B.cy * B.pr - S / 2));
    g.setTransform(B.pr, 0, 0, B.pr, B.cx * B.pr, B.cy * B.pr);
    if (scene.clues) paintClues(g, theme, geom, scene, now);
    paintHub(g, theme, geom, scene.orbitA, scene.completeGlow);
    if (scene.hint) paintHint(g, theme, geom, scene.hint, now);
    return geom;
  };
  // Theme reveal: the new universe opens out from the axis.
  B.drawTransition = function (fromTheme, fromScene, toTheme, toScene, t, now) {
    B.drawScene(fromTheme, fromScene, now, true);
    const far = Math.hypot(Math.max(B.cx, B.W - B.cx), Math.max(B.cy, B.H - B.cy));
    const r = easeInOutSine(t) * far;
    g.save();
    g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    g.beginPath(); g.arc(B.cx, B.cy, Math.max(0.1, r), 0, TAU); g.clip();
    B.drawScene(toTheme, toScene, now, true);
    g.restore();
    g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    g.strokeStyle = rgba(toTheme.ink, 0.5 * (1 - t));
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(B.cx, B.cy, Math.max(0.1, r), 0, TAU); g.stroke();
  };
  return B;
}

// A solved, still miniature of a theme for the collection.
function renderThumbnail(theme, ringCount, sizeCss, pr, families) {
  const c = makeCanvas(sizeCss * pr, sizeCss * pr);
  const x = c.getContext('2d');
  x.setTransform(pr, 0, 0, pr, 0, 0);
  const R = sizeCss * 0.4;
  paintGround(x, theme, sizeCss, sizeCss, sizeCss / 2, sizeCss / 2, R);
  const painter = createBoardPainter();
  const geom = painter.prepare(R, ringCount, theme);
  const S = Math.ceil((R * 2 + 8) * pr);
  const layer = makeCanvas(S, S), lx = layer.getContext('2d');
  lx.setTransform(pr, 0, 0, pr, S / 2, S / 2);
  const angles = []; for (let k = 0; k < ringCount; k++) angles.push(0);
  painter.paint(lx, theme, { ringCount, angles, families: families || ((k, i) => i), selected: -1, completeT: 0 }, pr);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(layer, Math.round(sizeCss * pr / 2 - S / 2), Math.round(sizeCss * pr / 2 - S / 2));
  x.setTransform(pr, 0, 0, pr, sizeCss / 2 * pr, sizeCss / 2 * pr);
  paintHub(x, theme, geom, 0, 1);
  return c;
}

// ---- 04_audio.js ----
// Sound: a minimal, synthesised sound language (no samples).
// Detent ticks while dragging, a soft mechanical snap, a tuned bell per ring on
// alignment, a chord on completion. Plus a quiet ambient bed via ctx.music.

function createSound(ctx) {
  const S = { ac: null, master: null, muted: false, ok: false, lastTick: 0, music: null };
  const caps = ctx.capabilities || {};
  // Each ring has its own note, so a solved board plays as a chord.
  const NOTES = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

  function ensure() {
    if (S.ac || !caps.audio) return !!S.ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      S.ac = new AC();
      S.master = S.ac.createGain();
      S.master.gain.value = S.muted ? 0 : 0.9;
      const comp = S.ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      S.master.connect(comp); comp.connect(S.ac.destination);
      // Short noise buffer shared by every click.
      const len = Math.floor(S.ac.sampleRate * 0.05);
      S.noise = S.ac.createBuffer(1, len, S.ac.sampleRate);
      const d = S.noise.getChannelData(0);
      const r = makeRng('orbit-noise');
      for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3);
      S.ok = true;
      ctx.onDestroy(() => { try { S.ac.close(); } catch (e) { } });
    } catch (e) { S.ok = false; }
    return S.ok;
  }

  // Must run inside a user gesture: unlocks WebAudio and starts the music bed.
  S.unlock = function () {
    ensure();
    if (S.ac && S.ac.state === 'suspended') { try { S.ac.resume(); } catch (e) { } }
    if (!S.music && caps.backgroundMusic && ctx.music && !S.muted) {
      try {
        ctx.music.unlock();
        S.music = ctx.music.play({ preset: 'ambient', volume: 0.14, tempo: 64, intensity: 0.18, density: 0.25, scale: 'lydian', fadeInMs: 3000 });
      } catch (e) { S.music = null; }
    }
  };

  function click(t, freq, q, gain, dur) {
    const src = S.ac.createBufferSource(); src.buffer = S.noise;
    const bp = S.ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = S.ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(S.master);
    src.start(t); src.stop(t + dur + 0.01);
  }
  function tone(t, freq, gain, dur, type, attack) {
    const o = S.ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = S.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(S.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function live() { return S.ok && !S.muted && S.ac && S.ac.state === 'running'; }

  // A detent: the ring passing a 30-degree notch while dragged.
  S.tick = function (ring) {
    if (!live()) return;
    const now = S.ac.currentTime;
    if (now - S.lastTick < 0.028) return;
    S.lastTick = now;
    click(now, 2600 + ring * 180, 6, 0.10, 0.03);
  };
  // The ring seating itself on release.
  S.snap = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    click(t, 1500, 2.5, 0.16, 0.045);
    tone(t, 140, 0.07, 0.07, 'sine');
  };
  // Restrained tonal confirmation: a small bell, tuned per ring.
  S.align = function (ring) {
    if (!live()) return;
    const t = S.ac.currentTime + 0.02;
    const f = NOTES[ring % NOTES.length];
    tone(t, f, 0.075, 1.4, 'sine', 0.004);
    tone(t, f * 2.76, 0.018, 0.5, 'sine', 0.003);
    tone(t, f * 2, 0.02, 0.9, 'triangle', 0.01);
  };
  S.refuse = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    click(t, 600, 3, 0.08, 0.05);
  };
  S.undo = function () {
    if (!live()) return;
    click(S.ac.currentTime, 1100, 3, 0.08, 0.04);
  };
  // Completion: the rings' notes, rolled slowly into one chord.
  S.complete = function (ringCount) {
    if (!live()) return;
    const t0 = S.ac.currentTime + 0.1;
    for (let k = 1; k < ringCount; k++) {
      const f = NOTES[k % NOTES.length];
      tone(t0 + k * 0.11, f, 0.06, 3.2, 'sine', 0.02);
      tone(t0 + k * 0.11, f * 2, 0.012, 2.0, 'triangle', 0.02);
    }
    tone(t0, NOTES[0] / 2, 0.05, 3.6, 'sine', 0.3);
    if (S.music) { try { ctx.music.duck(0.6, 2600); } catch (e) { } }
  };
  // A soft shimmer for the theme reveal.
  S.reveal = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    const o = S.ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.9);
    const g = S.ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(S.master); o.start(t); o.stop(t + 1.2);
  };
  // A stage opens: a slow rising fifth under the shimmer.
  S.stage = function (stage) {
    if (!live()) return;
    S.reveal();
    const t = S.ac.currentTime + 0.35;
    const f = NOTES[(stage * 2) % NOTES.length];
    tone(t, f / 2, 0.05, 2.2, 'sine', 0.06);
    tone(t + 0.18, f * 0.75, 0.04, 2.0, 'sine', 0.06);
    if (S.music) { try { ctx.music.duck(0.75, 1600); } catch (e) { } }
  };
  S.setProgress = function (p) {
    if (S.music) { try { ctx.music.setIntensity(0.15 + p * 0.25, { fadeMs: 1500 }); } catch (e) { } }
  };
  S.setMuted = function (m) {
    S.muted = !!m;
    if (S.master) S.master.gain.value = S.muted ? 0 : 0.9;
    if (S.muted) {
      if (S.music) { try { ctx.music.stop({ fadeOutMs: 300 }); } catch (e) { } S.music = null; }
    }
  };
  return S;
}

// ---- 05_score.js ----
// ScoreManager and the collection: streak, bests, discovered themes, studies
// progress and the leaderboard records. Independent of rendering and puzzle logic.

// v2: the intersection puzzle. Results from the first (alignment) prototype are
// not comparable, so they are left behind rather than merged.
const PROFILE_KEY = 'orbit.profile.v2';

function emptyProfile() {
  return { v: 2, rev: 0, muted: false, seenIntro: false, streak: { count: 0, best: 0, last: 0 }, daily: {}, levels: { reached: 1, best: {} }, coll: [] };
}

function validProfile(p) {
  return p && p.v === 2 && typeof p.rev === 'number' && p.streak && typeof p.streak.count === 'number' &&
    p.daily && typeof p.daily === 'object' && p.levels && typeof p.levels.reached === 'number' && Array.isArray(p.coll);
}

// Merge two valid profiles without losing anything either side earned.
function mergeProfiles(a, b) {
  if (!validProfile(a)) return b;
  if (!validProfile(b)) return a;
  const out = emptyProfile();
  out.rev = Math.max(a.rev, b.rev);
  const newer = a.rev >= b.rev ? a : b;
  out.muted = newer.muted; out.seenIntro = a.seenIntro || b.seenIntro;
  const sa = a.streak, sb = b.streak;
  out.streak = sa.last > sb.last ? Object.assign({}, sa) : sb.last > sa.last ? Object.assign({}, sb) : { count: Math.max(sa.count, sb.count), best: 0, last: sa.last };
  out.streak.best = Math.max(sa.best || 0, sb.best || 0, out.streak.count);
  const better = (x, y) => !x ? y : !y ? x : (x[1] < y[1] || (x[1] === y[1] && x[0] <= y[0])) ? x : y;
  Object.keys(a.daily).concat(Object.keys(b.daily)).forEach(k => { out.daily[k] = better(a.daily[k], b.daily[k]); });
  out.levels.reached = Math.max(a.levels.reached, b.levels.reached);
  Object.keys(a.levels.best || {}).concat(Object.keys(b.levels.best || {})).forEach(k => { out.levels.best[k] = better((a.levels.best || {})[k], (b.levels.best || {})[k]); });
  const seen = {};
  a.coll.concat(b.coll).forEach(k => { if (typeof k === 'string' && !seen[k]) { seen[k] = 1; out.coll.push(k); } });
  return trimProfile(out);
}

// Keep the saved state well inside the 8 KB limit.
function trimProfile(p) {
  const trim = (obj, keep) => { const ks = Object.keys(obj).map(Number).sort((x, y) => y - x); ks.slice(keep).forEach(k => delete obj[k]); };
  trim(p.daily, 45);
  trim(p.levels.best, 30);
  if (p.coll.length > 520) p.coll = p.coll.slice(p.coll.length - 520);
  return p;
}

function createScoreManager(ctx) {
  const caps = ctx.capabilities || {};
  const M = { profile: emptyProfile(), cloud: 'pending', listeners: [], disposed: false };
  ctx.onDestroy(() => { M.disposed = true; });

  // Device cache first: instant, synchronous, used for the first frame.
  try {
    if (caps.storage && ctx.storage) {
      const p = ctx.storage.get(PROFILE_KEY);
      if (validProfile(p)) M.profile = trimProfile(p);
    }
  } catch (e) { }

  let localChan = null;
  try { localChan = ctx.memory && ctx.memory.local ? ctx.memory.local('profile') : null; } catch (e) { localChan = null; }

  // Cloud hydrate. A failed read is not an empty profile: we keep working
  // locally and do not write over the account's saved state.
  M.hydrate = function () {
    if (!localChan) { M.cloud = 'unavailable'; return Promise.resolve(false); }
    return localChan.get().then(res => {
      if (M.disposed) return false;
      const v = res && res.value;
      if (v && validProfile(v)) M.profile = mergeProfiles(M.profile, v);
      M.cloud = 'ready';
      M.emit();
      return true;
    }).catch(err => {
      if (M.disposed) return false;
      M.cloud = 'failed';
      try { ctx.platform.error({ stage: 'profile_load', message: String(err && err.message || err) }); } catch (e) { }
      return false;
    });
  };

  let saveSeq = 0, saving = false, again = false;
  function cloudSave() {
    if (!localChan || M.cloud !== 'ready' || M.disposed) return;
    if (saving) { again = true; return; }
    saving = true;
    const snapshot = JSON.parse(JSON.stringify(M.profile));
    localChan.set(snapshot).catch(err => {
      try { ctx.platform.error({ stage: 'profile_save', message: String(err && err.message || err) }); } catch (e) { }
    }).then(() => {
      saving = false;
      if (again && !M.disposed) { again = false; cloudSave(); }
    });
  }
  M.save = function (immediate) {
    M.profile.rev++;
    trimProfile(M.profile);
    try { if (caps.storage && ctx.storage) ctx.storage.set(PROFILE_KEY, M.profile); } catch (e) { }
    // Coalesce cloud writes; only the latest scheduled save runs.
    const token = ++saveSeq;
    ctx.timeout(() => { if (token === saveSeq) cloudSave(); }, immediate ? 50 : 1500);
  };

  M.on = function (fn) { M.listeners.push(fn); };
  M.emit = function () { M.listeners.forEach(fn => { try { fn(M.profile); } catch (e) { } }); };

  M.currentStreak = function (today) {
    const s = M.profile.streak;
    return s.last === today || s.last === today - 1 ? s.count : 0;
  };
  M.dailyResult = function (day) { return M.profile.daily[day] || null; };
  M.bestDailyTime = function () {
    let best = null;
    Object.keys(M.profile.daily).forEach(k => { const d = M.profile.daily[k]; if (best === null || d[1] < best) best = d[1]; });
    return best;
  };
  M.hasTheme = function (key) { return M.profile.coll.indexOf(key) >= 0; };

  // Record a finished daily. Returns what changed, for the completion screen.
  M.completeDaily = function (day, moves, timeMs, hints, themeKey, stars) {
    const p = M.profile;
    const prevBest = M.bestDailyTime();
    const first = !p.daily[day];
    if (first) {
      const s = p.streak;
      if (s.last === day - 1) s.count += 1; else if (s.last !== day) s.count = 1;
      s.last = day;
      s.best = Math.max(s.best, s.count);
      p.daily[day] = [moves, timeMs, hints, stars || 0];
    }
    const newTheme = M.addTheme(themeKey);
    M.save(true);
    return { first, streak: p.streak.count, bestStreak: p.streak.best, prevBest, isBest: first && (prevBest === null || timeMs < prevBest), newTheme };
  };
  M.completeLevel = function (level, moves, timeMs, themeKey, stars) {
    const p = M.profile;
    const prev = p.levels.best[level];
    if (!prev || timeMs < prev[1]) p.levels.best[level] = [moves, timeMs, 0, stars || 0];
    p.levels.reached = Math.max(p.levels.reached, level + 1);
    const newTheme = M.addTheme(themeKey);
    M.save(true);
    return { newTheme, prev };
  };
  M.addTheme = function (key) {
    if (M.hasTheme(key)) return false;
    M.profile.coll.push(key);
    return true;
  };
  M.setFlag = function (name, v) { if (M.profile[name] !== v) { M.profile[name] = v; M.save(false); } };

  // ---- Leaderboard records ----------------------------------------------------
  // solve_time: fastest daily solve (asc). streak: longest daily streak (desc).
  let attempt = 0;
  M.newAttempt = function () { attempt++; return attempt; };
  function rec(id) { try { return ctx.memory && ctx.memory.record ? ctx.memory.record(id) : null; } catch (e) { return null; } }

  M.submitDaily = function (timeMs, moves, day, streak, onResult) {
    const owner = attempt;
    const r = rec('solve_time');
    if (!r) { onResult({ error: 'unavailable' }); return; }
    r.submit(Math.round(timeMs), { label: fmtTime(timeMs), metadata: { edition: day, moves } }).then(res => {
      if (M.disposed || owner !== attempt) return;
      onResult({ submitted: true, res });
      return r.leaderboard({ scope: 'global', period: 'daily', limit: 3 }).then(board => {
        if (M.disposed || owner !== attempt) return;
        onResult({ board });
      });
    }).catch(err => {
      if (M.disposed || owner !== attempt) return;
      onResult({ error: err && (err.code || err.message) || 'failed' });
    });
    const s = rec('streak');
    if (s && streak > 0) s.submit(streak, { label: streak + (streak === 1 ? ' day' : ' days') }).catch(err => {
      try { ctx.platform.error({ stage: 'streak_submit', message: String(err && err.message || err) }); } catch (e) { }
    });
  };
  M.readBest = function (onResult) {
    const owner = attempt;
    const r = rec('solve_time');
    if (!r || !r.rank) return;
    r.rank({ scope: 'global', period: 'all_time' }).then(st => {
      if (M.disposed || owner !== attempt) return;
      onResult(st && st.viewerRank ? st.viewerRank.value : null);
    }).catch(() => { });
  };
  return M;
}

// ---- 06_ui.js ----
// DOM interface: GameHeader, GameControls, tap-rotate controls, CompletionScreen
// and the Collection. Purely presentational; every action calls back into main.

const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v4h4"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6" class="f"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></svg>',
  ccw: '<svg viewBox="0 0 24 24"><path d="M7.5 6.2A8 8 0 1 1 4 12"/><path d="M3.6 6.8 7.6 6l.8 4"/></svg>',
  cw: '<svg viewBox="0 0 24 24"><path d="M16.5 6.2A8 8 0 1 0 20 12"/><path d="M20.4 6.8 16.4 6l-.8 4"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  coll: '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3.5"/><path d="M7.5 8 12 3.5 16.5 8"/><path d="M5 12v7.5h14V12"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h13.5"/><path d="m13.5 7 5 5-5 5"/></svg>'
};

// Clue glyphs as inline SVG, matching the markers drawn on the board.
function glyphSvg(type, swatch) {
  const dot = (x, y, r, hollow) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"' + (hollow ? '' : ' class="f"') + '/>';
  let b = '';
  switch (type) {
    case 'triple': b = dot(12, 6.5, 2.6) + dot(6.5, 16, 2.6) + dot(17.5, 16, 2.6); break;
    case 'pair': b = dot(5.5, 12, 2.6) + dot(12, 12, 2.6) + dot(18.5, 12, 2.3, true); break;
    case 'contrast': b = '<circle cx="12" cy="12" r="7.5"/><path class="f" d="M12 4.5a7.5 7.5 0 0 1 0 15z"/>'; break;
    case 'odd': b = dot(5, 13.5, 2.6) + dot(11, 13.5, 2.6) + '<path class="f" d="M18 8l3.6 4.5L18 17l-3.6-4.5z"/>'; break;
    case 'sequence': b = '<path class="f" d="M4.5 15.5h3.2v4H4.5zM10.4 11h3.2v8.5h-3.2zM16.3 6h3.2v13.5h-3.2z"/>'; break;
    case 'missing': b = '<circle cx="12" cy="12" r="7.5" style="fill:' + (swatch || 'none') + '"/><path d="M6.7 17.3 17.3 6.7"/>'; break;
    case 'alldiff': b = '<path d="M5 9.2h14M5 14.8h14M14.6 4.6 9.4 19.4"/>'; break;
  }
  return '<svg viewBox="0 0 24 24">' + b + '</svg>';
}

const HUD_CSS = `
.orb{position:absolute;inset:0;font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;pointer-events:none}
.orb *{box-sizing:border-box}
.orb button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.orb button:focus-visible{outline:1px solid var(--dim);outline-offset:3px;border-radius:999px}
.orb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;display:block}
.orb svg .f{fill:currentColor;stroke:none}
.orb .hdr{position:absolute;left:0;right:0;text-align:center;transition:opacity .5s}
.orb .brand{font-size:9.5px;letter-spacing:.42em;color:var(--dim);font-weight:500;padding-left:.42em}
.orb .title{font-size:30px;font-weight:300;letter-spacing:.52em;padding-left:.52em;white-space:nowrap;line-height:1;margin-top:9px;color:var(--ink);transition:letter-spacing .9s}
.orb .label{font-family:'Space Mono',ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.2em;color:var(--dim);margin-top:11px;text-transform:uppercase;white-space:nowrap}
.orb .tabs{display:flex;justify-content:center;gap:18px;margin-top:12px}
.orb .tab{font-size:10px;letter-spacing:.24em;padding:6px 2px 5px;color:var(--faint);border-bottom:1px solid transparent;text-transform:uppercase;transition:color .3s,border-color .3s}
.orb .tab.on{color:var(--ink);border-color:var(--faint)}
.orb .corner{position:absolute;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dim);transition:color .3s,opacity .3s}
.orb .corner:active{color:var(--ink)}
.orb .bottom{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center}
.orb .cap{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:19px;line-height:1.25;text-align:center;color:var(--ink);min-height:24px;padding:0 24px;transition:opacity .35s}
.orb .cap.small{font-family:'Space Grotesk',sans-serif;font-style:normal;font-size:12px;letter-spacing:.06em;color:var(--dim)}
.orb .clabel{font-family:'Space Mono',ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase;min-height:12px;text-align:center;white-space:nowrap}
.orb .cap.two{min-height:46px;display:flex;align-items:flex-start;justify-content:center;max-width:360px;margin-top:4px}
.orb .chips{display:flex;justify-content:center;align-items:center;gap:4px;margin-top:10px}
.orb .chip{width:38px;height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--dim);position:relative;transition:opacity .4s}
.orb .chip .g{width:28px;height:28px;border-radius:50%;border:1px solid var(--rule);display:flex;align-items:center;justify-content:center;transition:background .3s,border-color .3s,color .3s}
.orb .chip svg{width:17px;height:17px;stroke-width:1.6}
.orb .chip i{font-style:normal;font-family:'Space Mono',ui-monospace,monospace;font-size:8px;letter-spacing:.04em;color:var(--faint);line-height:1}
.orb .chip.solved .g{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.orb .chip.unsolved .g{border-color:var(--dim);color:var(--ink)}
.orb .chip.revealed .g{border-color:var(--ink);color:var(--ink);animation:orbpulse 1.8s ease-in-out infinite}
.orb .chip.focus .g{outline:1px solid var(--ink);outline-offset:3px}
.orb .chip.focus i{color:var(--ink)}
.orb .chip.lock{pointer-events:none}
.orb .chip.lock .g{border-style:dashed;opacity:.55}
.orb .chip.lock .g::after{content:'';width:3px;height:3px;border-radius:50%;background:var(--faint)}
.orb .chip.new{animation:orbin .7s cubic-bezier(.2,.8,.2,1) both}
.orb .csep{width:1px;height:20px;background:var(--rule);margin:0 5px 12px}
@keyframes orbpulse{0%,100%{box-shadow:0 0 0 0 var(--rule)}50%{box-shadow:0 0 0 5px var(--rule)}}
@keyframes orbin{0%{opacity:0;transform:translateY(6px) scale(.7)}100%{opacity:1;transform:none}}
.orb .stars{font-size:17px;letter-spacing:.32em;padding-left:.32em;margin-top:8px;color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif}
.orb .stars s{text-decoration:none;color:var(--faint)}
.orb .stats{display:flex;justify-content:center;gap:0;margin-top:16px}
.orb .stat{width:96px;text-align:center}
.orb .stat+.stat{border-left:1px solid var(--rule)}
.orb .stat b{display:block;font-family:'Space Mono',ui-monospace,monospace;font-weight:400;font-size:17px;letter-spacing:.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.orb .stat i{display:block;font-style:normal;font-size:8.5px;letter-spacing:.26em;color:var(--faint);margin-top:5px;text-transform:uppercase;padding-left:.26em}
.orb .ctrls{display:flex;justify-content:center;gap:10px;margin-top:14px}
.orb .ctl{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:52px;min-height:48px;justify-content:center;color:var(--dim);transition:color .2s,opacity .3s}
.orb .ctl:active{color:var(--ink)}
.orb .ctl span{font-size:8.5px;letter-spacing:.24em;text-transform:uppercase;padding-left:.24em}
.orb .ctl.warn{color:var(--ink)}
.orb .ctl[disabled]{opacity:.32;pointer-events:none}
.orb .rot{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink);border:1px solid var(--rule);background:var(--glass);opacity:0;transform:scale(.86);transition:opacity .25s,transform .25s;pointer-events:none}
.orb .rot.on{opacity:1;transform:scale(1);pointer-events:auto}
.orb .rot:active{background:var(--rule)}
.orb .play{transition:opacity .45s}
.orb .done{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:none}
.orb .done.on{transition:opacity .8s,transform .8s}
.orb .done.on{opacity:1;transform:none}
.orb .done.on button{pointer-events:auto}
.orb .kick{font-size:8.5px;letter-spacing:.34em;color:var(--faint);text-transform:uppercase;padding-left:.34em}
.orb .tname{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:31px;line-height:1.05;margin-top:6px;text-align:center;padding:0 20px}
.orb .tdesc{font-size:11.5px;line-height:1.5;color:var(--dim);text-align:center;max-width:300px;margin-top:7px;padding:0 16px}
.orb .dstats{display:flex;justify-content:center;margin-top:14px}
.orb .dstats .stat{width:76px}
.orb .dstats .stat b{font-size:15px}
.orb .board3{font-family:'Space Mono',monospace;font-size:9px;line-height:1.6;letter-spacing:.06em;color:var(--dim);margin-top:9px;min-height:14px;text-align:center;padding:0 16px;white-space:pre-line;max-width:100%;max-height:30px;overflow:hidden}
.orb .acts{display:flex;justify-content:center;gap:8px;margin-top:12px;padding:0 12px;flex-wrap:nowrap}
.orb .act{height:42px;padding:0 14px;border-radius:999px;border:1px solid var(--rule);display:flex;align-items:center;gap:7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);white-space:nowrap}
.orb .act svg{width:16px;height:16px}
.orb .act.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.orb .act:active{opacity:.75}
.orb.compact .tdesc,.orb.compact .board3{display:none}
.orb.compact .tname{font-size:26px}
.orb.compact .cap{font-size:15px}
.orb.compact .cap.two{min-height:38px}
.orb.compact .chip{height:40px}
.orb.compact .chip .g{width:25px;height:25px}
.orb.compact .chips{margin-top:6px}
.orb.compact .cap.small{font-size:11px;letter-spacing:.03em}
.orb.compact .dstats{margin-top:8px}
.orb.compact .ctl{min-height:44px}
.orb .toast{position:absolute;left:50%;transform:translate(-50%,6px);font-size:11px;letter-spacing:.06em;color:var(--ink);background:var(--glass);border:1px solid var(--rule);padding:8px 14px;border-radius:999px;opacity:0;transition:opacity .3s,transform .3s;white-space:nowrap}
.orb .toast.on{opacity:1;transform:translate(-50%,0)}
.orbm{position:absolute;inset:0;background:var(--scrim);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;color:var(--ink);opacity:0;transition:opacity .35s;pointer-events:none;overflow:hidden;-webkit-user-select:none;user-select:none}
.orbm.on{opacity:1;pointer-events:auto}
.orbm button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.orbm svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;display:block}
.orbm .mh{position:absolute;left:0;right:0;text-align:center}
.orbm .mh .kick{font-size:9px;letter-spacing:.36em;color:var(--dim);text-transform:uppercase;padding-left:.36em}
.orbm .mh h2{margin:8px 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:28px}
.orbm .mh p{margin:6px 0 0;font-size:11px;color:var(--dim);letter-spacing:.04em}
.orbm .x{position:absolute;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dim)}
.orbm .grid{position:absolute;left:0;right:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:18px 12px;padding:8px 20px 28px;touch-action:pan-y}
.orbm .card{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.orbm .card img,.orbm .card .ph{width:96px;height:96px;border-radius:50%;display:block}
.orbm .card .ph{border:1px dashed var(--rule);display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:26px;color:var(--faint)}
.orbm .card b{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:15px;line-height:1.1}
.orbm .card i{font-style:normal;font-family:'Space Mono',monospace;font-size:8.5px;letter-spacing:.14em;color:var(--faint);text-transform:uppercase}
.orbm .det{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 24px}
.orbm .det img{border-radius:50%}
.orbm .det h3{margin:16px 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:30px}
.orbm .det .meta{font-family:'Space Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--faint);margin-top:6px;text-transform:uppercase}
.orbm .det p{font-size:12px;line-height:1.55;color:var(--dim);max-width:320px;margin:10px 0 0}
.orbm .det .acts{display:flex;gap:10px;margin-top:18px}
.orbm .act{height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--rule);display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.2em;text-transform:uppercase}
.orbm .act.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.orbm .empty{position:absolute;left:0;right:0;text-align:center;font-size:12px;color:var(--dim);padding:0 32px;line-height:1.6}
`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function createHud(ctx, H) {
  const root = ctx.createRoot({ className: 'orb', layer: 'overlay', input: 'passthrough' });
  const style = el('style'); style.textContent = HUD_CSS; root.appendChild(style);

  // GameHeader
  const hdr = el('div', 'hdr');
  const brand = el('div', 'brand', 'PLETHORA');
  const title = el('div', 'title', 'ORBIT');
  const label = el('div', 'label', 'DAILY PUZZLE');
  const tabs = el('div', 'tabs');
  const tDaily = el('button', 'tab on', 'Daily'); const tStudy = el('button', 'tab', 'Practice');
  tDaily.type = tStudy.type = 'button';
  tabs.appendChild(tDaily); tabs.appendChild(tStudy);
  hdr.appendChild(brand); hdr.appendChild(title); hdr.appendChild(label); hdr.appendChild(tabs);
  root.appendChild(hdr);

  const bColl = el('button', 'corner', ICONS.coll); bColl.setAttribute('aria-label', 'Collection');
  const bMute = el('button', 'corner', ICONS.sound); bMute.setAttribute('aria-label', 'Sound');
  root.appendChild(bColl); root.appendChild(bMute);

  // Play-state bottom block: the focused clue, the clue chips, stats, GameControls
  const play = el('div', 'bottom play');
  const clabel = el('div', 'clabel', '');
  const cap = el('div', 'cap two', '');
  const chips = el('div', 'chips');
  const stats = el('div', 'stats');
  const sMoves = el('div', 'stat', '<b>0</b><i>Moves</i>');
  const sTime = el('div', 'stat', '<b>0:00</b><i>Time</i>');
  const sAl = el('div', 'stat', '<b>1/3</b><i>Stage</i>');
  stats.appendChild(sMoves); stats.appendChild(sTime); stats.appendChild(sAl);
  const ctrls = el('div', 'ctrls');
  const bUndo = el('button', 'ctl', ICONS.undo + '<span>Undo</span>');
  const rotL = el('button', 'ctl', ICONS.ccw + '<span>Turn</span>'); rotL.setAttribute('aria-label', 'Turn the selected ring anticlockwise');
  const rotR = el('button', 'ctl', ICONS.cw + '<span>Turn</span>'); rotR.setAttribute('aria-label', 'Turn the selected ring clockwise');
  const bHint = el('button', 'ctl', ICONS.hint + '<span>Hint</span>');
  const bReset = el('button', 'ctl', ICONS.reset + '<span>Restart</span>');
  [bUndo, rotL, rotR, bHint, bReset].forEach(b => { b.type = 'button'; ctrls.appendChild(b); });
  play.appendChild(clabel); play.appendChild(cap); play.appendChild(chips); play.appendChild(stats); play.appendChild(ctrls);
  root.appendChild(play);

  // CompletionScreen
  const done = el('div', 'done');
  const dKick = el('div', 'kick', 'Discovered');
  const dName = el('div', 'tname', '');
  const dStars = el('div', 'stars', '');
  const dDesc = el('div', 'tdesc', '');
  const dStats = el('div', 'stats dstats');
  const dB = el('div', 'board3', '');
  const acts = el('div', 'acts');
  const aShare = el('button', 'act', ICONS.share + '<span>Share</span>');
  const aColl = el('button', 'act', ICONS.coll + '<span>Collection</span>');
  const aNext = el('button', 'act pri', '<span>Next study</span>' + ICONS.next);
  [aShare, aColl, aNext].forEach(b => { b.type = 'button'; acts.appendChild(b); });
  done.appendChild(dKick); done.appendChild(dName); done.appendChild(dStars); done.appendChild(dDesc); done.appendChild(dStats); done.appendChild(dB); done.appendChild(acts);
  root.appendChild(done);

  const toast = el('div', 'toast', ''); root.appendChild(toast);

  // Collection modal
  const modal = ctx.createRoot({ className: 'orbm', layer: 'modal', input: 'passthrough' });
  modal.setAttribute('aria-hidden', 'true');

  const act = (b, fn) => ctx.input.activate(b, e => { if (e && e.preventDefault) e.preventDefault(); fn(); });
  act(tDaily, () => H.onMode('daily'));
  act(tStudy, () => H.onMode('study'));
  act(bColl, () => H.onCollection());
  act(bMute, () => H.onMute());
  act(bUndo, () => H.onUndo());
  act(bReset, () => H.onReset());
  act(bHint, () => H.onHint());
  act(rotL, () => H.onRotate(-1));
  act(rotR, () => H.onRotate(1));
  act(aShare, () => H.onShare());
  act(aColl, () => H.onCollection());
  act(aNext, () => H.onNext());

  const U = { root, modal, layout: null };

  U.applyTheme = function (theme) {
    const ink = theme.ink, light = theme.bg.light;
    const s = root.style, m = modal.style;
    const vars = {
      '--ink': ink.css,
      '--dim': rgba(ink, light ? 0.72 : 0.66),
      '--faint': rgba(ink, light ? 0.55 : 0.46),
      '--rule': rgba(ink, light ? 0.2 : 0.16),
      '--glass': rgba(theme.bg.base, 0.55),
      '--bg': theme.bg.base.css,
      '--scrim': rgba(theme.bg.deep, light ? 0.78 : 0.72)
    };
    Object.keys(vars).forEach(k => { s.setProperty(k, vars[k]); m.setProperty(k, vars[k]); });
  };

  // Lay everything out from the content safe area and the board geometry.
  U.setLayout = function (L) {
    U.layout = L;
    hdr.style.top = L.headerTop + 'px';
    hdr.style.left = L.colX + 'px'; hdr.style.width = L.colW + 'px';
    bColl.style.left = (L.area.left + 8) + 'px'; bColl.style.top = (L.area.top + 4) + 'px';
    bMute.style.right = (L.area.right + 8) + 'px'; bMute.style.top = (L.area.top + 4) + 'px';
    play.style.top = L.bottomTop + 'px'; play.style.left = L.colX + 'px'; play.style.width = L.colW + 'px';
    done.style.top = (L.doneTop) + 'px'; done.style.left = L.colX + 'px'; done.style.width = L.colW + 'px';
    toast.style.top = (L.cy - L.R * 1.22 - 14) + 'px';
    toast.style.left = (L.cx) + 'px';
    const compact = L.compact;
    root.classList.toggle('compact', !!compact);
    title.style.fontSize = compact ? '24px' : '30px';
    tabs.style.marginTop = compact ? '8px' : '12px';
    stats.style.marginTop = compact ? '10px' : '16px';
    ctrls.style.marginTop = compact ? '4px' : '12px';
  };

  U.setHeader = function (mode, text, complete) {
    tDaily.classList.toggle('on', mode === 'daily');
    tStudy.classList.toggle('on', mode === 'study');
    label.textContent = text;
    title.textContent = complete ? 'COMPLETE' : 'ORBIT';
    title.style.letterSpacing = title.style.paddingLeft = complete ? '.3em' : '';
    brand.textContent = complete ? 'ORBIT' : 'PLETHORA';
    tabs.style.visibility = mode === 'gallery' ? 'hidden' : '';
  };
  U.setStats = function (moves, budget, timeMs, stage, stages) {
    sMoves.firstChild.textContent = budget ? moves + '/' + budget : String(moves);
    sMoves.classList.toggle('over', !!budget && moves > budget);
    sMoves.lastChild.textContent = budget && moves > budget ? 'Over budget' : 'Moves';
    sTime.firstChild.textContent = fmtTime(timeMs);
    sAl.firstChild.textContent = stage + '/' + stages;
  };
  // The focused clue: a short label and a one-line rule.
  U.setClueText = function (label, text) {
    clabel.textContent = label || '';
    cap.textContent = text || '';
    cap.classList.remove('small');
  };
  // clues: [{ type, hour, status, locked, focus, swatch, isNew }] grouped by stage.
  let chipEls = [], chipSig = '';
  U.setClues = function (clues, stages) {
    const sig = stages.join(',') + '|' + clues.length;
    if (sig !== chipSig) {
      chipSig = sig; chips.innerHTML = ''; chipEls = [];
      let idx = 0;
      stages.forEach((n, st) => {
        if (st) chips.appendChild(el('div', 'csep'));
        for (let j = 0; j < n; j++, idx++) {
          const b = el('button', 'chip', '<div class="g"></div><i></i>');
          b.type = 'button';
          const i = idx;
          act(b, () => H.onClue(i));
          chips.appendChild(b); chipEls.push(b);
        }
      });
    }
    clues.forEach((c, i) => {
      const b = chipEls[i]; if (!b) return;
      const key = [c.type, c.status, c.locked, c.swatch].join('|');
      if (b._key !== key) {
        b._key = key;
        b.firstChild.innerHTML = c.locked ? '' : glyphSvg(c.type, c.swatch);
        b.lastChild.textContent = c.locked ? '' : c.hour;
        b.setAttribute('aria-label', c.locked ? 'Hidden clue' : c.hour + ' ' + c.label + ', ' + c.status);
      }
      b.className = 'chip ' + (c.locked ? 'lock' : c.status) + (c.focus ? ' focus' : '') + (c.isNew ? ' new' : '');
    });
  };
  U.setTime = function (ms) { sTime.firstChild.textContent = fmtTime(ms); };
  U.setCaption = function (text, serif) {
    cap.textContent = text;
    cap.classList.toggle('small', !serif);
  };
  U.setControls = function (canUndo, playing) {
    bUndo.disabled = !canUndo || !playing;
    bReset.disabled = !playing;
    bHint.disabled = !playing;
  };
  let rotOn = false;
  let resetArmed = 0;
  U.armReset = function (on) {
    resetArmed = on;
    bReset.classList.toggle('warn', !!on);
    bReset.querySelector('span').textContent = on ? 'Confirm' : 'Restart';
  };
  U.resetArmed = () => resetArmed;
  U.setMuted = function (m) { bMute.innerHTML = m ? ICONS.mute : ICONS.sound; bMute.setAttribute('aria-label', m ? 'Sound off' : 'Sound on'); };
  U.showRotate = function (on) { rotOn = !!on; rotL.disabled = rotR.disabled = !on; };
  U.showPlay = function (on) { play.style.opacity = on ? '1' : '0'; play.style.pointerEvents = 'none'; [bUndo, bReset, bHint, rotL, rotR].concat(chipEls).forEach(b => { b.style.visibility = on ? '' : 'hidden'; }); };
  U.showDone = function (d) {
    if (!d) { done.classList.remove('on'); done.setAttribute('aria-hidden', 'true'); return; }
    dKick.textContent = d.kicker;
    dName.textContent = d.name;
    dStars.innerHTML = d.stars ? '★'.repeat(d.stars) + '<s>' + '★'.repeat(3 - d.stars) + '</s>' : '';
    dStars.style.display = d.stars ? '' : 'none';
    dDesc.textContent = d.desc;
    dStats.innerHTML = '';
    d.stats.forEach(s => { const e = el('div', 'stat'); e.innerHTML = '<b></b><i></i>'; e.firstChild.textContent = s[1]; e.lastChild.textContent = s[0]; dStats.appendChild(e); });
    dB.textContent = d.board || '';
    aNext.querySelector('span').textContent = d.nextLabel;
    aShare.style.display = d.canShare ? '' : 'none';
    done.classList.add('on');
    done.removeAttribute('aria-hidden');
  };
  U.setBoardLine = function (t) { dB.textContent = t || ''; };
  let toastSeq = 0;
  U.toast = function (text, ms) {
    toast.textContent = text;
    toast.classList.add('on');
    const s = ++toastSeq;
    ctx.timeout(() => { if (s === toastSeq) toast.classList.remove('on'); }, ms || 2200);
  };

  // ---- Collection ------------------------------------------------------------
  let modalOpen = false, thumbQueue = [], mtoken = 0;
  U.isModalOpen = () => modalOpen;
  U.closeModal = function () {
    modalOpen = false; mtoken++;
    modal.classList.remove('on');
    modal.setAttribute('aria-hidden', 'true');
    ctx.timeout(() => { if (!modalOpen) modal.innerHTML = ''; }, 400);
  };
  function header(kick, h, p) {
    const L = U.layout;
    const mh = el('div', 'mh');
    mh.style.top = (L.area.top + 10) + 'px';
    const k = el('div', 'kick'); k.textContent = kick; mh.appendChild(k);
    const t = el('h2'); t.textContent = h; mh.appendChild(t);
    if (p) { const pp = el('p'); pp.textContent = p; mh.appendChild(pp); }
    modal.appendChild(mh);
    const x = el('button', 'x', ICONS.close); x.setAttribute('aria-label', 'Close');
    x.style.top = (L.area.top + 4) + 'px'; x.style.right = (L.area.right + 8) + 'px';
    ctx.input.activate(x, () => H.onCloseModal());
    ctx.surface.enableInput(x);
    modal.appendChild(x);
  }
  // items: [{ key, title, sub, ringCount, theme() }] newest first; next: { title, sub }
  U.openCollection = function (items, next) {
    const L = U.layout;
    modal.innerHTML = '';
    modalOpen = true; const tok = ++mtoken;
    header('Your collection', items.length + (items.length === 1 ? ' visual universe' : ' visual universes'), 'Every solved puzzle keeps the composition it resolved into.');
    const grid = el('div', 'grid');
    grid.style.top = (L.area.top + 110) + 'px';
    grid.style.bottom = (L.H - (L.H - L.area.bottom)) + 'px';
    grid.style.bottom = L.area.bottom + 'px';
    ctx.surface.enableInput(grid);
    if (next) {
      const c = el('div', 'card');
      c.innerHTML = '<div class="ph">?</div><b></b><i></i>';
      c.querySelector('b').textContent = next.title; c.querySelector('i').textContent = next.sub;
      grid.appendChild(c);
    }
    thumbQueue = [];
    items.forEach(it => {
      const c = el('button', 'card');
      c.type = 'button';
      const holder = el('div', 'ph', '');
      holder.style.borderStyle = 'solid';
      c.appendChild(holder);
      const b = el('b'); b.textContent = it.title; c.appendChild(b);
      const i = el('i'); i.textContent = it.sub; c.appendChild(i);
      ctx.input.activate(c, () => H.onCollectionItem(it));
      grid.appendChild(c);
      thumbQueue.push({ holder, it });
    });
    modal.appendChild(grid);
    if (!items.length) {
      const e = el('div', 'empty'); e.style.top = (L.area.top + 150) + 'px';
      e.textContent = 'Solve a puzzle to collect its visual universe. Each one is new.';
      modal.appendChild(e);
    }
    modal.classList.add('on'); modal.removeAttribute('aria-hidden');
    // Render thumbnails a few at a time so opening stays smooth.
    const pr = Math.min(2, ctx.nativeDpr || ctx.dpr || 1);
    const pump = () => {
      if (tok !== mtoken || !modalOpen) return;
      for (let n = 0; n < 1 && thumbQueue.length; n++) {
        const q = thumbQueue.shift();
        try {
          const cv = surfaceToImage(renderThumbnail(q.it.theme(), q.it.ringCount, 96, pr, q.it.families && q.it.families()), 96);
          q.holder.replaceWith(cv);
        } catch (e) { }
      }
      if (thumbQueue.length) ctx.timeout(pump, 16);
    };
    ctx.timeout(pump, 30);
  };
  U.openDetail = function (it) {
    const L = U.layout;
    modal.innerHTML = '';
    modalOpen = true; mtoken++;
    header('Collection', '', '');
    const det = el('div', 'det');
    const size = Math.min(L.W - 64, L.H - L.area.top - L.area.bottom - 300, 300);
    det.style.top = (L.area.top + 64) + 'px';
    const theme = it.theme();
    const pr = Math.min(3, ctx.nativeDpr || ctx.dpr || 1);
    const cv = surfaceToImage(renderThumbnail(theme, it.ringCount, size, pr, it.families && it.families()), size);
    det.appendChild(cv);
    const h = el('h3'); h.textContent = theme.name; det.appendChild(h);
    const meta = el('div', 'meta'); meta.textContent = it.sub + ' · ' + theme.universeTitle; det.appendChild(meta);
    const p = el('p'); p.textContent = theme.description + (it.stat ? ' ' + it.stat : ''); det.appendChild(p);
    const acts2 = el('div', 'acts');
    const back = el('button', 'act', '<span>All</span>');
    const view = el('button', 'act pri', '<span>View on board</span>');
    ctx.input.activate(back, () => H.onCollection());
    ctx.input.activate(view, () => H.onGallery(it));
    ctx.surface.enableInput(back); ctx.surface.enableInput(view);
    acts2.appendChild(back); acts2.appendChild(view);
    det.appendChild(acts2);
    modal.appendChild(det);
    modal.classList.add('on');
  };
  return U;
}

// ---- 07_main.js ----
// ORBIT: wiring. Owns layout, input, animation and the game flow
// (play -> stage reveals -> solving -> done -> next), and talks to the Plethora SDK.

window.plethoraBit = {
  meta: {
    title: 'ORBIT',
    runtime: 'plethora-bit@2',
    tags: ['puzzle', 'daily', 'logic', 'colour'],
    permissions: ['audio', 'backgroundMusic', 'haptics', 'storage']
  },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // ---- Fonts (non-blocking: system fallbacks render the first frame) --------
    const fonts = [
      ['Space Grotesk', 'space-grotesk', { weight: '300 700' }],
      ['Space Mono', 'space-mono', { weight: '400' }],
      ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }]
    ];
    fonts.forEach(f => {
      try {
        const p = ctx.loadFont(f[0], f[1], '1.0.0', f[2]);
        if (p && p.catch) p.catch(err => { try { ctx.platform.error({ stage: 'font', font: f[1], message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    });

    // ---- Surfaces ---------------------------------------------------------------
    const canvas = ctx.createCanvas2D({ coordinateSpace: 'backing-store', maxDpr: 3, touchAction: 'none', layer: 'content', input: 'auto' });
    canvas.style.touchAction = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.userSelect = 'none';
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.setAttribute('aria-label', 'ORBIT puzzle board');
    const bgCanvas = ctx.createCanvas2D({ coordinateSpace: 'backing-store', maxDpr: 2, layer: 'background', input: 'passthrough' });
    const board = createGameBoard(canvas, bgCanvas);
    const scores = createScoreManager(ctx);
    const sound = createSound(ctx);
    sound.setMuted(!!scores.profile.muted);

    // ---- Edition --------------------------------------------------------------------
    const todayKey = dateKey(new Date());
    const today = dayNumberFromKey(todayKey);

    // Puzzles are deterministic; keep the few we have built this session.
    const puzzleCache = {};
    function presetFor(mode, n) {
      if (mode === 'daily') return 'standard';
      if (n <= 2) return 'gentle';
      return n % 4 === 0 ? 'deep' : 'standard';
    }
    function puzzleFor(mode, n) {
      const key = mode === 'daily' ? keyFromDayNumber(n) : 'practice:' + n;
      const preset = presetFor(mode, n);
      const ck = key + '|' + preset;
      if (!puzzleCache[ck]) {
        const ks = Object.keys(puzzleCache);
        if (ks.length > 6) delete puzzleCache[ks[0]];
        puzzleCache[ck] = PuzzleGenerator.generate(key, preset);
      }
      return puzzleCache[ck];
    }

    // ---- Game state (single source of truth for the puzzle lives in `eng`) ----------
    const G = {
      mode: 'daily',        // daily | study | gallery
      phase: 'play',        // intro | play | solving | done | transition
      level: 1, day: today,
      puzzle: null, eng: null, theme: null,
      vis: [], tween: [],   // visual angle per ring, active snap tweens
      selected: -1, selectT: 0, selectAt: 0,
      focus: -1, focusT: 0, focusDimUntil: 0,
      famFocus: null,
      clue: [],             // per condition: { appear, glow, revealAt, status, isNew }
      reveal: null,
      completeT: 0, completeGlow: 0, completeAt: 0,
      orbitA: 0,
      hint: null,
      started: false, attempt: 0, interacted: false,
      clock: null, elapsedFallback: 0,
      restoredSolved: false,
      transition: null,
      prev: null,
      dirty: true,
      result: null
    };

    // ---- HUD ---------------------------------------------------------------------------
    const hud = createHud(ctx, {
      onMode: m => switchMode(m),
      onCollection: () => openCollection(),
      onCloseModal: () => closeModal(),
      onCollectionItem: it => hud.openDetail(it),
      onGallery: it => openGallery(it),
      onMute: () => toggleMute(),
      onUndo: () => doUndo(),
      onReset: () => doReset(),
      onHint: () => doHint(),
      onRotate: d => tapRotate(d),
      onClue: i => focusClue(i, true),
      onShare: () => doShare(),
      onNext: () => doNext()
    });
    hud.setMuted(!!scores.profile.muted);
    ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });

    // ---- Layout ----------------------------------------------------------------------------
    // The board is the centre of the piece; clue markers sit just outside its rim.
    const RIM = 1.22;
    let L = null;
    function computeLayout() {
      const W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
      const a0 = ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 120, left: 0 };
      const area = { top: a0.top || 0, right: a0.right || 0, bottom: a0.bottom || 0, left: a0.left || 0 };
      const top = area.top, bot = H - area.bottom;
      const wide = W > H * 1.15 && W >= 620;
      const lay = { W, H, area, wide };
      if (!wide) {
        const compact = (bot - top) < 680;
        const headerH = compact ? 112 : 118;
        const bottomH = compact ? 208 : 268;
        const availTop = top + headerH, availBot = bot - bottomH;
        let R = Math.min((W - 20) / 2 / RIM, (availBot - availTop) / 2 / RIM, 250);
        R = Math.max(60, R);
        lay.compact = compact;
        lay.R = R; lay.cx = W / 2;
        lay.cy = (availTop + availBot) / 2;
        lay.headerTop = top + (compact ? 4 : 10);
        lay.colX = 0; lay.colW = W;
        lay.bottomTop = Math.min(lay.cy + R * RIM + 2, availBot + 6);
        lay.doneTop = lay.bottomTop - 2;
      } else {
        const R = Math.max(60, Math.min((bot - top - 24) / 2 / RIM, (W * 0.56 - 32) / 2 / RIM, 290));
        lay.compact = (bot - top) < 600;
        lay.R = R; lay.cx = area.left + W * 0.29; lay.cy = (top + bot) / 2;
        lay.colX = W * 0.56; lay.colW = W * 0.44 - area.right;
        const colH = 118 + 268;
        lay.headerTop = Math.max(top + 10, (top + bot) / 2 - colH / 2);
        lay.bottomTop = lay.headerTop + 124;
        lay.doneTop = lay.bottomTop;
      }
      return lay;
    }
    function relayout() {
      L = computeLayout();
      const pr = Math.min(2, Math.max(1, ctx.nativeDpr || ctx.dpr || window.devicePixelRatio || 1));
      board.resize(L.W, L.H, pr, L.cx, L.cy, L.R);
      hud.setLayout(L);
      G.dirty = true;
    }

    // ---- Puzzle setup --------------------------------------------------------------------
    function loadPuzzle(mode, n, saved) {
      G.mode = mode;
      if (mode === 'daily') { G.day = n; G.theme = ThemeEngine.forDaily(n); }
      else { G.level = n; G.theme = ThemeEngine.forLevel(n); }
      G.puzzle = puzzleFor(mode, n);
      G.eng = createGame(G.puzzle, saved && saved.eng);
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP);
      G.tween = new Array(nr).fill(null);
      G.clue = G.puzzle.conds.map((c, i) => ({ appear: i < G.eng.revealed() ? 1 : 0, glow: 0, revealAt: 0, status: '', isNew: false }));
      G.reveal = null;
      G.selected = -1; G.selectT = 0; G.hint = null; G.famFocus = null;
      G.focus = G.eng.hintTarget(-1); G.focusT = 0; G.focusDimUntil = 0;
      G.completeT = 0; G.completeGlow = 0; G.result = null;
      G.started = false; G.interacted = false;
      G.orbitA = orbitTarget();
      if (G.clock) { try { G.clock.destroy(); } catch (e) { } }
      G.clock = null;
      G.elapsedFallback = saved && saved.elapsedMs > 0 ? saved.elapsedMs : 0;
      if (ctx.game && ctx.game.stopwatch) {
        try { G.clock = ctx.game.stopwatch({ elapsedMs: G.elapsedFallback }); } catch (e) { G.clock = null; }
      }
      hud.applyTheme(G.theme);
      hud.showRotate(false);
      G.phase = 'play';
      G.dirty = true;
      syncHud();
    }
    function elapsed() { return G.clock ? G.clock.elapsedMs : G.elapsedFallback; }
    function clockStart() { if (G.clock) G.clock.start(); G.running = true; }
    function clockPause() { if (G.clock) G.clock.pause(); G.running = false; }
    function stages() { return G.puzzle.cum.length; }
    function orbitTarget() { return G.eng ? (G.eng.solved ? TAU : (G.eng.stage / stages()) * TAU) : 0; }

    function editionLabel() {
      if (G.mode === 'daily') return 'DAILY PUZZLE · NO. ' + pad3(G.day) + ' · ' + prettyDate(keyFromDayNumber(G.day));
      if (G.mode === 'study') return 'PRACTICE NO. ' + pad3(G.level) + ' · ' + PUZZLE_PRESETS[G.puzzle.preset].label.toUpperCase();
      return 'COLLECTION · ' + (G.galleryItem ? G.galleryItem.sub : '');
    }

    // ---- Caption: the focused clue, or a short message held for a moment ------------------
    let captionHoldUntil = 0;
    function flashCaption(label, text, ms) {
      captionHoldUntil = now() + (ms || 2800);
      hud.setClueText(label, text);
      ctx.timeout(() => { if (now() >= captionHoldUntil - 5) syncHud(); }, (ms || 2800) + 50);
    }
    function clueLabel(i) {
      const c = G.puzzle.conds[i];
      const st = G.eng.status(i);
      const word = st === 'solved' ? 'HOLDS' : st === 'revealed' ? 'NEW' : 'BROKEN';
      return HOURS[c.pos] + ' · ' + CONDITION_TYPES[c.type].label.toUpperCase() + ' · ' + word;
    }
    function syncHud() {
      if (!G.eng) return;
      const playing = G.phase === 'play' || G.phase === 'intro';
      hud.setHeader(G.mode, editionLabel(), G.phase === 'done' && G.mode !== 'gallery');
      hud.setStats(G.eng.moves, G.mode === 'gallery' ? 0 : G.eng.budget, elapsed(), Math.min(G.eng.stage + 1, stages()), stages());
      hud.setControls(G.eng.history.length > 0, playing);
      hud.setClues(G.puzzle.conds.map((c, i) => ({
        type: c.type, label: CONDITION_TYPES[c.type].label, hour: HOURS[c.pos],
        status: G.eng.status(i), locked: i >= G.eng.revealed(), focus: i === G.focus,
        swatch: c.type === 'missing' ? G.theme.paletteFor(G.puzzle.ringCount)[G.puzzle.ringCount - 1][c.fam].css : '',
        isNew: G.clue[i] && G.clue[i].isNew
      })), G.puzzle.stages);
      if (playing && now() >= captionHoldUntil) {
        if (!scores.profile.seenIntro && !G.interacted) {
          hud.setClueText('STAGE 1 OF ' + stages(), 'Turn the rings until every marked intersection holds at once');
        } else if (G.focus >= 0) {
          hud.setClueText(clueLabel(G.focus), condText(G.puzzle.conds[G.focus]));
        } else {
          hud.setClueText('STAGE ' + (G.eng.stage + 1) + ' OF ' + stages(), G.eng.satisfiedCount() + ' of ' + G.eng.revealed() + ' intersections hold');
        }
      }
    }
    function focusClue(i, byUser) {
      if (!G.eng || i < 0 || i >= G.eng.revealed()) return;
      if (byUser) { sound.unlock(); G.interacted = true; }
      G.focus = i;
      G.focusDimUntil = now() + (byUser ? 2600 : 0);
      captionHoldUntil = 0;
      G.dirty = true;
      syncHud();
    }

    // ---- Persistence of the current puzzle --------------------------------------------
    // Device copy on every committed move (cheap, synchronous); Continue Playing
    // progress at bounded checkpoints only.
    const DAY_KEY = 'orbit.day.v2', STUDY_KEY = 'orbit.study.v2';
    function snapshot() { return { v: 2, edition: G.mode === 'daily' ? G.day : G.level, eng: G.eng.serialize(), elapsedMs: Math.round(elapsed()) }; }
    function saveLocal() {
      if (G.mode === 'gallery' || !caps.storage || !ctx.storage) return;
      try { ctx.storage.set(G.mode === 'daily' ? DAY_KEY : STUDY_KEY, snapshot()); } catch (e) { }
    }
    let lastProgressSave = 0, progressDirty = false;
    function saveProgress(force) {
      if (G.mode !== 'daily' || !ctx.game || !ctx.game.progress) return;
      const t = performance.now();
      if (!force && t - lastProgressSave < 12000) { progressDirty = true; return; }
      lastProgressSave = t; progressDirty = false;
      const s = snapshot();
      try {
        ctx.game.progress.save('daily', {
          state: s,
          label: 'No. ' + pad3(G.day) + ' · stage ' + (G.eng.stage + 1) + ' of ' + stages(),
          percent: Math.min(0.99, (G.eng.stage + G.eng.satisfiedCount() / G.eng.revealed()) / stages()),
          stateSchemaVersion: 2
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_save', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
    function readLocal(key, edition) {
      try {
        if (!caps.storage || !ctx.storage) return null;
        const s = ctx.storage.get(key);
        if (s && s.v === 2 && s.edition === edition && s.eng) return s;
      } catch (e) { }
      return null;
    }

    // ---- Animation helpers --------------------------------------------------------------
    function now() { return performance.now(); }
    // Ease a ring to an angle; onDone runs when it is seated (at once if already there).
    function tweenRing(k, toAngle, dur, onDone) {
      const from = G.vis[k];
      G.dirty = true;
      if (Math.abs(from - toAngle) < 1e-4) { G.vis[k] = toAngle; G.tween[k] = null; if (onDone) onDone(); return; }
      G.tween[k] = { from, to: toAngle, t0: now(), dur: dur || clamp(110 + Math.abs(toAngle - from) / STEP * 55, 120, 320), ease: easeOutCubic, onDone };
    }
    function select(k) {
      if (k === G.selected) return;
      G.selected = k;
      G.selectAt = now();
      hud.showRotate(k > 0 && (G.phase === 'play' || G.phase === 'intro'));
      G.dirty = true;
    }

    // ---- Committed moves ----------------------------------------------------------------
    function commit(k, steps, viaDrag) {
      const before = statuses();
      const res = G.eng.rotate(k, steps);
      if (!res) return null;
      lastAction = now();
      if (G.hint && G.hint.ring === k) G.hint.until = Math.min(G.hint.until, now() + 400);
      tweenRing(k, res.to * STEP, 0, () => afterSeat(before, res.event));
      ctx.platform.interact({ action: viaDrag ? 'drag' : 'tap', ring: k, steps });
      onFirstMove();
      saveLocal();
      syncHud();
      return res;
    }
    function statuses() { const a = []; for (let i = 0; i < G.eng.revealed(); i++) a.push(G.eng.holds(i)); return a; }
    // After a ring seats: chime for clues that now hold, then any stage event.
    function afterSeat(before, event) {
      sound.snap();
      let gained = 0;
      before.forEach((was, i) => {
        if (!was && G.eng.holds(i)) { gained++; G.clue[i].glow = 1; sound.align(i); }
      });
      if (gained) haptic('light');
      sound.setProgress((G.eng.stage + G.eng.satisfiedCount() / G.eng.revealed()) / stages());
      saveProgress(false);
      // Keep the caption on something worth solving.
      if (G.focus >= 0 && G.eng.holds(G.focus) && now() > G.focusDimUntil) {
        const next = G.eng.hintTarget(-1);
        if (next >= 0) G.focus = next;
      }
      if (event === 'stage') startReveal();
      else if (event === 'solved' && G.phase === 'play') beginSolved();
      syncHud();
    }
    function onFirstMove() {
      if (!scores.profile.seenIntro) scores.setFlag('seenIntro', true);
    }
    let lastHaptic = 0;
    function haptic(kind) {
      if (!caps.haptics) return;
      const t = now();
      if (kind === 'light' && t - lastHaptic < 55) return;
      lastHaptic = t;
      try { ctx.platform.haptic(kind); } catch (e) { }
    }
    // The first real gesture of an attempt starts it (and the clock).
    function beginAttempt() {
      sound.unlock();
      if (G.started || (G.phase !== 'play' && G.phase !== 'intro') || G.mode === 'gallery') return;
      G.started = true;
      G.attempt = scores.newAttempt();
      try { ctx.platform.start({ mode: G.mode, edition: G.mode === 'daily' ? G.day : G.level }); } catch (e) { }
      clockStart();
    }

    // ---- Progressive reveal ---------------------------------------------------------------
    // 1. the intersections that hold light up, 2. a breath, 3. the new markers
    // grow in around the rim, one after another, 4. play carries on throughout.
    function startReveal() {
      const to = G.eng.revealed();
      const from = G.puzzle.cum[G.eng.stage - 1];
      const t = now();
      G.reveal = { t0: t, from, to, shown: false };
      for (let i = 0; i < from; i++) if (G.eng.holds(i)) G.clue[i].glow = 1;
      haptic('success');
      try { ctx.platform.milestone('stage_reached', { stage: G.eng.stage + 1, moves: G.eng.moves }); } catch (e) { }
      saveProgress(true);
      flashCaption('STAGE ' + G.eng.stage + ' COMPLETE', 'All ' + from + ' intersections hold at once…', 1000);
    }
    function revealStep(t) {
      const R = G.reveal;
      if (!R) return false;
      const u = t - R.t0;
      if (!R.shown && u >= 850) {
        R.shown = true;
        for (let i = R.from; i < R.to; i++) { G.clue[i].revealAt = t + (i - R.from) * 220; G.clue[i].isNew = true; }
        sound.stage(G.eng.stage);
        G.focus = R.from;
        const n = R.to - R.from;
        flashCaption('STAGE ' + (G.eng.stage + 1) + ' OF ' + stages(), (n === 2 ? 'Two' : String(n)) + ' new intersections. Everything revealed must hold together.', 3200);
      }
      if (R.shown) {
        for (let i = R.from; i < R.to; i++) {
          const a = clamp((t - G.clue[i].revealAt) / 650, 0, 1);
          G.clue[i].appear = a;
        }
      }
      if (u > 850 + (R.to - R.from) * 220 + 900) {
        for (let i = R.from; i < R.to; i++) { G.clue[i].appear = 1; G.clue[i].isNew = false; }
        G.reveal = null;
        // Lucky: the new clues may already hold. Then the next stage opens too.
        const ev = G.eng.advance();
        if (ev === 'stage') startReveal();
        else if (ev === 'solved') beginSolved();
        syncHud();
      }
      return true;
    }

    // ---- Pointer input: direct manipulation --------------------------------------------
    let drag = null;
    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      const sx = r.width ? ctx.width / r.width : 1, sy = r.height ? ctx.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }
    // Which ring is under a point: by radius only, with the gap split between
    // neighbours, so a touch can never land on two rings.
    function ringAt(px, py) {
      const geom = board.painter.geom;
      if (!geom) return { k: -2 };
      const dx = px - L.cx, dy = py - L.cy, r = Math.hypot(dx, dy);
      if (r < geom.hubR + geom.g * 0.5) return { k: -1, r };
      if (r > L.R * 1.08) return { k: -2, r };
      if (r >= geom.rings[geom.n - 1].rOut) return { k: geom.n - 1, r };
      for (let k = 0; k < geom.n; k++) {
        const ring = geom.rings[k];
        const hi = k < geom.n - 1 ? (ring.rOut + geom.rings[k + 1].rIn) / 2 : Infinity;
        if (r < hi) return { k, r };
      }
      return { k: geom.n - 1, r };
    }
    // A marker under the point, if any.
    function clueAt(px, py) {
      const geom = board.painter.geom;
      if (!geom || !G.eng) return -1;
      const cg = clueGeom(geom);
      let best = -1, bd = cg.mr * 1.9;
      for (let i = 0; i < G.eng.revealed(); i++) {
        const a = colAngle(G.puzzle.conds[i].pos);
        const d = Math.hypot(px - (L.cx + Math.cos(a) * cg.Rm), py - (L.cy + Math.sin(a) * cg.Rm));
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    function angleAt(px, py) { return Math.atan2(py - L.cy, px - L.cx); }
    function columnAt(px, py) { return mod(Math.round((angleAt(px, py) + Math.PI / 2) / STEP), SEGMENTS); }
    function highlightFamily(k, px, py) {
      const fam = G.eng.familyAt(k, columnAt(px, py));
      G.famFocus = { fam, a: G.famFocus && G.famFocus.fam === fam ? G.famFocus.a : 0, until: now() + 1800 };
      G.dirty = true;
    }

    ctx.listen(canvas, 'pointerdown', e => {
      if (hud.isModalOpen()) return;
      if (drag) return; // one ring at a time; extra fingers are ignored
      const p = localPoint(e);
      if (G.phase === 'done' || G.phase === 'transition' || G.phase === 'solving') { sound.unlock(); return; }
      if (e.cancelable) e.preventDefault();
      try { canvas.focus({ preventScroll: true }); } catch (err) { }
      const ci = Math.hypot(p.x - L.cx, p.y - L.cy) > L.R * 1.04 ? clueAt(p.x, p.y) : -1;
      if (ci >= 0) { if (G.phase === 'intro') finishIntro(); focusClue(ci, true); return; }
      const hit = ringAt(p.x, p.y);
      if (hit.k === -2) { select(-1); return; }
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      if (hit.k === -1) return;
      if (hit.k === 0) {
        // The centre ring is the fixed reference and the spectrum's legend.
        sound.refuse(); haptic('light');
        highlightFamily(0, p.x, p.y);
        flashCaption('CENTRE RING · FIXED', 'The spectrum, read clockwise. Steps and “next colour” are counted on it.', 3200);
        return;
      }
      const k = hit.k;
      // Grab from wherever the ring visually is, even mid-snap.
      if (G.tween[k]) { G.tween[k] = null; }
      drag = { k, id: e.pointerId, lastA: angleAt(p.x, p.y), base: G.vis[k], accum: 0, moved: false, detent: Math.round(G.vis[k] / STEP), t0: now(), px: p.x, py: p.y };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      select(k);
      G.dirty = true;
    }, { passive: false });

    ctx.listen(canvas, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.cancelable) e.preventDefault();
      const p = localPoint(e);
      const r = Math.hypot(p.x - L.cx, p.y - L.cy);
      const a = angleAt(p.x, p.y);
      // Near the axis the angle is unstable; hold the ring still there.
      if (r > board.painter.geom.hubR * 0.55) {
        drag.accum += wrapAngle(a - drag.lastA); // unwrapped: no jump across 0/360
        drag.lastA = a;
      }
      if (!drag.moved && Math.abs(drag.accum) > 0.035) drag.moved = true;
      G.vis[drag.k] = drag.base + drag.accum;
      const det = Math.round(G.vis[drag.k] / STEP);
      if (det !== drag.detent) { drag.detent = det; sound.tick(drag.k); haptic('light'); }
      G.dirty = true;
    }, { passive: false });

    function endDrag(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      const k = drag.k;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
      const current = G.eng.rot[k];
      if (cancelled || !drag.moved) {
        tweenRing(k, current * STEP);
        // A tap selects the ring (turn buttons) and outlines that colour everywhere.
        if (!cancelled && !drag.moved) { hud.showRotate(true); highlightFamily(k, drag.px, drag.py); }
      } else {
        const target = Math.round(G.vis[k] / STEP);
        const steps = target - current;
        if (steps) commit(k, steps, true);
        else tweenRing(k, current * STEP, 0, () => sound.snap());
      }
      drag = null;
      G.dirty = true;
    }
    ctx.listen(canvas, 'pointerup', e => endDrag(e, false));
    ctx.listen(canvas, 'pointercancel', e => endDrag(e, true));
    ctx.listen(canvas, 'lostpointercapture', e => { if (drag && e.pointerId === drag.id) endDrag(e, false); });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

    // Keyboard: arrows turn the selected ring, up/down choose a ring, Z undoes,
    // Tab-free clue cycling with C, H for a hint.
    ctx.listen(canvas, 'keydown', e => {
      if ((G.phase !== 'play' && G.phase !== 'intro') || hud.isModalOpen()) return;
      const n = G.puzzle.ringCount;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        beginAttempt();
        let k = G.selected < 1 ? (e.key === 'ArrowUp' ? 1 : n - 1) : G.selected + (e.key === 'ArrowUp' ? 1 : -1);
        k = clamp(k, 1, n - 1); select(k);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        beginAttempt();
        if (G.selected < 1) select(n - 1);
        tapRotate(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); doUndo(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); focusClue(mod(G.focus + 1, G.eng.revealed()), true); }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); doHint(); }
    });

    function tapRotate(dir) {
      if ((G.phase !== 'play' && G.phase !== 'intro') || G.selected < 1) return;
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      haptic('light');
      commit(G.selected, dir, false);
      hud.showRotate(true);
    }

    // ---- Controls ----------------------------------------------------------------------
    function doUndo() {
      if (G.phase !== 'play') return;
      const before = statuses();
      const h = G.eng.undo();
      if (!h) { sound.refuse(); return; }
      sound.undo(); haptic('light');
      tweenRing(h.ring, h.from * STEP, 0, () => afterSeat(before, h.event));
      ctx.platform.interact({ action: 'undo' });
      saveLocal();
      syncHud();
    }
    let resetSeq = 0;
    function doReset() {
      if (G.phase !== 'play') return;
      if (!hud.resetArmed()) {
        hud.armReset(true);
        const s = ++resetSeq;
        ctx.timeout(() => { if (s === resetSeq) hud.armReset(false); }, 2600);
        return;
      }
      resetSeq++;
      hud.armReset(false);
      G.eng.reset();
      for (let k = 1; k < G.puzzle.ringCount; k++) tweenRing(k, G.eng.rot[k] * STEP, 420);
      G.hint = null;
      sound.undo();
      ctx.platform.interact({ action: 'restart' });
      flashCaption('RESTARTED', 'The rings are back where they began. What you have revealed stays revealed.', 2600);
      saveLocal();
      syncHud();
    }
    // Hints escalate on the focused clue: which rings, then the relationship read
    // against the board, then a direction worth trying. Never a move for you.
    function doHint() {
      if (G.phase !== 'play') return;
      beginAttempt();
      const h = G.eng.hint(G.focus);
      if (!h) return;
      G.focus = h.cond;
      const c = G.puzzle.conds[h.cond];
      const label = 'HINT ' + h.level + ' · ' + HOURS[c.pos];
      if (h.level === 1) {
        G.focusDimUntil = now() + 4200;
        const names = c.rings.map(k => RING_NAMES[k]);
        flashCaption(label, 'This rule reads the ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.', 4200);
      } else if (h.level === 2) {
        G.focusDimUntil = now() + 2400;
        flashCaption(label, h.text, 5200);
      } else if (h.dir) {
        G.hint = { ring: h.dir.ring, dir: h.dir.dir, alpha: 0, until: now() + 4200, a: colAngle(c.pos) };
        select(h.dir.ring);
        flashCaption(label, 'Worth exploring: the ' + RING_NAMES[h.dir.ring] + ', ' + (h.dir.dir > 0 ? 'clockwise' : 'anticlockwise') + '.', 4200);
      } else {
        flashCaption(label, h.text || condText(c), 4200);
      }
      ctx.platform.interact({ action: 'hint', level: h.level });
      G.dirty = true;
      saveLocal();
      syncHud();
    }
    function toggleMute() {
      const m = !scores.profile.muted;
      scores.setFlag('muted', m);
      sound.setMuted(m);
      if (!m) sound.unlock();
      hud.setMuted(m);
    }

    // ---- Completion ----------------------------------------------------------------------
    // Stars: one for solving, one for an efficient route, one for no hints within
    // a relaxed time. Efficiency is judged against the progressive route, since
    // nobody can aim at clues they have not seen yet.
    function starsFor(moves, timeMs, hints) {
      const route = G.puzzle.route;
      const efficient = moves <= Math.ceil(route * 1.25) + 2;
      const clean = hints === 0 && timeMs <= Math.max(300000, route * 15000);
      return 1 + (efficient ? 1 : 0) + (clean ? 1 : 0);
    }
    function beginSolved() {
      G.phase = 'solving';
      clockPause();
      select(-1);
      hud.showRotate(false);
      G.hint = null; G.focus = -1; G.reveal = null;
      G.completeAt = now() + 120;
      G.completeT = 0;
      sound.complete(G.puzzle.ringCount);
      haptic('success');
      const timeMs = Math.round(elapsed());
      const moves = G.eng.moves, hints = G.eng.hints;
      const stars = starsFor(moves, timeMs, hints);
      let info;
      if (G.mode === 'daily') {
        const isToday = G.day === dayNumberFromKey(dateKey(new Date()));
        info = scores.completeDaily(G.day, moves, timeMs, hints, G.theme.key, stars);
        G.result = { timeMs, moves, par: G.puzzle.route, hints, stars, streak: scores.currentStreak(G.day), info, board: '' };
        // Only a live solve of today's edition goes on the leaderboard.
        if (isToday && info.first && !G.restoredSolved) {
          G.result.board = 'Saving to today’s board…';
          scores.submitDaily(timeMs, moves, G.day, info.streak, r => onBoardResult(r));
        }
        try { ctx.game.progress && ctx.game.progress.complete('daily', { state: snapshot() }).catch(() => { }); } catch (e) { }
        try { ctx.platform.complete({ mode: 'daily', edition: G.day, timeMs, moves, hints, stars }); } catch (e) { }
      } else {
        info = scores.completeLevel(G.level, moves, timeMs, G.theme.key, stars);
        G.result = { timeMs, moves, par: G.puzzle.route, hints, stars, info, board: '' };
        try { ctx.platform.complete({ mode: 'practice', level: G.level, timeMs, moves, hints, stars }); } catch (e) { }
      }
      saveLocal();
      syncHud();
      ctx.timeout(() => showResult(true), 2200);
    }
    function onBoardResult(r) {
      if (!G.result) return;
      if (r.error) G.result.board = r.error === 'unavailable' ? '' : 'Leaderboard unavailable right now';
      else if (r.board) {
        const rows = (r.board.rows || []).slice(0, 3).map(row => {
          const nm = row.displayName || row.username || row.name || 'player';
          return (row.rank || '') + '. ' + nm + ' ' + (row.displayLabel || fmtTime(row.value));
        });
        const me = r.board.viewerRank;
        G.result.board = (rows.length ? 'TODAY  ' + rows.join('  ·  ') : 'TODAY') + (me && me.rank ? '\nYOU ARE #' + me.rank + (r.board.totalRanked ? ' OF ' + r.board.totalRanked : '') : '');
      } else if (r.submitted) G.result.board = 'Saved to today’s board';
      if (G.phase === 'done') hud.setBoardLine(G.result.board);
    }
    function showResult(fresh) {
      if (disposed || !G.result) return;
      if (G.phase === 'solving') G.phase = 'done';
      if (G.phase !== 'done') return;
      const R = G.result, t = G.theme;
      const stats = [['Time', fmtTime(R.timeMs)], ['Moves', String(R.moves)], ['Par', String(R.par)]];
      if (G.mode === 'daily') stats.push(['Streak', String(scores.currentStreak(today))]);
      else stats.push(['Hints', String(R.hints)]);
      const isNew = R.info && R.info.newTheme;
      hud.showPlay(false);
      hud.setHeader(G.mode, editionLabel(), true);
      hud.showDone({
        kicker: (isNew ? 'New universe · ' : '') + 'All seven intersections hold',
        name: t.name,
        stars: R.stars || 0,
        desc: t.description,
        stats,
        board: R.board,
        nextLabel: G.mode === 'daily' ? 'Practice' : 'Next puzzle',
        canShare: true
      });
      if (fresh) {
        ctx.timeout(() => {
          if (disposed || G.phase !== 'done') return;
          try {
            ctx.pulse && ctx.pulse.complete({
              timeMs: R.timeMs, timeLabel: fmtTime(R.timeMs), score: R.moves,
              level: G.mode === 'daily' ? G.day : G.level, mode: G.mode,
              result: 'solved', text: shareText()
            });
          } catch (e) { }
        }, 1100);
        if (G.mode === 'daily') scores.readBest(v => { if (v !== null && G.phase === 'done' && G.result) { G.result.bestRecord = v; } });
      }
    }
    function shareText() {
      const R = G.result, t = G.theme;
      const head = (G.mode === 'daily' ? 'ORBIT  No. ' + pad3(G.day) : 'ORBIT  Practice ' + pad3(G.level)) + '  ' + '★'.repeat(R.stars || 1) + '☆'.repeat(3 - (R.stars || 1));
      const dots = G.puzzle.stages.map(n => '◉'.repeat(n)).join(' ');
      const lines = [head, '“' + t.name + '”', dots, fmtTime(R.timeMs) + '  ·  ' + R.moves + ' moves (par ' + R.par + ')' + (R.hints ? '  ·  ' + R.hints + (R.hints === 1 ? ' hint' : ' hints') : '')];
      if (G.mode === 'daily' && scores.currentStreak(today) > 1) lines.push('streak ' + scores.currentStreak(today));
      return lines.join('\n');
    }
    function doShare() {
      if (G.phase !== 'done' || !G.result) return;
      try {
        ctx.share({ sceneId: G.mode + '-' + (G.mode === 'daily' ? G.day : G.level), title: 'ORBIT — ' + G.theme.name, text: shareText(), implicitText: 'Solved ORBIT in ' + fmtTime(G.result.timeMs) });
      } catch (e) { hud.toast('Sharing is not available here'); }
    }
    function doNext() {
      if (G.phase !== 'done') return;
      if (G.mode === 'gallery') {
        const back = G.prev || { mode: 'daily', n: today };
        G.prev = null; G.galleryItem = null;
        goTo(back.mode, back.n);
        return;
      }
      const lvl = scores.profile.levels.reached;
      goTo('study', G.mode === 'study' ? G.level + 1 : lvl);
    }

    // ---- Mode switching and theme reveal --------------------------------------------------
    function switchMode(m) {
      if (G.phase === 'transition' || hud.isModalOpen()) return;
      if (m === G.mode) return;
      sound.unlock();
      if (m === 'daily') goTo('daily', today);
      else goTo('study', scores.profile.levels.reached);
    }
    // Leave the current scene and open the next one from the axis outward.
    function goTo(mode, n) {
      if (G.phase === 'play' && G.started) { saveLocal(); saveProgress(true); }
      clockPause();
      const from = { theme: G.theme, scene: buildScene(), mode: G.mode };
      hud.showDone(null);
      hud.showRotate(false);
      const saved = mode === 'daily' ? readLocal(DAY_KEY, n) : readLocal(STUDY_KEY, n);
      loadPuzzle(mode, n, saved);
      const done = mode === 'daily' ? scores.dailyResult(n) : null;
      G.restoredSolved = G.eng.solved;
      const target = G.vis.slice();
      // The rings spin in to their scramble (never through the solution).
      if (!done && !G.eng.solved) for (let k = 1; k < G.vis.length; k++) G.vis[k] = target[k] + (k % 2 ? -1 : 1) * Math.PI * 0.75;
      G.transition = { from, t0: now(), dur: 950, then: () => {
        if (done || G.eng.solved) { enterSolvedView(done); return; }
        for (let k = 1; k < G.vis.length; k++) G.tween[k] = { from: G.vis[k], to: target[k], t0: now() + k * 70, dur: 760, ease: easeOutQuint };
        G.phase = 'intro';
        G.introEnd = now() + 760 + G.vis.length * 70;
      } };
      G.phase = 'transition';
      hud.showPlay(true);
      sound.reveal();
      syncHud();
    }
    function finishIntro() {
      for (let k = 1; k < G.vis.length; k++) { if (G.tween[k] && G.tween[k].ease === easeOutQuint) { G.vis[k] = G.tween[k].to; G.tween[k] = null; } }
      G.phase = 'play';
      syncHud();
    }
    // Re-opening an edition already solved shows the finished composition.
    function enterSolvedView(done) {
      if (!G.eng.solved) G.eng.forceSolved();
      for (let k = 0; k < G.vis.length; k++) { G.vis[k] = G.eng.rot[k] * STEP; G.tween[k] = null; }
      G.clue.forEach(c => { c.appear = 1; c.glow = 0; c.isNew = false; });
      hud.showRotate(false);
      select(-1);
      clockPause();
      G.phase = 'done';
      G.focus = -1;
      G.completeT = 1; G.completeGlow = 1; G.orbitA = TAU;
      const d = done || [G.eng.moves, elapsed(), G.eng.hints, 0];
      G.result = { timeMs: d[1], moves: d[0], par: G.puzzle.route, hints: d[2] || 0, stars: d[3] || 0, info: { newTheme: false }, board: '' };
      showResult(false);
    }

    // ---- Collection and gallery ---------------------------------------------------------------
    // Each collected universe keeps the composition its puzzle resolved into.
    function solvedFamilies(puz) {
      const o = stateOffsets(puz.solutions[0]);
      return (k, i) => puz.seqs[k][mod(i - (k ? o[k] : 0), SEGMENTS)];
    }
    function collectionItems() {
      const items = [];
      scores.profile.coll.slice().reverse().forEach(key => {
        const m = /^(daily|level):(\d+)$/.exec(key);
        if (!m) return;
        const n = +m[2];
        const daily = m[1] === 'daily';
        let cached = null, fams = null;
        const d = daily ? scores.profile.daily[n] : scores.profile.levels.best[n];
        items.push({
          key, n, daily,
          title: '', sub: daily ? 'No. ' + pad3(n) + ' · ' + prettyDate(keyFromDayNumber(n)) : 'Practice ' + pad3(n),
          ringCount: RINGS,
          stat: d ? 'Solved in ' + fmtTime(d[1]) + ', ' + d[0] + ' moves.' : '',
          d,
          theme() { return cached || (cached = ThemeEngine.forKey(key)); },
          families() { return fams || (fams = solvedFamilies(puzzleFor(daily ? 'daily' : 'study', n))); }
        });
      });
      items.forEach(it => { it.title = it.theme().name; });
      return items;
    }
    function openCollection() {
      if (G.phase === 'transition') return;
      sound.unlock();
      ctx.surface.place(hud.modal, { layer: 'modal', input: 'auto' });
      const items = collectionItems();
      const nextLevel = scores.profile.levels.reached;
      hud.openCollection(items, { title: 'Undiscovered', sub: 'Practice ' + pad3(nextLevel) });
      if (G.phase === 'play' && G.started) clockPause();
    }
    function closeModal() {
      hud.closeModal();
      ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });
      if (G.phase === 'play' && G.started) clockStart();
    }
    function openGallery(it) {
      closeModal();
      if (G.phase === 'play' && G.started) { saveLocal(); saveProgress(true); clockPause(); }
      const from = { theme: G.theme, scene: buildScene(), mode: G.mode };
      G.prev = G.prev || { mode: G.mode, n: G.mode === 'daily' ? G.day : G.level };
      G.galleryItem = it;
      const theme = it.theme();
      G.puzzle = puzzleFor(it.daily ? 'daily' : 'study', it.n);
      G.eng = createGame(G.puzzle);
      G.eng.forceSolved();
      G.theme = theme;
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP); G.tween = new Array(nr).fill(null);
      G.clue = G.puzzle.conds.map(() => ({ appear: 1, glow: 0, revealAt: 0, status: '', isNew: false }));
      G.mode = 'gallery'; G.focus = -1; G.hint = null; G.famFocus = null;
      G.completeT = 0; G.completeGlow = 1; G.orbitA = TAU;
      hud.applyTheme(theme);
      hud.showDone(null); hud.showPlay(false);
      G.transition = { from, t0: now(), dur: 950, then: () => {
        G.phase = 'done';
        G.completeAt = now(); G.completeT = 0.0001;
        G.result = { timeMs: 0, moves: 0, par: 0, info: {}, board: '' };
        hud.setHeader('gallery', editionLabel(), false);
        hud.showDone({ kicker: 'From your collection', name: theme.name, desc: theme.description, stars: it.d && it.d[3] || 0, stats: it.d ? [['Time', fmtTime(it.d[1])], ['Moves', String(it.d[0])]] : [], board: theme.universeTitle.toUpperCase() + ' · ' + theme.material.label.toUpperCase(), nextLabel: 'Back', canShare: false });
      } };
      G.phase = 'transition';
      sound.reveal();
    }

    // ---- Scene + loop ------------------------------------------------------------------------
    function buildScene() {
      const seqs = G.puzzle.seqs;
      const E = G.eng;
      const doneView = G.phase === 'done' || G.phase === 'solving' || G.mode === 'gallery';
      return {
        ringCount: G.puzzle.ringCount,
        angles: G.vis.slice(),
        families: (k, i) => seqs[k][i],
        selected: G.selected, selectT: G.selectT, dimOthers: G.selectT * (G.phase === 'play' ? 1 : 0),
        completeT: G.completeT, completeGlow: G.completeGlow,
        orbitA: G.orbitA,
        famFocus: G.famFocus && G.famFocus.a > 0.01 ? G.famFocus : null,
        focus: G.focus, focusT: G.focusT,
        clues: G.puzzle.conds.map((c, i) => {
          if (i >= E.revealed() && !doneView) return null;
          const v = G.clue[i] || { appear: 1 };
          const status = doneView ? 'solved' : E.status(i);
          return { pos: c.pos, type: c.type, rings: c.rings, odd: c.odd, fam: c.fam, appear: v.appear, glow: v.glow, revealAt: v.revealAt, status, progress: status === 'solved' ? 1 : E.progress(i) };
        }),
        hint: G.hint && G.hint.alpha > 0.01 ? { ring: G.hint.ring, dir: G.hint.dir, alpha: G.hint.alpha, a: G.hint.a } : null
      };
    }

    let hudTick = 0;
    function update(dt) {
      if (disposed) return;
      const t = now();
      let animating = false;

      // Ring tweens (snap and intro). Ease-out only: no overshoot, no bounce.
      for (let k = 0; k < G.tween.length; k++) {
        const tw = G.tween[k];
        if (!tw) continue;
        animating = true;
        const u = clamp((t - tw.t0) / tw.dur, 0, 1);
        G.vis[k] = lerp(tw.from, tw.to, tw.ease(u));
        if (u >= 1) { G.vis[k] = tw.to; G.tween[k] = null; if (tw.onDone) tw.onDone(); }
      }
      if (G.phase === 'intro' && t >= G.introEnd && !G.tween.some(Boolean)) { G.phase = 'play'; syncHud(); }

      // Selection fade and auto-deselect after a quiet spell.
      const selTarget = G.selected > 0 && (G.phase === 'play') ? 1 : 0;
      if (Math.abs(G.selectT - selTarget) > 0.001) { G.selectT = lerp(G.selectT, selTarget, 1 - Math.exp(-dt / 70)); animating = true; }
      if (G.selected > 0 && !drag && G.phase === 'play' && t - Math.max(G.selectAt, lastAction) > 6000) { select(-1); }

      // Column focus: the board recedes briefly around the chosen intersection.
      const fTarget = G.focus >= 0 && t < G.focusDimUntil && G.phase === 'play' ? 1 : 0;
      if (Math.abs(G.focusT - fTarget) > 0.002) { G.focusT = lerp(G.focusT, fTarget, 1 - Math.exp(-dt / 140)); animating = true; }

      // Family highlight.
      if (G.famFocus) {
        const target = t < G.famFocus.until ? 1 : 0;
        G.famFocus.a = lerp(G.famFocus.a, target, 1 - Math.exp(-dt / 110));
        if (!target && G.famFocus.a < 0.01) G.famFocus = null;
        animating = true;
      }

      // Clue glows decay; new clues breathe.
      for (let i = 0; i < G.clue.length; i++) {
        const c = G.clue[i];
        if (c.glow > 0) { c.glow = Math.max(0, c.glow - dt / 1100); animating = true; }
      }
      if (G.eng && G.phase === 'play') for (let i = 0; i < G.eng.revealed(); i++) if (G.eng.status(i) === 'revealed') { animating = true; break; }
      if (revealStep(t)) animating = true;

      const ot = (G.phase === 'done' || G.phase === 'solving') ? TAU : orbitTarget();
      if (Math.abs(G.orbitA - ot) > 0.0005) { G.orbitA = lerp(G.orbitA, ot, 1 - Math.exp(-dt / 260)); animating = true; }

      // Completion light; the markers kindle one after another round the rim.
      if ((G.phase === 'solving' || G.phase === 'done') && G.completeT > 0 && G.completeT < 1 || G.phase === 'solving') {
        G.completeT = clamp((t - G.completeAt) / 2400, 0, 1);
        G.completeGlow = Math.min(1, G.completeGlow + dt / 900);
        if (G.phase === 'solving') {
          const order = G.puzzle.conds.map((c, i) => i).sort((a, b) => G.puzzle.conds[a].pos - G.puzzle.conds[b].pos);
          order.forEach((i, j) => { const u = G.completeT * 1.4 - j * 0.12; if (u > 0 && u < 0.08) G.clue[i].glow = 1; });
        }
        animating = true;
      }

      // Hint chevrons.
      if (G.hint) {
        const target = t < G.hint.until ? 1 : 0;
        G.hint.alpha = lerp(G.hint.alpha, target, 1 - Math.exp(-dt / 140));
        if (!target && G.hint.alpha < 0.01) G.hint = null;
        animating = true;
      }

      // Theme transition.
      if (G.transition) {
        animating = true;
        const u = clamp((t - G.transition.t0) / G.transition.dur, 0, 1);
        if (u >= 1) { const th = G.transition.then; G.transition = null; if (th) th(); syncHud(); }
      }

      // HUD clock, a few times a second.
      hudTick += dt;
      if (hudTick > 250) {
        hudTick = 0;
        if (G.phase === 'play') hud.setTime(elapsed());
        if (progressDirty && G.phase === 'play') saveProgress(false);
      }

      if (animating || G.dirty || drag) render(t);
    }
    let lastAction = 0;
    function render(t) {
      G.dirty = false;
      if (G.transition) {
        const u = clamp((t - G.transition.t0) / G.transition.dur, 0, 1);
        board.drawTransition(G.transition.from.theme, G.transition.from.scene, G.theme, buildScene(), u, t);
      } else {
        board.drawScene(G.theme, buildScene(), t);
      }
    }

    // ---- Lifecycle wiring -------------------------------------------------------------------------
    ctx.listen(canvas, 'pointerdown', () => { lastAction = now(); }, { passive: true });
    ctx.listen(hud.root, 'pointerdown', () => { lastAction = now(); }, { passive: true });

    // Start: restore today's daily from this device first (instant), then Continue Playing.
    const savedDay = readLocal(DAY_KEY, today);
    loadPuzzle('daily', today, savedDay);
    G.restoredSolved = G.eng.solved;
    relayout();
    ctx.onResize(() => { relayout(); }, { immediate: false });
    render(now());
    if (scores.dailyResult(today) || G.eng.solved) enterSolvedView(scores.dailyResult(today));
    try { ctx.markVisualReady && ctx.markVisualReady('board'); } catch (e) { }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__ORBIT_DEV) {
      // Dev harness only: `step()` makes the next nearest-first move through the real
      // commit path (used by layout screenshots; e2e tests drive real pointer input).
      const step = () => {
        const E = G.eng, D = G.puzzle.dist[E.stage], here = D[E.state()];
        for (let k = 1; k <= 4; k++) for (const d of [1, -1]) { const o = E.rot.slice(); o[k] += d; if (D[stateIndex(o)] < here) { commit(k, d, false); return true; } }
        return false;
      };
      window.__orbit = { G, layout: () => L, board, scores, goTo, ThemeEngine, renderThumbnail, ThemeRegistry, stateIndex, stateOffsets, NSTATES, step, scene: buildScene };
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => update(dtMs) });
    else ctx.onFrame(dt => update(dt));

    // Cloud profile hydrate (collection, streak) and resumable progress.
    scores.hydrate().then(() => {
      if (disposed) return;
      if (G.mode === 'daily' && G.phase === 'play' && !G.interacted && scores.dailyResult(today)) enterSolvedView(scores.dailyResult(today));
      syncHud();
    });
    if (ctx.game && ctx.game.progress && !savedDay) {
      try {
        ctx.game.progress.load('daily').then(p => {
          if (disposed || G.interacted || G.mode !== 'daily' || G.phase !== 'play') return;
          const s = p && p.state;
          const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 2));
          if (!eligible || !s || s.v !== 2 || s.edition !== today) return;
          loadPuzzle('daily', today, s);
          G.dirty = true;
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_load', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
  }
};

})();
