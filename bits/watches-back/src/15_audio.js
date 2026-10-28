// =====================================================================
// Sound: sparse, synthesised, tied to what the network does. A low bed
// that tightens with attention; distinct voices for noticing, pinning,
// releasing, links forming and snapping, and stone that begins to move.
// Silence is allowed to happen.
// =====================================================================
function createAudio() {
  const A = { ok: false, on: true, vol: 0.85 };
  let ac = null, master, wet, nb, bed = null, acqVoice = null, rumble = null;
  A.unlock = () => {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.on ? A.vol : 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
        master.connect(comp); comp.connect(ac.destination);
        // a long dark room
        const len = Math.floor(ac.sampleRate * 3.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.55; wet.connect(conv); conv.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        A.ok = true;
        startBed();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setOn = on => { A.on = on; if (master) master.gain.setTargetAtTime(on ? A.vol : 0, ac.currentTime, 0.1); };
  A.suspend = () => { try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { } };
  A.resume = () => { try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) { } };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } ac = null; A.ok = false; };
  const now = () => ac.currentTime;
  function out(node, dry, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    const g = ac.createGain(); g.gain.value = dry; n.connect(g); g.connect(master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, type, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.001) return;
    const t = now() + (delay || 0);
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g, 1, rev === undefined ? 0.5 : rev, pan); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f, q, vol, f2, delay, rev, pan, attack) {
    if (!A.ok || vol < 0.001) return;
    const t = now() + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, 1, rev === undefined ? 0.4 : rev, pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // ---- the bed ------------------------------------------------------------
  function startBed() {
    const g = ac.createGain(); g.gain.value = 0.0; g.connect(master);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7; lp.connect(g);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator();
    o1.type = 'sine'; o2.type = 'triangle'; o3.type = 'sine';
    o1.frequency.value = 55; o2.frequency.value = 55.4; o3.frequency.value = 82.4;
    const g3 = ac.createGain(); g3.gain.value = 0.0;
    o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp);
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 300; nf.Q.value = 0.5;
    const ng = ac.createGain(); ng.gain.value = 0.05; ns.connect(nf); nf.connect(ng); ng.connect(g);
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lg = ac.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(nf.frequency);
    for (const o of [o1, o2, o3, ns, lfo]) o.start();
    g.gain.setTargetAtTime(0.32, now(), 2.5);
    bed = { g, lp, o1, o2, o3, g3, nf, ng };
    // a single voice for the strongest acquiring eye: a bowed, rising tone
    const av = ac.createOscillator(); av.type = 'sawtooth'; av.frequency.value = 220;
    const vib = ac.createOscillator(); vib.frequency.value = 5.2; const vg = ac.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(av.frequency);
    const af = ac.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 900; af.Q.value = 6;
    const ag = ac.createGain(); ag.gain.value = 0; av.connect(af); af.connect(ag); out(ag, 1, 0.6);
    av.start(); vib.start();
    acqVoice = { av, af, ag };
    // stone moving
    const rs = ac.createBufferSource(); rs.buffer = nb; rs.loop = true;
    const rf = ac.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160; rf.Q.value = 2;
    const rg = ac.createGain(); rg.gain.value = 0; rs.connect(rf); rf.connect(rg); out(rg, 1, 0.3); rs.start();
    rumble = { rg, rf };
  }
  const ROOTS = { act1: 55, act2: 49, act3: 46.25, act4: 41.2 };
  A.setAct = look => { if (!bed) return; const r = ROOTS[look] || 55; bed.o1.frequency.setTargetAtTime(r, now(), 1.5); bed.o2.frequency.setTargetAtTime(r * 1.007, now(), 1.5); bed.o3.frequency.setTargetAtTime(r * 1.5, now(), 1.5); };
  // per frame: tension 0..1 (strongest acquisition), moving 0..1 (mechanisms), still (a held breath)
  A.frame = (tension, acqPitch, moving, still) => {
    if (!A.ok || !bed) return;
    const t = now();
    bed.lp.frequency.setTargetAtTime(300 + tension * 900, t, 0.25);
    bed.g3.gain.setTargetAtTime(tension * 0.35, t, 0.3);
    bed.o3.detune.setTargetAtTime(tension * 70, t, 0.4);
    bed.g.gain.setTargetAtTime(still ? 0.04 : 0.3 + tension * 0.12, t, still ? 0.08 : 0.6);
    acqVoice.ag.gain.setTargetAtTime(tension > 0.02 ? 0.02 + tension * 0.07 : 0, t, 0.08);
    acqVoice.av.frequency.setTargetAtTime(180 + acqPitch * 420, t, 0.08);
    acqVoice.af.frequency.setTargetAtTime(500 + acqPitch * 1800, t, 0.1);
    rumble.rg.gain.setTargetAtTime(moving * 0.32, t, 0.2);
    rumble.rf.frequency.setTargetAtTime(110 + moving * 90, t, 0.3);
  };
  // ---- events ---------------------------------------------------------------
  A.notice = pan => { tone(660, 0.9, 'sine', 0.035, 990, 0, 0.8, pan, 0.25); noise(0.5, 'bandpass', 2400, 8, 0.02, 3600, 0, 0.6, pan, 0.2); };
  A.alert = pan => { tone(330, 0.5, 'sine', 0.018, 360, 0, 0.7, pan, 0.15); };
  A.pin = pan => { tone(92, 0.5, 'sine', 0.22, 60, 0, 0.35, pan); noise(0.12, 'highpass', 3000, 0.8, 0.07, 0, 0, 0.3, pan); tone(1320, 0.4, 'triangle', 0.02, 1240, 0.02, 0.8, pan); };
  A.gaze = pan => { tone(880, 0.12, 'sine', 0.02, 1100, 0, 0.3, pan); };
  A.refuse = pan => { tone(240, 0.25, 'square', 0.025, 180, 0, 0.3, pan); tone(254, 0.25, 'square', 0.02, 190, 0, 0.3, pan); };
  A.release = pan => { noise(0.55, 'lowpass', 1600, 0.7, 0.05, 300, 0, 0.5, pan, 0.05); };
  A.freed = pan => { noise(0.08, 'bandpass', 1800, 3, 0.04, 900, 0, 0.3, pan); tone(420, 0.2, 'sine', 0.02, 300, 0, 0.5, pan); };
  A.link = pan => { tone(523, 1.4, 'sine', 0.022, 0, 0, 0.9, pan, 0.08); tone(784, 1.4, 'sine', 0.014, 0, 0.04, 0.9, pan, 0.08); };
  A.unlink = pan => { tone(1180, 0.18, 'triangle', 0.05, 380, 0, 0.6, pan); noise(0.05, 'highpass', 5000, 1, 0.05, 0, 0, 0.2, pan); };
  A.prime = pan => { tone(62, 0.9, 'sawtooth', 0.05, 48, 0, 0.4, pan, 0.08); noise(0.6, 'bandpass', 520, 6, 0.05, 260, 0, 0.5, pan, 0.06); };
  A.alarm = pan => { tone(146.8, 1.2, 'sawtooth', 0.05, 138, 0, 0.8, pan, 0.1); tone(155.6, 1.2, 'sawtooth', 0.04, 147, 0, 0.8, pan, 0.1); };
  A.liar = pan => { noise(0.25, 'bandpass', 900, 5, 0.06, 2200, 0, 0.6, pan); tone(300, 0.6, 'sine', 0.03, 600, 0.05, 0.8, pan); };
  A.falseReveal = pan => { noise(0.3, 'highpass', 2500, 1, 0.05, 0, 0, 0.4, pan); tone(200, 0.4, 'triangle', 0.03, 150, 0, 0.4, pan); };
  A.awaken = pan => { tone(110, 2.0, 'sine', 0.06, 123, 0, 0.9, pan, 0.6); noise(1.2, 'bandpass', 700, 4, 0.03, 1400, 0, 0.8, pan, 0.4); };
  A.step = k => { noise(0.05, 'bandpass', 900 + Math.random() * 300, 2.5, 0.012 + k * 0.012, 0, 0, 0.1); };
  A.caught = () => {
    const base = 110;
    for (const r of [1, 1.06, 1.19, 1.5, 1.59]) tone(base * r * 2, 1.6, 'sawtooth', 0.025, base * r * 2.2, 0, 0.9, 0, 0.5);
    noise(1.6, 'bandpass', 600, 3, 0.06, 2600, 0, 0.9, 0, 0.6);
  };
  A.fall = () => { noise(1.2, 'bandpass', 1400, 2, 0.06, 200, 0, 0.6, 0, 0.05); tone(300, 1.1, 'sine', 0.04, 70, 0, 0.6); };
  A.won = () => { for (const [f, d] of [[220, 0], [330, 0.08], [440, 0.16], [554.4, 0.26]]) tone(f, 2.6, 'sine', 0.035, 0, d, 0.9, 0, 0.3); };
  A.ending = () => { for (const [f, d] of [[110, 0], [164.8, 0.3], [220, 0.6], [277.2, 0.9], [329.6, 1.3], [440, 1.8]]) tone(f, 6, 'sine', 0.04, 0, d, 1, 0, 0.8); };
  A.ui = () => { tone(740, 0.08, 'sine', 0.02, 0, 0, 0.2); };
  return A;
}
