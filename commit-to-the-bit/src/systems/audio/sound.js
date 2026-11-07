// Tiny Web Audio sound kit. Everything is synthesised — no files, no network.
let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

// Soft mallet note — used for beats and connections.
export function pluck(freq = 440, { vol = 0.25, decay = 0.9, delay = 0, type = 'sine' } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o2.type = 'sine';
  o2.frequency.value = freq * 2.01;
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  o2.connect(g2).connect(g);
  o.connect(g).connect(master);
  env(g, t, 0.006, decay, vol);
  o.start(t);
  o2.start(t);
  o.stop(t + decay + 0.1);
  o2.stop(t + decay + 0.1);
}

// Pentatonic helper so sequences always sound consonant.
const PENTA = [0, 2, 4, 7, 9];
export function note(step, base = 220) {
  const oct = Math.floor(step / 5);
  const s = PENTA[((step % 5) + 5) % 5];
  return base * Math.pow(2, oct + s / 12);
}

export function chord(steps, base = 220, opts = {}) {
  steps.forEach((s, i) => pluck(note(s, base), { ...opts, delay: (opts.delay || 0) + i * (opts.spread ?? 0.06) }));
}

// Filtered noise swell — transitions.
export function whoosh({ dur = 0.7, from = 300, to = 2400, vol = 0.18 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  f.frequency.exponentialRampToValueAtTime(from * 0.8, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// Low body thump — landings, impacts.
export function thump({ freq = 120, vol = 0.35 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(freq * 1.8, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.18);
  o.connect(g).connect(master);
  env(g, t, 0.004, 0.25, vol);
  o.start(t);
  o.stop(t + 0.35);
}

// Gentle descending "not quite" — failure feedback, never punishing.
export function miss() {
  pluck(note(4, 220), { vol: 0.14, decay: 0.35 });
  pluck(note(2, 220), { vol: 0.12, decay: 0.5, delay: 0.09 });
}

export function unlockAudio() {
  ac();
}
