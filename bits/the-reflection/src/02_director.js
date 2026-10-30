// =====================================================================
// The reflection's mind. Pure game logic: no rendering, no DOM, no clocks.
// The game calls update(dt) and input(action); the director answers through
// hooks. Everything it decides comes from one seeded queue, so a run is
// reproducible given the seed and the player's timing.
//
// hooks.reflect(action, kind)  kind: follow | lead | repeat | feint | tell
// hooks.result(grade, info)    grade: follow | perfect | good | late | wrong | miss | stray | fooled
// hooks.cue(prompt)            a real prompt's response timer has started
// hooks.phase(n), hooks.level(n), hooks.warn(state), hooks.milestone(id), hooks.over()
// =====================================================================

function createDirector(hooks, seed) {
  const C = CONFIG;
  const rng = makeRng(seed || 1);
  const D = {
    t: 0, sync: C.sync.start, score: 0, streak: 0, bestStreak: 0, perfectStreak: 0,
    level: 1, phase: 1, over: false, prompts: [], feint: null,
    nextAt: Infinity, lastResolveAt: -9, lastHitAt: -9, lastInputAt: -9, lastFollow: null, follows: [],
    reflPose: 'stand', promptCount: 0, habits: { sit: 0, stand: 0, crouch: 0, paw: 0, jump: 0 },
    cycle: 0, lastPlanFeint: false, anticipateNext: null, survived: false, counts: { perfect: 0, good: 0, late: 0, wrong: 0, miss: 0 }
  };
  const H = Object.assign({ reflect() { }, result() { }, cue() { }, phase() { }, level() { }, warn() { }, milestone() { }, over() { } }, hooks || {});

  // ---------- difficulty manager ----------
  D.levelAt = t => {
    let n = 0; for (let i = 0; i < C.levels.length; i++) if (t >= C.levels[i].at) n = i + 1;
    if (t >= C.survivalAt) n += 1 + Math.floor((t - C.survivalAt) / C.endlessEvery);
    return n;
  };
  D.windowScale = () => {
    if (D.level < 6) return 1;
    const extra = Math.max(0, D.level - C.levels.length);
    return Math.max(C.windowScale.floor, C.windowScale.l6 - extra * C.windowScale.perEndless);
  };
  D.windows = () => { const s = D.windowScale(); return { perfect: C.windows.perfect * s, good: C.windows.good * s, miss: C.windows.miss * s }; };
  D.followDelay = t => lerp(C.follow.delayStart, C.follow.delayEnd, clamp(t / C.follow.until, 0, 1));
  function gap() {
    const base = Math.max(C.gap.floor, C.gap.start - Math.max(0, D.t - C.initiativeAt) * 0.007);
    return D.level >= 6 ? base * rng.range(0.6, 1.5) : base;
  }
  const levelMult = () => 1 + 0.15 * (D.level - 1);
  const comboMult = () => Math.min(C.score.comboMax, 1 + D.perfectStreak * C.score.comboStep);
  D.comboMult = comboMult;
  D.state = () => { for (const s of C.states) if (D.sync >= s.min && D.sync > 0) return s.name; return 'ESCAPED'; };
  D.leading = () => D.t >= C.initiativeAt;

  // ---------- choosing what the reflection does ----------
  const ORDER = ['sit', 'paw', 'stand', 'crouch', 'jump'];
  function chooseAction() {
    if (D.anticipateNext) { const a = D.anticipateNext; D.anticipateNext = null; return a; }
    if (D.level < 4) { // a readable fixed order teaches the idea
      let a = ORDER[D.cycle++ % ORDER.length];
      if (a === D.reflPose) a = ORDER[D.cycle++ % ORDER.length];
      return a;
    }
    const allowRepeat = D.level >= 5 && rng.chance(0.22);
    if (allowRepeat) return D.reflPose === 'stand' && rng.chance(0.5) ? 'jump' : D.reflPose;
    let a; do { a = rng.pick(ACTIONS); } while (a === D.reflPose);
    return a;
  }
  // the reflection anticipates: it goes for what the player tends to press
  function habit() {
    let best = null, n = -1;
    for (const a of ACTIONS) if (a !== D.reflPose && D.habits[a] > n) { n = D.habits[a]; best = a; }
    return best;
  }
  function plan() {
    const lv = D.level;
    const feintChance = lv >= 7 ? Math.min(C.feint.chanceMax, C.feint.chance + (lv - 7) * 0.03) : 0;
    if (!D.lastPlanFeint && !D.anticipateNext && rng.chance(feintChance)) {
      let a; do { a = rng.pick(ACTIONS); } while (a === D.reflPose);
      D.feint = { action: a, at: D.t, until: D.t + C.feint.dur };
      D.lastPlanFeint = true;
      H.reflect(a, 'feint');
      D.nextAt = D.feint.until + 0.3;
      return;
    }
    D.lastPlanFeint = false;
    let n = 1;
    if (D.t >= C.pair.from && rng.chance(Math.min(C.pair.chanceMax, C.pair.chance + (lv - 8) * 0.04))) n = 2;
    if (n === 2 && D.t >= C.triple.from && rng.chance(C.triple.chance)) n = 3;
    let pose = D.reflPose;
    for (let i = 0; i < n; i++) {
      const prev = D.reflPose; D.reflPose = pose;
      let a = chooseAction();
      if (i > 0 && a === D.prompts[D.prompts.length - 1].action && a !== 'jump') { let b; do { b = rng.pick(ACTIONS); } while (b === a || b === pose); a = b; }
      D.reflPose = prev;
      const t0 = D.t + i * C.pair.spacing;
      const w = D.windows();
      D.prompts.push({ id: ++D.promptCount, action: a, t0, cueAt: t0 + C.cueLead, deadline: t0 + C.cueLead + w.miss + i * 0.15, started: false, resolved: false, repeat: a === pose && a !== 'jump', index: i, of: n });
      pose = a === 'jump' ? 'stand' : a;
    }
    D.nextAt = Infinity;
  }

  // ---------- resolving ----------
  function addSync(v) {
    const before = D.state();
    D.sync = clamp(D.sync + v, 0, 100);
    const after = D.state();
    if (after !== before && v < 0 && D.sync > 0) H.warn(after);
    if (D.sync <= 0 && !D.over) { D.over = true; D.prompts.length = 0; D.follows.length = 0; D.nextAt = Infinity; H.over(); }
  }
  function award(grade) {
    const base = C.score[grade] || 0;
    const pts = Math.round(base * levelMult() * comboMult());
    D.score += pts;
    return pts;
  }
  function resolve(p, grade) {
    p.resolved = true; p.grade = grade; D.lastHitAt = D.t;
    D.counts[grade] = (D.counts[grade] || 0) + 1;
    let pts = 0;
    if (grade === 'perfect') { D.streak++; D.perfectStreak++; pts = award('perfect'); addSync(C.sync.perfect); }
    else if (grade === 'good') { D.streak++; D.perfectStreak = 0; pts = award('good'); addSync(C.sync.correct); }
    else if (grade === 'late') { D.streak++; D.perfectStreak = 0; pts = award('late'); addSync(C.sync.late); }
    else { D.streak = 0; D.perfectStreak = 0; addSync(grade === 'wrong' ? C.sync.wrong : C.sync.miss); }
    D.bestStreak = Math.max(D.bestStreak, D.streak);
    H.result(grade, { prompt: p, points: pts });
    if (D.over) return;
    if (D.prompts.every(q => q.resolved)) {
      D.prompts.length = 0;
      D.lastResolveAt = D.t;
      D.nextAt = D.t + gap();
      if (D.level >= 8 && grade !== 'miss' && rng.chance(C.anticipate.chance)) {
        const a = habit();
        if (a) { D.anticipateNext = a; D.nextAt = D.t + C.anticipate.lead + rng.range(0, 0.15); H.reflect(a, 'tell'); }
      }
    }
  }
  function penalise(grade, v) {
    D.streak = 0; D.perfectStreak = 0;
    addSync(v);
    H.result(grade, { points: 0 });
  }

  // ---------- the player ----------
  D.input = function (a) {
    if (D.over || ACTIONS.indexOf(a) < 0) return null;
    const t = D.t;
    const since = t - D.lastInputAt;
    D.lastInputAt = t;
    if (!D.leading()) {
      D.follows.push({ action: a, at: t + D.followDelay(t) });
      // no reward for mashing: a change of action, or a deliberate repeat
      if (since > 0.3 && (a !== D.lastFollow || since > 1.2)) { D.score += C.score.follow; H.result('follow', { points: C.score.follow }); }
      D.lastFollow = a;
      return 'follow';
    }
    const p = D.prompts.find(q => !q.resolved);
    if (p && t >= p.t0 - 0.08) {
      D.habits[a]++;
      if (a !== p.action) { resolve(p, 'wrong'); return 'wrong'; }
      const dt = Math.max(0, t - p.cueAt), w = D.windows();
      const g = dt <= w.perfect ? 'perfect' : dt <= w.good ? 'good' : 'late';
      resolve(p, g);
      return g;
    }
    if (D.feint && t <= D.feint.until + 0.35) { const f = D.feint; D.feint = null; penalise('fooled', C.sync.fooled); f.taken = true; return 'fooled'; }
    if (t - D.lastHitAt < C.doubleTap) return null;
    if (p) return null; // pressed before the next move of a sequence began
    if (D.promptCount === 0) return null; // the first lead is still arriving
    penalise('stray', C.sync.stray);
    return 'stray';
  };

  // ---------- time ----------
  D.update = function (dt) {
    if (D.over) return;
    D.t += dt;
    const t = D.t;
    const lv = D.levelAt(t);
    if (lv !== D.level) { D.level = lv; H.level(lv); }
    const ph = t < C.initiativeAt ? 1 : t < C.intruderAt ? 2 : 3;
    if (ph !== D.phase) { D.phase = ph; H.phase(ph); if (ph === 2) D.nextAt = t + 0.6; }
    if (!D.survived && t >= C.survivalAt) { D.survived = true; H.milestone('survived'); }
    D.score += C.score.perSecond * levelMult() * dt;
    // copies still queued when the reflection takes over play out anyway
    while (D.follows.length && D.follows[0].at <= t) { const f = D.follows.shift(); D.reflPose = f.action === 'jump' ? 'stand' : f.action; H.reflect(f.action, 'follow'); }
    if (D.feint && t > D.feint.until + 0.35) D.feint = null;
    if (D.leading()) {
      for (const p of D.prompts) {
        if (!p.started && t >= p.t0) {
          p.started = true;
          H.reflect(p.action, p.repeat ? 'repeat' : 'lead');
          D.reflPose = p.action === 'jump' ? 'stand' : p.action;
        }
        if (p.started && !p.cued && t >= p.cueAt) { p.cued = true; H.cue(p); }
      }
      for (const p of D.prompts) if (!p.resolved && t > p.deadline) { resolve(p, 'miss'); if (D.over) return; }
      if (!D.prompts.length && t >= D.nextAt && !D.follows.length) plan();
    }
  };
  D.pending = () => D.prompts.find(q => !q.resolved && q.started) || null;
  return D;
}
