// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// THE REFLECTION — a 3D psychological horror arcade for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_config.js ----
// =====================================================================
// THE REFLECTION — tuning. Every gameplay number lives here.
// Time is game time in seconds from the first frame of the run.
// =====================================================================

const ACTIONS = ['sit', 'stand', 'crouch', 'paw', 'jump'];
const ACTION_LABEL = { sit: 'SIT', stand: 'STAND', crouch: 'CROUCH', paw: 'PAW UP', jump: 'JUMP' };

const CONFIG = {
  // Phase 1: the reflection copies the player after a delay that stretches out.
  follow: { delayStart: 0.30, delayEnd: 1.0, until: 20 },
  // When the reflection stops copying and starts leading. Phases overlap, never pause.
  initiativeAt: 20,
  intruderAt: 45,
  survivalAt: 80,
  // reflection begins moving at t0; the response timer starts cueLead later
  cueLead: 0.12,
  windows: { perfect: 0.5, good: 0.9, miss: 1.2 },
  // inputs this soon after a resolved prompt are treated as a double tap and ignored
  doubleTap: 0.22,
  sync: { start: 100, correct: 5, perfect: 10, late: 2, wrong: -12, miss: -15, stray: -4, fooled: -6 },
  states: [ { min: 75, name: 'STABLE' }, { min: 45, name: 'UNSTABLE' }, { min: 20, name: 'CRITICAL' }, { min: 0, name: 'CRITICAL' } ],
  score: { follow: 10, good: 100, perfect: 200, late: 25, perSecond: 10, comboStep: 0.2, comboMax: 3 },
  // Difficulty is behaviour first, speed second. Levels arrive on a clock and
  // past 80 s the escalation keeps going, slowly, with floors so it stays fair.
  levels: [
    { at: 0,  name: 'copies' },
    { at: 8,  name: 'lags' },
    { at: 20, name: 'leads' },
    { at: 28, name: 'reorders' },
    { at: 36, name: 'repeats' },
    { at: 45, name: 'hurries' },
    { at: 53, name: 'feints' },
    { at: 63, name: 'anticipates' }
  ],
  endlessEvery: 20,        // after the last level, one more step every N seconds
  gap: { start: 1.15, floor: 0.45 },              // pause between prompts
  windowScale: { l6: 0.88, perEndless: 0.035, floor: 0.68 },
  feint: { chance: 0.22, chanceMax: 0.34, dur: 0.42 },
  pair: { from: 58, chance: 0.3, chanceMax: 0.55, spacing: 0.5 },
  triple: { from: 100, chance: 0.18 },
  anticipate: { chance: 0.3, lead: 0.28 },
  hintPrompts: 5           // early prompts light the matching button, then the hint goes
};

// ---- 01_util.js ----
// =====================================================================
// Shared helpers.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) * (1 - t);

function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  return r;
}

// ---- 02_director.js ----
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

function createDirector(hooks, seed, tune) {
  // creator tuning reshapes a copy of the config for this run only
  tune = tune || {};
  const C = Object.assign({}, CONFIG);
  const shift = (tune.takeover || CONFIG.initiativeAt) - CONFIG.initiativeAt;
  if (shift) {
    C.initiativeAt = CONFIG.initiativeAt + shift; C.follow = Object.assign({}, CONFIG.follow, { until: CONFIG.follow.until + shift });
    C.levels = CONFIG.levels.map((l, i) => i < 2 ? (i === 1 ? { at: Math.min(l.at, C.initiativeAt - 2), name: l.name } : l) : { at: l.at + shift, name: l.name });
    C.intruderAt = CONFIG.intruderAt + shift; C.survivalAt = CONFIG.survivalAt + shift;
    C.pair = Object.assign({}, CONFIG.pair, { from: CONFIG.pair.from + shift }); C.triple = Object.assign({}, CONFIG.triple, { from: CONFIG.triple.from + shift });
  }
  if (tune.window) C.windows = { perfect: CONFIG.windows.perfect * tune.window, good: CONFIG.windows.good * tune.window, miss: CONFIG.windows.miss * tune.window };
  if (tune.feint !== undefined) C.feint = Object.assign({}, CONFIG.feint, { chance: CONFIG.feint.chance * tune.feint, chanceMax: CONFIG.feint.chanceMax * tune.feint });
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
  D.config = C;
  return D;
}

// ---- 03_room.js ----
// =====================================================================
// The room. Built twice from the same function: once for the real side,
// once inside a z-mirrored group that the mirror shows. The mirror wall
// and the mirror itself exist only on the real side.
// Room: x in [-W, W], z in [0, D], y up. The glass is the plane z = 0.
// =====================================================================

const ROOM = { W: 2.7, D: 5.6, H: 3.3, wall: -0.06 };
const PAL = { char: '#100e0d', brown: '#3b2a1f', bronze: '#7a5c34', grey: '#5d5b58', amber: '#ffb15c', moon: '#9fb4d0' };

