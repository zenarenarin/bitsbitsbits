// THE WIND KEEPS — a Plethora Bit about catching moments in a mechanical world.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Small shared helpers. Everything here is pure.
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOutBack = t => { const c = 1.6; t = clamp(t) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const easeOutCubic = t => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = t => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
// frame-rate independent exponential approach
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// cheap deterministic 1D value noise
function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const h = n => { let t = Math.imul((n + seed * 374761393) | 0, 668265263); t = Math.imul(t ^ (t >>> 13), 1274126177); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}
const fmtTime = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const todayKey = () => { const d = new Date(); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// ---- 01_audio.js ----
// The world makes its own music. Every mechanism has a voice; the Flow of the
// world decides how much those voices agree with one another. Low flow: sounds
// arrive when they arrive. High flow: they settle onto a shared pulse and the
// pad beneath them gains voices, so the machine starts to sound like a piece.
function createAudio(allowed) {
  const A = {
    ok: false, muted: false, volume: 0.9, flow: 0, bpm: 76, chord: 0,
    simNow: 0, // the game's clock, kept in step every frame
  };
  let ac = null, master, dry, wet, rev, comp, noiseBuf = null, windSrc = null, windF = null, windG = null;
  let pad = [], padF = null, padG = null, humO = null, humG = null, humF = null, waterSrc = null, waterG = null, waterF = null;
  let voices = 0;
  const BASE = 146.83; // D3
  const PENTA = [0, 2, 4, 7, 9];
  // chords as scale-step offsets over D major pentatonic: I, vi, IV(add9), V(sus)
  const CHORDS = [[0, 4, 7, 11, 14], [-3, 4, 9, 12, 16], [-7, 0, 5, 9, 14], [-5, 2, 7, 9, 14]];
  const semi = s => Math.pow(2, s / 12);
  A.note = (step, oct = 1) => { const o = Math.floor(step / 5); const d = ((step % 5) + 5) % 5; return BASE * Math.pow(2, oct + o) * semi(PENTA[d]); };
  A.chordFreq = (i, oct = 0) => { const c = CHORDS[A.chord % CHORDS.length]; return BASE * Math.pow(2, oct) * semi(c[i % c.length]); };

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = A.muted ? 0 : A.volume;
    comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ac.destination);
    dry = ac.createGain(); dry.connect(master);
    wet = ac.createGain(); wet.gain.value = 0.32;
    rev = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1); } }
    rev.buffer = ir; wet.connect(rev); rev.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    { const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.15 * w; d[i] = w * 0.35 + b * 0.65; } }
    // wind bed
    windSrc = ac.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windF = ac.createBiquadFilter(); windF.type = 'lowpass'; windF.frequency.value = 420; windF.Q.value = 0.6;
    windG = ac.createGain(); windG.gain.value = 0.0;
    windSrc.connect(windF); windF.connect(windG); windG.connect(dry); windG.connect(wet); windSrc.start();
    // water bed
    waterSrc = ac.createBufferSource(); waterSrc.buffer = noiseBuf; waterSrc.loop = true; waterSrc.playbackRate.value = 1.7;
    waterF = ac.createBiquadFilter(); waterF.type = 'bandpass'; waterF.frequency.value = 1800; waterF.Q.value = 0.9;
    waterG = ac.createGain(); waterG.gain.value = 0;
    waterSrc.connect(waterF); waterF.connect(waterG); waterG.connect(dry); waterSrc.start();
    // pad: five voices, each two slightly detuned oscillators, through a soft lowpass
    padF = ac.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 700; padF.Q.value = 0.4;
    padG = ac.createGain(); padG.gain.value = 0.0;
    padF.connect(padG); padG.connect(dry); padG.connect(wet);
    for (let i = 0; i < 5; i++) {
      const g = ac.createGain(); g.gain.value = 0; g.connect(padF);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'triangle'; o2.type = 'sawtooth';
      const f = A.chordFreq(i, 1); o1.frequency.value = f; o2.frequency.value = f * 1.004;
      const g2 = ac.createGain(); g2.gain.value = 0.18; o2.connect(g2); g2.connect(g); o1.connect(g);
      o1.start(); o2.start(); pad.push({ g, o1, o2 });
    }
    // lift / gear hum
    humO = ac.createOscillator(); humO.type = 'triangle'; humO.frequency.value = 110;
    humF = ac.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 500;
    humG = ac.createGain(); humG.gain.value = 0;
    humO.connect(humF); humF.connect(humG); humG.connect(dry); humO.start();
    return true;
  }

  A.unlock = () => {
    if (!allowed) return;
    try {
      if (!ac) A.ok = build();
      if (ac && ac.state !== 'running') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } ac = null; A.ok = false; };
  A.setMuted = m => { A.muted = m; if (ac) master.gain.setTargetAtTime(m ? 0 : A.volume, ac.currentTime, 0.08); };
  A.suspend = () => { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = () => { try { if (ac && ac.state !== 'running') ac.resume(); } catch (e) { } };
  const live = () => ac && A.ok && ac.state === 'running';

  // map a game-clock time to the audio clock
  const at = simT => Math.max(ac.currentTime, ac.currentTime + (simT - A.simNow));
  const beat = () => 60 / A.bpm;
  // Where should a musical event land? In flow, on the next eighth of the
  // world's pulse; out of flow, now, with a little human unevenness.
  A.musicalTime = (simT = A.simNow) => {
    const e = beat() / 2;
    const snap = A.flow > 0.35 && Math.random() < 0.35 + A.flow * 0.65;
    if (snap) { const g = Math.ceil((simT + 0.012) / e) * e; if (g - simT < e * 0.95) return g; }
    return simT + Math.random() * 0.03 * (1 - A.flow);
  };

  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function claim(dur) { if (voices > 28) return false; voices++; setTimeout(() => voices--, (dur + 0.2) * 1000); return true; }
  function noiseBurst(t, dur, type, freq, q, peak, a = 0.004, toWet = 0.2, rate = 1) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rate;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); env(g, t, a, peak, dur);
    s.connect(f); f.connect(g); g.connect(dry);
    if (toWet) { const w = ac.createGain(); w.gain.value = toWet; g.connect(w); w.connect(wet); }
    s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05);
    return { s, f, g };
  }
  function tone(t, freq, dur, peak, type = 'sine', a = 0.005, toWet = 0.35, glide = 0) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    const g = ac.createGain(); env(g, t, a, peak, dur);
    o.connect(g); g.connect(dry);
    if (toWet) { const w = ac.createGain(); w.gain.value = toWet; g.connect(w); w.connect(wet); }
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  // ---------- continuous beds ----------
  A.update = (dt, s) => {
    if (!live()) return;
    const t = ac.currentTime;
    windG.gain.setTargetAtTime(0.05 + s.wind * 0.22, t, 0.25);
    windF.frequency.setTargetAtTime(320 + s.wind * 1500, t, 0.3);
    waterG.gain.setTargetAtTime(s.water * 0.10, t, 0.4);
    waterF.frequency.setTargetAtTime(1300 + s.water * 1400, t, 0.4);
    // the pad: silent in stillness, a full gentle chord in the living machine
    const f = A.flow;
    padG.gain.setTargetAtTime(0.012 + f * 0.05 + (s.bloom || 0) * 0.03, t, 0.6);
    padF.frequency.setTargetAtTime(380 + f * 1300, t, 0.8);
    for (let i = 0; i < pad.length; i++) {
      const on = clamp(f * 5.2 - i * 0.9, 0, 1) * (i === 0 ? 1 : 0.8);
      pad[i].g.gain.setTargetAtTime(on * 0.16, t, 0.9);
    }
    humG.gain.setTargetAtTime(clamp(s.hum || 0) * 0.07, t, 0.12);
    humO.frequency.setTargetAtTime(90 + (s.humPitch || 0) * 140, t, 0.1);
  };
  A.setChord = i => {
    A.chord = i;
    if (!live()) return;
    const t = ac.currentTime;
    pad.forEach((v, k) => { const f = A.chordFreq(k, 1); v.o1.frequency.setTargetAtTime(f, t, 0.35); v.o2.frequency.setTargetAtTime(f * 1.004, t, 0.35); });
  };

  // ---------- events (simT = game time the sound belongs to) ----------
  // A gust is heard before it is seen to arrive: a swell that peaks at arrival.
  A.gust = (arriveT, lead, strength = 1, cross = false) => {
    if (!live() || !claim(lead + 1.6)) return;
    const t0 = at(arriveT - lead), t1 = at(arriveT);
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = cross ? 2.2 : 1.3;
    const lo = cross ? 160 : 260, hi = cross ? 520 : 1250;
    f.frequency.setValueAtTime(lo, t0); f.frequency.exponentialRampToValueAtTime(hi, t1); f.frequency.exponentialRampToValueAtTime(lo * 1.4, t1 + 1.2);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05 * strength, t0 + lead * 0.55);
    g.gain.exponentialRampToValueAtTime(0.2 * strength, t1);
    g.gain.exponentialRampToValueAtTime(0.0001, t1 + 1.3);
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    s.connect(f); f.connect(g);
    if (p) { p.pan.setValueAtTime(cross ? 0.8 : -0.8, t0); p.pan.linearRampToValueAtTime(0, t1); p.pan.linearRampToValueAtTime(cross ? -0.6 : 0.6, t1 + 1.2); g.connect(p); p.connect(dry); }
    else g.connect(dry);
    const w = ac.createGain(); w.gain.value = 0.25; g.connect(w); w.connect(wet);
    s.start(t0, Math.random()); s.stop(t1 + 1.4);
  };
  // sail fills with air
  A.catchFlow = (simT, q) => {
    if (!live() || !claim(1.6)) return;
    const t = at(simT);
    noiseBurst(t, 0.5, 'lowpass', 520, 0.8, 0.22 * q, 0.02, 0.15);
    tone(t, 62, 0.45, 0.22 * q, 'sine', 0.01, 0, 0.7);
    // the chord answers: a rising pluck of the current harmony
    const n = q > 0.9 ? 3 : 2, step = beat() / 4;
    for (let i = 0; i < n; i++) {
      const tt = at(A.flow > 0.35 ? Math.ceil(simT / step) * step + i * step : simT + i * 0.07);
      tone(tt, A.chordFreq(i + 1, 2), 0.9, 0.05 * q, 'triangle', 0.004, 0.5);
    }
  };
  A.luff = simT => { // sails open into still air
    if (!live() || !claim(0.7)) return;
    const t = at(simT);
    const n = noiseBurst(t, 0.42, 'bandpass', 900, 1.5, 0.09, 0.01, 0.1);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 17; lg.gain.value = 0.06;
    lfo.connect(lg); lg.connect(n.g.gain); lfo.start(t); lfo.stop(t + 0.5);
  };
  A.knock = (simT, pitch = 1, vol = 1) => { // dull wood
    if (!live() || !claim(0.4)) return;
    const t = at(simT);
    tone(t, 180 * pitch, 0.12, 0.13 * vol, 'sine', 0.002, 0.08, 0.6);
    noiseBurst(t, 0.05, 'bandpass', 1400 * pitch, 3, 0.07 * vol, 0.001, 0.05);
  };
  A.whooshPast = simT => {
    if (!live() || !claim(0.8)) return;
    const t = at(simT);
    const n = noiseBurst(t, 0.6, 'bandpass', 1100, 1.2, 0.07, 0.03, 0.2);
    n.f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
  };
  // blades, gears, ratchets: a creak whose pitch follows speed
  A.creak = (simT, speed, idx = 0) => {
    if (!live() || !claim(0.25)) return;
    const t = at(A.musicalTime(simT));
    const f = 700 + speed * 900 + (idx % 2) * 120;
    noiseBurst(t, 0.06, 'bandpass', f, 7, 0.06 + speed * 0.05, 0.002, 0.15);
    if (A.flow > 0.55 && idx % 2 === 0) tone(t, A.chordFreq(idx % 3, 1), 0.18, 0.025 * A.flow, 'sine', 0.003, 0.2);
  };
  A.thump = (simT, v = 1) => { if (!live() || !claim(0.4)) return; const t = at(A.musicalTime(simT)); tone(t, 58, 0.3, 0.16 * v, 'sine', 0.004, 0.05, 0.75); };
  A.chuff = (simT, v = 1) => { if (!live() || !claim(0.4)) return; const t = at(A.musicalTime(simT)); noiseBurst(t, 0.16, 'lowpass', 600, 0.7, 0.07 * v, 0.008, 0.1); tone(t, 98, 0.12, 0.05 * v, 'sine', 0.003, 0, 0.8); };
  A.drip = (simT, step) => {
    if (!live() || !claim(0.5)) return;
    const t = at(A.musicalTime(simT));
    const f = A.flow > 0.4 ? A.note(step, 2) : A.note(step, 2) * (1 + (Math.random() - 0.5) * 0.06);
    tone(t, f, 0.16, 0.05, 'sine', 0.002, 0.45, 1.35);
  };
  A.latch = (simT, q, step = 0) => {
    if (!live() || !claim(1.2)) return;
    const t = at(simT);
    noiseBurst(t, 0.05, 'highpass', 2400, 1, 0.12, 0.001, 0.1);
    tone(t, 140, 0.1, 0.14, 'square', 0.001, 0.05, 0.5);
    if (q > 0.5) tone(at(A.musicalTime(simT)), A.note(step + 2, 1), 0.7, 0.07 * q, 'triangle', 0.004, 0.5);
  };
  A.ratchet = (simT, v = 1) => { if (!live() || !claim(0.2)) return; noiseBurst(at(simT), 0.025, 'bandpass', 3200, 4, 0.05 * v, 0.001, 0.05); };
  A.tick = (simT, tock) => { if (!live() || !claim(0.3)) return; const t = at(simT); noiseBurst(t, 0.04, 'bandpass', tock ? 1500 : 2100, 9, 0.12, 0.001, 0.2); tone(t, tock ? 520 : 690, 0.05, 0.03, 'sine', 0.001, 0.1); };
  A.bell = (simT, step = 0, vol = 1) => {
    if (!live() || !claim(4.5)) return;
    const t = at(A.musicalTime(simT));
    const f = A.note(step, 1);
    const parts = [[0.5, 0.5, 3.5], [1, 1, 3.2], [2.0, 0.45, 2.2], [2.76, 0.32, 1.6], [5.4, 0.16, 0.8], [8.93, 0.07, 0.5]];
    for (const [r, a, d] of parts) tone(t, f * r, d, 0.09 * a * vol, 'sine', 0.003, 0.6);
  };
  A.chirp = (simT, n = 3) => {
    if (!live() || !claim(1)) return;
    for (let i = 0; i < n; i++) { const t = at(simT + i * 0.085); const f = A.note(5 + ((i * 2 + (Math.random() * 3) | 0) % 5), 2); tone(t, f, 0.07, 0.035, 'sine', 0.003, 0.3, 1.3); }
  };
  A.bloom = (simT, step = 0) => {
    if (!live() || !claim(3)) return;
    for (let i = 0; i < 5; i++) { const tt = at(A.musicalTime(simT) + i * beat() / 4); tone(tt, A.chordFreq(i, 2), 1.6, 0.045, 'triangle', 0.01, 0.6); }
  };
  A.splash = (simT, v = 1) => { if (!live() || !claim(0.6)) return; const t = at(simT); const n = noiseBurst(t, 0.35, 'bandpass', 2400, 0.8, 0.08 * v, 0.01, 0.25, 1.6); n.f.frequency.exponentialRampToValueAtTime(700, t + 0.35); };
  A.flutter = simT => { if (!live() || !claim(0.6)) return; const t = at(simT); for (let i = 0; i < 6; i++) noiseBurst(t + i * 0.045, 0.03, 'bandpass', 2600 + i * 90, 3, 0.05, 0.002, 0.05); };
  A.stillness = simT => { if (!live() || !claim(2.5)) return; const t = at(simT); tone(t, A.note(0, 0), 2.2, 0.05, 'sine', 0.2, 0.6, 0.94); };
  // A long chain: the whole chord arpeggiated on the pulse. The world sings.
  A.swell = (simT, size = 1) => {
    if (!live() || !claim(4)) return;
    const st = beat() / 4;
    const b = Math.ceil(simT / st) * st;
    const n = 5 + Math.min(4, size);
    for (let i = 0; i < n; i++) tone(at(b + i * st), A.chordFreq(i, 2 + Math.floor(i / 5)), 1.4, 0.04, 'triangle', 0.004, 0.55);
    tone(at(b), A.chordFreq(0, 0), 2.5, 0.06, 'sine', 0.05, 0.3);
  };
  A.ui = (simT, up = true) => { if (!live() || !claim(0.4)) return; tone(at(simT), A.note(up ? 7 : 4, 1), 0.18, 0.04, 'sine', 0.003, 0.4); };
  return A;
}

// ---- 02_paint.js ----
// Painterly materials, procedural textures and a geometry builder that bakes
// colour into vertices so a whole building can be drawn in one call.
function createPaint(THREE) {
  const P = {};
  // A soft three-band light ramp: shadow, mid, lit. Linear filtering keeps
  // the band edges soft, like a gouache wash rather than cel shading.
  {
    const n = 64, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const v = 0.58 + 0.17 * smooth((x - 0.18) / 0.16) + 0.25 * smooth((x - 0.55) / 0.18);
      const c = Math.round(v * 255); data.set([c, c, c, 255], i * 4);
    }
    P.ramp = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    P.ramp.minFilter = P.ramp.magFilter = THREE.LinearFilter; P.ramp.needsUpdate = true;
  }
  const NOISE_GLSL = `
    float twkH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float twkN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(twkH(i+vec3(0,0,0)),twkH(i+vec3(1,0,0)),f.x), mix(twkH(i+vec3(0,1,0)),twkH(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(twkH(i+vec3(0,0,1)),twkH(i+vec3(1,0,1)),f.x), mix(twkH(i+vec3(0,1,1)),twkH(i+vec3(1,1,1)),f.x),f.y), f.z); }`;
  // Toon material with world-space brush variation baked in.
  P.mat = (opts = {}) => {
    const m = new THREE.MeshToonMaterial(Object.assign({ color: 0xffffff, gradientMap: P.ramp, vertexColors: true }, opts.params || {}));
    const brush = opts.brush ?? 0.13, scale = opts.scale ?? 1.4;
    m.onBeforeCompile = sh => {
      sh.uniforms.uBrush = { value: brush };
      sh.uniforms.uEmissive = opts.emissiveU || { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTwkW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 twkWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            twkWp = instanceMatrix * twkWp;
          #endif
          vTwkW = (modelMatrix * twkWp).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTwkW;\nuniform float uBrush;\nuniform float uEmissive;\n' + NOISE_GLSL)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 wp = vTwkW * ${scale.toFixed(2)};
            float n1 = twkN(wp * vec3(1.0, 3.2, 1.0));
            float n2 = twkN(wp * 4.1 + 7.3);
            float b = (n1 * 0.65 + n2 * 0.35) - 0.5;
            diffuseColor.rgb *= 1.0 + b * uBrush * 2.0;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 1.0, 0.94), smoothstep(0.1, 0.5, b));
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uEmissive;');
    };
    m.customProgramCacheKey = () => 'twk' + brush + '_' + scale + (opts.emissiveU ? 'e' : '');
    return m;
  };
  // Ink outline: back faces pushed out along smoothed normals.
  P.ink = (color = 0x3d3633, width = 0.035) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 onormal;')
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position) + normalize(onormal) * ${width.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => 'ink' + width;
    return m;
  };
  // Smooth normals by position, used only by the outline.
  P.addOutlineNormals = geo => {
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const map = new Map(), acc = new Float32Array(n * 3), out = new Float32Array(n * 3);
    const key = i => Math.round(pos.getX(i) * 500) + ',' + Math.round(pos.getY(i) * 500) + ',' + Math.round(pos.getZ(i) * 500);
    for (let i = 0; i < n; i++) {
      const k = key(i); let e = map.get(k); if (!e) { e = [0, 0, 0]; map.set(k, e); }
      e[0] += nor.getX(i); e[1] += nor.getY(i); e[2] += nor.getZ(i);
    }
    for (let i = 0; i < n; i++) { const e = map.get(key(i)); const l = Math.hypot(e[0], e[1], e[2]) || 1; out[i * 3] = e[0] / l; out[i * 3 + 1] = e[1] / l; out[i * 3 + 2] = e[2] / l; }
    geo.setAttribute('onormal', new THREE.BufferAttribute(out, 3));
    return geo;
  };

  // ---------- builder ----------
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
  class Builder {
    constructor(seed = 1) { this.parts = []; this.rng = makeRng(seed); }
    // place: { p:[x,y,z], r:[x,y,z] (radians), s:[x,y,z]|number }, opts: { jitter, shade (bottom darkening), tint }
    add(geo, color, place = {}, opts = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      const s = place.s === undefined ? 1 : place.s;
      _s.set(...(Array.isArray(s) ? s : [s, s, s]));
      _e.set(...(place.r || [0, 0, 0]), place.order || 'XYZ'); _q.setFromEuler(_e);
      _p.set(...(place.p || [0, 0, 0]));
      _m.compose(_p, _q, _s);
      if (place.m) _m.premultiply(place.m);
      g.applyMatrix4(_m);
      const jit = opts.jitter || 0;
      if (jit) { const a = g.attributes.position; const cache = new Map(); for (let i = 0; i < a.count; i++) { const k = Math.round(a.getX(i) * 300) + ',' + Math.round(a.getY(i) * 300) + ',' + Math.round(a.getZ(i) * 300); let d = cache.get(k); if (!d) { d = [(this.rng() - 0.5) * jit, (this.rng() - 0.5) * jit, (this.rng() - 0.5) * jit]; cache.set(k, d); } a.setXYZ(i, a.getX(i) + d[0], a.getY(i) + d[1], a.getZ(i) + d[2]); } g.computeVertexNormals(); }
      const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
      _c.set(color);
      const v = opts.vary === undefined ? 0.05 : opts.vary;
      if (v) { const k = 1 + (this.rng() - 0.5) * v * 2; _c.multiplyScalar(k); _c.offsetHSL((this.rng() - 0.5) * v * 0.15, 0, 0); }
      let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const shade = opts.shade === undefined ? 0.18 : opts.shade;
      const top = opts.top ? _c2.set(opts.top) : null;
      for (let i = 0; i < n; i++) {
        const t = y1 > y0 ? (pos.getY(i) - y0) / (y1 - y0) : 1;
        const k = 1 - shade * (1 - smooth(t * 1.6));
        let r = _c.r * k, gg = _c.g * k, b = _c.b * k;
        if (top) { const w = smooth((t - 0.6) / 0.4) * (opts.topAmt ?? 0.7); r = lerp(r, top.r, w); gg = lerp(gg, top.g, w); b = lerp(b, top.b, w); }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      this.parts.push(g);
      return this;
    }
    build() {
      let n = 0; for (const g of this.parts) n += g.attributes.position.count;
      const P3 = new Float32Array(n * 3), N3 = new Float32Array(n * 3), C3 = new Float32Array(n * 3);
      let o = 0;
      for (const g of this.parts) { P3.set(g.attributes.position.array, o * 3); N3.set(g.attributes.normal.array, o * 3); C3.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P3, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N3, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C3, 3));
      geo.computeBoundingSphere();
      this.parts = [];
      return geo;
    }
    // finished mesh, optionally with an ink hull
    mesh(mat, ink, opts = {}) {
      const geo = this.build();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
      if (ink) { P.addOutlineNormals(geo); const o = new THREE.Mesh(geo, ink); o.castShadow = false; o.receiveShadow = false; o.renderOrder = -1; m.add(o); }
      return m;
    }
  }
  P.Builder = Builder;

  // ---------- shapes ----------
  P.gearGeo = (r, teeth, thick, opts = {}) => {
    const s = new THREE.Shape(), d = opts.depth ?? r * 0.14, n = teeth;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 0.22) / n) * TAU, a2 = ((i + 0.5) / n) * TAU, a3 = ((i + 0.72) / n) * TAU;
      const p = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr];
      if (i === 0) s.moveTo(...p(a0, r - d));
      s.lineTo(...p(a1, r - d)); s.lineTo(...p(a1 + 0.02, r)); s.lineTo(...p(a2 + 0.03, r)); s.lineTo(...p(a3, r - d)); s.lineTo(...p(((i + 1) / n) * TAU, r - d));
    }
    if (opts.hole) { const h = new THREE.Path(); h.absarc(0, 0, opts.hole, 0, TAU, true); s.holes.push(h); }
    if (opts.windows) {
      const k = opts.windows, ri = opts.hole || r * 0.18, ro = r - d - r * 0.12;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * TAU, w = (TAU / k) * 0.32, h = new THREE.Path();
        h.absarc(0, 0, ro, a - w, a + w, false); h.absarc(0, 0, ri + r * 0.1, a + w * 0.7, a - w * 0.7, true); h.closePath(); s.holes.push(h);
      }
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -thick / 2);
    return g;
  };
  // spoked wheel lying in the XY plane, axle along Z
  P.wheel = (b, color, place, r, spokes, thick, opts = {}) => {
    const m = new THREE.Matrix4(); _e.set(...(place.r || [0, 0, 0])); _q.setFromEuler(_e); m.compose(_v.set(...(place.p || [0, 0, 0])), _q, _s.set(1, 1, 1));
    b.add(new THREE.TorusGeometry(r, opts.rim || r * 0.06, 6, Math.max(16, spokes * 4)), color, { m }, opts);
    for (let i = 0; i < Math.ceil(spokes / 2); i++) { const a = (i / spokes) * TAU; b.add(new THREE.BoxGeometry(r * 2 * 0.96, opts.spoke || r * 0.05, thick * 0.6), color, { r: [0, 0, a], m }, Object.assign({ vary: 0.08 }, opts)); }
    b.add(new THREE.CylinderGeometry(opts.hub || r * 0.14, opts.hub || r * 0.14, thick * 1.4, 10), opts.hubColor || color, { r: [Math.PI / 2, 0, 0], m }, opts);
    return b;
  };
  P.tube = (pts, r, seg = 24, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, rs, false);
  // A lumpy foliage blob: displaced icosahedron, flattened underneath.
  P.blob = (r, seed = 1, detail = 1, flat = 0.55) => {
    const g = new THREE.IcosahedronGeometry(r, detail), a = g.attributes.position, rng = makeRng(seed);
    const k = []; for (let i = 0; i < 6; i++) k.push([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(0.08, 0.2)]);
    for (let i = 0; i < a.count; i++) {
      _v.set(a.getX(i), a.getY(i), a.getZ(i)); const l = _v.length(); _n.copy(_v).normalize();
      let d = 1; for (const q of k) d += q[3] * Math.max(0, _n.x * q[0] + _n.y * q[1] + _n.z * q[2]);
      _v.setLength(l * d * 0.92); if (_v.y < -r * flat) _v.y = lerp(_v.y, -r * flat, 0.8);
      a.setXYZ(i, _v.x, _v.y, _v.z);
    }
    g.computeVertexNormals();
    return g;
  };
  // tapered irregular stone/plaster column of n sides
  P.tower = (rb, rt, h, sides = 8, seed = 2) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, sides, 4, false), a = g.attributes.position, rng = makeRng(seed);
    for (let i = 0; i < a.count; i++) { const y = a.getY(i); const w = 1 + noise1(y * 1.7 + seed, seed) * 0.025; a.setX(i, a.getX(i) * w + (rng() - 0.5) * 0.02); a.setZ(i, a.getZ(i) * w); }
    g.computeVertexNormals(); return g;
  };

  // ---------- canvas textures ----------
  P.canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; };
  // painted cumulus with a flat, shaded underside
  P.cloudTex = seed => P.canvas(512, 192, (g, w, h) => {
    const r = makeRng(seed * 13 + 1);
    const base = h * 0.74, puffs = [];
    const n = 9 + (r() * 6 | 0);
    for (let i = 0; i < n; i++) { const u = i / (n - 1); const x = w * (0.08 + 0.84 * u) + r.range(-14, 14); const rr = r.range(16, 30) * (1.15 - Math.pow(Math.abs(u - 0.45) * 1.8, 1.6) * 0.7); puffs.push([x, base - rr * r.range(0.35, 0.9), rr]); }
    for (let i = 0; i < 5; i++) { const x = w * r.range(0.25, 0.65); const rr = r.range(26, 44); puffs.push([x, base - rr * r.range(0.9, 1.4), rr]); }
    g.save(); g.beginPath(); g.rect(0, 0, w, base + 2); g.clip();
    // shadowed underside first, then lit tops offset toward the sun
    for (const [x, y, rr] of puffs) { g.fillStyle = 'rgba(206,219,231,1)'; g.beginPath(); g.ellipse(x, y + rr * 0.15, rr * 1.15, rr, 0, 0, TAU); g.fill(); }
    for (const [x, y, rr] of puffs) { const gr = g.createRadialGradient(x - rr * 0.45, y - rr * 0.55, rr * 0.05, x - rr * 0.1, y - rr * 0.1, rr * 1.1); gr.addColorStop(0, 'rgba(255,255,251,1)'); gr.addColorStop(0.55, 'rgba(250,250,248,0.95)'); gr.addColorStop(1, 'rgba(232,238,244,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x - rr * 0.08, y - rr * 0.12, rr * 1.05, rr * 0.92, 0, 0, TAU); g.fill(); }
    g.restore();
    // a soft flat base and a few brush flecks
    const bg = g.createLinearGradient(0, base - 10, 0, base + 3); bg.addColorStop(0, 'rgba(214,226,236,0)'); bg.addColorStop(1, 'rgba(206,220,233,0.95)');
    g.fillStyle = bg; g.fillRect(w * 0.1, base - 10, w * 0.8, 13);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(0,0,0,' + r.range(0.05, 0.25) + ')'; g.fillRect(r.range(0, w), r.range(0, h), r.range(4, 16), 1.5); }
    g.globalCompositeOperation = 'source-over';
  });
  // a distant silhouette layer: hills, spires, towers. Drawn once.
  P.ridgeTex = (seed, kind) => P.canvas(1024, 256, (g, w, h) => {
    const r = makeRng(seed);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, h);
    if (kind === 'hills') { for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.55 - (noise1(x / 160, seed) * 0.5 + 0.5) * h * 0.35 - noise1(x / 41, seed + 3) * h * 0.04); }
    else if (kind === 'spires') {
      let x = 0; g.lineTo(0, h * 0.8);
      while (x < w) { const sw = r.range(40, 120), sh = r.range(0.25, 0.8); const xm = x + sw / 2; g.lineTo(x + sw * 0.15, h * (1 - sh * 0.5)); g.quadraticCurveTo(xm - sw * 0.3, h * (1 - sh), xm, h * (1 - sh) + 4); g.quadraticCurveTo(xm + sw * 0.3, h * (1 - sh), x + sw * 0.85, h * (1 - sh * 0.5)); g.lineTo(x + sw, h * 0.8); x += sw + r.range(20, 140); }
      g.lineTo(w, h * 0.8);
    } else { // town: roofs, a far windmill, a tower
      for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.78 - noise1(x / 200, seed) * h * 0.06);
      g.lineTo(w, h); g.closePath(); g.fill(); g.beginPath();
      let x = 30;
      while (x < w - 40) {
        const bw = r.range(20, 46), bh = r.range(22, 60), y = h * 0.78 - noise1(x / 200, seed) * h * 0.06;
        g.moveTo(x, y); g.lineTo(x, y - bh); g.lineTo(x + bw / 2, y - bh - bw * 0.45); g.lineTo(x + bw, y - bh); g.lineTo(x + bw, y); g.closePath();
        if (r() < 0.18) { g.rect(x + bw * 0.3, y - bh - bw * 1.6, bw * 0.4, bw * 1.2); }
        x += bw + r.range(4, 70);
      }
    }
    g.lineTo(w, h); g.closePath(); g.fill();
  });
  // soft round glow for tiny lights and motes
  P.dotTex = P.canvas(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  return P;
}

