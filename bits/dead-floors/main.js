// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// DEAD FLOORS — an endless first-person zombie shooter for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
window.plethoraBit = {
  meta: {},
  async init(ctx) {
// ---- 00_util.js ----
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

// ---- 01_audio.js ----
// Procedural sound: every effect is synthesised once into a small WAV data URL
// and played through ctx.audio. Music beds come from ctx.music.
const SR = 22050;
const sfx = {};
const sfxLast = {};
let sfxReady = false;

function noise() { return Math.random() * 2 - 1; }
function makeSVF(fc, damp) {
  const f = 2 * Math.sin(Math.PI * Math.min(fc, SR * 0.23) / SR);
  const s = { low: 0, band: 0, high: 0 };
  s.run = (x) => { s.low += f * s.band; s.high = x - s.low - damp * s.band; s.band += f * s.high; return s; };
  return s;
}
function synth(dur, fn, peak = 0.92) {
  const n = Math.max(1, Math.floor(dur * SR));
  const out = new Float32Array(n);
  let mx = 1e-6;
  for (let i = 0; i < n; i++) { const v = fn(i / SR, i); out[i] = v; const a = Math.abs(v); if (a > mx) mx = a; }
  const g = peak / mx;
  for (let i = 0; i < n; i++) out[i] *= g;
  const fo = Math.min(n, 300);
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return out;
}
function toWav(s) {
  const n = s.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, clamp(s[i], -1, 1) * 32767, true);
  const u8 = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

function shotSound(o) {
  const { dur = 0.45, tail = 7, bright = 0.5, thumpF = 85, thump = 0.8, crack = 0.8, lpF = 2500, ring = 0 } = o;
  const lp = makeSVF(lpF, 0.7), lp2 = makeSVF(lpF * 0.3, 0.9);
  let ph = 0, rp = 0;
  return synth(dur, (t) => {
    const n = noise(), e = Math.exp(-t * tail);
    lp.run(n); lp2.run(n);
    ph += TAU * thumpF * (1 - Math.min(0.65, t * 3)) / SR;
    rp += TAU * (ring || 1) / SR;
    const c = n * Math.exp(-t * 110) * crack;
    const th = Math.sin(ph) * Math.exp(-t * 15) * thump;
    const body = (lp.low * bright + lp2.low * (1 - bright) * 1.8) * e;
    const rg = ring ? Math.sin(rp) * Math.exp(-t * 7) * 0.12 : 0;
    return body + c + th + rg;
  });
}
function groanSound(f0, dur, seed) {
  const f1 = makeSVF(420 + seed * 160, 0.22), f2 = makeSVF(980 + seed * 260, 0.3), lp = makeSVF(1700, 0.8);
  let ph = 0;
  return synth(dur, (t) => {
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t / dur)), 0.6);
    const f = f0 * (1 + 0.07 * Math.sin(TAU * 6.1 * t) + 0.14 * Math.sin(TAU * 0.8 * t + seed * 3)) * (1 - 0.22 * t / dur);
    ph += f / SR;
    const saw = (ph % 1) * 2 - 1;
    const src = saw * 0.75 + noise() * 0.4;
    const a = f1.run(src).band, b = f2.run(src).band;
    lp.run(a + b * 0.55);
    return lp.low * env;
  }, 0.8);
}
function burst(dur, fc, damp, tail, gain = 1) {
  const f = makeSVF(fc, damp);
  return (t) => f.run(noise()).band * Math.exp(-t * tail) * gain;
}

function buildSounds() {
  if (sfxReady) return;
  const S = {};
  S.pistol = shotSound({ dur: 0.42, tail: 9, thumpF: 95, crack: 0.9, lpF: 3000 });
  S.magnum = shotSound({ dur: 0.85, tail: 4.2, thumpF: 68, thump: 1.1, crack: 1, lpF: 2100, ring: 1900 });
  S.smg = shotSound({ dur: 0.2, tail: 17, thumpF: 120, thump: 0.6, crack: 0.8, lpF: 3800 });
  S.shotgun = shotSound({ dur: 0.95, tail: 3.6, thumpF: 58, thump: 1.2, crack: 0.9, lpF: 1600, bright: 0.3 });
  S.rifle = shotSound({ dur: 0.42, tail: 8.5, thumpF: 82, thump: 0.9, crack: 1, lpF: 3300 });
  S.dmr = shotSound({ dur: 0.95, tail: 3.8, thumpF: 72, thump: 1, crack: 1.15, lpF: 2700, ring: 2400 });
  S.hmg = shotSound({ dur: 0.28, tail: 12, thumpF: 88, thump: 1, crack: 0.9, lpF: 2500 });
  // Railgun: rising whine then a hard crack.
  { let ph = 0; S.rail = synth(0.9, (t) => { const f = t < 0.12 ? 600 + t * 9000 : 1800 * Math.exp(-(t - 0.12) * 5) + 90; ph += TAU * f / SR; return Math.sin(ph) * (t < 0.12 ? t * 4 : Math.exp(-(t - 0.12) * 4)) * 0.6 + (t > 0.12 ? noise() * Math.exp(-(t - 0.12) * 14) : 0); }); }
  { let ph = 0; S.plasma = synth(0.28, (t) => { ph += TAU * (1100 * Math.exp(-t * 9) + 160) / SR; return Math.sign(Math.sin(ph)) * 0.4 * Math.exp(-t * 10) + noise() * 0.25 * Math.exp(-t * 30); }); }
  { let ph = 0; const f = makeSVF(3000, 0.4); S.tesla = synth(0.32, (t) => { ph += TAU * 118 / SR; const gate = Math.random() < 0.35 ? 1 : 0.2; return (f.run(noise()).band * gate + Math.sin(ph) * 0.35) * Math.exp(-t * 6); }); }
  { const f = makeSVF(700, 0.6); S.rocket = synth(0.7, (t) => { f.run(noise()); return f.low * Math.min(1, t * 20) * Math.exp(-t * 3) + Math.sin(TAU * 70 * t) * Math.exp(-t * 20) * 0.6; }); }
  { const f = makeSVF(380, 0.8), f2 = makeSVF(120, 0.9); let ph = 0; S.boom = synth(1.5, (t) => { const n = noise(); f.run(n); f2.run(n); ph += TAU * (55 - t * 20) / SR; return (f.low * 0.8 + f2.low * 1.6) * Math.exp(-t * 2.6) + Math.sin(ph) * Math.exp(-t * 6) * 0.9 + n * Math.exp(-t * 60) * 0.5; }); }
  S.click = synth(0.05, burst(0.05, 3400, 0.3, 120));
  { const a = burst(0.1, 2600, 0.25, 70), b = burst(0.1, 1800, 0.2, 60), c = burst(0.1, 3200, 0.3, 90); S.reload = synth(0.55, (t) => (t < 0.08 ? a(t) : 0) + (t > 0.22 && t < 0.32 ? b(t - 0.22) : 0) + (t > 0.4 ? c(t - 0.4) : 0)); }
  { let p1 = 0; S.pickup = synth(0.28, (t) => { const f = t < 0.09 ? 740 : 1110; p1 += TAU * f / SR; return Math.sin(p1) * Math.exp(-((t % 0.09) * 18)) * 0.6 + burst(0, 2800, 0.3, 80)(t) * 0.0; }); }
  { let p1 = 0, p2 = 0; S.med = synth(0.5, (t) => { p1 += TAU * 523 / SR; p2 += TAU * 784 / SR; return (Math.sin(p1) + Math.sin(p2) * (t > 0.12 ? 1 : 0)) * Math.exp(-t * 5) * 0.5; }); }
  { let p = 0; const k = burst(0, 2400, 0.25, 50); S.weapon = synth(0.9, (t) => { const f = [392, 523, 659, 784][Math.min(3, Math.floor(t / 0.11))]; p += TAU * f / SR; return Math.sin(p) * 0.45 * Math.exp(-((t % 0.11) * 9)) * (t < 0.44 ? 1 : Math.exp(-(t - 0.44) * 5)) + (t > 0.5 && t < 0.6 ? k(t - 0.5) * 1.2 : 0); }); }
  { const f = makeSVF(260, 0.7); let ph = 0; S.hurt = synth(0.35, (t) => { f.run(noise()); ph += TAU * (150 - t * 160) / SR; return f.low * 2 * Math.exp(-t * 14) + ((ph / TAU) % 1 - 0.5) * 0.5 * Math.exp(-t * 7); }); }
  { const f = makeSVF(650, 0.35); S.zhit = synth(0.2, (t) => f.run(noise()).band * Math.exp(-t * 22) + Math.sin(TAU * 90 * t) * Math.exp(-t * 30) * 0.5); }
  { const f = makeSVF(900, 0.25); S.splat = synth(0.4, (t) => f.run(noise()).band * Math.exp(-t * 9) * (0.6 + 0.4 * Math.sin(TAU * 30 * t))); }
  S.groan0 = groanSound(78, 1.25, 0);
  S.groan1 = groanSound(96, 1.0, 1);
  S.groan2 = groanSound(66, 1.5, 2);
  S.zdie = groanSound(88, 0.9, 1.5);
  S.roar = groanSound(48, 1.9, 0.4);
  { const f = makeSVF(1300, 0.3); S.spit = synth(0.3, (t) => f.run(noise()).band * Math.exp(-t * 12)); }
  { let a = 0, b = 0; S.ding = synth(1.2, (t) => { a += TAU * 880 / SR; b += TAU * 660 / SR; return Math.sin(a) * Math.exp(-t * 4) * (t < 0.3 ? 1 : 0) + Math.sin(b) * Math.exp(-(t - 0.3) * 3) * (t >= 0.3 ? 1 : 0); }); }
  { const f = makeSVF(160, 0.8); S.step = synth(0.12, (t) => { f.run(noise()); return f.low * Math.exp(-t * 30); }); }
  { const f = makeSVF(220, 0.9); S.door = synth(1.0, (t) => { f.run(noise()); return f.low * (t < 0.8 ? 1 : Math.exp(-(t - 0.8) * 20)) * 0.7 + Math.sin(TAU * 60 * t) * 0.15; }); }
  { let p = 0; S.heart = synth(0.5, (t) => { p += TAU * 55 / SR; const e = Math.exp(-((t) * 25)) + (t > 0.18 ? Math.exp(-((t - 0.18) * 25)) * 0.7 : 0); return Math.sin(p) * e; }); }
  for (const k in S) sfx[k] = toWav(S[k]);
  sfxReady = true;
}

function play(name, vol = 1, minGap = 25) {
  if (!settings.sound || !cap.audio || !sfxReady) return;
  const url = sfx[name]; if (!url) return;
  const now = performance.now();
  if (sfxLast[name] && now - sfxLast[name] < minGap) return;
  sfxLast[name] = now;
  try { ctx.audio.play(url, { volume: clamp(vol, 0, 1) }); } catch (e) { }
}
function play3(name, x, z, vol = 1, gap = 25) {
  const d = Math.hypot(x - P.x, z - P.z);
  const v = vol / (1 + d * d * 0.018);
  if (v > 0.035) play(name, v, gap);
}

// Music bed follows the situation: exploring, fighting, boss.
let music = null, musicMode = '', musicPreset = '';
const MUSIC = {
  title: { preset: 'drone', volume: 0.3, intensity: 0.25, tempo: 66 },
  explore: { preset: 'spooky', volume: 0.26, intensity: 0.3, tempo: 78 },
  combat: { preset: 'spooky', volume: 0.32, intensity: 0.78, tempo: 92 },
  boss: { preset: 'techno', volume: 0.3, intensity: 0.92, tempo: 128 },
};
function musicSet(mode) {
  if (!cap.backgroundMusic) return;
  if (!settings.sound) {
    if (music) { try { ctx.music.stop({ fadeOutMs: 250 }); } catch (e) { } }
    music = null; musicMode = ''; musicPreset = '';
    return;
  }
  if (mode === musicMode && music) return;
  musicMode = mode;
  const c = MUSIC[mode]; if (!c) return;
  try {
    if (!music) { music = ctx.music.play({ ...c, fadeInMs: 1400 }); musicPreset = c.preset; }
    else if (musicPreset !== c.preset) { ctx.music.setPreset(c.preset, { ...c, fadeMs: 900 }); musicPreset = c.preset; }
    else { ctx.music.setIntensity(c.intensity, { fadeMs: 1200 }); ctx.music.setTempo(c.tempo); ctx.music.setVolume(c.volume, { fadeMs: 800 }); }
  } catch (e) { }
}
function sting(name) {
  if (!settings.sound || !cap.backgroundMusic) return;
  try { const p = ctx.music.sting(name); if (p && p.catch) p.catch(() => { }); } catch (e) { }
}
function unlockAudio() {
  if (!cap.backgroundMusic) return;
  try { const p = ctx.music.unlock(); if (p && p.catch) p.catch(() => { }); } catch (e) { }
}