// Textures are painted on one SDK scratch surface (ctx.createCanvas2D) and
// copied into DataTextures, so the Bit never creates raw canvas elements.
function createTextures(THREE, maxAniso, scratch) {
  const T = {};
  const cv = (w, h) => {
    scratch.width = w; scratch.height = h;
    const g = scratch.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
    return [scratch, g];
  };
  // snapshot the scratch pixels, flipped so row 0 is the bottom like a canvas texture
  const snap = c => {
    const w = c.width, h = c.height, src = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h * 4), row = w * 4;
    for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  const tex = (c, rep, srgb) => { const t = snap(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const rng = makeRng(11);
  // dark floorboards, 8 planks per tile, grain, gaps and wear
  {
    const [c, g] = cv(1024, 1024);
    const n = 8, pw = 1024 / n;
    for (let i = 0; i < n; i++) {
      let y0 = 0;
      while (y0 < 1024) {
        const len = 300 + rng() * 500;
        const l = 13 + rng() * 6, h = 22 + rng() * 6;
        g.fillStyle = `hsl(${h},${28 + rng() * 10}%,${l}%)`; g.fillRect(i * pw, y0, pw, len);
        for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(${rng() < 0.5 ? '10,6,4' : '70,50,36'},${0.08 + rng() * 0.12})`; g.lineWidth = 1 + rng() * 2; g.beginPath(); const x = i * pw + rng() * pw; g.moveTo(x, y0); g.bezierCurveTo(x + (rng() - 0.5) * 12, y0 + len * 0.3, x + (rng() - 0.5) * 12, y0 + len * 0.7, x + (rng() - 0.5) * 6, y0 + len); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(i * pw, y0 + len - 2, pw, 3);
        y0 += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(i * pw, 0, 3, 1024);
    }
    for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(120,100,80,${rng() * 0.05})`; g.beginPath(); g.ellipse(rng() * 1024, rng() * 1024, 20 + rng() * 120, 10 + rng() * 60, rng() * 3, 0, TAU); g.fill(); }
    T.floor = tex(c, [2.4, 2.4]);
  }
  // aged wallpaper: a faded damask over stripes, with water stains and grime
  {
    const [c, g] = cv(512, 512);
    g.fillStyle = '#2e2924'; g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64) { g.fillStyle = 'rgba(70,60,48,0.25)'; g.fillRect(x + 28, 0, 8, 512); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, 512); }
    // a faded trellis with small sprigs, slightly irregular as if hand-printed
    g.strokeStyle = 'rgba(96,82,62,0.2)'; g.lineWidth = 2;
    for (let i = -4; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 512, 512); g.stroke(); g.beginPath(); g.moveTo(i * 64 + 512, 0); g.lineTo(i * 64, 512); g.stroke(); }
    for (let y = 32; y < 512; y += 64) for (let x = (y / 64) % 2 ? 0 : 32; x < 512; x += 64) {
      g.fillStyle = 'rgba(104,88,64,0.22)';
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.785; g.beginPath(); g.ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 6, 2.6, a, 0, TAU); g.fill(); }
      g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill();
    }
    for (let k = 0; k < 9000; k++) { const v = rng(); g.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '90,80,64'},${rng() * 0.08})`; g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 2, 1 + rng() * 3); }
    T.paper = tex(c, [1, 1]);
    // stains are painted on a separate, unrepeated layer so they don't tile
    const [s, sg] = cv(1024, 512);
    sg.fillStyle = '#fff'; sg.fillRect(0, 0, 1024, 512);
    for (let k = 0; k < 14; k++) {
      const x = rng() * 1024, y = rng() * 260, r = 30 + rng() * 140;
      const gr = sg.createRadialGradient(x, y, 0, x, y + r * 0.6, r * 1.4);
      gr.addColorStop(0, 'rgba(120,100,80,0.0)'); gr.addColorStop(0.7, 'rgba(110,90,70,0.35)'); gr.addColorStop(0.75, 'rgba(70,55,40,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = gr; sg.beginPath(); sg.ellipse(x, y + r * 0.6, r, r * 1.6, 0, 0, TAU); sg.fill();
    }
    const fade = sg.createLinearGradient(0, 0, 0, 512); fade.addColorStop(0, 'rgba(40,30,20,0.55)'); fade.addColorStop(0.2, 'rgba(255,255,255,0)'); fade.addColorStop(0.85, 'rgba(255,255,255,0)'); fade.addColorStop(1, 'rgba(30,20,10,0.6)');
    sg.fillStyle = fade; sg.fillRect(0, 0, 1024, 512);
    T.stain = tex(s, [1, 1]); T.stain.wrapS = T.stain.wrapT = THREE.ClampToEdgeWrapping;
  }
  // panelled wainscot
  {
    const [c, g] = cv(512, 256);
    g.fillStyle = '#1d1511'; g.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 128) {
      g.fillStyle = '#271c16'; g.fillRect(x + 14, 30, 100, 196);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.strokeRect(x + 14, 30, 100, 196);
      g.strokeStyle = 'rgba(120,90,60,0.18)'; g.lineWidth = 2; g.strokeRect(x + 18, 34, 92, 188);
    }
    for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(0,0,0,${rng() * 0.15})`; g.beginPath(); const y = rng() * 256; g.moveTo(0, y); g.lineTo(512, y + (rng() - 0.5) * 6); g.stroke(); }
    g.fillStyle = '#120d0a'; g.fillRect(0, 0, 512, 14);
    T.wains = tex(c, [1, 1]);
  }
  // patina for bronze: roughness variation
  {
    const [c, g] = cv(256, 256);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 3000; k++) { const v = Math.floor(rng() * 255); g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.beginPath(); g.arc(rng() * 256, rng() * 256, 1 + rng() * 6, 0, TAU); g.fill(); }
    T.patina = tex(c, [2, 2], false);
  }
  const radial = (stops, size) => { const [c, g] = cv(size || 128, size || 128); const s = (size || 128) / 2; const gr = g.createRadialGradient(s, s, 0, s, s, s); for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, s * 2, s * 2); const t = snap(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  T.glow = radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  T.shadow = radial([[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  T.flame = (() => { const [c, g] = cv(64, 128); const gr = g.createRadialGradient(32, 92, 2, 32, 80, 50); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.95)'); gr.addColorStop(0.6, 'rgba(230,110,30,0.35)'); gr.addColorStop(1, 'rgba(120,40,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(52, 50, 54, 92, 32, 120); g.bezierCurveTo(10, 92, 12, 50, 32, 4); g.fill(); const t = snap(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  T.beam = (() => { const [c, g] = cv(64, 256); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.3, 'rgba(0,0,0,0)'); h.addColorStop(0.7, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256); return snap(c); })();
  return T;
}

function createRoomMaterials(THREE, T) {
  const M = {};
  M.floor = new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.62, metalness: 0, bumpMap: T.floor, bumpScale: 0.6 });
  M.paper = new THREE.MeshStandardMaterial({ map: T.paper, roughness: 0.92, bumpMap: T.paper, bumpScale: 0.4 });
  M.wains = new THREE.MeshStandardMaterial({ map: T.wains, roughness: 0.7, bumpMap: T.wains, bumpScale: 0.8 });
  M.wood = new THREE.MeshStandardMaterial({ color: '#2a1d15', roughness: 0.55 });
  M.darkWood = new THREE.MeshStandardMaterial({ color: '#170f0b', roughness: 0.6 });
  M.bronze = new THREE.MeshStandardMaterial({ color: '#7a5c34', metalness: 0.85, roughness: 0.55, roughnessMap: T.patina });
  M.bronzeDark = new THREE.MeshStandardMaterial({ color: '#4c3820', metalness: 0.8, roughness: 0.55, roughnessMap: T.patina });
  M.velvet = new THREE.MeshPhysicalMaterial({ color: '#2b1a17', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#6e4a3c'), sheenRoughness: 0.5 });
  M.wax = new THREE.MeshStandardMaterial({ color: '#d9cdb4', roughness: 0.55, emissive: new THREE.Color('#5a3a10'), emissiveIntensity: 0.35 });
  M.ceiling = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 });
  M.night = new THREE.MeshBasicMaterial({ color: '#1b2536' });
  M.glassPane = new THREE.MeshBasicMaterial({ color: '#9fb4d0', transparent: true, opacity: 0.06, depthWrite: false });
  M.book = ['#3a1f1a', '#25281f', '#2e2a22', '#1f1c24'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  M.paperEdge = new THREE.MeshStandardMaterial({ color: '#8a7f6a', roughness: 0.9 });
  M.cloth = new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.95, side: THREE.DoubleSide });
  return M;
}

// the window opening on the left wall (z range, y range)
const WIN = { z0: 1.0, z1: 2.3, y0: 1.05, y1: 2.55 };

function buildRoom(THREE, T, M, side, small) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, o) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (o && o.ry) m.rotation.y = o.ry; if (o && o.rx) m.rotation.x = o.rx; if (o && o.rz) m.rotation.z = o.rz;
    m.castShadow = !(o && o.noCast); m.receiveShadow = true; (o && o.parent || g).add(m); return m;
  };
  const { W, D, H } = ROOM;
  // floor
  const floor = add(new THREE.PlaneGeometry(W * 2, D - ROOM.wall), M.floor, 0, 0, (D + ROOM.wall) / 2, { rx: -Math.PI / 2, noCast: true });
  floor.material.map.repeat.set(W * 2 / 2.2, (D - ROOM.wall) / 2.2);
  add(new THREE.PlaneGeometry(W * 2, D), M.ceiling, 0, H, D / 2, { rx: Math.PI / 2, noCast: true });
  // walls: wallpaper above a panelled wainscot, with a dado rail and skirting
  const wall = (len, cx, cz, ry, holes) => {
    const shape = new THREE.Shape(); shape.moveTo(-len / 2, 0); shape.lineTo(len / 2, 0); shape.lineTo(len / 2, H); shape.lineTo(-len / 2, H); shape.lineTo(-len / 2, 0);
    for (const h of holes || []) { const p = new THREE.Path(); p.moveTo(h[0], h[1]); p.lineTo(h[0], h[3]); p.lineTo(h[2], h[3]); p.lineTo(h[2], h[1]); p.lineTo(h[0], h[1]); shape.holes.push(p); }
    const geo = new THREE.ShapeGeometry(shape);
    // uv in metres so the paper tiles at a real scale
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.85, uv.getY(i) / 0.85);
    const m = add(geo, M.paper, cx, 0, cz, { ry });
    const st = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshBasicMaterial({ map: T.stain, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false }));
    st.position.set(cx, H / 2, cz); st.rotation.y = ry; st.translateZ(0.002); g.add(st);
    const wa = new THREE.Mesh(new THREE.BoxGeometry(len, 0.92, 0.03), M.wains); wa.position.set(cx, 0.46, cz); wa.rotation.y = ry; wa.translateZ(0.015); wa.receiveShadow = true; wa.castShadow = true; g.add(wa);
    wa.material.map.repeat.set(len / 1.4, 1);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), M.darkWood); rail.position.set(cx, 0.93, cz); rail.rotation.y = ry; rail.translateZ(0.03); rail.castShadow = rail.receiveShadow = true; g.add(rail);
    const cor = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.06), M.darkWood); cor.position.set(cx, H - 0.06, cz); cor.rotation.y = ry; cor.translateZ(0.03); g.add(cor);
    return m;
  };
  if (side === 'real') wall(W * 2, 0, ROOM.wall, 0);
  // left wall carries the window: shape x runs along +z when rotated
  wall(D, -W, D / 2, Math.PI / 2, [[WIN.z0 - D / 2, WIN.y0, WIN.z1 - D / 2, WIN.y1].map((v, i) => (i % 2 === 0 ? -v : v))].map(h => [Math.min(h[0], h[2]), h[1], Math.max(h[0], h[2]), h[3]]));
  wall(D, W, D / 2, -Math.PI / 2);
  wall(W * 2, 0, D, Math.PI);
  // window: frame, mullions and the night outside
  {
    const wz = (WIN.z0 + WIN.z1) / 2, wy = (WIN.y0 + WIN.y1) / 2, ww = WIN.z1 - WIN.z0, wh = WIN.y1 - WIN.y0;
    const fr = (w, h, d, x, y, z) => add(new THREE.BoxGeometry(w, h, d), M.darkWood, x, y, z);
    fr(0.14, 0.07, ww + 0.14, -W + 0.02, WIN.y0 - 0.03, wz); fr(0.1, 0.06, ww + 0.1, -W + 0.01, WIN.y1 + 0.03, wz);
    fr(0.1, wh + 0.1, 0.06, -W + 0.01, wy, WIN.z0 - 0.03); fr(0.1, wh + 0.1, 0.06, -W + 0.01, wy, WIN.z1 + 0.03);
    fr(0.05, wh, 0.035, -W - 0.02, wy, wz); fr(0.05, 0.035, ww, -W - 0.02, wy + 0.12, wz); fr(0.05, 0.035, ww, -W - 0.02, wy - 0.38, wz);
    const night = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), M.night); night.position.set(-W - 0.35, wy, wz); night.rotation.y = Math.PI / 2; g.add(night);
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), new THREE.MeshBasicMaterial({ color: '#c9d6e6' })); moonDisc.position.set(-W - 0.33, wy + 0.42, wz - 0.25); moonDisc.rotation.y = Math.PI / 2; g.add(moonDisc);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), M.glassPane); pane.position.set(-W - 0.02, wy, wz); pane.rotation.y = Math.PI / 2; g.add(pane);
    // a torn curtain, hanging still
    const cg = new THREE.PlaneGeometry(0.42, wh + 0.4, 6, 12); const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, Math.sin(x * 22) * 0.025 + Math.sin(y * 3 + x * 9) * 0.01); }
    cg.computeVertexNormals();
    const cur = add(cg, M.cloth, -W + 0.08, wy + 0.1, WIN.z1 + 0.18, { ry: Math.PI / 2 }); cur.castShadow = true;
  }
  // furniture: a side table with a candle, an armchair, a few books
  const candle = {};
  {
    const tx = -1.2, tz = 0.62;
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 28), M.wood, tx, 0.68, tz);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 28), M.darkWood, tx, 0.635, tz);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4; const leg = add(new THREE.CylinderGeometry(0.018, 0.012, 0.64, 8), M.darkWood, tx + Math.cos(a) * 0.17, 0.32, tz + Math.sin(a) * 0.17); leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); }
    add(new THREE.CylinderGeometry(0.07, 0.05, 0.015, 20), M.bronze, tx + 0.05, 0.705, tz);
    add(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 12), M.bronze, tx + 0.05, 0.735, tz);
    const wax = add(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 14), M.wax, tx + 0.05, 0.83, tz);
    for (let i = 0; i < 4; i++) { const a = i * 1.7; const d = add(new THREE.SphereGeometry(0.008, 8, 6), M.wax, tx + 0.05 + Math.cos(a) * 0.022, 0.86 + Math.sin(i * 3) * 0.03, tz + Math.sin(a) * 0.022); d.scale.set(0.8, 2.2, 0.8); }
    void wax;
    candle.pos = [tx + 0.05, 0.935, tz];
    const fm = new THREE.SpriteMaterial({ map: T.flame, color: '#fff2d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    candle.flame = new THREE.Sprite(fm); candle.flame.scale.set(0.035, 0.07, 1); candle.flame.position.set(candle.pos[0], candle.pos[1], candle.pos[2]); g.add(candle.flame);
    const hm = new THREE.SpriteMaterial({ map: T.glow, color: '#ff9a40', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    candle.halo = new THREE.Sprite(hm); candle.halo.scale.set(0.6, 0.6, 1); candle.halo.position.copy(candle.flame.position); g.add(candle.halo);
    // books on the table and the floor
    const book = (x, y, z, w, h, d, ry, i) => { const b = add(new THREE.BoxGeometry(w, h, d), M.book[i % 4], x, y, z, { ry }); add(new THREE.BoxGeometry(w * 0.96, h * 0.8, d * 0.9), M.paperEdge, x, y, z + 0.004, { ry, noCast: true }); return b; };
    book(tx - 0.1, 0.716, tz + 0.05, 0.16, 0.035, 0.22, 0.3, 0); book(tx - 0.11, 0.749, tz + 0.06, 0.14, 0.03, 0.2, 0.15, 1);
    book(1.05, 0.03, 1.55, 0.22, 0.06, 0.3, 0.6, 2); book(1.07, 0.085, 1.52, 0.18, 0.05, 0.26, 0.9, 3); book(1.0, 0.13, 1.56, 0.17, 0.04, 0.24, 0.4, 0);
  }
  {
    // armchair, angled toward the mirror, its velvet worn
    const ch = new THREE.Group(); ch.position.set(1.75, 0, 1.05); ch.rotation.y = -0.75; g.add(ch);
    const p = { parent: ch };
    add(new THREE.BoxGeometry(0.72, 0.16, 0.66), M.velvet, 0, 0.42, 0, p);
    add(new THREE.BoxGeometry(0.76, 0.2, 0.7), M.darkWood, 0, 0.27, 0, p);
    const back = add(new THREE.BoxGeometry(0.72, 0.78, 0.14), M.velvet, 0, 0.8, -0.3, p); back.rotation.x = -0.12;
    add(new THREE.BoxGeometry(0.12, 0.26, 0.64), M.velvet, -0.36, 0.56, 0.02, p); add(new THREE.BoxGeometry(0.12, 0.26, 0.64), M.velvet, 0.36, 0.56, 0.02, p);
    for (const [x, z] of [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]]) add(new THREE.CylinderGeometry(0.03, 0.02, 0.18, 8), M.darkWood, x, 0.09, z, p);
    // a dust sheet thrown over one arm
    const cg = new THREE.PlaneGeometry(0.5, 0.7, 8, 10); const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, Math.sin(x * 14 + y * 4) * 0.02 - Math.max(0, y) * 0.25); }
    cg.computeVertexNormals();
    const cl = add(cg, M.cloth, 0.38, 0.55, 0.05, { parent: ch, ry: Math.PI / 2 }); cl.rotation.x = -0.2;
  }
  return { group: g, candle };
}

// The mirror: an arched bronze frame with layered mouldings and a crest.
function buildMirror(THREE, M) {
  const g = new THREE.Group();
  const w = 1.42, h = 1.78, rise = 0.3, bottom = 0.14;
  const arch = (inset) => {
    const s = new THREE.Shape(), hw = w / 2 - inset, y0 = bottom + inset, y1 = bottom + h - inset * 0.5;
    const r = rise - inset * 0.3;
    s.moveTo(-hw, y0); s.lineTo(hw, y0); s.lineTo(hw, y1);
    s.quadraticCurveTo(hw * 0.55, y1 + r * 0.95, 0, y1 + r); s.quadraticCurveTo(-hw * 0.55, y1 + r * 0.95, -hw, y1); s.lineTo(-hw, y0);
    return s;
  };
  const ring = (outer, inner, depth, bevel, mat, z) => {
    const s = arch(outer); s.holes.push(arch(inner));
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
    const m = new THREE.Mesh(geo, mat); m.position.z = z; m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  ring(-0.17, -0.02, 0.05, 0.025, M.bronzeDark, -0.05);
  ring(-0.12, 0.0, 0.06, 0.02, M.bronze, -0.02);
  ring(-0.02, 0.035, 0.03, 0.012, M.bronze, 0.02);
  // the glass shape, so the shader knows the opening
  const glassShape = arch(0.03);
  // crest: scrolls and a finial
  const crestY = bottom + h + rise + 0.12;
  const tor = new THREE.TorusGeometry(0.07, 0.016, 8, 20, Math.PI * 1.4);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(tor, M.bronze); t.position.set(0.12 * s, crestY - 0.02, 0.04); t.rotation.z = s > 0 ? 2.2 : 0.95 - Math.PI * 0.4 + Math.PI; t.castShadow = true; g.add(t);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16, Math.PI * 1.5), M.bronze); t2.position.set(0.25 * s, crestY - 0.08, 0.035); t2.rotation.z = s > 0 ? 3.6 : -0.5; g.add(t2);
    // side rosettes and feet
    const ro = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), M.bronze); ro.scale.z = 0.45; ro.position.set((w / 2 + 0.13) * s, bottom + h * 0.55, 0.04); g.add(ro);
  }
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), M.bronze); fin.position.set(0, crestY + 0.04, 0.04); fin.scale.set(0.8, 1.2, 0.6); g.add(fin);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.bronze); shell.scale.set(1.1, 0.9, 0.3); shell.position.set(0, crestY - 0.08, 0.03); g.add(shell);
  // a cheval stand: the glass swings forward between two turned posts
  const pivotY = bottom + (h + rise) * 0.5;
  const stand = new THREE.Group();
  for (const s of [-1, 1]) {
    const x = (w / 2 + 0.2) * s;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, pivotY + 0.12, 12), M.wood); post.position.set(x, (pivotY + 0.12) / 2, 0); post.castShadow = post.receiveShadow = true; stand.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.bronze); cap.position.set(x, pivotY + 0.15, 0); stand.add(cap);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 14), M.bronze); knob.rotation.z = Math.PI / 2; knob.position.set(x - 0.06 * s, pivotY, 0); stand.add(knob);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.6), M.wood); foot.position.set(x, 0.025, 0.02); foot.castShadow = foot.receiveShadow = true; stand.add(foot);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, w + 0.4, 10), M.wood); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.12, -0.2); stand.add(bar);
  return { group: g, stand, pivotY, glassShape, rect: { x0: -w / 2, x1: w / 2, y0: bottom, y1: bottom + h + rise } };
}