// ---- 03_env.js ----
// The shared landscape kit: sky, ground, grass that answers the wind, clouds,
// silhouette layers, gust ribbons, leaves, birds and chimney smoke.
function createEnv(THREE, P) {
  const E = {};
  // One wind uniform block shared by grass and foliage. Up to four gust fronts:
  // (frontX, strength, direction, width).
  E.windU = { uTime: { value: 0 }, uG: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uBase: { value: 0.25 } };
  const WIND_GLSL = `
    uniform float uTime; uniform vec4 uG[4]; uniform float uBase;
    float twkWind(vec3 w){
      float s = uBase * (0.6 + 0.4 * sin(uTime * 1.3 + w.x * 0.35 + w.z * 0.2)) * (0.7 + 0.3 * sin(uTime * 0.7 + w.x * 0.11));
      for (int i = 0; i < 4; i++) {
        vec4 g = uG[i];
        if (g.y > 0.001) { float d = (w.x - g.x) * g.z; s += g.z * g.y * exp(-d * d / (g.w * g.w)) * (d < 0.0 ? 1.0 : 0.35); }
      }
      return s;
    }`;
  E.WIND_GLSL = WIND_GLSL;

  E.sky = (c) => {
    const u = { top: { value: new THREE.Color(c.top) }, mid: { value: new THREE.Color(c.mid) }, hor: { value: new THREE.Color(c.horizon) }, sunDir: { value: new THREE.Vector3(...c.sunDir).normalize() }, sunCol: { value: new THREE.Color(c.sun) } };
    const m = new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, hor, sunCol; uniform vec3 sunDir; varying vec3 vD;
        void main(){ float h = vD.y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
          gl_FragColor = vec4(c, 1.0); }`
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
    mesh.frustumCulled = false; mesh.renderOrder = -10;
    mesh.userData.u = u;
    return mesh;
  };

  // Ground: a gently rolling painted field. heightAt() is used to seat things.
  E.ground = (o) => {
    const size = o.size || 160, seg = o.seg || 90;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const a = g.attributes.position, col = new Float32Array(a.count * 3), c = new THREE.Color(), c1 = new THREE.Color(o.grass), c2 = new THREE.Color(o.grass2), c3 = new THREE.Color(o.dry), cp = new THREE.Color(o.path || o.dry);
    const height = (x, z) => {
      const far = smooth((Math.hypot(x, z) - (o.flat || 12)) / 40);
      return (noise1(x * 0.05 + 3.1, 4) * 0.5 + noise1(z * 0.06 + 1.7, 5) * 0.5) * 2.2 * far + far * far * (o.rise || 6) * smooth((-z - 10) / 50) + (o.height ? o.height(x, z) : 0);
    };
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), z = a.getZ(i), y = height(x, z);
      a.setY(i, y);
      const n = noise1(x * 0.21 + z * 0.13, 7) * 0.5 + noise1(x * 0.07 - z * 0.11, 9) * 0.5;
      c.copy(c1).lerp(c2, smooth(n + 0.5)).lerp(c3, smooth((n - 0.2) * 3) * 0.5);
      if (o.pathAt) { const p = o.pathAt(x, z); if (p > 0) c.lerp(cp, p); }
      if (o.tint) o.tint(x, z, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, P.mat({ brush: 0.1, scale: 0.9 }));
    mesh.receiveShadow = true;
    mesh.userData.heightAt = height;
    return mesh;
  };

  // Grass: instanced blades bending under the shared wind field.
  E.grass = (o) => {
    const blade = new THREE.BufferGeometry();
    const w = 0.07, h = 1;
    blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, 0, 0, h, 0]), 3));
    blade.setAttribute('ty', new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 0.5, 1]), 1));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    const n = o.count || 2600, rng = makeRng(o.seed || 11);
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { cRoot: { value: new THREE.Color(o.root) }, cTip: { value: new THREE.Color(o.tip) }, cTip2: { value: new THREE.Color(o.tip2 || o.tip) } }]),
      fog: true, side: THREE.DoubleSide,
      vertexShader: `attribute float ty; varying float vT; varying float vV; ${WIND_GLSL}
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 base = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          float s = twkWind(base);
          float k = ty * ty;
          wp.x += s * k * 0.9; wp.y -= abs(s) * k * 0.35;
          wp.z += sin(uTime * 2.1 + base.x * 1.7) * 0.04 * k;
          vT = ty; vV = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 cRoot, cTip, cTip2; varying float vT; varying float vV;
        #include <fog_pars_fragment>
        void main(){ vec3 tip = mix(cTip, cTip2, vV); vec3 c = mix(cRoot, tip, smoothstep(0.0, 1.0, vT)); gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`
    });
    m.uniforms.uTime = E.windU.uTime; m.uniforms.uG = E.windU.uG; m.uniforms.uBase = E.windU.uBase;
    const mesh = new THREE.InstancedMesh(blade, m, n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let tries = 0; k < n && tries < n * 6; tries++) {
      const x = rng.range(o.x0, o.x1), z = rng.range(o.z0, o.z1);
      if (o.accept && !o.accept(x, z, rng)) continue;
      const y = o.heightAt ? o.heightAt(x, z) : 0;
      Q.setFromAxisAngle(up, rng() * TAU);
      const hh = rng.range(0.35, 0.8) * (o.scale || 1);
      S.set(rng.range(0.8, 1.4), hh, 1); Pp.set(x, y - 0.02, z);
      M.compose(Pp, Q, S); mesh.setMatrixAt(k++, M);
    }
    mesh.count = k;
    mesh.frustumCulled = false;
    return mesh;
  };

  // Wildflowers: tiny instanced heads scattered in the meadow, swaying with the grass.
  E.wildflowers = (o) => {
    const geo = new THREE.IcosahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ fog: true });
    const n = o.count || 500, mesh = new THREE.InstancedMesh(geo, mat, n), rng = makeRng(o.seed || 3);
    const M = new THREE.Matrix4(), c = new THREE.Color(), cols = o.colors || [0xf6efd8, 0xf2c25a, 0xe58a72, 0xf6efd8, 0xd8cbe8];
    let k = 0;
    for (let tries = 0; k < n && tries < n * 8; tries++) {
      const x = rng.range(o.x0, o.x1), z = rng.range(o.z0, o.z1);
      if (o.accept && !o.accept(x, z, rng)) continue;
      const s = rng.range(0.7, 1.4);
      M.makeScale(s, s * 0.7, s).setPosition(x, (o.heightAt ? o.heightAt(x, z) : 0) + rng.range(0.15, 0.35), z);
      mesh.setMatrixAt(k, M); c.set(rng.pick(cols)); mesh.setColorAt(k, c); k++;
    }
    mesh.count = k;
    return mesh;
  };

  // Foliage material: painterly toon plus a vertex sway in the same wind.
  E.foliageMat = () => {
    const m = P.mat({ brush: 0.18, scale: 2.2 });
    const base = m.onBeforeCompile;
    m.onBeforeCompile = sh => {
      base(sh);
      sh.uniforms.uTime = E.windU.uTime; sh.uniforms.uG = E.windU.uG; sh.uniforms.uBase = E.windU.uBase;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { vec3 w = (modelMatrix * vec4(transformed, 1.0)).xyz; float s = twkWind(w); float k = clamp((w.y - 0.6) / 5.0, 0.0, 1.0);
            transformed.x += s * k * 0.22 + sin(uTime * 1.7 + w.y * 1.3 + w.x) * 0.03 * k; transformed.z += cos(uTime * 1.3 + w.x * 0.8) * 0.02 * k; }`);
    };
    m.customProgramCacheKey = () => 'foliage';
    return m;
  };
  // A tree: trunk into builder `tb`, foliage blobs into builder `fb`.
  E.tree = (tb, fb, x, y, z, s = 1, seed = 1, cols = {}) => {
    const r = makeRng(seed);
    const lean = r.range(-0.12, 0.12);
    tb.add(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, 2.6 * s, 6), cols.trunk || 0x7a5a44, { p: [x, y + 1.3 * s, z], r: [0, 0, lean] }, { shade: 0.3 });
    const n = 3 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = r.range(0.2, 0.75) * s;
      const c = r.pick(cols.leaves || [0x8a9a5b, 0x7d9152, 0x9aa865, 0x6f8a55]);
      fb.add(P.blob(r.range(0.75, 1.15) * s, seed * 7 + i), c, { p: [x + Math.cos(a) * d - lean * 2.5 * s, y + 2.6 * s + r.range(-0.2, 0.7) * s, z + Math.sin(a) * d * 0.7] }, { shade: 0.35, top: cols.top || 0xc9c77a, topAmt: 0.45 });
    }
  };

  E.clouds = (o) => {
    const g = new THREE.Group(), list = [], rng = makeRng(o.seed || 5);
    const texs = [P.cloudTex(1), P.cloudTex(2), P.cloudTex(3), P.cloudTex(4)];
    for (let i = 0; i < (o.count || 9); i++) {
      const m = new THREE.SpriteMaterial({ map: texs[i % 4], transparent: true, depthWrite: false, fog: false, color: o.tint || 0xffffff, opacity: rng.range(0.85, 1) });
      const s = new THREE.Sprite(m);
      const d = rng.range(70, 170), sc = rng.range(22, 44) * d / 110;
      s.scale.set(sc, sc * 0.375, 1);
      s.position.set(rng.range(-55, 55) * d / 110, rng.range(o.y0 || 22, o.y1 || 60) * d / 110, -d);
      s.userData.v = rng.range(0.25, 0.6);
      g.add(s); list.push(s);
    }
    g.userData.update = (dt, boost = 0) => { for (const s of list) { s.position.x += s.userData.v * (1 + boost * 2) * dt; if (s.position.x > -s.position.z * 0.6) s.position.x = s.position.z * 0.6; } };
    return g;
  };

  // flat painted silhouettes, tinted toward the sky by distance
  E.layers = (defs) => {
    const g = new THREE.Group();
    for (const d of defs) {
      const tex = P.ridgeTex(d.seed, d.kind);
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: d.color, fog: false, depthWrite: false, alphaTest: 0.02 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.w / 4), m);
      mesh.position.set(d.x || 0, d.y, d.z); mesh.renderOrder = -5 + (d.order || 0);
      g.add(mesh);
    }
    return g;
  };

  // Gust ribbons: a few pale strips that trace the gust's path near its front.
  E.ribbons = (scene) => {
    const R = { list: [] };
    const SEG = 34;
    function make(color, width) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(SEG * 2 * 3), al = new Float32Array(SEG * 2);
      const sd = new Float32Array(SEG * 2);
      for (let i = 0; i < SEG; i++) { al[i * 2] = al[i * 2 + 1] = i / (SEG - 1); sd[i * 2] = 0; sd[i * 2 + 1] = 1; }
      const idx = []; for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('al', new THREE.BufferAttribute(al, 1)); geo.setAttribute('side', new THREE.BufferAttribute(sd, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { col: { value: new THREE.Color(color) }, op: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'attribute float al; attribute float side; varying float vA; varying float vS; void main(){ vA = al; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 col; uniform float op; varying float vA; varying float vS; void main(){ float a = smoothstep(0.0, 0.7, vA) * (1.0 - smoothstep(0.95, 1.0, vA)); float core = 1.0 - abs(vS * 2.0 - 1.0); vec3 c = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.55, 1.0, core) * 0.7); gl_FragColor = vec4(c, a * op * (0.35 + 0.65 * smoothstep(0.0, 0.6, core))); }'
      });
      const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.visible = false;
      scene.add(mesh);
      return { mesh, pos, width, busy: false };
    }
    const pool = [];
    for (let i = 0; i < 12; i++) pool.push(make(0xffffff, 0.1));
    // gust: { curve, t0, t1, cross, alive }
    R.spawn = (gust, count = 3, color = 0xfff1c9) => {
      gust.ribbons = [];
      for (let i = 0; i < count; i++) {
        const r = pool.find(p => !p.busy); if (!r) break;
        r.busy = true; r.mesh.visible = true; r.mesh.material.uniforms.col.value.set(color);
        r.off = [(i - (count - 1) / 2) * 0.7 + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8]; r.ph = Math.random() * 6; r.width = (i === Math.floor(count / 2) ? 0.2 : 0.11) + Math.random() * 0.06; r.len = 0.2 + Math.random() * 0.1;
        gust.ribbons.push(r);
      }
    };
    const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    // s: progress of the gust front along its curve, may exceed 1 (passing on)
    R.draw = (gust, s, fade, time) => {
      for (const r of gust.ribbons || []) {
        const op = clamp(fade) * 0.95;
        r.mesh.material.uniforms.op.value = op;
        for (let i = 0; i < SEG; i++) {
          const u = s - r.len * (1 - i / (SEG - 1)) * (1 + 0.3 * Math.sin(time + r.ph));
          const uc = clamp(u, 0, 1);
          gust.curve.getPointAt(uc, _p); gust.curve.getTangentAt(uc, _t);
          if (u > 1) _p.addScaledVector(_t, (u - 1) * gust.curve.getLength());
          _side.crossVectors(_t, _up).normalize();
          const wob = Math.sin(u * 22 + time * 3 + r.ph) * 0.18;
          _p.addScaledVector(_side, r.off[1] + wob * 0.5); _p.y += r.off[0] + wob;
          const wdt = r.width * Math.sin(Math.PI * clamp(i / (SEG - 1))) + 0.006;
          r.pos[i * 6] = _p.x; r.pos[i * 6 + 1] = _p.y + wdt; r.pos[i * 6 + 2] = _p.z;
          r.pos[i * 6 + 3] = _p.x; r.pos[i * 6 + 4] = _p.y - wdt; r.pos[i * 6 + 5] = _p.z;
        }
        r.mesh.geometry.attributes.position.needsUpdate = true;
      }
    };
    R.release = gust => { for (const r of gust.ribbons || []) { r.busy = false; r.mesh.visible = false; } gust.ribbons = []; };
    R.clear = () => { for (const r of pool) { r.busy = false; r.mesh.visible = false; } };
    return R;
  };

  // Leaves: small spinning quads, carried by gusts, settling afterwards.
  E.leaves = (scene, n = 70) => {
    const geo = new THREE.PlaneGeometry(0.26, 0.16);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const L = [], c = new THREE.Color(), cols = [0xc9b458, 0x9aa865, 0xd8a24a, 0x8a9a5b, 0xe0c27a];
    for (let i = 0; i < n; i++) { L.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }); c.set(cols[i % cols.length]); mesh.setColorAt(i, c); }
    mesh.frustumCulled = false; scene.add(mesh);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 0);
    const api = {
      mesh,
      emit(p, v, count = 1, spread = 0.6) {
        for (let k = 0; k < count; k++) {
          const l = L.find(q => !q.on); if (!l) return;
          l.on = true; l.life = 0; l.p.set(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread);
          l.v.set(v.x * (0.7 + Math.random() * 0.6), v.y + (Math.random() - 0.3) * 1.2, v.z + (Math.random() - 0.5) * 1.2);
          l.w.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4); l.r.set(Math.random() * 6, Math.random() * 6, 0);
        }
      },
      // swirl around a point (a caught gust)
      swirl(center, strength) { for (const l of L) if (l.on) { const dx = l.p.x - center.x, dy = l.p.y - center.y; const d2 = dx * dx + dy * dy; if (d2 < 30) { l.v.x += -dy * strength; l.v.y += dx * strength; } } },
      update(dt, windX) {
        for (let i = 0; i < n; i++) {
          const l = L[i];
          if (!l.on) { M.compose(Z, Q.identity(), Z); mesh.setMatrixAt(i, M); continue; }
          l.life += dt;
          l.v.y -= 1.1 * dt; l.v.x = damp(l.v.x, windX, 0.6, dt); l.v.z = damp(l.v.z, 0, 0.8, dt); l.v.y = Math.max(l.v.y, -1.4);
          l.p.addScaledVector(l.v, dt);
          l.r.x += l.w.x * dt; l.r.y += l.w.y * dt; l.r.z += l.w.z * dt;
          if (l.p.y < 0.03) { l.p.y = 0.03; l.v.multiplyScalar(0.5); l.w.multiplyScalar(0.9); }
          if (l.life > 7 || Math.abs(l.p.x) > 30) l.on = false;
          const fade = l.life > 6 ? 1 - (l.life - 6) : 1;
          Q.setFromEuler(l.r); S.setScalar(fade); M.compose(l.p, Q, S); mesh.setMatrixAt(i, M);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
      clear() { for (const l of L) l.on = false; }
    };
    return api;
  };

  // Birds: perch on things, take off when startled, circle, come back.
  E.birds = (scene, perches, color = 0x4b4f5c) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true });
    const body = new THREE.SphereGeometry(0.07, 6, 4); body.scale(1.6, 0.8, 0.9);
    const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.04, 0, 0, 0.05, 0.22, 0.02, 0.0]), 3)); wing.computeVertexNormals();
    const B = [];
    perches.forEach((p, i) => {
      const g = new THREE.Group(); const b = new THREE.Mesh(body, mat); g.add(b);
      const wl = new THREE.Mesh(wing, mat), wr = new THREE.Mesh(wing, mat); wr.scale.x = -1; g.add(wl, wr);
      g.position.set(...p); scene.add(g);
      B.push({ g, wl, wr, home: new THREE.Vector3(...p), st: 'perch', t: Math.random() * 5, ph: Math.random() * 6, c: new THREE.Vector3(), r: 0, h: 0, dir: i % 2 ? 1 : -1, hop: 0 });
    });
    const api = {
      list: B,
      startle(center, radius = 99) {
        for (const b of B) if (b.st === 'perch' && b.g.position.distanceTo(center) < radius) { b.st = 'up'; b.t = 0; b.c.set(b.home.x + b.dir * 2.5, b.home.y + 4 + Math.random() * 3, b.home.z - 2); b.r = 3 + Math.random() * 3; b.h = b.c.y; }
      },
      update(dt, time) {
        for (const b of B) {
          b.t += dt;
          if (b.st === 'perch') {
            b.g.position.lerp(b.home, 0.2);
            const peck = Math.sin(time * 1.3 + b.ph * 3) > 0.92 ? 0.25 : 0;
            b.g.rotation.set(peck, b.dir > 0 ? 0 : Math.PI, 0);
            b.wl.rotation.z = b.wr.rotation.z = 0.12;
          } else {
            const flap = Math.sin(time * 18 + b.ph) * 0.9;
            b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
            const a = b.ph + b.t * 0.7 * b.dir;
            const target = new THREE.Vector3(b.c.x + Math.cos(a) * b.r, b.h + Math.sin(b.t * 1.3) * 0.5, b.c.z + Math.sin(a) * b.r * 0.5);
            if (b.st === 'up' && b.t > 7 + b.ph) b.st = 'home';
            if (b.st === 'home') { target.copy(b.home); if (b.g.position.distanceTo(b.home) < 0.08) { b.st = 'perch'; b.t = 0; } }
            const prev = b.g.position.clone();
            b.g.position.lerp(target, 1 - Math.exp(-(b.st === 'home' ? 1.6 : 1.1) * dt));
            const d = b.g.position.clone().sub(prev);
            if (d.lengthSq() > 1e-8) b.g.rotation.set(0, Math.atan2(-d.z, d.x), 0);
          }
        }
      }
    };
    return api;
  };

  // soft puffs drifting from a chimney or a vent
  E.smoke = (scene, P, origin, opts = {}) => {
    const mat = new THREE.SpriteMaterial({ map: P.dotTex, color: opts.color || 0xeeeae2, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    const S = [];
    for (let i = 0; i < (opts.count || 7); i++) { const s = new THREE.Sprite(mat.clone()); s.userData.t = i / (opts.count || 7); scene.add(s); S.push(s); }
    return { update(dt, wind = 0.3) { for (const s of S) { s.userData.t += dt / (opts.life || 5); if (s.userData.t > 1) s.userData.t -= 1; const t = s.userData.t; s.position.set(origin[0] + t * (1 + wind * 4), origin[1] + t * 3.2, origin[2]); const sc = 0.4 + t * 1.6; s.scale.set(sc, sc, 1); s.material.opacity = 0.45 * Math.sin(Math.PI * t); } } };
  };
  return E;
}

// ---- 04_parts.js ----
// Shared little people, creatures and props.
function createParts(THREE, P) {
  const X = {};
  const mat = P.mat({ brush: 0.06, scale: 6 });
  X.mat = mat;
  const mk = (geo, color, pos, parent, rot) => {
    const b = new P.Builder(color * 7 + 1); b.add(geo, color, { p: [0, 0, 0] }, { vary: 0, shade: 0.12 });
    const m = new THREE.Mesh(b.build(), mat); m.castShadow = false; if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); if (parent) parent.add(m); return m;
  };
  X.mk = mk;

  // The caretaker: a tiny figure in a slate coat and a straw hat.
  X.caretaker = (cols = {}) => {
    const g = new THREE.Group();
    const coat = cols.coat || 0x4f6478, skin = 0xe9c4a2, hatC = cols.hat || 0xe2c06e, trouser = 0x6b5546;
    const hips = new THREE.Group(); hips.position.y = 0.24; g.add(hips);
    const legL = mk(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6), trouser, [-0.045, -0.11, 0], hips);
    const legR = mk(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6), trouser, [0.045, -0.11, 0], hips);
    const torso = new THREE.Group(); hips.add(torso);
    mk(new THREE.CylinderGeometry(0.075, 0.1, 0.22, 8), coat, [0, 0.1, 0], torso);
    mk(new THREE.CylinderGeometry(0.11, 0.115, 0.07, 8), coat, [0, -0.02, 0], torso); // coat skirt
    const head = new THREE.Group(); head.position.y = 0.27; torso.add(head);
    mk(new THREE.SphereGeometry(0.065, 10, 8), skin, [0, 0, 0], head);
    mk(new THREE.SphereGeometry(0.02, 6, 4), 0xd9a98a, [0, -0.005, 0.064], head); // nose
    const hat = new THREE.Group(); hat.position.y = 0.045; head.add(hat);
    mk(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14), hatC, [0, 0, 0], hat);
    mk(new THREE.CylinderGeometry(0.05, 0.065, 0.06, 10), hatC, [0, 0.035, 0], hat);
    mk(new THREE.CylinderGeometry(0.066, 0.066, 0.015, 10), 0xd96f5c, [0, 0.012, 0], hat); // coral band
    const arm = (s) => { const a = new THREE.Group(); a.position.set(s * 0.09, 0.19, 0); torso.add(a); mk(new THREE.CapsuleGeometry(0.028, 0.15, 2, 6), coat, [0, -0.09, 0], a); mk(new THREE.SphereGeometry(0.026, 6, 4), skin, [0, -0.19, 0], a); return a; };
    const armL = arm(-1), armR = arm(1);
    const C = { group: g, hips, torso, head, hat, armL, armR, legL, legR, t: 0, pull: 0, look: 0, sit: 0, cheer: 0, hatOff: 0, walk: 0 };
    // pose blends; called every frame
    C.update = (dt) => {
      C.t += dt;
      const br = Math.sin(C.t * 2.1) * 0.012;
      torso.position.y = br - C.sit * 0.08;
      hips.position.y = 0.24 - C.sit * 0.12;
      legL.rotation.x = -C.sit * 1.3 + Math.sin(C.walk) * 0.6; legR.rotation.x = -C.sit * 1.3 - Math.sin(C.walk) * 0.6;
      // pulling the lever: lean back, both arms forward and down
      torso.rotation.x = -C.pull * 0.25 + C.sit * 0.15;
      armL.rotation.x = -1.1 * C.pull - C.cheer * 2.6 + Math.sin(C.walk) * 0.4; armR.rotation.x = -1.1 * C.pull - C.cheer * 2.4 - Math.sin(C.walk) * 0.4;
      armL.rotation.z = -0.15 - C.cheer * 0.3; armR.rotation.z = 0.15 + C.cheer * 0.3;
      head.rotation.y = C.look; head.rotation.x = -C.cheer * 0.3 - C.sit * 0.1;
      hat.visible = C.hatOff < 0.5;
    };
    return C;
  };

  // The lantern-bearer: a round, mossy creature that carries seeds of light.
  X.creature = () => {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    mk(new THREE.SphereGeometry(0.15, 14, 10), 0xf3ead6, [0, 0.17, 0], body).scale.set(1, 0.92, 0.95);
    const moss = mk(P.blob(0.1, 4, 1, 0.2), 0x7f9a52, [0, 0.27, -0.04], body); moss.scale.set(1.2, 0.6, 1.1);
    mk(new THREE.SphereGeometry(0.018, 6, 4), 0x2f2a2a, [-0.05, 0.2, 0.135], body);
    mk(new THREE.SphereGeometry(0.018, 6, 4), 0x2f2a2a, [0.05, 0.2, 0.135], body);
    mk(new THREE.SphereGeometry(0.022, 6, 4), 0xeaa38f, [0, 0.165, 0.15], body); // snout
    const earL = mk(new THREE.ConeGeometry(0.035, 0.12, 6), 0xf3ead6, [-0.08, 0.3, 0.02], body, [0, 0, 0.5]);
    const earR = mk(new THREE.ConeGeometry(0.035, 0.12, 6), 0xf3ead6, [0.08, 0.3, 0.02], body, [0, 0, -0.5]);
    const footL = mk(new THREE.SphereGeometry(0.04, 6, 4), 0xc9b79a, [-0.06, 0.03, 0.03], g);
    const footR = mk(new THREE.SphereGeometry(0.04, 6, 4), 0xc9b79a, [0.06, 0.03, 0.03], g);
    // the seed: a little golden lantern on a stalk
    const stalk = new THREE.Group(); stalk.position.set(0.11, 0.24, 0.05); body.add(stalk);
    mk(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 4), 0x6d5a3e, [0, 0.1, 0], stalk);
    const seedU = { value: 0.9 };
    const seedMat = P.mat({ brush: 0.02, scale: 4, emissiveU: seedU });
    const sb = new P.Builder(5); sb.add(new THREE.SphereGeometry(0.045, 10, 8), 0xf2c25a, {}, { vary: 0, shade: 0 });
    const seed = new THREE.Mesh(sb.build(), seedMat); seed.position.y = 0.22; stalk.add(seed);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd98a, transparent: true, depthWrite: false, opacity: 0.55 }));
    glow.scale.set(0.35, 0.35, 1); seed.add(glow);
    const C = { group: g, body, seed, stalk, glow, footL, footR, earL, earR, t: 0, walk: 0, hop: 0, hasSeed: true, look: 0 };
    C.update = (dt, moving) => {
      C.t += dt;
      if (moving) C.walk += dt * 11;
      const step = moving ? Math.abs(Math.sin(C.walk)) * 0.05 : 0;
      body.position.y = step + Math.sin(C.t * 2.6) * 0.008 + C.hop;
      footL.position.z = 0.03 + (moving ? Math.sin(C.walk) * 0.05 : 0); footR.position.z = 0.03 - (moving ? Math.sin(C.walk) * 0.05 : 0);
      body.rotation.z = moving ? Math.sin(C.walk) * 0.08 : Math.sin(C.t * 0.9) * 0.03;
      body.rotation.x = C.look;
      earL.rotation.z = 0.5 + Math.sin(C.t * 3.1) * 0.08; earR.rotation.z = -0.5 - Math.sin(C.t * 2.7) * 0.08;
      stalk.visible = C.hasSeed;
      seedU.value = 0.8 + Math.sin(C.t * 3) * 0.15;
    };
    return C;
  };

  // A flower that blooms when asked: two merged meshes (stem, head).
  X.flower = (petal = 0xe58a72, center = 0xf2c25a, s = 1) => {
    const g = new THREE.Group();
    const sb = new P.Builder(petal % 97 + 3);
    sb.add(new THREE.CylinderGeometry(0.012 * s, 0.015 * s, 0.32 * s, 4), 0x6f8a55, { p: [0, 0.16 * s, 0] }, { vary: 0 });
    sb.add(new THREE.SphereGeometry(0.04 * s, 6, 4), 0x7d9152, { p: [0.04 * s, 0.1 * s, 0], s: [1.4, 0.3, 0.7] }, { vary: 0 });
    const stem = new THREE.Mesh(sb.build(), mat); g.add(stem);
    const hb = new P.Builder(petal % 89 + 5);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; hb.add(new THREE.SphereGeometry(0.05 * s, 6, 4), petal, { p: [Math.sin(a) * 0.06 * s, 0, Math.cos(a) * 0.06 * s], r: [0, a, 0], s: [0.7, 0.3, 1.2] }, { vary: 0.04, shade: 0 }); }
    hb.add(new THREE.SphereGeometry(0.035 * s, 8, 6), center, { p: [0, 0.012, 0] }, { vary: 0, shade: 0 });
    const head = new THREE.Mesh(hb.build(), mat); head.position.y = 0.32 * s; g.add(head);
    const F = { group: g, v: 0 };
    F.set = (v) => {
      F.v = v;
      const grow = smooth(v * 2), open = easeOutBack(clamp(v * 2 - 1));
      stem.scale.y = 0.2 + grow * 0.8; head.position.y = 0.32 * s * (0.2 + grow * 0.8);
      head.scale.set(0.15 + open * 0.85, 0.5 + grow * 0.5, 0.15 + open * 0.85);
      head.visible = v > 0.02; g.visible = v > 0.001 || F.always;
    };
    F.set(0);
    return F;
  };

  // A brass bell that swings when rung.
  X.bell = (s = 1) => {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2((0.05 + Math.pow(t, 1.8) * 0.13 + (t > 0.85 ? (t - 0.85) * 0.3 : 0)) * s, (0.28 - t * 0.28) * s)); }
    const swing = new THREE.Group(); g.add(swing);
    mk(new THREE.LatheGeometry(pts, 14), 0xc4a05a, [0, -0.3 * s, 0], swing);
    mk(new THREE.SphereGeometry(0.035 * s, 6, 4), 0x8a6a3a, [0, -0.32 * s, 0], swing);
    const B = { group: g, swing, a: 0, v: 0 };
    B.ring = (k = 1) => { B.v += 5 * k; };
    B.update = dt => { B.v += -B.a * 30 * dt - B.v * 1.2 * dt; B.a += B.v * dt; swing.rotation.z = B.a * 0.5; };
    return B;
  };
  return X;
}

