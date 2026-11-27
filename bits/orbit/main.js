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
// PuzzleGenerator and the core game engine. No rendering, no theme, no SDK.
// The engine is the single source of truth for ring positions.

const SEGMENTS = 12;
const STEP = TAU / SEGMENTS; // 30 degrees

// Difficulty presets. `rings` counts the fixed reference ring at the centre.
const DIFFICULTY = {
  easy:   { id: 'easy',   label: 'Easy',   rings: 4, minDist: 1, maxDist: 3, minTotal: 5,  minBig: 2 },
  medium: { id: 'medium', label: 'Medium', rings: 5, minDist: 2, maxDist: 6, minTotal: 13, minBig: 4 },
  hard:   { id: 'hard',   label: 'Hard',   rings: 6, minDist: 3, maxDist: 6, minTotal: 21, minBig: 5 }
};

// Shortest signed rotation (in segments) that brings offset `o` back to zero.
function shortestSteps(o) {
  const m = mod(o, SEGMENTS);
  return m > SEGMENTS / 2 ? m - SEGMENTS : m; // in (-6, 6]
}

const PuzzleGenerator = {
  // The solved arrangement: every ring carries the same sequence of twelve hue
  // families in the same angular order, so families line up in radial columns.
  solvedSequences(ringCount) {
    const seqs = [];
    for (let r = 0; r < ringCount; r++) {
      const s = [];
      for (let i = 0; i < SEGMENTS; i++) s.push(i);
      seqs.push(s);
    }
    return seqs;
  },

  // Does this offset vector satisfy the difficulty contract?
  check(offsets, diff) {
    const dists = offsets.map(o => Math.abs(shortestSteps(o)));
    if (dists.some(d => d === 0)) return 'ring already aligned';
    if (dists.some(d => d < diff.minDist || d > diff.maxDist)) return 'distance out of range';
    const total = dists.reduce((a, b) => a + b, 0);
    if (total < diff.minTotal) return 'too few moves';
    if (Math.max.apply(null, dists) < diff.minBig) return 'no long rotation';
    for (let i = 1; i < offsets.length; i++) {
      // Neighbouring rings with identical offsets read as one block: not interesting.
      if (mod(offsets[i], SEGMENTS) === mod(offsets[i - 1], SEGMENTS)) return 'neighbours move together';
    }
    if (diff.rings - 1 >= 3) {
      const dirs = offsets.map(o => Math.sign(shortestSteps(o)));
      if (dirs.every(d => d === dirs[0])) return 'all one direction';
    }
    return null;
  },

  // Deterministic: same key -> same puzzle on every device, every reload.
  generate(seedKey, diffId) {
    const diff = DIFFICULTY[diffId] || DIFFICULTY.medium;
    const rng = makeRng('orbit-puzzle:' + seedKey);
    const movable = diff.rings - 1;
    let offsets = null, attempts = 0;
    while (attempts < 500) {
      attempts++;
      const cand = [];
      for (let i = 0; i < movable; i++) {
        const d = rng.int(diff.minDist, diff.maxDist);
        cand.push(mod(rng.chance(0.5) ? d : -d, SEGMENTS));
      }
      if (!this.check(cand, diff)) { offsets = cand; break; }
    }
    if (!offsets) {
      // Unreachable in practice (see dev/test_puzzle.js); a safe valid fallback.
      offsets = [];
      for (let i = 0; i < movable; i++) offsets.push(mod((i % 2 ? -1 : 1) * Math.min(diff.maxDist, diff.minDist + 1 + (i % 3)), SEGMENTS));
    }
    return {
      seedKey,
      difficulty: diff.id,
      ringCount: diff.rings,
      sequences: this.solvedSequences(diff.rings),
      // Index 0 is the reference ring and never moves.
      scramble: [0].concat(offsets),
      attempts
    };
  }
};