// Dust motes: one geometry, shown in both rooms so the reflection matches.
function createDust(THREE, T, n) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), seed = new Float32Array(n);
  const r = makeRng(5);
  for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 4.6; p[i * 3 + 1] = r() * 2.8; p[i * 3 + 2] = 0.1 + r() * 4.2; seed[i] = r() * 100; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: '#d8c8b0', size: 0.012, map: T.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  return {
    geo, mat,
    update(t, dt) {
      for (let i = 0; i < n; i++) {
        const s = seed[i];
        p[i * 3] += Math.sin(t * 0.13 + s) * 0.0009;
        p[i * 3 + 1] += (Math.sin(t * 0.21 + s * 1.7) * 0.0006 - 0.00025);
        p[i * 3 + 2] += Math.cos(t * 0.11 + s * 0.6) * 0.0007;
        if (p[i * 3 + 1] < 0.02) p[i * 3 + 1] = 2.8;
      }
      geo.attributes.position.needsUpdate = true;
    }
  };
}

// ---- 04_cat.js ----
// =====================================================================
// The cat: a procedural rig. Cat-local axes: +z forward, +y up, +x right.
// The spine runs hip -> shoulder; legs are two-bone IK chains solved in the
// cat's sagittal plane toward foot targets, so every pose stays grounded.
// Each cat owns its own controller: the reflection never reads the real
// cat's state, it is driven only by the director.
// =====================================================================

const SPINE = 0.2, FRONT = [0.105, 0.105], HIND = [0.1, 0.112], NECK = 0.1;

// Poses are targets, not keyframes: the controller springs toward them.
const POSES = {
  stand:  { hz: -0.1,  hy: 0.19,  pitch: 0.02, neck: 1.0,  hp: 0.05, ffl: [0.1, 0],   ffr: [0.1, 0],   hfl: [-0.11, 0], hfr: [-0.11, 0], tLift: 1.0,  tCurl: -1.5, tSide: 0.25, ears: 0,   haunch: 0 },
  sit:    { hz: -0.07, hy: 0.068, pitch: 0.8,  neck: 1.38, hp: 0.02, ffl: [0.075, 0], ffr: [0.075, 0], hfl: [0.0, 0],   hfr: [0.0, 0],   tLift: -0.35, tCurl: 0.5, tSide: 1.5, ears: 0,   haunch: 1 },
  crouch: { hz: -0.09, hy: 0.1,   pitch: -0.06, neck: 0.32, hp: -0.12, ffl: [0.15, 0], ffr: [0.15, 0],  hfl: [-0.05, 0], hfr: [-0.05, 0], tLift: -0.12, tCurl: 0.15, tSide: 0, ears: 0.65, haunch: 0.45 },
  paw:    { hz: -0.07, hy: 0.075, pitch: 0.86, neck: 1.36, hp: 0.32, ffl: [0.08, 0],  ffr: [0.15, 0.25], hfl: [0.0, 0], hfr: [0.0, 0], tLift: -0.25, tCurl: 0.4, tSide: 1.2, ears: 0.1, haunch: 1, roll: 0.25, pawX: 0.05 }
};
const KEYS = ['hz', 'hy', 'pitch', 'neck', 'hp', 'tLift', 'tCurl', 'tSide', 'ears', 'haunch', 'roll', 'pawX'];
const FEET = ['ffl', 'ffr', 'hfl', 'hfr'];
function blendPose(a, b, t) {
  const o = {};
  for (const k of KEYS) o[k] = lerp(a[k] || 0, b[k] || 0, t);
  for (const k of FEET) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  return o;
}
const clonePose = p => blendPose(p, p, 0);

// two-bone IK in the (z, y) plane. bend +1 puts the middle joint forward.
function ik2(az, ay, tz, ty, l1, l2, bend) {
  let dz = tz - az, dy = ty - ay, d = Math.hypot(dz, dy);
  const dmax = l1 + l2 - 1e-4, dmin = Math.abs(l1 - l2) + 1e-3;
  if (d > dmax) { dz *= dmax / d; dy *= dmax / d; d = dmax; }
  if (d < dmin) { d = dmin; }
  const a = Math.atan2(dy, dz);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ka = a + bend * A;
  const kz = az + Math.cos(ka) * l1, ky = ay + Math.sin(ka) * l1;
  return [kz, ky, az + dz, ay + dy];
}