// ---- 05_windmill.js ----
// WORLD I — THE WINDMILL
// Wind arrives from the meadow on the left. Catch it in the sails; the rotor's
// momentum drives a pump that fills a cistern; the cistern feeds a water wheel;
// the wheel's cam kicks a ratchet lift; the lift carries a small lantern-bearer
// to a greenhouse on the cliff, where its seed becomes a flower and a bell rings.
function waterMaterial(THREE, o = {}) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      cDeep: { value: new THREE.Color(o.deep || 0x4f9fa6) }, cLight: { value: new THREE.Color(o.light || 0x8fd0cc) }, cFoam: { value: new THREE.Color(o.foam || 0xf2f6ee) },
      uT: { value: 0 }, uSpeed: { value: o.speed || 1 }, uOp: { value: o.opacity ?? 0.92 }, uScale: { value: o.scale || 4 }, uFlow: { value: 1 }
    }]),
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 cDeep, cLight, cFoam; uniform float uT, uSpeed, uOp, uScale, uFlow; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        float x = vUv.x * uScale - uT * uSpeed * uFlow;
        float wob = sin(vUv.y * 9.0 + uT * 1.3) * 0.15;
        float s1 = sin((x + wob) * 6.2831);
        float s2 = sin((x * 2.3 - wob) * 6.2831 + 1.7);
        float band = smoothstep(0.72, 1.0, s1) * (0.4 + 0.6 * uFlow) + smoothstep(0.85, 1.0, s2) * 0.5 * uFlow;
        float edge = smoothstep(0.32, 0.5, abs(vUv.y - 0.5));
        vec3 c = mix(cDeep, cLight, 0.5 + 0.35 * sin(x * 3.1 + vUv.y * 4.0));
        c = mix(c, cFoam, clamp(band * 0.6 + edge * 0.45, 0.0, 1.0));
        gl_FragColor = vec4(c, uOp * (1.0 - smoothstep(0.46, 0.5, abs(vUv.y - 0.5)) * 0.5));
        #include <fog_fragment>
      }`
  });
}
// a strip along a polyline, lying in a plane: 'flat' (XZ, for streams) or 'vert' (facing +z, for falls)
function stripGeo(THREE, pts, width, mode = 'flat', seg = 2) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const n = Math.max(2, Math.ceil(curve.getLength() * seg));
  const pos = [], uv = [], idx = [], _t = new THREE.Vector3(), _s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1);
  const L = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u); curve.getTangentAt(u, _t);
    if (mode === 'flat') _s.crossVectors(_t, up).normalize(); else _s.crossVectors(_t, fwd).normalize();
    const w = (Array.isArray(width) ? lerp(width[0], width[1], u) : width) / 2;
    pos.push(p.x + _s.x * w, p.y + _s.y * w, p.z + _s.z * w, p.x - _s.x * w, p.y - _s.y * w, p.z - _s.z * w);
    uv.push(u * L / 3, 0, u * L / 3, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function createWindmillWorld(THREE, P, E, X, audio) {
  const W = { id: 'windmill', numeral: 'I', name: 'The Windmill', label: 'WINDMILL', bpm: 76 };
  W.look = {
    sky: { top: '#7fb8d6', mid: '#b4d8e4', horizon: '#eef1e3', sun: '#fff1d0', sunDir: [-0.5, 0.45, -0.75] },
    fog: '#e3ece4', fogNear: 34, fogFar: 170, hemiSky: '#d6e8f0', hemiGround: '#a4a36c', hemi: 1.05, sunColor: '#fff2da', sun: 1.55, sunPos: [-16, 26, 18],
    ink: '#2f3a48', paper: '#f6f1e6'
  };
  W.frame = { x0: -6.6, x1: 7.2, y0: -0.6, y1: 18.6, cy: 8.4, z: 0, dist: 34 };

  const C = { // palette
    stone: 0xe4dac5, stone2: 0xd5c7ad, stoneDark: 0xb9a98c, cream: 0xf3ead5, ivory: 0xfaf4e6, slate: 0x5b7b92, slateDark: 0x46627a,
    wood: 0x9c7552, woodDark: 0x6f523b, woodLight: 0xc19a6b, brass: 0xc2a15e, copper: 0xb9774f, oxide: 0x7fb3a3, rust: 0xc0693f,
    coral: 0xe0705a, yellow: 0xf2c35b, sail: 0xf4cf73, sail2: 0xf6ecd2, moss: 0x7f9a52, grass: 0x9bb06a, rock: 0xd9ccb2
  };

  // level definitions ---------------------------------------------------------
  // win: [in-flow window, good window] in seconds. pattern: beats between gusts.
  W.levels = [
    { n: 1, title: 'Get the windmill turning', note: 'The wind keeps coming. Catch it in the sails.', goal: { type: 'catches', need: 6 }, pump: false, sluice: false, lift: false, pattern: [4], jitter: 0, cross: 0, win: [0.12, 0.27], startW: 0, par: 40 },
    { n: 2, title: 'Fill the cistern', note: 'A turning sail is easier to keep turning.', goal: { type: 'fill' }, pump: true, sluice: false, lift: false, pattern: [4, 4, 4, 3], jitter: 0.03, cross: 0, win: [0.11, 0.25], startW: 0, par: 45 },
    { n: 3, title: 'Raise the lift', note: 'The lift climbs when it is caught at the top of each hop.', goal: { type: 'lift' }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.03, cross: 0, win: [0.11, 0.25], startW: 0.6, par: 40 },
    { n: 4, title: 'Carry a seed to the greenhouse', note: 'Keep water in the cistern, and the wheel keeps turning.', goal: { type: 'deliver', need: 2 }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.04, cross: 0, win: [0.1, 0.23], startW: 0.45, par: 75 },
    { n: 5, title: 'Mind the crosswind', note: 'Not every wind is yours to catch.', goal: { type: 'deliver', need: 2 }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.05, cross: 0.4, win: [0.095, 0.22], startW: 0.45, par: 80 },
    { n: 6, title: 'Everything at once', note: 'The wind has its own idea of time.', goal: { type: 'deliver', need: 3 }, pump: true, sluice: true, lift: true, N: 5, pattern: [3, 3, 2], jitter: 0.04, cross: 0.18, win: [0.09, 0.2], startW: 0.4, par: 110 },
    { n: 7, title: 'The living machine', note: 'Keep it all alive for as long as the day lasts.', goal: { type: 'timed', secs: 100 }, pump: true, sluice: true, lift: true, N: 5, weather: true, jitter: 0.05, cross: 0.16, win: [0.085, 0.19], startW: 0.5, par: 100 }
  ];

  const root = new THREE.Group(); W.root = root;
  const U = { t: { value: 0 } };
  let built = false;
  const S = {}; // scene handles

  W.build = (scene) => {
    if (built) { scene.add(root); return; }
    built = true; scene.add(root);
    const mat = P.mat({ brush: 0.14, scale: 1.6 });
    const matFine = P.mat({ brush: 0.08, scale: 3.5 });
    const ink = P.ink(0x3a3431, 0.03), inkThin = P.ink(0x3a3431, 0.016);
    S.mat = mat; S.matFine = matFine;

    // ---------- ground, path, stream ----------
    const pathAt = (x, z) => {
      // a path from the foreground to the windmill door, and a spur to the footbridge
      const px = Math.sin(z * 0.18) * 1.2 - 0.3 + smooth((z - 2) / 8) * 0.0;
      const d1 = Math.abs(x - px) * (z > 1.8 ? 1 : 3);
      return z > 1.8 ? smooth(1 - d1 / 0.9) * 0.9 : 0;
    };
    const ground = E.ground({ grass: 0x9cb067, grass2: 0xaab873, dry: 0xc9be86, path: 0xd8c8a2, pathAt, flat: 14, rise: 9 });
    root.add(ground); S.heightAt = ground.userData.heightAt;
    // the stream, from the wheel pool across the foreground to the left
    const streamPts = [[4.2, 0.06, 1.9], [3.6, 0.06, 3.4], [1.8, 0.06, 5.2], [-1.2, 0.06, 6.4], [-4.5, 0.06, 7.0], [-9, 0.06, 8.2], [-16, 0.06, 9]];
    S.streamMat = waterMaterial(THREE, { scale: 1.2, speed: 0.6, opacity: 0.9 });
    const stream = new THREE.Mesh(stripGeo(THREE, streamPts, [1.1, 2.0], 'flat', 3), S.streamMat); stream.renderOrder = 1; root.add(stream);
    // banks
    const bank = new P.Builder(31);
    const sc = new THREE.CatmullRomCurve3(streamPts.map(p => new THREE.Vector3(...p)));
    for (let i = 0; i < 46; i++) { const u = i / 45, p = sc.getPointAt(u), tn = sc.getTangentAt(u); const side = i % 2 ? 1 : -1; const w = lerp(0.62, 1.05, u); const r = 0.12 + (i * 37 % 7) / 40; bank.add(new THREE.DodecahedronGeometry(r, 0), i % 3 ? C.stone2 : C.stoneDark, { p: [p.x - tn.z * w * side, 0.02, p.z + tn.x * w * side], s: [1.4, 0.55, 1] }, { jitter: 0.04, vary: 0.1 }); }
    root.add(bank.mesh(mat, null));

    // ---------- the windmill ----------
    const wm = new P.Builder(3);
    wm.add(P.tower(2.25, 1.76, 6.4, 11, 3), C.stone, { p: [0, 3.2, 0] }, { shade: 0.22, top: C.stone2, topAmt: 0.2 });
    // quoins and a few proud stones
    const rq = makeRng(9);
    for (let i = 0; i < 26; i++) { const y = rq.range(0.4, 6.0), a = rq.range(-1.6, 1.9) + (i % 2 ? Math.PI : 0); const r = lerp(2.25, 1.76, y / 6.4) + 0.02; wm.add(new THREE.BoxGeometry(rq.range(0.35, 0.7), rq.range(0.18, 0.3), 0.12), rq() < 0.5 ? C.stone2 : C.stoneDark, { p: [Math.sin(a) * r, y, Math.cos(a) * r], r: [0, a, 0] }, { jitter: 0.03 }); }
    // plinth
    wm.add(new THREE.CylinderGeometry(2.45, 2.6, 0.45, 12), C.stoneDark, { p: [0, 0.2, 0] }, { jitter: 0.06 });
    // door arch
    wm.add(new THREE.BoxGeometry(0.95, 1.5, 0.3), 0x4a3c34, { p: [0, 0.95, 2.12] }, { vary: 0 });
    wm.add(new THREE.CylinderGeometry(0.475, 0.475, 0.3, 12, 1, false, -Math.PI / 2, Math.PI), 0x4a3c34, { p: [0, 1.7, 2.12], r: [Math.PI / 2, 0, 0] }, { vary: 0 });
    wm.add(new THREE.BoxGeometry(0.8, 1.35, 0.06), C.woodDark, { p: [0, 0.88, 2.26] });
    wm.add(new THREE.TorusGeometry(0.62, 0.12, 6, 14, Math.PI), C.stone2, { p: [0, 1.7, 2.2] }, { jitter: 0.02 });
    wm.add(new THREE.BoxGeometry(1.5, 0.16, 0.5), C.stoneDark, { p: [0, 0.08, 2.5] }, { jitter: 0.02 }); // step
    // round windows with slate frames
    for (const [y, a] of [[3.3, 0.35], [4.9, -0.5]]) { const r = lerp(2.25, 1.76, y / 6.4); wm.add(new THREE.TorusGeometry(0.26, 0.07, 6, 14), C.slate, { p: [Math.sin(a) * r, y, Math.cos(a) * r], r: [0, a, 0] }); wm.add(new THREE.CircleGeometry(0.24, 14), 0x34404c, { p: [Math.sin(a) * (r - 0.02), y, Math.cos(a) * (r - 0.02)], r: [0, a, 0] }, { vary: 0, shade: 0 }); }
    // balcony
    wm.add(new THREE.CylinderGeometry(2.35, 2.2, 0.16, 16), C.wood, { p: [0, 6.45, 0] });
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; wm.add(new THREE.BoxGeometry(0.05, 0.42, 0.05), C.woodDark, { p: [Math.sin(a) * 2.28, 6.72, Math.cos(a) * 2.28] }); }
    wm.add(new THREE.TorusGeometry(2.28, 0.035, 4, 40), C.woodLight, { p: [0, 6.93, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; wm.add(new THREE.BoxGeometry(0.1, 0.5, 0.5), C.woodDark, { p: [Math.sin(a) * 1.85, 6.2, Math.cos(a) * 1.85], r: [0, a, 0] }); }
    // upper body: painted cream boards with slate trim
    wm.add(P.tower(1.68, 1.32, 3.6, 12, 5), C.cream, { p: [0, 8.25, 0] }, { shade: 0.12 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; wm.add(new THREE.BoxGeometry(0.06, 3.5, 0.04), 0xe4d6bb, { p: [Math.sin(a) * 1.52, 8.25, Math.cos(a) * 1.52], r: [-0.06 * Math.cos(a), a, 0.06 * Math.sin(a)], order: 'YXZ' }); }
    wm.add(new THREE.TorusGeometry(1.7, 0.07, 5, 24), C.slate, { p: [0, 6.6, 0], r: [Math.PI / 2, 0, 0] });
    wm.add(new THREE.TorusGeometry(1.36, 0.08, 5, 24), C.slate, { p: [0, 10.02, 0], r: [Math.PI / 2, 0, 0] });
    // a little square window and a door onto the balcony
    wm.add(new THREE.BoxGeometry(0.5, 0.62, 0.1), 0x34404c, { p: [-0.55, 8.5, 1.36], r: [0, -0.4, 0] }, { vary: 0 });
    wm.add(new THREE.BoxGeometry(0.6, 0.72, 0.06), C.slate, { p: [-0.53, 8.5, 1.32], r: [0, -0.4, 0] });
    wm.add(new THREE.BoxGeometry(0.62, 1.2, 0.1), C.slateDark, { p: [0.7, 7.15, 1.43], r: [0, 0.45, 0] });
    // cap: a bulging slate-blue bonnet
    const cap = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; cap.push(new THREE.Vector2(Math.max(0.05, 1.55 * Math.sin(Math.PI * (0.5 + t * 0.48)) + Math.sin(t * Math.PI) * 0.22), 10.0 + t * 2.7)); }
    wm.add(new THREE.LatheGeometry(cap, 14), C.slate, { p: [0, 0, 0] }, { shade: 0.1, top: 0x7b98ab, topAmt: 0.4 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; wm.add(new THREE.BoxGeometry(0.05, 2.4, 0.05), C.slateDark, { p: [Math.sin(a) * 1.2, 11.2, Math.cos(a) * 1.2], r: [-0.45 * Math.cos(a), a, 0.45 * Math.sin(a)], order: 'YXZ' }); }
    wm.add(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 6), C.brass, { p: [0, 13.0, 0] });
    wm.add(new THREE.SphereGeometry(0.12, 8, 6), C.brass, { p: [0, 13.5, 0] });
    // dormer on the cap
    wm.add(new THREE.BoxGeometry(0.62, 0.55, 0.5), C.cream, { p: [0.95, 10.95, 0.75], r: [0, 0.9, 0] });
    wm.add(new THREE.ConeGeometry(0.5, 0.35, 4), C.slateDark, { p: [0.95, 11.38, 0.75], r: [0, 0.9 + Math.PI / 4, 0] });
    wm.add(new THREE.CircleGeometry(0.15, 10), 0xffe1a0, { p: [1.15, 10.95, 0.98], r: [0, 0.9, 0] }, { vary: 0, shade: 0 });
    // axle housing toward the rotor
    S.yaw = -0.32;
    const hub = new THREE.Vector3(Math.sin(S.yaw) * 1.85, 10.95, Math.cos(S.yaw) * 1.85);
    S.hub = hub;
    wm.add(new THREE.CylinderGeometry(0.32, 0.42, 1.1, 10), C.slateDark, { p: [hub.x * 0.75, hub.y, hub.z * 0.75], r: [Math.PI / 2, S.yaw, 0], order: 'YXZ' });
    const wmMesh = wm.mesh(mat, ink); root.add(wmMesh);

    // ---------- rotor and sails ----------
    const rotor = new THREE.Group(); rotor.position.copy(hub); rotor.rotation.y = S.yaw; root.add(rotor);
    const spin = new THREE.Group(); rotor.add(spin); S.spin = spin;
    const hb = new P.Builder(7);
    hb.add(new THREE.CylinderGeometry(0.38, 0.38, 0.4, 10), C.wood, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.15] });
    hb.add(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 10), C.brass, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.45] });
    hb.add(new THREE.TorusGeometry(0.36, 0.05, 5, 16), C.coral, { p: [0, 0, 0.36] });
    spin.add(hb.mesh(matFine, inkThin));
    S.sails = [];
    const clothMat = (u) => {
      const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: P.ramp, vertexColors: true, side: THREE.DoubleSide });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uOpen, uFlut, uBelly, uTime, uW;')
          .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
            float uu = clamp(transformed.x / uW, 0.0, 1.0);
            transformed.x *= mix(0.16, 1.0, uOpen);
            float along = (transformed.y - 0.9) / 4.6;
            transformed.z += sin(3.14159 * uu) * uBelly * 0.42 * (0.6 + 0.4 * sin(3.14159 * clamp(along, 0.0, 1.0)));
            transformed.z += sin(uTime * 15.0 + transformed.y * 2.6 + uu * 5.0) * uFlut * 0.13 * uu * (0.4 + uOpen);
            transformed.z += (1.0 - uOpen) * sin(uu * 18.0) * 0.03;`);
      };
      m.customProgramCacheKey = () => 'cloth';
      return m;
    };
    const SAIL_W = 1.32, SAIL_L = 4.6;
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.z = (i / 4) * TAU + 0.4; spin.add(arm);
      const ab = new P.Builder(20 + i);
      ab.add(new THREE.BoxGeometry(0.16, 5.6, 0.14), i === 2 ? C.woodDark : C.wood, { p: [0, 3.0, 0.05] }, { jitter: 0.015 });
      // lattice
      for (let k = 0; k < 9; k++) ab.add(new THREE.BoxGeometry(SAIL_W + 0.1, 0.05, 0.05), C.woodLight, { p: [SAIL_W / 2, 1.0 + k * 0.56, -0.02] });
      ab.add(new THREE.BoxGeometry(0.05, SAIL_L + 0.1, 0.05), C.woodLight, { p: [SAIL_W + 0.03, 3.2, -0.02] });
      ab.add(new THREE.BoxGeometry(0.06, 0.06, 0.25), C.brass, { p: [0, 5.7, 0.05] });
      if (i === 3) { // a tiny birdhouse on the striped sail's spar
        ab.add(new THREE.BoxGeometry(0.22, 0.24, 0.2), C.coral, { p: [-0.2, 4.6, 0.1] });
        ab.add(new THREE.ConeGeometry(0.2, 0.15, 4), C.slate, { p: [-0.2, 4.79, 0.1], r: [0, Math.PI / 4, 0] });
      }
      arm.add(ab.mesh(matFine, inkThin));
      const u = { uOpen: { value: 0.3 }, uFlut: { value: 0 }, uBelly: { value: 0 }, uTime: U.t, uW: { value: SAIL_W } };
      const sail = { arm, u, slats: [] };
      if (i !== 2) {
        const g = new THREE.PlaneGeometry(SAIL_W, SAIL_L, 6, 14); g.translate(SAIL_W / 2, 0.9 + SAIL_L / 2, 0);
        const a = g.attributes.position, col = new Float32Array(a.count * 3), c = new THREE.Color();
        for (let v = 0; v < a.count; v++) {
          const x = a.getX(v), y = a.getY(v);
          if (i === 0) c.set(C.sail).offsetHSL(0, 0, (y - 3) * 0.008);
          else if (i === 1) { c.set(C.sail2); if (x > 0.45 && x < 1.05 && y > 2.6 && y < 3.7) c.set(C.coral); }
          else { c.set(Math.floor((x / SAIL_W) * 6) % 2 ? C.sail : C.sail2); }
          col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const cm = new THREE.Mesh(g, clothMat(u)); cm.castShadow = true; arm.add(cm); sail.cloth = cm;
      } else { // the louvred blade: wooden shutters that open flat
        for (let k = 0; k < 8; k++) {
          const sb = new P.Builder(40 + k); sb.add(new THREE.BoxGeometry(SAIL_W, 0.5, 0.04), k % 3 ? C.cream : 0xe8dcc0, { p: [SAIL_W / 2, 0, 0] });
          const sl = sb.mesh(matFine, null); sl.position.set(0, 1.2 + k * 0.56, 0); arm.add(sl); sail.slats.push(sl);
        }
      }
      if (i === 3) { // pennant at the tip
        const pg = new THREE.PlaneGeometry(0.7, 0.18, 6, 1); pg.translate(0.35, 0, 0);
        const pm = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: C.coral, side: THREE.DoubleSide, fog: true }));
        pm.position.set(0, 5.75, 0.1); arm.add(pm); sail.pennant = pm;
      }
      S.sails.push(sail);
    }
    // weather pennant on the finial
    { const pg = new THREE.PlaneGeometry(0.9, 0.22, 8, 1); pg.translate(-0.45, 0, 0); S.vane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: C.yellow, side: THREE.DoubleSide, fog: true })); S.vane.position.set(0, 13.25, 0); root.add(S.vane); S.vaneG = pg; S.vaneBase = Float32Array.from(pg.attributes.position.array); }

    // ---------- lever and caretaker ----------
    const lv = new P.Builder(50);
    lv.add(new THREE.BoxGeometry(0.16, 0.7, 0.16), C.woodDark, { p: [-1.75, 0.35, 2.75] });
    lv.add(new THREE.BoxGeometry(0.3, 0.12, 0.3), C.stoneDark, { p: [-1.75, 0.04, 2.75] });
    root.add(lv.mesh(mat, inkThin));
    S.lever = new THREE.Group(); S.lever.position.set(-1.75, 0.62, 2.75); root.add(S.lever);
    { const lb = new P.Builder(51); lb.add(new THREE.BoxGeometry(0.05, 0.75, 0.05), C.brass, { p: [0, 0.35, 0] }); lb.add(new THREE.SphereGeometry(0.075, 8, 6), C.coral, { p: [0, 0.75, 0] }); S.lever.add(lb.mesh(matFine, inkThin)); }
    // a rope from the lever up to the balcony, to the brake
    root.add(new THREE.Mesh(P.tube([[-1.72, 1.2, 2.72], [-1.85, 3.5, 2.25], [-1.6, 6.5, 1.65], [-1.2, 9.6, 1.1], [Math.sin(S.yaw) * 1.4, 10.8, Math.cos(S.yaw) * 1.4]], 0.018, 40, 4), new THREE.MeshBasicMaterial({ color: 0x6d5a45, fog: true })));
    S.keeper = X.caretaker(); S.keeper.group.position.set(-2.12, 0, 2.95); S.keeper.group.rotation.y = 0.9; root.add(S.keeper.group);
    // a second little person, mending the pipe
    S.mender = X.caretaker({ coat: 0x8a6f52, hat: 0xd9cfb8 }); S.mender.group.position.set(3.32, 5.42, 1.05); S.mender.group.rotation.y = -0.4; S.mender.group.scale.setScalar(0.95); S.mender.sit = 1; root.add(S.mender.group);

    // ---------- pump house, rod, pipe, cistern ----------
    const ph = new P.Builder(60);
    ph.add(new THREE.BoxGeometry(1.25, 1.05, 1.15), C.stone, { p: [2.85, 0.52, 1.35], r: [0, -0.2, 0] }, { jitter: 0.05 });
    ph.add(new THREE.CylinderGeometry(0.01, 0.95, 0.5, 4, 1), C.rust, { p: [2.85, 1.3, 1.35], r: [0, Math.PI / 4 - 0.2, 0], s: [1, 1, 0.9] });
    ph.add(new THREE.BoxGeometry(0.34, 0.5, 0.06), C.woodDark, { p: [2.75, 0.4, 1.95], r: [0, -0.2, 0] });
    // bracket from the balcony to the rod
    ph.add(new THREE.BoxGeometry(0.9, 0.1, 0.1), C.woodDark, { p: [2.38, 6.32, 1.05], r: [0, -0.3, 0] });
    ph.add(new THREE.BoxGeometry(0.08, 0.6, 0.08), C.woodDark, { p: [2.2, 6.0, 1.0], r: [0, 0, 0.5] });
    // corbel under the cistern, a stone bracket from the tower
    ph.add(new THREE.BoxGeometry(1.3, 0.35, 1.2), C.stone2, { p: [2.55, 3.95, 0.35] }, { jitter: 0.05 });
    ph.add(new THREE.CylinderGeometry(0.2, 0.55, 1.0, 4), C.stone2, { p: [2.35, 3.3, 0.35], r: [0, Math.PI / 4, 0] }, { jitter: 0.05 });
    // cistern: a coopered barrel with copper hoops
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; ph.add(new THREE.BoxGeometry(0.29, 1.2, 0.07), k % 2 ? C.wood : 0xa77f5a, { p: [2.75 + Math.sin(a) * 0.74, 4.72, 0.35 + Math.cos(a) * 0.74], r: [0, a, 0] }, { vary: 0.08 }); }
    for (const y of [4.3, 5.15]) ph.add(new THREE.TorusGeometry(0.775, 0.035, 4, 24), C.copper, { p: [2.75, y, 0.35], r: [Math.PI / 2, 0, 0] });
    ph.add(new THREE.CylinderGeometry(0.72, 0.72, 0.06, 16), C.woodDark, { p: [2.75, 4.15, 0.35] });
    // sluice gate box
    ph.add(new THREE.BoxGeometry(0.3, 0.4, 0.34), C.woodDark, { p: [3.5, 4.38, 0.42] });
    // trough to the wheel: an open wooden chute on a trestle
    const tA = new THREE.Vector3(3.55, 4.25, 0.45), tB = new THREE.Vector3(3.95, 3.02, 1.28);
    const tD = tB.clone().sub(tA), tL = tD.length(), tMid = tA.clone().add(tB).multiplyScalar(0.5);
    const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tD.clone().normalize()), te = new THREE.Euler().setFromQuaternion(tq);
    const tm = new THREE.Matrix4().compose(tMid, tq, new THREE.Vector3(1, 1, 1));
    ph.add(new THREE.BoxGeometry(0.34, tL, 0.05), C.wood, { p: [0, 0, -0.1], m: tm });
    ph.add(new THREE.BoxGeometry(0.05, tL, 0.2), C.woodDark, { p: [-0.17, 0, 0], m: tm });
    ph.add(new THREE.BoxGeometry(0.05, tL, 0.2), C.woodDark, { p: [0.17, 0, 0], m: tm });
    ph.add(new THREE.BoxGeometry(0.08, 2.9, 0.08), C.woodDark, { p: [3.8, 1.5, 0.9] });
    S.troughA = tA; S.troughB = tB;
    // wheel piers
    ph.add(new THREE.BoxGeometry(0.35, 1.6, 0.5), C.stone2, { p: [4.1, 0.8, 0.55] }, { jitter: 0.04 });
    ph.add(new THREE.BoxGeometry(0.35, 1.6, 0.5), C.stone2, { p: [4.1, 0.8, 2.05] }, { jitter: 0.04 });
    ph.add(new THREE.CylinderGeometry(1.35, 1.45, 0.2, 18), C.stoneDark, { p: [4.1, 0.0, 1.35] }, { jitter: 0.04 });
    root.add(ph.mesh(mat, ink));
    // pipe up the tower: weathered copper
    const pipePts = [[3.32, 0.75, 1.45], [3.42, 1.3, 1.3], [3.45, 3.6, 1.1], [3.35, 5.3, 0.85], [3.05, 5.62, 0.55], [2.85, 5.52, 0.42]];
    const pipe = new P.Builder(61); pipe.add(P.tube(pipePts, 0.085, 40, 7), C.copper, {}, { shade: 0.05 });
    for (const u of [0.2, 0.45, 0.7]) { const p = new THREE.CatmullRomCurve3(pipePts.map(q => new THREE.Vector3(...q))).getPointAt(u); pipe.add(new THREE.TorusGeometry(0.11, 0.035, 4, 10), C.oxide, { p: [p.x, p.y, p.z], r: [Math.PI / 2, 0, 0] }); }
    root.add(pipe.mesh(matFine, inkThin));
    // pump rod (moves)
    { const rb = new P.Builder(62); rb.add(new THREE.BoxGeometry(0.09, 5.3, 0.09), C.woodDark, {}); rb.add(new THREE.BoxGeometry(0.2, 0.12, 0.2), C.brass, { p: [0, -2.6, 0] }); S.rod = rb.mesh(matFine, inkThin); S.rod.position.set(2.7, 3.75, 1.1); root.add(S.rod); }
    // clutch gear on the bracket, visibly out of mesh when the pump is off
    S.clutch = new THREE.Mesh((() => { const b = new P.Builder(63); b.add(P.gearGeo(0.32, 12, 0.1, { hole: 0.06, windows: 4 }), C.brass, {}); return b.build(); })(), matFine);
    S.clutch.position.set(2.15, 6.65, 1.25); S.clutch.rotation.y = 0.4; root.add(S.clutch);
    // water inside the cistern
    S.waterTopMat = waterMaterial(THREE, { scale: 0.8, speed: 0.15, opacity: 0.95 });
    S.cisternWater = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), S.waterTopMat); S.cisternWater.rotation.x = -Math.PI / 2; S.cisternWater.position.set(2.75, 4.2, 0.35); root.add(S.cisternWater);
    // water ribbons: trough, fall onto the wheel, pump spout, overflow
    S.troughMat = waterMaterial(THREE, { scale: 2, speed: 2.6, opacity: 0.0 });
    const tw = new THREE.Mesh(stripGeo(THREE, [[tA.x, tA.y + 0.06, tA.z], [tB.x, tB.y + 0.06, tB.z]], 0.26, 'flat', 6), S.troughMat); root.add(tw);
    S.fallMat = waterMaterial(THREE, { scale: 2.5, speed: 3.2, opacity: 0.0 });
    const fall = new THREE.Mesh(stripGeo(THREE, [[tB.x, tB.y + 0.05, tB.z], [tB.x + 0.22, tB.y - 0.25, tB.z + 0.02], [tB.x + 0.36, tB.y - 0.9, tB.z + 0.02]], [0.24, 0.16], 'vert', 8), S.fallMat); root.add(fall);
    S.spoutMat = waterMaterial(THREE, { scale: 3, speed: 3, opacity: 0.0 });
    const spout = new THREE.Mesh(stripGeo(THREE, [[2.85, 5.5, 0.42], [2.8, 5.0, 0.4], [2.78, 4.4, 0.38]], [0.1, 0.06], 'vert', 8), S.spoutMat); root.add(spout);
    S.spillMat = waterMaterial(THREE, { scale: 3, speed: 2.4, opacity: 0.0 });
    const spill = new THREE.Mesh(stripGeo(THREE, [[2.2, 5.35, 0.9], [2.0, 4.6, 1.1], [1.9, 3.8, 1.2]], [0.5, 0.3], 'vert', 8), S.spillMat); root.add(spill);

    // ---------- water wheel ----------
    S.wheel = new THREE.Group(); S.wheel.position.set(4.1, 1.55, 1.3); root.add(S.wheel);
    { const b = new P.Builder(70);
      P.wheel(b, C.wood, { p: [0, 0, -0.35] }, 1.25, 8, 0.12, { rim: 0.06, hubColor: C.woodDark });
      P.wheel(b, C.wood, { p: [0, 0, 0.35] }, 1.25, 8, 0.12, { rim: 0.06, hubColor: C.woodDark });
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; b.add(new THREE.BoxGeometry(0.42, 0.06, 0.78), k % 4 ? C.woodLight : C.cream, { p: [Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0], r: [0, 0, a] }); }
      b.add(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), C.woodDark, { r: [Math.PI / 2, 0, 0] });
      // the cam: a coral knuckle that kicks the lift twice a turn
      b.add(new THREE.BoxGeometry(0.75, 0.16, 0.12), C.coral, { p: [0, 0, 0.82] });
      S.wheel.add(b.mesh(mat, ink)); }

    // ---------- the cliff, the lift, the greenhouse ----------
    const cl = new P.Builder(80);
    const rc = makeRng(81);
    for (let i = 0; i < 46; i++) {
      const x = rc.range(2.6, 9.5), z = rc.range(-7, -1.1), w = rc.range(1.2, 2.6), h = rc.range(1.4, 2.6);
      for (let y = 0; y < 7.4; y += h * 0.9) { const top = y + h > 7.0; cl.add(new THREE.BoxGeometry(w, Math.min(h, 7.6 - y), rc.range(1.2, 2.2)), rc() < 0.25 ? C.stoneDark : (rc() < 0.5 ? C.rock : C.stone2), { p: [x + rc.range(-0.15, 0.15), y + Math.min(h, 7.6 - y) / 2, z], r: [0, rc.range(-0.15, 0.15), 0] }, { jitter: 0.1, top: top ? C.moss : undefined, topAmt: 0.5, shade: 0.25 }); if (top) break; }
    }
    cl.add(new THREE.BoxGeometry(7.2, 0.4, 6.2), C.moss, { p: [6.1, 7.55, -4.0] }, { jitter: 0.12, shade: 0 });
    root.add(cl.mesh(mat, ink));
    // lift tower
    const lt = new P.Builder(90);
    const LX = 5.25, LZ = 0.6;
    for (const [dx, dz] of [[-0.48, -0.42], [0.48, -0.42], [-0.48, 0.42], [0.48, 0.42]]) lt.add(new THREE.BoxGeometry(0.12, 8.4, 0.12), C.wood, { p: [LX + dx, 4.2, LZ + dz] }, { jitter: 0.01 });
    for (let y = 0.6; y < 8; y += 1.25) {
      lt.add(new THREE.BoxGeometry(1.0, 0.08, 0.08), C.woodDark, { p: [LX, y, LZ + 0.42] }); lt.add(new THREE.BoxGeometry(1.0, 0.08, 0.08), C.woodDark, { p: [LX, y, LZ - 0.42] });
      lt.add(new THREE.BoxGeometry(0.06, 1.4, 0.06), C.woodDark, { p: [LX + 0.48, y + 0.62, LZ - 0.42], r: [0, 0, 0.62] });
    }
    lt.add(new THREE.BoxGeometry(1.5, 0.12, 0.3), C.woodDark, { p: [LX, 8.4, LZ] });
    // ratchet rack: coral teeth that read as the lift's progress marks
    S.rackY = [];
    // top deck and bridge to the cliff
    lt.add(new THREE.BoxGeometry(1.2, 0.1, 1.5), C.woodLight, { p: [LX - 0.15, 7.62, -0.35] });
    for (let k = 0; k < 6; k++) lt.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), C.woodDark, { p: [LX + 0.45, 7.85, 0.3 - k * 0.27] });
    lt.add(new THREE.BoxGeometry(0.05, 0.05, 1.5), C.woodLight, { p: [LX + 0.45, 8.05, -0.35] });
    // winch at the foot of the lift, linked to the wheel's cam
    lt.add(new THREE.BoxGeometry(1.3, 0.3, 1.2), C.stoneDark, { p: [LX, 0.15, LZ] }, { jitter: 0.04 });
    root.add(lt.mesh(mat, ink));
    S.pulley = new THREE.Group(); S.pulley.position.set(LX, 8.85, LZ); root.add(S.pulley);
    { const b = new P.Builder(91); P.wheel(b, C.brass, {}, 0.72, 6, 0.12, { rim: 0.07, hubColor: C.coral }); S.pulley.add(b.mesh(matFine, inkThin)); }
    S.winch = new THREE.Group(); S.winch.position.set(LX - 0.55, 0.55, LZ + 0.55); root.add(S.winch);
    { const b = new P.Builder(92); b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), C.woodDark, { r: [0, 0, Math.PI / 2] }); b.add(new THREE.BoxGeometry(0.06, 0.5, 0.06), C.coral, { p: [0, 0.25, 0.2] }); S.winch.add(b.mesh(matFine, inkThin)); }
    // pushrod from the wheel to the winch
    S.pushrod = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), matFine); root.add(S.pushrod);
    { const g = S.pushrod.geometry; const col = new Float32Array(g.attributes.position.count * 3).fill(0.5); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    // cage
    S.cage = new THREE.Group(); root.add(S.cage);
    { const b = new P.Builder(93);
      b.add(new THREE.BoxGeometry(0.8, 0.07, 0.75), C.woodDark, { p: [0, 0, 0] });
      for (const [dx, dz] of [[-0.38, -0.35], [0.38, -0.35], [-0.38, 0.35], [0.38, 0.35]]) b.add(new THREE.BoxGeometry(0.05, 0.8, 0.05), C.brass, { p: [dx, 0.4, dz] });
      b.add(new THREE.BoxGeometry(0.85, 0.06, 0.8), C.slate, { p: [0, 0.82, 0] });
      b.add(new THREE.ConeGeometry(0.6, 0.25, 4), C.slate, { p: [0, 0.97, 0], r: [0, Math.PI / 4, 0] });
      b.add(new THREE.BoxGeometry(0.78, 0.04, 0.04), C.brass, { p: [0, 0.35, 0.36] });
      S.cage.add(b.mesh(matFine, inkThin)); }
    S.pawl = new THREE.Group(); S.pawl.position.set(0.42, 0.45, 0.36); S.cage.add(S.pawl);
    { const b = new P.Builder(94); b.add(new THREE.BoxGeometry(0.06, 0.3, 0.06), C.coral, { p: [0, -0.12, 0] }); S.pawl.add(b.mesh(matFine, null)); }
    // ropes (unit cylinders stretched each frame)
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0x5e4c3c, fog: true });
    S.rope1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), ropeMat); root.add(S.rope1);
    S.rope2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), ropeMat); root.add(S.rope2);
    S.weight = new THREE.Mesh((() => { const b = new P.Builder(95); b.add(new THREE.BoxGeometry(0.3, 0.5, 0.25), C.stoneDark, {}); return b.build(); })(), mat); root.add(S.weight);
    S.LX = LX; S.LZ = LZ;
    // greenhouse
    const GX = 4.75, GZ = -2.55, GY = 7.75;
    const gh = new P.Builder(100);
    gh.add(new THREE.BoxGeometry(2.6, 0.3, 1.9), C.stone2, { p: [GX, GY - 0.05, GZ] }, { jitter: 0.04 });
    const frame = (x0, y0, z0, x1, y1, z1, t = 0.06) => { const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); gh.add(new THREE.BoxGeometry(t, d.length(), t), C.ivory, { m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) }, { vary: 0.02, shade: 0.05 }); };
    const hx = 1.2, hz = 0.85, hh = 1.35, pk = 2.15;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame(GX + sx * hx, GY + 0.1, GZ + sz * hz, GX + sx * hx, GY + hh, GZ + sz * hz);
    for (let k = -2; k <= 2; k++) { frame(GX + k * hx / 2, GY + 0.1, GZ + hz, GX + k * hx / 2, GY + hh, GZ + hz, 0.04); frame(GX + k * hx / 2, GY + hh, GZ + hz, GX + k * hx / 2, GY + pk, GZ, 0.045); frame(GX + k * hx / 2, GY + hh, GZ - hz, GX + k * hx / 2, GY + pk, GZ, 0.045); }
    frame(GX - hx, GY + pk, GZ, GX + hx, GY + pk, GZ); frame(GX - hx, GY + hh, GZ + hz, GX + hx, GY + hh, GZ + hz); frame(GX - hx, GY + hh, GZ - hz, GX + hx, GY + hh, GZ - hz);
    frame(GX - hx, GY + 0.7, GZ + hz, GX + hx, GY + 0.7, GZ + hz, 0.04);
    // a little bell gable
    frame(GX - hx, GY + hh, GZ + hz, GX - hx, GY + pk + 0.5, GZ + hz * 0.3, 0.06);
    gh.add(new THREE.BoxGeometry(0.5, 0.06, 0.4), C.slate, { p: [GX - hx, GY + pk + 0.55, GZ + hz * 0.3] });
    // pots
    S.pots = [];
    for (let k = 0; k < 6; k++) { const x = GX - 0.95 + k * 0.38, z = GZ + 0.45; gh.add(new THREE.CylinderGeometry(0.11, 0.08, 0.16, 8), C.rust, { p: [x, GY + 0.18, z] }); S.pots.push(new THREE.Vector3(x, GY + 0.26, z)); }
    gh.add(new THREE.BoxGeometry(2.3, 0.08, 0.45), C.woodLight, { p: [GX, GY + 0.08, GZ + 0.45] });
    root.add(gh.mesh(matFine, inkThin));
    S.glassU = { value: 0 };
    const glassM = new THREE.MeshLambertMaterial({ color: 0xcfe8ea, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
    S.glassM = glassM;
    const glass = new THREE.Group();
    const pane = (w, h, x, y, z, ry, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); glass.add(m); };
    pane(2.4, 1.25, GX, GY + 0.72, GZ + hz, 0); pane(2.4, 1.25, GX, GY + 0.72, GZ - hz, 0); pane(1.7, 1.25, GX - hx, GY + 0.72, GZ, Math.PI / 2); pane(1.7, 1.25, GX + hx, GY + 0.72, GZ, Math.PI / 2);
    const sl = Math.hypot(hz, pk - hh); pane(2.4, sl, GX, GY + (hh + pk) / 2, GZ + hz / 2, 0, -Math.atan2(hz, pk - hh)); pane(2.4, sl, GX, GY + (hh + pk) / 2, GZ - hz / 2, 0, Math.atan2(hz, pk - hh));
    glass.renderOrder = 3; root.add(glass);
    S.lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false })); S.lamp.position.set(GX, GY + 1.2, GZ); S.lamp.scale.set(2.4, 2.4, 1); root.add(S.lamp);
    S.flowers = S.pots.map((p, k) => { const f = X.flower([C.coral, 0xf2c25a, 0xe9a1b3, 0xf6ecd2, C.coral, 0xb8c8e8][k], k === 1 ? 0xe0705a : 0xf2c25a, 1.0); f.group.position.copy(p); root.add(f.group); return f; });
    S.bell = X.bell(1.0); S.bell.group.position.set(GX - hx, GY + pk + 0.5, GZ + hz * 0.3); root.add(S.bell.group);
    S.ghDoor = new THREE.Vector3(GX - 0.3, GY + 0.0, GZ + hz + 0.1);

    // ---------- the creature, seeds, garden ----------
    S.critter = X.creature(); root.add(S.critter.group);
    const bk = new P.Builder(110);
    bk.add(new THREE.CylinderGeometry(0.28, 0.22, 0.26, 10, 1, true), C.woodLight, { p: [4.55, 0.13, 2.85] }, { vary: 0.05 });
    bk.add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 10), C.woodDark, { p: [4.55, 0.02, 2.85] });
    for (let k = 0; k < 5; k++) bk.add(new THREE.SphereGeometry(0.06, 6, 4), C.yellow, { p: [4.48 + (k % 3) * 0.07, 0.27, 2.8 + (k > 2 ? 0.08 : 0)] }, { vary: 0, shade: 0 });
    root.add(bk.mesh(matFine, inkThin));
    S.basket = new THREE.Vector3(4.3, 0, 2.95);
    S.liftDoor = new THREE.Vector3(LX - 0.1, 0, LZ + 0.95);
    S.garden = [];
    const gr = makeRng(120);
    for (let k = 0; k < 16; k++) {
      const x = k < 8 ? gr.range(1.7, 3.6) : gr.range(-3.6, -2.4), z = k < 8 ? gr.range(2.4, 3.6) : gr.range(1.0, 2.2);
      const f = X.flower(gr.pick([C.coral, 0xf2c25a, 0xf6ecd2, 0xe9a1b3, 0xb8c8e8]), 0xf2c25a, gr.range(0.7, 1.1));
      f.group.position.set(x, 0, z); f.thr = 0.15 + (k / 16) * 0.8; root.add(f.group); S.garden.push(f);
    }

    // ---------- the rest of the little world ----------
    const fb = new P.Builder(130), tb = new P.Builder(131);
    E.tree(tb, fb, -3.7, 0, -1.6, 1.3, 3);
    E.tree(tb, fb, -8.5, 0.2, -4.5, 1.6, 4);
    E.tree(tb, fb, -11, 0.3, -1, 1.2, 5);
    E.tree(tb, fb, 8.2, 7.6, -5.2, 1.2, 6);
    E.tree(tb, fb, 6.8, 7.6, -6.2, 0.9, 7);
    E.tree(tb, fb, -5.2, 0.4, -10, 1.8, 8);
    E.tree(tb, fb, 10, 0.3, 4, 1.4, 9);
    // a tree that has grown up against the pump house
    E.tree(tb, fb, 3.55, 0, 2.15, 0.6, 10, { leaves: [0x8fa660, 0x9fb06a] });
    const bush = (x, z, s, seed) => { const r = makeRng(seed); for (let i = 0; i < 3; i++) fb.add(P.blob(r.range(0.35, 0.55) * s, seed * 3 + i), r.pick([0x7d9152, 0x8a9a5b, 0x93a663]), { p: [x + r.range(-0.4, 0.4) * s, (S.heightAt ? S.heightAt(x, z) : 0) + 0.25 * s, z + r.range(-0.3, 0.3) * s] }, { shade: 0.35, top: 0xc9c77a, topAmt: 0.4 }); };
    bush(-2.9, 1.0, 1, 1); bush(-4.6, -0.2, 1.3, 2); bush(1.9, -1.4, 1.2, 3); bush(6.5, 7.6, -1.6, 4); bush(-6.5, 3, 1, 5); bush(7, 2.2, 1.2, 6); bush(-1.5, -2.1, 1.1, 7);
    S.foliage = new THREE.Mesh(fb.build(), E.foliageMat()); S.foliage.castShadow = true; S.foliage.receiveShadow = true; root.add(S.foliage);
    root.add(tb.mesh(mat, inkThin));
    // cottage with chimney
    const ct = new P.Builder(140);
    ct.add(new THREE.BoxGeometry(2.6, 1.8, 2.0), C.cream, { p: [-7.2, 0.9, -4.6], r: [0, 0.35, 0] }, { jitter: 0.06 });
    ct.add(new THREE.CylinderGeometry(0.01, 2.0, 1.3, 4), C.rust, { p: [-7.2, 2.45, -4.6], r: [0, 0.35 + Math.PI / 4, 0], s: [1.35, 1, 1.0] });
    ct.add(new THREE.BoxGeometry(0.35, 0.9, 0.35), C.stone2, { p: [-6.6, 2.9, -4.9] }, { jitter: 0.03 });
    ct.add(new THREE.BoxGeometry(0.4, 0.5, 0.06), 0x34404c, { p: [-6.8, 1.0, -3.6], r: [0, 0.35, 0] }, { vary: 0 });
    ct.add(new THREE.BoxGeometry(0.45, 0.9, 0.06), C.slate, { p: [-7.7, 0.45, -3.75], r: [0, 0.35, 0] });
    // the cart, sacks, a fence
    ct.add(new THREE.BoxGeometry(1.1, 0.25, 0.7), C.woodLight, { p: [-4.3, 0.55, 2.2], r: [0, 0.5, 0.12] });
    ct.add(new THREE.TorusGeometry(0.3, 0.05, 5, 12), C.woodDark, { p: [-4.15, 0.32, 2.62], r: [0, 0.5, 0] });
    ct.add(new THREE.BoxGeometry(1.2, 0.05, 0.05), C.woodDark, { p: [-3.55, 0.4, 2.6], r: [0, 0.5, -0.35] });
    for (let k = 0; k < 2; k++) ct.add(new THREE.SphereGeometry(0.2, 7, 5), 0xd6c39a, { p: [-4.4 + k * 0.3, 0.8, 2.2 - k * 0.1], s: [1, 0.8, 0.8] });
    for (let k = 0; k < 9; k++) { const x = -9 + k * 0.9, z = 0.6 + Math.sin(k) * 0.3; ct.add(new THREE.BoxGeometry(0.07, 0.6, 0.07), C.woodDark, { p: [x, 0.3, z] }); if (k < 8) ct.add(new THREE.BoxGeometry(0.92, 0.05, 0.04), C.woodLight, { p: [x + 0.45, 0.45, z], r: [0, 0, 0.03] }); }
    // footbridge over the stream
    for (let k = 0; k < 7; k++) ct.add(new THREE.BoxGeometry(0.22, 0.06, 1.0), C.woodLight, { p: [0.4 + k * 0.23, 0.18 + Math.sin(k / 6 * Math.PI) * 0.12, 5.6 + k * 0.05], r: [0, -0.35, 0] });
    for (const zz of [-0.45, 0.45]) ct.add(P.tube([[0.35, 0.5, 5.55 + zz], [1.1, 0.62, 5.75 + zz * 0.95], [1.85, 0.5, 5.95 + zz * 0.9]], 0.025, 12, 4), C.woodDark, {});
    root.add(ct.mesh(mat, ink));
    S.smoke = E.smoke(root, P, [-6.6, 3.4, -4.9]);

    // grass across the meadow, thinner near paths and the stream
    root.add(E.grass({ count: 4200, x0: -22, x1: 12, z0: -9, z1: 12, root: 0x8aa35c, tip: 0xd0d48c, tip2: 0xe8dca0, scale: 0.75, heightAt: S.heightAt, seed: 5,
      accept: (x, z, r) => (z < 6 || r() < 0.45) && !(x > 2.4 && x < 10 && z < -0.8 && z > -8) && pathAt(x, z) < 0.3 && Math.hypot(x, z) > 2.5 && !(x > 3 && x < 6.2 && z > 0 && z < 2.3) }));
    // distant layers
    root.add(E.layers([
      { kind: 'hills', seed: 3, w: 320, y: 24, z: -140, color: 0xc6d6d6 },
      { kind: 'hills', seed: 7, w: 260, y: 14, z: -110, color: 0xb3c8b8, order: 1 },
      { kind: 'town', seed: 11, w: 200, y: 8, z: -80, color: 0xa7b9a6, order: 2 },
    ]));
    root.add(E.wildflowers({ count: 700, x0: -20, x1: 11, z0: -6, z1: 13, heightAt: S.heightAt, accept: (x, z) => pathAt(x, z) < 0.2 && Math.hypot(x, z) > 2.8 && !(x > 2.4 && x < 10 && z < -0.8) && !(x > 3 && x < 6.2 && z > 0 && z < 2.3) }));
    S.clouds = E.clouds({ count: 12, y0: 14, y1: 70 }); root.add(S.clouds);
    // birds on the balcony rail and the cap
    S.birds = E.birds(root, [[-1.2, 7.0, 1.85], [-0.6, 7.0, 2.2], [1.6, 7.0, 1.6], [0.25, 13.65, 0.1], [4.0, 8.42, 0.6]]);
    S.ribbons = E.ribbons(root);
    S.leaves = E.leaves(root, 80);
    // little lanterns on the balcony that light with flow
    S.lanterns = [];
    for (const a of [-0.9, 0.0, 0.9]) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffcf7a, transparent: true, opacity: 0, depthWrite: false })); s.position.set(Math.sin(a) * 2.3, 7.15, Math.cos(a) * 2.3); s.scale.set(0.6, 0.6, 1); root.add(s); S.lanterns.push(s); const lb = new P.Builder(160); lb.add(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 6), C.brass, {}); const lm = new THREE.Mesh(lb.build(), matFine); lm.position.copy(s.position); root.add(lm); }
    // gust paths
    S.gustCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-19, 1.0, 7.5), new THREE.Vector3(-12, 1.3, 6), new THREE.Vector3(-6.5, 2.6, 4.6), new THREE.Vector3(-3, 6.5, 3.6), new THREE.Vector3(hub.x - 0.6, hub.y - 0.3, hub.z + 1.2)]);
    S.crossCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(18, 10.5, 6), new THREE.Vector3(11, 10.2, 5), new THREE.Vector3(5.5, 11.2, 3.8), new THREE.Vector3(hub.x + 0.8, hub.y + 0.2, hub.z + 1.2)]);
  };

  // ---------- simulation state ----------
  let st = null;
  const notchY = k => 0.12 + k * ((7.62 - 0.12) / st.N);
  W.begin = (level, G) => {
    S.ribbons.clear(); S.leaves.clear();
    st = {
      L: level, theta: st ? st.theta : 0.3, omega: 0.15, open: 0.25, openT: -9, belly: 0, bellyT: -9, flut: 0,
      water: level.startW || 0, spill: 0, pumpPhase: 0, prevSin: 0, strokes: 0,
      wheelA: 0, wheelW: 0, prevCam: 0,
      N: level.N || 4, n: 0, liftMode: 'idle', liftY: 0.12, liftV: 0, bounce: null, liftT: 0,
      critter: { s: 'basket', t: 0, pos: S.basket.clone(), seed: true, k: 0, path: null },
      deliveries: 0, lifts: 0, catches: 0, gusts: [], nextBeat: 4, patIdx: 0, weatherIdx: 0, weather: null,
      lastCatch: 0, stillT: 0, crossTaps: 0, finale: false, hatT: -1, bloomsShown: 0, potK: 0
    };
    st.critter.pos.copy(S.basket); st.critter.seed = true;
    for (const f of S.flowers) f.set(0);
    for (const f of S.garden) f.set(0);
    S.keeper.hatOff = 0; S.keeper.sit = 0;
    S.clutch.position.x = level.pump ? 2.15 : 1.95;
    if (level.weather) st.weather = makeWeather(G.rng);
  };
  // the day's weather: a sequence of wind moods, each a bar or two long
  function makeWeather(rng) {
    const moods = [{ p: [4], c: 0 }, { p: [3, 3, 2], c: 0.1 }, { p: [2, 2, 4], c: 0 }, { p: [6, 2], c: 0.2 }, { p: [4, 2, 2], c: 0.1 }, { p: [3, 5], c: 0.25 }, { p: [8], c: 0.5 }];
    const seq = [moods[0]]; for (let i = 0; i < 12; i++) seq.push(rng.pick(moods.slice(1)));
    return seq;
  }
  function patternNow() {
    if (st.weather) { const m = st.weather[Math.min(st.weather.length - 1, Math.floor(st.nextBeat / 16))]; return { p: m.p, c: Math.max(st.L.cross * 0.6, m.c) }; }
    return { p: st.L.pattern, c: st.L.cross };
  }
  const LEAD_BEATS = 3;
  function schedule(G) {
    const beat = G.beat;
    // keep two gusts of lookahead
    while (G.beatTime(st.nextBeat) - (G.lead || LEAD_BEATS) * beat < G.t + 0.05) {
      const { p, c } = patternNow();
      const gap = p[st.patIdx % p.length];
      const arrive = G.beatTime(st.nextBeat) + (st.L.jitter ? G.rng.range(-st.L.jitter, st.L.jitter) : 0);
      spawnGust(G, arrive, false);
      if (c > 0 && gap >= 4 && G.rng() < c) spawnGust(G, G.beatTime(st.nextBeat + gap / 2), true);
      st.nextBeat += gap; st.patIdx++;
    }
  }
  function spawnGust(G, arrive, cross) {
    const lead = (cross ? 2.6 : (G.lead || LEAD_BEATS)) * G.beat;
    const gust = { cross, tA: arrive, t0: arrive - lead, curve: cross ? S.crossCurve : S.gustCurve, res: null, resT: 0, strength: 0.8 + G.rng() * 0.4 };
    gust.op = G.addOp(cross ? 'cross' : 'gust', arrive, { gust }, cross);
    S.ribbons.spawn(gust, cross ? 3 : 4, cross ? 0x7d93ab : 0xf3c45a);
    audio.gust(arrive, lead, gust.strength, cross);
    st.gusts.push(gust);
  }

  // ---------- resolutions ----------
  W.resolve = (op, res, d, G) => {
    const t = G.t;
    if (op.kind === 'gust') {
      const g = op.data.gust; g.res = res; g.resT = t;
      openSails(t);
      if (res === 'flow' || res === 'good') {
        const q = res === 'flow' ? 1 : 0.6;
        const mom = clamp(st.omega / 3.2);
        st.omega = Math.min(3.6, st.omega + q * (0.95 + 0.6 * mom) + 0.15);
        st.belly = q; st.bellyT = t; st.catches++; st.lastCatch = t;
        audio.catchFlow(t, q);
        S.leaves.swirl(S.hub, 0.6);
        S.keeper.sit = 0;
        G.focus(S.hub, 0.25 * q);
      } else if (res === 'early') {
        st.omega += 0.22; st.belly = 0.2; st.bellyT = t; audio.luff(t);
      } else { // late: the gust has gone through already
        audio.knock(t, 0.8, 0.8); st.belly = -0.1; st.bellyT = t;
      }
    } else if (op.kind === 'cross') {
      const g = op.data.gust; g.res = 'snag'; g.resT = t;
      openSails(t);
      st.omega = -0.9; st.belly = -0.9; st.bellyT = t;
      audio.luff(t); audio.knock(t + 0.05, 0.6, 1);
      S.keeper.hatOff = 1; st.hatT = t;
      S.birds.startle(S.hub, 6); audio.flutter(t);
      G.focus(S.hub, -0.15);
    } else if (op.kind === 'apex') {
      const b = st.bounce; if (!b || b.op !== op) return;
      if (res === 'flow' || res === 'good') {
        st.n = Math.min(st.N, st.n + 1); st.liftMode = 'settle'; st.liftT = t; st.bounce = null; st.liftV = -0.6;
        audio.latch(t, res === 'flow' ? 1 : 0.7, st.n * 2);
        S.pawl.rotation.z = 0.8;
        if (st.n >= st.N) { st.liftMode = 'top'; st.lifts++; G.event('lift-top'); }
      } else { b.slip = true; audio.knock(t, 1.4, 0.9); audio.ratchet(t + 0.05); S.pawl.rotation.z = -0.6; }
    }
  };
  W.passed = (op, G) => {
    if (op.kind === 'gust') { const g = op.data.gust; if (!g.res) { g.res = 'miss'; g.resT = G.t; st.omega += 0.12; audio.whooshPast(G.t); } }
    else if (op.kind === 'cross') { const g = op.data.gust; g.res = 'weathered'; g.resT = G.t; st.omega *= 0.85; }
  };
  W.idle = (G) => { openSails(G.t); audio.luff(G.t); st.belly = 0.15; st.bellyT = G.t; };
  function openSails(t) { st.openT = t; S.keeper.pull = 1; }

  // autopilot for the finale: let the machine show itself working
  W.objective = (G) => {
    const g = st.L.goal;
    if (g.type === 'catches') return { ticks: st.catches, need: g.need, done: st.catches >= g.need };
    if (g.type === 'fill') return { ticks: Math.floor(st.water * 5 + 0.001), need: 5, done: st.water >= 0.985 };
    if (g.type === 'lift') return { ticks: st.n, need: st.N, done: st.lifts >= 1 };
    if (g.type === 'deliver') return { ticks: st.deliveries, need: g.need, done: st.deliveries >= g.need };
    return { ticks: st.deliveries, need: 0, done: false, timed: true };
  };
  W.stats = () => ({ deliveries: st.deliveries, lifts: st.lifts, water: st.water });
  W._st = () => st;
  W.hint = () => { const g = st.gusts.find(q => !q.res && !q.cross); return g ? { gust: g, hub: S.hub } : null; };
  W.discovery = () => (st.L.n === 3 ? 'the lift' : st.L.n === 4 ? 'the greenhouse' : st.L.n === 5 ? 'the crosswind' : st.L.n === 2 ? 'the cistern' : null);

  // ---------- update ----------
  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  W.update = (dt, G) => {
    const t = G.t, beat = G.beat, L = st.L, flow = G.flow;
    U.t.value = t;
    schedule(G);
    // gusts: front position, grass wave, ribbons, leaves
    const gU = E.windU.uG.value; let gi = 0, near = 0, nearCross = 0, windX = 0.3;
    for (let i = st.gusts.length - 1; i >= 0; i--) {
      const g = st.gusts[i];
      const s = (t - g.t0) / (g.tA - g.t0);
      const caught = g.res === 'flow' || g.res === 'good';
      if (s > (caught ? 1.25 : 1.9) || (g.res === 'snag' && t - g.resT > 1.2)) { S.ribbons.release(g); st.gusts.splice(i, 1); continue; }
      const sEase = s < 1 ? s : 1 + (s - 1) * (caught ? 0.4 : 1);
      const fade = (s < 0.15 ? s / 0.15 : 1) * (caught ? clamp(1 - (s - 1) * 4) : clamp(1 - (s - 1) * 1.4));
      S.ribbons.draw(g, sEase, fade, t);
      g.curve.getPointAt(clamp(sEase), _p);
      if (gi < 4 && s > 0 && s < 1.6) { gU[gi].set(g.cross ? _p.x : lerp(_p.x, _p.x + (s - 1) * 15, s > 1 ? 1 : 0), 0.9 * g.strength * fade, g.cross ? -1 : 1, 3.2); gi++; }
      if (s < 1 && s > 0.05 && Math.random() < dt * (g.cross ? 10 : 22)) S.leaves.emit(_p, _q.set(g.cross ? -5 : 5.5, 0.6, -0.4), 1, 1.4);
      if (s < 1) { if (g.cross) nearCross = Math.max(nearCross, smooth((s - 0.5) / 0.5)); else near = Math.max(near, smooth((s - 0.5) / 0.5)); }
      if (s > 0.4 && s < 1.2) windX = g.cross ? -4 : 5;
    }
    for (; gi < 4; gi++) gU[gi].set(0, 0, 1, 1);
    E.windU.uTime.value = t; E.windU.uBase.value = 0.12 + flow * 0.12;
    S.leaves.update(dt, windX);

    // rotor
    const drag = lerp(0.42, 0.18, flow);
    const idleW = 0.12 + flow * 0.5;
    st.omega += (idleW - st.omega) * (1 - Math.exp(-drag * dt));
    const prevTheta = st.theta; st.theta += st.omega * dt;
    S.spin.rotation.z = st.theta;
    // blade-pass creaks and a thump per revolution
    const q0 = Math.floor(prevTheta / (Math.PI / 2)), q1 = Math.floor(st.theta / (Math.PI / 2));
    if (q1 !== q0 && Math.abs(st.omega) > 0.5) { audio.creak(t, clamp(st.omega / 3.2), q1); if ((q1 % 4 + 4) % 4 === 0) audio.thump(t, clamp(st.omega / 3)); }
    // sails: open on a pull, belly on a catch, flutter as wind nears
    const sinceOpen = t - st.openT;
    const pulled = sinceOpen < 0.55 ? easeOutBack(sinceOpen / 0.14) : 1 - smooth((sinceOpen - 0.55) / 0.8);
    st.open = Math.max(0.42 + flow * 0.3, clamp(pulled, 0, 1.15));
    const bellyNow = st.belly * Math.exp(-(t - st.bellyT) * 1.6);
    st.flut = damp(st.flut, Math.max(near, nearCross * 1.3) + (Math.abs(bellyNow) < 0.15 && sinceOpen < 0.8 ? 0.6 : 0), 6, dt);
    for (let i = 0; i < 4; i++) {
      const s = S.sails[i];
      s.u.uOpen.value = st.open; s.u.uFlut.value = st.flut * (0.8 + 0.2 * Math.sin(i * 3)); s.u.uBelly.value = bellyNow + Math.max(0, st.omega) * 0.04;
      for (let k = 0; k < s.slats.length; k++) s.slats[k].rotation.y = lerp(1.25, 0.05, clamp(st.open)) + Math.sin(t * 13 + k) * st.flut * 0.12;
      if (s.pennant) { const pa = s.pennant.rotation; pa.z = Math.sin(t * 9) * 0.25 * (0.3 + st.flut); }
    }
    // the vane on the finial follows the wind, flapping harder as gusts near
    { const a = S.vaneG.attributes.position, base = S.vaneBase, dir = nearCross > near ? -1 : 1;
      for (let i = 0; i < a.count; i++) { const x = base[i * 3]; a.setX(i, x * dir); a.setZ(i, Math.sin(t * 10 + x * 6) * (0.03 + Math.max(near, nearCross) * 0.12) * (-x)); }
      a.needsUpdate = true; }
    // the keeper: watches the meadow, pulls, sits when all is still
    const K = S.keeper;
    K.pull = damp(K.pull, 0, 5, dt);
    S.lever.rotation.z = 0.5 - K.pull * 0.9;
    K.look = damp(K.look, near > 0.05 ? -1.1 : nearCross > 0.05 ? 0.9 : -0.2 + Math.sin(t * 0.3) * 0.3, 3, dt);
    if (t - st.lastCatch > 14 && st.omega < 0.4 && G.playing) { if (K.sit < 0.5) audio.stillness(t); K.sit = damp(K.sit, 1, 2, dt); } else K.sit = damp(K.sit, 0, 4, dt);
    K.cheer = damp(K.cheer, st.finale ? 0.5 + 0.5 * Math.sin(t * 6) : 0, 4, dt);
    if (K.hatOff > 0 && t - st.hatT > 3.2) K.hatOff = 0;
    K.update(dt);
    S.mender.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 3.2)) * 0.6; S.mender.update(dt);
    S.mender.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 3.2)) * 0.6;

    // pump: two strokes a turn while engaged and turning fast enough
    const engaged = L.pump && st.omega > 0.75;
    const sn = Math.sin(st.theta * 2);
    S.rod.position.y = 3.75 + (L.pump ? sn * 0.2 : 0);
    S.clutch.rotation.z = L.pump ? st.theta * 2 : 0;
    let spout = 0;
    if (engaged && st.prevSin > 0 && sn <= 0) {
      const vol = 0.058 * clamp((st.omega - 0.6) / 2.2, 0.2, 1);
      st.water += vol; st.strokes++;
      audio.chuff(t, clamp(st.omega / 3));
      audio.drip(t + 0.15, Math.floor(clamp(st.water) * 9));
      st.spoutT = t;
    }
    st.prevSin = sn;
    if (st.spoutT !== undefined) spout = clamp(1 - (t - st.spoutT) / 0.7);
    S.spoutMat.uniforms.uOp.value = spout * 0.9; S.spoutMat.uniforms.uT.value = t;
    // cistern out to the wheel
    let out = 0;
    if (L.sluice && st.water > 0.004) { out = (0.024 + st.water * 0.02) * dt; st.water -= out; }
    if (st.water > 1) { st.spill = 1; st.water = 1; if (Math.random() < dt * 3) audio.splash(t, 0.5); }
    st.spill = damp(st.spill, 0, 1.2, dt);
    st.water = Math.max(0, st.water);
    S.cisternWater.position.y = 4.18 + st.water * 1.0; S.cisternWater.visible = st.water > 0.01;
    S.waterTopMat.uniforms.uT.value = t; S.waterTopMat.uniforms.uFlow.value = spout + 0.2;
    S.spillMat.uniforms.uOp.value = st.spill * 0.85; S.spillMat.uniforms.uT.value = t;
    const flowing = L.sluice && st.water > 0.01;
    const outRate = flowing ? clamp(st.water * 6, 0.3, 1) : 0;
    st.outflow = damp(st.outflow || 0, outRate, 3, dt);
    S.troughMat.uniforms.uOp.value = st.outflow * 0.92; S.troughMat.uniforms.uT.value = t;
    S.fallMat.uniforms.uOp.value = st.outflow * 0.88; S.fallMat.uniforms.uT.value = t;
    S.streamMat.uniforms.uT.value = t; S.streamMat.uniforms.uFlow.value = 0.25 + st.outflow * 0.9;

    // the wheel: turns with water; its cam kicks the lift. When the world is in
    // flow the wheel quietly settles onto the same pulse as the wind.
    const camPeriod = 3 * beat;
    const target = flowing ? (Math.PI / camPeriod) * clamp(st.water / 0.12, 0.45, 1) : 0;
    st.wheelW = damp(st.wheelW, target, flowing ? 1.2 : 0.7, dt);
    if (flowing && st.water > 0.12 && flow > 0.3) {
      const want = ((t - G.t0) / camPeriod) * Math.PI + Math.PI * 0.5;
      let e = (st.wheelA - want) % Math.PI; if (e > Math.PI / 2) e -= Math.PI; if (e < -Math.PI / 2) e += Math.PI;
      st.wheelW -= e * 0.6 * dt;
    }
    const prevA = st.wheelA; st.wheelA += st.wheelW * dt;
    S.wheel.rotation.z = -st.wheelA;
    if (Math.floor(st.wheelA / Math.PI) !== Math.floor(prevA / Math.PI) && st.wheelW > 0.2) {
      // a cam fires: the winch jerks
      st.winchKick = t;
      audio.knock(t, 0.55, 0.6);
      if (L.lift && st.critter.s === 'riding' && st.liftMode === 'idle' && st.n < st.N) kick(G);
      else if (Math.random() < 0.5) audio.drip(t, 2 + (Math.random() * 3 | 0));
    }
    const wk = st.winchKick ? clamp(1 - (t - st.winchKick) / 0.5) : 0;
    S.winch.rotation.x = -easeOutCubic(1 - wk) * 0.0 - wk * 0.9;
    // pushrod between wheel crank and winch
    { const a = new THREE.Vector3(4.1 + Math.cos(-st.wheelA) * 0.35, 1.55 + Math.sin(-st.wheelA) * 0.35, 2.15), b = new THREE.Vector3(S.LX - 0.55, 0.55 + 0.25 * Math.cos(S.winch.rotation.x), S.LZ + 0.75);
      S.pushrod.position.copy(a).add(b).multiplyScalar(0.5); S.pushrod.scale.x = a.distanceTo(b); S.pushrod.rotation.z = Math.atan2(b.y - a.y, b.x - a.x); S.pushrod.visible = L.lift; }

    // lift
    updateLift(dt, G);
    updateCritter(dt, G);

    // greenhouse glow, garden blooms, lanterns: the world brightens with flow
    const glow = clamp(st.deliveries / 3) * 0.6 + (st.finale ? 0.4 : 0);
    S.glassM.emissiveIntensity = damp(S.glassM.emissiveIntensity, glow * 0.35, 2, dt);
    S.lamp.material.opacity = damp(S.lamp.material.opacity, glow * 0.55, 2, dt);
    for (const f of S.garden) f.set(damp(f.v, flow > f.thr || st.finale ? 1 : 0, flow > f.thr ? 1.2 : 0.4, dt));
    for (let i = 0; i < S.lanterns.length; i++) S.lanterns[i].material.opacity = damp(S.lanterns[i].material.opacity, flow > 0.55 + i * 0.12 || st.finale ? 0.75 + Math.sin(t * 3 + i) * 0.1 : 0, 2, dt);
    S.bell.update(dt);
    S.birds.update(dt, t);
    S.smoke.update(dt, 0.3 + near);
    S.clouds.userData.update(dt, near * 0.5 + flow * 0.3);
    S.pawl.rotation.z = damp(S.pawl.rotation.z, 0, 6, dt);
  };

  function kick(G) {
    const tA = G.beat; // rise for one beat
    const h = ((7.62 - 0.12) / st.N) * 1.22;
    const g = 2 * h / (tA * tA);
    st.bounce = { t0: G.t, hb: notchY(st.n), g, v0: g * tA, op: G.addOp('apex', G.t + tA, {}), slip: false };
    st.liftMode = 'bounce';
    audio.ratchet(G.t); audio.ratchet(G.t + 0.06);
  }
  function updateLift(dt, G) {
    const t = G.t;
    if (st.liftMode === 'bounce') {
      const b = st.bounce, tau = t - b.t0;
      st.liftY = b.hb + b.v0 * tau - 0.5 * b.g * tau * tau;
      if (st.liftY <= b.hb && tau > 0.1) { st.liftY = b.hb; st.liftMode = 'settle'; st.liftT = t; st.liftV = -1.2; st.bounce = null; audio.knock(t, 0.9, 0.7); }
    } else if (st.liftMode === 'settle') {
      const ty = notchY(st.n);
      st.liftV += (ty - st.liftY) * 120 * dt - st.liftV * 10 * dt; st.liftY += st.liftV * dt;
      if (t - st.liftT > 0.6) { st.liftY = ty; st.liftMode = st.n >= st.N ? 'top' : 'idle'; }
    } else if (st.liftMode === 'descend') {
      st.liftY -= dt * 2.1;
      if (Math.floor(st.liftY * 3) !== Math.floor((st.liftY + dt * 2.1) * 3)) audio.ratchet(t, 0.6);
      if (st.liftY <= notchY(0)) { st.liftY = notchY(0); st.n = 0; st.liftMode = 'idle'; audio.knock(t, 0.8, 0.8); }
    } else if (st.liftMode === 'top' || st.liftMode === 'idle') st.liftY = damp(st.liftY, notchY(st.n), 8, dt);
    S.cage.position.set(S.LX, st.liftY, S.LZ);
    S.cage.visible = st.L.lift || st.L.n >= 3;
    const top = 8.85 - 0.72;
    S.rope1.position.set(S.LX + 0.72, (st.liftY + 1.0 + top) / 2, S.LZ); S.rope1.scale.y = Math.max(0.05, top - st.liftY - 1.0);
    const wy = 0.6 + (7.62 - st.liftY) * 0.9;
    S.weight.position.set(S.LX - 0.72, wy, S.LZ - 0.1);
    S.rope2.position.set(S.LX - 0.72, (wy + 0.25 + top) / 2, S.LZ - 0.1); S.rope2.scale.y = Math.max(0.05, top - wy - 0.25);
    S.pulley.rotation.z = -st.liftY * 1.3;
  }

  // the lantern-bearer's errand
  function walkTo(c, target, dt, speed = 0.95) {
    _p.copy(target).sub(c.pos); _p.y = 0; const d = _p.length();
    if (d < 0.04) return true;
    const stp = Math.min(d, speed * dt); c.pos.addScaledVector(_p.normalize(), stp);
    S.critter.group.rotation.y = damp(S.critter.group.rotation.y, Math.atan2(_p.x, _p.z), 10, dt);
    return false;
  }
  function updateCritter(dt, G) {
    const c = st.critter, t = G.t, L = st.L; let moving = false;
    c.t += dt;
    const CR = S.critter;
    if (!L.lift) { // before the lift is in use, the bearer waits by the basket, watching
      c.pos.copy(S.basket).add(_q.set(0.35, 0, 0.1)); CR.look = -0.25; CR.group.rotation.y = damp(CR.group.rotation.y, -0.6, 3, dt);
      CR.hasSeed = true; CR.hop = Math.max(0, Math.sin(t * 4)) * 0.03 * (st.omega > 1.5 ? 1 : 0);
    } else switch (c.s) {
      case 'basket': CR.hasSeed = c.t > 0.5; if (c.t > 1.0) { c.s = 'toLift'; c.t = 0; } break;
      case 'toLift': {
        const door = S.liftDoor;
        if (walkTo(c, door, dt)) { if (st.liftMode === 'idle' && st.n === 0 && st.liftY < 0.3) { c.s = 'board'; c.t = 0; } else { CR.look = -0.4; CR.hop = Math.max(0, Math.sin(t * 6)) * 0.03; } }
        else moving = true;
        break;
      }
      case 'board': c.pos.lerp(_q.set(S.LX, 0, S.LZ), clamp(c.t * 3)); CR.hop = Math.sin(clamp(c.t * 2) * Math.PI) * 0.25; if (c.t > 0.5) { c.s = 'riding'; c.t = 0; CR.hop = 0; } moving = true; break;
      case 'riding': c.pos.set(S.LX, st.liftY + 0.05, S.LZ); CR.group.rotation.y = damp(CR.group.rotation.y, 0, 4, dt); CR.look = st.liftMode === 'bounce' ? -0.2 : 0;
        if (st.liftMode === 'top') { c.s = 'out'; c.t = 0; c.path = [new THREE.Vector3(S.LX - 0.2, 7.67, -0.3), new THREE.Vector3(S.ghDoor.x, 7.67, S.ghDoor.z), S.pots[st.potK % 6].clone().setY(7.85).add(_q.set(0, 0, 0.3))]; c.pi = 0; }
        break;
      case 'out': {
        const tg = c.path[c.pi]; c.pos.y = damp(c.pos.y, tg.y, 8, dt);
        if (walkTo(c, tg, dt, 0.85)) { c.pi++; if (c.pi >= c.path.length) { c.s = 'plant'; c.t = 0; } } else moving = true;
        break;
      }
      case 'plant':
        CR.look = 0.4 * Math.sin(clamp(c.t / 1.2) * Math.PI);
        if (c.t > 0.6 && CR.hasSeed) { CR.hasSeed = false; deliver(G); }
        if (c.t > 1.6) { c.s = 'back'; c.t = 0; c.path = [new THREE.Vector3(S.ghDoor.x, 7.67, S.ghDoor.z), new THREE.Vector3(S.LX - 0.2, 7.67, -0.3), new THREE.Vector3(S.LX, 7.67, S.LZ)]; c.pi = 0; }
        break;
      case 'back': {
        const tg = c.path[c.pi];
        if (walkTo(c, tg, dt, 1.1)) { c.pi++; if (c.pi >= c.path.length) { c.s = 'down'; c.t = 0; st.liftMode = 'descend'; } } else moving = true;
        break;
      }
      case 'down': c.pos.set(S.LX, st.liftY + 0.05, S.LZ); if (st.liftMode === 'idle' && st.n === 0) { c.s = 'toBasket'; c.t = 0; } break;
      case 'toBasket': if (walkTo(c, S.basket, dt)) { c.s = 'basket'; c.t = 0; } else moving = true; c.pos.y = 0; break;
    }
    CR.group.position.copy(c.pos);
    CR.update(dt, moving);
  }
  function deliver(G) {
    const t = G.t;
    const f = S.flowers[st.potK % 6]; st.potK++;
    st.deliveries++;
    const fl = { f, t0: t };
    st.blooming = fl;
    S.bell.ring(1);
    audio.bloom(t); audio.bell(t + 0.3, 4 + (st.deliveries % 3) * 2, 1);
    audio.chirp(t + 0.5, 4);
    S.birds.startle(S.bell.group.position, 20);
    audio.setChord(st.deliveries % 4);
    G.event('delivery', { pos: S.pots[0] });
    G.focus(S.bell.group.position, 0.3);
    // the flower opens over a second and a half
    const grow = () => { };
    st.bloomList = st.bloomList || []; st.bloomList.push(fl);
  }
  // bloom animation runs in its own tiny loop
  const _upd = W.update;
  W.update = (dt, G) => {
    _upd(dt, G);
    if (st.bloomList) for (const b of st.bloomList) b.f.set(Math.max(b.f.v, clamp((G.t - b.t0) / 1.6)));
  };

  W.audioState = (G) => ({ wind: 0.25 + (st.flut || 0) * 0.6, water: (st.outflow || 0) * 0.8 + (st.spill || 0) * 0.5, hum: st.liftMode === 'bounce' || st.liftMode === 'descend' ? 1 : 0, humPitch: st.liftY / 7.6, bloom: clamp(st.deliveries / 4) });
  W.finale = (G) => { st.finale = true; S.bell.ring(1.5); audio.bell(G.t + 0.2, 7, 1); audio.swell(G.t, 3); S.birds.startle(S.hub, 30); };
  W.endFinale = () => { if (st) st.finale = false; };
  // a point the camera may lean toward when something happens
  W.points = () => ({ hub: S.hub, lift: new THREE.Vector3(S.LX, st ? st.liftY : 0, S.LZ), greenhouse: S.bell.group.position });
  return W;
}

