// =====================================================================
// Sound: procedural, physical and sparse. The city has a slow mechanical
// heartbeat and a wind; each lamp hums while it turns; the Watcher's
// states each have a voice (a breath drawn in when it notices, a ping
// when it tracks, a bell when it hunts, a hard shut when it captures).
// Materials sound different underfoot. Silence is allowed.
// =====================================================================
function createAudio() {
  const A = { ok: false, on: true };
  let ac, master, sfx, wet, nb, wind, hum, humGain, tick = 0, pingT = 0;
  A.unlock = function () {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.on ? 0.9 : 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; master.connect(comp); comp.connect(ac.destination);
        sfx = ac.createGain(); sfx.gain.value = 0.8; sfx.connect(master);
        const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.32; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // wind between the houses
        const ws = ac.createBufferSource(); ws.buffer = nb; ws.loop = true;
        const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.7;
        wind = ac.createGain(); wind.gain.value = 0.035; ws.connect(wf); wf.connect(wind); wind.connect(master); ws.start();
        A.windF = wf;
        // the lamps' motor: a low, filtered saw
        hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 52;
        const hf = ac.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 240; hf.Q.value = 3;
        humGain = ac.createGain(); humGain.gain.value = 0; hum.connect(hf); hf.connect(humGain); humGain.connect(sfx); hum.start();
        A.humF = hf;
        // being lit: a thin, high hiss that grows with how much of you is in the light
        const es = ac.createBufferSource(); es.buffer = nb; es.loop = true;
        const ef = ac.createBiquadFilter(); ef.type = 'bandpass'; ef.frequency.value = 5200; ef.Q.value = 4;
        A.litGain = ac.createGain(); A.litGain.gain.value = 0; es.connect(ef); ef.connect(A.litGain); A.litGain.connect(sfx); es.start();
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setOn = on => { A.on = on; if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05); };
  function out(node, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    n.connect(sfx);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, rev === undefined ? 0.3 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.002) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, rev === undefined ? 0.2 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const R = () => Math.random();
  // ---- the body
  A.step = (mat, k) => {
    const v = 0.05 * (0.5 + k * 0.5);
    if (mat === 'balcony') { tone(520 + R() * 80, 0.05, 'triangle', v * 0.5, 380, 0, 0.12); noise(0.035, 'highpass', 3500, 1, v * 0.5, 0, 0, 0.08); }
    else if (mat === 'roof') { noise(0.05, 'bandpass', 2400 + R() * 600, 2, v * 0.9, 1400, 0, 0.1); tone(300 + R() * 60, 0.04, 'triangle', v * 0.3, 0, 0.015, 0.1); }
    else if (mat === 'awning') { noise(0.09, 'lowpass', 500, 1, v * 1.2, 200, 0, 0.05); }
    else { noise(0.05, 'bandpass', 1300 + R() * 400, 1.5, v, 700, 0, 0.12); }
  };
  A.jump = () => { noise(0.16, 'bandpass', 900, 1, 0.035, 2200, 0, 0.06); };
  A.land = (v, mat) => {
    const k = clamp(v / 18, 0.08, 1);
    noise(0.12 + k * 0.2, 'lowpass', mat === 'awning' ? 380 : 800, 1, 0.07 + 0.12 * k, 120, 0, 0.15);
    if (mat === 'balcony') tone(180, 0.25, 'triangle', 0.05 * k, 120, 0, 0.3);
    if (k > 0.7) tone(70, 0.3, 'sine', 0.18 * k, 40, 0, 0.2);
  };
  A.grab = what => {
    noise(0.04, 'bandpass', 2200, 2, 0.08, 0, 0, 0.1);
    if (what === 'pipe') tone(880 + R() * 60, 0.18, 'triangle', 0.035, 840, 0, 0.3);
    if (what === 'rope') { noise(0.25, 'bandpass', 600, 4, 0.05, 300, 0, 0.3); tone(140, 0.4, 'sawtooth', 0.02, 110, 0, 0.2); }
  };
  A.pullup = () => { noise(0.2, 'bandpass', 700, 1, 0.04, 400, 0, 0.1); };
  A.climb = () => { noise(0.06, 'bandpass', 1800 + R() * 400, 3, 0.03, 900, 0, 0.1); };
  A.slide = () => { noise(0.45, 'bandpass', 1800, 0.8, 0.06, 500, 0, 0.1); };
  A.vault = () => { noise(0.2, 'bandpass', 1200, 1, 0.04, 2400, 0, 0.1); };
  A.ropeCreak = k => { tone(160 + R() * 30, 0.3, 'sawtooth', 0.012 * k, 120, 0, 0.3); };
  // ---- the city's mechanisms
  A.awningOut = () => {
    for (let i = 0; i < 6; i++) { tone(1400 + i * 30, 0.03, 'square', 0.022, 0, i * 0.045, 0.3); noise(0.02, 'highpass', 4000, 1, 0.03, 0, i * 0.045, 0.2); }
    noise(0.5, 'lowpass', 900, 0.8, 0.16, 150, 0.32, 0.4);
    tone(90, 0.4, 'sine', 0.12, 60, 0.34, 0.3);
  };
  A.awningWarn = () => { for (let i = 0; i < 3; i++) tone(1700, 0.025, 'square', 0.018, 0, i * 0.12, 0.2); };
  A.awningBack = () => { noise(0.5, 'lowpass', 700, 0.8, 0.1, 200, 0, 0.3); for (let i = 0; i < 8; i++) tone(1500 - i * 40, 0.025, 'square', 0.015, 0, 0.05 + i * 0.05, 0.2); };
  A.shutter = (d, pan) => { const a = clamp(1 - d / 40, 0.15, 1); for (let i = 0; i < 10; i++) noise(0.06, 'bandpass', 1200 + R() * 900, 3, 0.07 * a, 0, i * 0.11, 0.35, pan); tone(110, 1.2, 'sawtooth', 0.025 * a, 90, 0, 0.4, pan); };
  A.shutterShut = (d, pan) => { const a = clamp(1 - d / 40, 0.15, 1); noise(0.5, 'lowpass', 1200, 1, 0.3 * a, 120, 0, 0.6, pan); tone(60, 0.6, 'sine', 0.25 * a, 35, 0, 0.5, pan); };
  A.door = (d, pan) => { const a = clamp(1 - d / 30, 0.2, 1); tone(220, 1.1, 'sawtooth', 0.03 * a, 160, 0, 0.5, pan, 0.3); tone(330, 0.9, 'sawtooth', 0.015 * a, 300, 0.2, 0.5, pan, 0.2); };
  A.cityTick = () => { noise(0.08, 'bandpass', 420, 6, 0.035, 300, 0, 0.9); tone(98, 0.5, 'sine', 0.025, 92, 0, 0.9); };
  // ---- the Watcher's voice
  A.notice = () => { tone(330, 0.9, 'sine', 0.06, 494, 0, 0.7, 0, 0.25); tone(990, 0.7, 'sine', 0.012, 1480, 0.1, 0.8, 0, 0.3); noise(0.8, 'bandpass', 3000, 8, 0.02, 5000, 0, 0.8, 0, 0.3); };
  A.settle = () => { tone(494, 0.9, 'sine', 0.035, 330, 0, 0.8, 0, 0.1); };
  A.investigate = () => { tone(196, 0.6, 'triangle', 0.04, 247, 0, 0.8); tone(247, 0.6, 'triangle', 0.03, 196, 0.35, 0.8); };
  A.track = () => { tone(740, 0.35, 'square', 0.03, 0, 0, 0.5); tone(988, 0.5, 'square', 0.025, 0, 0.12, 0.6); noise(0.4, 'highpass', 2000, 1, 0.05, 0, 0, 0.4); };
  A.hunt = () => { [196, 233, 311, 466, 523].forEach((f, i) => tone(f * 1.003 ** i, 2.6, 'sine', 0.05 / (1 + i * 0.4), f * 0.99, 0, 1, 0, 0.004)); noise(1.4, 'bandpass', 900, 2, 0.05, 300, 0, 0.8); };
  A.lost = () => { tone(392, 1.2, 'sine', 0.035, 262, 0, 0.9, 0, 0.15); };
  A.capture = () => { noise(0.08, 'highpass', 3000, 1, 0.3, 0, 0, 0.3); tone(55, 1.4, 'sine', 0.35, 35, 0, 0.6); [523, 554, 587, 622].forEach((f, i) => tone(f, 1.8, 'sine', 0.03, f * 0.98, 0.02, 1, 0, 0.01)); };
  A.escape = () => { [262, 330, 392, 494, 587].forEach((f, i) => tone(f, 2.6, 'sine', 0.045, 0, i * 0.16, 1, 0, 0.05)); noise(2.4, 'lowpass', 900, 0.7, 0.05, 300, 0, 1, 0, 0.6); };
  A.ui = () => { tone(660, 0.08, 'sine', 0.03, 0, 0, 0.2); };
  // ---- continuous: called every frame with the scene's state
  A.frame = function (dt, S) {
    if (!A.ok) return;
    const t = ac.currentTime;
    // the lamps hum when they are near and turning
    humGain.gain.setTargetAtTime(S.hum * 0.06, t, 0.15);
    A.litGain.gain.setTargetAtTime((S.lit || 0) * 0.05, t, 0.05);
    hum.frequency.setTargetAtTime(48 + S.humTurn * 40, t, 0.2);
    A.humF.frequency.setTargetAtTime(200 + S.tension * 600, t, 0.3);
    wind.gain.setTargetAtTime(0.03 + S.height * 0.003, t, 0.6);
    // the city's slow heartbeat, faster when the Watcher hunts
    tick -= dt;
    if (tick <= 0) { tick = S.tension > 0.8 ? 0.7 : S.tension > 0.5 ? 1.0 : 1.6; if (S.playing) A.cityTick(); }
    // tracking pings carry the lock-on
    if (S.lock > 0 && S.tracking) {
      pingT -= dt;
      if (pingT <= 0) { pingT = lerp(0.6, 0.16, S.lock); tone(1320, 0.06, 'sine', 0.02 + S.lock * 0.04, 0, 0, 0.3); }
    } else pingT = 0;
  };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
