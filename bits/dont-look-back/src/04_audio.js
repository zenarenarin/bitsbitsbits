// Procedural sound: forest bed, the wanderer's body, and the follower placed in space.
function createAudio(enabled) {
  let ac = null, master, bus, lp, comp, noise, wind, windG, leafG, drone, droneG, rumbleG, rumbleO, mBreath, mBreathG, mPan, hidden = 0, vol = 0.9, ok = false;
  const AC = window.AudioContext || window.webkitAudioContext;
  function init() {
    if (ok || !enabled || !AC) return;
    try { ac = new AC(); } catch (e) { return; }
    ok = true;
    comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(ac.destination);
    master = ac.createGain(); master.gain.value = vol; master.connect(comp);
    lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000; lp.connect(master);
    bus = ac.createGain(); bus.connect(lp);
    const len = ac.sampleRate * 2, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    let br = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; d[i] = i % 2 ? w * 0.6 : br * 3.5 + w * 0.15; }
    noise = b;
    // wind through the trees
    const wn = loopNoise(); const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.5;
    windG = ac.createGain(); windG.gain.value = 0.0; wn.connect(wf); wf.connect(windG); windG.connect(bus); wind = wf;
    const ln = loopNoise(); const lf = ac.createBiquadFilter(); lf.type = 'highpass'; lf.frequency.value = 3800; leafG = ac.createGain(); leafG.gain.value = 0; ln.connect(lf); lf.connect(leafG); leafG.connect(bus);
    // low drone
    droneG = ac.createGain(); droneG.gain.value = 0; const df = ac.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 260; df.connect(droneG); droneG.connect(bus);
    drone = [55, 55.4, 82.6, 41.2].map((f, i) => { const o = ac.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; const g = ac.createGain(); g.gain.value = i === 2 ? 0.25 : 0.35; o.connect(g); g.connect(df); o.start(); return o; });
    rumbleO = ac.createOscillator(); rumbleO.type = 'sine'; rumbleO.frequency.value = 31; rumbleG = ac.createGain(); rumbleG.gain.value = 0; rumbleO.connect(rumbleG); rumbleG.connect(master); rumbleO.start();
    // the follower's breath, placed in space
    mPan = ac.createPanner(); mPan.panningModel = 'HRTF'; mPan.distanceModel = 'inverse'; mPan.refDistance = 2.5; mPan.rolloffFactor = 1.1; mPan.connect(bus);
    const mb = loopNoise(); const mf = ac.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 340; mf.Q.value = 2.5; mBreathG = ac.createGain(); mBreathG.gain.value = 0; mb.connect(mf); mf.connect(mBreathG);
    const growl = ac.createOscillator(); growl.type = 'sawtooth'; growl.frequency.value = 62; const gf = ac.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180; const gg = ac.createGain(); gg.gain.value = 0.25; growl.connect(gf); gf.connect(gg); gg.connect(mBreathG); growl.start();
    mBreathG.connect(mPan); mBreath = mf;
  }
  function loopNoise() { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }
  function burst(t, dur, f0, type, q, gain, dest, f1) {
    const s = ac.createBufferSource(); s.buffer = noise; const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 0.7;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || bus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  function tone(t, dur, f0, f1, type, gain, dest, attack) {
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function panned(x) { const p = ac.createStereoPanner ? ac.createStereoPanner() : null; if (!p) return bus; p.pan.value = clamp(x, -1, 1); p.connect(bus); return p; }
  const api = {
    unlock() { init(); if (ac && ac.state === 'suspended') ac.resume().catch(() => { }); },
    suspend() { if (ac && ac.state === 'running') ac.suspend().catch(() => { }); },
    resume() { if (ac && ac.state === 'suspended') ac.resume().catch(() => { }); },
    close() { try { if (ac) ac.close(); } catch (e) { } },
    get ready() { return ok && ac.state === 'running'; },
    // continuous mix: danger 0..1, hide 0..1, stage 0..3, ambient on/off
    mix(k) {
      if (!ok) return; const t = ac.currentTime;
      hidden = k.hide;
      windG.gain.setTargetAtTime((0.11 + k.gust * 0.12) * (1 - k.hide * 0.55) * k.amb, t, 0.4);
      wind.frequency.setTargetAtTime(300 + k.gust * 420, t, 0.6);
      leafG.gain.setTargetAtTime((0.012 + k.gust * 0.03) * (1 - k.hide * 0.6) * k.amb, t, 0.4);
      droneG.gain.setTargetAtTime((0.035 + k.stage * 0.012 + k.danger * 0.06) * k.amb, t, 1.2);
      drone[0].detune.setTargetAtTime(k.danger * -40, t, 1); drone[1].detune.setTargetAtTime(18 + k.danger * 30, t, 1);
      rumbleG.gain.setTargetAtTime(k.danger * k.danger * 0.22 * k.amb, t, 0.5);
      lp.frequency.setTargetAtTime(k.hide > 0.5 ? 2400 : k.over ? 900 : 16000, t, 0.35);
      mBreathG.gain.setTargetAtTime(k.mVol * 0.5, t, 0.25);
      mBreath.frequency.setTargetAtTime(260 + Math.sin(t * 1.7) * 80 + k.mVol * 60, t, 0.1);
    },
    listener(px, py, pz, fx, fz) {
      if (!ok) return; const L = ac.listener, t = ac.currentTime;
      if (L.positionX) { L.positionX.setTargetAtTime(px, t, 0.05); L.positionY.setTargetAtTime(py, t, 0.05); L.positionZ.setTargetAtTime(pz, t, 0.05); L.forwardX.setTargetAtTime(fx, t, 0.05); L.forwardY.setTargetAtTime(0, t, 0.05); L.forwardZ.setTargetAtTime(fz, t, 0.05); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else if (L.setPosition) { L.setPosition(px, py, pz); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    },
    follower(x, y, z) { if (!ok) return; if (mPan.positionX) { const t = ac.currentTime; mPan.positionX.setTargetAtTime(x, t, 0.05); mPan.positionY.setTargetAtTime(y, t, 0.05); mPan.positionZ.setTargetAtTime(z, t, 0.05); } else mPan.setPosition(x, y, z); },
    // ---- one-shots ----
    step(heavy) { if (!ok) return; const t = ac.currentTime; burst(t, 0.07, 700 + Math.random() * 300, 'lowpass', 0.8, 0.22 * (heavy ? 1.3 : 1)); burst(t + 0.005, 0.05, 3200 + Math.random() * 2000, 'bandpass', 1.2, 0.05); },
    cloth() { if (!ok) return; burst(ac.currentTime, 0.16, 1800, 'bandpass', 0.6, 0.025); },
    breath(level, inhale) { if (!ok) return; const t = ac.currentTime; burst(t, inhale ? 0.38 : 0.3, inhale ? 1500 : 900, 'bandpass', 1.4, 0.03 + level * 0.09, null, inhale ? 2100 : 650); },
    heart(level) { if (!ok) return; const t = ac.currentTime; tone(t, 0.16, 62, 40, 'sine', 0.25 + level * 0.4, master); tone(t + 0.19, 0.14, 55, 38, 'sine', 0.16 + level * 0.3, master); },
    mStep(gain) { if (!ok) return; const t = ac.currentTime; tone(t, 0.32, 70, 32, 'sine', 0.5 * gain, mPan); burst(t, 0.18, 260, 'lowpass', 1, 0.5 * gain, mPan); burst(t + 0.02, 0.09, 2200, 'bandpass', 2, 0.12 * gain, mPan); },
    owl() { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() * 2 - 1); const f = 380 + Math.random() * 60; tone(t, 0.32, f, f * 0.92, 'sine', 0.045, d, 0.06); tone(t + 0.42, 0.22, f * 1.02, f * 0.9, 'sine', 0.03, d, 0.05); tone(t + 0.7, 0.55, f, f * 0.86, 'sine', 0.04, d, 0.08); },
    creak(gain) { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() * 2 - 1); const f = 90 + Math.random() * 60; const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.7); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 6; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * (gain || 1), t + 0.15); g.gain.linearRampToValueAtTime(0.0001, t + 0.8); o.connect(bp); bp.connect(g); g.connect(d); o.start(t); o.stop(t + 0.85); },
    crash() { if (!ok) return; const t = ac.currentTime; burst(t, 1.4, 600, 'lowpass', 0.6, 0.6, null, 120); tone(t, 0.8, 48, 30, 'sine', 0.6, master); burst(t + 0.05, 0.6, 2500, 'bandpass', 0.8, 0.12, null, 600); },
    bats() { if (!ok) return; const t = ac.currentTime; for (let i = 0; i < 26; i++) burst(t + i * 0.045 + Math.random() * 0.02, 0.04, 2600 + Math.random() * 1500, 'bandpass', 3, 0.035, panned(-1 + i / 13)); tone(t + 0.2, 0.08, 7200, 6800, 'sine', 0.01); tone(t + 0.5, 0.08, 7600, 7000, 'sine', 0.008); },
    hiss() { if (!ok) return; burst(ac.currentTime, 0.5, 4000, 'highpass', 0.7, 0.06); },
    snap() { if (!ok) return; const t = ac.currentTime; burst(t, 0.06, 2600, 'bandpass', 2, 0.2); burst(t + 0.03, 0.18, 500, 'lowpass', 1, 0.2); },
    stumble() { if (!ok) return; const t = ac.currentTime; burst(t, 0.25, 500, 'lowpass', 0.7, 0.4); burst(t, 0.3, 3000, 'bandpass', 0.9, 0.12, null, 900); tone(t, 0.15, 90, 50, 'sine', 0.3, master); },
    hideRustle() { if (!ok) return; const t = ac.currentTime; burst(t, 0.45, 2400, 'bandpass', 0.7, 0.09, null, 900); burst(t + 0.1, 0.2, 600, 'lowpass', 1, 0.12); },
    whisper() { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() < 0.5 ? -0.8 : 0.8); for (let i = 0; i < 3; i++) burst(t + i * 0.22, 0.25, 2200 + Math.random() * 1500, 'bandpass', 6, 0.035, d); },
    stage() { if (!ok) return; const t = ac.currentTime; tone(t, 4, 110, 104, 'sine', 0.05, bus, 1.2); tone(t, 4, 164.8, 160, 'sine', 0.035, bus, 1.4); tone(t + 0.3, 3.6, 233, 228, 'triangle', 0.015, bus, 1.5); },
    sting() { if (!ok) return; const t = ac.currentTime; for (const f of [58, 61.7, 87, 123.5]) tone(t, 2.6, f, f * 0.82, 'sawtooth', 0.09, master, 0.04); burst(t, 1.8, 1800, 'bandpass', 0.5, 0.45, master, 200); tone(t, 1.5, 36, 24, 'sine', 0.8, master); },
    setVolume(v) { vol = v; if (ok) master.gain.setTargetAtTime(v, ac.currentTime, 0.1); }
  };
  return api;
}