// ---- 02_tex.js ----
// Procedural textures: grimy institutional concrete, tiles, steel, skin, cloth and blood.
const TEX = {};
// One hidden SDK-managed canvas is reused to paint every texture; each result is copied
// into a DataTexture before the next one is painted.
let scratch = null;
function cnv(w, h) {
  if (!scratch) {
    scratch = ctx.createCanvas2D({ layer: 'background', order: -10, input: 'passthrough', willReadFrequently: true });
    scratch.style.display = 'none';
  }
  scratch.width = w; scratch.height = h;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return scratch;
}
function grain(g, w, h, amp, R, mono = true) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amp;
    if (mono) { d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255); }
    else { d[i] = clamp(d[i] + (R() - 0.5) * amp, 0, 255); d[i + 1] = clamp(d[i + 1] + (R() - 0.5) * amp, 0, 255); d[i + 2] = clamp(d[i + 2] + (R() - 0.5) * amp, 0, 255); }
  }
  g.putImageData(id, 0, 0);
}
function blotch(g, x, y, r, color, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace('A', a)); gr.addColorStop(1, color.replace('A', 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
function blotches(g, w, h, R, n, color, rmin, rmax, amin, amax) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rmin + R() * (rmax - rmin), a = amin + R() * (amax - amin);
    // wrap so tiling stays seamless
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) if (x + ox + r > 0 && x + ox - r < w && y + oy + r > 0 && y + oy - r < h) blotch(g, x + ox, y + oy, r, color, a);
  }
}
function crack(g, x, y, len, R, color = 'rgba(20,18,15,0.55)') {
  g.strokeStyle = color; g.lineWidth = 1 + R(); g.beginPath(); g.moveTo(x, y);
  let a = R() * TAU;
  for (let i = 0; i < len; i++) { a += (R() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
  g.stroke();
}
function mkTex(c, srgb = true, rep = true) {
  const w = c.width, h = c.height;
  const src = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4), row = w * 4;
  for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

function buildTextures() {
  const R = mulberry32(1337);
  // Floor: worn vinyl tiles over concrete, stains, cracks.
  {
    const S = 512, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#5b574e'; g.fillRect(0, 0, S, S);
    const n = 4, ts = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = 80 + R() * 22; g.fillStyle = `rgb(${v + 4},${v},${v - 8})`;
      g.fillRect(i * ts + 1, j * ts + 1, ts - 2, ts - 2);
      if (R() < 0.18) { g.fillStyle = 'rgba(40,36,30,0.55)'; g.fillRect(i * ts + 1 + R() * 30, j * ts + 1 + R() * 30, ts * (0.3 + R() * 0.5), ts * (0.3 + R() * 0.5)); }
    }
    g.strokeStyle = 'rgba(25,22,18,0.8)'; g.lineWidth = 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * ts, 0); g.lineTo(i * ts, S); g.stroke(); g.beginPath(); g.moveTo(0, i * ts); g.lineTo(S, i * ts); g.stroke(); }
    blotches(g, S, S, R, 26, 'rgba(38,30,20,A)', 20, 90, 0.15, 0.4);
    blotches(g, S, S, R, 6, 'rgba(70,18,14,A)', 10, 40, 0.15, 0.35);
    for (let i = 0; i < 9; i++) crack(g, R() * S, R() * S, 8 + R() * 18, R);
    grain(g, S, S, 26, R);
    TEX.floor = mkTex(c);
    // Roughness map: puddles read as glossy under the flashlight.
    const r = cnv(256, 256), rg = r.getContext('2d');
    rg.fillStyle = '#d0d0d0'; rg.fillRect(0, 0, 256, 256);
    blotches(rg, 256, 256, R, 7, 'rgba(30,30,30,A)', 18, 55, 0.6, 0.95);
    grain(rg, 256, 256, 40, R);
    TEX.floorRough = mkTex(r, false);
  }
  // Walls: two-tone institutional paint, grime drips, scuffs. Covers two cells wide.
  {
    const W = 1024, H = 512, c = cnv(W, H), g = c.getContext('2d');
    const split = H * 0.62;
    let gr = g.createLinearGradient(0, 0, 0, split);
    gr.addColorStop(0, '#6f6a5c'); gr.addColorStop(1, '#8b8676');
    g.fillStyle = gr; g.fillRect(0, 0, W, split);
    gr = g.createLinearGradient(0, split, 0, H);
    gr.addColorStop(0, '#3e4a41'); gr.addColorStop(1, '#2c342e');
    g.fillStyle = gr; g.fillRect(0, split, W, H - split);
    g.fillStyle = '#24261f'; g.fillRect(0, split - 5, W, 9);
    g.fillStyle = '#1b1c18'; g.fillRect(0, H - 22, W, 22);
    for (let i = 0; i < 70; i++) {
      const x = R() * W, w = 2 + R() * 14, len = 30 + R() * 260, a = 0.05 + R() * 0.18;
      const d = g.createLinearGradient(0, 0, 0, len);
      d.addColorStop(0, `rgba(45,38,25,${a})`); d.addColorStop(1, 'rgba(45,38,25,0)');
      g.fillStyle = d; g.fillRect(x, 0, w, len);
    }
    blotches(g, W, H, R, 16, 'rgba(70,58,35,A)', 30, 120, 0.1, 0.3);
    blotches(g, W, H, R, 10, 'rgba(20,20,16,A)', 20, 80, 0.15, 0.35);
    g.strokeStyle = 'rgba(30,28,22,0.35)';
    for (let i = 0; i < 40; i++) { g.lineWidth = 0.5 + R() * 1.5; const x = R() * W, y = split - 80 + R() * 200; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 120, y + (R() - 0.5) * 20); g.stroke(); }
    for (let i = 0; i < 6; i++) crack(g, R() * W, R() * split, 6 + R() * 14, R, 'rgba(25,22,18,0.5)');
    grain(g, W, H, 22, R);
    TEX.wall = mkTex(c);
  }
  // Ceiling: acoustic tiles with water rings.
  {
    const S = 512, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#9a968a'; g.fillRect(0, 0, S, S);
    const n = 2, ts = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 128 + R() * 18; g.fillStyle = `rgb(${v},${v - 3},${v - 10})`; g.fillRect(i * ts + 4, j * ts + 4, ts - 8, ts - 8); }
    g.fillStyle = '#4a4a46'; for (let i = 0; i <= n; i++) { g.fillRect(i * ts - 4, 0, 8, S); g.fillRect(0, i * ts - 4, S, 8); }
    for (let i = 0; i < 6; i++) { const x = R() * S, y = R() * S, r = 20 + R() * 60; g.strokeStyle = 'rgba(90,70,40,0.35)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); blotch(g, x, y, r, 'rgba(110,90,55,A)', 0.25); }
    grain(g, S, S, 30, R);
    TEX.ceil = mkTex(c);
  }
  // Brushed steel for elevators, doors, props.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#8a8d90'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) { g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},255,${R() * 0.05})`; g.fillRect(0, y, S, 1); }
    blotches(g, S, S, R, 8, 'rgba(60,45,30,A)', 10, 40, 0.1, 0.3);
    grain(g, S, S, 14, R);
    TEX.steel = mkTex(c);
  }
  // Wooden crate planks.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#6e5233'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) { const v = 90 + R() * 30; g.fillStyle = `rgb(${v + 20},${v - 5},${v - 40})`; g.fillRect(4, i * 64 + 3, S - 8, 58); }
    g.strokeStyle = 'rgba(40,25,10,0.35)'; for (let i = 0; i < 60; i++) { g.lineWidth = 1; const y = R() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + R() * 6, 160, y - R() * 6, S, y); g.stroke(); }
    g.fillStyle = '#3d2b18'; g.fillRect(0, 0, 14, S); g.fillRect(S - 14, 0, 14, S); g.fillRect(0, 0, S, 10); g.fillRect(0, S - 10, S, 10);
    grain(g, S, S, 20, R);
    TEX.crate = mkTex(c);
  }
  // Rusty painted barrel.
  {
    const W = 256, H = 128, c = cnv(W, H), g = c.getContext('2d');
    g.fillStyle = '#5a2a1e'; g.fillRect(0, 0, W, H);
    blotches(g, W, H, R, 30, 'rgba(120,60,25,A)', 6, 26, 0.3, 0.7);
    blotches(g, W, H, R, 10, 'rgba(30,20,15,A)', 8, 30, 0.3, 0.6);
    g.fillStyle = 'rgba(20,15,10,0.7)'; g.fillRect(0, 30, W, 6); g.fillRect(0, 92, W, 6);
    g.fillStyle = 'rgba(210,170,40,0.75)'; g.fillRect(90, 46, 76, 36);
    g.fillStyle = 'rgba(20,15,10,0.9)'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('☢', 128, 74);
    grain(g, W, H, 24, R);
    TEX.barrel = mkTex(c);
  }
  // Ammo box and medkit.
  {
    const c = cnv(256, 128), g = c.getContext('2d');
    g.fillStyle = '#4b5531'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a4226'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 114, 256, 14);
    g.fillStyle = '#d9c25a'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText('AMMO', 128, 80);
    grain(g, 256, 128, 18, R);
    TEX.ammo = mkTex(c, true, false);
    const m = cnv(256, 128), mg = m.getContext('2d');
    mg.fillStyle = '#e8e4da'; mg.fillRect(0, 0, 256, 128);
    mg.fillStyle = '#c3221c'; mg.fillRect(110, 24, 36, 80); mg.fillRect(88, 46, 80, 36);
    grain(mg, 256, 128, 14, R);
    TEX.med = mkTex(m, true, false);
  }
  // Zombie skin: mottled grey-green with bruising, veins and dried blood.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#9aa08a'; g.fillRect(0, 0, S, S);
    blotches(g, S, S, R, 40, 'rgba(70,80,55,A)', 8, 34, 0.3, 0.6);
    blotches(g, S, S, R, 16, 'rgba(90,50,70,A)', 6, 24, 0.25, 0.55);
    blotches(g, S, S, R, 12, 'rgba(90,15,10,A)', 4, 20, 0.4, 0.8);
    g.strokeStyle = 'rgba(70,40,80,0.35)'; for (let i = 0; i < 20; i++) crack(g, R() * S, R() * S, 4 + R() * 6, R, 'rgba(70,40,85,0.3)');
    grain(g, S, S, 30, R);
    TEX.skin = mkTex(c);
  }
  // Clothes: dirty fabric weave with blood soak (tinted by material colour).
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#d8d8d4'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) { g.fillStyle = `rgba(0,0,0,${0.04 + R() * 0.05})`; g.fillRect(0, y, S, 1); }
    blotches(g, S, S, R, 18, 'rgba(70,55,40,A)', 10, 40, 0.25, 0.5);
    blotches(g, S, S, R, 9, 'rgba(110,10,8,A)', 10, 46, 0.45, 0.85);
    g.strokeStyle = 'rgba(20,15,10,0.6)'; for (let i = 0; i < 8; i++) { g.lineWidth = 2; const x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + R() * 20, y + (R() - 0.5) * 30); g.stroke(); }
    grain(g, S, S, 26, R);
    TEX.cloth = mkTex(c);
  }
  // Blood decals.
  TEX.blood = [];
  for (let v = 0; v < 3; v++) {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    const col = (a) => `rgba(${70 + R() * 30},${4 + R() * 6},${4 + R() * 4},${a})`;
    for (let i = 0; i < 16; i++) { const a = R() * TAU, d = R() * 40, r = 14 + R() * 36; g.fillStyle = col(0.82); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 40; i++) { const a = R() * TAU, d = 50 + R() * 70, r = 1 + R() * 6; g.fillStyle = col(0.85); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 6; i++) { const a = R() * TAU; g.strokeStyle = col(0.8); g.lineWidth = 3 + R() * 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * (80 + R() * 40), cy + Math.sin(a) * (80 + R() * 40)); g.stroke(); }
    const id = g.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) { const n = (R() - 0.5) * 30; d[i] = clamp(d[i] + n, 0, 255); } }
    g.putImageData(id, 0, 0);
    TEX.blood.push(mkTex(c, true, false));
  }
  // Bullet hole.
  {
    const S = 64, c = cnv(S, S), g = c.getContext('2d');
    blotch(g, 32, 32, 30, 'rgba(30,26,20,A)', 0.55);
    g.fillStyle = 'rgba(8,7,6,0.95)'; g.beginPath(); g.arc(32, 32, 6, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(15,12,10,0.7)'; for (let i = 0; i < 7; i++) { const a = R() * TAU; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * (10 + R() * 14), 32 + Math.sin(a) * (10 + R() * 14)); g.stroke(); }
    TEX.hole = mkTex(c, true, false);
  }
  // Soft round particle and muzzle flash star.
  {
    const c = cnv(64, 64), g = c.getContext('2d');
    blotch(g, 32, 32, 31, 'rgba(255,255,255,A)', 1);
    TEX.soft = mkTex(c, false, false);
    const f = cnv(128, 128), fg = f.getContext('2d');
    fg.translate(64, 64);
    for (let i = 0; i < 7; i++) {
      fg.rotate(TAU / 7 + R() * 0.3);
      const gr = fg.createLinearGradient(0, 0, 60, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      fg.fillStyle = gr; fg.beginPath(); fg.moveTo(0, -5); fg.lineTo(56 + R() * 6, 0); fg.lineTo(0, 5); fg.fill();
    }
    fg.setTransform(1, 0, 0, 1, 0, 0);
    blotch(fg, 64, 64, 34, 'rgba(255,230,170,A)', 1);
    TEX.flash = mkTex(f, true, false);
  }
}

// A stencilled floor sign, made per floor.
function floorSignTexture(n) {
  const c = cnv(512, 160), g = c.getContext('2d');
  g.fillStyle = '#1d1f1c'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#c9b23a'; g.lineWidth = 10; g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#d9c64a'; g.font = 'bold 92px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('FLOOR ' + String(n).padStart(2, '0'), 256, 84);
  const R = mulberry32(n * 31);
  grain(g, 512, 160, 30, R);
  blotches(g, 512, 160, R, 4, 'rgba(90,10,8,A)', 10, 30, 0.5, 0.8);
  return mkTex(c, true, false);
}

// ---- 03_level.js ----
// Level generation: rooms joined by corridors on a grid, an arrival elevator and an
// exit elevator in the farthest room. Every fifth floor is a boss arena.
// Grid values: 0 solid, 1 open, 2 start elevator, 3 exit elevator.
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function genLevel(floor, seed) {
  const R = mulberry32(seed);
  const ri = (a, b) => Math.floor(a + R() * (b - a + 1));
  const boss = floor % 5 === 0;
  const N = boss ? 21 : Math.min(34, 20 + floor);
  const g = new Uint8Array(N * N);
  const roomOf = new Int16Array(N * N).fill(-1);
  const rooms = [];
  const id = (x, y) => y * N + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  function addRoom(x, y, w, h, kind = 'room') {
    const r = { x, y, w, h, cx: x + (w - 1) / 2, cy: y + (h - 1) / 2, id: rooms.length, kind };
    rooms.push(r);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { g[id(i, j)] = 1; roomOf[id(i, j)] = r.id; }
    return r;
  }
  function free(x, y, w, h) {
    for (const r of rooms) if (!(x + w + 1 <= r.x || r.x + r.w + 1 <= x || y + h + 1 <= r.y || r.y + r.h + 1 <= y)) return false;
    return true;
  }
  function open(x, y) { if (inb(x, y) && g[id(x, y)] === 0) g[id(x, y)] = 1; }
  function carve(A, B) {
    let x = Math.round(A.cx), y = Math.round(A.cy);
    const tx = Math.round(B.cx), ty = Math.round(B.cy);
    const sx = () => { while (x !== tx) { x += Math.sign(tx - x); open(x, y); } };
    const sy = () => { while (y !== ty) { y += Math.sign(ty - y); open(x, y); } };
    if (R() < 0.5) { sx(); sy(); } else { sy(); sx(); }
  }

  let startRoom, arena = null;
  if (!boss) {
    const corner = ri(0, 3);
    const sxp = corner & 1 ? N - 5 - ri(0, 2) : 2 + ri(0, 2);
    const syp = corner & 2 ? N - 5 - ri(0, 2) : 2 + ri(0, 2);
    startRoom = addRoom(sxp, syp, 3, 3, 'start');
    const target = Math.min(15, 7 + Math.floor(floor / 2));
    for (let t = 0; t < 600 && rooms.length < target; t++) {
      const w = ri(2, 5), h = ri(2, 5), x = ri(2, N - 2 - w), y = ri(2, N - 2 - h);
      if (free(x, y, w, h)) addRoom(x, y, w, h);
    }
    // Minimum spanning tree over room centres, plus a few loops.
    const inT = [0], rest = rooms.slice(1).map(r => r.id), conn = [];
    while (rest.length) {
      let best = null, bd = 1e9;
      for (const a of inT) for (const b of rest) {
        const d = Math.abs(rooms[a].cx - rooms[b].cx) + Math.abs(rooms[a].cy - rooms[b].cy);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      conn.push(best); inT.push(best[1]); rest.splice(rest.indexOf(best[1]), 1);
    }
    for (let k = 0; k < Math.floor(rooms.length / 3); k++) { const a = ri(0, rooms.length - 1), b = ri(0, rooms.length - 1); if (a !== b) conn.push([a, b]); }
    for (const [a, b] of conn) carve(rooms[a], rooms[b]);
  } else {
    const c = Math.floor(N / 2);
    arena = addRoom(c - 4, c - 4, 9, 9, 'arena');
    startRoom = addRoom(2, c - 1, 3, 3, 'start');
    const side1 = addRoom(c - 1, 2, 3, 2, 'cache');
    const side2 = addRoom(c - 1, N - 4, 3, 2, 'cache');
    carve(startRoom, arena); carve(side1, arena); carve(side2, arena);
    // Pillars for cover.
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { g[id(c + dx, c + dy)] = 0; roomOf[id(c + dx, c + dy)] = -1; }
  }

  // BFS distances over open cells.
  function bfs(sx, sy) {
    const d = new Int16Array(N * N).fill(-1); const q = [id(sx, sy)]; d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const nk = id(nx, ny); if (g[nk] === 1 && d[nk] < 0) { d[nk] = d[k] + 1; q.push(nk); } }
    }
    return d;
  }
  const sc = [Math.round(startRoom.cx), Math.round(startRoom.cy)];
  const dStart = bfs(sc[0], sc[1]);
  // Drop anything unreachable (should not happen, but be safe).
  for (let k = 0; k < N * N; k++) if (g[k] === 1 && dStart[k] < 0) { g[k] = 0; roomOf[k] = -1; }

  function elevatorSpots(room) {
    const c = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      if (g[id(i, j)] !== 1) continue;
      for (const [dx, dy] of DIR4) {
        const ex = i + dx, ey = j + dy;
        if (ex < 1 || ey < 1 || ex > N - 2 || ey > N - 2 || g[id(ex, ey)] !== 0) continue;
        let ok = true;
        for (const [qx, qy] of DIR4) { const nx = ex + qx, ny = ey + qy; if (nx === i && ny === j) continue; if (g[id(nx, ny)] !== 0) ok = false; }
        if (ok) c.push({ ex, ey, rx: i, ry: j, dx, dy });
      }
    }
    return c;
  }
  let exitRoom;
  if (boss) exitRoom = arena;
  else {
    let bd = -1;
    for (const r of rooms) { if (r === startRoom) continue; const d = dStart[id(Math.round(r.cx), Math.round(r.cy))]; if (d > bd && elevatorSpots(r).length) { bd = d; exitRoom = r; } }
  }
  const sSpots = elevatorSpots(startRoom);
  if (!exitRoom || !sSpots.length) return genLevel(floor, (seed + 7777) >>> 0);
  const start = sSpots[ri(0, sSpots.length - 1)];
  g[id(start.ex, start.ey)] = 2;
  let eSpots = elevatorSpots(exitRoom).filter(s => Math.abs(s.ex - start.ex) + Math.abs(s.ey - start.ey) > 3);
  if (!eSpots.length) eSpots = elevatorSpots(exitRoom);
  eSpots.sort((a, b) => dStart[id(b.rx, b.ry)] - dStart[id(a.rx, a.ry)]);
  const exit = eSpots[boss ? 0 : ri(0, Math.min(2, eSpots.length - 1))];
  g[id(exit.ex, exit.ey)] = 3;

  const nearWall = (i, j) => DIR4.some(([dx, dy]) => g[id(i + dx, j + dy)] !== 1);
  const isDoorCell = (i, j) => (i === start.rx && j === start.ry) || (i === exit.rx && j === exit.ry);

  // Ceiling lights.
  const lights = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (g[id(i, j)] !== 1) continue;
    const inRoom = roomOf[id(i, j)] >= 0;
    if (inRoom ? (i + j) % 2 === 0 : (i * 7 + j * 3) % 4 === 0) {
      const r = R();
      const state = r < 0.13 ? 'off' : r < 0.27 ? 'flicker' : 'on';
      const warm = R() < 0.5;
      lights.push({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, state, color: warm ? 0xffd9a8 : 0xd6ecff, rot: R() < 0.5 ? 0 : Math.PI / 2, phase: R() * 100 });
    }
  }
  // Props against walls.
  const props = [];
  const used = new Set();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = id(i, j);
    if (g[k] !== 1 || roomOf[k] < 0 || roomOf[k] === startRoom.id || isDoorCell(i, j) || !nearWall(i, j)) continue;
    if (R() > (boss ? 0.12 : 0.24)) continue;
    const walls = DIR4.filter(([dx, dy]) => g[id(i + dx, j + dy)] === 0);
    if (!walls.length) continue;
    const [dx, dy] = walls[ri(0, walls.length - 1)];
    const r = R();
    const type = r < 0.32 ? 'crate' : r < 0.55 ? 'barrel' : r < 0.78 ? 'desk' : 'cabinet';
    const dims = { crate: [0.9, 0.9, 0.9], barrel: [0.62, 0.95, 0.62], desk: [1.5, 0.78, 0.75], cabinet: [0.6, 1.35, 0.55] }[type];
    const along = dx !== 0 ? 'z' : 'x';
    // Depth is dims[2] facing out from the wall.
    const depth = dims[2], width = dims[0];
    const cx = (i + 0.5) * CELL + dx * (CELL / 2 - depth / 2 - 0.06) + (along === 'x' ? (R() - 0.5) * (CELL - width - 0.4) : 0);
    const cz = (j + 0.5) * CELL + dy * (CELL / 2 - depth / 2 - 0.06) + (along === 'z' ? (R() - 0.5) * (CELL - width - 0.4) : 0);
    const rotY = dx !== 0 ? Math.PI / 2 : 0;
    const hx = dx !== 0 ? depth / 2 : width / 2, hz = dx !== 0 ? width / 2 : depth / 2;
    props.push({ type, x: cx, z: cz, rotY: rotY + (type === 'crate' ? (R() - 0.5) * 0.3 : 0), dims, hx, hz });
    used.add(k);
    if (type === 'crate' && R() < 0.35) props.push({ type: 'crate', x: cx, z: cz, y: 0.9, rotY: rotY + (R() - 0.5) * 0.6, dims: [0.7, 0.7, 0.7], hx: 0, hz: 0, stacked: true });
  }

  // Pickups.
  const roomCells = [];
  for (let k = 0; k < N * N; k++) if (g[k] === 1 && roomOf[k] >= 0) roomCells.push(k);
  const pickups = [];
  function placePickup(kind, k) {
    const i = k % N, j = (k / N) | 0;
    pickups.push({ kind, x: (i + 0.5 + (R() - 0.5) * 0.4) * CELL, z: (j + 0.5 + (R() - 0.5) * 0.4) * CELL });
  }
  const startCells = roomCells.filter(k => roomOf[k] === startRoom.id && !(k % N === start.rx && ((k / N) | 0) === start.ry));
  placePickup('ammo', startCells[ri(0, startCells.length - 1)]);
  const others = roomCells.filter(k => roomOf[k] !== startRoom.id);
  const nAmmo = boss ? 9 : 2 + Math.round(rooms.length * 0.55);
  const nMed = boss ? 4 : 1 + Math.round(rooms.length * 0.22);
  for (let a = 0; a < nAmmo; a++) placePickup('ammo', others[ri(0, others.length - 1)]);
  for (let a = 0; a < nMed; a++) placePickup('med', others[ri(0, others.length - 1)]);

  // Blood on the floor and walls.
  const decals = [];
  const openCells = [];
  for (let k = 0; k < N * N; k++) if (g[k] === 1) openCells.push(k);
  for (let a = 0; a < 14 + floor * 2 && a < 60; a++) {
    const k = openCells[ri(0, openCells.length - 1)];
    decals.push({ wall: false, x: ((k % N) + 0.15 + R() * 0.7) * CELL, z: (((k / N) | 0) + 0.15 + R() * 0.7) * CELL, s: 0.7 + R() * 1.6, v: ri(0, 2), r: R() * TAU });
  }
  for (let a = 0; a < 10 + floor && a < 40; a++) {
    const k = openCells[ri(0, openCells.length - 1)], i = k % N, j = (k / N) | 0;
    const walls = DIR4.filter(([dx, dy]) => g[id(i + dx, j + dy)] === 0);
    if (!walls.length) continue;
    const [dx, dy] = walls[ri(0, walls.length - 1)];
    const off = (R() - 0.5) * (CELL - 1);
    decals.push({ wall: true, x: (i + 0.5) * CELL + dx * (CELL / 2 - 0.012) + (dy !== 0 ? off : 0), z: (j + 0.5) * CELL + dy * (CELL / 2 - 0.012) + (dx !== 0 ? off : 0), y: 0.4 + R() * 1.6, nx: -dx, nz: -dy, s: 0.6 + R() * 1.2, v: ri(0, 2), r: R() * TAU });
  }

  // Cells where zombies may appear later: open, not the start room, not elevators.
  const spawnCells = openCells.filter(k => roomOf[k] !== startRoom.id && dStart[k] > 3);
  return { N, g, roomOf, rooms, startRoom, exitRoom, arena, start, exit, boss, floor, lights, props, pickups, decals, spawnCells, dStart };
}

// ---- 04_world.js ----
// World: materials, level meshes, doors, lights, collision, line of sight and pathfinding.
const MAT = {};
let scene = null, camera = null, renderer = null, gunScene = null, gunCam = null;
let envTex = null;
let L = null;
let levelGroup = null;
let exitOpen = false;
const doors = {};
let propBoxes = [];
let propGrid = null;
let fixtures = null, fixtureList = [];
const poolLights = [];
let exitLight = null, exitIndicator = null;
let decals = null;
let flow = null, flowCell = -1, exitFlow = null;

function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MAT.floor = std({ map: TEX.floor, bumpMap: TEX.floor, bumpScale: 1.2, roughnessMap: TEX.floorRough, roughness: 0.95, metalness: 0 });
  MAT.wall = std({ map: TEX.wall, bumpMap: TEX.wall, bumpScale: 1.0, roughness: 0.93 });
  MAT.ceil = std({ map: TEX.ceil, bumpMap: TEX.ceil, bumpScale: 0.8, roughness: 1 });
  MAT.steel = std({ map: TEX.steel, color: 0x6a6e72, roughness: 0.45, metalness: 0.75, envMap: envTex, envMapIntensity: 0.35 });
  MAT.steelDark = std({ map: TEX.steel, color: 0x4a4f54, roughness: 0.5, metalness: 0.7, envMap: envTex, envMapIntensity: 0.5 });
  MAT.crate = std({ map: TEX.crate, bumpMap: TEX.crate, bumpScale: 1, roughness: 0.85 });
  MAT.barrel = std({ map: TEX.barrel, roughness: 0.55, metalness: 0.45, envMap: envTex, envMapIntensity: 0.4 });
  MAT.desk = std({ map: TEX.steel, color: 0x60665e, roughness: 0.55, metalness: 0.5, envMap: envTex, envMapIntensity: 0.4 });
  MAT.cabinet = std({ map: TEX.steel, color: 0x6e7766, roughness: 0.5, metalness: 0.55, envMap: envTex, envMapIntensity: 0.4 });
  MAT.pipe = std({ map: TEX.steel, color: 0x7a5136, roughness: 0.45, metalness: 0.7, envMap: envTex, envMapIntensity: 0.5 });
  MAT.fixture = new THREE.MeshBasicMaterial({ color: 0xffffff });
  MAT.red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1) });
  MAT.green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) });
  MAT.blood = TEX.blood.map(t => std({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.3, metalness: 0 }));
  MAT.hole = std({ map: TEX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, roughness: 1 });
  MAT.scorch = std({ map: TEX.hole, color: 0x222222, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5, roughness: 1, opacity: 0.85 });
}

function buildEnvironment() {
  // A tiny dim room of light panels so metal has something to reflect.
  const es = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: 0x15161a, side: THREE.BackSide }));
  es.add(box);
  const panel = (x, y, z, w, h, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
  panel(0, 2.9, 0, 3, 0.8, 0xfff2dd); panel(4.9, 1, 1, 1.5, 2, 0x8899aa); panel(-4.9, 0.5, -2, 2, 1, 0x554433); panel(0, 1, 4.9, 3, 1, 0x667788);
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromScene(es, 0.04).texture;
  pm.dispose();
}

function geoB() { return { p: [], n: [], u: [], i: [] }; }
function quad(gb, a, b, c, d, n, uv) {
  const base = gb.p.length / 3;
  gb.p.push(...a, ...b, ...c, ...d);
  for (let k = 0; k < 4; k++) gb.n.push(n[0], n[1], n[2]);
  gb.u.push(...uv);
  gb.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function toGeo(gb) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(gb.p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(gb.n, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(gb.u, 2));
  geo.setIndex(gb.i);
  geo.computeBoundingSphere();
  return geo;
}
const hash2 = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function disposeLevel() {
  if (!levelGroup) return;
  levelGroup.traverse(o => {
    if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
    if (o.userData.ownMat) o.material.dispose();
    if (o.userData.dispose) o.userData.dispose();
  });
  scene.remove(levelGroup);
  levelGroup = null;
}

const sharedGeo = {};
function getSharedGeo() {
  if (sharedGeo.box) return sharedGeo;
  sharedGeo.box = new THREE.BoxGeometry(1, 1, 1);
  sharedGeo.barrel = new THREE.CylinderGeometry(0.31, 0.31, 0.95, 16);
  sharedGeo.pipe = new THREE.CylinderGeometry(0.075, 0.075, 1, 10);
  sharedGeo.plane = new THREE.PlaneGeometry(1, 1);
  sharedGeo.fixture = new THREE.BoxGeometry(1.25, 0.05, 0.24);
  return sharedGeo;
}

function addBox(x0, z0, x1, z1, h = 3, on = true) {
  const b = { x0, z0, x1, z1, h, on };
  propBoxes.push(b);
  const N = L.N;
  for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    (propGrid[j * N + i] || (propGrid[j * N + i] = [])).push(b);
  }
  return b;
}

function buildLevel(Ld) {
  disposeLevel();
  L = Ld; exitOpen = false;
  propBoxes = []; propGrid = new Array(L.N * L.N);
  const G = getSharedGeo();
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const N = L.N, g = L.g;
  const gb = { floor: geoB(), ceil: geoB(), wall: geoB(), steel: geoB() };
  const solidAt = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? true : g[j * N + i] === 0;
  const pipes = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = g[j * N + i]; if (v === 0) continue;
    const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
    const elev = v >= 2;
    const uvF = [x0 / CELL, z0 / CELL, x0 / CELL, z1 / CELL, x1 / CELL, z1 / CELL, x1 / CELL, z0 / CELL];
    quad(elev ? gb.steel : gb.floor, [x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], uvF);
    quad(elev ? gb.steel : gb.ceil, [x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [x0 / CELL, z0 / CELL, x1 / CELL, z0 / CELL, x1 / CELL, z1 / CELL, x0 / CELL, z1 / CELL]);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIR4[d];
      if (!solidAt(i + dx, j + dy)) continue;
      let p, q;
      if (dx === 1) { p = [x1, z0]; q = [x1, z1]; }
      else if (dx === -1) { p = [x0, z1]; q = [x0, z0]; }
      else if (dy === 1) { p = [x1, z1]; q = [x0, z1]; }
      else { p = [x0, z0]; q = [x1, z0]; }
      const u0 = hash2(i, j, d) < 0.5 ? 0 : 0.5, u1 = u0 + 0.5;
      quad(elev ? gb.steel : gb.wall, [p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], WALL_H, q[1]], [p[0], WALL_H, p[1]], [-dx, 0, -dy], [u0, 0, u1, 0, u1, 1, u0, 1]);
      if (!elev && hash2(i, j, d + 9) < 0.14) pipes.push({ x: (p[0] + q[0]) / 2 - dx * 0.2, z: (p[1] + q[1]) / 2 - dy * 0.2, alongX: dy !== 0 });
    }
  }
  const mkMesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.updateMatrix(); levelGroup.add(m); return m; };
  mkMesh(toGeo(gb.floor), MAT.floor);
  mkMesh(toGeo(gb.ceil), MAT.ceil);
  mkMesh(toGeo(gb.wall), MAT.wall);
  mkMesh(toGeo(gb.steel), MAT.steel);

  // Pipes along the top of some walls.
  if (pipes.length) {
    const im = new THREE.InstancedMesh(G.pipe, MAT.pipe, pipes.length * 2);
    im.userData.sharedGeo = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0;
    for (const pp of pipes) {
      q.setFromEuler(new THREE.Euler(pp.alongX ? 0 : Math.PI / 2, 0, pp.alongX ? Math.PI / 2 : 0));
      s.set(1, CELL, 1);
      pos.set(pp.x, 2.74, pp.z); m4.compose(pos, q, s); im.setMatrixAt(k++, m4);
      pos.set(pp.x, 2.56, pp.z); s.set(0.7, CELL, 0.7); m4.compose(pos, q, s); im.setMatrixAt(k++, m4);
    }
    levelGroup.add(im);
  }

  // Props.
  const byType = { crate: [], barrel: [], desk: [], cabinet: [] };
  for (const pr of L.props) byType[pr.type].push(pr);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), eu = new THREE.Euler();
  const inst = (geo, mat, list, fn) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.userData.sharedGeo = true;
    list.forEach((it, k) => { fn(it); m4.compose(pos, q, s); im.setMatrixAt(k, m4); });
    levelGroup.add(im);
  };
  inst(G.box, MAT.crate, byType.crate, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(p.dims[0], p.dims[1], p.dims[2]); pos.set(p.x, (p.y || 0) + p.dims[1] / 2, p.z); });
  inst(G.barrel, MAT.barrel, byType.barrel, (p) => { eu.set(0, p.rotY + p.x, 0); q.setFromEuler(eu); s.set(1, 1, 1); pos.set(p.x, 0.475, p.z); });
  inst(G.box, MAT.cabinet, byType.cabinet, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(p.dims[0], p.dims[1], p.dims[2]); pos.set(p.x, p.dims[1] / 2, p.z); });
  inst(G.box, MAT.desk, byType.desk, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(1.5, 0.05, 0.75); pos.set(p.x, 0.76, p.z); });
  const legs = [];
  for (const p of byType.desk) for (const [a, b] of [[-0.7, -0.33], [0.7, -0.33], [-0.7, 0.33], [0.7, 0.33]]) {
    const c = Math.cos(p.rotY), sn = Math.sin(p.rotY);
    legs.push({ x: p.x + a * c + b * sn, z: p.z - a * sn + b * c, rotY: p.rotY });
  }
  inst(G.box, MAT.desk, legs, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(0.05, 0.74, 0.05); pos.set(p.x, 0.37, p.z); });
  for (const p of L.props) if (!p.stacked) addBox(p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, p.dims[1] + (p.type === 'crate' ? 0.6 : 0));

  // Ceiling fixtures (also lit inside elevators).
  fixtureList = L.lights.slice();
  for (const e of [L.start, L.exit]) fixtureList.push({ x: (e.ex + 0.5) * CELL, z: (e.ey + 0.5) * CELL, state: 'dim', color: 0xe8f0ff, rot: 0, phase: 0, elev: true });
  fixtures = new THREE.InstancedMesh(G.fixture, MAT.fixture, fixtureList.length);
  fixtures.userData.sharedGeo = true;
  const col = new THREE.Color();
  fixtureList.forEach((f, k) => {
    eu.set(0, f.rot, 0); q.setFromEuler(eu); s.set(1, 1, 1); pos.set(f.x, WALL_H - 0.026, f.z);
    m4.compose(pos, q, s); fixtures.setMatrixAt(k, m4);
    col.set(f.color).multiplyScalar(f.state === 'off' ? 0.04 : 2.6);
    fixtures.setColorAt(k, col);
    f.level = f.state === 'off' ? 0 : f.state === 'dim' ? 0.25 : 1;
  });
  levelGroup.add(fixtures);

  buildElevator('start', L.start);
  buildElevator('exit', L.exit);

  // Decals: static blood first, the rest of each ring is for gunfire.
  decals = { blood: [], hole: null, scorch: null, bNext: [0, 0, 0], bStart: [0, 0, 0], hNext: 0, sNext: 0 };
  for (let v = 0; v < 3; v++) { const im = new THREE.InstancedMesh(G.plane, MAT.blood[v], 70); im.count = 0; im.frustumCulled = false; im.userData.sharedGeo = true; levelGroup.add(im); decals.blood.push(im); }
  decals.hole = new THREE.InstancedMesh(G.plane, MAT.hole, 90); decals.hole.count = 0; decals.hole.frustumCulled = false; decals.hole.userData.sharedGeo = true; levelGroup.add(decals.hole);
  decals.scorch = new THREE.InstancedMesh(G.plane, MAT.scorch, 16); decals.scorch.count = 0; decals.scorch.frustumCulled = false; decals.scorch.userData.sharedGeo = true; levelGroup.add(decals.scorch);
  for (const d of L.decals) {
    if (d.wall) addDecal('blood', d.x, d.y, d.z, d.nx, 0, d.nz, d.s, d.r, d.v, true);
    else addDecal('blood', d.x, 0, d.z, 0, 1, 0, d.s, d.r, d.v, true);
  }
  for (let v = 0; v < 3; v++) decals.bStart[v] = decals.bNext[v];

  exitFlow = bfsFrom(L.exit.rx, L.exit.ry);
  flow = null; flowCell = -1;
}

