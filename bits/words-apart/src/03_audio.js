// Original synthesised sound: an underground room tone, stone taps for typing, bell-stone chimes.
function createAudio(enabled) {
  const A = { ok: false, muted: false, ctx: null };
  let ac, master, comp, amb = null, beatAt = 0;
  function init() {
    if (A.ctx || !enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC(); A.ctx = ac;
      comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.connect(ac.destination);
      master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.9; master.connect(comp);
      A.ok = true;
    } catch (e) { A.ok = false; }
  }
  let noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown noise
    return (noiseBuf = b);
  }
  let whiteBuf = null;
  function white() { if (whiteBuf) return whiteBuf; const n = ac.sampleRate, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (whiteBuf = b); }
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(freq, t, a, peak, d, type, dest) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    env(g, t, a, peak, d); o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + a + d + 0.05); return o;
  }
  function burst(t, dur, f, q, peak, buf, dest) {
    const s = ac.createBufferSource(); s.buffer = buf || white(); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ac.createGain(); env(g, t, 0.002, peak, dur); s.connect(bp); bp.connect(g); g.connect(dest || master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); return bp;
  }
  // a struck stone bell: inharmonic partials with fast-decaying highs
  function bell(f, t, peak, len) {
    const parts = [[1, 1], [2.32, 0.45], [4.1, 0.22], [5.43, 0.12], [0.5, 0.35]];
    for (const [m, a] of parts) tone(f * m, t, 0.004, peak * a, len / Math.sqrt(m + 0.3));
  }
  A.unlock = () => { init(); if (ac && ac.state === 'suspended') ac.resume().catch(() => { }); };
  A.setMuted = m => { A.muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.08); };
  A.ambient = on => {
    if (!A.ok) return;
    if (on && !amb) {
      const t = ac.currentTime, out = ac.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.5, t + 3); out.connect(master);
      const s = ac.createBufferSource(); s.buffer = noise(); s.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.7;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 2.4;
      const gw = ac.createGain(); gw.gain.value = 0.10; const gl = ac.createGain(); gl.gain.value = 0.32;
      s.connect(lp); lp.connect(gl); gl.connect(out); s.connect(bp); bp.connect(gw); gw.connect(out);
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.05; lg.gain.value = 220; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      const d1 = ac.createOscillator(), d2 = ac.createOscillator(), dg = ac.createGain(); d1.frequency.value = 55; d2.frequency.value = 55.4 * 1.5; dg.gain.value = 0.035;
      d1.connect(dg); d2.connect(dg); dg.connect(out); d1.start(); d2.start(); s.start();
      amb = { out, lp, d1, d2, dg, nodes: [s, lfo, d1, d2] };
    } else if (!on && amb) {
      const t = ac.currentTime, a = amb; amb = null; a.out.gain.setTargetAtTime(0.0001, t, 0.6);
      try { a.nodes.forEach(n => n.stop(t + 3)); } catch (e) { } // scheduled on the audio clock: no timers needed
    }
  };
  // depth 0..1 lowers the room tone as the player descends
  A.depth = d => { if (!amb) return; const t = ac.currentTime; amb.lp.frequency.setTargetAtTime(260 - 130 * d, t, 1.5); amb.d1.frequency.setTargetAtTime(55 - 14 * d, t, 2); amb.d2.frequency.setTargetAtTime((55 - 14 * d) * 1.5 + 0.4, t, 2); };
  // occasional distant water drop / stone settle, very quiet
  A.drip = () => { if (!A.ok) return; const t = ac.currentTime; const f = 1400 + Math.random() * 900; const o = tone(f, t, 0.002, 0.022, 0.18); o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05); };
  A.key = i => { if (!A.ok) return; const t = ac.currentTime; burst(t, 0.035, 2600 + (i % 5) * 160, 3, 0.18); tone(520 + (i % 7) * 23, t, 0.002, 0.05, 0.06, 'triangle'); };
  A.back = () => { if (!A.ok) return; const t = ac.currentTime; burst(t, 0.04, 1300, 3, 0.14); };
  A.nudgeBlocked = () => { if (!A.ok) return; const t = ac.currentTime; burst(t, 0.06, 700, 4, 0.12); };
  A.wrong = () => {
    if (!A.ok) return; const t = ac.currentTime;
    const o = tone(120, t, 0.004, 0.32, 0.26); o.frequency.exponentialRampToValueAtTime(68, t + 0.24);
    burst(t, 0.12, 380, 1.4, 0.22, noise());
  };
  A.correct = level => {
    if (!A.ok) return; const t = ac.currentTime, base = [392, 349.2, 311.1, 293.7, 261.6][level] || 392;
    bell(base, t, 0.16, 2.2); bell(base * 1.5, t + 0.09, 0.08, 1.8);
  };
  A.rumble = (dur, big) => {
    if (!A.ok) return; const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = noise(); s.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(90, t); lp.frequency.linearRampToValueAtTime(big ? 220 : 160, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(70, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(big ? 0.9 : 0.6, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.1);
    // stone grinding: slow bandpassed grains
    for (let i = 0; i < (big ? 7 : 4); i++) burst(t + 0.2 + Math.random() * dur * 0.7, 0.18 + Math.random() * 0.2, 180 + Math.random() * 220, 6, 0.08, noise());
    // the landing
    const o = tone(48, t + dur * 0.92, 0.01, 0.35, 0.6); o.frequency.exponentialRampToValueAtTime(34, t + dur + 0.5);
  };
  A.hint = () => {
    if (!A.ok) return; const t = ac.currentTime;
    const bp = burst(t, 0.9, 1800, 5, 0.06); bp.frequency.exponentialRampToValueAtTime(4200, t + 0.8);
    tone(1318.5, t + 0.05, 0.25, 0.03, 0.9); tone(1975.5, t + 0.15, 0.25, 0.02, 0.9);
  };
  A.beat = strong => { // restrained heartbeat under five seconds
    if (!A.ok) return; const t = ac.currentTime; if (t - beatAt < 0.4) return; beatAt = t;
    tone(58, t, 0.008, strong ? 0.4 : 0.26, 0.16); tone(52, t + 0.17, 0.008, strong ? 0.26 : 0.17, 0.2);
  };
  A.final = () => {
    if (!A.ok) return; const t = ac.currentTime;
    [196, 293.7, 392, 440, 587.3].forEach((f, i) => bell(f, t + 0.35 + i * 0.22, 0.09, 4.2));
    const s = ac.createBufferSource(); s.buffer = noise(); s.loop = true; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(200, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 3.5);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 2.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 6.2);
    tone(49, t, 1.5, 0.3, 4.5);
  };
  A.fail = () => {
    if (!A.ok) return; const t = ac.currentTime;
    const o = tone(110, t, 0.3, 0.16, 3.2); o.frequency.exponentialRampToValueAtTime(55, t + 3);
    const o2 = tone(164.8, t + 0.1, 0.3, 0.08, 2.8); o2.frequency.exponentialRampToValueAtTime(82, t + 3);
  };
  A.close = () => { try { if (ac) ac.close(); } catch (e) { } };
  return A;
}
