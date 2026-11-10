// Shared maths: seeded randomness, easing, angles and the OKLCH colour space.
// Everything here is pure, so the puzzle and theme engines can run in Node tests.

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mod(n, m) { return ((n % m) + m) % m; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
// Snapping uses a pure ease-out: decelerates into place, never passes the target.
function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
function easeOutQuint(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 5); }
function easeInOutSine(t) { t = clamp(t, 0, 1); return -(Math.cos(Math.PI * t) - 1) / 2; }

// Wrap an angle difference into (-PI, PI] so dragging across 0/360 never jumps.
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// FNV-1a string hash -> uint32, used to turn a date or level key into a seed.
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small, fast, deterministic across JS engines.
function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  const next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.chance = p => next() < p;
  return next;
}

// ---- OKLCH colour ----------------------------------------------------------
// Palettes are authored in OKLCH so lightness and chroma stay perceptually even
// around the wheel (an RGB rainbow has a glaring yellow and a muddy blue).

function oklchToOklab(L, C, hDeg) {
  const h = hDeg * Math.PI / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}

function inGamut(rgb) { return rgb[0] >= -0.0005 && rgb[0] <= 1.0005 && rgb[1] >= -0.0005 && rgb[1] <= 1.0005 && rgb[2] >= -0.0005 && rgb[2] <= 1.0005; }

function gammaEncode(x) {
  x = clamp(x, 0, 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// Bring an OKLCH colour into sRGB by reducing chroma only (hue and lightness hold).
function gamutMap(L, C, h) {
  L = clamp(L, 0, 1);
  let lab = oklchToOklab(L, C, h);
  if (inGamut(oklabToLinear(lab[0], lab[1], lab[2]))) return [L, C, h];
  let lo = 0, hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    lab = oklchToOklab(L, mid, h);
    if (inGamut(oklabToLinear(lab[0], lab[1], lab[2]))) lo = mid; else hi = mid;
  }
  return [L, lo, h];
}

// A colour record carries its OKLab coordinates (for maths) and sRGB (for drawing).
function colour(L, C, h) {
  const m = gamutMap(L, Math.max(0, C), mod(h, 360));
  const lab = oklchToOklab(m[0], m[1], m[2]);
  const lin = oklabToLinear(lab[0], lab[1], lab[2]);
  const r = Math.round(gammaEncode(lin[0]) * 255);
  const g = Math.round(gammaEncode(lin[1]) * 255);
  const b = Math.round(gammaEncode(lin[2]) * 255);
  return { L: m[0], C: m[1], h: m[2], lab, r, g, b, css: 'rgb(' + r + ',' + g + ',' + b + ')' };
}

function rgba(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (+a).toFixed(3) + ')'; }

function deltaE(c1, c2) {
  const dl = c1.lab[0] - c2.lab[0], da = c1.lab[1] - c2.lab[1], db = c1.lab[2] - c2.lab[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

// Mix two colour records in OKLab (used by theme transitions).
function mixColour(c1, c2, t) {
  const L = lerp(c1.lab[0], c2.lab[0], t), a = lerp(c1.lab[1], c2.lab[1], t), b = lerp(c1.lab[2], c2.lab[2], t);
  const C = Math.sqrt(a * a + b * b);
  const h = Math.atan2(b, a) * 180 / Math.PI;
  return colour(L, C, h);
}

// WCAG relative luminance and contrast, for interface text checks.
function relLum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrastRatio(c1, c2) {
  const a = relLum(c1), b = relLum(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---- Calendar --------------------------------------------------------------
// The daily edition follows the player's local calendar date, like a newspaper puzzle.
const ORBIT_EPOCH = Date.UTC(2026, 10, 1); // No. 1 = 1 Nov 2026

function dateKey(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function dayNumberFromKey(key) {
  const p = key.split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - ORBIT_EPOCH) / 86400000) + 1;
}
function keyFromDayNumber(n) {
  const d = new Date(ORBIT_EPOCH + (n - 1) * 86400000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function prettyDate(key) {
  const p = key.split('-').map(Number);
  return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
}
function pad3(n) { n = Math.max(0, n | 0); return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
function fmtTime(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