let _dm, _dq, _dq2, _dv, _ds, _dz, _dn;
function initWorldTemps() { _dm = new THREE.Matrix4(); _dq = new THREE.Quaternion(); _dq2 = new THREE.Quaternion(); _dv = new THREE.Vector3(); _ds = new THREE.Vector3(); _dz = new THREE.Vector3(0, 0, 1); _dn = new THREE.Vector3(); }
function addDecal(kind, x, y, z, nx, ny, nz, size, rot, variant = 0, isStatic = false) {
  if (!decals) return;
  let im, idx;
  if (kind === 'blood') {
    im = decals.blood[variant];
    const cap = im.instanceMatrix.count;
    if (decals.bNext[variant] >= cap) decals.bNext[variant] = decals.bStart[variant];
    if (decals.bStart[variant] >= cap - 4 && !isStatic) return;
    idx = decals.bNext[variant]++;
  } else if (kind === 'hole') {
    im = decals.hole; if (decals.hNext >= im.instanceMatrix.count) decals.hNext = 0; idx = decals.hNext++;
  } else {
    im = decals.scorch; if (decals.sNext >= im.instanceMatrix.count) decals.sNext = 0; idx = decals.sNext++;
  }
  _dn.set(nx, ny, nz);
  _dq.setFromUnitVectors(_dz, _dn);
  _dq2.setFromAxisAngle(_dn, rot);
  _dq.premultiply(_dq2);
  const off = kind === 'hole' ? 0.006 : 0.004 + Math.random() * 0.003;
  _dv.set(x + nx * off, y + ny * off, z + nz * off);
  _ds.set(size, size, size);
  _dm.compose(_dv, _dq, _ds);
  im.setMatrixAt(idx, _dm);
  im.count = Math.max(im.count, idx + 1);
  im.instanceMatrix.needsUpdate = true;
}

function buildElevator(which, e) {
  const G = getSharedGeo();
  const dx = e.dx, dy = e.dy;
  const bx = (e.rx + 0.5) * CELL + dx * CELL / 2, bz = (e.ry + 0.5) * CELL + dy * CELL / 2;
  const ax = dx !== 0 ? 0 : 1, az = dx !== 0 ? 1 : 0; // axis along the door
  const OPEN_W = 1.8, JAMB = (CELL - OPEN_W) / 2, DOOR_H = 2.3, T = 0.24;
  const grp = new THREE.Group();
  const box = (cx, cy, cz, sx, sy, sz, mat) => { const m = new THREE.Mesh(G.box, mat); m.position.set(cx, cy, cz); m.scale.set(sx, sy, sz); m.userData.sharedGeo = true; grp.add(m); return m; };
  const along = (d) => [bx + ax * d, bz + az * d];
  const size = (l, t) => (ax ? [l, t] : [t, l]);
  for (const sgn of [-1, 1]) {
    const [cx, cz] = along(sgn * (OPEN_W / 2 + JAMB / 2));
    const [sx, sz] = size(JAMB, T);
    box(cx, WALL_H / 2, cz, sx, WALL_H, sz, MAT.steelDark);
    addBox(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2);
  }
  { const [sx, sz] = size(OPEN_W, T); box(bx, (DOOR_H + WALL_H) / 2, bz, sx, WALL_H - DOOR_H, sz, MAT.steelDark); }
  const panels = [];
  for (const sgn of [-1, 1]) {
    const [sx, sz] = size(OPEN_W / 2 - 0.01, 0.07);
    const m = box(0, DOOR_H / 2, 0, sx, DOOR_H, sz, MAT.steel);
    panels.push({ m, sgn });
  }
  const blocker = addBox(bx - (ax ? OPEN_W / 2 : 0.12), bz - (az ? OPEN_W / 2 : 0.12), bx + (ax ? OPEN_W / 2 : 0.12), bz + (az ? OPEN_W / 2 : 0.12));
  const roomSide = -1; // the room is at -d from the boundary
  const ix = bx + dx * roomSide * (T / 2 + 0.02), iz = bz + dy * roomSide * (T / 2 + 0.02);
  if (which === 'start') {
    const tex = floorSignTexture(L.floor);
    const sm = new THREE.MeshBasicMaterial({ map: tex, color: 0x8a8a8a });
    const sign = new THREE.Mesh(G.plane, sm);
    sign.userData.sharedGeo = true; sign.userData.ownMat = true;
    sign.scale.set(1.5, 0.47, 1);
    sign.position.set(ix, (DOOR_H + WALL_H) / 2, iz);
    sign.lookAt(ix - dx, (DOOR_H + WALL_H) / 2, iz - dy);
    grp.add(sign);
    sign.userData.dispose = () => tex.dispose();
  } else {
    const ind = box(ix, (DOOR_H + WALL_H) / 2, iz, ax ? 1.2 : 0.04, 0.1, ax ? 0.04 : 1.2, MAT.red);
    exitIndicator = ind;
    if (!exitLight) { exitLight = new THREE.PointLight(0xff2010, 0, 7, 2); scene.add(exitLight); }
    exitLight.color.setRGB(1, 0.12, 0.06);
    exitLight.intensity = 2.2;
    exitLight.position.set(bx - dx * 0.8, 2.4, bz - dy * 0.8);
  }
  levelGroup.add(grp);
  doors[which] = { panels, blocker, open: 0, target: 0, bx, bz, ax, az, dx, dy, OPEN_W };
  updateDoor(doors[which], 0);
}
function updateDoor(d, dt) {
  d.open = d.target > d.open ? Math.min(d.target, d.open + dt * 0.9) : Math.max(d.target, d.open - dt * 0.9);
  const slide = 0.46 + d.open * 0.9;
  for (const p of d.panels) {
    const off = p.sgn * slide;
    p.m.position.set(d.bx + d.ax * off + d.dx * 0.06, p.m.position.y, d.bz + d.az * off + d.dy * 0.06);
  }
  d.blocker.on = d.open < 0.85;
}
function setExitOpen() {
  if (exitOpen) return;
  exitOpen = true;
  doors.exit.target = 1;
  if (exitIndicator) exitIndicator.material = MAT.green;
  if (exitLight) exitLight.color.setRGB(0.15, 1, 0.3);
}

// ---------- collision ----------
function cellOf(x) { return Math.floor(x / CELL); }
function solidFor(i, j, forPlayer) {
  if (!L || i < 0 || j < 0 || i >= L.N || j >= L.N) return true;
  const v = L.g[j * L.N + i];
  if (v === 0) return true;
  if (v === 1) return false;
  if (!forPlayer) return true;
  if (v === 3) return !exitOpen;
  return false;
}
function pushOutAABB(e, r, x0, z0, x1, z1) {
  const cx = clamp(e.x, x0, x1), cz = clamp(e.z, z0, z1);
  const dx = e.x - cx, dz = e.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; e.x += dx * k; e.z += dz * k; }
  else {
    const l = e.x - x0, rr = x1 - e.x, t = e.z - z0, b = z1 - e.z, m = Math.min(l, rr, t, b);
    if (m === l) e.x = x0 - r; else if (m === rr) e.x = x1 + r; else if (m === t) e.z = z0 - r; else e.z = z1 + r;
  }
  return true;
}
function collide(e, r, forPlayer) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    const ci = cellOf(e.x), cj = cellOf(e.z);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (solidFor(i, j, forPlayer)) { if (pushOutAABB(e, r, i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL)) hit = true; }
      if (i < 0 || j < 0 || i >= L.N || j >= L.N) continue;
      const list = propGrid[j * L.N + i];
      if (list) for (const b of list) if (b.on && pushOutAABB(e, r, b.x0, b.z0, b.x1, b.z1)) hit = true;
    }
  }
  return hit;
}

// ---------- rays ----------
function raySolid(i, j) {
  if (i < 0 || j < 0 || i >= L.N || j >= L.N) return true;
  const v = L.g[j * L.N + i];
  return v === 0 || (v === 3 && !exitOpen);
}
// Horizontal DDA through the grid. Returns {t, nx, nz} or null within maxT.
function gridRay(ox, oz, hx, hz, maxT) {
  let i = cellOf(ox), j = cellOf(oz);
  const si = hx > 0 ? 1 : -1, sj = hz > 0 ? 1 : -1;
  const tdx = Math.abs(hx) > 1e-9 ? Math.abs(CELL / hx) : Infinity, tdz = Math.abs(hz) > 1e-9 ? Math.abs(CELL / hz) : Infinity;
  let tmx = Math.abs(hx) > 1e-9 ? ((hx > 0 ? (i + 1) * CELL : i * CELL) - ox) / hx : Infinity;
  let tmz = Math.abs(hz) > 1e-9 ? ((hz > 0 ? (j + 1) * CELL : j * CELL) - oz) / hz : Infinity;
  for (let n = 0; n < 256; n++) {
    let t, nx = 0, nz = 0;
    if (tmx < tmz) { t = tmx; i += si; tmx += tdx; nx = -si; } else { t = tmz; j += sj; tmz += tdz; nz = -sj; }
    if (t > maxT) return null;
    if (raySolid(i, j)) return { t, nx, nz };
  }
  return null;
}
function losClear(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  return !gridRay(x0, z0, dx / d, dz / d, d);
}
// Full 3D ray against walls, floor, ceiling and props.
const _rh = { t: 0, nx: 0, ny: 0, nz: 0, prop: false };
function rayWorld(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD, nx = 0, ny = 0, nz = 0, prop = false;
  if (dy < -1e-6) { const t = -oy / dy; if (t < best) { best = t; nx = 0; ny = 1; nz = 0; } }
  if (dy > 1e-6) { const t = (WALL_H - oy) / dy; if (t < best) { best = t; nx = 0; ny = -1; nz = 0; } }
  const h = Math.hypot(dx, dz);
  if (h > 1e-6) {
    const w = gridRay(ox, oz, dx / h, dz / h, best * h);
    if (w && w.t / h < best) { best = w.t / h; nx = w.nx; ny = 0; nz = w.nz; }
  }
  for (const b of propBoxes) {
    if (!b.on) continue;
    // slab test
    let t0 = 0, t1 = best, ax = 0, axs = 0;
    const sl = (o, d, lo, hi, axis) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, c = (hi - o) / d, s = -1;
      if (a > c) { const tmp = a; a = c; c = tmp; s = 1; }
      if (a > t0) { t0 = a; ax = axis; axs = s; }
      if (c < t1) t1 = c;
      return t0 <= t1;
    };
    if (sl(ox, dx, b.x0, b.x1, 1) && sl(oy, dy, 0, b.h, 2) && sl(oz, dz, b.z0, b.z1, 3) && t0 > 0.01 && t0 < best) {
      best = t0; prop = true;
      nx = ax === 1 ? axs : 0; ny = ax === 2 ? axs : 0; nz = ax === 3 ? axs : 0;
      if (ax === 0) ny = 1;
    }
  }
  _rh.t = best; _rh.nx = nx; _rh.ny = ny; _rh.nz = nz; _rh.prop = prop;
  return _rh;
}

// ---------- pathfinding ----------
function bfsFrom(si, sj) {
  const N = L.N, d = new Int16Array(N * N).fill(-1);
  if (si < 0 || sj < 0 || si >= N || sj >= N || L.g[sj * N + si] !== 1) return d;
  const q = new Int32Array(N * N); let qh = 0, qt = 0;
  q[qt++] = sj * N + si; d[sj * N + si] = 0;
  while (qh < qt) {
    const k = q[qh++], x = k % N, y = (k / N) | 0;
    for (let n = 0; n < 4; n++) {
      const nx = x + DIR4[n][0], ny = y + DIR4[n][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (L.g[nk] === 1 && d[nk] < 0) { d[nk] = d[k] + 1; q[qt++] = nk; }
    }
  }
  return d;
}
function updateFlow() {
  let i = cellOf(P.x), j = cellOf(P.z);
  const v = (i >= 0 && j >= 0 && i < L.N && j < L.N) ? L.g[j * L.N + i] : 0;
  if (v === 2) { i = L.start.rx; j = L.start.ry; }
  else if (v === 3) { i = L.exit.rx; j = L.exit.ry; }
  else if (v !== 1) return;
  const k = j * L.N + i;
  if (k === flowCell && flow) return;
  flowCell = k;
  flow = bfsFrom(i, j);
}
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Next waypoint for a walker following a distance field toward its source.
function flowStep(field, x, z, out) {
  const N = L.N, i = cellOf(x), j = cellOf(z);
  const walk = (a, b) => a >= 0 && b >= 0 && a < N && b < N && L.g[b * N + a] === 1 && field[b * N + a] >= 0;
  if (!walk(i, j)) {
    // Off the walkable grid (e.g. inside an elevator): step to the best open neighbour.
    let bd = 1e9, bi = i, bj = j;
    for (const [di, dj] of DIR4) { const ni = i + di, nj = j + dj; if (walk(ni, nj) && field[nj * N + ni] < bd) { bd = field[nj * N + ni]; bi = ni; bj = nj; } }
    out.x = (bi + 0.5) * CELL; out.z = (bj + 0.5) * CELL; return bi !== i || bj !== j;
  }
  let best = field[j * N + i], bi = i, bj = j;
  for (const [di, dj] of DIR8) {
    const ni = i + di, nj = j + dj;
    if (!walk(ni, nj)) continue;
    if (di && dj && !(walk(i + di, j) && walk(i, j + dj))) continue;
    const dv = field[nj * N + ni] + (di && dj ? 0.5 : 0);
    if (dv < best) { best = dv; bi = ni; bj = nj; }
  }
  out.x = (bi + 0.5) * CELL; out.z = (bj + 0.5) * CELL;
  return bi !== i || bj !== j;
}

// ---- 05_models.js ----
// Models: articulated zombies and bosses, first-person weapons, pickups.
const ZGEO = {};
const ZMAT = {};
function zombieAssets() {
  if (ZGEO.torso) return;
  ZGEO.torso = new THREE.CapsuleGeometry(0.17, 0.36, 5, 12);
  ZGEO.belly = new THREE.SphereGeometry(0.2, 14, 12);
  ZGEO.head = new THREE.SphereGeometry(0.12, 16, 12);
  ZGEO.jaw = new THREE.BoxGeometry(0.15, 0.05, 0.12);
  ZGEO.upperArm = new THREE.CapsuleGeometry(0.056, 0.24, 4, 8);
  ZGEO.foreArm = new THREE.CapsuleGeometry(0.048, 0.24, 4, 8);
  ZGEO.hand = new THREE.SphereGeometry(0.055, 8, 6);
  ZGEO.thigh = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
  ZGEO.shin = new THREE.CapsuleGeometry(0.064, 0.34, 4, 8);
  ZGEO.foot = new THREE.BoxGeometry(0.11, 0.07, 0.24);
  ZGEO.eye = new THREE.SphereGeometry(0.02, 6, 5);
  ZGEO.blade = new THREE.BoxGeometry(0.04, 0.3, 0.55);
  ZGEO.pustule = new THREE.SphereGeometry(0.08, 10, 8);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  ZMAT.skin = [std({ map: TEX.skin, color: 0xb6bea0, roughness: 0.75 }), std({ map: TEX.skin, color: 0xc8b8a4, roughness: 0.7 }), std({ map: TEX.skin, color: 0x9aa48a, roughness: 0.8 })];
  ZMAT.shirt = [0x56677a, 0x7a6a52, 0x8a8a80, 0x6a3a38, 0x3c4a34, 0x9a9488, 0x2f3540].map(c => std({ map: TEX.cloth, color: c, roughness: 0.95 }));
  ZMAT.pants = [0x2c3240, 0x3e3a32, 0x22242a, 0x4a4436].map(c => std({ map: TEX.cloth, color: c, roughness: 0.95 }));
  ZMAT.eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 0.8) });
  ZMAT.eyeRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) });
  ZMAT.eyeGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3, 0.3) });
  ZMAT.mouth = std({ color: 0x2a0806, roughness: 0.6 });
  ZMAT.butcherSkin = std({ map: TEX.skin, color: 0x8a7a70, roughness: 0.7 });
  ZMAT.apron = std({ map: TEX.cloth, color: 0x6a5c4e, roughness: 0.9 });
  ZMAT.broodSkin = std({ map: TEX.skin, color: 0x9ab07a, roughness: 0.5 });
  ZMAT.pustule = std({ color: 0x8ac040, emissive: 0x4a9a10, emissiveIntensity: 1.2, roughness: 0.3 });
  ZMAT.blade = std({ map: TEX.steel, color: 0xb8bcc0, roughness: 0.25, metalness: 0.9, envMap: envTex });
  ZMAT.spitSkin = std({ map: TEX.skin, color: 0xa8c070, roughness: 0.6 });
}

// type: walker | runner | brute | spitter | butcher | brood
function buildZombie(type) {
  zombieAssets();
  const m = (geo, mat, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent.add(o); return o; };
  const skin = type === 'butcher' ? ZMAT.butcherSkin : type === 'brood' ? ZMAT.broodSkin : type === 'spitter' ? ZMAT.spitSkin : pick(ZMAT.skin);
  const shirt = type === 'butcher' ? ZMAT.apron : pick(ZMAT.shirt);
  const pants = pick(ZMAT.pants);
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = m(ZGEO.torso, shirt, torso, 0, 0.3, 0); chest.scale.set(1.28, 1, 0.78);
  if (type === 'brood') { const b = m(ZGEO.belly, skin, torso, 0, 0.26, 0.06); b.scale.set(1.9, 1.7, 1.8); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; m(ZGEO.pustule, ZMAT.pustule, torso, Math.cos(a) * 0.32, 0.18 + (k % 3) * 0.12, 0.2 + Math.sin(a) * 0.22).scale.setScalar(0.6 + Math.random() * 0.6); } }
  const neck = new THREE.Group(); neck.position.y = 0.6; torso.add(neck);
  const head = m(ZGEO.head, skin, neck, 0, 0.11, 0.02); head.scale.set(0.95, 1.12, 1);
  const jaw = m(ZGEO.jaw, ZMAT.mouth, head, 0, -0.09, 0.05); jaw.rotation.x = 0.35;
  const eyeMat = type === 'butcher' ? ZMAT.eyeRed : type === 'brood' || type === 'spitter' ? ZMAT.eyeGreen : ZMAT.eye;
  m(ZGEO.eye, eyeMat, head, -0.045, 0.02, 0.105); m(ZGEO.eye, eyeMat, head, 0.045, 0.02, 0.105);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.25 * s, 0.53, 0); torso.add(sh);
    m(ZGEO.upperArm, Math.random() < 0.5 ? shirt : skin, sh, 0, -0.16, 0);
    const el = new THREE.Group(); el.position.y = -0.33; sh.add(el);
    m(ZGEO.foreArm, skin, el, 0, -0.15, 0);
    m(ZGEO.hand, skin, el, 0, -0.31, 0);
    if (type === 'butcher' && s === 1) { const bl = m(ZGEO.blade, ZMAT.blade, el, 0, -0.42, 0.18); bl.rotation.x = 0.2; }
    arms.push({ sh, el });
    const hp = new THREE.Group(); hp.position.set(0.11 * s, 0, 0); hips.add(hp);
    m(ZGEO.thigh, pants, hp, 0, -0.22, 0);
    const kn = new THREE.Group(); kn.position.y = -0.45; hp.add(kn);
    m(ZGEO.shin, pants, kn, 0, -0.22, 0);
    m(ZGEO.foot, ZMAT.mouth, kn, 0, -0.45, 0.05);
    legs.push({ hp, kn });
  }
  root.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
  return { root, hips, torso, neck, head, jaw, arms, legs, type };
}

// ---------- Weapons (first-person view models) ----------
const GMAT = {};
function gunAssets() {
  if (GMAT.metal) return;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  GMAT.metal = std({ color: 0x4a4f55, roughness: 0.34, metalness: 0.85, envMap: envTex, envMapIntensity: 1.6 });
  GMAT.steel = std({ map: TEX.steel, color: 0x9da2a8, roughness: 0.28, metalness: 0.95, envMap: envTex, envMapIntensity: 1.2 });
  GMAT.poly = std({ color: 0x2a2b2e, roughness: 0.6, metalness: 0.15, envMap: envTex, envMapIntensity: 0.8 });
  GMAT.wood = std({ map: TEX.crate, color: 0x8a5a32, roughness: 0.55, metalness: 0.05, envMap: envTex, envMapIntensity: 0.4 });
  GMAT.olive = std({ color: 0x4a5236, roughness: 0.6, metalness: 0.3, envMap: envTex, envMapIntensity: 0.5 });
  GMAT.glove = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
  GMAT.sleeve = new THREE.MeshLambertMaterial({ map: TEX.cloth, color: 0x3a4030 });
  GMAT.glowBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 3) });
  GMAT.glowGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 3, 0.8) });
  GMAT.glowPurple = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.6, 3) });
  GMAT.brass = std({ color: 0xb08a40, roughness: 0.3, metalness: 1, envMap: envTex });
  GMAT.red = std({ color: 0x7a1a12, roughness: 0.5, metalness: 0.3 });
}
// Build a gun from a compact description. Gun points down -Z; origin at the grip.
function buildGun(spec) {
  gunAssets();
  const g = new THREE.Group();
  const B = (w, h, l, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  const C = (r, l, mat, x, y, z, seg = 14, r2) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, l, seg), mat); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
  const S = spec;
  const body = S.bodyMat || GMAT.metal, furn = S.furn || GMAT.poly;
  const [rw, rh, rl] = S.rec;
  const ry = S.recY ?? 0.07;
  B(rw, rh, rl, body, 0, ry, -rl * 0.35);                         // receiver
  if (S.slide) B(rw * 1.05, rh * 0.45, rl * 0.98, GMAT.steel, 0, ry + rh * 0.5, -rl * 0.36);
  const front = -rl * 0.35 - rl / 2;
  const by = ry + (S.barrelY ?? 0);
  if (S.hand) B(S.hand[0], S.hand[1], S.hand[2], S.handMat || furn, 0, by - 0.005, front - S.hand[2] / 2);
  C(S.barrel[1], S.barrel[0], GMAT.steel, 0, by, front - S.barrel[0] / 2, 12);
  if (S.brake) C(S.barrel[1] * 1.7, 0.05, GMAT.metal, 0, by, front - S.barrel[0] - 0.02, 8);
  if (S.tube) C(S.tube, S.barrel[0] * 0.8, body, 0, by - S.barrel[1] - S.tube - 0.004, front - S.barrel[0] * 0.4, 12);
  B(0.035, 0.11, 0.05, furn, 0, ry - rh / 2 - 0.045, 0.02, 0.25);  // grip
  if (S.guard !== false) B(0.012, 0.012, 0.07, body, 0, ry - rh / 2 - 0.01, -0.04);
  if (S.mag === 'box') B(0.03, S.magLen || 0.12, 0.05, GMAT.metal, 0, ry - rh / 2 - (S.magLen || 0.12) / 2, -rl * 0.28, 0.08);
  if (S.mag === 'curve') { const a = B(0.032, 0.14, 0.055, GMAT.metal, 0, ry - rh / 2 - 0.06, -rl * 0.3, 0.25); a.material = S.magMat || GMAT.metal; }
  if (S.mag === 'drum') C(0.075, 0.06, GMAT.metal, 0, ry - rh / 2 - 0.07, -rl * 0.3, 18).rotation.set(0, 0, Math.PI / 2);
  if (S.mag === 'cyl') C(0.042, 0.06, GMAT.steel, 0, ry, -0.04, 10);
  if (S.stock) B(0.04, 0.07, S.stock, furn, 0, ry - 0.01, rl * 0.15 + S.stock / 2);
  if (S.scope) { C(0.024, 0.2, GMAT.metal, 0, ry + rh / 2 + 0.045, -rl * 0.3, 14); C(0.03, 0.03, GMAT.metal, 0, ry + rh / 2 + 0.045, -rl * 0.3 - 0.1, 14); B(0.02, 0.03, 0.02, GMAT.metal, 0, ry + rh / 2 + 0.015, -rl * 0.3); }
  else if (S.sight !== false) { B(0.008, 0.018, 0.008, GMAT.metal, 0, ry + rh / 2 + 0.009, front + 0.01); }
  if (S.coils) for (let k = 0; k < S.coils; k++) C(S.barrel[1] * 1.8, 0.014, S.glow, 0, by, front - 0.05 - k * (S.barrel[0] - 0.1) / Math.max(1, S.coils - 1), 12);
  if (S.glowStrip) B(rw + 0.004, 0.012, rl * 0.7, S.glow, 0, ry + 0.01, -rl * 0.35);
  if (S.cylinder) { const c = C(0.04, 0.06, GMAT.steel, 0, ry + 0.005, -0.06, 8); c.rotation.set(Math.PI / 2, 0, 0); }
  if (S.rocket) { C(S.barrel[1] * 0.85, 0.12, GMAT.olive, 0, by, front - S.barrel[0] + 0.02, 10, 0.001); }
  // Hands and sleeves, built between explicit joint points.
  const limb = (a, b, r0, r1, mat) => {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), len = d.length();
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), mat);
    o.position.copy(A).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(o); return o;
  };
  const gy = ry - rh / 2 - 0.04;
  B(0.052, 0.08, 0.09, GMAT.glove, 0.0, gy, 0.035, 0.25);
  limb([0.01, gy - 0.03, 0.07], [0.14, gy - 0.5, 0.95], 0.034, 0.06, GMAT.sleeve);
  if (S.twoHand) {
    const hz = front - S.twoHand;
    B(0.062, 0.05, 0.085, GMAT.glove, -0.012, by - 0.045, hz, 0);
    limb([-0.02, by - 0.06, hz + 0.02], [-0.3, by - 0.62, hz + 0.95], 0.033, 0.06, GMAT.sleeve);
  }
  const muzzle = new THREE.Vector3(0, by, front - S.barrel[0] - (S.brake ? 0.04 : 0.01));
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: g, muzzle };
}

