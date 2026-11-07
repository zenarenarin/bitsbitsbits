import * as THREE from 'three'

/*
 * Deterministic physics for presentation.
 *
 * Motion is simulated once, when a scene is built, at a fixed 1/240 s step, and
 * recorded. The timeline then plays the recording back, so motion is physically
 * derived yet seekable, reversible and identical on every run. No accumulated
 * runtime state, no physics library.
 *
 * Supported: a sphere against axis-aligned boxes and planes, with restitution,
 * Coulomb friction, rolling resistance and rolling rotation; and a sphere
 * following a rail under gravity (energy-correct speed along a curve).
 */

const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

export class Track {
  constructor() {
    this.frames = [] // { t, p: Vector3, q: Quaternion, v: Vector3, contact: bool }
    this.impacts = [] // { t, p, n, speed }
  }

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0
  }

  get last() {
    return this.frames[this.frames.length - 1]
  }

  push(t, p, q, v, contact = false) {
    this.frames.push({ t, p: p.clone(), q: q.clone(), v: v.clone(), contact })
  }

  /** Sample position and rotation at time t (clamped). */
  sample(t, outP, outQ, outV) {
    const f = this.frames
    if (!f.length) return
    if (t <= f[0].t) {
      outP.copy(f[0].p)
      outQ && outQ.copy(f[0].q)
      outV && outV.copy(f[0].v)
      return
    }
    if (t >= f[f.length - 1].t) {
      const l = f[f.length - 1]
      outP.copy(l.p)
      outQ && outQ.copy(l.q)
      outV && outV.copy(l.v)
      return
    }
    let lo = 0
    let hi = f.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (f[m].t <= t) lo = m
      else hi = m
    }
    const a = f[lo]
    const b = f[hi]
    const k = (t - a.t) / (b.t - a.t)
    outP.copy(a.p).lerp(b.p, k)
    outQ && outQ.copy(a.q).slerp(b.q, k)
    outV && outV.copy(a.v).lerp(b.v, k)
  }

  /**
   * Squash and stretch at time t, derived from the recorded impacts and velocity.
   * Returns { axis, k }: compress along the impact normal just after contact
   * (with a damped rebound), otherwise stretch slightly along fast travel.
   */
  deform(t, v, { squash = 0.07, maxSquash = 0.36, stretch = 0.012, maxStretch = 0.16 } = {}) {
    let recent = null
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      if (this.impacts[i].t <= t) {
        recent = this.impacts[i]
        break
      }
    }
    if (recent) {
      const dt = t - recent.t
      if (dt < 0.32) {
        const a = Math.min(maxSquash, recent.speed * squash)
        const k = 1 - a * Math.exp(-dt / 0.055) * Math.cos(dt * 26)
        return { axis: recent.n, k }
      }
    }
    const sp = v.length()
    if (sp > 0.5) return { axis: tmp2.copy(v).normalize(), k: 1 + Math.min(maxStretch, sp * stretch) }
    return { axis: tmp2.set(0, 1, 0), k: 1 }
  }
}

