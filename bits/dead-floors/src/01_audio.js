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
