import * as THREE from 'three'
import gsap from 'gsap'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Audio } from '../systems/audio.js'

export const W = 1920
export const H = 1080

/**
 * The presentation engine.
 *
 * One persistent WebGL renderer. Scenes are built from factories, each returning a
 * GSAP master timeline whose labels are the presenter's hold states. Everything a
 * scene shows is a function of timeline time (plus a separate ambient clock for
 * idle life), so any beat can be revisited, replayed or skipped deterministically.
 */
export class Engine {
  constructor({ canvas, typeLayer, svgLayer, scenes, onStatus, grain }) {
    this.grain = grain
    this.canvas = canvas
    this.typeLayer = typeLayer
    this.svgLayer = svgLayer
    this.factories = scenes
    this.onStatus = onStatus || (() => {})

    const params = new URLSearchParams(location.search)
    this.quality = params.get('q') === 'low' ? 0.7 : 1
    this.capture = params.has('capture')

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.capture,
    })
    renderer.setPixelRatio(this.quality)
    renderer.setSize(W, H, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer = renderer

    // Soft studio reflections shared by every material that wants highlights.
    const pmrem = new THREE.PMREMGenerator(renderer)
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.audio = new Audio()
    this.ctx = {
      engine: this,
      renderer,
      envMap: this.envMap,
      audio: this.audio,
      typeLayer,
      svgLayer,
      W,
      H,
    }

    this.sceneIndex = -1
    this.current = null
    this.prepared = new Map()
    this.beat = 0
    this.active = null // tween currently playing a beat
    this.time = 0
    this.fps = 60
    this._frameTimes = []
    this.hud = false

    if (this.capture) {
      // Frame-exact rendering for recordings: time only advances when asked.
      gsap.ticker.remove(gsap.updateRoot)
      gsap.ticker.lagSmoothing(0)
      this._gsapTime = 0
      window.__aop = {
        step: (dt) => this.step(dt),
        next: () => this.next(),
        prev: () => this.prev(),
        state: () => this.state(),
        goto: (s, b) => this.goto(s, b),
      }
    } else {
      window.__aop = { state: () => this.state(), next: () => this.next(), prev: () => this.prev(), goto: (s, b) => this.goto(s, b) }
    }
    window.__aop.labels = () => ({ ...this.current.timeline.labels })
    window.__aop.seek = (t) => {
      this._killActive()
      this.current.timeline.seek(t, true)
    }
  }

  async start() {
    await document.fonts.ready
    const params = new URLSearchParams(location.search)
    const s = Math.max(0, Math.min(this.factories.length - 1, (parseInt(params.get('scene') || '1', 10) || 1) - 1))
    const b = parseInt(params.get('beat') || '0', 10) || 0
    this.goto(s, b)
    this._bindKeys()
    if (!this.capture) {
      this._last = performance.now()
      const loop = (now) => {
        const dt = Math.min(0.1, (now - this._last) / 1000)
        this._last = now
        this._tick(dt, now)
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }
    window.__aop.ready = true
  }

  /** Capture mode: advance the whole world by exactly dt seconds and render. */
  step(dt) {
    this._gsapTime += dt
    gsap.updateRoot(this._gsapTime)
    this._tick(dt, this._gsapTime * 1000)
  }

  _tick(dt, now) {
    this.time += dt
    const ft = this._frameTimes
    ft.push(dt)
    if (ft.length > 90) ft.shift()
    if (this.grain) {
      const k = Math.floor(this.time * 12)
      if (k !== this._grainK) {
        this._grainK = k
        const h = (k * 2654435761) >>> 0
        this.grain.style.transform = `translate3d(${(h % 7) * 37 - 111}px, ${((h >>> 8) % 7) * 37 - 111}px, 0)`
      }
    }
    if (this.current) {
      this.current.update(this.time, dt)
      this.renderer.render(this.current.scene, this.current.camera)
    }
    if (this.hud && (this._hudT = (this._hudT || 0) + dt) > 0.25) {
      this._hudT = 0
      this._emit()
    }
  }

  measuredFps() {
    const ft = this._frameTimes
    if (!ft.length) return 0
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length
    return 1 / avg
  }

  // ---------------------------------------------------------------- scenes

  _build(index) {
    if (this.prepared.has(index)) {
      const s = this.prepared.get(index)
      this.prepared.delete(index)
      return s
    }
    const f = this.factories[index]
    const typeRoot = document.createElement('div')
    typeRoot.className = 'scene-type'
    typeRoot.style.cssText = 'position:absolute;inset:0;visibility:hidden'
    this.typeLayer.appendChild(typeRoot)
    const svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svgRoot.style.visibility = 'hidden'
    this.svgLayer.appendChild(svgRoot)
    const inst = f.create({ ...this.ctx, typeRoot, svgRoot })
    inst.meta = f
    inst.typeRoot = typeRoot
    inst.svgRoot = svgRoot
    inst.labels = inst.beats.map((b) => b)
    // Warm up shaders so the first frame of a scene never hitches.
    this.renderer.compile(inst.scene, inst.camera)
    return inst
  }

  _dispose(inst) {
    if (!inst) return
    inst.timeline.kill()
    inst.dispose && inst.dispose()
    inst.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material]
        m.forEach((mm) => {
          // Free GPU copies of textures too (shared ones simply re-upload if reused).
          for (const k of ['map', 'roughnessMap', 'bumpMap', 'alphaMap']) mm[k]?.dispose?.()
          mm.dispose()
        })
      }
    })
    inst.typeRoot.remove()
    inst.svgRoot.remove()
  }

  _activate(index) {
    const inst = this._build(index)
    if (this.current) this._dispose(this.current)
    this.current = inst
    this.sceneIndex = index
    inst.typeRoot.style.visibility = 'visible'
    inst.svgRoot.style.visibility = 'visible'
    inst.timeline.pause()
    this.audio.ambience(inst.ambience || null)
    // Prepare the next scene during idle time so transitions never wait on a build.
    const n = index + 1
    if (n < this.factories.length && !this.prepared.has(n)) {
      const prep = () => this.prepared.set(n, this._build(n))
      ;(window.requestIdleCallback || setTimeout)(prep, { timeout: 1500 })
    }
    return inst
  }

  goto(sceneIndex, beat = 0) {
    this._killActive()
    this.ended = false
    for (const [, p] of this.prepared) this._dispose(p)
    this.prepared.clear()
    const inst = this._activate(sceneIndex)
    this.beat = Math.max(0, Math.min(inst.labels.length - 1, beat))
    inst.timeline.seek(inst.labels[this.beat], true)
    this._emit()
  }

  _killActive() {
    if (this.active) {
      this.active.kill()
      this.active = null
    }
  }

  // ---------------------------------------------------------------- navigation

  next() {
    this.audio.unlock()
    const inst = this.current
    if (!inst) return
    if (this.active) {
      // Never make the presenter wait: complete the beat in progress.
      this.audio.silenceSkips(() => this.active.progress(1))
      return
    }
    const atLast = this.beat >= inst.labels.length - 1
    if (!atLast) {
      this._play(inst.labels[this.beat + 1], () => {
        this.beat += 1
      })
    } else if (inst.exitLabel && this.sceneIndex < this.factories.length - 1) {
      // The exit beat carries the thread into the next scene, which then plays its intro.
      this._play(inst.exitLabel, () => {
        const next = this._activate(this.sceneIndex + 1)
        next.timeline.seek(0, true)
        this.beat = 0
        this._play(next.labels[0], null, next)
      })
    } else if (inst.exitLabel && !this.ended) {
      // Last built scene: play its exit and rest there.
      this._play(inst.exitLabel, () => (this.ended = true))
    }
    this._emit()
  }

  _play(label, done, inst = this.current) {
    const tl = inst.timeline
    const target = tl.labels[label]
    if (target === undefined) throw new Error(`missing label ${label}`)
    const dur = Math.max(0.001, target - tl.time())
    this.active = gsap.to(tl, {
      time: target,
      duration: dur,
      ease: 'none',
      onComplete: () => {
        this.active = null
        done && done()
        this._emit()
      },
    })
    this._emit()
  }

  prev() {
    this.audio.unlock()
    const inst = this.current
    if (!inst) return
    if (this.ended) {
      this.ended = false
      inst.timeline.seek(inst.labels[this.beat], true)
      this._emit()
      return
    }
    if (this.active) {
      // Abandon the beat in progress and return to the hold it started from.
      this._killActive()
      inst.timeline.seek(inst.labels[this.beat], true)
      this._emit()
      return
    }
    if (this.beat > 0) {
      this.beat -= 1
      inst.timeline.seek(inst.labels[this.beat], true)
    } else if (this.sceneIndex > 0) {
      const p = this.sceneIndex - 1
      this.goto(p, 999)
    }
    this._emit()
  }

  replay() {
    this.audio.unlock()
    const i = this.sceneIndex
    this.goto(i, 0)
    const inst = this.current
    // A scene with an intro replays it; otherwise it simply returns to its first hold.
    if (inst.timeline.labels[inst.labels[0]] > 0) {
      inst.timeline.seek(0, true)
      this._play(inst.labels[0])
    }
  }

  state() {
    const inst = this.current
    return {
      scene: this.sceneIndex + 1,
      id: inst?.meta.id,
      beat: this.beat,
      beats: inst?.labels.length,
      label: inst?.labels[this.beat],
      playing: !!this.active,
      ended: !!this.ended,
      time: inst?.timeline.time(),
      fps: this.measuredFps(),
    }
  }

  _emit() {
    const inst = this.current
    if (!inst) return
    this.onStatus({
      scene: this.sceneIndex + 1,
      total: this.factories.length,
      title: inst.meta.title,
      beat: this.beat,
      beats: inst.labels.length,
      playing: !!this.active,
      hud: this.hud
        ? `${this.measuredFps().toFixed(1)} fps  ${(1000 / Math.max(1, this.measuredFps())).toFixed(1)} ms\n` +
          `scene ${this.sceneIndex + 1}  beat ${this.beat} ${inst.labels[this.beat]}\n` +
          `t ${inst.timeline.time().toFixed(2)}  q ${this.quality}\n` +
          `calls ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}`
        : null,
      muted: this.audio.muted,
    })
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && !['ArrowRight', 'ArrowLeft'].includes(e.key)) return
      const k = e.key
      if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') {
        e.preventDefault()
        this.next()
      } else if (k === 'ArrowLeft' || k === 'PageUp') {
        e.preventDefault()
        this.prev()
      } else if (k === 'r' || k === 'R') this.replay()
      else if (k === 'f' || k === 'F') this.toggleFullscreen()
      else if (k === 'm' || k === 'M') {
        this.audio.unlock()
        this.audio.setMuted(!this.audio.muted)
        this._emit()
      } else if (k === 'd' || k === 'D') {
        this.hud = !this.hud
        this._emit()
      } else if (k === 'h' || k === 'H') {
        document.querySelector('.indicator')?.classList.toggle('hidden')
      } else if (k === 'q' || k === 'Q') {
        this.quality = this.quality === 1 ? 0.7 : 1
        this.renderer.setPixelRatio(this.quality)
        this.renderer.setSize(W, H, false)
        this._emit()
      } else if (/^[0-9]$/.test(k)) {
        const i = k === '0' ? 9 : parseInt(k, 10) - 1
        if (i < this.factories.length) this.goto(i, 0)
      }
    })
    window.addEventListener('pointerdown', () => this.audio.unlock())
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
    else document.exitFullscreen?.()
  }
}