function createCatMaterials(THREE) {
  const fur = new THREE.MeshPhysicalMaterial({ color: '#0c0a0a', roughness: 0.8, metalness: 0, sheen: 0.7, sheenColor: new THREE.Color('#54483f'), sheenRoughness: 0.5 });
  const furDark = new THREE.MeshPhysicalMaterial({ color: '#080707', roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color('#3c332d'), sheenRoughness: 0.6 });
  const nose = new THREE.MeshStandardMaterial({ color: '#2a1a1b', roughness: 0.5 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#030303', roughness: 0.2 });
  const whisker = new THREE.LineBasicMaterial({ color: '#8f877d', transparent: true, opacity: 0.55 });
  const earIn = new THREE.MeshStandardMaterial({ color: '#2b1f20', roughness: 0.9, side: THREE.DoubleSide });
  return { fur, furDark, nose, pupil, whisker, earIn };
}

function createCat(THREE, M, opts) {
  opts = opts || {};
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#b98a2e', emissive: new THREE.Color(opts.eyeGlow || '#6b4a10'), emissiveIntensity: opts.eyeIntensity || 0.35, roughness: 0.15 });
  const meshes = [];
  const add = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; (parent || rig).add(m); meshes.push(m); return m; };
  const sph = new THREE.SphereGeometry(1, 20, 14);
  const torso = add(sph, M.fur), chest = add(sph, M.fur), haunchL = add(sph, M.fur), haunchR = add(sph, M.fur);
  const neck = add(new THREE.CapsuleGeometry(0.036, 0.06, 4, 10), M.fur);
  // legs
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 8);
  const leg = (r1, l1, r2, l2) => ({ a: add(cap(r1, l1), M.fur), b: add(cap(r2, l2), M.furDark), paw: add(sph, M.furDark) });
  const legs = { ffl: leg(0.017, FRONT[0], 0.014, FRONT[1]), ffr: leg(0.017, FRONT[0], 0.014, FRONT[1]), hfl: leg(0.026, HIND[0], 0.015, HIND[1]), hfr: leg(0.026, HIND[0], 0.015, HIND[1]) };
  // head
  const head = new THREE.Group(); rig.add(head);
  const skull = add(sph, M.fur, head); skull.scale.set(0.052, 0.046, 0.05);
  const cheeks = add(sph, M.fur, head); cheeks.scale.set(0.05, 0.032, 0.036); cheeks.position.set(0, -0.016, 0.014);
  const muzzle = add(sph, M.fur, head); muzzle.scale.set(0.026, 0.018, 0.02); muzzle.position.set(0, -0.022, 0.04);
  const noseM = add(sph, M.nose, head); noseM.scale.set(0.008, 0.005, 0.005); noseM.position.set(0, -0.012, 0.058);
  const earGeo = new THREE.ConeGeometry(0.022, 0.05, 4, 1); earGeo.translate(0, 0.025, 0);
  const earInGeo = new THREE.ConeGeometry(0.014, 0.036, 3, 1, true); earInGeo.translate(0, 0.02, 0.004);
  const ears = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.028 * s, 0.034, -0.006); head.add(g);
    const e = add(earGeo, M.fur, g); e.scale.set(1, 1, 0.55);
    const ei = add(earInGeo, M.earIn, g); ei.scale.set(1, 1, 0.5);
    return { g, s, twitch: 0 };
  });
  const eyes = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.021 * s, 0.004, 0.04); g.rotation.y = 0.32 * s; head.add(g);
    const ball = add(sph, eyeMat, g); ball.scale.set(0.0125, 0.011, 0.007); ball.castShadow = false;
    const pu = add(sph, M.pupil, g); pu.scale.set(0.0028, 0.0095, 0.002); pu.position.z = 0.0058; pu.castShadow = false;
    return { g, pu };
  });
  {
    const pts = [];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const y = -0.02 - i * 0.004; pts.push(0.014 * s, y, 0.05, (0.075 + i * 0.004) * s, y + 0.008 - i * 0.008, 0.035 - i * 0.01); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    head.add(new THREE.LineSegments(g, M.whisker));
  }
  // tail: a chain of overlapping spheres
  const TN = 22, TSEG = 0.0142;
  const tail = [];
  for (let i = 0; i < TN; i++) { const m = add(sph, i > TN - 4 ? M.furDark : M.fur); const r = lerp(0.017, 0.0095, i / (TN - 1)); m.scale.set(r, r, r); tail.push(m); }
  // soft contact shadow, kept off the rig so jumps lift away from it
  const shadowTex = opts.shadowTex;
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.003; root.add(blob);

  // ---------- controller state ----------
  const C = {
    root, rig, head, meshes, eyeMat,
    base: 'stand', cur: clonePose(POSES.stand), target: clonePose(POSES.stand),
    k: opts.k || 15, jump: -1, jumpLen: 0.82, after: null, feint: 0, feintPose: null, dip: 0, tell: 0, shiver: 0,
    look: { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, hold: 0 },
    blink: 0, nextBlink: 1 + Math.random() * 3, stare: 0, walk: 0, walkPhase: 0, t: Math.random() * 10,
    rootY: 0, flinch: 0, intent: 0, busyUntil: 0, onStep: null
  };
  const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  function placeSeg(m, x1, y1, z1, x2, y2, z2) {
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    _d.set(x2 - x1, y2 - y1, z2 - z1).normalize();
    m.quaternion.setFromUnitVectors(_up, _d);
  }

  // ---------- actions ----------
  C.perform = function (a) {
    C.feint = 0;
    if (a === 'jump') {
      if (C.jump >= 0 && C.jump < 0.25) return; // already leaving the ground
      C.jump = 0; C.after = 'stand'; C.onStep && C.onStep('jump');
      return;
    }
    if (C.jump >= 0) { C.after = a; return; }
    if (a === C.base) C.dip = 1; // the same pose again still reads as a move
    C.base = a; C.onStep && C.onStep(a);
  };
  C.feintTo = function (a, dur) { if (C.jump >= 0) return; C.feintPose = a === 'jump' ? 'crouch' : a; C.feint = dur; C.feintDur = dur; };
  C.tellOf = function () { C.tell = 0.5; for (const e of ears) e.twitch = 1; };
  C.lookAt = function (yaw, pitch, hold) { C.look.tyaw = yaw; C.look.tpitch = pitch; C.look.hold = hold; };

  // the pose the controller wants right now
  function desired(dt) {
    let p = POSES[C.base] || POSES.stand;
    if (C.feint > 0) {
      // a feint commits a third of the way and recoils: no cue, a shudder
      const u = 1 - C.feint / C.feintDur;
      const amt = u < 0.45 ? smooth(u / 0.45) * 0.38 : 0.38 * (1 - smooth((u - 0.45) / 0.55));
      p = blendPose(p, POSES[C.feintPose] || p, amt);
      C.shiver = Math.max(C.shiver, u > 0.4 ? 1 : 0);
      C.feint -= dt;
    } else p = clonePose(p);
    if (C.dip > 0) { const d = Math.sin((1 - C.dip) * Math.PI); p.hy += 0.03 * d; p.pitch -= 0.18 * d; p.neck -= 0.15 * d; C.dip = Math.max(0, C.dip - dt / 0.32); }
    if (C.tell > 0) { const d = Math.sin((1 - C.tell / 0.5) * Math.PI); p.pitch += 0.06 * d; p.hp += 0.12 * d; C.tell -= dt; }
    if (C.jump >= 0) {
      const j = C.jump, L = C.jumpLen;
      const prep = 0.14, air = 0.46;
      const from = POSES[C.base] || POSES.stand;
      if (j < prep) {
        const u = smooth(j / prep);
        p = blendPose(from, POSES.crouch, u * 0.85); p.hy = lerp(from.hy, 0.11, u); C.rootY = 0;
      } else if (j < prep + air) {
        const u = (j - prep) / air;
        C.rootY = 0.3 * Math.sin(Math.PI * u);
        p = clonePose(POSES.stand);
        p.hy = 0.17; p.pitch = lerp(0.42, -0.3, u); p.neck = 0.9;
        p.ffl = [lerp(0.16, 0.13, u), lerp(0.1, -0.02, u)]; p.ffr = [lerp(0.15, 0.13, u), lerp(0.08, -0.02, u)];
        p.hfl = [lerp(-0.22, -0.13, u), lerp(0.06, 0.05, u)]; p.hfr = [lerp(-0.21, -0.12, u), lerp(0.05, 0.04, u)];
        p.tLift = lerp(0.2, 0.9, u); p.tCurl = -0.4; p.ears = 0.3;
      } else {
        const u = (j - prep - air) / (L - prep - air);
        C.rootY = 0; p = clonePose(POSES.stand); p.hy = lerp(0.14, 0.19, smooth(u)); p.pitch = lerp(-0.08, 0.02, u);
      }
      C.jump += dt;
      if (j < prep + air && C.jump >= prep + air) C.onStep && C.onStep('land');
      if (C.jump >= L) { C.jump = -1; C.rootY = 0; C.base = C.after || 'stand'; if (C.after && C.after !== 'stand') C.onStep && C.onStep(C.after); C.after = null; }
      C.k2 = 34;
    } else C.k2 = 0;
    if (C.walk > 0) {
      // escape gait: diagonal pairs, feet lifted on the forward swing
      const s = 0.07, lift = 0.035, ph = C.walkPhase;
      const f = (o, base) => { const a = ph + o * Math.PI; return [base + Math.sin(a) * s, Math.max(0, Math.cos(a)) * lift]; };
      p.ffl = f(0, 0.1); p.ffr = f(1, 0.1); p.hfl = f(1.5, -0.11); p.hfr = f(0.5, -0.11);
      p.hy += Math.sin(ph * 2) * 0.006; p.tLift = 0.7; p.tCurl = -0.6;
    }
    return p;
  }

  C.update = function (dt) {
    C.t += dt;
    const T = desired(dt);
    const k = C.k2 || C.k;
    const P = C.cur;
    for (const key of KEYS) P[key] = damp(P[key] || 0, T[key] || 0, k, dt);
    for (const key of FEET) { P[key][0] = damp(P[key][0], T[key][0], k, dt); P[key][1] = damp(P[key][1], T[key][1], k * 1.2, dt); }
    if (C.walk > 0) for (const key of FEET) { P[key][0] = T[key][0]; P[key][1] = T[key][1]; }
    rig.position.y = C.rootY;
    // breathing and life
    const br = Math.sin(C.t * 2.1) * 0.5 + 0.5;
    const hz = P.hz, hy = P.hy + br * 0.002;
    const sz = hz + Math.cos(P.pitch) * SPINE, sy = hy + Math.sin(P.pitch) * SPINE;
    // torso
    torso.position.set(0, (hy + sy) / 2 - 0.004, (hz + sz) / 2);
    torso.rotation.set(-P.pitch, 0, 0);
    torso.scale.set(0.058 + br * 0.002, 0.064 + br * 0.002 - P.haunch * 0.006, 0.15);
    chest.position.set(0, sy - 0.01, sz + 0.005); chest.scale.set(0.054, 0.066, 0.058);
    const hr = 0.06 + P.haunch * 0.016;
    haunchL.position.set(-0.03, hy - 0.006 + P.haunch * 0.004, hz + 0.004 + P.haunch * 0.01); haunchL.scale.set(0.04 + P.haunch * 0.006, hr, hr * 1.05);
    haunchR.position.set(0.03, haunchL.position.y, haunchL.position.z); haunchR.scale.copy(haunchL.scale);
    // legs
    const shz = sz - 0.005, shy = sy - 0.03, hpz = hz + 0.01, hpy = hy - 0.02;
    const solve = (key, x, az, ay, L, bend) => {
      const f = P[key], s = ik2(az, ay, f[0], f[1] + 0.012, L[0], L[1], bend), lg = legs[key];
      const x0 = key === 'ffr' ? 0.032 : x, xm = (x0 + x) / 2;
      placeSeg(lg.a, x0, ay, az, xm, s[1], s[0]);
      placeSeg(lg.b, xm, s[1], s[0], x, s[3], s[2]);
      lg.paw.position.set(x, s[3] - 0.004, s[2] + 0.008); lg.paw.scale.set(0.018, 0.012, 0.024);
    };
    solve('ffl', -0.032, shz, shy, FRONT, -1); solve('ffr', 0.032 + (P.pawX || 0), shz, shy, FRONT, -1);
    solve('hfl', -0.04, hpz, hpy, HIND, 1); solve('hfr', 0.04, hpz, hpy, HIND, 1);
    // head: blinks, glances, stares
    const L = C.look;
    if (L.hold > 0) L.hold -= dt; else { L.tyaw = 0; L.tpitch = 0; }
    L.yaw = damp(L.yaw, L.tyaw, 6, dt); L.pitch = damp(L.pitch, L.tpitch, 6, dt);
    const nx = sz + Math.cos(P.neck) * NECK * 0.25, ny = sy + 0.03 + Math.sin(P.neck) * NECK * 0.25;
    const hx = sz + Math.cos(P.neck) * NECK, hyy = sy + 0.02 + Math.sin(P.neck) * NECK;
    placeSeg(neck, 0, sy + 0.01, sz, 0, hyy - 0.02, hx - 0.01);
    head.position.set(0, hyy, hx);
    C.shiver = Math.max(0, C.shiver - dt * 3);
    const shv = C.shiver * Math.sin(C.t * 70) * 0.05;
    head.rotation.set(-(P.hp + L.pitch), L.yaw, (P.roll || 0) + shv, 'YXZ');
    for (const e of ears) {
      e.twitch = Math.max(0, e.twitch - dt * 4);
      const tw = Math.sin(e.twitch * 12) * 0.4 * e.twitch;
      e.g.rotation.set(-0.15 - P.ears * 0.9 + tw, 0.25 * e.s * (1 + P.ears), 0.32 * e.s + P.ears * 0.5 * e.s);
    }
    if (Math.random() < dt * 0.15) ears[Math.random() < 0.5 ? 0 : 1].twitch = 1;
    C.nextBlink -= dt;
    if (C.nextBlink <= 0) { C.blink = 1; C.nextBlink = 1.5 + Math.random() * 4; }
    C.blink = Math.max(0, C.blink - dt * 7);
    const lid = C.stare > 0 ? 1 : 1 - Math.sin(C.blink * Math.PI) * 0.92;
    for (const e of eyes) e.g.scale.set(1, lid, 1);
    // tail: base angle back-and-up, curling and swaying along its length
    let ang = Math.PI - P.tLift, side = 0, x = 0, z = hz - 0.07, y = hy + 0.01;
    const sway = Math.sin(C.t * 1.3) * 0.35, sway2 = Math.sin(C.t * 0.7 + 1) * 0.2;
    for (let i = 0; i < TN; i++) {
      const u = i / (TN - 1);
      tail[i].position.set(x, Math.max(0.009, y), z);
      ang += (P.tCurl / TN) * (0.4 + u * 1.4) * -1;
      side += (P.tSide / TN) * (0.6 + u) + (sway + sway2) * 0.06 * u * (1 - P.haunch * 0.7);
      const c = Math.cos(ang);
      z += c * Math.cos(side) * TSEG; x += c * Math.sin(side) * TSEG * (z < hz ? 1 : 1); y += Math.sin(ang) * TSEG;
      if (y < 0.01) { y = 0.01; }
    }
    blob.position.z = (hz + sz) / 2; const bs = 1 - C.rootY * 1.5; blob.scale.set(bs, bs, bs * 1.1); blob.material.opacity = 0.75 * bs;
    // escape gait advances with distance walked
    if (C.walk > 0) C.walkPhase += dt * 9 * C.walk;
  };
  C.reset = function () {
    C.base = 'stand'; C.cur = clonePose(POSES.stand); C.jump = -1; C.after = null; C.feint = 0; C.dip = 0; C.tell = 0; C.shiver = 0;
    C.rootY = 0; C.walk = 0; C.stare = 0; C.look.hold = 0; C.look.tyaw = 0; C.look.tpitch = 0;
  };
  return C;
}

// ---- 05_audio.js ----
// =====================================================================
// Audio. Every sound is procedural and goes through these named hooks, so
// recorded assets can replace any of them later without touching the game.
// The reflection's movements are swelled in (reversed envelope) and sent
// through a dark delay, so it never sounds quite like the real cat.
// =====================================================================

