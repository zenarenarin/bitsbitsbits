// ---- Core: seeded randomness, noise, math and colour helpers ----------------
// Everything procedural is seeded from world coordinates so neighbouring tiles
// repaint identical strokes and the world never shows repeated stamps.

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed) / 4294967296;
  const b = hash2(xi + 1, yi, seed) / 4294967296;
  const c = hash2(xi, yi + 1, seed) / 4294967296;
  const d = hash2(xi + 1, yi + 1, seed) / 4294967296;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < (octaves || 4); i++) {
    sum += vnoise(x, y, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c, alpha) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha === undefined ? 1 : alpha})`;
}
// Brighten (dv > 0) toward warm cream or darken (dv < 0) toward cool violet,
// the way the reference shifts hue with value instead of adding black/white.
function shade(c, dv) {
  if (dv >= 0) return mixRGB(c, [255, 244, 228], clamp(dv, 0, 1));
  return mixRGB(c, [74, 62, 104], clamp(-dv, 0, 1));
}
function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  return mixRGB(stops[i], stops[i + 1], t - i);
}
