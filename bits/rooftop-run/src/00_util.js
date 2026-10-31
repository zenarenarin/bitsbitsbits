// =====================================================================
// ROOFTOP RUN — shared math (from UNMAKE's 00_util, trimmed).
// World axes: x = across the rooftops, y = up, -z = the way forward.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const smooth = t => t * t * (3 - 2 * t);
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  return r;
}

// A critically damped spring: x chases target with no overshoot unless
// `zeta` < 1. Used for every "physical" response in the rig and camera.
function spring(s, target, freq, zeta, dt) {
  const w = TAU * freq, f = 1 + 2 * dt * zeta * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const x = (f * s.x + dt * s.v + hhoo * target) * det;
  s.v = (s.v + hoo * (target - s.x)) * det;
  s.x = x;
  return x;
}
const mkSpring = x => ({ x: x || 0, v: 0 });