// The engine: integer ring positions, move history, alignment maths.
function createEngine(puzzle, saved) {
  const n = puzzle.ringCount;
  const eng = {
    puzzle,
    rot: puzzle.scramble.slice(),  // integer segments; unbounded (multiple revolutions are fine)
    moves: 0,
    history: [],                    // { ring, from, to }
    hints: 0,
    solved: false
  };

  // Which hue family is visible in angular slot `slot` of ring `r`.
  // Rotating clockwise by one step moves every segment forward one slot.
  eng.familyAt = function (r, slot) {
    return puzzle.sequences[r][mod(slot - eng.rot[r], SEGMENTS)];
  };

  // A ring is aligned when all twelve slots show the reference ring's family.
  eng.isAligned = function (r, rotOverride) {
    if (r === 0) return true;
    const saved = eng.rot[r];
    if (rotOverride !== undefined) eng.rot[r] = rotOverride;
    let ok = true;
    for (let s = 0; s < SEGMENTS; s++) {
      if (eng.familyAt(r, s) !== eng.familyAt(0, s)) { ok = false; break; }
    }
    eng.rot[r] = saved;
    return ok;
  };
  eng.alignedCount = function () {
    let c = 0;
    for (let r = 1; r < n; r++) if (eng.isAligned(r)) c++;
    return c;
  };
  eng.checkSolved = function () {
    for (let r = 1; r < n; r++) if (!eng.isAligned(r)) return false;
    return true;
  };
  // Smallest signed number of steps that aligns ring r, found by search over
  // the twelve rotations rather than read from the scramble.
  eng.stepsToAlign = function (r) {
    let best = null;
    for (let d = -5; d <= 6; d++) {
      if (eng.isAligned(r, eng.rot[r] + d)) {
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
      }
    }
    return best;
  };
  // Fewest moves that solve the board from the starting scramble ("par").
  eng.par = (function () {
    let p = 0;
    for (let r = 1; r < n; r++) p += Math.abs(shortestSteps(puzzle.scramble[r]));
    return p;
  })();

  // Rotate ring r by `steps` (positive = clockwise). Counts |steps| moves.
  eng.rotate = function (r, steps) {
    steps = Math.round(steps);
    if (r <= 0 || r >= n || !steps || eng.solved) return null;
    const from = eng.rot[r];
    eng.rot[r] = from + steps;
    eng.moves += Math.abs(steps);
    eng.history.push({ ring: r, from, to: eng.rot[r] });
    eng.solved = eng.checkSolved();
    return { ring: r, from, to: eng.rot[r], aligned: eng.isAligned(r), solved: eng.solved };
  };
  // Undo restores the previous position and removes that action's moves.
  eng.undo = function () {
    if (eng.solved || !eng.history.length) return null;
    const h = eng.history.pop();
    eng.rot[h.ring] = h.from;
    eng.moves -= Math.abs(h.to - h.from);
    return h;
  };
  eng.reset = function () {
    eng.rot = puzzle.scramble.slice();
    eng.moves = 0;
    eng.history = [];
    eng.solved = false;
  };
  eng.hint = function () {
    // Prefer the ring closest to alignment so a hint is a nudge, not the answer.
    let best = -1, bestSteps = 0;
    for (let r = 1; r < n; r++) {
      if (eng.isAligned(r)) continue;
      const s = eng.stepsToAlign(r);
      if (best < 0 || Math.abs(s) < Math.abs(bestSteps)) { best = r; bestSteps = s; }
    }
    if (best < 0) return null;
    eng.hints++;
    return { ring: best, dir: Math.sign(bestSteps), steps: bestSteps };
  };
  eng.serialize = function () {
    return { v: 1, rot: eng.rot.slice(), moves: eng.moves, history: eng.history.slice(-60), hints: eng.hints };
  };

  if (saved && saved.v === 1 && Array.isArray(saved.rot) && saved.rot.length === n &&
      saved.rot.every(x => Number.isInteger(x)) && saved.rot[0] === 0) {
    eng.rot = saved.rot.slice();
    eng.moves = Math.max(0, saved.moves | 0);
    eng.history = Array.isArray(saved.history) ? saved.history.filter(h => h && h.ring > 0 && h.ring < n && Number.isInteger(h.from) && Number.isInteger(h.to)) : [];
    eng.hints = Math.max(0, saved.hints | 0);
    eng.solved = eng.checkSolved();
  }
  return eng;
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
  // Full hue circle; lightness follows a gentle wave so warm hues sit brighter.
  wheel(i, p) {
    const t = i / SEGMENTS;
    const h = p.h0 + 360 * t * p.dir;
    return [p.L0 + p.Lamp * Math.cos(TAU * (t - p.Lph)), p.C0 + p.Camp * Math.cos(TAU * (t - p.Cph)), h];
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
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.79, 0.81), Lamp: 0.05, Lph: 0.2, C0: r.range(0.1, 0.108), Camp: 0.015, Cph: r.range(0, 1) }),
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
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.77, 0.79), Lamp: 0.05, Lph: 0.2, C0: r.range(0.105, 0.115), Camp: 0.015, Cph: 0.3 }),
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
  params: r => ({ h0: r.range(0, 360), dir: -1, L0: r.range(0.76, 0.78), Lamp: 0.05, Lph: 0.2, C0: r.range(0.11, 0.12), Camp: 0.015, Cph: 0.4 }),
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
  params: r => ({ h0: r.range(0, 360), Lhi: r.range(0.86, 0.9), Llo: r.range(0.42, 0.46), Chi: r.range(0.05, 0.07), Clo: r.range(0.12, 0.14) }),
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

// Ring variants: same families, slightly different light and chroma, inner to outer.
function ringVariant(c, t, depth) {
  return colour(c.L + (t - 0.5) * depth.L, c.C * (1 + (t - 0.5) * depth.C), c.h + (t - 0.5) * depth.h);
}

const QC = {
  minAdjacent: 0.042,   // OKLab distance between neighbouring segments in a ring
  minPair: 0.03,      // any two families in a ring
  minBoardContrast: 0.17,
  minInkContrast: 4.5
};

