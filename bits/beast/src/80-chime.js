// ---- Chime: a quiet bell for each seed ----------------------------------------
// Synthesised once at first use into small in-memory WAV clips (no files, no
// network) and played through ctx.audio. A soft glassy bell: a few inharmonic
// partials with a gentle attack and long decay. Rare seeds ring a rising
// three-note figure, ancient ones a low open chord. Silent where audio is
// unavailable.

const CHIME_RATE = 22050;

function bellClip(notes, dur, volume) {
  const n = Math.floor(CHIME_RATE * dur);
  const data = new Float32Array(n);
  for (const [f, at, amp] of notes) {
    const s0 = Math.floor(at * CHIME_RATE);
    for (let i = s0; i < n; i++) {
      const t = (i - s0) / CHIME_RATE;
      const env = Math.min(1, t / 0.006) * Math.exp(-t * 3.2);
      data[i] += amp * env * (Math.sin(6.2832 * f * t) + 0.32 * Math.sin(6.2832 * f * 2.76 * t) * Math.exp(-t * 4) + 0.12 * Math.sin(6.2832 * f * 5.4 * t) * Math.exp(-t * 7));
    }
  }
  // 16-bit mono PCM in a WAV container, as a data URL.
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, CHIME_RATE, true); dv.setUint32(28, CHIME_RATE * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, clamp(data[i] * volume, -1, 1) * 32767, true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  return "data:audio/wav;base64," + btoa(bin);
}

class Chime {
  constructor(ctx) {
    this.ctx = ctx;
    this.clips = null;
    this.i = 0;
    this.ok = !!(ctx.audio && typeof ctx.audio.play === "function" && typeof btoa === "function");
  }

  build() {
    // A pentatonic handful so consecutive seeds never repeat the same note.
    this.clips = {
      common: [1046.5, 1174.7, 1318.5, 1568].map((f) => bellClip([[f, 0, 0.5]], 1.1, 0.5)),
      rare: [bellClip([[1046.5, 0, 0.4], [1318.5, 0.09, 0.4], [1568, 0.18, 0.45]], 1.4, 0.5)],
      ancient: [bellClip([[523.25, 0, 0.4], [784, 0.05, 0.35], [1046.5, 0.1, 0.3], [1568, 0.3, 0.25]], 2, 0.5)],
      bloom: [bellClip([[1568, 0, 0.3], [2093, 0.07, 0.25]], 0.9, 0.4)]
    };
  }

  play(kind) {
    if (!this.ok) return;
    try {
      if (!this.clips) this.build();
      const set = this.clips[kind] || this.clips.common;
      this.ctx.audio.play(set[this.i++ % set.length], { volume: 0.45 });
    } catch (err) {
      this.ok = false; // audio refused (permission, autoplay): stay silent
    }
  }
}
