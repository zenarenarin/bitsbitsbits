// =====================================================================
// CATCH THE EYEBALL — shared helpers and the palette.
// World units are art pixels: x is centred on the screen, y grows upward
// from the bottom edge. One unit is one texel of the low-res framebuffer.
// =====================================================================

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => t * t * (3 - 2 * t);

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
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

// Limited colour ramps. Every sprite in the game is painted from these.
const PAL = {
  outline: '#2a0c15',        // dark maroon line work
  outlineSoft: '#4a1822',
  void: '#120609',           // pupils, jar mouth
  // dirty ivory sclera, darkest to lightest (shadow leans pink-brown)
  sclera: ['#6e4a4c', '#9c7d70', '#c4ad8f', '#ddcfae', '#efe5cb'],
  scleraBlood: ['#6f3c45', '#a06a6c', '#c99a8e', '#e0bfab', '#efd8c4'],
  scleraSick: ['#4f2d36', '#7e5559', '#a8837a', '#c7ae98', '#dccbb0'],
  vein: '#9b2f3d', veinDeep: '#6d1a28', veinPink: '#cd7f86', rimPink: '#b97677',
  gloss: '#fffaf0',
  // iris ramps: limbal ring, base, lit, fleck
  irisTeal: ['#0f2c30', '#22564f', '#3f8379', '#79b8a8'],
  irisBrown: ['#2a160e', '#57331d', '#86542c', '#bd8a4e'],
  irisBlood: ['#24100f', '#4a2119', '#6e3524', '#a2583a'],
  irisGold: ['#4a2a08', '#8a5a14', '#c48a2a', '#efc66a'],
  irisDemon: ['#0c0306', '#2c0710', '#561322', '#8e2433'],
  irisWarp: ['#0f2c30', '#2a6a66', '#5ea99d', '#a9dccb'],
  irisSplit: ['#2b0f15', '#5b2228', '#874033', '#b46c4e'],
  // eyelid flesh
  lid: ['#3a121d', '#5c2231', '#7d3846', '#9e5860'],
  // glass and liquid
  glass: '#a5b7a6', glassDark: '#2c3833', glassEdge: '#18201d', glassHi: '#e3efe5',
  rimLight: '#c2d2c2', rimMid: '#7d8f84', rimShade: '#4b5a53',
  liquid: '#77804f', liquidHi: '#a8ad72',
  label: '#c9bc97', labelShade: '#9b8c6a', ink: '#4a1822',
  // room
  wall: ['#140c13', '#1b1119', '#23161f', '#2c1c27', '#372431'],
  wood: ['#170d0d', '#24140f', '#331d15', '#47291b'],
  stone: ['#120b0f', '#1c1217', '#271a1f', '#33232a'],
  candle: ['#6b5a4c', '#a8927a', '#d6c4a5'],
  flame: ['#7a2a1e', '#c4562a', '#e8a04a', '#f6dc9a'],
  bottle: ['#1f2a28', '#2c3b37', '#3e524b', '#5f7a6f'],
  bottleRed: ['#2a1016', '#43161f', '#5f2230', '#8a3a46'],
  web: '#5a4d55',
  dust: '#a28f86'
};

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