// ---------- Pickups ----------
let pickupGeo = null;
function buildPickup(kind) {
  if (!pickupGeo) {
    pickupGeo = { ammo: new THREE.BoxGeometry(0.46, 0.24, 0.26), med: new THREE.BoxGeometry(0.38, 0.17, 0.27), weapon: new THREE.BoxGeometry(0.9, 0.18, 0.32) };
    const side = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.2 });
    MAT.ammoBox = [side(TEX.ammo), side(TEX.ammo), new THREE.MeshStandardMaterial({ color: 0x3a4226, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x3a4226, roughness: 0.6 }), side(TEX.ammo), side(TEX.ammo)];
    MAT.medBox = [side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med), side(TEX.med)];
    MAT.pickGlowA = new THREE.SpriteMaterial({ map: TEX.soft, color: 0xffd060, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    MAT.pickGlowM = new THREE.SpriteMaterial({ map: TEX.soft, color: 0xff5050, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  const grp = new THREE.Group();
  const mesh = new THREE.Mesh(pickupGeo[kind], kind === 'med' ? MAT.medBox : MAT.ammoBox);
  mesh.position.y = 0.2;
  grp.add(mesh);
  const glow = new THREE.Sprite(kind === 'med' ? MAT.pickGlowM : MAT.pickGlowA);
  glow.scale.set(1.2, 1.2, 1); glow.position.y = 0.25;
  grp.add(glow);
  return { grp, mesh };
}

// ---- 06_fx.js ----
// Effects: pooled particles (blood, sparks, dust, smoke), tracers, beams, arcs, flashes.
const FX = { sys: [], tracers: null, beams: [], arcs: null, flashLight: null, boomLight: null, boomT: 0 };

function makeParticles(max, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const attr = (a, n) => { const b = new THREE.BufferAttribute(a, n); b.setUsage(THREE.DynamicDrawUsage); return b; };
  geo.setAttribute('position', attr(pos, 3));
  geo.setAttribute('pcolor', attr(col, 3));
  geo.setAttribute('psize', attr(size, 1));
  geo.setAttribute('palpha', attr(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, map: { value: TEX.soft } },
    vertexShader: 'attribute vec3 pcolor; attribute float psize; attribute float palpha; varying vec3 vC; varying float vA; uniform float uScale;' +
      'void main(){ vC=pcolor; vA=palpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=psize*uScale/max(0.05,-mv.z); gl_Position=projectionMatrix*mv; float f=clamp((-mv.z-6.0)/22.0,0.0,1.0); vA*=1.0-f; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ float a=texture2D(map,gl_PointCoord).a*vA; if(a<0.01) discard; gl_FragColor=vec4(vC,a); }',
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 3 : 2;
  const s = { pts, geo, mat, max, pos, col, size, alpha, n: 0,
    vel: new Float32Array(max * 3), life: new Float32Array(max), maxLife: new Float32Array(max), grav: new Float32Array(max), drag: new Float32Array(max), grow: new Float32Array(max), a0: new Float32Array(max), next: 0 };
  scene.add(pts);
  FX.sys.push(s);
  return s;
}
function emit(s, x, y, z, vx, vy, vz, life, sz, r, g, b, grav = 0, drag = 0, grow = 0, a0 = 1) {
  let k;
  if (s.n < s.max) k = s.n++;
  else { k = s.next; s.next = (s.next + 1) % s.max; }
  s.pos[k * 3] = x; s.pos[k * 3 + 1] = y; s.pos[k * 3 + 2] = z;
  s.vel[k * 3] = vx; s.vel[k * 3 + 1] = vy; s.vel[k * 3 + 2] = vz;
  s.col[k * 3] = r; s.col[k * 3 + 1] = g; s.col[k * 3 + 2] = b;
  s.size[k] = sz; s.life[k] = life; s.maxLife[k] = life; s.grav[k] = grav; s.drag[k] = drag; s.grow[k] = grow; s.a0[k] = a0; s.alpha[k] = a0;
}
function updateParticles(dt) {
  for (const s of FX.sys) {
    let i = 0;
    while (i < s.n) {
      s.life[i] -= dt;
      if (s.life[i] <= 0) {
        const last = --s.n;
        if (i !== last) {
          for (let c = 0; c < 3; c++) { s.pos[i * 3 + c] = s.pos[last * 3 + c]; s.vel[i * 3 + c] = s.vel[last * 3 + c]; s.col[i * 3 + c] = s.col[last * 3 + c]; }
          s.size[i] = s.size[last]; s.life[i] = s.life[last]; s.maxLife[i] = s.maxLife[last]; s.grav[i] = s.grav[last]; s.drag[i] = s.drag[last]; s.grow[i] = s.grow[last]; s.a0[i] = s.a0[last];
        }
        continue;
      }
      const dk = Math.max(0, 1 - s.drag[i] * dt);
      s.vel[i * 3] *= dk; s.vel[i * 3 + 2] *= dk; s.vel[i * 3 + 1] = s.vel[i * 3 + 1] * dk - s.grav[i] * dt;
      s.pos[i * 3] += s.vel[i * 3] * dt; s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt; s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
      if (s.pos[i * 3 + 1] < 0.01) { s.pos[i * 3 + 1] = 0.01; s.vel[i * 3 + 1] *= -0.2; s.vel[i * 3] *= 0.5; s.vel[i * 3 + 2] *= 0.5; }
      s.size[i] += s.grow[i] * dt;
      const t = s.life[i] / s.maxLife[i];
      s.alpha[i] = s.a0[i] * Math.min(1, t * 2.5);
      i++;
    }
    s.next = Math.min(s.next, Math.max(0, s.n - 1));
    s.geo.setDrawRange(0, s.n);
    for (const a of ['position', 'pcolor', 'psize', 'palpha']) s.geo.attributes[a].needsUpdate = true;
  }
}
let PS_NORM = null, PS_ADD = null;

function initFX() {
  PS_NORM = makeParticles(700, false);
  PS_ADD = makeParticles(500, true);
  // Tracers: pooled line segments with fading vertex colours.
  const max = 48;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  FX.tracers = { lines, geo, max, list: [] };
  // Arcs (tesla) as another line pool.
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const am = new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 1.6, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const al = new THREE.LineSegments(ag, am); al.frustumCulled = false; scene.add(al);
  FX.arcs = { lines: al, geo: ag, list: [] };
  // Beam meshes for the railgun.
  FX.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  FX.beamGeo.rotateX(Math.PI / 2);
  // Lights for gunfire and explosions.
  FX.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2);
  scene.add(FX.flashLight);
  FX.boomLight = new THREE.PointLight(0xff7a30, 0, 16, 2);
  scene.add(FX.boomLight);
}

function addTracer(x0, y0, z0, x1, y1, z1, r = 1.4, g = 1.1, b = 0.6, life = 0.07) {
  const T = FX.tracers;
  if (T.list.length >= T.max) T.list.shift();
  T.list.push({ a: [x0, y0, z0], b: [x1, y1, z1], c: [r, g, b], life, max: life });
}
function addArc(x0, y0, z0, x1, y1, z1, life = 0.14) {
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n, j = (i === 0 || i === n) ? 0 : 0.35;
    pts.push([lerp(x0, x1, t) + rnd(-j, j), lerp(y0, y1, t) + rnd(-j, j), lerp(z0, z1, t) + rnd(-j, j)]);
  }
  FX.arcs.list.push({ pts, life });
}
function addBeam(x0, y0, z0, x1, y1, z1) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(FX.beamGeo, mat);
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.scale.set(0.035, 0.035, len);
  m.lookAt(x1, y1, z1);
  m.frustumCulled = false;
  scene.add(m);
  FX.beams.push({ m, life: 0.35 });
  for (let i = 0; i < 26; i++) { const t = Math.random(); emit(PS_ADD, lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t), rnd(-0.4, 0.4), rnd(-0.2, 0.6), rnd(-0.4, 0.4), 0.5, 0.06, 0.4, 0.9, 1.6, 0, 1); }
}
function updateLineFX(dt) {
  const T = FX.tracers;
  const P3 = T.geo.attributes.position.array, C3 = T.geo.attributes.color.array;
  let k = 0;
  for (let i = T.list.length - 1; i >= 0; i--) { const t = T.list[i]; t.life -= dt; if (t.life <= 0) T.list.splice(i, 1); }
  for (const t of T.list) {
    const f = t.life / t.max;
    P3.set(t.a, k * 6); P3.set(t.b, k * 6 + 3);
    C3[k * 6] = t.c[0] * f * 0.2; C3[k * 6 + 1] = t.c[1] * f * 0.2; C3[k * 6 + 2] = t.c[2] * f * 0.2;
    C3[k * 6 + 3] = t.c[0] * f; C3[k * 6 + 4] = t.c[1] * f; C3[k * 6 + 5] = t.c[2] * f;
    k++;
  }
  T.geo.setDrawRange(0, k * 2);
  T.geo.attributes.position.needsUpdate = true; T.geo.attributes.color.needsUpdate = true;
  const A = FX.arcs, AP = A.geo.attributes.position.array;
  let n = 0;
  for (let i = A.list.length - 1; i >= 0; i--) { A.list[i].life -= dt; if (A.list[i].life <= 0) A.list.splice(i, 1); }
  for (const a of A.list) {
    for (let i = 0; i < a.pts.length - 1 && n < 400; i++) { AP.set(a.pts[i], n * 6); AP.set(a.pts[i + 1], n * 6 + 3); n++; }
  }
  A.geo.setDrawRange(0, n * 2); A.geo.attributes.position.needsUpdate = true;
  for (let i = FX.beams.length - 1; i >= 0; i--) {
    const b = FX.beams[i]; b.life -= dt;
    b.m.material.opacity = Math.max(0, b.life / 0.35);
    b.m.scale.x = b.m.scale.y = 0.035 * (0.4 + b.life / 0.35);
    if (b.life <= 0) { scene.remove(b.m); b.m.material.dispose(); FX.beams.splice(i, 1); }
  }
  FX.flashLight.intensity = Math.max(0, FX.flashLight.intensity - dt * 900);
  FX.boomT = Math.max(0, FX.boomT - dt);
  FX.boomLight.intensity = FX.boomT > 0 ? 220 * (FX.boomT / 0.5) : 0;
}

function bloodBurst(x, y, z, dx, dy, dz, n = 12, big = 1) {
  for (let i = 0; i < n; i++) {
    const sp = rnd(1, 4) * big;
    const r = rnd(0.25, 0.45);
    emit(PS_NORM, x, y, z, dx * sp * 0.6 + rnd(-1.4, 1.4), dy * sp * 0.4 + rnd(-0.3, 2.2), dz * sp * 0.6 + rnd(-1.4, 1.4), rnd(0.35, 0.8), rnd(0.03, 0.09) * big, r, 0.015, 0.01, 9.8, 0.5, 0, 0.95);
  }
  for (let i = 0; i < 3; i++) emit(PS_NORM, x, y, z, rnd(-0.3, 0.3), rnd(-0.1, 0.4), rnd(-0.3, 0.3), rnd(0.4, 0.7), 0.14 * big, 0.3, 0.02, 0.015, 0, 2, 0.5, 0.55);
}
function wallImpact(x, y, z, nx, ny, nz, prop) {
  for (let i = 0; i < 5; i++) emit(PS_ADD, x, y, z, nx * rnd(1, 4) + rnd(-2, 2), ny * rnd(1, 4) + rnd(-1, 2.5), nz * rnd(1, 4) + rnd(-2, 2), rnd(0.12, 0.3), 0.025, 1.6, 0.9, 0.4, 9.8, 1);
  for (let i = 0; i < 3; i++) emit(PS_NORM, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rnd(0.3, 0.8) + rnd(-0.2, 0.2), ny * 0.4 + rnd(0, 0.4), nz * rnd(0.3, 0.8) + rnd(-0.2, 0.2), rnd(0.5, 0.9), 0.1, 0.42, 0.4, 0.36, -0.2, 1.5, 0.5, 0.5);
  if (!prop || ny !== 0) addDecal('hole', x, y, z, nx, ny, nz, 0.13, Math.random() * TAU);
}
function explosionFX(x, y, z, radius) {
  for (let i = 0; i < 46; i++) { const a = Math.random() * TAU, e = rnd(-0.3, 1), sp = rnd(2, 9) * radius / 3; emit(PS_ADD, x, y, z, Math.cos(a) * sp, e * sp * 0.7, Math.sin(a) * sp, rnd(0.25, 0.6), rnd(0.15, 0.4), 2.2, rnd(0.8, 1.2), 0.3, 2, 2, 1.2); }
  for (let i = 0; i < 18; i++) emit(PS_NORM, x + rnd(-0.5, 0.5), y + rnd(-0.3, 0.5), z + rnd(-0.5, 0.5), rnd(-1, 1), rnd(0.3, 1.5), rnd(-1, 1), rnd(0.9, 1.8), rnd(0.4, 0.8), 0.12, 0.11, 0.1, -0.3, 1.2, 1.4, 0.7);
  FX.boomLight.position.set(x, Math.max(0.5, y), z);
  FX.boomT = 0.5;
  addDecal('scorch', x, 0, z, 0, 1, 0, radius * 0.9, Math.random() * TAU);
}

// ---- 07_weapons.js ----
// Weapons: one new gun per floor for the first twelve floors, then Mk upgrades.
const WEAPONS = [
  { id: 'pistol', name: 'COMBAT PISTOL', auto: false, rate: 0.16, dmg: 34, mag: 12, start: 48, reload: 1.15, spread: 0.012, sfx: 'pistol', recoil: 0.03, kick: 0.05, pos: [0.17, -0.17, -0.38],
    model: { rec: [0.04, 0.05, 0.19], slide: true, barrel: [0.03, 0.009], mag: 'none', sight: true } },
  { id: 'magnum', name: '.44 MAGNUM', auto: false, rate: 0.42, dmg: 105, pierce: 1, mag: 6, start: 18, reload: 1.9, spread: 0.006, sfx: 'magnum', recoil: 0.085, kick: 0.09, pos: [0.17, -0.17, -0.4],
    model: { rec: [0.045, 0.06, 0.13], barrel: [0.17, 0.016], mag: 'none', cylinder: true, bodyMat: 'steel', furn: 'wood' } },
  { id: 'smg', name: 'COMPACT SMG', auto: true, rate: 0.068, dmg: 20, mag: 32, start: 96, reload: 1.5, spread: 0.032, sfx: 'smg', recoil: 0.011, kick: 0.025, pos: [0.17, -0.19, -0.42],
    model: { rec: [0.05, 0.07, 0.26], barrel: [0.07, 0.012], mag: 'box', magLen: 0.16, stock: 0.12, brake: true, twoHand: 0.06 } },
  { id: 'shotgun', name: 'PUMP SHOTGUN', auto: false, rate: 0.78, dmg: 17, pellets: 9, mag: 6, start: 18, reload: 2.1, spread: 0.085, sfx: 'shotgun', recoil: 0.1, kick: 0.12, pos: [0.17, -0.2, -0.46],
    model: { rec: [0.05, 0.07, 0.22], barrel: [0.42, 0.016], hand: [0.055, 0.05, 0.16], handMat: 'wood', tube: 0.013, stock: 0.22, furn: 'wood', twoHand: 0.12, mag: 'none' } },
  { id: 'rifle', name: 'ASSAULT RIFLE', auto: true, rate: 0.1, dmg: 36, mag: 30, start: 90, reload: 1.9, spread: 0.02, sfx: 'rifle', recoil: 0.016, kick: 0.035, pos: [0.17, -0.2, -0.46],
    model: { rec: [0.05, 0.075, 0.3], barrel: [0.3, 0.012], hand: [0.055, 0.055, 0.2], handMat: 'wood', mag: 'curve', stock: 0.22, furn: 'wood', brake: true, twoHand: 0.12 } },
  { id: 'autoshot', name: 'AUTO SHOTGUN', auto: true, rate: 0.27, dmg: 18, pellets: 8, mag: 10, start: 30, reload: 2.4, spread: 0.08, sfx: 'shotgun', recoil: 0.07, kick: 0.09, pos: [0.17, -0.21, -0.46],
    model: { rec: [0.07, 0.09, 0.3], barrel: [0.3, 0.02], hand: [0.065, 0.06, 0.16], mag: 'drum', stock: 0.2, brake: true, twoHand: 0.12, bodyMat: 'olive' } },
  { id: 'dmr', name: 'MARKSMAN RIFLE', auto: false, rate: 0.3, dmg: 140, pierce: 2, mag: 10, start: 30, reload: 2.0, spread: 0.003, sfx: 'dmr', recoil: 0.05, kick: 0.07, pos: [0.17, -0.2, -0.48],
    model: { rec: [0.05, 0.075, 0.32], barrel: [0.42, 0.012], hand: [0.055, 0.05, 0.22], mag: 'box', scope: true, stock: 0.25, brake: true, twoHand: 0.14, bodyMat: 'olive' } },
  { id: 'hmg', name: 'HEAVY MACHINE GUN', auto: true, rate: 0.065, dmg: 32, mag: 100, start: 200, reload: 3.0, spread: 0.045, sfx: 'hmg', recoil: 0.013, kick: 0.03, pos: [0.18, -0.23, -0.5],
    model: { rec: [0.08, 0.1, 0.36], barrel: [0.4, 0.018], hand: [0.075, 0.065, 0.18], mag: 'drum', stock: 0.2, brake: true, twoHand: 0.12 } },
  { id: 'rail', name: 'RAILGUN', auto: false, rate: 1.0, dmg: 420, pierce: 99, beam: true, mag: 4, start: 12, reload: 2.4, spread: 0, sfx: 'rail', recoil: 0.07, kick: 0.1, pos: [0.17, -0.21, -0.5],
    model: { rec: [0.07, 0.09, 0.34], barrel: [0.38, 0.02], mag: 'box', coils: 4, glow: 'blue', glowStrip: true, stock: 0.18, twoHand: 0.14 } },
  { id: 'plasma', name: 'PLASMA RIFLE', auto: true, rate: 0.1, dmg: 55, splash: 1.5, splashDmg: 28, proj: 'plasma', speed: 34, mag: 40, start: 120, reload: 2.0, spread: 0.012, sfx: 'plasma', recoil: 0.012, kick: 0.03, pos: [0.17, -0.21, -0.48],
    model: { rec: [0.075, 0.09, 0.3], barrel: [0.22, 0.025], mag: 'box', coils: 3, glow: 'green', glowStrip: true, twoHand: 0.1 } },
  { id: 'rocket', name: 'ROCKET LAUNCHER', auto: false, rate: 0.95, dmg: 320, splash: 4.2, splashDmg: 260, proj: 'rocket', speed: 22, mag: 4, start: 12, reload: 2.6, spread: 0, sfx: 'rocket', recoil: 0.09, kick: 0.12, pos: [0.2, -0.17, -0.42],
    model: { rec: [0.13, 0.13, 0.3], recY: 0.1, barrel: [0.5, 0.06], mag: 'none', rocket: true, bodyMat: 'olive', twoHand: 0.2, sight: false } },
  { id: 'tesla', name: 'TESLA CANNON', auto: true, rate: 0.15, dmg: 72, chain: 3, mag: 30, start: 90, reload: 2.2, spread: 0, sfx: 'tesla', recoil: 0.01, kick: 0.025, pos: [0.18, -0.22, -0.48],
    model: { rec: [0.09, 0.1, 0.3], barrel: [0.26, 0.03], mag: 'none', coils: 5, glow: 'purple', glowStrip: true, twoHand: 0.12 } },
];
const WBY = {}; WEAPONS.forEach((w, i) => { WBY[w.id] = w; w.index = i; });
const gunModels = {};
function gunModel(w) {
  if (gunModels[w.id]) return gunModels[w.id];
  gunAssets();
  const s = { ...w.model };
  const matOf = (k) => k === 'wood' ? GMAT.wood : k === 'steel' ? GMAT.steel : k === 'olive' ? GMAT.olive : undefined;
  if (s.bodyMat) s.bodyMat = matOf(s.bodyMat);
  if (s.furn) s.furn = matOf(s.furn);
  if (s.handMat) s.handMat = matOf(s.handMat);
  if (s.glow) s.glow = s.glow === 'blue' ? GMAT.glowBlue : s.glow === 'green' ? GMAT.glowGreen : GMAT.glowPurple;
  const m = buildGun(s);
  m.group.visible = false;
  gunRoot.add(m.group);
  gunModels[w.id] = m;
  return m;
}

// View-model state.
let gunRoot = null, muzzleSprite = null, gunLight = null, gunHemi = null;
const VM = { cur: null, kickZ: 0, kickR: 0, swap: 0, swapTarget: 0, bobT: 0, flashT: 0, reloadAnim: 0 };
const W = { cool: 0, reloading: false, reloadT: 0, switching: 0, pendingSwitch: null };

