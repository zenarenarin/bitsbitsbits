// ---------------------------------------------------------------------------
// Sound. The world has an acoustic identity: every mechanism has its own voice
// (the lift's little arrival bell, the bellows' long inhale and its puff, the
// skiff knocking against its mooring, a wheel's gondolas ticking past), each on
// its own cycle, so the world sounds like a place, never like a metronome.
// Underneath, an unquantised score drifts through slow chords; when the
// courier keeps moving without waiting, it opens up and gains small voices.
// ---------------------------------------------------------------------------

const MODES = [
  [62, [0, 2, 4, 6, 7, 9, 11]],   // D lydian, morning
  [55, [0, 2, 4, 7, 9]],          // G major pentatonic, noon
  [57, [0, 2, 3, 5, 7, 9, 10]],   // A dorian, afternoon
  [53, [0, 2, 4, 6, 7, 9, 10]]    // F lydian-dominant, dusk
];
const CHORDS = [[0, 2, 4], [3, 5, 0], [4, 6, 1], [5, 0, 2], [1, 3, 5]];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function createAudio() {
  let ac = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null, verb = null;
  let muted = false, region = 0, flow = 0, chordI = 0, nextChord = 0, nextPluck = 0, pads = [], windG = null, windF = null, started = false;
  const A = {};

  A.ensure = () => {
    if (ac) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
    } catch (e) { ac = null; return false; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    // a cheap reverb: feedback delays
    verb = ac.createGain(); verb.gain.value = 0.25;
    const d1 = ac.createDelay(1), d2 = ac.createDelay(1), fb = ac.createGain(), lp = ac.createBiquadFilter();
    d1.delayTime.value = 0.137; d2.delayTime.value = 0.211; fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 2400;
    verb.connect(d1); d1.connect(d2); d2.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return true;
  };

  A.unlock = () => {
    if (!A.ensure()) return;
    if (ac.state !== 'running') ac.resume().catch(() => {});
    if (!started) { started = true; startBed(); }
  };
  A.suspend = () => { if (ac && ac.state === 'running') ac.suspend().catch(() => {}); };
  A.resume = () => { if (ac && ac.state !== 'running' && started) ac.resume().catch(() => {}); };
  A.setMuted = m => { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05); };
  A.isMuted = () => muted;
  A.setRegion = r => { region = r; chordI = 0; nextChord = 0; };
  A.setFlow = f => { flow = f; };
  A.dispose = () => { try { if (ac) ac.close(); } catch (e) { /* closing a context can throw if already closed */ } ac = null; };

  function now() { return ac.currentTime; }
  function out(pan, wet) {
    const g = ac.createGain();
    let node = g;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan || 0, -1, 1); g.connect(p); node = p; }
    node.connect(sfxBus);
    if (wet) { const w = ac.createGain(); w.gain.value = wet; node.connect(w); w.connect(verb); }
    return g;
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, type, freq, q, peak, pan, a, wet, sweepTo) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = out(pan, wet);
    const gg = ac.createGain(); s.connect(f); f.connect(gg); gg.connect(g);
    env(gg, t, a || 0.005, peak, dur);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + a + 0.05);
  }
  function tone(t, freq, dur, type, peak, pan, a, wet, bend) {
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    const g = out(pan, wet); const gg = ac.createGain(); o.connect(gg); gg.connect(g);
    env(gg, t, a || 0.004, peak, dur);
    o.start(t); o.stop(t + dur + (a || 0) + 0.05);
  }
  function scaleNote(deg, oct) {
    const [root, sc] = MODES[region];
    const n = sc.length;
    const o = Math.floor(deg / n);
    return root + 12 * (oct + o) + sc[((deg % n) + n) % n];
  }

  // ---- the bed ----------------------------------------------------------
  function startBed() {
    // wind
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 500; windF.Q.value = 0.6;
    windG = ac.createGain(); windG.gain.value = 0.035;
    s.connect(windF); windF.connect(windG); windG.connect(master); s.start();
    // three pad voices
    for (let i = 0; i < 3; i++) {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'triangle'; o2.type = 'sine'; o2.detune.value = 7 + i * 3;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.4;
      const g = ac.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
      const w = ac.createGain(); w.gain.value = 0.35; g.connect(w); w.connect(verb);
      o1.start(); o2.start();
      pads.push({ o1, o2, f, g });
    }
  }

  A.tick = (dt, camInfo) => {
    if (!ac || !started || ac.state !== 'running') return;
    const t = now();
    if (windG) {
      windG.gain.setTargetAtTime(0.025 + 0.02 * Math.sin(t * 0.23) + (camInfo && camInfo.high ? 0.02 : 0), t, 0.5);
      windF.frequency.setTargetAtTime(380 + 260 * Math.sin(t * 0.17) + 200 * flow, t, 0.6);
    }
    if (t >= nextChord) {
      const ch = CHORDS[chordI % CHORDS.length]; chordI += 1 + (Math.random() < 0.3 ? 1 : 0);
      const dur = 7 + Math.random() * 5;
      pads.forEach((v, i) => {
        const f = mtof(scaleNote(ch[i] + (i === 0 ? -7 : 0), i === 0 ? -1 : 0));
        v.o1.frequency.setTargetAtTime(f, t, 1.2); v.o2.frequency.setTargetAtTime(f * (i === 2 ? 2 : 1), t, 1.2);
        v.g.gain.setTargetAtTime(0.09 - i * 0.015, t, 1.5);
      });
      nextChord = t + dur;
    }
    pads.forEach(v => v.f.frequency.setTargetAtTime(520 + flow * 1400, t, 0.8));
    musicBus.gain.setTargetAtTime(0.26 + flow * 0.12, t, 1.0);
    // small glassy plucks, sparse, more of them when the passage flows
    if (t >= nextPluck) {
      const deg = Math.floor(Math.random() * 8);
      const f = mtof(scaleNote(deg, 1));
      tone(t, f, 1.6, 'sine', 0.03 + flow * 0.035, (Math.random() - 0.5) * 0.8, 0.005, 0.6);
      tone(t, f * 3.01, 0.5, 'sine', 0.008, 0, 0.003, 0.5);
      nextPluck = t + (flow > 0.4 ? 0.6 + Math.random() * 1.6 : 2.5 + Math.random() * 5);
    }
  };

  // ---- sound effects ------------------------------------------------------
  // pan: -1..1, vol: 0..1 (distance attenuation applied by the caller)
  A.play = (name, o) => {
    if (!ac || ac.state !== 'running' || muted) return;
    o = o || {};
    const t = now() + 0.005, pan = o.pan || 0, v = o.vol == null ? 1 : o.vol;
    if (v < 0.03) return;
    switch (name) {
      case 'jump': noise(t, 0.16, 'bandpass', 900, 1.2, 0.12 * v, pan, 0.01, 0, 2400); break;
      case 'step': noise(t, 0.04, 'lowpass', 900, 0.7, 0.05 * v, pan, 0.002); break;
      case 'land': {
        const m = o.mat, k = clamp((o.impact || 4) / 10, 0.3, 1.2) * v;
        if (m === 'wood' || m === 'goal') { noise(t, 0.09, 'lowpass', 700, 1, 0.22 * k, pan); tone(t, mtof(scaleNote(o.deg || 0, -1)), 0.22, 'sine', 0.12 * k, pan, 0.002, 0.2); }
        else if (m === 'metal') { noise(t, 0.05, 'highpass', 2000, 1, 0.08 * k, pan); tone(t, 620, 0.5, 'sine', 0.05 * k, pan, 0.002, 0.4); tone(t, 1490, 0.35, 'sine', 0.025 * k, pan, 0.002, 0.4); }
        else if (m === 'cloth') { noise(t, 0.14, 'lowpass', 350, 0.8, 0.25 * k, pan); }
        else if (m === 'creature') { noise(t, 0.12, 'lowpass', 420, 1, 0.2 * k, pan); tone(t, 110, 0.3, 'sine', 0.08 * k, pan, 0.01, 0, 0.8); }
        else { noise(t, 0.06, 'lowpass', 1300, 0.9, 0.2 * k, pan); tone(t, 140, 0.08, 'sine', 0.06 * k, pan); }
        break;
      }
      case 'grab': tone(t, 1760, 0.18, 'sine', 0.06 * v, pan, 0.002, 0.3); tone(t, 2637, 0.12, 'sine', 0.03 * v, pan, 0.002, 0.3); noise(t, 0.18, 'bandpass', 300, 4, 0.05 * v, pan, 0.02); break;
      case 'release': noise(t, 0.22, 'bandpass', 700, 1, 0.1 * v, pan, 0.02, 0, 1800); break;
      case 'letter': {
        const base = scaleNote(4, 1);
        [0, 2, 4, 7].forEach((d, i) => tone(t + i * 0.09, mtof(scaleNote(4 + d, 1)), 1.2, 'sine', 0.07 * v, pan, 0.004, 0.7));
        void base; break;
      }
      case 'fall': tone(t, 900, 0.7, 'sine', 0.05 * v, pan, 0.02, 0.2, 0.5); noise(t + 0.25, 0.25, 'lowpass', 500, 1, 0.12 * v, pan, 0.01); break;
      case 'umbrella': noise(t, 0.12, 'bandpass', 1200, 2, 0.12 * v, pan, 0.005); break;
      case 'deliver': {
        [0, 2, 4, 7, 9].forEach((d, i) => tone(t + i * 0.12, mtof(scaleNote(d, 0)), 2.6, 'triangle', 0.05 * v, (i - 2) * 0.2, 0.01, 0.8));
        tone(t + 0.7, mtof(scaleNote(0, 2)), 3, 'sine', 0.05 * v, 0, 0.004, 0.9);
        break;
      }
      // the world's own voices
      case 'dock': noise(t, 0.08, 'lowpass', 500, 1.5, 0.16 * v, pan); tone(t, 95, 0.18, 'sine', 0.1 * v, pan); break;
      case 'liftBell': tone(t, mtof(scaleNote(o.deg || 4, 1)), 1.4, 'sine', 0.06 * v, pan, 0.002, 0.6); tone(t, mtof(scaleNote(o.deg || 4, 1)) * 2.76, 0.6, 'sine', 0.015 * v, pan, 0.002, 0.5); break;
      case 'ratchet': noise(t, 0.025, 'highpass', 2600, 2, 0.04 * v, pan); break;
      case 'inhale': noise(t, o.dur || 2, 'lowpass', 300, 0.7, 0.06 * v, pan, (o.dur || 2) * 0.7, 0, 900); break;
      case 'puff': noise(t, 0.35, 'lowpass', 900, 0.8, 0.35 * v, pan, 0.004, 0.2, 200); tone(t, 70, 0.3, 'sine', 0.2 * v, pan, 0.004, 0, 0.6); break;
      case 'tok': tone(t, mtof(scaleNote(o.deg || 0, 0)), 0.12, 'triangle', 0.05 * v, pan, 0.002, 0.3); noise(t, 0.03, 'bandpass', 1800, 3, 0.04 * v, pan); break;
      case 'swoosh': noise(t, 0.4, 'bandpass', 400, 1.5, 0.05 * v, pan, 0.15, 0.1, 800); break;
      case 'trolley': noise(t, 0.05, 'bandpass', 3000, 4, 0.06 * v, pan); tone(t, 1320, 0.25, 'sine', 0.02 * v, pan, 0.002, 0.3); break;
      case 'stride': noise(t, 0.12, 'lowpass', 180, 1, 0.2 * v, pan, 0.01); break;
      case 'call': tone(t, 180 + Math.random() * 40, 0.9, 'sine', 0.05 * v, pan, 0.15, 0.6, 0.75); break;
      case 'ui': tone(t, 1320, 0.08, 'sine', 0.04 * v, 0, 0.002); break;
      default: break;
    }
  };
  return A;
}
