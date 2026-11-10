// Pure game rules: no DOM, no rendering. Everything here is exercised by dev/rules_test.js.
const CONFIG = {
  runSeconds: 75,          // one continuous timer for all five words (tune in playtesting)
  hintCost: 5,             // seconds taken from the shared timer by a nudge
  hintMinRemaining: 5,     // at or below this, a nudge would end the run, so it is refused
  basePoints: 100,         // per correct word
  speedPerSecond: 1,       // speed bonus: points per whole second remaining at the moment of solving
  streakStep: 0.25,        // multiplier gained per consecutive clean word (no wrong guess, no nudge)
  streakMax: 2,
  hintScorePenalty: 50,    // score cost of a nudge, on top of the time cost
  completionBonus: 250,    // for reaching the bottom
  completionPerSecond: 10, // per whole second left when the fifth word lands
  inputDelay: 1.15,        // seconds after a correct word before the next puzzle accepts letters
  epoch: [2026, 0, 1]      // daily puzzle #1 (local date)
};
const LEVEL_NAMES = ['WARM UP', 'GETTING WARM', 'THINK FAST', 'DEEP END', 'FINAL DESCENT'];

function loadBank(raw) {
  const levels = [[], [], [], [], []];
  for (const r of raw) {
    if (r.validation !== 'verified') continue;
    const accepted = r.acceptedAnswers.split(' ');
    levels[r.difficulty - 1].push(Object.assign({}, r, { accepted, acceptedSet: new Set(accepted) }));
  }
  return levels;
}

// Daily number from the player's local calendar date (#1 = CONFIG.epoch).
function dayNumber(date) {
  const d = date || new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const e = Date.UTC(CONFIG.epoch[0], CONFIG.epoch[1], CONFIG.epoch[2]);
  return Math.floor((a - e) / 86400000) + 1;
}

// Deterministic: every player gets the same five puzzles for a given day number.
// Each level walks a seeded permutation of its pool, so a puzzle never repeats within a cycle,
// and each cycle reshuffles. Pools have different sizes, so the five-word sets don't repeat in step.
function dailyPuzzles(bank, day) {
  const out = [];
  for (let l = 0; l < 5; l++) {
    const pool = bank[l], n = pool.length, k = ((day - 1) % n + n) % n, cycle = Math.floor((day - 1) / n);
    const perm = shuffled(pool.map((_, i) => i), makeRng(hashStr('words-apart/' + l + '/' + cycle)));
    out.push(pool[perm[k]]);
  }
  return out;
}

function practicePuzzles(bank, seed, avoidIds) {
  const rng = makeRng(seed >>> 0), avoid = new Set(avoidIds || []);
  return bank.map(pool => { const c = pool.filter(p => !avoid.has(p.id)); const src = c.length ? c : pool; return src[Math.floor(rng() * src.length)]; });
}

// What the player has typed for one puzzle. Players may type only the missing middle letters,
// or the whole word including the fixed first/last letters; both are understood.
class WordInput {
  constructor(p) { this.p = p; this.cap = p.length - 2; this.raw = ''; }
  interpret(raw) {
    const cap = this.cap, s = this.p.startLetter, e = this.p.endLetter;
    if (raw.length <= cap) return raw;
    if (raw.length === cap + 1) { if (raw[0] === s) return raw.slice(1); if (raw[raw.length - 1] === e) return raw.slice(0, -1); return null; }
    if (raw.length === cap + 2 && raw[0] === s && raw[raw.length - 1] === e) return raw.slice(1, -1);
    return null;
  }
  get middle() { return this.interpret(this.raw) || ''; }
  get full() { return this.middle.length === this.cap; }
  get word() { return this.p.startLetter + this.middle + this.p.endLetter; }
  // Returns true if the letter changed what is shown.
  type(ch) {
    ch = String(ch || '').toUpperCase();
    if (!/^[A-Z]$/.test(ch)) return false;
    const next = this.raw + ch;
    if (this.interpret(next) === null) return false;
    this.raw = next; return true;
  }
  back() { const m = this.middle; if (!m.length) { this.raw = ''; return false; } this.raw = m.slice(0, -1); return true; }
  clear() { this.raw = ''; }
  setRaw(s) { // from a text field: keep letters only, then accept as many as fit
    const letters = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
    this.raw = ''; for (const c of letters) this.type(c);
  }
}

