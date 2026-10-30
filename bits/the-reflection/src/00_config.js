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