// ---- 06_clock.js ----
// WORLD II — THE CLOCK TOWER
// A pendulum hangs in the arch. Push it at the end of its swing and it keeps
// swinging; push it too often and it bangs against the frame. While it swings,
// the escapement ticks the hands forward and steps a great wheel round. Catch the
// wheel's coral pointer at the top to wind the bell weight. Each quarter hour, a
// wound weight lets the hammer fall: the bell rings and a small automaton bird
// comes out to see. Gusts from the windmill country blow through the arch.
function createClockWorld(THREE, P, E, X, audio) {
  const W = { id: 'clock', numeral: 'II', name: 'The Clock Tower', label: 'CLOCK TOWER', bpm: 72 };
  W.look = {
    sky: { top: '#6fb2d8', mid: '#a9d4e6', horizon: '#f3ead6', sun: '#ffe3b0', sunDir: [0.55, 0.38, -0.7] },
    fog: '#efe7d6', fogNear: 36, fogFar: 175, hemiSky: '#e3ecef', hemiGround: '#b0a070', hemi: 1.0, sunColor: '#ffe6c2', sun: 1.7, sunPos: [16, 22, 18]
  };
  W.frame = { x0: -6.2, x1: 7.0, y0: -0.6, y1: 17.6, cy: 8.2, z: 0, dist: 34 };
  W.dailyTitles = ['Keep the town on time', 'Every quarter, a bell', 'A windy afternoon'];
  const C = {
    stone: 0xe9e1cf, stone2: 0xd8ccb2, stoneDark: 0xb8a88c, plaster: 0xf5eedd, roof: 0xd9876a, roofDark: 0xb86a52, wood: 0x9c7552, woodDark: 0x6b4f3a, woodLight: 0xc19a6b,
    brass: 0xc8a35e, copper: 0xb8774f, rust: 0xc0693f, coral: 0xe0705a, slate: 0x5b7b92, moss: 0x8aa35c, cream: 0xf6efdc, face: 0xf7f1e2
  };
  // amp goal / minutes / weight notches / chimes
  W.levels = [
    { n: 1, title: 'Wake the pendulum', note: 'A swing is easiest to push at the end of its arc.', goal: { type: 'amp' }, escape: false, wheel: false, chimes: false, gusts: 0, win: [0.11, 0.25], startA: 0.12, start: 660, par: 25 },
    { n: 2, title: 'Set the hands moving', note: 'Keep it swinging and the hands keep time.', goal: { type: 'minutes', need: 10 }, escape: true, wheel: false, chimes: false, gusts: 0, win: [0.105, 0.24], startA: 0.5, start: 660, par: 30 },
    { n: 3, title: 'Wind the bell weight', note: 'The coral pointer comes round. Catch it at the top.', goal: { type: 'weight', need: 6 }, escape: true, wheel: true, chimes: false, gusts: 0, win: [0.1, 0.23], startA: 0.6, start: 600, par: 45 },
    { n: 4, title: 'Ring the hour', note: 'The hammer only falls if the weight is wound.', goal: { type: 'chimes', need: 1 }, escape: true, wheel: true, chimes: true, gusts: 0, win: [0.1, 0.22], startA: 0.6, start: 710, weight: 2, par: 45 },
    { n: 5, title: 'A wind through the arch', note: 'The wind does not keep time. You do.', goal: { type: 'chimes', need: 1 }, escape: true, wheel: true, chimes: true, gusts: 0.5, win: [0.095, 0.21], startA: 0.6, start: 705, weight: 1, par: 55 },
    { n: 6, title: 'Keep the quarters', note: 'Every quarter hour wants its bell.', goal: { type: 'chimes', need: 2 }, escape: true, wheel: true, chimes: true, gusts: 0.35, win: [0.09, 0.2], startA: 0.6, start: 5, weight: 2, wheelBeats: 5, par: 70 },
    { n: 7, title: 'Keep time', note: 'Until the light changes.', goal: { type: 'timed', secs: 100 }, escape: true, wheel: true, chimes: true, gusts: 0.4, win: [0.085, 0.19], startA: 0.6, start: 175, weight: 2, wheelBeats: 5, par: 100 }
  ];
  const root = new THREE.Group(); W.root = root;
  const S = {}; let built = false;
  const U = { t: { value: 0 } };

  W.build = (scene) => {
    scene.add(root);
    if (built) return; built = true;
    const mat = P.mat({ brush: 0.14, scale: 1.6 }), matFine = P.mat({ brush: 0.08, scale: 3.5 });
    const ink = P.ink(0x3a3431, 0.03), inkThin = P.ink(0x3a3431, 0.016);
    const pathAt = (x, z) => (z > 1.8 ? smooth(1 - Math.abs(x - Math.sin(z * 0.2) * 0.8) / 1.0) * 0.85 : 0);
    const ground = E.ground({ grass: 0xa8b56c, grass2: 0xb9bf78, dry: 0xd2c28a, path: 0xdccaa0, pathAt, flat: 14, rise: 8 });
    root.add(ground); S.heightAt = ground.userData.heightAt;

    // ---------- the tower ----------
    const tw = new P.Builder(201), rr = makeRng(202);
    const block = (x0, x1, y0, y1, z, d = 0.5, col) => {
      for (let y = y0; y < y1 - 0.01;) {
        const h = Math.min(y1 - y, rr.range(0.45, 0.7));
        for (let x = x0; x < x1 - 0.01;) { const w = Math.min(x1 - x, rr.range(0.6, 1.2)); tw.add(new THREE.BoxGeometry(w - 0.03, h - 0.03, d), col || (rr() < 0.18 ? C.stone2 : C.stone), { p: [x + w / 2, y + h / 2, z] }, { jitter: 0.03, vary: 0.04, shade: 0.06 }); x += w; }
        y += h;
      }
    };
    // core walls (solid, behind the facing blocks)
    tw.add(new THREE.BoxGeometry(1.1, 9, 3.4), C.stone, { p: [-1.75, 4.5, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(1.1, 9, 3.4), C.stone, { p: [1.75, 4.5, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(2.4, 4.35, 3.4), C.stone, { p: [0, 6.82, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(2.4, 4.7, 0.3), C.stone, { p: [0, 2.35, -1.75] }, { shade: 0.15 });
    // front face with the arch cut
    block(-2.3, -1.2, 0, 9, 1.65, 0.3); block(1.2, 2.3, 0, 9, 1.65, 0.3); block(-1.2, 1.2, 4.6, 9, 1.65, 0.3);
    // arch voussoirs
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); tw.add(new THREE.BoxGeometry(0.32, 0.5, 0.42), k % 2 ? C.stone2 : C.stone, { p: [Math.cos(a) * 1.38, 3.45 + Math.sin(a) * 1.38, 1.72], r: [0, 0, a - Math.PI / 2] }, { jitter: 0.02 }); }
    tw.add(new THREE.BoxGeometry(0.42, 0.62, 0.48), C.stone2, { p: [0, 4.9, 1.75] });
    // the arch's dark interior and its machinery
    tw.add(new THREE.BoxGeometry(2.4, 4.6, 0.1), 0x5a4838, { p: [0, 2.3, -1.4] }, { vary: 0, shade: 0.45 });
    tw.add(new THREE.BoxGeometry(0.1, 4.6, 3.0), 0x4a3f38, { p: [-1.2, 2.3, 0.1] }, { vary: 0 }); tw.add(new THREE.BoxGeometry(0.1, 4.6, 3.0), 0x4a3f38, { p: [1.2, 2.3, 0.1] }, { vary: 0 });
    tw.add(new THREE.BoxGeometry(2.4, 0.1, 3.0), 0x4a3f38, { p: [0, 4.62, 0.1] }, { vary: 0 });
    // steps to the arch
    for (let k = 0; k < 3; k++) tw.add(new THREE.BoxGeometry(2.8 - k * 0.3, 0.16, 0.5), C.stoneDark, { p: [0, 0.08 + k * 0.16, 2.6 - k * 0.38] }, { jitter: 0.03 });
    // a round window with a gear behind it
    tw.add(new THREE.TorusGeometry(0.42, 0.09, 6, 16), C.brass, { p: [-1.1, 6.6, 1.82] });
    tw.add(new THREE.CircleGeometry(0.4, 16), 0x3e3530, { p: [-1.1, 6.6, 1.8] }, { vary: 0, shade: 0 });
    tw.add(P.gearGeo(0.32, 10, 0.06, { hole: 0.06 }), C.copper, { p: [-1.1, 6.6, 1.78] });
    // quoins
    for (let y = 0.3; y < 9; y += 0.62) for (const sx of [-1, 1]) tw.add(new THREE.BoxGeometry(0.5, 0.5, 0.5), rr() < 0.4 ? C.stone2 : C.stone, { p: [sx * 2.22, y, 1.55], r: [0, rr.range(-0.05, 0.05), 0] }, { jitter: 0.04 });
    // ledge on brackets
    tw.add(new THREE.BoxGeometry(5.3, 0.16, 2.0), C.woodLight, { p: [0, 9.05, 1.0] });
    for (const x of [-2.1, -0.7, 0.7, 2.1]) { tw.add(new THREE.BoxGeometry(0.16, 0.6, 0.16), C.woodDark, { p: [x, 8.75, 1.6] }); tw.add(new THREE.BoxGeometry(0.12, 0.9, 0.12), C.woodDark, { p: [x, 8.55, 1.2], r: [0.75, 0, 0] }); }
    // clock housing
    tw.add(new THREE.BoxGeometry(3.9, 4.2, 3.0), C.plaster, { p: [0, 11.2, -0.2] }, { jitter: 0.04, shade: 0.1 });
    tw.add(new THREE.BoxGeometry(4.1, 0.22, 3.2), C.stone2, { p: [0, 13.25, -0.2] }, { jitter: 0.03 });
    tw.add(new THREE.CylinderGeometry(1.95, 1.95, 0.25, 32), C.brass, { p: [0, 11.3, 1.32], r: [Math.PI / 2, 0, 0] });
    // the automaton's door under the face
    tw.add(new THREE.BoxGeometry(0.5, 0.42, 0.06), C.slate, { p: [0, 9.42, 1.33] });
    // roof: dusty coral tiles, wide eaves
    const roof = new THREE.ConeGeometry(3.6, 2.0, 4, 1); roof.rotateY(Math.PI / 4);
    tw.add(roof, C.roof, { p: [0, 14.35, -0.2], s: [1, 1, 0.95] }, { shade: 0.25, top: 0xe8a080, topAmt: 0.3 });
    for (let k = 0; k < 9; k++) tw.add(new THREE.BoxGeometry(5.0 - k * 0.52, 0.05, 0.1), C.roofDark, { p: [0, 13.48 + k * 0.21, 2.35 - k * 0.24], r: [0.65, 0, 0] }, { vary: 0.03 });
    // cupola
    for (const [x, z] of [[-0.45, -0.65], [0.45, -0.65], [-0.45, 0.25], [0.45, 0.25]]) tw.add(new THREE.BoxGeometry(0.16, 1.1, 0.16), C.plaster, { p: [x, 15.65, z] });
    tw.add(new THREE.BoxGeometry(1.2, 0.14, 1.2), C.stone2, { p: [0, 15.1, -0.2] });
    const cr = new THREE.ConeGeometry(0.95, 0.75, 4, 1); cr.rotateY(Math.PI / 4);
    tw.add(cr, C.roof, { p: [0, 16.55, -0.2] }, { shade: 0.2 });
    tw.add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), C.brass, { p: [0, 17.2, -0.2] });
    tw.add(new THREE.BoxGeometry(0.34, 0.04, 0.04), C.brass, { p: [0, 17.35, -0.2] });
    root.add(tw.mesh(mat, ink));
    // clock face
    const faceTex = P.canvas(512, 512, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#f6efde'; g.beginPath(); g.arc(c, c, c - 4, 0, TAU); g.fill();
      g.strokeStyle = '#3b3632'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 22, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.arc(c, c, c - 78, 0, TAU); g.stroke();
      for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; const r0 = c - 22, r1 = c - (i % 5 ? 32 : 44); g.lineWidth = i % 5 ? 1.5 : 3; g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); g.stroke(); }
      g.fillStyle = '#3b3632'; g.font = '44px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let h = 1; h <= 12; h++) { const a = h / 12 * TAU, r = c - 64; g.save(); g.translate(c + Math.sin(a) * r, c - Math.cos(a) * r); g.rotate(a); g.fillText(ROMAN[h], 0, 0); g.restore(); }
      const spots = [[0.3, -0.2, 26], [0.15, 0.35, 18], [-0.3, 0.1, 14], [0.45, 0.25, 12]];
      for (const [x, y, r] of spots) { g.fillStyle = 'rgba(224,128,84,0.85)'; g.beginPath(); g.arc(c + x * c, c + y * c, r, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(59,54,50,0.35)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(c, c, 40 + k * 22, 0, TAU); g.stroke(); }
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.72, 48), new THREE.MeshLambertMaterial({ map: faceTex })); face.position.set(0, 11.3, 1.46); root.add(face);
    const hand = (len, w, col) => { const g = new THREE.Group(); const b = new P.Builder(len * 10 | 0); b.add(new THREE.BoxGeometry(w, len, 0.04), col, { p: [0, len / 2 - 0.15, 0] }); b.add(new THREE.ConeGeometry(w * 1.6, 0.22, 4), col, { p: [0, len - 0.05, 0] }); g.add(b.mesh(matFine, null)); g.position.set(0, 11.3, 1.52); root.add(g); return g; };
    S.hourHand = hand(1.0, 0.09, 0x3b3632); S.minHand = hand(1.45, 0.06, C.rust); S.minHand.position.z = 1.56;
    { const b = new P.Builder(210); b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), C.brass, { r: [Math.PI / 2, 0, 0] }); const m = b.mesh(matFine, null); m.position.set(0, 11.3, 1.6); root.add(m); }
    // gears around the face (they step with every tick)
    S.gears = [];
    for (const [x, y, r, n, col] of [[-1.85, 12.85, 0.55, 12, C.copper], [1.95, 9.95, 0.5, 11, C.brass], [-2.05, 9.85, 0.38, 9, C.rust], [1.6, 13.0, 0.36, 9, C.brass]]) {
      const b = new P.Builder(n * 3); b.add(P.gearGeo(r, n, 0.12, { hole: r * 0.2, windows: 4 }), col, {}); b.add(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.2, 8), C.woodDark, { r: [Math.PI / 2, 0, 0] });
      const m = b.mesh(matFine, inkThin); m.position.set(x, y, 1.42); root.add(m); S.gears.push({ m, r });
    }
    // ---------- the pendulum ----------
    S.pend = new THREE.Group(); S.pend.position.set(0, 4.42, 0.3); root.add(S.pend);
    { const b = new P.Builder(220);
      b.add(new THREE.BoxGeometry(0.07, 2.4, 0.07), C.brass, { p: [0, -1.2, 0] });
      b.add(new THREE.BoxGeometry(0.34, 0.12, 0.2), C.woodDark, { p: [0, 0, 0] });
      b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 24), 0xd9b56a, { p: [0, -2.45, 0], r: [Math.PI / 2, 0, 0] });
      b.add(new THREE.TorusGeometry(0.4, 0.045, 6, 24), C.copper, { p: [0, -2.45, 0.07] });
      b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10), C.coral, { p: [0, -2.45, 0.08], r: [Math.PI / 2, 0, 0] });
      S.pend.add(b.mesh(matFine, inkThin)); }
    // stops on either side of the arch: the pendulum bangs these if pushed too hard
    S.stops = [];
    for (const sx of [-1, 1]) { const b = new P.Builder(230 + sx); b.add(new THREE.BoxGeometry(0.16, 0.5, 0.3), C.woodDark, {}); b.add(new THREE.BoxGeometry(0.1, 0.3, 0.32), C.coral, { p: [-sx * 0.1, 0, 0] }); const m = b.mesh(matFine, null); m.position.set(sx * 1.1, 2.15, 0.3); root.add(m); S.stops.push(m); }
    // the pusher: a little arm on each side that nudges the bob
    S.pushers = [];
    for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 1.13, 1.55, 0.5); const b = new P.Builder(240 + sx); b.add(new THREE.BoxGeometry(0.5, 0.07, 0.07), C.brass, { p: [-sx * 0.25, 0, 0] }); b.add(new THREE.SphereGeometry(0.07, 6, 4), C.coral, { p: [-sx * 0.5, 0, 0] }); g.add(b.mesh(matFine, null)); root.add(g); S.pushers.push({ g, sx, t: -9 }); }
    S.archGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffc777, transparent: true, opacity: 0.55, depthWrite: false })); S.archGlow.position.set(0, 2.6, -1.1); S.archGlow.scale.set(3.4, 3.4, 1); root.add(S.archGlow);
    // back gears inside the arch
    for (const [x, y, r, n] of [[0.55, 3.6, 0.42, 10], [-0.6, 3.9, 0.3, 8]]) { const b = new P.Builder(n * 7); b.add(P.gearGeo(r, n, 0.1, { hole: r * 0.2 }), C.copper, {}); const m = b.mesh(matFine, null); m.position.set(x, y, -1.25); root.add(m); S.gears.push({ m, r, back: true }); }
    // ---------- the great wheel ----------
    S.wheel = new THREE.Group(); S.wheel.position.set(3.25, 10.7, 0.95); root.add(S.wheel);
    { const b = new P.Builder(250); P.wheel(b, C.rust, {}, 1.85, 10, 0.16, { rim: 0.11, hubColor: C.brass });
      b.add(new THREE.TorusGeometry(1.55, 0.04, 4, 30), C.brass, {});
      for (let k = 0; k < 40; k++) { const a = k / 40 * TAU; b.add(new THREE.BoxGeometry(0.14, 0.18, 0.15), C.copper, { p: [Math.cos(a) * 1.98, Math.sin(a) * 1.98, 0], r: [0, 0, a] }); }
      S.wheel.add(b.mesh(matFine, inkThin)); }
    S.pointer = new THREE.Group(); S.wheel.add(S.pointer);
    { const b = new P.Builder(251); b.add(new THREE.BoxGeometry(0.1, 0.9, 0.08), C.coral, { p: [0, 1.35, 0.12] }); b.add(new THREE.ConeGeometry(0.2, 0.42, 3), C.coral, { p: [0, 1.95, 0.12] }); S.pointer.add(b.mesh(matFine, inkThin)); }
    // pawl at the top that catches the pointer
    S.pawl = new THREE.Group(); S.pawl.position.set(3.25, 12.95, 1.15); root.add(S.pawl);
    { const b = new P.Builder(252); b.add(new THREE.BoxGeometry(0.1, 0.55, 0.1), C.brass, { p: [0, -0.22, 0] }); b.add(new THREE.SphereGeometry(0.08, 6, 4), C.coral, { p: [0, -0.5, 0] }); S.pawl.add(b.mesh(matFine, inkThin)); }
    { const b = new P.Builder(253);
      b.add(new THREE.BoxGeometry(0.3, 0.3, 0.8), C.woodDark, { p: [3.25, 13.05, 0.75] }); b.add(new THREE.BoxGeometry(1.4, 0.18, 0.18), C.woodDark, { p: [2.6, 13.05, 0.4] });
      b.add(new THREE.BoxGeometry(0.2, 0.2, 1.3), C.woodDark, { p: [3.25, 10.7, 0.3] });
      // pipes down the right side, with a drip at the end
      b.add(P.tube([[2.3, 10.2, 0.6], [2.9, 9.0, 0.95], [3.1, 6.0, 1.05], [3.1, 2.5, 1.05], [2.9, 1.5, 1.2], [2.6, 1.25, 1.6]], 0.13, 40, 7), C.copper, {});
      b.add(P.tube([[2.35, 8.0, 1.2], [2.8, 7.5, 1.25], [3.55, 7.4, 1.2], [3.85, 7.0, 1.2]], 0.1, 24, 6), C.brass, {});
      for (const y of [8.4, 5.5, 3.0]) b.add(new THREE.TorusGeometry(0.17, 0.05, 4, 10), C.slate, { p: [3.08, y, 1.05], r: [Math.PI / 2, 0, 0] });
      root.add(b.mesh(matFine, inkThin)); }
    S.dripSpot = new THREE.Vector3(3.85, 6.9, 1.2);
    S.drip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0x8fd0cc, fog: true })); root.add(S.drip);
    // ---------- the bell weight on its chain ----------
    S.wPulley = new THREE.Group(); S.wPulley.position.set(-2.75, 8.75, 1.3); root.add(S.wPulley);
    { const b = new P.Builder(260); P.wheel(b, C.brass, {}, 0.32, 6, 0.08, { rim: 0.05 }); S.wPulley.add(b.mesh(matFine, null)); }
    { const b = new P.Builder(261); b.add(new THREE.BoxGeometry(0.6, 0.12, 0.12), C.woodDark, { p: [-2.45, 8.75, 1.3] });
      // notch marks on the wall, the weight's measure
      for (let k = 0; k <= 6; k++) b.add(new THREE.BoxGeometry(0.22, 0.05, 0.02), k % 3 ? 0x8a7a68 : C.coral, { p: [-2.42, 1.4 + k * 1.0, 1.68] }, { vary: 0 });
      root.add(b.mesh(matFine, null)); }
    S.weightM = new THREE.Mesh((() => { const b = new P.Builder(262); b.add(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8), C.stoneDark, {}); b.add(new THREE.TorusGeometry(0.08, 0.025, 4, 8), C.brass, { p: [0, 0.36, 0] }); return b.build(); })(), mat); root.add(S.weightM);
    S.chainM = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4), new THREE.MeshBasicMaterial({ color: 0x6d6258, fog: true })); root.add(S.chainM);
    // ---------- bell and automaton ----------
    S.bell = X.bell(1.5); S.bell.group.position.set(0, 16.05, -0.2); root.add(S.bell.group);
    S.hammer = new THREE.Group(); S.hammer.position.set(0.5, 15.9, -0.2); root.add(S.hammer);
    { const b = new P.Builder(270); b.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), C.woodDark, { p: [0, -0.2, 0] }); b.add(new THREE.SphereGeometry(0.07, 6, 4), C.brass, { p: [0, -0.42, 0] }); S.hammer.add(b.mesh(matFine, null)); }
    S.auto = new THREE.Group(); S.auto.position.set(0, 9.42, 1.2); root.add(S.auto);
    { const b = new P.Builder(271); b.add(new THREE.SphereGeometry(0.15, 10, 8), C.coral, { s: [1.2, 1, 1] }); b.add(new THREE.SphereGeometry(0.09, 8, 6), C.coral, { p: [0.12, 0.13, 0] }); b.add(new THREE.ConeGeometry(0.035, 0.12, 5), C.brass, { p: [0.24, 0.13, 0], r: [0, 0, -Math.PI / 2] }); b.add(new THREE.BoxGeometry(0.03, 0.24, 0.03), C.brass, { p: [0, -0.2, 0] });
      S.auto.add(b.mesh(matFine, inkThin)); }
    // ---------- the little world around ----------
    S.keeper = X.caretaker({ coat: 0x7a5a6e, hat: 0xe2c06e }); S.keeper.group.position.set(-2.9, 0, 2.6); S.keeper.group.rotation.y = 0.6; root.add(S.keeper.group);
    const pr = new P.Builder(280);
    // ladder leaning on the tower
    for (const dx of [-0.2, 0.2]) pr.add(new THREE.BoxGeometry(0.06, 4.2, 0.06), C.woodLight, { p: [-3.25 + dx, 2.0, 1.85], r: [0.18, 0, 0] });
    for (let k = 0; k < 9; k++) pr.add(new THREE.BoxGeometry(0.42, 0.04, 0.04), C.woodLight, { p: [-3.25, 0.3 + k * 0.45, 2.2 - k * 0.08] });
    pr.add(new THREE.BoxGeometry(0.7, 0.5, 0.6), C.woodLight, { p: [-3.9, 0.25, 2.3], r: [0, 0.3, 0] });
    pr.add(new THREE.BoxGeometry(0.5, 0.4, 0.5), C.wood, { p: [-3.8, 0.7, 2.25], r: [0, -0.2, 0] });
    // benches, a lamp post, a low wall
    pr.add(new THREE.BoxGeometry(1.3, 0.08, 0.4), C.wood, { p: [4.6, 0.45, 3.2], r: [0, -0.3, 0] });
    for (const dx of [-0.5, 0.5]) pr.add(new THREE.BoxGeometry(0.08, 0.45, 0.35), C.woodDark, { p: [4.6 + dx * 0.95, 0.22, 3.2 - dx * 0.3], r: [0, -0.3, 0] });
    pr.add(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6), C.slate, { p: [-5.0, 1.2, 3.4] });
    pr.add(new THREE.BoxGeometry(0.28, 0.32, 0.28), C.brass, { p: [-5.0, 2.5, 3.4] });
    for (let k = 0; k < 10; k++) pr.add(new THREE.BoxGeometry(0.9, 0.45, 0.45), k % 3 ? C.stone2 : C.stone, { p: [3.0 + k * 0.85, 0.22, -2.6 + Math.sin(k) * 0.2] }, { jitter: 0.06 });
    // a little house and a fountain
    pr.add(new THREE.BoxGeometry(2.4, 2.0, 2.0), C.cream, { p: [6.6, 1.0, -4.5], r: [0, -0.3, 0] }, { jitter: 0.05 });
    const hr = new THREE.ConeGeometry(2.0, 1.2, 4); hr.rotateY(Math.PI / 4);
    pr.add(hr, C.roof, { p: [6.6, 2.6, -4.5], r: [0, -0.3, 0], s: [1.3, 1, 1] });
    pr.add(new THREE.CylinderGeometry(0.9, 1.0, 0.45, 14), C.stone2, { p: [-4.3, 0.22, 5.0] }, { jitter: 0.03 });
    pr.add(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 8), C.stone, { p: [-4.3, 0.7, 5.0] });
    root.add(pr.mesh(mat, ink));
    S.fountain = new THREE.Mesh(new THREE.CircleGeometry(0.82, 18), waterMaterial(THREE, { scale: 0.6, speed: 0.3 })); S.fountain.rotation.x = -Math.PI / 2; S.fountain.position.set(-4.3, 0.42, 5.0); root.add(S.fountain);
    const fb = new P.Builder(290), tb = new P.Builder(291);
    E.tree(tb, fb, 4.6, 0, -0.8, 1.6, 21); E.tree(tb, fb, -5.4, 0, -1.8, 1.3, 22); E.tree(tb, fb, -9, 0.3, -5, 1.7, 23); E.tree(tb, fb, 9.5, 0.3, 1.2, 1.3, 24); E.tree(tb, fb, -2.6, 0, -4.2, 1.1, 25);
    const bush = (x, z, s, seed) => { const r = makeRng(seed); for (let i = 0; i < 3; i++) fb.add(P.blob(r.range(0.35, 0.55) * s, seed * 3 + i), r.pick([0x8a9a5b, 0x93a663, 0x9fb06a]), { p: [x + r.range(-0.4, 0.4) * s, 0.25 * s, z + r.range(-0.3, 0.3) * s] }, { shade: 0.35, top: 0xd4c87a, topAmt: 0.4 }); };
    bush(2.7, 2.2, 1.1, 31); bush(-2.4, 2.6, 0.9, 32); bush(-6.2, 1.8, 1.2, 33); bush(6.0, 0.6, 1.0, 34);
    S.foliage = new THREE.Mesh(fb.build(), E.foliageMat()); S.foliage.castShadow = true; root.add(S.foliage);
    root.add(tb.mesh(mat, inkThin));
    // a distant windmill, turning on the hill: world I, seen from here
    S.farMill = new THREE.Group(); S.farMill.position.set(-15, 3.2, -58); S.farMill.scale.setScalar(1.3); root.add(S.farMill);
    { const b = new P.Builder(300); b.add(P.tower(1.6, 1.1, 6, 8, 3), 0xcfd2c6, { p: [0, 3, 0] }); b.add(new THREE.ConeGeometry(1.3, 1.6, 8), 0x8ea3b0, { p: [0, 6.7, 0] }); S.farMill.add(new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }))); }
    S.farSails = new THREE.Group(); S.farSails.position.set(0, 6.3, 1.3); S.farMill.add(S.farSails);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 4.2), new THREE.MeshBasicMaterial({ color: 0xe6dcb6, fog: true, side: THREE.DoubleSide })); m.geometry.translate(0.3, 2.2, 0); m.rotation.z = k * Math.PI / 2; S.farSails.add(m); }
    root.add(E.grass({ count: 3600, x0: -20, x1: 14, z0: -8, z1: 12, root: 0x93a85e, tip: 0xdcd590, tip2: 0xeedfa4, scale: 0.75, heightAt: S.heightAt, seed: 9,
      accept: (x, z, r) => (z < 6 || r() < 0.45) && pathAt(x, z) < 0.3 && !(Math.abs(x) < 2.8 && z < 3.2 && z > -2) && Math.hypot(x + 4.3, z - 5) > 1.2 }));
    root.add(E.wildflowers({ count: 600, x0: -18, x1: 12, z0: -6, z1: 12, heightAt: S.heightAt, accept: (x, z) => pathAt(x, z) < 0.2 && !(Math.abs(x) < 2.8 && z < 3.2) }));
    root.add(E.layers([
      { kind: 'hills', seed: 17, w: 280, y: 16, z: -120, color: 0xbccbb6 },
      { kind: 'town', seed: 19, w: 220, y: 9, z: -85, color: 0xb1bea7, order: 1 },
      { kind: 'hills', seed: 23, w: 200, y: 5, z: -70, color: 0xa9ba98, order: 2 }
    ]));
    S.clouds = E.clouds({ count: 11, y0: 16, y1: 70, seed: 9 }); root.add(S.clouds);
    S.birds = E.birds(root, [[-1.6, 13.52, 1.1], [-0.9, 13.5, 1.6], [1.2, 9.2, 1.9], [2.0, 9.2, 1.75], [3.25, 12.9, 0.9]], 0x4b4f5c);
    S.ribbons = E.ribbons(root); S.leaves = E.leaves(root, 60);
    S.gustCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-20, 1.5, 7), new THREE.Vector3(-11, 2.0, 5), new THREE.Vector3(-4.5, 2.4, 3.2), new THREE.Vector3(-0.4, 2.6, 1.0), new THREE.Vector3(4, 3.4, -1.5)]);
    S.lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false })); S.lamp.position.set(-5.0, 2.55, 3.45); S.lamp.scale.set(1.4, 1.4, 1); root.add(S.lamp);
  };

  // ---------- simulation ----------
  let st = null;
  const MAXA = 0.27; // radians at full amplitude
  W.begin = (L, G) => {
    S.ribbons.clear(); S.leaves.clear();
    st = { L, A: L.startA, phase: 0, period: 2 * G.beat, minutes: L.start || 0, startMin: L.start || 0, weight: L.weight || 0, wheelSteps: 0, wheelA: 0, wheelTarget: 0,
      chimes: 0, hours: 0, waiting: false, autoT: -9, bang: 0, pushes: 0, gusts: [], nextGust: 6 + G.rng() * 4, lastPushT: 0, finale: false, latches: 0, lastTick: 0, ticks: 0, hammerT: -9, nextOps: [], dripT: 0 };
    // start the swing so its extremes land on the pulse
    st.phase = Math.PI / 2 - ((G.t0 - G.t) / st.period) * TAU;
    S.keeper.sit = 0;
    if (S.weightM) S.weightM.position.y = weightY();
  };
  const weightY = () => 1.4 + st.weight * 1.0;
  // the time (after `from`) of the next extreme of the swing
  function nextExtreme(from, G) {
    const w = TAU / st.period; let ph = st.phase + (from - G.t) * w;
    const k = Math.ceil((ph - Math.PI / 2) / Math.PI - 1e-6);
    const target = Math.PI / 2 + k * Math.PI;
    return { t: from + (target - ph) / w, side: (k % 2 === 0) ? 1 : -1 };
  }
  // keep ops for the next two extremes (optional pushes) and the wheel's pointer
  function schedule(G) {
    const L = st.L;
    // drop future pushes if the swing changed under them
    for (const op of st.nextOps) if (!op.done && op.stale) op.done = true;
    st.nextOps = st.nextOps.filter(o => !o.done);
    const have = st.nextOps.filter(o => o.kind === 'push').length;
    if (st.A > 0.03 && have < 2) {
      let from = G.t; const last = st.nextOps.filter(o => o.kind === 'push').pop(); if (last) from = last.t + 0.05;
      for (let i = have; i < 2; i++) { const e = nextExtreme(from, G); const op = G.addOp('push', e.t, { side: e.side }); op.optional = true; st.nextOps.push(op); from = e.t + 0.05; }
    }
  }
  function swingShift(G, dphi) {
    st.phase += dphi;
    for (const op of st.nextOps) if (!op.done && op.kind === 'push') op.done = true;
    st.nextOps = st.nextOps.filter(o => o.kind !== 'push');
  }

  W.resolve = (op, res, d, G) => {
    const t = G.t;
    if (op.kind === 'push') {
      const pu = S.pushers[op.data.side > 0 ? 1 : 0]; pu.t = t;
      const gain = { flow: 0.17, good: 0.1, early: -0.06, late: 0.03 }[res] || 0;
      st.A = Math.max(0, st.A + gain); st.lastPushT = t; st.pushes++;
      if (res === 'flow' || res === 'good') { audio.knock(t, 1.6, 0.6); audio.catchFlow(t, res === 'flow' ? 0.8 : 0.5); }
      else if (res === 'early') { audio.knock(t, 0.7, 0.9); }
      else audio.knock(t, 1.0, 0.5);
      if (st.A > 1.06) { st.A = 0.82; st.bang = 1; audio.knock(t + 0.03, 0.5, 1.2); audio.ratchet(t + 0.05, 1); G.event('overswing'); S.birds.startle(S.pend.position, 4); }
    } else if (op.kind === 'latch') {
      if (res === 'flow' || res === 'good') { st.weight = Math.min(6, st.weight + 1); st.latches++; audio.latch(t, res === 'flow' ? 1 : 0.7, st.weight * 2); S.pawl.rotation.z = -0.6; G.focus(S.pawl.position, 0.2); }
      else { if (st.weight > 0) st.weight -= 1; audio.ratchet(t); audio.ratchet(t + 0.07); audio.knock(t + 0.1, 0.8, 0.8); S.pawl.rotation.z = 0.5; }
    }
  };
  W.passed = (op, G) => {
    if (op.kind === 'latch' && st.weight > 0 && st.L.wheel) { st.weight -= 1; audio.ratchet(G.t); }
  };
  W.idle = (G) => { const side = Math.sin(st.phase) > 0 ? 1 : 0; S.pushers[side].t = G.t; audio.knock(G.t, 1.2, 0.4); st.A = Math.max(0, st.A - 0.02); };
  W.objective = (G) => {
    const g = st.L.goal;
    if (g.type === 'amp') return { ticks: Math.min(5, Math.floor(st.A / 0.85 * 5 + 0.001)), need: 5, done: st.A >= 0.85 };
    if (g.type === 'minutes') { const m = st.minutes - st.startMin; return { ticks: Math.min(5, Math.floor(m / 2)), need: 5, done: m >= g.need }; }
    if (g.type === 'weight') return { ticks: st.weight, need: g.need, done: st.weight >= g.need };
    if (g.type === 'chimes') return { ticks: st.chimes, need: g.need, done: st.chimes >= g.need };
    return { ticks: st.chimes, need: 0, done: false, timed: true };
  };
  W.stats = () => ({ hours: st.chimes, weight: st.weight, minutes: Math.round(st.minutes - st.startMin) });
  W._st = () => st;
  W.hint = () => null;
  W.botWants = op => op.kind !== 'push' || st.A < (st.L.goal.type === 'amp' ? 0.88 : 0.7);
  W.discovery = L => ({ 1: 'the pendulum', 3: 'the great wheel', 4: 'the hour bell', 5: 'wind in the arch' })[L.n] || null;

  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  W.update = (dt, G) => {
    const t = G.t, L = st.L, flow = G.flow;
    U.t.value = t; E.windU.uTime.value = t; E.windU.uBase.value = 0.1 + flow * 0.1;
    // the swing: a fixed period, an amplitude that slowly fades
    st.A = Math.max(0, st.A - (0.03 + 0.05 * st.A) * dt * (st.finale ? 0 : 1));
    if (st.finale) st.A = damp(st.A, 0.85, 1, dt);
    const prevPh = st.phase;
    st.phase += (TAU / st.period) * dt;
    // in flow, the swing quietly settles back onto the shared pulse
    if (flow > 0.4 && st.A > 0.3) { const want = Math.PI / 2 + ((t - G.t0) / st.period) * TAU; let e = (st.phase - want) % Math.PI; if (e > Math.PI / 2) e -= Math.PI; if (e < -Math.PI / 2) e += Math.PI; st.phase -= e * 0.4 * dt; }
    st.bang = damp(st.bang, 0, 4, dt);
    const ang = Math.sin(st.phase) * st.A * MAXA;
    S.pend.rotation.z = ang + Math.sin(t * 40) * st.bang * 0.03;
    S.stops.forEach((s, i) => { s.position.x = (i ? 1 : -1) * (1.1 - st.bang * 0.04); });
    for (const pu of S.pushers) { const k = clamp(1 - (t - pu.t) / 0.35); pu.g.rotation.z = -pu.sx * Math.sin(k * Math.PI) * 0.5; }
    // each extreme of a live swing is a tick of the escapement
    const crossed = Math.floor((st.phase - Math.PI / 2) / Math.PI) !== Math.floor((prevPh - Math.PI / 2) / Math.PI);
    const running = L.escape && st.A > 0.3;
    if (crossed && st.A > 0.05) {
      if (running) {
        st.ticks++; audio.tick(t, st.ticks % 2 === 0);
        st.minutes += 0.5; st.lastTick = t;
        if (L.wheel) stepWheel(G);
        if (L.chimes && Math.floor(st.minutes) % 15 === 0 && Math.floor(st.minutes) !== st.lastQuarter && st.minutes % 1 === 0) { st.lastQuarter = Math.floor(st.minutes); st.waiting = true; }
      } else if (st.A > 0.12) audio.tick(t, true);
    }
    // a waiting hammer falls the moment the weight allows it
    if (st.waiting) {
      const cost = Math.round(st.minutes) % 60 === 0 ? 3 : 2;
      S.hammer.rotation.z = damp(S.hammer.rotation.z, -0.9 + Math.sin(t * 20) * 0.04, 6, dt);
      if (st.weight >= cost) { st.weight -= cost; st.waiting = false; chime(G, cost === 3); }
    } else S.hammer.rotation.z = damp(S.hammer.rotation.z, 0, 8, dt);
    // the hands
    const m = st.minutes;
    S.minHand.rotation.z = damp(S.minHand.rotation.z, -(m / 60) * TAU, 18, dt);
    S.hourHand.rotation.z = -(m / 720) * TAU;
    for (const g of S.gears) g.m.rotation.z = damp(g.m.rotation.z, (g.back ? -1 : 1) * st.ticks * (0.5 / g.r) * 0.3, 14, dt);
    // great wheel steps toward its target; the pointer's arrival is an op
    S.wheel.rotation.z = damp(S.wheel.rotation.z, -st.wheelA, 10, dt);
    S.pawl.rotation.z = damp(S.pawl.rotation.z, st.pointerNear ? 0.25 + Math.sin(t * 22) * 0.04 : 0, 8, dt);
    // weight and chain
    S.weightM.position.set(-2.95, damp(S.weightM.position.y || weightY(), weightY(), 5, dt), 1.3);
    const cy = S.weightM.position.y + 0.3, top = 8.55;
    S.chainM.position.set(-2.95, (cy + top) / 2, 1.3); S.chainM.scale.y = Math.max(0.05, top - cy);
    S.wPulley.rotation.z = -S.weightM.position.y * 2;
    // the automaton bird
    const at = t - st.autoT;
    const out = at < 3.2 ? smooth(at / 0.5) * (1 - smooth((at - 2.6) / 0.6)) : 0;
    S.auto.position.z = 1.2 + out * 0.55; S.auto.rotation.y = Math.sin(at * 6) * 0.3 * out; S.auto.visible = out > 0.02;
    // gusts through the arch (they push the swing off its pulse)
    if (L.gusts && G.playing && !st.finale) {
      if (t > st.nextGust) { spawnGust(G); st.nextGust = t + lerp(9, 5, L.gusts) + G.rng() * 5; }
    }
    const gU = E.windU.uG.value; let gi = 0, near = 0;
    for (let i = st.gusts.length - 1; i >= 0; i--) {
      const g = st.gusts[i], s = (t - g.t0) / (g.tA - g.t0);
      if (s > 1.7) { S.ribbons.release(g); st.gusts.splice(i, 1); continue; }
      const fade = (s < 0.15 ? s / 0.15 : 1) * clamp(1 - (s - 1.2) * 2);
      S.ribbons.draw(g, s, fade, t);
      g.curve.getPointAt(clamp(s), _p);
      if (gi < 4) { gU[gi].set(_p.x, 0.9 * fade, 1, 3); gi++; }
      if (s < 1 && Math.random() < dt * 14) S.leaves.emit(_p, _q.set(5, 0.4, -0.6), 1, 1.2);
      if (s < 1) near = Math.max(near, smooth((s - 0.5) / 0.5));
      if (!g.hit && s >= 0.78) { g.hit = true; const shove = G.rng.range(0.5, 1.1) * G.rng.sign(); swingShift(G, shove); st.A = Math.min(1, st.A + 0.05); audio.whooshPast(t); S.birds.startle(S.pend.position, 3); }
    }
    for (; gi < 4; gi++) gU[gi].set(0, 0, 1, 1);
    S.leaves.update(dt, near > 0 ? 5 : 0.3);
    schedule(G);
    if (L.wheel) scheduleLatch(G);
    // keeper watches the swing; sits if it stops
    const K = S.keeper; K.look = damp(K.look, -0.4 + ang * 0.8, 4, dt);
    if (st.A < 0.08 && G.playing && t - st.lastPushT > 10) K.sit = damp(K.sit, 1, 2, dt); else K.sit = damp(K.sit, 0, 4, dt);
    K.cheer = damp(K.cheer, st.finale ? 0.5 + 0.5 * Math.sin(t * 6) : 0, 4, dt); K.update(dt);
    // drip from the pipe, ticking on its own little time
    st.dripT += dt; const dp = st.dripT / 1.7; S.drip.position.set(S.dripSpot.x, S.dripSpot.y - Math.pow(dp % 1, 2) * 6.4, S.dripSpot.z); S.drip.visible = (dp % 1) < 0.95;
    if (Math.floor(dp) !== Math.floor((st.dripT - dt) / 1.7)) audio.drip(t, 3 + (Math.floor(dp) % 3));
    S.fountain.material.uniforms.uT.value = t;
    S.farSails.rotation.z += dt * (0.4 + flow * 1.2);
    S.lamp.material.opacity = damp(S.lamp.material.opacity, flow > 0.6 || st.finale ? 0.7 : 0, 2, dt);
    S.archGlow.material.opacity = 0.4 + st.A * 0.3 + Math.sin(t * 2.3) * 0.03;
    S.bell.update(dt); S.birds.update(dt, t);
    S.clouds.userData.update(dt, flow * 0.3);
  };
  function stepWheel(G) {
    const per = st.L.wheelBeats || 6;
    st.wheelSteps++; st.wheelA = (st.wheelSteps / per) * TAU;
    audio.ratchet(G.t, 0.5);
  }
  // when the pointer is one step from the top, the next tick brings it there
  function scheduleLatch(G) {
    const per = st.L.wheelBeats || 6;
    const stepsToTop = (per - (st.wheelSteps % per)) % per;
    st.pointerNear = stepsToTop === 1 && st.A > 0.3;
    if (stepsToTop === 1 && st.A > 0.3 && (!st.latchOp || st.latchOp.done) && st.latchFor !== st.wheelSteps) {
      const e = nextExtreme(G.t + 0.02, G);
      st.latchOp = G.addOp('latch', e.t, {}); st.latchFor = st.wheelSteps;
    }
    // if the swing died before the pointer arrived, the moment is gone
    if (st.latchOp && !st.latchOp.done && st.A <= 0.3) { st.latchOp.done = true; }
  }
  function spawnGust(G) {
    const lead = 2.6 * G.beat;
    const g = { t0: G.t, tA: G.t + lead, curve: S.gustCurve };
    S.ribbons.spawn(g, 4, 0xf3c45a); audio.gust(g.tA, lead, 1, false);
    st.gusts.push(g);
  }
  function chime(G, hour) {
    const t = G.t;
    st.chimes++; st.autoT = t;
    S.bell.ring(hour ? 1.6 : 1.1); S.hammer.rotation.z = 0.5;
    for (let k = 0; k < (hour ? 3 : 2); k++) audio.bell(t + k * G.beat, [0, 4, 2][k] + 3, hour ? 1.2 : 0.9);
    audio.chirp(t + 0.6, 4); audio.setChord(st.chimes % 4); if (hour) audio.swell(t, 3);
    S.birds.startle(S.bell.group.position, 30);
    G.event('hour');
    G.focus(S.bell.group.position, 0.3);
  }
  W.audioState = () => ({ wind: 0.18 + (st.gusts.length ? 0.4 : 0), water: 0.15, hum: 0, humPitch: 0, bloom: clamp(st.chimes / 3) });
  W.finale = (G) => { st.finale = true; S.bell.ring(1.5); audio.bell(G.t + 0.2, 7, 1); audio.swell(G.t, 3); st.autoT = G.t; S.birds.startle(S.bell.group.position, 40); };
  W.points = () => ({ hub: S.pend.position });
  return W;
}

