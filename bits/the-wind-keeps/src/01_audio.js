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
