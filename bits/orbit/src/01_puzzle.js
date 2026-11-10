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
