// Material sounds, synthesised with WebAudio so every contact can be tuned to
// the object's size and the strength of the impact. No samples are loaded.

function createAudio() {
  let ac = null, master = null, verb = null, muted = false, noiseBuf = null;
  let lastCreak = 0;
  const lastHit = new Map();

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ac = new AC(); } catch (e) { ac = null; return false; }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ac.destination);
    // a small, dark room: a feedback delay network is enough for warmth
    verb = ac.createGain(); verb.gain.value = 0.18;
    const d1 = ac.createDelay(0.2), d2 = ac.createDelay(0.2), fb = ac.createGain(), lp = ac.createBiquadFilter();
    d1.delayTime.value = 0.037; d2.delayTime.value = 0.053; fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 2400;
    verb.connect(d1); d1.connect(d2); d2.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(master);
    const len = ac.sampleRate * 0.5;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; ch[i] = (s / 2147483647) * 2 - 1; }
    return true;
  }

  function out(node, wet) {
    node.connect(master);
    if (wet) { const w = ac.createGain(); w.gain.value = wet; node.connect(w); w.connect(verb); }
  }

  // A decaying sine partial.
  function partial(t, f, amp, decay, wet, attack = 0.002) {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(amp, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(gn); out(gn, wet);
    o.start(t); o.stop(t + decay + 0.05);
  }
  // A filtered noise burst.
  function noise(t, f, q, amp, decay, type = 'bandpass', wet = 0) {
    const src = ac.createBufferSource(), flt = ac.createBiquadFilter(), gn = ac.createGain();
    src.buffer = noiseBuf; flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    gn.gain.setValueAtTime(amp, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(flt); flt.connect(gn); out(gn, wet);
    src.start(t, Math.random() * 0.3); src.stop(t + decay + 0.05);
  }

  // strength 0..1, size ~ object height in units (bigger sounds lower)
  const VOICES = {
    ceramic(t, s, k) { // delicate hollow clink
      partial(t, 1850 * k, 0.22 * s, 0.16, 0.5);
      partial(t, 2980 * k, 0.13 * s, 0.11, 0.5);
      partial(t, 4410 * k, 0.07 * s, 0.07, 0.4);
      noise(t, 900 * k, 3, 0.18 * s, 0.05);
    },
    brass(t, s, k) { // soft metallic resonance
      partial(t, 410 * k, 0.16 * s, 1.3, 0.8, 0.004);
      partial(t, 1105 * k, 0.11 * s, 0.9, 0.8, 0.004);
      partial(t, 1890 * k, 0.07 * s, 0.6, 0.7);
      partial(t, 2710 * k, 0.04 * s, 0.4, 0.6);
      noise(t, 2600 * k, 2, 0.06 * s, 0.03);
    },
    glass(t, s, k) { // light ringing
      partial(t, 3150 * k, 0.12 * s, 0.7, 0.9);
      partial(t, 4720 * k, 0.07 * s, 0.5, 0.9);
      partial(t, 6930 * k, 0.04 * s, 0.35, 0.8);
      noise(t, 5000, 4, 0.05 * s, 0.02);
    },
    fruit(t, s, k) { // muted organic thud
      partial(t, 95 * k, 0.4 * s, 0.09, 0.1);
      noise(t, 380 * k, 1, 0.35 * s, 0.07, 'lowpass');
    },
    books(t, s, k) { // soft heavy contact
      partial(t, 72, 0.45 * s, 0.12, 0.15);
      noise(t, 260, 0.8, 0.45 * s, 0.11, 'lowpass');
      noise(t, 1600, 1.2, 0.06 * s, 0.03);
    },
    wood(t, s, k) {
      partial(t, 190 * k, 0.25 * s, 0.12, 0.3);
      partial(t, 360 * k, 0.12 * s, 0.08, 0.3);
      noise(t, 700 * k, 2, 0.15 * s, 0.05);
    }
  };

  return {
    unlock: ensure,
    get ready() { return !!ac; },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
    get muted() { return muted; },
    // Impact between a body and something; throttled per body.
    hit(key, material, strength, size) {
      if (!ac || muted || strength < 0.03) return;
      const now = ac.currentTime;
      const last = lastHit.get(key) || 0;
      if (now - last < 0.07) return;
      lastHit.set(key, now);
      const k = clamp(0.55 / Math.max(0.2, size), 0.55, 1.8);
      const v = VOICES[material] || VOICES.wood;
      v(now + 0.005, clamp(strength, 0, 1), k);
    },
    // Restrained wooden creak: stick-slip grains through a resonant filter.
    creak(intensity) {
      if (!ac || muted) return;
      const now = ac.currentTime;
      if (now - lastCreak < 0.9) return;
      lastCreak = now;
      const o = ac.createOscillator(), flt = ac.createBiquadFilter(), gn = ac.createGain();
      o.type = 'sawtooth';
      const f0 = 70 + Math.random() * 40;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.linearRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), now + 0.45);
      flt.type = 'bandpass'; flt.frequency.value = 640 + Math.random() * 300; flt.Q.value = 7;
      gn.gain.setValueAtTime(0.0001, now);
      const a = 0.05 + 0.08 * clamp(intensity, 0, 1);
      for (let i = 0; i < 9; i++) {
        const t = now + i * 0.05 + Math.random() * 0.02;
        gn.gain.linearRampToValueAtTime(a * (0.4 + Math.random() * 0.6), t + 0.008);
        gn.gain.linearRampToValueAtTime(a * 0.08, t + 0.035);
      }
      gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      o.connect(flt); flt.connect(gn); out(gn, 0.4);
      o.start(now); o.stop(now + 0.6);
    },
    // Quiet paper/cloth swish when an object is picked up.
    pick() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      noise(t, 1800, 0.7, 0.05, 0.12, 'bandpass');
    },
    // Two soft brass chimes for a bonus.
    chime(up) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      partial(t, up ? 880 : 660, 0.07, 1.1, 0.9, 0.005);
      partial(t + 0.11, up ? 1320 : 990, 0.06, 1.2, 0.9, 0.005);
    },
    dispose() { if (ac) { try { ac.close(); } catch (e) {} ac = null; } }
  };
}