function isAccepted(p, word) { return p.acceptedSet.has(String(word || '').toUpperCase()); }

// One run of five words against one clock. `now` is milliseconds from a single monotonic source.
class Run {
  constructor(puzzles, opts) {
    this.puzzles = puzzles; this.cfg = Object.assign({}, CONFIG, opts || {});
    this.state = 'ready'; this.level = 0; this.startAt = 0; this.endAt = 0; this.openAt = 0; this.frozen = null;
    this.hints = [false, false, false, false, false]; this.wrong = [0, 0, 0, 0, 0];
    this.solved = []; this.score = 0; this.streak = 0; this.input = new WordInput(puzzles[0]);
    this.finishedAt = 0;
  }
  get puzzle() { return this.puzzles[this.level]; }
  start(now) { if (this.state !== 'ready') return false; this.state = 'playing'; this.startAt = now; this.endAt = now + this.cfg.runSeconds * 1000; this.openAt = now; return true; }
  remainingMs(now) { if (this.frozen !== null) return this.frozen; if (this.state === 'ready') return this.cfg.runSeconds * 1000; return Math.max(0, this.endAt - now); }
  accepting(now) { return this.state === 'playing' && now >= this.openAt && this.remainingMs(now) > 0; }
  // Advance the clock; returns 'lost' at the moment time runs out.
  tick(now) {
    if (this.state === 'playing' && this.endAt - now <= 0) { this.state = 'lost'; this.frozen = 0; this.finishedAt = this.endAt; return 'lost'; }
    return null;
  }
  type(ch, now) { if (!this.accepting(now)) return false; return this.input.type(ch); }
  back(now) { if (!this.accepting(now)) return false; return this.input.back(); }
  submit(now) {
    if (this.tick(now) === 'lost') return { kind: 'lost' };
    if (!this.accepting(now)) return { kind: 'ignored' };
    const inp = this.input, p = this.puzzle;
    if (inp.middle.length === 0) return { kind: 'empty' };
    if (!inp.full) return { kind: 'incomplete' };
    const word = inp.word;
    if (!isAccepted(p, word)) { this.wrong[this.level]++; this.streak = 0; return { kind: 'wrong', word }; }
    const remMs = this.remainingMs(now), c = this.cfg;
    const clean = !this.hints[this.level] && this.wrong[this.level] === 0;
    this.streak = clean ? this.streak + 1 : 0;
    const mult = clean ? Math.min(c.streakMax, 1 + c.streakStep * (this.streak - 1)) : 1;
    const speed = Math.floor(remMs / 1000) * c.speedPerSecond;
    const penalty = this.hints[this.level] ? c.hintScorePenalty : 0;
    const points = Math.max(0, Math.round((c.basePoints + speed) * mult) - penalty);
    const entry = { level: this.level, puzzle: p, word, primary: word === p.answer, base: c.basePoints, speed, mult, penalty, points, at: now - this.startAt, hint: this.hints[this.level], wrong: this.wrong[this.level] };
    this.solved.push(entry); this.score += points;
    if (this.level === this.puzzles.length - 1) {
      this.state = 'won'; this.frozen = remMs; this.finishedAt = now;
      entry.bonus = c.completionBonus + Math.floor(remMs / 1000) * c.completionPerSecond;
      this.score += entry.bonus;
      return { kind: 'won', entry };
    }
    this.level++; this.input = new WordInput(this.puzzle); this.openAt = now + c.inputDelay * 1000;
    return { kind: 'correct', entry };
  }
  // A nudge: once per level, costs time and score, never takes the clock below zero.
  hint(now) {
    if (this.state !== 'playing') return { kind: 'ignored' };
    if (this.hints[this.level]) return { kind: 'already' };
    if (this.remainingMs(now) <= this.cfg.hintMinRemaining * 1000) return { kind: 'denied' };
    this.hints[this.level] = true; this.endAt -= this.cfg.hintCost * 1000;
    return { kind: 'ok', hint: this.puzzle.hint };
  }
  hintAvailable(now) { return this.state === 'playing' && !this.hints[this.level] && this.remainingMs(now) > this.cfg.hintMinRemaining * 1000; }
  get hintsUsed() { return this.hints.filter(Boolean).length; }
  elapsedMs() { return (this.finishedAt || this.endAt) - this.startAt; }
}
