// Shared helpers, settings and constants.
const DEV = !!window.__DF_DEV;
let THREE = null;
let disposed = false;
ctx.onDestroy(() => { disposed = true; });

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function angDelta(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const cap = ctx.capabilities || {};
const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };

function sget(k, d) { try { if (!cap.storage) return d; const v = ctx.storage.get(k); return v == null ? d : v; } catch (e) { return d; } }
function sset(k, v) { try { if (cap.storage) ctx.storage.set(k, v); } catch (e) { } }
function tune(id, d) {
  try { const v = ctx.tune && ctx.tune.number(id); return (typeof v === 'number' && isFinite(v)) ? v : d; } catch (e) { return d; }
}
// Player preferences are device-local conveniences (sound, aim speed).
const settings = {
  sound: sget('df_sound', true) !== false,
  sens: clamp(+sget('df_sens', 1) || 1, 0.4, 2.5),
};
function haptic(kind) { if (!cap.haptics) return; try { ctx.platform.haptic(kind); } catch (e) { } }

// World scale (metres).
const CELL = 3.4;      // one grid cell
const WALL_H = 3.0;    // ceiling height
const EYE = 1.62;      // eye height
const P_RADIUS = 0.34; // player collision radius
