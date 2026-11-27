// Sound: everything is synthesised. Porcelain is a sharp transient plus a few
// inharmonic partials; gold is a silky filtered flow with a faint shimmer;
// the room is a generated impulse response.
function makeAudio() {
  let ac = null, master = null, dry = null, wet = null, muted = false;
  let flow = null, bed = null, noiseBuf = null;
  const ok = () => ac && ac.state === 'running';

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ac.destination);
    dry = ac.createGain(); dry.gain.value = 1; dry.connect(master);
    // the gallery: a soft 2.6 s tail
    const conv = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ac.sampleRate;
        lp = lp * 0.62 + (Math.random() * 2 - 1) * 0.38;
        d[i] = lp * Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.4) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    conv.buffer = ir;
    wet = ac.createGain(); wet.gain.value = 0.32;
    conv.connect(wet); wet.connect(master);
    dry.send = conv;
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) { // soft pinkish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }
  function out(node, send = 0.35) {
    node.connect(dry);
    if (send > 0) { const g = ac.createGain(); g.gain.value = send; node.connect(g); g.connect(dry.send); }
  }
  function partial(f, t0, dur, vol, send, type = 'sine') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); out(g, send);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function burst(t0, dur, vol, f, q, type = 'bandpass', send = 0.3) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 1.5;
    const flt = ac.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(flt); flt.connect(g); out(g, send);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02);
  }
  // porcelain tap; size 0 (small, bright) .. 1 (large, lower)
  function tink(t0, size, vol) {
    const f0 = lerp(2300, 1050, size) * (0.94 + Math.random() * 0.12);
    burst(t0, 0.018, vol * 0.9, lerp(5200, 3200, size), 1.2, 'bandpass', 0.2);
    const ratios = [1, 2.32, 4.25, 6.63], decs = [0.22, 0.12, 0.07, 0.04];
    for (let i = 0; i < 4; i++) partial(f0 * ratios[i] * (1 + (Math.random() - 0.5) * 0.01), t0, decs[i] * lerp(0.8, 1.4, size), vol * [0.35, 0.22, 0.12, 0.06][i], 0.25);
  }
  function bell(t0, f, vol, dur = 2.2, send = 0.55) {
    const r = [1, 2.0, 2.76, 4.07, 5.4], a = [0.5, 0.18, 0.22, 0.07, 0.05];
    for (let i = 0; i < r.length; i++) partial(f * r[i], t0, dur / (1 + i * 0.6), vol * a[i], send);
  }
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const D4 = 293.66;

  const api = {
    unlock() { init(); },
    get ready() { return ok(); },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); },
    get muted() { return muted; },
    select(size) { if (!ok()) return; tink(ac.currentTime, clamp(size + 0.3, 0, 1), 0.10); },
    drop() { if (!ok()) return; const t = ac.currentTime; burst(t, 0.03, 0.08, 1400, 0.8, 'bandpass', 0.15); partial(420, t, 0.06, 0.05, 0.1); },
    reject() { if (!ok()) return; const t = ac.currentTime; partial(330, t, 0.09, 0.07, 0.1, 'triangle'); burst(t, 0.025, 0.06, 900, 1.0, 'bandpass', 0.1); },
    snap(size) {
      if (!ok()) return;
      const t = ac.currentTime;
      tink(t, clamp(size + 0.2, 0, 1), 0.07);
      tink(t + 0.055, clamp(size, 0, 1), 0.26);
      partial(lerp(360, 240, size), t + 0.055, 0.09, 0.12, 0.15);
    },
    land(size, delay = 0) { if (!ok()) return; tink(ac.currentTime + delay, size, 0.13 + Math.random() * 0.06); },
    crack() {
      if (!ok()) return;
      const t = ac.currentTime;
      burst(t, 0.05, 0.5, 2600, 0.6, 'highpass', 0.4);
      burst(t + 0.004, 0.12, 0.22, 900, 0.9, 'bandpass', 0.4);
      partial(110, t, 0.12, 0.25, 0.2);
      for (let i = 0; i < 7; i++) tink(t + 0.01 + Math.random() * 0.09, Math.random() * 0.6, 0.12 * (1 - i / 9));
    },
    hairline() { if (!ok()) return; const t = ac.currentTime; burst(t, 0.035, 0.06, 4800, 2, 'bandpass', 0.3); partial(3100, t, 0.08, 0.03, 0.3); },
    // gold: continuous while painting
    flowStart() {
      if (!ok() || flow) return;
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
      const g = ac.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); out(g, 0.25);
      const sh = ac.createOscillator(), sh2 = ac.createOscillator(), sg = ac.createGain();
      sh.frequency.value = D4 * 8; sh2.frequency.value = D4 * 12.02; sg.gain.value = 0;
      sh.connect(sg); sh2.connect(sg); out(sg, 0.6);
      s.start(); sh.start(); sh2.start();
      flow = { s, f, g, sh, sh2, sg };
    },
    flow(speed, on) {
      if (!flow) return;
      const t = ac.currentTime, k = clamp(speed, 0, 1);
      flow.g.gain.setTargetAtTime((on ? 0.055 : 0.035) * (0.25 + k), t, 0.05);
      flow.f.frequency.setTargetAtTime(on ? 700 + k * 900 : 420 + k * 300, t, 0.08);
      flow.sg.gain.setTargetAtTime(on ? 0.006 + k * 0.008 : 0.0, t, 0.08);
    },
    flowStop() {
      if (!flow) return;
      const t = ac.currentTime, fl = flow; flow = null;
      fl.g.gain.setTargetAtTime(0, t, 0.06); fl.sg.gain.setTargetAtTime(0, t, 0.06);
      fl.s.stop(t + 0.4); fl.sh.stop(t + 0.4); fl.sh2.stop(t + 0.4);
    },
    drip() { if (!ok()) return; const t = ac.currentTime; partial(700 + Math.random() * 300, t, 0.07, 0.035, 0.2); },
    settle(i) { if (!ok()) return; const n = PENTA[i % PENTA.length]; bell(ac.currentTime, D4 * Math.pow(2, n / 12), 0.07, 2.0); },
    final(quality) {
      if (!ok()) return;
      const t = ac.currentTime;
      bell(t, D4 / 2, 0.10, 4.5, 0.7);
      bell(t + 0.08, D4 * 0.75, 0.06, 4.0, 0.7);
      bell(t + 0.16, D4 * 1.125, 0.045, 3.6, 0.7);
      if (quality > 0.85) bell(t + 0.5, D4 * 2.25, 0.035, 3.6, 0.8);
    },
    reveal() { if (!ok()) return; const t = ac.currentTime; bell(t, D4 * 1.5, 0.035, 2.4); bell(t + 0.18, D4 * 2, 0.03, 2.6); },
    ui() { if (!ok()) return; tink(ac.currentTime, 0.9, 0.05); },
    // ambient bed for the gallery; intensity 0..1 opens the filter
    bedStart() {
      if (!ok() || bed) return;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
      const g = ac.createGain(); g.gain.value = 0;
      lp.connect(g); out(g, 0.7);
      const oscs = [];
      const notes = [73.42, 110.0, 146.83, 164.81, 220.0];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f * (1 + (i - 2) * 0.0009);
        const og = ac.createGain(); og.gain.value = [0.5, 0.35, 0.16, 0.08, 0.06][i];
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.05 + i * 0.023; lg.gain.value = og.gain.value * 0.6;
        lfo.connect(lg); lg.connect(og.gain);
        o.connect(og); og.connect(lp); o.start(); lfo.start();
        oscs.push(o, lfo);
      });
      g.gain.setTargetAtTime(0.05, ac.currentTime, 2.5);
      bed = { lp, g, oscs };
    },
    bed(intensity) { if (!bed) return; bed.lp.frequency.setTargetAtTime(420 + intensity * 900, ac.currentTime, 1.5); bed.g.gain.setTargetAtTime(0.04 + intensity * 0.025, ac.currentTime, 1.5); },
    close() { try { if (ac) ac.close(); } catch (e) {} ac = null; flow = null; bed = null; }
  };
  return api;
}
