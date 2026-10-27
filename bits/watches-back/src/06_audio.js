// =====================================================================
// Sound: a small, dry vocabulary. Every cue with a meaning means one
// thing, every time, and has something on screen that agrees with it.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, vol: 0.85 };
  let ac, master, wet, nb, room, roomGain, roomLp, fric, fricGain, fricBp, drone, droneGain, heartT = 0;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.7 * A.vol;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; master.connect(comp); comp.connect(ac.destination);
        // a small dry room: short, dark reverb
        const len = Math.floor(ac.sampleRate * 1.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        const wlp = ac.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 2400;
        wet = ac.createGain(); wet.gain.value = 0.35; wet.connect(wlp); wlp.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const nd = nb.getChannelData(0); let br = 0;
        for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; nd[i] = i % 2 ? w : br * 3.5; }
        const loop = (type, f, q) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return { s, fl, g }; };
        // room tone: very low, almost felt rather than heard
        room = loop('lowpass', 140, 0.7); roomGain = room.g; roomLp = room.fl;
        // the spiral's friction when it turns
        fric = loop('bandpass', 380, 3.5); fricGain = fric.g; fricBp = fric.fl;
        // the unblinking's presence
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 41;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
        droneGain = ac.createGain(); droneGain.gain.value = 0; o.connect(lp); lp.connect(droneGain); droneGain.connect(master); o.start(); drone = o;
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setVolume = v => { A.vol = v; if (master) master.gain.setTargetAtTime(0.7 * v, ac.currentTime, 0.05); };
  A.suspend = () => { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = () => { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.3 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.25 : rev, pan); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  // --- the traveller ---
  A.step = (pan, soft) => noise(0.05, 'bandpass', 1400 + Math.random() * 500, 1.6, soft ? 0.012 : 0.022, 700, 0, 0.1, pan);
  A.cross = () => { noise(0.22, 'bandpass', 900, 1.2, 0.05, 300, 0, 0.3); tone(110, 0.25, 'sine', 0.04, 80, 0, 0.2); };
  A.bump = () => { noise(0.08, 'lowpass', 500, 1, 0.06, 200, 0, 0.1); };
  // --- gaze ---
  A.acquire = pan => tone(560, 0.18, 'sine', 0.012, 840, 0, 0.3, pan, 0.06);
  A.pin = (pan, big) => { noise(0.025, 'highpass', 3200, 1, 0.09, 0, 0, 0.15, pan); tone(big ? 70 : 92, 0.14, 'sine', 0.09, 60, 0, 0.1, pan); };
  A.release = pan => { noise(0.32, 'bandpass', 900, 0.8, 0.035, 300, 0, 0.35, pan, 0.08); };
  A.feign = pan => { noise(0.45, 'bandpass', 600, 1.2, 0.04, 1800, 0, 0.4, pan, 0.2); };       // an inhale, not a click: the liar's tell
  A.lunge = pan => { noise(0.35, 'bandpass', 2200, 2.5, 0.07, 500, 0, 0.25, pan, 0.02); noise(0.25, 'lowpass', 400, 1, 0.08, 120, 0.05, 0.2, pan); };
  A.immune = pan => { tone(46, 0.6, 'sine', 0.12, 40, 0, 0.5, pan, 0.04); };
  A.reveal = pan => { noise(0.6, 'bandpass', 2600, 1.5, 0.03, 900, 0, 0.6, pan, 0.05); };
  // --- eyes ---
  A.track = pan => noise(0.03, 'bandpass', 3800 + Math.random() * 1500, 4, 0.006, 0, 0, 0.1, pan);
  A.wake = pan => { noise(0.18, 'bandpass', 1300, 2, 0.03, 2400, 0, 0.3, pan, 0.04); };
  A.turnEye = pan => noise(0.06, 'lowpass', 300, 1, 0.025, 0, 0, 0.1, pan);
  A.ripple = (pan, n) => { const base = 330; [0, 1, 6].forEach((k, i) => tone(base * Math.pow(2, k / 12), 0.9, 'sine', 0.018, 0, i * 0.09, 0.7, pan, 0.08)); };
  A.choirBreak = pan => { [440, 415, 392, 349].forEach((f, i) => tone(f, 1.1, 'triangle', 0.03, f * 0.7, i * 0.06, 0.8, pan)); };
  A.gather = pan => { tone(62, 0.8, 'sawtooth', 0.025, 50, 0, 0.4, pan, 0.2); };
  A.knot = pan => { noise(0.4, 'lowpass', 700, 1, 0.12, 120, 0, 0.3, pan); tone(55, 0.6, 'sine', 0.12, 38, 0, 0.3, pan); };
  A.unravel = pan => { for (let i = 0; i < 4; i++) noise(0.12, 'bandpass', 1500 + i * 400, 2, 0.04, 600, i * 0.05, 0.4, pan); };
  A.chain = n => { for (let i = 0; i < Math.min(5, n); i++) tone(660 * Math.pow(2, [0, 3, 7, 10, 12][i] / 12), 0.5, 'triangle', 0.03, 0, i * 0.07, 0.6); };
  A.absorb = pan => { noise(0.5, 'lowpass', 500, 2, 0.1, 80, 0, 0.4, pan); };
  A.jam = () => { tone(68, 0.35, 'sawtooth', 0.04, 55, 0, 0.3); noise(0.2, 'bandpass', 250, 4, 0.06, 150, 0, 0.2); };
  A.fixate = pan => tone(1200, 0.25, 'sine', 0.012, 900, 0, 0.3, pan);
  A.crownBreak = pan => { noise(0.6, 'highpass', 1800, 1, 0.08, 600, 0, 0.6, pan); tone(98, 1.4, 'sawtooth', 0.04, 49, 0, 0.8, pan); };
  A.unseal = () => { [196, 233, 294].forEach((f, i) => tone(f, 2.4, 'sine', 0.04, 0, i * 0.2, 1)); };
  A.close = () => tone(1800, 0.06, 'sine', 0.006, 0, 0, 0.1);
  // --- the run ---
  A.capture = () => { noise(0.08, 'highpass', 4000, 1, 0.12, 0, 0, 0.1); tone(48, 1.6, 'sine', 0.3, 30, 0.05, 0.8); noise(1.4, 'lowpass', 900, 1, 0.2, 60, 0.05, 0.8); };
  A.descend = () => { noise(1.6, 'bandpass', 1800, 1.2, 0.06, 120, 0, 0.7, 0, 0.6); tone(73, 2.2, 'sine', 0.06, 55, 0.4, 0.9, 0, 0.3); };
  A.arrive = () => { tone(220, 1.8, 'sine', 0.025, 0, 0, 0.9, 0, 0.3); };
  A.ending = () => { [55, 82.5, 110].forEach((f, i) => tone(f, 6, 'sine', 0.06, f * 0.99, i * 0.6, 1, 0, 1.5)); };
  // continuous state: room tone, friction under rotation, heartbeat for exposure, the unblinking drone
  A.ambient = (o, dt) => {
    if (!A.ok) return;
    const t = ac.currentTime;
    roomGain.gain.setTargetAtTime(o.quiet ? 0.002 : 0.05 + 0.04 * (o.dread || 0), t, 0.6);
    roomLp.frequency.setTargetAtTime(110 + 90 * (o.dread || 0), t, 1);
    fricGain.gain.setTargetAtTime(Math.min(0.09, Math.abs(o.rot || 0) * 0.08), t, 0.05);
    fricBp.frequency.setTargetAtTime(300 + Math.abs(o.rot || 0) * 220, t, 0.1);
    droneGain.gain.setTargetAtTime((o.unblinking || 0) * 0.07, t, 0.4);
    if (drone) drone.frequency.setTargetAtTime(38 + (o.unblinking || 0) * 10, t, 0.4);
    if (o.exposure > 0.02) {
      heartT -= dt;
      if (heartT <= 0) { heartT = 0.85 - o.exposure * 0.5; tone(54, 0.16, 'sine', 0.1 + o.exposure * 0.12, 40, 0, 0.1); tone(50, 0.14, 'sine', 0.07 + o.exposure * 0.1, 38, 0.17, 0.1); }
    } else heartT = 0;
  };
  A.kill = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