function initGunScene() {
  gunScene = new THREE.Scene();
  gunCam = new THREE.PerspectiveCamera(74, 1, 0.01, 10);
  gunHemi = new THREE.HemisphereLight(0xc8d4e8, 0x3a3028, 1.0);
  gunScene.add(gunHemi);
  const key = new THREE.DirectionalLight(0xfff0dd, 2.6); key.position.set(-0.5, 1, 0.6); gunScene.add(key);
  const rim = new THREE.DirectionalLight(0x9aa8ff, 1.2); rim.position.set(1, 0.4, -1); gunScene.add(rim);
  gunLight = new THREE.PointLight(0xffb060, 0, 3, 2); gunScene.add(gunLight);
  gunRoot = new THREE.Group(); gunScene.add(gunRoot);
  const sm = new THREE.SpriteMaterial({ map: TEX.flash, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  muzzleSprite = new THREE.Sprite(sm); muzzleSprite.visible = false; muzzleSprite.renderOrder = 5;
  gunScene.add(muzzleSprite);
}

function weaponDmgMul() { return RUN.mk > 0 ? 1 + 0.15 * RUN.mk : 1; }
function curW() { return WBY[RUN.owned[RUN.cur]]; }
function ammoOf(id) { return RUN.ammo[id] || (RUN.ammo[id] = { mag: 0, res: 0 }); }
function hasAmmo(id) { const a = ammoOf(id); return a.mag + a.res > 0; }
function magSize(w) { return Math.round(w.mag * (RUN.mk > 0 ? 1 + 0.1 * RUN.mk : 1)); }

function giveWeapon(id) {
  const w = WBY[id];
  if (!RUN.owned.includes(id)) RUN.owned.push(id);
  const a = ammoOf(id);
  a.mag = Math.max(a.mag, magSize(w));
  a.res = Math.max(a.res, w.start);
  equip(RUN.owned.indexOf(id), true);
}
function equip(index, instant) {
  RUN.cur = index;
  W.reloading = false; W.cool = 0.25;
  const w = curW();
  for (const k in gunModels) gunModels[k].group.visible = false;
  const m = gunModel(w);
  m.group.visible = true;
  VM.cur = m;
  VM.swap = instant ? 1 : 0;
  hud.dirty = true;
}
function cycleWeapon() {
  if (RUN.owned.length < 2 || mode !== 'play') return;
  for (let k = 1; k <= RUN.owned.length; k++) {
    const idx = (RUN.cur + k) % RUN.owned.length;
    if (hasAmmo(RUN.owned[idx]) || k === RUN.owned.length) { equip(idx, false); play('click', 0.6); return; }
  }
}
function startReload() {
  const w = curW(), a = ammoOf(w.id);
  if (W.reloading || a.res <= 0 || a.mag >= magSize(w)) return;
  W.reloading = true; W.reloadT = w.reload;
  play('reload', 0.8);
}

// Pick the best target near the crosshair for aim assist.
let _fw, _tmp, _dir, _up, _right;
function initWeaponTemps() { _fw = new THREE.Vector3(); _tmp = new THREE.Vector3(); _dir = new THREE.Vector3(); _up = new THREE.Vector3(); _right = new THREE.Vector3(); }
function assistTarget(maxAngle, maxDist) {
  camera.getWorldDirection(_fw);
  let best = null, bestA = maxAngle;
  for (const z of zombies) {
    if (z.dead || z.spawnT > 0) continue;
    const hd = Math.hypot(z.x - P.x, z.z - P.z);
    if (hd > maxDist) continue;
    for (const part of [0, 1]) {
      const y = part === 0 ? z.hy : z.chestY;
      const tx = part === 0 ? z.hx : z.x, tz = part === 0 ? z.hz : z.z;
      _tmp.set(tx - camera.position.x, y - camera.position.y, tz - camera.position.z);
      const d = _tmp.length();
      const a = Math.acos(clamp(_tmp.dot(_fw) / d, -1, 1));
      // Allow a wider cone for big targets close by.
      const lim = bestA + (part === 1 ? Math.atan2(z.radius * 0.6, d) : 0);
      if (a < lim && losClear(P.x, P.z, z.x, z.z)) { best = { z, x: tx, y, zz: tz, a }; bestA = a; }
    }
  }
  return best;
}

function fire() {
  const w = curW(), a = ammoOf(w.id);
  if (a.mag <= 0) {
    if (a.res > 0) startReload();
    else {
      play('click', 0.7, 150);
      W.cool = 0.3;
      const next = RUN.owned.findIndex(id => hasAmmo(id));
      if (next >= 0) equip(next, false);
    }
    return;
  }
  a.mag--;
  W.cool = w.rate;
  hud.dirty = true;
  const mul = weaponDmgMul();
  camera.updateMatrixWorld();
  camera.getWorldDirection(_fw);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const assist = assistTarget(0.075 * tune('aim_assist', 1), 30);
  const base = new THREE.Vector3().copy(_fw);
  if (assist && !w.pellets) {
    base.set(assist.x - camera.position.x, assist.y - camera.position.y, assist.zz - camera.position.z).normalize();
  }
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  // World-space muzzle for tracers.
  const mz = new THREE.Vector3(0.16 * clamp(camera.aspect * 1.15, 0.5, 1), -0.14, -0.7).applyQuaternion(camera.quaternion).add(camera.position);
  const moving = Math.hypot(P.vx, P.vz) > 0.5 ? 1.4 : 1;
  if (w.proj) {
    const spr = w.spread * moving;
    _dir.copy(base).addScaledVector(_right, rnd(-spr, spr)).addScaledVector(_up, rnd(-spr, spr)).normalize();
    spawnProjectile(w.proj, mz.x, mz.y, mz.z, _dir.x * w.speed, _dir.y * w.speed, _dir.z * w.speed, w.dmg * mul, w.splash, w.splashDmg * mul, 'player');
  } else if (w.chain) {
    const t = assistTarget(0.16, 22);
    if (t) {
      let cur = t.z, cy = t.y, from = [mz.x, mz.y, mz.z];
      const hitSet = new Set();
      for (let c = 0; c <= w.chain && cur; c++) {
        hitSet.add(cur);
        addArc(from[0], from[1], from[2], cur.x, cy, cur.z);
        damageZombie(cur, w.dmg * mul * (c === 0 ? 1 : 0.7), _fw.x, _fw.z, false, cur.x, cy, cur.z);
        from = [cur.x, cy, cur.z];
        let nxt = null, nd = 6;
        for (const z of zombies) { if (z.dead || hitSet.has(z)) continue; const d = Math.hypot(z.x - cur.x, z.z - cur.z); if (d < nd && losClear(cur.x, cur.z, z.x, z.z)) { nd = d; nxt = z; } }
        cur = nxt; cy = nxt ? nxt.chestY : 0;
      }
    } else {
      const h = rayWorld(ox, oy, oz, _fw.x, _fw.y, _fw.z, 14);
      addArc(mz.x, mz.y, mz.z, ox + _fw.x * h.t, oy + _fw.y * h.t, oz + _fw.z * h.t);
      if (h.t < 14) wallImpact(ox + _fw.x * h.t, oy + _fw.y * h.t, oz + _fw.z * h.t, h.nx, h.ny, h.nz, h.prop);
    }
  } else {
    const n = w.pellets || 1;
    for (let p = 0; p < n; p++) {
      const spr = w.spread * (n > 1 ? 1 : moving);
      const ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * spr;
      _dir.copy(base).addScaledVector(_right, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();
      hitscan(ox, oy, oz, _dir.x, _dir.y, _dir.z, w, mul, mz, p === 0 || n < 4 || p % 2 === 0);
    }
  }
  // Feedback.
  play(w.sfx, w.id === 'smg' || w.id === 'hmg' ? 0.55 : 0.8, 20);
  alertZombies(P.x, P.z, w.id === 'tesla' || w.id === 'plasma' ? 12 : 20);
  VM.kickZ += w.kick; VM.kickR += w.kick * 2.2;
  P.pitch = clamp(P.pitch + w.recoil * rnd(0.7, 1), -1.35, 1.35);
  P.yaw += w.recoil * rnd(-0.3, 0.3);
  P.recoilBack += w.recoil * 0.8;
  VM.flashT = w.beam || w.chain ? 0.02 : 0.05;
  if (!w.chain && !w.beam) {
    FX.flashLight.position.copy(mz);
    FX.flashLight.color.set(w.proj === 'plasma' ? 0x60ff90 : 0xffb060);
    FX.flashLight.intensity = w.proj === 'plasma' ? 14 : 36;
  }
  if (w.auto) { if ((RUN.shots = (RUN.shots || 0) + 1) % 3 === 0) haptic('light'); } else haptic(w.kick > 0.08 ? 'medium' : 'light');
  hud.xhairKick = Math.min(1, hud.xhairKick + 0.35 + w.recoil * 4);
}

function hitscan(ox, oy, oz, dx, dy, dz, w, mul, mz, tracer) {
  const wall = rayWorld(ox, oy, oz, dx, dy, dz, 60);
  const wallT = wall.t, wnx = wall.nx, wny = wall.ny, wnz = wall.nz, wprop = wall.prop;
  const hits = [];
  for (const z of zombies) {
    if (z.dead || z.spawnT > 0) continue;
    const t = rayZombie(z, ox, oy, oz, dx, dy, dz, wallT);
    if (t) hits.push(t);
  }
  hits.sort((a, b) => a.t - b.t);
  let pierce = w.pierce || 0, endT = wallT, stopped = false;
  for (const h of hits) {
    const hx = ox + dx * h.t, hy = oy + dy * h.t, hz = oz + dz * h.t;
    let dmg = w.dmg * mul * (h.head ? 2.5 : 1);
    if (w.pellets && h.t > 10) dmg *= 0.6;
    damageZombie(h.z, dmg, dx, dz, h.head, hx, hy, hz);
    // Blood sprays onto the surface behind.
    const back = rayWorld(hx, hy, hz, dx, dy * 0.5 - 0.3, dz, 2.6);
    if (back.t < 2.6 && Math.random() < 0.7) addDecal('blood', hx + dx * back.t, hy + (dy * 0.5 - 0.3) * back.t, hz + dz * back.t, back.nx, back.ny, back.nz, rnd(0.4, 1.0), Math.random() * TAU, rint(0, 2));
    if (pierce-- <= 0) { endT = h.t; stopped = true; break; }
  }
  const ex = ox + dx * endT, ey = oy + dy * endT, ez = oz + dz * endT;
  if (!stopped && wallT < 60) wallImpact(ex, ey, ez, wnx, wny, wnz, wprop);
  if (w.beam) addBeam(mz.x, mz.y, mz.z, ox + dx * wallT, oy + dy * wallT, oz + dz * wallT);
  else if (tracer && Math.random() < 0.75) addTracer(mz.x, mz.y, mz.z, ex, ey, ez);
}
// Ray against a zombie's head sphere and body capsule (vertical).
function rayZombie(z, ox, oy, oz, dx, dy, dz, maxT) {
  let best = null;
  // head
  {
    const cx = z.hx - ox, cy = z.hy - oy, cz = z.hz - oz, r = z.headR;
    const b = cx * dx + cy * dy + cz * dz, c = cx * cx + cy * cy + cz * cz - r * r;
    const disc = b * b - c;
    if (disc >= 0) { const t = b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { z, t, head: true }; }
  }
  // body
  {
    const h2 = dx * dx + dz * dz;
    if (h2 > 1e-8) {
      const cx = z.x - ox, cz = z.z - oz;
      const s = (cx * dx + cz * dz) / h2;
      const px = ox + dx * s - z.x, pz = oz + dz * s - z.z;
      const d2 = px * px + pz * pz, r = z.bodyR;
      if (d2 < r * r) {
        const t = s - Math.sqrt((r * r - d2) / h2);
        const y = oy + dy * t;
        if (t > 0 && t < maxT && y > 0.05 && y < z.bodyTop && (!best || t < best.t)) best = { z, t, head: false };
      }
    }
  }
  return best;
}

// ---------- projectiles ----------
const projectiles = [];
let projGeo = null;
function spawnProjectile(kind, x, y, z, vx, vy, vz, dmg, splash, splashDmg, owner) {
  if (!projGeo) projGeo = new THREE.SphereGeometry(1, 10, 8);
  const color = kind === 'plasma' ? new THREE.Color(0.5, 3, 0.9) : kind === 'acid' ? new THREE.Color(0.9, 2.4, 0.2) : new THREE.Color(3, 1.6, 0.6);
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color }));
  m.scale.setScalar(kind === 'rocket' ? 0.08 : kind === 'acid' ? 0.12 : 0.07);
  if (kind === 'rocket') m.scale.set(0.06, 0.06, 0.06);
  m.position.set(x, y, z);
  scene.add(m);
  projectiles.push({ kind, x, y, z, vx, vy, vz, dmg, splash: splash || 0, splashDmg: splashDmg || 0, owner, m, life: 4, trail: 0 });
  if (kind === 'acid') play3('spit', x, z, 0.7);
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    if (p.kind === 'acid') p.vy -= 4 * dt;
    const sp = Math.hypot(p.vx, p.vy, p.vz), step = sp * dt;
    const dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
    const h = rayWorld(p.x, p.y, p.z, dx, dy, dz, step);
    let hitT = h.t < step ? h.t : Infinity, hitZ = null;
    if (p.owner === 'player') {
      for (const z of zombies) { if (z.dead || z.spawnT > 0) continue; const r = rayZombie(z, p.x, p.y, p.z, dx, dy, dz, Math.min(hitT, step)); if (r && r.t < hitT) { hitT = r.t; hitZ = r; } }
    } else {
      const ddx = P.x - p.x, ddz = P.z - p.z, ddy = (EYE - 0.4) - p.y;
      const s = clamp(ddx * dx + ddy * dy + ddz * dz, 0, step);
      const cx = p.x + dx * s - P.x, cy = p.y + dy * s - (EYE - 0.4), cz = p.z + dz * s - P.z;
      if (cx * cx + cy * cy * 0.3 + cz * cz < 0.5 * 0.5 && s < hitT && !P.dead) { hitT = s; hitZ = 'player'; }
    }
    if (hitT < Infinity || p.life <= 0) {
      const t = hitT < Infinity ? hitT : 0;
      const x = p.x + dx * t, y = p.y + dy * t, z = p.z + dz * t;
      if (hitZ === 'player') { hurtPlayer(p.dmg, p.x - dx, p.z - dz); acidFX(x, y, z); }
      else if (p.owner === 'player') {
        if (hitZ && hitZ.z) damageZombie(hitZ.z, p.dmg, dx, dz, hitZ.head, x, y, z);
        if (p.splash) splashDamage(x, y, z, p.splash, p.splashDmg, hitZ && hitZ.z);
        if (p.kind === 'rocket') { explosionFX(x, y, z, p.splash); play3('boom', x, z, 1, 0); P.shake = Math.max(P.shake, clamp(1.2 - Math.hypot(x - P.x, z - P.z) / 12, 0.15, 1)); haptic('heavy'); }
        else plasmaFX(x, y, z);
      } else acidFX(x, y, z);
      scene.remove(p.m); p.m.material.dispose();
      projectiles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.m.position.set(p.x, p.y, p.z);
    p.trail -= dt;
    if (p.trail <= 0) {
      p.trail = 0.016;
      if (p.kind === 'rocket') { emit(PS_NORM, p.x, p.y, p.z, rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2), rnd(0.6, 1.1), 0.18, 0.5, 0.48, 0.45, -0.2, 1, 0.6, 0.5); emit(PS_ADD, p.x, p.y, p.z, 0, 0, 0, 0.1, 0.16, 2.4, 1.2, 0.3); }
      else if (p.kind === 'plasma') emit(PS_ADD, p.x, p.y, p.z, rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1), 0.18, 0.12, 0.3, 1.6, 0.5);
      else emit(PS_NORM, p.x, p.y, p.z, 0, -0.3, 0, 0.3, 0.09, 0.4, 0.7, 0.1, 2, 0, 0, 0.7);
    }
  }
}
function splashDamage(x, y, z, radius, dmg, direct) {
  for (const zb of zombies) {
    if (zb.dead || zb === direct) continue;
    const d = Math.hypot(zb.x - x, zb.z - z);
    if (d < radius + zb.radius && losClear(x, z, zb.x, zb.z)) damageZombie(zb, dmg * (1 - 0.6 * d / (radius + zb.radius)), zb.x - x, zb.z - z, false, zb.x, zb.chestY, zb.z, true);
  }
  const pd = Math.hypot(P.x - x, P.z - z);
  if (radius > 2 && pd < radius * 0.8 && losClear(x, z, P.x, P.z)) hurtPlayer(Math.round(20 * (1 - pd / (radius * 0.8))), x, z);
}
function plasmaFX(x, y, z) { for (let i = 0; i < 14; i++) emit(PS_ADD, x, y, z, rnd(-3, 3), rnd(-1, 3), rnd(-3, 3), rnd(0.15, 0.35), rnd(0.05, 0.12), 0.4, 2, 0.6, 3, 2); }
function acidFX(x, y, z) { for (let i = 0; i < 12; i++) emit(PS_NORM, x, y, z, rnd(-2, 2), rnd(0, 2.5), rnd(-2, 2), rnd(0.3, 0.6), rnd(0.04, 0.1), 0.45, 0.8, 0.12, 9, 0.5, 0, 0.9); }

// ---------- view model animation ----------
function updateViewModel(dt, moving) {
  if (!VM.cur) return;
  const w = curW();
  VM.kickZ = lerp(VM.kickZ, 0, 1 - Math.exp(-dt * 14));
  VM.kickR = lerp(VM.kickR, 0, 1 - Math.exp(-dt * 12));
  VM.swap = Math.min(1, VM.swap + dt / 0.35);
  VM.bobT += dt * (moving ? 9 : 2);
  const bobA = moving ? 0.012 : 0.003;
  let reloadDip = 0;
  if (W.reloading) { const t = 1 - W.reloadT / w.reload; reloadDip = Math.sin(Math.min(1, t) * Math.PI); }
  const g = VM.cur.group;
  const swapDrop = Math.pow(1 - VM.swap, 3) * 0.35;
  // Place the gun as a fraction of the visible view so it reads the same in portrait and landscape,
  // angled in toward the crosshair so its side shows.
  const gz = w.pos[2] * (gunCam.aspect < 0.8 ? 1.75 : 1.2);
  const halfH = -gz * Math.tan(gunCam.fov * Math.PI / 360), halfW = halfH * gunCam.aspect;
  const gx = Math.min(w.pos[0] * 1.2, halfW * 0.5), gyv = -halfH * 0.46;
  g.position.set(gx + Math.sin(VM.bobT * 0.5) * bobA + P.swayX, gyv + Math.abs(Math.cos(VM.bobT * 0.5)) * bobA - swapDrop - reloadDip * 0.12 + P.swayY, gz + VM.kickZ);
  g.rotation.set(VM.kickR + reloadDip * 0.7 + 0.05, 0.2 + P.swayX * 2 + reloadDip * 0.3, reloadDip * 0.5 - 0.04);
  // Muzzle flash.
  if (VM.flashT > 0) {
    VM.flashT -= dt;
    g.updateMatrixWorld();
    muzzleSprite.position.copy(VM.cur.muzzle).applyMatrix4(g.matrixWorld);
    muzzleSprite.visible = true;
    const sc = w.proj === 'rocket' ? 0.3 : w.pellets ? 0.26 : 0.18;
    muzzleSprite.scale.set(sc * rnd(0.8, 1.2), sc * rnd(0.8, 1.2), 1);
    muzzleSprite.material.rotation = Math.random() * TAU;
    muzzleSprite.material.color.set(w.proj === 'plasma' ? 0x80ffa0 : 0xffffff);
    gunLight.position.copy(muzzleSprite.position);
    gunLight.intensity = 4;
  } else { muzzleSprite.visible = false; gunLight.intensity = 0; }
}

// ---- 08_enemies.js ----
// Zombies, bosses, the spawn director, pickups and player damage.
const ZT = {
  walker: { hp: 70, speed: 1.3, dmg: 10, scale: 1, radius: 0.32, score: 10, reach: 1.05, turn: 3.5 },
  runner: { hp: 48, speed: 3.5, dmg: 7, scale: 0.96, radius: 0.3, score: 15, reach: 1.0, turn: 6 },
  brute: { hp: 330, speed: 1.15, dmg: 24, scale: 1.38, radius: 0.46, score: 40, reach: 1.35, turn: 2.5 },
  spitter: { hp: 110, speed: 1.6, dmg: 12, scale: 1.0, radius: 0.32, score: 25, reach: 1.05, turn: 3.5, ranged: true },
  butcher: { hp: 1900, speed: 1.75, dmg: 30, scale: 2.05, radius: 0.8, score: 600, reach: 2.3, turn: 2.2, boss: true, name: 'THE BUTCHER' },
  brood: { hp: 2300, speed: 0.95, dmg: 18, scale: 1.75, radius: 0.85, score: 700, reach: 2.0, turn: 1.8, boss: true, name: 'THE BROODMOTHER' },
};
const zombies = [];
const zpool = {};
let boss = null;

// Gradual difficulty. A smooth level per floor: the first floors ramp gently, the slope
// reaches full strength by floor 7, and the floors after each boss give a fading breather.
function difficultyLevel(f) {
  const d = Math.max(0, f - 1);
  let e = d * (0.55 + 0.45 * Math.min(1, d / 6));
  if (f > 5) { const k = (f - 1) % 5; e -= 0.8 * (1 - k / 4); }
  return Math.max(0, e) * tune('difficulty_ramp', 1);
}
function difficulty(f) {
  const d = difficultyLevel(f);
  return {
    level: d,
    hp: 1 + 0.14 * d, spd: 1 + Math.min(0.45, 0.03 * d), dmg: 1 + 0.07 * d,
    quota: Math.min(40, 8 + Math.round(2 * d)), cap: Math.min(18, 5 + Math.round(d)),
    interval: Math.max(1.0, 4.6 - 0.24 * d), init: Math.min(14, 4 + Math.round(d * 0.8)),
  };
}
function pickType(f) {
  const w = [['walker', 10], ['runner', f >= 2 ? Math.min(6, (f - 1) * 1.5) : 0], ['brute', f >= 4 ? Math.min(4, (f - 3) * 0.8) : 0], ['spitter', f >= 7 ? Math.min(4, (f - 6) * 0.8) : 0]];
  let tot = 0; for (const [, v] of w) tot += v;
  let r = Math.random() * tot;
  for (const [k, v] of w) { if ((r -= v) <= 0) return k; }
  return 'walker';
}

function spawnZombie(type, x, z, aware) {
  const def = ZT[type];
  const pool = zpool[type] || (zpool[type] = []);
  const model = pool.pop() || buildZombie(type);
  model.root.rotation.order = 'YXZ';
  model.root.rotation.set(0, Math.random() * TAU, 0);
  model.root.position.set(x, 0, z);
  model.root.scale.setScalar(def.scale);
  model.head.visible = true;
  scene.add(model.root);
  const D = RUN.D;
  const hpMul = def.boss ? (1 + 0.55 * Math.max(0, Math.floor(RUN.floor / 5) - 1)) * (1 + 0.06 * (RUN.floor - 5)) : D.hp;
  const zb = {
    type, def, model, x, z, yaw: model.root.rotation.y, hp: def.hp * hpMul, maxHp: def.hp * hpMul,
    speed: def.speed * (def.boss ? 1 : D.spd * (1 + 0.1 * (RUN.heat || 0))) * rnd(0.88, 1.12), aware: false, atkT: 0, atkCd: 0.5, phase: Math.random() * 10,
    flinch: 0, dead: false, deadT: 0, radius: def.radius, scale: def.scale, seed: Math.random() * 10,
    headR: 0.15 * def.scale, bodyR: (type === 'brood' ? 0.5 : 0.27) * def.scale, chestY: 1.2 * def.scale, bodyTop: 1.48 * def.scale,
    hx: x, hy: 1.6 * def.scale, hz: z, los: false, losT: 0, groanT: rnd(1, 6), wanderT: 0, wanderYaw: 0, wanderGo: false,
    state: 'chase', stateT: 0, chargeCd: 4, spitCd: rnd(1.5, 3), summonCd: 7, cdx: 0, cdz: 0, fall: 1, spawnT: 0, kx: 0, kz: 0,
  };
  zombies.push(zb);
  if (aware) wake(zb, true);
  return zb;
}
function wake(z, silent) {
  if (z.aware) return;
  z.aware = true;
  if (!silent && Math.random() < 0.6) play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, 0.9, 200);
}
function alertZombies(x, z, r) {
  for (const zb of zombies) if (!zb.dead && !zb.aware && Math.hypot(zb.x - x, zb.z - z) < r) wake(zb, true);
}
function removeZombie(zb) {
  scene.remove(zb.model.root);
  zb.model.root.rotation.set(0, 0, 0);
  (zpool[zb.type] || (zpool[zb.type] = [])).push(zb.model);
}
function clearZombies() {
  for (const zb of zombies) removeZombie(zb);
  zombies.length = 0;
  boss = null;
}

function spawnFar(type) {
  if (!L.spawnCells.length) return null;
  let best = null, bestScore = -1;
  for (let k = 0; k < 14; k++) {
    const c = L.spawnCells[Math.floor(Math.random() * L.spawnCells.length)];
    const x = ((c % L.N) + 0.5) * CELL, z = (((c / L.N) | 0) + 0.5) * CELL;
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < 9) continue;
    const seen = d < 24 && losClear(P.x, P.z, x, z);
    const score = (seen ? 0 : 30) + Math.min(d, 26);
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  if (!best) return null;
  return spawnZombie(type || pickType(RUN.floor), best[0] + rnd(-0.6, 0.6), best[1] + rnd(-0.6, 0.6), true);
}

const DIRECTOR = { t: 3, addT: 6 };
function populateFloor() {
  DIRECTOR.t = 4; DIRECTOR.addT = 6;
  const n = L.boss ? 3 : RUN.D.init;
  const cells = L.spawnCells.slice();
  for (let i = 0; i < n && cells.length; i++) {
    const k = cells.splice(Math.floor(Math.random() * cells.length), 1)[0];
    spawnZombie(pickType(RUN.floor), ((k % L.N) + 0.5 + rnd(-0.25, 0.25)) * CELL, (((k / L.N) | 0) + 0.5 + rnd(-0.25, 0.25)) * CELL, false);
  }
}
function updateDirector(dt) {
  const alive = zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
  if (L.boss) {
    if (!RUN.bossSpawned) {
      const k = cellOf(P.z) * L.N + cellOf(P.x);
      if (L.arena && L.roomOf[k] === L.arena.id) spawnBoss();
    } else if (boss && !boss.dead) {
      DIRECTOR.addT -= dt;
      if (DIRECTOR.addT <= 0) { DIRECTOR.addT = rnd(6, 9); if (alive < 5) spawnFar(Math.random() < 0.6 ? 'runner' : 'walker'); }
    }
    return;
  }
  // Threat builds the longer you stay on a floor: faster spawns, more zombies at once.
  RUN.heat = Math.min(1, (RUN.heat || 0) + dt * tune('threat_build', 1) / 100);
  if (RUN.graceT > 0) { RUN.graceT -= dt; return; }
  DIRECTOR.t -= dt;
  if (DIRECTOR.t <= 0) {
    DIRECTOR.t = RUN.D.interval * (1 - 0.4 * RUN.heat) * (exitOpen ? 1.15 : 1) * rnd(0.7, 1.3);
    if (alive < RUN.D.cap + Math.round(3 * RUN.heat)) spawnFar();
  }
}
function spawnBoss() {
  RUN.bossSpawned = true;
  const kind = (Math.floor(RUN.floor / 5) % 2 === 1) ? 'butcher' : 'brood';
  const a = L.arena;
  // Opposite side of the arena from where the player entered.
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const vx = cx - P.x, vz = cz - P.z, vl = Math.hypot(vx, vz) || 1;
  const bx = clamp(cx + vx / vl * CELL * 2.6, (a.x + 0.7) * CELL, (a.x + a.w - 0.7) * CELL);
  const bz = clamp(cz + vz / vl * CELL * 2.6, (a.y + 0.7) * CELL, (a.y + a.h - 0.7) * CELL);
  boss = spawnZombie(kind, bx, bz, true);
  boss.chargeCd = 3;
  play('roar', 1, 0);
  P.shake = Math.max(P.shake, 0.5);
  haptic('heavy');
  sting('danger');
  musicSet('boss');
  showBanner(ZT[kind].name, 'BOSS · FLOOR ' + RUN.floor, '#ff4a3a');
  hud.dirty = true;
}

function hurtPlayer(dmg, fx, fz) {
  if (P.dead || mode !== 'play') return;
  const d = Math.round(dmg * RUN.D.dmg);
  P.hp -= d;
  P.hurtT = 1;
  // A short breather after a heavy hit or when nearly dead.
  if (d >= 15 || P.hp < 30) RUN.graceT = Math.max(RUN.graceT || 0, 2.5);
  hud.dmgAngle = Math.atan2(fx - P.x, fz - P.z);
  hud.dmgT = 1;
  P.shake = Math.max(P.shake, 0.3 + d / 60);
  play('hurt', 0.9, 120);
  haptic('heavy');
  hud.dirty = true;
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
}