function createAudio(enabled) {
  const A = { ok: false, muted: false };
  let ac, master, wet, mirrorBus, nb, drone, droneGain, airGain, lfo;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.7;
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        // a small wooden room
        const len = Math.floor(ac.sampleRate * 1.6), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
        const conv = ac.createConvolver(); conv.buffer = ir; wet = ac.createGain(); wet.gain.value = 0.35; wet.connect(conv); conv.connect(master);
        // the mirror bus: low-passed, delayed, a little feedback
        mirrorBus = ac.createGain(); const dl = ac.createDelay(1); dl.delayTime.value = 0.13; const fb = ac.createGain(); fb.gain.value = 0.32; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        mirrorBus.connect(lp); lp.connect(master); lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); dl.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // ambience: room tone, a far low drone that tightens as sync falls
        const air = ac.createBufferSource(); air.buffer = nb; air.loop = true; const af = ac.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 380; airGain = ac.createGain(); airGain.gain.value = 0.05; air.connect(af); af.connect(airGain); airGain.connect(master); air.start();
        drone = ac.createOscillator(); drone.type = 'sine'; drone.frequency.value = 49; const d2 = ac.createOscillator(); d2.type = 'sine'; d2.frequency.value = 73.6;
        droneGain = ac.createGain(); droneGain.gain.value = 0.0; drone.connect(droneGain); d2.connect(droneGain); droneGain.connect(master); drone.start(); d2.start();
        lfo = ac.createOscillator(); lfo.frequency.value = 0.08; const lg = ac.createGain(); lg.gain.value = 0.012; lfo.connect(lg); lg.connect(droneGain.gain); lfo.start();
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setMuted = m => { A.muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ac.currentTime, 0.05); };
  function env(g, t, vol, att, dur, reverse) {
    g.gain.setValueAtTime(0.0001, t);
    if (reverse) { g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    else { g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  }
  function route(node, bus, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; node.connect(p); n = p; }
    n.connect(bus || master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, o) {
    o = o || {}; if (!A.ok) return;
    const t = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    const g = ac.createGain(); env(g, t, o.vol || 0.05, o.att || 0.01, dur, o.reverse);
    osc.connect(g); route(g, o.bus, o.rev === undefined ? 0.3 : o.rev, o.pan); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(dur, o) {
    o = o || {}; if (!A.ok) return;
    const t = ac.currentTime + (o.delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(o.f || 1000, t); fl.Q.value = o.q || 1;
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = ac.createGain(); env(g, t, o.vol || 0.05, o.att || 0.008, dur, o.reverse);
    s.connect(fl); fl.connect(g); route(g, o.bus, o.rev === undefined ? 0.2 : o.rev, o.pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // movement: a soft fur brush, a pad on the boards; jumps get a lift and a thump
  const MOVE = { sit: [620, 0.22], stand: [900, 0.2], crouch: [480, 0.26], paw: [1300, 0.16], jump: [1100, 0.2], land: [300, 0.22] };
  A.catMove = a => {
    const m = MOVE[a] || MOVE.stand;
    noise(m[1], { f: m[0], q: 0.8, vol: 0.045, f2: m[0] * 0.6 });
    if (a === 'land') tone(90, 0.18, { vol: 0.09, f2: 55, rev: 0.1 });
    if (a === 'paw') noise(0.05, { f: 3200, q: 2, vol: 0.02, delay: 0.1 });
  };
  A.reflectMove = a => {
    const m = MOVE[a] || MOVE.stand;
    noise(m[1] * 1.6, { f: m[0] * 0.8, q: 1.2, vol: 0.05, f2: m[0] * 1.2, reverse: true, bus: mirrorBus, rev: 0.5, pan: 0 });
    tone(196, 0.5, { vol: 0.012, f2: 185, reverse: true, bus: mirrorBus, rev: 0.6 });
  };
  A.perfect = combo => { const f = 660 * Math.pow(2, Math.min(combo, 8) / 24); tone(f, 0.5, { vol: 0.035, rev: 0.7 }); tone(f * 1.5, 0.6, { vol: 0.02, delay: 0.04, rev: 0.8 }); };
  A.good = () => { tone(520, 0.35, { vol: 0.03, rev: 0.6 }); };
  A.wrong = () => { tone(118, 0.4, { type: 'sawtooth', vol: 0.03, f2: 92, rev: 0.4 }); noise(0.25, { f: 400, q: 3, vol: 0.06, f2: 200 }); };
  A.miss = () => { tone(155, 0.7, { type: 'triangle', vol: 0.04, f2: 104, rev: 0.6 }); };
  A.warn = level => { tone(level === 'CRITICAL' ? 82 : 110, 1.2, { type: 'sine', vol: 0.08, f2: 70, rev: 0.6 }); tone(level === 'CRITICAL' ? 1240 : 990, 0.9, { vol: 0.012, reverse: true, rev: 0.8 }); };
  A.deviate = () => { noise(0.6, { f: 2400, q: 6, vol: 0.03, f2: 800, reverse: true, bus: mirrorBus, rev: 0.8 }); tone(311, 0.8, { vol: 0.015, f2: 293, bus: mirrorBus }); };
  A.phase = () => { tone(55, 3, { vol: 0.08, att: 1.2, rev: 0.8 }); noise(2.2, { f: 900, q: 0.6, vol: 0.04, f2: 300, reverse: true, rev: 0.9 }); };
  A.milestone = () => { [392, 466, 587].forEach((f, i) => tone(f, 1.6, { vol: 0.025, delay: i * 0.12, rev: 1 })); };
  A.gameOver = () => {
    tone(98, 3.2, { type: 'sawtooth', vol: 0.04, f2: 41, rev: 0.9 });
    noise(2.6, { f: 1800, q: 1, vol: 0.06, f2: 120, reverse: true, bus: mirrorBus, rev: 0.9 });
    noise(0.5, { type: 'lowpass', f: 900, vol: 0.09, delay: 2.4, rev: 0.6 });
  };
  A.snuff = () => { noise(0.3, { f: 1600, q: 0.7, vol: 0.05, f2: 400 }); };
  A.click = () => { tone(1800, 0.04, { vol: 0.012, rev: 0.1 }); };
  // unease 0..1 shapes the room tone and the drone
  A.ambience = unease => {
    if (!A.ok) return;
    droneGain.gain.setTargetAtTime(0.012 + unease * 0.05, ac.currentTime, 0.8);
    drone.frequency.setTargetAtTime(49 - unease * 3, ac.currentTime, 2);
    airGain.gain.setTargetAtTime(0.045 + unease * 0.02, ac.currentTime, 1);
  };
  A.creak = () => { tone(130 + Math.random() * 40, 0.9, { type: 'sawtooth', vol: 0.008, f2: 105, rev: 0.8, pan: Math.random() * 1.6 - 0.8 }); };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}

// ---- 06_ui.js ----
// =====================================================================
// HUD and screens. Restrained: aged-bronze hairlines, a serif for numbers,
// small tracked labels, no panels during play.
// Type scale (px): 10 label · 13 body · 22 numeral · 44 title. 16px gutter.
// =====================================================================

const UI_CSS = `
.rf{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#d9cdb8;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--g:16px;--bronze:#a8834e;--amber:#e8a85a;--dim:rgba(217,205,184,.55)}
.rf *{box-sizing:border-box}
.rf-lab{font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.rf-num{font-family:'DM Serif Display',Georgia,serif;font-variant-numeric:tabular-nums;line-height:1}
.rf-top{position:absolute;left:var(--g);right:var(--g);top:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:start;transition:opacity .6s}
.rf-title{opacity:.42;padding-top:3px}
.rf-time{text-align:center;font-size:22px;text-shadow:0 1px 10px #000}
.rf-time.mark{color:var(--amber);transition:color .3s}
.rf-time small{display:block;margin-top:5px;opacity:0;transition:opacity .6s;color:var(--amber)}
.rf-time.mark small{opacity:.9}
.rf-right{display:flex;justify-content:flex-end;align-items:flex-start;gap:12px}
.rf-score{text-align:right}
.rf-score .rf-num{font-size:22px;text-shadow:0 1px 10px #000}
.rf-score .rf-lab{margin-top:5px;opacity:.5}
.rf-mute{pointer-events:auto;width:32px;height:32px;margin-top:-4px;border:0;background:transparent;color:var(--dim);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.rf-mute svg{width:18px;height:18px}
.rf-sync{position:absolute;left:var(--g);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-start;gap:8px;transition:opacity .6s}
.rf-sync .rf-num{font-size:22px;text-shadow:0 1px 10px #000}
.rf-bar{position:relative;width:3px;height:120px;background:rgba(217,205,184,.14);margin-left:1px}
.rf-bar b{position:absolute;left:0;right:0;bottom:0;background:var(--bronze);transition:height .25s ease-out,background .4s}
.rf-bar i{position:absolute;left:-3px;width:9px;height:1px;background:rgba(217,205,184,.35)}
.rf-state{opacity:.7;transition:color .4s}
.rf-sync.unstable .rf-bar b{background:#b57a45}.rf-sync.unstable .rf-state{color:#c99a68}
.rf-sync.critical .rf-bar b{background:#9a3e2c}.rf-sync.critical .rf-state{color:#c4634c;opacity:1}
.rf-sync.critical .rf-num{animation:rfp 1s ease-in-out infinite}
@keyframes rfp{50%{opacity:.45}}
.rf-streak{opacity:0;transition:opacity .3s}
.rf-streak.on{opacity:.65}
.rf-word{position:absolute;left:0;right:0;text-align:center;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:20px;letter-spacing:.04em;opacity:0;text-shadow:0 1px 14px #000}
.rf-word.go{animation:rfw .9s ease-out forwards}
@keyframes rfw{0%{opacity:0;transform:translateY(6px)}15%{opacity:.95;transform:none}100%{opacity:0;transform:translateY(-10px)}}
.rf-line{position:absolute;left:var(--g);right:var(--g);text-align:center;font-family:'DM Serif Display',Georgia,serif;font-style:italic;font-size:19px;line-height:1.5;opacity:0;transition:opacity 1.4s ease;text-shadow:0 2px 18px #000}
.rf-line.on{opacity:.92}
.rf-pad{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:var(--gap,10px);padding:0 var(--g);transition:opacity .6s}
.rf-act{pointer-events:auto;touch-action:none;flex:0 0 auto;width:var(--bs,60px);height:var(--bs,60px);border-radius:50%;border:1px solid rgba(168,131,78,.5);background:rgba(12,10,9,.42);color:#d9cdb8;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;cursor:pointer;transition:transform .12s ease-out,background .15s,border-color .3s,box-shadow .4s;-webkit-tap-highlight-color:transparent;padding:0}
.rf-act svg{width:58%;height:58%;overflow:visible}
.rf-act .k{position:absolute;bottom:-17px;font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.38}
.rf-act.down{transform:scale(.9);background:rgba(168,131,78,.32);border-color:rgba(232,168,90,.9)}
.rf-act.hint{box-shadow:0 0 0 1px rgba(232,168,90,.7),0 0 22px rgba(232,168,90,.28);border-color:rgba(232,168,90,.85)}
.rf-act.ok{animation:rfo .45s ease-out}
.rf-act.bad{animation:rfb .35s ease-out}
@keyframes rfo{40%{box-shadow:0 0 0 1px rgba(232,168,90,.9),0 0 26px rgba(232,168,90,.45)}}
@keyframes rfb{25%{transform:translateX(-3px)}50%{transform:translateX(3px)}75%{transform:translateX(-2px)}}
@media (pointer:coarse){.rf-act .k{display:none}}
.rf-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;padding:0 var(--g);opacity:0;transition:opacity 1s ease}
.rf-panel.on{display:flex}.rf-panel.vis{opacity:1}
.rf-logo{font-family:'DM Serif Display',Georgia,serif;font-size:44px;line-height:1.05;letter-spacing:.2em;text-indent:.2em;text-align:center;text-shadow:0 2px 30px #000}
.rf-rule{width:40px;height:1px;background:var(--bronze);margin:18px auto}
.rf-b{pointer-events:auto;border:1px solid rgba(168,131,78,.7);background:rgba(12,10,9,.5);color:#e6dccb;border-radius:999px;padding:13px 34px;font:700 11px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.3em;text-indent:.3em;cursor:pointer;transition:background .2s,border-color .2s}
.rf-b:hover,.rf-b:active{background:rgba(168,131,78,.25);border-color:var(--amber)}
.rf-sub{margin-top:14px;opacity:.5}
.rf-res{display:flex;gap:28px;justify-content:center;margin:6px 0 26px}
.rf-res>div{text-align:center}
.rf-res .rf-num{font-size:24px;margin-bottom:6px}
.rf-res .rf-lab{opacity:.55}
.rf-res .big .rf-num{font-size:44px}
.rf-board{min-height:58px;margin:-8px 0 22px;text-align:center;font-size:12px;line-height:1.6;color:var(--dim)}
.rf-board .row{display:flex;gap:14px;justify-content:center;font-variant-numeric:tabular-nums}
.rf-board .row b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;color:#d9cdb8;min-width:22px;text-align:right}
.rf-board .you{color:var(--amber);margin-top:4px}
.rf-new{color:var(--amber);opacity:.9;margin-bottom:10px;min-height:12px}
.rf-head{opacity:.6;margin-bottom:18px}
.rf-shade{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 30%,rgba(0,0,0,.55) 100%);opacity:0;transition:opacity 1.2s}
.rf-shade.on{opacity:1}
`;

// silhouettes, side view, facing right; 48x48
const ICONS = (() => {
  const head = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - r * 0.95} ${y - r * 0.35}L${x - r * 0.75} ${y - r * 1.85}L${x - r * 0.05} ${y - r * 0.85}ZM${x + r * 0.15} ${y - r * 0.9}L${x + r * 0.95} ${y - r * 1.85}L${x + r * 1.0} ${y - r * 0.3}Z"/>`;
  const S = 'stroke="currentColor" stroke-linecap="round" fill="none"';
  return {
    sit: `<svg viewBox="0 0 48 48" fill="currentColor">${head(28, 13, 5)}<path d="M23 17C17 20 14 28 15 35C15.5 39 18 41 22 41L31 41C32 36 32 26 30 19Z"/><path d="M27 26L28.5 41" ${S} stroke-width="3.2"/><path d="M16 39C9 40 7 35 11 32" ${S} stroke-width="2.6"/></svg>`,
    stand: `<svg viewBox="0 0 48 48" fill="currentColor">${head(37, 18, 4.6)}<ellipse cx="23" cy="25" rx="12.5" ry="6"/><path d="M14 28L13 41M18 29L18.5 41M29 29L29 41M33 27L34 41" ${S} stroke-width="2.8"/><path d="M11 23C6 20 5 13 8 9" ${S} stroke-width="2.6"/></svg>`,
    crouch: `<svg viewBox="0 0 48 48" fill="currentColor">${head(38, 31, 4.3)}<ellipse cx="23" cy="34" rx="13.5" ry="4.8"/><path d="M14 37L12 41M32 37L35 41" ${S} stroke-width="2.8"/><path d="M10 35C6 36 3 37 1.5 37.5" ${S} stroke-width="2.4"/></svg>`,
    paw: `<svg viewBox="0 0 48 48" fill="currentColor">${head(27, 13, 5)}<path d="M22 17C16 20 13 28 14 35C14.5 39 17 41 21 41L29 41C30 36 30 26 29 19Z"/><path d="M28 24L38 15" ${S} stroke-width="3.2"/><path d="M15 39C8 40 6 35 10 32" ${S} stroke-width="2.6"/></svg>`,
    jump: `<svg viewBox="0 0 48 48" fill="currentColor">${head(36, 11, 4.4)}<ellipse cx="23" cy="21" rx="12" ry="5" transform="rotate(-28 23 21)"/><path d="M31 17L39 21M29 20L37 25M15 26L8 34M18 27L12 36" ${S} stroke-width="2.6"/><path d="M13 27C8 30 4 29 3 25" ${S} stroke-width="2.4"/><path d="M14 44L34 44" ${S} stroke-width="1.4" opacity=".45"/></svg>`
  };
})();
const MUTE_ICON = { on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9H8L13 5V19L8 15H4Z"/><path d="M16.5 9.5C17.5 10.8 17.5 13.2 16.5 14.5M19 7C21.3 9.7 21.3 14.3 19 17"/></svg>', off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9H8L13 5V19L8 15H4Z"/><path d="M17 10L21 14M21 10L17 14"/></svg>' };

function createUI(ctx) {
  const ui = ctx.createRoot({ className: 'rf', layer: 'overlay', input: 'passthrough' });
  const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
  const U = { root: ui };
  U.shade = el('div', 'rf-shade');
  U.top = el('div', 'rf-top');
  U.title = el('div', 'rf-title rf-lab', 'The Reflection', U.top);
  U.time = el('div', 'rf-time rf-num', '0:00<small class="rf-lab">survived</small>', U.top);
  const right = el('div', 'rf-right', '', U.top);
  const sc = el('div', 'rf-score', '', right);
  U.score = el('div', 'rf-num', '0', sc); U.best = el('div', 'rf-lab', 'best 0', sc);
  U.mute = el('button', 'rf-mute', MUTE_ICON.on, right); U.mute.setAttribute('aria-label', 'Sound');
  U.sync = el('div', 'rf-sync');
  U.syncNum = el('div', 'rf-num', '100', U.sync);
  U.bar = el('div', 'rf-bar', '<b style="height:100%"></b><i style="bottom:75%"></i><i style="bottom:45%"></i><i style="bottom:20%"></i>', U.sync); U.barFill = U.bar.firstChild;
  U.state = el('div', 'rf-state rf-lab', 'STABLE', U.sync);
  U.streak = el('div', 'rf-streak rf-lab', '', U.sync);
  U.word = el('div', 'rf-word', '');
  U.line = el('div', 'rf-line', '');
  U.pad = el('div', 'rf-pad');
  U.btn = {};
  ACTIONS.forEach((a, i) => { const b = el('button', 'rf-act', ICONS[a] + `<span class="k">${a === 'jump' ? '5 · ␣' : i + 1}</span>`, U.pad); b.setAttribute('aria-label', ACTION_LABEL[a]); b.dataset.a = a; U.btn[a] = b; });
  // screens
  U.start = el('div', 'rf-panel');
  el('div', 'rf-logo', 'THE<br>REFLECTION', U.start); el('div', 'rf-rule', '', U.start);
  U.startBtn = el('button', 'rf-b', 'START', U.start);
  U.startBest = el('div', 'rf-sub rf-lab', '', U.start);
  U.results = el('div', 'rf-panel');
  U.resHead = el('div', 'rf-head rf-lab', 'The reflection escaped', U.results);
  U.resNew = el('div', 'rf-new rf-lab', '', U.results);
  U.resStats = el('div', 'rf-res', '', U.results);
  U.board = el('div', 'rf-board', '', U.results);
  U.again = el('button', 'rf-b', 'AGAIN', U.results);
  U.paused = el('div', 'rf-panel'); el('div', 'rf-lab', 'paused', U.paused); el('div', 'rf-rule', '', U.paused); U.resume = el('button', 'rf-b', 'RESUME', U.paused);

  U.say = (txt, yFrac) => { U.word.textContent = txt; U.word.style.top = (yFrac * 100) + '%'; U.word.classList.remove('go'); void U.word.offsetWidth; U.word.classList.add('go'); };
  U.showLine = (html, yFrac) => { U.line.innerHTML = html; U.line.style.top = (yFrac * 100) + '%'; U.line.classList.add('on'); };
  U.hideLine = () => U.line.classList.remove('on');
  U.panel = p => {
    for (const x of [U.start, U.results, U.paused]) {
      if (x === p) { x.classList.add('on'); ctx.timeout(() => { if (x.classList.contains('on')) x.classList.add('vis'); }, 34); }
      else { x.classList.remove('on', 'vis'); }
    }
  };
  U.hud = on => { for (const e of [U.top, U.sync, U.pad]) { e.style.opacity = on ? '1' : '0'; } U.pad.style.pointerEvents = on ? '' : 'none'; for (const b of Object.values(U.btn)) b.style.pointerEvents = on ? '' : 'none'; };
  U.setMuted = m => { U.mute.innerHTML = m ? MUTE_ICON.off : MUTE_ICON.on; };
  const fmt = s => { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  U.fmt = fmt;
  const cache = {};
  U.update = (D, best) => {
    const t = fmt(D.t); if (cache.t !== t) { cache.t = t; U.time.firstChild.textContent = t; }
    const s = Math.floor(D.score).toLocaleString(); if (cache.s !== s) { cache.s = s; U.score.textContent = s; }
    const b = 'best ' + Math.floor(best).toLocaleString(); if (cache.b !== b) { cache.b = b; U.best.textContent = b; }
    const y = Math.round(D.sync); if (cache.y !== y) { cache.y = y; U.syncNum.textContent = y; U.barFill.style.height = y + '%'; }
    const stt = D.state(); if (cache.st !== stt) { cache.st = stt; U.state.textContent = stt; U.sync.classList.toggle('unstable', stt === 'UNSTABLE'); U.sync.classList.toggle('critical', stt === 'CRITICAL' || stt === 'ESCAPED'); }
    const k = D.streak >= 2 ? `streak ${D.streak}${D.perfectStreak >= 2 ? ' · ×' + D.comboMult().toFixed(1) : ''}` : '';
    if (cache.k !== k) { cache.k = k; U.streak.textContent = k; U.streak.classList.toggle('on', !!k); }
  };
  U.flashBtn = (a, cls) => { const b = U.btn[a]; if (!b) return; b.classList.remove('ok', 'bad'); void b.offsetWidth; b.classList.add(cls); };
  // area is ctx.contentSafeArea ?? ctx.safeArea: clear of the cutout, the home
  // indicator and Plethora's logo button. Only the scene runs edge to edge.
  U.layout = (w, h, area) => {
    const top = (area && area.top) || 0, bot = (area && area.bottom) || 0, left = (area && area.left) || 0, right = (area && area.right) || 0;
    U.top.style.paddingTop = (14 + top) + 'px';
    U.top.style.left = (16 + left) + 'px'; U.top.style.right = (16 + right) + 'px';
    U.sync.style.left = (16 + left) + 'px';
    U.pad.style.paddingLeft = (16 + left) + 'px'; U.pad.style.paddingRight = (16 + right) + 'px';
    for (const p of [U.start, U.results, U.paused]) { p.style.paddingTop = top + 'px'; p.style.paddingBottom = bot + 'px'; }
    w -= left + right;
    const narrow = w < 520;
    const bs = Math.round(clamp((w - 32 - 4 * 10) / 5, 50, narrow ? 64 : 62));
    const gap = Math.round(clamp((w - 32 - bs * 5) / 4, 8, 18));
    U.pad.style.setProperty('--bs', bs + 'px'); U.pad.style.setProperty('--gap', gap + 'px');
    const lift = bot > 40 ? 8 : (narrow ? 18 : 30);
    U.pad.style.paddingBottom = (bot + lift) + 'px';
    U.padH = bs + bot + lift + 10;
    U.safeTop = top;
  };
  return U;
}

// ---- 07_game.js ----
// =====================================================================
// THE REFLECTION — renderer, the two rooms, the mirror, flow and input.
// The mirror is a second scene: the room rebuilt inside a z-flipped group,
// holding its own cat. It renders to a target the glass samples in screen
// space, which is where distortion, ageing and cues are applied.
// =====================================================================

const SAVE_KEY = 'reflection_save';
const CAT_Z = 0.82, CAT_SCALE = 1.5;
const MIRROR_Z = 0.24, MIRROR_TILT = 0.2, CAT_YAW = Math.PI + 0.5;

const GLASS_VERT = `
varying vec2 vLocal;
void main(){ vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const GLASS_FRAG = `
uniform sampler2D tMirror; uniform vec2 uRes; uniform vec4 uRect; uniform float uTime;
uniform float uRipple, uRippleT, uDesync, uGlint, uGlintT, uDark, uCue, uCueOn;
uniform vec2 uRippleC;
varying vec2 vLocal;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 suv = gl_FragCoord.xy / uRes;
  vec2 luv = (vLocal - uRect.xy) / (uRect.zw - uRect.xy);
  vec2 asp = vec2((uRect.z - uRect.x) / (uRect.w - uRect.y), 1.0);
  vec2 dv = (luv - uRippleC) * asp; float d = length(dv);
  float wave = sin(d * 46.0 - uRippleT * 15.0) * exp(-d * 3.5) * uRipple * smoothstep(uRippleT * 0.45 + 0.05, uRippleT * 0.45 - 0.1, d);
  vec2 off = (dv / (d + 1e-4)) * wave * 0.012;
  off += vec2(sin(luv.y * 17.0 + uTime * 1.3), cos(luv.x * 13.0 + uTime * 1.1)) * 0.0022 * uDesync;
  off += vec2(n2(luv * 5.0 + uTime * 0.2) - 0.5, 0.0) * 0.004 * uDesync * uDesync;
  float ca = 0.0008 + 0.004 * uDesync + abs(wave) * 0.03;
  vec3 col;
  col.r = texture2D(tMirror, suv + off + vec2(ca, 0.0)).r;
  col.g = texture2D(tMirror, suv + off).g;
  col.b = texture2D(tMirror, suv + off - vec2(ca, 0.0)).b;
  // old silvering: a little dimmer, warm-grey, never clean
  col *= vec3(0.93, 0.91, 0.87);
  float edge = min(min(luv.x, 1.0 - luv.x), min(luv.y, 1.0 - luv.y) * 0.8);
  float nz = fbm(luv * vec2(5.0, 8.0) + 1.7);
  float desilver = smoothstep(0.1, 0.0, edge + (nz - 0.5) * 0.13);
  col = mix(col, vec3(0.018, 0.016, 0.014) + col * 0.18, desilver * 0.75);
  float fox = smoothstep(0.7, 0.76, fbm(luv * vec2(19.0, 27.0) + 3.1));
  col *= 1.0 - fox * 0.4;
  col += vec3(0.012, 0.011, 0.01) * fbm(luv * vec2(2.5, 3.5) + 7.0);
  // a warm glint sweeps the glass on perfect timing
  float gp = uGlintT * 1.8 - 0.4;
  col += vec3(1.0, 0.72, 0.4) * exp(-pow((luv.x * 0.8 + luv.y * 0.5 - gp) * 14.0, 2.0)) * uGlint * 0.09;
  // the response cue: a hairline of light along the base, shrinking to the centre
  float base = smoothstep(0.009, 0.0, abs(luv.y - 0.03)) * smoothstep(uCue * 0.42, uCue * 0.42 - 0.03, abs(luv.x - 0.5));
  col += vec3(0.9, 0.5, 0.18) * base * 0.32 * uCueOn;
  col += vec3(0.5, 0.3, 0.12) * smoothstep(0.12, 0.0, edge) * 0.05 * uCueOn;
  col *= 1.0 - uDark;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

window.plethoraBit = {
  meta: { title: 'The Reflection', runtime: 'plethora-bit@2', tags: ['arcade', 'horror', '3d', 'rhythm', 'endless'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = { best: 0, muted: false, runs: 0 };
    // ctx.storage is synchronous: get returns the value or null, set returns nothing
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };

    // ---------- first frame: DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 40%,#2a211a,#070606 70%)';
    const U = createUI(ctx);
    U.hud(false);
    U.panel(U.start);
    const refreshBest = () => { U.startBest.textContent = save.best > 0 ? 'best ' + Math.floor(save.best).toLocaleString() : ''; };
    refreshBest();
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'italic' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      U.startBtn.style.display = 'none';
      U.startBest.textContent = stage === 'library' ? 'Could not load the 3D engine. Check your connection.' : 'This device could not start 3D graphics.';
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(window.__REFLECTION_DEV && window.__rfPixelRatio ? window.__rfPixelRatio : Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 1.6 : 1.75));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#050404');
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- the two rooms ----------
    const scratch = ctx.createCanvas2D({ layer: 'background', input: 'passthrough', willReadFrequently: true });
    scratch.style.display = 'none';
    const T = createTextures(THREE, Math.min(8, renderer.capabilities.getMaxAnisotropy()), scratch);
    const RM = createRoomMaterials(THREE, T);
    const CM = createCatMaterials(THREE);
    const real = new THREE.Scene(), mirror = new THREE.Scene();
    const FOG = '#080706';
    real.fog = new THREE.FogExp2(FOG, 0.07); mirror.fog = new THREE.FogExp2(FOG, 0.045);
    const camera = new THREE.PerspectiveCamera(48, ctx.width / ctx.height, 0.05, 40);
    const mirrorWorld = new THREE.Group(); mirrorWorld.scale.z = -1; mirror.add(mirrorWorld);
    const R = buildRoom(THREE, T, RM, 'real', small); real.add(R.group);
    const RMr = buildRoom(THREE, T, RM, 'mirror', small); mirrorWorld.add(RMr.group);
    const MR = buildMirror(THREE, RM);
    // the glass tilts forward on its pivot, so it looks down at the floor and the cats
    const tilt = new THREE.Group(); tilt.position.set(0, MR.pivotY, MIRROR_Z); tilt.rotation.x = MIRROR_TILT; real.add(tilt);
    MR.group.position.y = -MR.pivotY; tilt.add(MR.group);
    MR.stand.position.z = MIRROR_Z; real.add(MR.stand);
    // the mirror world is the room reflected across the glass plane
    const mN = new THREE.Vector3(0, -Math.sin(MIRROR_TILT), Math.cos(MIRROR_TILT));
    const mP = new THREE.Vector3(0, MR.pivotY, MIRROR_Z);
    const mD = mN.dot(mP);
    mirrorWorld.scale.z = 1; mirrorWorld.matrixAutoUpdate = false;
    {
      const [x, y, z] = [mN.x, mN.y, mN.z];
      mirrorWorld.matrix.set(
        1 - 2 * x * x, -2 * x * y, -2 * x * z, 2 * mD * x,
        -2 * x * y, 1 - 2 * y * y, -2 * y * z, 2 * mD * y,
        -2 * x * z, -2 * y * z, 1 - 2 * z * z, 2 * mD * z,
        0, 0, 0, 1);
      mirrorWorld.matrixWorldNeedsUpdate = true;
    }
    // only what lies behind the glass may appear in it
    const mirrorClip = [new THREE.Plane(mN.clone().negate(), mD)];
    function lights(parent, candle) {
      const L = {};
      L.hemi = new THREE.HemisphereLight('#2a3446', '#1c130d', 0.8); parent.add(L.hemi);
      L.candle = new THREE.PointLight(PAL.amber, 3.2, 0, 2); L.candle.position.set(candle.pos[0], candle.pos[1] + 0.06, candle.pos[2]); parent.add(L.candle);
      L.moon = new THREE.DirectionalLight(PAL.moon, 1.5);
      L.moon.position.set(-ROOM.W - 3.0, 4.4, 2.9); L.moon.target.position.set(0.2, 0, 0.9);
      L.moon.castShadow = true; L.moon.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
      Object.assign(L.moon.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 });
      L.moon.shadow.bias = -0.0004; L.moon.shadow.normalBias = 0.02; L.moon.shadow.radius = 3;
      parent.add(L.moon); parent.add(L.moon.target);
      // faint warm bounce from the floor near the candle so the frame reads
      L.bounce = new THREE.PointLight('#8a5a30', 0.35, 0, 2); L.bounce.position.set(-0.35, 0.3, 0.3); parent.add(L.bounce);
      return L;
    }
    const LR = lights(real, R.candle), LM = lights(mirrorWorld, RMr.candle);
    // a moonbeam: an additive sheet from the window, very faint
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 3.4), new THREE.MeshBasicMaterial({ map: T.beam, color: '#7f95b6', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    const beamG = new THREE.Group(); beamG.add(beam); beam.position.y = -1.7;
    beamG.position.set(-ROOM.W, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2); beamG.rotation.set(0, Math.PI / 2, 0); beamG.rotateX(-0.95);
    real.add(beamG); const beamM = beamG.clone(); mirrorWorld.add(beamM);
    const dust = createDust(THREE, T, small ? 180 : 320);
    real.add(new THREE.Points(dust.geo, dust.mat)); mirrorWorld.add(new THREE.Points(dust.geo, dust.mat));

    // ---------- cats ----------
    const cat = createCat(THREE, CM, { shadowTex: T.shadow, k: 16, eyeIntensity: 0.25 });
    cat.root.position.set(0, 0, CAT_Z); cat.root.rotation.y = CAT_YAW; cat.root.scale.setScalar(CAT_SCALE); real.add(cat.root);
    const refl = createCat(THREE, CM, { shadowTex: T.shadow, k: 13, eyeIntensity: 0.55, eyeGlow: '#8a5a12' });
    refl.root.position.set(0, 0, CAT_Z); refl.root.rotation.y = CAT_YAW; refl.root.scale.setScalar(CAT_SCALE); mirrorWorld.add(refl.root);

    // ---------- the glass ----------
    const rtScale = small ? 0.8 : 1;
    const rtType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: rtType, samples: renderer.capabilities.isWebGL2 ? (small ? 2 : 4) : 0 });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const G = {
      tMirror: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4(MR.rect.x0, MR.rect.y0, MR.rect.x1, MR.rect.y1) },
      uTime: { value: 0 }, uRipple: { value: 0 }, uRippleT: { value: 9 }, uRippleC: { value: new THREE.Vector2(0.5, 0.2) }, uDesync: { value: 0 },
      uGlint: { value: 0 }, uGlintT: { value: 9 }, uDark: { value: 0 }, uCue: { value: 0 }, uCueOn: { value: 0 }
    };
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(MR.glassShape, 32), new THREE.ShaderMaterial({ uniforms: G, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG }));
    MR.group.add(glass);
    ctx.onDestroy(() => { try { rt.dispose(); } catch (e) { } });

    const audio = createAudio(!!caps.audio);
    audio.setMuted(!!save.muted); U.setMuted(!!save.muted);
    ctx.onDestroy(() => audio.close());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    // creator tuning (draft tools); published playback reads the manifest defaults
    const tn = (id, d) => { try { const v = ctx.tune && ctx.tune.number(id); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const BOARD = { scope: 'global', period: 'all_time' };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    cat.onStep = a => audio.catMove(a);

    // ---------- run state ----------
    let mode = 'title';       // title | play | paused | over | results
    let D = null, run = null;
    const fx = { shake: 0, unease: 0, flame: 1, mirrorFlame: 1 };
    function ripple(x, y, amt) { G.uRipple.value = Math.max(G.uRipple.value * 0.5, amt); G.uRippleT.value = 0; G.uRippleC.value.set(x, y); }
    // where the reflection sits on the glass, for ripples
    const RC = [0.5, 0.3];
    const _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _glassPlane = new THREE.Plane(mN, -mD);
    function locateReflection() {
      // where the reflection's head sits on the glass, in glass uv
      refl.head.getWorldPosition(_hit);
      _ray.origin.copy(camera.position); _ray.direction.copy(_hit).sub(camera.position).normalize();
      if (!_ray.intersectPlane(_glassPlane, _hit)) return;
      glass.worldToLocal(_hit);
      RC[0] = clamp((_hit.x - MR.rect.x0) / (MR.rect.x1 - MR.rect.x0), 0, 1); RC[1] = clamp((_hit.y - MR.rect.y0) / (MR.rect.y1 - MR.rect.y0), 0, 1);
    }
    function hooks() {
      return {
        reflect(a, kind) {
          if (kind === 'feint') { refl.feintTo(a, CONFIG.feint.dur); audio.deviate(); ripple(RC[0], RC[1] + 0.05, 0.22); return; }
          if (kind === 'tell') { refl.tellOf(); return; }
          refl.perform(a);
          audio.reflectMove(a === 'jump' ? 'jump' : a);
          if (kind !== 'follow' && !run.firstLead) { run.firstLead = true; ripple(RC[0], RC[1], 0.5); fx.shake = 0.25; audio.deviate(); }
        },
        cue(p) { run.cue = p; if (D.promptCount <= CONFIG.hintPrompts) U.btn[p.action].classList.add('hint'); },
        result(g, info) {
          const p = info.prompt;
          if (p) U.btn[p.action].classList.remove('hint');
          if (p && run.cue === p) run.cue = null;
          const y = 1 - (U.padH + 70) / ctx.height;
          if (g === 'perfect') { G.uGlint.value = 1; G.uGlintT.value = 0; audio.perfect(D.perfectStreak); U.say('perfect', y); haptic('light'); U.flashBtn(p.action, 'ok'); }
          else if (g === 'good') { audio.good(); U.say('good', y); U.flashBtn(p.action, 'ok'); }
          else if (g === 'late') { audio.good(); U.say('late', y); }
          else if (g === 'wrong') { audio.wrong(); U.say('wrong', y); ripple(RC[0], RC[1], 0.6); fx.shake = 0.35; refl.lookAt(0, 0.1, 0.9); refl.cur.roll = 0.35; haptic('medium'); }
          else if (g === 'miss') { audio.miss(); U.say('missed', y); ripple(RC[0], RC[1] + 0.1, 0.45); refl.stare = 1.2; refl.lookAt(0, 0.22, 1.2); haptic('medium'); }
          else if (g === 'stray') { audio.deviate(); U.say('alone', y); ripple(RC[0], RC[1], 0.25); }
          else if (g === 'fooled') { audio.wrong(); U.say('fooled', y); ripple(RC[0], RC[1], 0.5); refl.shiver = 1; fx.shake = 0.2; haptic('light'); }
        },
        phase(n) {
          audio.phase();
          if (n === 2) { U.showLine('Then it doesn’t.', 0.36); run.lineOff = D.t + 2.6; }
          try { ctx.platform.milestone('phase_' + n); } catch (e) { }
        },
        level(n) { if (n > 8) try { ctx.platform.milestone('level_' + n); } catch (e) { } },
        warn(s) { audio.warn(s); fx.shake = Math.max(fx.shake, 0.2); haptic('warning'); },
        milestone(id) { audio.milestone(); U.time.classList.add('mark'); run.markOff = D.t + 3; try { ctx.platform.milestone('survived_80'); } catch (e) { } },
        over() { gameOver(); }
      };
    }

    // ---------- flow ----------
    function resetWorld() {
      cat.reset(); refl.reset();
      refl.root.position.set(0, 0, CAT_Z); refl.root.rotation.y = CAT_YAW; refl.root.visible = true;
      fx.mirrorFlame = 1; fx.flame = 1; fx.shake = 0;
      G.uRipple.value = 0; G.uGlint.value = 0; G.uDark.value = 0; G.uCueOn.value = 0;
      for (const b of Object.values(U.btn)) b.classList.remove('hint', 'down', 'ok', 'bad');
      U.time.classList.remove('mark');
    }
    function begin() {
      if (mode === 'play') return;
      audio.unlock(); audio.click();
      resetWorld();
      D = createDirector(hooks(), (Date.now() & 0xffff) + 1, { window: tn('response_window', 1), takeover: Math.round(tn('takeover_seconds', CONFIG.initiativeAt)), feint: tn('feint_rate', 1) });
      run = { attempt: (run ? run.attempt : 0) + 1, cue: null, firstLead: false, lineOff: 3.6, markOff: 0, over: 0, idle: 0, glance: 3 + Math.random() * 3, creak: 6 };
      mode = 'play';
      U.panel(null); U.hud(true); U.shade.classList.remove('on');
      U.showLine('At first, it follows you.', 0.36);
      save.runs++; persist();
      try { ctx.platform.start({ run: save.runs }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function gameOver() {
      if (mode !== 'play') return;
      mode = 'over';
      run.over = 0; run.cue = null;
      U.update(D, Math.max(save.best, D.score));
      U.hideLine();
      for (const b of Object.values(U.btn)) b.classList.remove('hint');
      audio.gameOver(); haptic('error');
      fx.shake = 0.8; ripple(RC[0], RC[1], 1);
      // the real cat flinches; the reflection stops pretending
      cat.perform('crouch'); cat.cur.ears = 1;
      refl.perform('stand'); refl.stare = 2; refl.lookAt(0, 0.25, 1.6);
      const score = Math.floor(D.score);
      run.newBest = score > save.best;
      save.best = Math.max(save.best, score); persist();
      try { ctx.platform.fail({ score, survived: Math.floor(D.t), reason: 'escaped' }); } catch (e) { }
      run.submitted = false;
      try {
        if (scoreTrack) { scoreTrack.set(score); scoreTrack.submit('score', { label: score.toLocaleString() + ' pts' }).catch(() => { }); run.submitted = true; }
        else if (ctx.memory && ctx.memory.record) { ctx.memory.record('score').submit(score, { label: score.toLocaleString() + ' pts' }).catch(() => { }); run.submitted = true; }
      } catch (e) { }
    }
    function showResults() {
      mode = 'results';
      U.hud(false); U.shade.classList.add('on');
      U.resNew.textContent = run.newBest ? 'new best' : '';
      U.resStats.innerHTML = `<div><div class="rf-num">${U.fmt(D.t)}</div><div class="rf-lab">survived</div></div><div class="big"><div class="rf-num">${Math.floor(D.score).toLocaleString()}</div><div class="rf-lab">score</div></div><div><div class="rf-num">${Math.floor(save.best).toLocaleString()}</div><div class="rf-lab">best</div></div>`;
      U.panel(U.results);
      refreshBest();
      // surviving the full 80 s is worth a Pulse; the result screen is the image
      if (D.survived) { try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ timeMs: Math.round(D.t * 1000), timeLabel: U.fmt(D.t), score: Math.floor(D.score), text: 'Stayed in sync for ' + U.fmt(D.t) }); } catch (e) { } }
      refreshBoard(run.attempt);
    }
    // top three and the viewer's own rank; replay never waits for this
    let cachedBoard = null;
    function renderBoard(b, status) {
      const rows = b && b.rows ? b.rows.slice(0, 3) : [];
      const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const lines = rows.map(r => `<div class="row"><b>${esc(r.rank)}</b><span>${esc(r.displayLabel || Math.floor(r.value).toLocaleString())}</span></div>`).join('');
      U.board.innerHTML = lines + `<div class="${status && status.you ? 'you' : ''} rf-lab">${esc(status ? status.text : '')}</div>`;
    }
    async function refreshBoard(attempt) {
      const reader = scoreTrack && scoreTrack.leaderboard ? o => scoreTrack.leaderboard('score', o) : ctx.memory && ctx.memory.record ? o => ctx.memory.record('score').leaderboard(o) : null;
      if (!reader || !run.submitted) { U.board.innerHTML = ''; return; }
      renderBoard(cachedBoard, { text: 'updating' });
      try {
        const b = await reader(Object.assign({ limit: 3 }, BOARD));
        if (destroyed || !run || run.attempt !== attempt || mode !== 'results') return;
        cachedBoard = b;
        const failed = b && b.checkpointStatus && b.checkpointStatus.failed;
        renderBoard(b, failed ? { text: 'some scores were not saved' } : b && b.viewerRank && b.viewerRank.rank ? { text: 'you are #' + b.viewerRank.rank, you: true } : { text: 'not ranked yet' });
      } catch (e) {
        if (destroyed || !run || run.attempt !== attempt || mode !== 'results') return;
        renderBoard(cachedBoard, { text: 'board unavailable' });
      }
    }
    function pause() { if (mode !== 'play') return; mode = 'paused'; U.panel(U.paused); }
    function resume() { if (mode !== 'paused') return; mode = 'play'; U.panel(null); audio.unlock(); }

    // ---------- input: the player's cat only ----------
    function act(a) {
      if (mode !== 'play') return;
      audio.unlock();
      cat.perform(a);
      const b = U.btn[a]; b.classList.add('down'); ctx.timeout(() => b.classList.remove('down'), 140);
      const r = D.input(a);
      if (r === 'wrong' || r === 'stray' || r === 'fooled') U.flashBtn(a, 'bad');
      try { ctx.platform.interact({ type: 'action', action: a }); } catch (e) { }
    }
    const KEYMAP = { Digit1: 'sit', Digit2: 'stand', Digit3: 'crouch', Digit4: 'paw', Digit5: 'jump', Space: 'jump', Numpad1: 'sit', Numpad2: 'stand', Numpad3: 'crouch', Numpad4: 'paw', Numpad5: 'jump' };
    ctx.listen(window, 'keydown', e => {
      const a = KEYMAP[e.code];
      if (a || e.code === 'Enter' || e.code === 'Escape') e.preventDefault();
      if (e.repeat) return;
      if ((mode === 'title' || mode === 'results') && (e.code === 'Enter' || e.code === 'Space')) { if (mode === 'title' || run.over > 5.2) begin(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); return; }
      if (mode === 'paused' && a) { resume(); return; }
      if (a) act(a);
      if (e.code === 'KeyM') toggleMute();
    });
    for (const a of ACTIONS) ctx.listen(U.btn[a], 'pointerdown', e => { e.preventDefault(); e.stopPropagation(); act(a); });
    function toggleMute() { save.muted = !save.muted; audio.unlock(); audio.setMuted(save.muted); U.setMuted(save.muted); persist(); }
    ctx.listen(U.mute, 'pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleMute(); });
    const activate = (el, fn) => { if (ctx.input && ctx.input.activate) ctx.input.activate(el, e => { if (e && e.stopPropagation) e.stopPropagation(); fn(); }); else ctx.listen(el, 'click', e => { e.stopPropagation(); fn(); }); };
    activate(U.startBtn, begin); activate(U.again, begin); activate(U.resume, resume);
    ctx.listen(window, 'blur', () => pause());
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

    // ---------- layout & camera ----------
    const camBase = new THREE.Vector3(), camLook = new THREE.Vector3();
    function layout(w, h, safe) {
      U.layout(w, h, safe);
      renderer.setSize(w, h, false);
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(Math.max(4, Math.floor(db.x * rtScale)), Math.max(4, Math.floor(db.y * rtScale)));
      G.uRes.value.set(db.x, db.y);
      const aspect = w / h;
      camera.aspect = aspect;
      // Fixed composition: the cat's feet sit just above the buttons, the
      // mirror's crest just below the top HUD. Solve fov and pitch for that.
      const portrait = aspect < 0.85;
      const dist = portrait ? 3.5 : 3.3, camY = portrait ? 1.62 : 1.55;
      camBase.set(portrait ? 0.14 : 0.24, camY, dist);
      const feetY = 1 - 2 * (1 - (U.padH + 14) / h), topY = 1 - 2 * (((portrait ? 92 : 58) + (U.safeTop || 0)) / h);
      const aFeet = Math.atan2(-camY, dist - CAT_Z - 0.18 * CAT_SCALE), aTop = Math.atan2(2.3 - camY, dist);
      const halfW = portrait ? 0.98 : 1.25;
      let fov = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect), pitch = 0;
      for (let f = Math.max(0.6, fov); f < 1.6; f += 0.005) {
        const tf = Math.tan(f / 2);
        pitch = aFeet - Math.atan(feetY * tf);
        if (Math.tan(aTop - pitch) / tf <= topY) { fov = f; break; }
        fov = f;
      }
      camLook.set(0, camY + Math.tan(pitch) * dist, 0);
      camera.fov = fov * 180 / Math.PI;
      camera.updateProjectionMatrix();
    }
    ctx.onResize(({ width, height }) => layout(width, height, ctx.contentSafeArea ?? ctx.safeArea), { immediate: true });

    // ---------- loop ----------
    let clock = 0;
    const _p = new THREE.Vector3();
    function frame(dt, skipRender) {
      clock += dt;
      if (mode === 'play') {
        D.update(dt);
        if (mode === 'play') {
          if (run.lineOff && D.t > run.lineOff) { U.hideLine(); run.lineOff = 0; }
          if (run.markOff && D.t > run.markOff) { U.time.classList.remove('mark'); run.markOff = 0; }
          // cosmetic independence: glances and stares that never score
          run.glance -= dt;
          if (run.glance <= 0) {
            const ph = D.phase;
            if (ph === 1) refl.lookAt((Math.random() - 0.5) * 1.1, (Math.random() - 0.3) * 0.3, 0.7 + Math.random() * 0.6);
            else refl.lookAt((Math.random() - 0.5) * 0.4, 0.22, 1 + Math.random());
            run.glance = ph === 1 ? 3 + Math.random() * 4 : 2 + Math.random() * 3;
          }
          // the response timer drawn on the glass
          const p = D.pending();
          if (p && !p.resolved && D.t >= p.cueAt) { const left = clamp(1 - (D.t - p.cueAt) / (p.deadline - p.cueAt), 0, 1); G.uCue.value = left; G.uCueOn.value = Math.min(1, G.uCueOn.value + dt * 12); }
          else G.uCueOn.value = Math.max(0, G.uCueOn.value - dt * 6);
          const target = 1 - D.sync / 100;
          fx.unease = damp(fx.unease, clamp(target + (D.phase - 1) * 0.12, 0, 1), 1.5, dt);
          U.update(D, Math.max(save.best, D.score));
        }
      } else if (mode === 'over') {
        run.over += dt;
        const o = run.over;
        G.uCueOn.value = Math.max(0, G.uCueOn.value - dt * 6);
        fx.unease = damp(fx.unease, 1, 2, dt);
        // it turns from the glass and walks out of the mirror
        if (o > 1.5) {
          const u = clamp((o - 1.5) / 0.8, 0, 1);
          refl.root.rotation.y = lerp(CAT_YAW, 2 * Math.PI - 0.6, smooth(u));
          refl.walk = Math.min(1, (o - 1.5) * 2); refl.stare = 0;
          const sp = 0.42 * refl.walk * CAT_SCALE;
          refl.root.position.x += Math.sin(refl.root.rotation.y) * sp * dt;
          refl.root.position.z += Math.cos(refl.root.rotation.y) * sp * dt;
        }
        if (o > 4.3 && fx.mirrorFlame > 0) { if (fx.mirrorFlame === 1) audio.snuff(); fx.mirrorFlame = Math.max(0, fx.mirrorFlame - dt * 3); }
        if (o > 5.2 && mode === 'over') showResults();
      } else if (mode === 'results') {
        run.over += dt;
        refl.walk = 0; refl.root.visible = refl.root.position.z < 4.5;
        if (refl.root.visible) { refl.walk = 1; const sp = 0.42 * CAT_SCALE; refl.root.position.x += Math.sin(refl.root.rotation.y) * sp * dt; refl.root.position.z += Math.cos(refl.root.rotation.y) * sp * dt; }
      } else if (mode === 'title') {
        fx.unease = damp(fx.unease, 0.15, 1, dt);
        // on the title the reflection is a little too still, and looks at you
        if (Math.random() < dt * 0.25) refl.lookAt((Math.random() - 0.5) * 0.3, 0.2, 2.5);
      }
      if (mode !== 'paused') {
        cat.update(dt); refl.update(dt);
        refl.stare = Math.max(0, refl.stare - dt);
        dust.update(clock, dt);
      }
      // candles breathe together; the mirror's may go out on its own
      const fl = 0.86 + Math.sin(clock * 9.1) * 0.05 + Math.sin(clock * 23.7) * 0.035 + (Math.random() - 0.5) * 0.05;
      const gutter = 1 - fx.unease * 0.28;
      LR.candle.intensity = 3.2 * fl * gutter;
      LM.candle.intensity = 3.2 * fl * gutter * fx.mirrorFlame;
      for (const [c, k] of [[R.candle, 1], [RMr.candle, fx.mirrorFlame]]) { c.flame.scale.set(0.035 * (0.9 + fl * 0.1) * k + 0.0001, 0.072 * fl * k + 0.0001, 1); c.halo.material.opacity = 0.3 * fl * k * gutter; }
      LR.moon.intensity = LM.moon.intensity = 1.5 + fx.unease * 0.35;
      // the glass
      G.uTime.value = clock;
      G.uRippleT.value += dt; G.uRipple.value = Math.max(0, G.uRipple.value - dt * 0.55);
      G.uGlintT.value += dt; G.uGlint.value = Math.max(0, G.uGlint.value - dt * 1.2);
      G.uDesync.value = damp(G.uDesync.value, fx.unease * fx.unease * 1.1 * tn('mirror_distortion', 1), 2, dt);
      G.uDark.value = damp(G.uDark.value, mode === 'results' || (mode === 'over' && run.over > 4.3) ? 0.35 : fx.unease * 0.12, 2, dt);
      if (mode === 'play' || mode === 'over' || mode === 'paused') audio.ambience(fx.unease);
      if (mode === 'play') { run.creak -= dt; if (run.creak < 0) { audio.creak(); run.creak = 7 + Math.random() * 10; } }
      // camera: still, with a breath of drift; a short shake on deviations
      fx.shake = Math.max(0, fx.shake - dt * 1.6);
      const s = fx.shake * fx.shake * 0.03 * tn('camera_shake', 1);
      camera.position.set(camBase.x + Math.sin(clock * 0.31) * 0.012 + (Math.random() - 0.5) * s, camBase.y + Math.sin(clock * 0.23) * 0.008 + (Math.random() - 0.5) * s, camBase.z);
      camera.lookAt(camLook);
      if (window.__rfCam) { camera.position.fromArray(window.__rfCam.pos); camera.lookAt(new THREE.Vector3().fromArray(window.__rfCam.look)); }
      // render: the mirror room into the glass, then the room
      if (skipRender) return;
      locateReflection();
      renderer.clippingPlanes = mirrorClip;
      renderer.setRenderTarget(rt); renderer.render(mirror, camera);
      renderer.clippingPlanes = [];
      renderer.setRenderTarget(null); renderer.render(real, camera);
    }
    function tick(dtMs) {
      if (destroyed || (window.__REFLECTION_DEV && window.__rfHold)) return;
      frame(Math.min(0.05, Math.max(0, dtMs / 1000)));
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: tick });
    else ctx.onFrame(tick);

    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__REFLECTION_DEV) {
      window.__rf = {
        begin, act, pause, resume, frame, cat, refl, camera, G, renderer,
        get D() { return D; }, get mode() { return mode; }, get run() { return run; },
        advance(sec, bot) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { frame(1 / 60, i < n - 1); if (bot) bot(D); } },
        renderMs() { const t0 = performance.now(); frame(1 / 60); renderer.getContext().finish(); return performance.now() - t0; },
        project(x, y, z) { _p.set(x, y, z).project(camera); return { x: (_p.x * 0.5 + 0.5) * ctx.width, y: (-_p.y * 0.5 + 0.5) * ctx.height }; }
      };
    }
  }
};

})();
