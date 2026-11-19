// ---------------------------------------------------------------------------
// Utilities shared by the simulation, route generator, renderer and audio.
// Everything in src/00..03 is pure (no DOM, no three) so dev/*.js can run the
// exact same simulation in Node.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const easeCos = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const fract = v => v - Math.floor(v);

// Small, fast, seedable PRNG (mulberry32).
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// A repeating cycle whose individual cycles may differ in length.
// pattern: multipliers of the base period, e.g. [1, 1, 1.4] means every third
// cycle lasts 40% longer (an operator who pauses for tea every third trip).
// Returns { i, u, dur, t0 } where u is 0..1 inside the current cycle.
function makeCycle(period, pattern, phase) {
  const pat = pattern && pattern.length ? pattern : [1];
  const durs = pat.map(m => period * m);
  const total = durs.reduce((a, b) => a + b, 0);
  const off = (phase || 0) * total;
  const out = { i: 0, u: 0, dur: durs[0], t0: 0, k: 0 };
  return function cycleAt(t) {
    const tt = t + off;
    const rep = Math.floor(tt / total);
    let r = tt - rep * total;
    let k = 0;
    while (k < durs.length - 1 && r >= durs[k]) { r -= durs[k]; k++; }
    out.k = k;
    out.i = rep * durs.length + k;
    out.dur = durs[k];
    out.u = clamp(r / durs[k], 0, 1);
    out.local = r;
    out.t0 = t - r;
    return out;
  };
}

// Shuttle profile between 0 and 1 with dwells at each end. Travel durations
// are fixed in seconds so that only the dwell stretches on longer cycles.
// Layout of one cycle: [dwell at 0][move 0->1][dwell at 1][move 1->0]
function shuttleValue(local, dur, moveT, dwellSplit) {
  const dwell = Math.max(0, dur - 2 * moveT);
  const dA = dwell * (dwellSplit == null ? 0.5 : dwellSplit);
  const dB = dwell - dA;
  if (local < dA) return 0;
  local -= dA;
  if (local < moveT) return easeCos(local / moveT);
  local -= moveT;
  if (local < dB) return 1;
  local -= dB;
  return 1 - easeCos(local / moveT);
}
