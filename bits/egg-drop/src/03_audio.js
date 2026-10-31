// Sound: a small synthesised foley set (wood, brass, shell, air) driven
// by the simulation, plus the Plethora music bed. Everything starts from
// the first real touch.

function createAudio(ctx) {
  const A = { ready: false, muted: false, ac: null };
  let ac = null, master = null, noiseBuf = null;
  let slide = null, roll = null, drone = null, air = null;
  let musicOn = false, musicIntensity = -1;
  const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music);
  const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);

  function loopNoise(filterType, freq, q) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const gn = ac.createGain(); gn.gain.value = 0;
    src.connect(f); f.connect(gn); gn.connect(master); src.start();
    return { src, f, g: gn };
  }

  A.unlock = function () {
    if (canMusic) { try { ctx.music.unlock().catch(() => { }); } catch (e) { } }
    if (A.ready || !canAudio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { return; }
    A.ac = ac;
    master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
    slide = loopNoise('bandpass', 2600, 2.2);
    roll = loopNoise('lowpass', 380, 0.7);
    air = loopNoise('bandpass', 900, 0.5);
    // tension: two low detuned tones under a slow tremolo
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), dg = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    o1.type = 'sine'; o1.frequency.value = 55; o2.type = 'triangle'; o2.frequency.value = 82.6;
    lfo.frequency.value = 1.6; lg.gain.value = 0.35;
    const trem = ac.createGain(); trem.gain.value = 0.65;
    lfo.connect(lg); lg.connect(trem.gain);
    o1.connect(trem); o2.connect(trem); trem.connect(dg); dg.gain.value = 0; dg.connect(master);
    o1.start(); o2.start(); lfo.start();
    drone = { g: dg, o2 };
    if (ac.state === 'suspended') ac.resume().catch(() => { });
    A.ready = true;
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05);
    if (canMusic) { try { if (m) ctx.music.setVolume(0, { fadeMs: 200 }); else ctx.music.setVolume(A.musicVol, { fadeMs: 300 }); } catch (e) { } }
  };
  A.musicVol = 0.32;

  A.music = function (intensity) {
    if (!canMusic) return;
    try {
      if (!musicOn) {
        ctx.music.play({ preset: 'ambient', volume: A.muted ? 0 : A.musicVol, tempo: 66, intensity, density: 0.3, scale: 'lydian', fadeInMs: 2500 });
        musicOn = true; musicIntensity = intensity;
      } else if (Math.abs(intensity - musicIntensity) > 0.04) {
        ctx.music.setIntensity(intensity, { fadeMs: 2500 });
        musicIntensity = intensity;
      }
    } catch (e) { }
  };
  A.sting = function (name) { if (!canMusic || A.muted) return; try { ctx.music.sting(name).catch(() => { }); } catch (e) { } };
  A.duck = function (amt, ms) { if (!canMusic) return; try { ctx.music.duck(amt, ms); } catch (e) { } };

  function env(gn, t, a, peak, dec) {
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(peak, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(type, f, peak, dec, when, f2) {
    if (!A.ready) return;
    const t = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec);
    o.connect(gn); gn.connect(master);
    env(gn, t, 0.003, peak, dec);
    o.start(t); o.stop(t + dec + 0.05);
  }
  function burst(type, freq, q, peak, dec, when, f2) {
    if (!A.ready) return;
    const t = ac.currentTime + (when || 0);
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dec);
    const gn = ac.createGain();
    src.connect(f); f.connect(gn); gn.connect(master);
    env(gn, t, 0.002, peak, dec);
    src.start(t, Math.random() * 1.5); src.stop(t + dec + 0.05);
  }

  // brass carriage picked up / set down
  A.grab = () => { tone('triangle', 1320, 0.05, 0.08); burst('bandpass', 3800, 6, 0.05, 0.03); };
  A.release = () => { tone('triangle', 990, 0.035, 0.07); };
  // carriage hits a rail stop: dull knock plus a short brass ring
  A.clunk = (v) => {
    const k = Math.min(1, v / 2.5);
    tone('sine', 150, 0.22 * k + 0.05, 0.12, 0, 90);
    tone('triangle', 1480, 0.06 * k + 0.02, 0.35);
    tone('sine', 2230, 0.03 * k + 0.01, 0.25);
    burst('lowpass', 900, 1, 0.12 * k, 0.05);
  };
  // the platform meets its end stop: wooden thud
  A.thud = (w) => { const k = Math.min(1, w / 0.6); tone('sine', 120, 0.25 * k + 0.04, 0.16, 0, 70); burst('bandpass', 420, 2, 0.18 * k, 0.07); };
  // shell touching the deck
  A.tick = (v, surface) => {
    const k = Math.min(1, v / 0.8);
    const f = surface === 'metal' ? 5200 : surface === 'ceramic' ? 4200 : surface === 'rubber' ? 1700 : 2900;
    burst('bandpass', f, 9, 0.05 + 0.25 * k, 0.025 + 0.02 * k);
    if (surface === 'metal' || surface === 'ceramic') tone('sine', f * 0.62, 0.02 + 0.05 * k, 0.12);
  };
  // stick-slip creak of the pivot under load
  A.creak = (k) => {
    if (!A.ready) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), gn = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(70 + Math.random() * 50, t); o.frequency.linearRampToValueAtTime(95 + Math.random() * 60, t + 0.18);
    f.type = 'bandpass'; f.frequency.value = 650 + Math.random() * 500; f.Q.value = 7;
    o.connect(f); f.connect(gn); gn.connect(master);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(0.09 * k, t + 0.04);
    gn.gain.linearRampToValueAtTime(0.05 * k, t + 0.12);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.start(t); o.stop(t + 0.3);
  };
  A.gustWarn = () => { burst('bandpass', 400, 0.8, 0.08, 1.2, 0, 1400); };
  A.gust = () => { burst('bandpass', 1200, 0.6, 0.14, 1.0, 0, 380); };
  A.fall = () => { burst('bandpass', 1800, 1.5, 0.12, 0.7, 0, 300); tone('sine', 520, 0.04, 0.5, 0, 260); };
  A.crack = () => {
    burst('highpass', 2500, 0.8, 0.5, 0.06);
    for (let i = 0; i < 5; i++) burst('bandpass', 3000 + Math.random() * 3000, 5, 0.2, 0.02, 0.02 + i * 0.025 + Math.random() * 0.02);
    burst('lowpass', 300, 1, 0.3, 0.18, 0.03);
    tone('sine', 90, 0.18, 0.2, 0.02, 50);
  };
  A.chime = (up) => {
    const base = up ? 784 : 659;
    tone('sine', base, 0.06, 0.6); tone('sine', base * 1.5, 0.035, 0.7, 0.07); tone('triangle', base * 2, 0.015, 0.4, 0.14);
  };

  // continuous layers, set once per rendered frame from smoothed values
  A.update = function (p) {
    if (!A.ready) return;
    const t = ac.currentTime, tc = 0.06;
    slide.g.gain.setTargetAtTime(Math.min(0.22, p.slide * 0.09), t, tc);
    slide.f.frequency.setTargetAtTime(2200 + p.slide * 500, t, tc);
    roll.g.gain.setTargetAtTime(Math.min(0.28, p.roll * 0.16), t, tc);
    roll.f.frequency.setTargetAtTime(260 + p.roll * 260 + (p.surface === 'metal' ? 500 : p.surface === 'ceramic' ? 300 : 0), t, tc);
    drone.g.gain.setTargetAtTime(p.danger * 0.12, t, 0.25);
    drone.o2.frequency.setTargetAtTime(82.6 + p.danger * 6, t, 0.3);
    air.g.gain.setTargetAtTime(p.air * 0.1, t, 0.15);
    air.f.frequency.setTargetAtTime(700 + p.air * 900, t, 0.15);
  };
  A.silenceLayers = function () { if (A.ready) A.update({ slide: 0, roll: 0, danger: 0, air: 0, surface: 'wood' }); };
  A.dispose = function () {
    try { if (canMusic) ctx.music.stop({ fadeOutMs: 200 }); } catch (e) { }
    try { if (ac) ac.close(); } catch (e) { }
  };
  return A;
}
