// Restrained tactile sound, synthesised: each material has its own voice.
// A small generative music-box bed plays under the puzzle; everything is muted together.

function createAudio(ctx) {
  let ac = null, master = null, sfx = null, bed = null, noiseBuf = null, muted = false, musicOn = true, bedTimer = 0, bedStep = 0;
  const can = () => !!(ctx.capabilities && ctx.capabilities.audio);
  function ensure() {
    if (ac || !can()) return ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(master);
      sfx = ac.createGain(); sfx.gain.value = 0.85; sfx.connect(comp);
      bed = ac.createGain(); bed.gain.value = 0.0; bed.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    return ac;
  }
  function unlock() { const a = ensure(); if (a && a.state === 'suspended') a.resume().catch(() => {}); }
  ctx.onDestroy(() => { try { ac && ac.close(); } catch (e) {} });

  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function partial(freq, t, peak, dec, type = 'sine', dest = sfx) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq;
    env(g, t, 0.003, peak, dec); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + 0.05);
  }
  function noise(t, dur, peak, type, f, q, dest = sfx, attack = 0.002) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ac.createGain(); env(g, t, attack, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
  }
  const V = {
    ceramic(k, t) { const f = 1350 + Math.random() * 500; for (const [m, a] of [[1, 0.22], [2.76, 0.1], [5.4, 0.05], [8.9, 0.025]]) partial(f * m, t, a * k, 0.18 + 0.4 / m); noise(t, 0.03, 0.12 * k, 'highpass', 3000, 0.7); },
    glass(k, t) { const f = 2300 + Math.random() * 700; for (const [m, a] of [[1, 0.14], [2.3, 0.07], [4.1, 0.03]]) partial(f * m, t, a * k, 0.9 / m + 0.2); },
    wood(k, t) { const f = 190 + Math.random() * 60; partial(f, t, 0.35 * k, 0.09, 'triangle'); partial(f * 2.4, t, 0.12 * k, 0.05); noise(t, 0.07, 0.3 * k, 'bandpass', 700 + Math.random() * 300, 1.4); },
    metal(k, t) { const f = 820 + Math.random() * 200; for (const [m, a] of [[1, 0.13], [2.4, 0.07], [4.07, 0.04], [6.2, 0.02]]) partial(f * m, t, a * k, 0.35 / Math.sqrt(m)); noise(t, 0.04, 0.12 * k, 'bandpass', 2500, 2); },
    paper(k, t) { for (let i = 0; i < 4; i++) noise(t + i * 0.025 + Math.random() * 0.02, 0.05 + Math.random() * 0.05, 0.16 * k, 'highpass', 2200 + Math.random() * 1500, 0.6, sfx, 0.01); },
    book(k, t) { partial(95 + Math.random() * 20, t, 0.4 * k, 0.12, 'sine'); noise(t, 0.12, 0.28 * k, 'lowpass', 600, 0.7); noise(t + 0.01, 0.06, 0.08 * k, 'highpass', 2600, 0.6); },
    lift(k, t) { noise(t, 0.05, 0.08 * k, 'bandpass', 1400, 1.2, sfx, 0.012); partial(660, t, 0.03 * k, 0.07); },
    nope(k, t) { partial(180, t, 0.18 * k, 0.09, 'triangle'); partial(150, t + 0.09, 0.15 * k, 0.12, 'triangle'); },
    turn(k, t) { noise(t, 0.04, 0.06 * k, 'bandpass', 900, 2, sfx, 0.006); },
    tick(k, t) { partial(1800, t, 0.03 * k, 0.03); },
  };
  function play(name, strength = 1) {
    if (muted || !ensure() || ac.state !== 'running') return;
    const fn = V[name]; if (!fn) return;
    try { fn(Math.max(0.15, Math.min(1.2, strength)), ac.currentTime + 0.005); } catch (e) {}
  }
  // A small rising music-box phrase for the last object.
  function chime(big) {
    if (muted || !ensure() || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02, notes = big ? [0, 4, 7, 12, 16, 19] : [0, 7, 12];
    notes.forEach((n, i) => { const f = 523.25 * Math.pow(2, n / 12); partial(f, t + i * 0.11, 0.12, 1.4); partial(f * 2.01, t + i * 0.11, 0.04, 0.7); partial(f * 3.98, t + i * 0.11, 0.015, 0.3); });
  }
  // Generative music-box bed: sparse pentatonic plucks over a soft drone.
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  function tickBed(dtMs, intensity) {
    if (!ac || ac.state !== 'running' || muted || !musicOn) { if (bed && ac) bed.gain.setTargetAtTime(0, ac.currentTime, 0.4); return; }
    bed.gain.setTargetAtTime(0.5, ac.currentTime, 1.2);
    bedTimer -= dtMs;
    if (bedTimer > 0) return;
    bedTimer = 520 + Math.random() * 380 - intensity * 120;
    bedStep++;
    const t = ac.currentTime + 0.02;
    if (Math.random() < 0.72) {
      const n = SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.2 ? -12 : 0);
      const f = 293.66 * Math.pow(2, n / 12);
      partial(f, t, 0.035, 1.6, 'sine', bed); partial(f * 3.0, t, 0.006, 0.4, 'sine', bed);
    }
    if (bedStep % 16 === 0) { partial(73.42, t, 0.05, 5.5, 'sine', bed); partial(110, t + 0.4, 0.03, 5, 'sine', bed); }
  }
  function setMuted(m) { muted = m; if (master && ac) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); }
  return { unlock, play, chime, tickBed, setMuted, get muted() { return muted; }, set music(v) { musicOn = v; } };
}