function damageZombie(z, dmg, dx, dz, head, hx, hy, hz, splash) {
  if (z.dead) return;
  if (z.state === 'stunned') dmg *= 1.5;
  z.hp -= dmg;
  wake(z, true);
  const dl = Math.hypot(dx, dz) || 1;
  if (!z.def.boss) {
    z.flinch = Math.max(z.flinch, 0.22);
    const kb = Math.min(0.5, dmg / 140) * (splash ? 2.5 : 1);
    z.kx += dx / dl * kb * 4; z.kz += dz / dl * kb * 4;
  } else z.flinch = Math.max(z.flinch, 0.06);
  bloodBurst(hx, hy, hz, dx / dl, 0, dz / dl, head ? 16 : 9, z.def.boss ? 1.6 : 1);
  play3(head ? 'splat' : 'zhit', z.x, z.z, 0.7, 40);
  hud.hit = head ? 2 : 1; hud.hitT = 0.18;
  RUN.shotsHit = (RUN.shotsHit || 0) + 1;
  if (z.hp <= 0) killZombie(z, head, dx / dl, dz / dl);
  if (z === boss) hud.dirty = true;
}
function killZombie(z, head, dx, dz) {
  z.dead = true; z.deadT = 0;
  // Fall away from the shot.
  const fwd = Math.sin(z.yaw) * dx + Math.cos(z.yaw) * dz;
  z.fallDir = fwd > 0 ? 1 : -1;
  if (head) bloodBurst(z.hx, z.hy, z.hz, dx, 0.5, dz, 14, 1.1);
  addDecal('blood', z.x + dx * 0.5, 0, z.z + dz * 0.5, 0, 1, 0, 1.2 * z.scale, Math.random() * TAU, rint(0, 2));
  play3('zdie', z.x, z.z, 0.85, 60);
  RUN.kills++;
  addScore(z.def.score * (1 + 0.1 * (RUN.floor - 1)) + (head ? 5 : 0));
  if (!z.def.boss) RUN.floorKills++;
  const dropMul = tune('ammo_drops', 1);
  if (z.def.boss) {
    for (let i = 0; i < 4; i++) spawnPickup('ammo', z.x + rnd(-1.2, 1.2), z.z + rnd(-1.2, 1.2), true);
    for (let i = 0; i < 2; i++) spawnPickup('med', z.x + rnd(-1.2, 1.2), z.z + rnd(-1.2, 1.2), true);
    bossDefeated(z);
  } else {
    // Drops lean toward what the player is short of.
    const cw = curW(), ca = ammoOf(cw.id);
    const ammoP = (ca.mag + ca.res < magSize(cw) ? 0.5 : 0.3) * dropMul;
    const medP = P.hp < 35 ? 0.18 : 0.06;
    const r = Math.random();
    if (r < ammoP) spawnPickup('ammo', z.x, z.z, true);
    else if (r < ammoP + medP) spawnPickup('med', z.x, z.z, true);
  }
  if (!L.boss && !exitOpen && RUN.floorKills >= RUN.D.quota) openExit();
  hud.dirty = true;
}
function openExit() {
  setExitOpen();
  play('ding', 0.9, 0);
  play3('door', (L.exit.ex + 0.5) * CELL, (L.exit.ey + 0.5) * CELL, 1, 0);
  sting('success');
  showBanner('ELEVATOR OPEN', 'Follow the arrow', '#5dff8a');
  haptic('success');
}
function bossDefeated(z) {
  RUN.bossesKilled = (RUN.bossesKilled || 0) + 1;
  P.shake = Math.max(P.shake, 0.6);
  play('roar', 0.7, 0);
  musicSet('explore');
  // Kill the adds with the boss.
  for (const o of zombies) if (!o.dead && o !== z) { o.hp = 0; killZombie(o, false, 0, 1); }
  openExit();
  showBanner(z.def.name + ' DOWN', '+' + fmt(z.def.score) + ' · elevator open', '#ffd25a');
  ctx.platform.milestone && ctx.platform.milestone('boss_defeated', { floor: RUN.floor });
}

const _ws = { x: 0, z: 0 };
function updateZombies(dt) {
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.dead) {
      z.deadT += dt;
      const m = z.model;
      const t = Math.min(1, z.deadT / 0.55);
      const e = t < 1 ? t * t * (3 - 2 * t) : 1;
      m.root.rotation.x = z.fallDir * e * Math.PI / 2 * (z.type === 'brood' ? 0.8 : 1);
      m.root.position.y = e * 0.14 * z.scale;
      m.legs[0].kn.rotation.x = e * 0.6; m.legs[1].kn.rotation.x = e * 0.2;
      for (const a of m.arms) { a.sh.rotation.x = lerp(a.sh.rotation.x, -2.6, dt * 3); }
      if (z.deadT > 5) m.root.position.y -= (z.deadT - 5) * 0.35;
      if (z.deadT > 6.2) { removeZombie(z); zombies.splice(i, 1); }
      continue;
    }
    updateZombie(z, dt);
  }
  // Separation.
  for (let a = 0; a < zombies.length; a++) {
    const A = zombies[a]; if (A.dead) continue;
    for (let b = a + 1; b < zombies.length; b++) {
      const B = zombies[b]; if (B.dead) continue;
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), r = A.radius + B.radius;
      if (d < r && d > 1e-4) {
        const push = (r - d) / d * 0.5, wa = A.def.boss ? 0.1 : 1, wb = B.def.boss ? 0.1 : 1;
        A.x -= dx * push * wa; A.z -= dz * push * wa; B.x += dx * push * wb; B.z += dz * push * wb;
      }
    }
  }
}

function updateZombie(z, dt) {
  const def = z.def, m = z.model;
  const dx = P.x - z.x, dz = P.z - z.z, dist = Math.hypot(dx, dz);
  z.losT -= dt;
  if (z.losT <= 0) { z.los = !P.dead && losClear(z.x, z.z, P.x, P.z); z.losT = rnd(0.15, 0.3); }
  if (!z.aware && !P.dead && mode === 'play' && (dist < 4.5 || (dist < 15 && z.los))) wake(z);
  z.flinch = Math.max(0, z.flinch - dt);
  z.atkCd -= dt;
  let speed = 0, desYaw = z.yaw, moveYaw = null;
  const chasing = z.aware && !P.dead && mode === 'play';
  if (chasing) {
    let tx = P.x, tz = P.z;
    if (!(z.los && dist < 18) && flow) { flowStep(flow, z.x, z.z, _ws); tx = _ws.x; tz = _ws.z; }
    desYaw = Math.atan2(tx - z.x, tz - z.z);
    moveYaw = desYaw;
    speed = z.speed;
    if (def.boss) speed = bossThink(z, dt, dist, dx, dz) ?? speed;
    else if (def.ranged && z.los && dist > 4 && dist < 13) {
      speed = dist > 9 ? z.speed * 0.6 : 0;
      z.spitCd -= dt;
      if (z.spitCd <= 0 && z.atkT <= 0) { z.atkT = 0.55; z.atkKind = 'spit'; z.spitCd = rnd(2.2, 3.2); }
    }
    // Melee.
    if (z.atkT > 0) {
      z.atkT -= dt;
      speed *= 0.25;
      if (z.atkT <= 0) {
        if (z.atkKind === 'spit') {
          const sx = z.hx, sy = z.hy, sz = z.hz;
          const tdx = P.x + P.vx * 0.4 - sx, tdz = P.z + P.vz * 0.4 - sz, hd = Math.hypot(tdx, tdz), v = 11, tt = hd / v;
          spawnProjectile('acid', sx, sy, sz, tdx / hd * v, ((EYE - 0.3) - sy) / tt + 0.5 * 4 * tt, tdz / hd * v, def.dmg, 0, 0, 'zombie');
        } else if (z.atkKind === 'slam') {
          P.shake = Math.max(P.shake, 0.45);
          for (let k = 0; k < 20; k++) emit(PS_NORM, z.x + Math.sin(z.yaw) * 1.5 + rnd(-1, 1), 0.1, z.z + Math.cos(z.yaw) * 1.5 + rnd(-1, 1), rnd(-1.5, 1.5), rnd(0.5, 2), rnd(-1.5, 1.5), rnd(0.6, 1.2), rnd(0.2, 0.4), 0.35, 0.32, 0.28, 3, 1.5, 0.5, 0.6);
          if (dist < def.reach + 0.9) hurtPlayer(def.dmg, z.x, z.z);
        } else if (dist < def.reach + 0.45) hurtPlayer(def.dmg, z.x, z.z);
        z.atkCd = def.boss ? 1.6 : rnd(0.9, 1.3);
        z.atkKind = null;
      }
    } else if (dist < def.reach && z.atkCd <= 0 && (z.state === 'chase')) {
      z.atkT = def.boss ? 0.8 : 0.5;
      z.atkKind = def.boss && z.type === 'butcher' ? 'slam' : 'melee';
      if (Math.random() < 0.5) play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, 0.8, 300);
    }
    if (dist < def.reach * 0.75 && z.state === 'chase') speed = 0;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = rnd(3, 8); play3(pick(['groan0', 'groan1', 'groan2']), z.x, z.z, def.boss ? 1 : 0.7, 150); }
  } else {
    z.wanderT -= dt;
    if (z.wanderT <= 0) { z.wanderT = rnd(2, 5); z.wanderYaw = Math.random() * TAU; z.wanderGo = Math.random() < 0.5; }
    desYaw = z.wanderYaw; moveYaw = z.wanderYaw;
    speed = z.wanderGo ? 0.35 : 0;
  }
  if (z.flinch > 0) speed *= 0.3;
  if (z.state === 'charge') { desYaw = Math.atan2(z.cdx, z.cdz); moveYaw = desYaw; }
  z.yaw += clamp(angDelta(z.yaw, desYaw), -def.turn * dt, def.turn * dt);
  const ox = z.x, oz = z.z;
  if (moveYaw !== null && speed > 0) {
    const fy = z.state === 'charge' ? moveYaw : lerp(z.yaw, z.yaw + angDelta(z.yaw, moveYaw), 0.7);
    z.x += Math.sin(fy) * speed * dt; z.z += Math.cos(fy) * speed * dt;
  }
  z.x += z.kx * dt; z.z += z.kz * dt;
  z.kx *= Math.exp(-dt * 8); z.kz *= Math.exp(-dt * 8);
  const hit = collide(z, z.radius, false);
  if (hit && !z.aware) z.wanderT = 0;
  if (z.state === 'charge' && hit && Math.hypot(z.x - ox, z.z - oz) < speed * dt * 0.4) {
    z.state = 'stunned'; z.stateT = 1.6; P.shake = Math.max(P.shake, clamp(0.6 - dist / 30, 0.1, 0.6)); play3('boom', z.x, z.z, 0.6, 0);
  }
  // Keep a body-length from the player.
  if (!P.dead) {
    const ddx = z.x - P.x, ddz = z.z - P.z, dd = Math.hypot(ddx, ddz), mr = z.radius + P_RADIUS - 0.05;
    if (dd < mr && dd > 1e-4) { z.x = P.x + ddx / dd * mr; z.z = P.z + ddz / dd * mr; }
  }
  const actual = Math.hypot(z.x - ox, z.z - oz) / Math.max(dt, 1e-4);
  animZombie(z, dt, actual);
}

function bossThink(z, dt, dist, dx, dz) {
  z.stateT -= dt;
  if (z.type === 'butcher') {
    z.chargeCd -= dt;
    if (z.state === 'chase' && dist > 5 && z.chargeCd <= 0 && z.los && z.atkT <= 0) { z.state = 'windup'; z.stateT = 0.9; play('roar', 0.9, 0); P.shake = Math.max(P.shake, 0.25); }
    if (z.state === 'windup') { if (z.stateT <= 0) { z.state = 'charge'; z.stateT = 1.5; const d = dist || 1; z.cdx = dx / d; z.cdz = dz / d; } return 0; }
    if (z.state === 'charge') {
      if (dist < z.radius + P_RADIUS + 0.35) { hurtPlayer(z.def.dmg + 5, z.x, z.z); P.kx += z.cdx * 9; P.kz += z.cdz * 9; z.state = 'recover'; z.stateT = 0.9; }
      if (z.stateT <= 0) { z.state = 'recover'; z.stateT = 0.6; }
      return 8.5;
    }
    if (z.state === 'stunned' || z.state === 'recover') { if (z.stateT <= 0) { z.state = 'chase'; z.chargeCd = rnd(4.5, 7); } return 0; }
    return z.speed;
  }
  // Broodmother: keeps her distance, lobs acid, calls runners.
  z.spitCd -= dt; z.summonCd -= dt;
  if (z.spitCd <= 0 && z.los && z.atkT <= 0) {
    z.spitCd = rnd(2.4, 3.2);
    const v = 10;
    for (const off of [-0.22, 0, 0.22]) {
      const a = Math.atan2(dx, dz) + off, tt = dist / v;
      spawnProjectile('acid', z.hx, z.hy, z.hz, Math.sin(a) * v, ((EYE - 0.3) - z.hy) / tt + 0.5 * 4 * tt, Math.cos(a) * v, 11, 0, 0, 'zombie');
    }
  }
  if (z.summonCd <= 0) {
    z.summonCd = rnd(8, 11);
    const alive = zombies.reduce((n, o) => n + (o.dead ? 0 : 1), 0);
    if (alive < 7) {
      play('roar', 0.6, 0);
      for (let k = 0; k < 2; k++) { const a = Math.random() * TAU; const s = spawnZombie('runner', z.x + Math.sin(a) * 1.6, z.z + Math.cos(a) * 1.6, true); collide(s, s.radius, false); }
    }
  }
  return dist < 6 ? -z.speed * 0.6 : dist > 9 ? z.speed : 0;
}

function animZombie(z, dt, speed) {
  const m = z.model, def = z.def;
  const sw = clamp(Math.abs(speed) / (def.boss ? 1.6 : 1.1), 0, 1.2);
  z.phase += dt * (1.2 + Math.abs(speed) * 2.4 / def.scale);
  const ph = z.phase;
  const run = (z.type === 'runner' && speed > 1.8) || z.state === 'charge';
  m.root.position.set(z.x, 0, z.z);
  m.root.rotation.y = z.yaw;
  const amp = run ? 0.85 : 0.5;
  m.legs[0].hp.rotation.x = Math.sin(ph) * amp * sw; m.legs[1].hp.rotation.x = -Math.sin(ph) * amp * sw;
  m.legs[0].kn.rotation.x = Math.max(0, -Math.cos(ph)) * (run ? 1.3 : 0.8) * sw + 0.05;
  m.legs[1].kn.rotation.x = Math.max(0, Math.cos(ph)) * (run ? 1.3 : 0.8) * sw + 0.05;
  m.hips.position.y = 0.92 - Math.abs(Math.cos(ph)) * 0.035 * sw;
  const fl = z.flinch > 0 ? -z.flinch * 2.2 : 0;
  m.torso.rotation.x = (run ? 0.5 : 0.24) + fl + (z.state === 'windup' ? -0.35 : 0) + (z.state === 'stunned' ? 0.5 : 0);
  m.torso.rotation.z = Math.sin(ph) * 0.07 * (1 + sw) + Math.sin(z.seed) * 0.1;
  m.neck.rotation.z = Math.sin(ph * 0.5 + z.seed) * 0.22;
  m.neck.rotation.x = -0.2 + Math.sin(ph * 0.7) * 0.06;
  m.jaw.rotation.x = 0.28 + Math.abs(Math.sin(ph * 1.3 + z.seed)) * 0.25 + (z.state === 'windup' ? 0.5 : 0);
  let k = 0;
  for (const a of m.arms) {
    const s = k++ === 0 ? -1 : 1;
    if (z.atkT > 0) {
      const tot = def.boss ? 0.8 : 0.55, t = 1 - z.atkT / tot;
      const raise = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
      a.sh.rotation.x = lerp(-1.3, -2.9, raise) + (t > 0.6 ? (t - 0.6) * 4 : 0);
      a.el.rotation.x = -0.4 * raise;
      a.sh.rotation.z = s * 0.15;
    } else if (run) {
      a.sh.rotation.x = s * Math.sin(ph) * 0.9 - 0.4; a.el.rotation.x = -1.1; a.sh.rotation.z = s * 0.12;
    } else if (z.type === 'brood') {
      a.sh.rotation.x = -0.4 + Math.sin(ph * 0.5 + s) * 0.2; a.el.rotation.x = -0.5; a.sh.rotation.z = s * 0.5;
    } else {
      a.sh.rotation.x = -1.32 + Math.sin(ph * 0.5 + s + z.seed) * 0.13; a.el.rotation.x = -0.18 + Math.sin(ph * 0.4 + s) * 0.1; a.sh.rotation.z = s * 0.08;
    }
  }
  m.root.position.y = 0;
  m.root.rotation.x = 0;
  m.head.updateWorldMatrix(true, false);
  const e = m.head.matrixWorld.elements;
  z.hx = e[12]; z.hy = e[13]; z.hz = e[14];
}

// ---------- pickups ----------
const pickups = [];
function spawnPickup(kind, x, z, dropped) {
  const p = buildPickup(kind);
  p.grp.traverse(o => { o.userData.sharedGeo = true; });
  p.grp.position.set(x, 0, z);
  levelGroup.add(p.grp);
  const e = { kind, x, z, grp: p.grp, mesh: p.mesh, t: Math.random() * 10, y: dropped ? 0.9 : 0, vy: dropped ? 2.4 : 0 };
  collide(e, 0.25, false);
  e.grp.position.x = e.x; e.grp.position.z = e.z;
  pickups.push(e);
}
function clearPickups() { for (const p of pickups) if (p.grp.parent) p.grp.parent.remove(p.grp); pickups.length = 0; }
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    if (p.y > 0 || p.vy > 0) { p.vy -= 12 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0; }
    p.grp.position.y = p.y + Math.sin(p.t * 2.5) * 0.04;
    p.mesh.rotation.y = p.t * 1.2;
    if (mode !== 'play' || P.dead) continue;
    if (Math.hypot(p.x - P.x, p.z - P.z) < 1.0) {
      if (p.kind === 'med') {
        if (P.hp >= P.maxHp) continue;
        P.hp = Math.min(P.maxHp, P.hp + 35);
        play('med', 0.8, 0);
        floatNote('+35 HEALTH', '#ff6b6b');
      } else {
        for (const id of RUN.owned) { const w = WBY[id], a = ammoOf(id); a.res += Math.ceil(magSize(w) * (id === curW().id ? 1 : 0.45)); }
        play('pickup', 0.8, 0);
        floatNote('+AMMO', '#ffd25a');
      }
      haptic('light');
      hud.dirty = true;
      levelGroup.remove(p.grp);
      pickups.splice(i, 1);
    }
  }
}

// ---- 09_hud.js ----
// HUD, touch controls and menus (DOM over the WebGL canvas).
let hudRoot = null, touchRoot = null, modalRoot = null;
const hud = { dirty: true, hit: 0, hitT: 0, dmgT: 0, dmgAngle: 0, xhairKick: 0, bannerT: 0, compassT: 0, compassAng: 0, compassDist: 0 };
const els = {};
const UI = { W: 0, H: 0 };
const input = { mx: 0, mz: 0, lookDX: 0, lookDY: 0, fireIds: new Set(), keys: {}, stick: null, ptr: new Map() };

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
function setT(e, v) { if (e._v !== v) { e._v = v; e.textContent = v; } }
function setS(e, k, v) { if (e['_' + k] !== v) { e['_' + k] = v; e.style[k] = v; } }

const CSS = `
.df{position:absolute;inset:0;font-family:DFI,Inter,'Helvetica Neue',Arial,sans-serif;color:#ece6d6;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.df *{box-sizing:border-box}
.df-num{font-family:DFB,'Bebas Neue',Impact,'Arial Narrow',sans-serif;letter-spacing:.04em}
.df-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(0,0,0,.6) 100%);pointer-events:none}
.df-dmg{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0) 40%,rgba(160,0,0,.75) 100%);opacity:0;pointer-events:none}
.df-low{position:absolute;inset:0;box-shadow:inset 0 0 90px 30px rgba(150,0,0,.55);opacity:0;pointer-events:none}
.df-x{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.df-x i{position:absolute;background:rgba(240,240,230,.9);box-shadow:0 0 2px rgba(0,0,0,.9)}
.df-x .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:2px}
.df-hm{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;pointer-events:none}
.df-hm:before,.df-hm:after{content:'';position:absolute;left:12px;top:0;width:2px;height:26px;background:#fff;transform:rotate(45deg);clip-path:polygon(0 0,100% 0,100% 35%,0 35%,0 65%,100% 65%,100% 100%,0 100%)}
.df-hm:after{transform:rotate(-45deg)}
.df-hm.head:before,.df-hm.head:after{background:#ff4a3a}
.df-tl{position:absolute;pointer-events:none}
.df-hp{display:flex;align-items:center;gap:8px}
.df-hpbar{width:132px;height:10px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);border-radius:2px;overflow:hidden}
.df-hpbar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#c22,#f55);transform-origin:left center}
.df-hpn{font-size:22px;line-height:1;text-shadow:0 1px 2px #000}
.df-floor{font-size:15px;margin-top:6px;color:#d9c64a;text-shadow:0 1px 2px #000;letter-spacing:.12em}
.df-obj{font-size:12px;font-weight:700;margin-top:3px;text-shadow:0 1px 2px #000;letter-spacing:.06em;opacity:.92}
.df-obj.open{color:#6dff95}
.df-threat{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:9px;font-weight:700;letter-spacing:.14em;opacity:.85;text-shadow:0 1px 2px #000}
.df-threat div{width:84px;height:5px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);overflow:hidden}
.df-threat i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#d9c64a,#ff6a2a,#ff2a1a);transform-origin:left center;transform:scaleX(0)}
.df-tr{position:absolute;pointer-events:none;text-align:right}
.df-score{font-size:26px;line-height:1;text-shadow:0 1px 3px #000}
.df-kills{font-size:11px;font-weight:700;opacity:.75;letter-spacing:.08em}
.df-comp{position:absolute;width:64px;margin-left:-32px;text-align:center;pointer-events:none}
.df-comp svg{width:30px;height:30px;filter:drop-shadow(0 1px 2px #000)}
.df-comp b{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-shadow:0 1px 2px #000}
.df-boss{position:absolute;left:50%;width:min(70vw,320px);transform:translateX(-50%);text-align:center;pointer-events:none;display:none}
.df-boss b{font-size:16px;color:#ff5a48;letter-spacing:.14em;text-shadow:0 1px 3px #000}
.df-boss div{height:8px;background:rgba(0,0,0,.6);border:1px solid rgba(255,90,72,.6);margin-top:3px}
.df-boss i{display:block;height:100%;background:linear-gradient(90deg,#801010,#ff3a2a);transform-origin:left center}
.df-banner{position:absolute;left:0;right:0;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}
.df-banner b{display:block;font-size:44px;line-height:1;text-shadow:0 2px 10px #000,0 0 30px rgba(0,0,0,.8)}
.df-banner span{display:block;font-size:13px;font-weight:700;letter-spacing:.16em;margin-top:4px;text-shadow:0 1px 3px #000}
.df-note{position:absolute;left:50%;transform:translateX(-50%);font-size:14px;font-weight:700;letter-spacing:.1em;pointer-events:none;text-shadow:0 1px 3px #000;transition:transform 1.1s ease-out,opacity 1.1s ease-in}
.df-btn{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:none;border:2px solid rgba(255,255,255,.35);background:rgba(20,20,18,.38);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.df-btn svg{width:46%;height:46%}
.df-btn.fire{border-color:rgba(255,110,80,.85);background:radial-gradient(circle,rgba(200,40,20,.55),rgba(90,10,5,.45))}
.df-btn.fire.on{background:radial-gradient(circle,rgba(255,90,50,.85),rgba(150,20,10,.6));transform:scale(.94)}
.df-btn small{position:absolute;bottom:-17px;font-size:9px;font-weight:700;letter-spacing:.12em;opacity:.75;text-shadow:0 1px 2px #000}
.df-ammo{position:absolute;text-align:right;pointer-events:none}
.df-ammo b{font-size:34px;line-height:1;text-shadow:0 1px 3px #000}
.df-ammo span{font-size:18px;opacity:.7;margin-left:3px}
.df-ammo em{display:block;font-style:normal;font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.8;text-shadow:0 1px 2px #000}
.df-ammo.low b{color:#ff6b55}
.df-ammo .rl{color:#ffd25a}
.df-stick{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:2px solid rgba(255,255,255,.22);background:radial-gradient(circle,rgba(255,255,255,.05),rgba(255,255,255,.1));pointer-events:none;opacity:.55}
.df-stick.on{opacity:1}
.df-stick i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(235,230,215,.45);border:2px solid rgba(255,255,255,.6)}
.df-ddir{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0}
.df-ddir i{position:absolute;left:-36px;top:-120px;width:72px;height:26px;border-radius:50% 50% 0 0;border-top:5px solid rgba(255,40,30,.9);filter:blur(1px)}
.df-modal{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:auto;touch-action:manipulation}
.df-modal.show{display:flex}
.df-title{background:linear-gradient(180deg,rgba(5,6,5,.35) 0%,rgba(5,6,5,.1) 40%,rgba(5,6,5,.75) 100%)}
.df-logo{font-family:DFB,'Bebas Neue',Impact,sans-serif;line-height:.86;font-size:min(23vw,120px);color:#e8e0cc;text-shadow:0 4px 0 #3a0a06,0 0 40px rgba(0,0,0,.9)}
.df-logo span{display:block}
.df-logo span+span{color:#c8281c;text-shadow:0 4px 0 #1a0402,0 0 40px rgba(120,0,0,.6)}
.df-tag{font-size:13px;font-weight:700;letter-spacing:.2em;opacity:.8;margin:10px 0 22px;text-shadow:0 1px 3px #000}
.df-b{appearance:none;-webkit-appearance:none;border:2px solid rgba(255,255,255,.5);background:rgba(15,15,13,.6);color:#f2ecdc;font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:.12em;padding:10px 0 7px;width:min(74vw,290px);margin:6px 0;border-radius:4px;cursor:pointer;pointer-events:auto}
.df-b.primary{background:linear-gradient(180deg,#c8281c,#82140c);border-color:#ff6a50}
.df-b:disabled{opacity:.45}
.df-b.small{font-size:20px;width:min(36vw,140px);padding:8px 0 5px}
.df-best{font-size:12px;font-weight:700;letter-spacing:.14em;opacity:.8;margin-top:12px;min-height:16px}
.df-help{display:flex;gap:14px;justify-content:center;margin-top:18px;font-size:11px;font-weight:700;letter-spacing:.06em;opacity:.85}
.df-help div{display:flex;flex-direction:column;align-items:center;gap:4px;width:84px}
.df-help b{font-size:20px;line-height:1}
.df-snd{position:absolute;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(15,15,13,.6);color:#fff;font-size:18px;pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center}
.df-dim{background:rgba(6,4,4,.78)}
.df-died{font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:min(20vw,86px);color:#d42a1c;line-height:.9;text-shadow:0 0 30px rgba(150,0,0,.6)}
.df-sub{font-size:13px;font-weight:700;letter-spacing:.16em;opacity:.85;margin-top:6px}
.df-big{font-family:DFB,'Bebas Neue',Impact,sans-serif;font-size:58px;line-height:1;margin-top:10px}
.df-pb{font-size:12px;font-weight:700;letter-spacing:.2em;color:#ffd25a;min-height:16px}
.df-board{width:min(80vw,300px);margin:12px 0 10px;font-size:13px;text-align:left;min-height:84px}
.df-board .row{display:flex;justify-content:space-between;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08)}
.df-board .me{background:rgba(200,40,28,.25)}
.df-board .st{opacity:.6;text-align:center;font-size:12px;padding-top:8px}
.df-row{display:flex;gap:10px;justify-content:center}
.df-sens{display:flex;align-items:center;gap:12px;margin:8px 0;font-size:13px;font-weight:700;letter-spacing:.12em}
.df-sens button{width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.5);background:rgba(15,15,13,.6);color:#fff;font-size:22px;pointer-events:auto;cursor:pointer}
.df-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.df-load{font-size:12px;font-weight:700;letter-spacing:.14em;opacity:.7;margin-top:6px;min-height:15px}
`;