// ---- 07_ui.js ----
// The caretaker's field notebook: every piece of UI is a small printed or
// pencilled object, never a dashboard.
const PAPER_NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.22 0 0 0 .09 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";
const UI_CSS = `
.twk{--ink:#2f3a48;--char:#3b3835;--paper:#f5efe2;--paper2:#ece3d0;--dust:#c9a24e;--coral:#d4664f;--sky:#e9f1ef;
  --st:0px;--sb:120px;--sl:0px;--sr:0px;font-family:'TWK Sans',system-ui,-apple-system,sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.twk *{box-sizing:border-box}
.twk .serif{font-family:'TWK Serif','Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300}
.twk .disp{font-family:'TWK Display','DM Serif Display',Georgia,serif;font-style:italic;font-weight:400}
.twk .mono{font-family:'TWK Mono','Space Mono',ui-monospace,Menlo,monospace}
.twk .fade{transition:opacity .6s ease, transform .6s ease}
.twk .hide{opacity:0!important;pointer-events:none!important}
.twk .hide *{pointer-events:none!important}
/* ---- HUD ---- */
.twk-hud{position:absolute;inset:0;pointer-events:none}
.twk-label{position:absolute;left:calc(var(--sl) + 18px);top:calc(var(--st) + 14px);display:flex;flex-direction:column;gap:6px;max-width:62%}
.twk-tag{display:flex;align-items:center;gap:7px;font-size:10px;letter-spacing:.24em;color:var(--ink);opacity:.82}
.twk-tag svg{width:15px;height:15px;flex:none}
.twk-tag .sl{opacity:.45;letter-spacing:0}
.twk-rule{height:1px;width:132px;background:linear-gradient(90deg,rgba(47,58,72,.55),rgba(47,58,72,0))}
.twk-obj{font-size:17px;line-height:1.15;color:var(--char);text-shadow:0 0 12px rgba(245,240,228,.85),0 0 2px rgba(245,240,228,.9)}
.twk-ticks{display:flex;gap:5px;align-items:center;height:14px;margin-top:1px}
.twk-ticks i{display:block;width:2px;height:12px;border-radius:1px;background:rgba(47,58,72,.2);transform:rotate(8deg);transition:background .4s,transform .4s,height .4s}
.twk-ticks i.on{background:var(--ink);height:14px;transform:rotate(14deg)}
.twk-ticks i.cross{width:2px;height:22px;transform:rotate(66deg);margin-left:-18px;background:var(--coral)}
.twk-ticks .t{font-size:11px;letter-spacing:.12em;margin-left:6px;opacity:.75}
.twk-note{font-size:14px;color:var(--char);opacity:.9;max-width:240px;line-height:1.25;text-shadow:0 0 10px rgba(245,240,228,.9)}
.twk-pause{position:absolute;right:calc(var(--sr) + 8px);top:calc(var(--st) + 6px);width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:auto;opacity:.55;transition:opacity .3s;cursor:pointer}
.twk-pause:active{opacity:1}
.twk-pause svg{width:20px;height:20px}
.twk-flow{position:absolute;left:calc(var(--sl) + 8px);bottom:calc(var(--sb) + 0px);display:flex;align-items:center;gap:10px;padding:8px 18px 8px 8px;border-radius:40px;background:radial-gradient(closest-side,rgba(245,240,228,.82),rgba(245,240,228,.55) 60%,rgba(245,240,228,0))}
.twk-flow svg{width:50px;height:50px;overflow:visible;filter:drop-shadow(0 1px 2px rgba(245,240,228,.7))}
.twk-ctr{display:flex;flex-direction:column;gap:3px}
.twk-num{display:flex;font-size:12px;line-height:1;height:14px;overflow:hidden;color:var(--ink)}
.twk-num span{display:block;width:9px;height:14px;overflow:hidden;position:relative;border-right:1px solid rgba(47,58,72,.12)}
.twk-num span:last-child{border-right:0}
.twk-num span b{display:block;font-weight:400;position:absolute;left:1px;top:0;transition:transform .45s cubic-bezier(.3,1.4,.5,1);white-space:pre;line-height:14px}
.twk-sub{font-size:9px;letter-spacing:.22em;opacity:.6}
.twk-say{position:absolute;left:0;right:0;bottom:calc(var(--sb) + 64px);text-align:center;font-size:21px;color:var(--char);opacity:0;transform:translateY(6px);transition:opacity 1s ease,transform 1.2s ease;text-shadow:0 0 14px rgba(245,240,228,.95)}
.twk-say.on{opacity:.92;transform:none}
.twk-touch{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.2px solid rgba(47,58,72,.55);pointer-events:none;animation:twkTouch .5s ease-out forwards}
@keyframes twkTouch{from{transform:scale(.4);opacity:.9}to{transform:scale(1.25);opacity:0}}
.twk-hint{position:absolute;inset:0;pointer-events:none}
.twk-hint svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.twk-hint .lbl{position:absolute;font-size:17px;color:var(--char);text-shadow:0 0 10px rgba(245,240,228,.95);white-space:nowrap;transform:translate(-50%,-100%)}
.twk-finger{position:absolute;left:50%;bottom:calc(var(--sb) + 36px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;font-size:15px;opacity:0;transition:opacity .4s}
.twk-finger.on{opacity:.95}
.twk-finger i{display:block;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--ink);position:relative;animation:twkPress 1s ease-in-out infinite}
.twk-finger i:after{content:'';position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:var(--ink)}
@keyframes twkPress{0%,100%{transform:scale(1)}45%{transform:scale(.78)}}
/* ---- title ---- */
.twk-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.twk-title .head{margin-top:calc(var(--st) + 7vh);text-align:center;display:flex;flex-direction:column;align-items:center}
.twk-title .over{font-size:10px;letter-spacing:.42em;opacity:.7;margin-bottom:10px}
.twk-title h1{margin:0;font-size:clamp(46px,13vw,76px);line-height:.92;letter-spacing:-.01em;color:var(--char);text-shadow:0 0 30px rgba(245,240,228,.8)}
.twk-title .rule{width:46px;height:1px;background:var(--ink);opacity:.5;margin:16px 0 12px}
.twk-title .tag{font-size:17px;line-height:1.3;color:var(--char);opacity:.92;text-shadow:0 0 12px rgba(245,240,228,.95)}
.twk-title .foot{position:absolute;bottom:calc(var(--sb) + 10px);left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:14px}
.twk-begin{pointer-events:auto;font-size:24px;padding:10px 26px;color:var(--char);cursor:pointer;text-shadow:0 0 14px rgba(245,240,228,.95);animation:twkBreathe 3.2s ease-in-out infinite}
@keyframes twkBreathe{0%,100%{opacity:.95}50%{opacity:.6}}
.twk-links{display:flex;gap:22px;pointer-events:auto}
.twk-link{font-size:10px;letter-spacing:.26em;padding:10px 6px;cursor:pointer;opacity:.75;border:0;background:none;color:var(--ink)}
.twk-link:active{opacity:1}
/* ---- paper sheets ---- */
.twk-sheet{position:absolute;left:50%;bottom:calc(var(--sb) - 6px);width:min(92vw,420px);transform:translate(-50%,24px);opacity:0;pointer-events:none;transition:opacity .5s ease,transform .6s cubic-bezier(.2,.9,.3,1)}
.twk-sheet.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}
.twk-paper{position:relative;background-color:var(--paper);background-image:${PAPER_NOISE},linear-gradient(180deg,rgba(255,255,255,.35),rgba(236,227,208,.35));padding:22px 22px 18px;box-shadow:0 18px 40px -18px rgba(40,46,56,.45),0 2px 0 rgba(255,255,255,.6) inset;color:var(--char)}
.twk-paper:before{content:'';position:absolute;left:14px;right:14px;top:9px;height:1px;background:repeating-linear-gradient(90deg,rgba(47,58,72,.35) 0 3px,transparent 3px 7px)}
.twk-paper .k{font-size:9.5px;letter-spacing:.3em;opacity:.7}
.twk-paper h2{margin:6px 0 2px;font-size:30px;line-height:1.02;font-weight:300}
.twk-paper h3{margin:2px 0 10px;font-size:15px;opacity:.8}
.twk-rows{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:14px 0 6px;padding:12px 0;border-top:1px solid rgba(47,58,72,.18);border-bottom:1px solid rgba(47,58,72,.18)}
.twk-rows div{display:flex;flex-direction:column;gap:3px}
.twk-rows .v{font-size:19px}
.twk-rows .l{font-size:8.5px;letter-spacing:.26em;opacity:.65}
.twk-stamps{display:flex;gap:10px;margin:12px 0 4px;flex-wrap:wrap}
.twk-stamp{font-size:9px;letter-spacing:.24em;padding:6px 8px 5px;border:1.4px solid currentColor;border-radius:3px;color:rgba(47,58,72,.25);transform:rotate(-3deg)}
.twk-stamp.on{color:var(--coral);opacity:.92;transform:rotate(-5deg) scale(1);animation:twkStamp .5s cubic-bezier(.3,1.6,.5,1) both}
.twk-stamp:nth-child(2){transform:rotate(2deg)}.twk-stamp:nth-child(3){transform:rotate(-1deg)}
@keyframes twkStamp{from{transform:rotate(-12deg) scale(1.6);opacity:0}}
.twk-disc{font-size:15px;margin:6px 0 2px;opacity:.85}
.twk-acts{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
.twk-btn{border:0;background:none;padding:12px 4px;font-size:21px;color:var(--char);cursor:pointer;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:5px;text-decoration-color:rgba(47,58,72,.4)}
.twk-btn.small{font-size:10px;letter-spacing:.26em;text-decoration:none;opacity:.75}
.twk-btn[disabled]{opacity:.3}
.twk-board{margin-top:10px;font-size:12px}
.twk-board .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dotted rgba(47,58,72,.25)}
.twk-board .row.me{color:var(--coral)}
.twk-board .st{font-size:9px;letter-spacing:.2em;opacity:.6;padding-top:6px}
/* notebook index */
.twk-index{max-height:calc(100vh - var(--st) - var(--sb) - 60px);overflow:auto;-webkit-overflow-scrolling:touch}
.twk-sec{margin:14px 0 4px;display:flex;align-items:baseline;gap:10px}
.twk-sec .n{font-size:11px;letter-spacing:.2em;opacity:.6}
.twk-sec .t{font-size:22px}
.twk-ent{display:flex;align-items:baseline;gap:10px;padding:9px 2px;border-bottom:1px dotted rgba(47,58,72,.22);cursor:pointer}
.twk-ent .n{font-size:10px;opacity:.55;width:18px}
.twk-ent .t{flex:1;font-size:17px}
.twk-ent .m{display:flex;gap:4px}
.twk-ent .m i{width:7px;height:7px;border-radius:50%;border:1px solid rgba(212,102,79,.6)}
.twk-ent .m i.on{background:var(--coral);border-color:var(--coral)}
.twk-ent.lock{cursor:default;opacity:.35}
.twk-ent.next .t:after{content:' ←';font-style:normal;font-size:12px;opacity:.6}
.twk-close{position:absolute;right:10px;top:10px;width:36px;height:36px;border:0;background:none;font-size:20px;color:var(--ink);opacity:.6;cursor:pointer}
.twk-fail{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:18px;padding:0 30px;color:var(--char)}
.twk-title.land{align-items:flex-start}
.twk-title.land .head{margin-left:calc(var(--sl) + 7vw);margin-top:calc(var(--st) + 10vh);align-items:flex-start;text-align:left}
.twk-title.land h1{font-size:clamp(46px,9vh,80px)}
.twk-title.land .foot{align-items:flex-start;left:calc(var(--sl) + 7vw);bottom:12px}
.twk-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 62%,rgba(40,50,62,.16) 100%)}
.twk-veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(240,242,236,.55),rgba(240,242,236,0) 40%,rgba(240,242,236,0) 72%,rgba(240,238,228,.72) 100%);opacity:0;transition:opacity .8s}
.twk-veil.on{opacity:1}
`;
// the flow turbine: six blades that fill and spin with the world's flow
const TURBINE_SVG = `<svg viewBox="-26 -26 52 52">
  <circle r="23" fill="none" stroke="#2f3a48" stroke-opacity=".35" stroke-width=".8" stroke-dasharray="1.5 3"/>
  <g class="rot">${[0, 1, 2, 3, 4, 5].map(i => `<g transform="rotate(${i * 60})"><path class="bl" d="M0,-3 C5,-6 7,-14 3,-20 C1,-21 -1,-21 -2,-19 C-2,-13 -2,-7 0,-3Z" fill="#f5efe2" stroke="#2f3a48" stroke-width=".9" stroke-linejoin="round"/></g>`).join('')}</g>
  <circle r="3.4" fill="#f5efe2" stroke="#2f3a48" stroke-width=".9"/>
  <circle class="lamp" r="2" fill="#e8a44a" opacity="0"/>
  <g class="halo" opacity="0">${Array.from({ length: 12 }, (_, i) => `<circle cx="${Math.cos(i / 12 * TAU) * 23}" cy="${Math.sin(i / 12 * TAU) * 23}" r="1.1" fill="#c9a24e"/>`).join('')}</g>
</svg>`;
const MARKS = {
  windmill: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><path d="M-3,9 L-2,-1 L2,-1 L3,9 Z"/><path d="M0,-2 L-7,-8 M0,-2 L7,-8 M0,-2 L-6,4 M0,-2 L6,4"/></svg>',
  clock: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><path d="M-6,9 L-6,-3 L0,-9 L6,-3 L6,9 Z"/><circle cx="0" cy="1" r="3.4"/><path d="M0,1 L0,-1.2 M0,1 L1.6,1.8"/></svg>',
  daily: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><circle r="7"/><path d="M0,-7 L0,-9 M0,7 L0,9 M-7,0 L-9,0 M7,0 L9,0"/><circle r="2.2" fill="#d4664f" stroke="none"/></svg>',
  pause: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-linecap="round"><circle r="8.2" stroke-opacity=".5" stroke-width=".8"/><path d="M-2.2,-3.6 L-2.2,3.6 M2.2,-3.6 L2.2,3.6"/></svg>'
};