function qcTheme(t) {
  const issues = [];
  for (let n = 4; n <= 6; n++) {
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
function universeFor(edition, stride) {
  const n = _universeOrder.length;
  // The stride must be coprime with the universe count so the walk visits every
  // universe before repeating, and consecutive editions always differ.
  while (gcd(stride, n) !== 1) stride++;
  return ThemeRegistry.universes[_universeOrder[mod(edition * stride, n)]];
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

  const depthL = r.range(0.045, 0.075) * (r.chance(0.5) ? 1 : -1);
  const depth = { L: depthL, C: r.range(-0.12, 0.18), h: r.range(-6, 6) };
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

    // 7. Selection depth: other rings recede.
    if (scene.selected > 0 && scene.dimOthers > 0) {
      x.fillStyle = rgba(theme.bg.base, 0.36 * scene.dimOthers);
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

    // 11. Alignment marks and selection rim, in the interface ink.
    const ink = theme.ink;
    for (let k = 1; k < n; k++) {
      const ring = geom.rings[k];
      const al = scene.alignedVis ? scene.alignedVis[k] : 0;
      if (al > 0.01) {
        x.strokeStyle = rgba(ink, 0.32 * al);
        x.lineWidth = 0.9;
        x.beginPath(); x.arc(0, 0, ring.rOut + geom.g * 0.5, 0, TAU); x.stroke();
      }
      const f = scene.flash ? scene.flash[k] : 0;
      if (f > 0 && f < 1) {
        // A restrained comet of light runs once around the newly aligned ring.
        const head = -Math.PI / 2 + easeOutCubic(f) * TAU;
        const len = 1.4;
        const steps = 18;
        for (let s = 0; s < steps; s++) {
          const a0 = head - len * (s / steps), a1 = head - len * ((s + 1) / steps);
          x.strokeStyle = rgba(ink, (1 - s / steps) * 0.75 * (1 - f * 0.6));
          x.lineWidth = 1.6;
          x.beginPath(); x.arc(0, 0, ring.rOut + geom.g * 0.5, a1, a0); x.stroke();
        }
      }
    }
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
// planet travels as rings align.
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
    const a = -Math.PI / 2 + hint.dir * (-0.3 + u * 0.6);
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
function renderThumbnail(theme, ringCount, sizeCss, pr) {
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
  painter.paint(lx, theme, { ringCount, angles, families: (k, i) => i, selected: -1, completeT: 0, alignedVis: null }, pr);
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

const PROFILE_KEY = 'orbit.profile.v1';

function emptyProfile() {
  return { v: 1, rev: 0, muted: false, seenIntro: false, streak: { count: 0, best: 0, last: 0 }, daily: {}, levels: { reached: 1, best: {} }, coll: [] };
}

function validProfile(p) {
  return p && p.v === 1 && typeof p.rev === 'number' && p.streak && typeof p.streak.count === 'number' &&
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
  M.completeDaily = function (day, moves, timeMs, hints, themeKey) {
    const p = M.profile;
    const prevBest = M.bestDailyTime();
    const first = !p.daily[day];
    if (first) {
      const s = p.streak;
      if (s.last === day - 1) s.count += 1; else if (s.last !== day) s.count = 1;
      s.last = day;
      s.best = Math.max(s.best, s.count);
      p.daily[day] = [moves, timeMs, hints];
    }
    const newTheme = M.addTheme(themeKey);
    M.save(true);
    return { first, streak: p.streak.count, bestStreak: p.streak.best, prevBest, isBest: first && (prevBest === null || timeMs < prevBest), newTheme };
  };
  M.completeLevel = function (level, moves, timeMs, themeKey) {
    const p = M.profile;
    const prev = p.levels.best[level];
    if (!prev || timeMs < prev[1]) p.levels.best[level] = [moves, timeMs];
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
.orb .stats{display:flex;justify-content:center;gap:0;margin-top:16px}
.orb .stat{width:96px;text-align:center}
.orb .stat+.stat{border-left:1px solid var(--rule)}
.orb .stat b{display:block;font-family:'Space Mono',ui-monospace,monospace;font-weight:400;font-size:17px;letter-spacing:.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.orb .stat i{display:block;font-style:normal;font-size:8.5px;letter-spacing:.26em;color:var(--faint);margin-top:5px;text-transform:uppercase;padding-left:.26em}
.orb .ctrls{display:flex;justify-content:center;gap:34px;margin-top:18px}
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
  const tDaily = el('button', 'tab on', 'Daily'); const tStudy = el('button', 'tab', 'Studies');
  tDaily.type = tStudy.type = 'button';
  tabs.appendChild(tDaily); tabs.appendChild(tStudy);
  hdr.appendChild(brand); hdr.appendChild(title); hdr.appendChild(label); hdr.appendChild(tabs);
  root.appendChild(hdr);

  const bColl = el('button', 'corner', ICONS.coll); bColl.setAttribute('aria-label', 'Collection');
  const bMute = el('button', 'corner', ICONS.sound); bMute.setAttribute('aria-label', 'Sound');
  root.appendChild(bColl); root.appendChild(bMute);

  // Play-state bottom block: caption, stats, GameControls
  const play = el('div', 'bottom play');
  const cap = el('div', 'cap small', '');
  const stats = el('div', 'stats');
  const sMoves = el('div', 'stat', '<b>0</b><i>Moves</i>');
  const sTime = el('div', 'stat', '<b>0:00</b><i>Time</i>');
  const sAl = el('div', 'stat', '<b>0/4</b><i>Aligned</i>');
  stats.appendChild(sMoves); stats.appendChild(sTime); stats.appendChild(sAl);
  const ctrls = el('div', 'ctrls');
  const bUndo = el('button', 'ctl', ICONS.undo + '<span>Undo</span>');
  const bReset = el('button', 'ctl', ICONS.reset + '<span>Restart</span>');
  const bHint = el('button', 'ctl', ICONS.hint + '<span>Hint</span>');
  [bUndo, bReset, bHint].forEach(b => { b.type = 'button'; ctrls.appendChild(b); });
  play.appendChild(cap); play.appendChild(stats); play.appendChild(ctrls);
  root.appendChild(play);

  // Tap rotation controls (appear only while a ring is selected)
  const rotL = el('button', 'rot', ICONS.ccw); rotL.setAttribute('aria-label', 'Rotate anticlockwise');
  const rotR = el('button', 'rot', ICONS.cw); rotR.setAttribute('aria-label', 'Rotate clockwise');
  rotL.type = rotR.type = 'button';
  root.appendChild(rotL); root.appendChild(rotR);

  // CompletionScreen
  const done = el('div', 'done');
  const dKick = el('div', 'kick', 'Discovered');
  const dName = el('div', 'tname', '');
  const dDesc = el('div', 'tdesc', '');
  const dStats = el('div', 'stats dstats');
  const dB = el('div', 'board3', '');
  const acts = el('div', 'acts');
  const aShare = el('button', 'act', ICONS.share + '<span>Share</span>');
  const aColl = el('button', 'act', ICONS.coll + '<span>Collection</span>');
  const aNext = el('button', 'act pri', '<span>Next study</span>' + ICONS.next);
  [aShare, aColl, aNext].forEach(b => { b.type = 'button'; acts.appendChild(b); });
  done.appendChild(dKick); done.appendChild(dName); done.appendChild(dDesc); done.appendChild(dStats); done.appendChild(dB); done.appendChild(acts);
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
    const off = L.R * 0.98;
    rotL.style.left = (L.cx - off) + 'px'; rotL.style.top = (L.cy + off) + 'px';
    rotR.style.left = (L.cx + off) + 'px'; rotR.style.top = (L.cy + off) + 'px';
    toast.style.top = (L.cy - L.R * 1.22 - 14) + 'px';
    toast.style.left = (L.cx) + 'px';
    const compact = L.compact;
    root.classList.toggle('compact', !!compact);
    title.style.fontSize = compact ? '24px' : '30px';
    tabs.style.marginTop = compact ? '8px' : '12px';
    stats.style.marginTop = compact ? '10px' : '16px';
    ctrls.style.marginTop = compact ? '8px' : '18px';
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
  U.setStats = function (moves, timeMs, aligned, total) {
    sMoves.firstChild.textContent = String(moves);
    sTime.firstChild.textContent = fmtTime(timeMs);
    sAl.firstChild.textContent = aligned + '/' + total;
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
  let resetArmed = 0;
  U.armReset = function (on) {
    resetArmed = on;
    bReset.classList.toggle('warn', !!on);
    bReset.querySelector('span').textContent = on ? 'Confirm' : 'Restart';
  };
  U.resetArmed = () => resetArmed;
  U.setMuted = function (m) { bMute.innerHTML = m ? ICONS.mute : ICONS.sound; bMute.setAttribute('aria-label', m ? 'Sound off' : 'Sound on'); };
  U.showRotate = function (on) { rotL.classList.toggle('on', !!on); rotR.classList.toggle('on', !!on); };
  U.showPlay = function (on) { play.style.opacity = on ? '1' : '0'; play.style.pointerEvents = 'none'; [bUndo, bReset, bHint].forEach(b => { b.style.visibility = on ? '' : 'hidden'; }); };
  U.showDone = function (d) {
    if (!d) { done.classList.remove('on'); done.setAttribute('aria-hidden', 'true'); return; }
    dKick.textContent = d.kicker;
    dName.textContent = d.name;
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
    header('Your collection', items.length + (items.length === 1 ? ' visual universe' : ' visual universes'), 'Every solved puzzle keeps its artwork.');
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
      for (let n = 0; n < 3 && thumbQueue.length; n++) {
        const q = thumbQueue.shift();
        try {
          const cv = surfaceToImage(renderThumbnail(q.it.theme(), q.it.ringCount, 96, pr), 96);
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
    const cv = surfaceToImage(renderThumbnail(theme, it.ringCount, size, pr), size);
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
// (play -> solving -> done -> next), and talks to the Plethora SDK.

window.plethoraBit = {
  meta: {
    title: 'ORBIT',
    runtime: 'plethora-bit@2',
    tags: ['puzzle', 'daily', 'colour'],
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

    // ---- Game state (single source of truth lives in `eng`) -------------------------
    const G = {
      mode: 'daily',        // daily | study | gallery
      phase: 'play',        // intro | play | solving | done | transition | gallery
      level: 1, day: today,
      puzzle: null, eng: null, theme: null,
      vis: [], tween: [],   // visual angle per ring, active snap tweens
      selected: -1, selectT: 0, selectAt: 0,
      alignedVis: [], flash: [], wasAligned: [],
      completeT: 0, completeGlow: 0, completeAt: 0,
      orbitA: 0,
      hint: null,
      started: false, attempt: 0, interacted: false,
      clock: null, elapsedFallback: 0,
      restoredSolved: false,
      transition: null,
      prev: null,           // previous mode state when visiting the gallery
      nudge: null,
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
      onShare: () => doShare(),
      onNext: () => doNext()
    });
    hud.setMuted(!!scores.profile.muted);
    ctx.surface.place(hud.modal, { layer: 'modal', input: 'passthrough' });

    // ---- Layout ----------------------------------------------------------------------------
    let L = null;
    function computeLayout() {
      const W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
      const a0 = ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 120, left: 0 };
      const area = { top: a0.top || 0, right: a0.right || 0, bottom: a0.bottom || 0, left: a0.left || 0 };
      const top = area.top, bot = H - area.bottom;
      const wide = W > H * 1.15 && W >= 620;
      const lay = { W, H, area, wide };
      if (!wide) {
        const compact = (bot - top) < 640;
        const headerH = compact ? 92 : 122;
        const bottomH = compact ? 176 : 252;
        const availTop = top + headerH, availBot = bot - bottomH;
        let R = Math.min((W - 28) / 2 / 1.15, (availBot - availTop) / 2 / 1.15, 260);
        R = Math.max(60, R);
        lay.compact = compact;
        lay.R = R; lay.cx = W / 2;
        lay.cy = (availTop + availBot) / 2;
        lay.headerTop = top + (compact ? 4 : 10);
        lay.colX = 0; lay.colW = W;
        lay.bottomTop = Math.min(lay.cy + R * 1.17 + 4, availBot + 8);
        lay.doneTop = lay.bottomTop - 2;
      } else {
        const R = Math.max(60, Math.min((bot - top - 24) / 2 / 1.15, (W * 0.56 - 32) / 2 / 1.15, 300));
        lay.compact = (bot - top) < 560;
        lay.R = R; lay.cx = area.left + W * 0.29; lay.cy = (top + bot) / 2;
        lay.colX = W * 0.56; lay.colW = W * 0.44 - area.right;
        const colH = 122 + 236;
        lay.headerTop = Math.max(top + 10, (top + bot) / 2 - colH / 2);
        lay.bottomTop = lay.headerTop + 128;
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
    function diffForLevel(l) {
      if (l <= 2) return 'easy';
      if (l <= 6) return 'medium';
      return l % 3 === 0 ? 'hard' : 'medium';
    }
    function loadPuzzle(mode, n, saved) {
      G.mode = mode;
      if (mode === 'daily') { G.day = n; G.puzzle = PuzzleGenerator.generate(keyFromDayNumber(n), 'medium'); G.theme = ThemeEngine.forDaily(n); }
      else { G.level = n; G.puzzle = PuzzleGenerator.generate('level:' + n, diffForLevel(n)); G.theme = ThemeEngine.forLevel(n); }
      G.eng = createEngine(G.puzzle, saved && saved.eng);
      const nr = G.puzzle.ringCount;
      G.vis = G.eng.rot.map(r => r * STEP);
      G.tween = new Array(nr).fill(null);
      G.flash = new Array(nr).fill(0);
      G.wasAligned = []; G.alignedVis = [];
      for (let k = 0; k < nr; k++) { const a = G.eng.isAligned(k); G.wasAligned.push(a); G.alignedVis.push(k > 0 && a ? 1 : 0); }
      G.selected = -1; G.selectT = 0; G.hint = null;
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
      G.phase = 'play';
      G.dirty = true;
      syncHud();
    }
    function elapsed() { return G.clock ? G.clock.elapsedMs : G.elapsedFallback; }
    function clockStart() { if (G.clock) G.clock.start(); G.running = true; }
    function clockPause() { if (G.clock) G.clock.pause(); G.running = false; }

    function movable() { return G.puzzle.ringCount - 1; }
    function orbitTarget() { return G.eng ? (G.eng.alignedCount() / movable()) * TAU : 0; }

    function editionLabel() {
      if (G.mode === 'daily') return 'DAILY PUZZLE · NO. ' + pad3(G.day) + ' · ' + prettyDate(keyFromDayNumber(G.day));
      if (G.mode === 'study') return 'STUDY NO. ' + pad3(G.level) + ' · ' + DIFFICULTY[G.puzzle.difficulty].label.toUpperCase() + ' · ' + movable() + ' RINGS';
      return 'COLLECTION · ' + (G.galleryItem ? G.galleryItem.sub : '');
    }
    let captionHoldUntil = 0;
    function flashCaption(text) {
      captionHoldUntil = now() + 2600;
      hud.setCaption(text, false);
      ctx.timeout(() => { if (now() >= captionHoldUntil - 5) syncHud(); }, 2650);
    }
    function syncHud() {
      const playing = G.phase === 'play';
      hud.setHeader(G.mode, editionLabel(), G.phase === 'done' && G.mode !== 'gallery');
      hud.setStats(G.eng.moves, elapsed(), G.eng.alignedCount(), movable());
      hud.setControls(G.eng.history.length > 0, playing);
      if (playing && now() >= captionHoldUntil) {
        const a = G.eng.alignedCount(), m = movable();
        if (!scores.profile.seenIntro && !G.interacted) hud.setCaption('Turn each ring until its colours meet the centre ring', false);
        else if (a === 0) hud.setCaption('Untitled No. ' + pad3(G.mode === 'daily' ? G.day : G.level) + ' — match each ring to the centre', false);
        else hud.setCaption(a + ' of ' + m + ' rings aligned', false);
      }
    }

    // ---- Persistence of the current puzzle --------------------------------------------
    // Device copy on every committed move (cheap, synchronous); Continue Playing
    // progress at bounded checkpoints only.
    const DAY_KEY = 'orbit.day.v1', STUDY_KEY = 'orbit.study.v1';
    function snapshot() { return { v: 1, edition: G.mode === 'daily' ? G.day : G.level, eng: G.eng.serialize(), elapsedMs: Math.round(elapsed()) }; }
    function saveLocal() {
      if (G.mode === 'gallery' || !caps.storage || !ctx.storage) return;
      try { ctx.storage.set(G.mode === 'daily' ? DAY_KEY : STUDY_KEY, snapshot()); } catch (e) { }
    }
    let lastProgressSave = 0, progressDirty = false, progressBlocked = false;
    function saveProgress(force) {
      if (G.mode !== 'daily' || progressBlocked || !ctx.game || !ctx.game.progress) return;
      const now = performance.now();
      if (!force && now - lastProgressSave < 12000) { progressDirty = true; return; }
      lastProgressSave = now; progressDirty = false;
      const s = snapshot();
      try {
        ctx.game.progress.save('daily', {
          state: s,
          label: 'No. ' + pad3(G.day) + ' · ' + G.eng.alignedCount() + ' of ' + movable() + ' aligned',
          percent: G.eng.alignedCount() / movable(),
          stateSchemaVersion: 1
        }).catch(err => { try { ctx.platform.error({ stage: 'progress_save', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
    function readLocal(key, edition) {
      try {
        if (!caps.storage || !ctx.storage) return null;
        const s = ctx.storage.get(key);
        if (s && s.v === 1 && s.edition === edition && s.eng) return s;
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
      hud.showRotate(k > 0 && G.phase === 'play');
      G.dirty = true;
    }

    // ---- Committed moves ----------------------------------------------------------------
    function commit(k, steps, viaDrag) {
      const res = G.eng.rotate(k, steps);
      if (!res) return null;
      lastAction = now();
      if (G.hint && G.hint.ring === k) G.hint.until = Math.min(G.hint.until, now() + 400);
      tweenRing(k, res.to * STEP, 0, () => afterSeat(k, res));
      ctx.platform.interact({ action: viaDrag ? 'drag' : 'tap', ring: k, steps });
      onFirstMove();
      saveLocal();
      syncHud();
      return res;
    }
    function afterSeat(k, res) {
      sound.snap();
      const nowAligned = G.eng.isAligned(k);
      if (nowAligned && !G.wasAligned[k]) {
        G.flash[k] = 0.0001;
        sound.align(k);
        haptic('success');
        ctx.platform.milestone('ring_aligned', { ring: k, aligned: G.eng.alignedCount() });
        saveProgress(true);
      } else {
        saveProgress(false);
      }
      G.wasAligned[k] = nowAligned;
      sound.setProgress(G.eng.alignedCount() / movable());
      if (G.eng.solved && G.phase === 'play') beginSolved();
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
      if (G.started || G.phase !== 'play' || G.mode === 'gallery') return;
      G.started = true;
      G.attempt = scores.newAttempt();
      try { ctx.platform.start({ mode: G.mode, edition: G.mode === 'daily' ? G.day : G.level }); } catch (e) { }
      clockStart();
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
      if (r > L.R * 1.2) return { k: -2, r };
      if (r >= geom.rings[geom.n - 1].rOut) return { k: geom.n - 1, r };
      for (let k = 0; k < geom.n; k++) {
        const ring = geom.rings[k];
        const hi = k < geom.n - 1 ? (ring.rOut + geom.rings[k + 1].rIn) / 2 : Infinity;
        if (r < hi) return { k, r };
      }
      return { k: geom.n - 1, r };
    }
    function angleAt(px, py) { return Math.atan2(py - L.cy, px - L.cx); }

    ctx.listen(canvas, 'pointerdown', e => {
      if (hud.isModalOpen()) return;
      if (drag) return; // one ring at a time; extra fingers are ignored
      const p = localPoint(e);
      if (G.phase === 'done' || G.phase === 'gallery' || G.phase === 'transition' || G.phase === 'solving') { sound.unlock(); return; }
      if (e.cancelable) e.preventDefault();
      try { canvas.focus({ preventScroll: true }); } catch (err) { }
      const hit = ringAt(p.x, p.y);
      if (hit.k === -2) { select(-1); return; }
      if (G.phase === 'intro') finishIntro();
      beginAttempt();
      G.interacted = true;
      if (G.nudge) { G.nudge = null; }
      if (hit.k === -1) return;
      if (hit.k === 0) {
        // The centre ring is the fixed reference.
        sound.refuse(); haptic('light');
        flashCaption('The centre ring is fixed — match the others to it');
        return;
      }
      const k = hit.k;
      // Grab from wherever the ring visually is, even mid-snap.
      if (G.tween[k]) { G.tween[k] = null; }
      drag = { k, id: e.pointerId, lastA: angleAt(p.x, p.y), base: G.vis[k], accum: 0, moved: false, detent: Math.round(G.vis[k] / STEP), t0: now() };
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
      if (!drag.moved && (Math.abs(drag.accum) > 0.035 || Math.hypot(p.x - L.cx, p.y - L.cy) === 0)) drag.moved = true;
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
        if (!cancelled && !drag.moved) {
          // A tap selects the ring and reveals the step controls.
          hud.showRotate(true);
        }
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

    // Keyboard: arrows turn the selected ring, up/down choose a ring, Z undoes.
    ctx.listen(canvas, 'keydown', e => {
      if (G.phase !== 'play' || hud.isModalOpen()) return;
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
    });

    function tapRotate(dir) {
      if (G.phase !== 'play' || G.selected < 1) return;
      beginAttempt();
      G.interacted = true;
      haptic('light');
      commit(G.selected, dir, false);
      hud.showRotate(true);
    }

    // ---- Controls ----------------------------------------------------------------------
    function doUndo() {
      if (G.phase !== 'play') return;
      const h = G.eng.undo();
      if (!h) { sound.refuse(); return; }
      sound.undo(); haptic('light');
      tweenRing(h.ring, h.from * STEP, 0, () => { G.wasAligned[h.ring] = G.eng.isAligned(h.ring); });
      ctx.platform.interact({ action: 'undo' });
      saveLocal();
      syncHud();
    }
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
      for (let k = 1; k < G.puzzle.ringCount; k++) { tweenRing(k, G.eng.rot[k] * STEP, 420); G.wasAligned[k] = G.eng.isAligned(k); }
      G.hint = null;
      sound.undo();
      ctx.platform.interact({ action: 'restart' });
      saveLocal();
      syncHud();
    }
    let resetSeq = 0;
    function doHint() {
      if (G.phase !== 'play') return;
      beginAttempt();
      const h = G.eng.hint();
      if (!h) return;
      G.hint = { ring: h.ring, dir: h.dir, alpha: 0, until: now() + 3800 };
      select(h.ring);
      flashCaption(h.dir > 0 ? 'Try turning the highlighted ring clockwise' : 'Try turning the highlighted ring anticlockwise');
      ctx.platform.interact({ action: 'hint' });
      saveLocal();
    }
    function toggleMute() {
      const m = !scores.profile.muted;
      scores.setFlag('muted', m);
      sound.setMuted(m);
      if (!m) sound.unlock();
      hud.setMuted(m);
    }

    // ---- Completion ----------------------------------------------------------------------
    function beginSolved() {
      G.phase = 'solving';
      clockPause();
      select(-1);
      hud.showRotate(false);
      G.hint = null;
      G.completeAt = now() + 120;
      G.completeT = 0;
      sound.complete(G.puzzle.ringCount);
      haptic('success');
      const timeMs = Math.round(elapsed());
      const moves = G.eng.moves;
      let info;
      if (G.mode === 'daily') {
        const isToday = G.day === dayNumberFromKey(dateKey(new Date()));
        info = scores.completeDaily(G.day, moves, timeMs, G.eng.hints, G.theme.key);
        G.result = { timeMs, moves, par: G.eng.par, hints: G.eng.hints, streak: scores.currentStreak(G.day), info, board: '' };
        // Only a live solve of today's edition goes on the leaderboard.
        if (isToday && info.first && !G.restoredSolved) {
          G.result.board = 'Saving to today’s board…';
          scores.submitDaily(timeMs, moves, G.day, info.streak, r => onBoardResult(r));
        }
        try { ctx.game.progress && ctx.game.progress.complete('daily', { state: snapshot() }).catch(() => { }); } catch (e) { }
        try { ctx.platform.complete({ mode: 'daily', edition: G.day, timeMs, moves }); } catch (e) { }
      } else {
        info = scores.completeLevel(G.level, moves, timeMs, G.theme.key);
        G.result = { timeMs, moves, par: G.eng.par, hints: G.eng.hints, info, board: '' };
        try { ctx.platform.complete({ mode: 'study', level: G.level, timeMs, moves }); } catch (e) { }
      }
      saveLocal();
      ctx.timeout(() => showResult(true), 1500);
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
      const best = G.mode === 'daily' ? scores.bestDailyTime() : null;
      if (best !== null && G.mode === 'daily') stats.push(['Best', fmtTime(best)]);
      const isNew = R.info && R.info.newTheme;
      hud.showPlay(false);
      hud.setHeader(G.mode, editionLabel(), true);
      hud.showDone({
        kicker: isNew ? 'New universe discovered' : 'Universe',
        name: t.name,
        desc: t.description,
        stats,
        board: R.board,
        nextLabel: G.mode === 'daily' ? 'Studies' : 'Next study',
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
      const m = movable();
      const rings = Array.from({ length: m }, () => '●').join(' ');
      const head = G.mode === 'daily' ? 'ORBIT  No. ' + pad3(G.day) : 'ORBIT  Study ' + pad3(G.level);
      const perfect = R.moves === R.par ? '  ·  perfect' : '';
      const lines = [head, '“' + t.name + '”', '◎  ' + rings, fmtTime(R.timeMs) + '  ·  ' + R.moves + ' moves (par ' + R.par + ')' + perfect];
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
      // New puzzles start solved, then wind out into their scramble.
      const scrambled = G.vis.slice();
      const solvedDailyView = done && G.eng.solved;
      if (!G.eng.solved) for (let k = 0; k < G.vis.length; k++) G.vis[k] = 0;
      G.transition = { from, t0: now(), dur: 950, then: () => {
        if (solvedDailyView || G.eng.solved) { enterSolvedView(done); return; }
        for (let k = 1; k < G.vis.length; k++) {
          const extra = (k % 2 ? -1 : 1) * TAU * 0;
          G.tween[k] = { from: 0, to: scrambled[k] + extra, t0: now() + k * 70, dur: 700, ease: easeOutQuint };
        }
        G.phase = 'intro';
        G.introEnd = now() + 700 + G.vis.length * 70;
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
    // Re-opening an edition already solved shows the finished artwork.
    function enterSolvedView(done) {
      if (!G.eng.solved) {
        // Solved elsewhere (another device): show the finished arrangement.
        for (let k = 1; k < G.puzzle.ringCount; k++) G.eng.rot[k] += G.eng.stepsToAlign(k) || 0;
        G.eng.solved = G.eng.checkSolved();
      }
      for (let k = 0; k < G.vis.length; k++) { G.vis[k] = G.eng.rot[k] * STEP; G.tween[k] = null; G.wasAligned[k] = true; }
      hud.showRotate(false);
      select(-1);
      clockPause();
      G.phase = 'done';
      G.completeT = 1; G.completeGlow = 1; G.orbitA = TAU;
      for (let k = 1; k < G.vis.length; k++) G.alignedVis[k] = 1;
      const d = done || [G.eng.moves, elapsed(), G.eng.hints];
      G.result = { timeMs: d[1], moves: d[0], par: G.eng.par, hints: d[2] || 0, info: { newTheme: false }, board: '' };
      showResult(false);
    }

    // ---- Collection and gallery ---------------------------------------------------------------
    function collectionItems() {
      const items = [];
      scores.profile.coll.slice().reverse().forEach(key => {
        const m = /^(daily|level):(\d+)$/.exec(key);
        if (!m) return;
        const n = +m[2];
        const daily = m[1] === 'daily';
        let cached = null;
        const d = daily ? scores.profile.daily[n] : scores.profile.levels.best[n];
        items.push({
          key, n, daily,
          title: '', sub: daily ? 'No. ' + pad3(n) + ' · ' + prettyDate(keyFromDayNumber(n)) : 'Study ' + pad3(n),
          ringCount: daily ? DIFFICULTY.medium.rings : DIFFICULTY[diffForLevel(n)].rings,
          stat: d ? 'Solved in ' + fmtTime(d[1]) + ', ' + d[0] + ' moves.' : '',
          d,
          theme() { return cached || (cached = ThemeEngine.forKey(key)); }
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
      hud.openCollection(items, { title: 'Undiscovered', sub: 'Study ' + pad3(nextLevel) });
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
      const nr = it.ringCount;
      G.puzzle = { ringCount: nr, sequences: PuzzleGenerator.solvedSequences(nr), scramble: new Array(nr).fill(0) };
      G.eng = createEngine(G.puzzle);
      G.theme = theme;
      G.vis = new Array(nr).fill(0); G.tween = new Array(nr).fill(null); G.flash = new Array(nr).fill(0);
      G.alignedVis = new Array(nr).fill(1); G.wasAligned = new Array(nr).fill(true);
      G.mode = 'gallery';
      G.completeT = 0; G.completeGlow = 1; G.orbitA = TAU;
      hud.applyTheme(theme);
      hud.showDone(null); hud.showPlay(false);
      G.transition = { from, t0: now(), dur: 950, then: () => {
        G.phase = 'done';
        G.completeAt = now(); G.completeT = 0.0001;
        G.result = { timeMs: 0, moves: 0, par: 0, info: {}, board: '' };
        hud.setHeader('gallery', editionLabel(), false);
        hud.showDone({ kicker: 'From your collection', name: theme.name, desc: theme.description, stats: it.d ? [['Time', fmtTime(it.d[1])], ['Moves', String(it.d[0])]] : [], board: theme.universeTitle.toUpperCase() + ' · ' + theme.material.label.toUpperCase(), nextLabel: 'Back', canShare: false });
      } };
      G.phase = 'transition';
      sound.reveal();
    }

    // ---- Scene + loop ------------------------------------------------------------------------
    function buildScene() {
      const seqs = G.puzzle.sequences;
      return {
        ringCount: G.puzzle.ringCount,
        angles: G.vis.slice(),
        families: (k, i) => seqs[k][i],
        selected: G.selected, selectT: G.selectT, dimOthers: G.selectT * (G.phase === 'play' ? 1 : 0),
        alignedVis: G.alignedVis.slice(), flash: G.flash.slice(),
        completeT: G.completeT, completeGlow: G.completeGlow,
        orbitA: G.orbitA,
        hint: G.hint && G.hint.alpha > 0.01 ? { ring: G.hint.ring, dir: G.hint.dir, alpha: G.hint.alpha } : null
      };
    }

    let hudTick = 0, idleSince = now();
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
      if (G.selected > 0 && !drag && G.phase === 'play' && t - Math.max(G.selectAt, lastAction) > 5000) { select(-1); }

      // Alignment marks and flashes.
      for (let k = 1; k < G.alignedVis.length; k++) {
        const target = G.eng.isAligned(k) && !G.tween[k] && !(drag && drag.k === k) ? 1 : 0;
        if (Math.abs(G.alignedVis[k] - target) > 0.002) { G.alignedVis[k] = lerp(G.alignedVis[k], target, 1 - Math.exp(-dt / 160)); animating = true; }
        if (G.flash[k] > 0) { G.flash[k] += dt / 900; animating = true; if (G.flash[k] >= 1) G.flash[k] = 0; }
      }
      const ot = (G.phase === 'done' || G.phase === 'solving') ? TAU : orbitTarget();
      if (Math.abs(G.orbitA - ot) > 0.0005) { G.orbitA = lerp(G.orbitA, ot, 1 - Math.exp(-dt / 220)); animating = true; }

      // Completion light.
      if ((G.phase === 'solving' || G.phase === 'done') && G.completeT > 0 && G.completeT < 1 || G.phase === 'solving') {
        G.completeT = clamp((t - G.completeAt) / 2400, 0, 1);
        G.completeGlow = Math.min(1, G.completeGlow + dt / 900);
        animating = true;
      }

      // Hint chevrons.
      if (G.hint) {
        const target = t < G.hint.until ? 1 : 0;
        G.hint.alpha = lerp(G.hint.alpha, target, 1 - Math.exp(-dt / 140));
        if (!target && G.hint.alpha < 0.01) G.hint = null;
        animating = true;
      }

      // First-time nudge: the outer ring sways, once, to show it turns.
      if (G.phase === 'play' && !scores.profile.seenIntro && !G.interacted && !drag) {
        if (!G.nudge && t - idleSince > 1600) G.nudge = { t0: t };
        if (G.nudge) {
          const k = G.puzzle.ringCount - 1;
          const u = (t - G.nudge.t0) / 1600;
          const base = G.eng.rot[k] * STEP;
          G.vis[k] = base + Math.sin(Math.min(1, u) * TAU) * 0.2 * (1 - Math.min(1, u));
          if (u >= 1) { G.vis[k] = base; G.nudge = null; idleSince = t + 2600; }
          animating = true;
        }
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

    if (window.__ORBIT_DEV) window.__orbit = { G, layout: () => L, board, scores, goTo, ThemeEngine, renderThumbnail, ThemeRegistry };
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
          const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 1));
          if (!eligible || !s || s.v !== 1 || s.edition !== today) return;
          loadPuzzle('daily', today, s);
          G.dirty = true;
        }).catch(err => { progressBlocked = false; try { ctx.platform.error({ stage: 'progress_load', message: String(err && err.message || err) }); } catch (e) { } });
      } catch (e) { }
    }
  }
};

})();
