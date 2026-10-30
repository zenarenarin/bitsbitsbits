// =====================================================================
// Synthesised sound. Quiet room tone, wet catches that ring the glass,
// a dull pop for the unstable eyes. Everything runs through one master
// gain so the mute toggle is a single switch.
// =====================================================================

function createAudio(enabled) {
  let ac = null, master = null, sfx = null, amb = null, noiseBuf = null, muted = false, ambOn = false;
  const nodes = [];

  function ensure() {
    if (!enabled || ac) return !!ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master);
      sfx = ac.createGain(); sfx.gain.value = 0.8; sfx.connect(comp);
      amb = ac.createGain(); amb.gain.value = 0; amb.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    return !!ac;
  }
  const now = () => ac.currentTime;

  function tone(type, f0, f1, dur, vol, at, dest) {
    const t = now() + (at || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, f0, f1, q, at, dest) {
    const t = now() + (at || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  // A bank of inharmonic partials: the jar humming after something lands in it.
  function glass(vol, at, pitch) {
    const p = pitch || 1;
    [[1460, 0.5], [2290, 0.3], [3720, 0.18], [5130, 0.08]].forEach(([f, v], i) => tone('sine', f * p, f * p * 0.995, 0.5 + (3 - i) * 0.12, vol * v, at));
  }

  function startAmbience() {
    if (ambOn || !ac) return;
    ambOn = true;
    const t = now();
    const drone = ac.createGain(); drone.gain.value = 0.05; drone.connect(amb);
    for (const f of [55, 55.7, 82.4]) {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(drone); o.start(t); nodes.push(o);
    }
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
    const ng = ac.createGain(); ng.gain.value = 0.035;
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 220; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(t);
    const lfo2 = ac.createOscillator(), lg2 = ac.createGain(); lfo2.frequency.value = 0.11; lg2.gain.value = 0.02; lfo2.connect(lg2); lg2.connect(ng.gain); lfo2.start(t);
    s.connect(bp); bp.connect(ng); ng.connect(amb); s.start(t);
    nodes.push(s, lfo, lfo2);
  }

  let dripT = 0;
  return {
    unlock() { if (!ensure()) return; if (ac.state === 'suspended') ac.resume().catch(() => {}); startAmbience(); },
    ambience(level, dt) {
      if (!ac) return;
      amb.gain.setTargetAtTime(muted ? 0 : level, now(), 0.6);
      dripT -= dt;
      if (dripT <= 0 && level > 0) {                           // a distant drip in the dark, now and then
        dripT = 3 + Math.random() * 6;
        tone('sine', 1300 + Math.random() * 500, 500, 0.12, 0.018, 0, amb);
      }
    },
    setMuted(m) { muted = m; if (ac) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.05); },
    get muted() { return muted; },
    bounce(size, power) {
      if (!ac) return;
      const v = Math.min(1, power) * 0.07; if (v < 0.008) return;
      const f = (size < 18 ? 420 : 300) * (0.9 + Math.random() * 0.2);
      tone('sine', f, f * 0.55, 0.11, v);
      noise(0.05, v * 0.4, 'lowpass', 900, 300, 1);
    },
    clink(power) { if (!ac) return; glass(Math.min(1, power) * 0.06, 0, 1.1 + Math.random() * 0.1); },
    catch(combo, gold) {
      if (!ac) return;
      noise(0.16, 0.16, 'bandpass', 1600, 260, 3);               // wet squelch
      tone('sine', 190, 70, 0.16, 0.18);
      glass(0.08, 0.05, gold ? 1.25 : 1);
      const step = Math.min(combo, 10);
      tone('triangle', 660 * Math.pow(2, step / 12), 660 * Math.pow(2, step / 12), 0.07, 0.04, 0.06);
      if (gold) [0, 4, 7, 12].forEach((s, i) => tone('triangle', 880 * Math.pow(2, s / 12), 880 * Math.pow(2, s / 12), 0.22, 0.05, 0.08 + i * 0.06));
    },
    plop() { if (!ac) return; tone('sine', 520, 210, 0.09, 0.05); noise(0.06, 0.04, 'bandpass', 1200, 500, 4); },
    explode(near) {
      if (!ac) return;
      const v = near ? 1 : 0.55;
      noise(0.5, 0.4 * v, 'lowpass', 2600, 120, 0.7);
      tone('sine', 120, 38, 0.4, 0.38 * v);
      noise(0.18, 0.18 * v, 'bandpass', 900, 2400, 5, 0.03);
    },
    fuse() { if (!ac) return; tone('square', 110, 108, 0.05, 0.012); },
    teleport(out) {
      if (!ac) return;
      const a = out ? 900 : 300, b = out ? 300 : 1100;
      tone('sine', a, b, 0.16, 0.06);
      tone('square', a * 1.5, b * 1.5, 0.12, 0.015);
    },
    split() {
      if (!ac) return;
      noise(0.12, 0.1, 'bandpass', 700, 1800, 4);
      [0, 1, 2].forEach(i => tone('sine', 380 + i * 140, 600 + i * 160, 0.08, 0.06, i * 0.05));
    },
    open() { if (!ac) return; noise(0.05, 0.03, 'bandpass', 2400, 1400, 6); },
    penalty() { if (!ac) return; tone('sawtooth', 160, 70, 0.3, 0.05); },
    tick(urgent) { if (!ac) return; tone('square', urgent ? 1046 : 784, urgent ? 1046 : 784, 0.04, 0.02); },
    over() {
      if (!ac) return;
      [0, -3, -7, -12].forEach((s, i) => tone('triangle', 523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12) * 0.99, 0.5, 0.05, i * 0.16));
      glass(0.06, 0.65, 0.8);
    },
    button() { if (!ac) return; glass(0.05, 0, 1.3); },
    close() { try { nodes.forEach(n => { try { n.stop(); } catch (e) { } }); if (ac) ac.close(); } catch (e) { } }
  };
}