const ICON = {
  fire: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 2l7 14-7-4-7 4z" fill="#6dff95" stroke="#0a2a12" stroke-width="1"/></svg>',
};

function buildHUD() {
  hudRoot = ctx.createRoot({ layer: 'overlay', order: 1, input: 'passthrough' });
  hudRoot.classList.add('df');
  el('style', null, hudRoot, CSS);
  els.vig = el('div', 'df-vig', hudRoot);
  els.dmg = el('div', 'df-dmg', hudRoot);
  els.low = el('div', 'df-low', hudRoot);
  els.game = el('div', null, hudRoot); els.game.style.cssText = 'position:absolute;inset:0;display:none';
  const G = els.game;
  els.x = el('div', 'df-x', G);
  els.xl = [0, 1, 2, 3].map(() => el('i', null, els.x));
  el('i', 'dot', els.x);
  els.hm = el('div', 'df-hm', G);
  els.ddir = el('div', 'df-ddir', G, '<i></i>');
  els.tl = el('div', 'df-tl', G);
  const hp = el('div', 'df-hp', els.tl);
  els.hpBar = el('i', null, el('div', 'df-hpbar', hp));
  els.hpN = el('div', 'df-hpn df-num', hp);
  els.floor = el('div', 'df-floor df-num', els.tl);
  els.obj = el('div', 'df-obj', els.tl);
  els.threat = el('div', 'df-threat', els.tl, '<span>THREAT</span><div><i></i></div>');
  els.threatBar = els.threat.querySelector('i');
  els.tr = el('div', 'df-tr', G);
  els.score = el('div', 'df-score df-num', els.tr);
  els.kills = el('div', 'df-kills', els.tr);
  els.comp = el('div', 'df-comp', G, ICON.arrow + '<b></b>');
  els.compArrow = els.comp.querySelector('svg');
  els.compTxt = els.comp.querySelector('b');
  els.boss = el('div', 'df-boss', G, '<b></b><div><i></i></div>');
  els.bossName = els.boss.querySelector('b'); els.bossBar = els.boss.querySelector('i');
  els.banner = el('div', 'df-banner', G, '<b class="df-num"></b><span></span>');
  els.bannerT = els.banner.querySelector('b'); els.bannerS = els.banner.querySelector('span');
  els.notes = el('div', null, G);
  els.stick = el('div', 'df-stick', G, '<i></i>');
  els.knob = els.stick.querySelector('i');
  els.fire = el('div', 'df-btn fire', G, ICON.fire);
  els.reload = el('div', 'df-btn', G, ICON.reload + '<small>RELOAD</small>');
  els.swap = el('div', 'df-btn', G, ICON.swap + '<small>SWAP</small>');
  els.pause = el('div', 'df-btn', G, ICON.pause);
  els.ammo = el('div', 'df-ammo', G, '<b class="df-num"></b><span class="df-num"></span><em></em>');
  els.ammoMag = els.ammo.querySelector('b'); els.ammoRes = els.ammo.querySelector('span'); els.ammoName = els.ammo.querySelector('em');

  touchRoot = ctx.createRoot({ layer: 'content', order: 5, input: 'auto', touchAction: 'none' });
  touchRoot.style.touchAction = 'none';
  modalRoot = ctx.createRoot({ layer: 'modal', order: 1, input: 'passthrough' });
  modalRoot.classList.add('df');
  buildScreens();
  wireInput();
  ctx.onResize(layoutHUD, { immediate: true });
}

