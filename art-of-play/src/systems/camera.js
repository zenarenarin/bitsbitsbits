import * as THREE from 'three'

/*
 * Camera: a plain state object (position, target, fov, roll) that GSAP tweens,
 * plus an optional procedural "follow" state blended in by weight. Ambient drift
 * is a smooth, low-amplitude function of the ambient clock: alive on holds,
 * never shaky.
 */
export class CameraRig {
  constructor({ fov = 35, near = 0.1, far = 400 } = {}) {
    this.camera = new THREE.PerspectiveCamera(fov, 1920 / 1080, near, far)
    this.s = { x: 0, y: 0, z: 10, tx: 0, ty: 0, tz: 0, fov, roll: 0, drift: 1, follow: 0 }
    this.followPos = new THREE.Vector3()
    this.followTarget = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._t = new THREE.Vector3()
  }

  set(v) {
    Object.assign(this.s, v)
    return this
  }

  /** Tween to a shot on a timeline. */
  to(tl, shot, { at, duration = 2, ease = 'power3.inOut' } = {}) {
    return tl.to(this.s, { ...shot, duration, ease }, at)
  }

  apply(time) {
    const s = this.s
    const p = this._p.set(s.x, s.y, s.z)
    const t = this._t.set(s.tx, s.ty, s.tz)
    if (s.follow > 0) {
      p.lerp(this.followPos, s.follow)
      t.lerp(this.followTarget, s.follow)
    }
    const a = 0.045 * s.drift
    p.x += Math.sin(time * 0.21) * a + Math.sin(time * 0.53 + 1.3) * a * 0.35
    p.y += Math.sin(time * 0.17 + 2.1) * a * 0.7
    p.z += Math.cos(time * 0.13 + 0.4) * a * 0.5
    const c = this.camera
    c.position.copy(p)
    c.up.set(Math.sin(s.roll), Math.cos(s.roll), 0)
    c.lookAt(t)
    if (c.fov !== s.fov) {
      c.fov = s.fov
      c.updateProjectionMatrix()
    }
  }
}
