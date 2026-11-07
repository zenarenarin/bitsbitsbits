import * as THREE from 'three'
import { dotTexture, fbmTexture, radialTexture } from './textures.js'

/*
 * THE DOT
 *
 * A glazed burnt-orange sphere with amber mottling, a satin clearcoat and one
 * chalk band around its equator. The band makes every roll and spin legible.
 *
 * Squash and stretch are applied along a world axis (the impact normal, or the
 * direction of travel) through a three-level hierarchy, so deformation never
 * fights the rolling rotation:
 *   root (position) > squash (aligned to axis, non-uniform scale) > unsquash > mesh (rotation)
 */
let tex = null

export class Dot {
  constructor(ctx, { radius = 0.3, ground = () => -Infinity } = {}) {
    if (!tex) {
      tex = {
        map: dotTexture(),
        bump: fbmTexture({ size: 256, seed: 41, octaves: [16, 32, 64], lo: 0, hi: 1 }),
        shadow: radialTexture({ alpha: 0.85 }),
      }
    }
    this.radius = radius
    this.ground = ground
    this.root = new THREE.Group()
    this.squash = new THREE.Group()
    this.unsquash = new THREE.Group()
    this.root.add(this.squash)
    this.squash.add(this.unsquash)
    this.material = new THREE.MeshPhysicalMaterial({
      map: tex.map,
      roughness: 0.36,
      bumpMap: tex.bump,
      bumpScale: 0.35,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      sheen: 0.5,
      sheenColor: new THREE.Color('#ffb784'),
      sheenRoughness: 0.45,
      envMap: ctx.envMap,
      envMapIntensity: 1.05,
      emissive: new THREE.Color('#e9b96e'),
      emissiveIntensity: 0,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), this.material)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.unsquash.add(this.mesh)

    // Contact shadow: a soft pool on whatever surface is beneath, tightening as the Dot lands.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex.shadow, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.7 }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1
    this._axis = new THREE.Vector3(0, 1, 0)
    this._q = new THREE.Quaternion()
    this._up = new THREE.Vector3(0, 1, 0)
  }

  addTo(scene) {
    scene.add(this.root)
    scene.add(this.shadow)
    return this
  }

  /**
   * @param p position
   * @param q rolling orientation
   * @param axis world axis to deform along
   * @param k scale along axis (1 = none, <1 squash, >1 stretch), volume preserved
   */
  set(p, q, axis = this._up, k = 1, scale = 1) {
    this.root.position.copy(p)
    this.root.scale.setScalar(scale)
    this._q.setFromUnitVectors(this._up, axis.lengthSq() > 0 ? this._axis.copy(axis).normalize() : this._up)
    this.squash.quaternion.copy(this._q)
    const side = 1 / Math.sqrt(k)
    this.squash.scale.set(side, k, side)
    this.unsquash.quaternion.copy(this._q).invert()
    if (q) this.mesh.quaternion.copy(q)
    const gy = this.ground(p.x, p.z)
    if (gy > -1e5) {
      const h = Math.max(0, p.y - this.radius * scale - gy)
      const s = this.radius * scale * (2.2 + h * 0.9)
      this.shadow.visible = scale > 0.02
      this.shadow.position.set(p.x, gy + 0.004, p.z)
      this.shadow.scale.set(s, s, 1)
      this.shadow.material.opacity = 0.62 * Math.exp(-h * 0.55) * Math.min(1, scale)
    } else this.shadow.visible = false
  }
}