// ---- 08_game.js ----
// The game: boot, timing, Flow, chains, score, camera, notebook, records.
const SAVE_V = 1;
const LATE = 0.4, EARLY = 0.55, INPUT_BIAS = 0.03;
const CHAIN_WORDS = { 4: 'The chain continues', 8: 'Beautifully connected', 12: 'Everything moves', 18: 'In flow', 26: 'The world is running' };
const FLOW_WORDS = ['stillness', 'stirring', 'turning', 'in flow', 'everything moves'];

window.plethoraBit = {
  meta: { title: 'The Wind Keeps', runtime: 'plethora-bit@2', tags: ['casual', 'timing', '3d'], permissions: ['audio', 'haptics'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // ---------- first frame: a painted sky and the title, before anything loads ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:linear-gradient(180deg,#86bcd8 0%,#bcdce6 38%,#eef1e3 62%,#a9bb78 63%,#93aa66 100%)';
    const ui = ctx.createRoot({ className: 'twk', layer: 'overlay', input: 'passthrough' });
    const css = document.createElement('style'); css.textContent = UI_CSS; ui.appendChild(css);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'twk-vig');
    H.veil = el('div', 'twk-veil');
    // HUD
    H.hud = el('div', 'twk-hud fade hide');
    H.label = el('div', 'twk-label', '', H.hud);
    H.tag = el('div', 'twk-tag mono', '', H.label);
    el('div', 'twk-rule', '', H.label);
    H.obj = el('div', 'twk-obj disp', '', H.label);
    H.ticks = el('div', 'twk-ticks', '', H.label);
    H.note = el('div', 'twk-note serif fade hide', '', H.label);
    H.pause = el('div', 'twk-pause', MARKS.pause, H.hud);
    H.flow = el('div', 'twk-flow', TURBINE_SVG, H.hud);
    H.ctr = el('div', 'twk-ctr', '', H.flow);
    H.num = el('div', 'twk-num mono', '', H.ctr);
    H.sub = el('div', 'twk-sub mono', '', H.ctr);
    H.digits = [];
    for (let i = 0; i < 6; i++) { const s = el('span', '', '', H.num); const b = el('b', '', '0\n1\n2\n3\n4\n5\n6\n7\n8\n9', s); H.digits.push(b); }
    H.rot = H.flow.querySelector('.rot'); H.blades = [...H.flow.querySelectorAll('.bl')]; H.lamp = H.flow.querySelector('.lamp'); H.halo = H.flow.querySelector('.halo');
    H.say = el('div', 'twk-say serif');
    H.hint = el('div', 'twk-hint fade hide');
    H.hintSvg = el('div', '', '<svg><path fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-dasharray="4 5" stroke-linecap="round" opacity=".7"/><path class="hd" fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-linecap="round" opacity=".7"/></svg>', H.hint);
    H.hintPath = H.hint.querySelector('path'); H.hintHead = H.hint.querySelector('.hd');
    H.hintLbl = el('div', 'lbl serif', 'the wind is coming', H.hint);
    H.finger = el('div', 'twk-finger serif', '<i></i><span>touch</span>');
    // title
    H.title = el('div', 'twk-title fade');
    H.title.innerHTML = `<div class="head"><div class="over mono">A FIELD NOTEBOOK</div><h1 class="serif">The Wind<br>Keeps</h1><div class="rule"></div><div class="tag serif">Everything is moving.<br>You just need to catch it.</div></div>
      <div class="foot"><div class="twk-begin serif">begin</div><div class="twk-links"><button class="twk-link mono" data-a="notes">FIELD NOTES</button><button class="twk-link mono" data-a="sound">SOUND · ON</button></div></div>`;
    H.begin = H.title.querySelector('.twk-begin'); H.notesBtn = H.title.querySelector('[data-a=notes]'); H.soundBtn = H.title.querySelector('[data-a=sound]');
    H.begin.textContent = '…';
    // sheets
    H.sheet = el('div', 'twk-sheet');
    H.paper = el('div', 'twk-paper', '', H.sheet);
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    const fontLoads = [
      ['TWK Serif', 'cormorant-garamond', { weight: '300', style: 'italic' }],
      ['TWK Serif', 'cormorant-garamond', { weight: '300', style: 'normal' }],
      ['TWK Display', 'dm-serif-display', { weight: '400', style: 'italic' }],
      ['TWK Mono', 'space-mono', { weight: '400', style: 'normal' }],
      ['TWK Sans', 'inter', { weight: '400', style: 'normal' }]
    ];
    for (const [fam, name, o] of fontLoads) { try { const p = ctx.loadFont(fam, name, '1.0.0', o); if (p && p.catch) p.catch(() => { }); } catch (e) { } }

    // ---------- the field notebook (private memory) ----------
    const defaultSave = () => ({ v: SAVE_V, done: {}, muted: false, seenCatch: false, daily: {} });
    let save = defaultSave(), saveReady = false, saveFailed = false, saveChain = Promise.resolve();
    const mem = ctx.memory && ctx.memory.local ? (() => { try { return ctx.memory.local('notebook'); } catch (e) { return null; } })() : null;
    const validSave = v => v && typeof v === 'object' && v.v === SAVE_V && v.done && typeof v.done === 'object';
    const hydrate = mem ? mem.get().then(r => {
      if (destroyed) return;
      const v = r && r.value;
      if (v && validSave(v)) save = Object.assign(defaultSave(), v);
      saveReady = true;
    }).catch(e => { saveFailed = true; try { ctx.platform.error({ stage: 'memory', message: String(e && e.message || e) }); } catch (_) { } }) : Promise.resolve().then(() => { saveReady = false; });
    // writes are serialised, and only ever made after a successful read
    const persist = () => {
      if (!mem || !saveReady || destroyed) return;
      const snap = JSON.parse(JSON.stringify(save));
      saveChain = saveChain.then(() => mem.set(snap)).catch(() => { });
    };

    // ---------- boot ----------
    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics.', frame: 'The first frame failed to draw. Please reopen.' }[stage] || 'Something went wrong.';
      el('div', 'twk-fail serif', msg);
      H.title.querySelector('.foot').style.display = 'none';
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.6));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (e) { } });

    const P = createPaint(THREE);
    const E = createEnv(THREE, P);
    const X = createParts(THREE, P);
    const audio = createAudio(!!caps.audio);
    ctx.onDestroy(() => audio.close());
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;
    // creator knobs (draft-time), with safe defaults when tuning is unavailable
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.get ? ctx.tune.get(id) : undefined; return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    try { if (ctx.tune && ctx.tune.onChange) ctx.tune.onChange(['sound_level'], v => { audio.volume = typeof v === 'number' ? v : 0.9; audio.setMuted(audio.muted); }); } catch (e) { }
    audio.volume = tune('sound_level', 0.9);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, ctx.width / ctx.height, 0.3, 600);
    scene.add(camera);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xbcd3e6, 0.35); fill.position.set(12, 6, 14); scene.add(fill);
    let sky = null;

    const worlds = { windmill: createWindmillWorld(THREE, P, E, X, audio), clock: createClockWorld(THREE, P, E, X, audio) };
    const ORDER = ['windmill', 'clock'].filter(w => worlds[w]);
    let world = null;
    function useWorld(id) {
      if (world && world.id === id) return;
      if (world) scene.remove(world.root);
      world = worlds[id];
      const lk = world.look;
      if (sky) { scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); }
      sky = E.sky(lk.sky); scene.add(sky);
      scene.fog = new THREE.Fog(new THREE.Color(lk.fog), lk.fogNear, lk.fogFar);
      hemi.color.set(lk.hemiSky); hemi.groundColor.set(lk.hemiGround); hemi.intensity = lk.hemi;
      sun.color.set(lk.sunColor); sun.intensity = lk.sun; sun.position.set(...lk.sunPos); sun.target.position.set(0, 4, 0);
      world.build(scene);
      audio.bpm = world.bpm;
      layout();
    }

    // ---------- game state ----------
    let mode = 'boot';
    const G = {
      t: 0, t0: 0, beat: 60 / 76, flow: 0, rng: makeRng(1), playing: false, ops: [], opId: 0,
      addOp(kind, t, data, harmful = false) { const op = { id: ++G.opId, kind, t, data, harmful: !!harmful, done: false }; G.ops.push(op); return op; },
      beatTime(k) { return G.t0 + k * G.beat; },
      event(name, p) { onWorldEvent(name, p); },
      focus(point, amt) { cam.focus.copy(point); cam.focusAmt = Math.max(cam.focusAmt, Math.abs(amt)); cam.push = Math.max(cam.push, amt); }
    };
    let run = null; // the current attempt
    let attempt = 0;
    let levelRef = null; // { world, index } or { daily: true }
    let autopilot = 0; // 0 off, 1 casual (title), 2 perfect (finale)

    function levelDef(ref) {
      if (ref.daily) return dailyLevel();
      return worlds[ref.world].levels[ref.index];
    }
    // The Daily Machine: everyone gets the same world, wind and quirks today.
    function dailyLevel() {
      const key = todayKey(), seed = hashStr('twk-' + key), r = makeRng(seed);
      const wid = ORDER[seed % ORDER.length];
      const base = Object.assign({}, worlds[wid].levels[worlds[wid].levels.length - 1]);
      base.daily = true; base.world = wid; base.seed = seed;
      base.goal = { type: 'timed', secs: Math.round(tune('daily_seconds', 90)) };
      base.cross = r.range(0.08, 0.3); base.jitter = r.range(0.02, 0.07); base.startW = r.range(0.15, 0.7);
      if (base.N) base.N = r.int(4, 6);
      base.title = r.pick(worlds[wid].dailyTitles || ['Keep it all moving']);
      base.note = 'Today\'s machine. Everyone has the same wind.';
      return base;
    }

    // ---------- camera ----------
    const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), basePos: new THREE.Vector3(), baseLook: new THREE.Vector3(), focus: new THREE.Vector3(), focusAmt: 0, push: 0, pushV: 0, orbit: 0, intro: 0 };
    function frameCamera() {
      const f = world.frame, a = ctx.width / Math.max(1, ctx.height);
      const D = f.dist;
      const hv = Math.max((f.y1 - f.y0) / 2, ((f.x1 - f.x0) / 2) / a);
      let fov = 2 * Math.atan(hv / D) * 180 / Math.PI;
      fov = Math.min(fov, 62);
      camera.fov = fov; camera.aspect = a; camera.updateProjectionMatrix();
      const cx = (f.x0 + f.x1) / 2;
      // portrait: centre the machine; leave a little more sky above the HUD
      const cy = a < 1 ? f.cy : (f.y0 + f.y1) / 2;
      cam.basePos.set(cx, cy + 1.6, f.z + D);
      cam.baseLook.set(cx, cy, f.z);
    }
    function updateCamera(dt, time) {
      cam.focusAmt = damp(cam.focusAmt, 0, 0.9, dt);
      cam.pushV += (cam.push - 0) * 0; cam.push = damp(cam.push, 0, 0.7, dt);
      const breathe = Math.sin(time * 0.21) * 0.12;
      const orbit = cam.orbit;
      const p = cam.basePos, l = cam.baseLook;
      cam.title = damp(cam.title || 0, mode === 'title' ? 1 : 0, 1.6, dt);
      cam.res = damp(cam.res || 0, mode === 'complete' ? 1 : 0, 1.2, dt);
      const port = ctx.width < ctx.height;
      const dz = -cam.push * 2.2 + cam.title * (port ? 9 : 3) + cam.res * (port ? 7 : 2);
      const ty = cam.title * (port ? 4.2 : 0.5) - cam.res * (port ? 5.5 : 0);
      const tx = port ? 0 : -cam.title * 6.5 - cam.res * 5;
      cam.pos.set(p.x + tx + Math.sin(orbit) * 4 + breathe, p.y + ty + Math.cos(time * 0.17) * 0.08, p.z + dz);
      cam.look.copy(l).lerp(cam.focus, cam.focusAmt * 0.18); cam.look.y += ty; cam.look.x += tx;
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
    }

    // ---------- HUD helpers ----------
    let sayTimer = 0;
    function say(text, secs = 2.4) { H.say.textContent = text; H.say.classList.add('on'); sayTimer = secs; }
    let lastTicks = '';
    function renderObjective() {
      if (!run) return;
      const o = world.objective(G);
      let html = '';
      if (o.timed) {
        const left = Math.max(0, run.L.goal.secs - (G.t - run.tStart));
        for (let i = 0; i < Math.min(12, o.ticks); i++) html += '<i class="on"></i>' + ((i + 1) % 5 === 0 ? '<i class="cross"></i>' : '');
        html += `<span class="t mono">${fmtTime(left)}</span>`;
      } else {
        for (let i = 0; i < o.need; i++) html += `<i class="${i < o.ticks ? 'on' : ''}"></i>` + ((i + 1) % 5 === 0 && i < o.need - 1 ? '<i class="cross" style="opacity:' + (i < o.ticks ? 1 : 0.2) + '"></i>' : '');
      }
      if (html !== lastTicks) { H.ticks.innerHTML = html; lastTicks = html; }
    }
    let shownScore = -1;
    function renderScore(v) {
      v = Math.max(0, Math.min(999999, Math.floor(v)));
      if (v === shownScore) return; shownScore = v;
      const s = String(v).padStart(6, '0');
      for (let i = 0; i < 6; i++) { H.digits[i].style.transform = `translateY(${-(+s[i]) * 14}px)`; H.digits[i].parentNode.style.opacity = i < 6 - String(v).length ? 0.3 : 1; }
    }
    let turbA = 0, flowTier = 0;
    function renderFlow(dt) {
      const f = G.flow;
      turbA += dt * (0.2 + Math.pow(f, 1.4) * 9) * 57.3;
      H.rot.setAttribute('transform', `rotate(${turbA % 360}) scale(${0.72 + f * 0.3})`);
      const lit = Math.ceil(f * 6 - 0.15);
      H.blades.forEach((b, i) => b.setAttribute('fill', i < lit ? (f > 0.85 ? '#e8b354' : '#ecd08a') : '#f5efe2'));
      H.lamp.setAttribute('opacity', clamp((f - 0.6) * 3).toFixed(2));
      H.halo.setAttribute('opacity', clamp((f - 0.85) * 6).toFixed(2));
      const tier = f < 0.12 ? 0 : f < 0.35 ? 1 : f < 0.6 ? 2 : f < 0.85 ? 3 : 4;
      if (tier !== flowTier && mode === 'play') { if (tier > flowTier && tier >= 3) H.sub.textContent = FLOW_WORDS[tier].toUpperCase(); flowTier = tier; }
    }

    // ---------- a run ----------
    function startLevel(ref) {
      levelRef = ref;
      const L = levelDef(ref);
      useWorld(ref.daily ? L.world : ref.world);
      attempt++;
      G.rng = makeRng(ref.daily ? L.seed : ((Date.now() ^ (Math.random() * 1e9)) >>> 0));
      G.beat = 60 / world.bpm; G.ops = []; G.flow = 0.08; G.lead = tune('anticipation_beats', 3);
      G.t0 = G.t + 1.0;
      run = { L, ref, attempt, tStart: G.t, lastFlowT: G.t, score: 0, chain: 0, bestChain: 0, q: [], catches: 0, snags: 0, done: false, finaleT: 0, events: [], idleTaps: [] };
      world.begin(L, G);
      autopilot = 0; mode = 'play'; G.playing = true;
      if (scoreTrack) { try { scoreTrack.reset(); } catch (e) { } }
      try { ctx.platform.start({ level: ref.daily ? 'daily' : ref.world + '-' + (ref.index + 1) }); } catch (e) { }
      // HUD
      const tagName = ref.daily ? 'TODAY' : world.label;
      const num = ref.daily ? `${new Date().getUTCDate()} ${MONTHS[new Date().getUTCMonth()].slice(0, 3).toUpperCase()}` : String(ref.index + 1).padStart(2, '0');
      H.tag.innerHTML = (ref.daily ? MARKS.daily : MARKS[world.id === 'clock' ? 'clock' : 'windmill']) + `<span>${tagName}</span><span class="sl">/</span><span>${num}</span>`;
      H.obj.textContent = L.title;
      H.note.textContent = L.note || ''; H.note.classList.remove('hide');
      run.noteT = 5.5;
      lastTicks = ''; renderObjective(); shownScore = -1; renderScore(0); H.sub.textContent = '';
      H.hud.classList.remove('hide'); H.title.classList.add('hide'); hideSheet();
      H.veil.classList.remove('on');
      cam.orbit = 0;
    }
    function attract() {
      // the title: the world runs itself, a little imperfectly
      useWorld(world ? world.id : 'windmill');
      const L = Object.assign({}, world.levels[Math.min(3, world.levels.length - 1)], { startW: 0.6 });
      G.rng = makeRng(7); G.beat = 60 / world.bpm; G.ops = []; G.flow = 0.45; G.t0 = G.t + 0.5;
      world.begin(L, G);
      run = null; autopilot = 1; mode = 'title'; G.playing = false;
      H.hud.classList.add('hide'); H.title.classList.remove('hide');
      H.veil.classList.add('on');
    }

    // tap ---------------------------------------------------------------
    let frameWall = performance.now();
    function tapTime() { return G.t + Math.min(0.05, (performance.now() - frameWall) / 1000) - INPUT_BIAS; }
    function classify(d, L) {
      const k = tune('timing_forgiveness', 1), [wf, wg] = (L.win || [0.1, 0.22]).map(w => w * k);
      const ad = Math.abs(d);
      if (ad <= wf) return 'flow';
      if (ad <= wg) return 'good';
      return d < 0 ? 'early' : 'late';
    }
    function tap(x, y) {
      if (mode !== 'play' || !run || run.done) return;
      const t = tapTime();
      try { ctx.platform.interact({ kind: 'catch' }); } catch (e) { }
      const L = run.L;
      const cands = G.ops.filter(o => !o.done && t - o.t > -EARLY && t - o.t < LATE);
      let res = null;
      if (!cands.length) {
        world.idle(G);
        run.idleTaps = run.idleTaps.filter(q => t - q < 2.5); run.idleTaps.push(t);
        if (run.idleTaps.length > 2) { G.flow = Math.max(0, G.flow - 0.02); run.chain = 0; }
      } else {
        cands.sort((a, b) => Math.abs(t - a.t) - Math.abs(t - b.t));
        const best = cands[0];
        const wg = (L.win || [0.1, 0.22])[1] * tune('timing_forgiveness', 1);
        // everything that aligns with this moment is caught together
        const hit = cands.filter(o => o === best || Math.abs(t - o.t) <= wg);
        let good = 0;
        for (const op of hit) {
          op.done = true;
          const d = t - op.t;
          const r = op.harmful ? 'snag' : classify(d, L);
          world.resolve(op, r, d, G);
          result(r, op);
          if (r === 'flow' || r === 'good') good++;
          res = res || r;
        }
        if (good >= 2) { addScore(180 * good); say('When things align', 2.2); audio.swell(G.t, 2); }
        if (!save.seenCatch) { save.seenCatch = true; persist(); }
      }
      // a small pencil ring where the finger landed
      if (x !== undefined) { const r = el('div', 'twk-touch', '', ui); r.style.left = x + 'px'; r.style.top = y + 'px'; ctx.timeout(() => r.remove(), 520); }
      audio.unlock();
    }
    function addScore(v) { if (!run) return; run.score += v; if (scoreTrack) { try { scoreTrack.set(Math.floor(run.score)); } catch (e) { } } }
    function result(r, op) {
      if (!run) return;
      const q = { flow: 1, good: 0.6, early: 0.2, late: 0, miss: 0, snag: 0 }[r];
      if (q !== undefined) run.q.push(q);
      if (r === 'flow' || r === 'good') {
        run.chain++; run.bestChain = Math.max(run.bestChain, run.chain); run.catches++; run.lastFlowT = G.t;
        G.flow = clamp(G.flow + (r === 'flow' ? 0.1 : 0.05) * tune('flow_recovery', 1));
        addScore((r === 'flow' ? 120 : 70) * (1 + Math.min(run.chain, 20) * 0.08 + G.flow * 0.5));
        if (r === 'flow') haptic('light');
        const w = CHAIN_WORDS[run.chain];
        if (w) { say(w); audio.swell(G.t, run.chain / 4); try { ctx.platform.milestone('chain', { length: run.chain }); } catch (e) { } }
      } else if (r === 'early' || r === 'late') {
        if (run.chain >= 6) say(r === 'early' ? 'A little early' : 'Almost', 1.6);
        run.chain = 0; G.flow = clamp(G.flow - (r === 'early' ? 0.05 : 0.06));
        addScore(r === 'early' ? 10 : 0);
      } else if (r === 'snag') {
        run.chain = 0; run.snags++; G.flow = clamp(G.flow - 0.14); haptic('warning');
        if (run.snags === 1) say('Out of step', 1.8);
      } else if (r === 'miss') {
        if (run.chain >= 6) say('The chain rests', 1.6);
        run.chain = 0; G.flow = clamp(G.flow - 0.04);
      } else if (r === 'weathered') {
        G.flow = clamp(G.flow + 0.03); addScore(40);
      }
    }
    function onWorldEvent(name, p) {
      if (!run || mode !== 'play') return;
      if (name === 'delivery' || name === 'hour') {
        addScore(600 * (1 + G.flow)); G.flow = clamp(G.flow + 0.06); haptic('success');
        if (!run.events.includes(name)) say(name === 'hour' ? 'The hour is kept' : 'The world responds', 2.6);
        run.events.push(name);
        try { ctx.platform.milestone(name); } catch (e) { }
      } else if (name === 'lift-top') { addScore(150); }
      else if (name === 'overswing') { run.chain = 0; G.flow = clamp(G.flow - 0.08); haptic('warning'); if (!run.events.includes(name)) say('Too much', 1.8); run.events.push(name); }
      else if (name === 'stall') { if (!run.events.includes('stall')) say('Stillness', 2.4); run.events.push('stall'); }
    }

    // finale & results -------------------------------------------------------
    function beginFinale() {
      run.done = true; run.tEnd = G.t; mode = 'finale'; autopilot = 2; run.finaleT = 0;
      for (const op of G.ops) if (!op.done && op.t < G.t) op.done = true;
      world.finale(G);
      H.note.classList.add('hide');
      haptic('success');
      try { ctx.platform.setProgress(1); } catch (e) { }
    }
    function computeResult() {
      const L = run.L, time = run.tEnd - run.tStart, avg = run.q.length ? run.q.reduce((a, b) => a + b, 0) / run.q.length : 0;
      const timed = L.goal.type === 'timed';
      const stats = world.stats();
      if (!timed) addScore(Math.max(0, (L.par || 60) - time) * 15);
      const kept = timed ? (stats.deliveries || stats.hours || 0) >= 3 : true;
      const inflow = avg >= 0.72 && run.q.length >= 4;
      const unbroken = run.bestChain >= (timed ? 16 : Math.min(10, Math.max(5, (L.goal.need || 4) * 2 + 2)));
      return { time, avg, kept, inflow, unbroken, score: Math.floor(run.score), chain: run.bestChain, stats, timed };
    }
    function finishLevel() {
      const R = computeResult();
      mode = 'complete';
      const key = levelRef.daily ? null : levelRef.world + '-' + (levelRef.index + 1);
      let best = null, isBest = false;
      if (key) {
        const prev = save.done[key];
        isBest = !prev || R.score > prev.best;
        best = Math.max(R.score, prev ? prev.best : 0);
        const stamps = [R.kept ? 1 : 0, R.inflow ? 1 : 0, R.unbroken ? 1 : 0];
        if (R.kept) save.done[key] = { best, s: prev ? prev.s.map((v, i) => v | stamps[i]) : stamps };
        persist();
      } else {
        const k = todayKey(); const prev = save.daily[k];
        isBest = !prev || R.score > prev; save.daily = { [k]: Math.max(R.score, prev || 0) }; best = save.daily[k]; persist();
      }
      try { ctx.platform.complete({ level: key || 'daily', score: R.score }); } catch (e) { }
      showResult(R, best, isBest);
    }
    function headline(R) {
      if (R.timed && !R.kept) return 'The day is done.';
      if (R.inflow && R.unbroken) return 'Everything moved.';
      if (R.inflow) return 'You found the flow.';
      if (R.unbroken) return 'A good day for the machine.';
      return world.id === 'clock' ? 'The tower remembers.' : 'The windmill remembers.';
    }
    function nextRef() {
      if (!levelRef || levelRef.daily) return null;
      const w = worlds[levelRef.world];
      if (levelRef.index + 1 < w.levels.length) return { world: levelRef.world, index: levelRef.index + 1 };
      const wi = ORDER.indexOf(levelRef.world); if (wi + 1 < ORDER.length) return { world: ORDER[wi + 1], index: 0 };
      return null;
    }
    function unlocked(ref) {
      if (ref.daily) return !!save.done['windmill-1'];
      if (ref.index === 0) return ref.world === 'windmill' || !!save.done['windmill-4'];
      return !!save.done[ref.world + '-' + ref.index];
    }
    let resultAttempt = 0;
    function showResult(R, best, isBest) {
      const L = run.L, ref = levelRef;
      const disc = !ref.daily && world.discovery ? world.discovery(L) : null;
      const nx = nextRef();
      const rows = [
        [R.timed ? (world.id === 'clock' ? 'HOURS KEPT' : 'SEEDS CARRIED') : 'TIME', R.timed ? String(R.stats.deliveries ?? R.stats.hours ?? 0) : fmtTime(R.time)],
        ['LONGEST CHAIN', String(R.chain)],
        ['FLOW', R.avg >= 0.8 ? 'held' : R.avg >= 0.6 ? 'found' : R.avg >= 0.4 ? 'stirring' : 'finding it'],
        [isBest && best > 0 ? 'SCORE · BEST' : 'SCORE', R.score.toLocaleString('en-US')]
      ];
      H.paper.innerHTML = `<div class="k mono">${ref.daily ? 'TODAY\'S MACHINE · ' + new Date().getUTCDate() + ' ' + MONTHS[new Date().getUTCMonth()].toUpperCase() : world.label + ' · ENTRY ' + String(ref.index + 1).padStart(2, '0')}</div>
        <h2 class="serif">${headline(R)}</h2><h3 class="disp">${L.title}</h3>
        <div class="twk-rows">${rows.map(r => `<div><span class="v ${r[0] === 'FLOW' ? 'serif' : 'mono'}">${r[1]}</span><span class="l mono">${r[0]}</span></div>`).join('')}</div>
        <div class="twk-stamps mono"><span class="twk-stamp ${R.kept ? 'on' : ''}">KEPT</span><span class="twk-stamp ${R.inflow ? 'on' : ''}">IN FLOW</span><span class="twk-stamp ${R.unbroken ? 'on' : ''}">UNBROKEN</span></div>
        ${disc ? `<div class="twk-disc serif">New in the notebook: ${disc}.</div>` : ''}
        ${ref.daily ? '<div class="twk-board mono"><div class="st">TODAY · LOADING…</div></div>' : ''}
        <div class="twk-acts"><button class="twk-btn serif" data-a="again">again</button>${nx && unlocked(nx) || (nx && R.kept) ? '<button class="twk-btn serif" data-a="next">next entry →</button>' : '<button class="twk-btn small mono" data-a="notes">FIELD NOTES</button>'}</div>`;
      showSheet();
      if (isBest && best > 0) { audio.bloom(G.t + 0.4); audio.bell(G.t + 0.9, 9, 0.7); }
      if (ref.daily) submitDaily(R.score);
      try { if (ctx.pulse && ctx.pulse.complete) ctx.timeout(() => { if (mode === 'complete') ctx.pulse.complete({ score: R.score, timeMs: Math.round(R.time * 1000), level: ref.daily ? 'daily' : ref.index + 1, mode: world.id, result: headline(R) }); }, 900); } catch (e) { }
    }
    function submitDaily(score) {
      const my = ++resultAttempt;
      const board = () => H.paper.querySelector('.twk-board');
      const rec = ctx.memory && ctx.memory.record ? ctx.memory.record('daily_machine') : null;
      const go = scoreTrack && scoreTrack.submit ? scoreTrack.submit('daily_machine', { label: score.toLocaleString('en-US') + ' pts' }) : (rec ? rec.submit(score, { label: score + ' pts' }) : Promise.reject(new Error('records unavailable')));
      go.then(() => rec ? rec.leaderboard({ scope: 'global', period: 'daily', limit: 3 }) : null).then(lb => {
        if (destroyed || my !== resultAttempt || !board()) return;
        if (!lb) { board().innerHTML = '<div class="st">TODAY · SAVED</div>'; return; }
        const rows = (lb.rows || []).slice(0, 3).map(r => `<div class="row"><span>${r.rank}. ${String(r.username || r.displayName || '—').slice(0, 18)}</span><span>${r.displayLabel || r.value}</span></div>`).join('');
        const me = lb.viewerRank ? `<div class="row me"><span>you · ${lb.viewerRank.rank} of ${lb.totalRanked || '—'}</span><span>${lb.viewerRank.displayLabel || lb.viewerRank.value}</span></div>` : '';
        board().innerHTML = '<div class="st">TODAY</div>' + rows + me;
      }).catch(() => { if (!destroyed && my === resultAttempt && board()) board().innerHTML = '<div class="st">TODAY · THE BOARD COULD NOT BE REACHED</div>'; });
    }
    function showSheet() { H.sheet.classList.add('on'); }
    function hideSheet() { H.sheet.classList.remove('on'); }

    // notebook index -------------------------------------------------------
    function showNotes(fromPause) {
      const prevMode = mode;
      if (mode === 'play') pauseGame(true);
      let html = `<button class="twk-close" data-a="close">×</button><div class="k mono">FIELD NOTES${saveFailed ? ' · NOTES COULD NOT BE READ' : ''}</div><div class="twk-index">`;
      ORDER.forEach((wid, wi) => {
        const w = worlds[wid];
        html += `<div class="twk-sec"><span class="n mono">${w.numeral}.</span><span class="t serif">${w.name}</span></div>`;
        w.levels.forEach((L, i) => {
          const ref = { world: wid, index: i }, d = save.done[wid + '-' + (i + 1)], ok = unlocked(ref) || !!d;
          const isNext = ok && !d;
          html += `<div class="twk-ent ${ok ? '' : 'lock'} ${isNext ? 'next' : ''}" ${ok ? `data-w="${wid}" data-i="${i}"` : ''}><span class="n mono">${String(i + 1).padStart(2, '0')}</span><span class="t disp">${ok ? L.title : '· · ·'}</span><span class="m">${d ? d.s.map(v => `<i class="${v ? 'on' : ''}"></i>`).join('') : ''}</span></div>`;
        });
      });
      const dOk = unlocked({ daily: true }), db = save.daily[todayKey()];
      html += `<div class="twk-sec"><span class="n mono">—</span><span class="t serif">Today's machine</span></div>
        <div class="twk-ent ${dOk ? '' : 'lock'}" ${dOk ? 'data-d="1"' : ''}><span class="n mono">${new Date().getUTCDate()}</span><span class="t disp">${dOk ? 'Same wind for everyone, today' : 'After the first entry'}</span><span class="m mono" style="font-size:11px">${db ? db.toLocaleString('en-US') : ''}</span></div></div>`;
      H.paper.innerHTML = html;
      H.paper.dataset.from = fromPause ? 'pause' : prevMode;
      showSheet();
    }
    function showPause() {
      H.paper.innerHTML = `<div class="k mono">PAUSED · ${levelRef && levelRef.daily ? 'TODAY' : world.label}</div><h2 class="serif">The machine waits.</h2>
        <div class="twk-acts" style="flex-wrap:wrap;gap:4px 18px;justify-content:flex-start"><button class="twk-btn serif" data-a="resume">resume</button><button class="twk-btn serif" data-a="again">begin again</button><button class="twk-btn serif" data-a="notes">field notes</button></div>
        <div class="twk-acts"><button class="twk-btn small mono" data-a="sound">SOUND · ${audio.muted ? 'OFF' : 'ON'}</button><button class="twk-btn small mono" data-a="leave">LEAVE</button></div>`;
      showSheet();
    }
    let pausedFrom = null;
    function pauseGame(silent) {
      if (mode !== 'play' && mode !== 'finale') return;
      pausedFrom = mode; mode = 'paused'; audio.suspend();
      if (!silent) showPause();
    }
    function resumeGame() {
      if (mode !== 'paused') return;
      mode = pausedFrom || 'play'; hideSheet(); audio.resume(); audio.unlock();
    }
    function toggleSound() { save.muted = !save.muted; audio.setMuted(save.muted); persist(); H.soundBtn.textContent = 'SOUND · ' + (save.muted ? 'OFF' : 'ON'); }
    function firstRef() {
      for (const wid of ORDER) for (let i = 0; i < worlds[wid].levels.length; i++) { const r = { world: wid, index: i }; if (unlocked(r) && !save.done[wid + '-' + (i + 1)]) return r; }
      return { world: 'windmill', index: worlds.windmill.levels.length - 1 };
    }

    // ---------- input ----------
    let downId = null;
    ctx.listen(canvas, 'pointerdown', e => {
      if (e.cancelable) e.preventDefault();
      audio.unlock();
      if (mode === 'play') { const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top); }
      else if (mode === 'title') beginFromTitle();
      else if (mode === 'complete' || mode === 'paused') { /* sheets own their buttons */ }
    });
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    function beginFromTitle() { if (mode !== 'title' || !booted) return; audio.unlock(); audio.ui(G.t); startLevel(firstRef()); }
    const click = (node, fn) => ctx.listen(node, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(ev); });
    H.begin.style.pointerEvents = 'auto';
    click(H.begin, beginFromTitle);
    click(H.notesBtn, () => { if (booted) showNotes(false); });
    click(H.soundBtn, toggleSound);
    click(H.pause, () => { if (mode === 'play' || mode === 'finale') pauseGame(); else if (mode === 'paused') resumeGame(); });
    click(H.paper, ev => {
      const a = ev.target.closest('[data-a]'), ent = ev.target.closest('[data-w],[data-d]');
      if (ent) { audio.ui(G.t); hideSheet(); if (ent.dataset.d) startLevel({ daily: true }); else startLevel({ world: ent.dataset.w, index: +ent.dataset.i }); return; }
      if (!a) return;
      const k = a.dataset.a; audio.ui(G.t, k !== 'leave');
      if (k === 'resume') resumeGame();
      else if (k === 'again') { hideSheet(); startLevel(levelRef); }
      else if (k === 'next') { hideSheet(); const n = nextRef(); startLevel(n || levelRef); }
      else if (k === 'notes') showNotes(mode === 'paused');
      else if (k === 'sound') { toggleSound(); showPause(); }
      else if (k === 'leave') { hideSheet(); audio.resume(); attract(); }
      else if (k === 'close') { hideSheet(); if (mode === 'paused') { if (H.paper.dataset.from === 'pause') showPause(); else resumeGame(); } else if (mode === 'complete') { attract(); } }
    });
    ctx.listen(window, 'keydown', e => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); audio.unlock(); if (mode === 'play') tap(); else if (mode === 'title') beginFromTitle(); else if (mode === 'paused') resumeGame(); }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play' || mode === 'finale') pauseGame(); else if (mode === 'paused') resumeGame(); }
    });
    ctx.listen(window, 'blur', () => { if (mode === 'play') pauseGame(); });

    // ---------- layout ----------
    function layout() {
      const w = ctx.width, h = ctx.height, a = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 120, left: 0, right: 0 };
      ui.style.setProperty('--st', (a.top || 0) + 'px'); ui.style.setProperty('--sb', (a.bottom || 0) + 'px');
      ui.style.setProperty('--sl', (a.left || 0) + 'px'); ui.style.setProperty('--sr', (a.right || 0) + 'px');
      renderer.setSize(w, h, false);
      H.title.classList.toggle('land', w > h);
      if (world) frameCamera();
    }
    ctx.onResize(() => layout(), { immediate: true });

    // ---------- loop ----------
    let booted = false, skipRender = false;
    function step(dt) {
      if (destroyed) return;
      dt = Math.min(0.05, Math.max(0, dt));
      const live = mode !== 'paused';
      if (live) {
        G.t += dt;
        // ops that slipped by
        for (const op of G.ops) {
          if (op.done) continue;
          if (autopilot && !op.harmful && (!world.botWants || world.botWants(op))) {
            const err = autopilot === 2 ? 0 : (op.err ?? (op.err = (G.rng() - 0.5) * 0.12 + (G.rng() < 0.08 ? 0.6 : 0)));
            if (G.t >= op.t + err) { op.done = true; const r = classify(err, run ? run.L : { win: [0.1, 0.22] }); world.resolve(op, r, err, G); if (run && mode === 'play') result(r, op); else if (!run) G.flow = clamp(G.flow + (r === 'flow' ? 0.02 : -0.01), 0.3, 0.75); continue; }
          }
          if (G.t - op.t > LATE) {
            op.done = true; world.passed(op, G);
            if (run && mode === 'play' && !op.optional) result(op.harmful ? 'weathered' : 'miss', op);
          }
        }
        if (G.ops.length > 40) G.ops = G.ops.filter(o => !o.done);
        if (mode === 'play' || mode === 'finale') { if (!run.done && G.t - run.lastFlowT > 6) G.flow = Math.max(0, G.flow - dt * 0.01); }
        world.update(dt, G);
        audio.flow = G.flow; audio.simNow = G.t;
        audio.update(dt, world.audioState(G));
        if (mode === 'play' && run) {
          const o = world.objective(G);
          if (o.done || (o.timed && G.t - run.tStart >= run.L.goal.secs)) beginFinale();
          try { if (!o.timed && o.need) ctx.platform.setProgress(clamp(o.ticks / o.need)); } catch (e) { }
          if (run.noteT > 0) { run.noteT -= dt; if (run.noteT <= 0) H.note.classList.add('hide'); }
        }
        if (mode === 'finale') {
          run.finaleT += dt; G.flow = damp(G.flow, 1, 0.8, dt);
          cam.orbit = damp(cam.orbit, -0.06, 0.6, dt); cam.push = Math.max(cam.push, 0.35);
          if (run.finaleT > 4.6) finishLevel();
        }
        if (mode === 'complete') { cam.orbit = damp(cam.orbit, -0.08, 0.3, dt); G.flow = damp(G.flow, 0.9, 0.5, dt); }
        if (mode === 'title') cam.orbit = Math.sin(G.t * 0.05) * 0.05;
      }
      if (run) { renderObjective(); renderScore(run.score); }
      renderFlow(live ? dt : 0);
      updateHint();
      if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) H.say.classList.remove('on'); }
      updateCamera(dt, G.t);
      if (sky) sky.position.copy(camera.position);
      if (!skipRender) renderer.render(scene, camera);
      frameWall = performance.now();
    }
    // the first-ever gust gets a pencilled note; nothing after that
    const _hp = new THREE.Vector3();
    let fingerShown = 0;
    function project(v) { _hp.copy(v).project(camera); return [(_hp.x * 0.5 + 0.5) * ctx.width, (-_hp.y * 0.5 + 0.5) * ctx.height]; }
    function updateHint() {
      const show = mode === 'play' && !save.seenCatch && world.id === 'windmill' && run && run.L.n === 1;
      const h = show ? world.hint() : null;
      if (!h) { H.hint.classList.add('hide'); H.finger.classList.remove('on'); return; }
      const g = h.gust, s = clamp((G.t - g.t0) / (g.tA - g.t0));
      const pts = []; for (let i = 0; i <= 20; i++) { const u = lerp(Math.max(0, s - 0.05), 1, i / 20); pts.push(project(g.curve.getPointAt(u))); }
      H.hintPath.setAttribute('d', 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L'));
      const e = pts[pts.length - 1], q = pts[pts.length - 2], ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
      H.hintHead.setAttribute('d', `M${e[0] - Math.cos(ang - 0.5) * 10},${e[1] - Math.sin(ang - 0.5) * 10} L${e[0]},${e[1]} L${e[0] - Math.cos(ang + 0.5) * 10},${e[1] - Math.sin(ang + 0.5) * 10}`);
      const head = pts[0]; H.hintLbl.style.left = clamp(head[0], 90, ctx.width - 90) + 'px'; H.hintLbl.style.top = (head[1] - 14) + 'px';
      H.hint.classList.toggle('hide', s < 0.08 || s > 0.995);
      H.finger.classList.toggle('on', s > 0.72);
    }

    let frozen = false;
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => { if (!frozen) step(dtMs / 1000); } });
    else ctx.onFrame(dtMs => { if (!frozen) step(dtMs / 1000); });

    // first frame
    try {
      useWorld('windmill');
      attract();
      step(0.016);
    } catch (e) { bootFail('frame', e); return; }
    booted = true;
    H.begin.textContent = 'begin';
    try { ctx.platform.ready(); } catch (e) { }
    hydrate.then(() => { if (!destroyed) { audio.setMuted(!!save.muted); H.soundBtn.textContent = 'SOUND · ' + (save.muted ? 'OFF' : 'ON'); if (Object.keys(save.done).length) H.begin.textContent = 'continue'; } });

    if (window.__TWK_DEV) {
      window.__twk = {
        G, get mode() { return mode; }, get run() { return run; }, get world() { return world; }, save: () => save, camera, scene, renderer, audio,
        start: (w, i) => startLevel(w === 'daily' ? { daily: true } : { world: w, index: i }), attract, tap, pauseGame, resumeGame, showNotes,
        // advance simulation deterministically, optionally tapping perfectly (skill 0..1)
        sim(secs, skill = -1, offset = 0, noise = 0) {
          const n = Math.round(secs * 60);
          for (let i = 0; i < n; i++) {
            if (skill >= 0 && mode === 'play') {
              for (const o of G.ops) { if (o.done || o.harmful) continue; if (o.bot === undefined) o.bot = Math.random() < skill ? offset + (Math.random() - 0.5) * 2 * noise : null; if (o.bot !== null && world.botWants && G.t > o.t - 0.3 && !o.botChecked) { o.botChecked = true; if (!world.botWants(o)) o.bot = null; } }
              const due = G.ops.find(o => !o.done && !o.harmful && o.bot !== null && G.t + 1 / 60 >= o.t + o.bot + INPUT_BIAS);
              if (due) { frameWall = performance.now(); tap(); }
            }
            skipRender = i < n - 1; step(1 / 60);
          }
          skipRender = false;
        },
        freeze(on) { frozen = on; },
        unlockAll() { for (const wid of ORDER) worlds[wid].levels.forEach((_, i) => { save.done[wid + '-' + (i + 1)] = { best: 1, s: [1, 0, 0] }; }); }
      };
    }
  }
};

})();