/** Free flight and collision of a sphere against boxes and planes. */
export function simulateSphere(track, {
  t0 = 0,
  p,
  v,
  q = new THREE.Quaternion(),
  r = 0.3,
  g = -9.8,
  boxes = [],
  planes = [],
  restitution = 0.5,
  friction = 0.35,
  rolling = 0.9,
  duration = 4,
  dt = 1 / 240,
  record = 1 / 120,
  stopWhenResting = true,
  minImpact = 0.35,
}) {
  p = p.clone()
  v = v.clone()
  q = q.clone()
  const w = new THREE.Vector3()
  let t = 0
  let nextRec = 0
  let restT = 0
  let contact = false
  const n = new THREE.Vector3()
  const dq = new THREE.Quaternion()
  if (!track.frames.length || track.last.t < t0) track.push(t0, p, q, v)
  while (t < duration) {
    v.y += g * dt
    p.addScaledVector(v, dt)
    contact = false
    const resolve = (normal, depth, e, mu) => {
      p.addScaledVector(normal, depth)
      const vn = v.dot(normal)
      if (vn < 0) {
        if (-vn > minImpact) track.impacts.push({ t: t0 + t, p: p.clone().addScaledVector(normal, -r), n: normal.clone(), speed: -vn })
        const jn = -(1 + (-vn > 0.6 ? e : 0)) * vn
        v.addScaledVector(normal, jn)
        // Coulomb friction on the tangential component, bounded by the normal impulse.
        tmp.copy(v).addScaledVector(normal, -v.dot(normal))
        const vt = tmp.length()
        if (vt > 1e-6) {
          const drop = Math.min(vt, mu * jn * 0.6)
          v.addScaledVector(tmp, -drop / vt)
        }
      }
      // Rolling resistance while in contact.
      tmp.copy(v).addScaledVector(normal, -v.dot(normal))
      v.addScaledVector(tmp, -Math.min(1, rolling * dt))
      // Rolling without slipping: angular velocity from contact velocity.
      w.copy(normal).cross(v).divideScalar(r)
      contact = true
    }
    for (const b of boxes) {
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x))
      const cy = Math.max(b.min.y, Math.min(p.y, b.max.y))
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z))
      n.set(p.x - cx, p.y - cy, p.z - cz)
      const d = n.length()
      if (d < r) {
        if (d < 1e-6) n.set(0, 1, 0)
        else n.divideScalar(d)
        resolve(n, r - d, b.restitution ?? restitution, b.friction ?? friction)
      }
    }
    for (const pl of planes) {
      const d = pl.normal.dot(p) - pl.constant
      if (d < r) resolve(pl.normal, r - d, pl.restitution ?? restitution, pl.friction ?? friction)
    }
    // Integrate rotation.
    const wl = w.length()
    if (wl > 1e-6) {
      dq.setFromAxisAngle(tmp.copy(w).divideScalar(wl), wl * dt)
      q.premultiply(dq)
    }
    if (!contact) w.multiplyScalar(0.999)
    t += dt
    if (t >= nextRec) {
      track.push(t0 + t, p, q, v, contact)
      nextRec += record
    }
    if (stopWhenResting && contact && v.length() < 0.05) {
      restT += dt
      if (restT > 0.25) break
    } else restT = 0
  }
  track.push(t0 + t, p, q, v.set(0, 0, 0), contact)
  return { t: t0 + t, p, v, q }
}

/**
 * A sphere rolling along a rail (a THREE.Curve describing the path of its centre)
 * under gravity. Speed follows energy: v' = -g * dy/ds - drag. Contact normal is
 * supplied so rolling rotation is correct (inside a loop it points to the loop centre).
 */
export function simulateRail(track, {
  t0 = 0,
  curve,
  v0 = 0,
  r = 0.3,
  g = 9.8,
  drag = 0.04,
  q = new THREE.Quaternion(),
  normalAt = (u, tangent) => new THREE.Vector3(-tangent.y, tangent.x, 0),
  dt = 1 / 240,
  record = 1 / 120,
  sStart = 0,
  sEnd = null,
}) {
  const L = curve.getLength()
  const end = sEnd ?? L
  let s = sStart
  let v = v0
  let t = 0
  let nextRec = 0
  q = q.clone()
  const p = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const vel = new THREE.Vector3()
  const dq = new THREE.Quaternion()
  const w = new THREE.Vector3()
  while (s < end && t < 30) {
    const u = s / L
    curve.getPointAt(Math.min(1, u), p)
    curve.getTangentAt(Math.min(1, u), tan)
    v += (-g * tan.y - drag * v * Math.abs(v)) * dt
    if (v < 0.05) v = 0.05
    s += v * dt
    vel.copy(tan).multiplyScalar(v)
    const nrm = normalAt(u, tan)
    w.copy(nrm).cross(vel).divideScalar(r)
    const wl = w.length()
    if (wl > 1e-6) {
      dq.setFromAxisAngle(w.clone().divideScalar(wl), wl * dt)
      q.premultiply(dq)
    }
    t += dt
    if (t >= nextRec) {
      track.push(t0 + t, p, q, vel, true)
      nextRec += record
    }
  }
  curve.getPointAt(Math.min(1, end / L), p)
  track.push(t0 + t, p, q, vel, true)
  return { t: t0 + t, p: p.clone(), v: vel.clone(), q }
}

export function aabb(center, size, extra = {}) {
  return {
    min: new THREE.Vector3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
    max: new THREE.Vector3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2),
    ...extra,
  }
}
