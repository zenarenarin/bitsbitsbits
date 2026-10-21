// =====================================================================
// Procedural sound: material, scale and anticipation.
// =====================================================================
function createAudio(enabled) {
  const A = { ok: false, vol: 0.8 };
  let ac, master, wet, nb, wind, windGain, waterGain;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.6 * A.vol;
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 2.2), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.3; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // a constant wind over the basin, and a water bed that swells when water returns
        const mk = (f, q, g) => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; const gg = ac.createGain(); gg.gain.value = g; s.connect(fl); fl.connect(gg); gg.connect(master); s.start(); return { gg, fl }; };
        wind = mk(420, 0.6, 0.05); windGain = wind.gg;
        waterGain = mk(1600, 0.8, 0.0).gg;
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setVolume = v => { A.vol = v; if (master) master.gain.value = 0.6 * v; };
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.4 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.3 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // distance attenuation: callers pass d (metres) and pan (-1..1)
  const att = d => clamp(1 - (d || 0) / 45, 0.05, 1);
  A.step = (mat, k) => {
    const v = 0.05 * (0.6 + k * 0.4);
    if (mat === 'metal') { tone(380 + Math.random() * 60, 0.06, 'triangle', v * 0.7, 300, 0, 0.15); noise(0.04, 'highpass', 3000, 1, v * 0.5, 0, 0, 0.1); }
    else if (mat === 'wood') { tone(160 + Math.random() * 30, 0.07, 'sine', v * 1.2, 120, 0, 0.1); noise(0.05, 'bandpass', 900, 2, v * 0.6, 0, 0, 0.1); }
    else if (mat === 'root') { noise(0.08, 'lowpass', 500, 1, v * 0.9, 300, 0, 0.1); }
    else { noise(0.05, 'bandpass', 1500 + Math.random() * 400, 1.4, v, 900, 0, 0.12); }
  };
  A.jump = () => { noise(0.18, 'bandpass', 700, 1, 0.05, 1600, 0, 0.1); };
  A.land = (p, mat) => { const k = clamp(p / 14, 0.1, 1); noise(0.2 + k * 0.2, 'lowpass', 700, 1, 0.12 * k + 0.03, 120, 0, 0.2); tone(90, 0.2, 'sine', 0.12 * k, 50, 0, 0.1); if (mat === 'metal') tone(260, 0.3, 'triangle', 0.05 * k, 200, 0, 0.3); };
  A.reach = () => { tone(880, 0.25, 'sine', 0.05, 1320, 0, 0.6); noise(0.2, 'bandpass', 3000, 6, 0.04, 6000, 0, 0.6); };
  A.sever = (style, d, pan) => {
    const a = att(d);
    if (style === 'cable') { noise(0.06, 'highpass', 4000, 1, 0.3 * a, 0, 0, 0.4, pan); tone(520, 0.9, 'sawtooth', 0.06 * a, 140, 0, 0.6, pan); tone(1040, 0.6, 'sine', 0.04 * a, 300, 0, 0.6, pan); }
    else if (style === 'chain') { for (let i = 0; i < 6; i++) tone(900 + Math.random() * 500, 0.08, 'triangle', 0.05 * a, 0, i * 0.04, 0.3, pan); }
    else if (style === 'pin') { tone(240, 0.3, 'square', 0.05 * a, 180, 0, 0.3, pan); noise(0.2, 'bandpass', 1800, 4, 0.12 * a, 0, 0, 0.4, pan); }
    else { noise(0.3, 'lowpass', 900, 1, 0.2 * a, 200, 0, 0.4, pan); tone(110, 0.5, 'sawtooth', 0.05 * a, 70, 0, 0.5, pan); }
  };
  // unmaking is quiet: a breath drawn in, a soft paper hush, a low settling tone
  A.unmake = (d, pan, k) => { const a = att(d) * (k || 1); noise(0.42, 'bandpass', 2600, 0.9, 0.16 * a, 500, 0, 0.7, pan); tone(330, 0.5, 'sine', 0.06 * a, 165, 0.02, 0.8, pan); tone(495, 0.35, 'sine', 0.03 * a, 247, 0.05, 0.9, pan); };
  A.crack = (stage, d, pan) => { const a = att(d); noise(0.25, 'highpass', 1500 + stage * 300, 0.8, 0.22 * a, 500, 0, 0.4, pan); tone(120 - stage * 15, 0.3, 'sine', 0.15 * a, 60, 0, 0.3, pan); };
  A.crumble = (d, pan) => { const a = att(d); noise(1.1, 'lowpass', 1400, 0.8, 0.35 * a, 140, 0, 0.6, pan); tone(70, 0.9, 'sine', 0.3 * a, 35, 0, 0.5, pan); for (let i = 0; i < 6; i++) noise(0.1, 'bandpass', 900 + Math.random() * 1500, 2, 0.08 * a, 0, 0.1 + i * 0.12, 0.4, pan); };
  A.strain = (d, pan) => { const a = att(d); tone(70, 1.2, 'sawtooth', 0.08 * a, 52, 0, 0.8, pan); noise(1.0, 'bandpass', 260, 5, 0.12 * a, 180, 0, 0.7, pan); tone(1800, 0.7, 'sine', 0.02 * a, 2400, 0.2, 0.5, pan); };
  A.creak = (d, pan) => { const a = att(d); tone(95, 0.8, 'sawtooth', 0.05 * a, 72, 0, 0.6, pan); tone(140, 0.6, 'sawtooth', 0.03 * a, 120, 0.1, 0.6, pan); };
  A.impact = (p, d, pan) => { const a = att(d), k = clamp(p / 14, 0.15, 1) * a; tone(62, 0.8, 'sine', 0.5 * k, 30, 0, 0.5, pan); noise(0.7, 'lowpass', 500, 1, 0.35 * k, 80, 0, 0.6, pan); };
  A.mech = (d, pan) => { const a = att(d); for (let i = 0; i < 4; i++) tone(200 + i * 40, 0.12, 'square', 0.03 * a, 0, i * 0.09, 0.3, pan); };
  A.flood = (d) => { const a = att(d); noise(3, 'lowpass', 600, 0.7, 0.25 * a, 2000, 0, 0.6); if (waterGain) waterGain.gain.setTargetAtTime(0.03, ac.currentTime, 2); };
  A.relic = () => { [392, 494, 587, 784].forEach((f, i) => tone(f, 1.6, 'sine', 0.07, 0, i * 0.1, 1)); };
  A.salvage = () => { tone(1400, 0.1, 'triangle', 0.05, 0, 0, 0.5); tone(1870, 0.14, 'sine', 0.04, 0, 0.04, 0.6); };
  A.charge = () => { tone(660, 0.25, 'sine', 0.05, 990, 0, 0.6); };
  A.chain = () => { [330, 415, 494, 660].forEach((f, i) => tone(f, 0.7, 'triangle', 0.06, 0, i * 0.08, 0.8)); };
  A.deny = () => { tone(150, 0.12, 'square', 0.04, 120, 0, 0.1); };
  A.knock = () => { noise(0.3, 'lowpass', 600, 1, 0.3, 100, 0, 0.3); tone(80, 0.3, 'sine', 0.25, 40, 0, 0.2); };
  A.catch = () => { tone(300, 0.6, 'sine', 0.08, 600, 0, 0.8); noise(0.5, 'bandpass', 2000, 3, 0.06, 500, 0, 0.8); };
  A.death = () => { tone(110, 1.8, 'sawtooth', 0.07, 40, 0, 0.9); noise(1.5, 'lowpass', 800, 1, 0.16, 90, 0, 0.9); };
  A.restore = () => { [262, 330, 392, 523, 659].forEach((f, i) => tone(f, 2.2, 'sine', 0.06, 0, i * 0.15, 1)); noise(2, 'lowpass', 1200, 0.7, 0.08, 400, 0, 1); };
  A.ambient = (height) => { if (windGain) windGain.gain.setTargetAtTime(0.03 + clamp(height / 40, 0, 0.05), ac.currentTime, 0.5); };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
