// =====================================================================
// Audio. Every sound is procedural and goes through these named hooks, so
// recorded assets can replace any of them later without touching the game.
// The reflection's movements are swelled in (reversed envelope) and sent
// through a dark delay, so it never sounds quite like the real cat.
// =====================================================================

function createAudio(enabled) {
  const A = { ok: false, muted: false };
  let ac, master, wet, mirrorBus, nb, drone, droneGain, airGain, lfo;
  A.unlock = function () {
    if (!enabled) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ac = new AC();
        master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.7;
        const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
        // a small wooden room
        const len = Math.floor(ac.sampleRate * 1.6), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
        const conv = ac.createConvolver(); conv.buffer = ir; wet = ac.createGain(); wet.gain.value = 0.35; wet.connect(conv); conv.connect(master);
        // the mirror bus: low-passed, delayed, a little feedback
        mirrorBus = ac.createGain(); const dl = ac.createDelay(1); dl.delayTime.value = 0.13; const fb = ac.createGain(); fb.gain.value = 0.32; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        mirrorBus.connect(lp); lp.connect(master); lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); dl.connect(master);
        nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // ambience: room tone, a far low drone that tightens as sync falls
        const air = ac.createBufferSource(); air.buffer = nb; air.loop = true; const af = ac.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 380; airGain = ac.createGain(); airGain.gain.value = 0.05; air.connect(af); af.connect(airGain); airGain.connect(master); air.start();
        drone = ac.createOscillator(); drone.type = 'sine'; drone.frequency.value = 49; const d2 = ac.createOscillator(); d2.type = 'sine'; d2.frequency.value = 73.6;
        droneGain = ac.createGain(); droneGain.gain.value = 0.0; drone.connect(droneGain); d2.connect(droneGain); droneGain.connect(master); drone.start(); d2.start();
        lfo = ac.createOscillator(); lfo.frequency.value = 0.08; const lg = ac.createGain(); lg.gain.value = 0.012; lfo.connect(lg); lg.connect(droneGain.gain); lfo.start();
        A.ok = true;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { A.ok = false; }
  };
  A.setMuted = m => { A.muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ac.currentTime, 0.05); };
  function env(g, t, vol, att, dur, reverse) {
    g.gain.setValueAtTime(0.0001, t);
    if (reverse) { g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    else { g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  }
  function route(node, bus, rev, pan) {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; node.connect(p); n = p; }
    n.connect(bus || master);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; n.connect(r); r.connect(wet); }
  }
  function tone(f, dur, o) {
    o = o || {}; if (!A.ok) return;
    const t = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    const g = ac.createGain(); env(g, t, o.vol || 0.05, o.att || 0.01, dur, o.reverse);
    osc.connect(g); route(g, o.bus, o.rev === undefined ? 0.3 : o.rev, o.pan); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(dur, o) {
    o = o || {}; if (!A.ok) return;
    const t = ac.currentTime + (o.delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(o.f || 1000, t); fl.Q.value = o.q || 1;
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = ac.createGain(); env(g, t, o.vol || 0.05, o.att || 0.008, dur, o.reverse);
    s.connect(fl); fl.connect(g); route(g, o.bus, o.rev === undefined ? 0.2 : o.rev, o.pan); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // movement: a soft fur brush, a pad on the boards; jumps get a lift and a thump
  const MOVE = { sit: [620, 0.22], stand: [900, 0.2], crouch: [480, 0.26], paw: [1300, 0.16], jump: [1100, 0.2], land: [300, 0.22] };
  A.catMove = a => {
    const m = MOVE[a] || MOVE.stand;
    noise(m[1], { f: m[0], q: 0.8, vol: 0.045, f2: m[0] * 0.6 });
    if (a === 'land') tone(90, 0.18, { vol: 0.09, f2: 55, rev: 0.1 });
    if (a === 'paw') noise(0.05, { f: 3200, q: 2, vol: 0.02, delay: 0.1 });
  };
  A.reflectMove = a => {
    const m = MOVE[a] || MOVE.stand;
    noise(m[1] * 1.6, { f: m[0] * 0.8, q: 1.2, vol: 0.05, f2: m[0] * 1.2, reverse: true, bus: mirrorBus, rev: 0.5, pan: 0 });
    tone(196, 0.5, { vol: 0.012, f2: 185, reverse: true, bus: mirrorBus, rev: 0.6 });
  };
  A.perfect = combo => { const f = 660 * Math.pow(2, Math.min(combo, 8) / 24); tone(f, 0.5, { vol: 0.035, rev: 0.7 }); tone(f * 1.5, 0.6, { vol: 0.02, delay: 0.04, rev: 0.8 }); };
  A.good = () => { tone(520, 0.35, { vol: 0.03, rev: 0.6 }); };
  A.wrong = () => { tone(118, 0.4, { type: 'sawtooth', vol: 0.03, f2: 92, rev: 0.4 }); noise(0.25, { f: 400, q: 3, vol: 0.06, f2: 200 }); };
  A.miss = () => { tone(155, 0.7, { type: 'triangle', vol: 0.04, f2: 104, rev: 0.6 }); };
  A.warn = level => { tone(level === 'CRITICAL' ? 82 : 110, 1.2, { type: 'sine', vol: 0.08, f2: 70, rev: 0.6 }); tone(level === 'CRITICAL' ? 1240 : 990, 0.9, { vol: 0.012, reverse: true, rev: 0.8 }); };
  A.deviate = () => { noise(0.6, { f: 2400, q: 6, vol: 0.03, f2: 800, reverse: true, bus: mirrorBus, rev: 0.8 }); tone(311, 0.8, { vol: 0.015, f2: 293, bus: mirrorBus }); };
  A.phase = () => { tone(55, 3, { vol: 0.08, att: 1.2, rev: 0.8 }); noise(2.2, { f: 900, q: 0.6, vol: 0.04, f2: 300, reverse: true, rev: 0.9 }); };
  A.milestone = () => { [392, 466, 587].forEach((f, i) => tone(f, 1.6, { vol: 0.025, delay: i * 0.12, rev: 1 })); };
  A.gameOver = () => {
    tone(98, 3.2, { type: 'sawtooth', vol: 0.04, f2: 41, rev: 0.9 });
    noise(2.6, { f: 1800, q: 1, vol: 0.06, f2: 120, reverse: true, bus: mirrorBus, rev: 0.9 });
    noise(0.5, { type: 'lowpass', f: 900, vol: 0.09, delay: 2.4, rev: 0.6 });
  };
  A.snuff = () => { noise(0.3, { f: 1600, q: 0.7, vol: 0.05, f2: 400 }); };
  A.click = () => { tone(1800, 0.04, { vol: 0.012, rev: 0.1 }); };
  // unease 0..1 shapes the room tone and the drone
  A.ambience = unease => {
    if (!A.ok) return;
    droneGain.gain.setTargetAtTime(0.012 + unease * 0.05, ac.currentTime, 0.8);
    drone.frequency.setTargetAtTime(49 - unease * 3, ac.currentTime, 2);
    airGain.gain.setTargetAtTime(0.045 + unease * 0.02, ac.currentTime, 1);
  };
  A.creak = () => { tone(130 + Math.random() * 40, 0.9, { type: 'sawtooth', vol: 0.008, f2: 105, rev: 0.8, pan: Math.random() * 1.6 - 0.8 }); };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