function layoutHUD() {
  UI.W = ctx.width; UI.H = ctx.height;
  const a = area();
  UI.a = a;
  const W = UI.W, H = UI.H;
  const bottom = H - a.bottom;
  const big = Math.min(46, Math.max(38, W * 0.105));
  UI.fire = { x: W - a.right - 22 - big, y: bottom - 26 - big, r: big };
  UI.reload = { x: UI.fire.x - big - 46, y: UI.fire.y + big * 0.35, r: 25 };
  UI.swap = { x: UI.fire.x - big * 0.25, y: UI.fire.y - big - 52, r: 25 };
  UI.pause = { x: W - a.right - 30, y: a.top + 28, r: 21 };
  UI.stickHome = { x: a.left + 30 + 59, y: bottom - 30 - 59 };
  UI.stickR = 52;
  const place = (e, c) => { e.style.left = (c.x - c.r) + 'px'; e.style.top = (c.y - c.r) + 'px'; e.style.width = e.style.height = (c.r * 2) + 'px'; };
  place(els.fire, UI.fire); place(els.reload, UI.reload); place(els.swap, UI.swap); place(els.pause, UI.pause);
  els.tl.style.left = (a.left + 14) + 'px'; els.tl.style.top = (a.top + 10) + 'px';
  els.tr.style.right = (a.right + 62) + 'px'; els.tr.style.top = (a.top + 12) + 'px';
  els.comp.style.left = (W / 2) + 'px'; els.comp.style.top = (a.top + 8) + 'px';
  els.boss.style.top = (a.top + 104) + 'px';
  els.banner.style.top = (H * 0.27) + 'px';
  els.ammo.style.right = (a.right + 16) + 'px';
  els.ammo.style.top = (UI.swap.y - UI.swap.r - 58) + 'px';
  if (!input.stick) { els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px'; }
  for (const s of [els.title, els.pauseS, els.dead]) if (s) s.style.padding = `${a.top + 10}px ${a.right + 16}px ${a.bottom + 10}px ${a.left + 16}px`;
  if (els.snd) { els.snd.style.right = (a.right + 14) + 'px'; els.snd.style.top = (a.top + 10) + 'px'; }
  if (renderer) resizeRenderer();
}

function showBanner(title, sub, color) {
  setT(els.bannerT, title); setT(els.bannerS, sub || '');
  els.bannerT.style.color = color || '#ece6d6';
  els.banner.style.opacity = 1;
  hud.bannerT = 2.6;
}
function floatNote(text, color) {
  const n = el('div', 'df-note', els.notes, text);
  n.style.color = color; n.style.top = (UI.H * 0.6) + 'px';
  ctx.timeout(() => { n.style.transform = 'translate(-50%,-40px)'; n.style.opacity = 0; }, 30);
  ctx.timeout(() => n.remove(), 1200);
}

// ---------- input ----------
function localXY(e) { const r = touchRoot.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
const near = (x, y, c, pad) => Math.hypot(x - c.x, y - c.y) < c.r + pad;
function roleAt(x, y) {
  if (near(x, y, UI.pause, 12)) return 'pause';
  if (near(x, y, UI.fire, 16)) return 'fire';
  if (near(x, y, UI.reload, 12)) return 'reload';
  if (near(x, y, UI.swap, 12)) return 'swap';
  if (x < UI.W * 0.45 && y > UI.a.top + 70) return 'move';
  return 'look';
}
function wireInput() {
  ctx.listen(touchRoot, 'pointerdown', (e) => {
    if (mode !== 'play') return;
    e.preventDefault();
    try { touchRoot.setPointerCapture(e.pointerId); } catch (err) { }
    const [x, y] = localXY(e);
    const role = roleAt(x, y);
    input.ptr.set(e.pointerId, { role, x, y });
    if (!RUN.interacted) { RUN.interacted = true; try { ctx.platform.interact({ kind: 'first_touch' }); } catch (err) { } }
    if (role === 'move') {
      const a = UI.a;
      const ox = clamp(x, a.left + 62, UI.W * 0.45), oy = clamp(y, a.top + 120, UI.H - a.bottom - 30);
      input.stick = { id: e.pointerId, ox, oy };
      els.stick.style.left = ox + 'px'; els.stick.style.top = oy + 'px';
      els.stick.classList.add('on');
      stickMove(x, y);
    } else if (role === 'fire') { input.fireIds.add(e.pointerId); }
    else if (role === 'reload') startReload();
    else if (role === 'swap') cycleWeapon();
    else if (role === 'pause') pauseGame();
  });
  ctx.listen(touchRoot, 'pointermove', (e) => {
    const p = input.ptr.get(e.pointerId); if (!p) return;
    const [x, y] = localXY(e);
    if (p.role === 'move' && input.stick && input.stick.id === e.pointerId) stickMove(x, y);
    else if (p.role === 'look' || p.role === 'fire') { input.lookDX += x - p.x; input.lookDY += y - p.y; }
    p.x = x; p.y = y;
  });
  const up = (e) => {
    const p = input.ptr.get(e.pointerId); if (!p) return;
    input.ptr.delete(e.pointerId);
    input.fireIds.delete(e.pointerId);
    if (input.stick && input.stick.id === e.pointerId) {
      input.stick = null; input.mx = input.mz = 0;
      els.stick.classList.remove('on');
      els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px';
      els.knob.style.transform = '';
    }
  };
  ctx.listen(touchRoot, 'pointerup', up);
  ctx.listen(touchRoot, 'pointercancel', up);
  ctx.listen(touchRoot, 'lostpointercapture', up);
  ctx.listen(touchRoot, 'contextmenu', (e) => e.preventDefault());
  // Keyboard for desktop play.
  ctx.listen(window, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    input.keys[k] = true;
    if (mode === 'play') {
      if (k === 'r') startReload();
      if (k === 'q' || k === 'e' || k === 'tab') { cycleWeapon(); e.preventDefault(); }
      if (k === 'escape' || k === 'p') pauseGame();
      if (k === ' ') e.preventDefault();
    } else if (mode === 'paused' && (k === 'escape' || k === 'p')) resumeGame();
  });
  ctx.listen(window, 'keyup', (e) => { input.keys[e.key.toLowerCase()] = false; });
  ctx.listen(window, 'blur', () => { input.keys = {}; input.fireIds.clear(); });
}
function stickMove(x, y) {
  const s = input.stick; if (!s) return;
  let dx = x - s.ox, dy = y - s.oy;
  const d = Math.hypot(dx, dy), R = UI.stickR;
  if (d > R) { dx *= R / d; dy *= R / d; }
  input.mx = dx / R; input.mz = -dy / R;
  els.knob.style.transform = `translate(${dx}px,${dy}px)`;
}
function fireHeld() { return input.fireIds.size > 0 || !!input.keys[' '] || !!input.keys['f']; }
function releaseAllInput() {
  input.ptr.clear(); input.fireIds.clear(); input.stick = null; input.mx = input.mz = 0; input.lookDX = input.lookDY = 0;
  if (els.stick) { els.stick.classList.remove('on'); els.knob.style.transform = ''; els.stick.style.left = UI.stickHome.x + 'px'; els.stick.style.top = UI.stickHome.y + 'px'; }
}

// ---------- per-frame HUD ----------
function updateHUD(dt) {
  const playing = mode === 'play' || mode === 'paused';
  setS(els.game, 'display', playing || mode === 'transition' ? 'block' : 'none');
  const hpf = P.hp / P.maxHp;
  setS(els.low, 'opacity', playing && hpf < 0.3 ? String(((0.3 - hpf) / 0.3 * 0.6 + 0.35 * Math.abs(Math.sin(performance.now() / 300))).toFixed(2)) : '0');
  hud.dmgT = Math.max(0, hud.dmgT - dt * 1.6);
  setS(els.dmg, 'opacity', (hud.dmgT * 0.8).toFixed(2));
  if (!playing && mode !== 'transition') return;
  // Crosshair spread.
  hud.xhairKick = Math.max(0, hud.xhairKick - dt * 4);
  const w = curW();
  if (w) {
    const gap = 6 + (w.spread || 0.01) * 160 + hud.xhairKick * 10 + (Math.hypot(P.vx, P.vz) > 0.5 ? 4 : 0);
    const L4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const key = gap.toFixed(0);
    if (els.x._g !== key) {
      els.x._g = key;
      els.xl.forEach((l, i) => {
        const [sx, sy] = L4[i], len = 8;
        l.style.width = (sx ? len : 2) + 'px'; l.style.height = (sy ? len : 2) + 'px';
        l.style.left = (sx ? (sx > 0 ? gap : -gap - len) : -1) + 'px';
        l.style.top = (sy ? (sy > 0 ? gap : -gap - len) : -1) + 'px';
      });
    }
  }
  hud.hitT = Math.max(0, hud.hitT - dt);
  setS(els.hm, 'opacity', hud.hitT > 0 ? '1' : '0');
  if (hud.hitT > 0) els.hm.classList.toggle('head', hud.hit === 2);
  setS(els.ddir, 'opacity', (hud.dmgT).toFixed(2));
  if (hud.dmgT > 0) setS(els.ddir, 'transform', `rotate(${relAngle(hud.dmgAngle).toFixed(3)}rad)`);
  setS(els.threat, 'display', L && !L.boss ? 'flex' : 'none');
  setS(els.threatBar, 'transform', `scaleX(${clamp(RUN.heat || 0, 0, 1).toFixed(2)})`);
  setS(els.fire, 'transform', fireHeld() ? 'scale(0.94)' : '');
  els.fire.classList.toggle('on', fireHeld());
  hud.bannerT -= dt;
  if (hud.bannerT <= 0) setS(els.banner, 'opacity', '0');
  // Compass toward the exit.
  hud.compassT -= dt;
  if (hud.compassT <= 0 && L && exitFlow) {
    hud.compassT = 0.15;
    const i = cellOf(P.x), j = cellOf(P.z);
    let tx = (L.exit.ex + 0.5) * CELL, tz = (L.exit.ey + 0.5) * CELL;
    const k = j * L.N + i;
    if (L.g[k] !== 3 && !(L.g[k] === 1 && exitFlow[k] <= 1)) {
      let x = P.x, z = P.z;
      for (let s = 0; s < 2; s++) { flowStep(exitFlow, x, z, _ws); x = _ws.x; z = _ws.z; }
      tx = x; tz = z;
    }
    hud.compassAng = Math.atan2(tx - P.x, tz - P.z);
    hud.compassDist = Math.round(Math.max(0, (exitFlow[k] >= 0 ? exitFlow[k] : (L.g[k] === 2 ? L.dStart[L.exit.ry * L.N + L.exit.rx] : 0)) * CELL));
  }
  const showComp = mode === 'play' && (exitOpen || (L && L.boss && RUN.bossSpawned === false));
  setS(els.comp, 'display', showComp ? 'block' : 'none');
  if (showComp) {
    setS(els.compArrow, 'transform', `rotate(${relAngle(hud.compassAng).toFixed(2)}rad)`);
    setT(els.compTxt, exitOpen ? (hud.compassDist > 0 ? hud.compassDist + 'm' : 'EXIT') : 'ARENA');
  }
  if (!hud.dirty) return;
  hud.dirty = false;
  els.hpBar.style.transform = `scaleX(${clamp(hpf, 0, 1)})`;
  setT(els.hpN, String(Math.ceil(P.hp)));
  setT(els.floor, 'FLOOR ' + RUN.floor + (RUN.mk > 0 ? ' · MK ' + (RUN.mk + 1) : ''));
  if (L && L.boss) setT(els.obj, exitOpen ? 'ELEVATOR OPEN' : (RUN.bossSpawned ? 'KILL ' + (boss ? boss.def.name : 'THE BOSS') : 'FIND THE ARENA'));
  else setT(els.obj, exitOpen ? 'ELEVATOR OPEN' : `KILLS ${Math.min(RUN.floorKills, RUN.D.quota)} / ${RUN.D.quota} TO OPEN ELEVATOR`);
  els.obj.classList.toggle('open', exitOpen);
  setT(els.score, fmt(RUN.score));
  setT(els.kills, RUN.kills + (RUN.kills === 1 ? ' KILL' : ' KILLS'));
  if (boss && !boss.dead) { setS(els.boss, 'display', 'block'); setT(els.bossName, boss.def.name); els.bossBar.style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`; }
  else setS(els.boss, 'display', 'none');
  if (w) {
    const a = ammoOf(w.id);
    setT(els.ammoMag, W.reloading ? '··' : String(a.mag));
    setT(els.ammoRes, '/ ' + a.res);
    setT(els.ammoName, W.reloading ? 'RELOADING' : w.name);
    els.ammo.classList.toggle('low', a.mag <= Math.ceil(magSize(w) * 0.25));
    setS(els.swap, 'display', RUN.owned.length > 1 ? 'flex' : 'none');
  }
}
// Angle of a world direction relative to the view (0 = ahead, + = right).
function relAngle(worldAng) {
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const dx = Math.sin(worldAng), dz = Math.cos(worldAng);
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

// ---------- screens ----------
function btn(parent, label, cls, fn) {
  const b = el('button', 'df-b ' + (cls || ''), parent, label);
  b.type = 'button';
  ctx.listen(b, 'click', (e) => { e.stopPropagation(); fn(); });
  return b;
}
function buildScreens() {
  els.fade = el('div', 'df-fade', modalRoot);
  // Title
  const T = els.title = el('div', 'df-modal df-title', modalRoot);
  el('div', 'df-logo', T, '<span>DEAD</span><span>FLOORS</span>');
  el('div', 'df-tag', T, 'HOW DEEP CAN YOU GO?');
  els.startBtn = btn(T, 'LOADING…', 'primary', () => startRun(false));
  els.startBtn.disabled = true;
  els.contBtn = btn(T, 'CONTINUE', '', () => startRun(true));
  els.contBtn.style.display = 'none';
  els.load = el('div', 'df-load', T);
  els.best = el('div', 'df-best', T);
  el('div', 'df-help', T, '<div><b>◎</b>LEFT THUMB<br>MOVES</div><div><b>↔</b>DRAG RIGHT<br>TO AIM</div><div><b>●</b>HOLD FIRE<br>TO SHOOT</div>');
  els.snd = el('button', 'df-snd', T, settings.sound ? '🔊' : '🔇');
  ctx.listen(els.snd, 'click', () => toggleSound());
  // Pause
  const Pz = els.pauseS = el('div', 'df-modal df-dim', modalRoot);
  el('div', 'df-died', Pz, 'PAUSED').style.color = '#ece6d6';
  els.pauseInfo = el('div', 'df-sub', Pz, '');
  el('div', '', Pz).style.height = '18px';
  btn(Pz, 'RESUME', 'primary', () => resumeGame());
  els.sndBtn = btn(Pz, 'SOUND: ON', '', () => toggleSound());
  const sens = el('div', 'df-sens', Pz);
  const minus = el('button', '', sens, '−'); minus.type = 'button';
  els.sensTxt = el('span', '', sens, '');
  const plus = el('button', '', sens, '+'); plus.type = 'button';
  ctx.listen(minus, 'click', () => setSens(-0.1));
  ctx.listen(plus, 'click', () => setSens(0.1));
  btn(Pz, 'QUIT TO MENU', '', () => quitToMenu());
  // Death
  const D = els.dead = el('div', 'df-modal df-dim', modalRoot);
  el('div', 'df-died', D, 'YOU DIED');
  els.deadSub = el('div', 'df-sub', D, '');
  els.deadScore = el('div', 'df-big', D, '0');
  els.deadPB = el('div', 'df-pb', D, '');
  els.board = el('div', 'df-board', D, '');
  const row = el('div', 'df-row', D);
  btn(row, 'AGAIN', 'primary small', () => startRun(false));
  btn(row, 'MENU', 'small', () => showScreen('title'));
  refreshSensText();
}
function showScreen(name) {
  for (const [k, e] of [['title', els.title], ['pause', els.pauseS], ['dead', els.dead]]) e.classList.toggle('show', k === name);
  modalRoot.style.pointerEvents = name ? 'auto' : 'none';
  if (name === 'title') { mode = 'title'; RUN.active = false; setupTitleScene(); renderTitle(); musicSet('title'); }
}
function renderTitle() {
  if (!els.title) return;
  if (threeReady) { els.startBtn.disabled = false; setT(els.startBtn, saved ? 'NEW RUN' : 'START'); }
  if (saved) { els.contBtn.style.display = ''; setT(els.contBtn, 'CONTINUE · FLOOR ' + saved.floor); }
  else els.contBtn.style.display = 'none';
  setT(els.best, bestScore != null ? 'BEST ' + fmt(bestScore) : '');
}
function toggleSound() {
  settings.sound = !settings.sound;
  sset('df_sound', settings.sound);
  els.snd.textContent = settings.sound ? '🔊' : '🔇';
  setT(els.sndBtn, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
  if (settings.sound) { unlockAudio(); buildSounds(); musicSet(mode === 'title' ? 'title' : (boss && !boss.dead ? 'boss' : 'explore')); }
  else musicSet(null);
}
function setSens(d) { settings.sens = clamp(Math.round((settings.sens + d) * 10) / 10, 0.4, 2.5); sset('df_sens', settings.sens); refreshSensText(); }
function refreshSensText() { if (els.sensTxt) setT(els.sensTxt, 'AIM SPEED ' + settings.sens.toFixed(1)); }

// ---- 10_game.js ----
// Game state, run and floor flow, player, camera, lighting, saving, records and boot.
const P = { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, vx: 0, vz: 0, kx: 0, kz: 0, shake: 0, hurtT: 0, dead: false, deadT: 0, swayX: 0, swayY: 0, recoilBack: 0, stepT: 0, bob: 0 };
const RUN = { active: false, floor: 1, score: 0, kills: 0, floorKills: 0, owned: [], ammo: {}, cur: 0, mk: 0, D: null, seed: 0, bossSpawned: false, interacted: false, doorT: 0, scavT: 0 };
RUN.D = difficulty(1);
let mode = 'boot';
let saved = null, lastSave = null, bestScore = null, threeReady = false;
let attempt = 0;
let flashlight = null, hemi = null;
const fade = { v: 0, target: 0 };
let transT = 0, titleT = 0, titleYaw = 0;
let scoreTrack = null;
try { scoreTrack = ctx.game.score(); } catch (e) { scoreTrack = null; }

function addScore(n) {
  RUN.score += Math.round(n);
  if (scoreTrack) { try { scoreTrack.set(RUN.score); } catch (e) { } }
  hud.dirty = true;
}

// ---------- progress (Continue Playing) ----------
const hasProgress = () => !!(ctx.game && ctx.game.progress);
function validSave(s) {
  if (!s || s.v !== 1) return false;
  if (!Number.isInteger(s.floor) || s.floor < 2 || s.floor > 9999) return false;
  if (!Array.isArray(s.owned) || !s.owned.length || !s.owned.every(id => WBY[id])) return false;
  if (!s.ammo || typeof s.ammo !== 'object') return false;
  for (const id of s.owned) { const a = s.ammo[id]; if (!a || !isFinite(a.mag) || !isFinite(a.res) || a.mag < 0 || a.res < 0) return false; }
  if (!isFinite(s.hp) || s.hp <= 0 || s.hp > 100) return false;
  if (!Number.isInteger(s.cur) || s.cur < 0 || s.cur >= s.owned.length) return false;
  if (!Number.isInteger(s.mk) || s.mk < 0) return false;
  if (!isFinite(s.score) || s.score < 0 || !isFinite(s.kills) || !isFinite(s.seed)) return false;
  return true;
}
function snapshot() {
  const ammo = {};
  for (const id of RUN.owned) { const a = ammoOf(id); ammo[id] = { mag: a.mag, res: a.res }; }
  return { v: 1, floor: RUN.floor, score: RUN.score, kills: RUN.kills, hp: Math.max(1, Math.ceil(P.hp)), owned: RUN.owned.slice(), ammo, cur: RUN.cur, mk: RUN.mk, seed: RUN.seed, bosses: RUN.bossesKilled || 0 };
}
function saveProgress() {
  lastSave = snapshot();
  if (!hasProgress()) return;
  const owner = attempt;
  try {
    ctx.game.progress.save('main', { state: lastSave, label: 'Floor ' + RUN.floor, percent: 0, stateSchemaVersion: 1, metadata: { floor: RUN.floor } })
      .catch((e) => { if (!disposed && owner === attempt && DEV) console.warn('progress save failed', e); });
  } catch (e) { }
}
function endProgress(kind) {
  if (!hasProgress()) return;
  try { const p = ctx.game.progress[kind]('main'); if (p && p.catch) p.catch(() => { }); } catch (e) { }
}
function loadProgress() {
  if (!hasProgress()) return;
  try {
    ctx.game.progress.load('main').then((p) => {
      if (disposed || RUN.active) return;
      const eligible = p && (p.resumeEligible === true || (p.resumeEligible === undefined && p.status === 'in_progress' && p.stateSchemaVersion === 1 && (!p.expiresAt || Date.parse(p.expiresAt) > Date.now())));
      if (eligible && validSave(p.state)) { saved = p.state; lastSave = p.state; renderTitle(); }
    }).catch(() => { });
  } catch (e) { }
}

// ---------- records ----------
function refreshBest() {
  if (!ctx.memory || !ctx.memory.record) return;
  try {
    ctx.memory.record('score').rank({ scope: 'global', period: 'all_time' }).then((r) => {
      if (disposed) return;
      bestScore = r && r.viewerRank ? r.viewerRank.value : bestScore;
      renderTitle();
    }).catch(() => { });
  } catch (e) { }
}
function submitResult() {
  const owner = attempt, score = RUN.score, floor = RUN.floor;
  const prevBest = bestScore;
  setT(els.deadPB, prevBest != null && score <= prevBest ? 'BEST ' + fmt(prevBest) : '');
  boardStatus('Saving score…');
  if (!scoreTrack) { boardStatus('Leaderboard unavailable'); return; }
  scoreTrack.submit('score', { label: fmt(score) + ' pts', metadata: { floor, kills: RUN.kills } }).then((res) => {
    if (disposed || owner !== attempt) return;
    if (res && res.isPersonalBest) {
      setT(els.deadPB, 'NEW PERSONAL BEST');
      bestScore = score;
      sting('win');
      try { ctx.pulse.complete({ score, level: floor, result: 'Reached floor ' + floor, text: `Reached floor ${floor} with ${fmt(score)} points in Dead Floors` }); } catch (e) { }
    } else if (prevBest != null) setT(els.deadPB, 'BEST ' + fmt(Math.max(prevBest, score)));
    else setT(els.deadPB, '');
    loadBoard(owner);
  }).catch(() => {
    if (disposed || owner !== attempt) return;
    setT(els.deadPB, '');
    boardStatus('Score not saved — check your connection');
  });
}
function boardStatus(text) { els.board.innerHTML = ''; el('div', 'st', els.board, text); }
function loadBoard(owner) {
  try {
    ctx.memory.record('score').leaderboard({ scope: 'global', period: 'all_time', limit: 3 }).then((lb) => {
      if (disposed || owner !== attempt) return;
      els.board.innerHTML = '';
      const rows = (lb && lb.rows) || [];
      const me = lb && lb.viewerRank;
      const name = (r) => (r.username || r.displayName || r.name || 'Player');
      rows.slice(0, 3).forEach((r, i) => {
        const row = el('div', 'row' + (me && r.rank === me.rank && r.userId === me.userId ? ' me' : ''), els.board);
        el('span', '', row, '#' + (r.rank || i + 1) + '  ' + escapeHtml(name(r)));
        el('b', '', row, r.displayLabel ? escapeHtml(String(r.displayLabel)) : fmt(r.value || 0));
      });
      if (me && !rows.slice(0, 3).some(r => r.rank === me.rank && r.userId === me.userId)) {
        const row = el('div', 'row me', els.board);
        el('span', '', row, '#' + me.rank + '  YOU');
        el('b', '', row, fmt(me.value || 0));
      }
      if (!rows.length) boardStatus('No scores yet');
      if (lb && lb.checkpointStatus && lb.checkpointStatus.failed > 0) el('div', 'st', els.board, 'Some floor checkpoints did not save');
      if (me) { bestScore = me.value; }
    }).catch(() => { if (!disposed && owner === attempt) boardStatus('Leaderboard unavailable'); });
  } catch (e) { boardStatus('Leaderboard unavailable'); }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function checkpointScore() {
  if (!scoreTrack || RUN.score <= 0) return;
  try { scoreTrack.checkpoint('score', { metadata: { floor: RUN.floor } }).catch(() => { }); } catch (e) { }
}

// ---------- run flow ----------
function startRun(fromSave) {
  if (!threeReady) return;
  attempt++;
  const s = fromSave && saved && validSave(saved) ? saved : null;
  try { ctx.platform.start({ floor: s ? s.floor : 1, resumed: !!s }); } catch (e) { }
  unlockAudio(); buildSounds();
  if (!s && saved) { endProgress('abandon'); }
  saved = null;
  RUN.active = true;
  RUN.floor = s ? s.floor : 1; RUN.score = s ? s.score : 0; RUN.kills = s ? s.kills : 0;
  RUN.owned = s ? s.owned.slice() : []; RUN.ammo = {}; RUN.cur = s ? s.cur : 0; RUN.mk = s ? s.mk : 0;
  RUN.seed = s ? s.seed : (Math.random() * 4294967295) >>> 0;
  RUN.bossesKilled = s ? (s.bosses || 0) : 0; RUN.interacted = false; RUN.shots = 0; RUN.scavT = 0;
  if (s) for (const id of RUN.owned) RUN.ammo[id] = { mag: s.ammo[id].mag, res: s.ammo[id].res };
  if (scoreTrack) { try { scoreTrack.reset(); scoreTrack.set(RUN.score); } catch (e) { } }
  P.hp = s ? s.hp : 100;
  for (const k in gunModels) gunModels[k].group.visible = false;
  VM.cur = null;
  showScreen(null);
  fade.v = 1; fade.target = 0;
  enterFloor(RUN.floor, !!s);
}

function clearProjectiles() { for (const p of projectiles) { scene.remove(p.m); p.m.material.dispose(); } projectiles.length = 0; }

function enterFloor(f, restoring) {
  RUN.floor = f; RUN.floorKills = 0; RUN.bossSpawned = false; RUN.D = difficulty(f); RUN.heat = 0; RUN.graceT = 0;
  clearZombies(); clearPickups(); clearProjectiles();
  const Ld = genLevel(f, (RUN.seed + f * 7919) >>> 0);
  buildLevel(Ld);
  for (const p of Ld.pickups) spawnPickup(p.kind, p.x, p.z, false);
  P.x = (Ld.start.ex + 0.5) * CELL; P.z = (Ld.start.ey + 0.5) * CELL;
  P.yaw = Math.atan2(Ld.start.dx, Ld.start.dy);
  P.pitch = 0; P.vx = P.vz = P.kx = P.kz = 0; P.dead = false; P.deadT = 0; P.recoilBack = 0; P.shake = 0;
  doors.start.open = 0; doors.start.target = 0;
  RUN.doorT = 1.0;
  W.reloading = false; W.cool = 0;
  populateFloor();
  let sub;
  if (!restoring) {
    if (f <= WEAPONS.length) {
      giveWeapon(WEAPONS[f - 1].id);
      sub = f === 1 ? 'KILL ' + RUN.D.quota + ' TO OPEN THE ELEVATOR' : 'NEW WEAPON · ' + WEAPONS[f - 1].name;
      if (f > 1) { play('weapon', 0.8, 0); sting('powerup'); }
    } else {
      RUN.mk++;
      for (const id of RUN.owned) { const a = ammoOf(id); a.mag = magSize(WBY[id]); a.res += Math.ceil(magSize(WBY[id]) * 0.5); }
      equip(clamp(RUN.cur, 0, RUN.owned.length - 1), true);
      sub = 'ALL WEAPONS UPGRADED · MK ' + (RUN.mk + 1);
      play('weapon', 0.8, 0); sting('powerup');
    }
  } else {
    equip(clamp(RUN.cur, 0, RUN.owned.length - 1), true);
    sub = 'WELCOME BACK';
  }
  if (Ld.boss) sub = (sub && sub.startsWith('NEW') ? sub + ' · ' : '') + 'SOMETHING BIG IS WAITING';
  showBanner('FLOOR ' + f, sub, Ld.boss ? '#ff6a50' : '#ece6d6');
  if (f > 1 || restoring) saveProgress();
  mode = 'play';
  musicSet('explore');
  play('ding', 0.7, 0);
  hud.dirty = true;
  try { renderer.compile(scene, camera); } catch (e) { }
}

function floorComplete() {
  mode = 'transition';
  transT = 0;
  addScore(100 * RUN.floor);
  doors.exit.target = 0;
  play('door', 0.9, 0);
  haptic('success');
  try { ctx.platform.milestone('floor_clear', { floor: RUN.floor }); } catch (e) { }
  checkpointScore();
  releaseAllInput();
  fade.target = 1;
}
function updateTransition(dt) {
  transT += dt;
  updateDoor(doors.exit, dt);
  if (transT > 1.3) enterFloor(RUN.floor + 1, false), fade.target = 0;
}

function playerDie() {
  P.dead = true; P.deadT = 0;
  mode = 'dying';
  releaseAllInput();
  W.reloading = false;
  play('hurt', 1, 0); play('heart', 0.8, 0);
  sting('lose');
  haptic('error');
  try { ctx.platform.fail({ floor: RUN.floor, score: RUN.score, kills: RUN.kills }); } catch (e) { }
  endProgress('complete');
  saved = null; lastSave = null;
  RUN.active = false;
  musicSet('title');
}
function updateDying(dt) {
  P.deadT += dt;
  if (P.deadT > 1.8 && !els.dead.classList.contains('show')) {
    setT(els.deadSub, 'FLOOR ' + RUN.floor + ' · ' + RUN.kills + (RUN.kills === 1 ? ' KILL' : ' KILLS'));
    setT(els.deadScore, fmt(RUN.score));
    showScreen('dead');
    mode = 'dead';
    submitResult();
  }
}

function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused';
  releaseAllInput();
  setT(els.pauseInfo, 'FLOOR ' + RUN.floor + ' · ' + fmt(RUN.score) + ' PTS');
  setT(els.sndBtn, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
  showScreen('pause');
}
function resumeGame() {
  if (mode !== 'paused') return;
  showScreen(null);
  mode = 'play';
}
function quitToMenu() {
  saved = lastSave && validSave(lastSave) ? lastSave : null;
  RUN.active = false;
  showScreen('title');
}

// ---------- player ----------
function updatePlayer(dt) {
  const k = input.keys;
  const sens = 0.0055 * settings.sens * tune('look_speed', 1);
  const ldx = input.lookDX, ldy = input.lookDY;
  input.lookDX = input.lookDY = 0;
  P.yaw -= ldx * sens;
  P.pitch -= ldy * sens * 0.85;
  if (k['arrowleft'] || k['j']) P.yaw += 2.4 * dt;
  if (k['arrowright'] || k['l']) P.yaw -= 2.4 * dt;
  if (k['i']) P.pitch += 1.6 * dt;
  if (k['k']) P.pitch -= 1.6 * dt;
  if (P.recoilBack > 0) { const r = Math.min(P.recoilBack, dt * 0.5); P.pitch -= r; P.recoilBack -= r; }
  P.pitch = clamp(P.pitch, -1.2, 1.2);
  P.swayX = lerp(P.swayX, clamp(ldx * 0.0007, -0.035, 0.035), 1 - Math.exp(-dt * 10));
  P.swayY = lerp(P.swayY, clamp(-ldy * 0.0007, -0.03, 0.03), 1 - Math.exp(-dt * 10));
  // Gentle aim magnetism while firing.
  if (fireHeld() && Math.abs(ldx) < 18) {
    const t = assistTarget(0.13, 22);
    if (t) {
      const des = Math.atan2(-(t.x - P.x), -(t.zz - P.z));
      P.yaw += clamp(angDelta(P.yaw, des), -0.2, 0.2) * Math.min(1, dt * 6) * tune('aim_assist', 1);
    }
  }
  let mx = input.mx, mz = input.mz;
  if (k['w'] || k['arrowup']) mz += 1;
  if (k['s'] || k['arrowdown']) mz -= 1;
  if (k['a']) mx -= 1;
  if (k['d']) mx += 1;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const speed = 4.4 * (W.reloading ? 0.85 : 1);
  const tvx = (fx * mz + rx * mx) * speed, tvz = (fz * mz + rz * mx) * speed;
  const a = 1 - Math.exp(-dt * 12);
  P.vx = lerp(P.vx, tvx, a); P.vz = lerp(P.vz, tvz, a);
  P.x += (P.vx + P.kx) * dt; P.z += (P.vz + P.kz) * dt;
  P.kx *= Math.exp(-dt * 6); P.kz *= Math.exp(-dt * 6);
  collide(P, P_RADIUS, true);
  const sp = Math.hypot(P.vx, P.vz);
  P.stepT += sp * dt;
  if (P.stepT > 2.1) { P.stepT = 0; play('step', 0.25, 0); }
  P.bob += dt * sp * 2.1;
  P.hurtT = Math.max(0, P.hurtT - dt);
  // Weapon.
  W.cool -= dt;
  const w = curW(), am = ammoOf(w.id);
  if (W.reloading) {
    W.reloadT -= dt;
    if (W.reloadT <= 0) {
      W.reloading = false;
      const take = Math.min(magSize(w) - am.mag, am.res);
      am.mag += take; am.res -= take;
      hud.dirty = true;
    }
  } else if (am.mag === 0 && am.res > 0 && W.cool <= 0) startReload();
  if (fireHeld() && W.cool <= 0 && !W.reloading && VM.swap > 0.85) fire();
  // Never strand the player with nothing: scavenge pistol rounds slowly.
  if (!RUN.owned.some(id => hasAmmo(id))) {
    RUN.scavT += dt;
    if (RUN.scavT > 1.6) { RUN.scavT = 0; ammoOf('pistol').res += 2; if (curW().id !== 'pistol') equip(RUN.owned.indexOf('pistol'), false); floatNote('SCAVENGED 2 ROUNDS', '#ffd25a'); hud.dirty = true; }
  } else RUN.scavT = 0;
  updateViewModel(dt, sp > 0.6);
  // Doors and exit.
  RUN.doorT -= dt;
  if (RUN.doorT <= 0 && doors.start.target === 0) { doors.start.target = 1; play('door', 0.6, 0); }
  if (exitOpen) {
    const cx = (L.exit.ex + 0.5) * CELL, cz = (L.exit.ey + 0.5) * CELL;
    if (Math.abs(P.x - cx) < CELL * 0.4 && Math.abs(P.z - cz) < CELL * 0.4) floorComplete();
  }
}

// ---------- camera, lights, rendering ----------
function updateCamera(dt) {
  P.shake = Math.max(0, P.shake - dt * 1.5);
  const sh = P.shake * P.shake * 0.1;
  const sp = Math.hypot(P.vx, P.vz);
  const by = Math.sin(P.bob * 2) * 0.03 * Math.min(1, sp / 4);
  let y = EYE + by, roll = 0;
  if (P.dead) {
    const t = Math.min(1, P.deadT / 0.9), e = t * t;
    y = lerp(EYE, 0.35, e); roll = e * 0.9;
  }
  camera.position.set(P.x + rnd(-sh, sh), y + rnd(-sh, sh), P.z + rnd(-sh, sh));
  camera.rotation.set(P.pitch + rnd(-sh, sh) * 0.4, P.yaw + rnd(-sh, sh) * 0.4, roll + Math.sin(P.bob) * 0.004);
}
let lightAssignT = 0, _lightCol = null;
const poolAssign = [null, null, null, null];
function updateLights(dt, t) {
  if (!fixtures) return;
  let changed = false;
  const col = _lightCol || (_lightCol = new THREE.Color());
  for (let k = 0; k < fixtureList.length; k++) {
    const f = fixtureList[k];
    if (f.state !== 'flicker') continue;
    const n = Math.sin(t * 23 + f.phase) + Math.sin(t * 5.7 + f.phase * 3);
    let lv = n > 0.55 ? 1 : n > 0.1 ? 0.3 : 0.04;
    if (Math.sin(t * 0.5 + f.phase) > 0.8) lv = 0.03;
    if (lv !== f.level) { f.level = lv; col.set(f.color).multiplyScalar(lv < 0.05 ? 0.04 : 2.6 * lv); fixtures.setColorAt(k, col); changed = true; }
  }
  if (changed) fixtures.instanceColor.needsUpdate = true;
  lightAssignT -= dt;
  if (lightAssignT <= 0) {
    lightAssignT = 0.15;
    const cands = [];
    for (const f of fixtureList) { if (f.state === 'off') continue; const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (d < 18) cands.push([d, f]); }
    cands.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < poolLights.length; i++) poolAssign[i] = cands[i] ? cands[i][1] : null;
  }
  let near = 0;
  for (let i = 0; i < poolLights.length; i++) {
    const L0 = poolLights[i], f = poolAssign[i];
    if (!f) { L0.intensity = Math.max(0, L0.intensity - dt * 40); continue; }
    if (L0.userData.f !== f) { L0.userData.f = f; L0.intensity = 0; L0.position.set(f.x, WALL_H - 0.3, f.z); L0.color.set(f.color); }
    const target = 9 * f.level;
    L0.intensity = lerp(L0.intensity, target, 1 - Math.exp(-dt * 18));
    const d = Math.hypot(f.x - P.x, f.z - P.z);
    near += f.level / (1 + d * d * 0.12);
  }
  if (gunHemi) gunHemi.intensity = 0.7 + Math.min(1, near) * 1.4;
  if (exitLight && L) exitLight.intensity = exitOpen ? 3 : 2 + Math.sin(t * 4) * 0.8;
}

let dynScale = 1, perfAcc = 0, perfN = 0, perfT = 0;
function pixelRatio() { return Math.min(ctx.dpr || 1, 1.6) * dynScale; }
function resizeRenderer() {
  const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  gunCam.aspect = w / h; gunCam.updateProjectionMatrix();
  const scale = (h * pixelRatio()) / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const s of FX.sys) s.mat.uniforms.uScale.value = scale;
}
function perfTick(dtMs) {
  perfAcc += dtMs; perfN++; perfT += dtMs;
  if (perfT < 2500) return;
  const avg = perfAcc / perfN;
  perfAcc = perfN = perfT = 0;
  const before = dynScale;
  if (avg > 24 && dynScale > 0.55) dynScale = Math.max(0.55, dynScale - 0.12);
  else if (avg < 15 && dynScale < 1) dynScale = Math.min(1, dynScale + 0.08);
  if (dynScale !== before) resizeRenderer();
}

function render() {
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (VM.cur && (mode === 'play' || mode === 'paused' || mode === 'transition' || (mode === 'dying' && P.deadT < 0.4))) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}

// ---------- title backdrop ----------
function setupTitleScene() {
  if (!threeReady) return;
  clearZombies(); clearPickups(); clearProjectiles();
  RUN.D = difficulty(1);
  RUN.floor = 1;
  const Ld = genLevel(1, 90210);
  buildLevel(Ld);
  for (const p of Ld.pickups) spawnPickup(p.kind, p.x, p.z, false);
  doors.start.open = doors.start.target = 1;
  updateDoor(doors.start, 0);
  P.x = (Ld.start.ex + 0.5) * CELL - Ld.start.dx * 0.6; P.z = (Ld.start.ey + 0.5) * CELL - Ld.start.dy * 0.6;
  titleYaw = Math.atan2(Ld.start.dx, Ld.start.dy);
  P.yaw = titleYaw; P.pitch = 0; P.dead = false; P.vx = P.vz = 0; P.hp = 100;
  const fx = -Math.sin(titleYaw), fz = -Math.cos(titleYaw);
  for (const [d, s] of [[5.2, -0.9], [7.5, 1.1]]) {
    const z = spawnZombie('walker', P.x + fx * d + Math.cos(titleYaw) * s, P.z + fz * d - Math.sin(titleYaw) * s, false);
    collide(z, z.radius, false);
    z.yaw = Math.atan2(P.x - z.x, P.z - z.z);
    z.wanderYaw = z.yaw; z.wanderGo = false; z.wanderT = 3;
  }
  titleT = 0;
  mode = 'title';
}
function updateTitle(dt) {
  titleT += dt;
  P.yaw = titleYaw + Math.sin(titleT * 0.22) * 0.35;
  P.pitch = -0.04 + Math.sin(titleT * 0.15) * 0.04;
  // Keep the demo zombies near the camera.
  for (const z of zombies) {
    const d = Math.hypot(z.x - P.x, z.z - P.z);
    if (d > 9 || d < 3.5) { z.wanderYaw = Math.atan2(P.x - z.x, P.z - z.z) + (d < 3.5 ? Math.PI : 0); z.wanderGo = true; z.wanderT = 2; }
  }
}

// ---------- frame ----------
function frame(dtMs) {
  if (disposed || !renderer) return;
  perfTick(dtMs);
  const dt = Math.min(dtMs, 50) / 1000;
  const t = performance.now() / 1000;
  if (mode === 'title') { updateTitle(dt); updateZombies(dt); updatePickups(dt); }
  else if (mode === 'play') {
    updatePlayer(dt);
    updateFlow();
    updateDirector(dt);
    updateZombies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateDoor(doors.start, dt); updateDoor(doors.exit, dt);
    // Music follows the fight.
    if (!(boss && !boss.dead)) {
      const close = zombies.some(z => !z.dead && z.aware && Math.hypot(z.x - P.x, z.z - P.z) < 12);
      RUN.combatT = close ? 4 : Math.max(0, (RUN.combatT || 0) - dt);
      musicSet(RUN.combatT > 0 ? 'combat' : 'explore');
    }
  } else if (mode === 'transition') { updateTransition(dt); updateViewModel(dt, false); }
  else if (mode === 'dying' || mode === 'dead') { updateDying(dt); updateZombies(dt); updateProjectiles(dt); }
  if (mode !== 'paused') { updateParticles(dt); updateLineFX(dt); }
  fade.v = fade.target > fade.v ? Math.min(fade.target, fade.v + dt * 1.6) : Math.max(fade.target, fade.v - dt * 1.4);
  setS(els.fade, 'opacity', fade.v.toFixed(3));
  updateCamera(dt);
  updateLights(dt, t);
  render();
  updateHUD(dt);
}

// ---------- boot ----------
function initRenderer() {
  const canvas = ctx.createCanvas({ layer: 'background', order: 0, input: 'passthrough' });
  canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x050605, 1);
  ctx.listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); try { ctx.platform.error({ stage: 'webgl_context_lost' }); } catch (err) { } });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050605);
  scene.fog = new THREE.FogExp2(0x070807, 0.072);
  camera = new THREE.PerspectiveCamera(72, Math.max(1, ctx.width) / Math.max(1, ctx.height), 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  flashlight = new THREE.SpotLight(0xfff0d8, 20, 26, 0.52, 0.65, 2);
  flashlight.position.set(0.18, -0.12, 0.1);
  camera.add(flashlight);
  flashlight.target.position.set(0.08, -0.12, -6);
  camera.add(flashlight.target);
  hemi = new THREE.HemisphereLight(0x7a8898, 0x1e1812, 0.32);
  scene.add(hemi);
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 11, 2); scene.add(l); poolLights.push(l); }
}
function bootFail(stage, e) {
  try { ctx.platform.error({ stage, message: String((e && e.message) || e).slice(0, 300) }); } catch (err) { }
  if (DEV) console.error(stage, e);
  setT(els.startBtn, stage === 'library' ? 'RETRY' : 'UNAVAILABLE');
  els.startBtn.disabled = stage !== 'library';
  setT(els.load, stage === 'library' ? "COULDN'T LOAD THE 3D ENGINE" : '3D GRAPHICS ARE NOT AVAILABLE ON THIS DEVICE');
}

let bootTries = 0;
async function boot() {
  bootTries++;
  setT(els.load, 'LOADING THE BUILDING…');
  try { THREE = await ctx.importModule('three', '0.164.1'); }
  catch (e) {
    if (disposed) return;
    bootFail('library', e);
    if (bootTries < 4) RETRY = true;
    else setT(els.startBtn, 'UNAVAILABLE');
    return;
  }
  if (disposed) return;
  initWorldTemps(); initWeaponTemps();
  try { initRenderer(); buildEnvironment(); }
  catch (e) { bootFail('renderer', e); return; }
  try {
    buildTextures(); buildMaterials(); initFX(); initGunScene();
    resizeRenderer();
    threeReady = true;
    setupTitleScene();
    for (const w of WEAPONS) gunModel(w);
    frame(16);
  } catch (e) { bootFail('first_frame', e); return; }
  setT(els.load, '');
  renderTitle();
  ctx.game.loop({ update: frame, onError: (err) => { if (DEV) console.error(err); try { ctx.platform.error({ stage: 'loop', message: String(err && err.message || err).slice(0, 300) }); } catch (x) { } } });
  ctx.timeout(() => { if (!disposed) buildSounds(); }, 60);
}
let RETRY = false;

// Paint the title immediately, then load the engine behind it.
buildHUD();
els.title.classList.add('show');
modalRoot.style.pointerEvents = 'auto';
mode = 'title';
// The start button retries a failed engine load (bounded by bootTries).
ctx.listen(els.startBtn, 'click', (e) => { if (RETRY && !threeReady) { e.stopImmediatePropagation(); RETRY = false; els.startBtn.disabled = true; boot(); } }, { capture: true });
try { ctx.markVisualReady('title'); } catch (e) { }
try { ctx.platform.ready(); } catch (e) { }
try { ctx.loadFont('DFB', 'bebas-neue', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
try { ctx.loadFont('DFI', 'inter', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
musicSet('title');
loadProgress();
refreshBest();
await boot();
if (DEV) window.__DF = { gunGroup: () => VM.cur && VM.cur.group, losClear, flowStep, get exitFlow() { return exitFlow; }, get exitOpen() { return exitOpen; }, ammoOf, curW, cycleWeapon, P, RUN, zombies, get mode() { return mode; }, set mode(v) { mode = v; }, startRun, enterFloor, floorComplete, hurtPlayer, setExitOpen, openExit, L: () => L, input, WEAPONS, giveWeapon, renderer: () => renderer, killAll: () => { for (const z of zombies) if (!z.dead) { z.hp = 0; killZombie(z, false, 0, 1); } }, spawnFar, spawnBoss, doors, pauseGame, resumeGame, fireHeld, showScreen, get boss() { return boss; } };

  }
};
})();
