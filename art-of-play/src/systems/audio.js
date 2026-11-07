/**
 * Procedural sound. Everything is synthesised with the Web Audio API: no files.
 * The palette is physical (chalk, ceramic, wood, air) rather than arcade.
 *
 * Sounds are triggered from timeline callbacks, which only fire on forward play.
 * When the presenter skips a beat, silenceSkips() suppresses the burst of
 * callbacks that GSAP fires while jumping to the end.
 */
export class Audio {
  constructor() {
    this.ctx = null
    this.muted = false
    this.skip = false
    this.want = null
    this.amb = null
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 3
      this.master.connect(comp).connect(ctx.destination)
      // Shared noise source material.
      const len = ctx.sampleRate * 2
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.noise = buf
      const bbuf = ctx.createBuffer(1, len, ctx.sampleRate)
      const b = bbuf.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        b[i] = last * 3.5
      }
      this.brown = bbuf
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    if (this.want !== undefined && this.ctx && !this.amb) this.ambience(this.want)
  }

  setMuted(m) {
    this.muted = m
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.04)
  }

  silenceSkips(fn) {
    this.skip = true
    try {
      fn()
    } finally {
      this.skip = false
    }
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && !this.skip
  }

  _src(buf = this.noise, loop = false) {
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    s.loop = loop
    s.loopStart = 0
    s.loopEnd = buf.duration
    return s
  }

  _env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + a)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }

  // ------------------------------------------------------------ ambience

  /** Low, slowly breathing room tone. Each scene names its own colour. */
  ambience(name) {
    this.want = name
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    if (this.amb) {
      const old = this.amb
      old.out.gain.setTargetAtTime(0.0001, t, 0.8)
      setTimeout(() => old.nodes.forEach((n) => n.stop && n.stop()), 4000)
      this.amb = null
    }
    if (!name) return
    const presets = {
      void: { cut: 240, tones: [55, 82.41], level: 0.12, lfo: 0.05 },
      ocean: { cut: 420, tones: [61.74, 92.5, 123.47], level: 0.1, lfo: 0.08 },
    }
    const p = presets[name] || presets.void
    const out = ctx.createGain()
    out.gain.value = 0.0001
    out.connect(this.master)
    const nodes = []
    const n = this._src(this.brown, true)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = p.cut
    const lfo = ctx.createOscillator()
    lfo.frequency.value = p.lfo
    const lg = ctx.createGain()
    lg.gain.value = p.cut * 0.4
    lfo.connect(lg).connect(f.frequency)
    const ng = ctx.createGain()
    ng.gain.value = 0.55
    n.connect(f).connect(ng).connect(out)
    nodes.push(n, lfo)
    p.tones.forEach((hz, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      o.detune.value = (i % 2 ? 1 : -1) * 4
      const g = ctx.createGain()
      g.gain.value = 0.05 / (i + 1)
      o.connect(g).connect(out)
      nodes.push(o)
    })
    nodes.forEach((x) => x.start())
    out.gain.setTargetAtTime(p.level, t, 1.2)
    this.amb = { out, nodes }
  }

  // ------------------------------------------------------------ events

  /** Chalk on an imaginary surface: band-limited noise in irregular grains. */
  chalk(duration = 1, intensity = 1) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const s = this._src(this.noise, true)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2600
    bp.Q.value = 0.9
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1100
    const g = ctx.createGain()
    g.gain.value = 0.0001
    s.connect(bp).connect(hp).connect(g).connect(this.master)
    let x = t
    const end = t + duration
    const lvl = 0.05 * intensity
    g.gain.setValueAtTime(0.0001, t)
    while (x < end) {
      const on = 0.012 + Math.random() * 0.03
      g.gain.setValueAtTime(lvl * (0.3 + Math.random() * 0.7), x)
      g.gain.setValueAtTime(lvl * 0.15 * Math.random(), x + on)
      bp.frequency.setValueAtTime(2000 + Math.random() * 1600, x)
      x += on + Math.random() * 0.02
    }
    g.gain.setValueAtTime(0.0001, end)
    s.start(t)
    s.stop(end + 0.05)
  }

  /** Body of an impact: a pitched thump plus a short material click. */
  impact(strength = 0.5, { pitch = 1, material = 'ceramic' } = {}) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const k = Math.max(0.05, Math.min(1, strength))
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150 * pitch, t)
    o.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.16)
    const og = ctx.createGain()
    this._env(og, t, 0.003, 0.55 * k, 0.22)
    o.connect(og).connect(this.master)
    o.start(t)
    o.stop(t + 0.3)
    const n = this._src()
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = (material === 'wood' ? 900 : 1800) * pitch
    bp.Q.value = material === 'wood' ? 2 : 3.5
    const ng = ctx.createGain()
    this._env(ng, t, 0.001, 0.35 * k, material === 'wood' ? 0.05 : 0.08)
    n.connect(bp).connect(ng).connect(this.master)
    n.start(t, Math.random())
    n.stop(t + 0.15)
  }

  bounce(speed = 3) {
    this.impact(Math.min(1, speed / 7), { pitch: 1.15 })
  }

  /** Two hard objects meeting: a dry, woody knock. */
  collide(strength = 0.6) {
    this.impact(strength, { pitch: 1.6, material: 'wood' })
  }

  /** A connection being made: tiny, bright, precise. */
  click(pitch = 1) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[1, 1.5].forEach((m, i) => {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = 1320 * pitch * m
      const g = ctx.createGain()
      this._env(g, t + i * 0.012, 0.002, 0.06 / (i + 1), 0.12)
      o.connect(g).connect(this.master)
      o.start(t)
      o.stop(t + 0.25)
    })
  }

  /** Something gained: a soft, unhurried fifth, filtered like felt. */
  collect(pitch = 1) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    lp.connect(this.master)
    ;[440, 660].forEach((hz, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz * pitch
      const g = ctx.createGain()
      this._env(g, t + i * 0.07, 0.02, 0.07, 0.6)
      o.connect(g).connect(lp)
      o.start(t)
      o.stop(t + 1)
    })
  }

  /** Parts locking together: a low knock with a faint inharmonic ring. */
  assemble(strength = 0.7) {
    if (!this.ok) return
    this.impact(strength * 0.8, { pitch: 0.75 })
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[1730, 2610].forEach((hz) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      const g = ctx.createGain()
      this._env(g, t, 0.002, 0.018 * strength, 0.7)
      o.connect(g).connect(this.master)
      o.start(t)
      o.stop(t + 0.8)
    })
  }

  /** Parts letting go: a loose scatter of small knocks. */
  disassemble(count = 6) {
    if (!this.ok) return
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.impact(0.15 + Math.random() * 0.2, { pitch: 1.2 + Math.random(), material: 'wood' }), i * (40 + Math.random() * 60))
    }
  }

  /** Air moving past: a swept band of noise. */
  whoosh(duration = 1.2, level = 0.18) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const n = this._src()
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    bp.frequency.setValueAtTime(260, t)
    bp.frequency.exponentialRampToValueAtTime(1500, t + duration * 0.55)
    bp.frequency.exponentialRampToValueAtTime(380, t + duration)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + duration * 0.5)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    n.connect(bp).connect(g).connect(this.master)
    n.start(t, Math.random())
    n.stop(t + duration + 0.05)
  }

  /** A deep, slow swell for reveals. */
  swell(duration = 2.5, hz = 73.4) {
    if (!this.ok) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(200, t)
    lp.frequency.linearRampToValueAtTime(900, t + duration * 0.6)
    lp.frequency.linearRampToValueAtTime(250, t + duration)
    lp.connect(this.master)
    ;[1, 1.5, 2.003].forEach((m, i) => {
      const o = ctx.createOscillator()
      o.type = i ? 'sine' : 'triangle'
      o.frequency.value = hz * m
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), t + duration * 0.45)
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
      o.connect(g).connect(lp)
      o.start(t)
      o.stop(t + duration + 0.1)
    })
  }
}
