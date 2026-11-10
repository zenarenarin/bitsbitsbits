// Sound: a minimal, synthesised sound language (no samples).
// Detent ticks while dragging, a soft mechanical snap, a tuned bell per ring on
// alignment, a chord on completion. Plus a quiet ambient bed via ctx.music.

function createSound(ctx) {
  const S = { ac: null, master: null, muted: false, ok: false, lastTick: 0, music: null };
  const caps = ctx.capabilities || {};
  // Each ring has its own note, so a solved board plays as a chord.
  const NOTES = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

  function ensure() {
    if (S.ac || !caps.audio) return !!S.ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      S.ac = new AC();
      S.master = S.ac.createGain();
      S.master.gain.value = S.muted ? 0 : 0.9;
      const comp = S.ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      S.master.connect(comp); comp.connect(S.ac.destination);
      // Short noise buffer shared by every click.
      const len = Math.floor(S.ac.sampleRate * 0.05);
      S.noise = S.ac.createBuffer(1, len, S.ac.sampleRate);
      const d = S.noise.getChannelData(0);
      const r = makeRng('orbit-noise');
      for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3);
      S.ok = true;
      ctx.onDestroy(() => { try { S.ac.close(); } catch (e) { } });
    } catch (e) { S.ok = false; }
    return S.ok;
  }

  // Must run inside a user gesture: unlocks WebAudio and starts the music bed.
  S.unlock = function () {
    ensure();
    if (S.ac && S.ac.state === 'suspended') { try { S.ac.resume(); } catch (e) { } }
    if (!S.music && caps.backgroundMusic && ctx.music && !S.muted) {
      try {
        ctx.music.unlock();
        S.music = ctx.music.play({ preset: 'ambient', volume: 0.14, tempo: 64, intensity: 0.18, density: 0.25, scale: 'lydian', fadeInMs: 3000 });
      } catch (e) { S.music = null; }
    }
  };

  function click(t, freq, q, gain, dur) {
    const src = S.ac.createBufferSource(); src.buffer = S.noise;
    const bp = S.ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = S.ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(S.master);
    src.start(t); src.stop(t + dur + 0.01);
  }
  function tone(t, freq, gain, dur, type, attack) {
    const o = S.ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = S.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(S.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function live() { return S.ok && !S.muted && S.ac && S.ac.state === 'running'; }

  // A detent: the ring passing a 30-degree notch while dragged.
  S.tick = function (ring) {
    if (!live()) return;
    const now = S.ac.currentTime;
    if (now - S.lastTick < 0.028) return;
    S.lastTick = now;
    click(now, 2600 + ring * 180, 6, 0.10, 0.03);
  };
  // The ring seating itself on release.
  S.snap = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    click(t, 1500, 2.5, 0.16, 0.045);
    tone(t, 140, 0.07, 0.07, 'sine');
  };
  // Restrained tonal confirmation: a small bell, tuned per ring.
  S.align = function (ring) {
    if (!live()) return;
    const t = S.ac.currentTime + 0.02;
    const f = NOTES[ring % NOTES.length];
    tone(t, f, 0.075, 1.4, 'sine', 0.004);
    tone(t, f * 2.76, 0.018, 0.5, 'sine', 0.003);
    tone(t, f * 2, 0.02, 0.9, 'triangle', 0.01);
  };
  S.refuse = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    click(t, 600, 3, 0.08, 0.05);
  };
  S.undo = function () {
    if (!live()) return;
    click(S.ac.currentTime, 1100, 3, 0.08, 0.04);
  };
  // Completion: the rings' notes, rolled slowly into one chord.
  S.complete = function (ringCount) {
    if (!live()) return;
    const t0 = S.ac.currentTime + 0.1;
    for (let k = 1; k < ringCount; k++) {
      const f = NOTES[k % NOTES.length];
      tone(t0 + k * 0.11, f, 0.06, 3.2, 'sine', 0.02);
      tone(t0 + k * 0.11, f * 2, 0.012, 2.0, 'triangle', 0.02);
    }
    tone(t0, NOTES[0] / 2, 0.05, 3.6, 'sine', 0.3);
    if (S.music) { try { ctx.music.duck(0.6, 2600); } catch (e) { } }
  };
  // A soft shimmer for the theme reveal.
  S.reveal = function () {
    if (!live()) return;
    const t = S.ac.currentTime;
    const o = S.ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.9);
    const g = S.ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(S.master); o.start(t); o.stop(t + 1.2);
  };
  S.setProgress = function (p) {
    if (S.music) { try { ctx.music.setIntensity(0.15 + p * 0.25, { fadeMs: 1500 }); } catch (e) { } }
  };
  S.setMuted = function (m) {
    S.muted = !!m;
    if (S.master) S.master.gain.value = S.muted ? 0 : 0.9;
    if (S.muted) {
      if (S.music) { try { ctx.music.stop({ fadeOutMs: 300 }); } catch (e) { } S.music = null; }
    }
  };
  return S;
}
