// Small shared helpers: seeded random numbers, colour mixing, maths.

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
// Mix two hex colours, t = 0 gives a, t = 1 gives b.
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
function rgba(h, a) {
  const c = hexToRgb(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// The palette. Burgundy and cream carry the scene; vermilion and mustard are
// the accents; cobalt is used sparingly.
const PAL = {
  burgundy: '#4a1420', burgundyDeep: '#2e0b13', wine: '#6b1d2a',
  vermilion: '#e0452b', tomato: '#b8321f', orange: '#d9682a',
  mustard: '#e3a931', ochre: '#c58a2c', olive: '#6f7a32', forest: '#2f4a2c',
  cream: '#f3e6c8', creamDeep: '#e2cfa3', cobalt: '#2a4f9e', cobaltDeep: '#1b3570',
  umber: '#3b2416', ink: '#26140e', terracotta: '#a9472b', wood: '#7a4524',
  brass: '#c99a3e', brassLight: '#f2d27a', brassDark: '#7a5418'
};
