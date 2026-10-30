// =====================================================================
// Sound: wind in the crops, crows, a creaking windmill, a low bed, and
// the gameplay cues (steps, breath, its steps, its breath, the heart).
// Hiding closes a low-pass over the ambience so the field goes quiet.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, muted: false };
  let ac, master, amb, ambLP, nb, windG, windBP, rustG, breathG, breathBP, cBreathG, droneG, distG, distLP;
  function noiseSrc() { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, Math.random() * 1.5); return s; }
  function filt(type, f, q) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; }
  function gain(v) { const g = ac.createGain(); g.gain.value = v; return g; }
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = gain(0.8);
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        amb = gain(1); ambLP = filt('lowpass', 9000, 0.5); amb.connect(ambLP); ambLP.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = nb.getChannelData(0); let b = 0;
        for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
        // wind through the crops
        windBP = filt('bandpass', 520, 0.6); windG = gain(0.05); noiseSrc().connect(windBP); windBP.connect(windG); windG.connect(amb);
        // rustle of stalks as you push through
        const rh = filt('highpass', 2600, 0.5); rustG = gain(0); noiseSrc().connect(rh); rh.connect(rustG); rustG.connect(amb);
        // your breath
        breathBP = filt('bandpass', 1300, 1.4); breathG = gain(0); noiseSrc().connect(breathBP); breathBP.connect(breathG); breathG.connect(master);
        // its breath: low and rasping
        const cb = filt('bandpass', 330, 3); cBreathG = gain(0); noiseSrc().connect(cb); cb.connect(cBreathG); cBreathG.connect(master);
        // the low bed, plus a distorted copy that rises with danger
        droneG = gain(0.035); distG = gain(0); distLP = filt('lowpass', 400, 1);
        const sh = ac.createWaveShaper(); const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
        sh.curve = curve;
        [[49, 'sine'], [49.7, 'sine'], [73.5, 'triangle']].forEach(([f, ty]) => {
          const o = ac.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(droneG); o.connect(sh); o.start();
        });
        droneG.connect(master); sh.connect(distLP); distLP.connect(distG); distG.connect(master);
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  const ramp = (param, v, tc) => { try { param.setTargetAtTime(v, ac.currentTime, tc || 0.12); } catch (e) { } };
  let breathPh = 0, cBreathPh = 0;
  // s: { run (0..1 speed), hidden, prox (0..1), tired (0..1), exert (0..1), searching, dt, playing }
  A.update = function (s) {
    if (!A.ok) return;
    const live = s.playing ? 1 : 0.6;
    ramp(master.gain, A.muted ? 0 : 0.8);
    ramp(ambLP.frequency, s.hidden ? 650 : 9000, 0.25);
    ramp(amb.gain, (s.hidden ? 0.5 : 1) * live, 0.3);
    ramp(windG.gain, 0.04 + 0.025 * Math.sin(Date.now() / 2300) + 0.015 * Math.sin(Date.now() / 700), 0.4);
    ramp(windBP.frequency, 480 + 140 * Math.sin(Date.now() / 3100), 0.5);
    ramp(rustG.gain, s.playing ? s.run * 0.05 + (s.rustle || 0) * 0.06 : 0, 0.08);
    breathPh += s.dt * (1.2 + s.exert * 2.6);
    const bv = Math.max(0, Math.sin(breathPh * Math.PI)) ** 2 * (0.004 + s.tired * 0.05 + s.exert * 0.012) * (s.hidden ? 0.4 : 1);
    ramp(breathG.gain, s.playing ? bv : 0, 0.05);
    cBreathPh += s.dt * 0.55;
    const cv = Math.max(0, Math.sin(cBreathPh * Math.PI)) * s.prox * s.prox * 0.09;
    ramp(cBreathG.gain, s.playing ? cv : 0, 0.08);
    ramp(droneG.gain, (0.03 + s.prox * 0.03) * live, 0.4);
    ramp(distG.gain, s.playing ? s.prox * s.prox * (s.hidden ? 0.015 : 0.035) : 0, 0.3);
    ramp(distLP.frequency, 200 + s.prox * 500, 0.3);
  };
  function blip(f0, f1, dur, type, vol, delay, dest) {
    if (!A.ok) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
  }
  function burst(f, q, dur, vol, delay, dest, type) {
    if (!A.ok) return;
    const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(); s.buffer = nb;
    const fl = filt(type || 'bandpass', f, q), g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  let foot = 0;
  A.step = function (soft) { foot ^= 1; blip(foot ? 120 : 105, 60, 0.05, 'square', soft ? 0.025 : 0.045); burst(900, 1.2, 0.05, soft ? 0.05 : 0.09, 0, amb); };
  A.creatureStep = function (prox) { if (prox < 0.05) return; blip(52, 30, 0.35, 'sine', 0.25 * prox); burst(180, 2, 0.2, 0.15 * prox); };
  A.caw = function () {
    const pan = ac && ac.createStereoPanner ? ac.createStereoPanner() : null; let dest = amb;
    if (pan && A.ok) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(amb); dest = pan; }
    const n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) { blip(620, 360, 0.16, 'sawtooth', 0.012, i * 0.24, dest); burst(1500, 4, 0.15, 0.03, i * 0.24, dest); }
  };
  A.creak = function () { blip(95, 70, 0.7, 'sawtooth', 0.01, 0, amb); blip(140, 120, 0.4, 'sawtooth', 0.006, 0.5, amb); };
  A.rustle = function (v) { burst(3200, 0.6, 0.35, 0.12 * (v || 1), 0, amb, 'highpass'); };
  A.leap = function () { burst(1800, 0.8, 0.12, 0.06); blip(220, 330, 0.08, 'square', 0.025); };
  A.thud = function () { blip(90, 40, 0.18, 'square', 0.08); burst(400, 1, 0.2, 0.2); };
  A.heart = function (v) { blip(62, 40, 0.12, 'sine', 0.35 * v); blip(58, 38, 0.12, 'sine', 0.25 * v, 0.17); };
  A.bats = function () { for (let i = 0; i < 8; i++) burst(4200 + Math.random() * 2000, 3, 0.05, 0.04, i * 0.05 + Math.random() * 0.04, amb); };
  A.sting = function () {
    if (!A.ok) return;
    blip(180, 30, 1.4, 'sawtooth', 0.12); blip(233, 36, 1.3, 'sawtooth', 0.09); burst(300, 0.8, 1.2, 0.5); blip(46, 28, 1.6, 'sine', 0.5);
  };
  // it has turned away: a low, soft resolve under the wind
  A.safe = function () { blip(196, 196, 0.9, 'sine', 0.05); blip(294, 294, 1.1, 'sine', 0.04, 0.18); burst(500, 0.6, 1.2, 0.06, 0, amb); };
  // your hiding place is about to give you away
  A.alarm = function () { blip(70, 52, 0.5, 'sawtooth', 0.05); burst(260, 3, 0.5, 0.18); };
  // crows bursting up from the path
  A.scatter = function (loud) { for (let i = 0; i < 6; i++) burst(2400 + Math.random() * 1600, 2, 0.06, loud ? 0.08 : 0.03, i * 0.035, amb); if (loud) A.caw(); };
  // the creature's joints creak as it moves through the crop
  A.joint = function (v) { if (v < 0.05) return; blip(180 + Math.random() * 60, 110, 0.35, 'sawtooth', 0.012 * v, 0, amb); burst(700, 6, 0.25, 0.05 * v, 0.05); };
  // it has seen you: one low, short stab
  A.spotted = function () { blip(98, 49, 0.45, 'sawtooth', 0.07); blip(73, 37, 0.5, 'square', 0.04, 0.02); burst(220, 1.5, 0.4, 0.25); };
  A.ui = function () { blip(440, 660, 0.06, 'square', 0.03); };
  A.suspend = function () { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = function () { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  A.close = function () { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
